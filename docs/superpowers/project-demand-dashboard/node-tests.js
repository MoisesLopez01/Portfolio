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
                               ["eve", "alice"], { "2026.W16": true },
                               { "alice": "Delivery", "eve": "Non-tracking" });

  assert_(JSON.stringify(rows[0]) === JSON.stringify(["User", "Week", "Capacity hrs", "Tracked hrs", "Utilization %", "Group"]), "header row gains Group");
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

  var aliceW14 = rows.filter(function (r) { return r[0] === "Alice Doe" && r[1] === "2026.W14"; })[0];
  assert_(aliceW14[5] === "Delivery" && eveW14[5] === "Non-tracking", "Group column carries the population split");
  // Missing map entry defaults to Delivery (unknowns are tracking-required by policy)
  var rowsD = buildUtilCsvRows_(["2026.W14"], cap, trk, names, ["alice"], {}, {});
  assert_(rowsD[1][5] === "Delivery", "missing group entry defaults to Delivery");

  // CSV string: formula injection guarded, numbers untouched, CRLF lines
  var csv = utilCsvString_(rows);
  assert_(csv.indexOf("'=Evil()") !== -1, "leading = guarded with apostrophe");
  assert_(csv.indexOf("\r\n") !== -1, "CRLF line endings");
  assert_(csvEscape_(-5) === "-5", "negative number not formula-guarded");
  assert_(csvEscape_('He said "hi", ok') === '"He said ""hi"", ok"', "quotes+comma escaping");
  Logger.log("✅ _test_utilizationCsv_ passed");
}

function _test_utilSplitPopulation_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilSplitPopulation_: " + msg); }
  var meta = {
    "ana":  { jobFamily: "Service Delivery", isManager: false },
    "ben":  { jobFamily: "Managed Services & Support", isManager: false },
    "carl": { jobFamily: "Service Delivery", isManager: true },   // manager carve-out wins over family
    "dana": { jobFamily: "Finance", isManager: false },           // known non-tracking family
    "eli":  { jobFamily: "", isManager: false }                   // roster row, blank family → Delivery
    // "fay" has no meta entry at all (capacity/tracked-only person) → Delivery
  };
  var fams = ["Managed Services & Support", "Service Delivery", "Professional Services"];
  var s = utilSplitPopulation_(["ana", "ben", "carl", "dana", "eli", "fay"], meta, fams);
  assert_(s.delivery.join("|") === "ana|ben|eli|fay", "delivery = allowlist + blank/unknown family");
  assert_(s.managers.join("|") === "carl", "managers carved out before family check");
  assert_(s.nonTracking.join("|") === "dana", "known non-allowlist family → nonTracking");
  // Case-insensitive family match
  var s2 = utilSplitPopulation_(["ana"], { "ana": { jobFamily: "service delivery", isManager: false } }, fams);
  assert_(s2.delivery.length === 1, "family match is case-insensitive");
  Logger.log("✅ _test_utilSplitPopulation_ passed");
}

function _test_utilControlStats_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilControlStats_: " + msg); }
  var u = { "W1": 60, "W2": 64, "W3": null, "W4": 62, "W5": 66 };  // W3: no capacity that week
  // Only 4 numeric settled values → stats over [60,64,62,66]: mean 63, σ = sqrt(20/4)=2.236
  var s = utilControlStats_(u, ["W1", "W2", "W3", "W4", "W5"], 8);
  assert_(s && Math.round(s.mean) === 63, "mean over numeric settled weeks");
  assert_(Math.abs(s.sigma - 2.2360679) < 1e-4, "population sigma");
  assert_(Math.abs(s.lo - (63 - 2 * s.sigma)) < 1e-9 && Math.abs(s.hi - (63 + 2 * s.sigma)) < 1e-9, "lo/hi = mean ± 2σ");
  assert_(s.n === 4, "n reports the values used");
  // bandWeeks window: only the trailing 4 of 6 values are used
  var u2 = { "A": 10, "B": 90, "C": 60, "D": 60, "E": 60, "F": 60 };
  var s2 = utilControlStats_(u2, ["A", "B", "C", "D", "E", "F"], 4);
  assert_(s2.mean === 60 && s2.sigma === 0, "trailing bandWeeks window only");
  // Under 4 numeric values → null (band hidden)
  assert_(utilControlStats_({ "W1": 60, "W2": 61, "W3": 62 }, ["W1", "W2", "W3"], 8) === null, "needs ≥4 settled values");
  // lo clamps at 0
  var s3 = utilControlStats_({ a: 1, b: 30, c: 1, d: 30 }, ["a", "b", "c", "d"], 8);
  assert_(s3.lo === 0, "lo clamped at 0");
  Logger.log("✅ _test_utilControlStats_ passed");
}

function _test_utilProjection_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilProjection_: " + msg); }
  // Thu (4 elapsed workdays), 20h logged, 40h capacity → 20/(4/5)=25h pace → 62.5%
  var p = utilProjection_(20, 40, 4, 3);
  assert_(Math.abs(p.pct - 62.5) < 1e-9, "linear scale-up: 20h by Thu on 40h → 62.5%");
  assert_(Math.abs(p.lo - 56.5) < 1e-9 && Math.abs(p.hi - 68.5) < 1e-9, "band = pct ± 2σ");
  // Monday clamps to 1 elapsed day, weekend passes 5 straight through
  assert_(Math.abs(utilProjection_(8, 40, 0, 0).pct - 100) < 1e-9, "elapsed clamped to ≥1 (8h ÷ 1/5 of 40h)");
  assert_(Math.abs(utilProjection_(30, 40, 7, 0).pct - 75) < 1e-9, "elapsed clamped to ≤5");
  // No sigma yet (young band) → point only, no range
  var p2 = utilProjection_(20, 40, 4, null);
  assert_(p2.lo === null && p2.hi === null, "no sigma → no band");
  // lo clamps at 0; no capacity → null
  assert_(utilProjection_(0.4, 40, 5, 5).lo === 0, "lo clamped at 0");
  assert_(utilProjection_(10, 0, 3, 2) === null, "zero capacity → null");
  Logger.log("✅ _test_utilProjection_ passed");
}

function _test_utilDecompose_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilDecompose_: " + msg); }
  var cap = { "a": { W1: 40, W2: 40 }, "b": { W1: 40, W2: 40 }, "c": { W1: 40, W2: 20 } };
  var trk = { "a": { W1: 30, W2: 24 }, "b": { W1: 35, W2: 36 }, "c": { W1: 20, W2: 18 } };
  var groups = { "Service Delivery": ["a", "b"], "Managed Services & Support": ["c"] };
  var d = utilDecompose_("W2", "W1", groups, cap, trk);
  // util W1 = 85/120 = 70.833%, util W2 = 78/100 = 78% → Δ = +7.1667 pp
  var total = 0;
  d.forEach(function(g){ total += g.pp; });
  assert_(Math.abs(total - (78 - 85 / 120 * 100)) < 1e-9, "contributions sum exactly to Δutil (denominator changed too)");
  // SD group: 60/100 − 65/120 = 60 − 54.1667 = +5.833 pp; MS group: 18/100 − 20/120 = +1.333 pp
  var sd = d.filter(function(g){ return g.key === "Service Delivery"; })[0];
  assert_(Math.abs(sd.pp - (60 - 65 / 120 * 100)) < 1e-9, "per-group pp uses each week's own denominator");
  // Hours context for the drill rows: covered tracked sums for both weeks
  assert_(sd.trkW === 60 && sd.trkPrev === 65, "entry carries covered tracked hrs for both weeks");
  assert_(d[0].key === "Service Delivery", "sorted by |pp| descending");
  // Coverage rule respected: a tracked-only member contributes no pp
  var d2 = utilDecompose_("W2", "W1", { g1: ["a"], g2: ["nocap"] }, cap, { "a": { W1: 30, W2: 24 }, "nocap": { W1: 99, W2: 99 } });
  assert_(d2.filter(function(g){ return g.key === "g2"; })[0].pp === 0, "uncovered member contributes 0");
  // Missing capacity on either week → null (nothing to decompose)
  assert_(utilDecompose_("W9", "W1", groups, cap, trk) === null, "week without capacity → null");
  Logger.log("✅ _test_utilDecompose_ passed");
}

function _test_utilIdentity_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilIdentity_: " + msg); }
  var cap  = { "a": { W1: 40 }, "b": { W1: 40 }, "c": {} };
  var trk  = { "a": { W1: 30 }, "b": { W1: 34 }, "c": { W1: 10 } };
  var plan = { "a": { W1: 36 }, "b": { W1: 55 }, "c": { W1: 40 } };   // b over-planned → capped at 40
  var hrs  = { "a": 40, "b": 40, "c": 40 };
  var id = utilIdentity_("W1", ["a", "b", "c"], cap, trk, plan, hrs);
  // Covered: a+b. cap 80, tracked 64, planned 36+min(55,40)=76.
  assert_(id.cap === 80 && id.tracked === 64 && id.planned === 76, "sums respect coverage rule + plan cap");
  assert_(Math.abs(id.util - 80) < 1e-9, "util = 64/80");
  assert_(Math.abs(id.coverage - 95) < 1e-9, "coverage = 76/80");
  assert_(Math.abs(id.fidelity - (64 / 76 * 100)) < 1e-9, "fidelity = 64/76");
  // The identity reconciles: coverage × fidelity = utilization
  assert_(Math.abs(id.coverage * id.fidelity / 100 - id.util) < 1e-9, "coverage × fidelity = util");
  // No plan data that week → coverage/fidelity null, util still real
  var id2 = utilIdentity_("W1", ["a"], cap, trk, {}, hrs);
  assert_(id2.coverage === null && id2.fidelity === null && id2.util !== null, "plan-less week degrades to util-only");
  Logger.log("✅ _test_utilIdentity_ passed");
}

function _test_utilVerdict_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilVerdict_: " + msg); }
  var stats = { mean: 65, sigma: 2, lo: 61, hi: 69 };
  assert_(utilVerdict_(57, stats) === "below", "under lo → below");
  assert_(utilVerdict_(72, stats) === "above", "over hi → above");
  assert_(utilVerdict_(65, stats) === "normal", "inside band → normal");
  assert_(utilVerdict_(61, stats) === "normal" && utilVerdict_(69, stats) === "normal", "band edges inclusive");
  assert_(utilVerdict_(null, stats) === null, "no utilization → null");
  assert_(utilVerdict_(57, null) === null, "no band → null");
  Logger.log("✅ _test_utilVerdict_ passed");
}

function _test_utilAdjustCap_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilAdjustCap_: " + msg); }
  var cap = { "a": { W1: 40, W2: 0 }, "b": { W1: 38 }, "c": {} };
  var pto = { "a": { W1: 8, W2: 4 }, "b": { W1: 45 } };   // b: PTO exceeds capacity
  var adj = utilAdjustCap_(cap, pto);
  assert_(adj.a.W1 === 32, "40 cap − 8 PTO = 32");
  assert_(adj.a.W2 === 0, "explicit 0 cap stays 0 (PTO can't go negative)");
  assert_(adj.b.W1 === 0, "PTO > cap clamps at 0");
  assert_(!("W3" in adj.a) && Object.keys(adj.c).length === 0, "no invented cells — blank stays blank");
  assert_(cap.a.W1 === 40, "input map not mutated");
  // PTO for a week with no capacity cell must NOT create one
  var adj2 = utilAdjustCap_({ "d": {} }, { "d": { W1: 8 } });
  assert_(Object.keys(adj2.d).length === 0, "PTO alone never creates a capacity cell");
  Logger.log("✅ _test_utilAdjustCap_ passed");
}

function _test_utilPersonWeek_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilPersonWeek_: " + msg); }
  // fullPto: pto >= 0.75*cap → exempt from low flag regardless of tracked
  var w = utilPersonWeek_(40, 32, 0, true, 0.75, 0.6);
  assert_(w.adj === 8 && w.fullPto === true && w.low === false, "full-PTO week never flagged low");
  // low: tracked < 0.6*adjusted
  var w2 = utilPersonWeek_(40, 8, 15, true, 0.75, 0.6);
  assert_(w2.adj === 32 && w2.fullPto === false && w2.low === true, "15 < 0.6×32 → low");
  assert_(Math.abs(w2.util - 15 / 32 * 100) < 1e-9, "util vs ADJUSTED capacity");
  var w3 = utilPersonWeek_(40, 0, 30, true, 0.75, 0.6);
  assert_(w3.low === false && Math.abs(w3.util - 75) < 1e-9, "30/40 ok, not low");
  // adjusted 0 → util null, never low
  var w4 = utilPersonWeek_(40, 40, 0, true, 0.75, 0.6);
  assert_(w4.adj === 0 && w4.util === null && w4.low === false, "zeroed capacity → util null, no flag");
  // no capacity cell → everything null/false
  var w5 = utilPersonWeek_(0, 0, 12, false, 0.75, 0.6);
  assert_(w5.adj === null && w5.util === null && w5.low === false && w5.fullPto === false, "no capacity data → null row");
  Logger.log("✅ _test_utilPersonWeek_ passed");
}

_test_utilizationMath_();
_test_utilizationCsv_();
_test_utilSplitPopulation_();
_test_utilControlStats_();
_test_utilProjection_();
_test_utilDecompose_();
_test_utilIdentity_();
_test_utilVerdict_();
_test_utilAdjustCap_();
_test_utilPersonWeek_();

console.log("✅ node-tests: all suites passed");
