// Node checks for the OPEN ACCESS tier rule (2026-08-31).
//
// Open Access is the single switch that drops the email check for the WHOLE
// dashboard: one click turns a scoped, per-manager view into read-only
// company-wide data for anyone holding the link. That is a wider grant than any
// individual entry on the admin/viewer lists, so it sits at the Super Admin tier
// alongside editing the Super Admin list — NOT with routine list maintenance.
//
// The trap this suite exists to catch: the server REJECTS the field rather than
// ignoring it, so the client must send `openAccess` only when the caller may
// actually change it. Send it unconditionally and every ordinary Admin save turns
// into an authorisation error — the save button just fails for them, with the real
// reason buried in a server exception. That failure mode is invisible in review
// and invisible in a screenshot, which is why it is asserted here.
//
// Run: node "ps-dashboard/tests/open-access-gate-checks.js"
const fs   = require('fs');
const path = require('path');

const dir      = path.join(__dirname, '..');
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const html     = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error('  ❌ ' + name + (detail ? '\n     ' + detail : ''));
}
function throws(name, fn, reMatch) {
  try {
    fn();
    fail++;
    console.error('  ❌ ' + name + '\n     expected a throw, got none');
  } catch (e) {
    if (reMatch && !reMatch.test(e.message)) {
      fail++;
      console.error('  ❌ ' + name + '\n     threw the wrong error: ' + e.message);
    } else pass++;
  }
}

// ── Harness ──────────────────────────────────────────────────────────────────
function extract(src, startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) { console.error('❌ could not find: ' + startsWith); process.exit(1); }
  const j = src.indexOf(endsWith, i);
  if (j < 0) { console.error('❌ could not close: ' + startsWith); process.exit(1); }
  return src.slice(i, j + endsWith.length);
}

const Logger = { log: () => {} };
let props = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }),
};

// The role under test. saveAccessSettings/getAccessSettings both resolve the
// caller through checkDashboardAccess, so stubbing it is the whole seam.
let CALLER = { allowed: true, role: 'superadmin', email: 'sa@x.com' };
function checkDashboardAccess() { return CALLER; }
function _secResetMemo_() {}

// Lift every role predicate, not just the two this suite asserts on: the access
// tiers grow (Org Admin added canManageAdmins_), and getAccessSettings/
// saveAccessSettings call whichever ones exist. Omitting one turns a passing suite
// into a ReferenceError crash that reads like a product regression.
const slice = [
  extract(security, 'const SEC_ = {', '\n};'),
  extract(security, 'function isSuperAdmin_',    '\n}'),
  extract(security, 'function hasAdminPower_',   '\n}'),
  extract(security, 'function canManageAdmins_', '\n}'),
  extract(security, 'function isTeamScoped_',    '\n}'),
  extract(security, 'function _readAccessLists_', '\n}'),
  extract(security, 'function getAccessSettings', '\n}'),
  extract(security, 'function saveAccessSettings', '\n}'),
].join('\n');

// eslint-disable-next-line no-eval
const api = eval('(function(){' + slice +
  '\nreturn { SEC_, getAccessSettings, saveAccessSettings };})()');

const OA = api.SEC_.PROP_OPEN_ACCESS;
function reset(role, email) {
  props = {};
  CALLER = { allowed: true, role: role, email: email || (role + '@x.com') };
}

// ── 1. Super Admin may flip it ───────────────────────────────────────────────
reset('superadmin');
api.saveAccessSettings({ openAccess: true });
ck('superadmin can turn Open Access ON', props[OA] === 'true', 'got ' + props[OA]);

api.saveAccessSettings({ openAccess: false });
ck('superadmin can turn Open Access OFF', props[OA] === 'false', 'got ' + props[OA]);

// ── 2. Plain Admin may NOT — and is rejected, not ignored ────────────────────
reset('admin');
throws('admin posting openAccess:true is rejected',
       () => api.saveAccessSettings({ openAccess: true }),
       /Super Admin.*Open Access|Open Access/i);
ck('admin\'s rejected attempt wrote nothing', !(OA in props),
   'property was set to ' + props[OA]);

// Rejected even when turning it OFF — the tier rule is about who owns the switch,
// not about which direction is "safer".
reset('admin');
throws('admin posting openAccess:false is also rejected',
       () => api.saveAccessSettings({ openAccess: false }), /Open Access/i);

// ── 3. The trap: an ordinary Admin save must still succeed ───────────────────
// A plain Admin editing admins/viewers/delegates and NOT sending openAccess has
// to save cleanly. If this ever throws, the client is sending the field it must not.
reset('admin');
let ok = true;
try {
  api.saveAccessSettings({
    admins:    ['someone@x.com'],
    viewers:   ['viewer@x.com'],
    delegates: [{ email: 'peer@x.com', scopeName: 'Dana Reyes' }],
  });
} catch (e) { ok = false; }
ck('admin can still save the ordinary lists', ok);
ck('admin\'s list save landed', props[api.SEC_.PROP_ADMINS] === 'someone@x.com');

// ── 4. Nobody below Admin gets in at all ─────────────────────────────────────
['viewer', 'manager', 'denied'].forEach(role => {
  reset(role);
  throws(role + ' cannot save access settings at all',
         () => api.saveAccessSettings({ admins: ['x@x.com'] }), /Unauthorized/i);
});

// ── 5. The capability is advertised to the client ────────────────────────────
reset('superadmin');
let s = api.getAccessSettings();
ck('getAccessSettings tells a superadmin they may change Open Access',
   s.canManageOpenAccess === true);
reset('admin');
s = api.getAccessSettings();
ck('getAccessSettings tells an admin they may NOT change Open Access',
   s.canManageOpenAccess === false);
ck('an admin still sees the CURRENT Open Access state', typeof s.openAccess === 'boolean');

// ── 6. Client mirrors the rule ───────────────────────────────────────────────
ck('client reads the canManageOpenAccess capability',
   /canOpen:\s*!!s\.canManageOpenAccess/.test(html));
ck('client sends openAccess ONLY when permitted',
   /if\s*\(ACL\.canOpen\)\s*\{[\s\S]{0,200}?payload\.openAccess/.test(html),
   'openAccess must be added to the payload inside an ACL.canOpen guard');
ck('the toggle is disabled for a caller who may not change it',
   /ACL\.canOpen\s*\?[^:]*:\s*'\s*disabled'/.test(html));
ck('the UI says who owns the switch',
   /Super Admin only/.test(html));

// ── 7. Source-level: the server gate itself ──────────────────────────────────
const save = extract(security, 'function saveAccessSettings', '\n}');
// Window is generous on purpose: an explanatory comment block sits between the
// `openAccess` test and the guard, and a tight window fails on prose length rather
// than on the thing being asserted.
ck('openAccess is guarded by isSuperAdmin_ in saveAccessSettings',
   /openAccess[\s\S]{0,1500}?isSuperAdmin_/.test(save));
ck('the openAccess guard throws rather than silently skipping',
   /isSuperAdmin_\(access\)\)\s*\{[\s\S]{0,400}?throw new Error/.test(save));
ck('a rejected Open Access attempt is logged',
   /tried to set Open Access/.test(save));

// ── 8. Org Admin scope containment ───────────────────────────────────────────
// An orgadmin has admin POWERS with a manager's FIELD OF VIEW. Two reads leaked
// across that boundary because both were gated on hasAdminPower_ (which includes
// orgadmin) rather than on who may see the whole company.

// getAccessSettings must WITHHOLD the three company-wide tier lists, not merely
// mark them read-only: sending them and disabling the cards still discloses every
// super admin's and admin's email to a role documented as not receiving them.
reset('orgadmin', 'orgadmin@x.com');
props[api.SEC_.PROP_ADMINS]       = 'realadmin@x.com';
props[api.SEC_.PROP_SUPER_ADMINS] = 'realsuper@x.com';
props[api.SEC_.PROP_VIEWERS]      = 'somebody@x.com';
let g = api.getAccessSettings();
ck('orgadmin is told the admin cards are read-only', g.canManageAdmins === false);
ck('orgadmin receives NO super-admin emails', Array.isArray(g.superAdmins) && g.superAdmins.length === 0,
   'got ' + JSON.stringify(g.superAdmins));
ck('orgadmin receives NO admin emails', Array.isArray(g.admins) && g.admins.length === 0,
   'got ' + JSON.stringify(g.admins));
ck('orgadmin receives NO org-admin emails', Array.isArray(g.orgAdmins) && g.orgAdmins.length === 0,
   'got ' + JSON.stringify(g.orgAdmins));
ck('orgadmin still gets the lists they DO manage', g.viewers.indexOf('somebody@x.com') !== -1);

// A full-roster admin keeps seeing them — the fix must not over-reach.
reset('admin');
props[api.SEC_.PROP_ADMINS]       = 'realadmin@x.com';
props[api.SEC_.PROP_SUPER_ADMINS] = 'realsuper@x.com';
g = api.getAccessSettings();
ck('admin still receives the admin list', g.admins.indexOf('realadmin@x.com') !== -1);
ck('admin still receives the super list', g.superAdmins.indexOf('realsuper@x.com') !== -1);

// An orgadmin posting a tier list is rejected outright, so the client must not
// send those fields — the same reject-not-ignore trap as openAccess above.
reset('orgadmin', 'orgadmin@x.com');
throws('orgadmin posting admins is rejected',
       () => api.saveAccessSettings({ admins: ['x@x.com'] }), /Org Admin cannot change the Admin/i);
throws('orgadmin posting orgAdmins is rejected',
       () => api.saveAccessSettings({ orgAdmins: ['x@x.com'] }), /Org Admin cannot change the Org Admin/i);
throws('orgadmin posting openAccess is rejected',
       () => api.saveAccessSettings({ openAccess: true }), /Open Access/i);
reset('orgadmin', 'orgadmin@x.com');
let orgOk = true;
try { api.saveAccessSettings({ viewers: ['v@x.com'], delegates: [] }); } catch (e) { orgOk = false; }
ck('orgadmin CAN still save viewers and delegates', orgOk);

// The client must guard every field the server rejects, or an orgadmin's save
// becomes an authorisation error instead of a save.
ck('client sends admin-tier lists only when permitted',
   /if\s*\(ACL\.canAdmins\)\s*\{[\s\S]{0,240}?payload\.admins/.test(html),
   'admins/orgAdmins must be added inside an ACL.canAdmins guard');

// diagnosePSAccess is the widest read in the file — every supervisor's name, email
// and report count, plus any employee's long-leave status. It must be closed to the
// one role whose entire purpose is a narrower field of view.
const diag = extract(security, 'function diagnosePSAccess', '\n}');
// Match CALLS, not mentions: the guard's own comment names hasAdminPower_ to explain
// why it is not used, and a bare /hasAdminPower_/ test flags that prose as a defect.
ck('diagnosePSAccess calls canManageAdmins_', /canManageAdmins_\s*\(/.test(diag));
ck('diagnosePSAccess does NOT call hasAdminPower_', !/hasAdminPower_\s*\(/.test(diag));
ck('diagnosePSAccess logs the blocked caller', /BLOCKED/.test(diag));

console.log(fail === 0
  ? `✅ open-access-gate-checks: ${pass} checks passed`
  : `❌ open-access-gate-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
