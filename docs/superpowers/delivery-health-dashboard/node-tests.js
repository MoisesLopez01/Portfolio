// node-tests.js — local runner for the pure _test_ functions in Code.js.
// Stubs: Logger→console, Utilities gzip/base64 via zlib/Buffer, FakeCache
// for _test_cacheRoundtrip_. SpreadsheetApp/CacheService/ScriptApp are NOT
// stubbed — only pure functions run here; everything also runs in GAS.
// Usage: node node-tests.js   (from this directory)
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

global.Logger = { log: function (m) { console.log(m); } };
global.Utilities = {
  newBlob: function (data) { return { _buf: Buffer.isBuffer(data) ? data : Buffer.from(data) }; },
  gzip: function (blob) { return { getBytes: function () { return zlib.gzipSync(blob._buf); } }; },
  ungzip: function (blob) { return { getDataAsString: function () { return zlib.gunzipSync(blob._buf).toString("utf8"); } }; },
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

eval(fs.readFileSync(path.join(__dirname, "Code.js"), "utf8"));

_test_dhWindow_();
_test_nameJoin_();
_test_teamSplit_();
_test_nsWeekBucketing_();
_test_netCapacity_(); _test_regionMap_(); _test_personRegion_(); _test_overflowClamp_();
_test_utilizationRollup_(); _test_onTimeRate_(); _test_forecastAccuracy_();
_test_familyTracks_(); _test_backlogGrouping_(); _test_rosterActive_();
_test_newHire_();
_test_cacheRoundtrip_(new FakeCache());
_test_modelAssembly_();
_test_periods_();
_test_levelTrack_();
_test_ptoUsage_();

// ── CLIENT/SERVER PARITY ─────────────────────────────────────
// Dashboard.html keeps its own copy of the utilization math (utilFor_/aggWeeks_)
// so filtering can re-base without a round-trip. Two implementations of one
// formula drift — and that drift is invisible, because each looks right alone.
// This lifts the client functions out of the HTML and checks they agree with the
// server on the same people, including the coverage-matched billable denominator.
(function _test_clientParity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_clientParity_: " + m); }
  var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  // Pull the named functions only — evaluating the whole block would run the
  // page's bootstrap (google.script.run, DOM wiring).
  var want = ["aggWeeks_", "unclassifiedH_", "nsRawTot_", "nsShare_", "utilFor_"];
  var src = want.map(function (fn) {
    var m = html.match(new RegExp("\\nfunction " + fn + "\\s*\\([\\s\\S]*?\\n\\}", ""));
    if (!m) throw new Error("❌ _test_clientParity_: could not extract " + fn + " from Dashboard.html");
    return m[0];
  }).join("\n");
  // utilFor_ reads MODEL and passesFilters_ as free variables; declaring both
  // inside the wrapper body means the extracted functions close over them.
  var C = new Function(
    "var MODEL = null;" +
    "function passesFilters_() { return true; }" +
    src +
    "return { setModel: function (m) { MODEL = m; }, aggWeeks_: aggWeeks_," +
    " unclassifiedH_: unclassifiedH_, nsRawTot_: nsRawTot_, nsShare_: nsShare_," +
    " utilFor_: utilFor_ };")();

  // Mixed coverage: one classified week, one NS-uncovered week with real hours.
  var people = [
    { name: "A", region: "AMER", teams: [], weeks: {
        W1: { cap: 40, pto: 0, hol: 0, avail: 40, availCov: 40, planned: 40, tracked: 40,
              trackedCov: 40, billable: 30, nonBillable: 10, nsCov: true,
              nsBillRaw: 15, nsNonBillRaw: 5, capEst: false },
        W2: { cap: 40, pto: 0, hol: 0, avail: 40, availCov: 0, planned: 40, tracked: 36,
              trackedCov: 0, billable: 0, nonBillable: 0, nsCov: false,
              nsBillRaw: 0, nsNonBillRaw: 0, capEst: false } } },
  ];
  C.setModel({ people: people });

  ["W1", "W2"].forEach(function (iso) {
    var s = utilRollup_(people, iso, null, null);       // server
    var c = C.utilFor_([iso]);                          // client
    assert_(s.billablePct === c.billablePct, "billablePct parity " + iso);
    assert_(s.trackedPct === c.trackedPct, "trackedPct parity " + iso);
    assert_(s.availCov === c.availCov, "availCov parity " + iso);
  });
  // W1 classified: 30/40. W2 unclassified: no billable rate at all, but its
  // tracked hours still count — the two-week window must not average in a zero.
  assert_(C.utilFor_(["W1"]).billablePct === 75, "W1 billable util");
  assert_(C.utilFor_(["W2"]).billablePct === null, "uncovered week → no billable rate, not 0%");
  var both = C.utilFor_(["W1", "W2"]);
  assert_(both.billablePct === 75, "window rate = the classified portion only");
  assert_(Math.abs(both.trackedPct - 76 / 80 * 100) < 1e-9, "tracked util spans both weeks");

  // The invariant, on the aggregate: billable + nonBillable + unclassified === tracked.
  var agg = C.aggWeeks_(people[0], ["W1", "W2"]);
  assert_(Math.abs(agg.billable + agg.nonBillable + C.unclassifiedH_(agg) - agg.tracked) < 1e-9,
          "INVARIANT holds on an aggregated multi-week cell");
  assert_(C.unclassifiedH_(agg) === 36, "W2's tracked hours are unclassified, not non-billable");
  assert_(agg.covWeeks === 1 && agg.nWeeks === 2, "coverage counted per aggregated cell");
  assert_(C.nsRawTot_(agg) === 20 && C.nsShare_(agg) === 0.75, "raw NS totals + share carried");
  Logger.log("✅ _test_clientParity_ passed");
})();

console.log("✅ node-tests: all suites passed");
