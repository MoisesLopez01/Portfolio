# Hygiene Data Profiling + WHAT-IF Simulation + CEO Brief — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only data-profiling funnels + a single whole-dashboard "valid records only" WHAT-IF toggle + a deterministic CEO brief (3 Facts / 3 Highlights / 3 Notes / top Concerns), all client-side in the Delivery Health Dashboard.

**Architecture:** Everything lives in `Dashboard.html`'s inline script. The server already ships per-week buckets that separate valid from invalid records (`n` vs `nAll`, `hygieneBuckets`, `trackedCov`, `capEst`), so the WHAT-IF is a `STATE.whatIf` flag threaded through the two shared aggregation helpers (`bucketsFor_`, `utilFor_`) plus a banner/watermark render pass. Profiling and the brief are pure functions over `hygieneFor_()` / `hygienePeopleFor_()` output, rendered inside `renderHygiene_()`. No `Code.js` change, no schema bump, no cache bust.

**Tech Stack:** Google Apps Script HtmlService client (ES5-style JS, string-concat HTML, inline SVG chart kit). Tests: `render-smoke.js` (local Node harness — run with `node render-smoke.js` from `docs/superpowers/delivery-health-dashboard/`; it evals the inline `<script>` against a synthetic MODEL). `node-tests.js` must stay green (it tests `Code.js`, which this plan does not touch).

**Spec:** `docs/superpowers/specs/2026-08-03-hygiene-whatif-profiling-design.md`

---

## Orientation for the implementer

- Work dir: `docs/superpowers/delivery-health-dashboard/`. Only two files change:
  `Dashboard.html` (feature) and `render-smoke.js` (tests). Never paste `render-smoke.js`
  into GAS — it is Node-only.
- `Dashboard.html` structure: `<style>` block (~line 10–360 area), HTML panes, then one big
  `<script>` at the end. All client functions live in that script. Private helpers end in `_`.
- `render-smoke.js` extracts the inline `<script>`, evals it with a **bridge** object literal
  (line ~89) that exports functions by name. **Any function a test calls must be added to the
  bridge string** — and a bridge name that doesn't exist yet makes the eval throw
  `ReferenceError`, which is exactly how our "failing test" step fails before implementation.
- The synthetic fixture (`model({})` in render-smoke.js) has, per week
  (`WEEKS = ["2026.W30","2026.W31"]`): hygieneBuckets `{ res: 50, resDue: 40, resAssigned: 47,
  resAttr: 45, resRegion: 10, resTeam: 5, resReady: 30 + i*4, resFull: 8, epics: 20,
  epicsEst: 14, epicsTime: 9 }`; onTimeBuckets `n = round(50 × otCov)`, `nAll = 50`;
  forecastBuckets `n = round(20 × fcCov)`, `nAll = 20`, `nNoTime: 2`; two people × two weeks,
  each week `cap: 40, tracked: 40, trackedCov: 40, capEst: false`; `viewerRole: "admin"`;
  `meta.jiraUnattributed = { onTime: 3, forecast: 1 }`.
- The harness starts in `STATE.period = "week"`, `STATE.view = "exec"`. `els` is the stub DOM:
  `els.tiles.innerHTML` etc. `fresh(mdl)` clears per-payload memos — always go through it (or
  the `tiles()` helper) when swapping models.
- Run tests: `node render-smoke.js` → expect `✅ render-smoke: <N> checks passed`.
  Also run `node node-tests.js` in Task 6 → expect its ✅ lines.
- Commit after every task. **Never `git push`** (repo policy). Commit ONLY the two files this
  plan touches — the working tree has unrelated modified files.

---

### Task 1: WHAT-IF core — state flag, helpers, population collapse

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (STATE literal ~line 383; helpers after `PERIOD_LABELS` ~line 386; `bucketsFor_` ~line 1189; `utilFor_` ~line 1140)
- Test: `docs/superpowers/delivery-health-dashboard/render-smoke.js` (bridge ~line 89; tests appended before the final `console.log`)

- [ ] **Step 1: Add the new names to the render-smoke bridge**

In `render-smoke.js`, find the bridge line:

```js
             " renderGrid_: renderGrid_, toggleFlag_: toggleFlag_, VIEWS: VIEWS, dimMatch_: dimMatch_, UNTAGGED_: UNTAGGED_, cmpNoun_: cmpNoun_, scopedMetric_: scopedMetric_, METRICS_: METRICS_, canSeeMargin_: canSeeMargin_, liveMetrics_: liveMetrics_ })";
```

Replace with:

```js
             " renderGrid_: renderGrid_, toggleFlag_: toggleFlag_, VIEWS: VIEWS, dimMatch_: dimMatch_, UNTAGGED_: UNTAGGED_, cmpNoun_: cmpNoun_, scopedMetric_: scopedMetric_, METRICS_: METRICS_, canSeeMargin_: canSeeMargin_, liveMetrics_: liveMetrics_," +
             // WHAT-IF simulation + data profiling (spec 2026-08-03)
             " whatIfOn_: whatIfOn_, toggleWhatIf_: toggleWhatIf_, whatIfCounts_: whatIfCounts_," +
             " utilFor_: utilFor_, bucketsFor_: bucketsFor_ })";
```

- [ ] **Step 2: Write the failing tests**

Append to `render-smoke.js`, immediately BEFORE the final `console.log("✅ render-smoke: ...")` line:

```js
// ══════════════════════════════════════════════════════════════════════════
// 21. WHAT-IF CORE (spec 2026-08-03): one flag flips the population every
// shared aggregation helper uses to "valid records only". The rates never
// change — they were always computed over valid records; the flag changes the
// denominators and the confidence framing. Admin-only, session-only.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({ otCov: 0.66, fcCov: 0.43 }));
C.setState("whatIf", true);
assert_(C.whatIfOn_(), "whatIf turns on for an admin viewer");
var wiOt = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
assert_(wiOt.nAll === wiOt.n, "WHAT-IF collapses the coverage denominator to the valid population");
assert_(wiOt.nAllReal === 100, "…keeping the real total (2 weeks × 50) for restating");
var wiFc = C.bucketsFor_(C.getModel().forecastBuckets, WEEKS);
assert_(wiFc.nNoTime === 0 && wiFc.nAll === wiFc.n,
        "estimated-but-untracked epics vanish from the displayed population");
assert_(wiFc.nNoTimeReal === 4, "…their real count survives (2 per week × 2)");
C.setState("whatIf", false);
var realOt = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
assert_(realOt.nAll === 100 && realOt.nAllReal === undefined, "flag off → untouched shape");
// utilization: a defaulted-capacity person-week is not a valid record
var wiModel = model({});
wiModel.people[0].weeks["2026.W30"].capEst = true;
fresh(wiModel);
C.setState("whatIf", true);
var wiU = C.utilFor_(WEEKS);
assert_(wiU.cap === 120, "capEst person-week dropped from the WHAT-IF capacity (4×40h − 40h)");
assert_(wiU.wiWeeksDropped === 1, "…and the drop is counted for restating");
C.setState("whatIf", false);
var realU = C.utilFor_(WEEKS);
assert_(realU.cap === 160, "flag off → the full population is back");
// banner counts: Σ over the whole export window, straight off hygieneBuckets
C.setState("whatIf", true);
var wiCounts = C.whatIfCounts_();
assert_(wiCounts.res === 100 && wiCounts.readyKept === 64, "delivery kept/total = resReady/res (30+34 of 100)");
assert_(wiCounts.epics === 40 && wiCounts.epicsKept === 18, "epic kept/total = epicsTime/epics (18 of 40)");
// the flag is a no-op for anyone who is not an admin
C.getModel().viewerRole = "viewer";
assert_(!C.whatIfOn_(), "whatIfOn_ is admin-only regardless of the raw flag");
C.getModel().viewerRole = "admin";
C.setState("whatIf", false);
```

- [ ] **Step 3: Run to verify failure**

Run: `node render-smoke.js` (in `docs/superpowers/delivery-health-dashboard/`)
Expected: throws `ReferenceError: whatIfOn_ is not defined` (the bridge names don't exist yet).

- [ ] **Step 4: Implement — STATE flag + helpers**

In `Dashboard.html`, in the STATE literal (~line 383), change:

```js
var STATE = { period: "month", pop: "fte", role: "all", focus: "plan", region: "", team: "", pm: "", family: "", search: "", expandedWeeks: {}, openDetail: {}, hygIdx: null,
              view: "exec", flag: "", metric: "util", compare: "region", compareAll: false,
              oppSort: "opp", oppDesc: true };
```

to:

```js
var STATE = { period: "month", pop: "fte", role: "all", focus: "plan", region: "", team: "", pm: "", family: "", search: "", expandedWeeks: {}, openDetail: {}, hygIdx: null,
              view: "exec", flag: "", metric: "util", compare: "region", compareAll: false,
              oppSort: "opp", oppDesc: true,
              // whatIf: admin-only, session-only "valid records only" simulation
              // (spec 2026-08-03). Never persisted — a reload is always real mode.
              whatIf: false };
```

Immediately after `var PERIOD_LABELS = { week: "Week", month: "Month", quarter: "Quarter" };` add:

```js
// ── WHAT-IF simulation (spec 2026-08-03) ─────────────────────────────────────
// One flag flips the whole dashboard to "valid records only": each metric keeps
// the records that are complete FOR IT (roster assignee + due date; epics also
// need estimate + logged time; utilization drops defaulted-capacity weeks),
// coverage reads 100% and every gate flag clears. Region/Team are OUT of the
// exercise by decision — the Jira fields are unpopulated org-wide (PR-01).
// The rates themselves never change: they were always computed over valid
// records. What changes is the population and the confidence framing.
var WHATIF_MIN_N_ = 5; // below this, a card says "publishable, not meaningful"
function whatIfOn_() {
  return !!STATE.whatIf && !!MODEL && MODEL.viewerRole === "admin";
}
function toggleWhatIf_() { STATE.whatIf = !STATE.whatIf; renderAll_(); }
/** Kept/total counts for the banner — Σ over the WHOLE export window, never
    filtered: the banner states what the simulation did to the whole feed. */
function whatIfCounts_() {
  var s = { res: 0, readyKept: 0, epics: 0, epicsKept: 0 };
  ((MODEL && MODEL.hygieneBuckets) || []).forEach(function (h) {
    s.res += h.res || 0; s.readyKept += h.resReady || 0;
    s.epics += h.epics || 0; s.epicsKept += h.epicsTime || 0;
  });
  return s;
}
```

- [ ] **Step 5: Implement — population collapse in the two shared helpers**

In `bucketsFor_` (~line 1189), change the ending:

```js
    if (b.absVars && b.absVars.length) out.absVars = out.absVars.concat(b.absVars);
  });
  return out;
}
```

to:

```js
    if (b.absVars && b.absVars.length) out.absVars = out.absVars.concat(b.absVars);
  });
  // WHAT-IF: the displayed world holds only valid records, so the coverage
  // denominator IS the measurable population and the not-measurable tallies go
  // to zero. Real totals ride along so the tiles can RESTATE the exclusions
  // ("N excluded by the WHAT-IF filter") instead of hiding them silently.
  if (whatIfOn_()) {
    out.nAllReal = out.nAll; out.nNoTimeReal = out.nNoTime;
    out.nAll = out.n; out.nNoTime = 0;
  }
  return out;
}
```

In `utilFor_` (~line 1140), change:

```js
    isos.forEach(function (iso) {
      var w = p.weeks[iso];
      if (!w) return;
      s.avail += w.avail; s.billable += w.billable; s.tracked += w.tracked;
```

to:

```js
    isos.forEach(function (iso) {
      var w = p.weeks[iso];
      if (!w) return;
      // WHAT-IF: a person-week whose capacity fell back to a default is not a
      // valid record — it leaves the simulation entirely (counted for the
      // restating line on the tile).
      if (whatIfOn_() && w.capEst) { s.wiWeeksDropped = (s.wiWeeksDropped || 0) + 1; return; }
      s.avail += w.avail; s.billable += w.billable; s.tracked += w.tracked;
```

- [ ] **Step 6: Run tests to verify pass**

Run: `node render-smoke.js`
Expected: `✅ render-smoke: <N> checks passed` (N grows by the new assertions; no failures).

- [ ] **Step 7: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html" "docs/superpowers/delivery-health-dashboard/render-smoke.js"
git commit -m "feat(dh): WHAT-IF core — admin-only valid-records flag threads the shared aggregators"
```

---

### Task 2: Banner, watermark, force-reset, PNG stamp

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (CSS block; HTML above `scopeChip` ~line 331; `renderAll_` ~line 1071; `btnReset` handler ~line 1107; `savePng_` ~line 3735)
- Test: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Bridge + failing tests**

Add `renderAll_` to the bridge — in the block added in Task 1, change:

```js
             " whatIfOn_: whatIfOn_, toggleWhatIf_: toggleWhatIf_, whatIfCounts_: whatIfCounts_," +
```

to:

```js
             " whatIfOn_: whatIfOn_, toggleWhatIf_: toggleWhatIf_, whatIfCounts_: whatIfCounts_," +
             " renderAll_: renderAll_," +
```

Append tests before the final `console.log`:

```js
// ══════════════════════════════════════════════════════════════════════════
// 22. WHAT-IF GUARDRAILS: a simulation must be unmistakable on every view and
// impossible for a non-admin. Banner + body watermark render in the same pass
// as the numbers, so they can never desynchronise.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", true);
C.renderAll_();
var wiBanner = els.whatifBanner.innerHTML;
assert_(/WHAT-IF SIMULATION/.test(wiBanner), "banner renders while the flag is on");
assert_(/kept 64 of 100 delivery items/.test(wiBanner), "…with live kept/total delivery counts");
assert_(/18 of 40 epics/.test(wiBanner), "…and epic counts");
assert_(/not the real numbers/.test(wiBanner), "…and says plainly these are not the real numbers");
assert_(/toggleWhatIf_\(\)/.test(wiBanner), "…and carries the Exit control");
assert_(global.document.body.className === "whatif", "body carries the watermark class");
C.setState("whatIf", false);
C.renderAll_();
assert_(els.whatifBanner.innerHTML === "", "flag off → banner gone");
assert_(global.document.body.className === "", "…and watermark class removed");
// defence in depth: renderAll_ force-resets the flag for non-admins, mirroring
// how switchView_ gates in the router instead of trusting hidden buttons
C.setState("whatIf", true);
C.getModel().viewerRole = "viewer";
C.renderAll_();
assert_(C.STATE.whatIf === false, "renderAll_ force-resets whatIf for a non-admin");
assert_(els.whatifBanner.innerHTML === "", "…and renders no banner");
C.getModel().viewerRole = "admin";
```

- [ ] **Step 2: Run to verify failure**

Run: `node render-smoke.js`
Expected: `ReferenceError` on the eval is NOT possible now (renderAll_ exists) — instead the
first banner assertion fails: `❌ render-smoke: banner renders while the flag is on`.

- [ ] **Step 3: Implement — HTML element + CSS**

In `Dashboard.html`, find the scope chip markup (~line 331):

```html
  <div class="sub" id="scopeChip" style="margin:-6px 0 12px;color:var(--muted);font-size:11px;cursor:help"
```

Insert immediately BEFORE it:

```html
  <!-- WHAT-IF simulation banner — rendered by renderWhatIfBanner_() on every
       view while the admin-only simulation is on. Sits above the scope chip so
       no tab can render a simulated number without it. -->
  <div id="whatifBanner" style="display:none"></div>
```

In the `<style>` block, find the `/* ── Data Hygiene view ── */` comment (~line 121) and insert BEFORE it:

```css
/* ── WHAT-IF simulation (admin-only) ── */
#whatifBanner { background: var(--c-warn); color: #fff; padding: 8px 12px;
  border-radius: 6px; margin: 0 0 12px; font-size: 13px; }
#whatifBanner .btn { margin-left: 10px; }
/* The watermark: a screenshot of ANY corner of a simulated dashboard must be
   unmistakable — dashed frame + fixed corner stamp, both pointer-transparent. */
body.whatif { outline: 4px dashed var(--c-warn); outline-offset: -4px; }
body.whatif::after { content: "WHAT-IF SIMULATION — not the real numbers";
  position: fixed; right: 10px; bottom: 8px; font-size: 11px; letter-spacing: .1em;
  color: var(--c-warn); opacity: .85; pointer-events: none; z-index: 99; }
```

- [ ] **Step 4: Implement — render pass + reset + PNG stamp**

Add after `whatIfCounts_()` (from Task 1):

```js
/** Banner + watermark, rendered FIRST on every renderAll_ pass. Also the
    enforcement point: a non-admin's flag is force-reset here (defence in
    depth — the toggle button is admin-only, but hidden buttons are not a
    security model; same reasoning as the switchView_ router gate). */
function renderWhatIfBanner_() {
  if (MODEL && MODEL.viewerRole !== "admin") STATE.whatIf = false;
  var el = document.getElementById("whatifBanner");
  var on = whatIfOn_();
  document.body.className = on ? "whatif" : "";
  if (!on) { el.style.display = "none"; el.innerHTML = ""; return; }
  var c = whatIfCounts_();
  el.style.display = "";
  el.innerHTML = "🧪 <b>WHAT-IF SIMULATION</b> — invalid records removed " +
    "(kept " + c.readyKept + " of " + c.res + " delivery items · " +
    c.epicsKept + " of " + c.epics + " epics, whole export window). " +
    "These are <b>not the real numbers</b>: every rate below describes only the " +
    "records complete enough to measure. " +
    '<button class="btn" onclick="toggleWhatIf_()">Exit WHAT-IF</button>';
}
```

In `renderAll_` (~line 1071), change:

```js
function renderAll_() {
  renderScope_();
```

to:

```js
function renderAll_() {
  renderWhatIfBanner_();
  renderScope_();
```

In the `btnReset` handler (~line 1107), change:

```js
  STATE.flag = ""; STATE.expandedWeeks = {}; STATE.openDetail = {};
```

to:

```js
  STATE.flag = ""; STATE.expandedWeeks = {}; STATE.openDetail = {};
  STATE.whatIf = false;   // Reset returns EVERYTHING to the default view
```

In `savePng_` (~line 3735), change:

```js
        a.download = "delivery-health-" + name + "-" + pngPeriodStamp_() + ".png";
```

to:

```js
        // A WHAT-IF screenshot must carry the label even in its filename — the
        // captured element is inside the watermark frame, but the name is what
        // survives a file share.
        a.download = "delivery-health-" + name + "-" +
          (whatIfOn_() ? "WHATIF-" : "") + pngPeriodStamp_() + ".png";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node render-smoke.js`
Expected: `✅ render-smoke: <N> checks passed`.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html" "docs/superpowers/delivery-health-dashboard/render-smoke.js"
git commit -m "feat(dh): WHAT-IF banner, watermark, non-admin force-reset, PNG stamp"
```

---

### Task 3: Tile honesty — confident coverage, restated exclusions, small-n line

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`tileHtml_` ~line 1708; `renderTiles_` ~lines 1899–2060)
- Test: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Write the failing tests**

Append before the final `console.log`:

```js
// ══════════════════════════════════════════════════════════════════════════
// 23. WHAT-IF ON THE TILES: gate flags clear (the kept population is 100%
// attributed by construction), exclusions are RESTATED rather than hidden,
// and a tiny valid population says so instead of wearing a confidence chip.
// ══════════════════════════════════════════════════════════════════════════
C.setState("whatIf", true);
var wiShown = tiles(model({ otCov: 0.66, fcCov: 0.43 }));
assert_(!/below gate — directional only/.test(wiShown), "no below-gate caveat in WHAT-IF mode");
assert_(!/low confidence/.test(wiShown), "no low-confidence chip either");
assert_(/high confidence · 100% attributed/.test(wiShown), "kept records are 100% attributed by construction");
assert_(/33 of 33 resolved issues/.test(wiShown), "the displayed population is the valid one (W31: n=33 of 33)");
assert_(/3 excluded by the WHAT-IF filter/.test(wiShown), "unattributed items are restated, not hidden");
assert_(!/3 unattributed/.test(wiShown), "…and the real-mode wording is gone");
assert_(/closed epics excluded by the WHAT-IF filter/.test(wiShown), "not-measurable epics restated on Forecast");
// small-n honesty: n=2 valid records must not wear a confidence chip
var wiTiny = tiles(model({ otCov: 0.04, fcCov: 0.43 }));   // n = round(50×0.04) = 2
var wiTinyOt = wiTiny.split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/n=2 valid records — publishable, not meaningful/.test(wiTinyOt),
        "a sub-5 valid population says so on the card");
assert_(!/high confidence/.test(wiTinyOt), "…INSTEAD of a confidence chip, not beside one");
C.setState("whatIf", false);
var realTiny = tiles(model({ otCov: 0.04, fcCov: 0.43 }));
assert_(!/publishable, not meaningful/.test(realTiny), "the honesty line is WHAT-IF-only");
```

- [ ] **Step 2: Run to verify failure**

Run: `node render-smoke.js`
Expected: `❌ render-smoke: no below-gate caveat in WHAT-IF mode` — the coverage collapse from
Task 1 already flips confidence to high, but the FIRST failing assertion will be the
restatement one if the chips already pass; either way the run fails inside section 23.

- [ ] **Step 3: Implement — small-n line in `tileHtml_`**

In `tileHtml_` (~line 1807), change:

```js
  return '<div class="tile"><div class="lbl">' + label + '</div>' +
    '<div class="big ' + rag + '">' + big + '</div>' +
    (opts.conf ? '<div class="cmp">' + confChip_(opts.conf, opts.metric || {}) + '</div>' : "") +
```

to:

```js
  // WHAT-IF small-n honesty (spec 2026-08-03): a valid population under
  // WHATIF_MIN_N_ replaces the confidence chip — "n=2, 100% attributed" is
  // technically true and practically meaningless, and the chip would lend it
  // exactly the authority the simulation must not fake.
  var wiSmall = whatIfOn_() && opts.whatIfN !== undefined && opts.whatIfN !== null &&
                opts.whatIfN > 0 && opts.whatIfN < WHATIF_MIN_N_;
  return '<div class="tile"><div class="lbl">' + label + '</div>' +
    '<div class="big ' + rag + '">' + big + '</div>' +
    (opts.conf ? '<div class="cmp">' + (wiSmall
      ? '<span class="clow" title="Under the WHAT-IF filter this metric evaluates on fewer than ' +
        WHATIF_MIN_N_ + ' records. The rate is computable but not quotable — the fix is upstream ' +
        'data entry, not filtering.">🧪 n=' + opts.whatIfN +
        " valid records — publishable, not meaningful</span>"
      : confChip_(opts.conf, opts.metric || {})) + '</div>' : "") +
```

- [ ] **Step 4: Implement — restated exclusions + WHAT-IF-aware coverage in `renderTiles_`**

(a) On-Time card text (~line 1936). Change:

```js
  var otCmp = ot.n + " of " + ot.nAll + " " + otSc.word +
    ' <span title="' + esc_(otSc.why) + '">had a due date ⓘ</span>' + smallN_(ot.n) +
    (unatt.onTime ? ' <span title="resolved items whose Jira assignee is not on the delivery roster — excluded from this card under every filter">· ' + unatt.onTime + " unattributed</span>" : "");
```

to:

```js
  var otCmp = ot.n + " of " + ot.nAll + " " + otSc.word +
    ' <span title="' + esc_(otSc.why) + '">had a due date ⓘ</span>' + smallN_(ot.n) +
    (unatt.onTime
      ? (whatIfOn_()
        ? ' <span title="resolved items whose Jira assignee is not on the delivery roster — removed by the WHAT-IF filter, stated rather than hidden">· ' +
          unatt.onTime + " excluded by the WHAT-IF filter</span>"
        : ' <span title="resolved items whose Jira assignee is not on the delivery roster — excluded from this card under every filter">· ' +
          unatt.onTime + " unattributed</span>")
      : "");
```

(b) Forecast not-measurable detail (~line 1958). The Task 1 collapse makes `fc.nAll === fc.n`,
so the existing branch goes quiet; restate from the preserved real total. Change:

```js
  if (fc.nAll > fc.n) {
    fcDetail.push((fc.nAll - fc.n) + " of " + fc.nAll + " closed epics not measurable — no estimate, " +
      "or an estimate with no logged time at all: nothing to compare, so they count toward coverage " +
      "only instead of scoring as misses.");
  }
```

to:

```js
  if (whatIfOn_() && fc.nAllReal > fc.n) {
    fcDetail.push((fc.nAllReal - fc.n) + " closed epics excluded by the WHAT-IF filter — no estimate, " +
      "or an estimate with no logged time at all. Removed from the displayed population, stated here.");
  } else if (fc.nAll > fc.n) {
    fcDetail.push((fc.nAll - fc.n) + " of " + fc.nAll + " closed epics not measurable — no estimate, " +
      "or an estimate with no logged time at all: nothing to compare, so they count toward coverage " +
      "only instead of scoring as misses.");
  }
```

(c) Forecast unattributed detail (~line 1963). Change:

```js
  if (unatt.forecast) {
    fcDetail.push(unatt.forecast + " closed epics unattributed — the Jira assignee is not on the " +
      "delivery roster, so they are excluded from this card under every filter.");
  }
```

to:

```js
  if (unatt.forecast) {
    fcDetail.push(unatt.forecast + (whatIfOn_()
      ? " closed epics excluded by the WHAT-IF filter — the Jira assignee is not on the delivery roster."
      : " closed epics unattributed — the Jira assignee is not on the " +
        "delivery roster, so they are excluded from this card under every filter."));
  }
```

(d) Utilization classification note (~line 1902). Change:

```js
  if (live && u.tracked > 0) {
    var covPct = Math.round(u.trackedCov / u.tracked * 100);
    if (covPct < 99) {
      utilCmp += '<br><span title="Tempo says how many hours were worked; NetSuite says what share of them is billable. Person-weeks with no NetSuite signal are excluded from BOTH sides of this rate rather than counted as 0% billable — so this % describes the classified portion of the tracked base only.">⚠ classification covers ' +
        covPct + "% of tracked hours (" + r1_(u.trackedCov) + "h of " + r1_(u.tracked) + "h)</span>";
    }
  }
```

to:

```js
  if (live && u.tracked > 0) {
    var covPct = Math.round(u.trackedCov / u.tracked * 100);
    if (whatIfOn_() && covPct < 99) {
      utilCmp += '<br><span title="Unclassified hours already leave both sides of this rate; under WHAT-IF they are part of the removed population and stated here rather than hidden.">' +
        r1_(u.tracked - u.trackedCov) + "h unclassified — excluded by the WHAT-IF filter</span>";
    } else if (covPct < 99) {
      utilCmp += '<br><span title="Tempo says how many hours were worked; NetSuite says what share of them is billable. Person-weeks with no NetSuite signal are excluded from BOTH sides of this rate rather than counted as 0% billable — so this % describes the classified portion of the tracked base only.">⚠ classification covers ' +
        covPct + "% of tracked hours (" + r1_(u.trackedCov) + "h of " + r1_(u.tracked) + "h)</span>";
    }
  }
```

Also, right after the `if (u.ooo > 0 && u.cap > 0) { ... }` block (~line 1898), add:

```js
  // WHAT-IF: defaulted-capacity person-weeks left the population in utilFor_ —
  // restate the drop on the card.
  if (whatIfOn_() && u.wiWeeksDropped) {
    utilCmp += '<br><span title="person-weeks whose capacity fell back to a default (no real Tempo schedule) — removed by the WHAT-IF filter">' +
      u.wiWeeksDropped + " defaulted-capacity person-week" + (u.wiWeeksDropped === 1 ? "" : "s") +
      " excluded by the WHAT-IF filter</span>";
  }
```

(e) Utilization confidence (~line 2015). Change:

```js
  var utilConf = applyGatePolicy_(live
    ? metricConfidence_(regU.coverageGate, u.tracked > 0 ? u.trackedCov / u.tracked : null,
                        stable_(utilTrendShown))
    : metricConfidence_(0, u.avail > 0 ? 1 : null, stable_(utilTrendShown)));
```

to:

```js
  // WHAT-IF: the kept population is fully classified by construction, so
  // coverage reads 100% (the buckets-based metrics get this for free from the
  // nAll collapse; utilization's coverage is an hour ratio, so it is overridden
  // here — the ONE per-renderer touch the flag needs).
  var utilCov = u.tracked > 0 ? u.trackedCov / u.tracked : null;
  if (whatIfOn_() && utilCov !== null) utilCov = 1;
  var utilConf = applyGatePolicy_(live
    ? metricConfidence_(regU.coverageGate, utilCov, stable_(utilTrendShown))
    : metricConfidence_(0, u.avail > 0 ? 1 : null, stable_(utilTrendShown)));
```

(f) Empty-state wording + small-n plumbing in the two gated tiles (~line 2034). Change:

```js
      ? gatedTile_("On-Time Delivery", otConf, regOt,
          "no resolved delivery items in this period under the active filters",
          (ot.nAll - ot.n) + " of " + ot.nAll + " resolved items have no due date",
          function () {
            return tileHtml_("On-Time Delivery", ot.n > 0 ? ot.onTime / ot.n * 100 : null, otCmp, otTrend,
                             { headlineLabel: opts.headlineLabel, target: tg.onTime, conf: otConf,
                               metric: regOt, std: otStd, trendLabels: trendLabels });
          }, opts.headlineLabel, otCovTrend, trendLabels) +
```

to:

```js
      ? gatedTile_("On-Time Delivery", otConf, regOt,
          whatIfOn_() ? "0 valid records — nothing to evaluate"
                      : "no resolved delivery items in this period under the active filters",
          (ot.nAll - ot.n) + " of " + ot.nAll + " resolved items have no due date",
          function () {
            return tileHtml_("On-Time Delivery", ot.n > 0 ? ot.onTime / ot.n * 100 : null, otCmp, otTrend,
                             { headlineLabel: opts.headlineLabel, target: tg.onTime, conf: otConf,
                               metric: regOt, std: otStd, trendLabels: trendLabels,
                               whatIfN: ot.n });
          }, opts.headlineLabel, otCovTrend, trendLabels) +
```

And the Forecast twin directly below it — change:

```js
        (!margin ? "" : gatedTile_("Forecast Accuracy", fcConf, regFc,
          "no epics closed in this period under the active filters",
          (fc.nAll - fc.n) + " of " + fc.nAll + " closed epics have no estimate or no logged time",
          function () {
            return tileHtml_("Forecast Accuracy", fcHeadline, fcCmp, fcTrend,
                             { headlineLabel: opts.headlineLabel, target: tg.forecast, conf: fcConf,
                               metric: regFc, std: fcStd, trendLabels: trendLabels,
                               detail: fcDetail });
          }, opts.headlineLabel, fcCovTrend, trendLabels))
```

to:

```js
        (!margin ? "" : gatedTile_("Forecast Accuracy", fcConf, regFc,
          whatIfOn_() ? "0 valid records — nothing to evaluate"
                      : "no epics closed in this period under the active filters",
          (fc.nAll - fc.n) + " of " + fc.nAll + " closed epics have no estimate or no logged time",
          function () {
            return tileHtml_("Forecast Accuracy", fcHeadline, fcCmp, fcTrend,
                             { headlineLabel: opts.headlineLabel, target: tg.forecast, conf: fcConf,
                               metric: regFc, std: fcStd, trendLabels: trendLabels,
                               detail: fcDetail, whatIfN: fc.n });
          }, opts.headlineLabel, fcCovTrend, trendLabels))
```

(Utilization and Quality get no `whatIfN`: utilization's population is hours, not records, and
Quality never publishes under WHAT-IF at all.)

- [ ] **Step 5: Run tests to verify pass**

Run: `node render-smoke.js`
Expected: `✅ render-smoke: <N> checks passed`. Sections 1–20 must still pass — the real-mode
strings are untouched by construction (every change is behind `whatIfOn_()`).

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html" "docs/superpowers/delivery-health-dashboard/render-smoke.js"
git commit -m "feat(dh): WHAT-IF tile framing — restated exclusions + small-n honesty line"
```

---

### Task 4: 🔬 Data Profile panel — funnels + the WHAT-IF button

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (CSS; new functions before `renderHygiene_` ~line 3446; one line inside `renderHygiene_`'s `panel.innerHTML`)
- Test: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Bridge + failing tests**

Add to the bridge block (after `" renderAll_: renderAll_,"`):

```js
             " profileFor_: profileFor_," +
```

Append tests before the final `console.log`:

```js
// ══════════════════════════════════════════════════════════════════════════
// 24. DATA PROFILE PANEL (admin-only): per-metric evaluability funnels — where
// records fall out, stage by stage. Region/Team in NO funnel (excluded from
// the exercise by decision 2026-08-03 — tracked in the gaps table instead).
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", false);
C.renderHygiene_();
var prof = els.viewHygiene.innerHTML;
assert_(/Data Profile/.test(prof), "profile panel renders for an admin");
assert_(/WHAT-IF: valid records only/.test(prof), "…and carries the single WHAT-IF button");
var profOnly = prof.split("Data Profile")[1].split("Delivery work fully attributed")[0];
assert_(/resolved in scope/.test(profOnly) && /assignee joins the roster/.test(profOnly),
        "on-time funnel names its stages");
assert_(/carries a due date/.test(profOnly), "…down to the measurable population");
assert_(/−11/.test(profOnly), "the drop at each stage is stated (45 roster-joined → 34 with due date)");
assert_(/resolved epics/.test(profOnly) && /has an estimate/.test(profOnly), "forecast funnel present");
assert_(/cannot be profiled/.test(profOnly), "Quality states it cannot be profiled — no fake funnel");
assert_(!/[Rr]egion/.test(profOnly), "Region appears in NO funnel");
// pure-function funnel monotonicity — each stage ≤ the one before
var pf = C.profileFor_(
  { res: 50, resDue: 40, resAssigned: 47, resAttr: 45, resReady: 34, epics: 20, epicsEst: 14, epicsTime: 9 },
  { tracked: 160, trackedCov: 150, weeks: 4, capEst: 1 });
[pf.onTime.stages, pf.forecast.stages].forEach(function (st) {
  for (var i = 1; i < st.length; i++) {
    assert_(st[i].n <= st[i - 1].n, "funnel is monotone: " + st[i].label);
  }
});
assert_(pf.util.bars[0].n === 3 && pf.util.bars[0].of === 4, "util bar 1 = real-capacity person-weeks");
// viewer: the whole section simply does not render
C.getModel().viewerRole = "viewer";
C.renderHygiene_();
var profV = els.viewHygiene.innerHTML;
assert_(!/Data Profile/.test(profV) && !/WHAT-IF/.test(profV), "no profile, no button for a viewer");
C.getModel().viewerRole = "admin";
```

- [ ] **Step 2: Run to verify failure**

Run: `node render-smoke.js`
Expected: `ReferenceError: profileFor_ is not defined` (thrown by the bridge eval).

- [ ] **Step 3: Implement — CSS**

In the `<style>` block, extend the WHAT-IF CSS section added in Task 2 with:

```css
.profPanel { border: 1px solid var(--line, #4443); border-radius: 8px; padding: 10px 12px; margin: 10px 0; }
.profPanel h4 { margin: 0 0 4px; }
.funnel { margin: 10px 0 4px; }
.fnTitle { font-weight: 600; font-size: 12px; margin-bottom: 2px; }
.fnRow { display: grid; grid-template-columns: 260px 1fr 170px; gap: 8px; align-items: center; font-size: 12px; }
.fnRow .hbar i { background: var(--c-series); }
.fnDrop { color: var(--c-bad); font-weight: 600; }
```

- [ ] **Step 4: Implement — profile functions + panel**

In `Dashboard.html`, immediately BEFORE `function gateEditorHtml_()` (~line 3378), add:

```js
/**
 * ── 🔬 DATA PROFILE + WHAT-IF (spec 2026-08-03, admin-only) ─────────────────
 * Per-metric evaluability funnels over one hygiene window: where records fall
 * out of "measurable", stage by stage, with the drop at each step stated. Pure
 * over hygieneFor_/hygienePeopleFor_ output so render-smoke can pin it down.
 * Region/Team appear in NO funnel — excluded from the WHAT-IF exercise by
 * decision (the Jira fields are unpopulated org-wide, PR-01); they stay in the
 * gaps table below, which is unchanged.
 */
function profileFor_(h, pp) {
  return {
    onTime: { title: "On-Time Delivery — " + onTimeScopeWord_(), stages: [
      { label: "resolved in scope", n: h.res },
      { label: "has a Jira assignee", n: h.resAssigned },
      { label: "assignee joins the roster", n: h.resAttr },
      { label: "…and carries a due date — measurable", n: h.resReady },
    ] },
    forecast: { title: "Forecast Accuracy — resolved epics", stages: [
      { label: "resolved epics", n: h.epics },
      { label: "has an estimate", n: h.epicsEst },
      { label: "…and logged time — measurable", n: h.epicsTime },
    ] },
    util: { title: "Billable Utilization", bars: [
      { label: "person-weeks on real Tempo capacity", n: pp.weeks - pp.capEst, of: pp.weeks, unit: " weeks" },
      { label: "tracked hours billable-classified", n: r1_(pp.trackedCov), of: r1_(pp.tracked), unit: "h" },
    ] },
  };
}

/** One funnel: bar width vs the TOP stage, count · %, and −drop vs the stage
    before — the drop is the finding, so it is printed, not inferred. */
function funnelHtml_(f) {
  var top = f.stages.length ? f.stages[0].n : 0;
  var rows = f.stages.map(function (st, i) {
    var pct = top > 0 ? Math.round(st.n / top * 100) : 0;
    var drop = i > 0 ? f.stages[i - 1].n - st.n : 0;
    return '<div class="fnRow"><span>' + esc_(st.label) + "</span>" +
      '<div class="hbar"><i style="width:' + pct + '%"></i></div>' +
      "<span>" + st.n + (top > 0 ? " · " + pct + "%" : "") +
      (i > 0 ? ' <b class="fnDrop"' + (drop > 0 ? "" : ' style="opacity:.35"') + ">−" + drop + "</b>" : "") +
      "</span></div>";
  }).join("");
  return '<div class="funnel"><div class="fnTitle">' + esc_(f.title) + "</div>" + rows + "</div>";
}

/** Utilization's two coverage bars — not a chain, so no drop column. */
function utilBarsHtml_(u) {
  var rows = u.bars.map(function (b) {
    var pct = b.of > 0 ? Math.round(b.n / b.of * 100) : 0;
    return '<div class="fnRow"><span>' + esc_(b.label) + "</span>" +
      '<div class="hbar"><i style="width:' + pct + '%"></i></div>' +
      "<span>" + b.n + " of " + b.of + b.unit + " · " + pct + "%</span></div>";
  }).join("");
  return '<div class="funnel"><div class="fnTitle">' + esc_(u.title) + "</div>" + rows + "</div>";
}

/** The whole 🔬 section: funnels + the ONE WHAT-IF button. Admin-only — the
    same code-level gate as gateEditorHtml_, and whatIfOn_/renderWhatIfBanner_
    enforce the role even if this HTML leaked. */
function profilePanelHtml_(h, pp, winLabel) {
  if (MODEL.viewerRole !== "admin") return "";
  var on = whatIfOn_();
  var body = (h.res > 0 || pp.weeks > 0)
    ? (function () {
        var pf = profileFor_(h, pp);
        return funnelHtml_(pf.onTime) + funnelHtml_(pf.forecast) + utilBarsHtml_(pf.util) +
          '<div class="cellSub">Quality / Rework cannot be profiled — Status Category, Rework Link ' +
          "and Reopened are not in the deployed export (needs v3.6.0, PR-09). Filtering cannot " +
          "conjure columns that were never exported.</div>";
      })()
    : '<div class="emptyState">no complete-period data in this window</div>';
  return '<div class="profPanel"><h4>🔬 Data Profile · ' + esc_(winLabel) + "</h4>" +
    '<p class="cellSub">Where records fall out of evaluability, per metric — the drop at each ' +
    "stage is the work queue. Region and Team are excluded from this exercise (unpopulated in " +
    "Jira, PR-01 — tracked in the gaps table below).</p>" + body +
    '<div style="margin:10px 0"><button class="btn' + (on ? " on" : "") +
      '" onclick="toggleWhatIf_()">' +
      (on ? "Exit WHAT-IF" : "🧪 WHAT-IF: valid records only") + "</button> " +
    '<span class="cellSub">flips the WHOLE dashboard to the measurable populations above — ' +
    "session-only, banner on every tab, a reload always returns to real mode</span></div></div>";
}
```

- [ ] **Step 5: Implement — mount in `renderHygiene_`**

In `renderHygiene_`'s `panel.innerHTML` expression (~line 3578), change:

```js
    "A well-tagged region does not make the feed publishable.</p>" + nav +
    '<div class="tiles"><div class="tile"><div class="lbl">Delivery work fully attributed · ' +
```

to:

```js
    "A well-tagged region does not make the feed publishable.</p>" + nav +
    profilePanelHtml_(h, pp, winLabel) +
    '<div class="tiles"><div class="tile"><div class="lbl">Delivery work fully attributed · ' +
```

- [ ] **Step 6: Run tests to verify pass**

Run: `node render-smoke.js`
Expected: `✅ render-smoke: <N> checks passed`. Watch section 5 and 20 (existing hygiene
tests) — they assert on `els.viewHygiene.innerHTML`, which now also contains the profile
panel; their regexes are additive matches and must still pass.

- [ ] **Step 7: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html" "docs/superpowers/delivery-health-dashboard/render-smoke.js"
git commit -m "feat(dh): 🔬 Data Profile funnels + WHAT-IF button in the Hygiene tab (admin-only)"
```

---

### Task 5: CEO Brief — deterministic 3/3/3 + concerns, with Copy

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (new functions next to `profileFor_`; one call inside `profilePanelHtml_`; CSS)
- Test: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Bridge + failing tests**

Add to the bridge block (after `" profileFor_: profileFor_,"`):

```js
             " briefFor_: briefFor_," +
```

Append tests before the final `console.log`:

```js
// ══════════════════════════════════════════════════════════════════════════
// 25. CEO BRIEF: deterministic rules — same data in, same brief out. Facts by
// population size; highlights = what already meets its gate; notes = the
// decision registry; concerns ranked by dropped × cards-blocked, each ending
// in change/owner/target, with the WHAT-IF consequence leading concern #1.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", false);
C.renderHygiene_();
assert_(/CEO Brief/.test(els.viewHygiene.innerHTML), "brief renders inside the profile panel");
assert_(/copyBrief_\(\)/.test(els.viewHygiene.innerHTML), "…with a Copy control");
// DATA-BLOCKERS.md-shaped input: the roster join is the biggest lever
var bh = { res: 100, resDue: 80, resAssigned: 94, resAttr: 54, resReady: 50,
           epics: 18, epicsEst: 4, epicsTime: 3 };
var bp = { tracked: 4000, trackedCov: 3800, weeks: 100, capEst: 3 };
var b1 = C.briefFor_(bh, bp), b2 = C.briefFor_(bh, bp);
assert_(JSON.stringify(b1) === JSON.stringify(b2), "deterministic: identical output on repeat calls");
assert_(b1.facts.length === 3 && b1.highlights.length === 3 && b1.notes.length === 3,
        "exactly 3 facts / 3 highlights / 3 notes");
assert_(b1.concerns.length >= 1 && b1.concerns.length <= 4, "1–4 concerns");
assert_(/n=50/.test(b1.concerns[0]) && /upstream data entry, not filtering/.test(b1.concerns[0]),
        "concern #1 leads with the WHAT-IF consequence and the measured n");
assert_(/roster person/.test(b1.concerns[0]),
        "ranking is dropped × cards-blocked: the roster join (40 × 4) outranks everything");
assert_(/owner: /.test(b1.concerns[0]) && /target: 2026\.W3[45]/.test(b1.concerns[0]),
        "every concern ends in owner + ISO target week");
assert_(b1.facts.every(function (f) { return /\d+ of \d+/.test(f) && /vs gate \d+%/.test(f); }),
        "facts are measured kept-of-total statements against their gates");
assert_(b1.notes.every(function (n) { return /2026-\d\d-\d\d/.test(n); }),
        "notes are date-stamped decisions");
// sparse window: the brief never renders short and never fakes a number
var b0 = C.briefFor_({ res: 0, resDue: 0, resAssigned: 0, resAttr: 0, resReady: 0,
                       epics: 0, epicsEst: 0, epicsTime: 0 },
                     { tracked: 0, trackedCov: 0, weeks: 0, capEst: 0 });
assert_(b0.facts.length === 3 && b0.highlights.length === 3 && b0.notes.length === 3 &&
        b0.concerns.length >= 1, "sparse data still yields a full 3/3/3 + concern brief");
assert_(/not measurable/.test(b0.facts[0]), "…with facts saying 'not measurable', not fake zeros");
```

- [ ] **Step 2: Run to verify failure**

Run: `node render-smoke.js`
Expected: `ReferenceError: briefFor_ is not defined`.

- [ ] **Step 3: Implement — brief functions**

In `Dashboard.html`, immediately AFTER the `profileFor_` function added in Task 4, add:

```js
/**
 * ── 📄 CEO BRIEF (spec 2026-08-03) ──────────────────────────────────────────
 * Deterministic by design: same data in, same brief out, so a quoted line can
 * always be reproduced. No API calls, no randomness — a Gemini rewrite was
 * considered and rejected (wording that changes between loads is a liability
 * when executives quote it).
 *
 * Owners ARE named here, deliberately. The public gaps table dropped its Owner
 * column (2026-08-03 — a widely-read blame board doesn't fix tagging); this
 * brief is admin-only and exists to hand the Director accountable actions.
 */
var BRIEF_NOTES_ = [
  { date: "2026-08-03", text: "On-Time keeps the Metrics Dictionary scope (epics / milestones / client commitments) — ratified over the healthier-looking Stories/Tasks reading, which would hide the epic due-date blocker" },
  { date: "2026-08-03", text: "Region and Team are excluded from the WHAT-IF exercise: the Jira fields are unpopulated org-wide (PR-01). Region shown elsewhere is derived from where hours were logged (◦ marker)" },
  { date: "2026-08-03", text: "Due dates and estimates are the mutable Jira fields, not baselined commitments — a re-baselined milestone or a revised estimate silently scores as on target (PR-02 / PR-03)" },
];

/** Gap candidates. kept/total are records; the two hour-based gaps rank in
    person-week equivalents (÷40h) so `dropped × cards` compares like units.
    cards = how many of the four KPI cards the gap starves (fixed map — the
    assignee and roster-join gaps starve all four; the rest starve one). */
function briefGaps_(h, pp) {
  var wkH = 40;
  return [
    { name: "Jira assignee on resolved work", kept: h.resAssigned, total: h.res, gate: 0.95, cards: 4,
      owner: "Delivery leadership", week: "2026.W35", action: "close issues with an assignee on them" },
    { name: "Assignee resolves to a roster person", kept: h.resAttr, total: h.resAssigned, gate: 0.95, cards: 4,
      owner: "WFP / this dashboard", week: "2026.W35",
      action: "fix the roster name index + crew Department gate (our bug, not Jira's)" },
    { name: "Due date on the work On-Time measures", kept: h.resDue, total: h.res, gate: 0.80, cards: 1,
      owner: "Delivery leadership", week: "2026.W34", action: "set due dates on epics at kickoff" },
    { name: "Estimate on closed epics", kept: h.epicsEst, total: h.epics, gate: 0.70, cards: 1,
      owner: "Delivery leadership", week: "2026.W34",
      action: "estimate epics at kickoff (real forecasts, not 10h placeholders)" },
    { name: "Logged time on estimated epics", kept: h.epicsTime, total: h.epicsEst, gate: 0.70, cards: 1,
      owner: "Delivery leadership", week: "2026.W35", action: "log time on the epic or its children" },
    { name: "Billable classification on tracked hours", kept: Math.round(pp.trackedCov / wkH),
      total: Math.round(pp.tracked / wkH), gate: 0.90, cards: 1,
      owner: "Ops (NetSuite feed)", week: "2026.W35", action: "classify tracked hours in NetSuite" },
    { name: "Real Tempo capacity (not defaulted)", kept: pp.weeks - pp.capEst, total: pp.weeks,
      gate: 0.95, cards: 1,
      owner: "Ops (Tempo feed)", week: "2026.W34", action: "load real schedules into Tempo" },
  ];
}

/** Alphabetical tiebreak so equal-scoring rows always order the same way. */
function briefTie_(a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); }

function briefFor_(h, pp) {
  var gaps = briefGaps_(h, pp).map(function (g) {
    g.pct = g.total > 0 ? g.kept / g.total : null;
    g.dropped = g.total - g.kept;
    return g;
  });
  var measured = gaps.filter(function (g) { return g.pct !== null; });

  // FACTS — measured kept-of-total statements, biggest population first.
  var facts = measured.slice().sort(function (a, b) {
    return b.total - a.total || briefTie_(a, b);
  }).slice(0, 3).map(function (g) {
    return g.kept + " of " + g.total + " — " + g.name + " (" +
      Math.round(g.pct * 100) + "% vs gate " + Math.round(g.gate * 100) + "%)";
  });
  while (facts.length < 3) facts.push("not measurable this window — no complete-period data");

  // HIGHLIGHTS — what already works, best first; padded with fixed truths so
  // the brief never renders short (deterministic fallbacks, not filler prose).
  var hi = [];
  measured.filter(function (g) { return g.pct >= g.gate; })
    .sort(function (a, b) { return b.pct - a.pct || briefTie_(a, b); })
    .forEach(function (g) { hi.push(g.name + " already meets its gate (" + Math.round(g.pct * 100) + "%)"); });
  measured.filter(function (g) { return g.pct < g.gate && g.pct >= 0.70; })
    .sort(function (a, b) { return b.pct - a.pct || briefTie_(a, b); })
    .forEach(function (g) {
      hi.push(g.name + " at " + Math.round(g.pct * 100) + "% — within reach of its " +
        Math.round(g.gate * 100) + "% gate");
    });
  hi.push("52-week export window in place — supports the six-period trend the Dictionary asks for");
  hi.push("every card states its own coverage and gate — a weak number is never presented as a strong one");
  hi.push("every gap in this view is trended — progress is visible between reviews instead of re-litigated");
  var highlights = hi.slice(0, 3);

  // NOTES — the decision registry, newest first.
  var notes = BRIEF_NOTES_.slice().sort(function (a, b) {
    return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
  }).slice(0, 3).map(function (n) { return n.text + " (" + n.date + ")"; });

  // CONCERNS — failing gaps ranked by dropped × cards-blocked; each ends in the
  // action. The WHAT-IF consequence LEADS concern #1: "filter the garbage" must
  // never read as the fix.
  var concerns = measured.filter(function (g) { return g.pct < g.gate; })
    .sort(function (a, b) {
      return b.dropped * b.cards - a.dropped * a.cards || briefTie_(a, b);
    }).slice(0, 4).map(function (g) {
      return g.name + " — " + g.kept + " of " + g.total + " (" + Math.round(g.pct * 100) +
        "% vs gate " + Math.round(g.gate * 100) + "%) → change: " + g.action +
        " · owner: " + g.owner + " · target: " + g.week;
    });
  if (concerns.length) {
    concerns[0] = "Keeping only valid records leaves On-Time evaluating on n=" + h.resReady +
      " and Forecast on n=" + h.epicsTime + " — publishable, not meaningful. The fix is " +
      "upstream data entry, not filtering. Biggest lever: " + concerns[0];
  } else {
    concerns.push("No funnel gap is failing its gate in this window — hold the line and re-run at period close.");
  }
  return { facts: facts, highlights: highlights, notes: notes, concerns: concerns };
}

function briefHtml_(brief) {
  function sec(title, items) {
    return "<h5>" + title + "</h5><ul>" + items.map(function (t) {
      return "<li>" + esc_(t) + "</li>";
    }).join("") + "</ul>";
  }
  return '<div class="brief">' +
    '<div style="display:flex;align-items:center;gap:8px"><h4 style="flex:1;margin:0">📄 CEO Brief' +
    ' <span class="cellSub" title="Derived by fixed rules from the measured profile — same data, same brief, reproducible when quoted.">deterministic ⓘ</span></h4>' +
    '<button class="btn" onclick="copyBrief_()">📋 Copy</button>' +
    '<span id="briefMsg" class="cellSub"></span></div>' +
    sec("Top 3 Facts", brief.facts) + sec("Top 3 Highlights", brief.highlights) +
    sec("Top 3 Notes", brief.notes) + sec("Top Concerns", brief.concerns) + "</div>";
}

/** Plain-text form for pasting into the review deck / doc. */
function briefText_(brief) {
  function sec(title, items) {
    return "## " + title + "\n" + items.map(function (t) { return "- " + t; }).join("\n");
  }
  return "# Delivery Health — CEO Brief\n\n" + sec("Top 3 Facts", brief.facts) + "\n\n" +
    sec("Top 3 Highlights", brief.highlights) + "\n\n" + sec("Top 3 Notes", brief.notes) +
    "\n\n" + sec("Top Concerns", brief.concerns) + "\n";
}

/** Copies the brief rendered by the LAST renderHygiene_ pass (stashed on
    STATE), with the textarea fallback the GAS iframe sometimes needs. */
function copyBrief_() {
  var txt = STATE._briefText || "";
  var msg = document.getElementById("briefMsg");
  function ok() { if (msg) msg.textContent = "✅ copied"; }
  function fallback() {
    var ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); ok(); }
    catch (e) { if (msg) msg.textContent = "⚠️ copy blocked — select the text manually"; }
    document.body.removeChild(ta);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(ok, fallback);
  } else { fallback(); }
}
```

- [ ] **Step 4: Implement — mount the brief in the profile panel + CSS**

In `profilePanelHtml_` (Task 4), change the ending:

```js
    '<span class="cellSub">flips the WHOLE dashboard to the measurable populations above — ' +
    "session-only, banner on every tab, a reload always returns to real mode</span></div></div>";
```

to:

```js
    '<span class="cellSub">flips the WHOLE dashboard to the measurable populations above — ' +
    "session-only, banner on every tab, a reload always returns to real mode</span></div>" +
    (function () {
      var brief = briefFor_(h, pp);
      STATE._briefText = briefText_(brief);   // what 📋 Copy copies
      return briefHtml_(brief);
    })() + "</div>";
```

Extend the WHAT-IF CSS section with:

```css
.brief { border-top: 1px dashed var(--line, #4443); margin-top: 10px; padding-top: 8px; }
.brief h5 { margin: 8px 0 2px; font-size: 12px; }
.brief ul { margin: 0 0 4px 18px; padding: 0; font-size: 12px; }
.brief li { margin: 2px 0; }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node render-smoke.js`
Expected: `✅ render-smoke: <N> checks passed`.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html" "docs/superpowers/delivery-health-dashboard/render-smoke.js"
git commit -m "feat(dh): deterministic CEO brief (3 facts / 3 highlights / 3 notes / concerns) with Copy"
```

---

### Task 6: Full-suite verification + README note

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/README.md` (Data Hygiene section, ~line 380)

- [ ] **Step 1: Run both suites**

Run (from `docs/superpowers/delivery-health-dashboard/`):

```bash
node node-tests.js && node render-smoke.js
```

Expected: node-tests prints its ✅ lines (Code.js untouched — any failure here means an
accidental server edit; stop and investigate), then `✅ render-smoke: <N> checks passed`.

- [ ] **Step 2: Document in README**

In `README.md`, find the `## Data Hygiene view (🧪 Hygiene)` section (~line 380) and append at
the END of that section (before the next `##` heading):

```markdown
### 🔬 Data Profile + WHAT-IF (admin-only)

Above the gaps table, admins get per-metric **evaluability funnels** (resolved → assignee →
roster join → due date; epics → estimate → logged time; utilization's two coverage bars —
Quality states it cannot be profiled until export v3.6.0). One button — **🧪 WHAT-IF: valid
records only** — flips the whole dashboard to the measurable populations: coverage reads 100%,
gate flags clear, exclusions are restated on each card, and a metric left with under 5 valid
records says *"publishable, not meaningful"* instead of wearing a confidence chip. The mode is
session-only, admin-only (force-reset in `renderAll_` for anyone else), and unmistakable: a
banner on every tab, a dashed watermark frame, and a `WHATIF-` stamp on PNG filenames.

Underneath, a **deterministic CEO brief** (top 3 Facts / 3 Highlights / 3 Notes / top
Concerns) is derived by fixed rules from the same profile — concerns ranked by
records-dropped × cards-blocked, each ending in change / owner / target week, with the
WHAT-IF consequence leading concern #1 so "filter the garbage" never reads as the fix.
Owners are named here (admin-only) even though the public gaps table stays owner-free.
Spec: `docs/superpowers/specs/2026-08-03-hygiene-whatif-profiling-design.md`.
```

- [ ] **Step 3: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/README.md"
git commit -m "docs(dh): README — Data Profile + WHAT-IF + CEO brief in the Hygiene section"
```

---

## Deploy (after all tasks pass — manual, owner-run)

1. Copy the updated `Dashboard.html` into the GAS project (only that file — `Code.js` and
   `Security.js` are untouched).
2. Deploy a new web-app version. **No `PS_CACHE_VER`-style bump, no cache bust** — the model
   payload is unchanged.
3. Live QA as an admin: 🧪 Hygiene → profile funnels render with real counts → press WHAT-IF →
   banner + watermark on every tab, On-Time shows the small-n honesty line (real data has n≈2)
   → Exit → reload → real mode. Then as a viewer/manager: no profile section, no button.
