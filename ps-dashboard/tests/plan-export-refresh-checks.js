// Node checks for the Tempo planned-time export's refresh window.
// Run: node "ps-dashboard/tests/plan-export-refresh-checks.js"
//
// Background (2026-10-15, 2026.W42): the sheet froze a completed week after two
// weeks and never looked at it again, so a plan edited five weeks after the
// fact (a repeating series bumped 2h → 2.5h/day, a project plan added) left the
// sheet 6 hrs short of Tempo for that week. These checks pin the three things
// that now prevent it: the routine window covers every week the dashboard can
// show, the first run of each ISO week goes a quarter back, and the merge
// really replaces a refreshed week's stored value.
const fs = require('fs');
const path = require('path');
global.Logger = { log: function () {} };
global.PropertiesService = { getScriptProperties: function () { throw new Error('not stubbed'); } };

// Direct eval: `const`/`let` declared inside stay inside, so hand the test the
// handles it needs from within the same scope.
eval(
  fs.readFileSync(path.join(__dirname, '..', 'TempoPlanExport.js'), 'utf8') +
  '\nglobal.__plan = { CONFIGPlan, planDeepRefreshDue_, markPlanDeepRefreshDone_, ' +
  'mergePlanGrid_, isoWeekLabel_, rollingWindowMonday_, parseDateLocal_, planMondayOfIso_ };'
);
const P = global.__plan;
const src = fs.readFileSync(path.join(__dirname, '..', 'TempoPlanExport.js'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}

// ── 1. Routine window covers the dashboard's rolling 5-week view ─────────────
const DASHBOARD_WEEKS = 5;
ck('REFRESH_PAST_WEEKS ≥ the dashboard\'s 5-week view',
   P.CONFIGPlan.REFRESH_PAST_WEEKS >= DASHBOARD_WEEKS,
   'is ' + P.CONFIGPlan.REFRESH_PAST_WEEKS);
ck('DEEP_REFRESH_PAST_WEEKS reaches further than the routine window',
   P.CONFIGPlan.DEEP_REFRESH_PAST_WEEKS > P.CONFIGPlan.REFRESH_PAST_WEEKS);
ck('a quarter of history is re-fetched on the deep pass',
   P.CONFIGPlan.DEEP_REFRESH_PAST_WEEKS >= 13);

// FROM_DATE is a Monday exactly REFRESH_PAST_WEEKS ISO weeks before this one.
const from = P.parseDateLocal_(P.CONFIGPlan.FROM_DATE);
ck('FROM_DATE lands on a Monday', from.getDay() === 1);
const expectMonday = P.rollingWindowMonday_(P.CONFIGPlan.REFRESH_PAST_WEEKS);
ck('FROM_DATE is REFRESH_PAST_WEEKS back from this ISO week',
   P.isoWeekLabel_(from) === P.isoWeekLabel_(expectMonday));

// The W37 case, dated: on 2026-10-15 (W42) a 2-week window started at W40 and
// left W37 frozen; a 6-week window starts at W36 and reaches it.
const thursdayW42 = new Date(2026, 9, 15);
function mondayWeeksBack(today, n) {
  const d = new Date(today.getTime());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * n);
  return d;
}
ck('2026-10-15: a 2-week window would NOT reach 2026.W37',
   P.isoWeekLabel_(mondayWeeksBack(thursdayW42, 2)) > '2026.W37');
ck('2026-10-15: the routine window reaches 2026.W37',
   P.isoWeekLabel_(mondayWeeksBack(thursdayW42, P.CONFIGPlan.REFRESH_PAST_WEEKS)) <= '2026.W37');

// ── 2. Deep pass runs once per ISO week, remembered in Script Properties ─────
function fakeProps(initial) {
  const store = Object.assign({}, initial || {});
  return {
    getProperty: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setProperty: function (k, v) { store[k] = String(v); },
    store: store,
  };
}
const props = fakeProps();
const wed = new Date(2026, 9, 14);   // 2026.W42
const thu = new Date(2026, 9, 15);   // 2026.W42
const nextMon = new Date(2026, 9, 19); // 2026.W43
ck('deep pass is due when nothing has been recorded', P.planDeepRefreshDue_(props, wed) === true);
P.markPlanDeepRefreshDone_(props, wed);
ck('the mark stores the ISO week label', props.store.PS_PLAN_DEEP_REFRESH_WEEK === '2026.W42');
ck('not due again later the same week', P.planDeepRefreshDue_(props, thu) === false);
ck('due again on the first run of the next ISO week', P.planDeepRefreshDue_(props, nextMon) === true);
ck('a stale / hand-edited value counts as due',
   P.planDeepRefreshDue_(fakeProps({ PS_PLAN_DEEP_REFRESH_WEEK: '2026.W40' }), thu) === true);

// Fails CLOSED: an unreadable property store means a routine run, not a throw.
const broken = { getProperty: function () { throw new Error('quota'); } };
let threw = false, due = null;
try { due = P.planDeepRefreshDue_(broken, thu); } catch (e) { threw = true; }
ck('unreadable Script Properties → routine run, no throw', !threw && due === false);

// ── 3. The export wires the deep pass in, and restores the override ──────────
const body = src.slice(src.indexOf('function fetchTempoPlannedTime()'));
const fn = body.slice(0, body.indexOf('\nfunction ', 10));
ck('fetchTempoPlannedTime decides the depth from planDeepRefreshDue_', /planDeepRefreshDue_\(\)/.test(fn));
ck('fetchTempoPlannedTime marks the week only after the write',
   fn.indexOf('markPlanDeepRefreshDone_()') > fn.indexOf('writeRows_(sheet'));
ck('fetchTempoPlannedTime restores PLAN_BACKFILL_WEEKS_ in a finally',
   /finally\s*\{[^}]*PLAN_BACKFILL_WEEKS_ = null/.test(fn));
ck('the guard is still the first statement',
   fn.split(/\r?\n/).slice(1).find(l => l.trim() && !/^\s*\/\//.test(l)).indexOf('requireMaintainer_') >= 0);

const refresh = src.slice(src.indexOf('function refreshPlanHistory()'));
ck('refreshPlanHistory reads its depth from PS_PLAN_REFRESH_WEEKS',
   /PLAN_REFRESH_WEEKS_PROP_/.test(refresh.slice(0, refresh.indexOf('\nfunction ', 10))));
ck('refreshPlanHistory goes through runPlanRefresh_ (override restored on throw)',
   /runPlanRefresh_\(weeksBack/.test(refresh.slice(0, refresh.indexOf('\nfunction ', 10))));

// ── 4. The merge replaces a refreshed week, keeps a frozen one ───────────────
// Stored grid = what the sheet held for the W37 case; fetched = what Tempo now
// says. W37 inside the refresh window: HLM-39 8 → 10, VEEV appears (4), ADBE
// still 4. W36 outside the window: untouched.
const stored = {
  'Tyler|||COE-10 HLM|||HLM-39':  { worker: 'Tyler', team: 'CA', project: 'COE-10 HLM',  projectKey: 'HLM',  pm: '', issue: 'HLM-39', weeks: { '2026.W36': 10, '2026.W37': 8 } },
  'Tyler|||COE-08 JHI|||JHI-19':  { worker: 'Tyler', team: 'CA', project: 'COE-08 JHI',  projectKey: 'JHI',  pm: '', issue: 'JHI-19', weeks: { '2026.W37': 6 } },
  'Tyler|||COE-00 ADBE|||':       { worker: 'Tyler', team: 'CA', project: 'COE-00 ADBE', projectKey: 'ADBE', pm: '', issue: '',       weeks: { '2026.W37': 4 } },
  'Tyler|||COE-05 OLD|||OLD-1':   { worker: 'Tyler', team: 'CA', project: 'COE-05 OLD',  projectKey: 'OLD',  pm: '', issue: 'OLD-1',  weeks: { '2026.W37': 3 } },
};
const fetched = {
  'Tyler|||COE-10 HLM|||HLM-39':  { worker: 'Tyler', team: 'CA', project: 'COE-10 HLM',  projectKey: 'HLM',  pm: '', issue: 'HLM-39', weeks: { '2026.W37': 10, '2026.W38': 10 } },
  'Tyler|||COE-08 JHI|||JHI-19':  { worker: 'Tyler', team: 'CA', project: 'COE-08 JHI',  projectKey: 'JHI',  pm: '', issue: 'JHI-19', weeks: { '2026.W37': 6,  '2026.W38': 0 } },
  'Tyler|||COE-00 ADBE|||':       { worker: 'Tyler', team: 'CA', project: 'COE-00 ADBE', projectKey: 'ADBE', pm: '', issue: '',       weeks: { '2026.W37': 4,  '2026.W38': 0 } },
  'Tyler|||COE-10 VEEV|||':       { worker: 'Tyler', team: 'CA', project: 'COE-10 VEEV', projectKey: 'VEEV', pm: '', issue: '',       weeks: { '2026.W37': 4,  '2026.W38': 0 } },
};
const merged = P.mergePlanGrid_(stored, fetched, ['2026.W37', '2026.W38'], '2026.W30');
const row = key => merged.rows.find(r => r.key === key);
ck('refreshed week takes the fetched value (HLM-39 8 → 10)', row('Tyler|||COE-10 HLM|||HLM-39').weeks['2026.W37'] === 10);
ck('frozen week keeps the stored value (HLM-39 W36 = 10)', row('Tyler|||COE-10 HLM|||HLM-39').weeks['2026.W36'] === 10);
ck('a plan added after the freeze appears (VEEV W37 = 4)', row('Tyler|||COE-10 VEEV|||').weeks['2026.W37'] === 4);
ck('a plan deleted in Tempo drops to 0 inside the window, and its all-zero row goes',
   !row('Tyler|||COE-05 OLD|||OLD-1'));
const w37Total = merged.rows.reduce((s, r) => s + (r.weeks['2026.W37'] || 0), 0);
ck('W37 total now matches Tempo (24 hrs)', w37Total === 24, 'got ' + w37Total);

console.log(`plan-export-refresh-checks: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
