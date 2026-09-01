// Cross-project parity: the EXPORT's deep window and the DASHBOARD's deep
// window must be the same depth on the same day.
// Usage: node tests/ps-dashboard/quarter-window-parity.js
//
// WHY THIS FILE EXISTS (2026-08-24): the window is now counted in fiscal
// quarters, and the rule for "which quarter does this ISO week belong to" is
// implemented TWICE — jb_fiscalQuarterOfMonday_ in ps-dashboard/Jira Backlog.js
// and periodInfoForIso_ in delivery-health-dashboard/Code.js. They are separate
// Apps Script projects and cannot share a module.
//
// If they ever disagree, nothing errors. The export publishes a window whose
// oldest quarter the dashboard draws one week wider, that quarter renders as
// PARTIAL, drops out of every trend, and the weeks the export never covered
// read as ZERO DELIVERY. That is the same failure shape as the missing
// in-flight week, one boundary over — and the reason a whole day went into
// finding it the first time is that it looks like an idle team, not a bug.
const fs = require("fs");
const path = require("path");

let CHECKS = 0;
function assert_(cond, msg) {
  CHECKS++;
  if (!cond) { console.error("❌ " + msg); process.exit(1); }
}

const stubs = `
  global.Logger = { log: function () {} };
  global.SpreadsheetApp = { getActiveSpreadsheet: function () { return {}; } };
  global.UrlFetchApp = {};
  global.LockService = {};
  global.CacheService = { getScriptCache: function () { return {}; } };
  global.ScriptApp = { WeekDay: { MONDAY: 1 }, getProjectTriggers: function () { return []; } };
  global.PropertiesService = { getScriptProperties: function () {
    return { getProperty: function () { return null; }, setProperty: function () {},
             setProperties: function () {}, getProperties: function () { return {}; } }; } };
  global.Utilities = { sleep: function () {} };
  global.Session = { getActiveUser: function () { return { getEmail: function () { return ""; } }; } };
  global.normalizeName_ = function (n) { return String(n || ""); };
`;
eval(stubs);

// Each project is evaluated in its own function scope so their same-named
// helpers cannot shadow each other — that would make a disagreement invisible,
// which is the one thing this file exists to prevent.
function loadExporter() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "ps-dashboard", "Jira Backlog.js"), "utf8");
  const out = {};
  (function () {
    eval(src + "\n;out.weeksFor = jb_completedWeeksForQuarters_;" +
                "\n;out.quarterOf = jb_fiscalQuarterOfMonday_;" +
                "\n;out.CONFIGJ = CONFIGJ;");
  })();
  return out;
}
function loadDashboard() {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "delivery-health-dashboard", "Code.js"), "utf8");
  const out = {};
  (function () {
    eval(src + "\n;out.buildWindow = buildDhWindow_;" +
                "\n;out.periodInfo = periodInfoForIso_;" +
                "\n;out.CONFIG_DH = CONFIG_DH;");
  })();
  return out;
}

const EXP = loadExporter();
const DASH = loadDashboard();

// ── 1. The two dials agree ─────────────────────────────────────────────────
assert_(EXP.CONFIGJ.RAW_HISTORY_QUARTERS === DASH.CONFIG_DH.DEEP_QUARTERS,
        "CONFIGJ.RAW_HISTORY_QUARTERS (" + EXP.CONFIGJ.RAW_HISTORY_QUARTERS +
        ") === CONFIG_DH.DEEP_QUARTERS (" + DASH.CONFIG_DH.DEEP_QUARTERS + "). " +
        "If the dashboard asks for more quarters than the export carries, the " +
        "difference renders as zero delivery, not as missing data.");

// ── 2. THE CRUX: same depth, every week of two years ──────────────────────
// Two years, not one: the FY boundary (30 June / 1 July) and the ISO year
// boundary fall in different places, and a rule that agrees in 2026 can part
// company in 2027 on the week that straddles them.
let sameDepth = 0, spans = [];
let d = new Date(2026, 0, 5);   // a Monday
for (let w = 0; w < 104; w++) {
  const expWeeks = EXP.weeksFor(EXP.CONFIGJ.RAW_HISTORY_QUARTERS, d);
  const dashWeeks = DASH.buildWindow(d).deepWeeks;
  assert_(expWeeks === dashWeeks,
          "same deep window on " + d.toDateString() + " — exporter says " + expWeeks +
          " completed weeks, dashboard says " + dashWeeks);
  sameDepth++;
  spans.push(expWeeks);
  d = new Date(d.getTime());
  d.setDate(d.getDate() + 7);
}
assert_(sameDepth === 104, "checked every week of two years, got " + sameDepth);

// ── 3. The quarter RULE itself agrees, week by week ───────────────────────
// Depth parity could hold by luck while the underlying assignment differs on a
// week neither window happens to touch. Compare the rule directly.
d = new Date(2026, 0, 5);
for (let w = 0; w < 104; w++) {
  const mon = new Date(d.getTime());
  const iso = DASH.buildWindow(mon).gridWeeks.filter(function (g) { return g.status === "now"; })[0].iso;
  const dashQ = DASH.periodInfo(iso).quarter;
  const expQ = EXP.quarterOf(mon);
  assert_(expQ === dashQ,
          "same fiscal quarter for the week of " + mon.toDateString() + " (" + iso + ") — " +
          "exporter says " + expQ + ", dashboard says " + dashQ);
  d.setDate(d.getDate() + 7);
}

// ── 4. The span stays inside the bounds both sides assume ─────────────────
// Measured over 10 years of weekly anchors: 25–39 completed weeks. The 25 is a
// single anchor per decade (Mon 2027-06-28, first week of FY28Q1) where two
// short quarters line up. It is BELOW WALKBACK_MAX_WEEKS (26) and that is fine:
// inventoryWalkback_ slices `weeks.slice(-cap)`, so a shorter series draws
// fewer points rather than failing — the horizon is a CAP, not a requirement.
// What must hold is the structural floor: two quarters are never shorter than
// 24 ISO weeks, and anything under that would mean the alignment walk is wrong.
const lo = Math.min.apply(null, spans), hi = Math.max.apply(null, spans);
assert_(lo >= 24,
        "the shallowest window (" + lo + "w) still spans two whole quarters (>= 24w) — " +
        "below that the quarter walk has miscounted, not merely landed on a short quarter");
assert_(hi <= 52,
        "the deepest window (" + hi + "w) stays inside the shared 52-week export ceiling");

console.log("✅ quarter-window-parity: exporter and dashboard agree on " + sameDepth +
            " weekly anchors (span " + lo + "–" + hi + "w) — " + CHECKS + " assertions");
