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

// ── v3.1: exception report (spec 2026-08-18 side-panel wave) ─────────────────
const exLines = perfExceptionReport_([
  { label: 'Goals',   total: 34, ok: 33, missWord: 'missed',    missed: ['2026.W08'] },
  { label: 'Tracked', total: 33, ok: 27, missWord: 'below bar', missed: ['2026.W20', '2026.W21', '2026.W22', '2026.W23', '2026.W24', '2026.W25'] },
  { label: 'PTO',     total: 33, ok: 33, missWord: 'At Risk',   missed: [] },
], 4);
ck('exception: 2 lines (all-ok metric skipped)', exLines.length === 2);
ck('exception: goals line exact',
   exLines[0] === 'Goals: 33 of 34 weeks — missed 2026.W08');
ck('exception: cap at 4 named +2 more',
   exLines[1] === 'Tracked: 27 of 33 weeks — below bar 2026.W20, 2026.W21, 2026.W22, 2026.W23 +2 more');
ck('exception: empty entries → []', perfExceptionReport_([], 4).length === 0);
ck('exception: zero-total entry skipped',
   perfExceptionReport_([{ label: 'Goals', total: 0, ok: 0, missWord: 'missed', missed: [] }], 4).length === 0);

// ── perfCsvEncode_ ───────────────────────────────────────────────────────────
ck('csv quotes commas',  perfCsvEncode_([['a,b', 'c']]) === '"a,b",c');
ck('csv escapes quotes', perfCsvEncode_([['say "hi"']]) === '"say ""hi"""');
ck('csv joins rows with CRLF', perfCsvEncode_([['a'], ['b']]) === 'a\r\nb');

// ── v3: perfFlagTip_ ─────────────────────────────────────────────────────────
function mkCell(label, sig, notEval) { return { col: { id: label.toLowerCase(), label: label }, sig: sig, notEval: !!notEval }; }
ck('flagTip red+yellow mix', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r'), mkCell('Goals','r'), mkCell('PTO','y')]) ===
   'Red: Tracked, Goals · Yellow: PTO — hover each signal for its value vs target');
ck('flagTip reds only', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r'), mkCell('Goals','g')]) ===
   'Red: Tracked — hover each signal for its value vs target');
ck('flagTip empty when clean', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Goals','g'), mkCell('PTO','m')]) === '');
ck('flagTip skips notEval', typeof perfFlagTip_ === 'function' &&
   perfFlagTip_([mkCell('Tracked','r', true), mkCell('PTO','y')]) ===
   'Yellow: PTO — hover each signal for its value vs target');

// ── v3: perfTickStep_ ────────────────────────────────────────────────────────
ck('tickStep n<=max → 1', typeof perfTickStep_ === 'function' && perfTickStep_(8, 10) === 1);
ck('tickStep 26 → 3',     typeof perfTickStep_ === 'function' && perfTickStep_(26, 10) === 3);
ck('tickStep 34 → 4',     typeof perfTickStep_ === 'function' && perfTickStep_(34, 10) === 4);
ck('tickStep 0 → 1',      typeof perfTickStep_ === 'function' && perfTickStep_(0, 10) === 1);

// ── v3: perfBucketAgg_ goals grace ───────────────────────────────────────────
function mkGoalsRk(ok) {
  return { score: 50, trackedHrs: null, plannedHrs: null, ptoNorm: null,
           goalsHasData: true, goalsOk: ok, goalsNorm: ok ? 1 : 0,
           kudosCount: 0, kudosGivenCount: 0, trackedNorm: 0, plannedNorm: 0,
           rcrVal: null, siVal: null };
}
var graceRows = [ { label: '2026.W1', rk: mkGoalsRk(false) },
                  { label: '2026.W2', rk: mkGoalsRk(true)  },
                  { label: '2026.W5', rk: mkGoalsRk(false) } ];
var gAgg = perfBucketAgg_(graceRows, { '2026.W1': true, '2026.W2': true });
ck('grace non-compliant week excluded', gAgg.goalsWeeks === 2);
ck('grace compliant week counted',      gAgg.goalsCompliant === 1);
ck('post-grace red still counts',       gAgg.goals === 0.5);
var gAggNone = perfBucketAgg_(graceRows);
ck('no graceLabels → unchanged',        gAggNone.goalsWeeks === 3 && gAggNone.goalsCompliant === 1);

// ── v3: perfRcrMonthKey_ ─────────────────────────────────────────────────────
ck('rcrMonthKey Jul 25 → 2025-07', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Jul 25') === '2025-07');
ck('rcrMonthKey Dec 26 → 2026-12', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Dec 26') === '2026-12');
ck('rcrMonthKey case/space tolerant', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('  jan 27 ') === '2027-01');
ck('rcrMonthKey junk → null', typeof perfRcrMonthKey_ === 'function' && perfRcrMonthKey_('Total FY26') === null);

// ── v3: goals grace tooltip ──────────────────────────────────────────────────
ck('goals tip mentions grace', /grace weeks count only when compliant/.test(perfThresholdTip_('goals', 'ic', 0.5)));

// ── v3: static markup/state assertions (whole file, not the engine eval) ─────
ck('prFlaggedOnly fully removed', !/prFlaggedOnly/.test(html));
ck('prFlaggedChip fully removed', !/prFlaggedChip/.test(html));
ck('default sort = score desc',   /prSort:\s*\{ key: "score", dir: "desc" \}/.test(html));
ck('KPI card row present',        html.indexOf('class="pr-kpis"') >= 0);
ck('drill grid CSS present',      html.indexOf('.pr-drill-grid { display: grid; grid-template-columns: repeat(2, 1fr)') >= 0);
ck('drill grid collapses ≤900',   /@media \(max-width: 900px\) \{ \.pr-drill-grid \{ grid-template-columns: 1fr; \} \}/.test(html));
ck('PTO heat squares present',    html.indexOf('class="pr-heat ') >= 0);
ck('print mode added',            html.indexOf("classList.add('pr-print')") >= 0);
ck('print mode removed',          (html.match(/classList\.remove\('pr-print'\)/g) || []).length >= 2);
ck('print mode CSS clamps width', /\.pr-drill\.pr-print \{ max-width: 820px/.test(html));
ck('RCR monthly join wired',      html.indexOf('perfRcrMonthKey_(') >= 0 && /agg\.rcr = /.test(html));

// ── v4: perfDeltaTxt_ ────────────────────────────────────────────────────────
ck('delta pct +6%',   typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('goals', 0.80, 0.86) === '+6%');
ck('delta pct −12%',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('tracked', 0.92, 0.80) === '-12%');
ck('delta score −3',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', 86, 83) === '-3');
ck('delta rcr +0.2',  typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('rcr', 2.0, 2.2) === '+0.2');
ck('delta zero → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', 80, 80) === '');
ck('delta categorical → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('kudos', 1, 2) === '');
ck('delta null → ""', typeof perfDeltaTxt_ === 'function' && perfDeltaTxt_('score', null, 80) === '');

// ── v4: static assertions ────────────────────────────────────────────────────
ck('workspace flex + min-width 0', /\.pr-workspace > \.pr-scroll \{ flex: 1 1 auto; min-width: 0; \}/.test(html));
ck('panel width clamp',            html.indexOf('clamp(600px, 40vw, 900px)') >= 0);
ck('container query drawer',       html.indexOf('@container drawer (min-width: 760px)') >= 0);
ck('chart area fill removed',      !/path d="' \+ area/.test(html));
ck('chart target line support',    /opts\.target != null/.test(html));
ck('panel is a dialog',            /role="dialog"/.test(html));
ck('aria-sort present',            /aria-sort="/.test(html));
ck('th scope col',                 html.indexOf('<th scope="col"') >= 0);
ck('row delegation (no inline row onclick)', !/tr class="pr-row[^>]*onclick/.test(html));
ck('kudos wears June',             /pr-star\s*\{\s*color:\s*var\(--june\)/.test(html));
ck('print sheet present',          html.indexOf('@media print') >= 0);
ck('localStorage guarded',         /try \{ localStorage/.test(html));
ck('reduced motion respected',     /prefers-reduced-motion: reduce\) \{ \.pr-panel/.test(html));
ck('scroll gutter stable',         html.indexOf('scrollbar-gutter: stable') >= 0);

// ── 2026.W41 people view: tiers, trend word, plain-English story ─────────────
ck('tier 75 → good',          perfTier_(75) === 'good');
ck('tier 74 → mid',           perfTier_(74) === 'mid');
ck('tier 50 → mid',           perfTier_(50) === 'mid');
ck('tier 49 → bad',           perfTier_(49) === 'bad');
ck('tier null → none',        perfTier_(null) === 'none');
ck('tiers follow score bars', perfTier_(PERF_BARS.score.ic.y) === 'mid' && perfTier_(PERF_BARS.score.ic.g - 1) === 'mid');
ck('avg ignores nulls',       perfAvg_([80, null, 90, NaN]) === 85);
ck('avg empty → null',        perfAvg_([]) === null);
ck('trend +7 → up',           perfTrendWord_(87, 80) === 'up');
ck('trend −7 → down',         perfTrendWord_(73, 80) === 'down');
ck('trend ±6 → flat',         perfTrendWord_(86, 80) === 'flat' && perfTrendWord_(74, 80) === 'flat');
ck('trend missing → flat',    perfTrendWord_(80, null) === 'flat');

function wk(i, score, met, month) {
  return { label: '2026.W' + (28 + i), short: 'W' + (28 + i), month: month || 'September', score: score,
           met: Object.assign({ goals: true, tracked: true, planned: true, kudos: true }, met || {}) };
}
function weeks(scores, metFn) { return scores.map(function(s, i) { return wk(i, s, metFn ? metFn(i) : null); }); }

const steady = perfStory_({ first: 'Ana', weeks: weeks([90, 92, 88, 91, 93, 90, 89, 92, 91, 90, 94, 92, 90]) });
ck('steady strong → Strong',            steady.verdict === 'Strong' && steady.trend === 'flat');
ck('steady strong lead counts weeks',   /75 or higher in 13 of the last 13 scored weeks/.test(steady.lead));
ck('no misses → no recurring gaps',     /No recurring gaps/.test(steady.gap));
ck('no misses → nothing recurring',     steady.ask.length === 1 && /Nothing recurring/.test(steady.ask[0]));
ck('basis counts scored weeks',         /Based on 13 scored weeks/.test(steady.basis));

const up = perfStory_({ first: 'Ben', weeks: weeks([55, 58, 60, 57, 62, 60, 61, 63, 78, 82, 85, 84, 86]) });
ck('rising → Improving',                up.trend === 'up' && up.trendName === '▲ Improving');
ck('rising lead names both averages',   /averaged 84, up from 66/.test(up.lead));

const down = perfStory_({ first: 'Chloe', weeks: weeks([92, 90, 91, 93, 90, 88, 86, 85, 70, 66, 64, 62, 60],
  function(i) { return i >= 9 ? { tracked: false, planned: i !== 10 } : null; }) });
ck('falling → Slipping',                down.trend === 'down' && down.trendName === '▼ Slipping');
ck('falling lead uses possessive',      /^Chloe's score has dropped/.test(down.lead));
ck('ask names the missed weeks',        down.ask.some(function(a) { return /^Logged time was under target in 4 of the last 4 weeks \(W37, W38, W39, W40\)/.test(a); }));
ck('one planned miss is not an ask',    !down.ask.some(function(a) { return /under-planned/.test(a); }));
ck('gap names the worst measure',       /Biggest gap: logged time was under target in 4 of 13 weeks/.test(down.gap));

const low = perfStory_({ first: 'Grace', weeks: weeks([40, 38, 42, 41, 39, 44, 40, 42, 41, 39, 43, 40, 41],
  function() { return { goals: false, tracked: false, planned: false, kudos: false }; }) });
ck('low and flat → Needs a look',       low.verdict === 'Needs a look' && /below the bar/.test(low.lead));
ck('nothing consistent is said plainly', /No measure is met consistently yet/.test(low.strength));
ck('kudos ask only after 4 empty weeks', low.ask.some(function(a) { return a === 'No kudos either way in the last 4 weeks.'; }));

const ramp = perfStory_({ first: 'Farid', ramp: true, weeks: weeks([null, null, null, null, 60, 62, 64, 66, 70, 72, 74, 75, 76]) });
ck('ramp-up verdict never ranks',       ramp.verdict === 'Ramp-up · not ranked' && ramp.verdictTier === 'none');
ck('ramp-up context explains',          ramp.context.some(function(c) { return /ramp-up/.test(c); }));
ck('pre-hire weeks named as no data',   ramp.context.some(function(c) { return /^4 weeks in this period carry no data/.test(c); }));

const leave = perfStory_({ first: 'Dee', onLeave: true, weeks: weeks([null, null, null]) });
ck('on leave → not evaluated lead',     /on extended leave/.test(leave.lead) && leave.verdict === 'On leave');

const crew = perfStory_({ first: 'Hugo', crew: true, ptoWeeks: ['W33'],
  weeks: weeks([88, 90, 89, 91, 90, 92], function() { return { goals: null }; }) });
ck('crew context explains carve',       crew.context.some(function(c) { return /^Crew member/.test(c); }));
ck('PTO weeks named in context',        crew.context.some(function(c) { return /^PTO in W33; the time targets/.test(c); }));
ck('null goals never counted',          !/goals/.test(crew.strength + crew.gap));

const rcr = perfStory_({ first: 'Ana', weeks: weeks([80, 82, 81]),
  rcr: { months: [{ name: 'July', val: 2.6 }, { name: 'August', val: 2.2 }, { name: 'September', val: 1.8 }], bar: 2.0, target: 2.5 } });
ck('RCR line counts months at the bar', /RCR was at or above the 2\.0 bar in 2 of the last 3 months \(latest: 1\.8 in September; target 2\.5\)/.test(rcr.rcrLine));
ck('RCR under the bar is an ask',       rcr.ask.some(function(a) { return a === 'RCR was 1.8 in September, under the 2.0 bar and down from 2.6 in July.'; }));

const empty = perfStory_({ first: 'Zoe', weeks: [] });
ck('no data → says so',                 /no scored weeks/.test(empty.lead) && empty.basis === '');

// ── 2026.W41 Team grid lanes: perfRowDriver_ ─────────────────────────────────
function cellsOf(spec) {
  return Object.keys(spec).map(function(id) {
    var s = spec[id];
    return { id: id, label: s.label || id, sig: s.sig, trend: s.trend || '', delta: s.delta || '', notEval: !!s.ne };
  });
}
const sup = perfRowDriver_(cellsOf({ score: { sig: 'y', trend: '↘', delta: '-9' }, goals: { sig: 'g' },
  tracked: { label: 'Tracked', sig: 'r', trend: '↘', delta: '-12%' }, planned: { label: 'Planned', sig: 'y', trend: '↘', delta: '-8%' } }));
ck('red metric → support lane', sup.lane === 'support');
ck('support why names the red driver first, with trend and delta', sup.text.indexOf('Tracked ↘ -12%') === 0);
ck('support why adds the next falling driver', /Tracked ↘ -12% · Planned ↘ -8%/.test(sup.text));
const fall = perfRowDriver_(cellsOf({ score: { sig: 'y', trend: '↘', delta: '-7' }, goals: { label: 'Goals', sig: 'y', trend: '↘', delta: '-20%' } }));
ck('falling score below green → support even without red', fall.lane === 'support' && /Goals ↘/.test(fall.text));
const cel = perfRowDriver_(cellsOf({ score: { sig: 'g', trend: '↗', delta: '+6' }, goals: { label: 'Goals', sig: 'g', trend: '↗', delta: '+10%' },
  tracked: { label: 'Tracked', sig: 'g' }, kudos: { label: 'Kudos', sig: 'y' } }));
ck('green score, no red → celebrate', cel.lane === 'celebrate');
ck('celebrate why leads with the rising strength', cel.text.indexOf('Strong on Goals ↗ +10%') === 0);
const celWatch = perfRowDriver_(cellsOf({ score: { sig: 'g', trend: '→' }, goals: { label: 'Goals', sig: 'g' }, planned: { label: 'Planned', sig: 'y', trend: '↘', delta: '-15%' } }));
ck('celebrate still flags a falling metric', celWatch.lane === 'celebrate' && /watch Planned ↘ -15%/.test(celWatch.text));
const wat = perfRowDriver_(cellsOf({ score: { sig: 'y', trend: '→' }, kudos: { label: 'Kudos', sig: 'y' } }));
ck('yellow only → watch', wat.lane === 'watch' && wat.text === 'Kudos');
const ex = perfRowDriver_(cellsOf({ score: { sig: 'g' }, goals: { label: 'Goals', sig: 'g' }, tracked: { label: 'Tracked', sig: 'r', ne: true } }));
ck('not-evaluated red never drives a lane', ex.lane === 'celebrate');
const none = perfRowDriver_(cellsOf({ score: { sig: 'y' }, goals: { label: 'Goals', sig: 'g' } }));
ck('nothing to flag → steady', none.lane === 'steady' && none.text === 'No flags');
const nodata = perfRowDriver_(cellsOf({ score: { sig: 'r' }, tracked: { label: 'Tracked', sig: 'm' } }));
ck('no evaluated metric → steady, never support', nodata.lane === 'steady' && nodata.text === 'Not enough evaluated data yet');
const pto = perfRowDriver_(cellsOf({ score: { sig: 'y' }, goals: { label: 'Goals', sig: 'g' }, pto: { label: 'PTO', sig: 'r' } }));
ck('PTO at risk alone → watch, named', pto.lane === 'watch' && pto.text === 'PTO plan at risk');
const ptoCel = perfRowDriver_(cellsOf({ score: { sig: 'g' }, goals: { label: 'Goals', sig: 'g' }, pto: { label: 'PTO', sig: 'r' } }));
ck('PTO at risk on a strong row is a note, not a lane change', ptoCel.lane === 'celebrate' && /PTO plan at risk$/.test(ptoCel.text));
ck('score sorts by value, best first', /if \(s\.key === 'score' && colIdx !== -1\)/.test(html));
ck('grid rows carry lane + why', /lane: drv\.lane, why: drv\.text,/.test(html));
ck('grid has the Why column', html.indexOf("th('flags', 'Why')") >= 0);
ck('celebrate + support focus cards', html.indexOf("k: 'celebrate'") >= 0 && html.indexOf("k: 'support'") >= 0);
ck('CSV exports lane and why', html.indexOf("var header = ['Rocketeer', 'Lane', 'Why',") >= 0);

// ── 2026.W41 static: merged nav + people view wiring ─────────────────────────
ck('Leading Behaviours view removed',   !/id: "rocketeers"/.test(html) && !/id="tabRocketeers"/.test(html));
ck('rocketeers id aliases to perfrecord', /if \(tab === "rocketeers"\) tab = "perfrecord";/.test(html));
ck('Performance Record is 3rd in VIEWS', (function() {
  const ids = (html.match(/\{ id: "([a-z]+)",\s+btnId:/g) || []).map(function(s) { return s.match(/"([a-z]+)"/)[1]; });
  return ids[0] === 'overview' && ids[1] === 'radar' && ids[2] === 'perfrecord';
})());
ck('sidebar button order matches',      html.indexOf('id="tabBtnRadar"') < html.indexOf('id="tabBtnPerfRecord"') &&
                                        html.indexOf('id="tabBtnPerfRecord"') < html.indexOf('id="tabBtnTrends"'));
ck('people view is the default',        /prView:\s+"people"/.test(html));
ck('people view delegates clicks',      !/class="prp-item[^"]*"[^>]*onclick/.test(html));
ck('card is a size container',          /container-type: inline-size; container-name: prpcard;/.test(html));
ck('list sticks under the top bar',     /\.prp-list \{ position: sticky; top: calc\(var\(--topbar-h/.test(html));
ck('phone card is a full-screen sheet', /body\.prp-card-open \.prp-card \{ display: flex; position: fixed; inset: 0;/.test(html));
ck('evidence reuses the drill',         /perfDrillHtml_\(emp, row, perfModel_\(\), \{ embedded: true \}\)/.test(html));
ck('model memo is per granularity',     /var _perfModelByGran = \{\};/.test(html));

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
