// Node checks for the Super Admin tier + self-exclusion (2026-08-31).
//
// Covers the three rules that are easy to break silently and impossible to see
// in a screenshot:
//   1. Role resolution order — superadmin outranks admin outranks viewer.
//   2. Nobody but a superadmin sees their OWN row in the payload.
//   3. The shared full-roster cache entry is personalised per caller, so a
//      viewer can never inherit the role frozen into a superadmin-built entry.
//
// Run: node "ps-dashboard/tests/access-tier-checks.js"
const fs   = require('fs');
const path = require('path');

const dir      = path.join(__dirname, '..');
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const report   = fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8');
const teams    = fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8');

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

// ── Harness ──────────────────────────────────────────────────────────────────
// The GAS files are plain scripts, so a scoped eval with stubbed globals is
// enough to exercise the pure parts. Only the functions under test are lifted.
const Logger = { log: () => {} };
const props  = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }),
};

// Roster rows the fake _readRosterForAccess_ serves.
let ROSTER_ROWS = [];
function _readRosterForAccess_() { return { ok: true, rows: ROSTER_ROWS, tab: 'Data', error: null }; }

// Lift the pieces of PS Security.js that don't touch SpreadsheetApp.
const secSlice = [
  extract(security, 'const SEC_ = {', '\n};'),
  extract(security, 'function isSuperAdmin_', '\n}'),
  extract(security, 'function hasAdminPower_', '\n}'),
  extract(security, 'function canManageAdmins_', '\n}'),
  extract(security, 'function _normName_', '\n}'),
  extract(security, 'function isTeamScoped_', '\n}'),
  extract(security, 'function _autoAccessAllows_', '\n}'),
  extract(security, 'function _activeSupervisorName_', '\n}'),
  extract(security, 'function _resolveRosterSupervisor_', '\n}'),
  extract(security, 'function _resolveSelfRosterName_', '\n}'),
  extract(security, 'function resolveTeamScope_', '\n}'),
  extract(security, 'function _readAccessLists_', '\n}'),
  extract(security, 'function _resolveAccessFor_', '\n}'),
  extract(security, 'function resolveViewAsAccess_', '\n}'),
].join('\n');

// Self-exclusion lives in the report file and uses normPS_ from the same file.
// teamForProfile_ (PS Teams.js) is what resolveTeamScope_ derives the pin with —
// lifting the real one keeps the test honest about the Class → team rule.
const repSlice = [
  extract(report, 'function normPS_', '\n}'),
  extract(report, 'function normTitleKey_', '\n}'),
  extract(report, 'function parseJobCode_', '\n}'),
  extract(report, 'function titleCodeInfo_', '\n}'),
  extract(report, 'function seesFullRoster_', '\n}'),
  extract(report, 'function applySelfExclusion_', '\n}'),
  extract(teams,  'function teamForProfile_', '\n}'),
  extract(teams,  'const TEAMS_ = [', '\n];'),
  extract(teams,  'function teamByKey_', '\n}'),
  extract(teams,  'function teamRoster_', '\n}'),
  extract(teams,  'function availableTeams_', '\n}'),
  extract(report, 'function resolveManagerScope_', '\n}'),
].join('\n');

function extract(src, startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) { console.error('❌ could not find: ' + startsWith); process.exit(1); }
  const j = src.indexOf(endsWith, i);
  if (j < 0) { console.error('❌ could not close: ' + startsWith); process.exit(1); }
  return src.slice(i, j + endsWith.length);
}

const _SEC_ROSTER_MEMO_ = null;
// Assigned from inside resolveTeamScope_, so it must be a binding, not a const null.
let _SEC_TEAMSCOPE_MEMO_ = null;
// The Class → team rule reads these two from the report's config.
const CONFIG_PS = { PS_CLASS: 'Professional Services', PS_DEPT: 'Services', SALES_DEPT: 'Sales' };
const COE_FAMILY_CODE_ = 'JF004';
const SA_FAMILY_CODE_  = 'JF018';
// eslint-disable-next-line no-eval
const api = eval('(function(){' + secSlice + '\n' + repSlice +
  '\nreturn { SEC_, isSuperAdmin_, hasAdminPower_, _readAccessLists_, _resolveAccessFor_,' +
  ' _resolveSelfRosterName_, _resolveRosterSupervisor_, seesFullRoster_,' +
  ' isTeamScoped_, resolveTeamScope_, teamForProfile_, _autoAccessAllows_,' +
  ' resolveManagerScope_, availableTeams_, teamRoster_, teamByKey_, canManageAdmins_,' +
  ' applySelfExclusion_, normPS_, resolveViewAsAccess_ };})()');

const BOOT = api.SEC_.BOOTSTRAP_ADMIN.toLowerCase();
function reset() {
  Object.keys(props).forEach(k => delete props[k]);
  ROSTER_ROWS = [];
}

// ── 1. Role helpers ──────────────────────────────────────────────────────────
ck('isSuperAdmin_ accepts a role string',   api.isSuperAdmin_('superadmin') === true);
ck('isSuperAdmin_ accepts an access object', api.isSuperAdmin_({ role: 'superadmin' }) === true);
ck('isSuperAdmin_ rejects admin',            api.isSuperAdmin_('admin') === false);
ck('hasAdminPower_ true for superadmin',     api.hasAdminPower_('superadmin') === true);
ck('hasAdminPower_ true for admin',          api.hasAdminPower_('admin') === true);
ck('hasAdminPower_ false for viewer',        api.hasAdminPower_('viewer') === false);
ck('hasAdminPower_ false for manager',       api.hasAdminPower_('manager') === false);

// seesFullRoster_ and the cache key must agree on exactly one set of roles.
['superadmin', 'admin', 'viewer'].forEach(r =>
  ck('seesFullRoster_ ' + r, api.seesFullRoster_({ role: r }) === true));
ck('seesFullRoster_ manager', api.seesFullRoster_({ role: 'manager' }) === false);

// ── 2. List merge ────────────────────────────────────────────────────────────
reset();
let lists = api._readAccessLists_();
ck('bootstrap anchors the SUPER list', lists.superAdmins.indexOf(BOOT) !== -1);
ck('bootstrap is NOT in the admin list', lists.admins.indexOf(BOOT) === -1);

reset();
props['PS_DASH_SUPER_ADMINS'] = 'sa@x.com';
props['PS_DASH_ADMINS']       = 'sa@x.com,admin@x.com';
lists = api._readAccessLists_();
ck('runtime super admin is picked up', lists.superAdmins.indexOf('sa@x.com') !== -1);
ck('an email on both lists is de-duped out of admins', lists.admins.indexOf('sa@x.com') === -1);
ck('a plain admin survives the de-dupe', lists.admins.indexOf('admin@x.com') !== -1);

// ── 3. Role resolution order ─────────────────────────────────────────────────
reset();
props['PS_DASH_SUPER_ADMINS'] = 'sa@x.com';
props['PS_DASH_ADMINS']       = 'sa@x.com,admin@x.com';
props['PS_DASH_VIEWERS']      = 'viewer@x.com';
ROSTER_ROWS = [
  { name: 'Super Person', normName: 'super person', email: 'sa@x.com',     active: true,  supervisor: '', normSupervisor: '' },
  { name: 'Admin Person', normName: 'admin person', email: 'admin@x.com',  active: true,  supervisor: '', normSupervisor: '' },
  { name: 'View Person',  normName: 'view person',  email: 'viewer@x.com', active: true,  supervisor: '', normSupervisor: '' },
  { name: 'Gone Person',  normName: 'gone person',  email: 'gone@x.com',   active: false, supervisor: '', normSupervisor: '' },
];

eq('super beats admin', api._resolveAccessFor_('sa@x.com').role, 'superadmin');
eq('admin resolves',    api._resolveAccessFor_('admin@x.com').role, 'admin');
eq('viewer resolves',   api._resolveAccessFor_('viewer@x.com').role, 'viewer');
eq('unknown denied',    api._resolveAccessFor_('nobody@x.com').role, 'denied');
eq('empty session denied', api._resolveAccessFor_('').role, 'denied');

// selfRosterName rides along on every allowed verdict — that is what the strip keys off.
eq('superadmin carries selfRosterName', api._resolveAccessFor_('sa@x.com').selfRosterName, 'Super Person');
eq('admin carries selfRosterName',      api._resolveAccessFor_('admin@x.com').selfRosterName, 'Admin Person');
eq('viewer carries selfRosterName',     api._resolveAccessFor_('viewer@x.com').selfRosterName, 'View Person');
eq('denied carries no selfRosterName',  api._resolveAccessFor_('nobody@x.com').selfRosterName, null);
eq('a terminated row never resolves as self', api._resolveSelfRosterName_('gone@x.com'), null);
eq('an empty email never resolves as self',   api._resolveSelfRosterName_(''), null);

// ── 4. Self-exclusion strip ──────────────────────────────────────────────────
function samplePayload() {
  return {
    ok: true,
    userRole:  'superadmin',       // as frozen in by whoever built the shared entry
    userEmail: 'builder@x.com',
    employees: [
      { name: 'View Person', normName: 'view person', si: { value: 4 } },
      { name: 'Other One',   normName: 'other one',   si: { value: 3 } },
    ],
    topPerformers: { week: '2026.W35', performers: [
      { name: 'View Person', normName: 'view person', score: 91 },
      { name: 'Other One',   normName: 'other one',   score: 70 },
    ] },
    goalsAudit:   [{ normName: 'view person' }, { normName: 'other one' }],
    ptoQ4History: [{ label: '2026.W35', byEmp: { 'view person': 'good', 'other one': 'good' } }],
    goalsQ4Hist:  { '2026.W35': { 'view person': { selfCommentCount: 2 }, 'other one': { selfCommentCount: 1 } } },
    meta: {
      siByEmployee:  { 'view person': { FY26Q4: 4 }, 'other one': { FY26Q4: 3 } },
      rcrByEmployee: { 'view person': { 'Jul 26': 2.1 }, 'other one': { 'Jul 26': 1.4 } },
    },
  };
}

const viewerAccess = { role: 'viewer', email: 'viewer@x.com', selfRosterName: 'View Person' };
let p = api.applySelfExclusion_(samplePayload(), viewerAccess);

eq('viewer: own employee row gone', p.employees.map(e => e.normName), ['other one']);
eq('viewer: own top-performer row gone', p.topPerformers.performers.map(e => e.normName), ['other one']);
eq('viewer: own goals-audit row gone', p.goalsAudit.map(e => e.normName), ['other one']);
ck('viewer: own PTO history entry gone', !('view person' in p.ptoQ4History[0].byEmp));
ck('viewer: own goals history entry gone', !('view person' in p.goalsQ4Hist['2026.W35']));
ck('viewer: own SI gone', !('view person' in p.meta.siByEmployee));
ck('viewer: own RCR gone', !('view person' in p.meta.rcrByEmployee));
ck('viewer: everyone else keeps their SI', p.meta.siByEmployee['other one'].FY26Q4 === 3);
eq('viewer: selfExcluded flagged', p.meta.selfExcluded, true);
eq('viewer: selfName reported for the UI note', p.meta.selfName, 'View Person');

// The personalisation half — the shared cache entry must never leak its builder's role.
eq('viewer: userRole re-stamped per caller', p.userRole, 'viewer');
eq('viewer: userEmail re-stamped per caller', p.userEmail, 'viewer@x.com');

// Admins are self-excluded too — only superadmin is exempt.
const adminAccess = { role: 'admin', email: 'admin@x.com', selfRosterName: 'Other One' };
p = api.applySelfExclusion_(samplePayload(), adminAccess);
eq('admin: own row gone', p.employees.map(e => e.normName), ['view person']);
eq('admin: userRole re-stamped', p.userRole, 'admin');

// Superadmin keeps everything, including themselves.
const superAccess = { role: 'superadmin', email: 'sa@x.com', selfRosterName: 'View Person' };
p = api.applySelfExclusion_(samplePayload(), superAccess);
eq('superadmin: nothing stripped', p.employees.map(e => e.normName), ['view person', 'other one']);
eq('superadmin: selfExcluded false', p.meta.selfExcluded, false);
ck('superadmin: own SI kept', 'view person' in p.meta.siByEmployee);

// A caller who isn't on the roster has nothing to strip — and the flags must SAY so.
// selfExcluded drives the header badge's "Your own record is not shown here", so a
// `true` here would tell the caller their row is hidden while it is still in the
// payload. That combination — no enforcement plus a false assurance — is the failure
// this pair of assertions exists to prevent; selfUnresolved is what the UI and the
// log key on to surface the unmatched roster Email cell.
const externalAccess = { role: 'viewer', email: 'ext@partner.com', selfRosterName: null };
p = api.applySelfExclusion_(samplePayload(), externalAccess);
eq('off-roster viewer: roster intact', p.employees.length, 2);
eq('off-roster viewer: NOT falsely flagged as self-excluded', p.meta.selfExcluded, false);
eq('off-roster viewer: flagged as unresolved instead', p.meta.selfUnresolved, true);
// The resolvable case keeps both flags honest in the other direction.
p = api.applySelfExclusion_(samplePayload(), viewerAccess);
eq('on-roster viewer: selfExcluded true', p.meta.selfExcluded, true);
eq('on-roster viewer: selfUnresolved false', p.meta.selfUnresolved, false);

// A denied/errored payload passes through untouched.
const errPayload = { ok: false, denied: true, email: 'x@x.com' };
eq('denied payload untouched', api.applySelfExclusion_(errPayload, viewerAccess), errPayload);

// ── 5. Auto-manager access policy (SEC_.MANAGER_AUTO_ACCESS) ─────────────────
// "Can any manager with the shared link get in?" — this is the switch that
// answers it. Default "any-org" is the historical behaviour: yes, they can.
reset();
ROSTER_ROWS = [
  { name: 'PS Boss',  normName: 'ps boss',  email: 'psboss@x.com',  active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services' },
  { name: 'PS Report', normName: 'ps report', email: 'psrep@x.com', active: true,
    supervisor: 'PS Boss', normSupervisor: 'ps boss', cls: 'Professional Services', dept: 'Services' },
  { name: 'Fin Boss', normName: 'fin boss', email: 'finboss@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Corporate', dept: 'Finance' },
  { name: 'Fin Report', normName: 'fin report', email: 'finrep@x.com', active: true,
    supervisor: 'Fin Boss', normSupervisor: 'fin boss', cls: 'Corporate', dept: 'Finance' },
  { name: 'Lone IC',  normName: 'lone ic',  email: 'ic@x.com',      active: true,
    supervisor: 'PS Boss', normSupervisor: 'ps boss', cls: 'Professional Services', dept: 'Services' },
];

api.SEC_.MANAGER_AUTO_ACCESS = 'any-org';
eq('any-org: a PS manager auto-resolves',      api._resolveRosterSupervisor_('psboss@x.com'), 'PS Boss');
eq('any-org: a FINANCE manager auto-resolves too — this is the open door',
   api._resolveRosterSupervisor_('finboss@x.com'), 'Fin Boss');
eq('any-org: an IC with no reports never resolves', api._resolveRosterSupervisor_('ic@x.com'), null);
eq('any-org: an unknown email never resolves',      api._resolveRosterSupervisor_('stranger@x.com'), null);
eq('any-org: an empty session never resolves',      api._resolveRosterSupervisor_(''), null);

api.SEC_.MANAGER_AUTO_ACCESS = 'off';
eq('off: even a PS manager is refused',      api._resolveRosterSupervisor_('psboss@x.com'), null);
eq('off: a finance manager is refused',      api._resolveRosterSupervisor_('finboss@x.com'), null);

api.SEC_.MANAGER_AUTO_ACCESS = 'classes';
api.SEC_.MANAGER_AUTO_ACCESS_SCOPE = ['Professional Services'];
eq('classes: in-scope Class is allowed',     api._resolveRosterSupervisor_('psboss@x.com'), 'PS Boss');
eq('classes: out-of-scope manager refused',  api._resolveRosterSupervisor_('finboss@x.com'), null);
api.SEC_.MANAGER_AUTO_ACCESS_SCOPE = ['finance'];
eq('classes: Department also matches, case-insensitively',
   api._resolveRosterSupervisor_('finboss@x.com'), 'Fin Boss');
api.SEC_.MANAGER_AUTO_ACCESS_SCOPE = [];
eq('classes: an empty scope list lets nobody in (fail closed)',
   api._resolveRosterSupervisor_('psboss@x.com'), null);

// Explicit lists must keep working no matter what the auto policy says.
api.SEC_.MANAGER_AUTO_ACCESS = 'off';
props['PS_DASH_DELEGATES'] = 'proxy@x.com:PS Boss';
eq('off: an explicit delegate still gets manager access',
   api._resolveAccessFor_('proxy@x.com').role, 'manager');
eq('off: …scoped to the named supervisor',
   api._resolveAccessFor_('proxy@x.com').delegateScopeName, 'PS Boss');
eq('off: a supervisor with no delegate entry is denied',
   api._resolveAccessFor_('psboss@x.com').role, 'denied');

// The audit in diagnosePSAccess and the enforcement in _resolveRosterSupervisor_
// must agree — an audit that reports ✅ for someone the policy would turn away is
// worse than no audit. Both go through _autoAccessAllows_, checked here directly.
const psRow  = ROSTER_ROWS[0];   // Professional Services
const finRow = ROSTER_ROWS[2];   // Corporate / Finance
api.SEC_.MANAGER_AUTO_ACCESS = 'any-org';
ck('any-org: policy allows PS',      api._autoAccessAllows_(psRow).ok === true);
ck('any-org: policy allows Finance', api._autoAccessAllows_(finRow).ok === true);
api.SEC_.MANAGER_AUTO_ACCESS = 'off';
ck('off: policy blocks everyone',    api._autoAccessAllows_(psRow).ok === false);
ck('off: …with a reason naming the setting',
   api._autoAccessAllows_(psRow).why.indexOf('MANAGER_AUTO_ACCESS') !== -1);
api.SEC_.MANAGER_AUTO_ACCESS = 'classes';
api.SEC_.MANAGER_AUTO_ACCESS_SCOPE = ['Professional Services'];
ck('classes: policy allows in-scope',  api._autoAccessAllows_(psRow).ok === true);
ck('classes: policy blocks out-of-scope', api._autoAccessAllows_(finRow).ok === false);
// Whatever the policy says, the resolver must say the same thing.
['any-org', 'off', 'classes'].forEach(mode => {
  api.SEC_.MANAGER_AUTO_ACCESS = mode;
  ['psboss@x.com', 'finboss@x.com'].forEach(em => {
    const row = ROSTER_ROWS.find(r => r.email === em);
    const policyOk = api._autoAccessAllows_(row).ok;
    const resolved = api._resolveRosterSupervisor_(em) !== null;
    ck('audit and enforcement agree — ' + mode + ' / ' + em, policyOk === resolved);
  });
});

// Restore the shipped default so later source assertions read the real file.
api.SEC_.MANAGER_AUTO_ACCESS = 'any-org';
api.SEC_.MANAGER_AUTO_ACCESS_SCOPE = ['Professional Services'];

// ── 5b. Team pin — viewers see ONE org team, derived from their roster Class ─
reset();
ROSTER_ROWS = [
  { name: 'PS Person',    normName: 'ps person',    email: 'ps@x.com',    active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services', jobTitle: 'Consultant' },
  { name: 'Eng Person',   normName: 'eng person',   email: 'eng@x.com',   active: true,
    supervisor: '', normSupervisor: '', cls: 'Corporate', dept: 'Engineering', jobTitle: 'Software Engineer' },
  { name: 'Sales Person', normName: 'sales person', email: 'sales@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Corporate', dept: 'Sales',
    jobTitle: '04.I5.3 - Senior Representative II, Account Management' },
  // 2026.W36: Solution Architecture (JF018) moved to Sales & Success. HRIS keeps
  // the Class at "Professional Services" and re-departments the row to "Sales".
  { name: 'SA Person',    normName: 'sa person',    email: 'sa@x.com',    active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Sales',
    jobTitle: '18.I4.1 - Senior Consultant I, Solution Architecture' },
  // Title coded JF018 but Department not yet moved — the family code alone decides.
  { name: 'SA Early',     normName: 'sa early',     email: 'sa-early@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services',
    jobTitle: '18.M5.2 - Manager, Solution Architecture' },
  // Department moved but title uncatalogued and unprefixed — Department alone decides.
  { name: 'PS Re-dept',   normName: 'ps re-dept',   email: 'ps-redept@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Sales',
    jobTitle: 'Mystery Title' },
];
const V = e => ({ allowed: true, role: 'viewer', email: e });

eq('viewer in the PS class pins to services',      api.resolveTeamScope_(V('ps@x.com')),    'services');
eq('viewer in Corporate/Engineering pins to rnd',  api.resolveTeamScope_(V('eng@x.com')),   'rnd');
eq('viewer with a JF004-coded title pins to sales', api.resolveTeamScope_(V('sales@x.com')), 'sales');
eq('PS-class viewer with a JF018-coded title pins to sales (no Class fast path)',
   api.resolveTeamScope_(V('sa@x.com')), 'sales');
eq('PS-class JF018 viewer pins to sales even before HRIS moves the Department',
   api.resolveTeamScope_(V('sa-early@x.com')), 'sales');
eq('PS-class viewer re-departmented to Sales pins to sales without a catalog hit',
   api.resolveTeamScope_(V('ps-redept@x.com')), 'sales');
// The pin is memoised per email — a second viewer must not inherit the first's team.
eq('team pin memo does not leak across viewers', api.resolveTeamScope_(V('ps@x.com')), 'services');

// A manager's team list is derived from their scoped roster, so an org tree that
// spans Services and Sales & Success (a Director with SAs and consultants) offers
// both teams — the 2026.W36 split is a data change, not an access-model change.
{
  const mixed = new Map([
    ['ps person',  { team: api.teamForProfile_({ cls: 'Professional Services', dept: 'Services', jobTitle: 'Consultant' }, null) }],
    ['sa person',  { team: api.teamForProfile_({ cls: 'Professional Services', dept: 'Sales',
                       jobTitle: '18.I4.1 - Senior Consultant I, Solution Architecture' }, null) }],
  ]);
  const keys = api.availableTeams_(mixed).map(t => t.key);
  eq('a split org tree yields both teams for its manager', keys.join(','), 'services,sales');
}
eq('a viewer with no roster row is not pinned',    api.resolveTeamScope_(V('external@partner.com')), null);

// Only viewers are pinned — everyone else keeps the role they had.
eq('superadmin is never pinned', api.resolveTeamScope_({ allowed: true, role: 'superadmin', email: 'ps@x.com' }), null);
eq('admin is never pinned',      api.resolveTeamScope_({ allowed: true, role: 'admin',      email: 'ps@x.com' }), null);
eq('manager is never pinned',    api.resolveTeamScope_({ allowed: true, role: 'manager',    email: 'ps@x.com' }), null);
eq('a denied caller is never pinned', api.resolveTeamScope_({ allowed: false, role: 'denied', email: 'ps@x.com' }), null);

ck('isTeamScoped_ is true for viewer only',
   api.isTeamScoped_('viewer') === true &&
   api.isTeamScoped_('admin') === false &&
   api.isTeamScoped_('superadmin') === false &&
   api.isTeamScoped_('manager') === false);

// The enforcement must OVERRIDE the requested team, and must do so before the
// cache key is built — viewers share the per-team `_admin` entries with admins,
// so serving one team's data under another team's key poisons what admins read.
const gpr = report.slice(report.indexOf('function getPSReportData('),
                         report.indexOf('// Empty stand-ins for readers'));
ck('the team pin overrides the requested team', /isTeamScoped_\(access\)[\s\S]{0,400}?team = teamByKey_\(pinned\)/.test(gpr));
ck('the pin runs BEFORE the cache key is built',
   gpr.indexOf('resolveTeamScope_(access)') < gpr.indexOf('reportCacheKey_(_cacheVer'));
ck('a pinned viewer is offered only their own team',
   /isTeamScoped_\(access\)[\s\S]{0,300}?teamsInScope = pinnedList/.test(gpr));

// ── 5c. Org-tree scope: what a Director actually sees ────────────────────────
// Gon's shape: a Director whose direct reports are themselves managers. The tree
// must reach the reports-of-reports, not stop one level down.
function prof(name, sup, team) {
  return [api.normPS_(name), { name: name, supervisor: sup, team: team }];
}
const orgRoster = new Map([
  prof('Gon Director',  '',              'services'),
  prof('Mgr One',       'Gon Director',  'services'),
  prof('Mgr Two',       'Gon Director',  'services'),
  prof('IC A',          'Mgr One',       'services'),
  prof('IC B',          'Mgr One',       'services'),
  prof('IC C',          'Mgr Two',       'services'),
  prof('Deep IC',       'IC C',          'services'),   // third level down
  prof('Someone Else',  'Other Boss',    'services'),   // outside the tree
  prof('Other Boss',    '',              'services'),
]);

const gonScope = api.resolveManagerScope_(orgRoster, api.normPS_('Gon Director'));
ck('tree includes the direct-report managers',
   gonScope.has('mgr one') && gonScope.has('mgr two'));
ck('tree includes THEIR reports (two levels down)',
   gonScope.has('ic a') && gonScope.has('ic b') && gonScope.has('ic c'));
ck('tree recurses all the way down', gonScope.has('deep ic'));
ck('tree excludes people outside it',
   !gonScope.has('someone else') && !gonScope.has('other boss'));
ck('the anchor is returned by the BFS (the caller deletes it)', gonScope.has('gon director'));

// After the caller's delete — what actually reaches the payload.
gonScope.delete(api.normPS_('Gon Director'));
eq('Gon sees 6 people, never himself', gonScope.size, 6);
ck('Gon is not in his own scope', !gonScope.has('gon director'));

// ── 5c-bis. A dropped mid-level manager must not sever the tree ─────────────
// readPSRoster_ drops rows for an unknown Class, an intern title or an inactive
// status. The BFS can only pass through people it can see, so before bridging,
// one dropped sub-manager took their whole sub-tree off the director's dashboard
// silently — the realistic trigger being a termination whose reports have not
// been re-parented yet. The bridge map carries those rows' Supervisor edges so
// the walk continues; the dropped people themselves must still never appear.
const brokenRoster = new Map([
  prof('Gon Director', ''),
  prof('Mgr Two',      'Gon Director'),
  prof('IC A',         'Mgr One'),      // Mgr One's row was DROPPED by the roster read
  prof('IC B',         'Mgr One'),
  prof('Deep IC',      'IC B'),         // a level below the orphaned pair
  prof('IC C',         'Mgr Two'),
  prof('Someone Else', 'Other Boss'),   // outside the tree entirely
]);
const bridges = new Map([
  [api.normPS_('Mgr One'),    { name: 'Mgr One',    supNorm: api.normPS_('Gon Director') }],
  [api.normPS_('Other Boss'), { name: 'Other Boss', supNorm: api.normPS_('Someone Upstairs') }],
]);

// Without the bridges — the bug this fixes. Kept as a check so the fixture stays
// honest about what it is proving.
const unbridged = api.resolveManagerScope_(brokenRoster, api.normPS_('Gon Director'));
ck('without bridges the orphaned sub-tree is invisible',
   !unbridged.has('ic a') && !unbridged.has('ic b') && !unbridged.has('deep ic'));

const bridged = api.resolveManagerScope_(brokenRoster, api.normPS_('Gon Director'), bridges);
ck('the dropped manager reports are back in scope',
   bridged.has('ic a') && bridged.has('ic b'));
ck('the walk continues BELOW them too', bridged.has('deep ic'));
ck('the healthy branch is untouched', bridged.has('mgr two') && bridged.has('ic c'));
ck('the DROPPED row itself never enters the scope', !bridged.has('mgr one'));
ck('a bridge outside the tree widens nothing',
   !bridged.has('someone else') && !bridged.has('other boss'));
bridged.delete(api.normPS_('Gon Director'));
eq('Gon sees his 5 live reports, never himself and never the dropped row',
   [...bridged].sort(), ['deep ic', 'ic a', 'ic b', 'ic c', 'mgr two']);

// A bridge chain: two dropped managers stacked on top of each other.
const deepBridges = new Map([
  [api.normPS_('Mgr One'), { name: 'Mgr One', supNorm: api.normPS_('Dropped VP') }],
  [api.normPS_('Dropped VP'), { name: 'Dropped VP', supNorm: api.normPS_('Gon Director') }],
]);
const chained = api.resolveManagerScope_(brokenRoster, api.normPS_('Gon Director'), deepBridges);
ck('the walk crosses TWO stacked dropped rows', chained.has('ic a') && chained.has('deep ic'));
ck('neither dropped row lands in scope',
   !chained.has('mgr one') && !chained.has('dropped vp'));

// Bridges are optional and must not change a healthy tree's answer.
eq('an empty bridge map leaves a healthy tree identical',
   [...api.resolveManagerScope_(orgRoster, api.normPS_('Gon Director'), new Map())].sort(),
   [...api.resolveManagerScope_(orgRoster, api.normPS_('Gon Director'))].sort());

// A single-team tree offers one team, so the toggle hides itself (needs >= 2).
const gonRoster = new Map([...orgRoster].filter(([n]) => gonScope.has(n)));
eq('an all-Services tree offers only Services',
   api.availableTeams_(gonRoster).map(t => t.key), ['services']);

// ── 5d. A manager whose tree spans two teams ─────────────────────────────────
// Sales & Success lead who also has Services direct reports. Scope follows the
// org tree, not the manager's own team — so BOTH teams appear, as two toggle
// views (the metric sets differ), never as one merged roster.
const crossRoster = new Map([
  prof('Cross Lead',  '',           'sales'),
  prof('Sales Rep',   'Cross Lead', 'sales'),
  prof('Svc Person',  'Cross Lead', 'services'),
  prof('Svc Person2', 'Cross Lead', 'services'),
  prof('Stranger',    'Nobody',     'rnd'),
]);
const crossScope = api.resolveManagerScope_(crossRoster, api.normPS_('Cross Lead'));
crossScope.delete(api.normPS_('Cross Lead'));
const crossScoped = new Map([...crossRoster].filter(([n]) => crossScope.has(n)));

eq('cross-team tree keeps only their own reports', crossScope.size, 3);
ck('someone else\'s report is not in the tree', !crossScope.has('stranger'));
eq('both teams are offered, in registry order',
   api.availableTeams_(crossScoped).map(t => t.key), ['services', 'sales']);
eq('the Services view shows the 2 Services reports',
   api.teamRoster_(crossScoped, 'services').size, 2);
eq('the Sales view shows the 1 Sales report',
   api.teamRoster_(crossScoped, 'sales').size, 1);
ck('a manager is never pinned to their OWN team — the tree decides',
   api.isTeamScoped_({ role: 'manager' }) === false);

// ── 5e. Role precedence beats org scoping — the Gon trap ─────────────────────
// A supervisor who is ALSO on the admin or viewer list resolves as that role and
// LOSES org scoping entirely: the lists are checked before roster auto-resolution.
reset();
ROSTER_ROWS = [
  { name: 'Gon Director', normName: 'gon director', email: 'gon@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services', jobTitle: 'Director' },
  { name: 'Mgr One', normName: 'mgr one', email: 'm1@x.com', active: true,
    supervisor: 'Gon Director', normSupervisor: 'gon director', cls: 'Professional Services', dept: 'Services', jobTitle: 'Manager' },
];
eq('a plain supervisor auto-resolves as manager',
   api._resolveAccessFor_('gon@x.com').role, 'manager');
props['PS_DASH_ADMINS'] = 'gon@x.com';
eq('…but the admin list overrides it', api._resolveAccessFor_('gon@x.com').role, 'admin');
eq('…and an admin carries no org-tree scope',
   api._resolveAccessFor_('gon@x.com').delegateScopeName, undefined);
delete props['PS_DASH_ADMINS'];
// 2026.W42: the VIEWER list no longer discards a supervisor's org scope. A listed
// email that leads people resolves exactly like a roster supervisor — own org
// tree, own row out — never the whole org team (every peer manager's people).
props['PS_DASH_VIEWERS'] = 'gon@x.com';
eq('the viewer list keeps a supervisor scoped as a manager',
   api._resolveAccessFor_('gon@x.com').role, 'manager');
eq('…anchored on their own roster name',
   api._resolveAccessFor_('gon@x.com').delegateScopeName, 'Gon Director');
eq('…and self-exclusion keys off the same name',
   api._resolveAccessFor_('gon@x.com').selfRosterName, 'Gon Director');
ck('…so they are NOT team-pinned',
   api.isTeamScoped_(api._resolveAccessFor_('gon@x.com')) === false);
ck('…and the reason says the viewer list put them there',
   /viewer list/.test(api._resolveAccessFor_('gon@x.com').reason));
// A listed IC is still a plain, team-pinned viewer.
props['PS_DASH_VIEWERS'] = 'gon@x.com,m1@x.com';
eq('a listed IC with no reports stays a viewer', api._resolveAccessFor_('m1@x.com').role, 'viewer');
ck('…and IS team-pinned', api.isTeamScoped_(api._resolveAccessFor_('m1@x.com')) === true);
// The list is the grant and the roster only sets the scope: the auto-access
// policy gate must not widen a listed supervisor back to a whole team.
const savedMode_ = api.SEC_.MANAGER_AUTO_ACCESS;
api.SEC_.MANAGER_AUTO_ACCESS = 'off';
eq('viewer-list supervisor keeps org scope with auto-access off',
   api._resolveAccessFor_('gon@x.com').role, 'manager');
eq('…while an unlisted supervisor is denied in that mode',
   api._resolveAccessFor_('nobody@x.com').role, 'denied');
api.SEC_.MANAGER_AUTO_ACCESS = savedMode_;
delete props['PS_DASH_VIEWERS'];

// ── 5f. Org Admin — admin POWERS with a manager's SCOPE ──────────────────────
// The tier that closes the Gon gap: run the dashboard for your own org without
// seeing your peers' orgs. Powers and scope are separate axes here.
reset();
ROSTER_ROWS = [
  { name: 'Gon Director', normName: 'gon director', email: 'gon@x.com', active: true,
    supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services', jobTitle: 'Director' },
  { name: 'Mgr One', normName: 'mgr one', email: 'm1@x.com', active: true,
    supervisor: 'Gon Director', normSupervisor: 'gon director', cls: 'Professional Services', dept: 'Services', jobTitle: 'Manager' },
];
props['PS_DASH_ORG_ADMINS'] = 'gon@x.com';
const orgV = api._resolveAccessFor_('gon@x.com');

eq('org admin resolves to its own role', orgV.role, 'orgadmin');
eq('org admin is anchored on their OWN roster name', orgV.delegateScopeName, 'Gon Director');
ck('org admin HAS admin power',       api.hasAdminPower_(orgV) === true);
ck('org admin is NOT a super admin',  api.isSuperAdmin_(orgV) === false);
ck('org admin may NOT manage the admin tiers', api.canManageAdmins_(orgV) === false);
ck('org admin is manager-SCOPED, not full-roster', api.seesFullRoster_(orgV) === false);
ck('org admin is not team-pinned — their tree decides', api.isTeamScoped_(orgV) === false);

// Powers the other tiers keep.
ck('a plain admin may manage the admin tiers', api.canManageAdmins_({ role: 'admin' }) === true);
ck('a super admin may manage the admin tiers', api.canManageAdmins_({ role: 'superadmin' }) === true);
ck('a viewer may not',                         api.canManageAdmins_({ role: 'viewer' }) === false);
ck('a manager may not',                        api.canManageAdmins_({ role: 'manager' }) === false);
ck('a manager still has no admin power',       api.hasAdminPower_({ role: 'manager' }) === false);

// An org admin with no roster row has no tree to scope to — refuse rather than
// silently hand them the whole company, which is what this tier exists to prevent.
props['PS_DASH_ORG_ADMINS'] = 'ghost@x.com';
eq('an off-roster org admin is denied, not widened',
   api._resolveAccessFor_('ghost@x.com').role, 'denied');
ck('…with a reason that says why',
   api._resolveAccessFor_('ghost@x.com').reason.indexOf('no roster row') !== -1);

// Tier precedence and de-duplication.
reset();
ROSTER_ROWS = [{ name: 'Dual Person', normName: 'dual person', email: 'dual@x.com', active: true,
                 supervisor: '', normSupervisor: '', cls: 'Professional Services', dept: 'Services', jobTitle: 'Director' }];
props['PS_DASH_ADMINS']     = 'dual@x.com';
props['PS_DASH_ORG_ADMINS'] = 'dual@x.com';
eq('admin outranks org admin', api._resolveAccessFor_('dual@x.com').role, 'admin');
ck('…and the duplicate is filtered out of the org list',
   api._readAccessLists_().orgAdmins.indexOf('dual@x.com') === -1);
props['PS_DASH_ADMINS'] = '';
props['PS_DASH_VIEWERS'] = 'dual@x.com';
eq('org admin outranks viewer', api._resolveAccessFor_('dual@x.com').role, 'orgadmin');
ck('…and the duplicate is filtered out of the viewer list',
   api._readAccessLists_().viewers.indexOf('dual@x.com') === -1);

// Self-exclusion still applies — an org admin is not a super admin.
const orgPayload = api.applySelfExclusion_({
  ok: true, userRole: 'superadmin', userEmail: 'builder@x.com',
  employees: [{ name: 'Gon Director', normName: 'gon director' }, { name: 'Mgr One', normName: 'mgr one' }],
  meta: {},
}, { role: 'orgadmin', email: 'gon@x.com', selfRosterName: 'Gon Director' });
eq('an org admin never sees their own row', orgPayload.employees.map(e => e.normName), ['mgr one']);
eq('…and is flagged as self-excluded', orgPayload.meta.selfExcluded, true);
eq('…and gets their own role stamped', orgPayload.userRole, 'orgadmin');

// The escalation guard must be enforced server-side, not just hidden in the UI.
ck('saveAccessSettings gates the admin list on canManageAdmins_',
   /Array\.isArray\(settings\.admins\)[\s\S]{0,400}?canManageAdmins_\(access\)/.test(security));
ck('saveAccessSettings gates the org-admin list on canManageAdmins_',
   /Array\.isArray\(settings\.orgAdmins\)[\s\S]{0,400}?canManageAdmins_\(access\)/.test(security));
ck('both rejections throw rather than silently ignoring',
   (security.match(/Unauthorized: an Org Admin cannot change/g) || []).length === 2);

// ── 5g. Denied-page wording ──────────────────────────────────────────────────
// This page is the only thing most people who bounce off the link ever read, so
// it must name the right audience and the right team — and the two surfaces that
// draw it (doGet's server page, and the in-app message) must not drift apart.
const html = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');

ck('the product is no longer described as PS-team-only',
   !/PS team only/i.test(security) && !/PS team only/i.test(html));
eq('audience is managers and above', api.SEC_.ACCESS_AUDIENCE, 'managers and above');
eq('access requests are routed to WFP', api.SEC_.ACCESS_REQUEST_TEAM, 'WFP');
eq('product name is set', api.SEC_.PRODUCT_NAME, 'Global Contribution');

// Both surfaces must read the constants, not their own copy.
ck('the server page reads PRODUCT_NAME',    /SEC_\.PRODUCT_NAME/.test(security));
ck('the server page reads ACCESS_AUDIENCE', /SEC_\.ACCESS_AUDIENCE/.test(security));
ck('the server page reads ACCESS_REQUEST_TEAM', /SEC_\.ACCESS_REQUEST_TEAM/.test(security));
ck('accessDeniedInfo_ ships the same four fields to the client',
   /product:[\s\S]{0,80}audience:[\s\S]{0,80}team:[\s\S]{0,80}link:/.test(security));
// Every denial is either the caller gate (literal, before viewAs resolves) or a
// denied_() call — and denied_ itself is the one place that spells the shape out.
ck('the caller gate denial carries accessInfo',
   /denied: true, email: caller\.email, accessInfo: accessDeniedInfo_\(\)/.test(report));
ck('denied_ carries accessInfo and the viewAs stamp',
   /denied: true, email: access\.email, accessInfo: accessDeniedInfo_\(\),\s*viewAs: access\.viewAs \|\| null/.test(report));
ck('no denial in getPSReportData bypasses denied_ after viewAs resolves',
   (report.match(/ok: false, denied: true, email: access\.email/g) || []).length === 1);
ck('every scoped denial goes through denied_',
   (report.match(/return denied_\(/g) || []).length >= 4);
ck('the in-app message takes an info argument',
   /function showAccessDenied_\(email, reason, info\)/.test(html));
ck('…and the call site passes it', /showAccessDenied_\(payload\.email, payload\.reason, payload\.accessInfo\)/.test(html));
ck('the request link is optional, not a guessed address',
   /ACCESS_REQUEST_LINK:\s*""/.test(security));

// ── 6. Every google.script.run-reachable global is gated ─────────────────────
// Any non-underscore function in a GAS project is callable by anyone who can
// load the web app. "Run it from the editor" is a convention, not a control.
const GAS_FILES = {
  'PS Contribution Report.js': report,
  'PS Security.js':            security,
  'PS_Post.js':                fs.readFileSync(path.join(dir, 'PS_Post.js'), 'utf8'),
  'Kudos.js':                  fs.readFileSync(path.join(dir, 'Kudos.js'), 'utf8'),
  'PS Teams.js':               fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'),
};
// Endpoints that are safe without a gate, each for a stated reason.
const UNGATED_OK = {
  doGet:                 'gates itself and renders the access-denied page',
  checkDashboardAccess:  'IS the gate',
  whoAmI:                'reports only on the caller\'s own session',
  runPublishTest:        'delegates to publishContributionSection, which is gated',
  _test_teamForProfile:  'pure test helper, touches no data',
};
Object.keys(GAS_FILES).forEach(file => {
  const src = GAS_FILES[file];
  const re  = /^function ([a-zA-Z][A-Za-z0-9]*)\s*\(([^)]*)\)\s*\{/gm;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (UNGATED_OK[name] || /^_test_/.test(name)) continue;
    // Body = from the header to the next top-level close brace.
    const body = src.slice(m.index, src.indexOf('\n}', m.index));
    ck(file + ' :: ' + name + ' checks access',
       /checkDashboardAccess\(\)/.test(body));
  }
});

// ── 7. Source-level invariants ───────────────────────────────────────────────
// These guard the gates that have no pure function to call.
// Every authorisation gate must go through hasAdminPower_ / isSuperAdmin_ /
// seesFullRoster_. A bare `role !== "admin"` is the exact shape that locks a
// superadmin out of a setting they are supposed to own, so ban it outright.
// (Positive `role === "admin"` survives inside seesFullRoster_ itself, which is
// the one place allowed to name the roles.)
ck('no bare role!=="admin" gate left in the report',
   !/\.role\s*!==?\s*['"]admin['"]/.test(report));
ck('no bare role!=="admin" gate left in PS Security.js',
   !/\.role\s*!==?\s*['"]admin['"]/.test(security));
eq('seesFullRoster_ is the only place naming the full-roster roles',
   (report.match(/access\.role\s*===\s*['"]admin['"]/g) || []).length, 1);
// Performance Record is open to EVERY role (roles: null) — its data control is the
// payload's scope (org tree / team pin) + self-exclusion, never the tab gate.
ck('Performance Record is open to every role in VIEWS',
   /id:\s*"perfrecord"[\s\S]{0,200}?roles:\s*null/.test(
     fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8')));
ck('getPSReportData personalises the cache-hit path',
   /applySelfExclusion_\(JSON\.parse\(_hit\), access\)/.test(report));
ck('getPSReportData personalises the fresh-compute path',
   /return applySelfExclusion_\(result, access\);/.test(report));
ck('manager scope drops its own anchor', /scope\.delete\(managerNorm\);/.test(report));
ck('payload is cached BEFORE it is personalised',
   report.indexOf('cachePutLarge_(_sCache, _cacheKey, JSON.stringify(result)') <
   report.indexOf('return applySelfExclusion_(result, access);'));

// ── 8. 👁 View as — super-admin impersonation of the report view ─────────────
// Spec: docs/specs/2026-09-01-view-as-impersonation-design.md
{ // block scope — earlier sections already declared adminAccess etc.
reset();
props['PS_DASH_SUPER_ADMINS'] = 'sa@x.com';
props['PS_DASH_ADMINS']       = 'admin@x.com';
props['PS_DASH_VIEWERS']      = 'viewer@x.com';
ROSTER_ROWS = [
  { name: 'Super Ann',  normName: 'super ann',  email: 'sa@x.com',    supervisor: '',          normSupervisor: '',          active: true, cls: 'Professional Services', dept: 'Services', jobTitle: '' },
  { name: 'Dir Gon',    normName: 'dir gon',    email: 'gon@x.com',   supervisor: '',          normSupervisor: '',          active: true, cls: 'Professional Services', dept: 'Services', jobTitle: '' },
  { name: 'IC A',       normName: 'ic a',       email: 'ica@x.com',   supervisor: 'Dir Gon',   normSupervisor: 'dir gon',   active: true, cls: 'Professional Services', dept: 'Services', jobTitle: '' },
  { name: 'Lone IC',    normName: 'lone ic',    email: 'lone@x.com',  supervisor: 'Dir Gon',   normSupervisor: 'dir gon',   active: true, cls: 'Professional Services', dept: 'Services', jobTitle: '' },
];
const saAccess    = api._resolveAccessFor_('sa@x.com');
const adminAccess = api._resolveAccessFor_('admin@x.com');
eq('fixture: sa is superadmin', saAccess.role, 'superadmin');
eq('fixture: admin is admin',   adminAccess.role, 'admin');

// No target → the caller's own verdict, untouched (every legacy call is a no-op).
ck('viewAs empty → caller verdict unchanged',
   api.resolveViewAsAccess_(saAccess, '') === saAccess &&
   api.resolveViewAsAccess_(saAccess, null) === saAccess);
ck('viewAs self → caller verdict unchanged', api.resolveViewAsAccess_(saAccess, 'SA@x.com') === saAccess);

// Only a super admin may impersonate — everyone else THROWS, loudly.
let threw = false;
try { api.resolveViewAsAccess_(adminAccess, 'gon@x.com'); } catch (e) { threw = /super admins only/.test(e.message); }
ck('a plain admin posting viewAs throws', threw);
threw = false;
try { api.resolveViewAsAccess_(api._resolveAccessFor_('gon@x.com'), 'ica@x.com'); } catch (e) { threw = true; }
ck('a manager posting viewAs throws', threw);
threw = false;
try { api.resolveViewAsAccess_({ allowed: false, role: 'denied', email: 'x@x.com' }, 'gon@x.com'); } catch (e) { threw = true; }
ck('a denied caller posting viewAs throws', threw);

// Super admin → the TARGET's verdict, through the real resolution path.
const asGon = api.resolveViewAsAccess_(saAccess, 'gon@x.com');
eq('sa viewing Gon: role is manager',            asGon.role, 'manager');
eq('sa viewing Gon: org-tree anchor is Gon',     asGon.delegateScopeName, 'Dir Gon');
eq('sa viewing Gon: self-exclusion anchor is Gon (not the caller)', asGon.selfRosterName, 'Dir Gon');
eq('sa viewing Gon: email is the target (drives the manager cache key)', asGon.email, 'gon@x.com');
eq('sa viewing Gon: viewAs stamp', asGon.viewAs,
   { email: 'gon@x.com', name: 'Dir Gon', role: 'manager', allowed: true,
     reason: 'roster supervisor (auto)', byEmail: 'sa@x.com' });
ck('sa viewing Gon: caller verdict object not mutated', !saAccess.viewAs && saAccess.role === 'superadmin');
ck('viewing a manager is NOT a full-roster verdict', !api.seesFullRoster_(asGon));

// A viewer target keeps their pin; an unlisted IC comes back DENIED with the reason.
const asViewer = api.resolveViewAsAccess_(saAccess, 'viewer@x.com');
eq('sa viewing a viewer: role', asViewer.role, 'viewer');
ck('sa viewing a viewer: still team-scoped', api.isTeamScoped_(asViewer));
const asLone = api.resolveViewAsAccess_(saAccess, 'lone@x.com');
eq('sa viewing a non-manager IC: denied', asLone.allowed, false);
ck('sa viewing a non-manager IC: reason travels in the stamp',
   asLone.viewAs.allowed === false && /no list match/.test(asLone.viewAs.reason));

// The payload is personalised for the TARGET: their row is stripped, the stamp lands.
const gonPayload = samplePayload();
gonPayload.employees.push({ name: 'Dir Gon', normName: 'dir gon', si: { value: 5 } });
const pGon = api.applySelfExclusion_(gonPayload, asGon);
eq('viewAs payload: userRole is the target\'s', pGon.userRole, 'manager');
eq('viewAs payload: userEmail is the target\'s', pGon.userEmail, 'gon@x.com');
eq('viewAs payload: the target\'s own row is stripped', pGon.employees.map(e => e.normName), ['view person', 'other one']);
eq('viewAs payload: meta.viewAs stamped', pGon.meta.viewAs.email, 'gon@x.com');
const pPlain = api.applySelfExclusion_(samplePayload(), saAccess);
eq('no viewAs → meta.viewAs is null (never undefined, the UI keys on it)', pPlain.meta.viewAs, null);

// Source invariants — the wiring that has no pure function to call.
ck('getPSReportData accepts viewAs', /function getPSReportData\(bustCache, teamKey, viewAs\)/.test(report));
ck('getPSReportData gates the REAL caller first', /const caller = checkDashboardAccess\(\);/.test(report));
ck('getPSReportData swaps in the target verdict', /const access = resolveViewAsAccess_\(caller, viewAs\);/.test(report));
ck('applySelfExclusion_ stamps meta.viewAs on every path (before the superadmin early return)',
   report.indexOf('payload.meta.viewAs = access.viewAs || null;') <
   report.search(/if \(isSuperAdmin_\(access\)\) \{\r?\n\s*payload\.meta\.selfExcluded = false;/));
ck('listViewAsTargets is super-admin gated',
   /function listViewAsTargets\(\) \{\s*const caller = checkDashboardAccess\(\);\s*if \(!caller\.allowed \|\| !isSuperAdmin_\(caller\)\)/.test(security));
const html8 = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');
ck('foreground load passes viewAs', /\.getPSReportData\(forceRefresh, STATE\.activeTeam, viewAsEmail_\(\)\)/.test(html8));
ck('background prefetch passes viewAs', /\.getPSReportData\(false, reqKey, viewAsEmail_\(\)\)/.test(html8));
// Scoring Weights became a read-for-everyone page in 2026.W41: shown in preview,
// but the editor is never offered there (canEditScoring_ checks !STATE.viewAs).
ck('Scoring Weights is NOT hidden in preview', !/id:\s*"weights"[^\n]*hideInPreview:\s*true/.test(html8));
ck('…and is read-only while previewing', /function canEditScoring_\(\)\s*\{\s*return !STATE\.viewAs &&/.test(html8));
ck('Access Control hidden in preview',  /id:\s*"access"[^\n]*hideInPreview:\s*true/.test(html8));
ck('canSeeView_ honours hideInPreview', /if \(view\.hideInPreview && STATE\.viewAs\) return false;/.test(html8));
ck('the ☰ entry keys off the REAL role, not the previewed one', /if \(isRealSuperAdmin_\(\)\) \{\s*html \+= '<div class="nav-menu-divider">/.test(html8));
ck('realRole is derived from the payload stamp, never guessed', /STATE\.realRole = va \? "superadmin" : STATE\.userRole;/.test(html8));

}

console.log(fail === 0
  ? `✅ access-tier-checks: ${pass} checks passed`
  : `❌ access-tier-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
