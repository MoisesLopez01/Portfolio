// ============================================================
// SCRIPT NAME: Contributor Intelligence Engine
// PURPOSE:     Analyze RCR signals (last 3 closed months + YTD),
//              goal engagement, and SI scores to surface contributor
//              trends — formatted for executive-level review
// AUTHOR:
// CREATED:
// VERSION:     2.0.0
// ENVIRONMENT: Google Apps Script
// ============================================================

// ============================================================
// ⚙️  CONFIGURATION — Edit values here before running
// ============================================================
const CONFIG = {
  SCRIPT_LABEL: "Contributor Intelligence Engine",

  // ── Source sheet names ────────────────────────────────────
  SHEET_RC:       "1. Revenue Contribution",
  SHEET_TCC:      "2. TCC A+B",
  SHEET_RCR:      "3. RCR",        // FY26 and earlier — "Jun 26" month columns + YTD; SUM(RC)/SUM(TCC) team ratio
  SHEET_RCR_NEW:  "New RCR",       // FY27 on — "2026.07 RCR" month columns, a direct per-person rate joined by
                                   // Internal ID (name fallback). Both tabs feed ONE month axis — see readRcrAxis_,
                                   // which mirrors readRCR_PS_ in PS Contribution Report.js.
  SHEET_GOALS:    "Goals",
  SHEET_SI:       "SI",
  SHEET_BILLABLE: "Billable Time",
  SHEET_JIRA_REPORT: "Weekly Report",
  SHEET_JIRA_RAW: "Jira Raw",
  SHEET_ROSTER:       "Data",
  SHEET_CONTRACTORS:  "Contractors Data",

  // ── Internal IDs that are aggregate/summary rows, not real employees ─
  EXCLUDED_INTERNAL_IDS: ["0 PS", "0 MS", "Total"],
  SHEET_EXCLUSIVITY: "ExclusivityContracts",
  SHEET_DELIVERY_MGRS: "Delivery Managers",
  ROSTER_SS_ID:   "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",

  // ── Billable Time Column Indices (0-based) ───────────────
  B_COLS: {
    DATE:                5,   // Column F
    ENTITY_ID:           2,   // Column C (Employee Name)
    JOB_TITLE:           3,   // Column D
    DURATION:            13,  // Column N
    BILLABLE:            11,  // Column L (Text "TRUE"/"FALSE")
    PROJECT_TYPE:        14,  // Column O
    CUSTOMER_PROJECT:    6,   // Column G
  },
  INCLUDE_PROJECT_TYPES: ["Consulting", "Managed Service"],

  // ── Output sheet names ────────────────────────────────────
  SHEET_OUTPUT: "📊 Contributor Intelligence",
  SHEET_OUTPUT_NON_CONTRIB: "📊 Non-Contributor Intelligence",
  SHEET_OUTPUT_CREW: "📊 Crew Member Intelligence",

  // ── Weekly detail window ──────────────────────────────────
  // Completed weeks shown per person (comments, logged time, Jira backlog,
  // kudos). Every weekly array and column set is sized from this.
  WEEKS_WINDOW: 4,

  // ── Goals (external PS Goals spreadsheet) ────────────────
  GOALS_SS_ID:         "1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ",
  SHEET_GOALS_RD:      "RD",
  // The goals quarter is DERIVED (fiscalContextCR_, FY starts July 1): the current
  // fiscal quarter, or — for the first GOALS_GRACE_DAYS of a new quarter — the quarter
  // that just closed, so the sheet shows the closed quarter's final rate exactly as the
  // PS Dashboard does. Pacing rules mirror readGoalsEngagement_; the three policy
  // numbers below are fallbacks used only when CONFIG_PS is not in scope.
  GOALS_MIN_COUNT:            8,     // Rule 1 — distinct goals required after the 4-week writing ramp
  GOALS_ACTIVE_COMMENT_COUNT: 6,     // Rule 3 — goals that must carry ≥ reqCmt self-comments
  GOALS_MIN_IN_PROGRESS_PCT:  0.5,   // Rule 2 — share of goals that must be "In Progress"
  GOALS_GRACE_DAYS:           21,    // closed-quarter window after a quarter starts

  // ── Kudos ─────────────────────────────────────────────────
  SHEET_KUDOS: "Kudos_Normalized",

  // ── RCR Tier Thresholds ───────────────────────────────────
  // Aligned to the PS Dashboard (CONFIG_PS.RCR_* in PS Contribution Report.js)
  // on 2026.W42, so a rocketeer's tier here is the tier the dashboard shows.
  // Applied to the LATEST closed month on the merged RCR axis, not to YTD.
  RCR_CRITICAL: 1.0,  // ≤ 1.0  → Critical
  RCR_WATCH:    1.5,  // ≤ 1.5  → Watch
  RCR_HEALTHY:  2.5,  // ≤ 2.5  → Healthy
  //             > 2.5 → Champion

  // ── RCR month axis ────────────────────────────────────────
  // Month columns are no longer listed here: readRcrAxis_ discovers them from
  // the headers of BOTH RCR tabs ("Jun 26" and "2026.07 RCR" spellings), sorts
  // them chronologically and keeps every populated one, so the trend window and
  // the latest month roll across the fiscal-year boundary on their own.

  // ── YTD column ────────────────────────────────────────────
  // The YTD column follows the fiscal year of the latest month on the RCR axis
  // ("FY27 YTD RCR" from Jul 26): for a New RCR (rate) year it is the mean of the
  // person's months in that FY; for a 3. RCR (ratio) year it is the tab's own YTD
  // column, read from COL_YTD. LEGACY_YTD_LABEL is only the label when the axis is empty.
  COL_YTD: "YTD",
  LEGACY_YTD_LABEL: "YTD RCR",

  // ── Org-scoped runs ───────────────────────────────────────
  // runContributorIntelligenceForOrg(leader) writes the three reports for one
  // org tree (everyone under the leader, managers and ICs, minus the leader's
  // own row) to sheets named "<output name><ORG_SHEET_SEP><leader>".
  ORG_SHEET_SEP: " · ",

  // ── Number of recent closed months to surface in the report
  TREND_MONTHS: 3,

  // ── Consecutive low-RCR months to trigger "Sustained" flag ─
  SUSTAINED_LOW_MONTHS: 3,

  // ── Top N Champion records to display ────────────────────
  TOP_N: 15,

  // ── Job levels with non-revenue context notes ─────────────
  JOB_LEVEL_CONTEXT: {
    "I1": "Intern — RCR may be inflated by shared-project cost allocation vs. low TCC",
    "I2": "Junior Intern — shared-project inflation risk (same as I1)",
    "M4": "Manager L1 — indirect revenue role; individual RCR less meaningful",
    "M5": "Senior Manager — leadership role; benchmark against team output",
    "M6": "Director — individual RCR not primary performance measure",
  },

  // ── SI score labels ───────────────────────────────────────
  SI_LABELS: {
    1: "Needs Help",
    2: "Below Expectation",
    3: "Meeting Expectations",
    4: "Great",
    5: "Outstanding",
  },

  // ── Jira Configuration ────────────────────────────────────
  JIRA: {
    BASE_URL: "https://servicerocket-coe.atlassian.net",
    EMAIL:    "moises.lopez@servicerocket.com",
    LOOKBACK_DAYS: 28,
    WEEKS_BACK: 3,
    FIELDS: [
      "summary", "issuetype", "project", "assignee", 
      "status", "updated", "resolutiondate", "customfield_10015"
    ],
  },

  // ── Dashboard Logic Mapping (From Dashboard Logic) ───────
  // NOTE: This logic is mirrored from the COE Dashboard (Full HC Analysis.js / Employee Impact.js)
  // to ensure consistency in headcount classification.
  DASHBOARD_GROUPS: {
    "Solution Architecture": ["Solution Architecture"],
    "Services": ["Managed Services & Support", "Service Delivery"],
    "Project Management": ["Operations"]
  }
};

// ============================================================
// 🎨  COMPANY BRAND PALETTE — Do not modify
// ============================================================
const COMPANY_COLORS = {
  VOID_BLUE:   "#0F1941",
  ORBE_BLUE:   "#058CDC",
  IVORY:       "#DCCDBE",
  LIGHT_CREAM: "#FFFAF5",
  ROYAL:       "#2864E6",
  JUNE:        "#FF9B87",
};

// ── Executive theme ────────────────────────────────────────
// Philosophy: white/near-white backgrounds throughout.
// Tier is communicated via text badge color and a subtle tint
// on the badge cell only — not on the full row.
const EXEC = {
  // Page chrome
  BANNER_BG:    "#0F1941",   // Void Blue — title bar
  BANNER_TEXT:  "#FFFFFF",
  SUBBAR_BG:    "#1A2E6B",
  SUBBAR_TEXT:  "#CCDDFF",

  // Section headers
  SECTION_DARK: "#1E3A5F",   // Critical / primary sections
  SECTION_MID:  "#2C5F8A",   // Watch / trend sections
  SECTION_FG:   "#FFFFFF",

  // Table chrome
  COL_HDR_BG:   "#2C3E6B",
  COL_HDR_FG:   "#FFFFFF",
  ROW_ODD:      "#FFFFFF",
  ROW_EVEN:     "#F2F5FB",   // Very pale blue-grey stripe
  TEXT_DARK:    "#1A1A2E",
  TEXT_MID:     "#5A6478",   // Muted — for secondary / signal text

  // Tier: badge cell tint + text color
  // All tints are very light so black/dark text remains readable
  CRITICAL_TINT: "#FDECEA",  FG_CRITICAL: "#B71C1C",
  WATCH_TINT:    "#FFF8E1",  FG_WATCH:    "#7B4800",
  HEALTHY_TINT:  "#F1F8F4",  FG_HEALTHY:  "#1B5E20",
  CHAMPION_TINT: "#EEF4FF",  FG_CHAMPION: "#0D3B8C",
  NODATA_TINT:   "#F9F9F9",  FG_NODATA:   "#888888",
  NONCONTRIB_TINT: "#F3F0FF", FG_NONCONTRIB: "#6B21A8",

  // Section accent color (left border of section header)
  ACC_CRITICAL:  "#B71C1C",
  ACC_WATCH:     "#E65100",
  ACC_CHAMPION:  "#0D47A1",
  ACC_REGION:    "#1E3A5F",

  // Trend text colors (applied per-cell)
  TC_RED:   "#C62828",
  TC_AMBER: "#BF360C",
  TC_GREEN: "#2E7D32",
  TC_GREY:  "#607D8B",
};

// ============================================================
// ── SECTION: HELPERS ─────────────────────────────────────────
// ============================================================

/**
 * Loads all data from a named sheet.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @returns {{ headers: string[], rows: any[][] }}
 */
function loadSheet_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error(`Sheet not found: "${sheetName}"`);
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { headers: data[0] || [], rows: [] };
  return { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
}

/**
 * Loads the Roster sheet from the external spreadsheet (range B1:M).
 * @returns {{ headers: string[], rows: any[][] }}
 */
function loadRosterSheet_() {
  const rosterSS = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
  const sheet = rosterSS.getSheetByName(CONFIG.SHEET_ROSTER);
  if (!sheet) throw new Error(`Roster sheet not found in external spreadsheet: "${CONFIG.SHEET_ROSTER}"`);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { headers: [], rows: [] };
  // Read full range from col A so Internal ID (col A) is included
  const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
  const headers = data[0].map(h => String(h).trim());
  const rows = data.slice(1).filter(row => row.some(c => c !== "" && c !== null));
  return { headers, rows };
}

/**
 * Loads the Contractors Data tab from the external Roster spreadsheet.
 * Everyone in this tab is treated as a Crew Member; active-only rows are returned.
 * @returns {{ headers: string[], rows: any[][] }}
 */
function loadContractorsSheet_() {
  try {
    const rosterSS = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
    const sheet = rosterSS.getSheetByName(CONFIG.SHEET_CONTRACTORS);
    if (!sheet) {
      Logger.log(`⚠️ Contractors Data sheet not found in Roster SS — crew will be empty`);
      return { headers: [], rows: [] };
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { headers: [], rows: [] };
    const data = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getValues();
    const headers = data[0].map(h => String(h).trim());
    const rows = data.slice(1).filter(row => row.some(c => c !== "" && c !== null));
    Logger.log(`Contractors Data: loaded ${rows.length} raw rows`);
    return { headers, rows };
  } catch (e) {
    Logger.log(`❌ loadContractorsSheet_: ${e.message}`);
    return { headers: [], rows: [] };
  }
}

/**
 * Loads the Goals RD tab from the external Goals spreadsheet.
 * @returns {{ headers: string[], rows: any[][] }}
 */
function loadGoalsRD_() {
  try {
    const goalsSS = SpreadsheetApp.openById(CONFIG.GOALS_SS_ID);
    const sheet = goalsSS.getSheetByName(CONFIG.SHEET_GOALS_RD);
    if (!sheet) {
      Logger.log(`⚠️ Goals RD sheet "${CONFIG.SHEET_GOALS_RD}" not found in Goals SS`);
      return { headers: [], rows: [] };
    }
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return { headers: data[0] ? data[0].map(h => String(h).trim()) : [], rows: [] };
    Logger.log(`Goals RD: loaded ${data.length - 1} rows`);
    return { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
  } catch (e) {
    Logger.log(`❌ loadGoalsRD_: ${e.message}`);
    return { headers: [], rows: [] };
  }
}

/**
 * Reads Kudos_Normalized (same tab as PS Contribution Report) and returns
 * a Map of normalized recipient name → kudos count within the WEEKS_WINDOW window.
 * Reuses PS infrastructure: loadSheet_PS_, findCol_PS_, parseDate_PS_, CONFIG_PS.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks  — output of getLastNCompletedWeeks_(CONFIG.WEEKS_WINDOW)
 * @returns {Map<string, number>}
 */
function getKudosData_(ss, weeks) {
  try {
    const data = loadSheet_PS_(ss, CONFIG_PS.SHEET_KUDOS);
    if (!data) { Logger.log('⚠️ Kudos: sheet not found'); return new Map(); }

    const hdrs   = data.headers.map(h => h.toLowerCase());
    const iRecip = findCol_PS_(hdrs, "recipient");
    const iDate  = findCol_PS_(hdrs, "create date");
    if (iRecip === -1) { Logger.log('⚠️ Kudos: Recipient column not found'); return new Map(); }

    const map = new Map();
    data.rows.forEach(row => {
      const name = String(row[iRecip] || "").trim();
      if (!name) return;
      if (iDate !== -1) {
        const d = parseDate_PS_(row[iDate]);
        if (!d || !weeks.some(w => isInWeek_(d, w.start, w.end))) return;
      }
      const key = normalizeToRosterKey_(name);
      map.set(key, (map.get(key) || 0) + 1);
    });
    Logger.log(`Kudos: ${map.size} recipients with kudos in ${weeks.length}-week window`);
    return map;
  } catch (e) {
    Logger.log(`❌ getKudosData_: ${e.message}`);
    return new Map();
  }
}

/**
 * Loads the ExclusivityContracts tab.
 * Searches the active spreadsheet first, then falls back to the external Roster spreadsheet.
 * Returns a Set of normalized employee names found in that tab.
 * @returns {Set<string>}
 */
function loadExclusivitySet_() {
  try {
    // Try active spreadsheet first, then external Roster spreadsheet
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_EXCLUSIVITY);
    let source = "active spreadsheet";
    if (!sheet) {
      Logger.log(`ExclusivityContracts not found in active spreadsheet — checking Roster spreadsheet...`);
      const rosterSS = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
      sheet = rosterSS.getSheetByName(CONFIG.SHEET_EXCLUSIVITY);
      source = "Roster spreadsheet";
    }
    if (!sheet) {
      Logger.log(`⚠️ ExclusivityContracts sheet not found in either spreadsheet — all employees will default to "—"`);
      return new Set();
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log(`ExclusivityContracts: sheet found in ${source} but has no data rows`);
      return new Set();
    }
    const headers = data[0].map(h => String(h).trim());
    Logger.log(`ExclusivityContracts: found in ${source}, headers: [${headers.join(", ")}]`);

    const nameIdx = headers.findIndex(h => h.toLowerCase() === "name");
    if (nameIdx === -1) {
      Logger.log(`ExclusivityContracts: no "Name" column found — using column A (header: "${headers[0]}")`);
    }
    const col = nameIdx !== -1 ? nameIdx : 0;
    const names = new Set();
    data.slice(1).forEach(row => {
      const name = String(row[col] || "").trim();
      if (name) names.add(normalizeName_(name));
    });
    Logger.log(`ExclusivityContracts: loaded ${names.size} exclusive names from ${source}`);
    if (names.size > 0) {
      const sample = Array.from(names).slice(0, 5).join(", ");
      Logger.log(`  Sample names: ${sample}${names.size > 5 ? " ..." : ""}`);
    }
    return names;
  } catch (e) {
    Logger.log(`❌ ExclusivityContracts load error: ${e.message} — defaulting to empty set`);
    return new Set();
  }
}

/**
 * Loads a named tab and returns a Set of normalized names from its "Name" column.
 * Searches the active spreadsheet first, then the external Roster spreadsheet.
 * @param {string} sheetName  tab name to look for
 * @param {string} label      friendly label for logging
 * @returns {Set<string>}
 */
function loadNameSet_(sheetName, label) {
  try {
    let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    let source = "active spreadsheet";
    if (!sheet) {
      Logger.log(`${label} not found in active spreadsheet — checking Roster spreadsheet...`);
      const rosterSS = SpreadsheetApp.openById(CONFIG.ROSTER_SS_ID);
      sheet = rosterSS.getSheetByName(sheetName);
      source = "Roster spreadsheet";
    }
    if (!sheet) {
      Logger.log(`⚠️ ${label} sheet not found in either spreadsheet — will default to "—"`);
      return new Set();
    }
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) {
      Logger.log(`${label}: sheet found in ${source} but has no data rows`);
      return new Set();
    }
    const headers = data[0].map(h => String(h).trim());
    Logger.log(`${label}: found in ${source}, headers: [${headers.join(", ")}]`);
    const nameIdx = headers.findIndex(h => h.toLowerCase() === "name");
    if (nameIdx === -1) {
      Logger.log(`${label}: no "Name" column found — using column A (header: "${headers[0]}")`);
    }
    const col = nameIdx !== -1 ? nameIdx : 0;
    const names = new Set();
    data.slice(1).forEach(row => {
      const name = String(row[col] || "").trim();
      if (name) names.add(normalizeName_(name));
    });
    Logger.log(`${label}: loaded ${names.size} names from ${source}`);
    if (names.size > 0) {
      const sample = Array.from(names).slice(0, 5).join(", ");
      Logger.log(`  Sample: ${sample}${names.size > 5 ? " ..." : ""}`);
    }
    return names;
  } catch (e) {
    Logger.log(`❌ ${label} load error: ${e.message} — defaulting to empty set`);
    return new Set();
  }
}

/**
 * Returns a blank employee record keyed by internalId.
 * @param {string} internalId
 * @returns {object}
 */
function blankEmployee_(internalId) {
  return {
    empId: internalId, key: internalId,
    name: "", internalId, empNumber: "", dept: "",
    jobTitle: "", jobCategory: "", contributorType: "—", empClass: "", jobLevel: "",
    supervisor: "", region: "", empStatus: "", tenure: null,
    monthlyRCR: [], lastMonthsRCR: [],
    ytdRCR: null, ytdRevenue: 0, ytdTCC: 0, trend: "Insufficient Data",
    // Latest closed month on the merged RCR axis — the value the PS Dashboard
    // shows for this person. Drives tier, sort order and the group summaries.
    rcrCurrent: null, rcrCurrentMonth: null, rcrSource: null,
    rcLatest: 0, tccLatest: 0,                 // latest-month RC / TCC (legacy ratio months only)
    // Dashboard population flags (joinDashboardFlags_) — default to "counts".
    tracksTime: true, isRampUp: false, onLeave: false, isManager: false,
    tierInfo: classifyRCR_(null, ""),
    siScores: [], validSI: [], latestSI: null, avgSI: null, siTrend: "—",
    goalsCompleted: null, goalsInProgress: null, goalsTotal: null,
    goalEngagementPct: null, goalsNote: "—", goalActivityTrend: "—",
    goalMonthLabels: ["M-2", "M-1", "M-0"],
    goalMonthlyComments: weekZeros_(),  // repurposed: weekly comment counts per WEEKS_WINDOW
    goalAvgCommentsPerWeek: 0,
    kudosL3W: 0,
    // Hours — all from Tempo Tracked Time (joined after buildEmployeeMap_)
    lastWeekTotalHrs: 0, prevWeekTotalHrs: 0, avgTotalHrs: 0,
    weeklyTrackedHrs: weekZeros_(),  // per week, oldest → LW
    jiraEpicCounts: weekZeros_(),
    isCrewMember: false,
  };
}

/**
 * Finds column index by header name (case-insensitive). Returns -1 if missing.
 * @param {string[]} headers
 * @param {string} name
 * @returns {number}
 */
function colIdx_CR_(headers, name) {
  return headers.findIndex(h => h.toLowerCase() === name.toLowerCase().trim());
}

/**
 * Reads a numeric cell value. Returns null if blank or non-numeric.
 * @param {any[]} row
 * @param {string[]} headers
 * @param {string} colName
 * @returns {number|null}
 */
function numVal_(row, headers, colName) {
  const idx = colIdx_CR_(headers, colName);
  if (idx < 0) return null;
  const v = row[idx];
  if (v === "" || v === null || v === undefined) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

/**
 * Reads a string cell value.
 * @param {any[]} row
 * @param {string[]} headers
 * @param {string} colName
 * @returns {string}
 */
function strVal_(row, headers, colName) {
  const idx = colIdx_CR_(headers, colName);
  if (idx < 0) return "";
  return String(row[idx] || "").trim();
}

/**
 * Returns all populated monthly RCR points in fiscal order.
 * @param {any[]} row
 * @param {string[]} headers
 * @returns {{ month: string, value: number }[]}
 */
function getMonthlyValues_(row, headers) {
  // Legacy single-sheet reader kept for callers that hold a 3. RCR row; the
  // report itself takes per-person months from readRcrAxis_ (both tabs).
  return rcrMonthColumnsCR_(headers)
    .map(c => ({ month: c.name, value: numVal_(row, headers, headers[c.col]), source: "ratio" }))
    .filter(x => x.value !== null);
}

// Month-header parser: "Jun 26" | "2026.07 RCR" -> { name: "Jun 26" | "Jul 26", sortKey }.
// A local copy of rcrMonthFromHeader_ / rcrMonthColumns_ (PS Contribution Report.js,
// 2026.W42) so this exporter also runs in a project whose report file predates the
// New RCR axis. The shared parser is preferred when it is in scope, so the two can
// never disagree once both are deployed.
const RCR_MONTH_ABBR_CR_  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const RCR_MONTH_ORDER_CR_ = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
function rcrMonthFromHeaderCR_(h) {
  if (typeof rcrMonthFromHeader_ === "function") return rcrMonthFromHeader_(h);
  const s = String(h || "").trim();
  let m = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{2})$/i);
  if (m) {
    const mo = RCR_MONTH_ORDER_CR_[m[1].toLowerCase()];
    return { name: RCR_MONTH_ABBR_CR_[mo] + " " + m[2], sortKey: (2000 + parseInt(m[2], 10)) * 12 + mo };
  }
  m = s.match(/^(\d{4})[.\-\/](\d{1,2})\s+RCR$/i);
  if (m) {
    const yr = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1;
    if (mo < 0 || mo > 11) return null;
    return { name: RCR_MONTH_ABBR_CR_[mo] + " " + String(yr % 100).padStart(2, "0"), sortKey: yr * 12 + mo };
  }
  return null;
}
// Every month column of a sheet, oldest -> newest: [{ name, sortKey, col }].
function rcrMonthColumnsCR_(headers) {
  if (typeof rcrMonthColumns_ === "function") return rcrMonthColumns_(headers);
  return headers
    .map((h, i) => { const m = rcrMonthFromHeaderCR_(h); return m ? { name: m.name, sortKey: m.sortKey, col: i } : null; })
    .filter(Boolean)
    .sort((a, b) => a.sortKey - b.sortKey);
}

// ── RCR month axis — two tabs, one axis ───────────────────────────────────
// Mirrors readRCR_PS_ (PS Contribution Report.js) so this export and the
// dashboard agree on which month is "latest" and what each person's value is:
//   "3. RCR"  — FY26 and earlier, "Jun 26" headers, joined by Employee ID
//               (the Roster Internal ID). A derived ratio: the team value for
//               one of these months is SUM(RC)/SUM(TCC) over the same IDs.
//   "New RCR" — FY27 on, "2026.07 RCR" headers, joined by Internal ID with a
//               name fallback. A direct per-person rate; the team value is the
//               mean of the tracking-mandated subset.
// A month both tabs carry resolves to the New RCR rate. A month column with no
// numeric value for any joined row is skipped, so a pre-created, still-empty
// column never becomes "the latest month". rcrMonthColumns_ / rcrMonthFromHeader_
// come from PS Contribution Report.js (same Apps Script project).
//
// @param {{headers,rows}|null} rcrData     3. RCR
// @param {{headers,rows}|null} newRcrData  New RCR
// @param {Map<string,string>}  rosterNameToId  normalized name → Internal ID (name fallback)
// @returns {{ months: {name,sortKey,source}[], latest: {name,sortKey,source}|null,
//             lastMonths: string[], byId: Map<string, Map<string,{value,source}>> }}
function readRcrAxis_(rcrData, newRcrData, rosterNameToId) {
  const bySort = new Map();                     // sortKey → { name, sortKey, source }
  const byId   = new Map();                     // internalId → Map<monthName, { value, source }>
  const excluded = new Set(CONFIG.EXCLUDED_INTERNAL_IDS.map(x => String(x).trim().toLowerCase()));

  const ingest = (data, source, resolveId) => {
    if (!data || !data.headers || !data.rows) return;
    const cols = rcrMonthColumnsCR_(data.headers);
    const ids  = data.rows.map(resolveId);
    cols.forEach(c => {
      let populated = false;
      data.rows.forEach((row, ri) => {
        const id = ids[ri];
        if (!id) return;
        const v = parseFloat(row[c.col]);
        if (isNaN(v)) return;
        populated = true;
        if (!byId.has(id)) byId.set(id, new Map());
        byId.get(id).set(c.name, { value: v, source });   // later ingest (rate) overwrites earlier (ratio)
      });
      if (!populated) return;
      if (source === "rate" && bySort.has(c.sortKey) && bySort.get(c.sortKey).source !== "rate") {
        Logger.log(`ℹ️ RCR: "${c.name}" is in both tabs — using the New RCR rate.`);
      }
      bySort.set(c.sortKey, { name: c.name, sortKey: c.sortKey, source });
    });
  };

  // Only roster people join (the dashboard drops rows whose ID and name both
  // miss the roster — terminated people the roster no longer carries). With no
  // roster map at all every well-formed ID is accepted.
  const knownIds = rosterNameToId && rosterNameToId.size ? new Set(rosterNameToId.values()) : null;
  const cleanId  = v => String(v || "").replace(/,/g, "").trim();
  const okId     = id => id && !excluded.has(id.toLowerCase()) && (!knownIds || knownIds.has(id)) ? id : "";

  // 3. RCR — Employee ID; rows with a Termination Date are skipped (as in the main join)
  if (rcrData && rcrData.headers) {
    const iTerm = colIdx_CR_(rcrData.headers, "Termination Date");
    ingest(rcrData, "ratio", row => {
      if (iTerm !== -1 && String(row[iTerm] || "").trim()) return "";
      return okId(cleanId(strVal_(row, rcrData.headers, "Employee ID")));
    });
  }
  // New RCR — Internal ID, name fallback
  if (newRcrData && newRcrData.headers) {
    const hdrs  = newRcrData.headers;
    const iId   = hdrs.findIndex(h => /^internal.?id/i.test(String(h).trim()));
    let   iName = hdrs.findIndex(h => /^employee(\s*name)?$/i.test(String(h).trim()));
    if (iName === -1) iName = hdrs.findIndex(h => /^name/i.test(String(h).trim()));
    ingest(newRcrData, "rate", row => {
      const id = iId !== -1 ? okId(cleanId(row[iId])) : "";
      if (id) return id;
      if (iName === -1 || !rosterNameToId) return "";
      return rosterNameToId.get(normalizeName_(row[iName])) || "";
    });
  }

  const months = Array.from(bySort.values()).sort((a, b) => a.sortKey - b.sortKey);
  const latest = months.length ? months[months.length - 1] : null;
  const lastMonths = months.slice(-CONFIG.TREND_MONTHS).map(m => m.name);
  Logger.log(`RCR axis: ${months.length} populated month(s) — ` +
             (months.length ? `${months[0].name} → ${latest.name} (latest from ${latest.source === "rate" ? CONFIG.SHEET_RCR_NEW : CONFIG.SHEET_RCR})` : "none") +
             `; ${byId.size} people with a value`);
  return { months, latest, lastMonths, byId };
}

/**
 * Per-person monthly series from the axis, oldest → newest.
 * @returns {{ month, sortKey, value, source }[]}
 */
function rcrSeriesFor_(axis, internalId) {
  const m = axis.byId.get(internalId);
  if (!m) return [];
  return axis.months
    .filter(x => m.has(x.name))
    .map(x => ({ month: x.name, sortKey: x.sortKey, value: m.get(x.name).value, source: m.get(x.name).source }));
}

/** Fiscal year number of an axis sortKey (year*12 + month0). FY starts July 1: Jul 2026 → 2027. */
function fiscalYearOfSortKey_(sortKey) {
  const y = Math.floor(sortKey / 12), m = sortKey % 12;
  return (m >= 6 ? y : y - 1) + 1;
}

/** "FY27 YTD RCR" for the fiscal year of the axis's latest month; the fallback label when empty. */
function ytdLabelFor_(axis) {
  if (!axis || !axis.latest) return CONFIG.LEGACY_YTD_LABEL;
  return `FY${String(fiscalYearOfSortKey_(axis.latest.sortKey)).slice(-2)} YTD RCR`;
}

/**
 * Fiscal-year-to-date RCR for one person, by the method of the latest month:
 *   rate year  → mean of their months in that FY (there is nothing to sum);
 *   ratio year → the 3. RCR tab's own YTD column (sheetYtd), the true SUM/SUM figure.
 * @param {{month,sortKey,value,source}[]} series  rcrSeriesFor_ output
 * @param {object} axis
 * @param {number|null} sheetYtd  value read from CONFIG.COL_YTD, if any
 * @returns {number|null}
 */
function ytdRcrFor_(series, axis, sheetYtd) {
  if (!axis || !axis.latest) return sheetYtd;
  if (axis.latest.source !== "rate") return sheetYtd;
  const fy   = fiscalYearOfSortKey_(axis.latest.sortKey);
  const vals = series.filter(p => fiscalYearOfSortKey_(p.sortKey) === fy).map(p => p.value);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100;
}

// ── Fiscal context — FY, quarter, grace window ────────────────────────────
// Mirrors computeFiscalContext_ (PS Contribution Report.js): FY starts July 1
// (FY27 = Jul 2026 – Jun 2027), quarters are fixed 3-month windows, and the
// first GOALS_GRACE_DAYS of a new quarter are a Goals-only transition window in
// which the dashboard keeps showing the quarter that just closed. Kept local
// (with a reference date for tests) so the exporter never depends on the
// report file's version; the grace length is taken from CONFIG_PS when present.
function fiscalContextCR_(referenceDate) {
  const today = referenceDate instanceof Date ? referenceDate : new Date();
  const m = today.getMonth() + 1, yr = today.getFullYear();
  const fyStartCalYear = m >= 7 ? yr : yr - 1;
  const fyNum = fyStartCalYear + 1;
  const qNum  = m >= 7 && m <= 9 ? 1 : m >= 10 ? 2 : m <= 3 ? 3 : 4;
  const fq    = (fy, q) => `FY${String(fy).slice(-2)}Q${q}`;
  const qStartOf = (fy, q) => new Date(q <= 2 ? fy - 1 : fy, [6, 9, 0, 3][q - 1], 1);
  const qEndOf   = (fy, q) => { const s = qStartOf(fy, q); return new Date(s.getFullYear(), s.getMonth() + 3, 0, 23, 59, 59, 999); };
  const prevFy = qNum === 1 ? fyNum - 1 : fyNum, prevQ = qNum === 1 ? 4 : qNum - 1;
  const graceDays = (typeof CONFIG_PS !== "undefined" && CONFIG_PS.GOALS_GRACE_DAYS) || CONFIG.GOALS_GRACE_DAYS;
  const qStart    = qStartOf(fyNum, qNum);
  const dayOfQtr  = Math.floor((today - qStart) / 86400000);
  const inGracePeriod = dayOfQtr < graceDays;
  const graceEnd  = new Date(qStart.getFullYear(), qStart.getMonth(), qStart.getDate() + graceDays - 1);
  // The quarter the report evaluates: the closed one while in the grace window.
  const rFy = inGracePeriod ? prevFy : fyNum, rQ = inGracePeriod ? prevQ : qNum;
  // SI: the last four COMPLETED quarters, newest last (the dashboard reads the newest).
  const siQuarters = [];
  let sFy = prevFy, sQ = prevQ;
  for (let i = 0; i < 4; i++) { siQuarters.unshift(fq(sFy, sQ)); if (sQ === 1) { sQ = 4; sFy--; } else sQ--; }
  return {
    fyNum, fyLabel: `FY${String(fyNum).slice(-2)}`, qNum,
    goalsQuarter: fq(fyNum, qNum), prevGoalsQuarter: fq(prevFy, prevQ),
    inGracePeriod, graceDays, graceEndDate: graceEnd,
    reportQuarter: fq(rFy, rQ), reportQStart: qStartOf(rFy, rQ), reportQEnd: qEndOf(rFy, rQ),
    siQuarters,
  };
}

/**
 * Pacing thresholds for the evaluated week of the report quarter, as the
 * dashboard computes them per week: qWeek from the quarter's first Monday,
 * reqCmt = max(1, qWeek − 4), no goal-count penalty in the first four weeks.
 * `evalDate` is the end of the last completed week, capped at the quarter end
 * (a closed quarter is judged at its final week).
 */
function goalsPacing_(fc, evalDate) {
  const mondayOf = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const end   = evalDate && evalDate < fc.reportQEnd ? new Date(evalDate) : new Date(fc.reportQEnd);
  const qWeek = Math.max(1, Math.floor((mondayOf(end) - mondayOf(fc.reportQStart)) / (7 * 86400000)) + 1);
  const ps = typeof CONFIG_PS !== "undefined" ? CONFIG_PS : {};
  const minCount      = ps.GOALS_MIN_COUNT            || CONFIG.GOALS_MIN_COUNT;
  const activeCount   = ps.GOALS_ACTIVE_COMMENT_COUNT || CONFIG.GOALS_ACTIVE_COMMENT_COUNT;
  const inProgressPct = ps.GOALS_MIN_IN_PROGRESS_PCT  || CONFIG.GOALS_MIN_IN_PROGRESS_PCT;
  return {
    qWeek, evalEnd: end,
    reqCmt: Math.max(1, qWeek - 4),
    goalsRequired: qWeek <= 4 ? 0 : minCount,
    minCount, activeCount, inProgressPct,
  };
}

/**
 * The dashboard's three-rule verdict for one person (readGoalsEngagement_):
 *   Rule 1 — at least goalsRequired goals (0 during the writing ramp);
 *   Rule 2 — more than inProgressPct of them "In Progress";
 *   Rule 3 — at least activeCount goals with ≥ reqCmt self-comments by evalEnd
 *            (a completed goal needs just one).
 * @param {Map<string,{status,selfComments:Date[]}>} empGoals
 * @param {object} pacing  goalsPacing_ output
 * @returns {{ compliant, rule, total, completed, inProgress, qualifying, pct, note }}
 */
function goalsVerdict_(empGoals, pacing) {
  const ids   = empGoals ? Array.from(empGoals.keys()) : [];
  const total = ids.length;
  const completed  = ids.filter(id => empGoals.get(id).status === "Completed").length;
  const inProgress = ids.filter(id => empGoals.get(id).status === "In Progress").length;
  const qualifying = ids.filter(id => {
    const g   = empGoals.get(id);
    const cnt = g.selfComments.filter(d => d <= pacing.evalEnd).length;
    return g.status === "Completed" ? cnt >= 1 : cnt >= pacing.reqCmt;
  }).length;
  const pct = total > 0 ? Math.round((qualifying / total) * 100) : null;
  const base = { total, completed, inProgress, qualifying, pct };
  if (total === 0) {
    return pacing.goalsRequired === 0
      ? { ...base, compliant: true,  rule: null, note: `Writing ramp (week ${pacing.qWeek}) — no goals yet` }
      : { ...base, compliant: false, rule: 1,    note: "No Goals" };
  }
  if (total < pacing.goalsRequired) {
    return { ...base, compliant: false, rule: 1, note: `Rule 1: ${total}/${pacing.minCount} goals` };
  }
  const needed = Math.ceil(total * pacing.inProgressPct);
  if (inProgress < needed) {
    return { ...base, compliant: false, rule: 2, note: `Rule 2: ${inProgress}/${total} in progress (need ${needed})` };
  }
  if (qualifying < pacing.activeCount) {
    return { ...base, compliant: false, rule: 3, note: `Rule 3: ${qualifying}/${pacing.activeCount} goals paced (≥${pacing.reqCmt} self-comments)` };
  }
  return { ...base, compliant: true, rule: null, note: `Compliant — ${qualifying}/${total} goals paced (≥${pacing.reqCmt})` };
}

// Labels that depend on the run's data/date, read by the header and banner
// writers. Set once per run by setRunLabels_; defaults keep stand-alone calls safe.
var RUN_LABELS_ = { ytd: "YTD RCR", goals: "Goal Engage (%)", goalsQuarter: "", goalsNote: "" };

function setRunLabels_(axis, fc) {
  RUN_LABELS_.ytd          = ytdLabelFor_(axis);
  RUN_LABELS_.goalsQuarter = fc ? fc.reportQuarter : "";
  RUN_LABELS_.goals        = fc ? `Goal Engage % (${fc.reportQuarter})` : "Goal Engage (%)";
  RUN_LABELS_.goalsNote    = fc && fc.inGracePeriod
    ? `Goals: ${fc.reportQuarter} — closed quarter, shown until ${Utilities.formatDate(fc.graceEndDate, Session.getScriptTimeZone(), "MMM d")} (${fc.goalsQuarter} opens then)`
    : fc ? `Goals: ${fc.reportQuarter} (quarter to date)` : "";
}

/**
 * Team RCR for a group of employees in the latest month, by the dashboard's
 * method (readRCR_PS_): mean of the direct rates when the latest month comes
 * from New RCR; SUM(RC)/SUM(TCC) over the group's Employee IDs when it comes
 * from 3. RCR (mean of individual values as the documented fallback).
 * The population is the dashboard's: FTE, tracking-mandated, not ramping up,
 * not on long leave — see joinDashboardFlags_ — and only people who have a
 * value for the month.
 * @param {object[]} emps
 * @param {{ latest }} axis
 * @returns {{ value: number|null, method: string|null, n: number, month: string|null }}
 */
function groupRcr_(emps, axis) {
  const latest = axis && axis.latest;
  if (!latest) return { value: null, method: null, n: 0, month: null };
  const pool = emps.filter(e => rcrCountsForTeam_(e) && e.rcrCurrent !== null && e.rcrCurrent !== undefined);
  const round2 = v => Math.round(v * 100) / 100;
  if (!pool.length) return { value: null, method: latest.source === "rate" ? "direct-rate" : "sum-ratio", n: 0, month: latest.name };
  if (latest.source === "rate") {
    const mean = pool.reduce((a, e) => a + e.rcrCurrent, 0) / pool.length;
    return { value: round2(mean), method: "direct-rate", n: pool.length, month: latest.name };
  }
  let sumRC = 0, sumTCC = 0;
  pool.forEach(e => { sumRC += e.rcLatest || 0; sumTCC += e.tccLatest || 0; });
  if (sumRC > 0 && sumTCC > 0) {
    return { value: round2(sumRC / sumTCC), method: "sum-ratio", n: pool.length, month: latest.name };
  }
  const mean = pool.reduce((a, e) => a + e.rcrCurrent, 0) / pool.length;
  return { value: round2(mean), method: "mean-fallback", n: pool.length, month: latest.name };
}

/** The dashboard's RCR population test for one employee record. */
function rcrCountsForTeam_(e) {
  return !e.isCrewMember && e.tracksTime !== false && !e.isRampUp && !e.onLeave;
}

/** Short human label for a groupRcr_ method. */
function rcrMethodLabel_(method) {
  return method === "direct-rate"   ? "direct rate — mean of tracking-mandated rocketeers (New RCR tab)"
       : method === "sum-ratio"     ? "SUM(Revenue Contribution) / SUM(TCC A+B) over the group (3. RCR tabs)"
       : method === "mean-fallback" ? "mean of individual 3. RCR values (RC/TCC unavailable)"
       : "—";
}

/**
 * Computes a plain-text trend label from the full monthly series.
 * @param {{ month: string, value: number }[]} points
 * @returns {string}
 */
function computeTrend_(points) {
  if (points.length < 2) return "Insufficient Data";
  const vals = points.map(p => p.value);

  const n = CONFIG.SUSTAINED_LOW_MONTHS;
  if (vals.length >= n && vals.slice(-n).every(v => v <= CONFIG.RCR_CRITICAL)) {
    return "Sustained Low";
  }

  const last  = vals[vals.length - 1];
  const prev  = vals.length >= 3 ? vals[vals.length - 3] : vals[0];
  const delta = last - prev;

  if (Math.abs(delta) < 0.15) return last <= CONFIG.RCR_CRITICAL ? "Flat – Low" : "Stable";
  if (delta < 0) return last <= CONFIG.RCR_WATCH ? "Declining" : "Downward";
  return "Improving";
}

/**
 * Classifies an RCR value into a tier with styling metadata.
 * @param {number|null} rcr
 * @param {string} jobLevel
 * @param {boolean} [isNonContributor]  true for Roster-only employees not in RCR
 * @returns {{ tier, badge, tint, fg, note }}
 */
function classifyRCR_(rcr, jobLevel, isNonContributor) {
  const lvl  = String(jobLevel || "").toUpperCase();
  const note = CONFIG.JOB_LEVEL_CONTEXT[lvl] || "";

  if (isNonContributor) {
    return { tier: "Non-Contributor", badge: "Non-Contributor", tint: EXEC.NONCONTRIB_TINT, fg: EXEC.FG_NONCONTRIB, note };
  }
  if (rcr === null || rcr === undefined) {
    return { tier: "No Data",  badge: "No Data",  tint: EXEC.NODATA_TINT,   fg: EXEC.FG_NODATA,   note };
  }
  if (rcr <= CONFIG.RCR_CRITICAL) {
    return { tier: "Critical", badge: "Critical", tint: EXEC.CRITICAL_TINT, fg: EXEC.FG_CRITICAL, note };
  }
  if (rcr <= CONFIG.RCR_WATCH) {
    return { tier: "Watch",    badge: "Watch",    tint: EXEC.WATCH_TINT,    fg: EXEC.FG_WATCH,    note };
  }
  if (rcr <= CONFIG.RCR_HEALTHY) {
    return { tier: "Healthy",  badge: "Healthy",  tint: EXEC.HEALTHY_TINT,  fg: EXEC.FG_HEALTHY,  note };
  }
  return     { tier: "Champion", badge: "Champion", tint: EXEC.CHAMPION_TINT, fg: EXEC.FG_CHAMPION, note };
}

/**
 * Classifies a Non-Contributor based on Goal Engagement % into Critical/Watch/Healthy/Champion.
 * Highlights early tenure (<= 4 months) as 'Onboarding' context.
 * @param {object} emp
 * @returns {object} { tier, badge, tint, fg, note }
 */
function classifyNonContributor_(emp) {
  const eng = emp.goalEngagementPct;
  const isContractor = getJobCluster_(emp) === "5. Contractors";
  const onboardingLimit = isContractor ? 0.083 : 0.34; // 1 month vs 4 months
  const isNewHire = emp.tenure !== null && emp.tenure <= onboardingLimit;
  const onboardingSuffix = isNewHire ? " (Onboarding)" : "";
  
  if (eng === null || eng === undefined) {
    return { 
      tier: isNewHire ? "Onboarding" : "No Data", 
      badge: isNewHire ? "Onboarding" : "No Data", 
      tint: EXEC.NODATA_TINT, 
      fg: EXEC.FG_NODATA, 
      note: "No goal engagement data available" 
    };
  }

  if (eng >= 80) {
    return { tier: "Champion", badge: "Champion" + onboardingSuffix, tint: EXEC.CHAMPION_TINT, fg: EXEC.FG_CHAMPION, note: "Exceptional goal engagement" };
  }
  if (eng >= 60) {
    return { tier: "Healthy", badge: "Healthy" + onboardingSuffix, tint: EXEC.HEALTHY_TINT, fg: EXEC.FG_HEALTHY, note: "Meeting goal engagement targets" };
  }
  if (eng >= 40) {
    return { tier: "Watch", badge: "Watch" + onboardingSuffix, tint: EXEC.WATCH_TINT, fg: EXEC.FG_WATCH, note: "Goal engagement requires active tracking" };
  }
  
  // Critical
  return { 
    tier: "Critical", 
    badge: "Critical" + onboardingSuffix, 
    tint: EXEC.CRITICAL_TINT, 
    fg: EXEC.FG_CRITICAL, 
    note: isNewHire ? "Onboarding phase: low engagement expected, but needs monitoring." : "High risk of disengagement." 
  };
}

/**
 * Formats a number to 2 decimal places. Returns "—" for null.
 * @param {number|null} v
 * @returns {string}
 */
function fmt_(v) {
  return (v === null || v === undefined) ? "—" : Number(v).toFixed(2);
}

/**
 * Returns a per-cell font color for a trend string.
 * @param {string} trend
 * @returns {string}
 */
function trendColor_(trend) {
  if (!trend) return EXEC.TC_GREY;
  const t = trend.toLowerCase();
  if (t.includes("sustained") || t.includes("flat")) return EXEC.TC_RED;
  if (t.includes("declin") || t.includes("downward")) return EXEC.TC_AMBER;
  if (t.includes("improv") || t.includes("stable"))  return EXEC.TC_GREEN;
  return EXEC.TC_GREY;
}

// ============================================================
// ── SECTION: DASHBOARD MIGRATED LOGIC ───────────────────────
// ============================================================

/**
 * Parse Job Family from Job Title using the XX. prefix system.
 * Migrated from Dashboard Logic (Full HC Analysis.js).
 * @param {string} jobTitle
 * @returns {string}
 */
function parseJobFamily_(jobTitle) {
  if (!jobTitle) return "Unknown";
  const m = String(jobTitle).trim().match(/^(\d{2})\./);
  if (!m) return "Unknown";
  const num = parseInt(m[1], 10);
  
  const familyTitles = {
    '1': 'Marketing', '2': 'eCommerce', '3': 'Analytics', '4': 'Sales and Success',
    '5': 'Partner Success', '6': 'Customer Success', '7': 'Managed Services & Support',
    '8': 'Training & Customer Education', '9': 'Service Delivery', '10': 'Product',
    '11': 'Engineering', '12': 'Design', '13': 'Finance', '14': 'Legal & Compliance',
    '15': 'Operations', '16': 'Human Resources', '17': 'IT & Security', '18': 'Solution Architecture'
  };
  
  return familyTitles[String(num)] || "JF" + String(num).padStart(3, "0");
}

/**
 * Extracts the level code from a structured job title prefix (e.g. "16.I4.1 - …" → "I4").
 * Returns "" if the title does not follow the XX.YY.Z pattern.
 * @param {string} jobTitle
 * @returns {string}
 */
function parseJobLevel_(jobTitle) {
  if (!jobTitle) return "";
  const m = String(jobTitle).trim().match(/^\d+\.([A-Za-z]\d+)\./);
  return m ? m[1].toUpperCase() : "";
}

/**
 * Maps a Job Family to a high-level Dashboard Category.
 * Migrated from Dashboard Logic (Employee Impact.js).
 * @param {string} jobFamily
 * @returns {string}
 */
function getCategoryFromFamily_(jobFamily) {
  let category = "Other";
  for (const [catName, families] of Object.entries(CONFIG.DASHBOARD_GROUPS)) {
    if (families.includes(jobFamily)) {
      category = catName;
      break;
    }
  }
  return category;
}

// ============================================================
// ── SECTION: JIRA HELPERS ────────────────────────────────────
// ============================================================

/** Stores Jira API Token in Script Properties. 
function setAPI__Jira() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('setAPI__Jira');
  else Logger.log('⚠️ [setAPI__Jira] requireMaintainer_ not in this project — running ungated.');
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt("Jira API Setup", "Please paste your Jira API Token:", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() === ui.Button.OK) {
    const token = response.getResponseText();
    const props = PropertiesService.getScriptProperties();
    props.setProperty("API__Jira", token);
    props.setProperty("ADMIN_AC", "035X");
    ui.alert("✅ Jira API token saved.");
  }
}*/

/** Retrieves Jira API Token. */
function getAPI__Jira() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('getAPI__Jira');
  else Logger.log('⚠️ [getAPI__Jira] requireMaintainer_ not in this project — running ungated.');
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("ADMIN_AC") !== "035X")
    throw new Error("❌ Access not permitted. Run setAPI__Jira() first.");
  const key = props.getProperty("API__Jira");
  if (!key) throw new Error("❌ Jira API token not found. Run setAPI__Jira() first.");
  return key;
}

/** Builds Jira REST API Request Headers. */
function buildJiraHeaders_() {
  const token = getAPI__Jira();
  return {
    "Authorization": "Basic " + Utilities.base64Encode(CONFIG.JIRA.EMAIL + ":" + token),
    "Accept":        "application/json",
    "Content-Type":  "application/json",
  };
}

/** Utility to safely access nested object properties. */
function dig_(obj, path) {
  return path.split(".").reduce((o, k) => (o && o[k] != null) ? o[k] : null, obj);
}

/**
 * Robustly normalizes names for matching (lowercase, trim, collapse spaces).
 * @param {string} name
 * @returns {string}
 */
function normalizeName_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, ' ').trim();
}

// ── NAME NORMALIZATION CACHE (Roster as source of truth) ───────────
// Format: Canonical Roster Name -> Source Name Alias
// Add mappings here when logs show unmatched source names.
const NAME_MAPS = {
  JIRA: {
    "Adrien Shung Shien Low" : "Adrien Low",
    "Angel Qianyi Guo" : "Angel Guo",
    "Andrew Er Wern Sern" : "Andrew Wern Sern",
    "Teck En Yew" : "Teck-En Yew",
    "Mary Lea Columna" : "Lea Columna",
    "Dean D Espera" : "Dean Espera",
    "Wey Khoon Lew" : "Kevin Lew",
    "Brian M Estavilla" : "Brian Estavilla",
    "Hoang Long Nguyen" : "Long Nguyen",
    "Samuel Gatica" : "Sam Gatica",
    "Scott Wai Chee Tan" : "Scott Tan",
    "K Hashvin Katheresan" : "Hashvin Katheresan",
    "Michelle Bagu" : "Michelle Bagu",
    "Rachael A Huston" : "Rachael Huston",
    "Thierno Abdoul Rahimi Diallo" : "Rahimi Diallo",
    "Vicknesh A/L Shanmugam" : "Vicknesh Shanmugam",
    "Steven Monroney" : "Steve Monroney",
    "Gareth M Weiss" : "Gareth Weiss",
    "Moyosola O Bello" : "Yosola Bello",
    "Yuen Chi Lian" : "YC Lian",
    "William G Cushard" : "Bill Cushard",
    "Marcela Hermansen" : "Marge Hermansen",
    "Imran Mohamed Sultan Ariff" : "Imran Mohamed Sultan Ariff",
    "Kai Xian Teng" : "Amen Teng",
    "Tze Siong Chong" : "TS Chong",
    "Kelvin Chua Foo Long" : "Kelvin Chua Foo Long",
    "Hacel Adriano" : "Hacel Adriano",
    "Azwandi Aris" : "Azwandi Aris",
    "Muhammad Azhari bin Abdul Jalil" : "Azhari bin Abdul Jalil",
    "Lisa Li" : "Lisa Li",
    "Abdul Hakim b Nizamuddin" : "Akim Nizamuddin",
    "Dean Nazmuddin" : "Dean Nazmuddin",
    "Darshanaa Soma Sundram" : "Darshanaa Soma Sundram",
    "Andrew Vo-Nguyen" : "Andrew Vo-Nguyen",
    "Pak Wai Choong" : "Pak Wai Choong",
    "Chester Ashton John" : "Chester Ashton John",
    "Koh Ping Ng" : "KP Ng",
    "Shu Shan Teoh" : "Joyce Teoh",
    "Choon Kean Quah" : "Andy Quah",
    "Ronald Sheng Wei Lim" : "Ronald Lim",
    "Seyed Iman Hashemi Rastegar" : "Iman Hashemi Hashemi Rastegar",
    "Syed Afiq Al-Attas Syed Khaidzir" : "Afiq Syed Khaidzir",
    "Christopher Taylor" : "Paul Taylor",
    "Christopher R Kron" : "Chris Kron",
    "Hilman Aizat Bin Zuhdi" : "Hilman Zuhdi",
    "Pravindran AL Mahendran" : "Pravin Mahendran",
    "Fatin Aliah Mohd Razib" : "Aliah Mohd Razib",
    "Mohd Ikram Hafiz Abdul Hamid" : "Ikram Abdul Hamid",
    "Se Wha Chong" : "Abby Chong",
    "Hugo Navia" : "Hugo Navia",
  },
  BACKLOG: {
    "Yuen Chi Lian": "YC Lian",
  },
  BILLABLE: {},
  UTILIZATION: {},
  GOALS: {},
};

const _NAME_CACHE = (function () {
  const cache = {};
  Object.values(NAME_MAPS).forEach(section => {
    Object.entries(section).forEach(([rosterName, sourceName]) => {
      const rosterKey = normalizeName_(rosterName);
      if (!rosterKey) return;
      cache[rosterKey] = rosterName;
      if (sourceName) cache[normalizeName_(sourceName)] = rosterName;
    });
  });
  return cache;
})();

function normalizeToRoster_(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  return _NAME_CACHE[normalizeName_(trimmed)] || trimmed;
}

function normalizeToRosterKey_(name) {
  return normalizeName_(normalizeToRoster_(name));
}

/**
 * Loads and counts Jira tickets from the 'Jira Raw' sheet per assignee per week.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks
 * @returns {Map<string, number[]>} normalized_assignee -> [wk1_count, wk2_count, wk3_count]
 */
function getJiraCountsFromRaw_(ss, weeks) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_JIRA_RAW);
  if (!sheet) {
    Logger.log("⚠️ Jira Raw sheet '" + CONFIG.SHEET_JIRA_RAW + "' not found. Falling back to pivot.");
    return getJiraWeeklyReportData_(ss); 
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return new Map();

  const map = new Map();
  // RAW_HEADERS indices: Key=1, Assignee=5, Updated=10, ResolutionDate=11
  data.slice(1).forEach(row => {
    const name = normalizeToRosterKey_(row[5]);
    if (!name || name === "unassigned") return;
    
    // Check both resolution and updated dates to match tracker logic
    const resDate = parseDate_(row[11]);
    const updDate = parseDate_(row[10]);

    // A ticket with neither date is skipped
    if (!resDate && !updDate) return;

    if (!map.has(name)) map.set(name, weekZeros_());
    const counts = map.get(name);

    weeks.forEach((week, i) => {
      // Count the ticket for a week if EITHER date falls within it
      const resHit = resDate && isInWeek_(resDate, week.start, week.end);
      const updHit = updDate && isInWeek_(updDate, week.start, week.end);
      if (resHit || updHit) {
        counts[i]++;
      }
    });
  });

  Logger.log("✅ Jira counts calculated from Raw for " + map.size + " unique assignees.");
  return map;
}

/**
 * Loads the weekly Jira report data from the 'Weekly Report' sheet (Fallback).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {Map<string, number[]>} assignee -> [wk1_count, wk2_count, wk3_count]
 */
function getJiraWeeklyReportData_(ss) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_JIRA_REPORT);
  if (!sheet) return new Map();

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return new Map();

  const map = new Map();
  data.slice(1).forEach(row => {
    const name = normalizeToRosterKey_(row[0]);
    if (!name || name === "total") return;
    
    // Pivot holds the last 3 weeks only (Wk-2, Wk-1, LW) — right-align into the window.
    const counts = weekZeros_();
    const pivot = [row[1], row[2], row[3]].map(v => parseFloat(v) || 0);
    pivot.forEach((v, i) => { counts[counts.length - pivot.length + i] = v; });
    map.set(name, counts);
  });
  return map;
}

/** A zero-filled array, one slot per week of the CONFIG.WEEKS_WINDOW window. */
function weekZeros_() {
  return new Array(CONFIG.WEEKS_WINDOW).fill(0);
}

/**
 * One column header per week, oldest first (or newest first with `newestFirst`).
 * Fallback labels when a week is missing: "Wk-(n-1)" … "Wk-1", "LW".
 */
function weekHeaders_(weeks, prefix, suffix, newestFirst) {
  const n = CONFIG.WEEKS_WINDOW;
  const cols = [];
  for (let i = 0; i < n; i++) {
    const back = n - 1 - i;
    const label = weeks[i] ? weeks[i].label : (back === 0 ? "LW" : "Wk-" + back);
    cols.push(prefix + label + suffix);
  }
  return newestFirst ? cols.reverse() : cols;
}

function toIsoDate_(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/**
 * Returns the start (Monday) and end (Sunday) of the last N fully completed weeks.
 * @param {number} n
 * @returns {{ start: Date, end: Date, label: string }[]}
 */
function getLastNCompletedWeeks_(n) {
  const weeks = [];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysSinceSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  
  for (let i = 0; i < n; i++) {
    const lastSunday = new Date(today);
    lastSunday.setDate(today.getDate() - daysSinceSunday - (i * 7));
    lastSunday.setHours(23, 59, 59, 0);
    const lastMonday = new Date(lastSunday);
    lastMonday.setDate(lastSunday.getDate() - 6);
    lastMonday.setHours(0, 0, 0, 0);
    const label = getWeekLabel_(lastMonday);
    weeks.unshift({ start: lastMonday, end: lastSunday, label: label });
  }
  return weeks;
}

/**
 * Returns shorthand week label like "W15"
 */
function getWeekLabel_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return 'W' + weekNum;
}

/** Formats a Date as "Mar 23, 2026". */
function formatDateLabel_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "MMM d, yyyy");
}

/** Parses a date string or Date object. */
function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return new Date(parseInt(match[3], 10), parseInt(match[1], 10) - 1, parseInt(match[2], 10));
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/** Converts duration to decimal hours. */
function durationToHours_(rawDuration) {
  if (rawDuration === null || rawDuration === undefined || rawDuration === "") return 0;
  if (rawDuration instanceof Date) {
    return rawDuration.getHours() + rawDuration.getMinutes() / 60 + rawDuration.getSeconds() / 3600;
  }
  const num = parseFloat(rawDuration);
  if (isNaN(num)) return 0;
  return num < 1 ? num * 24 : num;
}

/** Parses text "TRUE"/"FALSE" to boolean. */
function parseBoolean_(value) {
  if (value === true) return true;
  const str = String(value).trim().toLowerCase();
  return str === "true" || str === "yes" || str === "1";
}

/** Checks if a date falls in range. */
function isInWeek_(date, startDate, endDate) {
  if (!date) return false;
  const d = date.getTime();
  return d >= startDate.getTime() && d <= endDate.getTime();
}

/**
 * Loads and aggregates billable data for the given weeks.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks
 * @returns {Map<string, object>} employeeKey -> { billable: number, total: number }[]
 */
function getWeeklyBillableData_(ss, weeks) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_BILLABLE);
  if (!sheet) return new Map();

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return new Map();
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const map = new Map();

  values.forEach(row => {
    const name = String(row[CONFIG.B_COLS.ENTITY_ID] || "").trim();
    if (!name) return;
    const key = normalizeToRosterKey_(name);
    const date = parseDate_(row[CONFIG.B_COLS.DATE]);
    const type = String(row[CONFIG.B_COLS.PROJECT_TYPE] || "").trim();
    const jobTitle = String(row[CONFIG.B_COLS.JOB_TITLE] || "").trim();

    // Check project type inclusion
    if (CONFIG.INCLUDE_PROJECT_TYPES.length > 0) {
      if (!CONFIG.INCLUDE_PROJECT_TYPES.some(t => t.toLowerCase() === type.toLowerCase())) return;
    }

    const matchedWeekIdx = weeks.findIndex(w => isInWeek_(date, w.start, w.end));
    if (matchedWeekIdx < 0) return;

    if (!map.has(key)) {
      map.set(key, {
        hours: weeks.map(() => ({ billable: 0, total: 0 })),
        jobTitle: jobTitle
      });
    }
    
    const empData = map.get(key).hours;
    const duration = durationToHours_(row[CONFIG.B_COLS.DURATION]);
    const isBillable = parseBoolean_(row[CONFIG.B_COLS.BILLABLE]);

    if (isBillable) empData[matchedWeekIdx].billable += duration;
    empData[matchedWeekIdx].total += duration;
  });

  return map;
}

/**
 * Weekly Tempo tracked hours per roster member — the same source and parser the
 * PS Contribution Report uses (readTrackedTimeByWeek_ over "Tempo Tracked Time").
 * Those week columns are keyed "YYYY.WN", so each window is relabelled by ISO year/week.
 * @param {string[]} names  — display names of the people to look up
 * @param {object[]} weeks  — output of getLastNCompletedWeeks_(CONFIG.WEEKS_WINDOW)
 * @returns {Map<string, number[]>} normalised name → hours [oldest..LW]
 */
function getTempoTrackedHrs_(names, weeks) {
  const map = new Map();
  const psNames = new Map();
  names.forEach(name => { if (name) psNames.set(normPS_(name), name); });
  if (!psNames.size) return map;

  const psWeeks = weeks.map(w => ({ label: isoWeekYear_PS_(w.start) + ".W" + isoWeekNum_PS_(w.start) }));
  const tracked = readTrackedTimeByWeek_(psNames, psWeeks);

  psWeeks.forEach((w, i) => {
    const byEmp = (tracked[w.label] || {}).byEmployee || {};
    Object.keys(byEmp).forEach(norm => {
      if (!map.has(norm)) map.set(norm, weekZeros_());
      map.get(norm)[i] = byEmp[norm];
    });
  });

  Logger.log("Tempo tracked hours loaded for " + map.size + " rocketeers (" + psWeeks.map(w => w.label).join(", ") + ")");
  return map;
}

/**
 * Loads and aggregates cost basis data for the last 2 weeks.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks
 * @returns {Map<string, object>} employeeKey -> { cost: number, hours: number }
 */
function getWeeklyCostData_(ss, weeks) {
  const sheet = ss.getSheetByName(CONFIG.SHEET_COST_BASIS);
  if (!sheet) {
    Logger.log("⚠️ Cost Basis sheet not found.");
    return new Map();
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return new Map();

  // We only care about the last 2 completed weeks
  const l2Weeks = weeks.slice(-2);
  const map = new Map();

  data.slice(1).forEach(row => {
    const name = String(row[CONFIG.C_COLS.EMPLOYEE] || "").trim();
    if (!name) return;
    const key = normalizeToRosterKey_(name);
    const date = parseDate_(row[CONFIG.C_COLS.DATE]);
    
    // Check if date falls in any of the last 2 weeks
    const isInWindow = l2Weeks.some(w => isInWeek_(date, w.start, w.end));
    if (!isInWindow) return;

    if (!map.has(key)) map.set(key, { cost: 0, hours: 0 });
    const stats = map.get(key);
    
    stats.hours += parseFloat(row[CONFIG.C_COLS.DURATION]) || 0;
    stats.cost  += parseFloat(row[CONFIG.C_COLS.COST]) || 0;
  });

  return map;
}

// ── Sheet-writing primitives ───────────────────────────────

/**
 * Merges and styles a section heading row.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row   1-based
 * @param {string} text
 * @param {number} span  column span
 * @param {string} bg
 * @param {string} [fg]
 * @param {number} [fs]  font size
 */
function writeSection_(sh, row, text, span, bg, fg, fs) {
  const r = sh.getRange(row, 1, 1, span);
  r.merge()
   .setValue(text)
   .setBackground(bg)
   .setFontColor(fg || EXEC.SECTION_FG)
   .setFontWeight("bold")
   .setFontSize(fs || 10)
   .setFontFamily("Arial")
   .setVerticalAlignment("middle")
   .setHorizontalAlignment("left");
  sh.setRowHeight(row, 26);
}

/**
 * Writes a dark column-header row.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {string[]} cols
 */
function writeColHeaders_(sh, row, cols) {
  const r = sh.getRange(row, 1, 1, cols.length);
  r.setValues([cols])
   .setBackground(EXEC.COL_HDR_BG)
   .setFontColor(EXEC.COL_HDR_FG)
   .setFontWeight("bold")
   .setFontSize(8)
   .setFontFamily("Arial")
   .setWrap(true)
   .setVerticalAlignment("middle");
  sh.setRowHeight(row, 30);
}

/**
 * Writes a data block with alternating rows. Optionally colors individual cells.
 * The "tier badge" column (col index tierCol, 0-based) receives a cell tint.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} startRow
 * @param {any[][]} data
 * @param {string[][]} [fontColors]  same shape — null cells inherit TEXT_DARK
 * @param {{ tint, fg }[]} [tierInfos]  per-row tier info for badge cell tinting
 * @param {number} [tierCol]         0-based column index of the tier badge
 */
function writeData_(sh, startRow, data, fontColors, tierInfos, tierCol) {
  if (!data.length) return;
  const nCols = data[0].length;
  const range = sh.getRange(startRow, 1, data.length, nCols);

  range.setValues(data)
       .setFontSize(9)
       .setFontFamily("Arial")
       .setVerticalAlignment("middle")
       .setWrap(false)
       .setFontColor(EXEC.TEXT_DARK)
       .setBorder(false, false, false, false, false, true,
                  EXEC.ROW_EVEN, SpreadsheetApp.BorderStyle.DOTTED);

  data.forEach((_, i) => {
    sh.getRange(startRow + i, 1, 1, nCols)
      .setBackground(i % 2 === 0 ? EXEC.ROW_ODD : EXEC.ROW_EVEN);
    sh.setRowHeight(startRow + i, 20);
  });

  // Per-cell font colors
  if (fontColors) {
    fontColors.forEach((rowC, i) => {
      rowC.forEach((c, j) => {
        if (c) sh.getRange(startRow + i, j + 1).setFontColor(c);
      });
    });
  }

  // Tier badge cell: apply tint + bold + correct fg
  if (tierInfos && tierCol !== undefined) {
    tierInfos.forEach((info, i) => {
      if (!info) return;
      sh.getRange(startRow + i, tierCol + 1)
        .setBackground(info.tint)
        .setFontColor(info.fg)
        .setFontWeight("bold");
    });
  }
}

/** Returns row + 2 (blank spacer gap between sections). */
function spacer_(row) { return row + 2; }

// ============================================================
// ── SECTION: CORE LOGIC ──────────────────────────────────────
// ============================================================

/**
 * The last N populated months of the merged RCR axis (both tabs), oldest → newest.
 * Kept as a named step so the run log still says which window was used.
 * @param {object} axis  readRcrAxis_() result
 * @returns {string[]}  up to CONFIG.TREND_MONTHS month names
 */
function detectLastClosedMonths_(axis) {
  return axis && axis.lastMonths ? axis.lastMonths.slice() : [];
}

/**
 * Builds the enriched employee record map.
 * SI tab is the headcount base; RCR and Goals are joined by employee name.
 * @param {object} siData
 * @param {object} rcrData
 * @param {object} rdGoalsData  — loaded from external Goals RD tab via loadGoalsRD_()
 * @param {object} rcData
 * @param {object} tccData
 * @param {object} axis  readRcrAxis_() result — merged 3. RCR + New RCR month axis
 * @param {object} rosterData  Roster sheet data for Job Title lookup
 * @param {Set<string>} exclusivitySet  normalized names from ExclusivityContracts
 * @param {Set<string>} deliveryMgrSet  normalized names from Delivery Managers
 * @param {Map<string, number>} kudosMap  recipient normalized key → kudos count in window
 * @param {object[]} weeks  — the CONFIG.WEEKS_WINDOW completed week windows used for bucketing
 * @returns {Map<string, object>}
 */
function buildEmployeeMap_(siData, rcrData, rdGoalsData, rcData, tccData, jiraReportMap, axis, rosterData, exclusivitySet, deliveryMgrSet, kudosMap, weeks, contractorData) {
  Logger.log("Entering buildEmployeeMap_");
  try {
    if (!axis) {
      Logger.log("   → WARNING: RCR axis is undefined, using an empty axis");
      axis = { months: [], latest: null, lastMonths: [], byId: new Map() };
    }
    const employees = new Map();
    const safeLastMonths = axis.lastMonths || [];
    // Latest-month RC / TCC are only meaningful while the latest month is a
    // legacy ratio month — New RCR months have nothing to sum.
    const latestRatioMonth = axis.latest && axis.latest.source === "ratio" ? axis.latest.name : null;
    Logger.log("lastMonths count: " + safeLastMonths.length);

    // ── Aggregate/summary IDs to exclude from all seeding steps ─────
    const _excludedIds = new Set(CONFIG.EXCLUDED_INTERNAL_IDS.map(x => String(x).trim().toLowerCase()));

    // ── Build Roster name/empNum → internalId lookup maps ────────────
    const rosterNameToId = new Map();   // normalized name → internalId
    const rosterEmpNumToId = new Map(); // employee number → internalId
    if (rosterData && rosterData.rows && rosterData.headers) {
      rosterData.rows.forEach(row => {
        const name       = strVal_(row, rosterData.headers, "Name");
        const internalId = strVal_(row, rosterData.headers, "Internal ID");
        const empNum     = strVal_(row, rosterData.headers, "Employee Number");
        if (name && internalId) {
          rosterNameToId.set(normalizeName_(name), internalId);
        }
        if (empNum && internalId) {
          rosterEmpNumToId.set(empNum, internalId);
        }
      });
      Logger.log(`Roster maps built: Name→ID (${rosterNameToId.size}), EmpNum→ID (${rosterEmpNumToId.size})`);
    }

    // ── 1. Seed from Roster (authoritative headcount) ────────
    if (rosterData && rosterData.rows && rosterData.headers) {
      Logger.log("Seeding from Roster...");
      rosterData.rows.forEach(row => {
        const internalId = strVal_(row, rosterData.headers, "Internal ID");
        if (!internalId) return;
        if (_excludedIds.has(String(internalId).trim().toLowerCase())) return;

        const rosterName     = strVal_(row, rosterData.headers, "Name");
        const rosterEmpNum   = strVal_(row, rosterData.headers, "Employee Number");
        const rosterDept     = strVal_(row, rosterData.headers, "Department");
        const rosterTitle    = strVal_(row, rosterData.headers, "Job Title");
        const rosterCategory = strVal_(row, rosterData.headers, "Job Profile Category");
        const rosterClass    = strVal_(row, rosterData.headers, "Class");
        const rosterLevel    = strVal_(row, rosterData.headers, "Level");
        const rosterSupervisor = strVal_(row, rosterData.headers, "Supervisor");
        const rosterRegion   = strVal_(row, rosterData.headers, "Key Location");
        const rosterStatus   = strVal_(row, rosterData.headers, "Employee Status");

        const hireDateRaw = row[colIdx_CR_(rosterData.headers, "Hire Date")];
        const hireDate    = hireDateRaw ? parseDate_(hireDateRaw) : null;
        const rosterTenure = hireDate
          ? parseFloat(((new Date() - hireDate) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1))
          : null;

        if (!employees.has(internalId)) {
          employees.set(internalId, blankEmployee_(internalId));
        }
        const emp = employees.get(internalId);
        emp.name        = rosterName;
        emp.internalId  = internalId;
        emp.empNumber   = rosterEmpNum;
        emp.dept        = rosterDept;
        emp.jobTitle    = emp.jobTitle    || rosterTitle;
        emp.jobCategory = emp.jobCategory || rosterCategory;
        emp.empClass    = emp.empClass    || rosterClass;
        emp.jobLevel    = emp.jobLevel    || rosterLevel;

        // Contributor Type: "Exclusive Customer Support", "Delivery Manager", or "—"
        if (rosterName) {
          const normalizedRosterName = normalizeName_(rosterName);
          if (exclusivitySet && exclusivitySet.has(normalizedRosterName)) {
            emp.contributorType = "Exclusive Customer Support";
          } else if (deliveryMgrSet && deliveryMgrSet.has(normalizedRosterName)) {
            emp.contributorType = "Delivery Manager";
          } else {
            emp.contributorType = "—";
          }
        }

        // Enrich Job Category/Family using Dashboard Logic if roster is generic
        const derivedFamily = parseJobFamily_(rosterTitle);
        const dashboardCat  = getCategoryFromFamily_(derivedFamily);
        emp.jobCategory = (rosterCategory === "Other" || !rosterCategory) ? dashboardCat : rosterCategory;

        emp.supervisor  = emp.supervisor  || rosterSupervisor;
        emp.region      = emp.region      || rosterRegion;
        emp.empStatus   = emp.empStatus   || rosterStatus;
        if (emp.tenure === null) emp.tenure = rosterTenure;

        // Mark as Non-Contributor until RCR data is joined
        // Services Delivery Utilization employees are always contributors
        if (!emp.ytdRCR && emp.monthlyRCR.length === 0 && emp.jobCategory !== "Services Delivery Utilization") {
          emp.tierInfo = classifyRCR_(null, emp.jobLevel, true);
        }
      });

      // Log Contributor Type match stats
      if (exclusivitySet && exclusivitySet.size > 0) {
        const matched = Array.from(employees.values()).filter(e => e.contributorType === "Exclusive Customer Support").length;
        Logger.log(`Contributor Type: ${matched} of ${employees.size} employees matched as "Exclusive Customer Support" (ExclusivityContracts has ${exclusivitySet.size} names)`);
      }
    }

    // ── 1b. Seed active crew members from Contractors Data ────
    if (contractorData && contractorData.rows && contractorData.headers) {
      Logger.log("Seeding crew members from Contractors Data...");
      const CREW_INACTIVE_RE = /terminat|resign|left|inactive|former|offboard/i;
      contractorData.rows.forEach(row => {
        const internalId = strVal_(row, contractorData.headers, "Internal ID");
        if (!internalId) return;
        if (_excludedIds.has(String(internalId).trim().toLowerCase())) return;

        const status   = strVal_(row, contractorData.headers, "Employee Status");
        const termDate = strVal_(row, contractorData.headers, "Termination/Release Date");

        // Exclude Terminated status (explicit check + broader regex) and any released row
        if (String(status).trim() === "Terminated" || CREW_INACTIVE_RE.test(status) || termDate) return;

        if (!employees.has(internalId)) {
          employees.set(internalId, blankEmployee_(internalId));
        }
        const emp = employees.get(internalId);

        const name       = strVal_(row, contractorData.headers, "Name");
        const supervisor = strVal_(row, contractorData.headers, "Supervisor");
        const empClass   = strVal_(row, contractorData.headers, "Class");
        const jobTitle   = strVal_(row, contractorData.headers, "Job Title");
        const dept       = strVal_(row, contractorData.headers, "Department");
        const hireDateRaw = row[colIdx_CR_(contractorData.headers, "Hire Date")];
        const hireDate   = hireDateRaw ? parseDate_(hireDateRaw) : null;
        const tenure     = hireDate
          ? parseFloat(((new Date() - hireDate) / (365.25 * 24 * 60 * 60 * 1000)).toFixed(1))
          : null;

        emp.name        = emp.name       || name;
        emp.empStatus   = emp.empStatus  || status;
        emp.supervisor  = emp.supervisor || supervisor;
        emp.empClass    = emp.empClass   || empClass;
        emp.jobTitle    = emp.jobTitle   || jobTitle;
        emp.dept        = emp.dept       || dept;
        emp.jobLevel    = emp.jobLevel   || "CONTRACTOR";
        if (emp.tenure === null) emp.tenure = tenure;
        emp.isCrewMember = true;

        // Register in the name→id lookup so later joins (Jira, Kudos, etc.) can match
        if (name) rosterNameToId.set(normalizeName_(name), internalId);
      });
      const crewCount = Array.from(employees.values()).filter(e => e.isCrewMember).length;
      Logger.log(`Crew members seeded (active): ${crewCount}`);
    }

    // ── 2. Enrich from RC (Revenue Contribution) ─────────────
    if (rcData && rcData.rows && rcData.headers) {
      Logger.log("Enriching from RC...");
      rcData.rows.forEach(row => {
        const empId = strVal_(row, rcData.headers, "Employee ID");
        if (!empId) return;
        if (!employees.has(empId)) employees.set(empId, blankEmployee_(empId));
        const emp = employees.get(empId);
        emp.ytdRevenue  = numVal_(row, rcData.headers, CONFIG.COL_YTD) || emp.ytdRevenue;
        if (latestRatioMonth) emp.rcLatest = numVal_(row, rcData.headers, latestRatioMonth) || 0;
        if (!emp.empStatus)   emp.empStatus   = strVal_(row, rcData.headers, "Employee Status") || strVal_(row, rcData.headers, "Status");
        if (!emp.jobCategory) emp.jobCategory = strVal_(row, rcData.headers, "Job Category");
        if (!emp.empClass)    emp.empClass    = strVal_(row, rcData.headers, "Employee Class");
        if (!emp.jobLevel)    emp.jobLevel    = strVal_(row, rcData.headers, "Job Level");
        if (!emp.supervisor)  emp.supervisor  = strVal_(row, rcData.headers, "Supervisor");
        if (!emp.region)      emp.region      = strVal_(row, rcData.headers, "Resource Region");
        if (emp.tenure === null) emp.tenure   = numVal_(row, rcData.headers, "Tenure (years)");
      });
    }

    // ── 3. Enrich from TCC (Total Compensation Cost) ─────────
    if (tccData && tccData.rows && tccData.headers) {
      Logger.log("Enriching from TCC...");
      tccData.rows.forEach(row => {
        const empId = strVal_(row, tccData.headers, "Employee ID");
        if (!empId) return;
        if (!employees.has(empId)) employees.set(empId, blankEmployee_(empId));
        const emp = employees.get(empId);
        emp.ytdTCC = numVal_(row, tccData.headers, CONFIG.COL_YTD) || emp.ytdTCC;
        if (latestRatioMonth) emp.tccLatest = numVal_(row, tccData.headers, latestRatioMonth) || 0;
        if (!emp.empStatus)   emp.empStatus   = strVal_(row, tccData.headers, "Employee Status") || strVal_(row, tccData.headers, "Status");
        if (!emp.jobCategory) emp.jobCategory = strVal_(row, tccData.headers, "Job Category");
        if (!emp.empClass)    emp.empClass    = strVal_(row, tccData.headers, "Employee Class");
        if (!emp.jobLevel)    emp.jobLevel    = strVal_(row, tccData.headers, "Job Level");
        if (!emp.supervisor)  emp.supervisor  = strVal_(row, tccData.headers, "Supervisor");
        if (!emp.region)      emp.region      = strVal_(row, tccData.headers, "Resource Region");
        if (emp.tenure === null) emp.tenure   = numVal_(row, tccData.headers, "Tenure (years)");
      });
    }

    // ── 4. Enrich from RCR ────────────────────────────────────
    if (rcrData && rcrData.rows && rcrData.headers) {
      Logger.log("Enriching from RCR...");
      rcrData.rows.forEach(row => {
        // Skip terminated employees — any row with a Termination Date is excluded
        const terminationDate = strVal_(row, rcrData.headers, "Termination Date");
        if (terminationDate) return;

        const empId = strVal_(row, rcrData.headers, "Employee ID");
        if (!empId) return;
        if (!employees.has(empId)) employees.set(empId, blankEmployee_(empId));
        const emp = employees.get(empId);

        if (!emp.empStatus)   emp.empStatus   = strVal_(row, rcrData.headers, "Employee Status") || strVal_(row, rcrData.headers, "Status");
        if (!emp.jobCategory) emp.jobCategory = strVal_(row, rcrData.headers, "Job Category");
        if (!emp.empClass)    emp.empClass    = strVal_(row, rcrData.headers, "Employee Class");
        if (!emp.jobLevel)    emp.jobLevel    = strVal_(row, rcrData.headers, "Job Level");
        if (!emp.supervisor)  emp.supervisor  = strVal_(row, rcrData.headers, "Supervisor");
        if (!emp.region)      emp.region      = strVal_(row, rcrData.headers, "Resource Region");
        if (emp.tenure === null) emp.tenure   = numVal_(row, rcrData.headers, "Tenure (years)");

        // The tab's own YTD column (FY26 SUM/SUM). Step 4b replaces it with the
        // FY of the latest axis month when that FY is a New RCR (rate) year.
        emp.ytdRCR = numVal_(row, rcrData.headers, CONFIG.COL_YTD);
      });
    }

    // ── 4b. Apply the merged RCR axis (3. RCR + New RCR) to every record ────
    // One series per person across both tabs; the latest populated month on the
    // axis is the dashboard's number for them and decides tier + sort order.
    // Someone with history but no value for the latest month reads "No Data" —
    // exactly as the dashboard's byEmployee map does.
    {
      let withSeries = 0, withCurrent = 0;
      const latestName = axis.latest ? axis.latest.name : null;
      employees.forEach(emp => {
        const series = rcrSeriesFor_(axis, emp.internalId || emp.key);
        if (!series.length) return;
        withSeries++;
        emp.monthlyRCR    = series;
        emp.ytdRCR        = ytdRcrFor_(series, axis, emp.ytdRCR);   // FY of the latest month
        emp.lastMonthsRCR = safeLastMonths.map(m => {
          const pt = series.find(p => p.month === m);
          return { month: m, value: pt ? pt.value : null, source: pt ? pt.source : null };
        });
        const cur = latestName ? series.find(p => p.month === latestName) : null;
        emp.rcrCurrent      = cur ? cur.value : null;
        emp.rcrCurrentMonth = cur ? cur.month : null;
        emp.rcrSource       = cur ? cur.source : null;
        if (cur) withCurrent++;
        emp.trend    = computeTrend_(series);
        emp.tierInfo = classifyRCR_(emp.rcrCurrent, emp.jobLevel, false);
      });
      Logger.log(`RCR axis applied: ${withSeries} records with a series, ${withCurrent} with a value for ${latestName || "—"}`);
    }

    // ── 5. Join SI data (via Employee Number) ─────────────
    if (siData && siData.rows && siData.headers) {
      Logger.log("Joining SI data...");
      siData.rows.forEach(row => {
        const empNum = strVal_(row, siData.headers, "Employee Number");
        if (!empNum) return;
        const internalId = rosterEmpNumToId.get(empNum);
        if (!internalId) return;
        const emp = employees.get(internalId);
        if (!emp) return;

        // The last four completed quarters, derived (FY27Q1 is newest in Oct 2026).
        const qCols = fiscalContextCR_().siQuarters.map(q => "Small Improvements Manager Rating " + q);
        const siScores = qCols.map(q => numVal_(row, siData.headers, q));
        const validSI  = siScores.filter(s => s !== null);
        const latestSI = validSI.length ? validSI[validSI.length - 1] : null;
        const avgSI    = validSI.length ? validSI.reduce((a, b) => a + b, 0) / validSI.length : null;

        let siTrend = "—";
        if (validSI.length >= 2) {
          const d = validSI[validSI.length - 1] - validSI[validSI.length - 2];
          siTrend = d > 0 ? "Rising" : d < 0 ? "Falling" : "Stable";
        } else if (validSI.length === 1) {
          siTrend = "Single Score";
        }

        emp.siScores = siScores;
        emp.validSI  = validSI;
        emp.latestSI = latestSI;
        emp.avgSI    = avgSI;
        emp.siTrend  = siTrend;
      });
    }

    // ── 6. Join Goals data from external RD sheet ────────────
    // RD columns: rocketeer, goal id, goal status, comment date, commentator, fiscal quarter
    if (rdGoalsData && rdGoalsData.rows && rdGoalsData.rows.length > 0) {
      Logger.log("Joining Goals data from RD sheet...");
      const hdrsLC       = rdGoalsData.headers.map(x => String(x).trim().toLowerCase());
      const iRocketeer   = colIdx_CR_(hdrsLC, "rocketeer");
      const iGoalId      = colIdx_CR_(hdrsLC, "goal id");
      const iStatus      = colIdx_CR_(hdrsLC, "goal status");
      const iCommentDate = colIdx_CR_(hdrsLC, "comment date");
      const iCommentator = colIdx_CR_(hdrsLC, "commentator");
      const iQuarter     = colIdx_CR_(hdrsLC, "fiscal quarter");

      Logger.log(`RD Goals columns → rocketeer:${iRocketeer} goalId:${iGoalId} status:${iStatus} commentDate:${iCommentDate} commentator:${iCommentator} quarter:${iQuarter}`);

      if (iRocketeer === -1 || iGoalId === -1) {
        Logger.log(`⚠️ RD Goals: required columns missing. Headers: ${rdGoalsData.headers.join(", ")}`);
      } else {
        // Quarter and pacing as the dashboard computes them: the current fiscal
        // quarter, or the one that just closed while inside the grace window, judged
        // at the end of the last completed week (capped at the quarter's end).
        const fc     = fiscalContextCR_();
        const pacing = goalsPacing_(fc, weeks && weeks.length ? weeks[weeks.length - 1].end : null);
        Logger.log(`Goals: quarter ${fc.reportQuarter}${fc.inGracePeriod ? " (closed — grace window)" : ""}, week ${pacing.qWeek}, reqCmt ${pacing.reqCmt}, goals required ${pacing.goalsRequired}`);

        // Build per-person goal map: normName → Map<goalId, { status, selfComments: Date[] }>
        const goalMap = new Map();
        rdGoalsData.rows.forEach(row => {
          const rocketeer = String(row[iRocketeer] || "").trim();
          if (!rocketeer) return;
          // Filter to the evaluated fiscal quarter only
          if (iQuarter !== -1 && String(row[iQuarter] || "").trim() !== fc.reportQuarter) return;

          const norm        = normalizeToRosterKey_(rocketeer);
          const rNorm       = normalizeName_(rocketeer);
          const goalId      = String(row[iGoalId] || "").trim();
          const status      = iStatus      !== -1 ? String(row[iStatus]      || "").trim() : "";
          const commentor   = iCommentator !== -1 ? normalizeName_(String(row[iCommentator] || "").trim()) : "";
          const commentDate = iCommentDate !== -1 ? parseDate_(row[iCommentDate]) : null;

          if (!goalMap.has(norm)) goalMap.set(norm, { rNorm, goals: new Map() });
          const empEntry = goalMap.get(norm);
          const empGoals = empEntry.goals;

          if (goalId) {
            if (!empGoals.has(goalId)) empGoals.set(goalId, { status: "", selfComments: [] });
            const g = empGoals.get(goalId);
            const PRIO = { "In Progress": 3, "Planned": 2, "Completed": 1 };
            if ((PRIO[status] || 0) > (PRIO[g.status] || 0)) g.status = status;
            // Only count self-comments (rocketeer commented on their own goal)
            if (commentDate && commentor && commentor === rNorm) {
              g.selfComments.push(commentDate);
            }
          }
        });

        Logger.log(`Goals: built map for ${goalMap.size} rocketeers`);

        goalMap.forEach(({ rNorm, goals: empGoals }, personNorm) => {
          const internalId = rosterNameToId.get(personNorm);
          if (!internalId) return;
          const emp = employees.get(internalId);
          if (!emp) return;

          const goalIds   = Array.from(empGoals.keys());
          const verdict   = goalsVerdict_(empGoals, pacing);
          const total     = verdict.total;
          const completed = verdict.completed;
          const inProg    = verdict.inProgress;
          const pct       = verdict.pct;

          // Count self-comments per week window by bucketing stored dates
          const weekComments = weekZeros_();
          if (weeks) {
            goalIds.forEach(id => {
              empGoals.get(id).selfComments.forEach(d => {
                weeks.forEach((w, i) => { if (isInWeek_(d, w.start, w.end)) weekComments[i]++; });
              });
            });
          }

          emp.goalsTotal          = total;
          emp.goalsCompleted      = completed;
          emp.goalsInProgress     = inProg;
          emp.goalEngagementPct   = pct;
          emp.goalMonthlyComments = weekComments;
          emp.goalAvgCommentsPerWeek = total > 0
            ? (weekComments.reduce((a, b) => a + b, 0) / weekComments.length).toFixed(1)
            : "0";

          emp.goalsCompliant = verdict.compliant;
          emp.goalsRule      = verdict.rule;
          emp.goalsNote      = verdict.note;

          const c = weekComments, lw = c[c.length - 1], pw = c[c.length - 2];
          emp.goalActivityTrend = lw > pw ? "Rising"
                                : lw < pw ? "Declining"
                                : c.every(x => x === 0) ? "No Activity"
                                : "Stable";
        });
        Logger.log(`Goals join complete for ${goalMap.size} rocketeers`);
      }
    }

    // ── 8. Join Jira data (via Roster name→id map) ───────────
    if (jiraReportMap) {
      let jMatched = 0, jUnmatched = 0;
      Logger.log("Joining Jira data...");
      jiraReportMap.forEach((counts, nameKey) => {
        const internalId = rosterNameToId.get(nameKey);
        if (!internalId) { jUnmatched++; Logger.log("  ⚠ Jira unmatched: '" + nameKey + "'"); return; }
        jMatched++;
        const emp = employees.get(internalId);
        if (!emp) return;
        emp.jiraEpicCounts = counts;
      });
      Logger.log("Jira join: " + jMatched + " matched, " + jUnmatched + " unmatched");
    }

    // ── 9. Join Kudos data ────────────────────────────────────
    if (kudosMap) {
      let kMatched = 0, kUnmatched = 0;
      Logger.log("Joining Kudos data...");
      kudosMap.forEach((count, nameKey) => {
        const internalId = rosterNameToId.get(nameKey);
        if (!internalId) { kUnmatched++; return; }
        kMatched++;
        const emp = employees.get(internalId);
        if (!emp) return;
        emp.kudosL3W = count;
      });
      Logger.log("Kudos join: " + kMatched + " matched, " + kUnmatched + " unmatched");
    }

    // ── Remove records with no internalId or a known aggregate ID ───
    const _finalExcluded = new Set(CONFIG.EXCLUDED_INTERNAL_IDS.map(x => String(x).trim().toLowerCase()));
    employees.forEach((emp, key) => {
      if (!emp.internalId) { employees.delete(key); return; }
      if (_finalExcluded.has(String(emp.internalId).trim().toLowerCase())) employees.delete(key);
    });

    // ── Derive job level from structured title prefix (XX.YY.Z - …) ─
    // Overwrites any prior value when the title carries an explicit code.
    employees.forEach(emp => {
      const parsed = parseJobLevel_(emp.jobTitle);
      if (parsed) emp.jobLevel = parsed;
    });

    Logger.log("Employee map built: " + employees.size + " records");
    return employees;
  } catch (err) {
    Logger.log("ERROR in buildEmployeeMap_: " + err.message);
    throw err;
  }
}

/**
 * Classifies an employee into a performance cluster based on job title and level.
 * @param {object} emp
 * @returns {string}
 */
function getJobCluster_(emp) {
  const title = (emp.jobTitle || "").toLowerCase();
  const level = (emp.jobLevel || "").toUpperCase();

  // 1. Contractors (Strictly billable)
  if (level === "CONTRACTOR" || title.includes("crew member") || title.includes("contractor")) {
    return "5. Contractors";
  }
  // 2. Management / Leadership (Enablement)
  if (level.startsWith("M") || title.includes("manager") || title.includes("director")) {
    return "1. Management / Leadership";
  }
  // 3. Project Management (Margin protectors)
  if (title.includes("project management")) {
    return "4. Project Management";
  }
  // 4. Engineering & Support (Primary RCR Engine)
  if (title.includes("engineer") || title.includes("architecture") || title.includes("support engineer")) {
    return "2. Engineering & Support (IC)";
  }
  // 5. Consulting (Hybrid Delivery/Strategy)
  if (title.includes("consultant") || title.includes("consulting")) {
    return "3. Consulting (IC)";
  }
  // 6. Support ICs (Customer Support, Application Support, etc.)
  if (title.includes("support")) {
    return "2. Engineering & Support (IC)";
  }
  // 7. Interns / Early Career
  if (title.includes("intern")) {
    return "2. Engineering & Support (IC)";
  }
  // 8. Service Delivery / Delivery ICs without explicit role keyword
  if (title.includes("delivery") || title.includes("service")) {
    return "3. Consulting (IC)";
  }
  // 9. Principal / Senior individual contributors
  if (title.includes("principal") || title.includes("senior")) {
    return "3. Consulting (IC)";
  }
  return "6. Other / Uncategorized";
}

/**
 * Generates a concise, scan-friendly signal string.
 * @param {object} emp
 * @returns {string}
 */
function buildSignal_(emp) {
  const signals = [];
  const rcr = emp.rcrCurrent;   // latest closed month — the dashboard's number
  const si  = emp.latestSI;
  const eng = emp.goalEngagementPct;
  const lvl = String(emp.jobLevel || "").toUpperCase();
  const lwHrs  = emp.lastWeekTotalHrs;   // Tempo tracked, last completed week

  const cluster = getJobCluster_(emp);

  // ── G&A / Non-Contributor Specific Signals ──────────────
  if (emp.isInternalGA) {
    if (eng !== null && eng < 40) signals.push(`CRITICAL: Low goal engagement (${eng}%)`);
    if (si !== null && si <= 2)   signals.push(`SI Score: ${CONFIG.SI_LABELS[si] || si}`);
    if (emp.goalAvgCommentsPerWeek !== null && emp.goalAvgCommentsPerWeek < 0.5) {
      signals.push(`Low goal activity: ${emp.goalAvgCommentsPerWeek} avg comments/wk`);
    }
    if (emp.goalActivityTrend === "Declining") signals.push("Declining goal engagement trend");
    const th = emp.weeklyTrackedHrs || weekZeros_();
    if (th.every(h => h <= 0)) signals.push(`⚠ No time tracked in Tempo (L${th.length}W)`);
    return signals.length ? signals.join("  ·  ") : "Consistent G&A engagement";
  }

  // ── Indirect / Strategy Roles (Management & PM) ──────────
  if (cluster.includes("Management") || cluster.includes("Project Management")) {
    signals.push(`${cluster.split(". ")[1]} Profile — RCR secondary to enablement`);
    if (rcr !== null && rcr > 2.0) signals.push("Strong revenue contribution for leadership role");
    return signals.join("  ·  ");
  }

  // ── Contractor Specifics ─────────────────────────────────
  if (cluster.includes("Contractors")) {
    if (lwHrs !== null && lwHrs > 0 && lwHrs < 30) signals.push(`Low weekly hours for contractor: ${lwHrs.toFixed(1)}`);
    return signals.length ? signals.join("  ·  ") : "Contractor performing within range";
  }

  // ── IC Core Engine (Engineering & Consulting) ────────────
  const isBlackAndWhite = (rcr === null || rcr <= 0) && (lwHrs === null || lwHrs <= 0);
  const isGreyZone      = (rcr !== null && rcr <= CONFIG.RCR_CRITICAL) && (lwHrs >= 35);

  if (isBlackAndWhite) {
    signals.push("BLACK & WHITE: Zero RCR + Zero Weekly Hours — Missing/No Output");
  } else if (isGreyZone) {
    signals.push(`GREY ZONE: Low RCR (${fmt_(rcr)}) despite high activity (${lwHrs.toFixed(1)} hrs) — Triangulation required`);
  }

  // ── RCR & Trajectory ─────────────────────────────────────
  if (!isBlackAndWhite && rcr !== null && rcr <= CONFIG.RCR_CRITICAL) signals.push("Not covering own cost (YTD)");
  if (emp.trend === "Sustained Low")               signals.push("3+ months sustained below 1.0");
  if (emp.trend === "Declining")                   signals.push("Declining recent trajectory");

  // ── Activity & Engagement ────────────────────────────────
  if (!isBlackAndWhite && lwHrs !== null && lwHrs > 0) {
    if (lwHrs < 30) signals.push(`Low weekly activity: ${lwHrs.toFixed(1)} hrs`);
  }

  // ── Tempo Time Tracking ──────────────────────────────────
  const th = emp.weeklyTrackedHrs || weekZeros_();
  const zeroWeeks = th.filter(h => h <= 0).length;
  if (zeroWeeks === th.length) {
    signals.push(`⚠ No time tracked in Tempo (L${th.length}W)`);
  } else if (zeroWeeks >= th.length - 1) {
    signals.push("Low Tempo time tracking (" + (th.length - zeroWeeks) + "/" + th.length + " weeks)");
  }

  if (eng !== null && eng < 40 && rcr !== null && rcr <= CONFIG.RCR_WATCH) {
    signals.push("Low goal engagement — disengagement risk");
  }

  // ── Team / Satellite Risks ──────────────────────────────
  if (emp.criticalSatelliteCount > 0) {
    signals.push(`TEAM RISK: ${emp.criticalSatelliteCount} Critical Satellite(s) (Low RCR/Engage/Hrs)`);
  }

  return signals.length ? signals.join("  ·  ") : "No material signal";
}

/**
 * Builds a grouped dimension summary, sorted by avg RCR ascending.
 * @param {object[]} empList
 * @param {string} field  "contributorType" | "supervisor" | "region"
 * @returns {object[]}
 */
function buildDimensionSummary_(empList, field, axis) {
  return buildGroupSummary_(empList, emp => emp[field] || "(Unassigned)", axis)
    .sort((a, b) => (a.avgRCR ?? 999) - (b.avgRCR ?? 999));
}

/**
 * Shared group roll-up for the dimension and job-cluster summaries.
 * Tier counts use each person's LATEST-month RCR (the dashboard's number);
 * the group RCR is groupRcr_ — the dashboard's team method for that month.
 * @param {object[]} empList
 * @param {function(object): string} keyOf
 * @param {object} axis  readRcrAxis_() result
 * @returns {object[]} unsorted
 */
function buildGroupSummary_(empList, keyOf, axis) {
  const groups = new Map();
  empList.forEach(emp => {
    const key = keyOf(emp);
    if (!groups.has(key)) {
      groups.set(key, { label: key, count: 0, members: [],
                        critical: 0, watch: 0, healthy: 0, champion: 0,
                        sumGoal: 0, cntGoal: 0, sumSI: 0, cntSI: 0 });
    }
    const g = groups.get(key);
    g.count++;
    g.members.push(emp);

    const v = emp.rcrCurrent;
    if (v !== null && v !== undefined) {
      if      (v <= CONFIG.RCR_CRITICAL) g.critical++;
      else if (v <= CONFIG.RCR_WATCH)    g.watch++;
      else if (v <= CONFIG.RCR_HEALTHY)  g.healthy++;
      else                               g.champion++;
    }
    if (emp.goalEngagementPct !== null) { g.sumGoal += emp.goalEngagementPct; g.cntGoal++; }
    if (emp.avgSI !== null)             { g.sumSI   += emp.avgSI;             g.cntSI++;   }
  });
  return Array.from(groups.values()).map(g => {
    const rcr = groupRcr_(g.members, axis);
    const { members, ...rest } = g;
    return {
      ...rest,
      avgRCR:    rcr.value,
      rcrN:      rcr.n,
      rcrMethod: rcr.method,
      avgGoal:   g.cntGoal > 0 ? Math.round(g.sumGoal / g.cntGoal) : null,
      avgSI:     g.cntSI  > 0 ? (g.sumSI  / g.cntSI).toFixed(1)   : "—",
    };
  });
}

// ============================================================
// ── SECTION: OUTPUT WRITING ───────────────────────────────────
// ============================================================

// Total column count for full-width merges (Contributor report)
const TOTAL_COLS = 25;

// Tier badge column index varies per report:
// Contributor:     Layout: Internal ID · Emp Number · Name · Job Title · Level · Contributor Type · Supervisor · Region · Tenure · YTD RCR · Tier ...  → index 10
// Non-Contributor: Layout: Internal ID · Emp Number · Name · Department · Job Title · Level · Contributor Type · Supervisor · Region · Tenure · Tier ...  → index 10
// Crew:            Layout: Internal ID · Name · Department · Job Title · Level · Contributor Type · Supervisor · Region · Tenure · YTD RCR · Tier ...  → index 10
const TIER_COL_IDX = 10;  // 0-based (Contributor default)

/**
 * Prepares (or clears) the output sheet and sets column widths.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @param {number[]} widths
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function prepareOutputSheet_(ss, sheetName, widths) {
  let sh = ss.getSheetByName(sheetName);
  if (sh) { sh.clearContents(); sh.clearFormats(); }
  else    { sh = ss.insertSheet(sheetName); }

  // Ensure the sheet has enough columns before setting widths
  const currentCols = sh.getMaxColumns();
  if (widths.length > currentCols) {
    sh.insertColumnsAfter(currentCols, widths.length - currentCols);
  }

  widths.forEach((w, i) => sh.setColumnWidth(i + 1, w));
  return sh;
}

/**
 * Writes the title and subtitle banner rows.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {string[]} lastMonths
 * @returns {number} next row
 */
function writeBanner_(sh, row, lastMonths, isNonContrib, totalCols, ctx) {
  const ts           = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM dd, yyyy  HH:mm");
  const windowLabel  = (lastMonths && lastMonths.length) ? lastMonths.join("  ·  ") : "—";
  const cols         = totalCols || sh.getLastColumn() || TOTAL_COLS;
  ctx = ctx || {};

  const base  = isNonContrib ? "NON-CONTRIBUTOR INTELLIGENCE ENGINE" : "CONTRIBUTOR INTELLIGENCE ENGINE";
  const title = ctx.orgLeader ? `${base}  —  ${ctx.orgLeader.toUpperCase()} ORG` : base;

  sh.getRange(row, 1, 1, cols)
    .merge()
    .setValue(`${title}     |     ServiceRocket`)
    .setBackground(EXEC.BANNER_BG)
    .setFontColor(EXEC.BANNER_TEXT)
    .setFontWeight("bold")
    .setFontSize(13)
    .setFontFamily("Arial")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sh.setRowHeight(row, 38);
  row++;

  let subText = isNonContrib
    ? `Generated: ${ts}     ·     Focus: Goal Engagement & Development Engagement` + (RUN_LABELS_.goalsNote ? `     ·     ${RUN_LABELS_.goalsNote}` : "")
    : `Generated: ${ts}     ·     Trend window: ${windowLabel} + ${RUN_LABELS_.ytd}` +
      `     ·     ${tierLegend_()}` + (RUN_LABELS_.goalsNote ? `     ·     ${RUN_LABELS_.goalsNote}` : "");

  const legend = isNonContrib
    ? `     ·     Logged Time: Tempo tracked hrs per week     Avg Comments/Wk: Goal activity intensity     *Goal Engage: goals paced with self-comments / total (dashboard rules 1–3)`
    : `     ·     RCR: Revenue/Cost — FY26 from "3. RCR", FY27 on from "New RCR" (direct rate)     Logged Time: Tempo tracked hrs per week     *Goal Engage: goals paced with self-comments / total (dashboard rules 1–3)     Note: Critical w/ Short Tenure (FTE <= 4mo, Contractor <= 1mo) = High Onboarding Risk`;

  subText += legend;

  const subBar = (text) => {
    sh.getRange(row, 1, 1, cols)
      .merge()
      .setValue(text)
      .setBackground(EXEC.SUBBAR_BG)
      .setFontColor(EXEC.SUBBAR_TEXT)
      .setFontSize(8)
      .setFontFamily("Arial")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
    sh.setRowHeight(row, 20);
    row++;
  };
  subBar(subText);

  // Org-scoped run: say whose tree this is, who is in it, and that the leader's
  // own row is deliberately absent — a reader should never wonder if it was lost.
  // The group RCR line is the dashboard's team number for this org.
  if (ctx.orgLeader) {
    const n   = ctx.orgSize !== undefined ? `${ctx.orgSize} rocketeer${ctx.orgSize === 1 ? "" : "s"} (managers and ICs under ${ctx.orgLeader})` : "org tree";
    const rcr = ctx.rcr && ctx.rcr.value !== null && ctx.rcr.value !== undefined
      ? `${rcrColLabel_({ latest: { name: ctx.rcr.month } })}: ${ctx.rcr.value.toFixed(2)}  —  ${rcrMethodLabel_(ctx.rcr.method)}, n = ${ctx.rcr.n}`
      : `RCR: no value for this org in the latest month`;
    subBar(`Org scope: ${n}     ·     ${ctx.orgLeader}'s own record is excluded from this report     ·     ${rcr}`);
  }
  return row;
}

/**
 * Converts an employee array to formatted table rows, font-color arrays, and tier info.
 * @param {object[]} emps
 * @param {string[]} lastMonths  the 3 month labels
 * @returns {{ rows, fontColors, tierInfos }}
 */
function empsToRows_(emps, lastMonths) {
  const rows = [], fontColors = [], tierInfos = [];
  emps.forEach(emp => {
    // Monthly values — last 3 only
    const m = lastMonths.map(mo => {
      const pt = emp.lastMonthsRCR.find(p => p.month === mo);
      return (pt && pt.value !== null) ? Number(pt.value).toFixed(2) : "—";
    });
    while (m.length < 3) m.push("—");

    // Performance Status (SI label)
    const perfStatus = emp.latestSI !== null ? CONFIG.SI_LABELS[emp.latestSI] || "—" : "—";
    
    // SI Score — show the sequence of the last 4 completed quarters
    const siScore = (emp.siScores && emp.siScores.length > 0)
      ? emp.siScores.map(s => s !== null ? s : "—").join(" | ")
      : "—";

    const ch = emp.weeklyTrackedHrs || weekZeros_();  // Logged Time = Tempo tracked

    const wc = emp.goalMonthlyComments || weekZeros_();

    rows.push([
      emp.internalId  || "—",                                              // 0
      emp.empNumber   || "—",                                              // 1
      emp.name        || "—",                                              // 2
      emp.jobTitle    || "—",                                              // 3
      emp.jobLevel    || "—",                                              // 4
      emp.contributorType || "—",                                          // 5
      emp.supervisor  || "—",                                              // 6
      emp.region      || "—",                                              // 7
      emp.tenure !== null ? Number(emp.tenure).toFixed(1) : "—",          // 8
      fmt_(emp.ytdRCR),                                                    // 9  legacy FY YTD (3. RCR)
      m[0], m[1], m[2],                                                    // 10-12 trend window, newest last
      emp.tierInfo ? emp.tierInfo.badge : "—",                             // 13 tier on the latest month
      emp.goalEngagementPct !== null ? `${emp.goalEngagementPct}%` : "—", // 14
      ...wc,                                                               // comments, oldest → LW
      emp.kudosL3W || 0,                                                   // Kudos
      siScore,                                                             // SI Score
      ...ch.map(h => h > 0 ? h.toFixed(1) : "0"),                         // logged time, oldest → LW
      ...(emp.jiraEpicCounts || weekZeros_()).slice().reverse().map(c => c || 0), // Jira, LW → oldest
    ]);

    // Colour the LATEST month — that is the dashboard's number and the tier basis.
    const rcrFg = rcrFontColor_(emp.rcrCurrent);

    fontColors.push([
      null, null, null,                          // 0-2: ID, EmpNum, Name
      null, null, null, null, null, null,        // 3-8: JobTitle-Tenure
      null,                                      // 9: legacy YTD RCR
      null, null, rcrFg,                         // 10-12: M-2, M-1, latest RCR
      null,                                      // 13: Tier (tinted by writeData_)
      null,                                      // 14: Goal Engage
      ...wc.map(() => null),                     // comments
      null,                                      // Kudos
      null,                                      // SI Score
      ...ch.map(h => h <= 0 ? EXEC.TC_RED : null), // logged time
      ...weekZeros_().map(() => null),          // Jira
    ]);

    tierInfos.push(emp.tierInfo);
  });
  return { rows, fontColors, tierInfos };
}

/** Font colour for an RCR value by tier (Critical / Watch only; Healthy+ stay dark). */
function rcrFontColor_(v) {
  if (v === null || v === undefined) return null;
  if (v <= CONFIG.RCR_CRITICAL) return EXEC.FG_CRITICAL;
  if (v <= CONFIG.RCR_WATCH)    return EXEC.FG_WATCH;
  return null;
}

/** Column label for the latest-month RCR of a group ("RCR (Sep 26)"). */
function rcrColLabel_(axis) {
  return axis && axis.latest ? `RCR (${axis.latest.name})` : "RCR (latest)";
}

/** Tier legend for banners — derived from CONFIG so a threshold change shows up. */
function tierLegend_() {
  const c = CONFIG.RCR_CRITICAL, w = CONFIG.RCR_WATCH, h = CONFIG.RCR_HEALTHY;
  return `Tiers (latest month):  ≤ ${c.toFixed(1)}  Critical    ${(c + 0.01).toFixed(2)}–${w.toFixed(1)}  Watch    ${(w + 0.01).toFixed(2)}–${h.toFixed(1)}  Healthy    > ${h.toFixed(1)}  Champion`;
}

/**
 * Writes the summary overview table in a professional card-based layout.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object} counts
 * @param {string} sectionTitle
 * @returns {number} next row
 */
function writeSummaryOverview_(sh, row, counts, sectionTitle) {
  const totalCols = sh.getLastColumn() || 20;
  // Group Header Row
  sh.getRange(row, 1, 1, totalCols).merge()
    .setValue("  " + sectionTitle)
    .setBackground(EXEC.SUBBAR_BG)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(9)
    .setVerticalAlignment("middle");
  sh.setRowHeight(row, 24);
  row++;

  const colSpan = 4; // 5 cards × 4 columns = 20 columns
  const summaries = [
    { title: "CRITICAL CONTRIBUTORS", desc: "RCR ≤ 1.0 (Not covering cost)", count: counts.critical, color: "#B91C1C", bg: "#FEF2F2" },
    { title: "WATCH ZONE", desc: "RCR 1.01–2.0 (Active Tracking)", count: counts.watch, color: "#C2410C", bg: "#FFF7ED" },
    { title: "TOP CONTRIBUTORS", desc: `RCR > 3.0 (Top ${CONFIG.TOP_N} by YTD)`, count: counts.champion, color: "#1E40AF", bg: "#EFF6FF" },
    { title: "NO RCR DATA", desc: "Present on headcount base", count: counts.noData, color: "#475569", bg: "#F8FAFC" },
    { title: "NON-CONTRIBUTOR", desc: "Roster only — not in RCR group", count: counts.nonContrib, color: "#6B21A8", bg: "#F3F0FF" }
  ];

  summaries.forEach((s, i) => {
    const startCol = 1 + (i * colSpan);
    
    // Card container (Background and side borders)
    sh.getRange(row, startCol, 3, colSpan).setBackground(s.bg)
      .setBorder(true, true, true, true, null, null, s.color, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    // Title Row
    sh.getRange(row, startCol, 1, colSpan).merge()
      .setValue(s.title)
      .setFontColor(s.color)
      .setFontWeight("bold")
      .setFontSize(8)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("bottom");

    // Large Count Row
    sh.getRange(row + 1, startCol, 1, colSpan).merge()
      .setValue(`${s.count} Employees`)
      .setFontColor(s.color)
      .setFontWeight("bold")
      .setFontSize(16)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");

    // Description Row
    sh.getRange(row + 2, startCol, 1, colSpan).merge()
      .setValue(s.desc)
      .setFontColor(s.color)
      .setFontSize(7)
      .setFontWeight("normal")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("top");
  });

  // Set row heights for the cards
  sh.setRowHeight(row, 22);
  sh.setRowHeight(row + 1, 42);
  sh.setRowHeight(row + 2, 22);
  
  return row + 4;
}

/**
 * Writes the main contributor table with all employees.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object[]} emps
 * @param {string[]} lastMonths
 * @param {object[]} weeks
 * @returns {number} next row
 */
function writeMainTable_(sh, row, emps, lastMonths, weeks) {
  const dynCols = [
    "Internal ID","Employee Number","Name","Job Title","Level","Contributor Type","Supervisor","Region","Tenure",
    RUN_LABELS_.ytd,
    (lastMonths[0] || "M−2") + " RCR", (lastMonths[1] || "M−1") + " RCR", (lastMonths[2] || "Latest") + " RCR",
    "RCR Tier",
    RUN_LABELS_.goals,
    ...weekHeaders_(weeks, "", " Comments"),
    "Kudos",
    "SI Score",
    ...weekHeaders_(weeks, "Logged Time ", ""),
    ...weekHeaders_(weeks, "Jira Backlog ", "", true),
  ];

  writeColHeaders_(sh, row, dynCols);
  row++;

  if (emps.length === 0) {
    sh.getRange(row, 1, 1, dynCols.length)
      .merge()
      .setValue("No employees to display.")
      .setFontColor(EXEC.TEXT_MID).setFontSize(9).setFontFamily("Arial")
      .setBackground(EXEC.ROW_ODD).setHorizontalAlignment("left");
    sh.setRowHeight(row, 20);
    return spacer_(row + 1);
  }

  const { rows, fontColors, tierInfos } = empsToRows_(emps, lastMonths);
  writeData_(sh, row, rows, fontColors, tierInfos, MAIN_TIER_COL_IDX);
  return spacer_(row + rows.length);
}

// 0-based index of the "RCR Tier" badge column in the Contributor table
// (Internal ID … Tenure = 0-8, legacy YTD = 9, three trend months = 10-12).
const MAIN_TIER_COL_IDX = 13;

/**
 * Writes the Non-Contributor table with enhanced goal metrics.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object[]} emps
 * @param {object[]} weeks
 * @returns {number} next row
 */
function writeNonContributorTable_(sh, row, emps, weeks) {
  const cols = [
    "Internal ID","Employee Number","Name","Department","Job Title","Level","Contributor Type","Supervisor","Region","Tenure",
    RUN_LABELS_.goals,
    ...weekHeaders_(weeks, "", " Comments"),
    "Avg Comments/Wk", "Kudos",
    "SI Score",
    ...weekHeaders_(weeks, "Logged Time ", ""),
    ...weekHeaders_(weeks, "Jira Backlog ", "", true),
  ];

  writeColHeaders_(sh, row, cols);
  row++;

  if (emps.length === 0) {
    sh.getRange(row, 1, 1, cols.length)
      .merge()
      .setValue("No non-contributors to display.")
      .setFontColor(EXEC.TEXT_MID).setFontSize(9).setFontFamily("Arial")
      .setBackground(EXEC.ROW_ODD).setHorizontalAlignment("left");
    sh.setRowHeight(row, 20);
    return spacer_(row + 1);
  }

  const { rows, fontColors } = nonContribEmpsToRows_(emps);
  writeData_(sh, row, rows, fontColors);
  return spacer_(row + rows.length);
}

/**
 * Formats non-contributor rows.
 * @param {object[]} emps
 * @returns {object} { rows, fontColors, tierInfos }
 */
function nonContribEmpsToRows_(emps) {
  const rows = [], fontColors = [], tierInfos = [];
  emps.forEach(emp => {
    const siScore = (emp.siScores && emp.siScores.length > 0)
      ? emp.siScores.map(s => s !== null ? s : "—").join(" | ")
      : "—";

    const ch = emp.weeklyTrackedHrs || weekZeros_();  // Logged Time = Tempo tracked
    const wc = emp.goalMonthlyComments || weekZeros_();

    rows.push([
      emp.internalId  || "—",                                              // 0
      emp.empNumber   || "—",                                              // 1
      emp.name        || "—",                                              // 2
      emp.dept        || "—",                                              // 3
      emp.jobTitle    || "—",                                              // 4
      emp.jobLevel    || "—",                                              // 5
      emp.contributorType || "—",                                          // 6
      emp.supervisor  || "—",                                              // 7
      emp.region      || "—",                                              // 8
      emp.tenure !== null ? Number(emp.tenure).toFixed(1) : "—",          // 9
      emp.goalEngagementPct !== null ? `${emp.goalEngagementPct}%` : "—", // 10
      ...wc,                                                               // comments, oldest → LW
      emp.goalAvgCommentsPerWeek,                                          // 14
      emp.kudosL3W || 0,                                                   // 15
      siScore,                                                             // 16
      ...ch.map(h => h > 0 ? h.toFixed(1) : "0"),                         // logged time, oldest → LW
      ...(emp.jiraEpicCounts || weekZeros_()).slice().reverse().map(c => c || 0), // Jira, LW → oldest
    ]);

    fontColors.push([
      null, null, null, null, null, null, null, null, null, null, // 0-9
      null,                                      // 10: Goal Engage
      ...wc.map(() => null), null,               // comments + avg
      null,                                      // 15: Kudos
      null,                                      // 16: SI Score
      ...ch.map(h => h <= 0 ? EXEC.TC_RED : null), // logged time
      ...weekZeros_().map(() => null),          // Jira
    ]);

    tierInfos.push(emp.tierInfo);
  });
  return { rows, fontColors, tierInfos };
}

/**
 * Writes the Crew Member table with Goal/SI fields removed.
 */
function writeCrewTable_(sh, row, emps, lastMonths, weeks) {
  const dynCols = [
    "Internal ID","Name","Department","Job Title","Supervisor","Region","Tenure",
    RUN_LABELS_.ytd,
    (lastMonths[0] || "M−2") + " RCR", (lastMonths[1] || "M−1") + " RCR", (lastMonths[2] || "Latest") + " RCR",
    "Kudos",
    ...weekHeaders_(weeks, "Logged Time ", ""),
    ...weekHeaders_(weeks, "Jira Backlog ", "", true),
  ];

  writeColHeaders_(sh, row, dynCols);
  row++;

  if (emps.length === 0) {
    sh.getRange(row, 1, 1, dynCols.length)
      .merge()
      .setValue("No crew members to display.")
      .setFontColor(EXEC.TEXT_MID).setFontSize(9).setFontFamily("Arial")
      .setBackground(EXEC.ROW_ODD).setHorizontalAlignment("left");
    sh.setRowHeight(row, 20);
    return spacer_(row + 1);
  }

  const { rows, fontColors } = crewEmpsToRows_(emps, lastMonths);
  writeData_(sh, row, rows, fontColors);
  return spacer_(row + rows.length);
}

/**
 * Formats crew member rows with Goal/SI fields removed.
 */
function crewEmpsToRows_(emps, lastMonths) {
  const rows = [], fontColors = [], tierInfos = [];
  emps.forEach(emp => {
    const m = lastMonths.map(mo => {
      const pt = emp.lastMonthsRCR.find(p => p.month === mo);
      return (pt && pt.value !== null) ? Number(pt.value).toFixed(2) : "—";
    });
    while (m.length < 3) m.push("—");

    const ch = emp.weeklyTrackedHrs || weekZeros_();  // Logged Time = Tempo tracked

    rows.push([
      emp.internalId  || "—",                                     // 0
      emp.name        || "—",                                     // 1
      emp.dept        || "—",                                     // 2
      emp.jobTitle    || "—",                                     // 3
      emp.supervisor  || "—",                                     // 4
      emp.region      || "—",                                     // 5
      emp.tenure !== null ? Number(emp.tenure).toFixed(1) : "—", // 6
      fmt_(emp.ytdRCR),                                           // 7
      m[0], m[1], m[2],                                           // 8-10
      emp.kudosL3W || 0,                                          // 11
      ...ch.map(h => h > 0 ? h.toFixed(1) : "0"),                         // logged time, oldest → LW
      ...(emp.jiraEpicCounts || weekZeros_()).slice().reverse().map(c => c || 0), // Jira, LW → oldest
    ]);

    const rcrFg = rcrFontColor_(emp.rcrCurrent);   // latest month — the dashboard's number

    fontColors.push([
      null, null, null, null, null, null, null, // 0-6
      null,                                     // 7: legacy YTD RCR
      null, null, rcrFg,                        // 8-10: M-2, M-1, latest RCR
      null,                                     // 11: Kudos
      ...ch.map(h => h <= 0 ? EXEC.TC_RED : null), // logged time
      ...weekZeros_().map(() => null),          // Jira
    ]);

    tierInfos.push(emp.tierInfo);
  });
  return { rows, fontColors, tierInfos };
}

/**
 * Writes the Cost Analysis table.
 */
function writeCostTable_(sh, row, emps, lastMonths, weeks) {
  const cols = [
    "Internal ID","Employee Number","Name","Job Title","Level","Contributor Type","Supervisor","Region","Tenure",
    "Tier",
    "L2W Total Cost (USD)",
    "L2W Total Hrs",
    "Avg Cost/Hr",
    "Signal",
  ];

  writeColHeaders_(sh, row, cols);
  row++;

  if (emps.length === 0) {
    sh.getRange(row, 1, 1, cols.length)
      .merge()
      .setValue("No cost data available for the last 2 weeks.")
      .setFontColor(EXEC.TEXT_MID).setFontSize(9).setFontFamily("Arial")
      .setBackground(EXEC.ROW_ODD).setHorizontalAlignment("left");
    sh.setRowHeight(row, 20);
    return spacer_(row + 1);
  }

  const { rows, fontColors, tierInfos } = costEmpsToRows_(emps);
  writeData_(sh, row, rows, fontColors, tierInfos, 9); // Tier badge column (0-based)
  return spacer_(row + rows.length);
}

/**
 * Formats cost analysis rows.
 */
function costEmpsToRows_(emps) {
  const rows = [], fontColors = [], tierInfos = [];
  emps.forEach(emp => {
    const avgCostHr = emp.l2wTotalHrs > 0 ? (emp.l2wTotalCost / emp.l2wTotalHrs).toFixed(2) : 0;

    rows.push([
      emp.internalId  || "—",
      emp.empNumber   || "—",
      emp.name        || "—",
      emp.jobTitle    || "—",
      emp.jobLevel    || "—",
      emp.contributorType || "—",
      emp.supervisor  || "—",
      emp.region      || "—",
      emp.tenure !== null ? Number(emp.tenure).toFixed(1) : "—",
      emp.tierInfo.badge,
      `$${emp.l2wTotalCost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`,
      emp.l2wTotalHrs.toFixed(1),
      `$${avgCostHr}`,
      buildSignal_(emp),
    ]);

    fontColors.push([
      null, null, null, null, null, null, null, null, null,
      emp.tierInfo.fg,
      EXEC.TC_RED, // Highlight cost
      null,
      null,
      EXEC.TEXT_MID,
    ]);

    tierInfos.push(emp.tierInfo);
  });
  return { rows, fontColors, tierInfos };
}

/**
 * Writes the Job Profile Clustering summary based on the ABC Strategy.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object[]} empList
 * @param {string} label
 * @returns {number} next row
 */
function writeJobClusterSummary_(sh, row, empList, label, axis) {
  const summary = buildGroupSummary_(empList, getJobCluster_, axis)
    .sort((a, b) => a.label.localeCompare(b.label));

  const COLS = [
    "Job Profile Cluster","Headcount", rcrColLabel_(axis),
    "Critical","Watch","Healthy","Champion",
    "Avg Goal Engage","Avg SI Score","ABC Metric Rationale",
  ];

  writeSection_(sh, row, `  ${label}`, COLS.length, EXEC.SECTION_DARK);
  row++;
  writeColHeaders_(sh, row, COLS);
  row++;

  const rationaleMap = {
    "1. Management / Leadership": "RCR expected to be low (enablement focus); primary value is team output.",
    "2. Engineering & Support (IC)": "Primary RCR engine; high-utilization technical experts driving revenue.",
    "3. Consulting (IC)": "Hybrid delivery/strategy; performance is a balance of revenue and long-term value.",
    "4. Project Management": "Margin protectors; measured by project health and deadline compliance.",
    "5. Contractors": "Measured strictly by billable hours; excluded from internal OKR/SI metrics.",
    "6. Other / Uncategorized": "Review job title/level for proper ABC classification."
  };

  const tableData = [], fontColors = [];
  summary.forEach(g => {
    tableData.push([
      g.label, g.count, fmt_(g.avgRCR),
      g.critical, g.watch, g.healthy, g.champion,
      g.avgGoal !== null ? `${g.avgGoal}%` : "—",
      g.avgSI, rationaleMap[g.label] || "—",
    ]);

    const rcrFg = g.avgRCR === null       ? null
      : g.avgRCR <= CONFIG.RCR_CRITICAL   ? EXEC.FG_CRITICAL
      : g.avgRCR <= CONFIG.RCR_WATCH      ? EXEC.FG_WATCH
      : g.avgRCR <= CONFIG.RCR_HEALTHY    ? EXEC.FG_HEALTHY
      : EXEC.FG_CHAMPION;
    
    fontColors.push([
      null, null, rcrFg,
      EXEC.FG_CRITICAL, EXEC.FG_WATCH, EXEC.FG_HEALTHY, EXEC.FG_CHAMPION,
      null, null, EXEC.TEXT_MID,
    ]);
  });

  writeData_(sh, row, tableData, fontColors);
  return spacer_(row + tableData.length);
}

/**
 * Writes a summary table based on the signals triggered across the population.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object[]} allEmps
 * @returns {number} next row
 */
function writeSignalIntelligenceSummary_(sh, row, allEmps) {
  const signalMap = {
    "Output & Revenue Risks": [
      { id: "bw",    label: "Black & White (Zero RCR + Zero Hrs)", count: 0, color: EXEC.TC_RED,   desc: "Total lack of recorded output vs headcount cost." },
      { id: "sust",  label: "Sustained Low RCR (3+ Months)",       count: 0, color: EXEC.TC_RED,   desc: "Performance remains below 1.0 for the entire trend window." },
      { id: "cost",  label: "Not Covering Cost (YTD RCR ≤ 1.0)",   count: 0, color: EXEC.TC_RED,   desc: "Cumulative revenue is less than total compensation cost." }
    ],
    "Efficiency & Activity": [
      { id: "grey",  label: "Grey Zone (High Activity, Low RCR)",  count: 0, color: EXEC.TC_AMBER, desc: "Working full hours but not producing billable/attributed revenue." }
    ],
    "Engagement & Trajectory": [
      { id: "low_h", label: "Low Weekly Activity (< 30 hrs)",      count: 0, color: EXEC.TEXT_MID, desc: "Potential burnout or missing time-tracking compliance." },
      { id: "low_g", label: "Low Goal Engagement (< 40%)",         count: 0, color: EXEC.TEXT_MID, desc: "Low commitment to OKRs/Career development goals." },
      { id: "dec",   label: "Declining RCR Trajectory",            count: 0, color: EXEC.TC_AMBER, desc: "RCR has decreased relative to the previous 3-month average." }
    ]
  };

  // ── Logic: Re-run signal logic for counts ─────────────────
  allEmps.forEach(emp => {
    // Skip employees with no RCR data or Non-Contributor tier
    if (emp.tierInfo && (emp.tierInfo.tier === "No Data" || emp.tierInfo.tier === "Non-Contributor")) return;

    const rcr = emp.rcrCurrent;   // latest closed month — the dashboard's number
    const lwHrs = emp.lastWeekTotalHrs;

    // Output Risks
    if ((rcr === null || rcr <= 0) && (lwHrs === null || lwHrs <= 0)) signalMap["Output & Revenue Risks"][0].count++;
    if (emp.trend === "Sustained Low") signalMap["Output & Revenue Risks"][1].count++;
    if (rcr !== null && rcr <= CONFIG.RCR_CRITICAL) signalMap["Output & Revenue Risks"][2].count++;

    // Efficiency
    if (rcr !== null && rcr <= CONFIG.RCR_CRITICAL && lwHrs >= 35) signalMap["Efficiency & Activity"][0].count++;

    // Engagement
    if (lwHrs !== null && lwHrs > 0 && lwHrs < 30) signalMap["Engagement & Trajectory"][0].count++;
    if (emp.goalEngagementPct !== null && emp.goalEngagementPct < 40) signalMap["Engagement & Trajectory"][1].count++;
    if (emp.trend === "Declining") signalMap["Engagement & Trajectory"][2].count++;
  });

  // ── Render ────────────────────────────────────────────────
  const COLS = ["Signal Category", "Specific Signal / Flag", "Count", "Signal Definition / Action"];
  writeSection_(sh, row, "  SIGNAL INTELLIGENCE SUMMARY", COLS.length, EXEC.SECTION_DARK);
  row++;
  writeColHeaders_(sh, row, COLS);
  row++;

  const tableData = [], fontColors = [];
  Object.keys(signalMap).forEach(cat => {
    signalMap[cat].forEach((sig, i) => {
      tableData.push([
        i === 0 ? cat : "", 
        sig.label, 
        sig.count > 0 ? `${sig.count} Contributors` : "0",
        sig.desc
      ]);
      fontColors.push([
        null, 
        sig.color, 
        sig.count > 0 ? sig.color : EXEC.TEXT_MID, 
        EXEC.TEXT_MID
      ]);
    });
  });

  // Signal summary column widths
  [180, 270, 130, 130].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  writeData_(sh, row, tableData, fontColors);
  return spacer_(row + tableData.length);
}

/**
 * Writes one dimension summary table (Job Category, Supervisor, or Region).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {number} row
 * @param {object[]} empList
 * @param {string} field
 * @param {string} label
 * @returns {number} next row
 */
function writeDimSummary_(sh, row, empList, field, label, axis) {
  const summary = buildDimensionSummary_(empList, field, axis);
  const COLS = [
    "Group","Headcount", rcrColLabel_(axis),
    "Critical","Watch","Healthy","Champion",
    "Avg Goal Engage","Avg SI Score","Risk Profile",
  ];

  writeSection_(sh, row, `  ${label}     |     ${summary.length} groups`, COLS.length, EXEC.SECTION_DARK);
  row++;
  writeColHeaders_(sh, row, COLS);
  row++;

  const tableData = [], fontColors = [];
  summary.forEach(g => {
    let risk = "—";
    if (g.avgRCR !== null) {
      if      (g.avgRCR <= CONFIG.RCR_CRITICAL) risk = `${g.critical} of ${g.count} critical — review required`;
      else if (g.avgRCR <= CONFIG.RCR_WATCH)    risk = `${g.watch} in watch zone — monitor closely`;
      else if (g.avgRCR <= CONFIG.RCR_HEALTHY)  risk = "Performing within healthy range";
      else                                       risk = "Strong — champion tier average";
    }

    tableData.push([
      g.label, g.count, fmt_(g.avgRCR),
      g.critical, g.watch, g.healthy, g.champion,
      g.avgGoal !== null ? `${g.avgGoal}%` : "—",
      g.avgSI, risk,
    ]);

    // Color the Avg RCR cell by tier
    const rcrFg = g.avgRCR === null       ? null
      : g.avgRCR <= CONFIG.RCR_CRITICAL   ? EXEC.FG_CRITICAL
      : g.avgRCR <= CONFIG.RCR_WATCH      ? EXEC.FG_WATCH
      : g.avgRCR <= CONFIG.RCR_HEALTHY    ? EXEC.FG_HEALTHY
      : EXEC.FG_CHAMPION;
    fontColors.push([
      null, null, rcrFg,        // Group, HC, Avg RCR
      EXEC.FG_CRITICAL,         // Critical count
      EXEC.FG_WATCH,            // Watch count
      EXEC.FG_HEALTHY,          // Healthy count
      EXEC.FG_CHAMPION,         // Champion count
      null, null,               // Goal, SI
      EXEC.TEXT_MID,            // Risk text — muted
    ]);
  });

  // Summary table column widths
  [185, 75, 90, 70, 65, 70, 80, 110, 85, 310]
    .forEach((w, i) => sh.setColumnWidth(i + 1, w));

  writeData_(sh, row, tableData, fontColors);
  return spacer_(row + tableData.length);
}

// ============================================================
// ── SECTION: MAIN ENTRY POINT ────────────────────────────────
// ============================================================

// Inactive-status test shared by the company run, the org run and the org
// picker, so all three agree on who is "active". Crew rows are additionally
// pre-filtered on Termination/Release Date when they are seeded.
const INACTIVE_STATUS_RE_ = /terminat|resign|left|inactive|former|offboard/i;

/**
 * Main entry point — the whole company. Run from the Apps Script editor or
 * the custom menu. Errors are logged, not thrown (editor / menu caller).
 */
function runContributorIntelligence() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('runContributorIntelligence');
  else Logger.log('⚠️ [runContributorIntelligence] requireMaintainer_ not in this project — running ungated.');
  try {
    return runContributorIntelligence_(null);
  } catch (e) {
    Logger.log("❌ [runContributorIntelligence] " + e.message);
    return null;
  }
}

/**
 * Org-scoped entry point — one leader's org tree (every manager and IC under
 * them, walked through the Roster's Supervisor column), MINUS the leader's own
 * row: a rocketeer's evaluation belongs on their manager's dashboard, never on
 * one they can hand out themselves. Output goes to sheets named
 * "<report> · <Leader>" so the company-wide tabs are untouched.
 *
 * Called by the org picker dialog (google.script.run), so it THROWS on a bad
 * name or an empty org — the dialog shows the message.
 *
 * @param {string} leaderName  Roster "Name" of the org leader (aliases in NAME_MAPS resolve)
 * @returns {{ leader, orgSize, contributors, nonContributors, crew, sheets, latestMonth, rcr }}
 */
function runContributorIntelligenceForOrg(leaderName) {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('runContributorIntelligenceForOrg');
  else Logger.log('⚠️ [runContributorIntelligenceForOrg] requireMaintainer_ not in this project — running ungated.');
  const name = String(leaderName || "").trim();
  if (!name) throw new Error("Pick an org leader first.");
  return runContributorIntelligence_({ orgLeader: name });
}

/**
 * The run itself. `opts.orgLeader` scopes everything to that leader's org tree.
 * @param {{ orgLeader?: string }|null} opts
 * @returns {object} run summary (also what the org dialog displays)
 */
function runContributorIntelligence_(opts) {
  opts = opts || {};
  const orgLeader = opts.orgLeader ? String(opts.orgLeader).trim() : "";
  Logger.log(`▶ [runContributorIntelligence_] Started at ${new Date().toISOString()}${orgLeader ? `  —  org: ${orgLeader}` : ""}`);
  const { ss, axis, lastMonths, weeks, orgCtx, all, crewMembers, contributors, nonContributors } =
    buildContributionModel_(orgLeader);
  return writeContributionSheets_(ss, { axis, lastMonths, weeks, orgCtx, all, crewMembers, contributors, nonContributors });
}

/**
 * The data pipeline behind every Contributor Intelligence output — the three
 * sheets (writeContributionSheets_) and the modern web view
 * (buildContributionViewPayload_) both read this model, so a number can never
 * differ between them. Reads the source sheets, joins every metric to the
 * roster, applies the org scope (leader excluded) and segments the active pool
 * into Contributors / Non-Contributors / Crew.
 * @param {string} orgLeader  Roster name, or "" for the company-wide run
 * @returns {{ ss, axis, lastMonths: string[], weeks: object[], fc: object, orgCtx: object|null,
 *             all: object[], crewMembers: object[], contributors: object[], nonContributors: object[] }}
 */
function buildContributionModel_(orgLeader) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log("📂 Loading source sheets...");
  const rcrData    = loadSheet_(ss, CONFIG.SHEET_RCR);
  const newRcrData = loadSheetOptional_(ss, CONFIG.SHEET_RCR_NEW);
  const rcData     = loadSheet_(ss, CONFIG.SHEET_RC);
  const tccData    = loadSheet_(ss, CONFIG.SHEET_TCC);
  const siData     = loadSheet_(ss, CONFIG.SHEET_SI);
  Logger.log("📂 Loading Goals from external RD sheet...");
  const rdGoalsData = loadGoalsRD_();
  Logger.log("📂 Loading Roster from external spreadsheet...");
  const rosterData = loadRosterSheet_();
  Logger.log("📂 Loading Contractors Data (Crew Members)...");
  const contractorData = loadContractorsSheet_();

  Logger.log("📂 Loading ExclusivityContracts...");
  const exclusivitySet = loadExclusivitySet_();

  Logger.log("📂 Loading Delivery Managers...");
  const deliveryMgrSet = loadNameSet_(CONFIG.SHEET_DELIVERY_MGRS, "Delivery Managers");

  // One RCR month axis across "3. RCR" (FY26-) and "New RCR" (FY27+) — the
  // dashboard's reading. The trend window is its last three populated months.
  const axis       = readRcrAxis_(rcrData, newRcrData, rosterNameIdMap_(rosterData, contractorData));
  const lastMonths = detectLastClosedMonths_(axis);
  const fc         = fiscalContextCR_();
  setRunLabels_(axis, fc);
  Logger.log(`   → ${RUN_LABELS_.ytd}; ${RUN_LABELS_.goalsNote}`);
  Logger.log(`   → Trend window: ${lastMonths.join(", ") || "—"}` +
             (axis.latest ? `  (latest: ${axis.latest.name}, ${axis.latest.source === "rate" ? "New RCR direct rate" : "3. RCR ratio"})` : ""));

  Logger.log("📂 Calculating weekly windows...");
  const weeks = getLastNCompletedWeeks_(CONFIG.WEEKS_WINDOW);

  Logger.log("📂 Loading Kudos data...");
  const kudosMap = getKudosData_(ss, weeks);

  const jiraReportMap = getJiraCountsFromRaw_(ss, weeks);
  Logger.log("Jira weekly counts derived from Raw for " + (jiraReportMap ? jiraReportMap.size : 0) + " assignees");

  Logger.log("Building employee records...");
  const empMap = buildEmployeeMap_(siData, rcrData, rdGoalsData, rcData, tccData, jiraReportMap, axis, rosterData, exclusivitySet, deliveryMgrSet, kudosMap, weeks, contractorData);
  Logger.log("Employee map built successfully");

  // Dashboard population flags (tracking mandate, ramp-up, long leave, manager
  // cohort) so group RCR here is the same number the PS Dashboard shows.
  joinDashboardFlags_(empMap);

  // All hours = actual Tempo tracked time: the Logged Time columns, and the
  // last-week figure the Satellite risk override below reads.
  Logger.log("📂 Loading Tempo tracked time...");
  const trackedMap = getTempoTrackedHrs_(Array.from(empMap.values(), e => e.name), weeks);
  empMap.forEach(emp => {
    const hrs = trackedMap.get(normPS_(emp.name)) || weekZeros_();
    emp.weeklyTrackedHrs = hrs;
    emp.lastWeekTotalHrs = hrs[hrs.length - 1];
    emp.prevWeekTotalHrs = hrs[hrs.length - 2];
    emp.avgTotalHrs      = hrs.reduce((a, b) => a + b, 0) / hrs.length;
  });

  // Active-only pool — all three output sheets draw from this.
  // Crew members are already pre-filtered in buildEmployeeMap_ (only active rows seeded).
  let all = Array.from(empMap.values()).filter(e =>
    !INACTIVE_STATUS_RE_.test(String(e.empStatus || ""))
  );

  // ── Org scope ──────────────────────────────────────────────
  // BFS over Supervisor across the FULL map (inactive rows bridge, so a
  // terminated mid-level manager whose reports are not re-parented yet does
  // not sever the tree), then intersect with the active pool. The leader's own
  // row is never in the scope set — see resolveOrgScope_.
  let orgCtx = null;
  if (orgLeader) {
    const { anchor, scope } = resolveOrgScope_(empMap, orgLeader);
    if (!anchor) throw new Error(`"${orgLeader}" was not found on the Roster (Data / Contractors Data).`);
    all = all.filter(e => scope.has(e.key));
    if (!all.length) throw new Error(`${anchor.name} has no active reports on the Roster — nothing to export.`);
    orgCtx = { orgLeader: anchor.name, orgSize: all.length, rcr: groupRcr_(all, axis) };
    Logger.log(`🏢 Org scope "${anchor.name}": ${scope.size} in tree, ${all.length} active (leader excluded). ` +
               `Group RCR ${orgCtx.rcr.month || "—"}: ${orgCtx.rcr.value === null ? "n/a" : orgCtx.rcr.value} [${orgCtx.rcr.method || "—"}, n=${orgCtx.rcr.n}]`);
  }

  // ── Calculate Critical Satellites (Team Risk) ──────────
  // A satellite is a subordinate with low RCR (latest month), low goal engagement,
  // < 10 hours, and a poor trend
  const isSatellite = (e) =>
    (e.rcrCurrent !== null && e.rcrCurrent <= CONFIG.RCR_CRITICAL) &&
    (e.goalEngagementPct !== null && e.goalEngagementPct < 40) &&
    (e.lastWeekTotalHrs !== null && e.lastWeekTotalHrs > 0 && e.lastWeekTotalHrs < 10) &&
    (e.trend === "Sustained Low" || e.trend === "Declining" || e.trend === "Flat – Low");

  // Override Tier for Satellites and Map to Supervisors
  const supervisorSatelliteMap = new Map();
  all.forEach(e => {
    const isContractor = getJobCluster_(e) === "5. Contractors";
    const onboardingLimit = isContractor ? 0.083 : 0.34; // 1 month vs 4 months
    const isNewHire = e.tenure !== null && e.tenure <= onboardingLimit;

    if (isSatellite(e)) {
      // Force tier to Critical if they hit all risk vectors
      if (e.tierInfo && e.tierInfo.tier !== "Non-Contributor") {
        const baseNote = "Risk Profile: Low RCR + Low Activity + Low Engagement + Poor Trend";
        e.tierInfo = {
          tier: "Critical",
          badge: "Critical",
          tint: EXEC.CRITICAL_TINT,
          fg: EXEC.FG_CRITICAL,
          note: isNewHire ? `ONBOARDING RISK: ${baseNote} (Tenure <= 4 mo)` : baseNote
        };
      }

      if (e.supervisor) {
        const supKey = normalizeName_(e.supervisor);
        supervisorSatelliteMap.set(supKey, (supervisorSatelliteMap.get(supKey) || 0) + 1);
      }
    } else if (e.tierInfo && e.tierInfo.tier === "Critical" && isNewHire) {
      // Just RCR critical but also new hire
      e.tierInfo.note = "NEW HIRE CRITICAL: Tenure <= 4 mo. Assessment should consider ramp-up phase.";
    }
  });

  all.forEach(e => {
    e.criticalSatelliteCount = supervisorSatelliteMap.get(normalizeName_(e.name)) || 0;
  });

  // ── Segment the active pool into three mutually exclusive groups ──
  //
  //  Crew Members      — seeded from 'Contractors Data' tab (isCrewMember flag)
  //  Contributors      — Roster 'Data' employees with Class = 'Professional Services'
  //  Non-Contributors  — all other active Roster employees (G&A, Ops, etc.)

  // isCrewMember flag covers 'Contractors Data' seeds.
  // getJobCluster_ === "5. Contractors" catches any contractor-level employees
  // that entered via the main Roster — they belong in the crew bucket, not non-contributors.
  const isCrew        = e => e.isCrewMember === true || getJobCluster_(e) === "5. Contractors";
  const isPSEmployee  = e => String(e.empClass || "").trim() === "Professional Services" && !isCrew(e);

  const crewMembers     = all.filter(isCrew);
  const contributors    = all.filter(isPSEmployee);
  const nonContributors = all.filter(e => !isCrew(e) && !isPSEmployee(e));

  // Apply goal-engagement-based classification to operational non-contributors
  nonContributors.forEach(e => {
    e.tierInfo = classifyNonContributor_(e);
    e.isInternalGA = true;
  });

  return { ss, axis, lastMonths, weeks, fc, orgCtx, all, crewMembers, contributors, nonContributors };
}

/**
 * Writes the three Contributor Intelligence tabs from a buildContributionModel_ result.
 * @returns {object} run summary (also what the org dialog displays)
 */
function writeContributionSheets_(ss, model) {
  const { axis, lastMonths, weeks, orgCtx, all, crewMembers, contributors, nonContributors } = model;

  // Sheet names: company run → the configured tabs; org run → "<tab> · <Leader>".
  // An org run writes only the segments that have people (a director's org is
  // often pure consultants) and removes a stale same-named tab from an earlier run.
  const nameContrib = orgSheetName_(CONFIG.SHEET_OUTPUT,             orgCtx);
  const nameNC      = orgSheetName_(CONFIG.SHEET_OUTPUT_NON_CONTRIB, orgCtx);
  const nameCrew    = orgSheetName_(CONFIG.SHEET_OUTPUT_CREW,        orgCtx);
  const writeSegment = (list) => !orgCtx || list.length > 0;
  const written = [];

  const wkW = (w) => weekZeros_().map(() => w);  // one width per week column
  let row = 1, rowNC = 1, rowCrew = 1;
  let sh = null;

  // ── 1. CONTRIBUTOR SHEET ───────────────────────────────────
  // 17 + 3×WEEKS_WINDOW cols (29 @ 4 wks): ID, EmpNum, Name, JobTitle, Level, ContribType, Supervisor, Region, Tenure,
  //          legacy YTD RCR, M-2 RCR, M-1 RCR, Latest RCR, RCR Tier, Goal Engage,
  //          Wk comments…, Kudos, SI Score, Logged Wk…, Jira Wk…
  if (writeSegment(contributors)) {
    Logger.log("📝 Writing contributor intelligence sheet...");
    const contribWidths = [100, 100, 145, 180, 50, 145, 145, 115, 52, 65, 62, 62, 72, 70, 75, ...wkW(65), 55, 75, ...wkW(70), ...wkW(60)];
    sh = prepareOutputSheet_(ss, nameContrib, contribWidths);
    row = writeBanner_(sh, row, lastMonths, false, contribWidths.length, orgCtx);
    row = spacer_(row);

    // ── Main Contributor Table — tier buckets on the LATEST month ──
    const cur = e => e.rcrCurrent;
    const critSorted   = contributors.filter(e => cur(e) !== null && cur(e) <= CONFIG.RCR_CRITICAL).sort((a, b) => cur(a) - cur(b));
    const watchSorted  = contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_CRITICAL && cur(e) <= CONFIG.RCR_WATCH).sort((a, b) => cur(a) - cur(b));
    const healthSorted = contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_WATCH && cur(e) <= CONFIG.RCR_HEALTHY).sort((a, b) => cur(b) - cur(a));
    const champSorted  = contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_HEALTHY).sort((a, b) => cur(b) - cur(a));
    const ndList       = contributors.filter(e => cur(e) === null);

    const mainList = [].concat(critSorted, watchSorted, healthSorted, champSorted, ndList);
    row = writeMainTable_(sh, row, mainList, lastMonths, weeks);

    // ── Dimension Summaries ───────────────────────────────
    row = writeJobClusterSummary_(sh, row, contributors, "JOB PROFILE CLUSTERING (ABC Strategy)", axis);
    row = writeDimSummary_(sh, row, contributors, "supervisor",  "SUPERVISOR SUMMARY", axis);
    row = writeDimSummary_(sh, row, contributors, "region",      "RESOURCE REGION SUMMARY", axis);

    sh.setFrozenRows(orgCtx ? 6 : 5);
    written.push(nameContrib);
  } else {
    dropStaleSheet_(ss, nameContrib);
  }

  // ── 2. NON-CONTRIBUTOR SHEET ───────────────────────────────
  if (writeSegment(nonContributors)) {
    Logger.log("📝 Writing non-contributor intelligence sheet...");
    // 14 + 3×WEEKS_WINDOW cols (26 @ 4 wks): ID, EmpNum, Name, Dept, JobTitle, Level, ContribType, Supervisor, Region, Tenure,
    //          Goal Engage, Wk-2 Comments, Wk-1 Comments, LW Comments, Avg Comments/Wk, Kudos,
    //          SI Score, Logged Wk-2, Logged Wk-1, Logged LW, Jira LW, Jira Wk-1, Jira Wk-2
    const nonContribWidths = [100, 100, 145, 120, 180, 50, 145, 115, 115, 52, 80, ...wkW(65), 90, 55, 100, ...wkW(70), ...wkW(60)];
    const shNC = prepareOutputSheet_(ss, nameNC, nonContribWidths);

    rowNC = writeBanner_(shNC, rowNC, null, true, nonContribWidths.length, orgCtx);
    rowNC = spacer_(rowNC);

    // Non-Contributor Table
    const ncList = nonContributors.sort((a, b) => {
      const tierOrder = { "Champion": 1, "Healthy": 2, "Watch": 3, "Critical": 4, "Onboarding": 5, "No Data": 6 };
      const orderA = tierOrder[a.tierInfo.tier] || 99;
      const orderB = tierOrder[b.tierInfo.tier] || 99;
      if (orderA !== orderB) return orderA - orderB;
      return (b.goalEngagementPct || 0) - (a.goalEngagementPct || 0);
    });
    rowNC = writeNonContributorTable_(shNC, rowNC, ncList, weeks);

    rowNC = writeDimSummary_(shNC, rowNC, nonContributors, "supervisor",  "SUPERVISOR SUMMARY (Non-Contributors)", axis);

    shNC.setFrozenRows(orgCtx ? 4 : 3);
    written.push(nameNC);
  } else {
    dropStaleSheet_(ss, nameNC);
  }

  // ── 3. CREW MEMBER SHEET ───────────────────────────────────
  if (writeSegment(crewMembers)) {
    Logger.log("📝 Writing crew member intelligence sheet...");
    // 12 + 2×WEEKS_WINDOW cols (20 @ 4 wks): ID, Name, Dept, JobTitle, Supervisor, Region, Tenure, legacy YTD RCR,
    //          M-2 RCR, M-1 RCR, Latest RCR, Kudos, Logged Wk…, Jira Wk…
    const crewWidths = [100, 145, 120, 180, 145, 115, 52, 65, 62, 62, 72, 55, ...wkW(65), ...wkW(60)];
    const shCrew = prepareOutputSheet_(ss, nameCrew, crewWidths);

    rowCrew = writeBanner_(shCrew, rowCrew, lastMonths, false, crewWidths.length, orgCtx);
    rowCrew = spacer_(rowCrew);

    const crewSorted = crewMembers.sort((a, b) => (b.rcrCurrent || 0) - (a.rcrCurrent || 0));
    rowCrew = writeCrewTable_(shCrew, rowCrew, crewSorted, lastMonths, weeks);

    shCrew.setFrozenRows(orgCtx ? 6 : 5);
    written.push(nameCrew);
  } else {
    dropStaleSheet_(ss, nameCrew);
  }

  if (sh) ss.setActiveSheet(sh); // Set focus back to main sheet
  Logger.log(`✅ [runContributorIntelligence_] Done. Contributor rows: ${row}, Non-Contributor rows: ${rowNC}, Crew rows: ${rowCrew}`);

  return {
    leader:          orgCtx ? orgCtx.orgLeader : null,
    orgSize:         orgCtx ? orgCtx.orgSize : all.length,
    contributors:    contributors.length,
    nonContributors: nonContributors.length,
    crew:            crewMembers.length,
    sheets:          written,
    latestMonth:     axis.latest ? axis.latest.name : null,
    rcrMethod:       axis.latest ? (axis.latest.source === "rate" ? "direct-rate" : "sum-ratio") : null,
    rcr:             orgCtx ? orgCtx.rcr : groupRcr_(all, axis),
  };
}

// ============================================================
// ── SECTION: ORG SCOPE ───────────────────────────────────────
// ============================================================

/**
 * Builds a leader's org tree from the employee map: BFS over the Supervisor
 * field, starting at the leader, through every record in the map — ACTIVE OR
 * NOT. Inactive rows are traversal nodes (they bridge a terminated mid-level
 * manager to the people still under them) and are filtered out later by the
 * active-pool test, exactly as resolveManagerScope_ does in the dashboard.
 *
 * The leader's own row seeds the walk and is never added to `scope`: nobody
 * gets an export that contains their own evaluation.
 *
 * @param {Map<string, object>} empMap  buildEmployeeMap_() output (key = Internal ID)
 * @param {string} leaderName           Roster "Name" (NAME_MAPS aliases resolve)
 * @returns {{ anchor: object|null, scope: Set<string> }}  scope = Internal IDs under the leader
 */
function resolveOrgScope_(empMap, leaderName) {
  const target = normalizeToRosterKey_(leaderName);
  const scope  = new Set();
  if (!target) return { anchor: null, scope };

  // Anchor: the leader's record. Prefer an active row when a name repeats.
  let anchor = null;
  empMap.forEach(e => {
    if (normalizeName_(e.name) !== target) return;
    const inactive = r => INACTIVE_STATUS_RE_.test(String(r.empStatus || ""));
    if (!anchor || (inactive(anchor) && !inactive(e))) anchor = e;
  });
  if (!anchor) return { anchor: null, scope };

  const seen  = new Set([target]);
  const queue = [target];
  while (queue.length) {
    const supNorm = queue.shift();
    empMap.forEach((e, key) => {
      if (normalizeName_(e.supervisor) !== supNorm) return;
      const n = normalizeName_(e.name);
      if (!n || seen.has(n)) return;
      seen.add(n);
      queue.push(n);          // this person may supervise others
      scope.add(key);
    });
  }
  return { anchor, scope };
}

/**
 * Sheet name for a run: the configured tab for the company run, or
 * "<tab> · <Leader>" for an org run (Sheets caps tab names at 100 chars).
 */
function orgSheetName_(base, orgCtx) {
  if (!orgCtx || !orgCtx.orgLeader) return base;
  const name = base + CONFIG.ORG_SHEET_SEP + orgCtx.orgLeader;
  return name.length > 100 ? name.slice(0, 100) : name;
}

/** Removes a tab an earlier run of the same org left behind for a now-empty segment. */
function dropStaleSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) return;
  if (ss.getSheets().length <= 1) return;   // a spreadsheet must keep one sheet
  ss.deleteSheet(sh);
  Logger.log(`🧹 Removed stale tab "${name}" — that segment has no one in this org now.`);
}

/**
 * Like loadSheet_ but a missing tab is a logged null, not an error — the
 * New RCR tab may not exist yet in a copy of the dataset.
 */
function loadSheetOptional_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) { Logger.log(`ℹ️ Sheet "${sheetName}" not found — skipped.`); return null; }
  return loadSheet_(ss, sheetName);
}

/** normalized Name → Internal ID across the Data and Contractors Data tabs. */
function rosterNameIdMap_(rosterData, contractorData) {
  const m = new Map();
  [rosterData, contractorData].forEach(data => {
    if (!data || !data.rows || !data.headers) return;
    data.rows.forEach(row => {
      const name = strVal_(row, data.headers, "Name");
      const id   = strVal_(row, data.headers, "Internal ID");
      if (name && id && !m.has(normalizeName_(name))) m.set(normalizeName_(name), id);
    });
  });
  return m;
}

/**
 * Copies the PS Dashboard's population flags onto the employee records so the
 * group RCR here is computed over the same people the dashboard aggregates:
 * tracking mandate (job family allowlist), ramp-up, long leave, people-manager
 * cohort. All four come from PS Contribution Report.js (same project); when it
 * is not in scope, or the roster read fails, everyone keeps the defaults — which
 * is "counts toward the group", the same fail-open direction tracksTime_ takes.
 * @param {Map<string, object>} empMap
 * @returns {number} records matched to a dashboard roster profile
 */
function joinDashboardFlags_(empMap) {
  if (typeof readPSRoster_ !== "function" || typeof tracksTime_ !== "function") {
    Logger.log("ℹ️ Dashboard roster helpers not in this project — everyone counts toward group RCR.");
    return 0;
  }
  try {
    const roster  = readPSRoster_();
    const catalog = typeof readJobCatalog_ === "function" ? readJobCatalog_() : null;
    const sups    = typeof activeSupervisorNames_ === "function" ? activeSupervisorNames_(roster) : null;
    let matched = 0, exempt = 0, ramp = 0, leave = 0;
    empMap.forEach(emp => {
      const p = roster.get(normPS_(emp.name || ""));
      if (!p) return;
      matched++;
      emp.tracksTime = tracksTime_(p, catalog);
      emp.isRampUp   = !!p.isRampUp;
      emp.onLeave    = !!p.onLeave;
      emp.isManager  = typeof isPeopleManager_ === "function" ? isPeopleManager_(p, catalog, sups) : false;
      if (emp.tracksTime === false) exempt++;
      if (emp.isRampUp) ramp++;
      if (emp.onLeave)  leave++;
    });
    Logger.log(`Dashboard flags: ${matched} of ${empMap.size} records matched — ${exempt} tracking-exempt, ${ramp} ramping up, ${leave} on long leave (all outside group RCR).`);
    return matched;
  } catch (e) {
    Logger.log(`⚠️ joinDashboardFlags_: ${e.message} — everyone counts toward group RCR.`);
    return 0;
  }
}

// ============================================================
// ── SECTION: ORG PICKER (menu dialog) ────────────────────────
// ============================================================

/**
 * Flattens the Roster tabs to the fields the org picker needs.
 * @returns {{ name, supervisor, status, title, termDate, isCrew }[]}
 */
function rosterPeople_(rosterData, contractorData) {
  const out = [];
  const take = (data, isCrew) => {
    if (!data || !data.rows || !data.headers) return;
    data.rows.forEach(row => {
      const name = strVal_(row, data.headers, "Name");
      if (!name) return;
      out.push({
        name,
        supervisor: strVal_(row, data.headers, "Supervisor"),
        status:     strVal_(row, data.headers, "Employee Status"),
        title:      strVal_(row, data.headers, "Job Title"),
        termDate:   strVal_(row, data.headers, "Termination/Release Date"),
        isCrew,
      });
    });
  };
  take(rosterData, false);
  take(contractorData, true);
  return out;
}

/**
 * Everyone who leads at least one active person, with the size of the org
 * under them. Pure — fed by rosterPeople_, tested in Node.
 * Active = not an inactive status and (for crew) no release date. The walk
 * passes through inactive rows so a tree is not cut at a terminated manager,
 * but only active people are counted.
 * @returns {{ name, title, directReports, orgSize }[]} sorted by name
 */
function orgCandidatesFrom_(people) {
  const isActive = p => !INACTIVE_STATUS_RE_.test(String(p.status || "")) && !(p.isCrew && p.termDate);
  const byName   = new Map();                        // norm → person (first active row wins)
  const kids     = new Map();                        // supNorm → [person]
  people.forEach(p => {
    const n = normalizeName_(p.name);
    if (!n) return;
    const prev = byName.get(n);
    if (!prev || (!isActive(prev) && isActive(p))) byName.set(n, p);
    const s = normalizeName_(p.supervisor);
    if (!s || s === n) return;
    if (!kids.has(s)) kids.set(s, []);
    kids.get(s).push(p);
  });

  const out = [];
  byName.forEach((p, n) => {
    if (!isActive(p)) return;
    const direct = (kids.get(n) || []).filter(isActive).length;
    if (!direct) return;
    // Org size: active people anywhere below, through inactive bridges.
    const seen = new Set([n]); const queue = [n]; let size = 0;
    while (queue.length) {
      (kids.get(queue.shift()) || []).forEach(k => {
        const kn = normalizeName_(k.name);
        if (seen.has(kn)) return;
        seen.add(kn); queue.push(kn);
        if (isActive(k)) size++;
      });
    }
    out.push({ name: p.name, title: p.title || "", directReports: direct, orgSize: size });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Org leaders for the picker dialog — the people the org run can anchor on.
 * Admin-gated like every other export entry point in this file.
 * @returns {{ name, title, directReports, orgSize }[]}
 */
function listOrgReportCandidates() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('listOrgReportCandidates');
  else Logger.log('⚠️ [listOrgReportCandidates] requireMaintainer_ not in this project — running ungated.');
  const people = rosterPeople_(loadRosterSheet_(), loadContractorsSheet_());
  const out = orgCandidatesFrom_(people);
  Logger.log(`Org picker: ${out.length} leaders with active reports.`);
  return out;
}

/** Opens the org picker dialog (menu item). Menu handlers must be public (a
 * trailing underscore gives "Script function not found"), so it is gated. */
function showOrgPicker() {
  if (typeof requireMaintainer_ === "function") requireMaintainer_("showOrgPicker");
  const html = HtmlService.createHtmlOutputFromFile("Contribution Org Picker")
    .setWidth(560)
    .setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, "Contributor Intelligence — run for one org");
}

// ============================================================
// ── SECTION: MODERN VIEW (web UI) ────────────────────────────
// ============================================================
// "Contribution View.html" is the prototype for the PS Dashboard's next look. It
// renders the SAME model the sheets are written from (buildContributionModel_),
// serialised by buildContributionViewPayload_ — a pure function, so the numbers
// on screen are the numbers in the tabs. Spec: docs/specs/2026-10-24-contribution-modern-view-design.md

/** Round to 2 decimals; null for anything that is not a finite number. */
function viewNum_(v, d) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!isFinite(n)) return null;
  const k = Math.pow(10, d === undefined ? 2 : d);
  return Math.round(n * k) / k;
}

/** Job cluster label without its sort prefix: "2. Engineering & Support (IC)" → "Engineering & Support (IC)". */
function viewClusterLabel_(emp) {
  return getJobCluster_(emp).replace(/^\d+\.\s*/, "");
}

/**
 * One person as the view reads them. Plain JSON only — google.script.run drops
 * Dates and undefined, so every value is a string, a finite number, a boolean,
 * null or an array of those.
 * @param {object} e        employee record from buildEmployeeMap_
 * @param {string} segment  "contributor" | "non" | "crew"
 */
function viewPerson_(e, segment) {
  const t = e.tierInfo || {};
  const series = (e.monthlyRCR || []).map(p => [p.month, viewNum_(p.value)]);
  return {
    id: e.internalId || "", name: e.name || "", title: e.jobTitle || "", level: e.jobLevel || "",
    dept: e.dept || "", supervisor: e.supervisor || "", region: e.region || "",
    cluster: viewClusterLabel_(e), segment,
    tenure: viewNum_(e.tenure, 1),
    tier: t.tier || "No Data", badge: t.badge || t.tier || "No Data", tierNote: t.note || "",
    rcr: viewNum_(e.rcrCurrent), rcrSeries: series, legacyYtd: viewNum_(e.ytdRCR), trend: e.trend || "—",
    goal: e.goalEngagementPct === null || e.goalEngagementPct === undefined ? null : viewNum_(e.goalEngagementPct, 0),
    goalAvgComments: viewNum_(e.goalAvgCommentsPerWeek, 1),
    comments: (e.goalMonthlyComments || []).map(v => viewNum_(v, 0) || 0),
    kudos: e.kudosL3W || 0,
    si: (e.siScores || []).map(s => viewNum_(s, 1)), siLatest: viewNum_(e.latestSI, 1), siAvg: viewNum_(e.avgSI, 1),
    hrs:  (e.weeklyTrackedHrs || []).map(h => viewNum_(h, 1) || 0),
    jira: (e.jiraEpicCounts || []).map(c => viewNum_(c, 0) || 0),
    signals: String(buildSignal_(e) || "").split(/\s{2}·\s{2}/).filter(Boolean),
    satellites: e.criticalSatelliteCount || 0,
    rampUp: !!e.isRampUp, onLeave: !!e.onLeave, isManager: !!e.isManager,
  };
}

/** Tier counts for a list of people records (the same tier the badge shows). */
function viewTierCounts_(people) {
  const c = { Critical: 0, Watch: 0, Healthy: 0, Champion: 0, Onboarding: 0, "No Data": 0, "Non-Contributor": 0 };
  people.forEach(p => { c[p.tier] = (c[p.tier] || 0) + 1; });
  return c;
}

/** buildGroupSummary_ rows, trimmed to what the view draws. */
function viewGroups_(emps, keyOf, axis) {
  return buildGroupSummary_(emps, keyOf, axis)
    .sort((a, b) => (a.avgRCR === null ? 999 : a.avgRCR) - (b.avgRCR === null ? 999 : b.avgRCR))
    .map(g => ({
      label: g.label, count: g.count,
      critical: g.critical, watch: g.watch, healthy: g.healthy, champion: g.champion,
      rcr: viewNum_(g.avgRCR), rcrN: g.rcrN, goal: g.avgGoal, si: g.avgSI === "—" ? null : viewNum_(g.avgSI, 1),
    }));
}

/**
 * Serialises a buildContributionModel_ result for Contribution View.html.
 * Pure: no Sheets, no Session — covered by tests/contribution-view-checks.js.
 * Order inside each segment is the sheet's: Critical → Watch → Healthy →
 * Champion → No Data for contributors, tier then goal engagement for the rest.
 */
function buildContributionViewPayload_(model) {
  const { axis, lastMonths, weeks, orgCtx, all, crewMembers, contributors, nonContributors } = model;
  const fc  = model.fc || null;
  const cur = e => e.rcrCurrent;
  const rank = [
    contributors.filter(e => cur(e) !== null && cur(e) <= CONFIG.RCR_CRITICAL).sort((a, b) => cur(a) - cur(b)),
    contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_CRITICAL && cur(e) <= CONFIG.RCR_WATCH).sort((a, b) => cur(a) - cur(b)),
    contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_WATCH && cur(e) <= CONFIG.RCR_HEALTHY).sort((a, b) => cur(b) - cur(a)),
    contributors.filter(e => cur(e) !== null && cur(e) > CONFIG.RCR_HEALTHY).sort((a, b) => cur(b) - cur(a)),
    contributors.filter(e => cur(e) === null),
  ];
  const tierOrder = { Champion: 1, Healthy: 2, Watch: 3, Critical: 4, Onboarding: 5, "No Data": 6 };
  const ncSorted = nonContributors.slice().sort((a, b) =>
    (tierOrder[a.tierInfo.tier] || 99) - (tierOrder[b.tierInfo.tier] || 99) ||
    (b.goalEngagementPct || 0) - (a.goalEngagementPct || 0));
  const crewSorted = crewMembers.slice().sort((a, b) => (b.rcrCurrent || 0) - (a.rcrCurrent || 0));

  const contrib = [].concat.apply([], rank).map(e => viewPerson_(e, "contributor"));
  const non     = ncSorted.map(e => viewPerson_(e, "non"));
  const crew    = crewSorted.map(e => viewPerson_(e, "crew"));
  const grp     = groupRcr_(all, axis);

  return {
    meta: {
      scope: orgCtx ? "org" : "company",
      leader: orgCtx ? orgCtx.orgLeader : null,
      orgSize: all.length,
      generatedAt: new Date().toISOString(),
      latestMonth: axis && axis.latest ? axis.latest.name : null,
      rcrMethod: grp.method, rcrMethodLabel: rcrMethodLabel_(grp.method),
      rcr: { value: viewNum_(grp.value), n: grp.n, month: grp.month },
      months: axis && axis.months ? axis.months.map(m => m.name) : [],
      trendMonths: lastMonths || [],
      weekLabels: (weeks || []).map(w => w.label),
      weekStarts: (weeks || []).map(w => toIsoDate_(w.start)),
      siQuarters: fc ? fc.siQuarters : [],
      goalsQuarter: fc ? fc.reportQuarter : "",
      goalsNote: RUN_LABELS_.goalsNote || "",
      ytdLabel: ytdLabelFor_(axis),
      thresholds: { critical: CONFIG.RCR_CRITICAL, watch: CONFIG.RCR_WATCH, healthy: CONFIG.RCR_HEALTHY },
      siLabels: CONFIG.SI_LABELS,
      counts: { contributors: contrib.length, nonContributors: non.length, crew: crew.length },
    },
    contributors: contrib,
    nonContributors: non,
    crew,
    tiers: {
      contributors: viewTierCounts_(contrib),
      nonContributors: viewTierCounts_(non),
      crew: viewTierCounts_(crew),
    },
    groups: {
      cluster:    viewGroups_(contributors, viewClusterLabel_, axis),
      supervisor: viewGroups_(contributors, e => e.supervisor || "(Unassigned)", axis),
      region:     viewGroups_(contributors, e => e.region || "(Unassigned)", axis),
      ncSupervisor: viewGroups_(nonContributors, e => e.supervisor || "(Unassigned)", axis),
    },
  };
}

/**
 * The web view's data call. `orgLeader` "" = company-wide.
 * Gated like the exporters it mirrors: same people data, same audience.
 * @param {string} [orgLeader]
 */
function getContributionView(orgLeader) {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('getContributionView');
  else Logger.log('⚠️ [getContributionView] requireMaintainer_ not in this project — running ungated.');
  const name = String(orgLeader || "").trim();
  return buildContributionViewPayload_(buildContributionModel_(name));
}

/** Menu: opens the modern view in a large modeless dialog. */
function showContributionView() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('showContributionView');
  const html = HtmlService.createHtmlOutputFromFile("Contribution View")
    .setWidth(1400)
    .setHeight(860);
  SpreadsheetApp.getUi().showModelessDialog(html, "Contributor Intelligence");
}

/**
 * Installs the custom spreadsheet menu on open.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🚀 Contributor Intelligence")
    .addItem("🖥  Open modern view", "showContributionView")
    .addSeparator()
    .addItem("▶  Run Full Analysis", "runContributorIntelligence")
    .addItem("🏢  Run for an org…", "showOrgPicker")
    .addSeparator()
    .addItem("ℹ️  About", "showAbout")
    .addToUi();
}

/** About dialog (menu item; public, reads nothing). */
function showAbout() {
  if (typeof requireMaintainer_ === "function") requireMaintainer_("showAbout");
  SpreadsheetApp.getUi().alert(
    `${CONFIG.SCRIPT_LABEL}  v2.1.0\n\n` +
    `Executive RCR signal analysis with goal engagement and SI\n` +
    `manager score correlation. RCR reads "3. RCR" (FY26-) and\n` +
    `"New RCR" (FY27+) on one month axis, as the PS Dashboard does.\n` +
    `"Run for an org…" exports one leader's tree, minus the leader.\n\n` +
    `ABC Framework — ServiceRocket.`
  );
}

// ============================================================
// 🚀  GETTING STARTED
// ============================================================
// 1. Open Extensions → Apps Script in your spreadsheet.
//    Paste this file. Save (Ctrl+S).
//
// 2. Confirm CONFIG sheet names match your tabs exactly:
//      SHEET_RCR:   "3. RCR"
//      SHEET_GOALS: "Goals"
//      SHEET_SI:    "SI"
//
// 3. Reload the spreadsheet. The menu
//    "🚀 Contributor Intelligence" appears in the toolbar.
//
// 4. Click "▶ Run Full Analysis".
//    Grant permissions on first run.
//
// 5. The last 3 populated months are auto-detected —
//    no manual month configuration required.
//
// 6. Output sheet "📊 Contributor Intelligence" is created:
//      Critical Contributors   (RCR ≤ 1.0)
//      Watch Zone              (RCR 1.01–2.0)
//      Top Contributors        (RCR > 3.0)
//      Monthly RCR Trend Grid  (Critical + Watch only)
//      Contributor Type Summary
//      Supervisor Summary
//      Resource Region Summary
// ============================================================