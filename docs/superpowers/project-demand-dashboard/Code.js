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
  WEEKS_PAST:          4,
  WEEKS_FUTURE:        3,               // window = 4 past + current + 3 future = 8 weeks
  WEEKLY_CAPACITY_HRS: 40,              // available hours per active person per week (default region)
  ANZ_LOCATION:        "Australia & New Zealand", // Roster "Key Location" value → 38 hr week
  ANZ_CAPACITY_HRS:    38,              // weekly base capacity for ANZ people
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
  MOVERS_N:            5,       // # of risers and # of fallers in the Risers & Fallers panel
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
 * comparisons (Risers & Fallers, heatmap Change/Risk).
 * @param {{wk:number, year:number}} week
 * @returns {string} e.g. "2026.W21"
 */
function priorWeekIso_(week) {
  var w = week.wk - 1, y = week.year;
  if (w <= 0) { y--; w = weeksInYear_(y) + w; }
  return y + ".W" + w;
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

// ── MAIN DATA ENDPOINT (called from the client via google.script.run) ──

/**
 * Reads the Planned Time Tempo sheet and the Roster, returning the aggregated
 * demand model for the current 8-week window. All demand figures are PLANNED HOURS.
 * Access is re-checked server-side (defense in depth — the page is already gated).
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData() {
  var access = checkDemandAccess();
  if (!access.allowed) {
    var denied = emptyModel_(buildWindow_());
    denied.error = "Access restricted to authorized users.";
    return denied;
  }

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
    var model = aggregate_(parsed.recs, weeks, baselineIso);
    model.timeOffByWeek = parsed.timeOffByWeek;   // PTO + public holidays (NETSUITE rows), per week
    attachCapacity_(model);          // net capacity (roster base − time-off, with planned fallback)
    return model;
  } catch (e) {
    var err = emptyModel_(weeks);
    err.error = "Failed to read source data: " + e.message;
    return err;
  }
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
function readActiveCapacity_() {
  try {
    var ss = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
    var sh = ss.getSheetByName(CONFIG.ROSTER_SHEET);
    if (!sh) return { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, error: "Roster sheet not found." };

    var last = sh.getLastRow();
    if (last < 2) return { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, error: "Roster is empty." };

    var raw  = sh.getRange(1, 1, last, sh.getLastColumn()).getValues();
    var hdrs = raw[0].map(function (h) { return String(h).trim(); });
    var idx  = function (name) {
      return hdrs.findIndex(function (h) { return h.toLowerCase() === name.toLowerCase(); });
    };
    var iName   = idx("Name");
    var iClass  = idx("Class");
    var iDept   = idx("Department");
    var iStatus = idx("Employee Status");
    var iTerm   = idx("Termination/Release Date");
    var iLoc    = idx("Key Location");
    if (iName === -1) return { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, error: "Roster 'Name' column not found." };

    var anzLoc = String(CONFIG.ANZ_LOCATION).trim().toLowerCase();
    var INACTIVE_RE = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
    var count = 0, base = 0, anz = 0;
    for (var r = 1; r < raw.length; r++) {
      var row  = raw[r];
      var name = String(row[iName] || "").trim();
      if (!name) continue;
      if (iClass !== -1 && String(row[iClass] || "").trim() !== CONFIG.ROSTER_CLASS) continue;
      if (iDept !== -1) {
        var dept = String(row[iDept] || "").trim();
        if (dept && dept !== CONFIG.ROSTER_DEPT) continue;
      }
      var status = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      var term   = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      if (INACTIVE_RE.test(status) || term) continue;     // exclude inactive / terminated
      var loc = iLoc !== -1 ? String(row[iLoc] || "").trim().toLowerCase() : "";
      var isANZ = (loc === anzLoc);
      base += isANZ ? CONFIG.ANZ_CAPACITY_HRS : CONFIG.WEEKLY_CAPACITY_HRS;
      if (isANZ) anz++;
      count++;                                            // ramp-up + crew included
    }
    return { ok: true, headcount: count, baseCapacity: base, anzCount: anz };
  } catch (e) {
    return { ok: false, headcount: 0, baseCapacity: 0, anzCount: 0, error: e.message };
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
function attachCapacity_(model) {
  var cap = CONFIG.WEEKLY_CAPACITY_HRS;
  var hc  = readActiveCapacity_();
  var timeOff = model.timeOffByWeek || {};
  model.capByWeek = {};
  model.grossCapByWeek = {};
  if (hc.ok && hc.headcount > 0) {
    model.capacityMode = "roster";
    model.headcount    = hc.headcount;
    model.anzCount     = hc.anzCount;
    model.baseCapacity = hc.baseCapacity;
    model.isoList.forEach(function (iso) {
      model.grossCapByWeek[iso] = hc.baseCapacity;
      model.capByWeek[iso] = Math.max(0, hc.baseCapacity - (timeOff[iso] || 0));
    });
  } else {
    model.capacityMode = "planned";
    model.headcount    = null;
    model.anzCount     = 0;
    model.capacityNote = hc.error || "Roster unavailable.";
    model.isoList.forEach(function (iso) {
      var gross = (model.activePeople[iso] || 0) * cap;
      model.grossCapByWeek[iso] = gross;
      model.capByWeek[iso] = Math.max(0, gross - (timeOff[iso] || 0));
    });
  }
}

// ── SHEET PARSING ────────────────────────────────────────────

/**
 * Parses the two-row stacked-header matrix into allocation records, and separately
 * sums the excluded non-project keys (NETSUITE = PTO + public holidays) per ISO week
 * so capacity can be reduced by time-off downstream.
 * @param {Array<Array>} vals - sheet getValues()
 * @param {string[]} nonProjectKeys
 * @returns {{ recs:Array<{person:string, iso:string, key:string, name:string, hours:number}>,
 *             timeOffByWeek:Object<string,number> }}
 */
function parseAllocations_(vals, nonProjectKeys) {
  var out = [];
  var timeOffByWeek = {};
  if (!vals || vals.length < 2) return { recs: out, timeOffByWeek: timeOffByWeek };

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
  if (hr === -1) return { recs: out, timeOffByWeek: timeOffByWeek };

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
      } else {
        out.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
      }
    }
  }
  return { recs: out, timeOffByWeek: timeOffByWeek };
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
    capByWeek: capByWeek, grossCapByWeek: {}, timeOffByWeek: {},
    capacityMode: "planned", headcount: null, anzCount: 0, baseCapacity: 0,
    capacity: CONFIG.WEEKLY_CAPACITY_HRS, anzCapacity: CONFIG.ANZ_CAPACITY_HRS,
    planTarget: CONFIG.PLAN_TARGET,
    fragMin: CONFIG.FRAG_MIN, topnStrategic: CONFIG.TOPN_STRATEGIC, moversN: CONFIG.MOVERS_N,
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
