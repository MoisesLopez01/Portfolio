// Node checks for the Performance Record "8 weeks" table clarity wave (2026.W42):
// the score row with its points-by-measure bar and pinnable breakdown, goals as
// "meeting the rules / all goals", kudos as "given / received", full-week hours
// (project + NetSuite PTO + public holidays, capped at the standard week), the
// keep-open help bubble, and the Supervisor filter dropping the supervisor's
// own row. Run: node "ps-dashboard/tests/perf-record-8w-clarity-checks.js"
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const lf = (s) => s.split('\r\n').join('\n');
const html = lf(fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8'));
const server = lf(fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function fnSource(src, name) {
  const m = new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n').exec(src);
  return m ? m[0] : '';
}
function varSource(src, name) {
  const m = new RegExp('\\nvar ' + name + '\\s*= [^\\n]*\\n').exec(src);
  return m ? m[0] : '';
}
const engStart = html.indexOf('⟦PERF-ENGINE-START⟧'), engEnd = html.indexOf('⟦PERF-ENGINE-END⟧');
const engine = html.slice(engStart, engEnd);

// ── Pure helpers live inside the engine ──────────────────────────────────────
['perfScorePartsFromRows_', 'perfGoalsWeekCell_', 'perfKudosCell_', 'perfHoursCell_', 'perfPts_'].forEach(name => {
  ck(`${name} is defined inside the engine region`, fnSource(engine, name).length > 0);
});
ck('PERF_PART_COLORS / ORDER / LABELS live in the engine', /var PERF_PART_COLORS = /.test(engine) && /var PERF_PART_ORDER  = /.test(engine) && /var PERF_PART_LABELS = /.test(engine));
ck('perfScoreParts_ (page wrapper) lives outside the engine', fnSource(html, 'perfScoreParts_').length > 0 && fnSource(engine, 'perfScoreParts_').length === 0);
['DATA', 'STATE', 'document', 'window'].forEach(g => {
  ck(`engine helpers never touch ${g}`, !new RegExp('\\b' + g + '\\b').test(
    fnSource(engine, 'perfScorePartsFromRows_') + fnSource(engine, 'perfGoalsWeekCell_') + fnSource(engine, 'perfKudosCell_') + fnSource(engine, 'perfHoursCell_')));
});

const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  varSource(engine, 'PERF_PART_COLORS') + varSource(engine, 'PERF_PART_ORDER') + varSource(engine, 'PERF_PART_LABELS') +
  fnSource(engine, 'perfPts_') + fnSource(engine, 'perfWeekIsEmpty_') + fnSource(engine, 'perfFmtHrs_') +
  fnSource(engine, 'perfScorePartsFromRows_') + fnSource(engine, 'perfGoalsWeekCell_') + fnSource(engine, 'perfKudosCell_') + fnSource(engine, 'perfHoursCell_'), ctx);
const run = (code) => vm.runInContext(code, ctx);

// ── Goals cell: goals meeting the rules / all goals ──────────────────────────
const gc = (gd, ok) => run('perfGoalsWeekCell_(' + JSON.stringify(gd) + ', ' + ok + ')');
ck('goals: up to date reads "6 / 8 · up to date"', JSON.stringify(gc({ totalGoals: 8, qualifying: 6, rule: null, threshold: 6 }, true)) === JSON.stringify({ t: '6 / 8', sub: 'up to date' }));
ck('goals: rule 3 miss names the comment bar', JSON.stringify(gc({ totalGoals: 8, qualifying: 3, rule: 3, threshold: 6 }, false)) === JSON.stringify({ t: '3 / 8', sub: 'needs 6 with comments' }));
ck('goals: rule 1 miss names the goal count', JSON.stringify(gc({ totalGoals: 5, qualifying: 2, rule: 1, required: 8 }, false)) === JSON.stringify({ t: '2 / 5', sub: 'needs 8 goals' }));
ck('goals: rule 2 miss says most not in progress', gc({ totalGoals: 8, qualifying: 7, rule: 2 }, false).sub === 'most not in progress');
ck('goals: override reads all goals over all goals', JSON.stringify(gc({ totalGoals: 8, qualifying: 2, overrideCompliant: true, allGoalsCompleted: true }, true)) === JSON.stringify({ t: '8 / 8', sub: 'all completed' }));
ck('goals: PTO-exempt week says so', gc({ totalGoals: 8, qualifying: 1, ptoExempt: true, rule: null }, true).sub === 'PTO week');
ck('goals: no goals in the writing weeks', JSON.stringify(gc({ totalGoals: 0, qualifying: 0, inWritingRamp: true }, true)) === JSON.stringify({ t: '0 goals', sub: 'writing weeks' }));
ck('goals: qualifying never exceeds the total', gc({ totalGoals: 8, qualifying: 11, rule: null }, true).t === '8 / 8');
ck('goals: a payload without counts falls back to the words', JSON.stringify(gc({ compliant: false }, false)) === JSON.stringify({ t: 'Behind', sub: '' }) && gc(null, true).t === 'Up to date');

// ── Kudos cell: given over received ──────────────────────────────────────────
ck('kudos: "1 given" over "2 received"', JSON.stringify(run('perfKudosCell_({ recv: 2, gave: 1 })')) === JSON.stringify({ t: '1 given', sub: '2 received' }));
ck('kudos: null reads 0 given / 0 received', JSON.stringify(run('perfKudosCell_(null)')) === JSON.stringify({ t: '0 given', sub: '0 received' }));

// ── Score parts: points by measure, averaged so they add up to the score ─────
const rows = [
  { pts: { goals: { got: 30, max: 30 }, tracked: { got: 24, max: 30 }, planned: { got: 20, max: 20 }, kudos: { got: 0, max: 5 }, rcr: { got: 15, max: 15 } }, trackedHrs: 30, plannedHrs: 40, ptoNorm: 1, goalsHasData: true, kudosCount: 0, kudosGivenCount: 0 },
  { pts: { goals: { got: 0, max: 30 }, tracked: { got: 30, max: 30 }, planned: { got: 20, max: 20 }, kudos: { got: 5, max: 5 }, rcr: { got: 15, max: 15 } }, trackedHrs: 36, plannedHrs: 40, ptoNorm: 1, goalsHasData: true, kudosCount: 1, kudosGivenCount: 1 },
  null,
  { pts: {}, trackedHrs: null, plannedHrs: null, ptoNorm: null, goalsHasData: false, kudosCount: 0, kudosGivenCount: 0 },
];
const parts = run('perfScorePartsFromRows_(' + JSON.stringify(rows) + ')');
ck('score parts: empty and null weeks are left out', parts.weeks === 2);
ck('score parts: measures come in the fixed order', parts.parts.map(p => p.id).join(',') === 'goals,tracked,planned,kudos,rcr');
ck('score parts: goals average 15 of 30', parts.parts[0].got === 15 && parts.parts[0].max === 30);
ck('score parts: the parts add up to the average score', Math.round(parts.parts.reduce((s, p) => s + p.got, 0)) === Math.round((89 + 70) / 2));
ck('score parts: no rows → no parts', JSON.stringify(run('perfScorePartsFromRows_([])')) === JSON.stringify({ weeks: 0, parts: [] }));
ck('perfPts_ prints whole numbers whole, else one decimal', run('perfPts_(30)') === '30' && run('perfPts_(24.83)') === '24.8');

// ── Hours cell: full-week hours with the make-up underneath ──────────────────
const hc = (a, kind) => run('perfHoursCell_(' + JSON.stringify(a) + ', "' + kind + '")');
const fullWeek = { weeks: 1, plannedHrs: 24, plannedFullHrs: 40, trackedHrs: 20, trackedFullHrs: 36, timeOffHrs: 16, holidayHrs: 0, capacityHrs: 40, plannedRawHrs: 24, trackedRawHrs: 20 };
ck('hours: planned prints the full-week total with the split "24 h work · 16 h PTO"', JSON.stringify({ t: hc(fullWeek, 'planned').t, sub: hc(fullWeek, 'planned').sub }) === JSON.stringify({ t: '40 h', sub: '24 h work · 16 h PTO' }));
const owner = { weeks: 1, plannedHrs: 23, plannedFullHrs: 39, trackedHrs: 23, trackedFullHrs: 39, timeOffHrs: 16, holidayHrs: 0, capacityHrs: 40, plannedRawHrs: 23, trackedRawHrs: 23 };
ck('hours: the owner\'s case — 23 h work + 16 h PTO reads 39 h · 23 h work · 16 h PTO', hc(owner, 'planned').t === '39 h' && hc(owner, 'planned').sub === '23 h work · 16 h PTO');
ck('hours: no time off → no split line', hc({ weeks: 1, plannedHrs: 30, plannedFullHrs: 30, trackedHrs: 28, trackedFullHrs: 28, timeOffHrs: 0, holidayHrs: 0, capacityHrs: 40 }, 'planned').sub === '');
ck('hours: the note names the make-up and the cap', /Planned 40 h = 24 h on projects \+ 16 h PTO \(NetSuite record\) · capped at the 40 h week/.test(hc(fullWeek, 'planned').note));
ck('hours: logged prints its own total', hc(fullWeek, 'tracked').t === '36 h' && /Logged 36 h = 20 h on projects/.test(hc(fullWeek, 'tracked').note));
const holiday = { weeks: 1, plannedHrs: 32, plannedFullHrs: 40, trackedHrs: 30, trackedFullHrs: 38, timeOffHrs: 0, holidayHrs: 8, capacityHrs: 40, plannedRawHrs: 32, trackedRawHrs: 30 };
ck('hours: a public holiday shows in the split', hc(holiday, 'planned').sub === '32 h work · 8 h holiday' && /\+ 8 h public holiday/.test(hc(holiday, 'planned').note));
const capped = { weeks: 1, plannedHrs: 40, plannedFullHrs: 40, trackedHrs: 52, trackedFullHrs: 52, timeOffHrs: 0, holidayHrs: 0, capacityHrs: 40, plannedRawHrs: 56, trackedRawHrs: 52 };
ck('hours: a capped planned total names the Tempo figure and the known causes', /Tempo as exported: 56 h \(cancelled PTO still in Tempo, or duplicated entries/.test(hc(capped, 'planned').note));
ck('hours: logged is never capped — 52 h prints as 52 h and says so', hc(capped, 'tracked').t === '52 h' && /never capped: hours above the week are real/.test(hc(capped, 'tracked').note) && !/Tempo as exported/.test(hc(capped, 'tracked').note));
ck('hours: logged note never claims a cap', !/capped at the/.test(hc(fullWeek, 'tracked').note));
const swapped = { weeks: 1, plannedHrs: 30, plannedFullHrs: 30, trackedHrs: 44, trackedFullHrs: 36, timeOffHrs: 0, holidayHrs: 0, capacityHrs: 40, plannedRawHrs: 30, trackedRawHrs: 44 };
ck('hours: logged below the Tempo figure names cancelled PTO still logged as the usual cause', /Tempo as exported: 44 h \(PTO cancelled in NetSuite but still logged in Tempo is the usual cause\)/.test(hc(swapped, 'tracked').note));
ck('hours: an uncapped total does not mention the Tempo figure', !/Tempo as exported/.test(hc(fullWeek, 'planned').note));
const anz = { weeks: 1, plannedHrs: 30, plannedFullHrs: 38, trackedHrs: 30, trackedFullHrs: 38, timeOffHrs: 8, holidayHrs: 0, capacityHrs: 38, plannedRawHrs: 30, trackedRawHrs: 30 };
ck('hours: an ANZ week is capped at 38 h', /capped at the 38 h week/.test(hc(anz, 'planned').note));
const month = { weeks: 4, plannedHrs: 120, plannedFullHrs: 152, trackedHrs: 110, trackedFullHrs: 142, timeOffHrs: 32, holidayHrs: 0, capacityHrs: 160, plannedRawHrs: 120, trackedRawHrs: 110 };
ck('hours: a planned month says each week is capped, not the sum', /each week capped at the standard week \(40 h, 38 h in Australia & New Zealand\)/.test(hc(month, 'planned').note) && !/capped at the 160 h/.test(hc(month, 'planned').note));
ck('hours: a logged month never claims a cap', !/capped at the/.test(hc(month, 'tracked').note) && /never capped/.test(hc(month, 'tracked').note));
const legacy = { weeks: 1, plannedHrs: 24, trackedHrs: 20 };
ck('hours: a payload without full-week fields falls back to the project hours, no note', JSON.stringify(hc(legacy, 'planned')) === JSON.stringify({ t: '24 h', sub: '', note: '' }));
ck('hours: no data stays a dash', hc({ weeks: 1, plannedHrs: null, trackedHrs: null }, 'tracked').t === '—');

// ── Server: full-week hours (fullWeekHours_, weeklyCapacityHrs_, phHoursForWeek_) ─
const sctx = { CONFIG_PS: { WEEKLY_CAPACITY_HRS: 40, ANZ_LOCATION: 'Australia & New Zealand', ANZ_CAPACITY_HRS: 38 } };
vm.createContext(sctx);
vm.runInContext(fnSource(server, 'weeklyCapacityHrs_') + fnSource(server, 'phHoursForWeek_') + fnSource(server, 'fullWeekHours_'), sctx);
const srun = (code) => vm.runInContext(code, sctx);
ck('capacity: ANZ is 38 h, everywhere else 40 h, blank 40 h', srun('weeklyCapacityHrs_("Australia & New Zealand")') === 38 && srun('weeklyCapacityHrs_("New Zealand")') === 38 && srun('weeklyCapacityHrs_("Malaysia")') === 40 && srun('weeklyCapacityHrs_("")') === 40);
const phWeek = { entries: [{ date: '2026-08-31', location: 'Malaysia', holiday: 'Merdeka', affectedNames: ['Ana Reyes'] }, { date: '2026-08-31', location: 'Singapore', holiday: 'X', affectedNames: ['Ana Reyes'] }, { date: '2026-09-01', location: 'Malaysia', holiday: 'Y', affectedNames: ['Ana Reyes', 'Ben'] }] };
ck('holidays: one fifth of the week per distinct date for the person', srun('phHoursForWeek_(' + JSON.stringify(phWeek) + ', "Ana Reyes", 40)') === 16 && srun('phHoursForWeek_(' + JSON.stringify(phWeek) + ', "Ben", 38)') === 7.6);
ck('holidays: nobody / no week → 0', srun('phHoursForWeek_(' + JSON.stringify(phWeek) + ', "Zed", 40)') === 0 && srun('phHoursForWeek_(null, "Ana Reyes", 40)') === 0);
const fw = (x) => srun('fullWeekHours_(' + JSON.stringify(x) + ')');
const base = { capacityHrs: 40, plannedProjectHrs: 24, plannedRawHrs: 32, trackedRawHrs: 28, trackedTimeOffHrs: 8, ledgerPtoHrs: 16, holidayHrs: 0, isFuture: false };
let r = fw(base);
ck('full week: planned = project + PTO, capped', r.plannedFullHrs === 40 && r.timeOffHrs === 16 && r.capacityHrs === 40);
ck('full week: logged swaps Tempo time-off for the NetSuite PTO (28 − 8 + 16 = 36)', r.trackedFullHrs === 36);
ck('full week: raw figures ride along', r.plannedRawHrs === 32 && r.trackedRawHrs === 28);
r = fw(Object.assign({}, base, { capacityHrs: 38, plannedProjectHrs: 30, ledgerPtoHrs: 8 }));
ck('full week: ANZ caps at 38', r.plannedFullHrs === 38);
r = fw(Object.assign({}, base, { isFuture: true }));
ck('full week: a future week has no logged total', r.trackedFullHrs === null && r.plannedFullHrs === 40);
r = fw({ capacityHrs: 40, plannedProjectHrs: null, plannedRawHrs: null, trackedRawHrs: null, trackedTimeOffHrs: 0, ledgerPtoHrs: 0, holidayHrs: 0, isFuture: false });
ck('full week: nothing at all stays null', r.plannedFullHrs === null && r.trackedFullHrs === null);
r = fw({ capacityHrs: 40, plannedProjectHrs: null, plannedRawHrs: null, trackedRawHrs: null, trackedTimeOffHrs: 0, ledgerPtoHrs: 40, holidayHrs: 0, isFuture: false });
ck('full week: a week fully on leave reads as a full week', r.plannedFullHrs === 40 && r.trackedFullHrs === 40);
r = fw(Object.assign({}, base, { ledgerPtoHrs: 0, holidayHrs: 8 }));
ck('full week: a public holiday counts like leave', r.plannedFullHrs === 32 && r.holidayHrs === 8);
r = fw({ capacityHrs: 40, plannedProjectHrs: 45, plannedRawHrs: 45, trackedRawHrs: 50, trackedTimeOffHrs: 0, ledgerPtoHrs: 0, holidayHrs: 0, isFuture: false });
ck('full week: planned is capped at the week, logged is NOT (50 h stays 50 h)', r.plannedFullHrs === 40 && r.trackedFullHrs === 50);
r = fw({ capacityHrs: 38, plannedProjectHrs: 30, plannedRawHrs: 30, trackedRawHrs: 42, trackedTimeOffHrs: 0, ledgerPtoHrs: 8, holidayHrs: 0, isFuture: false });
ck('full week: ANZ logged above 38 h stays above (42 + 8 = 50)', r.plannedFullHrs === 38 && r.trackedFullHrs === 50);
// ── Server: the PTO rule — Tempo NETSUITE rows never count, the ledger is the PTO ─
const pctx = { CONFIG_PS: { PTO_MIN_TARGET_HRS: 0, SCORE_PLANNED_CAP_HRS: 40 } };
vm.createContext(pctx);
vm.runInContext(fnSource(server, 'subtractPTOFromPlanned_'), pctx);
const sub = (plan, off, ledger) => vm.runInContext('subtractPTOFromPlanned_(' +
  JSON.stringify({ W: { byEmployee: plan, byEmployeeTimeOff: off, byEmployeeProjects: {} } }) + ', ' +
  JSON.stringify({ W: { byEmployee: ledger } }) + ')["W"]', pctx);
let o = sub({ a: 23 }, {}, { a: 16 });
ck('PTO rule: 23 h of pure work + 16 h ledger PTO stays 23 h of project plan (was 7 h)', o.byEmployee.a === 23 && o.ptoByEmployee.a === 16);
o = sub({ a: 39 }, { a: 16 }, { a: 16 });
ck('PTO rule: Tempo NETSUITE rows are dropped, not the ledger (39 − 16 Tempo = 23)', o.byEmployee.a === 23 && o.ptoByEmployee.a === 16);
o = sub({ a: 39 }, { a: 16 }, {});
ck('PTO rule: cancelled PTO still booked in Tempo never inflates the plan (39 → 23, no PTO)', o.byEmployee.a === 23 && o.ptoByEmployee.a === undefined);
o = sub({ a: 120 }, {}, {});
ck('PTO rule: the duplication clamp still holds (120 → 40)', o.byEmployee.a === 40 && o.totalHrs === 40 && o.headcount === 1);
o = sub({ a: 40 }, {}, { a: 16 });
ck('PTO rule: the plan is still clamped to the capacity left after PTO (40 → 24)', o.byEmployee.a === 24);
o = sub({}, {}, { b: 40 });
ck('PTO rule: a person on leave with no plan row gets their PTO, no plan entry', o.byEmployee.b === undefined && o.ptoByEmployee.b === 40 && o.headcount === 0);
ck('PTO rule: raw and time-off totals ride along for the card', o.byEmployeeRaw !== undefined && o.byEmployeeTimeOff !== undefined);
ck('planned sheet: a NETSUITE issue key counts as time off too', /upKey\.startsWith\(e \+ "-"\)/.test(server) && /\} else if \(excluded\) \{/.test(server));

ck('server: employee rows carry the full-week fields', /plannedFullHrs: fw \? fw\.plannedFullHrs : undefined,/.test(server) && /trackedFullHrs: fw \? fw\.trackedFullHrs : undefined,/.test(server) && /holidayHrs:\s+fw \? fw\.holidayHrs\s+: undefined,/.test(server));
ck('server: the planned sheet keeps the time-off rows apart and the raw totals', /byEmployeeTimeOff\[norm\] = \(b\.byEmployeeTimeOff\[norm\] \|\| 0\) \+ hrs;/.test(server) && /byEmployeeRaw:\s+src\.byEmployee \|\| \{\},/.test(server));
ck('server: CONFIG_PS carries the standard week and the ANZ week', /WEEKLY_CAPACITY_HRS:\s+40,/.test(server) && /ANZ_CAPACITY_HRS:\s+38,/.test(server) && /ANZ_LOCATION:\s+"Australia & New Zealand",/.test(server));

// ── Server: every goals verdict carries the counts ───────────────────────────
ck('goals verdicts: rule 1 with no goals carries qualifying/threshold/required', /compliant: false, rule: 1, totalGoals: 0, qualifying: 0, threshold, required: goalsRequired \}/.test(server));
ck('goals verdicts: rule 1 with too few goals carries the counts', /compliant: false, rule: 1, totalGoals, qualifying, threshold, required: goalsRequired \}/.test(server));
ck('goals verdicts: rule 2 carries the counts', /compliant: false, rule: 2, totalGoals, qualifying, threshold, required: goalsRequired, inProgressCount, inProgressNeeded \}/.test(server));
ck('goals verdicts: rule 3 carries required', /totalGoals, inProgressCount, inProgressNeeded, qualifying, threshold, reqCmt, qWeek, required: goalsRequired,/.test(server));
ck('goals verdicts: qualifying is computed before rule 1 decides', server.indexOf('const qualifying = goalIds.filter(id => {') < server.indexOf('// Rule 1: must have at least goalsRequired goals'));

// ── Supervisor filter: the supervisor's own row is out ───────────────────────
const fctx = { DATA: { employees: [
  { name: 'Carla Mendoza', supervisor: 'CEO' }, { name: 'Ana Reyes', supervisor: 'Carla Mendoza' },
  { name: 'Diego Ramos', supervisor: 'Ana Reyes' }, { name: 'Ewa Nowak', supervisor: 'Carla Mendoza' }, { name: 'Zed', supervisor: 'Someone Else' } ] } };
vm.createContext(fctx);
vm.runInContext(fnSource(html, 'resolveOrgTree_') + fnSource(html, 'orgScopeForSupervisor_'), fctx);
const scope = Array.from(vm.runInContext('orgScopeForSupervisor_("Carla Mendoza")', fctx)).sort();
ck('supervisor filter: the tree without the anchor', scope.join(',') === 'ana reyes,diego ramos,ewa nowak');
ck('supervisor filter: the unfiltered resolver still seeds with the anchor (other callers)', vm.runInContext('resolveOrgTree_("Carla Mendoza").has("carla mendoza")', fctx) === true);
ck('getFilteredEmployees uses the anchor-free scope', /var orgScope = sup \? orgScopeForSupervisor_\(sup\) : null;/.test(html));

// ── Score breakdown rides on computeRkScore ──────────────────────────────────
const rkctx = { SCORE_W: { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 }, isCrewEmp: () => false };
vm.createContext(rkctx);
vm.runInContext(fnSource(html, 'computeRkScore'), rkctx);
const emp = { weeks: { W: { trackedHrs: 27, plannedHrs: 30, ptoAdjustedTargetHrs: 40, goalsDetail: { compliant: true }, kudos: { count: 1, givenCount: 0 }, ptoHealth: { status: 'Good', balance: 60 }, plannedFullHrs: 38, trackedFullHrs: 35, timeOffHrs: 8, holidayHrs: 0, capacityHrs: 40 } }, rcr: { value: 2.5 } };
const rk = vm.runInContext('computeRkScore(' + JSON.stringify(emp) + ', "W")', rkctx);
ck('computeRkScore ships pts per measure that add up to the score', rk.pts && Math.round(Object.keys(rk.pts).reduce((s, k) => s + rk.pts[k].got, 0)) === rk.score);
ck('computeRkScore: max per measure is its weight share of 100', rk.pts.goals.max === 30 && rk.pts.kudos.max === 5 && rk.pts.rcr.max === 15);
ck('computeRkScore: measures outside the denominator are absent (si/pto at weight 0)', !rk.pts.si && !rk.pts.pto);
ck('computeRkScore carries the full-week fields', rk.plannedFullHrs === 38 && rk.trackedFullHrs === 35 && rk.timeOffHrs === 8 && rk.capacityHrs === 40);
ck('perfBucketAgg_ sums the full-week fields', /trackedFullHrs: sumOrNull\('trackedFullHrs'\),/.test(html) && /plannedFullHrs: sumOrNull\('plannedFullHrs'\),/.test(html) && /timeOffHrs:\s+sumOrNull\('timeOffHrs'\) \|\| 0,/.test(html));

// ── Page wiring ──────────────────────────────────────────────────────────────
ck('history: the score has its own row, with bars, and is out of the measure rows', /<tr class="prp-r-score">/.test(html) && /class="prp-sbar"/.test(html) && /c\.id !== 'score' && \(c\.id !== 'si' \|\| lens === 'quarter'\)/.test(html));
ck('history: the old separate score chart is gone', !/<div class="prp-chart" aria-label="Score per period">/.test(html));
ck('history: score cells carry the breakdown rows, a pin flag and keyboard access', /data-tip-rows="' \+ esc\(JSON\.stringify\(tipRows\)\)/.test(html) && /data-tip-pin="1"/.test(html) && /tabindex="0" role="button"/.test(html));
ck('history: the segment order and legend follow PERF_PART_ORDER', /PERF_PART_ORDER\.filter\(function\(id\) \{ return hasMetric_\(id\); \}\)/.test(html));
ck('history: the Goals row help switches with the lens', /goals:\s+\{ label: 'Goals',\s+help: 'meeting the rules \/ all goals', helpPeriod: 'weeks up to date \/ checked' \}/.test(html) && /var help = \(!single && meta\.helpPeriod\) \? meta\.helpPeriod : meta\.help;/.test(html));
ck('history: the Kudos row help reads given · received', /kudos:\s+\{ label: 'Kudos',\s+help: 'given · received' \}/.test(html));
ck('history: the Score row help names the bar', /score:\s+\{ label: 'Score',\s+help: '0–100 · bar = points by measure' \}/.test(html));
ck('history: hour cells carry the make-up as a title', /\(x\.note \? ' title="' \+ esc\(x\.note\) \+ '"' : ''\)/.test(html));
ck('history: the lens toggle still offers Week · Weeks · Months · Quarters', /\{ id: 'eval',\s+label: 'Evaluated week', short: 'Week' \}/.test(html) && /\{ id: 'quarter', label: 'Quarterly',\s+short: 'Quarters' \}/.test(html) && /var lensBtns = PERF_LENSES\.map/.test(html));
ck('tiles: kudos read given, received', /'kudos: ' \+ a\.kudos\.gave \+ ' given, ' \+ a\.kudos\.recv \+ ' received'/.test(html) && /'kudos: ' \+ \(rk\.kudosGivenCount \|\| 0\) \+ ' given, ' \+ \(rk\.kudosCount \|\| 0\) \+ ' received'/.test(html));
ck('tiles and evidence read the full-week hours', /rk\.trackedFullHrs !== null \? rk\.trackedFullHrs : rk\.trackedHrs/.test(html) && /var pFull = a\.plannedFullHrs !== null/.test(html) && /t: a\.trackedFullHrs !== null && a\.trackedFullHrs !== undefined \? a\.trackedFullHrs : a\.trackedHrs,/.test(html));
ck('evidence: kudos wording is given / received everywhere', !/'recv ' \+ /.test(html) && !/' · gave '/.test(html) && !/recv \+ '\/' \+/.test(html));

// ── Keep-open bubble ─────────────────────────────────────────────────────────
ck('bubble: hovering the bubble keeps it, leaving closes after a grace', /if \(inTip\(ev\.target\)\) \{ clearTimer\(\); return; \}/.test(html) && /function hideSoon\(\) \{ if \(pinned\) return; clearTimer\(\); hideTimer = setTimeout/.test(html));
ck('bubble: Keep open and Close buttons', /data-tip-act="pin"[^>]*>📌 Keep open<\/button>/.test(html) && /data-tip-act="close"[^>]*>✕ Close<\/button>/.test(html));
ck('bubble: a click on a data-tip-pin cell pins it; a click elsewhere lets a pinned note go', /if \(lbl && lbl\.getAttribute\('data-tip-pin'\)\) \{/.test(html) && /if \(pinned\) hide\(true\);\s+\/\/ a click anywhere else lets a pinned note go/.test(html));
ck('bubble: Escape closes first (capture phase), Enter/Space pin a cell', /if \(ev\.key === 'Escape'\) \{ if \(tipEl && tipEl\.classList\.contains\('show'\)\) \{ hide\(true\); ev\.stopPropagation\(\); ev\.stopImmediatePropagation\(\); \} return; \}/.test(html) && /\(ev\.key === 'Enter' \|\| ev\.key === ' '\)/.test(html) && /\}, true\);\n  \/\/ Focusing a label scrolls it into view/.test(html));
ck('bubble: a pinned note follows its anchor on scroll and goes when the anchor is gone', /if \(pinned\) \{ if \(anchor && anchor\.isConnected\) place\(anchor\); else hide\(true\); return; \}/.test(html));
ck('bubble: a pinned note ignores other hovers', /if \(pinned && lbl !== anchor\) return;/.test(html));
ck('bubble: data-tip-rows renders a small table with colour chips', /<table class="tip-rows">/.test(html) && /#pulseTip \.tip-rows i \{/.test(html));
ck('bubble: beside the anchor, never over it', /if \(r\.left - w - 12 >= 12\) left = r\.left - w - 12;/.test(html) && /top = r\.bottom \+ 8;/.test(html));
ck('bubble: takes the pointer only while shown; pinned style', /#pulseTip\.show \{ pointer-events: auto; \}/.test(html) && /#pulseTip\.pinned \{/.test(html));

// ── Help and Documentation ───────────────────────────────────────────────────
const m = /var PERF_METRIC_TIPS = (\{[\s\S]*?\n\});/.exec(html);
const TIPS = m ? vm.runInNewContext('(' + m[1] + ')') : {};
ck('score tip explains the bar and the click', /stacked by measure/.test(TIPS.score.text) && /click it to keep them open/.test(TIPS.score.text));
ck('goals tip explains 6 / 8', /goals meeting the rules over all goals — 6 \/ 8/.test(TIPS.goals.text));
ck('kudos tip says given and received', /kudos given and kudos received/.test(TIPS.kudos.text));
ck('time tips explain PTO, holidays and the 40 / 38 cap', /plus the PTO the NetSuite record holds/.test(TIPS.tracked.text) && /38 h in Australia & New Zealand/.test(TIPS.planned.text));
ck('time tips name the known causes of a Tempo total above the week', /duplicated worklogs and PTO cancelled in NetSuite but still logged in Tempo/.test(TIPS.tracked.note) && /duplicated plans/.test(TIPS.planned.note));
ck('logged tip says never capped; planned tip says capped', /never capped: a person can log more than a week/.test(TIPS.tracked.text) && /capped at the standard week/.test(TIPS.planned.text) && !/capped at the standard week/.test(TIPS.tracked.text));
Object.keys(TIPS).forEach(id => ck(`tip "${id}" stays a readable paragraph (≤ 560 chars)`, TIPS[id].text.length <= 560));
ck('Documentation: full-week hours paragraph with its anchor', /id="docFullWeek"/.test(html) && /Planned time is capped at the standard week — 40 h, or 38 h in Australia &amp; New Zealand/.test(html) && /Logged time is never capped/.test(html) && /PTO that was cancelled in NetSuite but not removed from Tempo, and duplicated plans/.test(html));
ck('Documentation: the short version is described as feedback material across four measures, without PTO or RCR', /Feedback material for a 1:1/.test(html) && /goals, logged time, planned time and kudos\. PTO is not part of it/.test(html));
ck('Documentation: the History row explains the score row, 6 / 8 and given / received', /The <strong>Score<\/strong> row at the top is set apart/.test(html) && /goals meeting the rules over all goals \(6 \/ 8\)/.test(html) && /<strong>Kudos<\/strong> reads as given and received/.test(html));
ck('Documentation: rates table says plus PTO and public holidays', /hours planned <em>plus PTO and public holidays<\/em>/.test(html) && /hours logged <em>plus PTO and public holidays<\/em>/.test(html));

// ── Harness fixture carries the new shapes ───────────────────────────────────
const fixture = lf(fs.readFileSync(path.join(__dirname, 'render-harness', 'fixture.js'), 'utf8'));
ck('fixture: goals carry counts, PTO carries a balance, weeks carry full-week hours', /qualifying: q, threshold: 6, required: 8/.test(fixture) && /balance: Math\.round/.test(fixture) && /plannedFullHrs: o\.leave \? null : Math\.min\(40,/.test(fixture));

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
