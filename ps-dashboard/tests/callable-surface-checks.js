// Node checks for the WEB-REACHABLE FUNCTION SURFACE (2026-08-31).
//
// In Apps Script every top-level function without a trailing underscore can be
// invoked via google.script.run by anyone the DEPLOYMENT admits ("Anyone within
// <domain>") — a far wider audience than the dashboard's own role gate. doGet()
// and getPSReportData() were always gated; the exporters, trigger installers and
// name normalisers were not. Before the fix, a colleague holding the link could
// fire a full Tempo export, rewrite live name columns, or call storeCredentials()
// and overwrite the working Tempo/Jira tokens with their "PASTE_..." placeholders.
//
// This suite fails the moment a new ungated public function appears, which is the
// only way to keep that surface closed — it is invisible in the UI and in review.
//
// Run: node "ps-dashboard/tests/callable-surface-checks.js"
const fs   = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..');

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  ❌ ' + name + (detail ? '\n     ' + detail : ''));
}

// Functions that are legitimately reachable without a gate of their own.
const ALLOWED_UNGATED = new Set([
  // doGet IS the gate — it calls checkDashboardAccess() and renders the denied page.
  'doGet',
  // Reports only on the caller's own session; leaks nothing about anyone else.
  'whoAmI',
]);

// A gate is any of these appearing inside the function body.
const GATE_RE = /checkDashboardAccess|requireMaintainer_/;

const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
ck('project .js files found', files.length > 0, 'looked in ' + dir);

// Slice the source into top-level function bodies. GAS files are flat scripts, so
// "next line that starts with `function `" is a reliable body terminator — no need
// to balance braces, and it cannot run past the end of the function it belongs to.
function topLevelFunctions(src) {
  const lines = src.split(/\r?\n/);
  const starts = [];
  lines.forEach((l, i) => {
    // Must match PRIVATE (_-prefixed) declarations too, even though they are not
    // reportable: they are what terminates the previous function's body. Miss them
    // and a public function's slice runs on to the next PUBLIC one, swallowing
    // every private helper in between — which makes an ungated function look gated
    // because some later body in the bleed happened to mention checkDashboardAccess.
    const m = /^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(l);
    if (m) starts.push({ name: m[1], line: i });
  });
  return starts.map((s, k) => ({
    name: s.name,
    body: lines.slice(s.line, k + 1 < starts.length ? starts[k + 1].line : lines.length).join('\n'),
  }));
}

const ungated = [];
let publicCount = 0, gatedCount = 0;

files.forEach(file => {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  topLevelFunctions(src).forEach(fn => {
    // Trailing underscore = private, hidden from google.script.run and from the
    // editor's Run menu. `_test*` helpers are run by hand in the editor.
    if (fn.name.endsWith('_') || fn.name.startsWith('_test')) return;
    if (ALLOWED_UNGATED.has(fn.name)) return;
    publicCount++;
    if (GATE_RE.test(fn.body)) gatedCount++;
    else ungated.push(file + ' → ' + fn.name + '()');
  });
});

ck('every web-reachable function has an access gate', ungated.length === 0,
   ungated.length ? 'UNGATED:\n     - ' + ungated.join('\n     - ') : '');
ck('the scan actually found public functions', publicCount >= 10,
   'found only ' + publicCount);

// ── Spot-checks on the ones that would hurt most ─────────────────────────────
// Named explicitly so a future refactor that drops the guard is caught by name,
// not just by the generic sweep above.
[
  ['TempoPlanExport.js',    'storeCredentials'],       // overwrites live API tokens
  ['TempoPlanExport.js',    'fetchTempoPlannedTime'],  // full export + API quota
  ['TempoTrackedTime.js',   'fetchTempoLoggedTime'],
  ['TempoCapacityTime.js',  'fetchTempoCapacity'],
  ['Change Names.js',       'normalizeAllNames'],      // rewrites live name columns
  ['Change Names.js',       'normalizeCapacityNames'],
].forEach(([file, name]) => {
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  const fn  = topLevelFunctions(src).find(f => f.name === name);
  ck(name + ' exists in ' + file, !!fn);
  if (fn) {
    ck(name + ' is guarded by requireMaintainer_', /requireMaintainer_/.test(fn.body));
    // The guard must be the FIRST statement — a guard placed after the first sheet
    // write or setProperty would let the damage land before it threw.
    const firstStmt = fn.body.split(/\r?\n/).slice(1)
      .find(l => l.trim() && !/^\s*(\/\/|\/\*|\*)/.test(l.trim()));
    ck(name + ': guard runs before any side effect',
       !!firstStmt && /requireMaintainer_/.test(firstStmt),
       'first statement was: ' + (firstStmt || '(none)').trim());
  }
});

// ── The guard itself ─────────────────────────────────────────────────────────
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const guard = topLevelFunctions(security).find(f => f.name === 'requireMaintainer_');
ck('requireMaintainer_ is defined', !!guard);
if (guard) {
  ck('requireMaintainer_ throws rather than returning quietly', /throw new Error/.test(guard.body));
  ck('requireMaintainer_ admits admins and super admins',
     /superAdmins/.test(guard.body) && /admins/.test(guard.body));
  // List-only by design: maintenance rights never come from the roster, and an
  // exporter should not pay for a spreadsheet read on every trigger run.
  ck('requireMaintainer_ does no roster/spreadsheet read',
     !/SpreadsheetApp|_readRosterForAccess_|_resolveRosterSupervisor_/.test(guard.body));
  ck('requireMaintainer_ rejects an unidentified session', /!!email|!email/.test(guard.body));
}

console.log(fail === 0
  ? `✅ callable-surface-checks: ${pass} checks passed (${gatedCount}/${publicCount} public functions gated)`
  : `❌ callable-surface-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
