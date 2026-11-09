// Node checks for the Source Status ledger (spec 2026-11-09).
// Run: node "ps-dashboard/tests/source-status-checks.js"
const fs   = require('fs');
const path = require('path');

global.Logger = { log: function () {} };
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty: () => {} }),
};

const dir = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
eval(read('PS Contribution Report.js'));
eval(read('SourceStatus.js'));
if (fs.existsSync(path.join(dir, 'SourceDigest.js'))) eval(read('SourceDigest.js'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error('  ❌ ' + name + '\n     got:  ' + JSON.stringify(got) +
                         '\n     want: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
const H = 3600000, D = 86400000;
function def(key) { return sourceDefs_({}).filter(d => d.key === key)[0]; }
function ymd(d) { return d instanceof Date ? stampLabel_SS_(d).slice(0, 10) : String(d); }

// ── Task 1: config, labels, evaluator ────────────────────────────────────────
eq('ten sources in order', sourceDefs_({}).map(d => d.key),
   ['tempo_tracked', 'tempo_plan', 'tempo_capacity', 'goals', 'pto', 'roster', 'kudos', 'si', 'rcr', 'digest']);
eq('stale override by Script Property',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: '12' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 12);
eq('bad override ignored',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: 'abc' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 192);

eq('ISO label 2026-11-09', isoLabel_SS_(new Date(2026, 10, 9, 12)), '2026.W46');
eq('ISO label 53-week year', isoLabel_SS_(new Date(2026, 11, 31, 12)), '2026.W53');
eq('ISO label unpadded', isoLabel_SS_(new Date(2027, 0, 4, 12)), '2027.W1');
eq('stamp label', stampLabel_SS_(new Date(2026, 10, 2, 9)), '2026-11-02 (2026.W45)');
eq('stamp label empty for non-date', stampLabel_SS_(''), '');

const NOW = new Date(2026, 10, 9, 10, 0);
const at = ms => new Date(NOW.getTime() - ms);

eq('tracked 25 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(25 * H) }, NOW).status, 'ok');
eq('tracked 26 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(26 * H) }, NOW).status, 'ok');
const tr27 = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(27 * H) }, NOW);
eq('tracked 27 h → stale', tr27.status, 'stale');
eq('tracked stale detail', tr27.detail, 'No update for 27 h (limit 26 h)');

eq('capacity 8 d → ok', evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D) }, NOW).status, 'ok');
const cap = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D + H) }, NOW);
eq('capacity 8 d 1 h → stale', cap.status, 'stale');
eq('capacity stale detail', cap.detail, 'No update for 8 days (limit 8 days)');
eq('plan 8 d 1 h → stale', evaluateSourceStatus_(def('tempo_plan'), { lastUpdated: at(8 * D + H) }, NOW).status, 'stale');
eq('goals 7 d → ok',     evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D) }, NOW).status, 'ok');
eq('goals 7 d 1 h → stale', evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D + H) }, NOW).status, 'stale');
eq('pto 15 d → ok',      evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D) }, NOW).status, 'ok');
eq('pto 15 d 1 h → stale', evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D + H) }, NOW).status, 'stale');
eq('roster never stale', evaluateSourceStatus_(def('roster'), { lastUpdated: at(400 * D) }, NOW).status, 'ok');

const pend = evaluateSourceStatus_(def('tempo_plan'), {}, NOW);
eq('no stamp → pending', pend.status, 'pending');
eq('no stamp detail', pend.detail, 'awaiting first update');
eq('failed is sticky', evaluateSourceStatus_(def('tempo_plan'),
   { lastUpdated: at(H), status: 'failed', detail: 'boom' }, NOW).status, 'failed');
eq('rule row keeps stored status', evaluateSourceStatus_(def('si'), { status: 'pending' }, NOW).status, 'pending');
eq('rule row with no status → pending', evaluateSourceStatus_(def('rcr'), {}, NOW).status, 'pending');

const nx = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: new Date(2026, 10, 9, 6, 0) }, NOW);
eq('next expected = last + cadence', ymd(nx.nextExpected), '2026-11-10');
const ev = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(H) }, NOW);
eq('evaluator carries label/digest/action', [ev.label, ev.digest, /fetchTempoCapacity/.test(ev.action)],
   ['Tempo Capacity', true, true]);

// ── Task 2: rule helpers ─────────────────────────────────────────────────────
eq('Q end FY27Q1', ymd(quarterEndFromLabel_SS_('FY27Q1')), '2026-09-30');
eq('Q end FY27Q2', ymd(quarterEndFromLabel_SS_('FY27Q2')), '2026-12-31');
eq('Q end FY27Q3', ymd(quarterEndFromLabel_SS_('FY27Q3')), '2027-03-31');
eq('Q end FY27Q4', ymd(quarterEndFromLabel_SS_('fy27q4')), '2027-06-30');
eq('Q end bad label', quarterEndFromLabel_SS_('Q2 FY27'), null);

const siNov = siStatus_SS_(new Date(2026, 10, 9, 10));
eq('SI 2026-11-09 ok FY27Q1', [siNov.status, siNov.coversPeriod], ['ok', 'FY27Q1']);
eq('SI available since 2026-10-14', ymd(siNov.lastUpdated), '2026-10-14');
eq('SI next due 2027-01-14', ymd(siNov.nextExpected), '2027-01-14');
const siOct10 = siStatus_SS_(new Date(2026, 9, 10, 10));
eq('SI 2026-10-10 pending FY27Q1', [siOct10.status, siOct10.coversPeriod], ['pending', 'FY27Q1']);
eq('SI pending next = due date', ymd(siOct10.nextExpected), '2026-10-14');
eq('SI pending last = previous quarter release', ymd(siOct10.lastUpdated), '2026-07-14');
eq('SI on due day → ok', siStatus_SS_(new Date(2026, 9, 14, 8)).status, 'ok');
const siJul = siStatus_SS_(new Date(2026, 6, 10, 10));
eq('SI across FY rollover', [siJul.status, siJul.coversPeriod, ymd(siJul.nextExpected)], ['pending', 'FY26Q4', '2026-07-14']);

const RH = ['Employee Name', 'Employee ID', 'Sep 26', 'Oct 26'];
const rFull = rcrStatus_SS_(RH, [['A', 1, 1.2, 1.4], ['B', 2, 0.9, '']], new Date(2026, 10, 9));
eq('RCR Oct filled → ok', [rFull.status, rFull.coversPeriod], ['ok', 'Oct 26']);
eq('RCR covers through month end', ymd(rFull.lastUpdated), '2026-10-31');
const rPend = rcrStatus_SS_(RH, [['A', 1, 1.2, ''], ['B', 2, 0.9, 'N/A']], new Date(2026, 10, 9));
eq('RCR Oct empty → pending on Sep', [rPend.status, rPend.coversPeriod], ['pending', 'Sep 26']);
ck('RCR pending names the missing month', /Oct 26/.test(rPend.detail) && /Finance/.test(rPend.detail));
eq('RCR never stale (no next expected)', rPend.nextExpected, null);
eq('RCR nothing populated → pending', rcrStatus_SS_(RH, [['A', 1, '', '']], new Date(2026, 10, 9)).status, 'pending');

const W = { firstRow: 2, firstCol: 1, lastCol: 14 };
eq('edit header row only', editTouchesRange_SS_({ row: 1, numRows: 1, col: 1, numCols: 5 }, W), false);
eq('edit spanning header + data', editTouchesRange_SS_({ row: 1, numRows: 3, col: 1, numCols: 5 }, W), true);
eq('edit right of N', editTouchesRange_SS_({ row: 5, numRows: 1, col: 15, numCols: 1 }, W), false);
eq('edit in column N', editTouchesRange_SS_({ row: 5, numRows: 1, col: 14, numCols: 1 }, W), true);

const CTX = { goalsQuarter: 'FY27Q2', prevGoalsQuarter: 'FY27Q1', inGracePeriod: false };
eq('goals prev quarter only, no grace', goalsEditQualifies_SS_(['FY27Q1'], CTX), false);
eq('goals current quarter (case/space)', goalsEditQualifies_SS_([' fy27q2 '], CTX), true);
eq('goals prev quarter in grace', goalsEditQualifies_SS_(['FY27Q1'], Object.assign({}, CTX, { inGracePeriod: true })), true);
eq('goals mixed paste', goalsEditQualifies_SS_(['FY26Q4', 'FY27Q2'], CTX), true);

const V1 = [['Employee Number', 'Name'], [1, 'Ana'], [2, 'Luis']];
const V2 = [['Employee Number', 'Name'], [1, 'Ana'], [2, 'Luís']];
eq('fingerprint stable', fingerprint_SS_(V1), fingerprint_SS_(JSON.parse(JSON.stringify(V1))));
ck('fingerprint changes on a cell', fingerprint_SS_(V1) !== fingerprint_SS_(V2));
ck('fingerprint starts with row count', /^3:/.test(fingerprint_SS_(V1)));

const base = rosterCheck_SS_(null, '3:abc', 2, NOW);
eq('roster first run = baseline pending', base.status, 'pending');
ck('roster baseline detail', /Baseline captured/.test(base.detail));
eq('roster unchanged → null', rosterCheck_SS_('3:abc', '3:abc', 2, NOW), null);
const chg = rosterCheck_SS_('3:abc', '3:def', 2, NOW);
eq('roster changed → ok stamped now', [chg.status, chg.lastUpdated === NOW, chg.detail], ['ok', true, 'Data tab changed (2 rows)']);

eq('flag problem → failed', flagOutcome_SS_({}, 'tab "RD" not found', 'Cannot read'),
   { status: 'failed', detail: 'Cannot read: tab "RD" not found' });
eq('flag recovered with stamp → ok', flagOutcome_SS_({ status: 'failed', detail: 'Cannot read: x', lastUpdated: NOW }, null, 'Cannot read'),
   { status: 'ok', detail: '' });
eq('flag recovered never stamped → pending', flagOutcome_SS_({ status: 'failed', detail: 'Cannot read: x' }, null, 'Cannot read'),
   { status: 'pending', detail: 'awaiting first update' });
eq('flag leaves other failures alone', flagOutcome_SS_({ status: 'failed', detail: 'Trigger missing: x' }, null, 'Cannot read'), null);
eq('flag no-op when healthy', flagOutcome_SS_({ status: 'ok' }, null, 'Cannot read'), null);

const IDS = { goals: 'G', ptoAccum: 'P' };
const exp = expectedTriggers_SS_(sourceDefs_({}), IDS);
eq('expected trigger keys', exp.map(e => e.key), ['tempo_tracked', 'tempo_plan', 'tempo_capacity', 'goals', 'pto', 'roster', 'digest']);
const actual = [
  { handler: 'fetchTempoLoggedTime', sourceId: null }, { handler: 'fetchTempoPlannedTime', sourceId: null },
  { handler: 'onWatchedEdit', sourceId: 'G' }, { handler: 'checkSourcesDaily', sourceId: null },
  { handler: 'sendSourceHealthDigest', sourceId: null },
];
eq('missing triggers detected', missingTriggers_SS_(exp, actual).map(m => m.key + '>' + m.installer),
   ['tempo_capacity>createCapacityWeeklyTrigger', 'pto>installSourceStatusTriggers']);

// ── Task 3: digest builder ───────────────────────────────────────────────────
function evRow(key, row) { return evaluateSourceStatus_(def(key), row, NOW); }
const allOk = sourceDefs_({}).map(d => evRow(d.key, { lastUpdated: at(H), status: d.rule ? 'ok' : '' }));
eq('all ok → no digest', buildDigest_SS_(allOk, NOW, 'https://x'), null);

const onlyInfo = allOk.map(r => (r.key === 'roster' || r.key === 'pto')
  ? Object.assign({}, r, { status: 'stale' }) : r);
eq('roster/pto problems never email', buildDigest_SS_(onlyInfo, NOW, ''), null);

const twoBad = allOk.map(r => r.key === 'tempo_capacity' ? evRow('tempo_capacity', { lastUpdated: at(9 * D) })
  : r.key === 'goals' ? evRow('goals', { lastUpdated: at(2 * D), status: 'failed', detail: 'Cannot read: tab "RD" not found' }) : r);
const dg = buildDigest_SS_(twoBad, NOW, 'https://dash');
eq('subject', dg.subject, 'PS Dashboard sources: 2 need attention (2026.W46)');
ck('body names capacity stale', /Tempo Capacity — STALE/.test(dg.body));
ck('body names goals failed + detail', /Goals \(RD\) — FAILED/.test(dg.body) && /tab "RD" not found/.test(dg.body));
ck('body carries action', /Run fetchTempoCapacity/.test(dg.body));
ck('body carries last good update with ISO week', /Last good update: 2026-10-31 \(2026\.W44\)/.test(dg.body));
ck('body links Data Reference', /Data Reference: https:\/\/dash/.test(dg.body));
const oneBad = allOk.map(r => r.key === 'tempo_plan' ? evRow('tempo_plan', { lastUpdated: at(10 * D) }) : r);
eq('singular subject', buildDigest_SS_(oneBad, NOW, '').subject, 'PS Dashboard sources: 1 needs attention (2026.W46)');

const sum = buildStatusSummary_SS_(twoBad);
eq('summary lists every source', sum.split('\n').length, 10);
ck('summary line format', /^Tempo Capacity: stale · last 2026-10-31 \(2026\.W44\)/m.test(sum));

// ── Review fixes ─────────────────────────────────────────────────────────────
const rFut = rcrStatus_SS_(['Employee Name', 'Employee ID', 'Oct 26', 'Nov 26', 'Dec 26'], [['A', 1, 1, 0, 0]], new Date(2026, 10, 9));
eq('RCR ignores future/zero months', [rFut.status, rFut.coversPeriod], ['ok', 'Oct 26']);
const rZero = rcrStatus_SS_(['Employee Name', 'Employee ID', 'Sep 26', 'Oct 26'], [['A', 1, 1.1, 0], ['B', 2, 0.9, '0']], new Date(2026, 10, 9));
eq('RCR all-zero Oct is a placeholder', [rZero.status, rZero.coversPeriod], ['pending', 'Sep 26']);
const rDash = rcrStatus_SS_(['Employee Name', 'Sep 26', 'Oct-26'], [['A', 1.1, 1.4]], new Date(2026, 10, 9));
eq('RCR ignores Oct-26 header', [rDash.status, rDash.coversPeriod], ['pending', 'Sep 26']);
eq('stale override 0 ignored', sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: '0' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 192);
eq('stale override -5 ignored', sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: '-5' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 192);
eq('plan 8 d - 1 h → ok', evaluateSourceStatus_(def('tempo_plan'), { lastUpdated: at(8 * D - H) }, NOW).status, 'ok');
eq('capacity 8 d - 1 h → ok', evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D - H) }, NOW).status, 'ok');
eq('goals 7 d - 1 h → ok', evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D - H) }, NOW).status, 'ok');
eq('pto 15 d - 1 h → ok', evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D - H) }, NOW).status, 'ok');
const infoBad = allOk.map(r => (r.key === 'kudos' || r.key === 'si') ? Object.assign({}, r, { status: 'failed' })
  : r.key === 'rcr' ? Object.assign({}, r, { status: 'stale' }) : r);
eq('kudos/si/rcr problems never email', buildDigest_SS_(infoBad, NOW, ''), null);
[0, '0', '1,234.5', '85%'].forEach(v => ck('filled number: ' + JSON.stringify(v), isFilledNumber_SS_(v) === true));
['', '-', '#N/A', 'N/A', '(1.2)', '1.2x', null].forEach(v => ck('not a filled number: ' + JSON.stringify(v), isFilledNumber_SS_(v) === false));

// ── Task 4: ledger I/O + wrapper ─────────────────────────────────────────────
function fakeSheet(values) {
  const sh = {
    v: values, fmt: [],
    getDataRange() { return { getValues: () => sh.v.map(r => r.slice()) }; },
    getLastRow() { return sh.v.length; },
    getLastColumn() { return sh.v[0] ? sh.v[0].length : 0; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) { const x = (sh.v[r - 1 + i] || [])[c - 1 + j]; row.push(x === undefined ? '' : x); }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < nr; i++) {
            sh.v[r - 1 + i] = sh.v[r - 1 + i] || [];
            for (let j = 0; j < nc; j++) sh.v[r - 1 + i][c - 1 + j] = vals[i][j];
          }
          return this;
        },
        setNumberFormat(f) { sh.fmt.push([r, c, f]); return this; }, setFontWeight() { return this; },
      };
    },
    setFrozenRows() {},
    getName() { return 'Source Status'; },
  };
  return sh;
}
let LEDGER = null;
const realSpreadsheetApp = global.SpreadsheetApp;
let ACTIVE_ID = 'DASH', OPENED = null, INSERTS = 0, PROP_ID = null;
const realProps = global.PropertiesService;
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (k === SOURCE_STATUS.LEDGER_SS_PROP ? PROP_ID : null), getProperties: () => ({}), setProperty() {} }) };
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getId: () => ACTIVE_ID,
    getSheetByName: n => (n === 'Source Status' ? LEDGER : null),
    insertSheet: () => { INSERTS++; LEDGER = fakeSheet([]); return LEDGER; },
  }),
  openById: id => { OPENED = id; return global.SpreadsheetApp.getActiveSpreadsheet(); },
};

// creates the tab with headers on first write
LEDGER = null;
ck('first record succeeds', recordSourceStatus_('tempo_capacity', { status: 'ok', lastUpdated: NOW, detail: 'Run ok in 3 s' }) === true);
eq('headers written', LEDGER.v[0], SOURCE_STATUS.HEADERS);
eq('seeded: 10 data rows in config order', LEDGER.v.slice(1).map(r => r[0]), SOURCE_STATUS.SOURCES.map(d => d.key));
ck('seeded rows pending + awaiting first update', LEDGER.v.slice(1).every((r, i) => i === 2 || (r[5] === 'pending' && r[6] === 'awaiting first update')));
eq('seeded labels', LEDGER.v[1][1], 'Tempo Tracked');
eq('write hit only its own row', [LEDGER.v[3][0], LEDGER.v[3][1], LEDGER.v[3][5]], ['tempo_capacity', 'Tempo Capacity', 'ok']);
ck('last checked stamped', LEDGER.v[3][4] instanceof Date);
ck('Covers period formatted as text', LEDGER.fmt.some(x => x[1] === 3 && x[2] === '@' && x[0] === 4));
ck('Covers period column seeded as text', LEDGER.fmt.some(x => x[0] === 2 && x[1] === 3 && x[2] === '@'));
eq('other rows untouched', LEDGER.v[2].slice(2), ['', '', '', 'pending', 'awaiting first update', '']);

// overwrites in place, keeps fields not passed
recordSourceStatus_('tempo_capacity', { status: 'failed', detail: 'HTTP 500' });
eq('row count stays 11 incl. header', LEDGER.v.length, 11);
eq('status replaced, last updated kept', [LEDGER.v[3][5], LEDGER.v[3][3] === NOW, LEDGER.v[3][6]], ['failed', true, 'HTTP 500']);

// columns found by name even when reordered
LEDGER = fakeSheet([['Status', 'Source', 'Label', 'Detail', 'Covers period', 'Last updated', 'Last checked', 'Next expected']]);
recordSourceStatus_('kudos', { status: 'ok', detail: 'x' });
eq('reordered columns', [LEDGER.v[1][0], LEDGER.v[1][1]], ['ok', 'kudos']);

// missing key on an older tab appends
LEDGER = fakeSheet([SOURCE_STATUS.HEADERS.slice(), ['kudos', 'Kudos', '', '', '', 'ok', '', '']]);
recordSourceStatus_('pto', { status: 'ok' });
eq('missing key appended', [LEDGER.v.length, LEDGER.v[2][0], LEDGER.v[2][5]], [3, 'pto', 'ok']);

// cleared tab (row 1 empty) is re-seeded
LEDGER = fakeSheet([]);
recordSourceStatus_('kudos', { status: 'ok' });
eq('cleared tab re-seeded', [LEDGER.v[0], LEDGER.v.length], [SOURCE_STATUS.HEADERS, 11]);
LEDGER = fakeSheet([['', '', ''], ['x', 'y', 'z']]);
recordSourceStatus_('kudos', { status: 'ok' });
eq('blank header cells re-seeded', LEDGER.v[0], SOURCE_STATUS.HEADERS);

// ledger spreadsheet selection
LEDGER = fakeSheet([SOURCE_STATUS.HEADERS.slice()]);
PROP_ID = 'LEDGER123'; OPENED = null;
recordSourceStatus_('kudos', { status: 'ok' });
eq('property set → openById with that id', OPENED, 'LEDGER123');
PROP_ID = null; ACTIVE_ID = CONFIG_PS.GOALS_SS_ID; LEDGER = null; INSERTS = 0;
eq('external active workbook refused', recordSourceStatus_('kudos', { status: 'ok' }), false);
eq('nothing inserted in external workbook', INSERTS, 0);
ACTIVE_ID = 'DASH';

// a missing column is swallowed (logged), never thrown
LEDGER = fakeSheet([['Source', 'Label']]);
eq('missing column → false, no throw', recordSourceStatus_('kudos', { status: 'ok' }), false);

// wrapper
const realRecord = recordSourceStatus_;
const CALLS = [];
recordSourceStatus_ = function (k, f) { CALLS.push([k, f]); return true; };
withSourceStatus_('tempo_plan', () => undefined);
eq('wrapper ok key/status', [CALLS[0][0], CALLS[0][1].status], ['tempo_plan', 'ok']);
ck('wrapper ok stamps time + duration', CALLS[0][1].lastUpdated instanceof Date && /^Run ok in \d+ s$/.test(CALLS[0][1].detail));
let threw = null;
try { withSourceStatus_('tempo_plan', () => { throw new Error('Tempo 429'); }); } catch (e) { threw = e.message; }
eq('wrapper rethrows', threw, 'Tempo 429');
eq('wrapper records failure', [CALLS[1][1].status, CALLS[1][1].detail], ['failed', 'Tempo 429']);
const before = CALLS.length;
eq('blocked run returns result', withSourceStatus_('kudos', () => ({ ok: false })).ok, false);
eq('blocked run records nothing', CALLS.length, before);
recordSourceStatus_ = realRecord;

// ── Task 5: edit handler ─────────────────────────────────────────────────────
const EDITS = [];
recordSourceStatus_ = function (k, f) { EDITS.push([k, f]); return true; };
function evt(ssId, sheet, row, numRows, col, numCols) {
  return {
    source: { getId: () => ssId },
    range: { getRow: () => row, getNumRows: () => numRows, getColumn: () => col, getNumColumns: () => numCols,
             getSheet: () => sheet },
  };
}
const ptoSheet = { getName: () => '2023 RD' };
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, ptoSheet, 5, 10, 1, 14));
eq('PTO paste stamps pto', [EDITS[0][0], EDITS[0][1].status, EDITS[0][1].lastUpdated instanceof Date], ['pto', 'ok', true]);
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, ptoSheet, 1, 1, 1, 3));
eq('PTO header-only edit ignored', EDITS.length, 1);
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, ptoSheet, 5, 3, 15, 1));
eq('PTO column O only ignored', EDITS.length, 1);
// Goals grace-window pass-through of the computed ctx is not tested here: it would need a faked clock;
// goalsEditQualifies_SS_ covers the grace logic directly.
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, { getName: () => 'Accumulation Cost' }, 5, 1, 1, 1));
eq('PTO other tab ignored', EDITS.length, 1);
onWatchedEdit({ range: {}, source: {} });
onWatchedEdit({ range: { getRow: 5 }, source: { getId: 'x' } });
onWatchedEdit(undefined);
eq('JSON-only (google.script.run) calls ignored', EDITS.length, 1);

const curQ = computeFiscalContext_(new Date()).goalsQuarter;
const goalsSheet = Object.assign(fakeSheet([
  ['Rocketeer', 'Goal ID', 'Fiscal Quarter'], ['Ana', 'G1', curQ], ['Luis', 'G2', 'FY20Q1'],
]), { getName: () => 'RD' });
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, goalsSheet, 3, 1, 1, 3));
eq('goals edit on old quarter ignored', EDITS.length, 1);
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, goalsSheet, 1, 3, 1, 3));
eq('goals paste incl. current quarter stamps', [EDITS[1][0], EDITS[1][1].status, EDITS[1][1].coversPeriod], ['goals', 'ok', curQ]);
const noFq = Object.assign(fakeSheet([['Rocketeer', 'Goal ID'], ['Ana', 'G1']]), { getName: () => 'RD' });
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, noFq, 2, 1, 1, 2));
eq('goals missing Fiscal Quarter → failed', [EDITS[2][0], EDITS[2][1].status], ['goals', 'failed']);
ck('goals failure lists headers', /Headers found: rocketeer, goal id/.test(EDITS[2][1].detail));
recordSourceStatus_ = realRecord;
global.SpreadsheetApp = realSpreadsheetApp;
global.PropertiesService = realProps;

// ── Task 6: payload reader ───────────────────────────────────────────────────
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: () => null, getProperties: () => ({}), setProperty() {} }) };
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getId: () => 'DASH',
    getSheetByName: n => (n === 'Source Status' ? LEDGER : null),
    insertSheet: () => { LEDGER = fakeSheet([]); return LEDGER; },
  }),
  openById: () => global.SpreadsheetApp.getActiveSpreadsheet(),
};
LEDGER = fakeSheet([SOURCE_STATUS.HEADERS.slice(),
  ['tempo_tracked', 'Tempo Tracked', '2026.W46', at(2 * H), NOW, 'ok', 'Run ok in 40 s', ''],
  ['rcr', 'RCR', 'Oct 26', new Date(2026, 9, 31), NOW, 'ok', 'Oct 26 filled by Finance', ''],
]);
const client = readSourceStatus_();
eq('reader returns every source', client.length, 10);
const trc = client.filter(s => s.key === 'tempo_tracked')[0];
eq('reader client shape', Object.keys(trc).sort(),
   ['coversPeriod', 'detail', 'digest', 'key', 'label', 'lastUpdatedLabel', 'nextExpectedLabel', 'status']);
eq('reader labels with ISO week', trc.lastUpdatedLabel, stampLabel_SS_(at(2 * H)));
ck('reader output is JSON-safe (no Date objects)', JSON.stringify(client) === JSON.stringify(JSON.parse(JSON.stringify(client))) &&
   !client.some(s => Object.values(s).some(v => v instanceof Date)));
eq('unstamped source → pending in reader', client.filter(s => s.key === 'tempo_capacity')[0].status, 'pending');
eq('client covers period from a Date cell is labelled', toClientSource_SS_(
   Object.assign(evaluateSourceStatus_(def('rcr'), { coversPeriod: new Date(2026, 9, 26) }, NOW))).coversPeriod, '2026-10-26 (2026.W44)');
LEDGER = null;
eq('reader with no ledger tab → []', readSourceStatus_(), []);
global.SpreadsheetApp = realSpreadsheetApp;
global.PropertiesService = realProps;

// ── Task 7: digest send + preview (Apps Script glue, stubbed) ────────────────
if (typeof requireMaintainer_ === 'undefined') global.requireMaintainer_ = () => 'me@x.com';
const realRunChecks = runSourceChecks_, realEvalRows = evaluatedRows_SS_, realRec7 = recordSourceStatus_;
let MAILS = [], RECS = [], PROPS7 = {}, MAIL_FAIL = false, RUNS = 0;
global.MailApp = { sendEmail: m => { if (MAIL_FAIL) throw new Error('quota'); MAILS.push(m); } };
global.Session = { getEffectiveUser: () => ({ getEmail: () => 'owner@x.com' }) };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://exec' }) };
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => (PROPS7[k] == null ? null : PROPS7[k]), getProperties: () => ({}), setProperty() {} }) };
runSourceChecks_ = function () { RUNS++; };
recordSourceStatus_ = function (k, f) { RECS.push([k, f]); return true; };
let ROWS7 = allOk;
evaluatedRows_SS_ = function () { return ROWS7; };

eq('recipients default to the owner', digestRecipients_SS_(), 'owner@x.com');
PROPS7[SOURCE_STATUS.DIGEST_RECIPIENTS_PROP] = ' a@x.com, b@x.com ';
eq('recipients from Script Property (trimmed)', digestRecipients_SS_(), 'a@x.com, b@x.com');
eq('dashboard url falls back to the web app url', dashboardUrl_SS_(), 'https://exec');
PROPS7[SOURCE_STATUS.DASHBOARD_URL_PROP] = 'https://dash2';
eq('dashboard url property wins', dashboardUrl_SS_(), 'https://dash2');

ROWS7 = allOk;
eq('nothing wrong → no email', sendSourceHealthDigest(), { sent: false });
eq('no email sent', MAILS.length, 0);
eq('checks run before sending', RUNS, 1);
eq('digest row ok "Nothing to report"', [RECS[0][0], RECS[0][1].status, RECS[0][1].detail], ['digest', 'ok', 'Nothing to report']);

ROWS7 = twoBad;
const sent = sendSourceHealthDigest();
eq('problems → sent with count', sent, { sent: true, count: 2 });
eq('mail to recipients', [MAILS[0].to, /need attention/.test(MAILS[0].subject)], ['a@x.com, b@x.com', true]);
ck('mail body links the dashboard url', /https:\/\/dash2/.test(MAILS[0].body));
eq('digest row records the send', [RECS[1][1].status, RECS[1][1].detail], ['ok', 'Sent: 2 source(s) need attention']);

MAIL_FAIL = true;
let sendErr = null;
try { sendSourceHealthDigest(); } catch (e) { sendErr = e.message; }
eq('send failure rethrown', sendErr, 'quota');
eq('send failure recorded', [RECS[2][1].status, RECS[2][1].detail], ['failed', 'Send failed: quota']);
MAIL_FAIL = false;

MAILS = []; ROWS7 = allOk;
eq('preview returns the caller', previewSourceHealthDigest(), { previewedTo: 'me@x.com' });
eq('preview goes only to the caller', [MAILS.length, MAILS[0].to], [1, 'me@x.com']);
ck('preview says nothing to report yet lists all sources', /^\[Preview\]/.test(MAILS[0].subject) &&
   /nothing to report/.test(MAILS[0].subject) && /All sources:/.test(MAILS[0].body) && /Tempo Capacity: ok/.test(MAILS[0].body));
MAILS = []; ROWS7 = twoBad;
previewSourceHealthDigest();
ck('preview of a real digest keeps the digest body', /Tempo Capacity — STALE/.test(MAILS[0].body) && /All sources:/.test(MAILS[0].body));

runSourceChecks_ = realRunChecks; evaluatedRows_SS_ = realEvalRows; recordSourceStatus_ = realRec7;
global.PropertiesService = realProps;
delete global.MailApp; delete global.Session; delete global.ScriptApp;

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log('source-status-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
