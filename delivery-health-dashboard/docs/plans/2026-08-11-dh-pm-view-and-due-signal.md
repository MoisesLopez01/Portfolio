# DH PM-Owned Work Tab + Due-Date Urgency Bands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Colour due dates by urgency in the People drill-down, and add a 🗓 PM tab that reports epic due-date fill per PM alongside the backlog readiness of their projects.

**Architecture:** Two independent shipping units. **F1** (Tasks 1–3) is client-only — a numeric ISO-week comparator and a band helper applied to one table cell, no payload change. **F2** (Tasks 4–10) adds three pure server functions that attribute Jira issues to a PM via `project key → PM` folded from the Tempo rows, ships them as `model.pmOwned`, and renders a new tab. Attribution is project-grained and never touches the roster, which is why PMs being absent from the delivery population is not a blocker.

**Tech Stack:** Google Apps Script (ES5 — `var`, no arrow functions, no template literals, no `const`/`let`), plain HTML/CSS/inline SVG served by `HtmlService`. Tests are two local Node scripts that `eval` the GAS source.

---

## Before you start

**Working directory for every command:** `D:\Contribution\docs\superpowers\delivery-health-dashboard`

**Read the spec first:** `delivery-health-dashboard/docs/specs/2026-08-11-dh-pm-view-and-due-signal-design.md`

**ES5 only.** This code is pasted into the Apps Script editor. `const`, `let`, arrow functions, template literals, `Array.prototype.includes` and object spread all fail there. Use `var`, `function`, string concatenation, and `indexOf(...) !== -1`. Match the surrounding style exactly.

**Two test commands, both run from the directory above:**

```bash
node node-tests.js      # pure functions in Code.js + client/server parity
node render-smoke.js    # evals Dashboard.html's inline <script> and asserts on HTML
```

Both must pass before every commit. Neither file may ever be pasted into the GAS project — they carry a banner saying so, and only three files go to GAS: `Code.js`, `Security.js`, `Dashboard.html`.

**Existing counts to compare against** (record the actual numbers on your first run — they grow as tasks land):

```bash
node node-tests.js 2>&1 | tail -3
node render-smoke.js 2>&1 | tail -1     # prints "✅ render-smoke: N checks passed"
```

**Do not run `git push`.** This repo stays local. Commit only.

---

## File structure

| File | Responsibility | Tasks |
|---|---|---|
| `Dashboard.html` | `isoCmp_`, `dueBand_`, the due cell, the 🗓 PM tab renderer, the filter-label rename | 1, 3, 8, 9 |
| `Code.js` | `dhProjectOf_`, `pmByProject_`, `pmOwnedWork_`, model wiring, schema bump, their `_test_` functions | 4, 5, 6, 7 |
| `node-tests.js` | Registers the new `_test_` functions; hosts `_test_dueBandParity_` | 2, 4, 5, 6, 7 |
| `render-smoke.js` | Bridge entries + rendering assertions for the band and the tab | 3, 9 |
| `README.md` / `COMPONENTS.md` | Schema history row, deploy order, what the tab is and how far to trust it | 10 |

---

# UNIT F1 — Due-date urgency bands

Client-only. No schema bump, no `bustDeliveryCache_()`. Ships independently of F2.

---

### Task 1: `isoCmp_` — a numeric ISO-week comparator

**Why this is its own task:** week keys are **not zero-padded**. `isoWeekNum_` (`Code.js:1062`) returns an integer, so `weekKeyFromDate_` emits `"2026.W9"`, not `"2026.W09"`. Under a lexicographic compare `"2026.W9" > "2026.W10"`, so weeks 1–9 rank as *later* than weeks 10–53 and overdue work would paint green for the first nine weeks of every year. `isoWeekBefore_` (`Code.js:1337`) already parses numerically for exactly this reason.

**Files:**
- Modify: `Dashboard.html` — insert immediately before `function rosterDetailRow_` (currently line 7225)
- Test: `render-smoke.js`

- [ ] **Step 1: Add the bridge entry so the test can reach the function**

In `render-smoke.js`, find the line in the `bridge` string that reads:

```js
             " renderEpicDue_: renderEpicDue_," +
```

Add directly below it:

```js
             // Due-date urgency bands (spec 2026-08-11 §4). isoCmp_ is exposed
             // because the single-digit-week case is the whole reason it exists.
             " isoCmp_: isoCmp_, dueBand_: dueBand_," +
```

- [ ] **Step 2: Write the failing test**

In `render-smoke.js`, immediately above the final `console.log("✅ render-smoke: " + checks + " checks passed");` line, add:

```js
// ── Due-date urgency bands (spec 2026-08-11 §4) ─────────────────────────────
(function dueBandChecks() {
  // THE bug this guards: week keys are not zero-padded, so a lexicographic
  // compare ranks "2026.W9" after "2026.W10" and paints nine weeks of overdue
  // work green every January-to-March.
  assert_(C.isoCmp_("2026.W9", "2026.W10") === -1,
          "isoCmp_: W9 is BEFORE W10 — the assertion a string compare fails");
  assert_(C.isoCmp_("2026.W10", "2026.W9") === 1, "isoCmp_: and the reverse");
  assert_(C.isoCmp_("2026.W33", "2026.W33") === 0, "isoCmp_: equal weeks");
  assert_(C.isoCmp_("2025.W52", "2026.W1") === -1,
          "isoCmp_: year boundary — W52 of last year precedes W1 of this one");
  assert_(C.isoCmp_("2026.W1", "2025.W52") === 1, "isoCmp_: year boundary reversed");
  assert_(C.isoCmp_("", "2026.W1") === null, "isoCmp_: unparseable is null, not 0");
  assert_(C.isoCmp_("2026.W1", "not-a-week") === null, "isoCmp_: null both directions");

  // Swept across the whole year so a regression cannot hide in the months
  // nobody happens to test in.
  var swept = 0;
  for (var w = 1; w <= 53; w++) {
    for (var v = 1; v <= 53; v++) {
      var got = C.isoCmp_("2026.W" + w, "2026.W" + v);
      var want = w === v ? 0 : (w < v ? -1 : 1);
      if (got !== want) {
        throw new Error("❌ render-smoke: isoCmp_ W" + w + " vs W" + v +
                        " gave " + got + ", want " + want);
      }
      swept++;
    }
  }
  assert_(swept === 53 * 53, "isoCmp_: swept every W1–W53 pair (" + swept + ")");
})();
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node render-smoke.js
```

Expected: fails while building the bridge — `ReferenceError: isoCmp_ is not defined`.

- [ ] **Step 4: Write the implementation**

In `Dashboard.html`, insert immediately before `function rosterDetailRow_(p, head) {`:

```js
/**
 * Compare two "YYYY.WN" week keys. → -1 | 0 | 1, or null when either is
 * unparseable (an unknown shape must never silently rank as "earlier").
 *
 * NUMERIC ON PURPOSE. Week keys are NOT zero-padded — isoWeekNum_ returns an
 * integer, so weekKeyFromDate_ emits "2026.W9", not "2026.W09". A lexicographic
 * compare therefore ranks "2026.W9" AFTER "2026.W10", which would paint every
 * genuinely overdue item green for the first nine weeks of each year: invisible
 * in August, wrong every February. The server's isoWeekBefore_ parses the same
 * pattern for the same reason — this is that rule, client-side.
 */
function isoCmp_(a, b) {
  var pa = /^(\d{4})\.W(\d{1,2})$/.exec(String(a || ""));
  var pb = /^(\d{4})\.W(\d{1,2})$/.exec(String(b || ""));
  if (!pa || !pb) return null;
  var ya = +pa[1], yb = +pb[1];
  if (ya !== yb) return ya < yb ? -1 : 1;
  var wa = +pa[2], wb = +pb[2];
  return wa === wb ? 0 : (wa < wb ? -1 : 1);
}

/**
 * Urgency band for a due-date cell, as a CSS class name.
 *
 *   🔴 sigBad   due week EARLIER than the current ISO week  → overdue
 *   🟠 sigWarn  due week IS the current ISO week            → act now
 *   🟢 sigGood  due week LATER than the current ISO week    → future
 *
 * WEEK precision, not day precision: the managers' rule (2026-08-10) is that the
 * current week is compliant, and every reporting surface in this app is weekly.
 * The red band is the same claim as the server's dhOverdue_ — see the parity
 * test in node-tests.js.
 *
 * `undatedIsGap` decides what NO due date means, and it is per-surface BY
 * DESIGN — do not "fix" the inconsistency:
 *   true  → the caller's list is already filtered to STARTED work (openIssues
 *           drops unstarted-undated by rule), so an undated row there is a real
 *           gap and stays the red it has always been.
 *   false → the caller's list contains UNSTARTED work too, which is not a
 *           commitment yet and must not be coloured as a failure.
 *
 * Returns "" for ungraded, which callers render as a plain cell.
 */
function dueBand_(dueIso, nowIso, undatedIsGap) {
  if (!dueIso) return undatedIsGap ? "sigBad" : "";
  var c = isoCmp_(dueIso, nowIso);
  if (c === null) return "";
  return c < 0 ? "sigBad" : (c === 0 ? "sigWarn" : "sigGood");
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
node render-smoke.js
```

Expected: `✅ render-smoke: N checks passed`, N up by 9 from your baseline.

- [ ] **Step 6: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): isoCmp_/dueBand_ — numeric ISO-week comparison for due urgency

Week keys are not zero-padded: weekKeyFromDate_ emits \"2026.W9\", so a
lexicographic compare ranks W9 after W10 and would paint nine weeks of overdue
work green every year. isoWeekBefore_ already parses numerically for the same
reason; this is that rule client-side, swept across all 53x53 week pairs.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Parity between `dueBand_` red and the server's `dhOverdue_`

**Why:** the red band asserts the same thing as `dhOverdue_` (`Code.js:2434`, `due < dhWeekStart_(now)` — already week-grained). Two implementations of one rule drift silently; that is how the billable-split and confidence-gate bugs both survived. This test joins `_test_clientParity_` and `_test_confidenceParity_` in the same family.

**Files:**
- Modify: `node-tests.js` — add after the existing `_test_sampleFloorParity_` IIFE

- [ ] **Step 1: Write the failing test**

In `node-tests.js`, find the closing line of `_test_sampleFloorParity_`:

```js
  Logger.log("✅ _test_sampleFloorParity_ passed (" + checked + " id×n combinations)");
```

After that IIFE's closing `})();`, add:

```js
// ── DUE-BAND / OVERDUE PARITY ────────────────────────────────
// dueBand_ lives in Dashboard.html and paints a cell red; dhOverdue_ lives in
// Code.js and drives the overdue counts, the three ageing bands and the
// futureDated complement. They are the SAME CLAIM. If they disagree, a manager
// sees a red cell the panel above it does not count, or the reverse — and each
// looks perfectly correct read on its own. Same trap as _test_clientParity_.
(function _test_dueBandParity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_dueBandParity_: " + m); }
  var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  ["isoCmp_", "dueBand_"].forEach(function (fn) {
    var m = html.match(new RegExp("\\nfunction " + fn + "\\s*\\([\\s\\S]*?\\n\\}"));
    if (!m) throw new Error("❌ _test_dueBandParity_: could not extract " + fn + " from Dashboard.html");
    eval(m[0]);
  });

  // Monday of a known week, so both sides are anchored on the same calendar.
  // 2026-08-11 is a Tuesday in 2026.W33.
  var now = new Date(2026, 7, 11);
  var nowIso = weekKeyFromDate_(now);
  assert_(nowIso === "2026.W33", "fixture anchor is 2026.W33, got " + nowIso);

  // Sweep a year either side of the anchor, one date per week, and require the
  // client band and the server predicate to agree on every one.
  var checked = 0;
  for (var off = -60; off <= 60; off++) {
    var d = new Date(2026, 7, 11);
    d.setDate(d.getDate() + off * 7);
    var iso = weekKeyFromDate_(d);
    var serverLate = dhOverdue_({ due: d }, now);
    var clientBand = dueBand_(iso, nowIso, true);
    assert_(serverLate === (clientBand === "sigBad"),
            "week " + iso + ": dhOverdue_=" + serverLate + " but band=" + clientBand);
    checked++;
  }

  // The current week is amber on the client and NOT overdue on the server —
  // the managers' 2026-08-10 rule, asserted from both sides at once.
  assert_(dueBand_(nowIso, nowIso, true) === "sigWarn", "current week is amber, never red");
  assert_(dhOverdue_({ due: now }, now) === false, "…and the server agrees it is not late");

  // Undated is per-surface (spec §4.3) and that is deliberate.
  assert_(dueBand_("", nowIso, true) === "sigBad",
          "undated in a started-work-only list stays the red it is today");
  assert_(dueBand_("", nowIso, false) === "",
          "undated where unstarted work can appear is ungraded, not an accusation");

  Logger.log("✅ _test_dueBandParity_ passed (" + checked + " week comparisons)");
})();
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_dueBandParity_ passed (121 week comparisons)`.

> If it FAILS, do not weaken the test — one of the two implementations is wrong and finding out which is the entire point.

- [ ] **Step 3: Commit**

```bash
git add node-tests.js
git commit -m "test(dh): pin dueBand_ red to the server's dhOverdue_

Two implementations of \"late\" across 121 weeks either side of a known anchor,
plus the managers' current-week-is-compliant rule asserted from both sides.
Same drift trap as _test_clientParity_ and _test_confidenceParity_.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Paint the due cell in the People drill-down

**Files:**
- Modify: `Dashboard.html:7363` (inside `rosterDetailRow_`)
- Test: `render-smoke.js`

- [ ] **Step 1: Write the failing test**

In `render-smoke.js`, inside the `dueBandChecks` IIFE you added in Task 1, append before its closing `})();`:

```js
  // The cell itself. The People drill-down is fed by openIssues, which already
  // drops unstarted-undated by the managers' rule — so every undated row that
  // reaches THIS table is started work with no date, and stays red.
  var bandModel = model({});
  var target = bandModel.people[0];
  target.backlog = {
    n: 3, remHrs: 12, capped: false,
    items: [
      { key: "GTT-1", summary: "Overdue one", status: "In Progress", remHrs: 4,
        due: "2026.W9", epicKey: "GTT-100", epicName: "Rollout" },
      { key: "GTT-2", summary: "Due this week", status: "In Progress", remHrs: 4,
        due: "2026.W31", epicKey: "GTT-100", epicName: "Rollout" },
      { key: "GTT-3", summary: "No date", status: "In Progress", remHrs: 4,
        due: "", epicKey: "GTT-100", epicName: "Rollout" },
    ],
  };
  fresh(bandModel);
  C.getModel().viewerRole = "admin";
  C.setState("view", "actions");
  C.renderAll_();
  C.toggleRosterDetail_(target.name);
  var rowHtml = els.rosterPanel.innerHTML;

  assert_(/sigBad[^>]*>\s*2026\.W9/.test(rowHtml) ||
          /2026\.W9/.test(rowHtml) && /sigBad/.test(rowHtml),
          "a due week before the current week paints red");
  assert_(/sigWarn/.test(rowHtml),
          "a due week that IS the current week paints amber, not red");
  assert_(/sigBad/.test(rowHtml),
          "undated started work keeps the red it had before this change");
  assert_(!/sigGood[^>]*>\s*2026\.W9/.test(rowHtml),
          "W9 must NOT read as future — the single-digit-week trap, at the cell");
```

> `model({})`, `fresh()` and `els` are the harness helpers already defined at the top of `render-smoke.js`. The current week in that fixture comes from `meta.gridWeeks`' entry with `status: "now"` — check the fixture's week list and adjust `"2026.W31"` to whichever ISO it marks `now`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
node render-smoke.js
```

Expected: fails on the amber assertion — no `sigWarn` in the row, because the cell still renders `it.due` raw.

- [ ] **Step 3: Write the implementation**

In `Dashboard.html`, replace line 7363:

```js
          (it.due || '<span class="sigBad">—</span>') + "</td></tr>";
```

with:

```js
          dueCellHtml_(it.due) + "</td></tr>";
```

Then add this helper immediately after `dueBand_` (from Task 1):

```js
/**
 * The Due cell for the People drill-down.
 *
 * `undatedIsGap` is TRUE here and that is not an oversight: this table is fed by
 * openIssues, which already excludes unstarted-undated tickets by the managers'
 * 2026-08-10 rule — so anything undated reaching this cell is STARTED work with
 * no committed date, which BACKLOG_SIGNALS_.undated grades "bad" and which has
 * rendered red since before the bands existed. Grey here would silently
 * downgrade a live signal. The 🗓 PM tab, which DOES show unstarted work, passes
 * false. See spec 2026-08-11 §4.3.
 */
function dueCellHtml_(dueIso) {
  var nowIso = currentIso_();
  if (!dueIso) {
    return '<span class="sigBad" title="Started work with no due date — it can ' +
           'never appear in On-Time Delivery.">—</span>';
  }
  var cls = dueBand_(dueIso, nowIso, true);
  var tip = cls === "sigBad" ? "Overdue — the committed week has ended."
          : cls === "sigWarn" ? "Due this week — still a live commitment."
          : cls === "sigGood" ? "Due in a later week." : "";
  return '<span class="' + cls + '" title="' + esc_(tip) + '">' + esc_(dueIso) + "</span>";
}

/** The CURRENT ISO week, from the payload the model already ships.
    NOT meta.headlineIso — that is the LAST COMPLETED week (Code.js:1106), and
    using it would paint everything due this week red. */
function currentIso_() {
  var gw = (MODEL && MODEL.meta && MODEL.meta.gridWeeks) || [];
  for (var i = 0; i < gw.length; i++) if (gw[i].status === "now") return gw[i].iso;
  return "";
}
```

- [ ] **Step 4: Add the two new helpers to the bridge**

In `render-smoke.js`, extend the bridge line added in Task 1:

```js
             " isoCmp_: isoCmp_, dueBand_: dueBand_," +
             " dueCellHtml_: dueCellHtml_, currentIso_: currentIso_," +
```

- [ ] **Step 5: Run both suites**

```bash
node render-smoke.js && node node-tests.js
```

Expected: both pass; render-smoke count up by 4 from Task 1.

- [ ] **Step 6: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): due-date urgency bands in the People drill-down

Red before this week, amber this week, green later — week precision, because the
managers' rule is that the current week is compliant. Undated stays RED here:
this table is fed by openIssues, which already drops unstarted-undated, so an
undated row is started work with no date. currentIso_ reads meta.gridWeeks
status:\"now\", NOT headlineIso — that is the last COMPLETED week and would have
painted this week red.

Client-only. No schema bump, no cache bust.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**🚢 F1 is now shippable on its own** — deploy `Dashboard.html`, no cache action.

---

# UNIT F2 — 🗓 PM tab

Adds `model.pmOwned`. **Schema 37 → 38**, `bustDeliveryCache_()` required on deploy.

> **Ordering dependency — one direction only.** F1 ships alone happily. F2 does
> **not**: `renderPm_` (Task 9) calls `dueBand_` and `currentIso_`, both added in
> Task 3. Deploy F1 first, or F2's `Dashboard.html` throws on the first render of
> the tab. Working through Tasks 1–10 in order satisfies this automatically.

---

### Task 4: `dhProjectOf_` — issue key → project key

**Files:**
- Modify: `Code.js` — insert immediately after `dhOverdue_` (ends line 2436)
- Test: `node-tests.js`

- [ ] **Step 1: Write the failing test**

In `node-tests.js`, add this function definition after the existing `_test_epicDueAudit_` IIFE:

```js
function _test_pmAttribution_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_pmAttribution_: " + m); }

  // ── dhProjectOf_ ──
  assert_(dhProjectOf_("GTT-605") === "GTT", "plain key");
  assert_(dhProjectOf_("gtt-605") === "GTT", "lowercased key is canonicalised");
  assert_(dhProjectOf_("ABC123-7") === "ABC123", "digits inside a project key survive");
  assert_(dhProjectOf_("GTT-605-2") === "GTT-605", "only the FINAL -N is stripped");
  assert_(dhProjectOf_("") === "", "empty in, empty out");
  assert_(dhProjectOf_(null) === "", "null does not throw");
  assert_(dhProjectOf_("NOTAKEY") === "NOTAKEY",
          "a key with no -N degrades to itself rather than to a blank bucket");

  Logger.log("✅ _test_pmAttribution_ passed");
}
```

Register it by adding to the run list near line 44, after `_test_attrDenominator_();`:

```js
_test_pmAttribution_();
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node node-tests.js
```

Expected: `ReferenceError: dhProjectOf_ is not defined`.

- [ ] **Step 3: Write the implementation**

In `Code.js`, insert immediately after the closing brace of `dhOverdue_`:

```js
// ═══════════════════════════════════════════════════════════════════════════
// PM ATTRIBUTION (spec 2026-08-11)
//
// A ticket reaches a PM through its PROJECT, never through a person. That is
// not a convenience — it is what makes this view possible at all. PMs are
// structurally absent from the delivery population: DH_BY_DISCIPLINE_ maps
// "15|Project Management" to GOVERNOR/PMO, family 15 is not a TRACKING_FAMILY,
// and a live assertion REQUIRES PMO to appear in wf.scope.absentPools. A
// person-grained approach would have to weaken that assertion or invent a
// second roster; a project-grained one needs neither.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Project key for a Jira issue key. "GTT-605" → "GTT".
 *
 * Strips only the FINAL "-<digits>". Not split("-")[0], which would truncate any
 * project key containing a hyphen at its first one and silently merge unrelated
 * projects into a single PM's bucket. A key that does not end in -N is returned
 * unchanged: an unfamiliar shape must land in a visible bucket of its own rather
 * than collapse to "".
 */
function dhProjectOf_(key) {
  var s = String(key == null ? "" : key).trim().toUpperCase();
  return s.replace(/-\d+$/, "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_pmAttribution_ passed`.

- [ ] **Step 5: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(dh): dhProjectOf_ — issue key to project key

Strips only the final -N. split(\"-\")[0] would truncate a hyphenated project key
at its first hyphen and merge unrelated projects into one PM's bucket.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: `pmByProject_` — fold the Tempo rows into a project → PM index

`readTempoGrid_` already parses `key` (the PROJECT key — `Code.js:3449` says so explicitly) beside `pm` on every row. Nothing new is read from the sheet.

**Files:**
- Modify: `Code.js` — after `dhProjectOf_`
- Test: `node-tests.js` — extend `_test_pmAttribution_`

- [ ] **Step 1: Write the failing test**

In `node-tests.js`, inside `_test_pmAttribution_`, insert before the closing `Logger.log`:

```js
  // ── pmByProject_ ──
  var rows = [
    { user: "Ana", key: "GTT", pm: "Dana Reyes", weekHours: { "2026.W30": 8 } },
    { user: "Bo",  key: "GTT", pm: "Dana Reyes", weekHours: { "2026.W31": 8 } },
    { user: "Cy",  key: "ACME", pm: "Sam Ortiz", weekHours: { "2026.W31": 4 } },
    // A blank PM must not create a "" entry — that would collide with the
    // (No PM) bucket and make a tagging gap look like a named owner.
    { user: "Di",  key: "NOPM", pm: "", weekHours: { "2026.W31": 4 } },
  ];
  var idx = pmByProject_(rows);
  assert_(idx.byProject.GTT === "Dana Reyes", "GTT maps to its PM");
  assert_(idx.byProject.ACME === "Sam Ortiz", "ACME maps to its PM");
  assert_(!("NOPM" in idx.byProject), "a blank PM creates no entry");
  assert_(idx.superseded === 0, "no conflicts in the clean case");

  // Multi-PM project: LAST-SEEN WINS (spec §5.1) — the row in the most recent
  // week carrying hours. Deliberately listed oldest-last to prove the rule is
  // reading the WEEK, not the array order.
  var churn = [
    { user: "Ana", key: "GTT", pm: "New Owner", weekHours: { "2026.W33": 8 } },
    { user: "Bo",  key: "GTT", pm: "Old Owner", weekHours: { "2026.W20": 8 } },
  ];
  var c = pmByProject_(churn);
  assert_(c.byProject.GTT === "New Owner",
          "last-seen wins — and by week, not by position in the array");
  assert_(c.superseded === 1, "the overwrite is COUNTED, never silent");

  // Single-digit weeks again: W9 vs W10 must compare numerically here too, or a
  // handover in early spring resolves backwards.
  var spring = [
    { user: "Ana", key: "GTT", pm: "Later Owner", weekHours: { "2026.W10": 8 } },
    { user: "Bo",  key: "GTT", pm: "Earlier Owner", weekHours: { "2026.W9": 8 } },
  ];
  assert_(pmByProject_(spring).byProject.GTT === "Later Owner",
          "W10 is later than W9 — numeric week compare, not lexicographic");

  // Time-off rows never confer ownership (mirrors the acc.pms guard at :5539).
  // NOTE the key: time-off is decided by isTimeOffKey_(row.key) — CONFIG_DH
  // .NONPROJECT_KEYS is ["NETSUITE"] and matches on PREFIX. There is no
  // `row.timeOff` property; asserting on a fabricated one would pass while the
  // production guard did nothing.
  var off = [{ user: "Ana", key: "NETSUITE-PTO", pm: "Dana Reyes",
               weekHours: { "2026.W31": 8 } }];
  assert_(Object.keys(pmByProject_(off).byProject).length === 0,
          "a NETSUITE time-off row confers no project ownership");
  assert_(isTimeOffKey_("NETSUITE-PTO") === true,
          "…and the guard is the shared predicate, not a local re-derivation");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node node-tests.js
```

Expected: `ReferenceError: pmByProject_ is not defined`.

- [ ] **Step 3: Write the implementation**

In `Code.js`, after `dhProjectOf_`:

```js
/**
 * Fold the Tempo rows into a project → PM index.
 *
 * readTempoGrid_ already carries `key` (the PROJECT key) beside `pm` (that
 * project's lead) on every row, so nothing new is read from the sheet.
 *
 * LAST-SEEN WINS on a project that names more than one PM across the 52-week
 * window: the row in the most recent week carrying hours. This view is about
 * now-and-forward ownership, so the current owner is the right answer — but the
 * overwrite is COUNTED and reported (`superseded`), because a handover that
 * resolves silently is indistinguishable from a data error.
 *
 * The week comparison is NUMERIC (see isoWeekBefore_ / spec §4.2). Week keys are
 * unpadded, so a lexicographic max would resolve a W9→W10 handover backwards.
 *
 * Time-off rows never confer ownership, mirroring the acc.pms guard in
 * assembleModel_ — a NETSUITE row carries no project, so it cannot name a lead.
 * The test is isTimeOffKey_(row.key), the SAME predicate eachTempoRow_ uses:
 * there is no `row.timeOff` property on a readTempoGrid_ row, and checking for
 * one would leave the guard permanently disabled.
 *
 * @param {Array<Object>} rows readTempoGrid_ output rows
 * @returns {{byProject: Object<string,string>, superseded: number}}
 */
function pmByProject_(rows) {
  var best = {};       // project → { pm, y, w }
  var superseded = 0;
  (rows || []).forEach(function (row) {
    if (!row || isTimeOffKey_(row.key)) return;
    var proj = String(row.key || "").trim().toUpperCase();
    var pm = String(row.pm || "").trim();
    if (!proj || !pm) return;
    // Most recent week in which this row carries hours. A row with no hours
    // carries no evidence of current ownership.
    var y = -1, w = -1;
    var wh = row.weekHours || {};
    for (var iso in wh) {
      if (!wh[iso]) continue;
      var m = /^(\d{4})\.W(\d{1,2})$/.exec(iso);
      if (!m) continue;
      var yy = +m[1], ww = +m[2];
      if (yy > y || (yy === y && ww > w)) { y = yy; w = ww; }
    }
    if (y === -1) return;
    var cur = best[proj];
    if (!cur) { best[proj] = { pm: pm, y: y, w: w }; return; }
    if (cur.pm === pm) {
      if (y > cur.y || (y === cur.y && w > cur.w)) { cur.y = y; cur.w = w; }
      return;
    }
    if (y > cur.y || (y === cur.y && w > cur.w)) {
      best[proj] = { pm: pm, y: y, w: w };
      superseded++;
    } else {
      superseded++;
    }
  });
  var byProject = {};
  for (var p in best) byProject[p] = best[p].pm;
  return { byProject: byProject, superseded: superseded };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_pmAttribution_ passed`.

- [ ] **Step 5: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(dh): pmByProject_ — project to PM index from the Tempo rows

readTempoGrid_ has carried the project key beside the PM on every row all along.
Last-seen wins on a multi-PM project, compared NUMERICALLY so a W9->W10 handover
does not resolve backwards, and the overwrite is counted rather than silent.
Time-off rows confer no ownership.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `pmOwnedWork_` — the two bars and the windowed item lists

**Files:**
- Modify: `Code.js` — after `pmByProject_`
- Test: `node-tests.js` — extend `_test_pmAttribution_`

**The rule that must not be broken:** neither bar is windowed by the month filter. Windowing bar 1 by due date would make it **structurally 100%** — an undated epic has no date and so cannot fall inside a date window, leaving a denominator of only dated epics. The window scopes the item LISTS.

- [ ] **Step 1: Write the failing test**

In `node-tests.js`, inside `_test_pmAttribution_`, before the closing `Logger.log`:

```js
  // ── pmOwnedWork_ ──
  var today = new Date(2026, 7, 11);           // 2026.W33, AUG 2026
  function iss(o) {
    return { key: o.key, isEpic: !!o.isEpic, due: o.due || null,
             status: o.status || "In Progress", statusCategory: o.cat || "In Progress",
             estSec: o.estSec === undefined ? 3600 : o.estSec,
             linked: o.linked === undefined ? true : o.linked,
             start: o.start === undefined ? new Date(2026, 6, 1) : o.start,
             updated: o.updated || new Date(2026, 7, 10),
             typeLabel: o.isEpic ? "Epic" : "Task", summary: o.key };
  }
  var pmIdx = { GTT: "Dana Reyes", ACME: "Sam Ortiz" };
  var work = pmOwnedWork_({ issues: [
    // Dana's epics: 2 dated, 1 undated → bar 1 = 2/3
    iss({ key: "GTT-1", isEpic: true, due: new Date(2026, 7, 20) }),
    iss({ key: "GTT-2", isEpic: true, due: new Date(2026, 9, 15) }),  // OCT — out of window
    iss({ key: "GTT-3", isEpic: true, due: null }),
    // Dana's non-epics
    iss({ key: "GTT-10", due: new Date(2026, 5, 10) }),               // JUN — overdue carry-in
    iss({ key: "GTT-11", due: new Date(2026, 7, 12) }),               // AUG
    iss({ key: "GTT-12", due: null, estSec: 0, linked: false }),      // undated, not ready
    // Sam's project
    iss({ key: "ACME-1", isEpic: true, due: new Date(2026, 7, 5) }),
    // A project with no PM row at all
    iss({ key: "ORPH-1", isEpic: true, due: null }),
  ] }, pmIdx, today);

  var byPm = {};
  work.rows.forEach(function (r) { byPm[r.pm] = r; });

  var dana = byPm["Dana Reyes"];
  assert_(dana, "Dana has a row");
  assert_(dana.epicN === 3 && dana.epicDated === 2,
          "bar 1 counts ALL open epics Dana owns — 2 of 3 dated");
  assert_(dana.epicMissingKeys.indexOf("GTT-3") !== -1, "the undated epic is named");

  // THE TRAP (spec §5.2). GTT-2 is due in OCTOBER, outside the AUG window. If the
  // window ever reaches the bar, epicN drops to 2 and every PM reports 100% —
  // a bar that can never report the gap it exists to report.
  assert_(dana.epicN === 3,
          "bar 1 is UNWINDOWED — an out-of-window epic stays in the denominator");

  assert_(dana.readyN === 3,
          "bar 2 denominator is all open non-epics Dana owns, also unwindowed");

  // The window scopes the ITEM LISTS: overdue carry-in kept, next months dropped,
  // undated always present.
  var keys = dana.items.map(function (i) { return i.key; });
  assert_(keys.indexOf("GTT-10") !== -1, "JUN overdue carry-in is KEPT in the list");
  assert_(keys.indexOf("GTT-11") !== -1, "due this month is kept");
  assert_(keys.indexOf("GTT-3") !== -1, "undated is ALWAYS shown — it has no month");
  assert_(keys.indexOf("GTT-12") !== -1, "…including undated non-epics");
  assert_(keys.indexOf("GTT-2") === -1, "an OCT due date is out of window and dropped");

  // (No PM) is a named coverage gap, not an empty state, and sorts last.
  var orphan = byPm["(No PM)"];
  assert_(orphan && orphan.epicN === 1, "a project absent from Tempo lands in (No PM)");
  assert_(work.rows[work.rows.length - 1].pm === "(No PM)",
          "(No PM) sorts LAST regardless of size — it is a hygiene bucket, not a PM");

  // Worst-first among real PMs, by undated epic count.
  assert_(work.rows[0].pm === "Dana Reyes", "sorted worst-first by undated epics");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node node-tests.js
```

Expected: `ReferenceError: pmOwnedWork_ is not defined`.

- [ ] **Step 3: Write the implementation**

In `Code.js`, after `pmByProject_`:

```js
/** The sentinel for work whose project has no PM in the Tempo export. Matches
    the client's UNTAGGED_.pm exactly — one string, or the bucket the server
    builds and the bucket the client filters on are two different things. */
var DH_NO_PM_ = "(No PM)";

/**
 * PM-owned work: two bars per PM plus a month-windowed item list.
 *
 * TWO BARS, NEVER AVERAGED (spec §5.2):
 *   OWNS       epicDated / epicN   — open epics carrying a due date. The PM's own
 *                                    field, graded against the team's 100% bar.
 *   IN PROJECT readyN / readyDen   — the `ready` share over open non-epics, using
 *                                    the EXISTING BACKLOG_SIGNALS_ definition
 *                                    (dated AND estimated AND linked AND fresh).
 *                                    Team hygiene, shown as context.
 * A blended score would grade a PM on fields other people fill, and could not
 * say which half is the problem.
 *
 * NEITHER BAR IS WINDOWED, and that is load-bearing. An undated epic has no date
 * and so cannot fall inside a date window; windowing bar 1 would leave a
 * denominator of only dated epics and pin every PM at 100% — a bar that can
 * never report the very gap it exists to report. Bar 2 inherits the same trap
 * through `ready`, which has `dated` as a conjunct. The window scopes `items`.
 *
 * WINDOW (spec §5.3): overdue carry-in + due in the current calendar month.
 * A strict month filter would let a commitment escape by ageing out of its own
 * window — the longer something slips, the less visible it becomes.
 * Undated items are ALWAYS included: they have no month, and they are the point.
 *
 * @param {Object} jira        readJiraRaw_ output (use the leaver-scoped feed)
 * @param {Object} byProject   pmByProject_(…).byProject
 * @param {Date}   today       injectable for tests
 * @returns {{rows:Array, keyCap:number}}
 */
function pmOwnedWork_(jira, byProject, today) {
  var now = today || new Date();
  var monthY = now.getFullYear(), monthM = now.getMonth();
  var weekStart = dhWeekStart_(now);
  var map = {};

  function rowFor(pm) {
    if (!map[pm]) {
      map[pm] = { pm: pm, epicN: 0, epicDated: 0, epicMissingKeys: [], epicCapped: false,
                  readyDen: 0, readyN: 0, items: [] };
    }
    return map[pm];
  }

  // In window = undated (always) OR overdue (before this week's Monday) OR due
  // inside the current calendar month.
  function inWindow(it) {
    if (!dhHasDue_(it)) return true;
    if (it.due < weekStart) return true;
    return it.due.getFullYear() === monthY && it.due.getMonth() === monthM;
  }

  (jira.issues || []).forEach(function (it) {
    if (!typeHygOpen_(it)) return;                 // open work only — same predicate
    var pm = byProject[dhProjectOf_(it.key)] || DH_NO_PM_;
    var r = rowFor(pm);

    if (it.isEpic) {
      r.epicN++;
      if (dhHasDue_(it)) r.epicDated++;
      else if (r.epicMissingKeys.length < EPIC_DUE_MAX_KEYS_) r.epicMissingKeys.push(it.key);
      else r.epicCapped = true;
    } else {
      r.readyDen++;
      if (dhBacklogReady_(it, now)) r.readyN++;
    }

    if (inWindow(it)) {
      r.items.push({
        key: it.key, summary: it.summary || "", isEpic: !!it.isEpic,
        status: it.status || "",
        due: dhHasDue_(it) ? weekKeyFromDate_(it.due) : "",
        overdue: dhOverdue_(it, now),
      });
    }
  });

  var rows = Object.keys(map).map(function (k) { return map[k]; });
  rows.sort(function (a, b) {
    // (No PM) sorts LAST whatever its size: it is a coverage gap with a name,
    // not a person, and ranking it among PMs invites reading it as one.
    var an = a.pm === DH_NO_PM_, bn = b.pm === DH_NO_PM_;
    if (an !== bn) return an ? 1 : -1;
    var am = a.epicN - a.epicDated, bm = b.epicN - b.epicDated;
    return (bm - am) || (b.epicN - a.epicN) || a.pm.localeCompare(b.pm);
  });
  return { rows: rows, keyCap: EPIC_DUE_MAX_KEYS_ };
}

/**
 * The `ready` signal, reused rather than redefined. BACKLOG_SIGNALS_ already
 * holds the org's definition — dated AND estimated AND linked AND fresh — and it
 * is described there as "the share of the backlog that is actually plannable".
 * Reading it out of that table is what stops the PM tab and the backlog panel
 * from drifting into two meanings of one word.
 */
function dhBacklogReady_(it, now) {
  for (var i = 0; i < BACKLOG_SIGNALS_.length; i++) {
    if (BACKLOG_SIGNALS_[i].k === "ready") return !!BACKLOG_SIGNALS_[i].test(it, now);
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_pmAttribution_ passed`.

- [ ] **Step 5: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(dh): pmOwnedWork_ — two unwindowed bars + a windowed item list

OWNS = epic due-date fill (the PM's own field, 100% bar). IN PROJECT = the
existing BACKLOG_SIGNALS_ ready share over non-epics, reused not redefined.
Never averaged: a blend would grade a PM on fields other people fill.

Neither bar is windowed. Windowing bar 1 by due date would pin every PM at 100%,
because an undated epic cannot fall inside a date window. The window scopes the
item list: overdue carry-in kept, undated always shown, later months dropped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Ship `pmOwned` in the model and bump the schema

**Files:**
- Modify: `Code.js:6242` (`DH_SCHEMA_VER_`), `Code.js:5974` area (model return), `Code.js:5583` area (Tempo rows in scope)
- Test: `node-tests.js` (`_test_modelAssembly_`)

- [ ] **Step 1: Write the failing test**

In `node-tests.js`, find `_test_modelAssembly_` and add inside it, before its final `Logger.log`:

```js
  assert_(m.pmOwned && Array.isArray(m.pmOwned.rows),
          "the model ships pmOwned.rows");
  assert_(typeof m.pmOwned.supersededPms === "number",
          "…and the count of superseded PM handovers, so an overwrite is never silent");
  assert_(m.schemaVer === 38, "schema is 38 — a v37 entry has no pmOwned and would render empty");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node node-tests.js
```

Expected: fails on `the model ships pmOwned.rows`.

- [ ] **Step 3: Bump the schema**

In `Code.js`, change line 6242:

```js
var DH_SCHEMA_VER_ = 37;
```

to:

```js
// 38 — `pmOwned` (🗓 PM tab, spec 2026-08-11). A v37 entry has no pmOwned, so
//      the tab would render empty against a stale model rather than rebuild.
var DH_SCHEMA_VER_ = 38;
```

- [ ] **Step 4: Wire it into the model return**

In `Code.js`, find the `epicDueAudit:` property in the `assembleModel_` return (line ~5974) and add immediately after its closing `,`:

```js
    // 🗓 PM-owned work — attributed by PROJECT, so it needs no PM on the roster
    // (PMs are structurally absent from the delivery population by design; see
    // the PM ATTRIBUTION header). Built off the SAME leaver-scoped feed as
    // epicDueAudit_ so the two reconcile: a manager reading 🚩 on Actions and
    // this tab must never see two different counts of the same epics.
    pmOwned: inputs.jira.available
      ? (function () {
          var idx = pmByProject_((inputs.tracked.rows || []).concat(inputs.planned.rows || []));
          var w = pmOwnedWork_(jiraScoped, idx.byProject, win.today || new Date());
          return { rows: w.rows, keyCap: w.keyCap, supersededPms: idx.superseded };
        })()
      : { rows: [], keyCap: EPIC_DUE_MAX_KEYS_, supersededPms: 0 },
```

> **Names verified against the current file** — `inputs.tracked.rows` and `inputs.planned.rows` are what `assembleModel_` already iterates at `Code.js:5556-5557` and passes to `buildWorkforceHealth_` at `:5993`. `jiraScoped` is the leaver-scoped feed defined at `:5707` and used by `epicDueAudit_` at `:5975`; using it here is what makes the two surfaces reconcile. `win.today` is returned by `buildDhWindow_` (`Code.js:1106`) and is the test-injectable clock.

- [ ] **Step 5: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_modelAssembly_` passes and every other suite stays green.

- [ ] **Step 6: Commit**

```bash
git add Code.js node-tests.js
git commit -m "feat(dh): ship pmOwned, schema 37 -> 38

Built off the same leaver-scoped feed as epicDueAudit_ so the 🚩 panel on Actions
and the PM tab can never report two different counts of the same epics.

Deploy MUST bustDeliveryCache_() — a v37 entry has no pmOwned.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Rename the existing filter to "Worked with PM"

The filter row sits ABOVE the tabs (`Dashboard.html:607`), so today's PM dropdown — which means *people who worked on a project this PM leads* — stays on screen on the new tab. Renaming it is what lets "PM" on the tab mean ownership unambiguously. **Label only:** `STATE.pm`, `dimMatch_` and the behaviour are untouched.

**Files:**
- Modify: `Dashboard.html:607`, and the `fillSelect_("pmSel", …)` call at `:1516`
- Test: `render-smoke.js`

- [ ] **Step 1: Write the failing test**

In `render-smoke.js`, inside the `dueBandChecks` IIFE (or a new one below it), add:

```js
  // The two meanings of "PM" must never both read as "PM" on one screen.
  var html607 = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  assert_(/Worked with PM/.test(html607),
          "the people-membership filter is labelled 'Worked with PM', not 'PM'");
  assert_(/STATE\.pm/.test(html607),
          "…and only the LABEL moved — the state key and behaviour are unchanged");
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node render-smoke.js
```

Expected: fails on the `Worked with PM` assertion.

- [ ] **Step 3: Write the implementation**

In `Dashboard.html:607`, change the `<select>`'s default option and title:

```html
    <select id="pmSel" title="Worked with PM — universal: scopes the KPI tiles and the grid. Shows people with planned or tracked hours on any project this PM leads (Tempo PM field); membership-based like Teams. NOT the same as the 🗓 PM tab, which reports the tickets a PM OWNS."><option value="">All PMs</option></select>
```

Find the filter-group label for this control (the `.flbl` span near it) and change its text to `Worked with PM`.

At `Dashboard.html:1516`, change:

```js
  fillSelect_("pmSel", "pm", "All PMs");
```

to:

```js
  fillSelect_("pmSel", "pm", "All — worked with any PM");
```

- [ ] **Step 4: Run both suites**

```bash
node render-smoke.js && node node-tests.js
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "refactor(dh): rename the PM filter to 'Worked with PM'

The filter row sits above the tabs, so the old label would sit on screen beside a
tab where 'PM' means something else entirely — people who worked FOR a PM vs the
tickets a PM OWNS. Label only: STATE.pm and dimMatch_ are untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The 🗓 PM tab

**Files:**
- Modify: `Dashboard.html` — `VIEWS` (`:778`), a new `<div id="viewPm">` pane, `renderAll_`'s dispatch (`:1801`), a new `renderPm_`
- Test: `render-smoke.js`

> 🧭 is already taken by Workforce (`Dashboard.html:789`). Use 🗓.

- [ ] **Step 1: Write the failing test**

In `render-smoke.js`, add a new IIFE before the final `console.log`:

```js
// ── 🗓 PM tab (spec 2026-08-11 §5) ──────────────────────────────────────────
(function pmTabChecks() {
  var pmModel = model({});
  pmModel.pmOwned = {
    keyCap: 200, supersededPms: 1,
    rows: [
      { pm: "Dana Reyes", epicN: 12, epicDated: 9,
        epicMissingKeys: ["GTT-41", "GTT-88", "GTT-91"], epicCapped: false,
        readyDen: 40, readyN: 25,
        items: [{ key: "GTT-41", summary: "Undated epic", isEpic: true,
                  status: "In Progress", due: "", overdue: false }] },
      { pm: "(No PM)", epicN: 4, epicDated: 0, epicMissingKeys: ["ORPH-1"],
        epicCapped: false, readyDen: 2, readyN: 1, items: [] },
    ],
  };
  fresh(pmModel);
  C.getModel().viewerRole = "admin";
  C.setState("view", "pm");
  C.renderAll_();
  var h = els.pmPanel.innerHTML;

  assert_(/Dana Reyes/.test(h), "a PM row renders");
  assert_(/9[^0-9]{0,4}(of|\/)[^0-9]{0,4}12/.test(h) || /75%/.test(h),
          "bar 1 shows epic due-date fill as 9 of 12");
  assert_(/GTT-41/.test(h), "the undated epic keys are named — the fix is one click away");

  // The two bars must never be averaged. 75% and 62.5% blend to ~69%; if that
  // number appears, someone combined the PM's field with the team's hygiene.
  assert_(!/69%/.test(h), "the two bars are NEVER averaged into one number");
  assert_(/hygiene|context|not .{0,12}grade/i.test(h),
          "bar 2 is labelled as team context, not the PM's grade");

  // (No PM) is a named coverage gap and sorts last.
  assert_(/\(No PM\)/.test(h), "(No PM) renders as a named bucket, not an empty state");
  assert_(h.indexOf("Dana Reyes") < h.indexOf("(No PM)"), "(No PM) sorts last");

  // Undated is GREY here — this list contains unstarted work, unlike the People
  // drill-down. The exact inversion of the dueCellHtml_ rule (spec §4.3).
  assert_(!/sigBad[^>]*>\s*—\s*</.test(h),
          "undated on the PM tab is NOT red — unstarted work is not a broken commitment");

  // A handover that resolved silently is indistinguishable from a data error.
  assert_(/1/.test(h) && /supersed|handover|changed PM/i.test(h),
          "a superseded PM handover is reported, not swallowed");

  // Absent ≠ clean, the same rule renderEpicDue_ follows.
  var noPm = model({});
  noPm.pmOwned = null;
  fresh(noPm);
  C.getModel().viewerRole = "admin";
  C.setState("view", "pm");
  C.renderAll_();
  assert_(/Refresh|not in this payload/i.test(els.pmPanel.innerHTML),
          "a payload built before this tab existed says so — absent is not a pass");

  // Role gate is enforced INSIDE switchView_, not just by hiding the button.
  C.getModel().viewerRole = "denied";
  C.switchView_("pm");
  assert_(C.STATE.view !== "pm", "a role without access cannot reach the PM view by id");
})();
```

- [ ] **Step 2: Add the DOM stub id and bridge entry**

In `render-smoke.js`, add `pmPanel` to the `els` map alongside `epicDuePanel`, and extend the bridge:

```js
             " renderPm_: renderPm_," +
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node render-smoke.js
```

Expected: `ReferenceError: renderPm_ is not defined`.

- [ ] **Step 4: Write the implementation**

**4a. Add the view** — in `Dashboard.html`, in `VIEWS` (`:778`), after the `workforce` entry:

```js
  // 🗓 PM — the tickets a PM OWNS, attributed by PROJECT (spec 2026-08-11).
  // Distinct from the "Worked with PM" filter above the tabs, which selects
  // PEOPLE who worked for a PM. Same role tier as Actions and Workforce.
  { id: "pm", label: "🗓 PM", pane: "viewPm", roles: ["admin", "viewer"],
    hint: "Epic due-date fill per PM against the team's 100% bar, with the backlog readiness of their projects alongside it — two claims, never averaged." },
```

**4b. Add the pane** — beside the other `view*` panes:

```html
    <div id="viewPm" class="pane">
      <div class="panel" id="pmPanel"></div>
    </div>
```

**4c. Dispatch** — in `renderAll_` (`:1801`), add a case:

```js
    case "pm": renderPm_(); break;
```

**4d. The renderer** — add near `renderEpicDue_`:

```js
/**
 * 🗓 PM-owned work. Two bars per PM, never averaged (spec §5.2): the epic
 * due-date fill the PM OWNS, and the backlog readiness their project CONTAINS.
 */
function renderPm_() {
  var el = document.getElementById("pmPanel");
  if (!el) return;
  var d = MODEL.pmOwned;
  // Absent ≠ clean — same rule as renderEpicDue_. A payload built before this
  // tab existed must say it did not look.
  if (!d || !d.rows) {
    el.innerHTML = '<h3>🗓 PM-owned work</h3><div class="emptyState">' +
      "Not in this payload — ↻ Refresh to rebuild on the current schema.</div>";
    return;
  }
  if (!d.rows.length) {
    el.innerHTML = '<h3>🗓 PM-owned work</h3><div class="emptyState">' +
      "No open work in the current export.</div>";
    return;
  }
  var nowIso = currentIso_();
  var rows = d.rows.map(function (r) {
    var missing = r.epicN - r.epicDated;
    var ownPct = r.epicN ? Math.round(r.epicDated / r.epicN * 100) : null;
    var readyPct = r.readyDen ? Math.round(r.readyN / r.readyDen * 100) : null;
    var ownCls = missing === 0 ? "sigGood" : "sigBad";
    var items = (r.items || []).map(function (it) {
      // undatedIsGap = FALSE here: this list contains UNSTARTED work, which is
      // not a commitment yet. The People drill-down passes true because
      // openIssues has already dropped unstarted-undated. Spec §4.3 — the
      // inconsistency is the decision, not a bug.
      var cls = dueBand_(it.due, nowIso, false);
      var due = it.due
        ? '<span class="' + cls + '">' + esc_(it.due) + "</span>"
        : '<span class="cellSub" title="No due date — not a commitment yet.">—</span>';
      return "<tr><td>" + esc_(it.key) + "</td><td>" + esc_(it.summary) +
             "</td><td>" + esc_(it.status) + "</td><td>" + due + "</td></tr>";
    }).join("");
    return '<div class="pmRow">' +
      "<h4>" + esc_(r.pm) + "</h4>" +
      '<p class="cellSub"><b>Owns — epic due dates:</b> ' +
        '<b class="' + ownCls + '">' + r.epicDated + " of " + r.epicN + "</b>" +
        (ownPct === null ? "" : " (" + ownPct + "%)") +
        " · the team's bar is 100%" +
        (missing ? " — " + keyListHtml_(r.epicMissingKeys, r.epicCapped, d.keyCap) : "") +
      "</p>" +
      '<p class="cellSub"><b>In project — task readiness:</b> ' +
        (readyPct === null ? "no open tasks" : readyPct + "% of " + r.readyDen) +
        ' <span class="cellSub">(dated, estimated, linked and fresh — <b>team hygiene, ' +
        "shown as context, not this PM's grade</b>)</span></p>" +
      (items ? '<div class="gwrap"><table class="hyg"><thead><tr><th>Key</th>' +
               "<th>Summary</th><th>Status</th><th>Due</th></tr></thead><tbody>" +
               items + "</tbody></table></div>" : "") +
      "</div>";
  }).join("");

  el.innerHTML =
    "<h3>🗓 PM-owned work" + scopeTag_("org") + "</h3>" +
    '<p class="cellSub">Work is attributed to a PM by its <b>project</b>, from the Tempo PM ' +
      "field — not by who it is assigned to. A project with no hours in the Tempo export has " +
      "no PM, and its work is listed under <b>(No PM)</b>: a coverage gap with a name, not an " +
      "empty state. The two bars are <b>never averaged</b> — the first is the PM's own field, " +
      "the second is what their project contains." +
      (d.supersededPms
        ? " <b>" + d.supersededPms + "</b> project" + (d.supersededPms === 1 ? " has" : "s have") +
          " changed PM in the export window; the most recent owner is shown."
        : "") +
    "</p>" +
    '<p class="cellSub">The lists below cover work <b>overdue or due this month</b>, plus ' +
      "everything undated — an undated item has no month, so it cannot be windowed. " +
      "<b>The bars are not windowed at all</b>: they measure every open item the PM owns.</p>" +
    rows;
}
```

**4e. Minimal CSS** — beside the other panel rules:

```css
.pmRow{padding:10px 0;border-top:1px solid var(--border)}
.pmRow:first-of-type{border-top:0}
.pmRow h4{margin:0 0 4px;font-family:'Roboto Condensed','Franklin Gothic Medium Cond',sans-serif}
```

- [ ] **Step 5: Run both suites**

```bash
node render-smoke.js && node node-tests.js
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add Dashboard.html render-smoke.js
git commit -m "feat(dh): 🗓 PM tab — owned vs contained, never averaged

Two bars per PM: the epic due-date fill they own against the team's 100% bar, and
the backlog readiness their project contains, labelled as team context. Undated
is GREY here — this list shows unstarted work, unlike the People drill-down where
openIssues has already dropped it. 🧭 was taken by Workforce, so 🗓.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Docs and the deploy note

**Files:**
- Modify: `README.md`, `COMPONENTS.md`

- [ ] **Step 1: Add the schema history row**

In `README.md`, find the `DH_SCHEMA_VER_` history table and append:

```markdown
| 38 | 2026-08-11 | `pmOwned` — 🗓 PM tab. Work attributed by project key → Tempo PM. A v37 entry has no `pmOwned` and the tab renders empty. |
```

- [ ] **Step 2: Add the metric caveat**

In `README.md`, under **"Metric caveats (read before quoting a number)"**:

```markdown
- **🗓 PM tab — attribution is by PROJECT, not by assignee.** A ticket belongs to
  the PM of its Jira project, taken from the Tempo PM field. A project with no
  hours in the Tempo export has no PM row, and its work lands in **(No PM)** —
  that bucket is a coverage gap, not a tidy-up. Where a project changed PM inside
  the export window the **most recent** owner is shown and the count of such
  handovers is stated on the tab.
- **The two PM bars are different claims and must not be combined.** Epic
  due-date fill is the PM's own field; task readiness is what their project
  contains, filled by other people. Neither bar is windowed by the month filter —
  windowing the first would pin every PM at 100%, because an undated epic cannot
  fall inside a date window.
- **"Worked with PM" (the filter) ≠ "🗓 PM" (the tab).** The filter selects
  PEOPLE who logged or planned hours on a PM's projects; the tab reports the
  TICKETS a PM owns.
```

- [ ] **Step 3: Add the deploy order**

In `README.md`, in the deploy section:

```markdown
### Deploying the 🗓 PM tab (schema 38)

1. Paste `Code.js`, then `Dashboard.html`. (Three files go to GAS — never the
   two `node-*.js` / `render-smoke.js` test files.)
2. Run `bustDeliveryCache_()`. **Required** — a cached v37 model has no
   `pmOwned`, and the tab renders empty until the entry expires.
3. Open the tab and check the size of the **(No PM)** bucket. If it dominates,
   that is a finding about Tempo project coverage to take upstream — not a
   reason to change the attribution.

No exporter change and no re-run: every column read here is already exported and
already parsed.

The **due-date bands** ship independently — `Dashboard.html` only, no schema
bump, no cache action.
```

- [ ] **Step 4: Document the components**

In `COMPONENTS.md`, add:

```markdown
### 🗓 PM tab

**What it is.** Epic due-date fill per PM, with the backlog readiness of their
projects beside it. Two bars, never averaged.

**How far to trust it.** The OWNS bar is as complete as the Jira epic feed and is
graded against a bar the team set at 100%, so it is quotable. The IN PROJECT bar
reuses `BACKLOG_SIGNALS_.ready` and inherits every caveat that carries. The
attribution is only as good as the Tempo PM field: check the `(No PM)` bucket
before quoting any per-PM number, and remember PMs are otherwise absent from this
dashboard's population entirely — nothing here rolls into a published delivery rate.
```

- [ ] **Step 5: Run both suites and commit**

```bash
node node-tests.js && node render-smoke.js
git add README.md COMPONENTS.md
git commit -m "docs(dh): schema 38, PM tab caveats and deploy order

Records the two caveats most likely to be misread: attribution is by project not
assignee, and the two bars are different claims that must not be combined.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria

- [ ] `node node-tests.js` passes, including `_test_pmAttribution_` and `_test_dueBandParity_`
- [ ] `node render-smoke.js` passes with the new band and PM-tab checks
- [ ] `git status` shows no unintended files staged
- [ ] `DH_SCHEMA_VER_` is 38
- [ ] Nothing was pushed

## Deploy summary for the user

| Unit | Files to paste | Cache action |
|---|---|---|
| Due bands | `Dashboard.html` | none |
| 🗓 PM tab | `Code.js` + `Dashboard.html` | `bustDeliveryCache_()` **required** |
