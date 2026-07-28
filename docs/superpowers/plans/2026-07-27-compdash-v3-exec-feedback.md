# CompDash V3 — Exec Feedback Absorption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve CompDash V2 → V3 per the approved spec (`docs/superpowers/specs/2026-07-27-compdash-v3-exec-feedback-design.md`): manager-level attrition, rule-based verdict/callout engine, exec TL;DR strip, attrition forecast + financial impact, RAG color coding with research-seeded thresholds, sample-size caveats, glossary — plus a roadmap draft doc.

**Architecture:** All new computation is server-side pure functions in `CompDash/Code.js` (PURE LOGIC section, Node-testable), wired into `getCompReportData()`'s cached payload. `ViewDash.html` renders new payload blocks; verdicts are full-population facts that client filters never recompute. Thresholds live in `CONFIG_CD.RAG`, overridable via one `CD_RAG_CFG` JSON Script Property, echoed to the client via `meta.ragCfg`.

**Tech Stack:** Google Apps Script (V8), vanilla JS single-page HTML (HtmlService), Node test harness (`node CompDash/tests/run_tests.js` evals Code.js + cases.js together; `node CompDash/tests/parse_html.js` syntax-checks the HTML script block).

**House rules that bind every task:**
- Pure logic goes ABOVE the `// GAS LAYER` marker in Code.js; GAS-API code below it.
- Verdict/summary lines carry **counts only, never individual names** (names live in tables).
- Client never hardcodes thresholds — always read `meta.ragCfg`.
- Status colors are the existing semantic vars (`--accent`/`--warn`/`--bad`), never brand colors.
- Deploy needs `bustCompCache_()` — payload shape changes (documented in Task 14).

**Conventions used below:** "Run tests" = `node CompDash/tests/run_tests.js` from `D:\Contribution`. Expected pass counts are stated relative ("previous count + N new") because the suite already has a large case count. All Code.js line anchors reference the file as of commit `91e067d`.

---

### Task 1: Config — RAG thresholds, reason classes, glossary, sources + `ragBand_`

**Files:**
- Modify: `CompDash/Code.js:50-64` (inside `CONFIG_CD`, after `PRIORITY_CAPS`) and the pure-logic section (after `asNum_`, ~line 98)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests** — append to `CompDash/tests/cases.js`:

```js
// ── V3 Task 1: RAG config + ragBand_ ────────────────────────
check("CONFIG_CD.RAG exists with all V3 threshold groups",
  !!(CONFIG_CD.RAG && CONFIG_CD.RAG.attritionTotal && CONFIG_CD.RAG.attritionVol &&
     CONFIG_CD.RAG.regrettedShare && CONFIG_CD.RAG.peerVolBand &&
     CONFIG_CD.RAG.floorHeads === 10 && CONFIG_CD.RAG.floorExits === 3 &&
     CONFIG_CD.RAG.spanTarget === 6));
check("CONFIG_CD.MGR_MIN_REPORTS is 3", CONFIG_CD.MGR_MIN_REPORTS === 3);
check("CONFIG_CD.FORECAST_MIN_MONTHS is 6", CONFIG_CD.FORECAST_MIN_MONTHS === 6);
check("CONFIG_CD.REASON_CLASS classifies 'Another Job' as labor-market/comp",
  CONFIG_CD.REASON_CLASS.find(rc => rc.re.test("Another Job")).driver === "labor-market/comp");
check("CONFIG_CD.REASON_CLASS classifies 'Job Position Eliminated or Changed' as role-design/structural",
  CONFIG_CD.REASON_CLASS.find(rc => rc.re.test("Job Position Eliminated or Changed")).driver === "role-design/structural");
check("CONFIG_CD.GLOSSARY has entries and BENCH_SOURCES cited",
  CONFIG_CD.GLOSSARY.length >= 8 && CONFIG_CD.BENCH_SOURCES.length >= 4);

check("ragBand_ green at/below green bound", ragBand_(0.13, { green: 0.13, yellow: 0.18 }) === "green");
check("ragBand_ yellow between bounds", ragBand_(0.15, { green: 0.13, yellow: 0.18 }) === "yellow");
check("ragBand_ red above yellow bound", ragBand_(0.19, { green: 0.13, yellow: 0.18 }) === "red");
check("ragBand_ null-safe", ragBand_(null, { green: 0.13, yellow: 0.18 }) === null);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `ragBand_ is not defined` (the eval aborts on the first missing symbol; that is the failure signal).

- [ ] **Step 3: Add config + implementation.** Inside `CONFIG_CD`, insert after the `PRIORITY_CAPS` line (`Code.js:52`):

```js
  // ── V3: RAG thresholds & benchmarks ─────────────────────────────────────
  // Research-seeded 2026-07-27 (Mercer US Turnover Survey 2025; SHRM
  // Benchmarking 2025; SPI PS Maturity Benchmark 2025/2026; Umbrex regretted-
  // attrition guide; Visier span-of-control 2024; McKinsey span archetypes).
  // Every value overridable via the CD_RAG_CFG Script Property — a JSON object
  // shallow-merged per group over these defaults (see ragCfg_ in the GAS layer).
  // Sources render in Data Reference; services/BPO-adjacent roles run a few
  // points above pure-software norms.
  RAG: {
    attritionTotal: { green: 0.13, yellow: 0.18 }, // ≤green / ≤yellow / above = red
    attritionVol:   { green: 0.10, yellow: 0.18 },
    regrettedShare: { green: 0.25, yellow: 0.40 }, // share of VOLUNTARY exits
    peerVolBand:    { low: 0.11, high: 0.15 },     // PS peer voluntary band (chart zone + text)
    concentration:  0.60,   // top-2 dept share of exits that reads as concentrated
    spanTarget: 6, spanNarrow: 4, spanWide: 10,    // manager:IC ratio guides
    floorHeads: 10, floorExits: 3,                 // sample-size guards (caveat + severity cap)
  },
  MGR_MIN_REPORTS: 3,      // managers below this pool into a "small teams" row
  FORECAST_MIN_MONTHS: 6,  // forecast requires this many actual FY months

  // Exit-reason → driver classification for the "trends & drivers" verdict.
  // First matching regex wins; unmatched reasons read as "other".
  REASON_CLASS: [
    { re: /another job|better offer/i,             driver: "labor-market/comp" },
    { re: /position eliminated|contract ended/i,   driver: "role-design/structural" },
    { re: /unsatisfactory|attendance/i,            driver: "performance-managed" },
    { re: /personal|school|voluntary other/i,      driver: "personal" },
  ],

  BENCH_SOURCES: [
    "Mercer US Turnover Survey 2025 — US avg voluntary 13%, tech ~12%",
    "SHRM Benchmarking Report 2025 — median voluntary 9%, average 13%",
    "SPI Professional Services Maturity Benchmark 2025/2026 — PS total attrition 11.4–12.8%",
    "Umbrex Regretted Attrition guide — typical firms 15–35% of voluntary exits regretted",
    "Visier Span of Control 2024 / McKinsey archetypes — knowledge-work span 6–8",
  ],

  GLOSSARY: [
    { term: "I-level (I1–I8)", def: "Individual-contributor career track parsed from the Job Title level token (e.g. 04.I3.1). Higher number = more senior." },
    { term: "M-level (M4–M10)", def: "Management career track from the same title token (e.g. 04.M5.2)." },
    { term: "JF codes (JF001…)", def: "Job Catalog family codes (e.g. JF004 = Sales & Success). Not displayed in this dashboard; listed here because sibling reports use them." },
    { term: "TCC", def: "Total Cash Compensation — base plus variable target, local currency unless the USD toggle is on." },
    { term: "Internal Position (compa-ratio)", def: "TCC ÷ peer anchor. 1.00 = at the anchor; bands are shown in the threshold table below." },
    { term: "Anchor tiers", def: "Where the peer anchor comes from: title-peer median (≥3 peers) → external market mean (one-of-a-kind roles) → location level-cohort median → none." },
    { term: "Voluntary / involuntary", def: "From the roster Termination Category. Voluntary = the Rocketeer chose to leave." },
    { term: "Regretted exit", def: "A leaver the company would have preferred to keep (roster Termination Regretted flag). Reported as a share of voluntary exits." },
    { term: "Attrition rate", def: "FY terminations ÷ mean(headcount at FY start, headcount at FY end — today for the running FY)." },
    { term: "Span of control", def: "Active ICs ÷ active managers (anyone who supervises ≥1 active report)." },
    { term: "RAG", def: "Red / Amber(yellow) / Green status coding. Every threshold is configuration, shown with its source in the table below." },
  ],
```

Then add the pure helper in the PURE LOGIC section, directly after `asNum_` (`Code.js:98`):

```js
/** RAG band for a fraction metric where LOWER is better. @returns "green"|"yellow"|"red"|null */
function ragBand_(value, bands) {
  if (value == null || !bands) return null;
  return value <= bands.green ? "green" : value <= bands.yellow ? "yellow" : "red";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS — previous count + 10 new checks, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): V3 RAG threshold config, reason classes, glossary, ragBand_

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Supervisor column read + `CD_RAG_CFG` override helper

**Files:**
- Modify: `CompDash/Code.js` — `readRosterCD_` (~lines 779-833), GAS layer after `ssIds_()` (~line 691), `debugCompPipeline` (~line 1113)

No Node test (GAS layer). Verified by `debugCompPipeline()` at deploy and by the existing tests still passing (the pure section is untouched).

- [ ] **Step 1: Add the Supervisor column to `readRosterCD_`.** In the `c = {...}` column map (after the `gender:` line, `Code.js:791`):

```js
    supervisor: col("Supervisor"), // optional — powers the Managers view; absent column degrades gracefully
```

After `const tccUsdAvailable = c.tccUsd !== -1;` add:

```js
  const supervisorAvailable = c.supervisor !== -1;
```

In the pushed record object (after the `gender:` field):

```js
      supervisor: c.supervisor !== -1 ? String(row[c.supervisor] || "").trim() : "",
```

Change the return statement and its JSDoc `@returns` to include the flag:

```js
  return { records, genderAvailable, tccUsdAvailable, supervisorAvailable };
```

And extend the `log_` line to report it: append `", supervisor " + (supervisorAvailable ? "available" : "MISSING")` before the closing paren.

- [ ] **Step 2: Add `ragCfg_()` to the GAS layer**, directly after `ssIds_()` (`Code.js:691`):

```js
/**
 * CONFIG_CD.RAG with CD_RAG_CFG Script Property overrides merged in.
 * The property is a JSON object; each top-level group (attritionTotal, …) is
 * shallow-merged over the default so a partial override ({"peerVolBand":
 * {"high":0.16}}) keeps the untouched keys. Invalid JSON logs and falls back.
 */
function ragCfg_() {
  const base = JSON.parse(JSON.stringify(CONFIG_CD.RAG));
  const raw = props_().getProperty("CD_RAG_CFG");
  if (!raw) return base;
  try {
    const o = JSON.parse(raw);
    Object.keys(o).forEach(k => {
      if (o[k] && typeof o[k] === "object" && base[k] && typeof base[k] === "object") {
        Object.assign(base[k], o[k]);
      } else {
        base[k] = o[k];
      }
    });
  } catch (e) {
    Logger.log("⚠️ ragCfg_: CD_RAG_CFG is not valid JSON — using defaults: " + e.message);
  }
  return base;
}
```

- [ ] **Step 3: Extend `debugCompPipeline`.** After the TCC USD log block (`Code.js:1124`), add:

```js
  const supHits = active.filter(x => x.supervisor).length;
  Logger.log("Supervisor column: " + (r.supervisorAvailable ? "FOUND" : "NOT FOUND — Managers view will show its unavailable notice") +
             " — " + supHits + "/" + active.length + " active have a value");
```

- [ ] **Step 4: Run the full suite (regression only)**

Run: `node CompDash/tests/run_tests.js && node CompDash/tests/parse_html.js`
Expected: PASS, same counts as after Task 1 (no new checks).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): read roster Supervisor column + CD_RAG_CFG override helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `buildManagers_` — manager aggregation + span of control

**Files:**
- Modify: `CompDash/Code.js` — PURE LOGIC section, insert after `buildAttrition_`/mirror block (after `sliceAttritionFromPeople_`, ~line 327)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests** — append to `cases.js`. Fixtures are self-contained (do NOT reuse `mkEmp` — V3 needs supervisor/tccUsd fields with explicit dates):

```js
// ── V3 Task 3: buildManagers_ ───────────────────────────────
function mkV3(over) {
  return Object.assign({
    empNo: "X" + Math.random().toString(36).slice(2, 8), name: "P " + Math.random().toString(36).slice(2, 6),
    active: true, dept: "Services", level: "I3", keyLocation: "Malaysia",
    hireDate: new Date(2022, 0, 15), termDate: null, termCategory: "", termReason: "",
    termRegretted: "", supervisor: "", tcc: 100000, tccUsd: 50000, ratio: null,
  }, over || {});
}
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27, asOf 2027-02-15
  const recs = [];
  // Manager A: 4 active + 2 FY27 exits (1 vol, 1 invol)
  for (let i = 0; i < 4; i++) recs.push(mkV3({ supervisor: "Mgr A" }));
  recs.push(mkV3({ supervisor: "Mgr A", active: false, termDate: new Date(2026, 8, 10), termCategory: "Voluntary" }));
  recs.push(mkV3({ supervisor: "Mgr A", active: false, termDate: new Date(2026, 10, 3), termCategory: "Involuntary" }));
  // Manager B: 5 active, no exits
  for (let i = 0; i < 5; i++) recs.push(mkV3({ supervisor: "Mgr B", dept: "R&D" }));
  // Manager C: 2 active (below MGR_MIN_REPORTS → pooled)
  for (let i = 0; i < 2; i++) recs.push(mkV3({ supervisor: "Mgr C" }));
  // Managers themselves as active employees (so span-of-control can count them)
  ["Mgr A", "Mgr B", "Mgr C"].forEach(n => recs.push(mkV3({ name: n, supervisor: "Mgr Top" })));
  recs.push(mkV3({ name: "Mgr Top" }));

  const m = buildManagers_(recs, ctx, CONFIG_CD);
  check("managers: available", m.available === true);
  const a = m.rows.find(r => r.name === "Mgr A");
  check("managers: Mgr A team of 4 active, 2 FY exits, 1 voluntary",
    a && a.teamSize === 4 && a.exitsFY === 2 && a.voluntaryExits === 1);
  // Mgr A team: hc(fyStart 2026-07-01)=6 (all hired 2022, exits Sep/Nov), hc(asOf)=4 → avg 5 → rate 2/5
  check("managers: Mgr A rate = exits ÷ avg team headcount", approx(a.attritionRate, 0.4));
  check("managers: worst-first sort (Mgr A before Mgr B)",
    m.rows.indexOf(a) < m.rows.indexOf(m.rows.find(r => r.name === "Mgr B")));
  check("managers: Mgr C pooled, not a row",
    !m.rows.find(r => r.name === "Mgr C") && m.pooledSmallTeams && m.pooledSmallTeams.pooledManagers === 1 &&
    m.pooledSmallTeams.teamSize === 2);
  // span: active sups who are themselves active employees = Mgr A/B/C/Top = 4 managers
  check("managers: span counts 4 managers", m.spanOfControl.managers === 4);
  check("managers: span ics = active − managers",
    m.spanOfControl.ics === recs.filter(r => r.active).length - 4);
  check("managers: span target echoed from cfg", m.spanOfControl.target === CONFIG_CD.RAG.spanTarget);

  const none = buildManagers_(recs.map(r => Object.assign({}, r, { supervisor: "" })), ctx, CONFIG_CD);
  check("managers: no supervisor values → available:false", none.available === false);
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `buildManagers_ is not defined`.

- [ ] **Step 3: Implement** — insert in Code.js after `sliceAttritionFromPeople_` (~line 327), before the Internal Position engine:

```js
// ── Managers engine (V3) ────────────────────────────────────────────────────
// Attrition by supervisor — the "manager-quality vs department-wide" lens.
// Team = everyone whose Supervisor equals the manager's name; rate uses the
// same FY framing as fyAttritionBlock_ (exits ÷ mean team headcount).
// Managers with < cfg.MGR_MIN_REPORTS active reports pool into one row
// (sample-size rule). Verdict lines about this data carry counts only.

function buildManagers_(records, ctx, cfg) {
  const bySup = new Map();
  records.forEach(r => {
    const s = String(r.supervisor || "").trim();
    if (!s) return;
    if (!bySup.has(s)) bySup.set(s, []);
    bySup.get(s).push(r);
  });
  if (!bySup.size) return { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };

  const end = (ctx.asOf < ctx.fyEnd) ? ctx.asOf : ctx.fyEnd;
  const mkRow = (name, team) => {
    const active = team.filter(r => r.active);
    const exits = team.filter(r => r.termDate && r.termDate >= ctx.fyStart && r.termDate <= ctx.fyEnd);
    const avg = (headcountOn_(team, ctx.fyStart) + headcountOn_(team, end)) / 2;
    const deptCounts = {};
    active.forEach(r => { const d = r.dept || "—"; deptCounts[d] = (deptCounts[d] || 0) + 1; });
    const dept = Object.keys(deptCounts).sort((a, b) => deptCounts[b] - deptCounts[a])[0] || "—";
    return {
      name, teamSize: active.length, exitsFY: exits.length,
      voluntaryExits: exits.filter(r => classifyTerm_(r.termCategory) === "vol").length,
      attritionRate: avg > 0 ? exits.length / avg : null,
      dept,
    };
  };

  const rows = [];
  const smallTeams = [];
  bySup.forEach((team, name) => {
    const row = mkRow(name, team);
    if (row.teamSize >= cfg.MGR_MIN_REPORTS) rows.push(row);
    else if (row.teamSize > 0 || row.exitsFY > 0) smallTeams.push(team);
  });
  rows.sort((a, b) =>
    (b.attritionRate || 0) - (a.attritionRate || 0) || b.exitsFY - a.exitsFY ||
    a.name.localeCompare(b.name));

  let pooledSmallTeams = null;
  if (smallTeams.length) {
    const flat = [].concat.apply([], smallTeams);
    pooledSmallTeams = Object.assign(
      mkRow("Small teams (<" + cfg.MGR_MIN_REPORTS + " reports)", flat),
      { pooledManagers: smallTeams.length });
  }

  // Span of control: managers = ACTIVE employees who supervise ≥1 active report.
  const activeNames = new Set(records.filter(r => r.active).map(r => normCD_(r.name)));
  const activeSups = new Set();
  records.filter(r => r.active && r.supervisor).forEach(r => {
    const k = normCD_(r.supervisor);
    if (activeNames.has(k)) activeSups.add(k);
  });
  const managers = activeSups.size;
  const activeCount = records.filter(r => r.active).length;
  const ics = activeCount - managers;
  return {
    available: true, rows, pooledSmallTeams,
    spanOfControl: {
      managers, ics,
      ratio: managers > 0 ? Math.round(ics / managers * 10) / 10 : null,
      target: cfg.RAG.spanTarget,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS — previous count + 9 new checks.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): buildManagers_ — supervisor attrition rows, pooled small teams, span of control

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `buildFinancialImpact_` — payroll released by FY exits

**Files:**
- Modify: `CompDash/Code.js` — PURE LOGIC section, insert directly after `buildManagers_`
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
// ── V3 Task 4: buildFinancialImpact_ ────────────────────────
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27
  const recs = [
    // Exit in Sep 2026 = fiscal month idx 2 → 9 months remaining → 120000/12*9 = 90000
    mkV3({ active: false, termDate: new Date(2026, 8, 10), termCategory: "Voluntary",
           termRegretted: "Yes", tccUsd: 120000 }),
    // Exit in Jul 2026 = idx 0 → 11 months → 60000/12*11 = 55000 (not regretted)
    mkV3({ active: false, termDate: new Date(2026, 6, 20), termCategory: "Involuntary", tccUsd: 60000 }),
    // Exit with NO TCC USD → skipped, counted in coverage.total only
    mkV3({ active: false, termDate: new Date(2026, 9, 1), termCategory: "Voluntary", tccUsd: null }),
    // Prior-FY exit → outside window entirely
    mkV3({ active: false, termDate: new Date(2025, 8, 1), tccUsd: 999999 }),
    mkV3({}), // active — ignored
  ];
  const fi = buildFinancialImpact_(recs, ctx);
  check("financial: released = 90000 + 55000", fi.annualPayrollReleasedUsd === 145000);
  check("financial: regretted portion = 90000", fi.regrettedPortionUsd === 90000);
  check("financial: coverage 2 of 3 FY leavers", fi.coverage.counted === 2 && fi.coverage.total === 3);
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `buildFinancialImpact_ is not defined`.

- [ ] **Step 3: Implement:**

```js
// ── Financial impact of FY exits (V3) ───────────────────────────────────────
// Payroll released this FY by leavers: TCC USD ÷ 12 × full months remaining
// in the FY after the exit month. Rows without TCC USD are skipped and
// reported via coverage — never zero-filled (coverage-counter pattern).
// Field name annualPayrollReleasedUsd is the spec contract; the value is the
// FY-prorated release, not a flat annual sum.

function buildFinancialImpact_(records, ctx) {
  const leavers = records.filter(r =>
    r.termDate && r.termDate >= ctx.fyStart && r.termDate <= ctx.fyEnd);
  let counted = 0, released = 0, regretted = 0;
  leavers.forEach(r => {
    const idx = fiscalMonthIdx_(r.termDate, ctx.fyStartCalYear);
    if (idx === -1 || !(r.tccUsd > 0)) return;
    const amt = r.tccUsd / 12 * (11 - idx);
    counted++;
    released += amt;
    if (/yes|true/i.test(String(r.termRegretted || ""))) regretted += amt;
  });
  return {
    annualPayrollReleasedUsd: Math.round(released),
    regrettedPortionUsd: Math.round(regretted),
    coverage: { counted, total: leavers.length },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS — previous count + 3 new checks.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): buildFinancialImpact_ — FY-prorated payroll released by exits

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `buildForecast_` + prior-FY same-period block

**Files:**
- Modify: `CompDash/Code.js` — PURE LOGIC: insert `buildForecast_` after `buildFinancialImpact_`; extend `buildAttrition_` (~line 228)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
// ── V3 Task 5: buildForecast_ + previousFYSamePeriod ────────
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27, fiscalMonthIdx = 7 → 8 actual months
  const mkFY = terms => ({
    monthly: terms.map(t => ({ terms: t, vol: 0, invol: 0 })),
    avgHeadcount: 100, total: terms.reduce((a, b) => a + b, 0),
  });
  // 8 actual months, 8 exits → baseline 1/mo; prev FY flat 1/mo → seasonal 1 everywhere
  const cur = mkFY([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  const prev = mkFY([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const fc = buildForecast_(cur, prev, ctx, CONFIG_CD);
  check("forecast: exists with 8 actual months", fc != null);
  check("forecast: 12 months, first 8 actual, last 4 forecast",
    fc.months.length === 12 && fc.months[7].forecast === false && fc.months[8].forecast === true);
  check("forecast: flat seasonality projects baseline (1/mo)", approx(fc.months[8].terms, 1));
  check("forecast: projected total 12, annualized 12%", approx(fc.projectedTotal, 12) && approx(fc.annualizedRate, 0.12));

  // Guard: asOf in Oct (idx 3) → 4 actual months < 6 → null
  const early = fiscalContextCD_(new Date(2026, 9, 15));
  check("forecast: <6 actual months → null", buildForecast_(cur, prev, early, CONFIG_CD) === null);

  // Seasonality: prev FY concentrated in Dec (idx 5) → future Dec-equivalent months scale up
  const seasonalPrev = mkFY([0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0]);
  const fc2 = buildForecast_(cur, seasonalPrev, ctx, CONFIG_CD);
  check("forecast: zero-seasonality future month projects 0", approx(fc2.months[8].terms, 0));

  // previousFYSamePeriod lands on the attrition payload
  const recs = [mkV3({}), mkV3({}), mkV3({ active: false, termDate: new Date(2025, 8, 5), termCategory: "Voluntary" })];
  const attr = buildAttrition_(recs, ctx);
  check("attrition: previousFYSamePeriod block present with a rate",
    attr.previousFYSamePeriod && attr.previousFYSamePeriod.rate != null);
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `buildForecast_ is not defined`.

- [ ] **Step 3: Implement.** Insert after `buildFinancialImpact_`:

```js
// ── Attrition forecast (V3) ─────────────────────────────────────────────────
// Trend × prior-FY seasonality, ported (reduced) from termination-analysis
// applyForecasting: baseline = actual FY exits ÷ actual months; each future
// month scales the baseline by the prior FY's share of that fiscal month.
// Returns null with < cfg.FORECAST_MIN_MONTHS actual months (too little
// signal) or when the FY is complete (nothing left to forecast).

function buildForecast_(currentFY, previousFY, ctx, cfg) {
  const actualMonths = fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear) + 1;
  if (actualMonths < cfg.FORECAST_MIN_MONTHS || actualMonths >= 12) return null;
  const actualTerms = currentFY.monthly.slice(0, actualMonths).reduce((t, m) => t + m.terms, 0);
  const baseline = actualTerms / actualMonths;
  const prevTotal = previousFY.monthly.reduce((t, m) => t + m.terms, 0);
  const months = currentFY.monthly.map((m, i) => {
    if (i < actualMonths) return { idx: i, terms: m.terms, forecast: false };
    const seasonal = prevTotal > 0 ? previousFY.monthly[i].terms / (prevTotal / 12) : 1;
    return { idx: i, terms: Math.round(baseline * seasonal * 10) / 10, forecast: true };
  });
  const projectedTotal = months.reduce((t, m) => t + m.terms, 0);
  return {
    months,
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    annualizedRate: currentFY.avgHeadcount > 0
      ? Math.round(projectedTotal / currentFY.avgHeadcount * 1000) / 1000 : null,
    method: "trend × prior-FY seasonality (" + actualMonths + " actual months)",
  };
}
```

Then in `buildAttrition_` (~line 239), add the same-period block to the returned object, after the `previousFY:` line:

```js
    // Prior FY cut at the same calendar point — the like-for-like basis for
    // "vs last year" trend arrows (a full prior FY vs a part-year FY misleads).
    previousFYSamePeriod: fyAttritionBlock_(records, ctx.prevFyStart, ctx.prevFyEnd,
      new Date(ctx.asOf.getFullYear() - 1, ctx.asOf.getMonth(), ctx.asOf.getDate()),
      ctx.prevFyLabel + " YTD"),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS — previous count + 7 new checks.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): buildForecast_ (trend x seasonality) + prior-FY same-period attrition block

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Verdict engine — `buildVerdicts_` + sample-size guard

**Files:**
- Modify: `CompDash/Code.js` — PURE LOGIC section, insert after `buildForecast_`
- Test: `CompDash/tests/cases.js` (append)

**Contract (from spec §2):** verdicts are `{ id, view, severity: "FACT"|"NOTE"|"RISK", fact, soWhat, action, caveat }` — `action` empty-string when no recommended action exists; every verdict answers the so-what. Counts only, never names. Deterministic. Missing input block ⇒ dependent rules silently skipped.

- [ ] **Step 1: Write the failing tests:**

```js
// ── V3 Task 6: buildVerdicts_ ───────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  const mkFY = (terms, vol, regretted, hc) => ({
    monthly: [], quarterly: [], total: terms, vol, invol: terms - vol,
    regretted, avgHeadcount: hc, rate: hc > 0 ? terms / hc : null, label: "FY27",
  });
  const model = {
    fyLabel: "FY27", prevFyLabel: "FY26", activeCount: 200, hcFyStart: 205,
    attrition: {
      currentFY: mkFY(40, 30, 15, 200),          // 20% total → red; 15% vol → yellow; 50% regretted → red
      previousFY: mkFY(30, 22, 8, 200),
      previousFYSamePeriod: mkFY(20, 15, 6, 200),
      slices: { department: [
        { key: "Services", terms: 25, vol: 20, invol: 5, headcount: 100, rate: 0.25 },
        { key: "Sales", terms: 10, vol: 7, invol: 3, headcount: 40, rate: 0.25 },
        { key: "R&D", terms: 5, vol: 3, invol: 2, headcount: 60, rate: 0.08 },
      ], level: [], keyLocation: [] },
      detail: [
        { reason: "Another Job", cls: "vol" }, { reason: "Another Job", cls: "vol" },
        { reason: "Another Job", cls: "vol" }, { reason: "Job Position Eliminated or Changed", cls: "invol" },
        { reason: "Personal Reasons", cls: "vol" },
      ],
      financialImpact: { annualPayrollReleasedUsd: 500000, regrettedPortionUsd: 200000,
                         coverage: { counted: 38, total: 40 } },
      forecast: { projectedTotal: 55, annualizedRate: 0.275, method: "trend × prior-FY seasonality (8 actual months)", months: [] },
    },
    managers: { available: true, rows: [
      { name: "A", teamSize: 6, exitsFY: 3, voluntaryExits: 3, attritionRate: 0.42, dept: "Services" },
      { name: "B", teamSize: 9, exitsFY: 3, voluntaryExits: 2, attritionRate: 0.31, dept: "Sales" },
      { name: "C", teamSize: 7, exitsFY: 1, voluntaryExits: 1, attritionRate: 0.14, dept: "Services" },
    ], pooledSmallTeams: null, spanOfControl: { managers: 40, ics: 160, ratio: 4.0, target: 6 } },
    employees: [{ ratio: 0.75 }, { ratio: 0.9 }, { ratio: 1.0 }, { ratio: null }],
    equity: { genderAvailable: true, gender: [{ flagged: true }, { flagged: false }], outliers: [{}, {}], tenure: [{}] },
  };
  const vs = buildVerdicts_(model, cfg);
  const byId = {};
  vs.forEach(v => { byId[v.id] = v; });

  check("verdicts: every verdict has fact + soWhat + view + severity",
    vs.length >= 10 && vs.every(v => v.fact && v.soWhat && v.view &&
      ["FACT", "NOTE", "RISK"].indexOf(v.severity) !== -1));
  check("verdicts: attr-total red → RISK with action",
    byId["attr-total"].severity === "RISK" && byId["attr-total"].action.length > 0);
  check("verdicts: regretted 50% of voluntary → RISK", byId["regretted"].severity === "RISK");
  check("verdicts: concentration names top-2 depts with counts",
    /Services/.test(byId["concentration"].fact) && /Sales/.test(byId["concentration"].fact) &&
    /35 of 40/.test(byId["concentration"].fact));
  check("verdicts: mgr-hotspots counts only, no manager names",
    /2/.test(byId["mgr-hotspots"].fact) && byId["mgr-hotspots"].fact.indexOf("A") !== 0 &&
    !/\bB\b/.test(byId["mgr-hotspots"].fact));
  check("verdicts: span 1:4.0 below target reads narrow", /4\.0?/.test(byId["span"].fact));
  check("verdicts: compa-below counts ratios under the low band", /1 /.test(byId["compa-below"].fact));
  check("verdicts: trends-drivers names Another Job and classifies labor-market/comp",
    /Another Job/.test(byId["trends-drivers"].fact) && /labor-market\/comp/.test(byId["trends-drivers"].soWhat));
  check("verdicts: financial includes released $ and coverage caveat",
    /500,000/.test(byId["financial"].fact) && /38 of 40/.test(byId["financial"].caveat));
  check("verdicts: forecast projects", /55/.test(byId["forecast"].fact));
  check("verdicts: deterministic — same input, same strings",
    JSON.stringify(buildVerdicts_(model, cfg)) === JSON.stringify(vs));

  // Sample-size guard: 2 exits on 200 heads → severity capped at NOTE + caveat
  const small = JSON.parse(JSON.stringify(model));
  small.attrition.currentFY = mkFY(2, 2, 2, 200); // 100% regretted but only 2 exits
  small.attrition.forecast = null;
  const vs2 = buildVerdicts_(small, cfg);
  const reg2 = vs2.find(v => v.id === "regretted");
  check("verdicts: sample guard caps regretted at NOTE with caveat",
    reg2.severity === "NOTE" && /too few/i.test(reg2.caveat));
  check("verdicts: missing forecast block → no forecast verdict",
    !vs2.find(v => v.id === "forecast"));
  const noMgr = JSON.parse(JSON.stringify(model));
  noMgr.managers = { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };
  check("verdicts: managers unavailable → no mgr-hotspots / span verdicts",
    !buildVerdicts_(noMgr, cfg).find(v => v.id === "mgr-hotspots" || v.id === "span"));
})();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `buildVerdicts_ is not defined`.

- [ ] **Step 3: Implement** — insert after `buildForecast_`:

```js
// ── Verdict engine (V3) ─────────────────────────────────────────────────────
// Rule-based, deterministic callouts: every verdict states fact → so-what →
// recommended action (action may be "" where none applies). Full-population
// only — client filters never recompute verdicts. Counts only, never names.
// Severity: FACT (healthy/neutral), NOTE (watch), RISK (act). Sample-size
// guard caps rate-based verdicts at NOTE with a caveat when the denominator
// is under cfg.RAG floors — FY-openers with 2 exits must never read as truth.

function pctV_(x, dp) { return x == null ? "—" : (x * 100).toFixed(dp == null ? 1 : 1) + "%"; }
function usdV_(x) { return x == null ? "—" : "$" + Math.round(x).toLocaleString("en-US"); }
function sevFromBand_(band) { return band === "red" ? "RISK" : band === "yellow" ? "NOTE" : "FACT"; }

function sampleGuard_(v, heads, exits, cfg) {
  const R = cfg.RAG;
  const tooFew = (heads != null && heads < R.floorHeads) || (exits != null && exits < R.floorExits);
  if (tooFew) {
    if (v.severity === "RISK") v.severity = "NOTE";
    v.caveat = ((v.caveat ? v.caveat + " " : "") +
      "Small sample (" + (exits != null ? exits + " exit" + (exits === 1 ? "" : "s") : heads + " heads") +
      ") — too few to read as a trend.").trim();
  }
  return v;
}

function buildVerdicts_(model, cfg) {
  const R = cfg.RAG, out = [];
  const A = model.attrition || {};
  const cur = A.currentFY, prevSp = A.previousFYSamePeriod;
  const fy = model.fyLabel || "";
  const push = v => { v.action = v.action || ""; v.caveat = v.caveat || ""; out.push(v); };

  // 1 — headcount stability (Overview strip)
  if (model.activeCount != null && model.hcFyStart != null && model.hcFyStart > 0) {
    const chg = (model.activeCount - model.hcFyStart) / model.hcFyStart;
    const word = Math.abs(chg) <= 0.02 ? "stable" : chg > 0 ? "growing" : "shrinking";
    push({
      id: "headcount", view: "overview", severity: "FACT",
      fact: "Headcount " + word + " at " + model.activeCount + " active (" + model.hcFyStart + " at " + fy + " start).",
      soWhat: word === "stable" ? "No structural size shift this FY."
        : "Net " + pctV_(Math.abs(chg)) + " " + (chg > 0 ? "growth" : "reduction") + " since " + fy + " start.",
    });
  }

  // 2 — total attrition vs RAG thresholds
  if (cur && cur.rate != null) {
    const band = ragBand_(cur.rate, R.attritionTotal);
    push(sampleGuard_({
      id: "attr-total", view: "attrition", severity: sevFromBand_(band), band,
      fact: fy + " total attrition " + pctV_(cur.rate) +
        (prevSp && prevSp.rate != null ? " (" + prevSp.label + " " + pctV_(prevSp.rate) + ")" : "") + ".",
      soWhat: band === "green" ? "Within the healthy band (≤ " + pctV_(R.attritionTotal.green) + ")."
        : band === "yellow" ? "In the watch band (" + pctV_(R.attritionTotal.green) + "–" + pctV_(R.attritionTotal.yellow) + ")."
        : "Above the at-risk line (> " + pctV_(R.attritionTotal.yellow) + ").",
      action: band === "red" ? "Review retention hotspots in the Managers view and department concentration this quarter." : "",
    }, cur.avgHeadcount, cur.total, cfg));
  }

  // 3 — voluntary attrition vs peer band
  if (cur && cur.avgHeadcount > 0) {
    const volRate = cur.vol / cur.avgHeadcount;
    const band = ragBand_(volRate, R.attritionVol);
    push(sampleGuard_({
      id: "attr-vol", view: "attrition", severity: sevFromBand_(band), band,
      fact: fy + " voluntary attrition " + pctV_(volRate) + " vs professional-services peers " +
        pctV_(R.peerVolBand.low) + "–" + pctV_(R.peerVolBand.high) + ".",
      soWhat: volRate > R.peerVolBand.high
        ? "Losing people faster than the peer set — a competitiveness signal, not just an internal one."
        : volRate < R.peerVolBand.low
          ? "Below the peer band — voluntary churn is not the current problem."
          : "Inside the peer band.",
      action: volRate > R.peerVolBand.high ? "Pair with the Market Gap view to check pay competitiveness in exit-heavy locations." : "",
    }, cur.avgHeadcount, cur.vol, cfg));
  }

  // 4 — regretted share of voluntary exits
  if (cur && cur.vol > 0) {
    const share = cur.regretted / cur.vol;
    const band = ragBand_(share, R.regrettedShare);
    push(sampleGuard_({
      id: "regretted", view: "attrition", severity: sevFromBand_(band), band,
      fact: pctV_(share) + " of " + fy + " voluntary exits were regretted (" + cur.regretted + " of " + cur.vol + ").",
      soWhat: band === "red" ? "We are losing people we wanted to keep — the costliest kind of attrition."
        : band === "yellow" ? "Regretted share is drifting above typical firms (15–35% of voluntary exits)."
        : "Most voluntary exits were not regretted — churn quality is acceptable.",
      action: band !== "green" ? "Run an exit-driver review with the HRBP; prioritize stay-interviews for at-risk high performers." : "",
    }, null, cur.vol, cfg));
  }

  // 5 — department concentration of exits
  if (cur && cur.total > 0 && A.slices && A.slices.department && A.slices.department.length >= 2) {
    const d = A.slices.department;
    const topTerms = d[0].terms + d[1].terms;
    const share = topTerms / cur.total;
    push({
      id: "concentration", view: "attrition",
      severity: share >= R.concentration ? "RISK" : "NOTE",
      fact: d[0].key + " and " + d[1].key + " carry " + topTerms + " of " + cur.total + " " + fy + " exits (" + pctV_(share) + ").",
      soWhat: share >= R.concentration
        ? "Exits are concentrated, not company-wide — the problem has an address."
        : "Exits are reasonably spread across departments.",
      action: share >= R.concentration ? "Focus retention actions on the concentrated departments rather than company-wide programs." : "",
    });
  }

  // 6 — manager hotspots (counts only — names live in the Managers table)
  if (model.managers && model.managers.available && model.managers.rows.length) {
    const hot = model.managers.rows.filter(r =>
      r.attritionRate != null && r.attritionRate > R.attritionTotal.yellow).length;
    push({
      id: "mgr-hotspots", view: "managers",
      severity: hot > 0 ? "RISK" : "FACT",
      fact: hot + " of " + model.managers.rows.length + " managers (3+ reports) carry team attrition above " + pctV_(R.attritionTotal.yellow) + ".",
      soWhat: hot > 0 ? "Exits cluster under specific managers — a manager-quality signal distinct from department-wide pressure."
        : "No team's attrition stands out beyond the at-risk line.",
      action: hot > 0 ? "Schedule skip-levels for the flagged teams this quarter (table below, worst first)." : "",
    });
  }

  // 7 — span of control
  if (model.managers && model.managers.available && model.managers.spanOfControl &&
      model.managers.spanOfControl.ratio != null) {
    const s = model.managers.spanOfControl;
    const wide = s.ratio > R.spanWide, narrow = s.ratio < R.spanNarrow;
    push({
      id: "span", view: "managers",
      severity: wide ? "RISK" : "NOTE",
      fact: "Span of control 1:" + s.ratio + " (" + s.managers + " managers · " + s.ics + " ICs) vs 1:" + s.target + " target.",
      soWhat: wide ? "Managers are stretched beyond the knowledge-work norm (6–8) — coaching capacity suffers."
        : narrow ? "Spans are narrow — more management layers than the work may need."
        : "Within the healthy 5–8 range for knowledge work.",
      action: wide ? "Review team sizes above 1:" + R.spanWide + " when planning the next org change." : "",
    });
  }

  // 8 — below-anchor pay positions (the CompDash "inversion-class" flag)
  if (model.employees && model.employees.length) {
    const low = model.employees.filter(e => e.ratio != null && e.ratio < cfg.COMPA_LOW_MIN).length;
    push({
      id: "compa-below", view: "compa",
      severity: low > 0 ? "RISK" : "FACT",
      fact: low + " Rocketeer" + (low === 1 ? " sits" : "s sit") + " below " + cfg.COMPA_LOW_MIN.toFixed(2) + " of their peer anchor.",
      soWhat: low > 0 ? "Pay positions this far below internal peers are retention and equity exposure."
        : "Nobody sits below the red internal-position band.",
      action: low > 0 ? "Review the flagged cases with the HRBP before the next comp cycle closes (Internal Position view, red chips)." : "",
    });
  }

  // 9 — equity flags
  if (model.equity) {
    const eq = model.equity;
    const flaggedGender = eq.genderAvailable ? eq.gender.filter(g => g.flagged).length : 0;
    const n = flaggedGender + eq.outliers.length + eq.tenure.length;
    push({
      id: "equity", view: "equity",
      severity: n > 0 ? "NOTE" : "FACT",
      fact: n + " equity flag" + (n === 1 ? "" : "s") + " open (" +
        (eq.genderAvailable ? flaggedGender + " gender-gap groups, " : "gender lens pending, ") +
        eq.outliers.length + " outliers, " + eq.tenure.length + " tenure).",
      soWhat: n > 0 ? "Each flag is a case to explain or correct — unexplained flags become audit findings."
        : "No equity flags at current thresholds.",
      action: n > 0 ? "Work the flag list in the Pay Equity view; document the rationale where the position is justified." : "",
    });
  }

  // 10 — trends & drivers (dominant exit reasons → driver classification)
  if (A.detail && A.detail.length) {
    const counts = {};
    A.detail.forEach(t => { const k = t.reason || "(no reason)"; counts[k] = (counts[k] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 2);
    const driverOf = reason => {
      const hit = (cfg.REASON_CLASS || []).find(rc => rc.re.test(reason));
      return hit ? hit.driver : "other";
    };
    const READ = {
      "labor-market/comp": "reads as a labor-market/comp pattern — people leaving for other jobs",
      "role-design/structural": "reads as a role-design/structural pattern — positions eliminated or contracts ended",
      "performance-managed": "reads as managed performance exits, not a retention failure",
      "personal": "reads as personal-circumstance exits, not a comp problem",
      "other": "has no dominant classified driver",
    };
    const domDriver = driverOf(top[0]);
    push({
      id: "trends-drivers", view: "attrition", severity: "NOTE",
      fact: "Top " + fy + " exit reasons: " + top.map(r => r + " (" + counts[r] + ")").join(", ") + ".",
      soWhat: "The dominant reason (" + domDriver + ") " + READ[domDriver] + ".",
      action: domDriver === "labor-market/comp"
        ? "Cross-check exit-heavy groups against Market Gap before concluding it is only the market." : "",
    });
  }

  // 11 — financial impact
  if (A.financialImpact && A.financialImpact.coverage.total > 0) {
    const fi = A.financialImpact;
    push({
      id: "financial", view: "attrition", severity: "NOTE",
      fact: fy + " exits released ~" + usdV_(fi.annualPayrollReleasedUsd) + " of FY payroll (regretted portion ~" + usdV_(fi.regrettedPortionUsd) + ").",
      soWhat: "The regretted portion is value lost, not savings — backfill and ramp costs land on top.",
      caveat: fi.coverage.counted < fi.coverage.total
        ? "Based on " + fi.coverage.counted + " of " + fi.coverage.total + " leavers (others missing TCC USD)." : "",
    });
  }

  // 12 — forecast
  if (A.forecast) {
    const band = ragBand_(A.forecast.annualizedRate, R.attritionTotal);
    push({
      id: "forecast", view: "attrition", severity: sevFromBand_(band), band,
      fact: "Full-year projection ~" + A.forecast.projectedTotal + " exits (~" + pctV_(A.forecast.annualizedRate) + ") via " + A.forecast.method + ".",
      soWhat: band === "red" ? "On the current pace the FY closes above the at-risk line."
        : band === "yellow" ? "On pace to close in the watch band."
        : "On pace to close within the healthy band.",
      action: band === "red" ? "Treat the projection as the planning number for backfill budget, not the year-to-date rate." : "",
    });
  }

  // 13 — FY-in-progress small-sample caveat (the "0.9% on 2 exits" rule)
  if (cur && cur.total < R.floorExits) {
    push({
      id: "fy-caveat", view: "overview", severity: "NOTE",
      fact: fy + " figures rest on " + cur.total + " exit" + (cur.total === 1 ? "" : "s") + " so far.",
      soWhat: "Too few to read — rates this early look dramatically healthy or dramatically bad by accident.",
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS — previous count + 14 new checks.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): rule-based verdict engine with sample-size guard (13 rules)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Payload wiring — `getCompReportData` + meta + debug

**Files:**
- Modify: `CompDash/Code.js` — `getCompReportData` (~lines 953-1095), `debugCompPipeline` (~line 1113), header `VERSION` (line 5)

No new Node checks (GAS assembly), but the full suite must still pass — the pure functions are exercised through their own tasks.

- [ ] **Step 1: Capture the supervisor flag.** In `getCompReportData`, the roster try-block (~line 976) — add alongside the existing flags:

```js
  let records = [], genderAvailable = false, tccUsdAvailable = false, supervisorAvailable = false;
  try {
    const r = readRosterCD_();
    records = r.records;
    genderAvailable = r.genderAvailable;
    tccUsdAvailable = r.tccUsdAvailable;
    supervisorAvailable = r.supervisorAvailable;
  } catch (e) {
```

- [ ] **Step 2: Build the V3 blocks.** After the `history` block is built (~line 1052) and before `const payload = {`, insert:

```js
  // ── V3 blocks — all full-population, deterministic, cached with the payload ──
  const ragCfg = ragCfg_();
  const cfgV3 = Object.assign({}, CONFIG_CD, { RAG: ragCfg });
  const attrition = buildAttrition_(records, ctx);
  attrition.financialImpact = buildFinancialImpact_(records, ctx);
  attrition.forecast = buildForecast_(attrition.currentFY, attrition.previousFY, ctx, cfgV3);
  const managers = supervisorAvailable
    ? buildManagers_(records, ctx, cfgV3)
    : { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };
  const equity = buildEquity_(active, CONFIG_CD, ctx.asOf);
  const verdicts = buildVerdicts_({
    fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel,
    activeCount: active.length, hcFyStart: headcountOn_(records, ctx.fyStart),
    attrition, managers, employees, equity,
  }, cfgV3);
```

- [ ] **Step 3: Rewire the payload object.** The existing payload builds `attrition: buildAttrition_(records, ctx)` and `equity: buildEquity_(...)` inline (~lines 1083-1085) — replace those two lines with the prebuilt consts, and add the new top-level blocks:

```js
    attrition,
    managers,
    verdicts,
    compaGroups,
    equity,
```

- [ ] **Step 4: Extend `meta`.** Inside the `meta: {` object, after `equityCfg: {...},` (~line 1079), add:

```js
      supervisorAvailable,
      ragCfg: Object.assign({}, ragCfg, {
        mgrMinReports: CONFIG_CD.MGR_MIN_REPORTS,
        forecastMinMonths: CONFIG_CD.FORECAST_MIN_MONTHS,
      }),
      benchmarks: { sources: CONFIG_CD.BENCH_SOURCES },
      glossary: CONFIG_CD.GLOSSARY,
```

- [ ] **Step 5: Bump the file header.** Line 5: `// VERSION:     1.2.0` and append to the header comment block: `// V3 (2026-07-27): managers, verdicts, forecast, financial impact, RAG config — spec 2026-07-27-compdash-v3-exec-feedback-design.md`.

- [ ] **Step 6: Extend `debugCompPipeline`** — append at the end of the function:

```js
  const ctxDbg = fiscalContextCD_();
  const cfgDbg = Object.assign({}, CONFIG_CD, { RAG: ragCfg_() });
  const mgrDbg = buildManagers_(active.concat(r.records.filter(x => !x.active)), ctxDbg, cfgDbg);
  Logger.log("Managers: " + (mgrDbg.available
    ? mgrDbg.rows.length + " rows (≥" + CONFIG_CD.MGR_MIN_REPORTS + " reports)" +
      (mgrDbg.pooledSmallTeams ? " + pooled " + mgrDbg.pooledSmallTeams.pooledManagers + " small teams" : "") +
      " · span 1:" + (mgrDbg.spanOfControl ? mgrDbg.spanOfControl.ratio : "—")
    : "UNAVAILABLE (no Supervisor values)"));
  const attrDbg = buildAttrition_(r.records, ctxDbg);
  attrDbg.financialImpact = buildFinancialImpact_(r.records, ctxDbg);
  attrDbg.forecast = buildForecast_(attrDbg.currentFY, attrDbg.previousFY, ctxDbg, cfgDbg);
  Logger.log("Financial impact: " + attrDbg.financialImpact.annualPayrollReleasedUsd +
    " USD released, coverage " + attrDbg.financialImpact.coverage.counted + "/" + attrDbg.financialImpact.coverage.total);
  Logger.log("Forecast: " + (attrDbg.forecast
    ? "~" + attrDbg.forecast.projectedTotal + " exits (" + attrDbg.forecast.method + ")"
    : "omitted (needs ≥" + CONFIG_CD.FORECAST_MIN_MONTHS + " actual months)"));
```

Note: `debugCompPipeline` already holds `r` from `readRosterCD_()` at its top — no re-read.

- [ ] **Step 7: Run the full suite (regression)**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS, same counts as after Task 6.

- [ ] **Step 8: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): wire managers/verdicts/forecast/financial into payload + meta echoes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Client foundation — VIEWS entry, RAG + verdict helpers

**Files:**
- Modify: `CompDash/ViewDash.html` — `VIEWS` array (~line 116), helpers section (~line 190), `RENDERERS` map (~line 790)

- [ ] **Step 1: Add the Managers tab to `VIEWS`** after the `attrition` entry (line 119):

```js
  { id: "managers",  label: "👤 Managers",            roles: ["admin", "viewer"] },
```

- [ ] **Step 2: Add client helpers** after `ratioBarColor` (~line 199):

```js
// MIRROR of ragBand_ in Code.js (3-line band classifier) — keep in sync.
function ragBandC(value, bands) {
  if (value == null || !bands) return null;
  return value <= bands.green ? "green" : value <= bands.yellow ? "yellow" : "red";
}
// Colored status dot + value. band null → plain value.
function ragDot(band, text) {
  const col = band === "green" ? "var(--accent)" : band === "yellow" ? "var(--warn)" :
              band === "red" ? "var(--bad)" : "var(--muted)";
  return '<span style="color:' + col + '">●</span> ' + text;
}
// Trend arrow vs a prior-basis value (±0.5pp dead zone). Direction only —
// the RAG dot carries the judgment. Empty string when either basis is missing.
function trendArrow(cur, prev) {
  if (cur == null || prev == null) return "";
  const d = cur - prev;
  return Math.abs(d) < 0.005 ? " →" : d > 0 ? " ▲" : " ▼";
}
// One verdict line: severity → fact → so-what → action → caveat.
function verdictHtml(v) {
  const col = v.severity === "RISK" ? "var(--bad)" : v.severity === "NOTE" ? "var(--warn)" : "var(--accent)";
  return '<div style="border-left:3px solid ' + col + ';padding:5px 10px;margin:0 0 8px">' +
    '<b style="color:' + col + '">' + esc(v.severity) + '</b> — ' + esc(v.fact) +
    (v.soWhat ? ' <i class="sub">' + esc(v.soWhat) + '</i>' : '') +
    (v.action ? ' <b>→ ' + esc(v.action) + '</b>' : '') +
    (v.caveat ? ' <span class="sub">⚠ ' + esc(v.caveat) + '</span>' : '') + '</div>';
}
// All verdicts for a view, in payload order.
function verdictsFor(view) {
  return ((STATE.data && STATE.data.verdicts) || []).filter(v => v.view === view);
}
```

- [ ] **Step 3: Register the renderer.** In the `RENDERERS` map (~line 790) add `managers: renderManagers,` after `attrition: renderAttrition,` — and add a stub so the file stays loadable until Task 10:

```js
function renderManagers(el) { el.innerHTML = '<div class="card sub">👤 Managers view — building…</div>'; }
```

(Task 10 replaces this stub in full.)

- [ ] **Step 4: Syntax check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 5: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): client V3 foundation — Managers tab entry, RAG/verdict/trend helpers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Overview — exec TL;DR strip (verdict paragraph + RAG chip row)

**Files:**
- Modify: `CompDash/ViewDash.html` — `renderOverview` (~lines 381-427)

- [ ] **Step 1: Add the strip builder** directly above `renderOverview`:

```js
// Exec TL;DR strip — verdict paragraph + click-through RAG chips. Always
// FULL-population (verdicts are server facts); a suffix notes active filters.
// Paragraph order is fixed so it always reads like an executive summary.
const STRIP_ORDER = ["headcount", "attr-total", "attr-vol", "regretted", "concentration",
                     "compa-below", "mgr-hotspots", "equity", "fy-caveat"];
function execStripHtml(d) {
  const byId = {};
  (d.verdicts || []).forEach(v => { byId[v.id] = v; });
  const sentences = STRIP_ORDER.map(id => byId[id]).filter(Boolean)
    .map(v => v.fact + (v.action ? " — " + v.action : ""));
  if (!sentences.length) return "";

  const rag = d.meta.ragCfg || {};
  const cur = d.attrition.currentFY, prevSp = d.attrition.previousFYSamePeriod;
  const volRate = cur.avgHeadcount > 0 ? cur.vol / cur.avgHeadcount : null;
  const regShare = cur.vol > 0 ? cur.regretted / cur.vol : null;
  const prevVolRate = (prevSp && prevSp.avgHeadcount > 0) ? prevSp.vol / prevSp.avgHeadcount : null;
  const prevRegShare = (prevSp && prevSp.vol > 0) ? prevSp.regretted / prevSp.vol : null;
  const below = d.employees.filter(e => e.ratio != null && e.ratio < (d.meta.compaBands || {}).low).length;
  const eq = d.equity;
  const eqFlags = (eq.genderAvailable ? eq.gender.filter(g => g.flagged).length : 0) +
    eq.outliers.length + eq.tenure.length;
  const chips = [
    { t: "Headcount " + d.meta.activeCount, band: null, tab: "overview" },
    { t: "Attrition " + pctFmt(cur.rate) + trendArrow(cur.rate, prevSp ? prevSp.rate : null),
      band: ragBandC(cur.rate, rag.attritionTotal), tab: "attrition" },
    { t: "Voluntary " + pctFmt(volRate) + trendArrow(volRate, prevVolRate),
      band: ragBandC(volRate, rag.attritionVol), tab: "attrition" },
    { t: "Regretted " + pctFmt(regShare) + trendArrow(regShare, prevRegShare),
      band: ragBandC(regShare, rag.regrettedShare), tab: "attrition" },
    { t: below + " below anchor", band: below > 0 ? "red" : "green", tab: "compa" },
    { t: eqFlags + " equity flags", band: eqFlags > 0 ? "yellow" : "green", tab: "equity" },
  ];
  if (d.managers && d.managers.available) {
    const hot = d.managers.rows.filter(r =>
      r.attritionRate != null && r.attritionRate > (rag.attritionTotal || {}).yellow).length;
    chips.push({ t: hot + " mgr hotspots", band: hot > 0 ? "red" : "green", tab: "managers" });
  }
  return '<div class="card">' +
    '<h2>' + esc(d.meta.fyLabel) + ' in one paragraph' +
    (filtersActive() ? ' <span class="sub">(company-wide — filters don&#39;t apply here)</span>' : '') + '</h2>' +
    '<p style="margin:0 0 10px">' + sentences.map(esc).join(" ") + '</p>' +
    '<div>' + chips.map(c =>
      '<span class="chip" style="cursor:pointer" onclick="switchTab(\'' + c.tab + '\')">' +
      ragDot(c.band, esc(c.t)) + '</span>').join("") + '</div></div>';
}
```

- [ ] **Step 2: Render it first in Overview.** In `renderOverview`, change the final assignment (`el.innerHTML = '<div class="kpi-grid">' + …`) to prepend the strip:

```js
  el.innerHTML =
    execStripHtml(d) +
    '<div class="kpi-grid">' + cards.map(c =>
```

(the rest of the expression is unchanged).

- [ ] **Step 3: Syntax check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): Overview exec TL;DR strip — verdict paragraph + click-through RAG chips

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Managers view — table-first renderer

**Files:**
- Modify: `CompDash/ViewDash.html` — replace the Task 8 `renderManagers` stub

Filter behavior (decided in design): Department filter and name search apply to manager rows; Location/Level filters do not (manager rows have no single location/level) — a sub-note says so when they're active.

- [ ] **Step 1: Replace the stub with the full renderer:**

```js
function renderManagers(el) {
  const d = STATE.data, m = d.managers;
  if (!m || !m.available) {
    el.innerHTML = '<div class="banner">👤 <b>Manager data unavailable</b> — the roster extract has no Supervisor values. The view activates automatically when the column lands.</div>';
    return;
  }
  const rag = d.meta.ragCfg || {};
  const f = STATE.filters;
  const rows = m.rows.filter(r =>
    (!f.dept || r.dept === f.dept) &&
    (!f.q || normName(r.name).indexOf(normName(f.q)) !== -1));
  const ignored = (f.loc || f.level)
    ? '<div class="sub" style="margin-bottom:8px">Location/Level filters don&#39;t apply to manager rows (teams span both).</div>' : '';
  const tr = (r, pooled) =>
    '<tr' + (pooled ? '' : ' class="click" onclick="setFilter(\'q\', \'\'); openMgrTeam(\'' + esc(r.name) + '\')"') + '>' +
    '<td>' + esc(r.name) + (pooled ? ' <span class="sub">(' + r.pooledManagers + ' managers pooled — sample-size rule)</span>' : '') + '</td>' +
    '<td>' + r.teamSize + '</td><td>' + r.exitsFY + '</td><td>' + r.voluntaryExits + '</td>' +
    '<td>' + ragDot(ragBandC(r.attritionRate, rag.attritionTotal), pctFmt(r.attritionRate)) + '</td>' +
    '<td>' + esc(r.dept) + '</td></tr>';
  const span = m.spanOfControl;
  el.innerHTML =
    verdictsFor("managers").map(verdictHtml).join("") + ignored +
    '<div class="card"><h2>👤 Team attrition by manager <span class="sub">(' + d.meta.fyLabel +
    ' · managers with ' + (rag.mgrMinReports || 3) + '+ reports · worst first)</span></h2>' +
    '<table><tr><th>Manager</th><th>Team size</th><th>FY exits</th><th>Voluntary</th><th>Team attrition</th><th>Department</th></tr>' +
    rows.map(r => tr(r, false)).join("") +
    (m.pooledSmallTeams ? tr(m.pooledSmallTeams, true) : "") +
    '</table>' +
    (span ? '<div class="sub" style="margin-top:8px">Span of control: <b>1:' + span.ratio + '</b> (' +
      span.managers + ' managers · ' + span.ics + ' ICs) vs 1:' + span.target + ' target.</div>' : '') +
    '</div>';
}
// Row click → reuse the universal search filter to scope every view to that
// manager's people, then jump to Attrition for the detail. No new drill code.
function openMgrTeam(name) {
  alert("Tip: use the Attrition tab's termination detail and the search box to inspect " + name + "'s team. Scoping filters to a supervisor is a V-next item.");
}
```

**Note:** the employee payload does not carry `supervisor` (kept out to hold payload size; drill-by-team is in the roadmap backlog). The row click therefore shows a pointer, not a broken filter. If the executing engineer prefers, dropping `openMgrTeam` and the `click` class entirely (plain rows) is an acceptable simplification — do NOT invent a supervisor filter that the payload cannot honor.

- [ ] **Step 2: Syntax check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 3: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): Managers view — table-first team attrition, pooled small teams, span line

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Attrition view enrichment — verdicts, forecast, peer band, financial line, RAG

**Files:**
- Modify: `CompDash/ViewDash.html` — `attritionChart` (~lines 213-234), `renderAttrition` (~lines 428-478)

- [ ] **Step 1: Extend `attritionChart` with forecast + peer band.** Replace the whole function with:

```js
// Previous FY as a shadow area, current FY as a trend line cut at the current
// fiscal month (uptoIdx). V3: optional dashed forecast extension and a subtle
// peer-band zone (annual voluntary rate mapped to monthly-equivalent counts:
// rate × avgHeadcount ÷ 12 — like-for-like with the monthly series).
function attritionChart(prevSeries, curSeries, labels, uptoIdx, w, h, opts) {
  opts = opts || {};
  const P = 26, n = labels.length;
  const prevV = prevSeries.map(m => m.terms);
  const curV = curSeries.map(m => m.terms);
  const fcV = (opts.forecastMonths || []).map(m => m.terms);
  const maxY = Math.max.apply(null, prevV.concat(curV, fcV, [1]));
  const x = i => P + i * ((w - P - 6) / Math.max(1, n - 1));
  const y = v => h - 18 - v / maxY * (h - 30);
  const area = prevV.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ") +
    " " + x(n - 1).toFixed(1) + "," + y(0).toFixed(1) + " " + x(0).toFixed(1) + "," + y(0).toFixed(1);
  const cut = Math.max(0, Math.min(uptoIdx, n - 1));
  const line = curV.slice(0, cut + 1).map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  let band = "";
  if (opts.bandLo != null && opts.bandHi != null) {
    band = '<rect x="' + P + '" y="' + y(opts.bandHi).toFixed(1) + '" width="' + (w - P - 6) +
      '" height="' + Math.max(1, y(opts.bandLo) - y(opts.bandHi)).toFixed(1) +
      '" fill="var(--cta)" opacity="0.12"/>';
  }
  let fc = "";
  if (opts.forecastMonths && opts.forecastMonths.length && cut < n - 1) {
    const pts = [x(cut).toFixed(1) + "," + y(curV[cut]).toFixed(1)]
      .concat(opts.forecastMonths.filter(m => m.forecast && m.idx < n).map(m =>
        x(m.idx).toFixed(1) + "," + y(m.terms).toFixed(1)));
    fc = '<polyline points="' + pts.join(" ") + '" fill="none" stroke="var(--accent)" ' +
      'stroke-width="2" stroke-dasharray="5,4" opacity="0.8"/>';
  }
  const ticks = labels.map((L, i) =>
    (n <= 4 || i % 3 === 0 || i === n - 1)
      ? '<text x="' + x(i).toFixed(1) + '" y="' + (h - 4) + '" text-anchor="middle">' + esc(L) + '</text>'
      : "").join("");
  const yTicks = [0, Math.ceil(maxY / 2), maxY].map(v =>
    '<text x="2" y="' + (y(v) + 3).toFixed(1) + '">' + v + '</text>').join("");
  return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
    band +
    '<polygon points="' + area + '" fill="var(--chip)" opacity="0.75"/>' +
    '<polyline points="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' +
    fc + ticks + yTicks + '</svg>';
}
```

- [ ] **Step 2: Enrich `renderAttrition`.** Replace the function body's `el.innerHTML = …` assignment (keep everything above it unchanged) with:

```js
  const rag = d.meta.ragCfg || {};
  const fullCur = a.currentFY; // verdicts/forecast/impact are full-population blocks
  const band = rag.peerVolBand || null;
  const chartOpts = (isM && !act) ? {
    forecastMonths: (a.forecast && a.forecast.months) || [],
    bandLo: band && fullCur.avgHeadcount > 0 ? band.low * fullCur.avgHeadcount / 12 : null,
    bandHi: band && fullCur.avgHeadcount > 0 ? band.high * fullCur.avgHeadcount / 12 : null,
  } : {};
  const volRate = fullCur.avgHeadcount > 0 ? fullCur.vol / fullCur.avgHeadcount : null;
  const fi = a.financialImpact;
  const vs = verdictsFor("attrition");
  const vOrder = ["concentration", "attr-total", "attr-vol", "regretted", "trends-drivers", "forecast", "financial"];
  const vSorted = vOrder.map(id => vs.find(v => v.id === id)).filter(Boolean);
  const filteredNote = act
    ? '<div class="sub" style="margin-bottom:8px">Verdicts, forecast and financial impact are company-wide facts — the chart and tables below reflect your filters.</div>' : '';

  el.innerHTML =
    sourceBanner("roster", "Roster data") +
    vSorted.map(verdictHtml).join("") + filteredNote +
    '<div class="card"><h2>' + esc(cur.label) + ' vs ' + esc(prev.label) + ' terminations</h2>' +
    '<div class="seg" style="margin-bottom:10px">' +
      '<button onclick="setAttrGran(\'month\')" class="' + (isM ? "on" : "") + '">Month</button>' +
      '<button onclick="setAttrGran(\'quarter\')" class="' + (!isM ? "on" : "") + '">Quarter</button></div>' +
    attritionChart(isM ? prev.monthly : prev.quarterly, isM ? cur.monthly : cur.quarterly, labels, upto, 720, 190, chartOpts) +
    '<div class="sub">Shadow area = ' + esc(prev.label) + ' · line = ' + esc(cur.label) + ' to date' +
    (chartOpts.forecastMonths && chartOpts.forecastMonths.length ? ' · dashed = full-year projection' : '') +
    (chartOpts.bandLo != null ? ' · shaded zone = peer voluntary band ' + pctFmt(band.low, 0) + '–' + pctFmt(band.high, 0) + ' (monthly equivalent)' : '') + '</div>' +
    '<div style="margin-top:10px">' +
      '<span class="chip">' + cur.total + ' terminations ' + esc(cur.label) + '</span>' +
      '<span class="chip green">' + cur.vol + ' voluntary</span>' +
      '<span class="chip yellow">' + cur.invol + ' involuntary</span>' +
      '<span class="chip">' + ragDot(ragBandC(cur.total ? cur.regretted / Math.max(1, cur.vol) : null, rag.regrettedShare),
        (cur.vol ? Math.round(cur.regretted / cur.vol * 100) : 0) + '% of voluntary regretted') + '</span>' +
      '<span class="chip">' + ragDot(ragBandC(cur.rate, rag.attritionTotal),
        'total ' + pctFmt(cur.rate) + ' vs healthy ≤ ' + pctFmt((rag.attritionTotal || {}).green, 0)) + '</span>' +
      '<span class="chip">' + ragDot(ragBandC(volRate, rag.attritionVol),
        'voluntary ' + pctFmt(volRate) + ' vs peers ' + (band ? pctFmt(band.low, 0) + '–' + pctFmt(band.high, 0) : '—')) + '</span>' +
    '</div>' +
    (fi && fi.coverage.total > 0
      ? '<div class="sub" style="margin-top:8px">💰 ' + esc(cur.label) + ' exits released ~$' +
        fi.annualPayrollReleasedUsd.toLocaleString() + ' of FY payroll (regretted ~$' +
        fi.regrettedPortionUsd.toLocaleString() + ') · method: leaver TCC USD ÷ 12 × months remaining · based on ' +
        fi.coverage.counted + ' of ' + fi.coverage.total + ' leavers</div>' : '') +
    '</div>' +
    '<div class="card"><h2>Breakdown</h2>' +
    '<select onchange="setAttrDim(this.value)">' +
      Object.keys(dimLabel).map(k =>
        '<option value="' + k + '"' + (k === dim ? " selected" : "") + '>By ' + dimLabel[k] + '</option>').join("") +
    '</select>' +
    '<table><tr><th>' + esc(dimLabel[dim]) + '</th><th>Headcount</th><th>Terms</th><th>Voluntary</th><th>Involuntary</th><th>Rate</th></tr>' +
    slices.map(s =>
      '<tr><td>' + esc(s.key) + '</td><td>' + s.headcount + '</td><td>' + s.terms + '</td><td>' + s.vol +
      '</td><td>' + s.invol + '</td><td>' + ragDot(ragBandC(s.rate, rag.attritionTotal), pctFmt(s.rate)) +
      (s.headcount < (rag.floorHeads || 10) ? ' <span class="chip yellow" title="Small group — rate is noisy">⚠</span>' : '') +
      '</td></tr>').join("") + '</table>' +
    '<details><summary>Termination detail — ' + detail.length + ' rows (names inside)</summary>' +
    '<table><tr><th>Date</th><th>Name</th><th>Dept</th><th>Level</th><th>Location</th><th>Type</th><th>Regretted</th><th>Reason</th></tr>' +
    detail.map(t =>
      '<tr><td>' + esc(t.termDate) + '</td><td>' + esc(t.name) + '</td><td>' + esc(t.dept) + '</td><td>' + esc(t.level) +
      '</td><td>' + esc(t.keyLocation) + '</td><td>' + esc(t.cls) + '</td><td>' + (t.regretted ? "⚠️ yes" : "no") +
      '</td><td>' + esc(t.reason) + '</td></tr>').join("") + '</table></details></div>';
```

Notes for the engineer:
- The exit-**location** cut the feedback asked for is the existing "By Key Location" option in the Breakdown selector — now RAG-colored like every dim. No server change was needed (`slices.keyLocation` already existed).
- Forecast + peer band draw only in Month granularity on the **unfiltered** view (they're full-population, monthly-count-space overlays).
- `pctFmt(x, 0)` already exists (second arg = decimal places).

- [ ] **Step 3: Syntax check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): Attrition view V3 — verdicts, forecast overlay, peer band, financial line, RAG everywhere

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Data Reference — glossary + threshold provenance

**Files:**
- Modify: `CompDash/ViewDash.html` — `renderReference` (~lines 730-758)

- [ ] **Step 1: Append two sections.** Inside `renderReference`, before the closing `'…Cache TTL 65 minutes.</p></div>';` — change that final fragment to continue with:

```js
    ' Cache TTL 65 minutes.</p>' +
    '<h3>Glossary</h3><table><tr><th>Term</th><th>Meaning</th></tr>' +
    (m.glossary || []).map(g =>
      '<tr><td><b>' + esc(g.term) + '</b></td><td>' + esc(g.def) + '</td></tr>').join("") + '</table>' +
    '<h3>RAG thresholds & benchmark provenance</h3>' +
    (function () {
      const r = m.ragCfg || {};
      const row = (label, bands, note) => bands
        ? '<tr><td><b>' + label + '</b></td>' +
          '<td><span style="color:var(--accent)">≤ ' + (bands.green * 100).toFixed(0) + '%</span></td>' +
          '<td><span style="color:var(--warn)">≤ ' + (bands.yellow * 100).toFixed(0) + '%</span></td>' +
          '<td><span style="color:var(--bad)">above</span></td><td class="sub">' + esc(note) + '</td></tr>'
        : "";
      return '<table><tr><th>Metric</th><th>Green</th><th>Yellow</th><th>Red</th><th>Note</th></tr>' +
        row("Total attrition", r.attritionTotal, "Mercer 2025 + SPI center total attrition at ~11–14%") +
        row("Voluntary attrition", r.attritionVol, "SHRM 2025 median voluntary is 9%") +
        row("Regretted share (of voluntary)", r.regrettedShare, "Typical firms run 15–35% (Umbrex)") +
        (r.peerVolBand ? '<tr><td><b>Peer voluntary band</b></td><td colspan="3">' +
          (r.peerVolBand.low * 100).toFixed(0) + '–' + (r.peerVolBand.high * 100).toFixed(0) +
          '%</td><td class="sub">Professional-services peer set; BPO-adjacent roles run higher</td></tr>' : "") +
        '<tr><td><b>Span of control</b></td><td colspan="3">target 1:' + (r.spanTarget || 6) +
          ' · narrow &lt; ' + (r.spanNarrow || 4) + ' · overload &gt; ' + (r.spanWide || 10) +
          '</td><td class="sub">Knowledge-work norm 6–8 (Visier, McKinsey)</td></tr>' +
        '<tr><td><b>Sample-size floors</b></td><td colspan="3">&lt; ' + (r.floorHeads || 10) +
          ' heads or &lt; ' + (r.floorExits || 3) + ' exits</td><td class="sub">Rates under the floor get a ⚠ caveat and never render as RISK</td></tr>' +
        '</table>' +
        '<p class="sub">Sources: ' + ((m.benchmarks && m.benchmarks.sources) || []).map(esc).join(" · ") +
        '. Every value is configuration (CONFIG_CD.RAG) overridable via the <b>CD_RAG_CFG</b> Script Property — this table always shows the live values.</p>';
    })() + '</div>';
```

- [ ] **Step 2: Syntax check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 3: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): Data Reference glossary + RAG threshold provenance with sources

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Roadmap draft doc (Confluence-paste-friendly)

**Files:**
- Create: `docs/superpowers/specs/2026-07-27-comp-health-roadmap.md`

- [ ] **Step 1: Write the file** with exactly this content:

```markdown
# Comp Health Dashboard — Roadmap & Idea Backlog

*Living backlog for the Rocketeer Global Comp Health Report (CompDash). Sorted from the 2026.W30 exec feedback on the Global Compensation Health Report. Execs with dashboard access: add ideas and comments here.*

## ✅ Already shipped (V2, 2026.W30)

| Item | Where it lives |
|---|---|
| Color-coded internal position bands (red/yellow/green/violet) | ⚖️ Internal Position |
| Attrition view: voluntary/involuntary/regretted, dept/level/location cuts, FY-vs-FY chart | 📉 Attrition |
| Pay equity lenses (gender gap, outliers, long-tenure-low-pay) | 🧭 Pay Equity |
| External market positioning (TCC vs P25/Mean/P75, raise suggestions) | 🌍 Market Gap |
| Priority ranking (perf × tenure × compa-gap composite) | 🎯 Priority Ranking |

## 🔨 Shipping now (V3 — this iteration)

| Item | Note |
|---|---|
| Action-oriented callouts (fact → so-what → recommended action) | Rule-based, deterministic — no AI |
| Executive TL;DR paragraph + RAG chip row on Overview | The "reader who won't get past page one" fix |
| Manager-level attrition view (3+ reports, pooled small teams) | Supervisor field confirmed in roster |
| Span of control vs target | 1:6 target, knowledge-work norm 5–8 |
| Exit-location cut RAG-colored | Already computed; now judged, not just listed |
| External benchmark line (peer voluntary band 11–15%) | Sources cited in Data Reference |
| Attrition financial impact ($ payroll released, regretted portion) | Ported from termination-analysis |
| FY attrition forecast (trend × seasonality) | Needs ≥6 actual months |
| Sample-size caveats everywhere | Kills the "0.9% on 2 exits looks great" trap |
| Glossary (levels, JF codes, metric terms) + threshold provenance | 📊 Data Reference |

## 📋 Backlog (V-next — needs data, decision, or a bigger lift)

| Item | Blocker / note |
|---|---|
| Share the Fruit (STF) bonus metrics: participation, payout by year/location/level, % of TCC | STF data not in current sources |
| Pay equity by protected class (banding by demographic group) | Most-scrutinized cut; needs careful method + demographic data quality |
| External market positioning vs updated bands (percentile-vs-market) | Bands not refreshed yet |
| Pay-for-performance linkage (raises vs SI ratings) | Ratings already joined — needs an adjustment-event × rating cut |
| Internal promotion rate (promotions ÷ positions filled) | Needs external-hire counts |
| Workforce distribution chart (Regular/EOR/Part-Time/interns) | Data exists in roster scope notes |
| TCC mix + YoY TCC growth (base/variable/STF) once STF lands | Depends on STF item |
| Revenue per FTE | Needs finance revenue data |
| Total workforce cost incl. crew/contractors summary line | Board-view item; crew correctly excluded from comp-health math |
| Forward-looking comp-cycle spend / budget-vs-actual | Board-view item |
| Manager-team drill (click a manager → scoped views) | Payload doesn't carry supervisor per employee yet |
| Themed 4-section restructure (Headcount / Movement / Reward / Equity) | Parked by exec feedback; revisit at V4 |

## Parking lot

- One-page printable board scorecard export.
- Multi-quarter trend lines beyond the FY-vs-FY pair (attrition, TCC growth over 4–6 quarters).
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-27-comp-health-roadmap.md
git commit -m "docs(compdash): comp health roadmap draft — shipped / V3 / backlog / parking lot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Deploy notes, final regression, wrap-up

**Files:**
- Modify: `CompDash/PROCESS.md` (append deploy section)

- [ ] **Step 1: Append to `PROCESS.md`:**

```markdown
## V3 deploy (2026-07-27 — exec feedback absorption)

Spec: `docs/superpowers/specs/2026-07-27-compdash-v3-exec-feedback-design.md`
Plan: `docs/superpowers/plans/2026-07-27-compdash-v3-exec-feedback.md`

1. Paste `Code.js` + `ViewDash.html` into the GAS project (Security.js unchanged).
2. Run `debugCompPipeline()` — confirm the new log lines: Supervisor column FOUND,
   Managers rows, Financial impact coverage, Forecast status.
3. Run `bustCompCache_()` — **required** (payload adds managers/verdicts/forecast/
   financialImpact/previousFYSamePeriod + meta.ragCfg/glossary/benchmarks).
4. Publish a **new deployment version** (file save alone keeps serving old code).
5. Optional: set `CD_RAG_CFG` Script Property (JSON) to override any threshold, e.g.
   `{"peerVolBand":{"low":0.10,"high":0.16},"spanTarget":7}`.
6. Grant Rob/Forest viewer access via 🔒 Access Control when ready.

V3 behaviors to spot-check live: exec strip paragraph on Overview; 👤 Managers tab
(worst-first, pooled small-teams row, span line); Attrition dashed forecast + shaded
peer band (Month view, no filters); financial line under the chart; RAG dots on the
Breakdown rate column; Data Reference glossary + threshold table with sources.
Known degradations by design: no Supervisor values → Managers tab notice; <6 actual
FY months → no forecast; missing TCC USD rows → financial coverage note.
```

- [ ] **Step 2: Full regression**

Run: `node CompDash/tests/run_tests.js && node CompDash/tests/parse_html.js`
Expected: all checks PASS (Tasks 1–6 added ~43 checks), `✅ ViewDash.html script parses`.

- [ ] **Step 3: Commit**

```bash
git add CompDash/PROCESS.md
git commit -m "docs(compdash): V3 deploy runbook — cache bust required, CD_RAG_CFG overrides, QA list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Spec coverage map (self-review)

| Spec section | Task(s) |
|---|---|
| §1.1 Supervisor read + graceful absence | 2, 7 |
| §1.2 managers payload | 3, 7 |
| §1.2 byExitLocation | 11 (existing `slices.keyLocation` + RAG — no new server block needed) |
| §1.2 financialImpact | 4, 7 |
| §1.2 forecast + guard | 5, 7 |
| §1.2 meta additions (ragCfg/benchmarks/glossary) | 1, 7 |
| §2 verdict engine, sample guard, no-names, determinism, missing-block silence | 6 |
| §3.1 Overview exec strip (paragraph + chips + trend arrows w/ prior-FY same-period basis) | 5 (basis), 9 |
| §3.2 Managers tab | 8, 10 |
| §3.3 Attrition enrichment (concentration first, forecast dashed, peer band, benchmark text like-for-like, financial line, location RAG, trends & drivers) | 6 (verdict text), 11 |
| §3.4 RAG everywhere + caveat chips | 9, 10, 11 |
| §3.5 Data Reference glossary + provenance | 1 (content), 12 |
| §5 config thresholds + CD_RAG_CFG override + citations | 1, 2, 12 |
| §6 roadmap draft | 13 |
| §7 error handling (missing supervisor / <6 months / no-TCC coverage / silent rules / floors) | 2, 3, 4, 5, 6, 10 |
| §8 testing | 1, 3, 4, 5, 6 (43 new checks) + parse_html on every client task |
| §9 deploy | 14 |

**Deviations from spec (all surfaced during planning):** (a) exit-by-location renders through the existing Breakdown selector with RAG rather than a second dedicated table — same data, judged, zero payload growth; (b) manager row click is a pointer note, not a team-scoped drill, because `employees[]` doesn't carry supervisor (added to roadmap backlog); (c) Overview chips include a "mgr hotspots" chip beyond the spec's list — it's the cheapest click-through to the new tab.
