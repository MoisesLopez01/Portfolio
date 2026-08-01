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

// ── UTILIZATION ROLLUP (also mirrored client-side for filtering) ──

/**
 * Filter-scoped weekly sums. region/team null = All. Team matching is by
 * MEMBERSHIP (multi-team person counts in each of their teams — per-team
 * rates honest; team numbers do not sum to All by design, spec §4).
 * @returns {{avail,billable,tracked,planned,billablePct,trackedPct}}
 */
function utilRollup_(people, iso, region, team) {
  var s = { avail: 0, billable: 0, tracked: 0, planned: 0 };
  people.forEach(function (p) {
    if (region && p.region !== region) return;
    if (team && (p.teams || []).indexOf(team) === -1) return;
    var w = p.weeks && p.weeks[iso];
    if (!w) return;
    s.avail += Number(w.avail) || 0;
    s.billable += Number(w.billable) || 0;
    s.tracked += Number(w.tracked) || 0;
    s.planned += Number(w.planned) || 0;
  });
  s.billablePct = s.avail > 0 ? s.billable / s.avail * 100 : null;
  s.trackedPct = s.avail > 0 ? s.tracked / s.avail * 100 : null;
  return s;
}

// ── JIRA TILE BUCKETS (additive per iso×region×team, spec §11) ──

/** Issues with a Due Date, resolved → per-week on-time buckets. */
function onTimeBuckets_(issues) {
  var map = {};
  issues.forEach(function (it) {
    if (!it.due || !it.resolved || isNaN(it.due.getTime()) || isNaN(it.resolved.getTime())) return;
    var iso = weekKeyFromDate_(it.resolved);
    var region = it.region || "Other", team = it.team || "";
    var k = iso + "" + region + "" + team;
    if (!map[k]) map[k] = { iso: iso, region: region, team: team, n: 0, onTime: 0 };
    map[k].n++;
    // On time = resolved on or before the due CALENDAR DAY (time-of-day ignored)
    var d = new Date(it.due.getFullYear(), it.due.getMonth(), it.due.getDate());
    var r = new Date(it.resolved.getFullYear(), it.resolved.getMonth(), it.resolved.getDate());
    if (r <= d) map[k].onTime++;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/** Estimated, resolved epics → per-week forecast-accuracy buckets. */
function forecastBuckets_(epics) {
  var map = {};
  epics.forEach(function (ep) {
    var est = Number(ep.estSec) || 0;
    if (est <= 0 || !ep.resolved || isNaN(ep.resolved.getTime())) return;
    var spent = Number(ep.spentSec) || 0;
    var acc = Math.max(0, 1 - Math.abs(spent - est) / est);
    var iso = weekKeyFromDate_(ep.resolved);
    var region = ep.region || "Other", team = ep.team || "";
    var k = iso + "" + region + "" + team;
    if (!map[k]) map[k] = { iso: iso, region: region, team: team, n: 0, sumAcc: 0 };
    map[k].n++;
    map[k].sumAcc += acc;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

// ── CACHE (gzip chunked) ──────────────────────────────────────

var CACHE_CHUNK_BYTES_ = 90 * 1024; // CacheService hard-fails >100KB per value

/** Current cache version — Script Property DH_CACHE_VER (default 1). */
function deliveryCacheVer_() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty("DH_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch (e) { return 1; }
}

/**
 * Bumps DH_CACHE_VER, stranding all prior-version entries (they expire on TTL —
 * CacheService can't enumerate keys, so versioning is how invalidation works).
 * Run manually from the GAS editor to force-invalidate the cache.
 */
function bustDeliveryCache_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = (parseInt(props.getProperty("DH_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("DH_CACHE_VER", String(next));
    Logger.log("✅ bustDeliveryCache_: cache version bumped to " + next);
    return next;
  } catch (e) {
    Logger.log("⚠️ bustDeliveryCache_: " + e.message);
    return null;
  }
}

/** The single shared cache key for the delivery model. */
function deliveryCacheKey_() { return "dh_v" + deliveryCacheVer_(); }

/** Gzips + chunks `str` into `<key>_0..n` + `<key>_meta`. Returns true on success. */
function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    var b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    var entries = {};
    var n = 0;
    for (var i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    Logger.log("cachePutLarge_: " + key + " — " + str.length + " chars → " + b64.length + " b64 in " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

/** Reads a chunked entry; returns the JSON string or null on any miss. */
function cacheGetLarge_(cache, key) {
  try {
    var meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    var names = [];
    for (var i = 0; i < meta; i++) names.push(key + "_" + i);
    var got = cache.getAll(names);
    var b64 = "";
    for (var j = 0; j < meta; j++) {
      var part = got[key + "_" + j];
      if (!part) return null;  // chunk expired/evicted — whole entry is a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}

// ── SHEET READERS (GAS-only; header-name column lookups) ─────

function dhSourceIds_() {
  var p = PropertiesService.getScriptProperties();
  return {
    source: p.getProperty("DH_SOURCE_SS_ID") || CONFIG_DH.SOURCE_SS_ID,
    roster: p.getProperty("DH_ROSTER_SS_ID") || CONFIG_DH.ROSTER_SS_ID,
  };
}

/** Case-insensitive header index lookup; -1 when absent. */
function colIdx_(headers, names) {
  var low = headers.map(function (h) { return normDH_(h); });
  for (var i = 0; i < names.length; i++) {
    var at = low.indexOf(normDH_(names[i]));
    if (at !== -1) return at;
  }
  return -1;
}

function parseDhDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    var d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Population: active Class=Professional Services / Department=Services from
 * Data + Contractors Data (crew: the Class gate is skipped — their Class is
 * "Contractors"; Department must still be Services).
 * @returns {{ people: Array<{name, keyLocation, rosterBucket, isCrew}>, error?:string }}
 */
function readRosterPeople_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().roster);
    var out = [];
    [{ tab: CONFIG_DH.ROSTER_SHEET, crew: false },
     { tab: CONFIG_DH.CONTRACTORS_SHEET, crew: true }].forEach(function (src) {
      var sh = ss.getSheetByName(src.tab);
      if (!sh) { if (!src.crew) throw new Error('Tab "' + src.tab + '" not found'); return; }
      var raw = sh.getDataRange().getValues();
      if (raw.length < 2) return;
      var h = raw[0].map(String);
      var iName = colIdx_(h, ["Full Name", "Employee Name", "Name"]);
      var iStatus = colIdx_(h, ["Status", "Employment Status"]);
      var iClass = colIdx_(h, ["Class"]);
      var iDept = colIdx_(h, ["Department"]);
      var iLoc = colIdx_(h, ["Key Location", "Location"]);
      if (iName === -1) throw new Error('No name column in "' + src.tab + '"');
      for (var r = 1; r < raw.length; r++) {
        var name = String(raw[r][iName] || "").trim();
        if (!name) continue;
        var status = iStatus === -1 ? "active" : normDH_(raw[r][iStatus]);
        if (status && /termin|inactive/.test(status)) continue;
        if (!src.crew && iClass !== -1 &&
            normDH_(raw[r][iClass]) !== normDH_(CONFIG_DH.ROSTER_CLASS)) continue;
        if (iDept !== -1 && normDH_(raw[r][iDept]) !== normDH_(CONFIG_DH.ROSTER_DEPT)) continue;
        var loc = iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim();
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew });
      }
    });
    return { people: out };
  } catch (e) {
    return { people: [], error: "Roster read failed: " + e.message };
  }
}

/**
 * Capacity Tempo grid → { normName: { iso: hours } }.
 * Sheet shape (TempoCapacityTime.js): header row carries "YYYY.WN" labels;
 * fixed cols before the week columns include the User column.
 * @returns {{ byName: Object, error?: string }}
 */
function readCapacitySheet_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
      .getSheetByName(CONFIG_DH.CAPACITY_SHEET);
    if (!sh) return { byName: {}, error: 'Tab "' + CONFIG_DH.CAPACITY_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { byName: {} };
    // Find the header row: first row containing a ".W" week label
    var hRow = -1;
    for (var r = 0; r < Math.min(3, raw.length); r++) {
      if (raw[r].some(function (c) { return /^\d{4}\.W\d{1,2}$/.test(String(c).trim()); })) { hRow = r; break; }
    }
    if (hRow === -1) return { byName: {}, error: "No week columns found in Capacity Tempo" };
    var headers = raw[hRow].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(headers, ["User"]);
    if (iUser === -1) iUser = 1; // TempoCapacityTime.js: User is column B
    var weekCols = [];
    headers.forEach(function (hh, i) { if (/^\d{4}\.W\d{1,2}$/.test(hh)) weekCols.push({ col: i, iso: hh }); });
    var byName = {};
    for (var r2 = hRow + 1; r2 < raw.length; r2++) {
      var user = String(raw[r2][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var key = normDH_(user);
      if (!byName[key]) byName[key] = {};
      weekCols.forEach(function (wc) {
        var v = raw[r2][wc.col];
        if (v !== "" && v !== null && !isNaN(Number(v))) byName[key][wc.iso] = Number(v);
      });
    }
    return { byName: byName };
  } catch (e) {
    return { byName: {}, error: "Capacity read failed: " + e.message };
  }
}

/**
 * Shared Tempo grid reader for Tracked/Planned. Detects the week-label row
 * and the fixed-header row, then aggregates.
 * @returns {{ rows: Array<{user,teamCell,key,weekHours:Object}>, weekIsos:string[], error?:string }}
 */
function readTempoGrid_(sheetName) {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(sheetName);
    if (!sh) return { rows: [], weekIsos: [], error: 'Tab "' + sheetName + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 3) return { rows: [], weekIsos: [] };
    var wkRow = raw[0].map(function (c) { return String(c).trim(); });
    var hdRow = raw[1].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(hdRow, ["User"]);
    var iTeam = colIdx_(hdRow, ["Team"]);
    var iKey = colIdx_(hdRow, ["Key"]);
    if (iUser === -1) return { rows: [], weekIsos: [], error: 'No "User" column in ' + sheetName };
    var weekCols = [];
    wkRow.forEach(function (w, i) { if (/^\d{4}\.W\d{1,2}$/.test(w)) weekCols.push({ col: i, iso: w }); });
    var rows = [];
    for (var r = 2; r < raw.length; r++) {
      var user = String(raw[r][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var weekHours = {};
      weekCols.forEach(function (wc) {
        var v = Number(raw[r][wc.col]);
        if (v) weekHours[wc.iso] = (weekHours[wc.iso] || 0) + v;
      });
      rows.push({ user: user,
                  teamCell: iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim(),
                  key: iKey === -1 ? "" : String(raw[r][iKey] || "").trim().toUpperCase(),
                  weekHours: weekHours });
    }
    return { rows: rows, weekIsos: weekCols.map(function (w) { return w.iso; }) };
  } catch (e) {
    return { rows: [], weekIsos: [], error: sheetName + " read failed: " + e.message };
  }
}

/** True when a Tempo Key is a NETSUITE/time-off row. */
function isTimeOffKey_(key) {
  return CONFIG_DH.NONPROJECT_KEYS.some(function (k) {
    return String(key || "").toUpperCase().indexOf(k.toUpperCase()) === 0;
  });
}

/**
 * NS Billable daily rows → aggregateNsWeeks_ input.
 * Headers: Employee, Employee Type Category, Billable Hours Billed,
 * Billable Hours Unbilled, Total Billable Hours, Non-Billable Hours,
 * Total Hours (B+NB), Date.
 */
function readNsBillable_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.NS_SHEET);
    if (!sh) return { rows: [], error: 'Tab "' + CONFIG_DH.NS_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [] };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee", "Resource"]);
    var iBill = colIdx_(h, ["Total Billable Hours", "Total Billable"]);
    var iNon = colIdx_(h, ["Non-Billable Hours", "Non-Billable"]);
    var iDate = colIdx_(h, ["Date"]);
    if (iEmp === -1 || iDate === -1 || iBill === -1) {
      return { rows: [], error: "NS Billable: required columns missing" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var emp = String(raw[r][iEmp] || "").trim();
      var d = parseDhDate_(raw[r][iDate]);
      if (!emp || !d) continue;
      rows.push({ name: emp, date: d,
                  billable: Number(raw[r][iBill]) || 0,
                  nonBillable: iNon === -1 ? 0 : Number(raw[r][iNon]) || 0 });
    }
    return { rows: rows };
  } catch (e) {
    return { rows: [], error: "NS Billable read failed: " + e.message };
  }
}

/** PH tab (Date | Location | Holiday) → [{date, location}]. */
function readHolidays_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.PH_SHEET);
    if (!sh) return { rows: [] };  // silently off per spec §7
    var raw = sh.getDataRange().getValues();
    var h = raw[0].map(String);
    var iDate = colIdx_(h, ["Date"]), iLoc = colIdx_(h, ["Location"]);
    if (iDate === -1 || iLoc === -1) return { rows: [] };
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var d = parseDhDate_(raw[r][iDate]);
      var loc = String(raw[r][iLoc] || "").trim();
      if (d && loc) rows.push({ date: d, location: loc });
    }
    return { rows: rows };
  } catch (e) { return { rows: [] }; }
}

/**
 * Fuzzy PH-location ↔ roster Key Location matcher — ported verbatim from the
 * demand dashboard's phLocMatchesEmp_ (compound locations split on "&"/"and"/"/",
 * case-insensitive substring both directions, blank never matches).
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var a = normDH_(phLoc), b = normDH_(empLoc);
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  var parts = a.split(/\s*(?:&|\band\b|\/)\s*/).filter(Boolean);
  return parts.some(function (p) {
    return p.indexOf(b) !== -1 || b.indexOf(p) !== -1;
  });
}

/**
 * Jira Raw → issues + epics for the tile buckets, keyRegion for person-region.
 * Columns by header name: Key(1), Workstream (Issue Type)(3), Resolution Date(11),
 * Due Date(12), Epic Key(17), Original Estimate (sec)(23), Time Spent (sec)(24),
 * Region(32), Team(33). Rows repeat per weekly snapshot — dedupe on Key keeping
 * the LAST occurrence (latest snapshot wins).
 * @returns {{ issues:[], epics:[], keyRegion:Object, available:boolean, error?:string }}
 */
function readJiraRaw_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
    if (!sh) return { issues: [], epics: [], keyRegion: {}, available: false };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { issues: [], epics: [], keyRegion: {}, available: false };
    var h = raw[0].map(String);
    var iKey = colIdx_(h, ["Key"]);
    var iType = colIdx_(h, ["Workstream (Issue Type)", "Issue Type"]);
    var iRes = colIdx_(h, ["Resolution Date", "Resolved"]);
    var iDue = colIdx_(h, ["Due Date"]);
    var iEst = colIdx_(h, ["Original Estimate (sec)"]);
    var iSpent = colIdx_(h, ["Time Spent (sec)"]);
    var iRegion = colIdx_(h, ["Region"]);
    var iTeam = colIdx_(h, ["Team"]);
    if (iKey === -1) return { issues: [], epics: [], keyRegion: {}, available: false };
    var byKey = {};
    for (var r = 1; r < raw.length; r++) {
      var key = String(raw[r][iKey] || "").trim().toUpperCase();
      if (!key) continue;
      byKey[key] = r; // last snapshot wins
    }
    var issues = [], epics = [], keyRegion = {};
    Object.keys(byKey).forEach(function (key) {
      var r = byKey[key];
      var region = iRegion === -1 ? "" : String(raw[r][iRegion] || "").trim();
      var team = iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim();
      if (region) keyRegion[key] = region;
      var rec = {
        due: iDue === -1 ? null : parseDhDate_(raw[r][iDue]),
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        estSec: iEst === -1 ? 0 : Number(raw[r][iEst]) || 0,
        spentSec: iSpent === -1 ? 0 : Number(raw[r][iSpent]) || 0,
        region: region || "Other", team: team,
      };
      issues.push(rec);
      var type = iType === -1 ? "" : normDH_(raw[r][iType]);
      if (type.indexOf("epic") !== -1) epics.push(rec);
    });
    return { issues: issues, epics: epics, keyRegion: keyRegion, available: true };
  } catch (e) {
    return { issues: [], epics: [], keyRegion: {}, available: false, error: e.message };
  }
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

function _test_utilizationRollup_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_utilizationRollup_: " + m); }
  var people = [
    { name: "A", region: "AMER", teams: ["T1", "T2"],
      weeks: { W1: { avail: 32, billable: 24, tracked: 28, planned: 30 } } },
    { name: "B", region: "EMEA", teams: ["T2"],
      weeks: { W1: { avail: 40, billable: 10, tracked: 20, planned: 40 } } },
    { name: "C", region: "AMER", teams: [],
      weeks: { W1: { avail: 0, billable: 0, tracked: 0, planned: 0 } } }, // full-PTO week
  ];
  var all = utilRollup_(people, "W1", null, null);
  // avail 72, billable 34 → 47.2%
  assert_(Math.abs(all.billablePct - 34 / 72 * 100) < 1e-9, "billable util all");
  assert_(Math.abs(all.trackedPct - 48 / 72 * 100) < 1e-9, "tracked util all");
  var amer = utilRollup_(people, "W1", "AMER", null);
  assert_(amer.avail === 32 && amer.billable === 24, "region filter");
  var t2 = utilRollup_(people, "W1", null, "T2");
  assert_(t2.avail === 72, "team membership filter (A on T1|T2 counts in T2)");
  var t1 = utilRollup_(people, "W1", null, "T1");
  assert_(t1.avail === 32, "single-team filter");
  assert_(utilRollup_(people, "W9", null, null).billablePct === null, "no data week → null");
  Logger.log("✅ _test_utilizationRollup_ passed");
}

function _test_onTimeRate_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_onTimeRate_: " + m); }
  var issues = [
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), region: "AMER", team: "T1" }, // early ✓
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // boundary day ✓
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), region: "EMEA", team: "T2" }, // late ✗
    { due: null,                  resolved: new Date(2026, 6, 30), region: "AMER", team: "T1" }, // no due — excluded
    { due: new Date(2026, 6, 20), resolved: null,                  region: "AMER", team: "T1" }, // unresolved — excluded
  ];
  var buckets = onTimeBuckets_(issues);
  // resolved dates 2026-07-28/29/30 are all ISO 2026.W31
  var a = buckets.filter(function (b) { return b.region === "AMER" && b.team === "T1"; })[0];
  assert_(a.iso === "2026.W31" && a.n === 2 && a.onTime === 2, "AMER/T1: 2 with due, both on time");
  var e = buckets.filter(function (b) { return b.region === "EMEA"; })[0];
  assert_(e.n === 1 && e.onTime === 0, "late issue counted, not on time");
  assert_(buckets.length === 2, "no-due and unresolved rows excluded");
  Logger.log("✅ _test_onTimeRate_ passed");
}

function _test_forecastAccuracy_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_forecastAccuracy_: " + m); }
  var epics = [
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 28), region: "AMER", team: "T1" }, // perfect: acc 1
    { estSec: 36000, spentSec: 54000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // 50% over: acc .5
    { estSec: 36000, spentSec: 90000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // 150% over: acc floored 0
    { estSec: 0,     spentSec: 36000, resolved: new Date(2026, 6, 29), region: "AMER", team: "T1" }, // no estimate — excluded
    { estSec: 36000, spentSec: 36000, resolved: null,                  region: "AMER", team: "T1" }, // unresolved — excluded
  ];
  var buckets = forecastBuckets_(epics);
  assert_(buckets.length === 1, "one bucket");
  var b = buckets[0];
  assert_(b.iso === "2026.W31" && b.n === 3, "3 estimated resolved epics");
  assert_(Math.abs(b.sumAcc - 1.5) < 1e-9, "acc: 1 + 0.5 + 0 (negative floored)");
  Logger.log("✅ _test_forecastAccuracy_ passed");
}

function _test_cacheRoundtrip_(cache) {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_cacheRoundtrip_: " + m); }
  var big = JSON.stringify({ people: new Array(4000).fill({ name: "Maria Alvarez", weeks: { "2026.W31": { cap: 40, avail: 32 } } }) });
  assert_(cachePutLarge_(cache, "dh_test", big, 60) === true, "put ok");
  assert_(cacheGetLarge_(cache, "dh_test") === big, "roundtrip identical");
  assert_(cacheGetLarge_(cache, "dh_missing") === null, "missing key → null");
  // Simulate an evicted chunk → whole entry misses cleanly
  var meta = parseInt(cache.get("dh_test_meta"), 10);
  if (meta > 1) { cache.m["dh_test_1"] = null; delete cache.m["dh_test_1"]; }
  else { delete cache.m["dh_test_0"]; }
  assert_(cacheGetLarge_(cache, "dh_test") === null, "missing chunk → clean miss");
  Logger.log("✅ _test_cacheRoundtrip_ passed");
}
