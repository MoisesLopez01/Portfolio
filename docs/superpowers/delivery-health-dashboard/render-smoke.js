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
// most to this build are RENDERING rules — "a below-gate metric must carry a low
// confidence chip and a hygiene link", "an empty period must not read as bad
// data", "a stale model must not print a delta". Those live in string
// concatenation, where a unit test can't reach them and a typo silently ships
// the opposite of what was decided.
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
             " renderTiles_: renderTiles_, renderHygiene_: renderHygiene_," +
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
             " renderOpportunity_: renderOpportunity_, metricChips_: metricChips_, renderCompare_: renderCompare_," +
             " renderGrid_: renderGrid_, toggleFlag_: toggleFlag_, VIEWS: VIEWS, dimMatch_: dimMatch_, UNTAGGED_: UNTAGGED_, cmpNoun_: cmpNoun_, scopedMetric_: scopedMetric_, METRICS_: METRICS_, canSeeMargin_: canSeeMargin_, liveMetrics_: liveMetrics_," +
             // WHAT-IF simulation + data profiling (spec 2026-08-03)
             " whatIfOn_: whatIfOn_, toggleWhatIf_: toggleWhatIf_, whatIfCounts_: whatIfCounts_," +
             " renderAll_: renderAll_, buildPeriodChips_: buildPeriodChips_," +
             " profileFor_: profileFor_," +
             " briefFor_: briefFor_," +
             " utilFor_: utilFor_, bucketsFor_: bucketsFor_ })";
var C = eval(m[1] + bridge);

// ── Synthetic model ─────────────────────────────────────────
// Two complete weeks so the trend has ≥2 periods (the "high confidence" bar).
var WEEKS = ["2026.W30", "2026.W31"];
function week(o) {
  // capCov = gross scheduled capacity of an NS-classified week. Schema v10: the
  // Metrics Dictionary Utilization denominator divides by this, so a fixture
  // without it reports null and every utilization assertion goes quiet.
  return Object.assign({ cap: 40, pto: 0, hol: 0, avail: 40, availCov: 40, capCov: 40, planned: 40,
                         tracked: 40, trackedCov: 40, billable: 30, nonBillable: 10,
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
      regions: ["AMER", "EMEA", "APAC", "ANZ", "Other"], teams: ["Team A"], pms: [], families: ["Service Delivery"],
      nsAvailable: true, jiraAvailable: true,
      nsCoverage: { personWeeks: 4, covered: 4, classifiedPct: 1, gapHours: 0, unmatchedNames: [] },
      jiraUnattributed: { onTime: 3, forecast: 1 },
      onTimeScope: "delivery", forecastBand: 0.10,
      ptoSource: "accumulation", capacityError: null,
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
assert_(/high confidence/.test(good), "coverage above gate with 2 periods → high confidence");
assert_(/96% attributed/.test(good), "confidence chip states measured coverage (48 of 50)");
assert_(/pts vs target/.test(good), "variance to TARGET leads the signal line (FR-4.1)");
assert_(!/Not yet measurable/.test(good), "nothing suppressed when coverage is good");
assert_(/Median absolute variance/.test(good), "forecast secondary form present (FR-1.4) — moved to the context tooltip in R6, still present");
assert_(/inside ±10%/.test(good), "forecast headline names the ±10% band");
assert_(/Of [0-9]+ miss(es)?, [0-9]+% over-run/.test(good), "variance direction on misses (FR-1.6)");
// The "definition changed" marker is gone from the KPI tiles (user 2026-08-03:
// "this is not meaningful"). On a single headline number there is no visible
// step for it to explain; it survives only on the Trends line chart, where the
// step is on screen.
assert_(!/definition changed/.test(good), "no definition-changed marker on any KPI tile");

// ── 2. Below-gate coverage, SHIPPED policy: publish with a low chip ──
// User decision 2026-08-03 (accepted deviation from FR-2.2): suppression is off.
// The number is shown; what protects the reader is the low-confidence chip, the
// "below gate — directional only" line, and the route into the hygiene queue.
var shown = tiles(model({ otCov: 0.66, fcCov: 0.43 }));
assert_(!/Not yet measurable/.test(shown), "shipped policy publishes below-gate metrics");
assert_(/low confidence · 45% attributed/.test(shown), "…carrying a LOW confidence chip with its coverage");
assert_(/below gate — directional only/.test(shown), "…and an explicit below-gate caveat");
assert_(/What's missing/.test(shown), "…still routed to the hygiene queue");
var shownFc = shown.split("Forecast Accuracy")[1].split("</div></div>")[0];
assert_(/class="big/.test(shownFc), "the figure itself is rendered");
assert_(/inside ±10%/.test(shown), "…with its normal supporting copy intact");

// ── 2b. Flipping the policy restores full FR-2.2 suppression ──
// The whole path stays behind one flag, so the decision is reversible without
// a code change beyond CONFIG_DH.SUPPRESS_BELOW_GATE.
var strict = model({ otCov: 0.66, fcCov: 0.43 });
strict.meta.suppressBelowGate = true;
var bad = tiles(strict);
var forecastCard = bad.split("Forecast Accuracy")[1].split("</div></div>")[0];
assert_(/Not yet measurable/.test(bad), "below-gate metric shows the suppressed state (FR-2.2)");
assert_((bad.match(/Not yet measurable/g) || []).length === 2,
        "BOTH on-time (66% vs 80% gate) and forecast (43% vs 70%) suppress");
assert_(!/Owner:/.test(bad), "suppressed tile carries no owner line (same rule as the hygiene table)");
assert_(/What's missing/.test(bad), "suppressed tile links to the hygiene queue");
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
assert_(!/Billable Utilization<\/div>\s*<div class="big/.test(dead),
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
assert_(/pts vs target/.test(stale), "target gap survives staleness — it isn't a comparison across refreshes");

// ── 5. Data Hygiene view ────────────────────────────────────
C.setModel(model({}));
C.renderHygiene_();
var hyg = els.viewHygiene.innerHTML;
assert_(/Delivery work fully attributed/.test(hyg), "hygiene headline tile present (FR-2.4)");
assert_(/16%/.test(hyg), "8 of 50 fully attributed = 16%");
assert_(/Region tagged on delivery work/.test(hyg), "region gap listed");
assert_(/PR-01/.test(hyg) && /2026\.W34/.test(hyg), "each gap carries a prerequisite and an ISO target week");
// Owner column removed (user decision 2026-08-03) — accountability lives in the
// requirements doc via the prereq ID, not as a standing table of names against
// failures in a widely-read view.
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
C.renderHygiene_();
var ovHyg = els.viewHygiene.innerHTML;
assert_(/id="gate_onTime" value="55"/.test(ovHyg), "the override value is what's editable");
assert_(/>80%/.test(ovHyg), "the AGREED default stays on screen beside it");
assert_(/✎ changed 2026-08-03/.test(ovHyg), "and the change is stamped with its date");
assert_(/restoreGate_\('onTime'\)/.test(ovHyg), "with a one-click restore to the agreed value");
// Non-admins must not see it at all — the RPC is gated server-side too.
var viewer = model({});
viewer.viewerRole = "viewer";
C.setModel(viewer);
C.renderHygiene_();
assert_(!/Coverage gates \(admin\)/.test(els.viewHygiene.innerHTML),
        "viewers get no gate editor");
C.setModel(model({}));
C.renderHygiene_();

// ── 5b. The view must SAY which window it covers — and the window is the
// GLOBAL analysis-period picker (2026-08-04: universal filters; the view's
// own ◀ ▶ / Σ stepper is gone).
assert_(/Every figure above covers/.test(hyg), "the view states its own window");
assert_(/2026\.W31/.test(hyg), "window label names the period (weekly framing here)");
assert_(!/setHygIdx_/.test(hyg), "no per-view stepper — the header picker is the one control");
assert_(!/Σ All history/.test(hyg), "no per-view whole-window rollup either");
assert_(/window follows the header period picker/.test(hyg),
        "says exactly which control owns the window");
// A composite pinned by one org-wide-empty term must name that term, or 0% reads
// as total failure and hides the two components that ARE moving.
assert_(/Held down by region/.test(hyg), "binding constraint named");
assert_(/Excluding region/.test(hyg), "the measurable-today figure is shown beside the strict one");
// Anchored read — a bare /68%/ would happily match any gap row's coverage.
function readyPct_(s) { var t = s.split("Excluding region: <b>")[1]; return t ? t.split("%")[0] : null; }
function fullPct_(s) { var t = s.split('class="big ')[1]; return t ? t.split(">")[1].split("%")[0] : null; }
assert_(readyPct_(hyg) === "68", "resReady 34 of 50 = 68% for the latest week");
assert_(fullPct_(hyg) === "16", "strict composite still reported honestly (8 of 50), not replaced");
assert_(Number(readyPct_(hyg)) > Number(fullPct_(hyg)),
        "the measurable-today figure sits above the strict one — that's the point of showing both");

// The GLOBAL picker re-bases this view exactly like the tiles.
C.setState("periodIdx", 0);
C.renderHygiene_();
var older = els.viewHygiene.innerHTML;
assert_(/2026\.W30/.test(older), "picking the earlier period re-bases the hygiene window");
assert_(readyPct_(older) === "60", "and its own numbers follow (resReady 30 of 50)");
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
         { key: "APAC", label: "APAC", value: null, n: 3 }],
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
C.switchView_("trend");
assert_(els.viewTrend.style.display === "" && els.viewExec.style.display === "none",
        "switching view shows exactly one pane");
assert_(els.tabBar.children.length === 5, "an admin sees all five tabs");
C.switchView_("exec");
assert_(els.viewExec.style.display === "" && els.viewTrend.style.display === "none",
        "and switching back hides the other");
var mdlV = fresh(histModel({}));
mdlV.viewerRole = "viewer";
C.switchView_("exec");
assert_(els.tabBar.children.length === 4, "a viewer does not get the Access tab");
C.switchView_("access");
assert_(C.STATE.view === "exec",
        "and asking for it by id lands on the default view — the gate is in the router, not the tab bar");
fresh(histModel({}));

// ── 12. Trends view = the headroom table only ──
// The history line chart was deleted (user 2026-08-03). The tiles already carry
// a sparkline plus a vs-target/vs-prior read, so a second larger telling of the
// same series was page weight, not a second answer.
C.STATE.period = "week"; C.STATE.metric = "util";
resetFilters();
C.switchView_("trend");
assert_(document.getElementById("trendPanel").innerHTML === "",
        "no trend chart panel is rendered any more");
var trView = els.oppPanel.innerHTML;
assert_(/Where the headroom is/.test(trView), "the tab is the headroom table");
assert_(!/class="chart line"/.test(trView), "and draws no history chart");
assert_(!/ — history/.test(trView), "and carries no history heading");
// The metric chips were moved here when the history chart was deleted, but this
// table computes recoverable HOURS, which only exist for utilization — so the
// chips changed themselves and nothing else. A control that visibly does nothing
// costs more trust than the flexibility it pretends to offer (F3, R5).
assert_(!/setMetric_\(/.test(trView), "no metric selector on the headroom tab — it was a no-op");
assert_(/Billable Utilization|Capacity Utilization/.test(trView),
        "…the heading names the metric instead, so the tab is not silently scoped");

// ── 13. Opportunity table ───────────────────────────────────
fresh(histModel({}));
resetFilters();
C.STATE.oppSort = "opp"; C.STATE.oppDesc = true;
C.renderOpportunity_();
var op = els.oppPanel.innerHTML;
assert_(/Where the headroom is/.test(op), "the table has a plain-language heading");
assert_(/recoverable in 2026\.W30/.test(op), "the headline is HOURS in a named period");
assert_(/Cleo Diaz/.test(op), "people are named here — this is the actionable half");
assert_(/operating rate/.test(op), "and measured against the cohort operating rate");
assert_(/Opportunity = /.test(op), "with the arithmetic stated, not implied");
assert_(/not a target, and not a performance/.test(op),
        "and explicitly framed as headroom rather than a rating");
// The worst performer must rank first when sorting by opportunity.
assert_(op.indexOf("Cleo Diaz") < op.indexOf("Dev Rao"),
        "sorted by opportunity, the biggest gap is at the top");

// A ramping new hire is shown for context but never inflates the total.
var ramp = fresh(histModel({}));
ramp.people.push(histPerson("Eve Kim", { region: "AMER", teams: ["Atlas"], newHire: true,
                                         hired: "2026-07-01" }, [10, 10, 10, 10, 10, 10, 10, 10]));
C.renderOpportunity_();
var op2 = els.oppPanel.innerHTML;
assert_(/Eve Kim/.test(op2), "a ramping new hire still appears, flagged");
assert_(/1 ramping new hire excluded from the total/.test(op2),
        "but is excluded from the recoverable total, and the table says so");

// On leave is an absence, not headroom.
var leave = fresh(histModel({}));
leave.people.push(histPerson("Fay Lund", { region: "AMER", teams: ["Atlas"], onLeave: true,
                                           leaveStatus: "Parental leave" }, [0, 0, 0, 0, 0, 0, 0, 0]));
C.renderOpportunity_();
assert_(!/Fay Lund/.test(els.oppPanel.innerHTML),
        "someone on long leave is absent from the table entirely — no availability is expected");

// ── 14. Legends are controls ────────────────────────────────
// The attention counts only exist when somebody trips a flag, so this fixture
// adds a forward-planning week: Cleo has availability there and almost nothing
// planned against it, which is the "under-planned" cliff the flag is for.
function flagModel() {
  var mdl = fresh(histModel({}));
  mdl.meta.gridWeeks = mdl.meta.gridWeeks.concat([{ iso: "2026.W32", status: "plan" }]);
  mdl.people.forEach(function (p) {
    mdl.people.indexOf(p);
    p.weeks["2026.W32"] = week(p.name === "Cleo Diaz"
      ? { planned: 4, effPlanned: 4, tracked: 0, billable: 0, nonBillable: 0 }
      : { planned: 40, effPlanned: 40, tracked: 0, billable: 0, nonBillable: 0 });
  });
  delete mdl._exCache;
  return mdl;
}
flagModel();
resetFilters();
C.STATE.period = "week";
C.STATE.expandedWeeks = {}; C.STATE.openDetail = {};
C.renderGrid_();
var grid = els.gridPanel.innerHTML;
assert_(/under-planned/.test(grid), "the fixture does trip a triage flag");
assert_(/toggleFlag_\('/.test(grid), "the attention counts are clickable filters, not a caption");
assert_(/click one to filter/.test(grid), "and the strip says they are");
// Expanding a column reveals the bar vocabulary, two entries of which set the lens.
C.STATE.expandedWeeks["2026.W30"] = true;
C.renderGrid_();
var grid2 = els.gridPanel.innerHTML;
assert_(/setFocus_\('billable'\)/.test(grid2),
        "the 'billable' legend entry switches the Focus lens");
assert_(/setFocus_\('nonbill'\)/.test(grid2), "and so does 'non-billable'");
assert_(/class="lgd" title="Tracked in Tempo but with no NetSuite/.test(grid2),
        "an entry with no lens of its own stays inert and explains itself instead");
C.STATE.expandedWeeks = {};

// Filtering by a flag must not erase the counts that let you unfilter.
flagModel();
resetFilters();
var before = C.filteredPeople_().length;
C.STATE.flag = "under";
C.renderGrid_();
var flagged = els.gridPanel.innerHTML;
assert_(C.filteredPeople_().length < before, "a flag filter narrows the population");
assert_(/clear ✕/.test(flagged), "an active flag filter always offers the way out");
assert_(new RegExp("of " + before + "\n?\\s*people need attention").test(flagged) ||
        flagged.indexOf("of " + before + " people need attention") !== -1,
        "the counts are still computed over the UNFLAGGED population, so the strip " +
        "keeps its other totals and the filter can be swapped, not just cleared");
resetFilters();

// ══════════════════════════════════════════════════════════════════════════
// 15. METRICS-DICTIONARY CONFORMANCE (2026-08-03)
// Each of the four rates now computes what the Dictionary says it computes.
// These assertions exist so a future "simplification" cannot quietly walk one
// of them back to the old reading while keeping the old label.
// ══════════════════════════════════════════════════════════════════════════
var dict = tiles(model({ otCov: 0.95, fcCov: 0.92 }));

// ── Utilization: gross denominator is the headline, net is the companion ──
// week() is cap 40 / avail 40 with no PTO, so the two rates coincide here; what
// is under test is that BOTH are stated and the headline names the gross base.
assert_(/of scheduled capacity/.test(dict),
        "utilization headline divides by scheduled capacity (headcount × standard hours)");
assert_(/of net available/.test(dict),
        "…with the net-of-absence rate shown beside it, not instead of it");
var oooModel = model({ otCov: 0.95, fcCov: 0.92 });
oooModel.people.forEach(function (p) {
  Object.keys(p.weeks).forEach(function (iso) {
    // 8h PTO: capacity still 40 (we pay for it), availability drops to 32.
    Object.assign(p.weeks[iso], { pto: 8, avail: 32, availCov: 32, cap: 40, capCov: 40,
                                  tracked: 32, trackedCov: 32, billable: 24, nonBillable: 8 });
  });
});
var withOoo = tiles(oooModel);
// 24 ÷ 40 = 60% gross; 24 ÷ 32 = 75% net. The gross figure MUST be the hero.
assert_(/class="big[^"]*">60%/.test(withOoo),
        "gross is the published number: 24h billable ÷ 40h scheduled = 60%");
assert_(/75% of net available/.test(withOoo), "net companion reports 24 ÷ 32 = 75%");
assert_(/15 pts absence/.test(withOoo),
        "and the gap between them is named as the cost of approved absence");

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
assert_(/vs target ≤5%/.test(qCard), "rework compares against a CEILING, not a floor");
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
  histPerson("Quinn Bauer", { region: "APAC", teams: [], pms: ["Ann Cho"] }, [55, 55, 55, 55, 55, 55, 55, 55])
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
assert_(!/vs target ≤/.test(zeroFloor),
        "…and shows no vs-target chip, which would read as passing a target it cannot be judged against");
assert_(/Reopens NOT measured/.test(zeroFloor), "…with the reason still on the card");

// Measured, and genuinely good: colour returns.
var measuredGood = qCardOf(qModel(3, 100));
assert_(/class="big g"/.test(measuredGood),
        "3% WITH reopens measured is green — the fix removes false verdicts, not true ones");
assert_(/vs target ≤5%/.test(measuredGood), "…and gets its vs-target chip back");

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

// The headroom tab is per-person utilization by construction — same tier.
var trendView = C.VIEWS.filter(function (v) { return v.id === "trend"; })[0];
assert_(trendView.roles && trendView.roles.indexOf("guest") === -1,
        "the headroom tab is role-gated like Access");
C.getModel().viewerRole = "guest";
C.switchView_("trend");
assert_(C.STATE.view !== "trend",
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
C.renderHygiene_();
var hyg2 = els.viewHygiene.innerHTML;
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
// 21. WHAT-IF CORE (spec 2026-08-03): one flag flips the population every
// shared aggregation helper uses to "valid records only". The rates never
// change — they were always computed over valid records; the flag changes the
// denominators and the confidence framing. Admin-only, session-only.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({ otCov: 0.66, fcCov: 0.43 }));
C.setState("whatIf", true);
assert_(C.whatIfOn_(), "whatIf turns on for an admin viewer");
var wiOt = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
assert_(wiOt.nAll === wiOt.n, "WHAT-IF collapses the coverage denominator to the valid population");
assert_(wiOt.nAllReal === 100, "…keeping the real total (2 weeks × 50) for restating");
var wiFc = C.bucketsFor_(C.getModel().forecastBuckets, WEEKS);
assert_(wiFc.nNoTime === 0 && wiFc.nAll === wiFc.n,
        "estimated-but-untracked epics vanish from the displayed population");
assert_(wiFc.nNoTimeReal === 4, "…their real count survives (2 per week × 2)");
C.setState("whatIf", false);
var realOt = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
assert_(realOt.nAll === 100 && realOt.nAllReal === undefined, "flag off → untouched shape");
// utilization: a defaulted-capacity person-week is not a valid record
var wiModel = model({});
wiModel.people[0].weeks["2026.W30"].capEst = true;
fresh(wiModel);
C.setState("whatIf", true);
var wiU = C.utilFor_(WEEKS);
assert_(wiU.cap === 120, "capEst person-week dropped from the WHAT-IF capacity (4×40h − 40h)");
assert_(wiU.wiWeeksDropped === 1, "…and the drop is counted for restating");
C.setState("whatIf", false);
var realU = C.utilFor_(WEEKS);
assert_(realU.cap === 160, "flag off → the full population is back");
// banner counts: Σ over the whole export window, straight off hygieneBuckets
C.setState("whatIf", true);
var wiCounts = C.whatIfCounts_();
assert_(wiCounts.res === 100 && wiCounts.readyKept === 64, "delivery kept/total = resReady/res (30+34 of 100)");
assert_(wiCounts.epics === 40 && wiCounts.epicsKept === 18, "epic kept/total = epicsTime/epics (18 of 40)");
// the flag is a no-op for anyone who is not an admin
C.getModel().viewerRole = "viewer";
assert_(!C.whatIfOn_(), "whatIfOn_ is admin-only regardless of the raw flag");
C.getModel().viewerRole = "admin";
C.setState("whatIf", false);

// ══════════════════════════════════════════════════════════════════════════
// 22. WHAT-IF GUARDRAILS: a simulation must be unmistakable on every view and
// impossible for a non-admin. Banner + body watermark render in the same pass
// as the numbers, so they can never desynchronise.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", true);
C.renderAll_();
var wiBanner = els.whatifBanner.innerHTML;
assert_(/WHAT-IF SIMULATION/.test(wiBanner), "banner renders while the flag is on");
assert_(/kept 64 of 100 delivery items/.test(wiBanner), "…with live kept/total delivery counts");
assert_(/18 of 40 epics/.test(wiBanner), "…and epic counts");
assert_(/not the real numbers/.test(wiBanner), "…and says plainly these are not the real numbers");
assert_(/toggleWhatIf_\(\)/.test(wiBanner), "…and carries the Exit control");
assert_(global.document.body.className === "whatif", "body carries the watermark class");
C.setState("whatIf", false);
C.renderAll_();
assert_(els.whatifBanner.innerHTML === "", "flag off → banner gone");
assert_(global.document.body.className === "", "…and watermark class removed");
// defence in depth: renderAll_ force-resets the flag for non-admins, mirroring
// how switchView_ gates in the router instead of trusting hidden buttons
C.setState("whatIf", true);
C.getModel().viewerRole = "viewer";
C.renderAll_();
assert_(C.STATE.whatIf === false, "renderAll_ force-resets whatIf for a non-admin");
assert_(els.whatifBanner.innerHTML === "", "…and renders no banner");
C.getModel().viewerRole = "admin";

// ══════════════════════════════════════════════════════════════════════════
// 23. WHAT-IF ON THE TILES: gate flags clear (the kept population is 100%
// attributed by construction), exclusions are RESTATED rather than hidden,
// and a tiny valid population says so instead of wearing a confidence chip.
// ══════════════════════════════════════════════════════════════════════════
C.setState("whatIf", true);
var wiShown = tiles(model({ otCov: 0.66, fcCov: 0.43 }));
assert_(!/below gate — directional only/.test(wiShown), "no below-gate caveat in WHAT-IF mode");
assert_(!/low confidence/.test(wiShown), "no low-confidence chip either");
assert_(/high confidence · 100% attributed/.test(wiShown), "kept records are 100% attributed by construction");
assert_(/33 of 33 resolved issues/.test(wiShown), "the displayed population is the valid one (W31: n=33 of 33)");
assert_(/3 excluded by the WHAT-IF filter/.test(wiShown), "unattributed items are restated, not hidden");
assert_(!/3 unattributed/.test(wiShown), "…and the real-mode wording is gone");
assert_(/closed epics excluded by the WHAT-IF filter/.test(wiShown), "not-measurable epics restated on Forecast");
// small-n honesty: n=2 valid records must not wear a confidence chip
var wiTiny = tiles(model({ otCov: 0.04, fcCov: 0.43 }));   // n = round(50×0.04) = 2
var wiTinyOt = wiTiny.split("On-Time Delivery")[1].split("Forecast Accuracy")[0];
assert_(/n=2 valid records — publishable, not meaningful/.test(wiTinyOt),
        "a sub-5 valid population says so on the card");
assert_(!/high confidence/.test(wiTinyOt), "…INSTEAD of a confidence chip, not beside one");
C.setState("whatIf", false);
var realTiny = tiles(model({ otCov: 0.04, fcCov: 0.43 }));
assert_(!/publishable, not meaningful/.test(realTiny), "the honesty line is WHAT-IF-only");

// ── 23b. WHAT-IF utilization restatements actually render on the card ──
// The default fixture is fully classified (trackedCov === tracked, capEst
// false), so edits (d)/(e) were previously verified only at the utilFor_ data
// layer. This fixture makes both lines light up in the HEADLINE week (W31):
// person 0's W31 is a defaulted-capacity week (dropped under WHAT-IF), and
// person 1's W31 carries 20h of unclassified time.
var wiUtilModel = model({});
wiUtilModel.people[0].weeks["2026.W31"].capEst = true;
wiUtilModel.people[1].weeks["2026.W31"].trackedCov = 20;
C.setState("whatIf", true);
var wiUtil = tiles(wiUtilModel);
var wiUtilCard = wiUtil.split("Billable Utilization")[1] || "";
assert_(/1 defaulted-capacity person-week excluded by the WHAT-IF filter/.test(wiUtilCard),
        "(d) the dropped capEst week is restated on the card, singular form");
assert_(/20h unclassified — excluded by the WHAT-IF filter/.test(wiUtilCard),
        "(d) unclassified hours restated under WHAT-IF (40h kept − 20h classified)");
assert_(/high confidence · 100% attributed/.test(wiUtilCard),
        "(e) utilization coverage is overridden to 100% under WHAT-IF");
assert_(!/below gate — directional only/.test(wiUtilCard),
        "(e) …so the below-gate caveat clears");
C.setState("whatIf", false);
var realUtil = tiles(model({})) && tiles(wiUtilModel);
var realUtilCard = realUtil.split("Billable Utilization")[1] || "";
assert_(/⚠ classification covers 75% of tracked hours/.test(realUtilCard),
        "real mode keeps the coverage warning (60h of 80h classified)");
assert_(/below gate — directional only/.test(realUtilCard),
        "real mode: 75% classification vs the 90% gate stays flagged — proving the override changed something");

// ══════════════════════════════════════════════════════════════════════════
// 24. DATA PROFILE PANEL (admin-only): per-metric evaluability funnels — where
// records fall out of "measurable", stage by stage. Region/Team in NO funnel
// (excluded from the exercise by decision 2026-08-03 — tracked in the gaps table
// instead).
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", false);
C.renderHygiene_();
var prof = els.viewHygiene.innerHTML;
assert_(/Data Profile/.test(prof), "profile panel renders for an admin");
assert_(/WHAT-IF: valid records only/.test(prof), "…and carries the single WHAT-IF button");
var profOnly = prof.split("Data Profile")[1].split("Delivery work fully attributed")[0];
assert_(/resolved in scope/.test(profOnly) && /assignee joins the roster/.test(profOnly),
        "on-time funnel names its stages");
assert_(/carries a due date/.test(profOnly), "…down to the measurable population");
assert_(/−11/.test(profOnly), "the drop at each stage is stated (45 roster-joined → 34 with due date)");
assert_(/resolved epics/.test(profOnly) && /has an estimate/.test(profOnly), "forecast funnel present");
assert_(/cannot be profiled/.test(profOnly), "Quality states it cannot be profiled — no fake funnel");
assert_(/Region and Team are excluded/.test(profOnly), "…the panel NAMES the excluded fields, not just 'some fields'");
// pure-function funnel monotonicity — each stage ≤ the one before
var pf = C.profileFor_(
  { res: 50, resDue: 40, resAssigned: 47, resAttr: 45, resReady: 34, epics: 20, epicsEst: 14, epicsTime: 9 },
  { tracked: 160, trackedCov: 150, weeks: 4, capEst: 1 });
[pf.onTime.stages, pf.forecast.stages].forEach(function (st) {
  for (var i = 1; i < st.length; i++) {
    assert_(st[i].n <= st[i - 1].n, "funnel is monotone: " + st[i].label);
  }
});
assert_(JSON.stringify(pf).indexOf("egion") === -1,
        "Region appears in NO funnel definition — titles and stage labels are Region-free");
assert_(pf.util.bars[0].n === 3 && pf.util.bars[0].of === 4, "util bar 1 = real-capacity person-weeks");
// viewer: the whole section simply does not render
C.getModel().viewerRole = "viewer";
C.renderHygiene_();
var profV = els.viewHygiene.innerHTML;
assert_(!/Data Profile/.test(profV) && !/WHAT-IF/.test(profV), "no profile, no button for a viewer");
C.getModel().viewerRole = "admin";

// ══════════════════════════════════════════════════════════════════════════
// 25. CEO BRIEF: deterministic rules — same data in, same brief out. Facts by
// population size; highlights = what already meets its gate; notes = the
// decision registry; concerns ranked by dropped × cards-blocked, each ending
// in change/owner/target, with the WHAT-IF consequence leading concern #1.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("whatIf", false);
C.renderHygiene_();
assert_(/CEO Brief/.test(els.viewHygiene.innerHTML), "brief renders inside the profile panel");
assert_(/copyBrief_\(\)/.test(els.viewHygiene.innerHTML), "…with a Copy control");
// DATA-BLOCKERS.md-shaped input: the roster join is the biggest lever
var bh = { res: 100, resDue: 80, resAssigned: 94, resAttr: 54, resReady: 50,
           epics: 18, epicsEst: 4, epicsTime: 3 };
var bp = { tracked: 4000, trackedCov: 3800, weeks: 100, capEst: 3 };
var b1 = C.briefFor_(bh, bp), b2 = C.briefFor_(bh, bp);
assert_(JSON.stringify(b1) === JSON.stringify(b2), "deterministic: identical output on repeat calls");
assert_(b1.facts.length === 3 && b1.highlights.length === 3 && b1.notes.length === 3,
        "exactly 3 facts / 3 highlights / 3 notes");
assert_(b1.concerns.length >= 1 && b1.concerns.length <= 4, "1–4 concerns");
assert_(/n=50/.test(b1.concerns[0]) && /upstream data entry, not filtering/.test(b1.concerns[0]),
        "concern #1 leads with the WHAT-IF consequence and the measured n");
assert_(/roster person/.test(b1.concerns[0]),
        "ranking is dropped × cards-blocked: the roster join (40 × 4) outranks everything");
assert_(/owner: /.test(b1.concerns[0]) && /target: 2026\.W3[45]/.test(b1.concerns[0]),
        "every concern ends in owner + ISO target week");
assert_(b1.facts.every(function (f) { return /\d+ of \d+/.test(f) && /vs gate \d+%/.test(f); }),
        "facts are measured kept-of-total statements against their gates");
// Four gaps tie at total=100 (assignee, due date, classification, capacity);
// briefTie_ resolves alphabetically, so the winners and their order are fixed:
// Billable classification (95 kept), Due date (80), Jira assignee (94) — and
// "Real Tempo capacity" is the alphabetical loser, dropped as 4th.
assert_(/^95 of 100 — Billable classification/.test(b1.facts[0]) &&
        /^80 of 100 — Due date/.test(b1.facts[1]) &&
        /^94 of 100 — Jira assignee/.test(b1.facts[2]),
        "facts tie at total=100 resolves alphabetically via briefTie_ — order pinned");
assert_(b1.notes.every(function (n) { return /2026-\d\d-\d\d/.test(n); }),
        "notes are date-stamped decisions");
// sparse window: the brief never renders short and never fakes a number
var b0 = C.briefFor_({ res: 0, resDue: 0, resAssigned: 0, resAttr: 0, resReady: 0,
                       epics: 0, epicsEst: 0, epicsTime: 0 },
                     { tracked: 0, trackedCov: 0, weeks: 0, capEst: 0 });
assert_(b0.facts.length === 3 && b0.highlights.length === 3 && b0.notes.length === 3 &&
        b0.concerns.length >= 1, "sparse data still yields a full 3/3/3 + concern brief");
assert_(/not measurable/.test(b0.facts[0]), "…with facts saying 'not measurable', not fake zeros");

// ══════════════════════════════════════════════════════════════════════════
// 26. WHAT-IF THREADS INTO THE HEADROOM TABLE + util COVERAGE ACCESSOR PARITY
// (final-review blocker fix, 2026.W32). oppRows_ aggregated every person's
// hours via aggWeeks_ with NO WHAT-IF gate, while the cohort norm it compares
// against comes from utilFor_ (which DOES drop capEst weeks) — a real
// per-person rate was being diffed against a simulated norm. Fix: drop a
// capEst week from a person's own aggregation too, mirroring utilFor_'s
// per-week drop. Fold-in: METRICS_.util.coverage must agree with the tile's
// WHAT-IF override (~line 2142) instead of only the KPI card getting it.
// ══════════════════════════════════════════════════════════════════════════
var wiOppModel = fresh(model({}));
// A single-period month spanning both fixture weeks, so dropping ONE of a
// person's two headline weeks under WHAT-IF still leaves a valid remainder to
// aggregate — the row survives with different numbers, not a vanished row.
wiOppModel.meta.periods = {
  month: [{ key: "2026-07", label: "Jul 2026", status: "done", partial: false, isos: WEEKS }],
};
// Ana Perez's W30 becomes a defaulted-capacity week AND under-bills relative
// to her W31 week, so the drop moves both the denominator and the rate by a
// number computed from the fixture, not just "the row looks different".
wiOppModel.people[0].weeks["2026.W30"] = week({
  billable: 20, nonBillable: 20, nsBillRaw: 20, nsNonBillRaw: 20, capEst: true,
});
C.setState("whatIf", false);
C.STATE.period = "month";
resetFilters();
C.renderOpportunity_();
var oppReal = els.oppPanel.innerHTML;
var anaReal = oppReal.split("Ana Perez")[1].split("</tr>")[0];
// Real mode: both weeks count — availCov 40+40=80, billable 20+30=50 → 62.5% → 63%.
assert_(/63%<span class="cellSub"> of 80h<\/span>/.test(anaReal),
        "real mode: Ana's capEst week still counts (80h avail, 63% rate)");

C.setState("whatIf", true);
C.renderOpportunity_();
var oppWi = els.oppPanel.innerHTML;
var anaWi = oppWi.split("Ana Perez")[1].split("</tr>")[0];
// WHAT-IF: the capEst W30 week drops out — only W31 counts: availCov 40,
// billable 30 → 75%. The row survives (unlike a single-week head period)
// with a concrete, different number, proving the drop actually threaded in.
assert_(/75%<span class="cellSub"> of 40h<\/span>/.test(anaWi),
        "WHAT-IF: Ana's capEst week is dropped (40h avail, 75% rate)");
assert_(anaReal !== anaWi, "the rendered row differs between real and WHAT-IF mode");
C.setState("whatIf", false);
C.STATE.period = "week";

// METRICS_.util.coverage: must return 1 under WHAT-IF (agreeing with the
// tile's utilCov override) and the real ratio otherwise. Fixture: Ana's W30
// tracked hours are only half-classified (trackedCov 20 of 40), so the real
// ratio is (20 + 40 + 40 + 40) / (40*4) = 140/160 = 0.875 — not 1, or the
// override couldn't be distinguished from "already 1".
var covModel = fresh(model({}));
covModel.people[0].weeks["2026.W30"].trackedCov = 20;
C.setState("whatIf", false);
var covReal = C.METRICS_.util.coverage(WEEKS);
assert_(Math.abs(covReal - 0.875) < 1e-9, "real mode: coverage is the measured tracked/trackedCov ratio (0.875)");
C.setState("whatIf", true);
var covWi = C.METRICS_.util.coverage(WEEKS);
assert_(covWi === 1, "WHAT-IF: coverage is forced to 1, matching the Executive tile's utilCov override");
C.setState("whatIf", false);

// ══════════════════════════════════════════════════════════════════════════
// 27. WHOLE-ROSTER ATTRIBUTION + LIVE-DATA FIXES (2026-08-04)
// attribOnly stubs join buckets to the KPI cards without ever entering the
// grid, the headcounts or the dropdowns; the banner stops printing the same
// total twice under the Dictionary scope; and the CEO brief's verdict is
// n-aware — "publishable, not meaningful" was written for n≈2 and is false
// at the measured n=164.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
var baseOt27 = C.bucketsFor_(C.getModel().onTimeBuckets, WEEKS);
var stubModel = model({});
stubModel.people.push({ name: "Sol Architect", region: "APAC", teams: [], pms: [],
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
// Banner: one population, two validity readings under the Dictionary scope
C.setState("whatIf", true);
C.getModel().meta.onTimeScope = "dictionary";
C.renderAll_();
assert_(/kept 64 of 100 resolved epics for On-Time · 18 for Forecast/.test(els.whatifBanner.innerHTML),
        "dictionary scope: no doubled total in the banner");
assert_(!/of 40 epics/.test(els.whatifBanner.innerHTML), "…the second total is gone");
C.getModel().meta.onTimeScope = "delivery";
C.renderAll_();
assert_(/kept 64 of 100 delivery items/.test(els.whatifBanner.innerHTML) &&
        /18 of 40 epics/.test(els.whatifBanner.innerHTML),
        "delivery scope keeps the two-population wording");
C.setState("whatIf", false);
C.renderAll_();
// n-aware CEO-brief verdict, live FY26 Q4-shaped fixture
var bHealthy = C.briefFor_(
  { res: 402, resDue: 308, resAssigned: 351, resAttr: 178, resReady: 164,
    epics: 402, epicsEst: 91, epicsTime: 49 },
  { tracked: 55756, trackedCov: 50605, weeks: 2198, capEst: 54 });
assert_(/n=164 and Forecast on n=49/.test(bHealthy.concerns[0]),
        "concern #1 carries the live n values");
assert_(/real rates, but 59% of the work stays unmeasured/.test(bHealthy.concerns[0]),
        "healthy n → share-unmeasured verdict (1 − 164/402 = 59%)");
assert_(!/not meaningful/.test(bHealthy.concerns[0]),
        "…and no false 'not meaningful' judgment at n=164");
var bTiny27 = C.briefFor_(
  { res: 100, resDue: 80, resAssigned: 94, resAttr: 54, resReady: 50,
    epics: 18, epicsEst: 4, epicsTime: 3 },
  { tracked: 4000, trackedCov: 3800, weeks: 100, capEst: 3 });
assert_(/publishable, not meaningful/.test(bTiny27.concerns[0]),
        "sub-floor n (Forecast n=3) keeps the honesty verdict");
assert_(JSON.stringify(bHealthy).indexOf("Due date set on the work") !== -1,
        "due-date gap says 'set' — due dates alone, distinct from the roster-joined funnel stage");

// ══════════════════════════════════════════════════════════════════════════
// 28. ANALYSIS-PERIOD PICKER (user request 2026-08-04): the reader chooses
// WHICH complete period drives the tiles, comparison, headroom and brief —
// the unit chips only chose the granularity. Latest stays the default; the
// People grid stays pinned to the current weeks by design.
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
assert_(/unattributed \(export window\)/.test(els.tiles.innerHTML),
        "the whole-window unattributed count says which window it counts");
C.setState("periodIdx", null);
C.renderAll_();
assert_(/Last complete week · 2026\.W31/.test(els.scopeChip.innerHTML),
        "clearing the selection returns to the latest complete period");

// ══════════════════════════════════════════════════════════════════════════
// 29. POP/ROLE LENS RE-CASCADES THE FILTER ROW (user report 2026-08-04:
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
// 30. THE BRIEF NAMES ITS OWN SCOPE (user report 2026-08-04: with filters
// active, a copied brief read as if it honored them). The counts are
// deliberately whole-population — feed-level records have no person to filter
// by — so active filters must be NAMED as not applying, never silently
// ignored, and the scope line must travel with 📋 Copy.
// ══════════════════════════════════════════════════════════════════════════
fresh(model({}));
C.setState("region", ""); C.setState("team", ""); C.setState("pop", "fte");
C.renderHygiene_();
var scoped0 = els.viewHygiene.innerHTML;
assert_(/Scope: 2026\.W31 · whole delivery population/.test(scoped0),
        "brief names its window and the whole-population rule");
assert_(!/Active filters NOT applied/.test(scoped0),
        "…with no filter caveat when nothing is filtered");
assert_(/Scope: 2026\.W31/.test(C.STATE._briefText),
        "the scope line travels with the copied text");
C.setState("region", "AMER"); C.setState("team", "Team A"); C.setState("pop", "crew");
C.renderHygiene_();
var scoped1 = els.viewHygiene.innerHTML;
assert_(/Active filters NOT applied here: population Crew · AMER · Team A/.test(scoped1),
        "active filters are named as deliberately not applying");
assert_(/Active filters NOT applied here/.test(C.STATE._briefText),
        "…and the caveat is in the copied text too");
// the numbers themselves must NOT move under person filters — whole population
function briefFact0_(s) { return s.split("Top 3 Facts")[1].split("<h5>")[0]; }
assert_(briefFact0_(scoped0) === briefFact0_(scoped1),
        "person filters never change the feed-level counts — only the scope line changes");
C.setState("region", ""); C.setState("team", ""); C.setState("pop", "fte");
C.renderHygiene_();

console.log("✅ render-smoke: " + checks + " checks passed");
