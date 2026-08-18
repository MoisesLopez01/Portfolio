# Comp Health P0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the CompDash monoliths into nine deployable files, guard against half-pasted deploys, delete six dead routes, and refine the theme — with zero change to any number the dashboard reports.

**Architecture:** `Code.js` (2178 lines) splits into four server files that share one GAS global scope; `ViewDash.html` (1848 lines) splits into four client files wired with `HtmlService` includes. Because GAS evaluates every `.js` file into a single global scope and nothing runs at load time, moving a function between files cannot break a reference — the only thing that must change in lockstep is the Node test harness, which currently reads `Code.js` alone.

**Tech Stack:** Google Apps Script (V8), `HtmlService` templates, plain Node for tests (no npm, no package.json, no build step).

---

## Context an engineer needs before starting

**This app holds individual salary data.** There is no open-access fallback and no anonymous path to the payload. Do not add one.

**Deploy is manual.** Files are pasted into the GAS editor by hand, then `bustCompCache_()` is run, then a new deployment version is published. Saving files without publishing a version keeps serving old code. `PROCESS.md:62` records that silent stale deployments cost a sibling project three debugging rounds — that is the entire reason Task 5 exists.

**Three test harnesses, all plain node, all run from `D:\Contribution\CompDash`:**

| Command | What it does |
|---|---|
| `node tests/run_tests.js` | evals server source + `tests/cases.js` in one `eval`, prints `N passed, M failed` |
| `node tests/parse_html.js` | syntax-checks the client `<script>` blocks |
| `node tests/render_smoke.js` | runs every renderer against a synthetic payload with a stub DOM |

**Why `run_tests.js` uses one `eval`:** top-level `const`/`let` created inside an `eval` are scoped to that call, so a second `eval` cannot see `CONFIG_CD`. All server sources must be concatenated into a single `eval` string. This constraint is already documented at the top of the file — do not "clean it up" into separate evals.

**What P0 does NOT do.** No new engines, no new columns, no quadrant, no forecast, no narrative prose. Those are P1–P3. Every function moved in Tasks 2–4 moves **byte-for-byte unchanged**.

---

## File structure after P0

### Server — five files, one shared global scope

| File | Responsibility | Source lines moved from `Code.js` |
|---|---|---|
| `Code.js` | `CONFIG_CD`, shared utilities, fiscal calendar, infra (props, cache, readers), payload assembly, `doGet`, `include`, diagnostics | keeps 1–337 and 1362–end |
| `Position.js` | anchors, ratios, growth, ratings, signals, priority, equity, QTA — everything about where one person sits | 935–1361 |
| `Workforce.js` | attrition, movement, managers, financial impact, forecast — everything about population flow | 338–648 |
| `Narrative.js` | verdict formatting and the verdict engine — everything that turns numbers into sentences | 649–934 |
| `Security.js` | unchanged in P0 apart from its `BUILD_` line | — |

Cut boundaries are the existing section-comment banners, so no function is split across files.

### Client — four files

| File | Responsibility | Source lines from `ViewDash.html` |
|---|---|---|
| `ViewDash.html` | head, body chrome, include wiring, `VIEWS`, `STATE`, helpers, filters, dispatch, drill panel, boot | 1–4, 186–218, 220–883, 1668–1846 |
| `Styles.html` | all CSS | 5–185 |
| `Views.html` | `renderOverview`, `renderAttrition`, `renderCompa` | 884–1149, 1340–1380 |
| `Admin.html` | `renderQta`, `renderReference`, `renderAccess`, `renderAccessForm` | 1489–1509, 1529–1667 |

**Include order is load-bearing.** `RENDERERS` (a `const` in `ViewDash.html`) references renderer functions by name at evaluation time. Function declarations hoist only within their own `<script>` element, so `Views.html` and `Admin.html` must be included **before** the main script block. Order: `Styles` → `Views` → `Admin` → main `<script>`.

---

## Task 1: Teach the harness to read four server files

Nothing can be moved until the test runner can see the new files. This task creates them empty (apart from their build stamps) and rewires the runner, so the suite must stay green with zero behaviour change.

**Files:**
- Create: `D:\Contribution\CompDash\Position.js`
- Create: `D:\Contribution\CompDash\Workforce.js`
- Create: `D:\Contribution\CompDash\Narrative.js`
- Modify: `D:\Contribution\CompDash\tests\run_tests.js`

- [ ] **Step 1: Record the baseline before touching anything**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Write the number down. Every later step must print this same number. If it is not `0 failed`, stop and report — do not start a refactor on a red suite.

- [ ] **Step 2: Create the three server files**

`Position.js`:

```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Position engine
// PURPOSE:     Where one person sits — anchors, ratios, growth,
//              ratings, signals, priority, equity, QTA.
//
// PURE. No SpreadsheetApp, no CacheService, no Session. Every
// function takes plain objects and returns plain objects, which is
// what lets tests/run_tests.js exercise it under plain node.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.position = 46;
```

`Workforce.js`:

```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Workforce engine
// PURPOSE:     Population flow — attrition, movement, managers,
//              financial impact, forecast.
//
// PURE. Same contract as Position.js.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.workforce = 46;
```

`Narrative.js`:

```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Narrative engine
// PURPOSE:     Turns computed values into sentences. Verdict
//              formatting and the verdict engine.
//
// PURE. Same contract as Position.js. Deterministic — no LLM.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.narrative = 46;
```

`var BUILD_ = BUILD_ || {}` is deliberate. `var` hoists to `undefined`, so whichever file GAS loads first creates the object and the rest reuse it. `const` or `let` here would throw on redeclaration.

- [ ] **Step 3: Rewire the runner to concatenate all four sources**

In `tests/run_tests.js`, replace the single-file read:

```js
const src = fs.readFileSync(path.join(root, "Code.js"), "utf8");
```

with:

```js
// Every server file, concatenated into ONE eval string. Top-level const/let
// created by eval are scoped to that eval call, so a second eval could not see
// CONFIG_CD. Code.js goes first because it declares it. Do not split this.
const SERVER_FILES = ["Code.js", "Position.js", "Workforce.js", "Narrative.js"];
const src = SERVER_FILES
  .map(f => "\n// ===== " + f + " =====\n" + fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n");
```

- [ ] **Step 4: Run the suite**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: the exact number from Step 1, `0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Position.js CompDash/Workforce.js CompDash/Narrative.js CompDash/tests/run_tests.js && git commit -m "refactor(compdash): add empty engine files and multi-file test harness

Prepares the P0 split. No logic moves yet; the suite must stay green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Move the workforce engine

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js:338-648` (cut)
- Modify: `D:\Contribution\CompDash\Workforce.js` (paste)

Moves eleven functions: `classifyTerm_`, `headcountOn_`, `fyAttritionBlock_`, `sliceAttrition_`, `buildAttrition_`, `personLite_`, `fyAttritionFromPeople_`, `sliceAttritionFromPeople_`, `buildManagers_`, `buildFinancialImpact_`, `buildForecast_`.

- [ ] **Step 1: Cut lines 338–648 from `Code.js`**

Line 338 is the banner `// ── Attrition engine ─────...`. Line 648 is the blank line immediately before `// ── Verdict engine (V3) ─────...` on line 649. Take the whole range including both section banners inside it.

- [ ] **Step 2: Paste them into `Workforce.js`**

Append below the `BUILD_.workforce` line, unchanged. Do not reformat, do not rename, do not "improve" anything. A behaviour change here is indistinguishable from a move error.

These functions call `levelRank_`, `isoDate_`, `fiscalMonthIdx_`, `ragBand_` and `CONFIG_CD`, all of which stay in `Code.js`. That is fine and needs no import: GAS shares one global scope across files, and the harness concatenates before evaluating. Nothing resolves at load time.

- [ ] **Step 3: Run the suite**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: the Task 1 Step 1 number, `0 failed`. A `ReferenceError` here means a function was left behind or duplicated — check that the cut range did not clip a closing brace.

- [ ] **Step 4: Verify nothing was duplicated**

```bash
cd "D:/Contribution/CompDash" && grep -c "^function buildAttrition_" Code.js Workforce.js
```

Expected: `Code.js:0` and `Workforce.js:1`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/Workforce.js && git commit -m "refactor(compdash): move attrition, managers and forecast to Workforce.js

Byte-for-byte move of Code.js:338-648. No behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Move the narrative engine

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js` (cut the former lines 649–934)
- Modify: `D:\Contribution\CompDash\Narrative.js` (paste)

Moves `pctV_`, `usdV_`, `sevFromBand_`, `sampleGuard_`, `buildVerdicts_`.

- [ ] **Step 1: Locate the range in the now-shorter `Code.js`**

```bash
cd "D:/Contribution/CompDash" && grep -n "── Verdict engine\|── Internal Position engine" Code.js
```

Cut from the `// ── Verdict engine (V3) ───...` banner up to but **not** including the `// ── Internal Position engine V2 ───...` banner.

- [ ] **Step 2: Paste into `Narrative.js`** below the `BUILD_.narrative` line, unchanged.

- [ ] **Step 3: Run the suite**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: baseline number, `0 failed`.

- [ ] **Step 4: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/Narrative.js && git commit -m "refactor(compdash): move the verdict engine to Narrative.js

Byte-for-byte move. No behaviour change.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Move the position engine

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js` (cut the former lines 935–1361)
- Modify: `D:\Contribution\CompDash\Position.js` (paste)

Moves eighteen functions and one constant: `buildCompaGroups_`, `benchKey_`, `lookupBench_`, `marketSuggestion_`, `YEAR_MS_`, `rri_`, `tagRate_`, `buildGrowthForEmp_`, `buildPerfForEmp_`, `buildSignalsForEmp_`, `buildContribByEmp_`, `priorityScore_`, `median_`, `tenureYears_`, `profileTenureYears_`, `ttmGrowth_`, `buildEquity_`, `buildQtaInterim_`.

- [ ] **Step 1: Locate the range**

```bash
cd "D:/Contribution/CompDash" && grep -n "── Internal Position engine\|^// ============" Code.js | head -8
```

Cut from the `// ── Internal Position engine V2 ───...` banner up to but **not** including the `// ============` banner that opens the infrastructure section (the one followed by `function log_`).

- [ ] **Step 2: Paste into `Position.js`** below the `BUILD_.position` line, unchanged.

`YEAR_MS_` is declared `const` at top level. It moves with its section and stays a `const` — it is only read inside functions, never at load time, so file order does not matter.

- [ ] **Step 3: Run the suite**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: baseline number, `0 failed`.

- [ ] **Step 4: Confirm `Code.js` shrank as expected**

```bash
cd "D:/Contribution/CompDash" && wc -l Code.js Position.js Workforce.js Narrative.js
```

Expected: `Code.js` roughly 1150 lines, down from 2178. The three engines should total roughly 1030.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/Position.js && git commit -m "refactor(compdash): move anchors, signals, priority and equity to Position.js

Byte-for-byte move. Code.js drops from 2178 to ~1150 lines.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `include()` helper and the `BUILD_` mismatch guard

Nine hand-pasted files is more surface for a stale deploy than three. This makes a half-paste a visible error instead of quietly wrong numbers.

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js` (add `BUILD_.code`, `include`, `buildMismatch_`; modify `doGet`)
- Modify: `D:\Contribution\CompDash\Security.js` (add `BUILD_.security`)
- Modify: `D:\Contribution\CompDash\tests\cases.js` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `tests/cases.js`:

```js
// ── BUILD_ mismatch guard ───────────────────────────────────────────────────
check("build: all five files agree at rest", buildMismatch_() === null);

check("build: a stale file is named", (function () {
  const real = BUILD_.position;
  BUILD_.position = real - 1;
  const out = buildMismatch_();
  BUILD_.position = real;
  return out && out.length === 1 && out[0] === "position";
})());

check("build: several stale files are all named", (function () {
  const p = BUILD_.position, w = BUILD_.workforce;
  BUILD_.position = 0; BUILD_.workforce = 0;
  const out = buildMismatch_();
  BUILD_.position = p; BUILD_.workforce = w;
  return out && out.length === 2;
})());

check("build: a missing stamp counts as stale", (function () {
  const real = BUILD_.narrative;
  delete BUILD_.narrative;
  const out = buildMismatch_();
  BUILD_.narrative = real;
  return out && out.indexOf("narrative") !== -1;
})());
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -6
```

Expected: 4 failures naming `buildMismatch_` — `ReferenceError: buildMismatch_ is not defined`.

- [ ] **Step 3: Add the stamp and guard to `Code.js`**

Immediately after the closing `};` of `CONFIG_CD`, add:

```js
// ── Build stamps ────────────────────────────────────────────────────────────
// Nine files are pasted into the GAS editor by hand. Bump the number in EVERY
// server file on every release; doGet refuses to serve when they disagree, so a
// half-finished paste fails loudly instead of reporting stale numbers.
var BUILD_ = BUILD_ || {};
BUILD_.code = 46;

/**
 * @returns {(string[]|null)} names of files whose stamp differs from Code.js,
 *   or null when every file agrees. A missing stamp counts as stale.
 */
function buildMismatch_() {
  const want = BUILD_.code;
  const stale = ["position", "workforce", "narrative", "security"]
    .filter(k => BUILD_[k] !== want);
  return stale.length ? stale : null;
}
```

- [ ] **Step 4: Add the stamp to `Security.js`**

Directly above `const SEC_CD = {`:

```js
var BUILD_ = BUILD_ || {};
BUILD_.security = 46;
```

- [ ] **Step 5: Run the tests**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: baseline + 4 passed, `0 failed`.

- [ ] **Step 6: Add `include()` and wire the guard into `doGet`**

Replace the existing `doGet` body in `Code.js` with:

```js
/**
 * Inlines another HTML file into the ViewDash template.
 * Used as <?!= include('Styles') ?>. Include order is load-bearing — see the
 * comment in ViewDash.html.
 * @param {string} name file name without the .html extension
 * @returns {string} the file's raw content
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function doGet() {
  const access = checkDashboardAccess();
  if (!access.allowed) {
    Logger.log("⚠️ doGet denied: " + access.email);
    return HtmlService.createHtmlOutput(deniedPageHtml_(access.email))
      .setTitle("Access restricted");
  }
  // A partial paste must never render — stale engine files would report wrong
  // numbers with no visible symptom (PROCESS.md §"No build badge").
  const stale = buildMismatch_();
  if (stale) {
    Logger.log("❌ doGet blocked: build mismatch — stale " + stale.join(", "));
    return HtmlService.createHtmlOutput(
      '<div style="font:14px system-ui;padding:32px;max-width:560px">' +
      '<h2>⚠️ Incomplete deployment</h2>' +
      '<p>These files are stale and must be re-pasted, then a new deployment ' +
      'version published:</p><ul><li><b>' +
      stale.map(s => s.charAt(0).toUpperCase() + s.slice(1) + ".js").join("</b></li><li><b>") +
      '</b></li></ul></div>').setTitle("Incomplete deployment");
  }
  const t = HtmlService.createTemplateFromFile("ViewDash");
  t.userRole = access.role;
  t.userEmail = access.email;
  return t.evaluate()
    .setTitle("Rocketeer Global Comp Health Report")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
```

- [ ] **Step 7: Add `meta.schema` so the client can detect a stale HTML paste**

The `BUILD_` guard only compares server files to each other. A correctly-pasted
server with a stale `ViewDash.html` still renders. The payload therefore carries
the same number, and the client compares.

In `getCompReportData`, as the first key of the `meta` object:

```js
      // Compared against SCHEMA in ViewDash.html — catches a stale client paste,
      // which the server-side BUILD_ guard cannot see.
      schema: BUILD_.code,
```

- [ ] **Step 8: Add the client-side check to `ViewDash.html`**

Directly below `const USER_EMAIL = "<?= userEmail ?>";`:

```js
// Bump in lockstep with BUILD_.code in Code.js. A mismatch means the server and
// this file came from different pastes — the numbers on screen may be stale.
const SCHEMA = 46;
```

Then, wherever the payload is assigned to `STATE.data` after a successful load, add:

```js
  if (d.meta && d.meta.schema !== SCHEMA) {
    document.getElementById("pane").insertAdjacentHTML("beforebegin",
      '<div class="banner err">⚠️ <b>Incomplete deployment</b> — ViewDash.html is ' +
      'from a different release than the server (client ' + SCHEMA + ', server ' +
      d.meta.schema + '). Re-paste all nine files and publish a new version.</div>');
  }
```

Find the assignment with:

```bash
cd "D:/Contribution/CompDash" && grep -n "STATE.data = " ViewDash.html
```

- [ ] **Step 9: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: baseline + 4 passed / 0 failed, `✅ ViewDash.html script parses`, `✅ render smoke: all checks passed`.

The smoke harness builds its own synthetic payload whose `meta` has no `schema`
key, so the banner will fire there. That is correct behaviour, not a failure —
add `schema: 46` to the synthetic `meta` in `tests/render_smoke.js` so the check
exercises the matching path, and leave the mismatch path to manual verification
in Task 11 Step 9.

- [ ] **Step 10: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/Security.js CompDash/ViewDash.html CompDash/tests/ && git commit -m "feat(compdash): BUILD_ mismatch guard, meta.schema check and include() helper

doGet refuses to render when server file stamps disagree, naming the stale
files, and the client banners a server/client schema skew the server guard
cannot see. Nine hand-pasted files made the stale-deploy failure mode likely
enough to be worth an explicit gate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Delete the Action Queue end-to-end

The only surface in P0 that dies completely, server and client. Its state was per-viewer `UserProperties` — no shared ownership, so nothing is migrated.

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js` (remove `CD_ACTIONS_PROP`, `CD_ACTION_STATES`, `sanitizeActionPatch_`, `getOverviewActions`, `saveOverviewAction`)
- Modify: `D:\Contribution\CompDash\ViewDash.html` (remove the `actions` `VIEWS` entry, `renderActions`, the `RENDERERS.actions` entry, `STATE.actions`, `STATE.actionsLoaded`, and any loader call)
- Modify: `D:\Contribution\CompDash\tests\render_smoke.js` (remove the action-queue block and stubs)
- Modify: `D:\Contribution\CompDash\tests\cases.js` (remove `sanitizeActionPatch_` cases)

- [ ] **Step 1: Find every reference before deleting**

```bash
cd "D:/Contribution/CompDash" && grep -n "actions\|Action\|ACTION" Code.js ViewDash.html tests/cases.js tests/render_smoke.js | grep -iv "transaction\|satisfaction" | head -40
```

Read the whole list. Anything not in the file lists above is an unexpected coupling — report it rather than guessing.

- [ ] **Step 2: Remove the server side from `Code.js`**

Delete the entire `// ── Overview action queue — per-viewer state ───...` section: the banner comment, `CD_ACTIONS_PROP`, `CD_ACTION_STATES`, `sanitizeActionPatch_`, `getOverviewActions`, `saveOverviewAction`.

- [ ] **Step 3: Remove the client side from `ViewDash.html`**

Delete, in order:

- the `VIEWS` entry `{ id: "actions", label: "📌 Action Queue", roles: ["admin"] },` and the two comment lines above it
- `actions: {}, actionsLoaded: false,` from `STATE`, and the four-line comment above them
- the whole `function renderActions(el) { ... }` block
- `actions: renderActions,` from the `RENDERERS` map
- any `google.script.run...getOverviewActions()` / `saveOverviewAction(` call sites

- [ ] **Step 4: Update `render_smoke.js` in the same commit**

Remove from the `chain` stub:

```js
  getOverviewActions() {}, saveOverviewAction() {} };
```

so it reads:

```js
const chain = { withSuccessHandler: () => chain, withFailureHandler: () => chain,
  getCompReportData() {}, getAccessSettings() {}, saveAccessSettings() {} };
```

Remove these two lines:

```js
STATE.actions = { "compa-below": { state: "done", owner: "WFP", by: "x@sr.com", at: "2026-07-28T10:00:00Z" } };
STATE.actionsLoaded = true;
```

Remove the entire `// 📌 Action Queue view (admin-only)` block — the `const aq = el();` line through the `check("queue: tab is admin-only in VIEWS", ...)` assertion, five checks in total.

Keep `check("signals: NO action queue on Overview", !/Action queue/.test(H));` — it asserts an absence, and that absence is now permanent.

Add one replacement assertion directly after it:

```js
check("actions: route fully removed", !VIEWS.find(v => v.id === "actions") && !RENDERERS.actions);
```

- [ ] **Step 5: Remove the `sanitizeActionPatch_` cases from `cases.js`**

```bash
cd "D:/Contribution/CompDash" && grep -n "sanitizeActionPatch_" tests/cases.js
```

Delete every `check(...)` line that calls it.

- [ ] **Step 6: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `0 failed` on all three. The `run_tests` count drops by however many `sanitizeActionPatch_` cases existed; `render_smoke` drops five and gains one.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/ViewDash.html CompDash/tests/ && git commit -m "feat(compdash)!: delete the Action Queue

Per-viewer UserProperties checklist with no shared ownership. Removed server
RPCs, the route, the renderer and STATE. Not replaced.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Delete five dead routes and retarget orphaned verdicts

Pay Equity, Contribution, Risk Signals, Market Gap and Priority Ranking lose their tabs. **Their server engines stay** — `buildEquity_` still feeds an Overview KPI and a verdict, and `buildSignalsForEmp_` / `buildContribByEmp_` / `priorityScore_` become P1's Risk and Priority columns. P0 removes routes, not engines.

Deleting the views orphans five verdict deep-links: `getVerdictsFor(view)` filters by `v.view`, so a verdict pointing at a deleted view becomes unreachable. Retarget them.

**Files:**
- Modify: `D:\Contribution\CompDash\ViewDash.html` (five `VIEWS` entries, five renderers, `suggestionChip`, five `RENDERERS` entries)
- Modify: `D:\Contribution\CompDash\Narrative.js` (five `view:` values in `buildVerdicts_`)
- Modify: `D:\Contribution\CompDash\tests\cases.js` (add retarget tests)
- Modify: `D:\Contribution\CompDash\tests\render_smoke.js` (add absence assertions)

- [ ] **Step 1: Write the failing tests for the retarget**

Append to `tests/cases.js`:

```js
// ── Verdict deep-links must point at a surviving view ───────────────────────
// P0 deletes ranking/signals/equity/market/contrib. getVerdictsFor(view) filters
// on v.view, so a verdict aimed at a deleted view is unreachable, not merely ugly.
check("verdicts: no verdict targets a deleted view", (function () {
  const DEAD = ["ranking", "signals", "equity", "market", "contrib", "actions"];
  const out = buildVerdicts_(VERDICT_MODEL_, VERDICT_CFG_);
  return out.length > 0 && out.every(v => DEAD.indexOf(v.view) === -1);
})());
```

`VERDICT_MODEL_` and `VERDICT_CFG_` are the fixtures the existing verdict cases already build. Find them and reuse them — do not invent a second fixture, because a second one will drift from the first:

```bash
cd "D:/Contribution/CompDash" && grep -n "buildVerdicts_(" tests/cases.js | head
```

If the existing cases build their model inline rather than in a named binding, hoist it to a `const VERDICT_MODEL_` / `const VERDICT_CFG_` above the first use in the same step, and point the existing cases at it. The `out.length > 0` guard matters: an empty verdict array would pass `.every()` vacuously and the test would prove nothing.

- [ ] **Step 2: Run to verify it fails**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -3
```

Expected: `❌ verdicts: no verdict targets a deleted view`.

- [ ] **Step 3: Retarget the five verdicts in `Narrative.js`**

| Verdict id | Was | Becomes | Why |
|---|---|---|---|
| `equity` | `equity` | `overview` | Pay Equity has no tab; the flag count still shows on the Overview KPI strip |
| `promo-stale` | `signals` | `compa` | becomes a Risk-column read in P1 |
| `recognition-risk` | `signals` | `compa` | same |
| `retention-core` | `signals` | `compa` | same |
| `invisible-contrib` | `signals` | `compa` | same |

Change only the `view:` value on each. Leave `id`, `severity`, `fact` and `soWhat` untouched — the wording is reviewed copy and P1 rewrites it wholesale.

- [ ] **Step 4: Run to verify it passes**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1
```

Expected: `0 failed`.

- [ ] **Step 5: Delete the five routes from `ViewDash.html`**

Remove these `VIEWS` entries:

```js
  { id: "ranking",   label: "🎯 Priority Ranking",    roles: ["admin", "viewer"] },
  { id: "signals",   label: "🚨 Risk Signals",        roles: ["admin", "viewer"] },
  { id: "market",    label: "🌍 Market Gap",          roles: ["admin", "viewer"] },
  { id: "equity",    label: "🧭 Pay Equity",          roles: ["admin", "viewer"] },
  { id: "contrib",   label: "🚀 Contribution",        roles: ["admin", "viewer"] },
```

Delete these function bodies entirely: `renderRanking`, `renderSignals`, `renderMarket`, `suggestionChip` (only `renderMarket` calls it), `renderEquity`, `renderContrib`.

Reduce the `RENDERERS` map to:

```js
const RENDERERS = {
  overview: renderOverview, attrition: renderAttrition,
  compa: renderCompa, qta: renderQta,
  reference: renderReference, access: renderAccess,
};
```

The remaining `VIEWS` array should be exactly six entries: `overview`, `attrition`, `compa`, `qta`, `reference` (menu), `access` (menu, admin).

- [ ] **Step 6: Add absence assertions to `render_smoke.js`**

Directly after the `actions: route fully removed` check added in Task 6:

```js
["ranking", "signals", "market", "equity", "contrib"].forEach(id => {
  check("route '" + id + "' fully removed",
    !VIEWS.find(v => v.id === id) && !RENDERERS[id]);
});
check("routes: exactly six survive", VIEWS.length === 6);
```

- [ ] **Step 7: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `0 failed` on all three.

- [ ] **Step 8: Confirm the engines survived**

```bash
cd "D:/Contribution/CompDash" && grep -c "^function buildEquity_\|^function buildSignalsForEmp_\|^function buildContribByEmp_\|^function priorityScore_" Position.js
```

Expected: `4`. If any is zero, it was deleted by mistake — restore it. P1 depends on all four.

- [ ] **Step 9: Commit**

```bash
cd "D:/Contribution" && git add CompDash/ViewDash.html CompDash/Narrative.js CompDash/tests/ && git commit -m "feat(compdash)!: delete Pay Equity, Contribution, Risk Signals, Market Gap and Priority Ranking routes

Ten tabs to five (three plus two menu items). Server engines stay: buildEquity_
still feeds an Overview KPI, and signals/contrib/priority become the Risk and
Priority columns in P1. Five verdicts retargeted off the deleted views so their
deep-links stay reachable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Extract `Styles.html`

**Files:**
- Create: `D:\Contribution\CompDash\Styles.html`
- Modify: `D:\Contribution\CompDash\ViewDash.html`
- Modify: `D:\Contribution\CompDash\tests\parse_html.js`
- Modify: `D:\Contribution\CompDash\tests\render_smoke.js`

- [ ] **Step 1: Move the CSS**

Cut everything from `<style>` through `</style>` inclusive (originally lines 5–185) out of `ViewDash.html` and paste it into a new `Styles.html`. Keep the `<style>` tags — they belong in the included file.

- [ ] **Step 2: Replace it with an include in `ViewDash.html`**

The head becomes:

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <?!= include('Styles') ?>
</head>
```

- [ ] **Step 3: Make the harnesses read both files**

Both `parse_html.js` and `render_smoke.js` currently do:

```js
const html = fs.readFileSync(path.join(__dirname, "..", "ViewDash.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/<\?[=!]?[\s\S]*?\?>/g, "admin");
```

Replace with a shared reader in **both** files (duplicated deliberately — these harnesses have no shared module and adding one for six lines is not worth a new file):

```js
// Client JS now spans several files. Read each one's <script> block and join in
// LOAD ORDER — Views/Admin define the renderers, ViewDash's RENDERERS const
// references them by name at evaluation time, so it must come last.
const CLIENT_FILES = ["Views.html", "Admin.html", "ViewDash.html"];
const js = CLIENT_FILES.map(f => {
  const p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) return "";                    // not split out yet
  const m = fs.readFileSync(p, "utf8").match(/<script>([\s\S]*?)<\/script>/);
  return m ? m[1] : "";
}).join("\n;\n").replace(/<\?[=!]?[\s\S]*?\?>/g, "admin");
```

Note the **non-greedy** `[\s\S]*?`. The original greedy pattern would span from the first `<script>` to the last `</script>` across intervening HTML.

In `parse_html.js` also drop the now-unused `html` const and the `if (!m)` guard, replacing the guard with:

```js
if (!js.trim()) { console.log("❌ no <script> content found"); process.exit(1); }
```

`render_smoke.js` keeps using `js` for its `!/svgSpark/.test(js)` assertion, which still works against the joined source.

- [ ] **Step 4: Run the client harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `✅ ViewDash.html script parses` and `✅ render smoke: all checks passed`. `Views.html` and `Admin.html` do not exist yet, which is why the reader skips missing files.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Styles.html CompDash/ViewDash.html CompDash/tests/ && git commit -m "refactor(compdash): extract Styles.html

CSS moves out of the shell behind <?!= include('Styles') ?>. Client harnesses
now read script blocks from several files in load order.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Extract `Views.html` and `Admin.html`

**Files:**
- Create: `D:\Contribution\CompDash\Views.html`
- Create: `D:\Contribution\CompDash\Admin.html`
- Modify: `D:\Contribution\CompDash\ViewDash.html`

- [ ] **Step 1: Create `Views.html`**

```html
<script>
// Tab renderers. Included BEFORE ViewDash.html's own script block, because the
// RENDERERS const there references these functions by name at evaluation time
// and function declarations hoist only within their own <script> element.
</script>
```

Move `renderOverview`, `renderAttrition` and `renderCompa` inside those `<script>` tags.

**Move a helper with them only when it has exactly one caller and that caller is
moving.** Anything with two or more callers stays in `ViewDash.html` and is
reached at call time, which works fine across script elements. To decide for a
given helper:

```bash
cd "D:/Contribution/CompDash" && grep -c "helperName" ViewDash.html
```

A count of `2` means one declaration plus one call site — move it. Three or more
means it is shared — leave it. When in doubt, leave it in `ViewDash.html`: a
shared helper in the shell is correct, a duplicated one is a bug.

- [ ] **Step 2: Create `Admin.html`**

```html
<script>
// Menu surfaces: QTA Status, Data Reference, Access Control. Same load-order
// contract as Views.html.
</script>
```

Move `renderQta`, `renderReference`, `renderAccess`, `renderAccessForm`, and `saveAccess`.

- [ ] **Step 3: Wire the includes into `ViewDash.html`**

Immediately before the existing `<script>` line (the one followed by `"use strict";`):

```html
<!-- Load order is load-bearing: these define the renderers that the RENDERERS
     const in the script block below references by name. -->
<?!= include('Views') ?>
<?!= include('Admin') ?>

<script>
```

- [ ] **Step 4: Check for helpers that moved out of reach**

Renderers call `esc`, `fmtMoney`, `visibleEmp`, `openDrill` and similar, which stay in `ViewDash.html`. That is fine — they are called at render time, long after every script has been evaluated. What is **not** fine is a `const` in `ViewDash.html` read at evaluation time by `Views.html`. Verify:

```bash
cd "D:/Contribution/CompDash" && grep -n "^const \|^let " Views.html Admin.html
```

Any top-level `const`/`let` in those files must not reference a binding declared in `ViewDash.html`. If one does, move the declaration into the same file.

- [ ] **Step 5: Run the client harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: both green. A `ReferenceError: renderOverview is not defined` means the include order is wrong — `Views` and `Admin` must precede the main script block.

- [ ] **Step 6: Confirm the shell shrank**

```bash
cd "D:/Contribution/CompDash" && wc -l ViewDash.html Styles.html Views.html Admin.html
```

Expected: `ViewDash.html` well under half its original 1848 lines.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Views.html CompDash/Admin.html CompDash/ViewDash.html && git commit -m "refactor(compdash): extract Views.html and Admin.html

Renderers leave the shell. Includes precede the main script block because
RENDERERS resolves the function names at evaluation time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Extract `CONFIG_CD.THRESHOLDS`

Today the internal and market band literals sit as five loose keys on `CONFIG_CD` and are echoed to the client as two differently-shaped `meta` fields (`compaBands`, `marketLow`). P1's hover-explains-its-rule UI needs one object with one shape. P0 extracts and echoes; the hover UI is P1.

**Files:**
- Modify: `D:\Contribution\CompDash\Code.js` (`CONFIG_CD`, `meta`)
- Modify: `D:\Contribution\CompDash\tests\cases.js`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cases.js`:

```js
// ── THRESHOLDS ──────────────────────────────────────────────────────────────
check("thresholds: internal bands carry value and source",
  CONFIG_CD.THRESHOLDS.internal.low === 0.80 &&
  CONFIG_CD.THRESHOLDS.internal.target === 0.95 &&
  CONFIG_CD.THRESHOLDS.internal.high === 1.10 &&
  typeof CONFIG_CD.THRESHOLDS.internal.source === "string");

check("thresholds: market floor carries value and source",
  CONFIG_CD.THRESHOLDS.market.low === 0.90 &&
  typeof CONFIG_CD.THRESHOLDS.market.source === "string");

check("thresholds: small-group minimum lives here too",
  CONFIG_CD.THRESHOLDS.smallGroupMin === 3);

check("thresholds: legacy keys still resolve to the same numbers",
  CONFIG_CD.COMPA_LOW_MIN === CONFIG_CD.THRESHOLDS.internal.low &&
  CONFIG_CD.COMPA_TARGET_MIN === CONFIG_CD.THRESHOLDS.internal.target &&
  CONFIG_CD.COMPA_HIGH_MAX === CONFIG_CD.THRESHOLDS.internal.high &&
  CONFIG_CD.MARKET_LOW === CONFIG_CD.THRESHOLDS.market.low &&
  CONFIG_CD.SMALL_GROUP_MIN === CONFIG_CD.THRESHOLDS.smallGroupMin);
```

The last check is the safety net: every existing consumer still reads the flat keys, and P0 must not change a single computed number. P1 migrates the consumers and drops the aliases.

- [ ] **Step 2: Run to verify they fail**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -6
```

Expected: 4 failures — `Cannot read properties of undefined (reading 'internal')`.

- [ ] **Step 3: Add `THRESHOLDS` to `CONFIG_CD`**

Insert directly above the existing `COMPA_LOW_MIN` line:

```js
  // ── Signal thresholds — single source of truth ───────────────────────────
  // Echoed wholesale into meta.thresholds so every chip can render its own
  // rule, threshold and source. The flat COMPA_*/MARKET_LOW/SMALL_GROUP_MIN
  // keys below are ALIASES kept for the existing consumers; P1 migrates them
  // and deletes the aliases. Change a number HERE only.
  THRESHOLDS: {
    internal: {
      low: 0.80, target: 0.95, high: 1.10,
      rule: "TCC ÷ the median TCC of active peers sharing Key Location + Job Title",
      source: "Roster TCC · internal peer anchor",
    },
    market: {
      low: 0.90,
      rule: "TCC ÷ the external benchmark mean for Location + Job Title",
      source: "Benchmarking → Compilation tab",
    },
    smallGroupMin: 3,
  },
```

Then rewrite the four existing literals as aliases. Replace:

```js
  SMALL_GROUP_MIN:     3, // compa groups smaller than this get a smallGroup flag
```

with a line placed **after** the `THRESHOLDS` block (object literals cannot reference their own earlier keys, so these aliases are assigned after construction — see Step 4).

- [ ] **Step 4: Assign the aliases after the object literal**

A JavaScript object literal cannot reference its own properties during construction, so the aliases go immediately after the closing `};` of `CONFIG_CD` and before the `BUILD_` block added in Task 5:

```js
// Aliases — every current consumer still reads these flat keys. Assigned from
// THRESHOLDS so the two can never drift. P1 migrates consumers and deletes these.
CONFIG_CD.COMPA_LOW_MIN    = CONFIG_CD.THRESHOLDS.internal.low;
CONFIG_CD.COMPA_TARGET_MIN = CONFIG_CD.THRESHOLDS.internal.target;
CONFIG_CD.COMPA_HIGH_MAX   = CONFIG_CD.THRESHOLDS.internal.high;
CONFIG_CD.MARKET_LOW       = CONFIG_CD.THRESHOLDS.market.low;
CONFIG_CD.SMALL_GROUP_MIN  = CONFIG_CD.THRESHOLDS.smallGroupMin;
```

Delete the five original literal lines from inside the object (`SMALL_GROUP_MIN`, `COMPA_LOW_MIN`, `COMPA_TARGET_MIN`, `COMPA_HIGH_MAX`, `MARKET_LOW`), keeping their explanatory comments alongside the new `THRESHOLDS` block.

- [ ] **Step 5: Echo it into `meta`**

In `getCompReportData`, directly after the existing `marketLow:` line in the `meta` object:

```js
      // Whole-object echo — P1's hover UI reads rule/source from here.
      thresholds: CONFIG_CD.THRESHOLDS,
```

Leave `compaBands` and `marketLow` in place. The client still reads them; removing them now would break `ratioClass()` and the Data Reference prose for no gain.

- [ ] **Step 6: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `0 failed` on all three, `run_tests` up by 4.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/tests/cases.js && git commit -m "refactor(compdash): extract CONFIG_CD.THRESHOLDS

One object carrying value, rule and source per signal, echoed as
meta.thresholds. Flat keys become aliases so no computed number moves; P1
migrates consumers and drops them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Theme refinement

The ServiceRocket tokens already exist in `Styles.html` with a dark default and a light theme. This is refinement, not migration: add the missing accent, set typography, tighten radius, add elevation and the freshness chip, and replace emoji tab labels with an inline SVG sprite.

**Files:**
- Modify: `D:\Contribution\CompDash\Styles.html`
- Modify: `D:\Contribution\CompDash\ViewDash.html` (font link, sprite, `VIEWS` labels, nav rendering, freshness chip)

- [ ] **Step 1: Add `--royal` to both themes in `Styles.html`**

In the `:root` brand block, after the `--june` line:

```css
      --royal:       #2864E6; /* selection, active indicators, cross-filter state */
```

In the dark semantic block, after `--above`:

```css
      --select: var(--royal);
      --select-bg: rgba(40,100,230,.15);
```

In `:root[data-theme="light"]`, after its `--above` line:

```css
      --select: #1E4FBF;  /* royal deepened for white surfaces */
      --select-bg: rgba(30,79,191,.10);
```

Consume `--select` immediately so it is not dead CSS — the active tab is the one
"selected" state that exists in P0. Change:

```css
    nav button.on { background: var(--panel-2); border-color: var(--cta); font-weight: 600; }
```

to:

```css
    nav button.on { background: var(--select-bg); border-color: var(--select); font-weight: 600; }
```

P1's cross-filter (quadrant point → table row) reuses the same pair.

- [ ] **Step 2: Set typography**

Replace the `body` font declaration:

```css
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, "Segoe UI", Arial, sans-serif; }
```

with:

```css
    /* Roboto via a stylesheet <link> in ViewDash.html — CSS only, no script
       execution, which is why fonts are acceptable here where a charting CDN
       was not. System stack stays as the fallback if the link fails. */
    body { margin: 0; background: var(--bg); color: var(--text);
           font: 14px/1.5 Roboto, system-ui, "Segoe UI", Arial, sans-serif; }
    h1, h2, h3, .kpi-v {
      font-family: "Roboto Condensed", Roboto, system-ui, "Segoe UI", Arial, sans-serif;
      letter-spacing: .01em;
    }
    table { font-size: 12px; line-height: 1.4; }
```

- [ ] **Step 3: Tighten radius and add elevation**

```css
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 14px;
            transition: border-color .15s ease, box-shadow .15s ease; }
    .card:hover { box-shadow: 0 2px 10px var(--shadow); }
    .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px; cursor: pointer;
           transition: border-color .15s ease, box-shadow .15s ease; }
    .kpi:hover { border-color: var(--cta); box-shadow: 0 2px 10px var(--shadow); }
```

Change `.banner` radius from `10px` to `8px`. Leave `button`, `.seg` and `.chip` radii alone — 8px and the pill shape are already correct.

- [ ] **Step 4: Add the freshness chip and icon sprite styles**

```css
    .fresh { display: inline-flex; align-items: center; gap: 6px; font-size: 11px;
             color: var(--muted); border: 1px solid var(--border); border-radius: 999px;
             padding: 3px 10px; }
    .fresh b { color: var(--text); font-weight: 600; }
    .tico { width: 15px; height: 15px; vertical-align: -3px; margin-right: 6px; fill: currentColor; }
```

- [ ] **Step 5: Add the font link and the SVG sprite to `ViewDash.html`**

In `<head>`, before the `include('Styles')` line:

```html
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&family=Roboto+Condensed:wght@600;700&display=swap">
```

Immediately after `<body>`, add the sprite. It is `display:none`, defines one symbol per surviving tab, and is referenced with `<use>`:

```html
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">
  <symbol id="i-overview" viewBox="0 0 24 24"><path d="M3 12l9-8 9 8v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></symbol>
  <symbol id="i-attrition" viewBox="0 0 24 24"><path d="M3 5h2v12h14v2H3zm5 9V9h3v5zm5 0V6h3v8z"/></symbol>
  <symbol id="i-compa" viewBox="0 0 24 24"><path d="M11 3h2v3h6v2h-2.2l3.2 6a4 4 0 0 1-8 0l3.2-6H13v11h4v2H7v-2h4V8H7.8L11 14a4 4 0 0 1-8 0l3.2-6H4V6h7z"/></symbol>
  <symbol id="i-qta" viewBox="0 0 24 24"><path d="M6 2h9l5 5v15H6zm8 1.5V8h4.5zM8 12h8v2H8zm0 4h8v2H8z"/></symbol>
  <symbol id="i-reference" viewBox="0 0 24 24"><path d="M4 4h7v16H4zm9 0h7v16h-7zm2 3h3v2h-3zm0 4h3v2h-3z"/></symbol>
  <symbol id="i-access" viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 1 5 5v2h2v13H5V9h2V7a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3v2h6V7a3 3 0 0 0-3-3m0 9a2 2 0 0 0-1 3.7V18h2v-1.3A2 2 0 0 0 12 13"/></symbol>
</svg>
```

- [ ] **Step 6: Point `VIEWS` at the sprite instead of emoji**

Give each entry an `icon` and strip the emoji from `label`:

```js
const VIEWS = [
  { id: "overview",  icon: "i-overview",  label: "Executive Pulse",       roles: ["admin", "viewer"] },
  { id: "compa",     icon: "i-compa",     label: "Compensation Position", roles: ["admin", "viewer"] },
  { id: "attrition", icon: "i-attrition", label: "Workforce & Attrition", roles: ["admin", "viewer"] },
  { id: "qta",       icon: "i-qta",       label: "QTA Status",            roles: ["admin", "viewer"], menu: true },
  { id: "reference", icon: "i-reference", label: "Data Reference",        roles: ["admin", "viewer"], menu: true },
  { id: "access",    icon: "i-access",    label: "Access Control",        roles: ["admin"],           menu: true },
];
```

This is also where tab **order** changes to the spec's narrative order and QTA moves into the menu.

Locate the nav and menu builders:

```bash
cd "D:/Contribution/CompDash" && grep -n "tabbar\|menuPanel\|VIEWS.filter\|VIEWS.forEach\|VIEWS.map" ViewDash.html
```

Prefix each button's label with:

```js
'<svg class="tico"><use href="#' + v.icon + '"></use></svg>'
```

Apply the same to the `#menuPanel` builder.

- [ ] **Step 7: Render the freshness chip**

In the header, replace the `subTitle` div:

```html
    <div class="sub" id="subTitle">loading…</div>
```

with:

```html
    <div class="sub" id="subTitle">loading…</div>
    <span class="fresh" id="freshChip" hidden></span>
```

Where `subTitle` is populated after a load, populate the chip too. `isoWeekLabel` already exists in the client (it is exported by `render_smoke.js`), so:

```js
  const fc = document.getElementById("freshChip");
  fc.innerHTML = 'As of <b>' + esc(isoWeekLabel(d.meta.asOf)) + '</b> · ' +
                 (d.meta.fromCache ? 'cached' : 'live');
  fc.hidden = false;
```

- [ ] **Step 8: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `0 failed` on all three.

If a smoke check asserts on an emoji tab label, update the assertion to match the new label text in the same commit.

- [ ] **Step 9: STOP — tests are blind to layout**

Every check above passes whether the page looks right or catastrophically broken. Deploy to the GAS test deployment, open the dashboard, and **ask the user for a screenshot** of the Executive Pulse and Compensation Position tabs before marking this task done.

Confirm by eye: tab icons render (not empty boxes or broken `<use>` refs), Roboto Condensed is visibly applied to headings and KPI numbers, cards are 8px not 12px, the freshness chip reads `As of 2026.W33 · cached`, and the light theme still passes contrast when toggled.

- [ ] **Step 10: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Styles.html CompDash/ViewDash.html CompDash/tests/ && git commit -m "feat(compdash): theme refinement — royal accent, Roboto, 8px cards, SVG tab icons

Tokens already existed; this adds --royal, Roboto/Roboto Condensed with the
system stack as fallback, 8px radius with hover elevation, the ISO-week
freshness chip, and an inline SVG sprite replacing emoji tab labels. Tabs
reorder to the spec's narrative order and QTA moves into the menu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Document the deploy

Nine files pasted by hand needs a checklist, and the `BUILD_` contract needs to be written down where the next person pasting will read it.

**Files:**
- Modify: `D:\Contribution\CompDash\PROCESS.md`

- [ ] **Step 1: Append a P0 section**

```markdown
## P0 deploy (2026.W34 — 3-tab rebuild foundation)

Spec: `CompDash/docs/specs/2026-08-11-comp-health-rebuild-design.md`
Plan: `CompDash/docs/plans/2026-08-11-comp-health-p0-foundation.md`

### The BUILD_ contract — read this before pasting

Every server file carries `BUILD_.<name>`. `doGet` compares all five and refuses
to render when they disagree, naming the stale files. **Bump the number in every
server file on every release, even files you did not otherwise change.** A
version skew is now a visible error page, not a silently wrong number.

### Paste order

Server first (the guard must be able to see every stamp), then client.

- [ ] `Code.js`
- [ ] `Position.js`      *(new in P0)*
- [ ] `Workforce.js`     *(new in P0)*
- [ ] `Narrative.js`     *(new in P0)*
- [ ] `Security.js`
- [ ] `Styles.html`      *(new in P0)*
- [ ] `Views.html`       *(new in P0)*
- [ ] `Admin.html`       *(new in P0)*
- [ ] `ViewDash.html`
- [ ] Run `bustCompCache_()` — **required**, the payload gains `meta.thresholds`
- [ ] Publish a **new deployment version** — saving files alone keeps serving old code
- [ ] Load the dashboard and confirm the header build badge, six nav entries
      (three tabs + three menu items), and the freshness chip

### What changed

- `Code.js` split into four server files; `ViewDash.html` into four client files.
- Deleted: Action Queue (server RPCs, route, per-viewer state), Pay Equity,
  Contribution, Risk Signals, Market Gap and Priority Ranking routes.
- **Engines kept:** `buildEquity_`, `buildSignalsForEmp_`, `buildContribByEmp_`
  and `priorityScore_` all survive — they feed an Overview KPI today and become
  the Risk and Priority columns in P1. Do not delete them.
- Five verdicts retargeted off deleted views (`equity` → `overview`, the four
  `signals` verdicts → `compa`).
- `CONFIG_CD.THRESHOLDS` added and echoed as `meta.thresholds`; the flat
  `COMPA_*` / `MARKET_LOW` / `SMALL_GROUP_MIN` keys are now aliases.
- Theme: `--royal`, Roboto/Roboto Condensed, 8px cards, SVG tab icons,
  freshness chip.

### Rollback

`git revert` the P0 range, re-paste all nine files, bust the cache, publish a
version. There is no data migration and no schema change to unwind — the
per-viewer action-queue `UserProperties` keys are simply abandoned.
```

- [ ] **Step 2: Run everything one final time**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `0 failed` on all three.

- [ ] **Step 3: Commit**

```bash
cd "D:/Contribution" && git add CompDash/PROCESS.md && git commit -m "docs(compdash): P0 deploy checklist and the BUILD_ contract

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

1. `node tests/run_tests.js`, `node tests/parse_html.js` and `node tests/render_smoke.js` all report zero failures.
2. `Code.js` is roughly 1150 lines; no server file exceeds ~700.
3. `VIEWS` has exactly six entries — three tabs and three menu items.
4. `grep -c "^function buildEquity_\|^function buildSignalsForEmp_\|^function buildContribByEmp_\|^function priorityScore_" Position.js` returns `4`.
5. No verdict carries a `view` value outside `overview`, `attrition`, `compa`.
6. Deliberately bumping one server file's `BUILD_` number and loading the app produces the "Incomplete deployment" page naming that file.
7. The user has seen a screenshot and confirmed the theme renders correctly in both light and dark.

## Explicitly not in P0

The one table with nine columns, the Group-by control, the quadrant, the
`exclusion` field, the `exec` role, the Executive Compensation route, the third
FY window, the movement table, driver narratives, the forecast, the lever
engine, the inclusivity prose, and the hover-explains-its-rule UI. Those are
P1–P3 and get their own plans.
