// End-to-end run of runJiraEpicTracker({light:true}) with every Jira/Tempo call
// stubbed. Usage: node tests/ps-dashboard/jira-lightrun-tests.js
//
// WHY THIS FILE EXISTS (2026-08-24): the light mode is a set of branches through
// a 300-line function that talks to two APIs and four sheets, so nothing about
// it can be exercised by unit-testing the pieces. It found a real bug the first
// time it ran — `weeks` is null in light mode and `bucketByWeek_(weeks)` threw
// inside weekList.map. That is the shape of every bug this mode will ever have:
// a value the full path always has, that the light path never builds.
const fs = require("fs");
const path = require("path");

let CHECKS = 0;
function assert_(cond, msg) {
  CHECKS++;
  if (!cond) { console.error("❌ " + msg); process.exit(1); }
}

// ── Fake sheets ────────────────────────────────────────────────────────────
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
    getValue: function () {
      var src = self.rows[row - 1] || [];
      return src[col - 1] === undefined ? "" : src[col - 1];
    },
    merge: noop, setBorder: noop, setFontLine: noop, clearContent: noop,
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
function sheetFor(n) { if (!SHEETS[n]) SHEETS[n] = new FakeSheet(); return SHEETS[n]; }

const LOG = [];
global.Logger = { log: function (m) { LOG.push(String(m)); } };
global.SpreadsheetApp = {
  getActiveSpreadsheet: function () {
    return { getSheetByName: sheetFor, insertSheet: sheetFor };
  },
  flush: function () {},
};
global.UrlFetchApp = { fetch: function () { throw new Error("no network in tests"); } };
global.LockService = { getScriptLock: function () {
  return { tryLock: function () { return true; }, releaseLock: function () {} }; } };
global.ScriptApp = { WeekDay: { MONDAY: 1 }, getProjectTriggers: function () { return []; } };
global.PropertiesService = { getScriptProperties: function () {
  return { getProperty: function () { return null; }, setProperty: function () {} }; } };
global.Utilities = { sleep: function () {} };
global.normalizeName_ = function (n) {
  return String(n || "").toLowerCase().replace(/\s+/g, " ").trim();
};

// CONFIGJ is a `const`, so unlike the `function` and `var` declarations it stays
// bound inside the eval and is invisible out here. Re-exported from INSIDE the
// same eval rather than duplicated in the test, so an assertion about
// LIGHT_REFRESH_WEEKS reads the real config and not a copy that can drift.
eval(fs.readFileSync(
  path.join(__dirname, "..", "..", "ps-dashboard", "Jira Backlog.js"), "utf8")
  + `
;global.__CONFIGJ = CONFIGJ;`);
const CONFIGJ = global.__CONFIGJ;

// ── Stub every network call. Reassignment, not redeclaration: these bind to
//    the declarations the eval above created in THIS scope. ─────────────────
const CALLS = {};
function count(name) { CALLS[name] = (CALLS[name] || 0) + 1; }

function mkIssue(key, resolvedDate, status) {
  return { key: key, fields: {
    summary: "Work " + key,
    issuetype: { name: "Task" },
    project: { key: "ACME", name: "Acme" },
    status: { name: status || "Done",
              statusCategory: { name: status === "To Do" ? "To Do" : "Done" } },
    assignee: { displayName: "Maria Alvarez" },
    created: "2026-08-01T09:00:00.000Z",
    resolutiondate: resolvedDate || null,
    timeoriginalestimate: 3600, timespent: 0,
  } };
}

// Resolved inside the in-flight week, so it lands in the newest bucket.
const thisMonday = (function () {
  var d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(12, 0, 0, 0);
  return d;
})();
const FRESH = mkIssue("FRESH-1", thisMonday.toISOString());

fetchJiraIssues_ = function () { count("done"); return [FRESH]; };
fetchChangelogForRecent_ = function () { count("changelog"); return []; };
fetchActiveWIP_ = function () { count("wip"); return []; };
fetchChildrenForEpics_ = function () { count("children"); return []; };
fetchOpenIssues_ = function () { count("open"); return [mkIssue("OPEN-1", null, "To Do")]; };
fetchBugsCreated_ = function () { count("bugs"); return []; };
fetchCreatedIssues_ = function () { count("created"); return [FRESH]; };
getSpaceForIssue_ = function () { return "COE"; };

// ── Seed Jira Raw with an old week a light run must not touch ──────────────
writeRawSheet_([
  { label: "2026.W02", issues: [mkIssue("ANCIENT-1", "2026-01-08T09:00:00.000Z")] },
  { label: "Open",     issues: [mkIssue("STALE-OPEN", null, "To Do")] },
]);
const seededKeys = sheetFor("Jira Raw").getDataRange().getValues().slice(1)
  .map(function (r) { return String(r[1] || ""); }).filter(Boolean);
assert_(seededKeys.length === 2 && seededKeys.indexOf("ANCIENT-1") !== -1,
        "seed: 2 data rows on the sheet, got " + seededKeys.join(","));

// ── THE RUN ────────────────────────────────────────────────────────────────
LOG.length = 0;
runJiraEpicTrackerLight();

const logText = LOG.join("\n");
assert_(logText.indexOf("[LIGHT]") !== -1, "the run announced itself as LIGHT");
// The FATAL line specifically, not any ❌: the changelog audit legitimately
// prints one here because the stub returns no histories, and asserting on every
// ❌ would make this test fail for a reason that has nothing to do with light
// mode — the fastest way to get a suite ignored.
assert_(logText.indexOf("❌ [runJiraEpicTracker]") === -1,
        "the light run completed without throwing:\n" + logText);

// ── 1. It fetched the cheap things and skipped the Exec-only ones ──────────
assert_(CALLS.done === 1, "the Done fetch ran once");
assert_(CALLS.open === 1, "the open queue was refreshed — it is volatile by nature");
assert_(!CALLS.wip, "Active WIP was SKIPPED — an Exec Q&A input only");
// fetchCreatedIssues_ serves TWO callers: the Exec window and the Arrivals
// tally. Light mode must skip the first and keep the second, so the count — not
// its presence — is what discriminates. One call = arrivals only.
assert_(CALLS.created === 1,
        "the Exec created fetch was SKIPPED while the Arrivals one still ran (expected 1 call, got " +
        CALLS.created + ")");
assert_(logText.indexOf("Exec Q&A skipped (LIGHT)") !== -1,
        "…and the skip is stated in the log, not silent");
assert_(CALLS.bugs === 1, "the bug feed still ran (its tab is rewritten whole, and it is ~3s)");

// ── 2. THE WINDOW is the light one, and it says which weeks are frozen ─────
assert_(/Jira Raw REFRESH window: \d+ weeks/.test(logText),
        "the log names the REFRESH window, not the deep one:\n" + logText);
const wkMatch = /Jira Raw REFRESH window: (\d+) weeks/.exec(logText);
assert_(Number(wkMatch[1]) === CONFIGJ.LIGHT_REFRESH_WEEKS + 1,
        "refresh window = LIGHT_REFRESH_WEEKS + the in-flight week (" +
        (CONFIGJ.LIGHT_REFRESH_WEEKS + 1) + "), got " + wkMatch[1]);
assert_(logText.indexOf("are FROZEN") !== -1, "the log states that older weeks are frozen");

// ── 3. THE CRUX: history survived, fresh work arrived ─────────────────────
const rows = sheetFor("Jira Raw").getDataRange().getValues();
const keys = rows.slice(1)
  .filter(function (r) { return String(r[1]); })
  .map(function (r) { return String(r[1]); });
assert_(keys.indexOf("ANCIENT-1") !== -1,
        "the frozen 2026.W02 row SURVIVED the light run — got " + keys.join(","));
assert_(keys.indexOf("FRESH-1") !== -1, "this run's completed work reached the sheet");
assert_(keys.indexOf("OPEN-1") !== -1, "the refreshed open queue reached the sheet");
assert_(keys.indexOf("STALE-OPEN") === -1,
        "the PREVIOUS run's Open rows were replaced, not frozen — the queue is never stale");

// ── 4. The freshness footer is rewritten, or the dashboard's banner lies ───
const footer = rows.map(function (r) { return String(r[0] || ""); }).join("|");
assert_(/Generated: /.test(footer), "the Generated: stamp was rewritten by the light run");
assert_(footer.indexOf("Exporter: " + CONFIGJ.VERSION) !== -1,
        "…and the Exporter: stamp carries this version");

// ── 5. A FULL run after a light one still works and rebuilds everything ────
LOG.length = 0;
runJiraEpicTracker();
assert_(LOG.join("\n").indexOf("[FULL]") !== -1, "the full run announced itself as FULL");
assert_(CALLS.wip === 1, "the full run DID fetch Active WIP");
assert_(CALLS.created === 3,
        "…and the FULL run made BOTH created fetches (1 from the light run + 2 here), got " +
        CALLS.created);
const afterFull = sheetFor("Jira Raw").getDataRange().getValues().slice(1)
  .map(function (r) { return String(r[1]); });
assert_(afterFull.indexOf("ANCIENT-1") === -1,
        "the full run REBUILT from its own fetch — the stub returns only FRESH-1, so a " +
        "surviving ANCIENT-1 would mean the full path is merging when it must not");

console.log("✅ jira-lightrun-tests: all checks passed (" + CHECKS + " assertions)");
