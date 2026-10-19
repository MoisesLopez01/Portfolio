// ============================================================
// SCRIPT NAME: Team Segmentation — Backlog Profile Report
// PURPOSE:     Reads "Jira Raw" + "Roster" sheets to produce a
//              "Team Segmentation" tab showing per-profile
//              engagement rates, status classification (Active /
//              Needs Support / Ramp-Up / Inactive), WoW trend for
//              last 4 weeks, recognition signals, and an executive
//              canvas summary — all without additional API calls.
// AUTHOR:      Alex Lopez
// CREATED:
// VERSION:     1.0.0
// ENVIRONMENT: Google Apps Script
// ============================================================

// ============================================================
// ⚙️  CONFIGURATION — Edit values here before running
// ============================================================
const CI_CONFIG = {
  // ── Sheet names ──────────────────────────────────────────
  // Source data — must already exist and be populated by runJiraEpicTracker()
  RAW_SHEET:    "Jira Raw",     // Columns: Week, Assignee, ... (produced by main tracker)
  ROSTER_SHEET: "Roster",       // Columns: Name, Job Title, Hire Date (at minimum)

  // Output tab produced by this script
  OUTPUT_SHEET: "Team Segmentation",

  // ── Roster column names (case-insensitive partial match) ──
  // Adjust if your Roster sheet uses different headers
  ROSTER_NAME_COL:      "name",       // Employee display name
  ROSTER_TITLE_COL:     "job title",  // Job profile / title
  ROSTER_HIRE_COL:      "hire date",  // ISO or MM/DD/YYYY hire date

  // ── Jira Raw column names ─────────────────────────────────
  RAW_WEEK_COL:         "week",       // e.g. "W8", "W9" …
  RAW_ASSIGNEE_COL:     "assignee",   // Normalised name

  // ── Analysis parameters ──────────────────────────────────
  // Evidence window: the last TREND_WEEKS COMPLETED ISO weeks (Mon–Sun) before
  // today, keyed "YYYY.WN". Every signal — backlog, logged time, kudos, goal
  // comments — is read over this one window, in both the sheet and the HTML.
  // It is computed from the calendar, not from the weeks present in Jira Raw:
  // Jira Raw holds 52 weeks plus the in-progress one, and a year-less "W40"
  // key merged two years into one column.
  TREND_WEEKS:          4,

  // 90-day ramp-up window: employees hired within this many days before
  // the first tracked week are classified as "Ramp-Up" and excluded from
  // the engagement-rate denominator so they don't penalise their profile.
  RAMPUP_DAYS:          90,

  // Classification thresholds (count of active weeks out of TREND_WEEKS)
  ACTIVE_THRESHOLD:     3,   // ≥ this many active weeks → "Active"
  NEEDS_SUPPORT_MIN:    1,   // ≥ 1 and < ACTIVE_THRESHOLD → "Needs Support"
  // 0 active weeks → "Inactive"

  // Review-flag: tenured employee (hired > REVIEW_TENURE_MONTHS ago) with
  // ≤ REVIEW_MAX_ACTIVE_WEEKS active weeks in a profile where the top
  // contributor has ≥ REVIEW_MIN_PROFILE_TOTAL contributions.
  REVIEW_TENURE_MONTHS:    6,
  REVIEW_MAX_ACTIVE_WEEKS: 1,
  REVIEW_MIN_PROFILE_TOTAL: 15,

  // ── Hours sheet column names (canvas-compatible) ──
  // No sheet name needed — readHoursData_() discovers the sheet dynamically
  HOURS_NAME_COL:     "rocketeer",
  HOURS_WEEK_COL:     "week",
  HOURS_CAPACITY_COL: "capacityhours",
  HOURS_PLANNED_COL:  "plannedhours",
  HOURS_PTO_COL:      "ptohours",
  HOURS_TEMPO_COL:    "tempo tracked",

  // ── Health Radar ──────────────────────────────────────────────
  KUDOS_NORMALIZED_SHEET: "Kudos_Normalized",
  // FY start (July 1) is derived from today by ciFyStart_() — no yearly edit.
  PTO_RECENT_DAYS:        90,
  PTO_UPCOMING_DAYS:      180,

  // ── Time classification thresholds ──
  TIME_ACTIVE_MIN_PCT:  60,   // ≥60% avg utilization in trend window → time-Active
  TIME_PARTIAL_MIN_PCT: 25,   // 25–59% → Partial; <25% → Low

  // Goal self-comments (the PS dashboard's Goals source — CONFIG_PS.SHEET_GOALS in
  // the GOALS spreadsheet). Read only when this file runs inside the dashboard
  // project; elsewhere the comments row shows "no data".

  // Targeted job profiles used for engagement rate (same list as main tracker)
  TARGET_PROFILES: [
    "07.I4.2 - Senior Consultant I, Delivery",
    "07.I3.1 - Engineer, Customer Support",
    "15.I5.1 - Senior Consultant II, Project Management",
    "07.I4.1 - Senior Engineer I, Customer Support",
    "18.I6.1 - Senior Consultant III, Solution Architecture",
    "18.I4.1 - Senior Consultant I, Solution Architecture",
    "07.I2.1 - Associate Engineer, Customer Support",
    "09.I5.1 - Senior Consultant II, Service Delivery",
    "07.I5.1 - Senior Engineer II, Customer Support",
    "18.I5.1 - Senior Consultant II, Solution Architecture",
    "07.I5.2 - Senior Consultant II, Delivery",
    "09.I5.3 - Senior Engineer II, Service Delivery",
    "09.I4.3 - Senior Engineer I, Service Delivery",
    "09.I3.1 - Consultant, Technical Consulting",
    "15.I4.1 - Senior Consultant I, Project Management",
    "09.I4.1 - Senior Consultant I, Technical Consulting",
    "09.I3.3 - Engineer, Service Delivery",
  ],
};

// ============================================================
// 🎨  CONTRIBUTION STATUS PALETTE — extends COLORS from Jira Backlog.js
// ⚠️ LOAD ORDER: COLORS is a top-level const in Jira Backlog.js. It used to be
//    spread here (`...COLORS`), which read it at LOAD time: whenever this file
//    ran before Jira Backlog.js the spread threw "ReferenceError: COLORS is not
//    defined" and took the WHOLE project down (every doGet, every editor Run).
//    The brand keys are getters now, so COLORS is read at CALL time, after every
//    file has loaded — file order no longer matters. Never read another file's
//    globals at the top level of this file.
// ============================================================
const CI_COLORS = {
  get VOID_BLUE()   { return COLORS.VOID_BLUE; },
  get ORBE_BLUE()   { return COLORS.ORBE_BLUE; },
  get IVORY()       { return COLORS.IVORY; },
  get LIGHT_CREAM() { return COLORS.LIGHT_CREAM; },
  get ROYAL()       { return COLORS.ROYAL; },
  get JUNE()        { return COLORS.JUNE; },

  // Contribution status palette
  ACTIVE_BG:   "#C6EFCE",  ACTIVE_FG:   "#276221",
  NEEDS_BG:    "#FFEB9C",  NEEDS_FG:    "#9C5700",
  RAMPUP_BG:   "#DDEBF7",  RAMPUP_FG:   "#1F4E79",
  INACTIVE_BG: "#FFC7CE",  INACTIVE_FG: "#9C0006",
  REVIEW_BG:   "#FFD7D7",  REVIEW_FG:   "#6B0000",

  // Composite dual-signal statuses
  TRACKING_BG: "#E0F2FE",  TRACKING_FG: "#0369A1",   // blue — informational, not alarming
  JIRA_BG:     "#FFF7ED",  JIRA_FG:     "#92400E",   // amber — admin fix needed

  // Trend arrows
  UP_FG:   "#276221",
  DOWN_FG: "#9C0006",
  FLAT_FG: "#595959",
};

// ── SECTION: HELPERS ─────────────────────────────────────────

/**
 * Returns the column index (0-based) of the first header that contains
 * the given keyword (case-insensitive). Returns -1 if not found.
 * @param {string[]} headers - Array of header strings.
 * @param {string}   keyword - Partial match keyword.
 * @returns {number}
 */
function findCol_(headers, keyword) {
  const kw = keyword.toLowerCase();
  return headers.findIndex(h => String(h || "").toLowerCase().includes(kw));
}

/**
 * Parses a date value from a spreadsheet cell — handles Date objects,
 * ISO strings, and MM/DD/YYYY strings.
 * @param {*} val - Raw cell value.
 * @returns {Date|null}
 */
function parseDate_(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns the year-qualified week key "YYYY.WN" (unpadded, the project's
 * convention) for a week label — "2026.W07", "2026.W7", "W7", 7 — or a Date.
 * Never drops the year: Jira Raw spans 52 weeks, so "W40" alone names two weeks.
 * Returns "" for sentinels such as "Open" / "Epic Child".
 * @param {string|number|Date} label
 * @returns {string}
 */
function ciWeekKey_(label) {
  if (label instanceof Date) return isNaN(label.getTime()) ? "" : ciWeekKeyOfDate_(label);
  const s = String(label || "").trim();
  // "2026.W07" (Jira Raw pads) / "2026.W7" / "2026-W7" → "2026.W7"
  const full = s.match(/^(\d{4})[.\-\s]?W(\d{1,2})$/i);
  if (full) return `${full[1]}.W${parseInt(full[2], 10)}`;
  // Year-less "W17" or a bare week number (hours sheet): the most recent such
  // week that is not in the future. Ambiguous only for a label a year old,
  // which is far outside the evidence window anyway.
  const bare = s.match(/^W?(\d{1,2})$/i);
  if (!bare) return "";
  const wk  = parseInt(bare[1], 10);
  const now = new Date();
  const yr  = ciIsoYear_(now);
  return `${wk <= ciIsoWeek_(now) ? yr : yr - 1}.W${wk}`;
}

/** ISO week number of a date (Mon–Sun weeks, week 1 holds Jan 4). */
function ciIsoWeek_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

/** ISO week-numbering year of a date (differs from the calendar year around Jan 1). */
function ciIsoYear_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

/** "YYYY.WN" key of the ISO week containing a date. */
function ciWeekKeyOfDate_(date) {
  return `${ciIsoYear_(date)}.W${ciIsoWeek_(date)}`;
}

/**
 * The evidence window: the last CI_CONFIG.TREND_WEEKS completed ISO weeks,
 * oldest → newest, as [{ key:"2026.W37", start:Date(Mon 00:00), end:Date(Sun 23:59) }].
 * @returns {{key:string, start:Date, end:Date}[]}
 */
function ciEvidenceWeeks_() {
  const thisMon = today_();
  thisMon.setDate(thisMon.getDate() - ((thisMon.getDay() + 6) % 7));
  const out = [];
  for (let i = CI_CONFIG.TREND_WEEKS; i >= 1; i--) {
    const start = new Date(thisMon);
    start.setDate(thisMon.getDate() - i * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    out.push({ key: ciWeekKeyOfDate_(start), start, end });
  }
  return out;
}

/** July 1 that opens the current fiscal year (FY starts July 1). */
function ciFyStart_() {
  const t = today_();
  return new Date(t.getMonth() >= 6 ? t.getFullYear() : t.getFullYear() - 1, 6, 1);
}

/** Lower-case, whitespace-collapsed name — the join key across sheets (= normPS_). */
function ciNorm_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Applies the standard header row styling to a range.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 */
function ciStyleHeader_(range) {
  range
    .setBackground(CI_COLORS.VOID_BLUE)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(11)
    .setFontFamily("Arial")
    .setVerticalAlignment("middle")
    .setHorizontalAlignment("center");
}

/**
 * Applies section-divider styling (Ivory background, bold, Void Blue text).
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 */
function styleSectionRow_(range) {
  range
    .setBackground(CI_COLORS.IVORY)
    .setFontColor(CI_COLORS.VOID_BLUE)
    .setFontWeight("bold")
    .setFontSize(10)
    .setFontFamily("Arial")
    .setVerticalAlignment("middle");
}

/**
 * Returns today's date at midnight UTC (for tenure calculations).
 * @returns {Date}
 */
function today_() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the number of calendar months between two dates.
 * @param {Date} from
 * @param {Date} to
 * @returns {number}
 */
function monthsBetween_(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12
       + (to.getMonth() - from.getMonth());
}

/**
 * Returns a WoW delta string with arrow emoji.
 * @param {number} current
 * @param {number} prior
 * @returns {string}
 */
function wowDelta_(current, prior) {
  const d = current - prior;
  if (d > 0) return `↑ +${d}`;
  if (d < 0) return `↓ ${d}`;
  return `→ 0`;
}

/**
 * Formats one signal's per-week values for a single sheet cell, oldest → newest:
 * "32h · 40h · — · 38h  (110h)". "—" = no data that week; all-null → "no data".
 * @param {(number|null)[]} values
 * @param {number|null}     total
 * @param {string}          unit
 * @returns {string}
 */
function evidenceText_(values, total, unit) {
  if (!values || values.every(v => v === null)) return "no data";
  const cells = values.map(v => (v === null ? "—" : `${v}${unit}`)).join(" · ");
  return `${cells}  (${total}${unit})`;
}

/**
 * Returns the ordinal suffix for a rank number (1st, 2nd, 3rd…).
 * @param {number} n
 * @returns {string}
 */
function ordinal_(n) {
  const s = ["th","st","nd","rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── SECTION: DATA READERS ─────────────────────────────────────

/**
 * Reads the Roster sheet and returns a Map of
 * normalised name → { title, hireDate }.
 * Only employees whose title matches a TARGET_PROFILE are included.
 * @returns {Map<string, {title:string, hireDate:Date|null}>}
 */
function readRoster_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const sh  = ss.getSheetByName(CI_CONFIG.ROSTER_SHEET);
  if (!sh) throw new Error(`❌ Roster sheet "${CI_CONFIG.ROSTER_SHEET}" not found.`);

  const data    = sh.getDataRange().getValues();
  if (data.length < 2) return new Map();

  const headers = data[0].map(h => String(h || "").trim());
  const iName   = findCol_(headers, CI_CONFIG.ROSTER_NAME_COL);
  const iTitle  = findCol_(headers, CI_CONFIG.ROSTER_TITLE_COL);
  const iHire   = findCol_(headers, CI_CONFIG.ROSTER_HIRE_COL);

  if (iName === -1 || iTitle === -1) {
    throw new Error(`❌ Roster: could not find Name or Job Title columns. Headers: ${headers.join(", ")}`);
  }

  const map = new Map();
  for (let i = 1; i < data.length; i++) {
    const rawName  = String(data[i][iName]  || "").trim();
    const title    = String(data[i][iTitle] || "").trim();
    const hireDate = iHire !== -1 ? parseDate_(data[i][iHire]) : null;

    if (!rawName || rawName.length < 2) continue;
    if (!CI_CONFIG.TARGET_PROFILES.includes(title)) continue;

    map.set(rawName, { title, hireDate });
  }

  Logger.log(`ℹ️ Roster: ${map.size} targeted employees loaded.`);
  return map;
}

/**
 * Reads the Jira Raw sheet and returns weekly contribution counts.
 * Returns { weeks: string[], counts: Map<name, Map<"YYYY.WN", number>> }
 * where weeks is the evidence window (ciEvidenceWeeks_), oldest→newest.
 * @returns {{ weeks: string[], counts: Map<string, Map<string,number>> }}
 */
function readJiraRaw_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CI_CONFIG.RAW_SHEET);
  if (!sh) throw new Error(`❌ Raw sheet "${CI_CONFIG.RAW_SHEET}" not found. Run the main tracker first.`);

  const data    = sh.getDataRange().getValues();
  if (data.length < 2) throw new Error(`❌ "${CI_CONFIG.RAW_SHEET}" is empty.`);

  const headers = data[0].map(h => String(h || "").trim().toLowerCase());
  const iWeek   = findCol_(headers, CI_CONFIG.RAW_WEEK_COL);
  const iName   = findCol_(headers, CI_CONFIG.RAW_ASSIGNEE_COL);

  if (iWeek === -1 || iName === -1) {
    throw new Error(`❌ Jira Raw: Week or Assignee column not found. Headers: ${data[0].join(", ")}`);
  }

  const trendWeeks = ciEvidenceWeeks_().map(w => w.key);
  const inWindow   = new Set(trendWeeks);

  // Tally contributions per person per evidence week. Keys keep the year —
  // stripping it folded 2025.W40 and 2026.W40 together and made "the last 4
  // weeks" sort to W49–W52 of the previous December.
  const counts = new Map(); // name → Map<"YYYY.WN", number>
  let rowsInWindow = 0;
  for (let i = 1; i < data.length; i++) {
    const w    = ciWeekKey_(data[i][iWeek]);
    const name = String(data[i][iName] || "").trim();
    if (!inWindow.has(w) || !name || name.toLowerCase() === "unassigned") continue;

    if (!counts.has(name)) counts.set(name, new Map());
    const wMap = counts.get(name);
    wMap.set(w, (wMap.get(w) || 0) + 1);
    rowsInWindow++;
  }

  Logger.log(`ℹ️ Jira Raw: ${rowsInWindow} items in evidence window ${trendWeeks.join(", ")}`);
  if (rowsInWindow === 0) {
    Logger.log(`⚠️ Jira Raw has no rows in ${trendWeeks[0]} → ${trendWeeks[trendWeeks.length - 1]} — is the exporter current?`);
  }
  return { weeks: trendWeeks, counts };
}

/**
 * Discovers the hours sheet dynamically by scanning all tabs for one that has
 * a "rocketeer" header column, then returns a nested Map:
 *   normalizedName → Map<"2026.W17", { capacity, planned, pto, tempo, utilization, bestTracked }>
 * Returns an empty Map if no matching sheet is found (graceful degradation).
 * @returns {Map<string, Map<string, object>>}
 */
/**
 * Reads the "PTO Usage" sheet.
 * Returns { weeklyHours: Map<name, Map<"2026.W17", hours>>, dateEntries: Map<name, [{date:Date, hours:number}]> }
 * Both maps are empty Maps gracefully if the sheet is absent.
 */
function readPtoData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("PTO Usage");
  const empty = { weeklyHours: new Map(), dateEntries: new Map() };
  if (!sh) {
    Logger.log("ℹ️ readPtoData_: No 'PTO Usage' sheet found — PTO supplement disabled.");
    return empty;
  }

  const data    = sh.getDataRange().getValues();
  const headers = data[0].map(h => String(h || "").trim().toLowerCase());
  const iName   = findCol_(headers, "name");
  const iWeek   = findCol_(headers, "week");
  const iUsage  = findCol_(headers, "usage");
  const iDate   = findCol_(headers, "date");

  if (iName === -1 || iWeek === -1 || iUsage === -1) {
    Logger.log(`⚠️ readPtoData_: 'PTO Usage' sheet missing Name/Week/Usage columns. Headers: ${data[0].join(", ")}`);
    return empty;
  }

  const weeklyHours = new Map();
  const dateEntries = new Map();

  for (let i = 1; i < data.length; i++) {
    const name    = String(data[i][iName]  || "").trim();
    const weekRaw = String(data[i][iWeek]  || "").trim();
    const usage   = parseFloat(data[i][iUsage] || 0);
    if (!name || !weekRaw || !(usage > 0)) continue;

    const weekKey = ciWeekKey_(weekRaw); // "2026.W17" → "2026.W17"
    if (!weekKey) continue;

    if (!weeklyHours.has(name)) weeklyHours.set(name, new Map());
    weeklyHours.get(name).set(weekKey, (weeklyHours.get(name).get(weekKey) || 0) + usage);

    // Also collect date-level entries for the health radar
    if (iDate !== -1) {
      const d = parseDate_(data[i][iDate]);
      if (d) {
        if (!dateEntries.has(name)) dateEntries.set(name, []);
        dateEntries.get(name).push({ date: d, hours: usage });
      }
    }
  }

  Logger.log(`ℹ️ readPtoData_: Loaded PTO for ${weeklyHours.size} employees from "PTO Usage".`);
  return { weeklyHours, dateEntries };
}

/**
 * Reads Kudos_Normalized sheet and returns kudos received per employee.
 * Returns Map<name, { count, weekly: Map<"YYYY.WN", n>, recent: [{giver, desc, week}] }>
 *   count  — received since the current FY start (context only)
 *   weekly — received in each evidence week
 *   recent — the messages behind `weekly`, newest first (the evidence itself)
 * A kudo's week is taken from its Create Date, falling back to the Week column.
 */
function readKudosData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CI_CONFIG.KUDOS_NORMALIZED_SHEET);
  if (!sh) {
    Logger.log(`ℹ️ readKudosData_: No '${CI_CONFIG.KUDOS_NORMALIZED_SHEET}' sheet found.`);
    return new Map();
  }

  const fyStart  = ciFyStart_();
  const inWindow = new Set(ciEvidenceWeeks_().map(w => w.key));
  const data     = sh.getDataRange().getValues();
  if (data.length < 2) return new Map();

  const headers   = data[0].map(h => String(h || "").trim().toLowerCase());
  const iRecipient = findCol_(headers, "recipient");
  const iGiver     = findCol_(headers, "giver");
  const iDesc      = findCol_(headers, "description");
  const iDate      = findCol_(headers, "create date");
  const iWeek      = findCol_(headers, "week");

  if (iRecipient === -1) {
    Logger.log(`⚠️ readKudosData_: 'Recipient' column not found.`);
    return new Map();
  }

  const kudosMap = new Map();
  let inWindowCount = 0;
  for (let i = 1; i < data.length; i++) {
    const name  = String(data[i][iRecipient] || "").trim();
    const giver = iGiver !== -1 ? String(data[i][iGiver] || "").trim() : "";
    const desc  = iDesc  !== -1 ? String(data[i][iDesc]  || "").trim() : "";
    if (!name) continue;

    const d    = iDate !== -1 ? parseDate_(data[i][iDate]) : null;
    const week = d ? ciWeekKeyOfDate_(d) : (iWeek !== -1 ? ciWeekKey_(data[i][iWeek]) : "");
    if (fyStart && d && d < fyStart && !inWindow.has(week)) continue;

    if (!kudosMap.has(name)) kudosMap.set(name, { count: 0, weekly: new Map(), recent: [] });
    const entry = kudosMap.get(name);
    if (!d || d >= fyStart) entry.count++;
    if (inWindow.has(week)) {
      entry.weekly.set(week, (entry.weekly.get(week) || 0) + 1);
      entry.recent.push({ giver, desc, week, t: d ? d.getTime() : 0 });
      inWindowCount++;
    }
  }

  // Evidence messages, newest first; dated rows sort by date, undated keep sheet order.
  kudosMap.forEach(v => {
    v.recent = v.recent
      .map((k, i) => ({ k, i }))
      .sort((a, b) => (b.k.t - a.k.t) || (b.i - a.i))
      .map(({ k }) => ({ giver: k.giver, desc: k.desc, week: k.week }));
  });

  Logger.log(`ℹ️ readKudosData_: Kudos loaded for ${kudosMap.size} employees — ${inWindowCount} in the evidence window.`);
  return kudosMap;
}

/**
 * Reads goal SELF-comments (Commentator = the Rocketeer) from the PS dashboard's
 * Goals source and counts them per person per evidence week.
 * Returns Map<normName, Map<"YYYY.WN", n>> — keyed by ciNorm_(name), so callers
 * look a roster name up through ciNorm_ too.
 *
 * The source lives in another spreadsheet whose ID and tab name belong to
 * PS Contribution Report.js (getExternalSSIds_, CONFIG_PS.SHEET_GOALS). If this
 * file runs outside that project those are not in scope, and comments degrade
 * to "no data" rather than failing the whole report.
 * @returns {Map<string, Map<string, number>>|null} null when the source is unavailable.
 */
function readGoalComments_() {
  if (typeof getExternalSSIds_ !== "function" || typeof CONFIG_PS === "undefined") {
    Logger.log("ℹ️ readGoalComments_: Goals source not in this project — comments shown as no data.");
    return null;
  }
  let data;
  try {
    const ss = SpreadsheetApp.openById(getExternalSSIds_().goals);
    data = ss.getSheetByName(CONFIG_PS.SHEET_GOALS);
    data = data ? data.getDataRange().getValues() : null;
  } catch (e) {
    Logger.log(`⚠️ readGoalComments_: could not open the Goals spreadsheet — ${e.message}`);
    return null;
  }
  if (!data || data.length < 2) {
    Logger.log(`⚠️ readGoalComments_: Goals tab "${CONFIG_PS.SHEET_GOALS}" missing or empty.`);
    return null;
  }

  const headers      = data[0].map(h => String(h || "").trim().toLowerCase());
  const iRocketeer   = headers.findIndex(h => h.includes("rocketeer"));
  const iCommentDate = headers.indexOf("comment date");
  const iCommentator = headers.findIndex(h => h.includes("commentator"));
  if (iRocketeer === -1 || iCommentDate === -1 || iCommentator === -1) {
    Logger.log(`⚠️ readGoalComments_: need Rocketeer / Comment Date / Commentator. Headers: ${data[0].join(", ")}`);
    return null;
  }

  // The dashboard's parser knows the Goals sheet's text-date formats ("12-May-26").
  const parse    = typeof parseDate_PS_ === "function" ? parseDate_PS_ : parseDate_;
  const inWindow = new Set(ciEvidenceWeeks_().map(w => w.key));
  const out = new Map();
  let n = 0;
  for (let i = 1; i < data.length; i++) {
    const who = ciNorm_(data[i][iRocketeer]);
    // Self-comments only — a manager's comment on someone's goal is not their evidence.
    if (!who || ciNorm_(data[i][iCommentator]) !== who) continue;
    const d = parse(data[i][iCommentDate]);
    if (!d) continue;
    const week = ciWeekKeyOfDate_(d);
    if (!inWindow.has(week)) continue;
    if (!out.has(who)) out.set(who, new Map());
    out.get(who).set(week, (out.get(who).get(week) || 0) + 1);
    n++;
  }

  Logger.log(`ℹ️ readGoalComments_: ${n} goal self-comments in the evidence window, ${out.size} people.`);
  return out;
}

/**
 * Discovers the hours sheet dynamically and merges in PTO from the "PTO Usage" tab.
 * @param {Map<string, Map<string, number>>} ptoMap  - from readPtoData_()
 * @returns {Map<string, Map<string, object>>}
 */
function readHoursData_(ptoMap) {
  if (!ptoMap) ptoMap = new Map();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let hoursSheet = null;

  for (const sh of ss.getSheets()) {
    const vals = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const hdrs = vals.map(h => String(h || "").trim().toLowerCase());
    if (hdrs.includes(CI_CONFIG.HOURS_NAME_COL)) { hoursSheet = sh; break; }
  }

  if (!hoursSheet) {
    Logger.log("ℹ️ readHoursData_: No hours sheet found — falling back to Jira-only classification.");
    return new Map();
  }

  const data    = hoursSheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || "").trim().toLowerCase());
  const iName   = findCol_(headers, CI_CONFIG.HOURS_NAME_COL);
  const iWeek   = findCol_(headers, CI_CONFIG.HOURS_WEEK_COL);
  const iCap    = findCol_(headers, CI_CONFIG.HOURS_CAPACITY_COL);
  const iPlan   = findCol_(headers, CI_CONFIG.HOURS_PLANNED_COL);
  const iPto    = findCol_(headers, CI_CONFIG.HOURS_PTO_COL);
  const iTempo  = findCol_(headers, CI_CONFIG.HOURS_TEMPO_COL);

  if (iName === -1 || iWeek === -1 || iCap === -1) {
    Logger.log(`⚠️ readHoursData_: Hours sheet "${hoursSheet.getName()}" missing required columns. Skipping.`);
    return new Map();
  }

  const hoursMap = new Map();

  for (let i = 1; i < data.length; i++) {
    const rawName  = String(data[i][iName]  || "").trim();
    const rawWeek  = data[i][iWeek];
    const capacity = parseFloat(data[i][iCap]  || 0);
    if (!rawName || capacity <= 0) continue;

    const weekKey = ciWeekKey_(rawWeek);  // "2026.W17", "W17", 17 or a Date
    if (!weekKey) continue;

    const planned  = parseFloat(iPlan  !== -1 ? data[i][iPlan]  || 0 : 0);
    const ptoSheet = parseFloat(iPto   !== -1 ? data[i][iPto]   || 0 : 0);
    const tempo    = parseFloat(iTempo !== -1 ? data[i][iTempo] || 0 : 0);

    // Effective PTO = best available source: PTO Usage tab takes precedence when non-zero
    const ptoTab      = (ptoMap.has(rawName) ? (ptoMap.get(rawName).get(weekKey) || 0) : 0);
    const pto         = Math.max(ptoSheet, ptoTab);

    // PTO counts as accounted-for time; both Tempo and NS planned hours are credited
    const bestTracked = Math.max(planned + pto, tempo + pto);
    const utilization = Math.round((bestTracked / capacity) * 100);
    const nsUtil      = Math.round(((planned + pto) / capacity) * 100);
    const tpUtil      = Math.round(((tempo   + pto) / capacity) * 100);

    if (!hoursMap.has(rawName)) hoursMap.set(rawName, new Map());
    hoursMap.get(rawName).set(weekKey, { capacity, planned, pto, tempo, bestTracked, utilization, nsUtil, tpUtil });
  }

  Logger.log(`ℹ️ readHoursData_: Loaded hours for ${hoursMap.size} employees from "${hoursSheet.getName()}".`);
  return hoursMap;
}

// ── SECTION: CORE LOGIC ──────────────────────────────────────

/**
 * Classifies a single employee using a 2×2 composite of Jira activity and time utilization.
 * Ramp-up check is applied first (unchanged behavior).
 * @param {Date|null} hireDate
 * @param {number}    activeWeeks  - Weeks with ≥ 1 contribution in the trend window.
 * @param {Date}      windowStart  - Start of earliest trend week (approximate).
 * @param {string}    timeStatus   - "Active"|"Partial"|"Low"|"No Data" from hours sheet.
 * @returns {"Active"|"Tracking Only"|"Jira Only"|"Needs Support"|"Ramp-Up"|"Inactive"}
 */
function classifyEmployee_(hireDate, activeWeeks, windowStart, timeStatus) {
  if (timeStatus === undefined) timeStatus = "No Data";
  if (hireDate) {
    const cutoff = new Date(windowStart);
    cutoff.setDate(cutoff.getDate() - CI_CONFIG.RAMPUP_DAYS);
    if (hireDate > cutoff) return "Ramp-Up";
  }
  const jiraOk = activeWeeks >= CI_CONFIG.ACTIVE_THRESHOLD;
  const timeOk = timeStatus === "Active";

  // When hours data is absent fall back to legacy 3-bucket classification
  if (timeStatus === "No Data") {
    if (jiraOk) return "Active";
    if (activeWeeks >= CI_CONFIG.NEEDS_SUPPORT_MIN) return "Needs Support";
    return "Inactive";
  }

  if (jiraOk  && timeOk)  return "Active";
  if (!jiraOk && timeOk)  return "Tracking Only";
  if (jiraOk  && !timeOk) return "Jira Only";
  return "Inactive";
}

/**
 * Determines whether an employee deserves a "Review Flag" —
 * a tenured IC in a high-performing profile who is barely contributing.
 * Employees classified as "Tracking Only" are excluded: they are doing work,
 * just not in Jira, so they should not trigger a review flag.
 * @param {Date|null} hireDate
 * @param {number}    activeWeeks
 * @param {number}    profileTopTotal - Highest total across all members of the same profile.
 * @param {string}    timeStatus      - Employee time classification.
 * @returns {boolean}
 */
function isReviewFlag_(hireDate, activeWeeks, profileTopTotal, timeStatus) {
  if (timeStatus === undefined) timeStatus = "No Data";
  if (!hireDate) return false;
  if (timeStatus === "Active" || timeStatus === "Tracking Only") return false;
  const tenureMonths = monthsBetween_(hireDate, today_());
  return tenureMonths >= CI_CONFIG.REVIEW_TENURE_MONTHS
      && activeWeeks <= CI_CONFIG.REVIEW_MAX_ACTIVE_WEEKS
      && profileTopTotal >= CI_CONFIG.REVIEW_MIN_PROFILE_TOTAL;
}

/**
 * One person's per-week evidence over the window, aligned index-for-index with
 * `weeks`. Shared by the sheet and the HTML report so the two cannot disagree.
 *   weeklyHrs      — Tempo-logged hours per week (null = no hours row that week)
 *   weeklyKudos    — kudos received per week
 *   weeklyComments — goal self-comments per week (all null when the source is unavailable)
 * @returns {{weeklyHrs:(number|null)[], loggedTotal:number|null, weeklyKudos:number[],
 *            kudosTotal:number, kudosFy:number, kudosList:object[],
 *            weeklyComments:(number|null)[], commentsTotal:number|null}}
 */
function buildEvidence_(name, weeks, empHours, kudosMap, commentsMap) {
  const weeklyHrs = weeks.map(w => {
    const h = empHours.get(w);
    return h ? Math.round(h.tempo * 10) / 10 : null;
  });
  const hrsSeen     = weeklyHrs.filter(v => v !== null);
  const loggedTotal = hrsSeen.length ? Math.round(hrsSeen.reduce((s, v) => s + v, 0) * 10) / 10 : null;

  const k           = kudosMap.get(name) || { count: 0, weekly: new Map(), recent: [] };
  const weeklyKudos = weeks.map(w => k.weekly.get(w) || 0);

  const c = commentsMap ? (commentsMap.get(ciNorm_(name)) || new Map()) : null;
  const weeklyComments = weeks.map(w => (c ? (c.get(w) || 0) : null));

  return {
    weeklyHrs, loggedTotal,
    weeklyKudos, kudosTotal: weeklyKudos.reduce((s, v) => s + v, 0),
    kudosFy: k.count, kudosList: k.recent,
    weeklyComments, commentsTotal: c ? weeklyComments.reduce((s, v) => s + v, 0) : null,
  };
}

/**
 * Builds the full profile-level aggregation used by the report writer.
 * Returns an array of profile objects, sorted by engagement rate descending.
 *
 * @param {Map<string,{title:string,hireDate:Date|null}>} rosterMap
 * @param {string[]}                                       weeks
 * @param {Map<string,Map<string,number>>}                 counts
 * @param {Map<string,Map<string,object>>}                 hoursMap  - from readHoursData_()
 * @param {Map<string,object>}                             kudosMap  - from readKudosData_()
 * @param {Map<string,Map<string,number>>|null}            commentsMap - from readGoalComments_()
 * @returns {object[]}
 */
function buildProfileAggregation_(rosterMap, weeks, counts, hoursMap, kudosMap, commentsMap) {
  if (!hoursMap) hoursMap = new Map();
  if (!kudosMap) kudosMap = new Map();
  const windowStart = ciEvidenceWeeks_()[0].start;

  // Group employees by title
  const byTitle = new Map(); // title → [{ name, hireDate, weeklyTotals[], total, activeWeeks, ... }]
  rosterMap.forEach(({ title, hireDate }, name) => {
    if (!byTitle.has(title)) byTitle.set(title, []);
    const wMap        = counts.get(name) || new Map();
    const weeklyTots  = weeks.map(w => wMap.get(w) || 0);
    const total       = weeklyTots.reduce((s, v) => s + v, 0);
    const activeWeeks = weeklyTots.filter(v => v > 0).length;

    // ── Time utilization from hours sheet ──
    const empHours    = hoursMap.get(name) || new Map();
    const weeklyUtils = weeks.map(w => {
      const h = empHours.get(w);
      return h ? h.utilization : null;
    });
    const validUtils     = weeklyUtils.filter(v => v !== null);
    const avgUtilization = validUtils.length > 0
      ? Math.round(validUtils.reduce((s, v) => s + v, 0) / validUtils.length)
      : null;
    const timeActiveWeeks = validUtils.filter(v => v >= CI_CONFIG.TIME_ACTIVE_MIN_PCT).length;
    const timeStatus = avgUtilization === null ? "No Data"
      : avgUtilization >= CI_CONFIG.TIME_ACTIVE_MIN_PCT  ? "Active"
      : avgUtilization >= CI_CONFIG.TIME_PARTIAL_MIN_PCT ? "Partial"
      : "Low";

    // Last trend week hours — search backwards to find most recent week with data
    let lastWeekH = null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const h = empHours.get(weeks[i]);
      if (h) { lastWeekH = h; break; }
    }
    const lastNsHrs  = lastWeekH ? Math.round(lastWeekH.planned) : null;
    const lastPtoHrs = lastWeekH ? Math.round(lastWeekH.pto)     : null;
    const lastTpHrs  = lastWeekH ? Math.round(lastWeekH.tempo)   : null;

    // ── 4-week evidence: logged (Tempo) hours, kudos received, goal self-comments ──
    const ev = buildEvidence_(name, weeks, empHours, kudosMap, commentsMap);

    byTitle.get(title).push({
      name, hireDate, weeklyTots, total, activeWeeks,
      weeklyUtils, avgUtilization, timeActiveWeeks, timeStatus,
      lastNsHrs, lastPtoHrs, lastTpHrs,
      ...ev,
    });
  });

  const profiles = [];
  byTitle.forEach((members, title) => {
    const profileTopTotal = Math.max(...members.map(m => m.total));

    // Classify each member using dual-signal composite
    members.forEach(m => {
      m.status     = classifyEmployee_(m.hireDate, m.activeWeeks, windowStart, m.timeStatus);
      m.flagReview = isReviewFlag_(m.hireDate, m.activeWeeks, profileTopTotal, m.timeStatus);
    });

    const active       = members.filter(m => m.status === "Active");
    const trackingOnly = members.filter(m => m.status === "Tracking Only");
    const jiraOnly     = members.filter(m => m.status === "Jira Only");
    const needsSupport = members.filter(m => m.status === "Needs Support");
    const rampUp       = members.filter(m => m.status === "Ramp-Up");
    const inactive     = members.filter(m => m.status === "Inactive");
    const reviewFlags  = members.filter(m => m.flagReview);

    const tenuredCount   = members.length - rampUp.length;
    const engagementRate = tenuredCount > 0
      ? Math.round((active.length / tenuredCount) * 100)
      : 0;

    // Per-week totals for the profile (sum across all members)
    const profileWeeklyTotals = weeks.map((_, wi) =>
      members.reduce((s, m) => s + (m.weeklyTots[wi] || 0), 0)
    );

    // WoW delta: last week vs second-to-last
    const lastW  = profileWeeklyTotals[weeks.length - 1] || 0;
    const priorW = profileWeeklyTotals[weeks.length - 2] || 0;
    const wowDelta = wowDelta_(lastW, priorW);

    // Profile-level time utilization aggregate (tenured members with data)
    const tenuredUtils = members
      .filter(m => m.status !== "Ramp-Up" && m.avgUtilization !== null)
      .map(m => m.avgUtilization);
    const profileAvgUtil = tenuredUtils.length > 0
      ? Math.round(tenuredUtils.reduce((s, v) => s + v, 0) / tenuredUtils.length)
      : null;
    const timeActiveCount = members.filter(m => m.timeStatus === "Active").length;

    profiles.push({
      title,
      members,
      active, trackingOnly, jiraOnly, needsSupport, rampUp, inactive, reviewFlags,
      tenuredCount, engagementRate,
      profileWeeklyTotals, profileTopTotal,
      lastW, priorW, wowDelta,
      totalContributions: members.reduce((s, m) => s + m.total, 0),
      profileAvgUtil, timeActiveCount,
    });
  });

  // Sort: highest engagement rate first, then highest total contributions
  profiles.sort((a, b) =>
    b.engagementRate - a.engagementRate || b.totalContributions - a.totalContributions
  );

  return profiles;
}

// ── SECTION: SHEET WRITER ─────────────────────────────────────

/**
 * Returns or creates the output sheet, wiping it first.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOutputSheet_() {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  let   sheet = ss.getSheetByName(CI_CONFIG.OUTPUT_SHEET);
  if (!sheet) sheet = ss.insertSheet(CI_CONFIG.OUTPUT_SHEET);
  sheet.clearContents();
  sheet.clearFormats();
  return sheet;
}

/**
 * Applies background + font colour to a cell by status.
 * @param {GoogleAppsScript.Spreadsheet.Range} range
 * @param {"Active"|"Needs Support"|"Ramp-Up"|"Inactive"} status
 */
function applyStatusStyle_(range, status) {
  const MAP = {
    "Active":        [CI_COLORS.ACTIVE_BG,    CI_COLORS.ACTIVE_FG],
    "Tracking Only": [CI_COLORS.TRACKING_BG,  CI_COLORS.TRACKING_FG],
    "Jira Only":     [CI_COLORS.JIRA_BG,      CI_COLORS.JIRA_FG],
    "Needs Support": [CI_COLORS.NEEDS_BG,     CI_COLORS.NEEDS_FG],
    "Ramp-Up":       [CI_COLORS.RAMPUP_BG,    CI_COLORS.RAMPUP_FG],
    "Inactive":      [CI_COLORS.INACTIVE_BG,  CI_COLORS.INACTIVE_FG],
  };
  const [bg, fg] = MAP[status] || ["#FFFFFF", "#000000"];
  range.setBackground(bg).setFontColor(fg).setFontWeight("bold");
}

/**
 * Writes the full Team Segmentation sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {object[]}                            profiles - Output of buildProfileAggregation_().
 * @param {string[]}                            weeks
 */
function writeContributionSheet_(sheet, profiles, weeks) {
  const COLS = {
    PROFILE:      1,
    HC:           2,
    ACTIVE:       3,
    TRACKING:     4,   // Tracking Only (time ✅, Jira ❌)
    JIRA_ONLY:    5,   // Jira Only (Jira ✅, time ❌)
    NEEDS:        6,
    INACTIVE:     7,
    RAMPUP:       8,
    REVIEW:       9,
    ENG_RATE:     10,
    AVG_UTIL:     11,
    WOW:          12,
  };
  // Week columns start after the fixed columns, one per trend week
  const WEEK_START_COL = 13;
  const TOTAL_COLS = WEEK_START_COL + weeks.length - 1;

  let row = 1;

  // ── SECTION A: EXECUTIVE CANVAS ──────────────────────────────

  // A1: Title banner
  sheet.getRange(row, 1, 1, TOTAL_COLS)
    .merge()
    .setValue("📊  Team Segmentation — BACKLOG ENGAGEMENT REPORT")
    .setBackground(CI_COLORS.VOID_BLUE)
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setFontSize(13)
    .setFontFamily("Arial")
    .setHorizontalAlignment("center")
    .setVerticalAlignment("middle");
  sheet.setRowHeight(row, 36);
  row++;

  // A2: Subtitle / anchor phrase
  sheet.getRange(row, 1, 1, TOTAL_COLS)
    .merge()
    .setValue('"We measure contribution to ensure every Rocketeer has the context, support, and recognition to deliver at their best."')
    .setBackground(CI_COLORS.LIGHT_CREAM)
    .setFontColor(CI_COLORS.VOID_BLUE)
    .setFontStyle("italic")
    .setFontSize(10)
    .setHorizontalAlignment("center");
  row++;

  // A3: Generated timestamp
  sheet.getRange(row, 1, 1, TOTAL_COLS)
    .merge()
    .setValue(`Generated: ${new Date().toLocaleString()}  |  Trend window: ${weeks[0]} → ${weeks[weeks.length - 1]}  |  Source: "${CI_CONFIG.RAW_SHEET}" + "${CI_CONFIG.ROSTER_SHEET}"`)
    .setBackground(CI_COLORS.LIGHT_CREAM)
    .setFontColor("#595959")
    .setFontSize(9)
    .setHorizontalAlignment("center");
  row++;
  row++; // blank spacer

  // ── SECTION B: EXECUTIVE SUMMARY METRICS ─────────────────────

  // Compute company-wide aggregates
  const totalHC        = profiles.reduce((s, p) => s + p.members.length, 0);
  const totalActive    = profiles.reduce((s, p) => s + p.active.length, 0);
  const totalTracking  = profiles.reduce((s, p) => s + p.trackingOnly.length, 0);
  const totalJiraOnly  = profiles.reduce((s, p) => s + p.jiraOnly.length, 0);
  const totalNeeds     = profiles.reduce((s, p) => s + p.needsSupport.length, 0);
  const totalRampUp    = profiles.reduce((s, p) => s + p.rampUp.length, 0);
  const totalInactive  = profiles.reduce((s, p) => s + p.inactive.length, 0);
  const totalReview    = profiles.reduce((s, p) => s + p.reviewFlags.length, 0);
  const tenuredHC      = totalHC - totalRampUp;
  const companyEngRate = tenuredHC > 0 ? Math.round((totalActive / tenuredHC) * 100) : 0;

  const summaryLabels = ["Total HC", "Active", "Tracking Only", "Jira Only", "Ramp-Up", "Inactive", "Review Flags", "Engagement Rate"];
  const summaryValues = [totalHC, totalActive, totalTracking, totalJiraOnly, totalRampUp, totalInactive, totalReview, `${companyEngRate}%`];
  const summaryColors = [
    CI_COLORS.VOID_BLUE,
    CI_COLORS.ACTIVE_FG,
    CI_COLORS.TRACKING_FG,
    CI_COLORS.JIRA_FG,
    CI_COLORS.RAMPUP_FG,
    CI_COLORS.INACTIVE_FG,
    CI_COLORS.REVIEW_FG,
    companyEngRate >= 60 ? CI_COLORS.ACTIVE_FG : companyEngRate >= 40 ? CI_COLORS.NEEDS_FG : CI_COLORS.INACTIVE_FG,
  ];

  // Section header
  sheet.getRange(row, 1, 1, TOTAL_COLS).merge();
  styleSectionRow_(sheet.getRange(row, 1, 1, TOTAL_COLS).merge()
    .setValue("📈  COMPANY-WIDE ENGAGEMENT SNAPSHOT"));
  row++;

  // Metric cards — labels row
  const metricCols = 8;
  const colWidth   = Math.max(2, Math.floor(TOTAL_COLS / metricCols));
  summaryLabels.forEach((label, i) => {
    const startCol = 1 + i * colWidth;
    const endCol   = Math.min(startCol + colWidth - 1, TOTAL_COLS);
    sheet.getRange(row, startCol, 1, endCol - startCol + 1).merge()
      .setValue(label)
      .setBackground(CI_COLORS.IVORY)
      .setFontColor(CI_COLORS.VOID_BLUE)
      .setFontSize(9)
      .setFontWeight("bold")
      .setHorizontalAlignment("center");
  });
  row++;

  // Metric cards — value row
  summaryValues.forEach((val, i) => {
    const startCol = 1 + i * colWidth;
    const endCol   = Math.min(startCol + colWidth - 1, TOTAL_COLS);
    sheet.getRange(row, startCol, 1, endCol - startCol + 1).merge()
      .setValue(val)
      .setBackground("#FFFFFF")
      .setFontColor(summaryColors[i])
      .setFontSize(16)
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle");
  });
  sheet.setRowHeight(row, 40);
  row++;
  row++; // spacer

  // ── SECTION C: KEY SIGNALS ────────────────────────────────────

  styleSectionRow_(sheet.getRange(row, 1, 1, TOTAL_COLS).merge()
    .setValue("🔍  KEY SIGNALS  (Facts · Concerns · Recognition)"));
  row++;

  // Identify signals from data
  const topProfile    = profiles[0];
  const bottomProfile = profiles[profiles.length - 1];
  const risingProfiles = profiles
    .filter(p => p.lastW > p.priorW && p.lastW > 0)
    .sort((a, b) => (b.lastW - b.priorW) - (a.lastW - a.priorW))
    .slice(0, 2);
  const droppingProfiles = profiles
    .filter(p => p.lastW < p.priorW)
    .sort((a, b) => (a.lastW - a.priorW) - (b.lastW - b.priorW))
    .slice(0, 2);

  const signals = [];

  // FACTS
  signals.push(["FACT",
    `Top performing profile: "${topProfile.title}" — ${topProfile.engagementRate}% engagement rate, `
    + `${topProfile.active.length} active of ${topProfile.tenuredCount} tenured ICs.`]);

  signals.push(["FACT",
    `Company engagement rate stands at ${companyEngRate}% (${totalActive} Active / ${tenuredHC} tenured ICs). `
    + `${totalRampUp} employee${totalRampUp !== 1 ? "s" : ""} in 90-day ramp-up window (excluded from rate).`]);

  if (risingProfiles.length > 0) {
    signals.push(["FACT",
      `WoW momentum: ${risingProfiles.map(p => `"${p.title.split(" - ")[1] || p.title}" (${wowDelta_(p.lastW, p.priorW)})`).join(", ")} — `
      + `these profiles are moving the backlog.`]);
  }

  // CONCERNS
  if (totalTracking > 0) {
    signals.push(["FACT",
      `${totalTracking} Rocketeer${totalTracking !== 1 ? "s" : ""} classified as "Tracking Only": time is tracked but no Jira backlog items recorded. `
      + `These employees are working — context conversation recommended, not a concern.`]);
  }

  if (totalJiraOnly > 0) {
    signals.push(["CONCERN",
      `${totalJiraOnly} Rocketeer${totalJiraOnly !== 1 ? "s" : ""} classified as "Jira Only": Jira items recorded but time tracking appears low. `
      + `Check NetSuite / Tempo entries — this may be an administrative gap, not an engagement issue.`]);
  }

  if (totalInactive > 0) {
    signals.push(["CONCERN",
      `${totalInactive} tenured IC${totalInactive !== 1 ? "s" : ""} contributed 0 items across all ${weeks.length} tracked weeks AND show low time utilization. `
      + `This is a genuine engagement gap that needs a direct conversation.`]);
  }

  if (totalReview > 0) {
    signals.push(["CONCERN",
      `${totalReview} review flag${totalReview !== 1 ? "s" : ""} raised: tenured employees (≥${CI_CONFIG.REVIEW_TENURE_MONTHS} months) `
      + `with ≤${CI_CONFIG.REVIEW_MAX_ACTIVE_WEEKS} active week(s) in profiles where peers are actively contributing. `
      + `Same role, different engagement — warrants a 1:1 this week (${weeks[weeks.length - 1]}).`]);
  }

  if (droppingProfiles.length > 0) {
    signals.push(["CONCERN",
      `WoW drop detected in: ${droppingProfiles.map(p => `"${p.title.split(" - ")[1] || p.title}" (${wowDelta_(p.lastW, p.priorW)})`).join(", ")}. `
      + `Monitor for 2 consecutive weeks before escalating.`]);
  }

  if (bottomProfile.engagementRate < 30) {
    signals.push(["CONCERN",
      `"${bottomProfile.title}" has the lowest engagement rate at ${bottomProfile.engagementRate}%. `
      + `${bottomProfile.inactive.length} inactive, ${bottomProfile.needsSupport.length} needs support. Priority for manager check-in.`]);
  }

  // RECOGNITION
  const topContributor = profiles
    .flatMap(p => p.members)
    .sort((a, b) => b.total - a.total)[0];
  if (topContributor) {
    signals.push(["RECOGNITION",
      `Top individual contributor: ${topContributor.name} — ${topContributor.total} total items across ${weeks.length} weeks `
      + `(active in ${topContributor.activeWeeks}/${weeks.length} weeks). `
      + `Exemplifies Leadership Behavior 9.5: Master of cadence and repeatability.`]);
  }

  const mostConsistent = profiles.flatMap(p => p.members)
    .filter(m => m.activeWeeks === weeks.length)
    .sort((a, b) => b.total - a.total);
  if (mostConsistent.length > 0) {
    signals.push(["RECOGNITION",
      `${mostConsistent.length} Rocketeer${mostConsistent.length !== 1 ? "s" : ""} contributed every tracked week `
      + `(${weeks.join(", ")}): ${mostConsistent.slice(0, 5).map(m => m.name).join(", ")}${mostConsistent.length > 5 ? ", +" + (mostConsistent.length - 5) + " more" : ""}. `
      + `Consistent delivery is the foundation of delivery trust.`]);
  }

  // Write signal rows
  const SIGNAL_COLORS = {
    "FACT":        { bg: CI_COLORS.RAMPUP_BG,   fg: CI_COLORS.RAMPUP_FG,   label: "FACT" },
    "CONCERN":     { bg: CI_COLORS.INACTIVE_BG,  fg: CI_COLORS.INACTIVE_FG,  label: "CONCERN" },
    "RECOGNITION": { bg: CI_COLORS.ACTIVE_BG,    fg: CI_COLORS.ACTIVE_FG,    label: "RECOGNITION" },
  };

  signals.forEach(([type, text]) => {
    const sc = SIGNAL_COLORS[type] || {};
    sheet.getRange(row, 1)
      .setValue(type)
      .setBackground(sc.bg || CI_COLORS.IVORY)
      .setFontColor(sc.fg || CI_COLORS.VOID_BLUE)
      .setFontWeight("bold")
      .setFontSize(9)
      .setHorizontalAlignment("center");
    sheet.getRange(row, 2, 1, TOTAL_COLS - 1).merge()
      .setValue(text)
      .setBackground("#FFFFFF")
      .setFontColor("#1A1A1A")
      .setFontSize(9)
      .setWrap(true);
    sheet.setRowHeight(row, 36);
    row++;
  });
  row++; // spacer

  // ── SECTION D: PROFILE-RATE TABLE ────────────────────────────

  styleSectionRow_(sheet.getRange(row, 1, 1, TOTAL_COLS).merge()
    .setValue("📋  PROFILE CONTRIBUTION RATE  — click a row to see individual IDs below"));
  row++;

  // Table column headers
  const tableHeaders = [
    "Job Profile",
    "HC",
    "Active",
    "Tracking Only",
    "Jira Only",
    "Needs Support",
    "Inactive",
    "Ramp-Up",
    "Review ⚑",
    "Engage %",
    "Avg Util%",
    "WoW Δ",
    ...weeks.map(w => w + " (total)"),
  ];

  sheet.getRange(row, 1, 1, TOTAL_COLS).setValues([tableHeaders]);
  ciStyleHeader_(sheet.getRange(row, 1, 1, TOTAL_COLS));
  sheet.setRowHeight(row, 28);
  row++;

  const TABLE_START_ROW = row;

  profiles.forEach(profile => {
    const rowData = [
      profile.title,
      profile.members.length,
      profile.active.length,
      profile.trackingOnly.length,
      profile.jiraOnly.length,
      profile.needsSupport.length,
      profile.inactive.length,
      profile.rampUp.length,
      profile.reviewFlags.length,
      `${profile.engagementRate}%`,
      profile.profileAvgUtil !== null ? `${profile.profileAvgUtil}%` : "—",
      profile.wowDelta,
      ...profile.profileWeeklyTotals,
    ];

    sheet.getRange(row, 1, 1, TOTAL_COLS).setValues([rowData]);

    // Style the profile name cell
    sheet.getRange(row, COLS.PROFILE)
      .setFontWeight("bold")
      .setFontSize(9)
      .setFontColor(CI_COLORS.VOID_BLUE)
      .setBackground(CI_COLORS.LIGHT_CREAM);

    // Engagement rate colour
    const engCell = sheet.getRange(row, COLS.ENG_RATE);
    const er = profile.engagementRate;
    if (er >= 60)      engCell.setFontColor(CI_COLORS.ACTIVE_FG).setFontWeight("bold");
    else if (er >= 35) engCell.setFontColor(CI_COLORS.NEEDS_FG).setFontWeight("bold");
    else               engCell.setFontColor(CI_COLORS.INACTIVE_FG).setFontWeight("bold");

    // Avg util colour
    if (profile.profileAvgUtil !== null) {
      const utilCell = sheet.getRange(row, COLS.AVG_UTIL);
      if (profile.profileAvgUtil >= CI_CONFIG.TIME_ACTIVE_MIN_PCT)
        utilCell.setFontColor(CI_COLORS.ACTIVE_FG).setFontWeight("bold");
      else if (profile.profileAvgUtil >= CI_CONFIG.TIME_PARTIAL_MIN_PCT)
        utilCell.setFontColor(CI_COLORS.NEEDS_FG).setFontWeight("bold");
      else
        utilCell.setFontColor(CI_COLORS.INACTIVE_FG).setFontWeight("bold");
    }

    // WoW delta colour
    const wowCell = sheet.getRange(row, COLS.WOW);
    if (profile.wowDelta.startsWith("↑"))      wowCell.setFontColor(CI_COLORS.UP_FG).setFontWeight("bold");
    else if (profile.wowDelta.startsWith("↓")) wowCell.setFontColor(CI_COLORS.DOWN_FG).setFontWeight("bold");
    else                                        wowCell.setFontColor(CI_COLORS.FLAT_FG);

    // Colour status count cells
    if (profile.active.length > 0)
      sheet.getRange(row, COLS.ACTIVE).setFontColor(CI_COLORS.ACTIVE_FG).setFontWeight("bold");
    if (profile.trackingOnly.length > 0)
      sheet.getRange(row, COLS.TRACKING).setFontColor(CI_COLORS.TRACKING_FG).setFontWeight("bold");
    if (profile.jiraOnly.length > 0)
      sheet.getRange(row, COLS.JIRA_ONLY).setFontColor(CI_COLORS.JIRA_FG).setFontWeight("bold");
    if (profile.needsSupport.length > 0)
      sheet.getRange(row, COLS.NEEDS).setFontColor(CI_COLORS.NEEDS_FG).setFontWeight("bold");
    if (profile.rampUp.length > 0)
      sheet.getRange(row, COLS.RAMPUP).setFontColor(CI_COLORS.RAMPUP_FG).setFontWeight("bold");
    if (profile.inactive.length > 0)
      sheet.getRange(row, COLS.INACTIVE).setFontColor(CI_COLORS.INACTIVE_FG).setFontWeight("bold");
    if (profile.reviewFlags.length > 0)
      sheet.getRange(row, COLS.REVIEW).setFontColor(CI_COLORS.REVIEW_FG).setFontWeight("bold");

    // Thin bottom border
    sheet.getRange(row, 1, 1, TOTAL_COLS)
      .setBorder(false, false, true, false, false, false, "#DDDDDD", SpreadsheetApp.BorderStyle.SOLID);

    row++;

    // ── Employee Detail Rows (indented under each profile) ──
    // Status sections: Active → Tracking Only → Jira Only → Needs Support → Inactive → Ramp-Up
    const sections = [
      { label: "✅  Active",              items: profile.active,       status: "Active"         },
      { label: "🔵  Tracking Only",       items: profile.trackingOnly, status: "Tracking Only"  },
      { label: "🟡  Jira Only",           items: profile.jiraOnly,     status: "Jira Only"      },
      { label: "⚠️  Needs Support",       items: profile.needsSupport, status: "Needs Support"  },
      { label: "🔴  Inactive",            items: profile.inactive,     status: "Inactive"       },
      { label: "🔵  Ramp-Up (90d)",       items: profile.rampUp,       status: "Ramp-Up"        },
    ];

    sections.forEach(({ label, items, status }) => {
      if (items.length === 0) return;

      // Sub-section label
      sheet.getRange(row, 2, 1, TOTAL_COLS - 1).merge()
        .setValue(label)
        .setBackground(CI_COLORS.IVORY)
        .setFontColor(CI_COLORS.VOID_BLUE)
        .setFontSize(9)
        .setFontWeight("bold")
        .setFontStyle("italic");
      sheet.setRowHeight(row, 18);
      row++;

      // Column mini-headers for employee detail rows
      const detailHeaders = [
        "", "Employee ID / Name",
        ...weeks.map(w => w),
        "Total", "Active Wks", "Avg Util%", "Time Status", "NS Hrs", "PTO Hrs", "TP Hrs", "Status", "Flag",
        // 4-week evidence, one value per week in the same order as the week columns
        "Logged h / wk", "Kudos / wk", "Goal comments / wk",
      ];
      sheet.getRange(row, 1, 1, detailHeaders.length)
        .setValues([detailHeaders])
        .setBackground("#F5F5F5")
        .setFontSize(8)
        .setFontColor("#595959")
        .setFontWeight("bold");
      row++;

      items
        .sort((a, b) => b.total - a.total)  // highest contributors first
        .forEach(emp => {
          const tenureMonths = emp.hireDate ? monthsBetween_(emp.hireDate, today_()) : null;
          const hireDateStr  = emp.hireDate
            ? `${emp.hireDate.getMonth() + 1}/${emp.hireDate.getDate()}/${emp.hireDate.getFullYear()}`
            : "—";
          const flagText = emp.flagReview ? "⚑ REVIEW" : "";
          const n = weeks.length;

          // col offsets: 1=blank, 2=name, 3..2+n=weeks, 3+n=total, 4+n=activeWks,
          // 5+n=avgUtil, 6+n=timeStatus, 7+n=nsHrs, 8+n=ptoHrs, 9+n=tpHrs, 10+n=status, 11+n=flag,
          // 12+n=logged h/wk, 13+n=kudos/wk, 14+n=goal comments/wk
          const empRowData = [
            "",
            `${emp.name}  (hired ${hireDateStr}${tenureMonths !== null ? `, ${tenureMonths}mo` : ""})`,
            ...emp.weeklyTots,
            emp.total,
            `${emp.activeWeeks}/${n}`,
            emp.avgUtilization !== null ? `${emp.avgUtilization}%` : "—",
            emp.timeStatus,
            emp.lastNsHrs  !== null ? emp.lastNsHrs  : "—",
            emp.lastPtoHrs !== null ? emp.lastPtoHrs : "—",
            emp.lastTpHrs  !== null ? emp.lastTpHrs  : "—",
            emp.status,
            flagText,
            evidenceText_(emp.weeklyHrs,      emp.loggedTotal,   "h"),
            evidenceText_(emp.weeklyKudos,    emp.kudosTotal,    ""),
            evidenceText_(emp.weeklyComments, emp.commentsTotal, ""),
          ];

          sheet.getRange(row, 1, 1, empRowData.length).setValues([empRowData]);
          sheet.getRange(row, 12 + n, 1, 3)
            .setFontSize(9).setHorizontalAlignment("center").setFontColor(CI_COLORS.VOID_BLUE);
          if (emp.kudosList && emp.kudosList.length) {
            // The kudos themselves are the evidence — hover the cell to read them.
            sheet.getRange(row, 13 + n).setNote(
              emp.kudosList.map(k => `${k.week} — ${k.giver}: ${k.desc}`).join("\n\n"));
          }
          sheet.getRange(row, 1).setBackground("#FAFAFA");

          // Name cell
          sheet.getRange(row, 2)
            .setFontSize(9)
            .setFontColor(CI_COLORS.VOID_BLUE)
            .setFontWeight(emp.flagReview ? "bold" : "normal");

          // Week cells
          weeks.forEach((_, wi) => {
            const cell = sheet.getRange(row, 3 + wi);
            cell.setFontSize(9).setHorizontalAlignment("center");
            if (emp.weeklyTots[wi] > 0) {
              cell.setFontColor(CI_COLORS.ACTIVE_FG).setFontWeight("bold");
            } else {
              cell.setFontColor("#AAAAAA");
            }
          });

          // Total cell
          sheet.getRange(row, 3 + n)
            .setFontSize(9).setFontWeight("bold")
            .setHorizontalAlignment("center")
            .setFontColor(emp.total > 0 ? CI_COLORS.VOID_BLUE : "#AAAAAA");

          // Active weeks cell
          sheet.getRange(row, 4 + n)
            .setFontSize(9).setHorizontalAlignment("center")
            .setFontColor(
              emp.activeWeeks >= CI_CONFIG.ACTIVE_THRESHOLD ? CI_COLORS.ACTIVE_FG :
              emp.activeWeeks >= CI_CONFIG.NEEDS_SUPPORT_MIN ? CI_COLORS.NEEDS_FG :
              CI_COLORS.INACTIVE_FG
            ).setFontWeight("bold");

          // Avg Util% cell
          if (emp.avgUtilization !== null) {
            const utilFg = emp.avgUtilization >= CI_CONFIG.TIME_ACTIVE_MIN_PCT ? CI_COLORS.ACTIVE_FG
              : emp.avgUtilization >= CI_CONFIG.TIME_PARTIAL_MIN_PCT ? CI_COLORS.NEEDS_FG
              : CI_COLORS.INACTIVE_FG;
            sheet.getRange(row, 5 + n)
              .setFontSize(9).setFontColor(utilFg).setFontWeight("bold").setHorizontalAlignment("center");
          }

          // Time Status cell — reuse status palette mapped to nearest equivalent
          const tsStyleKey = emp.timeStatus === "Active" ? "Active"
            : emp.timeStatus === "Partial" ? "Needs Support"
            : emp.timeStatus === "Low"     ? "Inactive"
            : "Ramp-Up";
          applyStatusStyle_(sheet.getRange(row, 6 + n), tsStyleKey);
          sheet.getRange(row, 6 + n).setFontSize(9).setHorizontalAlignment("center").setValue(emp.timeStatus);

          // NS Hrs / PTO Hrs / TP Hrs cells
          sheet.getRange(row, 7 + n).setFontSize(9).setHorizontalAlignment("center").setFontColor(CI_COLORS.VOID_BLUE);
          // PTO cell — highlight in blue when non-zero to draw attention
          const ptoCell = sheet.getRange(row, 8 + n);
          ptoCell.setFontSize(9).setHorizontalAlignment("center");
          if (emp.lastPtoHrs !== null && emp.lastPtoHrs > 0) {
            ptoCell.setFontColor(CI_COLORS.TRACKING_FG).setFontWeight("bold");
          } else {
            ptoCell.setFontColor("#AAAAAA");
          }
          sheet.getRange(row, 9 + n).setFontSize(9).setHorizontalAlignment("center").setFontColor(CI_COLORS.VOID_BLUE);

          // Composite status cell
          applyStatusStyle_(sheet.getRange(row, 10 + n), emp.status);
          sheet.getRange(row, 10 + n).setFontSize(9).setHorizontalAlignment("center");

          // Review flag cell
          if (emp.flagReview) {
            sheet.getRange(row, 11 + n)
              .setBackground(CI_COLORS.REVIEW_BG)
              .setFontColor(CI_COLORS.REVIEW_FG)
              .setFontWeight("bold")
              .setFontSize(9)
              .setHorizontalAlignment("center");
          }

          sheet.setRowHeight(row, 18);
          row++;
        });
    });

    // Profile spacer row
    sheet.getRange(row, 1, 1, TOTAL_COLS)
      .setBackground(CI_COLORS.LIGHT_CREAM)
      .setBorder(false, false, true, false, false, false, CI_COLORS.IVORY, SpreadsheetApp.BorderStyle.SOLID);
    sheet.setRowHeight(row, 8);
    row++;
  });

  // ── SECTION F: RECOGNITION PANEL ─────────────────────────────

  row += 2;
  styleSectionRow_(sheet.getRange(row, 1, 1, TOTAL_COLS).merge()
    .setValue("🏆  RECOGNITION PANEL — Spotlight for leadership conversations & all-hands"));
  row++;

  const recognitionHeaders = ["Category", "Employee", "Profile", "Signal", "What to say"];
  sheet.getRange(row, 1, 1, recognitionHeaders.length).setValues([recognitionHeaders]);
  ciStyleHeader_(sheet.getRange(row, 1, 1, recognitionHeaders.length));
  row++;

  const recognitionRows = [];

  // Top contributor per profile
  profiles.forEach(p => {
    const top = p.members.sort((a, b) => b.total - a.total)[0];
    if (top && top.total > 0) {
      recognitionRows.push([
        "🏅 Profile Leader",
        top.name,
        p.title,
        `${top.total} items in ${weeks.length} weeks`,
        `"${top.name} is carrying the backlog forward in their profile every week — a model of consistent delivery."`,
      ]);
    }
  });

  // Perfect attendance (active every week)
  const perfectAttendees = profiles
    .flatMap(p => p.members.map(m => ({ ...m, profileTitle: p.title })))
    .filter(m => m.activeWeeks === weeks.length && m.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  perfectAttendees.forEach(emp => {
    recognitionRows.push([
      "⚡ Consistent Contributor",
      emp.name,
      emp.profileTitle,
      `Active all ${weeks.length} tracked weeks`,
      `"${emp.name} showed up and delivered every single week — that kind of reliability is the foundation our customers and teammates count on."`,
    ]);
  });

  recognitionRows.slice(0, 15).forEach(recRow => {
    sheet.getRange(row, 1, 1, recRow.length).setValues([recRow]);
    sheet.getRange(row, 1)
      .setBackground(CI_COLORS.ACTIVE_BG)
      .setFontColor(CI_COLORS.ACTIVE_FG)
      .setFontWeight("bold")
      .setFontSize(9)
      .setHorizontalAlignment("center");
    sheet.getRange(row, 5).setWrap(true).setFontColor(CI_COLORS.VOID_BLUE).setFontStyle("italic").setFontSize(9);
    sheet.setRowHeight(row, 40);
    row++;
  });

  // ── SECTION G: COLUMN WIDTHS + FREEZE + FOOTER ───────────────

  // Column widths
  sheet.setColumnWidth(COLS.PROFILE,    280);
  sheet.setColumnWidth(COLS.HC,          40);
  sheet.setColumnWidth(COLS.ACTIVE,      50);
  sheet.setColumnWidth(COLS.TRACKING,    80);
  sheet.setColumnWidth(COLS.JIRA_ONLY,   65);
  sheet.setColumnWidth(COLS.NEEDS,       80);
  sheet.setColumnWidth(COLS.INACTIVE,    60);
  sheet.setColumnWidth(COLS.RAMPUP,      60);
  sheet.setColumnWidth(COLS.REVIEW,      60);
  sheet.setColumnWidth(COLS.ENG_RATE,    70);
  sheet.setColumnWidth(COLS.AVG_UTIL,    65);
  sheet.setColumnWidth(COLS.WOW,         65);
  for (let c = WEEK_START_COL; c <= TOTAL_COLS; c++) {
    sheet.setColumnWidth(c, 80);
  }
  // Detail-row evidence columns (12+n..14+n) can sit past TOTAL_COLS — widen them for the per-week text.
  for (let c = 12 + weeks.length; c <= 14 + weeks.length; c++) {
    sheet.setColumnWidth(c, 170);
  }

  sheet.setFrozenRows(1);

  // Footer
  row += 2;
  sheet.getRange(row, 1, 1, 3).setValues([[
    "Generated by: Team Segmentation v1.0.0",
    `Source: "${CI_CONFIG.RAW_SHEET}" + "${CI_CONFIG.ROSTER_SHEET}"`,
    `ISO Week: ${weeks[weeks.length - 1]}`,
  ]]).setFontColor("#888888").setFontSize(8).setFontStyle("italic");

  Logger.log(`✅ [writeContributionSheet_] Done — ${row} rows written.`);
}

// ── SECTION: MAIN ENTRY POINT ─────────────────────────────────


function viewContributionReport() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('viewContributionReport');
  else Logger.log('⚠️ [viewContributionReport] requireMaintainer_ not in this project — running ungated.');
  try {
    const rosterMap  = readRoster_();
    const { weeks, counts } = readJiraRaw_();
    const ptoData    = readPtoData_();
    const hoursMap   = readHoursData_(ptoData.weeklyHours);
    const kudosMap   = readKudosData_();
    const comments   = readGoalComments_();
    const html  = generateHtmlReport_(rosterMap, weeks, counts, hoursMap, ptoData.dateEntries, kudosMap, comments);
    const modal = HtmlService.createHtmlOutput(html).setWidth(1260).setHeight(720);
    SpreadsheetApp.getUi().showModalDialog(modal, "Contribution Intelligence — Report");
  } catch (e) {
    SpreadsheetApp.getUi().alert("Error", e.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}

function runContributionIntelligence() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('runContributionIntelligence');
  else Logger.log('⚠️ [runContributionIntelligence] requireMaintainer_ not in this project — running ungated.');
  try {
    Logger.log("🕐 [runContributionIntelligence] Starting...");

    // 1. Load roster — read once, shared by both outputs
    const rosterMap = readRoster_();
    if (rosterMap.size === 0) {
      throw new Error("Roster returned 0 targeted employees. Check TARGET_PROFILES and Roster sheet headers.");
    }

    // 2. Load Jira Raw over the 4-week evidence window — shared by both outputs
    const { weeks, counts } = readJiraRaw_();

    // 3. Load PTO schedule, hours, kudos, goal comments — all graceful if a source is absent
    const ptoData  = readPtoData_();
    const hoursMap = readHoursData_(ptoData.weeklyHours);
    const kudosMap = readKudosData_();
    const comments = readGoalComments_();
    Logger.log(`ℹ️ Hours data: ${hoursMap.size} employees loaded (PTO from ${ptoData.weeklyHours.size} employees merged).`);

    // 4. Build profile aggregation — same evidence window as the HTML report
    const profiles = buildProfileAggregation_(rosterMap, weeks, counts, hoursMap, kudosMap, comments);
    Logger.log(`ℹ️ Profiles built: ${profiles.length}`);

    // 5. Write Google Sheets tab
    const sheet = getOutputSheet_();
    writeContributionSheet_(sheet, profiles, weeks);
    SpreadsheetApp.flush();
    Logger.log("✅ Sheet written.");

    // 6. Render HTML report inline — no Drive write, data stays within the spreadsheet session
    const html = generateHtmlReport_(rosterMap, weeks, counts, hoursMap, ptoData.dateEntries, kudosMap, comments);
    const modal = HtmlService.createHtmlOutput(html).setWidth(1260).setHeight(720);
    SpreadsheetApp.getUi().showModalDialog(modal, "Contribution Intelligence — Report");
    Logger.log("✅ HTML report rendered in modal.");

  } catch (e) {
    Logger.log(`❌ [runContributionIntelligence] ${e.message}`);
    throw e;
  }
}

// ── SECTION: HTML REPORT GENERATOR ───────────────────────────

/**
 * Generates a self-contained HTML dashboard over the 4-week evidence window —
 * the same weeks, thresholds and per-week evidence (backlog, logged time,
 * kudos, goal comments) as the sheet tab.
 *
 * @param {Map<string,{title:string,hireDate:Date|null}>} rosterMap
 * @param {string[]} weeks   - Evidence-window week keys, oldest → newest.
 * @param {Map<string,Map<string,number>>} counts
 * @returns {string} - Complete standalone HTML document.
 */
function generateHtmlReport_(rosterMap, weeks, counts, hoursMap, ptoDateEntries, kudosMap, commentsMap) {
  if (!hoursMap)       hoursMap       = new Map();
  if (!ptoDateEntries) ptoDateEntries = new Map();
  if (!kudosMap)       kudosMap       = new Map();
  const w8Date     = ciEvidenceWeeks_()[0].start;
  const rampupCut  = new Date(w8Date.getTime() - CI_CONFIG.RAMPUP_DAYS * 24 * 60 * 60 * 1000);
  const pad2       = n => String(n).padStart(2, '0');
  const fmtD       = d => d ? `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}` : null;

  // Pre-compute PTO health date boundaries (server-side, embedded as booleans in rawData)
  const todayMs      = new Date().getTime();
  const recentCutMs  = todayMs - CI_CONFIG.PTO_RECENT_DAYS   * 86400000;
  const upcomingEndMs= todayMs + CI_CONFIG.PTO_UPCOMING_DAYS * 86400000;
  const todayStr     = fmtD(new Date());

  // Build flat employee data array (all tracked weeks, not just trend window)
  const rawData = [];
  rosterMap.forEach(({ title, hireDate }, name) => {
    const wMap       = counts.get(name) || new Map();
    const weeklyTots = weeks.map(w => wMap.get(w) || 0);
    const empHours   = hoursMap.get(name) || new Map();
    const utils      = weeks.map(w => { const h = empHours.get(w); return h ? Math.round(h.utilization) : null; });
    const nsUtils    = weeks.map(w => { const h = empHours.get(w); return h ? h.nsUtil : null; });
    const tpUtils    = weeks.map(w => { const h = empHours.get(w); return h ? h.tpUtil : null; });
    let lastWeekH = null;
    for (let i = weeks.length - 1; i >= 0; i--) {
      const h = empHours.get(weeks[i]);
      if (h) { lastWeekH = h; break; }
    }
    const lastNs  = lastWeekH ? Math.round(lastWeekH.planned) : null;
    const lastPto = lastWeekH ? Math.round(lastWeekH.pto)     : null;
    const lastTp  = lastWeekH ? Math.round(lastWeekH.tempo)   : null;
    const ev          = buildEvidence_(name, weeks, empHours, kudosMap, commentsMap);
    const empPtoDates = ptoDateEntries.get(name) || [];
    const ptoRecent   = empPtoDates.some(e => { const t = e.date.getTime(); return t >= recentCutMs  && t <= todayMs; });
    const ptoPending  = empPtoDates.some(e => { const t = e.date.getTime(); return t >  todayMs      && t <= upcomingEndMs; });
    rawData.push({
      name,
      title,
      hire:  fmtD(hireDate),
      weeks: weeklyTots,
      total: weeklyTots.reduce((s, v) => s + v, 0),
      utils,
      nsUtils,
      tpUtils,
      lastNs,
      lastPto,
      lastTp,
      hrs:        ev.weeklyHrs,
      kudos:      ev.weeklyKudos,
      kudosFy:    ev.kudosFy,
      kudosList:  ev.kudosList,
      cmts:       ev.weeklyComments,
      ptoRecent,
      ptoPending,
    });
  });
  rawData.sort((a, b) => a.title.localeCompare(b.title) || b.total - a.total);

  const w8Str      = fmtD(w8Date);
  const cutoffStr  = fmtD(rampupCut);
  // Same thresholds as the sheet — both now read the same 4-week window.
  const activeMin  = CI_CONFIG.ACTIVE_THRESHOLD;
  const needsMin   = CI_CONFIG.NEEDS_SUPPORT_MIN;
  const rDays      = CI_CONFIG.RAMPUP_DAYS;
  const rvTen      = CI_CONFIG.REVIEW_TENURE_MONTHS;
  const rvMaxWks   = CI_CONFIG.REVIEW_MAX_ACTIVE_WEEKS;
  const rvMinTot   = CI_CONFIG.REVIEW_MIN_PROFILE_TOTAL;
  const firstWk    = weeks[0];
  const lastWk     = weeks[weeks.length - 1];
  const genAt      = new Date().toLocaleString();
  const weeksJson      = JSON.stringify(weeks);
  // Kudos text is free-form: "</script>" inside it would end the inline script early.
  const rawJson        = JSON.stringify(rawData).replace(/</g, '\\u003c');
  const rSrc           = CI_CONFIG.RAW_SHEET;
  const rRoster        = CI_CONFIG.ROSTER_SHEET;
  const timeActivePct  = CI_CONFIG.TIME_ACTIVE_MIN_PCT;
  const timePartialPct = CI_CONFIG.TIME_PARTIAL_MIN_PCT;
  const fyStartStr     = fmtD(ciFyStart_());
  const fyLabel        = `FY${ciFyStart_().getFullYear() + 1}`;
  const ptoRecentDays  = CI_CONFIG.PTO_RECENT_DAYS;
  const ptoUpcomingDays= CI_CONFIG.PTO_UPCOMING_DAYS;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Team Segmentation — ${firstWk}→${lastWk}</title>
<style>
:root{
  --ct-p:#1A1A1A;--ct-s:#595959;--ct-t:#888888;
  --cb-p:#FFFFFF;--cb-s:#F8F8F6;
  --bd-s:#DDDDDD;--bd-t:#E8E8E8;
  --cb-info:#EBF3FF;--ct-info:#1A52B3;--bd-info:#AACCFF;
  --r:6px;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#FAFAFA;color:var(--ct-p);padding:20px;max-width:1260px;}
h1{font-size:18px;font-weight:700;color:#0F1941;margin-bottom:4px;}
.sub{font-size:12px;color:var(--ct-s);margin-bottom:4px;font-style:italic;}
.meta{font-size:10px;color:var(--ct-t);margin-bottom:20px;}
.top-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:1rem;}
.filter-btn{background:transparent;border:.5px solid var(--bd-s);border-radius:var(--r);padding:4px 12px;font-size:11px;cursor:pointer;color:var(--ct-s);}
.filter-btn.on{background:var(--cb-info);color:var(--ct-info);border-color:var(--bd-info);font-weight:500;}
.legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--ct-s);margin-bottom:1rem;}
.leg-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle;}
table{width:100%;border-collapse:collapse;font-size:11px;table-layout:fixed;}
thead th{text-align:left;padding:6px 8px;font-size:10px;font-weight:500;color:var(--ct-s);border-bottom:.5px solid var(--bd-t);white-space:nowrap;background:var(--cb-s);}
tbody tr.prow{border-bottom:.5px solid var(--bd-t);cursor:pointer;}
tbody tr.prow:hover{background:var(--cb-s);}
td{padding:7px 8px;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.rflag{display:inline-block;font-size:9px;padding:1px 5px;border-radius:3px;background:#FCEBEB;color:#A32D2D;font-weight:500;margin-left:4px;}
.drow{display:none;background:var(--cb-s);}
.drow.open{display:table-row;}
.d-inner{padding:10px 12px;}
.emp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px;}
.emp-card{background:var(--cb-p);border:.5px solid var(--bd-t);border-radius:var(--r);padding:8px 10px;}
.emp-name{font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.emp-link{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;}
.hp-panel{display:none;position:fixed;top:0;right:0;width:320px;height:100%;background:#FFF;border-left:1px solid #DDD;box-shadow:-4px 0 12px rgba(0,0,0,.12);z-index:999;padding:16px;overflow-y:auto;}
.hp-panel.open{display:block;}
.hp-close{float:right;cursor:pointer;font-size:16px;color:#888;}
.hi-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:.5px solid #F0F0F0;}
.hi-icon{font-size:14px;width:20px;text-align:center;}
.hi-label{font-size:11px;color:#595959;flex:1;}
.hi-val{font-size:11px;font-weight:500;}
.emp-tot{font-size:13px;font-weight:500;}
.util-track{display:inline-block;width:60px;height:6px;background:#E8E8E8;border-radius:3px;vertical-align:middle;overflow:hidden;}
.util-fill{height:100%;border-radius:3px;}
.badge{display:inline-block;font-size:9px;font-weight:600;padding:1px 6px;border-radius:10px;letter-spacing:.3px;}
.badge-engaged{background:#C6EFCE;color:#276221;}
.badge-tracking{background:#E0F2FE;color:#0369A1;}
.badge-jira{background:#FFF7ED;color:#92400E;}
.badge-inactive{background:#FFC7CE;color:#9C0006;}
.badge-rampup{background:#DDEBF7;color:#1F4E79;}
.ev{border-collapse:collapse;table-layout:auto;width:100%;margin-top:5px;font-size:9px;}
.ev th{background:none;border:0;padding:1px 3px;font-size:8px;font-weight:500;color:#888;text-align:center;}
.ev th:first-child,.ev td:first-child{text-align:left;color:#595959;padding-left:0;}
.ev td{padding:1px 3px;text-align:center;white-space:nowrap;}
.ev td.z{color:#C8C8C8;}
.ev td.nd{color:#C8C8C8;font-style:italic;}
.ev td.hit{color:#276221;font-weight:600;}
.sec-note{font-size:10px;color:var(--ct-t);font-style:italic;margin-top:6px;}
.sec-lbl{font-size:10px;font-weight:500;margin-bottom:4px;}
</style>
</head>
<body>
<h1>Team Segmentation — Backlog &amp; Time Contribution Report</h1>
<p class="sub">"We measure contribution to ensure every Rocketeer has the context, support, and recognition to deliver at their best."</p>
<p class="meta">Generated: ${genAt} &nbsp;&middot;&nbsp; Evidence window: last ${weeks.length} completed weeks, ${firstWk} → ${lastWk} &nbsp;&middot;&nbsp; Backlog: "${rSrc}" &middot; Logged time: Tempo hours sheet &middot; Kudos: "${CI_CONFIG.KUDOS_NORMALIZED_SHEET}" &middot; Comments: goal self-comments${commentsMap ? '' : ' (source unavailable)'} &middot; Roster: "${rRoster}"</p>

<div class="top-bar">
  <button class="filter-btn on" onclick="applyFilter('all',this)">All profiles</button>
  <button class="filter-btn" onclick="applyFilter('concern',this)">Has concern</button>
  <button class="filter-btn" onclick="applyFilter('tracking',this)">Tracking only</button>
  <button class="filter-btn" onclick="applyFilter('review',this)">Review flags</button>
  <button class="filter-btn" onclick="applyFilter('rampup',this)">Ramp-up</button>
</div>

<div class="legend">
  <span><span class="leg-dot" style="background:#276221;"></span><strong>Engaged</strong> — Jira ✅ + Time ✅</span>
  <span><span class="leg-dot" style="background:#0369A1;"></span><strong>Tracking Only</strong> — Time ✅ · Jira ❌ (other work, not a concern)</span>
  <span><span class="leg-dot" style="background:#92400E;"></span><strong>Jira Only</strong> — Jira ✅ · Time low (admin gap)</span>
  <span><span class="leg-dot" style="background:#E24B4A;"></span><strong>Inactive</strong> — Jira ❌ + Time ❌</span>
  <span><span class="leg-dot" style="background:#3266ad;"></span>Ramp-up (hired within ${rDays} days of ${firstWk})</span>
  <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#FCEBEB;border:.5px solid #E24B4A;vertical-align:middle;margin-right:4px;"></span>Review flag</span>
</div>

<table id="main-table">
<thead><tr>
  <th style="width:24%;">Job profile</th>
  <th style="width:5%;text-align:center;">HC</th>
  <th style="width:7%;text-align:center;">Engaged</th>
  <th style="width:8%;text-align:center;">Tracking only</th>
  <th style="width:7%;text-align:center;">Jira only</th>
  <th style="width:7%;text-align:center;">Inactive</th>
  <th style="width:6%;text-align:center;">Ramp-up</th>
  <th style="width:8%;text-align:center;">Engage rate</th>
  <th style="width:7%;text-align:center;">Avg Util%</th>
  <th style="width:7%;text-align:center;">Profile avg</th>
  <th style="width:14%;">Distribution</th>
</tr></thead>
<tbody id="tbody"></tbody>
</table>
<p style="font-size:10px;color:var(--ct-t);margin-top:.75rem;">* ${firstWk} starts ~${w8Str}. ${rDays}-day ramp-up window = hired after ${cutoffStr}. Engagement rate = Engaged ÷ (HC − Ramp-up). "Tracking Only" employees are working and are excluded from concern flags. Review flag = tenured (≥${rvTen} months) with ≤${rvMaxWks} active Jira week(s) AND low time utilization where top contributor reached ≥${rvMinTot} total. Click any row to expand.</p>

<script>
var W8_DATE = new Date('${w8Str}');
var RAMPUP_CUTOFF = new Date('${cutoffStr}');
var ACTIVE_MIN = ${activeMin};
var NEEDS_MIN = ${needsMin};
var RV_TENURE = ${rvTen};
var RV_MAX_WKS = ${rvMaxWks};
var RV_MIN_TOT = ${rvMinTot};
var TIME_ACTIVE_PCT = ${timeActivePct};
var TIME_PARTIAL_PCT = ${timePartialPct};
var FY_START_STR = '${fyStartStr}';
var FY_LABEL = '${fyLabel}';
var PTO_RECENT_DAYS = ${ptoRecentDays};
var PTO_UPCOMING_DAYS = ${ptoUpcomingDays};
var TODAY_STR = '${todayStr}';
var weeks = ${weeksJson};
var raw = ${rawJson};

function activeWks(e){return e.weeks.filter(function(v){return v>0;}).length;}
function isRampup(h){return h&&new Date(h)>=RAMPUP_CUTOFF;}
function avgUtil(e){
  var u=(e.utils||[]).filter(function(v){return v!==null;});
  return u.length?Math.round(u.reduce(function(s,v){return s+v;},0)/u.length):null;
}
function avgNsUtil(e){
  var u=(e.nsUtils||[]).filter(function(v){return v!==null;});
  return u.length?Math.round(u.reduce(function(s,v){return s+v;},0)/u.length):null;
}
function avgTpUtil(e){
  var u=(e.tpUtils||[]).filter(function(v){return v!==null;});
  return u.length?Math.round(u.reduce(function(s,v){return s+v;},0)/u.length):null;
}
function compositeStatus(e){
  if(isRampup(e.hire))return'rampup';
  var aw=activeWks(e);
  var au=avgUtil(e);
  var jiraOk=aw>=ACTIVE_MIN;
  var timeOk=au!==null&&au>=TIME_ACTIVE_PCT;
  if(au===null){
    // no hours data — fall back to Jira-only legacy buckets
    if(jiraOk)return'active';
    if(aw>=NEEDS_MIN)return'needs';
    return'inactive';
  }
  if(jiraOk&&timeOk)return'engaged';
  if(!jiraOk&&timeOk)return'tracking';
  if(jiraOk&&!timeOk)return'jira-only';
  return'inactive';
}
function isFlag(e,top){
  var st=compositeStatus(e);
  if(st==='rampup'||st==='tracking'||st==='engaged'||st==='active')return false;
  if(!e.hire)return false;
  var cut=new Date(W8_DATE);cut.setMonth(cut.getMonth()-RV_TENURE);
  return new Date(e.hire)<cut&&activeWks(e)<=RV_MAX_WKS&&top>=RV_MIN_TOT;
}
function utilBar(au){
  if(au===null)return'<span style="font-size:9px;color:#BBB;">no data</span>';
  var col=au>=TIME_ACTIVE_PCT?'#276221':au>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A';
  var w=Math.min(100,au);
  return'<span class="util-track"><span class="util-fill" style="width:'+w+'%;background:'+col+';"></span></span>'+
    '<span style="font-size:9px;color:'+col+';margin-left:3px;">'+au+'%</span>';
}
function utilBar2(label,pct,col,hrs){
  var w=pct!==null?Math.min(100,pct):0;
  var c=pct!==null?col:'#E8E8E8';
  return'<div style="display:flex;align-items:center;gap:4px;margin:2px 0;">'+
    '<span style="font-size:9px;color:#595959;width:16px;">'+label+'</span>'+
    '<span class="util-track"><span class="util-fill" style="width:'+w+'%;background:'+c+';"></span></span>'+
    (pct!==null?'<span style="font-size:9px;color:'+c+';font-weight:500;">'+pct+'%</span>':'')+
    (hrs!==null?'<span style="font-size:9px;color:#888;margin-left:2px;">'+hrs+'h</span>':'')+
  '</div>';
}
function badgeHtml(st){
  var map={engaged:'engaged',tracking:'tracking','jira-only':'jira',inactive:'inactive',rampup:'rampup',active:'engaged',needs:'jira'};
  var cls=map[st]||'inactive';
  var labels={engaged:'Engaged',tracking:'Tracking Only','jira-only':'Jira Only',inactive:'Inactive',rampup:'Ramp-up',active:'Active',needs:'Needs Support'};
  return'<span class="badge badge-'+cls+'">'+labels[st]+'</span>';
}
function shortT(t){
  var d=t.indexOf(' - ');
  var s=d>=0?t.slice(d+3):t;
  return s.replace(', Technical Consulting','').replace(', Service Delivery','')
    .replace(', Project Management','').replace(', Account Management','')
    .replace(', Solution Architecture','').replace(', Customer Support','')
    .replace(', Delivery','');
}
function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g,function(c){
    return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function sum(a){return(a||[]).reduce(function(s,v){return s+(v||0);},0);}
// 4-week evidence grid: one column per evidence week, one row per signal.
// "—" = no data that week (no hours row / comments source unavailable).
function evidenceGrid(e){
  function cell(v,unit){
    if(v===null||v===undefined)return'<td class="nd">&#8212;</td>';
    return'<td class="'+(v>0?'hit':'z')+'">'+v+unit+'</td>';
  }
  function row(lbl,vals,unit){
    var all=(vals||[]).every(function(v){return v===null||v===undefined;});
    return'<tr><td>'+lbl+'</td>'+weeks.map(function(_,i){return cell(vals?vals[i]:null,unit);}).join('')+
      '<td style="color:#595959;font-weight:600;">'+(all?'&#8212;':(Math.round(sum(vals)*10)/10)+unit)+'</td></tr>';
  }
  return'<table class="ev"><tr><th></th>'+weeks.map(function(w){return'<th>'+esc(w.split('.')[1]||w)+'</th>';}).join('')+'<th>4 wk</th></tr>'+
    row('Backlog',e.weeks,'')+
    row('Logged',e.hrs,'h')+
    row('Kudos',e.kudos,'')+
    row('Comments',e.cmts,'')+
  '</table>';
}
function kudosHtml(e){
  var n=sum(e.kudos);
  var col=n>=3?'#276221':n>=1?'#BA7517':'#888';
  var out='<div class="hi-row"><span class="hi-icon">&#11088;</span>'+
    '<span class="hi-label">Kudos (last '+weeks.length+' wks)</span>'+
    '<span class="hi-val" style="color:'+col+';">'+n+(n===1?' kudo':' kudos')+
    ' <span style="color:#888;font-weight:400;">&middot; '+(e.kudosFy||0)+' in '+FY_LABEL+'</span></span></div>';
  if(e.kudosList&&e.kudosList.length){
    out+='<div style="padding:4px 0 4px 28px;">';
    e.kudosList.forEach(function(k){
      var d=k.desc||'';
      out+='<div style="font-size:9px;color:#595959;margin-bottom:3px;">'+
        '<span style="color:#888;">'+esc(k.week)+'</span> '+
        '"'+esc(d.slice(0,90))+(d.length>90?'&#8230;':'')+'" &#8212; '+esc(k.giver)+'</div>';
    });
    out+='</div>';
  }
  return out;
}
function ptoHtml(e){
  var rec=e.ptoRecent;
  var pen=e.ptoPending;
  return'<div class="hi-row"><span class="hi-icon">&#127796;</span>'+
    '<span class="hi-label">PTO taken (90d)</span>'+
    '<span class="hi-val" style="color:'+(rec?'#276221':'#E24B4A')+'">'+(rec?'&#10003; Yes':'&#10007; None')+'</span></div>'+
  '<div class="hi-row"><span class="hi-icon">&#128197;</span>'+
    '<span class="hi-label">PTO planned (6mo)</span>'+
    '<span class="hi-val" style="color:'+(pen?'#276221':'#888')+'">'+(pen?'&#10003; Scheduled':'&mdash; None yet')+'</span></div>';
}
function showHealth(emp,ev){
  ev.stopPropagation();
  var ans=avgNsUtil(emp);
  var atp=avgTpUtil(emp);
  var nsCol=ans!==null?(ans>=TIME_ACTIVE_PCT?'#276221':ans>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A'):'#E8E8E8';
  var tpCol=atp!==null?(atp>=TIME_ACTIVE_PCT?'#276221':atp>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A'):'#E8E8E8';
  var html='<div style="margin-bottom:12px;">'+
    '<div style="font-weight:600;font-size:13px;">'+esc(emp.name)+'</div>'+
    '<div style="font-size:10px;color:#888;margin-bottom:8px;">'+esc(shortT(emp.title))+'</div>'+
    badgeHtml(compositeStatus(emp))+
  '</div>'+
  '<div style="font-size:10px;font-weight:600;color:#0F1941;margin:10px 0 4px;">EVIDENCE &middot; LAST '+weeks.length+' WEEKS</div>'+
  evidenceGrid(emp)+
  '<div style="font-size:10px;font-weight:600;color:#0F1941;margin:12px 0 4px;">THROUGHPUT</div>'+
  '<div class="hi-row"><span class="hi-icon">&#128203;</span><span class="hi-label">Jira items</span>'+
    '<span class="hi-val">'+emp.total+' &#183; '+activeWks(emp)+'/'+weeks.length+' wks</span></div>'+
  utilBar2('NS',ans,nsCol,emp.lastNs)+
  utilBar2('TP',atp,tpCol,emp.lastTp)+
  '<div style="font-size:10px;font-weight:600;color:#0F1941;margin:12px 0 4px;">HEALTH</div>'+
  kudosHtml(emp)+
  ptoHtml(emp)+
  (emp.hire?'<div style="font-size:9px;color:#888;margin-top:12px;">Hired '+emp.hire.slice(0,7)+'</div>':'');
  document.getElementById('hp-content').innerHTML=html;
  document.getElementById('hp-panel').classList.add('open');
}
function closeHealth(){
  document.getElementById('hp-panel').classList.remove('open');
}
var CARD_EMPS=[];
var groups={};
raw.forEach(function(e){if(!groups[e.title])groups[e.title]=[];groups[e.title].push(e);});
var curF='all';

function renderTable(){
  var tb=document.getElementById('tbody');tb.innerHTML='';
  Object.keys(groups).forEach(function(title){
    var emps=groups[title];
    var code=title.split(' - ')[0];
    var top=Math.max.apply(null,emps.map(function(e){return e.total;}));
    var avg=Math.round(emps.reduce(function(s,e){return s+e.total;},0)/emps.length);
    var cl=emps.map(function(e){return Object.assign({},e,{st:compositeStatus(e),fl:isFlag(e,top)});});
    var eng=cl.filter(function(e){return e.st==='engaged'||e.st==='active';});
    var trk=cl.filter(function(e){return e.st==='tracking';});
    var jro=cl.filter(function(e){return e.st==='jira-only'||e.st==='needs';});
    var ina=cl.filter(function(e){return e.st==='inactive';});
    var rmp=cl.filter(function(e){return e.st==='rampup';});
    var fls=cl.filter(function(e){return e.fl;});
    var ten=emps.length-rmp.length;
    var er=ten>0?Math.round((eng.length/ten)*100):0;
    // Profile avg utilization
    var profUtils=emps.map(function(e){return avgUtil(e);}).filter(function(v){return v!==null;});
    var profAvgUtil=profUtils.length?Math.round(profUtils.reduce(function(s,v){return s+v;},0)/profUtils.length):null;
    if(curF==='concern'&&!ina.length&&!fls.length)return;
    if(curF==='tracking'&&!trk.length)return;
    if(curF==='review'&&!fls.length)return;
    if(curF==='rampup'&&!rmp.length)return;
    var ec=er>=60?'#276221':er>=35?'#BA7517':'#E24B4A';
    var dw=80,tot=emps.length;
    var eW=Math.round((eng.length/tot)*dw);
    var tW=Math.round((trk.length/tot)*dw);
    var jW=Math.round((jro.length/tot)*dw);
    var rW=Math.round((rmp.length/tot)*dw);
    var iW=Math.max(0,dw-eW-tW-jW-rW);
    var tr=document.createElement('tr');tr.className='prow';
    tr.innerHTML=
      '<td title="'+title+'" style="font-size:11px;">'+
        '<span style="font-family:monospace;font-size:9px;color:#888;">'+code+'</span>'+
        '<span style="display:block;font-weight:500;overflow:hidden;text-overflow:ellipsis;">'+shortT(title)+'</span>'+
        (fls.length?'<span class="rflag">&#9873; '+fls.length+' review</span>':'')+
      '</td>'+
      '<td style="text-align:center;font-weight:500;">'+emps.length+'</td>'+
      '<td style="text-align:center;"><span style="color:#276221;font-weight:500;">'+eng.length+'</span></td>'+
      '<td style="text-align:center;"><span style="color:#0369A1;font-weight:500;">'+trk.length+'</span></td>'+
      '<td style="text-align:center;"><span style="color:#92400E;font-weight:500;">'+jro.length+'</span></td>'+
      '<td style="text-align:center;"><span style="color:#E24B4A;font-weight:500;">'+ina.length+'</span></td>'+
      '<td style="text-align:center;"><span style="color:#3266ad;font-weight:500;">'+rmp.length+'</span></td>'+
      '<td style="text-align:center;font-weight:500;color:'+ec+';">'+er+'%</td>'+
      '<td style="text-align:center;">'+(profAvgUtil!==null?'<span style="font-size:10px;color:'+(profAvgUtil>=TIME_ACTIVE_PCT?'#276221':profAvgUtil>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A')+';font-weight:500;">'+profAvgUtil+'%</span>':'<span style="color:#CCC;font-size:9px;">—</span>')+'</td>'+
      '<td style="text-align:center;">'+avg+'</td>'+
      '<td><div style="display:flex;height:12px;border-radius:3px;overflow:hidden;width:80px;">'+
        (eW?'<div style="width:'+eW+'px;background:#276221;" title="Engaged"></div>':'')+
        (tW?'<div style="width:'+tW+'px;background:#0369A1;" title="Tracking Only"></div>':'')+
        (jW?'<div style="width:'+jW+'px;background:#F59E0B;" title="Jira Only"></div>':'')+
        (rW?'<div style="width:'+rW+'px;background:#3266ad;" title="Ramp-up"></div>':'')+
        (iW?'<div style="width:'+iW+'px;background:#E24B4A;" title="Inactive"></div>':'')+
      '</div></td>';
    tr.addEventListener('click',function(){
      var nx=tr.nextElementSibling;
      if(nx&&nx.classList.contains('drow')){nx.classList.toggle('open');return;}
      var det=document.createElement('tr');det.className='drow open';
      var td=document.createElement('td');td.colSpan=11;
      function sec(lbl,col,lst){
        if(!lst.length)return'';
        return'<div style="margin-bottom:10px;">'+
          '<div class="sec-lbl" style="color:'+col+';">'+lbl+' ('+lst.length+')</div>'+
          '<div class="emp-grid">'+lst.map(function(e){
            var aw=activeWks(e);
            var ans=avgNsUtil(e);
            var atp=avgTpUtil(e);
            var badge=badgeHtml(e.st);
            var nsCol=ans!==null?(ans>=TIME_ACTIVE_PCT?'#276221':ans>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A'):'#E8E8E8';
            var tpCol=atp!==null?(atp>=TIME_ACTIVE_PCT?'#276221':atp>=TIME_PARTIAL_PCT?'#BA7517':'#E24B4A'):'#E8E8E8';
            // Inline onclick runs in global scope, where the closure's e does not
            // exist — hand it an index into a global list instead.
            var ix=CARD_EMPS.push(e)-1;
            return'<div class="emp-card"'+(e.fl?' style="border-color:#E24B4A;"':'')+'>'+
              '<div style="display:flex;justify-content:space-between;align-items:center;">'+
                '<span class="emp-name emp-link" title="Click for health profile" onclick="showHealth(CARD_EMPS['+ix+'],event)">'+esc(e.name)+'</span>'+badge+
              '</div>'+
              (e.fl?'<span class="rflag" style="margin-left:0;margin-top:2px;">&#9873; review</span>':'')+
              '<div style="margin:5px 0 0;font-size:9px;color:#595959;">Last '+weeks.length+' weeks &middot; '+
                '<span style="color:#888;">'+e.total+' items &middot; active '+aw+'/'+weeks.length+' wks</span></div>'+
              evidenceGrid(e)+
              '<div style="margin:5px 0 2px;font-size:9px;color:#595959;">Time</div>'+
              utilBar2('NS',ans,nsCol,e.lastNs)+
              utilBar2('TP',atp,tpCol,e.lastTp)+
              (e.lastPto!==null&&e.lastPto>0?'<div style="font-size:9px;color:#0369A1;font-weight:500;margin-top:1px;">PTO: '+e.lastPto+'h</div>':'')+
              (e.hire?'<div style="font-size:9px;color:#888;margin-top:4px;">Hired '+e.hire.slice(0,7)+'</div>':'')+
            '</div>';
          }).join('')+'</div></div>';
      }
      td.innerHTML='<div class="d-inner">'+
        sec('Engaged (Jira &#10003; + Time &#10003;)','#276221',cl.filter(function(e){return e.st==='engaged'||e.st==='active';}))+
        sec('Tracking Only — time tracked, no Jira items (other work)','#0369A1',cl.filter(function(e){return e.st==='tracking';}))+
        sec('Jira Only — Jira items but time tracking gap','#92400E',cl.filter(function(e){return e.st==='jira-only'||e.st==='needs';}))+
        sec('Inactive — low on both signals','#A32D2D',cl.filter(function(e){return e.st==='inactive';}))+
        sec('Ramp-up (${rDays}-day window)','#185FA5',cl.filter(function(e){return e.st==='rampup';}))+
        (fls.length?'<div class="sec-note">&#9873; Review flags: tenured (≥'+RV_TENURE+' months) with ≤'+RV_MAX_WKS+' active Jira week(s) AND low time utilization where top contributor reached '+top+' total. Same role, different engagement — warrants a 1:1 conversation.</div>':'')+
      '</div>';
      det.appendChild(td);tr.after(det);
    });
    tb.appendChild(tr);
  });
}
function applyFilter(f,btn){
  curF=f;
  document.querySelectorAll('.filter-btn').forEach(function(b){b.classList.remove('on');});
  btn.classList.add('on');renderTable();
}
renderTable();
</script>
<div id="hp-panel" class="hp-panel">
  <span class="hp-close" onclick="closeHealth()">&#x2715;</span>
  <div id="hp-content"></div>
</div>
</body>
</html>`;
}

// ============================================================
// 🚀  GETTING STARTED
// ============================================================
// Prerequisites:
//   1. Run runJiraEpicTracker() first — this script reads its output.
//      The "Jira Raw" sheet must be populated with Week + Assignee columns.
//   2. The "Roster" sheet must exist with Name, Job Title, and Hire Date columns.
//      Job Title values must exactly match entries in CI_CONFIG.TARGET_PROFILES.
//
// Running this script:
//   3. Open Apps Script editor → select runContributionIntelligence → Run.
//   4. A "Team Segmentation" tab will be created (or overwritten).
//
// Configuration:
//   5. Adjust CI_CONFIG.TREND_WEEKS     → number of weeks to analyse (default 4).
//   6. Adjust CI_CONFIG.RAMPUP_DAYS     → ramp-up window in days (default 90).
//   7. Adjust CI_CONFIG.TARGET_PROFILES → must match your Roster job title values exactly.
//   8. Adjust threshold constants (ACTIVE_THRESHOLD etc.) to calibrate classification.
//
// Integration with main tracker:
//   9. Add a call to runContributionIntelligence() at the end of runJiraEpicTracker()
//      to auto-generate this tab every time the main report runs:
//
//      // Inside runJiraEpicTracker(), after the final SpreadsheetApp.flush():
//      Logger.log("📝 Writing 'Team Segmentation' tab...");
//      runContributionIntelligence();
// ============================================================