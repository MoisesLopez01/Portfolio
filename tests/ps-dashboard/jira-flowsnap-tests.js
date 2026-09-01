// Node runner for writeFlowSnapshot_'s per-ISO-week write.
// Usage: node tests/ps-dashboard/jira-flowsnap-tests.js
//
// WHY THIS FILE EXISTS (2026-08-24): the Jira export went HOURLY. writeFlowSnapshot_
// appended one row per run, which was right at a weekly trigger — one run, one
// measured point per week — and becomes ~8,700 rows a year at hourly, of which
// the dashboard reads exactly one per week (parseFlowSnapshotRows_ keys byIso
// and keeps the last). The write now REWRITES the current week's row in place.
// That is a row-identity rule, and row-identity rules fail quietly: a duplicate
// every hour looks like nothing at all until the tab is unusable.
const fs = require("fs");
const path = require("path");

let CHECKS = 0;
function assert_(cond, msg) {
  CHECKS++;
  if (!cond) { console.error("❌ " + msg); process.exit(1); }
}

// ── A fake Sheet: enough surface for writeFlowSnapshot_, nothing more ───────
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
      for (var i = 0; i < nRows; i++) {
        var src = self.rows[row - 1 + i] || [];
        out.push(src.slice(col - 1, col - 1 + nCols));
      }
      return out;
    },
    setValues: function (vals) {
      for (var i = 0; i < vals.length; i++) {
        var target = row - 1 + i;
        while (self.rows.length <= target) self.rows.push([]);
        for (var j = 0; j < vals[i].length; j++) self.rows[target][col - 1 + j] = vals[i][j];
      }
      return chain;
    },
    setBackground: noop, setFontColor: noop, setFontWeight: noop,
    setFontSize: noop, setFontFamily: noop, setVerticalAlignment: noop,
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

const SHEET = new FakeSheet();

global.Logger = { log: function () {} };
global.SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return { getSheetByName: function () { return SHEET; }, insertSheet: function () { return SHEET; } };
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

eval(fs.readFileSync(
  path.join(__dirname, "..", "..", "ps-dashboard", "Jira Backlog.js"), "utf8"));

// One open, unassigned To Do item — enough to make the snapshot non-trivial.
function candidates(n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({ fields: {
      issuetype: { name: "Task" },
      status: { statusCategory: { name: "To Do" } },
      assignee: { displayName: "Maria Alvarez" },
      timeoriginalestimate: 3600, timespent: 0,
    } });
  }
  return out;
}

const ISO_COL = 1;  // "ISO Week" is the second header
const N_COL = 4;    // "Backlog Items"

// ── 1. First write of a week creates the row ───────────────────────────────
writeFlowSnapshot_(candidates(3));
var rows = SHEET.getDataRange().getValues();
assert_(rows.length === 2, "header + one snapshot row, got " + rows.length);
assert_(String(rows[0][0]) === "Generated", "header written");
assert_(rows[1][N_COL] === 3, "the snapshot counted 3 backlog items, got " + rows[1][N_COL]);
var iso = rows[1][ISO_COL];
assert_(/^\d{4}\.W\d{1,2}$/.test(String(iso)), "row labelled with an ISO week — got " + iso);

// ── 2. THE CRUX: 24 more runs in the same week add NO rows ─────────────────
// This is the hourly cadence simulated. Under the old appendRow the tab would
// be 26 rows here, and the dashboard would parse 25 of them only to discard
// every one but the last.
for (var h = 0; h < 24; h++) writeFlowSnapshot_(candidates(5));
rows = SHEET.getDataRange().getValues();
assert_(rows.length === 2,
        "24 further runs in the same ISO week REPLACE the row rather than appending — got " +
        rows.length + " rows (expected 2)");
assert_(rows[1][N_COL] === 5,
        "…and the surviving row carries the LATEST measurement, not the first — got " + rows[1][N_COL]);
assert_(rows[1][ISO_COL] === iso, "…still the same ISO week");

// ── 3. A new week appends rather than overwriting ──────────────────────────
// The upsert must key on the week, not simply "the last row": a series of one
// point per week is the whole reason this tab exists.
SHEET.rows[1][ISO_COL] = "2020.W1";      // age the existing row into another week
writeFlowSnapshot_(candidates(7));
rows = SHEET.getDataRange().getValues();
assert_(rows.length === 3, "a different ISO week gets its own row — got " + rows.length);
assert_(rows[1][ISO_COL] === "2020.W1" && rows[1][N_COL] === 5,
        "the older week's row is untouched — got " + rows[1][ISO_COL] + " / " + rows[1][N_COL]);
assert_(rows[2][ISO_COL] === iso && rows[2][N_COL] === 7,
        "the current week's row is the new one — got " + rows[2][ISO_COL] + " / " + rows[2][N_COL]);

// ── 4. The match is BY HEADER NAME, not by column position ─────────────────
// Every other reader of this tab indexes by name; if this one indexed by
// position, a column inserted by hand would send it looking at the wrong cell
// and it would append a duplicate every hour — exactly what it exists to stop.
var isoHeader = SHEET.rows[0][ISO_COL];
assert_(String(isoHeader) === "ISO Week",
        "the column this keys on is the one named 'ISO Week' — got " + isoHeader);

console.log("✅ jira-flowsnap-tests: all checks passed (" + CHECKS + " assertions)");
