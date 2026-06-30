// ============================================================
// SCRIPT NAME: PS Weekly Contribution Report
// PURPOSE:     Consolidated weekly report for the Professional
//              Services team — RCR, SI, PTO, Kudos, Tracked
//              Time, Planned Time, and Goals Engagement across
//              a 5-week rolling window (W-2 → W0 → W+2).
// VERSION:     1.0.0
// ENVIRONMENT: Google Apps Script
// ============================================================

var CONFIG_PS = {
  ROSTER_SS_ID:      "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  GOALS_SS_ID:       "1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ",

  SHEET_ROSTER:      "Roster",
  SHEET_RCR:         "3. RCR",
  SHEET_SI:          "SI",
  SHEET_KUDOS:       "Kudos_Normalized",

  // PTO Planning Health — external accumulation spreadsheet
  PTO_ACCUM_SS_ID:            "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:            "Accumulation Cost",
  PTO_BALANCE_THRESHOLD:      100,   // hours — at or below = automatically Good
  PTO_PLANNING_HORIZON_MONTHS: 6,    // look-ahead window for a Usage planning signal
  PTO_TEAM_TARGET_PCT:        80,    // celebrate at this team-level score
  SHEET_TEMPO_TRACKED:   "Tempo Tracked Time",
  SHEET_PLANNED:         "Planned Time Tempo",
  // Project keys in the Planned/Tracked Time "Key" column that are NOT real projects
  // and must be excluded from project-context counts. "NETSUITE" = time-off synced
  // from NetSuite (already represented elsewhere in the report). Matched case-insensitively.
  PLANNED_NONPROJECT_KEYS: ["NETSUITE"],
  TRACKED_NONPROJECT_KEYS: ["NETSUITE"],
  SHEET_GOALS:       "RD",
  SHEET_PH:          "PH",

  PS_CLASS:          "Professional Services",
  PS_DEPT:           "Services",
  GOALS_MIN_COUNT:          8,     // minimum goals to be evaluated (quarter target is 10, 8 completed)
  GOALS_MIN_IN_PROGRESS_PCT: 0.50, // majority of goals must be "In Progress" (not Planned/Completed)
  GOALS_ACTIVE_COMMENT_COUNT: 6,   // goals that must have a self-comment within the evaluated week

  WEEKS_PAST:        5,
  WEEKS_FUTURE:      2,
  TRACKED_HIST_WEEKS: 24,  // extra completed weeks before W-2 included in trackedHistory (~6 months)

  // Ramp-up exclusion: employees hired within this many months are excluded from
  // RCR, SI, Goals, and Kudos team metrics (but still included in Tracked/Planned/PTO).
  // A "Ramp-Up" column in the Roster can override: "No" graduates early, "Yes" forces exclusion.
  RAMP_UP_MONTHS:    3,
  RAMP_UP_FLAG_COL:  "Ramp-Up",

  RCR_CRITICAL:      1.0,
  RCR_WATCH:         1.5,
  RCR_HEALTHY:       2.5,

  DEFAULT_TARGET_WEEKLY_HRS: 36,
  GOAL_ID_MAP: [
    { pattern: /netsuite.{0,20}timesheet/i, id: "G-NETSUITE-TIMESHEET" },
    { pattern: /tempo.{0,20}worklog/i,      id: "G-TEMPO-WORKLOGS"     },
    { pattern: /tempo.{0,10}plan/i,         id: "G-TEMPO-PLANS"        },
  ],
  OPERATIONAL_GOALS: ["G-TEMPO-WORKLOGS", "G-TEMPO-PLANS"],

  DAYS_PER_MONTH_AVG:    30.44,  // average days/month (365.25/12) used in horizon and ramp-up calculations
  SCORE_PLANNED_CAP_HRS: 40,     // hours cap for planned-time normalisation in scoring
  SCORE_TRACKED_RATIO:   0.9,    // tracked/planned ratio threshold for full execution credit
  SI_MAX_SCORE:          5,      // SI rating scale maximum (1–5) — used to normalise to 0–1
  TOP_PERFORMERS_MAX:    10,     // number of entries in the LEADING BEHAVIOURS leaderboard
  DEBUG:                 false,  // set true to enable verbose Logger output in development
  SI_COL_OVERRIDE:       null,   // Set to e.g. "Small Improvements Manager Rating FY27Q1" only
                                 // if the auto-generated name doesn't match the sheet header.
};

// ============================================================
// UTILITIES — debug logger and external SS ID resolver
// ============================================================

// Debug-guarded logger — only emits when CONFIG_PS.DEBUG is true.
// Error (❌) and warning (⚠️) paths call Logger.log directly so they
// remain visible regardless of the DEBUG flag.
function log_(msg) { if (CONFIG_PS.DEBUG) Logger.log(msg); }

// Reads external spreadsheet IDs from PropertiesService, falling back to
// the CONFIG_PS values so existing deployments work without any setup step.
// To override: PropertiesService.getScriptProperties()
//   .setProperties({ ROSTER_SS_ID: '…', GOALS_SS_ID: '…', PTO_ACCUM_SS_ID: '…' });
function getExternalSSIds_() {
  const p = PropertiesService.getScriptProperties();
  return {
    roster:   p.getProperty('ROSTER_SS_ID')    || CONFIG_PS.ROSTER_SS_ID,
    goals:    p.getProperty('GOALS_SS_ID')     || CONFIG_PS.GOALS_SS_ID,
    ptoAccum: p.getProperty('PTO_ACCUM_SS_ID') || CONFIG_PS.PTO_ACCUM_SS_ID,
  };
}

// ============================================================
// SETTINGS
// ============================================================

const SETTINGS_SHEET_NAME_ = "PS Settings";
const DEFAULT_WEIGHTS_ = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };

// ── Report cache versioning ────────────────────────────────────────────────
// getPSReportData caches one entry per scope (ps_v<VER>_admin and ps_v<VER>_<email>).
// CacheService can't enumerate keys, so bumping a single version number stored in
// Script Properties strands ALL prior-version entries at once (they expire on TTL).
// This is how a weight/matrix save takes effect immediately for every viewer and
// manager, not just the admin who saved.
function reportCacheVer_() {
  try {
    const v = parseInt(PropertiesService.getScriptProperties().getProperty("PS_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch(e) { return 1; }
}

function bustReportCache_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const next  = (parseInt(props.getProperty("PS_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("PS_CACHE_VER", String(next));
    return next;
  } catch(e) {
    Logger.log(`⚠️ bustReportCache_: ${e.message}`);
    return null;
  }
}

function readWeightSettings_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SETTINGS_SHEET_NAME_);
    if (!sh) return Object.assign({}, DEFAULT_WEIGHTS_);
    const data = sh.getDataRange().getValues();
    const weights = Object.assign({}, DEFAULT_WEIGHTS_);
    data.forEach(row => {
      const key = String(row[0] || "").trim().toLowerCase();
      const val = parseFloat(row[1]);
      if (key in weights && !isNaN(val) && val >= 0) weights[key] = val;
    });
    return weights;
  } catch(e) {
    Logger.log(`⚠️ readWeightSettings_: ${e.message}`);
    return Object.assign({}, DEFAULT_WEIGHTS_);
  }
}

// Exported (no underscore) — callable from google.script.run in the HTML.
// Writes the weights object { goals, tracked, planned, rcr, kudos } to the
// PS Settings sheet, creating the sheet if it does not already exist.
function saveWeightSettings(weightsObj) {
  try {
    // Server-side authorization — hiding the UI button is not enough; this
    // function is callable directly via google.script.run by anyone with the link.
    const access = checkDashboardAccess();
    if (!access.allowed || access.role !== "admin") return { ok: false, error: "Admin access required" };

    const valid = ["goals","tracked","planned","rcr","kudos","si","pto"];
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SETTINGS_SHEET_NAME_);
    if (!sh) sh = ss.insertSheet(SETTINGS_SHEET_NAME_);
    sh.clearContents();
    const rows = valid.map(k => [k, (weightsObj[k] !== undefined ? weightsObj[k] : DEFAULT_WEIGHTS_[k])]);
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    const savedAt = new Date().toISOString();
    sh.getRange(rows.length + 2, 1).setValue("lastSaved");
    sh.getRange(rows.length + 2, 2).setValue(savedAt);
    SpreadsheetApp.flush();
    bustReportCache_(); // base weights are the company default — invalidate every cached scope
    Logger.log(`Weights saved: ${JSON.stringify(weightsObj)}`);
    return { ok: true, savedAt: savedAt };
  } catch(e) {
    Logger.log(`❌ saveWeightSettings: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// SCORING MATRIX — Family × Level weights + Job Catalog
// Spec: docs/superpowers/specs/2026-06-10-score-weight-settings-by-family-level-design.md
//
// Single source of truth for the company default = the flat base weights
// (the "Scoring Weights" Settings section → readWeightSettings_()). The matrix
// only stores per-family OVERRIDES; there is no separate editable DEFAULT block.
//
// Resolution order per employee:
//   Job Title → Job Catalog → (family, levelKey) → matrix cell
//   (blank metric in a family cell inherits the flat base weight)
//   → base weights (readWeightSettings_) → DEFAULT_WEIGHTS_.
// Any miss falls back to base, so behaviour never regresses below the
// single-global-weights model.
// ============================================================

const SCORING_MATRIX_SHEET_ = "PS Scoring Matrix";
const JOB_CATALOG_SHEET_    = "Job Catalog";
const WEIGHT_METRICS_       = ["goals", "tracked", "planned", "rcr", "kudos", "si", "pto"];
const LEVEL_COLS_ = ["I1","I2","I3","I4","I5","I6","I7","I8","M4","M5","M6","M7","M8","M9","M10"];

// Services Team catch-all: the roster is already filtered to Department = "Services",
// so any roster title missing from the Job Catalog is still a Services-team member.
// Those people score with the SERVICES/ALL matrix block (one weight set, all levels)
// instead of silently falling back to the company default.
const SERVICES_TEAM_CODE_ = "SERVICES";
const SERVICES_TEAM_KEY_  = "ALL";

// Active job families (JF006/JF010/JF011/JF012 are archived and never seeded).
// `role` is the single display role-group name; null = family has split groups
// resolved by roleGroupFor_().
const ACTIVE_FAMILIES_ = [
  { code: "JF001", name: "Marketing",                     role: "Marketing" },
  { code: "JF003", name: "Analytics",                     role: "Analytics" },
  { code: "JF004", name: "Sales and Success",             role: "Account Management" },
  { code: "JF005", name: "Partner Success",               role: "Partner Success" },
  { code: "JF007", name: "Managed Services & Support",    role: null },
  { code: "JF008", name: "Training & Customer Education", role: "Training & Customer Education" },
  { code: "JF009", name: "Service Delivery",              role: null },
  { code: "JF013", name: "Finance",                       role: "Finance" },
  { code: "JF014", name: "Legal & Compliance",            role: "Legal & Compliance" },
  { code: "JF015", name: "Operations",                    role: "Operations & Strategy" },
  { code: "JF016", name: "People",                        role: null },
  { code: "JF017", name: "Information Technology",        role: "IT Operations" },
  { code: "JF018", name: "Solution Architecture",         role: "Solution Architecture" },
];

// Company role catalog seed — "code|Job Title", active families only.
// Source: company job profile export (2026.W24). 15.M6.2's title is cleaned of
// its duplicated code prefix so it matches roster Job Title strings.
const COMPANY_ROLES_ = [
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

// Parses "09.I4.1" → { family: "JF009", track: "I", level: 4, levelKey: "I4" }; null if malformed.
function parseJobCode_(code) {
  const m = /^(\d+)\.([IM])(\d+)\.(\d+)$/.exec(String(code || "").trim());
  if (!m) return null;
  const family = "JF" + ("00" + m[1]).slice(-3);
  return { family, track: m[2], level: +m[3], levelKey: m[2] + m[3] };
}

// Display role group for a title within a family (spec §5.1). Groups are
// display-only — they never affect weight selection.
function roleGroupFor_(family, title) {
  if (family === "JF009") {
    return /technical consulting|solution consulting/i.test(title) ? "Technical Consulting" : "Service Delivery";
  }
  if (family === "JF016") {
    if (/talent acquisition|talent program/i.test(title)) return "Talent Acquisition";
    if (/administration/i.test(title)) return "Administration";
    return "People";
  }
  if (family === "JF007") {
    if (/support/i.test(title))  return "Customer Support";
    if (/delivery/i.test(title)) return "Delivery";
    return "Customer Support"; // default bucket (e.g. "Intern, Managed Services")
  }
  const fam = ACTIVE_FAMILIES_.find(f => f.code === family);
  return fam ? (fam.role || fam.name) : family;
}

// Reads the Job Catalog sheet → Map<normTitle, {family, track, level, levelKey, group, code, title}>.
// Missing/empty sheet → empty Map (everyone falls back to default weights).
function readJobCatalog_() {
  const out = new Map();
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(JOB_CATALOG_SHEET_);
    if (!sh || sh.getLastRow() < 2) return out;
    const data = sh.getDataRange().getValues();
    const hdrs = data[0].map(h => String(h).trim().toLowerCase());
    const iTitle = hdrs.indexOf("job title"), iFam = hdrs.indexOf("family"),
          iTrack = hdrs.indexOf("track"),     iLvl = hdrs.indexOf("level"),
          iGroup = hdrs.indexOf("role group"), iCode = hdrs.indexOf("code");
    if (iTitle === -1 || iFam === -1 || iTrack === -1 || iLvl === -1) {
      Logger.log(`⚠️ readJobCatalog_: required columns missing (have: ${hdrs.join(", ")})`);
      return out;
    }
    data.slice(1).forEach(r => {
      const title  = String(r[iTitle] || "").trim();
      const family = String(r[iFam]   || "").trim().toUpperCase();
      const track  = String(r[iTrack] || "").trim().toUpperCase();
      const level  = parseInt(r[iLvl], 10);
      if (!title || !family || (track !== "I" && track !== "M") || isNaN(level)) return;
      out.set(normPS_(title), {
        title, family, track, level, levelKey: track + level,
        group: iGroup !== -1 ? String(r[iGroup] || "").trim() : "",
        code:  iCode  !== -1 ? String(r[iCode]  || "").trim() : "",
      });
    });
    log_(`Job Catalog: ${out.size} titles loaded.`);
  } catch(e) { Logger.log(`⚠️ readJobCatalog_: ${e.message}`); }
  return out;
}

// Reads the scoring matrix sheet → { [family|"DEFAULT"]: { [levelKey]: { metric: weight } } }.
// Blank cells are omitted (→ inherit). Missing sheet → {}.
function readScoringMatrix_() {
  const out = {};
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh || sh.getLastRow() < 2) return out;
    const data = sh.getDataRange().getValues();
    const hdrs = data[0].map(h => String(h).trim());
    const iFam = hdrs.findIndex(h => h.toLowerCase() === "family");
    const iMet = hdrs.findIndex(h => h.toLowerCase() === "metric");
    if (iFam === -1 || iMet === -1) return out;
    const levelCols = [];
    hdrs.forEach((h, i) => { if (/^([IM]\d+|ALL)$/i.test(h)) levelCols.push({ idx: i, key: h.toUpperCase() }); });
    data.slice(1).forEach(r => {
      const fam = String(r[iFam] || "").trim().toUpperCase();
      const met = String(r[iMet] || "").trim().toLowerCase();
      if (!fam || WEIGHT_METRICS_.indexOf(met) === -1) return;
      levelCols.forEach(c => {
        const raw = r[c.idx];
        if (raw === "" || raw === null || raw === undefined) return; // blank → inherit
        const v = parseFloat(raw);
        if (isNaN(v) || v < 0) return;
        if (!out[fam])        out[fam] = {};
        if (!out[fam][c.key]) out[fam][c.key] = {};
        out[fam][c.key][met] = v;
      });
    });
  } catch(e) { Logger.log(`⚠️ readScoringMatrix_: ${e.message}`); }
  return out;
}

// Fills any metric missing from `cell` with the value from `base`.
function fillWeights_(cell, base) {
  const o = {};
  WEIGHT_METRICS_.forEach(k => {
    o[k] = (cell[k] !== undefined ? cell[k] : (base[k] !== undefined ? base[k] : 0));
  });
  return o;
}

// Resolves one employee's scoring weights (spec §6.1). Pure given its inputs.
// `base` = flat company base weights (readWeightSettings_ result).
// `audit` (optional array) collects { name, jobTitle, reason } for misses.
function weightsForEmployee_(emp, matrix, catalog, base, audit) {
  const W = base || DEFAULT_WEIGHTS_;
  const hit = catalog.get(normPS_(emp.jobTitle || ""));
  if (!hit) {
    // Only audit when a catalog exists — pre-seed deployments shouldn't flood the log.
    if (audit && catalog.size > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", reason: "unmapped-title" });
    }
    // Services Team catch-all: roster is Services-dept only, so uncatalogued titles
    // score with the SERVICES/ALL block when it carries any explicit weight.
    const svc = (matrix[SERVICES_TEAM_CODE_] || {})[SERVICES_TEAM_KEY_];
    return svc ? fillWeights_(svc, W) : W;
  }
  // Company default = flat base weights. A family may override per level; blank
  // metrics within a family cell inherit the base weight for that metric.
  const cell = (matrix[hit.family] || {})[hit.levelKey] || null;
  if (!cell) {
    if (audit && Object.keys(matrix).length > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", family: hit.family,
        levelKey: hit.levelKey, reason: matrix[hit.family] ? "level-missing" : "family-missing" });
    }
    return W;
  }
  return fillWeights_(cell, W);
}

// Seeds the Job Catalog sheet from COMPANY_ROLES_ (idempotent: clear + rewrite).
function seedJobCatalog_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(JOB_CATALOG_SHEET_);
  if (!sh) sh = ss.insertSheet(JOB_CATALOG_SHEET_);
  sh.clearContents();
  const famName = {};
  ACTIVE_FAMILIES_.forEach(f => { famName[f.code] = f.name; });
  const rows = [["Job Title", "Code", "Family", "Family Name", "Track", "Level", "Role Group"]];
  COMPANY_ROLES_.forEach(s => {
    const sep = s.indexOf("|");
    const code = s.slice(0, sep), title = s.slice(sep + 1);
    const p = parseJobCode_(code);
    if (!p || !famName[p.family]) return; // skip malformed or archived families
    rows.push([title, code, p.family, famName[p.family], p.track, p.level, roleGroupFor_(p.family, title)]);
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  SpreadsheetApp.flush();
  Logger.log(`Job Catalog seeded: ${rows.length - 1} roles.`);
  return rows.length - 1;
}

// Seeds the scoring matrix with the per-family row structure but BLANK cells.
// Blank = inherit the company base weight, so a freshly-seeded deployment scores
// exactly as the flat-weights model (day-one parity) and every family correctly
// reads as "inheriting default" until an admin enters an explicit override.
function seedScoringMatrix_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
  if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
  sh.clearContents();
  const cols   = LEVEL_COLS_.concat([SERVICES_TEAM_KEY_]);
  const header = ["Family", "Metric"].concat(cols);
  const rows = [header];
  ACTIVE_FAMILIES_.forEach(f => {
    WEIGHT_METRICS_.forEach(met => {
      rows.push([f.code, met].concat(cols.map(() => ""))); // blank → inherit base
    });
  });
  // Services Team catch-all block — single ALL column, blank = inherit base.
  WEIGHT_METRICS_.forEach(met => {
    rows.push([SERVICES_TEAM_CODE_, met].concat(cols.map(() => "")));
  });
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  const savedAt = new Date().toISOString();
  sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
  SpreadsheetApp.flush();
  Logger.log(`Scoring matrix seeded: ${ACTIVE_FAMILIES_.length} families + Services Team (blank → inherit base).`);
  return { families: ACTIVE_FAMILIES_.length, savedAt };
}

// Exported — full config for the Settings-tab matrix editor (Admin only).
// Seeds both sheets on first open so the feature bootstraps itself.
function getScoringConfig() {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed || access.role !== "admin") return { ok: false, denied: true };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let seeded = false;
    if (!ss.getSheetByName(JOB_CATALOG_SHEET_))    { seedJobCatalog_();    seeded = true; }
    if (!ss.getSheetByName(SCORING_MATRIX_SHEET_)) { seedScoringMatrix_(); seeded = true; }

    const catalog = readJobCatalog_();
    const matrix  = readScoringMatrix_();
    delete matrix.DEFAULT; // company default now lives only in the flat base weights

    // Roles grouped per family/level for the editor's read-only reference rows.
    const rolesByFamily = {};
    catalog.forEach(e => {
      if (!rolesByFamily[e.family]) rolesByFamily[e.family] = { levels: {} };
      const fam = rolesByFamily[e.family];
      if (!fam.levels[e.levelKey]) fam.levels[e.levelKey] = [];
      fam.levels[e.levelKey].push({ title: e.title, group: e.group, code: e.code });
    });

    // Roster titles with no catalog entry → these people use default weights.
    const unmapped = {};
    readPSRoster_().forEach(p => {
      if (p.isCrewMember) return;
      if (!catalog.has(normPS_(p.jobTitle))) {
        unmapped[p.jobTitle] = (unmapped[p.jobTitle] || 0) + 1;
      }
    });

    return {
      ok: true, seeded, matrix, rolesByFamily,
      families:    ACTIVE_FAMILIES_.map(f => ({ code: f.code, name: f.name })),
      levelCols:   LEVEL_COLS_,
      metrics:     WEIGHT_METRICS_,
      baseWeights: readWeightSettings_(),
      unmappedTitles: Object.keys(unmapped).map(t => ({ jobTitle: t, count: unmapped[t] })),
    };
  } catch(e) {
    Logger.log(`❌ getScoringConfig: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Exported — writes the full matrix back from the editor and busts the report cache.
function saveScoringMatrix(payload) {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed || access.role !== "admin") return { ok: false, error: "Admin access required" };
    const matrix = payload && payload.matrix;
    if (!matrix || typeof matrix !== "object") return { ok: false, error: "Invalid payload" };

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
    sh.clearContents();

    // No DEFAULT block — base is the company default. SERVICES is the catch-all pseudo-family.
    const validFams = ACTIVE_FAMILIES_.map(f => f.code).concat([SERVICES_TEAM_CODE_]);
    const cols      = LEVEL_COLS_.concat([SERVICES_TEAM_KEY_]);
    const header = ["Family", "Metric"].concat(cols);
    const rows = [header];
    validFams.forEach(fam => {
      const block = matrix[fam];
      if (!block) return;
      WEIGHT_METRICS_.forEach(met => {
        const row = [fam, met];
        cols.forEach(lk => {
          const cell = block[lk];
          const raw  = cell ? cell[met] : undefined;
          const v    = (raw === undefined || raw === null || raw === "") ? NaN : parseFloat(raw);
          row.push(isNaN(v) ? "" : Math.max(0, Math.min(100, v)));
        });
        rows.push(row);
      });
    });
    sh.getRange(1, 1, rows.length, header.length).setValues(rows);
    const savedAt = new Date().toISOString();
    sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
    SpreadsheetApp.flush();
    bustReportCache_(); // invalidate every cached scope (admin + manager) so scores refresh now
    Logger.log(`Scoring matrix saved by ${access.email}: ${rows.length - 1} data rows`);
    return { ok: true, savedAt };
  } catch(e) {
    Logger.log(`❌ saveScoringMatrix: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Manual test harness for the resolver (run from the GAS editor; logs PASS/FAIL).
function _test_weightsResolver() {
  const base = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };
  const catalog = new Map([
    [normPS_("Senior Consultant I, Technical Consulting"), { family: "JF009", track: "I", level: 4, levelKey: "I4" }],
    [normPS_("Associate, Solution Architecture"),          { family: "JF018", track: "I", level: 2, levelKey: "I2" }],
  ]);
  const matrix = {
    JF009:   { I4: { goals: 40, tracked: 20 } }, // partial cell — planned/rcr/… inherit base
  };
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };

  // 1. Full hit with partial cell: explicit values win, blank metrics inherit the flat base
  check("hit+inherit", weightsForEmployee_({ name: "A", jobTitle: "Senior Consultant I,  TECHNICAL consulting" }, matrix, catalog, base),
    { goals: 40, tracked: 20, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });
  // 2. Family missing from matrix → base (no separate DEFAULT block)
  check("family-missing", weightsForEmployee_({ name: "B", jobTitle: "Associate, Solution Architecture" }, matrix, catalog, base), base);
  // 3. Unmapped title, no SERVICES block → base
  check("unmapped", weightsForEmployee_({ name: "C", jobTitle: "Wizard, Hogwarts" }, matrix, catalog, base), base);
  // 3b. Unmapped title + SERVICES catch-all → services weights, blanks inherit base
  const matrixSvc = { JF009: matrix.JF009, SERVICES: { ALL: { goals: 50, kudos: 10 } } };
  check("unmapped-services-fallback",
    weightsForEmployee_({ name: "C2", jobTitle: "Wizard, Hogwarts" }, matrixSvc, catalog, base),
    { goals: 50, tracked: 30, planned: 20, rcr: 15, kudos: 10, si: 0, pto: 0 });
  // 3c. Mapped title is NOT affected by the SERVICES block
  check("mapped-ignores-services",
    weightsForEmployee_({ name: "A2", jobTitle: "Senior Consultant I, Technical Consulting" }, matrixSvc, catalog, base),
    { goals: 40, tracked: 20, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });
  // 4. Empty catalog → base, no audit noise
  const audit = [];
  check("empty-catalog", weightsForEmployee_({ name: "D", jobTitle: "Anything" }, {}, new Map(), base, audit), base);
  check("empty-catalog-no-audit", audit.length, 0);
  // 5. roleGroupFor_ edges
  check("jf007-default-bucket", roleGroupFor_("JF007", "Intern, Managed Services"), "Customer Support");
  check("jf007-delivery",       roleGroupFor_("JF007", "Senior Consultant I, Delivery"), "Delivery");
  check("jf009-tc",             roleGroupFor_("JF009", "Principal, Solution Consulting"), "Technical Consulting");
  check("jf016-people",         roleGroupFor_("JF016", "Senior Manager, Total Rewards and HR Operations"), "People");
  check("parse-code",           parseJobCode_("13.M10.10"), { family: "JF013", track: "M", level: 10, levelKey: "M10" });

  Logger.log(results.join("\n"));
  return results;
}

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  const access = checkDashboardAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle("PS Dashboard — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("PS Dashboard")
    .setTitle("PS Weekly Contribution Report")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// WEEK WINDOW
// ============================================================

function isoWeekNum_PS_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_PS_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_PS_(year) {
  return isoWeekNum_PS_(new Date(Date.UTC(year, 11, 28)));
}

function mondayOfIsoWeek_PS_(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow  = jan4.getUTCDay() || 7;
  const w1mon = new Date(jan4);
  w1mon.setUTCDate(jan4.getUTCDate() - dow + 1);
  const mon = new Date(w1mon);
  mon.setUTCDate(w1mon.getUTCDate() + (week - 1) * 7);
  return mon;
}

// Builds a single week-entry object from a year, week number, and offset from today's week.
// off < 0 → past, off === 0 → current, off > 0 → future.
function makeWeekEntry_PS_(y, w, off) {
  const mon = mondayOfIsoWeek_PS_(y, w);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = { month: "short", day: "numeric", timeZone: "UTC" };
  return {
    label:         `${y}.W${w}`,
    isoWeek:       w,
    year:          y,
    monday:        mon.toISOString().substring(0, 10),
    sunday:        sun.toISOString().substring(0, 10),
    isCurrentWeek: off === 0,
    isFuture:      off > 0,
    isPast:        off < 0,
    dateRange:     `${mon.toLocaleDateString("en-US", fmt)} – ${sun.toLocaleDateString("en-US", fmt)}`,
  };
}

function buildWeekWindow_PS_() {
  const today = new Date();
  const curW  = isoWeekNum_PS_(today);
  const curY  = isoWeekYear_PS_(today);
  const weeks = [];
  for (let off = -CONFIG_PS.WEEKS_PAST; off <= CONFIG_PS.WEEKS_FUTURE; off++) {
    let w = curW + off, y = curY;
    if (w <= 0)                      { y--; w = weeksInYear_PS_(y) + w; }
    else if (w > weeksInYear_PS_(y)) { w -= weeksInYear_PS_(y); y++; }
    weeks.push(makeWeekEntry_PS_(y, w, off));
  }
  return weeks;
}

// Builds extra completed weeks before the main window (for historical tracked-time chart).
// Returns weeks oldest-first, covering offsets -(WEEKS_PAST + extraPast) to -(WEEKS_PAST+1).
function buildHistWeeks_(extraPast) {
  const today = new Date();
  const curW  = isoWeekNum_PS_(today);
  const curY  = isoWeekYear_PS_(today);
  const weeks = [];
  for (let off = -(CONFIG_PS.WEEKS_PAST + extraPast); off <= -(CONFIG_PS.WEEKS_PAST + 1); off++) {
    let w = curW + off, y = curY;
    if (w <= 0)                      { y--; w = weeksInYear_PS_(y) + w; }
    else if (w > weeksInYear_PS_(y)) { w -= weeksInYear_PS_(y); y++; }
    weeks.push(makeWeekEntry_PS_(y, w, off));
  }
  return weeks;
}

// Returns all Q4 weeks from Q4_BASE_ISO_WEEK/Q4_BASE_YEAR through the current week,
// oldest-first, no future weeks. Used to expand per-employee data beyond the rolling window.
// Returns all weeks from the current quarter's start through today (oldest-first, no future).
// Pass ctx from computeFiscalContext_() to drive the start week dynamically.
function buildCurrentQWeeks_PS_(ctx) {
  var today    = new Date();
  var curW     = isoWeekNum_PS_(today);
  var curY     = isoWeekYear_PS_(today);
  var todayMon = mondayOfIsoWeek_PS_(curY, curW);
  var weeks    = [];
  var w = ctx.qStartIsoWeek, y = ctx.qStartIsoYear;
  while (y < curY || (y === curY && w <= curW)) {
    var entryMon = mondayOfIsoWeek_PS_(y, w);
    var off      = Math.round((entryMon - todayMon) / 86400000) / 7;
    weeks.push(makeWeekEntry_PS_(y, w, off));
    w++;
    if (w > weeksInYear_PS_(y)) { w = 1; y++; }
  }
  return weeks;
}

// One-release alias — remove after all callers have been updated.
function buildQ4Weeks_PS_() { return buildCurrentQWeeks_PS_(computeFiscalContext_()); }

// Derives all fiscal-year and quarter constants from a reference date (defaults to today).
// Replaces hardcoded CONFIG_PS constants: GOALS_QUARTER, Q4_BASE_ISO_WEEK, Q4_BASE_YEAR,
// SI_QUARTER_COL, MONTH_COLS. Call once per report run; pass the result as `ctx`.
function computeFiscalContext_(referenceDate) {
  var today = (referenceDate instanceof Date) ? referenceDate : new Date();
  var m  = today.getMonth() + 1; // 1–12
  var yr = today.getFullYear();

  // FY starts July 1. FY26 = Jul 2025 – Jun 2026.
  var fyStartCalYear = (m >= 7) ? yr : yr - 1;
  var fyNum          = fyStartCalYear + 1;
  var fyLabel        = "FY" + String(fyNum).slice(-2);  // "FY27"

  // Quarter: fixed 3-month windows
  var qNum, qStartM, qStartY, qEndM, qEndY;
  if      (m >= 7  && m <= 9)  { qNum = 1; qStartM = 7;  qStartY = fyStartCalYear;     qEndM = 9;  qEndY = fyStartCalYear;     }
  else if (m >= 10 && m <= 12) { qNum = 2; qStartM = 10; qStartY = fyStartCalYear;     qEndM = 12; qEndY = fyStartCalYear;     }
  else if (m >= 1  && m <= 3)  { qNum = 3; qStartM = 1;  qStartY = fyStartCalYear + 1; qEndM = 3;  qEndY = fyStartCalYear + 1; }
  else                         { qNum = 4; qStartM = 4;  qStartY = fyStartCalYear + 1; qEndM = 6;  qEndY = fyStartCalYear + 1; }

  var qLabel       = "Q" + qNum;
  var goalsQuarter = fyLabel + qLabel;                                     // "FY27Q1"
  var qStartDate   = new Date(qStartY, qStartM - 1, 1);
  var qEndDate     = new Date(qEndY, qEndM, 0);                            // last day of last month
  var dayOfQtr     = Math.floor((today - qStartDate) / 86400000);
  var inGracePeriod    = dayOfQtr < 14;                                    // days 0–13
  var inGoalWritingRamp = dayOfQtr < 28;                                   // days 0–27

  var qStartIsoWeek    = isoWeekNum_PS_(qStartDate);
  var qStartIsoYear    = isoWeekYear_PS_(qStartDate);
  var qEndIsoWeek      = isoWeekNum_PS_(qEndDate);
  var qEndIsoYear      = isoWeekYear_PS_(qEndDate);
  // Constructor form avoids millisecond DST ambiguity across timezone boundaries
  var graceEndDate     = new Date(qEndDate.getFullYear(), qEndDate.getMonth(), qEndDate.getDate() + 14);
  var graceEndIsoWeek  = isoWeekNum_PS_(graceEndDate);
  var graceEndIsoYear  = isoWeekYear_PS_(graceEndDate);

  // Previous quarter (for grace period dual-load in readGoalsEngagement_)
  var pqNum, pqStartM, pqStartY, prevFyLabel;
  if      (qNum === 1) { pqNum = 4; pqStartM = 4;  pqStartY = fyStartCalYear;     prevFyLabel = "FY" + String(fyNum - 1).slice(-2); }
  else if (qNum === 2) { pqNum = 1; pqStartM = 7;  pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else if (qNum === 3) { pqNum = 2; pqStartM = 10; pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else                 { pqNum = 3; pqStartM = 1;  pqStartY = fyStartCalYear + 1; prevFyLabel = fyLabel; }

  var prevGoalsQuarter  = prevFyLabel + "Q" + pqNum;                       // "FY26Q4"
  var prevQStartDate    = new Date(pqStartY, pqStartM - 1, 1);
  var prevQStartIsoWeek = isoWeekNum_PS_(prevQStartDate);
  var prevQStartIsoYear = isoWeekYear_PS_(prevQStartDate);

  // SI column: always points to last completed quarter (one behind current)
  var siQuarterCol = CONFIG_PS.SI_COL_OVERRIDE ||
    ("Small Improvements Manager Rating " + prevGoalsQuarter);

  // MONTH_COLS: Jul–Jun labels for this FY (e.g. "Jul 26", "Jan 27")
  var ABBREVS  = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];
  var monthCols = ABBREVS.map(function(a, i) {
    var y = (i < 6) ? fyStartCalYear : fyStartCalYear + 1;
    return a + " " + String(y).slice(-2);
  });

  return {
    fyLabel: fyLabel, qLabel: qLabel,
    goalsQuarter: goalsQuarter, siQuarterCol: siQuarterCol, monthCols: monthCols,
    qStartIsoWeek: qStartIsoWeek, qStartIsoYear: qStartIsoYear,
    qEndIsoWeek: qEndIsoWeek, qEndIsoYear: qEndIsoYear,
    graceEndIsoWeek: graceEndIsoWeek, graceEndIsoYear: graceEndIsoYear,
    inGracePeriod: inGracePeriod, inGoalWritingRamp: inGoalWritingRamp,
    prevGoalsQuarter: prevGoalsQuarter,
    prevQStartIsoWeek: prevQStartIsoWeek, prevQStartIsoYear: prevQStartIsoYear,
  };
}

function _test_computeFiscalContext() {
  var cases = [
    { date: "2026-06-30", desc: "Last day FY26Q4 — no grace, no ramp" },
    { date: "2026-07-01", desc: "FY27Q1 day 0 — grace + ramp active" },
    { date: "2026-07-07", desc: "FY27Q1 day 6 — grace + ramp active" },
    { date: "2026-07-14", desc: "FY27Q1 day 13 — last grace day" },
    { date: "2026-07-15", desc: "FY27Q1 day 14 — grace over, ramp active" },
    { date: "2026-07-28", desc: "FY27Q1 day 27 — last ramp day" },
    { date: "2026-07-29", desc: "FY27Q1 day 28 — both flags false" },
  ];
  cases.forEach(function(c) {
    var ctx = computeFiscalContext_(new Date(c.date));
    Logger.log(c.desc + " (" + c.date + ")");
    Logger.log("  fy=" + ctx.fyLabel + " q=" + ctx.qLabel +
               " goalsQ=" + ctx.goalsQuarter + " prevQ=" + ctx.prevGoalsQuarter);
    Logger.log("  siCol=" + ctx.siQuarterCol);
    Logger.log("  monthCols=[" + ctx.monthCols.join(", ") + "]");
    Logger.log("  qStart=W" + ctx.qStartIsoWeek + "/" + ctx.qStartIsoYear +
               " qEnd=W" + ctx.qEndIsoWeek + " graceEnd=W" + ctx.graceEndIsoWeek);
    Logger.log("  inGrace=" + ctx.inGracePeriod + " inRamp=" + ctx.inGoalWritingRamp);
  });
}

// ============================================================
// HELPERS
// ============================================================

function normPS_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function parseDate_PS_(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    // Extract UTC date parts then create local midnight — avoids day-shift in non-UTC timezones
    const u = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (isNaN(u.getTime())) return null;
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
  }
  const s = String(val).trim();
  // ISO date "YYYY-MM-DD": new Date(s) parses as UTC midnight, shifting the calendar day
  // in negative-UTC timezones — create local midnight explicitly to preserve the date.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  // M/D/YYYY or MM/DD/YYYY (US format used by Google Sheets text dates)
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return new Date(parseInt(mdy[3]), parseInt(mdy[1]) - 1, parseInt(mdy[2]));
  // dd-MMM-yy or dd-MMM-yyyy (Tempo Transposed format: "12-May-26")
  const dmy = s.match(/^(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2,4})$/i);
  if (dmy) {
    const MON = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
    let yr = parseInt(dmy[3]); if (yr < 100) yr += 2000;
    return new Date(yr, MON[dmy[2].toLowerCase()], parseInt(dmy[1]), 12, 0, 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function findCol_PS_(headersLC, kw, exact) {
  const kwLC = kw.toLowerCase();
  if (exact) return headersLC.findIndex(h => h === kwLC);
  return headersLC.findIndex(h => h.includes(kwLC));
}

function loadSheet_PS_(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { headers: (data[0] || []).map(h => String(h).trim()), rows: [] };
  return { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
}

function weekToKey_PS_(label, defaultYear) {
  const s = String(label || "").trim();
  const full  = s.match(/^(\d{4})\.?W(\d+)$/i);
  if (full)  return `${full[1]}.W${parseInt(full[2])}`;
  const short = s.match(/^W(\d+)$/i);
  if (short) return `${defaultYear || isoWeekYear_PS_(new Date())}.W${parseInt(short[1])}`;
  return null;
}

// Best-effort parse of a week-column header cell into a Date, or null.
// Handles a real Date cell, a date range ("Mar 30 - Apr 05 2026"), and single
// date strings ("2026-06-08", "04/12/2026"). For a range it uses the LAST date so
// the trailing year applies correctly, even across a year boundary
// (e.g. "Dec 29 - Jan 04 2026" → Jan 4 2026 → ISO week 1 of 2026).
function cellToDate_PS_(cell) {
  if (cell instanceof Date) return isNaN(cell) ? null : cell;
  const s = String(cell || "").trim();
  if (!s) return null;
  const yearM = s.match(/\b(20\d{2})\b/);
  const md    = [...s.matchAll(/([A-Za-z]{3,9})\s+(\d{1,2})\b/g)];
  if (md.length && yearM) {
    const last = md[md.length - 1];
    const d = new Date(`${last[1]} ${last[2]}, ${yearM[1]}`);
    if (!isNaN(d)) return d;
  }
  // Fallback: a single delimiter-bearing date string (ISO / numeric). The
  // delimiter guard stops a bare "2026" from being read as Jan 1.
  if (/[\/-]/.test(s)) {
    const d2 = new Date(s);
    if (!isNaN(d2)) return d2;
  }
  return null;
}

// Resolves a week-column header cell to an ISO week key "YYYY.Wn".
// Tries the ISO label form first (weekToKey_PS_), then falls back to a parsed
// date header so exports that omit the stacked ISO label row still match.
function weekKeyFromCell_(cell, defYear) {
  const iso = weekToKey_PS_(cell, defYear);
  if (iso) return iso;
  const d = cellToDate_PS_(cell);
  return d ? `${isoWeekYear_PS_(d)}.W${isoWeekNum_PS_(d)}` : null;
}

// Exact-normalized column finder for the PTO accumulation sheet.
// Strips all non-alphanumeric characters before comparing — handles "Department: Name",
// "Department Name", "DepartmentName", etc. as the same target.
function findCol_PTO_(headers, name) {
  const clean = s => String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
  const target = clean(name);
  return headers.findIndex(h => clean(h) === target);
}

// Parses accounting-style numeric strings: "(1,234.56)" → -1234.56, "—" → 0.
function parseSmartFloat_PTO_(val) {
  if (val === null || val === undefined || val === "" || val === "-" || val === "—") return 0;
  if (typeof val === "number") return val;
  let s = String(val).trim();
  if (s.startsWith("(") && s.endsWith(")")) s = "-" + s.slice(1, -1);
  s = s.replace(/[^\d.-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// Returns roster entries that are NOT in ramp-up (used for metrics that require tenure)
function activeRoster_(roster) {
  return new Map([...roster].filter(([, p]) => !p.isRampUp));
}

function rcrTier_PS_(v) {
  if (v === null || v === undefined) return "No Data";
  if (v <= CONFIG_PS.RCR_CRITICAL)  return "Critical";
  if (v <= CONFIG_PS.RCR_WATCH)     return "Watch";
  if (v <= CONFIG_PS.RCR_HEALTHY)   return "Healthy";
  return "Champion";
}

function isNA_PS_(v) {
  if (v === null || v === undefined || v === "") return true;
  const s = String(v).trim().toLowerCase();
  return s === "n/a" || s === "na" || s === "#n/a" || s === "-" || s === "—";
}

// Locates the Employee ID column in RC / TCC sheets.
// Tries exact match first, then regex so minor header variations still resolve.
function findIdCol_(hdrs) {
  let c = hdrs.findIndex(h => h.trim().toLowerCase() === "employee id");
  if (c === -1) c = hdrs.findIndex(h => /^employee.?id/i.test(h.trim()));
  return c;
}

// ============================================================
// DATA READERS
// ============================================================

function readPSRoster_() {
  const ss    = SpreadsheetApp.openById(getExternalSSIds_().roster);
  const sheet = ss.getSheetByName(CONFIG_PS.SHEET_ROSTER);
  if (!sheet) { Logger.log(`❌ Roster sheet not found.`); return new Map(); }

  const lastRow  = sheet.getLastRow();
  const lastCol  = sheet.getLastColumn();
  if (lastRow < 2) return new Map();

  // Read the full used range from row 1 / col 1 so we never miss a column
  const raw  = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const hdrs = raw[0].map(h => String(h).trim());
  const rows = raw.slice(1);

  log_(`Roster headers (${hdrs.length}): ${hdrs.join(" | ")}`);

  const idx = (name) => hdrs.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const iName       = idx("Name");
  const iClass      = idx("Class");
  const iLoc        = idx("Key Location");
  const iSup        = idx("Supervisor");
  const iTitle      = idx("Job Title");
  const iDept       = idx("Department");
  const iStatus     = idx("Employee Status");
  const iInternalId = idx("Internal ID");
  const iEmpNum     = idx("Employee Number");
  const iHireDate   = idx("Hire Date");
  const iRampFlag   = idx(CONFIG_PS.RAMP_UP_FLAG_COL);
  const iTermDate   = idx("Termination/Release Date");
  const iEmail      = idx("Email");

  log_(`Roster col indices — Name:${iName} Class:${iClass} InternalID:${iInternalId} EmpNum:${iEmpNum} Status:${iStatus} HireDate:${iHireDate} RampFlag:${iRampFlag}`);
  if (iStatus === -1) Logger.log(`⚠️ Roster "Employee Status" column not found — status-based exclusions will not apply.`);

  if (iName === -1) { Logger.log(`❌ Roster "Name" column not found.`); return new Map(); }

  // Log distinct Class and Status values to confirm what's in the sheet
  const classValues  = new Set(rows.map(r => String(iClass  !== -1 ? r[iClass]  : "").trim()).filter(Boolean));
  const statusValues = new Set(rows.map(r => String(iStatus !== -1 ? r[iStatus] : "").trim()).filter(Boolean));
  log_(`Roster distinct Class values: ${[...classValues].join(" | ")}`);
  log_(`Roster distinct Employee Status values: ${[...statusValues].join(" | ")}`);

  const roster = new Map();
  rows.forEach(row => {
    const name   = String(row[iName]  || "").trim();
    const cls    = String(iClass  !== -1 ? row[iClass]  : "").trim();
    const status = String(iStatus !== -1 ? row[iStatus] : "").trim().toLowerCase();
    if (!name || cls !== CONFIG_PS.PS_CLASS) return;
    // Department must be 'Services' when the column is present and non-empty
    if (iDept !== -1) {
      const dept = String(row[iDept] || "").trim();
      if (dept && dept !== CONFIG_PS.PS_DEPT) return;
    }
    const termDate   = iTermDate !== -1 ? String(row[iTermDate] || "").trim() : "";
    const isInactive = (status && /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i.test(status)) || !!termDate;
    if (isInactive) return;

    // Ramp-up: in ramp-up if hired within threshold, unless manual flag overrides
    const hireDate   = iHireDate !== -1 ? parseDate_PS_(row[iHireDate]) : null;
    const rampFlag   = String(iRampFlag !== -1 ? row[iRampFlag] : "").trim().toLowerCase();
    const jobTitle   = String(iTitle      !== -1 ? row[iTitle]      : "").trim() || "Unknown";
    const isCrew     = /crew member|contractor/i.test(jobTitle);
    
    const flagYes    = rampFlag === "yes" || rampFlag === "true" || rampFlag === "1";
    const flagNo     = rampFlag === "no"  || rampFlag === "false" || rampFlag === "0";
    const thresholdMs = CONFIG_PS.RAMP_UP_MONTHS * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000;
    const hiredRecently = hireDate && (Date.now() - hireDate.getTime()) < thresholdMs;
    const isRampUp   = flagNo ? false : (flagYes || !!hiredRecently);

    roster.set(normPS_(name), {
      name,
      internalId:     String(iInternalId !== -1 ? row[iInternalId] : "").trim(),
      employeeNumber: String(iEmpNum     !== -1 ? row[iEmpNum]     : "").replace(/,/g, "").trim(),
      keyLocation:    String(iLoc        !== -1 ? row[iLoc]        : "").trim() || "Unknown",
      supervisor:     String(iSup        !== -1 ? row[iSup]        : "").trim() || "Unknown",
      jobTitle:       jobTitle,
      dept:           String(iDept       !== -1 ? row[iDept]       : "").trim() || "",
      email:          String(iEmail      !== -1 ? row[iEmail]      : "").trim().toLowerCase(),
      hireDate,
      isRampUp,
      isCrewMember:   isCrew,
    });
  });

  log_(`Roster: ${roster.size} PS employees loaded.`);
  if (roster.size > 0) {
    log_(`  Sample names: ${[...roster.values()].slice(0,5).map(e => e.name).join(", ")}`);
  }
  return roster;
}

// Builds a Map<internalId → normName> from the roster for ID-based lookups
function rosterIdMap_(roster, field) {
  const m = new Map();
  roster.forEach((profile, norm) => {
    const id = profile[field];
    if (id) m.set(id, norm);
  });
  return m;
}

// BFS over the roster's Supervisor field to build the full org tree under a manager.
// The manager's own norm name is included so their own row appears in the data.
function resolveManagerScope_(roster, managerNorm) {
  const scope = new Set([managerNorm]); // manager sees their own row
  const queue = [managerNorm];
  while (queue.length > 0) {
    const supNorm = queue.shift();
    roster.forEach((profile, norm) => {
      if (!scope.has(norm) && normPS_(profile.supervisor) === supNorm) {
        scope.add(norm);
        queue.push(norm); // recurse — this person may also supervise others
      }
    });
  }
  return scope;
}

// Computes team RCR = SUM(Revenue Contribution) / SUM(TCC A+B) for the PS headcount.
// Uses "3. RCR" as a bridge: name-matches to roster to get per-employee RCR values AND
// harvests Employee IDs (same format as RC/TCC sheets) to do the team SUM(RC)/SUM(TCC).
function readRCR_PS_(roster, teamSubset, ctx) {
  const aggRoster = teamSubset || roster;  // controls team-level aggregation; byEmployee still covers all roster
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const empty = { teamRCR: null, lastMonth: null, tier: "No Data", byEmployee: {} };

  // ── Step 1: Read "3. RCR" — name-match to roster + harvest Employee IDs ──────
  const rcrSheet = loadSheet_PS_(ss, CONFIG_PS.SHEET_RCR);
  if (!rcrSheet) { Logger.log(`⚠️ RCR: "${CONFIG_PS.SHEET_RCR}" sheet not found.`); return empty; }

  const rcrHdrs = rcrSheet.headers;
  let iRcrName = rcrHdrs.findIndex(h => /^employee.?name/i.test(h.trim()));
  if (iRcrName === -1) iRcrName = rcrHdrs.findIndex(h => /^name/i.test(h.trim()));
  if (iRcrName === -1) iRcrName = 0;
  const iRcrId = rcrHdrs.findIndex(h => /^employee.?id/i.test(h.trim()));

  // Detect last populated month from 3. RCR
  const rcrMonthIdxs = ctx.monthCols.map(m => rcrHdrs.findIndex(h => h.trim() === m));
  let lastMonthPos = -1;
  for (let mi = rcrMonthIdxs.length - 1; mi >= 0; mi--) {
    const col = rcrMonthIdxs[mi];
    if (col === -1) continue;
    if (rcrSheet.rows.some(r => !isNA_PS_(r[col]) && !isNaN(parseFloat(r[col])))) {
      lastMonthPos = mi; break;
    }
  }
  if (lastMonthPos === -1) { Logger.log(`⚠️ RCR: no populated month in "${CONFIG_PS.SHEET_RCR}".`); return empty; }

  const lastMonthName = ctx.monthCols[lastMonthPos];
  const rcrMonthCol   = rcrMonthIdxs[lastMonthPos];

  // Build per-employee RCR from 3. RCR and collect name→employeeId bridge
  const byEmployee   = {};
  const normToEmpId  = new Map(); // normName → Employee ID (for RC/TCC lookup)

  rcrSheet.rows.forEach(row => {
    const name = String(row[iRcrName] || "").trim();
    if (!name) return;
    const norm = normPS_(name);
    if (!roster.has(norm)) return;
    // Only harvest Employee IDs for aggRoster members — these drive the team RC/TCC summation.
    if (aggRoster.has(norm) && iRcrId !== -1) {
      const empId = String(row[iRcrId] || "").trim();
      if (empId) normToEmpId.set(norm, empId);
    }
    const val = parseFloat(row[rcrMonthCol]);
    if (!isNaN(val)) byEmployee[norm] = { value: val };
  });

  Logger.log(`3. RCR: "${lastMonthName}", ${Object.keys(byEmployee).length} PS employees matched, ${normToEmpId.size} Employee IDs harvested`);

  // ── Step 2: Team RCR = SUM(RC) / SUM(TCC) using bridged Employee IDs ──────────
  const empIdToNorm = new Map([...normToEmpId.entries()].map(([norm, id]) => [id, norm]));

  const rcData  = loadSheet_PS_(ss, "1. Revenue Contribution");
  const tccData = loadSheet_PS_(ss, "2. TCC A+B");

  let sumRC = 0, sumTCC = 0;

  if (rcData && tccData) {
    const rcIdCol    = findIdCol_(rcData.headers);
    const tccIdCol   = findIdCol_(tccData.headers);
    const rcMonthCol  = rcData.headers.findIndex(h => h.trim() === lastMonthName);
    const tccMonthCol = tccData.headers.findIndex(h => h.trim() === lastMonthName);

    if (rcIdCol !== -1 && rcMonthCol !== -1) {
      rcData.rows.forEach(row => {
        const id = String(row[rcIdCol] || "").trim();
        if (!empIdToNorm.has(id)) return;
        const v = parseFloat(row[rcMonthCol]);
        if (!isNaN(v)) sumRC += v;
      });
    }
    if (tccIdCol !== -1 && tccMonthCol !== -1) {
      tccData.rows.forEach(row => {
        const id = String(row[tccIdCol] || "").trim();
        if (!empIdToNorm.has(id)) return;
        const v = parseFloat(row[tccMonthCol]);
        if (!isNaN(v)) sumTCC += v;
      });
    }
    Logger.log(`RCR: sumRC=${Math.round(sumRC)}, sumTCC=${Math.round(sumTCC)}`);
  } else {
    Logger.log(`⚠️ RCR: RC or TCC sheet missing — falling back to average of individual values.`);
  }

  // If RC/TCC sheets unavailable or produced no data, fall back to mean of 3. RCR values.
  // Also fall back when sumTCC > 0 but sumRC = 0 — this almost always means an Employee ID
  // format mismatch between "3. RCR" and "1. Revenue Contribution" (e.g. trailing ".00",
  // comma-formatted numbers, or a different ID scheme), not that the team earned zero revenue.
  let teamRCR = null;
  if (sumTCC > 0 && sumRC > 0) {
    teamRCR = Math.round((sumRC / sumTCC) * 100) / 100;
  } else {
    if (sumTCC > 0 && sumRC <= 0) {
      Logger.log(`⚠️ RCR: sumTCC=${Math.round(sumTCC)} but sumRC=${Math.round(sumRC)} — likely Employee ID mismatch between "3. RCR" and "1. Revenue Contribution" or net credit reversal. Falling back to individual 3.RCR averages.`);
    }
    const aggVals = Object.entries(byEmployee)
      .filter(([nm]) => aggRoster.has(nm))
      .map(([, e]) => e.value);
    if (aggVals.length > 0) {
      teamRCR = Math.round((aggVals.reduce((a, b) => a + b, 0) / aggVals.length) * 100) / 100;
      Logger.log(`⚠️ RCR: RC/TCC sheets unavailable — averaging individual 3.RCR values (${aggVals.length} employees). This differs from SUM(RC)/SUM(TCC). Result: ${teamRCR}`);
    }
  }

  // Build full fiscal-year-to-date RCR history (oldest → newest) using 3.RCR
  // individual averages per month. Starts at the first month (Jul) through the
  // last completed month; months with no data are skipped below (empty `vals`).
  // The full range also feeds the per-employee "who needs support" table client-side.
  const rcrHistory = [];
  const rcrByEmployee = {};  // norm → { monthName: rcrValue } — all roster members, for client-side filter slicing
  const histStart = 0;
  for (let mi = histStart; mi <= lastMonthPos; mi++) {
    const col = rcrMonthIdxs[mi];
    if (col === -1) continue;
    const monthName = ctx.monthCols[mi];
    const vals = [];
    rcrSheet.rows.forEach(row => {
      const nm = normPS_(String(row[iRcrName] || "").trim());
      if (!roster.has(nm)) return;
      const v = parseFloat(row[col]);
      if (isNaN(v)) return;
      if (!rcrByEmployee[nm]) rcrByEmployee[nm] = {};
      rcrByEmployee[nm][monthName] = v;
      if (aggRoster.has(nm)) vals.push(v);
    });
    if (!vals.length) continue;
    const monthAvg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 100) / 100;
    const isLast   = mi === lastMonthPos;
    const rcr      = isLast && teamRCR !== null ? teamRCR : monthAvg;
    rcrHistory.push({ month: monthName, rcr, exact: isLast && sumTCC > 0 && sumRC > 0 });
  }

  const tier = rcrTier_PS_(teamRCR);
  Logger.log(`RCR final: teamRCR=${teamRCR}, tier=${tier}, employees with RCR=${Object.keys(byEmployee).length}, history months=${rcrHistory.length}, byEmployee keys=${Object.keys(rcrByEmployee).length}`);
  return { teamRCR, lastMonth: lastMonthName, tier, byEmployee, rcrHistory, rcrByEmployee };
}

// Resolves a roster norm-name from a row in the SI sheet.
// Tries Employee Number first (most reliable), falls back to name match.
function resolveSIRowNorm_(row, iEmpNum, empNumToNorm, siNameCol, roster) {
  if (iEmpNum !== -1) {
    const empNum = String(row[iEmpNum] || "").replace(/,/g, "").trim();
    if (empNum) {
      const norm = empNumToNorm.get(empNum);
      if (norm) return norm;
    }
  }
  const nameNorm = normPS_(String(row[siNameCol] || "").trim());
  return roster.has(nameNorm) ? nameNorm : null;
}

// Reads SI scores; matches by Employee Number (same join key as Contribution Report.js)
function readSI_PS_(roster, teamSubset, ctx) {
  const aggRoster = teamSubset || roster;  // controls teamAvg / siHistory; byEmployee covers all roster
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const data    = loadSheet_PS_(ss, CONFIG_PS.SHEET_SI);
  const quarter = ctx.siQuarterCol.match(/FY\w+/i)?.[0] || "";
  const empty   = { teamAvg: null, quarter, byEmployee: {} };
  if (!data) { Logger.log(`⚠️ SI sheet not found.`); return empty; }

  const hdrs = data.headers;
  Logger.log(`SI headers: ${hdrs.join(" | ")}`);

  // Match by Employee Number — same key used in Contribution Report.js
  const empNumToNorm = rosterIdMap_(roster, "employeeNumber");
  const iEmpNum = hdrs.findIndex(h => /employee.?number|emp.?num/i.test(h.trim()));
  if (iEmpNum === -1) { Logger.log(`⚠️ SI: "Employee Number" column not found. Attempting name fallback.`); }

  const iSI = hdrs.findIndex(h => h.trim() === ctx.siQuarterCol);
  if (iSI === -1) {
    Logger.log(`⚠️ SI column "${ctx.siQuarterCol}" not found. Headers: ${hdrs.join(", ")}`);
    return empty;
  }

  let siNameCol = hdrs.findIndex(h => /^name|rocketeer/i.test(h));
  if (siNameCol === -1) siNameCol = 0;

  const byEmployee = {};
  let total = 0, count = 0;

  data.rows.forEach(row => {
    const norm = resolveSIRowNorm_(row, iEmpNum, empNumToNorm, siNameCol, roster);
    if (!norm) return;
    if (isNA_PS_(row[iSI])) return;
    const n = parseFloat(row[iSI]);
    if (isNaN(n) || n === 0) return; // 0 = "-" / not yet rated — exclude from scoring
    byEmployee[norm] = n;
    if (aggRoster.has(norm)) { total += n; count++; }
  });

  const teamAvg = count > 0 ? Math.round((total / count) * 100) / 100 : null;

  // Detect all available SI quarter columns for historical trend
  const siHistCols = hdrs.reduce((acc, h, i) => {
    const m = h.trim().match(/small\s+improvements\s+manager\s+rating\s+(FY\w+)/i);
    if (m) acc.push({ quarter: m[1].trim(), col: i });
    return acc;
  }, []);
  const siHistory = siHistCols.map(({ quarter, col }) => {
    let t = 0, c = 0;
    data.rows.forEach(row => {
      const nm = resolveSIRowNorm_(row, iEmpNum, empNumToNorm, siNameCol, roster);
      if (!nm || !aggRoster.has(nm) || isNA_PS_(row[col])) return;
      const n = parseFloat(row[col]);
      if (!isNaN(n) && n > 0) { t += n; c++; } // 0 = "-" / not rated, exclude from average
    });
    return c > 0 ? { quarter, avg: Math.round(t / c * 100) / 100 } : null;
  }).filter(Boolean);

  // Per-employee SI by quarter (all roster) — feeds the per-rocketeer historical
  // trend in the Overview detail drawer. 0 / "-" means not yet rated → omitted.
  const byEmployeeQ = {};
  data.rows.forEach(row => {
    const nm = resolveSIRowNorm_(row, iEmpNum, empNumToNorm, siNameCol, roster);
    if (!nm) return;
    siHistCols.forEach(({ quarter, col }) => {
      if (isNA_PS_(row[col])) return;
      const n = parseFloat(row[col]);
      if (!isNaN(n) && n > 0) {
        if (!byEmployeeQ[nm]) byEmployeeQ[nm] = {};
        byEmployeeQ[nm][quarter] = n;
      }
    });
  });

  Logger.log(`SI: count=${count}, avg=${teamAvg}, history quarters=${siHistory.length}`);
  return { teamAvg, quarter, byEmployee, siHistory, byEmployeeQ, siQuarters: siHistCols.map(c => c.quarter) };
}

// Reads the Accumulation Cost sheet and builds a per-employee profile keyed by Employee Number:
//   { balanceHistory: [{ date, balance }],  plannedUsageDates: [Date, …] }
// Filters to Department: Name = CONFIG_PS.PS_DEPT ("Services").
function readPTOAccumulationProfiles_() {
  try {
    Logger.log(`🕐 readPTOAccumulationProfiles_: opening ${CONFIG_PS.PTO_ACCUM_SS_ID}`);
    const ss = SpreadsheetApp.openById(getExternalSSIds_().ptoAccum);
    const sh = ss.getSheetByName(CONFIG_PS.PTO_ACCUM_SHEET);
    if (!sh) {
      Logger.log(`❌ readPTOAccumulationProfiles_: sheet "${CONFIG_PS.PTO_ACCUM_SHEET}" not found.`);
      return {};
    }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2) { Logger.log(`⚠️ readPTOAccumulationProfiles_: no data rows.`); return {}; }

    const rawData  = sh.getRange(1, 1, lastRow, lastCol).getValues();
    const headers  = rawData[0].map(h => String(h).trim());

    const COL = {
      empNum:  findCol_PTO_(headers, "Employee Number"),
      dept:    findCol_PTO_(headers, "Department: Name"),
      date:    findCol_PTO_(headers, "Date"),
      balance: findCol_PTO_(headers, "Balance"),
      adjType: findCol_PTO_(headers, "Adjustment Type"),
    };
    // Optional explicit transaction-amount column (try several common names)
    let amtCol = -1;
    for (const name of ["Amount", "Hours", "AdjustmentAmount", "AdjustmentHours"]) {
      amtCol = findCol_PTO_(headers, name);
      if (amtCol !== -1) break;
    }
    Logger.log(`readPTOAccumulationProfiles_ cols: ${JSON.stringify(COL)} amtCol:${amtCol} | headers: ${headers.join(" | ")}`);

    const missing = Object.entries(COL).filter(([, idx]) => idx === -1).map(([k]) => k);
    if (missing.length > 0) {
      Logger.log(`❌ readPTOAccumulationProfiles_: missing columns: ${missing.join(", ")}`);
      return {};
    }

    const horizonMs  = Date.now() + CONFIG_PS.PTO_PLANNING_HORIZON_MONTHS * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000;
    const profiles   = {};
    let kept = 0, droppedDept = 0, droppedNoEmp = 0, droppedNoDate = 0;

    for (let i = 1; i < rawData.length; i++) {
      const row  = rawData[i];
      const dept = String(row[COL.dept] || "").trim();
      if (dept !== CONFIG_PS.PS_DEPT) { droppedDept++; continue; }

      const empRaw = row[COL.empNum];
      const empNum = String(typeof empRaw === "number" ? Math.round(empRaw) : (empRaw || ""))
                       .replace(/,/g, "").trim();
      if (!empNum) { droppedNoEmp++; continue; }

      const date = parseDate_PS_(row[COL.date]);
      if (!date) { droppedNoDate++; continue; }

      if (!profiles[empNum]) profiles[empNum] = { balanceHistory: [], plannedUsageDates: [], transactions: [], events: [] };
      const p = profiles[empNum];

      const adjType   = String(row[COL.adjType] || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const isUsageTx    = adjType.includes("usage") || adjType.includes("timeoff");
      const isAccrual    = adjType.includes("accru");
      const isYearExpiry = adjType.includes("yearend");
      const isCarryover  = adjType === "carryover";
      const explicitAmt = amtCol !== -1 ? Math.abs(parseSmartFloat_PTO_(row[amtCol])) : null;

      // Store adjType flags on each entry so post-sort delta derivation has full context
      p.balanceHistory.push({
        date, balance: parseSmartFloat_PTO_(row[COL.balance]),
        isUsage: isUsageTx, isAccrual, explicitAmt,
        isYearExpiry, isCarryover,
      });

      if (isUsageTx && date.getTime() <= horizonMs) {
        p.plannedUsageDates.push(date);
      }
      kept++;
    }

    Object.values(profiles).forEach(p => {
      p.balanceHistory.sort((a, b) => a.date - b.date);
      p.plannedUsageDates.sort((a, b) => a - b);

      // Build display events for Year End Expiry / Carryover transactions
      p.events = [];
      p.balanceHistory.forEach((entry, i) => {
        if (!entry.isYearExpiry && !entry.isCarryover) return;
        let hours;
        if (entry.explicitAmt !== null && entry.explicitAmt > 0) {
          hours = entry.isCarryover ? entry.explicitAmt : -entry.explicitAmt;
        } else if (i > 0) {
          const delta = entry.balance - p.balanceHistory[i - 1].balance;
          hours = Math.round(delta);
        } else {
          return;
        }
        const isoW = isoWeekNum_PS_(entry.date);
        const isoY = isoWeekYear_PS_(entry.date);
        p.events.push({
          date:      entry.date,
          weekLabel: isoY + ".W" + isoW,
          type:      entry.isYearExpiry ? "year-expiry" : "carryover",
          hours:     Math.round(hours),
        });
      });

      // Build transactions from consecutive sorted balance pairs.
      // Using index-based pairs (not findIndex) avoids same-date collision issues.
      // Amount = explicit column if available, otherwise balance delta.
      p.transactions = [];
      for (let i = 0; i < p.balanceHistory.length; i++) {
        const entry = p.balanceHistory[i];
        if (!entry.isUsage && !entry.isAccrual) continue;
        let amount;
        if (entry.explicitAmt !== null && entry.explicitAmt > 0) {
          amount = entry.explicitAmt;
        } else if (i > 0) {
          const delta = entry.balance - p.balanceHistory[i - 1].balance;
          if (entry.isUsage   && delta < 0) amount = -delta;
          else if (entry.isAccrual && delta > 0) amount =  delta;
        }
        if (amount !== undefined && amount > 0) {
          p.transactions.push({ date: entry.date, isUsage: entry.isUsage, isAccrual: entry.isAccrual, amount });
        }
      }
    });

    Logger.log(`✅ readPTOAccumulationProfiles_: ${Object.keys(profiles).length} employees · ${kept} kept · dropped: dept=${droppedDept} noEmp=${droppedNoEmp} noDate=${droppedNoDate}`);
    return profiles;
  } catch (e) {
    Logger.log(`❌ readPTOAccumulationProfiles_: ${e.message}`);
    return {};
  }
}

// Evaluates PTO Planning Health per week for every roster employee.
// Accept an optional pre-loaded `profiles` object so getPSReportData can load once and reuse.
// Returns: { [weekLabel]: { score, goodCount, atRiskCount, total, byEmployee: { [norm]: {...} } } }
function readPTOPlanningHealthByWeek_(roster, weeks, profiles) {
  try {
    if (!profiles) profiles = readPTOAccumulationProfiles_();
    Logger.log(`🕐 readPTOPlanningHealthByWeek_: ${roster.size} employees × ${weeks.length} weeks`);
    const empNumToNorm = rosterIdMap_(roster, "employeeNumber");

    const result = {};
    weeks.forEach(w => {
      result[w.label] = { score: 0, goodCount: 0, atRiskCount: 0, total: 0, byEmployee: {} };
    });

    weeks.forEach(week => {
      const [wy, wm, wd] = week.sunday.split("-").map(Number);
      const weekEnd         = new Date(wy, wm - 1, wd, 23, 59, 59);
      const horizonEnd      = new Date(weekEnd.getTime() + CONFIG_PS.PTO_PLANNING_HORIZON_MONTHS * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000);
      const pastSixStart    = new Date(weekEnd.getTime() -  6 * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000);
      const pastTwelveStart = new Date(weekEnd.getTime() - 12 * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000);
      const bucket          = result[week.label];

      roster.forEach((rp, norm) => {
        bucket.total++;
        const accumP = rp.employeeNumber ? profiles[rp.employeeNumber] : null;

        // Latest balance snapshot on or before weekEnd
        let latestBalance = null, balanceAsOf = null;
        if (accumP && accumP.balanceHistory.length > 0) {
          for (let i = accumP.balanceHistory.length - 1; i >= 0; i--) {
            if (accumP.balanceHistory[i].date <= weekEnd) {
              latestBalance = accumP.balanceHistory[i].balance;
              balanceAsOf   = accumP.balanceHistory[i].date;
              break;
            }
          }
        }

        // Compute PTO usage/accrual amounts for the planning-health rules
        let annualAccrual = 0, pastSixTaken = 0, nextSixPlanned = 0, hasAmountData = false;
        if (accumP && accumP.transactions && accumP.transactions.length > 0) {
          accumP.transactions.forEach(tx => {
            if (tx.amount === null || tx.amount <= 0) return;
            hasAmountData = true;
            // Annual accrual = sum of accrual entries in the past 12 months
            if (tx.isAccrual && tx.date >= pastTwelveStart && tx.date <= weekEnd) {
              annualAccrual += tx.amount;
            }
            // Past-6-months taken = usage entries from pastSixStart → weekEnd
            if (tx.isUsage && tx.date >= pastSixStart && tx.date <= weekEnd) {
              pastSixTaken += tx.amount;
            }
            // Next-6-months planned = usage entries from weekEnd → horizonEnd
            if (tx.isUsage && tx.date > weekEnd && tx.date <= horizonEnd) {
              nextSixPlanned += tx.amount;
            }
          });
        }
        const totalTakenPlanned = pastSixTaken + nextSixPlanned;

        // Fallback planned-dates flag (used when transaction amounts are unavailable)
        const hasPlannedPTO = !!(accumP && accumP.plannedUsageDates.some(
          d => d > weekEnd && d <= horizonEnd
        ));

        // Rule evaluation
        // — Negative balance → total compliance (override all other checks)
        // — Balance < 100h  → automatically Good
        // — Balance ≥ 100h  → must show active management:
        //     past-6 + next-6 months taken/planned ≥ 80% of annual accrual
        //     AND past-6 months taken ≥ 50% of annual accrual
        // — Fallback (no amount data): planned PTO upcoming → Good
        let status, reason;
        if (latestBalance === null) {
          status = "Good"; reason = "No balance data";
        } else if (latestBalance < 0) {
          status = "Good"; reason = "Negative balance — total compliance";
        } else if (latestBalance < CONFIG_PS.PTO_BALANCE_THRESHOLD) {
          status = "Good"; reason = `Balance ${Math.round(latestBalance)}h < ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h`;
        } else if (hasAmountData && annualAccrual > 0) {
          const pct12mo  = totalTakenPlanned / annualAccrual;
          const pctPast6 = pastSixTaken      / annualAccrual;
          if (pct12mo >= 0.80 && pctPast6 >= 0.50) {
            status = "Good";
            reason = `12mo ${Math.round(pct12mo * 100)}% taken/planned · past 6mo ${Math.round(pctPast6 * 100)}%`;
          } else {
            status = "At Risk";
            const gaps = [`Balance ${Math.round(latestBalance)}h ≥ ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h`];
            if (pct12mo  < 0.80) gaps.push(`12mo taken/planned ${Math.round(pct12mo  * 100)}% < 80%`);
            if (pctPast6 < 0.50) gaps.push(`past 6mo taken ${Math.round(pctPast6 * 100)}% < 50%`);
            reason = gaps.join(" · ");
          }
        } else if (hasPlannedPTO) {
          status = "Good"; reason = "Planned PTO within 6 months";
        } else {
          status = "At Risk";
          reason = `Balance ${Math.round(latestBalance)}h ≥ ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h · no planned PTO`;
        }

        if (status === "Good") bucket.goodCount++; else bucket.atRiskCount++;
        bucket.byEmployee[norm] = {
          status, reason,
          balance:        latestBalance,
          balanceAsOf:    balanceAsOf ? balanceAsOf.toISOString().split("T")[0] : null,
          annualAccrual:  hasAmountData && annualAccrual > 0 ? Math.round(annualAccrual)   : null,
          pastSixTaken:   hasAmountData                     ? Math.round(pastSixTaken)     : null,
          nextSixPlanned: hasAmountData                     ? Math.round(nextSixPlanned)   : null,
          pct12mo:        hasAmountData && annualAccrual > 0 ? Math.round(totalTakenPlanned / annualAccrual * 100) : null,
          pctPast6:       hasAmountData && annualAccrual > 0 ? Math.round(pastSixTaken      / annualAccrual * 100) : null,
        };
        // Attach any Year End Expiry / Carryover events that fall in this week
        const empEvents = accumP ? (accumP.events || []).filter(e => e.weekLabel === week.label) : [];
        if (empEvents.length > 0) {
          bucket.byEmployee[norm].ptoEvents = empEvents.map(e => ({ type: e.type, hours: e.hours }));
        }
      });

      bucket.score = bucket.total > 0
        ? Math.round((bucket.goodCount / bucket.total) * 100)
        : 0;
    });

    Logger.log(`✅ readPTOPlanningHealthByWeek_: ` +
      weeks.map(w => `${w.label}:${result[w.label].score}%(${result[w.label].goodCount}/${result[w.label].total})`).join(" "));
    return result;
  } catch (e) {
    Logger.log(`❌ readPTOPlanningHealthByWeek_: ${e.message}`);
    return weeks.reduce((r, w) => { r[w.label] = { score: 0, goodCount: 0, atRiskCount: 0, total: 0, byEmployee: {} }; return r; }, {});
  }
}

// Builds the team summary row for PTO Planning Health.
function buildPTOHealthSummaryRow_(weeks, ptoHealth) {
  const target = CONFIG_PS.PTO_TEAM_TARGET_PCT;
  return {
    id: "pto", label: "PTO",
    tooltip: `% of team with PTO in compliance. Good = negative balance (total compliance), OR balance < ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h, OR balance ≥ ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h AND (past 6 + next 6 months taken/planned ≥ 80% of annual accrual AND past 6 months taken ≥ 50% of annual accrual). At Risk = balance ≥ ${CONFIG_PS.PTO_BALANCE_THRESHOLD}h with insufficient planning. Target: ${target}%.`,
    cells: weeks.map(w => {
      const b = ptoHealth[w.label];
      if (!b || b.total === 0) return { display: "—", value: null };
      return {
        display: String(b.score),
        value:   b.score,
        sub:     `${b.goodCount} planned · ${b.atRiskCount} need a plan`,
      };
    }),
  };
}

function readKudosByWeek_(psNames, weeks) {
  const ss   = SpreadsheetApp.getActiveSpreadsheet();
  const data = loadSheet_PS_(ss, CONFIG_PS.SHEET_KUDOS);
  const result = {};
  weeks.forEach(w => { result[w.label] = { count: 0, givenCount: 0, byEmployee: {} }; });
  if (!data) { Logger.log(`⚠️ Kudos sheet not found.`); return result; }

  const hdrs = data.headers.map(h => h.toLowerCase());
  const iRecip   = findCol_PS_(hdrs, "recipient",             true);
  const iGiver   = findCol_PS_(hdrs, "giver",                 true);
  const iDesc    = findCol_PS_(hdrs, "description");
  const iDate    = findCol_PS_(hdrs, "create date",           true);
  const iOrgVals = findCol_PS_(hdrs, "organizational values", true);
  // Prefer the computed "iso week" column; fall back to legacy "week"
  let iWeek = findCol_PS_(hdrs, "iso week", true);
  if (iWeek === -1) iWeek = findCol_PS_(hdrs, "week", true);
  if (iRecip === -1) { Logger.log(`⚠️ Kudos: Recipient column not found.`); return result; }

  const weekSet = new Set(weeks.map(w => w.label));
  const defYear = isoWeekYear_PS_(new Date());

  // Helper to lazily init a per-employee entry with all fields
  const initEntry_ = (b, norm) => {
    if (!b.byEmployee[norm])
      b.byEmployee[norm] = { count: 0, entries: [], givenCount: 0, givenEntries: [] };
  };

  data.rows.forEach(row => {
    // Resolve week key once per row — shared by recipient and giver tracking
    let wKey = null;
    if (iWeek !== -1 && row[iWeek]) {
      wKey = weekToKey_PS_(String(row[iWeek]).trim(), defYear);
    }
    if (!wKey && iDate !== -1) {
      const d = parseDate_PS_(row[iDate]);
      if (d) wKey = `${isoWeekYear_PS_(d)}.W${isoWeekNum_PS_(d)}`;
    }
    if (!wKey || !weekSet.has(wKey)) return;

    const b         = result[wKey];
    const recipName = String(row[iRecip] || "").trim();
    const giverName = String(iGiver   !== -1 ? row[iGiver]   : "").trim();
    const desc      = String(iDesc    !== -1 ? row[iDesc]    : "").trim();
    const orgValues = String(iOrgVals !== -1 ? row[iOrgVals] : "").trim();

    // ── Recipient: PS member who received the kudos ───────────────────
    if (recipName) {
      const recipNorm = normPS_(recipName);
      if (psNames.has(recipNorm)) {
        b.count++;
        initEntry_(b, recipNorm);
        b.byEmployee[recipNorm].count++;
        // Store every entry (no cap) so entries.length === count — the frontend's
        // "+N more" and orgValues tags, and the brief's per-post grouping, stay accurate.
        b.byEmployee[recipNorm].entries.push({ giver: giverName, desc, orgValues });
      }
    }

    // ── Giver: PS member who gave the kudos ───────────────────────────
    if (giverName) {
      const giverNorm = normPS_(giverName);
      if (psNames.has(giverNorm)) {
        b.givenCount++;
        initEntry_(b, giverNorm);
        b.byEmployee[giverNorm].givenCount++;
        // No cap — keep givenEntries.length === givenCount (see recipient note above).
        b.byEmployee[giverNorm].givenEntries.push({ recipient: recipName, desc, orgValues });
      }
    }
  });

  return result;
}

function readTrackedTimeByWeek_(psNames, weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = loadSheet_PS_(ss, CONFIG_PS.SHEET_TEMPO_TRACKED);
  const result = {};
  weeks.forEach(w => { result[w.label] = { totalHrs: 0, headcount: 0, byEmployee: {}, byEmployeeProjects: {} }; });
  if (!data) { Logger.log(`⚠️ Tempo Tracked Time sheet not found.`); return result; }
  
  // Read export timestamp from the sheet (written by TempoTrackedTime.js after TOTAL row)
  let lastExport = null;
  try {
    const sh = ss.getSheetByName(CONFIG_PS.SHEET_TEMPO_TRACKED);
    if (sh) {
      const lastRow = sh.getLastRow();
      // Look for "Last Export:" in the last few rows
      for (let r = Math.max(1, lastRow - 5); r <= lastRow; r++) {
        const label = sh.getRange(r, 1).getValue();
        if (String(label).trim() === "Last Export:") {
          const ts = sh.getRange(r, 2).getValue();
          if (ts) lastExport = new Date(ts).toISOString();
          break;
        }
      }
    }
  } catch(e) { Logger.log(`⚠️ Could not read tracked time export timestamp: ${e.message}`); }
  
  const vals = [data.headers, ...data.rows];
  const timeData = buildPlannedResult_(vals, psNames, weeks, CONFIG_PS.TRACKED_NONPROJECT_KEYS, "Tracked");
  timeData._lastExport = lastExport;
  return timeData;
}

function readPlannedTimeByWeek_(psNames, weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = loadSheet_PS_(ss, CONFIG_PS.SHEET_PLANNED);
  const result = {};
  weeks.forEach(w => { result[w.label] = { totalHrs: 0, headcount: 0, byEmployee: {}, byEmployeeProjects: {} }; });
  if (!data) { Logger.log(`⚠️ Planned Time sheet not found.`); return result; }
  const vals = [data.headers, ...data.rows];
  return buildPlannedResult_(vals, psNames, weeks, CONFIG_PS.PLANNED_NONPROJECT_KEYS, "Planned");
}

// Pure parser for the Planned Time Tempo matrix. Separated from the sheet fetch so it
// can be unit-tested (see _test_projectContext_). Returns, per week label:
//   { totalHrs, headcount, byEmployee:{norm:hrs}, byEmployeeProjects:{norm:{KEY:hrs}} }
// The total/headcount/byEmployee math is identical to the previous inline version
// (it still sums every week-column hour, time-off rows included). byEmployeeProjects
// is a parallel accumulation that additionally drops blank and non-project keys.
function buildPlannedResult_(vals, psNames, weeks, nonProjectKeys, srcLabel) {
  const SRC = srcLabel ? `[${srcLabel}] ` : "";
  const result = {};
  weeks.forEach(w => { result[w.label] = { totalHrs: 0, headcount: 0, byEmployee: {}, byEmployeeProjects: {} }; });
  if (!vals || vals.length < 2) { Logger.log(`⚠️ ${SRC}buildPlannedResult_: empty/too-short sheet (${vals ? vals.length : 0} rows).`); return result; }

  // The Tempo export writes a TWO-ROW stacked header (ISO labels over week columns in
  // row 1; field names in row 2). Locate the field-header row by its employee column,
  // then take week labels from the ISO-label row above it (new format) or that same row.
  const isEmpHdr_ = h => /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
  let hr = -1, iEmp = -1;
  for (let r = 0; r < Math.min(vals.length, 5); r++) {
    const idx = vals[r].findIndex(c => isEmpHdr_(String(c).trim()));
    if (idx !== -1) { hr = r; iEmp = idx; break; }
  }
  if (hr === -1) {
    Logger.log(`⚠️ ${SRC}Planned Time: employee column not found. Row 0: ${JSON.stringify((vals[0] || []).slice(0, 10))}`);
    return result;
  }
  log_(`${SRC}parse: ${vals.length} sheet rows · header row=${hr} · emp col=${iEmp} · header=${JSON.stringify(vals[hr].slice(0, 10))}`);

  // Project key column ("Key"). Absent in legacy single-row exports → no project context.
  const iKey = vals[hr].findIndex(c => String(c).trim().toLowerCase() === "key");
  const excludeKeys = new Set((nonProjectKeys || []).map(k => String(k).trim().toUpperCase()));

  // Match week columns per-index: prefer the stacked ISO-label row (row above the
  // field-header row), then fall back to a date/date-range header on the field row.
  // The fallback is what saves an export that omits the ISO label row — without it
  // every value would read 0 because a date string can't be parsed as "YYYY.Wn".
  const defYear  = isoWeekYear_PS_(new Date());
  const isoRow   = hr > 0 ? vals[hr - 1] : null;
  const fieldRow = vals[hr];
  const ncols    = Math.max(isoRow ? isoRow.length : 0, fieldRow.length);

  const wCols = [];
  const labelsSeen = [];
  for (let idx = 0; idx < ncols; idx++) {
    let key = isoRow ? weekToKey_PS_(isoRow[idx], defYear) : null;
    if (!key) key = weekKeyFromCell_(fieldRow[idx], defYear);
    if (!key) continue;
    labelsSeen.push(key);
    const match = weeks.find(w => w.label === key);
    if (match) wCols.push({ key: match.label, idx });
  }
  log_(`${SRC}weeks: matched ${wCols.length}/${weeks.length} columns · ` +
    `window=[${weeks.map(w => w.label).join(", ")}] · ` +
    `labelRow week-keys=[${labelsSeen.join(", ") || "NONE"}]`);
  if (wCols.length === 0) {
    Logger.log(`⚠️ ${SRC}No week columns matched the report window — every value will read as 0. ` +
      `Check that the sheet's week-column headers use the "${weeks[0] ? weeks[0].label : "YYYY.Wn"}" ISO format and overlap the current window.`);
  }

  const plannedAliases = new Map();
  for (const rosterNorm of psNames.keys()) {
    const parts = rosterNorm.split(' ');
    if (parts.length >= 2) {
      const last  = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ');
      plannedAliases.set(normPS_(`${last} ${first}`),   rosterNorm);
      plannedAliases.set(normPS_(`${last}, ${first}`),  rosterNorm);
    }
  }
  const lookupPlanned_ = raw => {
    const n = normPS_(String(raw || '').trim());
    return psNames.has(n) ? n : (plannedAliases.has(n) ? plannedAliases.get(n) : null);
  };

  // Data rows start after the field-header row; the export's "TOTAL" footer row is
  // skipped naturally since "TOTAL" resolves to no roster member.
  let rowsTotal = 0, rowsMatched = 0;
  const unmatchedSample = [];
  vals.slice(hr + 1).forEach(row => {
    const rawName = String(row[iEmp] || '').trim();
    if (rawName) rowsTotal++;
    const norm = lookupPlanned_(row[iEmp]);
    if (!norm) {
      if (rawName && rawName.toUpperCase() !== "TOTAL" && unmatchedSample.length < 5) unmatchedSample.push(rawName);
      return;
    }
    rowsMatched++;
    const rawKey    = iKey !== -1 ? String(row[iKey] || '').trim() : '';
    const isProject = !!rawKey && !excludeKeys.has(rawKey.toUpperCase());
    wCols.forEach(({ key, idx }) => {
      const hrs = parseFloat(row[idx]) || 0;
      if (hrs <= 0) return;
      const b = result[key];
      if (!b.byEmployee[norm]) { b.headcount++; b.byEmployee[norm] = 0; }
      b.byEmployee[norm] += hrs;
      b.totalHrs += hrs;
      if (isProject) {
        if (!b.byEmployeeProjects[norm]) b.byEmployeeProjects[norm] = {};
        b.byEmployeeProjects[norm][rawKey] = (b.byEmployeeProjects[norm][rawKey] || 0) + hrs;
      }
    });
  });

  const grandTotal = weeks.reduce((s, w) => s + (result[w.label] ? result[w.label].totalHrs : 0), 0);
  const summary = `${SRC}rows: ${rowsMatched}/${rowsTotal} matched roster · grand total ${Math.round(grandTotal)}h`;
  if (rowsMatched === 0) {
    Logger.log(`⚠️ ${summary}` + (unmatchedSample.length ? ` · unmatched names e.g. ${JSON.stringify(unmatchedSample)}` : ""));
  } else {
    log_(summary);
  }

  return result;
}

// histWeeks: optional list of additional completed weeks for which to compute
// "who made at least one self-comment this Mon–Sun?" counts (used by the history chart).
function readGoalsEngagement_(psNames, weeks, histWeeks, ctx) {
  const goalsSS = SpreadsheetApp.openById(getExternalSSIds_().goals);
  const data    = loadSheet_PS_(goalsSS, CONFIG_PS.SHEET_GOALS);
  const result  = {};
  weeks.filter(w => !w.isFuture).forEach(w => {
    result[w.label] = { compliant: 0, total: 0, byEmployee: {} };
  });
  // Initialize buckets for historical weeks so the comment-flag pass can store per-employee data
  (histWeeks || []).filter(w => !w.isFuture).forEach(w => {
    if (!result[w.label]) result[w.label] = { byEmployee: {} };
  });
  if (!data) { Logger.log(`⚠️ Goals sheet not found in Goals SS.`); return result; }

  const hdrs   = data.headers;
  const hdrsLC = hdrs.map(h => h.toLowerCase());

  const iRocketeer   = findCol_PS_(hdrsLC, "rocketeer");
  const iGoalId      = findCol_PS_(hdrsLC, "goal id",       true);
  const iGoalName    = findCol_PS_(hdrsLC, "goal name",     true);
  const iStatus      = findCol_PS_(hdrsLC, "goal status");
  const iCommentDate = findCol_PS_(hdrsLC, "comment date",  true);
  const iCommentator = findCol_PS_(hdrsLC, "commentator");
  const iQuarter     = findCol_PS_(hdrsLC, "fiscal quarter");

  if (iRocketeer === -1 || (iGoalId === -1 && iGoalName === -1)) {
    Logger.log(`⚠️ Goals: required columns missing (need Rocketeer + Goal ID or Goal Name). Headers: ${hdrs.join(", ")}`); return result;
  }
  Logger.log(`Goals cols — rocketeer:${iRocketeer} goalId:${iGoalId} goalName:${iGoalName} status:${iStatus} commentDate:${iCommentDate} commentator:${iCommentator} quarter:${iQuarter}`);

  // Build goalMap: normName → Map<goalId, { status, selfComments: Date[] }>
  // PS membership comes from the roster (psNames), NOT from the Goals sheet's own Class column.
  // This ensures all PS rocketeers' goals are captured regardless of how Class is populated there.
  const goalMap     = new Map();
  const prevGoalMap = new Map(); // prior-quarter counts for grace period display

  data.rows.forEach(row => {
    const rocketeer = String(row[iRocketeer] || "").trim();
    if (!rocketeer) return;
    if (iQuarter !== -1) {
      const rowQ = String(row[iQuarter] || "").trim();
      if (ctx && ctx.inGracePeriod && rowQ === ctx.prevGoalsQuarter) {
        // Prior quarter — collect counts for display only, then skip main goalMap
        const norm = normPS_(String(row[iRocketeer] || "").trim());
        if (psNames.has(norm)) {
          const rawGoalId   = iGoalId   !== -1 ? String(row[iGoalId]   || "").trim() : "";
          const rawGoalName = iGoalName !== -1 ? String(row[iGoalName] || "").trim() : "";
          let goalId = rawGoalId || rawGoalName;
          for (const { pattern, id } of CONFIG_PS.GOAL_ID_MAP) {
            if (pattern.test(rawGoalName || rawGoalId)) { goalId = id; break; }
          }
          if (!prevGoalMap.has(norm)) prevGoalMap.set(norm, { _ids: new Set(), goalCount: 0, completedCount: 0 });
          const p = prevGoalMap.get(norm);
          if (goalId && !p._ids.has(goalId)) {
            p._ids.add(goalId);
            p.goalCount++;
            const status = String(iStatus !== -1 ? row[iStatus] : "").trim();
            if (status === "Completed") p.completedCount++;
          }
        }
        return;
      }
      if (!ctx || rowQ !== ctx.goalsQuarter) return;
    }

    // Authoritative PS filter: must be in the roster (Class = 'Professional Services')
    const norm = normPS_(rocketeer);
    if (!psNames.has(norm)) return;

    const rawGoalId   = iGoalId   !== -1 ? String(row[iGoalId]   || "").trim() : "";
    const rawGoalName = iGoalName !== -1 ? String(row[iGoalName] || "").trim() : "";
    // Use Goal Name as primary match source (descriptive), fall back to Goal ID.
    // Normalises all Q3/Q4 prefix variants and goal-number reassignments to stable IDs.
    const matchSrc = rawGoalName || rawGoalId;
    let goalId = rawGoalId || rawGoalName;
    for (const { pattern, id } of CONFIG_PS.GOAL_ID_MAP) {
      if (pattern.test(matchSrc)) { goalId = id; break; }
    }
    const status      = String(iStatus      !== -1 ? row[iStatus]      : "").trim();
    const commentator = String(iCommentator !== -1 ? row[iCommentator] : "").trim();
    const commentDate = iCommentDate !== -1 ? parseDate_PS_(row[iCommentDate]) : null;

    if (!goalMap.has(norm)) goalMap.set(norm, new Map());
    const empGoals = goalMap.get(norm);

    if (!empGoals.has(goalId)) {
      empGoals.set(goalId, { status: "", selfComments: [], completed: false, nonSelfCommentCount: 0 });
    }
    // Track highest-priority status seen for this goal
    const PRIO = { "In Progress": 3, "Planned": 2, "Completed": 1 };
    const g = empGoals.get(goalId);
    if ((PRIO[status] || 0) > (PRIO[g.status] || 0)) g.status = status;
    if (status === 'Completed') g.completed = true;

    // Rocketeer's own comment; other commentators tracked for supervisor-only audit detection
    if (commentDate && normPS_(commentator) === norm) {
      g.selfComments.push(commentDate);
    } else if (commentDate && commentator) {
      g.nonSelfCommentCount++;
    }
  });

  Logger.log(`Goals: data loaded for ${goalMap.size} rocketeers (${ctx.goalsQuarter}).`);

  // Evaluate compliance per non-future week
  weeks.filter(w => !w.isFuture).forEach(week => {
    const weekEnd  = new Date(week.sunday + "T23:59:59.999Z");
    // qWeek = 1-based week number within the current quarter.
    // Use Monday-date arithmetic so the result is correct across calendar-year
    // boundaries (e.g. Q1 Jul 2026 → Jan 2027 would break if using raw ISO week numbers).
    const weekMon   = mondayOfIsoWeek_PS_(week.year, week.isoWeek);
    const qStartMon = mondayOfIsoWeek_PS_(ctx.qStartIsoYear, ctx.qStartIsoWeek);
    const qWeek    = Math.max(1, Math.floor((weekMon - qStartMon) / (7 * 86400000)) + 1);
    const reqCmt   = Math.max(1, qWeek - 4);
    // Writing ramp: no goal-count penalty for first 4 weeks of any quarter
    const goalsRequired = qWeek <= 4 ? 0 : CONFIG_PS.GOALS_MIN_COUNT;

    let compliant = 0, total = 0;

    psNames.forEach((_, norm) => {
      total++;
      const empGoals = goalMap.get(norm);
      if (!empGoals || empGoals.size === 0) {
        if (goalsRequired === 0) {
          result[week.label].byEmployee[norm] = { compliant: true, rule: null, totalGoals: 0, inWritingRamp: true };
          compliant++;
          return;
        }
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals: 0 };
        return;
      }

      const goalIds    = Array.from(empGoals.keys());
      const totalGoals = goalIds.length;

      // Rule 1: must have at least goalsRequired goals (relaxed to 0 during writing ramp)
      if (totalGoals < goalsRequired) {
        result[week.label].byEmployee[norm] = { compliant: false, rule: 1, totalGoals };
        return;
      }

      // Rule 2: majority (>50%) of goals must be "In Progress"
      const inProgressCount  = goalIds.filter(id => empGoals.get(id).status === "In Progress").length;
      const inProgressNeeded = Math.ceil(totalGoals * CONFIG_PS.GOALS_MIN_IN_PROGRESS_PCT);
      if (inProgressCount < inProgressNeeded) {
        result[week.label].byEmployee[norm] = { compliant: false, rule: 2, totalGoals, inProgressCount, inProgressNeeded };
        return;
      }

      // Rule 3: at least GOALS_ACTIVE_COMMENT_COUNT goals must have >= reqCmt cumulative self-comments by week end
      const threshold  = CONFIG_PS.GOALS_ACTIVE_COMMENT_COUNT;
      const qualifying = goalIds.filter(id => {
        const goal = empGoals.get(id);
        const cnt  = goal.selfComments.filter(d => d <= weekEnd).length;
        // Completed goals exempt from ramping threshold — ≥1 self-comment suffices
        if (goal.completed && cnt >= 1) return true;
        return cnt >= reqCmt;
      }).length;

      const ok = qualifying >= threshold;
      if (ok) compliant++;
      result[week.label].byEmployee[norm] = {
        compliant: ok, rule: ok ? null : 3,
        totalGoals, inProgressCount, inProgressNeeded, qualifying, threshold, reqCmt, qWeek,
      };
    });

    result[week.label].compliant = compliant;
    result[week.label].total     = total;
  });

  // ── Compliance override — two paths, both mark all Q4 weeks compliant:
  // (A) 8+ completed goals AND ≥5 goals with ≥8 cumulative self-comments (fully documented)
  // (B) ALL goals set to Completed AND total goals ≥ GOALS_MIN_COUNT (end-of-quarter closure)
  psNames.forEach((_, norm) => {
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    const goalIds            = Array.from(empGoals.keys());
    const totalGoals         = goalIds.length;
    const completedGoals     = goalIds.filter(id => empGoals.get(id).completed).length;
    const fullyDocumentedCount = goalIds.filter(id => empGoals.get(id).selfComments.length >= 8).length;
    const allGoalsCompleted  = completedGoals === totalGoals;
    const fullyDocOverride   = completedGoals >= CONFIG_PS.GOALS_MIN_COUNT && fullyDocumentedCount >= 5;
    const allCompletedOverride = allGoalsCompleted && totalGoals >= CONFIG_PS.GOALS_MIN_COUNT;
    if (!fullyDocOverride && !allCompletedOverride) return;
    weeks.filter(w => !w.isFuture).forEach(week => {
      const prev = result[week.label].byEmployee[norm];
      if (prev && !prev.compliant) result[week.label].compliant++;
      result[week.label].byEmployee[norm] = Object.assign({}, prev || {}, {
        compliant: true, overrideCompliant: true, fullyDocumentedCount, completedGoals,
        allGoalsCompleted,
      });
    });
  });

  // Grace period: attach prior-quarter summary to all employees for frontend display
  if (ctx && ctx.inGracePeriod && prevGoalMap.size > 0) {
    weeks.filter(w => !w.isFuture).forEach(week => {
      psNames.forEach((_, norm) => {
        const pq = prevGoalMap.get(norm);
        if (!pq) return;
        if (!result[week.label].byEmployee[norm]) return;
        result[week.label].byEmployee[norm].prevQuarterGoals = {
          quarter:        ctx.prevGoalsQuarter,
          goalCount:      pq.goalCount,
          completedCount: pq.completedCount,
        };
      });
    });
  }

  // ── Activity audit: flag rocketeers with no self-comment activity or supervisor-only engagement.
  const _overrideNorms = new Set();
  psNames.forEach((_, norm) => {
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    const goalIds        = Array.from(empGoals.keys());
    const totalGoals     = goalIds.length;
    const completedGoals = goalIds.filter(id => empGoals.get(id).completed).length;
    const allCompleted   = completedGoals === totalGoals;
    const fullyDocumented = completedGoals >= CONFIG_PS.GOALS_MIN_COUNT &&
      goalIds.filter(id => empGoals.get(id).selfComments.length >= 8).length >= 5;
    if (fullyDocumented || (allCompleted && totalGoals >= CONFIG_PS.GOALS_MIN_COUNT)) {
      _overrideNorms.add(norm);
    }
  });
  const _audit = [];
  psNames.forEach((profile, norm) => {
    if (_overrideNorms.has(norm)) return;
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    const goalIds           = Array.from(empGoals.keys());
    const totalGoals        = goalIds.length;
    const completedGoals    = goalIds.filter(id => empGoals.get(id).completed).length;
    const totalSelfComments = goalIds.reduce((s, id) => s + empGoals.get(id).selfComments.length, 0);
    const goalsNoSelf       = goalIds.filter(id => empGoals.get(id).selfComments.length === 0);
    const anyNonSelf        = goalIds.some(id => (empGoals.get(id).nonSelfCommentCount || 0) > 0);
    let flag = null;
    if (totalSelfComments === 0 && !anyNonSelf) {
      flag = "no-activity";
    } else if (totalGoals > 0 && goalsNoSelf.length / totalGoals >= 0.5 && anyNonSelf) {
      flag = "supervisor-only";
    }
    if (!flag) return;
    const allDates = goalIds.flatMap(id => empGoals.get(id).selfComments);
    const lastSelfCommentDate = allDates.length > 0
      ? allDates.reduce((m, d) => d > m ? d : m).toISOString().slice(0, 10)
      : null;
    const supervisorCommentedGoalIds = flag === "supervisor-only"
      ? goalIds.filter(id => (empGoals.get(id).nonSelfCommentCount || 0) > 0 && empGoals.get(id).selfComments.length === 0)
      : [];
    _audit.push({
      name: profile.name, normName: norm, flag,
      totalGoals, completedGoals, totalSelfComments, lastSelfCommentDate,
      goalsWithNoSelfComments: goalsNoSelf.length,
      supervisorCommentedGoalIds,
    });
  });
  result._audit = _audit;

  // Per-week operational-goal comment counts for the historical trend chart.
  // Counts rocketeers who posted ≥1 self-comment on the Tempo Worklogs (G02) OR Tempo Plans goal
  // during that specific Mon–Sun window — aligns "% documenting" with tracked/planned time habits.
  const [g03Id, g01Id]   = CONFIG_PS.OPERATIONAL_GOALS;
  const weeklyCommenters = {};
  (histWeeks || []).filter(w => !w.isFuture).forEach(w => {
    const wStart = new Date(w.monday + "T00:00:00Z");
    const wEnd   = new Date(w.sunday  + "T23:59:59.999Z");
    let count = 0, countG03 = 0, countG01 = 0, totalComments = 0;
    psNames.forEach((_, norm) => {
      const empGoals = goalMap.get(norm);
      if (!empGoals) return;
      // Count every self-comment on any goal in this Mon–Sun window
      let empWeekComments = 0;
      empGoals.forEach(g => {
        empWeekComments += g.selfComments.filter(d => d >= wStart && d <= wEnd).length;
      });
      totalComments += empWeekComments;
      // Per-goal boolean flags — computed once, reused for counters + per-employee storage
      const g03 = empGoals.get(g03Id);
      const g01 = empGoals.get(g01Id);
      const g03ok = !!(g03 && g03.selfComments.some(d => d >= wStart && d <= wEnd));
      const g01ok = !!(g01 && g01.selfComments.some(d => d >= wStart && d <= wEnd));
      if (g03ok) countG03++;
      if (g01ok) countG01++;
      if (g03ok || g01ok) count++;
      // Expose per-employee flags so the frontend can recompute for filtered views
      if (result[w.label]) {
        if (!result[w.label].byEmployee[norm]) result[w.label].byEmployee[norm] = {};
        result[w.label].byEmployee[norm].selfCommentCount = empWeekComments;
        result[w.label].byEmployee[norm].g03Commented     = g03ok;
        result[w.label].byEmployee[norm].g01Commented     = g01ok;
      }
    });
    // avgComments = mean self-comments per team member this week (1 decimal)
    const avgComments = psNames.size > 0 ? Math.round(totalComments / psNames.size * 10) / 10 : 0;
    weeklyCommenters[w.label] = { count, countG03, countG01, total: psNames.size, totalComments, avgComments };
  });
  result._weeklyCommenters = weeklyCommenters;

  return result;
}

// ============================================================
// ASSEMBLY
// ============================================================

function buildTeamSummary_(weeks, rcr, si, pto, kudos, tracked, planned, goals) {
  const fmt = (n, suffix) => n > 0 ? `${Math.round(n).toLocaleString()}${suffix}` : "—";

  // Row order: behavioral chain (Goals → Plan → Track → Kudos → Rest) then quarterly benchmarks
  return [
    {
      id: "goals", label: "Goals connected",
      tooltip: `FY26Q4 goals compliance: ≥8 goals, majority (>50%) In Progress, ≥6 goals with a self-comment made this week. Quarter target: 10 goals, 8 completed by June 30.`,
      cells: weeks.map(w => {
        if (w.isFuture) return { display: "—", value: null };
        const b = goals[w.label] || { compliant: null, total: 0 };
        if (!b.total) return { display: "—", value: null };
        const pct = Math.round((b.compliant / b.total) * 100);
        return { display: `${b.compliant} / ${b.total}`, value: pct,
                 sub: `${pct}%`, compliant: b.compliant, total: b.total };
      })
    },
    {
      id: "planned", label: "Time planned",
      tooltip: "Total hours planned in Tempo by PS team members across all five weeks (actuals for closed weeks, live data for current and future).",
      cells: weeks.map(w => {
        const b = planned[w.label] || { totalHrs: 0, headcount: 0 };
        if (!b.totalHrs) return { display: "—", value: null };
        return { display: fmt(b.totalHrs, "h"), value: b.totalHrs,
                 sub: b.headcount > 0 ? `${b.headcount} planned` : "" };
      })
    },
    {
      id: "tracked", label: "Time tracked",
      tooltip: "Total hours logged in NetSuite by PS team members for each completed week. Execution against what was planned.",
      cells: weeks.map(w => {
        if (w.isFuture) return { display: "—", value: null };
        const b = tracked[w.label] || { totalHrs: 0, headcount: 0 };
        return { display: fmt(b.totalHrs, "h"), value: b.totalHrs,
                 sub: b.headcount > 0 ? `${b.headcount} logged` : "" };
      })
    },
    {
      id: "kudos", label: "Kudos given",
      tooltip: "Total kudos given to PS team members in each completed week. Recognizing someone's contribution is the team behavior we want to grow.",
      cells: weeks.map(w => {
        if (w.isFuture) return { display: "—", value: null };
        const b = kudos[w.label] || { count: 0 };
        return { display: String(b.count || 0), value: b.count };
      })
    },
    buildPTOHealthSummaryRow_(weeks, pto),
    {
      id: "rcr", label: "RCR",
      quarterly: true,
      tooltip: `Revenue Contribution Ratio = SUM(Revenue) / SUM(TCC) for PS team — last closed month (${rcr.lastMonth || "—"}).`,
      cells: weeks.map(w => rcr.teamRCR === null
        ? { display: "N/A", value: null }
        : { display: rcr.teamRCR.toFixed(2), value: rcr.teamRCR, tier: rcr.tier })
    },
    {
      id: "si", label: "Small Improvements (" + (si.quarter || "—") + ")",
      quarterly: true,
      tooltip: "Small Improvements (SI) Manager Rating — last closed quarter (" + (si.quarter || "—") + "). Score 1–5.",
      cells: weeks.map(w => si.teamAvg === null
        ? { display: "N/A", value: null }
        : { display: String(Math.round(si.teamAvg)), value: si.teamAvg })
    },
  ];
}

function buildEmployeeRows_(roster, weeks, rcr, si, pto, kudos, tracked, planned, goals) {
  const employees = [];
  roster.forEach((profile, norm) => {
    const empWeeks = {};
    weeks.forEach(w => {
      const l = w.label;
      empWeeks[l] = {
        trackedHrs:  w.isFuture  ? null : (tracked[l]  && tracked[l].byEmployee[norm]  != null ? tracked[l].byEmployee[norm]  : null),
        plannedHrs:     planned[l] && planned[l].byEmployee[norm] != null ? planned[l].byEmployee[norm] : null,
        ptoPlannedHrs:  planned[l] && planned[l].ptoByEmployee  && planned[l].ptoByEmployee[norm]  != null ? planned[l].ptoByEmployee[norm]  : null,
        ptoHealth:   pto[l]     && pto[l].byEmployee[norm]     ? pto[l].byEmployee[norm]     : null,
        kudos:       w.isFuture  ? null : (kudos[l]   && kudos[l].byEmployee[norm]    != null ? kudos[l].byEmployee[norm]    : null),
        goalsDetail: w.isFuture  ? null : (goals[l]  && goals[l].byEmployee[norm]    != null ? goals[l].byEmployee[norm]    : null),
        projects: (function() {
          var m = planned[l] && planned[l].byEmployeeProjects && planned[l].byEmployeeProjects[norm];
          if (!m) return [];
          return Object.keys(m)
            .map(function(k) { return { key: k, hrs: m[k] }; })
            .sort(function(a, b) { return b.hrs - a.hrs; });
        })(),
      };
    });

    const rcrEntry = rcr.byEmployee[norm] || null;
    const siVal    = si.byEmployee[norm]  != null ? si.byEmployee[norm] : null;

    employees.push({
      name:        profile.name,
      normName:    norm,
      keyLocation: profile.keyLocation,
      supervisor:  profile.supervisor,
      jobTitle:    profile.jobTitle,
      dept:        profile.dept,
      isRampUp:    profile.isRampUp || false,
      isCrewMember: profile.isCrewMember || false,
      rcr:  rcrEntry,
      si:   siVal !== null ? { value: siVal } : null,
      weeks: empWeeks,
    });
  });

  employees.sort((a, b) => a.name.localeCompare(b.name));
  return employees;
}

function buildSegmentation_(roster, weeks, pto, kudos, tracked, planned, goals) {
  const dims = [
    { key: "byLocation",   field: "keyLocation" },
    { key: "bySupervisor", field: "supervisor"  },
    { key: "byJobTitle",   field: "jobTitle"    },
  ];
  const seg = {};

  dims.forEach(dim => {
    seg[dim.key] = {};
    roster.forEach((profile, norm) => {
      const grpName = profile[dim.field] || "Unknown";
      if (!seg[dim.key][grpName]) {
        seg[dim.key][grpName] = { headcount: 0, weeks: {} };
        weeks.forEach(w => {
          seg[dim.key][grpName].weeks[w.label] = { trackedHrs: 0, plannedHrs: 0, ptoGood: 0, ptoAtRisk: 0, kudos: 0, goalsCompliant: 0, goalsTotal: 0 };
        });
      }
      const g = seg[dim.key][grpName];
      g.headcount++;
      weeks.forEach(w => {
        const l = w.label;
        const c = g.weeks[l];
        if (!w.isFuture) {
          c.trackedHrs += (tracked[l] && tracked[l].byEmployee[norm]) || 0;
          const kd = kudos[l] && kudos[l].byEmployee[norm];
          c.kudos += kd ? kd.count : 0;
          const gd = goals[l] && goals[l].byEmployee[norm];
          if (gd) { c.goalsTotal++; if (gd.compliant) c.goalsCompliant++; }
        }
        if (!w.isPast) {
          c.plannedHrs += (planned[l] && planned[l].byEmployee[norm]) || 0;
        }
        const ph = pto[l] && pto[l].byEmployee[norm];
        if (ph) { if (ph.status === "Good") c.ptoGood++; else c.ptoAtRisk++; }
      });
    });
  });

  return seg;
}

// Computes top performers for the last completed (past) week.
// Returns { week, dateRange, performers[] } where each performer has
// { name, normName, keyLocation, supervisor, jobTitle, score, metrics }.
function buildTopPerformers_(employees, weeks, scoringCfg) {
  const pastWeeks  = weeks.filter(w => w.isPast);
  const targetWeek = pastWeeks.length > 0
    ? pastWeeks[pastWeeks.length - 1]
    : weeks.find(w => w.isCurrentWeek);
  if (!targetWeek) return { week: null, dateRange: null, performers: [] };

  // Per-employee weights: Family×Level matrix cell via the Job Catalog,
  // falling back to the flat base weights (see weightsForEmployee_).
  const cfg = scoringCfg || {};
  const matrix  = cfg.matrix  || {};
  const catalog = cfg.catalog || new Map();
  const baseW   = cfg.base    || DEFAULT_WEIGHTS_;
  const audit   = cfg.audit   || null;

  const scored = employees
    .filter(e => !e.isRampUp)
    .map(e => {
      const wd = e.weeks && e.weeks[targetWeek.label];
      if (!wd) return null;

      const W = weightsForEmployee_(e, matrix, catalog, baseW, audit);

      const trackedTarget = (wd.plannedHrs !== null && wd.plannedHrs > 0) ? wd.plannedHrs * CONFIG_PS.SCORE_TRACKED_RATIO : CONFIG_PS.DEFAULT_TARGET_WEEKLY_HRS;
      const trackedNorm = wd.trackedHrs !== null ? Math.min(1, wd.trackedHrs / trackedTarget) : 0;
      const plannedNorm = wd.plannedHrs !== null ? Math.min(1, wd.plannedHrs / CONFIG_PS.SCORE_PLANNED_CAP_HRS) : 0;
      const goalsNorm   = (wd.goalsDetail && wd.goalsDetail.compliant) ? 1 : 0;
      const rcrNorm     = (e.rcr && e.rcr.value !== null) ? Math.min(1, e.rcr.value / CONFIG_PS.RCR_HEALTHY) : null;
      // Kudos: 50% for receiving any, 50% for giving any → full credit when both
      const kudosRecv = wd.kudos && wd.kudos.count > 0;
      const kudosGave = wd.kudos && (wd.kudos.givenCount || 0) > 0;
      const kudosNorm = (kudosRecv ? 0.5 : 0) + (kudosGave ? 0.5 : 0);
      // SI: 1–5 scale → 0–1 by dividing by 5 (score 5 = full 100%, score 1 = 20%)
      const siNorm      = (e.si && e.si.value != null) ? e.si.value / CONFIG_PS.SI_MAX_SCORE : null;
      // PTO: binary Good = 1, At Risk = 0; excluded when no health snapshot
      const ptoNorm     = wd.ptoHealth ? (wd.ptoHealth.status === "Good" ? 1 : 0) : null;

      let availW = W.goals + W.tracked + W.planned + W.kudos;
      let earned = goalsNorm * W.goals + trackedNorm * W.tracked + plannedNorm * W.planned + kudosNorm * W.kudos;

      if (rcrNorm !== null) { availW += (W.rcr || 0); earned += rcrNorm * (W.rcr || 0); }
      if ((W.si  || 0) > 0) { availW += W.si;  earned += (siNorm  !== null ? siNorm  : 0) * W.si;  }
      if ((W.pto || 0) > 0) { availW += W.pto; earned += (ptoNorm !== null ? ptoNorm : 0) * W.pto; }

      const score = availW > 0 ? Math.round((earned / availW) * 100) : 0;

      return {
        name:        e.name,
        normName:    e.normName,
        keyLocation: e.keyLocation,
        supervisor:  e.supervisor,
        jobTitle:    e.jobTitle,
        score,
        metrics: {
          goalsNorm,   goalsOk:    goalsNorm === 1,
          trackedNorm, trackedHrs: wd.trackedHrs,
          plannedNorm, plannedHrs: wd.plannedHrs,
          rcrNorm,     rcrVal:     e.rcr ? e.rcr.value : null,
          kudosNorm,   kudosCount: wd.kudos ? (wd.kudos.count || 0) : 0,
          kudosGivenCount: wd.kudos ? (wd.kudos.givenCount || 0) : 0,
          siNorm,      siVal:      e.si ? e.si.value : null,
          ptoNorm,     ptoStatus:  wd.ptoHealth ? wd.ptoHealth.status : null,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG_PS.TOP_PERFORMERS_MAX);

  Logger.log(`Top Performers (${targetWeek.label}): ${scored.length} scored. ` +
    scored.slice(0, 5).map(p => `${p.name}:${p.score}`).join(", "));

  return { week: targetWeek.label, dateRange: targetWeek.dateRange, performers: scored };
}

// ── FTE filter helpers — derive FTE subsets from full reads without re-hitting sheets ──

// Filters a kudos result map to a given employee subset and re-aggregates totals.
function filterKudosBySubset_(kudosAll, subset) {
  const result = {};
  for (const [wk, b] of Object.entries(kudosAll)) {
    let c = 0, g = 0;
    const byEmp = {};
    for (const [norm, v] of Object.entries(b.byEmployee || {})) {
      if (!subset.has(norm)) continue;
      byEmp[norm] = v;
      c += (v.count      || 0);
      g += (v.givenCount || 0);
    }
    result[wk] = { count: c, givenCount: g, byEmployee: byEmp };
  }
  return result;
}

// Filters a tracked/planned time result map to a given employee subset.
function filterTimeBySubset_(timeAll, subset) {
  const result = {};
  for (const [wk, b] of Object.entries(timeAll)) {
    // Skip meta keys (e.g. _lastExport) and any null/non-week entry so a stray
    // attached property can't crash the per-week aggregation below.
    if (wk.charAt(0) === '_' || !b || typeof b !== 'object' || !b.byEmployee) continue;
    let totalHrs = 0, headcount = 0;
    const byEmp = {};
    for (const [norm, hrs] of Object.entries(b.byEmployee || {})) {
      if (!subset.has(norm)) continue;
      byEmp[norm] = hrs;
      totalHrs   += hrs;
      headcount++;
    }
    result[wk] = { totalHrs, headcount, byEmployee: byEmp, byEmployeeProjects: b.byEmployeeProjects || {} };
  }
  return result;
}

// Filters a goals result map to a given employee subset and re-aggregates compliance counts.
// _weeklyCommenters is retained as-is (counts already use the full active set and are
// unlikely to include crew goals; re-computation would require re-reading the Goals sheet).
function filterGoalsBySubset_(goalsAll, subset) {
  const result = {
    _weeklyCommenters: goalsAll._weeklyCommenters || {},
    _audit: (goalsAll._audit || []).filter(e => subset.has(e.normName)),
  };
  for (const [wk, b] of Object.entries(goalsAll)) {
    if (wk === '_weeklyCommenters' || wk === '_audit') continue;
    let compliant = 0, total = 0;
    const byEmp = {};
    for (const [norm, v] of Object.entries(b.byEmployee || {})) {
      if (!subset.has(norm)) continue;
      byEmp[norm] = v;
      total++;
      if (v.compliant) compliant++;
    }
    result[wk] = { compliant, total, byEmployee: byEmp };
  }
  return result;
}

// ── PUBLIC HOLIDAY HELPERS ────────────────────────────────────────────────

function readPHData_() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const sh  = ss.getSheetByName(CONFIG_PS.SHEET_PH);
    if (!sh) return [];
    const rows = sh.getDataRange().getValues();
    const out  = [];
    for (let i = 1; i < rows.length; i++) {
      const [rawDate, location, holiday] = rows[i];
      if (!rawDate || !location || !holiday) continue;
      const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(d)) continue;
      out.push({
        date:     Utilities.formatDate(d, "UTC", "yyyy-MM-dd"),
        location: String(location).trim(),
        holiday:  String(holiday).trim(),
      });
    }
    return out;
  } catch (e) {
    log_("⚠️ readPHData_: " + e.message);
    return [];
  }
}

function phLocMatchesEmp_(phLoc, empLoc) {
  const emp = (empLoc || "").toLowerCase().trim();
  if (!emp || emp === "unknown") return false;
  const parts = phLoc.split(/\s*[&\/]\s*|\s+and\s+/i)
                     .map(s => s.toLowerCase().trim())
                     .filter(Boolean);
  return parts.some(p => p === emp || p.includes(emp) || emp.includes(p));
}

function buildPHByWeek_(phData, weeks, roster) {
  if (!phData.length) return {};
  const result = {};
  weeks.forEach(w => {
    const hits = phData.filter(ph => ph.date >= w.monday && ph.date <= w.sunday);
    if (!hits.length) return;

    const grouped = {};
    hits.forEach(ph => {
      const key = ph.location + "||" + ph.holiday;
      if (!grouped[key]) grouped[key] = { date: ph.date, location: ph.location, holiday: ph.holiday, affectedNames: [] };
    });

    roster.forEach((profile, _norm) => {
      Object.values(grouped).forEach(g => {
        if (phLocMatchesEmp_(g.location, profile.keyLocation)) {
          g.affectedNames.push(profile.name);
        }
      });
    });

    const entries = Object.values(grouped).map(g => ({
      date:          g.date,
      location:      g.location,
      holiday:       g.holiday,
      affectedNames: g.affectedNames,
      affectedCount: g.affectedNames.length,
    })).filter(e => e.affectedCount > 0);

    if (entries.length) {
      const totalAffected = new Set(entries.flatMap(e => e.affectedNames)).size;
      result[w.label] = { entries, totalAffected };
    }
  });
  return result;
}

// ── PTO-ADJUSTED PLANNED TIME HELPERS ────────────────────────────────────────

// Aggregates PTO usage transactions (from ptoProfiles) into a per-week map.
// ptoProfiles: map of empNum → { transactions: [{date, isUsage, amount}] }
// empNumToNorm: Map(empNum → normName) from rosterIdMap_(roster, 'employeeNumber')
// weeks: rolling window weeks array (each with .label)
function buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, weeks) {
  const result  = {};
  const weekSet = new Set(weeks.map(w => w.label));
  weeks.forEach(w => { result[w.label] = { byEmployee: {} }; });

  if (!ptoProfiles) return result;
  Object.entries(ptoProfiles).forEach(([empNum, profile]) => {
    const normName = empNumToNorm.get(String(empNum));
    if (!normName) return;
    const txs = (profile && profile.transactions) || [];
    txs.forEach(tx => {
      if (!tx.isUsage || !tx.amount || !tx.date) return;
      const d = tx.date instanceof Date ? tx.date : new Date(tx.date);
      if (isNaN(d)) return;
      const wKey = `${isoWeekYear_PS_(d)}.W${isoWeekNum_PS_(d)}`;
      if (!weekSet.has(wKey)) return;
      result[wKey].byEmployee[normName] = (result[wKey].byEmployee[normName] || 0) + Math.abs(tx.amount);
    });
  });
  return result;
}

// Returns a new planned-data object (same shape as plannedAll) with PTO usage subtracted.
// Adds ptoByEmployee map per week for the separated PTO portion.
function subtractPTOFromPlanned_(plannedAll, ptoUsageByWeek) {
  const out = {};
  Object.keys(plannedAll).forEach(wLabel => {
    const src  = plannedAll[wLabel] || { totalHrs: 0, headcount: 0, byEmployee: {} };
    const ptos = (ptoUsageByWeek[wLabel] || {}).byEmployee || {};
    const netByEmp = {}, ptoByEmp = {};
    let totalNet = 0, hcNet = 0;

    Object.entries(src.byEmployee).forEach(([norm, hrs]) => {
      const ptoHrs  = ptos[norm]  || 0;
      const netHrs  = Math.max(0, hrs - ptoHrs);
      const ptoUsed = Math.min(hrs, ptoHrs);
      netByEmp[norm] = netHrs;
      if (ptoUsed > 0) ptoByEmp[norm] = ptoUsed;
      totalNet += netHrs;
      if (netHrs > 0) hcNet++;
    });

    out[wLabel] = {
      totalHrs:      totalNet,
      headcount:     hcNet,
      byEmployee:    netByEmp,
      ptoByEmployee: ptoByEmp,
      byEmployeeProjects: src.byEmployeeProjects || {},
    };
  });
  return out;
}

function getPSReportData(bustCache) {
  try {
    const access = checkDashboardAccess();

    if (!access.allowed) {
      return { ok: false, denied: true, email: access.email };
    }

    // ── CacheService — 5-min cache per user scope to reduce concurrent sheet reads ──
    const _sCache   = CacheService.getScriptCache();
    const _cacheVer = reportCacheVer_();
    const _cacheKey = (access.role === "admin" || access.role === "viewer")
      ? "ps_v" + _cacheVer + "_admin"
      : "ps_v" + _cacheVer + "_" + access.email;
    
    // Skip cache if bustCache=true (refresh button clicked)
    if (!bustCache) {
      const _hit = _sCache.get(_cacheKey);
      if (_hit) {
        try { return JSON.parse(_hit); } catch(ce) { /* corrupt entry — fall through to live read */ }
      }
    }

    const weights = readWeightSettings_();
    const weeks   = buildWeekWindow_PS_();
    const fullRoster = readPSRoster_();

    // ── Manager scope resolution ──────────────────────────────────────────────
    // Determines whether this user should see a subset of the roster.
    // Admin and Viewer see everything; Manager sees their org tree only.
    let managerNorm      = null;
    let managerScopeName = null;
    let roster           = fullRoster;

    if (access.role !== "admin" && access.role !== "viewer") {
      // All manager-role users arrive with delegateScopeName resolved by checkDashboardAccess().
      // Explicit delegates (Settings tab) and auto-detected roster supervisors both use this path.
      if (access.delegateScopeName) {
        managerNorm      = normPS_(access.delegateScopeName);
        managerScopeName = access.delegateScopeName;
        Logger.log(`Manager scope: ${access.email} → "${managerScopeName}" (norm: ${managerNorm})`);
      }

      if (managerNorm) {
        // Guard: confirm the scope anchor exists in the active roster or has direct reports.
        // Catches typo'd delegateScopeNames before they silently produce an empty dashboard.
        const scopeIsValid = fullRoster.has(managerNorm) ||
          [...fullRoster.values()].some(p => normPS_(p.supervisor) === managerNorm);
        if (!scopeIsValid) {
          Logger.log(`⚠️ Access denied — scope "${managerScopeName}" not found in active roster: ${access.email}`);
          return { ok: false, denied: true, email: access.email };
        }
        const scope = resolveManagerScope_(fullRoster, managerNorm);
        roster = new Map([...fullRoster].filter(([n]) => scope.has(n)));
        Logger.log(`Manager scope resolved: ${scope.size} employees in org tree of "${managerScopeName}"`);
      } else {
        Logger.log(`Access denied (no roster scope): ${access.email}`);
        return { ok: false, denied: true, email: access.email };
      }
    }

    const result = computePSReport_(access, roster, managerScopeName, weeks, weights);
    try { _sCache.put(_cacheKey, JSON.stringify(result), 300); } catch(ce) { /* payload >100 KB — skip cache */ }
    return result;
  } catch(e) {
    Logger.log(`❌ getPSReportData: ${e.message}\n${e.stack}`);
    return { ok: false, error: e.message };
  }
}

// All data reads, FTE filtering, and result assembly for getPSReportData.
// Called after access control and scope resolution; the caller handles caching.
function computePSReport_(access, roster, managerScopeName, weeks, weights) {
  // ── Active / FTE subset maps ──────────────────────────────────────────────
  const active      = activeRoster_(roster);
  const rampUpCount = roster.size - active.size;
  Logger.log(`PS Report (${access.role}): ${roster.size} total (${rampUpCount} ramp-up, ${active.size} active), window: ${weeks.map(w => w.label).join(", ")}`);
  if (rampUpCount > 0) {
    const names = [...roster.values()].filter(p => p.isRampUp).map(p => p.name).slice(0, 10);
    Logger.log(`Ramp-up employees: ${names.join(", ")}${rampUpCount > 10 ? " …" : ""}`);
  }

  const fteActive      = new Map([...active].filter(([, p]) => !p.isCrewMember));
  const fteRoster      = new Map([...roster].filter(([, p]) => !p.isCrewMember));

  // ── Reads that differ by roster scope: RCR, SI, PTO ───────────────────────
  // These compute weighted ratios or per-employee averages that cannot be derived
  // by simple subtraction, so both full-roster and FTE variants are read separately.
  // Single read each — byEmployee covers all active, team aggregates scope to FTE.
  const ctx    = computeFiscalContext_();
  const rcrAll = readRCR_PS_(active, fteActive, ctx);
  const siAll  = readSI_PS_(active, fteActive, ctx);

  const ptoProfiles = readPTOAccumulationProfiles_();   // shared (loaded once)
  const currentQWeeks = buildCurrentQWeeks_PS_(ctx);
  const ptoAllWeeks = currentQWeeks.concat(weeks.filter(w => w.isFuture));
  const ptoAll  = readPTOPlanningHealthByWeek_(roster,    ptoAllWeeks, ptoProfiles);
  const ptoFTE  = readPTOPlanningHealthByWeek_(fteRoster, weeks,   ptoProfiles);

  // ── Reads that are sum-decomposable: Kudos, Tracked, Planned, Goals ────────
  // Read once for the full roster/active set then filter to FTE in-process,
  // eliminating duplicate sheet API calls for these large data sources.
  const histWeeks    = buildHistWeeks_(CONFIG_PS.TRACKED_HIST_WEEKS);
  const extWeeks     = [...histWeeks, ...weeks];
  const extPastWeeks = extWeeks.filter(w => !w.isFuture);
  const currentQPastWeeks = currentQWeeks.filter(w => !w.isFuture);
  const ptoQ4FTE = readPTOPlanningHealthByWeek_(fteRoster, currentQPastWeeks, ptoProfiles);

  const kudosAll   = readKudosByWeek_(active,  extWeeks);
  const trackedAll = readTrackedTimeByWeek_(roster, extWeeks);
  const plannedAll = readPlannedTimeByWeek_(roster, extWeeks);
  // Goals: pass extPastWeeks so _weeklyCommenters is populated in this single read.
  const goalsAll   = readGoalsEngagement_(active, currentQWeeks, extPastWeeks, ctx);

  // Per-employee goal comment flags for Q4 historical weeks (for filter-aware frontend rendering)
  const goalsQ4Hist = {};
  currentQPastWeeks.forEach(w => {
    const wd = goalsAll[w.label];
    if (!wd || !wd.byEmployee) return;
    const byEmp = {};
    Object.entries(wd.byEmployee).forEach(([norm, gd]) => {
      byEmp[norm] = {
        selfCommentCount: gd.selfCommentCount || 0,
        g03Commented:     gd.g03Commented     || false,
        g01Commented:     gd.g01Commented     || false,
      };
    });
    goalsQ4Hist[w.label] = byEmp;
  });

  // Subtract PTO usage hours from Tempo planned time to get net project-planned hours.
  // ptoProfiles has transactions keyed by empNum; rosterIdMap_ bridges to normName.
  const empNumToNorm  = rosterIdMap_(roster, 'employeeNumber');
  const ptoUsageByWk  = buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, extWeeks);
  const plannedAdjAll = subtractPTOFromPlanned_(plannedAll, ptoUsageByWk);

  const kudosFTE    = filterKudosBySubset_(kudosAll,    fteActive);
  const trackedFTE  = filterTimeBySubset_(trackedAll,   fteRoster);
  const plannedFTE  = filterTimeBySubset_(plannedAdjAll, fteRoster);
  const goalsFTE    = filterGoalsBySubset_(goalsAll,   fteActive);

  // ── Assembly ───────────────────────────────────────────────────────────────
  const phData        = readPHData_();
  const phByWeek      = buildPHByWeek_(phData, weeks, roster);
  const teamSummary   = buildTeamSummary_(weeks, rcrAll, siAll, ptoFTE, kudosFTE, trackedFTE, plannedFTE, goalsFTE);
  // currentQWeeks covers current-quarter history up to now — append rolling future weeks
  // so that per-employee planned hours for W+1 and W+2 are included in the employee table.
  const futureWeeks   = weeks.filter(w => w.isFuture);
  const employeeWeeks = futureWeeks.length ? currentQWeeks.concat(futureWeeks) : currentQWeeks;
  const employees     = buildEmployeeRows_(roster, employeeWeeks, rcrAll, siAll, ptoAll, kudosAll, trackedAll, plannedAdjAll, goalsAll);
  const fteEmployees  = employees.filter(e => !e.isCrewMember);

  // Family×Level scoring config: matrix + catalog resolve per-person weights;
  // `weights` (flat base) remains the universal fallback, so an unseeded
  // deployment scores exactly as before.
  const jobCatalog    = readJobCatalog_();
  const scoringMatrix = readScoringMatrix_();
  const weightAudit   = [];
  const topPerformers = buildTopPerformers_(fteEmployees, weeks,
    { matrix: scoringMatrix, catalog: jobCatalog, base: weights, audit: weightAudit });
  if (weightAudit.length) {
    Logger.log(`⚠️ Weight resolution misses: ${weightAudit.length} (${[...new Set(weightAudit.map(a => a.reason))].join(", ")})`);
  }

  const curWeek  = weeks.find(w => w.isCurrentWeek) || weeks[Math.floor(weeks.length / 2)];
  const curGoals = goalsFTE[curWeek.label] || { compliant: 0, total: 0 };

  const goalsComm = goalsFTE._weeklyCommenters || {};
  const fte = fteRoster.size || 1;
  const trackedHistory = extPastWeeks.map(w => {
    const d    = trackedFTE[w.label] || {};
    const p    = plannedFTE[w.label] || {};
    const k    = kudosFTE[w.label]   || {};
    const hrs  = d.totalHrs || 0;
    const hc   = d.headcount || 0;
    const phrs = p.totalHrs || 0;
    const phc  = p.headcount || 0;
    const comm = goalsComm[w.label] || { count: 0, countG03: 0, countG01: 0, total: 0, totalComments: 0, avgComments: 0 };
    return {
      label:                w.label,
      dateRange:            w.dateRange,
      isCurrentWeek:        w.isCurrentWeek,
      totalHrs:             hrs,
      headcount:            hc,
      avgHrs:               hc > 0 ? Math.round(hrs / hc * 10) / 10 : 0,
      commentedHC:          comm.count,
      commentedPct:         fte > 0 ? Math.round(comm.count  / fte * 100) : null,
      g03CommentedHC:       comm.countG03 || 0,
      g03CommentedPct:      fte > 0 ? Math.round((comm.countG03 || 0) / fte * 100) : null,
      g01CommentedHC:       comm.countG01 || 0,
      g01CommentedPct:      fte > 0 ? Math.round((comm.countG01 || 0) / fte * 100) : null,
      avgCommentsPerPerson: comm.avgComments || 0,
      totalComments:        comm.totalComments || 0,
      trackedPct:           Math.round(hc / fte * 100),
      plannedHrs:           phrs,
      plannedHC:            phc,
      avgPlannedHrs:        phc > 0 ? Math.round(phrs / phc * 10) / 10 : 0,
      plannedPct:           Math.round(phc / fte * 100),
      kudosCount:           k.count || 0,
    };
  });

  const ptoQ4History = currentQPastWeeks.map(w => {
    const d = ptoQ4FTE[w.label] || { goodCount: 0, atRiskCount: 0, total: 0, score: 0, byEmployee: {} };
    const byEmp = {};
    Object.entries(d.byEmployee).forEach(([norm, emp]) => { byEmp[norm] = emp.status; });
    return { label: w.label, good: d.goodCount, atRisk: d.atRiskCount, total: d.total, pct: d.score, isCurrent: w.isCurrentWeek, byEmp };
  });

  // Reflect when the source spreadsheet was last modified (data last entered), not when
  // this script ran. The file's Drive last-updated timestamp is the reliable signal —
  // a fixed cell would just hold a static header. Falls back to now if Drive is unavailable.
  let lastSheetEdit;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    lastSheetEdit = DriveApp.getFileById(ss.getId()).getLastUpdated().toISOString();
  } catch(e) { lastSheetEdit = new Date().toISOString(); }

  return {
    ok: true,
    userRole:         access.role,
    userEmail:        access.email,
    managerScopeName: managerScopeName || null,
    weeks,
    q4Weeks:          currentQWeeks,
    weights,
    headcount: fteRoster.size,
    teamSummary,
    employees,
    topPerformers,
    weightAudit,
    trackedHistory,
    ptoQ4History,
    goalsQ4Hist,
    goalsAudit: (goalsAll._audit || []).filter(e => fteActive.has(e.normName)),
    phByWeek,
    meta: {
      generatedAt:      new Date().toISOString(),
      lastSheetEdit,
      trackedTimeLastExport: trackedAll._lastExport || null,
      currentWeekLabel: curWeek.label,
      rcrLastMonth:     rcrAll.lastMonth,
      rcrTeamRCR:       rcrAll.teamRCR,
      rcrTier:          rcrAll.tier,
      siTeamAvg:        siAll.teamAvg,
      siTeamRounded:    siAll.teamAvg !== null ? Math.round(siAll.teamAvg) : null,
      siQuarter:        siAll.quarter || "",
      goalsQuarter:     ctx.goalsQuarter,
      fiscalContext:    ctx,
      rampUpCount:      [...fteRoster.values()].filter(p => p.isRampUp).length,
      activeCount:      fteActive.size,
      goalsCompliant:   curGoals.compliant,
      goalsTotal:       curGoals.total,
      trackedCurWeek:   (trackedFTE[curWeek.label] || {}).totalHrs || 0,
      trackedHCCurWeek: (trackedFTE[curWeek.label] || {}).headcount || 0,
      kudosCurWeek:     (kudosFTE[curWeek.label]   || {}).count    || 0,
      totalHeadcount:   roster.size,
      rcrHistory:       rcrAll.rcrHistory    || [],
      rcrByEmployee:    rcrAll.rcrByEmployee || {},
      siHistory:        siAll.siHistory      || [],
      siByEmployee:     siAll.byEmployeeQ    || {},
      siQuarters:       siAll.siQuarters     || [],
    },
  };
}

// ============================================================
// GEMINI NARRATIVE — called from the dashboard via google.script.run
// One-time setup: PropertiesService.getScriptProperties()
//                  .setProperty('GEMINI_API_KEY', '<your-key>');
// ============================================================
function callGeminiNarrative(prompt) {
  try {
    // Server-side authorization — this endpoint is callable directly via
    // google.script.run by anyone who can load the dashboard. Reject denied users
    // so a broad/open link can't drive the Gemini quota with arbitrary prompts.
    const access = checkDashboardAccess();
    if (!access.allowed) return { ok: false, error: 'Unauthorized.' };

    // Lightweight per-user rate limit: cap calls per rolling window to contain
    // cost/abuse if the link is shared widely. Keyed by email (or "anon" when the
    // session yields no email, e.g. Open Access cross-domain visitors).
    const GEM_RL_MAX    = 15;   // calls
    const GEM_RL_WINDOW = 60;   // seconds
    const rlCache = CacheService.getScriptCache();
    const rlKey   = 'gem_rl_' + (access.email || 'anon');
    const rlCount = parseInt(rlCache.get(rlKey) || '0', 10);
    if (rlCount >= GEM_RL_MAX) {
      return { ok: false, error: 'Rate limit reached — please wait a minute and try again.' };
    }
    rlCache.put(rlKey, String(rlCount + 1), GEM_RL_WINDOW);

    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY not set in Script Properties.' };

    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 3000, temperature: 0.45 },
    };
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const httpStatus = response.getResponseCode();
    const body       = response.getContentText();
    Logger.log(`Gemini HTTP ${httpStatus}: ${body.substring(0, 500)}`);

    const json = JSON.parse(body);

    // Surface API-level error (e.g. 400 invalid key, 429 quota, 404 bad model)
    if (json.error) {
      return { ok: false, error: `Gemini API error ${json.error.code || httpStatus}: ${json.error.message || body.substring(0, 200)}` };
    }

    // Surface prompt-level block (e.g. safety policy)
    const blockReason = json.promptFeedback?.blockReason;
    if (blockReason) {
      return { ok: false, error: `Gemini blocked prompt: ${blockReason}` };
    }

    const candidate    = json.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const text         = candidate?.content?.parts?.[0]?.text;

    if (!text) {
      return { ok: false, error: `Gemini returned no text (finishReason: ${finishReason || 'unknown'}, HTTP ${httpStatus})` };
    }
    if (finishReason === 'MAX_TOKENS') {
      return { ok: false, error: `Gemini response was cut off (hit token limit). Try again or reduce prompt size.` };
    }
    return { ok: true, text: text.trim() };
  } catch(e) {
    Logger.log(`❌ callGeminiNarrative: ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

// Unit test for project-context capture. Run in the GAS editor, or in Node
// (per the _test_weightsResolver convention — stub Logger if running standalone).
function _test_projectContext_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_projectContext_: " + msg); }

  // Fake Planned Time Tempo matrix: two-row stacked header + 3 project rows + TOTAL footer.
  // Ana is planned ACME(10/10), BETA(10/10), and NETSUITE time-off(8/8) across W14 + W15.
  const vals = [
    ["", "", "", "", "2026.W14", "2026.W15", ""],
    ["User", "Space", "Key", "Planned (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 20, 10, 10, 20],
    ["Ana Smith", "Beta Project", "BETA", 20, 10, 10, 20],
    ["Ana Smith", "Time off", "NETSUITE", 16, 8, 8, 16],
    ["TOTAL", "", "", 56, 28, 28, 56],
  ];
  const psNames = new Map([[normPS_("Ana Smith"), { name: "Ana Smith" }]]);
  const weeks = [{ label: "2026.W14" }, { label: "2026.W15" }];

  const res = buildPlannedResult_(vals, psNames, weeks, ["NETSUITE"]);
  const norm = normPS_("Ana Smith");

  // Total planned hours are UNCHANGED — they still include the NETSUITE time-off rows.
  assert_(res["2026.W14"].byEmployee[norm] === 28, "W14 total should be 28, got " + res["2026.W14"].byEmployee[norm]);

  // Project map EXCLUDES NETSUITE → exactly ACME + BETA.
  const projs = res["2026.W14"].byEmployeeProjects[norm] || {};
  const keys = Object.keys(projs).sort();
  assert_(keys.length === 2, "expected 2 project keys, got " + keys.join(","));
  assert_(keys[0] === "ACME" && keys[1] === "BETA", "expected ACME+BETA, got " + keys.join(","));
  assert_(projs.ACME === 10 && projs.BETA === 10, "expected 10h each, got ACME=" + projs.ACME + " BETA=" + projs.BETA);
  assert_(!("NETSUITE" in projs), "NETSUITE must be excluded from project map");

  Logger.log("✅ _test_projectContext_ passed");
}

// Regression: export with NO stacked ISO-label row — week columns are headed only
// by date ranges. Before the per-column date fallback, this read every value as 0
// (the "Time planned shows blank" bug). Week 14 Mon–Sun = Mar 30 – Apr 05 2026.
function _test_plannedDateHeadersOnly_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_plannedDateHeadersOnly_: " + msg); }

  const vals = [
    ["User", "Space", "Key", "Planned (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 20, 10, 10, 20],
    ["Ana Smith", "Beta Project", "BETA", 18, 9, 9, 18],
    ["TOTAL", "", "", 38, 19, 19, 38],
  ];
  const psNames = new Map([[normPS_("Ana Smith"), { name: "Ana Smith" }]]);
  const weeks = [{ label: "2026.W14" }, { label: "2026.W15" }];

  const res = buildPlannedResult_(vals, psNames, weeks, ["NETSUITE"], "Planned");
  const norm = normPS_("Ana Smith");

  assert_(res["2026.W14"].byEmployee[norm] === 19, "W14 should be 19 (date-header fallback), got " + res["2026.W14"].byEmployee[norm]);
  assert_(res["2026.W15"].byEmployee[norm] === 19, "W15 should be 19 (date-header fallback), got " + res["2026.W15"].byEmployee[norm]);
  assert_(res["2026.W14"].headcount === 1, "W14 headcount should be 1, got " + res["2026.W14"].headcount);

  Logger.log("✅ _test_plannedDateHeadersOnly_ passed");
}

function _test_trackedTimeMatrix_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_trackedTimeMatrix_: " + msg); }

  // Fake Tempo Tracked Time matrix: identical structure to Planned Time Tempo
  // Ana logged ACME(12/15), BETA(8/10), and NETSUITE time-off(5/5) across W14 + W15.
  const vals = [
    ["", "", "", "", "2026.W14", "2026.W15", ""],
    ["User", "Space", "Key", "Logged (hrs)", "Mar 30 - Apr 05 2026", "Apr 06 - Apr 12 2026", "Total (hrs)"],
    ["Ana Smith", "Acme Project", "ACME", 27, 12, 15, 27],
    ["Ana Smith", "Beta Project", "BETA", 18, 8, 10, 18],
    ["Ana Smith", "Time off", "NETSUITE", 10, 5, 5, 10],
    ["TOTAL", "", "", 55, 25, 30, 55],
  ];
  const psNames = new Map([[normPS_("Ana Smith"), { name: "Ana Smith" }]]);
  const weeks = [{ label: "2026.W14" }, { label: "2026.W15" }];

  const res = buildPlannedResult_(vals, psNames, weeks, CONFIG_PS.TRACKED_NONPROJECT_KEYS);
  const norm = normPS_("Ana Smith");

  // Total tracked hours include NETSUITE time-off
  assert_(res["2026.W14"].byEmployee[norm] === 25, "W14 total should be 25, got " + res["2026.W14"].byEmployee[norm]);
  assert_(res["2026.W15"].byEmployee[norm] === 30, "W15 total should be 30, got " + res["2026.W15"].byEmployee[norm]);

  // Project map EXCLUDES NETSUITE → exactly ACME + BETA
  const projs14 = res["2026.W14"].byEmployeeProjects[norm] || {};
  const projs15 = res["2026.W15"].byEmployeeProjects[norm] || {};
  
  assert_(Object.keys(projs14).length === 2, "W14 should have 2 projects, got " + Object.keys(projs14).length);
  assert_(projs14.ACME === 12, "W14 ACME should be 12h, got " + projs14.ACME);
  assert_(projs14.BETA === 8, "W14 BETA should be 8h, got " + projs14.BETA);
  assert_(!("NETSUITE" in projs14), "W14 NETSUITE must be excluded from project map");
  
  assert_(projs15.ACME === 15, "W15 ACME should be 15h, got " + projs15.ACME);
  assert_(projs15.BETA === 10, "W15 BETA should be 10h, got " + projs15.BETA);

  Logger.log("✅ _test_trackedTimeMatrix_ passed");
}
