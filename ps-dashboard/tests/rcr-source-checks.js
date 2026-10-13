// Node checks for readRCR_PS_ reading two RCR tabs onto one month axis
// (spec 2026-10-13 New RCR direct rate):
//   "3. RCR"  — FY26 and earlier, "Jun 26" headers, SUM(RC)/SUM(TCC) team ratio.
//   "New RCR" — FY27 on, "2026.07 RCR" headers, a direct per-person rate.
// Run: node "ps-dashboard/tests/rcr-source-checks.js"
const fs = require('fs');
const path = require('path');
global.Logger = { log: function () {} };

// ── Fake container spreadsheet ───────────────────────────────────────────────
const SHEETS = {};
function fakeSheet(rows) {
  return { getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }) };
}
// loadSheet_PS_ memoises per spreadsheet id, and the memo is an eval-scoped const
// the test cannot reach — so each fixture presents itself as a new spreadsheet.
let fixtureId = 0;
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({ getId: () => 'container-' + fixtureId, getSheetByName: n => SHEETS[n] || null }),
  openById: () => ({ getSheetByName: () => null }),
};
eval(fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function resetSheetMemo() { fixtureId++; }
const near = (a, b) => a !== null && Math.abs(a - b) < 1e-9;

// ── Header parser: both spellings land on the same "Mon YY" axis ─────────────
const jul26New = rcrMonthFromHeader_('2026.07 RCR');
const jul26Old = rcrMonthFromHeader_('Jul 26');
ck('"2026.07 RCR" → "Jul 26"',                 jul26New && jul26New.name === 'Jul 26');
ck('"2026.07 RCR" and "Jul 26" share a sortKey', jul26New && jul26Old && jul26New.sortKey === jul26Old.sortKey);
ck('"2027.06 RCR" → "Jun 27" (FY27 end)',      (rcrMonthFromHeader_('2027.06 RCR') || {}).name === 'Jun 27');
ck('"2026.08 RCR" sorts after "2026.07 RCR"',  rcrMonthFromHeader_('2026.08 RCR').sortKey === jul26New.sortKey + 1);
ck('"jun 26" normalises to "Jun 26"',          (rcrMonthFromHeader_('jun 26') || {}).name === 'Jun 26');
ck('"Employee" is not a month',                rcrMonthFromHeader_('Employee') === null);
ck('"Tenure (Years)" is not a month',          rcrMonthFromHeader_('Tenure (Years)') === null);
ck('"2026.13 RCR" is rejected',                rcrMonthFromHeader_('2026.13 RCR') === null);
ck('"Hire Date" is not a month',               rcrMonthFromHeader_('Hire Date') === null);

// ── Fixture roster ───────────────────────────────────────────────────────────
// aaron / zoe are tracking-mandated (team subset); abel is a contractor outside
// the subset but still on the roster (own-row value only); nobody else exists.
const prof = (name, internalId, employeeNumber) => ({ name, internalId, employeeNumber, tracksTime: true });
const AARON = normPS_('Aaron Pavez Bravo'), ABEL = normPS_('Abel Sanchez'), ZOE = normPS_('Zoe Nguyen');
const roster = new Map([
  [AARON, prof('Aaron Pavez Bravo', '8614',    '20001')],
  [ABEL,  prof('Abel Sanchez',      '5086739', '20002')],
  [ZOE,   prof('Zoe Nguyen',        '777',     '20003')],
]);
const subset = new Map([[AARON, roster.get(AARON)], [ZOE, roster.get(ZOE)]]);

const NEW_HDR = ['Internal ID', 'Employee', 'Class', 'Job Level', 'Employee Type Category', 'Supervisor',
                 'Country', 'Tenure (Years)', 'Hire Date', 'Termination/Release Date', 'Status',
                 '2026.07 RCR', '2026.08 RCR', '2026.09 RCR'];
function loadFixture(opts) {
  opts = opts || {};
  resetSheetMemo();
  Object.keys(SHEETS).forEach(k => delete SHEETS[k]);
  SHEETS['3. RCR'] = fakeSheet([
    ['Employee Name',     'Employee ID', 'May 26', 'Jun 26', 'Jul 26'],
    ['Aaron Pavez Bravo', 'E1',          1.1,      1.3,      9.9],   // Jul 26 here must LOSE to New RCR
    ['Abel Sanchez',      'E2',          5.0,      6.0,      ''],
    ['Zoe Nguyen',        'E3',          2.1,      2.3,      9.9],
    ['Gone Person',       'E9',          0.5,      0.5,      0.5],   // not on the roster
  ]);
  SHEETS['1. Revenue Contribution'] = fakeSheet([
    ['Employee ID', 'Jun 26', 'Jul 26'],
    ['E1', 300, 400], ['E2', 1000, 1000], ['E3', 100, 200], ['E9', 50, 50],
  ]);
  SHEETS['2. TCC A+B'] = fakeSheet([
    ['Employee ID', 'Jun 26', 'Jul 26'],
    ['E1', 100, 100], ['E2', 100, 100], ['E3', 100, 100], ['E9', 100, 100],
  ]);
  if (!opts.noNew) SHEETS['New RCR'] = fakeSheet([
    NEW_HDR,
    // name spelled differently on purpose: the Internal ID join must carry it
    ['8614',    'Aaron Pavez Bravo', 'Professional Services', 'Level I4', 'Permanent',  'Andres Hazard',   'Chile', 3.2,  '8/2/2023',  '', 'Actively Employed', 2.71, 1.54, ''],
    ['5086739', 'Abel Sanchez',      'Professional Services', 'Contractor', 'Contingent', 'Renzo Arriagada', 'Chile', 0.54, '3/30/2026', '', 'Actively Employed', 31.77, 25.92, ''],
    ['777',     'Zoe T. Nguyen',     'Professional Services', 'Level I4', 'Permanent',  'Andres Hazard',   'Chile', 2,    '1/1/2024',  '', 'Actively Employed', 0, 3.26, ''],
    ['999',     'Left Already',      'Professional Services', 'Level I4', 'Permanent',  'Andres Hazard',   'Chile', 1,    '1/1/2025',  '9/1/2026', 'Terminated', 4.0, 4.0, 4.0],
  ]);
}

// ── Both tabs present: the New RCR month is the latest, as a direct rate ─────
loadFixture();
const r = readRCR_PS_(roster, subset);
ck('latest month is "Aug 26" (New RCR; the empty 2026.09 column is ignored)', r.lastMonth === 'Aug 26');
ck('method is direct-rate',                   r.method === 'direct-rate');
ck('team RCR = mean of subset rates (1.54, 3.26) = 2.4', near(r.teamRCR, 2.4));
ck('tier follows the rate',                   r.tier === rcrTier_PS_(2.4));
ck('byEmployee carries every roster member (abel outside the subset too)',
   r.byEmployee[ABEL] && near(r.byEmployee[ABEL].value, 25.92));
ck('byEmployee: Zoe joined through Internal ID despite the name spelling',
   r.byEmployee[ZOE] && near(r.byEmployee[ZOE].value, 3.26));
ck('byEmployee excludes rows not on the roster',
   Object.keys(r.byEmployee).length === 3);

const months = r.rcrHistory.map(h => h.month);
ck('history runs May 26 → Jun 26 → Jul 26 → Aug 26 on one axis',
   months.join('|') === 'May 26|Jun 26|Jul 26|Aug 26');
const byMonth = Object.fromEntries(r.rcrHistory.map(h => [h.month, h]));
ck('Jul 26 comes from New RCR (rate), not the legacy 9.9 column',
   byMonth['Jul 26'].source === 'rate' && near(byMonth['Jul 26'].rcr, Math.round((2.71 + 0) / 2 * 100) / 100));
ck('Jun 26 is a legacy history point: mean of subset, approx',
   byMonth['Jun 26'].source === 'ratio' && near(byMonth['Jun 26'].rcr, (1.3 + 2.3) / 2) && byMonth['Jun 26'].exact === false);
ck('Aug 26 is exact (the rate is the metric)', byMonth['Aug 26'].exact === true);
ck('rcrByEmployee: Aaron Jul 26 = New RCR 2.71',  near((r.rcrByEmployee[AARON] || {})['Jul 26'], 2.71));
ck('rcrByEmployee: Aaron Jun 26 = legacy 1.3',    near((r.rcrByEmployee[AARON] || {})['Jun 26'], 1.3));
ck('rcrByEmployee: Zoe Aug 26 keyed by roster norm', near((r.rcrByEmployee[ZOE] || {})['Aug 26'], 3.26));
ck('rcrByEmployee months use the frontend label format "Mon YY"',
   Object.keys(r.rcrByEmployee[AARON]).every(k => /^[A-Z][a-z]{2} \d{2}$/.test(k)));

// ── Legacy only: SUM(RC)/SUM(TCC) path unchanged ─────────────────────────────
loadFixture({ noNew: true });
const l = readRCR_PS_(roster, subset);
ck('legacy only: latest month is "Jul 26"',  l.lastMonth === 'Jul 26');
ck('legacy only: method is sum-ratio',        l.method === 'sum-ratio');
ck('legacy only: team RCR = SUM(RC)/SUM(TCC) over subset IDs = (400+200)/(100+100) = 3',
   near(l.teamRCR, 3));
ck('legacy only: latest history point is exact', l.rcrHistory[l.rcrHistory.length - 1].exact === true);
ck('legacy only: history is May → Jun → Jul',  l.rcrHistory.map(h => h.month).join('|') === 'May 26|Jun 26|Jul 26');

// ── Neither tab populated → empty shape with method null ─────────────────────
resetSheetMemo();
Object.keys(SHEETS).forEach(k => delete SHEETS[k]);
const e = readRCR_PS_(roster, subset);
ck('no tabs: empty result',  e.lastMonth === null && e.teamRCR === null && e.method === null);
ck('emptyRcrResult_ carries method: null', emptyRcrResult_().method === null);

// ── History window still caps at RCR_HISTORY_MONTHS across both sources ──────
resetSheetMemo();
Object.keys(SHEETS).forEach(k => delete SHEETS[k]);
const legacyHdr = ['Employee Name', 'Employee ID'], legacyRow = ['Aaron Pavez Bravo', 'E1'];
['Jul 25','Aug 25','Sep 25','Oct 25','Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26','May 26','Jun 26']
  .forEach((m, i) => { legacyHdr.push(m); legacyRow.push(1 + i * 0.1); });
SHEETS['3. RCR'] = fakeSheet([legacyHdr, legacyRow]);
SHEETS['New RCR'] = fakeSheet([
  ['Internal ID', 'Employee', '2026.07 RCR', '2026.08 RCR'],
  ['8614', 'Aaron Pavez Bravo', 2.0, 2.5],
]);
const w = readRCR_PS_(roster, new Map([[AARON, roster.get(AARON)]]));
ck('window = RCR_HISTORY_MONTHS newest months', w.rcrHistory.length === CONFIG_PS.RCR_HISTORY_MONTHS);
ck('window ends at the New RCR month',         w.rcrHistory[w.rcrHistory.length - 1].month === 'Aug 26');
ck('window starts 12 months back (Sep 25)',    w.rcrHistory[0].month === 'Sep 25');

console.log(fail ? `❌ ${pass} passed, ${fail} failed` : `✅ ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
