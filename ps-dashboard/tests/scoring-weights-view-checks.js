// Node checks for ⚖️ Scoring Weights as a read-for-everyone page (2026.W41).
//
//   1. Policy — every role may READ the weights; only Super Admin / Admin may EDIT
//      (canEditScoring_). Org admins, viewers and managers read only.
//   2. Server — both save endpoints gate on canEditScoring_; getScoringConfig admits
//      any allowed caller, never seeds sheets for a non-editor (a write), and hands a
//      non-editor only the summary (no headcounts, title lists or raw matrix).
//   3. Summary — familySummaryWeights_ (what the page shows: the role row AND its
//      level fold) agrees with weightsForEmployee_ (what actually scores people), at
//      a level with its own cell and at one that inherits the role.
//   4. Client — the view is open to every role, the editor is offered only to
//      canEditScoring_(), and never while previewing; the page is the company
//      default strip + ONE role table whose rows fold open to their levels; org-scoped
//      callers get only the roles and levels their own people hold.
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
ck('non-editor payload ships each role\'s levels (catalog titles + resolved weights)', /levels: f\.levels/.test(nonEditor));
ck('non-editor payload ships the level order', /levelCols: LEVEL_COLS_/.test(nonEditor));
ck('non-editor catch-all ships its allowed metrics', /catchAll: \{ weights: s\.catchAll\.weights, metrics: s\.catchAll\.metrics/.test(nonEditor));
ck('getScoringConfig resolves family summaries WITH the catalog (so levels come through)',
   /familySummaryWeights_\(s\.team\.key, f\.code, matrix, base, catalog\)/.test(getC));
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
  extract(report, 'const LEVEL_COLS_', ';'),
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
  fnBody(report, 'resolveBlockWeights_'),
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

// The level fold: each catalog level of a role, with the weights it scores with.
const catalog = new Map([
  ['consultant, service delivery',        { title: 'Consultant, Service Delivery',        family: 'JF009', track: 'I', level: 3, levelKey: 'I3' }],
  ['senior consultant, service delivery', { title: 'Senior Consultant, Service Delivery', family: 'JF009', track: 'I', level: 3, levelKey: 'I3' }],
  ['principal consultant',                { title: 'Principal Consultant',                family: 'JF009', track: 'I', level: 7, levelKey: 'I7' }],
  ['engagement manager',                  { title: 'Engagement Manager',                  family: 'JF009', track: 'M', level: 6, levelKey: 'M6' }],
  ['technical trainer',                   { title: 'Technical Trainer',                   family: 'JF008', track: 'I', level: 5, levelKey: 'I5' }],
]);
const jf009 = S.familySummaryWeights_('services', 'JF009', matrix, base, catalog);
eq('levels follow LEVEL_COLS_ order and carry the catalog titles, sorted',
   jf009.levels.map(l => l.key + ':' + l.titles.join('|')),
   ['I3:Consultant, Service Delivery|Senior Consultant, Service Delivery', 'I7:Principal Consultant', 'M6:Engagement Manager']);
const i7 = S.weightsForEmployee_({ name: 'x', team: 'services', jobTitle: 'Principal Consultant', tracksTime: true, isCrewMember: false }, matrix, catalog, base, null);
eq('a level with its own cell shows exactly what scores its people (I7)', jf009.levels[1].weights, Object.assign({}, i7));
const m6 = S.weightsForEmployee_({ name: 'x', team: 'services', jobTitle: 'Engagement Manager', tracksTime: true, isCrewMember: false }, matrix, catalog, base, null);
eq('a level without a cell shows the role row (M6 inherits ALL)', jf009.levels[2].weights, Object.assign({}, m6));
eq('the level that carries its own cell is flagged', jf009.levels.map(l => l.own), [false, true, false]);
ck('levels are not built without the catalog', S.familySummaryWeights_('services', 'JF009', matrix, base).levels === undefined);
ck('the catch-all never lists levels', S.familySummaryWeights_('services', 'ALL', matrix, base, catalog).levels === undefined);
ck('a non-tracking role\'s levels carry no hours weight either',
   S.familySummaryWeights_('services', 'JF008', matrix, base, catalog).levels.every(l => l.weights.tracked === 0 && l.weights.planned === 0));

// ── 4. Client ────────────────────────────────────────────────────────────────
ck('Scoring Weights is visible to every role (roles: null)',
   /\{ id: "weights",[^\n]*roles: null[^\n]*\}/.test(html));
ck('client canEditScoring_ = Super Admin / Admin, never while previewing',
   /function canEditScoring_\(\)\s*\{\s*return !STATE\.viewAs && \(STATE\.userRole === 'superadmin' \|\| STATE\.userRole === 'admin'\);\s*\}/.test(html));
const tab = fnBody(html, 'renderWeightsTab_');
ck('renderWeightsTab_ asks canEditScoring_()', /var canEdit = canEditScoring_\(\);/.test(tab));
ck('a non-editor returns before any editor markup is built',
   tab.indexOf('if (!canEdit) {') !== -1 && tab.indexOf('if (!canEdit) {') < tab.indexOf('class="weight-num"'));
ck('the advanced editor sits folded under "Advanced settings"',
   /<details class="sw-editor" id="weightsEditor"/.test(tab) && /Advanced settings/.test(tab));
ck('everyone gets the summary placeholder', /id="scoringSummary"/.test(fnBody(html, 'renderScoringOverview_')));
// The read view is ONE table, one row per role, the same seven metric columns.
const summary = fnBody(html, 'renderScoringSummary_');
ck('summary renders a single table (no per-team loop of tables)',
   (summary.match(/<table class="sw-table/g) || []).length === 1);
ck('rate inputs appear only when the payload AND the client say "editor"',
   /var editable = !scoped && !!\(cfg\.canEdit && cfg\.matrix && canEditScoring_\(\)\);/.test(summary) &&
   /editable\s*\?\s*'<input type="number" class="sw-rate"/.test(summary));
ck('no slider anywhere on the page', !/type="range"/.test(html));
ck('every row shows its score mix', /roleMixBar_\(r\.points\)/.test(summary));
const saveRole = fnBody(html, 'saveRoleWeights_');
ck('Save writes only roles whose points changed', /if \(!Object\.keys\(vals\)\.some\(/.test(saveRole));
ck('Save writes the family-wide (ALL) cell, leaving level cells alone', /mx\[t\.team\]\[t\.code\]\.ALL = cell;/.test(saveRole));
ck('Save goes through saveScoringMatrix (server re-checks canEditScoring_)', /\.saveScoringMatrix\(\{ matrix: MATRIX_CFG\.matrix \}\)/.test(saveRole));
// eslint-disable-next-line no-eval
const sharesOf100_ = eval('(' + fnBody(html, 'sharesOf100_') + ')');
const thirds = sharesOf100_({ goals: 1, kudos: 1, si: 1 }, ['goals', 'kudos', 'si']);
eq('points always total exactly 100 (1:1:1 → 34/33/33)', thirds.goals + thirds.kudos + thirds.si, 100);
eq('points mirror the shares of renormalized weights', sharesOf100_({ goals: 45, kudos: 20, si: 20, pto: 15 }, ['goals', 'kudos', 'si', 'pto']),
   { goals: 45, kudos: 20, si: 20, pto: 15 });
ck('summary columns are all seven metrics (WEIGHT_DEFS), not the team subset',
   /WEIGHT_DEFS\.map\(function\(d\)/.test(summary) && !/teamWeightDefs_/.test(summary));
// One table only: no metric-definition list (that lives in 📖 Documentation).
ck('no duplicate definitions list on the page', html.indexOf('SCORE_METRIC_GUIDE') === -1);
ck('the lead line points to Documentation for definitions',
   /switchTab\(\\'dataref\\'\)/.test(fnBody(html, 'renderScoringOverview_')));
// Three levels of disclosure on the one page.
ck('level 1 — the company default strip renders from cfg.baseWeights', /renderCompanyDefault_\(cfg, editable\)/.test(summary) &&
   /sharesOf100_\(cfg\.baseWeights \|\| SCORE_W, keys\)/.test(fnBody(html, 'renderCompanyDefault_')));
ck('level 3 — a role with catalog levels gets a fold row, hidden until opened',
   /if \(hasLv\) html \+= '<tr class="sw-detail" id="swD-' \+ i \+ '"' \+ \(open \? '' : ' hidden'\)/.test(summary) &&
   /renderLevelFold_\(r, scoped, editable\)/.test(summary));
ck('the fold toggle is a real button with aria-expanded / aria-controls',
   /<button type="button" class="sw-x" id="swX-' \+ i \+ '" aria-expanded="/.test(summary) && /aria-controls="swD-' \+ i \+ '"/.test(summary));
ck('a role whose levels differ is tagged "varies by level"', /sw-tag[^']*>varies by level</.test(summary));
const fold = fnBody(html, 'renderLevelFold_');
ck('the fold lists level, job titles and the seven metric points', /Job titles at this level/.test(fold) && /WEIGHT_DEFS\.map\(function\(d\) \{ return '<th>' \+ esc\(d\.label\)/.test(fold));
ck('a level point that differs from the role row is highlighted', /diff \? ' sw-diff'/.test(fold));
ck('the fold never offers inputs (level tuning stays in Advanced settings)', !/<input/.test(fold) && /Level-specific points are set under Advanced settings/.test(fold));
ck('"How a score is built" is folded and definition-free', /<details class="sw-how"/.test(fnBody(html, 'renderHowItWorks_')) &&
   !/Hours logged vs/.test(fnBody(html, 'renderHowItWorks_')));
ck('an expand-all / collapse-all control exists', /id="swAllBtn" onclick="swToggleAll_\(\)"/.test(summary));
// Org-scoped callers: the same table, narrowed to their own roles and levels, read-only.
ck('the scoped view keys off the server scope stamp, not a role string',
   /var scoped = !!\(DATA && DATA\.managerScopeName\);/.test(summary));
ck('the scoped view is never editable', /var editable = !scoped && /.test(summary));
ck('both views share the one table', /if \(scoped\) rows = buildScopedRows_\(cfg, rows\);/.test(summary));
{
  const WEIGHT_DEFS = ['goals', 'tracked', 'planned', 'rcr', 'kudos', 'si', 'pto'].map(k => ({ key: k }));
  const isCrewEmp = e => !!e.isCrewMember;
  const svcW = { goals: 25, tracked: 25, planned: 20, rcr: 15, kudos: 5, si: 5, pto: 5 };
  const i7W  = { goals: 30, tracked: 30, planned: 20, rcr: 10, kudos: 5, si: 5, pto: 0 };
  const opsW = { goals: 45, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 15 };
  const svcM = ['rcr', 'si', 'goals', 'tracked', 'planned', 'kudos', 'pto'], opsM = ['si', 'goals', 'kudos', 'pto'];
  const cfg = { levelCols: ['I1','I2','I3','I4','I5','I6','I7','I8','M4','M5','M6','M7','M8','M9','M10'], sections: [
    { team: { key: 'services', label: 'Services' },
      families: [
        { code: 'JF009', name: 'Service Delivery', weights: svcW, metrics: svcM, levels: [
          { key: 'I3', titles: ['Consultant, Service Delivery', 'Senior Consultant, Service Delivery'], weights: svcW, own: false },
          { key: 'I7', titles: ['Principal Consultant'], weights: i7W, own: true },
          { key: 'M6', titles: ['Engagement Manager'], weights: svcW, own: false } ] },
        { code: 'JF015', name: 'Operations', weights: opsW, metrics: opsM, levels: [
          { key: 'I2', titles: ['Operations Analyst'], weights: opsW, own: false } ] } ],
      catchAll: { weights: svcW, metrics: svcM } },
    { team: { key: 'rnd', label: 'R&D' }, families: [
        { code: 'JF015', name: 'Operations', weights: opsW, metrics: opsM, levels: [
          { key: 'I2', titles: ['Operations Analyst'], weights: opsW, own: false } ] } ],
      catchAll: { weights: opsW, metrics: opsM } },
  ] };
  const DATA = { managerScopeName: 'Someone', employees: [
    { jobTitle: '09.I3.1 - Consultant, Service Delivery', team: 'services' },
    { jobTitle: 'Senior Consultant, Service Delivery', team: 'services' },      // catalog title, no code prefix
    { jobTitle: '09.I7.1 - Principal Consultant', team: 'services' },
    { jobTitle: '09.M9.1 - Director, Service Delivery', team: 'services' },      // code only, level not in catalog
    { jobTitle: '15.I2.2 - Operations Analyst', team: 'services' },
    { jobTitle: 'Chief Vibes Officer', team: 'services' },                        // uncatalogued → Other
    { jobTitle: '09.I3.3 - Consultant', team: 'services', isCrewMember: true },  // crew left out
  ] };
  // eslint-disable-next-line no-eval
  const B = eval('(function(){' + ['sharesOf100_', 'pointsDiffer_', 'buildRoleRows_', 'swNormTitle_', 'scopeRoleUsage_', 'buildScopedRows_']
    .map(n => fnBody(html, n)).join('\n') + '\nreturn { buildRoleRows_, buildScopedRows_ };})()');
  const all = B.buildRoleRows_(cfg);
  eq('company-wide: one row per role, identical Operations blocks merged across teams',
     all.map(r => r.name + (r.showTeam ? ' (' + r.team + ')' : '') + ' targets=' + r.targets.length), ['Service Delivery targets=1', 'Operations targets=2']);
  ck('company-wide: a role with a differing level is flagged, one without is not', all[0].varies === true && all[1].varies === false);
  ck('company-wide: level points come from the level\'s own weights (I7)',
     Object.keys(i7W).every(k => all[0].levels[1].points[k] === i7W[k]));
  const rows = B.buildScopedRows_(cfg, all);
  eq('scoped: only the roles my people hold, with headcounts, crew left out, uncatalogued → Other job titles',
     rows.map(r => r.name + ' ×' + r.n), ['Service Delivery ×4', 'Operations ×1', 'Other job titles ×1']);
  eq('scoped: only the levels my people hold, matched by catalog title OR job code, a code-only level listed as scoring like the role',
     rows[0].levels.map(l => l.key + ' ×' + l.n + (l.titles.length ? '' : ' (code only)')), ['I3 ×2', 'I7 ×1', 'M9 ×1 (code only)']);
  ck('scoped: a role row keeps the server-resolved role points and its metric mask', rows[1].metrics.indexOf('tracked') === -1 && rows[1].points.goals === 45);
  ck('scoped: the Other row carries no fold and no save targets', rows[2].levels.length === 0 && rows[2].targets.length === 0);
}
const load = fnBody(html, 'loadScoringMatrix_');
ck('the summary renders for every caller', /renderScoringSummary_\(\);/.test(load));
ck('the matrix editor renders only on an editor payload', /if \(cfg && cfg\.canEdit\) renderMatrixSection_\(\);/.test(load));

console.log(fail === 0
  ? `✅ scoring-weights-view-checks: ${pass} checks passed`
  : `❌ scoring-weights-view-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
