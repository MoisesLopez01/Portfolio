# Team-Aligned Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the scoring pipeline to the org team toggle — each team (Services / R&D / Sales & Success) scores only on its own metric set, with the `PS Scoring Matrix` sheet and editor grouped per team.

**Architecture:** "Team gates, family tunes": the employee's resolved team (`emp.team`, tagged from `TEAMS_` in `PS Teams.js`) hard-masks which metrics can carry weight and picks the blank-cell fill defaults; the family × level matrix cell tunes within that. The sheet gains a `Team` column (per-(team, family) blocks); a legacy sheet is mapped on read so scoring is correct before any admin opens the editor.

**Tech Stack:** Google Apps Script (V8), vanilla-JS HtmlService frontend, Node for the `_test_*` eval harnesses.

**Spec:** `docs/superpowers/specs/2026-07-09-team-aligned-scoring-design.md`

**⚠️ Concurrency note:** Another session may be working in this repo (see memory: *Check for Concurrent Executor*). Every task below anchors edits on **code snippets, not line numbers**. Before each Edit, Grep for the anchor; if an edit fails "modified since read", re-Read the region and apply only the delta.

**Test harness convention:** the repo's tests are `_test_*` functions runnable in Node by eval-ing both GAS files with a stubbed `Logger`. The canonical run command (from repo root, works in Git Bash and PowerShell):

```bash
node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_weightsResolver(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
```

Exit code 0 = all PASS. Swap the function name to run a different suite.

---

### Task 1: Rewrite `_test_weightsResolver()` for the team-shaped matrix (failing first)

**Files:**
- Modify: `PS Contribution Report.js` — replace the entire `function _test_weightsResolver() { … }` body (anchor: `// Manual test harness for the resolver`)

The new matrix shape is `{ [teamKey]: { [family|"ALL"]: { [levelKey|"ALL"]: { metric: weight } } } }`. The old flat-shape cases are all superseded.

- [ ] **Step 1: Replace `_test_weightsResolver` with the team-first suite**

Replace the whole existing function (from `// Manual test harness for the resolver (run from the GAS editor; logs PASS/FAIL).` through its closing `}` — currently ending with `return results;`) with:

```js
// Manual test harness for the resolver (GAS editor or Node; logs PASS/FAIL).
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_weightsResolver(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_weightsResolver() {
  const base = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };
  const catalog = new Map([
    [normPS_("Senior Consultant I, Technical Consulting"), { family: "JF009", track: "I", level: 4, levelKey: "I4" }],
    [normPS_("Associate, Solution Architecture"),          { family: "JF018", track: "I", level: 2, levelKey: "I2" }],
    [normPS_("Representative, Account Management"),        { family: "JF004", track: "I", level: 3, levelKey: "I3" }],
    [normPS_("Intern, Finance"),                           { family: "JF013", track: "I", level: 1, levelKey: "I1" }],
  ]);
  const RND_W   = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const svc = (title, extra) => Object.assign({ name: "x", jobTitle: title, team: "services" }, extra || {});

  // 1. Services native, partial cell: explicit values win, blanks inherit the flat base
  const mx1 = { services: { JF009: { I4: { goals: 40, tracked: 20 } } } };
  check("svc-native-cell+inherit",
    weightsForEmployee_(svc("Senior Consultant I,  TECHNICAL consulting"), mx1, catalog, base),
    { goals: 40, tracked: 20, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });

  // 2. Services native, no cell → the base object BY REFERENCE (attach optimization)
  check("svc-native-inherit-is-base-ref",
    weightsForEmployee_(svc("Associate, Solution Architecture"), mx1, catalog, base) === base, true);

  // 3. Family ALL cell applies to every level; a specific level cell beats it
  check("family-all-cell",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting"),
      { services: { JF009: { ALL: { goals: 50, kudos: 10 } } } }, catalog, base),
    { goals: 50, tracked: 30, planned: 20, rcr: 15, kudos: 10, si: 0, pto: 0 });
  check("level-beats-family-all",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting"),
      { services: { JF009: { ALL: { goals: 50, kudos: 10 }, I4: { goals: 44 } } } }, catalog, base),
    { goals: 44, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });

  // 4. Embedded ops family under Services → policy fill; a partial cell can never
  //    re-enable tracked/planned/RCR (fills from the policy, not the base)
  check("svc-embedded-ops-policy",
    weightsForEmployee_(svc("Intern, Finance"), {}, catalog, base), RND_W);
  check("svc-embedded-ops-cell-fills-from-policy",
    weightsForEmployee_(svc("Intern, Finance"),
      { services: { JF013: { I1: { goals: 70, kudos: 30, si: 0, pto: 0 } } } }, catalog, base),
    { goals: 70, tracked: 0, planned: 0, rcr: 0, kudos: 30, si: 0, pto: 0 });

  // 5. JF004: a Services-team member blank-inherits the flat base (today's behavior);
  //    a Sales-team member fills from SALES_DEFAULT_W_
  check("jf004-in-services-inherits-base",
    weightsForEmployee_(svc("Representative, Account Management"), {}, catalog, base) === base, true);
  check("jf004-in-sales-defaults",
    weightsForEmployee_({ name: "s", jobTitle: "Representative, Account Management", team: "sales" }, {}, catalog, base),
    RND_W); // SALES_DEFAULT_W_ is seeded with the same values

  // 6. Split family: independent (services, JF013) and (rnd, JF013) cells
  const mx6 = { services: { JF013: { I1: { goals: 70, kudos: 30, si: 0, pto: 0 } } },
                rnd:      { JF013: { I1: { goals: 55, kudos: 15, si: 15, pto: 15 } } } };
  check("split-family-services-cell", weightsForEmployee_(svc("Intern, Finance"), mx6, catalog, base),
    { goals: 70, tracked: 0, planned: 0, rcr: 0, kudos: 30, si: 0, pto: 0 });
  check("split-family-rnd-cell",
    weightsForEmployee_({ name: "r", jobTitle: "Intern, Finance", team: "rnd" }, mx6, catalog, base),
    { goals: 55, tracked: 0, planned: 0, rcr: 0, kudos: 15, si: 15, pto: 15 });

  // 7. Hard mask: tracked weight hand-set on an (rnd, family) row → zeroed
  check("mask-zeroes-out-of-set-metric",
    weightsForEmployee_({ name: "r2", jobTitle: "Intern, Finance", team: "rnd" },
      { rnd: { JF013: { I1: { goals: 60, tracked: 40 } } } }, catalog, base),
    { goals: 60, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 });

  // 8. Uncatalogued per team → team catch-all (ALL/ALL) → team defaults;
  //    audit fires only for Services-team titles
  const audit = [];
  check("uncat-services-no-block",
    weightsForEmployee_(svc("Wizard, Hogwarts"), { services: {} }, catalog, base, audit) === base, true);
  check("uncat-services-audited", audit.length === 1 && audit[0].reason === "unmapped-title", true);
  check("uncat-services-catchall",
    weightsForEmployee_(svc("Wizard, Hogwarts"), { services: { ALL: { ALL: { goals: 50, kudos: 10 } } } }, catalog, base),
    { goals: 50, tracked: 30, planned: 20, rcr: 15, kudos: 10, si: 0, pto: 0 });
  const audit2 = [];
  check("uncat-rnd-defaults",
    weightsForEmployee_({ name: "u", jobTitle: "Totally Unknown", team: "rnd" }, {}, catalog, base, audit2), RND_W);
  check("uncat-rnd-catchall-fills-policy",
    weightsForEmployee_({ name: "u2", jobTitle: "Totally Unknown", team: "rnd" },
      { rnd: { ALL: { ALL: { goals: 60 } } } }, catalog, base, audit2),
    { goals: 60, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 });
  check("uncat-nonservices-not-audited", audit2.length, 0);
  check("uncat-sales-defaults",
    weightsForEmployee_({ name: "u3", jobTitle: "Mystery Seller", team: "sales" }, {}, catalog, base), RND_W);

  // 9. Legacy fallbacks: no team + non-Services dept → rnd path; neither → services
  check("legacy-dept-fallback-rnd",
    weightsForEmployee_({ name: "l", jobTitle: "Totally Unknown", dept: "Engineering" }, {}, catalog, base), RND_W);
  check("legacy-no-team-no-dept-services",
    weightsForEmployee_({ name: "l2", jobTitle: "Wizard, Hogwarts" }, {}, catalog, base) === base, true);

  // 10. Code-prefixed title self-describes (13 → JF013 → embedded-ops policy under services)
  check("code-prefix-selfdescribes",
    weightsForEmployee_(svc("13.M10.10 - Mystery Title"), {}, catalog, base), RND_W);

  // 11. Empty catalog → base, no audit noise
  const audit3 = [];
  weightsForEmployee_({ name: "e", jobTitle: "Anything", team: "services" }, {}, new Map(), base, audit3);
  check("empty-catalog-no-audit", audit3.length, 0);

  // 12. roleGroupFor_ / parseJobCode_ edges (unchanged)
  check("jf007-default-bucket", roleGroupFor_("JF007", "Intern, Managed Services"), "Customer Support");
  check("jf007-delivery",       roleGroupFor_("JF007", "Senior Consultant I, Delivery"), "Delivery");
  check("jf009-tc",             roleGroupFor_("JF009", "Principal, Solution Consulting"), "Technical Consulting");
  check("jf016-people",         roleGroupFor_("JF016", "Senior Manager, Total Rewards and HR Operations"), "People");
  check("parse-code",           parseJobCode_("13.M10.10"), { family: "JF013", track: "M", level: 10, levelKey: "M10" });

  Logger.log(results.join("\n"));
  return results;
}
```

- [ ] **Step 2: Run the suite and verify it FAILS**

Run the canonical command (top of this plan). Expected: exit code 1 with many `FAIL` lines — the resolver still speaks the flat matrix shape. If it exits 0, the test wasn't replaced correctly.

- [ ] **Step 3: Commit the red test**

```bash
git add "PS Contribution Report.js"
git commit -m "test(scoring): rewrite weights-resolver suite for team-shaped matrix (red)"
```

---

### Task 2: Team-gated resolver — constants, `blockFillBase_`, `maskToTeamMetrics_`, `weightsForEmployee_` v2

**Files:**
- Modify: `PS Contribution Report.js` — the contributor-model constants block (anchor: `// Contributor model (2026-07-07 decision):`) and `weightsForEmployee_` (anchor: `function weightsForEmployee_(emp, matrix, catalog, base, audit) {`)

- [ ] **Step 1: Replace the contributor-model constants block**

Replace everything from the comment `// Contributor model (2026-07-07 decision):` down to and including `const NONCONTRIB_DEFAULT_W_ = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };` with:

```js
// Contributor model (2026-07-09 team alignment):
// scoring groups follow the org team toggle (TEAMS_ in PS Teams.js). The employee's
// resolved team decides which metrics can carry weight (hard mask) and which
// fill-defaults blank cells inherit; the family × level matrix cell tunes within that.
// Spec: docs/superpowers/specs/2026-07-09-team-aligned-scoring-design.md
const PS_TEAM_FAMILIES_ = ["JF007", "JF008", "JF009", "JF018"];
const COE_FAMILY_CODE_  = "JF004"; // Sales & Success family (also drives teamForProfile_)
// "ALL" doubles as the per-team uncatalogued catch-all family code AND the
// block-wide level column now valid on any family block (a level cell beats it).
const ALL_KEY_ = "ALL";
// R&D team defaults — also the policy fill for operational families embedded in
// the Services team (Finance, People, Ops, IT, …): a reset must never re-enable
// tracked/planned/RCR for roles with no time data.
const RND_DEFAULT_W_   = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
// Sales & Success defaults — own constant so the HubSpot phase can re-weight it
// without touching R&D. Seeded with the same values on purpose.
const SALES_DEFAULT_W_ = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
// Pre-Team-column sheet-schema codes; only migrateLegacyMatrix_ still knows them.
const LEGACY_SERVICES_CODE_   = "SERVICES";
const LEGACY_NONCONTRIB_CODE_ = "NONCONTRIB";
```

This **removes** `SERVICES_TEAM_CODE_`, `SERVICES_TEAM_KEY_`, `familyCategory_()`, `NONCONTRIB_CODE_`, and `NONCONTRIB_DEFAULT_W_`. Their remaining call sites (`seedScoringMatrix_`, `getScoringConfig`, `saveScoringMatrix`) break until Tasks 4–5 — that's expected; the Node tests don't touch them. Also delete the now-stale comment block above the old constants (`// Services Team catch-all: the roster is already filtered …` through `const SERVICES_TEAM_KEY_  = "ALL";`).

- [ ] **Step 2: Replace `weightsForEmployee_` and add the two helpers**

Replace the whole `weightsForEmployee_` function (from its preceding comment `// Resolves one employee's scoring weights (spec §6.1). Pure given its inputs.` through the closing `}` after `return fillWeights_(cell, W);`) with:

```js
// Fill base for blank cells of a (team, family) block — the single place the
// per-team defaults rule lives (spec §2). `family` may be ALL_KEY_ (catch-all)
// or null (uncatalogued title, before the catch-all is consulted).
function blockFillBase_(teamKey, family, base) {
  if (teamKey === "rnd")   return RND_DEFAULT_W_;
  if (teamKey === "sales") return SALES_DEFAULT_W_;
  // Services: native PS families, JF004, and the catch-all inherit the flat base;
  // embedded operational families keep the non-contributor policy.
  if (family === null || family === ALL_KEY_ ||
      PS_TEAM_FAMILIES_.indexOf(family) !== -1 || family === COE_FAMILY_CODE_) return base;
  return RND_DEFAULT_W_;
}

// Hard gate (spec §3): zero any weight on a metric outside the team's set. Returns
// the input object untouched when nothing needs zeroing, so the base-reference
// attach optimization in computePSReport_ survives.
function maskToTeamMetrics_(w, metrics) {
  let dirty = false;
  for (let i = 0; i < WEIGHT_METRICS_.length; i++) {
    const k = WEIGHT_METRICS_[i];
    if (metrics.indexOf(k) === -1 && (w[k] || 0) !== 0) { dirty = true; break; }
  }
  if (!dirty) return w;
  const o = {};
  WEIGHT_METRICS_.forEach(k => { o[k] = metrics.indexOf(k) === -1 ? 0 : (w[k] || 0); });
  return o;
}

// Resolves one employee's scoring weights (team gates, family tunes — spec §3).
// Pure given its inputs. matrix shape:
//   { [teamKey]: { [family|ALL]: { [levelKey|ALL]: { metric: weight } } } }
// `base` = flat company base weights (readWeightSettings_ result).
// `audit` (optional array) collects { name, jobTitle, reason } for Services misses.
function weightsForEmployee_(emp, matrix, catalog, base, audit) {
  const W = base || DEFAULT_WEIGHTS_;
  // Resolved team drives everything; the dept comparison remains as a legacy
  // fallback for callers that predate team tagging. Missing both → Services.
  const dept = (emp.dept || "").trim();
  const teamKey = emp.team || ((dept && dept !== CONFIG_PS.PS_DEPT) ? "rnd" : "services");
  const metrics = teamByKey_(teamKey).metrics;
  const teamMx  = matrix[teamKey] || {};
  // Sheet lookup (code-prefix-insensitive), then the title's own embedded job
  // code as fallback — a prefixed title is self-describing even uncatalogued.
  const hit = catalog.get(normTitleKey_(emp.jobTitle || "")) || titleCodeInfo_(emp.jobTitle);
  if (!hit) {
    // Uncatalogued: Services titles are audit-worthy (the catch-all is a stopgap);
    // R&D / Sales uncatalogued titles are expected and route silently.
    if (teamKey === "services" && audit && catalog.size > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", reason: "unmapped-title" });
    }
    const ca   = (teamMx[ALL_KEY_] || {})[ALL_KEY_];
    const fill = blockFillBase_(teamKey, null, W);
    return maskToTeamMetrics_(ca ? fillWeights_(ca, fill) : fill, metrics);
  }
  const block = teamMx[hit.family] || {};
  const cell  = block[hit.levelKey] || block[ALL_KEY_] || null;
  const fill  = blockFillBase_(teamKey, hit.family, W);
  if (!cell) {
    // Audit only Services natives (as before): embedded ops and JF004 inherit
    // their fill silently, matching the pre-team behavior.
    if (teamKey === "services" && PS_TEAM_FAMILIES_.indexOf(hit.family) !== -1 &&
        audit && Object.keys(matrix).length > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", family: hit.family,
        levelKey: hit.levelKey, reason: teamMx[hit.family] ? "level-missing" : "family-missing" });
    }
    return maskToTeamMetrics_(fill, metrics);
  }
  return maskToTeamMetrics_(fillWeights_(cell, fill), metrics);
}
```

- [ ] **Step 3: Run the resolver suite — expect all PASS**

Run the canonical command. Expected: exit 0, output all `PASS`. Also run the untouched suites to prove no collateral damage:

```bash
node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); process.exit(_test_teamForProfile()?0:1)"
node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8')); _test_sheetMemo();"
```

Note: `weightsForEmployee_` now calls `teamByKey_` (defined in `PS Teams.js`), which is why both files are always eval'd together.

- [ ] **Step 4: Grep for orphaned references**

```bash
grep -n "NONCONTRIB_DEFAULT_W_\|SERVICES_TEAM_CODE_\|SERVICES_TEAM_KEY_\|familyCategory_\|NONCONTRIB_CODE_" "PS Contribution Report.js"
```

Expected remaining hits ONLY inside `seedScoringMatrix_`, `getScoringConfig`, and `saveScoringMatrix` (fixed in Tasks 4–5). If any appear elsewhere (e.g. `computePSReport_` comments), update them now.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(scoring): team-gated weight resolution — team gates, family tunes"
```

---

### Task 3: Dual-schema matrix reader + legacy migration (`parseScoringMatrix_`, `migrateLegacyMatrix_`)

**Files:**
- Modify: `PS Contribution Report.js` — `readScoringMatrix_` (anchor: `// Reads the scoring matrix sheet →`), plus a new `_test_matrixMigration()` right after the rewritten `_test_weightsResolver()`

- [ ] **Step 1: Write the failing migration test**

Insert after the closing `}` of `_test_weightsResolver()`:

```js
// Node test for the dual-schema matrix parser + legacy mapping (no GAS APIs).
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_matrixMigration(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_matrixMigration() {
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };

  // Legacy schema (no Team column) → mapped on read per spec §4
  const legacy = [
    ["Family", "Metric", "I1", "I4", "ALL"],
    ["JF009", "goals", "", 40, ""],       // native PS family → services only
    ["JF004", "goals", "", "", 50],       // COE ALL cell → sales AND services
    ["JF013", "goals", 70, "", ""],       // embedded ops → services AND rnd
    ["SERVICES", "goals", "", "", 55],    // legacy services catch-all → (services, ALL)
    ["NONCONTRIB", "goals", "", "", 60],  // legacy noncontrib → (rnd, ALL)
    ["DEFAULT", "goals", "", "", 99],     // retired block → dropped
    ["JF009", "bogus", "", 1, ""],        // unknown metric row → ignored
  ];
  const m = parseScoringMatrix_(legacy);
  check("legacy-ps-family", m.services.JF009, { I4: { goals: 40 } });
  check("legacy-ps-family-not-rnd", (m.rnd || {}).JF009 === undefined, true);
  check("legacy-coe-both-teams", [m.sales.JF004, m.services.JF004],
    [{ ALL: { goals: 50 } }, { ALL: { goals: 50 } }]);
  check("legacy-embedded-both-teams", [m.services.JF013, m.rnd.JF013],
    [{ I1: { goals: 70 } }, { I1: { goals: 70 } }]);
  check("legacy-services-catchall", m.services.ALL, { ALL: { goals: 55 } });
  check("legacy-noncontrib-catchall", m.rnd.ALL, { ALL: { goals: 60 } });
  check("legacy-default-dropped", JSON.stringify(m).indexOf("99") === -1, true);
  m.sales.JF004.ALL.goals = 51; // mutate one copy…
  check("legacy-copies-dont-alias", m.services.JF004.ALL.goals, 50);

  // New schema (Team column) → nested directly; unknown team rows ignored
  const fresh = [
    ["Team", "Family", "Metric", "I1", "ALL"],
    ["services", "JF009", "goals", 45, ""],
    ["rnd", "JF013", "si", 25, ""],
    ["sales", "ALL", "goals", "", 65],
    ["marketing", "JF001", "goals", 10, ""], // unknown team → ignored (⚠️ log)
    ["services", "JF009", "goals", "", ""],  // all-blank row → adds no cells
  ];
  const n = parseScoringMatrix_(fresh);
  check("new-services-cell", n.services.JF009, { I1: { goals: 45 } });
  check("new-rnd-cell", n.rnd.JF013, { I1: { si: 25 } });
  check("new-sales-catchall", n.sales.ALL, { ALL: { goals: 65 } });
  check("new-unknown-team-ignored", n.marketing === undefined, true);

  Logger.log(results.join("\n"));
  return results;
}
```

- [ ] **Step 2: Run it — expect FAIL** (`parseScoringMatrix_ is not defined`). Exit code 1.

- [ ] **Step 3: Replace `readScoringMatrix_` with the reader trio**

Replace the whole existing `readScoringMatrix_` (from its comment `// Reads the scoring matrix sheet → { [family|"DEFAULT"]: …` through the closing `}` after the `catch`) with:

```js
// Reads the scoring matrix sheet →
//   { [teamKey]: { [family|ALL]: { [levelKey|ALL]: { metric: weight } } } }.
// Blank cells are omitted (→ inherit blockFillBase_). Missing sheet → {}.
function readScoringMatrix_() {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh || sh.getLastRow() < 2) return {};
    return parseScoringMatrix_(sh.getDataRange().getValues());
  } catch(e) { Logger.log(`⚠️ readScoringMatrix_: ${e.message}`); return {}; }
}

// Pure (Node-testable). Detects the schema by the Team header: new sheets nest by
// team; a legacy sheet (pre-Team-column) is parsed flat then mapped on read via
// migrateLegacyMatrix_, so scoring is correct before any admin opens the editor.
function parseScoringMatrix_(data) {
  const hdrs  = data[0].map(h => String(h).trim());
  const iTeam = hdrs.findIndex(h => h.toLowerCase() === "team");
  const iFam  = hdrs.findIndex(h => h.toLowerCase() === "family");
  const iMet  = hdrs.findIndex(h => h.toLowerCase() === "metric");
  if (iFam === -1 || iMet === -1) return {};
  const levelCols = [];
  hdrs.forEach((h, i) => { if (/^([IM]\d+|ALL)$/i.test(h)) levelCols.push({ idx: i, key: h.toUpperCase() }); });
  const known = {};
  TEAMS_.forEach(t => { known[t.key] = true; });
  const out = {}, flat = {};
  data.slice(1).forEach(r => {
    const fam = String(r[iFam] || "").trim().toUpperCase();
    const met = String(r[iMet] || "").trim().toLowerCase();
    if (!fam || WEIGHT_METRICS_.indexOf(met) === -1) return;
    let block;
    if (iTeam !== -1) {
      const team = String(r[iTeam] || "").trim().toLowerCase();
      if (!known[team]) {
        if (team) Logger.log(`⚠️ PS Scoring Matrix: unknown team "${team}" — row ignored`);
        return;
      }
      if (!out[team])      out[team] = {};
      if (!out[team][fam]) out[team][fam] = {};
      block = out[team][fam];
    } else {
      if (!flat[fam]) flat[fam] = {};
      block = flat[fam];
    }
    levelCols.forEach(c => {
      const raw = r[c.idx];
      if (raw === "" || raw === null || raw === undefined) return; // blank → inherit
      const v = parseFloat(raw);
      if (isNaN(v) || v < 0) return;
      if (!block[c.key]) block[c.key] = {};
      block[c.key][met] = v;
    });
  });
  return iTeam !== -1 ? out : migrateLegacyMatrix_(flat);
}

// Maps a legacy (pre-Team-column) flat matrix into the team-nested shape (spec §4).
// Legacy family×level cells applied company-wide, so non-PS families are copied to
// BOTH teams their members can sit in. Blocks are deep-copied so copies never alias.
function migrateLegacyMatrix_(flat) {
  const out = {};
  const put = (team, fam, block) => {
    if (!out[team]) out[team] = {};
    out[team][fam] = JSON.parse(JSON.stringify(block));
  };
  Object.keys(flat).forEach(fam => {
    if (fam === "DEFAULT") return; // retired block — company default is the flat base
    if (fam === LEGACY_SERVICES_CODE_) { put("services", ALL_KEY_, flat[fam]); return; }
    if (fam === LEGACY_NONCONTRIB_CODE_) {
      put("rnd", ALL_KEY_, flat[fam]);
      // Known simplification: catalogued embedded-ops members under Services now
      // fill from the policy defaults instead of this block — retune per family
      // under Services if this block carried overrides.
      Logger.log("ℹ️ Legacy NONCONTRIB/ALL mapped to the R&D catch-all only.");
      return;
    }
    if (PS_TEAM_FAMILIES_.indexOf(fam) !== -1) { put("services", fam, flat[fam]); return; }
    if (fam === COE_FAMILY_CODE_) { put("sales", fam, flat[fam]); put("services", fam, flat[fam]); return; }
    put("services", fam, flat[fam]); put("rnd", fam, flat[fam]);
  });
  return out;
}
```

- [ ] **Step 4: Run both suites — expect all PASS**

Run `_test_matrixMigration` (command in its comment) and re-run `_test_weightsResolver`. Both exit 0.

- [ ] **Step 5: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(scoring): dual-schema matrix reader — Team column + legacy mapping on read"
```

---

### Task 4: Team-schema seed + merge-save (`seedScoringMatrix_`, `saveScoringMatrix`)

**Files:**
- Modify: `PS Contribution Report.js` — `seedScoringMatrix_` (anchor: `function seedScoringMatrix_(`) and `saveScoringMatrix` (anchor: `function saveScoringMatrix(payload) {`)

These touch `SpreadsheetApp` — no Node tests; correctness is covered by the pure parser tests (Task 3) plus manual QA (Task 7). Keep the code exactly as below.

- [ ] **Step 1: Replace `seedScoringMatrix_`**

Replace the whole function and its comment (from `// Seeds the scoring matrix with the per-family row structure but BLANK cells.` through its closing `}`) with:

```js
// Seeds the scoring matrix with the per-(team, family) row structure but BLANK
// cells. Blanks inherit blockFillBase_ (flat base for Services natives / JF004 /
// catch-alls; policy defaults for embedded ops and the R&D / Sales teams), so a
// freshly-seeded deployment scores exactly as the resolver defaults and every
// block reads as "Inheriting" until an admin enters an explicit override.
// `famsByTeam` = { teamKey: [familyCode, …] } from the tagged roster (getScoringConfig).
function seedScoringMatrix_(famsByTeam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
  if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
  sh.clearContents();
  const cols   = LEVEL_COLS_.concat([ALL_KEY_]);
  const header = ["Team", "Family", "Metric"].concat(cols);
  const rows   = [header];
  TEAMS_.forEach(t => {
    const mets = WEIGHT_METRICS_.filter(m => t.metrics.indexOf(m) !== -1);
    ((famsByTeam || {})[t.key] || []).concat([ALL_KEY_]).forEach(fam => {
      mets.forEach(met => rows.push([t.key, fam, met].concat(cols.map(() => ""))));
    });
  });
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  const savedAt = new Date().toISOString();
  sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
  SpreadsheetApp.flush();
  Logger.log(`Scoring matrix seeded: ${rows.length - 1} rows across ${TEAMS_.length} team sections.`);
  return { rows: rows.length - 1, savedAt };
}
```

- [ ] **Step 2: Replace `saveScoringMatrix`**

Replace the whole function (from `// Exported — writes the full matrix back from the editor and busts the report cache.` through its closing `}` after the `catch` block) with:

```js
// Exported — merges the editor payload over the stored matrix and rewrites the
// sheet in the Team-column schema, then busts the report cache.
// Merge semantics (spec §4): a (team, family) block present in the payload fully
// replaces the stored block (cell deletions stick); blocks the editor didn't
// render — family currently has no active members in that team — survive.
function saveScoringMatrix(payload) {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed || access.role !== "admin") return { ok: false, error: "Admin access required" };
    const incoming = payload && payload.matrix;
    if (!incoming || typeof incoming !== "object") return { ok: false, error: "Invalid payload" };

    const validFam = {};
    ACTIVE_FAMILIES_.forEach(f => { validFam[f.code] = true; });
    validFam[ALL_KEY_] = true;
    const validCol = {};
    LEVEL_COLS_.concat([ALL_KEY_]).forEach(lk => { validCol[lk] = true; });

    const merged = readScoringMatrix_();
    let dropped = 0;
    TEAMS_.forEach(t => {
      const inTeam = incoming[t.key];
      if (!inTeam || typeof inTeam !== "object") return;
      if (!merged[t.key]) merged[t.key] = {};
      Object.keys(inTeam).forEach(fam => {
        if (!validFam[fam]) return;
        const block = {};
        Object.keys(inTeam[fam] || {}).forEach(lk => {
          if (!validCol[lk]) return;
          Object.keys(inTeam[fam][lk] || {}).forEach(met => {
            if (WEIGHT_METRICS_.indexOf(met) === -1) return;
            if (t.metrics.indexOf(met) === -1) { dropped++; return; } // outside the team's set
            const v = parseFloat(inTeam[fam][lk][met]);
            if (isNaN(v)) return;
            if (!block[lk]) block[lk] = {};
            block[lk][met] = Math.max(0, Math.min(100, v));
          });
        });
        merged[t.key][fam] = block; // full replace — an emptied block clears the stored one
      });
    });
    if (dropped > 0) Logger.log(`⚠️ saveScoringMatrix: dropped ${dropped} weight(s) on metrics outside their team's metric set`);

    // Rewrite the sheet: TEAMS_ order; families in ACTIVE_FAMILIES_ order with the
    // catch-all last; only the team's metric rows.
    const famIdx = {};
    ACTIVE_FAMILIES_.forEach((f, i) => { famIdx[f.code] = i; });
    const cols   = LEVEL_COLS_.concat([ALL_KEY_]);
    const header = ["Team", "Family", "Metric"].concat(cols);
    const rows   = [header];
    TEAMS_.forEach(t => {
      const teamMx = merged[t.key] || {};
      const mets   = WEIGHT_METRICS_.filter(m => t.metrics.indexOf(m) !== -1);
      const fams   = Object.keys(teamMx).sort((a, b) => {
        if (a === ALL_KEY_) return 1;
        if (b === ALL_KEY_) return -1;
        return (famIdx[a] || 0) - (famIdx[b] || 0);
      });
      fams.forEach(fam => {
        mets.forEach(met => {
          const row = [t.key, fam, met];
          cols.forEach(lk => {
            const cell = teamMx[fam][lk];
            const raw  = cell ? cell[met] : undefined;
            row.push(raw === undefined || raw === null ? "" : raw);
          });
          rows.push(row);
        });
      });
    });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
    sh.clearContents();
    sh.getRange(1, 1, rows.length, header.length).setValues(rows);
    const savedAt = new Date().toISOString();
    sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
    SpreadsheetApp.flush();
    bustReportCache_(); // invalidate every cached scope (admin + manager) so scores refresh now
    return { ok: true, savedAt };
  } catch(e) {
    Logger.log(`❌ saveScoringMatrix: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 3: Re-run all Node suites** (`_test_weightsResolver`, `_test_matrixMigration`, `_test_teamForProfile`, `_test_sheetMemo`) — all must still pass (this task adds no new pure logic, but the eval catches syntax errors).

- [ ] **Step 4: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(scoring): team-schema matrix seed + merge-save with per-team metric validation"
```

---

### Task 5: `getScoringConfig` — team sections payload

**Files:**
- Modify: `PS Contribution Report.js` — `getScoringConfig` (anchor: `function getScoringConfig() {`)

- [ ] **Step 1: Replace `getScoringConfig`**

Replace the whole function (from `// Exported — full config for the Settings-tab matrix editor (Admin only).` through its closing `}` after the `catch`) with:

```js
// Exported — full config for the Settings-tab matrix editor (Admin only).
// Groups families under the org-team sections (spec §5): placement is driven by
// where active roster members sit, so a family spanning two teams appears under
// both. Seeds both sheets on first open so the feature bootstraps itself.
function getScoringConfig() {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed || access.role !== "admin") return { ok: false, denied: true };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let seeded = false;
    if (!ss.getSheetByName(JOB_CATALOG_SHEET_)) { seedJobCatalog_(); seeded = true; }

    const catalog = readJobCatalog_();

    // Tag the company-wide roster with teams (same rule as getPSReportData) and
    // count active non-crew members per (team, family) + uncatalogued per team.
    const roster = readPSRoster_();
    roster.forEach(p => { p.team = teamForProfile_(p, catalog); });
    const famCounts = {};   // { teamKey: { famCode: n } }
    const uncat     = {};   // { teamKey: n }
    const unmapped  = {};   // Services-team uncatalogued titles (audit list)
    roster.forEach(p => {
      if (p.isCrewMember) return;
      const hit = catalog.get(normTitleKey_(p.jobTitle)) || titleCodeInfo_(p.jobTitle);
      if (!hit) {
        uncat[p.team] = (uncat[p.team] || 0) + 1;
        if (p.team === "services") unmapped[p.jobTitle] = (unmapped[p.jobTitle] || 0) + 1;
        return;
      }
      if (!famCounts[p.team]) famCounts[p.team] = {};
      famCounts[p.team][hit.family] = (famCounts[p.team][hit.family] || 0) + 1;
    });

    if (!ss.getSheetByName(SCORING_MATRIX_SHEET_)) {
      const famsByTeam = {};
      TEAMS_.forEach(t => { famsByTeam[t.key] = Object.keys(famCounts[t.key] || {}); });
      seedScoringMatrix_(famsByTeam);
      seeded = true;
    }

    const matrix = readScoringMatrix_();
    const base   = readWeightSettings_();
    const famName = {}, famIdx = {};
    ACTIVE_FAMILIES_.forEach((f, i) => { famName[f.code] = f.name; famIdx[f.code] = i; });

    const sections = TEAMS_.map(t => ({
      team: { key: t.key, label: t.label, metrics: t.metrics },
      families: Object.keys(famCounts[t.key] || {})
        .sort((a, b) => (famIdx[a] || 0) - (famIdx[b] || 0))
        .map(c => ({ code: c, name: famName[c] || c, count: famCounts[t.key][c],
                     fill: blockFillBase_(t.key, c, base) })),
      catchAll: { count: uncat[t.key] || 0, fill: blockFillBase_(t.key, ALL_KEY_, base) },
    }));

    // Pre-create every rendered (team, family) block so the editor's save payload
    // replaces exactly the rendered blocks (merge semantics in saveScoringMatrix).
    sections.forEach(s => {
      if (!matrix[s.team.key]) matrix[s.team.key] = {};
      s.families.forEach(f => { if (!matrix[s.team.key][f.code]) matrix[s.team.key][f.code] = {}; });
      if (!matrix[s.team.key][ALL_KEY_]) matrix[s.team.key][ALL_KEY_] = {};
    });

    // Roles grouped per family/level for the editor's read-only reference rows.
    const rolesByFamily = {};
    catalog.forEach(e => {
      if (!rolesByFamily[e.family]) rolesByFamily[e.family] = { levels: {} };
      const fam = rolesByFamily[e.family];
      if (!fam.levels[e.levelKey]) fam.levels[e.levelKey] = [];
      fam.levels[e.levelKey].push({ title: e.title, group: e.group, code: e.code });
    });

    return {
      ok: true, seeded, matrix, sections, rolesByFamily,
      levelCols:   LEVEL_COLS_,
      metrics:     WEIGHT_METRICS_,
      baseWeights: base,
      unmappedTitles: Object.keys(unmapped).map(t => ({ jobTitle: t, count: unmapped[t] })),
    };
  } catch(e) {
    Logger.log(`❌ getScoringConfig: ${e.message}`);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 2: Verify no orphaned references remain**

```bash
grep -n "NONCONTRIB\|SERVICES_TEAM\|familyCategory_\|coeFamily\|nonContrib" "PS Contribution Report.js"
```

Expected hits: only `LEGACY_NONCONTRIB_CODE_` / `LEGACY_SERVICES_CODE_` (declaration + `migrateLegacyMatrix_`) and comment text. Nothing else.

- [ ] **Step 3: Re-run all Node suites** — all pass (syntax gate).

- [ ] **Step 4: Commit**

```bash
git add "PS Contribution Report.js"
git commit -m "feat(scoring): getScoringConfig serves team sections for the matrix editor"
```

---

### Task 6: Matrix editor — team separators, per-team blocks, team-keyed state

**Files:**
- Modify: `PS Dashboard.html` — the scoring-matrix editor region, from the comment `// ── SCORING MATRIX EDITOR — Family × Level weights (admin only) ──` down to the end of `saveMatrixToSheet_()` (the function right before `function populateSecuritySection_(s)`). `loadScoringMatrix_` is kept verbatim; everything else in the region is replaced.

- [ ] **Step 1: Replace the editor region**

Keep `var MATRIX_CFG = null;` and `loadScoringMatrix_()` as they are. Replace **all** of: `renderMatrixSection_`, `renderDefaultRef_`, `renderServicesBlock_`, `matrixEffectiveW_`, `singleColWeightsGrid_`, `renderCoeBlock_`, `renderNonContribBlock_`, `familyHasOverride_`, `matrixColSum_`, `renderFamilyBlock_`, `matrixCellInput_`, `updateMatrixSum_`, `updateFamilyBadge_`, `resetFamilyMatrix_`, `saveMatrixToSheet_` (keep `shortRole_` — unchanged) with:

```js
// Section lookup helpers — cfg.sections is ordered like the dashboard team toggle.
function matrixSection_(team) {
  var secs = (MATRIX_CFG && MATRIX_CFG.sections) || [];
  for (var i = 0; i < secs.length; i++) if (secs[i].team.key === team) return secs[i];
  return null;
}

// Fill defaults a (team, family) block inherits — shipped per family by the server
// (blockFillBase_), so the client never re-derives the policy rule.
function matrixFill_(team, fam) {
  var sec = matrixSection_(team);
  if (!sec) return {};
  if (fam !== 'ALL') {
    for (var i = 0; i < sec.families.length; i++) {
      if (sec.families[i].code === fam) return sec.families[i].fill || {};
    }
  }
  return (sec.catchAll && sec.catchAll.fill) || {};
}

function teamWeightDefs_(sec) {
  return WEIGHT_DEFS.filter(function(d) { return sec.team.metrics.indexOf(d.key) !== -1; });
}

function renderMatrixSection_() {
  var el = document.getElementById("matrixSection");
  if (!el) return;
  var cfg = MATRIX_CFG;
  if (!cfg || !cfg.ok) {
    el.innerHTML = '<div class="mx-err">Scoring matrix unavailable' +
      (cfg && cfg.error ? ': ' + esc(cfg.error) : '') + '</div>';
    return;
  }

  var html = '<div class="sec-header">⚖️ Scoring Weights by Team, Family &amp; Level</div>' +
    '<p class="sec-sub">Families are grouped under the <strong>org teams</strong> from the dashboard toggle, ' +
    'placed by where their active members sit — a family with members in two teams appears under both and is ' +
    'tuned independently. Each team scores only on its own metric set; blank cells inherit the placeholder ' +
    'weights shown. Each level column should total 100% (other totals are renormalized at scoring time).</p>';

  cfg.sections.forEach(function(sec) {
    html += renderTeamSeparator_(sec);
    if (sec.team.key === 'services') html += renderDefaultRef_(cfg);
    sec.families.forEach(function(f) {
      var fam = cfg.rolesByFamily[f.code];
      var levels = fam ? cfg.levelCols.filter(function(lk) { return fam.levels[lk]; }) : [];
      html += renderFamilyBlock_(sec, f, levels, fam);
    });
    html += renderTeamCatchAll_(sec);
  });

  html += '<div class="settings-actions" style="margin-top:14px">' +
    '<button class="settings-btn settings-btn-primary" id="saveMatrixBtn" onclick="saveMatrixToSheet_()">Save Scoring Matrix</button>' +
    '<span id="matrixSaveFlash" class="settings-save-flash" style="display:none">✓ Saved</span>' +
  '</div>' +
  '<div id="matrixSaveError" class="mx-err" style="display:none;margin-top:8px"></div>' +
  '<p class="settings-note">Weights are stored in the <strong>PS Scoring Matrix</strong> sheet (Team + Family rows); role mappings in <strong>Job Catalog</strong>. ' +
  'Both can also be edited directly in the spreadsheet. Changes apply on the next data refresh.</p>';

  el.innerHTML = html;
}

// Team separator — a visual group header; carries no weights of its own.
function renderTeamSeparator_(sec) {
  var n = (sec.catchAll && sec.catchAll.count) || 0;
  sec.families.forEach(function(f) { n += f.count || 0; });
  var chips = teamWeightDefs_(sec).map(function(d) {
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:' + d.color + '"></span>' + esc(d.label) + '</span>';
  }).join('<span style="color:var(--border)">·</span>');
  return '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:18px 0 6px;padding:8px 2px;border-bottom:2px solid var(--border)">' +
    '<span style="font-size:14px;font-weight:900;color:var(--void)">' + esc(sec.team.label) + '</span>' +
    '<span style="font-size:11px;font-weight:600;color:var(--muted)">' + sec.families.length + ' famil' +
      (sec.families.length !== 1 ? 'ies' : 'y') + ' · ' + n + ' rocketeer' + (n !== 1 ? 's' : '') + '</span>' +
    '<span style="display:inline-flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap">' + chips + '</span>' +
  '</div>';
}

// Read-only Services base panel — mirrors the flat base weights (the single source
// the Services-team natives inherit).
function renderDefaultRef_(cfg) {
  var bw = cfg.baseWeights || {};
  var chips = WEIGHT_DEFS.map(function(d) {
    var v = bw[d.key] || 0;
    return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:var(--void);' +
      'border:1px solid var(--border);border-radius:999px;padding:3px 10px">' +
      '<span style="width:8px;height:8px;border-radius:50%;background:' + d.color + '"></span>' +
      esc(d.label) + ' ' + v + '%</span>';
  }).join('');
  return '<div class="mx-default-ref">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
      '<span style="font-size:13px;font-weight:800;color:var(--void)">Services Base</span>' +
      '<span class="mx-badge mx-badge-default">Services families inherit this</span>' +
    '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px">' + chips + '</div>' +
    '<div style="font-size:11px;color:var(--muted);margin-top:8px">Edit these in <strong>Scoring Weights</strong> above. ' +
    'Operational families embedded in Services inherit their policy placeholders instead (tracked/planned/RCR stay 0).</div>' +
  '</div>';
}

// Effective weight after inheritance: level cell → family ALL cell → fill defaults.
function matrixEffectiveW_(team, fam, lk, met) {
  var block = ((MATRIX_CFG.matrix || {})[team] || {})[fam] || {};
  if (block[lk] && block[lk][met] !== undefined) return block[lk][met];
  if (lk !== 'ALL' && block.ALL && block.ALL[met] !== undefined) return block.ALL[met];
  return matrixFill_(team, fam)[met] || 0;
}

// A block is "custom" once it carries any explicit (non-blank) weight.
function familyHasOverride_(team, code) {
  var m = ((MATRIX_CFG.matrix || {})[team] || {})[code];
  if (!m) return false;
  for (var lk in m) {
    if (!m.hasOwnProperty(lk)) continue;
    for (var met in m[lk]) {
      if (m[lk].hasOwnProperty(met) && m[lk][met] !== undefined && m[lk][met] !== '') return true;
    }
  }
  return false;
}

function matrixColSum_(team, fam, lk) {
  var sec = matrixSection_(team);
  var mets = sec ? sec.team.metrics : MATRIX_CFG.metrics;
  var s = 0;
  mets.forEach(function(met) { s += +matrixEffectiveW_(team, fam, lk, met) || 0; });
  return Math.round(s * 10) / 10;
}

// One (team, family) block: read-only roles reference + editable weights grid over
// the family's catalog levels plus the block-wide ALL column.
function renderFamilyBlock_(sec, f, levels, famData) {
  var team = sec.team.key, code = f.code, name = f.name;
  var isCustom = familyHasOverride_(team, code);
  var cols = levels.concat(['ALL']);
  var defs = teamWeightDefs_(sec);
  var roleCount = 0, groupSet = {};
  levels.forEach(function(lk) {
    ((famData && famData.levels[lk]) || []).forEach(function(r) { roleCount++; groupSet[r.group || name] = true; });
  });
  var groups = Object.keys(groupSet);

  var thStyle = 'padding:5px 6px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);text-align:center;min-width:54px';
  function lvlCls(lk) { return lk.charAt(0) === 'I' ? 'mx-lvl-ic' : 'mx-lvl-mg'; }
  var badge = '<span class="mx-badge ' + (isCustom ? 'mx-badge-custom' : 'mx-badge-default') + '" id="mxbadge-' + team + '-' + code + '">' +
    (isCustom ? 'Custom' : 'Inheriting') + '</span>';

  var html = '<details style="margin:8px 0;border:1px solid var(--border);border-radius:10px;overflow:hidden">' +
    '<summary style="cursor:pointer;padding:10px 14px;background:var(--th-bg);display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:13px;font-weight:800;color:var(--void)">' + esc(name) + '</span>' + badge +
      '<span style="font-weight:600;color:var(--muted);font-size:11px">' + esc(code) + ' · ' + f.count + ' rocketeer' +
        (f.count !== 1 ? 's' : '') + ' · ' + roleCount + ' role' + (roleCount !== 1 ? 's' : '') + '</span>' +
    '</summary>' +
    '<div style="padding:6px 14px 12px;overflow-x:auto">';

  // Read-only roles reference, one row per role group
  if (groups.length) {
    html += '<table style="border-collapse:collapse;margin:6px 0 10px;width:max-content"><thead><tr>' +
      '<th style="' + thStyle + ';text-align:left;min-width:150px">Roles at each level</th>' +
      levels.map(function(lk) {
        return '<th class="' + lvlCls(lk) + '" style="' + thStyle + '">' + lk + '</th>';
      }).join('') + '</tr></thead><tbody>';
    groups.forEach(function(g) {
      html += '<tr><th style="padding:5px 6px;font-size:11px;font-weight:700;color:var(--slate);text-align:left;border-bottom:1px solid var(--border)">' + esc(g) + '</th>' +
        levels.map(function(lk) {
          var roles = ((famData && famData.levels[lk]) || []).filter(function(r) { return (r.group || name) === g; });
          return '<td style="padding:4px 6px;font-size:10px;color:var(--slate);border-bottom:1px solid var(--border);vertical-align:top;max-width:150px">' +
            roles.map(function(r) { return '<div title="' + esc(r.code + ' — ' + r.title) + '">' + esc(shortRole_(r.title)) + '</div>'; }).join('') +
          '</td>';
        }).join('') + '</tr>';
    });
    html += '</tbody></table>';
  }

  // Editable weights grid: team metric rows × (level columns + ALL)
  html += '<table style="border-collapse:collapse;width:max-content"><thead><tr>' +
    '<th style="' + thStyle + ';text-align:left;min-width:150px">Metric</th>' +
    cols.map(function(lk) {
      return '<th class="' + (lk === 'ALL' ? '' : lvlCls(lk)) + '" style="' + thStyle + '">' + lk + '</th>';
    }).join('') + '</tr></thead><tbody>';

  defs.forEach(function(d) {
    html += '<tr><th style="padding:4px 6px;font-size:11px;font-weight:700;color:var(--void);text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + d.color + ';margin-right:6px;vertical-align:1px"></span>' +
      esc(d.label) + '</th>' +
      cols.map(function(lk) { return matrixInputCell_(team, code, lk, d.key); }).join('') + '</tr>';
  });

  // Live per-column totals (soft warn ≠ 100%)
  html += '<tr><th style="padding:5px 6px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:right">Σ / level</th>' +
    cols.map(function(lk) {
      var t = matrixColSum_(team, code, lk);
      return '<td id="msum-' + team + '-' + code + '-' + lk + '" style="padding:4px 6px;font-size:11px;font-weight:800;text-align:center;color:' +
        (t === 100 ? '#00A86B' : '#D97706') + '">' + t + '%</td>';
    }).join('') + '</tr>';
  html += '</tbody></table>';

  html += '<button class="settings-btn settings-btn-secondary" style="margin-top:8px;font-size:11px;padding:4px 10px" ' +
    'onclick="resetFamilyMatrix_(\'' + team + '\',\'' + code + '\')">Reset — inherit defaults</button>';
  html += '</div></details>';
  return html;
}

// One editable weight input cell (shared by family blocks and catch-alls).
function matrixInputCell_(team, fam, lk, met) {
  var block = ((MATRIX_CFG.matrix || {})[team] || {})[fam] || {};
  var v = (block[lk] && block[lk][met] !== undefined) ? block[lk][met] : '';
  return '<td style="padding:3px 4px;border-bottom:1px solid var(--border);text-align:center">' +
    '<input type="number" min="0" max="100" step="1" value="' + v + '" ' +
    'placeholder="' + matrixEffectiveW_(team, fam, lk, met) + '" ' +
    'style="width:50px;font-size:12px;text-align:right;padding:3px 5px;border:1px solid var(--border);border-radius:6px;background:var(--input-bg);color:var(--text)" ' +
    'oninput="matrixCellInput_(\'' + team + '\',\'' + fam + '\',\'' + lk + '\',\'' + met + '\',this.value)"></td>';
}

// Per-team catch-all block — uncatalogued titles score with this block's weights
// (single ALL column). The Services section also lists the unmapped titles.
function renderTeamCatchAll_(sec) {
  var team = sec.team.key, code = 'ALL';
  var isCustom = familyHasOverride_(team, code);
  var n = (sec.catchAll && sec.catchAll.count) || 0;
  var defs = teamWeightDefs_(sec);
  var thStyle = 'padding:5px 6px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--border);text-align:center;min-width:54px';
  var badge = '<span class="mx-badge ' + (isCustom ? 'mx-badge-custom' : 'mx-badge-default') + '" id="mxbadge-' + team + '-' + code + '">' +
    (isCustom ? 'Custom' : 'Inheriting') + '</span>';

  var html = '<details style="margin:8px 0;border:1px dashed var(--border);border-radius:10px;overflow:hidden">' +
    '<summary style="cursor:pointer;padding:10px 14px;background:var(--th-bg);display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
      '<span style="font-size:13px;font-weight:800;color:var(--void)">Uncatalogued titles</span>' + badge +
      '<span style="font-weight:600;color:var(--muted);font-size:11px">catch-all · ' + n + ' rocketeer' + (n !== 1 ? 's' : '') + '</span>' +
    '</summary>' +
    '<div style="padding:6px 14px 12px;overflow-x:auto">' +
    '<p style="font-size:11px;color:var(--muted);margin:6px 0 10px;max-width:640px">' + esc(sec.team.label) +
      ' members whose job title is not in the <strong>Job Catalog</strong> score with this block\'s weights ' +
      '(one set, all levels). Blank cells inherit the placeholders. Add the title to the Job Catalog sheet ' +
      'to give it real family &amp; level weights instead.</p>';

  if (team === 'services') {
    var titles = MATRIX_CFG.unmappedTitles || [];
    if (titles.length) {
      html += '<details class="mx-unmapped" style="margin:0 0 10px"><summary>' + titles.length + ' title' +
          (titles.length !== 1 ? 's' : '') + ' — view list</summary>' +
        '<div style="padding:8px 12px">' +
          titles.map(function(u) {
            return '<div style="font-size:12px;color:var(--slate)">' + esc(u.jobTitle) +
              ' <span style="color:var(--muted)">· ' + u.count + ' rocketeer' + (u.count !== 1 ? 's' : '') + '</span></div>';
          }).join('') +
        '</div></details>';
    } else {
      html += '<p style="font-size:11px;color:var(--muted);margin:0 0 10px">All Services roster titles are currently mapped in the Job Catalog — nobody scores via this block right now.</p>';
    }
  }

  html += '<table style="border-collapse:collapse;width:max-content"><thead><tr>' +
    '<th style="' + thStyle + ';text-align:left;min-width:150px">Metric</th>' +
    '<th style="' + thStyle + '">All levels</th>' +
    '</tr></thead><tbody>';
  defs.forEach(function(d) {
    html += '<tr><th style="padding:4px 6px;font-size:11px;font-weight:700;color:var(--void);text-align:left;border-bottom:1px solid var(--border);white-space:nowrap">' +
      '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + d.color + ';margin-right:6px;vertical-align:1px"></span>' +
      esc(d.label) + '</th>' + matrixInputCell_(team, code, 'ALL', d.key) + '</tr>';
  });
  var t = matrixColSum_(team, code, 'ALL');
  html += '<tr><th style="padding:5px 6px;font-size:10px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;text-align:right">Σ / level</th>' +
    '<td id="msum-' + team + '-' + code + '-ALL" style="padding:4px 6px;font-size:11px;font-weight:800;text-align:center;color:' +
      (t === 100 ? '#00A86B' : '#D97706') + '">' + t + '%</td></tr>';
  html += '</tbody></table>';

  html += '<button class="settings-btn settings-btn-secondary" style="margin-top:8px;font-size:11px;padding:4px 10px" ' +
    'onclick="resetFamilyMatrix_(\'' + team + '\',\'' + code + '\')">Reset — inherit defaults</button>';
  html += '</div></details>';
  return html;
}

function matrixCellInput_(team, fam, lk, met, val) {
  var m = MATRIX_CFG.matrix;
  if (!m[team]) m[team] = {};
  if (!m[team][fam]) m[team][fam] = {};
  if (!m[team][fam][lk]) m[team][fam][lk] = {};
  if (val === '' || val === null) {
    delete m[team][fam][lk][met]; // blank → inherit
  } else {
    m[team][fam][lk][met] = Math.max(0, Math.min(100, parseFloat(val) || 0));
  }
  updateMatrixSum_(team, fam, lk);
  if (lk === 'ALL') {
    // A block-wide ALL edit changes every level's effective value — refresh all sums.
    var sec = matrixSection_(team), fRec = null;
    if (sec) sec.families.forEach(function(x) { if (x.code === fam) fRec = x; });
    var famData = MATRIX_CFG.rolesByFamily[fam];
    var levels = famData ? MATRIX_CFG.levelCols.filter(function(k) { return famData.levels[k]; }) : [];
    levels.forEach(function(k) { updateMatrixSum_(team, fam, k); });
  }
  updateFamilyBadge_(team, fam);
}

function updateMatrixSum_(team, fam, lk) {
  var cell = document.getElementById('msum-' + team + '-' + fam + '-' + lk);
  if (!cell) return;
  var t = matrixColSum_(team, fam, lk);
  cell.textContent = t + '%';
  cell.style.color = t === 100 ? '#00A86B' : '#D97706';
}

// Live Custom/Inheriting badge update as the admin edits a block's cells.
function updateFamilyBadge_(team, fam) {
  var b = document.getElementById('mxbadge-' + team + '-' + fam);
  if (!b) return;
  var custom = familyHasOverride_(team, fam);
  b.className = 'mx-badge ' + (custom ? 'mx-badge-custom' : 'mx-badge-default');
  b.textContent = custom ? 'Custom' : 'Inheriting';
}

// Reset = empty the rendered block (NOT delete the key): saveScoringMatrix's merge
// treats a present-but-empty block as "clear my stored weights".
function resetFamilyMatrix_(team, fam) {
  if (MATRIX_CFG && MATRIX_CFG.matrix) {
    if (!MATRIX_CFG.matrix[team]) MATRIX_CFG.matrix[team] = {};
    MATRIX_CFG.matrix[team][fam] = {};
    renderMatrixSection_(); // re-render from state; other unsaved edits are kept
  }
}

function saveMatrixToSheet_() {
  var btn = document.getElementById('saveMatrixBtn');
  var err = document.getElementById('matrixSaveError');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  if (err) err.style.display = 'none';
  google.script.run
    .withSuccessHandler(function(res) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Scoring Matrix'; }
      if (res && res.ok) {
        var flash = document.getElementById('matrixSaveFlash');
        if (flash) { flash.style.display = 'inline'; setTimeout(function() { flash.style.display = 'none'; }, 2500); }
      } else if (err) {
        err.textContent = 'Save failed: ' + ((res && res.error) || 'unknown error');
        err.style.display = 'block';
      }
    })
    .withFailureHandler(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save Scoring Matrix'; }
      if (err) { err.textContent = 'Save failed: ' + String(e.message || e); err.style.display = 'block'; }
    })
    .saveScoringMatrix({ matrix: MATRIX_CFG.matrix });
}
```

Also update the region's header comment to:

```js
// ── SCORING MATRIX EDITOR — Team → Family × Level weights (admin only) ─────────
// Backed by getScoringConfig() / saveScoringMatrix(). Families are grouped under
// the org-team separators (same teams as the dashboard toggle); blank cells
// inherit the per-(team, family) fill defaults shipped in cfg.sections.
```

- [ ] **Step 2: Sanity-check the region**

```bash
grep -n "renderCoeBlock_\|renderNonContribBlock_\|renderServicesBlock_\|singleColWeightsGrid_\|cfg.families\|coeFamily\|nonContrib" "PS Dashboard.html"
```

Expected: zero hits. Then confirm the file's `<script>` still parses by loading it in Node's parser:

```bash
node -e "const s=require('fs').readFileSync('PS Dashboard.html','utf8'); const m=s.match(/<script>([\s\S]*)<\/script>/); new Function(m[1]); console.log('parses OK')"
```

Expected: `parses OK`. (If the HTML has multiple script blocks, this checks the first/main one — adjust the regex index only if it errors on unrelated content.)

- [ ] **Step 3: Commit**

```bash
git add "PS Dashboard.html"
git commit -m "feat(scoring-ui): matrix editor grouped by org team — separators, per-team blocks, ALL column"
```

---

### Task 7: Docs, full test sweep, deploy notes

**Files:**
- Modify: `CLAUDE.md` — the "Family × Level weight matrix (company-wide)" subsection
- Modify: `docs/superpowers/specs/2026-07-08-org-team-toggle-design.md` — add a superseded note

- [ ] **Step 1: Rewrite the CLAUDE.md matrix subsection**

Replace the `### Family × Level weight matrix (company-wide)` block (everything from that heading to just before `Scoring caps:`) with:

```markdown
### Team-aligned scoring matrix (2026-07-09)

Scoring groups follow the org team toggle (`TEAMS_` in `PS Teams.js`): **team gates,
family tunes**. Spec: `docs/superpowers/specs/2026-07-09-team-aligned-scoring-design.md`.

- **Sheet of record**: `PS Scoring Matrix`, schema `Team | Family | Metric | I1–I8,
  M4–M10 | ALL`. Blocks exist per **(team, family)** pair where the family has active
  members in that team — a family spanning two teams has independent blocks. The `ALL`
  column is a block-wide value on any family (a level cell beats it); `Family = ALL`
  is the per-team uncatalogued catch-all. A legacy (pre-Team-column) sheet is mapped
  on read by `migrateLegacyMatrix_`; the first save rewrites the new schema, and saves
  **merge** over stored blocks so unrendered (team, family) pairs survive.
- **Resolution** (`weightsForEmployee_`): `emp.team` → catalog hit →
  `matrix[team][family][level]` → family `ALL` cell → team catch-all (`ALL`/`ALL`) →
  `blockFillBase_(team, family, base)` → **hard mask** to `team.metrics`
  (`maskToTeamMetrics_`) — R&D / Sales members can never carry tracked/planned/RCR
  weight, even from hand-edited sheet rows.
- **Fill defaults** (`blockFillBase_`): Services natives (JF007/8/9/018), JF004-in-
  Services, and catch-alls inherit the flat base; embedded ops families under Services
  inherit `RND_DEFAULT_W_` (Goals 40/Kudos 20/SI 20/PTO 20 — never re-enables
  tracked/planned/RCR); R&D → `RND_DEFAULT_W_`; Sales → `SALES_DEFAULT_W_` (own
  constant, same seed values, extended in the HubSpot phase).
- **Per-employee weights on the client**: unchanged — `emp.scoreWeights` attaches only
  when the resolved weights differ from the flat base (reference check); base-inherit
  Services natives follow live weight previews via `SCORE_W`.
- **Editor**: ☰ → ⚖️ Scoring Weights → matrix section renders three team separators
  (Services / R&D / Sales & Success) with family blocks placed by active membership
  (`getScoringConfig().sections`) plus a per-team "Uncatalogued titles" catch-all.
  `saveScoringMatrix()` validates metrics against the team's set and busts the cache.
- Tests: `_test_weightsResolver()` and `_test_matrixMigration()` — GAS editor or Node
  (eval both PS files with a stubbed `Logger`).
```

- [ ] **Step 2: Mark the superseded decisions in the toggle spec**

In `docs/superpowers/specs/2026-07-08-org-team-toggle-design.md`, append to the `| R&D / Sales scoring |` table row's cell: ` **Superseded 2026-07-09** by the team-aligned scoring spec (per-team blocks + hard metric mask).` and append the same one-line note to the "Per-team editable base weights (rejected…)" bullet under *Out of scope*.

- [ ] **Step 3: Full test sweep**

Run all four suites (`_test_weightsResolver`, `_test_matrixMigration`, `_test_teamForProfile`, `_test_sheetMemo`) — all exit 0 / report all-pass.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md "docs/superpowers/specs/2026-07-08-org-team-toggle-design.md"
git commit -m "docs: team-aligned scoring — CLAUDE.md model update + supersede notes in toggle spec"
```

- [ ] **Step 5: Record deploy checklist (do NOT deploy from this plan)**

Manual QA after the owner pushes to GAS (new deployment of BOTH `PS Contribution Report.js`, `PS Teams.js`, `PS Dashboard.html`):

1. Bump `PS_CACHE_VER` in Script Properties (attached `scoreWeights` change for R&D/Sales populations).
2. ⚖️ Scoring Weights → matrix renders three separators; families sit under the right teams; JF004 appears under Sales & Success (and under Services only if JF004 titles exist in the PS class); metric rows per section match the team's set (R&D/Sales show 4 rows).
3. Enter a weight in an R&D family cell, Save → reload → value round-trips; `PS Scoring Matrix` sheet now has the Team column.
4. Top Rocketeers on R&D/Sales: no tracked/planned/RCR contribution to scores; Services scores unchanged for native families and embedded ops.
5. Execution log: no `⚠️ saveScoringMatrix: dropped …` on a clean save; `ℹ️ Legacy NONCONTRIB/ALL …` appears at most once (first read of a legacy sheet).

---

## Self-review notes (already applied)

- **Spec coverage:** §1 sheet schema → Tasks 3/4; §2 defaults → Task 2; §3 resolution → Tasks 1/2; §4 migration → Tasks 3/4; §5 editor → Tasks 5/6; §6 error handling → Tasks 3/4 (unknown-team log, drop log, merge); §7 tests → Tasks 1/3; §8 cache/deploy → Task 7.
- **Known simplification vs spec §4:** a legacy `NONCONTRIB/ALL` override is mapped to the R&D catch-all only; catalogued embedded-ops members under Services fill from the policy defaults until retuned (logged on read). The live sheet is two days old and its NONCONTRIB block is expected to be blank, so no real tuning is lost.
- **Type consistency:** matrix shape `matrix[team][family][levelKey|ALL][metric]` used identically in resolver (Task 2), parser (Task 3), save (Task 4), config (Task 5), and editor (Task 6). Handler ids are `msum-<team>-<fam>-<lk>` / `mxbadge-<team>-<fam>` everywhere.
