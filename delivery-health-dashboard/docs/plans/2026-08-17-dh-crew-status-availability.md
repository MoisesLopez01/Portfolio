# Crew Status and Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop benched crew from counting as available delivery capacity, and stop the pool grid calling crew "UNKNOWN".

**Architecture:** A new `p.onBench` person flag, set server-side from roster Employee Status by a token regex, is carved out of both capacity pipelines (Workforce cells → Availability Rate, and Utilization) while the person stays in the population and in the drill-down. The exclusion is printed on the capacity tile the way the on-leave exclusion already is. Separately, a display-only band label renders `CREW|UNKNOWN` as "Crewmembers" without touching the band key.

**Tech Stack:** Google Apps Script (server `Code.js`), vanilla ES5 browser JS in a single `Dashboard.html`, Node-based test harnesses (`tests/delivery-health/node-tests.js` for pure server functions, `tests/delivery-health/render-smoke.js` for rendering).

**Spec:** `delivery-health-dashboard/docs/specs/2026-08-17-dh-crew-status-availability-design.md`

---

## File Structure

| File | Responsibility in this change |
|---|---|
| `delivery-health-dashboard/Code.js` | `dhOnBench_` predicate; `onBench` on the roster person and on both payload emit sites; bench carve in `buildCapacity_`, `dhHeadByCell_`, `utilRollup_`; `DH_SCHEMA_VER_` bump |
| `delivery-health-dashboard/Dashboard.html` | bench carve in `utilFor_`, `planFor_`, `wfSellable_`; ⏸ badge; `on the bench` hours cell; roster-detail ineligibility; capacity-tile exclusion count; `wfBandLabel_` |
| `tests/delivery-health/node-tests.js` | server suites: the seven-status table, the two near-misses, the capacity/head carve |
| `tests/delivery-health/render-smoke.js` | client suites: badge, hours cell, `wfSellable_`, exclusion count, band label scoping |

No new files. Both production files are large and single-purpose by house convention; splitting them is out of scope for this change.

**Run the suites from `D:\Contribution\tests\delivery-health`:**

```bash
node node-tests.js
node render-smoke.js
```

---

## Task 1: `dhOnBench_` predicate

**Files:**
- Modify: `delivery-health-dashboard/Code.js` (immediately after `dhOnLeave_`, ~line 3493)
- Test: `tests/delivery-health/node-tests.js` (new IIFE suite, appended before the final `console.log`)

- [ ] **Step 1: Write the failing test**

Append this immediately **before** the final `console.log("✅ node-tests: all suites passed");` line in `tests/delivery-health/node-tests.js`:

```js
// ── CREW EMPLOYMENT STATUS (spec 2026-08-17) ────────────────────────────────
// The seven roster values, each asserted for the population verdict it must
// produce. The four already-correct exclusions are pinned here too: they hold
// today by substring match against DH_TERMINATED_, and a future edit that
// loosens any token would empty the roster silently.
(function _test_crewStatus_() {
  var checked = 0;
  function assert_(c, m) { if (!c) throw new Error("❌ _test_crewStatus_: " + m); checked++; }

  // [status, expected active, expected onBench]
  [["Terminated",                       false, false],
   ["Terminated - Mobility Relocation", false, false],
   ["Job Offer Accepted",               false, false],
   ["Crew - Offboarded",                false, false],
   ["Actively Employed",                true,  false],
   ["Crew - Deployed",                  true,  false],
   ["Crew - On the Bench",              true,  true]].forEach(function (row) {
    var status = row[0], wantActive = row[1], wantBench = row[2];
    assert_(dhRosterRowActive_(status, "") === wantActive,
            '"' + status + '" active should be ' + wantActive);
    assert_(dhOnBench_(status) === wantBench,
            '"' + status + '" onBench should be ' + wantBench);
  });

  // ── The two near-misses, named individually ──────────────────────────────
  // Both survive by accident of substring. Loosening `inactive` to `activ`, or
  // adding a `ploy`/`deploy` token, silently empties the population — and an
  // empty population renders as a dashboard with no problems.
  assert_(dhRosterRowActive_("Actively Employed", "") === true,
          "'Actively Employed' must not match the `inactive` token");
  assert_(dhRosterRowActive_("Crew - Deployed", "") === true,
          "'Crew - Deployed' must not match any terminated token");

  // A terminated row can never acquire a bench flag on its way out: dhOnBench_
  // gates on dhRosterRowActive_ first, exactly as dhOnLeave_ does.
  assert_(dhOnBench_("Crew - On the Bench") === true, "an active bench row flags");
  assert_(dhRosterRowActive_("Crew - On the Bench", "2026-06-30") === false,
          "a bench row WITH a termination date is not active");

  // Bench is not leave. Separable in the payload, because they have different
  // owners and different fixes.
  assert_(dhOnLeave_("Crew - On the Bench") === false, "bench does not read as leave");
  assert_(dhOnBench_("Maternity Leave") === false, "leave does not read as bench");
  assert_(dhOnBench_("") === false, "a blank status is neither");

  Logger.log("✅ _test_crewStatus_ passed (" + checked + " status assertions)");
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `ReferenceError: dhOnBench_ is not defined`

- [ ] **Step 3: Write minimal implementation**

In `delivery-health-dashboard/Code.js`, insert immediately after the closing brace of `dhOnLeave_` (~line 3493):

```js
/**
 * Bench detector on roster Employee Status — crew between engagements.
 *
 * A benched contractor is ACTIVE on the roster and NOT contracted to deliver.
 * They stay in the population (a resourcing lead needs to see the bench) but
 * leave every figure that divides by capacity, because their hours are not
 * sellable. See the spec for why "on the bench" is treated as unavailable
 * despite the usual reading of the phrase — it is a commercial statement, not
 * a scheduling one, and it is the user's explicit instruction (2026-08-17).
 *
 * NOT folded into dhOnLeave_ despite the identical carve. Leave is an absence
 * with a return date and an HR owner; bench is a commercial gap with a
 * resourcing owner. Merged, the two could not be told apart again without
 * re-reading the roster — and the 🏖 badge would paint a holiday marker on a
 * contractor who wants to be working.
 *
 * \b word boundaries: the token is short enough to appear inside an unrelated
 * free-text status, and a false positive here deletes a real person's capacity.
 */
var DH_BENCH_RE_ = /\bbench\b/i;
function dhOnBench_(status) {
  var s = String(status || "");
  return dhRosterRowActive_(s, "") && DH_BENCH_RE_.test(s);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: a `✅ _test_crewStatus_ passed (N status assertions)` line, then `✅ node-tests: all suites passed`

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Code.js tests/delivery-health/node-tests.js
git commit -m "feat(delivery-health): dhOnBench_ predicate for crew between engagements"
```

---

## Task 2: Carry `onBench` onto the person and into the payload

**Files:**
- Modify: `delivery-health-dashboard/Code.js:3626` (roster person build), `:6117` (payload emit), `:6272` (attribOnly stub)
- Test: `tests/delivery-health/node-tests.js` (extend the `_test_crewStatus_` suite from Task 1)

- [ ] **Step 1: Write the failing test**

Add these lines inside `_test_crewStatus_`, immediately before its closing `Logger.log(...)`:

```js
  // The flag must survive onto the person record, and a stub must carry it as
  // an explicit false — never undefined. Downstream carves test `=== true`,
  // but the exclusion COUNT on the capacity tile is truthiness-based, and an
  // undefined there would read as "not benched" only by luck.
  var built = dhBuildPersonFlags_("Crew - On the Bench");
  assert_(built.onBench === true, "a benched status builds onBench true");
  assert_(built.onLeave === false, "…and onLeave stays false");
  assert_(built.benchStatus === "Crew - On the Bench", "…and the raw status is carried for the tooltip");
  var plain = dhBuildPersonFlags_("Actively Employed");
  assert_(plain.onBench === false, "an active status builds onBench false, not undefined");
  assert_(plain.benchStatus === "", "…and carries no bench status string");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `ReferenceError: dhBuildPersonFlags_ is not defined`

- [ ] **Step 3: Write minimal implementation**

**3a.** In `Code.js`, immediately after `dhOnBench_` (from Task 1), add the shared builder:

```js
/**
 * The leave/bench flag pair for one roster Employee Status, built once.
 *
 * Extracted so the roster read and the tests agree by construction rather than
 * by two copies of the same three expressions — the roster row previously
 * called dhOnLeave_ twice on the same string to derive the flag and its label.
 */
function dhBuildPersonFlags_(status) {
  var onLeave = dhOnLeave_(status);
  var onBench = dhOnBench_(status);
  return {
    onLeave: onLeave,
    leaveStatus: onLeave ? String(status).trim() : "",
    onBench: onBench,
    benchStatus: onBench ? String(status).trim() : "",
  };
}
```

**3b.** In `Code.js:3626`, replace these two lines inside the `out.push({...})` in `readRosterPeople_`:

```js
                   onLeave: dhOnLeave_(status),
                   leaveStatus: dhOnLeave_(status) ? String(status).trim() : "",
```

with:

```js
                   flags: dhBuildPersonFlags_(status),
```

…and update the object spread below it. Since Apps Script has no object spread, assign after construction instead. Replace the whole `out.push({ ... });` call with:

```js
        var flags_ = dhBuildPersonFlags_(status);
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew,
                   jobFamily: fam, tracks: dhTracksTime_(fam),
                   jobTitle: iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim(),
                   onLeave: flags_.onLeave,
                   leaveStatus: flags_.leaveStatus,
                   onBench: flags_.onBench,
                   benchStatus: flags_.benchStatus,
                   hireDate: iHire === -1 ? null : parseDhDate_(raw[r][iHire]) });
```

**3c.** In `Code.js:6117`, in the model person emit, replace:

```js
             onLeave: p.onLeave === true, leaveStatus: p.leaveStatus || "",
```

with:

```js
             onLeave: p.onLeave === true, leaveStatus: p.leaveStatus || "",
             // Crew between engagements (spec 2026-08-17). Explicit === true so
             // an older roster read that never set the field cannot arrive as
             // undefined and be treated as a third state downstream.
             onBench: p.onBench === true, benchStatus: p.benchStatus || "",
```

**3d.** In `Code.js:6272`, in the attribOnly stub, replace:

```js
                  onLeave: false, leaveStatus: "",
```

with:

```js
                  onLeave: false, leaveStatus: "",
                  // A stub is an attribution shell, never a live roster row —
                  // it carries no capacity to carve, so both flags are false by
                  // construction rather than by lookup.
                  onBench: false, benchStatus: "",
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `✅ _test_crewStatus_ passed (N status assertions)` with N higher than the previous task, then `✅ node-tests: all suites passed`

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Code.js tests/delivery-health/node-tests.js
git commit -m "feat(delivery-health): carry onBench from roster status onto the person payload"
```

---

## Task 3: Carve bench from Workforce capacity and headcount

This is the load-bearing task. `wfAvailability_` derives entirely from the folded cells, so Availability Rate is fixed here or not at all.

**Files:**
- Modify: `delivery-health-dashboard/Code.js:4449` (`buildCapacity_`), `:4469` (`dhHeadByCell_`)
- Test: `tests/delivery-health/node-tests.js` (new IIFE suite)

- [ ] **Step 1: Write the failing test**

Append before the final `console.log` in `tests/delivery-health/node-tests.js`:

```js
// ── BENCH LEAVES THE WORKFORCE DENOMINATOR (spec 2026-08-17) ────────────────
// buildCapacity_ and dhHeadByCell_ are the pair wfAvailability_ folds, so this
// is where "available to support" is actually decided. A client-only carve
// would leave the rate wrong while every badge looked right.
(function _test_benchCapacityCarve_() {
  var checked = 0;
  function assert_(c, m) { if (!c) throw new Error("❌ _test_benchCapacityCarve_: " + m); checked++; }

  var ISOS = ["2026.W30", "2026.W31"];
  function person(name, onBench) {
    return { name: name, cell: "CREW|UNKNOWN", onBench: onBench, attribOnly: false,
             weeks: { "2026.W30": { cap: 40, planned: 10, trackedOff: 0 },
                      "2026.W31": { cap: 40, planned: 10, trackedOff: 0 } } };
  }
  var people = [person("Deployed Dana", false), person("Bench Bruno", true)];

  var weekly = buildCapacity_(people, ISOS, {});
  var cell = weekly["CREW|UNKNOWN"];
  assert_(cell["2026.W30"].grossHrs === 40,
          "only the deployed person's 40h reaches the cell — got " + cell["2026.W30"].grossHrs);
  assert_(cell["2026.W31"].grossHrs === 40, "…in every iso of the period");

  var heads = dhHeadByCell_(people);
  assert_(heads["CREW|UNKNOWN"] === 1,
          "headcount counts the deployed person only — got " + heads["CREW|UNKNOWN"]);

  // Committed hours follow capacity: a benched person has no capacity in the
  // denominator, so their plan must not sit in the numerator either. Leaving it
  // would push commitment fidelity above 100% on any benched cell.
  var withCommit = buildCommitment_(people, ISOS, buildCapacity_(people, ISOS, {}));
  assert_(withCommit["CREW|UNKNOWN"]["2026.W30"].committedHrs === 10,
          "committed hours exclude the benched person too — got " +
          withCommit["CREW|UNKNOWN"]["2026.W30"].committedHrs);

  // An all-benched cell disappears from the fold rather than reporting 0h for
  // people who exist: zero capacity and no capacity are different claims.
  var allBench = [person("Bench One", true), person("Bench Two", true)];
  var emptyWeekly = buildCapacity_(allBench, ISOS, {});
  assert_(!emptyWeekly["CREW|UNKNOWN"] ||
          emptyWeekly["CREW|UNKNOWN"]["2026.W30"].grossHrs === 0,
          "a fully benched cell contributes no hours");
  assert_((dhHeadByCell_(allBench)["CREW|UNKNOWN"] || 0) === 0,
          "…and no heads");

  // attribOnly still wins — a stub was never capacity to begin with.
  var stub = person("Stub Sam", false);
  stub.attribOnly = true;
  assert_((dhHeadByCell_([stub])["CREW|UNKNOWN"] || 0) === 0,
          "attribOnly stubs stay out, unchanged by this carve");

  Logger.log("✅ _test_benchCapacityCarve_ passed (" + checked + " assertions)");
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `❌ _test_benchCapacityCarve_: only the deployed person's 40h reaches the cell — got 80`

- [ ] **Step 3: Write minimal implementation**

**3a.** In `Code.js:4449`, in `buildCapacity_`, add the carve directly after the `attribOnly` guard:

```js
    if (p.attribOnly) return;
    // Benched crew are active people with scheduled hours and no engagement to
    // spend them on (spec 2026-08-17). Their capacity must not reach the cell:
    // wfAvailability_ folds these hours into "who can take this work", and a
    // bench in the denominator answers that question wrong in the optimistic
    // direction. They keep their roster row and their drill-down row — what
    // they leave is every figure that divides by capacity.
    if (p.onBench === true) return;
```

**3b.** In `Code.js:4469`, in `dhHeadByCell_`, add the same guard after `attribOnly`:

```js
    if (p.attribOnly) return;
    if (p.onBench === true) return;   // no capacity in the cell ⇒ not a head in it
```

**3c.** In `Code.js`, in `buildCommitment_` (~line 4501), add the same guard after `attribOnly`:

```js
    if (p.attribOnly) return;
    // Follows the capacity carve above: a person outside the denominator must
    // not sit in the numerator, or commitment fidelity exceeds 100% on any
    // benched cell.
    if (p.onBench === true) return;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: a `✅ _test_benchCapacityCarve_ passed (N assertions)` line, then `✅ node-tests: all suites passed`

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Code.js tests/delivery-health/node-tests.js
git commit -m "fix(delivery-health): benched crew leave the workforce capacity denominator"
```

---

## Task 4: Carve bench from the Utilization pipeline

**Files:**
- Modify: `delivery-health-dashboard/Code.js:1435` (`utilRollup_`)
- Modify: `delivery-health-dashboard/Dashboard.html:2460` (`utilFor_`), `:2459` (`planFor_`)
- Test: `tests/delivery-health/node-tests.js` (extend `_test_benchCapacityCarve_`)

- [ ] **Step 1: Write the failing test**

Add inside `_test_benchCapacityCarve_`, before its closing `Logger.log(...)`:

```js
  // The OTHER capacity pipeline. utilRollup_ already drops on-leave; bench
  // joins it there for the same reason and by the same mechanism.
  function utilPerson(name, onBench) {
    return { name: name, region: "AMER", teams: [], tracks: true, onBench: onBench,
             onLeave: false, isIntern: false,
             weeks: { "2026.W30": { avail: 40, availCov: 40, billable: 30, tracked: 35, planned: 20 } } };
  }
  var uRoll = utilRollup_([utilPerson("Deployed Dana", false), utilPerson("Bench Bruno", true)],
                          "2026.W30", null, null, false);
  assert_(uRoll.avail === 40,
          "utilRollup_ counts the deployed person's availability only — got " + uRoll.avail);
  assert_(uRoll.billable === 30,
          "…and their billable hours only — got " + uRoll.billable);
  // Guard against over-carving: the flag must not be read as truthy-by-absence.
  // A person with no onBench field at all is NOT benched.
  var legacy = utilPerson("Legacy Payload", false);
  delete legacy.onBench;
  assert_(utilRollup_([legacy], "2026.W30", null, null, false).avail === 40,
          "a person record with no onBench field still counts — absence is not bench");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `❌ _test_benchCapacityCarve_: utilRollup_ counts the deployed person's availability only — got 80`

- [ ] **Step 3: Write minimal implementation**

**3a.** In `Code.js:1435`, in `utilRollup_`, add after the `onLeave` guard:

```js
    if (p.onLeave === true) return;
    // Crew between engagements — same carve as leave, different reason: their
    // scheduled hours are not sellable, so counting them reports capacity we
    // cannot offer (spec 2026-08-17).
    if (p.onBench === true) return;
```

**3b.** In `Dashboard.html:2460`, in `utilFor_`, add after the `onLeave` guard:

```js
    if (p.onLeave) return;
    if (p.onBench) return;   // crew between engagements — hours are not sellable
```

**3c.** In `Dashboard.html:2459`, in `planFor_`, extend the existing guard:

```js
    if (p.onLeave || p.onBench || p.isIntern || p.attribOnly) return;
```

**3d.** In `Dashboard.html:5987`, in `oppRows_` (the per-person recoverable-hours opportunity that feeds the 👥 pulse), extend the existing guard:

```js
    if (p.onLeave) return null;
    // A benched person's idle hours are not an opportunity to recover — there is
    // no engagement to recover them into. Same reasoning as the on-leave carve
    // above, and the same reasoning that keeps ramping new hires out of the
    // pulse total.
    if (p.onBench) return null;
```

**3e.** In `Dashboard.html:6521`, in the roster Hours sort comparator, extend the ineligibility test so benched people sort last alongside new hires and on-leave:

```js
      if (r.p.newHire === true || r.p.onLeave === true || r.p.onBench === true) return null;   // ineligible → last
```

**3f.** In `Code.js`, update the `utilRollup_` JSDoc so the two exclusions are both documented. Replace the sentence beginning `People on long leave (p.onLeave — roster Employee Status) are ALWAYS excluded` with:

```
 * People on long leave (p.onLeave) and benched crew (p.onBench) are ALWAYS
 * excluded, no include flag. Both carry capacity rows with avail > 0 that
 * nobody can sell — Tempo schedules lag HR for leave, and a benched contractor
 * is scheduled against a contract they are not currently working. Counting
 * either drags the rate down for an employment status, not a performance
 * signal. They are separate flags because they have separate owners.
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js && node render-smoke.js
```

Expected: `✅ node-tests: all suites passed`, and `render-smoke.js` still passes with its check total unchanged (this task adds no client assertions)

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Code.js delivery-health-dashboard/Dashboard.html tests/delivery-health/node-tests.js
git commit -m "fix(delivery-health): benched crew leave the utilization and planning rollups"
```

---

## Task 5: The ⏸ badge and the `on the bench` hours cell

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html` — `personStateBadges_` (~8716), `planCellHtml_` (~2499), `wfSellable_` (~7395), roster-detail eligibility (~8678, ~8703)
- Test: `tests/delivery-health/render-smoke.js` (new IIFE suite)

- [ ] **Step 1: Write the failing test**

Append to `tests/delivery-health/render-smoke.js`, immediately **before** the final `console.log("✅ render-smoke: " + checks + " checks passed");`:

```js
// ══════════════════════════════════════════════════════════════════════════
// BENCHED CREW ARE VISIBLE, AND OUT OF EVERY CAPACITY FIGURE
// (spec 2026-08-17)
//
// The point of this feature is a person who STAYS on screen while leaving the
// denominators. So the checks come in pairs: still rendered, still not counted.
// A test that only asserted the carve would pass on a change that deleted them.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var benched = person("Bruno Bench", { region: "AMER" });
  benched.onBench = true;
  benched.benchStatus = "Crew - On the Bench";
  var active = person("Dana Deployed", { region: "AMER" });

  // ── 1. The badge says what they are, and it is not the leave badge ───────
  var badges = C.personStateBadges_(benched);
  assert_(/⏸/.test(badges), "a benched person carries the ⏸ badge");
  assert_(!/🏖/.test(badges), "…and NOT the on-leave badge — bench is not leave");
  assert_(/between engagements/i.test(badges),
          "…and the tooltip says what bench means, not just that it is set");
  assert_(!/⏸/.test(C.personStateBadges_(active)), "an active person carries no bench badge");

  // ── 2. The hours cell reads a state, never a zero ────────────────────────
  // Nobody is "0h available" in a week they are not contracted for. Same rule
  // the on-leave cell already follows.
  var cell = C.planCellHtml_(benched, ["2026.W31"]);
  assert_(/on the bench/.test(cell), "the hours cell reads 'on the bench'");
  assert_(!/>0%|>0h/.test(cell), "…and never renders a zero for them");

  // ── 3. Out of the sellable subtotal ──────────────────────────────────────
  assert_(C.wfSellable_(benched) === false, "a benched person is not sellable capacity");
  assert_(C.wfSellable_(active) === true, "…while an active one is");

  // ── 4. Bench and leave stay separable ────────────────────────────────────
  // Merged flags would be a one-way door: you cannot recover which was which.
  var leaver = person("Lena Leave", { region: "AMER" });
  leaver.onLeave = true;
  assert_(C.wfSellable_(leaver) === false, "on-leave is still carved, unchanged");
  assert_(/🏖/.test(C.personStateBadges_(leaver)) && !/⏸/.test(C.personStateBadges_(leaver)),
          "an on-leave person carries 🏖 and not ⏸");
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `❌ render-smoke: a benched person carries the ⏸ badge`

- [ ] **Step 3: Write minimal implementation**

**3a.** In `Dashboard.html`, in `personStateBadges_` (~8716), add after the `onLeave` block and before `return out;`:

```js
  if (p.onBench === true) {
    out += '<span class="stateBadge" title="' +
      esc_(p.benchStatus || "Crew - On the Bench") +
      ' — crew between engagements, not contracted to deliver right now. Hours are ' +
      'excluded from every availability figure; the person stays on the roster because ' +
      'a bench is something to act on, not something to hide.">⏸</span>';
  }
```

**3b.** In `Dashboard.html`, in `planCellHtml_` (~2499), add immediately after the `onLeave` line:

```js
  if (p.onLeave) return '<td class="tnum"><span class="cellSub">on leave</span></td>';
  if (p.onBench) return '<td class="tnum"><span class="cellSub">on the bench</span></td>';
```

**3c.** In `Dashboard.html:7395`, replace `wfSellable_` in full:

```js
/** Is this person's spare capacity sellable? Ramping new hires, people on long
    leave and benched crew are shown WITH their hours — hiding them would make a
    team look smaller than it is — but they stay out of the sellable subtotal,
    the same carve the recoverable-hours pulse and the roster's Hours sort
    already apply. Bench is listed separately from leave on purpose: the two
    have different owners and different fixes. */
function wfSellable_(p) {
  return p.newHire !== true && p.onLeave !== true && p.onBench !== true;
}
```

**3d.** In `Dashboard.html:8678`, extend the roster-detail eligibility test:

```js
  var ineligible = p.newHire === true || p.onLeave === true || p.onBench === true || p.isIntern === true;
```

**3e.** In `Dashboard.html:8703`, extend the label chain so the reason is named:

```js
      (p.onLeave ? "on leave" : p.onBench ? "on the bench" : p.isIntern ? "in training" : "ramping") + "</span>" : "");
```

**3f.** The bridge already exports `personStateBadges_` and `wfSellable_`; only `planCellHtml_` is missing. In `tests/delivery-health/render-smoke.js`, find the bridge string and add one entry after the `capacityTileHtml_` line:

```js
             " planCellHtml_: planCellHtml_," +
```

Do not re-add the other two — a duplicate key is legal JS but makes the bridge lie about what it exports.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `✅ render-smoke: N checks passed`, N higher than before this task

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "feat(delivery-health): bench badge, hours-cell state and sellable carve"
```

---

## Task 6: State the exclusion on the capacity tile

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html:4517-4522`
- Test: `tests/delivery-health/render-smoke.js` (extend the Task 5 suite)

- [ ] **Step 1: Write the failing test**

Add inside the Task 5 IIFE, before its closing `})();`:

```js
  // ── 5. The exclusion is stated, never silent ─────────────────────────────
  // A denominator that quietly got smaller is how a rate comes to read better
  // than the workforce behind it. The on-leave line already does this; bench
  // gets the same treatment on the same line.
  var mBench = model({});
  mBench.people = [person("Dana Deployed", { region: "AMER" }),
                   person("Bruno Bench", { region: "AMER" }),
                   person("Bianca Bench", { region: "AMER" })];
  mBench.people[1].onBench = true;
  mBench.people[2].onBench = true;
  fresh(mBench);
  var capTile = withUtilization_(function () { return C.capacityTileHtml_(); });
  assert_(/2 on the bench excluded/.test(capTile),
          "the capacity tile names how many benched people left the rate");
  assert_(!/1 on the bench/.test(capTile.replace(/2 on the bench/g, "")),
          "…with the count under the active filters, not a hardcoded number");

  // With nobody benched the sentence leaves with its subject — an exclusion
  // note for an empty exclusion trains readers to ignore the note.
  var mClean = model({});
  mClean.people = [person("Dana Deployed", { region: "AMER" })];
  fresh(mClean);
  assert_(!/on the bench excluded/.test(withUtilization_(function () { return C.capacityTileHtml_(); })),
          "no benched people, no exclusion line");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `❌ render-smoke: the capacity tile names how many benched people left the rate`

- [ ] **Step 3: Write minimal implementation**

In `Dashboard.html`, immediately after the `onLeaveN` block (ends ~4522) and before the `internN` block:

```js
  // Crew between engagements (spec 2026-08-17). Stated on the same line and in
  // the same grammar as the on-leave exclusion above: both are named, or
  // neither is trustworthy.
  var onBenchN = MODEL.people.filter(function (p) {
    return p.onBench && passesFilters_(p);
  }).length;
  if (onBenchN) {
    utilCmp += ' · <span title="Crew between engagements (roster Employee Status) — not contracted to deliver, so their scheduled hours are excluded from this rate. They stay on the People roster, marked ⏸.">' +
      onBenchN + " on the bench excluded</span>";
  }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `✅ render-smoke: N checks passed`, N higher than before this task

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "feat(delivery-health): capacity tile states the bench exclusion count"
```

---

## Task 7: `CREW / UNKNOWN` renders as `Crewmembers`

**Files:**
- Modify: `delivery-health-dashboard/Dashboard.html` — new `wfBandLabel_` beside `WF_BAND_DESC_` (~7132), used in `renderWfGrid_` (~7557)
- Test: `tests/delivery-health/render-smoke.js` (new IIFE suite)

- [ ] **Step 1: Write the failing test**

Append to `tests/delivery-health/render-smoke.js`, before the final `console.log`:

```js
// ══════════════════════════════════════════════════════════════════════════
// "UNKNOWN" MEANS TWO DIFFERENT THINGS, SO IT GETS TWO DIFFERENT LABELS
// (spec 2026-08-17)
//
// For an FTE, an unparseable level is a data-quality gap somebody should close.
// For crew it is the designed state — they are hired against a contract, not a
// level. One word for both taught the reader to ignore it.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  assert_(C.wfBandLabel_("CREW", "UNKNOWN") === "Crewmembers",
          "an unlevelled CREW band reads as Crewmembers");
  assert_(C.wfBandLabel_("PS-CONSULT", "UNKNOWN") === "UNKNOWN",
          "…while an unlevelled FTE band still reads UNKNOWN — there it is a real gap");
  assert_(C.wfBandLabel_("CREW", "CORE") === "CORE",
          "a crew member WITH a parseable level keeps their band");
  assert_(C.wfBandLabel_("CREW", "SENIOR") === "SENIOR", "…at every level");

  // The KEY is untouched. Sorting, p.cell, the level filter and every bucket
  // join still operate on "UNKNOWN" — this is a label, not a rename.
  assert_(C.WF_BAND_ORDER_.indexOf("UNKNOWN") !== -1,
          "the band ORDER still keys on UNKNOWN — the rename is display-only");
  assert_(C.WF_BAND_ORDER_.indexOf("Crewmembers") === -1,
          "…and the display word never leaks into the key vocabulary");
})();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `TypeError: C.wfBandLabel_ is not a function`

- [ ] **Step 3: Write minimal implementation**

**3a.** In `Dashboard.html`, immediately after the `WF_BAND_DESC_` object (~7138):

```js
/**
 * Band label for the pool grid.
 *
 * "UNKNOWN" is a real data-quality signal for an FTE — a job title the
 * classifier could not read, which is a gap somebody should close. For CREW it
 * is the designed state: they are hired against a contract, not a level, which
 * WF_BAND_DESC_.UNKNOWN has said in its tooltip since the band was added. One
 * word for both conditions taught readers to skip it in the case where it
 * mattered.
 *
 * DISPLAY ONLY. The band KEY stays "UNKNOWN" everywhere — WF_BAND_ORDER_
 * sorting, p.cell, dimMatch_(p, "level", …) and every bucket join. Renaming the
 * key would silently repartition the grid.
 */
function wfBandLabel_(pool, band) {
  return (pool === "CREW" && band === "UNKNOWN") ? "Crewmembers" : band;
}
```

**3b.** In `Dashboard.html`, in `renderWfGrid_` (~7557), replace:

```js
          esc_(c.band) + (bd.range && bd.range !== "—"
```

with:

```js
          esc_(wfBandLabel_(c.pool, c.band)) + (bd.range && bd.range !== "—"
```

**3c.** In `tests/delivery-health/render-smoke.js`, add to the bridge string:

```js
             " wfBandLabel_: wfBandLabel_, WF_BAND_ORDER_: WF_BAND_ORDER_," +
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node render-smoke.js
```

Expected: `✅ render-smoke: N checks passed`, N higher than before this task

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Dashboard.html tests/delivery-health/render-smoke.js
git commit -m "feat(delivery-health): unlevelled CREW band renders as Crewmembers"
```

---

## Task 8: Schema bump and cache bust

A cached v42 model still carries people with no `onBench` field, so every carve above reads `undefined` and lets benched crew back into the denominators. The schema bump is what forces the rebuild.

**Files:**
- Modify: `delivery-health-dashboard/Code.js:6681` (`DH_SCHEMA_VER_`)
- Test: `tests/delivery-health/node-tests.js` (extend `_test_crewStatus_`)

- [ ] **Step 1: Write the failing test**

Add inside `_test_crewStatus_`, before its closing `Logger.log(...)`:

```js
  // The payload gained a field, so the cached-model contract changed. Without
  // the bump a warm v42 entry serves people with onBench === undefined, every
  // `=== true` carve reads false, and benched crew silently return to the
  // availability denominator — the exact bug this change exists to fix.
  assert_(DH_SCHEMA_VER_ >= 43,
          "DH_SCHEMA_VER_ must be bumped past 42 — onBench is a new payload field");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js
```

Expected: `❌ _test_crewStatus_: DH_SCHEMA_VER_ must be bumped past 42 — onBench is a new payload field`

- [ ] **Step 3: Write minimal implementation**

In `Code.js:6681`:

```js
var DH_SCHEMA_VER_ = 43;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd D:\Contribution\tests\delivery-health && node node-tests.js && node render-smoke.js
```

Expected: `✅ node-tests: all suites passed` and `✅ render-smoke: N checks passed`

- [ ] **Step 5: Commit**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Code.js tests/delivery-health/node-tests.js
git commit -m "chore(delivery-health): schema 42 -> 43 for the onBench payload field"
```

---

## Task 9: Visual verification

Tests are blind to layout. The badge, the hours cell and the band label all have to be *seen*.

**Files:** none modified — this task produces screenshots.

- [ ] **Step 1: Build the preview harness**

From `D:\Contribution\tests\delivery-health`, dump a fixture model and inject it into a standalone copy of the dashboard:

```bash
cd D:\Contribution\tests\delivery-health
sed 's|^console.log("✅ render-smoke: " + checks + " checks passed");|require("fs").writeFileSync(process.env.OUT_MODEL, JSON.stringify(model({})));|' render-smoke.js > dump-tmp.js
OUT_MODEL=fixture.json node dump-tmp.js
rm -f dump-tmp.js
```

- [ ] **Step 2: Build the preview page**

Save as `tests/delivery-health/build-preview.js` and run `node build-preview.js`:

```js
// Standalone preview: fixture + a google.script.run stub injected into a copy of
// Dashboard.html, so the page renders in headless Chrome with no GAS backend.
var fs = require("fs");
var html = fs.readFileSync("../../delivery-health-dashboard/Dashboard.html", "utf8");
var model = JSON.parse(fs.readFileSync("fixture.json", "utf8"));

model.viewerRole = "admin";
model.viewerSuper = true;
// Recent, or MODEL._stale suppresses every trend and hides what we came to see.
model.meta.generatedAt = new Date().toISOString();

// Two benched crew and one deployed, all in the unlevelled CREW cell — enough
// to exercise the badge, the hours cell, the exclusion count (N must read 2)
// and the Crewmembers band label in one shot.
model.people.slice(0, 3).forEach(function (p, i) {
  p.cell = "CREW|UNKNOWN"; p.pool = "CREW"; p.band = "UNKNOWN";
  p.onBench = i < 2;
  p.benchStatus = i < 2 ? "Crew - On the Bench" : "";
});

var stub =
  "<script>window.google={script:{run:(function(){var h=null;var api={" +
  "withSuccessHandler:function(f){h=f;return api;}," +
  "withFailureHandler:function(){return api;}," +
  "getDeliveryData:function(){setTimeout(function(){h(PREVIEW_MODEL_);},0);return api;}" +
  "};return api;})()}};" +
  "var PREVIEW_MODEL_=" + JSON.stringify(model) + ";<\/script>";

var i = html.indexOf("<script>");
fs.writeFileSync("preview.html", html.slice(0, i) + stub + html.slice(i));
console.log("preview.html written");
```

The `<\/script>` escape above is correct **because it sits inside a JS string literal**. If you ever inject from Python or a shell heredoc instead, write a plain `</script>` — the backslash form leaves the tag unclosed there and the injected code silently never runs.

- [ ] **Step 3: Screenshot the Workforce tab**

```bash
cd D:\Contribution\tests\delivery-health
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless --disable-gpu \
  --hide-scrollbars --force-prefers-reduced-motion --virtual-time-budget=9000 \
  --force-device-scale-factor=2 --window-size=1500,1400 \
  --screenshot=workforce.png "file:///D:/Contribution/tests/delivery-health/preview.html"
```

`--force-prefers-reduced-motion` is **mandatory**: `countUpTiles_` animates every `.big` from 0 over 700ms and headless Chrome captures mid-count, so an un-flagged shot shows a partial value in every hero number and looks exactly like a real cross-tab disagreement.

- [ ] **Step 4: Check the four things tests cannot see**

1. The ⏸ badge renders beside the name and is visually distinct from 🏖.
2. The hours cell reads `on the bench`, not a dash or a zero.
3. The capacity tile's exclusion line reads `N on the bench excluded` and does not wrap awkwardly beside the on-leave and intern lines.
4. The pool grid's crew row reads **Crewmembers** and its level-range column is empty rather than showing a stray em dash.

- [ ] **Step 5: Commit any fixes**

```bash
cd D:\Contribution
git add delivery-health-dashboard/Dashboard.html
git commit -m "fix(delivery-health): bench presentation fixes found by screenshot"
```

(Skip this step if the screenshots were clean.)

---

## Deploy

Not a task — a handoff checklist for whoever ships this.

1. Paste `Code.js` and `Dashboard.html` into the GAS project. **`node-tests.js` and `render-smoke.js` must never be pasted in** — they use `require` and fail on their first line in Apps Script.
2. Run `bustDeliveryCache_()` in the GAS editor. The schema bump alone is not sufficient — a warm cache entry must be stranded explicitly.
3. Reload the dashboard and **expect Availability Rate to fall.** That is the fix landing, not a regression.
4. Record the before/after availability figure in the GTT-605 status comment, so the size of the correction is on the record and nobody later "restores" it.
