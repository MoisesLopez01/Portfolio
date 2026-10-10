// Node checks for ⚖️ Scoring Weights as a read-for-everyone page (2026.W41).
//
//   1. Policy — every role may READ the weights; only Super Admin / Admin may EDIT
//      (canEditScoring_). Org admins, viewers and managers read only.
//   2. Server — both save endpoints gate on canEditScoring_; getScoringConfig admits
//      any allowed caller, never seeds sheets for a non-editor (a write), and hands a
//      non-editor only the summary (no headcounts, title lists or raw matrix).
//   3. Summary — familySummaryWeights_ (what the read-only tables show) agrees with
//      weightsForEmployee_ (what actually scores people) for a family member at a
//      level with no override of its own.
//   4. Client — the view is open to every role, the editor is offered only to
//      canEditScoring_(), and never while previewing.
//
// Run: node "ps-dashboard/tests/scoring-weights-view-checks.js"
const fs   = require('fs');
const path = require('path');

const dir      = path.join(__dirname, '..');
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const report   = fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8');
const teams    = fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8');
const html     = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');

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
function extract(src, startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) { console.error('❌ could not find: ' + startsWith); process.exit(1); }
  const j = src.indexOf(endsWith, i);
  if (j < 0) { console.error('❌ could not close: ' + startsWith); process.exit(1); }
  return src.slice(i, j + endsWith.length);
}
// Body of a top-level function: from its signature to the next "\n}" at column 0.
function fnBody(src, name) { return extract(src, 'function ' + name + '(', '\n}'); }

// ── 1. Policy ────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-eval
const canEditScoring_ = eval('(' + fnBody(security, 'canEditScoring_') + ')');
ck('super admin may edit scoring',  canEditScoring_({ role: 'superadmin' }) === true);
ck('admin may edit scoring',        canEditScoring_({ role: 'admin' }) === true);
ck('org admin may NOT edit scoring', canEditScoring_({ role: 'orgadmin' }) === false);
ck('viewer may NOT edit scoring',   canEditScoring_({ role: 'viewer' }) === false);
ck('manager may NOT edit scoring',  canEditScoring_({ role: 'manager' }) === false);
ck('a bare role string works too',  canEditScoring_('admin') === true && canEditScoring_('orgadmin') === false);

// ── 2. Server wiring ─────────────────────────────────────────────────────────
const saveW = fnBody(report, 'saveWeightSettings');
const saveM = fnBody(report, 'saveScoringMatrix');
const getC  = fnBody(report, 'getScoringConfig');
ck('saveWeightSettings gates on canEditScoring_', /!canEditScoring_\(access\)/.test(saveW));
ck('saveScoringMatrix gates on canEditScoring_',  /!canEditScoring_\(access\)/.test(saveM));
ck('neither save endpoint still accepts hasAdminPower_ (would re-admit org admins)',
   !/hasAdminPower_/.test(saveW) && !/hasAdminPower_/.test(saveM));
ck('getScoringConfig admits any allowed caller',
   /if \(!access\.allowed\) return \{ ok: false, denied: true \};/.test(getC));
ck('getScoringConfig derives canEdit from canEditScoring_', /const canEdit = canEditScoring_\(access\);/.test(getC));
ck('Job Catalog seeding is editor-only',    /if \(canEdit && !ss\.getSheetByName\(JOB_CATALOG_SHEET_\)\)/.test(getC));
ck('Scoring Matrix seeding is editor-only', /if \(canEdit && !ss\.getSheetByName\(SCORING_MATRIX_SHEET_\)\)/.test(getC));
const nonEditor = extract(getC, 'if (!canEdit) {', '\n    }');
ck('non-editor payload says canEdit: false', /canEdit: false/.test(nonEditor));
['matrix', 'rolesByFamily', 'unmappedTitles', 'count', 'seeded'].forEach(k => {
  ck('non-editor payload omits ' + k, !new RegExp('\\b' + k + '\\b\\s*[:,]').test(nonEditor.replace(/canEdit: false/, '')));
});
ck('non-editor payload returns before the editor-only fields are built',
   getC.indexOf('if (!canEdit) {') < getC.indexOf('const rolesByFamily'));
ck('editor payload says canEdit: true', /ok: true, canEdit: true, seeded, matrix, sections, rolesByFamily,/.test(getC));

// ── 3. Summary agrees with the scorer ────────────────────────────────────────
const Logger = { log: () => {} };
const CONFIG_PS = { PS_DEPT: 'Services' };
const scoringSlice = [
  extract(report, 'const DEFAULT_WEIGHTS_', ';'),
  extract(report, 'const WEIGHT_METRICS_', ';'),
  extract(report, 'const COE_FAMILY_CODE_', ';'),
  extract(report, 'const TRACKING_FAMILIES_', ';'),
  extract(report, 'const ALL_KEY_', ';'),
  extract(report, 'const RND_DEFAULT_W_', ';'),
  extract(report, 'const SALES_DEFAULT_W_', ';'),
  fnBody(report, 'normPS_'),
  fnBody(report, 'normTitleKey_'),
  fnBody(report, 'parseJobCode_'),
  fnBody(report, 'titleCodeInfo_'),
  fnBody(report, 'fillWeights_'),
  fnBody(report, 'blockFillBase_'),
  fnBody(report, 'maskToTeamMetrics_'),
  fnBody(report, 'weightsForEmployee_'),
  fnBody(report, 'familySummaryWeights_'),
  extract(teams, 'const TEAMS_ = [', '\n];'),
  fnBody(teams, 'teamByKey_'),
].join('\n');
// eslint-disable-next-line no-eval
const S = eval('(function(){' + scoringSlice +
  '\nreturn { weightsForEmployee_, familySummaryWeights_, ALL_KEY_ };})()');

const base = { goals: 25, tracked: 25, planned: 20, rcr: 15, kudos: 5, si: 5, pto: 5 };
const matrix = {
  services: {
    JF009: { ALL: { goals: 20, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 5, pto: 5 },
             I7:  { goals: 30, tracked: 30, planned: 20, rcr: 10, kudos: 5, si: 5, pto: 0 } },
    // A hand-edited row giving a non-tracking family hours weight: must be masked.
    JF008: { ALL: { goals: 40, tracked: 20, planned: 0, rcr: 0, kudos: 20, si: 10, pto: 10 } },
    ALL:   { ALL: { goals: 25, tracked: 25, planned: 20, rcr: 15, kudos: 5, si: 5, pto: 5 } },
  },
  rnd:   { JF017: { ALL: { goals: 45, tracked: 10, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 15 } } },
  sales: {},
};
const cases = [
  { team: 'services', fam: 'JF009', title: '09.I3.1 - Consultant, Service Delivery', tracksTime: true },
  { team: 'services', fam: 'JF007', title: '07.I4.1 - Support Engineer', tracksTime: true },
  { team: 'services', fam: 'JF008', title: '08.I5.1 - Technical Trainer', tracksTime: false },
  { team: 'services', fam: 'JF015', title: '15.I2.2 - Operations Analyst', tracksTime: false },
  { team: 'rnd',      fam: 'JF017', title: '17.I3.2 - Platform Engineer', tracksTime: false },
  { team: 'sales',    fam: 'JF004', title: '04.I4.1 - Customer Success Manager', tracksTime: false },
  { team: 'services', fam: 'ALL',   title: 'Chief Vibes Officer', tracksTime: true },
];
cases.forEach(c => {
  const emp = { name: 'x', team: c.team, jobTitle: c.title, tracksTime: c.tracksTime, isCrewMember: false };
  const scored = S.weightsForEmployee_(emp, matrix, new Map(), base, null);
  const shown  = S.familySummaryWeights_(c.team, c.fam, matrix, base).weights;
  eq('summary = scorer for ' + c.team + '/' + c.fam, shown, Object.assign({}, scored));
});
eq('a JF009 I7 override is flagged as "varies by level"',
   S.familySummaryWeights_('services', 'JF009', matrix, base).levelOverrides, 1);
eq('a block with only an ALL cell does not vary by level',
   S.familySummaryWeights_('services', 'JF008', matrix, base).levelOverrides, 0);
const jf008 = S.familySummaryWeights_('services', 'JF008', matrix, base).weights;
ck('non-tracking JF008 shows no hours weight even from a hand-edited row', jf008.tracked === 0 && jf008.planned === 0 && jf008.rcr === 0);
const rnd = S.familySummaryWeights_('rnd', 'JF017', matrix, base).weights;
ck('R&D shows no tracked / planned / RCR weight', rnd.tracked === 0 && rnd.planned === 0 && rnd.rcr === 0);
const sales = S.familySummaryWeights_('sales', 'JF004', matrix, base).weights;
ck('an empty Sales block shows the Sales defaults', sales.goals === 40 && sales.tracked === 0);
const mutable = S.familySummaryWeights_('services', 'ALL', matrix, base).weights;
mutable.goals = 999;
ck('summary weights are copies — editing one never mutates the flat base', base.goals === 25);

// ── 4. Client ────────────────────────────────────────────────────────────────
ck('Scoring Weights is visible to every role (roles: null)',
   /\{ id: "weights",[^\n]*roles: null[^\n]*\}/.test(html));
ck('client canEditScoring_ = Super Admin / Admin, never while previewing',
   /function canEditScoring_\(\)\s*\{\s*return !STATE\.viewAs && \(STATE\.userRole === 'superadmin' \|\| STATE\.userRole === 'admin'\);\s*\}/.test(html));
const tab = fnBody(html, 'renderWeightsTab_');
ck('renderWeightsTab_ asks canEditScoring_()', /var canEdit = canEditScoring_\(\);/.test(tab));
ck('a non-editor returns before any editor markup is built',
   tab.indexOf('if (!canEdit) {') !== -1 && tab.indexOf('if (!canEdit) {') < tab.indexOf('weight-slider'));
ck('the editor sits folded under "Edit weights"', /<details class="sw-editor" id="weightsEditor"/.test(tab) && /Edit weights/.test(tab));
ck('everyone gets the summary placeholder', /id="scoringSummary"/.test(fnBody(html, 'renderScoringOverview_')));
const load = fnBody(html, 'loadScoringMatrix_');
ck('the summary renders for every caller', /renderScoringSummary_\(\);/.test(load));
ck('the matrix editor renders only on an editor payload', /if \(cfg && cfg\.canEdit\) renderMatrixSection_\(\);/.test(load));

console.log(fail === 0
  ? `✅ scoring-weights-view-checks: ${pass} checks passed`
  : `❌ scoring-weights-view-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
