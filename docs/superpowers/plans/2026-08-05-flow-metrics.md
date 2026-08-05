# Flow Metrics View (🌊 Flow tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 🌊 Flow tab to the Delivery Health Dashboard with 5 live flow metrics (Lead Time, Throughput, Backlog, WIP, Bug Count) and 2 declared-absent tiles (Cycle Time, Flow Efficiency), fed by two small additions to `Jira Backlog.js` (v3.9.0): a `Jira Bugs` tab and a `Flow Snapshots` append log. Changelog stays frozen (`FETCH_CHANGELOG: false` untouched).

**Spec:** `docs/superpowers/specs/2026-08-05-flow-metrics-design.md` (approved 2026-08-05). Read it first — decisions D1–D6 are locked.

**Architecture:** The exporter ships facts, never metrics: it gains one Bug-scoped JQL fetch and a per-run WIP/backlog snapshot row (snapshots exist only because history can't be reconstructed later). The dashboard derives everything else from existing `Jira Raw` columns via new pure bucket builders (same shape as `onTimeBuckets_`/`reworkBuckets_`), registers 5 live + 2 absent metrics in `METRIC_REGISTRY_`, and renders a new all-roles view from the `VIEWS` array. All flow metrics are **non-epic grain**, `target: null` (neutral tiles, no RAG).

**Tech Stack:** Google Apps Script (ES5-style JS), Google Sheets, Node for local tests (`node node-tests.js`, `node render-smoke.js`). No libraries.

**One deliberate deviation from the spec to know up front:** the Bug Count tile is **population-wide** (header filters do not scope it), stated on the card and recorded in its registry `deviations`. Spec §5.1 says flow metrics join the roster via Assignee like the other tiles — but bugs are routinely unassigned at creation, so a person-join would silently drop most of the population, which is the exact failure ("chart describes a subset with nothing on screen saying so") this dashboard's README warns about. Backlog/WIP/Lead Time/Throughput all filter normally. Flag this to the user at review.

**Branch / commit rules:** work on the current branch (`dash-loop/20260803`). Commit after every task. NEVER `git push` (standing user rule).

**Files touched (whole plan):**

| File | Change |
|---|---|
| `Jira Backlog.js` | v3.9.0: `fetchBugsCreated_` + `writeBugsSheet_` (new `Jira Bugs` tab), `writeFlowSnapshot_` (new `Flow Snapshots` append log), wiring in `runJiraEpicTracker`, version header |
| `docs/superpowers/delivery-health-dashboard/Code.js` | `created` on Jira records; `leadTimeBuckets_`, `throughputBuckets_`, `flowOpenBuckets_`, `bugWeekly_`; `parseBugRows_`/`readJiraBugs_`, `parseFlowSnapshotRows_`/`readFlowSnapshots_`; 7 registry entries; model wiring; `DH_SCHEMA_VER_` 20 → 21; `_test_flow*` units |
| `docs/superpowers/delivery-health-dashboard/Dashboard.html` | `VIEWS` entry, `viewFlow` pane, `renderAll_` dispatch, `bucketsFor_` flow fields, `flowTileHtml_` + `renderFlow_` + helpers |
| `docs/superpowers/delivery-health-dashboard/node-tests.js` | register the new `_test_flow*` calls |
| `docs/superpowers/delivery-health-dashboard/render-smoke.js` | bridge export + Flow-view assertion block |
| `docs/superpowers/delivery-health-dashboard/README.md` | 🌊 Flow section + data-sources rows |

**Verification commands (used throughout):**

```bash
cd "D:/Contribution/docs/superpowers/delivery-health-dashboard"
node node-tests.js      # pure math — must end with every ✅ line and no throw
node render-smoke.js    # rendering rules — prints "…checks passed"
```

The exporter has no local harness — its tasks are verified by pasting into the GAS editor and running `runJiraEpicTracker` (deploy steps in Task 9).

---

### Task 1: Exporter — `Jira Bugs` tab (`Jira Backlog.js` v3.9.0, part 1)

Bugs must get their **own tab**. `Bug` is not in `EXEC_ISSUE_TYPES`, and putting Bug rows into `Jira Raw` would silently move every consumer's On-Time/Throughput denominators.

**Files:**
- Modify: `Jira Backlog.js` (repo root — note the space in the filename; quote it in every git command)

- [ ] **Step 1: Bump the version header**

At the top of `Jira Backlog.js`, change line 9 and insert a CHANGES block above the v3.8.0 one (matching the existing style):

```js
  // VERSION:     3.9.0
```

```js
  // CHANGES v3.9.0 (flow-metrics feeds — spec 2026-08-05-flow-metrics-design.md):
  //   Two NEW output tabs, zero changes to Jira Raw / Exec Q&A / FETCH_CHANGELOG:
  //     · "Jira Bugs"      — one row per Bug created in the RAW_HISTORY_WEEKS
  //       window (same space scoping + isNoiseIssue_ filter as the main fetch:
  //       a bug closed Won't Do / Duplicate was a report, not a defect).
  //       Bugs are NOT in EXEC_ISSUE_TYPES on purpose — dropping Bug rows into
  //       Jira Raw would silently move every consumer's On-Time/Throughput
  //       denominators. Full rewrite per run, append-only header contract.
  //     · "Flow Snapshots" — ONE ROW APPENDED PER RUN: timestamp, ISO week,
  //       WIP count, backlog hrs, backlog item count, computed over the same
  //       open candidates written to Jira Raw. Snapshots exist because a
  //       backlog is a point-in-time state that can never be reconstructed
  //       later. Rows older than RAW_HISTORY_WEEKS are pruned on write.
  //   Consumer: the delivery-health dashboard's 🌊 Flow tab.
```

- [ ] **Step 2: Add the two sheet names to CONFIGJ**

Directly under the existing output-tab names (`RAW_SHEET: "Jira Raw",` / `EXEC_SHEET: "Exec Q&A",` ~line 236):

```js
    RAW_SHEET:    "Jira Raw",
    EXEC_SHEET:   "Exec Q&A",
    // Flow-metrics feeds (v3.9.0) — outputs, auto-created like the two above.
    BUGS_SHEET:      "Jira Bugs",
    FLOW_SNAP_SHEET: "Flow Snapshots",
```

- [ ] **Step 3: Add `fetchBugsCreated_` next to `fetchCreatedIssues_`**

Insert after the `fetchCreatedIssues_` function (~line 1191):

```js
  /**
   * Fetches Bug issues CREATED inside the deep window — the flow-metrics
   * Bug Count feed (v3.9.0). A separate tab and a separate query on purpose:
   * Bug is not in EXEC_ISSUE_TYPES, and Bug rows inside Jira Raw would
   * silently move every consumer's On-Time/Throughput denominators.
   *
   * isNoiseIssue_ applies: a bug closed Won't Do / Duplicate / Canceled was a
   * report, not a defect (spec §3.7). Open bugs carry no noise status or
   * resolution and always pass.
   */
  function fetchBugsCreated_(sinceStr) {
    var jql = [
      'issuetype = Bug',
      'project NOT IN (TEMPLATE)',
      'created >= "' + sinceStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY created DESC';
    Logger.log("📋 Bugs-created JQL: " + jql);

    // No comment bodies — nothing reads comments off a bug-count row.
    var all = fetchAllIssuesByJql_(jql, JIRA_FIELDS_NO_COMMENTS);
    var scoped = all.filter(function(i) {
      return getSpaceForIssue_(i) !== null && !isNoiseIssue_(i);
    });
    Logger.log("🐛 Bugs fetched: " + all.length + " → " + scoped.length +
               " in scope (disabled spaces + noise excluded).");
    return scoped;
  }
```

- [ ] **Step 4: Add `BUGS_HEADERS` + `writeBugsSheet_` next to `writeRawSheet_`**

Insert immediately after the `writeRawSheet_` function (~line 1825):

```js
  // APPEND-ONLY, same contract as RAW_HEADERS: consumers resolve columns by
  // header name, so new columns go at the END, never the middle.
  var BUGS_HEADERS = [
    /* 0 */ "Key", /* 1 */ "Summary", /* 2 */ "Project", /* 3 */ "Priority",
    /* 4 */ "Status", /* 5 */ "Status Category", /* 6 */ "Created",
    /* 7 */ "Resolution Date", /* 8 */ "Resolution", /* 9 */ "Assignee",
  ];

  function writeBugsSheet_(bugs) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.BUGS_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    var rows = [BUGS_HEADERS];
    bugs.forEach(function(issue) {
      var f = issue.fields || {};
      rows.push([
        issue.key,
        String(f.summary || ""),
        dig_(f, "project.key") || "",
        dig_(f, "priority.name") || "",
        dig_(f, "status.name") || "",
        dig_(f, "status.statusCategory.name") || "",
        fmtDateTime_(f.created),
        fmtDateTime_(f.resolutiondate),
        (f.resolution && f.resolution.name) || "",
        dig_(f, "assignee.displayName") || "",
      ]);
    });

    sheet.getRange(1, 1, rows.length, BUGS_HEADERS.length).setValues(rows);
    styleHeader_(sheet.getRange(1, 1, 1, BUGS_HEADERS.length));
    sheet.setFrozenRows(1);

    // Same "Generated:" footer convention as Jira Raw, so the dashboard's
    // staleness parse works identically on this tab.
    var foot = rows.length + 2;
    sheet.getRange(foot, 1)
      .setValue("Generated: " + fmtDateTime_(new Date()))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);
    sheet.getRange(foot + 1, 1)
      .setValue("Total rows: " + (rows.length - 1))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);

    Logger.log("✅ Jira Bugs: " + (rows.length - 1) + " rows written.");
  }
```

- [ ] **Step 5: Wire the fetch + write into `runJiraEpicTracker`**

In `runJiraEpicTracker`, after the `writeRawSheet_(rawWeeklyData);` / `SpreadsheetApp.flush();` pair (~line 2389), insert:

```js
      // ── Flow-metrics feeds (v3.9.0) ─────────────────────────
      // Bugs created in the deep window — Bug Count for the 🌊 Flow tab.
      // A separate tab: Bug is NOT in EXEC_ISSUE_TYPES, and Bug rows in
      // Jira Raw would move every consumer's denominators.
      Logger.log("🐛 Fetching bugs for the flow feed...");
      var bugs = fetchBugsCreated_(rawWeeks[0].fromStr);
      Logger.log("📝 Writing 'Jira Bugs' sheet...");
      writeBugsSheet_(bugs);
      SpreadsheetApp.flush();
```

- [ ] **Step 6: Update the final log line**

Change the closing log of `runJiraEpicTracker` (~line 2401) to name the new tab:

```js
      Logger.log("✅ Done. Check tabs: \"" + CONFIGJ.RAW_SHEET
        + "\", \"" + CONFIGJ.EXEC_SHEET + "\", \"" + CONFIGJ.BUGS_SHEET
        + "\", \"" + CONFIGJ.FLOW_SNAP_SHEET + "\".");
```

(`FLOW_SNAP_SHEET` is written by Task 2 — the config key already exists from Step 2, so this log line is safe to update now.)

- [ ] **Step 7: Commit**

```bash
cd "D:/Contribution"
git add "Jira Backlog.js"
git commit -m "feat(jira-export): v3.9.0 part 1 — Jira Bugs tab for the flow-metrics Bug Count feed"
```

---

### Task 2: Exporter — `Flow Snapshots` append log (`Jira Backlog.js` v3.9.0, part 2)

WIP and Backlog are point-in-time states — the sheet holds *today's* open issues, never last month's — so trend history has to be accumulated forward, one row per export run.

**Files:**
- Modify: `Jira Backlog.js`

- [ ] **Step 1: Add `writeFlowSnapshot_` after `writeBugsSheet_`**

```js
  /**
   * Appends ONE row per export run to the Flow Snapshots tab: timestamp,
   * ISO week, WIP count, backlog hrs, backlog item count (v3.9.0).
   *
   * APPEND-ONLY — never clearContents. A snapshot can't be recomputed later,
   * so this tab is the system of record for WIP/Backlog history. Rows older
   * than RAW_HISTORY_WEEKS are pruned on write (the shared 52-week dial).
   *
   * The split follows the spec (§3.4/3.5) VERBATIM — non-epic, assigned,
   * unresolved; status category To Do = backlog (waiting), In Progress = WIP.
   * Backlog hours = max(0, Original Estimate − Time Spent). The dashboard
   * recomputes today's values from Jira Raw with the same rules; this row
   * exists only because history cannot be rebuilt. If the definition ever
   * changes, old rows stay as old-definition history (✎ definition changed).
   *
   * @param {Object[]} openCandidates raw Jira issues — the union of the
   *   open-backlog fetch and the epic-children fetch (the same open issues
   *   that reach Jira Raw), unresolved rows filtered here.
   */
  function writeFlowSnapshot_(openCandidates) {
    var FLOW_HEADERS = ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items"];
    var sheet = jb_getOrCreateSheet_(CONFIGJ.FLOW_SNAP_SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, FLOW_HEADERS.length).setValues([FLOW_HEADERS]);
      styleHeader_(sheet.getRange(1, 1, 1, FLOW_HEADERS.length));
      sheet.setFrozenRows(1);
    }

    var wip = 0, backlogHrs = 0, backlogN = 0;
    openCandidates.forEach(function(issue) {
      var f = issue.fields || {};
      if (String(dig_(f, "issuetype.name") || "").toLowerCase().indexOf("epic") !== -1) return;
      if (!dig_(f, "assignee.displayName")) return;
      if (f.resolutiondate) return;   // resolved-outside-window epic children
      var cat = String(dig_(f, "status.statusCategory.name") || "");
      if (/^done$/i.test(cat)) return;
      if (/in progress/i.test(cat)) { wip++; return; }
      if (/to do/i.test(cat)) {
        backlogN++;
        var est   = Number(f.timeoriginalestimate || 0);
        var spent = Number(f.timespent || 0);
        backlogHrs += Math.max(0, est - spent) / 3600;
      }
      // any other category (custom): measured as neither — same rule as the
      // dashboard's flowOpenBuckets_, so the two stay reconcilable.
    });

    // Prune BEFORE appending so the tab never grows past the retained window.
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CONFIGJ.RAW_HISTORY_WEEKS * 7);
    var vals = sheet.getDataRange().getValues();
    for (var r = vals.length - 1; r >= 1; r--) {
      var d = new Date(vals[r][0]);
      if (!isNaN(d.getTime()) && d < cutoff) sheet.deleteRow(r + 1);
    }

    sheet.appendRow([
      fmtDateTime_(new Date()),
      jb_isoWeekLabel_(new Date()),
      wip,
      Math.round(backlogHrs * 10) / 10,
      backlogN,
    ]);
    Logger.log("🌊 Flow snapshot: WIP " + wip + ", backlog " +
               (Math.round(backlogHrs * 10) / 10) + "h across " + backlogN + " items.");
  }
```

- [ ] **Step 2: Wire it into `runJiraEpicTracker`**

The snapshot must cover the SAME open population that reaches `Jira Raw` — that is `epicChildren` (its unresolved members) **plus** `openIssues`. In `runJiraEpicTracker`, right after the bugs block added in Task 1 Step 5:

```js
      // Point-in-time WIP/backlog snapshot over the same open candidates that
      // reach Jira Raw (open-backlog fetch + open epic children). Appended,
      // never rewritten — see writeFlowSnapshot_.
      writeFlowSnapshot_(epicChildren.concat(openIssues));
      SpreadsheetApp.flush();
```

⚠️ Placement matters: `openIssues` is declared ~line 2376 (the open-backlog block), so this wiring MUST come after that block. The bugs block from Task 1 already sits after it — keep this ordering.

- [ ] **Step 3: Commit**

```bash
cd "D:/Contribution"
git add "Jira Backlog.js"
git commit -m "feat(jira-export): v3.9.0 part 2 — Flow Snapshots append log (WIP + backlog per run)"
```

---

### Task 3: Dashboard server — `created` on Jira records + Lead Time & Throughput buckets

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js`
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing tests**

Add near the other `_test_*` functions in `Code.js` (e.g. after `_test_reworkRate_` — find it with a search; all tests live in one region near the bottom):

```js
function _test_flowBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowBuckets_: " + m); }
  var who = function (a) { return a === "maria" ? "Maria Alvarez" : null; };
  var d = function (s) { return new Date(s); };
  var issues = [
    // resolved story, 4.0 days lead, 7200s estimate → counted everywhere
    { isEpic: false, assignee: "maria", created: d("2026-07-20T09:00:00"),
      resolved: d("2026-07-24T09:00:00"), estSec: 7200, spentSec: 3600 },
    // resolved task, NO created date → nAll only (lead-time coverage gap)
    { isEpic: false, assignee: "maria", created: null,
      resolved: d("2026-07-24T12:00:00"), estSec: 0, spentSec: 0 },
    // epic → excluded from BOTH metrics (grain decision D4)
    { isEpic: true, assignee: "maria", created: d("2026-07-01"),
      resolved: d("2026-07-24"), estSec: 360000, spentSec: 0 },
    // non-roster assignee → unattributed tally
    { isEpic: false, assignee: "ghost", created: d("2026-07-20"),
      resolved: d("2026-07-24"), estSec: 3600, spentSec: 0 },
    // unresolved → ignored by both
    { isEpic: false, assignee: "maria", created: d("2026-07-20"),
      resolved: null, estSec: 3600, spentSec: 0 },
  ];

  var lt = leadTimeBuckets_(issues, who);
  assert_(lt.buckets.length === 1, "one iso+person lead-time bucket");
  var b = lt.buckets[0];
  assert_(b.person === "Maria Alvarez", "person resolved via roster join");
  assert_(b.nAll === 2 && b.n === 1, "nAll counts both resolved stories; n only the dated one");
  assert_(b.days.length === 1 && Math.abs(b.days[0] - 4) < 0.05, "4.0 days lead time");
  assert_(lt.unattributed === 1, "ghost assignee tallied, not dropped silently");

  var tp = throughputBuckets_(issues, who);
  assert_(tp.buckets.length === 1, "one throughput bucket");
  var t = tp.buckets[0];
  assert_(t.nAll === 2 && t.nEst === 1, "coverage = estimated ÷ resolved");
  assert_(Math.abs(t.estHrs - 2) < 0.001, "7200s = 2.0 estimate-hours delivered");
  assert_(tp.unattributed === 1, "throughput tallies the ghost too");

  // negative lead time (created after resolved — clock skew) is not a measurement
  var skew = leadTimeBuckets_([{ isEpic: false, assignee: "maria",
    created: d("2026-07-25"), resolved: d("2026-07-24") }], who);
  assert_(skew.buckets[0].nAll === 1 && skew.buckets[0].n === 0 &&
          skew.buckets[0].days.length === 0, "negative lead time → coverage gap, not a data point");
  Logger.log("✅ _test_flowBuckets_ passed");
}
```

Register it in `node-tests.js` — after the `_test_levelTrack_();` line (~line 49) add:

```js
_test_flowBuckets_();
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd "D:/Contribution/docs/superpowers/delivery-health-dashboard" && node node-tests.js`
Expected: throws `ReferenceError: leadTimeBuckets_ is not defined` (after all pre-existing ✅ lines print).

- [ ] **Step 3: Implement — reader field + two bucket builders**

3a. In `readJiraRaw_` (Code.js ~line 1990), add the header lookup next to `iRes`:

```js
    var iCreated = colIdx_(h, ["Created"]);
```

and add `created` to the `rec` object right after the `resolved:` line (~line 2099):

```js
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        // Lead Time input (flow metrics, spec 2026-08-05). Optional like every
        // header here: -1 on an exotic export → null → coverage gap, not zero.
        created: iCreated === -1 ? null : parseDhDate_(raw[r][iCreated]),
```

3b. Add the two builders after `reworkBuckets_` (~line 985):

```js
/**
 * Resolved NON-EPIC issues → per-week lead-time buckets (🌊 Flow, spec
 * 2026-08-05 §3.1). Same shape and rules as onTimeBuckets_: person-attributed
 * via the roster join, unattributed tallied for the honesty note.
 *
 * Median (and p85) are NOT additive, so the raw day values ship per bucket and
 * the client aggregates whatever the active filter selects — the same pattern
 * as forecast's absVars. Values rounded to 0.1d and capped at 1000d so one
 * archaeological ticket can't bloat the payload.
 *
 *   nAll  every resolved non-epic issue (coverage denominator)
 *   n     those with a usable created date (created ≤ resolved)
 *   days  calendar days created → resolved, one per measured issue
 */
function leadTimeBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;                       // grain decision D4
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, nAll: 0, days: [] };
    map[k].nAll++;
    if (!it.created || isNaN(it.created.getTime())) return;
    var days = (it.resolved.getTime() - it.created.getTime()) / 86400000;
    if (days < 0) return;  // clock skew / bad data — a gap, not a measurement
    map[k].n++;
    map[k].days.push(Math.round(Math.min(1000, days) * 10) / 10);
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/**
 * Resolved NON-EPIC issues → per-week throughput buckets (🌊 Flow, spec §3.3):
 * Σ Original Estimate hours delivered. Non-epic only — an epic AND its children
 * both carrying estimates would double-count the sum (grain decision D4).
 *
 *   nAll    every resolved non-epic issue (coverage denominator)
 *   nEst    those carrying a non-zero estimate
 *   estHrs  Σ estimate hours over nEst — unestimated work delivers INVISIBLY
 *           here; the card's coverage chip carries that caveat.
 */
function throughputBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, nAll: 0, nEst: 0, estHrs: 0 };
    map[k].nAll++;
    var est = Number(it.estSec) || 0;
    if (est <= 0) return;
    map[k].nEst++;
    map[k].estHrs += est / 3600;
  });
  var buckets = Object.keys(map).map(function (k) {
    map[k].estHrs = Math.round(map[k].estHrs * 10) / 10;
    return map[k];
  });
  return { buckets: buckets, unattributed: unattributed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node-tests.js`
Expected: `✅ _test_flowBuckets_ passed` among the output, exit 0.

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution"
git add "docs/superpowers/delivery-health-dashboard/Code.js" "docs/superpowers/delivery-health-dashboard/node-tests.js"
git commit -m "feat(dh): lead-time + throughput bucket builders, created date on Jira records"
```

---

### Task 4: Dashboard server — open-book split (Backlog / WIP buckets)

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js`
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**

```js
function _test_flowOpenBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowOpenBuckets_: " + m); }
  var who = function (a) { return a === "maria" ? "Maria Alvarez" : null; };
  var issues = [
    // waiting to start: To Do, 2h est, 0.5h spent → backlog 1.5h
    { isEpic: false, assignee: "maria", resolved: null, status: "To Do",
      statusCategory: "To Do", estSec: 7200, spentSec: 1800 },
    // active: In Progress → WIP, hours NOT counted in backlog
    { isEpic: false, assignee: "maria", resolved: null, status: "In Progress",
      statusCategory: "In Progress", estSec: 36000, spentSec: 0 },
    // To Do with no estimate → item counted, 0 hours, coverage gap
    { isEpic: false, assignee: "maria", resolved: null, status: "Backlog",
      statusCategory: "To Do", estSec: 0, spentSec: 0 },
    // blank status category (pre-v3.6.0 export) → measured as NEITHER
    { isEpic: false, assignee: "maria", resolved: null, status: "Waiting",
      statusCategory: "", estSec: 3600, spentSec: 0 },
    // epic → excluded; resolved → excluded; unassigned → excluded
    { isEpic: true, assignee: "maria", resolved: null, statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    { isEpic: false, assignee: "maria", resolved: new Date(), statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    { isEpic: false, assignee: "⚠️ UNASSIGNED", resolved: null, statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    // closed-ish status but no resolution date → excluded (matches openIssues rule)
    { isEpic: false, assignee: "maria", resolved: null, status: "Canceled",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    // non-roster assignee → unattributed
    { isEpic: false, assignee: "ghost", resolved: null, status: "To Do",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
  ];
  var r = flowOpenBuckets_(issues, who);
  assert_(r.buckets.length === 1, "one person bucket");
  var b = r.buckets[0];
  assert_(b.person === "Maria Alvarez", "keyed by roster name");
  assert_(b.wipN === 1, "one item in progress");
  assert_(b.todoN === 2 && b.todoEst === 1, "two waiting items, one estimated");
  assert_(Math.abs(b.todoHrs - 1.5) < 0.001, "backlog hrs = max(0, est − spent) = 1.5");
  assert_(r.uncategorized === 1, "blank status category measured as neither, tallied");
  assert_(r.unattributed === 1, "ghost tallied");
  Logger.log("✅ _test_flowOpenBuckets_ passed");
}
```

Register in `node-tests.js` next to `_test_flowBuckets_();`:

```js
_test_flowOpenBuckets_();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node node-tests.js` — Expected: `ReferenceError: flowOpenBuckets_ is not defined`.

- [ ] **Step 3: Implement `flowOpenBuckets_`** (after `throughputBuckets_`)

```js
/**
 * OPEN assigned non-epic issues → per-PERSON backlog/WIP buckets (🌊 Flow,
 * spec §3.4/§3.5). No iso key — a backlog is a snapshot, not a time series
 * (history comes from the exporter's Flow Snapshots tab instead).
 *
 * Status category partitions the open book:
 *   "To Do"       → backlog (waiting to start): todoN, todoEst,
 *                   todoHrs = Σ max(0, est − spent)
 *   "In Progress" → WIP: wipN (same semantics as the exporter's fetchActiveWIP_)
 *   blank/other   → uncategorized tally — a pre-v3.6.0 export has no Status
 *                   Category column, and inventing a side would be a guess.
 *
 * Open = unresolved + assigned + status not closed-ish — the SAME rule as
 * readJiraRaw_'s openIssues, restated over `issues` because openIssues records
 * don't carry statusCategory/estSec.
 */
function flowOpenBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0, uncategorized = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;
    if (it.resolved && !isNaN(it.resolved.getTime())) return;
    var raw = String(it.assignee || "").trim();
    if (!raw || /unassigned/i.test(raw)) return;
    if (DH_CLOSED_STATUS_.test(String(it.status || ""))) return;
    var person = resolvePerson ? resolvePerson(raw) : null;
    if (!person) { unattributed++; return; }
    if (!map[person]) map[person] = { person: person, wipN: 0,
                                      todoN: 0, todoEst: 0, todoHrs: 0 };
    var cat = String(it.statusCategory || "");
    if (/in progress/i.test(cat)) { map[person].wipN++; return; }
    if (/to do/i.test(cat)) {
      map[person].todoN++;
      var est = Number(it.estSec) || 0;
      if (est > 0) map[person].todoEst++;
      map[person].todoHrs += Math.max(0, est - (Number(it.spentSec) || 0)) / 3600;
      return;
    }
    uncategorized++;
  });
  var buckets = Object.keys(map).map(function (k) {
    map[k].todoHrs = Math.round(map[k].todoHrs * 10) / 10;
    return map[k];
  });
  return { buckets: buckets, unattributed: unattributed, uncategorized: uncategorized };
}
```

Note: `DH_CLOSED_STATUS_` already exists (~line 1914, "Status names that mean the item is no longer open work") — reuse it, do not redefine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node-tests.js` — Expected: `✅ _test_flowOpenBuckets_ passed`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Code.js" "docs/superpowers/delivery-health-dashboard/node-tests.js"
git commit -m "feat(dh): flowOpenBuckets_ — To Do vs In Progress partition of the open book"
```

---

### Task 5: Dashboard server — readers for the two new tabs

Readers follow the "absent ≠ stale" pattern: a missing tab returns `available: false` and the tiles degrade to *"export predates Jira Backlog.js v3.9.0"* — never an error, never a zero. Parsing is split into pure `parse*_` functions so node can test them (SpreadsheetApp is not stubbed).

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js`
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing tests**

```js
function _test_bugFeed_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_bugFeed_: " + m); }
  // Header order shuffled on purpose — consumers resolve BY NAME.
  var values = [
    ["Summary", "Key", "Created", "Resolution Date", "Status Category"],
    ["login broken", "BUG-1", "7/20/2026 09:00", "7/22/2026 10:00", "Done"],
    ["slow page", "BUG-2", "7/21/2026 09:00", "", "To Do"],
    ["", "", "", "", ""],                       // blank spacer row
    ["", "Generated: 8/5/2026 07:00", "", "", ""],  // footer must not parse as a bug
  ];
  var r = parseBugRows_(values);
  assert_(r.available === true, "parsed feed is available");
  assert_(r.bugs.length === 2, "two bugs, footer + blank skipped");
  assert_(r.bugs[0].key === "BUG-1" && r.bugs[0].resolved instanceof Date, "resolved date parsed");
  assert_(r.bugs[1].resolved === null, "open bug has null resolved");

  var wk = bugWeekly_(r.bugs);
  // both created in the week of 2026-07-20 (2026.W30); one resolved same week
  var w30 = wk.filter(function (x) { return x.iso === "2026.W30"; })[0];
  assert_(w30 && w30.nCreated === 2 && w30.nResolved === 1,
          "weekly tally: 2 created, 1 resolved in 2026.W30");

  assert_(parseBugRows_(null).available === false, "no values → unavailable");
  assert_(parseBugRows_([["Key"]]).available === false, "header-only → unavailable");
  Logger.log("✅ _test_bugFeed_ passed");
}

function _test_flowSnapshots_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowSnapshots_: " + m); }
  var values = [
    ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items"],
    ["7/28/2026 07:00", "2026.W31", "10", "120.5", "40"],
    ["7/30/2026 07:00", "2026.W31", "12", "118",   "38"],  // later run, same week
    ["8/3/2026 07:00",  "2026.W32", "11", "99",    "35"],
    ["not a date",      "garbage",  "",   "",      ""],    // junk row skipped
  ];
  var r = parseFlowSnapshotRows_(values);
  assert_(r.available === true, "parsed");
  assert_(r.snaps.length === 2, "one snapshot per ISO week, junk skipped");
  assert_(r.snaps[0].iso === "2026.W31" && r.snaps[0].wip === 12,
          "LAST run of the week wins (12, not 10)");
  assert_(Math.abs(r.snaps[0].backlogHrs - 118) < 0.001, "hours from the winning row");
  assert_(r.snaps[1].iso === "2026.W32" && r.snaps[1].backlogN === 35, "second week intact");
  assert_(parseFlowSnapshotRows_([]).available === false, "empty → unavailable");
  Logger.log("✅ _test_flowSnapshots_ passed");
}
```

Register both in `node-tests.js`:

```js
_test_bugFeed_(); _test_flowSnapshots_();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node node-tests.js` — Expected: `ReferenceError: parseBugRows_ is not defined`.

- [ ] **Step 3: Implement — two pure parsers + two thin readers + config**

3a. Add the tab names to `CONFIG_DH` (next to `JIRA_RAW_SHEET`, ~line 20):

```js
  JIRA_RAW_SHEET:    "Jira Raw",
  // Flow-metrics feeds (Jira Backlog.js v3.9.0). Absent tab = absent feature,
  // never an error — see readJiraBugs_ / readFlowSnapshots_.
  JIRA_BUGS_SHEET:   "Jira Bugs",
  FLOW_SNAP_SHEET:   "Flow Snapshots",
```

3b. Add after `readJiraRaw_` (~line 2144):

```js
/**
 * Pure parse of the Jira Bugs tab (Jira Backlog.js v3.9.0). Columns BY NAME.
 * Bug Count needs only created/resolved; assignee is deliberately unused —
 * the tile is population-wide (bugs are routinely unassigned at creation, so
 * a person join would silently drop most of the population).
 */
function parseBugRows_(values) {
  if (!values || values.length < 2) return { bugs: [], available: false };
  var h = values[0].map(String);
  var iKey = colIdx_(h, ["Key"]);
  var iCreated = colIdx_(h, ["Created"]);
  var iRes = colIdx_(h, ["Resolution Date"]);
  if (iKey === -1 || iCreated === -1) return { bugs: [], available: false };
  var bugs = [];
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][iKey] || "").trim();
    if (!key || /^(GENERATED|TOTAL ROWS):/i.test(key)) continue;
    var created = parseDhDate_(values[r][iCreated]);
    if (!created || isNaN(created.getTime())) continue;
    bugs.push({ key: key.toUpperCase(), created: created,
                resolved: iRes === -1 ? null : parseDhDate_(values[r][iRes]) });
  }
  return { bugs: bugs, available: true };
}

/** Bugs → per-ISO-week tallies. One bug can hit TWO weeks: nCreated at its
    creation week, nResolved at its resolution week. Population-wide (no person
    key) — see parseBugRows_. */
function bugWeekly_(bugs) {
  var map = {};
  function row(iso) {
    if (!map[iso]) map[iso] = { iso: iso, nCreated: 0, nResolved: 0 };
    return map[iso];
  }
  (bugs || []).forEach(function (b) {
    if (b.created && !isNaN(b.created.getTime())) row(weekKeyFromDate_(b.created)).nCreated++;
    if (b.resolved && !isNaN(b.resolved.getTime())) row(weekKeyFromDate_(b.resolved)).nResolved++;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/** Thin sheet wrapper — a missing tab is ABSENT (export predates v3.9.0),
    never an error. Same contract as readJiraRaw_. */
function readJiraBugs_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
               .getSheetByName(CONFIG_DH.JIRA_BUGS_SHEET);
    if (!sh) return { bugs: [], available: false };
    return parseBugRows_(sh.getDataRange().getValues());
  } catch (e) { return { bugs: [], available: false, error: e.message }; }
}

/**
 * Pure parse of the Flow Snapshots tab. The exporter appends one row per RUN
 * and can run several times a week — the LAST row per ISO week wins (freshest
 * state of that week). Rows whose ISO Week cell isn't YYYY.WN are skipped.
 */
function parseFlowSnapshotRows_(values) {
  if (!values || values.length < 2) return { snaps: [], available: false };
  var h = values[0].map(String);
  var iGen = colIdx_(h, ["Generated"]);
  var iIso = colIdx_(h, ["ISO Week"]);
  var iWip = colIdx_(h, ["WIP Count"]);
  var iHrs = colIdx_(h, ["Backlog Hrs"]);
  var iN = colIdx_(h, ["Backlog Items"]);
  if (iGen === -1 || iIso === -1) return { snaps: [], available: false };
  var byIso = {}, order = [];
  for (var r = 1; r < values.length; r++) {
    var iso = String(values[r][iIso] || "").trim();
    if (!/^\d{4}\.W\d{1,2}$/.test(iso)) continue;
    if (!byIso[iso]) order.push(iso);
    byIso[iso] = { iso: iso, at: String(values[r][iGen] || ""),
                   wip: Number(values[r][iWip]) || 0,
                   backlogHrs: Number(values[r][iHrs]) || 0,
                   backlogN: Number(values[r][iN]) || 0 };
  }
  return { snaps: order.map(function (k) { return byIso[k]; }), available: true };
}

/** Thin sheet wrapper for Flow Snapshots — same absent-≠-error contract. */
function readFlowSnapshots_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
               .getSheetByName(CONFIG_DH.FLOW_SNAP_SHEET);
    if (!sh) return { snaps: [], available: false };
    return parseFlowSnapshotRows_(sh.getDataRange().getValues());
  } catch (e) { return { snaps: [], available: false, error: e.message }; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node-tests.js` — Expected: `✅ _test_bugFeed_ passed` and `✅ _test_flowSnapshots_ passed`, exit 0.

⚠️ If `_test_bugFeed_`'s W30 assertion fails on the ISO week label, check what `weekKeyFromDate_(new Date("7/20/2026"))` actually returns (2026-07-20 is a Monday, ISO week 30) and fix the FIXTURE, not the function.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Code.js" "docs/superpowers/delivery-health-dashboard/node-tests.js"
git commit -m "feat(dh): Jira Bugs + Flow Snapshots readers (pure parsers, absent-tab tolerant)"
```

---

### Task 6: Dashboard server — registry entries, model wiring, schema bump

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Code.js`
- Modify: `docs/superpowers/delivery-health-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**

```js
function _test_flowRegistry_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowRegistry_: " + m); }
  var m = METRIC_REGISTRY_.metrics;
  ["leadTime", "throughput", "backlog", "wip", "bugCount"].forEach(function (id) {
    assert_(m[id], id + " registered");
    assert_(m[id].target === null, id + " ships with NO target (D6 — neutral tile, no RAG)");
    assert_(m[id].owner, id + " has an owner");
    assert_(typeof m[id].coverageGate === "number", id + " has a numeric coverage gate");
  });
  ["cycleTime", "flowEfficiency"].forEach(function (id) {
    assert_(m[id] && m[id].status === "absent", id + " is declared absent");
    assert_(m[id].absentReason && m[id].absentReason.length > 10, id + " states why");
  });
  // registry v3.0 change-log entry exists and marks no existing trend line
  assert_(METRIC_REGISTRY_.changeLog[0].version === "3.0", "changeLog leads with 3.0");
  assert_(METRIC_REGISTRY_.changeLog[0].affects.length === 0,
          "new metrics move no EXISTING metric's values — no ✎ marker on old trends");
  Logger.log("✅ _test_flowRegistry_ passed");
}
```

Register in `node-tests.js`: `_test_flowRegistry_();`

- [ ] **Step 2: Run to verify it fails**

Run: `node node-tests.js` — Expected: `❌ _test_flowRegistry_: leadTime registered`.

- [ ] **Step 3: Add the seven registry entries**

In `METRIC_REGISTRY_.metrics`, after the `hygiene` entry (~line 351), add:

```js
    // ── 🌊 FLOW METRICS (spec 2026-08-05-flow-metrics-design.md) ──
    // All five live metrics: NON-EPIC grain (D4), target: null (D6 — no RAG
    // until the Services Director sets targets; a neutral tile beats an
    // invented threshold). Two more are declared absent below, CSAT-style.
    leadTime: {
      id: "leadTime",
      name: "Lead Time",
      definition: "Calendar days between a work item's creation and its resolution — how long a request lives in the system end to end.",
      formula: "median(resolution date − created date) in calendar days over non-epic issues resolved in period; p85 companion (the tail is the finding)",
      sources: ["Jira Raw — Created, Resolution Date, Issue Type, Assignee"],
      grain: "Non-epic issue (Story/Task/Sub-task), rolled up by person → team → region",
      target: null,
      unit: "days",
      lowerIsBetter: true,
      coverageGate: 0.90,
      coverageOf: "resolved non-epic issues carrying both dates",
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once one is agreed)",
      ebitda: "Long lead times delay revenue recognition and stretch client commitments. Not quantified — no rate basis (PR-06).",
      deviations: [
        "CALENDAR days, not working days — weekends and holidays count. Stated on the card so a 9-day median is never read as 9 working days.",
        "Non-epic grain (spec D4): an epic's lead time is a programme lifecycle, not a work-item lifecycle — same reasoning as ONTIME_SCOPE.",
        "Issues whose created date postdates their resolution (clock skew / imported records) count toward coverage but are never scored.",
      ],
    },

    cycleTime: {
      id: "cycleTime",
      name: "Cycle Time",
      definition: "Calendar days between the first transition into In Progress and resolution — how long active work takes once started.",
      formula: "median(resolution date − first In-Progress date); NOT COMPUTABLE on the current export",
      sources: ["Jira changelog (first In-Progress transition) — NOT EXPORTED (CONFIGJ.FETCH_CHANGELOG is off, user decision 2026-08-05)"],
      grain: "Non-epic issue",
      target: null,
      unit: "days",
      lowerIsBetter: true,
      coverageGate: 0,
      coverageOf: "n/a — no feed",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Not quantified.",
      status: "absent",
      absentReason: "Needs the first In-Progress date from the Jira changelog — not yet exported (FETCH_CHANGELOG off, user decision 2026-08-05). The changelog-free approximation (resolution − last status change) is ≈0 for every Done issue and is deliberately NOT published.",
      deviations: [],
    },

    throughput: {
      id: "throughput",
      name: "Throughput",
      definition: "Estimated hours of work delivered in the period — the sum of Original Estimate on resolved items.",
      formula: "Σ Original Estimate (hrs) over non-epic issues resolved in period",
      sources: ["Jira Raw — Original Estimate (sec), Resolution Date, Issue Type, Assignee"],
      grain: "Non-epic issue (epic + child estimates would double-count the sum — spec D4), rolled up by person → team → region",
      target: null,
      unit: "hrs",
      coverageGate: 0.60,
      coverageOf: "resolved non-epic issues carrying a non-zero estimate",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Throughput × blended rate approximates delivered value per period. Not quantified — no rate basis (PR-06).",
      deviations: [
        "UNESTIMATED WORK DELIVERS INVISIBLY here — the sum only sees issues carrying an estimate. The card states the estimated share; the fix is estimate fill, not a different formula.",
      ],
    },

    backlog: {
      id: "backlog",
      name: "Backlog (Inventory)",
      definition: "Estimated hours of assigned work waiting to start — open items in status category To Do.",
      formula: "Σ max(0, Original Estimate − Time Spent) (hrs) over open, assigned, non-epic issues in status category To Do",
      sources: ["Jira Raw — Week=Open rows: Status Category, Original Estimate (sec), Time Spent (sec), Assignee",
                "Flow Snapshots tab (trend — the exporter appends one row per run; history accumulates forward)"],
      grain: "Open non-epic issue, by person → team → region (current value); whole population (trend)",
      target: null,
      unit: "hrs",
      coverageGate: 0.60,
      coverageOf: "waiting items carrying an estimate",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Backlog hours × blended rate approximates contracted-but-undelivered value. Not quantified (PR-06).",
      deviations: [
        "The open-backlog export is bounded by CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS (26): a ticket untouched for 6 months is treated as abandoned, not inventory.",
        "The TREND is whole-population (the exporter's snapshot knows nothing of dashboard filters) — the sparkline hides under active filters and the card says so.",
        "History accumulates from the first v3.9.0 export run — snapshots cannot be back-filled.",
      ],
    },

    wip: {
      id: "wip",
      name: "Work In Progress",
      definition: "Open assigned items currently in status category In Progress — the active work inside the system right now.",
      formula: "count of open, assigned, non-epic issues in status category In Progress",
      sources: ["Jira Raw — Week=Open rows: Status Category, Assignee",
                "Flow Snapshots tab (trend)"],
      grain: "Open non-epic issue, by person → team → region (current value); whole population (trend)",
      target: null,
      unit: "items",
      coverageGate: 0,
      coverageOf: "n/a — a count over rows that exist",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "No direct translation — WIP is a flow-control signal, not a cost line.",
      deviations: [
        "Together with Backlog this PARTITIONS the open assigned book by status category; items in a custom category that is neither To Do nor In Progress land in neither tile and are counted on the card.",
        "Same trend caveats as Backlog: whole-population snapshots, history from the first v3.9.0 run.",
      ],
    },

    flowEfficiency: {
      id: "flowEfficiency",
      name: "Flow Efficiency",
      definition: "Share of an item's elapsed life spent actively being worked vs waiting.",
      formula: "Σ active-status dwell ÷ Σ (resolution − created); NOT COMPUTABLE on the current export",
      sources: ["Jira changelog (per-status dwell time) — NOT EXPORTED"],
      grain: "Non-epic issue",
      target: null,
      unit: "%",
      coverageGate: 0,
      coverageOf: "n/a — no feed",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Not quantified.",
      status: "absent",
      absentReason: "Needs per-status dwell time from the Jira changelog plus an agreed active-statuses vocabulary — the most expensive item on the flow list. Revisit only after Cycle Time proves the changelog path (cost + truncation on long-lived issues).",
      deviations: [],
    },

    bugCount: {
      id: "bugCount",
      name: "Bug Count",
      definition: "Defects reported in the period — Bug issues created, with bugs resolved as the companion so the tile says whether the bug book is growing.",
      formula: "count of Bug issues created in period (companion: resolved in period)",
      sources: ["Jira Bugs tab (Jira Backlog.js v3.9.0) — Created, Resolution Date"],
      grain: "Bug issue, POPULATION-WIDE (header filters do not apply — see deviations)",
      target: null,
      unit: "bugs",
      lowerIsBetter: true,
      coverageGate: 0,
      coverageOf: "n/a — a count over rows that exist",
      owner: "Delivery + CX",
      paramOwner: "Services Director",
      ebitda: "Bug fixing is uncompensated labour — hours on bugs × cost rate. Not quantified (PR-06).",
      deviations: [
        "POPULATION-WIDE, unlike every other tile: bugs are routinely unassigned at creation, so a roster join would silently drop most of the population — the exact silent-subset failure the comparison charts were fixed for. The card states it.",
        "Noise-filtered at export: a bug closed Won't Do / Duplicate / Canceled was a report, not a defect (isNoiseIssue_ in Jira Backlog.js).",
        "DISTINCT from Quality/Rework: rework counts delivered work that came back; this counts defects reported. A bug feeds neither leg of the rework rate.",
      ],
    },
```

- [ ] **Step 4: Add the change-log entry**

At the TOP of `METRIC_REGISTRY_.changeLog` (before the "2.1" entry), and bump the registry header:

```js
  version: "3.0",
  updated: "2026-08-05",  // 2026.W32
```

```js
    { version: "3.0", date: "2026-08-05", author: "Alex López",
      affects: [],
      change: "Added the 🌊 Flow metric family: Lead Time, Throughput, Backlog, WIP, Bug Count (live, target: null — informational until targets are agreed) and Cycle Time + Flow Efficiency (declared absent — changelog not exported). Non-epic grain throughout.",
      rationale: "Spec 2026-08-05-flow-metrics-design.md, decisions D1–D6. New metrics on a new tab; nothing existing recomputes, so affects is empty and no existing trend line gets a definition-changed marker." },
```

- [ ] **Step 5: Run the tests**

Run: `node node-tests.js`
Expected: `✅ _test_flowRegistry_ passed`. ⚠️ If `_test_registry_` or `_test_modelAssembly_` fail because they pin the registry's metric-id list or version string, extend their expected lists with the seven new ids / new version — the PINNED EXPECTATION is what changed, deliberately.

- [ ] **Step 6: Wire the buckets + feeds into the model**

6a. In the inputs-gathering function — search Code.js for `jira: readJiraRaw_(),` (~line 2654) — add alongside it:

```js
    jira: readJiraRaw_(),
    bugs: readJiraBugs_(),
    flowSnaps: readFlowSnapshots_(),
```

6b. In the model-assembly function — search for `var rework = reworkBuckets_(` — add directly after that line (same `resolvePerson` argument as the neighbouring calls):

```js
  // 🌊 Flow metrics (spec 2026-08-05) — same person-attribution join as the
  // other issue metrics; Bug Count is population-wide (see registry deviation).
  var leadTime = leadTimeBuckets_(inputs.jira.issues, resolvePerson);
  var throughput = throughputBuckets_(inputs.jira.issues, resolvePerson);
  var flowOpen = flowOpenBuckets_(inputs.jira.issues, resolvePerson);
```

⚠️ Match the actual name of the resolver argument used by the `reworkBuckets_` call on that line (it may be a local like `resolvePerson_` or a closure) — use the identical expression.

6c. In the return block (~line 2541), extend the top-level payload:

```js
    people: people, onTimeBuckets: onTime.buckets, forecastBuckets: forecast.buckets,
    reworkBuckets: rework.buckets,
    leadTimeBuckets: leadTime.buckets,
    throughputBuckets: throughput.buckets,
    flowOpenBuckets: flowOpen.buckets,
    bugWeekly: bugWeekly_(inputs.bugs.bugs),
```

6d. In `meta` (same return block), after `jiraUnattributed`, add:

```js
      jiraUnattributed: { onTime: onTime.unattributed, forecast: forecast.unattributed,
                          rework: rework.unattributed,
                          leadTime: leadTime.unattributed, throughput: throughput.unattributed,
                          flowOpen: flowOpen.unattributed },
      // 🌊 Flow feeds. Absent tab = export predates Jira Backlog.js v3.9.0 —
      // the tiles say so instead of erroring (absent ≠ stale, same pattern as
      // dataAsOf.jiraUnknown).
      bugsAvailable: !!inputs.bugs.available,
      flowSnapshotsAvailable: !!inputs.flowSnaps.available,
      flowSnapshots: inputs.flowSnaps.snaps,
      flowUncategorized: flowOpen.uncategorized,
```

6e. In `meta.sources`, add a row after the Jira line:

```js
        { system: "Jira (via Exec Contribution Tracker export)", feeds: "Bug Count, WIP/Backlog trend",
          tab: CONFIG_DH.JIRA_BUGS_SHEET + " · " + CONFIG_DH.FLOW_SNAP_SHEET },
```

6f. Bump the schema version (~line 2643) and document it in the comment block above:

```js
// v11: 🌊 Flow metrics — leadTimeBuckets/throughputBuckets/flowOpenBuckets/
//      bugWeekly + meta.flowSnapshots/bugsAvailable/flowSnapshotsAvailable.
//      A cached older model has none of these; the Flow tab would render
//      every tile as absent, so force one clean rebuild.
var DH_SCHEMA_VER_ = 21;
```

(If the current literal is not 20, increment whatever it is by 1 and keep the comment.)

- [ ] **Step 7: Run the tests**

Run: `node node-tests.js` — Expected: all pass, including `_test_modelAssembly_` (extend its pinned payload-key expectations if it enumerates them — same rule as Step 5).

- [ ] **Step 8: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Code.js" "docs/superpowers/delivery-health-dashboard/node-tests.js"
git commit -m "feat(dh): flow metrics registry v3.0 + model wiring + schema v21"
```

---

### Task 7: Dashboard client — 🌊 Flow tab (`Dashboard.html`)

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html`

- [ ] **Step 1: Add the view to `VIEWS`** (~line 570, between `trend` and `people`)

```js
  { id: "flow",    label: "🌊 Flow",     pane: "viewFlow",    roles: null,
    hint: "How work moves through the system — lead time, throughput, backlog, WIP and bugs." },
```

- [ ] **Step 2: Add the pane div**

Before the `<div id="viewHygiene" ...>` line (~line 473):

```html
  <!-- 🌊 Flow — how work moves through the system (spec 2026-08-05). -->
  <div id="viewFlow" class="viewPane" style="display:none">
    <div style="text-align:right"><button class="iconbtn" onclick="savePng_('flowTiles','flow')" title="Save the flow cards as a PNG image">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>PNG</button></div>
    <div class="tiles" id="flowTiles"></div>
  </div>
```

- [ ] **Step 3: Dispatch it in `renderAll_`** (~line 1390)

```js
    case "flow":    renderFlow_(); break;
```

- [ ] **Step 4: Teach `bucketsFor_` the flow fields** (~line 1523)

Add to the zero-init object:

```js
              nDelivered: 0, nRework: 0, nLinked: 0, nReopened: 0, nReopenCov: 0,
              // 🌊 Flow (schema v11). days concats like absVars — a median is
              // not additive, so the raw values travel.
              days: [], estHrs: 0, nEst: 0 };
```

and to the accumulation loop (next to the `nReopenCov` line):

```js
    out.estHrs += (b.estHrs || 0); out.nEst += (b.nEst || 0);
    if (b.days && b.days.length) out.days = out.days.concat(b.days);
```

- [ ] **Step 5: Add the renderer + helpers**

Insert after the existing `renderTiles_` function (find its closing brace — the next top-level `function` after ~line 2231):

```js
// ── 🌊 FLOW VIEW (spec 2026-08-05-flow-metrics-design.md) ────────────────────

function flowMedian_(arr) {
  if (!arr || !arr.length) return null;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function flowP85_(arr) {
  if (!arr || !arr.length) return null;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * 0.85) - 1))];
}

/** Backlog/WIP current values over the people passing the active filters.
    Person-keyed and snapshot-shaped — no iso (a backlog is not a time series). */
function flowOpenFor_() {
  if (!MODEL._pByName) {
    MODEL._pByName = {};
    MODEL.people.forEach(function (p) { MODEL._pByName[p.name] = p; });
  }
  var out = { wipN: 0, todoN: 0, todoEst: 0, todoHrs: 0 };
  (MODEL.flowOpenBuckets || []).forEach(function (b) {
    var person = b.person ? MODEL._pByName[b.person] : null;
    if (!person || !passesFilters_(person)) return;
    if (person.isIntern) return;   // same rule as bucketsFor_
    out.wipN += b.wipN || 0; out.todoN += b.todoN || 0;
    out.todoEst += b.todoEst || 0; out.todoHrs += b.todoHrs || 0;
  });
  return out;
}

/** True when every person passes the filters — the only state in which the
    whole-population snapshot trend is honest to draw under the current scope. */
function flowUnfiltered_() {
  return filteredPeople_().length === MODEL.people.length;
}

function fmtFlowVal_(v, unit) {
  if (v === null || v === undefined) return "—";
  var n = unit === "days" ? Math.round(v * 10) / 10 : Math.round(v);
  return n + (unit === "days" ? "d" : unit === "hrs" ? "h" : "");
}

/**
 * Flow KPI card. tileHtml_ is deliberately NOT reused: it renders percentages
 * with RAG-vs-target grammar, and every flow metric is unit-bearing (days,
 * hours, items) with target: null — neutral by design (registry D6).
 * Grammar: label → hero value → confidence chip → context line → sparkline.
 */
function flowTileHtml_(m, headline, opts) {
  opts = opts || {};
  var name = (m && m.name) || opts.label || "";
  if (m && m.status === "absent") {
    return '<div class="tile ph"><div class="lbl">' + esc_(name) + '</div>' +
      '<div class="big">—</div><div class="cmp" title="' + esc_(m.absentReason || "") + '">' +
      esc_((m.absentReason || "not measured").split("—")[0].trim()) +
      ' <span class="cellSub" style="cursor:help">ⓘ</span></div></div>';
  }
  if (opts.unavailable) {
    return '<div class="tile ph"><div class="lbl">' + esc_(name) + '</div>' +
      '<div class="big">—</div><div class="cmp">' + esc_(opts.unavailable) + '</div></div>';
  }
  var detail = (opts.detail || []).filter(Boolean).join(" · ");
  var context = (opts.context || "") + (detail
    ? ' <span class="cellSub" title="' + esc_(detail) + '" style="cursor:help">ⓘ</span>' : "");
  var vals = (opts.trend || []).filter(function (v) { return v !== null; });
  var delta = "";
  if (vals.length >= 2 && !MODEL._stale && headline !== null) {
    var d = vals[vals.length - 1] - vals[vals.length - 2];
    var mag = m && m.unit === "days" ? Math.round(d * 10) / 10 : Math.round(d);
    // NEUTRAL arrows — no dUp/dDown class: with target: null there is no
    // verdict, and colouring a direction would invent one (registry D6).
    delta = mag === 0
      ? '<span title="unchanged vs the prior complete period">unchanged vs prior</span>'
      : '<span>' + (mag > 0 ? "▲" : "▼") + " " + Math.abs(mag) +
        (m && m.unit === "days" ? "d" : m && m.unit === "hrs" ? "h" : "") + " vs prior</span>";
  }
  return '<div class="tile"><div class="lbl">' + esc_(name) + '</div>' +
    '<div class="big">' + fmtFlowVal_(headline, m && m.unit) + '</div>' +
    (opts.conf ? '<div class="cmp">' + confChip_(opts.conf, m || {}) + '</div>' : "") +
    (delta ? '<div class="cmp">' + delta + '</div>' : "") +
    '<div class="cmp">' + context + '</div>' +
    (MODEL._stale
      ? '<div class="cmp stalenote" title="the model has not been rebuilt inside the stated refresh cadence — trend comparisons are suppressed until it refreshes">trend suppressed — data stale</div>'
      : (opts.trend ? sparkHtml_(opts.trend, { labels: opts.trendLabels }) : "")) +
    '</div>';
}

function renderFlow_() {
  var el = document.getElementById("flowTiles");
  var reg = ((MODEL.meta.registry || {}).metrics) || {};
  if (!MODEL.meta.jiraAvailable) {
    el.innerHTML = '<div class="tile ph"><div class="lbl">🌊 Flow</div>' +
      '<div class="big">—</div><div class="cmp">Jira data unavailable — the Jira Raw tab could not be read</div></div>';
    return;
  }
  var done = donePeriods_();
  var hi = headPeriodIdx_(done);
  var trendPer = done.slice(Math.max(0, hi - 5), hi + 1);
  var head = done[hi] || { isos: [], label: "—" };
  var labels = trendPer.map(function (p) { return p.label; });
  var periodsWithData = 0;   // recomputed per metric below
  var html = "";

  // 1 · Lead Time — median days, p85 companion (raw day values travel per
  // bucket; the client medians whatever the filters select).
  (function () {
    var m = reg.leadTime || { unit: "days", coverageGate: 0.9, name: "Lead Time" };
    var series = trendPer.map(function (p) {
      var b = bucketsFor_(MODEL.leadTimeBuckets || [], p.isos);
      return b.days.length ? flowMedian_(b.days) : null;
    });
    var b = bucketsFor_(MODEL.leadTimeBuckets || [], head.isos);
    periodsWithData = series.filter(function (v) { return v !== null; }).length;
    var conf = metricConfidence_(m.coverageGate || 0,
      b.nAll > 0 ? b.n / b.nAll : null, periodsWithData);
    html += flowTileHtml_(m, b.days.length ? flowMedian_(b.days) : null, {
      conf: b.nAll > 0 ? conf : null,
      trend: series, trendLabels: labels,
      context: b.n > 0
        ? "p85 " + fmtFlowVal_(flowP85_(b.days), "days") + " · " + b.n + " issues measured" + smallN_(b.n)
        : "no issues resolved this period",
      detail: [
        "Calendar days from Created to Resolution Date, non-epic issues, median of the period.",
        b.nAll > b.n ? (b.nAll - b.n) + " resolved issues had no usable created date" : "",
        unattribNote_("leadTime"),
      ],
    });
  })();

  // 2 · Cycle Time — declared absent (registry carries the reason).
  html += flowTileHtml_(reg.cycleTime || { name: "Cycle Time", status: "absent",
    absentReason: "needs first-In-Progress date from the Jira changelog — not yet exported" }, null, {});

  // 3 · Throughput — Σ estimate-hours delivered.
  (function () {
    var m = reg.throughput || { unit: "hrs", coverageGate: 0.6, name: "Throughput" };
    var series = trendPer.map(function (p) {
      var b = bucketsFor_(MODEL.throughputBuckets || [], p.isos);
      return b.nAll > 0 ? b.estHrs : null;
    });
    var b = bucketsFor_(MODEL.throughputBuckets || [], head.isos);
    var conf = metricConfidence_(m.coverageGate || 0,
      b.nAll > 0 ? b.nEst / b.nAll : null,
      series.filter(function (v) { return v !== null; }).length);
    html += flowTileHtml_(m, b.nAll > 0 ? b.estHrs : null, {
      conf: b.nAll > 0 ? conf : null,
      trend: series, trendLabels: labels,
      context: b.nAll > 0
        ? b.nEst + " of " + b.nAll + " resolved issues carried an estimate" + smallN_(b.nEst)
        : "no issues resolved this period",
      detail: [
        "Sum of Original Estimate hours on non-epic issues resolved in the period. Unestimated work delivers invisibly here — the fix is estimate fill.",
        unattribNote_("throughput"),
      ],
    });
  })();

  // 4+5 · Backlog and WIP — snapshot metrics: current value from the filtered
  // open book; trend from the exporter's whole-population snapshot log.
  (function () {
    var open = flowOpenFor_();
    var snaps = MODEL.meta.flowSnapshots || [];
    var snapsOk = !!MODEL.meta.flowSnapshotsAvailable;
    var unfiltered = flowUnfiltered_();
    // Trend at week grain regardless of the unit chips — snapshots are weekly
    // rows; month/quarter would need a last-snapshot-per-period walk that the
    // spec assigns to the same rule (last row of the period), so pick the
    // snapshot whose iso is the LAST iso of each displayed period.
    function snapTrend(field) {
      if (!snapsOk || !unfiltered) return null;
      var byIso = {};
      snaps.forEach(function (s) { byIso[s.iso] = s; });
      return trendPer.map(function (p) {
        for (var i = p.isos.length - 1; i >= 0; i--) {
          if (byIso[p.isos[i]]) return byIso[p.isos[i]][field];
        }
        return null;
      });
    }
    var noSnapNote = !snapsOk
      ? "trend pending — export predates Jira Backlog.js v3.9.0"
      : (!unfiltered ? "trend available for the full population only — clear filters to see it" : "");
    var histStart = snapsOk && snaps.length ? snaps[0].iso : null;

    var mB = reg.backlog || { unit: "hrs", coverageGate: 0.6, name: "Backlog (Inventory)" };
    var bTrend = snapTrend("backlogHrs");
    var bPoints = (bTrend || []).filter(function (v) { return v !== null; }).length;
    var bConf = metricConfidence_(mB.coverageGate || 0,
      open.todoN > 0 ? open.todoEst / open.todoN : null, Math.max(1, bPoints));
    html += flowTileHtml_(mB, open.todoN > 0 || open.todoEst > 0 ? open.todoHrs : (open.todoN === 0 ? 0 : null), {
      conf: open.todoN > 0 ? bConf : null,
      trend: bPoints >= 2 ? bTrend : null, trendLabels: labels,
      context: open.todoN + " items waiting to start · " +
        open.todoEst + " estimated" +
        (noSnapNote ? " · " + noSnapNote
          : (bPoints < 2 && histStart ? " · history accumulates from " + histStart : "")),
      detail: [
        "Σ max(0, Original Estimate − Time Spent) over open assigned non-epic issues in status category To Do.",
        "Trend is whole-population — the exporter's snapshot knows nothing of dashboard filters.",
        MODEL.meta.flowUncategorized ? MODEL.meta.flowUncategorized +
          " open items sit in a status category that is neither To Do nor In Progress — counted in neither tile" : "",
        unattribNote_("flowOpen"),
      ],
    });

    var mW = reg.wip || { unit: "items", coverageGate: 0, name: "Work In Progress" };
    var wTrend = snapTrend("wip");
    var wPoints = (wTrend || []).filter(function (v) { return v !== null; }).length;
    html += flowTileHtml_(mW, open.wipN, {
      conf: null,   // a count over rows that exist — a coverage chip would be noise
      trend: wPoints >= 2 ? wTrend : null, trendLabels: labels,
      context: open.wipN + " active items right now" +
        (noSnapNote ? " · " + noSnapNote
          : (wPoints < 2 && histStart ? " · history accumulates from " + histStart : "")),
      detail: [
        "Open, assigned, non-epic issues in status category In Progress — a point-in-time count, not a period rate.",
        "Trend is whole-population — same snapshot log as Backlog.",
      ],
    });
  })();

  // 6 · Flow Efficiency — declared absent.
  html += flowTileHtml_(reg.flowEfficiency || { name: "Flow Efficiency", status: "absent",
    absentReason: "needs per-status dwell time from the Jira changelog — not yet exported" }, null, {});

  // 7 · Bug Count — POPULATION-WIDE (registry deviation: bugs are routinely
  // unassigned at creation, so a roster join would silently drop most of them).
  (function () {
    var m = reg.bugCount || { unit: "bugs", coverageGate: 0, name: "Bug Count" };
    if (!MODEL.meta.bugsAvailable) {
      html += flowTileHtml_(m, null,
        { unavailable: "export predates Jira Backlog.js v3.9.0 — no Jira Bugs tab yet" });
      return;
    }
    var byIso = {};
    (MODEL.bugWeekly || []).forEach(function (w) { byIso[w.iso] = w; });
    function sumOver(isos, field) {
      var t = 0;
      isos.forEach(function (iso) { if (byIso[iso]) t += byIso[iso][field] || 0; });
      return t;
    }
    var series = trendPer.map(function (p) { return sumOver(p.isos, "nCreated"); });
    var created = sumOver(head.isos, "nCreated");
    var resolved = sumOver(head.isos, "nResolved");
    html += flowTileHtml_(m, created, {
      conf: null,
      trend: series, trendLabels: labels,
      context: resolved + " resolved this period — book " +
        (created > resolved ? "growing" : created < resolved ? "shrinking" : "flat") +
        " · population-wide, filters don't apply",
      detail: [
        "Bug issues created in the period, whole population. A zero here is a REAL zero — bugs are a countable absence.",
        "Noise-filtered at export: Won't Do / Duplicate / Canceled bugs were reports, not defects.",
        "Distinct from Quality/Rework — a bug feeds neither leg of the rework rate.",
      ],
    });
  })();

  el.innerHTML = html;
}

/** "N issues not attributable to a roster person" note, or "" when clean. */
function unattribNote_(key) {
  var u = (MODEL.meta.jiraUnattributed || {})[key] || 0;
  return u > 0 ? u + " issues excluded — assignee doesn't join the roster (window-wide count)" : "";
}
```

- [ ] **Step 6: Run both local suites**

Run: `node node-tests.js && node render-smoke.js`
Expected: node-tests all pass. render-smoke must ALSO pass unchanged — the new view renders only when `STATE.view === "flow"`, so no existing assertion should move. ⚠️ If render-smoke fails on a tab-count assertion (some blocks count `tabBar` children), the expected count includes the new 🌊 Flow tab — update the pinned number, that is the intended change.

- [ ] **Step 7: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/Dashboard.html"
git commit -m "feat(dh): 🌊 Flow tab — 5 live flow tiles + 2 declared-absent, neutral no-target grammar"
```

---

### Task 8: render-smoke coverage for the Flow view

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/render-smoke.js`
- Modify: `docs/superpowers/delivery-health-dashboard/Dashboard.html` (only if a bridge export is missing)

- [ ] **Step 1: Expose `renderFlow_` through the bridge**

In `render-smoke.js`, the `bridge` string (~line 89) lists exported functions. Add to it (next to `renderTiles_`):

```js
             " renderFlow_: renderFlow_, flowOpenFor_: flowOpenFor_, flowMedian_: flowMedian_," +
```

- [ ] **Step 2: Append the Flow assertion block at the END of render-smoke.js** (before any final "checks passed" console line — put it after the last existing IIFE):

```js
// ── 🌊 FLOW VIEW (spec 2026-08-05) ──────────────────────────
(function () {
  var M = C.getModel();
  var who = M.people[0].name;   // a real fixture person who passes open filters
  var W = WEEKS[WEEKS.length - 1];             // latest complete week
  M.leadTimeBuckets = [{ iso: W, person: who, n: 2, nAll: 3, days: [4, 10] }];
  M.throughputBuckets = [{ iso: W, person: who, nAll: 3, nEst: 2, estHrs: 12.5 }];
  M.flowOpenBuckets = [{ person: who, wipN: 3, todoN: 5, todoEst: 4, todoHrs: 22.5 }];
  M.bugWeekly = [{ iso: W, nCreated: 4, nResolved: 1 }];
  M.meta.bugsAvailable = true;
  M.meta.flowSnapshotsAvailable = true;
  M.meta.flowSnapshots = [
    { iso: WEEKS[0], at: "", wip: 2, backlogHrs: 30, backlogN: 6 },
    { iso: W,        at: "", wip: 3, backlogHrs: 22.5, backlogN: 5 },
  ];
  M.meta.flowUncategorized = 0;
  M.meta.jiraUnattributed = Object.assign({}, M.meta.jiraUnattributed,
    { leadTime: 0, throughput: 0, flowOpen: 0 });
  // Registry entries ride in meta.registry — give the renderer the real ones.
  M.meta.registry.metrics.leadTime = { id: "leadTime", name: "Lead Time", unit: "days",
    target: null, coverageGate: 0.9, coverageOf: "resolved non-epic issues carrying both dates" };
  M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
    target: null, coverageGate: 0.6, coverageOf: "resolved non-epic issues carrying an estimate" };
  M.meta.registry.metrics.backlog = { id: "backlog", name: "Backlog (Inventory)", unit: "hrs",
    target: null, coverageGate: 0.6, coverageOf: "waiting items carrying an estimate" };
  M.meta.registry.metrics.wip = { id: "wip", name: "Work In Progress", unit: "items",
    target: null, coverageGate: 0 };
  M.meta.registry.metrics.bugCount = { id: "bugCount", name: "Bug Count", unit: "bugs",
    target: null, coverageGate: 0 };
  M.meta.registry.metrics.cycleTime = { id: "cycleTime", name: "Cycle Time", status: "absent",
    absentReason: "needs first-In-Progress date from the Jira changelog — not yet exported" };
  M.meta.registry.metrics.flowEfficiency = { id: "flowEfficiency", name: "Flow Efficiency",
    status: "absent", absentReason: "needs per-status dwell time from the Jira changelog — not yet exported" };
  C.setModel(M);

  // The tab exists, routes, and is open to every role.
  var flowView = C.VIEWS.filter(function (v) { return v.id === "flow"; })[0];
  assert_(flowView && flowView.roles === null, "🌊 Flow is declared in VIEWS, all roles");

  C.setState("view", "flow");
  C.setState("period", "week");
  C.setState("periodIdx", null);
  C.renderAll_();
  var h = els["flowTiles"].innerHTML;

  assert_(h.indexOf("Lead Time") !== -1 && h.indexOf("7d") !== -1,
          "lead-time median of [4,10] renders 7d");
  assert_(h.indexOf("p85") !== -1, "p85 companion stated");
  assert_(h.indexOf("Throughput") !== -1 && h.indexOf("2 of 3 resolved issues carried an estimate") !== -1,
          "throughput states its estimated-share coverage in words");
  assert_(h.indexOf("Work In Progress") !== -1 && h.indexOf("3 active items right now") !== -1,
          "WIP counts the fixture's active items");
  assert_(h.indexOf("5 items waiting to start") !== -1, "backlog counts waiting items");
  assert_(h.indexOf("Bug Count") !== -1 && h.indexOf("4") !== -1 &&
          h.indexOf("population-wide") !== -1,
          "bug tile renders the created count and states it is unfiltered");
  // No-target grammar: flow tiles carry NO RAG verdict and NO vs-target line.
  assert_(h.indexOf("vs target") === -1, "target: null → no vs-target sentence anywhere");
  // Declared-absent tiles state their reason instead of a number.
  assert_(h.indexOf("Cycle Time") !== -1 && h.indexOf("Flow Efficiency") !== -1 &&
          h.split('tile ph').length >= 3,
          "Cycle Time + Flow Efficiency render as declared-absent placeholder tiles");

  // Missing feeds degrade, never error: kill both new feeds and re-render.
  M.meta.bugsAvailable = false;
  M.meta.flowSnapshotsAvailable = false;
  M.meta.flowSnapshots = [];
  C.setModel(M);
  C.renderAll_();
  var h2 = els["flowTiles"].innerHTML;
  assert_(h2.indexOf("export predates Jira Backlog.js v3.9.0") !== -1,
          "absent feeds name the exporter version, not an error");

  // Restore view state for any assertions that follow.
  C.setState("view", "exec");
  C.renderAll_();
})();
```

⚠️ Adaptation rules (fixture, not logic): if the existing fixture's people don't include buckets keyed by `M.people[0].name` passing default filters, or `WEEKS` is named differently, adapt the CONSTANTS to the file's fixture — never weaken an assertion. If an assertion fails because rendered wording differs from Task 7's strings, fix whichever side departed from this plan.

- [ ] **Step 3: Run it**

Run: `node render-smoke.js` — Expected: passes with a higher check count than before (the file prints its total).

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/render-smoke.js" "docs/superpowers/delivery-health-dashboard/Dashboard.html"
git commit -m "test(dh): render-smoke coverage for the 🌊 Flow view — grammar, absence, degradation"
```

---

### Task 9: README + deploy checklist

**Files:**
- Modify: `docs/superpowers/delivery-health-dashboard/README.md`

- [ ] **Step 1: Document the view**

In README.md's navigation table (the five-tab table under "Navigation — one view per question"), add a row after 📈 Trends/🎯 Headroom:

```markdown
| 🌊 **Flow** | "How does work move through the system?" | Seven cards: Lead Time, Throughput, Backlog, WIP, Bug Count (live, `target: null` — informational until targets are agreed) plus Cycle Time and Flow Efficiency (declared absent — the changelog is not exported, `FETCH_CHANGELOG` off). Non-epic grain throughout. Backlog/WIP trends come from the exporter's `Flow Snapshots` append log and accumulate from the first v3.9.0 run; under active filters the snapshot trend hides (it is whole-population). Bug Count is population-wide by design — bugs are routinely unassigned at creation. Spec: `docs/superpowers/specs/2026-08-05-flow-metrics-design.md`. |
```

In the "Data sources" table, add:

```markdown
| Jira Bugs | same | `Jira Bugs` | Bug Count (created/resolved per week) — Jira Backlog.js v3.9.0, noise-filtered |
| Flow Snapshots | same | `Flow Snapshots` | WIP/Backlog trend — one appended row per export run, 52-week retention |
```

- [ ] **Step 2: Commit**

```bash
git add "docs/superpowers/delivery-health-dashboard/README.md"
git commit -m "docs(dh): README — 🌊 Flow tab, new data-source tabs"
```

- [ ] **Step 3: Hand the user the deploy checklist** (manual — GAS deploys are theirs; do NOT attempt them):

```
Deploy order (spec §8):
1. Paste Jira Backlog.js v3.9.0 into its GAS project → run runJiraEpicTracker
   → verify "Jira Bugs" (rows + Generated footer) and "Flow Snapshots" (1 new row) tabs.
2. Paste Code.js + Dashboard.html into the delivery-health GAS project → deploy new version.
3. Run bustDeliveryCache_() in the GAS editor (schema v21 also treats old cache as a miss,
   but the bust makes it immediate for every scope).
4. Open the dashboard → 🌊 Flow tab: 5 live tiles, Cycle Time + Flow Efficiency absent,
   Backlog/WIP saying "history accumulates from <this week>".
```

---

## Self-Review (run after writing, fixes applied inline)

1. **Spec coverage** — §3.1 Lead Time (Task 3+7), §3.2 Cycle Time absent (Tasks 6+7), §3.3 Throughput (3+7), §3.4/3.5 Backlog+WIP incl. snapshot trend + filter-hides-sparkline (2, 4, 6, 7), §3.6 Flow Efficiency absent (6+7), §3.7 Bug Count + noise rule (1, 5, 6, 7), §3.8 registry entries + gates (6), §4.1 bugs tab (1), §4.2 snapshot log + verbatim-definition note + retention + last-per-week (2, 5), §5.1 readers/created/schema-bump (3, 5, 6), §5.2 VIEWS/cards/PNG (7), §6 error table (5, 6, 7 — every row has a code path), §7 tests (3, 4, 5, 6, 8), §8 deploy order (9). Gap check: spec §5.2 "Backlog/WIP trends resolve last-snapshot-per-period at the selected unit" — covered by `snapTrend`'s last-iso-of-period walk in Task 7. ✔
2. **Placeholders** — none: every step carries code or an exact command. The two ⚠️ adaptation notes (resolver argument name in Task 6 Step 6b, fixture names in Task 8) are locate-by-search instructions with the target expression stated, not deferred design. ✔
3. **Type consistency** — bucket fields `days/nAll/n`, `estHrs/nEst/nAll`, `wipN/todoN/todoEst/todoHrs`, `bugWeekly {iso,nCreated,nResolved}`, `snaps {iso,at,wip,backlogHrs,backlogN}` are identical across builder (Tasks 3–5), payload (Task 6), `bucketsFor_`/renderer (Task 7) and fixtures (Task 8). `metricConfidence_(gate, coverage, periods)` matches the existing signature. `CONFIG_DH.JIRA_BUGS_SHEET`/`FLOW_SNAP_SHEET` names match between Tasks 5 and 6e; `CONFIGJ.BUGS_SHEET`/`FLOW_SNAP_SHEET` match between Tasks 1 and 2. ✔
