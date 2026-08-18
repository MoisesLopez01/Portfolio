// Unit tests for the FINANCE-PURE block in GDash.html.
// Run: node tests/finance-stf-gaps.test.js   (exit 0 = all pass)
const fs   = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'gdash', 'GDash.html'), 'utf8');
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

// ── classifyStfReason_: near-miss exception candidate (5/6, bar met) ──
const nm = classifyStfReason_(emp({ stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 5 }));
check('5/6 with bar met → nearMiss flag', nm.nearMiss, true);
check('5/6 with bar met → nearmiss badge replaces needs-comments', nm.badges.map(b => b.kind), ['nearmiss']);
check('5/6 with bar met still primary comments (not eligible)', nm.primary, 'comments');
check('4/6 is NOT a near miss',
  classifyStfReason_(emp({ stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 })).nearMiss, false);
check('5/6 WITHOUT the completion bar is NOT a near miss',
  classifyStfReason_(emp({ stfGoalsCompleted: 7, stfGoalsWithSufficientComments: 5, goalsInProgress: 2 })).nearMiss, false);

// ── buildFinanceRows_: exclusions + totals ──
const mixed = [
  emp({ name: 'NewHire', normName: 'nh', stfGoalsCompleted: 2, isNewHire: true }),
  emp({ name: 'OnLeave', normName: 'ol', stfGoalsCompleted: 2, onLeave: true }),
  emp({ name: 'Elig',    normName: 'el', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 }),
  emp({ name: 'Under',   normName: 'un', stfGoalsCompleted: 3, goalsInProgress: 6 }),
];
const mm = buildFinanceRows_(mixed, false);
check('new-hire & on-leave excluded from evaluated', mm.totals.evaluated, 2); // Elig + Under only
check('one ineligible counted', mm.totals.ineligible, 1);
check('one eligible counted', mm.totals.eligible, 1);
check('pending total = 1', mm.totals.pending, 1);
check('follow-up mode hides eligible rows', mm.rows.map(r => r.name), ['Under']);

// ── buildFinanceRows_: withPending counts open goals across ALL evaluated ──
const pendingMix = [
  emp({ name: 'EligOpen',  normName: 'eo', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6, goalsInProgress: 2 }), // eligible but still has open goals
  emp({ name: 'InelOpen',  normName: 'io', stfGoalsCompleted: 3, goalsPlanned: 5 }),
  emp({ name: 'AllClosed', normName: 'ac', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 6 }),
  emp({ name: 'NewHire2',  normName: 'n2', goalsInProgress: 4, isNewHire: true }), // excluded entirely
];
check('withPending includes eligible people with open goals, excludes new hires',
  buildFinanceRows_(pendingMix, false).totals.withPending, 2);
check('withPending identical in showAll mode (evaluated-wide stat)',
  buildFinanceRows_(pendingMix, true).totals.withPending, 2);

// ── buildFinanceRows_: near-miss counted + carried on rows ──
const nmModel = buildFinanceRows_([
  emp({ name: 'Near', normName: 'nr', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 5 }),
  emp({ name: 'Far',  normName: 'fr', stfGoalsCompleted: 8, stfGoalsWithSufficientComments: 2 }),
], false);
check('totals.nearMiss counts only the 5/6 case', nmModel.totals.nearMiss, 1);
check('row.nearMiss flag carried (worst-first: 2/6 sorts before 5/6)',
  nmModel.rows.map(r => r.nearMiss), [false, true]);

// ── buildFinanceRows_: showAll includes eligible rows, tagged + sorted last ──
const all = buildFinanceRows_(mixed, true);
check('showAll includes everyone evaluated', all.rows.length, 2);
check('eligible row sorted last', all.rows[all.rows.length - 1].name, 'Elig');
check('eligible row tagged eligible:true', all.rows[all.rows.length - 1].eligible, true);
check('eligible row carries no badges', all.rows[all.rows.length - 1].badges, []);

// ── buildFinanceRows_: worst compliance record first, flat (no manager grouping) ──
const sorted = buildFinanceRows_([
  emp({ name: 'MidTie2', normName: 'm2', supervisor: 'Bob',   stfGoalsCompleted: 3, stfGoalsWithSufficientComments: 2, goalsInProgress: 9 }),
  emp({ name: 'Closest', normName: 'cl', supervisor: 'Alice', stfGoalsCompleted: 9, stfGoalsWithSufficientComments: 4 }),
  emp({ name: 'Worst',   normName: 'wo', supervisor: 'Bob',   stfGoalsCompleted: 0, totalGoals: 0 }),
  emp({ name: 'MidTie1', normName: 'm1', supervisor: 'Alice', stfGoalsCompleted: 3, stfGoalsWithSufficientComments: 1, goalsInProgress: 9 }),
], false);
check('flat list sorted completed asc, wellCommented asc, name — managers interleaved',
  sorted.rows.map(r => r.name), ['Worst', 'MidTie1', 'MidTie2', 'Closest']);

// ── buildFinanceRows_: row fields for the table (Emp #, title, manager) ──
const fields = buildFinanceRows_([
  emp({ name: 'F', normName: 'f', employeeNumber: '1042', jobTitle: 'Consultant', supervisor: 'Alice', stfGoalsCompleted: 2, totalGoals: 2 }),
], false).rows[0];
check('empNo carried through', fields.empNo, '1042');
check('jobTitle carried through', fields.jobTitle, 'Consultant');
check('supervisor carried through', fields.supervisor, 'Alice');
check('missing employeeNumber defaults to empty string',
  buildFinanceRows_([emp({ name: 'G', normName: 'g', stfGoalsCompleted: 2, totalGoals: 2 })], false).rows[0].empNo, '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
