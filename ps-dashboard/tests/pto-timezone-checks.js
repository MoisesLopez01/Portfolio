// Node checks for the PTO week assignment across time zones (2026.W43, second
// measurement of indicator I1).
//
// The script runs in America/Guatemala (UTC-6, no DST). The PTO workbook
// (NetSuite "Accumulation Cost") is in America/Chicago, UTC-5 until 2026-11-01.
// A date CELL reaches the script as a Date at midnight in the WORKBOOK's zone,
// i.e. a Monday 00:00 Chicago is Sunday 23:00 Guatemala, and isoWeekNum_PS_ (local
// getters) put the movement in the previous ISO week: the 44 critical errors of
// the 2026-10-19 measurement. toLocalYmd_PS_ reads the day in the workbook zone.
// The sibling tests never covered a workbook zone different from the script's.
//
// Run: node "ps-dashboard/tests/pto-timezone-checks.js"
process.env.TZ = 'America/Guatemala';          // the script's zone (appsscript.json), before any Date is built
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');

global.Logger = { log() {} };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Utilities = {
  formatDate: (d, tz, fmt) => {
    if (fmt !== 'yyyy-MM-dd') throw new Error('stub supports yyyy-MM-dd only');
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  },
};
global.HtmlService = {}; global.Session = { getScriptTimeZone: () => 'America/Guatemala' };

let pass = 0, fail = 0;
const ck = (name, cond, detail) => { if (cond) pass++; else { fail++; console.error('  ❌ ' + name + (detail !== undefined ? '\n     ' + detail : '')); } };

// Fresh copy of the engine per scenario: its top-level consts (SHEET_MEMO_, CONFIG_PS)
// are private to each load, so one scenario's cached sheet never reaches the next.
// Loads this project's own Apps Script sources into Node, as every sibling test does.
function loadEngine() {
  eval(fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'));
  eval(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8'));
  return { toLocalYmd_PS_, parseDate_PS_, isoWeekNum_PS_, isoWeekYear_PS_, readPTOAccumulationProfiles_ };
}
const E = loadEngine();
const label = d => E.isoWeekYear_PS_(d) + '.W' + E.isoWeekNum_PS_(d);

// The instant a Sheets date cell holds: midnight of that civil day in `tz`.
function cellDate(ymd, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  for (const off of [4, 5, 6, 7, 8]) {
    const dt = new Date(Date.UTC(y, m - 1, d, off));
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', day: '2-digit', hour12: false }).format(dt);
    if (hm.startsWith(String(d).padStart(2, '0')) && hm.endsWith('00:00')) return dt;
  }
  throw new Error('no midnight found for ' + ymd + ' in ' + tz);
}
const CHI = 'America/Chicago';

// ── Environment is the one the bug needs ─────────────────────────────────────
ck('the script zone is UTC-6 all year (Guatemala, no DST)', new Date(2026, 8, 28).getTimezoneOffset() === 360 && new Date(2026, 11, 28).getTimezoneOffset() === 360);
ck('Chicago is UTC-5 on 2026-09-28 and UTC-6 on 2026-11-02', cellDate('2026-09-28', CHI).getUTCHours() === 5 && cellDate('2026-11-02', CHI).getUTCHours() === 6);

// ── The six cases of the protocol (workbook in America/Chicago) ──────────────
const CASES = [
  ['2026-09-28', '2026.W40', 'DST: the case that failed'],
  ['2026-10-12', '2026.W42', 'DST'],
  ['2026-11-02', '2026.W45', 'DST is over'],
  ['2026-12-28', '2026.W53', '53-week ISO year'],
  ['2027-03-15', '2027.W11', 'DST is back'],
];
CASES.forEach(([ymd, want, why]) => {
  const cell = cellDate(ymd, CHI);
  ck(`${ymd} (Mon, ${why}) → ${want} with the workbook zone`, label(E.toLocalYmd_PS_(cell, CHI)) === want, label(E.toLocalYmd_PS_(cell, CHI)));
});
ck('text "09/28/2026" → 2026.W40, text path unchanged (zone ignored)',
   label(E.toLocalYmd_PS_('09/28/2026', CHI)) === '2026.W40' && label(E.toLocalYmd_PS_('09/28/2026', '')) === '2026.W40');

// ── The test reproduces the defect it guards (so it can fail) ────────────────
const dstMon = cellDate('2026-09-28', CHI);
ck('without the fix a DST Monday cell falls on the previous week (2026.W39) — the 2026-10-19 error',
   label(E.parseDate_PS_(dstMon)) === '2026.W39', label(E.parseDate_PS_(dstMon)));
ck('the shifted Monday is Sunday 23:00 in the script zone', dstMon.getHours() === 23 && dstMon.getDay() === 0);
ck('outside DST the old path was already right (2026-11-02 → W45), which is why only W39–W42 failed',
   label(E.parseDate_PS_(cellDate('2026-11-02', CHI))) === '2026.W45');

// ── Edge behaviour ───────────────────────────────────────────────────────────
ck('no workbook zone → previous behaviour (nothing silently different)', label(E.toLocalYmd_PS_(dstMon, '')) === '2026.W39' && label(E.toLocalYmd_PS_(dstMon, undefined)) === '2026.W39');
ck('empty / invalid cells give null, never throw', E.toLocalYmd_PS_('', CHI) === null && E.toLocalYmd_PS_(null, CHI) === null && E.toLocalYmd_PS_(new Date('x'), CHI) === null);
ck('numeric serial still goes through the number branch', E.toLocalYmd_PS_(46293, CHI) instanceof Date);
ck('a Sunday cell stays on its own week (2026-10-04 → W40)', label(E.toLocalYmd_PS_(cellDate('2026-10-04', CHI), CHI)) === '2026.W40');
ck('mid-day cells are unaffected (2026-09-30 12:00 Chicago → W40)', label(E.toLocalYmd_PS_(new Date(Date.UTC(2026, 8, 30, 17)), CHI)) === '2026.W40');
// A workbook already in the script's zone is the identity.
const gt = 'America/Guatemala';
ck('workbook in the script zone: identity for every case', CASES.every(([ymd, want]) => label(E.toLocalYmd_PS_(cellDate(ymd, gt), gt)) === want));
// Every Monday of the measured window, all four weeks.
['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'].forEach((ymd, i) =>
  ck(`measured window: Monday ${ymd} → 2026.W${40 + i - 0}`.replace('W40', 'W40'), label(E.toLocalYmd_PS_(cellDate(ymd, CHI), CHI)) === '2026.W' + (40 + i)));

// ── Through the real reader: ledger rows → profile week ──────────────────────
function ledger(rows, tzOrThrow) {
  const header = ['Employee Number', 'Department: Name', 'Date', 'Balance', 'Adjustment Type', 'Amount', 'Name'];
  const values = [header].concat(rows.map(([emp, ymd, amt, bal]) => [emp, 'Service Delivery', cellDate(ymd, CHI), bal, 'Usage', amt, 'Test Person']));
  const sh = { getLastRow: () => values.length, getLastColumn: () => header.length, getRange: () => ({ getValues: () => values.map(r => r.slice()) }) };
  const ss = { getSheetByName: () => sh, getSpreadsheetTimeZone: () => { if (tzOrThrow === 'THROW') throw new Error('no zone'); return tzOrThrow; } };
  global.SpreadsheetApp = { openById: () => ss };
}
const MONDAYS = [['2026-09-28', '2026.W40'], ['2026-10-05', '2026.W41'], ['2026-10-12', '2026.W42'], ['2026-10-19', '2026.W43']];
const rows = MONDAYS.map(([ymd], i) => ['30001', ymd, 8, 100 - 8 * (i + 1)]);

ledger(rows, CHI);
const fixed = loadEngine().readPTOAccumulationProfiles_(null);
const weeksOf = p => p.balanceHistory.map(e => label(e.date));
ck('reader, workbook zone read: every Monday ledger row lands in its own ISO week',
   fixed['30001'] && weeksOf(fixed['30001']).join('|') === MONDAYS.map(m => m[1]).join('|'), fixed['30001'] && weeksOf(fixed['30001']).join('|'));
ck('reader: the stored day is local midnight (no hour left to cross a boundary)', fixed['30001'].balanceHistory.every(e => e.date.getHours() === 0 && e.date.getMinutes() === 0));

ledger(rows, 'THROW');
const blind = loadEngine().readPTOAccumulationProfiles_(null);
ck('reader, workbook zone unreadable: falls back to the old reading (logged, not fatal) — the case the fix must not hide',
   blind['30001'] && weeksOf(blind['30001']).join('|') === 'W39|W40|W41|W42'.split('|').map(w => '2026.' + w).join('|'), blind['30001'] && weeksOf(blind['30001']).join('|'));

// ── Source guards ────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8');
ck('the PTO ledger reader converts dates with toLocalYmd_PS_, not parseDate_PS_', /const date = toLocalYmd_PS_\(row\[COL\.date\], wbTz\);/.test(src));
ck('the workbook zone is read from the workbook, never hard-coded', /ss\.getSpreadsheetTimeZone\(\)/.test(src) && !/toLocalYmd_PS_\([^)]*['"]America\//.test(src));

console.log(fail ? `\n❌ pto-timezone-checks: ${fail} failed, ${pass} passed` : `✅ pto-timezone-checks: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
