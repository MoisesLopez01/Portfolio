// ============================================================
// SCRIPT: 3-Week Rolling Contribution Analytics  (v3.1.0)
// ENV:    Google Apps Script
// ============================================================

// ── CONFIG ───────────────────────────────────────────────────
const CONFIG = {
  SCRIPT_LABEL: "3-Week Contribution Analytics",

  // Source tabs
  HOURS_LOGGED_SHEET: "Hours Logged",
  UTILIZATION_SHEET: "Utilization",
  TEMPO_SHEET: "Tempo Logged Time",
  CAPACITY_SHEET: "Capacity",
  ROSTER_SHEET: "Roster",
  BACKLOG_SHEET: "Backlog",
  PH_SHEET: "PH",
  TIME_OFF_SHEET: "Time Off",

  // Output tabs (recreated each run)
  ANALYTICS_SHEET: "📊 Weekly Analytics",
  SUMMARY_SHEET: "📋 Summary Report",
  EXEC_SHEET: "📈 Executive Signal Report",

  // Capacity defaults
  WEEKLY_CAPACITY_HOURS: 40,
  BILLABLE_TARGET_HOURS: 32,

  // Contributor tier thresholds (total billable hours/week)
  TIER: { CRITICAL: 10, LOW: 20, NORMAL: 32 },

  // Targeted Job Profiles (JF007 / JF009 + Crew Members)
  TARGET_PREFIXES: ["07.", "09.", "Crew Member"],

  // Behavioral classification thresholds
  NB_SHIFT_MIN_RISE_H: 8,
  DECLINING_MIN_BILL_DROP: 4,
  GHOST_MAX_BILL_W0: 1,

  // Week numbering: offset from ISO week (report format = +1 week ahead)
  WEEK_NUMBER_OFFSET: 1,

  // Reconciliation tolerance
  TOLERANCE_HOURS: 0.5,
  DEFAULT_AVAILABLE_HOURS_PER_DAY: 8,

  // ── Executive Report benchmarks
  EXEC_BENCHMARKS: {
    LOGGED_PCT_OF_AVAIL: 90,
    BILLABLE_PCT:        75,
    UNBILLED_PCT_MAX:    10,
    ADMIN_PCT_MAX:       15,
    UNUSED_PCT_MAX:       5,
    MARGIN_PCT_MIN:      40,
    NOT_LOGGED_PCT_MAX:   5,
  },
};

// ── NAME NORMALIZATION — Cross-Source Identity Resolution ────
// Roster is the single source of truth for employee names.
// Other sources (Tempo, Backlog, Hours Logged, Utilization,
// Capacity) may use variants. Add overrides here:
//   Roster Name (key) → Source Name (value)
// ─────────────────────────────────────────────────────────────
const NAME_MAPS = {
  /** ROSTER → TEMPO (Tempo Logged Time) */
  TEMPO: {
    "Charles W Talk" : "Chuck Talk",
    "Karl E Hoeschen" : "Karl Hoeschen",
    "Pravindran Mahendran" : "Pravin Mahendran",
    "Adrien Shung Shien Low" : "Adrien Low",
    "Syed Afiq Al-Attas Syed Khaidzir" : "Afiq Syed Khaidzir",
    "Brian M Estavilla" : "Brian Estavilla",
    "Dean D Espera" : "Dean Espera",
    "K Hashvin Katheresan" : "Hashvin Katheresan",
    "Seyed Iman Hashemi Rastegar" : "Iman Hashemi (ServiceRocket)",
    "Wey Khoon Lew" : "Kevin Lew",
    "Kah Loun Foong" : "KL Foong",
    "Mohamed Riza Mohamed" : "Mohamed Riza",
    "Thierno Abdoul Rahimi Diallo" : "Rahimi Diallo",
    "Scott Wai Chee Tan" : "Scott Tan",
    "Teck En Yew" : "Teck-En Yew",
    "Tze Siong Chong" : "TS Chong",
    "Vicknesh A/L Shanmugam" : "Vicknesh Shanmugam",
    "Samuel Gatica" : "Sam Gatica",
    "Ignacia Ciero" : "Ignacia Ciero R.",
    "Valentín Lopez" : "Valentin Lopez",
    "Alexander Oneal Moore" : "Alexander Moore",
    "Connie Jo Owens" : "Connie Owens",
    "Danny Garcia" : "Danny Garcia",
    "David Nicholson" : "Dave Nicholson",
    "Ahmad Danial B Mohammad" : "Ahmad Danial Mohammad",
    "Azmir Zan" : "Azmir Md Zan",
    "Farah Idayu Othman" : "Farah Othman",
    "Luis Daniel Atencio Villasmil" : "Luis Atencio Atencio Villasmil",
    "Amanda Anusuyia Fernandez" : "Amanda Fernandez",
    "Blake R Main" : "Blake Main",
    "Mohd Ikram Hafiz Abdul Hamid" : "Ikram Abdul Hamid",
    "Javier Zabadal" : "Javi Zabadal",
    // ── Add more Roster → Tempo overrides below ──
  },

  /** ROSTER → BACKLOG */
  BACKLOG: {
    "Steven Monroney" : "Steve Monroney",
    "Christopher Taylor" : "Paul Taylor",
    "Adrien Shung Shien Low" : "Adrien Low",
    "Gareth M Weiss" : "Gareth Weiss",
    "Yuen Chi Lian" : "YC Lian",
    "Marcela Hermansen" : "Marge Hermansen",
    "Tze Siong Chong" : "TS Chong",
    "Felipe González Carrasco" : "Felipe GonzÃ¡lez Carrasco",
    "Hoang Long Nguyen" : "Long Nguyen",
    "Choon Kean Quah" : "Andy Quah",
    "K Hashvin Katheresan" : "Hashvin Katheresan",
    // ── Add more Roster → Backlog overrides below ──
  },

  /** ROSTER → Hours Logged (matches today — safety net) */
  HOURS_LOGGED: {
    // 'Roster Name': 'Hours Logged Name',
  },

  /** ROSTER → UTILIZATION */
  UTILIZATION: {
    // 'Roster Name': 'Utilization Name',
  },

  /** ROSTER → CAPACITY */
  CAPACITY: {
    // 'Roster Name': 'Capacity Name',
  },
};

/**
 * Builds a reverse lookup cache: Source Name (lower) → Roster Name.
 * Covers ALL sections so any name from any source resolves to Roster.
 */
const _NAME_CACHE = (function () {
  const cache = {};
  for (const section of Object.values(NAME_MAPS)) {
    for (const [rosterName, sourceName] of Object.entries(section)) {
      if (sourceName) cache[String(sourceName).toLowerCase().trim()] = rosterName;
    }
  }
  return cache;
})();

/**
 * Resolve any employee name to its canonical Roster name.
 * If no mapping exists, the original (trimmed) name is returned.
 * @param {string} name
 * @return {string}
 */
function normalizeToRoster_(name) {
  if (!name) return '';
  const trimmed = String(name).trim();
  return _NAME_CACHE[trimmed.toLowerCase()] || trimmed;
}

/** Helper to find column indices by header names (flexible mapping) */
function getColMap_(sheetName, mapping) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh) return null;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(h => String(h || "").trim().toLowerCase());
  
  const result = {};
  for (const [key, searchTerms] of Object.entries(mapping)) {
    let found = -1;
    for (const term of searchTerms) {
      const t = term.toLowerCase();
      found = headers.indexOf(t);
      if (found !== -1) break;
      // Partial match fallback
      found = headers.findIndex(h => h.includes(t));
      if (found !== -1) break;
    }
    result[key] = found;
  }
  return result;
}

// ── BRAND PALETTE ────────────────────────────────────────────
const COLORS = {
  VOID_BLUE: "#0F1941",
  ORBE_BLUE: "#058CDC",
  IVORY: "#DCCDBE",
  LIGHT_CREAM: "#FFFAF5",
  ROYAL: "#2864E6",
  JUNE: "#FF9B87",
};

const TIER_BG = {
  "🟢 Champion": "#B7E1CD",
  "🟡 Normal": "#FFF9C4",
  "🟠 Low": "#FFE0B2",
  "🔴 Critical": "#F4CCCC",
};

const SIGNAL_BG = {
  DROP: "#EA9999",
  RISE: "#B7E1CD",
  NO_LOG: "#CFE2F3",
  MATCH: "#D9EAD3",
  MISMATCH: "#F4CCCC",
  PARTIAL: "#FFF9C4",
  MISSING: "#CFE2F3",
};

// ── Light-tint palette for behavior segment rows (valid 6-char hex) ──
const BEHAVIOR_TINT = {
  GHOST: "#FBE4E4",
  NB_SHIFT: "#FDF0E0",
  DECLINING: "#FFF0D9",
  IMPROVING: "#E3F4EA",
  INCONSISTENT: "#FFFCE6",
  COMPLIANT: "#EAF5E4",
};

// ── BEHAVIOR DEFINITIONS ─────────────────────────────────────
const BEHAVIORS = {
  GHOST: {
    icon: "🚨", label: "Ghost", bg: "#F4CCCC", fg: "#A50000",
    desc: "Has allocation — no billable Hours Logged in W-1 or W0",
  },
  NB_SHIFT: {
    icon: "⚡", label: "NB Shift", bg: "#FCE5CD", fg: "#7F4900",
    desc: "Billable dropping while non-billable hours are rising",
  },
  DECLINING: {
    icon: "📉", label: "Declining", bg: "#FFE0B2", fg: "#B35900",
    desc: "Billable hours trending consistently downward",
  },
  IMPROVING: {
    icon: "📈", label: "Improving", bg: "#B7E1CD", fg: "#0D4721",
    desc: "Billable hours trending consistently upward",
  },
  INCONSISTENT: {
    icon: "⚠️", label: "Inconsistent", bg: "#FFF9C4", fg: "#7D6500",
    desc: "Mixed contribution — irregular billable pattern",
  },
  COMPLIANT: {
    icon: "✅", label: "Compliant", bg: "#D9EAD3", fg: "#0D4721",
    desc: "Consistent billable contribution across all 3 weeks",
  },
};


// ═════════════════════════════════════════════════════════════
//  DATE HELPERS
// ═════════════════════════════════════════════════════════════

function mondayOf_(date) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekKey_(date) {
  return mondayOf_(date).toISOString().substring(0, 10);
}

function weekSunday_(monday) {
  const d = new Date(monday);
  d.setDate(d.getDate() + 6);
  return d;
}

/** ISO 8601 week number (week containing Jan 4 is W01). */
function isoWeekNumber_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function formatWeekRange_(monday) {
  const sun = weekSunday_(monday);
  const wn = isoWeekNumber_(monday) + CONFIG.WEEK_NUMBER_OFFSET;
  const m = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const s = sun.toLocaleDateString("en-US", { day: "numeric", year: "numeric" });
  return `W${wn} (${m}–${s})`;
}

function shortWeekLabel_(monday) {
  const sun = weekSunday_(monday);
  const wn = isoWeekNumber_(monday) + CONFIG.WEEK_NUMBER_OFFSET;
  const m = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const s = sun.toLocaleDateString("en-US", { day: "numeric" });
  return `W${wn} (${m}–${s})`;
}

function getThreeWeekWindow_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysToLastSunday = dow === 0 ? 7 : dow;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysToLastSunday);

  const w0 = new Date(lastSunday);
  w0.setDate(lastSunday.getDate() - 6);
  const w1 = new Date(w0); w1.setDate(w0.getDate() - 7);
  const w2 = new Date(w0); w2.setDate(w0.getDate() - 14);

  Logger.log(`[Window] W-2: ${w2.toDateString()}  W-1: ${w1.toDateString()}  W0: ${w0.toDateString()}`);
  return [w2, w1, w0];
}

function parseDate_(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;

  // Google Sheets numeric serial date support.
  if (typeof raw === "number") {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const dNum = new Date(ms);
    return isNaN(dNum.getTime()) ? null : dNum;
  }

  const str = String(raw).trim().replace("T", " ").replace(/\.000$/, "");
  if (!str) return null;

  // Try native parse first.
  const native = new Date(str);
  if (!isNaN(native.getTime())) return native;

  // dd/MM/yyyy or dd-MM-yyyy (optionally with time)
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:\s+.*)?$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const dDmy = new Date(year, month, day);
    return isNaN(dDmy.getTime()) ? null : dDmy;
  }

  // dd-MMM-yy / dd-MMM-yyyy
  m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})(?:\s+.*)?$/);
  if (m) {
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const day = parseInt(m[1], 10);
    const month = monthMap[m[2].toLowerCase()];
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (month == null) return null;
    const dMon = new Date(year, month, day);
    return isNaN(dMon.getTime()) ? null : dMon;
  }

  return null;
}

function parseTempoDateHeader_(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  const str = String(raw).trim();

  // 1. Handle D-MMM-YY (Tempo default: e.g. 30-Mar-26)
  let m = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const d = new Date(`${m[2]} ${parseInt(m[1], 10)}, ${2000 + parseInt(m[3], 10)}`);
    return isNaN(d.getTime()) ? null : d;
  }

  // 2. Handle D/M/YYYY or DD/MM/YYYY (Sheets default)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // 3. Native fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function parseHours_(raw) {
  if (raw == null || raw === "") return 0;
  if (typeof raw === "number") return isNaN(raw) ? 0 : raw;
  const str = String(raw).trim();
  if (!str) return 0;

  // HH:MM or HH:MM:SS support.
  const hm = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const min = parseInt(hm[2], 10);
    const sec = hm[3] ? parseInt(hm[3], 10) : 0;
    return h + (min / 60) + (sec / 3600);
  }

  // "7h 30m" style support.
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/i);
  const m = str.match(/(\d+(?:\.\d+)?)\s*m/i);
  if (h || m) {
    const hrs = h ? parseFloat(h[1]) : 0;
    const mins = m ? parseFloat(m[1]) : 0;
    return hrs + (mins / 60);
  }

  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

function parseBillableFlag_(raw) {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  const v = String(raw || "").trim().toLowerCase();
  if (v === "yes" || v === "y" || v === "true" || v === "billable" || v === "1") return true;
  if (v === "no" || v === "n" || v === "false" || v === "non-billable" || v === "0") return false;
  return false;
}


// ═════════════════════════════════════════════════════════════
//  FORMAT HELPERS
// ═════════════════════════════════════════════════════════════

function fmtDelta_(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1);
}

function fmtPct_(v) {
  if (v == null || isNaN(v)) return "—";
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "%";
}

function statusTier_(bill) {
  if (bill <= CONFIG.TIER.CRITICAL) return "🔴 Critical";
  if (bill <= CONFIG.TIER.LOW) return "🟠 Low";
  if (bill <= CONFIG.TIER.NORMAL) return "🟡 Normal";
  return "🟢 Champion";
}


// ═════════════════════════════════════════════════════════════
//  SHEET FORMATTING HELPERS
// ═════════════════════════════════════════════════════════════

/**
 * Clear + reset a sheet. Ensures at least `minRows` rows and 20 columns.
 * FIX v3.1: bumped default minimum to 800 rows to prevent overflow crashes.
 */
function resetSheet_(ss, name, minRows) {
  minRows = minRows || 800;
  let sh = ss.getSheetByName(name);
  if (sh) {
    sh.clearContents();
    sh.clearFormats();
    const maxR = sh.getMaxRows(), maxC = sh.getMaxColumns();
    sh.getRange(1, 1, maxR, maxC).breakApart();
    if (maxC < 20) sh.insertColumnsAfter(maxC, 20 - maxC);
    if (maxR < minRows) sh.insertRowsAfter(maxR, minRows - maxR);
    SpreadsheetApp.flush();
  } else {
    sh = ss.insertSheet(name);
    const maxR = sh.getMaxRows();
    if (maxR < minRows) sh.insertRowsAfter(maxR, minRows - maxR);
  }
  return sh;
}

/** Ensure the sheet has enough rows for the current write position. */
function ensureRows_(sh, neededRow) {
  const maxR = sh.getMaxRows();
  if (neededRow > maxR) {
    sh.insertRowsAfter(maxR, neededRow - maxR + 50);
  }
}

function styleHeader_(sh, row, nCols, height) {
  ensureRows_(sh, row);
  sh.getRange(row, 1, 1, nCols)
    .setBackground(COLORS.VOID_BLUE)
    .setFontColor("#FFFFFF").setFontWeight("bold")
    .setFontSize(9).setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(row, height || 32);
}

function sectionDivider_(sh, row, label, nCols) {
  ensureRows_(sh, row);
  sh.getRange(row, 1, 1, nCols).merge()
    .setValue(label)
    .setBackground(COLORS.ORBE_BLUE)
    .setFontColor("#FFFFFF").setFontWeight("bold")
    .setFontSize(10).setVerticalAlignment("middle");
  sh.setRowHeight(row, 26);
}

function subHeader_(sh, row, label, nCols) {
  ensureRows_(sh, row);
  sh.getRange(row, 1, 1, nCols).merge()
    .setValue(label)
    .setFontWeight("bold").setFontSize(9)
    .setFontColor(COLORS.VOID_BLUE).setBackground(COLORS.IVORY);
  sh.setRowHeight(row, 22);
}

function altBg_(index) {
  return index % 2 === 0 ? COLORS.LIGHT_CREAM : "#FFFFFF";
}


// ═════════════════════════════════════════════════════════════
//  DATA READERS
// ═════════════════════════════════════════════════════════════

function readCapacity_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.CAPACITY_SHEET);
  if (!sh) { Logger.log(`⚠️ Sheet "${CONFIG.CAPACITY_SHEET}" not found.`); return new Map(); }
  
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(h => String(h || "").trim());

  const C = {
    EMPLOYEE: headers.findIndex(h => /employee|name|resource|worker/i.test(h) && !/role|title/i.test(h)),
    ROLE: headers.findIndex(h => /role|job title|title/i.test(h)),
    HOURS: headers.findIndex(h => /capacity \(hrs\)|weekly capacity|hours/i.test(h)),
    PER_DAY: headers.findIndex(h => /capacity per day|daily capacity/i.test(h))
  };

  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) { Logger.log(`⚠️ Sheet "${CONFIG.CAPACITY_SHEET}" is empty.`); return new Map(); }
  
  // Fallback indices if headers are missing
  const f_empIdx = C.EMPLOYEE !== -1 ? C.EMPLOYEE : 0;
  const f_roleIdx = C.ROLE !== -1 ? C.ROLE : 1;
  const f_hoursIdx = C.HOURS !== -1 ? C.HOURS : 3;
  const f_dayIdx = C.PER_DAY !== -1 ? C.PER_DAY : 4;

  const map = new Map();
  for (let i = 1; i < raw.length; i++) {
    const empRaw = String(raw[i][f_empIdx] || "").trim();
    if (!empRaw || empRaw.toLowerCase() === "employee" || empRaw.toLowerCase() === "name") continue;
    const emp = normalizeToRoster_(empRaw);
    map.set(emp, {
      role: String(raw[i][f_roleIdx] || "").trim(),
      weeklyCapacity: parseFloat(raw[i][f_hoursIdx]) || CONFIG.WEEKLY_CAPACITY_HOURS,
      perDay: parseFloat(raw[i][f_dayIdx]) || CONFIG.DEFAULT_AVAILABLE_HOURS_PER_DAY
    });
  }
  
  if (map.size === 0) {
    Logger.log(`⚠️ Capacity found 0 records. Headers: [${headers.join(", ")}]`);
  } else {
    Logger.log(`✅ Capacity: ${map.size} records found`);
  }
  return map;
}

function readRoster_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ROSTER_SHEET);
  if (!sh) { Logger.log(`⚠️ Sheet "${CONFIG.ROSTER_SHEET}" not found.`); return new Map(); }
  
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(h => String(h || "").trim());
  
  Logger.log(`[Roster] Headers found: ${headers.join(" | ")}`);

  // Broaden keyword search for Roster columns
  const C = {
    // Specifically look for Name but avoid columns with Number/ID/Status
    NAME: headers.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h)),
    JOB_TITLE: headers.findIndex(h => /job title|title|profile/i.test(h)),
    LEVEL: headers.findIndex(h => /level|grade/i.test(h)),
    TEAM: headers.findIndex(h => /team|squad|group/i.test(h)),
    DEPT: headers.findIndex(h => /dept|department|business unit/i.test(h)),
    LOCATION: headers.findIndex(h => /location|office|subsidiary|country/i.test(h))
  };

  // Fallback indices based on sample log and user list
  const f_nameIdx = C.NAME !== -1 ? C.NAME : (headers.includes("Name") ? headers.indexOf("Name") : 3);
  const f_titleIdx = C.JOB_TITLE !== -1 ? C.JOB_TITLE : 6;
  const f_levelIdx = C.LEVEL !== -1 ? C.LEVEL : 12;
  const f_teamIdx = C.TEAM !== -1 ? C.TEAM : 13;
  const f_deptIdx = C.DEPT !== -1 ? C.DEPT : 11;
  const f_locIdx = C.LOCATION !== -1 ? C.LOCATION : 10;

  const raw = sh.getDataRange().getValues();
  const map = new Map();
  // Expanded to include I-levels (Individual Contributor) found in logs
  const targetLevels = ["L1", "L2", "L3", "L4", "L5", "L6", "I1", "I2", "I3", "I4", "I5", "I6"];

  for (let i = 1; i < raw.length; i++) {
    const name = String(raw[i][f_nameIdx] || "").trim();
    const rawLevel = String(raw[i][f_levelIdx] || "").trim();
    const levelUpper = rawLevel.toUpperCase();
    const jobTitle = String(raw[i][f_titleIdx] || "").trim();
    const team = String(raw[i][f_teamIdx] || "").trim() || "Unassigned Team";

    // Skip if name is empty or looks like a header/ID
    if (!name || name.toLowerCase() === "name" || name.toLowerCase() === "employee" || name.length < 3) continue;

    // DELIVERY TEAM FILTER (JF007 and JF009 / Crew Member)
    const titleUpper = jobTitle.toUpperCase();
    const isCrewMember = titleUpper.includes("CREW MEMBER") || levelUpper.includes("CREW");
    const isTargetedProfile = isCrewMember || CONFIG.TARGET_PREFIXES.some(prefix => titleUpper.includes(prefix.toUpperCase()));

    if (!isTargetedProfile) continue;

    // Filtering for Individual Contributor Levels (L or I) — Crew Members pass automatically
    const isICLevel = isCrewMember || targetLevels.some(tl => levelUpper.includes(tl));
    if (!isICLevel) continue;

    // Normalize level to L# or I# — Crew Members keep their level label
    const levelMatch = levelUpper.match(/[LI][1-6]/);
    const normalizedLevel = isCrewMember ? "Crew Member" : (levelMatch ? levelMatch[0] : rawLevel);

    map.set(name, {
      level: normalizedLevel,
      jobTitle,
      team,
      isTargetedProfile: true,
      dept: String(raw[i][f_deptIdx] || "").trim(),
      location: C.LOCATION !== -1 ? String(raw[i][f_locIdx] || "").trim() : "Unknown"
    });
  }

  if (map.size === 0) {
    Logger.log(`⚠️ Roster filtering (Delivery Team Focus) found 0 records.`);
    Logger.log(`Indices used: Name:${f_nameIdx}, Level:${f_levelIdx}, Team:${f_teamIdx}, Title:${f_titleIdx}`);
    if (raw.length > 1) Logger.log(`Sample Row 1 Data: ${raw[1].join(" | ")}`);
  } else {
    Logger.log(`✅ Roster: ${map.size} Delivery Team contributors found (07.I/09.I)`);
  }
  return map;
}

function readHoursLogged_(windowKeys) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.HOURS_LOGGED_SHEET);
  if (!sh) throw new Error(`Sheet "${CONFIG.HOURS_LOGGED_SHEET}" not found.`);
  
  const C = getColMap_(CONFIG.HOURS_LOGGED_SHEET, {
    EMPLOYEE: ["Employee", "Resource"],
    TYPE: ["Employee Type Category", "Type"],
    BILLED: ["Billable Hours Billed", "Billed"],
    UNBILLED: ["Billable Hours Unbilled", "Unbilled"],
    TOTAL_BILLABLE: ["Total Billable Hours", "Total Billable"],
    NON_BILLABLE: ["Non-Billable Hours", "Non-Billable"],
    TOTAL: ["Total Hours (B+NB)", "Total Hours", "Actual Time"],
    DATE: ["Date"]
  });

  const raw = sh.getDataRange().getValues();
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const empRaw = String(raw[i][C.EMPLOYEE] || "").trim();
    if (!empRaw || empRaw.toLowerCase().includes("employee")) continue;
    const emp = normalizeToRoster_(empRaw);
    const date = parseDate_(raw[i][C.DATE]);
    if (!date) continue;
    const wk = weekKey_(date);
    if (!windowKeys.has(wk)) continue;

    rows.push({
      employee: emp,
      empType: C.TYPE !== -1 ? String(raw[i][C.TYPE] || "").trim() : "",
      billableBilled: parseHours_(raw[i][C.BILLED]),
      billableUnbilled: parseHours_(raw[i][C.UNBILLED]),
      totalBillable: parseHours_(raw[i][C.TOTAL_BILLABLE]),
      nonBillable: parseHours_(raw[i][C.NON_BILLABLE]),
      totalHours: parseHours_(raw[i][C.TOTAL]),
      weekKey: wk,
      dateISO: date.toISOString().substring(0, 10)
    });
  }
  Logger.log(`✅ Hours Logged: ${rows.length} records in window`);
  return rows;
}

function readUtilization_(windowKeys, timeOffMap, phMap, rosterData) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.UTILIZATION_SHEET);
  if (!sh) { Logger.log(`⚠️ Sheet "${CONFIG.UTILIZATION_SHEET}" not found.`); return { dayAvailByEmpDate: new Map(), utilByEmpWeek: new Map() }; }
  
  const C = getColMap_(CONFIG.UTILIZATION_SHEET, {
    RESOURCE: ["Resource", "Employee", "Name"],
    DATE: ["Date"],
    ACTUAL: ["Actual Time", "Actual", "Total Hours"],
    AVAILABLE: ["Available Hours", "Available"],
    PROJECT: ["Project"]
  });

  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return { dayAvailByEmpDate: new Map(), utilByEmpWeek: new Map() };

  if (C.RESOURCE === -1 || C.DATE === -1) {
    Logger.log(`⚠️ Could not find Resource/Date column in "${CONFIG.UTILIZATION_SHEET}". Found: ${raw[0].join(", ")}`);
  }

  const dayAvailByEmpDate = new Map();
  const utilByEmpWeek = new Map();

  for (let i = 1; i < raw.length; i++) {
    const empRaw = String(raw[i][C.RESOURCE] || "").trim();
    if (!empRaw || empRaw.toLowerCase().includes("resource") || empRaw.toLowerCase().includes("employee")) continue;
    const emp = normalizeToRoster_(empRaw);
    const date = parseDate_(raw[i][C.DATE]);
    if (!date) continue;
    const wk = weekKey_(date);
    if (!windowKeys.has(wk)) continue;

    const dateISO = date.toISOString().substring(0, 10);
    const dayKey = `${emp}|${dateISO}`;
    const available = C.AVAILABLE !== -1 ? parseHours_(raw[i][C.AVAILABLE]) : 0;
    const actual = C.ACTUAL !== -1 ? parseHours_(raw[i][C.ACTUAL]) : 0;
    const project = C.PROJECT !== -1 ? String(raw[i][C.PROJECT] || "").trim() : "";

    // PTO Logic Integration
    const isNoCustomer = project.includes("- No Customer/Project");
    const ptoHours = timeOffMap ? (timeOffMap.get(dayKey) || 0) : 0;
    const roster = rosterData ? rosterData.get(emp) : null;
    const loc = roster ? roster.location : "Unknown";
    const holiday = phMap ? phMap.get(`${loc}|${dateISO}`) : null;
    
    // If it matches Time Off or PH, it's PTO
    const isPTO = isNoCustomer && (ptoHours > 0 || holiday);

    const prev = dayAvailByEmpDate.get(dayKey) || 0;
    dayAvailByEmpDate.set(dayKey, Math.max(prev, available));

    if (!utilByEmpWeek.has(emp)) utilByEmpWeek.set(emp, new Map());
    const empMap = utilByEmpWeek.get(emp);
    if (!empMap.has(wk)) empMap.set(wk, { actualTotal: 0, ptoTotal: 0, adminTotal: 0 });
    const wkData = empMap.get(wk);
    wkData.actualTotal += actual;
    if (isPTO) wkData.ptoTotal += actual;
    else if (isNoCustomer) wkData.adminTotal += actual;
  }
  Logger.log(`✅ Utilization: ${dayAvailByEmpDate.size} day-level availability records`);
  return { dayAvailByEmpDate, utilByEmpWeek };
}

function readPH_(windowKeys) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.PH_SHEET);
  if (!sh) { Logger.log(`⚠️ Sheet "${CONFIG.PH_SHEET}" not found.`); return new Map(); }
  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return new Map();

  const headers = raw[0].map(h => String(h || "").toLowerCase().trim());
  const iDate = headers.indexOf("date");
  const iLoc = headers.indexOf("location");
  const iHol = headers.indexOf("holiday");

  if (iDate === -1 || iLoc === -1) {
    Logger.log(`⚠️ PH sheet missing Date/Location headers.`);
    return new Map();
  }

  const map = new Map();
  for (let i = 1; i < raw.length; i++) {
    const d = parseDate_(raw[i][iDate]);
    if (!d) continue;
    const iso = d.toISOString().substring(0, 10);
    const loc = String(raw[i][iLoc] || "").trim();
    const hol = iHol !== -1 ? String(raw[i][iHol] || "").trim() : "Public Holiday";
    map.set(`${loc}|${iso}`, hol);
  }
  Logger.log(`✅ PH: ${map.size} holiday records loaded`);
  return map;
}

function readTimeOff_(windowKeys) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TIME_OFF_SHEET);
  if (!sh) { Logger.log(`⚠️ Sheet "${CONFIG.TIME_OFF_SHEET}" not found.`); return new Map(); }
  const raw = sh.getDataRange().getValues();
  if (raw.length <= 1) return new Map();

  const headers = raw[0].map(h => String(h || "").toLowerCase().trim());
  const iEmp = headers.findIndex(h => h === "name" || h === "employee" || h === "resource");
  const iDate = headers.findIndex(h => h === "date");
  const iStart = headers.findIndex(h => h === "start date");
  const iEnd = headers.findIndex(h => h === "end date");
  const iHours = headers.findIndex(h => /hours|amount|sum/i.test(h));
  const iStatus = headers.findIndex(h => /status|type/i.test(h));

  const hasSingleDate = iDate !== -1;
  const hasDateRange = iStart !== -1;

  if (iEmp === -1 || (!hasSingleDate && !hasDateRange)) {
    Logger.log(`⚠️ Time Off sheet missing Employee Name and Date info.`);
    return new Map();
  }

  const map = new Map();
  for (let i = 1; i < raw.length; i++) {
    const empRaw = String(raw[i][iEmp] || "").trim();
    if (!empRaw) continue;
    const emp = normalizeToRoster_(empRaw);

    if (hasSingleDate) {
      const date = parseDate_(raw[i][iDate]);
      if (!date) continue;
      const iso = date.toISOString().substring(0, 10);
      const key = `${emp}|${iso}`;
      // In this format, each row is a day. Assume 8h unless specified.
      const hrs = iHours !== -1 ? (parseFloat(raw[i][iHours]) || 8) : 8;
      map.set(key, (map.get(key) || 0) + hrs);
    } else if (hasDateRange) {
      const start = parseDate_(raw[i][iStart]);
      const end = iEnd !== -1 ? parseDate_(raw[i][iEnd]) : start;
      if (!start) continue;

      const days = expandWeekdays_(start, end || start);
      const totalHours = iHours !== -1 ? (parseFloat(raw[i][iHours]) || 0) : (days.length * 8);
      const hpd = totalHours / (days.length || 1);

      for (const d of days) {
        const iso = d.toISOString().substring(0, 10);
        const key = `${emp}|${iso}`;
        map.set(key, (map.get(key) || 0) + hpd);
      }
    }
  }
  Logger.log(`✅ Time Off: ${map.size} employee-day records loaded`);
  return map;
}

function expandWeekdays_(start, end) {
  const out = [];
  let cur = new Date(start);
  cur.setHours(0,0,0,0);
  const stop = new Date(end);
  stop.setHours(0,0,0,0);
  while (cur <= stop) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function readTempo_(windowKeys) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.TEMPO_SHEET);
  if (!sh) return { tempoByEmpWeek: new Map(), tempoWeekKeys: new Set() };
  
  const raw = sh.getDataRange().getValues();
  const headers = raw[0];
  const userCol = headers.findIndex(h => {
    const s = String(h).toLowerCase();
    return s.includes("user") || s.includes("worker") || s.includes("resource") || s.includes("employee");
  });
  if (userCol === -1) return { tempoByEmpWeek: new Map(), tempoWeekKeys: new Set() };

  const dateCols = [];
  for (let c = 0; c < headers.length; c++) {
    const d = parseTempoDateHeader_(headers[c]);
    if (d) dateCols.push({ col: c, date: d, weekKey: weekKey_(d) });
  }

  const tempoWeekKeys = new Set(dateCols.map(dc => dc.weekKey).filter(wk => windowKeys.has(wk)));
  const tempoByEmpWeek = new Map();
  for (let i = 1; i < raw.length; i++) {
    const empRaw = String(raw[i][userCol] || "").trim();
    if (!empRaw || empRaw.toLowerCase().includes("user") || empRaw.toLowerCase().includes("employee")) continue;
    const emp = normalizeToRoster_(empRaw);
    if (!tempoByEmpWeek.has(emp)) tempoByEmpWeek.set(emp, new Map());
    const empMap = tempoByEmpWeek.get(emp);
    for (const dc of dateCols) {
      if (!windowKeys.has(dc.weekKey)) continue;
      const hrs = parseFloat(raw[i][dc.col]) || 0;
      if (hrs === 0) continue;
      if (!empMap.has(dc.weekKey)) empMap.set(dc.weekKey, { tempoTotal: 0 });
      empMap.get(dc.weekKey).tempoTotal += hrs;
    }
  }
  Logger.log(`✅ Tempo: ${tempoByEmpWeek.size} employees, ${tempoWeekKeys.size} weeks`);
  return { tempoByEmpWeek, tempoWeekKeys };
}

function readBacklog_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.BACKLOG_SHEET);
  if (!sh) return new Map();
  
  const raw = sh.getDataRange().getValues();
  const headers = raw[0].map(h => String(h).toLowerCase().trim());
  const assigneeCol = headers.findIndex(h => h.includes("assignee"));
  const statusCol = headers.findIndex(h => h.includes("status"));
  
  if (assigneeCol === -1) return new Map();
  
  const map = new Map();
  for (let i = 1; i < raw.length; i++) {
    const assigneeRaw = String(raw[i][assigneeCol] || "").trim();
    if (!assigneeRaw) continue;
    const assignee = normalizeToRoster_(assigneeRaw);
    const status = statusCol !== -1 ? String(raw[i][statusCol] || "").trim().toLowerCase() : "";
    if (status.includes("done") || status.includes("closed") || status.includes("resolved")) continue;
    map.set(assignee, (map.get(assignee) || 0) + 1);
  }
  return map;
}


// ═════════════════════════════════════════════════════════════
//  CORE ANALYTICS ENGINE
// ═════════════════════════════════════════════════════════════

function zeroEntry_(employee, empType, weekKey) {
  return {
    employee, empType, weekKey,
    billableBilled: 0, billableUnbilled: 0,
    totalBillable: 0, nonBillable: 0, totalHours: 0,
    availableHours: 0,
    hasNoLog: true,
  };
}

function buildEmployeeMatrix_(rows, weekWindow, roster) {
  const wKeys = weekWindow.map(d => d.toISOString().substring(0, 10));
  const buckets = new Map();
  const empTypes = new Map();
  for (const r of rows) {
    const key = `${r.employee}|${r.weekKey}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        employee: r.employee, weekKey: r.weekKey,
        billableBilled: 0, billableUnbilled: 0,
        totalBillable: 0, nonBillable: 0, totalHours: 0,
        availableHours: 0,
        hasNoLog: false,
      });
    }
    const b = buckets.get(key);
    b.billableBilled += r.billableBilled;
    b.billableUnbilled += r.billableUnbilled;
    b.totalBillable += r.totalBillable;
    b.nonBillable += r.nonBillable;
    b.totalHours += r.totalHours;
    b.availableHours += (r.availableHours || 0);
    empTypes.set(r.employee, r.empType);
  }
  const matrix = new Map();
  for (const emp of roster) {
    const type = empTypes.get(emp) || "";
    matrix.set(emp, wKeys.map(wk => buckets.get(`${emp}|${wk}`) || zeroEntry_(emp, type, wk)));
  }
  Logger.log(`✅ Matrix: ${matrix.size} employees`);
  return matrix;
}


// ═════════════════════════════════════════════════════════════
//  SEGMENTATION ENGINE
// ═════════════════════════════════════════════════════════════

function classifyBehavior_(entries, hasAlloc) {
  const [w2, w1, w0] = entries;
  const b = [w2.totalBillable, w1.totalBillable, w0.totalBillable];
  const nb = [w2.nonBillable, w1.nonBillable, w0.nonBillable];

  if (hasAlloc && b[1] <= CONFIG.GHOST_MAX_BILL_W0 && b[2] <= CONFIG.GHOST_MAX_BILL_W0) {
    return BEHAVIORS.GHOST;
  }
  const billDrop = b[0] - b[2];
  const nbRise = nb[2] - nb[0];
  if (billDrop >= CONFIG.DECLINING_MIN_BILL_DROP && nbRise >= CONFIG.NB_SHIFT_MIN_RISE_H) {
    return BEHAVIORS.NB_SHIFT;
  }
  const wow01 = b[1] - b[0];
  const wow12 = b[2] - b[1];
  if (wow01 <= -CONFIG.DECLINING_MIN_BILL_DROP && wow12 <= -CONFIG.DECLINING_MIN_BILL_DROP) {
    return BEHAVIORS.DECLINING;
  }
  if (wow01 >= 0 && wow12 > 0) return BEHAVIORS.IMPROVING;
  if (b.every(v => v > CONFIG.TIER.LOW) && !entries.some(e => e.hasNoLog)) {
    return BEHAVIORS.COMPLIANT;
  }
  return BEHAVIORS.INCONSISTENT;
}

function generateWoWSignal_(curr, prev) {
  if (!prev || prev.hasNoLog) {
    if (curr.hasNoLog) return { narrative: "⚠️ No Hours Logged.", drivers: [], signalText: "⚠️ No Hours Logged." };
    const txt = prev ? "📈 Return to logging." : "First evaluation week.";
    return { narrative: txt, drivers: [], signalText: txt };
  }
  if (curr.hasNoLog) {
    return { narrative: "⚠️ No Hours Logged this week.", drivers: [], signalText: "⚠️ No Hours Logged this week." };
  }

  const dBill = curr.totalBillable - prev.totalBillable;
  const dNB = curr.nonBillable - prev.nonBillable;
  const dTotal = curr.totalHours - prev.totalHours;
  const dCapUtil = curr.capUtil - prev.capUtil;
  const drivers = [];

  if (Math.abs(dBill) >= 2) {
    drivers.push({
      metric: "Billable", delta: dBill, direction: dBill > 0 ? "up" : "down",
      text: `Billable ${dBill > 0 ? "↑" : "↓"} ${Math.abs(dBill).toFixed(1)}h`,
    });
  }
  if (Math.abs(dNB) >= 2) {
    drivers.push({
      metric: "NonBillable", delta: dNB, direction: dNB > 0 ? "up" : "down",
      text: `NB ${dNB > 0 ? "↑" : "↓"} ${Math.abs(dNB).toFixed(1)}h`,
    });
  }
  if (Math.abs(dCapUtil) >= 5) {
    drivers.push({
      metric: "CapUtil", delta: dCapUtil, direction: dCapUtil > 0 ? "up" : "down",
      text: `Util ${dCapUtil > 0 ? "↑" : "↓"} ${Math.abs(dCapUtil).toFixed(1)}pp`,
    });
  }

  let narrative;
  if (dBill > 2 && dNB < -2) narrative = "🎯 Productivity Shift — billable up, admin down.";
  else if (dBill < -2 && dNB > 2) narrative = "⚖️ Admin Burden — billable dropped, offset by non-billable rise.";
  else if (dBill < -4 && Math.abs(dNB) < 1) narrative = "📉 Capacity Drop — significant billable loss without NB offset.";
  else if (dBill > 4 && Math.abs(dNB) < 1) narrative = "🚀 Billable Surge — strong increase in core output.";
  else if (Math.abs(dTotal) < 2) narrative = "⏸️ Steady — minimal change WoW.";
  else if (dTotal > 2 && dBill > 0) narrative = "📈 Ramping — total hours growing, billable contributing.";
  else if (dTotal < -2 && dBill < 0) narrative = "📉 Cooling — total hours and billable both down.";
  else narrative = "↔️ Mixed — no dominant pattern.";

  const signalText = [narrative, ...drivers.map(d => d.text)].join(" | ");
  return { narrative, drivers, signalText };
}


// ═════════════════════════════════════════════════════════════
//  ENRICHMENT
// ═════════════════════════════════════════════════════════════

/**
 * Read Backlog filtered by target week and issue types.
 * Captures Open vs Resolved vs Overdue contribution.
 */
function readBacklog_(w0Key) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Backlog");
  if (!sh) {
    Logger.log(`⚠️ Backlog tab not found — skipping backlog signal.`);
    return new Map();
  }

  const C = getColMap_("Backlog", {
    ASSIGNEE: ["Assignee"],
    STATUS: ["Status"],
    TYPE: ["Issue Type"],
    RESOLVED: ["Resolved"],
    DUE: ["Due date"],
    WEEK: ["Week"]
  });

  if (C.ASSIGNEE === -1) {
    Logger.log(`⚠️ Backlog: 'Assignee' column not found.`);
    return new Map();
  }
  
  const map = new Map(); // employee -> { open: 0, resolved: 0, overdue: 0 }
  const raw = sh.getDataRange().getValues();

  const STRATEGIC_TYPES = ['Kick-off epic', 'Epic', 'Go-live epic'];
  const EXECUTION_TYPES = ['Task', 'Story', 'Sub-task'];
  const ALL_TYPES = [...STRATEGIC_TYPES, ...EXECUTION_TYPES];

  for (let i = 1; i < raw.length; i++) {
    const weekVal = String(raw[i][C.WEEK] || "").trim();
    if (weekVal !== w0Key) continue;

    const assigneeRaw = String(raw[i][C.ASSIGNEE] || "").trim();
    if (!assigneeRaw) continue;
    const assignee = normalizeToRoster_(assigneeRaw);

    const type = String(raw[i][C.TYPE] || "").trim();
    if (!ALL_TYPES.includes(type)) continue;

    const status = String(raw[i][C.STATUS] || "").trim().toLowerCase();
    const resolvedDate = parseDate_(raw[i][C.RESOLVED]);
    const dueDate = parseDate_(raw[i][C.DUE]);

    if (!map.has(assignee)) map.set(assignee, { open: 0, resolved: 0, overdue: 0 });
    const stats = map.get(assignee);

    const isDone = status.includes("done") || status.includes("closed") || status.includes("resolved");
    if (isDone) {
      stats.resolved++;
      if (resolvedDate && dueDate && resolvedDate > dueDate) {
        stats.overdue++;
      }
    } else {
      stats.open++;
    }
  }
  Logger.log(`✅ Backlog ${w0Key}: ${map.size} contributors found.`);
  return map;
}

function enrichMatrix_(matrix, utilData, capacityData, rosterData, backlogData, weekWindow) {
  const flatEntries = [];
  const empSummary = new Map();
  const { dayAvailByEmpDate } = utilData;

  for (const [employee, entries] of matrix) {
    const [w2, w1, w0] = entries;
    const roster = rosterData.get(employee) || {
      level: "—", team: "Unassigned Team", jobTitle: "—", isTargetedProfile: false
    };
    const backlogCount = backlogData.get(employee) || 0;
    const behavior = classifyBehavior_(entries, true);
    const cap = capacityData.get(employee) || {
      role: "—", skills: "—", weeklyCapacity: CONFIG.WEEKLY_CAPACITY_HOURS, perDay: CONFIG.DEFAULT_AVAILABLE_HOURS_PER_DAY
    };
    const bStats = backlogData.get(employee) || { open: 0, resolved: 0, overdue: 0 };

    entries.forEach((entry, idx) => {
      const wk = weekWindow[idx].toISOString().substring(0, 10);
      let weekAvail = 0;
      const d = new Date(weekWindow[idx]);
      for (let i = 0; i < 7; i++) {
        const iso = d.toISOString().substring(0, 10);
        weekAvail += dayAvailByEmpDate.get(`${employee}|${iso}`) || 0;
        d.setDate(d.getDate() + 1);
      }
      if (weekAvail <= 0) weekAvail = cap.weeklyCapacity;
      
      entry.availableHours = weekAvail;
      
      // PTO refinement from Utilization/Time Off data
      const empUtilMap = utilData.utilByEmpWeek.get(employee);
      const ptoHrs = (empUtilMap && empUtilMap.has(wk)) ? empUtilMap.get(wk).ptoTotal : 0;
      const adminHrs = (empUtilMap && empUtilMap.has(wk)) ? empUtilMap.get(wk).adminTotal : 0;
      
      entry.ptoHours = ptoHrs;
      entry.adminHours = adminHrs;

      const billRate = entry.totalHours > 0 ? (entry.totalBillable / entry.totalHours * 100) : 0;
      const capUtil = weekAvail > 0 ? (entry.totalHours / weekAvail * 100) : 0;
      
      entry.billRate = parseFloat(billRate.toFixed(1));
      entry.capUtil = parseFloat(capUtil.toFixed(1));

      const prev = idx > 0 ? entries[idx - 1] : null;
      const signal = generateWoWSignal_(entry, prev);

      flatEntries.push({
        ...entry,
        weekMonday: weekWindow[idx],
        weekLabel: formatWeekRange_(weekWindow[idx]),
        weekTag: ["W-2", "W-1", "W0"][idx],
        billRateStr: billRate.toFixed(1),
        capUtilStr: capUtil.toFixed(1),
        tier: statusTier_(entry.totalBillable),
        behavior,
        signal,
        team: roster.team,
        level: roster.level,
        isTargeted: roster.isTargetedProfile,
        backlog: bStats.open,
        contribution: bStats.resolved,
        overdue: bStats.overdue
      });
    });

    const avails = entries.map(e => e.availableHours);
    const utils = entries.map((e, i) => (avails[i] > 0 ? (e.totalHours / avails[i] * 100) : 0));
    
    empSummary.set(employee, {
      employee,
      empType: w0.empType || "",
      role: cap.role,
      level: roster.level,
      team: roster.team,
      isTargeted: roster.isTargetedProfile,
      backlog: bStats.open,
      contribution: bStats.resolved,
      overdue: bStats.overdue,
      capacity: avails[2] || cap.weeklyCapacity,
      avails,
      b: [w2.totalBillable, w1.totalBillable, w0.totalBillable],
      nb: [w2.nonBillable, w1.nonBillable, w0.nonBillable],
      billed: [w2.billableBilled, w1.billableBilled, w0.billableBilled],
      unbilled: [w2.billableUnbilled, w1.billableUnbilled, w0.billableUnbilled],
      pto: [w2.ptoHours, w1.ptoHours, w0.ptoHours],
      admin: [w2.adminHours, w1.adminHours, w0.adminHours],
      totals: [w2.totalHours, w1.totalHours, w0.totalHours],
      utils: utils.map(u => u.toFixed(1)),
      w0BillRate: w0.totalHours > 0 ? (w0.totalBillable / w0.totalHours * 100).toFixed(1) : "0.0",
      overallBillDelta: w0.totalBillable - w2.totalBillable,
      overallNBDelta: w0.nonBillable - w2.nonBillable,
      behavior,
      hasNoLogWeeks: entries.filter(e => e.hasNoLog).length,
    });
  }

  const weekOrd = { "W-2": 0, "W-1": 1, "W0": 2 };
  flatEntries.sort((a, b) => {
    const w = weekOrd[a.weekTag] - weekOrd[b.weekTag];
    if (w !== 0) return w;
    if (a.isTargeted !== b.isTargeted) return a.isTargeted ? -1 : 1;
    if (a.level !== b.level) return a.level.localeCompare(b.level);
    return a.employee.localeCompare(b.employee);
  });
  return { flatEntries, empSummary };
}


// ═════════════════════════════════════════════════════════════
//  RECONCILIATION
// ═════════════════════════════════════════════════════════════

function buildReconciliation_(matrix, sourceMap, getTotal, coveredKeys, weekWindow, sourceName) {
  const wKeys = weekWindow.map(d => d.toISOString().substring(0, 10));
  const tol = CONFIG.TOLERANCE_HOURS;
  const recon = new Map();

  for (const [employee, entries] of matrix) {
    const srcEmp = sourceMap.get(employee);
    const hasSource = !!srcEmp;
    let totalHL = 0, totalSrc = 0, matchCount = 0, mismatchCount = 0, noDataCount = 0;

    const weeks = entries.map((entry, idx) => {
      const wk = wKeys[idx];
      const hl = entry.totalHours;
      totalHL += hl;
      const covered = coveredKeys ? coveredKeys.has(wk) : true;
      if (!covered || !hasSource) {
        noDataCount++;
        return { weekKey: wk, hoursLogged: hl, sourceTotal: null, delta: null, status: `— No ${sourceName}` };
      }
      const bucket = srcEmp.get(wk);
      const srcTotal = bucket ? getTotal(bucket) : 0;
      totalSrc += srcTotal;
      const delta = hl - srcTotal;
      let status;
      if (Math.abs(delta) <= tol) { status = "✅ Match"; matchCount++; }
      else { status = delta > 0 ? "⬆️ HL Higher" : `⬇️ ${sourceName} Higher`; mismatchCount++; }
      return { weekKey: wk, hoursLogged: hl, sourceTotal: srcTotal, delta, status };
    });

    let overallStatus;
    if (!hasSource) overallStatus = `ℹ️ No ${sourceName} Data`;
    else if (mismatchCount === 0 && matchCount > 0) overallStatus = "✅ Match";
    else if (mismatchCount > 0 && matchCount > 0) overallStatus = "⚠️ Partial Mismatch";
    else if (mismatchCount > 0) overallStatus = "❌ Mismatch";
    else overallStatus = "ℹ️ Insufficient Data";

    recon.set(employee, {
      weeks, overallStatus,
      totalHLSum: totalHL, totalSourceSum: totalSrc,
      totalDelta: totalHL - totalSrc,
      matchCount, mismatchCount, noDataCount,
    });
  }
  Logger.log(`✅ Reconciliation (${sourceName}): ${recon.size} employees`);
  return recon;
}

function buildTempoReconciliation_(matrix, tempoByEmpWeek, tempoWeekKeys, weekWindow) {
  return buildReconciliation_(matrix, tempoByEmpWeek, b => b.tempoTotal, tempoWeekKeys, weekWindow, "Tempo");
}

function buildUtilReconciliation_(matrix, utilByEmpWeek, weekWindow) {
  return buildReconciliation_(matrix, utilByEmpWeek, b => b.actualTotal, null, weekWindow, "Utilization Actual");
}


// ═════════════════════════════════════════════════════════════
//  OUTPUT: 📊 WEEKLY ANALYTICS SHEET
// ═════════════════════════════════════════════════════════════

function buildAnalyticsSheet_(flatEntries, weekWindow) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = resetSheet_(ss, CONFIG.ANALYTICS_SHEET);
  const HEADERS = [
    "Week", "Employee", "Level", "Team", "Available\nHours (h)",
    "Billed (h)", "Unbilled (h)", "Total\nBillable (h)",
    "PTO (h)", "Admin (h)", "Actual\nTime (h)", "Billing\nRate %", "Util\nRate %",
    "Tier", "WoW Signal Analysis",
  ];
  const N = HEADERS.length;

  sh.getRange(1, 1).setValue(CONFIG.SCRIPT_LABEL + " — Delivery Team Analysis")
    .setFontSize(13).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
  sh.getRange(2, 1).setValue(
    `Window: ${formatWeekRange_(weekWindow[0])} → ${formatWeekRange_(weekWindow[2])}  |  Focus: Delivery Team (07.I / 09.I)`
  ).setFontSize(9).setFontColor("#888888").setFontStyle("italic");
  sh.getRange(3, 1).setValue(
    "Signal Analysis: Fact, Note, Highlight, Concern framework for EWS/REX readiness. | Includes: 07.I / 09.I / Crew Member | PTO identified via Time Off/PH match."
  ).setFontSize(8).setFontColor(COLORS.ORBE_BLUE).setFontStyle("italic");

  const HDR = 5;
  sh.getRange(HDR, 1, 1, N).setValues([HEADERS]);
  styleHeader_(sh, HDR, N, 40);

  let lastTag = "", alt = false;
  flatEntries.forEach((e, i) => {
    const row = HDR + 1 + i;
    ensureRows_(sh, row);
    if (e.weekTag !== lastTag) { alt = !alt; lastTag = e.weekTag; }
    sh.getRange(row, 1, 1, N).setValues([[
      e.weekLabel, e.employee, e.level, e.team, e.availableHours.toFixed(1),
      e.billableBilled.toFixed(1), e.billableUnbilled.toFixed(1), e.totalBillable.toFixed(1),
      e.ptoHours.toFixed(1), e.adminHours.toFixed(1), e.totalHours.toFixed(1),
      e.billRateStr + "%", e.capUtilStr + "%",
      e.tier, e.signal.signalText,
    ]]);
    const bg = e.hasNoLog ? SIGNAL_BG.NO_LOG : (alt ? COLORS.LIGHT_CREAM : "#FFFFFF");
    sh.getRange(row, 1, 1, N).setBackground(bg);
    sh.getRange(row, 14).setBackground(TIER_BG[e.tier] || "#FFFFFF").setFontWeight("bold").setHorizontalAlignment("center");
    const sig = sh.getRange(row, 15);
    const txt = e.signal.narrative;
    if (txt.includes("Productivity")) sig.setFontColor("#0D4721").setFontWeight("bold");
    else if (txt.includes("Admin Burden")) sig.setFontColor("#7F4900").setFontWeight("bold");
    else if (txt.includes("Drop") || txt.includes("Cooling")) sig.setFontColor("#A50000").setFontWeight("bold");
    else if (txt.includes("Surge") || txt.includes("Ramping")) sig.setFontColor("#2864E6").setFontWeight("bold");
    sh.getRange(row, 5, 1, 10).setHorizontalAlignment("right");
  });

  [160, 130, 60, 120, 95, 75, 75, 80, 60, 60, 80, 72, 72, 120, 400].forEach((w, c) => sh.setColumnWidth(c + 1, w));
  sh.setFrozenRows(HDR);
  sh.setFrozenColumns(2);
  Logger.log(`✅ Analytics sheet: ${flatEntries.length} rows`);
}


// ═════════════════════════════════════════════════════════════
//  OUTPUT: 📋 SUMMARY REPORT — Section builders
// ═════════════════════════════════════════════════════════════

function writePulseSection_(sh, R, matrix, weekWindow, nEmp) {
  const NCOLS = 9;
  const wLabels = weekWindow.map(shortWeekLabel_);
  sectionDivider_(sh, R, "▌ A.  COMPANY PULSE — Total Company Output vs Capacity Room", NCOLS);
  R++;

  const team = { bill: [0, 0, 0], nb: [0, 0, 0], pto: [0, 0, 0], admin: [0, 0, 0], total: [0, 0, 0], cap: [0, 0, 0], active: [0, 0, 0] };
  for (const entries of matrix.values()) {
    [0, 1, 2].forEach(i => {
      team.bill[i] += entries[i].totalBillable;
      team.nb[i] += entries[i].nonBillable;
      team.pto[i] += entries[i].ptoHours;
      team.admin[i] += entries[i].adminHours;
      team.total[i] += entries[i].totalHours;
      team.cap[i] += entries[i].availableHours;
      if (entries[i].totalHours > 0) team.active[i]++;
    });
  }

  sh.getRange(R, 1, 1, 6).setValues([["Metric", wLabels[0], wLabels[1], wLabels[2],
    `WoW Δ\n(${wLabels[1]}→${wLabels[2]})`, "Capacity Room (Unlogged)"]]);
  styleHeader_(sh, R, 6);
  R++;

  const pulseRows = [
    ["Team Billable (h)", ...team.bill.map(v => v.toFixed(1)), fmtDelta_(team.bill[2] - team.bill[1]), ""],
    ["Team Non-Billable (h)", ...team.nb.map(v => v.toFixed(1)), fmtDelta_(team.nb[2] - team.nb[1]), ""],
    ["  ↳ PTO (h)", ...team.pto.map(v => v.toFixed(1)), fmtDelta_(team.pto[2] - team.pto[1]), ""],
    ["  ↳ Admin (h)", ...team.admin.map(v => v.toFixed(1)), fmtDelta_(team.admin[2] - team.admin[1]), ""],
    ["Team Total Output (h)", ...team.total.map(v => v.toFixed(1)), fmtDelta_(team.total[2] - team.total[1]), ""],
    ["Total Capacity (h)", ...team.cap.map(v => v.toFixed(1)), "—", ""],
    ["Capacity Room (Gap)", ...[0,1,2].map(i => (team.cap[i] - team.total[i]).toFixed(1)), "—", 
     ((team.cap[2] - team.total[2]) / team.cap[2] * 100).toFixed(1) + "% gap"],
    [`Active Contributors (of ${nEmp})`, ...team.active, "—",
      team.active[2] === nEmp ? "✅ Full team" : `⚠️ ${nEmp - team.active[2]} not logging`],
  ];

  pulseRows.forEach((row, ri) => {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, 6).setValues([row]).setBackground(altBg_(ri));
    sh.getRange(R, 1).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
    if (row[0].includes("Room")) {
      const gapVal = team.cap[2] - team.total[2];
      sh.getRange(R, 1, 1, 6).setFontColor("#A50000").setFontWeight("bold");
      sh.getRange(R, 6).setBackground(gapVal > 40 ? SIGNAL_BG.DROP : SIGNAL_BG.MATCH);
    }
    R++;
  });
  return R + 1;
}

function writeContributionMatrix_(sh, R, empSummary, weekWindow) {
  const NCOLS = 12;
  const wLabels = weekWindow.map(shortWeekLabel_);
  sectionDivider_(sh, R, "▌ B.  EMPLOYEE CONTRIBUTION MATRIX — Billable · Non-Billable · Contribution Volume", NCOLS);
  R++;
  sh.getRange(R, 1, 1, NCOLS).setValues([[
    "Employee", "Level", "Team",
    `${wLabels[0]}\nBill`, `${wLabels[1]}\nBill`, `${wLabels[2]}\nBill`,
    `W0\nPTO`, `W0\nAdmin`, "W0\nNon-Bill",
    "Contrib. Volume\n(Tasks/Stories)", "Billing\nRate W0 %", "W0 Cap Util %",
  ]]);
  styleHeader_(sh, R, NCOLS, 40);
  R++;

  const sorted = [...empSummary.values()].sort((a, b) => {
    if (a.isTargeted !== b.isTargeted) return a.isTargeted ? -1 : 1;
    return a.employee.localeCompare(b.employee);
  });

  sorted.forEach((emp, ri) => {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, NCOLS).setValues([[
      emp.employee, emp.level, emp.team,
      ...emp.b.map(v => v.toFixed(1)), 
      emp.pto[2].toFixed(1), emp.admin[2].toFixed(1), emp.nb[2].toFixed(1),
      emp.contribution, emp.w0BillRate + "%", emp.utils[2] + "%",
    ]]).setBackground(altBg_(ri));
    
    if (emp.isTargeted) sh.getRange(R, 1).setFontColor("#2864E6").setFontWeight("bold");

    [0, 1, 2].forEach(i => sh.getRange(R, 4 + i).setBackground(TIER_BG[statusTier_(emp.b[i])] || "#FFFFFF"));
    const br = parseFloat(emp.w0BillRate);
    sh.getRange(R, 11).setBackground(br >= 80 ? SIGNAL_BG.RISE : br < 50 ? SIGNAL_BG.DROP : "#FFF9C4");
    const u = parseFloat(emp.utils[2]);
    sh.getRange(R, 12).setBackground(u >= 100 ? SIGNAL_BG.RISE : u < 75 ? SIGNAL_BG.DROP : "#FFF9C4")
      .setFontWeight("bold").setHorizontalAlignment("center");
    
    // Highlight contribution if > 0
    if (emp.contribution > 0) sh.getRange(R, 10).setFontWeight("bold").setFontColor("#0D4721");
    R++;
  });
  return R + 1;
}

/** Section C: Segmentation Breakdown — employees grouped by behavior. */
function writeSegmentationSection_(sh, R, empSummary, weekWindow) {
  const NCOLS = 9;
  const wLabels = weekWindow.map(shortWeekLabel_);
  sectionDivider_(sh, R, "▌ C.  SEGMENTATION BREAKDOWN — What's driving contribution WoW?", NCOLS);
  R++;

  const groups = {};
  for (const bKey of Object.keys(BEHAVIORS)) groups[bKey] = [];
  for (const emp of empSummary.values()) {
    const bKey = Object.keys(BEHAVIORS).find(k => BEHAVIORS[k] === emp.behavior) || "INCONSISTENT";
    groups[bKey].push(emp);
  }

  sh.getRange(R, 1, 1, NCOLS).setValues([["Segment", "Count", "% of Team",
    `Avg Bill\n${wLabels[2]}`, `Avg NB\n${wLabels[2]}`, "Avg Bill\nRate %",
    "3-Wk Bill Δ", "Key Signal", ""]]);
  styleHeader_(sh, R, NCOLS, 40);
  R++;

  const total = empSummary.size;
  for (const [bKey, bDef] of Object.entries(BEHAVIORS)) {
    const members = groups[bKey];
    if (members.length === 0) continue;
    ensureRows_(sh, R);

    const avgBillW0 = members.reduce((s, e) => s + e.b[2], 0) / members.length;
    const avgNBW0 = members.reduce((s, e) => s + e.nb[2], 0) / members.length;
    const avgBillRate = members.reduce((s, e) => s + parseFloat(e.w0BillRate), 0) / members.length;
    const avgBillDelta = members.reduce((s, e) => s + e.overallBillDelta, 0) / members.length;

    sh.getRange(R, 1, 1, NCOLS).setValues([[
      `${bDef.icon} ${bDef.label}`, members.length,
      (members.length / total * 100).toFixed(0) + "%",
      avgBillW0.toFixed(1) + "h", avgNBW0.toFixed(1) + "h", avgBillRate.toFixed(1) + "%",
      fmtDelta_(avgBillDelta) + "h", bDef.desc, "",
    ]]);
    sh.getRange(R, 1).setBackground(bDef.bg).setFontColor(bDef.fg).setFontWeight("bold");
    // FIX v3.1: use pre-defined light tint instead of invalid alpha hex
    sh.getRange(R, 2, 1, NCOLS - 1).setBackground(BEHAVIOR_TINT[bKey] || "#FFFFFF");
    R++;
  }
  R++;

  // Per-segment employee detail
  for (const [bKey, bDef] of Object.entries(BEHAVIORS)) {
    const members = groups[bKey].sort((a, b) => a.employee.localeCompare(b.employee));
    if (members.length === 0) continue;

    subHeader_(sh, R, `${bDef.icon} ${bDef.label} — ${members.length} employee(s): ${bDef.desc}`, NCOLS);
    R++;
    sh.getRange(R, 1, 1, NCOLS).setValues([[
      "Employee", `${wLabels[2]} Bill`, `${wLabels[2]} PTO`, `${wLabels[2]} Admin`,
      `${wLabels[0]} Bill`, `${wLabels[1]} Bill`, 
      "3-Wk Bill Δ", "Bill Rate W0", "",
    ]]);
    styleHeader_(sh, R, NCOLS);
    R++;

    members.forEach((emp, ri) => {
      ensureRows_(sh, R);
      sh.getRange(R, 1, 1, NCOLS).setValues([[
        emp.employee, emp.b[2].toFixed(1), emp.pto[2].toFixed(1), emp.admin[2].toFixed(1),
        emp.b[0].toFixed(1), emp.b[1].toFixed(1),
        fmtDelta_(emp.overallBillDelta) + "h", emp.w0BillRate + "%", "",
      ]]).setBackground(altBg_(ri));
      const deltaCell = sh.getRange(R, 7);
      if (emp.overallBillDelta > 2) deltaCell.setBackground(SIGNAL_BG.RISE).setFontWeight("bold");
      else if (emp.overallBillDelta < -2) deltaCell.setBackground(SIGNAL_BG.DROP).setFontWeight("bold");
      R++;
    });
    R++;
  }
  return R;
}

function writeCapacitySection_(sh, R, empSummary, weekWindow) {
  const NCOLS = 10;
  const wLabels = weekWindow.map(shortWeekLabel_);
  sectionDivider_(sh, R, "▌ D.  CAPACITY & UTILIZATION COMPLIANCE — Weekly Util vs Target Capacity", NCOLS);
  R++;
  sh.getRange(R, 1, 1, NCOLS).setValues([[
    "Employee", "Level", "Team", "Weekly\nCap (h)",
    `${wLabels[0]}\nUtil %`, `${wLabels[1]}\nUtil %`, `${wLabels[2]}\nUtil %`,
    "Avg Util", "Compliance", "",
  ]]);
  styleHeader_(sh, R, NCOLS, 40);
  R++;

  const sorted = [...empSummary.values()].sort((a, b) => a.employee.localeCompare(b.employee));
  sorted.forEach((emp, ri) => {
    ensureRows_(sh, R);
    const avgUtil = emp.utils.reduce((s, u) => s + parseFloat(u), 0) / 3;
    const compliant = parseFloat(emp.utils[2]) >= 100;
    sh.getRange(R, 1, 1, NCOLS).setValues([[
      emp.employee, emp.level, emp.team, (emp.capacity || CONFIG.WEEKLY_CAPACITY_HOURS).toFixed(1),
      emp.utils[0] + "%", emp.utils[1] + "%", emp.utils[2] + "%",
      avgUtil.toFixed(1) + "%", compliant ? "✅ Compliant" : "⚠️ Under Cap", "",
    ]]).setBackground(altBg_(ri));
    sh.getRange(R, 9).setBackground(compliant ? SIGNAL_BG.RISE : SIGNAL_BG.DROP).setFontWeight("bold").setHorizontalAlignment("center");
    [5, 6, 7].forEach((col, i) => {
      const u = parseFloat(emp.utils[i]);
      sh.getRange(R, col).setBackground(u >= 100 ? SIGNAL_BG.RISE : u < 75 ? SIGNAL_BG.DROP : "#FFF9C4");
    });
    R++;
  });
  return R + 1;
}

/**
 * Section E/F: Reconciliation (generic — Tempo or Allocated).
 * FIX v3.1: merge width now uses max(dN, NCOLS) to avoid boundary conflicts.
 */
function writeReconSection_(sh, R, recon, weekWindow, coveredWeekKeys, sectionLetter, title, sourceName) {
  const NCOLS = 9;
  const wLabels = weekWindow.map(shortWeekLabel_);
  const wKeys = weekWindow.map(d => d.toISOString().substring(0, 10));
  const nEmp = recon.size;

  sectionDivider_(sh, R, `▌ ${sectionLetter}.  ${title}`, NCOLS);
  R++;

  let totalHL = 0, totalSrc = 0, matchEmp = 0, mismatchEmp = 0, noDataEmp = 0;
  for (const rec of recon.values()) {
    totalHL += rec.totalHLSum;
    totalSrc += rec.totalSourceSum;
    if (rec.overallStatus.includes("Match") && !rec.overallStatus.includes("Partial")) matchEmp++;
    else if (rec.overallStatus.includes("Mismatch") || rec.overallStatus.includes("Partial")) mismatchEmp++;
    else noDataEmp++;
  }

  const delta = totalHL - totalSrc;
  let signal, signalBg;
  if (mismatchEmp === 0 && matchEmp > 0) {
    signal = `✅ ALL CLEAR — Hours Logged and ${sourceName} are aligned`;
    signalBg = SIGNAL_BG.MATCH;
  } else if (mismatchEmp > 0 && mismatchEmp <= Math.ceil(nEmp * 0.3)) {
    signal = `⚠️ MINOR GAPS — ${mismatchEmp} of ${nEmp} employees have discrepancies`;
    signalBg = SIGNAL_BG.PARTIAL;
  } else if (mismatchEmp > Math.ceil(nEmp * 0.3)) {
    signal = `🔴 SIGNIFICANT GAPS — ${mismatchEmp} of ${nEmp} employees. Process review recommended.`;
    signalBg = SIGNAL_BG.MISMATCH;
  } else {
    signal = `ℹ️ NO ${sourceName.toUpperCase()} DATA — Cannot reconcile`;
    signalBg = SIGNAL_BG.MISSING;
  }

  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, NCOLS).merge().setValue(signal)
    .setBackground(signalBg).setFontWeight("bold").setFontSize(10).setWrap(true);
  sh.setRowHeight(R, 30);
  R++;

  sh.getRange(R, 1, 1, NCOLS).setValues([[
    "Metric", "Hours Logged", sourceName, `Δ (HL − ${sourceName})`, "Δ %",
    "Matched", "Mismatched", "No Data", "",
  ]]);
  styleHeader_(sh, R, NCOLS, 36);
  R++;

  ensureRows_(sh, R);
  const pct = totalSrc > 0 ? (delta / totalSrc * 100) : 0;
  sh.getRange(R, 1, 1, NCOLS).setValues([[
    "3-Week Totals", totalHL.toFixed(1) + "h", totalSrc.toFixed(1) + "h",
    fmtDelta_(delta) + "h", fmtPct_(pct), matchEmp, mismatchEmp, noDataEmp, "",
  ]]);
  sh.getRange(R, 1).setFontWeight("bold");
  sh.getRange(R, 4, 1, 2).setBackground(
    Math.abs(delta) > CONFIG.TOLERANCE_HOURS * nEmp ? SIGNAL_BG.MISMATCH : SIGNAL_BG.MATCH
  );
  R += 2;

  // Per-employee detail
  subHeader_(sh, R, `${sectionLetter}.2  PER-EMPLOYEE DETAIL — Weekly Hours Logged vs ${sourceName}`, NCOLS);
  R++;

  // Build dynamic headers based on covered weeks
  const detailHdr = ["Employee"];
  const coveredIndices = [];
  wKeys.forEach((wk, i) => {
    const covered = coveredWeekKeys ? coveredWeekKeys.has(wk) : true;
    if (covered) {
      detailHdr.push(`${wLabels[i]}\nNetsuite (h)`, `${wLabels[i]}\n${sourceName} (h)`);
      coveredIndices.push(i);
    }
  });
  detailHdr.push("Total Δ (h)", "Status");
  const dN = detailHdr.length;

  // FIX v3.1: use the wider of dN and NCOLS for all writes in this sub-section
  const useCols = Math.max(dN, NCOLS);

  // Pad header to useCols if needed
  while (detailHdr.length < useCols) detailHdr.push("");
  sh.getRange(R, 1, 1, useCols).setValues([detailHdr]);
  styleHeader_(sh, R, useCols, 40);
  R++;

  const sorted = [...recon.entries()].sort((a, b) => {
    const ord = s => s.includes("Mismatch") ? 0 : s.includes("Partial") ? 1 : s.includes("Match") ? 3 : 2;
    return (ord(a[1].overallStatus) - ord(b[1].overallStatus)) || a[0].localeCompare(b[0]);
  });

  sorted.forEach(([employee, rec], ri) => {
    ensureRows_(sh, R);
    const row = [employee];
    for (const i of coveredIndices) {
      const wk = rec.weeks[i];
      row.push(wk.hoursLogged != null ? wk.hoursLogged.toFixed(1) : "—");
      row.push(wk.sourceTotal != null ? wk.sourceTotal.toFixed(1) : "—");
    }
    row.push(fmtDelta_(rec.totalDelta) + "h", rec.overallStatus);
    while (row.length < useCols) row.push("");

    sh.getRange(R, 1, 1, useCols).setValues([row]).setBackground(altBg_(ri));

    const statusCol = detailHdr.indexOf("Status") + 1; // 1-based
    const deltaCol = detailHdr.indexOf("Total Δ (h)") + 1;
    if (statusCol > 0) {
      if (rec.overallStatus.includes("Match") && !rec.overallStatus.includes("Partial")) {
        sh.getRange(R, statusCol).setBackground(SIGNAL_BG.MATCH).setFontWeight("bold");
      } else if (rec.overallStatus.includes("Mismatch") || rec.overallStatus.includes("Partial")) {
        sh.getRange(R, statusCol).setBackground(SIGNAL_BG.MISMATCH).setFontWeight("bold");
        if (deltaCol > 0) sh.getRange(R, deltaCol).setBackground(SIGNAL_BG.MISMATCH);
      } else {
        sh.getRange(R, statusCol).setBackground(SIGNAL_BG.MISSING);
      }
    }
    R++;
  });

  // FIX v3.1: footnote merge uses useCols to match detail section width
  R++;
  ensureRows_(sh, R);
  sh.getRange(R, 1, 1, useCols).merge().setValue(
    `Tolerance: ±${CONFIG.TOLERANCE_HOURS}h/week. "HL Higher" = Hours Logged > ${sourceName}. "${sourceName} Higher" = reverse.`
  ).setFontSize(8).setFontColor(COLORS.ORBE_BLUE).setFontStyle("italic").setWrap(true);
  sh.setRowHeight(R, 30);
  return R + 2;
}

function writeAlignmentSection_(sh, R, tempoRecon, utilRecon) {
  const NCOLS = 9;
  sectionDivider_(sh, R, "▌ G.  GLOBAL SOURCE ALIGNMENT — Hours Logged vs Tempo vs Utilization Actual", NCOLS);
  R++;
  sh.getRange(R, 1, 1, NCOLS).setValues([[
    "Employee", "Hours Logged", "Tempo", "Util Actual",
    "HL vs Tempo", "HL vs Util", "Alignment Status", "", "",
  ]]);
  styleHeader_(sh, R, NCOLS, 36);
  R++;

  const allEmps = [...new Set([...tempoRecon.keys(), ...utilRecon.keys()])].sort();
  const tol = CONFIG.TOLERANCE_HOURS;
  allEmps.forEach((emp, ri) => {
    ensureRows_(sh, R);
    const tRec = tempoRecon.get(emp);
    const uRec = utilRecon.get(emp);
    const hl = tRec ? tRec.totalHLSum : (uRec ? uRec.totalHLSum : 0);
    const tempo = tRec ? tRec.totalSourceSum : null;
    const actual = uRec ? uRec.totalSourceSum : null;
    const tD = tempo != null ? hl - tempo : null;
    const uD = actual != null ? hl - actual : null;
    const tMatch = tD != null && Math.abs(tD) <= tol;
    const uMatch = uD != null && Math.abs(uD) <= tol;

    let status, bg;
    if (tMatch && uMatch) { status = "✅ Fully Aligned"; bg = SIGNAL_BG.MATCH; }
    else if (tMatch || uMatch) { status = "⚠️ Partial"; bg = SIGNAL_BG.PARTIAL; }
    else if (tempo == null && actual == null) { status = "ℹ️ No External Data"; bg = SIGNAL_BG.MISSING; }
    else { status = "❌ Source Mismatch"; bg = SIGNAL_BG.MISMATCH; }

    sh.getRange(R, 1, 1, NCOLS).setValues([[
      emp, hl.toFixed(1) + "h",
      tempo != null ? tempo.toFixed(1) + "h" : "—",
      actual != null ? actual.toFixed(1) + "h" : "—",
      tD != null ? fmtDelta_(tD) : "—",
      uD != null ? fmtDelta_(uD) : "—",
      status, "", "",
    ]]).setBackground(altBg_(ri));
    sh.getRange(R, 7).setBackground(bg).setFontWeight("bold");
    if (tD != null && !tMatch) sh.getRange(R, 5).setBackground(SIGNAL_BG.MISMATCH);
    if (uD != null && !uMatch) sh.getRange(R, 6).setBackground(SIGNAL_BG.MISMATCH);
    R++;
  });
  return R + 1;
}

/** Master Summary Sheet builder. */
function buildSummarySheet_(empSummary, capacityData, weekWindow, utilData, matrix, tempoRecon, utilRecon, tempoWeekKeys) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = resetSheet_(ss, CONFIG.SUMMARY_SHEET);
  const NCOLS = 9;

  sh.getRange(1, 1).setValue("📋  Weekly Contribution Summary Report")
    .setFontSize(14).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
  sh.getRange(2, 1).setValue(
    `Window: ${formatWeekRange_(weekWindow[0])} → ${formatWeekRange_(weekWindow[2])}  |  Generated: ${new Date().toLocaleString()}`
  ).setFontSize(9).setFontColor("#888888").setFontStyle("italic");

  let R = 4;
  R = writePulseSection_(sh, R, matrix, weekWindow, matrix.size);
  R = writeContributionMatrix_(sh, R, empSummary, weekWindow);
  R = writeSegmentationSection_(sh, R, empSummary, weekWindow);
  R = writeCapacitySection_(sh, R, empSummary, weekWindow);
  SpreadsheetApp.flush(); // Commit before heavy recon sections
  R = writeReconSection_(sh, R, tempoRecon, weekWindow, tempoWeekKeys, "E", "TEMPO vs Hours Logged — Cross-check Total Hours against Tempo", "Tempo");
  R = writeReconSection_(sh, R, utilRecon, weekWindow, null, "F", "UTILIZATION vs Hours Logged — Cross-check against Actual Time", "Util Actual");
  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 130);
  [3, 4, 5, 6, 7].forEach(c => sh.setColumnWidth(c, 85));
  sh.setColumnWidth(8, 100);
  sh.setColumnWidth(9, 100);
  Logger.log(`✅ Summary sheet built. Final row: ${R}`);
}


// ═════════════════════════════════════════════════════════════
//  OUTPUT: 📈 EXECUTIVE SIGNAL REPORT (W-1 & W0 only)
//
//  KPIs per your parameter table:
//    3. Hours Logged (Total)         ≥90% of available
//    4. Billed Hours                 Team-specific
//    5. Unbilled Hours (Client)      <10% of total
//    6. Admin / Internal Hours       <15% of capacity
//    7. Availability Unused          <5% per person
//    9. Margin per Hour              ≥40% (needs Finance data — shown as placeholder)
//   11. WoW Billed Δ                Stable or growing
//   13. Hours Not Logged             <5% of available
//   14. Billable % of Logged         ≥75%
// ═════════════════════════════════════════════════════════════

/**
 * Build the executive-level signal report following the "Fact, Note, Highlight, Concern" motto.
 */
function buildExecSheet_(empSummary, capacityData, weekWindow, matrix, headcountCoverage) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = resetSheet_(ss, CONFIG.EXEC_SHEET, 400);
  const BM = CONFIG.EXEC_BENCHMARKS;

  const w1Label = shortWeekLabel_(weekWindow[1]);
  const w0Label = shortWeekLabel_(weekWindow[2]);
  const NCOLS = 10;
  let R = 1;

  sh.getRange(R, 1).setValue("📈  Executive Signal Report — Delivery Team Contribution")
    .setFontSize(14).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
  R++;
  sh.getRange(R, 1).setValue(
    `Focus: Delivery Team (07.I / 09.I / Crew Member)   |   Window: ${w1Label} → ${w0Label}   |   Motto: Fact, Note, Highlight, Concern!`
  ).setFontSize(9).setFontColor("#888888").setFontStyle("italic");
  R++;
  sh.getRange(R, 1).setValue(
    `Generated: ${new Date().toLocaleString()}`
  ).setFontSize(8).setFontColor("#AAAAAA");
  R += 2;

  // Aggregate team metrics for Signals
  const teamW0 = { bill: 0, total: 0, cap: 0, billed: 0, unbilled: 0, nb: 0, pto: 0, admin: 0, contribution: 0, overdue: 0 };
  const teamW1 = { bill: 0, total: 0, cap: 0 };
  const criticalTier = [];
  const highlights = [];
  const notes = [];

  for (const emp of empSummary.values()) {
    teamW0.bill += emp.b[2];
    teamW0.total += emp.totals[2];
    teamW0.cap += emp.avails[2];
    teamW0.billed += emp.billed[2];
    teamW0.unbilled += emp.unbilled[2];
    teamW0.nb += emp.nb[2];
    teamW0.pto += emp.pto[2];
    teamW0.admin += emp.admin[2];
    teamW0.contribution += emp.contribution;
    teamW0.overdue += emp.overdue;

    teamW1.bill += emp.b[1];
    teamW1.total += emp.totals[1];
    teamW1.cap += emp.avails[1];

    if (emp.b[2] <= CONFIG.TIER.CRITICAL) criticalTier.push(emp);
    if (emp.b[2] >= 32) highlights.push(`${emp.employee} (Champion: ${emp.b[2].toFixed(1)}h billable)`);
    if (emp.contribution > 5) highlights.push(`${emp.employee} (Execution: ${emp.contribution} items resolved)`);
    if (!emp.team || emp.team === "Unassigned Team") notes.push(`${emp.employee} is unassigned to a team.`);
  }

  // 1. FACT SECTION
  sectionDivider_(sh, R, "▌ 1.  FACTS — Objective WoW Performance", NCOLS);
  R++;
  const billedDelta = teamW0.bill - teamW1.bill;
  // Headcount coverage stats
  const hc = headcountCoverage || {};
  const hcRoster = hc.roster || empSummary.size;

  const facts = [
    `Total Billable Output: ${teamW0.bill.toFixed(1)}h (${fmtDelta_(billedDelta)}h WoW).`,
    `Execution Contribution: ${teamW0.contribution} total items resolved this week across the team.`,
    `Backlog Cleanup: ${teamW0.overdue} overdue items were successfully closed in ${w0Label}.`,
    `Capacity Room: ${(teamW0.cap - teamW0.total).toFixed(1)}h unlogged this week (${( (teamW0.cap - teamW0.total)/teamW0.cap*100 ).toFixed(1)}% of potential).`,
    `Efficiency: ${(teamW0.bill / (teamW0.total || 1) * 100).toFixed(1)}% of logged time is billable.`,
    `Time Off (PTO): ${teamW0.pto.toFixed(1)}h identified via PH/Time Off tab match.`,
    `Admin Burden: ${teamW0.admin.toFixed(1)}h non-billable hours without PTO match.`,
    `Critical Tier: ${criticalTier.length} employees currently in the Critical Tier (<10h billable).`,
    `Headcount: Roster ${hcRoster} | Hours Logged ${hc.hoursLogged || 0} | Tempo ${hc.tempo || 0} | Utilization ${hc.utilization || 0} | Capacity ${hc.capacity || 0} | Backlog ${hc.backlog || 0}.`,
  ];
  facts.forEach(f => {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, NCOLS).merge().setValue("• " + f).setFontSize(10).setVerticalAlignment("middle");
    R++;
  });
  R++;

  // 2. NOTE SECTION
  sectionDivider_(sh, R, "▌ 2.  NOTES — Context & Observations", NCOLS);
  R++;
  const noteText = notes.length > 0 ? notes.slice(0, 5).join(", ") + (notes.length > 5 ? "..." : "") : "All contributors assigned to teams.";
  // Source coverage notes
  const srcCoverageNotes = [];
  if (hc.tempo > 0 && hc.tempo < hcRoster) srcCoverageNotes.push(`Tempo covers ${hc.tempo} of ${hcRoster} Roster members.`);
  if (hc.utilization > 0 && hc.utilization < hcRoster) srcCoverageNotes.push(`Utilization covers ${hc.utilization} of ${hcRoster} Roster members.`);
  if (hc.capacity > 0 && hc.capacity < hcRoster) srcCoverageNotes.push(`Capacity covers ${hc.capacity} of ${hcRoster} Roster members.`);
  if (hc.tempo >= hcRoster) srcCoverageNotes.push(`Tempo: full Roster coverage.`);
  if (hc.utilization >= hcRoster) srcCoverageNotes.push(`Utilization: full Roster coverage.`);
  if (hc.capacity >= hcRoster) srcCoverageNotes.push(`Capacity: full Roster coverage.`);

  // Reconciliation match-rate notes
  if (hc.tempoRecon) {
    let tempoMatch = 0, tempoMismatch = 0;
    for (const rec of hc.tempoRecon.values()) {
      if (rec.overallStatus.includes("Match") && !rec.overallStatus.includes("Partial")) tempoMatch++;
      else if (rec.overallStatus.includes("Mismatch") || rec.overallStatus.includes("Partial")) tempoMismatch++;
    }
    if (tempoMismatch > 0) srcCoverageNotes.push(`Tempo reconciliation: ${tempoMismatch} employee(s) with hour discrepancies.`);
  }
  if (hc.utilRecon) {
    let utilMatch = 0, utilMismatch = 0;
    for (const rec of hc.utilRecon.values()) {
      if (rec.overallStatus.includes("Match") && !rec.overallStatus.includes("Partial")) utilMatch++;
      else if (rec.overallStatus.includes("Mismatch") || rec.overallStatus.includes("Partial")) utilMismatch++;
    }
    if (utilMismatch > 0) srcCoverageNotes.push(`Utilization reconciliation: ${utilMismatch} employee(s) with hour discrepancies.`);
  }

  const observations = [
    `Targeted Profiles: Analysis focuses on L1–L6 Individual Contributors (07.I / 09.I groups).`,
    `Data Health: ${notes.length} contributors have unassigned teams in Roster.`,
    ...srcCoverageNotes,
    `Name Normalization: ${Object.values(NAME_MAPS).reduce((n, s) => n + Object.keys(s).length, 0)} cross-source name mapping(s) active.`,
    `Process: This report operationalizes the ABC Contribution pillar for REX/EWS intervention.`
  ];
  observations.forEach(o => {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, NCOLS).merge().setValue("• " + o).setFontSize(10).setFontStyle("italic");
    R++;
  });
  R++;

  // 3. HIGHLIGHT SECTION
  sectionDivider_(sh, R, "▌ 3.  HIGHLIGHTS — Successes & Target Achievements", NCOLS);
  R++;
  // Headcount coverage highlights
  if (hc.hoursLogged >= hcRoster && hcRoster > 0) highlights.push("Hours Logged: full Roster headcount coverage.");
  if (hc.tempo >= hcRoster && hcRoster > 0) highlights.push("Tempo: full Roster headcount coverage.");
  if (hc.utilization >= hcRoster && hcRoster > 0) highlights.push("Utilization: full Roster headcount coverage.");
  if (hc.capacity >= hcRoster && hcRoster > 0) highlights.push("Capacity: full Roster headcount coverage.");
  if (highlights.length === 0) highlights.push("No Champions exceeding 32h billable this week.");
  highlights.slice(0, 8).forEach(h => {
    ensureRows_(sh, R);
    sh.getRange(R, 1, 1, NCOLS).merge().setValue("🏆 " + h).setFontSize(10).setFontColor("#0D4721");
    R++;
  });
  R++;

  // 4. CONCERN SECTION — THE REX/EWS ACTION LIST
  sectionDivider_(sh, R, "▌ 4.  CONCERNS — Critical Tier & Escalation (EWS/REX Action Required)", NCOLS);
  R++;
  if (criticalTier.length === 0) {
    sh.getRange(R, 1, 1, NCOLS).merge().setValue("✅ No employees in Critical Tier this week.").setBackground(SIGNAL_BG.MATCH);
    R++;
  } else {
    const hdr = ["Employee", "Level", "Team", "Billable", "Items Res.", "Backlog", "Signal", "Action Required", "", ""];
    sh.getRange(R, 1, 1, NCOLS).setValues([hdr]);
    styleHeader_(sh, R, NCOLS, 32);
    R++;

    criticalTier.sort((a,b) => a.b[2] - b.b[2]).forEach((emp, ri) => {
      ensureRows_(sh, R);
      sh.getRange(R, 1, 1, NCOLS).setValues([[
        emp.employee, emp.level, emp.team, emp.b[2].toFixed(1) + "h", emp.contribution,
        emp.backlog, emp.behavior.label, "EWS/REX Escalation", "", ""
      ]]).setBackground(altBg_(ri));
      sh.getRange(R, 4).setBackground(TIER_BG["🔴 Critical"]).setFontWeight("bold");
      if (emp.contribution > 0) sh.getRange(R, 5).setFontWeight("bold").setFontColor("#0D4721");
      if (emp.backlog > 5) sh.getRange(R, 6).setBackground(SIGNAL_BG.PARTIAL).setFontWeight("bold");
      sh.getRange(R, 8).setFontColor("#A50000").setFontWeight("bold");
      R++;
    });
  }

  // Headcount gap concerns
  R++;
  const hcConcerns = [];
  if (hc.tempo > 0 && hc.tempo < hcRoster) hcConcerns.push(`Tempo: only ${hc.tempo} of ${hcRoster} Roster members have logged time — ${hcRoster - hc.tempo} missing.`);
  if (hc.utilization > 0 && hc.utilization < hcRoster) hcConcerns.push(`Utilization: only ${hc.utilization} of ${hcRoster} Roster members present — ${hcRoster - hc.utilization} missing.`);
  if (hc.capacity > 0 && hc.capacity < hcRoster) hcConcerns.push(`Capacity: only ${hc.capacity} of ${hcRoster} Roster members present — ${hcRoster - hc.capacity} missing.`);
  if (hc.hoursLogged > 0 && hc.hoursLogged < hcRoster) hcConcerns.push(`Hours Logged: only ${hc.hoursLogged} of ${hcRoster} Roster members have entries — ${hcRoster - hc.hoursLogged} missing.`);
  if ((hc.tempo || 0) === 0) hcConcerns.push(`Tempo: no data found — cannot reconcile against Roster.`);

  if (hcConcerns.length > 0) {
    R++;
    subHeader_(sh, R, "Headcount Visibility Gaps", NCOLS);
    R++;
    hcConcerns.forEach(c => {
      ensureRows_(sh, R);
      sh.getRange(R, 1, 1, NCOLS).merge().setValue("⚠ " + c)
        .setFontSize(10).setFontColor("#A50000").setBackground(SIGNAL_BG.PARTIAL);
      R++;
    });
  }

  sh.setColumnWidth(1, 160);
  sh.setColumnWidth(2, 60);
  sh.setColumnWidth(3, 120);
  [4,5,6].forEach(c => sh.setColumnWidth(c, 80));
  sh.setColumnWidth(7, 100);
  sh.setColumnWidth(8, 180);
  Logger.log(`✅ Executive Signal Report built. Final row: ${R}`);
}


// ═════════════════════════════════════════════════════════════
//  ENTRY POINT
// ═════════════════════════════════════════════════════════════

function runWeeklyAnalytics() {
  try {
    Logger.log(`🚀 v3.2.0 — Started ${new Date().toISOString()}`);

    const weekWindow = getThreeWeekWindow_();
    const windowKeys = new Set(weekWindow.map(d => d.toISOString().substring(0, 10)));

    const rosterData = readRoster_();
    const hoursRows = readHoursLogged_(windowKeys);
    
    // PH and Time Off
    const phData = readPH_(windowKeys);
    const timeOffData = readTimeOff_(windowKeys);
    
    const utilData = readUtilization_(windowKeys, timeOffData, phData, rosterData);
    const tempoData = readTempo_(windowKeys);
    const capacityData = readCapacity_();
    
    const w0Label = "W" + (isoWeekNumber_(weekWindow[2]) + CONFIG.WEEK_NUMBER_OFFSET);
    const backlogData = readBacklog_(w0Label);

    // Primary Roster: Target Delivery Team (07.I / 09.I)
    let roster = new Set(rosterData.keys());
    
    // Fallback logic for Delivery Team focus
    if (roster.size === 0) {
      Logger.log("⚠️ No Delivery Team members (07.I/09.I) found in Roster. Checking all employees...");
      // For now, if no delivery team found, we stop or warn. 
      // The user wants strict focus, so we won't fallback to the full list automatically 
      // to avoid confusing full company data with delivery team data.
    }

    const matrix = buildEmployeeMatrix_(hoursRows, weekWindow, roster);
    const { flatEntries, empSummary } = enrichMatrix_(matrix, utilData, capacityData, rosterData, backlogData, weekWindow);

    const tempoRecon = buildTempoReconciliation_(matrix, tempoData.tempoByEmpWeek, tempoData.tempoWeekKeys, weekWindow);
    const utilRecon = buildUtilReconciliation_(matrix, utilData.utilByEmpWeek, weekWindow);

    // Build all 3 output sheets
    buildAnalyticsSheet_(flatEntries, weekWindow);
    buildSummarySheet_(empSummary, capacityData, weekWindow, utilData, matrix, tempoRecon, utilRecon, tempoData.tempoWeekKeys);
    // Headcount coverage for exec signals
    const headcountCoverage = {
      roster: roster.size,
      hoursLogged: new Set(hoursRows.map(r => r.employee)).size,
      tempo: tempoData.tempoByEmpWeek.size,
      utilization: utilData.utilByEmpWeek.size,
      capacity: capacityData.size,
      backlog: backlogData.size,
      tempoRecon: tempoRecon,
      utilRecon: utilRecon,
    };
    buildExecSheet_(empSummary, capacityData, weekWindow, matrix, headcountCoverage);

    // Toast summary
    let critical = 0, champion = 0;
    empSummary.forEach(e => { 
      if (e.b[2] <= CONFIG.TIER.CRITICAL) critical++;
      if (e.b[2] >= 32) champion++;
    });

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `✅ ${roster.size} Individual Contributors (L1-L6) analyzed.\n` +
      `REX/EWS Alert: ${critical} Critical Tier employees found.\n` +
      `Performance: ${champion} Champions identified.`,
      CONFIG.SCRIPT_LABEL, 10
    );
    Logger.log(`✅ Complete.`);
  } catch (e) {
    Logger.log(`❌ ${e.message}\n${e.stack}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(`❌ Error: ${e.message}`, CONFIG.SCRIPT_LABEL, 12);
    throw e;
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("▶ Analytics")
    .addItem("Open Executive Dashboard", "openDashboard")
    .addSeparator()
    .addItem("Run 3-Week Contribution Report", "runWeeklyAnalytics")
    .addItem("Run Tempo + Backlog WoW Summary", "runTempoBacklogWoWSummary")
    .addItem("Run Full HC Analysis", "runFullHCAnalysis")
    .addSeparator()
    .addItem("Manage Dashboard Access", "manageAuthorizedUsers")
    .addToUi();
}
