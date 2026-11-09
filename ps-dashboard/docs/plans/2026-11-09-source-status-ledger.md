# Source Status Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use anthropic-skills:subagent-driven-development (recommended) or an executing-plans workflow to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every PS Dashboard data source stamps its own freshness row in a visible `Source Status` tab; the dashboard renders it, and a Monday email reports Goals or Tempo failures.

**Architecture:** A new `SourceStatus.js` holds a config table of sources, pure status rules (Node-tested), and thin Apps Script glue that reads/writes one ledger tab in the bound spreadsheet under a script lock. Producers (three Tempo exporters, Kudos) are wrapped so success/failure stamps their row; an installable on-edit trigger stamps Goals and PTO; a daily check handles Roster, SI, RCR, probes and missing triggers. `SourceDigest.js` builds the Monday email. The report payload carries `meta.sources` for the Data Reference table and header pill.

**Tech Stack:** Google Apps Script (V8), container-bound, clasp; plain Node test scripts in `ps-dashboard/tests/` (no framework — `ck`/`eq` helpers, `eval` of the GAS source).

**Spec:** `ps-dashboard/docs/specs/2026-11-09-source-status-ledger-design.md`

---

## Ground rules for the engineer

- Work in the worktree `D:/Development/ps-dashboard/.claude/worktrees/source-status-spec` (branch `docs/source-status-ledger`). All paths below are relative to that worktree root. The git repo root is the worktree root; the Apps Script project is the `ps-dashboard/` subfolder.
- **No top-level `const`/`let` in `SourceStatus.js` or `SourceDigest.js`.** The Node tests `eval` these files; `var` and `function` declarations leak into the test scope, `const`/`let` do not.
- **Every public function (no trailing `_`) needs an access gate** (`requireMaintainer_` or `checkDashboardAccess` in its body). `ps-dashboard/tests/callable-surface-checks.js` fails otherwise. The only new exception is `onWatchedEdit` (Task 5).
- **Never write to the Roster, Goals, PTO or Compensation workbooks.** They are read-only systems of record. The only sheet this feature writes is `Source Status` in the bound dashboard spreadsheet.
- ISO week labels in this project are **unpadded**: `2026.W46`, `2027.W1`. Use the existing `isoWeekNum_PS_` / `isoWeekYear_PS_`.
- Fiscal quarter labels come from `computeFiscalContext_(date)` (`PS Contribution Report.js`). Do not re-derive them by slicing dates.
- Run every test from the worktree root: `node "ps-dashboard/tests/<file>.js"`.

## Deviation from the spec (intentional)

- Spec §5 names the edit handler `onWatchedEdit_`. Installable triggers cannot call private (`_`) functions, so it is public `onWatchedEdit`, protected by a real-event guard and an allow-list entry in the callable-surface test (Task 5).
- Spec §6 "Compensation is added": the dashboard reads compensation only as TCC inside RCR, so the RCR row is labelled `RCR · revenue ÷ compensation (TCC)` rather than adding a separate ledger source.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `ps-dashboard/SourceStatus.js` | create | config, pure rules, ledger I/O, wrapper, edit handler, daily checks, installer, payload reader |
| `ps-dashboard/SourceDigest.js` | create | digest/summary builders (pure) and `sendSourceHealthDigest` / `previewSourceHealthDigest` |
| `ps-dashboard/tests/source-status-checks.js` | create | Node checks for everything server-side |
| `ps-dashboard/tests/source-status-ui-checks.js` | create | Node checks for the client render functions |
| `ps-dashboard/tests/callable-surface-checks.js` | modify | allow-list `onWatchedEdit` |
| `ps-dashboard/TempoTrackedTime.js` | modify | wrap `fetchTempoLoggedTime` |
| `ps-dashboard/TempoPlanExport.js` | modify | wrap `fetchTempoPlannedTime` |
| `ps-dashboard/TempoCapacityTime.js` | modify | wrap `fetchTempoCapacity` |
| `ps-dashboard/Kudos.js` | modify | wrap `runKudosNormalizer` |
| `ps-dashboard/PS Contribution Report.js` | modify | `meta.sources` in the payload |
| `ps-dashboard/PS Dashboard.html` | modify | CSS, live Data Sources table, header pill, client render functions |

---

### Task 1: Config, labels and the status evaluator

**Files:**
- Create: `ps-dashboard/SourceStatus.js`
- Create: `ps-dashboard/tests/source-status-checks.js`

- [ ] **Step 1: Create the test harness with the Task 1 checks**

Create `ps-dashboard/tests/source-status-checks.js`:

```js
// Node checks for the Source Status ledger (spec 2026-11-09).
// Run: node "ps-dashboard/tests/source-status-checks.js"
const fs   = require('fs');
const path = require('path');

global.Logger = { log: function () {} };
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty: () => {} }),
};

const dir = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
eval(read('PS Contribution Report.js'));
eval(read('SourceStatus.js'));
if (fs.existsSync(path.join(dir, 'SourceDigest.js'))) eval(read('SourceDigest.js'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error('  ❌ ' + name + '\n     got:  ' + JSON.stringify(got) +
                         '\n     want: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
const H = 3600000, D = 86400000;
function def(key) { return sourceDefs_({}).filter(d => d.key === key)[0]; }
function ymd(d) { return d instanceof Date ? stampLabel_SS_(d).slice(0, 10) : String(d); }

// ── Task 1: config, labels, evaluator ────────────────────────────────────────
eq('ten sources in order', sourceDefs_({}).map(d => d.key),
   ['tempo_tracked', 'tempo_plan', 'tempo_capacity', 'goals', 'pto', 'roster', 'kudos', 'si', 'rcr', 'digest']);
eq('stale override by Script Property',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: '12' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 12);
eq('bad override ignored',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: 'abc' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 192);

eq('ISO label 2026-11-09', isoLabel_SS_(new Date(2026, 10, 9, 12)), '2026.W46');
eq('ISO label 53-week year', isoLabel_SS_(new Date(2026, 11, 31, 12)), '2026.W53');
eq('ISO label unpadded', isoLabel_SS_(new Date(2027, 0, 4, 12)), '2027.W1');
eq('stamp label', stampLabel_SS_(new Date(2026, 10, 2, 9)), '2026-11-02 (2026.W45)');
eq('stamp label empty for non-date', stampLabel_SS_(''), '');

const NOW = new Date(2026, 10, 9, 10, 0);
const at = ms => new Date(NOW.getTime() - ms);

eq('tracked 25 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(25 * H) }, NOW).status, 'ok');
eq('tracked 26 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(26 * H) }, NOW).status, 'ok');
const tr27 = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(27 * H) }, NOW);
eq('tracked 27 h → stale', tr27.status, 'stale');
eq('tracked stale detail', tr27.detail, 'No update for 27 h (limit 26 h)');

eq('capacity 8 d → ok', evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D) }, NOW).status, 'ok');
const cap = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D + H) }, NOW);
eq('capacity 8 d 1 h → stale', cap.status, 'stale');
eq('capacity stale detail', cap.detail, 'No update for 8 days (limit 8 days)');
eq('plan 8 d 1 h → stale', evaluateSourceStatus_(def('tempo_plan'), { lastUpdated: at(8 * D + H) }, NOW).status, 'stale');
eq('goals 7 d → ok',     evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D) }, NOW).status, 'ok');
eq('goals 7 d 1 h → stale', evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D + H) }, NOW).status, 'stale');
eq('pto 15 d → ok',      evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D) }, NOW).status, 'ok');
eq('pto 15 d 1 h → stale', evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D + H) }, NOW).status, 'stale');
eq('roster never stale', evaluateSourceStatus_(def('roster'), { lastUpdated: at(400 * D) }, NOW).status, 'ok');

const pend = evaluateSourceStatus_(def('tempo_plan'), {}, NOW);
eq('no stamp → pending', pend.status, 'pending');
eq('no stamp detail', pend.detail, 'awaiting first update');
eq('failed is sticky', evaluateSourceStatus_(def('tempo_plan'),
   { lastUpdated: at(H), status: 'failed', detail: 'boom' }, NOW).status, 'failed');
eq('rule row keeps stored status', evaluateSourceStatus_(def('si'), { status: 'pending' }, NOW).status, 'pending');
eq('rule row with no status → pending', evaluateSourceStatus_(def('rcr'), {}, NOW).status, 'pending');

const nx = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: new Date(2026, 10, 9, 6, 0) }, NOW);
eq('next expected = last + cadence', ymd(nx.nextExpected), '2026-11-10');
const ev = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(H) }, NOW);
eq('evaluator carries label/digest/action', [ev.label, ev.digest, /fetchTempoCapacity/.test(ev.action)],
   ['Tempo Capacity', true, true]);

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log('source-status-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: crash with `ENOENT ... SourceStatus.js` (file does not exist yet).

- [ ] **Step 3: Create `SourceStatus.js` with config, labels and the evaluator**

Create `ps-dashboard/SourceStatus.js`:

```js
// ============================================================
// SOURCE STATUS LEDGER
// Spec: docs/specs/2026-11-09-source-status-ledger-design.md
// One row per data source in the "Source Status" tab of the bound spreadsheet.
// Each producer stamps its own row; the dashboard and the Monday digest read it.
// The Roster, Goals, PTO and Compensation workbooks are NEVER written.
// No top-level const/let in this file: the Node tests eval it.
// ============================================================

var SOURCE_STATUS = {
  SHEET: "Source Status",
  HEADERS: ["Source", "Label", "Covers period", "Last updated", "Last checked", "Status", "Detail", "Next expected"],
  PTO_SHEET: "2023 RD",
  PTO_FIRST_ROW: 2, PTO_FIRST_COL: 1, PTO_LAST_COL: 14,      // A2:N
  GOALS_QUARTER_HEADER: "fiscal quarter",                     // matched lower-cased, trimmed
  SI_LAG_DAYS: 14,
  ROSTER_FP_PROP: "SOURCE_ROSTER_FP",
  LEDGER_SS_PROP: "SOURCE_LEDGER_SS_ID",
  DIGEST_RECIPIENTS_PROP: "SOURCE_DIGEST_RECIPIENTS",
  DASHBOARD_URL_PROP: "SOURCE_DASHBOARD_URL",
  // staleHours: null = never stale. cadenceHours: used for "Next expected".
  // rule: true = status is computed by checkSourcesDaily / the digest, not by age.
  // trigger: handler that must exist (checked daily); installer: what to run if it is missing.
  SOURCES: [
    { key: "tempo_tracked",  label: "Tempo Tracked",  staleHours: 26,  cadenceHours: 24,  digest: true,
      trigger: "fetchTempoLoggedTime",  installer: "createLoggedDailyTrigger",
      action: "Run fetchTempoLoggedTime from the Apps Script editor and check its log." },
    { key: "tempo_plan",     label: "Tempo Plan",     staleHours: 192, cadenceHours: 168, digest: true,
      trigger: "fetchTempoPlannedTime", installer: "createWeeklyTrigger",
      action: "Run fetchTempoPlannedTime from the Apps Script editor and check its log." },
    { key: "tempo_capacity", label: "Tempo Capacity", staleHours: 192, cadenceHours: 168, digest: true,
      trigger: "fetchTempoCapacity",    installer: "createCapacityWeeklyTrigger",
      action: "Run fetchTempoCapacity from the Apps Script editor and check its log." },
    { key: "goals",          label: "Goals (RD)",     staleHours: 168, cadenceHours: null, digest: true,
      trigger: "onWatchedEdit", watch: "goals", installer: "installSourceStatusTriggers",
      action: "Paste the latest goals export into the RD tab of the Goals workbook." },
    { key: "pto",            label: "PTO (2023 RD)",  staleHours: 360, cadenceHours: null, digest: false,
      trigger: "onWatchedEdit", watch: "ptoAccum", installer: "installSourceStatusTriggers",
      action: "Paste the latest PTO export into the 2023 RD tab." },
    { key: "roster",         label: "Roster",         staleHours: null, cadenceHours: null, digest: false,
      trigger: "checkSourcesDaily", installer: "installSourceStatusTriggers", action: "" },
    { key: "kudos",          label: "Kudos",          staleHours: null, cadenceHours: null, digest: false,
      trigger: null, action: "Run runKudosNormalizer." },
    { key: "si",             label: "Small Improvements", rule: true, digest: false, trigger: null, action: "" },
    { key: "rcr",            label: "RCR · revenue ÷ compensation (TCC)", rule: true, digest: false, trigger: null, action: "" },
    { key: "digest",         label: "Monday digest",  rule: true, digest: false,
      trigger: "sendSourceHealthDigest", installer: "installSourceStatusTriggers", action: "" },
  ],
};

// Source definitions with Script Property overrides applied.
// props: a plain object (PropertiesService...getProperties()).
// Override: SOURCE_STALE_HOURS_<KEY>, e.g. SOURCE_STALE_HOURS_TEMPO_CAPACITY = "200".
function sourceDefs_(props) {
  props = props || {};
  return SOURCE_STATUS.SOURCES.map(function (d) {
    var o = {};
    for (var k in d) o[k] = d[k];
    var v = props["SOURCE_STALE_HOURS_" + d.key.toUpperCase()];
    if (v != null && String(v).trim() !== "" && !isNaN(Number(v))) o.staleHours = Number(v);
    return o;
  });
}

function isoLabel_SS_(d) {
  return isoWeekYear_PS_(d) + ".W" + isoWeekNum_PS_(d);
}

// "2026-11-02 (2026.W45)" — empty string for anything that is not a valid Date.
function stampLabel_SS_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " (" + isoLabel_SS_(d) + ")";
}

function ageText_SS_(ms) {
  return ms < 48 * 3600000 ? Math.floor(ms / 3600000) + " h" : Math.floor(ms / 86400000) + " days";
}

function limitText_SS_(hours) {
  return hours < 48 ? hours + " h" : (hours / 24) + " days";
}

function isDate_SS_(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

// Pure: one ledger row (or undefined) + its definition → evaluated status.
// Status is recomputed at read time so a source that stops updating turns stale
// with nothing running.
function evaluateSourceStatus_(def, row, now) {
  row = row || {};
  var last = isDate_SS_(row.lastUpdated) ? row.lastUpdated : null;
  var next = isDate_SS_(row.nextExpected) ? row.nextExpected : null;
  if (!next && last && def.cadenceHours) next = new Date(last.getTime() + def.cadenceHours * 3600000);

  var status, detail = row.detail ? String(row.detail) : "";
  if (row.status === "failed") {
    status = "failed";
  } else if (def.rule) {
    status = row.status || "pending";
  } else if (!last) {
    status = "pending";
    if (!detail) detail = "awaiting first update";
  } else if (def.staleHours && now.getTime() - last.getTime() > def.staleHours * 3600000) {
    status = "stale";
    detail = "No update for " + ageText_SS_(now.getTime() - last.getTime()) +
             " (limit " + limitText_SS_(def.staleHours) + ")";
  } else {
    status = "ok";
  }

  return {
    key: def.key, label: def.label, digest: !!def.digest, action: def.action || "",
    coversPeriod: row.coversPeriod == null ? "" : row.coversPeriod,
    lastUpdated: last, lastChecked: isDate_SS_(row.lastChecked) ? row.lastChecked : null,
    status: status, detail: detail, nextExpected: next,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `source-status-checks: 30 passed, 0 failed` (count may differ by one or two if you split checks; zero failures is the requirement).

- [ ] **Step 5: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceStatus.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): source config, ISO labels and status evaluator"
```

---

### Task 2: Rule helpers — SI, RCR, edits, roster fingerprint, probes, triggers

**Files:**
- Modify: `ps-dashboard/SourceStatus.js` (append)
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)

- [ ] **Step 1: Write the failing tests**

Insert above the `// ── SUMMARY` line:

```js
// ── Task 2: rule helpers ─────────────────────────────────────────────────────
eq('Q end FY27Q1', ymd(quarterEndFromLabel_SS_('FY27Q1')), '2026-09-30');
eq('Q end FY27Q2', ymd(quarterEndFromLabel_SS_('FY27Q2')), '2026-12-31');
eq('Q end FY27Q3', ymd(quarterEndFromLabel_SS_('FY27Q3')), '2027-03-31');
eq('Q end FY27Q4', ymd(quarterEndFromLabel_SS_('fy27q4')), '2027-06-30');
eq('Q end bad label', quarterEndFromLabel_SS_('Q2 FY27'), null);

const siNov = siStatus_SS_(new Date(2026, 10, 9, 10));
eq('SI 2026-11-09 ok FY27Q1', [siNov.status, siNov.coversPeriod], ['ok', 'FY27Q1']);
eq('SI available since 2026-10-14', ymd(siNov.lastUpdated), '2026-10-14');
eq('SI next due 2027-01-14', ymd(siNov.nextExpected), '2027-01-14');
const siOct10 = siStatus_SS_(new Date(2026, 9, 10, 10));
eq('SI 2026-10-10 pending FY27Q1', [siOct10.status, siOct10.coversPeriod], ['pending', 'FY27Q1']);
eq('SI pending next = due date', ymd(siOct10.nextExpected), '2026-10-14');
eq('SI pending last = previous quarter release', ymd(siOct10.lastUpdated), '2026-07-14');
eq('SI on due day → ok', siStatus_SS_(new Date(2026, 9, 14, 8)).status, 'ok');
const siJul = siStatus_SS_(new Date(2026, 6, 10, 10));
eq('SI across FY rollover', [siJul.status, siJul.coversPeriod, ymd(siJul.nextExpected)], ['pending', 'FY26Q4', '2026-07-14']);

const RH = ['Employee Name', 'Employee ID', 'Sep 26', 'Oct-26'];
const rFull = rcrStatus_SS_(RH, [['A', 1, 1.2, 1.4], ['B', 2, 0.9, '']], new Date(2026, 10, 9));
eq('RCR Oct filled → ok', [rFull.status, rFull.coversPeriod], ['ok', 'Oct-26']);
eq('RCR covers through month end', ymd(rFull.lastUpdated), '2026-10-31');
const rPend = rcrStatus_SS_(RH, [['A', 1, 1.2, ''], ['B', 2, 0.9, 'N/A']], new Date(2026, 10, 9));
eq('RCR Oct empty → pending on Sep', [rPend.status, rPend.coversPeriod], ['pending', 'Sep 26']);
ck('RCR pending names the missing month', /Oct 26/.test(rPend.detail) && /Finance/.test(rPend.detail));
eq('RCR never stale (no next expected)', rPend.nextExpected, null);
eq('RCR nothing populated → pending', rcrStatus_SS_(RH, [['A', 1, '', '']], new Date(2026, 10, 9)).status, 'pending');

const W = { firstRow: 2, firstCol: 1, lastCol: 14 };
eq('edit header row only', editTouchesRange_SS_({ row: 1, numRows: 1, col: 1, numCols: 5 }, W), false);
eq('edit spanning header + data', editTouchesRange_SS_({ row: 1, numRows: 3, col: 1, numCols: 5 }, W), true);
eq('edit right of N', editTouchesRange_SS_({ row: 5, numRows: 1, col: 15, numCols: 1 }, W), false);
eq('edit in column N', editTouchesRange_SS_({ row: 5, numRows: 1, col: 14, numCols: 1 }, W), true);

const CTX = { goalsQuarter: 'FY27Q2', prevGoalsQuarter: 'FY27Q1', inGracePeriod: false };
eq('goals prev quarter only, no grace', goalsEditQualifies_SS_(['FY27Q1'], CTX), false);
eq('goals current quarter (case/space)', goalsEditQualifies_SS_([' fy27q2 '], CTX), true);
eq('goals prev quarter in grace', goalsEditQualifies_SS_(['FY27Q1'], Object.assign({}, CTX, { inGracePeriod: true })), true);
eq('goals mixed paste', goalsEditQualifies_SS_(['FY26Q4', 'FY27Q2'], CTX), true);

const V1 = [['Employee Number', 'Name'], [1, 'Ana'], [2, 'Luis']];
const V2 = [['Employee Number', 'Name'], [1, 'Ana'], [2, 'Luís']];
eq('fingerprint stable', fingerprint_SS_(V1), fingerprint_SS_(JSON.parse(JSON.stringify(V1))));
ck('fingerprint changes on a cell', fingerprint_SS_(V1) !== fingerprint_SS_(V2));
ck('fingerprint starts with row count', /^3:/.test(fingerprint_SS_(V1)));

const base = rosterCheck_SS_(null, '3:abc', 2, NOW);
eq('roster first run = baseline pending', base.status, 'pending');
ck('roster baseline detail', /Baseline captured/.test(base.detail));
eq('roster unchanged → null', rosterCheck_SS_('3:abc', '3:abc', 2, NOW), null);
const chg = rosterCheck_SS_('3:abc', '3:def', 2, NOW);
eq('roster changed → ok stamped now', [chg.status, chg.lastUpdated === NOW, chg.detail], ['ok', true, 'Data tab changed (2 rows)']);

eq('flag problem → failed', flagOutcome_SS_({}, 'tab "RD" not found', 'Cannot read'),
   { status: 'failed', detail: 'Cannot read: tab "RD" not found' });
eq('flag recovered with stamp → ok', flagOutcome_SS_({ status: 'failed', detail: 'Cannot read: x', lastUpdated: NOW }, null, 'Cannot read'),
   { status: 'ok', detail: '' });
eq('flag recovered never stamped → pending', flagOutcome_SS_({ status: 'failed', detail: 'Cannot read: x' }, null, 'Cannot read'),
   { status: 'pending', detail: 'awaiting first update' });
eq('flag leaves other failures alone', flagOutcome_SS_({ status: 'failed', detail: 'Trigger missing: x' }, null, 'Cannot read'), null);
eq('flag no-op when healthy', flagOutcome_SS_({ status: 'ok' }, null, 'Cannot read'), null);

const IDS = { goals: 'G', ptoAccum: 'P' };
const exp = expectedTriggers_SS_(sourceDefs_({}), IDS);
eq('expected trigger keys', exp.map(e => e.key), ['tempo_tracked', 'tempo_plan', 'tempo_capacity', 'goals', 'pto', 'roster', 'digest']);
const actual = [
  { handler: 'fetchTempoLoggedTime', sourceId: null }, { handler: 'fetchTempoPlannedTime', sourceId: null },
  { handler: 'onWatchedEdit', sourceId: 'G' }, { handler: 'checkSourcesDaily', sourceId: null },
  { handler: 'sendSourceHealthDigest', sourceId: null },
];
eq('missing triggers detected', missingTriggers_SS_(exp, actual).map(m => m.key + '>' + m.installer),
   ['tempo_capacity>createCapacityWeeklyTrigger', 'pto>installSourceStatusTriggers']);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `ReferenceError: quarterEndFromLabel_SS_ is not defined`.

- [ ] **Step 3: Append the rule helpers to `SourceStatus.js`**

```js
// ── Rule helpers (pure) ─────────────────────────────────────

function addDays_SS_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// "FY27Q1" → last calendar day of that fiscal quarter (FY starts July 1).
function quarterEndFromLabel_SS_(label) {
  var m = /^FY(\d{2})Q([1-4])$/.exec(String(label || "").trim().toUpperCase());
  if (!m) return null;
  var fy = 2000 + Number(m[1]), q = Number(m[2]);
  var endMonth = [9, 12, 3, 6][q - 1];        // 1-based calendar month the quarter ends in
  var year = q <= 2 ? fy - 1 : fy;
  return new Date(year, endMonth, 0);         // day 0 of the next month = last day
}

// Small Improvements: ratings for a closed quarter are available on quarter end + 14 days.
// That date is fixed, so the row is a pure function of today's date.
function siStatus_SS_(now) {
  var ctx = computeFiscalContext_(now);
  var closed = ctx.prevGoalsQuarter;
  var due = addDays_SS_(quarterEndFromLabel_SS_(closed), SOURCE_STATUS.SI_LAG_DAYS);
  if (now.getTime() >= due.getTime()) {
    return {
      status: "ok", coversPeriod: closed, lastUpdated: due,
      nextExpected: addDays_SS_(quarterEndFromLabel_SS_(ctx.goalsQuarter), SOURCE_STATUS.SI_LAG_DAYS),
      detail: closed + " ratings available since " + stampLabel_SS_(due),
    };
  }
  return {
    status: "pending", coversPeriod: closed,
    lastUpdated: addDays_SS_(quarterEndFromLabel_SS_(ctx.prev2GoalsQuarter), SOURCE_STATUS.SI_LAG_DAYS),
    nextExpected: due,
    detail: closed + " ratings due " + stampLabel_SS_(due),
  };
}

var RCR_MONTH_RE_SS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*[-\s]?\s*(\d{2})$/i;
var MONTHS_SS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var MONTH_ABBR_SS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isFilledNumber_SS_(v) {
  if (typeof v === "number") return !isNaN(v);
  var s = String(v == null ? "" : v).replace(/[,%\s]/g, "");
  return s !== "" && !isNaN(parseFloat(s)) && isFinite(Number(s));
}

// Newest month column ("Oct 26" / "Oct-26") holding at least one numeric value.
// Scans every fiscal year present, like readRCR_PS_ does.
function latestRcrMonth_SS_(headers, rows) {
  var cols = [];
  headers.forEach(function (h, i) {
    var m = RCR_MONTH_RE_SS.exec(String(h).trim());
    if (m) {
      var mi = MONTHS_SS.indexOf(m[1].toLowerCase()), yy = 2000 + Number(m[2]);
      cols.push({ name: String(h).trim(), col: i, year: yy, month: mi, sortKey: yy * 12 + mi });
    }
  });
  cols.sort(function (a, b) { return b.sortKey - a.sortKey; });
  for (var k = 0; k < cols.length; k++) {
    var c = cols[k];
    if (rows.some(function (r) { return isFilledNumber_SS_(r[c.col]); })) return c;
  }
  return null;
}

// RCR covers through the month end; the last closed month is pending until Finance
// fills its column. Never stale — timing belongs to Finance.
function rcrStatus_SS_(headers, rows, now) {
  var latest = latestRcrMonth_SS_(headers, rows);
  var lastClosed = new Date(now.getFullYear(), now.getMonth(), 0);
  var wantKey = lastClosed.getFullYear() * 12 + lastClosed.getMonth();
  var wantName = MONTH_ABBR_SS[lastClosed.getMonth()] + " " + String(lastClosed.getFullYear()).slice(-2);
  if (!latest) {
    return { status: "pending", coversPeriod: "", lastUpdated: null, nextExpected: null,
             detail: "No populated month yet; " + wantName + " is up to Finance" };
  }
  var monthEnd = new Date(latest.year, latest.month + 1, 0);
  if (latest.sortKey >= wantKey) {
    return { status: "ok", coversPeriod: latest.name, lastUpdated: monthEnd, nextExpected: null,
             detail: latest.name + " filled by Finance" };
  }
  return { status: "pending", coversPeriod: latest.name, lastUpdated: monthEnd, nextExpected: null,
           detail: wantName + " (closed " + stampLabel_SS_(lastClosed) + ") not yet filled by Finance" };
}

// edit: {row, numRows, col, numCols}; watch: {firstRow, firstCol, lastCol}.
function editTouchesRange_SS_(edit, watch) {
  var lastRow = edit.row + edit.numRows - 1, lastCol = edit.col + edit.numCols - 1;
  return lastRow >= watch.firstRow && edit.col <= watch.lastCol && lastCol >= watch.firstCol;
}

// True when any edited row belongs to the evaluated quarter (or the previous one
// during the goals grace window, matching readGoalsEngagement_).
function goalsEditQualifies_SS_(quarterValues, ctx) {
  var want = [String(ctx.goalsQuarter).toUpperCase()];
  if (ctx.inGracePeriod && ctx.prevGoalsQuarter) want.push(String(ctx.prevGoalsQuarter).toUpperCase());
  return quarterValues.some(function (v) {
    return want.indexOf(String(v == null ? "" : v).trim().toUpperCase()) !== -1;
  });
}

// "<rowCount>:<djb2 hash>" of the whole tab. Cheap, deterministic, no GAS services.
function fingerprint_SS_(values) {
  var s = JSON.stringify(values), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return values.length + ":" + (h >>> 0).toString(16);
}

// Fields to record for Roster, or null when the Data tab did not change.
function rosterCheck_SS_(prevFp, fp, dataRows, now) {
  if (!prevFp) return { status: "pending", detail: "Baseline captured " + stampLabel_SS_(now) + "; awaiting next change" };
  if (prevFp === fp) return null;
  return { status: "ok", lastUpdated: now, detail: "Data tab changed (" + dataRows + " rows)" };
}

// A probe or trigger check either raises a "<prefix>: <problem>" failure, clears a
// failure it raised earlier, or does nothing (null). Other failures are left alone.
function flagOutcome_SS_(row, problem, prefix) {
  row = row || {};
  if (problem) return { status: "failed", detail: prefix + ": " + problem };
  if (row.status === "failed" && String(row.detail || "").indexOf(prefix + ":") === 0) {
    var has = isDate_SS_(row.lastUpdated);
    return { status: has ? "ok" : "pending", detail: has ? "" : "awaiting first update" };
  }
  return null;
}

// ids: getExternalSSIds_() → { goals, ptoAccum, ... }
function expectedTriggers_SS_(defs, ids) {
  return defs.filter(function (d) { return d.trigger; }).map(function (d) {
    return { key: d.key, handler: d.trigger, sourceId: d.watch ? ids[d.watch] : null, installer: d.installer };
  });
}

// actual: [{handler, sourceId}] from ScriptApp.getProjectTriggers().
function missingTriggers_SS_(expected, actual) {
  return expected.filter(function (e) {
    return !actual.some(function (a) {
      return a.handler === e.handler && (!e.sourceId || a.sourceId === e.sourceId);
    });
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `... 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceStatus.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): SI, RCR, edit, roster, probe and trigger rules"
```

---

### Task 3: Digest and summary builders

**Files:**
- Create: `ps-dashboard/SourceDigest.js`
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 3: digest builder ───────────────────────────────────────────────────
function evRow(key, row) { return evaluateSourceStatus_(def(key), row, NOW); }
const allOk = sourceDefs_({}).map(d => evRow(d.key, { lastUpdated: at(H), status: d.rule ? 'ok' : '' }));
eq('all ok → no digest', buildDigest_SS_(allOk, NOW, 'https://x'), null);

const onlyInfo = allOk.map(r => (r.key === 'roster' || r.key === 'pto')
  ? Object.assign({}, r, { status: 'stale' }) : r);
eq('roster/pto problems never email', buildDigest_SS_(onlyInfo, NOW, ''), null);

const twoBad = allOk.map(r => r.key === 'tempo_capacity' ? evRow('tempo_capacity', { lastUpdated: at(9 * D) })
  : r.key === 'goals' ? evRow('goals', { lastUpdated: at(2 * D), status: 'failed', detail: 'Cannot read: tab "RD" not found' }) : r);
const dg = buildDigest_SS_(twoBad, NOW, 'https://dash');
eq('subject', dg.subject, 'PS Dashboard sources: 2 need attention (2026.W46)');
ck('body names capacity stale', /Tempo Capacity — STALE/.test(dg.body));
ck('body names goals failed + detail', /Goals \(RD\) — FAILED/.test(dg.body) && /tab "RD" not found/.test(dg.body));
ck('body carries action', /Run fetchTempoCapacity/.test(dg.body));
ck('body carries last good update with ISO week', /Last good update: 2026-10-31 \(2026\.W44\)/.test(dg.body));
ck('body links Data Reference', /Data Reference: https:\/\/dash/.test(dg.body));
const oneBad = allOk.map(r => r.key === 'tempo_plan' ? evRow('tempo_plan', { lastUpdated: at(10 * D) }) : r);
eq('singular subject', buildDigest_SS_(oneBad, NOW, '').subject, 'PS Dashboard sources: 1 needs attention (2026.W46)');

const sum = buildStatusSummary_SS_(twoBad);
eq('summary lists every source', sum.split('\n').length, 10);
ck('summary line format', /^Tempo Capacity: stale · last 2026-10-31 \(2026\.W44\)/m.test(sum));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `ReferenceError: buildDigest_SS_ is not defined`.

- [ ] **Step 3: Create `SourceDigest.js` with the pure builders**

```js
// ============================================================
// SOURCE STATUS — MONDAY DIGEST
// Spec §8: email only when Goals or a Tempo export is failed or stale.
// No top-level const/let in this file: the Node tests eval it.
// ============================================================

// rows: evaluated rows (evaluateSourceStatus_ output). Returns null when nothing
// that belongs in the email has a problem.
function buildDigest_SS_(rows, now, dashboardUrl) {
  var bad = rows.filter(function (r) { return r.digest && (r.status === "failed" || r.status === "stale"); });
  if (!bad.length) return null;
  var wk = isoLabel_SS_(now);
  var subject = "PS Dashboard sources: " + bad.length + (bad.length === 1 ? " needs" : " need") +
                " attention (" + wk + ")";
  var blocks = bad.map(function (r) {
    return "• " + r.label + " — " + r.status.toUpperCase() +
           "\n   Last good update: " + (r.lastUpdated ? stampLabel_SS_(r.lastUpdated) : "never") +
           "\n   Detail: " + (r.detail || "—") +
           (r.action ? "\n   Action: " + r.action : "");
  });
  var body = "Sources that need attention this week (" + wk + "):\n\n" + blocks.join("\n\n") +
             (dashboardUrl ? "\n\nData Reference: " + dashboardUrl : "") +
             "\n\nSent by sendSourceHealthDigest (PS Dashboard). Weeks with nothing to report send no email.";
  return { subject: subject, body: body, count: bad.length };
}

// One line per source, for the preview email.
function buildStatusSummary_SS_(rows) {
  return rows.map(function (r) {
    return r.label + ": " + r.status +
           (r.lastUpdated ? " · last " + stampLabel_SS_(r.lastUpdated) : "") +
           (r.detail ? " · " + r.detail : "");
  }).join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `... 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceDigest.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): Monday digest and summary builders"
```

---

### Task 4: Ledger I/O and the producer wrapper

**Files:**
- Modify: `ps-dashboard/SourceStatus.js` (append)
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 4: ledger I/O + wrapper ─────────────────────────────────────────────
function fakeSheet(values) {
  const sh = {
    v: values,
    getDataRange() { return { getValues: () => sh.v.map(r => r.slice()) }; },
    getLastRow() { return sh.v.length; },
    getLastColumn() { return sh.v[0] ? sh.v[0].length : 0; },
    getRange(r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      return {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) { const x = (sh.v[r - 1 + i] || [])[c - 1 + j]; row.push(x === undefined ? '' : x); }
            out.push(row);
          }
          return out;
        },
        setValues(vals) {
          for (let i = 0; i < nr; i++) {
            sh.v[r - 1 + i] = sh.v[r - 1 + i] || [];
            for (let j = 0; j < nc; j++) sh.v[r - 1 + i][c - 1 + j] = vals[i][j];
          }
          return this;
        },
        setNumberFormat() { return this; }, setFontWeight() { return this; },
      };
    },
    setFrozenRows() {},
    getName() { return 'Source Status'; },
  };
  return sh;
}
let LEDGER = null;
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ({
    getId: () => 'DASH',
    getSheetByName: n => (n === 'Source Status' ? LEDGER : null),
    insertSheet: () => { LEDGER = fakeSheet([]); return LEDGER; },
  }),
  openById: () => global.SpreadsheetApp.getActiveSpreadsheet(),
};
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };

// creates the tab with headers on first write
LEDGER = null;
ck('first record succeeds', recordSourceStatus_('tempo_capacity', { status: 'ok', lastUpdated: NOW, detail: 'Run ok in 3 s' }) === true);
eq('headers written', LEDGER.v[0], SOURCE_STATUS.HEADERS);
eq('row written by header name', [LEDGER.v[1][0], LEDGER.v[1][1], LEDGER.v[1][5]], ['tempo_capacity', 'Tempo Capacity', 'ok']);
ck('last checked stamped', LEDGER.v[1][4] instanceof Date);

// overwrites in place, keeps fields not passed
recordSourceStatus_('tempo_capacity', { status: 'failed', detail: 'HTTP 500' });
eq('still one data row', LEDGER.v.length, 2);
eq('status replaced, last updated kept', [LEDGER.v[1][5], LEDGER.v[1][3] === NOW, LEDGER.v[1][6]], ['failed', true, 'HTTP 500']);

// columns found by name even when reordered
LEDGER = fakeSheet([['Status', 'Source', 'Label', 'Detail', 'Covers period', 'Last updated', 'Last checked', 'Next expected']]);
recordSourceStatus_('kudos', { status: 'ok', detail: 'x' });
eq('reordered columns', [LEDGER.v[1][0], LEDGER.v[1][1]], ['ok', 'kudos']);

// a missing column is swallowed (logged), never thrown
LEDGER = fakeSheet([['Source', 'Label']]);
eq('missing column → false, no throw', recordSourceStatus_('kudos', { status: 'ok' }), false);

// lock failure is swallowed
const realLock = global.LockService;
global.LockService = { getScriptLock: () => { throw new Error('lock down'); } };
eq('lock failure → false, no throw', recordSourceStatus_('kudos', { status: 'ok' }), false);
global.LockService = realLock;

// wrapper
const realRecord = recordSourceStatus_;
const CALLS = [];
recordSourceStatus_ = function (k, f) { CALLS.push([k, f]); return true; };
withSourceStatus_('tempo_plan', () => undefined);
eq('wrapper ok key/status', [CALLS[0][0], CALLS[0][1].status], ['tempo_plan', 'ok']);
ck('wrapper ok stamps time + duration', CALLS[0][1].lastUpdated instanceof Date && /^Run ok in \d+ s$/.test(CALLS[0][1].detail));
let threw = null;
try { withSourceStatus_('tempo_plan', () => { throw new Error('Tempo 429'); }); } catch (e) { threw = e.message; }
eq('wrapper rethrows', threw, 'Tempo 429');
eq('wrapper records failure', [CALLS[1][1].status, CALLS[1][1].detail], ['failed', 'Tempo 429']);
const before = CALLS.length;
eq('blocked run returns result', withSourceStatus_('kudos', () => ({ ok: false })).ok, false);
eq('blocked run records nothing', CALLS.length, before);
recordSourceStatus_ = realRecord;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `ReferenceError: recordSourceStatus_ is not defined`.

- [ ] **Step 3: Append ledger I/O and the wrapper to `SourceStatus.js`**

```js
// ── Ledger I/O (Apps Script) ────────────────────────────────

var FIELD_HEADERS_SS = {
  key: "Source", label: "Label", coversPeriod: "Covers period", lastUpdated: "Last updated",
  lastChecked: "Last checked", status: "Status", detail: "Detail", nextExpected: "Next expected",
};

// The bound dashboard spreadsheet. Installable triggers on OTHER workbooks (Goals,
// PTO) run without an active container, so the id is saved at install time.
function ledgerSpreadsheet_SS_() {
  var id = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.LEDGER_SS_PROP);
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function ledgerSheet_SS_() {
  var ss = ledgerSpreadsheet_SS_();
  var sh = ss.getSheetByName(SOURCE_STATUS.SHEET);
  if (!sh) {
    sh = ss.insertSheet(SOURCE_STATUS.SHEET);
    sh.getRange(1, 1, 1, SOURCE_STATUS.HEADERS.length).setValues([SOURCE_STATUS.HEADERS]).setFontWeight("bold");
    sh.setFrozenRows(1);
  }
  return sh;
}

// → { idx: {field: colIndex}, rows: {key: rowObject}, width }
// Throws listing the headers found when a column is missing.
function readLedgerRows_SS_(sh) {
  var values = sh.getDataRange().getValues();
  var hdr = (values[0] || []).map(function (h) { return String(h).trim(); });
  var idx = {};
  for (var f in FIELD_HEADERS_SS) {
    var i = hdr.indexOf(FIELD_HEADERS_SS[f]);
    if (i === -1) throw new Error("Source Status column missing: " + FIELD_HEADERS_SS[f] + ". Headers found: " + hdr.join(", "));
    idx[f] = i;
  }
  var rows = {};
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][idx.key] || "").trim();
    if (!key) continue;
    var o = { _row: r + 1 };
    for (var g in idx) o[g] = values[r][idx[g]];
    rows[key] = o;
  }
  return { idx: idx, rows: rows, width: hdr.length };
}

// Writes the given fields onto the source's row (created if missing) and stamps
// "Last checked". Never throws: a ledger problem must not break a producer.
function recordSourceStatus_(key, fields) {
  var lock = null, locked = false;
  try {
    lock = LockService.getScriptLock();
    locked = lock.tryLock(10000);
    if (!locked) { Logger.log("⚠️ [SourceStatus] lock busy — " + key + " not recorded"); return false; }
    var sh = ledgerSheet_SS_();
    var led = readLedgerRows_SS_(sh);
    var def = sourceDefs_().filter(function (d) { return d.key === key; })[0];
    var existing = led.rows[key];
    var rowNum = existing ? existing._row : sh.getLastRow() + 1;
    var current = existing ? sh.getRange(rowNum, 1, 1, led.width).getValues()[0] : new Array(led.width).fill("");
    var merged = Object.assign({ key: key, label: def ? def.label : key }, fields || {}, { lastChecked: new Date() });
    if (merged.detail != null) merged.detail = String(merged.detail).slice(0, 500);
    for (var f in merged) {
      if (led.idx[f] === undefined || merged[f] === undefined) continue;
      current[led.idx[f]] = merged[f] === null ? "" : merged[f];
    }
    // Plain text so "Oct 26" or "2026.W46" are never auto-parsed into dates.
    sh.getRange(rowNum, led.idx.coversPeriod + 1).setNumberFormat("@");
    sh.getRange(rowNum, 1, 1, led.width).setValues([current]);
    return true;
  } catch (e) {
    Logger.log("⚠️ [SourceStatus] could not record " + key + ": " + e.message);
    return false;
  } finally {
    if (lock && locked) { try { lock.releaseLock(); } catch (e2) {} }
  }
}

// Runs a producer body and stamps its row. Success → ok + time + duration.
// Throw → failed + message, then rethrow so Apps Script's own failure notice fires.
// A body that returns {ok:false} (blocked by its own gate) is not an update.
function withSourceStatus_(key, fn) {
  var t0 = Date.now(), result;
  try {
    result = fn();
  } catch (e) {
    recordSourceStatus_(key, { status: "failed", detail: String((e && e.message) || e) });
    throw e;
  }
  if (result && result.ok === false) return result;
  var now = new Date();
  recordSourceStatus_(key, {
    status: "ok", lastUpdated: now, coversPeriod: isoLabel_SS_(now), nextExpected: "",
    detail: "Run ok in " + Math.round((Date.now() - t0) / 1000) + " s",
  });
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `... 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceStatus.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): ledger read/write under script lock and producer wrapper"
```

---

### Task 5: Goals / PTO edit handler

**Files:**
- Modify: `ps-dashboard/SourceStatus.js` (append)
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)
- Modify: `ps-dashboard/tests/callable-surface-checks.js` (the `ALLOWED_UNGATED` set)

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 5: edit handler ─────────────────────────────────────────────────────
const EDITS = [];
recordSourceStatus_ = function (k, f) { EDITS.push([k, f]); return true; };
function evt(ssId, sheet, row, numRows, col, numCols) {
  return {
    source: { getId: () => ssId },
    range: { getRow: () => row, getNumRows: () => numRows, getColumn: () => col, getNumColumns: () => numCols,
             getSheet: () => sheet },
  };
}
const ptoSheet = { getName: () => '2023 RD' };
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, ptoSheet, 5, 10, 1, 14));
eq('PTO paste stamps pto', [EDITS[0][0], EDITS[0][1].status, EDITS[0][1].lastUpdated instanceof Date], ['pto', 'ok', true]);
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, ptoSheet, 1, 1, 1, 3));
eq('PTO header-only edit ignored', EDITS.length, 1);
onWatchedEdit(evt(CONFIG_PS.PTO_ACCUM_SS_ID, { getName: () => 'Accumulation Cost' }, 5, 1, 1, 1));
eq('PTO other tab ignored', EDITS.length, 1);
onWatchedEdit({ range: {}, source: {} });
onWatchedEdit({ range: { getRow: 5 }, source: { getId: 'x' } });
onWatchedEdit(undefined);
eq('JSON-only (google.script.run) calls ignored', EDITS.length, 1);

const curQ = computeFiscalContext_(new Date()).goalsQuarter;
const goalsSheet = Object.assign(fakeSheet([
  ['Rocketeer', 'Goal ID', 'Fiscal Quarter'], ['Ana', 'G1', curQ], ['Luis', 'G2', 'FY20Q1'],
]), { getName: () => 'RD' });
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, goalsSheet, 3, 1, 1, 3));
eq('goals edit on old quarter ignored', EDITS.length, 1);
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, goalsSheet, 1, 3, 1, 3));
eq('goals paste incl. current quarter stamps', [EDITS[1][0], EDITS[1][1].status, EDITS[1][1].coversPeriod], ['goals', 'ok', curQ]);
const noFq = Object.assign(fakeSheet([['Rocketeer', 'Goal ID'], ['Ana', 'G1']]), { getName: () => 'RD' });
onWatchedEdit(evt(CONFIG_PS.GOALS_SS_ID, noFq, 2, 1, 1, 2));
eq('goals missing Fiscal Quarter → failed', [EDITS[2][0], EDITS[2][1].status], ['goals', 'failed']);
ck('goals failure lists headers', /Headers found: rocketeer, goal id/.test(EDITS[2][1].detail));
recordSourceStatus_ = realRecord;
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `ReferenceError: onWatchedEdit is not defined`.

- [ ] **Step 3: Append the edit handler to `SourceStatus.js`**

```js
// ── Edit handler (installable on-edit, Goals + PTO workbooks) ─

// Public because installable triggers cannot call private (_) functions.
// Deliberately NOT gated with requireMaintainer_: it runs for whichever colleague
// edited the sheet. It acts only on a genuine edit event — google.script.run can
// pass JSON only, never a live Range with methods — and the most it can do is
// stamp "now" on the goals or pto ledger row. Allow-listed in
// tests/callable-surface-checks.js for that reason.
function onWatchedEdit(e) {
  if (!e || !e.range || typeof e.range.getRow !== "function" ||
      !e.source || typeof e.source.getId !== "function") return;
  try {
    var ids = getExternalSSIds_();
    var srcId = e.source.getId();
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var edit = { row: e.range.getRow(), numRows: e.range.getNumRows(),
                 col: e.range.getColumn(), numCols: e.range.getNumColumns() };
    var now = new Date();
    var lastRow = edit.row + edit.numRows - 1;

    if (srcId === ids.ptoAccum && sheetName === SOURCE_STATUS.PTO_SHEET) {
      var watch = { firstRow: SOURCE_STATUS.PTO_FIRST_ROW, firstCol: SOURCE_STATUS.PTO_FIRST_COL,
                    lastCol: SOURCE_STATUS.PTO_LAST_COL };
      if (!editTouchesRange_SS_(edit, watch)) return;
      recordSourceStatus_("pto", {
        status: "ok", lastUpdated: now, coversPeriod: SOURCE_STATUS.PTO_SHEET + "!A2:N",
        detail: "Edited rows " + Math.max(edit.row, 2) + "–" + lastRow,
      });
      return;
    }

    if (srcId === ids.goals && sheetName === CONFIG_PS.SHEET_GOALS) {
      var first = Math.max(edit.row, 2);
      if (lastRow < first) return;
      var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim().toLowerCase(); });
      var qCol = hdr.indexOf(SOURCE_STATUS.GOALS_QUARTER_HEADER);
      if (qCol === -1) {
        recordSourceStatus_("goals", { status: "failed",
          detail: "Cannot read: RD column missing: Fiscal Quarter. Headers found: " + hdr.join(", ") });
        return;
      }
      var quarters = sheet.getRange(first, qCol + 1, lastRow - first + 1, 1).getValues()
        .map(function (r) { return r[0]; });
      var ctx = computeFiscalContext_(now);
      if (!goalsEditQualifies_SS_(quarters, ctx)) return;
      recordSourceStatus_("goals", {
        status: "ok", lastUpdated: now, coversPeriod: ctx.goalsQuarter,
        detail: "Edit touched " + (lastRow - first + 1) + " row(s) incl. " + ctx.goalsQuarter,
      });
    }
  } catch (err) {
    Logger.log("⚠️ [onWatchedEdit] " + err.message);
  }
}
```

- [ ] **Step 4: Allow-list `onWatchedEdit` in the callable-surface test**

In `ps-dashboard/tests/callable-surface-checks.js`, change the `ALLOWED_UNGATED` set to:

```js
const ALLOWED_UNGATED = new Set([
  // doGet IS the gate — it calls checkDashboardAccess() and renders the denied page.
  'doGet',
  // Reports only on the caller's own session; leaks nothing about anyone else.
  'whoAmI',
  // Installable on-edit handler for the Goals/PTO workbooks (SourceStatus.js). Runs as
  // whichever colleague edited, so it cannot require an admin. It returns at once unless
  // given a live Range (impossible over google.script.run, which carries JSON only), and
  // its only effect is stamping "now" on one Source Status row.
  'onWatchedEdit',
]);
```

- [ ] **Step 5: Run both test files**

Run: `node "ps-dashboard/tests/source-status-checks.js" && node "ps-dashboard/tests/callable-surface-checks.js"`
Expected: both report `0 failed` (the callable-surface suite prints its own pass/fail summary).

- [ ] **Step 6: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceStatus.js ps-dashboard/tests/source-status-checks.js ps-dashboard/tests/callable-surface-checks.js
git commit -m "feat(sources): on-edit stamps for Goals (evaluated quarter) and PTO (2023 RD A2:N)"
```

---

### Task 6: Daily checks, payload reader and the installer

**Files:**
- Modify: `ps-dashboard/SourceStatus.js` (append)
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)

- [ ] **Step 1: Write the failing tests**

`runSourceChecks_` and the installer touch many GAS services and are validated live (Task 10/11). The pure parts are tested here:

```js
// ── Task 6: payload reader ───────────────────────────────────────────────────
LEDGER = fakeSheet([SOURCE_STATUS.HEADERS.slice(),
  ['tempo_tracked', 'Tempo Tracked', '2026.W46', at(2 * H), NOW, 'ok', 'Run ok in 40 s', ''],
  ['rcr', 'RCR', 'Oct 26', new Date(2026, 9, 31), NOW, 'ok', 'Oct 26 filled by Finance', ''],
]);
const client = readSourceStatus_();
eq('reader returns every source', client.length, 10);
const trc = client.filter(s => s.key === 'tempo_tracked')[0];
eq('reader client shape', Object.keys(trc).sort(),
   ['coversPeriod', 'detail', 'digest', 'key', 'label', 'lastUpdatedLabel', 'nextExpectedLabel', 'status']);
eq('reader labels with ISO week', trc.lastUpdatedLabel, stampLabel_SS_(at(2 * H)));
ck('reader output is JSON-safe (no Date objects)', JSON.stringify(client) === JSON.stringify(JSON.parse(JSON.stringify(client))) &&
   !client.some(s => Object.values(s).some(v => v instanceof Date)));
eq('unstamped source → pending in reader', client.filter(s => s.key === 'tempo_capacity')[0].status, 'pending');
eq('client covers period from a Date cell is labelled', toClientSource_SS_(
   Object.assign(evaluateSourceStatus_(def('rcr'), { coversPeriod: new Date(2026, 9, 26) }, NOW))).coversPeriod, '2026-10-26 (2026.W44)');
LEDGER = null;
eq('reader with no ledger tab → []', readSourceStatus_(), []);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: `ReferenceError: readSourceStatus_ is not defined`.

- [ ] **Step 3: Append the reader, daily checks and installer to `SourceStatus.js`**

```js
// ── Reading the ledger ──────────────────────────────────────

// Evaluated rows (with Date fields) for every defined source, in config order.
function evaluatedRows_SS_(now) {
  now = now || new Date();
  var sh = ledgerSpreadsheet_SS_().getSheetByName(SOURCE_STATUS.SHEET);
  var rows = sh ? readLedgerRows_SS_(sh).rows : {};
  var props = PropertiesService.getScriptProperties().getProperties();
  return sourceDefs_(props).map(function (d) { return evaluateSourceStatus_(d, rows[d.key], now); });
}

// google.script.run cannot carry Date objects: labels only.
function toClientSource_SS_(r) {
  return {
    key: r.key, label: r.label, digest: r.digest, status: r.status, detail: r.detail || "",
    coversPeriod: isDate_SS_(r.coversPeriod) ? stampLabel_SS_(r.coversPeriod) : String(r.coversPeriod || ""),
    lastUpdatedLabel: stampLabel_SS_(r.lastUpdated),
    nextExpectedLabel: stampLabel_SS_(r.nextExpected),
  };
}

// For the report payload (meta.sources). Never throws; [] when there is no ledger yet.
function readSourceStatus_() {
  try {
    var sh = ledgerSpreadsheet_SS_().getSheetByName(SOURCE_STATUS.SHEET);
    if (!sh) return [];
    return evaluatedRows_SS_(new Date()).map(toClientSource_SS_);
  } catch (e) {
    Logger.log("⚠️ [readSourceStatus_] " + e.message);
    return [];
  }
}

// ── Daily checks ────────────────────────────────────────────

// Returns a problem string, or null when the tab (and optional header) is readable.
function probeSheet_SS_(ssId, tabName, requiredHeaderLc) {
  var sh = SpreadsheetApp.openById(ssId).getSheetByName(tabName);
  if (!sh) return 'tab "' + tabName + '" not found';
  if (!requiredHeaderLc) return null;
  var hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  return hdr.indexOf(requiredHeaderLc) === -1 ? 'column "' + requiredHeaderLc + '" not found in ' + tabName : null;
}

function recordIf_SS_(key, fields) {
  if (fields) recordSourceStatus_(key, fields);
}

// Order matters: trigger flags → probes → roster → SI → RCR, so the rule rows written
// last carry today's computed state.
function runSourceChecks_() {
  var now = new Date();
  var props = PropertiesService.getScriptProperties();
  var ids = getExternalSSIds_();
  var rows = readLedgerRows_SS_(ledgerSheet_SS_()).rows;
  var defs = sourceDefs_(props.getProperties());

  // 1. Missing triggers (catches the 2026.W39 silent stop at its cause)
  var actual = ScriptApp.getProjectTriggers().map(function (t) {
    var sid = null;
    try { sid = t.getTriggerSourceId(); } catch (e) {}
    return { handler: t.getHandlerFunction(), sourceId: sid };
  });
  var missing = missingTriggers_SS_(expectedTriggers_SS_(defs, ids), actual);
  expectedTriggers_SS_(defs, ids).forEach(function (exp) {
    var miss = missing.filter(function (m) { return m.key === exp.key; })[0];
    recordIf_SS_(exp.key, flagOutcome_SS_(rows[exp.key], miss ? "run " + miss.installer : null, "Trigger missing"));
  });

  // 2. Probes: Goals RD + Fiscal Quarter, PTO 2023 RD
  [["goals", ids.goals, CONFIG_PS.SHEET_GOALS, SOURCE_STATUS.GOALS_QUARTER_HEADER],
   ["pto", ids.ptoAccum, SOURCE_STATUS.PTO_SHEET, null]].forEach(function (p) {
    var problem;
    try { problem = probeSheet_SS_(p[1], p[2], p[3]); } catch (e) { problem = e.message; }
    recordIf_SS_(p[0], flagOutcome_SS_(rows[p[0]], problem, "Cannot read"));
  });

  // 3. Roster fingerprint
  try {
    var rsh = SpreadsheetApp.openById(ids.roster).getSheetByName(CONFIG_PS.SHEET_ROSTER);
    if (!rsh) throw new Error('tab "' + CONFIG_PS.SHEET_ROSTER + '" not found');
    var vals = rsh.getDataRange().getValues();
    var fp = fingerprint_SS_(vals);
    var change = rosterCheck_SS_(props.getProperty(SOURCE_STATUS.ROSTER_FP_PROP), fp, vals.length - 1, now);
    props.setProperty(SOURCE_STATUS.ROSTER_FP_PROP, fp);
    var restore = flagOutcome_SS_(rows.roster, null, "Cannot read");
    recordSourceStatus_("roster", Object.assign({}, restore || {}, change || {}));
  } catch (e) {
    recordSourceStatus_("roster", flagOutcome_SS_(rows.roster, e.message, "Cannot read"));
  }

  // 4. Small Improvements (fixed date rule)
  recordSourceStatus_("si", siStatus_SS_(now));

  // 5. RCR (bound spreadsheet, "3. RCR")
  try {
    var rcr = ledgerSpreadsheet_SS_().getSheetByName(CONFIG_PS.SHEET_RCR);
    if (!rcr) throw new Error('tab "' + CONFIG_PS.SHEET_RCR + '" not found');
    var rv = rcr.getDataRange().getValues();
    recordSourceStatus_("rcr", rcrStatus_SS_(rv[0].map(String), rv.slice(1), now));
  } catch (e) {
    recordSourceStatus_("rcr", { status: "failed", detail: "Cannot read: " + e.message });
  }
}

// Daily 05:00 trigger handler.
function checkSourcesDaily() {
  requireMaintainer_("checkSourcesDaily");
  runSourceChecks_();
}

// ── Installer (run once from the editor; safe to re-run) ────

function installSourceStatusTriggers() {
  requireMaintainer_("installSourceStatusTriggers");
  var props = PropertiesService.getScriptProperties();
  props.setProperty(SOURCE_STATUS.LEDGER_SS_PROP, SpreadsheetApp.getActiveSpreadsheet().getId());
  var ids = getExternalSSIds_();

  var mine = ["onWatchedEdit", "checkSourcesDaily", "sendSourceHealthDigest"];
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return mine.indexOf(t.getHandlerFunction()) !== -1; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  // Seed every row once, before anything can flag it.
  var rows = readLedgerRows_SS_(ledgerSheet_SS_()).rows;
  sourceDefs_().forEach(function (d) {
    if (!rows[d.key]) recordSourceStatus_(d.key, { status: "pending", detail: "awaiting first update" });
  });

  // Edit triggers need EDIT access to each workbook for the account running this.
  [["goals", ids.goals], ["pto", ids.ptoAccum]].forEach(function (w) {
    try {
      ScriptApp.newTrigger("onWatchedEdit").forSpreadsheet(w[1]).onEdit().create();
      Logger.log("⚙️ on-edit trigger installed for " + w[0] + " (" + w[1] + ")");
    } catch (e) {
      recordSourceStatus_(w[0], { status: "failed", detail: "Trigger missing: install failed — " + e.message });
      Logger.log("❌ on-edit trigger for " + w[0] + " failed: " + e.message);
    }
  });
  ScriptApp.newTrigger("checkSourcesDaily").timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger("sendSourceHealthDigest").timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10).create();
  Logger.log("⚙️ checkSourcesDaily daily 05:00 · sendSourceHealthDigest Monday 10:00");

  // Spec §11: confirm the PTO tab and range once, in the log.
  try {
    var pto = SpreadsheetApp.openById(ids.ptoAccum).getSheetByName(SOURCE_STATUS.PTO_SHEET);
    Logger.log(pto
      ? "ℹ️ " + SOURCE_STATUS.PTO_SHEET + " headers A1:N1: " + pto.getRange(1, 1, 1, 14).getValues()[0].join(" | ")
      : "⚠️ " + SOURCE_STATUS.PTO_SHEET + " not found in the PTO workbook");
  } catch (e) { Logger.log("⚠️ PTO probe: " + e.message); }

  runSourceChecks_();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node "ps-dashboard/tests/source-status-checks.js" && node "ps-dashboard/tests/callable-surface-checks.js"`
Expected: both `0 failed` (`checkSourcesDaily` and `installSourceStatusTriggers` carry `requireMaintainer_`).

- [ ] **Step 5: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceStatus.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): daily checks, missing-trigger flags, payload reader, installer"
```

---

### Task 7: Send and preview the digest

**Files:**
- Modify: `ps-dashboard/SourceDigest.js` (append)

- [ ] **Step 1: Append the Apps Script functions**

```js
// ── Apps Script glue ────────────────────────────────────────

function digestRecipients_SS_() {
  var p = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.DIGEST_RECIPIENTS_PROP);
  return (p && p.trim()) ? p.trim() : Session.getEffectiveUser().getEmail();
}

function dashboardUrl_SS_() {
  var p = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.DASHBOARD_URL_PROP);
  if (p) return p;
  try { return ScriptApp.getService().getUrl() || ""; } catch (e) { return ""; }
}

// Monday 10:00 trigger handler. Re-evaluates everything at send time.
function sendSourceHealthDigest() {
  requireMaintainer_("sendSourceHealthDigest");
  var now = new Date(), wk = isoLabel_SS_(now);
  runSourceChecks_();
  var d = buildDigest_SS_(evaluatedRows_SS_(now), now, dashboardUrl_SS_());
  if (!d) {
    recordSourceStatus_("digest", { status: "ok", lastUpdated: now, coversPeriod: wk, detail: "Nothing to report" });
    return { sent: false };
  }
  try {
    MailApp.sendEmail({ to: digestRecipients_SS_(), subject: d.subject, body: d.body });
    recordSourceStatus_("digest", { status: "ok", lastUpdated: now, coversPeriod: wk,
                                    detail: "Sent: " + d.count + " source(s) need attention" });
    return { sent: true, count: d.count };
  } catch (e) {
    recordSourceStatus_("digest", { status: "failed", detail: "Send failed: " + e.message });
    throw e;
  }
}

// Run from the editor: emails ONLY the caller, whatever the state, with every row listed.
function previewSourceHealthDigest() {
  var me = requireMaintainer_("previewSourceHealthDigest");
  var now = new Date(), wk = isoLabel_SS_(now);
  runSourceChecks_();
  var rows = evaluatedRows_SS_(now);
  var d = buildDigest_SS_(rows, now, dashboardUrl_SS_()) ||
          { subject: "PS Dashboard sources: nothing to report (" + wk + ")",
            body: "No Goals or Tempo source needs attention — the scheduled digest would send nothing this week." };
  MailApp.sendEmail({ to: me, subject: "[Preview] " + d.subject,
                      body: d.body + "\n\nAll sources:\n" + buildStatusSummary_SS_(rows) });
  return { previewedTo: me };
}
```

- [ ] **Step 2: Run the test suites**

Run: `node "ps-dashboard/tests/source-status-checks.js" && node "ps-dashboard/tests/callable-surface-checks.js"`
Expected: both `0 failed` (the eval of `SourceDigest.js` must not throw; both public functions are gated).

- [ ] **Step 3: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/SourceDigest.js
git commit -m "feat(sources): Monday digest sender and owner-only preview"
```

---

### Task 8: Wrap the producers

**Files:**
- Modify: `ps-dashboard/TempoTrackedTime.js:122` (`function fetchTempoLoggedTime() {`)
- Modify: `ps-dashboard/TempoPlanExport.js:416` (`function fetchTempoPlannedTime() {`)
- Modify: `ps-dashboard/TempoCapacityTime.js:52` (`function fetchTempoCapacity() {`)
- Modify: `ps-dashboard/Kudos.js` (`function runKudosNormalizer() {`)
- Modify: `ps-dashboard/tests/source-status-checks.js` (insert above `// ── SUMMARY`)

- [ ] **Step 1: Write the failing tests**

```js
// ── Task 8: producers are wrapped ────────────────────────────────────────────
[['TempoTrackedTime.js', 'fetchTempoLoggedTime', 'tempo_tracked'],
 ['TempoPlanExport.js', 'fetchTempoPlannedTime', 'tempo_plan'],
 ['TempoCapacityTime.js', 'fetchTempoCapacity', 'tempo_capacity'],
 ['Kudos.js', 'runKudosNormalizer', 'kudos']].forEach(function (p) {
  const src = read(p[0]);
  const re = new RegExp('function ' + p[1] + '\\(\\)\\s*\\{[\\s\\S]*?withSourceStatus_\\("' + p[2] + '", ' + p[1] + 'Body_\\)');
  ck(p[0] + ': public ' + p[1] + ' wraps its body', re.test(src));
  ck(p[0] + ': body is private', new RegExp('function ' + p[1] + 'Body_\\(\\)').test(src));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node "ps-dashboard/tests/source-status-checks.js"`
Expected: 8 failures, e.g. `❌ TempoTrackedTime.js: public fetchTempoLoggedTime wraps its body`.

- [ ] **Step 3: Wrap `fetchTempoLoggedTime`**

In `ps-dashboard/TempoTrackedTime.js`, rename the line `function fetchTempoLoggedTime() {` to `function fetchTempoLoggedTimeBody_() {` and insert directly above it (above its JSDoc block if it has one):

```js
// Entry point for the daily trigger and manual runs. The gate runs first so an
// unauthorized google.script.run call never stamps the ledger as "failed".
// typeof guards: this file can live in its own Apps Script project.
function fetchTempoLoggedTime() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoLoggedTime');
  if (typeof withSourceStatus_ !== 'function') return fetchTempoLoggedTimeBody_();
  return withSourceStatus_("tempo_tracked", fetchTempoLoggedTimeBody_);
}
```

- [ ] **Step 4: Wrap `fetchTempoPlannedTime`**

In `ps-dashboard/TempoPlanExport.js`, rename `function fetchTempoPlannedTime() {` to `function fetchTempoPlannedTimeBody_() {` and insert above it:

```js
// Entry point for the Monday trigger and manual runs. See fetchTempoLoggedTime.
function fetchTempoPlannedTime() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoPlannedTime');
  if (typeof withSourceStatus_ !== 'function') return fetchTempoPlannedTimeBody_();
  return withSourceStatus_("tempo_plan", fetchTempoPlannedTimeBody_);
}
```

Then search the file for other callers: `grep -n "fetchTempoPlannedTime()" ps-dashboard/TempoPlanExport.js`. `backfillPlanHistory` / `refreshPlanHistory` may call it; leave those calls pointing at the public `fetchTempoPlannedTime` so a manual backfill also stamps the row.

- [ ] **Step 5: Wrap `fetchTempoCapacity`**

In `ps-dashboard/TempoCapacityTime.js`, rename `function fetchTempoCapacity() {` to `function fetchTempoCapacityBody_() {` and insert above it:

```js
// Entry point for the Friday trigger and manual runs. See fetchTempoLoggedTime.
function fetchTempoCapacity() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoCapacity');
  if (typeof withSourceStatus_ !== 'function') return fetchTempoCapacityBody_();
  return withSourceStatus_("tempo_capacity", fetchTempoCapacityBody_);
}
```

- [ ] **Step 6: Wrap `runKudosNormalizer`**

In `ps-dashboard/Kudos.js`, rename `function runKudosNormalizer() {` to `function runKudosNormalizerBody_() {` and insert above its JSDoc block:

```js
/**
 * Entry point (editor / button). Gate first so a blocked caller never stamps the
 * ledger; the body keeps its own check and its toast-on-error behaviour.
 */
function runKudosNormalizer() {
  const access = checkDashboardAccess();
  if (!hasAdminPower_(access)) {
    Logger.log(`⚠️ [Kudos] runKudosNormalizer blocked for ${access.email} (${access.role}).`);
    return { ok: false, error: "Admin access required" };
  }
  return withSourceStatus_("kudos", runKudosNormalizerBody_);
}
```

- [ ] **Step 7: Run all suites**

Run: `node "ps-dashboard/tests/source-status-checks.js" && node "ps-dashboard/tests/callable-surface-checks.js"`
Expected: both `0 failed`.

- [ ] **Step 8: Commit**

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/TempoTrackedTime.js ps-dashboard/TempoPlanExport.js ps-dashboard/TempoCapacityTime.js ps-dashboard/Kudos.js ps-dashboard/tests/source-status-checks.js
git commit -m "feat(sources): Tempo exporters and Kudos stamp their own ledger rows"
```

---

### Task 9: Dashboard — payload, Data Sources table, header pill

**Files:**
- Modify: `ps-dashboard/PS Contribution Report.js` (the `meta: {` object in `getPSReportData`, next to `trackedTimeLastExport`)
- Modify: `ps-dashboard/PS Dashboard.html` (CSS after `.dr-tbl td`, the Data Sources table, the `dataFreshnessNote` block, new client functions before `function esc(s) {`)
- Create: `ps-dashboard/tests/source-status-ui-checks.js`

- [ ] **Step 1: Write the failing UI test**

Create `ps-dashboard/tests/source-status-ui-checks.js`:

```js
// Node checks for the Source Status client rendering (spec 2026-11-09 §6).
// Run: node "ps-dashboard/tests/source-status-ui-checks.js"
const fs   = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); } }

const START = '/* SOURCE-STATUS-UI:START */', END = '/* SOURCE-STATUS-UI:END */';
const i0 = html.indexOf(START), i1 = html.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error('❌ SOURCE-STATUS-UI block not found in PS Dashboard.html'); process.exit(1); }
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let METRICS = { rcr: true, planned: true, tracked: true };
const hasMetric_ = m => !!METRICS[m];
eval(html.slice(i0, i1));

const S = [
  { key: 'tempo_tracked', label: 'Tempo Tracked', status: 'ok', coversPeriod: '2026.W46', lastUpdatedLabel: '2026-11-09 (2026.W46)', nextExpectedLabel: '2026-11-10 (2026.W46)', detail: 'Run ok in 40 s' },
  { key: 'tempo_capacity', label: 'Tempo Capacity', status: 'stale', coversPeriod: '2026.W44', lastUpdatedLabel: '2026-10-30 (2026.W44)', nextExpectedLabel: '', detail: 'No update for 10 days (limit 8 days)' },
  { key: 'rcr', label: 'RCR <TCC>', status: 'pending', coversPeriod: 'Sep 26', lastUpdatedLabel: '', nextExpectedLabel: '', detail: '' },
  { key: 'digest', label: 'Monday digest', status: 'ok', coversPeriod: '', lastUpdatedLabel: '', nextExpectedLabel: '', detail: '' },
];

const rows = renderSourceStatusRows(S);
ck('one <tr> per visible source', (rows.match(/<tr>/g) || []).length === 4);
ck('stale lozenge', /src-loz-stale'>Stale</.test(rows));
ck('labels escaped', /RCR &lt;TCC&gt;/.test(rows));
ck('dash for empty last updated', /<td>—<\/td>/.test(rows));
ck('empty state names the installer', /installSourceStatusTriggers/.test(renderSourceStatusRows([])));

METRICS = { rcr: false, planned: true, tracked: true };
ck('team without RCR hides the RCR row', !/RCR &lt;TCC&gt;/.test(renderSourceStatusRows(S)));
METRICS = { rcr: true, planned: true, tracked: true };

const pillBad = sourcePillText(S);
ck('pill names stale source', pillBad.text === '⚠ Tempo Capacity stale');
ck('pill tooltip lists sources', /Tempo Tracked: ok · 2026-11-09 \(2026\.W46\)/.test(pillBad.title));
ck('pill ignores digest + pending', !/digest|RCR/.test(pillBad.text));
ck('pill all current', sourcePillText([S[0], S[2]]).text === '✓ All sources current');
ck('pill empty', sourcePillText([]).text === '↻ Data freshness: pending');

ck('table body placeholder present', html.indexOf('id="drSourcesBody"') !== -1);
ck('old static Netsuite Kudos row removed', html.indexOf('<td>Kudos given</td><td>Netsuite Export</td>') === -1);

console.log('source-status-ui-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node "ps-dashboard/tests/source-status-ui-checks.js"`
Expected: `❌ SOURCE-STATUS-UI block not found in PS Dashboard.html`.

- [ ] **Step 3: Add the client render functions**

In `ps-dashboard/PS Dashboard.html`, insert immediately above the line `function esc(s) {`:

```js
/* SOURCE-STATUS-UI:START */
// Spec 2026-11-09 §6 — renders DATA.meta.sources (from the Source Status ledger).
var SRC_LOZ = {
  ok:      ["Current", "src-loz-ok"],
  pending: ["Pending", "src-loz-pending"],
  stale:   ["Stale",   "src-loz-stale"],
  failed:  ["Failed",  "src-loz-failed"]
};
// Ledger keys tied to a team metric: hidden for teams that do not carry the metric.
var SRC_METRIC = { rcr: "rcr", tempo_plan: "planned", tempo_tracked: "tracked" };
function srcVisible_(s) {
  var m = SRC_METRIC[s.key];
  return !m || typeof hasMetric_ !== "function" || hasMetric_(m);
}
function renderSourceStatusRows(sources) {
  if (!sources || !sources.length) {
    return "<tr><td colspan='5'>Source status not recorded yet — an admin runs <code>installSourceStatusTriggers</code> once.</td></tr>";
  }
  return sources.filter(srcVisible_).map(function (s) {
    var loz = SRC_LOZ[s.status] || SRC_LOZ.pending;
    return "<tr>" +
      "<td>" + esc(s.label) + "</td>" +
      "<td>" + esc(s.coversPeriod || "—") + "</td>" +
      "<td>" + esc(s.lastUpdatedLabel || "—") + "</td>" +
      "<td><span class='src-loz " + loz[1] + "'>" + loz[0] + "</span>" +
        (s.detail ? "<div class='src-detail'>" + esc(s.detail) + "</div>" : "") + "</td>" +
      "<td>" + esc(s.nextExpectedLabel || "—") + "</td>" +
    "</tr>";
  }).join("");
}
function sourcePillText(sources) {
  var shown = (sources || []).filter(function (s) { return s.key !== "digest" && srcVisible_(s); });
  if (!shown.length) return { text: "↻ Data freshness: pending", title: "Source Status not recorded yet." };
  var title = shown.map(function (s) {
    return s.label + ": " + s.status + (s.lastUpdatedLabel ? " · " + s.lastUpdatedLabel : "");
  }).join("\n");
  var bad = shown.filter(function (s) { return s.status === "stale" || s.status === "failed"; });
  if (!bad.length) return { text: "✓ All sources current", title: title };
  return { text: "⚠ " + bad.map(function (s) { return s.label + " " + s.status; }).join(" · "), title: title };
}
/* SOURCE-STATUS-UI:END */
```

- [ ] **Step 4: Replace the static Data Sources table**

In `ps-dashboard/PS Dashboard.html`, replace the whole `<table class="dr-tbl">…</table>` directly under `<div class="dr-section-title">Data Sources</div>` (the one whose rows start with `<tr><td>Headcount / Roster</td><td>Netsuite Export</td>`) with:

```html
          <table class="dr-tbl">
            <thead><tr><th>Source</th><th>Covers</th><th>Last updated</th><th>Status</th><th>Next expected</th></tr></thead>
            <tbody id="drSourcesBody"><tr><td colspan="5">Loading source status…</td></tr></tbody>
          </table>
          <p class="dr-p" style="margin-top:8px">Each source stamps its own row in the <em>Source Status</em> tab when it updates: Tempo exports when they run, Goals and PTO when someone pastes new data, Roster when the HRIS export changes. Small Improvements is available 14 days after quarter end; RCR covers through the month end once Finance fills it.</p>
```

- [ ] **Step 5: Add the lozenge CSS**

In `ps-dashboard/PS Dashboard.html`, insert after the line beginning `.dr-tbl td {`:

```css
.src-loz { display: inline-block; padding: 1px 8px; border-radius: 3px; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.src-loz-ok      { background: #DCFFF1; color: #216E4E; }
.src-loz-pending { background: #F1F2F4; color: #44546F; }
.src-loz-stale   { background: #FFF7D6; color: #7F5F01; }
.src-loz-failed  { background: #FFECEB; color: #AE2E24; }
.src-detail { font-size: 11px; color: var(--slate); margin-top: 3px; }
```

- [ ] **Step 6: Replace the header pill block and fill the table**

In `ps-dashboard/PS Dashboard.html`, replace everything from the line `  var _fn = document.getElementById("dataFreshnessNote");` through the closing lines

```js
    _fn.style.display = "";
  }
```

(the whole `if (_fn) { … }` block, including the `_fmtTs` helper and the `trackedAt || srcAt` branches) with:

```js
  var _fn = document.getElementById("dataFreshnessNote");
  if (_fn) {
    var _pill = sourcePillText(DATA.meta && DATA.meta.sources);
    _fn.textContent = _pill.text;
    _fn.title = _pill.title;
    _fn.style.display = "";
  }
  var _srcBody = document.getElementById("drSourcesBody");
  if (_srcBody) _srcBody.innerHTML = renderSourceStatusRows(DATA.meta && DATA.meta.sources);
```

- [ ] **Step 7: Add `meta.sources` to the payload**

In `ps-dashboard/PS Contribution Report.js`, inside `getPSReportData`'s returned `meta: {` object, add directly after the line `      trackedTimeLastExport: trackedAll._lastExport || null,`:

```js
      // Source Status ledger (SourceStatus.js) — one evaluated row per data source.
      sources:          readSourceStatus_(),
```

- [ ] **Step 8: Run every suite in the project**

Run:

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
for f in ps-dashboard/tests/*.js; do echo "== $f"; node "$f" || echo "FAILED: $f"; done
```

Expected: no `FAILED:` lines. If a pre-existing suite fails, run it on `fdf31c1` (`git stash; node <file>; git stash pop`) to confirm the failure predates this work before touching it.

- [ ] **Step 9: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html" "ps-dashboard/PS Contribution Report.js" ps-dashboard/tests/source-status-ui-checks.js
git commit -m "feat(sources): live Data Sources table and header pill from the ledger"
```

---

### Task 10: Push, deploy, install, preview

**Files:** none changed in git (`.clasp.json` / `.claspignore` are untracked local files).

- [ ] **Step 1: Copy the clasp binding into the worktree**

```bash
cp /d/Development/ps-dashboard/.clasp.json /d/Development/ps-dashboard/.claspignore \
   "/d/Development/ps-dashboard/.claude/worktrees/source-status-spec/ps-dashboard/"
```

The `.claspignore` allow-list (`*.js`, `*.html`, `appsscript.json`; `tests/**`, `docs/**` excluded) already admits `SourceStatus.js` and `SourceDigest.js`. Do not add them to `filePushOrder`: they hold only `var` literals and functions, so load order does not matter.

- [ ] **Step 2: Push**

```bash
cd "/d/Development/ps-dashboard/.claude/worktrees/source-status-spec/ps-dashboard" && clasp push
```

Expected: the file list includes `SourceStatus.js` and `SourceDigest.js`, and no `tests/` or `docs/` files.

- [ ] **Step 3: Redeploy the existing web-app deployment in place**

```bash
clasp deployments
```

Pick the existing web-app deployment ID (not `@HEAD`), then:

```bash
clasp deploy -i <that-deployment-id> -d "2026.W46 Source Status ledger"
```

Never create a new deployment: the dashboard URL must not change.

- [ ] **Step 4: Invalidate cached payloads**

Apps Script editor → Project Settings → Script Properties → `PS_CACHE_VER`: set it to its current value + 1. Cached payloads predating `meta.sources` would otherwise render "Source status not recorded yet" until their TTL.

- [ ] **Step 5: Install triggers (as the account that owns the Tempo triggers)**

The account must be an admin in the dashboard access lists and have **edit** access to the Goals workbook (`1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ`) and the PTO workbook (`1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo`). In the editor, run `installSourceStatusTriggers`, accept the new OAuth scopes (`script.send_mail`).

Expected in the execution log:
- `⚙️ on-edit trigger installed for goals (…)` and `… for pto (…)`
- `⚙️ checkSourcesDaily daily 05:00 · sendSourceHealthDigest Monday 10:00`
- `ℹ️ 2023 RD headers A1:N1: …` — record this line in Task 11.

Then open the `Source Status` tab in the dashboard spreadsheet. Expected: ten rows; SI `ok · FY27Q1`, RCR `ok` or `pending` per Finance, Roster `pending · Baseline captured …`, everything else `pending · awaiting first update`; no `Trigger missing` rows.

- [ ] **Step 6: Preview the digest**

Run `previewSourceHealthDigest` in the editor. Expected: one email to you, subject starting `[Preview] PS Dashboard sources:`, ending with an `All sources:` block listing ten lines.

- [ ] **Step 7: Open the dashboard**

Load the web app → Data Reference tab. Expected: the live table with lozenges; header pill `✓ All sources current` or naming stale/failed sources (pending rows do not count).

---

### Task 11: Validate with real updates (definition of done)

**Files:**
- Modify: `ps-dashboard/docs/specs/2026-11-09-source-status-ledger-design.md` (append a `## 12. Validation log` section)

Every row counts only once a real event stamps it. Check the `Source Status` tab after each date and tick:

- [ ] **Tempo Tracked** — 06:00 run on 2026-11-10 (2026.W46) → `ok`, `Last updated` that morning.
- [ ] **SI / RCR** — `checkSourcesDaily` 05:00 on 2026-11-10 (2026.W46) → `Last checked` that morning; SI `ok · FY27Q1`; RCR `ok · Oct 26` or `pending` naming Oct 26.
- [ ] **Tempo Capacity** — Friday 08:00 run on 2026-11-13 (2026.W46) → `ok`.
- [ ] **Tempo Plan** — Monday 08:00 run on 2026-11-16 (2026.W47) → `ok`.
- [ ] **Monday digest** — 10:00 on 2026-11-16 (2026.W47) → `digest` row `ok · Nothing to report`, or an email listing exactly the Goals/Tempo rows shown as stale/failed.
- [ ] **Goals** — next manual paste into `RD` touching FY27Q2 rows → `ok · FY27Q2`. A paste of only older-quarter rows must leave it unchanged.
- [ ] **PTO** — next manual paste into `2023 RD`!A2:N → `ok`, detail `Edited rows …`.
- [ ] **Roster** — next HRIS export that changes `Data` → `ok · Data tab changed (N rows)`.
- [ ] **Kudos** — next `runKudosNormalizer` run → `ok · Run ok in N s`.

- [ ] **Record the results**

Append to the spec:

```markdown
## 12. Validation log

| Source | Validating event | Stamped at | Result |
|---|---|---|---|
| Tempo Tracked | daily 06:00 run | <date (ISO week) time> | ok / issue |
| … one row per item above … | | | |

PTO `2023 RD` headers A1:N1 at install: <paste the log line from Task 10 Step 5>.
```

```bash
cd "D:/Development/ps-dashboard/.claude/worktrees/source-status-spec"
git add ps-dashboard/docs/specs/2026-11-09-source-status-ledger-design.md
git commit -m "docs(sources): validation log — sources stamped by real updates"
git push
```

---

## Spec coverage check

| Spec section | Task |
|---|---|
| §3 ledger tab, columns, seeding, read-time status, overridable thresholds | 1, 4, 6 |
| §4 per-source rules (Tempo ×3, Goals, PTO, Roster, Kudos, SI, RCR, Digest) | 1, 2, 5, 6, 7, 8 |
| §4 evaluated quarter + grace window | 2, 5 |
| §5 components | 1–8 |
| §6 dashboard table, pill, ISO dates, lozenges, Compensation via RCR label | 9 |
| §7 triggers, edit-access requirement | 6, 10 |
| §8 Monday email, recipients property, subject/body | 3, 7 |
| §9 ledger never breaks producers, lock, fast edit handler, missing triggers, digest failure row | 4, 5, 6, 7 |
| §10 unit tests + proof by real updates + preview | 1–9, 10, 11 |
| §11 open items (edit access, 2023 RD range, New RCR gap) | 10 (access, headers logged); New RCR stays out of scope |
