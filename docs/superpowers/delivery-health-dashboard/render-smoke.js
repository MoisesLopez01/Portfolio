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
                  addEventListener: function () {}, localStorage: { getItem: function () { return null; }, setItem: function () {} } };
global.localStorage = global.window.localStorage;
global.navigator = { userAgent: "node" };
global.setTimeout = function () { return 0; };
global.clearTimeout = function () {};
// google.script.run is chainable and never resolves — loadData() at the bottom
// of the script fires once and we drive the render ourselves.
var runStub = new Proxy({}, { get: function () { return function () { return runStub; }; } });
global.google = { script: { run: runStub, host: { close: function () {} } } };

// ── Load the client ─────────────────────────────────────────
var html = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
var m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) throw new Error("❌ render-smoke: could not find the inline <script> block");
var bridge = "\n;({ setModel: function (x) { MODEL = x; }, getModel: function () { return MODEL; }," +
             " setState: function (k, v) { STATE[k] = v; }, STATE: STATE," +
             " renderTiles_: renderTiles_, renderHygPanel_: renderHygPanel_, gapsRows_: gapsRows_," +
             // A solved check retires itself from all three surfaces (2026-08-06).
             " gapsRetired_: gapsRetired_, gapsSolvedHtml_: gapsSolvedHtml_, gapRetired_: gapRetired_," +
             " typeFieldRetired_: typeFieldRetired_, typeFieldsShown_: typeFieldsShown_," +
             " hygieneFor_: hygieneFor_, hygienePeopleFor_: hygienePeopleFor_," +
             // 🌊 Flow view (spec 2026-08-05) — render-smoke is the only place
             // its grammar, absence and degradation rules can be pinned down.
             " renderFlow_: renderFlow_, flowOpenFor_: flowOpenFor_, flowMedian_: flowMedian_," +
             // 🧬 by-type matrix (2026-08-04) — impact ordering and the
             // "gates nothing today" marking only exist in rendering.
             " typeMatrixHtml_: typeMatrixHtml_, typeImpact_: typeImpact_," +
             " typeHygRows_: typeHygRows_, setTypePop_: setTypePop_, TYPE_FIELDS_: TYPE_FIELDS_," +
             " typeFieldN_: typeFieldN_," +
             " personSignalRows_: personSignalRows_, signalSummary_: signalSummary_, SIGNAL_FIELDS_: SIGNAL_FIELDS_," +
             " metricConfidence_: metricConfidence_, pngPeriodStamp_: pngPeriodStamp_," +
             // Navigation, cascading filters, operating rate, charts and the two
             // new views — all client-only, so render-smoke is the only place
             // their rules can be pinned down.
             " switchView_: switchView_, buildFilters_: buildFilters_," +
             " optionsFor_: optionsFor_, passesFilters_: passesFilters_," +
             " filteredPeople_: filteredPeople_, renderFilterWarn_: renderFilterWarn_," +
             " standardRate_: standardRate_, stdFor_: stdFor_," +
             " hbarChart_: hbarChart_, sparkHtml_: sparkHtml_," +
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
             " hoursCellHtml_: hoursCellHtml_, rosterDetailRow_: rosterDetailRow_, toggleRosterDetail_: toggleRosterDetail_," +
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
             " assignedClearRate_: assignedClearRate_ })";
var C = eval(m[1] + bridge);

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
                         weeks: { "2026.W30": week(), "2026.W31": week() } }, o || {});
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
        },
        changeLog: [{ version: "1.0", date: "2026-08-03", author: "A", affects: ["forecast"],
                      change: "band", rationale: "why" }],
      },
    },
    people: [person("Ana Perez"), person("Ben Ortiz")],
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
        // work is always expected to carry its cost.
        return { iso: iso, type: "Go-live epic", isEpic: true, gatesOnTime: true,
                 gatesForecast: true, n: 5, due: 5, assigned: 5, attr: 4, est: 3, time: 2,
                 timeN: 5,
                 region: 0, team: 0, keys: { attr: ["R-1"], est: ["R-2", "R-3"] }, keysCapped: {} };
      }),
      open: [
        // 4 of 12 due dates missing, and it gates On-Time → 21 fixable gaps here
        // (4 due + 0 assigned + 2 attr + 10 est + 5 time … impact is what sorts).
        // `timeN: 5` — only 5 of the 12 have STARTED (schema v24), so the Logged
        // column contributes 5 fixable gaps, not 12. The other 7 are tickets
        // nobody has picked up: no worklog is expected on them yet.
        { iso: "", type: "Go-live epic", isEpic: true, gatesOnTime: true, gatesForecast: true,
          n: 12, due: 8, assigned: 12, attr: 10, est: 2, time: 0, timeN: 5, region: 0, team: 0,
          keys: { due: ["G-1", "G-2", "G-3", "G-4"], attr: ["G-5", "G-6"],
                  est: ["G-7"], time: ["G-8"] }, keysCapped: { time: true } },
        // Big, badly filled, but gates NOTHING today — must not outrank the epics.
        { iso: "", type: "Sub-task", isEpic: false, gatesOnTime: false, gatesForecast: false,
          n: 300, due: 30, assigned: 300, attr: 300, est: 5, time: 5, timeN: 40,
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

function tiles(mdl) {
  fresh(mdl);
  C.renderTiles_();
  return els.tiles.innerHTML;
}

// ── 1. Well-attributed data publishes ───────────────────────
var good = tiles(model({ otCov: 0.95, fcCov: 0.92 }));
assert_(/On-Time Delivery/.test(good), "on-time tile rendered");
// The confidence chip is GONE from the four KPI cards (user 2026-08-05:
// data-quality noise — the Data trust strip on the same view carries
// coverage-vs-gate). The chip survives only on the compact flow tiles,
// which render into #flowTiles, not into this element.
assert_(!/confidence/.test(good) && !/attributed/.test(good),
        "no confidence chip on the four KPI cards (user 2026-08-05)");
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
// Slice ends at the NEXT card's label: the suppressed tile used to end with
// the "What's missing →" link's </div></div>, which is gone (2026-08-05).
var forecastCard = bad.split("Forecast Accuracy")[1].split("Utilization")[0];
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
var dead = tiles(noNs);
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
C.renderTiles_();
var stale = els.tiles.innerHTML;
assert_(/trend suppressed — data stale/.test(stale), "stale model suppresses the sparkline");
assert_(!/vs prior/.test(stale), "stale model prints no period-over-period delta");
assert_(/pts (above|below) target/.test(stale),
        "target gap survives staleness — it isn't a comparison across refreshes");
assert_(/class="tgt"/.test(stale), "…as does the target chip beside the hero");

// ── 5. Data Hygiene view ────────────────────────────────────
C.setModel(model({}));
C.renderHygPanel_();
var hyg = els.hygPanel.innerHTML;
// The "Delivery work fully attributed" KPI tile was DELETED (user decision
// 2026-08-04) — the gaps table below carries the per-component read.
assert_(!/Delivery work fully attributed/.test(hyg), "hygiene KPI tile deleted (user 2026-08-04)");
assert_(/Region tagged on delivery work/.test(hyg), "region gap listed");
// Prereq + Target-week columns removed (user decision 2026-08-04), same rule
// as the Owner column (2026-08-03): accountability and scheduling live in the
// requirements doc, not in a widely-read table.
assert_(!/<th>Prereq<\/th>/.test(hyg) && !/<th>Target week<\/th>/.test(hyg),
        "no Prereq / Target-week columns in the hygiene table");
assert_(!/<th>Owner<\/th>/.test(hyg), "no Owner column in the hygiene table");
assert_(!/Gon/.test(hyg) && !/Tempo admin/.test(hyg), "no owner names rendered in the gap rows");
assert_(/not connected/.test(hyg), "feeds that don't exist say so instead of showing 0%");
assert_(/✖|▲|✔/.test(hyg), "status readable without colour (FR-4.4)");
assert_(!/Ana Perez/.test(hyg), "no named individual in the hygiene view (P6)");

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

// ── 5b. The view must SAY which window it covers — and the window is the
// GLOBAL analysis-period picker (2026-08-04: universal filters; the view's
// own ◀ ▶ / Σ stepper is gone).
assert_(/Every figure above covers/.test(hyg), "the view states its own window");
assert_(/2026\.W31/.test(hyg), "window label names the period (weekly framing here)");
assert_(!/setHygIdx_/.test(hyg), "no per-view stepper — the header picker is the one control");
assert_(!/Σ All history/.test(hyg), "no per-view whole-window rollup either");
assert_(/window follows the header period picker/.test(hyg),
        "says exactly which control owns the window");

// The GLOBAL picker re-bases this view exactly like the tiles.
C.setState("periodIdx", 0);
C.renderHygPanel_();
var older = els.hygPanel.innerHTML;
assert_(/2026\.W30/.test(older), "picking the earlier period re-bases the hygiene window");
C.setState("periodIdx", null);

// ── 6. Empty scope is not the same as bad data ──────────────
var empty = model({});
empty.onTimeBuckets = []; empty.forecastBuckets = [];
var none = tiles(empty);
assert_(/On-Time Delivery/.test(none), "empty buckets still render a card");
assert_(!/Not yet measurable/.test(none),
        "nothing in scope is NOT a coverage failure — a quiet week must not read as bad data");
assert_(/no resolved delivery items in this period/.test(none), "the empty card says why it's empty");
assert_(/no epics closed in this period/.test(none), "forecast empty state names its own unit");

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
// (Task 3, §5) — three tabs remain: Executive, Actions, Access.
assert_(els.tabBar.children.length === 3, "an admin sees all three tabs");
C.switchView_("exec");
assert_(els.viewExec.style.display === "" && els.viewActions.style.display === "none",
        "and switching back hides the other");
assert_(/\bpaneIn\b/.test(els.viewExec.className) && !/\bpaneIn\b/.test(els.viewActions.className),
        "…and paneIn moves with it — re-entering a pane restarts the cross-fade, not a stale class");
var mdlV = fresh(histModel({}));
mdlV.viewerRole = "viewer";
C.switchView_("exec");
assert_(els.tabBar.children.length === 2, "a viewer does not get the Access tab");
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
var dict = tiles(model({ otCov: 0.95, fcCov: 0.92 }));

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
var withOff = tiles(offModel);
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
  C.renderTiles_();
  return els.tiles.innerHTML;
}
var asAdmin = asRole("admin");
var asViewer = asRole("viewer");
var asGuest = asRole("guest");

assert_(/Billable Utilization|Capacity Utilization/.test(asAdmin), "admin sees utilization");
assert_(/Forecast Accuracy/.test(asAdmin), "admin sees forecast");
assert_(/Billable Utilization|Capacity Utilization/.test(asViewer),
        "a NAMED viewer is a direct and stays in the margin tier");

// The gate: absent from the DOM, not greyed. A dimmed number is still a number
// on a projector, and "greyed out" invites someone to ask what it says.
assert_(!/Utilization/.test(asGuest), "a guest does not see utilization AT ALL");
assert_(!/Forecast Accuracy/.test(asGuest), "…nor forecast accuracy");
assert_(!/opacity|\.ph|disabled/.test(asGuest.split("Quality")[0] || ""),
        "…and they are omitted from the string, not rendered-then-dimmed");
// The two non-margin metrics still answer their questions for everyone.
assert_(/On-Time Delivery/.test(asGuest), "a guest still sees On-Time");
assert_(/Quality \/ Rework/.test(asGuest), "…and Quality/Rework");

// The metric must leave every chip strip and comparison chart too, or the guest
// can select a hidden metric and read it off the bars instead.
C.setModel(fresh(model({}))); C.getModel().viewerRole = "guest";
assert_(C.liveMetrics_().indexOf("util") === -1 && C.liveMetrics_().indexOf("forecast") === -1,
        "hidden metrics are not offered in the metric chips or the comparison chart");
assert_(C.liveMetrics_().length >= 1, "…but the chart still has something to show");
assert_(!C.canSeeMargin_(), "guest is out of tier");
C.getModel().viewerRole = "admin";
assert_(C.canSeeMargin_() && C.liveMetrics_().indexOf("util") !== -1, "admin gets them back");

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
// 20. THE ASSIGNEE GAP IS TWO GAPS (2026-08-03, from real-export profiling)
// 94% of resolved issues carry an assignee; only ~54% of those join the roster.
// Reported as one "unattributed" number it read as a Jira hygiene failure and
// went to the Jira admin queue, where there was nothing to fix.
// ══════════════════════════════════════════════════════════════════════════
C.setModel(model({}));
C.renderHygPanel_();
var hyg2 = els.hygPanel.innerHTML;
assert_(/Resolved work carries a Jira assignee/.test(hyg2), "gap 1: does the issue have an assignee at all");
assert_(/and that assignee resolves to a roster person/.test(hyg2), "gap 2: does that name join the roster");
assert_(/94%/.test(hyg2), "…47 of 50 carry an assignee");
assert_(/2 of 47 named assignees do not match the roster/.test(hyg2),
        "…and the join is measured against the ASSIGNED population, not the whole one — " +
        "dividing by all 50 would blame Jira for a name-matching problem");
assert_(/not by Jira admin/.test(hyg2), "…the row says explicitly who cannot fix it");
// The due-date row must name the population it measures, not say "delivery work"
// when the scope is epics.
assert_(/Due date on the work On-Time measures/.test(hyg2), "the due-date row names its own population");
assert_(!/Due date on resolved delivery work/.test(hyg2),
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
var latestOt28 = els.tiles.innerHTML.split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/class="big[^"]*">90%/.test(latestOt28),
        "latest window (W31) reads 90% on time — 43 of 48");
C.setState("periodIdx", 0);
C.renderAll_();
assert_(/Selected week · 2026\.W30/.test(els.scopeChip.innerHTML),
        "picker selection re-frames the scope chip as 'Selected'");
var selOt28 = els.tiles.innerHTML.split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/class="big[^"]*">100%/.test(selOt28),
        "…and the numbers re-base with it (W30 fixture = 100% on time)");
assert_(!/unattributed \(export window\)/.test(els.tiles.innerHTML),
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
var fteTiles = (C.renderAll_(), els.tiles.innerHTML);
els.popChips.children[1].onclick();   // click the Crew chip
var crewRegions = els.regionChips.children.map(function (c) { return c.textContent; }).join("|");
assert_(/AMER 2/.test(fteRegions), "FTE lens: two FTEs count in AMER");
assert_(/AMER 1/.test(crewRegions), "Crew chip click re-cascades the region counts (Cara only)");
assert_(fteRegions !== crewRegions, "the filter row follows the population lens");
assert_(els.tiles.innerHTML !== fteTiles, "…and the tiles re-base in the same click");
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
fresh(model({ otCov: 0.95, fcCov: 0.92 }));
C.renderTiles_();
var tk = els.tileColorKey.innerHTML;
assert_(/Colour key — each value is judged against/.test(tk),
        "the executive cards carry a colour key");
assert_(/own<\/b> FY27 target/.test(tk),
        "…that says each card grades against its OWN target, since thresholds differ per metric");
assert_(/lower is better/.test(tk), "…and names the Rework Rate inversion");

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
C.renderHygPanel_();
assert_(/graded against its <b>own gate<\/b>, never against 100%/.test(els.hygPanel.innerHTML),
        "the hygiene table says coverage colours grade against the gate, not 100%");

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
var internTiles = tiles(internM);
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

// ── 🧬 FIELD FILL BY ISSUE TYPE (spec 2026-08-04) ───────────
// The two failures worth guarding: a matrix that grades a type against a metric
// it does not feed (sends people to fix records that move nothing), and one that
// ranks by worst percentage (buries four epics under three hundred sub-tasks).
(function () {
  // Read from the client rather than restated here, so adding a field to the
  // matrix can never leave this suite asserting an out-of-date column count.
  var TYPE_FIELD_COUNT = C.TYPE_FIELDS_.length;
  var mdl = fresh(model({}));
  C.STATE.period = "week";
  C.STATE.typePop = "open";
  C.renderHygPanel_();
  var h = els.hygPanel.innerHTML;

  assert_(/Field fill by issue type/.test(h), "the by-type matrix renders inside Data Hygiene");
  assert_(/Go-live epic/.test(h) && /Sub-task/.test(h), "each issue type gets its own row");
  assert_(/class="tepic"/.test(h),
          "an epic-family type is tagged as such — being pooled into the epic-grain " +
          "metrics is the finding this table exists to expose");

  // OPEN is the default population: it is the half anyone can act on.
  assert_(/Open backlog/.test(h), "the open-backlog population is offered");
  assert_(/Snapshot at the last export/.test(h), "…and is the default view");
  assert_(/Not affected by the period picker/.test(h),
          "the open matrix says it ignores the period picker — a backlog has no history");

  // IMPACT ORDERING: 12 Go-live epics must outrank 300 badly-filled Sub-tasks.
  // Anchored on the ROW markup, not a bare substring — both type names also
  // appear in the colour-key caption above the table, and a loose indexOf
  // matched that instead (same trap as the 2026-08-03 `/64%/` false positive).
  var iGolive = h.indexOf('<td class="tname"><b>Go-live epic</b>');
  var iSub = h.indexOf('<td class="tname"><b>Sub-task</b>');
  assert_(iGolive > -1 && iSub > -1, "both type rows rendered");
  assert_(iSub > iGolive,
          "ordered by fixable gaps on metric-gating fields — 12 epics beat 300 sub-tasks");
  var rows = C.typeHygRows_([]);
  var golive = rows.filter(function (r) { return r.type === "Go-live epic"; })[0];
  var sub = rows.filter(function (r) { return r.type === "Sub-task"; })[0];
  assert_(C.typeImpact_(golive) > C.typeImpact_(sub),
          "impact counts only fields that gate a published metric for that type");
  assert_(C.typeImpact_(sub) === 0,
          "a Sub-task's 270 missing due dates score ZERO impact — they gate nothing today");

  // The marking that stops a pointless campaign.
  assert_(/gates no published metric for this type today/.test(h),
          "the colour key explains what '—' means");
  assert_(/class="tnum tcell n"/.test(h),
          "a non-gating cell is rendered muted, not as a red failure");

  // PR-01 / uniform columns. Region and Team read 0% on every row, so grading
  // them paints two red cells per row and the real per-type findings drown.
  // A column identical across every type carries no per-type information —
  // it is shown ungraded and footnoted as ONE org-wide gap.
  assert_(/PR-01/.test(h), "the uniform column names its prereq");
  assert_(/one org-wide field gap/.test(h), "…framed as one gap, not one per type");
  assert_(/starts grading itself again the moment it varies/.test(h),
          "the muting is data-driven and self-healing, not a hardcoded exemption");
  // The rule is computed from the data: a column that VARIES must still grade.
  var varied = fresh(model({}));
  varied.typeHygiene = { keyCap: 500, resolved: [], open: [
    { iso: "", type: "Alpha", isEpic: true, gatesOnTime: true, gatesForecast: true,
      n: 10, due: 10, assigned: 10, attr: 10, est: 10, time: 10, region: 10, team: 10,
      keys: {}, keysCapped: {} },
    { iso: "", type: "Beta", isEpic: true, gatesOnTime: true, gatesForecast: true,
      n: 10, due: 10, assigned: 10, attr: 10, est: 10, time: 10, region: 0, team: 5,
      keys: { region: ["B-1"] }, keysCapped: {} },
  ] };
  C.STATE.typePop = "open";
  C.renderHygPanel_();
  var hvar = els.hygPanel.innerHTML;
  assert_(/<td class="tnum tcell r"><div class="tval">✖ 0%/.test(hvar),
          "a Region column that VARIES by type is graded normally — PR-01 is not an exemption");
  assert_(!/one org-wide field gap/.test(hvar),
          "…and the uniform footnote does not appear when the column varies");
  fresh(mdl);
  C.STATE.typePop = "open";
  C.renderHygPanel_();
  h = els.hygPanel.innerHTML;

  // Miss counts are the size of the job and must be present, not just percentages.
  assert_(/class="tmiss"/.test(h), "each cell states how many records are missing the field");
  // 21, not 28: the Logged column contributes 5 (the started tickets missing a
  // worklog), not 12 (the whole open row). A fixable count that includes work
  // nobody has begun is a queue that cannot be cleared — see Code.js
  // timeExpected_ and the live measurement in its comment.
  assert_(/21 fixable/.test(h), "each row states its fixable-gap total, scoped per field");

  // Chrome: PNG out, CSV gone (user 2026-08-04).
  assert_(!/CSV/.test(h), "no CSV button on this table");
  assert_(/savePng_\('typeMatrix'/.test(h), "the table can be saved as a PNG");
  assert_(/id="typeMatrix"/.test(h), "…and the capture target wraps the whole panel");
  // Scope every structural assertion to the MATRIX PANEL. `h` is the whole
  // hygiene view and the gaps table sits above this one, so a bare
  // indexOf("<table") finds the wrong table and the assertion silently checks
  // someone else's markup — the same class of false anchor as the "Sub-task"
  // caption match above.
  var hm = h.slice(h.indexOf('id="typeMatrix"'));
  assert_(hm.indexOf("Open backlog") < hm.indexOf("<table"),
          "the population chips are INSIDE the capture — a matrix with no population " +
          "label is unreadable out of context");

  // ALIGNMENT: every column right of the type name is numeric, header included.
  // Left headers over right-aligned values is what made the first cut look
  // broken — each label sat over the gap between two columns, not its own data.
  var thead = hm.slice(hm.indexOf("<table"), hm.indexOf("</tr>", hm.indexOf("<table")));
  assert_(/<th class="tname">Issue type<\/th>/.test(thead), "the type column header stays left");
  assert_((thead.match(/<th class="tnum"/g) || []).length === 1 + TYPE_FIELD_COUNT,
          "every numeric header is right-aligned — n plus all " + TYPE_FIELD_COUNT + " fields");
  assert_(!/<th>/.test(thead), "no unaligned header survives");
  assert_(/class="tnum tcell/.test(h), "…and the cells carry the same alignment class");

  // Each cell gets a fill bar — nine columns of bare percentages have to be read
  // digit by digit. Same labelled-bar idiom as the gaps table and the funnels.
  assert_(/class="tbar"/.test(h), "cells carry a fill bar");
  assert_(/<i class="r" style="width:67%"/.test(h), "…scaled to the fill % and RAG-coloured");
  assert_(/class="tval"/.test(h), "the percentage is its own element, so the bar can sit under it");
  // DARK-MODE COLOUR CHANNEL. --warn and --amber are the SAME hex in dark, which
  // words survive (✔ ▲ ✖ still differ) but a bar cannot — colour is all it has.
  // The bars must use the palette-validated chart tokens. Found by screenshotting
  // dark mode, not by a test; this pins it so it cannot come back.
  var css = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
  var tbarCss = css.slice(css.indexOf(".tbar{"), css.indexOf(".tbar i.n{"));
  assert_(/\.tbar i\.a\{background:var\(--c-warn\)\}/.test(tbarCss) &&
          /\.tbar i\.r\{background:var\(--c-bad\)\}/.test(tbarCss),
          "fill bars use the chart tokens — --warn and --amber are identical in dark mode");
  assert_(!/\.tbar i\.[ar]\{background:var\(--(warn|amber)\)\}/.test(tbarCss),
          "…and never the text tokens");

  // ── LOGGED COLUMN GRADES OVER STARTED WORK ONLY (user report 2026-08-06) ───
  // The Go-live open row is 12 issues, 5 started, 0 with a worklog. The cell must
  // read 0% of 5 — not 0% of 12 — and queue 5 records, not 12.
  var goRow = C.typeHygRows_([]).filter(function (r) { return r.type === "Go-live epic"; })[0];
  var timeField = C.TYPE_FIELDS_.filter(function (f) { return f.k === "time"; })[0];
  assert_(timeField.denom === "timeN", "the Logged column declares its own denominator");
  assert_(C.typeFieldN_(timeField, goRow) === 5,
          "Logged measures the 5 STARTED records, not all 12 open ones");
  assert_(C.typeFieldN_({ k: "due" }, goRow) === 12,
          "…while every other column still measures the whole open row — the carve-out is " +
          "logged-only, or the backlog's missing due dates stop being counted");
  // A pre-v24 row has no timeN. It must read the way that payload measured —
  // over n — rather than dividing by zero and blanking the column for a TTL.
  var legacyRow = { type: "X", n: 12, time: 0 };
  assert_(C.typeFieldN_(timeField, legacyRow) === 12,
          "a row from before the denominator existed falls back to n, not to an ungraded blank");

  // RESOLVED population: follows the period picker and says which window it covers.
  C.setTypePop_("resolved");
  var hr = els.hygPanel.innerHTML;
  assert_(/Resolved in/.test(hr), "the resolved matrix names its window");
  assert_(/where the cards' numbers come from/.test(hr), "…and says what it explains");
  var rres = C.typeHygRows_(["2026.W30", "2026.W31"]);
  assert_(rres.length === 1 && rres[0].n === 10,
          "resolved rows SUM across the selected weeks (5 + 5), not just the latest");
  assert_(rres[0].keys.est.length === 4, "…and their failing-key lists concatenate");
  assert_(C.typeHygRows_(["2026.W31"])[0].n === 5, "a one-week window sums only that week");

  // ALL ROLES — this is a ticket-owner's work queue, unlike the admin-only
  // gate editor below it.
  var viewerMdl = fresh(model({ overrides: { viewerRole: "viewer" } }));
  C.STATE.typePop = "open";
  C.renderHygPanel_();
  var hv = els.hygPanel.innerHTML;
  assert_(/Field fill by issue type/.test(hv), "a viewer sees the by-type matrix");

  // Pre-v17 payload: must SAY it is missing. An empty matrix reads as "no gaps".
  var legacy = fresh(model({}));
  delete legacy.typeHygiene;
  C.renderHygPanel_();
  var hl = els.hygPanel.innerHTML;
  assert_(/Not in this payload/.test(hl),
          "a payload with no typeHygiene says so — silence would read as 'no gaps'");

  // ── ATTRITION IS STATED, NOT HIDDEN, AND NEVER A GAP ROW (v18) ──
  // Excluding a leaver's work makes numbers smaller. A number that quietly got
  // smaller is indistinguishable from a broken feed, so the exclusion is stated;
  // but it is a scoping decision, not something to fix, so it must never appear
  // as a hygiene gap row or someone will open a ticket to chase leavers.
  var lv = fresh(model({}));
  lv.meta.leaverExcluded = { issues: 42, epics: 7 };
  C.renderHygPanel_();
  var hlv = els.hygPanel.innerHTML;
  assert_(/42<\/b> issues by former employees excluded/.test(hlv),
          "the attrition exclusion is stated on the hygiene view");
  assert_(/7 of them epics/.test(hlv), "…with the epic split, since Forecast is epic-grain");
  assert_(/attrition cannot be coached/.test(hlv), "…and says why it is out of scope");
  assert_(!/<td>.*former employees/.test(hlv), "it is NOT a gap row in the table");
  // Silent when there is nothing to say — a permanent "0 excluded" line is noise.
  var lv0 = fresh(model({}));
  lv0.meta.leaverExcluded = { issues: 0, epics: 0 };
  C.renderHygPanel_();
  assert_(!/former employees/.test(els.hygPanel.innerHTML),
          "no note when nothing was excluded");
  var lvNone = fresh(model({}));
  delete lvNone.meta.leaverExcluded;
  C.renderHygPanel_();
  assert_(!/former employees/.test(els.hygPanel.innerHTML),
          "a pre-v18 payload renders no note rather than throwing");

  // Empty feed is not the same as a broken one.
  var empty = fresh(model({}));
  empty.typeHygiene = { resolved: [], open: [], keyCap: 500 };
  C.renderHygPanel_();
  assert_(/No open work in the feed/.test(els.hygPanel.innerHTML),
          "an empty population says so plainly");
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
    { person: "Ana Perez", n: 8, due: 8, est: 8, logged: 5, loggedN: 6 },
    // A full backlog, none of it started. The honest answer is "nothing to
    // grade", not 0% — Ben has not failed to log time against work he has not
    // begun, and a red cell here is a queue nobody can clear.
    { person: "Ben Ortiz", n: 12, due: 12, est: 12, logged: 0, loggedN: 0 },
  ];
  C.setModel(mdl);
  var startedRows = C.personSignalRows_([]);
  var anaS = startedRows.filter(function (r) { return r.p.name === "Ana Perez"; })[0];
  var benS = startedRows.filter(function (r) { return r.p.name === "Ben Ortiz"; })[0];
  assert_(Math.round(anaS.sig.logged.pct * 100) === 83 && anaS.sig.logged.miss === 1,
          "Logged grades 5 of the 6 STARTED issues (83%, 1 missing) — not 5 of 8 (62%)");
  assert_(anaS.sig.due.miss === 0 && anaS.n === 8,
          "…while due/est and the row's n still cover the WHOLE backlog — the carve-out is " +
          "logged-only, or the matrix stops counting the backlog's missing due dates");
  assert_(benS.sig.logged.cls === "na" && benS.sig.logged.pct === null,
          "an all-unstarted backlog reads UNGRADED on Logged, never 0% — nothing was measured");
  assert_(benS.sig.logged.miss === 0 && benS.sig.due.cls === "good",
          "…contributes no missing count, and its other signals grade normally");

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

  // WHOLE-ROW CLICK (user 2026-08-06): a row that only reacts on the name reads
  // as broken — you aim at the number you want explained and nothing happens.
  assert_(/<tr class="rosterRow" onclick="toggleRosterDetail_\('Ana Perez'\)">/.test(roster),
          "the toggle lives on the <tr>, so the whole row is the control");
  assert_(!/<span class="rosterName"[^>]*onclick/.test(roster),
          "…and no longer on the name span alone");
  assert_(/tr\.rosterRow\{cursor:pointer\}/.test(fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8")),
          "…with the pointer cursor on the row to match");

  // SCROLL PRESERVATION (user 2026-08-06). Every toggle rebuilds innerHTML,
  // which resets the .rosterWrap scroller to the top — so opening a row two
  // thirds down threw the reader back to the first name and the table read as
  // though it had reordered itself. The retired People grid carried this guard;
  // adding the capped scroller for the sticky header reintroduced the bug it
  // was written for. Pinned at source, because the stub DOM has no layout and
  // therefore cannot scroll: the read must happen BEFORE the innerHTML
  // assignment and the write AFTER it, or it preserves nothing.
  var rsrc = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
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
  C.toggleRosterDetail_("Ana Perez");
  assert_(/▾ Ana Perez/.test(els.rosterPanel.innerHTML), "an open row's caret points down");
  C.toggleRosterDetail_("Ana Perez");
  assert_(/▸ Ana Perez/.test(els.rosterPanel.innerHTML), "…and back to ▸ when closed");
  var rcss = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
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
  var anaOverallCell = anaRow.slice(anaRow.lastIndexOf("<td"));
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
  var segCss = fs.readFileSync(path.join(__dirname, "Dashboard.html"), "utf8");
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
  assert_(/Iris Intern<\/span><span class="stateBadge" title="Intern/.test(h),
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
  assert_(/Nate New<\/span><span class="stateBadge" title="New hire — joined 2026-06-15/.test(h),
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
  assert_(openHtml.indexOf('colspan="' + Object.keys(C.ROSTER_COLS_).length + '"') !== -1,
          "the detail row's colspan matches the live column count, not a hardcoded 7");
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
  assert_(openHtml.indexOf("Top 2 of 3 open items") !== -1,
          "count (3) > rendered items (2) → the truncation note fires");
  var gtt2Cell = openHtml.split("GTT-2")[1].split("</tr>")[0];
  assert_(gtt2Cell.indexOf("sigBad") !== -1,
          "an item with no due date shows the sigBad em-dash glyph, not a blank cell");

  C.toggleRosterDetail_("Ben Ortiz");   // second click: closes it again
  var closedHtml = els.rosterPanel.innerHTML;
  assert_(closedHtml.indexOf("detailRow") === -1, "toggling the SAME ▸ again closes the drill-down row");

  // Backlog cap note is ABSENT once count no longer exceeds what's shown.
  mdl.people.forEach(function (p) { if (p.name === "Ben Ortiz") p.backlog.count = 2; });
  C.setModel(mdl);
  C.toggleRosterDetail_("Ben Ortiz");
  var noCapHtml = els.rosterPanel.innerHTML;
  assert_(noCapHtml.indexOf("open items (by remaining hours)") === -1,
          "no truncation note once the backlog cap didn't actually truncate anything");
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
  assert_(lines[0] === "Person,Job title,Region,n," + expectSig +
                        ",Overall,Est h,Logged h,Progress %,In progress," +
                        "Billable h,Non-billable work h,Time off h,Idle h,Planned h,Capacity h,State",
          "the header row matches the brief's exact column string");
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
  assert_(ana("n") === "2", "Ana's n is the real count (2), not zeroed by small-n");
  assert_(ana("Due date %") === "50" && ana("Due date missing") === "1",
          "Due %: real 50% (1 of 2), 1 missing — small-n never hides the ratio");
  assert_(ana("Estimate %") === "100" && ana("Estimate missing") === "0", "Estimate %: real 100% (2 of 2), 0 missing");
  assert_(ana("Logged %") === "0" && ana("Logged missing") === "2", "Logged %: real 0% (0 of 2), 2 missing");
  assert_(ana("Overall") === "na", "small-n Overall is 'na' — 'small' never contributes to the worst-rank verdict");

  // Zero-issue person: blank percentages (null, not a fabricated 0%), n = 0.
  var ben = rowFields("Ben Ortiz");
  assert_(ben("n") === "0", "Ben's n is 0");
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
  var h = els["flowTiles"].innerHTML;

  assert_(h.indexOf("Lead Time") !== -1 && h.indexOf("7d") !== -1,
          "lead-time median of [4,10] renders 7d");
  assert_(h.indexOf("p85") !== -1, "p85 companion stated");
  assert_(h.indexOf("Throughput") !== -1 && h.indexOf("2 of 3 resolved issues carried an estimate") !== -1,
          "throughput states its estimated-share coverage in words");
  assert_(h.indexOf("Work In Progress") !== -1 && h.indexOf("3 active items right now") !== -1,
          "WIP counts the fixture's active items");
  assert_(h.indexOf("5 items waiting to start") !== -1, "backlog counts waiting items");
  assert_(h.indexOf("Bug Count") !== -1 && h.indexOf("4") !== -1 &&
          h.indexOf("population-wide") !== -1,
          "bug tile renders the created count and states it is unfiltered");
  // No-target grammar: flow tiles carry NO RAG verdict and NO vs-target line.
  assert_(h.indexOf("below target") === -1 && h.indexOf("above target") === -1 &&
          h.indexOf('class="tgt"') === -1,
          "target: null → no target chip and no vs-target sentence anywhere");
  // Absent placeholders retired (spec 2026-08-05 §4.1): the compact tier must
  // not render Cycle Time / Flow Efficiency "—" tiles.
  assert_(h.indexOf("Cycle Time") === -1 && h.indexOf("Flow Efficiency") === -1,
          "declared-absent flow tiles no longer render");
  assert_(h.indexOf("Lead Time") !== -1, "live flow tiles render inside the exec strip");

  // Regression pin (final review, 2026-08-05): flowUnfiltered_ used to compare
  // filteredPeople_().length to MODEL.people.length, which can never be equal
  // on a real payload — the attribOnly stub (Sol Architect) and the crew
  // person (Cara Crew, excluded by the default FTE lens) pushed onto this
  // fixture above are exactly that shape. Under DEFAULT state — no user
  // filter, default "fte" pop lens — the snapshot trend must still render.
  var backlogTile = h.split("Backlog (Inventory)")[1].split("Work In Progress")[0];
  assert_(backlogTile.indexOf("trend available for the full population only") === -1,
          "default state (nothing narrowed) — the clear-filters note is ABSENT");
  assert_(backlogTile.indexOf('<svg class="chart"') !== -1,
          "…and the sparkline itself IS in the markup (2 fixture snapshots, both weeks)");

  // Set one real filter — the exporter's whole-population snapshot log has no
  // notion of "AMER only", so the trend must now defer to the note.
  C.setState("region", "AMER");
  C.renderAll_();
  var hFiltered = els["flowTiles"].innerHTML;
  var backlogFiltered = hFiltered.split("Backlog (Inventory)")[1].split("Work In Progress")[0];
  assert_(backlogFiltered.indexOf("trend available for the full population only — clear filters to see it") !== -1,
          "a user-set region filter brings back the clear-filters note");
  assert_(backlogFiltered.indexOf('<svg class="chart"') === -1,
          "…and withholds the sparkline while the note is showing");
  C.setState("region", "");
  C.renderAll_();

  // Missing feeds degrade, never error: kill both new feeds and re-render.
  M.meta.bugsAvailable = false;
  M.meta.flowSnapshotsAvailable = false;
  M.meta.flowSnapshots = [];
  C.setModel(M);
  C.renderAll_();
  var h2 = els["flowTiles"].innerHTML;
  assert_(h2.indexOf("export predates Jira Backlog.js v3.9.0") !== -1,
          "absent feeds name the exporter version, not an error");
})();

// ── TASK 10 — COMPARISON CHIPS GAIN THE FLOW METRICS ────────────────────────
// Lead Time and Throughput join METRICS_/METRIC_ORDER_ so the Executive
// comparison chart (and its shared metric chips) can chart them by Region/
// Team/PM/Family — riding the SAME renderCompare_/hbarChart_/scopedMetric_
// mechanism every other metric already uses, per scopedMetric_'s one-
// accessor rule. Backlog/WIP/Bug Count are deliberately excluded (comment on
// METRIC_ORDER_) — no test for them here, there is nothing to render.
(function () {
  var M = fresh(model({}));
  var W = WEEKS[WEEKS.length - 1];             // latest complete week
  // Single-region fixture (both fixture people are AMER) — one bar is enough
  // to pin label/unit/colour grammar without the noise of a second category.
  // median([10,15]) = 12.5 → the exact "12.5d" the task brief's self-review
  // asks for; estHrs 412 → "412h" likewise.
  M.leadTimeBuckets = [{ iso: W, person: "Ana Perez", n: 2, nAll: 2, days: [10, 15] }];
  M.throughputBuckets = [{ iso: W, person: "Ana Perez", nAll: 3, nEst: 2, estHrs: 412 }];
  M.meta.registry.metrics.leadTime = { id: "leadTime", name: "Lead Time", unit: "days",
    target: null, coverageGate: 0.9,
    definition: "Median calendar days from Created to Resolution Date." };
  M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
    target: null, coverageGate: 0.6,
    definition: "Sum of Original Estimate hours delivered in the period." };
  C.setModel(M);
  C.switchView_("exec");
  C.STATE.compare = "region";

  // RED (brief Step 2, literal): before METRICS_/METRIC_ORDER_ carried the two
  // flow entries, activeMetric_ found "leadTime" absent from liveMetrics_() and
  // fell back to onTime — the panel rendered "On-Time Delivery", never "Lead
  // Time", and this assertion failed. It now passes because METRIC_ORDER_
  // includes "leadTime" and METRICS_.leadTime.available() is jiraAvailable.
  C.setState("metric", "leadTime");
  C.renderAll_();
  assert_(document.getElementById("comparePanel").innerHTML.indexOf("Lead Time") !== -1,
          "flow metric charts in the comparison");

  // ── Lead Time: unit label, axis prose, neutral colour, no fabricated % ──
  var cmpLead = els.comparePanel.innerHTML;
  assert_(cmpLead.indexOf("median days created") !== -1,
          "axis states the metric's own prose (m.axis()), not a percent caption");
  assert_(cmpLead.indexOf("Median calendar days from Created") !== -1,
          "the ⓘ tooltip carries the registry definition — chips/axis share reg_()");
  assert_(cmpLead.indexOf("12.5d") !== -1,
          "the bar value label is unit-formatted via fmtFlowVal_, not '12%'");
  assert_(!/>25%</.test(cmpLead) && !/>50%</.test(cmpLead) && !/>100%</.test(cmpLead),
          "grid ticks do not fall back to the 0/25/50/75/100% percent axis for a unit metric");
  assert_(!/target \d/.test(cmpLead),
          "targetKey: null → no target line/label — nothing to draw a verdict against");
  assert_(cmpLead.indexOf('fill="var(--c-series)"') !== -1,
          "the bar renders the NEUTRAL series colour");
  assert_(cmpLead.indexOf('fill="var(--c-good)"') === -1 &&
          cmpLead.indexOf('fill="var(--c-warn)"') === -1 &&
          cmpLead.indexOf('fill="var(--c-bad)"') === -1,
          "…and never a RAG colour — Lead Time is lower-is-better but has no target to grade against");
  assert_(cmpLead.indexOf("•") !== -1, "the neutral glyph (•) marks the value, not a RAG check/triangle/cross");

  // ── Throughput: same grammar, different unit ────────────────────────────
  C.setState("metric", "throughput");
  C.renderAll_();
  var cmpThr = els.comparePanel.innerHTML;
  assert_(cmpThr.indexOf("Throughput") !== -1, "throughput also charts in the comparison");
  assert_(cmpThr.indexOf("412h") !== -1, "…formatted in hours, not '412%' or a bare number");
  assert_(!/>25%</.test(cmpThr) && !/>50%</.test(cmpThr),
          "…and the same percent-axis fallback stays absent for throughput");

  // ── Reviewer regression pin: throughputBuckets_ (Code.js) never populates a
  // `.n` field — only nAll/nEst/estHrs — so coverage()/n() reading `b.n` read
  // undefined, and bucketsFor_'s `out.n += b.n` (no ||0 fallback at the time)
  // turned the accumulator NaN. metricConfidence_ treats NaN as no-data
  // (level: "none", publish: false), so the operating band/verdict silently
  // never drew — headline value was unaffected, which is why the first pass
  // of this test suite missed it. Assert directly against METRICS_ so a
  // future change can't reintroduce `.n` without this failing loudly.
  var thrCov = C.METRICS_.throughput.coverage([W]);
  assert_(typeof thrCov === "number" && isFinite(thrCov),
          "throughput coverage is a real finite number, never NaN (fixture nEst 2 / nAll 3)");
  assert_(Math.abs(thrCov - 2 / 3) < 1e-9,
          "…and equals nEst/nAll exactly — same formula renderFlow_'s throughput tile uses");
  assert_(C.METRICS_.throughput.n([W]) === 2,
          "n() reports nEst (the estimated-and-thus-measurable count), not the nonexistent `.n` field");

  // ── Existing four metrics render byte-identically (unit is undefined for
  //    them, so hbarChart_'s new branch must be a no-op on their path) ──────
  C.setState("metric", "util");
  C.renderAll_();
  var cmpUtil = els.comparePanel.innerHTML;
  assert_(/>25%</.test(cmpUtil) && />50%</.test(cmpUtil) && />100%</.test(cmpUtil),
          "a percent metric (Utilization) still draws the 0/25/50/75/100% grid — untouched by the unit branch");
  assert_(cmpUtil.indexOf("Billable Utilization") !== -1 || cmpUtil.indexOf("Capacity Utilization") !== -1,
          "…and still renders its own label, not a flow metric's");

  // ── The chip order matches METRIC_ORDER_, flow metrics appended last ────
  assert_(C.METRIC_ORDER_.join(",") === "onTime,forecast,util,quality,leadTime,throughput,planCov",
          "METRIC_ORDER_ appends the two joinable flow metrics, then the forward-window metric");
  assert_(C.liveMetrics_().indexOf("leadTime") !== -1 && C.liveMetrics_().indexOf("throughput") !== -1,
          "both are live metrics under a Jira-available fixture");
  // planCov is the FORWARD-window metric and must never be offered on a
  // complete one — a plan for a week that has closed is not an action.
  assert_(C.liveMetrics_().indexOf("planCov") === -1,
          "Planned Coverage is not a metric on a complete window");

  // ── oppRows_ is hardcoded to utilization and never reads STATE.metric —
  // selecting a flow metric elsewhere on the page must not make the pulse's
  // recoverable-hours walk compute nonsense from a days/hrs value as if it
  // were a percent rate. Pinned at data level (the headroom table that used
  // to render this is retired, 2026-08-05).
  C.setState("metric", "leadTime");
  var flowDone = C.donePeriods_();
  var flowRows = C.oppRows_(flowDone[flowDone.length - 1], 75);
  assert_(flowRows.length > 0 && flowRows.every(function (r) {
            return r.rate >= 0 && r.rate <= 100;
          }),
          "oppRows_ still computes a % utilization rate, unaffected by STATE.metric");

  // Teardown (sibling discipline): restore the standard fixture and state.
  C.setState("metric", "onTime");
  C.STATE.compare = "region";
  fresh(model({}));
  C.switchView_("exec");
  C.renderAll_();
})();

// ── TASK 10 FOLLOW-UP — throughput's operating band actually DRAWS with real
// coverage (reviewer finding) ───────────────────────────────────────────────
// The unit-level coverage()/n() assertion above pins the number; this pins
// the end of the chain it feeds — with >= STD_MIN_PERIODS (5) of real,
// non-NaN coverage, metricConfidence_ must not return level:"none", so
// applyGatePolicy_ publishes and stdFor_ draws the shaded operating-range
// rect. Before the fix, coverage was NaN every period → conf.level stayed
// "none" → the band was silently absent with no error anywhere.
(function () {
  var M = histModel({});
  // A flat 40h/week series, comfortably under the [0,100] std clamp
  // (standardRate_ clips hi at 100 — a separate, pre-existing quirk for any
  // metric whose values run past 100, out of scope for this fix) so the band
  // itself is unambiguous rather than degenerate.
  M.throughputBuckets = HIST.map(function (iso) {
    return { iso: iso, person: "Ana Perez", nAll: 3, nEst: 2, estHrs: 40 };
  });
  M.meta.registry.metrics.throughput = { id: "throughput", name: "Throughput", unit: "hrs",
    target: null, coverageGate: 0.6 };
  fresh(M);
  C.STATE.compare = "region";
  C.setState("metric", "throughput");
  C.renderAll_();
  var cmp = els.comparePanel.innerHTML;
  assert_(cmp.indexOf('fill="var(--c-ref)"') !== -1,
          "with >= STD_MIN_PERIODS of real (non-NaN) coverage, throughput's operating-range " +
          "band DRAWS — before the fix this was silently absent (NaN coverage → conf.level 'none')");
  assert_(cmp.indexOf("normal operating range") !== -1 || cmp.indexOf("below the normal operating range") !== -1,
          "…and the verdict line's operating-range language is present, not silently dropped");

  // Teardown.
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
  var trust = document.getElementById("trustPanel").innerHTML;
  assert_(trust.split("trustItem").length - 1 === 4, "exactly four trust tiles");
  assert_(trust.indexOf("ORG") !== -1, "trust strip carries the ORG scope tag");
  // Order + identity: est, due, logged, attr (brief order) — each tile is
  // recognisable by the plain-language title gapsRows_ assigns its key.
  var order = ["Estimate coverage", "Due-date fill", "Logged fill", "Roster join"];
  var idxs = order.map(function (t) { return trust.indexOf(t); });
  assert_(idxs.every(function (i) { return i !== -1; }), "all four tile titles present");
  assert_(idxs[0] < idxs[1] && idxs[1] < idxs[2] && idxs[2] < idxs[3],
          "tiles render in brief order: est, due, logged, attr");
  // Values against the model fixture's single headline week (2026.W31):
  // due 40/50=80% (at its 80% gate → green), est 14/20=70% (at gate → green),
  // logged 9/14≈64% (below the 70% gate but within the 10-pt band → amber),
  // attr 45/47≈96% (above the 95% gate → green).
  assert_(/80%/.test(trust) && /70%/.test(trust), "due-date and estimate percentages render");
  assert_(/64%/.test(trust), "logged-fill percentage renders below its gate");
  assert_(/96%/.test(trust), "roster-join percentage renders above its gate");
  assert_(/var\(--c-warn\)/.test(trust), "the below-gate logged tile is graded amber, not red or green-only");
  assert_(/Blocks: Forecast Accuracy/.test(trust), "each tile's tooltip states what it blocks (shared gapsRows_ note)");
  assert_(/the full queue.*🎯 Actions/.test(trust) || /Actions tab/.test(trust),
          "the footer points readers at the Actions tab for the full queue");

  // Not margin-gated (brief note): a guest sees the same strip, unlike the
  // pulse panel directly above it which disappears for that role.
  C.getModel().viewerRole = "guest";
  C.renderAll_();
  var trustGuest = document.getElementById("trustPanel").innerHTML;
  assert_(trustGuest.split("trustItem").length - 1 === 4,
          "a guest still sees all four trust tiles — this strip is not margin-gated");
  C.getModel().viewerRole = "admin";
  C.renderAll_();
})();

// ── A SOLVED CHECK RETIRES ITSELF (user decision 2026-08-06) ────────────────
// "we do not need 'assignee resolves to a roster person' as metric, we have
// solved all discrepancies so always 100%."
//
// Both directions are pinned, and the second one is the point of the whole
// design: the roster join is this dashboard's historically dominant data loss
// (49% of records on the 2026-08-04 profile), so it is HIDDEN while clean, not
// deleted. A test that only proved it disappears would have equally passed on a
// version that went permanently blind.
(function () {
  var mdl = fresh(model({}));
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");

  // ── Clean: resAttr === resAssigned on every week ──
  mdl.hygieneBuckets.forEach(function (b) { b.resAttr = b.resAssigned; });
  C.setModel(mdl);
  C.renderAll_();
  var trust = document.getElementById("trustPanel").innerHTML;
  assert_(trust.indexOf("Roster join") === -1,
          "a roster join at 100% leaves the data-trust strip");
  assert_(trust.split("trustItem").length - 1 === 3,
          "…leaving the three checks that still vary, not a blank fourth tile");
  assert_(trust.indexOf("Estimate coverage") !== -1 && trust.indexOf("Logged fill") !== -1,
          "…and the unsolved checks are untouched");

  var h1 = C.hygieneFor_(["2026.W31"]), pp1 = C.hygienePeopleFor_(["2026.W31"]);
  assert_(!C.gapsRows_(h1, pp1).some(function (g) { return g.key === "attr"; }),
          "the gaps queue drops the solved row");
  assert_(C.gapsRetired_(h1, pp1).length === 1,
          "…and reports it as retired rather than losing track of it");
  // NAMED, not silently dropped. A check that vanishes without a word is
  // indistinguishable from one somebody deleted.
  var solved = C.gapsSolvedHtml_(h1, pp1);
  assert_(/Solved and retired/.test(solved) && /roster person/.test(solved),
          "the queue names the retired check in plain language");
  assert_(/Still measured/.test(solved),
          "…and says the measurement is still running — the reader must not stop trusting it");

  // The 🧬 matrix column goes too, on the same rule.
  var cleanRows = [
    { type: "Story", n: 10, due: 10, assigned: 10, attr: 10, est: 10, time: 10, timeN: 10,
      region: 10, team: 10, gatesOnTime: true, gatesForecast: true, keys: {}, keysCapped: {} },
    { type: "Epic", n: 4, due: 4, assigned: 4, attr: 4, est: 4, time: 4, timeN: 4,
      region: 4, team: 4, isEpic: true, gatesOnTime: true, gatesForecast: true,
      keys: {}, keysCapped: {} },
  ];
  var attrField = C.TYPE_FIELDS_.filter(function (f) { return f.k === "attr"; })[0];
  assert_(attrField.retireWhenFull === true, "the → roster column opts into retirement");
  assert_(C.typeFieldRetired_(attrField, cleanRows) === true,
          "100% on every row retires the column");
  assert_(C.typeFieldsShown_(cleanRows).length === C.TYPE_FIELDS_.length - 1,
          "…so the matrix renders one column fewer");
  assert_(C.typeFieldsShown_(cleanRows).indexOf(attrField) === -1, "…and it is that column");

  // ── IT COMES BACK. One failing record anywhere is enough. ──
  var oneBad = cleanRows.slice();
  oneBad[1] = Object.assign({}, cleanRows[1], { attr: 3 });   // 3 of 4
  assert_(C.typeFieldRetired_(attrField, oneBad) === false,
          "ONE record that does not join the roster brings the column straight back — the check " +
          "is hidden while clean, never switched off");
  assert_(C.typeFieldsShown_(oneBad).indexOf(attrField) !== -1, "…and it renders again");
  assert_(C.typeFieldRetired_(attrField, []) === false,
          "an empty population is not evidence of a solved field");

  mdl.hygieneBuckets.forEach(function (b) { b.resAttr = b.resAssigned - 2; });
  C.setModel(mdl);
  C.renderAll_();
  assert_(document.getElementById("trustPanel").innerHTML.indexOf("Roster join") !== -1,
          "a regression puts the trust tile back with no deploy and no code change");
  var h2 = C.hygieneFor_(["2026.W31"]), pp2 = C.hygienePeopleFor_(["2026.W31"]);
  assert_(C.gapsRows_(h2, pp2).some(function (g) { return g.key === "attr"; }),
          "…and the queue row with it");
  assert_(C.gapsSolvedHtml_(h2, pp2) === "",
          "…while the 'solved' line renders nothing when nothing is solved");

  // A null value is NOT a solved check — an unconnected feed must never retire.
  assert_(C.gapRetired_({ retireWhenFull: true, value: null }) === false,
          "nothing measured is not the same as nothing wrong");

  fresh(model({}));
  C.renderAll_();
})();

// ── EXECUTIVE DATA-TRUST STRIP — NULL-VALUE TILE GRAMMAR (reviewer follow-up:
// the null branch must be pinned INSIDE renderTrust_ itself, not inferred
// from a different renderer's coverage of the same `value === null` shape). ──
// `est`'s value is `h.epics > 0 ? h.epicsEst / h.epics : null` (gapsRows_) —
// zeroing h.epics is the cleanest lever: it nulls ONLY the "est" gap, since
// due/logged/attr divide by h.res / h.epicsEst / h.resAssigned respectively,
// none of which this touches.
(function () {
  var m = fresh(model({}));
  m.hygieneBuckets = m.hygieneBuckets.map(function (b) {
    return b.iso === "2026.W31" ? Object.assign({}, b, { epics: 0 }) : b;
  });
  C.setModel(m);
  C.getModel().viewerRole = "admin";
  C.setState("view", "exec");
  C.renderAll_();
  var trustNull = document.getElementById("trustPanel").innerHTML;
  var segs = trustNull.split('class="trustItem"');
  assert_(segs.length - 1 === 4, "still exactly four tiles when one key nulls out");
  var estSeg = segs[1];   // order = [est, due, logged, attr] — est renders first
  assert_(/trustVal" style="color:var\(--muted\)">—/.test(estSeg),
          "null-value tile renders the em-dash in muted colour, not a fabricated 0%");
  assert_(/width:0%;background:var\(--muted\)/.test(estSeg),
          "…and its bar is width:0 with no colour fill (muted, not good/warn/bad)");
  assert_(!/var\(--c-good\)|var\(--c-warn\)|var\(--c-bad\)/.test(estSeg),
          "…the null tile carries none of the three graded colours");
  // Isolation: zeroing h.epics must not ripple into the other three tiles —
  // due/logged/attr keep the percentages they render under the base fixture.
  var dueSeg = segs[2], loggedSeg = segs[3], attrSeg = segs[4];
  assert_(/80%/.test(dueSeg), "due-date tile is untouched by the est-only null (still 80%)");
  assert_(/64%/.test(loggedSeg), "logged-fill tile is untouched (still 64%)");
  assert_(/96%/.test(attrSeg), "roster-join tile is untouched (still 96%)");

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

  // ── Hero tiles (tileHtml_) → PERIOD ────────────────────────────────────
  var tilesHtml = els.tiles.innerHTML;
  assert_(tilesHtml.indexOf(">PERIOD<") !== -1, "hero tiles carry PERIOD scope tags");
  // On-Time (always renders) + Forecast + Utilization (margin-gated on for
  // admin) + Quality (always renders) = 4 hero tiles, one PERIOD tag each.
  assert_(tilesHtml.split(">PERIOD<").length - 1 === 4,
          "…exactly one PERIOD tag per hero tile (4 tiles under the admin fixture)");
  assert_(tilesHtml.indexOf(">SNAP<") === -1 && tilesHtml.indexOf(">ORG<") === -1,
          "…and never SNAP or ORG — every hero tile follows the period picker");

  // ── Flow tier (flowTileHtml_) → PERIOD/SNAP split by metric ────────────
  var ft = els.flowTiles.innerHTML;
  assert_(ft.indexOf(">SNAP<") !== -1 && ft.indexOf(">PERIOD<") !== -1,
          "flow tier: Backlog/WIP tag SNAP, Lead Time/Throughput/Bugs tag PERIOD");
  assert_(ft.split(">SNAP<").length - 1 === 2, "…exactly two SNAP tags (Backlog + WIP)");
  assert_(ft.split(">PERIOD<").length - 1 === 3,
          "…exactly three PERIOD tags (Lead Time, Throughput, Bug Count)");
  // Placement pin: the tag rides with the RIGHT tile, not just anywhere in the
  // markup — slice the strip between consecutive tile labels and check each.
  var leadSeg = ft.split("Lead Time")[1].split("Throughput")[0];
  var throughputSeg = ft.split("Throughput")[1].split("Backlog (Inventory)")[0];
  var backlogSeg = ft.split("Backlog (Inventory)")[1].split("Work In Progress")[0];
  var wipSeg = ft.split("Work In Progress")[1].split("Bug Count")[0];
  var bugSeg = ft.split("Bug Count")[1];
  assert_(leadSeg.indexOf(">PERIOD<") !== -1, "Lead Time tile tags PERIOD");
  assert_(throughputSeg.indexOf(">PERIOD<") !== -1, "Throughput tile tags PERIOD");
  assert_(backlogSeg.indexOf(">SNAP<") !== -1, "Backlog tile tags SNAP");
  assert_(wipSeg.indexOf(">SNAP<") !== -1, "WIP tile tags SNAP");
  assert_(bugSeg.indexOf(">PERIOD<") !== -1, "Bug Count tile tags PERIOD");
  assert_(leadSeg.indexOf(">SNAP<") === -1 && throughputSeg.indexOf(">SNAP<") === -1 &&
          bugSeg.indexOf(">SNAP<") === -1,
          "…and SNAP never leaks onto Lead Time, Throughput or Bug Count");
  assert_(backlogSeg.indexOf(">PERIOD<") === -1 && wipSeg.indexOf(">PERIOD<") === -1,
          "…and PERIOD never leaks onto Backlog or WIP");

  // Missing-feed placeholder: a dash tile still has a scope (brief note) —
  // Bug Count's "unavailable" branch must still carry PERIOD.
  M.meta.bugsAvailable = false;
  C.setModel(M);
  C.renderAll_();
  var ftNoBugs = els.flowTiles.innerHTML;
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
  var tilesHtml = els.tiles.innerHTML;
  assert_(/class="big/.test(tilesHtml), "motion layer on: hero tiles still carry .big values");
  assert_(!/NaN/.test(tilesHtml), "…and no count-up NaN leaked into a tile (rAF never ran under the stub)");

  // A re-render after "loaded" (the state every render past the first one is
  // actually in) must not throw and must not re-run the count-up — it's a
  // module-scoped one-shot guard, not something a re-render can retrigger.
  document.body.className = "loaded";
  C.renderAll_();
  assert_(/\bloaded\b/.test(document.body.className),
          "a renderAll_ pass after the class has settled to loaded leaves it there — " +
          "renderAll_/renderTiles_ never touch body.className themselves");
  assert_(/class="big/.test(els.tiles.innerHTML),
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

  assert_(C.VIEWS.length === 3, "exactly three views");
  assert_(C.VIEWS.map(function (v) { return v.id; }).join(",") === "exec,actions,access",
          "view ids are exec/actions/access in order");
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
  C.renderTiles_();
  var nowT = els.tiles.innerHTML;
  assert_(/◐ in progress/.test(nowT), "every card wears the in-progress marker");
  assert_(!/vs prior/.test(nowT),
          "no vs-prior delta on an open window — a part-period against a whole one is a length difference");
  assert_(/pts (above|below) target|on target/.test(nowT),
          "…but the TARGET gap survives: it judges the number actually on the card");
  var nowUtil = nowT.split("Utilization")[1].split("Quality")[0];
  assert_(/lower bound, not a measurement/.test(nowUtil),
          "mid-period utilization is a FLOOR — capacity is booked for the whole window, hours are not");
  assert_(!/class="big [gar]"/.test(nowUtil),
          "…so it carries no RAG verdict, exactly like the rework floor");

  // ── Planning ─────────────────────────────────────────────────────────────
  C.setState("periodIdx", all.length - 2);   // PLAN1
  var Aplan = C.analysisHead_();
  assert_(Aplan.phase === "plan" && Aplan.head.key === PLAN1, "the planning week resolves as phase 'plan'");
  assert_(Aplan.hi === done.length - 1, "…and still anchors its history on the last complete period");
  C.renderTiles_();
  var planT = els.tiles.innerHTML;
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
  assert_(/planning window selected/.test(els.hygPanel.innerHTML),
          "the gaps view falls back to the last complete period and names the reason");
  C.setState("view", "exec");
  C.renderAll_();
  assert_(!/recoverable/.test(els.pulsePanel.innerHTML),
          "recoverable hours are suppressed on a forward window — they measure hours already delivered");
  assert_(/planned <b>/.test(els.pulsePanel.innerHTML),
          "…and the pulse states planned coverage in their place");
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
  /** Renders the masthead against a fresh model and returns its HTML. */
  function masthead(mdl) {
    fresh(mdl);
    C.renderMasthead_();
    return els.masthead.innerHTML;
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
  function band(mdl) {
    fresh(mdl);
    C.renderBacklogBand_();
    return els.backlogBand.innerHTML;
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
  var heroSeg = h1.split("Assigned inventory")[0];   // hero triplet precedes the sub-row heading
  var subSeg = h1.split("Assigned inventory")[1] || "";
  assert_(heroSeg.indexOf(">ORG<") !== -1, "the hero triplet carries the ORG scope tag");
  assert_(heroSeg.indexOf(">SNAP<") === -1, "…and never SNAP, on the hero side");
  assert_(subSeg.indexOf(">SNAP<") !== -1, "the assigned sub-row carries the SNAP scope tag");
  assert_((h1.match(/>ORG</g) || []).length === 3, "all three hero slots carry their own ORG tag (not one shared banner)");
  assert_((h1.match(/>SNAP</g) || []).length === 2, "both sub-row slots carry their own SNAP tag");

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
  var rulerSvg = hBand.split("<svg")[1] ? "<svg" + hBand.split("<svg")[1].split("</svg>")[0] + "</svg>" : "";
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
  var rulerSvgNoBand = hNoBand.split("<svg")[1] ? "<svg" + hNoBand.split("<svg")[1].split("</svg>")[0] + "</svg>" : "";
  assert_(rulerSvgNoBand.indexOf('fill="var(--c-ref)"') === -1,
          "…and with an unpublishable norm (<5 points), NO reference band is drawn at all — " +
          "not a green rect standing in for a target");

  // ── 6. Setting STATE.region changes the sub-row but NOT the hero triplet —
  // proving the hero is genuinely ORG (unfiltered), not merely tagged ORG
  // while actually reading filtered data. Catches: a filter accidentally
  // reaching the hero's numbers, or the sub-row NOT reacting to the filter at all.
  fresh(baseFixture());
  C.renderBacklogBand_();
  var heroBefore = els.backlogBand.innerHTML.split("Assigned inventory")[0];
  C.setState("region", "EMEA");
  C.renderBacklogBand_();
  var afterHtml = els.backlogBand.innerHTML;
  var heroAfter = afterHtml.split("Assigned inventory")[0];
  var subAfter = afterHtml.split("Assigned inventory")[1] || "";
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
  var beforePeriod = els.backlogBand.innerHTML;
  // Pick an EARLIER period on the picker — if the band secretly depended on
  // it, the trailing-weeks totals would move; they must not.
  C.setState("periodIdx", 0);
  C.renderBacklogBand_();
  var afterPeriod = els.backlogBand.innerHTML;
  assert_(beforePeriod === afterPeriod,
          "the backlog band is BYTE-IDENTICAL when the period picker moves — it is fixed to its " +
          "own trailing-weeks basis (D3), the same way the masthead and netFlowPerWeek_ already are");
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

  // Teardown.
  C.setState("region", "");
  C.setState("periodIdx", null);
  fresh(model({}));
  C.setState("view", "exec");
  C.renderAll_();
})();

console.log("✅ render-smoke: " + checks + " checks passed");
