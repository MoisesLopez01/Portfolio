// Node checks for the 3-quarter continuity window (spec 2026-08-18 §3).
// Run: node "ps-dashboard/tests/fiscal-window-checks.js"
const fs = require('fs');
const path = require('path');
global.Logger = { log: function () {} };
eval(fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── prev2 quarter labels across three reference dates ────────────────────────
// FY starts July 1. 2026-08-18 sits in FY27Q1 → prev = FY26Q4, prev2 = FY26Q3.
const ctxAug = computeFiscalContext_(new Date('2026-08-18'));
ck('Aug: prevGoalsQuarter FY26Q4',   ctxAug.prevGoalsQuarter  === 'FY26Q4');
ck('Aug: prev2GoalsQuarter FY26Q3',  ctxAug.prev2GoalsQuarter === 'FY26Q3');

// 2026-01-15 sits in FY26Q3 → prev = FY26Q2 (Oct–Dec 25), prev2 = FY26Q1 (Jul–Sep 25).
const ctxJan = computeFiscalContext_(new Date('2026-01-15'));
ck('Jan: prevGoalsQuarter FY26Q2',   ctxJan.prevGoalsQuarter  === 'FY26Q2');
ck('Jan: prev2GoalsQuarter FY26Q1',  ctxJan.prev2GoalsQuarter === 'FY26Q1');

// 2025-11-01 sits in FY26Q2 → prev = FY26Q1, prev2 = FY25Q4 (crosses the FY boundary).
const ctxNov = computeFiscalContext_(new Date('2025-11-01'));
ck('Nov: prevGoalsQuarter FY26Q1',   ctxNov.prevGoalsQuarter  === 'FY26Q1');
ck('Nov: prev2GoalsQuarter FY25Q4',  ctxNov.prev2GoalsQuarter === 'FY25Q4');

// ── prev2 tiles against prev with no gap (same check style as the existing
//    rollover continuity test): last prev2 week and first prev week are either
//    the same ISO label (mid-week quarter boundary) or calendar-adjacent. ─────
[ctxAug, ctxJan, ctxNov].forEach(function (ctx, i) {
  const p2 = buildPrev2QWeeks_PS_(ctx);
  const p1 = buildPrevQWeeks_PS_(ctx);
  ck('ctx' + i + ': prev2 window non-empty (12–14 weeks)', p2.length >= 12 && p2.length <= 14);
  const lastP2 = p2[p2.length - 1], firstP1 = p1[0];
  const gapDays = Math.round((new Date(firstP1.monday) - new Date(lastP2.sunday)) / 86400000) - 1;
  ck('ctx' + i + ': prev2→prev adjacent (shared label or 0-day gap)',
     lastP2.label === firstP1.label || gapDays === 0);
});

// ── Dedupe logic: three windows concatenated the way getPSReportData does it
//    must contain each ISO label exactly once, current-most copy winning. ─────
const p2 = buildPrev2QWeeks_PS_(ctxAug);
const p1 = buildPrevQWeeks_PS_(ctxAug);
const cur = buildCurrentQWeeks_PS_(ctxAug);
const curLabels = new Set(cur.map(w => w.label));
const p1Labels  = new Set(p1.map(w => w.label));
const continuity = p2.filter(w => !p1Labels.has(w.label) && !curLabels.has(w.label))
  .concat(p1.filter(w => !curLabels.has(w.label)))
  .concat(cur);
const seen = new Set();
let dupes = 0;
continuity.forEach(w => { if (seen.has(w.label)) dupes++; seen.add(w.label); });
ck('3-quarter continuity has no duplicate labels', dupes === 0);
ck('3-quarter continuity spans ≥ 32 weeks (2 closed quarters + QTD as of Aug)', continuity.length >= 32);

// ── TRACKED_HIST_WEEKS must cover the widened window (3 quarters ≈ 40 weeks;
//    extWeeks = TRACKED_HIST_WEEKS + WEEKS_PAST rolling weeks must be ≥ it). ──
ck('TRACKED_HIST_WEEKS + WEEKS_PAST ≥ 41',
   CONFIG_PS.TRACKED_HIST_WEEKS + CONFIG_PS.WEEKS_PAST >= 41);

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
