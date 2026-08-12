// Render smoke harness — executes every ViewDash renderer against a synthetic
// payload with a stub DOM. Catches "renderer throws on real-ish data" bugs the
// parse check can't. Run: node render_smoke.js
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "ViewDash.html"), "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/<\?[=!]?[\s\S]*?\?>/g, "admin");

// ── DOM / environment stubs ─────────────────────────────────────────────────
function el() {
  return {
    innerHTML: "", textContent: "", value: "", style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild() {}, insertBefore() {}, contains: () => false,
    querySelectorAll: () => [], addEventListener() {}, setAttribute() {},
    removeAttribute() {}, scrollIntoView() {}, clientWidth: 900, rows: [],
  };
}
const els = {};
global.document = {
  getElementById: id => (els[id] = els[id] || el()),
  createElement: () => el(),
  querySelectorAll: () => [],
  addEventListener() {},
  documentElement: el(),
};
global.window = { innerWidth: 1280, addEventListener() {} };
let store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const chain = { withSuccessHandler: () => chain, withFailureHandler: () => chain,
  getCompReportData() {}, getAccessSettings() {}, saveAccessSettings() {},
  getOverviewActions() {}, saveOverviewAction() {} };
global.google = { script: { run: chain } };

let fails = 0;
function check(desc, cond) { if (!cond) { fails++; console.log("❌ " + desc); } }

// ── synthetic payload ───────────────────────────────────────────────────────
const months = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
const mkMonthly = arr => months.map((_, i) => ({ terms: arr[i] || 0, vol: arr[i] || 0, invol: 0 }));
const fy = (label, terms, reg, hc, monthly) => ({
  label, monthly: mkMonthly(monthly), quarterly: [0,1,2,3].map(q => ({
    terms: (monthly[q*3]||0)+(monthly[q*3+1]||0)+(monthly[q*3+2]||0), vol: 0, invol: 0 })),
  total: terms, vol: terms, invol: 0, regretted: reg, avgHeadcount: hc,
  rate: hc > 0 ? terms / hc : null,
});
const signals0 = { retentionRisk: false, recognitionRisk: false, promoStale: false,
  earlyCareer: false, riskFactors: [], everPromoted: true, invisibleContributor: false };
const emp = (n, o) => Object.assign({
  empNo: "E" + n, name: "Person " + n, jobTitle: "Engineer", level: "I4", dept: "Services",
  keyLocation: "Malaysia", currency: "MYR", employmentType: "regular",
  tcc: 100000, tccUsd: 22000, ratio: 0.97, marketRatio: 0.95, anchorTier: "title",
  p25: 90000, p50: 105000, p75: 120000, benchSource: "src", suggestion: { status: "at-market" },
  perfAvg: 4.1, perfWindowLatest: 4, perfCount: 4, perfTotalCount: 6,
  tenureCompanyYears: 3.2, tenureProfileYears: 1.4, ttmGrowthPct: 0.06,
  contrib: null, signals: Object.assign({}, signals0),
  priority: { score: 61, partial: false, missing: [], components: { perf: .8, tenure: .4, compaGap: .1 } },
}, o || {});
const D = {
  ok: true,
  meta: {
    generatedAt: "2026-07-29T04:00:00.000Z", role: "admin", email: "x@sr.com", fromCache: true,
    fyLabel: "FY27", prevFyLabel: "FY26", qLabel: "Q1", monthLabels: months,
    fiscalMonthIdx: 0, fyStartCalYear: 2026, asOf: "2026-07-29",
    sources: { roster: "ok", history: "ok", ratings: "ok", benchmarks: "ok", contribution: "ok" },
    genderAvailable: true, tccUsdAvailable: true, employmentTypeAvailable: true,
    employmentCounts: { partTime: 1, intern: 0 },
    restricted: { hidden: 0, minMLevel: 9 }, activeCount: 218, ratingsCount: 400,
    benchCoverage: { rows: 40, matchedEmployees: 120, currencyMismatch: 1 },
    contribUrl: "https://example.org",
    compaBands: { low: 0.8, target: 0.95, high: 1.1 }, marketLow: 0.9,
    priorityCfg: { weights: { perf: 57, tenure: 29, compaGap: 14 },
      caps: { companyYears: 10, profileYears: 5, gapPct: 0.25 }, ratingMax: 5 },
    equityCfg: { gapPct: 10, outlierPct: 25, tenureYearsMin: 3, tenureBelowPct: 15, smallGroupMin: 3 },
    supervisorAvailable: true,
    ragCfg: { attritionTotal: { green: 0.11, yellow: 0.14 }, attritionVol: { green: 0.09, yellow: 0.12 },
      regrettedShare: { green: 0.25, yellow: 0.35 }, peerVolBand: { low: 0.11, high: 0.15 },
      concentration: 0.5, floorHeads: 10, floorExits: 3, spanTarget: 6, spanNarrow: 4, spanWide: 10,
      mgrMinReports: 3, forecastMinMonths: 6 },
    signalsCfg: { perfWindowQuarters: 4, windowFqs: ["FY26Q1","FY26Q2","FY26Q3","FY26Q4"],
      promoStaleYears: 3, earlyCareerLevels: "I1–I3", coreLevels: "I3–I4",
      recogMinRating: 4.5, recogMaxTtm: 0.05, riskFactorMin: 2, invisibleMinScore: 0.75, invisibleWeakSi: 4 },
    contribution: { quarter: "FY26Q4", matched: 210 },
    benchmarks: { sources: ["Mercer 2025"] }, glossary: [{ term: "TCC", def: "Total cash comp" }],
  },
  employees: [
    emp(1), emp(2, { ratio: 0.72 }),
    emp(3, { signals: Object.assign({}, signals0, { retentionRisk: true, riskFactors: ["below-anchor", "flat-ttm"] }) }),
    emp(4, { signals: Object.assign({}, signals0, { recognitionRisk: true }) }),
    emp(5, { contrib: { quarter: "FY26Q4", score: 0.82, goalCompliant: true, goalsTotal: 8,
      ptoCompliance: 0.9, trackedCoverage: 0.85, trackedHrs: 400, rcr: 1.1, kudosReceived: 2, kudosGiven: 1 } }),
  ],
  people: [
    { name: "Person 1", dept: "Services", level: "I4", keyLocation: "Malaysia",
      hireDate: "2023-01-01", termDate: null, termCls: null, regretted: false },
    { name: "Leaver", dept: "Services", level: "I3", keyLocation: "Malaysia",
      hireDate: "2022-01-01", termDate: "2026-07-15", termCls: "vol", regretted: true },
  ],
  attrition: {
    currentFY: fy("FY27", 3, 2, 218, [3]),
    previousFY: fy("FY26", 40, 12, 210, [4,3,3,4,3,3,4,3,3,4,3,3]),
    previousFYSamePeriod: fy("FY26 same period", 4, 1, 210, [4]),
    slices: {
      department: [{ key: "Services", terms: 2, vol: 2, invol: 0, headcount: 100, rate: 0.02 },
                   { key: "Sales", terms: 1, vol: 1, invol: 0, headcount: 40, rate: 0.025 }],
      level: [], keyLocation: [],
    },
    detail: [{ termDate: "2026-07-15", name: "Leaver", dept: "Services", level: "I3",
      keyLocation: "Malaysia", cls: "vol", regretted: true, reason: "Another Job" }],
    forecast: { months: [], projectedTotal: 30, annualizedRate: 0.13, method: "run-rate" },
    financialImpact: { annualPayrollReleasedUsd: 200000, regrettedPortionUsd: 90000,
      coverage: { counted: 3, total: 3 } },
  },
  managers: { available: true,
    rows: [{ name: "Mgr A", teamSize: 8, exitsFY: 2, voluntaryExits: 2, attritionRate: 0.25, dept: "Services" },
           { name: "Mgr B", teamSize: 12, exitsFY: 0, voluntaryExits: 0, attritionRate: 0.05, dept: "Sales" }],
    pooledSmallTeams: null, spanOfControl: { managers: 30, ics: 180, ratio: 6, target: 6 } },
  verdicts: [
    { id: "headcount", view: "overview", severity: "FACT", fact: "Headcount stable at 218 active (215 at FY27 start).", soWhat: "No shift.", action: "", caveat: "" },
    { id: "attr-total", view: "attrition", severity: "NOTE", fact: "FY27 total attrition 1.4% (FY26 same period 1.9%).", soWhat: "Watch.", action: "", caveat: "Small sample (3 exits) — too few to read as a trend." },
    { id: "attr-vol", view: "attrition", severity: "FACT", fact: "FY27 voluntary attrition 0.9% vs professional-services peers 11.0%–15.0%.", soWhat: "Below the peer band.", action: "", caveat: "" },
    { id: "regretted", view: "attrition", severity: "NOTE", fact: "100.0% of FY27 voluntary exits were regretted (2 of 2).", soWhat: "…", action: "Run an exit-driver review with the HRBP; prioritize stay-interviews.", caveat: "Small sample (2 exits) — too few to read as a trend." },
    { id: "mgr-hotspots", view: "attrition", severity: "RISK", fact: "1 of 2 teams (managers with 3+ reports) show attrition above 14.0% — the manager may need support.", soWhat: "…", action: "Offer skip-level support conversations for the flagged teams this quarter (identities stay in the Attrition view's manager hotspots, not in decks).", caveat: "" },
    { id: "compa-below", view: "compa", severity: "RISK", fact: "1 Rocketeer sits below 0.80 of their peer anchor.", soWhat: "…", action: "Review the flagged cases with the HRBP before the next comp cycle closes (Internal Position view, red chips).", caveat: "" },
    { id: "fy-caveat", view: "overview", severity: "NOTE", fact: "FY27 figures rest on 3 exits so far.", soWhat: "Too few to read.", action: "", caveat: "" },
  ],
  compaGroups: [{ keyLocation: "Malaysia", jobTitle: "Engineer", count: 2, anchorTier: "title",
    smallGroup: false, missingTcc: 0, anchor: 103000, currency: "MYR",
    members: [{ empNo: "E1", name: "Person 1", level: "I4", tcc: 100000, tccUsd: 22000,
      currency: "MYR", ratio: 0.97, nonComparable: false, noPeers: false }] }],
  equity: { genderAvailable: true,
    gender: [{ keyLocation: "Malaysia", level: "I4", counts: { F: 3, M: 4 },
      medians: { F: 100000, M: 104000 }, gapPct: 4, flagged: false }],
    outliers: [{ empNo: "E2", name: "Person 2", keyLocation: "Malaysia", level: "I4",
      tcc: 70000, groupMedian: 100000, pctBelow: 30 }],
    tenure: [] },
  qtaInterim: [{ empNo: "E1", name: "Person 1", dept: "Services", keyLocation: "Malaysia",
    level: "I4", nextReview: "2026-06-01", daysOverdue: 58, lastEventReason: "Merit",
    lastEventDate: "2025-06-01" }],
  history: { E1: { events: [{ date: "2023-01-01", reason: "New Hire", tcc: 90000, deltaAbs: null,
    tag: null, annualized: null }], overallAnnualized: 0.05,
    ratings: [{ fq: "FY26Q4", rate: 4, explanation: "solid" }] } },
};

// ── run ─────────────────────────────────────────────────────────────────────
// const/let inside eval don't escape to module scope — export what we need.
eval(js + "\n;global.__X = { STATE, VIEWS, RENDERERS, renderOverview, isoWeekLabel, " +
  "isoWeekFull, prevYearIso, fiscalQuarterEndIso };");
const { STATE, VIEWS, RENDERERS, renderOverview, isoWeekLabel, isoWeekFull,
        prevYearIso, fiscalQuarterEndIso } = global.__X;
STATE.data = D;
STATE.actions = { "compa-below": { state: "done", owner: "WFP", by: "x@sr.com", at: "2026-07-28T10:00:00Z" } };
STATE.actionsLoaded = true;

const pane = el();
Object.keys(RENDERERS).forEach(id => {
  try { RENDERERS[id](pane); }
  catch (e) { fails++; console.log("❌ renderer '" + id + "' threw: " + e.message); }
});

// Overview-specific assertions
const ov = el();
renderOverview(ov);
const H = ov.innerHTML;
check("facts: leads with voluntary-vs-peer-band", H.indexOf("voluntary attrition 0.9%") <
  H.indexOf("total attrition 1.4%") && H.indexOf("voluntary attrition 0.9%") !== -1);
check("facts: capped — regretted sentence NOT in facts paragraph",
  H.indexOf("were regretted") > H.indexOf("🚦 Signals"));
check("facts: fy-caveat surfaces", /rest on 3 exits/.test(H));
check("signals: read-only groups render (Concerns + Notes)",
  /Concerns/.test(H) && /Notes/.test(H) && /factlink/.test(H));
check("signals: NO action queue on Overview", !/Action queue/.test(H));
check("small-n: attrition card is count-primary (3 exits)", /3 exits<\/div>/.test(H));
check("small-n: no trend arrow on the tiny attrition base", !/▲|▼/.test(H.split("Are people staying?")[1].split("kpi-q")[0] || ""));
check("cards: band bar + marker present", /bandbar/.test(H) && /class="mk"/.test(H));
check("cards: one question per card", /Are people staying\?/.test(H) && !/Is my team healthy\? Are people staying\?/.test(H));
check("cards: contribution has a real number", />210</.test(H) || /210<\/div>/.test(H));
check("cards: zero state recedes (✓ 0 render)", !/kpi zero/.test(H) || /✓ 0/.test(H));
check("chart: bars not spark line", /rect x=/.test(H) && /terminations by fiscal month/.test(H));
check("chart: series uses Orbe, not warn yellow", !/svgSpark/.test(js) && /fill="var\(--cta\)"/.test(H));
check("provenance: as-of + sources + exclusion rules", /As of 2026-07-29/.test(H) &&
  /Sources: Roster ✓/.test(H) && /exclusion rules/.test(H));
check("chips row gone: no 'in one paragraph' strip", !/in one paragraph/.test(H));
check("a11y: no color-only status — glyphs present", /font-weight:700">[✓!✕]/.test(H));

// 📌 Action Queue view (admin-only) — the workflow that used to sit on Overview
const aq = el();
RENDERERS.actions(aq);
const AQ = aq.innerHTML;
check("queue: rows exist with due ISO week + dates", /Action queue/.test(AQ) && /due 2026\.W\d\d · /.test(AQ));
check("queue: done row stamped by user", /done by x/.test(AQ));
check("queue: owner input persisted value", /value="WFP"/.test(AQ));
check("queue: tab is admin-only in VIEWS",
  VIEWS.find(v => v.id === "actions").roles.join() === "admin");
check("managers: standalone tab removed", !VIEWS.find(v => v.id === "managers") && !RENDERERS.managers);

// 📉 Attrition owns manager hotspots — outliers only, healthy teams as a count
const at = el();
RENDERERS.attrition(at);
const AT = at.innerHTML;
check("attrition: hotspots card shows only the outlier team",
  /Manager hotspots/.test(AT) && /Mgr A/.test(AT) && !/Mgr B/.test(AT));
check("attrition: healthy teams summarized, never listed",
  /1 team within threshold not listed/.test(AT));
check("attrition: span of control line carried over", /Span of control/.test(AT));
check("attrition: manager verdicts render here", /manager may need support/.test(AT));

// changed-since strip: seed an older week, re-render, expect movement line
store = {};
localStorage.setItem("cd_ov_snap", JSON.stringify({ week: "2026.W28",
  vals: { "Attrition": { v: 0.010, fmt: "pct" }, "Equity flags": { v: 0, fmt: "int" } } }));
renderOverview(ov);
check("changed-since: reports movement vs stored week", /Changed since 2026\.W28/.test(ov.innerHTML));

// filtered mode should not throw and should mark cards filtered
STATE.filters.loc = "Malaysia";
try { renderOverview(ov); check("filtered overview renders", /filtered/.test(ov.innerHTML)); }
catch (e) { fails++; console.log("❌ filtered overview threw: " + e.message); }
STATE.filters.loc = "";

// ISO week helpers
check("isoWeek: 2026-07-29 → 2026.W31", isoWeekLabel("2026-07-29") === "2026.W31");
check("isoWeek: range renders dates", /2026\.W31 · Jul 27–Aug 2/.test(isoWeekFull("2026-07-29")));
check("isoWeek: Jan 1 belongs to prior ISO year when applicable", isoWeekLabel("2027-01-01") === "2026.W53");
check("prevYearIso: clamps Feb 29", prevYearIso("2024-02-29") === "2023-02-28");
check("quarter end: Jul → Sep 30", fiscalQuarterEndIso("2026-07-29") === "2026-09-30");

console.log(fails === 0 ? "✅ render smoke: all checks passed" : fails + " check(s) failed");
process.exit(fails ? 1 : 0);
