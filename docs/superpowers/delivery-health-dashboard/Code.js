// ============================================================
// SCRIPT NAME: Delivery Health Dashboard (4-tile: Utilization,
//              On-Time Delivery, Forecast Accuracy, Rework-placeholder)
// PURPOSE:     Standalone GAS web app. Reads Tempo/NS/Jira tabs +
//              Roster by spreadsheet ID, builds one person×week +
//              Jira-bucket model, serves Dashboard.html.
// ACCESS:      Email allowlist — see Security.js (checkDeliveryAccess()).
// SPEC:        docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md
// ============================================================

var CONFIG_DH = {
  // ── Sources (Script Properties DH_SOURCE_SS_ID / DH_ROSTER_SS_ID override) ──
  SOURCE_SS_ID:      "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // Tempo hours SS
  ROSTER_SS_ID:      "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  CAPACITY_SHEET:    "Capacity Tempo",
  TRACKED_SHEET:     "Tempo Tracked Time",
  PLANNED_SHEET:     "Planned Time Tempo",
  NS_SHEET:          "NS Billable",
  PH_SHEET:          "PH",
  JIRA_RAW_SHEET:    "Jira Raw",
  ROSTER_SHEET:      "Data",
  CONTRACTORS_SHEET: "Contractors Data",
  ROSTER_CLASS:      "Professional Services",
  ROSTER_DEPT:       "Services",
  NONPROJECT_KEYS:   ["NETSUITE"],       // time-off rows (case-insensitive)

  // ── Window ──
  WEEKS_PAST_GRID:   2,   // completed weeks shown in the grid
  WEEKS_PAST_TREND:  6,   // completed weeks aggregated for tile trends
  WEEKS_FUTURE:      3,

  // ── Capacity fallbacks (used only when Capacity Tempo has no cell) ──
  WEEKLY_CAPACITY_HRS:     40,
  ANZ_LOCATION:            "Australia & New Zealand",
  ANZ_CAPACITY_HRS:        38,
  HOLIDAY_HRS_PER_DAY:     8,
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,

  // ── Region buckets: roster "Key Location" → bucket (FALLBACK lens only;
  //    primary person-region = majority of Jira-tagged tracked hours).
  //    Extend after the W32 Key Location audit (spec §10.2). ──
  LOCATION_REGION_MAP: {
    "australia & new zealand": "ANZ",
    "malaysia": "APAC", "singapore": "APAC", "philippines": "APAC",
    "united states": "AMER", "canada": "AMER", "costa rica": "AMER",
    "chile": "AMER", "colombia": "AMER", "mexico": "AMER",
    "united kingdom": "EMEA", "spain": "EMEA", "portugal": "EMEA",
  },
  REGION_FALLBACK: "Other",

  // ── RAG tint thresholds (billable util %, spec §10.3) ──
  TINT_GREEN: 70,
  TINT_AMBER: 50,

  TITLE: "Delivery Health Dashboard",

  // ── Cache ──
  CACHE_TTL_SEC:        3900,
  CACHE_WARM_EVERY_MIN: 30,
};

// ── ISO WEEK HELPERS (Monday-start, ISO-8601 — ported from demand Code.js) ──

function isoWeekNum_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_(year) {
  return isoWeekNum_(new Date(Date.UTC(year, 11, 28)));
}

/** "YYYY.WN" label for any Date (used to bucket NS daily rows + Jira dates). */
function weekKeyFromDate_(date) {
  return isoWeekYear_(date) + ".W" + isoWeekNum_(date);
}

/**
 * Rolling window anchored on `today` (injectable for tests).
 * @returns {{ gridWeeks: Array<{iso:string,status:string}>,
 *             trendWeeks: string[],       // 6 completed, oldest first
 *             allWeeks: string[],         // union, oldest first
 *             headlineIso: string }}
 */
function buildDhWindow_(today) {
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  function shift(off) {
    var w = curW + off, y = curY;
    while (w <= 0) { y--; w += weeksInYear_(y); }
    while (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
    return y + ".W" + w;
  }
  var trendWeeks = [], gridWeeks = [], allWeeks = [];
  for (var t = -CONFIG_DH.WEEKS_PAST_TREND; t <= -1; t++) trendWeeks.push(shift(t));
  for (var off = -CONFIG_DH.WEEKS_PAST_GRID; off <= CONFIG_DH.WEEKS_FUTURE; off++) {
    gridWeeks.push({ iso: shift(off), status: off < 0 ? "done" : (off === 0 ? "now" : "plan") });
  }
  for (var a = -CONFIG_DH.WEEKS_PAST_TREND; a <= CONFIG_DH.WEEKS_FUTURE; a++) allWeeks.push(shift(a));
  return { gridWeeks: gridWeeks, trendWeeks: trendWeeks, allWeeks: allWeeks,
           headlineIso: shift(-1) };
}

// ── TESTS ────────────────────────────────────────────────────

function _test_dhWindow_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_dhWindow_: " + m); }
  // 2026-07-31 is a Friday in ISO 2026.W31
  var w = buildDhWindow_(new Date(2026, 6, 31));
  assert_(w.gridWeeks.length === 6, "grid = 6 weeks");
  assert_(w.gridWeeks.map(function (x) { return x.iso; }).join("|") ===
          "2026.W29|2026.W30|2026.W31|2026.W32|2026.W33|2026.W34", "grid labels");
  assert_(w.gridWeeks[2].status === "now" && w.gridWeeks[0].status === "done" &&
          w.gridWeeks[5].status === "plan", "statuses");
  assert_(w.trendWeeks.join("|") ===
          "2026.W25|2026.W26|2026.W27|2026.W28|2026.W29|2026.W30", "trend = 6 completed");
  assert_(w.headlineIso === "2026.W30", "headline = last completed");
  assert_(w.allWeeks.length === 10 && w.allWeeks[0] === "2026.W25" &&
          w.allWeeks[9] === "2026.W34", "allWeeks spans trend→future");
  // Year boundary: 2026-01-01 is Thursday of ISO 2026.W1 → past weeks wrap into 2025
  var y = buildDhWindow_(new Date(2026, 0, 1));
  assert_(y.trendWeeks[0].indexOf("2025.") === 0, "trend wraps into prior ISO year");
  assert_(weekKeyFromDate_(new Date(2026, 6, 27)) === "2026.W31", "Mon 2026-07-27 → W31");
  assert_(weekKeyFromDate_(new Date(2026, 7, 2)) === "2026.W31", "Sun 2026-08-02 → W31");
  Logger.log("✅ _test_dhWindow_ passed");
}
