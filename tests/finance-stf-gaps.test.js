// Unit tests for the FINANCE-PURE block in GDash.html.
// Run: node tests/finance-stf-gaps.test.js   (exit 0 = all pass)
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'GDash.html'), 'utf8');
const m = src.match(/\/\/ ── FINANCE-PURE-BEGIN ──([\s\S]*?)\/\/ ── FINANCE-PURE-END ──/);
if (!m) { console.error('FAIL: FINANCE-PURE block not found in GDash.html'); process.exit(1); }
eval(m[1]);

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + label + (ok ? '' : ' — got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
}

// Helper to build an employee fixture with sensible zero defaults.
function emp(o) {
  return Object.assign({
    name: 'X', normName: 'x', supervisor: 'Mgr', department: 'Dept',
    stfGoalsCompleted: 0, stfGoalsWithSufficientComments: 0,
    goalsInProgress: 0, goalsPlanned: 0, goalsCanceled: 0, goalsNotCompleted: 0,
    totalGoals: 0, isNewHire: false, onLeave: false,
  }, o);
}

// ── classifyStfReason_: eligibility gate ──
check('eligible → null',
  classifyStfReason_(emp({ stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 })),
  null);

// ── classifyStfReason_: primary reason precedence ──
check('comments primary (8+ completed, under comment bar)',
  classifyStfReason_(emp({ stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 })).primary,
  'comments');
check('pending primary (open goals can still reach 8)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 4 })).primary,
  'pending');
check('canceled primary (pending cannot close gap, something lost)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 1, goalsCanceled: 3 })).primary,
  'canceled');
check('toofew primary (no pipeline at all)',
  classifyStfReason_(emp({ stfGoalsCompleted: 3, totalGoals: 3 })).primary,
  'toofew');
check('toofew primary (orphan: pending<gap, nothing lost)',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 1, totalGoals: 6 })).primary,
  'toofew');

// ── classifyStfReason_: badges are factual + multi ──
check('under-bar with both open and lost → both badge kinds',
  classifyStfReason_(emp({ stfGoalsCompleted: 5, goalsInProgress: 2, goalsCanceled: 1 }))
    .badges.map(b => b.kind).sort(),
  ['canceled', 'pending']);
check('comment-shortfall badge kind present',
  classifyStfReason_(emp({ stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 }))
    .badges.map(b => b.kind),
  ['comments']);

// ── buildFinanceGaps_: threshold boundary ──
const boundaryEmps = [emp({ name: 'A', normName: 'a', stfGoalsCompleted: 7, goalsInProgress: 1 })];
check('completed 7 shown at threshold 7',
  buildFinanceGaps_(boundaryEmps, 7).underBar.length, 1);
check('completed 7 hidden at threshold 6 (counted as hidden)',
  buildFinanceGaps_(boundaryEmps, 6).totals.hidden, 1);
check('completed 7 not in list at threshold 6',
  buildFinanceGaps_(boundaryEmps, 6).underBar.length, 0);

// ── buildFinanceGaps_: comments section is threshold-independent ──
const cmtEmps = [emp({ name: 'C', normName: 'c', stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 })];
check('comment-shortfall shows even at threshold 0',
  buildFinanceGaps_(cmtEmps, 0).commentsShortfall.length, 1);

// ── buildFinanceGaps_: exclusions + totals ──
const mixed = [
  emp({ name: 'NewHire', normName: 'nh', stfGoalsCompleted: 2, isNewHire: true }),
  emp({ name: 'OnLeave', normName: 'ol', stfGoalsCompleted: 2, onLeave: true }),
  emp({ name: 'Elig',    normName: 'el', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 }),
  emp({ name: 'Under',   normName: 'un', stfGoalsCompleted: 3, goalsInProgress: 6 }),
];
const mm = buildFinanceGaps_(mixed, 7);
check('new-hire & on-leave excluded from evaluated', mm.totals.evaluated, 2); // Elig + Under only
check('one ineligible shown', mm.totals.ineligible, 1);
check('pending total = 1', mm.totals.pending, 1);

// ── buildFinanceGaps_: manager grouping sorted worst-first ──
const twoMgrs = [
  emp({ name: 'a1', normName: 'a1', supervisor: 'Alice', stfGoalsCompleted: 1, goalsInProgress: 9 }),
  emp({ name: 'a2', normName: 'a2', supervisor: 'Alice', stfGoalsCompleted: 2, goalsInProgress: 9 }),
  emp({ name: 'b1', normName: 'b1', supervisor: 'Bob',   stfGoalsCompleted: 1, goalsInProgress: 9 }),
];
const g = buildFinanceGaps_(twoMgrs, 7).underBar;
check('worst manager first (Alice has 2)', g[0].supervisor, 'Alice');
check('within-group sorted by completed asc', g[0].rocketeers.map(r => r.completed), [1, 2]);
check('chartRows worst-first by total', buildFinanceGaps_(twoMgrs, 7).chartRows.map(r => r.supervisor), ['Alice', 'Bob']);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
