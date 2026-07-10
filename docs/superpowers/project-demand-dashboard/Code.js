// ============================================================
// SCRIPT NAME: Project Demand — Week over Week (C-Suite Dashboard)
// PURPOSE:     Standalone Google Apps Script web app. Reads LIVE
//              planned-time data from the "Planned Time Tempo" tab
//              (by spreadsheet ID), cross-reads the Roster for an
//              available-capacity denominator, and serves Dashboard.html.
// ENVIRONMENT: Google Apps Script (separate project from PS report)
// DATA SOURCE: Planned Time Tempo tab + Roster sheet, both by ID.
// ACCESS:      Email allowlist — see Security.js (checkDemandAccess()).
// ============================================================

var CONFIG = {
  SOURCE_SS_ID:        "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",
  SHEET_NAME:          "Planned Time Tempo",
  NONPROJECT_KEYS:     ["NETSUITE"],   // excluded (time-off synced from NetSuite); case-insensitive
  EXCLUDED_NAMES:      [],             // display names excluded from grid/charts (still populate filter dropdowns)
  WEEKS_PAST:          4,
  WEEKS_FUTURE:        3,               // window = 4 past + current + 3 future = 8 weeks
  WEEKLY_CAPACITY_HRS: 40,              // available hours per active person per week (default region)
  ANZ_LOCATION:        "Australia & New Zealand", // Roster "Key Location" value → 38 hr week
  ANZ_CAPACITY_HRS:    38,              // weekly base capacity for ANZ people

  // ── Public holidays (PH tab in SOURCE_SS_ID; feeds week badges + capacity shortfall) ──
  PH_SHEET:                "PH",   // Date | Location | Holiday — same tab the PS report reads
  HOLIDAY_HRS_PER_DAY:     8,      // one holiday day removes 8h of capacity (default region)
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,    // 38-hr week ÷ 5 — consistent with ANZ_CAPACITY_HRS

  PLAN_TARGET:         0.90,            // 90% planning-target reference line on the chart
  TITLE:               "Project Demand — Week over Week",

  // ── Capacity denominator: active Services base hours (38 ANZ / 40 else), minus PTO/holidays ──
  ROSTER_SS_ID:        "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  ROSTER_SHEET:        "Roster",
  ROSTER_CLASS:        "Professional Services",
  ROSTER_DEPT:         "Services",

  // ── Signal thresholds (CONFIG-tunable; planned hours read conservatively) ──
  UTIL_TIGHT:          0.85,   // demand/capacity ≥ TIGHT and < OVER → "Tight"
  UTIL_OVER:           1.00,   // demand/capacity ≥ OVER            → "Over" (< TIGHT → "Headroom")

  // ── Drill-down / proxy tuning ──
  FRAG_MIN:            4,       // people on ≥ FRAG_MIN distinct projects are "fragmented"
  TOPN_STRATEGIC:      10,      // top-N projects by in-window hours treated as "strategic" (proxy)
  TRACKED_SHEET_NAME:   "Tempo Tracked Time",
  DELIVERY_GAP_MIN_HRS: 4,    // min planned hrs before person is flagged for gap
  SWARM_THRESHOLD:      0.20, // tracked/planned < 20% → "planned but not tracked"
  Q4_BASE_WEEK: 14,   // ISO week number of Q4 start (update each quarter)
  Q4_BASE_YEAR: 2026, // Calendar year of Q4 start

  // ── Cache (gzip + chunked CacheService — see README) ──
  CACHE_TTL_SEC:        3900, // 65 min — outlives one missed 30-min warm cycle
  CACHE_WARM_EVERY_MIN: 30,   // warmDemandCache() trigger interval (setupDemandCacheWarmer)
};

// ── ENTRY POINT ──────────────────────────────────────────────

/**
 * Serves the dashboard HTML, gated by the email allowlist (Security.js).
 * Denied users get a minimal "access restricted" page instead.
 */
function doGet() {
  var access = checkDemandAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle(CONFIG.TITLE + " — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle(CONFIG.TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ── ISO WEEK HELPERS (Monday-start, ISO-8601) ────────────────

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

/**
 * Builds the rolling window anchored on the current ISO week.
 * @returns {Array<{iso:string, wk:number, year:number, status:string}>}
 *          status ∈ {"done"(past), "now"(current), "plan"(future)}
 */
function buildWindow_() {
  var today = new Date();
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  var weeks = [];
  for (var off = -CONFIG.WEEKS_PAST; off <= CONFIG.WEEKS_FUTURE; off++) {
    var w = curW + off, y = curY;
    if (w <= 0)                      { y--; w = weeksInYear_(y) + w; }
    else if (w > weeksInYear_(y))    { w -= weeksInYear_(y); y++; }
    var status = off < 0 ? "done" : (off === 0 ? "now" : "plan");
    weeks.push({ iso: y + ".W" + w, wk: w, year: y, status: status });
  }
  return weeks;
}

/**
 * ISO label of the week immediately before the given week — used as a hidden
 * baseline so the first DISPLAYED week still has a prior week for week-over-week
 * comparisons (heatmap Change/Risk).
 * @param {{wk:number, year:number}} week
 * @returns {string} e.g. "2026.W21"
 */
function priorWeekIso_(week) {
  var w = week.wk - 1, y = week.year;
  if (w <= 0) { y--; w = weeksInYear_(y) + w; }
  return y + ".W" + w;
}

/**
 * Monday/Sunday date strings (yyyy-MM-dd, UTC) for an ISO year+week — buildWindow_
 * weeks carry no dates, and PH rows are matched to weeks by date range.
 * @param {number} year ISO week-year   @param {number} wk ISO week number
 * @returns {{monday:string, sunday:string}}
 */
function isoWeekBounds_(year, wk) {
  var jan4 = new Date(Date.UTC(year, 0, 4));               // Jan 4 is always in ISO W1
  var mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (wk - 1) * 7);
  var sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  var f = function (d) { return d.toISOString().slice(0, 10); };
  return { monday: f(mon), sunday: f(sun) };
}

/**
 * Fuzzy PH-location → roster Key Location matcher (ported verbatim from the PS
 * report's phLocMatchesEmp_): compound PH locations split on "&" / "and" / "/",
 * case-insensitive substring match either direction. Blank/Unknown never matches.
 * @param {string} phLoc  PH tab Location cell   @param {string} empLoc roster Key Location
 * @returns {boolean}
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var emp = (empLoc || "").toLowerCase().trim();
  if (!emp || emp === "unknown") return false;
  var parts = String(phLoc).split(/\s*[&\/]\s*|\s+and\s+/i)
                           .map(function (s) { return s.toLowerCase().trim(); })
                           .filter(Boolean);
  return parts.some(function (p) { return p === emp || p.indexOf(emp) !== -1 || emp.indexOf(p) !== -1; });
}

/** Canonicalizes a week label cell ("2026.W14" or legacy "W14") → "2026.W14". */
function weekToKey_(label, defYear) {
  var s = String(label == null ? "" : label).trim();
  var full = s.match(/^(\d{4})\.?W(\d+)$/i);
  if (full)  return full[1] + ".W" + parseInt(full[2], 10);
  var short = s.match(/^W(\d+)$/i);
  if (short) return defYear + ".W" + parseInt(short[1], 10);
  return null;
}

/**
 * Restricts allocation/PTO records to people whose Roster Department is exactly
 * CONFIG.ROSTER_DEPT ("Services") — applied once, up front, so every downstream figure
 * (heatmap cells, Planned vs Tracked totals, capacity time-off, person-level views) is
 * Services-only with no exceptions, regardless of whether a client-side filter is active.
 * @param {Array<{person:string}>} recs
 * @param {Object} profiles rosterProfiles keyed by normalised name (readRosterFull_().profiles)
 * @returns {Array} the subset of recs whose person is an active Services roster profile
 */
function scopeRecsToServices_(recs, profiles) {
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  return (recs || []).filter(function (r) {
    var prof = (profiles || {})[norm(r.person)];
    return !!prof && prof.department === CONFIG.ROSTER_DEPT;
  });
}

/** Sums allocation records' hours per ISO week — used to rebuild timeOffByWeek after scoping. */
function sumHoursByIso_(recs) {
  var out = {};
  (recs || []).forEach(function (r) { out[r.iso] = (out[r.iso] || 0) + r.hours; });
  return out;
}

// ── CACHE (gzip + chunking) ─────────────────────────────────
// Ported from PS Contribution Report.js. CacheService rejects any single value
// over 100 KB and the demand payload (person-level maps + behavior signals)
// exceeds that, so the JSON is gzipped (~10× smaller) and split across numbered
// chunk keys (`<key>_0..n` + `<key>_meta`). A missing chunk on read (partial
// eviction) is treated as a clean cache miss. One shared entry serves every
// viewer — this dashboard has no per-user scoping (viewerRole/viewerEmail are
// attached after the cache read, never stored).
var CACHE_CHUNK_BYTES_ = 90 * 1024;  // margin under the 100 KB per-value cap

/** Current cache version — Script Property PD_CACHE_VER (default 1). */
function demandCacheVer_() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty("PD_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch (e) { return 1; }
}

/**
 * Bumps PD_CACHE_VER, stranding all prior-version entries (they expire on TTL —
 * CacheService can't enumerate keys, so versioning is how invalidation works).
 * Run manually from the GAS editor to force-invalidate the cache.
 */
function bustDemandCache_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = (parseInt(props.getProperty("PD_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("PD_CACHE_VER", String(next));
    Logger.log("✅ bustDemandCache_: cache version bumped to " + next);
    return next;
  } catch (e) {
    Logger.log("⚠️ bustDemandCache_: " + e.message);
    return null;
  }
}

/** The single shared cache key for the demand model. */
function demandCacheKey_() { return "pd_v" + demandCacheVer_(); }

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

// ── MAIN DATA ENDPOINT (called from the client via google.script.run) ──

/**
 * Cache-first data endpoint. Returns the shared gzip-chunked cache entry when
 * present (~1–3 s) and only runs the full compute on a miss or when
 * forceRefresh is true — a force refresh overwrites the shared entry, so one
 * person's Refresh warms the cache for everyone. The computed model is cached
 * only when healthy (no error / trackedError) so a transient sheet-read
 * failure never gets pinned until the next warm. viewerRole/viewerEmail are
 * per-caller — attached after the cache read, never stored in the cache.
 * Access is re-checked server-side (defense in depth — the page is already gated).
 * @param {boolean} [forceRefresh] true → bypass the cache and rewrite it (↻ Refresh).
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData(forceRefresh) {
  var access = checkDemandAccess();
  if (!access.allowed) {
    var denied = emptyModel_(buildWindow_());
    denied.error = "Access restricted to authorized users.";
    return denied;
  }

  var cache = CacheService.getScriptCache();
  var key = demandCacheKey_();
  if (!forceRefresh) {
    var hit = cacheGetLarge_(cache, key);
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        cached.viewerRole = access.role;
        cached.viewerEmail = access.email;
        return cached;
      } catch (e) {
        Logger.log("⚠️ getDemandData: bad cache entry (" + e.message + ") — recomputing");
      }
    }
  }

  var model = buildDemandModel_();
  if (!model.error && !model.trackedError) {
    cachePutLarge_(cache, key, JSON.stringify(model), CONFIG.CACHE_TTL_SEC);
  }
  model.viewerRole = access.role;
  model.viewerEmail = access.email;
  return model;
}

/**
 * Full demand-model compute — three sheet reads (Planned Time Tempo, Roster,
 * Tempo Tracked Time) plus all aggregation. All demand figures are PLANNED
 * HOURS. Shared by getDemandData (cache miss / force) and warmDemandCache
 * (timed trigger). No access check and no viewer fields here: triggers have no
 * meaningful Session user, and the result is cached for everyone.
 * @returns {Object} model (see aggregate_); model.error is set on failure — callers never cache those.
 */
function buildDemandModel_() {
  var weeks = buildWindow_();
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sh) {
      var m = emptyModel_(weeks);
      m.error = "Sheet '" + CONFIG.SHEET_NAME + "' not found in source spreadsheet.";
      return m;
    }
    var vals = sh.getDataRange().getValues();
    var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
    var baselineIso = priorWeekIso_(weeks[0]);    // hidden lookback week → first week gets a WoW prior

    // ── Single roster read — shared by capacity + people signals + department scoping ──
    var roster = readRosterFull_();

    // Department = ROSTER_DEPT ("Services") is applied HERE, once, before any aggregation —
    // every downstream figure (heatmap cells, Planned vs Tracked totals, capacity time-off,
    // person-level views, filter dropdowns) is Services-only with no exceptions, whether or
    // not a client-side filter is active.
    var scopedRecs    = scopeRecsToServices_(parsed.recs, roster.profiles);
    var scopedPtoRecs = scopeRecsToServices_(parsed.ptoRecs, roster.profiles);

    var model = aggregate_(scopedRecs, weeks, baselineIso);
    model.timeOffByWeek = sumHoursByIso_(scopedPtoRecs);   // PTO + public holidays (NETSUITE rows), Services only

    // ── Public holidays: badges + capacity shortfall (PH tab; [] on any failure) ──
    var phData = readPHData_();
    var hol = buildHolidaysByWeek_(phData, weeks, roster, netsuiteByPersonWeek_(scopedPtoRecs));
    model.holidaysByWeek = hol.byWeek;
    model.holidayShortfallByWeek = hol.shortfallByWeek;

    attachCapacity_(model, roster);   // net capacity (roster base − time-off, planned fallback)

    // ── Tracked time + delivery signals ──────────────────────
    var trackedResult = readTrackedAllocations_();
    var scopedTrackedRecs = [], scopedTrackedPtoRecs = [];
    if (!trackedResult.error) {
      scopedTrackedRecs    = scopeRecsToServices_(trackedResult.recs, roster.profiles);
      scopedTrackedPtoRecs = scopeRecsToServices_(trackedResult.ptoRecs, roster.profiles);
      var tm = aggregate_(scopedTrackedRecs, weeks, baselineIso);
      model.weekTracked = tm.weekTotal;
      model.tracked     = tm.cap;
      model.fidelity    = {};
      model.isoList.forEach(function(iso) {
        var pl = model.weekTotal[iso] || 0;
        model.fidelity[iso] = pl > 0 ? (tm.weekTotal[iso] || 0) / pl : null;
      });
      model.rosterDimensions   = roster.dimensions;
      model.displayNames       = buildDisplayNames_(scopedRecs, scopedTrackedRecs);
      model.trackedLastExport  = trackedResult.lastExport || null;
    } else {
      model.trackedError = trackedResult.error;
    }
    if (!trackedResult.error && (!trackedResult.recs || trackedResult.recs.length === 0)) {
      model.trackedWarning = "Tracked sheet found but 0 records parsed — verify the sheet has a 'Key' column and ISO week headers (e.g. 2026.W26).";
    }
    var normLocal = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
    model.excludedNames = (CONFIG.EXCLUDED_NAMES || []).map(normLocal);

    // ── Person availability (planned + tracked per person per week) ──
    // PTO is tagged by source (planned sheet vs tracked sheet) so buildPersonAvailability_
    // can take the max of the two instead of summing them — the same PTO week is usually
    // present in both sheets (planned ahead of time, then logged as actual), and summing
    // both silently doubled a 40h week into 80h.
    var plannedPtoRecs = scopedPtoRecs.map(function(r) { return Object.assign({}, r, { source: 'planned' }); });
    var trackedPtoRecs = scopedTrackedPtoRecs.map(function(r) { return Object.assign({}, r, { source: 'tracked' }); });
    var allPtoRecs = plannedPtoRecs.concat(trackedPtoRecs);
    var availResult = buildPersonAvailability_(
      scopedRecs,
      scopedTrackedRecs,
      allPtoRecs,
      roster.profiles
    );
    model.personWeekPlan    = availResult.personWeekPlan;
    model.personWeekTracked = availResult.personWeekTracked;
    model.personProjectPlan = availResult.personProjectPlan;
    model.personMeta        = availResult.personMeta;
    model.personWeekPTO     = availResult.personWeekPTO;
    model.behaviorSignals = buildPersonBehaviorSignals_(
      model.personWeekPlan,
      model.personWeekTracked,
      model.personProjectPlan,
      model.personMeta,
      weeks
    );
    model.anzLocation = CONFIG.ANZ_LOCATION || '';
    model.generatedAt = new Date().toISOString();   // freshness badge ("Data as of HH:MM")

    return model;
  } catch (e) {
    var err = emptyModel_(weeks);
    err.error = "Failed to read source data: " + e.message;
    return err;
  }
}

// ── CACHE WARMER ────────────────────────────────────────────

/**
 * Rebuilds the shared cache entry. Runs on the time trigger installed by
 * setupDemandCacheWarmer(), so real visitors virtually always hit warm cache.
 * Skips the write when the model is unhealthy — a transient sheet-read failure
 * must not overwrite a good entry.
 */
function warmDemandCache() {
  var s0 = Date.now();
  var model = buildDemandModel_();
  var secs = Math.round((Date.now() - s0) / 1000);
  if (model.error || model.trackedError) {
    Logger.log("❌ warmDemandCache after " + secs + "s: " + (model.error || model.trackedError));
    return;
  }
  var ok = cachePutLarge_(CacheService.getScriptCache(), demandCacheKey_(),
                          JSON.stringify(model), CONFIG.CACHE_TTL_SEC);
  Logger.log(ok ? "✅ warmDemandCache: rebuilt in " + secs + "s"
                : "❌ warmDemandCache: compute ok (" + secs + "s) but cache write failed");
}

/**
 * One-time setup — run manually from the GAS editor as the dashboard owner.
 * Replaces any existing warmer trigger, so it is safe to re-run after changing
 * CONFIG.CACHE_WARM_EVERY_MIN. (everyMinutes accepts 1/5/10/15/30 only.)
 */
function setupDemandCacheWarmer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "warmDemandCache"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("warmDemandCache")
    .timeBased()
    .everyMinutes(CONFIG.CACHE_WARM_EVERY_MIN)
    .create();
  Logger.log("✅ Demand cache warmer installed — every " + CONFIG.CACHE_WARM_EVERY_MIN +
             " min, TTL " + CONFIG.CACHE_TTL_SEC + "s");
}

// ── JOB TITLE → FAMILY (derived) ─────────────────────────────
// The Roster sheet has no reliable "Job Family" column — job family only exists as a
// function of "Job Title" (same underlying catalog PS Contribution Report.js uses for
// scoring weights: ACTIVE_FAMILIES_/COMPANY_ROLES_). Copied here rather than shared
// because this is a standalone GAS project (separate deployment, no cross-project
// imports) — only the family NAME is needed for the Job Family filter, not level/track/
// weights, so levels are parsed and discarded immediately.
var ACTIVE_FAMILY_NAMES_ = {
  JF001: "Marketing", JF003: "Analytics", JF004: "Sales and Success",
  JF005: "Partner Success", JF007: "Managed Services & Support",
  JF008: "Training & Customer Education", JF009: "Service Delivery",
  JF013: "Finance", JF014: "Legal & Compliance", JF015: "Operations",
  JF016: "People", JF017: "Information Technology", JF018: "Solution Architecture",
};

// "code|Job Title" — same seed list as COMPANY_ROLES_ in PS Contribution Report.js.
var COMPANY_ROLES_ = [
  "01.I1.2|Intern, Marketing","01.I2.2|Associate, Marketing","01.I3.1|Analyst, Marketing",
  "01.I4.1|Senior Analyst I, Marketing","01.I4.4|Senior Representative I, Field Marketing",
  "01.I5.1|Senior Analyst II, Marketing","01.I6.1|Senior Analyst III, Marketing",
  "01.I7.1|Principal, Marketing","01.I8.1|Senior Principal, Marketing",
  "01.M4.2|Manager, Marketing","01.M5.3|Senior Manager, Marketing","01.M6.1|Director, Marketing",
  "01.M7.2|Senior Director, Marketing","01.M8.2|Executive Director, Marketing","01.M9.1|Executive I, Marketing",
  "03.I2.1|Associate, Data Analysis","03.I3.1|Analyst, Data Analysis","03.I4.1|Senior Analyst I, Data Analysis",
  "03.I5.1|Senior Analyst II, Data Analysis","03.I6.1|Senior Analyst III, Data Analysis",
  "03.I7.1|Principal, Data Analysis","03.I8.1|Senior Principal, Data Analysis",
  "04.I2.5|Associate, Account Management","04.I3.4|Representative, Account Management",
  "04.I4.4|Senior Representative I, Account Management","04.I5.3|Senior Representative II, Account Management",
  "04.I6.2|Senior Representative III, Account Management","04.M8.2|Executive Director, Partner Practice Owner",
  "05.I3.1|Representative, Partner Success Management","05.I4.1|Senior Representative, I Partner Success Management",
  "05.I5.1|Senior Representative, II Partner Success Management","05.M7.1|Senior Director, Partner Success",
  "05.M8.1|Executive Director, Partner Success",
  "07.I1.1|Intern, Managed Services","07.I2.1|Associate Engineer, Customer Support","07.I2.2|Associate, Delivery",
  "07.I3.1|Engineer, Customer Support","07.I3.2|Consultant, Delivery",
  "07.I4.1|Senior Engineer I, Customer Support","07.I4.2|Senior Consultant I, Delivery",
  "07.I5.1|Senior Engineer II, Customer Support","07.I5.2|Senior Consultant II, Delivery",
  "07.I6.1|Senior Engineer III, Customer Support","07.I6.2|Senior Consultant III",
  "07.M4.1|Manager, Customer Support","07.M4.2|Manager, Delivery",
  "07.M5.1|Senior Manager, Customer Support","07.M5.2|Senior Manager, Delivery",
  "07.M6.1|Director, Support","07.M7.1|Senior Director, Support","07.M7.2|Senior Director, Delivery",
  "07.M8.1|Executive Director, Managed Services",
  "08.I2.1|Associate, Technical Instruction","08.I2.3|Associate, Customer Education",
  "08.I3.1|Consultant, Technical Instruction","08.I3.2|Consultant, Learning Solutions",
  "08.I4.1|Senior Consultant I, Technical Instruction","08.I5.1|Senior Consultant II, Technical Instruction",
  "08.I6.1|Senior Consultant III, Technical Instruction","08.I7.1|Principal, Technical Instruction",
  "08.I8.1|Senior Principal, Technical Instruction","08.M4.1|Manager, Technical Instruction",
  "08.M5.1|Senior Manager, Technical Instruction","08.M6.1|Director, Technical Instruction",
  "08.M6.4|Director, Customer Education","08.M7.1|Senior Director, Technical Instruction",
  "08.M8.1|Executive Director, Technical Instruction",
  "09.I1.1|Intern, Professional Services","09.I1.3|Intern Engineer, Service Delivery",
  "09.I1.4|Intern Designer, Service Delivery","09.I2.1|Associate, Technical Consulting",
  "09.I2.3|Associate Engineer, Service Delivery","09.I2.4|Associate Designer, Service Delivery",
  "09.I3.1|Consultant, Technical Consulting","09.I3.2|Consultant, Technical Consulting (Trainer)",
  "09.I3.3|Engineer, Service Delivery","09.I3.4|Designer, Service Delivery",
  "09.I4.1|Senior Consultant I, Technical Consulting","09.I4.2|Senior Consultant I, Technical Consulting (Trainer)",
  "09.I4.3|Senior Engineer I, Service Delivery","09.I4.4|Senior Designer I, Service Delivery",
  "09.I4.5|Senior Technical Lead, Service Delivery","09.I5.1|Senior Consultant II, Service Delivery",
  "09.I5.3|Senior Engineer II, Service Delivery","09.I5.4|Senior Designer II, Service Delivery",
  "09.I6.1|Senior Consultant III, Service Delivery","09.I6.3|Senior Engineer III, Service Delivery",
  "09.I6.4|Senior Designer III, Service Delivery","09.I7.1|Principal, Solution Consulting",
  "09.I7.3|Principal Engineer, Service Delivery","09.I7.4|Principal Designer, Service Delivery",
  "09.I8.1|Senior Principal, Solution Consulting","09.I8.4|Senior Principal Designer, Service Delivery",
  "09.M4.1|Manager, Service Delivery","09.M5.1|Senior Manager, Service Delivery",
  "09.M6.1|Director, Service Delivery","09.M7.1|Senior Director, Service Delivery",
  "09.M8.1|Executive Director, Service Delivery",
  "13.I1.1|Intern, Finance","13.I2.1|Associate, Financial Administration",
  "13.I3.1|Accountant, Financial Accounting","13.I3.2|Analyst, Financial Administration",
  "13.I4.1|Senior Analyst I, Finance","13.I4.2|Senior Accountant, Financial Accounting",
  "13.I5.2|Senior Analyst II, Project Management Office","13.M10.10|Chief Financial Officer",
  "13.M4.1|Manager, Group Controller","13.M4.2|Manager, Financial Accounting","13.M4.3|Manager, FinOps",
  "13.M5.1|Senior Manager, Group Controller","13.M6.1|Director, Finance","13.M7.1|Senior Director, Finance",
  "14.I2.1|Associate, Legal Counsel","14.M9.1|General Counsel",
  "15.I1.1|Intern, Operations","15.I2.1|Associate, Project Management","15.I3.1|Consultant, Project Management",
  "15.I3.3|Analyst, Revenue Operations","15.I4.1|Senior Consultant I, Project Management",
  "15.I5.1|Senior Consultant II, Project Management","15.I5.2|Executive Assistant",
  "15.I5.3|Manager, Customer Operations","15.I5.5|Program Manager, Operations",
  "15.I6.1|Principal I, Project Management","15.I6.2|Chief of Staff, Strategic Operations",
  "15.I7.1|Principal II, Program Management","15.M10.1|Chief Executive Officer",
  "15.M10.2|Chief Customer Officer","15.M10.3|Chief Operations Officer","15.M10.4|Chief Strategy Officer",
  "15.M4.1|Manager, Operations Management","15.M4.2|Manager, Project Management",
  "15.M5.1|Senior Manager, Operations","15.M5.2|Senior Manager, Resource Planning",
  "15.M5.3|Senior Manager, Revenue Operations","15.M6.1|Director, Operations",
  "15.M6.2|Director, Revenue Operations","15.M7.1|Senior Director, Operations",
  "15.M7.2|Senior Director, Resource Planning","15.M8.1|Executive Director, Line of Business Owner",
  "15.M8.2|Executive Director, Key Department Owner","15.M9.1|GM, Partner Practice",
  "15.M9.2|VP, Line of Business Owner","15.M9.3|VP, Partner Practice Owner",
  "16.I1.1|Intern, People","16.I2.1|Associate, People","16.I2.2|Associate, Talent Acquisition",
  "16.I2.3|Associate, Office Administration","16.I3.1|Analyst, Business Partner",
  "16.I3.3|Analyst, Talent Acquisition","16.I3.4|Specialist, Administration",
  "16.I3.5|Mental Performance Coach","16.I3.6|Talent Program Specialist",
  "16.I4.1|Senior Generalist I, People","16.I4.2|Senior Specialist, Administration",
  "16.I4.3|Senior Analyst, Talent Acquisition","16.I4.4|Senior Analyst I, Business Partner",
  "16.I5.1|Senior Generalist II, People","16.I5.2|Senior Analyst II, Talent Acquisition",
  "16.I6.1|Rocketeer Leadership Behaviors Coach","16.I6.2|Senior Generalist III, People",
  "16.M4.1|Manager, Talent Acquisition","16.M4.2|Manager, People",
  "16.M5.1|Senior Manager, Talent Acquisition","16.M5.2|Senior Manager, Workforce Planning (556)",
  "16.M5.3|Senior Manager, People","16.M5.4|Senior Manager, Total Rewards and HR Operations",
  "16.M6.1|Director, Talent Acquisition","16.M6.2|Director, People","16.M6.3|Director, Workforce Planning",
  "16.M7.1|Senior Director, Talent Acquisition","16.M7.2|Senior Director, People",
  "16.M7.3|Senior Director, Workforce Planning","16.M9.2|Chief People Officer",
  "17.I1.1|Intern, Information Technology","17.I2.1|Associate, IT Operations","17.I3.1|Engineer, IT Operations",
  "17.I4.1|Senior Engineer I, IT Operations","17.I4.2|Senior Analyst, Business Process Management",
  "17.I5.1|Senior Engineer II, IT Operations","17.M4.1|Manager, Program Management Office",
  "17.M4.2|Manager, IT Operations","17.M5.2|Senior Manager, IT Operations",
  "17.M7.1|Senior Director, Program Management Office","17.M7.2|Senior Director, IT Operations",
  "17.M8.1|Executive Director, Program Management Office","17.M8.2|Executive Director, IT Operations",
  "17.M9.1|VP, Program Management Office","17.M9.2|Chief Information Officer",
  "17.M9.3|Chief Technology Officer","17.M9.4|VP, IT Operations",
  "18.I2.1|Associate, Solution Architecture","18.I3.1|Consultant, Solution Architecture",
  "18.I4.1|Senior Consultant I, Solution Architecture","18.I5.1|Senior Consultant II, Solution Architecture",
  "18.I6.1|Senior Consultant III, Solution Architecture","18.I7.1|Principal, Solution Architecture",
  "18.I8.1|Senior Principal, Solution Architecture","18.M4.1|Manager, Solution Architecture",
  "18.M5.1|Senior Manager, Solution Architecture","18.M6.1|Director, Solution Architecture",
  "18.M7.1|Senior Director, Solution Architecture","18.M8.1|Executive Director, Solution Architecture",
];

var TITLE_FAMILY_MAP_ = null; // lazy-built cache: normalized Job Title -> family name
function titleFamilyMap_() {
  if (TITLE_FAMILY_MAP_) return TITLE_FAMILY_MAP_;
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var map = {};
  COMPANY_ROLES_.forEach(function (s) {
    var sep = s.indexOf('|');
    var code = s.slice(0, sep), title = s.slice(sep + 1);
    var m = /^(\d+)\.[IM]\d+\.\d+$/.exec(code);
    if (!m) return;
    var famCode = 'JF' + ('00' + m[1]).slice(-3);
    var name = ACTIVE_FAMILY_NAMES_[famCode];
    if (!name) return; // archived/unlisted family — leave title unmapped
    map[norm(title)] = name;
  });
  TITLE_FAMILY_MAP_ = map;
  return map;
}

/**
 * Job family for a roster row. Precedence: explicit "Job Family" cell →
 * numeric code prefix on the Job Title ("09." / "009." → JF009 → family name;
 * same derivation as the PS dashboard's parseJobCode — roster titles are
 * code-prefixed, so this is the path that actually fires) → bare catalog-title
 * lookup for uncoded titles. Unknown/archived families resolve to "".
 * @param {string} famCol raw "Job Family" cell value ("" if column absent)
 * @param {string} title raw "Job Title" cell value
 * @returns {string} family display name or ""
 */
function familyFromTitle_(famCol, title) {
  if (famCol) return famCol;
  var t = String(title || "");
  var m = t.match(/^(\d{2,3})\./);
  if (m) {
    var name = ACTIVE_FAMILY_NAMES_["JF" + ("00" + m[1]).slice(-3)];
    if (name) return name;
  }
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, " ").trim(); };
  return titleFamilyMap_()[norm(t)] || "";
}

// ── CAPACITY (roster base hours 38 ANZ / 40 else, minus PTO/holidays; planned fallback) ──

/**
 * Reads active PS / Services people from the Roster sheet and sums their weekly
 * BASE capacity — the same active filter family as the PS report's readPSRoster_(),
 * but ramp-up and crew are INCLUDED (they appear in the Tempo plan and consume
 * capacity). People whose "Key Location" is CONFIG.ANZ_LOCATION are credited
 * CONFIG.ANZ_CAPACITY_HRS (38); everyone else CONFIG.WEEKLY_CAPACITY_HRS (40).
 * @returns {{ ok:boolean, headcount:number, baseCapacity:number, anzCount:number, error?:string }}
 */
/**
 * Reads the Roster sheet once and returns both capacity data (for the capacity
 * denominator) and people profiles (for signal filters).  Replaces the two
 * separate readActiveCapacity_() + readRosterProfiles_() calls so the sheet is
 * only fetched once per getDemandData() execution.
 *
 * Capacity counts: active Services FTE/crew with a valid Name, Class = Professional
 * Services, Dept = Services, no inactive/termination markers.
 * Profile data (`profiles`): every named row (no class/dept filter) — each profile carries
 * its own `department` and a `countsForCapacity` flag so callers (buildPersonAvailability_, getDemandData) can scope to
 * Department = ROSTER_DEPT themselves. Filter dropdown lists (`dimensions`) ARE scoped to
 * Department = ROSTER_DEPT — no un-selectable, non-Services values in the People filters bar.
 */
function readRosterFull_() {
  var EMPTY_CAP = { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, capError: null };
  var EMPTY_PROF = { profiles: {}, dimensions: { locations: [], jobFamilies: [], managers: [] } };
  try {
    var ss = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
    var sh = ss.getSheetByName(CONFIG.ROSTER_SHEET);
    if (!sh) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster sheet not found." });
    var last = sh.getLastRow();
    if (last < 2) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster is empty." });

    var raw  = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
    var hdrs = raw[0].map(function (h) { return String(h).trim(); });
    var col  = function (name) { return hdrs.findIndex(function (h) { return h.toLowerCase() === name.toLowerCase(); }); };

    var iName   = col("Name"),      iClass  = col("Class"),     iDept   = col("Department");
    var iStatus = col("Employee Status"), iTerm = col("Termination/Release Date");
    var iLoc    = col("Key Location"), iFam = col("Job Family"), iTitle = col("Job Title");
    var iMgr    = (col("Supervisor") !== -1) ? col("Supervisor") : col("Manager");
    if (iName === -1) return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: "Roster 'Name' column not found." });

    var norm       = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
    var anzLoc     = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();
    var INACTIVE   = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
    var profiles   = {}, locs = {}, families = {}, managers = {};
    var count = 0, base = 0, anz = 0;

    for (var r = 1; r < raw.length; r++) {
      var row  = raw[r];
      var name = String(row[iName] || "").trim();
      if (!name) continue;

      var loc   = iLoc   !== -1 ? String(row[iLoc]   || "").trim() : "";
      var mgr   = iMgr   !== -1 ? String(row[iMgr]   || "").trim() : "";
      var title = iTitle !== -1 ? String(row[iTitle] || "").trim() : "";
      var dept  = iDept  !== -1 ? String(row[iDept]  || "").trim() : "";
      // Roster has no reliable "Job Family" column — prefer it if present (defensive),
      // else derive the family from the Job Title's numeric code prefix (roster titles
      // are code-prefixed: "09.M4.1 Manager, Service Delivery"), with a bare-catalog-
      // title fallback. Crew/contractor and unlisted roles simply stay unmapped ("").
      var famCol = iFam !== -1 ? String(row[iFam] || "").trim() : "";
      var fam    = familyFromTitle_(famCol, title);
      var isCrew = /crew member|contractor/i.test(title);
      var lvlM   = title.match(/^\d{2,3}\.([A-Z]\d+)\./);
      // Capacity predicate: only active Services members (same filter as before,
      // computed as a flag so holiday signals can scope to the SAME population
      // as the capacity denominator — see buildHolidaysByWeek_).
      var status = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      var term   = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      var countsForCapacity =
        (iClass === -1 || String(row[iClass] || "").trim() === CONFIG.ROSTER_CLASS) &&
        (!dept || dept === CONFIG.ROSTER_DEPT) &&
        !INACTIVE.test(status) && !term;

      profiles[norm(name)] = { location: loc, jobFamily: fam, manager: mgr, department: dept, isManager: !!(lvlM && lvlM[1].charAt(0) === 'M'), isCrew: isCrew, countsForCapacity: countsForCapacity };
      // Filter dropdown option lists (Location / Job Family / Manager) are scoped to
      // Department = ROSTER_DEPT too, same as the person-level data — otherwise a
      // Sales/Finance-only location or manager would show up as a pickable filter value
      // even though selecting it can never match anyone in the dashboard.
      if (dept === CONFIG.ROSTER_DEPT) {
        if (loc) locs[loc] = true;
        if (fam) families[fam] = true;
        if (mgr) managers[mgr] = true;
      }

      if (!countsForCapacity) continue;
      var isANZ = loc.toLowerCase() === anzLoc;
      base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
      if (isANZ) anz++;
      count++;
    }

    return {
      ok: true, headcount: count, baseCapacity: base, anzCount: anz, capError: null,
      profiles: profiles,
      dimensions: { locations: Object.keys(locs).sort(), jobFamilies: Object.keys(families).sort(), managers: Object.keys(managers).sort() }
    };
  } catch (e) {
    return Object.assign({}, EMPTY_CAP, EMPTY_PROF, { capError: e.message });
  }
}

/**
 * Attaches capacity fields to the model in place. Capacity is NET of PTO and
 * public holidays (the NETSUITE time-off rows, summed per week in model.timeOffByWeek).
 *  - roster mode:  gross = baseCapacity (38 ANZ / 40 else, constant across the window);
 *                  capByWeek[iso] = max(0, gross − timeOff[iso]).
 *  - planned mode: fallback when the roster can't be read — gross =
 *                  activePeople[iso] × WEEKLY_CAPACITY_HRS; capByWeek[iso] = max(0, gross − timeOff[iso]).
 * @param {Object} model
 */
function attachCapacity_(model, rosterFull) {
  var cap = CONFIG.WEEKLY_CAPACITY_HRS;
  var hc  = rosterFull || { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0 };
  var timeOff  = model.timeOffByWeek || {};
  var holShort = model.holidayShortfallByWeek || {};   // unbooked public-holiday hours (see buildHolidaysByWeek_)
  model.capByWeek = {};
  model.grossCapByWeek = {};
  if (hc.ok && hc.headcount > 0) {
    model.capacityMode = "roster";
    model.headcount    = hc.headcount;
    model.anzCount     = hc.anzCount;
    model.baseCapacity = hc.baseCapacity;
    model.isoList.forEach(function (iso) {
      model.grossCapByWeek[iso] = hc.baseCapacity;
      model.capByWeek[iso] = Math.max(0, hc.baseCapacity - (timeOff[iso] || 0) - (holShort[iso] || 0));
    });
  } else {
    model.capacityMode = "planned";
    model.headcount    = null;
    model.anzCount     = 0;
    model.capacityNote = hc.capError || "Roster unavailable.";
    model.isoList.forEach(function (iso) {
      var gross = (model.activePeople[iso] || 0) * cap;
      model.grossCapByWeek[iso] = gross;
      model.capByWeek[iso] = Math.max(0, gross - (timeOff[iso] || 0) - (holShort[iso] || 0));
    });
  }
}

// ── PUBLIC HOLIDAYS (PH tab → week badges + capacity shortfall) ──

/**
 * Sums NETSUITE time-off hours per normalized person per ISO week — the
 * "already booked" side of the holiday shortfall de-dup.
 * @param {Array<{person:string, iso:string, hours:number}>} ptoRecs scopedPtoRecs (planned sheet)
 * @returns {Object} { normName: { iso: hours } }
 */
function netsuiteByPersonWeek_(ptoRecs) {
  var norm = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var out = {};
  (ptoRecs || []).forEach(function (r) {
    var p = norm(r.person);
    if (!out[p]) out[p] = {};
    out[p][r.iso] = (out[p][r.iso] || 0) + r.hours;
  });
  return out;
}

/**
 * Reads the PH tab (Date | Location | Holiday) from the source spreadsheet.
 * Any failure (missing tab, empty, bad rows) degrades to [] — the dashboard
 * then renders exactly as before this feature. Same contract as the PS
 * report's readPHData_.
 * @returns {Array<{date:string, location:string, holiday:string}>} date = "yyyy-MM-dd"
 */
function readPHData_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.PH_SHEET);
    if (!sh) { Logger.log("⚠️ readPHData_: sheet '" + CONFIG.PH_SHEET + "' not found — holiday signals off."); return []; }
    var rows = sh.getDataRange().getValues();
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var rawDate = rows[i][0], location = rows[i][1], holiday = rows[i][2];
      if (!rawDate || !location || !holiday) continue;
      var d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d)) continue;
      out.push({
        date:     Utilities.formatDate(d, "UTC", "yyyy-MM-dd"),
        location: String(location).trim(),
        holiday:  String(holiday).trim(),
      });
    }
    return out;
  } catch (e) {
    Logger.log("⚠️ readPHData_: " + e.message);
    return [];
  }
}

/**
 * Rolls PH rows up to the displayed ISO weeks and computes the capacity
 * shortfall — holiday hours NOT already covered by booked NETSUITE time-off,
 * per person, so nobody is double-counted (equivalent to
 * max(booked, holidayHours) per person-week).
 *
 * Population = roster profiles with countsForCapacity (same people as the
 * capacity denominator). ANZ people cost ANZ_HOLIDAY_HRS_PER_DAY (7.6),
 * everyone else HOLIDAY_HRS_PER_DAY (8).
 *
 * Roster fallback (rosterFull.ok false): entries keep rendering but with
 * affectedCount/totalAffected = null and zero shortfall — badges without
 * counts, capacity untouched (spec §Errors & degradation).
 *
 * @param {Array} phData        readPHData_() rows
 * @param {Array} weeks         buildWindow_() weeks ({iso, wk, year, status})
 * @param {Object} rosterFull   readRosterFull_() result ({ok, profiles})
 * @param {Object} netsuiteByPW netsuiteByPersonWeek_(scopedPtoRecs)
 * @returns {{byWeek:Object, shortfallByWeek:Object}}
 *          byWeek[iso] = { entries:[{date, location, holiday, days, affectedCount}],
 *                          totalAffected, shortfallHours }
 */
function buildHolidaysByWeek_(phData, weeks, rosterFull, netsuiteByPW) {
  var result = { byWeek: {}, shortfallByWeek: {} };
  if (!phData || !phData.length) return result;
  var rosterOk = !!(rosterFull && rosterFull.ok);
  var profiles = (rosterFull && rosterFull.profiles) || {};
  var anzLoc   = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();

  weeks.forEach(function (w) {
    var b = isoWeekBounds_(w.year, w.wk);
    var hits = phData.filter(function (ph) { return ph.date >= b.monday && ph.date <= b.sunday; });
    if (!hits.length) return;

    // Group by location+holiday — a multi-day holiday (Fiestas Patrias) becomes
    // ONE entry with a days count, matching how an exec reads the week.
    var grouped = {};
    hits.forEach(function (ph) {
      var key = ph.location + "||" + ph.holiday;
      if (!grouped[key]) grouped[key] = { date: ph.date, location: ph.location, holiday: ph.holiday, days: 0, affected: 0 };
      grouped[key].days++;
    });

    var shortfall = 0;
    var affectedAll = {};
    if (rosterOk) {
      Object.keys(profiles).forEach(function (np) {
        var prof = profiles[np];
        if (!prof.countsForCapacity) return;
        var days = 0;
        Object.keys(grouped).forEach(function (k) {
          var g = grouped[k];
          if (phLocMatchesEmp_(g.location, prof.location)) {
            g.affected++;
            days += g.days;
            affectedAll[np] = true;
          }
        });
        if (!days) return;
        var perDay  = String(prof.location || "").trim().toLowerCase() === anzLoc
          ? CONFIG.ANZ_HOLIDAY_HRS_PER_DAY : CONFIG.HOLIDAY_HRS_PER_DAY;
        var phHours = days * perDay;
        var booked  = (netsuiteByPW && netsuiteByPW[np] && netsuiteByPW[np][w.iso]) || 0;
        shortfall  += Math.max(0, phHours - booked);
      });
    }

    var entries = Object.keys(grouped).map(function (k) {
      var g = grouped[k];
      return { date: g.date, location: g.location, holiday: g.holiday, days: g.days,
               affectedCount: rosterOk ? g.affected : null };
    }).filter(function (e) { return !rosterOk || e.affectedCount > 0; });
    if (!entries.length) return;

    shortfall = Math.round(shortfall * 10) / 10;
    result.byWeek[w.iso] = {
      entries: entries,
      totalAffected: rosterOk ? Object.keys(affectedAll).length : null,
      shortfallHours: shortfall,
    };
    if (shortfall > 0) result.shortfallByWeek[w.iso] = shortfall;
  });
  return result;
}

// ── TRACKED TIME + DELIVERY SIGNALS ──────────────────────

function readTrackedAllocations_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.SOURCE_SS_ID);
    var sh = ss.getSheetByName(CONFIG.TRACKED_SHEET_NAME);
    if (!sh) return { recs: [], ptoRecs: [], error: "Sheet '" + CONFIG.TRACKED_SHEET_NAME + "' not found." };
    var vals = sh.getDataRange().getValues();
    var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
    var lastExport = null;
    for (var r = vals.length - 1; r >= 0; r--) {
      if (String(vals[r][0]).trim() === "Last Export:") {
        lastExport = String(vals[r][1] || "").trim() || null;
        break;
      }
    }
    return { recs: parsed.recs, ptoRecs: parsed.ptoRecs, lastExport: lastExport };
  } catch (e) {
    return { recs: [], ptoRecs: [], error: e.message };
  }
}


function buildDisplayNames_(recs1, recs2) {
  var names = {};
  var norm = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  (recs1 || []).concat(recs2 || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!names[np]) names[np] = rec.person;
  });
  return names;
}

/**
 * Derives the 4-state behavior label for a single person × week.
 * Returns null when neither planned nor tracked meets the threshold.
 */
function computePersonState_(planned, tracked) {
  var MIN = CONFIG.DELIVERY_GAP_MIN_HRS, THOLD = CONFIG.SWARM_THRESHOLD;
  if (planned >= MIN && tracked === 0)                             return 'escalation';
  if (planned >= MIN && tracked > 0 && tracked < THOLD * planned) return 'silent';
  if (tracked > MIN && planned < MIN)                             return 'unplanned';
  if (planned >= MIN && tracked >= THOLD * planned)               return 'aligned';
  return null;
}

/**
 * Returns an array of ISO week strings from the Q4 base week up to and
 * including currentIso. Falls back to the last 13 weeks for Q1–Q3.
 * @param {string} currentIso  e.g. "2026.W27"
 * @returns {string[]} ordered array of ISO strings, earliest first
 */
function buildQtdWindow_(currentIso) {
  var parts = currentIso.match(/^(\d{4})\.W(\d+)$/);
  if (!parts) return [];
  var curY = parseInt(parts[1], 10), curW = parseInt(parts[2], 10);
  var startY, startW;
  if (CONFIG.Q4_BASE_YEAR && CONFIG.Q4_BASE_WEEK) {
    startY = CONFIG.Q4_BASE_YEAR;
    startW = CONFIG.Q4_BASE_WEEK;
  } else {
    startW = curW - 12;
    startY = curY;
    if (startW <= 0) { startY--; startW = weeksInYear_(startY) + startW; }
  }
  var result = [], w = startW, y = startY, guard = 0;
  while ((y < curY || (y === curY && w <= curW)) && guard < 52) {
    result.push(y + '.W' + w);
    w++;
    guard++;
    if (w > weeksInYear_(y)) { w = 1; y++; }
  }
  return result;
}

/**
 * Computes all 4-state behavior signals for the current quarter-to-date window.
 * Called once per getDemandData() after buildPersonAvailability_ has run.
 */
function buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks) {
  var currentWeek = null;
  for (var wi = 0; wi < weeks.length; wi++) {
    if (weeks[wi].status === 'now') { currentWeek = weeks[wi]; break; }
  }
  if (!currentWeek) return {};
  var currentIso = currentWeek.iso;
  var qtdIsos = buildQtdWindow_(currentIso);

  // The current week is always excluded from personWeekState (tracked time accumulates
  // through the week, so it can never be judged aligned/unplanned/silent/escalation).
  // lastCompletedIso is the most recent week that DOES have a computed state — every
  // "as of now" signal (row chip, status filter, manager note, Swarm/Stabilizer/
  // concentration risk) must anchor on this, never on currentIso, or it silently never fires.
  var curIdxInQtd = qtdIsos.indexOf(currentIso);
  var lastCompletedIso = curIdxInQtd > 0 ? qtdIsos[curIdxInQtd - 1] : null;

  var allNps = {};
  Object.keys(personWeekPlan || {}).forEach(function(np) { allNps[np] = true; });
  Object.keys(personWeekTracked || {}).forEach(function(np) { allNps[np] = true; });

  // 1. personWeekState (current week excluded — tracked time accumulates through the week)
  var personWeekState = {};
  Object.keys(allNps).forEach(function(np) {
    personWeekState[np] = {};
    qtdIsos.forEach(function(iso) {
      if (iso === currentIso) return; // in-progress, never flag current week
      var pl = ((personWeekPlan || {})[np] || {})[iso] || 0;
      var tr = ((personWeekTracked || {})[np] || {})[iso] || 0;
      var state = computePersonState_(pl, tr);
      if (state) personWeekState[np][iso] = state;
    });
  });

  // 2. QTD project counts per person per week (for sparkline)
  var personQtdProjectCounts = {};
  Object.keys(allNps).forEach(function(np) {
    personQtdProjectCounts[np] = {};
    var projPlan = (personProjectPlan || {})[np] || {};
    qtdIsos.forEach(function(iso) {
      var count = 0;
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][iso] || 0) > 0) count++;
      });
      personQtdProjectCounts[np][iso] = count;
    });
  });

  // 2b. Total distinct projects per person across the whole QTD window — a person who
  // worked 4 projects last week and 1 this week still reads as multi-project here, and
  // someone on a single project all quarter reads as 1 regardless of the current week's slice.
  var personQtdUniqueProjectCount = {};
  Object.keys(allNps).forEach(function(np) {
    var projPlan = (personProjectPlan || {})[np] || {};
    var seen = {};
    qtdIsos.forEach(function(iso) {
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][iso] || 0) > 0) seen[key] = true;
      });
    });
    personQtdUniqueProjectCount[np] = Object.keys(seen).length;
  });

  // 3. QTD reliability score and streak
  var personQtdScore = {}, personStreakLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var total = 0, aligned = 0;
    qtdIsos.forEach(function(iso) {
      if (iso > currentIso) return;
      if (states[iso]) { total++; if (states[iso] === 'aligned') aligned++; }
    });
    personQtdScore[np] = total > 0 ? aligned / total : 0;
    var streak = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'aligned') streak++;
      else break;
    }
    personStreakLen[np] = streak;
  });

  // 4. Escalation consecutive count
  var personEscLen = {};
  Object.keys(allNps).forEach(function(np) {
    var states = personWeekState[np] || {};
    var escLen = 0;
    for (var i = qtdIsos.length - 1; i >= 0; i--) {
      var iso = qtdIsos[i];
      if (iso > currentIso) continue;
      if (states[iso] === 'escalation') escLen++;
      else break;
    }
    personEscLen[np] = escLen;
  });

  // 5. Project headcount for the reference week — powers the "N people on {project}"
  // grouping chip on a person's row, so a manager can jump straight to everyone sharing
  // that project ("swarmable" = can be grouped by shared project). Replaces the old
  // "Swarm" heuristic, which flagged an individual (unplanned work + someone else
  // escalating) but never actually grouped anyone by project.
  var projectHeadcountAtRef = {};
  if (lastCompletedIso) {
    Object.keys(allNps).forEach(function(np) {
      var projPlan = (personProjectPlan || {})[np] || {};
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][lastCompletedIso] || 0) > 0) {
          projectHeadcountAtRef[key] = (projectHeadcountAtRef[key] || 0) + 1;
        }
      });
    });
  }

  // 6. Stabilizer
  var personIsStabilizer = {};
  Object.keys(allNps).forEach(function(np) {
    var state = lastCompletedIso ? (personWeekState[np] || {})[lastCompletedIso] : null;
    var projCount = lastCompletedIso ? ((personQtdProjectCounts[np] || {})[lastCompletedIso] || 0) : 0;
    personIsStabilizer[np] = state === 'aligned' && projCount >= CONFIG.FRAG_MIN;
  });

  // 7. Concentration risk per project (as of lastCompletedIso)
  var projectAlignedCount = {};
  if (lastCompletedIso) {
    Object.keys(allNps).forEach(function(np) {
      var state = (personWeekState[np] || {})[lastCompletedIso];
      var projPlan = (personProjectPlan || {})[np] || {};
      Object.keys(projPlan).forEach(function(key) {
        if ((projPlan[key][lastCompletedIso] || 0) > 0) {
          projectAlignedCount[key] = projectAlignedCount[key] || 0;
          if (state === 'aligned') projectAlignedCount[key]++;
        }
      });
    });
  }
  var projectConcentrationRisk = {};
  Object.keys(projectAlignedCount).forEach(function(key) {
    projectConcentrationRisk[key] = projectAlignedCount[key] < 2;
  });

  return {
    currentIso:              currentIso,
    lastCompletedIso:        lastCompletedIso,
    qtdIsos:                 qtdIsos,
    personWeekState:         personWeekState,
    personQtdScore:          personQtdScore,
    personStreakLen:          personStreakLen,
    personEscLen:            personEscLen,
    personQtdProjectCounts:  personQtdProjectCounts,
    personQtdUniqueProjectCount: personQtdUniqueProjectCount,
    projectHeadcountAtRef:   projectHeadcountAtRef,
    personIsStabilizer:      personIsStabilizer,
    projectConcentrationRisk: projectConcentrationRisk
  };
}

function buildPersonAvailability_(plannedRecs, trackedRecs, ptoRecs, rosterProfiles) {
  var norm = function(n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); };
  var personWeekPlan = {}, personWeekTracked = {}, personProjectPlan = {}, personWeekPTO = {}, displayNames = {};

  // Only people whose Roster "Department" is exactly CONFIG.ROSTER_DEPT ("Services") are
  // shown anywhere in the person-level views (Team Availability, drill-downs, heatmap
  // person lists) — no exceptions for other departments, even if they logged Tempo hours.
  var inScope = function(np) {
    var prof = (rosterProfiles || {})[np];
    return !!prof && prof.department === CONFIG.ROSTER_DEPT;
  };

  // Build display names: first occurrence of a normalised name wins.
  (plannedRecs || []).concat(trackedRecs || []).concat(ptoRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!displayNames[np]) displayNames[np] = rec.person;
  });

  (plannedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!inScope(np)) return;
    personWeekPlan[np] = personWeekPlan[np] || {};
    personWeekPlan[np][rec.iso] = (personWeekPlan[np][rec.iso] || 0) + rec.hours;
    personProjectPlan[np] = personProjectPlan[np] || {};
    personProjectPlan[np][rec.key] = personProjectPlan[np][rec.key] || {};
    personProjectPlan[np][rec.key][rec.iso] = (personProjectPlan[np][rec.key][rec.iso] || 0) + rec.hours;
  });

  (trackedRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!inScope(np)) return;
    personWeekTracked[np] = personWeekTracked[np] || {};
    personWeekTracked[np][rec.iso] = (personWeekTracked[np][rec.iso] || 0) + rec.hours;
  });

  // PTO: a week off is usually recorded in BOTH the planned sheet (booked ahead) and the
  // tracked sheet (logged once it happens) — summing them double-counts (40h -> 80h).
  // Take the max per person/week instead of adding the two sources together.
  var personWeekPTOBySource = { planned: {}, tracked: {} };
  (ptoRecs || []).forEach(function(rec) {
    var np = norm(rec.person);
    if (!inScope(np)) return;
    var bucket = personWeekPTOBySource[rec.source === 'tracked' ? 'tracked' : 'planned'];
    bucket[np] = bucket[np] || {};
    bucket[np][rec.iso] = (bucket[np][rec.iso] || 0) + rec.hours;
  });
  var ptoNps = {};
  Object.keys(personWeekPTOBySource.planned).forEach(function(np) { ptoNps[np] = true; });
  Object.keys(personWeekPTOBySource.tracked).forEach(function(np) { ptoNps[np] = true; });
  Object.keys(ptoNps).forEach(function(np) {
    var pl = personWeekPTOBySource.planned[np] || {};
    var tr = personWeekPTOBySource.tracked[np] || {};
    var isos = {};
    Object.keys(pl).forEach(function(iso) { isos[iso] = true; });
    Object.keys(tr).forEach(function(iso) { isos[iso] = true; });
    personWeekPTO[np] = {};
    Object.keys(isos).forEach(function(iso) {
      personWeekPTO[np][iso] = Math.max(pl[iso] || 0, tr[iso] || 0);
    });
  });

  var personMeta = {};
  var allNorms = {};
  Object.keys(personWeekPlan).forEach(function(np) { allNorms[np] = true; });
  Object.keys(personWeekTracked).forEach(function(np) { allNorms[np] = true; });
  Object.keys(personWeekPTO).forEach(function(np) { allNorms[np] = true; });
  var excludedSet = {};
  (CONFIG.EXCLUDED_NAMES || []).forEach(function(n) { excludedSet[norm(n)] = true; });
  Object.keys(allNorms).forEach(function(np) {
    var prof = (rosterProfiles || {})[np] || {};
    personMeta[np] = {
      displayName: displayNames[np] || np,
      jobFamily:   prof.jobFamily  || '',
      manager:     prof.manager    || '',
      location:    prof.location   || '',
      isManager:   prof.isManager  || false,
      isCrew:      prof.isCrew     || false,
      excluded:    excludedSet[np] || false
    };
  });

  return { personWeekPlan: personWeekPlan, personWeekTracked: personWeekTracked,
           personProjectPlan: personProjectPlan, personMeta: personMeta,
           personWeekPTO: personWeekPTO };
}

// ── SHEET PARSING ────────────────────────────────────────────

/**
 * Parses the two-row stacked-header matrix into allocation records, and separately
 * sums the excluded non-project keys (NETSUITE = PTO + public holidays) per ISO week
 * so capacity can be reduced by time-off downstream.
 * @param {Array<Array>} vals - sheet getValues()
 * @param {string[]} nonProjectKeys
 * @returns {{ recs:Array<{person:string, iso:string, key:string, name:string, hours:number}>,
 *             ptoRecs:Array<{person:string, iso:string, key:string, name:string, hours:number}>,
 *             timeOffByWeek:Object<string,number> }}
 */
function parseAllocations_(vals, nonProjectKeys) {
  var out = [];
  var ptoOut = [];
  var timeOffByWeek = {};
  if (!vals || vals.length < 2) return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };

  // Locate the field-header row by its employee column.
  var isEmpHdr = function (h) {
    return /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
  };
  var hr = -1, iEmp = -1;
  for (var r = 0; r < Math.min(vals.length, 5) && hr === -1; r++) {
    for (var c = 0; c < vals[r].length; c++) {
      if (isEmpHdr(String(vals[r][c]).trim())) { hr = r; iEmp = c; break; }
    }
  }
  if (hr === -1) return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };

  // "Key" (project) and "Space" (project name) columns.
  var iKey = -1, iSpace = -1;
  for (var c2 = 0; c2 < vals[hr].length; c2++) {
    var hdr = String(vals[hr][c2]).trim().toLowerCase();
    if (hdr === "key")   iKey = c2;
    if (hdr === "space") iSpace = c2;
  }

  var exclude = {};
  (nonProjectKeys || []).forEach(function (k) { exclude[String(k).trim().toUpperCase()] = true; });

  // Week columns: ISO label row sits above the field-header row when present (new format),
  // else the field-header row itself (legacy single-row export).
  var isoRe = /^\s*\d{4}\.?W\d+\s*$/i;
  var labelRow = (hr > 0 && vals[hr - 1].some(function (cell) { return isoRe.test(String(cell)); }))
    ? vals[hr - 1] : vals[hr];
  var defYear = isoWeekYear_(new Date());
  var wCols = [];
  labelRow.forEach(function (cell, idx) {
    var key = weekToKey_(cell, defYear);
    if (key) wCols.push({ iso: key, idx: idx });
  });

  for (var i = hr + 1; i < vals.length; i++) {
    var row = vals[i];
    var person = String(row[iEmp] || "").trim();
    if (!person || person.toUpperCase() === "TOTAL") continue;     // skip footer / blanks
    var rawKey = iKey !== -1 ? String(row[iKey] || "").trim() : "";
    if (!rawKey) continue;                                          // skip blank keys
    var isTimeOff = !!exclude[rawKey.toUpperCase()];                // NETSUITE = PTO + public holidays
    var name = iSpace !== -1 ? String(row[iSpace] || "").trim() : "";
    for (var wi = 0; wi < wCols.length; wi++) {
      var hours = parseFloat(row[wCols[wi].idx]);
      if (!hours || hours <= 0) continue;
      if (isTimeOff) {                                              // reduces capacity, not project demand
        timeOffByWeek[wCols[wi].iso] = (timeOffByWeek[wCols[wi].iso] || 0) + hours;
        ptoOut.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
      } else {
        out.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
      }
    }
  }
  return { recs: out, ptoRecs: ptoOut, timeOffByWeek: timeOffByWeek };
}

// ── AGGREGATION ──────────────────────────────────────────────

/** Returns an empty model skeleton for the given weeks. */
function emptyModel_(weeks) {
  var isoList = weeks.map(function (w) { return w.iso; });
  var capByWeek = {}; isoList.forEach(function (iso) { capByWeek[iso] = 0; });
  return {
    weeks: weeks,
    isoList: isoList,
    cap: {}, head: {}, winners: {}, activeProj: {}, weekTotal: {},
    blendByWeek: {}, avgBlend: {}, stretched: {}, activePeople: {}, fragByWeek: {},
    order: [], keyName: {}, maxCell: 0.001, baselineIso: null,
    capByWeek: capByWeek, grossCapByWeek: {}, timeOffByWeek: {}, holidaysByWeek: {}, holidayShortfallByWeek: {},
    capacityMode: "planned", headcount: null, anzCount: 0, baseCapacity: 0,
    capacity: CONFIG.WEEKLY_CAPACITY_HRS, anzCapacity: CONFIG.ANZ_CAPACITY_HRS,
    planTarget: CONFIG.PLAN_TARGET,
    weekTracked: {}, tracked: {}, fidelity: {},
    behaviorSignals: {},
    displayNames: {},
    rosterDimensions: { locations: [], jobFamilies: [], managers: [] },
    trackedWarning: null, excludedNames: [],
    trackedError: null,
    personWeekPlan: {}, personWeekTracked: {}, personProjectPlan: {}, personMeta: {}, personWeekPTO: {},
    fragMin: CONFIG.FRAG_MIN, topnStrategic: CONFIG.TOPN_STRATEGIC,
    utilTight: CONFIG.UTIL_TIGHT, utilOver: CONFIG.UTIL_OVER,
    error: null,
  };
}

/**
 * Aggregates allocation records into the demand model (hours-based).
 * Only records whose iso is in the window are counted.
 * @param {Array} recs
 * @param {Array} weeks
 * @returns {Object} model
 */
function aggregate_(recs, weeks, baselineIso) {
  var model = emptyModel_(weeks);
  model.baselineIso = baselineIso || null;
  var isoList = model.isoList;
  var inWindow = {}; isoList.forEach(function (iso) { inWindow[iso] = true; });
  // The baseline week is counted (for the first week's WoW delta) but NOT displayed,
  // so it never appears in isoList, blend, winners, ordering, or the heatmap.
  if (baselineIso) inWindow[baselineIso] = true;

  var cap = {};                 // key -> iso -> summed hours
  var headSets = {};            // key -> iso -> {person:true}
  var personKeys = {};          // iso -> person -> {key:true}  (distinct projects per person/week)
  var keyName = {};
  isoList.forEach(function (iso) { personKeys[iso] = {}; });

  recs.forEach(function (rec) {
    if (!inWindow[rec.iso]) return;
    if (!keyName[rec.key] && rec.name) keyName[rec.key] = rec.name;

    cap[rec.key] = cap[rec.key] || {};
    cap[rec.key][rec.iso] = (cap[rec.key][rec.iso] || 0) + rec.hours;

    headSets[rec.key] = headSets[rec.key] || {};
    headSets[rec.key][rec.iso] = headSets[rec.key][rec.iso] || {};
    headSets[rec.key][rec.iso][rec.person] = true;

    // personKeys (blend) is only kept for displayed weeks; the baseline week feeds
    // WoW deltas via cap[], not the blend distribution.
    if (personKeys[rec.iso]) {
      personKeys[rec.iso][rec.person] = personKeys[rec.iso][rec.person] || {};
      personKeys[rec.iso][rec.person][rec.key] = true;
    }
  });

  // Distinct people per project/week.
  var head = {};
  Object.keys(headSets).forEach(function (k) {
    head[k] = {};
    Object.keys(headSets[k]).forEach(function (iso) {
      head[k][iso] = Object.keys(headSets[k][iso]).length;
    });
  });

  // Blend distribution + avg blend + stretched (≥ FRAG_MIN) + active people + fragmentation list.
  var blendByWeek = {}, avgBlend = {}, stretched = {}, activePeople = {}, fragByWeek = {};
  isoList.forEach(function (iso) {
    var people = personKeys[iso];
    var names = Object.keys(people);
    blendByWeek[iso] = { 1: 0, 2: 0, 3: 0, 4: 0 };
    fragByWeek[iso] = [];
    var sum = 0, st = 0;
    names.forEach(function (p) {
      var keys = Object.keys(people[p]);
      var n = keys.length;
      sum += n;
      blendByWeek[iso][Math.min(n, 4)]++;
      if (n >= CONFIG.FRAG_MIN) {
        st++;
        fragByWeek[iso].push({ person: p, keys: keys, n: n });
      }
    });
    fragByWeek[iso].sort(function (a, b) { return b.n - a.n || (a.person < b.person ? -1 : 1); });
    activePeople[iso] = names.length;
    avgBlend[iso] = names.length ? sum / names.length : 0;
    stretched[iso] = st;
  });

  // Per-week winner (max hours), active project count, total hours.
  var winners = {}, activeProj = {}, weekTotal = {};
  isoList.forEach(function (iso) {
    var best = null, bestv = -1, cnt = 0, tot = 0;
    Object.keys(cap).forEach(function (k) {
      var v = cap[k][iso] || 0;
      if (v > 0.001) { cnt++; tot += v; }
      if (v > bestv) { bestv = v; best = k; }
    });
    winners[iso] = { key: best, hours: bestv > 0 ? bestv : 0 };
    activeProj[iso] = cnt;
    weekTotal[iso] = tot;
  });

  // Project order by total in-window hours.
  var totals = Object.keys(cap).map(function (k) {
    var t = 0; isoList.forEach(function (iso) { t += (cap[k][iso] || 0); });
    return { key: k, total: t };
  });
  totals.sort(function (a, b) { return b.total - a.total; });

  // Heatmap scaling max.
  var maxCell = 0.001;
  Object.keys(cap).forEach(function (k) {
    isoList.forEach(function (iso) { if ((cap[k][iso] || 0) > maxCell) maxCell = cap[k][iso]; });
  });

  // keyName fallback: any project with no Space name shows its key.
  Object.keys(cap).forEach(function (k) { if (!keyName[k]) keyName[k] = k; });

  model.cap = cap;
  model.head = head;
  model.blendByWeek = blendByWeek;
  model.avgBlend = avgBlend;
  model.stretched = stretched;
  model.activePeople = activePeople;
  model.fragByWeek = fragByWeek;
  model.winners = winners;
  model.activeProj = activeProj;
  model.weekTotal = weekTotal;
  model.order = totals.map(function (t) { return t.key; });
  model.keyName = keyName;
  model.maxCell = maxCell;
  return model;
}

// ── UNIT TESTS (run in the GAS editor, or in Node with a stubbed Logger) ──

/**
 * Verifies the parser + aggregator: hours summed, NETSUITE excluded,
 * winner + blend + fragmentation correct. Run _test_demandParse_ and read the log.
 */
function _test_demandParse_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_demandParse_: " + msg); }

  // Fake stacked-header matrix for weeks W14 + W15.
  var vals = [
    ["", "", "", "", "2026.W14", "2026.W15", ""],
    ["User", "Space", "Key", "Planned (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 30, 20, 10, 30],     // W14: 20h
    ["Ana Smith", "Beta Project", "BETA", 16, 8, 8, 16],       // W14: 8h  → Ana on 2 projects in W14
    ["Ben Lee",   "Acme Project", "ACME", 10, 10, 0, 10],      // W14: 10h → ACME W14 total 30h
    ["Ben Lee",   "Time off",     "NETSUITE", 8, 8, 0, 8],     // excluded
    ["TOTAL", "", "", 64, 46, 18, 64],
  ];
  var weeks = [
    { iso: "2026.W14", wk: 14, year: 2026, status: "done" },
    { iso: "2026.W15", wk: 15, year: 2026, status: "now" },
  ];

  var parsed = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
  var recs = parsed.recs;
  assert_(recs.every(function (r) { return r.key !== "NETSUITE"; }), "NETSUITE must be excluded from project recs");

  // NETSUITE time-off (Ben, 8h in W14) is captured separately to reduce capacity.
  assert_(parsed.timeOffByWeek["2026.W14"] === 8,
    "W14 time-off should be 8, got " + parsed.timeOffByWeek["2026.W14"]);
  assert_(!parsed.timeOffByWeek["2026.W15"], "W15 should have no time-off");

  var m = aggregate_(recs, weeks);

  // ACME W14 = 20 (Ana) + 10 (Ben) = 30; BETA W14 = 8.
  assert_(m.cap.ACME["2026.W14"] === 30, "ACME W14 should be 30, got " + m.cap.ACME["2026.W14"]);
  assert_(m.cap.BETA["2026.W14"] === 8, "BETA W14 should be 8, got " + m.cap.BETA["2026.W14"]);

  // Winner of W14 = ACME (30 > 8).
  assert_(m.winners["2026.W14"].key === "ACME", "W14 winner should be ACME, got " + m.winners["2026.W14"].key);

  // Distinct people on ACME in W14 = 2 (Ana + Ben).
  assert_(m.head.ACME["2026.W14"] === 2, "ACME W14 headcount should be 2, got " + m.head.ACME["2026.W14"]);

  // Blend W14: Ana on 2 projects, Ben on 1 (NETSUITE excluded) → blend {1:1, 2:1}.
  assert_(m.blendByWeek["2026.W14"][2] === 1, "W14 should have 1 person on 2 projects");
  assert_(m.blendByWeek["2026.W14"][1] === 1, "W14 should have 1 person on 1 project (Ben, NETSUITE excluded)");

  // Fragmentation drill-down keys are retained per person: Ana's 2 projects are ACME + BETA.
  // (model.fragByWeek lists only people with n ≥ CONFIG.FRAG_MIN; here we assert the blend that feeds it.)
  assert_(m.blendByWeek["2026.W14"][2] === 1, "exactly one person on 2 projects (Ana)");

  // No project key reads NETSUITE.
  assert_(!m.cap.NETSUITE, "NETSUITE must not appear as a project");

  // Hidden baseline week: with W14 as the baseline and only W15 displayed, W14 is
  // counted in cap (so the first displayed week has a WoW prior) but never appears
  // in the displayed isoList/winners.
  var mb = aggregate_(recs, [weeks[1]], "2026.W14");
  assert_(mb.baselineIso === "2026.W14", "baselineIso should be set");
  assert_(mb.isoList.length === 1 && mb.isoList[0] === "2026.W15", "only W15 should be displayed");
  assert_(mb.cap.ACME["2026.W14"] === 30, "baseline W14 cap should remain available for WoW, got " + mb.cap.ACME["2026.W14"]);
  assert_(!mb.winners["2026.W14"], "baseline week must not be computed as a displayed winner");

  Logger.log("✅ _test_demandParse_ passed");
}

/**
 * Verifies the active-capacity filter on a fake roster matrix:
 * excludes wrong class / wrong dept / terminated / inactive; includes ramp-up + crew;
 * credits ANZ people 38 hrs and everyone else 40. Mirrors readActiveCapacity_'s logic
 * so it runs without a live sheet.
 */
function _test_headcount_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_headcount_: " + msg); }

  var raw = [
    ["Name", "Class", "Department", "Employee Status", "Termination/Release Date", "Key Location"],
    ["Alice FTE",   "Professional Services", "Services", "Active",     "",           "United States"],            // ✓ 40
    ["Bob RampUp",  "Professional Services", "Services", "Active",     "",           "Malaysia"],                 // ✓ 40
    ["Cara Crew",   "Professional Services", "Services", "Active",     "",           "Australia & New Zealand"],  // ✓ 38 (ANZ)
    ["Dan Term",    "Professional Services", "Services", "Active",     "2026-05-01", "United States"],            // ✗ termination date
    ["Eve Resign",  "Professional Services", "Services", "Resigned",   "",           "United States"],            // ✗ inactive status
    ["Fay Sales",   "Sales",                 "Sales",    "Active",     "",           "United States"],            // ✗ wrong class
    ["Gus Ops",     "Professional Services", "Finance",  "Active",     "",           "United States"],            // ✗ wrong dept
    ["",            "Professional Services", "Services", "Active",     "",           "United States"],            // ✗ blank name
  ];

  // Re-implement the filter inline (same predicate as readActiveCapacity_).
  var hdrs = raw[0].map(function (h) { return String(h).trim(); });
  var idx = function (n) { return hdrs.findIndex(function (h) { return h.toLowerCase() === n.toLowerCase(); }); };
  var iName = idx("Name"), iClass = idx("Class"), iDept = idx("Department"),
      iStatus = idx("Employee Status"), iTerm = idx("Termination/Release Date"), iLoc = idx("Key Location");
  var anzLoc = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();
  var INACTIVE_RE = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
  var count = 0, base = 0, anz = 0;
  for (var r = 1; r < raw.length; r++) {
    var row = raw[r];
    if (!String(row[iName] || "").trim()) continue;
    if (String(row[iClass] || "").trim() !== CONFIG.ROSTER_CLASS) continue;
    var dept = String(row[iDept] || "").trim();
    if (dept && dept !== CONFIG.ROSTER_DEPT) continue;
    if (INACTIVE_RE.test(String(row[iStatus] || "").trim()) || String(row[iTerm] || "").trim()) continue;
    var isANZ = (String(row[iLoc] || "").trim().toLowerCase() === anzLoc);
    base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
    if (isANZ) anz++;
    count++;
  }
  assert_(count === 3, "active headcount should be 3 (Alice, Bob, Cara), got " + count);
  assert_(anz === 1, "ANZ count should be 1 (Cara), got " + anz);
  // Alice 40 + Bob 40 + Cara 38 (ANZ) = 118.
  assert_(base === 118, "base capacity should be 118 (40+40+38), got " + base);

  Logger.log("✅ _test_headcount_ passed");
}

function _test_buildPersonAvailability_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_buildPersonAvailability_: " + msg); }

  var plannedRecs = [
    { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 20 },
    { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 10 },
    { person: "Ben Lee",   iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
    { person: "External",  iso: "2026.W24", key: "ACME", name: "Acme", hours: 8 },  // not in roster → excluded
    { person: "Gus Sales",  iso: "2026.W24", key: "ACME", name: "Acme", hours: 12 }, // in roster, Dept != Services → excluded
  ];
  var trackedRecs = [
    { person: "Ana Smith", iso: "2026.W24", key: "ACME", name: "Acme", hours: 16 },
    { person: "Ana Smith", iso: "2026.W24", key: "BETA", name: "Beta", hours: 6 },
  ];
  var roster = {
    "ana smith": { jobFamily: "Consulting", manager: "Mgr A", location: "US",  department: "Services" },
    "ben lee":   { jobFamily: "Delivery",   manager: "Mgr B", location: "ANZ", department: "Services" },
    "gus sales": { jobFamily: "Sales",      manager: "Mgr C", location: "US",  department: "Sales" }
    // "external" deliberately absent
  };

  var result = buildPersonAvailability_(plannedRecs, trackedRecs, [], roster);

  // personWeekPlan
  assert_(result.personWeekPlan["ana smith"]["2026.W24"] === 30, "Ana planned should be 30h");
  assert_(result.personWeekPlan["ben lee"]["2026.W24"]   === 16, "Ben planned should be 16h");
  assert_(!result.personWeekPlan["external"], "External (not in roster) must be excluded");
  assert_(!result.personWeekPlan["gus sales"], "Gus (Dept=Sales, not Services) must be excluded");
  assert_(!result.personMeta["gus sales"], "Gus (Dept=Sales) must not appear in personMeta");

  // personWeekTracked
  assert_(result.personWeekTracked["ana smith"]["2026.W24"] === 22, "Ana tracked should be 22h");
  assert_(!result.personWeekTracked["ben lee"], "Ben has no tracked — key must be absent");

  // personProjectPlan
  assert_(result.personProjectPlan["ana smith"]["ACME"]["2026.W24"] === 20, "Ana ACME plan should be 20h");
  assert_(result.personProjectPlan["ana smith"]["BETA"]["2026.W24"] === 10, "Ana BETA plan should be 10h");

  // personMeta
  assert_(result.personMeta["ana smith"].displayName === "Ana Smith", "displayName should be title-case from rec");
  assert_(result.personMeta["ana smith"].jobFamily   === "Consulting", "jobFamily from roster");
  assert_(result.personMeta["ben lee"].location      === "ANZ", "location from roster");
  assert_(!result.personMeta["external"], "External must not appear in personMeta");

  Logger.log("✅ _test_buildPersonAvailability_ passed");
}

function _test_personWeekPTO_() {
  function assert_(cond, msg) { if (!cond) throw new Error('❌ _test_personWeekPTO_: ' + msg); }

  var NETSUITE_KEY = CONFIG.NONPROJECT_KEYS[0]; // e.g. 'NETSUITE'
  var plannedRecs = [
    { person: 'Ana Smith', iso: '2026.W27', key: 'ACME',        hours: 20 },
  ];
  var trackedRecs = [];
  var ptoRecs = [
    { person: 'Ana Smith', iso: '2026.W27', key: NETSUITE_KEY,  hours: 16, source: 'planned' },
    { person: 'Ben Lee',   iso: '2026.W27', key: NETSUITE_KEY,  hours: 40, source: 'planned' },
    { person: 'Ana Smith', iso: '2026.W26', key: NETSUITE_KEY,  hours: 8,  source: 'tracked' },
    // Ben's W27 PTO is booked AND later logged as tracked — same absence, must not sum to 80h.
    { person: 'Ben Lee',   iso: '2026.W27', key: NETSUITE_KEY,  hours: 40, source: 'tracked' },
  ];
  var roster = {
    'ana smith': { jobFamily: 'Consulting', manager: 'M', location: 'US',  department: 'Services' },
    'ben lee':   { jobFamily: 'Delivery',   manager: 'M', location: 'ANZ', department: 'Services' }
  };

  var result = buildPersonAvailability_(plannedRecs, trackedRecs, ptoRecs, roster);

  assert_(result.personWeekPlan['ana smith']['2026.W27'] === 20,  'Ana project plan 20h');
  assert_(result.personWeekPTO['ana smith']['2026.W27']  === 16,  'Ana PTO planned 16h');
  assert_(result.personWeekPTO['ben lee']['2026.W27']    === 40,  'Ben full-PTO 40h (max of planned+tracked, not summed to 80h)');
  assert_(result.personWeekPTO['ana smith']['2026.W26']  === 8,   'Ana PTO tracked 8h');
  assert_(!result.personWeekPlan['ben lee'],                       'Ben has no project plan');

  Logger.log("✅ _test_personWeekPTO_ passed");
}

/**
 * Verifies scopeRecsToServices_ — the single gate applied to every record BEFORE
 * aggregate_()/timeOffByWeek/buildPersonAvailability_ in getDemandData(), so a
 * non-Services person's hours never reach the heatmap, Planned vs Tracked totals,
 * capacity time-off, or any person-level view, regardless of client-side filters.
 */
function _test_scopeRecsToServices_() {
  function assert_(cond, msg) { if (!cond) throw new Error('❌ _test_scopeRecsToServices_: ' + msg); }

  var recs = [
    { person: 'Ana Smith',  iso: '2026.W27', key: 'ACME', hours: 20 },
    { person: 'Gus Sales',  iso: '2026.W27', key: 'ACME', hours: 12 }, // Dept = Sales
    { person: 'Nobody Here', iso: '2026.W27', key: 'ACME', hours: 8 }, // not in roster at all
  ];
  var profiles = {
    'ana smith': { department: 'Services' },
    'gus sales': { department: 'Sales' }
  };

  var scoped = scopeRecsToServices_(recs, profiles);
  assert_(scoped.length === 1, 'only the Services person should survive scoping, got ' + scoped.length);
  assert_(scoped[0].person === 'Ana Smith', 'the surviving record should be Ana Smith');

  Logger.log("✅ _test_scopeRecsToServices_ passed");
}

function _test_isCrew_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_isCrew_: " + msg); }

  var cases = [
    { title: "60.IC3. Software Engineer",  expect: false },
    { title: "60.M4. Engineering Manager", expect: false },
    { title: "Crew Member",                expect: true  },
    { title: "Senior Crew Member",         expect: true  },
    { title: "Contractor",                 expect: true  },
    { title: "Senior Contractor",          expect: true  },
    { title: "",                           expect: false },
  ];
  cases.forEach(function(c) {
    var result = /crew member|contractor/i.test(c.title);
    assert_(result === c.expect, "title '" + c.title + "' → expected " + c.expect + " got " + result);
  });
  Logger.log("✅ _test_isCrew_ passed");
}

function _test_behaviorSignals() {
  var personWeekPlan = {
    'alex smith': { '2026.W14': 8, '2026.W15': 0, '2026.W27': 8 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personWeekTracked = {
    'alex smith': { '2026.W14': 8, '2026.W27': 0 },
    'jane doe':   { '2026.W14': 8, '2026.W15': 8, '2026.W27': 8 }
  };
  var personProjectPlan = {
    'alex smith': { 'PPT': { '2026.W14': 8, '2026.W27': 8 } },
    'jane doe':   { 'PPT': { '2026.W14': 8, '2026.W27': 4 }, 'ICARE': { '2026.W15': 8, '2026.W27': 4 } }
  };
  var personMeta = {
    'alex smith': { displayName: 'Alex Smith' },
    'jane doe':   { displayName: 'Jane Doe' }
  };
  var weeks = [
    { iso: '2026.W25', status: 'done' },
    { iso: '2026.W26', status: 'done' },
    { iso: '2026.W27', status: 'now' },
    { iso: '2026.W28', status: 'plan' }
  ];
  Logger.log('computePersonState_(8, 0) = ' + computePersonState_(8, 0));
  Logger.log('computePersonState_(8, 1) = ' + computePersonState_(8, 1));
  Logger.log('computePersonState_(8, 2) = ' + computePersonState_(8, 2));
  Logger.log('computePersonState_(0, 6) = ' + computePersonState_(0, 6));
  Logger.log('computePersonState_(2, 0) = ' + computePersonState_(2, 0));
  var qtd = buildQtdWindow_('2026.W27');
  Logger.log('buildQtdWindow_ length: ' + qtd.length + ' first: ' + qtd[0] + ' last: ' + qtd[qtd.length-1]);
  var bs = buildPersonBehaviorSignals_(personWeekPlan, personWeekTracked, personProjectPlan, personMeta, weeks);
  Logger.log('Alex state W27: ' + bs.personWeekState['alex smith']['2026.W27']);
  Logger.log('Jane state W27: ' + bs.personWeekState['jane doe']['2026.W27']);
  Logger.log('Jane qtd score: ' + bs.personQtdScore['jane doe']);
  Logger.log('Alex qtd score: ' + bs.personQtdScore['alex smith']);
  Logger.log('Jane streak len: ' + bs.personStreakLen['jane doe']);
  Logger.log('PPT concentration risk: ' + bs.projectConcentrationRisk['PPT']);
  Logger.log('Jane proj count W27: ' + bs.personQtdProjectCounts['jane doe']['2026.W27']);
  Logger.log('Jane QTD unique projects: ' + bs.personQtdUniqueProjectCount['jane doe']); // PPT + ICARE = 2
  Logger.log('Alex QTD unique projects: ' + bs.personQtdUniqueProjectCount['alex smith']); // PPT only = 1
  Logger.log('Done.');
}

/**
 * Cache chunking roundtrip — verifies cachePutLarge_/cacheGetLarge_ survive a
 * >100 KB payload (multi-chunk) and treat a missing chunk as a clean miss.
 * Run in the GAS editor with no args (uses the real script cache), or via
 * node-tests.js which passes an in-memory stub cache.
 */
function _test_cacheRoundtrip_(cacheOpt) {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_cacheRoundtrip_: " + msg); }
  var cache = cacheOpt || CacheService.getScriptCache();
  var key = "pd_test_roundtrip";

  // Low-compressibility payload: pseudo-random digits so gzip+base64 still
  // exceeds one 90 KB chunk (forces the multi-chunk path).
  var arr = [];
  for (var i = 0; i < 60000; i++) arr.push((i * 104729) % 1000000007);
  var str = JSON.stringify({ rows: arr });

  assert_(cachePutLarge_(cache, key, str, 60) === true, "put failed");
  var meta = parseInt(cache.get(key + "_meta"), 10);
  assert_(meta >= 2, "expected >= 2 chunks, got " + meta + " — payload too small to exercise chunking");
  var back = cacheGetLarge_(cache, key);
  assert_(back === str, "roundtrip mismatch (" + (back ? back.length : "null") + " vs " + str.length + " chars)");

  cache.remove(key + "_0");   // simulate partial eviction
  assert_(cacheGetLarge_(cache, key) === null, "missing chunk must read as a clean miss, not throw/partial");

  Logger.log("✅ _test_cacheRoundtrip_ passed");
}

/**
 * Job-family derivation — roster Job Titles are code-prefixed ("09.M4.1 Manager,
 * Service Delivery"), so the family must come from the numeric prefix (same
 * derivation as the PS dashboard's parseJobCode), not a bare-catalog-title lookup.
 * Regression test for the empty Job Family filter dropdown.
 */
function _test_familyFromTitle_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_familyFromTitle_: " + msg); }

  var cases = [
    // Code-prefixed roster titles → family name from the prefix (title text irrelevant)
    { famCol: "", title: "09.I5.1 Senior Consultant II, Service Delivery", expect: "Service Delivery" },
    { famCol: "", title: "009.M4.1 Manager, Service Delivery",             expect: "Service Delivery" },
    { famCol: "", title: "07.M4.2 Manager, Delivery",                      expect: "Managed Services & Support" },
    { famCol: "", title: "18.I3.1 Consultant, Solution Architecture",      expect: "Solution Architecture" },
    // Explicit Job Family cell always wins
    { famCol: "Ops Custom", title: "09.I3.1 Consultant, Technical Consulting", expect: "Ops Custom" },
    // No prefix → bare catalog-title fallback still works
    { famCol: "", title: "Consultant, Technical Consulting", expect: "Service Delivery" },
    // Unknown / archived / uncoded titles resolve to "" (stay unmapped)
    { famCol: "", title: "Crew Member",             expect: "" },
    { famCol: "", title: "60.IC3. Software Engineer", expect: "" },
    { famCol: "", title: "",                        expect: "" },
  ];
  cases.forEach(function (c) {
    var got = familyFromTitle_(c.famCol, c.title);
    assert_(got === c.expect, "famCol='" + c.famCol + "' title='" + c.title + "' → expected '" + c.expect + "' got '" + got + "'");
  });

  Logger.log("✅ _test_familyFromTitle_ passed");
}

/**
 * Public-holiday capacity signals — matcher, week bounds, weekly rollup,
 * NETSUITE shortfall de-dup, ANZ 7.6h day, capacity-population scoping,
 * and the attachCapacity_ deduction. Pure — runs in GAS editor and Node.
 */
function _test_holidayCapacity_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_holidayCapacity_: " + msg); }

  // ── isoWeekBounds_: 2026.W38 = Mon 2026-09-14 → Sun 2026-09-20 ──
  var b = isoWeekBounds_(2026, 38);
  assert_(b.monday === "2026-09-14", "W38 monday should be 2026-09-14, got " + b.monday);
  assert_(b.sunday === "2026-09-20", "W38 sunday should be 2026-09-20, got " + b.sunday);
  // Year boundary: 2026.W1 starts Mon 2025-12-29
  var b1 = isoWeekBounds_(2026, 1);
  assert_(b1.monday === "2025-12-29", "W1 monday should be 2025-12-29, got " + b1.monday);

  // ── phLocMatchesEmp_: exact, compound, and negative ──
  assert_(phLocMatchesEmp_("Chile", "Chile"), "exact location should match");
  assert_(phLocMatchesEmp_("Australia & New Zealand", "New Zealand"), "compound & should match a part");
  assert_(phLocMatchesEmp_("Malaysia and Singapore", "Singapore"), "'and' compound should match");
  assert_(!phLocMatchesEmp_("Chile", "Peru"), "different location must not match");
  assert_(!phLocMatchesEmp_("Chile", ""), "blank employee location must not match");
  assert_(!phLocMatchesEmp_("Chile", "Unknown"), "'Unknown' employee location must not match");

  // ── buildHolidaysByWeek_: rollup, shortfall de-dup, ANZ day, population scoping ──
  var weeks = [
    { iso: "2026.W38", wk: 38, year: 2026, status: "plan" },
    { iso: "2026.W39", wk: 39, year: 2026, status: "plan" },
  ];
  var phData = [
    { date: "2026-09-17", location: "Chile", holiday: "Fiestas Patrias" },   // Thu, W38
    { date: "2026-09-18", location: "Chile", holiday: "Fiestas Patrias" },   // Fri, W38 (2-day holiday)
    { date: "2026-09-14", location: "Australia & New Zealand", holiday: "King's Birthday" }, // Mon, W38
    { date: "2026-01-01", location: "Chile", holiday: "New Year" },          // outside window → ignored
  ];
  var rosterFull = {
    ok: true,
    profiles: {
      "ana chile":  { location: "Chile", department: "Services", countsForCapacity: true },  // books nothing → 16h shortfall
      "ben chile":  { location: "Chile", department: "Services", countsForCapacity: true },  // booked 16h → 0 shortfall
      "cara chile": { location: "Chile", department: "Services", countsForCapacity: true },  // booked 8h → 8h shortfall
      "dana anz":   { location: "Australia & New Zealand", department: "Services", countsForCapacity: true }, // 1 ANZ day → 7.6h
      "eve chile":  { location: "Chile", department: "Sales",    countsForCapacity: false }, // not capacity → excluded
      "fay us":     { location: "United States", department: "Services", countsForCapacity: true }, // no matching holiday
    },
  };
  var netsuite = {
    "ben chile":  { "2026.W38": 16 },
    "cara chile": { "2026.W38": 8 },
  };
  var hol = buildHolidaysByWeek_(phData, weeks, rosterFull, netsuite);

  var w38 = hol.byWeek["2026.W38"];
  assert_(!!w38, "W38 should carry holiday data");
  assert_(w38.entries.length === 2, "W38 should have 2 grouped entries (Chile 2-day + ANZ 1-day), got " + w38.entries.length);
  var chile = w38.entries.filter(function (e) { return e.location === "Chile"; })[0];
  assert_(chile.days === 2, "Fiestas Patrias should group to 2 days, got " + chile.days);
  assert_(chile.affectedCount === 3, "3 capacity-counted Chile people (eve excluded), got " + chile.affectedCount);
  var anzE = w38.entries.filter(function (e) { return e.location !== "Chile"; })[0];
  assert_(anzE.affectedCount === 1, "1 ANZ person affected, got " + anzE.affectedCount);
  assert_(w38.totalAffected === 4, "4 distinct people affected in W38, got " + w38.totalAffected);
  // shortfall: ana 16 + ben max(0,16−16)=0 + cara max(0,16−8)=8 + dana 7.6 = 31.6
  assert_(Math.abs(hol.shortfallByWeek["2026.W38"] - 31.6) < 0.001,
          "W38 shortfall should be 31.6h, got " + hol.shortfallByWeek["2026.W38"]);
  assert_(!hol.byWeek["2026.W39"], "W39 has no holidays — key must be absent");

  // ── Roster fallback mode: badges without counts, zero shortfall ──
  var holNoRoster = buildHolidaysByWeek_(phData, weeks, { ok: false, profiles: {} }, {});
  var nr38 = holNoRoster.byWeek["2026.W38"];
  assert_(!!nr38 && nr38.entries.length === 2, "fallback mode keeps entries");
  assert_(nr38.entries[0].affectedCount === null && nr38.totalAffected === null,
          "fallback mode has null counts");
  assert_(Object.keys(holNoRoster.shortfallByWeek).length === 0, "fallback mode has no shortfall");

  // ── Empty PH data → empty result ──
  var holEmpty = buildHolidaysByWeek_([], weeks, rosterFull, netsuite);
  assert_(Object.keys(holEmpty.byWeek).length === 0, "no PH data → empty byWeek");

  // ── netsuiteByPersonWeek_ ──
  var ns = netsuiteByPersonWeek_([
    { person: "Ben Chile", iso: "2026.W38", key: "NETSUITE", hours: 8 },
    { person: "Ben  Chile", iso: "2026.W38", key: "NETSUITE", hours: 8 },  // double space → same person
  ]);
  assert_(ns["ben chile"]["2026.W38"] === 16, "netsuite hours should sum per normalized person, got " + JSON.stringify(ns));

  // ── attachCapacity_ subtracts the holiday shortfall (roster mode) ──
  var model = {
    isoList: ["2026.W38", "2026.W39"],
    timeOffByWeek: { "2026.W38": 40 },            // booked NETSUITE (ben 16 + cara 8 + other PTO 16)
    holidayShortfallByWeek: { "2026.W38": 31.6 }, // from the rollup above
    activePeople: {},
  };
  attachCapacity_(model, { ok: true, headcount: 6, baseCapacity: 238, anzCount: 1 });
  assert_(model.grossCapByWeek["2026.W38"] === 238, "gross stays base capacity");
  assert_(Math.abs(model.capByWeek["2026.W38"] - (238 - 40 - 31.6)) < 0.001,
          "W38 net = gross − timeOff − holiday shortfall, got " + model.capByWeek["2026.W38"]);
  assert_(model.capByWeek["2026.W39"] === 238, "W39 (no time off, no holidays) stays gross");

  // ── planned fallback mode also honors the shortfall map (empty in real fallback) ──
  var model2 = {
    isoList: ["2026.W38"],
    timeOffByWeek: {},
    holidayShortfallByWeek: {},
    activePeople: { "2026.W38": 5 },
  };
  attachCapacity_(model2, { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0 });
  assert_(model2.capByWeek["2026.W38"] === 200, "fallback 5×40 with no deductions, got " + model2.capByWeek["2026.W38"]);

  Logger.log("✅ _test_holidayCapacity_ passed");
}
