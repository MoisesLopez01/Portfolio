// Node checks for the usage-analytics feature (2026-09-01).
//
// Covers the rules that are easy to break silently:
//   1. Week windows cross ISO year boundaries correctly (52- vs 53-week years).
//   2. Denied rows count as demand, never as engagement.
//   3. The eligible audience honours the same auto-access policy the gate does.
//   4. logDashboardVisit_ can never break a page load; getUsageAnalytics is
//      superadmin-gated before it reads anything.
//
// Run: node "ps-dashboard/tests/usage-analytics-checks.js"
const fs   = require('fs');
const path = require('path');

const dir      = path.join(__dirname, '..');
const usage    = fs.readFileSync(path.join(dir, 'PS Usage.js'), 'utf8');
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const report   = fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name + (extra ? '\n     ' + extra : '')); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error('  ❌ ' + name + '\n     got:  ' + JSON.stringify(got) +
                         '\n     want: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
function extract(src, startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) { console.error('❌ could not find: ' + startsWith); process.exit(1); }
  const j = src.indexOf(endsWith, i);
  if (j < 0) { console.error('❌ could not close: ' + startsWith); process.exit(1); }
  return src.slice(i, j + endsWith.length);
}

// ── Harness ──────────────────────────────────────────────────────────────────
const Logger = { log: () => {} };
const props  = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }),
};
let ROSTER_ROWS = [];
function _readRosterForAccess_() { return { ok: true, rows: ROSTER_ROWS, tab: 'Data', error: null }; }

const secSlice = [
  extract(security, 'const SEC_ = {', '\n};'),
  extract(security, 'function _normName_', '\n}'),
  extract(security, 'function _autoAccessAllows_', '\n}'),
  extract(security, 'function _readAccessLists_', '\n}'),
].join('\n');
const repSlice = [
  extract(report, 'function isoWeekNum_PS_', '\n}'),
  extract(report, 'function isoWeekYear_PS_', '\n}'),
  extract(report, 'function weeksInYear_PS_', '\n}'),
].join('\n');
const usageSlice = [
  extract(usage, 'const USAGE_LOG_SHEET_', ';'),
  extract(usage, 'const USAGE_LOG_HEADERS_', ';'),
  extract(usage, 'const USAGE_WEEKS_', ';'),
  extract(usage, 'function usageWeekLabel_', '\n}'),
  extract(usage, 'function usageWeeksInYear_', '\n}'),
  extract(usage, 'function usageWeekWindow_', '\n}'),
  extract(usage, 'function computeUsageRollup_', '\n}'),
  extract(usage, 'function usageEligibleSet_', '\n}'),
].join('\n');

// eslint-disable-next-line no-eval
const api = eval('(function(){' + secSlice + '\n' + repSlice + '\n' + usageSlice +
  '\nreturn { SEC_, usageWeekLabel_, usageWeeksInYear_, usageWeekWindow_, computeUsageRollup_,' +
  ' usageEligibleSet_, _readAccessLists_, _autoAccessAllows_, USAGE_WEEKS_, weeksInYear_PS_ };})()');

function reset() {
  Object.keys(props).forEach(k => delete props[k]);
  ROSTER_ROWS = [];
}

// ── 1. Week labels and windows ───────────────────────────────────────────────
const LABEL_RE = /^\d{4}\.W\d{1,2}$/;
ck('usageWeekLabel_ format', LABEL_RE.test(api.usageWeekLabel_(new Date(Date.UTC(2026, 8, 1)))));
eq('2026-09-01 is 2026.W36', api.usageWeekLabel_(new Date(Date.UTC(2026, 8, 1))), '2026.W36');
eq('window is USAGE_WEEKS_ long, oldest first, ending at currentWeek',
   [api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_).length,
    api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_)[0],
    api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_)[api.USAGE_WEEKS_ - 1]],
   [13, '2026.W24', '2026.W36']);
// ISO year boundary: 2025 has 52 ISO weeks (Jan 1 2025 = Wednesday).
eq('window crosses the year boundary at W52',
   api.usageWeekWindow_('2026.W2', 4), ['2025.W51', '2025.W52', '2026.W1', '2026.W2']);
eq('weeksInYear 2025', api.usageWeeksInYear_(2025), 52);
eq('weeksInYear 2026 (long ISO year)', api.usageWeeksInYear_(2026), 53);
// Regression: weeksInYear_PS_ (report file) must agree with the ISO calendar
// in EVERY timezone — it used to return 52 for the 53-week year 2026 in
// negative-UTC-offset zones (Date.UTC construction read via local getters).
eq('weeksInYear_PS_ handles a 53-week ISO year', api.weeksInYear_PS_(2026), 53);
eq('weeksInYear_PS_ handles a 52-week ISO year', api.weeksInYear_PS_(2025), 52);
ck('every window label is well-formed',
   api.usageWeekWindow_('2026.W36', 13).every(w => LABEL_RE.test(w)));
eq('garbage currentWeek yields an empty window', api.usageWeekWindow_('nonsense', 13), []);

// ── 2. Rollup math ───────────────────────────────────────────────────────────
// Fixture: current week 2026.W36; eligible a + b; c denied; d not eligible;
// one blank-email row; b's only visit is outside the 13-week window.
const ELIGIBLE = {
  'a@x.com': { email: 'a@x.com', name: 'A Person', role: 'manager',    source: 'auto-manager' },
  'b@x.com': { email: 'b@x.com', name: 'B Person', role: 'superadmin', source: 'list' },
};
const ROWS = [
  { ts: '2026-08-31T08:00:00Z', week: '2026.W36', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-09-01T09:00:00Z', week: '2026.W36', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-08-24T09:00:00Z', week: '2026.W35', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-09-01T10:00:00Z', week: '2026.W36', email: 'c@x.com', role: 'denied',     allowed: false },
  { ts: '2026-09-01T11:00:00Z', week: '2026.W36', email: '',        role: 'viewer',     allowed: true  },
  { ts: '2026-09-01T12:00:00Z', week: '2026.W36', email: 'd@x.com', role: 'viewer',     allowed: true  },
  { ts: '2026-01-05T08:00:00Z', week: '2026.W2',  email: 'b@x.com', role: 'superadmin', allowed: true  },
];
const R = api.computeUsageRollup_(ROWS, ELIGIBLE, '2026.W36');
const w36 = R.weeks[R.weeks.length - 1];

eq('13 weeks, oldest first, current last',
   [R.weeks.length, R.weeks[0].week, w36.week], [13, '2026.W24', '2026.W36']);
eq('uniques: a + d, never blank or denied', w36.uniqueVisitors, 2);
eq('total loads counts everything incl. denied and blank-email rows', w36.totalLoads, 5);
eq('denied counted separately', w36.denied, 1);
eq('byRole counts allowed identified loads only', w36.byRole, { manager: 2, viewer: 1 });
const RD = api.computeUsageRollup_(
  [{ ts: '2026-09-01T08:00:00Z', week: '2026.W36', email: '', role: 'denied', allowed: false }],
  ELIGIBLE, '2026.W36');
eq('a blank-email denied hit still counts as denied + a load',
   [RD.weeks[RD.weeks.length - 1].denied, RD.weeks[RD.weeks.length - 1].totalLoads], [1, 1]);
const pa = R.people.find(p => p.email === 'a@x.com');
const pb = R.people.find(p => p.email === 'b@x.com');
eq('a: 2 this week, 3 in last 4 weeks', [pa.visitsThisWeek, pa.visits4Weeks], [2, 3]);
eq('a lastSeen is the newest visit', pa.lastSeen, '2026-09-01T09:00:00.000Z');
eq('b visited outside the window: ever=true, thisWeek=0',
   [pb.everVisited, pb.visitsThisWeek, pb.visits4Weeks], [true, 0, 0]);
eq('coverage: 1 of 2 engaged this week', R.coverage, { engagedThisWeek: 1, eligibleTotal: 2, pct: 50 });
eq('d lands in otherVisitors', R.otherVisitors.map(v => v.email), ['d@x.com']);
ck('a denied email never becomes a visitor',
   R.otherVisitors.every(v => v.email !== 'c@x.com') && !R.people.some(p => p.email === 'c@x.com'));

// Empty log = honest day-one picture, not an error.
const E = api.computeUsageRollup_([], ELIGIBLE, '2026.W36');
ck('empty log is ok:true', E.ok === true);
eq('empty log: all weeks zero', E.weeks.every(w => w.totalLoads === 0), true);
eq('empty log: everyone never-visited', E.people.every(p => !p.everVisited), true);
eq('empty log coverage 0%', E.coverage.pct, 0);

// ── 3. Eligible audience ─────────────────────────────────────────────────────
// Must mirror the real gate: list members + auto-managers the CURRENT policy
// admits — never someone the policy would turn away at the door.
function rrow(name, email, sup, extra) {
  const r = { name, normName: name.toLowerCase(), email,
              supervisor: sup, normSupervisor: (sup || '').toLowerCase(),
              cls: 'Professional Services', dept: 'Services', jobTitle: 'x',
              status: '', active: true, onLeave: false };
  return Object.assign(r, extra || {});
}
reset();
ROSTER_ROWS = [
  rrow('Gon Director', 'gon@x.com', ''),
  rrow('Mgr One',      'm1@x.com',  'Gon Director'),
  rrow('IC A',         'ica@x.com', 'Mgr One'),
  rrow('Away Boss',    'away@x.com', '', { onLeave: true, status: 'Maternity Leave' }),
  rrow('Away Report',  'ar@x.com',  'Away Boss'),
  rrow('Fin Boss',     'fin@x.com', '', { cls: 'Finance' }),
  rrow('Fin Report',   'fr@x.com',  'Fin Boss', { cls: 'Finance' }),
];
props['PS_DASH_VIEWERS']   = 'guest@x.com';
props['PS_DASH_DELEGATES'] = 'peer@x.com:Gon Director';   // format: "email:Supervisor Full Name" per line
let EL = api.usageEligibleSet_();
ck('supervisors with active reports are eligible as auto-managers',
   EL['gon@x.com'] && EL['gon@x.com'].source === 'auto-manager' && EL['gon@x.com'].role === 'manager');
ck('a mid-level manager is eligible too', !!EL['m1@x.com']);
ck('an IC with no reports is NOT eligible', !EL['ica@x.com']);
ck('on-leave supervisor withheld (ALLOW_ONLEAVE_MANAGER=false)', !EL['away@x.com']);
ck('viewer-list member is eligible with role viewer',
   EL['guest@x.com'] && EL['guest@x.com'].role === 'viewer' && EL['guest@x.com'].source === 'list');
ck('delegate is eligible with role manager',
   EL['peer@x.com'] && EL['peer@x.com'].role === 'manager' && EL['peer@x.com'].source === 'list');
ck('bootstrap super admin is always eligible',
   EL[api.SEC_.BOOTSTRAP_ADMIN.toLowerCase()] &&
   EL[api.SEC_.BOOTSTRAP_ADMIN.toLowerCase()].role === 'superadmin');
ck('any-org mode: a Finance supervisor IS eligible', !!EL['fin@x.com']);

// "classes" mode: the Finance supervisor is now outside the policy scope.
const saved = api.SEC_.MANAGER_AUTO_ACCESS;
api.SEC_.MANAGER_AUTO_ACCESS = 'classes';
EL = api.usageEligibleSet_();
ck('classes mode: Finance supervisor is NOT expected', !EL['fin@x.com']);
ck('classes mode: the PS supervisor still is', !!EL['gon@x.com']);
api.SEC_.MANAGER_AUTO_ACCESS = 'off';
EL = api.usageEligibleSet_();
ck('off mode: no auto-managers at all, lists only', !EL['gon@x.com'] && !!EL['guest@x.com']);
api.SEC_.MANAGER_AUTO_ACCESS = saved;

// A supervisor who is ALSO listed keeps the LIST role (mirrors resolution order).
props['PS_DASH_SUPER_ADMINS'] = 'gon@x.com';
EL = api.usageEligibleSet_();
eq('list tier wins over auto-manager', [EL['gon@x.com'].role, EL['gon@x.com'].source],
   ['superadmin', 'list']);
delete props['PS_DASH_SUPER_ADMINS'];

// ── 4. Capture never breaks a page load ─────────────────────────────────────
// logDashboardVisit_ is evaluated with GAS stubs; a throwing SpreadsheetApp and
// a busy lock must both be swallowed, and a healthy write must produce one row
// with a well-formed week label.
const logSlice = extract(usage, 'function logDashboardVisit_', '\n}');
// The eval'd body resolves SpreadsheetApp/LockService to these PARAMETERS —
// pass the stubs explicitly; block-scoped consts at the call site would NOT
// be visible inside this function's eval.
function evalLogger(SpreadsheetApp, LockService) {   // eslint-disable-line no-unused-vars
  // eslint-disable-next-line no-eval
  return eval('(function(){' + repSlice + '\n' +
    extract(usage, 'const USAGE_LOG_SHEET_', ';') + '\n' +
    extract(usage, 'const USAGE_LOG_HEADERS_', ';') + '\n' +
    'function usageWeekLabel_(d){return isoWeekYear_PS_(d)+".W"+isoWeekNum_PS_(d);}\n' +
    logSlice + '\nreturn logDashboardVisit_;})()');
}
const APPENDED = [];
const okSheet = { appendRow: r => { APPENDED.push(r); }, setFrozenRows: () => {} };
const okSS = {
  getActiveSpreadsheet: () => ({ getSheetByName: () => okSheet, insertSheet: () => okSheet }),
};
const badSS   = { getActiveSpreadsheet: () => { throw new Error('boom'); } };
const okLock   = { getScriptLock: () => ({ tryLock: () => true,  releaseLock: () => {} }) };
const busyLock = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };

{
  const fn = evalLogger(okSS, okLock);
  fn({ allowed: true, email: 'a@x.com', role: 'manager', delegateScopeName: 'Gon Director' });
  fn({ allowed: false, email: 'x@x.com', role: 'denied' });
  eq('two rows appended', APPENDED.length, 2);
  eq('allowed row: email/role/allowed/scope', APPENDED[0].slice(2),
     ['a@x.com', 'manager', true, 'Gon Director']);
  eq('denied row records the denial', APPENDED[1].slice(2), ['x@x.com', 'denied', false, '']);
  ck('week cell is well-formed', LABEL_RE.test(APPENDED[0][1]));
}
{
  let threw = false;
  try { evalLogger(badSS, okLock)({ allowed: true, email: 'a@x.com', role: 'admin' }); }
  catch (e) { threw = true; }
  ck('a throwing SpreadsheetApp is swallowed — the page load survives', !threw);
}
{
  const before = APPENDED.length;
  let threw = false;
  try { evalLogger(okSS, busyLock)({ allowed: true, email: 'a@x.com', role: 'admin' }); }
  catch (e) { threw = true; }
  ck('a busy lock skips the row without throwing', !threw && APPENDED.length === before);
}

// ── 5. Wiring and gates (source checks) ─────────────────────────────────────
ck('doGet logs the visit BEFORE the denied branch',
   /function doGet\([\s\S]{0,200}?logDashboardVisit_\(access\)[\s\S]{0,200}?if \(!access\.allowed\)/.test(report));
ck('getUsageAnalytics is gated superadmin before any read',
   /function getUsageAnalytics\(\)[\s\S]{0,300}?checkDashboardAccess\(\)[\s\S]{0,200}?isSuperAdmin_\(access\)[\s\S]*?SpreadsheetApp/.test(usage));
ck('the gate throws rather than returning quietly',
   /isSuperAdmin_\(access\)\) \{\s*\n\s*throw new Error/.test(usage));
ck('logDashboardVisit_ body is one big try/catch',
   /function logDashboardVisit_\(access\) \{\s*\n\s*try \{/.test(usage) &&
   / catch \(e\) \{\s*\n\s*Logger\.log\("⚠️ \[PS Usage\]/.test(logSlice));
ck('only doGet calls the logger — exactly one call site in the report file',
   (report.match(/logDashboardVisit_\(/g) || []).length === 1 &&
   !/logDashboardVisit_/.test(extract(report, 'function warmReportCache', '\n}')));
ck('SEC_.BUILD was bumped for this change', /BUILD:\s*"2026\.W36-usage"/.test(security));

// ── 6. Frontend wiring (source checks) ───────────────────────────────────────
const html = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');
ck('VIEWS has a superadmin-only usage entry, hidden under 👁 View as',
   /id: "usage"[^\n]*roles: \["superadmin"\][^\n]*hideInPreview: true/.test(html));
ck('the pane exists', /<div id="tabUsage" class="tab-pane">/.test(html));
ck('RENDERERS dispatches usage → renderUsageTab_', /usage:\s*function\(\) \{ renderUsageTab_\(\); \}/.test(html));
ck('the tab lazy-loads via getUsageAnalytics', /\.getUsageAnalytics\(\);/.test(html));
ck('STATE caches the result per session', /usageData:\s*null/.test(html));
ck('transparency copy appears in BOTH surfaces (footer + Data Reference)',
   (html.match(/Page visits are logged \(who and when\) to measure adoption/g) || []).length >= 2);

console.log(fail === 0
  ? '✅ usage-analytics-checks: ' + pass + ' checks passed'
  : '❌ usage-analytics-checks: ' + fail + ' of ' + (pass + fail) + ' checks FAILED');
process.exit(fail === 0 ? 0 : 1);
