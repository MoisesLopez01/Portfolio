// Node runner for the LIGHT-run merge in writeRawSheet_ / writeArrivals_.
// Usage: node tests/ps-dashboard/jira-merge-tests.js
//
// WHY THIS FILE EXISTS (2026-08-24): the hourly export stopped re-fetching 52
// weeks and started MERGING 8 weeks onto frozen history. A merge fails quietly —
// a duplicated row reads as extra delivery, a dropped row as less, a schema
// shift as garbage in every column — and none of it errors. These are the three
// failure modes the merge has, asserted directly.
const fs = require("fs");
const path = require("path");

let CHECKS = 0;
function assert_(cond, msg) {
  CHECKS++;
  if (!cond) { console.error("❌ " + msg); process.exit(1); }
}

// ── Fake Sheet (same shape as jira-flowsnap-tests) ─────────────────────────
function FakeSheet() { this.rows = []; }
FakeSheet.prototype.getLastRow = function () { return this.rows.length; };
FakeSheet.prototype.getLastColumn = function () {
  return this.rows.reduce(function (n, r) { return Math.max(n, r.length); }, 0);
};
FakeSheet.prototype.getDataRange = function () {
  var self = this;
  return { getValues: function () { return self.rows.map(function (r) { return r.slice(); }); } };
};
FakeSheet.prototype.getRange = function (row, col, nRows, nCols) {
  var self = this;
  var noop = function () { return chain; };
  var chain = {
    getValues: function () {
      var out = [];
      for (var i = 0; i < (nRows || 1); i++) {
        var src = self.rows[row - 1 + i] || [];
        out.push(src.slice(col - 1, col - 1 + (nCols || 1)));
      }
      return out;
    },
    setValues: function (vals) {
      for (var i = 0; i < vals.length; i++) {
        var t = row - 1 + i;
        while (self.rows.length <= t) self.rows.push([]);
        for (var j = 0; j < vals[i].length; j++) self.rows[t][col - 1 + j] = vals[i][j];
      }
      return chain;
    },
    setValue: function (v) {
      var t = row - 1;
      while (self.rows.length <= t) self.rows.push([]);
      self.rows[t][col - 1] = v;
      return chain;
    },
    setBackground: noop, setFontColor: noop, setFontWeight: noop, setFontSize: noop,
    setFontFamily: noop, setVerticalAlignment: noop, setFontStyle: noop,
    setNumberFormat: noop, setHorizontalAlignment: noop, setWrap: noop,
  };
  return chain;
};
FakeSheet.prototype.appendRow = function (r) { this.rows.push(r.slice()); };
FakeSheet.prototype.deleteRow = function (n) { this.rows.splice(n - 1, 1); };
FakeSheet.prototype.setFrozenRows = function () {};
FakeSheet.prototype.clearContents = function () { this.rows = []; };
FakeSheet.prototype.clearFormats = function () {};
FakeSheet.prototype.autoResizeColumns = function () {};
FakeSheet.prototype.setColumnWidth = function () {};

const SHEETS = {};
function sheetFor(name) {
  if (!SHEETS[name]) SHEETS[name] = new FakeSheet();
  return SHEETS[name];
}

global.Logger = { log: function () {} };
global.SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return { getSheetByName: sheetFor, insertSheet: sheetFor };
  },
  flush: function () {},
};
global.UrlFetchApp = {};
global.LockService = { getScriptLock: function () {
  return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
global.ScriptApp = { WeekDay: { MONDAY: 1 }, getProjectTriggers: function () { return []; } };
global.PropertiesService = { getScriptProperties: function () {
  return { getProperty: function () { return null; }, setProperty: function () {} }; } };
global.Utilities = { sleep: function () {} };
// Lives in a sibling GAS file (legacy-contribution/Contribution Report.js) — the
// Apps Script project shares one global scope, node does not. Stubbed to the
// same normalisation, because this suite is about the MERGE, not about space
// resolution.
global.normalizeName_ = function (n) {
  return String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
};

eval(fs.readFileSync(
  path.join(__dirname, "..", "..", "ps-dashboard", "Jira Backlog.js"), "utf8"));

const RAW = "Jira Raw";
function issue(key, extra) {
  return Object.assign({
    key: key,
    fields: {
      summary: "Work " + key,
      issuetype: { name: "Task" },
      project: { key: "ACME" },
      status: { name: "Done", statusCategory: { name: "Done" } },
      assignee: { displayName: "Maria Alvarez" },
      resolutiondate: "2026-08-20T10:00:00.000+0800",
    },
  }, extra || {});
}
function rawRows() { return sheetFor(RAW).getDataRange().getValues(); }
function keysOnSheet() {
  return rawRows().slice(1)
    .filter(function (r) { return /^\d{4}\.W\d{1,2}$/.test(String(r[0])); })
    .map(function (r) { return String(r[1]); });
}

// ── Seed: a FULL run writes weeks W30–W33 ──────────────────────────────────
writeRawSheet_([
  { label: "2026.W30", issues: [issue("OLD-1"), issue("OLD-2")] },
  { label: "2026.W31", issues: [issue("OLD-3")] },
  { label: "2026.W32", issues: [issue("MID-1")] },
  { label: "2026.W33", issues: [issue("NEW-1")] },
  { label: "Open",     issues: [issue("OPEN-1")] },
]);
assert_(keysOnSheet().length === 5, "seed: 5 week-labelled rows, got " + keysOnSheet().length);
assert_(rawRows()[0].length === RAW_HEADERS.length,
        "seed: header width matches RAW_HEADERS (" + RAW_HEADERS.length + ")");

// ── 0. ROW WIDTH == HEADER WIDTH ───────────────────────────────────────────
// v3.18.0 deleted four columns from the MIDDLE of RAW_HEADERS and from the row
// array. If those two edits ever disagree, every column past the mistake is
// written under the wrong header — silently, for every row, forever.
var dataRow = rawRows()[1];
assert_(dataRow.length === RAW_HEADERS.length,
        "a data row is exactly as wide as the header — got " + dataRow.length +
        " vs " + RAW_HEADERS.length);
assert_(RAW_HEADERS.indexOf("Tempo Logged (hrs)") === -1 &&
        RAW_HEADERS.indexOf("Epic Tempo Rollup (hrs)") === -1,
        "the dead Tempo columns are gone from the header");
var iBilling = RAW_HEADERS.indexOf("Billing Type");
assert_(String(dataRow[iBilling]) === "Untagged",
        "…and the columns after the deletion still line up: Billing Type reads '" +
        dataRow[iBilling] + "', not a shifted neighbour");

// ── 1. A LIGHT run freezes the weeks it did not fetch ──────────────────────
writeRawSheet_(
  [ { label: "2026.W33", issues: [issue("NEW-1"), issue("NEW-2")] },
    { label: "Open",     issues: [issue("OPEN-9")] } ],
  { refreshLabels: { "2026.W33": 1 } }
);
var k = keysOnSheet();
assert_(k.indexOf("OLD-1") !== -1 && k.indexOf("OLD-3") !== -1 && k.indexOf("MID-1") !== -1,
        "frozen weeks survived a light run — got " + k.join(","));
assert_(k.indexOf("NEW-2") !== -1, "the refreshed week's new row arrived");
assert_(k.filter(function (x) { return x === "NEW-1"; }).length === 1,
        "the refreshed week was REPLACED, not appended to — NEW-1 appears " +
        k.filter(function (x) { return x === "NEW-1"; }).length + " times");
assert_(k.length === 6, "4 frozen + 2 refreshed = 6 week rows, got " + k.length);

// ── 2. THE CRUX: a reopened issue must not exist twice ─────────────────────
// OLD-2 was delivered in the frozen W30 block. It gets reopened today and comes
// back in the fresh Open block. Without the key dedupe the dashboard counts it
// as delivered AND as queued — a number that is wrong in two directions at once.
writeRawSheet_(
  [ { label: "2026.W33", issues: [issue("NEW-1")] },
    { label: "Open",     issues: [issue("OLD-2")] } ],
  { refreshLabels: { "2026.W33": 1 } }
);
var all = rawRows().slice(1).map(function (r) { return String(r[1]); });
assert_(all.filter(function (x) { return x === "OLD-2"; }).length === 1,
        "a reopened issue exists ONCE after the merge — found " +
        all.filter(function (x) { return x === "OLD-2"; }).length + " rows for OLD-2");
var old2Week = rawRows().slice(1).filter(function (r) { return String(r[1]) === "OLD-2"; })[0][0];
assert_(String(old2Week) === "Open",
        "…and it is the FRESH row that survived (Open), not the stale Done one — got " + old2Week);

// ── 3. Schema drift falls back to a full rewrite, never a silent stitch ────
sheetFor(RAW).rows[0] = ["Week", "Key", "Something Else"];   // a foreign header
writeRawSheet_(
  [ { label: "2026.W33", issues: [issue("ONLY-1")] } ],
  { refreshLabels: { "2026.W33": 1 } }
);
assert_(rawRows()[0].length === RAW_HEADERS.length,
        "a header mismatch rebuilt the sheet with the current schema");
assert_(keysOnSheet().length === 1 && keysOnSheet()[0] === "ONLY-1",
        "…discarding the unmergeable history rather than stitching across schemas — got " +
        keysOnSheet().join(","));

// ── 4. Arrivals: a light run must not empty the tab ────────────────────────
// writeArrivals_ rewrites every row from the population it is handed. Handed 8
// weeks without the merge flag it leaves an 8-row tab, and the dashboard needs
// 5 weeks for a clear rate and 26 for the walkback — a failure that looks
// exactly like a healthy small export.
function created(dateIso) { return { fields: { created: dateIso, assignee: { displayName: "A" } } }; }
function resolved(dateIso) { return { fields: { resolutiondate: dateIso } }; }

writeArrivals_(
  [created("2026-03-03T09:00:00.000Z"), created("2026-08-20T09:00:00.000Z")],
  [resolved("2026-03-03T09:00:00.000Z")]
);
var arr = sheetFor("Jira Arrivals").getDataRange().getValues();
assert_(arr.length === 3, "full arrivals write: header + 2 weeks, got " + arr.length);

writeArrivals_(
  [created("2026-08-20T09:00:00.000Z")],
  [resolved("2026-08-20T09:00:00.000Z")],
  { sinceStr: "2026-08-17" }
);
arr = sheetFor("Jira Arrivals").getDataRange().getValues();
var weeksOnTab = arr.slice(1).map(function (r) { return String(r[0]); });
assert_(weeksOnTab.indexOf("2026-03-02") !== -1,
        "the March week SURVIVED a light arrivals run — got " + weeksOnTab.join(","));
assert_(weeksOnTab.length === 2,
        "no week was duplicated by the merge — got " + weeksOnTab.length + ": " + weeksOnTab.join(","));
var aug = arr.slice(1).filter(function (r) { return String(r[0]) === "2026-08-17"; })[0];
assert_(aug && Number(aug[2]) === 1,
        "…and the refreshed week carries THIS run's counts, not the frozen ones");

console.log("✅ jira-merge-tests: all checks passed (" + CHECKS + " assertions)");
