// ⚠️⚠️ DO NOT PASTE THIS FILE INTO THE GAS PROJECT. ⚠️⚠️
// It is a LOCAL Node script. Apps Script has no `require`, so it fails on the
// first line of the imports below with "ReferenceError: require is not defined".
// Only three files belong in the GAS project: Code.js, Security.js, Dashboard.html.
// Run it here instead:   node node-tests.js
//
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
_test_regionMap_(); _test_personRegion_(); _test_overflowClamp_();
_test_utilizationRollup_(); _test_onTimeRate_(); _test_forecastAccuracy_(); _test_reworkRate_();
_test_registry_(); _test_flowRegistry_(); _test_confidence_(); _test_regionVocab_(); _test_hygieneBuckets_();
_test_parseExportStamp_(); _test_typeHygieneBuckets_(); _test_personHygieneBuckets_(); _test_leaverTest_(); _test_workforceChange_(); _test_srsoBinding_();
_test_activeNameFilter_(); _test_gateOverrides_();
_test_attrDenominator_();
_test_familyTracks_(); _test_backlogGrouping_(); _test_rosterActive_();
_test_newHire_();
_test_cacheRoundtrip_(new FakeCache());
_test_modelAssembly_();
_test_periods_();
_test_levelTrack_();
_test_classification_();
_test_workforceHealth_();
_test_flowBuckets_();
_test_flowOpenBuckets_();
_test_bugFeed_(); _test_arrivalParse_(); _test_clearRateMedian_(); _test_unassignedInventory_(); _test_inventoryWalkback_(); _test_sampleFloor_(); _test_flowSnapshots_(); _test_flowSnapshotIsoCanon_();

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
        W1: { cap: 40, avail: 40, availCov: 40, planned: 40, tracked: 40,
              trackedCov: 40, billable: 30, nonBillable: 10, nsCov: true,
              nsBillRaw: 15, nsNonBillRaw: 5, capEst: false },
        W2: { cap: 40, avail: 40, availCov: 0, planned: 40, tracked: 36,
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

// ── CONFIDENCE / MEDIAN PARITY ───────────────────────────────
// metricConfidence_ and medianOf_ exist twice on purpose: the server needs them
// for the payload, the client needs them because coverage is filter-dependent.
// Same failure mode as utilFor_ — two copies of one rule drift silently and each
// looks correct alone. The gate is the one rule that must NEVER differ between
// layers: a metric suppressed on the server and published on the client is the
// exact defect FR-2.2 exists to prevent.
(function _test_confidenceParity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_confidenceParity_: " + m); }
  var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  var want = ["metricConfidence_", "medianOf_"];
  var src = want.map(function (fn) {
    var m = html.match(new RegExp("\\nfunction " + fn + "\\s*\\([\\s\\S]*?\\n\\}", ""));
    if (!m) throw new Error("❌ _test_confidenceParity_: could not extract " + fn + " from Dashboard.html");
    return m[0];
  }).join("\n");
  var C = new Function(src + "return { metricConfidence_: metricConfidence_, medianOf_: medianOf_ };")();

  var gates = [0, 0.7, 0.8, 0.9, 1.0];
  var covs = [null, 0, 0.05, 0.43, 0.59, 0.6, 0.66, 0.69, 0.7, 0.7999, 0.8, 0.9, 1, 1.5];
  var periods = [0, 1, 2, 7];
  var checked = 0;
  gates.forEach(function (g) {
    covs.forEach(function (c) {
      periods.forEach(function (p) {
        var s = metricConfidence_(g, c, p), k = C.metricConfidence_(g, c, p);
        assert_(s.level === k.level && s.publish === k.publish && s.coverage === k.coverage,
                "confidence parity at gate " + g + " coverage " + c + " periods " + p +
                " — server " + JSON.stringify(s) + " vs client " + JSON.stringify(k));
        checked++;
      });
    });
  });
  assert_(checked === gates.length * covs.length * periods.length, "full matrix walked");

  [[], [1], [1, 2], [3, 1, 2], [0, 0.5, 0.5, 1.5], [2, 2, 2]].forEach(function (v) {
    assert_(medianOf_(v) === C.medianOf_(v), "median parity on [" + v.join(",") + "]");
  });
  Logger.log("✅ _test_confidenceParity_ passed (" + checked + " gate combinations)");
})();

// ── SAMPLE-FLOOR PARITY ───────────────────────────────────────
// sampleFloorFor_ (Code.js) and sampleFloorClient_ (Dashboard.html) exist twice
// for the same reason metricConfidence_/medianOf_ do: the client has to answer
// "may this number publish?" locally (shelfRows_ builds the whole §7 Shelf off
// it) without a round-trip, and two copies of a publish/withhold rule that
// silently drift are the exact defect this suite exists to catch.
//
// (Task 17: the brief's own Step 3 named the home for this walk as
// `_test_clientParity_` — the file disagrees. `_test_clientParity_` extracts
// aggWeeks_/utilFor_-family functions and is about utilization math; the
// metric this item is actually twinning with — "proven identical, exactly as
// metricConfidence_ and medianOf_ already are" (Task 17 brief text, item 2) —
// lives in THIS suite. Filed here, next to its own kind, not in the unrelated
// one the step-by-step recipe named.)
(function _test_sampleFloorParity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_sampleFloorParity_: " + m); }
  var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  var want = ["reg_", "sampleFloorClient_"];
  var src = want.map(function (fn) {
    var m = html.match(new RegExp("\\nfunction " + fn + "\\s*\\([\\s\\S]*?\\n\\}", ""));
    if (!m) throw new Error("❌ _test_sampleFloorParity_: could not extract " + fn + " from Dashboard.html");
    return m[0];
  }).join("\n");
  // reg_() reads MODEL.meta.registry — seed it with the SAME registry object
  // sampleFloorFor_ reads server-side (no gate overrides in play; overrides
  // only ever touch coverageGate, never sampleFloor, so a plain clone is the
  // honest twin of what registryWithOverrides_({}) would ship).
  var C = new Function(
    "var MODEL = { meta: { registry: " + JSON.stringify(METRIC_REGISTRY_) + " } };" +
    src +
    "return { sampleFloorClient_: sampleFloorClient_ };")();

  var ids = Object.keys(METRIC_REGISTRY_.metrics);
  assert_(ids.length > 0, "sanity: the registry actually has metrics to walk");
  var ns = [0, 1, 4, 5, 6, 50];
  var checked = 0;
  ids.forEach(function (id) {
    ns.forEach(function (n) {
      var s = sampleFloorFor_(id, n), c = C.sampleFloorClient_(id, n);
      assert_(s.ok === c.ok && s.need === c.need && s.n === c.n,
              "sampleFloor parity for '" + id + "' at n=" + n +
              " — server " + JSON.stringify(s) + " vs client " + JSON.stringify(c));
      checked++;
    });
  });
  assert_(checked === ids.length * ns.length, "every registry id walked at every n in [0,1,4,5,6,50]");
  // The one rule that must never differ between layers: fail CLOSED on a
  // metric nobody registered — a typo must not publish on the strength of a
  // missing lookup succeeding as "no floor" on one side and not the other.
  var sUnknown = sampleFloorFor_("nonsense-id-nobody-registered", 50);
  var cUnknown = C.sampleFloorClient_("nonsense-id-nobody-registered", 50);
  assert_(sUnknown.ok === false && cUnknown.ok === false && sUnknown.ok === cUnknown.ok,
          "both copies fail closed on an unknown id, even at a healthy n=50");
  Logger.log("✅ _test_sampleFloorParity_ passed (" + checked + " id×n combinations)");
})();

// ── WORKFORCE HEALTH CLIENT/SERVER PARITY ────────────────────
// The fold and the reconcile exist twice: the server builds the payload, the
// client re-slices it when the period picker or a filter moves. Same failure
// mode as utilFor_ and metricConfidence_ — two copies of one rule drift
// silently and each looks correct alone. Here the drift would be worse than
// cosmetic: an action state that differs between layers means the grid tells a
// pool to SELL while the payload says INTERVENE, and nobody can tell which is
// the real answer.
(function _test_workforceParity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_workforceParity_: " + m); }
  var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  var want = ["wfCfg_", "wfDiv_", "wfEmptyCell_", "wfFold_", "wfActionState_",
              "wfTopReason_", "wfRead_", "wfReconcile_"];
  var src = want.map(function (fn) {
    var m = html.match(new RegExp("\\nfunction " + fn + "\\s*\\([\\s\\S]*?\\n\\}", ""));
    if (!m) throw new Error("❌ _test_workforceParity_: could not extract " + fn + " from Dashboard.html");
    return m[0];
  }).join("\n");
  // The extracted functions close over the client's own config tables and
  // medianOf_. Seeding them from the SERVER's objects is deliberate: if the two
  // threshold tables ever diverge, that is itself a defect this walk should
  // catch — so the config-table check below compares them directly.
  var C = new Function(
    "var WF_POOLS_ = " + JSON.stringify(DH_POOLS_) + ";" +
    "var WF_CONFIG_ = " + JSON.stringify(DH_WFH_CONFIG_) + ";" +
    "var WF_SHADOW_OWNER_ = " + JSON.stringify(DH_SHADOW_OWNER_) + ";" +
    "var medianOf_ = arguments[0];" +
    src +
    "return { wfFold_: wfFold_, wfReconcile_: wfReconcile_, wfActionState_: wfActionState_," +
    " wfRead_: wfRead_, wfDiv_: wfDiv_ };")(medianOf_);

  // The client's OWN literal tables must match the server's, or the seeding
  // above would hide a real divergence.
  var clientPools = JSON.parse(JSON.stringify(eval(
    "(" + html.match(/var WF_POOLS_ = (\{[\s\S]*?\n\});/)[1] + ")")));
  assert_(JSON.stringify(clientPools) === JSON.stringify(DH_POOLS_),
          "the client's pool envelopes are identical to the server's — " +
          "server " + JSON.stringify(DH_POOLS_) + " vs client " + JSON.stringify(clientPools));
  var clientCfg = eval("(" + html.match(/var WF_CONFIG_ = (\{[\s\S]*?\});/)[1] + ")");
  assert_(JSON.stringify(clientCfg) === JSON.stringify(DH_WFH_CONFIG_),
          "the client's signal thresholds are identical to the server's");
  var clientOwner = eval("(" + html.match(/var WF_SHADOW_OWNER_ = (\{[\s\S]*?\});/)[1] + ")");
  assert_(JSON.stringify(clientOwner) === JSON.stringify(DH_SHADOW_OWNER_),
          "the client's shadow-reason owners are identical to the server's");

  // ── Walk a weekly map through both folds and both reconciles ───────────────
  var ISOS = ["2026.W30", "2026.W31", "2026.W32"];
  function wcell(o) {
    var base = { grossHrs: 0, ptoHrs: 0, committedHrs: 0, matchableCommittedHrs: 0, genericHrs: 0,
                 trackedTotalHrs: 0, trackedCommittedHrs: 0, trackedShadowHrs: 0,
                 unmeasuredHrs: 0,
                 shadowReasons: { "no-epic": 0, "no-srso": 0, "not-committed": 0 } };
    Object.keys(o || {}).forEach(function (k) { base[k] = o[k]; });
    return base;
  }
  var weekly = {
    "PS-CONSULT|CORE": {
      "2026.W30": wcell({ grossHrs: 160, committedHrs: 140, trackedTotalHrs: 150,
                          trackedCommittedHrs: 120, trackedShadowHrs: 30,
                          shadowReasons: { "no-epic": 20, "no-srso": 10, "not-committed": 0 } }),
      "2026.W31": wcell({ grossHrs: 160, committedHrs: 100, trackedTotalHrs: 140,
                          trackedCommittedHrs: 140 }),
    },
    "PS-ENGINEER|SENIOR": {
      "2026.W31": wcell({ grossHrs: 80, committedHrs: 79, trackedTotalHrs: 60,
                          trackedCommittedHrs: 20, trackedShadowHrs: 40,
                          shadowReasons: { "no-epic": 0, "no-srso": 0, "not-committed": 40 } }),
    },
    // Every hour unmeasurable: fidelity and shadow must BOTH be null on both sides.
    "MS-SUPPORT|CORE": {
      "2026.W30": wcell({ grossHrs: 400, committedHrs: 380, trackedTotalHrs: 390,
                          unmeasuredHrs: 390 }),
    },
    // Capacity but no plan and no logged time at all.
    "ARCH|SENIOR": { "2026.W32": wcell({ grossHrs: 40 }) },
  };
  var heads = { "PS-CONSULT|CORE": 4, "PS-ENGINEER|SENIOR": 2,
                "MS-SUPPORT|CORE": 10, "ARCH|SENIOR": 1,
                // A cell with people but NO hours in any week — it must survive
                // the fold on both sides rather than vanishing.
                "TRAINING|CORE": 1 };
  var backlog = {
    "PS-CONSULT": { backlogHrs: 900, backlogAdjHrs: 1200, epicCount: 10,
                    unestimatedEpics: 3, estimateCoverage: 0.7 },
    "PS-ENGINEER": { backlogHrs: 100, backlogAdjHrs: 100, epicCount: 4,
                     unestimatedEpics: 0, estimateCoverage: 1 },
    "MS-SUPPORT": { backlogHrs: 50, backlogAdjHrs: 50, epicCount: 2,
                    unestimatedEpics: 0, estimateCoverage: 1 },
  };

  // Fold parity across several window shapes, including a single week and a
  // window containing an ISO nobody has data for.
  var WINDOWS = [ISOS, ["2026.W30"], ["2026.W31"], ["2026.W32"], ["2026.W30", "2026.W32"],
                 ["2026.W99"], []];
  var checked = 0;
  WINDOWS.forEach(function (win) {
    var s = dhFoldWeekly_(weekly, win, heads);
    var c = C.wfFold_(weekly, win, heads);
    assert_(Object.keys(s).sort().join(",") === Object.keys(c).sort().join(","),
            "fold produces the same cells for [" + win.join(",") + "]");
    Object.keys(s).forEach(function (k) {
      ["grossHrs", "committedHrs", "matchableCommittedHrs", "trackedTotalHrs", "trackedCommittedHrs",
       "trackedShadowHrs", "unmeasuredHrs", "head"].forEach(function (f) {
        assert_(s[k][f] === c[k][f],
                "fold parity " + k + "." + f + " over [" + win.join(",") + "] — " +
                "server " + s[k][f] + " vs client " + c[k][f]);
      });
      ["no-epic", "no-srso", "not-committed"].forEach(function (r) {
        assert_(s[k].shadowReasons[r] === c[k].shadowReasons[r],
                "fold parity " + k + " shadow." + r);
      });
    });

    // Reconcile parity on the same fold.
    var sr = reconcileWorkforce_(s, backlog, win.length || 1);
    var cr = C.wfReconcile_(c, backlog, win.length || 1);
    assert_(sr.cells.length === cr.cells.length, "same cell count out of reconcile");
    assert_(sr.medianCover === cr.medianCover ||
            (sr.medianCover === null && cr.medianCover === null),
            "median cover parity over [" + win.join(",") + "]");
    sr.cells.forEach(function (sc, i) {
      var cc = cr.cells[i];
      assert_(sc.cell === cc.cell, "cells come out in the same order");
      ["headroomHrs", "headroomPct", "commitmentFidelity", "shadowRatio", "coverWeeks",
       "constraintIndex", "executionGapHrs", "capacityTruth", "estimateCoverage",
       "backlogAdjHrs"].forEach(function (f) {
        var a = sc[f], b = cc[f];
        var same = (a === null && b === null) ||
                   (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9) ||
                   a === b;
        assert_(same, "reconcile parity " + sc.cell + "." + f + " over [" + win.join(",") +
                "] — server " + JSON.stringify(a) + " vs client " + JSON.stringify(b));
      });
      // The two that MUST never differ: what the reader is told to do, and why.
      assert_(sc.actionState === cc.actionState,
              "ACTION STATE parity " + sc.cell + " — server '" + sc.actionState +
              "' vs client '" + cc.actionState + "'");
      assert_(sc.read === cc.read, "READ parity " + sc.cell);
      assert_(sc.structuralRisk === cc.structuralRisk, "structural-risk parity " + sc.cell);
      checked++;
    });
  });
  assert_(checked > 0, "sanity: the walk actually compared cells");

  // A cell with people but no hours must exist on both sides — the emptiest
  // cell on the grid is a real finding, not a row to drop.
  var full = dhFoldWeekly_(weekly, ISOS, heads);
  assert_(full["TRAINING|CORE"] && full["TRAINING|CORE"].head === 1,
          "a staffed cell with zero hours survives the server fold");
  assert_(C.wfFold_(weekly, ISOS, heads)["TRAINING|CORE"].head === 1,
          "…and the client fold");

  // The unmeasurable cell: both layers must say "not measured", not "0%".
  var sFull = reconcileWorkforce_(full, backlog, 3);
  var ms = sFull.cells.filter(function (c) { return c.cell === "MS-SUPPORT|CORE"; })[0];
  assert_(ms.commitmentFidelity === null && ms.shadowRatio === null,
          "a cell whose every hour was unmeasurable reports null, never 0");
  assert_(ms.actionState === "DEMAND-DRIVEN", "…and is not painted INTERVENE for it");

  // dhSafeDiv_ / wfDiv_ agree on the edges that decide null-vs-zero.
  [[1, 0], [0, 0], [0, 5], [5, 2], [-3, 4]].forEach(function (p) {
    var a = dhSafeDiv_(p[0], p[1]), b = C.wfDiv_(p[0], p[1]);
    assert_((a === null && b === null) || Math.abs(a - b) < 1e-12,
            "safe-division parity on " + p.join("/"));
  });

  Logger.log("✅ _test_workforceParity_ passed (" + checked + " cell comparisons)");
})();

console.log("✅ node-tests: all suites passed");
