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

const RH = ['Employee Name', 'Employee ID', 'Sep 26', 'Oct-26'];
const rFull = rcrStatus_SS_(RH, [['A', 1, 1.2, 1.4], ['B', 2, 0.9, '']], new Date(2026, 10, 9));
eq('RCR Oct filled → ok', [rFull.status, rFull.coversPeriod], ['ok', 'Oct-26']);
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

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log('source-status-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
