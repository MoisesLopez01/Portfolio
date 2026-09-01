// Headless checks for the 🔒 Access Control list editor (2026-08-31).
//
// The editor replaced four newline-joined <textarea>s with filterable cards of
// removable rows. Its risky parts are all index/state bookkeeping that a
// screenshot cannot show: does Remove target the row that was clicked when a
// filter is active, does the count include the pinned bootstrap admin, does a
// card left in bulk mode still get saved.
//
// Run: node "ps-dashboard/tests/access-list-editor-checks.js"
const fs   = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

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

// ── Lift the editor out of the page ──────────────────────────────────────────
// Unambiguous anchor — the banner comment's rule length is cosmetic and the CSS
// block above carries the same title.
const START = 'var ACL = null;';
const END   = 'function syncWeightSlider(key) {';
const i0 = html.indexOf(START), i1 = html.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error('❌ editor block not found in PS Dashboard.html'); process.exit(1); }
const src = html.slice(i0, i1);

// ── Minimal DOM stub ─────────────────────────────────────────────────────────
// Enough to let the editor render and be queried; innerHTML is stored raw and
// re-scanned for ids, which is all the assertions below need.
const NODES = {};
function mkNode(id) {
  return {
    id, _html: '', value: '', textContent: '', checked: false, style: {},
    classList: { _s: {}, toggle(c, on) { this._s[c] = !!on; }, contains(c) { return !!this._s[c]; } },
    focus() {}, setSelectionRange() {},
    get innerHTML() { return this._html; },
    set innerHTML(v) {
      this._html = v;
      // Register every id the freshly rendered markup declares, so the editor's
      // own follow-up getElementById calls resolve the way they do in a browser.
      const re = /id="([^"]+)"/g; let m;
      while ((m = re.exec(v))) if (!NODES[m[1]]) NODES[m[1]] = mkNode(m[1]);
    },
  };
}
const document = {
  getElementById(id) { return NODES[id] || null; },
};
const STATE = { userEmail: 'boss@x.com', userRole: 'superadmin' };
const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let SAVED = null;
const google = { script: { run: {
  withSuccessHandler() { return this; },
  withFailureHandler() { return this; },
  saveAccessSettings(p) { SAVED = p; },
} } };
const setTimeout = () => {};

NODES['securitySection'] = mkNode('securitySection');

// eslint-disable-next-line no-eval
const api = eval('(function(){' + src +
  '\nreturn { populateSecuritySection_, aclRender_, aclAdd_, aclRemove_, aclFilter_,' +
  ' aclBulkToggle_, aclBulkApply_, aclFindElsewhere_, aclIsEmail_, saveSecuritySettings_,' +
  ' secToggleOpenAccess_, getACL: function(){ return ACL; } };})()');

function load(over) {
  Object.keys(NODES).forEach(k => { if (k !== 'securitySection') delete NODES[k]; });
  NODES['securitySection']._html = '';
  api.populateSecuritySection_(Object.assign({
    superAdmins: ['sa2@x.com'],
    admins:      ['a1@x.com', 'a2@x.com'],
    viewers:     ['v1@x.com'],
    delegates:   [{ email: 'd1@x.com', scopeName: 'Jane Boss' }],
    openAccess:  false,
    canManageSuperAdmins: true,
    bootstrapAdmin: 'boss@x.com',
    callerEmail: 'boss@x.com',
    callerRole:  'superadmin',
  }, over || {}));
}

// ── 1. Renders all four cards ────────────────────────────────────────────────
load();
const page = NODES['securitySection'].innerHTML;
['superAdmins', 'admins', 'viewers', 'delegates'].forEach(k =>
  ck('renders the ' + k + ' card', page.indexOf('aclCard-' + k) !== -1));
ck('renders the Open Access toggle', page.indexOf('secOpenAccess') !== -1);
ck('renders the save button', page.indexOf('secSaveBtn') !== -1);

// ── 2. Counts include the pinned bootstrap admin ─────────────────────────────
eq('super count = 1 stored + 1 pinned', NODES['aclCount-superAdmins'].textContent, '2');
eq('admin count',  NODES['aclCount-admins'].textContent, '2');
eq('viewer count', NODES['aclCount-viewers'].textContent, '1');
ck('bootstrap admin is shown as pinned',
   NODES['aclBody-superAdmins'].innerHTML.indexOf('built in') !== -1);
ck('bootstrap admin has no remove button',
   NODES['aclBody-superAdmins'].innerHTML.indexOf("aclRemove_('superAdmins',") === -1 ||
   !/boss@x\.com[\s\S]{0,120}?aclRemove_/.test(NODES['aclBody-superAdmins'].innerHTML));

// ── 3. Add ───────────────────────────────────────────────────────────────────
load();
NODES['aclAdd-admins'].value = 'NEW@x.com';
api.aclAdd_('admins');
eq('add lowercases and appends', api.getACL().admins, ['a1@x.com', 'a2@x.com', 'new@x.com']);
eq('count badge follows the add', NODES['aclCount-admins'].textContent, '3');

NODES['aclAdd-admins'].value = 'a1@x.com';
api.aclAdd_('admins');
eq('duplicate on the same list is refused', api.getACL().admins.length, 3);
ck('…and says so', NODES['aclMsg-admins'].textContent.indexOf('Already on this list') !== -1);

NODES['aclAdd-admins'].value = 'v1@x.com';
api.aclAdd_('admins');
eq('duplicate from another list is refused', api.getACL().admins.length, 3);
ck('…naming that list', NODES['aclMsg-admins'].textContent.indexOf('Viewers') !== -1);

NODES['aclAdd-admins'].value = 'boss@x.com';
api.aclAdd_('admins');
eq('the pinned bootstrap admin cannot be re-added elsewhere', api.getACL().admins.length, 3);

NODES['aclAdd-admins'].value = 'not-an-email';
api.aclAdd_('admins');
eq('malformed address is refused', api.getACL().admins.length, 3);
ck('…and says why', NODES['aclMsg-admins'].textContent.indexOf('valid email') !== -1);

// Delegates need both halves.
load();
NODES['aclAdd-delegates'].value  = 'd2@x.com';
NODES['aclAdd2-delegates'].value = '';
api.aclAdd_('delegates');
eq('delegate without a scope name is refused', api.getACL().delegates.length, 1);
NODES['aclAdd2-delegates'].value = 'Sam Lead';
api.aclAdd_('delegates');
eq('delegate with both halves is added',
   api.getACL().delegates.map(d => d.email + '|' + d.scopeName),
   ['d1@x.com|Jane Boss', 'd2@x.com|Sam Lead']);

// ── 4. Remove targets the RIGHT row while a filter is active ─────────────────
// This is the bug the index-carrying filter exists to prevent: with a filter on,
// the visible row's position is not its position in the array.
load({ admins: ['aa@x.com', 'zz@x.com', 'ab@x.com', 'zy@x.com', 'ac@x.com', 'zx@x.com', 'ad@x.com'] });
ck('filter box appears past 6 entries', NODES['aclBody-admins'].innerHTML.indexOf('aclFilter-admins') !== -1);
api.aclFilter_('admins', 'zz');
const filtered = NODES['aclBody-admins'].innerHTML;
ck('filter narrows to the match', filtered.indexOf('zz@x.com') !== -1 && filtered.indexOf('aa@x.com') === -1);
// zz@x.com is index 1 in the array but the ONLY visible row.
const m = filtered.match(/aclRemove_\('admins',(\d+)\)/);
ck('the visible row carries its REAL array index', m && m[1] === '1');
api.aclRemove_('admins', Number(m[1]));
eq('remove drops the clicked row, not the first one',
   api.getACL().admins, ['aa@x.com', 'ab@x.com', 'zy@x.com', 'ac@x.com', 'zx@x.com', 'ad@x.com']);

api.aclFilter_('admins', 'nothing-matches');
ck('empty filter result says so', NODES['aclBody-admins'].innerHTML.indexOf('No match for') !== -1);

// ── 5. Bulk mode ─────────────────────────────────────────────────────────────
load();
api.aclBulkToggle_('admins', true);
ck('bulk mode renders a textarea', NODES['aclBody-admins'].innerHTML.indexOf('aclBulk-admins') !== -1);
NODES['aclBulk-admins'].value = 'x1@x.com\nx2@x.com\nx1@x.com\ngarbage\n\nx3@x.com';
api.aclBulkApply_('admins');
eq('bulk apply de-dupes and drops malformed lines',
   api.getACL().admins, ['x1@x.com', 'x2@x.com', 'x3@x.com']);
ck('…and reports how many it skipped', NODES['aclMsg-admins'].textContent.indexOf('2 lines skipped') !== -1);
ck('bulk mode closes after apply', NODES['aclBody-admins'].innerHTML.indexOf('aclBulk-admins') === -1);

load();
api.aclBulkToggle_('delegates', true);
NODES['aclBulk-delegates'].value = 'p@x.com:Big Boss\nmissing-colon\nq@x.com:';
api.aclBulkApply_('delegates');
eq('delegate bulk keeps only well-formed pairs',
   api.getACL().delegates.map(d => d.email + '|' + d.scopeName), ['p@x.com|Big Boss']);

// ── 6. Super-admin list is read-only for a plain Admin ───────────────────────
load({ canManageSuperAdmins: false, callerRole: 'admin' });
const superBody = NODES['aclBody-superAdmins'].innerHTML;
ck('locked list offers no Add', superBody.indexOf('aclAdd-superAdmins') === -1);
ck('locked list offers no Remove', superBody.indexOf("aclRemove_('superAdmins'") === -1);
ck('locked list offers no bulk edit', superBody.indexOf("aclBulkToggle_('superAdmins'") === -1);
ck('locked list explains why', superBody.indexOf('only a Super Admin') !== -1);
NODES['aclAdd-admins'].value = 'sneaky@x.com';
api.aclAdd_('superAdmins');   // no input element exists; must be a no-op either way
eq('a locked list cannot be mutated', api.getACL().superAdmins, ['sa2@x.com']);

// ── 7. Save payload ──────────────────────────────────────────────────────────
load();
SAVED = null;
api.saveSecuritySettings_();
eq('save sends admins',    SAVED.admins,  ['a1@x.com', 'a2@x.com']);
eq('save sends viewers',   SAVED.viewers, ['v1@x.com']);
eq('save sends delegates', SAVED.delegates, [{ email: 'd1@x.com', scopeName: 'Jane Boss' }]);
eq('a super admin sends the super list', SAVED.superAdmins, ['sa2@x.com']);
ck('the pinned bootstrap admin is NOT re-sent', SAVED.superAdmins.indexOf('boss@x.com') === -1);

// A plain Admin must omit the field entirely — the server throws on it.
load({ canManageSuperAdmins: false, callerRole: 'admin' });
SAVED = null;
api.saveSecuritySettings_();
ck('a plain admin omits superAdmins', !('superAdmins' in SAVED));

// Edits left in a bulk textarea must not be silently dropped by Save.
load();
api.aclBulkToggle_('viewers', true);
NODES['aclBulk-viewers'].value = 'kept@x.com';
SAVED = null;
api.saveSecuritySettings_();
eq('save commits a card still in bulk mode', SAVED.viewers, ['kept@x.com']);

// ── 8. Open Access dims the viewers card ─────────────────────────────────────
load();
NODES['secOpenAccess'].checked = true;
api.secToggleOpenAccess_();
ck('open access dims the viewers card', NODES['aclCard-viewers'].classList.contains('acl-dimmed'));
NODES['secOpenAccess'].checked = false;
api.secToggleOpenAccess_();
ck('turning it off undims', !NODES['aclCard-viewers'].classList.contains('acl-dimmed'));

// ── 9. Scrolling is what the user actually asked for ─────────────────────────
ck('the list is a bounded scroll area, not an unbounded stack',
   /\.acl-list\s*\{[^}]*max-height:\s*\d+px[^}]*overflow-y:\s*auto/.test(html));
ck('long addresses ellipsize instead of wrapping the row',
   /\.acl-email\s*\{[^}]*text-overflow:\s*ellipsis/.test(html));

console.log(fail === 0
  ? `✅ access-list-editor-checks: ${pass} checks passed`
  : `❌ access-list-editor-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
