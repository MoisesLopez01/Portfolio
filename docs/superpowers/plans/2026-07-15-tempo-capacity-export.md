# Tempo Capacity Export (TempoCapacityTime.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `TempoCapacityTime.js`, a GAS module that maintains a "Capacity Tempo" sheet (rocketeer × ISO week capacity hours from Tempo work schedules) where past weeks are frozen and the next 4 future weeks are refreshed by a Friday trigger — enabling utilization = Tracked ÷ Capacity.

**Spec:** `docs/superpowers/specs/2026-07-15-tempo-capacity-export-design.md` (read it first — decisions and edge cases live there).

**Architecture:** One new standalone file reusing `TempoPlanExport.js` globals (GAS shares one global scope per project). All decision logic (window math, week bucketing, grid merge) is pure functions with Node-runnable tests; Sheets/UrlFetch I/O is thin wrappers around them. The sheet is read → merged in memory → rewritten in one `setValues()` only after a fully successful fetch, so a failed run can never damage stored history.

**Tech Stack:** Google Apps Script (V8), Tempo REST v4 (`/4/user-schedule`), Jira REST v2 (display names), Node for unit tests (eval both GAS files with a stubbed `Logger` — same pattern as the PS test suites).

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `TempoCapacityTime.js` | **Create** | Everything new: `CONFIGCap`, window math, schedule fetch + bucketing, sheet read-back, pure merge, sheet writer, entry point, Friday trigger, probe diagnostic, `_test_*` functions |
| `docs/superpowers/tests/capacity-node-tests.js` | **Create** | Node runner: evals `TempoPlanExport.js` + `TempoCapacityTime.js` with stubbed `Logger`, calls `runCapacityTests()` |
| `TempoPlanExport.js` | **Never modified** | Provides shared globals: `MERGE_MAP`, `EXCLUDE_IDS`, `CONFIGPlan.API_BATCH_SIZE`, `getCredentials_()`, `fetchAllTeamMembers_()`, `fetchUserNames_()`, `buildWeekRanges_()`, `isoWeekLabel_()`, `formatWeekLabel_()`, `parseDateLocal_()`, `fmtDate_()`, `minDate_()`, `round2_()` |

Naming: private helpers get a trailing underscore; test entry points use the project's `_test_*` / `runCapacityTests` convention; week labels are always `YYYY.WNN`.

---

### Task 1: Test harness + window math (`computeCapacityWindow_`, `mondayOfIsoWeek_`)

**Files:**
- Create: `TempoCapacityTime.js`
- Create: `docs/superpowers/tests/capacity-node-tests.js`

- [ ] **Step 1: Create the Node test runner**

Write `docs/superpowers/tests/capacity-node-tests.js`:

```js
// Node runner for TempoCapacityTime.js pure-function tests.
// Usage: node docs/superpowers/tests/capacity-node-tests.js
// Evals both GAS files in one scope (they share GAS global scope in production)
// with a stubbed Logger, then runs the _test_* suite.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..", "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

global.Logger = { log: (m) => console.log(m) };

const src = [
  read("TempoPlanExport.js"),
  read("TempoCapacityTime.js"),
  "\nrunCapacityTests();\n",
].join("\n;\n");

try {
  eval(src);
} catch (e) {
  console.error(e.stack || e.message);
  process.exit(1);
}
```

- [ ] **Step 2: Create `TempoCapacityTime.js` with header, CONFIG, assert helper, and the failing window test**

```js
// ============================================================
// TempoCapacityTime.js
// Exports Tempo capacity (work-schedule required hours) for all
// Rocketeers into the "Capacity Tempo" sheet: one row per person,
// one column per ISO week. Past weeks are FROZEN; each Friday run
// refreshes only the next CONFIGCap.FUTURE_WEEKS future weeks.
// Downstream: utilization = Tracked ÷ Capacity, joined on (User, Week).
// Spec: docs/superpowers/specs/2026-07-15-tempo-capacity-export-design.md
//
// SHARED GLOBALS (from TempoPlanExport.js — do not redeclare):
//   MERGE_MAP, EXCLUDE_IDS, CONFIGPlan (API_BATCH_SIZE only),
//   getCredentials_(), fetchAllTeamMembers_(), fetchUserNames_(),
//   buildWeekRanges_(), isoWeekLabel_(), formatWeekLabel_(),
//   parseDateLocal_(), fmtDate_(), minDate_(), round2_()
// ============================================================

const CONFIGCap = {
  SCRIPT_LABEL: "Tempo Capacity Reports",
  SHEET_NAME: "Capacity Tempo",   // output tab — dashboard joins on (User, Week)
  FUTURE_WEEKS: 4,                // full future ISO weeks refreshed each run
  BACKFILL_FROM: "2026-03-30",    // first-run backfill start — must stay a Monday
  TRIGGER_HOUR: 8,                // Friday trigger hour (24h clock)
  HEADER_BG: "#4472C4",
  HEADER_FONT: "#FFFFFF",
  TOTAL_ROW_BG: "#D6E4F0",
};

// ── SECTION: WINDOW MATH (pure — Node-tested) ────────────────

// (implementations added in later steps)

// ── SECTION: TESTS ────────────────────────────────────────────

/**
 * Deep-equality assert for the _test_* suite. Throws on mismatch so both
 * the GAS editor run and the Node runner fail loudly.
 * @param {*} actual
 * @param {*} expected
 * @param {string} msg
 */
function assertEq_(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`❌ ${msg}\n   expected: ${e}\n   actual:   ${a}`);
  }
  Logger.log(`   ✅ ${msg}`);
}

/** Window math: backfill, normal Friday run, gap self-heal, Monday edge. */
function _test_capacityWindow_() {
  Logger.log("🧪 _test_capacityWindow_");

  // mondayOfIsoWeek_ inverts isoWeekLabel_ (2026-03-30 is the Monday of 2026.W14).
  assertEq_(fmtDate_(mondayOfIsoWeek_("2026.W14")), "2026-03-30", "W14 Monday is 2026-03-30");
  assertEq_(isoWeekLabel_(mondayOfIsoWeek_("2026.W29")), "2026.W29", "ISO label round-trip");

  const friday = new Date("2026-07-17T09:00:00"); // Friday of 2026.W29

  // Empty sheet → backfill from BACKFILL_FROM; to = Sunday of W33 (next Mon + 4 wks − 1 day).
  const w1 = computeCapacityWindow_([], friday);
  assertEq_(fmtDate_(w1.from), CONFIGCap.BACKFILL_FROM, "empty sheet backfills from BACKFILL_FROM");
  assertEq_(w1.backfill, true, "backfill flag set");
  assertEq_(fmtDate_(w1.to), "2026-08-16", "to = Sunday of 4th future week (W33)");

  // Normal run: stored through W33 → from = next Monday (W30). Current week W29 stays frozen.
  const w2 = computeCapacityWindow_(["2026.W28", "2026.W29", "2026.W33"], friday);
  assertEq_(fmtDate_(w2.from), "2026-07-20", "normal from = next Monday");
  assertEq_(w2.backfill, false, "no backfill flag on normal run");

  // Gap self-heal: run on Friday of W31 but stored only through W29 →
  // from reaches back to Monday of W30 (unstored weeks are not frozen).
  const w3 = computeCapacityWindow_(["2026.W28", "2026.W29"], new Date("2026-07-31T09:00:00"));
  assertEq_(fmtDate_(w3.from), "2026-07-20", "gap heal: from = Monday after last stored week");
  assertEq_(fmtDate_(w3.to), "2026-08-30", "gap heal: to still = 4th future Sunday");

  // Monday run: "next Monday" is STRICTLY after today; gap rule may pull from back to today.
  const w4 = computeCapacityWindow_(["2026.W28"], new Date("2026-07-13T09:00:00"));
  assertEq_(fmtDate_(w4.from), "2026-07-13", "Monday run heals current unstored week");
}

/** GAS-editor & Node entry point — grows as tasks add suites. */
function runCapacityTests() {
  _test_capacityWindow_();
  Logger.log("✅ All capacity tests passed");
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: FAIL with `mondayOfIsoWeek_ is not defined`, exit code 1.

- [ ] **Step 4: Implement `mondayOfIsoWeek_` and `computeCapacityWindow_`**

Replace the `// (implementations added in later steps)` placeholder under WINDOW MATH with:

```js
/**
 * Returns the local-midnight Monday of an ISO week label ("YYYY.WNN").
 * Inverse of isoWeekLabel_ (TempoPlanExport.js). ISO week 1 contains Jan 4.
 * @param {string} isoLabel - e.g. "2026.W30"
 * @returns {Date}
 */
function mondayOfIsoWeek_(isoLabel) {
  const m = /^(\d{4})\.W(\d{2})$/.exec(String(isoLabel));
  if (!m) throw new Error(`❌ [mondayOfIsoWeek_] Bad ISO week label: "${isoLabel}"`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const dayNum = (jan4.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(year, 0, 4 - dayNum); // Monday of ISO week 1
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

/**
 * Computes the [from, to] fetch window for a run.
 *
 * FREEZE RULE: stored weeks starting before `from` are never rewritten.
 *   - Normal run:   from = next Monday strictly after `today` → future weeks only;
 *                    the current week keeps what last Friday's run captured.
 *   - Gap self-heal: if stored data ends early (missed Fridays), from reaches
 *                    back to the Monday after the last stored week — those gap
 *                    weeks hold no data, so filling them never breaks the freeze.
 *   - First run:     empty sheet → historical backfill from CONFIGCap.BACKFILL_FROM.
 *   - to is always the Sunday closing the FUTURE_WEEKSth future week.
 *
 * Pure function (Node-tested): no Sheets/UrlFetch access.
 *
 * @param {string[]} existingIsoWeeks - ISO labels already stored in the sheet
 * @param {Date}     today            - run date (injected for testability)
 * @returns {{ from: Date, to: Date, backfill: boolean }}
 */
function computeCapacityWindow_(existingIsoWeeks, today) {
  const nextMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  nextMonday.setDate(nextMonday.getDate() + (((8 - today.getDay()) % 7) || 7));

  let from;
  let backfill = false;
  if (!existingIsoWeeks || existingIsoWeeks.length === 0) {
    from = parseDateLocal_(CONFIGCap.BACKFILL_FROM);
    backfill = true;
  } else {
    const lastIso = existingIsoWeeks.slice().sort().pop(); // "YYYY.WNN" sorts lexically
    const afterLast = mondayOfIsoWeek_(lastIso);
    afterLast.setDate(afterLast.getDate() + 7);
    from = minDate_(nextMonday, afterLast);
  }

  const to = new Date(nextMonday.getTime());
  to.setDate(to.getDate() + CONFIGCap.FUTURE_WEEKS * 7 - 1);

  return { from, to, backfill };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: `✅ All capacity tests passed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add TempoCapacityTime.js docs/superpowers/tests/capacity-node-tests.js
git commit -m "feat(capacity): window math + Node test harness for Tempo capacity export"
```

---

### Task 2: Schedule bucketing (`scheduleToWeeklyHours_`)

**Files:**
- Modify: `TempoCapacityTime.js` (add function + test; extend `runCapacityTests`)

- [ ] **Step 1: Add the failing test**

Add to the TESTS section of `TempoCapacityTime.js`:

```js
/** Daily user-schedule entries → ISO-week hour buckets. */
function _test_scheduleBucketing_() {
  Logger.log("🧪 _test_scheduleBucketing_");

  const days = [
    { date: "2026-07-20", requiredSeconds: 28800 }, // Mon W30 — 8h
    { date: "2026-07-21", requiredSeconds: 28800 }, // Tue W30 — 8h
    { date: "2026-07-25", requiredSeconds: 0 },     // Sat W30 — 0h day
    { date: "2026-07-27", requiredSeconds: 14400 }, // Mon W31 — half day
  ];
  assertEq_(scheduleToWeeklyHours_(days), { "2026.W30": 16, "2026.W31": 4 }, "seconds bucketed to ISO weeks as hours");

  // A fully zero-hour week must be PRESENT as 0 (scheduled zero), never dropped —
  // blank means "unknown" downstream, 0 means "not expected to work".
  assertEq_(
    scheduleToWeeklyHours_([{ date: "2026-07-20", requiredSeconds: 0 }]),
    { "2026.W30": 0 },
    "all-zero week present as explicit 0",
  );

  assertEq_(scheduleToWeeklyHours_([]), {}, "empty schedule → empty buckets");
  assertEq_(scheduleToWeeklyHours_([{ notADate: true }]), {}, "malformed entries skipped");
}
```

And in `runCapacityTests()` add `_test_scheduleBucketing_();` after `_test_capacityWindow_();`.

- [ ] **Step 2: Run to verify it fails**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: FAIL with `scheduleToWeeklyHours_ is not defined`.

- [ ] **Step 3: Implement**

Add a new section after WINDOW MATH:

```js
// ── SECTION: SCHEDULE BUCKETING (pure — Node-tested) ─────────

/**
 * Buckets Tempo user-schedule day entries into ISO-week hour totals.
 * Zero-second days still create/keep their week key: an explicit 0 means
 * "scheduled zero hours" (e.g. full-week holiday), which downstream
 * utilization must distinguish from a blank ("unknown") cell.
 * @param {Array<{date: string, requiredSeconds: number}>} days
 * @returns {Object} isoWeekLabel → hours
 */
function scheduleToWeeklyHours_(days) {
  const weeks = {};
  (days || []).forEach((d) => {
    if (!d || !d.date) return;
    const iso = isoWeekLabel_(parseDateLocal_(d.date));
    weeks[iso] = (weeks[iso] || 0) + (d.requiredSeconds || 0) / 3600;
  });
  return weeks;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: `✅ All capacity tests passed`.

- [ ] **Step 5: Commit**

```bash
git add TempoCapacityTime.js
git commit -m "feat(capacity): bucket user-schedule days into ISO-week hours"
```

---

### Task 3: Pure merge (`mergeCapacityGrid_`)

**Files:**
- Modify: `TempoCapacityTime.js` (add function + test; extend `runCapacityTests`)

- [ ] **Step 1: Add the failing test**

Add to the TESTS section:

```js
/** Freeze boundary, new hire, leaver, name refresh, blank-vs-zero. */
function _test_capacityMerge_() {
  Logger.log("🧪 _test_capacityMerge_");

  const existing = {
    "id-alice": { name: "Alice", weeks: { "2026.W28": 40, "2026.W29": 40 } },
    "id-bob":   { name: "Bob",   weeks: { "2026.W28": 40, "2026.W29": 32 } },
    "id-carol": { name: "Carol", weeks: { "2026.W28": 40, "2026.W29": 40 } }, // left the team
  };
  const fetched = {
    "id-alice": { name: "Alicia Renamed", weeks: { "2026.W30": 40, "2026.W31": 40 } },
    "id-bob":   { name: "id-bob",         weeks: { "2026.W30": 24, "2026.W31": 0 } }, // Jira name lookup failed
    "id-dave":  { name: "Dave",           weeks: { "2026.W30": 40, "2026.W31": 40 } }, // new hire
  };

  const g = mergeCapacityGrid_(existing, fetched, ["2026.W30", "2026.W31"]);

  assertEq_(g.isoWeeks, ["2026.W28", "2026.W29", "2026.W30", "2026.W31"], "column union, ISO-sorted");

  const byId = {};
  g.rows.forEach((r) => { byId[r.accountId] = r; });

  assertEq_(byId["id-alice"].name, "Alicia Renamed", "fetched display name wins");
  assertEq_(
    byId["id-alice"].weeks,
    { "2026.W28": 40, "2026.W29": 40, "2026.W30": 40, "2026.W31": 40 },
    "frozen weeks kept + window weeks overwritten",
  );
  assertEq_(byId["id-bob"].name, "Bob", "stored name kept when lookup fell back to accountId");
  assertEq_(byId["id-bob"].weeks["2026.W31"], 0, "explicit scheduled-zero preserved in window");
  assertEq_(byId["id-bob"].weeks["2026.W29"], 32, "frozen week value untouched");
  assertEq_(byId["id-carol"].weeks, { "2026.W28": 40, "2026.W29": 40 }, "leaver: history kept, window cells blank");
  assertEq_(byId["id-dave"].weeks, { "2026.W30": 40, "2026.W31": 40 }, "new hire appended with blank past");
  assertEq_(g.rows.map((r) => r.name), ["Alicia Renamed", "Bob", "Carol", "Dave"], "rows sorted by display name");

  // FREEZE RULE hard check: a fetched value for a NON-window week is ignored.
  const g2 = mergeCapacityGrid_(
    { "id-x": { name: "X", weeks: { "2026.W29": 40 } } },
    { "id-x": { name: "X", weeks: { "2026.W29": 8, "2026.W30": 40 } } },
    ["2026.W30"],
  );
  assertEq_(g2.rows[0].weeks, { "2026.W29": 40, "2026.W30": 40 }, "fetched value outside window ignored (freeze)");

  // Empty sheet (first run / backfill): fetched becomes the whole grid.
  const g3 = mergeCapacityGrid_({}, { "id-a": { name: "A", weeks: { "2026.W14": 40 } } }, ["2026.W14"]);
  assertEq_(g3.isoWeeks, ["2026.W14"], "empty-sheet grid takes fetched columns");
  assertEq_(g3.rows.length, 1, "empty-sheet grid takes fetched rows");
}
```

And in `runCapacityTests()` add `_test_capacityMerge_();` after `_test_scheduleBucketing_();`.

- [ ] **Step 2: Run to verify it fails**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: FAIL with `mergeCapacityGrid_ is not defined`.

- [ ] **Step 3: Implement**

Add a new section after SCHEDULE BUCKETING:

```js
// ── SECTION: GRID MERGE (pure — Node-tested) ─────────────────

/**
 * Merges the stored sheet model with freshly fetched window data.
 *
 * FREEZE RULE (single source of truth for immutability):
 *   week ∈ windowIsoWeeks → fetched value wins (absent user/week → blank);
 *   week ∉ windowIsoWeeks → stored value wins; fetched values there are IGNORED.
 *
 * Users are unioned: new hires append (blank past), leavers keep frozen
 * history with blank window cells. `undefined` (no key) = blank = "unknown";
 * an explicit 0 = "scheduled zero hours" and IS written.
 *
 * @param {Object} existingRows   - accountId → { name, weeks: {iso → hrs} }
 * @param {Object} fetched        - accountId → { name, weeks: {iso → hrs} }
 * @param {string[]} windowIsoWeeks - ISO labels covered by this fetch
 * @returns {{ isoWeeks: string[], rows: Array<{accountId, name, weeks}> }}
 */
function mergeCapacityGrid_(existingRows, fetched, windowIsoWeeks) {
  const windowSet = new Set(windowIsoWeeks);

  const isoSet = new Set(windowIsoWeeks);
  Object.keys(existingRows).forEach((id) => {
    Object.keys(existingRows[id].weeks).forEach((iso) => isoSet.add(iso));
  });
  const isoWeeks = Array.from(isoSet).sort(); // "YYYY.WNN" sorts chronologically

  const ids = new Set(Object.keys(existingRows).concat(Object.keys(fetched)));
  const rows = [];
  ids.forEach((id) => {
    const oldRow = existingRows[id];
    const newRow = fetched[id];

    // Fetched display name wins unless the Jira lookup fell back to the raw id.
    const name =
      newRow && newRow.name && newRow.name !== id
        ? newRow.name
        : (oldRow && oldRow.name) || (newRow && newRow.name) || id;

    const weeks = {};
    isoWeeks.forEach((iso) => {
      if (windowSet.has(iso)) {
        if (newRow && iso in newRow.weeks) weeks[iso] = newRow.weeks[iso];
      } else if (oldRow && iso in oldRow.weeks) {
        weeks[iso] = oldRow.weeks[iso];
      }
    });

    rows.push({ accountId: id, name: name, weeks: weeks });
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { isoWeeks: isoWeeks, rows: rows };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: `✅ All capacity tests passed`.

- [ ] **Step 5: Commit**

```bash
git add TempoCapacityTime.js
git commit -m "feat(capacity): pure grid merge with freeze rule, new-hire/leaver handling"
```

---

### Task 4: GAS I/O — sheet read/write, schedule fetch, entry point, trigger, probe

No new Node tests (these functions touch `SpreadsheetApp`/`UrlFetchApp`), but the Node runner still evals the whole file, so it doubles as a syntax check.

**Files:**
- Modify: `TempoCapacityTime.js`

- [ ] **Step 1: Add endpoint table + sheet read-back**

Add after the GRID MERGE section:

```js
// ── SECTION: TEMPO ENDPOINT ──────────────────────────────────

/**
 * Endpoint candidates, tried in order by resolveCapacityEndpoint_().
 * user-schedule is the documented Tempo v4 source of requiredSeconds/day;
 * the capacity path is a legacy fallback observed in some workspaces.
 * limit=1000 comfortably covers the ~140-day backfill window; a
 * metadata.next in the response is logged as an undercount warning.
 */
const CAPACITY_ENDPOINTS_ = [
  {
    key: "user-schedule",
    url: (id, from, to) =>
      `https://api.tempo.io/4/user-schedule/${encodeURIComponent(id)}?from=${from}&to=${to}&limit=1000`,
  },
  {
    key: "capacity",
    url: (id, from, to) =>
      `https://api.tempo.io/4/capacity/users/${encodeURIComponent(id)}?from=${from}&to=${to}&limit=1000`,
  },
];

/**
 * Probes the candidates with one real worker and returns the first that
 * answers 200. Throws (sheet untouched) if none work.
 * @param {string} tempoToken
 * @param {string} probeUserId
 * @param {string} fromStr - "YYYY-MM-DD"
 * @param {string} toStr   - "YYYY-MM-DD"
 * @returns {{ key: string, url: Function }}
 */
function resolveCapacityEndpoint_(tempoToken, probeUserId, fromStr, toStr) {
  for (let i = 0; i < CAPACITY_ENDPOINTS_.length; i++) {
    const ep = CAPACITY_ENDPOINTS_[i];
    const res = UrlFetchApp.fetch(ep.url(probeUserId, fromStr, toStr), {
      method: "get",
      headers: { Authorization: `Bearer ${tempoToken}` },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) {
      Logger.log(`✅ [resolveCapacityEndpoint_] Using "${ep.key}" endpoint.`);
      return ep;
    }
    Logger.log(`⚠️ [resolveCapacityEndpoint_] "${ep.key}" → HTTP ${code}; trying next candidate.`);
  }
  throw new Error(
    "❌ No Tempo capacity endpoint available (user-schedule and capacity both failed). Sheet left untouched.",
  );
}

// ── SECTION: SHEET READ-BACK ─────────────────────────────────

/**
 * Reads the existing "Capacity Tempo" sheet into the in-memory model.
 * Missing sheet, no data rows, or an unrecognized layout (pre-schema tab)
 * all return the empty model → the run enters backfill mode.
 * Non-numeric / blank week cells are skipped (blank = unknown).
 * @returns {{ isoWeeks: string[], rows: Object }} rows: accountId → {name, weeks}
 */
function readCapacitySheet_() {
  const empty = { isoWeeks: [], rows: {} };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIGCap.SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 3) return empty;

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();
  const isoRow = values[0];
  const hdrRow = values[1];

  if (hdrRow[0] !== "Account ID" || hdrRow[1] !== "User") {
    Logger.log(
      `⚠️ [readCapacitySheet_] Unrecognized "${CONFIGCap.SHEET_NAME}" layout — treating as empty (backfill mode).`,
    );
    return empty;
  }

  // Week columns: C … last-1 (final column is "Total (hrs)").
  const isoWeeks = [];
  const colByIso = {};
  for (let c = 2; c < hdrRow.length - 1; c++) {
    const iso = String(isoRow[c] || "").trim();
    if (/^\d{4}\.W\d{2}$/.test(iso)) {
      isoWeeks.push(iso);
      colByIso[iso] = c;
    }
  }

  const rows = {};
  for (let r = 2; r < values.length; r++) {
    const accountId = String(values[r][0] || "").trim();
    if (!accountId) continue; // footer (TOTAL) and stray rows have no accountId
    const weeks = {};
    isoWeeks.forEach((iso) => {
      const v = values[r][colByIso[iso]];
      if (typeof v === "number") weeks[iso] = v;
    });
    rows[accountId] = { name: String(values[r][1] || "").trim(), weeks: weeks };
  }

  return { isoWeeks: isoWeeks, rows: rows };
}
```

- [ ] **Step 2: Add the batched schedule fetch**

```js
// ── SECTION: SCHEDULE FETCH ──────────────────────────────────

/**
 * Fetches every rocketeer's work schedule for the window and buckets it
 * into ISO-week hours. One request per person for the whole window
 * (daily results are bucketed locally) — ~60 requests/run, not ~300.
 *
 * MERGE_MAP note (differs from the planned/tracked exports on purpose):
 * capacity is per PERSON, not per account. A MERGE_MAP secondary carries
 * its own default 8 h/day Tempo schedule, so SUMMING schedules would
 * double the person's capacity. The list is collapsed to unique effective
 * (primary) IDs and each schedule is fetched exactly once.
 *
 * Per-user non-200 → that user is absent from the result (window cells
 * stay blank, never zeroed). All users failing → throw, sheet untouched.
 *
 * @param {string}   tempoToken
 * @param {{url: Function, key: string}} endpoint - from resolveCapacityEndpoint_
 * @param {string[]} workerIds - raw IDs from fetchAllTeamMembers_
 * @param {Object}   userMap   - accountId → display name
 * @param {string}   fromStr   - "YYYY-MM-DD"
 * @param {string}   toStr     - "YYYY-MM-DD"
 * @returns {Object} effectiveAccountId → { name, weeks: {iso → hrs} }
 */
function fetchSchedulesForWindow_(tempoToken, endpoint, workerIds, userMap, fromStr, toStr) {
  const effectiveIds = [];
  const seen = new Set();
  workerIds.forEach((rawId) => {
    const eff = MERGE_MAP[rawId] || rawId;
    if (!seen.has(eff)) {
      seen.add(eff);
      effectiveIds.push(eff);
    }
  });

  const requests = effectiveIds.map((id) => ({
    url: endpoint.url(id, fromStr, toStr),
    method: "get",
    headers: { Authorization: `Bearer ${tempoToken}` },
    muteHttpExceptions: true,
  }));

  Logger.log(
    `ℹ️ [fetchSchedulesForWindow_] ${requests.length} schedule requests (${fromStr} → ${toStr}) via "${endpoint.key}"`,
  );

  const fetched = {};
  let okCount = 0;
  let errCount = 0;

  for (let b = 0; b < requests.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const responses = UrlFetchApp.fetchAll(
      requests.slice(b, b + CONFIGPlan.API_BATCH_SIZE),
    );
    responses.forEach((res, i) => {
      const id = effectiveIds[b + i];
      if (res.getResponseCode() !== 200) {
        errCount++;
        Logger.log(
          `   ⚠️ Schedule HTTP ${res.getResponseCode()} for ${id}: ${res.getContentText().substring(0, 120)}`,
        );
        return; // absent from `fetched` → window cells stay blank
      }
      const body = JSON.parse(res.getContentText());
      if (body.metadata && body.metadata.next) {
        Logger.log(
          `   ⚠️ Schedule for ${id} paginated beyond limit — window may undercount; shorten BACKFILL window or raise limit.`,
        );
      }
      fetched[id] = {
        name: userMap[id] || id,
        weeks: scheduleToWeeklyHours_(body.results || []),
      };
      okCount++;
    });
  }

  Logger.log(`ℹ️ [fetchSchedulesForWindow_] ok=${okCount} failed=${errCount} of ${effectiveIds.length}`);
  if (okCount === 0) {
    throw new Error("❌ Every schedule request failed — aborting without touching the sheet.");
  }
  return fetched;
}
```

- [ ] **Step 3: Add the sheet writer**

```js
// ── SECTION: SHEET WRITE ─────────────────────────────────────

/**
 * Rewrites the "Capacity Tempo" sheet from a merged grid in one pass.
 * Layout: A=Account ID (hidden), B=User, C… ISO week columns, last=Total (hrs).
 * Row 1 = ISO labels, row 2 = date-range labels; TOTAL footer; frozen 2×2.
 * Blank cell = unknown (skipped in sums); explicit 0 = scheduled zero.
 * Only called AFTER a successful fetch — the sheet is never cleared earlier.
 * @param {{ isoWeeks: string[], rows: Array }} grid - from mergeCapacityGrid_
 */
function writeCapacitySheet_(grid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGCap.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGCap.SHEET_NAME);
  sheet.clear();

  const isoWeeks = grid.isoWeeks;
  const totalCols = 2 + isoWeeks.length + 1;

  const isoRow = ["", ""];
  const hdrRow = ["Account ID", "User"];
  isoWeeks.forEach((iso) => {
    const monday = mondayOfIsoWeek_(iso);
    const sunday = new Date(monday.getTime());
    sunday.setDate(sunday.getDate() + 6);
    isoRow.push(iso);
    hdrRow.push(formatWeekLabel_(monday, sunday));
  });
  isoRow.push("");
  hdrRow.push("Total (hrs)");

  const dataRows = grid.rows.map((row) => {
    let total = 0;
    const cells = isoWeeks.map((iso) => {
      const v = row.weeks[iso];
      if (typeof v !== "number") return ""; // blank = unknown, never coerced to 0
      total += v;
      return round2_(v);
    });
    return [row.accountId, row.name].concat(cells, [round2_(total)]);
  });

  const footer = new Array(totalCols).fill("");
  footer[1] = "TOTAL";
  for (let c = 2; c < totalCols; c++) {
    let sum = 0;
    dataRows.forEach((r) => {
      if (typeof r[c] === "number") sum += r[c];
    });
    footer[c] = round2_(sum);
  }

  const hdr = sheet.getRange(1, 1, 2, totalCols);
  hdr.setValues([isoRow, hdrRow]);
  hdr
    .setFontWeight("bold")
    .setBackground(CONFIGCap.HEADER_BG)
    .setFontColor(CONFIGCap.HEADER_FONT);

  if (dataRows.length > 0) {
    sheet.getRange(3, 1, dataRows.length, totalCols).setValues(dataRows);
  }
  const footRange = sheet.getRange(3 + dataRows.length, 1, 1, totalCols);
  footRange.setValues([footer]);
  footRange.setFontWeight("bold").setBackground(CONFIGCap.TOTAL_ROW_BG);

  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);
  sheet.hideColumns(1);
  sheet.autoResizeColumns(2, totalCols - 1);

  Logger.log(
    `ℹ️ [writeCapacitySheet_] rows=${dataRows.length} weeks=${isoWeeks.length} grand total=${footer[totalCols - 1]} hrs`,
  );
}
```

- [ ] **Step 4: Add the entry point, trigger installer, and probe diagnostic**

Add at the top of the file, right after `CONFIGCap` (main entry point stays near the top, matching the other Tempo exports):

```js
// ── SECTION: MAIN ENTRY POINT ────────────────────────────────

/**
 * Maintains the "Capacity Tempo" sheet. Safe to re-run any time (idempotent
 * for the same window). Reads the stored grid, fetches only the refresh
 * window (next Monday → +FUTURE_WEEKS, backfill/gap-heal when needed),
 * merges in memory, and rewrites the sheet in one pass.
 * Any fetch-stage failure throws BEFORE the sheet is touched.
 * Install the Friday trigger once via createCapacityWeeklyTrigger().
 */
function fetchTempoCapacity() {
  try {
    Logger.log(`🕐 [fetchTempoCapacity] Started at ${new Date().toISOString()}`);

    const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

    const existing = readCapacitySheet_();
    const win = computeCapacityWindow_(existing.isoWeeks, new Date());
    const fromStr = fmtDate_(win.from);
    const toStr = fmtDate_(win.to);
    Logger.log(
      `ℹ️ Window: ${fromStr} → ${toStr}${win.backfill ? " (backfill — empty sheet)" : ""}; ` +
        `${existing.isoWeeks.length} stored week(s) frozen before ${fromStr}`,
    );

    const workerIds = fetchAllTeamMembers_(tempoToken);
    if (workerIds.length === 0) throw new Error("❌ No workers found in any Tempo Team.");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    const endpoint = resolveCapacityEndpoint_(tempoToken, workerIds[0], fromStr, toStr);
    const fetched = fetchSchedulesForWindow_(tempoToken, endpoint, workerIds, userMap, fromStr, toStr);

    const windowIsoWeeks = buildWeekRanges_(win.from, win.to).map((w) => w.isoLabel);
    const grid = mergeCapacityGrid_(existing.rows, fetched, windowIsoWeeks);
    writeCapacitySheet_(grid);

    Logger.log(
      `✅ [fetchTempoCapacity] Done. ${grid.rows.length} rocketeers × ${grid.isoWeeks.length} weeks.`,
    );
  } catch (e) {
    Logger.log(`❌ [fetchTempoCapacity] ${e.message}`);
    throw e;
  }
}

// ── SECTION: TRIGGER SETUP ───────────────────────────────────

/**
 * ONE-TIME SETUP: installs the weekly refresh trigger — every FRIDAY at
 * CONFIGCap.TRIGGER_HOUR — replacing any prior fetchTempoCapacity triggers.
 * Friday cadence is deliberate: the run rewrites FUTURE weeks only, so the
 * current week's final value is what last Friday captured (see spec §3).
 */
function createCapacityWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoCapacity")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("fetchTempoCapacity")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(CONFIGCap.TRIGGER_HOUR)
    .create();

  Logger.log(
    `⚙️ Weekly trigger installed: every Friday at ${CONFIGCap.TRIGGER_HOUR}:00 → fetchTempoCapacity()`,
  );
}

// ── SECTION: DIAGNOSTICS (read-only, no sheet writes) ────────

/**
 * ONE-OFF: logs both endpoint candidates' raw responses for the first
 * worker over the next 7 days. Run from the GAS editor to verify which
 * capacity source this workspace exposes before the first real run.
 */
function _probeCapacityEndpoint_() {
  const { tempoToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  if (workerIds.length === 0) {
    Logger.log("⚠️ No workers found — cannot probe.");
    return;
  }
  const id = workerIds[0];
  const fromStr = fmtDate_(new Date());
  const toD = new Date();
  toD.setDate(toD.getDate() + 6);
  const toStr = fmtDate_(toD);

  CAPACITY_ENDPOINTS_.forEach((ep) => {
    const res = UrlFetchApp.fetch(ep.url(id, fromStr, toStr), {
      method: "get",
      headers: { Authorization: `Bearer ${tempoToken}` },
      muteHttpExceptions: true,
    });
    Logger.log(
      `🔎 [${ep.key}] HTTP ${res.getResponseCode()} — ${res.getContentText().substring(0, 300)}`,
    );
  });
}
```

- [ ] **Step 5: Run the full Node suite (regression + syntax check of the whole file)**

Run: `node docs/superpowers/tests/capacity-node-tests.js`
Expected: `✅ All capacity tests passed` (the eval parses every new function; a syntax error fails the run).

- [ ] **Step 6: Commit**

```bash
git add TempoCapacityTime.js
git commit -m "feat(capacity): sheet I/O, schedule fetch, entry point, Friday trigger, endpoint probe"
```

---

### Task 5: Review gates + GAS deployment QA (owner-run)

**Files:**
- None modified locally (deployment + manual verification).

- [ ] **Step 1: Code review** — run the `gas-clean-code-reviewer` agent over `TempoCapacityTime.js` (Five Pillars). Fix any ❌ blockers; re-run Node tests after fixes; commit as `fix(capacity): review findings`.

- [ ] **Step 2: Deploy** — copy `TempoCapacityTime.js` into the same GAS project that holds `TempoPlanExport.js` / `TempoTrackedTime.js` (it depends on their globals). No changes to the other files; no dashboard cache bump (nothing reads the new sheet yet).

- [ ] **Step 3: Probe** — in the GAS editor run `_probeCapacityEndpoint_()`; confirm the log shows HTTP 200 with `requiredSeconds` day entries for `user-schedule` (fallback only if that fails). If both candidates fail, stop — spec §2 says no placeholder data.

- [ ] **Step 4: First run (backfill)** — run `fetchTempoCapacity()` manually. Verify in the log: window starts at `2026-03-30`, `(backfill — empty sheet)` flag, ok-count ≈ team size. Verify on the sheet: hidden col A, ISO labels from `2026.W14` through the 4th future week, part-time/holiday rocketeers show non-40 values, TOTAL footer present.

- [ ] **Step 5: Freeze verification (the core guarantee)** — hand-edit one PAST week cell to a sentinel value (e.g. `99`), re-run `fetchTempoCapacity()`, and confirm the sentinel SURVIVES while future-week cells refresh. Then restore the cell (re-running after deleting the whole column set is also fine — backfill restores real data).

- [ ] **Step 6: Install trigger** — run `createCapacityWeeklyTrigger()`; confirm in Apps Script → Triggers: `fetchTempoCapacity`, weekly, Friday, hour 8.

- [ ] **Step 7: Utilization spot-check** — pick one rocketeer + one past week; confirm `Tempo Tracked Time` hours ÷ `Capacity Tempo` hours gives a sane utilization (blank capacity cells must be skipped, not treated as 0).

---

## Self-review notes (already applied)

- **Spec coverage:** §2 endpoint+probe+fallback → Task 4 steps 1/4; §3 window/gap/backfill → Task 1; §4 layout/blank-vs-zero → Task 4 step 3; §5 algorithm → Task 4 step 4; §5 merge purity + all §7 edge cases → Task 3 tests; trigger → Task 4 step 4; tests → Tasks 1–3; MERGE_MAP no-double-count correction (spec §5.3) → Task 4 step 2.
- **Type consistency:** `computeCapacityWindow_` returns `{from: Date, to: Date, backfill}`; `readCapacitySheet_`/`mergeCapacityGrid_` share the `accountId → {name, weeks}` model; `mergeCapacityGrid_` returns `{isoWeeks, rows}` consumed by `writeCapacitySheet_`; endpoint objects `{key, url(id, from, to)}` are shared by `resolveCapacityEndpoint_`, `fetchSchedulesForWindow_`, and `_probeCapacityEndpoint_`.
- **Known judgment calls:** `limit=1000` on the schedule URL (Tempo default page size would truncate the backfill; overflow is logged, not silent). Footer sums use rounded cell values (display-grade totals, consistent with the other Tempo sheets).
