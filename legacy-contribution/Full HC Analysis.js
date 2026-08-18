// ============================================================
// SCRIPT: Full HC Analysis — Headcount Contribution Intelligence
// ENV:    Google Apps Script
// DEPS:   Hours Analysis.js (shared global scope)
//         Tempo Backlog WoW Summary.js (tbReadTempoLoggedRows_ pattern)
// ============================================================

// ── MODULE CONFIG ───────────────────────────────────────────
const FHC_CONFIG = {
  OUTPUT_SHEET: "Full HC Analysis",
  SHRINKAGE_PCT: 0.15,              // Global 15% shrinkage on capacity
  WEEKLY_CAPACITY_DEFAULT: 40,      // Fallback when Capacity sheet has no entry
  FOCUS_JOB_FAMILIES: ["Managed Services & Support", "Service Delivery", "Solution Architecture", "Operations"],
  
  // ── CONTRIBUTOR FILTER CONFIG ──────────────────────────────
  // Focus on these roles, excluding M4-M12 management.
  CONTRIBUTOR_POOL: {
    JF_MAPPING: {
      "Managed Services & Support": "Services",
      "Service Delivery": "Services"
    },
    // Exclude these levels from the contributor pool (M4 to M12)
    EXCLUDE_LEVELS: ["M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"],

    // Profiles to capture within families
    SPECIALTIES: {
      "Managed Services & Support": ["Customer Support", "Consultant Delivery", "Delivery"],
      "Service Delivery": ["Technical Consulting", "Service Delivery", "Consulting"]
    }
  },

  MANAGER_PATTERN: /\.M\d/i,        // Detects M-levels: "07.M5.1 - ..."
  IC_PATTERN: /\.I\d/i,             // Detects I-levels: "07.I3.4 - ..."
  N_COLS: 12,                       // Max output columns

  // Severity thresholds for FNHC signals
  THRESHOLDS: {
    // Signal 1: Delivered Contribution — match rate %
    S1: { CRITICAL: 50, WARNING: 75, INFO: 90 },
    // Signal 2: Tracked vs Billed Gap — gap % (inverted: higher = worse)
    S2: { CRITICAL: 30, WARNING: 15, INFO: 5 },
    // Signal 3: Backlog-to-Contribution Coverage %
    S3: { CRITICAL: 40, WARNING: 60, INFO: 80 },
    // Company utilization %
    UTIL: { CRITICAL: 70, WARNING: 80, INFO: 90 },
  },

  // ── CONTRIBUTION INTELLIGENCE FRAMEWORK ───────────────────
  FRAMEWORK: {
    S1: {
      question: "Are we capturing the value of our delivery?",
      impact: "Revenue Leakage: Shadow resolutions (work done but not billed) directly reduce margin and distort productivity metrics. Unmatched items represent work that the billing system doesn't 'know' happened.",
      actions: {
        CRITICAL: "IMMEDIATE AUDIT: High volume of shadow work. Review project billing setups and time entry compliance.",
        WARNING: "TARGETED REVIEW: Identify specific accounts where work is slipping through the billing pipeline.",
        HEALTHY: "MONITOR: Strong alignment between resolution and revenue capture."
      }
    },
    S2: {
      question: "Is tracked effort reaching the billing pipeline?",
      impact: "Administrative Leakage: Gaps between tracked (Tempo) and billed (NetSuite) hours indicate administrative overhead, unbillable internal effort, or missing time entries.",
      actions: {
        CRITICAL: "MANAGEMENT DIRECTIVE: Significant loss of billable potential. Enforce 24h logging policy and audit unbillable buckets.",
        WARNING: "TEAM TRAINING: Reinforce 'What counts as billable' vs 'Internal' time categories.",
        HEALTHY: "HYPER-ALIGNMENT: Exceptional effort-to-billing ratio."
      }
    },
    S3: {
      question: "Is effort focused on documented priorities?",
      impact: "Priority Drift: Low coverage means team members are working on items not tracked in the backlog, creating 'dark work' that isn't visible to planning or capacity models.",
      actions: {
        CRITICAL: "BACKLOG HYGIENE: Urgent cleanup of Jira boards. Stop all 'off-backlog' work until captured in the system.",
        WARNING: "PLANNING SYNC: Align weekly tasks with Jira tickets. Ensure all effort has a corresponding ticket.",
        HEALTHY: "STRATEGIC FOCUS: Effort is highly aligned with documented commitments."
      }
    }
  }
};


// ═════════════════════════════════════════════════════════════
//  CLASSIFIERS & UTILITIES
// ═════════════════════════════════════════════════════════════

/**
 * Parse Job Family from Job Title.
 * "07.I3.4 - Representative, Account Management" → "Managed Services & Support"
 */
function fhcParseJobFamily_(jobTitle) {
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
 * Classify profile type from Job Title and Level.
 * Returns "IC" | "Manager" | "Crew Member"
 */
function fhcParseProfileType_(jobTitle, level) {
  const titleUpper = String(jobTitle || "").toUpperCase();
  const levelUpper = String(level || "").toUpperCase();
  if (titleUpper.includes("CREW MEMBER") || levelUpper.includes("CREW")) return "Crew Member";
  if (FHC_CONFIG.MANAGER_PATTERN.test(jobTitle)) return "Manager";
  if (FHC_CONFIG.IC_PATTERN.test(jobTitle)) return "IC";
  // Fallback: check level string
  if (/M\d/i.test(level)) return "Manager";
  if (/[LI]\d/i.test(level)) return "IC";
  return "IC"; // default to IC if uncertain
}

/**
 * Parse the IC or Manager level number from a Job Title or Level field.
 * "07.I3.4 - ..." → "I3", "07.M5.1 - ..." → "M5", "L4" → "L4"
 */
function fhcParseLevel_(jobTitle, level) {
  // Try from Job Title first (more structured)
  const titleMatch = String(jobTitle || "").match(/\.([IM])(\d+)/i);
  if (titleMatch) return titleMatch[1].toUpperCase() + titleMatch[2];
  // Fallback to Level field
  const levelMatch = String(level || "").toUpperCase().match(/[LIM]\d+/);
  if (levelMatch) return levelMatch[0];
  return String(level || "").trim() || "—";
}

/**
 * Identify specialty/segment from Job Title.
 */
function fhcParseSpecialty_(jobTitle, jobFamily) {
  const title = String(jobTitle || "").toLowerCase();
  const specs = FHC_CONFIG.CONTRIBUTOR_POOL.SPECIALTIES[jobFamily] || [];
  
  for (const s of specs) {
    if (title.includes(s.toLowerCase())) return s;
  }
  
  // Fallback patterns
  if (title.includes("project manage")) return "Project Management";
  if (title.includes("solution arch")) return "Solution Architecture";
  if (title.includes("customer support")) return "Customer Support";
  
  return "General";
}

/**
 * Classify severity from a metric value against thresholds.
 * @param {number} value - The metric value
 * @param {{CRITICAL:number, WARNING:number, INFO:number}} t - Thresholds
 * @param {boolean} invert - true when higher is worse (e.g., gap %)
 */
function fhcClassifySeverity_(value, t, invert) {
  if (invert) {
    if (value >= t.CRITICAL) return { level: "CRITICAL", icon: "\uD83D\uDD34", bg: "#F4CCCC" };
    if (value >= t.WARNING)  return { level: "WARNING",  icon: "\uD83D\uDFE0", bg: "#FFE0B2" };
    if (value >= t.INFO)     return { level: "INFO",     icon: "\uD83D\uDFE1", bg: "#FFF9C4" };
    return { level: "HEALTHY", icon: "\uD83D\uDFE2", bg: "#B7E1CD" };
  }
  if (value < t.CRITICAL) return { level: "CRITICAL", icon: "\uD83D\uDD34", bg: "#F4CCCC" };
  if (value < t.WARNING)  return { level: "WARNING",  icon: "\uD83D\uDFE0", bg: "#FFE0B2" };
  if (value < t.INFO)     return { level: "INFO",     icon: "\uD83D\uDFE1", bg: "#FFF9C4" };
  return { level: "HEALTHY", icon: "\uD83D\uDFE2", bg: "#B7E1CD" };
}

/** Apply shrinkage to capacity hours. */
function fhcShrinkCap_(hours) {
  return hours * (1 - FHC_CONFIG.SHRINKAGE_PCT);
}

/** Compute utilization: logged / available_after_shrinkage * 100. */
function fhcUtil_(logged, available) {
  if (!available || available <= 0) return 0;
  return (logged / available) * 100;
}

/** Format number to 1 decimal. */
function fhcFmt1_(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(1);
}

/** Format percentage to 1 decimal. */
function fhcFmtPct_(v) {
  if (v == null || isNaN(v)) return "—";
  return Number(v).toFixed(1) + "%";
}

/** Concentration analysis helper: given an array of {key, count}, return top-N analysis. */
function fhcConcentrationAnalysis_(items, totalGaps) {
  if (!items.length || totalGaps === 0) return { isConcentrated: false, top3Pct: 0, top: [] };
  items.sort((a, b) => b.count - a.count);
  const top3 = items.slice(0, 3);
  const top3Sum = top3.reduce((s, x) => s + x.count, 0);
  const top3Pct = (top3Sum / totalGaps) * 100;
  return {
    isConcentrated: top3Pct > 60,
    top3Pct,
    top: top3.map(x => ({ key: x.key, count: x.count, pct: (x.count / totalGaps) * 100 })),
  };
}


// ═════════════════════════════════════════════════════════════
//  DATA READERS
// ═════════════════════════════════════════════════════════════

/**
 * Read ALL roster rows (no TARGET_PREFIXES filter).
 * Returns Map<name, { level, jobTitle, team, dept, profileType, jobFamily, isFocus }>
 */
let _fhcRosterCache_ = null;

function fhcReadFullRoster_() {
  if (_fhcRosterCache_) return _fhcRosterCache_;

  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ROSTER_SHEET);
  if (!sh) { Logger.log("[FHC] Roster sheet not found."); return new Map(); }

  const raw = sh.getDataRange().getValues();
  const headers = raw[0].map(h => String(h || "").replace(/\s+/g, ' ').trim());

  const C = {
    NAME: headers.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h)),
    JOB_TITLE: headers.findIndex(h => /job title|title|profile/i.test(h)),
    LEVEL: headers.findIndex(h => /level|grade/i.test(h)),
    TEAM: headers.findIndex(h => /team|squad|group/i.test(h)),
    DEPT: headers.findIndex(h => /dept|department|business unit/i.test(h)),
    HIRE_DATE: headers.findIndex(h => /hire date|start date|joined|date of hire/i.test(h)),
  };

  const f_nameIdx = C.NAME !== -1 ? C.NAME : (headers.includes("Name") ? headers.indexOf("Name") : 3);
  const f_titleIdx = C.JOB_TITLE !== -1 ? C.JOB_TITLE : 6;
  const f_levelIdx = C.LEVEL !== -1 ? C.LEVEL : 12;
  const f_teamIdx = C.TEAM !== -1 ? C.TEAM : 13;
  const f_deptIdx = C.DEPT !== -1 ? C.DEPT : 11;
  const f_hireIdx = C.HIRE_DATE !== -1 ? C.HIRE_DATE : -1;

  if (f_hireIdx === -1) Logger.log("[FHC] Warning: 'Hire Date' column not found in Roster. Headers: " + headers.join(" | "));
  const map = new Map();

  for (let i = 1; i < raw.length; i++) {
    const name = String(raw[i][f_nameIdx] || "").trim();
    if (!name || name.toLowerCase() === "name" || name.toLowerCase() === "employee" || name.length < 3) continue;

    const jobTitle = String(raw[i][f_titleIdx] || "").trim();
    const rawLevel = String(raw[i][f_levelIdx] || "").trim();
    const team = String(raw[i][f_teamIdx] || "").trim() || "Unassigned";
    const dept = String(raw[i][f_deptIdx] || "").trim() || "Unassigned";
    const hireDate = f_hireIdx !== -1 ? parseDate_(raw[i][f_hireIdx]) : null;

    const profileType = fhcParseProfileType_(jobTitle, rawLevel);
    const parsedLevel = profileType === "Crew Member" ? "Crew" : fhcParseLevel_(jobTitle, rawLevel);
    const jobFamily = fhcParseJobFamily_(jobTitle);
    const specialty = fhcParseSpecialty_(jobTitle, jobFamily);
    const mappedFamily = FHC_CONFIG.CONTRIBUTOR_POOL.JF_MAPPING[jobFamily] || jobFamily;
    const isFocus = FHC_CONFIG.FOCUS_JOB_FAMILIES.includes(jobFamily);

    // Contributor Pool Logic:
    // 1. Include if "Crew Member"
    // 2. Include if jobFamily is in MAPPING AND level is not in EXCLUDE_LEVELS
    const isContributor = (profileType === "Crew Member") || 
      (FHC_CONFIG.CONTRIBUTOR_POOL.JF_MAPPING[jobFamily] && !FHC_CONFIG.CONTRIBUTOR_POOL.EXCLUDE_LEVELS.includes(parsedLevel));

    map.set(name, { 
      name,
      level: parsedLevel, 
      jobTitle, 
      team, 
      dept, 
      profileType, 
      jobFamily, 
      mappedFamily,
      specialty,
      isFocus,
      isContributor,
      hireDate
    });
  }

  // Log profile type counts
  let icCount = 0, mgrCount = 0, crewCount = 0;
  for (const v of map.values()) {
    if (v.profileType === "IC") icCount++;
    else if (v.profileType === "Manager") mgrCount++;
    else crewCount++;
  }
  Logger.log(`[FHC] Full Roster: ${map.size} total (IC: ${icCount}, Manager: ${mgrCount}, Crew: ${crewCount})`);
  _fhcRosterCache_ = map;
  return map;
}

/**
 * Returns a Map<employee, Map<weekKey, hours>> of justified time off (PTO + PH).
 */
function fhcGetJustifiedTimeOff_(windowKeys) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const justifiedMap = new Map(); // name -> Map<weekKey, hours>

  // 1. Read Time Off (PTO)
  const toSheet = ss.getSheetByName(CONFIG.TIME_OFF_SHEET);
  if (toSheet) {
    const raw = toSheet.getDataRange().getValues();
    const headers = raw[0].map(h => String(h || "").replace(/\s+/g, ' ').toLowerCase().trim());
    const iName = headers.findIndex(h => /^(name|employee|resource|worker)$/i.test(h) || h.includes("name"));
    const iDate = headers.findIndex(h => h === "date" || h === "time off date" || h === "pto date");
    const iAdj  = headers.findIndex(h => h.includes("adjustment"));

    if (iName !== -1 && iDate !== -1) {
      for (let i = 1; i < raw.length; i++) {
        const name = normalizeToRoster_(String(raw[i][iName] || "").trim());
        if (!name) continue;
        const dateVal = parseDate_(raw[i][iDate]);
        if (!dateVal) continue;
        if (iAdj !== -1 && String(raw[i][iAdj] || "").toLowerCase().trim() === "balance") continue;

        const wk = weekKey_(dateVal);
        if (!windowKeys.has(wk)) continue;

        if (!justifiedMap.has(name)) justifiedMap.set(name, new Map());
        const empMap = justifiedMap.get(name);
        empMap.set(wk, (empMap.get(wk) || 0) + 8);
      }
    }
  }

  // 2. Read PH (Public Holidays)
  const phSheet = ss.getSheetByName(CONFIG.PH_SHEET);
  const rosterSheet = ss.getSheetByName(CONFIG.ROSTER_SHEET);
  if (phSheet && rosterSheet) {
    const rRaw = rosterSheet.getDataRange().getValues();
    const rHeaders = rRaw[0].map(h => String(h || "").toLowerCase().trim());
    const riName = rHeaders.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h));
    const riLoc  = rHeaders.findIndex(h => /location|office|subsidiary|country/i.test(h));

    if (riName !== -1 && riLoc !== -1) {
      const nameToLoc = new Map();
      for (let i = 1; i < rRaw.length; i++) {
        const n = normalizeToRoster_(String(rRaw[i][riName] || "").trim());
        const l = String(rRaw[i][riLoc] || "").trim();
        if (n && l) nameToLoc.set(n, l);
      }

      const phRaw = phSheet.getDataRange().getValues();
      const phHeaders = phRaw[0].map(h => String(h || "").toLowerCase().trim());
      const piDate = phHeaders.indexOf("date");
      const piLoc  = phHeaders.indexOf("location");

      if (piDate !== -1 && piLoc !== -1) {
        for (let i = 1; i < phRaw.length; i++) {
          const d = parseDate_(phRaw[i][piDate]);
          if (!d) continue;
          const wk = weekKey_(d);
          if (!windowKeys.has(wk)) continue;
          const loc = String(phRaw[i][piLoc] || "").trim();

          for (const [name, userLoc] of nameToLoc) {
            if (userLoc === loc) {
              if (!justifiedMap.has(name)) justifiedMap.set(name, new Map());
              const empMap = justifiedMap.get(name);
              // Avoid double counting if already in PTO
              // (This is a simplification; in reality, we'd check specific dates)
              empMap.set(wk, (empMap.get(wk) || 0) + 8);
            }
          }
        }
      }
    }
  }

  return justifiedMap;
}

/**
 * Read Capacity per employee.
 */
function fhcReadCapacity_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONFIG.CAPACITY_SHEET);
  const capMap = new Map();
  if (sh) {
    const raw = sh.getDataRange().getValues();
    for (let i = 1; i < raw.length; i++) {
      const name = normalizeToRoster_(String(raw[i][0] || "").trim());
      if (!name) continue;
      capMap.set(name, parseFloat(raw[i][3]) || CONFIG.WEEKLY_CAPACITY_HOURS);
    }
  }
  return capMap;
}

function fhcCalculateTenure_(hireDate) {
  let d = hireDate;
  if (d && !(d instanceof Date)) d = parseDate_(d);
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return "N/A";
  const now = new Date();
  const diffTime = Math.abs(now - d);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  if (diffDays < 30) return diffDays + "d";
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return diffMonths + "m";
  const diffYears = (diffDays / 365).toFixed(1);
  return diffYears + "y";
}

/**
 * Read Backlog INCLUDING Done/Closed items, with Week, Issue Key, Status, Project, Assignee.
 * Returns array of { assignee, issueKey, status, project, summary, week, isDone }
 */
function fhcReadBacklogWithDone_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.BACKLOG_SHEET);
  if (!sh) { Logger.log("[FHC] Backlog sheet not found."); return []; }

  const raw = sh.getDataRange().getValues();
  if (raw.length < 2) return [];

  const headers = raw[0].map(h => String(h || "").toLowerCase().trim());
  const iAssignee = headers.findIndex(h => h.includes("assignee"));
  const iKey = headers.findIndex(h => h.includes("issue key") || h === "key");
  const iStatus = headers.findIndex(h => h === "status");
  const iProject = headers.findIndex(h => h.includes("project name") || h.includes("project key") || h === "project");
  const iSummary = headers.findIndex(h => h === "summary");
  const iWeek = headers.findIndex(h => h === "week");
  const iResolved = headers.findIndex(h => h === "resolved");

  if (iAssignee === -1) { Logger.log("[FHC] Backlog: Assignee column not found."); return []; }

  const items = [];
  for (let i = 1; i < raw.length; i++) {
    const assigneeRaw = String(raw[i][iAssignee] || "").trim();
    if (!assigneeRaw) continue;

    const statusRaw = iStatus !== -1 ? String(raw[i][iStatus] || "").trim() : "";
    const statusLower = statusRaw.toLowerCase();
    const isDone = statusLower.includes("done") || statusLower.includes("closed") || statusLower.includes("resolved");

    // Handle resolved date for windowing
    let resolvedDate = null;
    if (iResolved !== -1 && raw[i][iResolved]) {
      resolvedDate = parseDate_(raw[i][iResolved]);
    }

    items.push({
      assignee: normalizeToRoster_(assigneeRaw),
      issueKey: iKey !== -1 ? String(raw[i][iKey] || "").trim().toUpperCase() : "",
      status: statusRaw,
      isDone,
      project: iProject !== -1 ? String(raw[i][iProject] || "").trim() : "",
      summary: iSummary !== -1 ? String(raw[i][iSummary] || "").trim() : "",
      week: iWeek !== -1 ? String(raw[i][iWeek] || "").trim() : "",
      resolvedDate: resolvedDate,
    });
  }

  Logger.log(`[FHC] Backlog: ${items.length} total items (${items.filter(x => x.isDone).length} Done)`);
  return items;
}

/**
 * Read Tempo with Issue Keys using the row-expansion pattern from tbReadTempoLoggedRows_.
 * Supports both row-based (User, Date, Hours, Key) and date-column formats.
 * Returns array of { employee, issueKey, weekKey, hours, project }
 */
function fhcReadTempoWithKeys_(windowKeys) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TEMPO_SHEET);
  if (!sh) { Logger.log("[FHC] Tempo sheet not found."); return []; }

  const raw = sh.getDataRange().getValues();
  if (raw.length < 2) return [];

  const headers = raw[0];
  const hNorm = headers.map(h => String(h || "").toLowerCase().trim());

  // Locate columns
  const iUser = hNorm.findIndex(h => h.includes("user") || h.includes("worker") || h.includes("resource") || h.includes("employee"));
  const iKey = hNorm.findIndex(h => h === "key" || h === "issue key");
  const iProject = hNorm.findIndex(h => h.includes("project"));
  const iDate = hNorm.findIndex(h => h === "date" || h === "work date" || h === "logged date" || h === "started" || h === "day");
  const iHours = hNorm.findIndex(h => h === "logged" || h === "hours" || h === "time spent" || h === "time" || h.includes("duration"));

  if (iUser === -1) { Logger.log("[FHC] Tempo: User column not found."); return []; }

  // Detect date columns (date-column format)
  const dateCols = [];
  for (let c = 0; c < headers.length; c++) {
    const d = parseTempoDateHeader_(headers[c]);
    if (!d) continue;
    const wk = weekKey_(d);
    if (!windowKeys.has(wk)) continue;
    dateCols.push({ col: c, date: d, weekKey: wk });
  }

  const hasRowBased = iDate >= 0 && iHours >= 0;
  const hasDateColumns = dateCols.length > 0;
  if (!hasRowBased && !hasDateColumns) { Logger.log("[FHC] Tempo: no parseable date/hour structure."); return []; }

  const rows = [];

  for (let i = 1; i < raw.length; i++) {
    const userRaw = String(raw[i][iUser] || "").trim();
    if (!userRaw || userRaw.toLowerCase().includes("user") || userRaw.toLowerCase().includes("employee")) continue;

    const emp = normalizeToRoster_(userRaw);
    const keyRaw = iKey >= 0 ? String(raw[i][iKey] || "").trim().toUpperCase() : "";
    const project = iProject >= 0 ? String(raw[i][iProject] || "").trim() : "";

    if (hasRowBased) {
      const dt = parseDate_(raw[i][iDate]);
      if (!dt) continue;
      const wk = weekKey_(dt);
      if (!windowKeys.has(wk)) continue;
      const hrs = parseFloat(raw[i][iHours]) || 0;
      if (hrs <= 0) continue;
      rows.push({ employee: emp, issueKey: keyRaw, weekKey: wk, hours: hrs, project });
      continue;
    }

    // Date-column format
    for (const dc of dateCols) {
      const hrs = parseFloat(raw[i][dc.col]) || 0;
      if (hrs <= 0) continue;
      rows.push({ employee: emp, issueKey: keyRaw, weekKey: dc.weekKey, hours: hrs, project });
    }
  }

  Logger.log(`[FHC] Tempo (with keys): ${rows.length} records, ${new Set(rows.map(r => r.employee)).size} employees`);
  return rows;
}


// ═════════════════════════════════════════════════════════════
//  AGGREGATION: Build Netsuite & Tempo maps per employee/week
// ═════════════════════════════════════════════════════════════

/**
 * Aggregate NetSuite rows into Map<employee, Map<weekKey, { billed, unbilled, totalBillable, nonBillable, totalHours }>>
 */
function fhcAggregateNetsuite_(nsRows) {
  const map = new Map();
  for (const r of nsRows) {
    if (!map.has(r.employee)) map.set(r.employee, new Map());
    const empMap = map.get(r.employee);
    if (!empMap.has(r.weekKey)) empMap.set(r.weekKey, { billed: 0, unbilled: 0, totalBillable: 0, nonBillable: 0, totalHours: 0 });
    const wk = empMap.get(r.weekKey);
    wk.billed += r.billableBilled || 0;
    wk.unbilled += r.billableUnbilled || 0;
    wk.totalBillable += r.totalBillable || 0;
    wk.nonBillable += r.nonBillable || 0;
    wk.totalHours += r.totalHours || 0;
  }
  return map;
}

/**
 * Aggregate Tempo rows into Map<employee, Map<weekKey, { tempoTotal }>>
 */
function fhcAggregateTempo_(tempoRows) {
  const map = new Map();
  for (const r of tempoRows) {
    if (!map.has(r.employee)) map.set(r.employee, new Map());
    const empMap = map.get(r.employee);
    if (!empMap.has(r.weekKey)) empMap.set(r.weekKey, { tempoTotal: 0 });
    empMap.get(r.weekKey).tempoTotal += r.hours;
  }
  return map;
}


// ═════════════════════════════════════════════════════════════
//  SIGNAL 1: Delivered Contribution (Jira Done → NetSuite)
// ═════════════════════════════════════════════════════════════

function fhcSignal1_DeliveredContribution_(backlogItems, nsMap, roster, windowKeys) {
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1]; // Evaluated week
  const w1Key = weekList.length > 1 ? weekList[weekList.length - 2] : null; // Previous week

  const computeForWeek = (targetWkKey) => {
    if (!targetWkKey) return { total: 0, matched: 0, unmatched: 0, rate: 100, unmatchedByProject: new Map(), unmatchedByJF: new Map(), unmatchedByPerson: new Map() };
    
    // Filter to items done in this specific week
    const doneItems = backlogItems.filter(item => {
      if (!item.isDone) return false;
      let wk = null;
      if (item.resolvedDate) {
        wk = weekKey_(item.resolvedDate);
      } else if (item.week) {
        const parsed = parseDate_(item.week);
        if (parsed) wk = weekKey_(parsed);
      }
      return wk === targetWkKey;
    });

    const doneByAssignee = new Map();
    for (const item of doneItems) {
      if (!doneByAssignee.has(item.assignee)) doneByAssignee.set(item.assignee, []);
      doneByAssignee.get(item.assignee).push(item);
    }

    let matched = 0, unmatched = 0;
    const unmatchedByProject = new Map();
    const unmatchedByJF = new Map();
    const unmatchedByPerson = new Map();

    for (const [assignee, items] of doneByAssignee) {
      const nsWeeks = nsMap.get(assignee);
      const wkData = nsWeeks ? nsWeeks.get(targetWkKey) : null;
      const hasBillable = wkData && wkData.totalBillable > 0;

      if (hasBillable) {
        matched += items.length;
      } else {
        unmatched += items.length;
        const rEntry = roster.get(assignee);
        const jf = rEntry ? rEntry.jobFamily : "Unknown";
        for (const item of items) {
          unmatchedByProject.set(item.project, (unmatchedByProject.get(item.project) || 0) + 1);
          unmatchedByJF.set(jf, (unmatchedByJF.get(jf) || 0) + 1);
          unmatchedByPerson.set(assignee, (unmatchedByPerson.get(assignee) || 0) + 1);
        }
      }
    }

    const total = matched + unmatched;
    const rate = total > 0 ? (matched / total) * 100 : 100;
    return { total, matched, unmatched, rate, unmatchedByProject, unmatchedByJF, unmatchedByPerson };
  };

  const w0 = computeForWeek(w0Key);
  const w1 = computeForWeek(w1Key);

  const severity = fhcClassifySeverity_(w0.rate, FHC_CONFIG.THRESHOLDS.S1, false);
  const projConc = fhcConcentrationAnalysis_(
    Array.from(w0.unmatchedByProject, ([key, count]) => ({ key, count })), w0.unmatched
  );
  const jfConc = fhcConcentrationAnalysis_(
    Array.from(w0.unmatchedByJF, ([key, count]) => ({ key, count })), w0.unmatched
  );
  const personConc = fhcConcentrationAnalysis_(
    Array.from(w0.unmatchedByPerson, ([key, count]) => ({ key, count })), w0.unmatched
  );

  const workloadDelta = w1 && w1.total > 0 ? w0.total - w1.total : w0.total;
  const workloadGrowth = w1 && w1.total > 0 ? (workloadDelta / w1.total) * 100 : 0;

  const fact = `Evaluated Week Done items: ${w0.total} | Matched: ${w0.matched} (${fhcFmtPct_(w0.rate)})`;
  const note = `Workload Growth (WoW): ${fmtDelta_(workloadDelta)} items (${fhcFmtPct_(workloadGrowth)} change)`;
  const highlight = w0.matched > 0 ? `${w0.matched} resolved items confirmed in billing pipeline` : "No billing-matched resolutions";
  const concern = w0.unmatched > 0
    ? `${w0.unmatched} items resolved with no billable hours — revenue exposure confirmed`
    : "No concerns — all resolutions matched to billing";

  const framework = FHC_CONFIG.FRAMEWORK.S1;
  const action = framework.actions[severity.level === "HEALTHY" ? "HEALTHY" : severity.level];

  return {
    matchRate: w0.rate, severity, totalDone: w0.total, matched: w0.matched, unmatched: w0.unmatched,
    wowDelta: workloadGrowth,
    concentration: { byProject: projConc, byJF: jfConc, byPerson: personConc },
    fnhc: { fact, note, highlight, concern },
    strategic: { question: framework.question, impact: framework.impact, action: action }
  };
}


// ═════════════════════════════════════════════════════════════
//  SIGNAL 2: Tracked vs Billed Gap (Tempo → NetSuite)
// ═════════════════════════════════════════════════════════════

function fhcSignal2_TrackedVsBilledGap_(tempoMap, nsMap, roster, windowKeys) {
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1];
  const w1Key = weekList.length > 1 ? weekList[weekList.length - 2] : null;

  const computeForWeek = (targetWkKey) => {
    if (!targetWkKey) return { totalTempo: 0, totalBillable: 0, gapHours: 0, pct: 0, gapByPerson: new Map(), gapByJF: new Map() };
    let totalTempo = 0, totalBillable = 0, gapHours = 0;
    const gapByPerson = new Map();
    const gapByJF = new Map();

    for (const [emp, tempoWeeks] of tempoMap) {
      const rEntry = roster.get(emp);
      if (rEntry && rEntry.profileType === "Crew Member") continue;

      const tw = tempoWeeks.get(targetWkKey);
      const tempoHrs = tw ? tw.tempoTotal : 0;

      const nsWeeks = nsMap.get(emp);
      const nw = nsWeeks ? nsWeeks.get(targetWkKey) : null;
      const billableHrs = nw ? nw.totalBillable : 0;

      totalTempo += tempoHrs;
      totalBillable += billableHrs;

      const gap = Math.max(0, tempoHrs - billableHrs);
      if (gap > 0.5) {
        gapByPerson.set(emp, gap);
        const jf = rEntry ? rEntry.jobFamily : "Unknown";
        gapByJF.set(jf, (gapByJF.get(jf) || 0) + gap);
        gapHours += gap;
      }
    }
    const pct = totalTempo > 0 ? (gapHours / totalTempo) * 100 : 0;
    return { totalTempo, totalBillable, gapHours, pct, gapByPerson, gapByJF };
  };

  const w0 = computeForWeek(w0Key);
  const w1 = computeForWeek(w1Key);

  const severity = fhcClassifySeverity_(w0.pct, FHC_CONFIG.THRESHOLDS.S2, true);
  const personConc = fhcConcentrationAnalysis_(
    Array.from(w0.gapByPerson, ([key, count]) => ({ key, count })), w0.gapHours
  );
  const jfConc = fhcConcentrationAnalysis_(
    Array.from(w0.gapByJF, ([key, count]) => ({ key, count })), w0.gapHours
  );

  const effortDelta = w1 && w1.totalTempo > 0 ? w0.totalTempo - w1.totalTempo : w0.totalTempo;
  const effortGrowth = w1 && w1.totalTempo > 0 ? (effortDelta / w1.totalTempo) * 100 : 0;

  const fact = `Evaluated Week Gap: ${fhcFmtPct_(w0.pct)} | Tracked: ${fhcFmt1_(w0.totalTempo)}h | Billed: ${fhcFmt1_(w0.totalBillable)}h`;
  const note = `Total Effort Change (WoW): ${fmtDelta_(effortDelta)}h (${fhcFmtPct_(effortGrowth)} change)`;
  const highlight = w0.pct < 10 ? "Tracking-to-billing alignment is strong (<10% gap)" : "";
  const concern = w0.pct >= 15 ? `${fhcFmtPct_(w0.pct)} of tracked effort lost — ${fhcFmt1_(w0.gapHours)}h revenue exposure` : "";

  const framework = FHC_CONFIG.FRAMEWORK.S2;
  const action = framework.actions[severity.level === "HEALTHY" ? "HEALTHY" : severity.level];

  return {
    gapPct: w0.pct, gapHours: w0.gapHours, severity, totalTempo: w0.totalTempo, totalNsBillable: w0.totalBillable,
    wowDelta: effortGrowth,
    concentration: { byPerson: personConc, byJF: jfConc },
    fnhc: { fact, note, highlight, concern },
    strategic: { question: framework.question, impact: framework.impact, action: action }
  };
}


// ═════════════════════════════════════════════════════════════
//  SIGNAL 3: Backlog-to-Contribution Ratio (Jira Active → Tempo)
// ═════════════════════════════════════════════════════════════

function fhcSignal3_BacklogContributionRatio_(backlogItems, tempoRows, roster, windowKeys) {
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1];
  const w1Key = weekList.length > 1 ? weekList[weekList.length - 2] : null;

  const computeForWeek = (targetWkKey) => {
    if (!targetWkKey) return { total: 0, covered: 0, uncovered: 0, rate: 100, uncoveredByProject: new Map(), uncoveredByAssignee: new Map() };
    
    // Active items in that week (non-Done OR Done in later week)
    const activeItems = backlogItems.filter(item => {
      if (!item.issueKey) return false;
      if (!item.isDone) return true;
      let resWk = null;
      if (item.resolvedDate) {
        resWk = weekKey_(item.resolvedDate);
      } else if (item.week) {
        const p = parseDate_(item.week);
        if (p) resWk = weekKey_(p);
      }
      return resWk >= targetWkKey; // Item was active during or done after this week
    });

    const wkTempo = tempoRows.filter(r => r.weekKey === targetWkKey && r.issueKey);
    const wkTempoKeys = new Set(wkTempo.map(r => r.issueKey));

    let covered = 0, uncovered = 0;
    const uncoveredByProject = new Map();
    const uncoveredByAssignee = new Map();

    for (const item of activeItems) {
      if (wkTempoKeys.has(item.issueKey)) {
        covered++;
      } else {
        uncovered++;
        uncoveredByProject.set(item.project, (uncoveredByProject.get(item.project) || 0) + 1);
        uncoveredByAssignee.set(item.assignee, (uncoveredByAssignee.get(item.assignee) || 0) + 1);
      }
    }

    const total = covered + uncovered;
    const rate = total > 0 ? (covered / total) * 100 : (wkTempoKeys.size > 0 ? 0 : 100);
    return { total, covered, uncovered, rate, uncoveredByProject, uncoveredByAssignee, hasTempo: wkTempoKeys.size > 0 };
  };

  const w0 = computeForWeek(w0Key);
  const w1 = computeForWeek(w1Key);

  // Severity logic: if total backlog is 0 but people are logging time, it's CRITICAL (dark work)
  let severity = fhcClassifySeverity_(w0.rate, FHC_CONFIG.THRESHOLDS.S3, false);
  if (w0.total === 0 && w0.hasTempo) {
    severity = { level: "CRITICAL", icon: "\uD83D\uDD34", bg: "#F4CCCC" };
  }

  const projConc = fhcConcentrationAnalysis_(
    Array.from(w0.uncoveredByProject, ([key, count]) => ({ key, count })), w0.uncovered
  );
  const assigneeConc = fhcConcentrationAnalysis_(
    Array.from(w0.uncoveredByAssignee, ([key, count]) => ({ key, count })), w0.uncovered
  );

  const backlogDelta = w1 && w1.total > 0 ? w0.total - w1.total : w0.total;
  const backlogGrowth = w1 && w1.total > 0 ? (backlogDelta / w1.total) * 100 : 0;

  const fact = `Evaluated Week Active Backlog: ${w0.total} items | Coverage: ${w0.total > 0 ? fhcFmtPct_(w0.rate) : "N/A"}`;
  const note = `Backlog Volume Change (WoW): ${fmtDelta_(backlogDelta)} items (${fhcFmtPct_(backlogGrowth)} change)`;
  
  let highlight = w0.total > 0 && w0.rate >= 80 ? "Strong backlog-to-effort alignment" : "";
  let concern = w0.rate < 60 ? "Low coverage — team may be working outside defined backlog" : "";
  if (w0.total === 0 && w0.hasTempo) {
    concern = "Empty Backlog — items resolved but no active items found for Evaluated Week. Verify backlog hygiene.";
  }

  const framework = FHC_CONFIG.FRAMEWORK.S3;
  let action = framework.actions[severity.level === "HEALTHY" ? "HEALTHY" : severity.level];
  if (w0.total === 0 && w0.hasTempo) {
    action = "BACKLOG AUDIT: No active items in backlog, but time is being logged. Capture 'dark work' in Jira immediately.";
  }

  return {
    coveragePct: w0.rate, severity, totalActive: w0.total, covered: w0.covered, uncovered: w0.uncovered,
    wowDelta: backlogGrowth,
    concentration: { byProject: projConc, byAssignee: assigneeConc },
    fnhc: { fact, note, highlight, concern },
    strategic: { question: framework.question, impact: framework.impact, action: action }
  };
}


// ═════════════════════════════════════════════════════════════
//  AGGREGATION BUILDERS
// ═════════════════════════════════════════════════════════════

/**
 * Build level summary: headcount and avg metrics per IC level, plus Mgmt and Crew rows.
 */
function fhcBuildLevelSummary_(roster, nsMap, tempoMap, capacityMap, windowKeys) {
  const buckets = new Map(); // level → { hc, sumBillable, sumTotal, sumTempo, sumAvail, count }
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1];

  for (const [name, r] of roster) {
    const bucketKey = r.profileType === "Manager" ? "Mgmt" : (r.profileType === "Crew Member" ? "Crew" : r.level);
    if (!buckets.has(bucketKey)) buckets.set(bucketKey, { hc: 0, sumBillable: 0, sumTotal: 0, sumTempo: 0, sumAvail: 0, profileType: r.profileType });
    const b = buckets.get(bucketKey);
    b.hc++;

    // Hours Logged (Evaluated Week W0 only)
    if (r.profileType !== "Crew Member") {
      const nsWeeks = nsMap.get(name);
      const w0Data = nsWeeks ? nsWeeks.get(w0Key) : null;
      if (w0Data) {
        b.sumBillable += w0Data.totalBillable;
        b.sumTotal += w0Data.totalHours;
      }
    }

    // Tempo hours (Evaluated Week W0 only)
    const tempoWeeks = tempoMap.get(name);
    const tw0 = tempoWeeks ? tempoWeeks.get(w0Key) : null;
    if (tw0) {
      b.sumTempo += tw0.tempoTotal;
    }

    // Capacity (shrunk)
    const cap = capacityMap.get(name);
    const weeklyCapRaw = cap ? (parseFloat(cap.weeklyCapacity) || FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT) : FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT;
    b.sumAvail += fhcShrinkCap_(weeklyCapRaw);
  }

  // Convert to output rows
  const rows = [];
  // Sort: I1-I6 first, then Mgmt, then Crew
  const order = ["I1", "I2", "I3", "I4", "I5", "I6", "L1", "L2", "L3", "L4", "L5", "L6", "Mgmt", "Crew"];
  const sortedKeys = Array.from(buckets.keys()).sort((a, b) => {
    const ai = order.indexOf(a), bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const totalHC = Array.from(buckets.values()).reduce((s, b) => s + b.hc, 0);

  for (const key of sortedKeys) {
    const b = buckets.get(key);
    const isCrew = b.profileType === "Crew Member";
    const isMgmt = b.profileType === "Manager";
    const avgBillable = (!isCrew && b.hc > 0) ? b.sumBillable / b.hc : null;
    const avgTotal = b.hc > 0 ? (isCrew ? b.sumTempo / b.hc : b.sumTotal / b.hc) : null;
    const avgUtil = (!isCrew && !isMgmt && b.sumAvail > 0)
      ? fhcUtil_(b.sumTotal, b.sumAvail) : null;
    const avgBillRate = (!isCrew && !isMgmt && b.sumTotal > 0)
      ? (b.sumBillable / b.sumTotal) * 100 : null;

    rows.push({
      level: key,
      hc: b.hc,
      pctHC: totalHC > 0 ? (b.hc / totalHC) * 100 : 0,
      avgBillable,
      avgTotal,
      avgUtil,
      avgBillRate,
      isCrew,
      isMgmt,
      suffix: isCrew ? "(Tempo only)" : (isMgmt ? "(Mgmt)" : ""),
    });
  }

  return { rows, totalHC };
}

/**
 * Build Job Family breakdown.
 */
function fhcBuildJobFamilyBreakdown_(roster, nsMap, tempoMap, windowKeys) {
  const families = new Map(); // mappedFamily → { hc, sumBillable, sumTotal, isFocus, specs: Map }
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1];

  for (const [name, r] of roster) {
    if (r.profileType === "Crew Member") continue;
    const jf = r.mappedFamily;
    const spec = r.specialty || "General";
    
    if (!families.has(jf)) {
      families.set(jf, { hc: 0, sumBillable: 0, sumTotal: 0, isFocus: r.isFocus, specs: new Map() });
    }
    const f = families.get(jf);
    f.hc++;

    if (!f.specs.has(spec)) {
      f.specs.set(spec, { hc: 0, sumBillable: 0, sumTotal: 0 });
    }
    const s = f.specs.get(spec);
    s.hc++;

    const nsWeeks = nsMap.get(name);
    const w0Data = nsWeeks ? nsWeeks.get(w0Key) : null;
    if (w0Data) {
      f.sumBillable += w0Data.totalBillable;
      f.sumTotal += w0Data.totalHours;
      s.sumBillable += w0Data.totalBillable;
      s.sumTotal += w0Data.totalHours;
    }
  }

  const companyBillable = Array.from(families.values()).reduce((s, f) => s + f.sumBillable, 0);
  const rows = [];

  const sortedKeys = Array.from(families.keys()).sort((a, b) => {
    const aFocus = FHC_CONFIG.FOCUS_JOB_FAMILIES.includes(a) ? 0 : 1;
    const bFocus = FHC_CONFIG.FOCUS_JOB_FAMILIES.includes(b) ? 0 : 1;
    if (aFocus !== bFocus) return aFocus - bFocus;
    return (families.get(b).hc) - (families.get(a).hc);
  });

  for (const jf of sortedKeys) {
    const f = families.get(jf);
    const utilPct = f.sumTotal > 0 ? (f.sumBillable / f.sumTotal) * 100 : 0;
    const target = 75;
    const signal = utilPct >= 80 ? 'On Track' : utilPct >= 65 ? 'Watch' : 'At Risk';

    const specialtyRows = Array.from(f.specs.entries()).map(([specName, s]) => {
      const sUtil = s.sumTotal > 0 ? (s.sumBillable / s.sumTotal) * 100 : 0;
      return {
        specialty: specName,
        hc: s.hc,
        avgBillable: s.hc > 0 ? s.sumBillable / s.hc : 0,
        avgUtil: sUtil,
        attainment: ((sUtil / target) * 100).toFixed(1) + '%',
        signal: sUtil >= 80 ? 'On Track' : sUtil >= 65 ? 'Watch' : 'At Risk'
      };
    }).sort((a,b) => b.hc - a.hc);

    rows.push({
      jobFamily: jf,
      hc: f.hc,
      avgBillable: f.hc > 0 ? f.sumBillable / f.hc : 0,
      pctCompanyBillable: companyBillable > 0 ? (f.sumBillable / companyBillable) * 100 : 0,
      avgUtil: utilPct,
      target: target.toFixed(1) + '%',
      attainment: ((utilPct / target) * 100).toFixed(1) + '%',
      gap: (utilPct >= target ? '+' : '') + (utilPct - target).toFixed(1) + 'pp',
      signal,
      isFocus: f.isFocus,
      specialties: specialtyRows
    });
  }

  return rows;
}

/**
 * Build Tier Status table: summary per tier + detail rows.
 */
function fhcBuildTierTable_(roster, nsMap, tempoMap, capacityMap, backlogItems, windowKeys) {
  const tiers = new Map(); // tier → { hc, employees: [] }
  const weekKeys = Array.from(windowKeys);
  const w0Key = weekKeys.length > 0 ? weekKeys[weekKeys.length - 1] : null;
  const w1Key = weekKeys.length > 1 ? weekKeys[weekKeys.length - 2] : null;

  for (const [name, r] of roster) {
    if (r.profileType !== "IC") continue; // Only IC employees in tier analysis

    // NetSuite Billable W0 vs W1
    const nsWeeks = nsMap.get(name);
    let billW0 = 0, totalW0 = 0, billW1 = 0;
    if (nsWeeks) {
      const w0Data = w0Key ? nsWeeks.get(w0Key) : null;
      const w1Data = w1Key ? nsWeeks.get(w1Key) : null;
      if (w0Data) { billW0 = w0Data.totalBillable; totalW0 = w0Data.totalHours; }
      if (w1Data) { billW1 = w1Data.totalBillable; }
    }

    const tier = statusTier_(billW0);

    // Tempo hours W0 vs W1
    let tempoW0 = 0, tempoW1 = 0;
    const tempoWeeks = tempoMap.get(name);
    if (tempoWeeks) {
      const tw0 = w0Key ? tempoWeeks.get(w0Key) : null;
      const tw1 = w1Key ? tempoWeeks.get(w1Key) : null;
      if (tw0) tempoW0 = tw0.tempoTotal;
      if (tw1) tempoW1 = tw1.tempoTotal;
    }

    // Capacity & utilization
    const cap = capacityMap.get(name);
    const weeklyCapRaw = cap ? (parseFloat(cap.weeklyCapacity) || FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT) : FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT;
    const available = fhcShrinkCap_(weeklyCapRaw);
    const utilPct = fhcUtil_(totalW0, available);

    // Backlog resolved count W0 vs W1
    const getResolvedForWeek = (wkKey) => {
      if (!wkKey) return 0;
      return backlogItems.filter(item => {
        if (!item.isDone || item.assignee !== name) return false;
        let wk = null;
        if (item.resolvedDate) wk = weekKey_(item.resolvedDate);
        else if (item.week) {
          const p = parseDate_(item.week);
          if (p) wk = weekKey_(p);
        }
        return wk === wkKey;
      }).length;
    };
    
    const resW0 = getResolvedForWeek(w0Key);
    const resW1 = getResolvedForWeek(w1Key);

    if (!tiers.has(tier)) tiers.set(tier, { hc: 0, sumBillW0: 0, sumTotalW0: 0, sumUtil: 0, sumBillW1: 0, employees: [] });
    const t = tiers.get(tier);
    t.hc++;
    t.sumBillW0 += billW0;
    t.sumTotalW0 += totalW0;
    t.sumUtil += utilPct;
    t.sumBillW1 += billW1;

    t.employees.push({
      name, level: r.level, jobFamily: r.jobFamily, dept: r.dept,
      billW0, totalW0, utilPct, tempoW0, 
      resW0, 
      billWow: billW0 - billW1,
      tempoWow: tempoW0 - tempoW1,
      resWow: resW0 - resW1,
    });
  }

  // Build summary
  const tierOrder = ["\uD83D\uDFE2 Champion", "\uD83D\uDFE1 Normal", "\uD83D\uDFE0 Low", "\uD83D\uDD34 Critical"];
  const totalIC = Array.from(tiers.values()).reduce((s, t) => s + t.hc, 0);
  const summary = [];

  for (const tier of tierOrder) {
    const t = tiers.get(tier);
    if (!t) {
      summary.push({ tier, hc: 0, pct: 0, avgBillW0: 0, avgTotalW0: 0, avgUtil: 0, wowDelta: 0, employees: [] });
      continue;
    }
    t.employees.sort((a, b) => b.billW0 - a.billW0); // Sort by billable desc within tier
    summary.push({
      tier,
      hc: t.hc,
      pct: totalIC > 0 ? (t.hc / totalIC) * 100 : 0,
      avgBillW0: t.hc > 0 ? t.sumBillW0 / t.hc : 0,
      avgTotalW0: t.hc > 0 ? t.sumTotalW0 / t.hc : 0,
      avgUtil: t.hc > 0 ? t.sumUtil / t.hc : 0,
      wowDelta: t.hc > 0 ? (t.sumBillW0 - t.sumBillW1) / t.hc : 0,
      employees: t.employees,
    });
  }

  return { summary, totalIC };
}

/**
 * Build Department breakdown.
 */
function fhcBuildDepartmentBreakdown_(roster, nsMap, tempoMap, windowKeys) {
  const depts = new Map(); // dept → { hc, icCount, mgrCount, crewCount, sumBillable, sumNonBill, sumTotal, sumTempo }
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1];

  for (const [name, r] of roster) {
    const dept = r.dept || "Unassigned";
    if (!depts.has(dept)) depts.set(dept, { hc: 0, icCount: 0, mgrCount: 0, crewCount: 0, sumBillable: 0, sumNonBill: 0, sumTotal: 0, sumTempo: 0 });
    const d = depts.get(dept);
    d.hc++;
    if (r.profileType === "IC") d.icCount++;
    else if (r.profileType === "Manager") d.mgrCount++;
    else d.crewCount++;

    // NetSuite (Evaluated Week W0 only)
    if (r.profileType !== "Crew Member") {
      const nsWeeks = nsMap.get(name);
      const w0Data = nsWeeks ? nsWeeks.get(w0Key) : null;
      if (w0Data) {
        d.sumBillable += w0Data.totalBillable;
        d.sumNonBill += w0Data.nonBillable;
        d.sumTotal += w0Data.totalHours;
      }
    }

    // Tempo (Evaluated Week W0 only)
    const tempoWeeks = tempoMap.get(name);
    const tw0 = tempoWeeks ? tempoWeeks.get(w0Key) : null;
    if (tw0) {
      d.sumTempo += tw0.tempoTotal;
    }
  }

  const rows = [];
  const sortedDepts = Array.from(depts.keys()).sort((a, b) => (depts.get(b).hc) - (depts.get(a).hc));

  for (const dept of sortedDepts) {
    const d = depts.get(dept);
    const totalOutput = d.sumBillable + d.sumNonBill;
    const utilPct = d.sumTotal > 0 ? (d.sumBillable / d.sumTotal) * 100 : 0;
    
    // Signal logic: aligns with executive thresholds (Target: 75%)
    const target = 75;
    const signal = utilPct >= 80 ? 'On Track' : utilPct >= 65 ? 'Watch' : 'At Risk';
    
    rows.push({
      dept,
      hc: d.hc,
      icCount: d.icCount,
      mgrCount: d.mgrCount,
      crewCount: d.crewCount,
      avgBillable: d.icCount > 0 ? d.sumBillable / d.icCount : 0,
      avgNonBill: d.icCount > 0 ? d.sumNonBill / d.icCount : 0,
      totalOutput,
      utilPct,
      target: target.toFixed(1) + '%',
      attainment: ((utilPct / target) * 100).toFixed(1) + '%',
      gap: (utilPct >= target ? '+' : '') + (utilPct - target).toFixed(1) + 'pp',
      signal,
      tempoTotal: d.sumTempo,
    });
  }

  return rows;
}

/**
 * Synthesize top-level FNHC from the three signals + company utilization.
 */
function fhcBuildFNHC_(signal1, signal2, signal3, roster, nsMap, tempoMap, capacityMap) {
  // Company-level utilization (IC only)
  let totalLogged = 0, totalAvail = 0;
  for (const [name, r] of roster) {
    if (r.profileType !== "IC") continue;
    const nsWeeks = nsMap.get(name);
    if (nsWeeks) { for (const wk of nsWeeks.values()) totalLogged += wk.totalHours; }
    const cap = capacityMap.get(name);
    const weeklyCapRaw = cap ? (parseFloat(cap.weeklyCapacity) || FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT) : FHC_CONFIG.WEEKLY_CAPACITY_DEFAULT;
    const weeks = nsWeeks ? nsWeeks.size : 1;
    totalAvail += fhcShrinkCap_(weeklyCapRaw) * weeks;
  }
  const companyUtil = totalAvail > 0 ? (totalLogged / totalAvail) * 100 : 0;
  const utilSeverity = fhcClassifySeverity_(companyUtil, FHC_CONFIG.THRESHOLDS.UTIL, false);

  // Contribution Health Index (Weighted)
  // S1: 40%, S2: 40% (inverted), S3: 20%
  const s2Inv = 100 - signal2.gapPct;
  const chi = (signal1.matchRate * 0.4) + (s2Inv * 0.4) + (signal3.coveragePct * 0.2);
  const chiSeverity = fhcClassifySeverity_(chi, { CRITICAL: 60, WARNING: 75, INFO: 85 }, false);

  return { signal1, signal2, signal3, companyUtil, utilSeverity, chi, chiSeverity };
}


// ═════════════════════════════════════════════════════════════
//  SHEET OUTPUT WRITERS
// ═════════════════════════════════════════════════════════════

function fhcWriteTitle_(sh, windowLabels) {
  const NC = FHC_CONFIG.N_COLS;
  ensureRows_(sh, 4);
  sh.getRange(1, 1, 1, NC).merge()
    .setValue("Full HC Analysis \u2014 Headcount Contribution Intelligence")
    .setFontSize(14).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
  sh.setRowHeight(1, 36);

  sh.getRange(2, 1, 1, NC).merge()
    .setValue(`Window: ${windowLabels.join(" | ")}  \u2022  Generated: ${new Date().toLocaleString()}`)
    .setFontSize(9).setFontStyle("italic").setFontColor("#666666");

  sh.getRange(3, 1, 1, NC).merge()
    .setValue(`Shrinkage: ${(FHC_CONFIG.SHRINKAGE_PCT * 100).toFixed(0)}%  \u2022  Focus: ${FHC_CONFIG.FOCUS_JOB_FAMILIES.join(", ")}  \u2022  IC-only utilization`)
    .setFontSize(8).setFontStyle("italic").setFontColor(COLORS.ORBE_BLUE);

  return 5; // next available row
}

/**
 * Section 1: Executive Summary — FNHC Strategic Signals
 */
function fhcWriteSection1_ExecSummary_(sh, R, fnhc) {
  const NC = FHC_CONFIG.N_COLS;
  sectionDivider_(sh, R, "1. EXECUTIVE SUMMARY \u2014 CONTRIBUTION INTELLIGENCE BRIEF", NC);
  R++;

  // --- Contribution Health Index Scorecard ---
  ensureRows_(sh, R + 1);
  sh.getRange(R, 1, 2, 3).merge().setBackground(fnhc.chiSeverity.bg)
    .setValue(`Contribution Health Index: ${fhcFmtPct_(fnhc.chi)}`)
    .setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center").setVerticalAlignment("middle");
  sh.getRange(R, 4, 1, NC - 3).merge()
    .setValue(`Status: ${fnhc.chiSeverity.icon} ${fnhc.chiSeverity.level}`)
    .setFontWeight("bold").setFontSize(10);
  sh.getRange(R + 1, 4, 1, NC - 3).merge()
    .setValue("Composite score of revenue capture, administrative leakage, and priority alignment.")
    .setFontSize(8).setFontStyle("italic").setFontColor("#666666");
  R += 3;

  // --- Signal 1 ---
  R = fhcWriteSignalBlock_(sh, R, NC,
    "Signal 1: Delivered Contribution",
    fnhc.signal1.severity,
    "Match Rate", fhcFmtPct_(fnhc.signal1.matchRate),
    `Done: ${fnhc.signal1.totalDone} | Matched: ${fnhc.signal1.matched} | Unmatched: ${fnhc.signal1.unmatched}`,
    fnhc.signal1
  );

  // --- Signal 2 ---
  R = fhcWriteSignalBlock_(sh, R, NC,
    "Signal 2: Tracked vs Billed Gap",
    fnhc.signal2.severity,
    "Gap", fhcFmtPct_(fnhc.signal2.gapPct),
    `Tempo: ${fhcFmt1_(fnhc.signal2.totalTempo)}h | Billed: ${fhcFmt1_(fnhc.signal2.totalNsBillable)}h | Gap: ${fhcFmt1_(fnhc.signal2.gapHours)}h`,
    fnhc.signal2
  );

  // --- Signal 3 ---
  R = fhcWriteSignalBlock_(sh, R, NC,
    "Signal 3: Backlog-to-Contribution Ratio",
    fnhc.signal3.severity,
    "Coverage", fhcFmtPct_(fnhc.signal3.coveragePct),
    `Active: ${fnhc.signal3.totalActive} | Covered: ${fnhc.signal3.covered} | Uncovered: ${fnhc.signal3.uncovered}`,
    fnhc.signal3
  );

  // --- Company Utilization ---
  subHeader_(sh, R, `Company Utilization (IC only, ${(FHC_CONFIG.SHRINKAGE_PCT * 100).toFixed(0)}% shrinkage): ${fnhc.utilSeverity.icon} ${fhcFmtPct_(fnhc.companyUtil)}`, NC);
  sh.getRange(R, 1, 1, NC).setBackground(fnhc.utilSeverity.bg);
  R++;

  // --- Discrepancy Concentration ---
  R = fhcWriteConcentrationBlock_(sh, R, NC, fnhc);

  R++; // spacing
  return R;
}

/**
 * Helper: write a single signal FNHC block.
 */
function fhcWriteSignalBlock_(sh, R, NC, title, severity, metricName, metricValue, metricDetail, sigData) {
  const fnhc = sigData.fnhc;
  const strat = sigData.strategic;

  subHeader_(sh, R, `${title} \u2014 ${strat.question}`, NC);
  R++;

  // Impact/Education row
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, NC).merge().setValue(`STRATEGIC IMPACT: ${strat.impact}`)
    .setFontSize(8).setFontColor("#444444").setBackground("#F8F9F9").setWrap(true);
  sh.setRowHeight(R, 30);
  R++;

  // Metric row
  ensureRows_(sh, R);
  sh.getRange(R, 1).setValue(severity.icon + " " + severity.level);
  sh.getRange(R, 2).setValue(metricName);
  sh.getRange(R, 3).setValue(metricValue).setFontWeight("bold");
  sh.getRange(R, 4, 1, NC - 3).merge().setValue(metricDetail).setFontSize(8).setFontColor("#666666");
  sh.getRange(R, 1, 1, NC).setBackground(severity.bg);
  R++;

  // FNHC rows
  const labels = [
    { tag: "FACT", color: COLORS.VOID_BLUE, text: fnhc.fact },
    { tag: "NOTE", color: "#4A6FA5", text: fnhc.note },
    { tag: "HIGHLIGHT", color: "#0D7A3E", text: fnhc.highlight },
    { tag: "CONCERN", color: "#C0392B", text: fnhc.concern },
    { tag: "ACTION", color: "#E67E22", text: strat.action },
  ];
  for (const l of labels) {
    if (!l.text) continue;
    ensureRows_(sh, R);
    sh.getRange(R, 1).setValue(l.tag).setFontWeight("bold").setFontColor(l.color).setFontSize(8);
    sh.getRange(R, 2, 1, NC - 1).merge().setValue(l.text).setFontSize(8).setWrap(true);
    sh.setRowHeight(R, 20);
    R++;
  }

  R++; // spacing between signal blocks
  return R;
}

/**
 * Helper: write the Discrepancy Concentration Analysis sub-block.
 */
function fhcWriteConcentrationBlock_(sh, R, NC, fnhc) {
  subHeader_(sh, R, "Discrepancy Concentration Analysis", NC);
  R++;

  // Header
  ensureRows_(sh, R);
  const concHeaders = ["Dimension", "Top Concentration", "Count", "% of Total", "Assessment"];
  sh.getRange(R, 1, 1, concHeaders.length).setValues([concHeaders]);
  styleHeader_(sh, R, concHeaders.length, 24);
  R++;

  // Gather concentration data from all 3 signals
  const concData = [];

  // S1: By Project
  const s1proj = fnhc.signal1.concentration.byProject;
  if (s1proj.top.length > 0) {
    concData.push(["By Account (S1)", s1proj.top[0].key, s1proj.top[0].count, fhcFmtPct_(s1proj.top[0].pct), s1proj.isConcentrated ? "Concentrated" : "Distributed"]);
  }

  // S1: By JF
  const s1jf = fnhc.signal1.concentration.byJF;
  if (s1jf.top.length > 0) {
    concData.push(["By Role/JF (S1)", s1jf.top[0].key, s1jf.top[0].count, fhcFmtPct_(s1jf.top[0].pct), s1jf.isConcentrated ? "Concentrated" : "Distributed"]);
  }

  // S2: By Person
  const s2person = fnhc.signal2.concentration.byPerson;
  if (s2person.top.length > 0) {
    concData.push(["By Individual (S2)", s2person.top[0].key, fhcFmt1_(s2person.top[0].count) + "h", fhcFmtPct_(s2person.top[0].pct), s2person.isConcentrated ? "Concentrated" : "Distributed"]);
  }

  // S2: By JF
  const s2jf = fnhc.signal2.concentration.byJF;
  if (s2jf.top.length > 0) {
    concData.push(["By Role/JF (S2)", s2jf.top[0].key, fhcFmt1_(s2jf.top[0].count) + "h", fhcFmtPct_(s2jf.top[0].pct), s2jf.isConcentrated ? "Concentrated" : "Distributed"]);
  }

  // S3: By Project
  const s3proj = fnhc.signal3.concentration.byProject;
  if (s3proj.top.length > 0) {
    concData.push(["By Account (S3)", s3proj.top[0].key, s3proj.top[0].count, fhcFmtPct_(s3proj.top[0].pct), s3proj.isConcentrated ? "Concentrated" : "Distributed"]);
  }

  if (concData.length > 0) {
    ensureRows_(sh, R + concData.length);
    sh.getRange(R, 1, concData.length, concHeaders.length).setValues(concData);
    for (let i = 0; i < concData.length; i++) {
      sh.getRange(R + i, 1, 1, concHeaders.length).setBackground(altBg_(i)).setFontSize(8);
      // Highlight "Concentrated" cells
      const assessment = concData[i][4];
      if (assessment === "Concentrated") {
        sh.getRange(R + i, 5).setFontColor("#C0392B").setFontWeight("bold");
      }
    }
    R += concData.length;
  } else {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, NC).merge().setValue("No significant concentration patterns detected").setFontSize(8).setFontStyle("italic");
    R++;
  }

  // Overall verdict
  const anyConcentrated = [s1proj, s1jf, s2person, s2jf, s3proj].some(c => c.isConcentrated);
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, NC).merge()
    .setValue(anyConcentrated
      ? "OVERALL: Discrepancies are concentrated — targeted intervention recommended"
      : "OVERALL: Discrepancies are distributed — systemic review recommended")
    .setFontWeight("bold").setFontSize(9)
    .setFontColor(anyConcentrated ? "#C0392B" : COLORS.ORBE_BLUE);
  R++;

  return R;
}


/**
 * Section 2: Workforce Level & Job Family Summary
 */
function fhcWriteSection2_WorkforceLevel_(sh, R, levelData, jfData) {
  const NC = FHC_CONFIG.N_COLS;
  sectionDivider_(sh, R, "2. WORKFORCE LEVEL & JOB FAMILY SUMMARY", NC);
  R++;

  // --- Sub-section 2A: Level Distribution ---
  subHeader_(sh, R, "2A. Level Distribution", NC);
  R++;

  const lvlHeaders = ["Level", "HC", "% HC", "Avg Billable/Wk", "Avg Total/Wk", "Avg Util %", "Avg Bill Rate %", "Notes"];
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, lvlHeaders.length).setValues([lvlHeaders]);
  styleHeader_(sh, R, lvlHeaders.length, 28);
  R++;

  for (let i = 0; i < levelData.rows.length; i++) {
    const row = levelData.rows[i];
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, lvlHeaders.length).setValues([[
      row.level,
      row.hc,
      fhcFmtPct_(row.pctHC),
      row.avgBillable != null ? fhcFmt1_(row.avgBillable) + "h" : "\u2014",
      row.avgTotal != null ? fhcFmt1_(row.avgTotal) + "h" : "\u2014",
      row.avgUtil != null ? fhcFmtPct_(row.avgUtil) : "\u2014",
      row.avgBillRate != null ? fhcFmtPct_(row.avgBillRate) : "\u2014",
      row.suffix,
    ]]).setBackground(altBg_(i)).setFontSize(8);

    if (row.isCrew || row.isMgmt) {
      sh.getRange(R, 1, 1, lvlHeaders.length).setFontStyle("italic").setFontColor("#888888");
    }
    R++;
  }

  // Totals row
  ensureRows_(sh, R);
  sh.getRange(R, 1).setValue("TOTAL").setFontWeight("bold");
  sh.getRange(R, 2).setValue(levelData.totalHC).setFontWeight("bold");
  sh.getRange(R, 1, 1, lvlHeaders.length).setBackground(COLORS.IVORY).setFontSize(8);
  R += 2;

  // --- Sub-section 2B: Job Family Breakdown ---
  subHeader_(sh, R, "2B. Job Family Breakdown (excl. Crew Members)", NC);
  R++;

  const jfHeaders = ["Job Family", "HC", "Avg Billable/Wk", "% of Co. Billable", "Avg Bill Rate %", "Focus"];
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, jfHeaders.length).setValues([jfHeaders]);
  styleHeader_(sh, R, jfHeaders.length, 28);
  R++;

  for (let i = 0; i < jfData.length; i++) {
    const row = jfData[i];
    ensureRows_(sh, R);

    sh.getRange(R, 1, 1, jfHeaders.length).setValues([[
      row.jobFamily,
      row.hc,
      fhcFmt1_(row.avgBillable) + "h",
      fhcFmtPct_(row.pctCompanyBillable),
      fhcFmtPct_(row.avgUtil),
      row.isFocus ? "FOCUS" : "",
    ]]).setBackground(altBg_(i)).setFontSize(8);

    if (row.isFocus) {
      sh.getRange(R, 1, 1, jfHeaders.length).setBackground("#D6EAF8"); // Light blue for focus
      sh.getRange(R, 6).setFontWeight("bold").setFontColor(COLORS.ORBE_BLUE);
    }
    R++;
  }

  R++; // spacing
  return R;
}


/**
 * Section 3: Tier Status Breakdown
 */
function fhcWriteSection3_TierStatus_(sh, R, tierData) {
  const NC = FHC_CONFIG.N_COLS;
  sectionDivider_(sh, R, "3. TIER STATUS BREAKDOWN (IC only)", NC);
  R++;

  // --- Summary table ---
  subHeader_(sh, R, "3A. Tier Summary (Evaluated Week W0)", NC);
  R++;

  const tierHeaders = ["Tier", "HC", "%", "Avg Billable W0", "Avg Total W0", "Avg Util %", "Billable WoW \u0394"];
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, tierHeaders.length).setValues([tierHeaders]);
  styleHeader_(sh, R, tierHeaders.length, 28);
  R++;

  for (const t of tierData.summary) {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, tierHeaders.length).setValues([[
      t.tier,
      t.hc,
      fhcFmtPct_(t.pct),
      fhcFmt1_(t.avgBillW0) + "h",
      fhcFmt1_(t.avgTotalW0) + "h",
      fhcFmtPct_(t.avgUtil),
      fmtDelta_(t.wowDelta) + "h",
    ]]).setFontSize(8);

    // Apply tier background
    const tierBg = TIER_BG[t.tier] || "#FFFFFF";
    sh.getRange(R, 1, 1, tierHeaders.length).setBackground(tierBg);
    R++;
  }

  // Totals
  ensureRows_(sh, R);
  sh.getRange(R, 1).setValue("TOTAL IC").setFontWeight("bold");
  sh.getRange(R, 2).setValue(tierData.totalIC).setFontWeight("bold");
  sh.getRange(R, 1, 1, tierHeaders.length).setBackground(COLORS.IVORY).setFontSize(8);
  R += 2;

  // --- Detail table per tier ---
  subHeader_(sh, R, "3B. Employee Detail by Tier (Evaluated Week + WoW Growth)", NC);
  R++;

  const detHeaders = ["Employee", "Level", "JF", "Billable W0", "Bill \u0394", "Util %", "Tempo W0", "Tempo \u0394", "Done W0", "Done \u0394", "WoW Trend"];
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, detHeaders.length).setValues([detHeaders]);
  styleHeader_(sh, R, detHeaders.length, 28);
  R++;

  for (const t of tierData.summary) {
    if (t.employees.length === 0) continue;

    // Tier label row
    ensureRows_(sh, R);
    const tierBg = TIER_BG[t.tier] || "#FFFFFF";
    sh.getRange(R, 1, 1, detHeaders.length).merge()
      .setValue(`${t.tier} (${t.hc} employees)`)
      .setBackground(tierBg).setFontWeight("bold").setFontSize(9);
    R++;

    for (let i = 0; i < t.employees.length; i++) {
      const e = t.employees[i];
      ensureRows_(sh, R);

      // Simple trend icon: up if billable grew, down if it fell
      const trendIcon = e.billWow > 0.5 ? "\uD83D\uDCC8" : (e.billWow < -0.5 ? "\uD83D\uDCC9" : "\u27A1");

      sh.getRange(R, 1, 1, detHeaders.length).setValues([[
        e.name,
        e.level,
        e.jobFamily,
        fhcFmt1_(e.billW0) + "h",
        fmtDelta_(e.billWow) + "h",
        fhcFmtPct_(e.utilPct),
        fhcFmt1_(e.tempoW0) + "h",
        fmtDelta_(e.tempoWow) + "h",
        e.resW0,
        fmtDelta_(e.resWow),
        trendIcon
      ]]).setBackground(altBg_(i)).setFontSize(8);
      R++;
    }
  }

  R++; // spacing
  return R;
}


/**
 * Section 4: Department Breakdown
 */
function fhcWriteSection4_Department_(sh, R, deptData) {
  const NC = FHC_CONFIG.N_COLS;
  sectionDivider_(sh, R, "4. DEPARTMENT BREAKDOWN", NC);
  R++;

  const deptHeaders = ["Department", "HC", "IC", "Mgmt", "Crew", "Avg Billable/Wk", "Avg Non-Bill/Wk", "Total Output/Wk", "Bill Rate %", "Tempo Hrs/Wk"];
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, deptHeaders.length).setValues([deptHeaders]);
  styleHeader_(sh, R, deptHeaders.length, 28);
  R++;

  for (let i = 0; i < deptData.length; i++) {
    const d = deptData[i];
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, deptHeaders.length).setValues([[
      d.dept,
      d.hc,
      d.icCount,
      d.mgrCount,
      d.crewCount,
      fhcFmt1_(d.avgBillable) + "h",
      fhcFmt1_(d.avgNonBill) + "h",
      fhcFmt1_(d.totalOutput) + "h",
      fhcFmtPct_(d.utilPct),
      fhcFmt1_(d.tempoTotal) + "h",
    ]]).setBackground(altBg_(i)).setFontSize(8);
    R++;
  }

  R++;
  return R;
}


// ═════════════════════════════════════════════════════════════
//  ORCHESTRATOR
// ═════════════════════════════════════════════════════════════

/**
 * Gather all data for Full HC Analysis.
 * Used by both the spreadsheet writer and the dashboard.
 */
function fhcGetFullAnalysisData_(viewMode) {
  const mode = viewMode || "contributors";
  const windowMondays = getThreeWeekWindow_();
  const windowKeys = new Set(windowMondays.map(d => weekKey_(d)));
  const windowLabels = windowMondays.map(d => formatWeekRange_(d));

  let roster = fhcReadFullRoster_();
  if (roster.size === 0) return null;

  // Global Filter: if in 'contributors' mode, remove non-contributors (M4-M12, etc.)
  if (mode === "contributors") {
    const filteredRoster = new Map();
    for (const [name, r] of roster) {
      if (r.isContributor) filteredRoster.set(name, r);
    }
    roster = filteredRoster;
  }

  const nsRows = readHoursLogged_(windowKeys);
  const tempoRowsWithKeys = fhcReadTempoWithKeys_(windowKeys);
  const capacityData = readCapacity_();
  const backlogItems = fhcReadBacklogWithDone_();

  const nsMap = fhcAggregateNetsuite_(nsRows);
  const tempoMap = fhcAggregateTempo_(tempoRowsWithKeys);

  const signal1 = fhcSignal1_DeliveredContribution_(backlogItems, nsMap, roster, windowKeys);
  const signal2 = fhcSignal2_TrackedVsBilledGap_(tempoMap, nsMap, roster, windowKeys);
  const signal3 = fhcSignal3_BacklogContributionRatio_(backlogItems, tempoRowsWithKeys, roster, windowKeys);

  const levelData = fhcBuildLevelSummary_(roster, nsMap, tempoMap, capacityData, windowKeys);
  const jfData = fhcBuildJobFamilyBreakdown_(roster, nsMap, tempoMap, windowKeys);
  const tierData = fhcBuildTierTable_(roster, nsMap, tempoMap, capacityData, backlogItems, windowKeys);
  const deptData = fhcBuildDepartmentBreakdown_(roster, nsMap, tempoMap, windowKeys);

  const fnhc = fhcBuildFNHC_(signal1, signal2, signal3, roster, nsMap, tempoMap, capacityData);

  return {
    fnhc,
    levelData,
    jfData,
    tierData,
    deptData,
    windowLabels,
    rosterSize: roster.size
  };
}

function runFullHCAnalysis() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    ss.toast("Starting Full HC Analysis...", "Full HC Analysis", 3);

    const data = fhcGetFullAnalysisData_();
    if (!data) throw new Error("Roster returned 0 employees. Check Roster sheet.");

    const sh = resetSheet_(ss, FHC_CONFIG.OUTPUT_SHEET, 600);

    let R = fhcWriteTitle_(sh, data.windowLabels);
    R = fhcWriteSection1_ExecSummary_(sh, R, data.fnhc);
    R = fhcWriteSection2_WorkforceLevel_(sh, R, data.levelData, data.jfData);
    R = fhcWriteSection3_TierStatus_(sh, R, data.tierData);
    R = fhcWriteSection4_Department_(sh, R, data.deptData);

    // Freeze headers
    sh.setFrozenRows(4);

    // Auto-resize key columns
    try {
      for (let c = 1; c <= Math.min(FHC_CONFIG.N_COLS, sh.getMaxColumns()); c++) {
        sh.autoResizeColumn(c);
      }
    } catch (e) { /* non-critical */ }

    SpreadsheetApp.flush();

    // ── Summary toast ──
    const critCount = data.tierData.summary.find(t => t.tier.includes("Critical"));
    const champCount = data.tierData.summary.find(t => t.tier.includes("Champion"));
    ss.toast(
      `Done! ${data.rosterSize} employees analyzed for Evaluated Week. ` +
      `S1: ${data.fnhc.signal1.severity.icon} S2: ${data.fnhc.signal2.severity.icon} S3: ${data.fnhc.signal3.severity.icon} | ` +
      `${champCount ? champCount.hc : 0} Champions, ${critCount ? critCount.hc : 0} Critical`,
      "Full HC Analysis", 8
    );

    Logger.log(`[FHC] === Complete. Roster: ${data.rosterSize} ===`);

  } catch (e) {
    Logger.log(`[FHC] ERROR: ${e.message}\n${e.stack}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(`Error: ${e.message}`, "Full HC Analysis", 12);
    throw e;
  }
}
