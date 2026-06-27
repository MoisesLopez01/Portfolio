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
  SHEET_RCR:      "3. RCR",
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

  // ── Goals (external PS Goals spreadsheet) ────────────────
  GOALS_SS_ID:         "1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ",
  SHEET_GOALS_RD:      "RD",
  GOALS_QUARTER:       "FY26Q4",
  Q4_BASE_ISO_WEEK:    14,     // ISO week that starts FY26Q4 (April 1 week)
  GOALS_MIN_COUNT:     10,     // ≥ 10 distinct goals required
  GOALS_COMPLETED_MIN: 8,      // ≥ 8 completed by quarter end
  GOALS_COMMENT_PCT:   0.60,   // 60 % of goals must have required weekly self-comments

  // ── Kudos ─────────────────────────────────────────────────
  SHEET_KUDOS: "Kudos_Normalized",

  // ── RCR Tier Thresholds (ABC Framework) ──────────────────
  RCR_CRITICAL: 1.0,  // ≤ 1.0  → Critical
  RCR_WATCH:    2.0,  // ≤ 2.0  → Watch
  RCR_HEALTHY:  3.0,  // ≤ 3.0  → Healthy
  //             > 3.0 → Champion

  // ── All fiscal month columns in source sheets (in order) ─
  MONTH_COLS: [
    "Jul 25","Aug 25","Sep 25","Oct 25","Nov 25","Dec 25",
    "Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26"
  ],

  // ── YTD column header ─────────────────────────────────────
  COL_YTD: "YTD",

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
 * a Map of normalized recipient name → kudos count within the 3-week window.
 * Reuses PS infrastructure: loadSheet_PS_, findCol_PS_, parseDate_PS_, CONFIG_PS.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks  — output of getLastNCompletedWeeks_(3)
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
    Logger.log(`Kudos: ${map.size} recipients with kudos in 3-week window`);
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
    tierInfo: classifyRCR_(null, ""),
    siScores: [], validSI: [], latestSI: null, avgSI: null, siTrend: "—",
    goalsCompleted: null, goalsInProgress: null, goalsTotal: null,
    goalEngagementPct: null, goalsNote: "—", goalActivityTrend: "—",
    goalMonthLabels: ["M-2", "M-1", "M-0"],
    goalMonthlyComments: [0, 0, 0],  // repurposed: weekly comment counts per 3-week window
    goalAvgCommentsPerWeek: 0,
    kudosL3W: 0,
    weeklyBillable: [],
    lastWeekBillablePct: null, prevWeekBillablePct: null,
    lastWeekTotalHrs: 0, prevWeekTotalHrs: 0,
    avgBillablePct: null, avgTotalHrs: 0,
    weeklyClientHrs: [0, 0, 0],
    jiraEpicCounts: [0, 0, 0],
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
  return CONFIG.MONTH_COLS
    .map(m => ({ month: m, value: numVal_(row, headers, m) }))
    .filter(x => x.value !== null);
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

/** Stores Jira API Token in Script Properties. */
function setAPI__Jira() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt("Jira API Setup", "Please paste your Jira API Token:", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() === ui.Button.OK) {
    const token = response.getResponseText();
    const props = PropertiesService.getScriptProperties();
    props.setProperty("API__Jira", token);
    props.setProperty("ADMIN_AC", "035X");
    ui.alert("✅ Jira API token saved.");
  }
}

/** Retrieves Jira API Token. */
function getAPI__Jira() {
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

    if (!map.has(name)) map.set(name, [0, 0, 0]);
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
    
    const counts = [
      parseFloat(row[1]) || 0, // Wk-2
      parseFloat(row[2]) || 0, // Wk-1
      parseFloat(row[3]) || 0  // LW (Latest)
    ];
    map.set(name, counts);
  });
  return map;
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
 * Reads the Utilization sheet and returns BOTH total hours and client-only
 * hours per employee for the last 3 completed weeks (Mon–Sun).
 * "Client time" = any row where the Customer is NOT '- No Customer/Project -'
 * and the Project Name does NOT contain 'No Customer/Project'.
 *
 * Join key: 'Resource' from Utilization ↔ 'Name' from Roster.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {object[]} weeks  — output of getLastNCompletedWeeks_(3)
 * @returns {Map<string, { client: number[], total: number[] }>}
 *          normalisedName → { client: [wk0,wk1,wk2], total: [wk0,wk1,wk2] }
 */
function getUtilizationHrs_(ss, weeks) {
  const sheet = ss.getSheetByName('Utilization');
  if (!sheet) {
    Logger.log("⚠️ Utilization sheet not found — hours will be empty.");
    return new Map();
  }

  const raw = sheet.getDataRange().getValues();
  if (raw.length < 2) return new Map();
  const headers = raw[0].map(h => String(h || '').trim());

  const C = {
    resource: headers.indexOf('Resource'),
    project:  headers.indexOf('Project Name'),
    customer: headers.indexOf('Customer'),
    date:     headers.indexOf('Date'),
    actual:   headers.indexOf('Actual Time'),
  };

  if (C.resource === -1 || C.date === -1 || C.actual === -1) {
    Logger.log("⚠️ Utilization sheet missing required columns (Resource/Date/Actual Time).");
    return new Map();
  }

  const map = new Map();

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    const dateVal = parseDate_(row[C.date]);
    if (!dateVal) continue;

    const actual = parseFloat(row[C.actual]) || 0;
    if (actual <= 0) continue;

    const wkIdx = weeks.findIndex(w => isInWeek_(dateVal, w.start, w.end));
    if (wkIdx < 0) continue;

    const resource = normalizeToRosterKey_(String(row[C.resource] || ''));
    if (!resource) continue;

    if (!map.has(resource)) {
      map.set(resource, { client: [0, 0, 0], total: [0, 0, 0] });
    }
    const bucket = map.get(resource);
    bucket.total[wkIdx] += actual;

    const customer = String(row[C.customer] || '').trim();
    const project  = String(row[C.project]  || '').trim();
    const isNoCustomer = (customer === '- No Customer/Project -' || project.includes('No Customer/Project'));
    if (!isNoCustomer) {
      bucket.client[wkIdx] += actual;
    }
  }

  Logger.log("Utilization hours loaded for " + map.size + " resources (total + client)");
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
 * Auto-detects the last N populated fiscal months from the RCR sheet.
 * A month is "populated" if at least one employee has a non-blank value for it.
 * @param {object} rcrData  { headers, rows }
 * @returns {string[]}  up to CONFIG.TREND_MONTHS month names
 */
function detectLastClosedMonths_(rcrData) {
  const populated = CONFIG.MONTH_COLS.filter(m => {
    const idx = colIdx_CR_(rcrData.headers, m);
    if (idx < 0) return false;
    return rcrData.rows.some(row => {
      const v = row[idx];
      return v !== "" && v !== null && v !== undefined && !isNaN(parseFloat(v));
    });
  });
  return populated.slice(-CONFIG.TREND_MONTHS);
}

/**
 * Builds the enriched employee record map.
 * SI tab is the headcount base; RCR and Goals are joined by employee name.
 * @param {object} siData
 * @param {object} rcrData
 * @param {object} rdGoalsData  — loaded from external Goals RD tab via loadGoalsRD_()
 * @param {object} rcData
 * @param {object} tccData
 * @param {string[]} lastMonths  auto-detected closed months
 * @param {object} rosterData  Roster sheet data for Job Title lookup
 * @param {Map<string, { client: number[], total: number[] }>} utilMap  hours from Utilization tab (total + client)
 * @param {Set<string>} exclusivitySet  normalized names from ExclusivityContracts
 * @param {Set<string>} deliveryMgrSet  normalized names from Delivery Managers
 * @param {Map<string, number>} kudosMap  recipient normalized key → kudos count in window
 * @param {object[]} weeks  — the 3 completed week windows used for bucketing
 * @returns {Map<string, object>}
 */
function buildEmployeeMap_(siData, rcrData, rdGoalsData, rcData, tccData, jiraReportMap, lastMonths, rosterData, utilMap, exclusivitySet, deliveryMgrSet, kudosMap, weeks, contractorData) {
  Logger.log("Entering buildEmployeeMap_");
  try {
    if (!lastMonths) {
      Logger.log("   → WARNING: lastMonths is undefined, using empty array");
      lastMonths = [];
    }
    const employees = new Map();
    const safeLastMonths = lastMonths;
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
      const ROSTER_INACTIVE_RE = /terminat|job offer accepted|resign|left|inactive|former|offboard/i;
      rosterData.rows.forEach(row => {
        const internalId = strVal_(row, rosterData.headers, "Internal ID");
        if (!internalId) return;
        if (_excludedIds.has(String(internalId).trim().toLowerCase())) return;

        const rosterStatus   = strVal_(row, rosterData.headers, "Employee Status");
        const rosterTermDate = strVal_(row, rosterData.headers, "Termination/Release Date");
        if (ROSTER_INACTIVE_RE.test(rosterStatus) || rosterTermDate) return;

        const rosterName     = strVal_(row, rosterData.headers, "Name");
        const rosterEmpNum   = strVal_(row, rosterData.headers, "Employee Number");
        const rosterDept     = strVal_(row, rosterData.headers, "Department");
        const rosterTitle    = strVal_(row, rosterData.headers, "Job Title");
        const rosterCategory = strVal_(row, rosterData.headers, "Job Profile Category");
        const rosterClass    = strVal_(row, rosterData.headers, "Class");
        const rosterLevel    = strVal_(row, rosterData.headers, "Level");
        const rosterSupervisor = strVal_(row, rosterData.headers, "Supervisor");
        const rosterRegion   = strVal_(row, rosterData.headers, "Key Location");

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
      const CREW_INACTIVE_RE = /terminat|job offer accepted|resign|left|inactive|former|offboard/i;
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

        emp.monthlyRCR    = getMonthlyValues_(row, rcrData.headers);
        emp.ytdRCR        = numVal_(row, rcrData.headers, CONFIG.COL_YTD);
        emp.lastMonthsRCR = safeLastMonths.map(m => ({
          month: m, value: numVal_(row, rcrData.headers, m),
        }));
        emp.trend    = computeTrend_(emp.monthlyRCR);
        emp.tierInfo = classifyRCR_(emp.ytdRCR, emp.jobLevel, false);
      });
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

        const qCols = [
          "Small Improvements Manager Rating FY25Q4",
          "Small Improvements Manager Rating FY26Q1",
          "Small Improvements Manager Rating FY26Q2",
          "Small Improvements Manager Rating FY26Q3",
        ];
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
        // Current ISO week → quarter week for required-comment threshold
        const today = new Date();
        const dM = new Date(today);
        dM.setHours(0, 0, 0, 0);
        dM.setDate(dM.getDate() + 3 - (dM.getDay() + 6) % 7);
        const jan4 = new Date(dM.getFullYear(), 0, 4);
        const isoWeekNow = 1 + Math.round(((dM - jan4) / 86400000 - 3 + (jan4.getDay() + 6) % 7) / 7);
        const quarterWeek = Math.max(1, isoWeekNow - CONFIG.Q4_BASE_ISO_WEEK + 1);
        const requiredComments = Math.max(1, quarterWeek - 4);

        // Build per-person goal map: normName → Map<goalId, { status, selfComments: Date[] }>
        const goalMap = new Map();
        rdGoalsData.rows.forEach(row => {
          const rocketeer = String(row[iRocketeer] || "").trim();
          if (!rocketeer) return;
          // Filter to configured fiscal quarter only
          if (iQuarter !== -1 && String(row[iQuarter] || "").trim() !== CONFIG.GOALS_QUARTER) return;

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
          const total     = goalIds.length;
          const completed = goalIds.filter(id => empGoals.get(id).status === "Completed").length;
          const inProg    = goalIds.filter(id => empGoals.get(id).status === "In Progress").length;
          const compliant = goalIds.filter(id => empGoals.get(id).selfComments.length >= requiredComments).length;
          const pct       = total > 0 ? Math.round((compliant / total) * 100) : null;

          // Count self-comments per week window by bucketing stored dates
          const weekComments = [0, 0, 0];
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
            ? (weekComments.reduce((a, b) => a + b, 0) / 3).toFixed(1)
            : "0";

          if (total < CONFIG.GOALS_MIN_COUNT) {
            emp.goalsNote = total > 0 ? `< ${CONFIG.GOALS_MIN_COUNT} goals (${total})` : "No Goals";
          } else if (completed < CONFIG.GOALS_COMPLETED_MIN) {
            emp.goalsNote = `${completed}/${total} completed — target ${CONFIG.GOALS_COMPLETED_MIN}`;
          } else {
            emp.goalsNote = `${compliant}/${total} goals w/ comments (req ≥${requiredComments})`;
          }

          const c = weekComments;
          emp.goalActivityTrend = c[2] > c[1] ? "Rising"
                                : c[2] < c[1] ? "Declining"
                                : c[0] === 0 && c[1] === 0 && c[2] === 0 ? "No Activity"
                                : "Stable";
        });
        Logger.log(`Goals join complete for ${goalMap.size} rocketeers`);
      }
    }

    // ── 7. Join Utilization hours (via Roster 'Resource' ↔ 'Name' match) ──
    // All hours in the contribution report come from the Utilization tab.
    if (utilMap) {
      let uMatched = 0, uUnmatched = 0;
      Logger.log("Joining Utilization hours data (total + client)...");
      utilMap.forEach((data, nameKey) => {
        const internalId = rosterNameToId.get(nameKey);
        if (!internalId) { uUnmatched++; Logger.log("  ⚠ Utilization unmatched: '" + nameKey + "'"); return; }
        uMatched++;
        const emp = employees.get(internalId);
        if (!emp) return;

        emp.weeklyClientHrs = data.client;  // [wk0, wk1, wk2]

        const total  = data.total;          // [wk0, wk1, wk2]
        const client = data.client;

        const lw = total[2] || 0;
        const pw = total[1] || 0;

        emp.lastWeekTotalHrs    = lw;
        emp.prevWeekTotalHrs    = pw;
        emp.lastWeekBillablePct = lw > 0 ? Math.round((client[2] / lw) * 100) : 0;
        emp.prevWeekBillablePct = pw > 0 ? Math.round((client[1] / pw) * 100) : 0;

        const totalHrsAcross  = total.reduce((s, h) => s + h, 0);
        const clientHrsAcross = client.reduce((s, h) => s + h, 0);
        emp.avgTotalHrs    = totalHrsAcross / total.length;
        emp.avgBillablePct = totalHrsAcross > 0 ? Math.round((clientHrsAcross / totalHrsAcross) * 100) : 0;
      });
      Logger.log("Utilization join: " + uMatched + " matched, " + uUnmatched + " unmatched");
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
  const rcr = emp.ytdRCR;
  const si  = emp.latestSI;
  const eng = emp.goalEngagementPct;
  const lvl = String(emp.jobLevel || "").toUpperCase();
  const lwBPct = emp.lastWeekBillablePct;
  const pwBPct = emp.prevWeekBillablePct;
  const lwHrs  = emp.lastWeekTotalHrs;
  
  const cluster = getJobCluster_(emp);

  // ── G&A / Non-Contributor Specific Signals ──────────────
  if (emp.isInternalGA) {
    if (eng !== null && eng < 40) signals.push(`CRITICAL: Low goal engagement (${eng}%)`);
    if (si !== null && si <= 2)   signals.push(`SI Score: ${CONFIG.SI_LABELS[si] || si}`);
    if (emp.goalAvgCommentsPerWeek !== null && emp.goalAvgCommentsPerWeek < 0.5) {
      signals.push(`Low goal activity: ${emp.goalAvgCommentsPerWeek} avg comments/wk`);
    }
    if (emp.goalActivityTrend === "Declining") signals.push("Declining goal engagement trend");
    const ch = emp.weeklyClientHrs || [0, 0, 0];
    if (ch.every(h => h <= 0)) signals.push("⚠ No client time logged (L3W)");
    return signals.length ? signals.join("  ·  ") : "Consistent G&A engagement";
  }

  // ── Indirect / Strategy Roles (Management & PM) ──────────
  if (cluster.includes("Management") || cluster.includes("Project Management")) {
    signals.push(`${cluster.split(". ")[1]} Profile — RCR secondary to enablement`);
    if (lwBPct !== null && lwBPct > 50) signals.push(`High billable for indirect role (${lwBPct}%)`);
    if (rcr !== null && rcr > 2.0) signals.push("Strong revenue contribution for leadership role");
    return signals.join("  ·  ");
  }

  // ── Contractor Specifics ─────────────────────────────────
  if (cluster.includes("Contractors")) {
    if (lwHrs !== null && lwHrs > 0 && lwHrs < 30) signals.push(`Low weekly hours for contractor: ${lwHrs.toFixed(1)}`);
    if (lwBPct !== null && lwBPct < 75) signals.push(`Utilization below target (${lwBPct}%)`);
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

  // ── WoW Changes ──────────────────────────────────────────
  if (lwBPct !== null && pwBPct !== null) {
    const delta = lwBPct - pwBPct;
    if (delta <= -15) signals.push(`Significant WoW Billable Drop: ${delta}%`);
    if (delta >= 15)  signals.push(`Significant WoW Billable Gain: +${delta}%`);
  }

  // ── Activity & Engagement ────────────────────────────────
  if (!isBlackAndWhite && lwHrs !== null && lwHrs > 0) {
    if (lwHrs < 30) signals.push(`Low weekly activity: ${lwHrs.toFixed(1)} hrs`);
    if (lwBPct !== null && lwBPct < 40) signals.push(`Low billable engagement (${lwBPct}%)`);
  }

  // ── Client Time Logging ──────────────────────────────────
  const ch = emp.weeklyClientHrs || [0, 0, 0];
  const zeroWeeks = ch.filter(h => h <= 0).length;
  if (zeroWeeks === 3) {
    signals.push("⚠ No client time logged (L3W)");
  } else if (zeroWeeks >= 2) {
    signals.push("Low client time logging (" + (3 - zeroWeeks) + "/3 weeks)");
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
function buildDimensionSummary_(empList, field) {
  const groups = new Map();
  empList.forEach(emp => {
    const key = emp[field] || "(Unassigned)";
    if (!groups.has(key)) {
      groups.set(key, { label: key, count: 0, sumRev: 0, sumTCC: 0,
                        critical: 0, watch: 0, healthy: 0, champion: 0,
                        sumGoal: 0, cntGoal: 0, sumSI: 0, cntSI: 0 });
    }
    const g = groups.get(key);
    g.count++;
    
    // Weighted Average components
    g.sumRev += (emp.ytdRevenue || 0);
    g.sumTCC += (emp.ytdTCC || 0);

    if (emp.ytdRCR !== null) {
      if      (emp.ytdRCR <= CONFIG.RCR_CRITICAL) g.critical++;
      else if (emp.ytdRCR <= CONFIG.RCR_WATCH)    g.watch++;
      else if (emp.ytdRCR <= CONFIG.RCR_HEALTHY)  g.healthy++;
      else                                         g.champion++;
    }
    if (emp.goalEngagementPct !== null) { g.sumGoal += emp.goalEngagementPct; g.cntGoal++; }
    if (emp.avgSI !== null)             { g.sumSI   += emp.avgSI;             g.cntSI++;   }
  });
  return Array.from(groups.values()).map(g => ({
    ...g,
    avgRCR:  g.sumTCC > 0 ? g.sumRev / g.sumTCC : null,
    avgGoal: g.cntGoal > 0 ? Math.round(g.sumGoal / g.cntGoal) : null,
    avgSI:   g.cntSI  > 0 ? (g.sumSI  / g.cntSI).toFixed(1)   : "—",
  })).sort((a, b) => (a.avgRCR ?? 999) - (b.avgRCR ?? 999));
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
function writeBanner_(sh, row, lastMonths, isNonContrib, totalCols) {
  const ts           = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM dd, yyyy  HH:mm");
  const windowLabel  = (lastMonths && lastMonths.length) ? lastMonths.join("  ·  ") : "—";
  const cols         = totalCols || sh.getLastColumn() || TOTAL_COLS;

  const title = isNonContrib ? "NON-CONTRIBUTOR INTELLIGENCE ENGINE" : "CONTRIBUTOR INTELLIGENCE ENGINE";

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
    ? `Generated: ${ts}     ·     Focus: Goal Engagement & Development Engagement`
    : `Generated: ${ts}     ·     Trend window: ${windowLabel} + YTD` +
      `     ·     Tiers:  ≤ 1.0  Critical    1.01–2.0  Watch    2.01–3.0  Healthy    > 3.0  Champion`;

  const legend = isNonContrib
    ? `     ·     Client Hrs: Utilization client time per evaluated week     Avg Comments/Wk: Goal activity intensity     *Goal Engage: (In Progress + Done) / Total`
    : `     ·     RCR: Revenue/Cost     Client Hrs: Utilization client time per evaluated week     *Goal Engage: (In Progress + Done) / Total     Note: Critical w/ Short Tenure (FTE <= 4mo, Contractor <= 1mo) = High Onboarding Risk`;

  subText += legend;

  sh.getRange(row, 1, 1, cols)
    .merge()
    .setValue(subText)
    .setBackground(EXEC.SUBBAR_BG)
    .setFontColor(EXEC.SUBBAR_TEXT)
    .setFontSize(8)
    .setFontFamily("Arial")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sh.setRowHeight(row, 20);
  return row + 1;
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

    const ch = emp.weeklyClientHrs || [0, 0, 0];

    const wc = emp.goalMonthlyComments || [0, 0, 0];

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
      fmt_(emp.ytdRCR),                                                    // 9
      m[0], m[1], m[2],                                                    // 10-12
      emp.goalEngagementPct !== null ? `${emp.goalEngagementPct}%` : "—", // 13
      wc[0], wc[1], wc[2],                                                 // 14-16: Wk-2, Wk-1, LW comments
      emp.kudosL3W || 0,                                                   // 17
      siScore,                                                             // 18
      ch[0] > 0 ? ch[0].toFixed(1) : "0",                                 // 19
      ch[1] > 0 ? ch[1].toFixed(1) : "0",                                 // 20
      ch[2] > 0 ? ch[2].toFixed(1) : "0",                                 // 21
      emp.jiraEpicCounts[2] || 0,                                          // 22
      emp.jiraEpicCounts[1] || 0,                                          // 23
      emp.jiraEpicCounts[0] || 0,                                          // 24
    ]);

    const rcrFg = emp.ytdRCR !== null && emp.ytdRCR <= CONFIG.RCR_CRITICAL ? EXEC.FG_CRITICAL
                : emp.ytdRCR !== null && emp.ytdRCR <= CONFIG.RCR_WATCH    ? EXEC.FG_WATCH
                : null;

    fontColors.push([
      null, null, null,                          // 0-2: ID, EmpNum, Name
      null, null, null, null, null, null,        // 3-8: JobTitle-Tenure
      rcrFg,                                     // 9: YTD RCR
      null, null, null,                          // 10-12: M-2, M-1, M0 RCR
      null,                                      // 13: Goal Engage
      null, null, null,                          // 14-16: Wk-2, Wk-1, LW comments
      null,                                      // 17: Kudos
      null,                                      // 18: SI Score
      ch[0] <= 0 ? EXEC.TC_RED : null,           // 19: Logged Wk-2
      ch[1] <= 0 ? EXEC.TC_RED : null,           // 20: Logged Wk-1
      ch[2] <= 0 ? EXEC.TC_RED : null,           // 21: Logged LW
      null, null, null,                          // 22-24: Jira
    ]);

    tierInfos.push(emp.tierInfo);
  });
  return { rows, fontColors, tierInfos };
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
    "YTD RCR",
    (lastMonths[0] || "M−2") + " RCR", (lastMonths[1] || "M−1") + " RCR", (lastMonths[2] || "Latest") + " RCR",
    "Goal Engage (%)",
    (weeks[0] ? weeks[0].label : "Wk-2") + " Comments",
    (weeks[1] ? weeks[1].label : "Wk-1") + " Comments",
    (weeks[2] ? weeks[2].label : "LW")   + " Comments",
    "Kudos",
    "SI Score",
    "Logged Time " + (weeks[0] ? weeks[0].label : "Wk-2"),
    "Logged Time " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Logged Time " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Jira Backlog " + (weeks[0] ? weeks[0].label : "Wk-2"),
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

  const { rows, fontColors } = empsToRows_(emps, lastMonths);
  writeData_(sh, row, rows, fontColors);
  return spacer_(row + rows.length);
}

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
    "Goal Engage (%)",
    (weeks[0] ? weeks[0].label : "Wk-2") + " Comments",
    (weeks[1] ? weeks[1].label : "Wk-1") + " Comments",
    (weeks[2] ? weeks[2].label : "LW")   + " Comments",
    "Avg Comments/Wk", "Kudos",
    "SI Score",
    "Logged Time " + (weeks[0] ? weeks[0].label : "Wk-2"),
    "Logged Time " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Logged Time " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Jira Backlog " + (weeks[0] ? weeks[0].label : "Wk-2"),
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

    const ch = emp.weeklyClientHrs || [0, 0, 0];
    const wc = emp.goalMonthlyComments || [0, 0, 0];

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
      wc[0], wc[1], wc[2],                                                 // 11-13
      emp.goalAvgCommentsPerWeek,                                          // 14
      emp.kudosL3W || 0,                                                   // 15
      siScore,                                                             // 16
      ch[0] > 0 ? ch[0].toFixed(1) : "0",                                 // 17
      ch[1] > 0 ? ch[1].toFixed(1) : "0",                                 // 18
      ch[2] > 0 ? ch[2].toFixed(1) : "0",                                 // 19
      emp.jiraEpicCounts[2] || 0,                                          // 20
      emp.jiraEpicCounts[1] || 0,                                          // 21
      emp.jiraEpicCounts[0] || 0,                                          // 22
    ]);

    fontColors.push([
      null, null, null, null, null, null, null, null, null, null, // 0-9
      null,                                      // 10: Goal Engage
      null, null, null, null,                    // 11-14: comments + avg
      null,                                      // 15: Kudos
      null,                                      // 16: SI Score
      ch[0] <= 0 ? EXEC.TC_RED : null,           // 17
      ch[1] <= 0 ? EXEC.TC_RED : null,           // 18
      ch[2] <= 0 ? EXEC.TC_RED : null,           // 19
      null, null, null,                          // 20-22: Jira
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
    "YTD RCR",
    (lastMonths[0] || "M−2") + " RCR", (lastMonths[1] || "M−1") + " RCR", (lastMonths[2] || "Latest") + " RCR",
    "Kudos",
    "Logged Time " + (weeks[0] ? weeks[0].label : "Wk-2"),
    "Logged Time " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Logged Time " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[2] ? weeks[2].label : "LW"),
    "Jira Backlog " + (weeks[1] ? weeks[1].label : "Wk-1"),
    "Jira Backlog " + (weeks[0] ? weeks[0].label : "Wk-2"),
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

    const ch = emp.weeklyClientHrs || [0, 0, 0];

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
      ch[0] > 0 ? ch[0].toFixed(1) : "0",                        // 12
      ch[1] > 0 ? ch[1].toFixed(1) : "0",                        // 13
      ch[2] > 0 ? ch[2].toFixed(1) : "0",                        // 14
      emp.jiraEpicCounts[2] || 0,                                 // 15
      emp.jiraEpicCounts[1] || 0,                                 // 16
      emp.jiraEpicCounts[0] || 0,                                 // 17
    ]);

    const rcrFg = emp.ytdRCR !== null && emp.ytdRCR <= CONFIG.RCR_CRITICAL ? EXEC.FG_CRITICAL
                : emp.ytdRCR !== null && emp.ytdRCR <= CONFIG.RCR_WATCH    ? EXEC.FG_WATCH
                : null;

    fontColors.push([
      null, null, null, null, null, null, null, // 0-6
      rcrFg,                                    // 7: YTD RCR
      null, null, null,                         // 8-10: M-2, M-1, M0 RCR
      null,                                     // 11: Kudos
      ch[0] <= 0 ? EXEC.TC_RED : null,         // 12
      ch[1] <= 0 ? EXEC.TC_RED : null,         // 13
      ch[2] <= 0 ? EXEC.TC_RED : null,         // 14
      null, null, null,                         // 15-17: Jira
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
function writeJobClusterSummary_(sh, row, empList, label) {
  const groups = new Map();
  empList.forEach(emp => {
    const key = getJobCluster_(emp);
    if (!groups.has(key)) {
      groups.set(key, { label: key, count: 0, sumRev: 0, sumTCC: 0,
                        critical: 0, watch: 0, healthy: 0, champion: 0,
                        sumGoal: 0, cntGoal: 0, sumSI: 0, cntSI: 0 });
    }
    const g = groups.get(key);
    g.count++;
    g.sumRev += (emp.ytdRevenue || 0);
    g.sumTCC += (emp.ytdTCC || 0);
    if (emp.ytdRCR !== null) {
      if      (emp.ytdRCR <= CONFIG.RCR_CRITICAL) g.critical++;
      else if (emp.ytdRCR <= CONFIG.RCR_WATCH)    g.watch++;
      else if (emp.ytdRCR <= CONFIG.RCR_HEALTHY)  g.healthy++;
      else                                         g.champion++;
    }
    if (emp.goalEngagementPct !== null) { g.sumGoal += emp.goalEngagementPct; g.cntGoal++; }
    if (emp.avgSI !== null)             { g.sumSI   += emp.avgSI;             g.cntSI++;   }
  });

  const summary = Array.from(groups.values()).map(g => ({
    ...g,
    avgRCR:  g.sumTCC > 0 ? g.sumRev / g.sumTCC : null,
    avgGoal: g.cntGoal > 0 ? Math.round(g.sumGoal / g.cntGoal) : null,
    avgSI:   g.cntSI  > 0 ? (g.sumSI  / g.cntSI).toFixed(1)   : "—",
  })).sort((a, b) => a.label.localeCompare(b.label));

  const COLS = [
    "Job Profile Cluster","Headcount","Avg YTD RCR",
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
      { id: "grey",  label: "Grey Zone (High Activity, Low RCR)",  count: 0, color: EXEC.TC_AMBER, desc: "Working full hours but not producing billable/attributed revenue." },
      { id: "low_b", label: "Low Billable Engagement (< 40%)",     count: 0, color: EXEC.TC_AMBER, desc: "High non-billable time relative to role benchmarks." },
      { id: "wow_d", label: "Significant WoW Billable Drop",       count: 0, color: EXEC.TC_AMBER, desc: "Week-over-week drop in billable percentage > 15%." }
    ],
    "Engagement & Trajectory": [
      { id: "low_h", label: "Low Weekly Activity (< 30 hrs)",      count: 0, color: EXEC.TEXT_MID, desc: "Potential burnout or missing time-tracking compliance." },
      { id: "low_g", label: "Low Goal Engagement (< 40%)",         count: 0, color: EXEC.TEXT_MID, desc: "Low commitment to OKRs/Career development goals." },
      { id: "dec",   label: "Declining RCR Trajectory",            count: 0, color: EXEC.TC_AMBER, desc: "RCR has decreased relative to the previous 3-month average." }
    ],
    "Positive Signals": [
      { id: "high_b",label: "High Billable (Management/PM)",       count: 0, color: EXEC.TC_GREEN, desc: "Indirect roles contributing significant billable hours." },
      { id: "wow_g", label: "Significant WoW Billable Gain",       count: 0, color: EXEC.TC_GREEN, desc: "Week-over-week growth in billable percentage > 15%." }
    ]
  };

  // ── Logic: Re-run signal logic for counts ─────────────────
  allEmps.forEach(emp => {
    // Skip employees with no RCR data or Non-Contributor tier
    if (emp.tierInfo && (emp.tierInfo.tier === "No Data" || emp.tierInfo.tier === "Non-Contributor")) return;

    const rcr = emp.ytdRCR;
    const lwBPct = emp.lastWeekBillablePct;
    const pwBPct = emp.prevWeekBillablePct;
    const lwHrs = emp.lastWeekTotalHrs;
    const cluster = getJobCluster_(emp);
    const isIndirect = cluster.includes("Management") || cluster.includes("Project Management");
    const delta = (lwBPct !== null && pwBPct !== null) ? (lwBPct - pwBPct) : 0;

    // Output Risks
    if ((rcr === null || rcr <= 0) && (lwHrs === null || lwHrs <= 0)) signalMap["Output & Revenue Risks"][0].count++;
    if (emp.trend === "Sustained Low") signalMap["Output & Revenue Risks"][1].count++;
    if (rcr !== null && rcr <= CONFIG.RCR_CRITICAL) signalMap["Output & Revenue Risks"][2].count++;

    // Efficiency
    if (rcr !== null && rcr <= CONFIG.RCR_CRITICAL && lwHrs >= 35) signalMap["Efficiency & Activity"][0].count++;
    if (lwBPct !== null && lwBPct < 40 && !isIndirect) signalMap["Efficiency & Activity"][1].count++;
    if (delta <= -15) signalMap["Efficiency & Activity"][2].count++;

    // Engagement
    if (lwHrs !== null && lwHrs > 0 && lwHrs < 30) signalMap["Engagement & Trajectory"][0].count++;
    if (emp.goalEngagementPct !== null && emp.goalEngagementPct < 40) signalMap["Engagement & Trajectory"][1].count++;
    if (emp.trend === "Declining") signalMap["Engagement & Trajectory"][2].count++;

    // Positive
    if (isIndirect && lwBPct !== null && lwBPct > 50) signalMap["Positive Signals"][0].count++;
    if (delta >= 15) signalMap["Positive Signals"][1].count++;
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
function writeDimSummary_(sh, row, empList, field, label) {
  const summary = buildDimensionSummary_(empList, field);
  const COLS = [
    "Group","Headcount","Avg YTD RCR",
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

/**
 * Main entry point. Run from Apps Script editor or the custom menu.
 */
function runContributorIntelligence() {
  Logger.log(`▶ [runContributorIntelligence] Started at ${new Date().toISOString()}`);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    Logger.log("📂 Loading source sheets...");
    const rcrData   = loadSheet_(ss, CONFIG.SHEET_RCR);
    const rcData    = loadSheet_(ss, CONFIG.SHEET_RC);
    const tccData   = loadSheet_(ss, CONFIG.SHEET_TCC);
    const siData    = loadSheet_(ss, CONFIG.SHEET_SI);
    Logger.log("📂 Loading Goals from external RD sheet...");
    const rdGoalsData = loadGoalsRD_();
    Logger.log("📂 Loading Roster from external spreadsheet...");
    const rosterData = loadRosterSheet_();

    Logger.log("📂 Loading ExclusivityContracts...");
    const exclusivitySet = loadExclusivitySet_();

    Logger.log("📂 Loading Delivery Managers...");
    const deliveryMgrSet = loadNameSet_(CONFIG.SHEET_DELIVERY_MGRS, "Delivery Managers");

    const lastMonths = detectLastClosedMonths_(rcrData);
    Logger.log(`   → Trend window: ${lastMonths.join(", ")}`);

    Logger.log("📂 Calculating weekly windows...");
    const weeks = getLastNCompletedWeeks_(3);

    Logger.log("📂 Loading Kudos data...");
    const kudosMap = getKudosData_(ss, weeks);

    const jiraReportMap = getJiraCountsFromRaw_(ss, weeks);
    Logger.log("Jira weekly counts derived from Raw for " + (jiraReportMap ? jiraReportMap.size : 0) + " assignees");

    Logger.log("📂 Loading Utilization hours (total + client, last 3 weeks)...");
    const utilMap = getUtilizationHrs_(ss, weeks);
    Logger.log("Found " + utilMap.size + " resources with Utilization hours");

    Logger.log("📂 Loading Contractors Data (Crew Members)...");
    const contractorData = loadContractorsSheet_();

    Logger.log("Building employee records...");
    const empMap = buildEmployeeMap_(siData, rcrData, rdGoalsData, rcData, tccData, jiraReportMap, lastMonths, rosterData, utilMap, exclusivitySet, deliveryMgrSet, kudosMap, weeks, contractorData);
    Logger.log("Employee map built successfully");

    Logger.log("📝 Writing contributor intelligence sheet...");
    // 25 cols: ID, EmpNum, Name, JobTitle, Level, ContribType, Supervisor, Region, Tenure, YTD RCR,
    //          M-2 RCR, M-1 RCR, Latest RCR, Goal Engage,
    //          Wk-2 Comments, Wk-1 Comments, LW Comments, Kudos, SI Score,
    //          Logged Wk-2, Logged Wk-1, Logged LW, Jira LW, Jira Wk-1, Jira Wk-2
    const contribWidths = [100, 100, 145, 180, 50, 145, 145, 115, 52, 65, 62, 62, 72, 75, 65, 65, 65, 55, 75, 70, 70, 70, 60, 60, 60];
    const sh = prepareOutputSheet_(ss, CONFIG.SHEET_OUTPUT, contribWidths);
    
    // Active-only pool — all three output sheets draw from this.
    // Crew members are already pre-filtered in buildEmployeeMap_ (only active rows seeded).
    const INACTIVE_STATUS_RE = /terminat|resign|left|inactive|former|offboard/i;
    const all = Array.from(empMap.values()).filter(e =>
      !INACTIVE_STATUS_RE.test(String(e.empStatus || ""))
    );

    // ── Calculate Critical Satellites (Team Risk) ──────────
    // A satellite is a subordinate with low RCR, low goal engagement, < 10 hours, and a poor trend
    const isSatellite = (e) => 
      (e.ytdRCR !== null && e.ytdRCR <= CONFIG.RCR_CRITICAL) &&
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

    let row = 1;

    // ── 1. CONTRIBUTOR SHEET ───────────────────────────────────
    row = writeBanner_(sh, row, lastMonths, false, contribWidths.length);
    row = spacer_(row);

    // ── Main Contributor Table ─────────────────────────────
    const critSorted  = contributors.filter(e => e.ytdRCR !== null && e.ytdRCR <= CONFIG.RCR_CRITICAL).sort((a, b) => a.ytdRCR - b.ytdRCR);
    const watchSorted = contributors.filter(e => e.ytdRCR !== null && e.ytdRCR > CONFIG.RCR_CRITICAL && e.ytdRCR <= CONFIG.RCR_WATCH).sort((a, b) => a.ytdRCR - b.ytdRCR);
    const healthSorted = contributors.filter(e => e.ytdRCR !== null && e.ytdRCR > CONFIG.RCR_WATCH && e.ytdRCR <= CONFIG.RCR_HEALTHY).sort((a, b) => b.ytdRCR - a.ytdRCR);
    const champSorted = contributors.filter(e => e.ytdRCR !== null && e.ytdRCR > CONFIG.RCR_HEALTHY).sort((a, b) => b.ytdRCR - a.ytdRCR);
    const ndList      = contributors.filter(e => e.ytdRCR === null);

    const mainList = [].concat(critSorted, watchSorted, healthSorted, champSorted, ndList);
    row = writeMainTable_(sh, row, mainList, lastMonths, weeks);

    // ── Dimension Summaries ───────────────────────────────
    row = writeJobClusterSummary_(sh, row, contributors, "JOB PROFILE CLUSTERING (ABC Strategy)");
    row = writeDimSummary_(sh, row, contributors, "supervisor",  "SUPERVISOR SUMMARY");
    row = writeDimSummary_(sh, row, contributors, "region",      "RESOURCE REGION SUMMARY");

    // Freeze top 3 rows
    sh.setFrozenRows(5);

    // ── 2. NON-CONTRIBUTOR SHEET ───────────────────────────────
    Logger.log("📝 Writing non-contributor intelligence sheet...");
    // 23 cols: ID, EmpNum, Name, Dept, JobTitle, Level, ContribType, Supervisor, Region, Tenure,
    //          Goal Engage, Wk-2 Comments, Wk-1 Comments, LW Comments, Avg Comments/Wk, Kudos,
    //          SI Score, Logged Wk-2, Logged Wk-1, Logged LW, Jira LW, Jira Wk-1, Jira Wk-2
    const nonContribWidths = [100, 100, 145, 120, 180, 50, 145, 115, 115, 52, 80, 65, 65, 65, 90, 55, 100, 70, 70, 70, 60, 60, 60];
    const shNC = prepareOutputSheet_(ss, CONFIG.SHEET_OUTPUT_NON_CONTRIB, nonContribWidths);
    
    let rowNC = 1;
    rowNC = writeBanner_(shNC, rowNC, null, true, nonContribWidths.length);
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

    rowNC = writeDimSummary_(shNC, rowNC, nonContributors, "supervisor",  "SUPERVISOR SUMMARY (Non-Contributors)");

    shNC.setFrozenRows(3);
    
    // ── 3. CREW MEMBER SHEET ───────────────────────────────────
    Logger.log("📝 Writing crew member intelligence sheet...");
    // 19 cols: ID, Name, Dept, JobTitle, ContribType, Supervisor, Region, Tenure, YTD RCR,
    //          M-2 RCR, M-1 RCR, Latest RCR, Kudos,
    //          Logged Wk-2, Logged Wk-1, Logged LW, Jira LW, Jira Wk-1, Jira Wk-2
    const crewWidths = [100, 145, 120, 180, 145, 115, 52, 65, 62, 62, 72, 55, 65, 65, 60, 60, 60, 60];
    const shCrew = prepareOutputSheet_(ss, CONFIG.SHEET_OUTPUT_CREW, crewWidths);
    
    let rowCrew = 1;
    rowCrew = writeBanner_(shCrew, rowCrew, lastMonths, false, crewWidths.length);
    rowCrew = spacer_(rowCrew);

    const crewSorted = crewMembers.sort((a, b) => (b.ytdRCR || 0) - (a.ytdRCR || 0));
    rowCrew = writeCrewTable_(shCrew, rowCrew, crewSorted, lastMonths, weeks);
    
    shCrew.setFrozenRows(5);

    ss.setActiveSheet(sh); // Set focus back to main sheet
    Logger.log(`✅ [runContributorIntelligence] Done. Contributor rows: ${row}, Non-Contributor rows: ${rowNC}, Crew rows: ${rowCrew}`);


  } catch (e) {
    Logger.log("❌ [runContributorIntelligence] " + e.message);
  }
}

/**
 * Installs the custom spreadsheet menu on open.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🚀 Contributor Intelligence")
    .addItem("▶  Run Full Analysis", "runContributorIntelligence")
    .addSeparator()
    .addItem("ℹ️  About", "showAbout_")
    .addToUi();
}

/** About dialog. */
function showAbout_() {
  SpreadsheetApp.getUi().alert(
    `${CONFIG.SCRIPT_LABEL}  v2.0.0\n\n` +
    `Executive RCR signal analysis with goal engagement and SI\n` +
    `manager score correlation.\n\nABC Framework — ServiceRocket.`
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