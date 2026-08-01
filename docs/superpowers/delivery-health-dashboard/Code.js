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

// ── NAME JOINS ───────────────────────────────────────────────

/** Canonical name key — same convention as normPS_ in the PS report. */
function normDH_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * All normalized variants a source cell may appear as. "Last, First" cells
 * (NS Billable / Planned) also produce "First Last" and "Last First".
 * @returns {string[]} deduped normalized keys
 */
function nameAliases_(raw) {
  var norm = normDH_(raw);
  if (!norm) return [];
  var out = [norm];
  var m = norm.match(/^([^,]+),\s*(.+)$/);
  if (m) {
    var flipped = normDH_(m[2] + " " + m[1]);   // "first last"
    var spaced  = normDH_(m[1] + " " + m[2]);   // "last first"
    if (out.indexOf(flipped) === -1) out.push(flipped);
    if (out.indexOf(spaced) === -1) out.push(spaced);
  }
  return out;
}

/** Roster display names → lookup index: every alias key → display name. */
function buildNameIndex_(displayNames) {
  var idx = {};
  displayNames.forEach(function (dn) {
    nameAliases_(dn).forEach(function (k) { if (!(k in idx)) idx[k] = dn; });
    // Also index the "Last, First" form of a "First Last" roster name so
    // comma-form source cells resolve: "Maria Alvarez" → key "alvarez, maria".
    var parts = normDH_(dn).split(" ");
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var first = parts.slice(0, -1).join(" ");
      var commaKey = normDH_(last + ", " + first);
      if (!(commaKey in idx)) idx[commaKey] = dn;
      var lastFirstKey = normDH_(last + " " + first);
      if (!(lastFirstKey in idx)) idx[lastFirstKey] = dn;
    }
  });
  return idx;
}

/** Resolves a raw source-cell name to the roster display name, else null. */
function resolveName_(idx, raw) {
  var aliases = nameAliases_(raw);
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] in idx) return idx[aliases[i]];
  }
  return null;
}

// ── TEAM SPLIT (spec: filter = individual Tempo teams, membership match) ──

/** "Team A | Team B" → ["Team A","Team B"], trimmed, deduped, blanks dropped. */
function splitTeams_(cell) {
  var seen = {}, out = [];
  String(cell || "").split("|").forEach(function (t) {
    var v = t.trim();
    if (v && !(v.toLowerCase() in seen)) { seen[v.toLowerCase()] = 1; out.push(v); }
  });
  return out;
}

// ── NS BILLABLE WEEK AGGREGATION ─────────────────────────────

/**
 * Daily NS rows → { normName: { iso: {billable, nonBillable} } }.
 * @param {Array<{name:string,date:Date,billable:number,nonBillable:number}>} rows
 */
function aggregateNsWeeks_(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!r.date || isNaN(r.date.getTime())) return;
    var key = normDH_(r.name);
    if (!key) return;
    var iso = weekKeyFromDate_(r.date);
    if (!map[key]) map[key] = {};
    if (!map[key][iso]) map[key][iso] = { billable: 0, nonBillable: 0 };
    map[key][iso].billable += Number(r.billable) || 0;
    map[key][iso].nonBillable += Number(r.nonBillable) || 0;
  });
  return map;
}

// ── NET CAPACITY (spec §4) ───────────────────────────────────

/**
 * available = max(0, cap − pto − effectiveHoliday);
 * effectiveHoliday = max(0, holidayHrs − pto) so a holiday already booked as
 * NETSUITE time-off is never counted twice (demand-dashboard convention).
 * @returns {{avail:number, hol:number}} hol = effective (deduped) holiday hours
 */
function netCapacity_(cap, pto, holidayHrs) {
  var c = Number(cap) || 0, p = Number(pto) || 0, h = Number(holidayHrs) || 0;
  var effHol = Math.max(0, h - p);
  return { avail: Math.max(0, c - p - effHol), hol: effHol };
}

// ── REGION RESOLUTION (spec: issue-level standard, roster fallback) ──

function regionBucketFromLocation_(keyLocation) {
  var k = normDH_(keyLocation);
  return CONFIG_DH.LOCATION_REGION_MAP[k] || CONFIG_DH.REGION_FALLBACK;
}

/**
 * Person region = region receiving the most Jira-tagged tracked hours in the
 * trend window; ties break alphabetically (deterministic). No tagged hours
 * (> 0) → roster-location fallback, labeled source:"roster".
 */
function assignPersonRegion_(hoursByRegion, rosterBucket) {
  var best = null, bestH = 0;
  Object.keys(hoursByRegion).sort().forEach(function (r) {
    var h = Number(hoursByRegion[r]) || 0;
    if (h > bestH) { best = r; bestH = h; }
  });
  if (best !== null && bestH > 0) return { region: best, source: "jira" };
  return { region: rosterBucket || CONFIG_DH.REGION_FALLBACK, source: "roster" };
}

// ── BAR OVERFLOW CLAMP (spec §5: clamp at 100% + ⚠ flag) ──────

function clampToCapacity_(hours, capacity) {
  var c = Number(capacity) || 0, h = Number(hours) || 0;
  if (c <= 0) return { pct: null, over: false, realPct: null };
  var real = h / c * 100;
  return { pct: Math.min(100, real), over: real > 100, realPct: Math.round(real) };
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

function _test_nameJoin_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nameJoin_: " + m); }
  assert_(normDH_("  Maria   ALVAREZ ") === "maria alvarez", "normalize whitespace+case");
  var a = nameAliases_("Alvarez, Maria");
  // "Last, First" cell → also match "First Last" and "Last First"
  assert_(a.indexOf("alvarez, maria") !== -1 && a.indexOf("maria alvarez") !== -1 &&
          a.indexOf("alvarez maria") !== -1, "comma cell yields all variants");
  var b = nameAliases_("Maria Alvarez");
  assert_(b.indexOf("maria alvarez") !== -1 && b.length === 1, "no-comma name = itself only");
  // Index build + lookup: NS "Last, First" resolves to roster "First Last"
  var idx = buildNameIndex_(["Maria Alvarez", "Tom Baker"]);
  assert_(resolveName_(idx, "ALVAREZ,  Maria") === "Maria Alvarez", "comma variant resolves");
  assert_(resolveName_(idx, "Tom Baker") === "Tom Baker", "exact resolves");
  assert_(resolveName_(idx, "Nobody Here") === null, "unknown → null");
  Logger.log("✅ _test_nameJoin_ passed");
}

function _test_teamSplit_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_teamSplit_: " + m); }
  assert_(splitTeams_("Team A | Team B").join("|") === "Team A|Team B", "split pipe-join");
  assert_(splitTeams_(" Team A ").join("|") === "Team A", "single team trimmed");
  assert_(splitTeams_("").length === 0 && splitTeams_(null).length === 0, "blank → []");
  assert_(splitTeams_("A | A | B").join("|") === "A|B", "dedup within a cell");
  Logger.log("✅ _test_teamSplit_ passed");
}

function _test_nsWeekBucketing_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nsWeekBucketing_: " + m); }
  var rows = [
    { name: "Maria Alvarez", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 }, // Mon W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 2),  billable: 4, nonBillable: 0 }, // Sun W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 3),  billable: 8, nonBillable: 0 }, // Mon W32
    { name: "Tom Baker",     date: new Date(2026, 6, 28), billable: 0, nonBillable: 8 },
  ];
  var m = aggregateNsWeeks_(rows);
  assert_(m["maria alvarez"]["2026.W31"].billable === 10, "Mon+Sun same ISO week");
  assert_(m["maria alvarez"]["2026.W31"].nonBillable === 2, "nonBillable summed");
  assert_(m["maria alvarez"]["2026.W32"].billable === 8, "Monday starts next week");
  assert_(m["tom baker"]["2026.W31"].billable === 0 && m["tom baker"]["2026.W31"].nonBillable === 8, "zero billable kept");
  Logger.log("✅ _test_nsWeekBucketing_ passed");
}

function _test_netCapacity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_netCapacity_: " + m); }
  // holiday hrs arg is the person's holiday hours that week BEFORE dedup vs booked PTO
  assert_(netCapacity_(40, 8, 0).avail === 32, "cap − pto");
  assert_(netCapacity_(40, 0, 8).avail === 32, "cap − holiday");
  // booked-holiday no-double-count: effective holiday = max(0, hol − pto)
  var n = netCapacity_(40, 8, 8);
  assert_(n.avail === 32 && n.hol === 0, "booked holiday not double-counted");
  var p = netCapacity_(40, 4, 8);
  assert_(p.hol === 4 && p.avail === 32, "partial booking subtracts remainder only");
  assert_(netCapacity_(32, 40, 0).avail === 0, "floor at 0");
  assert_(netCapacity_(0, 8, 0).avail === 0, "zero capacity stays 0");
  Logger.log("✅ _test_netCapacity_ passed");
}

function _test_regionMap_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionMap_: " + m); }
  assert_(regionBucketFromLocation_("Malaysia") === "APAC", "known location");
  assert_(regionBucketFromLocation_("  MALAYSIA ") === "APAC", "case/space insensitive");
  assert_(regionBucketFromLocation_("Atlantis") === "Other", "unknown → Other");
  assert_(regionBucketFromLocation_("") === "Other", "blank → Other");
  Logger.log("✅ _test_regionMap_ passed");
}

function _test_personRegion_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personRegion_: " + m); }
  // hoursByRegion from Key→Jira Raw join over the trend window
  var r = assignPersonRegion_({ "AMER": 60, "EMEA": 20 }, "APAC");
  assert_(r.region === "AMER" && r.source === "jira", "majority wins");
  var t = assignPersonRegion_({ "AMER": 40, "EMEA": 40 }, "APAC");
  assert_(t.region === "AMER" && t.source === "jira", "tie → alphabetical (deterministic)");
  var f = assignPersonRegion_({}, "APAC");
  assert_(f.region === "APAC" && f.source === "roster", "no tagged hours → roster fallback");
  var z = assignPersonRegion_({ "AMER": 0 }, "APAC");
  assert_(z.region === "APAC" && z.source === "roster", "zero hours = untagged");
  Logger.log("✅ _test_personRegion_ passed");
}

function _test_overflowClamp_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_overflowClamp_: " + m); }
  var ok = clampToCapacity_(30, 40);
  assert_(ok.pct === 75 && ok.over === false, "under capacity");
  var over = clampToCapacity_(44, 40);
  assert_(over.pct === 100 && over.over === true && over.realPct === 110, "clamped + flagged");
  assert_(clampToCapacity_(10, 0).pct === null, "zero capacity → null pct");
  Logger.log("✅ _test_overflowClamp_ passed");
}
