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
_test_enrichTracked_();
_test_billingAggregation_();
_test_headcount_();
_test_buildPersonAvailability_();
_test_personWeekPTO_();
_test_scopeRecsToServices_();
_test_isCrew_();
_test_behaviorSignals();
_test_cacheRoundtrip_(new FakeCache());
_test_familyFromTitle_();
_test_holidayCapacity_();
console.log("✅ node-tests: all suites passed");
