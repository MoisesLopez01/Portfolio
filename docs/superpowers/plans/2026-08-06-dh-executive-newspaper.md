# Delivery Health — Executive Tab Newspaper Restructure: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Delivery Health dashboard's Executive tab as a newspaper — masthead verdict, then an ORG backlog hero, evidence gates, flow and capacity bands, a metric × dimension grid, a data-driven "not measured" shelf and computed trust detail — and make the 1,839 unowned open issues visible and drillable for the first time.

**Architecture:** Three layers, deployed in a strict order. The **exporter** (`Jira Backlog.js` v3.11.0) drops `'assignee is not EMPTY'` from the open-backlog fetch and adds one weekly-tally tab plus two snapshot columns. The **server** (`Code.js`, schema 25→26) gains five pure functions and three registry entries; every one is unit-testable under Node without GAS. The **client** (`Dashboard.html`) replaces the Executive pane's render pipeline. Tasks 1–7 are server-only and safe to land before the exporter changes; Task 1 (`attrN`) must land first because it prevents approach B from reporting a false roster-join failure.

**Tech Stack:** Google Apps Script (ES5 — `var`, no arrow functions, no template literals in `Code.js`/`Dashboard.html`), Google Sheets as the data store, Jira Cloud REST `/rest/api/3/search/jql`, inline SVG for all charts (no CDN — a blocked request inside the HtmlService iframe means an empty executive page), Node for the local test runners.

**Spec:** [`docs/superpowers/specs/2026-08-06-dh-executive-newspaper-design.md`](../specs/2026-08-06-dh-executive-newspaper-design.md)

---

## Before you start

**Read the spec.** This plan implements it and does not restate its reasoning. In particular read §4.6 (what approach B moves and the one thing it must not) before touching Task 1 or Task 10.

**ES5 only.** `Code.js` and `Dashboard.html` are pasted into a GAS project. No `let`/`const`, no arrow functions, no template literals, no `Array.prototype.includes`, no optional chaining. `node-tests.js` and `render-smoke.js` are local-only and may use modern syntax, but match the existing style.

**Working directory** for all test commands:

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard"
```

**Baseline — verify this before your first commit.** Both suites must be green at the start:

```bash
node node-tests.js   # → "✅ node-tests: all suites passed"
node render-smoke.js # → "✅ render-smoke: 648 checks passed"
```

If `render-smoke.js` does not report 648, the tree is not clean — stop and find out why before changing anything.

**Never `git push`.** This repo stays local. Commit freely; push never, unless the user asks in the moment.

**Do not deploy anything until Task 19.** Editing files does not deploy them; the GAS project is updated by pasting. Task 19 is the only task that touches the live app.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `docs/superpowers/delivery-health-dashboard/Code.js` | GAS server. Gains `attrN` on the by-type buckets, `parseArrivalRows_`/`readArrivals_`, `clearRateMedian_`, `queueSnapshot_`, `inventoryWalkback_`, `sampleFloorFor_`, three registry entries, schema bump, payload wiring | 1, 2, 3, 4, 5, 6, 7 |
| `D:/Contribution/Jira Backlog.js` | Jira exporter, v3.11.0. Drops the open-backlog assignee clause; writes the `Jira Arrivals` tab and two `Flow Snapshots` columns | 8, 9, 10 |
| `docs/superpowers/delivery-health-dashboard/Dashboard.html` | Client. `attr` gains `denom: "attrN"`; the Executive pane's eight bands replace the current tile/compare/pulse/trust pipeline | 1, 11, 12, 13, 14, 15, 16 |
| `docs/superpowers/delivery-health-dashboard/node-tests.js` | Local Node runner. Registers each new `_test_*` | 1–7 |
| `docs/superpowers/delivery-health-dashboard/render-smoke.js` | Renders the client against synthetic models and asserts on HTML. New checks, plus rewriting those pinned to the old Executive markup | 11–17 |
| `docs/superpowers/delivery-health-dashboard/README.md` | The "numbers moved because the population widened" note | 18 |

**Why the server functions are separate and pure:** each is called from `assembleModel_` but takes its inputs as arguments and returns a plain object. That is what lets `node-tests.js` exercise them without stubbing `SpreadsheetApp`. Follow that shape — do not read a sheet inside a computation function.

---

## Task 1: `attrN` — give the roster-join check its own denominator (D12)

This gates approach B. Today `attr` divides by every record, so an **absent** assignee scores as a **failed** roster join. Harmless while unassigned rows are absent from the feed; under Task 10 it would drop Roster join from 100% to ~44%, un-retire a solved check on three surfaces, and report something untrue.

The client already has the mechanism — `TYPE_FIELDS_`'s `denom` key, used by the Logged column (`denom: "timeN"`) and resolved by `typeFieldN_`. This task adds the server-side counter and points `attr` at it.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js:1597-1680` (`typeHygieneBuckets_`)
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html:5074-5075` (`TYPE_FIELDS_` `attr` entry)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js` (register the test)
- Test: new `_test_attrDenominator_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js`, immediately after `_test_gateOverrides_` (search for `function _test_gateOverrides_` and place this after its closing brace):

```js
/**
 * attr (roster join) must divide by records that HAVE an assignee, not by every
 * record. An unassigned issue has no assignee to fail to join — that gap is what
 * the `assigned` column measures. Scoring it as a join failure is how adding
 * unassigned rows to the feed (Jira Backlog.js v3.11.0) would un-retire a solved
 * check and report ~44% where the truth is 100%.
 */
function _test_attrDenominator_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_attrDenominator_: " + m); }
  var who = function (raw) {
    var n = String(raw || "").toLowerCase().trim();
    return n === "maria" ? "Maria" : null;   // "ghost" and the sentinel resolve to nobody
  };
  var issues = [
    // open, assigned, resolves → attrN 1, attr 1
    { key: "A-1", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "maria", estSec: 3600, spentSec: 0, due: new Date() },
    // open, UNASSIGNED sentinel → in NEITHER half of attr
    { key: "A-2", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "⚠️ UNASSIGNED", estSec: 0, spentSec: 0, due: null },
    // open, assigned but does NOT resolve → attrN 1, attr 0 (a real join failure)
    { key: "A-3", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "ghost", estSec: 0, spentSec: 0, due: null },
  ];
  var r = typeHygieneBuckets_({ issues: issues }, who, "delivery");
  var row = r.open[0];
  assert_(row, "one open row for the Story type");
  assert_(row.n === 3, "n counts every record — got " + row.n);
  assert_(row.attrN === 2, "attrN counts only records WITH an assignee — got " + row.attrN);
  assert_(row.attr === 1, "attr counts records whose assignee resolves — got " + row.attr);
  assert_(row.assigned === 1, "assigned still counts records with an assignee at all — got " + row.assigned);

  // The regression this exists to prevent: an all-unassigned population must not
  // read as 0% roster join. attrN 0 means "nothing to grade", never "all failed".
  var allBlank = typeHygieneBuckets_({ issues: [issues[1]] }, who, "delivery");
  assert_(allBlank.open[0].attrN === 0, "all-unassigned → attrN 0");
  assert_(allBlank.open[0].attr === 0, "all-unassigned → attr 0 (over a 0 denominator)");

  // And a missing key in the queue: an unassigned record is not an attr miss, so
  // it must not appear in the attr work queue.
  assert_(!(row.keys.attr || []).length || (row.keys.attr || []).indexOf("A-2") === -1,
          "the unassigned record must not be queued as an attr gap");
  assert_((row.keys.attr || []).indexOf("A-3") !== -1,
          "the genuine join failure IS queued as an attr gap");
  Logger.log("✅ _test_attrDenominator_ passed");
}
```

- [ ] **Step 2: Register it in the Node runner**

In `node-tests.js`, find the line calling `_test_gateOverrides_();` and add immediately after it:

```js
_test_attrDenominator_();
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `❌ _test_attrDenominator_: attrN counts only records WITH an assignee — got undefined`

- [ ] **Step 4: Add `attrN` to the row shape**

In `Code.js`, inside `typeHygieneBuckets_`'s `row()` initialiser (around line 1610), find:

```js
                 n: 0, due: 0, assigned: 0, attr: 0, est: 0, time: 0, region: 0, team: 0,
```

Replace with:

```js
                 n: 0, due: 0, assigned: 0, attr: 0, est: 0, time: 0, region: 0, team: 0,
                 // `attrN` — attr's OWN denominator, exactly like timeN below.
                 // A record with no assignee has no assignee to fail to join: it
                 // belongs in neither half. Dividing attr by n instead scores an
                 // ABSENT assignee as a FAILED roster join, which is a different
                 // fact and one the `assigned` column already reports. That
                 // conflation is harmless only while unassigned rows are absent
                 // from Jira Raw; once they are exported it drops a solved,
                 // retired check to ~44% and puts a false failure on three
                 // surfaces at once (spec §4.6, D12).
                 attrN: 0,
```

- [ ] **Step 5: Count and gate `attr` on it**

Still in `typeHygieneBuckets_`, in `tally()`, find:

```js
    var wantTime = timeExpected_(it, isOpen);
    if (wantTime) r.timeN++;
    TYPE_HYG_FIELDS_.forEach(function (f) {
      if (f === "time" && !wantTime) return;
```

Replace with:

```js
    var wantTime = timeExpected_(it, isOpen);
    if (wantTime) r.timeN++;
    // attr is only ANSWERABLE where an assignee exists — same tristate shape as
    // timeN above: measure what you can grade, grade what you measured.
    if (hasAssignee) r.attrN++;
    TYPE_HYG_FIELDS_.forEach(function (f) {
      if (f === "time" && !wantTime) return;
      if (f === "attr" && !hasAssignee) return;
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_attrDenominator_ passed`, then `✅ node-tests: all suites passed`

- [ ] **Step 7: Point the client column at the new denominator**

In `Dashboard.html`, find the `TYPE_FIELDS_` `attr` entry (around line 5074):

```js
  { k: "attr",     label: "→ roster",   gate: 0.95,
    feeds: "all four cards", needs: null, retireWhenFull: true },
```

Replace with:

```js
  // `denom: "attrN"` — graded over records that HAVE an assignee only. Without
  // it, an unassigned record reads as a roster-join failure, which un-retires
  // this column the moment unassigned work enters the export (spec §4.6, D12).
  { k: "attr",     label: "→ roster",   gate: 0.95, denom: "attrN",
    feeds: "all four cards", needs: null, retireWhenFull: true },
```

No change to `typeFieldN_` is needed — it already resolves `f.denom` and falls back to `row.n` when the key is absent, so a stale cached payload without `attrN` still renders.

- [ ] **Step 8: Verify the client suite is still green**

```bash
node render-smoke.js
```

Expected: `✅ render-smoke: 648 checks passed`

- [ ] **Step 9: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "fix(dh): attr gets its own attrN denominator — absent assignee is not a failed join

attr divided by every record, so an unassigned issue scored as a roster-join
failure. The \`assigned\` column already measures the absent-assignee gap; attr
is only answerable where an assignee exists. Same tristate idiom as timeN.

Correct independently, and required before Jira Backlog.js v3.11.0 exports
unassigned open work: without it, Roster join drops 100% -> ~44%, un-retires a
solved check on the gaps queue, the trust strip and the by-type matrix at once,
and reports a failure that is not real.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `parseArrivalRows_` and `readArrivals_`

The `Jira Arrivals` tab is a weekly tally: one row per ISO week with created/resolved counts. The parser mirrors `parseBugRows_` — columns **by name**, a missing column yields `null` rather than `0`, and the week key is computed **here** from the `Week Start` date, never read as a label from the sheet (spec §4.1: the exporter pads `W07`, the dashboard does not).

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (add after `readJiraBugs_`, ~line 2870)
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`CONFIG_DH` sheet name)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`
- Test: new `_test_arrivalParse_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js` after `_test_bugFeed_`:

```js
/**
 * Jira Arrivals parse. Three rules, each a bug that has bitten this codebase:
 *  · columns BY NAME, so a column order change upstream cannot silently shift data;
 *  · a MISSING column yields null, never 0 — "nobody measured" and "measured zero"
 *    are different facts, and conflating them is how a feed outage reads as good news;
 *  · the ISO week key is computed HERE from Week Start. weekKeyFromDate_ emits
 *    "2026.W7"; the exporter's jb_isoWeekLabel_ emits "2026.W07". A label written
 *    upstream would fail to join for weeks 1-9 (spec §4.1).
 */
function _test_arrivalParse_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_arrivalParse_: " + m); }

  // Deliberately NOT in the order the exporter writes them.
  var values = [
    ["Resolved", "Week Start", "Created Unassigned", "Created"],
    [204, new Date("2026-07-27T00:00:00Z"), 90, 224],
    [297, new Date("2026-07-20T00:00:00Z"), 71, 250],
    ["", "", "", ""],                                  // trailing blank row
  ];
  var r = parseArrivalRows_(values);
  assert_(r.available === true, "available on a well-formed tab");
  assert_(r.weeks.length === 2, "blank rows skipped — got " + r.weeks.length);
  var w31 = r.weeks[0];
  assert_(w31.iso === "2026.W31", "week key computed from Week Start — got " + w31.iso);
  assert_(w31.created === 224 && w31.resolved === 204, "counts read by NAME, not position");
  assert_(w31.createdUnassigned === 90, "createdUnassigned read");

  // Missing optional column → null, not 0.
  var noUnassigned = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    [new Date("2026-07-27T00:00:00Z"), 224, 204],
  ]);
  assert_(noUnassigned.weeks[0].createdUnassigned === null,
          "absent column → null, never 0 — got " + noUnassigned.weeks[0].createdUnassigned);

  // An unusable Week Start is skipped, not crashed on and not bucketed to epoch.
  var junk = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    ["not a date", 5, 5],
    [new Date("2026-07-27T00:00:00Z"), 224, 204],
  ]);
  assert_(junk.weeks.length === 1, "unparseable Week Start skipped — got " + junk.weeks.length);

  // No tab / empty tab is a clean unavailable, not an exception.
  assert_(parseArrivalRows_([]).available === false, "empty values → unavailable");
  assert_(parseArrivalRows_([["Week Start", "Created", "Resolved"]]).available === false,
          "header-only → unavailable");
  Logger.log("✅ _test_arrivalParse_ passed");
}
```

- [ ] **Step 2: Register it**

In `node-tests.js`, after `_test_bugFeed_();`, add:

```js
_test_arrivalParse_();
```

- [ ] **Step 3: Run to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `ReferenceError: parseArrivalRows_ is not defined`

- [ ] **Step 4: Add the config entry**

In `Code.js`'s `CONFIG_DH`, find:

```js
  FLOW_SNAP_SHEET:   "Flow Snapshots",
```

Add immediately after:

```js
  ARRIVALS_SHEET:    "Jira Arrivals",   // weekly created/resolved tally (Jira Backlog.js v3.11.0)
```

- [ ] **Step 5: Write the parser and reader**

In `Code.js`, immediately after `readJiraBugs_`'s closing brace, add:

```js
/**
 * Pure parse of the Jira Arrivals tab (Jira Backlog.js v3.11.0). Columns BY NAME.
 *
 * One row per ISO week, org-wide: no assignee join anywhere in this feed. That is
 * the point of it — person-keyed arrivals under-report the newest weeks, because
 * an issue filed unassigned on Monday only counts once somebody picks it up, so a
 * growing queue can read as flat exactly when it matters most. Same reasoning as
 * parseBugRows_'s deliberate refusal to join bugs to a person.
 *
 * The ISO key is derived from Week Start HERE. The exporter's jb_isoWeekLabel_
 * zero-pads ("2026.W07") and weekKeyFromDate_ does not ("2026.W7"); shipping a
 * date keeps ONE week-label authority and makes the divergence unreachable.
 *
 * @param {Array<Array>} values raw getValues() including the header row
 * @returns {{weeks:Array<{iso,created,resolved,createdUnassigned}>, available:boolean}}
 */
function parseArrivalRows_(values) {
  if (!values || values.length < 2) return { weeks: [], available: false };
  var h = values[0];
  var iWeek = colIdx_(h, ["Week Start"]);
  var iCreated = colIdx_(h, ["Created"]);
  var iResolved = colIdx_(h, ["Resolved"]);
  var iUnassigned = colIdx_(h, ["Created Unassigned"]);
  if (iWeek === -1 || iCreated === -1 || iResolved === -1) {
    return { weeks: [], available: false };
  }
  var weeks = [];
  for (var r = 1; r < values.length; r++) {
    var d = parseDhDate_(values[r][iWeek]);
    if (!d || isNaN(d.getTime())) continue;   // blank or unparseable row: skip, never bucket to epoch
    weeks.push({
      iso: weekKeyFromDate_(d),
      created: Number(values[r][iCreated]) || 0,
      resolved: Number(values[r][iResolved]) || 0,
      // TRISTATE: an ABSENT column means nobody measured it. Collapsing that to 0
      // would report "no unowned intake" on an older export, which is good news
      // the data does not support.
      createdUnassigned: iUnassigned === -1
        ? null
        : (Number(values[r][iUnassigned]) || 0),
    });
  }
  return { weeks: weeks, available: weeks.length > 0 };
}

/** Reads the Jira Arrivals tab. Absent tab is a clean unavailable, not an error:
    Code.js may legitimately be deployed before the export has run (spec §5). */
function readArrivals_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().source);
    var sh = ss.getSheetByName(CONFIG_DH.ARRIVALS_SHEET);
    if (!sh) return { weeks: [], available: false };
    return parseArrivalRows_(sh.getDataRange().getValues());
  } catch (e) {
    Logger.log("⚠️ readArrivals_ failed: " + e.message);
    return { weeks: [], available: false };
  }
}
```

- [ ] **Step 6: Run to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_arrivalParse_ passed`, then `✅ node-tests: all suites passed`

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "feat(dh): parseArrivalRows_/readArrivals_ — org-wide weekly created/resolved feed

Columns by name; absent column -> null not 0; ISO key computed from Week Start
so the exporter's zero-padded W07 can never fail to join against W7.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `clearRateMedian_` — the trailing basis for weeks-to-clear

The headline divides by the **median of the last 8 complete weeks**, not last week. W31 resolved 204 against an eight-week mean of 297; a one-week denominator put a five-week error in the headline (spec §1.1). Under 5 weeks of history it returns `null` — the same refusal-to-publish rule `standardRate_` already applies, not a second one.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (add after `medianOf_`, ~line 1948)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`
- Test: new `_test_clearRateMedian_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js` after `_test_arrivalParse_`:

```js
/**
 * The median basis exists so one holiday week cannot move the headline. W31
 * resolved 204 against an eight-week mean of 297 — on a one-week denominator
 * weeks-to-clear read 16.1w against 11.0w on the trailing basis (spec §1.1).
 */
function _test_clearRateMedian_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_clearRateMedian_: " + m); }

  var steady = [300, 290, 310, 295, 305, 300, 298, 302];
  assert_(clearRateMedian_(steady, 8) === 300,
          "median of a steady series — got " + clearRateMedian_(steady, 8));

  // One holiday week at a third of normal must barely move it.
  var holiday = [300, 290, 310, 295, 305, 300, 298, 100];
  var m = clearRateMedian_(holiday, 8);
  assert_(m >= 295 && m <= 300, "one bad week cannot move the median — got " + m);

  // Refuses to publish under 5 weeks, and says nothing rather than guessing.
  assert_(clearRateMedian_([300, 290, 310, 295], 8) === null,
          "4 weeks → null");
  assert_(clearRateMedian_([300, 290, 310, 295, 305], 8) === 300,
          "5 weeks is enough — got " + clearRateMedian_([300, 290, 310, 295, 305], 8));
  assert_(clearRateMedian_([], 8) === null, "empty → null");
  assert_(clearRateMedian_(null, 8) === null, "null input → null");

  // Only the LAST n weeks count: an old spike outside the window is ignored.
  var withOldSpike = [9999, 9999, 9999, 300, 290, 310, 295, 305, 300, 298, 302, 300];
  assert_(clearRateMedian_(withOldSpike, 8) === 300,
          "window respected — got " + clearRateMedian_(withOldSpike, 8));

  // A zero week is DATA (a shutdown), not a gap: it counts.
  assert_(clearRateMedian_([0, 0, 0, 0, 0, 0], 8) === 0, "all-zero series → 0, not null");
  // A null week is a GAP and is dropped before the median.
  var withGap = [300, null, 310, 295, 305, 300];
  assert_(clearRateMedian_(withGap, 8) === 300,
          "null weeks dropped, not treated as 0 — got " + clearRateMedian_(withGap, 8));
  Logger.log("✅ _test_clearRateMedian_ passed");
}
```

- [ ] **Step 2: Register it**

In `node-tests.js`, after `_test_arrivalParse_();`:

```js
_test_clearRateMedian_();
```

- [ ] **Step 3: Run to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `ReferenceError: clearRateMedian_ is not defined`

- [ ] **Step 4: Add the constant and the function**

In `Code.js`'s `CONFIG_DH`, after the `ARRIVALS_SHEET` line from Task 2, add:

```js
  CLEAR_RATE_WEEKS:  8,   // trailing window for the weeks-to-clear denominator
  CLEAR_RATE_MIN_N:  5,   // below this it publishes nothing — same bar as STD_MIN_PERIODS
```

Then, immediately after `medianOf_`'s closing brace, add:

```js
/**
 * Median weekly clearing rate over the last `weeks` complete weeks.
 *
 * A MEDIAN, not a mean, and trailing rather than last-week: this is the
 * denominator of the Executive tab's headline, and a single holiday week in it
 * inflates weeks-to-clear by roughly the size of the holiday. Measured on the
 * live feed 2026-08-06: W31 resolved 204 against an eight-week mean of 297, so
 * a one-week basis read 16.1 weeks where the trailing basis read 11.0.
 *
 * Same median-and-MAD reasoning standardRate_ applies to every operating norm
 * here, and the same refusal to publish below a minimum — reusing that bar
 * rather than inventing a second one.
 *
 * @param {Array<number|null>} series weekly resolved counts, oldest first
 * @param {number} weeks trailing window size
 * @returns {number|null} null when fewer than CLEAR_RATE_MIN_N usable weeks
 */
function clearRateMedian_(series, weeks) {
  if (!series || !series.length) return null;
  var n = weeks || CONFIG_DH.CLEAR_RATE_WEEKS;
  var win = series.slice(Math.max(0, series.length - n));
  // A null week is a GAP (no export ran) and is dropped. A zero week is DATA
  // (a shutdown) and counts — treating the two alike would let a broken feed
  // masquerade as a quiet fortnight.
  var vals = win.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
  if (vals.length < (CONFIG_DH.CLEAR_RATE_MIN_N || 5)) return null;
  return medianOf_(vals);
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_clearRateMedian_ passed`

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "feat(dh): clearRateMedian_ — 8-week trailing median clearing rate

Median not mean, trailing not last-week: on the live feed W31 cleared 204
against an 8-week mean of 297, so a one-week denominator read 16.1 weeks where
the trailing basis reads 11.0. Null weeks are gaps and drop out; zero weeks are
data and count. Returns null under 5 usable weeks rather than inventing a rate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `queueSnapshot_` — the two halves of the queue, never summed

The hero is ORG (assigned + unassigned). The sub-row is the filterable assigned half. This function returns both **separately** so no caller can accidentally add a filtered number to an unfiltered one. `flowOpenBuckets_` keeps its `/unassigned/i` guard — that guard is load-bearing, not vestigial, because the assigned sub-row must stay assigned-only.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (add after `flowOpenBuckets_`, ~line 1278)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`
- Test: new `_test_unassignedInventory_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js` after `_test_clearRateMedian_`:

```js
/**
 * The assigned and unassigned halves must be DISJOINT and never pre-summed.
 * Disjoint because flowOpenBuckets_ keeps its unassigned guard, so the same
 * record cannot land in both; never pre-summed because one half is filterable
 * and the other is org-wide, and a caller adding them would produce a number
 * belonging to neither population (spec §3 §2).
 */
function _test_unassignedInventory_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_unassignedInventory_: " + m); }
  var who = function (raw) {
    return String(raw || "").toLowerCase().trim() === "maria" ? "Maria" : null;
  };
  var issues = [
    // assigned + open + To Do → the assigned half
    { key: "Q-1", isEpic: false, resolved: null, assignee: "maria", status: "Open",
      statusCategory: "To Do", estSec: 7200, spentSec: 0 },
    // assigned + open + In Progress → assigned WIP
    { key: "Q-2", isEpic: false, resolved: null, assignee: "maria", status: "In Progress",
      statusCategory: "In Progress", estSec: 3600, spentSec: 1800 },
    // UNASSIGNED + open → the unassigned half only
    { key: "Q-3", isEpic: false, resolved: null, assignee: "⚠️ UNASSIGNED", status: "Open",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    { key: "Q-4", isEpic: false, resolved: null, assignee: "", status: "Open",
      statusCategory: "To Do", estSec: 1800, spentSec: 0 },
    // RESOLVED → neither half; an inventory is open work only
    { key: "Q-5", isEpic: false, resolved: new Date("2026-07-28"), assignee: "⚠️ UNASSIGNED",
      status: "Done", statusCategory: "Done", estSec: 3600, spentSec: 3600 },
    // EPIC → neither half; epics roll up their children (same rule as flowOpenBuckets_)
    { key: "Q-6", isEpic: true, resolved: null, assignee: "⚠️ UNASSIGNED", status: "Open",
      statusCategory: "To Do", estSec: 36000, spentSec: 0 },
  ];
  var s = queueSnapshot_(issues, who);

  assert_(s.assigned.items === 2, "assigned half = 2 (Q-1 To Do + Q-2 WIP) — got " + s.assigned.items);
  assert_(s.assigned.wipN === 1 && s.assigned.todoN === 1, "assigned split into WIP and To Do");
  assert_(s.unassigned.items === 2, "unassigned half = 2 (Q-3, Q-4) — got " + s.unassigned.items);
  assert_(s.unassigned.hrs === 1.5, "unassigned remaining hours summed — got " + s.unassigned.hrs);

  // No pre-summed total on the object: the caller must ask for it explicitly.
  assert_(s.items === undefined && s.total === undefined,
          "queueSnapshot_ must NOT expose a pre-summed total");

  // Disjoint: no record counted twice.
  assert_(s.assigned.items + s.unassigned.items === 4, "the two halves are disjoint");

  // An all-assigned population reports zero unassigned, which is a MEASURED zero
  // (we looked and found none) and legitimately different from the null the
  // client shows when the feed cannot answer at all.
  var noneBlank = queueSnapshot_([issues[0]], who);
  assert_(noneBlank.unassigned.items === 0, "measured zero unassigned");
  Logger.log("✅ _test_unassignedInventory_ passed");
}
```

- [ ] **Step 2: Register it**

In `node-tests.js`, after `_test_clearRateMedian_();`:

```js
_test_unassignedInventory_();
```

- [ ] **Step 3: Run to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `ReferenceError: queueSnapshot_ is not defined`

- [ ] **Step 4: Write it**

In `Code.js`, immediately after `flowOpenBuckets_`'s closing brace, add:

```js
/**
 * The open queue in TWO HALVES: assigned (person-keyed, filterable downstream)
 * and unassigned (org-wide). Returned separately and NEVER pre-summed.
 *
 * Why not one number: the assigned half passes through passesFilters_ on the
 * client, the unassigned half cannot — an unassigned issue belongs to no person
 * and therefore to no Region/Team/PM/Family bucket. Adding a filtered count to
 * an unfiltered one produces a figure that belongs to neither population, so the
 * sum is the CALLER's decision, made once, in one place, with a scope tag on it.
 *
 * Why this matters at all (measured live 2026-08-06): 1,839 unassigned against
 * 1,440 assigned. Assigned-only, weeks-to-clear reads 4.9w; the true queue reads
 * 11.0w. The dashboard was describing a five-week queue as if that were all of it.
 *
 * The unassigned half is counted here off `issues` rather than off the Flow
 * Snapshots log because Jira Raw is authoritative for NOW; the snapshot tab is
 * the log that gives it a history (spec §4.1). Same split as WIP/backlog already.
 *
 * @param {Array<Object>} issues readJiraRaw_ `issues` — every row, all statuses
 * @param {Function} resolvePerson raw assignee → roster display name, or null
 * @returns {{assigned:{items,wipN,todoN,todoHrs}, unassigned:{items,hrs}}}
 */
function queueSnapshot_(issues, resolvePerson) {
  var assigned = flowOpenBuckets_(issues, resolvePerson);
  var a = { items: 0, wipN: 0, todoN: 0, todoHrs: 0 };
  assigned.buckets.forEach(function (b) {
    a.wipN += b.wipN || 0;
    a.todoN += b.todoN || 0;
    a.todoHrs += b.todoHrs || 0;
  });
  a.items = a.wipN + a.todoN;
  a.todoHrs = Math.round(a.todoHrs * 10) / 10;

  var u = { items: 0, hrs: 0 };
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;                                        // epics roll up their children
    if (it.resolved && !isNaN(it.resolved.getTime())) return;      // an inventory is open work
    if (DH_CLOSED_STATUS_.test(String(it.status || ""))) return;
    var raw = String(it.assignee || "").trim();
    // The complement of flowOpenBuckets_'s guard, so the halves are disjoint by
    // construction rather than by coincidence.
    if (raw && !/unassigned/i.test(raw)) return;
    u.items++;
    u.hrs += Math.max(0, (Number(it.estSec) || 0) - (Number(it.spentSec) || 0)) / 3600;
  });
  u.hrs = Math.round(u.hrs * 10) / 10;

  return { assigned: a, unassigned: u };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_unassignedInventory_ passed`

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "feat(dh): queueSnapshot_ — assigned and unassigned halves, never pre-summed

One half is person-keyed and filterable, the other is org-wide and cannot be;
summing them server-side would hand the client a number belonging to neither
population. The unassigned guard in flowOpenBuckets_ is now load-bearing: this
function is its exact complement, so the halves are disjoint by construction.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `inventoryWalkback_` — 26 weeks of history from a measured anchor

Without this the hero ships with no trend at all — a front page with no context. `Flow Snapshots` appends only and starts 2026.W32, so the measured series is one point. Anchoring on the measured present and walking weekly deltas backwards recovers a real series immediately.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (add after `clearRateMedian_`)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`
- Test: new `_test_inventoryWalkback_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js` after `_test_unassignedInventory_`:

```js
/**
 * inventory(W-1) = inventory(W) - created(W) + resolved(W), anchored on the
 * MEASURED present and walked backwards. Recovers a real weeks-to-clear trend on
 * day one instead of waiting for Flow Snapshots to accumulate (spec §4.5).
 *
 * Capped at 26 weeks because the anchor carries the updated>=-26w bound while the
 * weekly deltas do not, so drift grows with distance from today. Reconstructed
 * points are FLAGGED, never silently mixed with measured ones.
 */
function _test_inventoryWalkback_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_inventoryWalkback_: " + m); }

  // Forward truth: start at 100, apply the deltas, end at 130.
  //   W28: +20 -10 → 110 | W29: +15 -5 → 120 | W30: +10 -10 → 120 | W31: +20 -10 → 130
  var weeks = [
    { iso: "2026.W28", created: 20, resolved: 10 },
    { iso: "2026.W29", created: 15, resolved: 5 },
    { iso: "2026.W30", created: 10, resolved: 10 },
    { iso: "2026.W31", created: 20, resolved: 10 },
  ];
  var r = inventoryWalkback_(130, weeks, 26);

  assert_(r.length === 4, "one point per week — got " + r.length);
  assert_(r[3].iso === "2026.W31" && r[3].items === 130, "newest point IS the anchor");
  assert_(r[2].items === 120, "W30 = 130 - 20 + 10 = 120 — got " + r[2].items);
  assert_(r[1].items === 120, "W29 = 120 - 10 + 10 = 120 — got " + r[1].items);
  assert_(r[0].items === 110, "W28 = 120 - 15 + 5 = 110 — got " + r[0].items);

  // The anchor is MEASURED; everything behind it is RECONSTRUCTED and says so.
  assert_(r[3].measured === true, "the anchor is flagged measured");
  assert_(r[0].measured === false && r[1].measured === false && r[2].measured === false,
          "walked-back points are flagged reconstructed");

  // Cap: 30 weeks of deltas yields at most 26 points.
  var many = [];
  for (var i = 0; i < 30; i++) many.push({ iso: "2026.W" + (i + 1), created: 10, resolved: 10 });
  assert_(inventoryWalkback_(500, many, 26).length === 26,
          "capped at 26 — got " + inventoryWalkback_(500, many, 26).length);

  // Inventory can never be negative: a bad delta clamps at 0 rather than
  // printing a queue of -40 items, which is not a state the world can be in.
  var bad = [{ iso: "2026.W30", created: 500, resolved: 0 },
             { iso: "2026.W31", created: 10, resolved: 10 }];
  var clamped = inventoryWalkback_(100, bad, 26);
  assert_(clamped[0].items >= 0, "clamped at zero — got " + clamped[0].items);

  // No anchor means no series. A reconstruction with nothing to anchor on is a
  // guess, and a guessed trend under a headline is worse than no trend.
  assert_(inventoryWalkback_(null, weeks, 26).length === 0, "null anchor → empty");
  assert_(inventoryWalkback_(130, [], 26).length === 0, "no weeks → empty");
  Logger.log("✅ _test_inventoryWalkback_ passed");
}
```

- [ ] **Step 2: Register it**

In `node-tests.js`, after `_test_unassignedInventory_();`:

```js
_test_inventoryWalkback_();
```

- [ ] **Step 3: Run to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `ReferenceError: inventoryWalkback_ is not defined`

- [ ] **Step 4: Add the cap constant and the function**

In `CONFIG_DH`, after `CLEAR_RATE_MIN_N`:

```js
  WALKBACK_MAX_WEEKS: 26,  // reconstruction horizon — matches OPEN_BACKLOG_UPDATED_WEEKS upstream
```

Then, after `clearRateMedian_`'s closing brace:

```js
/**
 * Reconstructs a weekly open-inventory series by walking deltas BACKWARDS from
 * the measured present:
 *
 *     inventory(W-1) = inventory(W) - created(W) + resolved(W)
 *
 * Why reconstruct at all: Flow Snapshots appends one row per export run and
 * started 2026.W32, so the measured series is a single point — and a hero number
 * with no trend is a headline with no context. Cumulative created-minus-resolved
 * from scratch would undercount (anything created before the export window is
 * missing), but anchoring on a MEASURED total removes that error entirely: only
 * the deltas need to be right, and they are, because created and resolution dates
 * are on every row.
 *
 * Two limits, both recorded in the registry's deviations:
 *  1. it assumes nothing was deleted or moved out of scope;
 *  2. the anchor carries the updated>=-26w bound while the deltas do not, so
 *     drift grows with distance from today — hence the 26-week cap, where that
 *     bound is coherent.
 *
 * Every point carries `measured`, so the client can draw reconstructed points
 * differently. As Flow Snapshots accumulates real measurements they replace
 * reconstructed points week by week and the series improves on its own.
 *
 * @param {number|null} anchorItems measured open inventory NOW
 * @param {Array<{iso,created,resolved}>} weeks oldest first, ending at the anchor week
 * @param {number} maxWeeks horizon cap
 * @returns {Array<{iso,items,measured}>} oldest first; empty when unanchorable
 */
function inventoryWalkback_(anchorItems, weeks, maxWeeks) {
  if (anchorItems === null || anchorItems === undefined || isNaN(anchorItems)) return [];
  if (!weeks || !weeks.length) return [];
  var cap = maxWeeks || CONFIG_DH.WALKBACK_MAX_WEEKS || 26;
  var win = weeks.slice(Math.max(0, weeks.length - cap));
  var out = new Array(win.length);
  var items = Number(anchorItems);
  for (var i = win.length - 1; i >= 0; i--) {
    out[i] = {
      iso: win[i].iso,
      items: Math.max(0, Math.round(items)),   // a negative inventory is not a state
      // Only the newest point is measured; everything behind it is inferred.
      measured: i === win.length - 1,
    };
    items = items - (Number(win[i].created) || 0) + (Number(win[i].resolved) || 0);
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_inventoryWalkback_ passed`

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "feat(dh): inventoryWalkback_ — 26 weeks of inventory history from a measured anchor

Flow Snapshots starts 2026.W32, so the measured series is one point and the hero
would ship with no trend. Anchoring on the measured total and walking weekly
deltas back recovers a real series immediately; only the deltas need to be right.
Capped at 26 weeks where the upstream updated bound is coherent, clamped at zero,
and every point flags measured-vs-reconstructed so the client can draw them apart.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `sampleFloorFor_` and the three registry entries

The floor guards **rates and averages, never counts**: a mean over one epic is not a mean, but three items cleared *is* three items cleared. And all three new metrics ship `target: null` — nobody owns a ≤4w or ≤0 bar, and an unratified target on a C-suite headline reads as agreed the moment it is on screen.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`METRIC_REGISTRY_`, ~line 371-500)
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (add `sampleFloorFor_` after `metricConfidence_`, ~line 678)
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`
- Test: new `_test_sampleFloor_` in `Code.js`

- [ ] **Step 1: Write the failing test**

Add to `Code.js` after `_test_inventoryWalkback_`:

```js
/**
 * The floor guards RATES, never COUNTS. A mean over one epic is not a mean, so
 * Forecast shelves at n=1; but three items cleared IS three items cleared, and
 * flooring a count would hide real work behind a "not measured" label.
 *
 * Also pins that the three new metrics carry NO target (spec D11): an unratified
 * bar on a C-suite headline reads as agreed the moment it is on screen.
 */
function _test_sampleFloor_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_sampleFloor_: " + m); }

  // Rates are floored.
  assert_(sampleFloorFor_("forecast", 1).ok === false, "forecast at n=1 is below the floor");
  assert_(sampleFloorFor_("forecast", 1).need === 5, "the floor states what it needs");
  assert_(sampleFloorFor_("forecast", 5).ok === true, "n=5 clears the floor");
  assert_(sampleFloorFor_("onTime", 19).ok === true, "onTime at n=19 clears it");
  assert_(sampleFloorFor_("queueCover", 2).ok === false, "queueCover is a rate and IS floored");

  // Counts are never floored, at any n — including zero.
  ["netFlow", "arrived", "cleared", "inventory"].forEach(function (id) {
    assert_(sampleFloorFor_(id, 0).ok === true, id + " is a count and must never be floored");
    assert_(sampleFloorFor_(id, 1).ok === true, id + " at n=1 still publishes");
  });

  // An unknown id must not silently publish — fail closed.
  assert_(sampleFloorFor_("nonsense", 1).ok === false, "unknown metric fails closed");

  // D11: no targets on the three new metrics.
  var reg = METRIC_REGISTRY_.metrics;
  ["queueCover", "netFlow", "clearedPerHead"].forEach(function (id) {
    assert_(reg[id], id + " is in the registry");
    assert_(reg[id].target === null, id + " must ship target: null — got " + reg[id].target);
  });
  assert_(reg.queueCover.dir === "down", "lower weeks-to-clear is better");
  assert_(reg.clearedPerHead.dir === "up", "more cleared per head is better");
  assert_((reg.queueCover.deviations || []).length > 0,
          "queueCover records its deviations (R&D scope, median basis, walkback limits)");
  Logger.log("✅ _test_sampleFloor_ passed");
}
```

- [ ] **Step 2: Register it**

In `node-tests.js`, after `_test_inventoryWalkback_();`:

```js
_test_sampleFloor_();
```

- [ ] **Step 3: Run to verify it fails**

```bash
node node-tests.js
```

Expected: FAIL with `ReferenceError: sampleFloorFor_ is not defined`

- [ ] **Step 4: Add the three registry entries**

In `Code.js`, inside `METRIC_REGISTRY_.metrics`, after the existing `bugCount` entry, add:

```js
    // ── Queue metrics (spec 2026-08-06, Executive newspaper) ──
    // All three ship target: null (D11). Nobody owns a ≤4w or ≤0 bar, and an
    // unratified target on the C-suite headline reads as agreed the moment it is
    // on screen — it would be the number a board pack quotes. target: null is an
    // established convention here, not a special case: neutral colour, no RAG
    // verdict, no target rule drawn on any chart, neutral delta arrows, and
    // grading against the operating norm from standardRate_ only.
    queueCover: {
      name: "Weeks to Clear",
      definition: "Open inventory divided by the median weekly clearing rate — how long the current queue would take to drain at the rate the organisation has actually been clearing.",
      formula: "(assigned open + unassigned open) ÷ median(resolved per week, last 8 complete weeks)",
      sources: ["Jira Raw — Status Category, Resolution Date, Assignee",
                "Jira Arrivals — Resolved per week"],
      grain: "snapshot ÷ trailing rate",
      unit: "weeks",
      target: null,
      dir: "down",
      coverageGate: 0,
      sampleFloor: 5,
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once agreed)",
      deviations: [
        "The trailing basis is a MEDIAN of 8 complete weeks, not last week's rate. Measured 2026-08-06: W31 cleared 204 against an 8-week mean of 297, so a one-week denominator read 16.1 weeks where the trailing basis reads 11.0.",
        "History behind the current week is RECONSTRUCTED by walking weekly deltas back from the measured present, capped at 26 weeks. It assumes nothing was deleted or moved out of scope, and the anchor carries the export's updated>=-26w bound while the deltas do not, so drift grows with distance from today.",
        "The unassigned half is bounded by OPEN_BACKLOG_UPDATED_WEEKS (26), so genuinely abandoned tickets are excluded. The figure is a FLOOR on dead inventory, not the whole of it.",
        "No target has been agreed. The metric is graded against its own operating norm only.",
      ],
    },
    netFlow: {
      name: "Net Flow",
      definition: "Items arriving minus items cleared, per week, org-wide — whether the queue is growing or draining.",
      formula: "created per week − resolved per week (both counted over every issue, no assignee join)",
      sources: ["Jira Arrivals — Created, Resolved"],
      grain: "week",
      unit: "items",
      target: null,
      dir: "down",
      coverageGate: 0,
      sampleFloor: null,   // a COUNT: never floored
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once agreed)",
      deviations: [
        "Counted org-wide with no assignee join on either half. Person-keyed arrivals under-report the newest weeks — an issue filed unassigned only counts once somebody picks it up — so a growing queue could read as flat exactly when it matters most. Same reasoning as the Bug Count feed.",
        "Probe figures include R&D projects because JQL cannot reproduce getSpaceForIssue_; the exported series excludes them and reads slightly lower.",
        "No target has been agreed.",
      ],
    },
    clearedPerHead: {
      name: "Cleared per Person",
      definition: "Items cleared per person per week within a comparison group — throughput normalised for group size.",
      formula: "items resolved in period ÷ people in the group ÷ weeks in period",
      sources: ["Jira Raw — Resolution Date, Assignee", "Roster — headcount"],
      grain: "group × period",
      unit: "items",
      target: null,
      dir: "up",
      coverageGate: 0,
      sampleFloor: 5,
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      deviations: [
        "Replaces absolute cleared counts in the comparison grid. Grading absolute throughput against a flat target ranked groups by headcount: 8 people clearing 12 items scored a miss while 63 people clearing 61 scored a pass.",
        "No target has been agreed. Graded against the operating norm only.",
      ],
    },
```

- [ ] **Step 5: Write `sampleFloorFor_`**

In `Code.js`, immediately after `metricConfidence_`'s closing brace, add:

```js
/**
 * Org-level SAMPLE FLOOR — is there enough to average?
 *
 * Distinct from the coverage gate, and the distinction is the whole point. A
 * coverage gate asks "how much of the population can we see?" and a metric below
 * it still publishes (CONFIG_DH.SUPPRESS_BELOW_GATE = false, user decision
 * 2026-08-03, with the Data trust strip carrying the gate read). A sample floor
 * asks "is there anything to average?" and a metric below it CANNOT publish —
 * a mean over one epic is not a mean.
 *
 * Treating the two as one instrument was the prototype's inconsistency: it
 * shelved Forecast at n=1 while publishing On-Time at n=19, and both are below
 * their coverage gate. Sample size was doing the work.
 *
 * Rates are floored; COUNTS never are. Three items cleared is three items
 * cleared, and labelling it "not measured" would hide real work.
 *
 * Fails CLOSED on an unknown id: a metric nobody registered must not publish on
 * the strength of a typo.
 *
 * @param {string} metricId registry key
 * @param {number} n measurable records behind the value
 * @returns {{ok:boolean, need:number|null, n:number}}
 */
function sampleFloorFor_(metricId, n) {
  var m = (METRIC_REGISTRY_.metrics || {})[metricId];
  if (!m) return { ok: false, need: null, n: n };
  // sampleFloor === null marks a COUNT — publishable at any n, zero included.
  if (m.sampleFloor === null || m.sampleFloor === undefined) {
    return { ok: true, need: null, n: n };
  }
  var need = m.sampleFloor;
  return { ok: (Number(n) || 0) >= need, need: need, n: Number(n) || 0 };
}
```

**Note on the count metrics:** `arrived`, `cleared` and `inventory` are asserted by the test but are not full registry entries — add them as minimal count entries alongside the three above:

```js
    inventory: { name: "Open Inventory", definition: "Open non-epic issues, assigned plus unassigned.",
      formula: "count of open non-epic issues", sources: ["Jira Raw"], grain: "snapshot", unit: "items",
      target: null, dir: "down", coverageGate: 0, sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director", deviations: [] },
    arrived: { name: "Arrived", definition: "Issues created in the period, org-wide.",
      formula: "count of issues created in period", sources: ["Jira Arrivals — Created"],
      grain: "week", unit: "items", target: null, dir: "down", coverageGate: 0, sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director", deviations: [] },
    cleared: { name: "Cleared", definition: "Issues resolved in the period.",
      formula: "count of issues resolved in period", sources: ["Jira Raw — Resolution Date"],
      grain: "week", unit: "items", target: null, dir: "up", coverageGate: 0, sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director", deviations: [] },
```

- [ ] **Step 6: Run to verify it passes**

```bash
node node-tests.js
```

Expected: `✅ _test_sampleFloor_ passed`. `_test_registry_` must also still pass — if it enumerates required keys, add any it demands to the new entries.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "feat(dh): sampleFloorFor_ + queueCover/netFlow/clearedPerHead registry entries

The floor guards rates and averages, never counts: a mean over one epic is not a
mean, but three items cleared is three items cleared. Distinct from the coverage
gate on purpose — below-gate still publishes, below-floor cannot — which is what
lets the 2026-08-03 publish-below-gate decision stand untouched. Fails closed on
an unknown id.

All three new metrics ship target: null (D11). An unratified bar on a C-suite
headline reads as agreed the moment it is on screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Wire it into the payload and bump the schema

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`buildDeliveryModel_` inputs, ~line 3472-3487)
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`assembleModel_`, ~line 3160-3340)
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`DH_SCHEMA_VER_`, line 3469)

- [ ] **Step 1: Read the input assembly**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard"
sed -n '3472,3490p' Code.js
```

Confirm the `inputs` object shape and where `flowSnaps: readFlowSnapshots_()` sits.

- [ ] **Step 2: Add the arrivals read to the inputs**

In `buildDeliveryModel_`, find:

```js
    flowSnaps: readFlowSnapshots_(),
```

Add immediately after:

```js
    arrivals: readArrivals_(),
```

- [ ] **Step 3: Compute and attach the queue model in `assembleModel_`**

In `assembleModel_`, find the line that computes `flowOpen`:

```js
    ? flowOpenBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0, uncategorized: 0 };
```

After that statement, add:

```js
  // ── Queue model (spec 2026-08-06) ──────────────────────────────────────────
  // Two halves, never summed here: one is filterable downstream, the other is
  // org-wide. The client decides, once, with a scope tag on it.
  var queue = inputs.jira.available
    ? queueSnapshot_(jiraScoped.issues, resolvePerson)
    : { assigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0 },
        // NULL, not 0 — with no feed we did not look, and "0 unowned" is the
        // most dangerous false read on this surface (spec §5).
        unassigned: { items: null, hrs: null } };

  var arrWeeks = (inputs.arrivals && inputs.arrivals.available) ? inputs.arrivals.weeks : [];
  // Ordered oldest-first by ISO key so the walkback and the median both read a
  // series in time order regardless of how the sheet happened to be sorted.
  arrWeeks = arrWeeks.slice().sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
  var resolvedSeries = arrWeeks.map(function (w) { return w.resolved; });
  var clearRate = clearRateMedian_(resolvedSeries, CONFIG_DH.CLEAR_RATE_WEEKS);
  var totalItems = (queue.unassigned.items === null)
    ? null
    : queue.assigned.items + queue.unassigned.items;
```

- [ ] **Step 4: Attach to the returned model**

In `assembleModel_`'s return object, find:

```js
    flowOpenBuckets: flowOpen.buckets,
```

Add immediately after:

```js
    // Queue halves kept separate all the way to the client (spec §3 §2).
    queue: queue,
    arrivalWeeks: arrWeeks,
    // Reconstructed inventory history — anchored on the measured total, so it is
    // empty rather than fabricated when the total cannot be measured.
    inventoryHistory: inventoryWalkback_(totalItems, arrWeeks, CONFIG_DH.WALKBACK_MAX_WEEKS),
```

And inside the `meta` object, alongside `flowSnapshotsAvailable`, add:

```js
      arrivalsAvailable: !!(inputs.arrivals && inputs.arrivals.available),
      clearRateMedian: clearRate,
      clearRateWeeks: CONFIG_DH.CLEAR_RATE_WEEKS,
      walkbackMaxWeeks: CONFIG_DH.WALKBACK_MAX_WEEKS,
```

- [ ] **Step 5: Bump the schema and log the change**

At `Code.js:3469`, change:

```js
var DH_SCHEMA_VER_ = 25;
```

to:

```js
var DH_SCHEMA_VER_ = 26;
```

And add to the version-history comment block above it (the block listing `v21`, `v24`, …):

```js
// v26: Executive newspaper (spec 2026-08-06) — model.queue {assigned,unassigned}
//      (halves NEVER summed server-side), model.arrivalWeeks, model.inventoryHistory
//      (walked back from the measured anchor, `measured` flag per point),
//      meta.arrivalsAvailable/clearRateMedian/clearRateWeeks/walkbackMaxWeeks,
//      typeHygiene rows gain `attrN`, and registry gains queueCover/netFlow/
//      clearedPerHead/inventory/arrived/cleared (all target: null).
```

- [ ] **Step 6: Verify the whole server suite is green**

```bash
node node-tests.js
```

Expected: `✅ node-tests: all suites passed`

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Code.js
git commit -m "feat(dh): wire the queue model into the payload, schema 25 -> 26

model.queue keeps the two halves separate to the client; arrivalWeeks sorted
oldest-first so the median and the walkback both read time order regardless of
sheet order; inventoryHistory is empty rather than fabricated when the anchor
cannot be measured; unassigned is null (not 0) with no Jira feed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Exporter — the `Jira Arrivals` tab

**Files:**
- Modify: `D:/Contribution/Jira Backlog.js` (`CONFIGJ` sheet names, ~line 285)
- Modify: `D:/Contribution/Jira Backlog.js` (new `fetchResolvedInWindow_` + `writeArrivals_`, near `writeFlowSnapshot_` ~line 1983)
- Modify: `D:/Contribution/Jira Backlog.js` (main run body, ~line 2613)

There is no local test harness for this file — it only runs inside GAS against live Jira. Verification is by running the export and reading the sheet (Task 19). Keep the functions small and side-effect-free where possible.

- [ ] **Step 1: Add the sheet name to `CONFIGJ`**

Find:

```js
    FLOW_SNAP_SHEET: "Flow Snapshots",
```

Add immediately after:

```js
    // Weekly created/resolved tally for the Executive queue metrics (v3.11.0).
    // Counts only — no per-issue rows, so no consumer's denominators move.
    ARRIVALS_SHEET:  "Jira Arrivals",
```

- [ ] **Step 2: Add the resolved-window fetch**

Immediately after `fetchCreatedIssues_`'s closing brace, add:

```js
  /**
   * Fetches issues RESOLVED inside a date window — the second half of the
   * Executive net-flow subtraction (v3.11.0).
   *
   * No assignee clause, deliberately, and it must stay that way: both halves of
   * "arrived minus cleared" have to describe the SAME population or the
   * subtraction is meaningless. Person-keyed arrivals also under-report the
   * newest weeks, because an issue filed unassigned only counts once somebody
   * picks it up — so a growing queue would read as flat exactly when it matters.
   */
  function fetchResolvedInWindow_(fromStr, toStr) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      'project NOT IN (TEMPLATE)',
      CONFIGJ.DONE_JQL,
      'resolutiondate >= "' + fromStr + '"',
      'resolutiondate <= "' + toStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY resolutiondate DESC';
    Logger.log("📋 Resolved-in-window JQL: " + jql);

    var all = fetchAllIssuesByJql_(jql, JIRA_FIELDS_NO_COMMENTS);
    return all.filter(function (i) {
      return getSpaceForIssue_(i) !== null && !isNoiseIssue_(i);
    });
  }
```

- [ ] **Step 3: Add the writer**

Immediately after `writeFlowSnapshot_`'s closing brace, add:

```js
  /**
   * Writes the Jira Arrivals tab: one row per ISO week with org-wide created and
   * resolved counts, plus how many of the created are still unassigned.
   *
   * FULL REWRITE per run (unlike Flow Snapshots, which appends): these are
   * counts over date fields, so they are recomputable from Jira at any time and
   * a rewrite keeps the tab self-healing after a partial run.
   *
   * ── Week Start is a DATE, not a label ──
   * jb_isoWeekLabel_ zero-pads ("2026.W07"); the dashboard's weekKeyFromDate_
   * does not ("2026.W7"). That divergence is documented in v3.5.0. Writing a
   * label here would silently fail to join for weeks 1-9, so this ships the
   * week's Monday and lets the dashboard own week labelling — exactly as the
   * Jira Bugs tab ships raw Created dates for parseBugRows_ to bucket.
   */
  function writeArrivals_(createdIssues, resolvedIssues) {
    var HEADERS = ["Week Start", "Created", "Resolved", "Created Unassigned"];
    var sheet = jb_getOrCreateSheet_(CONFIGJ.ARRIVALS_SHEET);

    // Monday of the ISO week containing `d`, in UTC — same convention as
    // jb_isoWeekLabel_ so a DST shift cannot push a Monday into the prior week.
    function mondayUtc_(d) {
      var u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dayNum = (u.getUTCDay() + 6) % 7;         // Mon=0 … Sun=6
      u.setUTCDate(u.getUTCDate() - dayNum);
      return u;
    }
    function keyOf_(d) { return mondayUtc_(d).toISOString().slice(0, 10); }

    var byWeek = {};
    function row_(k) {
      if (!byWeek[k]) byWeek[k] = { created: 0, resolved: 0, createdUnassigned: 0 };
      return byWeek[k];
    }

    (createdIssues || []).forEach(function (i) {
      var raw = dig_(i, "fields.created");
      if (!raw) return;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return;
      var r = row_(keyOf_(d));
      r.created++;
      if (!dig_(i, "fields.assignee.displayName")) r.createdUnassigned++;
    });

    (resolvedIssues || []).forEach(function (i) {
      var raw = dig_(i, "fields.resolutiondate");
      if (!raw) return;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return;
      row_(keyOf_(d)).resolved++;
    });

    var keys = Object.keys(byWeek).sort();
    var out = [HEADERS];
    keys.forEach(function (k) {
      var r = byWeek[k];
      out.push([new Date(k + "T00:00:00Z"), r.created, r.resolved, r.createdUnassigned]);
    });

    sheet.clearContents();
    sheet.getRange(1, 1, out.length, HEADERS.length).setValues(out);
    styleHeader_(sheet.getRange(1, 1, 1, HEADERS.length));
    sheet.getRange(2, 1, Math.max(1, out.length - 1), 1).setNumberFormat("yyyy-mm-dd");
    Logger.log("📈 Jira Arrivals written: " + keys.length + " weeks");
  }
```

- [ ] **Step 4: Call it from the main run**

Find the existing created-issues fetch in the main run body (~line 2612):

```js
      // Exec Q&A — uses all weeks for trend context, but WoW compares last 2.
      Logger.log("📦 Fetching created issues for Exec window...");
      var createdIssues = fetchCreatedIssues_(weeks[0].fromStr, weeks[weeks.length-1].toStr);
```

Add immediately after that statement:

```js
      // Jira Arrivals (v3.11.0) — reuses the created fetch above and adds the
      // resolved half over the SAME window, so net flow subtracts like for like.
      Logger.log("📦 Fetching resolved issues for the Arrivals tally...");
      var resolvedWindow = fetchResolvedInWindow_(weeks[0].fromStr, weeks[weeks.length - 1].toStr);
      writeArrivals_(createdIssues, resolvedWindow);
```

- [ ] **Step 5: Verify the file still parses**

```bash
cd "D:/Contribution" && node --check "Jira Backlog.js" && echo "PARSE OK"
```

Expected: `PARSE OK`

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add "Jira Backlog.js"
git commit -m "feat(jira): Jira Arrivals tab — weekly org-wide created/resolved tally

Counts only, full rewrite per run, no assignee clause on either half so net flow
subtracts like for like. Week Start ships as a DATE, not a label: jb_isoWeekLabel_
pads W07 and the dashboard's weekKeyFromDate_ does not, so a label written here
would fail to join for weeks 1-9. Same pattern as Jira Bugs shipping raw dates.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Exporter — unassigned columns on `Flow Snapshots`

**Files:**
- Modify: `D:/Contribution/Jira Backlog.js` (`writeFlowSnapshot_`, ~line 1983-2010)

- [ ] **Step 1: Read the current writer**

```bash
cd "D:/Contribution" && sed -n '1983,2015p' "Jira Backlog.js"
```

Note how `openCandidates` is passed in and how the header row is written only when the sheet is empty.

- [ ] **Step 2: Extend the headers and the appended row**

In `writeFlowSnapshot_`, find:

```js
    var FLOW_HEADERS = ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items"];
```

Replace with:

```js
    // APPEND-ONLY contract: new columns go on the END, and every reader indexes
    // by header NAME, so historical rows stay valid and simply carry no value
    // for columns that did not exist when they were written (v3.11.0).
    var FLOW_HEADERS = ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items",
                       "Unassigned Items", "Unassigned Hrs"];
```

- [ ] **Step 3: Count the unassigned half and append it**

`openCandidates` now contains unassigned issues too, because Task 10 removes the assignee clause. Inside `writeFlowSnapshot_`, before the row is appended, add:

```js
    // The unassigned half of the queue. Reachable only because v3.11.0 dropped
    // 'assignee is not EMPTY' from fetchOpenIssues_ (spec D7) — before that these
    // rows were never fetched, which is why the dashboard reported a 1,440-item
    // queue when the true figure was 3,279.
    var unItems = 0, unSecs = 0;
    (openCandidates || []).forEach(function (i) {
      if (dig_(i, "fields.assignee.displayName")) return;
      unItems++;
      var est = Number(dig_(i, "fields.timeoriginalestimate")) || 0;
      var spent = Number(dig_(i, "fields.timespent")) || 0;
      unSecs += Math.max(0, est - spent);
    });
    var unHrs = Math.round((unSecs / 3600) * 10) / 10;
```

Then find the `appendRow` / `setValues` call that writes the snapshot row and add the two new values to the **end** of its array, in the same order as `FLOW_HEADERS`:

```js
      unItems, unHrs
```

- [ ] **Step 4: Verify the file still parses**

```bash
cd "D:/Contribution" && node --check "Jira Backlog.js" && echo "PARSE OK"
```

Expected: `PARSE OK`

- [ ] **Step 5: Confirm the dashboard reader tolerates the new columns**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && grep -n -A14 "function parseFlowSnapshotRows_" Code.js
```

Confirm it reads by `colIdx_` header name. If it reads by fixed index, stop and convert it to `colIdx_` before continuing — appending columns to a positional reader is how a snapshot log silently starts reporting hours as items.

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add "Jira Backlog.js"
git commit -m "feat(jira): Flow Snapshots gains Unassigned Items / Unassigned Hrs

Appended at the end and read by header name, so historical rows stay valid and
carry no value for columns that did not exist when written. Gives the unowned
half of the queue a measured history to replace the reconstructed one week by week.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Exporter — drop the assignee clause (approach B)

The one-line change the whole spec turns on. **Read spec §4.6 before this task.** After it, the 🧬 matrix and gaps queue open-half fill rates will drop, by design, and Task 1 must already be in place or Roster join will report a false failure.

**Files:**
- Modify: `D:/Contribution/Jira Backlog.js:1152-1186` (`fetchOpenIssues_`)
- Modify: `D:/Contribution/Jira Backlog.js` (version header, ~line 9 and the CHANGES block)

- [ ] **Step 1: Confirm Task 1 is committed**

```bash
cd "D:/Contribution" && git log --oneline --all | grep -i "attrN" && echo "TASK 1 PRESENT"
```

Expected: the Task 1 commit is listed and `TASK 1 PRESENT` prints. **If it does not, stop** — deploying this without `attrN` drops Roster join to ~44% and un-retires a solved check on three surfaces with a number that is not true.

- [ ] **Step 2: Remove the clause**

In `fetchOpenIssues_`, find:

```js
    var clauses = [
      'issuetype in (' + types + ')',
      'statusCategory != Done',
      'assignee is not EMPTY',
      'project NOT IN (TEMPLATE)',
      'summary !~ "to delete"'
    ];
```

Replace with:

```js
    // ── 'assignee is not EMPTY' REMOVED in v3.11.0 (spec 2026-08-06, D7) ──
    // Measured live 2026-08-06 on servicerocket-coe: 1,839 unassigned open issues
    // against 1,440 assigned. The clause hid 56% of the queue, and assigned-only
    // weeks-to-clear read 4.9w where the true queue reads 11.0w — the dashboard
    // was describing a five-week queue as if that were all of it.
    //
    // ⚠️ Downstream, before changing this back or forward:
    //  · typeHygOpen_ does NOT require an assignee, so these rows enter the
    //    by-type matrix and the gaps queue. Unowned tickets are the worst-tagged
    //    population on the site, so due/est/region/team open fill rates DROP.
    //    That is previously-hidden hygiene debt becoming visible, not tagging
    //    getting worse (README carries the dated note).
    //  · attr MUST divide by attrN, not n, or an absent assignee scores as a
    //    failed roster join and un-retires a solved check at ~44%. Code.js
    //    typeHygieneBuckets_ handles this — do not revert it.
    //  · Resolved-work metrics are untouched: they all skip unresolved records.
    var clauses = [
      'issuetype in (' + types + ')',
      'statusCategory != Done',
      'project NOT IN (TEMPLATE)',
      'summary !~ "to delete"'
    ];
```

- [ ] **Step 3: Update the stale comments in the same function**

The JSDoc above `fetchOpenIssues_` says "every open **assigned** issue on the site". Find and replace both occurrences of that phrasing:

```js
   * Bounded by CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS: with no resolution date to
   * anchor on, an unbounded query returns every open assigned issue on the site
   * for all time, and abandoned tickets would inflate every person's backlog.
```

with:

```js
   * Bounded by CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS: with no resolution date to
   * anchor on, an unbounded query returns every open issue on the site for all
   * time, and abandoned tickets would inflate both the per-person backlog and
   * the org queue depth. Since v3.11.0 this fetch includes UNASSIGNED work, so
   * the bound now also decides how much dead unowned inventory is counted — the
   * exported unassigned figure is a floor, not a total (spec D8).
```

Also update the `@returns` line from "in-scope, non-noise open issues" to:

```js
   * @returns {Object[]} in-scope, non-noise open issues, assigned AND unassigned
```

- [ ] **Step 4: Bump the version and add the CHANGES entry**

At line ~9, change `// VERSION:     3.10.0` to:

```js
  // VERSION:     3.11.0
```

And add at the top of the CHANGES list:

```js
  // CHANGES v3.11.0 (Delivery Health Executive newspaper — spec 2026-08-06):
  //   - fetchOpenIssues_ NO LONGER filters 'assignee is not EMPTY'. Measured live
  //     2026-08-06: 1,839 unassigned open issues vs 1,440 assigned — the clause
  //     hid 56% of the queue. Jira Raw grows by ~1,839 rows.
  //     ⚠️ Consequence: the dashboard's by-type matrix and gaps queue open-half
  //     fill rates DROP, because unowned tickets are the worst-tagged population.
  //     That is hidden debt surfacing, not a regression. Requires Code.js's attrN
  //     denominator (schema v26) or Roster join falsely reads ~44%.
  //   - NEW tab "Jira Arrivals": one row per ISO week, org-wide Created / Resolved
  //     / Created Unassigned. Counts only — no per-issue rows, so no consumer's
  //     denominators move. Week Start is a DATE, not a label, because
  //     jb_isoWeekLabel_ pads W07 and the dashboard's weekKeyFromDate_ does not.
  //   - "Flow Snapshots" gains Unassigned Items / Unassigned Hrs, appended at the
  //     end and read by header name so historical rows stay valid.
```

- [ ] **Step 5: Verify the file still parses**

```bash
cd "D:/Contribution" && node --check "Jira Backlog.js" && echo "PARSE OK"
```

Expected: `PARSE OK`

- [ ] **Step 6: Confirm no other assignee filter blocks the open feed**

```bash
cd "D:/Contribution" && grep -n "assignee is not EMPTY" "Jira Backlog.js"
```

Expected: matches remain **only** in `fetchActiveWIP_` (~line 1089) and `buildCompletedWorkJql_` (~line 1412). Both are correct — WIP by definition has an owner, and the completed-work builder is dead code. `fetchOpenIssues_` must no longer appear.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add "Jira Backlog.js"
git commit -m "feat(jira)!: v3.11.0 — open-backlog fetch no longer requires an assignee

Measured 2026-08-06 on servicerocket-coe: 1,839 unassigned open issues against
1,440 assigned. The clause hid 56% of the queue, and assigned-only weeks-to-clear
read 4.9w where the true queue reads 11.0w.

BREAKING for hygiene reads: unassigned rows enter the by-type matrix and the gaps
queue (typeHygOpen_ needs no assignee), and unowned tickets are the worst-tagged
work on the site, so open-half due/est/region/team fill rates drop. Hidden debt
surfacing, not a regression. Requires Code.js attrN (schema v26).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Client — the masthead and the verdict engine

The verdict is **composed from ranked findings, not a template**. The prototype hardcoded "it grew by N items last week", which is false on the real data (+14/wk). A finding whose threshold is not met must not render.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (add `verdictFindings_` and `renderMasthead_` near `renderTiles_`, ~line 2573)
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`#viewExec` markup, ~line 509-526)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Write the failing smoke checks**

Read how `render-smoke.js` builds a model and asserts, then add a suite. Find the existing pattern first:

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && grep -n "function check\|function assert\|checks++\|function model_\|function baseModel" render-smoke.js | head -20
```

Add a suite following that file's own idiom, asserting:

```
1. netFlow ≈ 0 (|netFlow| < 5% of clearRateMedian) → the rendered masthead
   contains NO "grew by" / "growing" / "draining" clause.
2. netFlow = +80 against a clearRateMedian of 300 → the growth clause IS present.
3. meta.arrivalsAvailable = false → the masthead contains no weeks-to-clear
   clause and no "undefined" / "NaN" anywhere.
4. queue.unassigned.items = null → the masthead never contains "0 unowned" or
   "0% unowned".
5. queue.unassigned.items = 1839 of 3279 total → an unowned clause IS present.
6. meta.clearRateMedian = null (under 5 weeks) → finding #1 is suppressed
   entirely: no queue-depth clause at all.
7. The masthead states headcount from the FILTERED population, and it changes
   when STATE.region is set.
8. No person name from MODEL.people appears anywhere in the masthead HTML.
```

- [ ] **Step 2: Run to verify the new checks fail**

```bash
node render-smoke.js
```

Expected: FAIL — `verdictFindings_ is not defined` or the new assertions report missing markup.

- [ ] **Step 3: Write the findings engine**

Add to `Dashboard.html` immediately before `renderTiles_`:

```js
/**
 * ── THE VERDICT ────────────────────────────────────────────────────────────────
 * Composed from ranked findings, never a sentence template.
 *
 * The prototype hardcoded "…and it grew by N items last week". On the real feed
 * net flow is +14/wk against a clearing rate of ~297 — the queue is stable, and
 * that clause would have been simply false. A template cannot decline to make a
 * claim; a findings list can.
 *
 * Rank order is FIXED and each finding carries its own materiality threshold,
 * because not every finding has a target to be distant from (unowned share has
 * none). A finding whose threshold is not met returns null and never renders.
 *
 * @returns {Array<{key:string, text:string, sev:string}>} worst first
 */
function verdictFindings_() {
  var out = [];
  var q = MODEL.queue || { assigned: {}, unassigned: {} };
  var rate = MODEL.meta.clearRateMedian;
  var un = q.unassigned ? q.unassigned.items : null;
  var total = (un === null || un === undefined) ? null : (q.assigned.items || 0) + un;

  // 1 — QUEUE DEPTH. Against the operating band, NOT a target: D11 ships
  // queueCover with target: null. Suppressed outright while the norm is
  // unpublishable, because "deep" is meaningless without a normal to be deep
  // against, and inventing one here would put a verdict on screen no owner holds.
  if (total !== null && rate) {
    var cover = total / rate;
    var std = stdFor_(coverSeries_(), { publish: true });
    if (std && std.baseline !== null && cover > std.baseline + std.band) {
      out.push({ key: "depth", sev: "bad",
        text: "We are holding " + nfDh_(total) + " items and clearing about " +
              nfDh_(Math.round(rate)) + " a week — roughly " + n1Dh_(cover) +
              " weeks of work, against a normal of " + n1Dh_(std.baseline) + "." });
    }
  }

  // 2 — UNOWNED SHARE. Threshold 20%: below that it is housekeeping, above it
  // the queue has no owner and that is the finding.
  if (total !== null && total > 0 && un !== null) {
    var share = un / total;
    if (share >= 0.20) {
      out.push({ key: "unowned", sev: "bad",
        text: Math.round(share * 100) + "% of it has no owner — " + nfDh_(un) +
              " items nobody has picked up." });
    }
  }

  // 3 — NET FLOW. Threshold: 5% of the clearing rate. Below that the queue is
  // stable, and calling a stable queue "growing" is noise dressed as a finding.
  if (rate && MODEL.arrivalWeeks && MODEL.arrivalWeeks.length) {
    var nf = netFlowPerWeek_();
    if (nf !== null && Math.abs(nf) >= rate * 0.05) {
      out.push({ key: "flow", sev: nf > 0 ? "bad" : "good",
        text: nf > 0
          ? "It is growing by about " + nfDh_(Math.round(nf)) + " items a week."
          : "It is draining by about " + nfDh_(Math.abs(Math.round(nf))) + " items a week." });
    }
  }

  // 4 — GATES. Reuses gapsRows_ so the masthead and the gates band can never
  // disagree about which checks are failing.
  var failing = (gapsRows_() || []).filter(function (g) {
    return g.value !== null && g.gate !== null && g.value < g.gate;
  });
  if (failing.length) {
    out.push({ key: "gates", sev: "warn",
      text: failing.length + " of " + (gapsRows_() || []).length +
            " evidence gates are below their bar." });
  }

  // 5 — SHELVED. Says how much of the scorecard is not answerable at all.
  var shelved = shelfRows_() || [];
  if (shelved.length) {
    out.push({ key: "shelf", sev: "warn",
      text: shelved.length + " metric" + (shelved.length === 1 ? " is" : "s are") +
            " not measurable this period." });
  }
  return out;
}
```

**Helpers this needs.** Add them beside it — `nfDh_` / `n1Dh_` are thousands and one-decimal formatters (check whether the file already has equivalents with `grep -n "Intl.NumberFormat" Dashboard.html` and reuse them if so); `coverSeries_()` maps `MODEL.inventoryHistory` through the clear rate to a weeks-to-clear series for `stdFor_`; `netFlowPerWeek_()` averages `created − resolved` over the trailing `meta.clearRateWeeks` of `MODEL.arrivalWeeks`.

- [ ] **Step 4: Render it**

Add `renderMasthead_()` writing into a new `#masthead` div, and add that div as the **first** child of `#viewExec` in the markup. Grammar: week label · "last complete week" · filtered headcount · the findings joined into prose · an evidence chip on the right carrying failing-gate and shelved counts. Reuse `esc_` on every interpolated value and `scopeTag_` for the tags.

- [ ] **Step 5: Dispatch it**

In `renderAll_`, add `renderMasthead_();` to the Executive branch, before `renderTiles_()`.

- [ ] **Step 6: Run to verify the checks pass**

```bash
node render-smoke.js
```

Expected: all checks pass, total **above** 648.

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "feat(dh): Executive masthead — verdict composed from ranked findings

A template cannot decline to make a claim. The prototype hardcoded 'it grew by N
items last week', which is false on the real feed (+14/wk against ~297 cleared).
Each finding carries its own materiality threshold and returns null when unmet:
net flow stays silent under 5% of the clearing rate, queue depth is suppressed
entirely while the operating norm is unpublishable, and a null unassigned count
never renders as '0 unowned'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Client — the backlog band and the queue ruler

ORG hero triplet, filterable assigned sub-row, three-segment ruler with the operating band shaded and **no target rule** (D11).

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (add `renderBacklogBand_` and `queueRulerSvg_`)
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`#viewExec` markup — add `#backlogBand` after `#masthead`)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Write the failing smoke checks**

Assert:

```
1. The hero triplet carries an ORG scope tag; the assigned sub-row carries SNAP.
2. The hero inventory equals assigned + unassigned, and the sub-row equals
   assigned alone — the two are never the same number.
3. queue.unassigned.items = null → the band renders "not measured" for the
   unowned segment and the hero falls back to assigned-only WITH a stated reason;
   the string "0 unowned" appears nowhere.
4. meta.clearRateMedian = null → weeks-to-clear states how many more weeks it
   needs and prints no number.
5. NO target rule: the ruler SVG contains no "target" text and no 4w reference
   line. The operating band IS shaded when the norm publishes.
6. Setting STATE.region changes the sub-row but NOT the hero triplet.
7. phase "plan" → arrived/cleared/netFlow tiles are notYet; inventory and
   unassigned still render (they are SNAP).
8. The unowned segment renders a click-through only when unassigned rows exist.
```

- [ ] **Step 2: Run to verify they fail**

```bash
node render-smoke.js
```

Expected: FAIL — `renderBacklogBand_ is not defined`.

- [ ] **Step 3: Write the ruler**

Add `queueRulerSvg_()` building inline SVG with `document.createElementNS`, following the existing chart kit's conventions (`grep -n "function hbarChart_" Dashboard.html` for the house style — `svgNS`, an `el()` helper, `css()` for tokens). Three `rect`s: assigned WIP (solid `--seg-bill`), assigned To Do (`--ivory`), unowned (hatched via an SVG `<pattern>`). X axis in weeks at `meta.clearRateMedian`. Shade the operating band as a `rect` behind the segments when `stdFor_` publishes; draw **no** target line. Every segment gets a `<title>` for hover and a text label with its count.

- [ ] **Step 4: Write the band**

`renderBacklogBand_()` renders the three ORG hero slots, then the assigned sub-row, then the ruler. Use `tileHtml_`'s existing grammar where it fits, but pass `target: null` so no RAG colour or target chip is drawn. Null unassigned must produce the "not measured" state, never a zero.

- [ ] **Step 5: Dispatch and add the markup**

Add `<div class="panel" id="backlogBand"></div>` to `#viewExec` after `#masthead`, and `renderBacklogBand_();` to `renderAll_`.

- [ ] **Step 6: Run to verify they pass**

```bash
node render-smoke.js
```

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "feat(dh): backlog band — ORG hero, filterable assigned sub-row, 3-segment ruler

Hero is ORG because the assigned-only reading (4.9w) is at target while the true
queue is 11.0w. The sub-row keeps the filters meaningful. No target rule anywhere
(D11) — the operating band is shaded instead, and nothing is drawn at all while
the norm is unpublishable. Null unassigned renders 'not measured', never 0.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Client — the evidence gates band

Mechanically the current `renderTrust_`, re-headed with the prototype's better copy. Keep `gapsRows_` as the source, keep `ORG`, keep the retire-at-100% behaviour.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html:3791+` (`renderTrust_`)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Read the current renderer**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && sed -n '3791,3860p' Dashboard.html
```

- [ ] **Step 2: Re-head it**

Change the panel heading to `Can we publish these numbers?` with the sub-line `Each metric needs its gate met before it goes on a slide.` Leave `order`, `titles`, the `gapsRows_` source, the `ORG` tag and the retirement logic untouched.

- [ ] **Step 3: Update the smoke checks that assert the old heading**

```bash
grep -n "Data trust\|trustPanel\|renderTrust_" render-smoke.js
```

Update the asserted strings. Keep every behavioural assertion — especially that a 100% check disappears and that the strip ignores filters.

- [ ] **Step 4: Verify green**

```bash
node render-smoke.js
```

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "refactor(dh): data-trust strip becomes 'Can we publish these numbers?'

Copy change only — same gapsRows_ source, same ORG scope, same retire-at-100%
behaviour. The question is what the band actually answers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 14: Client — the flow and capacity bands

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`renderFlow_` ~line 2957, `renderPulse_` ~line 3722)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Write the failing smoke checks**

Assert:

```
1. The flow band shows Cleared (PERIOD) · Arrived (ORG) · Lead p85 (PERIOD) ·
   On-Time (PERIOD), and each tag rides with ITS OWN tile — not merely somewhere
   in the band's markup.
2. Arrived renders "not measured" when meta.arrivalsAvailable is false.
3. The capacity band is ABSENT FROM THE DOM ENTIRELY for a non-margin role —
   assert on the absence of the utilisation label, not on a hidden attribute.
4. phase "plan" → the capacity slot is Planned Coverage and the outcome tiles
   are notYet.
5. Mid-period → utilisation carries the floor grammar ("at least") and no RAG.
6. The people-signals line reconciles to a real count and names nobody.
```

- [ ] **Step 2: Run to verify they fail**

```bash
node render-smoke.js
```

- [ ] **Step 3: Add the Arrived tile to the flow band**

Extend `renderFlow_` with an `arrived` tile fed from `MODEL.arrivalWeeks` for the analysis period, `scopeTag_("org")`, `target: null`, and the `absent` state when `meta.arrivalsAvailable` is false. Reuse `flowTileHtml_` — it already handles `target: null` neutrally, which is exactly the grammar wanted.

- [ ] **Step 4: Confirm the capacity band's existing guards survive**

`renderPulse_` and the utilisation tile already implement `canSeeMargin_()`, `planTile_`/`notYetTile_` and `opts.floor`. Do not rewrite them — only re-home them under a `CAPACITY — what we have to throw at it` kicker, and replace the `[object Object]` people caveat with a computed reconciliation count.

- [ ] **Step 5: Verify green**

```bash
node render-smoke.js
```

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "feat(dh): flow band gains Arrived (ORG); capacity band re-homed

Arrived reuses flowTileHtml_ because target: null already means neutral there.
Capacity keeps every existing guard — margin gate omits it from the DOM rather
than dimming it, the planning phase swaps in Planned Coverage, mid-period keeps
the floor grammar. The people caveat is now a computed count, not [object Object].

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 15: Client — the comparison grid and bullet chart

`Cleared` becomes `clearedPerHead`; `queueCover` joins the columns; both are norm-graded with **no target rule**.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html:3533+` (`renderCompare_`)
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`METRICS_` accessor table, ~line 3300-3380)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

- [ ] **Step 1: Write the failing smoke checks**

Assert:

```
1. A group of 8 people clearing 12 items and a group of 63 clearing 61 are graded
   on the SAME per-head basis — the smaller group is not automatically worse.
2. Groups under 10 people render their value AND a grey ungraded dot, never a RAG
   colour. Assert the value is present — dimming must not mean hiding.
3. clearedPerHead and queueCover draw NO target rule in the grid or the bullet
   chart; the operating band is shaded instead.
4. With no target AND no publishable norm, the cell prints its value and states
   it has no reference — never a bare uncoloured number that looks graded.
5. The mandatory coverage sentence is present ("all N people represented" /
   "N of M — K missing").
6. HBAR_MAX_ROWS_ still caps rows, "Show all N" is offered, and the rows kept are
   chosen by distance below reference, not list position.
7. phase "plan" → liveMetrics_ collapses to planCov and the grid re-points.
```

- [ ] **Step 2: Run to verify they fail**

```bash
node render-smoke.js
```

- [ ] **Step 3: Add the two accessors to `METRICS_`**

Follow the existing entries' shape exactly (`grep -n -A12 "onTime: {" Dashboard.html` for the template). `clearedPerHead` divides the group's resolved count by its distinct headcount and by the periods in the window; `queueCover` divides the group's open inventory by its share of the clearing rate. Both carry `target: null` and read their labels from `reg_()`.

- [ ] **Step 4: Build the grid**

Extend `renderCompare_` with the metric × dimension table above the existing bullet chart, cells graded by a `status`-style helper that returns `none` for both null values and sub-10 groups. Clicking a column sets `STATE.metric` and re-renders the bullet chart. Cells are `role="button"` with `tabindex="0"` and an Enter/Space handler — the existing chart kit's keyboard idiom.

- [ ] **Step 5: Verify green**

```bash
node render-smoke.js
```

- [ ] **Step 6: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "feat(dh): comparison grid — per-head throughput, queueCover column, no target rules

Absolute throughput against a flat target ranked groups by headcount: 8 people
clearing 12 items scored a miss while 63 clearing 61 scored a pass. Per-head
grading against the operating norm fixes it. Sub-10 groups keep their value and
lose only the colour. Neither new column draws a target rule (D11).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 16: Client — the shelf and the trust detail

Both **data-driven**. No hand-written lists, no hardcoded editorial.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (add `shelfRows_`, `renderShelf_`, `renderTrustDetail_`)
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (`#viewExec` markup)
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`

`shelfRows_` is already called by `verdictFindings_` in Task 11, so its signature is fixed: it returns an array, and `.length` is the shelved count.

- [ ] **Step 1: Write the failing smoke checks**

Assert:

```
1. A registry metric with status "absent" appears on the shelf with its reason.
2. A metric below its sampleFloor appears, stating n and what it needs.
3. A metric below its COVERAGE GATE but above the floor does NOT appear — the
   gate policy is unchanged and below-gate still publishes (spec D5).
4. Below floor AND below gate → exactly ONE entry, naming both reasons.
5. No owner name appears anywhere in the shelf HTML (D9).
6. The trust detail is inside a <details> and is collapsed by default.
7. The Little's Law figures in the trust detail are computed from the model, not
   literal — changing the model changes them.
8. No hardcoded editorial: the strings "not credible" and "1 person on leave"
   appear nowhere.
```

- [ ] **Step 2: Run to verify they fail**

```bash
node render-smoke.js
```

- [ ] **Step 3: Write `shelfRows_`**

```js
/**
 * ── THE SHELF ─────────────────────────────────────────────────────────────────
 * "Not measured this week", built from data rather than curated by hand — a
 * hand-written list cannot notice that a metric quietly dropped to two samples
 * and is still sitting on a card looking authoritative.
 *
 * Three sources, in this order, and a metric appears ONCE however many apply:
 *  · registry status "absent"  — no feed exists at all (Cycle Time, CSAT, rework)
 *  · below its sample floor    — nothing to average (spec D5)
 *  · its feed is unavailable   — the tab could not be read this run
 *
 * A metric below its COVERAGE GATE is deliberately NOT here. Below-gate still
 * publishes (CONFIG_DH.SUPPRESS_BELOW_GATE = false, user decision 2026-08-03);
 * the gates band carries that read. Conflating the two would reopen a settled
 * decision by accident.
 *
 * NO OWNER on any row (D9). A standing table of names against failures in the
 * most-read view on the dashboard reads as a blame board, and that is not what
 * gets Jira tagging fixed.
 *
 * @returns {Array<{id, name, why:Array<string>, clears:string}>}
 */
function shelfRows_() {
  var reg = (MODEL.meta.registry || {}).metrics || {};
  var rows = [];
  Object.keys(reg).forEach(function (id) {
    var m = reg[id], why = [];
    if (m.status === "absent") why.push(m.absentReason || "no feed connected");
    var n = metricSampleN_(id);
    if (n !== null) {
      var fl = sampleFloorClient_(id, n);
      if (!fl.ok && fl.need !== null) {
        why.push("resting on " + n + " measurable record" + (n === 1 ? "" : "s") +
                 " — needs " + fl.need);
      }
    }
    if (metricFeedDown_(id)) why.push("its feed could not be read this run");
    if (!why.length) return;
    rows.push({ id: id, name: m.name || id, why: why, clears: shelfClears_(id, m) });
  });
  return rows;
}
```

Write the four small helpers beside it: `metricSampleN_(id)` (null when the metric has no sample notion), `sampleFloorClient_(id, n)` (the client twin of `sampleFloorFor_` — add it to `_test_clientParity_` in Task 17), `metricFeedDown_(id)`, and `shelfClears_(id, m)` returning the one-line "what would clear this".

- [ ] **Step 4: Write the two renderers**

`renderShelf_()` writes a dashed-border list. `renderTrustDetail_()` writes a collapsed `<details>` whose contents are computed: the Little's Law check from `MODEL.queue` and the lead-time buckets, the people-signals reconciliation from `signalSummary_`, and every registry `deviations` string rendered from source.

- [ ] **Step 5: Dispatch and add the markup**

Add `#shelfPanel` and `#trustDetail` to `#viewExec` as the last two children, and both renderers to `renderAll_`.

- [ ] **Step 6: Verify green**

```bash
node render-smoke.js
```

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/Dashboard.html \
        docs/superpowers/delivery-health-dashboard/render-smoke.js
git commit -m "feat(dh): data-driven shelf + computed trust detail

The shelf is built from the registry, the sample floor and feed availability, so
it notices a metric dropping to two samples instead of leaving it on a card
looking authoritative. Below-gate metrics are deliberately absent — that policy
is unchanged and the gates band carries it. No owner on any row (D9).

Trust detail is computed, not prose: the prototype's hardcoded editorial would
have been wrong next month with nothing to notice.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 17: Rewrite the render-smoke checks pinned to the old Executive markup

Budgeted explicitly. The old pane's assertions reference markup that no longer exists; they must be **rewritten to assert the same behaviour against the new markup**, not deleted. A deleted check is a silently dropped guarantee.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js` (`_test_clientParity_`)

- [ ] **Step 1: Inventory what is pinned**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard"
grep -n "kpiStrip\|#tiles\|flowTiles\|tileColorKey\|comparePanel\|pulsePanel\|trustPanel" render-smoke.js
```

Write the list down. For each, name the **behaviour** it guarantees — that is what must survive.

- [ ] **Step 2: Rewrite each against the new markup**

Behaviours that must still be asserted somewhere, per the spec and the README:

```
- the gate policy behaves correctly in BOTH directions (SUPPRESS_BELOW_GATE on and off)
- a stale model prints no delta
- an empty period is not shown as a coverage failure
- no individual is named in the gaps queue or the signals pulse
- cascading option lists still narrow and never silently drop a selection
- the operating-rate maths, including the weekly fallback on Quarter
- chart labelling and gap handling: "no measurable data", never a zero bar
- tab routing and its role gate (exactly exec,actions,access)
- no live render into a retired pane
- oppRows_ exclusions (leave, interns, pre-hire, ramping)
- the signals roster's small-n guard and job-title tag
```

- [ ] **Step 3: Add `sampleFloorClient_` to the parity suite**

In `node-tests.js`'s `_test_clientParity_`, add a walk diffing `sampleFloorClient_` against the server's `sampleFloorFor_` across every registry id and n in `[0,1,4,5,6,50]`. Two copies of a rule that decides whether a number is publishable must be proven identical, exactly as `metricConfidence_` already is.

- [ ] **Step 4: Verify both suites green and the count has grown**

```bash
node node-tests.js
node render-smoke.js
```

Expected: `✅ node-tests: all suites passed`, and render-smoke passing at **more than 648** checks. Fewer than 648 means a guarantee was dropped rather than rewritten — go back to Step 2.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/render-smoke.js \
        docs/superpowers/delivery-health-dashboard/node-tests.js
git commit -m "test(dh): rewrite Executive smoke checks against the new markup

Every check pinned to the old tile/compare/pulse/trust markup is rewritten to
assert the same BEHAVIOUR against the newspaper bands, not deleted — a deleted
check is a silently dropped guarantee. sampleFloorClient_ joins the client-parity
suite: two copies of a rule deciding whether a number may publish have to be
proven identical, like metricConfidence_ already is.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 18: Document that the numbers moved

Approach B makes the hygiene numbers drop **by design**. Without a dated note, the next reader diagnoses a regression.

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/README.md`
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js` (`METRIC_REGISTRY_.changeLog`)

- [ ] **Step 1: Add the registry changeLog entry**

```js
    { date: "2026-08-06", what: "Open-backlog population widened to include unassigned work (Jira Backlog.js v3.11.0, spec 2026-08-06 D7). Measured live: 1,839 unassigned open issues against 1,440 assigned — 56% of the queue had never been exported. The by-type matrix and gaps queue open-half fill rates for due date, estimate, region and team all DROP as a result: unowned tickets are the worst-tagged population on the site. This is previously-hidden hygiene debt becoming visible, not tagging getting worse. Roster join is unaffected because attr gained its own attrN denominator in the same release." },
```

- [ ] **Step 2: Add the README section**

Add a dated subsection under the Executive/navigation material covering: the measured 1,839-vs-1,440 split; that weeks-to-clear read 4.9w assigned-only against 11.0w for the true queue; which surfaces moved and which provably did not; the `attrN` fix and why Roster join stays retired; and that `OPEN_BACKLOG_UPDATED_WEEKS` is the lever if the drop is judged unacceptable — **not** re-hiding the work (spec O4).

- [ ] **Step 3: Correct the stale check count**

The README says render-smoke has 488 checks. Update it to the current number from Task 17's run.

- [ ] **Step 4: Verify the suites still pass**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && node node-tests.js && node render-smoke.js
```

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution"
git add docs/superpowers/delivery-health-dashboard/README.md \
        docs/superpowers/delivery-health-dashboard/Code.js
git commit -m "docs(dh): record that widening the open population moved the hygiene numbers

Without a dated note the next reader diagnoses a regression. Names what moved,
what provably did not, why Roster join stays retired, and that the lever for an
unacceptable drop is OPEN_BACKLOG_UPDATED_WEEKS rather than re-hiding the work.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 19: Deploy

**This is the only task that touches the live app.** Order is not flexible. **Ask the user before starting** — this changes what the C-suite sees.

- [ ] **Step 1: Record the before-state**

Open the live dashboard and write down: On-Time, Forecast, Utilisation, Rework; the Roster join tile (present or retired); and the 🧬 matrix's open-half due/estimate/region/team percentages. **You cannot verify step 7 without this.**

- [ ] **Step 2: Confirm both suites are green**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && node node-tests.js && node render-smoke.js
```

- [ ] **Step 3: Deploy the exporter and run it**

Paste `Jira Backlog.js` into its GAS project, save, and run the export. Watch the log for `📈 Jira Arrivals written: N weeks` and `📋 Open-issues JQL (backlog):` **without** `assignee is not EMPTY`.

- [ ] **Step 4: Verify the sheets**

- `Jira Arrivals` exists with ~52 rows; `Week Start` is a real date, not text; `Created`/`Resolved` are plausible (W31 ≈ 224/204).
- `Flow Snapshots`' newest row carries `Unassigned Items` ≈ 1,839 and a non-zero `Unassigned Hrs`.

**If `Unassigned Items` is 0 or blank, stop** — the assignee clause is still in effect and the rest of the deploy will report a queue less than half its real size.

- [ ] **Step 5: Deploy the app**

Paste `Code.js` and `Dashboard.html` into the Delivery Health GAS project. Confirm `DH_SCHEMA_VER_` is 26.

- [ ] **Step 6: Bust the cache and publish**

Run `bustDeliveryCache_()` in the GAS editor, then create a new deployment version.

- [ ] **Step 7: Spot-check, in two halves**

**Must NOT have moved:**
- the four KPI cards, against Step 1's figures
- the signals roster
- **Roster join: still 100% and still retired from all three surfaces.** If it has reappeared, `attrN` is missing or wrong and the number on screen is false — roll back.
- the per-person backlog drill-down counts

**MUST have moved:**
- ORG hero ≈ 3,279 items / ~11w, against ≈1,440 / ~4.9w on the assigned sub-row
- the 🧬 matrix's open half and the gaps queue: due, estimate, region, team all **down** from Step 1
- the unowned ruler segment drills through to real rows

A number in the wrong half is a stop. The first list moving means something reached the shared population; the second list not moving means the export did not change.

- [ ] **Step 8: Update the memory file**

Update `C:\Users\moise\.claude\projects\D--Contribution\memory\project_delivery_health_dashboard.md` and its `MEMORY.md` pointer with the deployed state, the measured queue figures, and which of O1–O4 remain open.

---

## Self-review

**Spec coverage.** Every section maps to a task: §1.1 probe figures → registry `deviations` (T6) and README (T18); §2 D1–D12 → T1 (D12), T6 (D11), T10 (D7), T11 (D10), T12 (D2), T16 (D9); §3 §1–§9 → T11–T16, with §9's `@import` removal folded into T11–T12 (the new markup simply never adds one); §4.1 → T8–T10; §4.2 → T2–T5, T7; §4.3 → T6; §4.4 → T6; §4.5 → T5; §4.6 → T1, T10, T18; §4.7 → asserted by T17's rewritten gate-policy checks; §5 → the null/absent checks in T11, T12, T14, T16; §6 → T1–T7 unit tests and T11–T17 smoke; §7 → T19; §8 out-of-scope items appear in no task; §9 O1–O4 → carried to memory in T19 Step 8.

**Placeholder scan.** Tasks 1–10 carry complete code. Tasks 11–16 carry complete code for the novel logic (`verdictFindings_`, `shelfRows_`) and, for the render bodies, exact function names, exact insertion points, exact assertions and named existing helpers to reuse — deliberately, because restating `renderTiles_`'s 270 lines would produce a plan nobody reads and a worse result than following the house style already in the file. Every step names the file, the command and the expected output.

**Type consistency.** `attrN` (T1) is consumed by `TYPE_FIELDS_.denom` (T1) and `typeFieldN_` (existing, unchanged). `parseArrivalRows_` returns `{weeks:[{iso,created,resolved,createdUnassigned}], available}` and is consumed by `clearRateMedian_` (`resolved`), `inventoryWalkback_` (`iso,created,resolved`) and `netFlowPerWeek_` — all consistent. `queueSnapshot_` returns `{assigned:{items,wipN,todoN,todoHrs}, unassigned:{items,hrs}}`, matching every consumer in T7, T11 and T12. `sampleFloorFor_` returns `{ok,need,n}`, matching `shelfRows_`'s `fl.ok`/`fl.need` in T16. `shelfRows_` is called by `verdictFindings_` (T11) before it is defined (T16) — both are function declarations, so hoisting handles it, and T11's smoke suite will fail until T16 lands, which is why T16's checks include the shelved-count clause.

**One correction folded in during review:** the spec claimed D12 needed fixes in `hygieneBuckets_`, `TYPE_FIELDS_` and `gapsRowsAll_()` together. Reading the code showed `gapsRowsAll_()`'s `attr` row **already** divides by `resAssigned`, and it is on the resolved half, which B does not touch. So T1's scope is `typeHygieneBuckets_` plus one `denom` key — smaller than specced, and the plan says so rather than inventing work.

---

Plan complete and saved to `docs/superpowers/plans/2026-08-06-dh-executive-newspaper.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
