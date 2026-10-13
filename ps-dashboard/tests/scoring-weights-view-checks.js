// Node checks for ⚖️ Scoring Weights as a read-for-everyone page (2026.W41), with
// team-scoped editing (2026.W42).
//
//   1. Policy — every role may READ the weights; only Super Admin / Org Admin may EDIT
//      the matrix (canEditScoring_), and only Super Admin the company default
//      (canEditScoringBase_). Plain admins, viewers and managers read only.
//   2. Server — the save endpoints gate on those helpers; an org admin may write only
//      the teams their own org tree holds (scoringEditTeams_) and any other team is
//      refused outright; getScoringConfig admits any allowed caller, never seeds
//      sheets for a non-editor (a write), hands a non-editor only the summary (no
//      headcounts, title lists or raw matrix) and an org admin only their teams.
//   3. Summary — familySummaryWeights_ (what the page shows: the role row AND its
//      level fold) agrees with weightsForEmployee_ (what actually scores people), at
//      a level with its own cell and at one that inherits the role.
//   4. Client — the view is open to every role, the editor is offered only to
//      canEditScoring_() for a team in cfg.editTeams, and never while previewing;
//      the page is the company default strip + ONE role table (the team the toggle
//      shows) whose rows fold open to their levels; org-scoped callers get only the
//      roles and levels their own people hold. Since 2026.W42 (later) there is NO
//      separate editor: the strip (super admins), the role cells and the level cells
//      are the inputs, and one Save writes the company default and the matrix.
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
const P = eval('(function(){' + [fnBody(security, 'isSuperAdmin_'), fnBody(security, 'canEditScoring_'), fnBody(security, 'canEditScoringBase_')].join('\n') +
  '\nreturn { canEditScoring_, canEditScoringBase_ };})()');
const canEditScoring_ = P.canEditScoring_, canEditScoringBase_ = P.canEditScoringBase_;
ck('super admin may edit scoring',   canEditScoring_({ role: 'superadmin' }) === true);
ck('org admin may edit scoring',     canEditScoring_({ role: 'orgadmin' }) === true);
ck('plain admin may NOT edit scoring', canEditScoring_({ role: 'admin' }) === false);
ck('viewer may NOT edit scoring',    canEditScoring_({ role: 'viewer' }) === false);
ck('manager may NOT edit scoring',   canEditScoring_({ role: 'manager' }) === false);
ck('a bare role string works too',   canEditScoring_('orgadmin') === true && canEditScoring_('admin') === false);
ck('only a super admin may edit the company default',
   canEditScoringBase_({ role: 'superadmin' }) === true && canEditScoringBase_({ role: 'orgadmin' }) === false &&
   canEditScoringBase_({ role: 'admin' }) === false && canEditScoringBase_('viewer') === false);

// ── 2. Server wiring ─────────────────────────────────────────────────────────
const saveW = fnBody(report, 'saveWeightSettings');
const saveM = fnBody(report, 'saveScoringMatrix');
const getC  = fnBody(report, 'getScoringConfig');
ck('saveWeightSettings (company default) gates on canEditScoringBase_', /!canEditScoringBase_\(access\)/.test(saveW));
ck('saveScoringMatrix gates on canEditScoring_',  /!canEditScoring_\(access\)/.test(saveM));
ck('neither save endpoint still accepts hasAdminPower_ (would re-admit plain admins)',
   !/hasAdminPower_/.test(saveW) && !/hasAdminPower_/.test(saveM));
ck('saveScoringMatrix resolves the caller\'s editable teams', /const editTeams = scoringEditTeams_\(access, \(\) => \{/.test(saveM));
ck('saveScoringMatrix refuses a payload naming a team outside that scope (whole save, not a trim)',
   /const refused = Object\.keys\(incoming\)\.filter\(k => TEAMS_\.some\(t => t\.key === k\) && editTeams\.indexOf\(k\) === -1\);/.test(saveM) &&
   /if \(refused\.length > 0\) \{[\s\S]*?return \{ ok: false, error: "You may only edit "/.test(saveM));
ck('saveScoringMatrix refuses an editor with no team at all', /if \(editTeams\.length === 0\) return \{ ok: false/.test(saveM));
ck('getScoringConfig admits any allowed caller',
   /if \(!access\.allowed\) return \{ ok: false, denied: true \};/.test(getC));
ck('getScoringConfig derives the editor flag from canEditScoring_ AND a non-empty team scope',
   /const mayEdit = canEditScoring_\(access\);/.test(getC) &&
   /const editTeams = scoringEditTeams_\(access, \(\) => \(\{ roster, bridges \}\)\);/.test(getC) &&
   /const canEdit\s+= mayEdit && editTeams\.length > 0;/.test(getC));
ck('getScoringConfig reads the roster WITH bridges (an org admin\'s tree walk must not be severed)',
   /const bridges = new Map\(\);\s*const roster = readPSRoster_\(bridges\);/.test(getC));
ck('Job Catalog seeding is editor-only',    /if \(mayEdit && !ss\.getSheetByName\(JOB_CATALOG_SHEET_\)\)/.test(getC));
ck('Scoring Matrix seeding is editor-only', /if \(mayEdit && !ss\.getSheetByName\(SCORING_MATRIX_SHEET_\)\)/.test(getC));
ck('an org admin\'s editor payload is narrowed to their teams (sections AND matrix)',
   /const visible = canEditBase \? sections : sections\.filter\(s => editTeams\.indexOf\(s\.team\.key\) !== -1\);/.test(getC) &&
   /const matrixOut = canEditBase \? matrix : \{\};/.test(getC) && /matrixOut\[s\.team\.key\] = matrix\[s\.team\.key\];/.test(getC));
ck('the Services unmapped-title audit ships only to a Services editor',
   /unmappedTitles: editTeams\.indexOf\("services"\) === -1 \? \[\]/.test(getC));

// scoringEditTeams_ — who may write which teams. Pure: stub the roster walk's inputs.
{
  const TEAMS_ = [{ key: 'services', label: 'Services' }, { key: 'rnd', label: 'R&D' }, { key: 'sales', label: 'Sales & Success' }];
  const roster = new Map([
    ['dana director',  { name: 'Dana Director',  supervisor: 'Chief Exec',     team: 'services' }],
    ['amy analyst',    { name: 'Amy Analyst',    supervisor: 'Dana Director',  team: 'services' }],
    ['bo builder',     { name: 'Bo Builder',     supervisor: 'Mia Manager',    team: 'rnd' }],       // reached through a dropped row
    ['sal seller',     { name: 'Sal Seller',     supervisor: 'Someone Else',   team: 'sales' }],     // outside Dana's tree
    ['lone leader',    { name: 'Lone Leader',    supervisor: 'Chief Exec',     team: 'rnd' }],       // org admin with no reports
  ]);
  const bridges = new Map([['mia manager', { name: 'Mia Manager', supNorm: 'dana director' }]]);
  const E = eval('(function(){ const Logger = { log: function() {} };' + [
    fnBody(security, 'isSuperAdmin_'), fnBody(security, 'canEditScoring_'), fnBody(security, 'canEditScoringBase_'),
    fnBody(report, 'normPS_'), fnBody(report, 'resolveManagerScope_'), fnBody(teams, 'availableTeams_'),
    fnBody(report, 'scoringEditTeams_'),
  ].join('\n') + '\nreturn scoringEditTeams_;})()');
  const load = () => ({ roster, bridges });
  let called = 0;
  const counting = () => { called++; return load(); };
  eq('super admin may write every team (and never needs the roster)',
     E({ allowed: true, role: 'superadmin' }, counting), ['services', 'rnd', 'sales']);
  ck('…the roster loader was not called for a super admin', called === 0);
  eq('org admin may write only the teams their own tree holds — through a dropped mid-level manager, own row dropped',
     E({ allowed: true, role: 'orgadmin', delegateScopeName: 'Dana Director' }, load), ['services', 'rnd']);
  eq('org admin whose tree is empty may write nothing',
     E({ allowed: true, role: 'orgadmin', delegateScopeName: 'Lone Leader' }, load), []);
  eq('plain admin may write nothing',  E({ allowed: true, role: 'admin' }, load), []);
  eq('manager may write nothing',      E({ allowed: true, role: 'manager', delegateScopeName: 'Dana Director' }, load), []);
  eq('a denied verdict may write nothing', E({ allowed: false, role: 'denied' }, load), []);
}
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
ck('editor payload says canEdit: true and carries editTeams + canEditBase',
   /ok: true, canEdit: true, canEditBase, editTeams, seeded, matrix: matrixOut, sections: visible, rolesByFamily,/.test(getC));

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
ck('client canEditScoring_ = Super Admin / Org Admin, never while previewing',
   /function canEditScoring_\(\)\s*\{\s*return !STATE\.viewAs && \(STATE\.userRole === 'superadmin' \|\| STATE\.userRole === 'orgadmin'\);\s*\}/.test(html));
ck('client canEditScoringBase_ = super admin only, through isSuperAdmin_()',
   /function canEditScoringBase_\(\)\s*\{\s*return !STATE\.viewAs && isSuperAdmin_\(\);\s*\}/.test(html));
ck('the editable test for the team on screen is server truth (cfg.editTeams), not a role guess',
   /function swCanEditTeam_\(cfg\)\s*\{\s*return canEditScoring_\(\) && !!\(cfg && cfg\.canEdit && cfg\.matrix\) && \(cfg\.editTeams \|\| \[\]\)\.indexOf\(swTeamKey_\(\)\) !== -1;/.test(html));
const tab = fnBody(html, 'renderWeightsTab_');
ck('renderWeightsTab_ renders the overview for everyone and nothing else',
   /renderScoringOverview_\(canEditScoring_\(\)\)/.test(tab) && /loadScoringMatrix_\(\);/.test(tab));
ck('no separate editor anywhere: no Advanced settings fold, no matrix editor, no flat-base editor',
   html.indexOf('Advanced settings') === -1 && html.indexOf('weightsEditor') === -1 && html.indexOf('matrixSection') === -1 &&
   html.indexOf('renderMatrixSection_') === -1 && html.indexOf('saveWeightsToSheet') === -1 && html.indexOf('class="weight-num"') === -1);
ck('the company default strip carries rate inputs for canEditScoringBase_() only',
   /renderCompanyDefault_\(cfg, canEditScoringBase_\(\)\)/.test(fnBody(html, 'renderScoringSummary_')) &&
   /editable\s*\?\s*'<input type="number" class="sw-rate sw-rate-sm"[\s\S]{0,160}data-base="1"/.test(fnBody(html, 'renderCompanyDefault_')));
ck('a Refresh (live read) drops the cached scoring config', /if \(forceRefresh\) MATRIX_CFG = null;/.test(fnBody(html, 'loadData')));
ck('everyone gets the summary placeholder', /id="scoringSummary"/.test(fnBody(html, 'renderScoringOverview_')));
// The read view is ONE table, one row per role, the same seven metric columns.
const summary = fnBody(html, 'renderScoringSummary_');
ck('summary renders a single table (no per-team loop of tables)',
   (summary.match(/<table class="sw-table/g) || []).length === 1);
ck('rate inputs appear only when the payload AND the client say "editor" for the team on screen',
   /var editable = swCanEditTeam_\(cfg\);/.test(summary) &&
   /rowEdit\s*\?\s*'<input type="number" class="sw-rate"/.test(summary) &&
   /var rowEdit = editable && r\.targets\.length > 0;/.test(summary));
ck('the table shows ONE team — the one the toggle shows',
   /var teamCfg = Object\.assign\(\{\}, cfg, \{ sections: \(cfg\.sections \|\| \[\]\)\.filter\(function\(s\) \{ return s\.team\.key === teamKey; \}\) \}\);/.test(summary) &&
   /var rows = buildRoleRows_\(teamCfg\);/.test(summary));
ck('the table names its team and, for editors, the blast radius of a change',
   /esc\(teamLabel\) \+ '<\/b> — '/.test(summary) && /a change applies to every ' \+ esc\(teamLabel\) \+ ' rocketeer in that role/.test(summary));
const pending = fnBody(html, 'swPending_');
ck('a read-only row (no inputs) never blocks Save', /if \(!Object\.keys\(vals\)\.length\) return;/.test(pending));
ck('the base, every edited role row and every edited level must total 100 before Save',
   /if \(swSum_\(b\) !== 100\) out\.ok = false;/.test(pending) && /if \(swSum_\(vals\) !== 100\) out\.ok = false;/.test(pending) &&
   /if \(swSum_\(lv\) !== 100\) out\.ok = false;/.test(pending));
ck('no slider anywhere on the page', !/type="range"/.test(html));
ck('every row shows its score mix', /roleMixBar_\(r\.points\)/.test(summary));
const savePage = fnBody(html, 'saveScoringPage_');
ck('Save writes a role row as the ALL cell only when the row changed (an inheriting family keeps inheriting)',
   /var rowChanged = !swSame_\(vals, r\.points\);/.test(pending) && /row: rowChanged \? vals : null/.test(pending) &&
   /if \(b\.row\) block\.ALL = cellOf\(b\.row\);/.test(savePage));
ck('Save writes a level as its own cell when it differs from the role row, and removes the cell when it matches',
   /if \(!swSame_\(lv, l\.points\)\) levels\[l\.key\] = swSame_\(lv, vals\) \? null : lv;/.test(pending) &&
   /if \(b\.levels\[lk\] === null\) delete block\[lk\]; else block\[lk\] = cellOf\(b\.levels\[lk\]\);/.test(savePage));
ck('Save goes through saveScoringMatrix (server re-checks canEditScoring_ and the teams)',
   /\.saveScoringMatrix\(\{ matrix: MATRIX_CFG\.matrix \}\)/.test(savePage));
ck('a changed company default goes through saveWeightSettings first, then the matrix, then a refetch',
   /\.saveWeightSettings\(p\.base\)/.test(savePage) && savePage.indexOf('.saveWeightSettings(p.base)') > savePage.indexOf('function saveMatrix()') &&
   /SCORE_W = p\.base; saveMatrix\(\);/.test(savePage) && /loadScoringMatrix_\(true\);/.test(savePage));
ck('a role-row edit flows down to the levels that were following it, never to a level tuned on its own',
   /if \(!Object\.keys\(lv\)\.length \|\| !swSame_\(lv, prev\)\) return;/.test(fnBody(html, 'swOnInput_')));
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
ck('level 1 — the company default strip renders from cfg.baseWeights, editable hint for super admins only',
   /renderCompanyDefault_\(cfg, canEditScoringBase_\(\)\)/.test(summary) &&
   /sharesOf100_\(cfg\.baseWeights \|\| SCORE_W, keys\)/.test(fnBody(html, 'renderCompanyDefault_')));
ck('level 3 — a role with catalog levels gets a fold row, hidden until opened',
   /if \(hasLv\) html \+= '<tr class="sw-detail" id="swD-' \+ i \+ '"' \+ \(open \? '' : ' hidden'\)/.test(summary) &&
   /renderLevelFold_\(r, i, scoped, rowEdit\)/.test(summary));
ck('the fold toggle is a real button with aria-expanded / aria-controls',
   /<button type="button" class="sw-x" id="swX-' \+ i \+ '" aria-expanded="/.test(summary) && /aria-controls="swD-' \+ i \+ '"/.test(summary));
ck('a role whose levels differ is tagged "varies by level"', /sw-tag[^']*>varies by level</.test(summary));
const fold = fnBody(html, 'renderLevelFold_');
ck('the fold lists level, job titles and the seven metric points', /Job titles at this level/.test(fold) && /WEIGHT_DEFS\.map\(function\(d\) \{ return '<th>' \+ esc\(d\.label\)/.test(fold));
ck('a level point that differs from the role row is highlighted', /diff \? ' sw-diff'/.test(fold));
ck('the fold offers level inputs to editors only, each with a total and a "follow role" reset',
   /editable\s*\?\s*'<input type="number" class="sw-rate sw-rate-sm'/.test(fold) && /data-lvl="' \+ esc\(l\.key\) \+ '"/.test(fold) &&
   /if \(editable\) html \+= '<td><span class="sw-tot" id="swTot-' \+ i \+ '-' \+ esc\(l\.key\)/.test(fold) && /swFollowRole_\(/.test(fold));
ck('"How a score is built" is folded and definition-free', /<details class="sw-how"/.test(fnBody(html, 'renderHowItWorks_')) &&
   !/Hours logged vs/.test(fnBody(html, 'renderHowItWorks_')));
ck('an expand-all / collapse-all control exists', /id="swAllBtn" onclick="swToggleAll_\(\)"/.test(summary));
// Org-scoped callers: the same table, narrowed to their own roles and levels, read-only.
ck('the scoped view keys off the server scope stamp, not a role string',
   /var scoped = !!\(DATA && DATA\.managerScopeName\);/.test(summary));
ck('the scoped view is editable only through the same team test (an org admin tunes their own team)',
   !/var editable = !scoped && /.test(summary));
ck('both views share the one table', /if \(scoped\) rows = buildScopedRows_\(teamCfg, rows\);/.test(summary));
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
  const svcOnly = B.buildRoleRows_(Object.assign({}, cfg, { sections: cfg.sections.filter(s => s.team.key === 'services') }));
  eq('one team at a time: the Services group lists Services roles only, each writing one block',
     svcOnly.map(r => r.name + ' targets=' + r.targets.map(t => t.team).join(',')), ['Service Delivery targets=services', 'Operations targets=services']);
  const rndOnly = B.buildRoleRows_(Object.assign({}, cfg, { sections: cfg.sections.filter(s => s.team.key === 'rnd') }));
  eq('…and the R&D group lists R&D roles only', rndOnly.map(r => r.name + ' targets=' + r.targets.map(t => t.team).join(',')), ['Operations targets=rnd']);
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
ck('a team switch re-renders from the config already loaded; a save forces a refetch',
   /if \(!force && MATRIX_CFG && MATRIX_CFG\.ok\) \{ renderScoringSummary_\(\); return; \}/.test(load) &&
   /loadScoringMatrix_\(true\);/.test(savePage));
ck('the summary renders for every caller', /MATRIX_CFG = cfg;\s*renderScoringSummary_\(\);/.test(load));

console.log(fail === 0
  ? `✅ scoring-weights-view-checks: ${pass} checks passed`
  : `❌ scoring-weights-view-checks: ${fail} failed, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
