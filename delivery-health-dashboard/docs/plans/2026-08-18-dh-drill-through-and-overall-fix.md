# DH Drill-Through Navigation + Overall Column Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One-click drill-through from the Executive grid's value cells to the people behind the number (Actions or Workforce, pre-filtered), plus removal of the misread "· 67 missing" on the signals roster's Overall cell, and a stacked capacity bar on the Workforce per-rocketeer rows.

**Architecture:** All four changes are client-side in `delivery-health-dashboard/Dashboard.html` (GAS HtmlService SPA). A new `DRILL_DEST_` map + `drillGo_()` handler reuse the existing universal-filter machinery (`DRILL_ROW_KEYS_`, `buildFilters_`, `switchView_`). The Workforce reformat touches only `wfCellPeopleRow_` and CSS. No Code.js / payload / schema change; no cache action on deploy.

**Tech Stack:** Vanilla JS string-concatenation rendering; local Node test harnesses `tests/delivery-health/render-smoke.js` (1,679 checks at baseline) and `tests/delivery-health/node-tests.js`.

**Spec:** `delivery-health-dashboard/docs/specs/2026-08-18-dh-drill-through-and-overall-fix-design.md`

**Baseline (verified 2026-08-18):** both suites green; `Dashboard.html` unmodified in git. ⚠ If any Edit fails with "modified since read", a concurrent session holds the file — re-read and apply only your delta (standing feedback rule).

---

### Task 1: Overall cell drops "· N missing"

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html` (~line 8064, in `renderRoster_`)
- Test: `tests/delivery-health/render-smoke.js` (near the existing roster row checks, ~line 2810–2910)

- [ ] **Step 1: Write the failing check**

In render-smoke.js, find the existing roster fixture that renders one person's roster row (the helper near line 2810 that returns "the single `<tr>…</tr>` for one person's roster row"). Ensure the fixture person has at least two fields with misses (e.g. `due: 1, est: 1` short of `n`), then add:

```js
// ── Overall cell carries NO miss count (user 2026-08-18) ──────────────────
// The count summed per-field misses, so one ticket missing two fields counted
// twice — "67 missing" read as 67 tickets. The verdict dot stays; the per-field
// cells keep their own "· N missing" where the column header is the noun.
(function () {
  var row = rosterRowHtml_(/* the fixture person with ≥2 field misses */);
  var tds = row.split("<td");
  // tds[0] is the leading "<tr…>", tds[1] the name cell, tds[2] the Overall cell.
  assert_(tds[2].indexOf("missing") === -1,
          "Overall cell prints the dot only — no 'missing' count");
  assert_(row.indexOf("missing") !== -1,
          "…while the per-field cells still print theirs");
})();
```

(Adapt the fixture access to the harness's existing idiom at that spot — the roster checks there already build rows; reuse their fixture rather than inventing a new one.)

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/delivery-health/render-smoke.js`
Expected: FAIL with "Overall cell prints the dot only".

- [ ] **Step 3: Implement**

In `Dashboard.html` `renderRoster_` (~8064), change:

```js
sigCellHtml_({ cls: r.overall, pct: null, miss: r.miss }) +
```

to:

```js
// miss: 0 ON PURPOSE (user 2026-08-18). r.miss sums per-field misses, so one
// ticket missing two fields counts twice — readers took "67 missing" for a
// ticket total. The sum still drives the opportunity sort and the CSV; it is
// only no longer printed without a noun. The per-field cells keep theirs.
sigCellHtml_({ cls: r.overall, pct: null, miss: 0 }) +
```

- [ ] **Step 4: Run both suites**

Run: `node tests/delivery-health/render-smoke.js && node tests/delivery-health/node-tests.js`
Expected: all green (count grows by the new checks).

- [ ] **Step 5: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "fix(dh): Overall cell drops its summed miss count — it read as a ticket total"
```

---

### Task 2: `DRILL_DEST_` map + `drillGo_()` + clickable grid cells

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`:
  - `gridCellHtml_` (~6606) — accept `o.go`, add handler/affordance/tooltip
  - `renderCompare_` cell loop (~6850) — pass `go`
  - new `DRILL_DEST_` + `drillGo_()` + `wfExpandAvailCells_()` beside `drillPick_` (~7057)
  - CSS block (near `.gridCell` / drill styles, ~line 201–310) — hover affordance
- Test: `tests/delivery-health/render-smoke.js` (bridge ~line 218/244 + new checks near the gridCellHtml_ checks ~5572)

- [ ] **Step 1: Write the failing checks**

Add to render-smoke.js (after exposing `drillGo_`, `DRILL_DEST_` in the bridge — same comma-list style as line 218/244):

```js
// ── One-click drill-through (user 2026-08-18) ──────────────────────────────
(function () {
  // The map itself: availability goes to Workforce, delivery metrics to Actions.
  assert_(C.DRILL_DEST_.avail === "workforce", "avail lands on Workforce");
  ["onTime", "forecast", "quality", "planCov"].forEach(function (id) {
    assert_(C.DRILL_DEST_[id] === "actions", id + " lands on Actions");
  });

  // A cell WITH go is a control; the same cell without go is not.
  var tgt = { green: 85, amber: 70 };
  var hot = C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 6,
                              sampleNoun: "items", go: { row: 2, id: "forecast" } });
  assert_(hot.indexOf("drillGo_(2,'forecast')") !== -1, "go cell carries drillGo_");
  assert_(hot.indexOf("stopPropagation") !== -1, "…and stops the row-select click");
  assert_(hot.indexOf('role="button"') !== -1 && hot.indexOf("tabindex") !== -1,
          "…and is keyboard-reachable");
  var cold = C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 6, sampleNoun: "items" });
  assert_(cold.indexOf("drillGo_") === -1, "no go option → no handler");
  var inert = C.gridCellHtml_({ value: null, go: { row: 2, id: "forecast" } });
  assert_(inert.indexOf("drillGo_") === -1, "a '—' cell is click-inert even with go");

  // Behaviour: drillGo_ sets the slice filter, the metric, the landing state,
  // and navigates. (Set STATE.compare = "region" and DRILL_ROW_KEYS_ via a
  // renderCompare_ pass on the standard fixture first, per harness idiom.)
  // forecast → Actions with the Need-action chip pre-set:
  //   assert STATE.view === "actions", STATE.region === <row key>,
  //   STATE.metric === "forecast", STATE.sigFilter === "bad".
  // planCov → Actions with NO chip: STATE.sigFilter === "".
  // avail → Workforce with cells expanded: STATE.view === "workforce" and
  //   STATE.wfOpenCell has ≥1 truthy key for a fixture person with free hours.
})();
```

(The STATE assertions use whatever accessor the bridge already provides for the tab-routing checks — follow that idiom, do not invent a second one.)

- [ ] **Step 2: Run to verify failure**

Run: `node tests/delivery-health/render-smoke.js`
Expected: FAIL (bridge exposes nothing named `drillGo_` yet → ReferenceError, or first assert fails).

- [ ] **Step 3: Implement in Dashboard.html**

**(a)** Beside `drillPick_` (~7057):

```js
/**
 * ── ONE-CLICK DRILL-THROUGH (user 2026-08-18) ────────────────────────────────
 * A value cell in the drill grid answers "where isn't it working"; clicking it
 * goes to WHO. The metric names the destination: availability is a Workforce
 * question, everything else is an Actions one. The two header buttons stay —
 * they are the select-first path; this is the see-it-click-it path.
 */
var DRILL_DEST_ = { avail: "workforce", onTime: "actions", forecast: "actions",
                    quality: "actions", planCov: "actions", util: "workforce" };

/** Cell click on the drill grid: set the slice, set the metric, land on the
    metric's own tab. SETS the filter (never toggles) — arriving somewhere
    with the filter you clicked half-cleared is worse than a no-op. */
function drillGo_(i, metricId) {
  var key = DRILL_ROW_KEYS_[i];
  var dest = DRILL_DEST_[metricId];
  if (key === undefined || !dest) return;
  STATE[STATE.compare] = key;
  STATE.metric = metricId;
  // Landing state per destination: the Need-action chip narrows the roster to
  // the people with a red field — except planCov, whose acting surface is the
  // roster's own Plan column, where pre-narrowing to red would hide the
  // unplanned-but-otherwise-clean people the click is looking for.
  if (dest === "actions") STATE.sigFilter = metricId === "planCov" ? "" : "bad";
  if (metricId === "avail") wfExpandAvailCells_();
  buildFilters_();
  switchView_(dest);
}

/** Open every pool × band cell holding someone with sellable free hours, so an
    availability drill lands with the names already on screen — no ▸ hunting.
    Runs AFTER the slice filter is set, so only the clicked slice's cells open. */
function wfExpandAvailCells_() {
  var isos = analysisHead_().head.isos;
  filteredPeople_().forEach(function (p) {
    if (!wfSellable_(p)) return;
    if (!wfCfg_(p.pool).consumes) return;
    var h = wfPersonHours_(p, isos);
    if (h.avail > 0) STATE.wfOpenCell[p.cell || "NONE|UNKNOWN"] = true;
  });
}
```

**(b)** `gridCellHtml_` (~6606): accept `o.go = { row, id }`. At the top, build the shared attributes once (DRY across the four non-null branches):

```js
  // ── ONE-CLICK DRILL-THROUGH (user 2026-08-18) ─────────────────────────────
  // o.go marks this cell as a navigation control: click = slice + metric +
  // destination tab in one step. Built once here so every branch below carries
  // the same affordance. The '—' branch stays inert: there is nobody behind a
  // number that was never measured.
  var go = o.go || null;
  var goTip = "";
  var goAttr = "";
  if (go) {
    var gm = METRICS_[go.id];
    var gDest = DRILL_DEST_[go.id] === "workforce" ? "Workforce" : "Actions";
    goTip = " Click: open " + gDest + " for this row's people on " +
            (gm ? gm.label() : go.id) +
            (gDest === "Actions" && go.id !== "planCov" ? ", narrowed to who needs action." : ".");
    goAttr = ' role="button" tabindex="0" onclick="event.stopPropagation();' +
      "drillGo_(" + go.row + ",'" + go.id + "')\" " +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' +
      "event.stopPropagation();drillGo_(" + go.row + ",'" + go.id + "')}\"";
  }
```

Then in each of the four value-carrying branches: add `goAttr` into the `<td` tag, add a `" go"` class, and append `goTip` inside the existing `title="…"` text (the graded branch has no title today — give it `title="' + esc_(goTip.trim()) + '"` when `go` is set). The `value === null` branch is untouched.

**(c)** `renderCompare_` cell loop (~6850): pass the option:

```js
gridIds.map(function (id) {
  return gridCellHtml_({ value: r.cells[id], n: r.n, target: gridTargets[id],
                         std: gridStds[id], unit: METRICS_[id].unit,
                         max: gridMax[id],
                         sampleN: (r.cellN || {})[id],
                         sampleNoun: METRICS_[id].sampleNoun,
                         go: { row: i, id: id } });
}).join("")
```

Also update the panel's closing how-to line (~6978) to mention the cell click: "Click a cell to jump to the people behind it — Workforce for availability, Actions for the rest."

**(d)** CSS, next to the existing drill styles:

```css
/* One-click drill-through cells (2026-08-18): the pointer + hover ring say
   "this navigates" before the tooltip does. */
.gridCell.go{cursor:pointer}
.gridCell.go:hover{box-shadow:inset 0 0 0 1px var(--orbe)}
```

- [ ] **Step 4: Run both suites; fix**

Run: `node tests/delivery-health/render-smoke.js && node tests/delivery-health/node-tests.js`
Expected: all green. If an existing check pins `gridCellHtml_` markup that now carries `goAttr`, note the checks only exercise `go`-less calls directly — they should pass unchanged; rewrite against the new markup only if one asserts on full-cell output from `renderCompare_`.

- [ ] **Step 5: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "feat(dh): drill grid cells navigate — slice + metric + destination in one click"
```

---

### Task 3: Workforce per-rocketeer stacked capacity bar

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html`:
  - new `wfPersonBarHtml_` + reformat `wfCellPeopleRow_` (~8746–8803)
  - CSS block near the Workforce styles (~956)
- Test: `tests/delivery-health/render-smoke.js` (Workforce drill-down checks, ~line 264 bridge region)

- [ ] **Step 1: Write the failing checks**

```js
// ── Per-rocketeer stacked bar (user 2026-08-18) ────────────────────────────
// "We already show capacity, planned and available — change the FORMAT":
// planned fills first, available follows, the row ends in the person's own
// availability rate. Hours stay printed; the tooltip keeps the full sentence.
(function () {
  var sell = C.wfPersonBarHtml_({ cap: 40, planned: 24, avail: 16 }, true, 40);
  assert_(sell.indexOf("wfBarPlan") !== -1 && sell.indexOf("wfBarAvail") !== -1,
          "sellable bar draws both segments");
  assert_(sell.indexOf("24h") !== -1 && sell.indexOf("16h") !== -1,
          "…with the hours printed, not colour-only");
  assert_(sell.indexOf("40%") !== -1, "…and ends in the individual availability rate");
  var held = C.wfPersonBarHtml_({ cap: 40, planned: 24, avail: 16 }, false, 40);
  assert_(held.indexOf("wfBarHeld") !== -1, "non-sellable bar is muted");
  assert_(held.indexOf("40%") === -1, "…and carries no rate verdict");
  var none = C.wfPersonBarHtml_({ cap: 0, planned: 0, avail: 0 }, true, 40);
  assert_(none.indexOf("wfBarPlan") === -1 && none.indexOf("—") !== -1,
          "zero capacity keeps the '—' rule — no bar, no rate");
})();
```

Plus: re-render the existing expanded-cell fixture and assert the row still reconciles (subtotal hours text present, sellable-first order unchanged, on-leave held out of the subtotal). Expect some EXISTING checks pinned to the old `Capacity | Planned | Available` header to fail in Step 2 — per the suite's doctrine they get REWRITTEN against the new markup with the same intent, never deleted.

- [ ] **Step 2: Run to verify failure**

Run: `node tests/delivery-health/render-smoke.js`
Expected: FAIL — `wfPersonBarHtml_` undefined.

- [ ] **Step 3: Implement**

**(a)** New helper above `wfCellPeopleRow_`:

```js
/**
 * ── THE PERSON'S WEEK AS ONE BAR (user 2026-08-18) ──────────────────────────
 * Planned fills first, available follows, the row ends in the person's own
 * availability rate — the same three numbers the columns held, readable in one
 * glance. Bar length is the person's capacity against the LONGEST capacity in
 * the list, so hours compare across people (a 20h week half-planned must not
 * look like a 40h week half-planned). Non-sellable rows (🏖 🌱 bench) draw
 * muted and verdict-free: the hours are real, the room to sell is not.
 */
function wfPersonBarHtml_(h, sell, maxCap) {
  if (h.cap <= 0) return '<span class="cellSub">—</span>';
  var w = maxCap > 0 ? Math.max(6, Math.round(h.cap / maxCap * 100)) : 100;
  var planPct = Math.round(h.planned / h.cap * 100);
  var availPct = Math.max(0, 100 - planPct);
  var rate = Math.round(h.avail / h.cap * 100);
  var tip = r1_(h.planned) + "h planned + " + r1_(h.avail) + "h available of " +
    r1_(h.cap) + "h scheduled capacity" +
    (sell ? " — " + rate + "% of their week is open." : " — spare hours here are not sellable.");
  return '<span class="wfBarWrap' + (sell ? "" : " wfBarHeld") + '" title="' + esc_(tip) + '">' +
    '<span class="wfBar" style="width:' + w + '%">' +
      (h.planned > 0 ? '<span class="wfBarPlan" style="width:' + planPct + '%">' +
        (planPct >= 18 ? r1_(h.planned) + "h" : "") + "</span>" : "") +
      (h.avail > 0 ? '<span class="wfBarAvail" style="width:' + availPct + '%">' +
        (availPct >= 18 ? r1_(h.avail) + "h" : "") + "</span>" : "") +
    "</span>" +
    (sell ? ' <b class="wfBarRate">' + rate + "%</b>"
          : ' <span class="cellSub">' + r1_(h.avail) + "h</span>") +
  "</span>";
}
```

**(b)** Reformat `wfCellPeopleRow_`'s inner table: header becomes
`Person | Week (planned → available) | Available`; each person row becomes name cell + one bar cell (`wfPersonBarHtml_(r.h, sell, maxCap)`, where `var maxCap = mine.reduce(max over r.h.cap)`) + the existing `availCell` hours as the last column. **Colspan discipline:** the inner table now renders 3 columns — every row in it (empty-state, subtotal) uses colspans bounded by 3; the OUTER wrapper row keeps its `colspan="11"` against the pool grid. Subtotal row keeps the reconciling numbers as one line in the bar column:

```js
'<tr><td class="tname" style="padding-left:28px"><b>Sellable subtotal</b> ' +
  '<span class="cellSub">(' + sums.n + (sums.n === 1 ? " person" : " people") +
  (sums.held ? ", " + sums.held + " held back" : "") + ")</span></td>" +
  '<td><span class="cellSub">' + wfHrs_(sums.planned) + " planned + " +
    wfHrs_(sums.avail) + " available of " + wfHrs_(sums.cap) + " capacity</span></td>" +
  '<td class="tnum"><b>' + wfHrs_(sums.avail) + "</b></td></tr>"
```

The trailing caveat paragraph is unchanged.

**(c)** CSS near the Workforce block:

```css
/* Per-rocketeer stacked capacity bar (2026-08-18). Planned then available,
   labels inside when they fit; muted + verdict-free for held-back people. */
.wfBarWrap{display:flex;align-items:center;gap:8px;min-width:220px}
.wfBar{display:flex;height:16px;border-radius:4px;overflow:hidden;background:var(--border)}
.wfBarPlan{background:var(--c-ref);color:#fff;font-size:11px;line-height:16px;text-align:center;white-space:nowrap;overflow:hidden}
.wfBarAvail{background:var(--c-good);color:#fff;font-size:11px;line-height:16px;text-align:center;white-space:nowrap;overflow:hidden}
.wfBarHeld .wfBarPlan,.wfBarHeld .wfBarAvail{opacity:.45}
.wfBarRate{font-variant-numeric:tabular-nums}
```

(Use the theme's real token names — check `:root` for the `--c-*` palette before writing; if `--c-ref`/`--c-good` are not the actual tokens, use the ones `gridCellHtml_` uses.)

- [ ] **Step 4: Run suites; rewrite retired-markup checks**

Run: `node tests/delivery-health/render-smoke.js && node tests/delivery-health/node-tests.js`
Any check pinned to the old three-column header gets rewritten to assert the same INTENT on the new markup (sellable-first sort, held-out subtotal, zero-cap "—"). Expected: all green, count grown.

- [ ] **Step 5: Commit**

```bash
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "feat(dh): per-rocketeer week as a stacked bar — planned, available, rate"
```

---

### Task 4: Docs sync + final verification

**Files:**
- Modify: `delivery-health-dashboard/README.md` (~line 258 per-person drill-down, ~483 roster columns, ~1481 deploy notes)
- Modify: `delivery-health-dashboard/ARCHITECTURE.md` (whichever section describes the drill grid / signals roster / workforce drill-down)

- [ ] **Step 1: Update the docs**

- README per-person drill-down paragraph: mention the stacked bar + rate format.
- README roster/signals section: Overall column is dot-only; the summed miss count drives the sort and CSV but is not printed.
- README Executive drill-down section: value cells navigate (`drillGo_`, `DRILL_DEST_` map); header buttons remain the select-first path.
- Deploy note: `Dashboard.html` only, no schema bump, no cache action.
- ARCHITECTURE.md: same three facts, at whatever altitude that file keeps.

- [ ] **Step 2: Full suite run**

Run: `node tests/delivery-health/render-smoke.js && node tests/delivery-health/node-tests.js`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add delivery-health-dashboard/README.md delivery-health-dashboard/ARCHITECTURE.md
git commit -m "docs(dh): drill-through, dot-only Overall, stacked workforce bar"
```

- [ ] **Step 4: Hand to user for visual QA**

Tests are blind to layout (standing feedback): after deploy (paste `Dashboard.html` into the GAS project — no schema bump, no `bustDeliveryCache_`), ask the user for screenshots of (a) an expanded Workforce cell with the bars, (b) a drill-grid hover, (c) the roster's Overall column.
