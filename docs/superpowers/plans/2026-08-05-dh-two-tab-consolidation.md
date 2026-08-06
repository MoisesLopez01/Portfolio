# Delivery Health Two-Tab Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the Delivery Health dashboard from six tabs to three (📊 Executive one-pager · 🎯 Actions · 🔒 Access), add a full-roster per-person compliance signals table backed by a new `personHygieneBuckets_` server pass (schema v21 → v22), and apply the gas-portfolio motion language — per spec `docs/superpowers/specs/2026-08-05-dh-two-tab-consolidation-design.md`.

**Architecture:** Google Apps Script web app. `Code.js` = pure data passes + model assembly + gzip-chunked cache; `Dashboard.html` = single-file client (inline `<script>`); no build step. Two local Node test runners eval those files directly: `node-tests.js` (pure functions) and `render-smoke.js` (rendering rules against a stubbed DOM). Every task below ends green on both runners.

**Tech Stack:** GAS (ES5-compatible JS — `var`, no arrow functions, no template literals in these files), HtmlService, Node ≥ 16 for the local runners. No libraries.

**Working directory for all commands:** `D:\Contribution\docs\superpowers\delivery-health-dashboard`

**Read the spec first.** Decision log, small-n guard, Hours eligibility, scope tags, naming rules all live there. Key constants you will meet: `DH_SCHEMA_VER_ = 21` (Code.js:3035, becomes 22), `STD_MIN_PERIODS = 5` (Dashboard.html:1537), matrix field registry `TYPE_FIELDS_` (Dashboard.html:4240), gate resolver `typeFieldGate_` (Dashboard.html:4266).

**Style rule for every edit:** these files carry deliberate, dated design commentary. Match it — when you move code, move its comments; when you delete a surface, leave a one-line dated tombstone only if the spec says the decision needs recording (most retirements are recorded in the spec, not the code).

---

### Task 1: Backend — `personHygieneBuckets_` + `meta.signalMinN` + schema v22

**Files:**
- Modify: `Code.js` (CONFIG_DH ~line 11; new function after `typeHygieneBuckets_` ends ~line 1591; `assembleModel_` buckets block ~line 2777 and return ~line 2828–2935; schema comment + `DH_SCHEMA_VER_` ~line 3035; new `_test_` function next to `_test_typeHygieneBuckets_` ~line 4056)
- Modify: `node-tests.js` (runner list, after line 42's `_test_typeHygieneBuckets_();`)

- [ ] **Step 1: Write the failing test in `Code.js`** — add directly after the closing `}` of `_test_typeHygieneBuckets_`:

```js
function _test_personHygieneBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personHygieneBuckets_: " + m); }
  var resolve = function (raw) {
    if (/maria/i.test(raw || "")) return "Maria Alvarez";
    if (/ken/i.test(raw || "")) return "Ken Lim";
    return null;                       // anyone else is unattributed
  };
  var d = function (s) { return new Date(s); };
  var jira = { issues: [
    // Resolved, fully filled → Maria resolved bucket W31: n1 due1 est1 logged1
    { assignee: "Alvarez, Maria", resolved: d("2026-07-29"), due: d("2026-07-30"),
      estSec: 3600, spentSec: 1800, status: "Done", typeLabel: "Story" },
    // Resolved, all three missing → Maria resolved W31: n2, counts unchanged
    { assignee: "Maria Alvarez", resolved: d("2026-07-30"), due: null,
      estSec: 0, spentSec: 0, status: "Done", typeLabel: "Story" },
    // OPEN, missing due + logged, has estimate → Maria open: n1 est1
    { assignee: "Maria Alvarez", resolved: null, due: null,
      estSec: 7200, spentSec: 0, status: "In Progress", typeLabel: "Task" },
    // Open EPIC → epics are counted (matrix parity — open epics missing
    // estimates are the biggest lever)
    { assignee: "Ken Lim", resolved: null, due: d("2026-09-01"),
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Epic", isEpic: true },
    // Unattributed → in NO person bucket
    { assignee: "Stranger Danger", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Task" },
    // ⚠️ UNASSIGNED sentinel → resolver gets it, returns null → excluded
    { assignee: "⚠️ UNASSIGNED", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Task" },
    // Closed WITHOUT a resolution date → in NEITHER population (typeHygOpen_ rule)
    { assignee: "Ken Lim", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "Closed", typeLabel: "Task" },
  ] };
  var ph = personHygieneBuckets_(jira, resolve);

  var mOpen = ph.open.filter(function (b) { return b.person === "Maria Alvarez"; })[0];
  assert_(mOpen && mOpen.n === 1 && mOpen.due === 0 && mOpen.est === 1 && mOpen.logged === 0,
          "Maria open bucket counts");
  var kOpen = ph.open.filter(function (b) { return b.person === "Ken Lim"; })[0];
  assert_(kOpen && kOpen.n === 1 && kOpen.due === 1 && kOpen.est === 0,
          "open epic counted for Ken (closed-no-resolution excluded)");
  assert_(ph.open.length === 2, "exactly two open persons — unattributed excluded");

  var mRes = ph.resolved.filter(function (b) { return b.person === "Maria Alvarez"; });
  assert_(mRes.length === 1 && mRes[0].iso === "2026.W31",
          "resolved bucketed by ISO week (both fell in W31)");
  assert_(mRes[0].n === 2 && mRes[0].due === 1 && mRes[0].est === 1 && mRes[0].logged === 1,
          "resolved counts: 2 issues, one filled");

  // PREDICATE PARITY with the matrix: the same fixture through
  // typeHygieneBuckets_ must count the same fills — the roster and the matrix
  // must never disagree about the same record. The matrix counts EVERY row
  // (attributed or not): its open population is the roster's 2 PLUS the
  // unattributed one and the ⚠️ UNASSIGNED sentinel = 4.
  var th = typeHygieneBuckets_(jira, resolve, "all");
  function sum_(rows, k) { return rows.reduce(function (s, r) { return s + (r[k] || 0); }, 0); }
  assert_(sum_(th.open, "n") === 4, "matrix open population = 4 (incl. unattributed + sentinel)");
  assert_(sum_(ph.open, "n") === 2, "roster open population = 2 (attributed only)");
  // Only Maria's open Task carries estSec>0; nothing open carries spentSec>0;
  // only Ken's open Epic carries a due date. Both passes agree on each.
  assert_(sum_(th.open, "est") === 1 && sum_(ph.open, "est") === 1, "est predicate parity");
  assert_(sum_(th.open, "time") === 0 && sum_(ph.open, "logged") === 0, "logged predicate parity");
  assert_(sum_(th.open, "due") === 1 && sum_(ph.open, "due") === 1, "due predicate parity");
  Logger.log("✅ _test_personHygieneBuckets_ passed");
}
```

- [ ] **Step 2: Register the test in `node-tests.js`** — after line 42 (`_test_parseExportStamp_(); _test_typeHygieneBuckets_(); _test_leaverTest_();`) add:

```js
_test_personHygieneBuckets_();
```

- [ ] **Step 3: Run to verify it fails**

Run: `node node-tests.js`
Expected: `ReferenceError: personHygieneBuckets_ is not defined`

- [ ] **Step 4: Implement `personHygieneBuckets_`** — add in `Code.js` immediately after `typeHygieneBuckets_`'s closing brace (~line 1591), before `medianOf_`:

```js
/**
 * Per-PERSON field fill over the same populations as the by-type matrix —
 * the data behind the Actions roster (spec 2026-08-05 §6). Predicates are
 * IDENTICAL to typeHygieneBuckets_ (due present · estSec>0 · spentSec>0) so
 * the roster and the matrix can never disagree about the same record.
 * Epics are counted (open epics missing estimates are the matrix's biggest
 * lever, and the person who owns the epic owns the gap).
 * Unattributed issues carry no person and are deliberately absent — they are
 * the matrix's problem to expose, not a roster row.
 *
 * @param {Object} jira            readJiraRaw_ output (leaver-scoped)
 * @param {Function} resolvePerson raw assignee → roster display name, or null
 * @returns {{resolved:Array<{iso,person,n,due,est,logged}>,
 *            open:Array<{person,n,due,est,logged}>}}
 *          resolved is bucketed person × ISO week so the client can scope it
 *          to the analysis period; open is a snapshot (no iso), mirroring
 *          flowOpenBuckets.
 */
function personHygieneBuckets_(jira, resolvePerson) {
  var res = {}, open = {};
  function row(map, k, person) {
    if (!map[k]) map[k] = { iso: "", person: person, n: 0, due: 0, est: 0, logged: 0 };
    return map[k];
  }
  function tally(r, it) {
    r.n++;
    if (it.due && !isNaN(it.due.getTime())) r.due++;
    if ((Number(it.estSec) || 0) > 0) r.est++;
    if ((Number(it.spentSec) || 0) > 0) r.logged++;
  }
  (jira.issues || []).forEach(function (it) {
    var dn = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!dn) return;
    if (it.resolved && !isNaN(it.resolved.getTime())) {
      var r = row(res, weekKeyFromDate_(it.resolved) + "|" + dn, dn);
      r.iso = weekKeyFromDate_(it.resolved);
      tally(r, it);
    } else if (typeHygOpen_(it)) {
      tally(row(open, dn, dn), it);
    }
    // Closed without a resolution date: in NEITHER population — same rule and
    // same reason as typeHygieneBuckets_.
  });
  function out(map) { return Object.keys(map).sort().map(function (k) { return map[k]; }); }
  return { resolved: out(res), open: out(open) };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node node-tests.js`
Expected: `✅ _test_personHygieneBuckets_ passed` and the final `✅ node-tests: all suites passed`

- [ ] **Step 6: Wire into the model + config + schema bump.** Three edits in `Code.js`:

(a) In `CONFIG_DH` (top of file, line 11 block) add, next to the other UI thresholds:

```js
  // Minimum issues before a person's compliance signal is GRADED (Actions
  // roster, spec 2026-08-05). Below it the cell shows the % ungraded/grey —
  // one missing due date on one ticket must never render the same red as
  // fifteen on forty. The roster's equivalent of STD_MIN_PERIODS.
  SIGNAL_MIN_N: 4,
```

(b) In `assembleModel_`, next to the `typeHyg` assignment (~line 2777):

```js
  var personHyg = inputs.jira.available
    ? personHygieneBuckets_(jiraScoped, resolvePerson)
    : { resolved: [], open: [] };
```

and in the returned object, directly under `typeHygiene: typeHyg,` (~line 2934):

```js
    // Per-person field fill — the Actions roster (spec 2026-08-05). Same
    // predicates as typeHygiene, person grain, unattributed absent by design.
    personHygiene: personHyg,
```

and inside `meta`, next to `targets: CONFIG_DH.TARGETS,`:

```js
      signalMinN: CONFIG_DH.SIGNAL_MIN_N,
```

(c) Schema bump at ~line 3035: append to the version comment block and bump the constant:

```js
// v22: TWO-TAB CONSOLIDATION (spec 2026-08-05) — new `personHygiene`
//      (per-person field fill, resolved person×week + open snapshot) and
//      meta.signalMinN behind the Actions roster. A cached v21 model has
//      neither; the roster would render its "Not in this payload" empty state
//      for a whole TTL, so it must miss cleanly.
var DH_SCHEMA_VER_ = 22;
```

- [ ] **Step 7: Verify the model test still passes** (the existing `_test_modelAssembly_` exercises `assembleModel_` and will catch a typo in the wiring):

Run: `node node-tests.js`
Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(dh): personHygieneBuckets_ — per-person field fill behind the Actions roster (schema v22)"
```

---

### Task 2: Move the flow tiles into the Executive tab (compact tier), retire the 🌊 Flow tab

**Files:**
- Modify: `Dashboard.html` (pane HTML ~lines 405–443; `VIEWS` ~line 488; `renderAll_` ~line 1306; `renderFlow_` ~line 2463; CSS `:root` block area for the new compact-tile class)
- Modify: `render-smoke.js` (tab-count assertions; any `switchView_("flow")` usage)

- [ ] **Step 1: Move the pane container.** Delete the whole `viewFlow` pane block (lines 438–443, `<!-- 🌊 Flow… -->` through its closing `</div>`). Inside `viewExec` (line 406), directly after `<div class="tiles" id="tiles"></div>` (line 409), add:

```html
    <!-- Compact flow tier (spec 2026-08-05 §4.1): the five live flow reads as
         smaller neutral tiles inside the same KPI block. The 🌊 Flow tab is
         retired; declared-absent placeholders (Cycle Time, Flow Efficiency)
         no longer render — the registry stays their record. -->
    <div class="tiles tilesCompact" id="flowTiles"></div>
```

- [ ] **Step 2: Add the compact-tile CSS.** Next to the existing `.tiles` / `.tile` rules (search `".tiles"` in the `<style>` block), add:

```css
.tilesCompact .tile{padding:10px 12px}
.tilesCompact .big{font-size:calc(20px*var(--scale));line-height:1.2}
.tilesCompact .lbl{font-size:calc(10px*var(--scale))}
```

- [ ] **Step 3: Remove the Flow entry from `VIEWS`** (line 496–497) and delete the `case "flow": renderFlow_(); break;` line from `renderAll_` (line 1312), adding `renderFlow_()` to the exec branch instead:

```js
    case "exec":    renderTiles_(); renderFlow_(); renderCompare_(); break;
```

- [ ] **Step 4: Stop rendering the absent placeholders.** In `renderFlow_` (~line 2463) delete the two `flowTileHtml_(reg.cycleTime …)` (~line 2506) and `flowTileHtml_(reg.flowEfficiency …)` (~line 2598) statements, keeping their numbered comments' information by folding it into one comment:

```js
  // 2/6 · Cycle Time and Flow Efficiency are declared ABSENT in the registry
  // (no in-progress timestamps / no queue-state instrumentation). They used to
  // render as "—" placeholder tiles; retired from the UI 2026-08-05 (spec
  // §4.1) — the registry + Data Reference remain the record of what is
  // deliberately not measured.
```

Also keep the Flow PNG button: move the `savePng_('flowTiles','flow')` button div (old lines 440–441) is **deleted** — the exec strip's existing PNG button at line 407 must now capture both tiers, so change its target from `'tiles'` to a new wrapper. Wrap both tile divs in one container:

```html
    <div id="kpiStrip">
      <div class="tiles" id="tiles"></div>
      <div class="tiles tilesCompact" id="flowTiles"></div>
    </div>
```

and change the button call to `savePng_('kpiStrip','tiles')`.

- [ ] **Step 5: Update `render-smoke.js`.** Search it for `"flow"` / `viewFlow` / tab-count assertions (e.g. counting `tabBar` children). Update: expected tab labels no longer include `🌊 Flow`; `renderFlow_` is still exported by the bridge (keep it — assertions on flow tile grammar remain valid, they just render into `flowTiles` inside exec now); any `switchView_("flow")` becomes `switchView_("exec")` with the assertion that `flowTiles` is populated after the exec render. Add one new assertion:

```js
// Absent placeholders retired (spec 2026-08-05 §4.1): the compact tier must
// not render Cycle Time / Flow Efficiency "—" tiles.
C.renderAll_();
var flowHtml = document.getElementById("flowTiles").innerHTML;
assert_(flowHtml.indexOf("Cycle Time") === -1 && flowHtml.indexOf("Flow Efficiency") === -1,
        "declared-absent flow tiles no longer render");
assert_(flowHtml.indexOf("Lead Time") !== -1, "live flow tiles render inside the exec strip");
```

- [ ] **Step 6: Run both runners**

Run: `node node-tests.js && node render-smoke.js`
Expected: both green. Iterate on the smoke expectations you touched until they describe the new reality (the existing assertions are documentation — read each failure and decide whether the assertion moved or your edit broke a rule).

- [ ] **Step 7: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): flow tiles join the Executive KPI strip as a compact tier; Flow tab + absent placeholders retired"
```

---

### Task 3: Consolidate to three tabs — 🎯 Actions absorbs Headroom + 🧬 matrix + gaps queue; People + Hygiene retired

**Files:**
- Modify: `Dashboard.html` (panes 416–451; `VIEWS` 488–504; `switchView_`/`renderAll_`; `renderHygiene_` 4099+ refactor; `showHygiene_` 4518; delete `renderGrid_` and the People pane; `saveCsv_` 4555)
- Modify: `render-smoke.js` (bridge exports + assertions)

- [ ] **Step 1: Rebuild the pane HTML.** Replace the `viewTrend` pane (lines 416–424), the `viewPeople` pane (lines 426–436) and the `viewHygiene` pane (lines 445–447) with ONE pane (keep `viewAccess` untouched):

```html
  <!-- ── 🎯 ACTIONS — everything person- and field-level (spec 2026-08-05 §5).
       Admin + viewer only (inherits the old Headroom gate). Reading order:
       headroom → people signals roster → 🧬 by-type matrix → gaps queue. ── -->
  <div id="viewActions" class="viewPane" style="display:none">
    <div style="text-align:right;margin-bottom:6px">
      <button class="iconbtn" onclick="saveCsv_()" title="Download the signals roster (one row per person: signal values, offending counts, hours split) as CSV">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>CSV</button>
      <button class="iconbtn" onclick="savePng_('viewActions','actions')" title="Save this view as a PNG image">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>PNG</button>
    </div>
    <div class="panel" id="oppPanel"></div>
    <div class="panel" id="rosterPanel" style="margin-top:14px"></div>
    <div class="panel" id="hygPanel" style="margin-top:14px"></div>
  </div>
```

- [ ] **Step 2: Rewrite `VIEWS`** (lines 488–504) to:

```js
var VIEWS = [
  { id: "exec",    label: "📊 Executive", pane: "viewExec",    roles: null,
    hint: "The KPI strip, one comparison, the people-signals pulse and the data-trust strip — the 30-second read." },
  // "Actions", not "Accountability" (review 2026-08-05): the matrix and gaps
  // queue are about fields and requirements, not people — a people-blame
  // banner over them framed the whole tab wrong.
  { id: "actions", label: "🎯 Actions",   pane: "viewActions", roles: ["admin", "viewer"],
    hint: "Who and what needs action: per-person headroom, the compliance signals roster, field fill by issue type and the gaps queue." },
  { id: "access",  label: "🔒 Access",    pane: "viewAccess",  roles: ["admin"],
    hint: "Manage who can open this dashboard." },
];
```

- [ ] **Step 3: Re-route everything that pointed at the dead ids.**
  - `renderAll_` (line 1306): dispatch becomes

```js
  switch (STATE.view) {
    case "exec":    renderTiles_(); renderFlow_(); renderCompare_(); break;
    case "actions": renderOpportunity_(); renderRoster_(); renderHygPanel_(); break;
    case "access":  renderAccess_(); break;
  }
```

  (`renderRoster_` arrives in Task 5 — for THIS task define it as a stub that writes the pre-v22 empty state, so the tab is shippable at every commit:)

```js
/** Roster placeholder until Task 5 — pre-v22 payloads land here too. */
function renderRoster_() {
  document.getElementById("rosterPanel").innerHTML =
    '<h3>👥 People signals</h3><div class="emptyState">Not in this payload — ↻ Refresh to rebuild on the current schema.</div>';
}
```

  - `showHygiene_` (line 4518) becomes `function showHygiene_() { switchView_("actions"); }` (keep the alias — the suppressed KPI cards call it by name).
  - Search the file for `switchView_("trend")`, `switchView_("hygiene")`, `switchView_("people")`, `"viewTrend"`, `"viewPeople"`, `"viewHygiene"` and re-point each to `"actions"` / `"viewActions"` (the Headroom "What's missing" link is one of them).
  - `STATE.view` default stays `"exec"`; keep `expandedWeeks`/`openDetail` keys (drill-down reuses them in Task 6).

- [ ] **Step 4: Refactor `renderHygiene_` → `renderHygPanel_` + extracted `gapsRows_`.** In `renderHygiene_` (line 4099):
  - Extract the `gaps` array literal (lines 4123–4189) into a standalone function so Task 8's trust strip can reuse the SAME definitions — add a `key` to the four rows the strip will pick:

```js
/** The gap definitions, extracted so the gaps queue and the Executive
    data-trust strip render from ONE list (spec §4.4/§5.4). `key` marks the
    four the strip shows. */
function gapsRows_(h, pp) {
  return [
    { key: "due", name: "Due date on the work On-Time measures", /* …unchanged body… */ },
    { name: "Resolved work carries a Jira assignee", /* …unchanged… */ },
    { key: "attr", name: "…and that assignee resolves to a roster person", /* …unchanged… */ },
    /* …Region, Team rows unchanged… */
    { key: "est", name: "Estimate on closed epics", /* …unchanged… */ },
    { key: "logged", name: "Logged time on estimated epics", /* …unchanged… */ },
    /* …remaining rows unchanged… */
  ];
}
```

  (Copy each row's existing body verbatim — only the wrapper function and the four `key:` fields are new.)
  - Rename `renderHygiene_` to `renderHygPanel_`, target `document.getElementById("hygPanel")` instead of `viewHygiene`, and change its layout to: 🧬 matrix FIRST, gaps queue SECOND (spec order §5.3–5.4). The matrix call (`typeMatrixHtml_(isos, winLabel)`) and the queue table markup move inside unchanged. Drop the `<h3>🧪 Data Hygiene</h3>` heading; the two sub-panels keep their own `<h4>`s.
  - Delete the old top-level "Data Hygiene" KPI-tile remnants only if they still render (read the function end-to-end while you're in it; the 2026-08-05 run already removed Data Profile funnels/Brief).

- [ ] **Step 5: Delete the People grid.** Remove `renderGrid_`, `toggleAllWeeks_`, `syncExpandAllBtn_` and the old `saveCsv_` body (line 4555 — Task 7 in this plan rewrites CSV for the roster; for THIS task make `saveCsv_` a no-op that alerts "CSV returns with the signals roster" is NOT acceptable — instead keep the function but have it export the opportunity table rows so the button never dead-ends):

```js
/** CSV of the opportunity table (interim — Task 5 re-points this at the
    signals roster). One row per person: rate, gap, opportunity hours. */
function saveCsv_() {
  var done = donePeriods_(), hi = headPeriodIdx_(done), head = done[hi];
  if (!head) return;
  var ser = metricSeries_(METRICS_.util, done);
  var norm = ser.std && ser.std.ok ? ser.std.baseline : null;
  var rows = oppRows_(head, [head], norm);
  var lines = ["Person,Region,Rate %,Gap pts,Opportunity h"];
  rows.forEach(function (r) {
    lines.push([csvCell_(r.name), csvCell_(r.region), r.rate === null ? "" : r.rate.toFixed(1),
                r.gap === null ? "" : r.gap.toFixed(1), r.opp.toFixed(1)].join(","));
  });
  downloadCsv_(lines.join("\n"), "delivery-headroom");
}
```

  ⚠️ `csvCell_` / `downloadCsv_`: the old `saveCsv_` body already has quoting and download plumbing — extract those two helpers from it rather than writing new ones, then delete the rest.

- [ ] **Step 6: Update `render-smoke.js`.** In the bridge (lines 89–117): remove `renderGrid_`, rename `renderHygiene_` → `renderHygPanel_`, add `renderRoster_`, `gapsRows_`. In the assertions: tab count expectations become 3 (admin) / role-gated variants; `switchView_("hygiene")` → assert it now lands on `actions` (via `showHygiene_()`); grid assertions deleted; matrix assertions re-target `hygPanel`. Add:

```js
// Deep links from the suppressed cards land on Actions (spec §3).
C.setState("view", "exec");
C.switchView_("hygiene");                       // dead id → falls back to exec
assert_(C.STATE.view === "exec", "unknown view id falls back to exec");
C.showHygiene_();
assert_(C.STATE.view === "actions", "showHygiene_ re-routes to the Actions tab");
```

  (Check how `viewDef_` handles an unknown id — it returns `VIEWS[0]` (line 506), so the first assertion holds. If `switchView_` gates differently, assert what the code actually guarantees: never a blank pane.)

- [ ] **Step 7: Run both runners; fix what the assertions teach you**

Run: `node node-tests.js && node render-smoke.js`
Expected: green. The smoke run WILL fail on assertions you haven't found yet (this file asserts nav counts in several places) — treat each failure as a checklist item.

- [ ] **Step 8: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): three tabs — Actions absorbs headroom + matrix + gaps queue; People grid and Hygiene tab retired"
```

---

### Task 4: Client signals engine — `SIGNAL_FIELDS_`, grading, small-n guard

**Files:**
- Modify: `Dashboard.html` (new functions next to `TYPE_FIELDS_`/`typeFieldGate_`, ~line 4240 area)
- Modify: `render-smoke.js` (bridge + new assertions)

- [ ] **Step 1: Write the failing smoke assertions first.** In `render-smoke.js`, after the existing matrix assertions, add (adjust the synthetic model builder to include a `personHygiene` block and `meta.signalMinN: 4` — find where the synthetic MODEL is constructed, ~line 120 onward, and extend it):

```js
// ── Actions roster grading (spec §5.2) ──────────────────────
// personSignalRows_ grades vs the matrix gates; below signalMinN the cell is
// "small" (grey, % still shown) and never red.
(function () {
  var model = C.getModel();
  model.personHygiene = {
    open: [
      { person: "Maria Alvarez", n: 10, due: 3, est: 10, logged: 9 },  // due red, est green
      { person: "Ken Lim",       n: 1,  due: 0, est: 0,  logged: 0 },  // ALL small — never red
    ],
    resolved: [],
  };
  model.meta.signalMinN = 4;
  C.setModel(model);
  var rows = C.personSignalRows_([]);
  var maria = rows.filter(function (r) { return r.p.name === "Maria Alvarez"; })[0];
  var ken   = rows.filter(function (r) { return r.p.name === "Ken Lim"; })[0];
  assert_(maria && maria.sig.due.cls === "bad", "30% due fill vs 0.8 gate grades bad");
  assert_(maria.sig.est.cls === "good", "100% est fill grades good");
  assert_(maria.overall === "bad", "overall = worst graded signal");
  assert_(ken && ken.sig.due.cls === "small" && ken.overall === "na",
          "1-issue person is SMALL/ungraded, never red (review 2026-08-05 #1)");
  var sum = C.signalSummary_([]);
  assert_(sum.bad === 1 && sum.small === 1,
          "summary counts exclude small-n rows from the red count");
})();
```

  Note: `personSignalRows_` walks `filteredPeople_()`, so "Maria Alvarez" and "Ken Lim" must exist in the synthetic `model.people` with `tracks !== false` and pass default filters — reuse the names the synthetic model already has (read the model builder and substitute ITS names into this block rather than inventing new people).

- [ ] **Step 2: Run to verify failure**

Run: `node render-smoke.js`
Expected: `personSignalRows_ is not defined` (after you add it to the bridge exports — do that now: `" personSignalRows_: personSignalRows_, signalSummary_: signalSummary_, SIGNAL_FIELDS_: SIGNAL_FIELDS_,"`).

- [ ] **Step 3: Implement.** In `Dashboard.html`, directly below `typeFieldGate_` (line 4272), add:

```js
// ── 👥 PEOPLE SIGNALS (Actions roster, spec 2026-08-05 §5.2) ─────────────────
// Same fields, same gates as the 🧬 matrix — one truth. Person grain.

var SIGNAL_FIELDS_ = [
  { k: "due",    label: "Due date", gateOf: "onTime",
    tip: "Share of this person's issues carrying a due date. Same predicate and gate as the 🧬 matrix — the two surfaces can never disagree about a record." },
  { k: "est",    label: "Estimate", gateOf: "forecast",
    tip: "Share carrying an original estimate." },
  { k: "logged", label: "Logged",   gateOf: "forecast",
    tip: "Share carrying logged time (Jira Time Spent > 0)." },
];

function signalMinN_() { return (MODEL.meta && MODEL.meta.signalMinN) || 4; }

/**
 * Grade one signal. Below signalMinN_ the cell is "small": grey, ungraded,
 * % still shown — one missing due date on one ticket must never render the
 * same red as fifteen on forty (review 2026-08-05 #1; the roster's
 * STD_MIN_PERIODS). "na" = nothing to grade at all.
 */
function gradeSignal_(hit, n, gate) {
  if (!n) return { cls: "na", pct: null, miss: 0 };
  var pct = hit / n;
  var out = { pct: pct, miss: n - hit };
  if (n < signalMinN_()) { out.cls = "small"; return out; }
  if (gate === null)      { out.cls = "na";    return out; }
  out.cls = pct >= gate ? "good" : pct >= gate - 0.10 ? "warn" : "bad";
  return out;
}

var SIGNAL_RANK_ = { bad: 3, warn: 2, good: 1 };

/**
 * One row per person in the filtered population. Returns null on a pre-v22
 * payload (renderers show the same "Not in this payload" state as the matrix).
 * Population follows the 🧬 matrix's Open ↔ Resolved toggle (STATE.typePop);
 * isos scope the resolved half only — a backlog has no history to walk.
 * Interns excluded like every ranking surface (oppRows_ precedent).
 */
function personSignalRows_(isos) {
  var ph = MODEL.personHygiene;
  if (!ph) return null;
  var byName = {};
  if (STATE.typePop === "resolved") {
    (ph.resolved || []).forEach(function (b) {
      if (isos.indexOf(b.iso) === -1) return;
      var t = byName[b.person] || (byName[b.person] = { n: 0, due: 0, est: 0, logged: 0 });
      t.n += b.n; t.due += b.due; t.est += b.est; t.logged += b.logged;
    });
  } else {
    (ph.open || []).forEach(function (b) {
      byName[b.person] = { n: b.n, due: b.due, est: b.est, logged: b.logged };
    });
  }
  var m = (MODEL.meta.registry || {}).metrics || {};
  return filteredPeople_().filter(function (p) { return !p.isIntern; }).map(function (p) {
    var t = byName[p.name] || { n: 0, due: 0, est: 0, logged: 0 };
    var sig = {}, worst = 0, miss = 0;
    SIGNAL_FIELDS_.forEach(function (f) {
      var gate = m[f.gateOf] ? m[f.gateOf].coverageGate : null;
      var g = gradeSignal_(t[f.k], t.n, gate);
      sig[f.k] = g;
      if (SIGNAL_RANK_[g.cls]) { worst = Math.max(worst, SIGNAL_RANK_[g.cls]); miss += g.miss; }
    });
    var overall = worst === 3 ? "bad" : worst === 2 ? "warn" : worst === 1 ? "good" : "na";
    return { p: p, n: t.n, sig: sig, overall: overall, miss: miss };
  });
}

/** 🟢/🟡/🔴 counts for the Executive pulse. Small-n rows are counted apart —
    NEVER in bad (they would inflate the reds with statistical noise). */
function signalSummary_(isos) {
  var rows = personSignalRows_(isos);
  var out = { good: 0, warn: 0, bad: 0, small: 0, na: 0, available: rows !== null };
  (rows || []).forEach(function (r) {
    if (r.overall === "na") {
      // A row is "small" for the summary when it HAS issues but none graded.
      out[r.n > 0 ? "small" : "na"]++;
    } else out[r.overall]++;
  });
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node render-smoke.js`
Expected: green including the new block.

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): people-signals engine — matrix-gate grading with small-n guard (SIGNAL_MIN_N)"
```

---

### Task 5: The signals roster table — render, sort, shared toggle, scope-tagged headers

**Files:**
- Modify: `Dashboard.html` (replace the `renderRoster_` stub; new CSS; shared chip strip placement in `renderHygPanel_`/`typeMatrixHtml_`)
- Modify: `render-smoke.js`

- [ ] **Step 1: Failing smoke assertions:**

```js
// Roster renders one row per population person, sorts by opportunity first,
// and the RAG cells carry % + missing count (spec §5.2).
C.setState("view", "actions");
C.setState("typePop", "open");
C.renderAll_();
var roster = document.getElementById("rosterPanel").innerHTML;
assert_(roster.indexOf("sigBad") !== -1, "a red cell renders with the sigBad class");
assert_(roster.indexOf("missing") !== -1, "cells state the offending count");
assert_(roster.indexOf("SNAP") !== -1, "signal headers carry the SNAP scope tag on the open population");
C.setRosterSort_("due");
assert_(C.STATE.rosterSort === "due", "clicking a header re-sorts");
```

- [ ] **Step 2: Run — fails** (`setRosterSort_` undefined). Add `renderRoster_`, `setRosterSort_`, `rosterRows_` to the bridge.

- [ ] **Step 3: Implement.** Replace the Task-3 stub with:

```js
// ── 👥 SIGNALS ROSTER RENDER (spec §5.2) ─────────────────────────────────────
// Default sort: biggest opportunity first — most-red overall, then most
// offending records. The Executive pulse deep-links here with this sort.
var ROSTER_RANK_ = { bad: 0, warn: 1, small: 2, good: 3, na: 4 };
var ROSTER_COLS_ = {
  person: { label: "Person", sort: function (a, b) { return a.p.name.localeCompare(b.p.name); } },
  n:      { label: "n",      sort: function (a, b) { return b.n - a.n; } },
  due:    { label: "Due date", sig: "due" },
  est:    { label: "Estimate", sig: "est" },
  logged: { label: "Logged",   sig: "logged" },
  hours:  { label: "Hours",  sort: null /* Task 6 fills this in */ },
  opp:    { label: "Overall", sort: function (a, b) {
    return (ROSTER_RANK_[a.overall] - ROSTER_RANK_[b.overall]) || (b.miss - a.miss);
  } },
};
// Signal columns share one sorter: worst grade first, most missing first.
Object.keys(ROSTER_COLS_).forEach(function (k) {
  var c = ROSTER_COLS_[k];
  if (c.sig) c.sort = function (a, b) {
    return (ROSTER_RANK_[a.sig[c.sig].cls] - ROSTER_RANK_[b.sig[c.sig].cls]) ||
           (b.sig[c.sig].miss - a.sig[c.sig].miss);
  };
});

function setRosterSort_(col) {
  if (STATE.rosterSort === col) STATE.rosterDesc = !STATE.rosterDesc;
  else { STATE.rosterSort = col; STATE.rosterDesc = false; }
  renderRoster_();
}

function sigCellHtml_(g) {
  if (g.cls === "na") return '<td class="tnum">—</td>';
  var pct = Math.round(g.pct * 100) + "%";
  var body = g.cls === "small"
    ? '<span class="sigDot sigSmall" title="Fewer than ' + signalMinN_() +
      ' issues — shown ungraded: one missing field on one ticket is not a signal (SIGNAL_MIN_N).">●</span> ' + pct
    : '<span class="sigDot sig' + g.cls.charAt(0).toUpperCase() + g.cls.slice(1) + '">●</span> ' + pct;
  return '<td class="tnum">' + body +
    (g.miss ? ' <span class="cellSub">· ' + g.miss + " missing</span>" : "") + "</td>";
}

function renderRoster_() {
  var el = document.getElementById("rosterPanel");
  var done = donePeriods_(), hi = headPeriodIdx_(done);
  var head = done[hi] || { label: "—", isos: [] };
  var rows = personSignalRows_(head.isos);
  if (rows === null) {
    el.innerHTML = '<h3>👥 People signals</h3><div class="emptyState">Not in this payload — ↻ Refresh to rebuild on the current schema.</div>';
    return;
  }
  var open = STATE.typePop !== "resolved";
  var scopeTag = open ? scopeTag_("snap") : scopeTag_("period");
  var col = ROSTER_COLS_[STATE.rosterSort] || ROSTER_COLS_.opp;
  rows.sort(col.sort);
  if (STATE.rosterDesc) rows.reverse();

  var head_ = "<tr>" + Object.keys(ROSTER_COLS_).map(function (k) {
    var c = ROSTER_COLS_[k];
    var tag = (c.sig || k === "opp" || k === "n") ? " " + scopeTag
            : k === "hours" ? " " + scopeTag_("period") : "";
    return '<th class="' + (k === "person" ? "tname" : "tnum") + '" onclick="setRosterSort_(\'' + k + '\')" style="cursor:pointer"' +
      (c.sig ? ' title="' + esc_(sigFieldByKey_(c.sig).tip) + '"' : "") + ">" +
      esc_(c.label) + tag + (STATE.rosterSort === k ? (STATE.rosterDesc ? " ▾" : " ▴") : "") + "</th>";
  }).join("") + "</tr>";

  var body = rows.map(function (r) {
    return '<tr>' +
      '<td class="tname"><span class="rosterName" style="cursor:pointer" onclick="toggleRosterDetail_(\'' +
        esc_(r.p.name).replace(/'/g, "\\'") + '\')" title="' + esc_(r.p.jobTitle || "") + '">▸ ' +
        esc_(r.p.name) + "</span></td>" +
      '<td class="tnum">' + r.n + "</td>" +
      sigCellHtml_(r.sig.due) + sigCellHtml_(r.sig.est) + sigCellHtml_(r.sig.logged) +
      '<td class="tnum">' + hoursCellHtml_(r.p, head.isos) + "</td>" +
      sigCellHtml_({ cls: r.overall, pct: null, miss: r.miss }) +
      "</tr>" + rosterDetailRow_(r.p, head);
  }).join("");

  el.innerHTML =
    '<h3>👥 People signals — every active person in this slice</h3>' +
    '<p class="cellSub">Each cell: the share of the person\'s issues carrying that field, graded against ' +
    "the field's own gate — the same gates as the 🧬 matrix below. Grey = fewer than " + signalMinN_() +
    " issues (not graded). Click a header to sort; default is biggest opportunity first.</p>" +
    '<div class="gwrap"><table class="hyg tmx">' + head_ + body + "</table></div>";
}

/** SIGNAL_FIELDS_ lookup by key. */
function sigFieldByKey_(k) {
  for (var i = 0; i < SIGNAL_FIELDS_.length; i++) if (SIGNAL_FIELDS_[i].k === k) return SIGNAL_FIELDS_[i];
  return { tip: "" };
}
```

  Interim stubs so this task stands alone (Task 6 replaces them):

```js
function hoursCellHtml_() { return "—"; }
function rosterDetailRow_() { return ""; }
function toggleRosterDetail_() {}
function scopeTag_(kind) {  // full version arrives in Task 9; this one is real, not placeholder
  var t = { period: ["PERIOD", "Analysis period — follows the period picker and every filter."],
            snap:   ["SNAP",   "Snapshot at the last export — follows filters, ignores the period picker."],
            org:    ["ORG",    "Whole org — deliberately ignores filters and the period picker."] }[kind];
  return '<span class="scopeTag" title="' + esc_(t[1]) + '">' + t[0] + "</span>";
}
```

  Add `rosterSort: "opp", rosterDesc: false` to the `STATE` literal (line 464), a `sigPct is never colour-alone` reminder: the % text always renders next to the dot (FR-4.4 pattern). CSS next to the matrix styles:

```css
.sigDot{font-size:12px}
.sigGood{color:var(--c-good)} .sigWarn{color:var(--c-warn)} .sigBad{color:var(--c-bad)}
.sigSmall{color:var(--muted)}
.scopeTag{font-size:9px;letter-spacing:.08em;color:var(--muted);border:1px solid var(--border);border-radius:4px;padding:0 4px;vertical-align:middle}
```

- [ ] **Step 4: One toggle scopes roster + matrix.** In `renderHygPanel_`, render the Open ↔ Resolved chip strip ONCE above the matrix and make `setTypePop_` re-render both surfaces (find `setTypePop_` — it currently re-renders the matrix; add `renderRoster_();`). Remove the chips from inside `typeMatrixHtml_`? **No** — the matrix's PNG capture deliberately includes its chips (comment at Dashboard.html:4482). Instead: keep the matrix chips, and have the roster STATE follow the same `STATE.typePop` (already does). The roster header states the population in its lead line: add to the `<p class="cellSub">` lead: `open ? "Open backlog — fix these and next period moves." : "Resolved in " + head.label + "."`.

- [ ] **Step 5: Run both runners** — iterate until green.

- [ ] **Step 6: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): signals roster — full-population RAG table, sortable, shared Open/Resolved population"
```

---

### Task 6: Hours column (billable/non-billable with eligibility) + per-person drill-down

**Files:**
- Modify: `Dashboard.html` (replace `hoursCellHtml_`, `rosterDetailRow_`, `toggleRosterDetail_` stubs)
- Modify: `render-smoke.js`

- [ ] **Step 1: Failing smoke assertions:**

```js
// Hours bar: ramping person gets NO idle segment + a ramping chip and sorts
// last on billable share (review 2026-08-05 #2 — eligibility parity with
// the opportunity table).
// Make one synthetic person a new hire first:
(function () {
  var model = C.getModel();
  model.people.forEach(function (p) { if (p.name === "<PICK A SYNTHETIC NAME>") p.newHire = true; });
  C.setModel(model); C.renderAll_();
  var html = document.getElementById("rosterPanel").innerHTML;
  assert_(html.indexOf("ramping") !== -1, "ramping chip renders in the Hours cell");
  assert_(html.indexOf("segIdle") === -1 || html.split("segIdle").length - 1 <
          html.split("segBill").length - 1, "idle suppressed for the ramping row");
})();
```

  (Substitute the real synthetic-person name from the model builder.)

- [ ] **Step 2: Implement `hoursCellHtml_`:**

```js
/**
 * Billable / non-billable / idle mini-bar for the analysis period — the same
 * per-person numbers the retired People-grid workload bars drew (aggWeeks_).
 * ALWAYS period-scoped (worklogs are period-shaped; a backlog snapshot has no
 * hours) — the header carries a PERIOD tag for exactly this reason.
 * ELIGIBILITY reuses the opportunity table's exclusions (review 2026-08-05
 * #2): ramping new hires and on-leave people get no idle segment — their
 * "idle" is the explanation, not a recoverable signal — and sort last.
 */
function hoursCellHtml_(p, isos) {
  var w = aggWeeks_(p, isos);
  if (!w || !(w.avail > 0)) return "—";
  var ineligible = p.newHire === true || p.onLeave === true;
  var idle = Math.max(0, w.avail - w.tracked);
  var total = Math.max(w.avail, w.tracked, 1);
  function seg(h, cls, label) {
    if (!(h > 0)) return "";
    return '<i class="' + cls + '" style="width:' + Math.round(h / total * 100) + '%" title="' +
      label + " " + r1_(h) + 'h"></i>';
  }
  return '<div class="hbarMini" title="billable ' + r1_(w.billable) + "h · non-billable " +
    r1_(w.nonBillable) + "h · idle " + r1_(idle) + 'h of ' + r1_(w.avail) + 'h scheduled">' +
    seg(w.billable, "segBill", "billable") +
    seg(w.nonBillable, "segNonbill", "non-billable") +
    (ineligible ? "" : seg(idle, "segIdle", "idle")) +
    "</div>" +
    (ineligible ? '<span class="cellSub" title="Ramping new hire / on leave — idle capacity is the explanation here, not a coaching signal (same exclusion as the headroom table).">' +
      (p.onLeave ? "on leave" : "ramping") + "</span>" : "");
}
```

  CSS (tokens already exist — `--seg-bill`/`--seg-nonbill`/`--seg-idle`, Dashboard.html:34):

```css
.hbarMini{display:inline-flex;width:110px;height:9px;border-radius:4px;overflow:hidden;background:var(--surface-2);vertical-align:middle}
.hbarMini i{display:block;height:100%}
.hbarMini .segBill{background:var(--seg-bill)} .hbarMini .segNonbill{background:var(--seg-nonbill)} .hbarMini .segIdle{background:var(--seg-idle)}
```

  Sorting: fill `ROSTER_COLS_.hours.sort`:

```js
ROSTER_COLS_.hours.sort = function (a, b) {
  function share(r) {
    if (r.p.newHire === true || r.p.onLeave === true) return null;   // ineligible → last
    var w = aggWeeks_(r.p, ROSTER_ISOS_);
    return w && w.tracked > 0 ? w.billable / w.tracked : null;
  }
  var sa = share(a), sb = share(b);
  return (sb === null ? -1 : sb) - (sa === null ? -1 : sa);
};
```

  `ROSTER_ISOS_`: set as a module-scoped `var` that `renderRoster_` refreshes (`ROSTER_ISOS_ = head.isos;`) before sorting — the sorter has no other way to know the period.

- [ ] **Step 3: Implement the drill-down.** Replace the stubs:

```js
function toggleRosterDetail_(name) {
  STATE.openDetail[name] = !STATE.openDetail[name];
  renderRoster_();
}

/** ▸ row: the person's open backlog items (backlogByPerson_ payload, already
    on p.backlog) + the period's hours line — the People grid's per-person
    detail, reattached where the signal is (spec §5.2). */
function rosterDetailRow_(p, head) {
  if (!STATE.openDetail[p.name]) return "";
  var w = aggWeeks_(p, head.isos);
  var hours = w
    ? "Tracked " + r1_(w.tracked) + "h of " + r1_(w.avail) + "h scheduled in " + esc_(head.label) +
      (w.billable > 0 || w.nonBillable > 0
        ? " · billable " + r1_(w.billable) + "h · non-billable " + r1_(w.nonBillable) + "h" : "")
    : "No scheduled capacity in " + esc_(head.label);
  var items = (p.backlog && p.backlog.items) || [];
  var list = items.length
    ? '<table class="hyg"><tr><th>Key</th><th>Summary</th><th>Status</th><th class="tnum">Rem. h</th><th>Due</th></tr>' +
      items.map(function (it) {
        return "<tr><td>" + esc_(it.key) + "</td><td>" + esc_(it.summary) + "</td><td>" +
          esc_(it.status) + '</td><td class="tnum">' + r1_(it.remHrs) + "</td><td>" +
          (it.due || '<span class="sigBad">—</span>') + "</td></tr>";
      }).join("") + "</table>" +
      (p.backlog.count > items.length
        ? '<div class="cellSub">Top ' + items.length + " of " + p.backlog.count + " open items (by remaining hours).</div>" : "")
    : '<div class="cellSub">No open backlog items attributed to this person.</div>';
  return '<tr class="detailRow"><td colspan="7"><div class="cellSub">' + hours + "</div>" + list + "</td></tr>";
}
```

  ⚠️ `colspan="7"` must equal `Object.keys(ROSTER_COLS_).length` — compute it: `'<td colspan="' + Object.keys(ROSTER_COLS_).length + '">'`.

- [ ] **Step 4: Run both runners.** Also re-run `node node-tests.js` (client-parity test re-extracts `aggWeeks_` etc. from the HTML — a syntax slip in this file breaks it).

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): roster Hours column with headroom-table eligibility + per-person drill-down rows"
```

---

### Task 7: Executive people-signals pulse (counts-only, margin-gated, deep link) + roster CSV

**Files:**
- Modify: `Dashboard.html` (new block in `viewExec` pane + renderer; `saveCsv_` rewrite)
- Modify: `render-smoke.js`

- [ ] **Step 1: Failing smoke assertions:**

```js
// Pulse: counts only, never names; hidden without margin tier; deep-links to
// Actions pre-sorted by opportunity (spec §4.3).
C.setState("view", "exec"); C.renderAll_();
var pulse = document.getElementById("pulsePanel").innerHTML;
assert_(pulse.indexOf("on track") !== -1, "pulse renders counts");
// NO names on the Executive pulse — check every synthetic person by name:
C.getModel().people.forEach(function (p) {
  assert_(pulse.indexOf(p.name) === -1, "pulse must not name " + p.name);
});
C.getModel().viewerRole = "guest"; C.renderAll_();
assert_(document.getElementById("pulsePanel").innerHTML === "", "pulse hidden from open-access guests");
C.getModel().viewerRole = "admin";
C.openRoster_();
assert_(C.STATE.view === "actions" && C.STATE.rosterSort === "opp", "deep link lands sorted by opportunity");
```

- [ ] **Step 2: Implement.** Pane HTML — inside `viewExec`, between the comparison panel (line 413) and wherever the trust strip lands (Task 8), add `<div class="panel" id="pulsePanel" style="margin-bottom:14px"></div>`. Renderer (near `renderTiles_`), called from the exec branch of `renderAll_`:

```js
/** 👥 pulse — counts only, never names (standing rule: names live behind the
    Actions gate). Hidden, not dimmed, without margin tier — same doctrine as
    the Utilization card. */
function renderPulse_() {
  var el = document.getElementById("pulsePanel");
  if (!canSeeMargin_()) { el.innerHTML = ""; el.style.display = "none"; return; }
  el.style.display = "";
  var done = donePeriods_(), hi = headPeriodIdx_(done);
  var head = done[hi] || { label: "—", isos: [] };
  var s = signalSummary_(head.isos);
  if (!s.available) { el.innerHTML = '<div class="cellSub">People signals arrive after the next refresh (new payload).</div>'; return; }
  // Recoverable hours: the SAME number the headroom table headlines.
  var ser = metricSeries_(METRICS_.util, done);
  var norm = ser.std && ser.std.ok ? ser.std.baseline : null;
  var opp = 0;
  if (norm !== null) oppRows_(head, [head], norm).forEach(function (r) {
    if (!r.ramping && r.opp > 0.5) opp += r.opp;
  });
  el.innerHTML =
    '<h3>👥 People signals ' + scopeTag_(STATE.typePop === "resolved" ? "period" : "snap") + "</h3>" +
    '<div class="pulseRow" onclick="openRoster_()" style="cursor:pointer" title="Open the full roster on the Actions tab, sorted by biggest opportunity">' +
    '<span class="sigDot sigGood">●</span> ' + s.good + " on track · " +
    '<span class="sigDot sigWarn">●</span> ' + s.warn + " watch · " +
    '<span class="sigDot sigBad">●</span> ' + s.bad + " need action" +
    (s.small ? ' · <span class="sigDot sigSmall" title="Have issues but fewer than ' + signalMinN_() +
      ' — ungraded, never counted red.">●</span> ' + s.small + " ungraded (small n)" : "") +
    (norm !== null ? " · <b>" + Math.round(opp) + "h</b> recoverable" : "") +
    " → open the roster</div>";
}

function openRoster_() {
  STATE.rosterSort = "opp"; STATE.rosterDesc = false;
  switchView_("actions");
}
```

- [ ] **Step 3: Rewrite `saveCsv_` for the roster** (replacing the Task-3 interim):

```js
/** CSV = the signals roster: one row per person, signal values + offending
    counts + the hours split (spec §5). */
function saveCsv_() {
  var done = donePeriods_(), hi = headPeriodIdx_(done);
  var head = done[hi] || { label: "", isos: [] };
  var rows = personSignalRows_(head.isos);
  if (rows === null) return;
  var lines = ["Person,Job title,Region,n,Due %,Due missing,Estimate %,Estimate missing," +
               "Logged %,Logged missing,Overall,Billable h,Non-billable h,Idle h,Note"];
  rows.forEach(function (r) {
    var w = aggWeeks_(r.p, head.isos) || { billable: 0, nonBillable: 0, tracked: 0, avail: 0 };
    var inel = r.p.newHire === true || r.p.onLeave === true;
    function pc(g) { return g.pct === null ? "" : Math.round(g.pct * 100); }
    lines.push([csvCell_(r.p.name), csvCell_(r.p.jobTitle), csvCell_(r.p.region), r.n,
      pc(r.sig.due), r.sig.due.miss, pc(r.sig.est), r.sig.est.miss,
      pc(r.sig.logged), r.sig.logged.miss, r.overall,
      r1_(w.billable), r1_(w.nonBillable),
      inel ? "" : r1_(Math.max(0, w.avail - w.tracked)),
      inel ? (r.p.onLeave ? "on leave" : "ramping") : ""].join(","));
  });
  downloadCsv_(lines.join("\n"), "delivery-people-signals");
}
```

- [ ] **Step 4: Run both runners; commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): Executive people-signals pulse (counts-only, margin-gated) + roster CSV"
```

---

### Task 8: Data-trust strip on Executive

**Files:**
- Modify: `Dashboard.html` (pane HTML + renderer reusing `gapsRows_`)
- Modify: `render-smoke.js`

- [ ] **Step 1: Failing smoke assertion:**

```js
C.getModel().viewerRole = "admin"; C.setState("view", "exec"); C.renderAll_();
var trust = document.getElementById("trustPanel").innerHTML;
assert_(trust.split("trustItem").length - 1 === 4, "exactly four trust tiles");
assert_(trust.indexOf("ORG") !== -1, "trust strip carries the ORG scope tag");
```

- [ ] **Step 2: Implement.** Pane: `<div class="panel" id="trustPanel"></div>` at the bottom of `viewExec`. Renderer, called last in the exec branch:

```js
/** Data-trust strip (spec §4.4): four fill-vs-gate tiles picked BY KEY from
    gapsRows_ — one list of definitions for the queue and the strip.
    Deliberately org-wide + unfiltered like the old Hygiene view (ORG tag). */
function renderTrust_() {
  var el = document.getElementById("trustPanel");
  var done = donePeriods_(), hi = headPeriodIdx_(done);
  var head = done[hi] || { label: "—", isos: [] };
  var h = hygieneFor_(head.isos), pp = hygienePeopleFor_(head.isos);
  var byKey = {};
  gapsRows_(h, pp).forEach(function (g) { if (g.key) byKey[g.key] = g; });
  var order = ["est", "due", "logged", "attr"];
  var titles = { est: "Estimate coverage", due: "Due-date fill", logged: "Logged fill", attr: "Roster join" };
  el.innerHTML = '<h3>🔍 Data trust ' + scopeTag_("org") + "</h3>" +
    '<div class="trustRow">' + order.map(function (k) {
      var g = byKey[k];
      if (!g) return "";
      var pct = g.value === null ? null : Math.round(g.value * 100);
      var col = pct === null ? "var(--muted)"
        : g.value >= g.gate ? "var(--c-good)"
        : g.value >= g.gate - 0.10 ? "var(--c-warn)" : "var(--c-bad)";
      return '<div class="trustItem" title="' + esc_((g.note || "") + " Blocks: " + g.blocks) + '">' +
        '<div class="cellSub">' + esc_(titles[k]) + "</div>" +
        '<div class="trustVal" style="color:' + col + '">' + (pct === null ? "—" : pct + "%") +
        ' <span class="cellSub">/ ' + Math.round(g.gate * 100) + "</span></div>" +
        '<div class="trustBar"><i style="width:' + (pct || 0) + "%;background:" + col + '"></i></div>' +
        '<div class="cellSub">' + esc_(g.detail || "") + "</div></div>";
    }).join("") + "</div>" +
    '<div class="cellSub">Gate = the coverage each published metric needs. The full queue — every gap, ' +
    "its owner requirement and committed week — lives on the 🎯 Actions tab.</div>";
}
```

  CSS:

```css
.trustRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.trustItem{border:1px solid var(--border);border-radius:8px;padding:8px 10px}
.trustVal{font-weight:700;font-size:calc(18px*var(--scale))}
.trustBar{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;margin:4px 0}
.trustBar i{display:block;height:100%}
```

  ⚠️ `hygieneFor_`/`hygienePeopleFor_` are the helpers `renderHygPanel_` already uses — confirm their names at the top of the old `renderHygiene_` (Dashboard.html:4112) and reuse them exactly; they are already whole-population.

- [ ] **Step 3: Run both runners; commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): Executive data-trust strip — four fill-vs-gate tiles from the shared gap definitions"
```

---

### Task 9: Scope tags on every tile (PERIOD / SNAP / ORG)

**Files:**
- Modify: `Dashboard.html` (`tileHtml_` ~1990, `flowTileHtml_` ~2424, comparison panel header in `renderCompare_`)
- Modify: `render-smoke.js`

- [ ] **Step 1: Failing smoke assertions:**

```js
C.renderAll_();
assert_(document.getElementById("tiles").innerHTML.indexOf(">PERIOD<") !== -1,
        "hero tiles carry PERIOD scope tags");
var ft = document.getElementById("flowTiles").innerHTML;
assert_(ft.indexOf(">SNAP<") !== -1 && ft.indexOf(">PERIOD<") !== -1,
        "flow tier: Backlog/WIP tag SNAP, Lead Time/Throughput/Bugs tag PERIOD");
```

- [ ] **Step 2: Implement.** `scopeTag_` already exists (Task 5). Thread it:
  - `tileHtml_` (line 1990): append `scopeTag_("period")` inside the `.lbl` div for every hero tile.
  - `flowTileHtml_`: add an `opts.scope` field; `renderFlow_` passes `"snap"` for Backlog and WIP, `"period"` for Lead Time, Throughput, Bug Count. Render it in the `.lbl` div.
  - Comparison panel heading in `renderCompare_`: append `scopeTag_("period")`.
  - Pulse and trust strip already tagged (Tasks 7–8). Roster headers already tagged (Task 5).

- [ ] **Step 3: Run both runners; commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): PERIOD/SNAP/ORG scope tags on every tile — three time-scopes, labelled at the tile"
```

---

### Task 10: Comparison chips gain the flow metrics

**Files:**
- Modify: `Dashboard.html` (`METRICS_` 2753, `METRIC_ORDER_` 2832, `renderCompare_`/`hbarChart_`)
- Modify: `render-smoke.js`

- [ ] **Step 1: Read first.** Open `renderCompare_` and `hbarChart_` (search `function hbarChart_`) end-to-end. Establish: (a) does `hbarChart_` assume a 0–100 axis or scale to max? (b) how does `scopedMetric_` scope a metric per category? The additions below must ride those mechanisms, not bypass them.

- [ ] **Step 2: Failing smoke assertion:**

```js
C.setState("metric", "leadTime"); C.renderAll_();
assert_(document.getElementById("comparePanel").innerHTML.indexOf("Lead Time") !== -1,
        "flow metric charts in the comparison");
```

- [ ] **Step 3: Add flow entries to `METRICS_`** (after `forecast`):

```js
  leadTime: {
    id: "leadTime", targetKey: null, unit: "days",
    label: function () { return "Lead Time"; },
    axis: function () { return "median days created → resolved (lower is faster)"; },
    available: function () { return !!MODEL.meta.jiraAvailable; },
    value: function (isos) {
      var b = bucketsFor_(MODEL.leadTimeBuckets || [], isos);
      return b.days && b.days.length ? flowMedian_(b.days) : null;
    },
    coverage: function (isos) {
      var b = bucketsFor_(MODEL.leadTimeBuckets || [], isos);
      return b.nAll > 0 ? b.n / b.nAll : null;
    },
    n: function (isos) { return bucketsFor_(MODEL.leadTimeBuckets || [], isos).n; },
  },
  throughput: {
    id: "throughput", targetKey: null, unit: "hrs",
    label: function () { return "Throughput"; },
    axis: function () { return "estimate-hours delivered in the period"; },
    available: function () { return !!MODEL.meta.jiraAvailable; },
    value: function (isos) {
      var b = bucketsFor_(MODEL.throughputBuckets || [], isos);
      return b.nAll > 0 ? b.estHrs : null;
    },
    coverage: function (isos) {
      var b = bucketsFor_(MODEL.throughputBuckets || [], isos);
      return b.nAll > 0 ? b.n / b.nAll : null;
    },
    n: function (isos) { return bucketsFor_(MODEL.throughputBuckets || [], isos).n; },
  },
```

  **Only Lead Time and Throughput are added — Backlog, WIP and Bug Count are deliberately NOT**, each for a structural reason the scope-tag doctrine makes visible: Backlog/WIP are snapshot metrics with no `isos` grain (a per-category snapshot bar under a period picker is the mislabelled-scope defect §4.5 exists to prevent), and Bug Count is population-wide by registry deviation — bugs are routinely unassigned, so the person join a Region/Team breakdown rides simply does not exist for it (`renderFlow_`'s own tile says "population-wide, filters don't apply", Dashboard.html:2625). Record this in a comment on `METRIC_ORDER_`. This narrows spec §4.2's metric list by three — flag it in the final report to the user for sign-off.

- [ ] **Step 4:** `METRIC_ORDER_` becomes `["onTime", "forecast", "util", "quality", "leadTime", "throughput"]` with the comment:

```js
// Backlog/WIP (snapshot — no period grain) and Bug Count (population-wide —
// no person join to dimension by) are NOT comparable metrics; see the tile
// scope tags. Deliberate narrowing of spec §4.2, flagged at review.
``` In `renderCompare_`/`hbarChart_`: where the axis or bar width is computed from a 0–100 value, branch on `m.unit`: when set, scale bars to `max(values)` and format labels with `fmtFlowVal_(v, m.unit)`; target band drawing is already null-safe (`tgt = … || null` at line 2881) — verify by reading, don't assume.

- [ ] **Step 5: Run both runners; commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): comparison chips gain Lead Time / Throughput / Bugs (unit-scaled axis; snapshot metrics excluded by design)"
```

---

### Task 11: Motion layer — cream + portfolio motion, once per load, reduced-motion safe

**Files:**
- Modify: `Dashboard.html` (CSS block; `switchView_`; first-render hook in the data-load success path; `renderTiles_` count-up)
- Modify: `render-smoke.js`

- [ ] **Step 1: CSS.** Add at the end of the `<style>` block:

```css
/* ── Motion (spec §7) — portfolio language, ONCE per load. Every rule lives
   behind prefers-reduced-motion; re-renders from filter/sort changes never
   re-animate (body.loaded gates the entrance keyframes). ── */
@media (prefers-reduced-motion: no-preference){
  :root{--ease:cubic-bezier(.4,0,.2,1);--spring:cubic-bezier(.34,1.56,.64,1)}
  body:not(.loaded) .tile{opacity:0;transform:translateY(14px)}
  body.entering .tile{animation:dhReveal .5s var(--ease) both}
  body.entering .tile:nth-child(2){animation-delay:.06s}
  body.entering .tile:nth-child(3){animation-delay:.12s}
  body.entering .tile:nth-child(4){animation-delay:.18s}
  body.entering .tile:nth-child(5){animation-delay:.24s}
  @keyframes dhReveal{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  .tile,.trustItem{transition:transform .25s var(--spring),box-shadow .25s var(--ease)}
  .tile:hover,.trustItem:hover{transform:translateY(-2px);box-shadow:var(--shadow)}
  .viewPane.paneIn{animation:paneIn .15s var(--ease) both}
  @keyframes paneIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  .trustBar i,.hbarMini i{transition:width .8s var(--spring)}
}
```

- [ ] **Step 2: JS hooks.**
  - In the data-load success handler (find where `loading` is hidden and the first `renderAll_()` runs), after that first render:

```js
  document.body.className = "entering";
  setTimeout(function () { document.body.className = "loaded"; }, 900);
```

  - In `switchView_`, after the pane display flip: add `paneIn` to the shown pane and remove it on the others:

```js
  var pane = document.getElementById(v.pane);
  pane.className = pane.className.replace(/ ?paneIn/, "") + " paneIn";
```

  - Count-up on hero numbers, once: in `renderTiles_`, after writing `innerHTML`, run a guard-once pass (module-scoped `var countedUp_ = false;`):

```js
  // Count-up runs ONCE per page load, only where rAF exists (the render-smoke
  // DOM stub has none — the whole feature is invisible to it by design) and
  // never under prefers-reduced-motion.
  if (!countedUp_ && window.requestAnimationFrame &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    countedUp_ = true;
    var bigs = document.getElementById("tiles").getElementsByClassName("big");
    Array.prototype.forEach.call(bigs, function (el) {
      var m = /^(\d+)(.*)$/.exec(el.textContent || "");
      if (!m) return;
      var target = +m[1], suffix = m[2], t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var k = Math.min(1, (ts - t0) / 700);
        el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + suffix;
        if (k < 1) window.requestAnimationFrame(step);
      }
      window.requestAnimationFrame(step);
    });
  }
```

- [ ] **Step 3: Smoke guard** — assert nothing here beyond "still renders": run both runners; the motion is CSS + rAF, invisible to the stub by design.

- [ ] **Step 4: Manual check in a browser** (this is the one task the runners cannot prove): serve the file or paste into the GAS editor preview; confirm stagger-reveal happens once, filter changes do not re-animate, tab switch cross-fades, and `prefers-reduced-motion: reduce` (DevTools rendering emulation) kills all of it.

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): motion layer — staggered reveal, pane cross-fade, count-up, hover lift; once per load, reduced-motion safe"
```

---

### Task 12: Full sweep, README, deploy notes

**Files:**
- Modify: `README.md` (tab documentation — six-tab sections become three)
- Modify: `render-smoke.js` (final catch-alls)

- [ ] **Step 1: Final assertions** — add to the end of `render-smoke.js`:

```js
// ── Consolidation invariants (spec 2026-08-05) ──────────────
assert_(C.VIEWS.length === 3, "exactly three views");
assert_(C.VIEWS.map(function (v) { return v.id; }).join(",") === "exec,actions,access",
        "view ids are exec/actions/access in order");
assert_(!els.viewFlow || els.viewFlow.innerHTML === "", "no live viewFlow pane");
assert_(!els.viewPeople || els.viewPeople.innerHTML === "", "no live viewPeople pane");
assert_(!els.viewHygiene || els.viewHygiene.innerHTML === "", "no live viewHygiene pane");
```

- [ ] **Step 2: Run everything**

Run: `node node-tests.js && node render-smoke.js`
Expected: both fully green with the final check count printed.

- [ ] **Step 3: README.** Rewrite the tab sections: three tabs with their block lists (Executive: tiered strip + comparison + pulse + trust; Actions: headroom + roster + matrix + queue; Access), the small-n rule, the scope-tag vocabulary, the schema-v22 note, and the deploy checklist below. Delete the Flow/People/Hygiene tab sections (their metric documentation moves under Executive/Actions, not deleted).

- [ ] **Step 4: Deploy checklist** (verbatim into README; execution is the USER's step, not yours):

```
1. Paste Code.js + Dashboard.html into the GAS project (Security.js unchanged) and deploy.
2. In the GAS editor, run bustDeliveryCache_ (schema v22 also invalidates old entries; the bust makes it immediate).
3. Live smoke: hero numbers move, compact flow tier renders, roster populates with RAG cells,
   matrix + gaps queue intact on Actions, guest sees no Utilization/Forecast/pulse/Actions.
4. Post the GTT-605 dated status comment.
No exporter change; no export re-run.
```

- [ ] **Step 5: Commit**

```bash
git add README.md render-smoke.js
git commit -m "docs(dh): README — three-tab structure, signals roster, scope tags, v22 deploy checklist"
```

---

## Self-review checklist (run after writing, before handoff)

- Spec §3 IA → Task 3. §4.1 → Task 2. §4.2 → Task 10 (⚠️ Backlog/WIP/Bug Count deliberately excluded — user sign-off flagged). §4.3 → Task 7. §4.4 → Task 8. §4.5 → Tasks 5/9. §5.1 → untouched by design. §5.2 → Tasks 4/5/6. §5.3/5.4 → Task 3. §6 → Task 1. §7 → Task 11. §8 → threaded through every task + Task 12. §9/§10 → Task 12 README.
- Known intentional deviations from the letter of the spec: (1) comparison chart gains only Lead Time + Throughput — Backlog/WIP are snapshots with no period grain, Bug Count has no person join to dimension by; (2) the matrix keeps its own population chips for PNG self-containment while the roster follows the same `STATE.typePop`. Both must be reported to the user at completion.
