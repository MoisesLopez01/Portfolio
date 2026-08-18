// Unit tests for the PERIOD-PURE block in PS Dashboard.html.
// Run: node tests/period-buckets.test.js   (exit 0 = all pass)
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'ps-dashboard', 'PS Dashboard.html'), 'utf8');
const m = src.match(/\/\/ ── PERIOD-PURE-BEGIN ──([\s\S]*?)\/\/ ── PERIOD-PURE-END ──/);
if (!m) { console.error('FAIL: PERIOD-PURE block not found in PS Dashboard.html'); process.exit(1); }
eval(m[1]);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (ok ? '' : ' — got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
}

// ── Thursday rule: week → calendar month ──
check('2026.W27 → Jul (Thu Jul 2)',      pMonthKey('2026.W27'), '2026-07');
check('2026.W23 → Jun (Thu Jun 4)',      pMonthKey('2026.W23'), '2026-06');
check('2026.W22 → May (Thu May 28)',     pMonthKey('2026.W22'), '2026-05');
check('2026.W1 → Jan (Thu Jan 1)',       pMonthKey('2026.W1'),  '2026-01');
check('2020.W53 → Dec (Thu Dec 31)',     pMonthKey('2020.W53'), '2020-12');
check('bad label → null',                pMonthKey('W27'),      null);

// ── Month display label ──
check('2026-06 → "Jun 2026"', pMonthLabel('2026-06'), 'Jun 2026');

// ── Thursday rule: week → fiscal quarter (FY starts July) ──
check('2026.W27 → FY27Q1 (Jul)', pFiscalQuarterKey('2026.W27'), 'FY27Q1');
check('2026.W14 → FY26Q4 (Thu Apr 2)', pFiscalQuarterKey('2026.W14'), 'FY26Q4');
check('2026.W13 → FY26Q3 (Thu Mar 26)', pFiscalQuarterKey('2026.W13'), 'FY26Q3');
check('2026.W1 → FY26Q3 (Jan)', pFiscalQuarterKey('2026.W1'), 'FY26Q3');
check('2025.W49 → FY26Q2 (Dec)', pFiscalQuarterKey('2025.W49'), 'FY26Q2');

// ── Week-range label ──
check('same-year range',  pShortRange(['2026.W23', '2026.W24', '2026.W27']), '2026.W23–W27');
check('cross-year range', pShortRange(['2025.W49', '2026.W5']), '2025.W49–2026.W5');
check('single week',      pShortRange(['2026.W23']), '2026.W23');

// ── buildPeriodBuckets: months over a 2026 window, W28 current ──
const labels = [];
for (let w = 14; w <= 28; w++) labels.push('2026.W' + w);
const mb = buildPeriodBuckets(labels, 'month', '2026.W28');
check('month bucket keys', mb.map(b => b.key), ['2026-04', '2026-05', '2026-06', '2026-07']);
// June 2026 by Thursday rule: W23(Thu Jun 4) W24(Jun 11) W25(Jun 18) W26(Jun 25); W27(Thu Jul 2) → July
check('Jun weeks exact', mb[2].weekLabels, ['2026.W23', '2026.W24', '2026.W25', '2026.W26']);
check('Jul weeks exact', mb[3].weekLabels, ['2026.W27', '2026.W28']);
check('Jul contains current → containsCurrent', mb[3].containsCurrent, true);
check('Jul isPartial', mb[3].isPartial, true);
check('Jun is closed', { c: mb[2].containsCurrent, p: mb[2].isPartial }, { c: false, p: false });
check('Apr truncated → isPartial (starts W14, Apr starts W14 Thu Apr 2 = first 7 days → NOT truncated)', mb[0].isPartial, false);
check('range label on Jun', mb[2].weekRangeLabel, '2026.W23–W26');
check('display labels', mb.map(b => b.label), ['Apr 2026', 'May 2026', 'Jun 2026', 'Jul 2026']);

// Truncated oldest bucket: window starting mid-May
const mb2 = buildPeriodBuckets(['2026.W21', '2026.W22', '2026.W23'], 'month', null);
check('truncated May isPartial', mb2[0].isPartial, true);
check('no current week → no containsCurrent', mb2.map(b => b.containsCurrent), [false, false]);

// ── buildPeriodBuckets: quarters ──
const qb = buildPeriodBuckets(labels, 'quarter', '2026.W28');
check('quarter keys', qb.map(b => b.key), ['FY26Q4', 'FY27Q1']);
check('FY26Q4 weeks W14–W26', qb[0].weekLabels[0] + '..' + qb[0].weekLabels[qb[0].weekLabels.length - 1], '2026.W14..2026.W26');
check('FY27Q1 partial', qb[1].isPartial, true);
check('quarter label passthrough', qb[0].label, 'FY26Q4');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
