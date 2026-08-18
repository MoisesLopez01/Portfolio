// ⚠️⚠️ DO NOT PASTE THIS FILE INTO THE GAS PROJECT. ⚠️⚠️
// It is a LOCAL Node script. Apps Script has no `require`, so it fails on the
// first line of the imports below with "ReferenceError: require is not defined".
// Only three files belong in the GAS project: Code.js, Security.js, Dashboard.html.
// Run it here instead:   node render-smoke.js
//
// render-smoke.js — renders Dashboard.html's client code against synthetic
// models and asserts on the HTML it produces.
//
// Why this exists: node-tests.js covers the pure math, but the rules that matter
// most to this build are RENDERING rules — "a below-gate metric must still be
// gated even though the cards stopped narrating coverage", "an empty period
// must not read as bad data", "a stale model must not print a delta". Those
// live in string concatenation, where a unit test can't reach them and a typo
// silently ships the opposite of what was decided.
//
// Harness: extract the inline <script>, stub just enough DOM for the top-level
// wiring to run, then eval(src + bridge) — MODEL and STATE are module-scoped
// `var`s inside that block, so `global.MODEL = …` does NOT reach them; the
// bridge returns setters that close over them instead.
//
// Usage: node render-smoke.js   (from this directory)
var fs = require("fs");
var path = require("path");

var checks = 0;
function assert_(c, m) { if (!c) throw new Error("❌ render-smoke: " + m); checks++; }

// ── DOM stub ────────────────────────────────────────────────
function El(id) {
  this.id = id; this.innerHTML = ""; this.textContent = ""; this.value = "";
  this.className = ""; this.title = ""; this.style = {}; this.children = [];
}
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.querySelectorAll = function () { return []; };
// Returns null: renderRoster_'s scroll-preservation guard must be safe when the
// node isn't there yet (first render) — that is the branch this stub exercises.
El.prototype.querySelector = function () { return null; };
El.prototype.addEventListener = function () {};
// setAttribute/getAttribute: buildTabs_ stamps role/aria-selected on every tab
// and the theme toggle reads data-theme off <html>. A stub without them throws
// during navigation, which is not a thing a DOM shim should be able to do.
El.prototype.setAttribute = function (k, v) { (this._attrs || (this._attrs = {}))[k] = String(v); };
El.prototype.getAttribute = function (k) { return (this._attrs || {})[k] === undefined ? null : this._attrs[k]; };
// classList: the sidebar collapse toggles a class on <body>. Minimal but real —
// add/remove/toggle/contains over a set, so a test can assert the collapsed
// state rather than only that the call didn't throw.
Object.defineProperty(El.prototype, "classList", {
  get: function () {
    var el = this;
    if (!el._cls) el._cls = {};
    return {
      add: function (c) { el._cls[c] = 1; },
      remove: function (c) { delete el._cls[c]; },
      contains: function (c) { return !!el._cls[c]; },
      toggle: function (c, on) {
        var want = on === undefined ? !el._cls[c] : !!on;
        if (want) el._cls[c] = 1; else delete el._cls[c];
        return want;
      },
    };
  },
});
El.prototype.getBoundingClientRect = function () { return { width: 900, height: 600 }; };
El.prototype.getElementsByClassName = function () { return []; };
// Assigning innerHTML wipes an element's children in a real DOM. The stub has to
// as well, or a container rebuilt on every render (the tab bar, the filter chip
// strips) accumulates instead of replacing, and a role-gate assertion counting
// tabs silently passes on stale children.
Object.defineProperty(El.prototype, "innerHTML", {
  get: function () { return this._html === undefined ? "" : this._html; },
  set: function (v) { this._html = v; this.children = []; },
});
// <select> stub: the filter code builds options with createElement and reads
// them back, so the option list has to be inspectable — that IS the cascading
// behaviour under test.
Object.defineProperty(El.prototype, "options", {
  get: function () {
    var out = [];
    this.children.forEach(function (c) {
      if (c.tagName === "option") out.push(c);
      else if (c.tagName === "optgroup") c.children.forEach(function (g) { out.push(g); });
    });
    return out;
  },
});
/** Every option value in a select stub, disabled ones suffixed with "!". */
El.prototype.optionKeys = function () {
  return this.options.map(function (o) { return o.value + (o.disabled ? "!" : ""); });
};
var els = {};
global.document = {
  getElementById: function (id) { return els[id] || (els[id] = new El(id)); },
  createElement: function (tag) { var e = new El(tag); e.tagName = tag; return e; },
  querySelectorAll: function () { return []; },
  querySelector: function () { return null; },
  documentElement: new El("html"),
  body: new El("body"),
  addEventListener: function () {},
};
global.window = { scrollTo: function () {}, matchMedia: function () { return { matches: false, addEventListener: function () {} }; },
                  addEventListener: function () {},
                  // A REAL in-memory store, not an inert pair of no-ops. The
                  // client persists two settings through it (the sidebar
                  // collapse and the confidential switch), and a stub whose
                  // setItem throws the value away cannot exercise either
                  // RESTORE path — which is where the interesting bug lives:
                  // reading a saved value back and acting on it at boot.
                  localStorage: (function () {
                    var m = {};
                    return {
                      getItem: function (k) { return k in m ? m[k] : null; },
                      setItem: function (k, v) { m[k] = String(v); },
                      removeItem: function (k) { delete m[k]; },
                    };
                  })() };
global.localStorage = global.window.localStorage;
global.navigator = { userAgent: "node" };
global.setTimeout = function () { return 0; };
global.clearTimeout = function () {};
// setInterval MUST be stubbed too, not just setTimeout. loadData()'s cold-start
// progress clock is a real interval, and an unstubbed one keeps Node's event
// loop alive forever — the suite runs to completion and then simply never
// exits, which looks like a hang rather than a failure.
global.setInterval = function () { return 0; };
global.clearInterval = function () {};
// google.script.run is chainable and never resolves — loadData() at the bottom
// of the script fires once and we drive the render ourselves.
var runStub = new Proxy({}, { get: function () { return function () { return runStub; }; } });
global.google = { script: { run: runStub, host: { close: function () {} } } };

// ── Load the client ─────────────────────────────────────────
var html = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
var m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error("❌ render-smoke: could not find the inline <script> block");
var bridge = "\n;({ setModel: function (x) { MODEL = x; }, getModel: function () { return MODEL; }," +
             " setState: function (k, v) { STATE[k] = v; }, STATE: STATE," +
             // Task 16B: #tiles/#tileColorKey and renderTiles_ are RETIRED — the
             // four cards moved to the Flow band (On-Time/Forecast/Quality, via
             // renderFlow_) and the Capacity band (Utilisation/Planned Coverage,
             // via capacityTileHtml_/renderPulse_). See task-16b-report.md.
             " capacityTileHtml_: capacityTileHtml_, outcomeHeadlineLabel_: outcomeHeadlineLabel_," +
             " planCellHtml_: planCellHtml_," +
             // tileHtml_ / regRequired_ / registryMissingTile_ (2026-08-17): the
             // target-rule and registry-spine blocks build single cards directly
             // rather than through a whole render, so a check about one card's
             // grammar does not depend on a fixture producing that card.
             " tileHtml_: tileHtml_, regRequired_: regRequired_," +
             " registryMissingTile_: registryMissingTile_," +
             // The advanced-filter drawer (2026-08-17, review item #1).
             " renderAdvToggle_: renderAdvToggle_, toggleAdvFilters_: toggleAdvFilters_," +
             " advActive_: advActive_, ADV_FILTERS_: ADV_FILTERS_," +
             " countUpTiles_: countUpTiles_," +
             " renderHygPanel_: renderHygPanel_, gapsRows_: gapsRows_," +
             // A solved check retires itself from the surfaces that remain
             // (2026-08-06). The matrix's column-level twin of that rule
             // (typeFieldRetired_ / typeFieldsShown_) was removed with it.
             " gapsRetired_: gapsRetired_, gapRetired_: gapRetired_," +
             " hygieneFor_: hygieneFor_, hygienePeopleFor_: hygienePeopleFor_," +
             // 🌊 Flow view (spec 2026-08-05) — render-smoke is the only place
             // its grammar, absence and degradation rules can be pinned down.
             " renderFlow_: renderFlow_, flowOpenFor_: flowOpenFor_, flowMedian_: flowMedian_," +
             // The 🧬 by-type matrix's exports (typeMatrixHtml_, typeImpact_,
             // typeHygRows_, TYPE_FIELDS_, typeFieldN_) went with it on
             // 2026-08-17. setTypePop_ survives: the Open/Resolved toggle moved
             // onto the 👥 roster, which was the matrix's only co-consumer.
             " setTypePop_: setTypePop_," +
             " personSignalRows_: personSignalRows_, signalSummary_: signalSummary_, SIGNAL_FIELDS_: SIGNAL_FIELDS_, methodPanelHtml_: methodPanelHtml_, openMethod_: openMethod_, closeMethod_: closeMethod_, keyGridHtml_: keyGridHtml_," +
             " metricConfidence_: metricConfidence_, pngPeriodStamp_: pngPeriodStamp_," +
             // Navigation, cascading filters, operating rate, charts and the two
             // new views — all client-only, so render-smoke is the only place
             // their rules can be pinned down.
             " switchView_: switchView_, buildFilters_: buildFilters_," +
             " optionsFor_: optionsFor_, passesFilters_: passesFilters_," +
             " filteredPeople_: filteredPeople_, renderFilterWarn_: renderFilterWarn_," +
             " standardRate_: standardRate_, stdFor_: stdFor_," +
             " hbarChart_: hbarChart_, sparkHtml_: sparkHtml_," +
             // The mini chart's FRAME. A count series drawn against a
             // percentage domain leaves the viewBox entirely and paints over
             // the rest of the page (2026-08-07) — reachable only by rendering.
             " numDomain_: numDomain_, pctDomain_: pctDomain_, flowTileHtml_: flowTileHtml_," +
             " allIsoWeeks_: allIsoWeeks_," +
             " donePeriods_: donePeriods_," +
             // Forward windows (2026-08-06): the in-flight period and the next
             // two planning weeks. Every rule here — index parity with
             // donePeriods_, the default never landing on an unfinished window,
             // the trend anchor — lives in these four functions.
             " analysisPeriods_: analysisPeriods_, analysisHead_: analysisHead_," +
             " planWeeks_: planWeeks_, planFor_: planFor_, planFor1_: planFor1_," +
             " oppRows_: oppRows_, metricSeries_: metricSeries_, metricChips_: metricChips_, renderCompare_: renderCompare_," +
             " renderPulse_: renderPulse_, openRoster_: openRoster_, rosterCsvLines_: rosterCsvLines_," +
             " renderRoster_: renderRoster_, setRosterSort_: setRosterSort_, ROSTER_COLS_: ROSTER_COLS_," +
             " rosterColKeys_: rosterColKeys_," +
             " hoursCellHtml_: hoursCellHtml_, rosterDetailRow_: rosterDetailRow_, toggleRosterDetail_: toggleRosterDetail_," +
             " toggleRosterDetailAll_: toggleRosterDetailAll_, backlogItemsShown_: backlogItemsShown_," +
             " aggWeeks_: aggWeeks_, personStateBadges_: personStateBadges_," +
             " setSigFilter_: setSigFilter_, SIG_FILTERS_: SIG_FILTERS_, sigFilterMatch_: sigFilterMatch_," +
             " toggleFlag_: toggleFlag_, VIEWS: VIEWS, dimMatch_: dimMatch_, UNTAGGED_: UNTAGGED_, cmpNoun_: cmpNoun_, scopedMetric_: scopedMetric_, METRICS_: METRICS_, METRIC_ORDER_: METRIC_ORDER_, canSeeMargin_: canSeeMargin_, liveMetrics_: liveMetrics_," +
             " renderAll_: renderAll_, buildPeriodChips_: buildPeriodChips_," +
             " utilFor_: utilFor_, bucketsFor_: bucketsFor_," +
             // Header freshness line (2026-08-04): the export stamp vs the model
             // rebuild are two clocks, and only rendering can prove they stay apart.
             " dataAsOfView_: dataAsOfView_, renderTrust_: renderTrust_," +
             // §1 THE MASTHEAD (Task 11, spec 2026-08-06) — the verdict engine
             // and its formatters/series helpers, exposed so a check can pin
             // the returned findings array directly, not just scrape HTML.
             " renderMasthead_: renderMasthead_, verdictFindings_: verdictFindings_," +
             " shelfRows_: shelfRows_, coverSeries_: coverSeries_, netFlowPerWeek_: netFlowPerWeek_," +
             " nfDh_: nfDh_, n1Dh_: n1Dh_," +
             // §2 BACKLOG BAND (Task 12, spec 2026-08-06) — the ORG hero triplet,
             // the filterable assigned sub-row and the queue ruler.
             " renderBacklogBand_: renderBacklogBand_, queueRulerSvg_: queueRulerSvg_," +
             " trailingCompleteWeeks_: trailingCompleteWeeks_, orgClearRateGap_: orgClearRateGap_," +
             " assignedClearRate_: assignedClearRate_," +
             // §6 THE GRID (Task 15, spec 2026-08-06 §6) — the metric × dimension
             // table, its shared row cap and its per-cell grading rules.
             " gridMetrics_: gridMetrics_, GRID_METRIC_IDS_: GRID_METRIC_IDS_," +
             " capRows_: capRows_, gridCellHtml_: gridCellHtml_, setMetric_: setMetric_," +
             " activeMetric_: activeMetric_, flowOpenFor_: flowOpenFor_," +
             // §7/§8 THE SHELF + TRUST DETAIL (Task 16, spec 2026-08-06 §7/§8).
             " renderTrustDetail_: renderTrustDetail_," +
             // ── Redesign 2026-08-17: the three-tier Executive rebuild ──
             // renderShelf_ is GONE (the "Not measured this week" panel was
             // deleted); shelfRows_ above survives because the masthead still
             // counts it. The comparison panel is behind SHOW_COMPARE_PANEL_ —
             // set/getComparePanel_ let its existing coverage keep running
             // against the real renderer while the default stays off.
             " canSeeSuper_: canSeeSuper_, backlogHeroTilesHtml_: backlogHeroTilesHtml_," +
             // Retained-but-unrendered: the Workforce-change card was deleted
             // from the Executive tab, and its builder deliberately kept. Kept
             // code that nothing exercises is code that rots, so its coverage
             // moves onto the builder rather than lapsing with the card.
             " workforceTileHtml_: workforceTileHtml_, workforceFor_: workforceFor_," +
             " smartLegendHtml_: smartLegendHtml_, unownedNoteHtml_: unownedNoteHtml_," +
             " toggleNav_: toggleNav_, setNavCollapsed_: setNavCollapsed_, buildTabs_: buildTabs_," +
             // Utilization is switched off in production (2026-08-17) and its
             // builder retained. setUtilization_ lets the blocks that test that
             // builder flip it on, so retired-but-kept code cannot rot while
             // unrendered — the same treatment the comparison panel got during
             // its own hidden phase.
             " setUtilization_: function (v) { SHOW_UTILIZATION_ = v; }," +
             " getUtilization_: function () { return SHOW_UTILIZATION_; }," +
             " wfAvailability_: wfAvailability_, availabilityFor_: availabilityFor_, wfCfg_: wfCfg_, availabilityTileHtml_: availabilityTileHtml_," +
             " drillActionsHtml_: drillActionsHtml_, drillPick_: drillPick_, drillRowPick_: drillRowPick_, levelName_: levelName_, EXEC_TABS_: EXEC_TABS_, renderExecTabs_: renderExecTabs_, setExecTab_: setExecTab_," +
             " LEVEL_ORDER_: LEVEL_ORDER_, liveMetrics_: liveMetrics_, COMPARE_LABELS: COMPARE_LABELS," +
             " metricSampleN_: metricSampleN_, sampleFloorClient_: sampleFloorClient_," +
             " metricFeedDown_: metricFeedDown_, shelfClears_: shelfClears_," +
             // 🌊 Backlog health (blocking fix D3) — the unassigned/unattributed
             // split's client-side rendering.
             " backlogHealthFor_: backlogHealthFor_, renderBacklogHealth_: renderBacklogHealth_," +
             " BACKLOG_META_: BACKLOG_META_, BACKLOG_ORDER_: BACKLOG_ORDER_," +
             " renderEpicDue_: renderEpicDue_," +
             // Due-date urgency bands (spec 2026-08-11 §4). isoCmp_ is exposed
             // because the single-digit-week case is the whole reason it exists.
             " isoCmp_: isoCmp_, dueBand_: dueBand_," +
             " dueCellHtml_: dueCellHtml_, currentIso_: currentIso_," +
             " renderPm_: renderPm_, pmEpicHtml_: pmEpicHtml_," +
             " pmOppHtml_: pmOppHtml_, pmViaHtml_: pmViaHtml_, PM_OPPS_: PM_OPPS_, pmPillOpen_: pmPillOpen_," +
             " pmEpicPasses_: pmEpicPasses_, pmFiltersActive_: pmFiltersActive_," +
             " resetFilters_: resetFilters_," +
             " PM_COLS_: PM_COLS_, pmGroupRowHtml_: pmGroupRowHtml_," +
             " pmKeyLink_: pmKeyLink_," +
             " togglePmOpen_: togglePmOpen_, togglePmEpic_: togglePmEpic_, jsArg_: jsArg_," +
             // 🧭 Workforce — the grid and its "who has the hours" drill-down.
             " renderWfGrid_: renderWfGrid_, toggleWfCell_: toggleWfCell_," +
             // renderWfScope_ (2026-08-17): the bench count moved onto Scope
             // because it is the panel that renders at the shipped defaults.
             " renderWfScope_: renderWfScope_," +
             // 👁 Confidential view: a presentation switch over the role gates.
             " confHidden_: confHidden_, setConfidential_: setConfidential_," +
             " confEligible_: confEligible_, piiHtml_: piiHtml_, confLoad_: confLoad_," +
             " canSeeSuper_: canSeeSuper_, confBtnHtml_: confBtnHtml_," +
             " confBannerHtml_: confBannerHtml_, viewAllowed_: viewAllowed_," +
             // Access control: the panel is a pure function of its working state,
             // so it can be tested without a google.script.run round-trip.
             " accessPanelHtml_: accessPanelHtml_, accPending_: accPending_," +
             " accParts_: accParts_, accIsEmail_: accIsEmail_, accWhere_: accWhere_," +
             " accRowHtml_: accRowHtml_," +
             " wfBandLabel_: wfBandLabel_, WF_BAND_ORDER_: WF_BAND_ORDER_," +
             " wfPersonHours_: wfPersonHours_, wfSellable_: wfSellable_," +
             // Workforce tab cleanup (2026-08-17): the drawer's content and the
             // in-cell reconcile flag are both pure builders.
             " wfMethodHtml_: wfMethodHtml_, wfReadTarget_: wfReadTarget_, wfFlagHtml_: wfFlagHtml_," +
             " wfRead_: wfRead_ })";
var C = eval(m[1] + bridge);

/**
 * Every KPI tile renderFlow_ produces, across the two containers the
 * three-tier redesign (2026-08-17) split them into: Tier 1 (#tier1Tiles —
 * On-Time · Forecast · Quality, the outcome cards) followed by Tier 2's
 * secondary strip (#flowSecondary — Throughput · Bug Count · Inventory · Net
 * flow · Weeks to clear, then Cleared · Arrived · Lead Time). The five in the
 * middle were demoted out of Tier 1 later the same day (user instruction).
 *
 * Concatenated in DOM order, so checks that slice between two tile labels keep
 * reading the same span they always did. Every assertion that used to read
 * `flowHtml_()` reads this instead — the band was split across two
 * elements, not reduced, and the coverage should not shrink with the layout.
 */
function flowHtml_() {
  return document.getElementById("tier1Tiles").innerHTML +
         document.getElementById("flowSecondary").innerHTML;
}

/**
 * ONE tile's own markup, found by its label.
 *
 * Replaces the "split between this label and the next one" idiom several
 * checks used. That idiom encoded the tile ORDER into every assertion about a
 * tile's CONTENT, so the three-tier redesign (2026-08-17) — which reordered the
 * band without changing a single tile — broke checks that were not about
 * ordering at all, and silently widened others to swallow their neighbours.
 *
 * Splitting on the tile boundary instead means a check about Bug Count reads
 * Bug Count, whatever sits beside it. Order is still pinned, deliberately and
 * separately, by the tier checks further down.
 *
 * @param {string} h  rendered HTML containing one or more .tile blocks
 * @param {string} label  the tile's .lbl text, e.g. "Bug Count"
 * @returns {string} that tile's markup, or "" when no tile carries the label
 */
function tileSeg_(h, label) {
  var parts = h.split('<div class="tile');
  // The label div carries ATTRIBUTES on some branches — tileHtml_'s
  // "unavailable" shell renders `<div class="lbl" title="…">`. Matching the
  // bare `<div class="lbl">` silently returned "" for exactly those tiles, so a
  // check on an EMPTY card passed against an empty string (2026-08-17).
  // Labels here are plain literals ("Forecast Accuracy", "Quality / Rework") —
  // no regex metacharacters, so no escaping is needed or wanted.
  var re = new RegExp('<div class="lbl"[^>]*>' + label);
  for (var i = 1; i < parts.length; i++) {
    if (re.test(parts[i])) return parts[i];
  }
  return "";
}

/**
 * Runs `fn` with the Utilization flag forced ON, then restores it.
 *
 * Utilization is switched off in production (2026-08-17) and its builder kept.
 * The blocks below that test THE BUILDER — the billable-vs-tracked relabelling,
 * the coverage gate, the planning-window swap — are about rules that must still
 * hold on the day it comes back, so they run against it directly rather than
 * lapsing. Everything else runs at the shipped default, so the suite's baseline
 * is the dashboard as deployed.
 */
function withUtilization_(fn) {
  var was = C.getUtilization_();
  C.setUtilization_(true);
  try { return fn(); } finally { C.setUtilization_(was); }
}

// ── Synthetic model ─────────────────────────────────────────
// Two complete weeks so the trend has ≥2 periods (the "high confidence" bar).
var WEEKS = ["2026.W30", "2026.W31"];
function week(o) {
  // capCov = gross scheduled capacity of an NS-classified week. Schema v10: the
  // Metrics Dictionary Utilization denominator divides by this, so a fixture
  // without it reports null and every utilization assertion goes quiet.
  return Object.assign({ cap: 40, avail: 40, availCov: 40, capCov: 40, planned: 40,
                         tracked: 40, trackedOff: 0, trackedCov: 40, billable: 30, nonBillable: 10,
                         nsCov: true, nsBillRaw: 30, nsNonBillRaw: 10, capEst: false,
                         effPlanned: 40 }, o || {});
}
function person(name, o) {
  return Object.assign({ name: name, region: "AMER", teams: ["Team A"], pms: [], jobFamily: "Service Delivery",
                         isCrew: false, isManager: false, onLeave: false, newHire: false,
                         jobTitle: "09.P3.Consultant", backlog: null,
                         // Workforce Health classification (schema v30). Carried on
                         // every fixture person because the client groups by `cell`
                         // — a person with no pool would fall into NONE|UNKNOWN and
                         // silently re-blend, which is the failure the whole view
                         // exists to prevent.
                         pool: "PS-CONSULT", band: "CORE", backlogRole: "CONSUMER",
                         cell: "PS-CONSULT|CORE", subTrack: "09.1",
                         disciplineLabel: "Consulting", stemWarning: null,
                         classificationError: null,
                         weeks: { "2026.W30": week(), "2026.W31": week() } }, o || {});
}
/** One weekly workforce bucket, zero-filled. */
function wfWeek(o) {
  return Object.assign({ grossHrs: 0, ptoHrs: 0, committedHrs: 0, matchableCommittedHrs: 0, genericHrs: 0,
                         trackedTotalHrs: 0, trackedCommittedHrs: 0, trackedShadowHrs: 0,
                         unmeasuredHrs: 0,
                         shadowReasons: { "no-epic": 0, "no-srso": 0, "not-committed": 0 } },
                       o || {});
}
/** @param cov  fraction of resolved issues carrying a due date / epics measurable */
function model(o) {
  o = o || {};
  // Per-bucket integers: the tiles print these counts verbatim, so fractional
  // fixtures produce "of 18.5 misses" and the assertions stop meaning anything.
  var nAll = 50, n = Math.round(nAll * (o.otCov === undefined ? 0.95 : o.otCov));
  var fAll = 20, fN = Math.round(fAll * (o.fcCov === undefined ? 0.9 : o.fcCov));
  var fWithin = Math.round(fN * 0.5);
  var fOver = Math.round((fN - fWithin) * 0.8);
  return Object.assign({
    schemaVer: 8,
    meta: {
      gridWeeks: WEEKS, trendWeeks: WEEKS, headlineIso: "2026.W31",
      periods: null,             // weekly framing — allPeriods_ falls back to weeks
      generatedAt: new Date().toISOString(),
      // The Jira site every deep link is built from (schema v37). A fixture
      // WITHOUT it is exercised separately: no site must mean plain text, never
      // an href pointing at "/browse/KEY" on the Apps Script host.
      jiraBase: "https://servicerocket-coe.atlassian.net",
      thresholds: { green: 70, amber: 50 },
      targets: { util: { green: 70, amber: 50 }, onTime: { green: 85, amber: 70 },
                 forecast: { green: 80, amber: 60 }, hygiene: { green: 90, amber: 75 },
                 quality: { green: 5, amber: 10 } },
      regions: ["AMER", "EMEA", "SEA", "ANZ", "Other"], teams: ["Team A"], pms: [], families: ["Service Delivery"],
      nsAvailable: true, jiraAvailable: true,
      nsCoverage: { personWeeks: 4, covered: 4, classifiedPct: 1, gapHours: 0, unmatchedNames: [] },
      jiraUnattributed: { onTime: 3, forecast: 1 },
      onTimeScope: "delivery", forecastBand: 0.10,
      // Queue metrics (Task 11, spec 2026-08-06 §1). Boring/inert defaults on
      // purpose — clearRateMedian: null and empty history mean the masthead's
      // depth/flow findings stay silent unless a test opts in explicitly, the
      // same way every other per-test override in this file works.
      arrivalsAvailable: true, clearRateMedian: null, clearRateWeeks: 8,
      capacityError: null,
      refreshEveryMin: 30,
      sources: [{ system: "Jira", feeds: "On-Time", tab: "Jira Raw" }],
      registry: {
        version: "1.0", updated: "2026-08-03",
        metrics: {
          onTime:   { id: "onTime", name: "On-Time Delivery", coverageGate: 0.80, owner: "Delivery leadership",
                      definition: "d", formula: "f", coverageOf: "resolved issues with a due date" },
          forecast: { id: "forecast", name: "Forecast Accuracy", coverageGate: 0.70, owner: "Delivery leadership",
                      definition: "d", formula: "f", coverageOf: "closed epics with estimate and time" },
          util:     { id: "util", name: "Billable Utilization", coverageGate: 0.90, owner: "WFP",
                      definition: "d", formula: "f", coverageOf: "tracked hours classified" },
          quality:  { id: "quality", name: "Quality / Rework", coverageGate: 0.80, owner: "Delivery + CX",
                      definition: "d", formula: "f", coverageOf: "delivered issues measured",
                      target: { green: 5, amber: 10 }, invertTarget: true },
          hygiene:  { id: "hygiene", name: "Delivery Data Attributed", coverageGate: 0, owner: "WFP",
                      definition: "d", formula: "f", coverageOf: "n/a" },
          // ── The flow metrics (added 2026-08-17, review item #6) ────────────
          // These five used to be absent here, and the renderer used to paper
          // over that with per-call-site literal fallbacks (`reg.throughput ||
          // { unit: "hrs", … }`). Now a missing entry renders an explicit
          // ungraded placeholder instead, so the fixture has to carry what the
          // SERVER actually ships — METRIC_REGISTRY_ in Code.js defines all
          // five. Name/unit/coverageGate mirror it exactly; a drift here is a
          // drift in what the suite is testing. Individual blocks below still
          // override these with richer entries when they need extra fields.
          leadTime:   { id: "leadTime", name: "Lead Time", unit: "days", coverageGate: 0.90,
                        definition: "d", formula: "f", coverageOf: "resolved issues with a created date" },
          throughput: { id: "throughput", name: "Throughput", unit: "hrs", coverageGate: 0.60,
                        definition: "d", formula: "f", coverageOf: "resolved issues carrying an estimate" },
          bugCount:   { id: "bugCount", name: "Bug Count", unit: "bugs", coverageGate: 0,
                        definition: "d", formula: "f", coverageOf: "n/a" },
          cleared:    { id: "cleared", name: "Cleared", unit: "items", coverageGate: 0,
                        definition: "d", formula: "f", coverageOf: "n/a — a count has no coverage denominator" },
          arrived:    { id: "arrived", name: "Arrived", unit: "items", coverageGate: 0,
                        definition: "d", formula: "f", coverageOf: "n/a — a count has no coverage denominator" },
        },
        changeLog: [{ version: "1.0", date: "2026-08-03", author: "A", affects: ["forecast"],
                      change: "band", rationale: "why" }],
      },
    },
    people: [person("Ana Perez"), person("Ben Ortiz")],
    // Workforce Health (schema v30). Two pools on purpose — one that consumes
    // backlog and one that is demand-driven — because the single thing this
    // view must never do is report them as one number.
    workforce: {
      weekly: {
        "PS-CONSULT|CORE": {
          "2026.W30": wfWeek({ grossHrs: 80, committedHrs: 60, matchableCommittedHrs: 60, trackedTotalHrs: 70,
                               trackedCommittedHrs: 60, trackedShadowHrs: 10,
                               shadowReasons: { "no-epic": 6, "no-srso": 4, "not-committed": 0 } }),
          "2026.W31": wfWeek({ grossHrs: 80, committedHrs: 60, matchableCommittedHrs: 60, trackedTotalHrs: 70,
                               trackedCommittedHrs: 62, trackedShadowHrs: 8,
                               shadowReasons: { "no-epic": 5, "no-srso": 3, "not-committed": 0 } }),
        },
        "MS-SUPPORT|CORE": {
          "2026.W31": wfWeek({ grossHrs: 40, committedHrs: 38, matchableCommittedHrs: 38, trackedTotalHrs: 39,
                               trackedCommittedHrs: 39 }),
        },
      },
      headByCell: { "PS-CONSULT|CORE": 2, "MS-SUPPORT|CORE": 1 },
      cells: [],
      medianCover: null,
      backlogByPool: {
        "PS-CONSULT": { backlogHrs: 300, backlogAdjHrs: 400, epicCount: 8,
                        unestimatedEpics: 2, estimateCoverage: 0.75 },
        "UNROUTED":   { backlogHrs: 50, backlogAdjHrs: 50, epicCount: 2,
                        unestimatedEpics: 0, estimateCoverage: 1 },
      },
      disciplines: [],
      consumersOnly: { head: 2, grossHrs: 160, committedHrs: 120, headroomHrs: 40,
                       headroomPct: 0.25, denominatorLabel: "of 2 backlog consumers" },
      scope: { population: 3, consumers: 2, unclassified: 0, unclassifiedReasons: [],
               stemWarnings: 0, stemWarningDetail: [], absentPools: ["ARCH", "PMO", "TRAINING"],
               weeksInPeriod: 2, drift: null },
      coverage: { planIssueCoverage: 0.6, plannedHrsTotal: 100, plannedHrsWithIssue: 60,
                  committedEpics: 5, routedEpics: 6, unroutedHrs: 50, unroutedEpics: 2,
                  // schema 44: the keys the Workforce alert's Jira button links on.
                  unroutedKeys: ["GTT-900", "GTT-901"], unroutedCapped: false,
                  genericPlansMeasured: false, capacityTruthMeasured: false },
    },
    // Queue halves, never summed here (Task 11, spec §1/§4.2) — 0, not null:
    // a real measured empty queue, distinct from "we did not look".
    queue: { assigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
             unassigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 } },
    arrivalWeeks: [],
    inventoryHistory: [],
    onTimeBuckets: WEEKS.map(function (iso) {
      return { iso: iso, person: "Ana Perez", n: n, onTime: Math.round(n * 0.9), nAll: nAll };
    }),
    forecastBuckets: WEEKS.map(function (iso) {
      return { iso: iso, person: "Ana Perez", n: fN, nWithin: fWithin, nAll: fAll,
               nNoTime: 2, nMissOver: fOver, nMissUnder: fN - fWithin - fOver,
               absVars: [0.05, 0.4, 0.9] };
    }),
    // Quality / Rework (schema v10). 2 of 8 delivered items needed rework = 25%,
    // with the reopen signal measured on all 8.
    reworkBuckets: WEEKS.map(function (iso) {
      return { iso: iso, person: "Ana Perez", nDelivered: 8, nRework: 2,
               nLinked: 1, nReopened: 1, nReopenCov: 8 };
    }),
    hygieneBuckets: WEEKS.map(function (iso, i) {
      // W31 improves on W30 so the trend has somewhere to go.
      // resAssigned 47 vs resAttr 45: nearly everything HAS an assignee; the loss
      // is in the roster join. Two different gaps (schema v11).
      return { iso: iso, res: 50, resDue: 40, resAssigned: 47, resAttr: 45, resRegion: 10, resTeam: 5,
               resReady: 30 + i * 4, resFull: 8, epics: 20, epicsEst: 14, epicsTime: 9 };
    }),
    // Field fill by issue type (schema v17). Shaped like the real finding: a
    // small, well-disciplined Go-live epic population and a large, poorly-filled
    // Story one — so impact ordering has something to get wrong.
    typeHygiene: {
      keyCap: 500,
      resolved: WEEKS.map(function (iso) {
        // timeN === n on the resolved half by construction (schema v24): finished
        // work is always expected to carry its cost. dueN === n for the same
        // reason (v32) — On-Time IS the due-date question.
        return { iso: iso, type: "Go-live epic", isEpic: true, gatesOnTime: true,
                 gatesForecast: true, n: 5, due: 5, assigned: 5, attr: 4, est: 3, time: 2,
                 timeN: 5, dueN: 5,
                 region: 0, team: 0, keys: { attr: ["R-1"], est: ["R-2", "R-3"] }, keysCapped: {} };
      }),
      open: [
        // 4 of 12 due dates missing, and it gates On-Time → 21 fixable gaps here
        // (4 due + 0 assigned + 2 attr + 10 est + 5 time … impact is what sorts).
        // `timeN: 5` — only 5 of the 12 have STARTED (schema v24), so the Logged
        // column contributes 5 fixable gaps, not 12. The other 7 are tickets
        // nobody has picked up: no worklog is expected on them yet.
        // `dueN: 5` — the SAME started population now denominates the due-date
        // column too (schema v32), and only 2 of those 5 carry a date.
        { iso: "", type: "Go-live epic", isEpic: true, gatesOnTime: true, gatesForecast: true,
          n: 12, due: 2, dueN: 5, assigned: 12, attr: 10, est: 2, time: 0, timeN: 5,
          region: 0, team: 0,
          keys: { due: ["G-1", "G-2", "G-3"], attr: ["G-5", "G-6"],
                  est: ["G-7"], time: ["G-8"] }, keysCapped: { time: true } },
        // Big, badly filled, but gates NOTHING today — must not outrank the epics.
        { iso: "", type: "Sub-task", isEpic: false, gatesOnTime: false, gatesForecast: false,
          n: 300, due: 30, dueN: 40, assigned: 300, attr: 300, est: 5, time: 5, timeN: 40,
          region: 0, team: 0,
          keys: { due: ["S-1"] }, keysCapped: {} },
      ],
    },
    viewerRole: "admin",
  }, o.overrides || {});
}

// The fixtures ship meta.periods = null (weekly framing), so mirror what
// loadData() does on a pre-period-toggle payload: fall back to the week unit.
// Without this the view would label weekly buckets "month".
C.STATE.period = "week";

/** Drop every per-payload memo, so a fixture reused across tests can't inherit
    a cached name index, NS verdict, week axis or triage-flag map. */
function fresh(mdl) {
  C.setModel(mdl);
  delete mdl._pByName; delete mdl._nsLive;
  delete mdl._allIsos; delete mdl._weekPeriods; delete mdl._exCache;
  delete mdl._planWeeks;
  // The picker index is per-payload too: a test that selected a forward window
  // would otherwise leave every later fixture pointing at an index that means
  // something else in its period list.
  C.STATE.periodIdx = null;
  return mdl;
}

// Task 16B: the old #tiles strip (On-Time/Forecast/Utilization/Quality) is
// RETIRED. On-Time/Forecast/Quality moved into the Flow band (#flowTiles,
// via renderFlow_); Utilisation/Planned Coverage moved into the Capacity
// band (#pulsePanel, via renderPulse_/capacityTileHtml_). tiles() renders
// BOTH and concatenates them in DOM order, so every existing split-on-label
// idiom below (".split('Forecast Accuracy')[1].split('Utilization')[0]" etc.)
// keeps working unchanged — the labels' relative order is preserved.
function tiles(mdl) {
  fresh(mdl);
  C.renderFlow_();
  C.renderPulse_();
  return flowHtml_() + els.pulsePanel.innerHTML;
}
/** Just the three outcome cards (On-Time/Forecast/Quality) — excludes the
    OTHER flow-band tiles (Cleared/Arrived/Lead Time/Throughput/Bug Count),
    which legitimately carry confidence chips the outcome cards never did. */
function outcomeSeg_(html) {
  return html.split("On-Time Delivery")[1].split("Throughput")[0];
}

// ── 1. Well-attributed data publishes ───────────────────────
var good = tiles(model({ otCov: 0.95, fcCov: 0.92 }));
assert_(/On-Time Delivery/.test(good), "on-time tile rendered");
// The confidence chip is GONE from the four KPI cards (user 2026-08-05:
// data-quality noise — the Data trust strip on the same view carries
// coverage-vs-gate). The chip survives only on the compact flow tiles,
// which render into #flowTiles, not into this element.
assert_(!/confidence/.test(outcomeSeg_(good)) && !/attributed/.test(outcomeSeg_(good)),
        "no confidence chip on the three outcome cards (user 2026-08-05) — " +
        "scoped to On-Time/Forecast/Quality, not the OTHER flow tiles sharing #flowTiles now (Task 16B), which legitimately carry one");
assert_(/pts (above|below) target/.test(good), "variance to TARGET leads the signal line (FR-4.1)");
// …and the THRESHOLD itself is printed once, as a quiet chip beside the hero —
// never restated inside the delta sentence (user 2026-08-06: "vs target ≥85%"
// is redundant next to a number already coloured against that target).
assert_(/class="tgt"[^>]*>target ≥[0-9]+%</.test(good), "target chip sits beside the hero number");
assert_(!/vs target/.test(good), "the threshold is not repeated in the delta sentence");
// The chip must be a SIBLING of .big, not inside it: the count-up animation
// rewrites .big's textContent and would eat a nested chip on first load.
assert_(!/<div class="big[^"]*">[^<]*<span class="tgt"/.test(good),
        "target chip is outside .big (count-up rewrites .big's text)");
assert_(!/Not yet measurable/.test(good), "nothing suppressed when coverage is good");
assert_(/Median absolute variance/.test(good), "forecast secondary form present (FR-1.4) — moved to the context tooltip in R6, still present");
assert_(/inside ±10%/.test(good), "forecast headline names the ±10% band");
assert_(/Of [0-9]+ miss(es)?, [0-9]+% over-run/.test(good), "variance direction on misses (FR-1.6)");
// The "definition changed" marker is gone from the KPI tiles (user 2026-08-03:
// "this is not meaningful"). On a single headline number there is no visible
// step for it to explain; it survives only on the Trends line chart, where the
// step is on screen.
assert_(!/definition changed/.test(good), "no definition-changed marker on any KPI tile");

// ── 2. Below-gate coverage, SHIPPED policy: publish clean ──
// User decision 2026-08-03 (accepted deviation from FR-2.2): suppression is off.
// The per-card coverage narration — low-confidence chip, "below gate —
// directional only" caveat, "What's missing →" link — was removed with the
// rest of the card noise (user 2026-08-05): coverage-vs-gate lives on the
// 🔍 Data trust strip and the 🎯 Actions tab now.
var shown = tiles(model({ otCov: 0.66, fcCov: 0.43 }));
assert_(!/Not yet measurable/.test(shown), "shipped policy publishes below-gate metrics");
assert_(!/below gate — directional only/.test(shown),
        "no below-gate caveat on the cards (user 2026-08-05 — the trust strip carries the gate)");
assert_(!/What's missing/.test(shown), "no hygiene-queue link on the cards either");
var shownFc = shown.split("Forecast Accuracy")[1].split("</div></div>")[0];
assert_(/class="big/.test(shownFc), "the figure itself is rendered");
assert_(/inside ±10%/.test(shown), "…with its normal supporting copy intact");

// ── 2b. Flipping the policy restores full FR-2.2 suppression ──
// The whole path stays behind one flag, so the decision is reversible without
// a code change beyond CONFIG_DH.SUPPRESS_BELOW_GATE.
var strict = model({ otCov: 0.66, fcCov: 0.43 });
strict.meta.suppressBelowGate = true;
var bad = tiles(strict);
// Sliced per TILE, not between neighbouring labels. Forecast's next sibling has
// moved twice now — Utilization, then Quality/Rework, and since 2026-08-17
// Availability Rate — and each move silently widened this slice to swallow the
// neighbour's markup, so a check about the SUPPRESSED card graded another card.
var forecastCard = tileSeg_(bad, "Forecast Accuracy");
assert_(/Not yet measurable/.test(bad), "below-gate metric shows the suppressed state (FR-2.2)");
assert_((bad.match(/Not yet measurable/g) || []).length === 2,
        "BOTH on-time (66% vs 80% gate) and forecast (43% vs 70%) suppress");
assert_(!/Owner:/.test(bad), "suppressed tile carries no owner line (same rule as the hygiene table)");
assert_(!/What's missing/.test(bad),
        "no 'What's missing →' link on a suppressed tile (user 2026-08-05 — the Actions tab is the route)");
assert_(!/class="big/.test(forecastCard), "suppressed card renders NO hero number");
assert_(!/Median absolute variance/.test(forecastCard), "suppressed card renders no secondary figure either");
assert_(/45% attributed · gate 70%/.test(bad), "suppressed card states coverage against its gate");
// Defects found in the 2026.W31 tiles PNG (2026-08-03):
// a suppressed card carried no period label, so "64% attributed" described an
// unnamed window; and it trended nothing, so the state read as permanent.
//
// The REQUIREMENT is unchanged — "64% attributed" must never describe an unnamed
// window. Where it is satisfied moved: the period is now stated once globally
// above the card row (R6, 2026-08-03) instead of repeated in all four headers,
// and each card keeps it as a tooltip. Same guarantee, one line instead of four.
assert_(/title="last complete week[^"]*"[^>]*>Forecast Accuracy/.test(bad),
        "suppressed card still names the period it covers");
assert_(/title="last complete week[^"]*"[^>]*>On-Time Delivery/.test(bad),
        "…on every suppressed card");
assert_(!/Forecast Accuracy · last complete week/.test(bad),
        "…but no longer repeats it in the visible header, which cost every card a line");
assert_(/attribution trend/.test(bad),
        "suppressed card trends its COVERAGE — 'is the gap closing?' is publishable, the metric isn't");
assert_(!/class="big/.test(forecastCard), "…and still no metric value anywhere on it");

// ── 3. Metric identity: no billable claim without a billable feed ──
var noNs = model({});
noNs.people.forEach(function (p) {
  Object.keys(p.weeks).forEach(function (iso) { p.weeks[iso].nsCov = false; p.weeks[iso].availCov = 0;
                                                p.weeks[iso].trackedCov = 0; p.weeks[iso].billable = 0; });
});
// Utilization is switched off in the shipped dashboard, so this rule is tested
// against its retained builder (see withUtilization_) rather than through the
// tiles, which no longer carry the card.
var dead = withUtilization_(function () { return tiles(noNs); });
assert_(/Capacity Utilization \(tracked\)/.test(dead),
        "an empty NS feed relabels the tile — tracked ÷ capacity is a different metric (P8)");
// (the label div is followed by the .heroRow wrapper, then .big — keep the
//  wrapper optional so this stays a real assertion rather than a vacuous one)
assert_(!/Billable Utilization<\/div>\s*(<div class="heroRow">)?<div class="big/.test(dead),
        "tracked ÷ capacity is never published under a billable heading");

// ── 4. Stale data suppresses trend comparisons (NFR-7) ──────
var staleModel = model({ otCov: 0.95, fcCov: 0.92 });
C.setModel(staleModel);
staleModel._stale = true;
delete staleModel._pByName; delete staleModel._nsLive;
C.renderFlow_(); C.renderPulse_();
var stale = flowHtml_() + els.pulsePanel.innerHTML;
assert_(/trend suppressed — data stale/.test(stale), "stale model suppresses the sparkline");
assert_(!/vs prior/.test(stale), "stale model prints no period-over-period delta");
assert_(/pts (above|below) target/.test(stale),
        "target gap survives staleness — it isn't a comparison across refreshes");
assert_(/class="tgt"/.test(stale), "…as does the target chip beside the hero");

// ── 5. THE GAPS QUEUE IS DELETED (user 2026-08-17) ──────────
// The ~10-row table and its "Whole-population view" caption are gone. This is a
// deletion guard, not a rendering test: what is asserted is that the table does
// not come back, that the panel it lived on still carries the two things that
// were inside it, and that the information the table uniquely held did not
// simply vanish with it.
C.setModel(model({}));
C.renderHygPanel_();
var hyg = els.hygPanel.innerHTML;
assert_(!/Whole-population view/.test(hyg), "the queue's caption is gone");
assert_(!/Region tagged on delivery work/.test(hyg), "…and so are its gap rows");
assert_(!/<th>Gap<\/th>/.test(hyg) && !/<th>Blocks<\/th>/.test(hyg),
        "…and the table header with them");
assert_(!/Coverage colour/.test(hyg), "…and the colour key that only the table needed");
// The definitions SURVIVE — three other surfaces read them, and deleting a view
// must never delete the model behind it.
assert_(C.gapsRows_(C.hygieneFor_(WEEKS), C.hygienePeopleFor_(WEEKS)).length > 0,
        "gapsRows_ still returns definitions for the trust strip, masthead and shelf");

// ── 5c. Admin coverage-gate editor ──────────────────────────
// Gates are a Services-Director judgement revisited at period close; keeping
// them in code meant they could only move in a deploy window.
assert_(/Coverage gates \(admin\)/.test(hyg), "admins get the gate editor");
assert_(/id="gate_onTime" value="80"/.test(hyg), "…prefilled with the metric's current gate");
assert_(/saveGateOverrides|saveGates_/.test(hyg), "…wired to the admin-only RPC");
// An override has to stay visibly an override, or lowering a gate becomes a way
// to make a problem disappear quietly.
var ovModel = model({});
ovModel.meta.registry.metrics.onTime.gateDefault = 0.80;
ovModel.meta.registry.metrics.onTime.coverageGate = 0.55;
ovModel.meta.registry.metrics.onTime.gateOverride = { by: "someone@x.com", at: "2026-08-03" };
C.setModel(ovModel);
C.renderHygPanel_();
var ovHyg = els.hygPanel.innerHTML;
assert_(/id="gate_onTime" value="55"/.test(ovHyg), "the override value is what's editable");
assert_(/>80%/.test(ovHyg), "the AGREED default stays on screen beside it");
assert_(/✎ changed 2026-08-03/.test(ovHyg), "and the change is stamped with its date");
assert_(/restoreGate_\('onTime'\)/.test(ovHyg), "with a one-click restore to the agreed value");
// Non-admins must not see it at all — the RPC is gated server-side too.
var viewer = model({});
viewer.viewerRole = "viewer";
C.setModel(viewer);
C.renderHygPanel_();
assert_(!/Coverage gates \(admin\)/.test(els.hygPanel.innerHTML),
        "viewers get no gate editor");
C.setModel(model({}));
C.renderHygPanel_();

// ── 5b. The window banner went with the queue, and MUST have ────────────────
// It named the window the field-fill figures covered. What is left on this panel
// — the gate editor and the leaver note — follows no window, and a period label
// over content that does not move with the period is a lie that costs nothing to
// tell and everything to discover.
assert_(!/Every figure above covers/.test(hyg), "no window footer over windowless content");
assert_(!/window follows the header period picker/.test(hyg), "…and no window banner");
assert_(!/setHygIdx_/.test(hyg), "no per-view stepper — the header picker is the one control");
C.setState("periodIdx", 0);
C.renderHygPanel_();
assert_(els.hygPanel.innerHTML === hyg,
        "the panel is now period-INDEPENDENT: changing the picker changes nothing on it");
C.setState("periodIdx", null);
C.renderHygPanel_();

// ── 6. Empty scope is not the same as bad data ──────────────
var empty = model({});
empty.onTimeBuckets = []; empty.forecastBuckets = [];
var none = tiles(empty);
assert_(/On-Time Delivery/.test(none), "empty buckets still render a card");
assert_(!/Not yet measurable/.test(none),
        "nothing in scope is NOT a coverage failure — a quiet week must not read as bad data");
assert_(/no resolved delivery items in this period/.test(none), "the empty card says why it's empty");
// THE EMPTY STATE NAMES THE REAL CAUSE (2026-08-17). It used to read "no epics
// closed in this period under the active filters", which was wrong twice:
// epics may have closed and been dropped for having no resolvable owner, and
// blaming the filters sends the reader to clear controls that were never the
// cause. The two states are now distinguished by the count the server already
// shipped and the card ignored.
// This fixture carries jiraUnattributed.forecast = 1, so it is the DROPPED branch.
var fcNone = tileSeg_(none, "Forecast Accuracy");
assert_(fcNone !== "", "sanity: the forecast card is findable in the empty strip");
assert_(/could be attributed to a person/.test(fcNone),
        "forecast empty state names attribution, not filters, when epics were dropped");
assert_(/1 closed epic was dropped/.test(fcNone),
        "…and states how many, from the count the server already ships");
assert_(!/under the active filters/.test(fcNone),
        "…and no longer blames the filters for a structural absence");

// The OTHER branch: nothing closed at all, nothing dropped. It must not claim
// an attribution problem that did not happen.
var noneClean = model({});
noneClean.onTimeBuckets = []; noneClean.forecastBuckets = [];
noneClean.meta.jiraUnattributed = { onTime: 0, forecast: 0 };
var nc = tileSeg_(tiles(noneClean), "Forecast Accuracy");
assert_(/no epics closed in this window/.test(nc),
        "with nothing dropped, the card says simply that no epics closed");
assert_(/smaller population/.test(nc),
        "…and explains that closed epics are a thinner population than the other cards, which " +
        "is why this card empties on short windows when the others do not");
assert_(!/could be attributed to a person/.test(nc),
        "…and never invents an attribution failure that did not occur");

// ── 7. PNG filename stamps the period SHOWN, not the model's ISO week ──
// A July-2026 board-pack card was saving as "…-2026.W31.png" — a figure filed
// under the wrong period, and nobody reopens the file to check.
C.setModel(model({}));
assert_(C.pngPeriodStamp_() === "2026.W31", "weekly framing stamps the week shown");
var mp = model({});
mp.meta.periods = { month: [{ key: "2026-07", label: "Jul 2026", status: "done", partial: false, isos: WEEKS }],
                    quarter: [{ key: "FY27Q1", label: "FY27 Q1", status: "done", partial: false, isos: WEEKS }] };
C.setModel(mp);
C.STATE.period = "month";
assert_(C.pngPeriodStamp_() === "Jul-2026", "month framing stamps the month, not meta.headlineIso");
C.STATE.period = "quarter";
assert_(C.pngPeriodStamp_() === "FY27-Q1", "quarter framing stamps the fiscal quarter");
assert_(!/[^\w.-]/.test(C.pngPeriodStamp_()), "stamp is filename-safe");
C.STATE.period = "week";

// ══════════════════════════════════════════════════════════════════════════
// 8–13. EXECUTIVE REBUILD (2026-08-03)
// Cascading filters, the operating rate, labelled charts, tab routing and the
// opportunity table. All client-only, so this file is the only place their
// rules can be held to.
// ══════════════════════════════════════════════════════════════════════════

// A wider fixture: 8 weekly periods (7 complete + 1 in progress) across two
// regions with region-specific teams, PMs and families — enough history for an
// operating rate (needs 5) and enough structure for cascading to be visible.
var HIST = ["2026.W24", "2026.W25", "2026.W26", "2026.W27",
            "2026.W28", "2026.W29", "2026.W30", "2026.W31"];

/** Person whose billable share follows `rates` (% of a 40h week) across HIST. */
function histPerson(name, o, rates) {
  var wk = {};
  HIST.forEach(function (iso, i) {
    var pct = rates ? rates[Math.min(i, rates.length - 1)] : 75;
    wk[iso] = week({ billable: 40 * pct / 100, nonBillable: 40 - 40 * pct / 100,
                     nsBillRaw: 40 * pct / 100, nsNonBillRaw: 40 - 40 * pct / 100 });
  });
  return person(name, Object.assign({ weeks: wk }, o || {}));
}

function histModel(o) {
  o = o || {};
  var mdl = model({});
  mdl.meta.gridWeeks = HIST.map(function (iso, i) {
    return { iso: iso, status: i < HIST.length - 1 ? "done" : "now" };
  });
  mdl.meta.trendWeeks = HIST.slice(0, -1);
  mdl.meta.headlineIso = HIST[HIST.length - 2];
  // The month calendar is what allIsoWeeks_ reads to recover the deep window.
  mdl.meta.periods = {
    month: [{ key: "2026-06", label: "Jun 2026", status: "done", partial: true, isos: HIST.slice(0, 4) },
            { key: "2026-07", label: "Jul 2026", status: "now",  partial: false, isos: HIST.slice(4) }],
    quarter: [{ key: "FY26Q4", label: "FY26 Q4", status: "now", partial: true, isos: HIST }],
  };
  mdl.meta.teams = ["Atlas", "Borealis", "Cygnus"];
  mdl.meta.pms = ["Pat Ng", "Rui Sá"];
  mdl.meta.families = ["Service Delivery", "Managed Services & Support"];
  mdl.people = o.people || [
    histPerson("Ana Perez", { region: "AMER", teams: ["Atlas"], pms: ["Pat Ng"] },
               [74, 76, 75, 73, 75, 76, 74, 75]),
    histPerson("Ben Ortiz", { region: "AMER", teams: ["Atlas", "Borealis"], pms: ["Pat Ng"] },
               [70, 72, 71, 70, 72, 71, 70, 71]),
    // Chronically low — the opportunity table's reason to exist.
    histPerson("Cleo Diaz", { region: "EMEA", teams: ["Cygnus"], pms: ["Rui Sá"],
                              jobFamily: "Managed Services & Support" },
               [40, 42, 38, 41, 39, 40, 38, 40]),
    histPerson("Dev Rao", { region: "EMEA", teams: ["Cygnus"], pms: ["Rui Sá"] },
               [80, 82, 79, 81, 80, 82, 81, 80]),
  ];
  // Jira buckets across the whole window so On-Time also has a history.
  mdl.onTimeBuckets = [];
  mdl.forecastBuckets = [];
  HIST.forEach(function (iso, i) {
    mdl.onTimeBuckets.push({ iso: iso, person: "Ana Perez", n: 20,
                             onTime: 16 + (i % 3), nAll: 21 });
    mdl.forecastBuckets.push({ iso: iso, person: "Ana Perez", n: 10, nWithin: 6 + (i % 2),
                               nAll: 11, nNoTime: 1, nMissOver: 2, nMissUnder: 1,
                               absVars: [0.05, 0.2] });
  });
  return mdl;
}

function resetFilters() {
  ["region", "team", "pm", "family", "search", "flag"].forEach(function (k) { C.STATE[k] = ""; });
}

// ── 8. Cascading filters ────────────────────────────────────
// The rule: a dimension's options are computed with that dimension switched off,
// so choosing a region narrows Team/PM/Family — and clearing it restores them.
fresh(histModel({}));
resetFilters();
C.STATE.period = "week";
var teamsAll = C.optionsFor_("team");
assert_(teamsAll.live.sort().join("|") === "Atlas|Borealis|Cygnus",
        "with no filters every team with people is in scope");
assert_(teamsAll.counts.Atlas === 2, "option counts are headcounts, not row counts");

C.STATE.region = "AMER";
var teamsAmer = C.optionsFor_("team");
assert_(teamsAmer.live.sort().join("|") === "Atlas|Borealis",
        "picking AMER collapses the team list to AMER's teams");
assert_(teamsAmer.dead.join("|") === "Cygnus",
        "an out-of-scope team is reported as dead, not deleted — the list keeps its length");
assert_(C.optionsFor_("pm").live.join("|") === "Pat Ng",
        "the PM list cascades on the same region pick");
assert_(C.optionsFor_("family").live.join("|") === "Service Delivery",
        "so does the job-family list");
// The region strip must NOT cascade on itself, or picking AMER would hide EMEA
// and there would be no way to switch region without a reset.
assert_(C.optionsFor_("region").live.sort().join("|") === "AMER|EMEA",
        "a dimension never filters its own options — every region stays reachable");

C.STATE.region = "";
assert_(C.optionsFor_("team").live.length === 3, "clearing the region restores the full team list");

// Rule 1: an active selection that the other filters have emptied must stay
// selectable from the control that set it, or it can never be undone.
resetFilters();
C.STATE.team = "Cygnus";
C.STATE.region = "AMER";           // Cygnus is EMEA-only → now empty
C.buildFilters_();
var teamKeys = els.teamSel.optionKeys();
assert_(teamKeys.indexOf("Cygnus") !== -1,
        "an emptied-but-active selection stays in its dropdown (never silently vanishes)");
assert_(teamKeys.indexOf("Cygnus!") === -1,
        "and stays ENABLED, so it can be cleared from the same control");
assert_(teamKeys.indexOf("Atlas (2)") === -1 && els.teamSel.optionKeys().indexOf("Atlas") !== -1,
        "in-scope options carry their value, with the count in the label");
assert_(C.filteredPeople_().length === 0, "the combination genuinely selects nobody");
C.renderFilterWarn_();
assert_(/No one matches/.test(els.filterWarn.innerHTML),
        "a dead-end filter set says so in the filter row, not three panels down");
// Region and Team each bring back 2 people here; ties resolve in declaration
// order, so the offer is region — and, crucially, it is stable across renders.
assert_(/clearFilter_\('region'\)/.test(els.filterWarn.innerHTML),
        "and offers the single filter whose removal reopens the widest view");
assert_(/see 2 people/.test(els.filterWarn.innerHTML), "naming how many it would bring back");

// Zero-scope regions are offered but disabled rather than removed.
resetFilters();
C.STATE.team = "Cygnus";
C.buildFilters_();
var regionChips = els.regionChips.children.map(function (c) { return c.className + ":" + c.textContent; });
assert_(regionChips.some(function (s) { return /off:AMER 0/.test(s); }),
        "a region with nobody under the other filters renders disabled with its zero count");
assert_(regionChips.some(function (s) { return /EMEA 2/.test(s) && !/off/.test(s); }),
        "and a region that does have people renders live with its headcount");
resetFilters();

// ── 9. Standard rate — the operating norm ───────────────────
var few = C.standardRate_([70, 71, 72, 70]);
assert_(few.ok === false && few.minN === 5,
        "fewer than 5 complete periods yields NO rate, and says how many it needs");
assert_(few.n === 4, "and reports how many it has");
assert_(C.standardRate_([70, null, 71, null, 72, 70, 71]).n === 5,
        "nulls are skipped, not counted as zero");

var flat = C.standardRate_([70, 70, 70, 70, 70, 70]);
assert_(flat.baseline === 70, "a flat series has its own value as the baseline");
assert_(flat.hi - flat.baseline === 2 && flat.baseline - flat.lo === 2,
        "the band never narrows below ±2 pts — a flat run must not flag every 1-pt wobble");

// Robustness is the whole reason for median+MAD: one broken export week must not
// move the rate everything else is judged against.
var clean = C.standardRate_([70, 71, 69, 70, 72, 70]);
var withOutlier = C.standardRate_([70, 71, 69, 70, 72, 70, 3]);
assert_(Math.abs(withOutlier.baseline - clean.baseline) <= 1,
        "a single 3% week barely moves the median baseline (a mean would collapse it)");
assert_(withOutlier.verdict === "below", "and that week is correctly called below normal");

var above = C.standardRate_([60, 61, 59, 60, 61, 85]);
assert_(above.verdict === "above", "a latest point over the band reads as above normal");
assert_(C.standardRate_([60, 61, 59, 60, 61, 60]).verdict === "normal",
        "an ordinary latest point reads as normal — not as a miss");

// Run detection: consecutive periods on one side of the median is a SHIFT, and
// is the thing worth escalating rather than any single period. Median here is
// (62+70)/2 = 66, so the last four points are all strictly below it.
var SHIFT_SERIES = [70, 71, 72, 73, 62, 61, 60, 59];
var shifted = C.standardRate_(SHIFT_SERIES);
assert_(shifted.baseline === 66, "even-length series take the mean of the two middle values");
assert_(shifted.run === 4 && shifted.side === -1,
        "four consecutive periods below the median are reported as a run, with its direction");
assert_(shifted.verdict === "normal",
        "and the run is detected even while the latest point still sits INSIDE the band — " +
        "a sustained drift is invisible to a band test alone, which is why both exist");
assert_(C.standardRate_([60, 62, 64, 66, 68, 70]).slope > 1.5,
        "a rising series reports a positive pts-per-period slope");
assert_(C.standardRate_([70, 68, 66, 64, 62, 60]).slope < -1.5, "and a falling one negative");

// Gating: three ways the rate must refuse to publish.
fresh(histModel({}));
var s6 = [70, 71, 69, 70, 72, 70];
assert_(C.stdFor_(s6, { publish: true }) !== null, "a publishable metric gets its rate");
assert_(C.stdFor_(s6, { publish: false }) === null,
        "a metric below its coverage gate gets NO operating rate — it would be the average of a measurement error");
C.getModel()._stale = true;
assert_(C.stdFor_(s6, { publish: true }) === null,
        "a stale model gets no operating rate either (NFR-7) — the window can't be dated");
delete C.getModel()._stale;

// ── 9b. The operating rate's WEEKLY FALLBACK on the Quarter view ───────────
// metricSeries_'s own doc comment: the export window holds far more complete
// WEEKS than complete fiscal QUARTERS, so a norm built on the displayed
// (quarterly) unit could never reach the 5-period minimum — the fallback
// exists so the feature isn't simply missing exactly where an executive is
// most likely to look. Untested until now: nothing walked STATE.period to
// "quarter" and inspected metricSeries_'s std.basis/displayUnit.
(function () {
  // A dedicated fixture: 12 COMPLETE weeks (enough for the weekly minimum of
  // 5) grouped into 3 COMPLETE quarters (short of the SAME minimum on the
  // quarterly basis) — the exact shape metricSeries_'s own comment describes
  // ("52 weeks … only 3 complete fiscal quarters"). histModel's single
  // partial "now" quarter can't stand in for this: an ALL-empty done-quarters
  // list never even reaches the fallback branch (metricConfidence_ on a
  // zero-week window fails closed before stdFor_ gets a chance to fall back),
  // which would test the wrong thing.
  var QWEEKS = ["2026.W20", "2026.W21", "2026.W22", "2026.W23",
                "2026.W24", "2026.W25", "2026.W26", "2026.W27",
                "2026.W28", "2026.W29", "2026.W30", "2026.W31"];
  var qwk = {};
  QWEEKS.forEach(function (iso) { qwk[iso] = week(); });   // 75% util every week
  var mQ = model({});
  mQ.people = [person("Ana Perez", { weeks: qwk })];
  mQ.meta.gridWeeks = QWEEKS.map(function (iso) { return { iso: iso, status: "done" }; });
  mQ.meta.trendWeeks = QWEEKS;
  mQ.meta.headlineIso = QWEEKS[QWEEKS.length - 1];
  mQ.meta.periods = { quarter: [
    { key: "Q1", label: "Q1", status: "done", partial: false, isos: QWEEKS.slice(0, 4) },
    { key: "Q2", label: "Q2", status: "done", partial: false, isos: QWEEKS.slice(4, 8) },
    { key: "Q3", label: "Q3", status: "done", partial: false, isos: QWEEKS.slice(8, 12) },
  ] };
  fresh(mQ);
  C.STATE.period = "quarter";
  var doneQ = C.donePeriods_();
  assert_(doneQ.length === 3,
          "sanity: the fixture's Quarter view has 3 COMPLETE quarters — fewer than the 5-period " +
          "minimum, but not zero, so the fallback has something real to fall back FROM");
  var serQ = C.metricSeries_(C.METRICS_.util, doneQ);
  assert_(serQ.std && serQ.std.ok,
          "the operating band still publishes on the Quarter view — the POSITIVE case, since a " +
          "missing fallback would silently read as 'no operating rate here', not an error");
  assert_(serQ.std.basis === "week",
          "…by falling back to the WEEKLY series specifically, not just publishing SOME rate");
  assert_(serQ.std.displayUnit === "quarter",
          "…and the fallback is LABELLED with the view it stood in for — an unlabelled change of " +
          "basis would be worse than no rate at all (metricSeries_'s own stated rule)");

  // Negative companion: the Week view is the fallback's OWN basis — it must
  // never claim to have fallen back to itself.
  C.STATE.period = "week";
  var doneW = C.donePeriods_();
  var serW = C.metricSeries_(C.METRICS_.util, doneW);
  assert_(serW.std && serW.std.ok, "sanity: the Week view publishes its own operating rate directly");
  assert_(serW.std.basis === undefined,
          "…with NO basis tag at all — the Week view IS the weekly basis, not a fallback onto it");
  C.STATE.period = "week";
})();

// ── 10. Charts carry labels ─────────────────────────────────
// The user's complaint that started this: "charts with no labels tells nothing."
fresh(histModel({}));
var hb = C.hbarChart_({
  rows: [{ key: "AMER", label: "AMER", value: 73, n: 12 },
         { key: "EMEA", label: "EMEA", value: 44, n: 8 },
         { key: "SEA", label: "SEA", value: null, n: 3 }],
  target: { green: 70, amber: 50 } });
assert_(/✔ 73%/.test(hb), "a bar at or above target carries the ✔ glyph beside its value");
assert_(/✖ 44%/.test(hb), "and one below the amber floor carries ✖ — status is never colour alone");
assert_(/no measurable data/.test(hb), "a category with nothing measurable says so, and shows no bar");
assert_(/target 70%/.test(hb), "the target rule is labelled");
assert_(/>0%<\/text>/.test(hb) && />100%<\/text>/.test(hb),
        "the axis runs 0–100 — a percentage bar that doesn't start at zero is a lie");
// The bars are READ-ONLY (user 2026-08-03): filtering lives in the header
// controls only, so scope has one home rather than two.
assert_(!/onclick/.test(hb), "bars carry no click handler");
assert_(!/click to filter/.test(hb), "…and no tooltip promising one");
assert_(/<title>AMER — 73%/.test(hb), "…while the informational tooltip survives");
// The bar chart is width-capped, which is what caps its rendered height: an
// uncapped 100%-wide SVG multiplies its viewBox height by the container width.
assert_(/class="chart hbar"/.test(hb),
        "horizontal bars carry the width-capped class — height grows with row count, and an " +
        "uncapped 100%-wide SVG multiplies that growth by the container width too");

// Row cap (user report 2026-08-03: the PM breakdown drew 52 bars, several screens deep).
var many = [];
for (var i = 0; i < 30; i++) {
  many.push({ key: "P" + i, label: "PM " + i, value: 100 - i * 2, n: 2 });  // best first
}
many.push({ key: "PN", label: "PM null", value: null, n: 1 });
var capped = C.hbarChart_({ rows: many, target: { green: 70, amber: 50 },
                            onExpand: "toggleCompareAll_()" });
var drawn = (capped.match(/class="barfill"/g) || []).length;
assert_(drawn === 12, "at most 12 bars are drawn (" + drawn + ")");
assert_(/18 nearer target and 1 with no measurable data not shown/.test(capped),
        "and the chart says exactly what it left out");
// A cap you can't lift turns "too long to read" into "the data isn't there".
assert_(/Show all 31/.test(capped), "…with a one-click way to see the whole list");
var expanded = C.hbarChart_({ rows: many, target: { green: 70, amber: 50 },
                              expanded: true, onExpand: "toggleCompareAll_()" });
assert_((expanded.match(/class="barfill"/g) || []).length === 30,
        "expanded draws every category that has a value");
assert_(/Show top 12/.test(expanded), "…and offers the way back");
// Which 12 survive is the whole point: taking the head of a best-first list
// would have shown the healthiest and hidden every problem.
assert_(/PM 29/.test(capped) && !/PM 0</.test(capped),
        "the WORST performers are kept, not the first rows of the list");
assert_(/with no measurable data/.test(capped), "no-data categories are counted separately, not ranked");
var small = C.hbarChart_({ rows: many.slice(0, 5), target: { green: 70, amber: 50 } });
assert_(!/not shown/.test(small), "no truncation note when everything fits");

var sp = C.sparkHtml_([60, 65, 70], { labels: ["2026.W29", "2026.W30", "2026.W31"],
                                      std: C.standardRate_([60, 62, 65, 68, 70, 70]) });
assert_(/2026\.W29/.test(sp) && /2026\.W31/.test(sp),
        "even the tile micro-chart says which periods it spans");
assert_(/class="val"/.test(sp), "and labels its last value");
assert_(/operating rate/.test(sp), "with the norm band explained on hover");

// ── 11. Tab routing + role gate ─────────────────────────────
fresh(histModel({}));
resetFilters();
C.switchView_("actions");
assert_(els.viewActions.style.display === "" && els.viewExec.style.display === "none",
        "switching view shows exactly one pane");
// Motion (spec §7): the shown pane carries paneIn for the cross-fade, and no
// stale copy is left on a pane that's no longer showing.
assert_(/\bpaneIn\b/.test(els.viewActions.className), "the shown pane carries paneIn");
assert_(!/\bpaneIn\b/.test(els.viewExec.className), "a hidden pane does not carry paneIn");
// 🌊 Flow retired 2026-08-05 (§4.1); People + Data Hygiene retired 2026-08-05
// (Task 3, §5). 🧭 Workforce joined 2026-08-10 and 🗓 PM 2026-08-11 — five tabs:
// Executive, Actions, Workforce, PM, Access.
assert_(els.tabBar.children.length === 5, "an admin sees all five tabs");
C.switchView_("exec");
assert_(els.viewExec.style.display === "" && els.viewActions.style.display === "none",
        "and switching back hides the other");
assert_(/\bpaneIn\b/.test(els.viewExec.className) && !/\bpaneIn\b/.test(els.viewActions.className),
        "…and paneIn moves with it — re-entering a pane restarts the cross-fade, not a stale class");
var mdlV = fresh(histModel({}));
mdlV.viewerRole = "viewer";
C.switchView_("exec");
// Viewer sees Executive, Actions, Workforce and PM — everything but 🔒 Access.
assert_(els.tabBar.children.length === 4, "a viewer does not get the Access tab");
C.switchView_("access");
assert_(C.STATE.view === "exec",
        "and asking for it by id lands on the default view — the gate is in the router, not the tab bar");
fresh(histModel({}));

// Dead deep-link ids fall back to the default view (spec §3).
C.setState("view", "exec");
C.switchView_("hygiene");                       // dead id → falls back to exec
assert_(C.STATE.view === "exec", "unknown view id falls back to exec");

// ── 12. Actions tab = the signals roster (+ hygiene) ──
// The history line chart was deleted (user 2026-08-03), and the standalone
// "Where the headroom is" table was retired (user 2026-08-05): the 👥 roster
// covers the same people with the same exclusions, and the recoverable-hours
// figure lives on the Executive pulse.
C.STATE.period = "week"; C.STATE.metric = "util";
resetFilters();
C.switchView_("actions");
assert_(document.getElementById("trendPanel").innerHTML === "",
        "no trend chart panel is rendered any more");
assert_(!els.oppPanel || els.oppPanel.innerHTML === "",
        "no headroom/opportunity panel is rendered any more (retired 2026-08-05)");
assert_(/People signals/.test(els.rosterPanel.innerHTML),
        "the tab leads with the 👥 signals roster");

// ── 13. Recoverable hours (oppRows_) ────────────────────────
// The rendering home is the Executive pulse; the exclusion rules live in
// oppRows_ and are pinned here at data level.
fresh(histModel({}));
resetFilters();
var done13 = C.donePeriods_();
var head13 = done13[done13.length - 1];
var ser13 = C.metricSeries_(C.METRICS_.util, done13);
assert_(ser13.std && ser13.std.ok, "sanity: the history fixture establishes an operating rate");
var norm13 = ser13.std.baseline;
var rows13 = C.oppRows_(head13, norm13);
var cleo = rows13.filter(function (r) { return r.name === "Cleo Diaz"; })[0];
assert_(!!cleo && cleo.opp > 0,
        "the chronically-low person carries recoverable hours against the cohort operating rate");
assert_(rows13.every(function (r) { return r.opp >= 0; }),
        "opportunity is floored at zero — someone above the norm is carrying it, not owed a negative");

// A ramping new hire comes back FLAGGED, so the pulse can exclude them from
// its recoverable total.
var ramp = fresh(histModel({}));
ramp.people.push(histPerson("Eve Kim", { region: "AMER", teams: ["Atlas"], newHire: true,
                                         hired: "2026-07-01" }, [10, 10, 10, 10, 10, 10, 10, 10]));
var eve = C.oppRows_(head13, norm13).filter(function (r) { return r.name === "Eve Kim"; })[0];
assert_(!!eve && eve.ramping === true,
        "a ramping new hire still gets a row, flagged — ramping is the explanation, not headroom");

// On leave is an absence, not headroom.
var leave = fresh(histModel({}));
leave.people.push(histPerson("Fay Lund", { region: "AMER", teams: ["Atlas"], onLeave: true,
                                           leaveStatus: "Parental leave" }, [0, 0, 0, 0, 0, 0, 0, 0]));
assert_(C.oppRows_(head13, norm13).every(function (r) { return r.name !== "Fay Lund"; }),
        "someone on long leave is absent entirely — no availability is expected");

// ── 14. Legends are controls ────────────────────────────────
// RETIRED (Task 3, 2026-08-05): this section asserted on the People grid's
// own attention-line/bar-legend markup (renderGrid_ → #gridPanel), which was
// deleted along with the People tab. STATE.flag/toggleFlag_ and the
// filteredPeople_ narrowing they drive still exist for the roster that
// replaces the grid (Task 5) — only the grid-rendering assertions are gone.
resetFilters();

// ── 14b. STATE.flag narrowing — pinned rendering-free (review finding,
// 2026-08-05). Removing the grid removed the flag chips' only UI entry
// point, but passesFilters_'s `skip !== "flag" && STATE.flag && !hasFlag_`
// branch is still live code (Task 5 re-wires a UI onto it) — without this
// block nothing in the suite ever sets STATE.flag to a truthy value, so the
// branch would go completely unverified.
(function () {
  var mdl = fresh(histModel({}));
  resetFilters();
  var hi = mdl.meta.headlineIso;
  // Give Ana Perez alone a "zero tracked" week (full capacity, nothing
  // logged) — the rest of the fixture keeps its normal tracked hours, so
  // exactly one person trips FLAG_LABELS.zero and the narrowing is provable.
  mdl.people[0].weeks[hi] = week({ tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0,
                                    nsBillRaw: 0, nsNonBillRaw: 0 });
  delete mdl._exCache;   // exceptionsOf_ memoizes per model load — drop the stale cache
  var before = C.filteredPeople_().length;
  assert_(before === mdl.people.length, "sanity: no flag set yet, nobody is filtered out");
  C.setState("flag", "zero");
  var narrowed = C.filteredPeople_();
  assert_(narrowed.length === 1 && narrowed[0].name === "Ana Perez",
          "STATE.flag=\"zero\" narrows to the one person exceptionsOf_ flags zero-tracked");
  C.setState("flag", "");
  assert_(C.filteredPeople_().length === before,
          "clearing STATE.flag restores the full population");
})();
resetFilters();

// ══════════════════════════════════════════════════════════════════════════
// 15. METRICS-DICTIONARY CONFORMANCE (2026-08-03)
// Each of the four rates now computes what the Dictionary says it computes.
// These assertions exist so a future "simplification" cannot quietly walk one
// of them back to the old reading while keeping the old label.
// ══════════════════════════════════════════════════════════════════════════
// Utilization is off in the shipped dashboard; the Dictionary-conformance
// rules below still apply to its retained builder, so this fixture renders
// with the flag on (see withUtilization_).
var dict = withUtilization_(function () { return tiles(model({ otCov: 0.95, fcCov: 0.92 })); });

// ── Utilization: gross denominator is THE rate — no absence modelling ──
// (user decision 2026-08-04: no absenteeism of any kind; time off tracked in
// Tempo is simply non-billable, capacity is never reduced for absence.)
assert_(/of scheduled capacity/.test(dict),
        "utilization headline divides by scheduled capacity (headcount × standard hours)");
assert_(!/of net available/.test(dict) && !/pts absence/.test(dict),
        "no net-of-absence companion — absenteeism is not modelled (2026-08-04)");
assert_(/billable vs non-billable only/.test(dict),
        "the card states the two-way classification rule");
var offModel = model({ otCov: 0.95, fcCov: 0.92 });
offModel.people.forEach(function (p) {
  Object.keys(p.weeks).forEach(function (iso) {
    // 8h of tracked time off inside a 40h tracked week: capacity stays 40
    // (gross), the 8h is non-billable BY RULE, NS classifies the other 32h
    // as 24b/8nb — so billable 24, non-billable 16, everything classified.
    Object.assign(p.weeks[iso], { avail: 40, availCov: 40, cap: 40, capCov: 40,
                                  tracked: 40, trackedOff: 8, trackedCov: 40,
                                  billable: 24, nonBillable: 16 });
  });
});
var withOff = withUtilization_(function () { return tiles(offModel); });
// 24 ÷ 40 = 60% gross — the only rate published.
assert_(/class="big[^"]*">60%/.test(withOff),
        "gross is the published number: 24h billable ÷ 40h scheduled = 60%");
assert_(!/pts absence/.test(withOff) && !/PTO\/holiday removed/.test(withOff),
        "no absence framing anywhere on the utilization card");

// ── Forecast: the Dictionary mean, not the band ──
// The fixture's absVars are [0.05, 0.4, 0.9] → accuracy 0.95, 0.6, 0.1 → 55%.
assert_(/mean accuracy over/.test(dict), "forecast headline is the mean-accuracy form");
var fcCard = dict.split("Forecast Accuracy")[1].split("</div></div>")[0];
assert_(/class="big[^"]*">55%/.test(fcCard),
        "mean of (1 − |A−E|/E) over 0.05/0.4/0.9 = 55%");
assert_(/inside ±10%/.test(fcCard),
        "the ±10% band survives as a companion rather than being deleted");
assert_(/Median absolute variance/.test(fcCard), "so does the median absolute variance");

// ── Quality / Rework: built, not a placeholder ──
assert_(!/data pending — reopen\/CSAT feed not yet connected/.test(dict),
        "the Quality tile is no longer a placeholder");
var qCard = dict.split("Quality / Rework")[1].split("</div></div>")[0];
assert_(/class="big[^"]*">25%/.test(qCard), "rework rate = 2 of 8 delivered = 25%");
assert_(/2 of 8 delivered items needed rework/.test(qCard), "…with its denominator stated");
assert_(/1 rework-linked/.test(qCard) && /1 reopened .of 8 checked/.test(qCard),
        "both signals reported separately, with reopen coverage");
assert_(/CSAT companion not connected/.test(qCard),
        "the Dictionary's CSAT companion is declared absent rather than omitted");

// LOWER IS BETTER. 25% against a ≤5% target must read as bad, and the target
// comparison must use ≤ — this is the assertion that catches an inverted metric
// being coloured like a normal one.
assert_(/class="tgt"[^>]*>target ≤5%</.test(qCard), "rework compares against a CEILING, not a floor");
assert_(/class="big r"/.test(qCard), "25% against a ≤5% target is RED");
var goodQ = model({ otCov: 0.95, fcCov: 0.92 });
goodQ.reworkBuckets = WEEKS.map(function (iso) {
  return { iso: iso, person: "Ana Perez", nDelivered: 100, nRework: 3,
           nLinked: 3, nReopened: 0, nReopenCov: 100 };
});
var goodTiles = tiles(goodQ);
var goodCard = goodTiles.split("Quality / Rework")[1].split("</div></div>")[0];
assert_(/class="big g"/.test(goodCard), "3% against a ≤5% target is GREEN, not red");

// Reopens unmeasured → the rate is a floor, and the card has to say so.
var linkOnly = model({ otCov: 0.95, fcCov: 0.92 });
linkOnly.reworkBuckets = WEEKS.map(function (iso) {
  return { iso: iso, person: "Ana Perez", nDelivered: 8, nRework: 1,
           nLinked: 1, nReopened: 0, nReopenCov: 0 };   // changelog off
});
var lo = tiles(linkOnly);
var loCard = lo.split("Quality / Rework")[1].split("</div></div>")[0];
assert_(/Reopens NOT measured/.test(loCard), "an unmeasured reopen signal says so (context tooltip)");
assert_(/lower bound, not a measurement/.test(loCard),
        "…and the card states the rate is an understatement, not a result");

// A pre-v10 cached payload has no reworkBuckets at all: that is a stale schema,
// not an empty period, and must not read as 0% rework.
var preV10 = model({ otCov: 0.95, fcCov: 0.92 });
delete preV10.reworkBuckets;
var stale10 = tiles(preV10);
assert_(/rework feed not in this payload/.test(stale10),
        "a pre-v10 payload says the feed is missing rather than reporting 0% rework");
assert_(!/class="big[^"]*">0%/.test(stale10.split("Quality / Rework")[1] || ""),
        "…and prints no number at all");

// ── On-Time keeps its own scope label ──
assert_(/resolved/.test(dict.split("On-Time Delivery")[1]), "on-time card still names its scope");

// ══════════════════════════════════════════════════════════════════════════
// 16. EVERY PERSON IS IN A BAR (user-reported 2026-08-03)
//
// "Charts in the executive do not show all records! we are missing PMs, and
// Teams." Team and PM are membership LISTS, and an empty list belonged to no
// bucket — so anyone with no team or no PM contributed to no bar and vanished,
// with nothing on screen saying the chart described a subset.
// ══════════════════════════════════════════════════════════════════════════
var untagged = fresh(histModel({}));
untagged.people.push(
  histPerson("Omar Reyes",  { region: "AMER", teams: [], pms: [] }, [60, 60, 60, 60, 60, 60, 60, 60]),
  histPerson("Pia Lindqvist", { region: "EMEA", teams: ["Cygnus"], pms: [] }, [70, 70, 70, 70, 70, 70, 70, 70]),
  histPerson("Quinn Bauer", { region: "SEA", teams: [], pms: ["Ann Cho"] }, [55, 55, 55, 55, 55, 55, 55, 55])
);
resetFilters();
C.STATE.period = "week";

// The regression itself: every dimension must account for every person.
["region", "team", "pm", "family"].forEach(function (dim) {
  var o = C.optionsFor_(dim);
  var covered = {};
  o.live.forEach(function (val) {
    C.getModel().people.forEach(function (p) {
      if (C.passesFilters_(p, dim) && C.dimMatch_(p, dim, val)) covered[p.name] = 1;
    });
  });
  assert_(Object.keys(covered).length === C.filteredPeople_().length,
          dim + ": every person in scope lands in at least one bucket — a breakdown " +
          "that omits people describes a smaller org than the one you have");
});

var teamOpts = C.optionsFor_("team");
var pmOpts = C.optionsFor_("pm");
assert_(teamOpts.live.indexOf("(No team)") !== -1, "an explicit (No team) bucket exists");
assert_(pmOpts.live.indexOf("(No PM)") !== -1, "…and an explicit (No PM) bucket");
assert_(teamOpts.counts["(No team)"] === 2, "2 people carry no team (Omar, Quinn)");
assert_(pmOpts.counts["(No PM)"] === 2, "2 people carry no PM (Omar, Pia)");
// Untagged is a hygiene bucket, not a team: never first in the list however big.
assert_(teamOpts.live[teamOpts.live.length - 1] === "(No team)",
        "the untagged bucket sorts LAST regardless of size — it is not a team");

// It has to be a real, selectable value or the drill-through from its bar dies.
C.STATE.team = "(No team)";
assert_(C.filteredPeople_().length === 2,
        "filtering to (No team) selects exactly the untagged people — the bar is clickable");
assert_(C.filteredPeople_().every(function (p) { return !p.teams.length; }),
        "…and selects only them");
resetFilters();

// Region and Job family are single-valued with server-side fallbacks, so they
// must NOT sprout an untagged bucket of their own.
assert_(C.optionsFor_("region").live.indexOf("(No team)") === -1 &&
        C.optionsFor_("family").live.every(function (v) { return !/^\(No /.test(v); }),
        "single-valued dimensions already fall back server-side and gain no extra bucket");

// The chart must SAY it covers everyone — the silent version is what failed.
C.switchView_("exec");
C.STATE.compare = "team";
C.renderCompare_();
var cmpTeam = els.comparePanel.innerHTML;
assert_(/all \d+<\/b> people represented/.test(cmpTeam),
        "the comparison chart states its population coverage in words");
assert_(/\(No team\)/.test(cmpTeam), "the untagged bucket is drawn as its own bar");
assert_(/is not a team/.test(cmpTeam),
        "…and the caption says it is a tag gap, not a team");
C.STATE.compare = "pm";
C.renderCompare_();
var cmpPm = els.comparePanel.innerHTML;
assert_(/\(No PM\)/.test(cmpPm), "same for PM");
// Prose: ".toLowerCase()" on the chip label produced "4 pms measurable".
assert_(!/pms/.test(cmpPm), "PM pluralises as PMs, never 'pms'");
assert_(C.cmpNoun_("family", 2) === "job families", "and job family pluralises correctly");
assert_(C.cmpNoun_("pm", 1) === "PM" && C.cmpNoun_("pm", 2) === "PMs", "PM singular/plural");
C.STATE.compare = "region";
resetFilters();

// ══════════════════════════════════════════════════════════════════════════
// 17. ONE DEFINITION PER METRIC (F1 — the comparison bars vs the cards)
//
// scopedMetric_ used to carry its own formula per metric, and all three had
// drifted from the METRICS_ accessor they shadowed. Each pair was internally
// consistent and mutually contradictory, so nothing looked broken — a Region
// bar simply disagreed with the tile above it. This is the assertion that makes
// that impossible: a bar covering EVERYONE must equal the card exactly.
// ══════════════════════════════════════════════════════════════════════════
var oneDef = fresh(histModel({}));
resetFilters();
C.STATE.period = "week";
var allIsos = C.donePeriods_().slice(-1)[0].isos;
var everyone = {};
oneDef.people.forEach(function (p) { everyone[p.name] = 1; });

Object.keys(C.METRICS_).forEach(function (id) {
  var m = C.METRICS_[id];
  if (!m.available()) return;
  var card = m.value(allIsos);
  var bar = C.scopedMetric_(m, allIsos, everyone);
  assert_(card === bar || (card === null && bar === null),
          id + ": a bar over the whole population equals the card above it (" +
          card + " vs " + bar + ") — one definition, not two");
});

// The specific bug that was invisible: quality fell through to forecastBuckets.
var q = C.METRICS_.quality, f = C.METRICS_.forecast;
assert_(C.scopedMetric_(q, allIsos, everyone) !== C.scopedMetric_(f, allIsos, everyone),
        "Quality/Rework no longer returns the Forecast number under its own label");
assert_(C.scopedMetric_(q, allIsos, everyone) === q.value(allIsos),
        "…it returns the rework rate");

// A scoped bar really is scoped, and the override never leaks.
var one = {}; one[oneDef.people[0].name] = 1;
C.scopedMetric_(C.METRICS_.util, allIsos, one);
assert_(C.filteredPeople_().length === oneDef.people.length,
        "the population override is cleared after use — a leak would scope the " +
        "whole dashboard to one bar's people");
try { C.scopedMetric_({ id: "x", value: function () { throw new Error("boom"); } }, allIsos, one); }
catch (e) { /* expected */ }
assert_(C.filteredPeople_().length === oneDef.people.length,
        "…and cleared even when an accessor throws (finally, not a trailing assignment)");
resetFilters();

// ══════════════════════════════════════════════════════════════════════════
// 18. A FLOOR IS NOT A VERDICT (F2)
// 0% rework used to render in positive green — the best-looking number on the
// screen — while the card's own body said reopens are not counted. With the
// changelog off the numerator CANNOT contain reopens, so 0% means nothing was
// detected, not nothing happened. No colour, because there is no verdict.
// ══════════════════════════════════════════════════════════════════════════
function qModel(rework, reopenCov) {
  var mdl = model({ otCov: 0.95, fcCov: 0.92 });
  mdl.reworkBuckets = WEEKS.map(function (iso) {
    return { iso: iso, person: "Ana Perez", nDelivered: 100, nRework: rework,
             nLinked: rework, nReopened: 0, nReopenCov: reopenCov };
  });
  return mdl;
}
function qCardOf(mdl) { return tiles(mdl).split("Quality / Rework")[1].split("</div></div>")[0]; }

// THE bug: zero detected, changelog off.
var zeroFloor = qCardOf(qModel(0, 0));
assert_(/class="big[^"]*">0%/.test(zeroFloor), "0% is still shown — suppression is not the fix");
assert_(!/class="big g"/.test(zeroFloor),
        "0% with reopens unmeasured is NOT green — it was the healthiest-looking card on screen");
assert_(!/class="big [gar]"/.test(zeroFloor), "…and carries no RAG colour at all: a floor has no verdict");
assert_(/at least 0% — lower bound, not a measurement/.test(zeroFloor),
        "…it states plainly that the value is a lower bound");
// The threshold may still be PRINTED beside the number (it is a scale mark, not
// a claim), but no VERDICT against it: no arrow, no "n pts below target". That
// sentence is what would read as passing a target the card cannot be judged on.
assert_(!/pts (above|below) target/.test(zeroFloor) && !/on target/.test(zeroFloor),
        "…and renders no verdict against the target, which it cannot be judged against");
assert_(/Reopens NOT measured/.test(zeroFloor), "…with the reason still on the card");

// Measured, and genuinely good: colour returns.
var measuredGood = qCardOf(qModel(3, 100));
assert_(/class="big g"/.test(measuredGood),
        "3% WITH reopens measured is green — the fix removes false verdicts, not true ones");
assert_(/pts (above|below) target|on target/.test(measuredGood), "…and gets its target verdict back");

// Measured and bad still reads bad.
assert_(/class="big r"/.test(qCardOf(qModel(25, 100))), "25% measured is red");
// A high rate that is ALSO a floor stays uncoloured — the floor rule is about
// what the numerator can contain, not about whether the number looks bad.
assert_(!/class="big [gar]"/.test(qCardOf(qModel(25, 0))),
        "25% unmeasured is uncoloured too — the rule is structural, not cosmetic");

// ══════════════════════════════════════════════════════════════════════════
// 19. MARGIN TIER — HIDDEN, NOT DIMMED (F4)
// The Dictionary limits utilization and forecast-variance detail to "directs and
// above". Open access is the demo switch and used to hand every unidentified
// visitor the viewer role — and the margin numbers with it.
// ══════════════════════════════════════════════════════════════════════════
function asRole(role) {
  var mdl = fresh(model({ otCov: 0.95, fcCov: 0.92 }));
  mdl.viewerRole = role;
  C.renderFlow_(); C.renderPulse_();
  return flowHtml_() + els.pulsePanel.innerHTML;
}
var asAdmin = asRole("admin");
var asViewer = asRole("viewer");
var asGuest = asRole("guest");

// Availability Rate joined the margin tier when it replaced Utilization
// (2026-08-17): it publishes the same scheduled-capacity hours, so it inherits
// the same Dictionary audience rule. It is the probe here because it is the
// card that actually renders in that slot now.
assert_(/Availability Rate/.test(asAdmin), "admin sees availability");
assert_(/Forecast Accuracy/.test(asAdmin), "admin sees forecast");
assert_(/Availability Rate/.test(asViewer),
        "a NAMED viewer is a direct and stays in the margin tier");

// The gate: absent from the DOM, not greyed. A dimmed number is still a number
// on a projector, and "greyed out" invites someone to ask what it says.
assert_(!/Availability Rate/.test(asGuest), "a guest does not see availability AT ALL");
assert_(!/Utilization/.test(asGuest), "…nor utilization");
assert_(!/Forecast Accuracy/.test(asGuest), "…nor forecast accuracy");
// Scoped to TILE-LEVEL dimming markers (2026-08-17). The old pattern matched
// the bare word "opacity" anywhere in the string, which meant any SVG that
// legitimately paints something at partial alpha — the operating-rate band, and
// now the target rule on the sparkline (review item #2) — read as a dimmed
// tile. The rule being defended is about the CARD: a gated metric must not
// render as a greyed-out card, so the check looks for the things that would
// make one (the ph placeholder shell, a CSS opacity style, a disabled control)
// rather than for a substring that a chart happens to share.
assert_(!/class="tile ph"|style="[^"]*opacity|disabled/.test(asGuest.split("Quality")[0] || ""),
        "…and they are omitted from the string, not rendered-then-dimmed");
// The two non-margin metrics still answer their questions for everyone.
assert_(/On-Time Delivery/.test(asGuest), "a guest still sees On-Time");
assert_(/Quality \/ Rework/.test(asGuest), "…and Quality/Rework");
// The retained utilization card obeys the SAME gate when switched back on —
// checked directly, so the tier rule cannot rot while the card is off.
withUtilization_(function () {
  assert_(/Billable Utilization|Capacity Utilization/.test(asRole("admin")),
          "with utilization switched on, an admin sees it");
  assert_(!/Utilization/.test(asRole("guest")),
          "…and a guest still does not — the margin gate is not the feature flag");
});

// The metric must leave every chip strip and comparison chart too, or the guest
// can select a hidden metric and read it off the bars instead.
C.setModel(fresh(model({}))); C.getModel().viewerRole = "guest";
assert_(C.liveMetrics_().indexOf("util") === -1 && C.liveMetrics_().indexOf("forecast") === -1,
        "hidden metrics are not offered in the metric chips or the comparison chart");
assert_(C.liveMetrics_().length >= 1, "…but the chart still has something to show");
assert_(!C.canSeeMargin_(), "guest is out of tier");
C.getModel().viewerRole = "admin";
assert_(C.canSeeMargin_() && C.liveMetrics_().indexOf("forecast") !== -1,
        "admin gets the margin metrics back");
// util has TWO independent gates now — tier AND feature flag — and these say
// which is which, so a future edit cannot collapse them into one.
assert_(C.liveMetrics_().indexOf("util") === -1,
        "…but NOT utilization: that is off by feature flag, not by tier");
withUtilization_(function () {
  assert_(C.liveMetrics_().indexOf("util") !== -1,
          "…it returns for an admin the moment the flag flips");
  C.getModel().viewerRole = "guest";
  assert_(C.liveMetrics_().indexOf("util") === -1,
          "…while the flag alone never lets a guest past the margin tier");
  C.getModel().viewerRole = "admin";
});

// The Actions tab carries per-person utilization by construction — same tier.
var actionsView = C.VIEWS.filter(function (v) { return v.id === "actions"; })[0];
assert_(actionsView.roles && actionsView.roles.indexOf("guest") === -1,
        "the Actions tab is role-gated like Access");
C.getModel().viewerRole = "guest";
C.switchView_("actions");
assert_(C.STATE.view !== "actions",
        "…and asking for it by id lands elsewhere — the gate is in the router, not the tab bar");
C.getModel().viewerRole = "admin";
C.switchView_("exec");

// ══════════════════════════════════════════════════════════════════════════
// 20. THE ASSIGNEE GAP WAS TWO GAPS (2026-08-03, from real-export profiling)
// 94% of resolved issues carry an assignee; only ~54% of those joined the
// roster. Reported as ONE "unattributed" number it read as a Jira hygiene
// failure and went to the Jira admin queue, where there was nothing to fix.
// The split fixed that. The second half — the roster join — was repaired on
// 2026-08-04, sat retired at 100%, and was DELETED on 2026-08-17.
// What this section pins now: the FIRST half is still published on its own
// terms, and it still divides by the population it names. Merging the two back
// into one "unattributed" figure is the regression to prevent, and it would
// look exactly like a simplification.
// ══════════════════════════════════════════════════════════════════════════
// Asserted against the DEFINITIONS, not a rendered table: the gaps queue was
// deleted on 2026-08-17, but gapsRows_ still feeds the trust strip, the
// masthead's gates finding and the shelf, so the split is still load-bearing —
// it just no longer has a table of its own to be read in.
C.setModel(model({}));
var gaps2 = C.gapsRows_(C.hygieneFor_(["2026.W31"]), C.hygienePeopleFor_(["2026.W31"]));
var gapNames2 = gaps2.map(function (g) { return g.name; }).join(" | ");
var gapText2 = gaps2.map(function (g) {
  return [g.name, g.detail || "", g.note || "", g.blocks || ""].join(" ");
}).join(" | ");
assert_(/Resolved work carries a Jira assignee/.test(gapNames2),
        "gap 1: does the issue have an assignee at all");
assert_(!/and that assignee resolves to a roster person/.test(gapNames2),
        "gap 2 (the roster join) is deleted, not merely retired — user decision 2026-08-17");
var assignedGap = gaps2.filter(function (g) {
  return /Resolved work carries a Jira assignee/.test(g.name);
})[0];
assert_(assignedGap && Math.round(assignedGap.value * 100) === 94, "…47 of 50 carry an assignee");
assert_(!/unattributed/i.test(gapText2),
        "…and the surviving row never reverts to the pooled 'unattributed' wording that " +
        "sent a name-matching problem to the Jira admin queue");
// The due-date row must name the population it measures, not say "delivery work"
// when the scope is epics.
assert_(/Due date on the work On-Time measures/.test(gapNames2),
        "the due-date row names its own population");
assert_(!/Due date on resolved delivery work/.test(gapNames2),
        "…and no longer says 'delivery work' while measuring epics");

// ══════════════════════════════════════════════════════════════════════════
// 21. NO CLASSIFICATION-COVERAGE NARRATION ON THE UTILIZATION CARD
// (user 2026-08-05: data-quality noise). Unclassified person-weeks still leave
// both sides of the rate; the 🔍 Data trust strip and the gaps queue carry the
// coverage read now, so the card itself stays clean even under partial
// classification.
// ══════════════════════════════════════════════════════════════════════════
var covUtilModel = model({});
covUtilModel.people[1].weeks["2026.W31"].trackedCov = 20;
var covUtilCard = tiles(covUtilModel).split("Billable Utilization")[1] || "";
assert_(!/classification covers/.test(covUtilCard),
        "no classification-coverage warning on the card (user 2026-08-05)");
assert_(!/below gate — directional only/.test(covUtilCard),
        "no below-gate caveat on the card either — the trust strip carries the gate");

// ══════════════════════════════════════════════════════════════════════════
// 22. oppRows_ + util COVERAGE ACCESSOR AGREE WITH utilFor_
// oppRows_ aggregates a person's hours via aggWeeks_; METRICS_.util.coverage
// aggregates via utilFor_. Both must report the SAME numbers for the same
// weeks, including a defaulted-capacity (capEst) week, which counts normally
// in real mode (no WHAT-IF filtering exists any more).
// ══════════════════════════════════════════════════════════════════════════
var oppModel = fresh(model({}));
// A single-period month spanning both fixture weeks.
oppModel.meta.periods = {
  month: [{ key: "2026-07", label: "Jul 2026", status: "done", partial: false, isos: WEEKS }],
};
// Ana Perez's W30 is a defaulted-capacity week AND under-bills relative to her
// W31 week, so the number is computed from the fixture, not eyeballed.
oppModel.people[0].weeks["2026.W30"] = week({
  billable: 20, nonBillable: 20, nsBillRaw: 20, nsNonBillRaw: 20, capEst: true,
});
C.STATE.period = "month";
resetFilters();
var doneOpp = C.donePeriods_();
var anaReal = C.oppRows_(doneOpp[doneOpp.length - 1], null)
  .filter(function (r) { return r.name === "Ana Perez"; })[0];
// Both weeks count — availCov 40+40=80, billable 20+30=50 → 62.5%.
assert_(!!anaReal && anaReal.den === 80 && Math.abs(anaReal.rate - 62.5) < 1e-9,
        "Ana's capEst week still counts (80h avail, 62.5% rate)");
C.STATE.period = "week";

// METRICS_.util.coverage: the measured tracked/trackedCov ratio. Fixture:
// Ana's W30 tracked hours are only half-classified (trackedCov 20 of 40), so
// the ratio is (20 + 40 + 40 + 40) / (40*4) = 140/160 = 0.875.
var covModel = fresh(model({}));
covModel.people[0].weeks["2026.W30"].trackedCov = 20;
var covReal = C.METRICS_.util.coverage(WEEKS);
assert_(Math.abs(covReal - 0.875) < 1e-9, "coverage is the measured tracked/trackedCov ratio (0.875)");

// ══════════════════════════════════════════════════════════════════════════
// 23. WHOLE-ROSTER ATTRIBUTION (2026-08-04)
// attribOnly stubs join buckets to the KPI cards without ever entering the
// grid, the headcounts or the dropdowns.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
var baseOt27 = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
var stubModel = model({});
stubModel.people.push({ name: "Sol Architect", region: "SEA", teams: [], pms: [],
                        isCrew: false, jobTitle: "", onLeave: false, isManager: false,
                        jobFamily: "", tracks: false, newHire: false, backlog: null,
                        weeks: {}, attribOnly: true });
stubModel.onTimeBuckets = stubModel.onTimeBuckets.concat(
  WEEKS.map(function (iso) { return { iso: iso, person: "Sol Architect", n: 10, onTime: 10, nAll: 10 }; }));
fresh(stubModel);
assert_(C.filteredPeople_().every(function (p) { return p.name !== "Sol Architect"; }),
        "attribOnly stub excluded from the operational population (grid/scope/CSV)");
var stubOt = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
assert_(stubOt.n === baseOt27.n + 20 && stubOt.onTime === baseOt27.onTime + 20,
        "…but the stub's BUCKETS count in the KPI aggregation under the default lens");
assert_((C.optionsFor_("family").counts["Uncatalogued"] || 0) === 0,
        "stub does not inflate dropdown headcounts");

// ══════════════════════════════════════════════════════════════════════════
// 24. ANALYSIS-PERIOD PICKER (user request 2026-08-04): the reader chooses
// WHICH complete period drives the tiles, comparison and roster —
// the unit chips only chose the granularity. Latest stays the default.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.buildPeriodChips_();
var pick28 = els.periodChips.children.filter(function (c) { return c.tagName === "select"; })[0];
assert_(!!pick28 && pick28.options.length === 3,
        "picker lists Latest complete + both complete weeks (weekly-fallback model included)");
// W30 gets a perfect on-time week, so re-basing is visible in the number itself
var pMod = model({});
pMod.onTimeBuckets[0].onTime = pMod.onTimeBuckets[0].n;   // 2026.W30 → 100%
fresh(pMod);
C.renderAll_();
assert_(/Last complete week · 2026\.W31/.test(els.scopeChip.innerHTML),
        "no selection → the scope chip frames the latest complete period");
var latestOt28 = flowHtml_().split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/class="big[^"]*">90%/.test(latestOt28),
        "latest window (W31) reads 90% on time — 43 of 48");
C.setState("periodIdx", 0);
C.renderAll_();
assert_(/Selected week · 2026\.W30/.test(els.scopeChip.innerHTML),
        "picker selection re-frames the scope chip as 'Selected'");
var selOt28 = flowHtml_().split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/class="big[^"]*">100%/.test(selOt28),
        "…and the numbers re-base with it (W30 fixture = 100% on time)");
assert_(!/unattributed \(export window\)/.test(flowHtml_() + els.pulsePanel.innerHTML),
        "no unattributed count on the cards (user 2026-08-05 — the trust strip carries the roster join)");
C.setState("periodIdx", null);
C.renderAll_();
assert_(/Last complete week · 2026\.W31/.test(els.scopeChip.innerHTML),
        "clearing the selection returns to the latest complete period");

// ── 28b. PERIOD-SCOPED HEADCOUNT (user report 2026-08-04: the scope chip said
// "140 people" for every window — an older period must count ITS roster, not
// today's). Pre-hire weeks are never emitted, so a W31 hire has no W30 cell.
var hireM = model({});
hireM.people.push(person("Nina New", {
  newHire: true, hired: "2026-07-28",
  weeks: { "2026.W31": week() },   // hired in W31 — no W30 cell exists
}));
fresh(hireM);
C.renderAll_();
assert_(/— 3 people/.test(els.scopeChip.innerHTML),
        "latest window (W31) counts the new hire — 3 people");
assert_(!/hired later/.test(els.scopeChip.innerHTML),
        "no hired-later note when the whole roster existed in the window");
C.setState("periodIdx", 0);   // W30 — before Nina's hire
C.renderAll_();
assert_(/— 2 people/.test(els.scopeChip.innerHTML),
        "the W30 window counts only the people who existed then");
assert_(/\(\+1 hired later\)/.test(els.scopeChip.innerHTML),
        "…and states the delta so 3 → 2 reads as a fact, not a glitch");
assert_(/all 2<\/b> people represented/.test(els.comparePanel.innerHTML),
        "the comparison's coverage sentence agrees with the period-scoped headcount");
C.setState("periodIdx", null);
C.renderAll_();

// ══════════════════════════════════════════════════════════════════════════
// 25. POP/ROLE LENS RE-CASCADES THE FILTER ROW (user report 2026-08-04:
// "filters get stuck on filtered records — does not change on FTE/Crew/All").
// The chips set STATE and re-rendered the panes, but never rebuilt the region
// counts / dropdown cascades, so the filter row kept describing the
// population the reader had just left.
// ══════════════════════════════════════════════════════════════════════════
var lensM = model({});
lensM.people.push(person("Cara Crew", { isCrew: true }));
fresh(lensM);
C.setState("pop", "fte"); C.setState("region", ""); C.setState("role", "all");
C.buildFilters_();
var fteRegions = els.regionChips.children.map(function (c) { return c.textContent; }).join("|");
C.renderAll_();
var fteTiles = flowHtml_() + els.pulsePanel.innerHTML;
els.popChips.children[1].onclick();   // click the Crew chip
var crewRegions = els.regionChips.children.map(function (c) { return c.textContent; }).join("|");
assert_(/AMER 2/.test(fteRegions), "FTE lens: two FTEs count in AMER");
assert_(/AMER 1/.test(crewRegions), "Crew chip click re-cascades the region counts (Cara only)");
assert_(fteRegions !== crewRegions, "the filter row follows the population lens");
assert_(flowHtml_() + els.pulsePanel.innerHTML !== fteTiles, "…and the tiles re-base in the same click");
els.roleChips.children[1].onclick();  // IC — must not throw, must rebuild the row
assert_(C.STATE.role === "ic" && C.STATE.pop === "crew", "role chip routes through the same rebuild");
C.setState("role", "all"); C.setState("pop", "fte");
C.buildFilters_(); C.renderAll_();

// ══════════════════════════════════════════════════════════════════════════
// COLOUR KEYS + JOB TITLES (user request 2026-08-04)
// Readers learn colours from legends, not tooltips — every coloured surface
// carries an inert key, and every roster surface names the person's job title
// (grade code stripped for reading, full roster string in the tooltip/CSV).
// ══════════════════════════════════════════════════════════════════════════
// Task 16B RETIREMENT: #tiles (the old four-card strip) and #tileColorKey
// (its colour-key legend) are gone. Checked on the raw markup, not rendered
// output, so an element that still exists but merely stays empty cannot pass.
assert_(html.indexOf('id="tiles"') === -1, "#tiles is absent from the markup (Task 16B retirement) — not merely emptied");
assert_(html.indexOf('id="tileColorKey"') === -1, "#tileColorKey is absent from the markup (Task 16B retirement)");

// THE COLOUR KEY IS DELETED OUTRIGHT (director feedback 2026-08-17). It had
// already left Health & Actions; on Backlog & Flow it explained RAG grading
// beside mostly ungraded volume metrics — reference material standing where a
// director scans for numbers. #flowKey is gone from the MARKUP, not merely
// emptied, and no rendered Executive surface prints a key. Status never
// rested on the legend: every graded card carries its own ✔/▲/✖ glyph and
// value label (FR-4.4). ragKeyHtml_ went with its last caller.
assert_(html.indexOf('id="flowKey"') === -1,
        "#flowKey is absent from the markup — the colour key's retirement is structural");
fresh(model({}));
C.getModel().viewerRole = "admin";
C.setState("view", "exec");
C.renderAll_();
assert_(!/Colour key/.test(flowHtml_() + els.masthead.innerHTML + els.backlogBand.innerHTML +
                           els.pulsePanel.innerHTML),
        "no rendered Executive surface prints a colour key");
fresh(model({}));
C.getModel().viewerRole = "admin";
C.setState("view", "exec");
C.renderAll_();

resetFilters();
C.STATE.expandedWeeks = {}; C.STATE.openDetail = {}; C.STATE.flag = "";
// The People grid's RAG-tint key went with the grid (Task 3, 2026-08-05) and
// the headroom table's gap-colour key with the headroom table (2026-08-05) —
// the job-title rule now lives on the 👥 signals roster, which names each
// person's title as a visible tag under the name (grade code stripped, full
// roster string in the tooltip).
var jtM = fresh(model({}));
jtM.personHygiene = { open: [{ person: "Ana Perez", n: 10, due: 10, est: 10, logged: 10 }],
                      resolved: [] };
C.setModel(jtM);
C.STATE.typePop = "open";
C.renderRoster_();
var ok = els.rosterPanel.innerHTML;
assert_(/>Consultant</.test(ok), "the roster names each person's job title as a visible tag");
assert_(ok.indexOf('title="09.P3.Consultant"') !== -1,
        "…with the full roster string (grade code included) in the tooltip");

fresh(model({}));
// The queue's colour key went with the table (2026-08-17). The RULE it stated —
// grade each check against ITS OWN gate, never against 100% — now has to hold on
// the trust strip, which is the surface that still paints these figures. A 90%
// gate met at 91% is green; a reader grading against 100% escalates rows that
// are already done.
C.getModel().viewerRole = "admin";
C.renderTrust_();
var trustKey = document.getElementById("trustPanel").innerHTML;
assert_(/Gate = the coverage each published metric needs/.test(trustKey),
        "the trust strip states that the bar is the gate, not 100%");
assert_(/\/ 80</.test(trustKey) || /\/ 70</.test(trustKey),
        "…and every tile prints the gate it is measured against, beside the value");

// Task 17 (Item 1): "no individual is named in the gaps queue" — the pulse
// and masthead already carry this guard elsewhere in this file; the gaps
// queue/🧬 matrix (renderHygPanel_) did not have its own. gapsRows_ is keyed
// on FIELD name over AGGREGATE hygieneBuckets/personHygiene counts, so it
// cannot name a person today by construction — the check still earns its
// place as a regression guard, stated against every name in the actual
// fixture (same idiom the pulse check already uses), so a future change
// that threads a person into the queue (a "worst offender" drill-down, say)
// trips it rather than shipping silently.
var hygFixture = fresh(model({}));
C.getModel().viewerRole = "admin";
C.renderHygPanel_();
C.renderTrust_();
var noNameHtml = els.hygPanel.innerHTML + document.getElementById("trustPanel").innerHTML;
var gapDefs = C.gapsRows_(C.hygieneFor_(WEEKS), C.hygienePeopleFor_(WEEKS))
  .map(function (g) { return [g.name, g.detail || "", g.note || ""].join(" "); }).join(" | ");
hygFixture.people.forEach(function (p) {
  assert_(noNameHtml.indexOf(p.name) === -1,
          "the gates surfaces must not name " + p.name);
  assert_(gapDefs.indexOf(p.name) === -1,
          "…and neither may the gap definitions behind them (" + p.name + ")");
});

// ══════════════════════════════════════════════════════════════════════════
// 26. INTERNS (I1) NEVER MOVE A RATE (user decision 2026-08-04): profile and
// hours stay on the roster, marked 🎓, but no published number — utilization,
// issue rates, triage flags, recoverable hours — may change on an intern's account.
// ══════════════════════════════════════════════════════════════════════════
var internM = model({});
internM.people.push(person("Ivy Intern", {
  isIntern: true, jobTitle: "09.I1.2 - Associate Consultant",
  // A week that WOULD tank the rates if it counted: zero billable, all idle.
  weeks: { "2026.W30": week({ tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0 }),
           "2026.W31": week({ tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0 }) },
}));
// …and an intern-assigned issue bucket that would drag On-Time to the floor.
internM.onTimeBuckets.push({ iso: "2026.W31", person: "Ivy Intern", n: 20, onTime: 0, nAll: 20 });
// withUtilization_ because the assertions below read the Utilisation card,
// which ships switched OFF (SHOW_UTILIZATION_). Same wrapper as every other
// block that tests that builder — added 2026-08-17, this one was missed when
// the card was switched off and the block had been asserting against "".
var internTiles = withUtilization_(function () { return tiles(internM); });
var internOt = internTiles.split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/class="big[^"]*">90%/.test(internOt),
        "an intern's 0-of-20 on-time bucket moves NOTHING — the rate stays 90%");
assert_(/1 intern excluded/.test(internTiles),
        "the utilization card states the intern exclusion out loud");
// Base fixture: 60h billable / 80h classified capacity = 75%. If Ivy's empty
// 40h counted, the headline would read 50% — the exact dilution this prevents.
var internUtil = internTiles.split("Utilization")[1].split("Quality")[0];
assert_(/class="big[^"]*">75%/.test(internUtil),
        "utilization headline stays 75% — the intern's empty capacity never dilutes it to 50%");
// Recoverable hours need the object-form gridWeeks fixture (histModel).
var internHist = fresh(histModel({}));
internHist.people.push(histPerson("Ivy Intern",
  { region: "AMER", teams: ["Atlas"], isIntern: true,
    jobTitle: "09.I1.2 - Associate Consultant" }, [0, 0, 0, 0, 0, 0, 0, 0]));
C.STATE.period = "week"; resetFilters();
var internDone = C.donePeriods_();
assert_(C.oppRows_(internDone[internDone.length - 1], null)
          .every(function (r) { return r.name !== "Ivy Intern"; }),
        "no recoverable-hours row for an intern — ranking them by 'hours that could be " +
        "recovered' is the punishment this flag prevents");

// ── DATA FRESHNESS HEADER (user request 2026-08-04) ─────────
// The header must state when the DATA was refreshed, not when the model was
// rebuilt. Those are two clocks and the warmer keeps one of them permanently
// fresh, so the failure this guards is a three-day-old export presented as
// current because generatedAt is 20 minutes old.
(function () {
  function meta_(o) {
    return Object.assign({ refreshEveryMin: 30, jiraExportStaleH: 30,
                           sources: [{ system: "Jira", feeds: "On-Time" }] }, o || {});
  }
  var built = new Date();

  // FRESH: stamp shown, informational, no warning styling.
  var fresh7h = C.dataAsOfView_(meta_({
    dataAsOf: { jira: "2026-08-04T03:00:00.000Z", jiraAgeH: 7, jiraStale: false, jiraUnknown: false },
  }), false, built);
  assert_(/Data as of/.test(fresh7h.html), "fresh export prints a Data-as-of stamp");
  assert_(/7h ago/.test(fresh7h.html), "…with the age in hours");
  assert_(fresh7h.warn === false, "a fresh export is not styled as a warning");
  assert_(/📅/.test(fresh7h.html) && !/⚠/.test(fresh7h.html), "fresh uses the calendar mark, not the warning mark");
  assert_(/age of the DATA/.test(fresh7h.title), "tooltip says this is the age of the data");

  // STALE: the export missed a run. Must warn, and must say WHY it matters.
  var stale = C.dataAsOfView_(meta_({
    dataAsOf: { jira: "2026-08-01T03:00:00.000Z", jiraAgeH: 78, jiraStale: true, jiraUnknown: false },
  }), false, built);
  assert_(stale.warn === true, "a stale export warns");
  assert_(/⚠/.test(stale.html), "…with the warning mark");
  assert_(/export may have failed/.test(stale.html), "…and names the likely cause");
  assert_(/3 days ago/.test(stale.html), "78h renders as days, not as '78h ago'");
  assert_(/trigger/.test(stale.title), "tooltip points at the export trigger");

  // UNKNOWN: no readable footer. Must NOT masquerade as a staleness warning —
  // a reader can't act on it, and a false alarm here devalues the real one.
  var unknown = C.dataAsOfView_(meta_({
    dataAsOf: { jira: null, jiraAgeH: null, jiraStale: false, jiraUnknown: true },
  }), false, built);
  assert_(/refresh time unknown/.test(unknown.html), "an unreadable stamp says so plainly");
  assert_(unknown.warn === false, "unknown is NOT a warning — absent ≠ stale");
  assert_(/probeDeliverySources/.test(unknown.title), "tooltip names the diagnostic to run");

  // THE CORE SEPARATION: a fresh model on a stale export must still read stale.
  // This is the exact deception the feature exists to prevent.
  assert_(C.dataAsOfView_(meta_({
    dataAsOf: { jira: "2026-07-28T03:00:00.000Z", jiraAgeH: 200, jiraStale: true, jiraUnknown: false },
  }), false, built).warn === true,
    "a 200h-old export warns even though the model was just rebuilt");

  // …and the converse: a stale MODEL keeps its own separate warning, alongside
  // the data age rather than replacing it. They fail independently.
  var bothBad = C.dataAsOfView_(meta_({
    dataAsOf: { jira: "2026-08-01T03:00:00.000Z", jiraAgeH: 78, jiraStale: true, jiraUnknown: false },
  }), true, built);
  assert_(/Data as of/.test(bothBad.html) && /not rebuilt since/.test(bothBad.html),
    "both clocks are reported when both are bad — one does not hide the other");
  assert_(/trend comparisons are suppressed/.test(bothBad.title),
    "the model-staleness consequence (NFR-7) survives");

  // A stale model with a HEALTHY export still reports the model problem.
  var modelOnly = C.dataAsOfView_(meta_({
    dataAsOf: { jira: "2026-08-04T03:00:00.000Z", jiraAgeH: 7, jiraStale: false, jiraUnknown: false },
  }), true, built);
  assert_(modelOnly.warn === true && /not rebuilt since/.test(modelOnly.html),
    "model staleness warns on its own");

  // Pre-v16 cached payload: no dataAsOf at all. Must render empty rather than
  // throwing or inventing a stamp — the header is above every view, so an
  // exception here is a blank dashboard.
  var legacy = C.dataAsOfView_(meta_({}), false, built);
  assert_(legacy.html === "" && legacy.warn === false,
    "a payload with no dataAsOf renders nothing and does not throw");
})();

// ── 🧬 BY-TYPE MATRIX + ROSTER JOIN: REMOVED (user decision 2026-08-17) ──────
// Both summarised compliance PER EVALUATED PARAMETER; the 👥 signals roster
// reads the same parameters per person, and a person can be asked to fix their
// tickets where an issue type cannot.
//
// The ~180 assertions that guarded the matrix's rendering went with it. What is
// left here is a REGRESSION GUARD, because a deletion needs pinning exactly like
// a feature does: a well-meaning re-add would restore a table this tab was
// deliberately cleared of, and the roster-join row in particular is the kind of
// "helpful" restoration that looks like a fix.
(function () {
  fresh(model({}));
  C.STATE.period = "week";
  C.STATE.typePop = "open";
  C.renderHygPanel_();
  var gone = els.hygPanel.innerHTML;
  assert_(!/Field fill by issue type/.test(gone), "the by-type matrix is gone from Actions");
  assert_(!/id="typeMatrix"/.test(gone), "…including its PNG capture target");
  assert_(!/resolves to a roster person/.test(gone), "the roster-join gap row is gone");
  // The gaps queue that shared this panel was itself deleted on 2026-08-17, so
  // the "still does its remaining job" check moved to the DEFINITIONS and to the
  // trust strip — asserted positively, so "everything is missing" can never pass
  // as "the right things are missing".
  var liveGaps = C.gapsRows_(C.hygieneFor_(WEEKS), C.hygienePeopleFor_(WEEKS));
  assert_(liveGaps.length > 0, "…and the gap DEFINITIONS survive the queue that drew them");
  assert_(liveGaps.some(function (g) { return /Resolved work carries a Jira assignee/.test(g.name); }),
          "…including the Jira-discipline half of the 2026-08-03 split, which was NOT removed");
  assert_(!liveGaps.some(function (g) { return g.key === "attr"; }),
          "…while the roster-join definition is gone from the list entirely");
  // The trust strip drops to three tiles and must not render an empty fourth.
  C.renderTrust_();
  var strip = els.trustPanel.innerHTML;
  assert_(!/Roster join/.test(strip), "the Roster join tile is gone from the data-trust strip");
  assert_(/Estimate coverage/.test(strip) && /Due-date fill/.test(strip) &&
          /Logged fill/.test(strip), "…and the three gating tiles still render");
  // The population toggle moved to the roster. If this fails, STATE.typePop has
  // no control anywhere and the roster is stranded on Open forever — a dead end
  // that no other assertion would notice.
  var rm = fresh(model({}));
  rm.personHygiene = { open: [{ person: "Ana Perez", n: 10, due: 10, est: 10, logged: 10 }],
                       resolved: [] };
  C.setModel(rm);
  C.STATE.typePop = "open";
  C.renderRoster_();
  var ros = els.rosterPanel.innerHTML;
  assert_(/setTypePop_\('open'\)/.test(ros) && /setTypePop_\('resolved'\)/.test(ros),
          "the Open/Resolved chips moved onto the roster with the matrix's removal");
})();

// ── ATTRITION IS STATED, NOT HIDDEN, AND NEVER A GAP ROW (v18) ──
// Excluding a leaver's work makes numbers smaller. A number that quietly got
// smaller is indistinguishable from a broken feed, so the exclusion is stated;
// but it is a scoping decision, not something to fix, so it must never appear
// as a hygiene gap row or someone will open a ticket to chase leavers.
(function () {
  var lv = fresh(model({}));
  lv.meta.leaverExcluded = { issues: 42, epics: 7 };
  C.renderHygPanel_();
  var hlv = els.hygPanel.innerHTML;
  assert_(/42<\/b> issues by former employees excluded/.test(hlv),
          "the attrition exclusion is stated on the hygiene view");
  assert_(/7 of them epics/.test(hlv), "…with the epic split, since Forecast is epic-grain");
  assert_(/attrition cannot be coached/.test(hlv), "…and says why it is out of scope");
  // Anchored on the row-NAME cell (`<tr><td>` + esc_(g.name)), not on the whole
  // table: since 2026-08-07 the roster-join row's detail says "these are NOT
  // former employees" — a clarification the reader needs, and the opposite of
  // attrition being presented as a gap to work. The rule being pinned is that no
  // gap is NAMED for attrition, which is what would send someone chasing leavers.
  assert_(!/<tr><td>[^<]*former employee/i.test(hlv), "it is NOT a gap row in the table");
  // Silent when there is nothing to say — a permanent "0 excluded" line is noise.
  // Checked on the 👥 note specifically, for the same reason as above.
  var lv0 = fresh(model({}));
  lv0.meta.leaverExcluded = { issues: 0, epics: 0 };
  C.renderHygPanel_();
  assert_(!/issues by former employees excluded/.test(els.hygPanel.innerHTML),
          "no note when nothing was excluded");
  var lvNone = fresh(model({}));
  delete lvNone.meta.leaverExcluded;
  C.renderHygPanel_();
  assert_(!/issues by former employees excluded/.test(els.hygPanel.innerHTML),
          "a pre-v18 payload renders no note rather than throwing");

  fresh(model({}));
  C.STATE.typePop = "open";
})();

// ── Actions roster grading (spec §5.2) ──────────────────────
// personSignalRows_ grades vs the matrix gates; below signalMinN the cell is
// "small" (grey, % still shown) and never red. Uses the base fixture's own
// people (Ana Perez, Ben Ortiz — model({}) at the top of this file) so the
// rows are guaranteed to exist in model.people and pass default filters.
(function () {
  fresh(model({}));
  resetFilters();
  C.STATE.typePop = "open";
  var mdl = C.getModel();
  mdl.personHygiene = {
    open: [
      { person: "Ana Perez", n: 10, due: 3, est: 10, logged: 9 },  // due red, est green
      { person: "Ben Ortiz", n: 1,  due: 0, est: 0,  logged: 0 },  // ALL small — never red
    ],
    resolved: [],
  };
  mdl.meta.signalMinN = 4;
  C.setModel(mdl);
  var rows = C.personSignalRows_([]);
  var ana = rows.filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  var ben = rows.filter(function (r) { return r.p.name === "Ben Ortiz"; })[0];
  assert_(ana && ana.sig.due.cls === "bad", "30% due fill vs 0.8 gate grades bad");
  assert_(ana.sig.est.cls === "good", "100% est fill grades good");
  assert_(ana.overall === "bad", "overall = worst graded signal");
  assert_(ben && ben.sig.due.cls === "small" && ben.overall === "na",
          "1-issue person is SMALL/ungraded, never red (review 2026-08-05 #1)");
  var sum = C.signalSummary_([]);
  assert_(sum.bad === 1 && sum.small === 1,
          "summary counts exclude small-n rows from the red count");

  // ── resolved population: iso-scoped SUM across weekly buckets ──
  // Review finding (2026-08-05): the "open" branch above never exercises the
  // resolved branch's `isos.indexOf` filter or its `+=` accumulation — a
  // stray `=` (overwrite instead of sum) or an off-by-one in the iso filter
  // would ship silently. Same person, two in-window weekly buckets that must
  // SUM, plus one huge out-of-window bucket that must be excluded entirely.
  C.STATE.typePop = "resolved";
  mdl.personHygiene.resolved = [
    { iso: "2026.W30", person: "Ana Perez", n: 5, due: 5, est: 5, logged: 5 },
    { iso: "2026.W31", person: "Ana Perez", n: 5, due: 3, est: 5, logged: 5 },
    { iso: "2026.W29", person: "Ana Perez", n: 999, due: 0, est: 0, logged: 0 }, // OUT of window
  ];
  C.setModel(mdl);
  var resRows = C.personSignalRows_(WEEKS);   // WEEKS = ["2026.W30", "2026.W31"]
  var anaRes = resRows.filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  assert_(anaRes.n === 10,
          "resolved rows SUM n across the two in-window buckets (5+5=10), not the last write (5) " +
          "or the out-of-window bucket (1004+)");
  assert_(anaRes.sig.due.miss === 2 && anaRes.sig.due.cls === "good",
          "due SUMS to 8 of 10 (80%, at gate → good) — a stray '=' would leave only W31's " +
          "3 of 5 (60%, bad), and a leaked W29 bucket would tank it to ~1%");
  var resWide = C.personSignalRows_(WEEKS.concat(["2026.W29"]))
    .filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  assert_(resWide.n === 1009 && resWide.sig.due.cls === "bad",
          "widening the isos argument to include W29 pulls its 999-n bucket in — proves the " +
          "filter genuinely gates on the isos PARAMETER, not a hardcoded skip");

  // ── LOGGED GRADES OVER STARTED WORK ONLY (user report 2026-08-06) ─────────
  // The client half of the fix. Code.js decides which records are in the ratio;
  // this pins that the roster DIVIDES BY that decision instead of by n. The two
  // rows below have identical logged counts and identical n — only loggedN
  // differs — so nothing but the denominator can be producing the difference.
  C.STATE.typePop = "open";
  mdl.personHygiene.open = [
    // 8 open issues, 6 started, 5 of those logged → 83% over the started
    // population. Over n it would read 62% and grade RED on nothing but backlog.
    // 4 of those 6 carry a due date → 67% (v32); over n it would read 50%.
    { person: "Ana Perez", n: 8, due: 4, dueN: 6, est: 8, logged: 5, loggedN: 6 },
    // A full backlog, none of it started. The honest answer is "nothing to
    // grade", not 0% — Ben has not failed to log time against, or commit a date
    // to, work he has not begun, and a red cell here is a queue nobody can clear.
    { person: "Ben Ortiz", n: 12, due: 0, dueN: 0, est: 12, logged: 0, loggedN: 0 },
  ];
  C.setModel(mdl);
  var startedRows = C.personSignalRows_([]);
  var anaS = startedRows.filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  var benS = startedRows.filter(function (r) { return r.p.name === "Ben Ortiz"; })[0];
  assert_(Math.round(anaS.sig.logged.pct * 100) === 83 && anaS.sig.logged.miss === 1,
          "Logged grades 5 of the 6 STARTED issues (83%, 1 missing) — not 5 of 8 (62%)");
  assert_(benS.sig.logged.cls === "na" && benS.sig.logged.pct === null,
          "an all-unstarted backlog reads UNGRADED on Logged, never 0% — nothing was measured");
  assert_(benS.sig.logged.miss === 0,
          "…and contributes no missing count to the row's opportunity ranking");

  // ── DUE DATE GRADES OVER STARTED WORK TOO (managers' 2026-08-10) ───────────
  // Identical shape to the Logged pair above, because it is the same fix one
  // column over. Both rows keep their full n: the row COUNT is still the person's
  // whole backlog, only the two ratios narrow.
  var dueFieldR = C.SIGNAL_FIELDS_.filter(function (f) { return f.k === "due"; })[0];
  assert_(dueFieldR.denom === "dueN" && dueFieldR.denomFallbackN === true,
          "the roster's Due column declares dueN, with the pre-v32 fallback to n");
  assert_(Math.round(anaS.sig.due.pct * 100) === 67 && anaS.sig.due.miss === 2,
          "Due grades 4 of the 6 STARTED issues (67%, 2 missing) — not 4 of 8 (50%)");
  assert_(anaS.n === 8,
          "…while the row's n still states the whole backlog, so the narrower denominator is visible");
  assert_(benS.sig.due.cls === "na" && benS.sig.due.pct === null && benS.sig.due.miss === 0,
          "an all-unstarted backlog reads UNGRADED on Due, never 0% — this is the exact " +
          "complaint the feedback was about: 12 undated To Do tickets are not 12 failures");
  assert_(benS.overall !== "bad",
          "…so a person carrying only unstarted work cannot be ranked as the org's biggest problem");

  // A pre-v24 bucket has no loggedN. It must read the way that payload actually
  // measured — logged over n — rather than collapsing to an ungraded blank for a
  // whole cache TTL. `bill` deliberately does NOT get this fallback.
  mdl.personHygiene.open = [{ person: "Ana Perez", n: 8, due: 8, est: 8, logged: 5, billN: undefined }];
  C.setModel(mdl);
  var legacyRow = C.personSignalRows_([]).filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  assert_(Math.round(legacyRow.sig.logged.pct * 100) === 63,
          "a bucket with no loggedN falls back to n (5 of 8) — the old reading, not a blank column");
  assert_(legacyRow.sig.bill.cls === "na",
          "…but an absent billN stays ungraded: falling back there would grade a column nobody measured");

  // Teardown — same pattern as the sibling 🧬 by-type matrix block above
  // (fresh model + typePop reset), so this block's personHygiene/resolved
  // fixture and typePop="resolved" leave no residue for the next block, which
  // reads C.getModel() directly rather than reseeding its own.
  resetFilters();
  fresh(model({}));
  C.STATE.typePop = "open";
})();

// ── 👥 SIGNALS ROSTER — RENDER (spec §5.2, Task 5, 2026-08-05) ──────────────
// The block above pins personSignalRows_/signalSummary_'s grading math; this
// one pins the RENDERING contract on top of it — one row per population
// person, a RAG dot that never carries the verdict without its % beside it
// (FR-4.4), the small-n grey carve-out, the SNAP/PERIOD scope tags, the
// shared Open/Resolved toggle re-rendering both surfaces, and header-click sort.
(function () {
  var mdl = fresh(model({}));
  resetFilters();
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("view", "actions");
  C.setState("typePop", "open");
  mdl.personHygiene = {
    open: [
      { person: "Ana Perez", n: 10, due: 3, est: 10, logged: 9 },  // due bad, est/logged good
      { person: "Ben Ortiz", n: 1,  due: 0, est: 0,  logged: 0 },  // 1 issue — SMALL, never red
    ],
    resolved: [],
  };
  mdl.meta.signalMinN = 4;
  // A name with an apostrophe — proves the onclick escaping (esc_ + the extra
  // \'-escape for the JS string literal it sits inside) survives real rosters.
  mdl.people.push(person("Sam O'Neil", {}));
  mdl.personHygiene.open.push({ person: "Sam O'Neil", n: 5, due: 5, est: 5, logged: 5 });
  C.setModel(mdl);

  C.renderAll_();
  var roster = els.rosterPanel.innerHTML;
  assert_(roster.indexOf("sigBad") !== -1, "a red cell renders with the sigBad class");
  assert_(roster.indexOf("missing") !== -1, "cells state the offending count");
  assert_(roster.indexOf("SNAP") !== -1, "signal headers carry the SNAP scope tag on the open population");
  assert_(roster.indexOf("Ana Perez") !== -1 && roster.indexOf("Ben Ortiz") !== -1,
          "one row per population person");
  assert_(roster.indexOf("sigSmall") !== -1,
          "the 1-issue person's cells render grey/ungraded, never red (SIGNAL_MIN_N)");
  assert_(roster.indexOf("Open backlog") !== -1,
          "the roster states the OPEN population in its lead line (spec §5.4)");
  assert_(/sig(Bad|Warn|Good|Small)">●<\/span> [0-9]+%/.test(roster),
          "the % text renders right beside every RAG dot — never colour alone (FR-4.4)");

  // STICKY HEADER (user 2026-08-06). One row per active person is long enough
  // that the column names scroll away and a bare "62%" stops naming its field.
  // Three things have to hold together or the pin silently does nothing: the
  // header row in a <thead> (the CSS rule is scoped there so the detail rows'
  // nested tables can't inherit it), the capped .rosterWrap scroller for it to
  // stick to, and the sticky rule itself.
  assert_(/<div class="gwrap rosterWrap"><table class="hyg tmx rosterTbl"><thead><tr>/.test(roster),
          "the roster header row sits in a <thead> inside the capped .rosterWrap scroller");
  assert_(/<\/thead><tbody><tr class="rosterRow"/.test(roster), "…and the person rows in a <tbody>");

  // The two columns that do NOT divide by the n beside them have to say so on the
  // page, not only in a hover tip (managers' feedback 2026-08-10) — a PNG of this
  // table is how it usually gets read, and hover does not exist on a PNG.
  // The count column is NAMED, not a bare letter (user 2026-08-10: "we need to
  // properly name or explain what N column means"). A letter with no noun is what
  // let a reader conclude the dashboard had lost the difference.
  assert_(/>Open issues</.test(roster),
          "the count column is named on the Open view, not left as 'n'");
  // METHODOLOGY: MOSTLY BEHIND A LINK, ONE RULE STILL ON THE PAGE (2026-08-17).
  // The wall of denominators moved into the "How these are counted" panel. The
  // managers' 2026-08-10 requirement was that these rules be READABLE IN A PNG,
  // because that is how this table circulates — and neither a tooltip nor a
  // modal survives a screenshot. So the rule that caused a real misreading (Due
  // and Logged divide by LESS than the count beside them) stays in the markup,
  // and the rest is one click away.
  assert_(/divide by less than the <b>Open issues<\/b> count beside them/.test(roster),
          "the PNG-critical rule stays ON the page: Due and Logged do not reconcile against " +
          "the count beside them, and a reader with only a screenshot still learns it");
  assert_(/anything carrying a date is tracked whatever its status/.test(roster),
          "…together with the half of that rule a manager asked for by name");
  assert_(/linkBtn[^>]*onclick="openMethod_\(\)"/.test(roster),
          "…and the full methodology is reachable from the section header");
  // The wall itself is GONE from the default view — that was the point.
  assert_(!/<details class="howto">/.test(roster),
          "the old collapsed methodology block no longer opens the panel");
  // …but nothing was lost: the detail lives in the panel, built from the same
  // field list the columns render from, so the two cannot drift.
  var method = C.methodPanelHtml_();
  assert_(/<b>Open issues<\/b> is a count, not a grade/.test(method),
          "the panel says what the count counts, and that it is not graded");
  assert_(/epics included/.test(method),
          "…including the epics, which is the part no reader could have guessed");
  assert_(/anything with a date is tracked whatever its status<\/b>/.test(method),
          "…and carries the full Due-date rule");
  // The panel HTML-escapes each rule, so compare against the unescaped text
  // rather than the raw string ("Time Spent > 0" ships as "&gt;").
  var methodPlain = method.replace(/&gt;/g, ">").replace(/&lt;/g, "<")
                          .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
                          .replace(/&amp;/g, "&");
  C.SIGNAL_FIELDS_.forEach(function (f) {
    assert_(methodPlain.indexOf(f.rule || f.tip) !== -1,
            "the panel lists the full rule for '" + f.label + "' — built from SIGNAL_FIELDS_, " +
            "never re-typed, so a column and its rulebook entry cannot disagree");
  });
  assert_(/audited separately below/.test(methodPlain),
          "…and the panel points at the epic audit, so the epic exception is not folklore");

  // WHOLE-ROW CLICK (user 2026-08-06): a row that only reacts on the name reads
  // as broken — you aim at the number you want explained and nothing happens.
  assert_(/<tr class="rosterRow" onclick="toggleRosterDetail_\('Ana Perez'\)">/.test(roster),
          "the toggle lives on the <tr>, so the whole row is the control");
  assert_(!/<span class="rosterName"[^>]*onclick/.test(roster),
          "…and no longer on the name span alone");
  assert_(/tr\.rosterRow\{cursor:pointer\}/.test(fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8")),
          "…with the pointer cursor on the row to match");

  // SCROLL PRESERVATION (user 2026-08-06). Every toggle rebuilds innerHTML,
  // which resets the .rosterWrap scroller to the top — so opening a row two
  // thirds down threw the reader back to the first name and the table read as
  // though it had reordered itself. The retired People grid carried this guard;
  // adding the capped scroller for the sticky header reintroduced the bug it
  // was written for. Pinned at source, because the stub DOM has no layout and
  // therefore cannot scroll: the read must happen BEFORE the innerHTML
  // assignment and the write AFTER it, or it preserves nothing.
  var rsrc = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
  var rfn = rsrc.slice(rsrc.indexOf("function renderRoster_()"));
  rfn = rfn.slice(0, rfn.indexOf("\n}\n"));
  var iRead = rfn.indexOf("wrapWas.scrollTop"), iSet = rfn.indexOf("el.innerHTML ="),
      iWrite = rfn.indexOf("wrapNow.scrollTop =");
  assert_(iRead !== -1 && iWrite !== -1, "renderRoster_ saves and restores the roster scroller");
  assert_(iRead < iSet && iSet < iWrite,
          "…reading before the innerHTML rebuild and writing after it — either side of that and it is a no-op");
  assert_(/el\.querySelector \?/.test(rfn),
          "…guarded, so the first render (no scroller in the DOM yet) cannot throw");
  // The caret has to state the row's own state now that the whole row toggles.
  // The caret sits OUTSIDE the .pii wrapper on purpose: it is a control
  // affordance, and blurring it would leave a row nobody can tell is expandable.
  // Asserted against the real markup rather than loosened to a bare substring.
  C.toggleRosterDetail_("Ana Perez");
  assert_(/▾ <span class="pii">Ana Perez<\/span>/.test(els.rosterPanel.innerHTML),
          "an open row's caret points down, and stays outside the blur wrapper");
  C.toggleRosterDetail_("Ana Perez");
  assert_(/▸ <span class="pii">Ana Perez<\/span>/.test(els.rosterPanel.innerHTML),
          "…and back to ▸ when closed");
  var rcss = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
  assert_(/\.rosterWrap\{max-height:[^}]*overflow:auto\}/.test(rcss),
          "the wrapper is capped and scrolls — a sticky top needs a scrollport that actually scrolls");
  assert_(/table\.hyg\.tmx\.rosterTbl thead th\{position:sticky;top:0/.test(rcss),
          "the roster's header cells are pinned to the top of that scroller");
  assert_(/table\.hyg\.tmx\.rosterTbl thead th\.tname\{left:0;z-index:7\}/.test(rcss),
          "…and the corner cell outranks the body's sticky name column on both axes");
  assert_(roster.indexOf("toggleRosterDetail_('Sam O\\'Neil')") !== -1,
          "an apostrophe in a person's name is escaped for the onclick attribute, not left to break it");

  // Default sort: biggest opportunity first (worst overall, ascending rank).
  assert_(C.STATE.rosterSort === "opp" && C.STATE.rosterDesc === false,
          "default sort is opp/ascending — worst overall first");
  assert_(roster.indexOf("Ana Perez") < roster.indexOf("Ben Ortiz"),
          "Ana's BAD overall ranks ahead of Ben's ungraded (na) row by default");

  // Clicking a header re-sorts; clicking the SAME header again flips direction.
  C.setRosterSort_("due");
  assert_(C.STATE.rosterSort === "due", "clicking a header re-sorts");
  assert_(C.STATE.rosterDesc === false, "…a fresh column starts ascending");
  C.setRosterSort_("due");
  assert_(C.STATE.rosterDesc === true, "clicking the SAME header again flips direction");
  assert_(/▾/.test(els.rosterPanel.innerHTML), "the active header shows the descending arrow");

  // Sorter-less column guard (review finding 2026-08-05): rows.sort(null)
  // throws a TypeError, so setRosterSort_ must leave STATE untouched for ANY
  // column with no sorter. "hours" USED to be that column, but Task 6
  // (2026-08-05) filled its sorter in — so the guard is now pinned against an
  // injected fake column instead, proving it is generic and not a one-off
  // check that quietly stopped meaning anything the day hours got a sorter.
  C.ROSTER_COLS_.__fake = { label: "Fake", sort: null };
  var sortBefore = C.STATE.rosterSort, descBefore = C.STATE.rosterDesc;
  C.setRosterSort_("__fake");
  assert_(C.STATE.rosterSort === sortBefore && C.STATE.rosterDesc === descBefore,
          "clicking a sorter-less column leaves STATE.rosterSort/rosterDesc unchanged, and does not throw");
  delete C.ROSTER_COLS_.__fake;

  // The Overall cell must never fabricate a percentage (review finding
  // 2026-08-05): its g.pct is null, and null*100 JS-coerces to a literal
  // "0%" that would read as a real measurement — exactly the misleading-
  // signal class this dashboard exists to stamp out.
  var hSnap = els.rosterPanel.innerHTML;
  var anaIdx = hSnap.indexOf("Ana Perez");
  var anaRow = hSnap.slice(hSnap.lastIndexOf("<tr", anaIdx), hSnap.indexOf("</tr>", anaIdx));
  // Overall is the SECOND cell since 2026-08-17 (next to the name), not the last.
  var anaCells = anaRow.split("<td");
  var anaOverallCell = "<td" + (anaCells[2] || "");
  assert_(anaOverallCell.indexOf("sigBad") !== -1,
          "sanity: Ana's Overall cell is the graded (bad) one under test");
  assert_(anaOverallCell.indexOf("%") === -1,
          "the Overall cell of a graded row contains no % character — no fabricated 0%");
  assert_(anaOverallCell.indexOf("missing") !== -1,
          "…but still states its miss count, which IS real");

  // The click guard in setRosterSort_ only protects CLICKS. STATE.rosterSort
  // can still be set directly — a test, or a future deep-link reader — to a
  // sorter-less key, and the render path has its own choke point:
  // renderRoster_ must fall back to opp there too, or rows.sort(null) throws
  // regardless of how rosterSort got set (review finding 2026-08-05, second
  // pass). "hours" was that key until Task 6 gave it a real sorter, so the
  // fake column stands in for it — same reasoning as the guard test above.
  C.ROSTER_COLS_.__fake = { label: "Fake", sort: null };
  var sortSave = C.STATE.rosterSort, descSave = C.STATE.rosterDesc;
  C.STATE.rosterSort = "__fake";
  C.STATE.rosterDesc = false;
  C.renderRoster_();   // must not throw
  var fakeSnap = els.rosterPanel.innerHTML;
  assert_(fakeSnap.indexOf("Ana Perez") !== -1 && fakeSnap.indexOf("Ben Ortiz") !== -1,
          "renderRoster_ with STATE.rosterSort pointing at a sorter-less column renders without throwing");
  assert_(fakeSnap.indexOf("Ana Perez") < fakeSnap.indexOf("Ben Ortiz"),
          "…and falls back to the opp default order — Ana's bad overall still ranks ahead of Ben's na row");
  C.STATE.rosterSort = sortSave; C.STATE.rosterDesc = descSave;
  delete C.ROSTER_COLS_.__fake;

  // One toggle scopes both surfaces (spec §5.4) — flipping it must re-render
  // the roster too, not just the 🧬 matrix.
  C.setTypePop_("resolved");
  var rosterResolved = els.rosterPanel.innerHTML;
  assert_(rosterResolved.indexOf("Resolved in") !== -1,
          "setTypePop_ re-renders the roster — the shared toggle drives both surfaces");
  assert_(rosterResolved.indexOf("PERIOD") !== -1,
          "…and its scope tag swaps from SNAP to PERIOD with the population");

  // Pre-v22 payload: must say so, not render an empty table (same rule as the
  // 🧬 matrix's own "Not in this payload" state).
  var legacy = fresh(model({}));
  delete legacy.personHygiene;
  C.renderRoster_();
  assert_(/Not in this payload/.test(els.rosterPanel.innerHTML),
          "a payload with no personHygiene says so — silence would read as 'nobody has gaps'");

  // Teardown — clean model + STATE reseeded, same convention as the sibling
  // 🧬 by-type matrix and personHygiene-grading blocks above, so nothing here
  // leaks into the 🌊 Flow block right after it.
  resetFilters();
  C.STATE.rosterSort = "opp"; C.STATE.rosterDesc = false;
  C.STATE.typePop = "open";
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 👥 PERSON STATES + THE PTO CARVE (user 2026-08-06) ─────────────────────
// Three asks, one block, because they share the same fixture and the same
// principle: a number should never be read without the reason it looks the way
// it does.
//   1. TIME OFF is folded into nonBillable server-side ("time off cannot be
//      charged to a customer"). Correct as arithmetic, misleading as a bar — a
//      holiday and a week of unbilled project work drew the identical mark. It
//      is now split out for DISPLAY only, so no rate moves and the invariant
//      billable+nonBillable+unclassified === tracked still holds.
//   2. INTERNS were filtered out of the roster entirely, while the Utilization
//      card's tooltip told readers "their profiles and hours stay on the People
//      roster, marked 🎓". Shown now, and deliberately never graded.
//   3. NEW HIRES lost their 🌱 marker when the People grid was retired.
(function () {
  var mdl = fresh(model({}));
  resetFilters();
  C.setState("view", "actions");
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("typePop", "open");
  mdl.meta.signalMinN = 4;

  // Ana: 40h scheduled, 24h tracked → 12h billable, 12h nonBillable OF WHICH 8h
  // is tracked time off. The old bar drew one 12h non-billable block; the new
  // one must draw 4h of work and 8h of time off.
  mdl.people.forEach(function (p) {
    if (p.name !== "Ana Perez") return;
    p.weeks["2026.W31"] = Object.assign(week(), {
      cap: 40, avail: 40, tracked: 24, trackedOff: 8, trackedCov: 24,
      billable: 12, nonBillable: 12, availCov: 40, capCov: 40 });
  });
  // Iris: intern. Deliberately given the WORST possible record (0 of 12 on every
  // field) — if grading ever leaks back in, she tops the "biggest opportunity"
  // sort and this test fails loudly instead of quietly mis-ranking a trainee.
  mdl.people.push(person("Iris Intern", { isIntern: true, jobTitle: "09.I1.1 - Associate Consultant" }));
  // Nate: inside the ramp-up window, and his weeks predate nothing — he has a
  // normal record. The 🌱 is a reading aid, NOT an exemption (2026-07-31
  // decision: new hires stay in every metric post-hire).
  mdl.people.push(person("Nate New", { newHire: true, hired: "2026-06-15" }));
  // Pia: hired AFTER the period under test, so the server emits no weeks for
  // her at all. "—" would read as "delivered nothing".
  mdl.people.push(person("Pia Prehire", { newHire: true, hired: "2026-09-01", weeks: {} }));
  mdl.personHygiene = { open: [
    { person: "Ana Perez",   n: 10, due: 3,  est: 10, logged: 9 },
    { person: "Iris Intern", n: 12, due: 0,  est: 0,  logged: 0 },
    { person: "Nate New",    n: 10, due: 2,  est: 10, logged: 9 },
  ], resolved: [] };
  C.setModel(mdl);
  C.renderAll_();

  var h = els.rosterPanel.innerHTML;

  // ── 1. PTO split out of non-billable ──
  assert_(/segOff/.test(h), "tracked time off gets its own bar segment, not a share of non-billable");
  assert_(/non-billable work 4h/.test(h) && /time off 8h/.test(h),
          "the bar tooltip names non-billable WORK and time off separately (12h nonBillable = 4 + 8)");
  assert_(!/non-billable 12h/.test(h),
          "the undivided 12h non-billable figure — the one that gets someone asked to explain a holiday — is gone");
  var segCss = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
  assert_(/--seg-off:/.test(segCss.split('[data-theme="dark"]')[0]) &&
          /--seg-off:/.test(segCss.split('[data-theme="dark"]')[1]),
          "the time-off segment has a token in BOTH themes — a segment defined in one theme only is invisible in the other");
  assert_(/>time off</.test(h),
          "the Hours legend names the time-off colour on screen — tooltips do not survive a PNG");

  // The split is presentation: the payload's own nonBillable is untouched, so
  // nothing downstream of it can have moved.
  var anaW = C.aggWeeks_(C.getModel().people.filter(function (p) { return p.name === "Ana Perez"; })[0],
                         ["2026.W31"]);
  assert_(anaW.nonBillable === 12 && anaW.trackedOff === 8,
          "the model still carries the full 12h nonBillable with trackedOff INSIDE it — display-only carve, no rate moves");

  // ── 2. Interns: shown, marked, never graded ──
  assert_(h.indexOf("Iris Intern") !== -1,
          "the intern appears on the roster at all (she was filtered out entirely before)");
  // Two closing spans now: the name sits inside .pii (blurred by the
  // confidential switch) inside .rosterName. The badge still follows it
  // immediately — it is a state marker, not personal detail, so it stays legible.
  assert_(/Iris Intern<\/span><\/span><span class="stateBadge" title="Intern/.test(h),
          "…marked 🎓 right on the name, which is what the Utilization card already promised");
  var irisRow = h.slice(h.lastIndexOf("<tr", h.indexOf("Iris Intern")),
                        h.indexOf("</tr>", h.indexOf("Iris Intern")));
  assert_(irisRow.indexOf("sigBad") === -1 && irisRow.indexOf("sigWarn") === -1,
          "0-of-12 on every field and NOT ONE red or amber cell — an intern is never graded");
  assert_(/sigLearn/.test(irisRow) && / 0%/.test(irisRow),
          "…but the percentages ARE shown: she can read her own record and learn the standard");
  // The per-CELL "12 missing" stays — that is the most actionable thing she can
  // learn from ("12 of your issues carry no due date"). What must be zero is the
  // ROW's miss, which is only ever used as the opportunity sort's tie-break.
  assert_(/12 missing/.test(irisRow),
          "…her per-cell missing counts DO show — that is the specific, learnable part");
  var irisData = C.personSignalRows_(["2026.W31"])
                  .filter(function (r) { return r.p.name === "Iris Intern"; })[0];
  assert_(irisData.overall === "learn" && irisData.miss === 0,
          "…while the ROW carries overall:learn and miss:0, the two values the action queue ranks on");
  assert_(h.indexOf("Ana Perez") < h.indexOf("Iris Intern") &&
          h.indexOf("Nate New") < h.indexOf("Iris Intern"),
          "the worst-record person on the roster sorts LAST under 'biggest opportunity first'");
  assert_(/in training/.test(irisRow),
          "her Hours cell says 'in training' and drops the idle segment — idle time is the point of a traineeship");
  var sum = C.signalSummary_(["2026.W31"]);
  assert_(sum.learn === 1 && sum.bad === 2,
          "the exec pulse counts her apart as 'in training', never among the reds (Ana + Nate are the 2 bad)");
  assert_(sum.small === 0, "…and not pooled into the small-n bucket either — that is a sample fact, this is a policy");

  // ── 3. New hires + the pre-evaluation window ──
  assert_(/Nate New<\/span><\/span><span class="stateBadge" title="New hire — joined 2026-06-15/.test(h),
          "a ramping new hire is marked 🌱 with the date they joined");
  var nateRow = h.slice(h.lastIndexOf("<tr", h.indexOf("Nate New")), h.indexOf("</tr>", h.indexOf("Nate New")));
  assert_(nateRow.indexOf("sigBad") !== -1,
          "…and is STILL GRADED — 🌱 explains the idle capacity, it is not an exemption (2026-07-31 decision)");
  var piaRow = h.slice(h.lastIndexOf("<tr", h.indexOf("Pia Prehire")), h.indexOf("</tr>", h.indexOf("Pia Prehire")));
  assert_(/🌱 joined 2026-09-01/.test(piaRow),
          "a period BEFORE someone's start date says so — '—' there reads as 'delivered nothing'");

  // ── CSV carries all of it ──
  var csv = C.rosterCsvLines_();
  assert_(/Non-billable work h,Time off h/.test(csv[0]),
          "the CSV splits the column too — a spreadsheet sum of the old one added holidays to project work");
  var irisCsv = csv.filter(function (l) { return l.indexOf("Iris Intern") === 0; })[0];
  assert_(/intern \(in training, ungraded\)/.test(irisCsv),
          "the CSV states WHY the intern's row is ungraded, so the state survives the export");
  // Resolved BY HEADER, never by index — the same rule the Jira Raw readers
  // follow. This roster CSV gains columns from more than one workstream, and an
  // index-pinned assertion silently starts testing its neighbour.
  var cols = csv[0].split(",");
  var anaCsv = csv.filter(function (l) { return l.indexOf("Ana Perez") === 0; })[0].split(",");
  function cell(name) {
    var i = cols.indexOf(name);
    assert_(i !== -1, "CSV header carries a '" + name + "' column");
    return anaCsv[i];
  }
  assert_(cell("Billable h") === "12" && cell("Non-billable work h") === "4" && cell("Time off h") === "8",
          "…and her billable / non-billable-work / time-off columns still reconcile to the payload (12 · 4+8)");

  resetFilters();
  C.STATE.rosterSort = "opp"; C.STATE.rosterDesc = false;
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 👥 SIGNAL CHIPS: THE PULSE AS A ROSTER FILTER (user 2026-08-06) ─────────
// The Executive pulse already counts the buckets ("3 need action"); the ask was
// to make that a rapid filter on the Actions roster. Two halves have to agree:
// the chip strip on the roster, and the pulse counts as deep links into it. The
// thing worth pinning is that ONE definition drives both — a chip that says 3
// and shows 2 is worse than no chip.
(function () {
  var mdl = fresh(model({}));
  resetFilters();
  C.setState("view", "actions");
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("typePop", "open");
  C.STATE.sigFilter = "";
  mdl.meta.signalMinN = 4;
  // One person per bucket, so every chip has exactly one row to find. No
  // "warn" row on purpose: that bucket must render as a DISABLED zero chip
  // rather than vanish from the strip.
  mdl.people.push(person("Gia Good", {}));
  mdl.people.push(person("Uri Ungraded", {}));
  mdl.people.push(person("Iris Intern", { isIntern: true }));
  mdl.personHygiene = { open: [
    { person: "Ana Perez",    n: 10, due: 1,  est: 10, logged: 10 },  // due 10% -> bad
    { person: "Gia Good",     n: 10, due: 10, est: 10, logged: 10 },  // -> good
    { person: "Uri Ungraded", n: 2,  due: 0,  est: 0,  logged: 0 },   // n < 4 -> small
    { person: "Iris Intern",  n: 10, due: 0,  est: 0,  logged: 0 },   // -> learn
  ], resolved: [] };
  C.setModel(mdl);
  C.renderAll_();

  var all = els.rosterPanel.innerHTML;
  assert_(/class="sigChips"/.test(all), "the roster carries a signal chip strip");
  assert_(/>All 5</.test(all), "…leading with an All chip counting every row in the slice");
  assert_(/Need action 1</.test(all) && /On track 1</.test(all) &&
          /Ungraded 1</.test(all) && /In training 1</.test(all),
          "…and one chip per pulse bucket, each carrying its own count");
  // The empty bucket must still be on screen: a strip that changes length as you
  // click stops reading as a fixed picture of the slice.
  assert_(/Watch 0</.test(all), "a bucket with nobody in it stays visible at zero");
  assert_(/sigChip off[^>]*disabled|disabled[^>]*>.*Watch 0/.test(all) || /Watch 0/.test(all),
          "…rendered inert rather than clickable");

  // The counts must be the SAME numbers the Executive pulse publishes — one
  // definition (SIG_FILTERS_[].match) drives the chip and signalSummary_ drives
  // the pulse, and this is the assertion that keeps them honest.
  var head = C.donePeriods_();
  var s = C.signalSummary_(head.length ? head[head.length - 1].isos : []);
  assert_(s.bad === 1 && s.good === 1 && s.warn === 0 && s.small === 1 && s.learn === 1,
          "the pulse's own summary agrees with the chip counts, bucket for bucket");

  // ── Clicking a chip narrows the table ──
  C.setSigFilter_("bad");
  var onlyBad = els.rosterPanel.innerHTML;
  assert_(/Ana Perez/.test(onlyBad), "filtering to 'need action' keeps the red row");
  assert_(!/Gia Good/.test(onlyBad) && !/Iris Intern/.test(onlyBad),
          "…and drops every row that is not in that bucket");
  assert_(/Showing 1 of 5/.test(onlyBad),
          "…and says how much of the roster is hidden, under the table as well as in the strip");
  assert_(/All 5</.test(onlyBad) && /On track 1</.test(onlyBad),
          "the OTHER chips keep their full-slice counts, so the filter can be SWITCHED, not just cleared");

  // ── The CSV follows the chip ──
  var csvBad = C.rosterCsvLines_();
  assert_(csvBad.length === 2, "the export follows the filter — header + the one filtered row");
  assert_(csvBad[1].indexOf("Ana Perez") === 0, "…and it is the right row");

  // ── Same chip again clears it; the strip is never a trap ──
  C.setSigFilter_("bad");
  assert_(C.STATE.sigFilter === "" && /Gia Good/.test(els.rosterPanel.innerHTML),
          "clicking the active chip again clears the filter");

  // ── A filter that empties the table explains itself ──
  C.setSigFilter_("warn");
  var empty = els.rosterPanel.innerHTML;
  assert_(/No one in this slice is <b>Watch<\/b>/.test(empty),
          "an empty result names the filter rather than rendering a blank table");
  assert_(/Show all 5/.test(empty), "…and offers the way back");
  C.setSigFilter_("");

  // ── The pulse counts are deep links into the filtered roster ──
  C.setState("view", "exec");
  C.renderAll_();
  var pulse = els.pulsePanel.innerHTML;
  assert_(/openRoster_\('bad'\)/.test(pulse), "each pulse count links into its own bucket");
  assert_(/event\.stopPropagation\(\);openRoster_\('bad'\)/.test(pulse),
          "…stopping propagation, so the count's link does not also fire the row's open-everything handler");
  C.openRoster_("bad");
  assert_(C.STATE.sigFilter === "bad" && C.STATE.view === "actions",
          "openRoster_('bad') lands on the Actions roster already narrowed to those rows");
  assert_(C.STATE.rosterSort === "opp" && C.STATE.rosterDesc === false,
          "…with the deep-link's worst-first sort still applied");
  C.openRoster_();
  assert_(C.STATE.sigFilter === "",
          "the plain 'open the roster' link CLEARS any narrowing — it must not inherit a filter set minutes ago");

  // ── Reset clears it ──
  C.STATE.sigFilter = "learn";
  document.getElementById("btnReset").onclick();
  assert_(C.STATE.sigFilter === "", "⟲ Reset clears the signal chip like every other filter");

  resetFilters();
  C.STATE.sigFilter = "";
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 👥 SIGNALS ROSTER — HOURS COLUMN + DRILL-DOWN (Task 6, 2026-08-05) ──────
// hoursCellHtml_/rosterDetailRow_ reuse the recoverable-hours (oppRows_)
// ramping/on-leave exclusions (review 2026-08-05 #2): an ineligible person's
// idle capacity is the explanation, not a recoverable signal, so their bar
// carries no idle segment, their cell carries a chip saying why, and the
// hours SORTER ranks them last. Bar fixtures use 16/4/20 (billable/non-bill/
// idle of a 40h week) on purpose — 40/10/50% with no rounding remainder, so a
// bar-width assertion can't be flaky on an unrelated rounding artifact.
(function () {
  var mdl = fresh(model({}));
  resetFilters();
  C.setState("view", "actions");
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("typePop", "open");
  mdl.personHygiene = { open: [], resolved: [] };   // grading is irrelevant here — na for everyone

  var idleWeek = { tracked: 20, billable: 16, nonBillable: 4, trackedCov: 20,
                    nsBillRaw: 16, nsNonBillRaw: 4 };
  mdl.people.forEach(function (p) {
    // Ana Perez: a ramping new hire — same idle SHAPE as the eligible row
    // below, so what differs in the render is eligibility, not the numbers.
    if (p.name === "Ana Perez") { p.newHire = true; p.weeks["2026.W31"] = week(idleWeek); }
    // Ben Ortiz: an ordinary, eligible row — the contrast this block exists to draw.
    if (p.name === "Ben Ortiz") { p.weeks["2026.W31"] = week(idleWeek); }
  });
  // Uma Voss: the OTHER eligibility branch (on leave, not ramping) — a
  // different chip word must render for it.
  mdl.people.push(person("Uma Voss", { onLeave: true, weeks: { "2026.W31": week(idleWeek) } }));
  // Zoe Null: HAS a week row for the period but zero scheduled capacity — the
  // "—" branch (self-review: a zero-capacity person renders "—", not an
  // empty bar).
  mdl.people.push(person("Zoe Null", { weeks: { "2026.W31": week({ cap: 0, avail: 0, availCov: 0,
    capCov: 0, planned: 0, tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0,
    nsBillRaw: 0, nsNonBillRaw: 0, effPlanned: 0 }) } }));
  // Ivy Preh: no week row for the period AT ALL (pre-hire/termed shape) —
  // aggWeeks_ returns null outright, the OTHER path into the same "—" cell
  // and into rosterDetailRow_'s "No scheduled capacity" line.
  mdl.people.push(person("Ivy Preh", { weeks: {} }));
  mdl.personHygiene.open = mdl.people.map(function (p) {
    return { person: p.name, n: 0, due: 0, est: 0, logged: 0 };
  });
  C.setModel(mdl);
  C.renderAll_();
  var html = els.rosterPanel.innerHTML;

  /** The single <tr>…</tr> for one person's roster row (no drill-down open
      yet, so exactly one <tr> per name — same slicing idiom as the Overall-
      cell assertion in the sibling grading block above). */
  function rowOf(h, name) {
    var i = h.indexOf(name);
    return h.slice(h.lastIndexOf("<tr", i), h.indexOf("</tr>", i) + 6);
  }
  /** Just the Hours <td>…</td> out of a row — the 6th <td> (person, n, due,
      est, logged, HOURS, opp). Every column's grading is "na" in this
      fixture (personHygiene n=0 everywhere), so due/est/logged/opp ALSO
      render a bare em dash; isolating the Hours td is what makes the
      zero-capacity assertions below actually test the Hours cell and not an
      unrelated na cell that happens to look the same. */
  function hoursTd_(rowHtml) { return rowHtml.split("<td")[6] || ""; }
  var benRow = rowOf(html, "Ben Ortiz");
  var anaRow = rowOf(html, "Ana Perez");
  var umaRow = rowOf(html, "Uma Voss");
  var zoeRow = rowOf(html, "Zoe Null");
  var ivyRow = rowOf(html, "Ivy Preh");

  // ── Eligibility: the ramping chip + idle suppression ──
  assert_(anaRow.indexOf("ramping") !== -1, "ramping chip renders in the Hours cell");
  assert_(anaRow.indexOf("segIdle") === -1,
          "idle segment suppressed for the ramping row — same shape as Ben's, but no idle segment");
  assert_(umaRow.indexOf("on leave") !== -1, "on-leave chip renders with its own wording");
  assert_(umaRow.indexOf("segIdle") === -1, "idle segment suppressed for the on-leave row too");
  assert_(benRow.indexOf("segIdle") !== -1,
          "an ELIGIBLE person with avail > tracked DOES show an idle segment — the contrast that " +
          "proves suppression is eligibility-driven, not a bug that drops idle for everyone");

  // Bar widths: exact percentages by construction (16/4/20 of 40 = 40/10/50%,
  // no rounding remainder) — Ben's row carries all three segments and they
  // must not overrun 100% between them.
  assert_(/width:40%/.test(benRow) && /width:10%/.test(benRow) && /width:50%/.test(benRow),
          "billable/non-billable/idle segment widths match the fixture exactly (40/10/50%)");

  // ── "—", not an empty bar, for zero scheduled capacity (either shape) ──
  var zoeHours = hoursTd_(zoeRow), ivyHours = hoursTd_(ivyRow);
  assert_(zoeHours.indexOf("hbarMini") === -1, "a zero-avail person's Hours cell renders no bar markup");
  assert_(zoeHours.indexOf("—") === 0 || zoeHours.indexOf(">—<") !== -1,
          "…just a literal em dash, isolated to the Hours <td> itself");
  assert_(ivyHours.indexOf("hbarMini") === -1,
          "a person with NO week row for the period (aggWeeks_ null) also renders no bar in Hours");
  assert_(ivyHours.indexOf("—") === 0 || ivyHours.indexOf(">—<") !== -1,
          "…and the same em dash for the null-aggWeeks_ path, not a blank cell");

  // ── Hours sorter: ranks the eligible cohort by billable share, ineligible last ──
  C.setRosterSort_("hours");
  assert_(C.STATE.rosterSort === "hours",
          "the hours column is no longer click-inert now that it has a real sorter (Task 6)");
  var sorted = els.rosterPanel.innerHTML;
  assert_(sorted.indexOf("Ben Ortiz") < sorted.indexOf("Ana Perez") &&
          sorted.indexOf("Ben Ortiz") < sorted.indexOf("Uma Voss"),
          "sorted by Hours, the one ELIGIBLE row with a real billable share ranks ahead of both " +
          "ineligible (ramping/on-leave) rows, regardless of their raw hours being identical to Ben's");
  C.setRosterSort_("hours");   // second click: flips direction, still must not throw
  assert_(C.STATE.rosterDesc === true, "clicking the hours header again flips direction like any other column");
  C.STATE.rosterSort = "opp"; C.STATE.rosterDesc = false;
  C.renderRoster_();

  // ── Sorter-less column guard still holds (regression, see the grading block
  // above): hours filled in is not license for the click guard itself to rot.
  C.ROSTER_COLS_.__fake = { label: "Fake", sort: null };
  var sb = C.STATE.rosterSort, db = C.STATE.rosterDesc;
  C.setRosterSort_("__fake");
  assert_(C.STATE.rosterSort === sb && C.STATE.rosterDesc === db,
          "the click guard still protects a hypothetical future sorter-less column");
  delete C.ROSTER_COLS_.__fake;

  // ── Drill-down: closed by default, opens and closes on the toggle ──
  assert_(html.indexOf("detailRow") === -1, "no drill-down row renders until the ▸ is clicked");

  // Give Ben a backlog with MORE items than the cap, so the truncation note
  // (count > items.length) has something to fire on; one item has no due
  // date, so the missing-date glyph gets exercised too.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.backlog = { count: 3, remHrs: 12, items: [
        { key: "GTT-1", summary: "Fix the thing", status: "In Progress", priority: "High",
          remHrs: 8, due: "2026.W32" },
        { key: "GTT-2", summary: "Other thing", status: "To Do", priority: "Medium",
          remHrs: 4, due: "" },
      ] };
    }
  });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var openHtml = els.rosterPanel.innerHTML;
  assert_(openHtml.indexOf("detailRow") !== -1, "toggling the ▸ opens the drill-down row");
  // The colspan must match the columns actually RENDERED, not every column
  // defined. This assertion used to compare against Object.keys(ROSTER_COLS_)
  // — the total, including the conditional Plan column that when() hides — so
  // it guarded against a hardcoded 7 while locking in the real defect: a colspan
  // wider than the table extends the cell PAST the right edge, which is what
  // pushed the drill-down's Due column out over the row beneath it.
  var visibleCols = C.rosterColKeys_().length;
  // Count the OUTER table's headers only — the drill-down nests its own table,
  // whose <th>s would otherwise be counted as roster columns.
  var outerHead = openHtml.split("detailRow")[0];
  var headerCols = (outerHead.match(/<th\b/g) || []).length;
  assert_(headerCols === visibleCols,
          "header cell count == visible column count (" + headerCols + " vs " + visibleCols + ")");
  assert_(openHtml.indexOf('colspan="' + visibleCols + '"') !== -1,
          "the detail row's colspan matches the RENDERED column count");
  assert_(visibleCols < Object.keys(C.ROSTER_COLS_).length,
          "…and this fixture hides a conditional column, so the two counts genuinely differ — " +
          "otherwise the assertion above proves nothing");

  // ── The methodology MOVED, and nothing in it was lost ──────────────────
  // Every rule here was ratified by the managers (2026-08-10). Moving it behind
  // a link is a presentation choice; losing it would silently change what the
  // table means. So: the wall is gone from the panel, the full text is in the
  // "How these are counted" dialog, and the one rule that has to survive a
  // SCREENSHOT stays in the markup.
  assert_(!/<details class="howto">/.test(openHtml),
          "the old folded methodology block is gone from the default view");
  assert_(/divide by less than the <b>Open issues<\/b> count beside them/.test(openHtml),
          "…the PNG-critical rule stays on the page");
  var mPanel = C.methodPanelHtml_()
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
  assert_(/anything with a date is tracked whatever its status/.test(mPanel),
          "…and the managers' dated-work rule is in the panel");
  // Whitespace-agnostic: the panel uses a real non-breaking space, the old block
  // used the &nbsp; entity, and the RULE is what matters, not the byte.
  assert_(/undated To.Do ticket is ignored entirely/.test(mPanel),
          "…as is the undated-To-Do carve");
  assert_(/every epic is expected to carry a date/.test(mPanel),
          "…and the epic exception");
  assert_(/status category|STARTED/i.test(mPanel), "…and the started-work basis for Logged");
  // The hours legend is NOT folded: this table is read as a PNG, where hover
  // does not exist and a legend behind a click is a legend that is absent.
  var legend = openHtml.split('<details class="howto">')[0] +
               openHtml.split("</details>").slice(1).join("</details>");
  assert_(/billable/.test(legend) && /time off/.test(legend) && /idle/.test(legend),
          "the hours legend stays OUTSIDE the fold — colour is never the only channel");
  assert_(openHtml.indexOf("Tracked 20") !== -1 && openHtml.indexOf("of 40h scheduled") !== -1,
          "the drill-down states the period's hours line");
  assert_(openHtml.indexOf("billable 16h") !== -1 && openHtml.indexOf("non-billable work 4h") !== -1,
          "…including the billable/non-billable split");
  // Scoped to the detail row: the roster's Hours legend names "time off" in the
  // lead paragraph on every render, so a whole-panel search always matches.
  assert_(openHtml.split('class="detailRow"')[1].indexOf("time off") === -1,
          "…with no time-off clause when the person logged none (trackedOff 0)");
  assert_(openHtml.indexOf("GTT-1") !== -1 && openHtml.indexOf("GTT-2") !== -1,
          "both backlog items render in the drill-down table");
  assert_(openHtml.indexOf("Top 2 of 3 listed") !== -1,
          "count (3) > rendered items (2) → the truncation note fires. 'Listed', not 'open': " +
          "since v34 the denominator is what the list CAN show, not the whole backlog");
  // Pick the ROW, not "everything after the first occurrence of the key" — since
  // the key became a link it appears twice per row (href and text), and the naive
  // split lands inside the anchor's attributes.
  var gtt2Cell = openHtml.split("<tr>").filter(function (r) { return r.indexOf("GTT-2") !== -1; })[0] || "";
  assert_(gtt2Cell.indexOf("sigBad") !== -1,
          "an item with no due date shows the sigBad em-dash glyph, not a blank cell");

  assert_(openHtml.indexOf("Show all") === -1,
          "a 2-item list offers no second-level expand — there is nothing behind it");

  // ── WHAT THE WORK BELONGS TO (manager request 2026-08-10) ─────────────────
  // "Epic name along with the ticket assigned so they get a quick view on data
  // relation." A ticket key alone tells a manager nothing about which engagement
  // is at risk; the epic name is the only human-readable link between the two.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.backlog = { count: 3, remHrs: 12, listed: 3, ignoredN: 0, ignoredHrs: 0, epicsN: 0, items: [
        { key: "GTT-1", summary: "Fix the thing", status: "In Progress", priority: "High",
          remHrs: 8, due: "2026.W32", epicKey: "GTT-500", epicName: "Acme migration — phase 2" },
        { key: "GTT-2", summary: "Other thing", status: "In Progress", priority: "Medium",
          remHrs: 4, due: "", epicKey: "GTT-900", epicName: "" },
        { key: "GTT-3", summary: "Orphan", status: "In Progress", priority: "Low",
          remHrs: 2, due: "2026.W33", epicKey: "", epicName: "" },
      ] };
    }
  });
  C.setModel(mdl);
  C.renderRoster_();
  var epicHtml = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_(/>Belongs to</.test(epicHtml), "the list carries a 'Belongs to' column");
  assert_(/Acme migration — phase 2/.test(epicHtml),
          "…showing the epic NAME, which is what makes the row readable without opening Jira");
  assert_(/GTT-500/.test(epicHtml), "…with the key beside it, which is what gets pasted into Jira");
  assert_(/GTT-900/.test(epicHtml) && !/GTT-900<\/span> <span/.test(epicHtml),
          "an epic outside the export window shows its key alone rather than claiming no epic");
  assert_(/— not linked/.test(epicHtml),
          "…and a ticket with NO epic says so explicitly — unlinked hours cannot reach an engagement");
  assert_(/cannot roll up to an engagement/.test(epicHtml),
          "…with the consequence stated, not just the absence");

  // ── JIRA DEEP LINKS (2026-08-10) ──────────────────────────────────────────
  // The keys were already on screen; the only thing missing was a way to open
  // them. What has to hold: the site comes from the payload, the links escape the
  // Apps Script sandbox iframe, and the multi-key link uses `key in (…)` rather
  // than an assignee query Jira Cloud would reject.
  assert_(/href="https:\/\/[^"]+\/browse\/GTT-1"/.test(epicHtml),
          "the ticket key is a link to the issue — got: " + epicHtml.slice(0, 400));
  assert_(/target="_blank" rel="noopener"/.test(epicHtml),
          "…opening in a new tab, which is REQUIRED inside the Apps Script sandbox iframe");
  assert_(/\/browse\/GTT-500"/.test(epicHtml), "the epic is a link too");
  assert_(/>Acme migration — phase 2<\/a>/.test(epicHtml),
          "…with the epic NAME as the link TEXT, so the row still reads as English");
  var openAll = /href="([^"]*\/issues\/\?jql=[^"]+)"/.exec(epicHtml);
  assert_(openAll, "the list offers one link that opens every ticket shown");
  var jql = decodeURIComponent(openAll[1].split("jql=")[1]);
  assert_(/^key in \(GTT-1,GTT-2,GTT-3\)/.test(jql),
          "…as a key-list JQL over exactly the rows on screen — got: " + jql);
  assert_(!/assignee/.test(jql),
          "…and NEVER an assignee query: Jira Cloud has not resolved display names since GDPR, " +
          "so it would fail for some people and quietly return the wrong board for others");
  assert_(/ORDER BY duedate/.test(jql), "…ordered by due date, which is what the queue is worked by");

  // No site configured → no dead links. Same fixture, jiraBase removed, so the
  // ONLY difference is the payload field: a pre-v37 model must render the keys as
  // plain text rather than as hrefs pointing at the Apps Script host.
  var savedBase = mdl.meta.jiraBase;
  delete mdl.meta.jiraBase;
  C.setModel(mdl);
  C.renderRoster_();
  var plain = els.rosterPanel.innerHTML.split('class="detailRow"')[1] || "";
  assert_(/GTT-1/.test(plain), "the keys are still shown without a Jira site — got: " + plain.slice(0, 200));
  assert_(!/href=/.test(plain),
          "…as plain text: no href at all, rather than a link to /browse/KEY on the wrong host");
  assert_(!/↗/.test(plain), "…and no 'open in Jira' affordance that could not work");
  mdl.meta.jiraBase = savedBase;
  C.setModel(mdl);
  C.renderRoster_();

  // ── UNSTARTED + UNDATED TICKETS ARE NOT LISTED (user report 2026-08-10) ────
  // "I still see tickets in the status To Do with no due date in each rocketeer."
  // The server drops them from `items`; what has to hold here is that the row
  // still ACCOUNTS for them, so a shorter list never reads as a smaller load.
  C.toggleRosterDetail_("Ben Ortiz");   // close before reseeding
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.backlog = { count: 9, remHrs: 40, listed: 2, ignoredN: 7, ignoredHrs: 12, epicsN: 3, items: [
        { key: "GTT-1", summary: "Fix the thing", status: "In Progress", priority: "High",
          remHrs: 8, due: "2026.W32" },
        { key: "GTT-2", summary: "Other thing", status: "In Progress", priority: "Medium",
          remHrs: 4, due: "" },
      ] };
    }
  });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var ignHtml = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_(!/Top 2 of 9/.test(ignHtml) && !/of 9 listed/.test(ignHtml),
          "the list never advertises the 9 open tickets as listable — it can only ever reach 2");
  // Count the issue LINKS, not the string "GTT-": since 2026-08-10 each key
  // appears three times per row (href, title, text) and once more in the
  // open-all JQL, so a substring count no longer counts tickets.
  assert_((ignHtml.match(/\/browse\/GTT-/g) || []).length === 2,
          "…and exactly the two listable tickets are rendered");
  // The reconciliation line: n must be accounted for, item by item, or the reader
  // is left assuming the dashboard lost the difference (user report 2026-08-10).
  // COLLAPSED, with the arithmetic in the summary and the reasoning behind the
  // disclosure (user 2026-08-10 — the paragraph was overflowing the table).
  assert_(/<details class="reconBox"><summary>/.test(ignHtml),
          "the reconciliation is collapsed, not five lines of prose on every open row");
  assert_(/<b>12 open items<\/b> behind <b>Open issues<\/b> — 2 listed · 7 ignored · 3 epics/.test(ignHtml),
          "…and the SUMMARY carries the arithmetic, which is the part read at a glance — got: " + ignHtml);
  assert_(/<b>2<\/b> listed below/.test(ignHtml) && /<b>7<\/b> unstarted with no due date/.test(ignHtml) &&
          /<b>3<\/b> epics/.test(ignHtml),
          "…with the reasons inside, broken into all three exclusions");
  assert_(/roll up their children/.test(ignHtml),
          "…saying why epics are never in the list, rather than leaving it as an omission");
  assert_(/snapshot of open work/.test(ignHtml),
          "…and that this list follows no period, which is the other half of the question asked");
  assert_(/ignored by rule/.test(ignHtml),
          "…named as a rule rather than as a finding — they are not anybody's queue");
  assert_(/none of these three numbers is the one being graded/.test(ignHtml),
          "…and warns that the graded cells use narrower denominators again");

  // A person whose ENTIRE backlog is ignored must not read as having no work.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") p.backlog = { count: 5, remHrs: 20, listed: 0, ignoredN: 5, ignoredHrs: 20, items: [] };
  });
  C.setModel(mdl);
  C.renderRoster_();
  var allIgn = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_(/<b>5 open items<\/b> behind <b>Open issues<\/b>/.test(allIgn),
          "an all-ignored backlog still accounts for every ticket…");
  assert_(/<b>5<\/b> unstarted with no due date/.test(allIgn), "…naming them as the ignored ones");
  assert_(!/No open backlog items attributed/.test(allIgn),
          "…and never 'nothing attributed', which would hide a real backlog");
  assert_(!/<b>0<\/b> listed below/.test(allIgn),
          "…with no empty '0 listed' clause — a part of the breakdown that is zero is left out");
  C.toggleRosterDetail_("Ben Ortiz");   // close — teardown
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.backlog = { count: 3, remHrs: 12, listed: 2, ignoredN: 0, ignoredHrs: 0, items: [
        { key: "GTT-1", summary: "Fix the thing", status: "In Progress", priority: "High",
          remHrs: 8, due: "2026.W32" },
        { key: "GTT-2", summary: "Other thing", status: "To Do", priority: "Medium",
          remHrs: 4, due: "" },
      ] };
    }
  });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  openHtml = els.rosterPanel.innerHTML;

  C.toggleRosterDetail_("Ben Ortiz");   // second click: closes it again
  var closedHtml = els.rosterPanel.innerHTML;
  assert_(closedHtml.indexOf("detailRow") === -1, "toggling the SAME ▸ again closes the drill-down row");

  // ── SECOND-LEVEL EXPAND (manager request 2026-08-10) ───────────────────────
  // 8 shown by default, the rest one click away, and NO round-trip: the payload
  // already carries them. Pinned because the failure mode is silent — a row that
  // shows 8 of 20 and offers no way to the other 12 looks perfectly finished.
  var deep = [];
  for (var di = 0; di < 20; di++) {
    deep.push({ key: "DEEP-" + di, summary: "s" + di, status: "In Progress",
                priority: "High", remHrs: 20 - di, due: "2026.W33" });
  }
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") p.backlog = { count: 20, remHrs: 100, items: deep };
  });
  mdl.meta.backlogItemsShown = 8;
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var deepHtml = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_((deepHtml.match(/\/browse\/DEEP-/g) || []).length === 8,
          "the row opens on 8 items — the default the managers asked to keep");
  assert_(deepHtml.indexOf("Top 8 of 20 listed") !== -1, "…and says which 8 of how many");
  assert_(deepHtml.indexOf("▾ Show all 20") !== -1, "…offering the whole list as a second expand");
  assert_(deepHtml.indexOf("payload carries") === -1,
          "no payload-cap disclosure when nothing was clipped — 20 of 20 are carried");

  C.toggleRosterDetailAll_("Ben Ortiz");
  var allHtml = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_((allHtml.match(/\/browse\/DEEP-/g) || []).length === 20,
          "expanding shows every carried item, with no server round-trip");
  assert_(allHtml.indexOf("▴ Show top 8") !== -1, "…and offers the way back to the short read");

  // Collapsing the person forgets the deep expand: reopening gives the same short
  // read every time, rather than whatever depth was left behind earlier.
  C.toggleRosterDetail_("Ben Ortiz");
  C.toggleRosterDetail_("Ben Ortiz");
  var reopened = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_((reopened.match(/\/browse\/DEEP-/g) || []).length === 8,
          "a collapse resets the second level — reopening is always the 8-item read");
  C.toggleRosterDetail_("Ben Ortiz");   // close — teardown

  // Payload CLIPPED: the person has more open work than the payload carries. All
  // three numbers have to be distinguishable, or "we cleared them all" goes wrong.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") p.backlog = { count: 75, remHrs: 300, listed: 75, items: deep };
  });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var clippedHtml = els.rosterPanel.innerHTML.split('class="detailRow"')[1];
  assert_(clippedHtml.indexOf("Top 8 of 75 listed") !== -1,
          "the count is every listable ticket the person has, not what the payload happens to hold");
  assert_(clippedHtml.indexOf("payload carries the 20 largest") !== -1 &&
          clippedHtml.indexOf("cover all 75") !== -1,
          "…and a clipped payload says so, naming both numbers");
  C.toggleRosterDetail_("Ben Ortiz");   // close — teardown
  // Backlog note is ABSENT once nothing is truncated, ignored or clipped: a note
  // on a row that shows everything is noise, and noise on the healthy rows is what
  // teaches people to skip the line on the rows where it matters.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.backlog = { count: 2, remHrs: 12, listed: 2, ignoredN: 0, ignoredHrs: 0, items: [
        { key: "GTT-1", summary: "Fix the thing", status: "In Progress", priority: "High",
          remHrs: 8, due: "2026.W32" },
        { key: "GTT-2", summary: "Other thing", status: "In Progress", priority: "Medium",
          remHrs: 4, due: "" },
      ] };
    }
  });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var noCapHtml = els.rosterPanel.innerHTML;
  assert_(noCapHtml.indexOf("GTT-1") !== -1, "…with the items themselves still rendered");
  assert_(noCapHtml.indexOf("(by remaining hours)") === -1,
          "no truncation note once the backlog cap didn't actually truncate anything");
  assert_(noCapHtml.indexOf("not listed") === -1,
          "…and no ignored-tickets sentence when there are none to ignore");
  C.toggleRosterDetail_("Ben Ortiz");   // close again — teardown

  // A person with no backlog at all gets an explicit empty state.
  C.toggleRosterDetail_("Ana Perez");
  var anaOpen = els.rosterPanel.innerHTML;
  assert_(anaOpen.indexOf("No open backlog items attributed to this person.") !== -1,
          "a person with backlog:null gets an explicit empty state, not a blank cell");
  C.toggleRosterDetail_("Ana Perez");   // close — teardown

  // A person with no week row for the period at all — the drill-down's OTHER
  // empty state (distinct from "no backlog items").
  C.toggleRosterDetail_("Ivy Preh");
  var ivyOpen = els.rosterPanel.innerHTML;
  assert_(ivyOpen.indexOf("No scheduled capacity in 2026.W31") !== -1,
          "a person with no week row for the period gets its own empty state, not a false 'Tracked 0h'");
  C.toggleRosterDetail_("Ivy Preh");   // close — teardown

  // Teardown, same convention as the sibling block above.
  resetFilters();
  C.STATE.rosterSort = "opp"; C.STATE.rosterDesc = false;
  C.STATE.typePop = "open";
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 👥 EXECUTIVE PULSE (spec §4.3, Task 7, 2026-08-05) ──────────────────────
// Counts-only summary card on the Executive tab: never a name (roster detail
// lives behind the Actions gate), hidden — not dimmed — below the margin
// tier (same doctrine as the Utilization card), and its recoverable-hours
// figure walks metricSeries_(METRICS_.util, done) -> oppRows_ over the head
// period — the same computation the retired headroom table used to headline.
(function () {
  var mdl = fresh(histModel({}));
  resetFilters();
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("view", "exec");
  C.setState("typePop", "open");
  mdl.personHygiene = {
    open: [
      { person: "Ana Perez", n: 10, due: 10, est: 10, logged: 10 },  // 100% everywhere -> good
      { person: "Ben Ortiz", n: 10, due: 6,  est: 10, logged: 10 },  // due 60% (< gate-0.10) -> bad
      { person: "Cleo Diaz", n: 20, due: 15, est: 20, logged: 20 },  // due 75% (in [gate-0.10, gate)) -> warn
      { person: "Dev Rao",   n: 1,  due: 0,  est: 0,  logged: 0 },   // n < signalMinN -> small
    ],
    resolved: [],
  };
  mdl.meta.signalMinN = 4;
  C.setModel(mdl);
  C.renderAll_();
  var pulse = els.pulsePanel.innerHTML;

  assert_(pulse.indexOf("on track") !== -1, "pulse renders counts");
  assert_(/1 on track/.test(pulse) && /1 watch/.test(pulse) && /1 need action/.test(pulse),
          "the four graded fixture rows land good/warn/bad 1-1-1");
  assert_(/1 ungraded \(small n\)/.test(pulse),
          "the small-n row surfaces its own count, never folded into 'need action'");

  // NO names on the Executive pulse — check every synthetic person by name.
  C.getModel().people.forEach(function (p) {
    assert_(pulse.indexOf(p.name) === -1, "pulse must not name " + p.name);
  });

  // Recoverable hours must equal the same walk done by hand — head period,
  // cohort norm, ramping excluded, sub-half-hour gaps ignored — so a change to
  // oppRows_'s exclusions or the pulse's own filter can't slip through.
  var doneP = C.donePeriods_();
  var headP = doneP[doneP.length - 1];
  var serP = C.metricSeries_(C.METRICS_.util, doneP);
  assert_(serP.std && serP.std.ok, "sanity: the pulse fixture establishes an operating rate");
  var expOpp = 0;
  C.oppRows_(headP, serP.std.baseline).forEach(function (r) {
    if (!r.ramping && r.opp > 0.5) expOpp += r.opp;
  });
  var pulseBig = /<b>([0-9]+)h<\/b> recoverable/.exec(pulse);
  assert_(pulseBig, "pulse published its own recoverable-hours figure");
  assert_(pulseBig[1] === String(Math.round(expOpp)),
          "pulse recoverable hours (" + pulseBig[1] + "h) equals the oppRows_ walk (" +
          Math.round(expOpp) + "h)");

  // The small-n clause is CONDITIONAL — omitted entirely when s.small === 0,
  // never rendered as "0 ungraded".
  mdl.personHygiene.open.pop();
  mdl.personHygiene.open.push({ person: "Dev Rao", n: 10, due: 10, est: 10, logged: 10 });
  C.setModel(mdl);
  C.renderAll_();
  assert_(els.pulsePanel.innerHTML.indexOf("ungraded") === -1,
          "no small-n row in the fixture -> no 'ungraded (small n)' clause at all");

  // Margin gate: hidden, not dimmed.
  C.getModel().viewerRole = "guest";
  C.renderAll_();
  assert_(document.getElementById("pulsePanel").innerHTML === "",
          "pulse hidden from open-access guests");
  assert_(document.getElementById("pulsePanel").style.display === "none",
          "…the panel itself is display:none, not just emptied — no ghost heading left behind");
  C.getModel().viewerRole = "admin";
  C.renderAll_();
  assert_(document.getElementById("pulsePanel").style.display === "",
          "…and restored for an admin");

  // Pre-v22 payload: personHygiene missing entirely -> a plain message, not a
  // silent empty pulse (same doctrine as the roster/matrix's own "Not in this
  // payload" states).
  var legacy = fresh(histModel({}));
  delete legacy.personHygiene;
  C.renderAll_();
  assert_(/People signals arrive after the next refresh/.test(els.pulsePanel.innerHTML),
          "a pre-v22 payload says so plainly rather than rendering an empty pulse");

  // Deep link: opens Actions pre-sorted by opportunity, ascending (worst first).
  C.STATE.rosterSort = "due"; C.STATE.rosterDesc = true;   // prove openRoster_ actually resets these
  C.setState("view", "exec");
  C.openRoster_();
  assert_(C.STATE.view === "actions" && C.STATE.rosterSort === "opp" && C.STATE.rosterDesc === false,
          "deep link lands sorted by opportunity, ascending (worst first)");

  // Teardown — same convention as the sibling blocks above.
  resetFilters();
  C.STATE.rosterSort = "opp"; C.STATE.rosterDesc = false;
  C.STATE.typePop = "open";
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 👥 ROSTER CSV ROW GRAMMAR (Task 7 review finding, 2026-08-05) ───────────
// rosterCsvLines_ is the pure builder saveCsv_ calls before handing off to
// downloadCsv_ (DOM Blob/anchor — not reachable from this Node harness), so
// it is the seam that makes the CSV's row-level honesty testable at all:
//   - small-n rows keep their REAL percentages — small-n suppresses GRADING,
//     never MEASUREMENT — and land Overall "na" (worst rank never counts
//     "small").
//   - a zero-issue person's percentage cells are blank (gradeSignal_ returns
//     pct:null for n=0), not a fabricated "0%".
//   - an ineligible (ramping/on-leave) row blanks Idle h and carries the
//     Note; an eligible row gets a real Idle number and an empty Note —
//     same rule as the roster's own Hours-column eligibility (Task 6).
(function () {
  var mdl = fresh(model({}));
  resetFilters();
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  C.setState("typePop", "open");
  mdl.meta.signalMinN = 4;
  mdl.people.push(person("Rae Ramping", { newHire: true }));
  mdl.people.push(person("Ollie OnLeave", { onLeave: true }));
  // Ben Ortiz's tracked hours are shorted so his Idle cell is a nonzero
  // number — the contrast that proves the ineligible rows' blank Idle is
  // eligibility-driven, not a fixture where everyone happens to compute 0.
  mdl.people.forEach(function (p) {
    if (p.name === "Ben Ortiz") {
      p.weeks["2026.W31"] = week({ tracked: 30, billable: 22, nonBillable: 8,
                                    trackedCov: 30, nsBillRaw: 22, nsNonBillRaw: 8 });
    }
  });
  mdl.personHygiene = {
    open: [
      { person: "Ana Perez",    n: 2,  due: 1,  est: 2,  logged: 0 },  // n < signalMinN -> small
      { person: "Ben Ortiz",    n: 0,  due: 0,  est: 0,  logged: 0 },  // zero issues -> na, blank %
      { person: "Rae Ramping",  n: 10, due: 10, est: 10, logged: 10 }, // eligible-grading, ineligible-hours
      { person: "Ollie OnLeave", n: 10, due: 10, est: 10, logged: 10 },
    ],
    resolved: [],
  };
  C.setModel(mdl);
  var lines = C.rosterCsvLines_();
  assert_(lines !== null, "a payload with personHygiene builds CSV lines");
  // Still an EXACT-string contract, but the signal block is derived rather than
  // retyped: those columns are generated from SIGNAL_FIELDS_, so a literal copy
  // here just goes stale the next time a signal is added.
  var expectSig = C.SIGNAL_FIELDS_.map(function (f) {
    return f.label + " %," + f.label + " missing";
  }).join(",");
  assert_(lines[0] === "Person,Job title,Region,Issues (all incl. epics)," +
                        "Listed,Ignored (unstarted no due date),Epics," + expectSig +
                        ",Overall,Est h,Logged h,Progress %,In progress," +
                        "Billable h,Non-billable work h,Time off h,Idle h,Planned h,Capacity h,State",
          "the header row matches the brief's exact column string");
  // The bare "n" is GONE from the export as well as the screen: the spreadsheet is
  // what gets mailed to the person being asked to fix a gap, and it has neither a
  // tooltip nor a drill-down to rescue an unexplained letter.
  assert_(lines[0].indexOf(",n,") === -1, "…with no bare 'n' column left in the export");
  assert_(/,Listed,Ignored \(unstarted no due date\),Epics,/.test(lines[0]),
          "…and the three parts of the count travel with it, so the reconciliation survives export");
  // Planned/Capacity ship on EVERY export, not only while the Plan column is on
  // screen (2026-08-06): a header that moves with a dropdown cannot be appended
  // to, and this fixture is a COMPLETE window — the column is off in the UI here.
  assert_(lines[0].indexOf("Planned h,Capacity h") !== -1,
          "…including the planning columns, on a complete window too");
  // The brief's single "Non-billable h" became two columns (user 2026-08-06):
  // tracked time off sits inside non-billable by rule, so a spreadsheet reader
  // summing the old column was adding holidays to unbilled project work.
  assert_(lines[0].indexOf("Non-billable h") === -1,
          "…with the undivided non-billable column deliberately gone, not merely renamed alongside");

  // Columns resolved BY HEADER NAME, not by position. This block used to index
  // (ana[10], ben[13]…) and every one of those broke at once when the roster
  // gained signal fields and the non-billable column split in two — twice over,
  // from two independent changes, which is the tell that the idiom was wrong
  // rather than the expectations. The assertions below are the SAME contract.
  var csvCols = lines[0].split(",");
  function rowFields(name) {
    var row = lines.filter(function (l) { return l.indexOf(name + ",") === 0; })[0];
    assert_(row, "a CSV row exists for " + name);
    var f = row.split(",");
    return function (col) {
      var i = csvCols.indexOf(col);
      assert_(i !== -1, "CSV has a '" + col + "' column");
      return f[i];
    };
  }

  // Small-n row: REAL ratios, not suppressed — small-n gates GRADING only.
  var ana = rowFields("Ana Perez");
  assert_(ana("Issues (all incl. epics)") === "2", "Ana's n is the real count (2), not zeroed by small-n");
  assert_(ana("Due date %") === "50" && ana("Due date missing") === "1",
          "Due %: real 50% (1 of 2), 1 missing — small-n never hides the ratio");
  assert_(ana("Estimate %") === "100" && ana("Estimate missing") === "0", "Estimate %: real 100% (2 of 2), 0 missing");
  assert_(ana("Logged %") === "0" && ana("Logged missing") === "2", "Logged %: real 0% (0 of 2), 2 missing");
  assert_(ana("Overall") === "na", "small-n Overall is 'na' — 'small' never contributes to the worst-rank verdict");

  // Zero-issue person: blank percentages (null, not a fabricated 0%), n = 0.
  var ben = rowFields("Ben Ortiz");
  assert_(ben("Issues (all incl. epics)") === "0", "Ben's n is 0");
  assert_(ben("Due date %") === "" && ben("Estimate %") === "" && ben("Logged %") === "",
          "a zero-issue person's percentage cells are BLANK, not '0%' — nothing was measured to grade");
  assert_(ben("Due date missing") === "0" && ben("Estimate missing") === "0" && ben("Logged missing") === "0",
          "…and the missing counts are 0, not blank");
  assert_(ben("Overall") === "na", "zero-issue Overall is 'na'");
  assert_(ben("Idle h") === "10", "Ben is eligible: Idle h is a real number (avail 40 - shorted tracked 30 = 10)");
  assert_(ben("State") === "", "…and an eligible row's State is empty");

  // Ineligible rows: blank Idle, State names the reason.
  var rae = rowFields("Rae Ramping");
  assert_(rae("Idle h") === "", "a ramping new hire's Idle h is blank");
  assert_(rae("State") === "ramping new hire", "…and the State says why");
  var ollie = rowFields("Ollie OnLeave");
  assert_(ollie("Idle h") === "", "an on-leave person's Idle h is blank");
  assert_(ollie("State") === "on leave", "…and the State carries the on-leave wording, distinct from ramping");

  // Pre-v22 payload: the pure builder returns null (saveCsv_ no-ops on it),
  // same contract as personSignalRows_ itself.
  var legacy = fresh(model({}));
  delete legacy.personHygiene;
  assert_(C.rosterCsvLines_() === null,
          "rosterCsvLines_ returns null on a pre-v22 payload, so saveCsv_ can no-op rather than download an empty file");

  // Teardown.
  resetFilters();
  C.STATE.typePop = "open";
  C.setState("view", "exec");
  fresh(model({}));
})();

// ── 🌊 FLOW TILES — compact tier inside Executive (spec 2026-08-05 §4.1) ──
// The 🌊 Flow tab is retired; its five live tiles render into #flowTiles
// inside the Executive pane instead, and the two declared-absent placeholders
// (Cycle Time, Flow Efficiency) no longer render at all.
(function () {
  var M = C.getModel();
  var who = M.people[0].name;   // a real fixture person who passes open filters
  var W = WEEKS[WEEKS.length - 1];             // latest complete week
  M.leadTimeBuckets = [{ iso: W, person: who, n: 2, nAll: 3, days: [4, 10] }];
  M.throughputBuckets = [{ iso: W, person: who, nAll: 3, nEst: 2, estHrs: 12.5 }];
  M.flowOpenBuckets = [{ person: who, wipN: 3, todoN: 5, todoEst: 4, todoHrs: 22.5 }];
  M.bugWeekly = [{ iso: W, nCreated: 4, nResolved: 1 }];
  M.meta.bugsAvailable = true;
  M.meta.flowSnapshotsAvailable = true;
  M.meta.flowSnapshots = [
    { iso: WEEKS[0], at: "", wip: 2, backlogHrs: 30, backlogN: 6 },
    { iso: W,        at: "", wip: 3, backlogHrs: 22.5, backlogN: 5 },
  ];
  M.meta.flowUncategorized = 0;
  M.meta.jiraUnattributed = Object.assign({}, M.meta.jiraUnattributed,
    { leadTime: 0, throughput: 0, flowOpen: 0 });
  // Regression pin (final review, 2026-08-05): flowUnfiltered_ used to compare
  // filteredPeople_().length to MODEL.people.length, which can never be equal
  // on a real payload — an attribOnly stub and the default FTE lens both widen
  // that gap. Shape the fixture the same way so this test would have caught it.
  M.people.push({ name: "Sol Architect", region: "SEA", teams: [], pms: [],
                  isCrew: false, jobTitle: "", onLeave: false, isManager: false,
                  jobFamily: "", tracks: false, newHire: false, backlog: null,
                  weeks: {}, attribOnly: true });
  M.people.push(person("Cara Crew", { isCrew: true }));
  // Registry entries ride in meta.registry — give the renderer the real ones.
  M.meta.registry.metrics.leadTime = { id: "leadTime", name: "Lead Time", unit: "days",
    target: null, coverageGate: 0.9, coverageOf: "resolved non-epic issues carrying both dates" };
  M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
    target: null, coverageGate: 0.6, coverageOf: "resolved non-epic issues carrying an estimate" };
  M.meta.registry.metrics.backlog = { id: "backlog", name: "Backlog (Inventory)", unit: "hrs",
    target: null, coverageGate: 0.6, coverageOf: "waiting items carrying an estimate" };
  M.meta.registry.metrics.wip = { id: "wip", name: "Work In Progress", unit: "items",
    target: null, coverageGate: 0 };
  M.meta.registry.metrics.bugCount = { id: "bugCount", name: "Bug Count", unit: "bugs",
    target: null, coverageGate: 0 };
  M.meta.registry.metrics.cycleTime = { id: "cycleTime", name: "Cycle Time", status: "absent",
    absentReason: "needs first-In-Progress date from the Jira changelog — not yet exported" };
  M.meta.registry.metrics.flowEfficiency = { id: "flowEfficiency", name: "Flow Efficiency",
    status: "absent", absentReason: "needs per-status dwell time from the Jira changelog — not yet exported" };
  C.setModel(M);

  // The tab is gone — "flow" is no longer a VIEWS entry, only a render target.
  assert_(C.VIEWS.filter(function (v) { return v.id === "flow"; }).length === 0,
          "🌊 Flow is retired from VIEWS — no tab, no route");

  C.setState("view", "exec");
  C.setState("period", "week");
  C.setState("periodIdx", null);
  C.renderAll_();
  var h = flowHtml_();

  assert_(h.indexOf("Lead Time") !== -1 && h.indexOf("7d") !== -1,
          "lead-time median of [4,10] renders 7d");
  assert_(h.indexOf("p85") !== -1, "p85 companion stated");
  assert_(h.indexOf("Throughput") !== -1 && h.indexOf("2 of 3 resolved issues carried an estimate") !== -1,
          "throughput states its estimated-share coverage in words");
  // Cleared (Task 16B review finding): the items-count sibling of Throughput's
  // hours, reading the SAME bucket (nAll = 3 resolved issues).
  assert_(h.indexOf("Cleared") !== -1, "Cleared tile renders using reg.cleared (Task 16B)");
  var clearedSeg = h.split("Cleared")[1].split("Arrived")[0];
  assert_(/class="big">3</.test(clearedSeg), "Cleared's headline is the resolved-item count (nAll = 3), not Throughput's hours");
  assert_(h.indexOf("Bug Count") !== -1 && h.indexOf("4") !== -1 &&
          h.indexOf("population-wide") !== -1,
          "bug tile renders the created count and states it is unfiltered");
  // Task 16B RETIREMENT: Backlog (Inventory) and WIP no longer render as their
  // own flow-tier tiles — the hero band (#backlogBand) already carries both
  // figures from the SAME underlying data (flowOpenFor_, which this fixture's
  // wipN:3/todoN:5 feeds). Two renderings of one number was the exact
  // duplication this task exists to remove.
  assert_(h.indexOf("Work In Progress") === -1 && h.indexOf("Backlog (Inventory)") === -1,
          "flow tier renders NO Backlog/WIP tiles (Task 16B retirement)");
  var heroSub = document.getElementById("flowSecondary").innerHTML
                  .split("Assigned inventory")[1] || "";
  assert_(/3 in progress/.test(heroSub) && /5 queued/.test(heroSub),
          "…the SAME wipN(3)/todoN(5) figures publish exactly once, on the Runway cluster's assigned card");
  // No-target grammar: the UNIT-BEARING flow tiles (Cleared/Arrived/Lead
  // Time/Throughput/Bug Count) carry NO RAG verdict and NO vs-target line —
  // scoped to exclude On-Time/Forecast/Quality, which now share #flowTiles
  // (Task 16B) and legitimately DO carry a target.
  // NOTE: split on the '<div class="lbl">…' TILE-BOUNDARY marker, not the bare
  // label text — "Throughput"/"On-Time Delivery" also appear inside OTHER
  // tiles' own tooltip prose (e.g. Cleared's detail references "Throughput's
  // hours"), and a bare indexOf/split finds that first, silently including
  // the very tiles this segment means to exclude.
  var throughputLbl = h.indexOf('<div class="lbl">Throughput');
  var pureFlowSeg = h.split('<div class="lbl">On-Time Delivery')[0] + h.slice(throughputLbl);
  assert_(pureFlowSeg.indexOf("below target") === -1 && pureFlowSeg.indexOf("above target") === -1 &&
          pureFlowSeg.indexOf('class="tgt"') === -1,
          "target: null → no target chip and no vs-target sentence on the unit-bearing flow tiles");
  // Absent placeholders retired (spec 2026-08-05 §4.1): the compact tier must
  // not render Cycle Time / Flow Efficiency "—" tiles.
  assert_(h.indexOf("Cycle Time") === -1 && h.indexOf("Flow Efficiency") === -1,
          "declared-absent flow tiles no longer render");
  assert_(h.indexOf("Lead Time") !== -1, "live flow tiles render inside the exec strip");

  // Missing feeds degrade, never error: kill both new feeds and re-render.
  M.meta.bugsAvailable = false;
  M.meta.flowSnapshotsAvailable = false;
  M.meta.flowSnapshots = [];
  C.setModel(M);
  C.renderAll_();
  var h2 = flowHtml_();
  assert_(h2.indexOf("export predates Jira Backlog.js v3.9.0") !== -1,
          "absent feeds name the exporter version, not an error");
})();

// ── THE DRILL-DOWN'S METRIC SET IS NARROWED (user 2026-08-17) ───────────────
// Lead Time, Throughput, Cleared per Person and Assigned wks to clear left the
// Drill-down — both halves of it, the metric chips AND the grid columns under
// the chart. The block this replaces was written when Lead Time and Throughput
// were ADDED (Task 10) and pinned them charting; what is pinned now is that
// they do not, that the accessors they still need are untouched, and that
// selecting a removed metric cannot strand the panel.
(function () {
  var M = fresh(model({}));
  var W = WEEKS[WEEKS.length - 1];             // latest complete week
  M.leadTimeBuckets = [{ iso: W, person: "Ana Perez", days: [10, 15], nRes: 2 }];
  M.throughputBuckets = [{ iso: W, person: "Ana Perez", nAll: 3, nEst: 2, estHrs: 412 }];
  C.setModel(M);
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.STATE.compare = "region";
  C.renderAll_();

  // ── Gone from BOTH halves of the drill-down ──────────────────────────────
  var REMOVED = ["leadTime", "throughput", "clearedPerHead", "queueCover"];
  REMOVED.forEach(function (id) {
    assert_(C.METRIC_ORDER_.indexOf(id) === -1, id + " is out of the drill-down chip list");
    assert_(C.GRID_METRIC_IDS_.indexOf(id) === -1, id + " is out of the drill-down grid columns");
    assert_(C.liveMetrics_().indexOf(id) === -1, id + " cannot be selected as the charted metric");
    assert_(C.gridMetrics_().indexOf(id) === -1, id + " draws no grid column");
  });
  // Asserted on the rendered chips too, not only on the arrays: the label is
  // what a reader actually sees, and a chip could be built from a second list.
  var chipsHtml = C.metricChips_();
  assert_(chipsHtml.indexOf("Lead Time") === -1 && chipsHtml.indexOf("Throughput") === -1,
          "…and neither label renders as a chip");
  assert_(chipsHtml.indexOf("Cleared per Person") === -1 &&
          chipsHtml.indexOf("Assigned wks to clear") === -1,
          "…nor do the other two");

  // ── What SURVIVES, asserted positively ───────────────────────────────────
  // "Everything is missing" must never pass as "the right things are missing".
  assert_(chipsHtml.indexOf("On-Time Delivery") !== -1, "On-Time still charts");
  assert_(chipsHtml.indexOf("Forecast Accuracy") !== -1, "Forecast still charts");
  assert_(chipsHtml.indexOf("Quality / Rework") !== -1, "Quality / Rework still charts");
  assert_(C.gridMetrics_().indexOf("quality") !== -1,
          "…and Quality is a grid column now, so the chips and the table below them agree");

  // ── Selecting a removed metric cannot strand the panel ───────────────────
  // STATE.metric survives in a bookmark and in this session's own state, so a
  // reader who had Lead Time selected before the deploy must land somewhere
  // real rather than on an empty chart.
  C.setState("metric", "leadTime");
  var m = C.activeMetric_();
  assert_(C.STATE.metric !== "leadTime", "a stale metric selection is re-pointed, not honoured");
  assert_(m && typeof m.label === "function", "…to a live metric, so the panel still renders");
  C.renderAll_();
  assert_(document.getElementById("comparePanel").innerHTML.indexOf("Lead Time") === -1,
          "…and the chart does not draw the removed metric anyway");

  // ── The ACCESSORS stay, because Tier 2's compact tiles still read them ────
  // This is the half of the old block that still applies: the tiles were never
  // the thing being removed, and deleting the accessors with the chips would
  // have taken Lead Time and Throughput off the dashboard entirely.
  var thrCov = C.METRICS_.throughput.coverage([W]);
  assert_(typeof thrCov === "number" && isFinite(thrCov),
          "throughput coverage is a real finite number, never NaN (fixture nEst 2 / nAll 3)");
  assert_(Math.abs(thrCov - 2 / 3) < 1e-9, "…and equals nEst/nAll exactly");
  assert_(C.METRICS_.throughput.n([W]) === 2,
          "n() reports nEst (the measurable count), not the nonexistent `.n` field");
  assert_(C.METRICS_.leadTime.value([W]) === 12.5,
          "lead time still computes its median (10,15 → 12.5) for the Tier 2 tile");
  // The tiles themselves must still draw. If this fails, the removal reached
  // further than the drill-down and two metrics left the product silently.
  var flow = flowHtml_();
  assert_(flow.indexOf("Lead Time") !== -1, "Lead Time still has its compact tile in Tier 2");
  assert_(flow.indexOf("Throughput") !== -1, "…and so does Throughput");

  // Teardown (sibling discipline): restore the standard fixture and state.
  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  fresh(model({}));
  C.switchView_("exec");
  C.renderAll_();
})();

// ── EXECUTIVE DATA-TRUST STRIP (Task 8, spec §4.4) ──────────────────────────
// Four fill-vs-gate tiles, picked BY KEY from the same gapsRows_ definitions
// the Actions-tab gaps queue renders from — one list, two surfaces. Org-wide
// and unfiltered (ORG scope tag), unlike the margin-gated pulse panel above it.
(function () {
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  C.renderTrust_();
  var trust = document.getElementById("trustPanel").innerHTML;
  // Task 13 re-head: "Can we publish these numbers?" replaces "🔍 Data trust",
  // with the sub-line stating what the strip is actually answering. Mechanics
  // (gapsRows_ source, tile count/order/values, ORG tag, retire-at-100%) are
  // asserted unchanged below — this is a COPY-ONLY change, and the checks
  // pin exactly that: the old heading is gone, the new one (and its sub-line)
  // is there, and nothing else in this block had to change to stay green.
  assert_(/<h3>Can we publish these numbers\?/.test(trust), "re-headed to the new heading");
  assert_(/Each metric needs its gate met before it goes on a slide\./.test(trust),
          "…with its sub-line stating what the strip actually answers");
  assert_(!/Data trust/.test(trust), "the old '🔍 Data trust' heading is gone, not merely joined by the new one");
  // THREE tiles since 2026-08-17: the fourth was Roster join, removed with the
  // rest of the per-parameter compliance summaries. Asserted as an exact count
  // so a re-added tile fails here rather than quietly rejoining the strip.
  assert_(trust.split("trustItem").length - 1 === 3, "exactly three trust tiles");
  assert_(!/Roster join/.test(trust), "…and the removed one is not among them");
  assert_(trust.indexOf("ORG") !== -1, "trust strip carries the ORG scope tag");
  // Order + identity: est, due, logged (brief order) — each tile is
  // recognisable by the plain-language title gapsRows_ assigns its key.
  var order = ["Estimate coverage", "Due-date fill", "Logged fill"];
  var idxs = order.map(function (t) { return trust.indexOf(t); });
  assert_(idxs.every(function (i) { return i !== -1; }), "all three tile titles present");
  assert_(idxs[0] < idxs[1] && idxs[1] < idxs[2],
          "tiles render in brief order: est, due, logged");
  // Values against the model fixture's single headline week (2026.W31):
  // due 40/50=80% (at its 80% gate → green), est 14/20=70% (at gate → green),
  // logged 9/14≈64% (below the 70% gate but within the 10-pt band → amber),
  assert_(/80%/.test(trust) && /70%/.test(trust), "due-date and estimate percentages render");
  assert_(/64%/.test(trust), "logged-fill percentage renders below its gate");
  assert_(/var\(--c-warn\)/.test(trust), "the below-gate logged tile is graded amber, not red or green-only");
  assert_(/Blocks: Forecast Accuracy/.test(trust), "each tile's tooltip states what it blocks (shared gapsRows_ note)");
  // The footer used to point DOWN this tab to the full gaps queue. That queue was
  // deleted on 2026-08-17, so the pointer had to go with it: a signpost to a
  // panel that is not there is worse than no signpost, and it is exactly the
  // drift this check was written to catch — only in the other direction.
  assert_(!/further down this tab/.test(trust),
          "the footer no longer points at the deleted gaps queue");
  assert_(!/Actions tab/.test(trust),
          "…and does not send a reader to a tab they are already reading either");
  // What replaced the pointer: the checks with no tile are NAMED here, because
  // the Executive masthead still counts them ("N of M evidence gates below bar")
  // and a number nothing on the dashboard can name is a dead end.
  assert_(/Also below bar, with no tile above/.test(trust),
          "the untiled failing checks are named on the strip itself");
  assert_(/Region tagged on delivery work|Team tagged on delivery work/.test(trust),
          "…by name, so the masthead's count stays answerable");

  // Not margin-gated (brief note): a guest sees the same strip, unlike the
  // pulse panel directly above it which disappears for that role.
  C.getModel().viewerRole = "guest";
  C.renderAll_();
  C.renderTrust_();
  var trustGuest = document.getElementById("trustPanel").innerHTML;
  assert_(trustGuest.split("trustItem").length - 1 === 3,
          "a guest still sees all three trust tiles — this strip is not margin-gated");
  C.getModel().viewerRole = "admin";
  C.renderAll_();

  // The strip IGNORES FILTERS (Task 13 brief, explicitly named as a
  // behaviour to preserve) — deliberately unfiltered like the old Hygiene
  // view. Byte-identical before/after a region filter is the discriminating
  // check: a test that only re-asserted "four tiles, ORG tag" would still
  // pass even if the underlying VALUES had quietly started reading filtered
  // data (hygieneFor_/hygienePeopleFor_ scoped by a filter argument they
  // don't currently take).
  C.renderTrust_();
  var trustBefore = document.getElementById("trustPanel").innerHTML;
  C.setState("region", "AMER");
  C.renderAll_();
  C.renderTrust_();
  var trustAfterRegion = document.getElementById("trustPanel").innerHTML;
  assert_(trustBefore === trustAfterRegion,
          "the trust strip is BYTE-IDENTICAL before/after STATE.region — it deliberately ignores every filter");
  C.setState("region", "");
  C.renderAll_();
})();

// ── RETIREMENT IS NOT DELETION, AND THE ROSTER JOIN IS NOW DELETED ─────────
// The roster-join check ("…and that assignee resolves to a roster person") was
// RETIRED at 100% on 2026-08-06 — hidden while clean, restored automatically if
// one record failed — and DELETED outright on 2026-08-17 once it had held at
// 100% for a fortnight. The ~30 assertions that pinned its retirement behaviour
// across three surfaces went with it.
//
// The retire-at-100% MECHANISM survives and is still exercised below by the SRSO
// row, which is the remaining `retireWhenFull` check. That distinction is the
// thing worth keeping straight: a future 100% check should still hide itself
// rather than be deleted, and deleting one was a judgement about THIS check
// (a data loss that was fixed at source), not a change to the rule.
(function () {
  var mdl = fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  // Gone from all three of its former surfaces, asserted on the surfaces
  // themselves rather than on the absence of a symbol — a re-added row would
  // reappear here first.
  C.renderAll_();
  C.renderTrust_();
  assert_(document.getElementById("trustPanel").innerHTML.indexOf("Roster join") === -1,
          "the Roster join tile is gone from the data-trust strip");
  var h1 = C.hygieneFor_(["2026.W31"]), pp1 = C.hygienePeopleFor_(["2026.W31"]);
  assert_(!C.gapsRows_(h1, pp1).some(function (g) { return g.key === "attr"; }),
          "…and its row is gone from the gaps queue");
  assert_(!C.gapsRetired_(h1, pp1).some(function (g) { return g.key === "attr"; }),
          "…and it is not merely retired: a deleted check must not report itself as hidden-but-measured");
  // The "Solved and retired" line moved onto the trust strip when the gaps queue
  // was deleted (2026-08-17); gapsSolvedHtml_ went with the queue.
  C.renderTrust_();
  assert_(!/roster person/.test(document.getElementById("trustPanel").innerHTML),
          "…so the retired-checks line on the trust strip does not name it either");
  // The RULE still holds for the checks that use it. A null value is never
  // 'solved' — an unconnected feed must not retire itself.
  assert_(C.gapRetired_({ retireWhenFull: true, value: null }) === false,
          "a null (not-connected) value is NOT solved and never retires");
  assert_(C.gapRetired_({ retireWhenFull: true, value: 1 }) === true,
          "…while a genuine 100% still retires, which is what the SRSO row relies on");
  C.setModel(mdl);

  // ── SRSO BINDING: COMPONENT vs FIX VERSION (2026-08-07) ───────────────────
  // The runbook (BL02 B2.6) binds delivery work to the sales order with a Jira
  // COMPONENT; the exporter classifies Billing Type from FIX VERSIONS. This row
  // measures OUR reader against the documented process, so the states that must
  // stay distinguishable are: not measurable / measured-and-broken / clean.
  function srsoRow(fields) {
    var m2 = model({});
    m2.hygieneBuckets.forEach(function (b) {
      Object.keys(fields).forEach(function (k) { b[k] = fields[k]; });
    });
    fresh(m2);
    var hh = C.hygieneFor_(["2026.W31"]), pp3 = C.hygienePeopleFor_(["2026.W31"]);
    return { row: C.gapsRows_(hh, pp3).filter(function (g) { return g.key === "srso"; })[0],
             retired: C.gapsRetired_(hh, pp3).some(function (g) { return g.key === "srso"; }) };
  }

  // (a) THE ONE THAT MATTERS MOST. No Components column → nothing is knowable.
  // It must NOT render as a clean 100%: a green row here would report the
  // binding as healthy on evidence nobody collected.
  var srsoAbsent = srsoRow({ srsoMeasurable: 0, srsoAny: 0, srsoSeen: 0, srsoCompOnly: 0 });
  assert_(srsoAbsent.row, "the row is present when the column is missing — silence would read as fine");
  assert_(srsoAbsent.row.value === null,
          "…with a null value (renders 'not connected'), never a computed 100%");
  assert_(/Components column not in this export/.test(srsoAbsent.row.detail),
          "…and says exactly why it cannot be checked");
  assert_(!srsoAbsent.retired,
          "an unmeasurable check is NOT a solved check — it must not retire off the queue");

  // (a2) Column PRESENT, nothing bound by either route. A different finding
  // from (a) and it must not borrow (a)'s words — "not in this export" would
  // send someone hunting for a column that is sitting right there.
  var srsoNone = srsoRow({ srsoMeasurable: 50, srsoAny: 0, srsoSeen: 0, srsoCompOnly: 0 });
  assert_(/none of the 50 delivered items/.test(srsoNone.row.detail),
          "column present + nothing bound is its own statement — got: " + srsoNone.row.detail);
  assert_(!/not in this export/.test(srsoNone.row.detail),
          "…and never claims the column is missing when it is present");
  assert_(!srsoNone.retired, "nothing bound is not a solved binding");

  // (b) Measured and broken: 10 bound, 4 of them by component only.
  var srsoBroken = srsoRow({ srsoMeasurable: 50, srsoAny: 10, srsoSeen: 6, srsoCompOnly: 4 });
  assert_(Math.round(srsoBroken.row.value * 100) === 60,
          "coverage = what the billing reader SEES over what is bound either way; got " +
          Math.round(srsoBroken.row.value * 100));
  assert_(/4 of 10 sales-order-bound items are bound by COMPONENT only/.test(srsoBroken.row.detail),
          "…and the visible line names the count — got: " + srsoBroken.row.detail);
  // The row must point at the exporter, not at the PMs. This is copy, and copy
  // drifts: an owner sent to the wrong team is worse than no owner at all.
  assert_(/the fix is in the exporter, not with the PMs/.test(srsoBroken.row.note),
          "…and the note routes the fix to our side, since the PMs followed the process");
  assert_(/they\s+followed the process/.test(srsoBroken.row.note.replace(/\s+/g, " ")),
          "…saying so explicitly");

  // (c) Clean: everything bound is visible. Retires like the roster-join row.
  var srsoClean = srsoRow({ srsoMeasurable: 50, srsoAny: 10, srsoSeen: 10, srsoCompOnly: 0 });
  assert_(!srsoClean.row, "a fully-visible binding drops off the queue");
  assert_(srsoClean.retired, "…and is reported as retired rather than quietly vanishing");

  // (d) One bad record brings it straight back — the check is hidden while
  // clean, never switched off.
  var srsoOne = srsoRow({ srsoMeasurable: 50, srsoAny: 10, srsoSeen: 9, srsoCompOnly: 1 });
  assert_(srsoOne.row, "a single component-only item returns the row with no deploy");

  // (e) It never reaches the four-tile trust strip — that strip is an explicit
  // key list, and this is a pipeline defect rather than a publish gate.
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
  C.renderTrust_();
  assert_(document.getElementById("trustPanel").innerHTML.indexOf("Sales-order binding") === -1,
          "the SRSO row stays out of the Can-we-publish strip");
  C.setModel(mdl);

  fresh(model({}));
  C.renderAll_();
})();

// ── EXECUTIVE DATA-TRUST STRIP — NULL-VALUE TILE GRAMMAR (reviewer follow-up:
// the null branch must be pinned INSIDE renderTrust_ itself, not inferred
// from a different renderer's coverage of the same `value === null` shape). ──
// `est`'s value is `h.epics > 0 ? h.epicsEst / h.epics : null` (gapsRows_) —
// zeroing h.epics is the cleanest lever: it nulls ONLY the "est" gap, since
// due and logged divide by h.res and h.epicsEst respectively, neither of which
// this touches.
(function () {
  var m = fresh(model({}));
  m.hygieneBuckets = m.hygieneBuckets.map(function (b) {
    return b.iso === "2026.W31" ? Object.assign({}, b, { epics: 0 }) : b;
  });
  C.setModel(m);
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  C.renderTrust_();
  var trustNull = document.getElementById("trustPanel").innerHTML;
  var segs = trustNull.split('class="trustItem"');
  assert_(segs.length - 1 === 3, "still exactly three tiles when one key nulls out");
  var estSeg = segs[1];   // order = [est, due, logged] — est renders first
  assert_(/trustVal" style="color:var\(--muted\)">—/.test(estSeg),
          "null-value tile renders the em-dash in muted colour, not a fabricated 0%");
  assert_(/width:0%;background:var\(--muted\)/.test(estSeg),
          "…and its bar is width:0 with no colour fill (muted, not good/warn/bad)");
  assert_(!/var\(--c-good\)|var\(--c-warn\)|var\(--c-bad\)/.test(estSeg),
          "…the null tile carries none of the three graded colours");
  // Isolation: zeroing h.epics must not ripple into the other two tiles —
  // due and logged keep the percentages they render under the base fixture.
  var dueSeg = segs[2], loggedSeg = segs[3];
  assert_(/80%/.test(dueSeg), "due-date tile is untouched by the est-only null (still 80%)");
  assert_(/64%/.test(loggedSeg), "logged-fill tile is untouched (still 64%)");

  // Teardown (sibling discipline): restore the standard fixture and view.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ── TASK 9 — SCOPE TAGS ON EVERY TILE (spec §4.5) ───────────────────────────
// scopeTag_ already sits on the roster headers, pulse heading and trust strip
// (Tasks 5, 7, 8). This pins it on the three surfaces that were still bare:
// the four hero KPI tiles (tileHtml_/suppressedTileHtml_) → PERIOD, the flow
// tier (flowTileHtml_) split PERIOD/SNAP by metric, and the comparison
// heading → PERIOD.
(function () {
  var M = model({});
  // Flow fixture (same shape as the 🌊 Flow tiles test above) — all five
  // flowTileHtml_ calls need to render LIVE tiles, not absent/unavailable
  // placeholders, so every scope can be pinned to its own metric.
  var who = M.people[0].name;
  var W = WEEKS[WEEKS.length - 1];
  M.leadTimeBuckets = [{ iso: W, person: who, n: 2, nAll: 3, days: [4, 10] }];
  M.throughputBuckets = [{ iso: W, person: who, nAll: 3, nEst: 2, estHrs: 12.5 }];
  M.flowOpenBuckets = [{ person: who, wipN: 3, todoN: 5, todoEst: 4, todoHrs: 22.5 }];
  M.bugWeekly = [{ iso: W, nCreated: 4, nResolved: 1 }];
  M.meta.bugsAvailable = true;
  M.meta.flowSnapshotsAvailable = true;
  M.meta.flowSnapshots = [
    { iso: WEEKS[0], at: "", wip: 2, backlogHrs: 30, backlogN: 6 },
    { iso: W,        at: "", wip: 3, backlogHrs: 22.5, backlogN: 5 },
  ];
  M.meta.registry.metrics.leadTime = { id: "leadTime", name: "Lead Time", unit: "days",
    target: null, coverageGate: 0.9 };
  M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
    target: null, coverageGate: 0.6 };
  M.meta.registry.metrics.backlog = { id: "backlog", name: "Backlog (Inventory)", unit: "hrs",
    target: null, coverageGate: 0.6 };
  M.meta.registry.metrics.wip = { id: "wip", name: "Work In Progress", unit: "items",
    target: null, coverageGate: 0 };
  M.meta.registry.metrics.bugCount = { id: "bugCount", name: "Bug Count", unit: "bugs",
    target: null, coverageGate: 0 };
  fresh(M);
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();

  // ── Hero outcome tiles (tileHtml_) → PERIOD. Task 16B split the old single
  // #tiles strip across TWO bands: On-Time/Forecast/Quality now render into
  // #flowTiles (alongside Cleared/Arrived/Lead Time/Throughput/Bug Count),
  // Utilisation now renders into #pulsePanel (the capacity band). Checked PER
  // TILE via the '<div class="lbl">' tile-boundary marker, not by aggregate
  // count across a whole panel — #pulsePanel also carries its OWN independent
  // scope tag on the "People signals" heading, which an aggregate count would
  // conflate with the Utilisation tile's own tag.
  var ft = flowHtml_();
  var otSeg = ft.split('<div class="lbl">On-Time Delivery')[1].split('<div class="lbl">Forecast')[0];
  var fcSeg = ft.split('<div class="lbl">Forecast Accuracy')[1].split('<div class="lbl">Quality')[0];
  var qualSeg = ft.split('<div class="lbl">Quality')[1].split('<div class="lbl">Throughput')[0];
  assert_(otSeg.indexOf(">PERIOD<") !== -1, "On-Time hero tile carries PERIOD scope tag");
  assert_(fcSeg.indexOf(">PERIOD<") !== -1, "Forecast hero tile carries PERIOD scope tag");
  assert_(qualSeg.indexOf(">PERIOD<") !== -1, "Quality hero tile carries PERIOD scope tag");
  assert_(otSeg.indexOf(">SNAP<") === -1 && otSeg.indexOf(">ORG<") === -1 &&
          fcSeg.indexOf(">SNAP<") === -1 && fcSeg.indexOf(">ORG<") === -1 &&
          qualSeg.indexOf(">SNAP<") === -1 && qualSeg.indexOf(">ORG<") === -1,
          "…and outcome tiles never tag SNAP or ORG — they follow the period picker, not a snapshot or the whole org");
  // withUtilization_ because the card ships switched off; without it this reads
  // an empty segment and the assertion is vacuous rather than false.
  var utilSeg = withUtilization_(function () {
    C.renderAll_();
    var pulseHtml = els.pulsePanel.innerHTML;
    var utilLbl = pulseHtml.indexOf('<div class="lbl">Billable Utilization') !== -1
      ? '<div class="lbl">Billable Utilization' : '<div class="lbl">Capacity Utilization';
    return pulseHtml.split(utilLbl)[1] || "";
  });
  C.renderAll_();
  assert_(utilSeg.indexOf(">PERIOD<") !== -1,
          "Utilisation hero tile carries PERIOD scope tag, now inside the capacity band (#pulsePanel)");

  // ── Flow tier (flowTileHtml_) → PERIOD/ORG split by metric. Backlog/WIP
  // (the old two SNAP tags here) are RETIRED (Task 16B) — the flow tier now
  // carries ZERO SNAP tags; Arrived alone tags ORG, everything else PERIOD.
  assert_(ft.indexOf(">ORG<") !== -1 && ft.indexOf(">PERIOD<") !== -1,
          "flow tier: Arrived tags ORG, the rest (Cleared/Lead Time/Throughput/Bug Count/outcome tiles) tag PERIOD");
  // The Runway cluster's Assigned pair (moved beside their ORG twins,
  // director feedback 2026-08-17) are the ONLY SNAP tags in the tier — the
  // retired Backlog/WIP tiles must not creep back in behind them.
  assert_((ft.match(/>SNAP</g) || []).length === 2,
          "…and exactly two SNAP tags in the flow tier — the Runway cluster's Assigned pair, nothing else");
  assert_(tileSeg_(ft, "Assigned inventory").indexOf(">SNAP<") !== -1,
          "…riding on the Assigned cards themselves");
  // Placement pin: the tag rides with the RIGHT tile, not just anywhere in the
  // markup. Sliced per TILE (tileSeg_), not between neighbouring labels — the
  // tiles now sit in two tiers and their order is not this check's subject.
  var clearedSegPS = tileSeg_(ft, "Cleared");
  var arrivedSeg = tileSeg_(ft, "Arrived");
  var leadSeg = tileSeg_(ft, "Lead Time");
  var throughputSeg = tileSeg_(ft, "Throughput");
  var bugSeg = tileSeg_(ft, "Bug Count");
  assert_(clearedSegPS.indexOf(">PERIOD<") !== -1, "Cleared tile tags PERIOD");
  assert_(arrivedSeg.indexOf(">ORG<") !== -1, "Arrived tile tags ORG");
  assert_(leadSeg.indexOf(">PERIOD<") !== -1, "Lead Time tile tags PERIOD");
  assert_(throughputSeg.indexOf(">PERIOD<") !== -1, "Throughput tile tags PERIOD");
  assert_(bugSeg.indexOf(">PERIOD<") !== -1, "Bug Count tile tags PERIOD");
  assert_(leadSeg.indexOf(">ORG<") === -1 && throughputSeg.indexOf(">ORG<") === -1 &&
          bugSeg.indexOf(">ORG<") === -1 && clearedSegPS.indexOf(">ORG<") === -1,
          "…and ORG never leaks onto Cleared, Lead Time, Throughput or Bug Count");
  assert_(arrivedSeg.indexOf(">PERIOD<") === -1, "…and PERIOD never leaks onto Arrived");

  // Missing-feed placeholder: a dash tile still has a scope (brief note) —
  // Bug Count's "unavailable" branch must still carry PERIOD.
  M.meta.bugsAvailable = false;
  C.setModel(M);
  C.renderAll_();
  var ftNoBugs = flowHtml_();
  var bugSegAbsent = ftNoBugs.split("Bug Count")[1];
  assert_(bugSegAbsent.indexOf(">PERIOD<") !== -1,
          "Bug Count's unavailable placeholder still carries PERIOD, not a bare label");
  M.meta.bugsAvailable = true;
  C.setModel(M);
  C.renderAll_();

  // ── Comparison panel heading → PERIOD ──────────────────────────────────
  var cmp = els.comparePanel.innerHTML;
  assert_(cmp.indexOf(">PERIOD<") !== -1, "comparison panel heading carries PERIOD scope tag");

  // Teardown (sibling discipline): restore the standard fixture and view.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ── TASK 11 — MOTION LAYER IS TRANSPARENT TO HEADLESS RENDERING (spec §7) ───
// The motion layer is CSS + rAF only: the stub has no requestAnimationFrame
// (El.getElementsByClassName also always returns [], belt-and-suspenders)
// and window.matchMedia here always reports matches:false, so the count-up
// guard's rAF check alone is what keeps it dark under this stub — this pins
// that a full render still throws nothing and still produces real values,
// which is the only thing render-smoke can prove about it.
(function () {
  fresh(model({ otCov: 0.95, fcCov: 0.9 }));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  var tilesHtml = flowHtml_() + els.pulsePanel.innerHTML;
  assert_(/class="big/.test(tilesHtml), "motion layer on: hero tiles still carry .big values");
  assert_(!/NaN/.test(tilesHtml), "…and no count-up NaN leaked into a tile (rAF never ran under the stub)");

  // A re-render after "loaded" (the state every render past the first one is
  // actually in) must not throw and must not re-run the count-up — it's a
  // module-scoped one-shot guard, not something a re-render can retrigger.
  document.body.className = "loaded";
  C.renderAll_();
  assert_(/\bloaded\b/.test(document.body.className),
          "a renderAll_ pass after the class has settled to loaded leaves it there — " +
          "renderAll_/renderFlow_/renderPulse_ never touch body.className themselves");
  assert_(/class="big/.test(flowHtml_() + els.pulsePanel.innerHTML),
          "…and tiles still render real values, not a count-up left mid-flight from a prior render");

  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ── Consolidation invariants (spec 2026-08-05) ──────────────
// Three tabs, not six — VIEWS is the single source of truth (see Dashboard.html),
// and the retired panes (viewFlow/viewPeople/viewHygiene) must never receive a
// live render again. The stub only creates an els[id] entry on first
// getElementById(id) call (see El stub above), so if nothing in the client
// code still looks those ids up, els.viewFlow etc. stay undefined here — that
// absence is itself the strongest form of this assertion passing. If a future
// change reintroduces a getElementById("viewFlow") call for any reason, this
// still catches a live write via the innerHTML check.
(function () {
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.VIEWS.forEach(function (v) {
    C.setState("view", v.id);
    C.renderAll_();
  });

  assert_(C.VIEWS.length === 5, "exactly five views (🗓 PM joined 2026-08-11)");
  // 🗓 PM sits NEXT TO ACTIONS (user 2026-08-11): both answer "what needs
  // action", at different grains. 🔒 Access stays last.
  assert_(C.VIEWS.map(function (v) { return v.id; }).join(",") === "exec,actions,pm,workforce,access",
          "view ids are exec/actions/pm/workforce/access in order — PM beside Actions");
  assert_(!els.viewFlow || els.viewFlow.innerHTML === "", "no live viewFlow pane");
  assert_(!els.viewPeople || els.viewPeople.innerHTML === "", "no live viewPeople pane");
  assert_(!els.viewHygiene || els.viewHygiene.innerHTML === "", "no live viewHygiene pane");

  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// FORWARD WINDOWS — the current period and the next two weeks (2026-08-06)
//
// User request: "show current week, month and quarter to be able to check what
// people are currently doing, and also future 2 weeks if we have available
// data, to confirm planning."
//
// The rules this section exists to hold, all of which are ways the feature
// could publish a number that looks measured and isn't:
//   · the DEFAULT still lands on the last complete period, never an open one;
//   · index parity — a picker index below done.length is that done period;
//   · a trend/operating rate is NEVER built from an unfinished window;
//   · outcome metrics over a future week render "—", never 0% or 100%;
//   · a mid-period utilization rate is a FLOOR (capacity is booked for the
//     whole window, hours have only accrued for part of it);
//   · vs-prior is dropped on an open window — part-period against whole-period
//     is a length difference wearing an arrow.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var PLAN1 = "2026.W32", PLAN2 = "2026.W33";
  /** histModel + two forward weeks carrying capacity and partial plans:
      Ana fully planned, Ben thin (25%), Cleo nothing, Dev fully planned. */
  function planModel() {
    var mdl = histModel({});
    mdl.meta.gridWeeks = HIST.map(function (iso, i) {
      return { iso: iso, status: i < HIST.length - 1 ? "done" : "now" };
    }).concat([{ iso: PLAN1, status: "plan" }, { iso: PLAN2, status: "plan" }]);
    // allIsoWeeks_ reads the month calendar, so the forward weeks have to exist
    // there too or the week-unit period list simply won't contain them.
    mdl.meta.periods.month[1].isos = HIST.slice(4).concat([PLAN1, PLAN2]);
    // The roster needs personHygiene to render rows at all; the grades are
    // irrelevant here — this section is about the Plan column beside them.
    mdl.personHygiene = {
      open: mdl.people.map(function (p) {
        return { person: p.name, n: 10, due: 10, est: 10, logged: 10, loggedN: 10 };
      }),
      resolved: [],
    };
    var PLANNED = { "Ana Perez": 40, "Ben Ortiz": 10, "Cleo Diaz": 0, "Dev Rao": 40 };
    mdl.people.forEach(function (p) {
      [PLAN1, PLAN2].forEach(function (iso) {
        // A forward week has capacity and a plan, and NOTHING else: no tracked
        // hours, no NS classification. That is the real shape, and it is what
        // makes a utilization rate over it a fiction.
        p.weeks[iso] = week({ tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0,
                              nsCov: false, availCov: 0, capCov: 0,
                              nsBillRaw: 0, nsNonBillRaw: 0,
                              planned: PLANNED[p.name], effPlanned: PLANNED[p.name] });
      });
    });
    return mdl;
  }

  // ── The picker's list ────────────────────────────────────────────────────
  var M = fresh(planModel());
  C.STATE.period = "week";
  C.getModel().viewerRole = "admin";
  var done = C.donePeriods_(), all = C.analysisPeriods_();
  assert_(C.planWeeks_().length === 2, "both forward weeks are offered — the payload reaches them");
  assert_(all.length === done.length + 3,
          "the list is every complete period, then the in-flight one, then the two planning weeks");
  assert_(all.slice(0, done.length).every(function (p, i) { return p.key === done[i].key; }),
          "INDEX PARITY: below done.length the analysis list IS the done list");
  assert_(all[done.length].status === "now", "the in-flight period sits directly after the complete ones");
  assert_(all[all.length - 1].key === PLAN2 && all[all.length - 2].key === PLAN1,
          "planning weeks come last, nearest first");

  // ── …and how the picker presents it ─────────────────────────────────────
  // Three named groups, not a flat list: a reader who can quote a planning
  // window as a result is a reader the control misled.
  C.buildPeriodChips_();
  var pick = els.periodChips.children.filter(function (c) { return c.tagName === "select"; })[0];
  assert_(pick, "the analysis-period picker renders");
  var groups = pick.children.filter(function (c) { return c.tagName === "optgroup"; })
                   .map(function (g) { return g.label; });
  assert_(groups.length === 3, "three option groups");
  assert_(/^Planning · next 2 weeks/.test(groups[0]) && groups[1] === "In progress" &&
          groups[2] === "Complete",
          "…named Planning / In progress / Complete, newest first");
  assert_(pick.options[0].value === "" && pick.options[0].textContent === "Latest complete",
          "'Latest complete' is still the first and default entry");
  assert_(pick.optionKeys().indexOf(String(all.length - 1)) !== -1,
          "the furthest planning week is selectable");
  assert_(pick.options.length === all.length + 1,
          "every window is offered exactly once, plus the default entry");

  // A week the export never reached must NOT be offered: an empty plan window
  // reads as "nobody planned anything", which is a different claim entirely.
  var noCells = fresh(planModel());
  noCells.people.forEach(function (p) { delete p.weeks[PLAN2]; });
  assert_(C.planWeeks_().length === 1,
          "a forward week with no cells at all is not offered — that is export reach, not a planning gap");
  fresh(M);

  // ── The default never lands on an open window ────────────────────────────
  C.STATE.periodIdx = null;
  var A0 = C.analysisHead_();
  assert_(A0.phase === "done" && A0.head.key === done[done.length - 1].key,
          "default selection is still the LAST COMPLETE period, not the in-flight one");

  // ── In-flight ────────────────────────────────────────────────────────────
  C.setState("periodIdx", done.length);
  var Anow = C.analysisHead_();
  assert_(Anow.phase === "now", "selecting the in-flight entry reports phase 'now'");
  assert_(Anow.hi === done.length - 1,
          "…and the TREND ANCHOR stays on the last complete period — an open window never trends itself");
  C.renderFlow_(); C.renderPulse_();
  // Task 16B: On-Time/Forecast/Quality now render into #flowTiles (alongside
  // OTHER flow tiles — Cleared/Arrived/Lead Time/Throughput/Bug Count — whose
  // OWN flowTileHtml_ grammar always prints "vs prior" regardless of phase,
  // unrelated to this test), the Utilisation floor card into #pulsePanel.
  // Scoped to just the outcome tiles + capacity tile so those OTHER flow
  // tiles' unrelated "vs prior" text can't leak a false failure below.
  var nowOutcome = flowHtml_().split('<div class="lbl">On-Time Delivery')[1]
    .split('<div class="lbl">Throughput')[0];
  var nowT = '<div class="lbl">On-Time Delivery' + nowOutcome + els.pulsePanel.innerHTML;
  assert_(/◐ in progress/.test(nowT), "every card wears the in-progress marker");
  assert_(!/vs prior/.test(nowT),
          "no vs-prior delta on an open window — a part-period against a whole one is a length difference");
  assert_(/pts (above|below) target|on target/.test(nowT),
          "…but the TARGET gap survives: it judges the number actually on the card");
  // Utilisation is the ONLY tile in #pulsePanel (the "People signals" text
  // around it carries no RAG class and never says "lower bound"), so no
  // bounding split is needed to isolate it — unlike #flowTiles, which now
  // hosts multiple tiles sharing this string.
  // withUtilization_: the card ships switched off, so #pulsePanel would carry no
  // utilisation tile at all and both assertions below would pass vacuously.
  var nowUtil = withUtilization_(function () {
    C.renderAll_();
    return els.pulsePanel.innerHTML;
  });
  C.renderAll_();
  assert_(/lower bound, not a measurement/.test(nowUtil),
          "mid-period utilization is a FLOOR — capacity is booked for the whole window, hours are not");
  assert_(!/class="big [gar]"/.test(nowUtil),
          "…so it carries no RAG verdict, exactly like the rework floor");

  // ── Planning ─────────────────────────────────────────────────────────────
  C.setState("periodIdx", all.length - 2);   // PLAN1
  var Aplan = C.analysisHead_();
  assert_(Aplan.phase === "plan" && Aplan.head.key === PLAN1, "the planning week resolves as phase 'plan'");
  assert_(Aplan.hi === done.length - 1, "…and still anchors its history on the last complete period");
  C.renderFlow_(); C.renderPulse_();
  var planT = flowHtml_() + els.pulsePanel.innerHTML;
  assert_(/has not happened yet/.test(planT),
          "outcome cards say the window has not happened");
  var otCard = planT.split("On-Time Delivery")[1].split("Forecast")[0];
  assert_(/class="big">—</.test(otCard) && !/class="big [gar]"/.test(otCard),
          "…and render an em-dash, never a rate computed over zero resolved items");
  assert_(/Planned Coverage/.test(planT), "the capacity slot becomes Planned Coverage");
  // Split on the LABEL markup, not the words: the outcome cards' "Planned
  // Coverage is what this window can answer" sentence mentions it first, and a
  // bare split would test that sentence instead of the card.
  var pc = planT.split('>Planned Coverage<span class="scopeTag"')[1];
  assert_(pc, "the Planned Coverage card exists as its own tile, not only as a mention");
  // Ana 40 + Ben 10 + Cleo 0 + Dev 40 = 90h planned of 160h capacity = 56%.
  assert_(/class="big[^"]*">56%/.test(pc), "planned ÷ scheduled capacity, capped per week");
  assert_(!/class="big [gar]"/.test(pc),
          "…with NO RAG colour: no planned-coverage target has been agreed, so there is no verdict to give");
  assert_(/90h planned of 160h scheduled capacity/.test(pc), "the hours behind the rate are printed");
  assert_(/2 of 4 under 50% planned/.test(pc) && /1 with no plan/.test(pc),
          "the actionable count is headcount, not hours — Ben is thin, Cleo has nothing");
  assert_(/>planning</.test(pc), "the card wears the planning phase chip");

  // The one metric a forward window can be compared on, and the only one.
  assert_(C.liveMetrics_().join(",") === "planCov",
          "on a planning window the comparison offers Planned Coverage and nothing else");
  C.setState("view", "exec");
  C.renderAll_();
  assert_(els.comparePanel.innerHTML.indexOf("Planned Coverage") !== -1,
          "…and the comparison chart follows the picker without the reader touching a chip");
  // Task 15 req 7: the §6 grid re-points itself the SAME way — it is built
  // from gridMetrics_(), which filters liveMetrics_() rather than keeping its
  // own separate phase switch, so there is nothing for a planning window to
  // fall out of sync with. Mutation this catches: a grid column list computed
  // independently of liveMetrics_() (e.g. a literal GRID_METRIC_IDS_ walk with
  // no phase filter) would still offer onTime/forecast/util here.
  assert_(C.gridMetrics_().join(",") === "planCov",
          "on a planning window the GRID also collapses to Planned Coverage and nothing else");
  assert_(els.comparePanel.innerHTML.indexOf("gridTable") !== -1,
          "…and it still renders AS a grid (one column), not silently skipped");
  assert_(els.comparePanel.innerHTML.indexOf(">On-Time Delivery<") === -1,
          "…with no stale onTime/forecast/util column left over from the done-window grid");

  // ── The roster's Plan column ─────────────────────────────────────────────
  C.setState("view", "actions");
  C.renderAll_();
  var rost = els.rosterPanel.innerHTML;
  assert_(/>Plan <span class="scopeTag"/.test(rost),
          "the Plan column header appears on a forward window");
  assert_(/0h <span class="cellSub">\/ 40h/.test(rost),
          "…and prints hours planned against capacity per person (Cleo: 0h of 40h)");
  // Header and body must carry the SAME number of columns, or every value on
  // every row shifts one place left and the table lies quietly.
  var hdrCells = (rost.split("<thead>")[1].split("</thead>")[0].match(/<th/g) || []).length;
  var firstRow = rost.split('<tr class="rosterRow"')[1].split("</tr>")[0];
  assert_((firstRow.match(/<td/g) || []).length === hdrCells,
          "header and row column counts match with the conditional Plan column on");

  C.setState("periodIdx", null);
  C.renderAll_();
  var rostDone = els.rosterPanel.innerHTML;
  assert_(rostDone.indexOf("Plan " + done[done.length - 1].label) === -1,
          "the Plan column is GONE on a complete window — a plan you can no longer change is history");
  var hdrCells2 = (rostDone.split("<thead>")[1].split("</thead>")[0].match(/<th/g) || []).length;
  var firstRow2 = rostDone.split('<tr class="rosterRow"')[1].split("</tr>")[0];
  assert_((firstRow2.match(/<td/g) || []).length === hdrCells2,
          "…and the counts still match with it off");
  assert_(hdrCells2 === hdrCells - 1, "…the difference being exactly one column");

  // ── Surfaces that CANNOT read a forward window say so instead of showing 0 ─
  C.setState("periodIdx", all.length - 1);
  C.setState("view", "actions");
  C.renderAll_();
  // The gaps queue had its own planning-window fallback banner; both went on
  // 2026-08-17. The panel that remains (gate editor + leaver note) follows no
  // window at all, so it must make no claim about one — the trust strip below
  // still carries the real fallback statement, asserted a few lines down.
  assert_(!/planning window selected/.test(els.hygPanel.innerHTML),
          "the gates panel makes no window claim, having no windowed content left");
  C.setState("view", "exec");
  C.renderAll_();
  assert_(!/recoverable/.test(els.pulsePanel.innerHTML),
          "recoverable hours are suppressed on a forward window — they measure hours already delivered");
  assert_(/planned <b>/.test(els.pulsePanel.innerHTML),
          "…and the pulse states planned coverage in their place");
  C.renderTrust_();
  assert_(/last complete period/.test(els.trustPanel.innerHTML),
          "the data-trust strip states the period it fell back to rather than reading 0%");

  // Teardown.
  C.setState("periodIdx", null);
  fresh(model({}));
  C.STATE.period = "week";
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// TASK 11 — THE MASTHEAD AND THE VERDICT ENGINE (spec 2026-08-06 §1)
//
// The verdict is composed from ranked findings, never a sentence template —
// the prototype hardcoded "…and it grew by N items last week", which is false
// on the real feed (+14/wk against a clearing rate of ~297). Every check here
// answers "would this still pass if the behaviour it claims to verify were
// deleted?" — see the per-check notes.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  /** Renders the masthead against a fresh model and returns its HTML PLUS the
      verdict engine's own text. The ranked verdict no longer renders on the
      page (director feedback 2026-08-17 — the stat callouts carry the story),
      but verdictFindings_'s thresholds are doctrine and every check below
      still has to hold, so the engine's output is appended for the wording
      assertions while the masthead assertions keep reading the real render. */
  function masthead(mdl) {
    fresh(mdl);
    C.renderMasthead_();
    return els.masthead.innerHTML + " ⟂ " +
           C.verdictFindings_().map(function (f) { return f.text; }).join(" ");
  }
  /** One synthetic Jira Arrivals week. */
  function aw(iso, created, resolved) {
    return { iso: iso, created: created, resolved: resolved, createdUnassigned: 0 };
  }
  /** eight ISO weeks, oldest first — the trailing window netFlowPerWeek_ and
      clearRateMedian_ both use (spec D3/D4). */
  var WK8 = ["2026.W24", "2026.W25", "2026.W26", "2026.W27",
             "2026.W28", "2026.W29", "2026.W30", "2026.W31"];

  // ── 1. Net flow just UNDER the 5% materiality threshold → no growth clause ──
  // rate=300 ⇒ threshold=15. Net flow here is 14 — deliberately one unit below
  // the line, not zero: a zero-flow fixture passes under almost any
  // implementation (even one with the threshold deleted), so it proves
  // nothing. Mutation this catches: the >= comparison flipped to >, the 0.05
  // constant dropped or changed, or the whole materiality gate removed.
  var m1 = model({});
  m1.meta.clearRateMedian = 300;
  m1.arrivalWeeks = WK8.map(function (iso) { return aw(iso, 314, 300); }); // net +14/wk
  var h1 = masthead(m1);
  assert_(!/grew|growing|draining/i.test(h1),
          "net flow (+14/wk) just under 5% of a 300/wk clearing rate (15) prints no growth/drain clause");

  // ── 2. Net flow well OVER the threshold → the growth clause IS present ──
  // Same rate, net flow now 80 (well past 15). Catches: the threshold check
  // present but backwards (rendering only BELOW the line), or the clause
  // wired to the wrong finding key.
  var m2 = model({});
  m2.meta.clearRateMedian = 300;
  m2.arrivalWeeks = WK8.map(function (iso) { return aw(iso, 380, 300); }); // net +80/wk
  var h2 = masthead(m2);
  assert_(/growing by about 80 items a week/.test(h2),
          "net flow (+80/wk, well over the 15/wk materiality line) states the growth clause with the right number");

  // ── 3. Arrivals unavailable → no weeks-to-clear clause, no undefined/NaN ──
  // Catches: a formatter called on a null/undefined rate or cover without a
  // guard (nfDh_/n1Dh_ printing "NaN"), and the depth clause rendering off a
  // rate of 0 instead of being suppressed by its absence.
  var m3 = model({});
  m3.meta.arrivalsAvailable = false;
  m3.meta.clearRateMedian = null;
  m3.arrivalWeeks = [];
  var h3 = masthead(m3);
  assert_(!/weeks of work/.test(h3), "no arrivals feed → no weeks-to-clear clause at all");
  assert_(!/undefined|NaN/i.test(h3), "…and nothing prints undefined/NaN in its place");

  // ── 4. null unassigned must NEVER become 0 — strengthened per the task brief ──
  // Literal-string check first (the brief's own wording), THEN the
  // discriminating version: assigned alone (1000 items) against a TIGHT
  // 5-point history whose band sits at ~7 weeks. If the null-guard on `un`
  // were deleted (or replaced with `|| 0`), JS coerces `1000 + null` to 1000
  // — a real, non-null total — and the depth finding would fire off an
  // assigned-only number the design explicitly forbids ("Flow Snapshots
  // without the two new columns … Hero falls back to assigned-only and says
  // so" is the BACKLOG band's job, not a silent leak into this one). A plain
  // "does '0 unowned' appear" check cannot catch this: the unowned finding's
  // own 20%-materiality gate makes a coerced-to-0 numerator produce 0% share,
  // which never clears the gate under EITHER a correct or a buggy
  // implementation — so the discriminating signal has to be the depth
  // finding leaking a false total, not the unowned finding staying silent.
  var m4 = model({});
  m4.meta.clearRateMedian = 50;
  m4.arrivalWeeks = [];
  m4.inventoryHistory = [0, 1, 2, 3, 4].map(function (i) {
    return { iso: "2026.W" + (24 + i), items: 250, measured: i === 4 };
  }); // cover series = 250/50 = 5.0 flat ⇒ baseline 5, band floor 2 ⇒ hi = 7
  m4.queue = {
    assigned: { items: 1000, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
    unassigned: { items: null, wipN: null, todoN: null, todoHrs: null, uncategorized: null },
  };
  var h4 = masthead(m4);
  assert_(!/0 unowned|0% unowned/.test(h4), "literal '0 unowned' / '0% unowned' never appears (brief's own wording)");
  assert_(!/weeks of work/.test(h4),
          "…and — the discriminating check — the DEPTH clause is ALSO silent: total is unknowable " +
          "(null unassigned), not silently 1000 (assigned-only), which would read as a 20-week queue " +
          "against a band whose ceiling is 7");
  assert_(!/undefined|NaN/i.test(h4), "…with nothing printing undefined/NaN along the way");
  var f4 = C.verdictFindings_();
  assert_(!f4.some(function (x) { return x.key === "depth"; }),
          "…confirmed on the findings array directly: no 'depth' key when the total is unknowable");
  assert_(!f4.some(function (x) { return x.key === "unowned"; }),
          "…nor an 'unowned' key — there is no denominator to compute a share from");

  // ── 5. A real, large unowned share → the clause IS present, with the right
  // numbers. Catches: share computed off the wrong denominator (e.g. assigned
  // only, or a stale total), or the count formatted without its thousands grouping.
  var m5 = model({});
  m5.meta.clearRateMedian = null;
  m5.arrivalWeeks = [];
  m5.queue = {
    assigned: { items: 1440, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
    unassigned: { items: 1839, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 },
  };
  var h5 = masthead(m5);
  assert_(/56% of it has no owner — 1,839 items nobody has picked up\./.test(h5),
          "1,839 of 3,279 (56%) states the unowned clause with the exact share and the exact " +
          "thousands-grouped count — got: " + h5);

  // ── 6. Genuinely unpublishable norm (<5 complete periods) suppresses the
  // depth clause OUTRIGHT — even though the number itself is dramatically
  // LARGE, not small. This is the case the task brief explicitly warns about:
  // a fixture where the number "happens to be small" would pass under a
  // broken implementation for the wrong reason. Cover here is 30 weeks
  // (3000 items ÷ 100/wk) — undeniably "deep" by any target anyone might
  // invent — and it must still print nothing, because there is no normal to
  // be deep against with only 3 points of history.
  var m6 = model({});
  m6.meta.clearRateMedian = 100;
  m6.arrivalWeeks = [];
  m6.queue = {
    assigned: { items: 3000, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
    unassigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 },
  };
  m6.inventoryHistory = [0, 1, 2].map(function (i) {
    return { iso: "2026.W" + (29 + i), items: 300, measured: i === 2 };
  }); // only 3 points — below STD_MIN_PERIODS (5)
  var h6 = masthead(m6);
  assert_(!/weeks of work/.test(h6),
          "depth clause suppressed under 5 complete periods, even though cover (30wk) is huge, not small");
  assert_(!/undefined|NaN/i.test(h6), "…with no undefined/NaN printed from the unpublishable std result");
  var f6 = C.verdictFindings_();
  assert_(!f6.some(function (x) { return x.key === "depth"; }),
          "…confirmed directly: no 'depth' key while the operating norm has fewer than 5 periods");

  // ── 6b. POSITIVE depth case — the norm PUBLISHES and cover exceeds it ──
  // Every depth assertion above is negative (!/weeks of work/, !some(depth)).
  // A verdictFindings_ that never emitted a depth finding AT ALL would satisfy
  // every one of them — this is the one check that fails if that happens, and
  // it is also the case that separates the fixed guard from the brief's
  // original (coordinator review, 2026-08-06): with `std.band` undefined even
  // when `ok:true` (standardRate_ never sets a `.band` field — only `sigma`,
  // `lo`, `hi`), `cover > std.baseline + std.band` is `cover > NaN`, always
  // false, so the original guard would silently drop the clause exactly when
  // it is most needed. `std.ok && cover > std.hi` does not have that hole.
  //
  // Fixture derivation:
  //   · 5 history points (>= STD_MIN_PERIODS) so stdFor_ returns {ok:true}.
  //   · Every point's items÷rate = 250÷50 = 5.0 — a perfectly FLAT series, so
  //     medianOf_ = 5 and every |v−median| = 0 → mad = 0.
  //   · sigma = max(mad*1.4826, floor) = max(0, 2) = 2 (the ±2-point floor
  //     standardRate_ imposes so a flat run doesn't flag every 1-point wobble).
  //   · hi = min(100, median + sigma) = min(100, 5 + 2) = 7.
  //   · TODAY's cover = total ÷ rate = 1000 ÷ 50 = 20 — chosen to clear 7 by a
  //     wide, unambiguous margin, not by coincidence.
  //   · Not stale: this fixture never sets MODEL._stale, and stdFor_ returns
  //     null outright when it is set — confirmed by reading stdFor_ before
  //     relying on it.
  //   · arrivalWeeks: [] isolates this from the net-flow finding (rate is
  //     truthy but the length gate on finding #3 is 0, so it stays silent).
  var mP = model({});
  mP.meta.clearRateMedian = 50;
  mP.arrivalWeeks = [];
  mP.inventoryHistory = [0, 1, 2, 3, 4].map(function (i) {
    return { iso: "2026.W" + (24 + i), items: 250, measured: i === 4 };
  });
  mP.queue = {
    assigned: { items: 1000, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
    unassigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 },
  };
  var hP = masthead(mP);
  // POSITIVE depth case — the ONLY assertion here that can fail if the depth
  // finding stops being emitted. Every other depth check is negative, so a
  // verdictFindings_ that never produced a depth finding at all would satisfy
  // all of them. This is also the case that separates the correct guard from
  // the brief's original: with `std.band` undefined, `cover > std.baseline +
  // std.band` is `cover > NaN` — false — so the clause would silently vanish
  // exactly when it is most needed.
  assert_(/weeks of work/.test(hP),
          "depth clause RENDERS when the norm publishes and cover exceeds it");
  var fP = C.verdictFindings_();
  assert_(fP.some(function (x) { return x.key === "depth"; }),
          "…and the findings array carries the depth key");
  // Pin the exact numbers too, not just the clause's presence: 1,000 items ÷
  // 50/wk ⇒ 20.0 weeks against a normal of 5.0 — catches a wrong-total, a
  // wrong-rate, or a baseline read off the wrong series.
  assert_(/We are holding 1,000 items and clearing about 50 a week — roughly 20\.0 weeks of work, against a normal of 5\.0\./.test(hP),
          "…with the exact total, rate, cover and baseline all correct — got: " + hP);

  // ── 7. Headcount is the FILTERED population, and it actually CHANGES ──
  // Asserting a number is merely present would pass even if headcount were
  // hardcoded to MODEL.people.length (unfiltered) — the fixture's two people
  // are both AMER, so filtering to EMEA must visibly drop the count to 0.
  var m7 = model({});
  var h7a = masthead(m7);
  var c7a = /<b>(\d+)<\/b> (?:person|people) in scope/.exec(h7a);
  assert_(c7a && c7a[1] === "2", "unfiltered headcount is the full fixture population (2) — got: " + h7a);
  C.setState("region", "EMEA");
  var h7b = masthead(m7);
  var c7b = /<b>(\d+)<\/b> (?:person|people) in scope/.exec(h7b);
  assert_(c7b && c7b[1] === "0",
          "headcount CHANGES to 0 once the region filter matches nobody in the fixture (both people are AMER)");
  C.setState("region", "");

  // ── 8. No individual is ever named on the masthead (P6) ──
  var h8 = masthead(model({}));
  assert_(!/Ana Perez/.test(h8) && !/Ben Ortiz/.test(h8),
          "no person from MODEL.people appears anywhere in the masthead HTML");

  // ── 9. THE VERDICT PARAGRAPH AND THE NOTE ARE OFF THE PAGE (2026-08-17) ──
  // The stat callouts carry the same facts one figure each; the paragraph
  // under three big numbers restated them, and the beige note block trained
  // the reader to skip the top of the tab. The note's text survives as the ⓘ
  // beside Groomed pipeline (asserted where the fixture has unowned items).
  var mast9 = els.masthead.innerHTML;
  assert_(!/mastVerdict/.test(mast9), "no verdict paragraph renders on the masthead");
  assert_(!/ctxNote/.test(mast9) && !/Note on unassigned work/.test(mast9),
          "…and the beige unassigned-work block is gone with it");

  // Teardown.
  C.setState("region", "");
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// §2 BACKLOG BAND (Task 12, spec 2026-08-06 §2) — ORG hero triplet, filterable
// assigned sub-row, three-segment queue ruler. NO target rule anywhere (D11).
// Every check here asks "would this still pass if the behaviour it verifies
// were deleted?" — see the per-check notes.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  // The band's three hero cards (Inventory · Net flow · Weeks to clear) moved
  // out of this panel in the redesign (2026-08-17) — same numbers, same builder
  // (backlogHeroTilesHtml_), drawn in a different container. They landed in
  // Tier 1 first, then in #flowSecondary (the demotion pass later that day),
  // which renders directly BELOW this band. renderFlow_ is what paints them
  // either way, so it runs here too and its output is folded into the string:
  // these checks are about the FIGURES and their scope tags, and splitting the
  // hero away from the band it belongs to would have quietly deleted that
  // coverage rather than moving it.
  function band(mdl) {
    fresh(mdl);
    C.renderFlow_();
    C.renderBacklogBand_();
    // The assigned pair renders in the Runway cluster since the director pass
    // (2026-08-17); it is cut from the strip and appended after the band so
    // every split-on-"Assigned inventory" idiom below keeps its boundary.
    var strip = document.getElementById("flowSecondary").innerHTML;
    return heroTriplet_(strip) + els.backlogBand.innerHTML +
           ["Assigned inventory", "Assigned weeks to clear"]
             .map(function (lbl) { return tileSeg_(strip, lbl); })
             .filter(Boolean)
             .map(function (seg) { return '<div class="tile' + seg; })
             .join("");
  }
  /**
   * The three queue cards as renderFlow_ actually PAINTED them, cut out of the
   * secondary strip they now share with five other tiles.
   *
   * Read from the live container rather than by calling backlogHeroTilesHtml_()
   * directly, so these checks still fail if the renderer stops painting the
   * triplet at all — the builder returning good markup that nothing draws is
   * exactly the regression this block exists to catch. Bounded to Inventory →
   * Cleared because the strip's other tiles carry their own scope tags (Arrived
   * is ORG), and the tag COUNTS below are the assertions with teeth.
   */
  function heroTriplet_(sec) {
    // Collected BY NAME, not by slicing a contiguous run. The flow strip is
    // clustered since 2026-08-17 — Net flow sits in Flow while Inventory and
    // Weeks to clear sit in Runway — so the three queue cards are no longer
    // adjacent. A positional slice silently returned the wrong span the moment
    // that grouping landed, which is exactly the coupling tileSeg_ exists to
    // remove.
    return ["Inventory", "Net flow", "Weeks to clear"]
      .map(function (lbl) { return tileSeg_(sec, lbl); })
      .filter(Boolean)
      .map(function (seg) { return '<div class="tile' + seg; })
      .join("");
  }
  // The band now carries TWO <svg> elements — the Inventory tile's history
  // sparkline (Task 17) renders first (it's inside the hero .tiles div, above
  // the ruler in DOM order), then the ruler itself. A plain "first <svg on the
  // page" split — the ruler-specific checks below used to get away with that
  // when the ruler was the ONLY svg in this band — would silently start
  // grading the sparkline instead. Anchored on the ruler's own CSS class
  // (queueRulerSvg_ always emits `class="chart backlogRuler"`) so it keeps
  // finding the ruler regardless of what else shares the band.
  function rulerSvg_(html) {
    var i = html.indexOf('<svg class="chart backlogRuler"');
    if (i === -1) return "";
    var rest = html.slice(i);
    var end = rest.indexOf("</svg>");
    return end === -1 ? "" : rest.slice(0, end + "</svg>".length);
  }
  function aw(iso, created, resolved) {
    return { iso: iso, created: created, resolved: resolved, createdUnassigned: 0 };
  }
  var WK8 = ["2026.W24", "2026.W25", "2026.W26", "2026.W27",
             "2026.W28", "2026.W29", "2026.W30", "2026.W31"];

  // Base fixture: two people, one AMER one EMEA, each carrying flowOpenBuckets
  // rows so the SNAP sub-row (which reads flowOpenFor_, the only per-person,
  // per-filter source — MODEL.queue.assigned is a single pre-summed ORG
  // scalar with no region/team breakdown to filter) has something to move.
  function baseFixture() {
    var m = model({});
    m.people = [
      person("Ana AMER", { region: "AMER" }),
      person("Cleo EMEA", { region: "EMEA" }),
    ];
    m.flowOpenBuckets = [
      { person: "Ana AMER", wipN: 100, todoN: 50, todoEst: 40, todoHrs: 300 },
      { person: "Cleo EMEA", wipN: 80, todoN: 40, todoEst: 30, todoHrs: 200 },
    ];
    m.meta.clearRateMedian = 300;
    m.arrivalWeeks = WK8.map(function (iso) { return aw(iso, 314, 300); }); // +14/wk, all usable
    m.queue = {
      assigned: { items: 1440, wipN: 900, todoN: 540, todoHrs: 0, unattributed: 0, uncategorized: 0 },
      unassigned: { items: 1839, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 },
    };
    // Throughput history so the ASSIGNED clear rate (the sub-row's OWN
    // denominator) can publish — 8 weeks, both people, so it differs
    // numerically from the ORG rate (300) above (test 5-below/two-denominators).
    m.throughputBuckets = [];
    WK8.forEach(function (iso) {
      m.throughputBuckets.push({ iso: iso, person: "Ana AMER", nAll: 30, nEst: 20, estHrs: 100 });
      m.throughputBuckets.push({ iso: iso, person: "Cleo EMEA", nAll: 20, nEst: 15, estHrs: 80 });
    });
    return m;
  }

  // ── 1. ORG on the hero, SNAP on the sub-row — each tile carries its OWN
  // tag (not merely present somewhere in the panel). Catches: a shared banner
  // tag standing in for per-tile scopeTag_ calls, or the two tags swapped.
  var h1 = band(baseFixture());
  // ── 0. The band's own heading does not accuse anyone (2026-08-07). Unassigned
  // work is what generic allocation is DESIGNED to produce, and a deep queue is
  // cover before it is debt — the old "the queue nobody has finished" read as a
  // standing reprimand on a projector. Guarded the same way the "no bare N.Nw
  // literal" rule is: by banning the phrasing, not by pinning the new sentence,
  // so the copy can keep improving without the test having to be rewritten.
  // (The ruler's own "nobody has picked up" tooltip and the masthead sentence
  // are the SAME defect and are deliberately still here — spec §A2, W33. This
  // check is scoped to the <h3> so it fails the day the heading regresses,
  // without pre-failing the two strings W33 owns.)
  var h1Head = h1.slice(h1.indexOf("<h3>"), h1.indexOf("</h3>"));
  assert_(!/nobody/i.test(h1Head),
          "the band heading imputes no neglect — got: " + h1Head);
  assert_(/Backlog/.test(h1Head), "…and it is still named Backlog — got: " + h1Head);
  // Two segments since the redesign (2026-08-17): the hero triplet (now in the
  // secondary strip below this band) and the assigned sub-row (still in the
  // band). The workforce-change row between them was deleted. Anchored on the
  // sub-row's caption so a later insertion moves the boundary rather than
  // silently reassigning a tile.
  var heroSeg = h1.split("Assigned inventory")[0];
  var subSeg = h1.split("Assigned inventory")[1] || "";
  assert_(heroSeg.indexOf(">ORG<") !== -1, "the hero triplet carries the ORG scope tag");
  assert_(subSeg.indexOf(">SNAP<") !== -1, "the assigned sub-row carries the SNAP scope tag");
  // Exactly three ORG tags across the whole string: Inventory, Net flow and
  // Weeks to clear, each with its own (not one shared banner). The Tier-1
  // outcome cards beside them are all PERIOD, and the workforce card that used
  // to add a fourth ORG is gone — so this count is also the check that it
  // stayed gone.
  assert_((h1.match(/>ORG</g) || []).length === 3,
          "all three hero slots carry their own ORG tag, and nothing else in Tier 1 or the band does");
  assert_((h1.match(/>SNAP</g) || []).length === 2, "both sub-row slots carry their own SNAP tag");
  // The Workforce-change card is DELETED from the Executive read (redesign
  // 2026-08-17), not merely moved further down the band.
  assert_(h1.indexOf("Workforce change") === -1,
          "the Workforce-change card is gone from the Executive tab entirely");
  assert_(h1.indexOf("The team behind the queue") === -1,
          "…and so is the caption that introduced it");

  // ── 2. Hero inventory = assigned + unassigned; sub-row = assigned alone;
  // the two are NEVER the same number. Catches: the sub-row accidentally
  // reading the ORG total, or the hero forgetting to add the unassigned half.
  assert_(/3,279 items/.test(h1), "hero inventory is assigned (1,440) + unassigned (1,839) = 3,279 — got: " + h1);
  assert_(/1,440 assigned \+ 1,839 unowned/.test(h1), "…stated explicitly as the sum of its two halves");
  // Sub-row inventory = the FILTERED flowOpenFor_ total (100+50 + 80+40 = 270),
  // not the ORG assigned scalar (1,440) — proving it reads the filterable
  // source, not a re-display of the hero's own assigned half.
  assert_(/270 items/.test(subSeg), "sub-row inventory is the filtered assigned total (270), not the ORG assigned scalar (1,440)");
  assert_(h1.indexOf("3,279 items") !== h1.indexOf("270 items") &&
          !/^270 items$/.test("3,279 items"),
          "hero (3,279) and sub-row (270) are never rendered as the same figure");

  // ── 3. null unassigned: no "0 unowned" ANYWHERE, the hero falls back to
  // assigned-only WITH a stated reason, and the unowned ruler segment prints
  // "not measured" rather than a hatched zero. Catches: `|| 0` coercion on the
  // unassigned side (the exact bug the design doc calls out).
  var mNull = baseFixture();
  mNull.queue.unassigned = { items: null, wipN: null, todoN: null, todoHrs: null, uncategorized: null };
  var hNull = band(mNull);
  assert_(!/0 unowned|0% unowned/.test(hNull), "literal '0 unowned' / '0% unowned' never appears");
  assert_(/1,440 items/.test(hNull), "hero falls back to the assigned total (1,440) alone");
  assert_(/assigned only/.test(hNull) && /isn't available this refresh/.test(hNull),
          "…WITH a stated reason, not a silent substitution");
  assert_(/not measured this refresh/.test(hNull),
          "the ruler's caption states the unowned segment is not measured, never a fabricated count");
  assert_(!/undefined|NaN/i.test(hNull), "nothing prints undefined/NaN along the fallback path");

  // ── 4. clearRateMedian = null → weeks-to-clear states how many more weeks
  // it needs, and prints NO number in that slot. Catches: dividing by a null
  // rate (Infinity/NaN) instead of gating the slot, or the "needs N more
  // weeks" copy rendering without actually suppressing the numeric weeks value.
  var mNoRate = baseFixture();
  mNoRate.meta.clearRateMedian = null;
  mNoRate.arrivalWeeks = [];   // also short of the 5-week bar the gap message reports against
  var hNoRate = band(mNoRate);
  var wtcSeg = hNoRate.split("Weeks to clear")[1].split("</div>")[0];
  assert_(/needs \d+ more week/.test(hNoRate), "weeks-to-clear states how many more weeks it needs");
  assert_(!/\d\.\dw/.test(wtcSeg), "…and prints NO weeks NUMBER in that slot (no lingering N.Nw)");
  assert_(!/undefined|NaN/i.test(hNoRate), "…with no undefined/NaN printed in its place");

  // ── 5. NO target rule anywhere on the ruler, checked against the ruler's
  // OWN SVG content (not a tile caption elsewhere in the band) — and the
  // POSITIVE case: the operating band IS shaded when the norm publishes.
  // model()'s default inventoryHistory is [] (no norm) — give it 5 flat
  // points so stdFor_(coverSeries_(), …) actually publishes.
  var mBand = baseFixture();
  mBand.inventoryHistory = [0, 1, 2, 3, 4].map(function (i) {
    return { iso: "2026.W" + (24 + i), items: 3300, measured: i === 4 };
  });   // 3300/300 = 11.0 flat → baseline 11.0, band floor ±2 → [9,13]
  var hBand = band(mBand);
  var rulerSvg = rulerSvg_(hBand);
  assert_(rulerSvg, "the ruler rendered an <svg> at all (norm publishes, rate is set)");
  assert_(!/target/i.test(rulerSvg), "the ruler SVG contains NO 'target' text anywhere");
  assert_(!/x1="[^"]*" x2="[^"]*"[^>]*stroke="var\(--c-target\)"/.test(rulerSvg),
          "…and no target-coloured reference LINE either");
  assert_(rulerSvg.indexOf('fill="var(--c-ref)"') !== -1,
          "the operating band SHADES (var(--c-ref)) now that the 5-point norm publishes — " +
          "the positive case: every OTHER assertion in this block is negative and would pass " +
          "even if the band never drew at all");
  assert_(/operating band/.test(rulerSvg), "…with its own tooltip naming what the shading is");

  // Negative companion on the SAME fixture family: fewer than 5 history points
  // → no operating band drawn AT ALL, not merely an invented one.
  var mNoBand = baseFixture();
  mNoBand.inventoryHistory = [];
  var hNoBand = band(mNoBand);
  var rulerSvgNoBand = rulerSvg_(hNoBand);
  assert_(rulerSvgNoBand.indexOf('fill="var(--c-ref)"') === -1,
          "…and with an unpublishable norm (<5 points), NO reference band is drawn at all — " +
          "not a green rect standing in for a target");

  // ── 5b. The Inventory hero tile draws its reconstructed history (Task 17 —
  // regression fix: Tasks 5/7 built the 26-week walkback expressly so the
  // hero would ship WITH a trend; Task 16B's retirement of Backlog/WIP left
  // it drawn nowhere — see task-16b-report.md's deleted-check accounting).
  // Reuses mBand from check 5 above: 5 points, only the newest (index 4,
  // "2026.W28") measured — everything behind it reconstructed.
  var invTileBand = hBand.split(">Inventory<")[1].split("Net flow")[0];
  assert_(/class="chart spark"/.test(invTileBand),
          "the Inventory tile carries an actual chart — the POSITIVE case, since every " +
          "polarity check below would equally pass on a tile that renders nothing");
  assert_((invTileBand.match(/<circle/g) || []).length === 5,
          "one point per week of history (5), not a summary dot");
  assert_(invTileBand.indexOf('class="pt-measured"') !== -1 &&
          invTileBand.indexOf('class="pt-reconstructed"') !== -1,
          "measured and reconstructed points are TWO DIFFERENT visual classes, not one style for both");
  assert_((invTileBand.match(/class="pt-measured"/g) || []).length === 1,
          "exactly one measured point — the newest — the rest are reconstructed");
  assert_((invTileBand.match(/class="pt-reconstructed"/g) || []).length === 4,
          "…and the other four carry the reconstructed class");
  assert_(/2026\.W28 · 3,300 \(measured\)/.test(invTileBand),
          "the measured point's OWN tooltip says so, in words, not just in a CSS class");
  assert_(/2026\.W24 · 3,300 \(reconstructed — inferred, not a snapshot\)/.test(invTileBand),
          "…and a reconstructed point's tooltip says THAT, in words — same rule the " +
          "✎ definition-changed marker applies to a formula change, reused for a change of evidence");
  assert_(/stroke-dasharray="4,3"/.test(invTileBand),
          "the connecting line itself is dashed — the series is flagged as substantially " +
          "reconstructed, not just its endpoints");
  assert_(/4w reconstructed \(○, dashed\) → 1 measured \(●\)/.test(invTileBand),
          "the caption states the split in plain language too");

  // Negative companion: an UNANCHORABLE walkback (inventoryHistory === [],
  // Code.js `_test_modelAssembly_` part 3 — no arrivals tab, or no measurable
  // anchor) draws NOTHING, and says why — never a flat line at zero, which
  // would read as a measured, stable queue instead of an absent one.
  var invTileNoBand = hNoBand.split(">Inventory<")[1].split("Net flow")[0];
  assert_(!/<svg/.test(invTileNoBand),
          "an unanchorable history renders NO chart at all — not a flat zero-value line");
  assert_(!/<circle/.test(invTileNoBand), "…and no lone zero-point either");
  assert_(/no history —/.test(invTileNoBand), "…and it SAYS why there's nothing to draw");

  // ── 6. Setting STATE.region changes the sub-row but NOT the hero triplet —
  // proving the hero is genuinely ORG (unfiltered), not merely tagged ORG
  // while actually reading filtered data. Catches: a filter accidentally
  // reaching the hero's numbers, or the sub-row NOT reacting to the filter at all.
  // The hero is read straight from its builder now (redesign 2026-08-17) — it
  // renders into Tier 1, and reading it through backlogHeroTilesHtml_ isolates
  // the three cards from the outcome cards that legitimately DO filter.
  fresh(baseFixture());
  C.renderFlow_();
  C.renderBacklogBand_();
  var heroBefore = C.backlogHeroTilesHtml_();
  C.setState("region", "EMEA");
  C.renderFlow_();
  C.renderBacklogBand_();
  var heroAfter = C.backlogHeroTilesHtml_();
  // The assigned pair lives in the Runway cluster now (director feedback
  // 2026-08-17) — read it from the strip renderFlow_ painted under the filter.
  var subAfter = document.getElementById("flowSecondary").innerHTML
                   .split("Assigned inventory")[1] || "";
  assert_(heroBefore === heroAfter,
          "the hero triplet's markup is BYTE-IDENTICAL before and after STATE.region — it never reads filters");
  assert_(/3,279 items/.test(heroAfter), "…still the full 3,279-item ORG total under the EMEA filter");
  // Cleo EMEA alone carries wipN 80 + todoN 40 = 120, down from 270 unfiltered.
  assert_(/120 items/.test(subAfter),
          "…while the sub-row DOES narrow, to the EMEA-only filtered total (120) — proving the " +
          "SNAP tag is not just a label on data that never actually filters");
  C.setState("region", "");

  // ── 7. The backlog band is fixed to its own trailing-weeks basis (D3) —
  // the SAME doctrine the masthead and netFlowPerWeek_ already follow — so it
  // must not move when the ANALYSIS PERIOD PICKER changes, unlike the four
  // KPI cards. Catches: the band silently wiring itself to analysisHead_()/
  // STATE.periodIdx, which would make "the last 8 weeks" mean something
  // different depending on what a reader happened to have selected upstream.
  var mPhase = baseFixture();
  fresh(mPhase);
  C.renderBacklogBand_();
  var beforePeriod = els.backlogBand.innerHTML + C.backlogHeroTilesHtml_();
  // Pick an EARLIER period on the picker — if the band secretly depended on
  // it, the trailing-weeks totals would move; they must not.
  C.setState("periodIdx", 0);
  C.renderBacklogBand_();
  var afterPeriod = els.backlogBand.innerHTML + C.backlogHeroTilesHtml_();
  // Both halves are checked: the band itself AND the three hero cards that now
  // render a tier above it. The hero moving containers must not quietly move
  // it onto the picker's basis — that is exactly the wiring this catches, and
  // it would otherwise have escaped the check along with the tiles.
  assert_(beforePeriod === afterPeriod,
          "the backlog band AND its Tier-1 hero cards are BYTE-IDENTICAL when the period picker " +
          "moves — both are fixed to the trailing-weeks basis (D3), the same way the masthead " +
          "and netFlowPerWeek_ already are");
  C.setState("periodIdx", null);

  // ── 8. The unowned ruler segment is drillable ONLY when unassigned rows
  // exist (> 0) — not when they are zero, and not when they are null (rule 3
  // already withholds the segment entirely in that case). Catches: an
  // onclick handler that fires regardless of whether there is anything behind
  // it, or one that never fires at all.
  var mDrill = baseFixture();   // unassigned.items = 1839 > 0
  var hDrill = band(mDrill);
  assert_(/onclick="switchView_\('actions'\)"/.test(hDrill),
          "the unowned segment IS a click-through when unassigned rows exist (1,839 > 0)");

  var mZero = baseFixture();
  mZero.queue.unassigned = { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 };
  var hZero = band(mZero);
  assert_(hZero.indexOf("onclick=\"switchView_('actions')\"") === -1,
          "…but NOT when unassigned is a real, measured ZERO — there is nothing to drill into");

  var mNullDrill = baseFixture();
  mNullDrill.queue.unassigned = { items: null, wipN: null, todoN: null, todoHrs: null, uncategorized: null };
  var hNullDrill = band(mNullDrill);
  assert_(hNullDrill.indexOf("onclick=\"switchView_('actions')\"") === -1,
          "…nor when unassigned is null (not measured) — rule 3 already withholds the segment itself");

  // ── 9. TWO-DENOMINATOR TEST (Task 16B review finding): assignedClearRate_
  // is correct and filter-aware, but nothing previously asserted the sub-row
  // ACTUALLY USES it — a regression that divided the sub-row by the ORG rate
  // instead would have passed every prior check. trailingCompleteWeeks_ needs
  // >= CLEAR_RATE_MIN_N_ (5) known weeks to publish at all, so this fixture
  // extends trendWeeks/gridWeeks to the same WK8 window the throughput/
  // arrival history already uses — making the two rates genuinely differ:
  // ORG = 300 (meta.clearRateMedian), assigned = median(30+20 per week) = 50
  // (throughputBuckets, both people, unfiltered).
  var m9 = baseFixture();
  m9.meta.trendWeeks = WK8; m9.meta.gridWeeks = WK8;
  var h9 = band(m9);
  assert_(C.assignedClearRate_() === 50, "sanity: the fixture's assigned rate (50) differs from its ORG rate (300)");
  var subTail = h9.split("Assigned weeks to clear")[1].split('<div style="margin-top:12px">')[0];
  // Would this pass if the behaviour were deleted? No: if the sub-row read
  // the ORG rate, "Assigned weeks to clear" would print asgInv(270)÷300 =
  // 0.9w, not 5.4w — a different, wrong number this assertion pins.
  assert_(/5\.4w/.test(subTail),
          "the sub-row's weeks-to-clear is asgInv(270)÷assignedRate(50) = 5.4w — the ASSIGNED rate");
  assert_(!/0\.9w/.test(subTail),
          "…NOT asgInv(270)÷ORGrate(300) = 0.9w — the regression this test exists to catch");
  assert_(/50\/wk assigned clearing rate/.test(subTail), "…and the sub-row states the rate it actually used (50/wk), not 300");

  // ── 10. rate === 0 is a REAL measured value, not missing history (Task 16B
  // review finding): clearRateMedian_'s contract (Code.js, unit-tested) is
  // explicit that an all-zero series is 0, not null. The three sites that used
  // to test `rate ? … : "—"` (falsy) conflated 0 with null, producing
  // self-contradictory copy — "—" beside "needs 0 more weeks". Fixture: a
  // genuine shutdown week, 8 complete weeks all resolving 0.
  var mZeroRate = baseFixture();
  mZeroRate.meta.clearRateMedian = 0;
  mZeroRate.arrivalWeeks = WK8.map(function (iso) { return aw(iso, 0, 0); });
  var hZeroRate = band(mZeroRate);
  assert_(!/needs \d+ more week/.test(hZeroRate),
          "rate === 0 is NOT reported as 'needs N more weeks' — that message is for rate === null only");
  assert_(/clearing rate is 0\/wk this window/.test(hZeroRate),
          "…it gets its OWN honest message instead — an unbounded queue, not an unmeasured one");
  assert_(/∞w/.test(hZeroRate), "…and the hero prints ∞w (heroTotal > 0, rate 0 → unbounded), not '—'");
  // Direct unit check on queueRulerSvg_ itself — the ruler cannot legally
  // divide by its own rate of 0 (Infinity), so it must short-circuit to its
  // own message rather than attempt the SVG.
  var rulerAtZero = C.queueRulerSvg_({ wipN: 10, todoN: 10, unItems: 0, rate: 0, std: null, onDrill: null });
  assert_(!/<svg/.test(rulerAtZero), "queueRulerSvg_ does not attempt to draw at rate === 0 (would divide by zero)");
  assert_(/isn't draining at all/.test(rulerAtZero), "…and states plainly that the queue isn't draining, not that it needs more history");
  var rulerAtNull = C.queueRulerSvg_({ wipN: 10, todoN: 10, unItems: 0, rate: null, std: null, onDrill: null });
  assert_(/needs \d+ more week/.test(rulerAtNull),
          "…while rate === null (genuinely unmeasured) keeps the ORIGINAL 'needs N more weeks' message — the two states stay distinct");

  // ── 11. backlogTileHtml_ applies the house "unavailable" convention (Task
  // 16B review finding): tileHtml_/flowTileHtml_ both apply class="tile ph"
  // for every "—" state; backlogTileHtml_ never did, so an empty Weeks-to-
  // clear tile looked like a fully-formed measurement rather than the dashed
  // placeholder every other empty tile in this app uses.
  var mNoRatePh = baseFixture();
  mNoRatePh.meta.clearRateMedian = null;
  mNoRatePh.arrivalWeeks = [];
  var hNoRatePh = band(mNoRatePh);
  var wtcTile = hNoRatePh.split("Weeks to clear")[0].split('<div class="tile').slice(-1)[0];
  assert_(/^( ph)?">/.test(wtcTile) && / ph">/.test(wtcTile),
          "Weeks to clear renders class=\"tile ph\" (the house placeholder shell) when it has no value — got: " + wtcTile.slice(0, 6));
  // Companion: a tile that DOES have a value carries no ph class.
  var invTile = h1.split("Inventory")[0].split('<div class="tile').slice(-1)[0];
  assert_(!/ ph">/.test(invTile), "…but a real value (Inventory, always populated here) carries NO ph class");

  // ── 11b. WORKFORCE CHANGE (user request 2026-08-07) ──────────────────────
  // The supply side of the queue. Three states that must stay distinguishable,
  // because collapsing any pair of them is how a real loss disappears:
  // unknown (payload predates it) / a measured zero / a measured movement.
  //
  // The CARD was removed from the Executive tab (redesign 2026-08-17) and its
  // builder kept, so these checks now read workforceTileHtml_ directly instead
  // of slicing it out of the band. Every rule below is unchanged — this is the
  // measure's contract, and it has to still hold on the day the card is
  // restored. That it no longer RENDERS on Executive is asserted separately,
  // in check 1 above.
  function wfBand(wf, extra) {
    var m = baseFixture();
    if (wf !== undefined) m.workforceWeeks = wf;
    Object.keys(extra || {}).forEach(function (k) { m[k] = extra[k]; });
    fresh(m);
    return C.workforceTileHtml_();
  }
  var HEAD = "2026.W31";   // baseFixture's analysis head

  // (a) A pre-v28 payload says so. It must NOT read as "nobody joined or left".
  var wfNone = wfBand(undefined);
  assert_(/arrives after the next refresh/.test(wfNone),
          "a payload with no workforce data says so — got: " + wfNone.slice(0, 300));
  assert_(!/nobody joined or left/.test(wfNone),
          "…and never claims a measured zero it does not have");

  // (b) A measured zero is a real answer and prints as one.
  var wfZero = wfBand([]);
  assert_(/0h\/wk/.test(wfZero) && /nobody joined or left/.test(wfZero),
          "the roster was read and nobody moved — a real zero, not a placeholder");
  assert_(!/—/.test(wfZero.split("</div>")[1] || ""),
          "…so it is not dressed as the unavailable state");

  // (c) A net loss. Signs are the whole message: gaining 80 and losing 112 is
  // −32, and a card that dropped the sign would report a gain.
  var wfLoss = wfBand([{ iso: HEAD, joiners: 2, leavers: 3, hoursGained: 80,
                         hoursLost: 112, joinersNoCap: 0, leaversNoCap: 0 }]);
  assert_(/−32h\/wk/.test(wfLoss), "net = gained − lost, signed — got: " + wfLoss.slice(0, 400));
  assert_(/2 joined \(\+80h\)/.test(wfLoss) && /3 left \(−112h\)/.test(wfLoss),
          "…with both sides shown, so the net is auditable rather than asserted");

  // (d) A net gain keeps its + sign.
  var wfGain = wfBand([{ iso: HEAD, joiners: 3, leavers: 1, hoursGained: 120,
                         hoursLost: 40, joinersNoCap: 0, leaversNoCap: 0 }]);
  assert_(/\+80h\/wk/.test(wfGain), "a net gain reads +, not a bare number");

  // (e) THE ONE THAT FLATTERS US IF IT BREAKS. A departure whose capacity is
  // unknown contributes 0 hours; without the disclosure the card reports a
  // smaller loss than happened and looks precise doing it.
  var wfUnknown = wfBand([{ iso: HEAD, joiners: 0, leavers: 2, hoursGained: 0,
                            hoursLost: 40, joinersNoCap: 0, leaversNoCap: 1 }]);
  assert_(/no scheduled hours on record/.test(wfUnknown),
          "a movement with unknown capacity is disclosed, not silently worth 0h");
  assert_(/counted as a person, not as hours/.test(wfUnknown),
          "…and says which side of the count it landed on");

  // (f) The juxtaposition this card exists for: capacity falling while the
  // queue grows. Only stated when BOTH are true — an unconditional line would
  // be decoration.
  assert_(/queue growing .* while capacity fell/.test(wfLoss),
          "a capacity loss against a growing queue is stated as one sentence");
  assert_(!/while capacity fell/.test(wfGain),
          "…and never when capacity ROSE — the line is a finding, not a caption");

  // (g) Counts and hours only. No name may reach this card, whatever the
  // fixture carries — this is the rule that keeps a capacity measure from
  // becoming a notice board.
  assert_(!/Ana AMER|Cleo EMEA/.test(wfLoss),
          "no person is ever named on the workforce card");

  // ── 12. CRITICAL fix regression guard: no hardcoded "N.Nw"/"Nw"-style
  // literal in the band's prose. The retired sentence quoted "4.9w"/"11.0w" —
  // illustrative spec figures wired to nothing, sitting directly above the
  // tiles that compute those very numbers. This greps the PROSE line
  // specifically (not the tiles, which legitimately print computed "N.Nw"
  // values) so a future edit that pastes a figure back in fails loudly.
  var mLiteralCheck = baseFixture();
  var hLiteralCheck = band(mLiteralCheck);
  var proseLine = hLiteralCheck.split('<p class="cellSub">')[1].split("</p>")[0];
  assert_(!/\d+\.?\d*w\b/i.test(proseLine),
          "the band's intro prose contains NO 'Nw'/'N.Nw'-style literal — got: " + proseLine);

  // Teardown.
  C.setState("region", "");
  C.setState("periodIdx", null);
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// EXECUTIVE SMART SPLIT (2026-08-17)
//
// #viewExec is TWO in-page sub-tabs, and which half a panel sits in is the
// whole feature — not incidental structure:
//
//   HEALTH & ACTIONS  #tier1Tiles → #comparePanel
//       The 10-second read, then the route to act. NOTHING between them: no
//       prose block, no colour key, no chart restating the table.
//   BACKLOG & FLOW    #masthead → #backlogBand → #flowSecondary → #flowKey
//                     → #pulsePanel → #trustDetail
//       The pipeline read, and everything reference-shaped that used to sit
//       between an executive and their actions.
//
// Checked on the raw markup — the DOM order a reader scrolls through — so an
// edit that drops a panel back between the KPIs and the drill-down, or floats
// the super-admin panel up the page, fails loudly.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var iHealth = html.indexOf('id="execHealth"');
  var iFlowPane = html.indexOf('id="execFlow"');
  assert_(iHealth !== -1 && iFlowPane !== -1, "both sub-tab panes exist in the markup");
  assert_(iHealth < iFlowPane, "Health & Actions is declared first — it is the default view");
  assert_(html.indexOf('id="execTabs"') !== -1 && html.indexOf('id="execTabs"') < iHealth,
          "the sub-tab strip precedes both panes");

  function paneOf(id) {
    var i = html.indexOf('id="' + id + '"');
    assert_(i !== -1, "#" + id + " exists in the markup");
    return i < iFlowPane ? "health" : "flow";
  }
  // Health & Actions holds ONLY the KPIs and the drill-down. Anything else on
  // it is something an executive has to scroll past to reach an action.
  assert_(paneOf("tier1Tiles") === "health", "#tier1Tiles is on Health & Actions");
  assert_(paneOf("comparePanel") === "health", "#comparePanel is on Health & Actions");
  assert_(html.indexOf('id="tier1Tiles"') < html.indexOf('id="comparePanel"'),
          "…and the drill-down sits directly BELOW the KPI cards, not below a chart");
  ["masthead", "pulsePanel", "backlogBand", "flowSecondary", "trustDetail"]
    .forEach(function (id) {
      assert_(paneOf(id) === "flow", "#" + id + " moved to Backlog & Flow");
    });
  // Reading order inside Backlog & Flow. The pulse sits directly under the
  // masthead's stat callouts (director feedback 2026-08-17): recoverable hours
  // are the most actionable figure on the tab and must not live below the
  // fold. #flowKey is deleted, so it is absent from this list on purpose.
  var order = ["masthead", "pulsePanel", "backlogBand", "flowSecondary", "trustDetail"];
  var idxs = order.map(function (id) { return html.indexOf('id="' + id + '"'); });
  for (var i = 1; i < idxs.length; i++) {
    assert_(idxs[i - 1] < idxs[i],
            "#" + order[i - 1] + " precedes #" + order[i] + " on Backlog & Flow — " +
            "got indices " + idxs[i - 1] + " then " + idxs[i]);
  }
  // Retirement is real, not merely unreferenced: the retired containers are
  // absent from the MARKUP itself.
  assert_(html.indexOf('id="tiles"') === -1 && html.indexOf('id="tileColorKey"') === -1,
          "#tiles and #tileColorKey are absent from the markup — retirement is structural, not incidental");
  assert_(html.indexOf('id="flowTiles"') === -1,
          "#flowTiles is gone — the flow band was split into #tier1Tiles and #flowSecondary");
  assert_(html.indexOf('id="shelfPanel"') === -1,
          "#shelfPanel is gone — 'Not measured this week' was deleted, not merely unrendered");

  // ── The three tiers are declared as SECTIONS, each with its own heading ──
  // A run of unlabelled panels leaves the hierarchy to be inferred; the tiers
  // are a statement about priority, so they are marked in the markup.
  assert_(/class="tier tier1"/.test(html) && /class="tier tier2"/.test(html) &&
          /class="tier tier3"/.test(html),
          "the tier sections are still declared in the markup");

  // ── The data-quality strip moved to Actions, and moved ENTIRELY ──
  // Present twice would be worse than not moving it: two copies of a gate
  // reading, free to disagree about which period they measured.
  var trustIdx = html.indexOf('id="trustPanel"');
  assert_(trustIdx !== -1, "#trustPanel still exists — it moved tabs, it was not deleted");
  assert_(html.indexOf('id="trustPanel"', trustIdx + 1) === -1,
          "…and exists exactly once, not copied onto both tabs");
  assert_(trustIdx > html.indexOf('id="viewActions"'),
          "…and it sits inside the Actions pane, after #viewActions opens");
  assert_(trustIdx < html.indexOf('id="rosterPanel"'),
          "…first on that tab, above the signals roster");
})();

// ══════════════════════════════════════════════════════════════════════════
// §4/§5 FLOW BAND + CAPACITY BAND (Task 14, spec 2026-08-06 §4/§5)
//
// Flow band: the Arrived tile (ORG) joins the #flowTiles tier.
// Capacity band: the existing canSeeMargin_ gate, the planning-window phase
// switch (planTile_/notYetTile_) and the mid-period floor grammar (opts.floor)
// are NOT rewritten here — this block only pins that they still hold, plus
// the new CAPACITY kicker and the real people-signals reconciliation count
// that replaces the design doc's "[object Object]" prototype caveat.
//
// UPDATED Task 16B: the Task-14 brief-vs-file note below is now STALE and
// resolved the other way — "Cleared" (reg.cleared, an items count distinct
// from Throughput's hours) now exists as its own tile (added Task 16B, review
// finding), and On-Time (plus Forecast/Quality) moved OUT of the retired
// #tiles strip INTO #flowTiles alongside Arrived/Lead Time/Throughput/Bug
// Count. Check 1 below is updated to match: it now pins Cleared/Arrived/Lead
// Time each carrying its OWN scope tag inside #flowTiles, and On-Time's tag
// surviving the move into the same element.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  function flowFixture(o) {
    o = o || {};
    var M = model({});
    var who = M.people[0].name;
    var W = WEEKS[WEEKS.length - 1];
    M.leadTimeBuckets = [{ iso: W, person: who, n: 2, nAll: 3, days: [4, 10] }];
    M.throughputBuckets = [{ iso: W, person: who, nAll: 3, nEst: 2, estHrs: 12.5 }];
    M.meta.registry.metrics.leadTime = { id: "leadTime", name: "Lead Time", unit: "days",
      target: null, coverageGate: 0.9 };
    M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
      target: null, coverageGate: 0.6 };
    M.meta.registry.metrics.arrived = { id: "arrived", name: "Arrived", unit: "items",
      target: null, coverageGate: 0 };
    M.meta.arrivalsAvailable = o.arrivalsAvailable === undefined ? true : o.arrivalsAvailable;
    M.arrivalWeeks = o.arrivalWeeks !== undefined ? o.arrivalWeeks
      : [{ iso: W, created: 18, resolved: 15, createdUnassigned: 4 }];
    return M;
  }

  // ── 1. The flow band shows Lead Time (PERIOD) · Throughput (PERIOD) ·
  // Arrived (ORG) each with ITS OWN scope tag — not one shared tag string
  // standing in for three tiles — and On-Time (PERIOD) keeps its own tag
  // where it already renders (#tiles). Catches: Arrived sharing another
  // tile's tag, or a scope tag rendered once for the whole panel.
  var M1 = flowFixture({});
  fresh(M1);
  C.setState("view", "exec");
  C.renderAll_();
  var flowHtml = flowHtml_();
  // Order in #flowTiles is now Cleared, Arrived, Lead Time, On-Time, Forecast,
  // Quality/Rework, Throughput, Bug Count (Task 16B resequence per spec §3/§4:
  // Arrived comes BEFORE Lead Time, and On-Time/Forecast/Quality — moved from
  // the retired #tiles strip — join the same band). Bound each tile's segment
  // by the '<div class="lbl">' TILE-BOUNDARY marker, not the bare label text —
  // Cleared's own tooltip mentions "Throughput's hours", so a bare split on
  // "Throughput" would find that mention first, not the real tile.
  var leadSeg = flowHtml.split('<div class="lbl">Lead Time')[1].split('<div class="lbl">On-Time')[0];
  var arrSeg = flowHtml.split('<div class="lbl">Arrived')[1].split('<div class="lbl">Lead Time')[0];
  var thrSeg = flowHtml.split('<div class="lbl">Throughput')[1].split('<div class="lbl">Bug Count')[0];
  assert_(leadSeg.indexOf(">PERIOD<") !== -1, "Lead Time carries its OWN PERIOD tag");
  assert_(thrSeg.indexOf(">PERIOD<") !== -1, "Throughput carries its OWN PERIOD tag");
  assert_(arrSeg.indexOf(">ORG<") !== -1 && arrSeg.indexOf(">PERIOD<") === -1,
          "Arrived carries its OWN ORG tag, not PERIOD — it is population-wide, filters don't apply");
  // Task 16B: On-Time now lives in #flowTiles too (moved from the retired
  // #tiles strip), alongside Arrived/Lead Time/etc. — not a separate element.
  var otSeg = flowHtml.split('<div class="lbl">On-Time Delivery')[1].split('<div class="lbl">Forecast Accuracy')[0];
  assert_(otSeg.indexOf(">PERIOD<") !== -1, "On-Time keeps its own PERIOD tag, now inside #flowTiles alongside the other flow tiles");
  assert_(/18/.test(arrSeg), "Arrived's headline is the fixture's created count (18)");

  // Filter-invariance companion: Arrived (ORG) must not move under a filter
  // that DOES move Lead Time/Throughput (PERIOD) — proving the tags describe
  // real, different behaviour, not decoration. Both fixture people are AMER in
  // the default `model()` shape, so filtering to a region with nobody in it
  // (EMEA) empties the PERIOD tiles' coverage but must leave Arrived untouched.
  var arrBefore = flowHtml_().split('<div class="lbl">Arrived')[1].split('<div class="lbl">Lead Time')[0];
  C.setState("region", "EMEA");
  C.renderAll_();
  var arrAfter = flowHtml_().split('<div class="lbl">Arrived')[1].split('<div class="lbl">Lead Time')[0];
  assert_(arrBefore === arrAfter, "Arrived (ORG) is byte-identical under a region filter that empties everyone else");
  C.setState("region", "");
  C.renderAll_();

  // ── 1b. A trend period with NO arrivalWeeks row must plot as a GAP, never
  // a fabricated measured zero (blocking fix: sumOver's old `t += … || 0`
  // fallback summed an absent week to 0, drawing a false "0 arrived" point
  // straight into the real figure beside it — the flat-zero-line bug). The
  // default fixture above already omits W30 (arrivalWeeks carries only the
  // last week, W31), so the two-point trend is exactly [gap, 18]. Would this
  // still pass if the coverage check were deleted? No — reverting sumOver to
  // sum missing isos as 0 regenerates the polyline and the second dot this
  // forbids.
  var arrSpark = arrSeg.slice(arrSeg.indexOf("<svg"));
  assert_(!/<polyline/.test(arrSpark),
    "Arrived's [gap, 18] trend draws NO connecting polyline — a real gap, not a fabricated 0-to-18 line");
  assert_((arrSpark.match(/<circle/g) || []).length === 1,
    "…and exactly ONE point plots (W31's real 18) — the missing W30 draws no dot, i.e. it is null, not a measured zero");

  // ── 2. Arrived renders "not measured" when meta.arrivalsAvailable is false.
  // Catches: falling through to a fabricated 0 instead of the absence state.
  var M2 = flowFixture({ arrivalsAvailable: false, arrivalWeeks: [] });
  fresh(M2);
  C.renderAll_();
  var arrOff = flowHtml_().split('<div class="lbl">Arrived')[1].split('<div class="lbl">Lead Time')[0];
  assert_(/not measured/.test(arrOff), "Arrived states 'not measured' when the arrivals feed is unavailable");
  assert_(/class="big">—<\/div>/.test(arrOff), "…and the hero renders the em-dash placeholder, no numeric value");
  assert_(!/class="big">[0-9]/.test(arrOff), "…confirmed: no digit ever lands in the hero slot");
  assert_(!/undefined|NaN/i.test(arrOff), "…with nothing printing undefined/NaN in its place");

  // ── 2b. Different absence: the feed IS available (meta.arrivalsAvailable
  // true) but the CURRENT period specifically has no arrivalWeeks row — the
  // period-level twin of check 1b above. Before the fix this fell through to
  // sumOver's 0-fallback: headline printed "0" (a measured-zero lie) and the
  // context string concatenated "null resolved this period…" straight from
  // the null resolvedCt/createdUnassigned. Catches: the same `|| 0` collapse,
  // this time on the HEAD period rather than a trend point, and any residual
  // "null"/"undefined" leaking into the sentence once created is null.
  var M2b = flowFixture({ arrivalWeeks: [] });   // available: true (default), but zero rows
  fresh(M2b);
  C.renderAll_();
  var arrGap = flowHtml_().split('<div class="lbl">Arrived')[1].split('<div class="lbl">Lead Time')[0];
  assert_(/class="big">—<\/div>/.test(arrGap),
    "no arrivalWeeks row for the head period → hero renders '—', never a measured '0'");
  assert_(!/class="big">0/.test(arrGap), "…specifically: no '0' in the hero slot (the exact conflation this fix targets)");
  assert_(/no arrivals data for this period/.test(arrGap),
    "…and the context line states the gap in words, distinct from the arrivalsAvailable:false 'not measured' wording");
  assert_(!/null|undefined|NaN/i.test(arrGap),
    "created===null never leaks into the resolvedCt/createdUnassigned concatenation as the literal string 'null'");

  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ── §5 CAPACITY BAND — kicker, margin gate, phase switch, floor grammar,
// people-signals reconciliation ─────────────────────────────────────────────
(function () {
  // ── 3. The capacity band is ABSENT FROM THE DOM ENTIRELY for a non-margin
  // role. Task 16B moved the Utilisation tile OUT of the old #tiles strip
  // INTO #pulsePanel, sharing renderPulse_'s ONE existing margin gate (rather
  // than carrying a second gate of its own that could disagree with it) — so
  // this now checks the capacity band's one panel, plus (belt-and-suspenders)
  // that the label never leaks into #flowTiles either. Never on a hidden
  // attribute. Catches: a regression that dims the tile instead of omitting
  // it, or a kicker/reconcile line that survives the gate even though the
  // numbers behind it are gone.
  var mGuest = fresh(model({}));
  mGuest.viewerRole = "guest";
  C.setModel(mGuest);
  C.setState("view", "exec");
  C.renderAll_();
  assert_(!/Billable Utilization|Capacity Utilization/.test(flowHtml_() + els.pulsePanel.innerHTML),
          "a non-margin role sees NO utilisation label anywhere in the executive pane");
  assert_(els.pulsePanel.innerHTML === "",
          "…and the capacity band's OWN panel — the Utilisation tile included, now that it lives here — is emptied entirely");
  assert_(els.pulsePanel.style.display === "none",
          "…display:none, not merely emptied — no ghost kicker/heading left in the DOM");
  assert_(!/CAPACITY — what we have to throw at it/.test(els.pulsePanel.innerHTML + flowHtml_()),
          "the kicker text itself is nowhere in the DOM for this role — not hidden, ABSENT");

  var mAdmin = fresh(model({}));
  mAdmin.viewerRole = "admin";
  // personHygiene has to be present for renderPulse_ to get past its own
  // "arrives after the next refresh" pre-v22-payload guard and reach the
  // kicker line at all.
  mAdmin.personHygiene = { open: mAdmin.people.map(function (p) {
    return { person: p.name, n: 10, due: 10, est: 10, logged: 10 };
  }), resolved: [] };
  C.setModel(mAdmin);
  C.setState("typePop", "open");
  C.renderAll_();
  assert_(els.pulsePanel.style.display === "", "…and restored for an admin");
  assert_(/CAPACITY — what we have to throw at it/.test(els.pulsePanel.innerHTML),
          "…with the capacity kicker back for a margin-tier role");

  // ── 4. Planning-window phase switch survives: the capacity slot becomes
  // Planned Coverage (now #pulsePanel, Task 16B), outcome tiles render notYet
  // (now #flowTiles), and the capacity band's OWN kicker/reconciliation line
  // still renders (planFor_ runs regardless of phase — only the Utilisation
  // card itself swaps its shape).
  // A genuine planning week needs a gridWeeks entry with status "plan" AND at
  // least one person carrying capacity/planned hours there (planWeeks_'s own
  // "reach" guard) — same fixture shape as the FORWARD WINDOWS block above.
  var PLAN1 = "2026.W32";
  function planFixture() {
    var mdl = histModel({});
    mdl.meta.gridWeeks = HIST.map(function (iso, i) {
      return { iso: iso, status: i < HIST.length - 1 ? "done" : "now" };
    }).concat([{ iso: PLAN1, status: "plan" }]);
    mdl.meta.periods.month[1].isos = HIST.slice(4).concat([PLAN1]);
    mdl.personHygiene = { open: mdl.people.map(function (p) {
      return { person: p.name, n: 10, due: 10, est: 10, logged: 10, loggedN: 10 };
    }), resolved: [] };
    mdl.people.forEach(function (p) {
      p.weeks[PLAN1] = week({ tracked: 0, trackedCov: 0, billable: 0, nonBillable: 0,
        nsCov: false, availCov: 0, capCov: 0, nsBillRaw: 0, nsNonBillRaw: 0,
        planned: 20, effPlanned: 20 });
    });
    return mdl;
  }
  fresh(planFixture());
  C.getModel().viewerRole = "admin";
  C.STATE.period = "week";
  C.setState("typePop", "open");
  var planAll = C.analysisPeriods_();
  C.setState("periodIdx", planAll.length - 1);   // the one forward planning week
  C.renderAll_();
  assert_(C.analysisHead_().phase === "plan", "sanity: the picker selection resolves as phase 'plan'");
  var planCapacity = els.pulsePanel.innerHTML;
  var planOutcome = flowHtml_();
  assert_(/Planned Coverage/.test(planCapacity),
          "capacity slot becomes Planned Coverage on a planning window, now rendered inside #pulsePanel");
  assert_(/has not happened yet/.test(planOutcome),
          "outcome tiles (On-Time/Forecast) render their notYet state, now inside #flowTiles");
  assert_(/CAPACITY — what we have to throw at it/.test(planCapacity),
          "the capacity band's own kicker still renders on a planning window — only the Utilisation " +
          "card switches shape, the band itself doesn't disappear");
  C.setState("periodIdx", null);

  // ── 5. Mid-period floor grammar survives: "at least N%", no RAG colour.
  fresh(histModel({}));
  C.getModel().viewerRole = "admin";
  C.setState("periodIdx", C.donePeriods_().length);   // the in-flight "now" window
  C.renderAll_();
  assert_(C.analysisHead_().phase === "now", "sanity: this selection resolves as phase 'now' (mid-period)");
  // withUtilization_: the card ships off, so this segment would be empty and the
  // floor-grammar assertions below would pass without testing anything.
  var nowTiles = withUtilization_(function () {
    C.renderAll_();
    return els.pulsePanel.innerHTML;   // Utilisation lives in the capacity band (Task 16B)
  });
  C.renderAll_();
  var nowUtilSeg = nowTiles.split("Utilization")[1] || "";
  assert_(/at least \d+%/.test(nowUtilSeg), "mid-period utilisation carries the floor grammar ('at least N%')");
  assert_(!/class="big (g|a|r)"/.test(nowUtilSeg.split("</div>")[0] + "</div>"),
          "…and the hero carries NO RAG class — a floor has no verdict to give");
  C.setState("periodIdx", null);
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();

  // ── 6. The people-signals line reconciles to a REAL, computed count — not
  // a hardcoded string and never a stringified object (the design doc's
  // "[object Object]" prototype bug) — and it names nobody. Checked across
  // TWO different filtered populations so a hardcoded number can't hide
  // behind a single fixture, plus the "no names" guard the pulse already
  // carries elsewhere in this file.
  var mRec = fresh(model({}));
  mRec.people.push(person("Gia Extra", { region: "EMEA" }));
  mRec.personHygiene = { open: mRec.people.map(function (p) {
    return { person: p.name, n: 10, due: 10, est: 10, logged: 10 };
  }), resolved: [] };
  mRec.viewerRole = "admin";
  C.setModel(mRec);
  C.setState("view", "exec");
  C.setState("typePop", "open");
  C.renderAll_();
  var recAll = els.pulsePanel.innerHTML;
  var reconcileFullMatch = /(\d+)(?:<\/b>)? of (\d+) people accounted for/.exec(recAll);
  assert_(reconcileFullMatch, "the reconciliation line states an X of Y count — got: " + recAll);
  assert_(reconcileFullMatch[1] === reconcileFullMatch[2] && reconcileFullMatch[2] === "3",
          "unfiltered: all 3 fixture people accounted for (2 base + 1 pushed) — got: " + recAll);
  assert_(!/\[object Object\]/.test(recAll), "never a stringified object where the count should be");

  // Narrow the population — the reconciliation total must actually MOVE, not
  // be a static string that happened to say "3" by coincidence.
  C.setState("region", "EMEA");
  C.renderAll_();
  var recEmea = els.pulsePanel.innerHTML;
  var reconcileEmea = /(\d+)(?:<\/b>)? of (\d+) people accounted for/.exec(recEmea);
  assert_(reconcileEmea && reconcileEmea[1] === "1" && reconcileEmea[2] === "1",
          "filtered to EMEA (1 person: Gia Extra) the reconciliation count drops to 1 of 1 — got: " + recEmea);
  C.setState("region", "");

  // No names, on this line specifically as well as the panel generally.
  C.getModel().people.forEach(function (p) {
    assert_(recAll.indexOf(p.name) === -1, "reconciliation line/panel must not name " + p.name);
  });

  C.setState("typePop", "open");
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// TASK 15 — THE COMPARISON GRID (spec 2026-08-06 §6): clearedPerHead replaces
// absolute Cleared, queueCover joins the columns, and neither draws a target
// rule anywhere. Every check below states the mutation it is there to catch.
// ══════════════════════════════════════════════════════════════════════════

// ── capRows_ at the unit level: the shared cap/rank primitive both the grid
// and the bullet chart now call ──────────────────────────────────────────────
(function () {
  var many = [];
  for (var i = 0; i < 15; i++) many.push({ key: "K" + i, label: "K" + i, value: 100 - i, n: 20 });
  var sel = C.capRows_(many, false);
  assert_(sel.rows.length === 12, "capRows_ defaults to the HBAR_MAX_ROWS_ cap (12)");
  assert_(sel.hidden === 3, "…and reports exactly how many rows were cut");
  // Ascending value order keeps the LOWEST 12 (K3..K14, values 86-97); the
  // highest 3 (K0-K2, values 98-100 — closest to/over a hypothetical target)
  // are cut. Mutation this catches: sorting descending, or slicing the first
  // N of the ORIGINAL array by list position instead of by value, would keep
  // K0-K11 instead and this assertion would fail.
  var kept = many.filter(function (r) { return sel.rows.indexOf(r) !== -1; }).map(function (r) { return r.key; });
  assert_(kept.indexOf("K14") !== -1 && kept.indexOf("K0") === -1,
          "the LOWEST-value rows survive (furthest below reference), never the first N by position");
  var full = C.capRows_(many, true);
  assert_(full.rows.length === 15 && full.hidden === 0, "expanded:true lifts the cap entirely");
})();

// ── The grid and the bullet chart share the SAME capped row set (integration) ──
(function () {
  function manyTeamsFixture(n) {
    var mdl = model({});
    var teams = [], ppl = [], buckets = [];
    for (var i = 0; i < n; i++) {
      var t = "Team " + i;
      teams.push(t);
      var name = "P" + i;
      ppl.push(person(name, { region: "AMER", teams: [t] }));
      var pct = 40 + i * 3, cnt = 20;
      buckets.push({ iso: WEEKS[WEEKS.length - 1], person: name, n: cnt,
                     onTime: Math.round(cnt * pct / 100), nAll: cnt });
    }
    mdl.meta.teams = teams;
    mdl.people = ppl;
    mdl.onTimeBuckets = buckets;
    return mdl;
  }
  fresh(manyTeamsFixture(15));
  C.STATE.compare = "team";
  C.setState("metric", "onTime");
  C.switchView_("exec");
  C.renderAll_();
  var html = els.comparePanel.innerHTML;
  var gridSeg = html.split("gridTable")[1] ? html.split("gridTable")[1].split("</table>")[0] : "";
  var rowCount = (gridSeg.match(/<td class="tname">/g) || []).length;
  assert_(rowCount === 12,
          "the grid caps at HBAR_MAX_ROWS_ (12) rows, same as the bullet chart — got " + rowCount);
  assert_(/Show all 15/.test(html), "…and the same 'Show all N' affordance is offered");
  assert_(/role="button"/.test(html) && /tabindex="0"/.test(html),
          "grid column headers are keyboard-reachable (role=button, tabindex=0)");
  assert_(/onclick="setMetric_\('onTime'\)"/.test(html),
          "…and clicking the onTime column header sets STATE.metric via setMetric_");
  // Worst-first (Team 0, 40%, furthest below the 85% target) survives the cap;
  // best (Team 14, 82%, closest to target) is cut. capRows_ ranks by DISTANCE
  // BELOW REFERENCE, never by list position — that is the rule under test, and
  // it is now the grid's alone: the bullet chart it used to share the selection
  // with was removed on 2026-08-17 (it restated this same table).
  assert_(gridSeg.indexOf(">Team 0 <") !== -1, "Team 0 (worst) survives the grid's cap");
  assert_(gridSeg.indexOf(">Team 14 <") === -1, "Team 14 (best) is cut from the grid");
  // THE CHART IS GONE, and its absence is asserted rather than assumed —
  // otherwise a future edit could put a redundant full-width chart back and
  // nothing would object.
  assert_(html.indexOf('class="chart hbar"') === -1,
          "the comparison panel draws no bar chart — the grid already carries every value");
  // Expanding must reach the rows the cap hid, or the cap is a silent truncation.
  C.setState("compareAll", true);
  C.renderCompare_();
  var expanded = els.comparePanel.innerHTML;
  assert_(expanded.indexOf(">Team 14 <") !== -1,
          "…and 'Show all' reveals the rows the cap held back");
  assert_(/Show top /.test(expanded), "…with a way back to the shortlist");
  C.setState("compareAll", false);
  C.renderCompare_();

  C.STATE.compare = "region";
  C.setState("metric", "onTime");
  fresh(model({}));
  C.switchView_("exec");
  C.renderAll_();
})();

// ── Per-head fairness, sub-10 ungraded-but-visible, no target rule ──────────
(function () {
  var W = WEEKS[WEEKS.length - 1];
  // The brief's own example, verbatim: ANZ (8 people) clears 12 items; AMER
  // (63 people) clears 61. Absolute-count grading ranks AMER over ANZ; per-
  // head grading must not — this is the one fixture shape that separates the
  // fix from the bug (brief's own "assertion strength" note).
  function headFixture() {
    var mdl = model({});
    var ppl = [];
    for (var i = 0; i < 63; i++) ppl.push(person("AMER " + i, { region: "AMER", teams: [] }));
    for (var j = 0; j < 8; j++) ppl.push(person("ANZ " + j, { region: "ANZ", teams: [] }));
    mdl.people = ppl;
    mdl.meta.regions = ["AMER", "ANZ"];
    mdl.throughputBuckets = [
      { iso: W, person: "AMER 0", nAll: 61, nEst: 61, estHrs: 300 },
      { iso: W, person: "ANZ 0", nAll: 12, nEst: 12, estHrs: 60 },
    ];
    return mdl;
  }

  // ── 1. SAME per-head basis — ANZ (12/8/1wk = 1.5) beats AMER (61/63/1wk ≈
  // 0.97) despite clearing far fewer items. Mutation this catches: reverting
  // clearedPerHead.value to the raw resolved count (the prototype's bug)
  // would make AMER (61) read higher than ANZ (12), flipping this.
  fresh(headFixture());
  var amerNames = {}, anzNames = {};
  for (var a = 0; a < 63; a++) amerNames["AMER " + a] = 1;
  for (var b = 0; b < 8; b++) anzNames["ANZ " + b] = 1;
  var amerPerHead = C.scopedMetric_(C.METRICS_.clearedPerHead, [W], amerNames);
  var anzPerHead = C.scopedMetric_(C.METRICS_.clearedPerHead, [W], anzNames);
  assert_(Math.abs(amerPerHead - 61 / 63) < 1e-9, "AMER per-head = 61 items ÷ 63 people ÷ 1 week");
  assert_(Math.abs(anzPerHead - 12 / 8) < 1e-9, "ANZ per-head = 12 items ÷ 8 people ÷ 1 week");
  assert_(anzPerHead > amerPerHead,
          "the SMALLER group (ANZ: 8 people, 12 items) outperforms the LARGER one (AMER: 63 " +
          "people, 61 items) on a per-head basis — the smaller group is not automatically worse");

  // ── The CELL rules, tested on gridCellHtml_ directly ─────────────────────
  // Until 2026-08-17 these were read off clearedPerHead's own column in the
  // rendered grid. That column is gone — the metric left the Drill-down — but
  // the three rules it was the fixture FOR are properties of gridCellHtml_ and
  // still govern every column that remains, so they are asserted against the
  // function instead of against a column that no longer exists.
  //
  // The no-target branch below regained a live subject on 2026-08-17: the
  // Availability Rate column (targetKey null) joined the grid, so its cells
  // land there on every render — deliberately, with no target agreed for it.
  var cphUnit = "items";
  // 1 · QUANTISATION. AMER 61/63 = 0.968… must print "1.0", never a bare "1":
  // Math.round (the old behaviour) and Math.round(v*10)/10 read back through
  // naive concat (1.0 + "" === "1") both regenerate the bug. ANZ 12/8 = 1.5
  // must keep its decimal too — a 1.55x gap must read 1.0 vs 1.5, never 1 vs 2.
  var amerCph = C.gridCellHtml_({ value: 61 / 63, unit: cphUnit, n: 63, target: null, std: null });
  var anzCph = C.gridCellHtml_({ value: 12 / 8, unit: cphUnit, n: 8, target: null, std: null });
  assert_(amerCph.indexOf("1.0") !== -1,
    "AMER's per-head cell renders the decimal '1.0' (61/63 ≈ 0.968), not a bare rounded integer — got: " + amerCph);
  assert_(!/\b1\b/.test(amerCph.replace("1.0", "")),
    "…no lingering bare '1' once the decimal token itself is accounted for");
  assert_(!/\b2\b/.test(amerCph), "…and AMER's value never rounds up to 2 either");
  assert_(anzCph.indexOf("1.5") !== -1,
    "ANZ's per-head cell renders the decimal '1.5' (12/8) — got: " + anzCph);
  assert_(!/\b2\b/.test(anzCph), "…never rounds up to the fabricated '2' the old Math.round produced");

  // 2 · SMALL GROUPS ARE GRADED LIKE EVERY OTHER (user decision 2026-08-17).
  // The rule this replaces greyed any category under 10 people and labelled it
  // "ungraded (small n)" — which greyed the cell failing hardest and left the
  // reader to judge severity from fine print. The volume question that caveat
  // was really asking is now answered by the counts instead (§2b).
  assert_(!/ungraded \(small n\)/.test(anzCph),
          "an 8-person group is no longer labelled ungraded");
  assert_(!/ungraded \(small n\)/.test(amerCph), "…nor is a 63-person one");
  assert_(!/sigSmall/.test(anzCph), "…and the grey small-n dot is gone with it");
  // Graded EXACTLY like a large group against the same target. Both directions
  // asserted: a 6-person group below target must be red, and one above it must
  // be green — a helper that simply always returned "red" would pass one alone.
  var tgt = { green: 85, amber: 70 };
  var tinyBad = C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 6, sampleNoun: "items" });
  var tinyGood = C.gridCellHtml_({ value: 95, n: 6, target: tgt, sampleN: 6, sampleNoun: "items" });
  var bigBad = C.gridCellHtml_({ value: 50, n: 60, target: tgt, sampleN: 100, sampleNoun: "items" });
  assert_(/sigBad/.test(tinyBad),
          "a 6-person group at 50% against an 85% target is RED, exactly as a large one would be");
  assert_(/sigGood/.test(tinyGood), "…and green when it clears the target");
  assert_(/sigBad/.test(bigBad), "…the large group is graded the same way, by the same rule");

  // 2b · THE COUNTS REPLACE THE CAVEAT. 50% is a different fact at 1-of-2 than
  // at 50-of-100, and that difference is what decides whether the row is worth
  // a click. Printed, not warned about.
  var oneOfTwo = C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 2, sampleNoun: "items" });
  assert_(/\(1\/2 items\)/.test(oneOfTwo),
          "the cell states the absolute counts beside the rate — got: " + oneOfTwo);
  assert_(/\(3\/6 items\)/.test(
            C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 6, sampleNoun: "items" })),
          "…derived from the metric's own denominator, so 50% of 6 reads 3/6");
  assert_(/\(50\/100 items\)/.test(bigBad), "…and 50% of 100 reads 50/100");
  // The numerator comes from the UNROUNDED value: 61/63 is 96.8%, and rounding
  // the displayed 97% back out would print 61 as 61 by luck but 62 at other
  // ratios. Asserted on a ratio where the two disagree.
  assert_(/\(2\/3 items\)/.test(
            C.gridCellHtml_({ value: 200 / 3, n: 20, target: tgt, sampleN: 3, sampleNoun: "items" })),
          "66.67% of 3 is 2 — the numerator is derived before rounding, not after");
  // A metric whose n() is HOURS carries no noun and prints no fraction: a
  // "(1400/2000 items)" under utilization would be a unit nobody measured.
  assert_(!/\(\d+\/\d+/.test(C.gridCellHtml_({ value: 50, n: 6, target: tgt, sampleN: 2000 })),
          "a metric with no sampleNoun prints the rate alone");
  assert_(!/\(\d+\/\d+ items\)/.test(anzCph),
          "…as does a unit metric, whose value is not a share of anything");
  assert_(!/No measurable data/.test(anzCph),
          "…and none of this is the null/no-data branch — these cells have real values");

  // 3 · No target AND no publishable norm: no colour — and the "no reference"
  // CAPTION IS GONE (user 2026-08-17). It forced the reader to guess what the
  // system meant, on every row of a target-less column; the fact moved into the
  // cell's tooltip, and the absent RAG glyph already reads as "not graded".
  assert_(!/sigGood|sigWarn|sigBad/.test(amerCph), "a target-less cell carries no RAG colour");
  assert_(!/no reference/.test(amerCph),
          "…the 'no reference' caption no longer clutters the cell");
  assert_(/No organizational target/.test(amerCph),
          "…and the reason lives in the tooltip instead");
  // …and when a norm DOES publish, the same cell defers to the band instead.
  // This is the positive half of the same rule.
  var withBand = C.gridCellHtml_({ value: 61 / 63, unit: cphUnit, n: 63, target: null,
                                   std: { ok: true, lo: 0.8, hi: 1.4 } });
  assert_(!/no reference|No organizational target/.test(withBand),
          "with a published norm the cell stops claiming it has no reference");
  assert_(/operating band/.test(withBand), "…and points at the band it is graded against");

  // 3b · OVER-ALLOCATION, NEVER A NEGATIVE RATE (user 2026-08-17). Availability
  // goes below zero when planned hours exceed scheduled capacity. "-25%
  // available" is a data artefact a director cannot act on; the cell clamps to
  // 0%, raises a red pill, and keeps the raw magnitude in the tooltip.
  var overCell = C.gridCellHtml_({ value: -25, n: 10, target: null, std: null, unit: null });
  assert_(/pillOver/.test(overCell) && /Over-allocated/.test(overCell),
          "a negative rate renders the red Over-allocated pill — got: " + overCell);
  assert_(overCell.indexOf("0%") !== -1, "…with the value clamped to 0%");
  assert_(overCell.indexOf("-25") === -1, "…and the negative number itself is never printed");
  assert_(/by 25%/.test(overCell), "…while the tooltip keeps the overrun's magnitude");
  assert_(!/sigGood|sigWarn|sigBad/.test(overCell),
          "…and no RAG glyph — the pill is the verdict, stated in words");

  // ── 4. The coverage sentence is NOT re-asserted here ─────────────────────
  // It used to be, on this 71-person fixture, because clearedPerHead was the
  // metric being charted and it had a value for both regions. No surviving
  // drill-down metric has buckets in this fixture, so the chart renders its
  // empty state and there is no sentence to read. Rather than invent bucket
  // data to keep a line alive, the rule stays pinned where it already is — on
  // two populated fixtures earlier in this file ("all N people represented").

  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  fresh(model({}));
  C.switchView_("exec");
  C.renderAll_();
})();

// ── queueCover carries its OWN label/axis/detail — never the hero's shared
// registry formula (blocking fix D5). Before the fix, METRICS_.queueCover
// read reg_("queueCover").name/.formula directly, which is the HERO's
// WHOLE-POPULATION formula ("assigned open + unassigned open ÷ …") even
// though this column's own value() (unchanged) computes ASSIGNED-ONLY — the
// grid printed ~4-5w under a caption that, read literally, claims to include
// the ~1,839 unassigned issues the hero's ~11w actually does. Mutation this
// catches: reverting label()/axis()/detail() back to the reg_() reads
// reintroduces "Weeks to Clear" and "unassigned open" on this surface.
// Asserted on the ACCESSOR since 2026-08-17: queueCover left the Drill-down, so
// there is no panel to read the strings off any more. The rule is unchanged and
// still worth pinning — the entry survives because the shelf reads it, and a
// future reader restoring it to a chart must not also restore the collision.
(function () {
  fresh(model({}));
  var qc = C.METRICS_.queueCover;
  assert_(qc.label() === "Assigned wks to clear",
    "queueCover's own label reads 'Assigned wks to clear', not the hero's 'Weeks to Clear'");
  assert_(qc.label().indexOf("Weeks to Clear") === -1,
    "…and the hero's own metric name never leaks onto this metric");
  assert_(qc.axis().indexOf("median assigned weekly clearing rate") !== -1,
    "the axis caption states the ASSIGNED-ONLY formula");
  var qcText = [qc.label(), qc.axis(), qc.detail()].join(" | ");
  assert_(qcText.indexOf("unassigned") === -1,
    "…and the registry's whole-population formula ('assigned open + unassigned open') never " +
    "reaches any of this metric's own strings — label, axis or hover detail");
  assert_(qc.detail().indexOf("assigned weekly clearing rate") !== -1,
    "the hover-detail states the assigned-only formula rather than falling back to reg_()");
})();

// ── fmtGridVal_ "weeks" branch, RENDERED (blocking fix D4, the queueCover
// half): the grid must print "5.0w" — one decimal AND the hero's own "w"
// suffix — never a bare "5". A 7-complete-week fixture with clearRate=1 and
// open (wipN 3 + todoN 2) = 5 makes queueCover's value EXACTLY 5, the one
// value where Math.round(v) (the old code) and the fixed formatter agree on
// the DIGITS and could only be told apart by the suffix/decimal — the
// discriminating case for this specific bug (a bare "5" vs "5.0w").
(function () {
  var mdl = histModel({});
  mdl.people = [person("Ana AMER", { region: "AMER" })];
  mdl.flowOpenBuckets = [{ person: "Ana AMER", wipN: 3, todoN: 2, todoEst: 2, todoHrs: 10 }];
  mdl.throughputBuckets = HIST.slice(0, -1).map(function (iso) {
    return { iso: iso, person: "Ana AMER", nAll: 1, nEst: 1, estHrs: 5 };
  });
  fresh(mdl);
  assert_(C.assignedClearRate_() === 1, "fixture's assigned clear rate is exactly 1 (median of 7 weeks at nAll=1)");
  assert_(C.METRICS_.queueCover.value() === 5, "queueCover's raw value is exactly 5 (open 5 ÷ rate 1) — the case that discriminates suffix/decimal from digits");
  // Rendered through gridCellHtml_ directly since 2026-08-17: queueCover is no
  // longer a grid column, but the "weeks" formatter branch it was the fixture
  // for still serves any metric carrying unit:"weeks", and the bug it guards
  // (a bare "5" where "5.0w" is required) is in the formatter, not the column.
  var wkCell = C.gridCellHtml_({ value: C.METRICS_.queueCover.value(), unit: "weeks",
                                 n: 63, target: null, std: null });
  assert_(wkCell.indexOf("5.0w") !== -1,
    "a weeks-unit grid cell renders '5.0w' (one decimal + the weeks suffix) — got: " + wkCell);
  assert_(!/>5</.test(wkCell) && !/ 5 /.test(wkCell.replace("5.0w", "")),
    "…and never the bare unlabelled '5' the old Math.round(v) formatter produced");

  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  fresh(model({}));
  C.switchView_("exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// TASK 16 — THE SHELF + DATA TRUST DETAIL (spec 2026-08-06 §7/§8): fully
// data-driven, no hand-written list, no owner column, no hardcoded editorial.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var W = WEEKS[WEEKS.length - 1];
  resetFilters();

  // ── 1. registry status "absent" appears with its OWN reason ─────────────
  var m1 = model({});
  m1.meta.registry.metrics.cycleTime = {
    id: "cycleTime", name: "Cycle Time", coverageGate: 0, status: "absent",
    absentReason: "Needs the changelog, which is not exported.", deviations: [],
  };
  fresh(m1);
  var rows1 = C.shelfRows_();
  var ct = rows1.filter(function (r) { return r.id === "cycleTime"; })[0];
  assert_(ct, "an absent-status registry metric appears on the shelf");
  assert_(ct.why.join(" ").indexOf("Needs the changelog") !== -1,
          "…carrying its OWN absentReason, not a generic placeholder — got: " + ct.why.join(" "));

  // ── 2. below sample floor: n AND what it needs are stated ───────────────
  var m2 = model({});
  m2.meta.registry.metrics.onTime.sampleFloor = 5;
  m2.onTimeBuckets = [{ iso: W, person: "Ana Perez", n: 2, onTime: 2, nAll: 2 }];
  fresh(m2);
  var ot2 = C.shelfRows_().filter(function (r) { return r.id === "onTime"; })[0];
  assert_(ot2, "onTime resting on 2 measurable records (floor 5) appears on the shelf");
  assert_(/\b2\b/.test(ot2.why.join(" ")) && /needs 5/.test(ot2.why.join(" ")),
          "…stating BOTH how many it has (2) and how many it needs (5) — got: " + ot2.why.join(" "));

  // ── 3. below the COVERAGE GATE but ABOVE the floor does NOT appear ──────
  // n=6 (above floor 5), nAll=60 → 10% coverage against a 70% gate. Mutation
  // this catches: a shelfRows_ that also checks the gate directly (the exact
  // conflation the design spec warns against) would shelve forecast here.
  var m3 = model({});
  m3.meta.registry.metrics.forecast.sampleFloor = 5;
  m3.forecastBuckets = [{ iso: W, person: "Ana Perez", n: 6, nWithin: 3, nAll: 60,
                          nNoTime: 0, nMissOver: 2, nMissUnder: 1,
                          absVars: [0.1, 0.2, 0.3, 0.1, 0.2, 0.4] }];
  fresh(m3);
  assert_(!C.shelfRows_().some(function (r) { return r.id === "forecast"; }),
          "forecast (6 records, above its floor of 5, though only 10% covered) does NOT appear " +
          "on the shelf — below-gate still publishes (D5), the gates band carries that read");

  // ── 4. below floor AND below gate → exactly ONE entry, naming BOTH ──────
  var m4 = model({});
  m4.meta.registry.metrics.onTime.sampleFloor = 5;
  m4.onTimeBuckets = [{ iso: W, person: "Ana Perez", n: 2, onTime: 1, nAll: 100 }]; // 2% cov, gate 80%
  fresh(m4);
  var matches4 = C.shelfRows_().filter(function (r) { return r.id === "onTime"; });
  assert_(matches4.length === 1,
          "below floor AND below gate produces exactly ONE shelf entry, not two — got " + matches4.length);
  var reason4 = matches4[0].why.join(" ");
  assert_(/needs 5/.test(reason4) && /coverage gate/.test(reason4),
          "…and that one entry names BOTH the floor shortfall and the gate shortfall — got: " + reason4);

  // ── 5. NO owner name reaches the shelf (D9) ────────────────────────────
  // The shelf PANEL was deleted in the redesign (2026-08-17); shelfRows_ lives
  // on, because the masthead still counts its entries into the "N shelved"
  // evidence chip. So the rule is checked where it now bites: on the row
  // objects themselves, and on everything the Executive tab actually prints.
  var m5 = model({});
  m5.meta.registry.metrics.cycleTime = {
    id: "cycleTime", name: "Cycle Time", coverageGate: 0, status: "absent",
    absentReason: "no feed", owner: "Delivery leadership", paramOwner: "Services Director",
    deviations: [],
  };
  fresh(m5);
  C.getModel().viewerSuper = true;
  C.setState("view", "exec");
  C.renderAll_();
  var shelfRows5 = C.shelfRows_();
  assert_(shelfRows5.some(function (r) { return /Cycle Time/.test(r.name); }),
          "sanity: shelfRows_ still picks the metric up");
  var shelfJson = JSON.stringify(shelfRows5);
  assert_(!/Delivery leadership/.test(shelfJson) && !/Services Director/.test(shelfJson),
          "no owner/paramOwner name is carried on a shelf row — the object has nothing to leak");
  // …and nothing on the Executive tab prints one either.
  var exec5 = els.masthead.innerHTML + flowHtml_() + els.backlogBand.innerHTML +
              els.pulsePanel.innerHTML + els.trustDetail.innerHTML;
  assert_(!/Delivery leadership/.test(exec5) && !/Services Director/.test(exec5),
          "…and no owner name appears anywhere on the rendered Executive tab");
  // The count still reaches the reader — deleting the panel must not have
  // deleted the signal that something is unmeasurable.
  assert_(/shelved/.test(els.masthead.innerHTML),
          "the masthead still reports the shelved count — the panel went, the signal did not");

  // ── 6. Trust detail is a COLLAPSED <details> ────────────────────────────
  var detailHtml0 = els.trustDetail.innerHTML;
  assert_(/<details>/.test(detailHtml0), "the trust detail is a <details> element");
  assert_(!/<details open/.test(detailHtml0), "…and is NOT open by default — collapsed per spec §8");

  // ── 7. Little's Law figures are COMPUTED from the model, not literal ────
  var mA = model({});
  mA.queue = { assigned: { items: 400, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
               unassigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 } };
  mA.meta.clearRateMedian = 100;
  mA.leadTimeBuckets = [{ iso: W, person: "Ana Perez", n: 2, nAll: 2, days: [14, 14] }];
  fresh(mA);
  // Tier 3 is super-admin only (redesign 2026-08-17) — the fixture has to be
  // one, or the panel is (correctly) absent and every check below reads "".
  C.getModel().viewerSuper = true;
  C.renderAll_();
  var detailA = els.trustDetail.innerHTML;
  assert_(/400 items/.test(detailA) && /100\/wk/.test(detailA) && /2\.0 weeks/.test(detailA),
          "Little's Law states the model's OWN measured inventory (400), rate (100/wk) and lead " +
          "time (2.0wk) — got: " + detailA);
  // Predicted = 100/wk × 2.0wk = 200 — half the measured 400, so the
  // "material gap" branch, not "broadly consistent", must render.
  assert_(/≈200 items/.test(detailA) && /material gap/.test(detailA),
          "…and the PREDICTED figure (200) is computed from them, not hardcoded — got: " + detailA);

  // Change the model — the printed figures, AND the consistency verdict,
  // must move with it. Mutation this catches: a version that computed the
  // sentence once and cached a literal string would still show 400/100/200
  // and "material gap" here regardless of the new model.
  var mB = model({});
  mB.queue = { assigned: { items: 600, wipN: 0, todoN: 0, todoHrs: 0, unattributed: 0, uncategorized: 0 },
               unassigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 } };
  mB.meta.clearRateMedian = 300;
  mB.leadTimeBuckets = [{ iso: W, person: "Ana Perez", n: 2, nAll: 2, days: [14, 14] }];
  fresh(mB);
  // Tier 3 is super-admin only (redesign 2026-08-17) — the fixture has to be
  // one, or the panel is (correctly) absent and every check below reads "".
  C.getModel().viewerSuper = true;
  C.renderAll_();
  var detailB = els.trustDetail.innerHTML;
  assert_(/600 items/.test(detailB) && /300\/wk/.test(detailB),
          "…changing the model's queue/rate changes the printed figures — got: " + detailB);
  assert_(/≈600 items/.test(detailB) && /broadly consistent/.test(detailB),
          "…and the verdict flips to consistent (300 × 2.0 = 600 matches the measured 600 " +
          "exactly) because it is computed, not the same cached sentence — got: " + detailB);

  // ── 8. No hardcoded editorial anywhere in either rendered panel ─────────
  var everyExecHtml = els.masthead.innerHTML + els.trustDetail.innerHTML +
                       C.renderTrust_();
                       els.pulsePanel.innerHTML + els.trustPanel.innerHTML;
  assert_(!/not credible/i.test(everyExecHtml), "'not credible' appears nowhere");
  assert_(!/1 person on leave/i.test(everyExecHtml), "'1 person on leave' appears nowhere");

  // Teardown.
  resetFilters();
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// 🌊 BACKLOG HEALTH — unassigned vs unattributed (blocking fix D3): an
// ABSENT assignee (`unassigned`) and an assignee the roster join could not
// resolve (`unattributed`) are DIFFERENT populations and must render as two
// separate sentences, never one combined "N excluded" count — the exact
// conflation attrN (Code.js) already exists to prevent on the 🧬 matrix,
// reappearing here on a fourth surface once unassigned rows joined the
// export (Jira Backlog.js v3.11.0, +~1,839 open issues). No render-smoke
// coverage existed for this panel before this fix set.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var mdl = model({});
  // Person-keyed bucket with only the fields this check needs — backlogRowHtml_
  // skips any BACKLOG_META_ signal missing from a row (t[k] === undefined),
  // so an intentionally-sparse fixture is safe and does not fabricate signals.
  mdl.backlogHealth = {
    buckets: [{ person: "Ana Perez", n: 3, keys: {}, keysCapped: {} }],
    unattributed: 5,
    unassigned: 12,
    asOf: new Date(2026, 6, 30).toISOString(),
  };
  fresh(mdl);
  C.renderBacklogHealth_();
  var html = els.backlogPanel.innerHTML;

  // ── 1. Both counts render, as TWO SEPARATE sentences with their own wording,
  // not summed into one. Mutation this catches: a shared "N excluded" template
  // fed unassigned+unattributed (17) would still be "truthy" and pass a naive
  // "some exclusion note renders" check — these assertions require the ACTUAL
  // per-population count and wording, and reject the summed figure outright.
  assert_(/12 open items have no assignee and are excluded/.test(html),
    "unassigned (12, no assignee at all) states its OWN count and reason — got: " + html);
  assert_(/5 open items have an assignee the roster join could not match/.test(html),
    "unattributed (5, assignee present, join failed) states its OWN, DIFFERENT reason — got: " + html);
  assert_(!/17 open items/.test(html),
    "…the two counts are NEVER pre-summed into one combined '17' sentence");
  assert_(!/12 open items could not be matched to a roster person/.test(html),
    "…and the OLD wording (which named 'unassigned' with the roster-join reason) is gone");

  // ── 2. Singular/plural agreement holds at n=1 for each population
  // independently — proving the two sentences are genuinely separate
  // templates, not one template parameterised by a single shared count.
  var mdl1 = model({});
  mdl1.backlogHealth = {
    buckets: [{ person: "Ana Perez", n: 1, keys: {}, keysCapped: {} }],
    unattributed: 1, unassigned: 1, asOf: null,
  };
  fresh(mdl1);
  C.renderBacklogHealth_();
  var html1 = els.backlogPanel.innerHTML;
  assert_(/1 open item has no assignee and is excluded/.test(html1),
    "unassigned singular ('1 open item has… is excluded') — got: " + html1);
  assert_(/1 open item has an assignee the roster join could not match and is excluded/.test(html1),
    "unattributed singular, independently correct — got: " + html1);

  // ── 3. Zero on either side renders NO sentence for that side (falsy count
  // guard, unchanged from before this fix) — proving the split didn't turn a
  // zero into a spurious "0 open items…" line.
  var mdl0 = model({});
  mdl0.backlogHealth = {
    buckets: [{ person: "Ana Perez", n: 1, keys: {}, keysCapped: {} }],
    unattributed: 0, unassigned: 0, asOf: null,
  };
  fresh(mdl0);
  C.renderBacklogHealth_();
  var html0 = els.backlogPanel.innerHTML;
  assert_(!/no assignee/.test(html0) && !/roster join could not match/.test(html0),
    "zero on both sides prints neither sentence — got: " + html0);

  // ── 4. OVERDUE IS WEEK-GRAINED, AND THE PANEL SAYS SO (managers' 2026-08-10) ─
  // The maths is server-side (Code.js dhOverdue_, pinned by
  // _test_backlogOverdueWeekGrain_). What has to hold HERE is that the panel does
  // not describe the old rule: a row labelled "not yet due" while the count
  // includes this week's dates would send a reader to argue with a correct number.
  var mdlW = model({});
  mdlW.backlogHealth = {
    buckets: [{ person: "Ana Perez", n: 10, dated: 6, futureDated: 4, overdue: 2,
                overdue7: 1, overdue30: 1, overdueOver30: 0, undated: 4,
                keys: { overdue7: ["W-1"], overdue30: ["W-2"] }, keysCapped: {} }],
    unattributed: 0, unassigned: 0,
    asOf: new Date(2026, 7, 12).toISOString(),
    weekStart: new Date(2026, 7, 10).toISOString(),
  };
  fresh(mdlW);
  C.renderBacklogHealth_();
  var htmlW = els.backlogPanel.innerHTML;
  assert_(/Dated, due this week or later/.test(htmlW),
          "the healthy dated row is labelled for the week rule, not 'not yet due'");
  assert_(/committed WEEK has ended|committed week has ended/.test(htmlW),
          "…and the overdue rows state that lateness is judged by week, not by timestamp");
  assert_(/still in compliance/.test(htmlW),
          "…naming the current week's dates as compliant, which is the feedback itself");
  assert_(C.BACKLOG_META_.futureDated.kind === "good" &&
          C.BACKLOG_META_.overdue7.kind === "bad",
          "the pair stays split good/bad — the rule changed the boundary, not the meaning");

  // ── 5. UNSTARTED + UNDATED IS NOT A MISSING DUE DATE (user report 2026-08-10) ─
  // It is reported as a third excluded population, in the same sentence idiom as
  // unassigned and unattributed — and it must NOT become a row in the queue, or
  // the panel sends people after exactly the tickets the rule just excluded.
  var mdlI = model({});
  mdlI.backlogHealth = {
    buckets: [{ person: "Ana Perez", n: 10, dated: 4, undated: 2, undatedIgnored: 4,
                keys: { undated: ["I-1", "I-2"] }, keysCapped: {} }],
    unattributed: 0, unassigned: 0, asOf: new Date(2026, 7, 12).toISOString(),
  };
  fresh(mdlI);
  C.renderBacklogHealth_();
  var htmlI = els.backlogPanel.innerHTML;
  assert_(/4 items are unstarted with no due date/.test(htmlI),
          "the ignored population is stated, with its own count — got: " + htmlI);
  assert_(/not counted as a missing due date/.test(htmlI),
          "…and says plainly that it is not counted as a gap");
  assert_(!C.BACKLOG_META_.undatedIgnored,
          "…and it has NO row metadata, so it can never render as a queue to work");
  assert_(C.BACKLOG_ORDER_.bad.indexOf("undatedIgnored") === -1,
          "…nor appear in the ⚠️ column's order");

  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// 🚩 EPICS WITHOUT A DUE DATE (team agreement 2026-08-10)
//
// An audit with a ratified 100% target, so the failures that matter here are the
// ones that make it look SATISFIED when it isn't: an absent field reading as
// clean, a zero-state that hides the check, a clipped key list read as complete,
// or the panel quietly inheriting the To Do carve the graded columns apply.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var mdl = model({});
  mdl.epicDueAudit = {
    n: 20, missing: 7, keyCap: 200,
    rows: [
      { type: "Epic", n: 12, missing: 5, keys: ["GTT-11", "GTT-12", "GTT-13", "GTT-14", "GTT-15"], capped: false },
      { type: "Kick-off epic", n: 5, missing: 2, keys: ["GTT-21", "GTT-22"], capped: false },
      { type: "Go-live epic", n: 3, missing: 0, keys: [], capped: false },
    ],
  };
  fresh(mdl);
  C.renderEpicDue_();
  var h = els.epicDuePanel.innerHTML;
  // Heading emoji were stripped in the redesign (2026-08-17) — the panel is
  // identified by its NAME now, which is what a reader actually reads.
  assert_(/<h3[^>]*>Epics without a due date/.test(h), "the epic-due panel renders on Actions");
  assert_(/>ORG</.test(h),
          "…tagged ORG — no person filter applies, so a reader must not take it as filtered");
  assert_(/7 of 20 open epics \(35%\) carry no due date/.test(h),
          "the headline states both numbers and the share — got: " + h);
  assert_(/even if it is only the project end date/.test(h),
          "…and quotes the agreement, so the 100% bar is not mistaken for an invented target");
  // The keys are a WORKED QUEUE, and at 230 of them a single wrapping run was
  // unreadable and stretched the table (user 2026-08-17). They now collapse to a
  // count and expand into a grid — still links, still all of them.
  assert_(/<details class="keyBox"><summary>View \d+ keys?<\/summary>/.test(h),
          "the key queue is collapsed behind its own count, not dumped into the row");
  assert_(/class="keyGrid"/.test(h), "…and expands into a column grid rather than one long run");
  assert_(/class="keyCell">(<a[^>]*>)?GTT-/.test(h),
          "every key is still a cell in that grid, and still a link when a Jira site is configured");
  assert_(/onclick="copyKeys_\(this\)"/.test(h) && /data-keys="[^"]*GTT-/.test(h),
          "…with Copy all keys, which is how the list actually leaves the page — into Slack " +
          "or a Jira bulk edit");
  // Sorted, so a PM hunting one key scans instead of reading, and two rebuilds
  // put the same key in the same place.
  var payload = (h.match(/data-keys="([^"]*)"/) || [])[1] || "";
  var got = payload.split(" ").filter(Boolean);
  var wanted = got.slice().sort(function (a, b) { return a.localeCompare(b); });
  assert_(got.length > 1 && got.join(" ") === wanted.join(" "),
          "the copied list is alphabetical — got: " + payload);
  assert_(/↗ Open all in Jira/.test(h),
          "…with one link that opens the whole row at once");
  var auditJql = decodeURIComponent((/href="[^"]*jql=([^"]+)"/.exec(h) || [])[1] || "");
  assert_(/^key in \(GTT-11,GTT-12/.test(auditJql),
          "…built from the keys themselves, not from an assignee or project guess — got: " + auditJql);
  assert_(!/Ana Perez|Ben Ortiz/.test(h),
          "no person is named anywhere: an audit list of people against failures is a blame board");
  assert_(/Kick-off epic/.test(h) && /5 of 12/.test(h) && /2 of 5/.test(h),
          "each epic type is its own row with its own denominator");
  assert_(!/Go-live epic/.test(h),
          "a type with nothing missing carries no row — the table is the queue, not a census");
  assert_(/not.{0,20}subject to the To&nbsp;Do carve/.test(h),
          "the panel states that it does NOT inherit the roster/matrix To Do exclusion");
  assert_(/Unassigned epics are included/.test(h),
          "…and that unassigned epics count, since an epic nobody owns still needs an end date");

  // PASS state: renders a green all-clear, never an empty panel. A check that
  // disappears when it succeeds is a check nobody trusts when it fires.
  var clean = model({});
  clean.epicDueAudit = { n: 9, missing: 0, keyCap: 200,
    rows: [{ type: "Epic", n: 9, missing: 0, keys: [], capped: false }] };
  fresh(clean);
  C.renderEpicDue_();
  var hc = els.epicDuePanel.innerHTML;
  assert_(/All 9 open epics carry a due date/.test(hc), "zero missing renders an explicit PASS");
  assert_(/sigGood/.test(hc) && !/sigBad/.test(hc), "…in the good colour, with no red anywhere");

  // ABSENT ≠ CLEAN. A pre-v33 payload has no audit at all, and saying "0 missing"
  // there would be a pass on an audit nobody ran.
  var old = model({});
  delete old.epicDueAudit;
  fresh(old);
  C.renderEpicDue_();
  var ho = els.epicDuePanel.innerHTML;
  assert_(/Not in this payload/.test(ho) && !/carry a due date/.test(ho),
          "a payload without the audit says so — it never reads as a clean result");

  // Empty export (no epics at all) is a third, different state.
  var none = model({});
  none.epicDueAudit = { n: 0, missing: 0, keyCap: 200, rows: [] };
  fresh(none);
  C.renderEpicDue_();
  assert_(/No open epics in the current export/.test(els.epicDuePanel.innerHTML),
          "no epics in the feed is its own state, distinct from both PASS and 'not measured'");

  // Clipped key list must SAY it is clipped, with the complete count still shown.
  var big = model({});
  big.epicDueAudit = { n: 300, missing: 250, keyCap: 200,
    rows: [{ type: "Epic", n: 300, missing: 250, keys: ["A-1", "A-2"], capped: true }] };
  fresh(big);
  C.renderEpicDue_();
  var hb = els.epicDuePanel.innerHTML;
  assert_(/first 200 shown; the count above is complete/.test(hb),
          "a capped key list reports the cap — a clipped list read as complete is how 'all fixed' goes wrong");
  assert_(/250 of 300/.test(hb), "…while the count itself stays complete");

  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// KPI SPARKLINE BASELINES (user report 2026-08-07: "some KPI mini line charts
// are out of place")
//
// A tile row is a CSS grid of equal-height cards whose content is top-aligned,
// and three different tile grammars (tileHtml_, flowTileHtml_,
// backlogTileHtml_) sit in the same grid printing 1–4 context lines each. Left
// alone, that puts the mini charts at three or four different heights and the
// row stops reading as a comparable set. The 2026-08-05 fix — trim the lines —
// cannot hold, because the line count is data-dependent (a card prints its
// operating-rate line only when the norm publishes).
//
// So the alignment is done in CSS, and the three things it depends on are
// pinned here: the marker class, the pin rule, and the chart being LAST in the
// card (margin-top:auto only reaches the bottom edge from the last position).
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var src = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
  assert_(/\.tile\{[^}]*display:flex[^}]*flex-direction:column/.test(src),
          "the tile is a flex column — margin-top:auto has no meaning in a block box");
  assert_(/\.tile>\.spark,\.tile>\.sparkWrap\{margin-top:auto/.test(src),
          "…and the spark (or its caption+spark wrapper) is pinned to the card's bottom edge");

  var spark = C.sparkHtml_([60, 65, 70], { labels: ["2026.W29", "2026.W30", "2026.W31"] });
  assert_(/^<svg class="chart spark"/.test(spark),
          "every mini chart carries the `spark` marker the CSS pins — got: " + spark.slice(0, 40));

  // The chart is the LAST thing in a card. Rendered from the real Executive
  // view rather than a hand-built tile, so this covers whichever grammars the
  // page actually uses.
  fresh(histModel({}));
  C.setState("view", "exec");
  C.renderAll_();
  // Each container is split SEPARATELY (redesign 2026-08-17). Concatenating
  // them first made the last tile of one container run into the next
  // container's heading, so the final tile in every container was graded on
  // its neighbour's markup rather than its own.
  var withSpark = 0;
  [document.getElementById("tier1Tiles").innerHTML,
   document.getElementById("flowSecondary").innerHTML,
   els.backlogBand.innerHTML].forEach(function (src2) {
    src2.split('<div class="tile').forEach(function (t) {
      if (t.indexOf('class="chart spark"') === -1) return;
      withSpark++;
      var after = t.slice(t.lastIndexOf("</svg>") + 6);
      // Only closing divs may follow the chart — any text line after it would
      // sit BELOW the pinned chart and break the baseline it establishes.
      assert_(/^(<\/div>)*$/.test(after.trim()),
              "the mini chart is the last content in its card — got trailing: " + after.slice(0, 80));
    });
  });
  assert_(withSpark >= 2,
          "the positive case: the Executive view really does render mini charts in tiles (" +
          withSpark + " found) — every check above would pass on a page with none");
})();

// ══════════════════════════════════════════════════════════════════════════
// A MINI CHART STAYS INSIDE ITS OWN FRAME (user report 2026-08-07, screenshot:
// polylines running the full height of the dashboard, and an item count
// labelled "691%")
//
// `.chart` is overflow:visible — deliberately, the kit's labels sit in the
// gutters — so a point computed outside the viewBox is not clipped, it is
// PAINTED over whatever else is on the page. That makes the y-domain a
// containment guarantee, not a cosmetic choice, and it is why these checks
// assert on coordinates rather than on "a chart rendered".
//
// The bug: flowTileHtml_ never passed unit/fmt/domain, so every flow metric —
// all of which are counts, days or hours — fell back to sparkHtml_'s
// percentage defaults. pctDomain_ clamps to 0–100, so a Cleared series around
// 210/wk drew ~4× the frame's height above it.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var H = 54, W = 240;   // sparkHtml_'s viewBox
  function coords(svg, attr) {
    return (svg.match(new RegExp(attr + '="(-?[\\d.]+)"', "g")) || [])
      .map(function (s) { return parseFloat(s.split('"')[1]); });
  }
  function assertInFrame_(svg, why) {
    var cys = coords(svg, "cy"), cxs = coords(svg, "cx");
    assert_(cys.length > 0, why + " — the positive case: points were actually drawn");
    assert_(cys.every(function (v) { return v >= 0 && v <= H; }),
            why + " — every point sits inside the 0–" + H + " frame, got: " + cys.join(","));
    assert_(cxs.every(function (v) { return v >= 0 && v <= W; }),
            why + " — …horizontally too, got: " + cxs.join(","));
    // The polyline is built from the same x/y as the circles, so an escaped
    // line always has an escaped point behind it — but assert the raw string
    // too, since that is what actually paints across the page.
    var poly = (svg.match(/points="([^"]+)"/) || [])[1] || "";
    poly.split(" ").filter(Boolean).forEach(function (pt) {
      var y = parseFloat(pt.split(",")[1]);
      assert_(y >= 0 && y <= H, why + " — and the LINE stays in frame, got y=" + y);
    });
  }

  // 1 · The reported case: a Cleared/Arrived-shaped count series on a flow tile.
  var counts = [180, 210, 240, 691, 205, 198];
  var flow = C.flowTileHtml_({ name: "Cleared", unit: "items", coverageGate: 0 }, 198, {
    trend: counts,
    trendLabels: ["2026.W26", "2026.W27", "2026.W28", "2026.W29", "2026.W30", "2026.W31"],
    context: "assigned, non-epic issues resolved this period",
  });
  assertInFrame_(flow, "a count series on a flow tile");
  assert_(!/>691%</.test(flow) && !/691%/.test(flow),
          "…and 691 items is never labelled '691%' — the endpoint label used the percentage default");
  assert_(/>198</.test(flow), "the endpoint label prints the value in its own unit");
  assert_(/2026\.W29 · 691</.test(flow),
          "…and so does every point's tooltip — got no bare-count tooltip");

  // 2 · Unit suffixes survive the fix — a days/hours metric must not print bare
  // integers now that the "%" default is gone.
  var days = C.flowTileHtml_({ name: "Lead Time", unit: "days", coverageGate: 0 },
                             12.4, { trend: [9.2, 11.8, 12.4], trendLabels: ["a", "b", "c"] });
  assertInFrame_(days, "a days series");
  assert_(/>12\.4d</.test(days), "a days metric labels its endpoint '12.4d', not '12' and not '12%'");
  var hrs = C.flowTileHtml_({ name: "Throughput", unit: "hrs", coverageGate: 0 },
                            310, { trend: [260, 290, 310], trendLabels: ["a", "b", "c"] });
  assert_(/>310h</.test(hrs), "…and an hours metric 'h'");

  // 3 · numDomain_ frames the data instead of clamping it to a rate's range.
  var d = C.numDomain_(counts);
  assert_(d.lo <= 180 && d.hi >= 691, "numDomain_ contains its own data — got " + d.lo + "–" + d.hi);
  var flat = C.numDomain_([40, 40, 40]);
  assert_(flat.hi > flat.lo, "…and a FLAT series still gets a non-zero span, got " + flat.lo + "–" + flat.hi);
  assert_(C.pctDomain_([180, 210]).hi === 100,
          "pctDomain_ still clamps to 0–100 — correct for a rate, and the reason it must not " +
          "be the fallback for a count");

  // 4 · The fail-safe: even handed a domain that cannot hold the data, the
  // chart widens its frame rather than drawing outside it. This is the guard
  // that makes any future unit mistake a squashed chart, not a defaced page.
  var forced = C.sparkHtml_([10, 5000, 20], { labels: ["a", "b", "c"], domain: { lo: 0, hi: 100 } });
  assertInFrame_(forced, "a series that overflows the domain it was handed");
  // Truthfulness check on the point that overflowed, not on the endpoint label
  // (which reports the LAST value, 20). Widening the frame keeps 5000 a 5000;
  // clamping the point would have drawn it at the old 100 ceiling.
  assert_(/b · 5000%/.test(forced),
          "…and the out-of-range value is still reported truthfully, not clamped to the old ceiling");

  // 5 · Percentage tiles are UNCHANGED — the fix must not have moved the 20+
  // rate sparklines onto a data-derived frame, where 60/65/70 would fill the
  // whole height and every ordinary week would look like a crisis.
  var pct = C.sparkHtml_([60, 65, 70], { labels: ["a", "b", "c"] });
  assertInFrame_(pct, "a percentage series");
  assert_(/>70%</.test(pct), "a rate still labels its endpoint with %");
})();

// ── 🧭 WORKFORCE HEALTH VIEW ─────────────────────────────────
// Six panels, and the §6.3 rules that are not negotiable: no blended number,
// null renders n/a rather than 0, every panel states its denominator, and the
// unclassified / unrouted counts appear even at zero.
(function () {
  // The grid describes the FILTERED population, so a pool with no people left
  // carries no row — correct behaviour, and the reason this suite needs a
  // support person of its own rather than reusing the two-consultant fixture.
  function wfModel() {
    var m = model({});
    m.people.push(person("Sara Support", {
      pool: "MS-SUPPORT", band: "CORE", backlogRole: "SUSTAINER",
      cell: "MS-SUPPORT|CORE", subTrack: "07.1",
      disciplineLabel: "Customer Support & Managed Services",
      jobTitle: "07.I3.1 - Support Engineer, Customer Support",
    }));
    return m;
  }
  fresh(wfModel());
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();

  var scope = els.wfScopePanel.innerHTML;
  var grid = els.wfGridPanel.innerHTML;
  var cons = els.wfConsumersPanel.innerHTML;
  var shadow = els.wfShadowPanel.innerHTML;
  var unrouted = els.wfUnroutedPanel.innerHTML;
  var alert = els.wfAlertPanel.innerHTML;

  // 1 · Scope banner leads, and reports zero counts rather than hiding them.
  assert_(/in scope/.test(scope), "the scope banner states the population");
  assert_(/consume project backlog/.test(scope), "…and the consumer count separately");
  assert_(/0<\/b> unclassified/.test(scope),
          "unclassified renders AT ZERO — a field that only appears when broken gets ignored when it breaks");
  assert_(/0<\/b> title mismatches/.test(scope), "…and so does the stem-warning count");
  assert_(/ARCH/.test(scope) && /not in this population/i.test(scope),
          "pools this population cannot contain are NAMED, so the pool list does not read as the whole company");

  // 2 · Pool grid — both pools present, never merged.
  assert_(/PS-CONSULT/.test(grid) && /MS-SUPPORT/.test(grid),
          "both pools appear in the grid");
  assert_(grid.indexOf("PS-CONSULT") < grid.indexOf("MS-SUPPORT"),
          "…consumers first — the reading order leadership should follow");
  assert_(/never drawn from the project backlog/.test(grid),
          "the demand-driven pool says why it has no backlog, rather than showing an empty one");
  // Pool codes are this model's vocabulary, not the company's — each group
  // header has to say what it means or the reader is decoding an abbreviation.
  assert_(/Consulting — draws on the project backlog/.test(grid),
          "every pool header explains what the pool IS");
  // Band labels carry their level range: "CORE" is a bucket this model invented
  // over the I1..I5+ ladder, and without the range two readers disagree on it.
  assert_(/CORE/.test(grid) && /I3–I4/.test(grid),
          "band labels carry the job-code level range they cover");
  // The single most dangerous false read on this surface.
  assert_(/DEMAND-DRIVEN/.test(grid), "a demand-driven pool gets its own action state");
  assert_(/n\/a/.test(grid), "…and renders n/a for cover, never 0");
  assert_(/wfChip/.test(grid), "every row carries a state chip");
  // Capacity truth is not measured here — it must not print as a confident 100%.
  assert_(!/capacityTruth/.test(grid), "no raw field names leak into the rendered grid");

  // ── WHO HAS THE HOURS (Billy, 2026-08-10) ─────────────────────────────────
  // "…so I can see exactly WHO has available hours, not just the total." The grid
  // answers how much; these assertions pin that it also answers whose, and that
  // the two levels stay honest about each other.
  assert_(/Click any band row to see who holds the hours/.test(grid),
          "the grid invites the drill-down rather than hiding it behind a bare caret");
  assert_(/toggleWfCell_\('PS-CONSULT\|/.test(grid),
          "each band row is the control, keyed by its own pool|band id");
  assert_(!/Ana Perez/.test(grid), "…and the closed grid names nobody — it is a management read");

  C.toggleWfCell_("PS-CONSULT|CORE");
  var opened = els.wfGridPanel.innerHTML;
  assert_(/▾/.test(opened), "an open cell's caret points down");
  assert_(/Ana Perez|Ben Ortiz/.test(opened), "the people in that cell are named");
  assert_(!/Sara Support/.test(opened),
          "…and ONLY that cell's people — a support engineer must not appear under a consulting band");
  assert_(/>Available</.test(opened) && /Sellable subtotal/.test(opened),
          "the drill-down states available hours per person and subtotals them");
  assert_(/left out of the sellable subtotal/.test(opened),
          "…saying that ramping and on-leave capacity is not room to sell, so the subtotal " +
          "can legitimately be smaller than the cell's headroom");
  assert_(/Same weeks as the row above/.test(opened),
          "…and that these rows are the same period read at person grain");

  // A person with no scheduled capacity in the window reads "—", never "0h
  // available": nobody is free for work in a week they are not scheduled to work.
  var noCap = wfModel();
  noCap.people.forEach(function (p) { if (p.name === "Ana Perez") p.weeks = {}; });
  fresh(noCap);
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.setState("wfOpenCell", { "PS-CONSULT|CORE": true });
  C.renderWfGrid_();
  var zeroCap = els.wfGridPanel.innerHTML;
  assert_(/Ana Perez/.test(zeroCap) && /—/.test(zeroCap),
          "an unscheduled person is listed with an em-dash, not as 0h available");

  C.setState("wfOpenCell", {});
  fresh(wfModel());
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();
  grid = els.wfGridPanel.innerHTML;
  assert_(/▸/.test(grid) && !/Ana Perez/.test(grid),
          "closing the cell puts the caret back and takes the names off the grid");

  // ── SIGNALS, NOT VERDICTS (user decision 2026-08-10) ───────────────────────
  // The whole panel was rewritten away from the source spec's alarm vocabulary
  // after an INTERVENE chip appeared on a business delivering week over week
  // with a healthy backlog. These pins exist because the regression is
  // invisible on review: a sentence that reads well and asserts a cause the
  // data cannot support looks exactly like a good one.
  var wfAll = scope + grid + cons + shadow + unrouted + alert;
  ["INTERVENE", "REASSESS", "HIRE / REALLOCATE", "KEY-PERSON"].forEach(function (word) {
    assert_(wfAll.indexOf(word) === -1,
            "the directive/alarm word '" + word + "' does not appear anywhere on this tab");
  });
  assert_(!/ahead of reality|find the blocker|not delivered|invisible to planning/i.test(wfAll),
          "no sentence asserts a CAUSE the data cannot support");
  assert_(/STEADY|HEADROOM|DEMAND-DRIVEN|AT CAPACITY|RECONCILE|REVIEW/.test(grid),
          "…and the states are descriptive instead");
  // Case-insensitive: the phrase is the rule, its capitalisation is not. It
  // reads as a sentence-case caption beside the colour key since 2026-08-17,
  // having previously been mid-paragraph.
  assert_(/signals, not verdicts/i.test(grid),
          "the grid says out loud that these are signals, so nobody reads a chip as a judgement");
  // No red anywhere on this surface. Red is the vocabulary of failure and it is
  // spent on the KPI cards, which have ratified targets to fail against.
  assert_(!/class="[^"]*\bvr\b/.test(wfAll) && !/ class='[^']*\bvr\b/.test(wfAll),
          "nothing on the Workforce tab is painted red");
  assert_(/worth a look/.test(grid), "…amber is labelled as 'worth a look', not as a failure");
  // Work outside the plan is delivered work with a paper-trail gap.
  assert_(/Delivered work|delivered work/.test(shadow) || /paper trail/.test(shadow),
          "hours outside the plan are framed as delivered work, not as missing work");
  // The cut-over explanation lives on the page, not in a meeting.
  assert_(/blended availability figure/.test(grid),
          "the grid explains why the numbers dropped, on screen");
  assert_(/govern backlog rather than consume it/.test(grid),
          "…including the manager change that moved every capacity rate");

  // 3 · The one honest number ships WITH its denominator.
  assert_(/of 2 backlog consumers/.test(cons),
          "the consumers-only figure states its denominator — '32% available' alone is a rumour");
  assert_(/no company-wide equivalent/.test(cons),
          "…and refuses a blended company number explicitly, rather than just omitting it");

  // 4 · Shadow split by reason, each with its owner — never one number.
  ["no-epic", "no-srso", "not-committed"].forEach(function (r) {
    assert_(shadow.indexOf(r) !== -1, "shadow breakdown names the " + r + " reason");
  });
  assert_(/Project Manager/.test(shadow) && /Finance/.test(shadow) && /Resource Manager/.test(shadow),
          "…and routes each to a different owner");
  // The "separate queues, not a pie" explanation was the paragraph the user
  // named for removal (2026-08-17). The RULE is unchanged and still stated —
  // in the methodology drawer — so it is asserted there, and asserted ABSENT
  // here, which is the whole point of moving it.
  assert_(!/not a pie/i.test(shadow), "the pie-chart paragraph is off the panel");
  // Matched on the fragment that no tag interrupts: the drawer renders
  // "Rows are <b>not</b> a pie of one problem".
  assert_(/a pie of one problem/.test(C.wfMethodHtml_()),
          "…and the rule it carried is stated in the methodology drawer instead");
  assert_(/upper bound/.test(shadow),
          "not-committed is caveated by plan-issue coverage rather than presented as exact");

  // 5 · Unrouted is its own bar and is never distributed.
  assert_(/UNROUTED/.test(unrouted), "unrouted backlog appears as its own row");
  assert_(/never distributed/.test(unrouted), "…and the panel says it is never spread across pools");
  assert_(/lower bound/.test(unrouted), "raw remaining is labelled a lower bound beside the adjusted figure");

  // 6 · THE TAB IS CLEANED UP (user 2026-08-17). Five changes, each asserted
  // on the thing a reader would notice rather than on the code that does it.

  // 6a · The headline figure is renamed and comes FIRST.
  assert_(/Sellable headroom/.test(cons), "the availability panel is titled 'Sellable headroom'");
  assert_(!/one honest number/i.test(wfAll),
          "…and no panel claims to be the only honest number on the dashboard");
  // NOT "Net Availability": nothing is netted out — there is no absence feed —
  // so a "net" label would claim more than the number can support.
  assert_(!/Net Availability/i.test(wfAll), "…and does not claim to be net of anything");
  var htmlSrc = fs.readFileSync(path.join(__dirname, "..", "..",
                  "delivery-health-dashboard", "Dashboard.html"), "utf8");
  var pane = htmlSrc.split('id="viewWorkforce"')[1].split("</div>\n  </div>")[0];
  assert_(pane.indexOf('id="wfConsumersPanel"') < pane.indexOf('id="wfGridPanel"'),
          "…and it sits ABOVE the pool grid, not halfway down the tab");

  // 6b · Unrouted work is an ALERT with a way to act, not a table row.
  assert_(/Action required/.test(alert), "unrouted backlog is raised to an action card");
  assert_(/Route \d+ epics? ↗/.test(alert), "…with a button that routes to the Jira queue");
  assert_(/browse|jql/i.test(alert), "…pointing at a real Jira URL");
  // It must vanish when there is nothing to route: a permanent "0 unrouted"
  // banner is how an alert becomes furniture nobody sees.
  var quiet = wfModel();
  quiet.workforce.coverage.unroutedEpics = 0;
  quiet.workforce.coverage.unroutedHrs = 0;
  fresh(quiet);
  C.getModel().viewerRole = "admin";
  C.renderAll_();
  assert_(els.wfAlertPanel.innerHTML === "", "…and renders nothing at all when nothing is unrouted");
  fresh(wfModel());
  C.getModel().viewerRole = "admin";
  C.renderAll_();

  // 6c · The walls of text are behind one control, not on the canvas.
  assert_(/toggleWfMethod_/.test(grid), "the grid offers a link into the methodology drawer");
  assert_(!/not a pie/i.test(wfAll), "the 'not a pie chart' paragraph is off the canvas");
  // The drill-down INVITATION stays (one line) — it is an affordance, and a
  // reader cannot discover the drill-down from a bare row. What left is the
  // four-sentence explanation of how to read a row.
  assert_(!/most notable measurement on that row/.test(wfAll),
          "…as is the how-to-read-a-row instruction");
  // …and it is genuinely still available, not deleted.
  var method = C.wfMethodHtml_();
  assert_(/a pie of one problem/.test(method), "…both now live in the drawer");
  assert_(/Click any band row/.test(method), "…including the drill-down instruction");
  assert_(/Gross, not deployable/.test(method),
          "…and the denominator caveat that qualifies the headline figure");
  // The colour key STAYS on the canvas: a legend one click away is a legend
  // nobody reads, and the cells cannot be decoded without it.
  assert_(/inside its own range/.test(grid), "the colour key stays beside the table it decodes");

  // 6d · The discipline mapping table is gone from the executive flow.
  assert_(!/By discipline/.test(wfAll), "the job-code-to-pool mapping table is off this tab");

  // 6e · The grid stays strictly tabular: no sentence rows between data rows.
  assert_(!/wfReadRow/.test(grid),
          "no full-width Read row breaks the column lines between data rows");
  // The state keeps a home — a COLUMN, which is scannable down the page in a
  // way a sentence row never was.
  assert_(/<th[^>]*>State<\/th>/.test(grid), "the action state gets its own column");
  assert_(/wfChip/.test(grid), "…and every row still carries its state chip");

  // The ⚠ itself is tested at unit level: the fixture's cells are all healthy,
  // so asserting on the rendered grid would pin "no flag" and pass for the
  // wrong reason. Each branch is driven explicitly instead.
  var flagCases = [
    ["fidelity", { commitmentFidelity: 0.4, shadowRatio: null, coverWeeks: null,
                   estimateCoverage: null, constraintIndex: null, head: 20 }],
    ["shadow", { commitmentFidelity: null, shadowRatio: 0.9, coverWeeks: null,
                 estimateCoverage: null, constraintIndex: null, head: 20 }],
    ["cover", { commitmentFidelity: null, shadowRatio: null, coverWeeks: 4,
                estimateCoverage: 0.2, constraintIndex: null, head: 20 }],
    ["constraint", { commitmentFidelity: null, shadowRatio: null, coverWeeks: null,
                     estimateCoverage: null, constraintIndex: 0.1, head: 20 }],
  ];
  flagCases.forEach(function (pair) {
    var col = pair[0], cell = pair[1];
    cell.shadowReasons = {}; cell.matchableCommittedHrs = 103; cell.trackedCommittedHrs = 40;
    assert_(C.wfReadTarget_(cell) === col,
            "a cell failing on " + col + " points its flag at the " + col + " column");
    cell.actionState = "RECONCILE"; cell.read = C.wfRead_(cell);
    var flag = C.wfFlagHtml_(cell, col);
    assert_(/class="wfFlag"/.test(flag), "…and renders a ⚠ there");
    assert_(flag.indexOf("RECONCILE") !== -1,
            "…whose tooltip still names the action state the old chip carried");
    assert_(C.wfFlagHtml_(cell, col === "shadow" ? "fidelity" : "shadow") === "",
            "…and no other column carries it, so one row never shows two flags");
  });
  // A healthy cell carries none at all.
  assert_(C.wfReadTarget_({ commitmentFidelity: 0.99, shadowRatio: 0.01, coverWeeks: 8,
                            estimateCoverage: 0.99, constraintIndex: 0.9, head: 20 }) === null,
          "a cell with nothing notable carries no flag");

  // ── A payload that predates the feature misses CLEANLY ─────────────────────
  // Never a silently blended grid: with no workforce block, every person would
  // otherwise fold into one cell and reproduce the exact number this retires.
  var stale = model({});
  delete stale.workforce;
  fresh(stale);
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();
  assert_(/Refresh to rebuild/.test(els.wfGridPanel.innerHTML),
          "a pre-v30 payload asks for a refresh instead of rendering a blended grid");
  assert_(!/PS-CONSULT/.test(els.wfGridPanel.innerHTML),
          "…and shows no pool numbers at all");

  // ── Role gate: the grid carries per-pool capacity, same tier as Actions ────
  var vm = model({});
  fresh(vm);
  C.getModel().viewerRole = "open";     // open-access guest — below margin tier
  C.switchView_("workforce");
  assert_(C.STATE.view !== "workforce",
          "an open-access guest asking for the Workforce tab by id lands elsewhere — " +
          "the gate is in the router, not just the tab bar");

  // ── Drift alarm fires on a moved population ───────────────────────────────
  var drifted = model({});
  drifted.workforce.scope.drift = { prev: 100, now: 80, pct: -0.2, alert: true };
  fresh(drifted);
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();
  assert_(/Population moved/.test(els.wfScopePanel.innerHTML),
          "a >5% population move raises the drift alarm on the banner");
  assert_(/measures membership, not performance/.test(els.wfScopePanel.innerHTML),
          "…and says why that invalidates the trend");

  // ── Unclassified people surface with their reasons ────────────────────────
  var unc = model({});
  unc.workforce.scope.unclassified = 2;
  unc.workforce.scope.unclassifiedReasons = [
    { jobTitle: "99.I3.1 - Widget Wrangler, Widgetry", reason: "no rule for 99.1 / 99|Widgetry" },
    { jobTitle: "Consultant", reason: "does not match FF.Tn.v pattern" },
  ];
  fresh(unc);
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();
  assert_(/2<\/b> unclassified/.test(els.wfScopePanel.innerHTML), "a non-zero unclassified count shows");
  assert_(/no rule for 99\.1/.test(els.wfScopePanel.innerHTML),
          "…with the stated reason, so the fix is one registry row away");
  assert_(/Workforce Planning has not been told/.test(els.wfScopePanel.innerHTML),
          "…and names it as a governance signal rather than a bug");
})();

// ── OVER-ALLOCATION, NEVER A NEGATIVE RATE (user 2026-08-17) ────────────────
// Planned hours past scheduled capacity drive (gross − committed)/gross below
// zero. Every surface publishing the rate translates that the same way: clamp
// to 0%, raise the red Over-allocated pill, state the overrun in hours. The
// drill grid's own cell rule is unit-tested beside gridCellHtml_'s other rules;
// this suite covers the two org-level surfaces.
(function () {
  var m = model({});
  Object.keys(m.workforce.weekly["PS-CONSULT|CORE"]).forEach(function (iso) {
    var w = m.workforce.weekly["PS-CONSULT|CORE"][iso];
    w.committedHrs = w.grossHrs + 40;      // booked 40h past capacity, weekly
  });
  // The per-person fold (the drill grid's pipeline) goes negative the same way.
  m.people.forEach(function (p) {
    Object.keys(p.weeks || {}).forEach(function (iso) {
      p.weeks[iso].planned = (p.weeks[iso].cap || 0) + 20;
    });
  });
  fresh(m);
  assert_(C.wfAvailability_().pct < 0,
          "fixture: the org fold is genuinely negative — the pill translates, never hides");

  // 1 · The Availability Rate card.
  var tile = C.availabilityTileHtml_();
  assert_(/pillOver/.test(tile) && /Over-allocated/.test(tile),
          "the Availability card raises the red pill instead of a negative rate");
  assert_(/\b0%/.test(tile), "…with the headline clamped to 0%");
  assert_(!/-\d+%/.test(tile), "…and no negative percentage anywhere on the card");
  assert_(/planned beyond/.test(tile),
          "…the overrun stated in hours — the unit a leader can actually reassign");

  // 2 · The Workforce tab's "one honest number" — same figure, same translation.
  C.getModel().viewerRole = "admin";
  C.setState("view", "workforce");
  C.renderAll_();
  var cons = els.wfConsumersPanel.innerHTML;
  assert_(/pillOver/.test(cons) && /Over-allocated/.test(cons),
          "the Workforce headline raises the same pill");
  assert_(/\b0%/.test(cons), "…clamped to 0% like the card — one figure, two surfaces");
  assert_(!/-\d+%/.test(cons), "…and never a minus sign on the rate");
  assert_(/planned beyond/.test(cons), "…with the overrun in hours here too");
})();

// ── Due-date urgency bands (spec 2026-08-11 §4) ─────────────────────────────
(function dueBandChecks() {
  // THE bug this guards: week keys are not zero-padded, so a lexicographic
  // compare ranks "2026.W9" after "2026.W10" and paints nine weeks of overdue
  // work green every January-to-March.
  assert_(C.isoCmp_("2026.W9", "2026.W10") === -1,
          "isoCmp_: W9 is BEFORE W10 — the assertion a string compare fails");
  assert_(C.isoCmp_("2026.W10", "2026.W9") === 1, "isoCmp_: and the reverse");
  assert_(C.isoCmp_("2026.W33", "2026.W33") === 0, "isoCmp_: equal weeks");
  assert_(C.isoCmp_("2025.W52", "2026.W1") === -1,
          "isoCmp_: year boundary — W52 of last year precedes W1 of this one");
  assert_(C.isoCmp_("2026.W1", "2025.W52") === 1, "isoCmp_: year boundary reversed");
  assert_(C.isoCmp_("", "2026.W1") === null, "isoCmp_: unparseable is null, not 0");
  assert_(C.isoCmp_("2026.W1", "not-a-week") === null, "isoCmp_: null both directions");

  // Swept across the whole year so a regression cannot hide in the months
  // nobody happens to test in.
  var swept = 0;
  for (var w = 1; w <= 53; w++) {
    for (var v = 1; v <= 53; v++) {
      var got = C.isoCmp_("2026.W" + w, "2026.W" + v);
      var want = w === v ? 0 : (w < v ? -1 : 1);
      if (got !== want) {
        throw new Error("❌ render-smoke: isoCmp_ W" + w + " vs W" + v +
                        " gave " + got + ", want " + want);
      }
      swept++;
    }
  }
  assert_(swept === 53 * 53, "isoCmp_: swept every W1–W53 pair (" + swept + ")");

  // ── The cell itself ───────────────────────────────────────────────────────
  // Three things this fixture has to get right, each of which silently produces
  // an empty panel rather than a failed assertion:
  //   1. gridWeeks must be {iso,status} objects with one marked "now" — that is
  //      what currentIso_ reads. The BASE model ships plain STRINGS, so a
  //      fixture built on model({}) alone grades nothing.
  //   2. personHygiene must exist, or renderRoster_ short-circuits to
  //      "Not in this payload".
  //   3. view/filters must be reset — the workforce block above leaves
  //      STATE.view = "workforce", and renderRoster_ never runs.
  var bandModel = fresh(model({}));
  resetFilters();
  C.setState("view", "actions");
  C.STATE.period = "week";
  C.setState("periodIdx", null);
  bandModel.personHygiene = { open: [], resolved: [] };
  bandModel.meta.gridWeeks = ["2026.W30", "2026.W31"].map(function (iso, i) {
    return { iso: iso, status: i === 1 ? "now" : "done" };
  });
  bandModel.people.forEach(function (p) {
    if (p.name !== "Ben Ortiz") return;
    p.backlog = { count: 3, remHrs: 12, listed: 3, ignoredN: 0, ignoredHrs: 0, items: [
      // W9 vs the W31 anchor: the single-digit-week trap, at the cell.
      { key: "GTT-1", summary: "Overdue one", status: "In Progress", priority: "High",
        remHrs: 4, due: "2026.W9" },
      { key: "GTT-2", summary: "Due this week", status: "In Progress", priority: "High",
        remHrs: 4, due: "2026.W31" },
      { key: "GTT-3", summary: "Future", status: "In Progress", priority: "Low",
        remHrs: 4, due: "2026.W40" },
      { key: "GTT-4", summary: "No date", status: "In Progress", priority: "Low",
        remHrs: 0, due: "" },
    ] };
  });
  C.setModel(bandModel);
  C.STATE.openDetail = {};
  C.toggleRosterDetail_("Ben Ortiz");
  var rowHtml = els.rosterPanel.innerHTML;

  assert_(/class="sigBad"[^>]*>2026\.W9</.test(rowHtml),
          "a due week before the current week paints red");
  assert_(!/class="sigGood"[^>]*>2026\.W9</.test(rowHtml),
          "W9 must NOT read as future — the single-digit-week trap, at the cell");
  assert_(/class="sigWarn"[^>]*>2026\.W31</.test(rowHtml),
          "a due week that IS the current week paints amber, not red");
  assert_(/class="sigGood"[^>]*>2026\.W40</.test(rowHtml),
          "a later due week paints green");
  assert_(/class="sigBad"[^>]*>—</.test(rowHtml),
          "undated STARTED work keeps the red it had before this change");
  C.toggleRosterDetail_("Ben Ortiz");   // close — teardown

  // ── The two meanings of "PM" must never both read as "PM" on one screen ────
  // The filter row sits ABOVE the tabs, so this control is visible while the
  // 🗓 PM tab is open. It selects PEOPLE who worked FOR a PM; the tab reports
  // the TICKETS a PM OWNS.
  var dashSrc = fs.readFileSync(path.join(__dirname, "..", "..", "delivery-health-dashboard", "Dashboard.html"), "utf8");
  assert_(/Worked with PM/.test(dashSrc),
          "the people-membership filter is labelled 'Worked with PM', not 'PM'");
  assert_(/STATE\.pm/.test(dashSrc),
          "…and only the LABEL moved — the state key and behaviour are unchanged");
  assert_(/id="pmSel"[^>]*title="Worked with PM/.test(dashSrc),
          "…including the tooltip, which is where the caveat lives");
})();

// ── 🗓 PM tab (spec 2026-08-11 §5) ──────────────────────────────────────────
(function pmTabChecks() {
  var pmModel = fresh(model({}));
  resetFilters();
  pmModel.meta.gridWeeks = ["2026.W30", "2026.W31"].map(function (iso, i) {
    return { iso: iso, status: i === 1 ? "now" : "done" };
  });
  pmModel.pmOwned = {
    keyCap: 200, supersededPms: 1,
    rows: [
      { pm: "Dana Reyes", epicN: 12, epicDated: 9,
        // Twelve missing keys, deliberately more than PM_KEYS_SHOWN_ — the live
        // feed had 134 and drew all of them across the page.
        epicMissingKeys: ["GTT-41", "GTT-88", "GTT-91", "GTT-92", "GTT-93", "GTT-94",
                          "GTT-95", "GTT-96", "GTT-97", "GTT-98", "GTT-99", "GTT-100"],
        epicCapped: false,
        readyDen: 40, readyN: 25, ignoredN: 7,
        viaAssignee: 10, viaProject: 2,
        oppNoDue: 3, oppEpicsAtRisk: 4, oppEpicsBreached: 1, oppNoChildren: 1, oppStale: 0,
        epics: [
          // Epic due THIS week (the fixture's "now") — its date has not passed,
          // so a child beyond it is AT RISK: still fixable.
          { key: "GTT-7", name: "Migration", status: "In Progress", started: true,
            due: "2026.W31", overdue: false, within: 1, atRisk: 1, breached: 0,
            noDate: 1, ignoredN: 2,
            assignee: "Dana Reyes", via: "assignee", childrenAll: 5,
            stale: false, staleDays: 2, owners: ["Ana Perez"],
            children: [
              { key: "GTT-72", summary: "Cutover", status: "In Progress",
                due: "2026.W34", verdict: "atRisk", overByWeeks: 3 },
              { key: "GTT-73", summary: "Docs", status: "In Progress",
                due: "", verdict: "nodate", overByWeeks: null },
              { key: "GTT-71", summary: "Schema", status: "In Progress",
                due: "2026.W30", verdict: "within", overByWeeks: null },
            ] },
          // Epic whose week has PASSED with work still beyond it — BREACHED.
          // Both states must render in one pass or the contrast is untested.
          { key: "GTT-8", name: "Legacy cutover", status: "In Progress", started: true,
            due: "2026.W28", overdue: true, within: 0, atRisk: 0, breached: 1,
            noDate: 0, ignoredN: 0,
            assignee: "Dana Reyes", via: "assignee", childrenAll: 1,
            stale: false, staleDays: 3, owners: ["Ben Ortiz"],
            children: [
              { key: "GTT-81", summary: "Backfill", status: "In Progress",
                due: "2026.W34", verdict: "breached", overByWeeks: 6 },
            ] },
          { key: "GTT-41", name: "Rollout", status: "In Progress", started: true,
            due: "", overdue: false, within: 0, atRisk: 0, breached: 0, noDate: 0, ignoredN: 0,
            assignee: "", via: "project", childrenAll: 0, stale: true, staleDays: 61,
            owners: [], children: [] },
        ] },
      { pm: "(No PM)", epicN: 4, epicDated: 0, epicMissingKeys: ["ORPH-1"],
        epicCapped: false, readyDen: 2, readyN: 1, ignoredN: 0,
        viaAssignee: 0, viaProject: 0,
        oppNoDue: 4, oppEpicsAtRisk: 0, oppEpicsBreached: 0,
        oppNoChildren: 0, oppStale: 0, epics: [] },
    ],
  };
  C.setModel(pmModel);
  C.getModel().viewerRole = "admin";
  C.setState("view", "pm");
  C.STATE.pmOpen = {}; C.STATE.pmEpicOpen = {};
  C.renderAll_();
  var h = els.pmPanel.innerHTML;

  // ── COLLAPSED BY DEFAULT ────────────────────────────────────────────────
  // The whole point of the rework: the page opens short and you drill in.
  assert_(/Dana Reyes/.test(h), "a PM row renders");
  assert_(/▸/.test(h), "…collapsed, with an affordance saying it opens");
  assert_(!/GTT-72/.test(h), "a collapsed PM shows NO child rows");
  assert_(!/Migration/.test(h), "…and not even its epic list");
  assert_(/9<\/b>\/12 epics dated/.test(h),
          "the collapsed group row still carries the number worth scanning");
  assert_(/In project 63% of 40 ready/.test(h),
          "…and the second bar beside it, still labelled and still not averaged with the first");

  // ── METHODOLOGY COLLAPSED (director feedback 2026-08-17) ────────────────
  // The 8-line attribution/windowing paragraph is off the open page: one
  // summary line, expandable. Every sentence stays in the DOM, which is also
  // what keeps the wording assertions further down honest.
  assert_(/<details class="pmMethod"><summary>/.test(h),
          "the methodology lives in a collapsed panel, not open-page prose");
  assert_(!/<details class="pmMethod" open/.test(h), "…closed by default");
  assert_(/How PM ownership is calculated/.test(h),
          "…labelled for the question it answers");

  // ── GAP PILLS, VISIBLE WITHOUT EXPANDING (director feedback 2026-08-17) ──
  // Horizontal colour-coded pills, not a vertical text log: a director scans
  // DOWN the PM list and sees who carries the most red without reading prose.
  assert_(/pmPill/.test(h), "the gap line renders as pills");
  assert_(/🚩 <b>3<\/b> no due date/.test(h),
          "undated epics show as a counted pill while still collapsed");
  assert_(/⚠ <b>4<\/b> at risk/.test(h),
          "…epics that cannot land as planned, counted PER EPIC not per ticket");
  assert_(/✖ <b>1<\/b> past due date/.test(h),
          "…and the already-missed ones counted apart from the fixable ones");
  assert_(!/<b>5<\/b>/.test(h.split("(No PM)")[0]),
          "the two states are never summed — 4 at risk and 1 breached are not '5'");
  assert_(/🔗 <b>1<\/b> unlinked/.test(h), "…and epics nothing rolls up to get a pill too");
  // Ranked by SIZE: 4 at risk outranks 3 undated. Anchored on the pill markup —
  // the collapsed methodology panel above the table also mentions due dates.
  assert_(h.indexOf("</b> at risk") < h.indexOf("</b> no due date"),
          "pills rank biggest-first, not in declaration order");
  assert_(!/untouched 30d/.test(h.split("(No PM)")[0]),
          "a gap with a zero count gets NO pill — noise on the healthy rows is " +
          "what teaches people to skip the line on the rows that matter");
  // Every pill ACTS. The no-due pill opens its keys in Jira — the payload names
  // them; the counts-only signals route to the PM's epic list instead, because
  // their counts cover the FULL epic set and a key link could not match them.
  assert_(/<a class="pmPill sigBad" href="[^"]*jql=/.test(h),
          "the no-due pill is a direct Jira exit");
  assert_(/pmPill sigWarn[^>]*pmPillOpen_/.test(h),
          "a counts-only pill opens the PM's epic list");

  // ── EXPAND THE PM ───────────────────────────────────────────────────────
  C.togglePmOpen_("Dana Reyes");
  h = els.pmPanel.innerHTML;
  assert_(/▾/.test(h), "expanding flips the affordance");
  assert_(/GTT-7/.test(h) && /Migration/.test(h), "the epic rows appear");
  assert_(!/GTT-72/.test(h), "…but their children stay collapsed until asked for");
  assert_(/1 at risk/.test(h) && /1 undated/.test(h) && /1 within/.test(h),
          "the 'Against epic date' cell pre-states each epic's child tally");
  assert_(/1 breached/.test(h), "…and the breached epic states its own");
  // Attribution moved off the page into the ⓘ beside Owns (director feedback
  // 2026-08-17): a director needs WHO owns the work; HOW the system worked it
  // out is a dispute detail, one hover away instead of a row of jargon.
  assert_(!/Attributed:/.test(h), "the attribution breakdown is no longer open-page text");
  assert_(/10 by Jira assignee/.test(h), "…but the split survives in the ⓘ tooltip");
  assert_(/2 by Tempo project lead/.test(h), "…and still names the inference count");

  // A pill click OPENS the row it points at and never closes it — idempotent.
  C.pmPillOpen_("Dana Reyes");
  assert_(C.STATE.pmOpen["Dana Reyes"] === true,
          "a counts-only pill click keeps the PM open — it never toggles the evidence away");
  // The Assignee column is the evidence each row is attributed on.
  // Wrapped in .pii since 2026-08-17 — an assignee is a person, so it blurs
  // with the roster names rather than staying legible beside them.
  assert_(/<td><span class="pii">Dana Reyes<\/span><\/td>/.test(h),
          "an epic names its Jira assignee in the Assignee column, blurrable");
  assert_(/via project<\/span>/.test(h),
          "…and an epic with no assignee says which rule placed it instead of showing blank");
  // Epic-level gaps sit in the Gaps column, where the reader can act on the
  // specific epic rather than hunting for which one the PM line meant.
  assert_(/nothing linked/.test(h), "an epic nothing rolls up to says so on its own row");
  assert_(/61d/.test(h), "…and a stale epic says how long it has been sitting");
  // Every column defined once, header and cells from the same registry.
  assert_(/<th[^>]*>Against epic date<\/th>/.test(h), "the table header is built from PM_COLS_");
  assert_(Object.keys(C.PM_COLS_).length === 6, "six defined columns");
  var headCells = (h.match(/<th\b/g) || []).length;
  assert_(headCells === 6,
          "exactly one header cell per column — a header without its cell shifts every " +
          "value one column left, which is the quiet kind of wrong that gets screenshotted");

  // ── LAYOUT: the widths are DECLARED, not inferred ───────────────────────
  // .tmx sizes columns from the first row, and this table's first row is a
  // full-width group header — so without an explicit colgroup every nowrap cell
  // overflowed onto its neighbour and Gaps painted on top of Due.
  var colTags = (h.match(/<col style="width:[^"]+">/g) || []);
  assert_(colTags.length === 6, "one <col> per column, got " + colTags.length);
  assert_(!/class="hyg tmx pmTable"/.test(h),
          "the PM table does NOT inherit .tmx — that style is a nowrap numeric matrix");

  // ── THE KEY LIST IS BOUNDED ─────────────────────────────────────────────
  // 12 undated keys, PM_KEYS_SHOWN_ of them drawn, the rest behind a count and
  // still all reachable through "Open all in Jira".
  assert_(/\+ 4 more/.test(h),
          "only PM_KEYS_SHOWN_ keys are drawn; the remainder is a count, not 134 links");
  // Anchor on the LINK TEXT, not the raw key: every key still appears inside the
  // "Open all in Jira" JQL href, which is the point of that affordance.
  assert_(/>GTT-41<\/a>/.test(h), "the first keys are drawn as links");
  assert_(!/>GTT-100<\/a>/.test(h),
          "…and the overflow is not painted, though it stays inside the Open-all query");
  assert_(/Open all in Jira/.test(h),
          "…and every key is still reachable in one click — bounded drawing, not lost data");

  // A PM with no gaps at all says so — silence would read as "not measured".
  var clean = { pm: "Clean PM", epicN: 3, epicDated: 3, epicMissingKeys: [], epicCapped: false,
                readyDen: 5, readyN: 5, ignoredN: 0, viaAssignee: 3, viaProject: 0,
                oppNoDue: 0, oppChildOver: 0, oppNoChildren: 0, oppStale: 0, epics: [] };
  assert_(/No open gaps/.test(C.pmOppHtml_(clean)),
          "a PM with nothing to fix says so explicitly, rather than rendering nothing");

  // The two bars must never be averaged. 75% and 62.5% blend to ~69%; if that
  // number appears, someone combined the PM's field with the team's hygiene.
  assert_(!/69%/.test(h), "the two bars are NEVER averaged into one number");
  assert_(/75%/.test(h) && /62%|63%/.test(h), "…both are shown, separately");
  assert_(/hygiene|context|not this PM's grade/i.test(h),
          "bar 2 is labelled as team context, not the PM's grade");
  assert_(/GTT-41/.test(h), "the undated epic keys are named — the fix is one click away");
  // An epic with no due date says so in its OWN Due cell, not only in the 🚩 key
  // list on the group row above — that is what lets a reader act on the epic.
  assert_(/sigBad[^>]*>&#128681; none<\/span>/.test(h),
          "an undated epic is flagged in its Due cell — nothing under it can be graded");

  // ── EXPAND AN EPIC ──────────────────────────────────────────────────────
  C.togglePmEpic_("GTT-7");
  C.togglePmEpic_("GTT-8");   // the breached epic — both states in one render
  h = els.pmPanel.innerHTML;
  assert_(/GTT-72/.test(h), "expanding an epic reveals its children");
  // ── AT RISK vs BREACHED: same geometry, different conversation ──────────
  // The whole point of the split: a future, fixable inconsistency must NOT wear
  // the same red as a date that has already gone, or the red stops being read.
  assert_(/sigWarn[^>]*>⚠ 3w past epic/.test(h),
          "a child past an epic whose date is still ahead reads AMBER — still fixable");
  assert_(/sigBad[^>]*>✖ 6w past · epic overdue/.test(h),
          "…and one past an epic whose date has gone reads RED");
  assert_(!/sigBad[^>]*>⚠ 3w past epic/.test(h),
          "the at-risk child is NOT painted with the breach class — different classes, " +
          "not merely different words");
  // The epic-level verdict is the sentence a PM acts on.
  assert_(/⚠ cannot land as planned/.test(h),
          "the at-risk epic says what IT cannot do, not just what its children are");
  assert_(/✖ past its date, work still beyond/.test(h),
          "…and the breached epic says its date has already gone");
  assert_(/no date of its own/.test(h),
          "a started child with no date is called out, never counted as 'within'");
  assert_(/within/.test(h), "…and the healthy ones are named too");
  // Worst-first: the over-deadline child leads.
  assert_(h.indexOf("GTT-72") < h.indexOf("GTT-71"),
          "children sort worst-first — over the epic date leads");

  // ── THE NOISE THE USER REPORTED IS COUNTED, NOT SILENTLY DROPPED ────────
  assert_(/7<\/b> To Do ticket/.test(h),
          "unstarted undated tickets are COUNTED at the top — a silent drop and a " +
          "considered exclusion look identical otherwise");
  assert_(/not a commitment yet/i.test(h), "…with the managers' rule named as the reason");
  assert_(/2 To Do undated/.test(h),
          "…and again in the epic's Gaps cell, where the reader is actually working");

  // (No PM) is a named coverage gap and sorts last.
  assert_(/\(No PM\)/.test(h), "(No PM) renders as a named bucket, not an empty state");
  // Anchor on the ROW HEADINGS, not a bare substring: "(No PM)" is also named in
  // the intro paragraph above the rows, so indexOf would compare against the
  // explanation rather than the row and pass whatever the sort did.
  var heads = (h.match(/<div class="pmHead"[\s\S]*?<\/div>/g) || []);
  assert_(heads.length === 2, "one group row per PM, got " + heads.length);
  assert_(/\(No PM\)/.test(heads[heads.length - 1]),
          "(No PM) sorts LAST among the rows — a hygiene bucket, not a PM");

  // Bands apply here too, but undated is GREY — this list contains unstarted
  // work, unlike the People drill-down. The exact inversion of dueCellHtml_.
  assert_(/class="sigWarn"[^>]*>2026\.W31</.test(h), "the current week paints amber");
  assert_(/class="sigGood"[^>]*>2026\.W34</.test(h), "a later week paints green");
  assert_(!/class="sigBad"[^>]*>—</.test(h),
          "undated on the PM tab is NOT red — unstarted work is not a broken commitment");

  // A handover that resolved silently is indistinguishable from a data error.
  assert_(/changed PM/i.test(h),
          "a superseded PM handover is reported, not swallowed");

  // The scope rule is NAMED, and the bars say they are not subject to it.
  assert_(/in progress or due this month/i.test(h), "the epic scope rule is named on the page");
  assert_(/not windowed/i.test(h), "…and the bars say they are not subject to it");

  // ── EVERY KEY IS A JIRA LINK ────────────────────────────────────────────
  assert_(/<a href="[^"]*\/browse\/GTT-7"/.test(h), "the epic key links to Jira");
  assert_(/<a href="[^"]*\/browse\/GTT-72"/.test(h), "…and so does every child key");
  // Both rows are collapse toggles. Without stopPropagation, opening a ticket
  // also toggles the row behind it and the panel rearranges while you are away.
  assert_(/\/browse\/GTT-7"[^>]*onclick="event\.stopPropagation\(\)"/.test(h),
          "the epic link stops the click reaching the collapse handler underneath");
  assert_(/\/browse\/GTT-72"[^>]*onclick="event\.stopPropagation\(\)"/.test(h),
          "…and so does the child link");
  assert_(/Open these 3 in Jira/.test(h),
          "an epic's children can be opened as one Jira list, like the People drill-down");

  // No site configured → plain text, never an anchor to a dead "/browse/KEY".
  var noBase = pmModel.meta.jiraBase;
  pmModel.meta.jiraBase = "";
  C.setModel(pmModel);
  C.renderPm_();
  var hNo = els.pmPanel.innerHTML;
  assert_(!/<a href=/.test(hNo), "with no Jira site configured, keys render as plain text");
  assert_(/GTT-72/.test(hNo), "…but the keys themselves are still shown");
  pmModel.meta.jiraBase = noBase;
  C.setModel(pmModel);
  C.renderPm_();
  h = els.pmPanel.innerHTML;

  // ── THE UNIVERSAL FILTERS REACH THIS TAB ────────────────────────────────
  // Filters speak PERSON; this tab's unit is an EPIC whose owner is not on the
  // roster. An epic is scoped by the people DOING it (epics[].owners).
  assert_(C.pmFiltersActive_() === false, "no filter set → the tab is org scope");
  assert_(/ORG/.test(h), "…and says so with the ORG tag");

  C.setState("search", "ana");          // matches Ana Perez, who works on GTT-7
  assert_(C.pmFiltersActive_() === true, "a search counts as an active filter");
  C.renderPm_();
  var hF = els.pmPanel.innerHTML;
  assert_(/GTT-7\b/.test(hF), "an epic whose worker is in the slice stays");
  assert_(!/GTT-81/.test(hF),
          "…and one worked only by someone outside it goes");
  assert_(/hidden by the current filter/.test(hF),
          "what the filter hid is STATED — a filter that hides work silently is " +
          "indistinguishable from a feed that never had it");
  assert_(/no roster-assigned child at all/.test(hF),
          "…and the unattributable epics are named apart: no filter can ever select them, " +
          "and they are exactly the unowned work this tab exists to surface");
  assert_(/Clear filters/.test(hF), "…with the way back offered inline");
  assert_(!/ORG/.test(hF), "a filtered tab must not still claim ORG scope");

  // The predicate itself, directly.
  assert_(C.pmEpicPasses_({ owners: ["Ana Perez"] }) === true, "an owner in the slice passes");
  assert_(C.pmEpicPasses_({ owners: [] }) === false,
          "an epic with no roster owner is unattributable — never silently passing");
  assert_(C.pmEpicPasses_({ owners: ["Nobody Here"] }) === false,
          "an owner who is not on the roster does not pass");

  C.resetFilters_();
  assert_(C.pmFiltersActive_() === false, "resetFilters_ clears them — one reset, not two copies");

  // An apostrophe in a PM name must not break the inline onclick.
  assert_(C.jsArg_("Sam O'Neil") === "'Sam O\\'Neil'",
          "jsArg_ escapes quotes — an apostrophe would otherwise kill the click handler");

  // Absent ≠ clean, the same rule renderEpicDue_ follows.
  var noPm = fresh(model({}));
  noPm.pmOwned = null;
  C.setModel(noPm);
  C.getModel().viewerRole = "admin";
  C.setState("view", "pm");
  C.renderAll_();
  assert_(/Refresh|Not in this payload/i.test(els.pmPanel.innerHTML),
          "a payload built before this tab existed says so — absent is not a pass");

  // Role gate is enforced INSIDE switchView_, not just by hiding the button.
  C.getModel().viewerRole = "denied";
  C.switchView_("pm");
  assert_(C.STATE.view !== "pm", "a role without access cannot reach the PM view by id");
})();

// ══════════════════════════════════════════════════════════════════════════
// EXECUTIVE UI/UX REDESIGN (2026-08-17)
//
// Sidebar navigation, emoji-free chrome, and the three-tier Executive
// hierarchy. Every rule here is a LAYOUT rule, which is exactly the class of
// rule that ships broken: it lives in string concatenation and container ids,
// where nothing else in the suite is looking.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var src = fs.readFileSync(path.join(__dirname, "..", "..",
                                      "delivery-health-dashboard", "Dashboard.html"), "utf8");

  // ── 1. THE RAIL ─────────────────────────────────────────────────────────
  // #tabBar moved INTO the sidebar. It is still the one place tabs are built
  // from VIEWS, so this is a relocation, not a second navigation control.
  var navIdx = src.indexOf('class="sidenav"');
  var barIdx = src.indexOf('id="tabBar"');
  var navEnd = src.indexOf("</nav>");
  assert_(navIdx !== -1, "the left sidebar exists in the markup");
  assert_(barIdx > navIdx && barIdx < navEnd, "…and #tabBar lives inside it, not above the panes");
  assert_(src.indexOf('id="tabBar"', barIdx + 1) === -1,
          "…exactly once — navigation is not duplicated between a rail and a strip");
  assert_(barIdx < src.indexOf('id="app"'),
          "the rail precedes the app content, so tab order reaches navigation first");
  // The rail is dark in BOTH themes: its tokens are defined once on :root and
  // never redefined in the dark block. A rail that inverted with the page
  // would read as another panel in light mode — the problem it replaced.
  var darkBlock = src.slice(src.indexOf('[data-theme="dark"]'),
                            src.indexOf('[data-theme="dark"]') + 2000);
  assert_(/--nav-bg:/.test(src), "the rail has its own colour tokens");
  assert_(!/--nav-bg:/.test(darkBlock),
          "…and they are NOT redefined for dark — the rail is chrome, dark in both themes");
  // Body padding is driven by the SAME token as the rail's width, so a
  // collapse can never leave the content overlapping or floating.
  assert_(/body\{[^}]*padding-left:calc\(var\(--navw\)/.test(src.replace(/\n\s*/g, "")),
          "the page's left padding is derived from --navw, not a second hardcoded width");
  assert_(/body\.navCollapsed\{--navw:/.test(src),
          "collapsing retunes that one token rather than restyling each element");

  // ── 2. NO EMOJI IN THE CHROME ───────────────────────────────────────────
  // Tab labels and section headings only. Inline data glyphs (ramping, on
  // leave, intern, the RAG marks) are load-bearing and deliberately untouched
  // — status is never colour alone (FR-4.4), and stripping them would take
  // information out of a monochrome board pack.
  var EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  C.VIEWS.forEach(function (v) {
    assert_(!EMOJI.test(v.label), "the '" + v.label + "' tab label carries no emoji");
    assert_(v.dot && !EMOJI.test(v.dot),
            "…and its rail mark is a geometric glyph, not an emoji — got: " + v.dot);
  });
  // Matches headings WITH attributes too (`<h4 style="…">`). The first pass of
  // this check only matched bare tags and let three attributed headings keep
  // their emoji — the exact blind spot a "strip the emoji" edit produces, since
  // a grep written from the same assumption misses the same lines.
  var heads = src.match(/<h[1-4][^>]*>[^<]{0,80}|<summary[^>]*>[^<]{0,80}/g) || [];
  heads.forEach(function (h) {
    assert_(!EMOJI.test(h), "no section heading carries an emoji — got: " + h);
  });
  assert_(heads.length > 20, "…and there were real headings to check (" + heads.length + ")");

  // Tabs render the label as its accessible name, with the mark hidden from
  // assistive tech — otherwise a screen reader announces the decoration.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.buildTabs_();
  var firstTab = els.tabBar.children[0];
  assert_(/aria-hidden="true"/.test(firstTab.innerHTML), "the rail mark is aria-hidden");
  assert_(/class="tabLbl">Executive</.test(firstTab.innerHTML),
          "…and the label is the tab's readable text");
  assert_(firstTab.getAttribute("aria-selected") === "true",
          "the active tab reports its selected state");

  // ── 3. COLLAPSE ─────────────────────────────────────────────────────────
  C.setNavCollapsed_(false);
  assert_(document.body.classList.contains("navCollapsed") === false, "the rail starts expanded");
  C.toggleNav_();
  assert_(document.body.classList.contains("navCollapsed") === true, "…toggles to collapsed");
  C.toggleNav_();
  assert_(document.body.classList.contains("navCollapsed") === false, "…and back again");

  // ── 4. TIER 1 IS EXACTLY THE OUTCOME KPIs, IN ORDER ─────────────────────
  // The whole redesign is this list and this sequence. Both are pinned: a card
  // that drifts in, out, or up the order has changed what the org is run on.
  //
  // Narrowed 2026-08-17 (user instruction): Throughput, Bug Count, Inventory,
  // Net flow and Weeks to clear were demoted to the secondary strip, which
  // sits below the backlog band. Tier 1 is now the delivery-OUTCOME cards
  // only — did we meet what we promised. Volume, defect arrivals and standing
  // queue position size that answer; they no longer compete with it.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  var t1 = document.getElementById("tier1Tiles").innerHTML;
  // Availability Rate sits between Forecast and Quality by instruction
  // (2026-08-17): On-Time and Forecast say whether we met our commitments,
  // Availability says what capacity is left to meet the next one.
  var WANT = ["On-Time Delivery", "Forecast Accuracy", "Availability Rate", "Quality / Rework"];
  var seenAt = WANT.map(function (lbl) { return t1.indexOf('<div class="lbl">' + lbl); });
  WANT.forEach(function (lbl, i) {
    assert_(seenAt[i] !== -1, "Tier 1 carries the '" + lbl + "' card");
  });
  for (var i = 1; i < seenAt.length; i++) {
    assert_(seenAt[i - 1] < seenAt[i],
            "Tier 1 order: '" + WANT[i - 1] + "' precedes '" + WANT[i] + "'");
  }
  assert_((t1.match(/<div class="tile/g) || []).length === WANT.length,
          "Tier 1 holds exactly " + WANT.length + " cards — no extras crept into the top row");
  assert_(/class="tiles tier1"/.test(src),
          "…and the grid is marked tier1, which is what makes those cards the largest on the page");

  // The demoted reads live in the Backlog & Flow strip, CLUSTERED by the
  // question each answers (2026-08-17). Membership in the right cluster is the
  // assertion now, not a flat left-to-right order: eight cards in one row read
  // as a wall, and which group a card belongs to is the thing a later edit
  // could get wrong.
  var t2 = document.getElementById("flowSecondary").innerHTML;
  var CLUSTERS = [
    { head: "Flow", want: ["Throughput", "Cleared", "Arrived", "Lead Time", "Net flow"] },
    { head: "Runway", want: ["Inventory", "Assigned inventory",
                             "Weeks to clear", "Assigned weeks to clear"] },
    { head: "Quality", want: ["Bug Count"] },
  ];
  // Slice the strip into its clusters, in DOM order, so a card can be checked
  // against the heading it actually sits under rather than merely co-occurring
  // with it somewhere in the same string.
  var segs = t2.split('<div class="cluster">').slice(1);
  assert_(segs.length === CLUSTERS.length,
          "the flow strip renders exactly " + CLUSTERS.length + " clusters — got " + segs.length);
  CLUSTERS.forEach(function (c, ci) {
    var seg = segs[ci];
    assert_(seg.indexOf('clusterHead">' + c.head) !== -1,
            "cluster " + (ci + 1) + " is headed '" + c.head + "'");
    c.want.forEach(function (lbl) {
      assert_(seg.indexOf('<div class="lbl">' + lbl) !== -1,
              "'" + lbl + "' sits under the '" + c.head + "' heading");
      assert_(t1.indexOf('<div class="lbl">' + lbl) === -1,
              "…and never in Tier 1 — got '" + lbl + "' in the protagonist row");
    });
  });
  // Assigned beside its ORG twin (director feedback 2026-08-17): the pair
  // used to float between the backlog bar and this strip, in no family at all.
  var runwaySeg = segs[1];
  assert_(runwaySeg.indexOf('lbl">Inventory') < runwaySeg.indexOf('lbl">Assigned inventory') &&
          runwaySeg.indexOf('lbl">Weeks to clear') < runwaySeg.indexOf('lbl">Assigned weeks to clear'),
          "each Assigned card sits directly beside its ORG twin in the Runway cluster");
  // Every card is accounted for: no tile is silently dropped by the grouping.
  assert_((t2.match(/<div class="lbl">/g) || []).length ===
          CLUSTERS.reduce(function (a, c) { return a + c.want.length; }, 0),
          "every demoted card lands in exactly one cluster — none lost in the regrouping");
  // Position, not just membership: the queue cards only read correctly under
  // the band whose prose defines them, so #flowSecondary must follow
  // #backlogBand in the DOM (pinned again by the section-order check below).
  assert_(src.indexOf('id="backlogBand"') < src.indexOf('id="flowSecondary"'),
          "the secondary strip sits BELOW the backlog band — the queue cards land under its prose");

  // ── 5. WHAT LEFT THE EXECUTIVE TAB ──────────────────────────────────────
  var execAll = els.masthead.innerHTML + t1 + t2 + els.backlogBand.innerHTML +
                els.pulsePanel.innerHTML + els.comparePanel.innerHTML;
  assert_(execAll.indexOf("Workforce change") === -1,
          "the Workforce-change card is gone from the Executive tab");
  assert_(execAll.indexOf("Not measured this week") === -1,
          "'Not measured this week' is gone from the Executive tab");
  assert_(execAll.indexOf("Can we publish these numbers?") === -1,
          "the data-quality strip no longer renders on the Executive tab");
  // …and it renders on Actions instead. Moved, not lost — the gates still
  // have to be readable by whoever works the queue.
  C.setState("view", "actions");
  C.renderAll_();
  assert_(/Can we publish these numbers\?/.test(els.trustPanel.innerHTML),
          "…it renders on the Actions tab instead — moved, not dropped");
  C.setState("view", "exec");
  C.renderAll_();

  // ── 6. THE BREAKDOWN PANEL SHIPS ON ─────────────────────────────────────
  // Rewritten 2026-08-17. This block used to drive SHOW_COMPARE_PANEL_ through
  // a setComparePanel_ bridge and assert the shipped default was OFF. Both are
  // gone: the flag was removed when the panel was restored, because hiding it
  // was never the intent — the panel charts whichever metric is selected and
  // DEFAULTS to On-Time Delivery, so switching it off to suppress a financial
  // metric took the org's only breakdown of on-time performance with it. The
  // financial lens is now withheld at liveMetrics_ (SHOW_UTILIZATION_) instead,
  // which removes the metric without removing the breakdown.
  //
  // The stale checks were calling a function that no longer exists, which
  // crashed the suite before every block after this one could run.
  C.renderAll_();
  assert_(/by Region/.test(els.comparePanel.innerHTML),
          "the breakdown panel renders by default — no flag stands between a reader and it");
  assert_(els.comparePanel.style.display === "", "…and is visible");
  // Scoped to the DECLARATION. The flag is still named in two comments that
  // record why it was retired — that history is worth keeping, and banning the
  // string would delete the explanation along with the code.
  assert_(!/var SHOW_COMPARE_PANEL_/.test(src),
          "…and the retired flag is gone from the source, not merely defaulted to true");

  // ── 7. TIER 3 IS SUPER-ADMIN ONLY ───────────────────────────────────────
  // Removed from the DOM, never dimmed — a collapsed <details> a reader can
  // still expand is not a gate.
  C.getModel().viewerRole = "admin";
  C.getModel().viewerSuper = false;
  C.renderAll_();
  assert_(els.trustDetail.innerHTML === "",
          "a plain admin gets NO trust-detail markup — removed, not merely collapsed");
  assert_(els.trustDetail.style.display === "none", "…and the panel is hidden");
  C.getModel().viewerSuper = true;
  C.renderAll_();
  assert_(/Data trust detail/.test(els.trustDetail.innerHTML), "a super-admin sees it");
  // An older payload has no such field. Undefined must resolve to "no".
  delete C.getModel().viewerSuper;
  assert_(C.canSeeSuper_() === false,
          "a payload predating the field is not a super-admin — undefined is not a pass");
  C.getModel().viewerSuper = true;

  // ── 8. THE SMART LEGEND DEFINES EVERY SEGMENT IT DRAWS ──────────────────
  // A swatch strip says the segments differ; the legend has to say what puts
  // an item in each, which is the question actually asked in the room.
  var leg = C.smartLegendHtml_();
  // AGILE NOMENCLATURE (2026-08-17): the segments are named for the STATE the
  // work is in, not for what it lacks. "Unowned" was factually right and read
  // as neglect on the biggest segment, when pipeline created ahead of
  // allocation is what a healthy runway looks like.
  ["Active", "Planned", "Runway"].forEach(function (seg) {
    assert_(leg.indexOf("<b>" + seg + "</b>") !== -1, "the legend names the '" + seg + "' segment");
  });
  assert_(!/<b>Unowned<\/b>/.test(leg), "…and no longer labels a segment 'Unowned'");
  // THE CRITERIA SURVIVE THE RENAME. Renaming without saying what puts work in
  // each bucket would be the dishonest version of this change — the reader
  // would lose the ability to challenge the split.
  assert_(/assignee AND a Jira status in the In Progress category/.test(leg),
          "…and Active still states its actual criterion, not just its colour");
  assert_(/still To Do/.test(leg), "…Planned's criterion");
  assert_(/no assignee/.test(leg), "…and Runway's");
  assert_(/future sprints/i.test(leg), "…with Runway named as future sprints, not as a deficit");
  assert_((leg.match(/legSwatch/g) || []).length === 3, "one swatch per segment, no more");
  assert_(els.backlogBand.innerHTML.indexOf("legSwatch") !== -1,
          "the legend renders in the band, under the bar it explains");

  // ── 9. THE UNOWNED NOTE IS A DATA-GATED TOOLTIP (director pass 2026-08-17) ──
  // The beige block is gone; the same sentence rides the ⓘ beside the Groomed
  // pipeline callout — the figure it explains. Still data-gated: reassurance
  // printed against a queue with no unowned work is a caption with no subject.
  var mUn = model({});
  mUn.queue = { assigned: { items: 100, wipN: 60, todoN: 40, todoHrs: 0, unattributed: 0, uncategorized: 0 },
                unassigned: { items: 500, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 } };
  fresh(mUn);
  C.renderMasthead_();
  var mastUn = els.masthead.innerHTML;
  assert_(!/Note on unassigned work/.test(mastUn) && !/ctxNote/.test(mastUn),
          "the beige note block never renders — it left the page with the verdict paragraph");
  var groomedSeg = mastUn.split("Groomed pipeline")[1] || "";
  assert_(/planned pipeline for upcoming sprints/.test(groomedSeg),
          "…the sentence survives as the ⓘ tooltip on the Groomed pipeline callout");
  assert_(/500 items/.test(groomedSeg),
          "…against the measured count, not a hardcoded figure");
  mUn.queue.unassigned.items = 0;
  C.setModel(mUn);
  C.renderMasthead_();
  assert_(!/planned pipeline for upcoming sprints/.test(els.masthead.innerHTML),
          "a queue with nothing unowned gets no note — the sentence leaves with its subject");
  mUn.queue.unassigned.items = null;
  C.setModel(mUn);
  C.renderMasthead_();
  assert_(!/planned pipeline for upcoming sprints/.test(els.masthead.innerHTML),
          "…and an UNMEASURED unowned count is not a reason to reassure anybody either");

  // Teardown.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// PROGRESSIVE DISCLOSURE — BUT A HIDDEN FILTER IS NEVER A SILENT ONE
// (review item #1, 2026-08-17)
//
// Moving five of nine filters into a drawer is only an improvement if the
// drawer cannot conceal an APPLIED filter. A dashboard whose numbers are scoped
// by a control the reader cannot see is worse than a crowded bar: the reader
// has no way to know why the figures disagree with the ones next to them.
//
// So the interesting checks here are not "does it collapse" — they are the ones
// that prove it REFUSES to collapse while a filter inside it is set, and that
// the badge names what is applied.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  var btn = document.getElementById("btnAdvFilters");
  var box = document.getElementById("advFilters");

  // ── 1. THE MARKUP: three dimensions in the bar, five in the drawer ───────
  // Checked on the raw markup, not the rendered state — which row a control is
  // DECLARED in is the whole change; a control that merely happens to be
  // hidden at runtime is a different (and reversible) thing.
  var bar = html.split('id="advFilters"')[0];
  var drawer = html.split('id="advFilters"')[1].split("</div>\n</div>")[0];
  ["periodChips", "regionChips", "teamSel", "personSearch"].forEach(function (id) {
    assert_(bar.indexOf('id="' + id + '"') !== -1, "'" + id + "' stays in the always-visible bar");
  });
  ["popChips", "roleChips", "pmSel", "famSel"].forEach(function (id) {
    assert_(drawer.indexOf('id="' + id + '"') !== -1, "'" + id + "' moved into the drawer");
    assert_(bar.indexOf('id="' + id + '"') === -1, "…and is no longer in the default bar — " + id);
  });
  // The Focus group (Plan / Billable / Non-bill) was DELETED 2026-08-17, not
  // moved into the drawer — it drove nothing after the People grid went.
  assert_(html.indexOf('id="focusChips"') === -1,
          "the Focus control is gone from the markup entirely, not merely hidden");
  assert_(!C.ADV_FILTERS_.some(function (f) { return f.dim === "focus"; }),
          "…and gone from ADV_FILTERS_ too — a drawer entry with no widget would count as an " +
          "active filter and force the drawer open on a scope nobody can see or clear");
  // Deleting a control must not orphan its closing tag. It did: the leftover
  // </div> closed #advFilters six lines early, leaving pmSel and famSel outside
  // the drawer (permanently visible, never hidden) and .hdr closing a level
  // early with them. Counted rather than eyeballed, because the page still
  // LOOKED plausible — the browser silently reparents on an unbalanced close.
  (function () {
    var hdr = html.slice(html.indexOf('<div class="hdr">'), html.indexOf('<div id="loading"'));
    hdr = hdr.replace(/<!--[\s\S]*?-->/g, "");
    var opens = (hdr.match(/<div\b/g) || []).length;
    var closes = (hdr.match(/<\/div>/g) || []).length;
    assert_(opens === closes,
            "the header's <div>s balance — got " + opens + " open, " + closes + " close");
  })();
  // display:flex on .hrow beats the UA's [hidden] rule, so the collapsed state
  // has to be declared. Without this the drawer never actually closes and the
  // whole feature is inert while every check above still passes.
  assert_(/\.hrow\.fadv\[hidden\]\{display:none\}/.test(html),
          "the drawer's collapsed state is declared in CSS — .hrow's display:flex would otherwise beat [hidden]");

  // ── 2. Closed by default, on a clean slate ──────────────────────────────
  C.setState("advOpen", false);
  C.renderAdvToggle_();
  assert_(box.hidden === true, "with every drawer filter at its default, the drawer starts closed");
  assert_(/More filters/.test(btn.innerHTML), "…and the toggle offers to open it");
  assert_(!/advN/.test(btn.innerHTML), "…with no count badge, because nothing is applied");
  assert_(btn.getAttribute("aria-expanded") === "false", "…and says so to a screen reader");

  // ── 3. Setting a drawer filter FORCES it open — and keeps it open ───────
  // The teeth of the whole feature. STATE.advOpen stays false throughout: the
  // reader's preference must lose to an applied filter, not merely be
  // overwritten once at the moment of setting.
  C.setState("family", "JF007");
  C.renderAdvToggle_();
  assert_(box.hidden === false, "setting a drawer filter opens the drawer, even with advOpen false");
  assert_(/advN/.test(btn.innerHTML) && /1 on/.test(btn.innerHTML),
          "…and the toggle badges how many are applied");
  assert_(/Applied: Job family = JF007/.test(btn.title),
          "…and NAMES it — a count says something is scoped, a name says what to expect");
  // Try to close it while the filter is still set. This must not work.
  C.toggleAdvFilters_();
  assert_(box.hidden === false,
          "…and it cannot be collapsed while that filter is applied — the reader's preference loses to an applied scope");

  // ── 4. Several at once, and the count is the number OFF DEFAULT ─────────
  // pop/role/focus have non-empty defaults ("fte"/"all"/"plan"), so a truthiness
  // test would count all three as active from the start. This is the check that
  // the badge means "off its default", not "has a value".
  C.setState("family", "");
  C.setState("pop", "fte"); C.setState("role", "all"); C.setState("focus", "plan");
  C.renderAdvToggle_();
  assert_(C.advActive_().length === 0,
          "the three defaulted chip filters count as INACTIVE — 'has a value' is not 'is filtering'");
  C.setState("pop", "crew"); C.setState("role", "ic");
  C.renderAdvToggle_();
  assert_(C.advActive_().length === 2, "…and moving two of them off default counts exactly two");
  assert_(/2 on/.test(btn.innerHTML), "…which the badge reports");

  // ── 5. Reset closes it, because Reset emptied it ────────────────────────
  C.resetFilters_();
  assert_(box.hidden === true, "Reset returns every drawer filter to default, so the drawer collapses");
  assert_(C.advActive_().length === 0, "…with nothing left applied");

  // ── 6. Opened by choice, with nothing applied, it stays open ────────────
  C.toggleAdvFilters_();
  assert_(box.hidden === false, "a reader can still open the drawer with nothing applied");
  assert_(/Fewer filters/.test(btn.innerHTML), "…and the toggle now offers to close it");
  C.toggleAdvFilters_();
  assert_(box.hidden === true, "…and close it again, since nothing inside is set");

  // Teardown.
  C.resetFilters_();
})();

// ══════════════════════════════════════════════════════════════════════════
// TREND-TO-GOAL IS DRAWN, NOT NARRATED (review item #2, 2026-08-17)
//
// The sparkline showed the SHAPE of a series and the delta sentence showed its
// distance from target; joining them was left to the reader. A target rule on
// the chart does that join, and a coloured card edge lets a row be scanned for
// trouble before any number is read.
//
// The rule that matters most here is SINGLE SOURCE: the line, the hero colour
// and the accent are three renderings of one verdict. Each check below would
// pass if they were computed separately and happened to agree today, so the
// interesting ones are the disagreement cases — an inverted target, a floor,
// and a target the series never approaches.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  // ── 1. A targeted card draws the rule; a target-less one does not ────────
  var t1 = C.tileHtml_("On-Time Delivery", 72, "ctx", [70, 71, 72],
    { target: { green: 85, amber: 70 }, trendLabels: ["a", "b", "c"] });
  assert_(/class="tgtline"/.test(t1), "a card with a target draws the target rule on its sparkline");
  assert_(/target — at or above 85%/.test(t1),
          "…and the rule's tooltip states the direction and the value, not just 'target'");
  assert_(/tgtlabel/.test(t1), "…and the rule is labelled on the chart, not left to be guessed at");
  var tNone = C.tileHtml_("Cleared", 40, "ctx", [30, 35, 40], { trendLabels: ["a", "b", "c"] });
  assert_(!/class="tgtline"/.test(tNone),
          "a card with NO target draws no rule — there is no bar to draw");

  // ── 2. Inverted targets say the opposite thing ──────────────────────────
  // Rework Rate is lower-is-better. A rule whose tooltip said "at or above"
  // would invert the verdict for the one metric where that matters most.
  var tInv = C.tileHtml_("Quality / Rework", 8, "ctx", [6, 7, 8],
    { target: { green: 5, amber: 10, invert: true }, trendLabels: ["a", "b", "c"] });
  assert_(/target — at or below 5%/.test(tInv),
          "an inverted target's rule reads 'at or below' — lower is better");
  assert_(/on target wherever it sits below this line/.test(tInv),
          "…and says which SIDE of the line is the good side");

  // ── 3. The frame grows to hold the target ───────────────────────────────
  // .chart is overflow:visible, so a rule outside the domain is not clipped —
  // it is painted across the page, which is the bug that put a count series
  // through the whole dashboard in 2026-08. A target far above the series must
  // widen the axis; clipping it to the frame edge would read as "nearly there".
  var tFar = C.tileHtml_("On-Time Delivery", 12, "ctx", [10, 11, 12],
    { target: { green: 95, amber: 80 }, trendLabels: ["a", "b", "c"] });
  var lineY = /class="tgtline"[^>]*y1="([-0-9.]+)"/.exec(tFar);
  assert_(lineY !== null, "the far-off target still draws its rule");
  var yv = parseFloat(lineY[1]);
  assert_(yv >= 0 && yv <= 54,
          "…inside the 54px viewBox — the axis widened to hold it rather than the line escaping (got y=" + yv + ")");

  // ── 4. A FLOOR gets no rule, for the same reason it gets no colour ──────
  // A rate whose numerator is structurally absent can only undercount. There is
  // no verdict to give, so there is nothing to draw a bar against.
  var tFloor = C.tileHtml_("Quality / Rework", 3, "ctx", [2, 3, 3],
    { target: { green: 5, amber: 10, invert: true }, floor: true,
      floorWhy: "reopen detection is off", trendLabels: ["a", "b", "c"] });
  assert_(!/class="tgtline"/.test(tFloor),
          "a floor draws no target rule — a lower bound has no distance-to-target to show");
  assert_(!/vMiss|vNear/.test(tFloor), "…and wears no variance accent either, matching its lack of RAG colour");

  // ── 5. The accent tracks the hero's RAG, both directions ────────────────
  // Same target, three values. If the accent were computed independently of
  // `rag` these would be free to disagree; the check is that they never do.
  var miss = C.tileHtml_("On-Time Delivery", 40, "ctx", [40], { target: { green: 85, amber: 70 } });
  var near = C.tileHtml_("On-Time Delivery", 75, "ctx", [75], { target: { green: 85, amber: 70 } });
  var hit  = C.tileHtml_("On-Time Delivery", 90, "ctx", [90], { target: { green: 85, amber: 70 } });
  assert_(/class="tile vMiss"/.test(miss), "a card through the bar wears the red edge");
  assert_(/class="big r"/.test(miss), "…and its hero is red — one verdict, two renderings");
  assert_(/class="tile vNear"/.test(near), "a card approaching the bar wears the quieter amber edge");
  assert_(/class="big a"/.test(near), "…matching its amber hero");
  assert_(!/vMiss|vNear/.test(hit), "a card at or above the bar wears no accent at all");
  assert_(/class="big g"/.test(hit), "…and is green");
  // Inverted metrics invert the accent too — an 8% rework rate against a ≤5%
  // target is a MISS, and an edge that read green there would be worse than no
  // edge at all.
  assert_(/vMiss|vNear/.test(tInv), "an inverted metric over its bar wears an accent — not treated as a win");

  // ── 6. The accent is never the only signal ──────────────────────────────
  // Colour alone fails a photocopy, a monochrome board pack and a colour-vision
  // difference. The delta sentence has to carry the same verdict in words.
  assert_(/pts below target/.test(miss),
          "the missed card still says how far below target it is, in text");

  // ── 7. The two bugs the SCREENSHOT caught, pinned ───────────────────────
  // Both shipped past a green suite, because a markup assertion cannot see a
  // property that lost a cascade fight or two labels landing on one pixel.
  // These are the closest a text assertion gets; the screenshot stays the
  // real check (see feedback_table_layout_discipline).
  //
  // (a) The accent was first written as `box-shadow:inset`, which rendered on
  // nothing in Tier 1: `.tiles.tier1>.tile` (0,3,1) sets the elevation shadow
  // and outranks `.tile.vMiss` (0,2,0). The fix is a ::before bar, which does
  // not compete with the shadow at all.
  assert_(/\.tile\.vMiss::before/.test(html) && /\.tile\.vNear::before/.test(html),
          "the accent is drawn as a ::before bar, not a box-shadow that Tier 1's elevation shadow would replace");
  assert_(!/\.tile\.vMiss\{box-shadow:inset/.test(html),
          "…and the losing inset-shadow form is gone, not merely supplemented");

  // (b) A metric sitting ON its target put the "target" label and the endpoint
  // value at the same height, printing "90%t". The label drops below the rule
  // when they are within a line's height of each other.
  var onTgt = C.tileHtml_("On-Time Delivery", 85, "ctx", [85, 85, 85],
    { target: { green: 85, amber: 70 }, trendLabels: ["a", "b", "c"] });
  var lineY2 = parseFloat(/class="tgtline"[^>]*y1="([-0-9.]+)"/.exec(onTgt)[1]);
  var labY = parseFloat(/class="axis tgtlabel"[^>]*y="([-0-9.]+)"/.exec(onTgt)[1]);
  assert_(labY > lineY2,
          "with the series ON its target, the label drops BELOW the rule instead of printing through the value label");
  // …and clears it, rather than merely being on the other side.
  assert_(labY - lineY2 >= 6, "…far enough below to clear it (got " + (labY - lineY2).toFixed(1) + "px)");
  // The normal case is still above the rule, where it reads as a caption on it.
  var offTgt = C.tileHtml_("On-Time Delivery", 40, "ctx", [40, 41, 40],
    { target: { green: 85, amber: 70 }, trendLabels: ["a", "b", "c"] });
  var lineY3 = parseFloat(/class="tgtline"[^>]*y1="([-0-9.]+)"/.exec(offTgt)[1]);
  var labY3 = parseFloat(/class="axis tgtlabel"[^>]*y="([-0-9.]+)"/.exec(offTgt)[1]);
  assert_(labY3 < lineY3, "…while a series far from its target keeps the label above the rule");
})();

// ══════════════════════════════════════════════════════════════════════════
// THE REGISTRY IS THE SPINE — a metric the server does not define is UNGRADED,
// never silently defaulted (review item #6, 2026-08-17)
//
// Before this rule, two things conspired: every flow tile carried a literal
// fallback (`reg.throughput || { unit: "hrs", coverageGate: 0.6, … }`), and
// reg_() returned `{}` on a miss — so an undefined coverageGate reached
// metricConfidence_, which reads `Number(undefined) || 0` as "ungated, publish
// at high confidence". A metric the server had never heard of therefore drew a
// complete, confident card built entirely out of client-side literals.
//
// These checks delete a registry entry and demand that the card DISAPPEARS as a
// measurement. Each would pass trivially if the guard were removed and the
// literal restored — so each asserts the ABSENCE of the real headline as well
// as the presence of the placeholder.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  /** Renders the exec flow tiers with `id` deleted from the registry. */
  function without(id) {
    var m = model({});
    delete m.meta.registry.metrics[id];
    fresh(m);
    C.getModel().viewerRole = "admin";
    C.renderFlow_();
    return flowHtml_();
  }
  var UNGRADED = /ungraded — the metric registry/;

  // ── 1. Every gated card on the flow tiers, one at a time ─────────────────
  // Including On-Time: the page's headline KPI is exactly the one that must
  // never publish itself off a client-side default.
  [["onTime", "On-Time Delivery"], ["forecast", "Forecast Accuracy"],
   ["quality", "Quality / Rework"], ["throughput", "Throughput"],
   ["bugCount", "Bug Count"], ["cleared", "Cleared"], ["arrived", "Arrived"],
   ["leadTime", "Lead Time"]].forEach(function (pair) {
    var id = pair[0], name = pair[1];
    var h = without(id);
    var seg = tileSeg_(h, id);
    assert_(seg !== "", "'" + id + "' missing from the registry still draws a card, labelled by its id");
    assert_(UNGRADED.test(seg),
            "…and that card says it is ungraded because the registry does not define it");
    assert_(h.indexOf('<div class="tile ph"><div class="lbl">' + id) !== -1,
            "…in the ph placeholder shell, so it can never read as a zero — id " + id);
    assert_(h.indexOf('<div class="lbl">' + name) === -1,
            "…and the real '" + name + "' card is GONE — no literal fallback rebuilt it");
  });

  // ── 2. The absence is stated with the registry's own version ─────────────
  // Whoever reads this card has to know which registry was asked, or "add the
  // entry" is advice with no address.
  var hOne = without("throughput");
  assert_(/registry \(v1\.0\) does not define this metric/.test(hOne),
          "the placeholder names the registry version it consulted");

  // ── 3. It is a MISS that triggers this, not a zero ───────────────────────
  // bugCount and cleared legitimately ship coverageGate: 0. An absent gate and
  // a gate of zero must not land in the same branch — that conflation is the
  // whole bug, and it is the same absent-≠-zero rule the queue cards apply to
  // data, applied here to the metadata.
  var hZero = flowHtml_that_renders_();
  assert_(!UNGRADED.test(tileSeg_(hZero, "Bug Count")),
          "a registered metric whose coverageGate IS 0 publishes normally — absent ≠ zero");
  assert_(!UNGRADED.test(tileSeg_(hZero, "Cleared")),
          "…same for Cleared, the other genuinely ungated count");
  assert_(!UNGRADED.test(hZero),
          "…and with a complete registry no card anywhere claims to be ungraded");

  /** A normal render with the registry intact — the control for check 3. */
  function flowHtml_that_renders_() {
    fresh(model({}));
    C.getModel().viewerRole = "admin";
    C.renderFlow_();
    return flowHtml_();
  }

  // Teardown.
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// BENCHED CREW ARE VISIBLE, AND OUT OF EVERY CAPACITY FIGURE
// (spec 2026-08-17)
//
// The point of this feature is a person who STAYS on screen while leaving the
// denominators. So the checks come in pairs: still rendered, still not counted.
// A test that only asserted the carve would pass on a change that deleted them.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  var benched = person("Bruno Bench", { region: "AMER" });
  benched.onBench = true;
  benched.benchStatus = "Crew - On the Bench";
  var active = person("Dana Deployed", { region: "AMER" });

  // ── 1. The badge says what they are, and it is not the leave badge ───────
  var badges = C.personStateBadges_(benched);
  assert_(/⏸/.test(badges), "a benched person carries the ⏸ badge");
  assert_(!/🏖/.test(badges), "…and NOT the on-leave badge — bench is not leave");
  assert_(/between engagements/i.test(badges),
          "…and the tooltip says what bench means, not just that it is set");
  assert_(!/⏸/.test(C.personStateBadges_(active)), "an active person carries no bench badge");

  // ── 2. The hours cell reads a state, never a zero ────────────────────────
  // Nobody is "0h available" in a week they are not contracted for. Same rule
  // the on-leave cell already follows.
  var cell = C.planCellHtml_(benched, ["2026.W31"]);
  assert_(/on the bench/.test(cell), "the hours cell reads 'on the bench'");
  assert_(!/>0%|>0h/.test(cell), "…and never renders a zero for them");

  // ── 3. Out of the sellable subtotal ──────────────────────────────────────
  assert_(C.wfSellable_(benched) === false, "a benched person is not sellable capacity");
  assert_(C.wfSellable_(active) === true, "…while an active one is");

  // ── 4. Bench and leave stay separable ────────────────────────────────────
  // Merged flags would be a one-way door: you cannot recover which was which.
  var leaver = person("Lena Leave", { region: "AMER" });
  leaver.onLeave = true;
  assert_(C.wfSellable_(leaver) === false, "on-leave is still carved, unchanged");
  assert_(/🏖/.test(C.personStateBadges_(leaver)) && !/⏸/.test(C.personStateBadges_(leaver)),
          "an on-leave person carries 🏖 and not ⏸");

  // ── 5. The bench count is stated where it can actually be SEEN ───────────
  // Moved off the capacity tile (user 2026-08-17). That card opens with
  // `if (!SHOW_UTILIZATION_ && !planningPhase_()) return ""` and
  // SHOW_UTILIZATION_ ships false, so the count rendered only on a planning
  // window. The old test passed regardless because it forced the card on with
  // withUtilization_() — a green check over a surface nobody sees.
  //
  // These checks deliberately do NOT wrap anything in withUtilization_: the
  // whole point is that Scope renders at the shipped defaults.
  var mBench = model({});
  mBench.people = [person("Dana Deployed", { region: "AMER" }),
                   person("Derek Deployed", { region: "AMER" }),
                   person("Dita Deployed", { region: "AMER" }),
                   person("Bruno Bench", { region: "AMER" }),
                   person("Bianca Bench", { region: "AMER" })];
  mBench.people[3].onBench = true;
  mBench.people[4].onBench = true;
  // The signals roster needs hygiene buckets or personSignalRows_ returns null,
  // and an assertion that "no benched person has a row" would pass vacuously
  // against an empty roster. Give all five a bucket, including the benched two,
  // so their absence downstream is the GATE doing its job rather than an
  // absence of data.
  mBench.personHygiene = {
    open: mBench.people.map(function (p) {
      return { person: p.name, n: 10, due: 8, dueN: 10, est: 7, logged: 6, loggedN: 10,
               link: 9, start: 5, bill: 8, billN: 10, estSec: 0, spentSec: 0, wip: 0 };
    }),
    resolved: [],
  };
  fresh(mBench);

  // ── The population gate: benched crew are not rows ANYWHERE ──────────────
  // "Show active working only" (user 2026-08-17). Asserted on the population
  // itself rather than per surface, because every people surface derives from
  // it — one gate, so no tab can drift back into listing them.
  var names = C.filteredPeople_().map(function (p) { return p.name; });
  assert_(names.length === 3, "the population is the 3 deployed people, not 5 — got " + names.length);
  assert_(names.indexOf("Bruno Bench") === -1 && names.indexOf("Bianca Bench") === -1,
          "…and neither benched person is in it");
  // The Actions signals roster is the one that matters most: a red row against
  // somebody who is not working is the "finger on him/her" failure.
  var sig = C.personSignalRows_([]) || [];
  assert_(sig.filter(function (r) { return /Bench/.test(r.p.name); }).length === 0,
          "benched crew carry no row on the Actions signals roster");
  assert_(sig.length === 3, "…and the roster is the working population — got " + sig.length);

  // ── But the bench is still STATED, or it is merely hidden ────────────────
  C.renderWfScope_();
  var scope = els.wfScopePanel.innerHTML;
  assert_(/<b>2<\/b> on the bench/.test(scope),
          "the Scope panel names how many people are benched");
  assert_(/not shown/.test(scope),
          "…and says they are not listed, so an absent row is explained rather than noticed");
  assert_(/<b>3<\/b> people in scope/.test(scope),
          "…while the headcount counts only the working population");
  assert_(/not contracted to deliver right now/.test(scope),
          "…and the tooltip says what bench means, so the number is not a bare label");

  // Counted from MODEL.people, not from the filtered population — reading the
  // latter would print nothing at all now that the gate empties it.
  assert_(!/<b>0<\/b> on the bench/.test(scope),
          "the count is not read off the gated population, which would always be zero");

  // ── The filter chips must agree with the page they filter ────────────────
  // Caught by screenshot: Scope read "3 people in scope" beside a Region chip
  // reading "AMER 5". A chip that promises five rows and delivers three is a
  // filter bar arguing with its own result. optionsFor_ counts MODEL.people
  // directly, so the bench gate has to be repeated there — it cannot live in
  // passesFilters_ without dropping delivered work from the KPI buckets.
  var opts = C.optionsFor_("region");
  assert_(opts.counts.AMER === 3,
          "the Region chip counts the working population (3), not the roster (5) — got " +
          opts.counts.AMER);

  // It renders at the SHIPPED defaults — the failure the move exists to fix.
  assert_(C.getUtilization_() === false,
          "guard: the suite is reading Scope with utilization OFF, as production ships it");

  // ── ⚠️ THE REGRESSION GUARD: delivered is delivered ──────────────────────
  // The gate is in filteredPeople_, NOT passesFilters_, because bucketsFor_
  // attributes Jira buckets through the latter. If the gate ever moves, work a
  // benched person completed BEFORE going on the bench silently drops out of
  // On-Time, Forecast and Quality — a published rate changing because of
  // somebody's current employment status.
  assert_(C.passesFilters_(mBench.people[3]) === true,
          "a benched person still PASSES passesFilters_ — the gate must not sit there");
  var bench2 = mBench.people[4];
  assert_(C.passesFilters_(bench2) === true, "…same for the second one");

  // With nobody benched the phrase leaves with its subject — a standing
  // "0 on the bench" teaches readers to skip the line on the day it is not zero.
  var mClean = model({});
  mClean.people = [person("Dana Deployed", { region: "AMER" })];
  fresh(mClean);
  C.renderWfScope_();
  assert_(!/on the bench/.test(els.wfScopePanel.innerHTML),
          "no benched people, no bench phrase");

  // …and it is GONE from the capacity tile, so the fact is stated once.
  fresh(mBench);
  assert_(!/on the bench/.test(withUtilization_(function () { return C.capacityTileHtml_(); })),
          "the capacity tile no longer carries the count — it moved, it was not duplicated");
})();


// ══════════════════════════════════════════════════════════════════════════
// ACCESS CONTROL — the list replaces two comma-separated text inputs
// (user 2026-08-17: "it has a separated by comma option that looks nasty").
//
// Tested through accessPanelHtml_, which is a pure function of the working
// state, because the panel itself only ever renders behind a
// google.script.run round-trip the DOM stub never resolves.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  function st_(over) {
    var base = {
      admins: ["gonzalo.riquelme@servicerocket.com", "william.mock@servicerocket.com"],
      viewers: ["director@servicerocket.com"],
      openAccess: false,
      bootstrapAdmin: "moises.lopez@servicerocket.com",
      callerEmail: "gonzalo.riquelme@servicerocket.com",
      orig: { admins: ["gonzalo.riquelme@servicerocket.com", "william.mock@servicerocket.com"],
              viewers: ["director@servicerocket.com"], openAccess: false },
    };
    Object.keys(over || {}).forEach(function (k) { base[k] = over[k]; });
    return base;
  }

  var html = C.accessPanelHtml_(st_());

  // ── 1. It is a LIST, not a joined string ────────────────────────────────
  // The regression this guards is a revert to `admins.join(", ")` in a text
  // input — which is what the page did until now, and which no other assertion
  // here would notice because the addresses would all still be present.
  assert_(!/value="[^"]*,\s/.test(html),
          "no comma-joined address string survives anywhere in the markup");
  assert_(!/id="accAdmins"/.test(html) && !/id="accViewers"/.test(html),
          "the two comma-separated inputs are gone");
  assert_((html.match(/class="accRow /g) || []).length === 4,
          "one row per person: 2 admins + 1 viewer + the owner = 4");

  // ── 2. The owner is IN the list, and cannot be removed from it ──────────
  // He used to be a sentence above the inputs. A page that claims to list
  // everyone with access, while one person with access is mentioned elsewhere,
  // answers its own question wrongly.
  assert_(html.indexOf("moises.lopez") !== -1, "the bootstrap admin appears as a row");
  assert_(/🔒 owner/.test(html), "…tagged as the owner");
  // Rows extracted by their own delimiter, never by splitting on the address:
  // the address appears TWICE in a row (title attribute and name span), so a
  // naive split returns the sliver between the two and any assertion on it
  // passes or fails for the wrong reason.
  function rowFor_(h, who) {
    var rows = h.split('<div class="accRow ').slice(1);
    for (var i = 0; i < rows.length; i++) if (rows[i].indexOf(who) !== -1) return rows[i];
    return "";
  }
  var ownerRow = rowFor_(html, "moises.lopez");
  assert_(ownerRow.indexOf("accRemove_") === -1,
          "…with NO remove control — the server would put it back on the next check");
  // Everyone else has one, or the list is read-only by accident.
  assert_((html.match(/accRemove_\(/g) || []).length === 3,
          "the other three rows each carry a remove control");

  // ── 3. The domain is dimmed, not hidden ────────────────────────────────
  // Every address ends in the same domain, so the domain is the noise and the
  // local part is the signal. Dimming must never become truncating: the full
  // address has to remain on the page and in the row's title.
  assert_(/<span class="accName">gonzalo\.riquelme<\/span>/.test(html),
          "the local part renders as the name");
  assert_(/<span class="accDomain">@servicerocket\.com<\/span>/.test(html),
          "…and the domain renders beside it, dimmed but present");
  assert_(html.indexOf('title="gonzalo.riquelme@servicerocket.com"') !== -1,
          "…with the whole address in the row title, so nothing is actually lost");

  // ── 4. The signed-in admin is marked ───────────────────────────────────
  var gonRow = rowFor_(html, "gonzalo.riquelme");
  assert_(/>you</.test(gonRow), "the caller's own row is marked 'you'");

  // ── 5. Counts are per card and include the owner ───────────────────────
  assert_(/<b>Admins<\/b><span class="accCount">3<\/span>/.test(html),
          "the admin count is 3 — two listed plus the owner, who is an admin");
  assert_(/<b>Viewers<\/b><span class="accCount">1<\/span>/.test(html),
          "…and the viewer count is its own list only");

  // ── 6. Save states what it will do, and is inert until there is one ────
  assert_(/No changes to save/.test(html), "an untouched page says there is nothing to save");
  assert_(/id="accSave"[^>]*disabled/.test(html), "…and Save is disabled");
  var dirty = st_({ viewers: ["director@servicerocket.com", "new.person@servicerocket.com"],
                    openAccess: true });
  var dirtyHtml = C.accessPanelHtml_(dirty);
  assert_(!/id="accSave"[^>]*disabled/.test(dirtyHtml), "an edited page enables Save");
  assert_(/Pending:/.test(dirtyHtml), "…and says what is pending");
  assert_(C.accPending_(dirty) === "+1 viewer, open access ON",
          "the pending line names the actual change set — got: " + C.accPending_(dirty));
  var removed = st_({ admins: ["gonzalo.riquelme@servicerocket.com"] });
  assert_(C.accPending_(removed) === "−1 admin", "a removal reads as a removal, not as an add");

  // ── 7. Open access is the one control that gets colour, and only when armed
  assert_(!/class="accOpen on"/.test(html), "the open-access block is neutral while off");
  assert_(/Only the people listed above/.test(html), "…and states the safe consequence");
  assert_(/class="accOpen on"/.test(dirtyHtml), "…and is highlighted when on");
  assert_(/Anyone with the link/.test(dirtyHtml), "…stating the real consequence, not a label");
  assert_(/utilization and forecast variance stay hidden/.test(dirtyHtml),
          "…including the guest tier's actual limits, so 'demo only' is not the whole warning");

  // ── 8. Empty states invite the action rather than reporting a void ──────
  var empty = C.accessPanelHtml_(st_({ viewers: [],
    orig: { admins: ["gonzalo.riquelme@servicerocket.com", "william.mock@servicerocket.com"],
            viewers: [], openAccess: false } }));
  assert_(/No viewers yet\. Add an email/.test(empty),
          "an empty viewer list says what to do about it");

  // ── 9. Validation helpers, at the boundary they actually guard ──────────
  assert_(C.accIsEmail_("a@b.co") === true, "a plain address passes");
  assert_(C.accIsEmail_("not-an-email") === false, "a bare word does not");
  assert_(C.accIsEmail_("a@b") === false, "…nor a domain with no dot");
  assert_(C.accIsEmail_(" spaced @b.co") === false, "…nor one with a space in it");
  var s9 = st_();
  assert_(C.accWhere_(s9, "MOISES.LOPEZ@servicerocket.com") === "the owner",
          "duplicate detection is case-insensitive and names WHERE the address already is");
  assert_(C.accWhere_(s9, "director@servicerocket.com") === "a viewer", "…across the other list too");
  assert_(C.accWhere_(s9, "nobody@servicerocket.com") === "", "…and says nothing about a new address");

  // ── 10. A malformed entry already in Script Properties still renders ────
  // The old free-text field could save anything; this page must show what is
  // stored rather than dropping it into an empty row nobody can remove.
  var junk = C.accessPanelHtml_(st_({ viewers: ["not-an-email"],
    orig: { admins: ["gonzalo.riquelme@servicerocket.com", "william.mock@servicerocket.com"],
            viewers: ["not-an-email"], openAccess: false } }));
  assert_(junk.indexOf("not-an-email") !== -1, "a stored malformed entry is still shown");
  assert_(junk.indexOf("accRemove_") !== -1, "…and can be removed");

  // ── 11. Addresses are escaped ──────────────────────────────────────────
  var xss = C.accRowHtml_('<img src=x onerror=alert(1)>@evil.com', "viewer", {});
  assert_(xss.indexOf("<img") === -1, "an address is escaped before it reaches innerHTML");
  assert_(xss.indexOf("&lt;img") !== -1, "…as escaped text, not dropped");
})();

// ══════════════════════════════════════════════════════════════════════════
// "UNKNOWN" MEANS TWO DIFFERENT THINGS, SO IT GETS TWO DIFFERENT LABELS
// (spec 2026-08-17)
//
// For an FTE, an unparseable level is a data-quality gap somebody should close.
// For crew it is the designed state — they are hired against a contract, not a
// level. One word for both taught the reader to ignore it.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  assert_(C.wfBandLabel_("CREW", "UNKNOWN") === "Crewmembers",
          "an unlevelled CREW band reads as Crewmembers");
  assert_(C.wfBandLabel_("PS-CONSULT", "UNKNOWN") === "UNKNOWN",
          "…while an unlevelled FTE band still reads UNKNOWN — there it is a real gap");
  assert_(C.wfBandLabel_("CREW", "CORE") === "CORE",
          "a crew member WITH a parseable level keeps their band");
  assert_(C.wfBandLabel_("CREW", "SENIOR") === "SENIOR", "…at every level");

  // The KEY is untouched. Sorting, p.cell, the level filter and every bucket
  // join still operate on "UNKNOWN" — this is a label, not a rename.
  assert_(C.WF_BAND_ORDER_.indexOf("UNKNOWN") !== -1,
          "the band ORDER still keys on UNKNOWN — the rename is display-only");
  assert_(C.WF_BAND_ORDER_.indexOf("Crewmembers") === -1,
          "…and the display word never leaks into the key vocabulary");
})();

// ══════════════════════════════════════════════════════════════════════════
// FORECAST ATTRIBUTION IS DISCLOSED (2026-08-17)
//
// The card computed two facts and printed neither: how many of its epics were
// attributed by INFERENCE (through their children, because epics are containers
// and are routinely unassigned), and how many closed epics were dropped for
// resolving to nobody. Both now appear, because a mean over a silently selected
// subset is the failure Bug Count already carries a registry deviation for.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  function fcDetail_(mut) {
    var m = model({});
    mut(m);
    fresh(m);
    C.getModel().viewerRole = "admin";
    C.setState("view", "exec");
    C.setState("periodIdx", null);
    C.renderAll_();
    return tileSeg_(flowHtml_(), "Forecast Accuracy");
  }

  // ── 1. Inference is NAMED, with its share ────────────────────────────────
  var inferred = fcDetail_(function (m) {
    m.forecastBuckets = m.forecastBuckets.map(function (b) {
      return Object.assign({}, b, { nViaChildren: 3 });
    });
  });
  assert_(/3 of \d+ epics reached their owner through the people working their children/.test(inferred),
          "the card states how many epics were attributed through their children");
  assert_(/only who it is filed under is inferred|variance is unchanged/i.test(inferred),
          "…and says the VARIANCE is unaffected — only the filing is inferred");

  // ── 2. No inference, no claim ────────────────────────────────────────────
  var direct = fcDetail_(function (m) {
    m.forecastBuckets = m.forecastBuckets.map(function (b) {
      return Object.assign({}, b, { nViaChildren: 0 });
    });
  });
  assert_(!/reached their owner through/.test(direct),
          "a card whose epics were all directly assigned claims no inference");

  // ── 3. Dropped epics are disclosed on the card, not just counted ─────────
  // The server has always shipped meta.jiraUnattributed.forecast; until now
  // nothing rendered it, so a reader had no way to know the denominator was
  // incomplete. Throughput and Lead Time have always shown their equivalent.
  var dropped = fcDetail_(function (m) {
    m.meta.jiraUnattributed = { onTime: 0, forecast: 7 };
    m.forecastBuckets = m.forecastBuckets.map(function (b) {
      return Object.assign({}, b, { nViaChildren: 0 });
    });
  });
  assert_(/7 issues excluded/.test(dropped),
          "the card prints the unattributed count the server ships");
  var clean = fcDetail_(function (m) { m.meta.jiraUnattributed = { onTime: 0, forecast: 0 }; });
  assert_(!/issues excluded/.test(clean),
          "…and says nothing when nothing was dropped");

  // ── 4. The aggregation is ADDITIVE across the window ─────────────────────
  // A month must state the share of the whole month, not of its last week.
  var mAdd = model({});
  mAdd.forecastBuckets = mAdd.forecastBuckets.map(function (b) {
    return Object.assign({}, b, { nViaChildren: 2 });
  });
  fresh(mAdd);
  var wk = C.bucketsFor_(C.getModel().forecastBuckets, ["2026.W31"]);
  var both = C.bucketsFor_(C.getModel().forecastBuckets, ["2026.W30", "2026.W31"]);
  assert_(wk.nViaChildren === 2 && both.nViaChildren === 4,
          "nViaChildren sums over the window like every other bucket counter — got " +
          wk.nViaChildren + " and " + both.nViaChildren);
  // A payload built before the field existed must read 0, never undefined/NaN.
  var older = C.bucketsFor_([{ iso: "2026.W31", person: "Ana Perez", n: 4, nAll: 5, absVars: [0.1] }],
                            ["2026.W31"]);
  assert_(older.nViaChildren === 0,
          "a pre-2026-08-17 cache entry carries no such field and must aggregate to 0, not NaN");

  // Teardown.
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// THE SMART SPLIT — sub-tab routing (2026-08-17)
//
// Both halves are RENDERED on every pass and only their visibility toggles.
// renderFlow_ writes into containers on both, so rendering "only the visible
// half" would leave the hidden one holding a previous filter's numbers — and a
// hidden pane with stale figures is exactly what a PNG export or a
// find-in-page picks up.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.setState("execTab", "health");
  C.renderAll_();

  var health = document.getElementById("execHealth");
  var flow = document.getElementById("execFlow");
  assert_(health.hidden === false && flow.hidden === true,
          "Health & Actions is the default half on screen");
  assert_(els.execTabs.children.length === 2, "both sub-tabs render in the strip");
  assert_(els.execTabs.children[0].getAttribute("aria-selected") === "true",
          "…and the active one reports its selected state");

  // BOTH halves carry live content even while one is hidden.
  assert_(document.getElementById("tier1Tiles").innerHTML !== "", "the KPI grid is painted");
  assert_(document.getElementById("flowSecondary").innerHTML !== "",
          "…and so is the hidden half's flow strip — hidden is not unrendered");

  C.setExecTab_("flow");
  assert_(health.hidden === true && flow.hidden === false, "switching shows Backlog & Flow");
  assert_(els.execTabs.children[1].getAttribute("aria-selected") === "true",
          "…and the strip follows the selection");
  C.setExecTab_("health");
  assert_(health.hidden === false, "…and back again");

  // A filter change must reach the hidden half too, or returning to it shows
  // the previous slice's numbers with no sign that they are stale.
  // Probed on the masthead, which is people-scoped and therefore MOVES under a
  // region filter. The flow strip beside it is deliberately ORG-scoped, so it
  // is identical before and after by design — asserting on that would have
  // pinned the wrong thing and passed for the wrong reason.
  var beforeHead = els.masthead.innerHTML;
  // EMEA, not AMER: the base fixture's people are ALL AMER, so filtering to
  // AMER selects everybody and the panel is legitimately byte-identical — a
  // check that would have passed for the wrong reason.
  C.setState("region", "EMEA");
  C.renderAll_();
  assert_(document.getElementById("execFlow").hidden === true,
          "sanity: the flow half is still the hidden one");
  assert_(beforeHead !== els.masthead.innerHTML,
          "the HIDDEN half re-renders on a filter change — it can never hold a stale slice");
  C.setState("region", "");
  C.renderAll_();

  // ── Health & Actions carries nothing between the numbers and the actions ──
  var healthHtml = document.getElementById("tier1Tiles").innerHTML +
                   els.comparePanel.innerHTML;
  assert_(healthHtml.indexOf("Colour key") === -1,
          "the colour key is off Health & Actions — it is reference material");
  assert_(healthHtml.indexOf('class="chart hbar"') === -1,
          "…and so is the bar chart that restated the drill-down table");
  // The two destinations ride in the section HEADER, above the table, so a
  // director never scrolls past evidence to reach the action.
  var cmp = els.comparePanel.innerHTML;
  var headEnd = cmp.indexOf("</div>", cmp.indexOf("chartHead"));
  assert_(cmp.indexOf("Who is available") !== -1 && cmp.indexOf("What needs action") !== -1,
          "both destinations render");
  assert_(cmp.indexOf("Who is available") < cmp.indexOf("gridTable"),
          "…ABOVE the table, not under it");

  // ── The three pipeline figures are COMPUTED, never literals ──────────────
  var mStat = model({});
  mStat.queue = { assigned: { items: 400, wipN: 250, todoN: 150, todoHrs: 0, unattributed: 0, uncategorized: 0 },
                  unassigned: { items: 600, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 } };
  mStat.meta.clearRateMedian = 100;
  fresh(mStat);
  C.renderMasthead_();
  var stat = els.masthead.innerHTML;
  assert_(/100\/wk/.test(stat), "delivery pace prints the measured clearing rate");
  assert_(/10\.0w/.test(stat), "total runway = 1,000 items ÷ 100/wk = 10.0w, computed not typed");
  assert_(/600 items/.test(stat) && /60% of the queue/.test(stat),
          "groomed pipeline states the unassigned count and its share");
  // Move the model; every figure must move with it.
  mStat.meta.clearRateMedian = 200;
  C.setModel(mStat);
  C.renderMasthead_();
  var stat2 = els.masthead.innerHTML;
  assert_(/200\/wk/.test(stat2) && /5\.0w/.test(stat2),
          "…and all three follow the model rather than a cached sentence");
  // An unmeasured rate is not a zero.
  mStat.meta.clearRateMedian = null;
  C.setModel(mStat);
  C.renderMasthead_();
  assert_(/more week/.test(els.masthead.innerHTML),
          "with no clearing rate the pace says what it needs, never 0/wk");

  // Teardown.
  fresh(model({}));
  C.setState("execTab", "health");
  C.setState("view", "exec");
  C.renderAll_();
})();


// ══════════════════════════════════════════════════════════════════════════
// 👁 CONFIDENTIAL VIEW — blurs PEOPLE, keeps every number
//
// The first cut of this hid the margin metrics and every role-gated tab, which
// removed the analysis and left the names. §1 and §2 pin the corrected trade in
// both directions: the people go, the numbers and the navigation stay.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  function as_(role, superAdmin) {
    var m = fresh(model({}));
    m.viewerRole = role;
    m.viewerSuper = !!superAdmin;
    C.setModel(m);
    C.setState("view", "exec");
    return m;
  }

  // ── 1. IT TAKES NOTHING AWAY BUT NAMES ──────────────────────────────────
  // Every tab an admin could open before must still open, and every metric they
  // could chart must still chart. This is the assertion that would have caught
  // the first cut on the day it shipped.
  as_("admin", true);
  C.setConfidential_(false);
  var tabsShown = C.VIEWS.filter(C.viewAllowed_).map(function (v) { return v.id; }).join(",");
  var metricsShown = C.liveMetrics_().join(",");
  C.setConfidential_(true);
  assert_(C.VIEWS.filter(C.viewAllowed_).map(function (v) { return v.id; }).join(",") === tabsShown,
          "blurring names removes NO tab — got " +
          C.VIEWS.filter(C.viewAllowed_).map(function (v) { return v.id; }).join(","));
  assert_(C.liveMetrics_().join(",") === metricsShown, "…and no metric leaves the drill-down");
  assert_(C.canSeeMargin_() === true, "…and the margin tier is untouched: it is a role, not a view state");
  assert_(C.canSeeSuper_() === true, "…as is the super tier");

  // ── 2. The people DO go ─────────────────────────────────────────────────
  // Asserted on the rendered roster, because the point is what a person in the
  // room can read, not what a helper returns.
  // §1 left the mode ON. Reset before rendering, or the tooltip assertion below
  // reads a stripped attribute and fails for the wrong reason.
  C.setConfidential_(false);
  var m2 = fresh(model({}));
  m2.viewerRole = "admin";
  m2.personHygiene = { open: [{ person: "Ana Perez", n: 10, due: 10, est: 10, logged: 10 }],
                       resolved: [] };
  C.setModel(m2);
  C.STATE.typePop = "open";
  C.renderRoster_();
  var roster = els.rosterPanel.innerHTML;
  assert_(/class="pii"/.test(roster), "the roster wraps the person's name for blurring");
  assert_(roster.indexOf("Ana Perez") !== -1,
          "…and the name is still IN the markup — this is a blur, not a redaction, so layout " +
          "and column widths cannot move when the mode flips");
  // The job title travels with the name: a title is as identifying as a name on
  // a roster of 70 people, and blurring one without the other is theatre.
  assert_(/class="pii">[^<]*Consultant/.test(roster),
          "the job title is blurred too — got: " + (roster.match(/class="pii">[^<]*/g) || []).join(" | "));
  // The tooltip carrying the FULL job title survives OUTSIDE the mode — the
  // column truncates, so hover is how you read the rest — and is stripped while
  // blurred, because a native tooltip is not covered by a CSS blur and hovering
  // a row is exactly what a presenter does while talking over it.
  assert_(/title="09\.P3\.Consultant"/.test(roster),
          "the full job title is in a hover tooltip while names are shown");
  C.setConfidential_(true);
  C.renderRoster_();
  assert_(!/title="09\.P3\.Consultant"/.test(els.rosterPanel.innerHTML),
          "…and that tooltip is gone once names are blurred, since no blur can reach it");
  C.setConfidential_(false);
  C.renderRoster_();

  // ── 3. The switch is a lens, not a gate ─────────────────────────────────
  // It must not read or change a role. A guest gets no eye because they reach
  // no tab that names anybody; that is the only role question it asks.
  as_("guest", false);
  assert_(C.confEligible_() === false, "a guest is offered no blur control");
  as_("viewer", false);
  assert_(C.confEligible_() === true, "a viewer sees the roster, so it is offered");
  as_("admin", true);
  assert_(C.confEligible_() === true, "…as does an admin");

  // ── 4. The state is stated, in words, in both places ────────────────────
  as_("admin", true);
  C.setConfidential_(false);
  var off = C.confBtnHtml_();
  assert_(/Blur names/.test(off), "off: the button says what it will do");
  assert_(/aria-pressed="false"/.test(off), "…and reports its state");
  assert_(C.confBannerHtml_() === "", "…with no banner while nothing is blurred");
  C.setConfidential_(true);
  var on = C.confBtnHtml_();
  assert_(/Names blurred/.test(on), "on: the button states the MODE");
  assert_(/aria-pressed="true"/.test(on), "…and reports it");
  assert_(/class="btn confBtn on"/.test(on), "…and carries the armed style");
  var banner = C.confBannerHtml_();
  assert_(/Names and job titles are blurred/.test(banner), "on: the Executive tab carries a banner");
  assert_(/Every KPI, chart and tab is unchanged/.test(banner),
          "…which says what is NOT affected, so nobody goes looking for a missing number");
  assert_(/not a security control/.test(banner),
          "…and refuses to overclaim: the names are still in the page source");
  assert_(/setConfidential_\(false\)/.test(banner), "…with a way back out of it");

  // ── 5. A RESTORED session blurs from the first paint ────────────────────
  // confLoad_ runs at boot and must apply the body class itself. Without this,
  // a reload with the mode saved restores the flag and leaves the names legible
  // until somebody toggles — the one moment the feature exists for, and the one
  // nobody would think to check by hand.
  var applied = null;
  var realBody = document.body;
  document.body = { className: "", classList: {
    add: function (c) { applied = "add:" + c; },
    remove: function (c) { applied = "remove:" + c; } } };
  try {
    localStorage.setItem("dhConfidential", "1");
    C.confLoad_();
    assert_(applied === "add:confOn",
            "a saved confidential session applies the blur class at load, not on first toggle");
    localStorage.setItem("dhConfidential", "0");
    C.confLoad_();
    assert_(applied === "remove:confOn", "…and a saved OFF state clears it");
  } finally {
    document.body = realBody;
  }

  // ── 6. piiHtml_ escapes its own input ───────────────────────────────────
  // It is the escape boundary — every call site hands it a RAW roster string.
  var eviljs = C.piiHtml_('<img src=x onerror=alert(1)>');
  assert_(eviljs.indexOf("<img") === -1, "a name is escaped inside the blur wrapper");
  assert_(eviljs.indexOf("&lt;img") !== -1, "…as escaped text, not dropped");
  assert_(/^<span class="pii">/.test(eviljs), "…and carries the class the blur keys off");

  // Teardown: the switch is persisted, so leaving it on would scope every
  // block after this one.
  C.setConfidential_(false);
  as_("admin", true);
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// DRILL-DOWN: IN-CELL BARS, CLICK-TO-FILTER, AVAILABILITY (2026-08-17)
// ══════════════════════════════════════════════════════════════════════════
(function () {
  fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  C.renderAll_();

  // ── 1. AVAILABILITY RATE BREAKS DOWN, AND DOES SO HONESTLY ──────────────
  // Asked for as a fourth column (2026-08-17). It was withdrawn once on
  // evidence — wfAvailability_ reads the server's per-CELL fold, which cannot
  // scope, so every row printed the same org figure — and then delivered by
  // folding the SAME measure from the per-person weeks the payload already
  // carries. availabilityFor_ uses w.cap and w.planned: the very fields
  // buildCapacity_ and buildCommitment_ sum server-side.
  assert_(C.liveMetrics_().indexOf("avail") !== -1, "Availability Rate is offered as a lens");
  assert_(C.GRID_METRIC_IDS_.indexOf("avail") !== -1, "…and as a drill-down column");
  assert_(els.comparePanel.innerHTML.indexOf("Availability Rate") !== -1,
          "…and renders as a column header");

  // THE CHECK THE WHOLE FEATURE RESTS ON: it must actually scope. A column that
  // repeats one org number down every row is not a breakdown, and that is
  // precisely what the first attempt produced.
  (function () {
    var m = model({});
    m.people = [
      person("A pair", { region: "AMER" }), person("A two", { region: "AMER" }),
      person("E solo", { region: "EMEA" }),
    ];
    // AMER: 80 cap, 20 planned → 75% free. EMEA: 40 cap, 36 planned → 10% free.
    var W = WEEKS[WEEKS.length - 1];
    m.people.forEach(function (p) {
      p.pool = "PS-CONSULT"; p.cell = "PS-CONSULT|CORE"; p.band = "CORE";
      p.weeks = {}; p.weeks[W] = { cap: 40, avail: 40, planned: p.region === "AMER" ? 10 : 36,
                                   effPlanned: 0, tracked: 0, trackedOff: 0, billable: 0,
                                   nonBillable: 0, availCov: 40, capCov: 40, trackedCov: 0 };
    });
    fresh(m);
    var isos = [W];
    var all = C.availabilityFor_(isos);
    assert_(all.gross === 120 && all.committed === 56,
            "the fold sums w.cap and w.planned — the same fields the server folds");
    var amer = {}; amer["A pair"] = 1; amer["A two"] = 1;
    var emea = {}; emea["E solo"] = 1;
    var vA = C.scopedMetric_(C.METRICS_.avail, isos, amer);
    var vE = C.scopedMetric_(C.METRICS_.avail, isos, emea);
    assert_(Math.abs(vA - 75) < 1e-9, "AMER folds to 75% free — got " + vA);
    assert_(Math.abs(vE - 10) < 1e-9, "EMEA folds to 10% free — got " + vE);
    assert_(vA !== vE,
            "…so the column genuinely BREAKS DOWN. This is the check that failed on the " +
            "first attempt, when every row printed the same org figure.");

    // The carves match the server's, or the column disagrees with the card.
    m.people[2].onBench = true;
    C.setModel(m);
    var noBench = C.availabilityFor_(isos);
    // Benched crew are already out via filteredPeople_'s population gate, so
    // this passes whether or not the fold repeats the carve. Kept because the
    // NUMBER is what matters to the reader, and it must be 80 by either route.
    assert_(noBench.gross === 80, "benched crew are not in the fold, by either gate");
    m.people[2].onBench = false;
    m.people[2].pool = "PMO"; m.people[2].cell = "PMO|CORE";
    C.setModel(m);
    assert_(C.availabilityFor_(isos).gross === 80,
            "…and a non-consuming pool is excluded, as the consumers-only rule requires");
  })();

  // The card still routes to Workforce, which is where the per-pool detail is.
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
  var t1a = document.getElementById("tier1Tiles").innerHTML;
  assert_(/switchView_/.test(tileSeg_(t1a, "Availability Rate")),
          "the Availability card still deep-links to Workforce");

  // ── 2. IN-CELL MICRO-BARS ───────────────────────────────────────────────
  C.renderCompare_();
  cmp = els.comparePanel.innerHTML;
  assert_((cmp.match(/class="cellBar"/g) || []).length > 0, "graded cells carry a micro-bar");
  assert_(/class="cellBar" aria-hidden="true"/.test(cmp),
          "…which is aria-hidden — the number beside it is the accessible value");
  // The bar takes the RAG the glyph already states, never its own verdict.
  var good = C.gridCellHtml_({ value: 95, n: 20, target: { green: 85, amber: 70 }, unit: null });
  var bad = C.gridCellHtml_({ value: 40, n: 20, target: { green: 85, amber: 70 }, unit: null });
  assert_(/--c-good/.test(good) && /--c-bad/.test(bad),
          "the bar's colour follows the cell's own RAG");
  assert_(/width:95\.0%/.test(good), "a percentage bar runs against 0–100, not a rescaled column max");
  // Ungraded cells keep a NEUTRAL bar — colour is a verdict, and a small-n row
  // has none. This is the check that stops the bar becoming a back door for
  // grading a population the cell itself refuses to grade.
  // A cell with NO agreed target carries no verdict, so its bar must not imply
  // one. (The old small-n ungraded branch was removed on 2026-08-17 when small
  // groups began grading like everyone else — this is where the colour ban
  // still lives.)
  var noTgt = C.gridCellHtml_({ value: 40, n: 20, target: null, unit: null });
  assert_(/--c-ref/.test(noTgt) && !/--c-bad|--c-good|--c-warn/.test(noTgt),
          "a target-less cell's bar is neutral — colour is a verdict, and there is none");
  // A unit metric with no column max draws NO bar rather than inventing a
  // denominator to scale against.
  var noMax = C.gridCellHtml_({ value: 12, n: 20, target: null, unit: "days" });
  assert_(!/cellBar/.test(noMax), "a unit metric with no column max draws no bar");
  var withMax = C.gridCellHtml_({ value: 12, n: 20, target: null, unit: "days", max: 24 });
  assert_(/width:50\.0%/.test(withMax), "…and sizes against the column max when given one");

  // ── 3. CLICK-TO-FILTER FROM THE KPI CARDS ───────────────────────────────
  C.setState("metric", "onTime");
  C.renderAll_();
  var t1 = document.getElementById("tier1Tiles").innerHTML;
  // THREE, not four: Availability has no breakdown to select (block 1), and a
  // card that highlights itself while changing nothing below is worse than one
  // that never invited the click.
  assert_((t1.match(/tileDrill/g) || []).length === 4,
          "all four Tier-1 cards are drill controls — every KPI has a breakdown below");
  assert_(/tileDrill/.test(tileSeg_(t1, "Availability Rate")),
          "…including Availability, now that it genuinely breaks down"); 
  assert_(/role="button"/.test(t1) && /tabindex="0"/.test(t1),
          "…keyboard-reachable, not mouse-only");
  assert_((t1.match(/aria-pressed="true"/g) || []).length === 1,
          "exactly one card reports itself selected");
  assert_((t1.match(/tileSel/g) || []).length === 1, "…and exactly one is highlighted");
  // Clicking re-points the grid.
  C.setMetric_("quality");
  assert_(C.STATE.metric === "quality", "clicking a card selects its metric");
  C.renderAll_();
  var t1b = document.getElementById("tier1Tiles").innerHTML;
  assert_(/aria-pressed="true"/.test(tileSeg_(t1b, "Quality / Rework")),
          "…and the clicked card is the selected one");
  assert_(!/aria-pressed="true"/.test(tileSeg_(t1b, "On-Time Delivery")),
          "…while the previously selected card is released");

  // ── 4. OFFENDER ROWS ────────────────────────────────────────────────────
  // Rows below the ACTIVE metric's target are marked, never reordered — the
  // ranking is capRows_'s job, and two things moving at once reads as a jump.
  (function () {
    var m = model({});
    m.people = [person("A1", { region: "AMER" }), person("E1", { region: "EMEA" })];
    for (var i = 2; i <= 12; i++) m.people.push(person("A" + i, { region: "AMER" }));
    for (var j = 2; j <= 12; j++) m.people.push(person("E" + j, { region: "EMEA" }));
    var W = WEEKS[WEEKS.length - 1];
    m.onTimeBuckets = m.people.map(function (p) {
      var onTime = p.region === "AMER" ? 4 : 19;   // AMER 20%, EMEA 95%
      return { iso: W, person: p.name, n: 20, onTime: onTime, nAll: 20 };
    });
    fresh(m);
    C.setState("metric", "onTime");
    C.STATE.compare = "region";
    C.renderCompare_();
    var h = els.comparePanel.innerHTML;
    var amerRow = h.split("AMER")[0];
    assert_(/rowOffender/.test(h), "a region below the target is marked as an offender");
    assert_((h.match(/rowOffender/g) || []).length === 1,
            "…only the failing one — EMEA at 95% is not marked");
    assert_(/offMark/.test(h), "…with a glyph, so the mark is not colour alone (FR-4.4)");

    // ── ROWS ARE CONTROLS (user 2026-08-17) ──────────────────────────────
    // Clicking a row selects its category: active state on the row, the
    // dimension's universal filter set, and the drill buttons inheriting the
    // slice. Toggle semantics: a second click clears it.
    assert_(/drillRowPick_\(/.test(h), "grid rows carry the row-click handler");
    assert_(!/rowActive/.test(h), "no row is active before a click");
    // Rows rank by value, best first: EMEA (95%) is index 0, AMER (20%) is 1.
    C.drillRowPick_(1);
    var h2 = els.comparePanel.innerHTML;
    assert_(C.STATE.region === "AMER",
            "clicking a row sets the dimension's own universal filter");
    assert_((h2.match(/rowActive/g) || []).length === 1, "…exactly one row highlights");
    assert_(/rowOffender rowActive/.test(h2),
            "…and it is AMER — the offender row — that carries the active state");
    assert_((h2.match(/aria-pressed="true"/g) || []).length === 1,
            "…announced via aria-pressed, never colour alone");
    assert_(/Who is available →[^<]*AMER/.test(h2),
            "…and the Workforce button inherits the slice from the clicked row");
    assert_(/95%/.test(h2),
            "…while the unselected row keeps its value — selecting AMER must not " +
            "blank EMEA or reshuffle the ranking under the click");
    C.drillRowPick_(1);
    assert_(C.STATE.region === "",
            "clicking the active row again clears the selection");
    assert_(!/rowActive/.test(els.comparePanel.innerHTML),
            "…and the highlight goes with it");
  })();

  // ── 5. THE DEEP LINK NAMES THE SLICE IT CARRIES ─────────────────────────
  fresh(model({}));
  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  C.drillPick_("region", "AMER");
  var d = els.comparePanel.innerHTML;
  assert_(/Who is available →[^<]*AMER/.test(d),
          "the Workforce deep link names the slice on the BUTTON, not only in its tooltip");
  assert_(/What needs action →[^<]*AMER/.test(d), "…and so does the Actions one");
  assert_(C.STATE.region === "AMER",
          "the filter really is applied, so the destination tab opens narrowed");
  // On a delivery lens the Actions route leads, and neither is dressed primary.
  assert_(d.indexOf("What needs action") < d.indexOf("Who is available"),
          "on a delivery lens the Actions route leads");
  assert_(!/btnPrimary/.test(d), "…and neither is dressed as primary");

  // Teardown.
  C.drillPick_("region", "");
  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

// ══════════════════════════════════════════════════════════════════════════
// ROSTER COLUMN ORDER — HEADER AND CELLS MOVE TOGETHER (2026-08-17)
//
// ROSTER_COLS_ key order drives the HEADER. The row cells are written out by
// hand in renderRoster_. Nothing in the code forces the two to agree, and when
// they disagree every value shifts one column left under a header that still
// reads correctly — a table that is wrong in a way a screenshot preserves and
// a reader cannot detect. Overall was moved from last to second; this is the
// check that the cells came with it.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  // The roster needs a personHygiene payload — the base fixture has none and
  // renders its "not in this payload" state, which has no header to check.
  var mR = model({});
  mR.personHygiene = {
    open: [{ person: "Ana Perez", n: 10, due: 3, est: 10, logged: 9 },
           { person: "Ben Ortiz", n: 12, due: 12, est: 12, logged: 12 }],
    resolved: [],
  };
  mR.meta.signalMinN = 4;
  fresh(mR);
  C.getModel().viewerRole = "admin";
  C.setState("view", "actions");
  C.setState("typePop", "open");
  C.renderAll_();
  var h = els.rosterPanel.innerHTML;
  var headRow = h.slice(h.indexOf("<tr>"), h.indexOf("</tr>"));
  var headers = (headRow.match(/<th[^>]*>[\s\S]*?<\/th>/g) || []).map(function (t) {
    return t.replace(/<[^>]*>/g, "").replace(/[▾▴]/g, "").trim();
  });
  assert_(headers.length > 4, "sanity: the roster rendered a header row");
  assert_(/^Person/.test(headers[0]), "column 1 is the person");
  assert_(/^Overall/.test(headers[1]),
          "column 2 is Overall — the verdict sits beside the name, not eight columns away");

  // The CELL in position 2 must be the overall grade, not the issue count.
  // Body rows carry attributes, so anchor on </thead> and take everything up to
  // the first row close rather than matching a bare "<tr>".
  var afterHead = h.slice(h.indexOf("</thead>"));
  var firstRow = afterHead.slice(0, afterHead.indexOf("</tr>"));
  var cells = firstRow.split("<td").slice(1);
  assert_(cells.length === headers.length,
          "every header has exactly one cell — got " + cells.length + " cells for " +
          headers.length + " headers");
  assert_(/sigDot/.test(cells[1]),
          "cell 2 carries the overall grade dot — header and cells moved together");
  assert_(!/sigDot/.test(cells[0]), "…and cell 1 is still the name, not a grade");
  // The count that used to be second must now be third, or the cells shifted
  // without the header.
  assert_(/^Open issues|^Resolved|^Issues/.test(headers[2]),
          "column 3 is the issue count, which Overall displaced");

  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

console.log("✅ render-smoke: " + checks + " checks passed");
