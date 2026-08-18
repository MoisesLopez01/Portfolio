// Node checks for the Performance Record pure signal engine (spec 2026-08-18 §5).
// The engine lives between ⟦PERF-ENGINE-START⟧ / ⟦PERF-ENGINE-END⟧ sentinels in
// PS Dashboard.html and must stay free of DATA/STATE/DOM references.
// Run: node "ps-dashboard/tests/perf-record-checks.js"
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');
const S = '⟦PERF-ENGINE-START⟧', E = '⟦PERF-ENGINE-END⟧';
const i0 = html.indexOf(S), i1 = html.indexOf(E);
if (i0 < 0 || i1 < 0) { console.error('❌ engine sentinels not found'); process.exit(1); }
const engine = html.substring(html.indexOf('\n', i0) + 1, html.lastIndexOf('\n', i1));
['DATA', 'STATE', 'document', 'window'].forEach(g => {
  if (new RegExp('\\b' + g + '\\b').test(engine)) {
    console.error('❌ engine references forbidden global: ' + g); process.exit(1);
  }
});
eval(engine);

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── perfSignalFor_: numeric thresholds, cohort-aware ─────────────────────────
ck('tracked IC 0.85 → g',   perfSignalFor_('tracked', 0.85,  'ic')  === 'g');
ck('tracked IC 0.849 → y',  perfSignalFor_('tracked', 0.849, 'ic')  === 'y');
ck('tracked IC 0.55 → y',   perfSignalFor_('tracked', 0.55,  'ic')  === 'y');
ck('tracked IC 0.549 → r',  perfSignalFor_('tracked', 0.549, 'ic')  === 'r');
ck('tracked MGR 0.5 → g',   perfSignalFor_('tracked', 0.5,   'mgr') === 'g');
ck('tracked MGR 0.05 → y (managers never red)', perfSignalFor_('tracked', 0.05, 'mgr') === 'y');
ck('planned MGR 0.70 → g',  perfSignalFor_('planned', 0.70,  'mgr') === 'g');
ck('planned MGR 0.40 → y',  perfSignalFor_('planned', 0.40,  'mgr') === 'y');
ck('planned MGR 0.39 → r',  perfSignalFor_('planned', 0.39,  'mgr') === 'r');
ck('goals 0.80 → g',        perfSignalFor_('goals',   0.80,  'ic')  === 'g');
ck('goals 0.40 → y',        perfSignalFor_('goals',   0.40,  'ic')  === 'y');
ck('goals 0.39 → r',        perfSignalFor_('goals',   0.39,  'ic')  === 'r');
ck('score 75 → g',          perfSignalFor_('score',   75,    'ic')  === 'g');
ck('score 50 → y',          perfSignalFor_('score',   50,    'ic')  === 'y');
ck('score 49 → r',          perfSignalFor_('score',   49,    'ic')  === 'r');
ck('rcr 2.0 → g',           perfSignalFor_('rcr',     2.0,   'ic')  === 'g');
ck('rcr 1.25 → y',          perfSignalFor_('rcr',     1.25,  'ic')  === 'y');
ck('rcr 1.24 → r',          perfSignalFor_('rcr',     1.24,  'ic')  === 'r');
ck('si 4 → g',              perfSignalFor_('si',      4,     'ic')  === 'g');
ck('si 3 → y',              perfSignalFor_('si',      3,     'ic')  === 'y');
ck('si 2 → r',              perfSignalFor_('si',      2,     'ic')  === 'r');
ck('null → m',              perfSignalFor_('tracked', null,  'ic')  === 'm');
ck('undefined → m',         perfSignalFor_('goals',   undefined, 'ic') === 'm');
ck('NaN → m',               perfSignalFor_('score',   NaN,   'ic')  === 'm');

// ── categorical metrics ───────────────────────────────────────────────────────
ck('kudos both → g',        perfSignalFor_('kudos', { recv: 2, gave: 1 }, 'ic') === 'g');
ck('kudos one-sided → y',   perfSignalFor_('kudos', { recv: 2, gave: 0 }, 'ic') === 'y');
ck('kudos none → m (never red)', perfSignalFor_('kudos', { recv: 0, gave: 0 }, 'ic') === 'm');
ck('pto 1 → g',             perfSignalFor_('pto', 1, 'ic') === 'g');
ck('pto 0 → r',             perfSignalFor_('pto', 0, 'ic') === 'r');
ck('pto null → m',          perfSignalFor_('pto', null, 'ic') === 'm');

// ── perfTrend_ ────────────────────────────────────────────────────────────────
ck('score 70→76 = ↗ (eps 5)',   perfTrend_('score', 70, 76)   === '↗');
ck('score 70→74 = → (within eps)', perfTrend_('score', 70, 74) === '→');
ck('tracked 0.8→0.9 = ↗',       perfTrend_('tracked', 0.8, 0.9) === '↗');
ck('tracked 0.9→0.8 = ↘',       perfTrend_('tracked', 0.9, 0.8) === '↘');
ck('missing prev → empty',      perfTrend_('tracked', null, 0.9) === '');
ck('kudos → empty (categorical)', perfTrend_('kudos', { recv: 1, gave: 1 }, { recv: 0, gave: 0 }) === '');
ck('pto → empty (categorical)', perfTrend_('pto', 1, 0) === '');

// ── perfBucketAgg_ ────────────────────────────────────────────────────────────
function rk(o) {
  return Object.assign({
    score: 50, goalsNorm: 0, goalsOk: false, goalsHasData: false,
    trackedNorm: 0, trackedHrs: null, plannedNorm: 0, plannedHrs: null,
    rcrNorm: null, rcrVal: null, kudosNorm: 0, kudosCount: 0, kudosGivenCount: 0,
    siNorm: null, siVal: null, ptoNorm: null, ptoStatus: null,
  }, o);
}
const agg = perfBucketAgg_([
  { label: '2026.W20', rk: rk({ score: 80, goalsHasData: true, goalsOk: true,  trackedNorm: 1.0, trackedHrs: 40, plannedNorm: 1.0, plannedHrs: 40, kudosCount: 1, ptoNorm: 1, rcrVal: 2.2, siVal: 4 }) },
  { label: '2026.W21', rk: rk({ score: 60, goalsHasData: true, goalsOk: false, trackedNorm: 0.5, trackedHrs: 18, plannedNorm: 0.8, plannedHrs: 32, kudosGivenCount: 1, ptoNorm: 0 }) },
  { label: '2026.W22', rk: rk({ score: 40, goalsHasData: false,                trackedNorm: 0.7, trackedHrs: 25, plannedNorm: 0.9, plannedHrs: 36 }) },
]);
ck('agg.weeks = 3',                agg.weeks === 3);
ck('agg.score = 60 (avg 80/60/40)', agg.score === 60);
ck('agg.goals = 0.5 (1 of 2 weeks WITH data)', agg.goals === 0.5);
ck('agg.goalsWeeks = 2',           agg.goalsWeeks === 2);
ck('agg.goalsCompliant = 1',       agg.goalsCompliant === 1);
ck('agg.tracked ≈ 0.733',          Math.abs(agg.tracked - (1.0 + 0.5 + 0.7) / 3) < 1e-9);
ck('agg.trackedHrs = 83',          agg.trackedHrs === 83);
ck('agg.plannedHrs = 108',         agg.plannedHrs === 108);
ck('agg.kudos = {recv:1, gave:1}', agg.kudos.recv === 1 && agg.kudos.gave === 1);
ck('agg.pto = 0 (LAST snapshot in bucket)', agg.pto === 0);
ck('agg.rcr = 2.2 (last non-null)', agg.rcr === 2.2);
ck('agg.si = 4 (last non-null)',   agg.si === 4);

// Empty weeks (pre-hire: everything null/0, no goals data) are excluded entirely.
const agg2 = perfBucketAgg_([
  { label: '2026.W20', rk: rk({}) },  // empty week — no hours, no plan, no kudos, no goals, no pto
  { label: '2026.W21', rk: rk({ score: 90, trackedNorm: 1.0, trackedHrs: 40, plannedNorm: 1.0, plannedHrs: 40, goalsHasData: true, goalsOk: true }) },
]);
ck('empty weeks excluded: score = 90', agg2.score === 90);
ck('empty weeks excluded: weeks = 1',  agg2.weeks === 1);
const agg3 = perfBucketAgg_([{ label: '2026.W20', rk: null }]);
ck('all-null bucket → score null',     agg3.score === null);
ck('all-null bucket → kudos zeros',    agg3.kudos.recv === 0 && agg3.kudos.gave === 0);

// ── perfReadingNote_ ─────────────────────────────────────────────────────────
const noteAllGreen = perfReadingNote_([
  { id: 'goals', label: 'Goals', sig: 'g', trend: '→' },
  { id: 'tracked', label: 'Tracked', sig: 'g', trend: '↗' },
]);
ck('all-green note mentions green', noteAllGreen.indexOf('green across window') === 0);
const noteFlagged = perfReadingNote_([
  { id: 'goals', label: 'Goals', sig: 'r', trend: '↘' },
  { id: 'tracked', label: 'Tracked', sig: 'y', trend: '↘' },
  { id: 'planned', label: 'Planned', sig: 'g', trend: '→' },
]);
ck('flagged note lists worst-first', noteFlagged.indexOf('support: goals, tracked') === 0);
ck('flagged note counts declines',   noteFlagged.indexOf('2 declining') !== -1);

// ── v2 engine additions (spec 2026-08-18 performance-record-v2) ─────────────
// perfQuarterRank_
ck('qrank FY27Q1 > FY26Q4', perfQuarterRank_('FY27Q1') > perfQuarterRank_('FY26Q4'));
ck('qrank bad → -1',        perfQuarterRank_('nope') === -1);

// perfTenureLabel_(hireMs, nowMs) — deterministic via fixed nowMs
const NOW = Date.UTC(2026, 7, 18); // 2026-08-18
ck('tenure null → empty',   perfTenureLabel_(null, NOW) === '');
ck('tenure 3y 2m',          perfTenureLabel_(Date.UTC(2023, 5, 10), NOW) === '3y 2m');
ck('tenure 8m',             perfTenureLabel_(Date.UTC(2025, 11, 12), NOW) === '8m');
ck('tenure <1m → weeks',    perfTenureLabel_(Date.UTC(2026, 7, 1), NOW) === '2w');
ck('tenure future → empty', perfTenureLabel_(Date.UTC(2027, 0, 1), NOW) === '');

// perfSiRecords_(histMap, currentQ): last 2 closed rated + current (idle when unrated)
const rec1 = perfSiRecords_({ 'FY26Q2': 5, 'FY26Q3': 3, 'FY26Q4': 4 }, 'FY27Q1');
ck('si: 2 closed + idle current = 3 entries', rec1.length === 3);
ck('si: keeps the LAST 2 closed, oldest first',
   rec1[0].q === 'FY26Q3' && rec1[0].v === 3 && rec1[1].q === 'FY26Q4' && rec1[1].v === 4);
ck('si: unrated current = idle, never a placeholder',
   rec1[2].q === 'FY27Q1' && rec1[2].v === null && rec1[2].current === true);
const rec2 = perfSiRecords_({ 'FY26Q4': 4, 'FY27Q1': 5 }, 'FY27Q1');
ck('si: rated current kept as current', rec2[rec2.length - 1].v === 5 && rec2[rec2.length - 1].current === true);
ck('si: single closed record → 2 entries', rec2.length === 2);
const rec3 = perfSiRecords_(null, 'FY27Q1');
ck('si: no history → lone idle current', rec3.length === 1 && rec3[0].v === null && rec3[0].current === true);
ck('si dot value = latest CLOSED rated', perfSiLatestClosed_(rec1) === 4);
ck('si dot value: nothing rated → null', perfSiLatestClosed_(rec3) === null);

// perfBurnout_(ptoVal, trackedVal): PTO At-Risk AND tracked at/above target
ck('burnout: pto 0 + tracked 1.0 → true',  perfBurnout_(0, 1.0) === true);
ck('burnout: pto 0 + tracked .95 → false', perfBurnout_(0, 0.95) === false);
ck('burnout: pto Good + tracked 1.2 → false', perfBurnout_(1, 1.2) === false);
ck('burnout: null tracked → false',        perfBurnout_(0, null) === false);

// perfThresholdTip_(metricId, cohort, val)
ck('tip tracked IC', perfThresholdTip_('tracked', 'ic', 0.62) ===
   'Tracked 62% of target — IC bar: green ≥85% · yellow ≥55% · below is red');
ck('tip tracked MGR says never red', perfThresholdTip_('tracked', 'mgr', 0.3).indexOf('never red') !== -1);
ck('tip score', perfThresholdTip_('score', 'ic', 18) ===
   'Score 18 — target: green ≥75 · yellow ≥50 · below is red');
ck('tip kudos never red', perfThresholdTip_('kudos', 'ic', { recv: 1, gave: 0 }).indexOf('never red') !== -1);
ck('tip pto', perfThresholdTip_('pto', 'ic', 0) === 'PTO At Risk — Good = green · At Risk = red');
ck('tip no data', perfThresholdTip_('tracked', 'ic', null) === 'Tracked — no data');

// ── perfCsvEncode_ ───────────────────────────────────────────────────────────
ck('csv quotes commas',  perfCsvEncode_([['a,b', 'c']]) === '"a,b",c');
ck('csv escapes quotes', perfCsvEncode_([['say "hi"']]) === '"say ""hi"""');
ck('csv joins rows with CRLF', perfCsvEncode_([['a'], ['b']]) === 'a\r\nb');

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
