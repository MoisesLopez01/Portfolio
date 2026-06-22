// ============================================================
// SCRIPT NAME: Project Demand — Week over Week (C-Suite Dashboard)
// PURPOSE:     Standalone Google Apps Script web app. Reads LIVE
//              planned-time data from the "Planned Time Tempo" tab
//              (by spreadsheet ID) and serves Dashboard.html.
// ENVIRONMENT: Google Apps Script (separate project from PS report)
// DATA SOURCE: same sheet the PS report uses, opened by ID.
// ============================================================

var CONFIG = {
  SOURCE_SS_ID:        "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",
  SHEET_NAME:          "Planned Time Tempo",
  NONPROJECT_KEYS:     ["NETSUITE"],   // excluded (time-off synced from NetSuite); case-insensitive
  WEEKS_PAST:          4,
  WEEKS_FUTURE:        3,               // window = 4 past + current + 3 future = 8 weeks
  WEEKLY_CAPACITY_HRS: 40,              // for the optional "≈ FTE" hint (hours ÷ capacity)
  TITLE:               "Project Demand — Week over Week",
};

// ── ENTRY POINT ──────────────────────────────────────────────

/** Serves the dashboard HTML. */
function doGet() {
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
 * Reads the Planned Time Tempo sheet and returns the aggregated demand model
 * for the current 8-week window. All demand figures are in PLANNED HOURS.
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData() {
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
    var recs = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
    return aggregate_(recs, weeks);
  } catch (e) {
    var err = emptyModel_(weeks);
    err.error = "Failed to read source data: " + e.message;
    return err;
  }
}

// ── SHEET PARSING ────────────────────────────────────────────

/**
 * Parses the two-row stacked-header matrix into allocation records.
 * @param {Array<Array>} vals - sheet getValues()
 * @param {string[]} nonProjectKeys
 * @returns {Array<{person:string, iso:string, key:string, name:string, hours:number}>}
 */
function parseAllocations_(vals, nonProjectKeys) {
  var out = [];
  if (!vals || vals.length < 2) return out;

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
  if (hr === -1) return out;

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
    if (!rawKey || exclude[rawKey.toUpperCase()]) continue;        // skip blank + non-project keys
    var name = iSpace !== -1 ? String(row[iSpace] || "").trim() : "";
    for (var wi = 0; wi < wCols.length; wi++) {
      var hours = parseFloat(row[wCols[wi].idx]);
      if (!hours || hours <= 0) continue;
      out.push({ person: person, iso: wCols[wi].iso, key: rawKey, name: name, hours: hours });
    }
  }
  return out;
}

// ── AGGREGATION ──────────────────────────────────────────────

/** Returns an empty model skeleton for the given weeks. */
function emptyModel_(weeks) {
  return {
    weeks: weeks,
    isoList: weeks.map(function (w) { return w.iso; }),
    cap: {}, head: {}, winners: {}, activeProj: {}, weekTotal: {},
    blendByWeek: {}, avgBlend: {}, stretched: {}, activePeople: {},
    order: [], keyName: {}, maxCell: 0.001,
    capacity: CONFIG.WEEKLY_CAPACITY_HRS,
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
function aggregate_(recs, weeks) {
  var model = emptyModel_(weeks);
  var isoList = model.isoList;
  var inWindow = {}; isoList.forEach(function (iso) { inWindow[iso] = true; });

  var cap = {};                 // key -> iso -> summed hours
  var headSets = {};            // key -> iso -> {person:true}
  var peopleProj = {};          // iso -> person -> #distinct projects
  var keyName = {};
  isoList.forEach(function (iso) { peopleProj[iso] = {}; });

  recs.forEach(function (rec) {
    if (!inWindow[rec.iso]) return;
    if (!keyName[rec.key] && rec.name) keyName[rec.key] = rec.name;

    cap[rec.key] = cap[rec.key] || {};
    cap[rec.key][rec.iso] = (cap[rec.key][rec.iso] || 0) + rec.hours;

    headSets[rec.key] = headSets[rec.key] || {};
    headSets[rec.key][rec.iso] = headSets[rec.key][rec.iso] || {};
    headSets[rec.key][rec.iso][rec.person] = true;

    // One record per (person, project, week), so counting records = distinct projects.
    peopleProj[rec.iso][rec.person] = (peopleProj[rec.iso][rec.person] || 0) + 1;
  });

  // Distinct people per project/week.
  var head = {};
  Object.keys(headSets).forEach(function (k) {
    head[k] = {};
    Object.keys(headSets[k]).forEach(function (iso) {
      head[k][iso] = Object.keys(headSets[k][iso]).length;
    });
  });

  // Blend distribution (people on 1/2/3/4+ projects), avg blend, stretched (≥4), active people.
  var blendByWeek = {}, avgBlend = {}, stretched = {}, activePeople = {};
  isoList.forEach(function (iso) {
    var counts = peopleProj[iso];
    var arr = Object.keys(counts).map(function (p) { return counts[p]; });
    blendByWeek[iso] = { 1: 0, 2: 0, 3: 0, 4: 0 };
    var sum = 0, st = 0;
    arr.forEach(function (n) { sum += n; blendByWeek[iso][Math.min(n, 4)]++; if (n >= 4) st++; });
    activePeople[iso] = arr.length;
    avgBlend[iso] = arr.length ? sum / arr.length : 0;
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
  model.winners = winners;
  model.activeProj = activeProj;
  model.weekTotal = weekTotal;
  model.order = totals.map(function (t) { return t.key; });
  model.keyName = keyName;
  model.maxCell = maxCell;
  return model;
}

// ── UNIT TEST (run in the GAS editor, or in Node with a stubbed Logger) ──

/**
 * Verifies the parser + aggregator: hours summed, NETSUITE excluded,
 * winner + blend counts correct. Run _test_demandParse_ and read the log.
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

  var recs = parseAllocations_(vals, CONFIG.NONPROJECT_KEYS);
  // NETSUITE excluded → records only for ACME + BETA.
  assert_(recs.every(function (r) { return r.key !== "NETSUITE"; }), "NETSUITE must be excluded");

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

  // No project key reads NETSUITE.
  assert_(!m.cap.NETSUITE, "NETSUITE must not appear as a project");

  Logger.log("✅ _test_demandParse_ passed");
}
