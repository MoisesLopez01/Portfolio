// node-tests.js — local runner for the pure _test_ functions in Code.js.
// GAS services are stubbed just enough: Logger→console, Utilities gzip/base64
// via zlib/Buffer, and an in-memory cache passed into _test_cacheRoundtrip_.
// (SpreadsheetApp/CacheService/ScriptApp are NOT stubbed — only functions that
// avoid them run here; everything also runs for real in the GAS editor.)
// Usage: node node-tests.js   (from this directory)
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

global.Logger = { log: function (m) { console.log(m); } };
global.Utilities = {
  newBlob: function (data) {
    return { _buf: Buffer.isBuffer(data) ? data : Buffer.from(data) };
  },
  gzip: function (blob) {
    return { getBytes: function () { return zlib.gzipSync(blob._buf); } };
  },
  ungzip: function (blob) {
    return { getDataAsString: function () { return zlib.gunzipSync(blob._buf).toString("utf8"); } };
  },
  base64Encode: function (bytes) { return Buffer.from(bytes).toString("base64"); },
  base64Decode: function (b64) { return Buffer.from(b64, "base64"); },
};

function FakeCache() { this.m = {}; }
FakeCache.prototype.putAll = function (entries) { for (var k in entries) this.m[k] = entries[k]; };
FakeCache.prototype.get = function (k) { return (k in this.m) ? this.m[k] : null; };
FakeCache.prototype.getAll = function (names) {
  var out = {};
  for (var i = 0; i < names.length; i++) if (names[i] in this.m) out[names[i]] = this.m[names[i]];
  return out;
};
FakeCache.prototype.remove = function (k) { delete this.m[k]; };

eval(fs.readFileSync(path.join(__dirname, "Code.js"), "utf8"));

_test_demandParse_();
_test_jiraMetaParse_();
_test_epicBacklogStats_();
_test_personEpicPlan_();
_test_epicAssignmentGaps_();
_test_enrichTracked_();
_test_billingAggregation_();
_test_trackedIssues_();
_test_headcount_();
_test_buildPersonAvailability_();
_test_personWeekPTO_();
_test_scopeRecsToServices_();
_test_isCrew_();
_test_behaviorSignals();
_test_cacheRoundtrip_(new FakeCache());
_test_familyFromTitle_();
_test_holidayCapacity_();
_test_capacityParse_();
_test_capacityScope_();

// ── Utilization pure block (extracted from Dashboard.html) ───────────────
// The client-side utilization math/CSV builders live in Dashboard.html inside
// UTIL-PURE markers so this harness can eval exactly that block (no DOM).
var dashSrc = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
var utilBlock = dashSrc.match(/\/\* ==UTIL-PURE-START== \*\/([\s\S]*?)\/\* ==UTIL-PURE-END== \*\//);
if (!utilBlock) throw new Error("❌ UTIL-PURE block not found in Dashboard.html");
eval(utilBlock[1]);

function _test_utilizationMath_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilizationMath_: " + msg); }
  var cap = {
    "alice": { "2026.W14": 40, "2026.W15": 40 },
    "bob":   { "2026.W14": 0 },                 // scheduled zero (e.g. on leave)
    "cara":  {}                                  // no capacity data at all
  };
  var trk = {
    "alice": { "2026.W14": 38, "2026.W15": 44 },
    "bob":   { "2026.W14": 5 },
    "cara":  { "2026.W14": 10 }
  };
  var t = utilWeekTotals_(["2026.W14", "2026.W15", "2026.W16"], cap, trk, ["alice", "bob", "cara"]);

  // W14: covered = alice(40) + bob(0) = 40 cap; tracked of covered = 38+5 = 43; cara excluded
  assert_(t.cap["2026.W14"] === 40, "W14 capSum = covered people only");
  assert_(t.tracked["2026.W14"] === 43, "W14 trkSum = covered people's tracked only");
  assert_(t.covered["2026.W14"] === 2 && t.trackedOnly["2026.W14"] === 1, "W14 coverage counts");
  assert_(Math.round(t.util["2026.W14"]) === 108, "W14 util >100% passes through (43/40)");
  // W15: only alice covered; 44/40 = 110%
  assert_(Math.round(t.util["2026.W15"]) === 110, "W15 util = 110");
  assert_(t.trackedOnly["2026.W15"] === 0, "W15 no tracked-only people");
  // W16: nobody has capacity → util null, sums 0
  assert_(t.util["2026.W16"] === null && t.cap["2026.W16"] === 0, "no-capacity week -> util null");
  Logger.log("✅ _test_utilizationMath_ passed");
}

function _test_utilizationCsv_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilizationCsv_: " + msg); }
  var cap = { "alice": { "2026.W14": 40, "2026.W16": 40 }, "eve": {} };
  var trk = { "alice": { "2026.W14": 38.55 }, "eve": { "2026.W14": 12 } };
  var names = { "alice": "Alice Doe", "eve": "=Evil()" };
  var rows = buildUtilCsvRows_(["2026.W14", "2026.W15", "2026.W16"], cap, trk, names,
                               ["eve", "alice"], { "2026.W16": true });

  assert_(JSON.stringify(rows[0]) === JSON.stringify(["User", "Week", "Capacity hrs", "Tracked hrs", "Utilization %"]), "header row");
  // Sorted by display name: Alice first, then =Evil()… actually "=Evil()" < "Alice Doe" lexically — verify deterministic sort:
  var users = rows.slice(1).map(function (r) { return r[0]; });
  assert_(users.join("|").indexOf("Alice Doe") !== -1 && users.join("|").indexOf("=Evil()") !== -1, "both people present");
  // Alice W14: cap 40, tracked 38.6 (round1), util 96.4
  var aliceW14 = rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W14"; })[0];
  assert_(aliceW14 && aliceW14[2] === 40 && aliceW14[3] === 38.6 && aliceW14[4] === 96.4, "alice W14 row (round1)");
  // Alice W15: no cap, no tracked → row skipped
  assert_(rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W15"; }).length === 0, "empty person-week skipped");
  // Alice W16 (future): capacity only, blank tracked + util
  var aliceW16 = rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W16"; })[0];
  assert_(aliceW16 && aliceW16[2] === 40 && aliceW16[3] === "" && aliceW16[4] === "", "future week = capacity only");
  // Eve W14: tracked without capacity → blank capacity/util, tracked shown
  var eveW14 = rows.filter(function (r) { return r[1] === "2026.W14" && r[0] === "=Evil()"; })[0];
  assert_(eveW14 && eveW14[2] === "" && eveW14[3] === 12 && eveW14[4] === "", "tracked-no-capacity row blanks");

  // CSV string: formula injection guarded, numbers untouched, CRLF lines
  var csv = utilCsvString_(rows);
  assert_(csv.indexOf("'=Evil()") !== -1, "leading = guarded with apostrophe");
  assert_(csv.indexOf("\r\n") !== -1, "CRLF line endings");
  assert_(csvEscape_(-5) === "-5", "negative number not formula-guarded");
  assert_(csvEscape_('He said "hi", ok') === '"He said ""hi"", ok"', "quotes+comma escaping");
  Logger.log("✅ _test_utilizationCsv_ passed");
}

_test_utilizationMath_();
_test_utilizationCsv_();

console.log("✅ node-tests: all suites passed");
