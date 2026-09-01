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
].join('\n');

// eslint-disable-next-line no-eval
const api = eval('(function(){' + secSlice + '\n' + repSlice + '\n' + usageSlice +
  '\nreturn { SEC_, usageWeekLabel_, usageWeeksInYear_, usageWeekWindow_,' +
  ' _readAccessLists_, _autoAccessAllows_, USAGE_WEEKS_, weeksInYear_PS_ };})()');

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

// (Sections 2–5 are appended by later tasks.)

console.log(fail === 0
  ? '✅ usage-analytics-checks: ' + pass + ' checks passed'
  : '❌ usage-analytics-checks: ' + fail + ' of ' + (pass + fail) + ' checks FAILED');
process.exit(fail === 0 ? 0 : 1);
