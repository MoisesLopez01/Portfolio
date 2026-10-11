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

  SHEET_ROSTER:      "Data",   // roster tab name — matches goalCompliance.js / Contribution Report.js (tab was renamed from "Roster")
  SHEET_CONTRACTORS: "Contractors Data",   // crew/contractor tab in the same Roster SS — same headers as Data
  SHEET_RCR:         "3. RCR",
  SHEET_SI:          "SI",
  SHEET_KUDOS:       "Kudos_Normalized",

  // PTO Planning Health — external accumulation spreadsheet
  PTO_ACCUM_SS_ID:            "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:            "Accumulation Cost",
  PTO_BALANCE_THRESHOLD:      100,   // hours — at or below = automatically Good
  PTO_PLANNING_HORIZON_MONTHS: 6,    // look-ahead window for a Usage planning signal
  PTO_TEAM_TARGET_PCT:        80,    // celebrate at this team-level score
  PTO_IMPACT_THRESHOLD_HRS:   8,     // >= this much weekly PTO triggers the Exec Brief note
                                      // and excludes the employee from Radar's tracked/planned
                                      // compliance denominators for that week
  PTO_FULL_WEEK_HRS:          40,    // >= this much weekly PTO exempts Goals rule 3 (self-comment
                                      // pacing) for that week only
  PTO_MIN_TARGET_HRS:         0,     // floor for ptoAdjustedTargetHrs — never negative
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
  SALES_DEPT:        "Sales",   // 2026.W36: a PS-class row HRIS moved to this Department belongs to Sales & Success (teamForProfile_)
  GOALS_MIN_COUNT:          8,     // minimum goals to be evaluated (quarter target is 10, 8 completed)
  GOALS_MIN_IN_PROGRESS_PCT: 0.50, // majority of goals must be "In Progress" (not Planned/Completed)
  GOALS_ACTIVE_COMMENT_COUNT: 6,   // goals that must have a self-comment within the evaluated week
  // STF (Sustained Top Form) reward thresholds — mirrors goalCompliance.js CONFIG_GD so the
  // "all goals closed" note in Team Members can state whether the rocketeer qualified. Used only
  // for that informational note; does not affect weekly goal compliance (Rules 1–3).
  STF_MIN_COMPLETED: 8,            // completed goals required for STF
  STF_MIN_CMT_GOALS: 6,            // completed goals needing STF_MIN_COMMENTS+ total comments
  STF_MIN_COMMENTS:  8,            // minimum total comments (self + manager) per goal for STF
  GOALS_GRACE_DAYS:  21,   // 3 weeks — Goals-only transition window after a new fiscal quarter starts.
                           // No other metric (RCR, SI, PTO, Tracked, Planned, Kudos) is fiscal-scoped,
                           // so none of them use this constant.
  RCR_HISTORY_MONTHS: 12,  // trailing months shown in the RCR Monthly Trends chart — rolls across
                           // fiscal-year boundaries instead of resetting to blank each new FY.

  WEEKS_PAST:        5,
  WEEKS_FUTURE:      2,
  TRACKED_HIST_WEEKS: 41,  // extra completed weeks before W-2 in trackedHistory — sized so the
                           // window always spans THREE full fiscal quarters (39 weeks + boundary
                           // slack): the Performance Record tab reads tracked/planned/kudos for
                           // 2 closed quarters + QTD (spec 2026-08-18 §3).

  // Ramp-up exclusion: employees hired within this many months are excluded from
  // RCR, SI, Goals, and Kudos team metrics (but still included in Tracked/Planned/PTO).
  // A "Ramp-Up" column in the Roster can override: "No" graduates early, "Yes" forces exclusion.
  RAMP_UP_MONTHS:    3,
  RAMP_UP_FLAG_COL:  "Ramp-Up",

  // Interns are not evaluated as employees — dropped from the roster entirely (like
  // inactive rows), so they never reach any team metric, headcount, or aggregate.
  // Every intern job title is the "I1" track level and carries the word "Intern"
  // (e.g. "09.I1.1 - Intern, Professional Services", "09.I1.3 - Intern Engineer,
  // Service Delivery"). The word-boundary match avoids false hits like "Internal".
  EXCLUDE_INTERNS:      true,
  INTERN_TITLE_PATTERN: /\bintern\b/i,

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

  // Report cache sizing (see cachePutLarge_ / warmReportCache). TTL must exceed the
  // warm interval so the shared entry never lapses between warmer runs; the Refresh
  // button always bypasses it. WARM interval must be a value ScriptApp accepts for
  // everyMinutes(): 1, 5, 10, 15, or 30.
  CACHE_TTL_SEC:        3900,    // 65 min
  CACHE_WARM_EVERY_MIN:   30,
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

// ── Large-payload cache (gzip + chunking) ──────────────────────────────────
// CacheService rejects any value over 100 KB, and the report payload passed that
// long ago — a plain cache.put() fails silently, which is why every load used to
// be a cold multi-minute compute. These helpers gzip the JSON (~10× smaller) and
// split whatever remains across numbered chunk keys, lifting the effective
// ceiling from 100 KB to several MB — headroom for adding Sales / Success /
// Non-Contributor rosters later. A `<key>_meta` entry stores the chunk count;
// a missing chunk on read (partial eviction) is treated as a clean cache miss.
const CACHE_CHUNK_BYTES_ = 90 * 1024; // per-chunk size — margin under the 100 KB cap

function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    const b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    const entries = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    log_(`cachePutLarge_: ${key} — ${str.length} chars → ${b64.length} b64 in ${n} chunk(s)`);
    return true;
  } catch(e) {
    Logger.log(`⚠️ cachePutLarge_ (${key}): ${e.message}`);
    return false;
  }
}

function cacheGetLarge_(cache, key) {
  try {
    const meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    const names = [];
    for (let i = 0; i < meta; i++) names.push(key + "_" + i);
    const got = cache.getAll(names);
    let b64 = "";
    for (let i = 0; i < meta; i++) {
      const part = got[key + "_" + i];
      if (!part) return null; // a chunk expired/evicted — treat the whole entry as a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch(e) {
    Logger.log(`⚠️ cacheGetLarge_ (${key}): ${e.message}`);
    return null;
  }
}

// ── Cache warmer ────────────────────────────────────────────────────────────
// Runs on the time-driven trigger installed by setupCacheWarmer(). Triggers
// execute as the installing owner (an admin), so getPSReportData(true) computes
// the full admin-scope payload and rewrites the shared ps_v<VER>_admin entry —
// admins and viewers then load from warm cache in seconds instead of waiting
// out the cold compute. Manager-scoped entries still warm on their first load
// and stay warm for CACHE_TTL_SEC. The Refresh button always bypasses cache.
function warmReportCache() {
  // Reachable via google.script.run like every other global. getPSReportData
  // enforces access on its own, so nothing leaks here — but a forced uncached
  // rebuild is the most expensive call in the project, and letting any caller
  // trigger it on demand is a quota tap. Trigger runs have no active user, so an
  // empty email is the trigger itself and must pass.
  const access = checkDashboardAccess();
  if (access.email && !hasAdminPower_(access)) {
    Logger.log(`⚠️ warmReportCache blocked for ${access.email} (${access.role})`);
    return { ok: false, error: "Admin access required" };
  }
  // One call rebuilds EVERY admin-scope team entry: getPSReportData's
  // team-warm loop (with the execution-scoped sheet memo) builds the other
  // teams in the same execution at in-memory cost. Per-team timing arrives
  // via the ✅ team-warm[...] log lines.
  const s0 = Date.now();
  const res = getPSReportData(true, "services");
  const secs = Math.round((Date.now() - s0) / 1000);
  if (res && res.ok) Logger.log(`✅ warmReportCache: all admin team entries rebuilt in ${secs}s`);
  else Logger.log(`❌ warmReportCache after ${secs}s: ${(res && res.error) || "denied/unknown"}`);
}

// One-time setup — run manually from the GAS editor as the dashboard owner.
// Replaces any existing warmer trigger, so it is safe to re-run after changing
// CONFIG_PS.CACHE_WARM_EVERY_MIN.
function setupCacheWarmer() {
  // Every non-underscore function in a GAS project is reachable via
  // google.script.run by anyone who can load the web app, so "run this from the
  // editor" is a convention, not a control. This one installs a time trigger
  // owned by the deployment owner — gate it like any other write.
  const access = checkDashboardAccess();
  if (!hasAdminPower_(access)) {
    Logger.log(`⚠️ setupCacheWarmer blocked for ${access.email} (${access.role})`);
    return { ok: false, error: "Admin access required" };
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "warmReportCache")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("warmReportCache")
    .timeBased()
    .everyMinutes(CONFIG_PS.CACHE_WARM_EVERY_MIN)
    .create();
  Logger.log(`✅ Cache warmer installed — every ${CONFIG_PS.CACHE_WARM_EVERY_MIN} min, TTL ${CONFIG_PS.CACHE_TTL_SEC}s`);
  return { ok: true, everyMinutes: CONFIG_PS.CACHE_WARM_EVERY_MIN };
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
    // Read is open to every role; edit is Super Admin / Admin only (canEditScoring_).
    const access = checkDashboardAccess();
    if (!access.allowed || !canEditScoring_(access)) return { ok: false, error: "Admin or Super Admin access required" };

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
// SCORING MATRIX — Team → Family × Level weights + Job Catalog
// Spec: ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md
//
// Team gates, family tunes: the employee's resolved team (TEAMS_ in PS Teams.js)
// hard-masks which metrics can carry weight and picks the blank-cell fill
// defaults; the family × level matrix cell tunes within that.
//
// Resolution order per employee (weightsForEmployee_):
//   emp.team → Job Catalog hit → matrix[team][family][levelKey]
//   → family ALL cell → team catch-all (ALL/ALL)
//   → blockFillBase_(team, family, base) → mask to team.metrics.
// Blank cells inherit blockFillBase_; the company default for Services natives
// remains the flat base weights (readWeightSettings_) → DEFAULT_WEIGHTS_.
// ============================================================

const SCORING_MATRIX_SHEET_ = "PS Scoring Matrix";
const JOB_CATALOG_SHEET_    = "Job Catalog";
const WEIGHT_METRICS_       = ["goals", "tracked", "planned", "rcr", "kudos", "si", "pto"];
const LEVEL_COLS_ = ["I1","I2","I3","I4","I5","I6","I7","I8","M4","M5","M6","M7","M8","M9","M10"];

// Contributor model (2026-07-09 team alignment):
// scoring groups follow the org team toggle (TEAMS_ in PS Teams.js). The employee's
// resolved team decides which metrics can carry weight (hard mask) and which
// fill-defaults blank cells inherit; the family × level matrix cell tunes within that.
// Spec: ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md
// JF018 left this list in 2026.W36: Solution Architecture moved to Sales & Success
// (HRIS Department "Sales"), so it is a Sales family now, not a Services native.
const PS_TEAM_FAMILIES_ = ["JF007", "JF008", "JF009"];
const COE_FAMILY_CODE_  = "JF004"; // Sales & Success family (also drives teamForProfile_)
const SA_FAMILY_CODE_   = "JF018"; // Solution Architecture — Sales & Success since 2026.W36, in ANY Class (teamForProfile_)
// Time-tracking mandate (ALLOWLIST, not blocklist — spec 2026-08-02 §3.1).
// Only these families are held to a planning/tracking standard. Everyone else in
// the Services roster (JF008 Training, JF015 Operations, JF017 IT, JF018 Solution
// Architecture, and the embedded operational families) belongs to the team but
// never impacts time metrics, even when some of them do plan and track.
// An unresolvable family and crew are tracking-REQUIRED: a bad job title must
// never grant an exemption, and a Tempo schedule implies the expectation.
const TRACKING_FAMILIES_ = ["JF007", "JF009"];
// "ALL" doubles as the per-team uncatalogued catch-all family code AND the
// block-wide level column now valid on any family block (a level cell beats it).
const ALL_KEY_ = "ALL";
// R&D team defaults — also the policy fill for operational families embedded in
// the Services team (Finance, People, Ops, IT, …): a reset must never re-enable
// tracked/planned/RCR for roles with no time data.
const RND_DEFAULT_W_   = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
// Sales & Success defaults — own constant so the HubSpot phase can re-weight it
// without touching R&D. Seeded with the same values on purpose.
const SALES_DEFAULT_W_ = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
// Pre-Team-column sheet-schema codes; only migrateLegacyMatrix_ still knows them.
const LEGACY_SERVICES_CODE_   = "SERVICES";
const LEGACY_NONCONTRIB_CODE_ = "NONCONTRIB";

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

// Roster/NetSuite job titles may embed the job code ("04.I2.5 - Associate, …"),
// and so may hand-entered Job Catalog rows. Strip a leading code prefix before
// normalizing so catalog and roster match on the clean title whichever side
// carries the prefix. No prefix → identical to normPS_.
function normTitleKey_(title) {
  return normPS_(String(title || "").replace(/^\s*\d+\.[IMim]\d+\.\d+\s*[-–—]\s*/, ""));
}

// A code-prefixed title carries the catalog facts itself (family/track/level).
// Used as a fallback when the Job Catalog sheet lookup misses, so e.g.
// "04.I5.3 - Senior Representative II, Account Management" resolves to JF004
// even with no matching catalog row.
function titleCodeInfo_(title) {
  const m = /^\s*(\d+\.[IMim]\d+\.\d+)\s*[-–—]/.exec(String(title || ""));
  return m ? parseJobCode_(m[1].toUpperCase()) : null;
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

// Time-tracking mandate for one roster profile (spec 2026-08-02 §3.1). ALLOWLIST:
// only TRACKING_FAMILIES_ are held to a planning/tracking standard. Crew and any
// profile whose family cannot be resolved default to TRUE — an unmapped or
// malformed job title must never grant an exemption.
// `catalog` is the readJobCatalog_() Map; a missing/empty sheet leaves everyone
// tracking-required, i.e. exactly the pre-carve-out behavior.
function tracksTime_(profile, catalog) {
  if (profile && profile.isCrewMember) return true;
  const title = (profile && profile.jobTitle) || "";
  const hit = (catalog ? catalog.get(normTitleKey_(title)) : null) || titleCodeInfo_(title);
  if (!hit || !hit.family) return true;
  return TRACKING_FAMILIES_.indexOf(hit.family) !== -1;
}

// ── People-manager cohort (spec 2026-08-02 §6) ──────────────────────────────
// Managers ARE held to planning and tracking, but at their own bar: coaching,
// escalation, hiring and 1:1 time never lands in Tempo, so judging a manager on
// the IC yardstick (36h/week, 85% coverage) reads as blame for doing the job.
// The cohort is a UNION of two signals so neither shape of manager is missed:
//   • Job Catalog track "M" (or an M code embedded in the title) — the titular
//     manager who has no direct reports on the roster yet.
//   • Named as the Supervisor of ≥1 roster member — the I-track lead who does
//     manage people and would otherwise be scored as an IC.
// Mirrors CompDash's two classification methods (parseLevel_ track + span of
// control) so headcount analysis and this brief count the same population.

// Norm-names that ≥1 other roster member reports to. Self-supervision and
// supervisors who are not themselves on the roster (skip-levels outside the
// scope, "Unknown") are ignored — they can't be judged by a brief they're not in.
function activeSupervisorNames_(roster) {
  const sups = new Set();
  if (!roster) return sups;
  roster.forEach((p, norm) => {
    const s = normPS_(p.supervisor || "");
    if (!s || s === "unknown" || s === norm) return;
    if (roster.has(s)) sups.add(s);
  });
  return sups;
}

// True when a profile belongs to the people-manager cohort. Crew members are
// never managers (they carry no supervisory scope and are already split out).
// An unresolvable title with no reports stays an IC — the same "never grant an
// exemption on bad data" default tracksTime_ uses.
function isPeopleManager_(profile, catalog, supervisorNorms) {
  if (!profile || profile.isCrewMember) return false;
  if (supervisorNorms && supervisorNorms.has(normPS_(profile.name))) return true;
  const title = (profile && profile.jobTitle) || "";
  const hit = (catalog ? catalog.get(normTitleKey_(title)) : null) || titleCodeInfo_(title);
  return !!(hit && String(hit.track || "").toUpperCase() === "M");
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
      out.set(normTitleKey_(title), {
        title, family, track, level, levelKey: track + level,
        group: iGroup !== -1 ? String(r[iGroup] || "").trim() : "",
        code:  iCode  !== -1 ? String(r[iCode]  || "").trim() : "",
      });
    });
    log_(`Job Catalog: ${out.size} titles loaded.`);
  } catch(e) { Logger.log(`⚠️ readJobCatalog_: ${e.message}`); }
  return out;
}

// Reads the scoring matrix sheet →
//   { [teamKey]: { [family|ALL]: { [levelKey|ALL]: { metric: weight } } } }.
// Blank cells are omitted (→ inherit blockFillBase_). Missing sheet → {}.
function readScoringMatrix_() {
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh || sh.getLastRow() < 2) return {};
    return parseScoringMatrix_(sh.getDataRange().getValues());
  } catch(e) { Logger.log(`⚠️ readScoringMatrix_: ${e.message}`); return {}; }
}

// Pure (Node-testable). Detects the schema by the Team header: new sheets nest by
// team; a legacy sheet (pre-Team-column) is parsed flat then mapped on read via
// migrateLegacyMatrix_, so scoring is correct before any admin opens the editor.
function parseScoringMatrix_(data) {
  const hdrs  = data[0].map(h => String(h).trim());
  const iTeam = hdrs.findIndex(h => h.toLowerCase() === "team");
  const iFam  = hdrs.findIndex(h => h.toLowerCase() === "family");
  const iMet  = hdrs.findIndex(h => h.toLowerCase() === "metric");
  if (iFam === -1 || iMet === -1) return {};
  const levelCols = [];
  hdrs.forEach((h, i) => { if (/^([IM]\d+|ALL)$/i.test(h)) levelCols.push({ idx: i, key: h.toUpperCase() }); });
  const known = {};
  TEAMS_.forEach(t => { known[t.key] = true; });
  const out = {}, flat = {};
  data.slice(1).forEach(r => {
    const fam = String(r[iFam] || "").trim().toUpperCase();
    const met = String(r[iMet] || "").trim().toLowerCase();
    if (!fam || WEIGHT_METRICS_.indexOf(met) === -1) return;
    let block;
    if (iTeam !== -1) {
      const team = String(r[iTeam] || "").trim().toLowerCase();
      if (!known[team]) {
        if (team) Logger.log(`⚠️ PS Scoring Matrix: unknown team "${team}" — row ignored`);
        return;
      }
      if (!out[team])      out[team] = {};
      if (!out[team][fam]) out[team][fam] = {};
      block = out[team][fam];
    } else {
      if (!flat[fam]) flat[fam] = {};
      block = flat[fam];
    }
    levelCols.forEach(c => {
      const raw = r[c.idx];
      if (raw === "" || raw === null || raw === undefined) return; // blank → inherit
      const v = parseFloat(raw);
      if (isNaN(v) || v < 0) return;
      if (!block[c.key]) block[c.key] = {};
      block[c.key][met] = v;
    });
  });
  return iTeam !== -1 ? out : migrateLegacyMatrix_(flat);
}

// Maps a legacy (pre-Team-column) flat matrix into the team-nested shape (spec §4).
// Legacy family×level cells applied company-wide, so non-PS families are copied to
// BOTH teams their members can sit in. Blocks are deep-copied so copies never alias.
function migrateLegacyMatrix_(flat) {
  const out = {};
  const put = (team, fam, block) => {
    if (!out[team]) out[team] = {};
    out[team][fam] = JSON.parse(JSON.stringify(block));
  };
  Object.keys(flat).forEach(fam => {
    if (fam === "DEFAULT") return; // retired block — company default is the flat base
    if (fam === LEGACY_SERVICES_CODE_) { put("services", ALL_KEY_, flat[fam]); return; }
    if (fam === LEGACY_NONCONTRIB_CODE_) {
      put("rnd", ALL_KEY_, flat[fam]);
      // Known simplification: catalogued embedded-ops members under Services now
      // fill from the policy defaults instead of this block — retune per family
      // under Services if this block carried overrides.
      Logger.log("ℹ️ Legacy NONCONTRIB/ALL mapped to the R&D catch-all only.");
      return;
    }
    if (PS_TEAM_FAMILIES_.indexOf(fam) !== -1) { put("services", fam, flat[fam]); return; }
    // JF004 and JF018 are Sales families that may still have PS-class members (JF004
    // by design; JF018 until HRIS finishes moving them) — a legacy block serves both.
    if (fam === COE_FAMILY_CODE_ || fam === SA_FAMILY_CODE_) { put("sales", fam, flat[fam]); put("services", fam, flat[fam]); return; }
    put("services", fam, flat[fam]); put("rnd", fam, flat[fam]);
  });
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

// Fill base for blank cells of a (team, family) block — the single place the
// per-team defaults rule lives (spec §2). `family` may be ALL_KEY_ (catch-all)
// or null (uncatalogued title, before the catch-all is consulted).
function blockFillBase_(teamKey, family, base) {
  if (teamKey === "rnd")   return RND_DEFAULT_W_;
  if (teamKey === "sales") return SALES_DEFAULT_W_;
  // Services: the tracking-mandated families, JF004, and the catch-all inherit the
  // flat base; every non-tracking family keeps the non-contributor policy. JF008 and
  // JF018 moved from the first group to the second on 2026-08-02 — they are Services
  // natives with no tracking mandate, so the flat base handed them tracked (30) and
  // planned (20) weight they can never earn.
  if (family === null || family === ALL_KEY_ ||
      TRACKING_FAMILIES_.indexOf(family) !== -1 || family === COE_FAMILY_CODE_) return base;
  return RND_DEFAULT_W_;
}

// Hard gate (spec §3): zero any weight on a metric outside the team's set. Returns
// the input object untouched when nothing needs zeroing, so the base-reference
// attach optimization in computePSReport_ survives.
function maskToTeamMetrics_(w, metrics) {
  let dirty = false;
  for (let i = 0; i < WEIGHT_METRICS_.length; i++) {
    const k = WEIGHT_METRICS_[i];
    if (metrics.indexOf(k) === -1 && (w[k] || 0) !== 0) { dirty = true; break; }
  }
  if (!dirty) return w;
  const o = {};
  WEIGHT_METRICS_.forEach(k => { o[k] = metrics.indexOf(k) === -1 ? 0 : (w[k] || 0); });
  return o;
}

// Resolves one employee's scoring weights (team gates, family tunes — spec §3).
// Pure given its inputs. matrix shape:
//   { [teamKey]: { [family|ALL]: { [levelKey|ALL]: { metric: weight } } } }
// `base` = flat company base weights (readWeightSettings_ result).
// `audit` (optional array) collects { name, jobTitle, reason } for Services misses.
function weightsForEmployee_(emp, matrix, catalog, base, audit) {
  const W = base || DEFAULT_WEIGHTS_;
  // Resolved team drives everything; the dept comparison remains as a legacy
  // fallback for callers that predate team tagging. Missing both → Services.
  const dept = (emp.dept || "").trim();
  const teamKey = emp.team || ((dept && dept !== CONFIG_PS.PS_DEPT) ? "rnd" : "services");
  const teamMx  = matrix[teamKey] || {};
  // Sheet lookup (code-prefix-insensitive), then the title's own embedded job
  // code as fallback — a prefixed title is self-describing even uncatalogued.
  const hit = catalog.get(normTitleKey_(emp.jobTitle || "")) || titleCodeInfo_(emp.jobTitle);
  // Hard gate on the time mandate (spec 2026-08-02 §4.5): someone with no tracking
  // obligation can never carry tracked/planned weight, even from a hand-edited
  // matrix row. Trusts the roster flag when set, else re-derives the same allowlist
  // rule from the catalog hit so the function stays self-contained for tests.
  // RCR joined the mask on 2026-08-05: the same families bill sporadically, so an
  // occasional RCR month must not score people the ratio was never asked of.
  const nonTracking = emp.tracksTime === false ||
    (emp.tracksTime === undefined && !emp.isCrewMember && !!hit && !!hit.family &&
     TRACKING_FAMILIES_.indexOf(hit.family) === -1);
  const metrics = nonTracking
    ? teamByKey_(teamKey).metrics.filter(m => m !== "tracked" && m !== "planned" && m !== "rcr")
    : teamByKey_(teamKey).metrics;
  if (!hit) {
    // Uncatalogued: Services titles are audit-worthy (the catch-all is a stopgap);
    // R&D / Sales uncatalogued titles are expected and route silently.
    if (teamKey === "services" && audit && catalog.size > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", reason: "unmapped-title" });
    }
    const ca   = (teamMx[ALL_KEY_] || {})[ALL_KEY_];
    const fill = blockFillBase_(teamKey, null, W);
    return maskToTeamMetrics_(ca ? fillWeights_(ca, fill) : fill, metrics);
  }
  const block = teamMx[hit.family] || {};
  const cell  = block[hit.levelKey] || block[ALL_KEY_] || null;
  const fill  = blockFillBase_(teamKey, hit.family, W);
  if (!cell) {
    // Audit only the tracking-mandated Services natives: embedded ops, JF004 and
    // the non-tracking families inherit their fill silently — a missing JF008 /
    // JF018 matrix cell is now the expected state, not a miss worth flagging.
    if (teamKey === "services" && TRACKING_FAMILIES_.indexOf(hit.family) !== -1 &&
        audit && Object.keys(matrix).length > 0) {
      audit.push({ name: emp.name, jobTitle: emp.jobTitle || "", family: hit.family,
        levelKey: hit.levelKey, reason: teamMx[hit.family] ? "level-missing" : "family-missing" });
    }
    return maskToTeamMetrics_(fill, metrics);
  }
  return maskToTeamMetrics_(fillWeights_(cell, fill), metrics);
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

// Seeds the scoring matrix with the per-(team, family) row structure but BLANK
// cells. Blanks inherit blockFillBase_ (flat base for Services natives / JF004 /
// catch-alls; policy defaults for embedded ops and the R&D / Sales teams), so a
// freshly-seeded deployment scores exactly as the resolver defaults and every
// block reads as "Inheriting" until an admin enters an explicit override.
// `famsByTeam` = { teamKey: [familyCode, …] } from the tagged roster (getScoringConfig).
function seedScoringMatrix_(famsByTeam) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
  if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
  sh.clearContents();
  const cols   = LEVEL_COLS_.concat([ALL_KEY_]);
  const header = ["Team", "Family", "Metric"].concat(cols);
  const rows   = [header];
  TEAMS_.forEach(t => {
    const mets = WEIGHT_METRICS_.filter(m => t.metrics.indexOf(m) !== -1);
    ((famsByTeam || {})[t.key] || []).concat([ALL_KEY_]).forEach(fam => {
      mets.forEach(met => rows.push([t.key, fam, met].concat(cols.map(() => ""))));
    });
  });
  sh.getRange(1, 1, rows.length, header.length).setValues(rows);
  const savedAt = new Date().toISOString();
  sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
  SpreadsheetApp.flush();
  Logger.log(`Scoring matrix seeded: ${rows.length - 1} rows across ${TEAMS_.length} team sections.`);
  return { rows: rows.length - 1, savedAt };
}

// The weights a (team, family) block scores with at `levelKey` — a level column, or
// ALL_KEY_ for the block-wide value a level without a cell of its own inherits. The
// ONE rule the ⚖️ Scoring Weights page (role rows AND their level fold) shares with
// weightsForEmployee_, so the page can never drift from what actually scores people:
// level cell → block ALL cell → blockFillBase_, then the hard team mask, and
// non-tracking families lose tracked/planned/RCR.
function resolveBlockWeights_(teamKey, family, levelKey, matrix, base) {
  const block = ((matrix || {})[teamKey] || {})[family] || {};
  const fill  = blockFillBase_(teamKey, family, base);
  const cell  = (levelKey !== ALL_KEY_ && block[levelKey]) || block[ALL_KEY_] || null;
  let metrics = teamByKey_(teamKey).metrics;
  if (family !== ALL_KEY_ && TRACKING_FAMILIES_.indexOf(family) === -1) {
    metrics = metrics.filter(m => m !== "tracked" && m !== "planned" && m !== "rcr");
  }
  return {
    weights: Object.assign({}, maskToTeamMetrics_(cell ? fillWeights_(cell, fill) : fill, metrics)),
    metrics: metrics.slice(),
  };
}

// What the ⚖️ Scoring Weights page shows for one (team, family) role row: the
// block-wide weights, the metrics the role may carry (the editor's input cells),
// how many level columns carry their own cell ("varies by level"), and — when the
// Job Catalog is passed — the role's `levels`: each catalog level with the job
// titles at that level and the weights it actually scores with. Titles are catalog
// rows, not people: a non-editor never learns who holds them or how many.
function familySummaryWeights_(teamKey, family, matrix, base, catalog) {
  const block = ((matrix || {})[teamKey] || {})[family] || {};
  const top   = resolveBlockWeights_(teamKey, family, ALL_KEY_, matrix, base);
  const out = {
    weights: top.weights,
    metrics: top.metrics,
    levelOverrides: Object.keys(block).filter(k => k !== ALL_KEY_ && Object.keys(block[k] || {}).length).length,
  };
  if (catalog && family !== ALL_KEY_) {
    const titles = {};
    catalog.forEach(e => {
      if (e.family !== family) return;
      (titles[e.levelKey] = titles[e.levelKey] || []).push(e.title);
    });
    out.levels = LEVEL_COLS_.filter(lk => titles[lk]).map(lk => ({
      key: lk,
      titles: titles[lk].sort(),
      weights: resolveBlockWeights_(teamKey, family, lk, matrix, base).weights,
      own: !!(block[lk] && Object.keys(block[lk]).length),   // carries its own cell
    }));
  }
  return out;
}

// Exported — scoring config for ⚖️ Scoring Weights. Every allowed role may read it
// (transparency, 2026.W41); `canEdit` (canEditScoring_ — Super Admin / Admin) unlocks
// the editor. Non-editors receive only the per-family summary (role weights plus the
// Job Catalog's levels and titles per role): no headcounts, no unmapped-title audit
// list, no raw matrix, and they never trigger the first-open sheet seeding (a write).
// Groups families under the org-team sections (spec §5): placement is driven by
// where active roster members sit, so a family spanning two teams appears under
// both. Seeds both sheets on first open so the feature bootstraps itself.
function getScoringConfig() {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed) return { ok: false, denied: true };
    const canEdit = canEditScoring_(access);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let seeded = false;
    if (canEdit && !ss.getSheetByName(JOB_CATALOG_SHEET_)) { seedJobCatalog_(); seeded = true; }

    const catalog = readJobCatalog_();

    // Tag the company-wide roster with teams (same rule as getPSReportData) and
    // count active non-crew members per (team, family) + uncatalogued per team.
    const roster = readPSRoster_();
    roster.forEach(p => { p.team = teamForProfile_(p, catalog); });
    const famCounts = {};   // { teamKey: { famCode: n } }
    const uncat     = {};   // { teamKey: n }
    const unmapped  = {};   // Services-team uncatalogued titles (audit list)
    roster.forEach(p => {
      if (p.isCrewMember) return;
      const hit = catalog.get(normTitleKey_(p.jobTitle)) || titleCodeInfo_(p.jobTitle);
      if (!hit) {
        uncat[p.team] = (uncat[p.team] || 0) + 1;
        if (p.team === "services") unmapped[p.jobTitle] = (unmapped[p.jobTitle] || 0) + 1;
        return;
      }
      if (!famCounts[p.team]) famCounts[p.team] = {};
      famCounts[p.team][hit.family] = (famCounts[p.team][hit.family] || 0) + 1;
    });

    if (canEdit && !ss.getSheetByName(SCORING_MATRIX_SHEET_)) {
      const famsByTeam = {};
      TEAMS_.forEach(t => { famsByTeam[t.key] = Object.keys(famCounts[t.key] || {}); });
      seedScoringMatrix_(famsByTeam);
      seeded = true;
    }

    const matrix = readScoringMatrix_();
    const base   = readWeightSettings_();
    const famName = {}, famIdx = {};
    ACTIVE_FAMILIES_.forEach((f, i) => { famName[f.code] = f.name; famIdx[f.code] = i; });

    const sections = TEAMS_.map(t => ({
      team: { key: t.key, label: t.label, metrics: t.metrics },
      families: Object.keys(famCounts[t.key] || {})
        .sort((a, b) => (famIdx[a] || 0) - (famIdx[b] || 0))
        .map(c => ({ code: c, name: famName[c] || c, count: famCounts[t.key][c],
                     fill: blockFillBase_(t.key, c, base) })),
      catchAll: { count: uncat[t.key] || 0, fill: blockFillBase_(t.key, ALL_KEY_, base) },
    }));
    sections.forEach(s => {
      s.families.forEach(f => Object.assign(f, familySummaryWeights_(s.team.key, f.code, matrix, base, catalog)));
      Object.assign(s.catchAll, familySummaryWeights_(s.team.key, ALL_KEY_, matrix, base));
    });

    if (!canEdit) {
      return {
        ok: true, canEdit: false, metrics: WEIGHT_METRICS_, baseWeights: base, levelCols: LEVEL_COLS_,
        sections: sections.map(s => ({
          team: s.team,
          families: s.families.map(f => ({ code: f.code, name: f.name, weights: f.weights, metrics: f.metrics,
                                           levelOverrides: f.levelOverrides, levels: f.levels })),
          catchAll: { weights: s.catchAll.weights, metrics: s.catchAll.metrics, levelOverrides: s.catchAll.levelOverrides },
        })),
      };
    }

    // Pre-create every rendered (team, family) block so the editor's save payload
    // replaces exactly the rendered blocks (merge semantics in saveScoringMatrix).
    sections.forEach(s => {
      if (!matrix[s.team.key]) matrix[s.team.key] = {};
      s.families.forEach(f => { if (!matrix[s.team.key][f.code]) matrix[s.team.key][f.code] = {}; });
      if (!matrix[s.team.key][ALL_KEY_]) matrix[s.team.key][ALL_KEY_] = {};
    });

    // Roles grouped per family/level for the editor's read-only reference rows.
    const rolesByFamily = {};
    catalog.forEach(e => {
      if (!rolesByFamily[e.family]) rolesByFamily[e.family] = { levels: {} };
      const fam = rolesByFamily[e.family];
      if (!fam.levels[e.levelKey]) fam.levels[e.levelKey] = [];
      fam.levels[e.levelKey].push({ title: e.title, group: e.group, code: e.code });
    });

    return {
      ok: true, canEdit: true, seeded, matrix, sections, rolesByFamily,
      levelCols:   LEVEL_COLS_,
      metrics:     WEIGHT_METRICS_,
      baseWeights: base,
      unmappedTitles: Object.keys(unmapped).map(t => ({ jobTitle: t, count: unmapped[t] })),
    };
  } catch(e) {
    Logger.log(`❌ getScoringConfig: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Exported — merges the editor payload over the stored matrix and rewrites the
// sheet in the Team-column schema, then busts the report cache.
// Merge semantics (spec §4): a (team, family) block present in the payload fully
// replaces the stored block (cell deletions stick); blocks the editor didn't
// render — family currently has no active members in that team — survive.
function saveScoringMatrix(payload) {
  try {
    const access = checkDashboardAccess();
    if (!access.allowed || !canEditScoring_(access)) return { ok: false, error: "Admin or Super Admin access required" };
    const incoming = payload && payload.matrix;
    if (!incoming || typeof incoming !== "object") return { ok: false, error: "Invalid payload" };

    const validFam = {};
    ACTIVE_FAMILIES_.forEach(f => { validFam[f.code] = true; });
    validFam[ALL_KEY_] = true;
    const validCol = {};
    LEVEL_COLS_.concat([ALL_KEY_]).forEach(lk => { validCol[lk] = true; });

    const merged = readScoringMatrix_();
    let dropped = 0;
    TEAMS_.forEach(t => {
      const inTeam = incoming[t.key];
      if (!inTeam || typeof inTeam !== "object") return;
      if (!merged[t.key]) merged[t.key] = {};
      Object.keys(inTeam).forEach(fam => {
        if (!validFam[fam]) return;
        const block = {};
        Object.keys(inTeam[fam] || {}).forEach(lk => {
          if (!validCol[lk]) return;
          Object.keys(inTeam[fam][lk] || {}).forEach(met => {
            if (WEIGHT_METRICS_.indexOf(met) === -1) return;
            if (t.metrics.indexOf(met) === -1) { dropped++; return; } // outside the team's set
            const v = parseFloat(inTeam[fam][lk][met]);
            if (isNaN(v)) return;
            if (!block[lk]) block[lk] = {};
            block[lk][met] = Math.max(0, Math.min(100, v));
          });
        });
        merged[t.key][fam] = block; // full replace — an emptied block clears the stored one
      });
    });
    if (dropped > 0) Logger.log(`⚠️ saveScoringMatrix: dropped ${dropped} weight(s) on metrics outside their team's metric set`);

    // Rewrite the sheet: TEAMS_ order; families in ACTIVE_FAMILIES_ order with the
    // catch-all last; only the team's metric rows.
    const famIdx = {};
    ACTIVE_FAMILIES_.forEach((f, i) => { famIdx[f.code] = i; });
    const cols   = LEVEL_COLS_.concat([ALL_KEY_]);
    const header = ["Team", "Family", "Metric"].concat(cols);
    const rows   = [header];
    TEAMS_.forEach(t => {
      const teamMx = merged[t.key] || {};
      const mets   = WEIGHT_METRICS_.filter(m => t.metrics.indexOf(m) !== -1);
      const fams   = Object.keys(teamMx).sort((a, b) => {
        if (a === ALL_KEY_) return 1;
        if (b === ALL_KEY_) return -1;
        return (famIdx[a] || 0) - (famIdx[b] || 0);
      });
      fams.forEach(fam => {
        mets.forEach(met => {
          const row = [t.key, fam, met];
          cols.forEach(lk => {
            const cell = teamMx[fam][lk];
            const raw  = cell ? cell[met] : undefined;
            row.push(raw === undefined || raw === null ? "" : raw);
          });
          rows.push(row);
        });
      });
    });
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(SCORING_MATRIX_SHEET_);
    if (!sh) sh = ss.insertSheet(SCORING_MATRIX_SHEET_);
    sh.clearContents();
    sh.getRange(1, 1, rows.length, header.length).setValues(rows);
    const savedAt = new Date().toISOString();
    sh.getRange(rows.length + 2, 1, 1, 2).setValues([["lastSaved", savedAt]]);
    SpreadsheetApp.flush();
    bustReportCache_(); // invalidate every cached scope (admin + manager) so scores refresh now
    return { ok: true, savedAt };
  } catch(e) {
    Logger.log(`❌ saveScoringMatrix: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Node test for the execution-scoped sheet memo (no GAS APIs).
// Run: node -e "const fs=require('fs');const src=fs.readFileSync('PS Teams.js','utf8')+'\n'+fs.readFileSync('PS Contribution Report.js','utf8');global.Logger={log:()=>{}};eval(src+'\n_test_sheetMemo();');"
function _test_sheetMemo() {
  let fetches = 0;
  const fakeSS = (id) => ({
    getId: () => id,
    getSheetByName: (name) => name === "missing" ? null : ({
      getDataRange: () => ({ getValues: () => { fetches++; return [["H1", "H2"], ["a", 1], ["b", 2]]; } }),
    }),
  });
  const results = [];
  const check = (label, cond) => { results.push(`${cond ? "✅" : "❌"} ${label}`); if (!cond) throw new Error(`_test_sheetMemo FAILED: ${label}\n${results.join("\n")}`); };

  const ss = fakeSS("memoTestA");
  const first = loadSheet_PS_(ss, "Tab1");
  check("first read fetches", fetches === 1 && first.rows.length === 2);
  const second = loadSheet_PS_(ss, "Tab1");
  check("second read memoized (no new fetch)", fetches === 1);
  first.rows[0][0] = "MUTATED";
  first.headers[0] = "MUTATED";
  const third = loadSheet_PS_(ss, "Tab1");
  check("mutation does not leak across accesses", third.rows[0][0] === "a" && third.headers[0] === "H1");
  loadSheet_PS_(ss, "Tab2");
  check("different sheet fetches separately", fetches === 2);
  check("missing sheet memoizes null", loadSheet_PS_(ss, "missing") === null && loadSheet_PS_(ss, "missing") === null);

  let produced = 0;
  const raw1 = memoSheetData_("memoTestB", () => { produced++; return [["X"], ["y"]]; });
  raw1[1][0] = "MUTATED";
  const raw2 = memoSheetData_("memoTestB", () => { produced++; return [["X"], ["y"]]; });
  check("memoSheetData_ produces once + row copies", produced === 1 && raw2[1][0] === "y");

  Logger.log(results.join("\n"));
  Logger.log("✅ _test_sheetMemo: all checks passed");
  return true;
}

// Manual test harness for the resolver (GAS editor or Node; logs PASS/FAIL).
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_weightsResolver(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_weightsResolver() {
  const base = { goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 };
  const catalog = new Map([
    [normPS_("Senior Consultant I, Technical Consulting"), { family: "JF009", track: "I", level: 4, levelKey: "I4" }],
    [normPS_("Associate, Solution Architecture"),          { family: "JF018", track: "I", level: 2, levelKey: "I2" }],
    [normPS_("Representative, Account Management"),        { family: "JF004", track: "I", level: 3, levelKey: "I3" }],
    [normPS_("Intern, Finance"),                           { family: "JF013", track: "I", level: 1, levelKey: "I1" }],
  ]);
  const RND_W   = { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 };
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const svc = (title, extra) => Object.assign({ name: "x", jobTitle: title, team: "services" }, extra || {});

  // 1. Services native, partial cell: explicit values win, blanks inherit the flat base
  const mx1 = { services: { JF009: { I4: { goals: 40, tracked: 20 } } } };
  check("svc-native-cell+inherit",
    weightsForEmployee_(svc("Senior Consultant I,  TECHNICAL consulting"), mx1, catalog, base),
    { goals: 40, tracked: 20, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });

  // 2. Tracking-mandated Services native, no cell → the base object BY REFERENCE
  //    (attach optimization — computePSReport_ relies on this identity check)
  check("svc-native-inherit-is-base-ref",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting"), {}, catalog, base) === base, true);

  // 2b. JF018 is a Services native with NO tracking mandate (2026-08-02): it moved
  //     off the flat base onto the embedded-ops policy, so tracked/planned are 0.
  check("jf018-non-tracking-policy",
    weightsForEmployee_(svc("Associate, Solution Architecture"), mx1, catalog, base), RND_W);
  // 2c. Hard mask: a hand-edited sheet row can never re-enable tracked/planned for
  //     a non-tracking family, no matter what the cell says.
  check("jf018-sheet-cell-cannot-re-enable-hours",
    weightsForEmployee_(svc("Associate, Solution Architecture"),
      { services: { JF018: { I2: { goals: 40, tracked: 30, planned: 30 } } } }, catalog, base),
    { goals: 40, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 });
  // 2d. The roster flag is authoritative when present — an exempt person keeps the
  //     mask even if their title resolves to a mandated family. RCR is masked
  //     alongside tracked/planned (2026-08-05): no billing obligation, no RCR weight.
  check("tracksTime-flag-overrides-family",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting", { tracksTime: false }), {}, catalog, base),
    { goals: 30, tracked: 0, planned: 0, rcr: 0, kudos: 5, si: 0, pto: 0 });

  // 3. Family ALL cell applies to every level; a specific level cell beats it
  check("family-all-cell",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting"),
      { services: { JF009: { ALL: { goals: 50, kudos: 10 } } } }, catalog, base),
    { goals: 50, tracked: 30, planned: 20, rcr: 15, kudos: 10, si: 0, pto: 0 });
  check("level-beats-family-all",
    weightsForEmployee_(svc("Senior Consultant I, Technical Consulting"),
      { services: { JF009: { ALL: { goals: 50, kudos: 10 }, I4: { goals: 44 } } } }, catalog, base),
    { goals: 44, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 });

  // 4. Embedded ops family under Services → policy fill; a partial cell can never
  //    re-enable tracked/planned/RCR (fills from the policy, not the base)
  check("svc-embedded-ops-policy",
    weightsForEmployee_(svc("Intern, Finance"), {}, catalog, base), RND_W);
  check("svc-embedded-ops-cell-fills-from-policy",
    weightsForEmployee_(svc("Intern, Finance"),
      { services: { JF013: { I1: { goals: 70, kudos: 30, si: 0, pto: 0 } } } }, catalog, base),
    { goals: 70, tracked: 0, planned: 0, rcr: 0, kudos: 30, si: 0, pto: 0 });

  // 5. JF004: a Services-team member still fills from the flat base, but the time
  //    mandate masks tracked/planned/RCR — account management is not a tracking
  //    family (allowlist consequence, spec 2026-08-02 §2.1; RCR joined the mask
  //    2026-08-05). Goals/Kudos survive. A Sales-team member fills from SALES_DEFAULT_W_.
  check("jf004-in-services-base-minus-hours",
    weightsForEmployee_(svc("Representative, Account Management"), {}, catalog, base),
    { goals: 30, tracked: 0, planned: 0, rcr: 0, kudos: 5, si: 0, pto: 0 });
  check("jf004-in-sales-defaults",
    weightsForEmployee_({ name: "s", jobTitle: "Representative, Account Management", team: "sales" }, {}, catalog, base),
    RND_W); // SALES_DEFAULT_W_ is seeded with the same values

  // 6. Split family: independent (services, JF013) and (rnd, JF013) cells
  const mx6 = { services: { JF013: { I1: { goals: 70, kudos: 30, si: 0, pto: 0 } } },
                rnd:      { JF013: { I1: { goals: 55, kudos: 15, si: 15, pto: 15 } } } };
  check("split-family-services-cell", weightsForEmployee_(svc("Intern, Finance"), mx6, catalog, base),
    { goals: 70, tracked: 0, planned: 0, rcr: 0, kudos: 30, si: 0, pto: 0 });
  check("split-family-rnd-cell",
    weightsForEmployee_({ name: "r", jobTitle: "Intern, Finance", team: "rnd" }, mx6, catalog, base),
    { goals: 55, tracked: 0, planned: 0, rcr: 0, kudos: 15, si: 15, pto: 15 });

  // 7. Hard mask: tracked weight hand-set on an (rnd, family) row → zeroed
  check("mask-zeroes-out-of-set-metric",
    weightsForEmployee_({ name: "r2", jobTitle: "Intern, Finance", team: "rnd" },
      { rnd: { JF013: { I1: { goals: 60, tracked: 40 } } } }, catalog, base),
    { goals: 60, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 });

  // 8. Uncatalogued per team → team catch-all (ALL/ALL) → team defaults;
  //    audit fires only for Services-team titles
  const audit = [];
  check("uncat-services-no-block",
    weightsForEmployee_(svc("Wizard, Hogwarts"), { services: {} }, catalog, base, audit) === base, true);
  check("uncat-services-audited", audit.length === 1 && audit[0].reason === "unmapped-title", true);
  check("uncat-services-catchall",
    weightsForEmployee_(svc("Wizard, Hogwarts"), { services: { ALL: { ALL: { goals: 50, kudos: 10 } } } }, catalog, base),
    { goals: 50, tracked: 30, planned: 20, rcr: 15, kudos: 10, si: 0, pto: 0 });
  const audit2 = [];
  check("uncat-rnd-defaults",
    weightsForEmployee_({ name: "u", jobTitle: "Totally Unknown", team: "rnd" }, {}, catalog, base, audit2), RND_W);
  check("uncat-rnd-catchall-fills-policy",
    weightsForEmployee_({ name: "u2", jobTitle: "Totally Unknown", team: "rnd" },
      { rnd: { ALL: { ALL: { goals: 60 } } } }, catalog, base, audit2),
    { goals: 60, tracked: 0, planned: 0, rcr: 0, kudos: 20, si: 20, pto: 20 });
  check("uncat-nonservices-not-audited", audit2.length, 0);
  check("uncat-sales-defaults",
    weightsForEmployee_({ name: "u3", jobTitle: "Mystery Seller", team: "sales" }, {}, catalog, base), RND_W);

  // 9. Legacy fallbacks: no team + non-Services dept → rnd path; neither → services
  check("legacy-dept-fallback-rnd",
    weightsForEmployee_({ name: "l", jobTitle: "Totally Unknown", dept: "Engineering" }, {}, catalog, base), RND_W);
  check("legacy-no-team-no-dept-services",
    weightsForEmployee_({ name: "l2", jobTitle: "Wizard, Hogwarts" }, {}, catalog, base) === base, true);

  // 10. Code-prefixed title self-describes (13 → JF013 → embedded-ops policy under services)
  check("code-prefix-selfdescribes",
    weightsForEmployee_(svc("13.M10.10 - Mystery Title"), {}, catalog, base), RND_W);

  // 11. Empty catalog → base, no audit noise
  const audit3 = [];
  weightsForEmployee_({ name: "e", jobTitle: "Anything", team: "services" }, {}, new Map(), base, audit3);
  check("empty-catalog-no-audit", audit3.length, 0);

  // 12. roleGroupFor_ / parseJobCode_ edges (unchanged)
  check("jf007-default-bucket", roleGroupFor_("JF007", "Intern, Managed Services"), "Customer Support");
  check("jf007-delivery",       roleGroupFor_("JF007", "Senior Consultant I, Delivery"), "Delivery");
  check("jf009-tc",             roleGroupFor_("JF009", "Principal, Solution Consulting"), "Technical Consulting");
  check("jf016-people",         roleGroupFor_("JF016", "Senior Manager, Total Rewards and HR Operations"), "People");
  check("parse-code",           parseJobCode_("13.M10.10"), { family: "JF013", track: "M", level: 10, levelKey: "M10" });

  Logger.log(results.join("\n"));
  return results;
}

// Time-mandate carve-out: allowlist resolution, long-leave matching, planned clamp.
// Spec: ps-dashboard/docs/specs/2026-08-02-ps-non-tracking-families-design.md
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_nonTrackingFlags(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_nonTrackingFlags() {
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const catalog = new Map([
    [normPS_("Senior Consultant I, Technical Consulting"), { family: "JF009", levelKey: "I4" }],
    [normPS_("Consultant, Managed Services"),              { family: "JF007", levelKey: "I3" }],
    [normPS_("Senior Trainer"),                            { family: "JF008", levelKey: "I4" }],
    [normPS_("Manager, Operations"),                       { family: "JF015", levelKey: "M4" }],
    [normPS_("Engineer, IT Operations"),                   { family: "JF017", levelKey: "I3" }],
    [normPS_("Associate, Solution Architecture"),          { family: "JF018", levelKey: "I2" }],
  ]);
  const p = (jobTitle, extra) => Object.assign({ jobTitle }, extra || {});

  // ── Allowlist: only JF007 / JF009 carry the mandate ──
  check("jf007-tracks",  tracksTime_(p("Consultant, Managed Services"), catalog), true);
  check("jf009-tracks",  tracksTime_(p("Senior Consultant I, Technical Consulting"), catalog), true);
  check("jf008-exempt",  tracksTime_(p("Senior Trainer"), catalog), false);
  check("jf015-exempt",  tracksTime_(p("Manager, Operations"), catalog), false);
  check("jf017-exempt",  tracksTime_(p("Engineer, IT Operations"), catalog), false);
  check("jf018-exempt",  tracksTime_(p("Associate, Solution Architecture"), catalog), false);

  // ── Fail-safe defaults: a bad title never grants an exemption ──
  check("unmapped-title-tracks", tracksTime_(p("Wizard, Hogwarts"), catalog), true);
  check("blank-title-tracks",    tracksTime_(p(""), catalog), true);
  check("empty-catalog-tracks",  tracksTime_(p("Senior Trainer"), new Map()), true);
  // Crew are tracking-required whatever their title says: a Tempo schedule is the
  // expectation (demand-dashboard parity).
  check("crew-always-tracks",    tracksTime_(p("Senior Trainer", { isCrewMember: true }), catalog), true);
  // A code-prefixed title self-describes even when uncatalogued.
  check("code-prefix-exempt",    tracksTime_(p("18.I6.2 - Solution Architect"), new Map()), false);
  check("code-prefix-tracks",    tracksTime_(p("09.I4.1 - Consultant"), new Map()), true);

  // ── Long leave: matched statuses stay on the roster, terminations still drop ──
  const leaveHit  = s => LONG_LEAVE_RE_.test(s);
  check("maternity-is-leave",   leaveHit("Maternity Leave"), true);
  check("paternity-is-leave",   leaveHit("Paternity Leave"), true);
  check("parental-is-leave",    leaveHit("On Parental Leave"), true);
  check("sabbatical-is-leave",  leaveHit("Sabbatical"), true);
  check("loa-is-leave",         leaveHit("Leave of Absence"), true);
  check("active-not-leave",     leaveHit("Active"), false);
  check("terminated-not-leave", leaveHit("Terminated"), false);

  // ── Planned clamp: capped at the weekly capacity left after PTO ──
  const clamp = (hrs, ptoHrs) => {
    const out = subtractPTOFromPlanned_(
      { "2026.W30": { byEmployee: { a: hrs } } },
      { "2026.W30": { byEmployee: { a: ptoHrs } } });
    return out["2026.W30"].byEmployee.a;
  };
  check("clamp-under-cap-untouched", clamp(32, 0), 32);
  check("clamp-at-cap",              clamp(40, 0), 40);
  check("clamp-tempo-duplication",   clamp(120, 0), 40);   // plan repeated across 3 projects
  check("clamp-pto-reduced-target",  clamp(40, 16), 24);   // 40 − 16 PTO = 24h capacity
  check("clamp-full-pto-week",       clamp(40, 40), 0);
  check("clamp-totals-match-clamped", (function() {
    const out = subtractPTOFromPlanned_(
      { "2026.W30": { byEmployee: { a: 120, b: 20 } } }, { "2026.W30": { byEmployee: {} } });
    return [out["2026.W30"].totalHrs, out["2026.W30"].headcount];
  })(), [60, 2]);

  Logger.log(results.join("\n"));
  return results;
}

// Manager/IC cohort classification (spec 2026-08-02 §6): union of Job Catalog
// track "M" and "supervises ≥1 roster member".
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_managerCohort(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_managerCohort() {
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  const catalog = new Map([
    [normPS_("Senior Consultant I, Technical Consulting"), { family: "JF009", track: "I", level: 4, levelKey: "I4" }],
    [normPS_("Manager, Managed Services"),                 { family: "JF007", track: "M", level: 4, levelKey: "M4" }],
    [normPS_("Director, Service Delivery"),                { family: "JF009", track: "M", level: 6, levelKey: "M6" }],
    [normPS_("Consultant, Managed Services"),              { family: "JF007", track: "I", level: 3, levelKey: "I3" }],
  ]);
  const mk = (name, jobTitle, supervisor, extra) =>
    Object.assign({ name, jobTitle, supervisor: supervisor || "Unknown" }, extra || {});

  // Roster: Dana is an M-title with reports; Eve is an M-title with none; Frank is
  // an I-title who supervises Grace; Grace and Hugo are plain ICs.
  const roster = new Map([
    [normPS_("Dana Reyes"), mk("Dana Reyes", "Director, Service Delivery",             "Unknown")],
    [normPS_("Eve Chan"),   mk("Eve Chan",   "Manager, Managed Services",              "Dana Reyes")],
    [normPS_("Frank Ito"),  mk("Frank Ito",  "Senior Consultant I, Technical Consulting", "Dana Reyes")],
    [normPS_("Grace Odu"),  mk("Grace Odu",  "Consultant, Managed Services",           "Frank Ito")],
    [normPS_("Hugo Vale"),  mk("Hugo Vale",  "Consultant, Managed Services",           "Eve Chan")],
  ]);
  const sups = activeSupervisorNames_(roster);
  const isM  = n => isPeopleManager_(roster.get(normPS_(n)), catalog, sups);

  check("supervisor-set", [...sups].sort(), ["dana reyes", "eve chan", "frank ito"]);
  check("m-title-with-reports",     isM("Dana Reyes"), true);
  check("m-title-without-reports",  isM("Eve Chan"),   true);   // titular manager still on the manager bar
  check("i-title-with-reports",     isM("Frank Ito"),  true);   // functional lead — never judged as an IC
  check("ic-no-reports",            isM("Grace Odu"),  false);
  check("ic-reports-to-manager",    isM("Hugo Vale"),  false);

  // ── Supervisor-set hygiene ──
  check("self-supervisor-ignored", [...activeSupervisorNames_(new Map([
    [normPS_("Solo Dev"), mk("Solo Dev", "Consultant, Managed Services", "Solo Dev")],
  ]))], []);
  check("offroster-supervisor-ignored", [...activeSupervisorNames_(new Map([
    [normPS_("Grace Odu"), mk("Grace Odu", "Consultant, Managed Services", "CEO Outside Scope")],
  ]))], []);
  check("unknown-supervisor-ignored", [...activeSupervisorNames_(new Map([
    [normPS_("Grace Odu"), mk("Grace Odu", "Consultant, Managed Services", "Unknown")],
  ]))], []);

  // ── Fail-safe defaults: bad data never promotes anyone off the IC bar ──
  check("uncatalogued-no-reports-is-ic",
    isPeopleManager_(mk("Wanda Wu", "Wizard, Hogwarts"), catalog, sups), false);
  check("blank-title-is-ic",
    isPeopleManager_(mk("Blank Person", ""), catalog, sups), false);
  check("empty-catalog-falls-back-to-reports",
    isPeopleManager_(roster.get(normPS_("Dana Reyes")), new Map(), sups), true);
  // No catalog row, no code prefix, no reports → nothing establishes the track, so
  // the profile stays an IC. Deliberate: inferring "manager" from the word in a
  // title would sweep in Account/Implementation Manager ICs and silently drop real
  // ICs off the IC bar. Anyone who genuinely manages people is caught by the
  // direct-reports signal instead, which needs no catalog at all.
  check("empty-catalog-no-reports-is-ic",
    isPeopleManager_(mk("Eve Chan", "Manager, Managed Services"), new Map(), new Set()), false);
  // A code-prefixed title self-describes even with no catalog row at all.
  check("code-prefix-m-track", isPeopleManager_(mk("Coded Mgr", "09.M6.1 - Director, Service Delivery"), new Map(), new Set()), true);
  check("code-prefix-i-track", isPeopleManager_(mk("Coded IC",  "09.I4.1 - Consultant"),                 new Map(), new Set()), false);
  // Crew are never managers, whatever the title says.
  check("crew-never-manager",
    isPeopleManager_(mk("Crew Lead", "Director, Service Delivery", "Unknown", { isCrewMember: true }), catalog, sups), false);

  Logger.log(results.join("\n"));
  return results;
}

// Node test for the dual-schema matrix parser + legacy mapping (no GAS APIs).
// Run: node -e "global.Logger={log:function(m){console.log(m)}}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8')+'\n'+fs.readFileSync('PS Teams.js','utf8')); const r=_test_matrixMigration(); process.exit(r.some(function(x){return x.indexOf('FAIL')===0})?1:0)"
function _test_matrixMigration() {
  const results = [];
  const check = (label, got, want) => {
    const pass = JSON.stringify(got) === JSON.stringify(want);
    results.push(`${pass ? "PASS" : "FAIL"} ${label}${pass ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };

  // Legacy schema (no Team column) → mapped on read per spec §4
  const legacy = [
    ["Family", "Metric", "I1", "I4", "ALL"],
    ["JF009", "goals", "", 40, ""],       // native PS family → services only
    ["JF004", "goals", "", "", 50],       // COE ALL cell → sales AND services
    ["JF013", "goals", 70, "", ""],       // embedded ops → services AND rnd
    ["SERVICES", "goals", "", "", 55],    // legacy services catch-all → (services, ALL)
    ["NONCONTRIB", "goals", "", "", 60],  // legacy noncontrib → (rnd, ALL)
    ["DEFAULT", "goals", "", "", 99],     // retired block → dropped
    ["JF009", "bogus", "", 1, ""],        // unknown metric row → ignored
  ];
  const m = parseScoringMatrix_(legacy);
  check("legacy-ps-family", m.services.JF009, { I4: { goals: 40 } });
  check("legacy-ps-family-not-rnd", (m.rnd || {}).JF009 === undefined, true);
  check("legacy-coe-both-teams", [m.sales.JF004, m.services.JF004],
    [{ ALL: { goals: 50 } }, { ALL: { goals: 50 } }]);
  check("legacy-embedded-both-teams", [m.services.JF013, m.rnd.JF013],
    [{ I1: { goals: 70 } }, { I1: { goals: 70 } }]);
  check("legacy-services-catchall", m.services.ALL, { ALL: { goals: 55 } });
  check("legacy-noncontrib-catchall", m.rnd.ALL, { ALL: { goals: 60 } });
  check("legacy-default-dropped", JSON.stringify(m).indexOf("99") === -1, true);
  m.sales.JF004.ALL.goals = 51; // mutate one copy…
  check("legacy-copies-dont-alias", m.services.JF004.ALL.goals, 50);

  // New schema (Team column) → nested directly; unknown team rows ignored
  const fresh = [
    ["Team", "Family", "Metric", "I1", "ALL"],
    ["services", "JF009", "goals", 45, ""],
    ["rnd", "JF013", "si", 25, ""],
    ["sales", "ALL", "goals", "", 65],
    ["marketing", "JF001", "goals", 10, ""], // unknown team → ignored (⚠️ log)
    ["services", "JF009", "goals", "", ""],  // all-blank row → adds no cells
  ];
  const n = parseScoringMatrix_(fresh);
  check("new-services-cell", n.services.JF009, { I1: { goals: 45 } });
  check("new-rnd-cell", n.rnd.JF013, { I1: { si: 25 } });
  check("new-sales-catchall", n.sales.ALL, { ALL: { goals: 65 } });
  check("new-unknown-team-ignored", n.marketing === undefined, true);

  Logger.log(results.join("\n"));
  return results;
}

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  const access = checkDashboardAccess();
  logDashboardVisit_(access);   // best-effort access trace — never throws, never blocks
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle((SEC_.PRODUCT_NAME || "Contribution") + " — Access Restricted");
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
  // Local construction on purpose: isoWeekNum_PS_ reads LOCAL getters, so a
  // Date.UTC-built Dec 28 shifts to Dec 27 in negative-offset zones and
  // reported 52 for 53-week ISO years (2026). Dec 28 is always in the last
  // ISO week of its year.
  return isoWeekNum_PS_(new Date(year, 11, 28));
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

// Returns every week between the given ISO bounds inclusive (oldest-first).
// Shared by the prev / prev2 quarter builders so the two can never drift.
function buildWeeksRange_PS_(startIsoYear, startIsoWeek, endIsoYear, endIsoWeek) {
  var today    = new Date();
  var curW     = isoWeekNum_PS_(today);
  var curY     = isoWeekYear_PS_(today);
  var todayMon = mondayOfIsoWeek_PS_(curY, curW);
  var weeks    = [];
  var w = startIsoWeek, y = startIsoYear;
  while (y < endIsoYear || (y === endIsoYear && w <= endIsoWeek)) {
    var entryMon = mondayOfIsoWeek_PS_(y, w);
    var off      = Math.round((entryMon - todayMon) / 86400000) / 7;
    weeks.push(makeWeekEntry_PS_(y, w, off));
    w++;
    if (w > weeksInYear_PS_(y)) { w = 1; y++; }
  }
  return weeks;
}

// Returns every week in the PREVIOUS quarter (oldest-first), bounded by its own
// start/end so it never overlaps buildCurrentQWeeks_PS_'s output.
function buildPrevQWeeks_PS_(ctx) {
  return buildWeeksRange_PS_(ctx.prevQStartIsoYear, ctx.prevQStartIsoWeek,
                             ctx.prevQEndIsoYear,   ctx.prevQEndIsoWeek);
}

// Returns every week in the quarter BEFORE the previous one (oldest-first) —
// third leg of the Performance Record window (spec 2026-08-18 §3).
function buildPrev2QWeeks_PS_(ctx) {
  return buildWeeksRange_PS_(ctx.prev2QStartIsoYear, ctx.prev2QStartIsoWeek,
                             ctx.prev2QEndIsoYear,   ctx.prev2QEndIsoWeek);
}

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
  // Goals-only transition window — see CONFIG_PS.GOALS_GRACE_DAYS. No other metric
  // (RCR, SI, PTO, Tracked, Planned, Kudos) resets at a fiscal boundary, so none of
  // them read inGracePeriod; it exists solely for readGoalsEngagement_'s prior-quarter merge.
  var inGracePeriod    = dayOfQtr < CONFIG_PS.GOALS_GRACE_DAYS;            // days 0–20 (3 weeks)
  var inGoalWritingRamp = dayOfQtr < 28;                                   // days 0–27

  var qStartIsoWeek    = isoWeekNum_PS_(qStartDate);
  var qStartIsoYear    = isoWeekYear_PS_(qStartDate);
  var qEndIsoWeek      = isoWeekNum_PS_(qEndDate);
  var qEndIsoYear      = isoWeekYear_PS_(qEndDate);
  // Constructor form avoids millisecond DST ambiguity across timezone boundaries.
  // Anchored to qStartDate (not qEndDate) so it shares inGracePeriod's own reference point.
  var graceEndDate     = new Date(qStartDate.getFullYear(), qStartDate.getMonth(), qStartDate.getDate() + CONFIG_PS.GOALS_GRACE_DAYS - 1);
  var graceEndIsoWeek  = isoWeekNum_PS_(graceEndDate);
  var graceEndIsoYear  = isoWeekYear_PS_(graceEndDate);

  // Previous quarter (for the Goals-only grace-period merge in getPSReportData/readGoalsEngagement_)
  var pqNum, pqStartM, pqStartY, prevFyLabel;
  if      (qNum === 1) { pqNum = 4; pqStartM = 4;  pqStartY = fyStartCalYear;     prevFyLabel = "FY" + String(fyNum - 1).slice(-2); }
  else if (qNum === 2) { pqNum = 1; pqStartM = 7;  pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else if (qNum === 3) { pqNum = 2; pqStartM = 10; pqStartY = fyStartCalYear;     prevFyLabel = fyLabel; }
  else                 { pqNum = 3; pqStartM = 1;  pqStartY = fyStartCalYear + 1; prevFyLabel = fyLabel; }

  var prevGoalsQuarter  = prevFyLabel + "Q" + pqNum;                       // "FY26Q4"
  var prevQStartDate    = new Date(pqStartY, pqStartM - 1, 1);
  var prevQStartIsoWeek = isoWeekNum_PS_(prevQStartDate);
  var prevQStartIsoYear = isoWeekYear_PS_(prevQStartDate);
  // Last day of the previous quarter = the day before this quarter starts.
  var prevQEndDate      = new Date(qStartDate.getFullYear(), qStartDate.getMonth(), qStartDate.getDate() - 1);
  var prevQEndIsoWeek   = isoWeekNum_PS_(prevQEndDate);
  var prevQEndIsoYear   = isoWeekYear_PS_(prevQEndDate);

  // Prev-prev quarter (spec 2026-08-18 §3: the Performance Record window is two
  // completed quarters + QTD). Derived the same way prev is: start = 3 months
  // before prev start; end = the day before prev starts.
  var p2StartM = pqStartM - 3, p2StartY = pqStartY;
  if (p2StartM < 1) { p2StartM += 12; p2StartY--; }
  var p2qNum = pqNum - 1, prev2FyLabel = prevFyLabel;
  if (p2qNum < 1) { p2qNum = 4; prev2FyLabel = "FY" + String(parseInt(prevFyLabel.slice(2), 10) - 1); }
  var prev2GoalsQuarter  = prev2FyLabel + "Q" + p2qNum;                    // "FY26Q3"
  var prev2QStartDate    = new Date(p2StartY, p2StartM - 1, 1);
  var prev2QStartIsoWeek = isoWeekNum_PS_(prev2QStartDate);
  var prev2QStartIsoYear = isoWeekYear_PS_(prev2QStartDate);
  var prev2QEndDate      = new Date(pqStartY, pqStartM - 1, 0);            // day before prev starts
  var prev2QEndIsoWeek   = isoWeekNum_PS_(prev2QEndDate);
  var prev2QEndIsoYear   = isoWeekYear_PS_(prev2QEndDate);

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
    prevQEndIsoWeek: prevQEndIsoWeek, prevQEndIsoYear: prevQEndIsoYear,
    prev2GoalsQuarter: prev2GoalsQuarter,
    prev2QStartIsoWeek: prev2QStartIsoWeek, prev2QStartIsoYear: prev2QStartIsoYear,
    prev2QEndIsoWeek: prev2QEndIsoWeek, prev2QEndIsoYear: prev2QEndIsoYear,
  };
}

function _test_computeFiscalContext() {
  var cases = [
    { date: "2026-06-30", desc: "Last day FY26Q4 — no grace, no ramp",       grace: false, ramp: false },
    { date: "2026-07-01", desc: "FY27Q1 day 0 — grace + ramp active",        grace: true,  ramp: true  },
    { date: "2026-07-07", desc: "FY27Q1 day 6 — grace + ramp active",        grace: true,  ramp: true  },
    { date: "2026-07-21", desc: "FY27Q1 day 20 — last grace day (3 weeks)",  grace: true,  ramp: true  },
    { date: "2026-07-22", desc: "FY27Q1 day 21 — grace over, ramp active",   grace: false, ramp: true  },
    { date: "2026-07-28", desc: "FY27Q1 day 27 — last ramp day",             grace: false, ramp: true  },
    { date: "2026-07-29", desc: "FY27Q1 day 28 — both flags false",          grace: false, ramp: false },
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
    Logger.log("  prevQStart=W" + ctx.prevQStartIsoWeek + "/" + ctx.prevQStartIsoYear +
               " prevQEnd=W" + ctx.prevQEndIsoWeek + "/" + ctx.prevQEndIsoYear);
    Logger.log("  inGrace=" + ctx.inGracePeriod + " inRamp=" + ctx.inGoalWritingRamp);
    var ok = ctx.inGracePeriod === c.grace && ctx.inGoalWritingRamp === c.ramp;
    Logger.log("  " + (ok ? "✅ PASS" : "❌ FAIL — expected grace=" + c.grace + " ramp=" + c.ramp));
  });

  // Continuity check at an actual rollover: buildPrevQWeeks_PS_ and buildCurrentQWeeks_PS_
  // must tile the calendar with no gap — and, when the boundary falls mid-week (as it does
  // for 2026-07-01, a Wednesday), getPSReportData's dedupe must leave no duplicate week label.
  var rollCtx  = computeFiscalContext_(new Date("2026-07-01"));
  var prevWks  = buildPrevQWeeks_PS_(rollCtx);
  var currWks  = buildCurrentQWeeks_PS_(rollCtx);
  var lastPrev = prevWks[prevWks.length - 1];
  var firstCur = currWks[0];
  var sharedLabel = lastPrev.label === firstCur.label;
  var gapDays = Math.round((new Date(firstCur.monday) - new Date(lastPrev.sunday)) / 86400000) - 1;
  Logger.log("Rollover continuity: lastPrevWeek=" + lastPrev.label + " firstCurWeek=" + firstCur.label +
             " sharedLabel=" + sharedLabel + " gapDays=" + gapDays);
  Logger.log("  " + ((sharedLabel || gapDays === 0) ? "✅ PASS (adjacent, no gap)" : "❌ FAIL — unexpected gap between quarters"));
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

// Execution-scoped sheet cache: GAS resets globals per execution, so entries
// live exactly one web-app call / trigger run. Computing several teams in one
// execution (getPSReportData's team-warm loop) then costs ONE fetch per sheet
// instead of one per team. Masters are never handed out — every access gets
// row-copied views, so a caller mutating rows in place can never leak into
// another team's build.
const SHEET_MEMO_ = {};

// Generic memo access for raw sheet reads that bypass loadSheet_PS_
// (PTO accumulation, PH). 2D-array results are returned as row copies.
function memoSheetData_(key, producer) {
  if (!(key in SHEET_MEMO_)) SHEET_MEMO_[key] = producer();
  const hit = SHEET_MEMO_[key];
  return Array.isArray(hit) ? hit.map(r => Array.isArray(r) ? r.slice() : r) : hit;
}

function loadSheet_PS_(ss, sheetName) {
  const key = ss.getId() + "::" + sheetName;
  if (!(key in SHEET_MEMO_)) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) { SHEET_MEMO_[key] = null; }
    else {
      const data = sh.getDataRange().getValues();
      SHEET_MEMO_[key] = (data.length < 2)
        ? { headers: (data[0] || []).map(h => String(h).trim()), rows: [] }
        : { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
    }
  }
  const hit = SHEET_MEMO_[key];
  if (!hit) return null;
  return { headers: hit.headers.slice(), rows: hit.rows.map(r => r.slice()) };
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

// Employee Status values that mean "employed but away for an extended period".
// Matched rows stay on the roster (see readRosterTab_) but leave every metric
// population — an absence is not a performance signal.
const LONG_LEAVE_RE_ = /maternity|paternity|parental|sabbatical|leave of absence/i;

// Returns roster entries eligible for tenure-dependent metrics: not in ramp-up and
// not on long leave (Goals / Kudos / RCR / SI populations).
function activeRoster_(roster) {
  return new Map([...roster].filter(([, p]) => !p.isRampUp && !p.onLeave));
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

// `bridgesOut` (optional) collects the rows this read DROPS — unknown Class,
// intern title, or an inactive/terminated status — as
// normName -> { name, supNorm }. They never enter the roster and never reach a
// payload; they exist so resolveManagerScope_ can walk THROUGH them. Without
// that bridge a director loses a whole sub-tree the moment one mid-level
// manager's row is dropped (a termination whose reports have not been
// re-parented yet is the common case) — silently, with nothing in the log.
function readPSRoster_(bridgesOut) {
  const ss     = SpreadsheetApp.openById(getExternalSSIds_().roster);
  const roster = new Map();
  readRosterTab_(ss, CONFIG_PS.SHEET_ROSTER,      roster, false, bridgesOut);
  readRosterTab_(ss, CONFIG_PS.SHEET_CONTRACTORS, roster, true,  bridgesOut);
  return roster;
}

// Records one dropped row's org edge for readPSRoster_'s `bridgesOut` map.
// A row with no Supervisor value bridges nothing and is skipped — a blank would
// normalise to "" and match every other blank. First writer wins, so the Data
// tab stays the sheet of record exactly as it is for kept rows.
function recordRosterBridge_(bridgesOut, name, supRaw) {
  if (!bridgesOut || !supRaw) return;
  const norm = normPS_(name);
  if (!bridgesOut.has(norm)) bridgesOut.set(norm, { name, supNorm: normPS_(supRaw) });
}

// Ingests one Roster-spreadsheet tab into `roster` (Map<normName → profile>).
// Both tabs share the same headers; `isCrewTab` covers the differences:
// Contractors Data rows are all crew (isCrewMember forced true), skip the
// known-Class gate (their Class is "Contractors", which classIsKnown_ rejects —
// Department carries their org split instead, see teamForProfile_), drop on any
// non-blank Termination/Release Date (2026-07-15: the tab is active-only — a date
// there means released), and lose to the Data tab on a name collision (Data is
// the sheet of record for FTEs).
function readRosterTab_(ss, sheetName, roster, isCrewTab, bridgesOut) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log(isCrewTab
      ? `⚠️ "${sheetName}" sheet not found in Roster SS — crew members will be empty.`
      : `❌ Roster sheet "${sheetName}" not found.`);
    return;
  }

  const lastRow  = sheet.getLastRow();
  const lastCol  = sheet.getLastColumn();
  if (lastRow < 2) return;

  // Read the full used range from row 1 / col 1 so we never miss a column
  const raw  = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const hdrs = raw[0].map(h => String(h).trim());
  const rows = raw.slice(1);

  log_(`${sheetName} headers (${hdrs.length}): ${hdrs.join(" | ")}`);

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

  log_(`${sheetName} col indices — Name:${iName} Class:${iClass} InternalID:${iInternalId} EmpNum:${iEmpNum} Status:${iStatus} HireDate:${iHireDate} RampFlag:${iRampFlag}`);
  if (iStatus === -1) Logger.log(`⚠️ ${sheetName} "Employee Status" column not found — status-based exclusions will not apply.`);

  if (iName === -1) { Logger.log(`❌ ${sheetName} "Name" column not found.`); return; }

  // Log distinct Class and Status values to confirm what's in the sheet
  const classValues  = new Set(rows.map(r => String(iClass  !== -1 ? r[iClass]  : "").trim()).filter(Boolean));
  const statusValues = new Set(rows.map(r => String(iStatus !== -1 ? r[iStatus] : "").trim()).filter(Boolean));
  log_(`${sheetName} distinct Class values: ${[...classValues].join(" | ")}`);
  log_(`${sheetName} distinct Employee Status values: ${[...statusValues].join(" | ")}`);

  const sizeBefore = roster.size;
  const unknownClasses = new Map();   // class value → dropped-row count (diagnostics)
  const droppedInterns = [];          // names of interns excluded from the roster (diagnostics)
  let crewCollisions = 0;             // crew-tab rows skipped because the Data tab already has the name
  rows.forEach(row => {
    const name   = String(row[iName]  || "").trim();
    const cls    = String(iClass  !== -1 ? row[iClass]  : "").trim();
    const status = String(iStatus !== -1 ? row[iStatus] : "").trim().toLowerCase();
    const supRaw = String(iSup !== -1 ? row[iSup] : "").trim();
    if (!name) return;
    // Company-wide roster: rows from every KNOWN Class participate (Professional
    // Services / Corporate / To be Allocated — see TEAM_KNOWN_CLASSES_ in PS Teams).
    // Team membership is tagged in getPSReportData via teamForProfile_.
    // Contractors Data rows skip this gate: their Class is "Contractors" for
    // everyone, so it carries no signal — being in the tab is the crew marker.
    if (!isCrewTab && !classIsKnown_(cls)) {
      unknownClasses.set(cls || "(blank)", (unknownClasses.get(cls || "(blank)") || 0) + 1);
      recordRosterBridge_(bridgesOut, name, supRaw);
      return;
    }
    const termDate   = iTermDate !== -1 ? String(row[iTermDate] || "").trim() : "";
    // Active-only, both tabs: any non-blank Termination/Release Date drops the row
    // (2026-07-15: the Contractors Data tab holds only active crew — a date there
    // means released, so no future-dated leniency anymore). FTE rows additionally
    // drop on an inactive Employee Status match; crew Status carries no signal.
    // Long leave (maternity/paternity/parental/sabbatical) is NOT a termination:
    // those rows used to be dropped here, which hid the person entirely while
    // "parental leave"/"sabbatical" were never matched at all and silently dragged
    // the metrics. They now stay on the roster, badged 🏖 On Leave, and are
    // excluded from every metric population instead (spec 2026-08-02 §3.2).
    const onLeave = !isCrewTab && !!status && LONG_LEAVE_RE_.test(status);
    const isInactive = !!termDate ||
      (!isCrewTab && status && !onLeave &&
       /terminat|job offer|resign|left|inactive|former|offboard/i.test(status));
    if (isInactive) { recordRosterBridge_(bridgesOut, name, supRaw); return; }

    // Ramp-up: in ramp-up if hired within threshold, unless manual flag overrides
    const hireDate   = iHireDate !== -1 ? parseDate_PS_(row[iHireDate]) : null;
    const rampFlag   = String(iRampFlag !== -1 ? row[iRampFlag] : "").trim().toLowerCase();
    const jobTitle   = String(iTitle      !== -1 ? row[iTitle]      : "").trim() || "Unknown";
    const isCrew     = isCrewTab || /crew member|contractor/i.test(jobTitle);

    // Interns are not evaluated as employees — drop them from the roster entirely,
    // exactly like inactive rows above, so no headcount/metric/aggregate ever sees them.
    if (CONFIG_PS.EXCLUDE_INTERNS && CONFIG_PS.INTERN_TITLE_PATTERN.test(jobTitle)) {
      droppedInterns.push(name);
      recordRosterBridge_(bridgesOut, name, supRaw);
      return;
    }

    const flagYes    = rampFlag === "yes" || rampFlag === "true" || rampFlag === "1";
    const flagNo     = rampFlag === "no"  || rampFlag === "false" || rampFlag === "0";
    const thresholdMs = CONFIG_PS.RAMP_UP_MONTHS * CONFIG_PS.DAYS_PER_MONTH_AVG * 86400 * 1000;
    const hiredRecently = hireDate && (Date.now() - hireDate.getTime()) < thresholdMs;
    const isRampUp   = flagNo ? false : (flagYes || !!hiredRecently);

    const norm = normPS_(name);
    if (roster.has(norm)) {
      if (isCrewTab) {
        // Data tab (and earlier crew rows) win — never let a crew row overwrite an FTE.
        crewCollisions++;
        return;
      }
      Logger.log(`⚠️ Roster: duplicate normalized name "${name}" — later row overwrites the earlier one (name-joined metrics may mix people).`);
    }
    roster.set(norm, {
      name,
      internalId:     String(iInternalId !== -1 ? row[iInternalId] : "").trim(),
      employeeNumber: String(iEmpNum     !== -1 ? row[iEmpNum]     : "").replace(/,/g, "").trim(),
      keyLocation:    String(iLoc        !== -1 ? row[iLoc]        : "").trim() || "Unknown",
      supervisor:     supRaw || "Unknown",
      jobTitle:       jobTitle,
      cls,
      dept:           String(iDept       !== -1 ? row[iDept]       : "").trim() || "",
      email:          String(iEmail      !== -1 ? row[iEmail]      : "").trim().toLowerCase(),
      hireDate,
      isRampUp,
      isCrewMember:   isCrew,
      onLeave,
    });
  });

  log_(`${sheetName}: ${roster.size - sizeBefore} ${isCrewTab ? "crew members seeded" : "employees loaded (company-wide)"}.`);
  if (crewCollisions > 0) {
    Logger.log(`${sheetName}: skipped ${crewCollisions} row(s) whose name already exists in the Data tab (Data wins).`);
  }
  if (droppedInterns.length > 0) {
    Logger.log(`${sheetName}: excluded ${droppedInterns.length} intern(s) — ${droppedInterns.slice(0, 10).join(", ")}${droppedInterns.length > 10 ? " …" : ""}`);
  }
  // Crew team membership is Department-driven (teamForProfile_), so surface the
  // distinct crew Department values — a rename in the sheet shows up here first.
  log_(`${sheetName} distinct Department values: ${[...new Set([...roster.values()].filter(p => !isCrewTab || p.isCrewMember).map(p => p.dept).filter(Boolean))].join(" | ")}`);
  if (unknownClasses.size > 0) {
    Logger.log(`⚠️ ${sheetName}: dropped rows with unknown Class — ${[...unknownClasses].map(([v, n]) => `"${v}"×${n}`).join(", ")} (add to TEAM_KNOWN_CLASSES_ in PS Teams if legitimate).`);
  }
  if (roster.size > 0) {
    log_(`  Sample names: ${[...roster.values()].slice(0,5).map(e => e.name).join(", ")}`);
  }
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
// The anchor is included in the returned Set because it seeds the traversal — the
// CALLER decides whether the manager keeps their own row. getPSReportData deletes
// it (a manager's evaluation belongs to their manager); anything else that reuses
// this must make that call deliberately.
//
// `bridges` (optional, from readPSRoster_) is the org edges of the rows the roster
// read DROPPED — see recordRosterBridge_. The walk can only pass through people it
// can see, so without them one dropped mid-level manager severs everything beneath
// them: a director whose sub-manager was terminated (reports not yet re-parented),
// carries an unknown Class, or holds an intern title would simply stop seeing that
// half of their org, with no warning anywhere. Bridge nodes are traversal-only —
// they enter `seen`, never `scope`, so a dropped row still reaches no payload and
// no aggregate. They widen nothing either: every bridge is a real Supervisor edge
// from the sheet, so the tree it rebuilds is the tree that actually exists.
function resolveManagerScope_(roster, managerNorm, bridges) {
  const scope = new Set([managerNorm]); // traversal seed — see the note above
  const seen  = new Set([managerNorm]); // scope ∪ off-roster bridge nodes
  const queue = [managerNorm];
  const walkedThrough = new Map();      // bridge norm → display name, for the log
  while (queue.length > 0) {
    const supNorm = queue.shift();
    let found = 0;
    roster.forEach((profile, norm) => {
      if (!seen.has(norm) && normPS_(profile.supervisor) === supNorm) {
        seen.add(norm);
        scope.add(norm);
        queue.push(norm); // recurse — this person may also supervise others
        found++;
      }
    });
    if (bridges) {
      bridges.forEach((edge, norm) => {
        if (!seen.has(norm) && !roster.has(norm) && edge.supNorm === supNorm) {
          seen.add(norm);
          queue.push(norm); // traversal only — a dropped row never joins `scope`
          found++;
        }
      });
    }
    // Only a bridge that actually led somewhere is worth a log line.
    if (found > 0 && bridges && bridges.has(supNorm) && !roster.has(supNorm)) {
      walkedThrough.set(supNorm, bridges.get(supNorm).name);
    }
  }
  if (walkedThrough.size > 0) {
    Logger.log(`ℹ️ Org tree "${managerNorm}": walked THROUGH ${walkedThrough.size} dropped roster ` +
               `row(s) to reach the people under them — ${[...walkedThrough.values()].join(", ")}. ` +
               `Those rows stay out of the payload; their reports are in scope. Re-parent them in ` +
               `the Roster sheet, or add their Class to TEAM_KNOWN_CLASSES_, to clear this.`);
  }
  return scope;
}

// Computes team RCR = SUM(Revenue Contribution) / SUM(TCC A+B) for the PS headcount.
// Uses "3. RCR" as a bridge: name-matches to roster to get per-employee RCR values AND
// harvests Employee IDs (same format as RC/TCC sheets) to do the team SUM(RC)/SUM(TCC).
function readRCR_PS_(roster, teamSubset) {
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

  // Detect the true last-populated month across ALL fiscal years present in the sheet
  // (not just the current FY's 12 columns) — month columns accumulate over time, the
  // same pattern the SI sheet uses for its per-quarter columns. This is what keeps RCR
  // showing the true last-closed month across a fiscal-year rollover instead of going
  // blank until the new FY's first month closes.
  const MONTH_HDR_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{2})$/i;
  const MONTH_ORDER  = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
  const rcrMonthCols = rcrHdrs
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => MONTH_HDR_RE.test(h))
    .map(({ h, i }) => {
      const m = h.match(MONTH_HDR_RE);
      return { name: h, col: i, sortKey: (2000 + parseInt(m[2], 10)) * 12 + MONTH_ORDER[m[1].toLowerCase()] };
    })
    .sort((a, b) => a.sortKey - b.sortKey);

  let lastMonthIdx = -1;
  for (let k = rcrMonthCols.length - 1; k >= 0; k--) {
    if (rcrSheet.rows.some(r => !isNA_PS_(r[rcrMonthCols[k].col]) && !isNaN(parseFloat(r[rcrMonthCols[k].col])))) {
      lastMonthIdx = k; break;
    }
  }
  if (lastMonthIdx === -1) { Logger.log(`⚠️ RCR: no populated month in "${CONFIG_PS.SHEET_RCR}".`); return empty; }

  const lastMonthName = rcrMonthCols[lastMonthIdx].name;
  const rcrMonthCol   = rcrMonthCols[lastMonthIdx].col;

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

  // Build a trailing RCR history (oldest → newest) of the last CONFIG_PS.RCR_HISTORY_MONTHS
  // populated months, using 3.RCR individual averages per month. This is a rolling window
  // like the rest of the report — it rolls across fiscal-year boundaries instead of
  // resetting to blank each new FY. The full range also feeds the per-employee
  // "who needs support" table client-side.
  const rcrHistory = [];
  const rcrByEmployee = {};  // norm → { monthName: rcrValue } — all roster members, for client-side filter slicing
  const histStart = Math.max(0, lastMonthIdx - CONFIG_PS.RCR_HISTORY_MONTHS + 1);
  for (let mi = histStart; mi <= lastMonthIdx; mi++) {
    const { name: monthName, col } = rcrMonthCols[mi];
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
    const isLast   = mi === lastMonthIdx;
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
  const nominalQuarter = ctx.siQuarterCol.match(/FY\w+/i)?.[0] || "";
  const empty   = { teamAvg: null, quarter: nominalQuarter, byEmployee: {} };
  if (!data) { Logger.log(`⚠️ SI sheet not found.`); return empty; }

  const hdrs = data.headers;
  Logger.log(`SI headers: ${hdrs.join(" | ")}`);

  // Match by Employee Number — same key used in Contribution Report.js
  const empNumToNorm = rosterIdMap_(roster, "employeeNumber");
  const iEmpNum = hdrs.findIndex(h => /employee.?number|emp.?num/i.test(h.trim()));
  if (iEmpNum === -1) { Logger.log(`⚠️ SI: "Employee Number" column not found. Attempting name fallback.`); }

  let siNameCol = hdrs.findIndex(h => /^name|rocketeer/i.test(h));
  if (siNameCol === -1) siNameCol = 0;

  // Detect all available SI quarter columns (oldest → newest) for both the
  // historical trend AND the current-quarter fallback below.
  const quarterRank_ = q => {
    const m = /FY(\d+)Q(\d)/i.exec(q || "");
    return m ? (parseInt(m[1], 10) * 4 + parseInt(m[2], 10)) : -1;
  };
  const siHistCols = hdrs.reduce((acc, h, i) => {
    const m = h.trim().match(/small\s+improvements\s+manager\s+rating\s+(FY\w+)/i);
    if (m) acc.push({ quarter: m[1].trim(), col: i });
    return acc;
  }, []).sort((a, b) => quarterRank_(a.quarter) - quarterRank_(b.quarter));

  const hasAnyRating_ = col => data.rows.some(row => {
    if (isNA_PS_(row[col])) return false;
    const n = parseFloat(row[col]);
    return !isNaN(n) && n > 0;
  });

  // Managers typically enter SI ratings some time after a quarter closes, so right
  // after a fiscal-quarter rollover the nominal "last closed quarter" column
  // (ctx.siQuarterCol) can be missing or present-but-empty. Without a fallback the
  // whole SI row goes blank — including for weeks that are still calendar-wise in
  // the previous quarter — even though the previous rated quarter's data is right
  // there in the sheet. Fall back to the newest column that actually has ratings.
  let iSI = hdrs.findIndex(h => h.trim() === ctx.siQuarterCol);
  let quarter = nominalQuarter;
  if (iSI === -1) {
    Logger.log(`⚠️ SI column "${ctx.siQuarterCol}" not found. Headers: ${hdrs.join(", ")}`);
  }
  if (iSI === -1 || !hasAnyRating_(iSI)) {
    const fallback = siHistCols
      .filter(c => c.col !== iSI && hasAnyRating_(c.col))
      .sort((a, b) => quarterRank_(b.quarter) - quarterRank_(a.quarter))[0];
    if (fallback) {
      Logger.log(`⚠️ SI: "${ctx.siQuarterCol}" has no ratings yet — falling back to most recently rated quarter "${fallback.quarter}".`);
      iSI = fallback.col;
      quarter = fallback.quarter;
    }
  }
  if (iSI === -1) return empty;

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
// `deptSet` (Set<string>) filters rows to the requested team's departments;
// a missing/empty set keeps every department.
function readPTOAccumulationProfiles_(deptSet) {
  try {
    // Raw values memoized per execution — this reader runs once per TEAM (the
    // deptSet differs), but the sheet itself is identical; filtering stays per-call.
    const rawData = memoSheetData_("ptoAccum::" + CONFIG_PS.PTO_ACCUM_SHEET, () => {
      Logger.log(`🕐 readPTOAccumulationProfiles_: opening ${CONFIG_PS.PTO_ACCUM_SS_ID}`);
      const ss = SpreadsheetApp.openById(getExternalSSIds_().ptoAccum);
      const sh = ss.getSheetByName(CONFIG_PS.PTO_ACCUM_SHEET);
      if (!sh) {
        Logger.log(`❌ readPTOAccumulationProfiles_: sheet "${CONFIG_PS.PTO_ACCUM_SHEET}" not found.`);
        return null;
      }
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      if (lastRow < 2) { Logger.log(`⚠️ readPTOAccumulationProfiles_: no data rows.`); return null; }
      return sh.getRange(1, 1, lastRow, lastCol).getValues();
    });
    if (!rawData) return {};
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
      if (deptSet && deptSet.size > 0 && !deptSet.has(dept)) { droppedDept++; continue; }

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
function readGoalsEngagement_(psNames, weeks, histWeeks, ctx, ptoProfiles, empNumToNorm) {
  const goalsSS = SpreadsheetApp.openById(getExternalSSIds_().goals);
  const data    = loadSheet_PS_(goalsSS, CONFIG_PS.SHEET_GOALS);
  const result  = {};
  // Per-week PTO usage hours, keyed by normName — used to exempt a full-week-PTO
  // rocketeer from the self-comment pacing rule (Rule 3) for that specific week only.
  const ptoUsageByWeek = (ptoProfiles && empNumToNorm) ? buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, weeks) : {};
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
  // Quarter-agnostic self-comment log — every self-comment, on every goal, across ALL fiscal
  // quarters found in the sheet. goalMap/prevGoalMap are deliberately scoped to a single
  // quarter (compliance rules are quarter-specific), but the weekly comment-activity trend
  // below spans many months of histWeeks and must not drop weeks whose goals belonged to an
  // older quarter than ctx.goalsQuarter — normName → Map<goalId, Date[]>.
  const allCommentsMap = new Map();

  data.rows.forEach(row => {
    const rocketeer = String(row[iRocketeer] || "").trim();
    if (!rocketeer) return;

    const _norm = normPS_(rocketeer);
    if (psNames.has(_norm) && iCommentDate !== -1) {
      const _rawGoalId   = iGoalId   !== -1 ? String(row[iGoalId]   || "").trim() : "";
      const _rawGoalName = iGoalName !== -1 ? String(row[iGoalName] || "").trim() : "";
      let _goalId = _rawGoalId || _rawGoalName;
      for (const { pattern, id } of CONFIG_PS.GOAL_ID_MAP) {
        if (pattern.test(_rawGoalName || _rawGoalId)) { _goalId = id; break; }
      }
      const _commentator = String(iCommentator !== -1 ? row[iCommentator] : "").trim();
      const _commentDate = parseDate_PS_(row[iCommentDate]);
      if (_goalId && _commentDate && normPS_(_commentator) === _norm) {
        if (!allCommentsMap.has(_norm)) allCommentsMap.set(_norm, new Map());
        const _empComments = allCommentsMap.get(_norm);
        if (!_empComments.has(_goalId)) _empComments.set(_goalId, []);
        _empComments.get(_goalId).push(_commentDate);
      }
    }

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
      empGoals.set(goalId, { status: "", selfComments: [], completed: false, nonSelfCommentCount: 0,
                             notCompleted: false, canceled: false });
    }
    // Track highest-priority status seen for this goal
    const PRIO = { "In Progress": 3, "Planned": 2, "Completed": 1 };
    const g = empGoals.get(goalId);
    if ((PRIO[status] || 0) > (PRIO[g.status] || 0)) g.status = status;
    if (status === 'Completed') g.completed = true;
    // "Not Completed" / "Canceled" carry no PRIO rank, so they never win g.status — capture them
    // on sticky flags instead so the "all goals closed" summary can distinguish closed outcomes.
    else if (/not.?complet/i.test(status)) g.notCompleted = true;
    else if (/cancel/i.test(status))       g.canceled     = true;

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
    const weekPTO  = (ptoUsageByWeek[week.label] && ptoUsageByWeek[week.label].byEmployee) || {};

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
      const fullWeekPTO = (weekPTO[norm] || 0) >= CONFIG_PS.PTO_FULL_WEEK_HRS;
      const qualifying = goalIds.filter(id => {
        const goal = empGoals.get(id);
        const cnt  = goal.selfComments.filter(d => d <= weekEnd).length;
        // Completed goals exempt from ramping threshold — ≥1 self-comment suffices
        if (goal.completed && cnt >= 1) return true;
        return cnt >= reqCmt;
      }).length;

      // A full-week-PTO rocketeer physically couldn't comment that week — exempt Rule 3
      // only (per-week snapshot; does not shift reqCmt/qWeek for other weeks). Rules 1
      // and 2 above are unaffected.
      const ok = fullWeekPTO || (qualifying >= threshold);
      if (ok) compliant++;
      result[week.label].byEmployee[norm] = {
        compliant: ok, rule: ok ? null : 3,
        totalGoals, inProgressCount, inProgressNeeded, qualifying, threshold, reqCmt, qWeek,
        ptoExempt: fullWeekPTO,
      };
    });

    result[week.label].compliant = compliant;
    result[week.label].total     = total;
  });

  // ── Compliance override — three paths, all mark every non-future week compliant:
  // (A) 8+ completed goals AND ≥5 goals with ≥8 cumulative self-comments (fully documented)
  // (B) ALL goals set to Completed AND total goals ≥ GOALS_MIN_COUNT (end-of-quarter closure)
  // (C) closed-quarter runs only (ctx.quarterClosed): every goal closed AND completed ≥
  //     STF_MIN_COMPLETED — the quarter is over and the completion bar is met; Canceled /
  //     Not Completed leftovers do not fail the signal. Mid-quarter the weekly rules still
  //     demand full compliance, so (C) never fires for the in-progress quarter.
  psNames.forEach((_, norm) => {
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    const goalIds            = Array.from(empGoals.keys());
    const totalGoals         = goalIds.length;
    const completedGoals     = goalIds.filter(id => empGoals.get(id).completed).length;
    const fullyDocumentedCount = goalIds.filter(id => empGoals.get(id).selfComments.length >= 8).length;
    const closedGoals        = goalIds.filter(id => {
      const g = empGoals.get(id);
      return g.completed || g.notCompleted || g.canceled;
    }).length;
    const allGoalsCompleted  = completedGoals === totalGoals;
    const fullyDocOverride   = completedGoals >= CONFIG_PS.GOALS_MIN_COUNT && fullyDocumentedCount >= 5;
    const allCompletedOverride = allGoalsCompleted && totalGoals >= CONFIG_PS.GOALS_MIN_COUNT;
    const closedCompleteOverride = !!(ctx && ctx.quarterClosed) && totalGoals > 0 &&
      closedGoals === totalGoals && completedGoals >= CONFIG_PS.STF_MIN_COMPLETED;
    if (!fullyDocOverride && !allCompletedOverride && !closedCompleteOverride) return;
    weeks.filter(w => !w.isFuture).forEach(week => {
      const prev = result[week.label].byEmployee[norm];
      if (prev && !prev.compliant) result[week.label].compliant++;
      result[week.label].byEmployee[norm] = Object.assign({}, prev || {}, {
        compliant: true, overrideCompliant: true, fullyDocumentedCount, completedGoals,
        allGoalsCompleted,
      });
    });
  });

  // ── "All goals closed" note — informational only, does NOT change compliance.
  // At quarter close (incl. the grace window) many rocketeers have every goal in a closed status
  // (Completed / Not Completed / Canceled) with none still In Progress — so the weekly rule-2
  // "needs N In Progress" prompt is misleading (nothing left to move). Reasons:
  //   'incomplete'   — completed < STF_MIN_COMPLETED → out of compliance (hard miss)
  //   'under-review' / 'stf-ok' — completed ≥ STF_MIN_COMPLETED; on closed-quarter runs these
  //                    are override-compliant (path C above) and the frontend renders a plain
  //                    green "Completed" signal for both. stfWellDoc / stfEligible remain as
  //                    data only — the dashboard shows the completion signal, never an STF
  //                    payout decision (that call is not ours to make).
  // Only for rocketeers who did NOT complete every goal (all-completed → the "✅ All done"
  // override handles it). Attached regardless of weekly compliance. quarterClosed lets the
  // frontend distinguish a closed-quarter "Completed" from a mid-quarter early close-out.
  psNames.forEach((_, norm) => {
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    const goalIds     = Array.from(empGoals.keys());
    const totalGoals  = goalIds.length;
    const completed   = goalIds.filter(id => empGoals.get(id).completed).length;
    const notCompleted = goalIds.filter(id => { const g = empGoals.get(id); return !g.completed && g.notCompleted; }).length;
    const canceled    = goalIds.filter(id => { const g = empGoals.get(id); return !g.completed && !g.notCompleted && g.canceled; }).length;
    const closedCount = completed + notCompleted + canceled;
    // Every goal closed, but not all completed (all-completed is the override above → "✅ All done")
    if (totalGoals === 0 || closedCount !== totalGoals || completed === totalGoals) return;
    // STF payout: ≥ STF_MIN_COMPLETED completed AND ≥ STF_MIN_CMT_GOALS of those with ≥8 total comments
    const stfWellDoc = goalIds.filter(id => {
      const g = empGoals.get(id);
      return g.completed && (g.selfComments.length + (g.nonSelfCommentCount || 0)) >= CONFIG_PS.STF_MIN_COMMENTS;
    }).length;
    const metCompletion = completed >= CONFIG_PS.STF_MIN_COMPLETED;
    const stfEligible   = metCompletion && stfWellDoc >= CONFIG_PS.STF_MIN_CMT_GOALS;
    const reason = !metCompletion ? 'incomplete' : (stfEligible ? 'stf-ok' : 'under-review');
    const summary = {
      totalGoals, completed, notCompleted, canceled, stfWellDoc, stfEligible, reason,
      stfMinCompleted: CONFIG_PS.STF_MIN_COMPLETED, stfMinCmtGoals: CONFIG_PS.STF_MIN_CMT_GOALS,
      quarterClosed: !!(ctx && ctx.quarterClosed),
    };
    weeks.filter(w => !w.isFuture).forEach(week => {
      const e = result[week.label].byEmployee[norm];
      if (e) e.allClosed = summary;
    });
  });

  // ── Open-goals summary — quarter-level aggregate over the active roster.
  // Counts goals whose status is still open (not Completed / Not Completed / Canceled),
  // i.e. In Progress, Planned, or blank. The grace-window closure call-to-action in the
  // insights builders uses the PREV-quarter run's summary (meta.prevQOpenGoals) so it
  // reports rocketeers with genuinely open statuses — NOT the non-compliant count, which
  // is dominated by Not Completed / too-few-goals cases that need no status change.
  let ogPeople = 0, ogGoals = 0, ogInProgress = 0, ogPlanned = 0;
  psNames.forEach((_, norm) => {
    const empGoals = goalMap.get(norm);
    if (!empGoals || empGoals.size === 0) return;
    let open = 0, ip = 0, pl = 0;
    empGoals.forEach(g => {
      if (g.completed || g.notCompleted || g.canceled) return;
      open++;
      if (g.status === "In Progress")  ip++;
      else if (g.status === "Planned") pl++;
    });
    if (open > 0) { ogPeople++; ogGoals += open; ogInProgress += ip; ogPlanned += pl; }
  });
  result._openGoals = {
    quarter: (ctx && ctx.goalsQuarter) || "",
    people: ogPeople, goals: ogGoals, inProgress: ogInProgress, planned: ogPlanned,
  };

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
    // Mirrors override path (C): a closed-quarter run with the completion bar met is not
    // an engagement-risk case either.
    const closedComplete = !!(ctx && ctx.quarterClosed) && totalGoals > 0 &&
      completedGoals >= CONFIG_PS.STF_MIN_COMPLETED &&
      goalIds.every(id => {
        const g = empGoals.get(id);
        return g.completed || g.notCompleted || g.canceled;
      });
    if (fullyDocumented || (allCompleted && totalGoals >= CONFIG_PS.GOALS_MIN_COUNT) || closedComplete) {
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
      // Quarter-agnostic — a rocketeer's comment activity on an older quarter's goals
      // still counts toward this historical week, unlike the compliance-rule goalMap above.
      const empGoals = allCommentsMap.get(norm);
      if (!empGoals) return;
      // Count every self-comment on any goal in this Mon–Sun window
      let empWeekComments = 0;
      empGoals.forEach(dates => {
        empWeekComments += dates.filter(d => d >= wStart && d <= wEnd).length;
      });
      totalComments += empWeekComments;
      // Per-goal boolean flags — computed once, reused for counters + per-employee storage
      const g03 = empGoals.get(g03Id);
      const g01 = empGoals.get(g01Id);
      const g03ok = !!(g03 && g03.some(d => d >= wStart && d <= wEnd));
      const g01ok = !!(g01 && g01.some(d => d >= wStart && d <= wEnd));
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

// totalGoals is a per-employee, week-invariant count (every week readGoalsEngagement_
// evaluates for a given quarter shares the same goalMap, so an employee's totalGoals is
// identical across all of that quarter's weeks) — so "has this rocketeer started logging
// real goals in the new quarter yet" is a single per-employee fact for the whole grace
// window, not something that needs recomputing per week. Scans all weeks defensively
// (cheap: psNames × currentQWeeks) rather than assuming any one week is representative.
function employeesWithNewGoals_(currentResult) {
  const norms = new Set();
  Object.entries(currentResult).forEach(([wk, wd]) => {
    if (wk.startsWith('_') || !wd || !wd.byEmployee) return;
    Object.entries(wd.byEmployee).forEach(([norm, gd]) => {
      if ((gd && gd.totalGoals) || 0) norms.add(norm);
    });
  });
  return norms;
}

// Merges the outgoing quarter's real per-week Goals compliance (prevResult) with the
// current quarter's (currentResult) ON A PER-EMPLOYEE BASIS. A fiscal-quarter rollover can
// land mid-ISO-week, so the outgoing quarter's last week and the incoming quarter's first
// week can share the same ISO week label. On that shared label BOTH sides report "real"
// data (prevResult evaluated against the outgoing quarter's actual goals; currentResult
// evaluated against the still-empty new quarter, where the writing-ramp exemption makes
// every rocketeer trivially "compliant"). Resolving per employee — instead of letting one
// side win for the whole team — ensures a rocketeer who already logged real new-quarter
// goals shows THEIR new data, while a rocketeer who hasn't yet keeps showing THEIR real
// outgoing-quarter compliance instead of being defaulted to the trivial ramp placeholder.
function mergeGoalsResults_(prevResult, currentResult) {
  const hasNewGoals = employeesWithNewGoals_(currentResult);
  const merged = Object.assign({}, prevResult);
  for (const [wk, cur] of Object.entries(currentResult)) {
    if (wk === '_weeklyCommenters') { merged[wk] = cur; continue; }
    if (wk === '_openGoals') { merged[wk] = cur; continue; } // current quarter's summary wins
    if (wk === '_audit') { merged[wk] = mergeGoalsAudit_(prevResult._audit, cur, hasNewGoals); continue; }
    const prev = merged[wk];
    const curHasReal  = cur  && cur.total  !== undefined;
    const prevHasReal = prev && prev.total !== undefined;
    if (!prevHasReal) { merged[wk] = cur; continue; }
    if (!curHasReal) continue; // keep prev (already in `merged`)
    // Both sides claim real data for this label — only possible on the shared boundary
    // week. Resolve employee-by-employee instead of picking one side for the whole team.
    const byEmployee = {};
    const norms = new Set([...Object.keys(prev.byEmployee || {}), ...Object.keys(cur.byEmployee || {})]);
    let compliant = 0, total = 0;
    norms.forEach(norm => {
      const resolved = hasNewGoals.has(norm) ? cur.byEmployee[norm] : (prev.byEmployee[norm] || cur.byEmployee[norm]);
      byEmployee[norm] = resolved;
      if (resolved) { total++; if (resolved.compliant) compliant++; }
    });
    merged[wk] = Object.assign({}, cur, { byEmployee, compliant, total });
  }
  return merged;
}

// Combines two _audit snapshots (flat arrays of { normName, flag, ... }), per employee:
// a rocketeer who has started logging real new-quarter goals shows their current-quarter
// audit flag (or no flag, if they cleared it); everyone else keeps their outgoing-quarter
// flag so "no activity" / "supervisor-only" badges don't silently vanish for the whole
// team just because the new quarter's goal set is still empty (see mergeGoalsResults_).
function mergeGoalsAudit_(prevAudit, curAudit, hasNewGoals) {
  const curByNorm = new Map((curAudit || []).map(a => [a.normName, a]));
  const merged = new Map((prevAudit || []).map(a => [a.normName, a]));
  hasNewGoals.forEach(norm => {
    if (curByNorm.has(norm)) merged.set(norm, curByNorm.get(norm));
    else merged.delete(norm); // has new-quarter goals but no current flag → flag cleared
  });
  return Array.from(merged.values());
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
      tooltip: `Current-quarter goals compliance: ≥8 goals, majority (>50%) In Progress, ≥6 goals with the required self-comments. Quarter target: 10 goals, 8 completed by quarter end.`,
      // No unconditional isFuture blank here (unlike tracked/kudos below) — during the
      // Goals grace period, computePSReport_ fills in future weeks with the outgoing
      // quarter's frozen snapshot, and that data should render like any other week.
      cells: weeks.map(w => {
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
      // Scoped to the tracking-mandated families (JF007/JF009) — ⏱ Exempt
      // rocketeers bill sporadically and are outside this ratio (2026-08-05).
      quarterly: true,
      tooltip: `Revenue Contribution Ratio = SUM(Revenue) / SUM(TCC) for the tracking-mandated families (JF007/JF009) — last closed month (${rcr.lastMonth || "—"}). ⏱ Exempt rocketeers are outside this ratio.`,
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
      const ptoHrsForWeek = (planned[l] && planned[l].ptoByEmployee && planned[l].ptoByEmployee[norm] != null)
        ? planned[l].ptoByEmployee[norm] : 0;
      empWeeks[l] = {
        trackedHrs:  w.isFuture  ? null : (tracked[l]  && tracked[l].byEmployee[norm]  != null ? tracked[l].byEmployee[norm]  : null),
        plannedHrs:     planned[l] && planned[l].byEmployee[norm] != null ? planned[l].byEmployee[norm] : null,
        ptoPlannedHrs:  planned[l] && planned[l].ptoByEmployee  && planned[l].ptoByEmployee[norm]  != null ? planned[l].ptoByEmployee[norm]  : null,
        // PTO-adjusted weekly capacity for scoring — shrinks the 40h planning target by
        // however many PTO hours this employee logged that week, floored at PTO_MIN_TARGET_HRS.
        // Consumed by buildTopPerformers_ (server) and computeRkScore (client mirror) instead
        // of the flat SCORE_PLANNED_CAP_HRS, so a PTO week isn't scored as under-planned.
        ptoAdjustedTargetHrs: Math.max(CONFIG_PS.PTO_MIN_TARGET_HRS, CONFIG_PS.SCORE_PLANNED_CAP_HRS - ptoHrsForWeek),
        ptoHealth:   pto[l]     && pto[l].byEmployee[norm]     ? pto[l].byEmployee[norm]     : null,
        kudos:       w.isFuture  ? null : (kudos[l]   && kudos[l].byEmployee[norm]    != null ? kudos[l].byEmployee[norm]    : null),
        // No unconditional isFuture null here — during the Goals grace period, future
        // weeks can carry the outgoing quarter's frozen snapshot (see computePSReport_).
        goalsDetail: (goals[l] && goals[l].byEmployee[norm] != null) ? goals[l].byEmployee[norm] : null,
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
      team:        profile.team || null,
      isRampUp:    profile.isRampUp || false,
      isCrewMember: profile.isCrewMember || false,
      // Epoch ms (JSON-safe) — drives the Performance Record tenure label. Crew
      // rows and legacy cached payloads may lack it; the client renders nothing.
      hireDate:    profile.hireDate ? profile.hireDate.getTime() : null,
      // Time-mandate flags — the client mirrors the server carve-out with these
      // (absent on a stale cached payload, which reads as tracking-eligible).
      tracksTime:  profile.tracksTime !== false,
      onLeave:     profile.onLeave || false,
      // People-manager cohort flag — drives the manager-vs-IC bar in the brief and
      // the KPI cards. Absent on a stale payload, which reads as an all-IC team.
      isManager:   profile.isManager === true,
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
      // Time metrics only: non-tracking families and long leave leave the sums.
      // The PTO / kudos / goals counters in this same loop are unaffected.
      const inTimePop = profile.tracksTime !== false && !profile.onLeave;
      weeks.forEach(w => {
        const l = w.label;
        const c = g.weeks[l];
        if (!w.isFuture) {
          if (inTimePop) c.trackedHrs += (tracked[l] && tracked[l].byEmployee[norm]) || 0;
          const kd = kudos[l] && kudos[l].byEmployee[norm];
          c.kudos += kd ? kd.count : 0;
          const gd = goals[l] && goals[l].byEmployee[norm];
          if (gd) { c.goalsTotal++; if (gd.compliant) c.goalsCompliant++; }
        }
        if (!w.isPast && inTimePop) {
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

  // Long leave is excluded like ramp-up: a partial or absent week is an absence,
  // not a ranking signal. Non-tracking families stay IN — their weights simply
  // carry no tracked/planned component (weightsForEmployee_).
  const scored = employees
    .filter(e => !e.isRampUp && !e.onLeave)
    .map(e => {
      const wd = e.weeks && e.weeks[targetWeek.label];
      if (!wd) return null;

      const W = weightsForEmployee_(e, matrix, catalog, baseW, audit);

      const plannedTargetHrs = wd.ptoAdjustedTargetHrs != null ? wd.ptoAdjustedTargetHrs : CONFIG_PS.SCORE_PLANNED_CAP_HRS;
      // Fallback (no planned hours that week) used to be a flat DEFAULT_TARGET_WEEKLY_HRS
      // (36h) — that zeroed out tracked score on a full-PTO week, since plannedHrs is
      // already net-of-PTO by this point. Scaling the fallback off plannedTargetHrs keeps
      // it consistent with the same PTO adjustment.
      const trackedTarget = (wd.plannedHrs !== null && wd.plannedHrs > 0)
        ? wd.plannedHrs * CONFIG_PS.SCORE_TRACKED_RATIO
        : plannedTargetHrs * CONFIG_PS.SCORE_TRACKED_RATIO;
      // Target-floor check first: a full-PTO week (target 0) earns full tracked credit even
      // when nothing was logged — production emits null (not 0) trackedHrs for empty weeks.
      const trackedNorm = trackedTarget <= 0 ? 1 : (wd.trackedHrs === null ? 0 : Math.min(1, wd.trackedHrs / trackedTarget));
      const plannedNorm = wd.plannedHrs === null ? 0 : (plannedTargetHrs <= 0 ? 1 : Math.min(1, wd.plannedHrs / plannedTargetHrs));
      // Weeks outside the real compliance window only carry comment-trend fields (no
      // .compliant) — treat those as "no data" (excluded below) instead of "0 compliant".
      const hasGoalsData = !!(wd.goalsDetail && wd.goalsDetail.compliant !== undefined);
      const goalsNorm   = (hasGoalsData && wd.goalsDetail.compliant) ? 1 : 0;
      const rcrNorm     = (e.rcr && e.rcr.value !== null) ? Math.min(1, e.rcr.value / CONFIG_PS.RCR_HEALTHY) : null;
      // Kudos: 50% for receiving any, 50% for giving any → full credit when both
      const kudosRecv = wd.kudos && wd.kudos.count > 0;
      const kudosGave = wd.kudos && (wd.kudos.givenCount || 0) > 0;
      const kudosNorm = (kudosRecv ? 0.5 : 0) + (kudosGave ? 0.5 : 0);
      // SI: 1–5 scale → 0–1 by dividing by 5 (score 5 = full 100%, score 1 = 20%)
      const siNorm      = (e.si && e.si.value != null) ? e.si.value / CONFIG_PS.SI_MAX_SCORE : null;
      // PTO: binary Good = 1, At Risk = 0; excluded when no health snapshot
      const ptoNorm     = wd.ptoHealth ? (wd.ptoHealth.status === "Good" ? 1 : 0) : null;

      let availW = (hasGoalsData ? W.goals : 0) + W.tracked + W.planned + W.kudos;
      let earned = (hasGoalsData ? goalsNorm * W.goals : 0) + trackedNorm * W.tracked + plannedNorm * W.planned + kudosNorm * W.kudos;

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
    // Full-active-set aggregate (like _weeklyCommenters) — not re-scoped to the subset.
    _openGoals: goalsAll._openGoals || null,
    _audit: (goalsAll._audit || []).filter(e => subset.has(e.normName)),
  };
  for (const [wk, b] of Object.entries(goalsAll)) {
    if (wk === '_weeklyCommenters' || wk === '_audit' || wk === '_openGoals') continue;
    let compliant = 0, total = 0;
    const byEmp = {};
    for (const [norm, v] of Object.entries(b.byEmployee || {})) {
      if (!subset.has(norm)) continue;
      byEmp[norm] = v;
      // Weeks outside the real compliance-evaluation window (older than the current +
      // grace-period-previous quarter) only ever get comment-trend fields written onto
      // byEmployee (selfCommentCount/g03Commented/g01Commented) — v.compliant is never
      // set for those. Counting them toward total would show a fake "0 / N" instead of
      // the "no compliance data for this week" it actually is.
      if (v.compliant === undefined) continue;
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
    const rows = memoSheetData_("bound::" + CONFIG_PS.SHEET_PH, () => {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(CONFIG_PS.SHEET_PH);
      return sh ? sh.getDataRange().getValues() : null;
    });
    if (!rows) return [];
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
//
// Net planned is also clamped to the PTO-adjusted weekly capacity (spec 2026-08-02
// §4.4): Tempo duplicates a person's plan across every project they are staffed on,
// so raw planned routinely exceeds a working week. Normalized silently — the skew is
// systemic, not a per-person data-quality issue worth flagging. byEmployeeProjects
// stays raw: it IS the per-project breakdown where the duplication lives.
function subtractPTOFromPlanned_(plannedAll, ptoUsageByWeek) {
  const out = {};
  Object.keys(plannedAll).forEach(wLabel => {
    const src  = plannedAll[wLabel] || { totalHrs: 0, headcount: 0, byEmployee: {} };
    const ptos = (ptoUsageByWeek[wLabel] || {}).byEmployee || {};
    const netByEmp = {}, ptoByEmp = {};
    let totalNet = 0, hcNet = 0;

    Object.entries(src.byEmployee).forEach(([norm, hrs]) => {
      const ptoHrs  = ptos[norm]  || 0;
      const capHrs  = Math.max(CONFIG_PS.PTO_MIN_TARGET_HRS,
                               CONFIG_PS.SCORE_PLANNED_CAP_HRS - ptoHrs);
      const netHrs  = Math.min(Math.max(0, hrs - ptoHrs), capHrs);
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

// True for the roles that see the WHOLE roster — superadmin, admin, viewer.
// Everyone else is manager-scoped. Kept as one predicate so the cache key and
// the scope branch can never disagree about who gets a full-roster payload.
function seesFullRoster_(access) {
  return access.role === "superadmin" || access.role === "admin" || access.role === "viewer";
}

// Cache key for one (team × user scope) report entry — superadmins/admins/viewers
// share one entry per team; managers get per-email entries (scoped payloads differ).
//
// The shared entry is deliberately IMPERSONAL: it is built once (usually by the
// warmer) and then personalised per caller by applySelfExclusion_ on the way out.
// Never bake anything caller-specific into it — see the userRole note there.
function reportCacheKey_(ver, teamKey, access) {
  return seesFullRoster_(access)
    ? "ps_v" + ver + "_" + teamKey + "_admin"
    : "ps_v" + ver + "_" + teamKey + "_" + access.email;
}

// ── Self-exclusion + per-caller personalisation ──────────────────────────────
// Applied to EVERY payload on its way out of getPSReportData, cache hit or fresh
// compute alike. Two jobs, both of which must happen after the cache read:
//
//  1. userRole/userEmail are stamped per caller. The full-roster entry is shared
//     across superadmin, admin and viewer, so the role frozen into it at build
//     time belongs to whoever built it — usually the warmer. Left alone, a viewer
//     landing on a superadmin-built entry would be handed userRole:"superadmin"
//     and with it the 📈 Performance Record tab and the Access Control menu.
//
//  2. The caller's own roster row is stripped unless they are a superadmin.
//     A rocketeer's evaluation belongs on their MANAGER's dashboard, never their
//     own — so their row leaves employees[], the Top Rocketeers board, the goals
//     audit and every per-person map keyed by normName. Team aggregates keep
//     counting them: those are team truth, and one row among many is not a
//     readable evaluation. Manager scope goes further and drops the anchor before
//     computing (see resolveManagerScope_'s caller), so a small org tree cannot
//     be back-solved from its own totals.
function applySelfExclusion_(payload, access) {
  if (!payload || payload.ok === false) return payload;

  payload.userRole  = access.role;
  payload.userEmail = access.email;
  payload.meta      = payload.meta || {};
  // 👁 View-as stamp — who is being previewed, and by whom. Per-caller like the
  // role above: the shared cache entry never carries it.
  payload.meta.viewAs = access.viewAs || null;

  if (isSuperAdmin_(access)) {
    payload.meta.selfExcluded = false;
    payload.meta.selfName     = null;
    return payload;
  }

  const selfName = access.selfRosterName || null;
  payload.meta.selfName = selfName;

  if (!selfName) {
    // Nothing to strip — and the flag must SAY so. selfExcluded drives the header
    // badge's "Your own record is not shown here", so claiming true here tells the
    // caller their row is hidden while it is sitting in Top Rocketeers. The cause is
    // always the same: their Google account did not match an active roster Email
    // cell (alias, blank cell, or a row dropped as inactive/intern), so
    // _resolveSelfRosterName_ returned null. Silent non-enforcement plus a false
    // assurance is worse than either alone, so it is flagged and logged instead.
    payload.meta.selfExcluded   = false;
    payload.meta.selfUnresolved = true;
    Logger.log(`⚠️ Self-exclusion (${access.role}): ${access.email} did not match an active ` +
               `roster Email cell — NOTHING was stripped and their own record IS visible to them. ` +
               `Fix the roster Email cell, or make the omission deliberate by granting super-admin.`);
    return payload;
  }

  payload.meta.selfExcluded   = true;
  payload.meta.selfUnresolved = false;

  const selfNorm = normPS_(selfName);
  const drop = obj => { if (obj && typeof obj === "object") delete obj[selfNorm]; };

  if (Array.isArray(payload.employees)) {
    payload.employees = payload.employees.filter(e => e.normName !== selfNorm);
  }
  if (payload.topPerformers && Array.isArray(payload.topPerformers.performers)) {
    payload.topPerformers.performers =
      payload.topPerformers.performers.filter(p => p.normName !== selfNorm);
  }
  if (Array.isArray(payload.goalsAudit)) {
    payload.goalsAudit = payload.goalsAudit.filter(a => a.normName !== selfNorm);
  }
  if (Array.isArray(payload.ptoQ4History)) payload.ptoQ4History.forEach(w => drop(w.byEmp));
  if (payload.goalsQ4Hist) Object.keys(payload.goalsQ4Hist).forEach(wk => drop(payload.goalsQ4Hist[wk]));
  drop(payload.meta.rcrByEmployee);
  drop(payload.meta.siByEmployee);

  Logger.log(`Self-exclusion (${access.role}): removed "${selfName}" from the payload for ${access.email}`);
  return payload;
}

function getPSReportData(bustCache, teamKey, viewAs) {
  try {
    const execT0 = Date.now();   // team-warm loop budgets against the ~6-min execution cap
    const caller = checkDashboardAccess();

    if (!caller.allowed) {
      return { ok: false, denied: true, email: caller.email, accessInfo: accessDeniedInfo_() };
    }

    // ── 👁 View as (super admins only) ──────────────────────────────────────
    // Swaps in the TARGET's verdict for everything below — team pin, cache key,
    // org-tree scope, self-exclusion — so the payload is what that person would
    // truly be served. Throws for any other caller. The real identity still
    // gated above, and no other endpoint honours the target: the preview is
    // read-only by construction. See resolveViewAsAccess_ in PS Security.js.
    const access = resolveViewAsAccess_(caller, viewAs);
    // Every denial carries who was being previewed, so the frontend can show
    // "this person would be denied — <reason>" instead of the denied page.
    const denied_ = extra => Object.assign(
      { ok: false, denied: true, email: access.email, accessInfo: accessDeniedInfo_(),
        viewAs: access.viewAs || null }, extra || {});

    if (!access.allowed) return denied_();

    let team = teamByKey_(teamKey);   // unknown/missing → services (legacy callers unchanged)

    // ── Team pin (viewers) ────────────────────────────────────────────────────
    // A team-scoped role sees ONE org team — their own, derived from their roster
    // Class. The requested teamKey is OVERRIDDEN here, never merely validated, and
    // it happens BEFORE the cache key is built for two reasons:
    //   • a viewer must not be able to widen their own view by asking for another
    //     team (the request comes from the client and is not trustworthy);
    //   • viewers share the per-team `_admin` cache entries with admins, so serving
    //     R&D data under the Services key would poison what every admin then reads.
    // A viewer with no roster row (an externally granted stakeholder) resolves to
    // null and keeps the company-wide view — the admin who added them chose that.
    if (isTeamScoped_(access)) {
      const pinned = resolveTeamScope_(access);
      if (pinned) {
        if (pinned !== team.key) {
          Logger.log(`Team pin: ${access.email} requested "${team.key}" → serving "${pinned}"`);
        }
        team = teamByKey_(pinned);
      }
    }

    // ── CacheService — gzip-chunked cache per (team × user scope), see cachePutLarge_.
    // TTL = CONFIG_PS.CACHE_TTL_SEC; warmReportCache rewrites the admin entries
    // every CACHE_WARM_EVERY_MIN minutes so they never go cold.
    // Note: an out-of-scope team request caches its fallback payload under the
    // REQUESTED team's key — harmless, the payload self-identifies via meta.team.
    const _sCache   = CacheService.getScriptCache();
    const _cacheVer = reportCacheVer_();
    const _cacheKey = reportCacheKey_(_cacheVer, team.key, access);

    // Skip cache if bustCache=true (refresh button clicked, or the warmer trigger)
    if (!bustCache) {
      const _hit = cacheGetLarge_(_sCache, _cacheKey);
      if (_hit) {
        // JSON.parse hands back a fresh object every time, so applySelfExclusion_
        // can mutate it freely — the cached string is untouched and stays shared.
        try { return applySelfExclusion_(JSON.parse(_hit), access); } catch(ce) { /* corrupt entry — fall through to live read */ }
      }
    }

    const weights = readWeightSettings_();
    const weeks   = buildWeekWindow_PS_();
    // Org edges of the rows readPSRoster_ drops — resolveManagerScope_ walks
    // through them so a dropped mid-level manager cannot hide their sub-tree.
    const rosterBridges = new Map();
    const fullRoster = readPSRoster_(rosterBridges);

    // Team tagging needs the Job Catalog (JF004 / JF018 detection). Read once here
    // and pass through to computePSReport_ (which previously read it itself).
    const jobCatalog = readJobCatalog_();
    // Resolved against the FULL roster, before any manager-scope filtering — a
    // scoped view must not lose someone's manager status just because their
    // reports fall outside the requested org tree.
    const supervisorNorms = activeSupervisorNames_(fullRoster);
    fullRoster.forEach(p => {
      p.team       = teamForProfile_(p, jobCatalog);
      // Same catalog, one resolution point: every downstream consumer (time
      // populations, scoring mask, employee payload) reads this one flag.
      p.tracksTime = tracksTime_(p, jobCatalog);
      p.isManager  = isPeopleManager_(p, jobCatalog, supervisorNorms);
    });
    const exemptCount = [...fullRoster.values()].filter(p => !p.tracksTime).length;
    const onLeaveCount = [...fullRoster.values()].filter(p => p.onLeave).length;
    const mgrCount = [...fullRoster.values()].filter(p => p.isManager).length;
    log_(`Time mandate: ${fullRoster.size - exemptCount} tracking-required, ${exemptCount} exempt (non-tracking family), ${onLeaveCount} on long leave.`);
    log_(`Manager cohort: ${mgrCount} people managers (Job Catalog track M or ≥1 direct report), ${fullRoster.size - mgrCount} ICs.`);

    // Sales & Success only materializes when To-be-Allocated titles match the Job
    // Catalog with family JF004 — list the ones that didn't so an admin can see
    // exactly which titles to add (Job Catalog sheet: Family = JF004 + Track/Level).
    const tbaMissed = [...new Set([...fullRoster.values()]
      .filter(p => p.team === "rnd" && String(p.cls || "").trim().toLowerCase() === "to be allocated")
      .map(p => p.jobTitle))];
    if (tbaMissed.length > 0) {
      Logger.log(`ℹ️ To-be-Allocated titles not matched to JF004 (in R&D until added to the Job Catalog with Family=JF004): ${tbaMissed.join(" | ")}`);
    }

    // ── Manager scope resolution ──────────────────────────────────────────────
    // Determines whether this user should see a subset of the roster.
    // Admin and Viewer see everything; Manager sees their org tree only.
    // Scope resolves on the FULL roster first; the team filter applies after,
    // so a manager can never widen visibility by requesting another team.
    let managerNorm      = null;
    let managerScopeName = null;
    let roster           = fullRoster;

    if (!seesFullRoster_(access)) {
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
        // Bridges count as evidence the anchor exists: a supervisor whose only
        // direct reports were dropped rows is still a real supervisor, and the
        // walk may well reach live people below them. Saying "no roster entry
        // matches" there would be false; if the tree really is empty the next
        // guard says so accurately.
        const scopeIsValid = fullRoster.has(managerNorm) ||
          [...fullRoster.values()].some(p => normPS_(p.supervisor) === managerNorm) ||
          [...rosterBridges.values()].some(b => b.supNorm === managerNorm);
        if (!scopeIsValid) {
          Logger.log(`⚠️ Access denied — scope "${managerScopeName}" not found in active roster: ${access.email}`);
          return denied_({
                   reason: `No roster entry matches "${managerScopeName}". If this is a delegate ` +
                           `entry, the supervisor name must match the roster spelling exactly.` });
        }
        const scope = resolveManagerScope_(fullRoster, managerNorm, rosterBridges);
        // The anchor's OWN row leaves the scope: a manager's evaluation is their
        // manager's business, so it never appears on their own dashboard — and
        // dropping it before compute (rather than stripping it after) keeps it
        // out of the org tree's aggregates too, which matters when the tree is
        // small enough that totals would give the missing row away. A delegate
        // sees exactly what the supervisor they proxy for sees, so the anchor
        // goes for them as well.
        scope.delete(managerNorm);
        if (scope.size === 0) {
          // PS Security's roster read and readPSRoster_ do NOT filter identically:
          // the report additionally drops interns (EXCLUDE_INTERNS) and rows whose
          // Class is unknown. So a supervisor can clear the access gate — "has ≥1
          // active direct report" — and still have an empty tree here. Telling them
          // "Access Restricted" would be a lie: their access is fine, the report
          // simply covers nobody they manage. Say that instead.
          Logger.log(`⚠️ Empty scope — "${managerScopeName}" has reports on the roster but none ` +
                     `inside the report population (interns and unknown-Class rows are excluded): ${access.email}`);
          return denied_({
                   reason: "Your team is not covered by this report. Everyone reporting to you is " +
                           "either an intern or outside the job families this dashboard tracks." });
        }
        roster = new Map([...fullRoster].filter(([n]) => scope.has(n)));
        Logger.log(`Manager scope resolved: ${scope.size} employees under "${managerScopeName}" (own row excluded)`);
      } else {
        Logger.log(`Access denied (no roster scope): ${access.email}`);
        return denied_();
      }
    }

    // ── Team filter (after scope) ─────────────────────────────────────────────
    // Serve the requested team, or fall back to the caller's first non-empty team
    // (registry order) when the request is empty in their scope — server-side
    // gating, the frontend snaps its toggle to meta.team.
    // Teams this caller may switch between — drives meta.availableTeams (the
    // frontend toggle), the team-warm loop and the background prefetch. A pinned
    // viewer gets exactly one entry, so the toggle offers nothing to widen to and
    // no execution time is spent warming teams they will never be served.
    let teamsInScope = availableTeams_(roster);
    if (isTeamScoped_(access)) {
      const pinnedList = teamsInScope.filter(t => t.key === team.key);
      if (pinnedList.length) teamsInScope = pinnedList;
    }
    let servedTeam = team;
    let teamScoped = teamRoster_(roster, team.key);
    if (teamScoped.size === 0) {
      const fallback = teamsInScope.length ? teamByKey_(teamsInScope[0].key) : teamByKey_("services");
      Logger.log(`Team "${team.key}" empty in scope for ${access.email} — serving "${fallback.key}"`);
      servedTeam = fallback;
      teamScoped = teamRoster_(roster, servedTeam.key);
    }
    Logger.log(`Team "${servedTeam.key}": ${teamScoped.size} of ${roster.size} in-scope employees`);

    const result = computePSReport_(access, teamScoped, managerScopeName, weeks, weights, servedTeam, jobCatalog, teamsInScope);
    // Cache BEFORE personalising: JSON.stringify runs first, so the stored copy
    // is the impersonal one every caller can safely be served from.
    cachePutLarge_(_sCache, _cacheKey, JSON.stringify(result), CONFIG_PS.CACHE_TTL_SEC);

    // ── Team-warm: build the caller's OTHER teams in this same execution ────
    // The sheet memo (loadSheet_PS_ / memoSheetData_) makes each extra team
    // pure in-memory assembly — no repeat sheet I/O — so one cold compute
    // leaves every in-scope team cached for this user's scope and the team
    // toggle serves from cache instead of a fresh multi-minute execution.
    // Budget-gated against the ~6-min execution cap; failures log and never
    // risk the primary response. Scope security is inherited: `roster` is
    // already scope-filtered, so a manager's warm entries stay org-tree-only.
    const TEAM_WARM_BUDGET_MS = 4.5 * 60 * 1000;
    teamsInScope.forEach(t => {
      if (t.key === servedTeam.key) return;
      if (Date.now() - execT0 > TEAM_WARM_BUDGET_MS) { Logger.log(`⚠️ team-warm: budget spent — skipped "${t.key}"`); return; }
      try {
        const tTeam   = teamByKey_(t.key);
        const tScoped = teamRoster_(roster, tTeam.key);
        if (tScoped.size === 0) return;
        const tCacheKey = reportCacheKey_(_cacheVer, tTeam.key, access);
        if (!bustCache && cacheGetLarge_(_sCache, tCacheKey)) return;   // already warm
        const s0 = Date.now();
        const tRes = computePSReport_(access, tScoped, managerScopeName, weeks, weights, tTeam, jobCatalog, teamsInScope);
        cachePutLarge_(_sCache, tCacheKey, JSON.stringify(tRes), CONFIG_PS.CACHE_TTL_SEC);
        Logger.log(`✅ team-warm[${tTeam.key}]: built in ${Math.round((Date.now() - s0) / 1000)}s`);
      } catch (te) {
        Logger.log(`❌ team-warm[${t.key}]: ${te.message}`);
      }
    });

    return applySelfExclusion_(result, access);
  } catch(e) {
    Logger.log(`❌ getPSReportData: ${e.message}\n${e.stack}`);
    return { ok: false, error: e.message };
  }
}

// Empty stand-ins for readers a team's metric set skips (R&D / Sales have no
// RCR, Tracked or Planned data). Shapes mirror the fields consumers touch.
function emptyRcrResult_() {
  return { lastMonth: null, teamRCR: null, tier: "No Data",
           byEmployee: {}, rcrHistory: [], rcrByEmployee: {} };
}
function emptyTrackedResult_() { return { _lastExport: null }; }

// All data reads, FTE filtering, and result assembly for getPSReportData.
// Called after access control, scope resolution and team filtering; the caller
// handles caching. `team` = TEAMS_ entry served; `jobCatalog` = readJobCatalog_()
// (read once by the caller for team tagging); `availableTeams` = teams present
// in the caller's scope (drives the frontend toggle).
function computePSReport_(access, roster, managerScopeName, weeks, weights, team, jobCatalog, availableTeams) {
  const hasM = k => teamHasMetric_(team, k);
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
  // Time-metric population (spec 2026-08-02 §4.1): FTE, minus non-tracking
  // families, minus long leave. The single carve point — filtering the tracked /
  // planned subsets here propagates to buildTeamSummary_, trackedHistory and
  // meta.trackedCurWeek without each of them re-deriving the rule.
  const timeRoster     = new Map([...fteRoster].filter(([, p]) => p.tracksTime !== false && !p.onLeave));
  // Manager/IC split of that same population (spec §6). Only the manager subset is
  // aggregated separately — the IC figures are derived by subtraction downstream, so
  // the two cohorts always reconcile exactly to the team total no matter how the
  // classification changes.
  const timeRosterMgr  = new Map([...timeRoster].filter(([, p]) => p.isManager === true));
  const timeRosterIC   = new Map([...timeRoster].filter(([, p]) => p.isManager !== true));
  // Denominators that predate this change keep their meaning: on-leave people were
  // previously dropped from the roster entirely, so excluding them here reproduces
  // the old value exactly rather than diluting it (spec §4.3).
  const fteOnRoll      = new Map([...fteRoster].filter(([, p]) => !p.onLeave));

  // ── Reads that differ by roster scope: RCR, SI, PTO ───────────────────────
  // These compute weighted ratios or per-employee averages that cannot be derived
  // by simple subtraction, so both full-roster and FTE variants are read separately.
  // Single read each — byEmployee covers all active, team aggregates scope to FTE.
  // RCR obligation follows the time mandate (2026-08-05 extension of spec
  // 2026-08-02): JF008/JF015/JF017/JF018 and embedded ops bill sporadically, so
  // their months in the SUM(RC)/SUM(TCC) ratio read as team underperformance for
  // work they were never expected to bill. The team aggregate and history months
  // therefore scope to the tracking-mandated subset; individual values still
  // cover every active rocketeer (informational on their own row).
  const ctx       = computeFiscalContext_();
  const rcrActive = new Map([...fteActive].filter(([, p]) => p.tracksTime !== false));
  const rcrAll    = hasM("rcr") ? readRCR_PS_(active, rcrActive) : emptyRcrResult_();
  const siAll  = readSI_PS_(active, fteActive, ctx);
  Logger.log(`SI coverage [${team.key}]: ${Object.keys(siAll.byEmployee || {}).length} of ${active.size} active employees have an SI value`);

  const teamDepts   = new Set([...roster.values()].map(p => p.dept).filter(Boolean));
  const ptoProfiles = readPTOAccumulationProfiles_(teamDepts);   // shared (loaded once)
  // Hoisted here (rather than down near subtractPTOFromPlanned_) so both
  // readGoalsEngagement_ calls below can exempt full-week-PTO rocketeers from the
  // self-comment pacing rule using the same empNum→normName bridge.
  const empNumToNorm  = rosterIdMap_(roster, 'employeeNumber');
  const currentQWeeks = buildCurrentQWeeks_PS_(ctx);

  // Two-quarter continuity window: the prior quarter's weeks are ALWAYS merged (not
  // only during the grace period) so Goals/PTO history and per-employee weeks span two
  // fiscal quarters for the Month/Quarter period views (spec 2026-07-07). The prior
  // quarter's compliance is evaluated against its OWN goal set via prevCtx.
  // A quarter boundary can fall mid-week, so the last previous-quarter week and the
  // first current-quarter week can share the same ISO week label — dedupe, keeping the
  // current-quarter copy so it wins the same way goalsAll's merge does below.
  const prevQWeeks = buildPrevQWeeks_PS_(ctx);
  const prev2QWeeks = buildPrev2QWeeks_PS_(ctx);
  const prevCtx = {
    goalsQuarter:  ctx.prevGoalsQuarter,
    qStartIsoYear: ctx.prevQStartIsoYear,
    qStartIsoWeek: ctx.prevQStartIsoWeek,
    inGracePeriod: false,
    // This run evaluates a quarter that has already ended — unlocks the closed-quarter
    // compliance override (path C): all goals closed + 8 completed → compliant, regardless
    // of Canceled / Not Completed leftovers. Never set on the in-progress quarter's run.
    quarterClosed: true,
  };
  const goalsPrevResult = readGoalsEngagement_(active, prevQWeeks, [], prevCtx, ptoProfiles, empNumToNorm);
  // Third goals run: the prev-prev quarter, evaluated against its own goal set,
  // closed-quarter override on. If the Goals sheet no longer carries that
  // quarter's rows this returns empty weeks and the client renders gray
  // ("no goals data") — degradation, not breakage.
  const prev2Ctx = {
    goalsQuarter:  ctx.prev2GoalsQuarter,
    qStartIsoYear: ctx.prev2QStartIsoYear,
    qStartIsoWeek: ctx.prev2QStartIsoWeek,
    inGracePeriod: false,
    quarterClosed: true,
  };
  const goalsPrev2Result = readGoalsEngagement_(active, prev2QWeeks, [], prev2Ctx, ptoProfiles, empNumToNorm);
  const currentQLabels  = new Set(currentQWeeks.map(w => w.label));
  // Three-quarter continuity window (prev2 → prev → current), deduped by label
  // with the most-current copy winning — same rule the two-quarter window used.
  const prevQLabels = new Set(prevQWeeks.map(w => w.label));
  const continuityQWeeks = prev2QWeeks.filter(w => !prevQLabels.has(w.label) && !currentQLabels.has(w.label))
    .concat(prevQWeeks.filter(w => !currentQLabels.has(w.label)))
    .concat(currentQWeeks);

  // Goals-only grace period (CONFIG_PS.GOALS_GRACE_DAYS): freeze the outgoing quarter's
  // final week as the carried-forward snapshot. Only the snapshot behavior is gated on
  // the grace period now — the window widening above is unconditional.
  let goalsFrozenSnapshot = null;
  let graceEndMonday      = null;
  if (ctx.inGracePeriod) {
    const lastPrevWeek = prevQWeeks[prevQWeeks.length - 1];
    goalsFrozenSnapshot = lastPrevWeek ? goalsPrevResult[lastPrevWeek.label] : null;
    graceEndMonday = mondayOfIsoWeek_PS_(ctx.graceEndIsoYear, ctx.graceEndIsoWeek);
  }
  const continuityQPastWeeks = continuityQWeeks.filter(w => !w.isFuture);

  const ptoAllWeeks = continuityQWeeks.concat(weeks.filter(w => w.isFuture));
  const ptoAll  = readPTOPlanningHealthByWeek_(roster,    ptoAllWeeks, ptoProfiles);
  const ptoFTE  = readPTOPlanningHealthByWeek_(fteOnRoll, weeks,   ptoProfiles);

  // ── Reads that are sum-decomposable: Kudos, Tracked, Planned, Goals ────────
  // Read once for the full roster/active set then filter to FTE in-process,
  // eliminating duplicate sheet API calls for these large data sources.
  const histWeeks    = buildHistWeeks_(CONFIG_PS.TRACKED_HIST_WEEKS);
  const extWeeks     = [...histWeeks, ...weeks];
  const extPastWeeks = extWeeks.filter(w => !w.isFuture);
  // PTO Trend (Trends tab) covers the two-quarter continuity window (current + prior fiscal
  // quarter), not the long TRACKED_HIST_WEEKS rolling history Tracked/Planned/Kudos use.
  // We only care to see PTO planning health for the current and prior quarters.
  const ptoQ4FTE = readPTOPlanningHealthByWeek_(fteOnRoll, continuityQPastWeeks, ptoProfiles);

  const kudosAll   = readKudosByWeek_(active,  extWeeks);
  const trackedAll = hasM("tracked") ? readTrackedTimeByWeek_(roster, extWeeks) : emptyTrackedResult_();
  const plannedAll = hasM("planned") ? readPlannedTimeByWeek_(roster, extWeeks) : {};
  // Goals: pass extPastWeeks so _weeklyCommenters is populated in this single read.
  const goalsCurrentResult = readGoalsEngagement_(active, currentQWeeks, extPastWeeks, ctx, ptoProfiles, empNumToNorm);
  const goalsAll = mergeGoalsResults_(
    mergeGoalsResults_(goalsPrev2Result, goalsPrevResult), goalsCurrentResult);

  // During the grace period, any displayed week inside the grace window shows, PER
  // EMPLOYEE, the outgoing quarter's frozen final-week snapshot for rocketeers who haven't
  // started logging real new-quarter goals yet — so "today" and the next couple of weeks
  // keep reporting last fiscal year's goals performance for THOSE INDIVIDUALS until the new
  // quarter's own goals catch up, while any rocketeer who already has real new-quarter data
  // keeps showing it. Doing this per employee (not swapping the whole week's data) means
  // one rocketeer logging a new-quarter goal can no longer blank out every OTHER
  // rocketeer's carried-forward Goals data when a manager filters down to just one of them.
  // Weeks already covered by goalsPrevResult (the outgoing quarter's own calendar weeks)
  // keep their real per-week data untouched.
  if (ctx.inGracePeriod && goalsFrozenSnapshot) {
    const hasNewGoals = employeesWithNewGoals_(goalsCurrentResult);
    weeks.forEach(w => {
      if (goalsPrevResult[w.label]) return;
      const wMon = mondayOfIsoWeek_PS_(w.year, w.isoWeek);
      if (wMon > graceEndMonday) return;
      const existing = goalsAll[w.label] || { byEmployee: {} };
      const frozenByEmployee = goalsFrozenSnapshot.byEmployee || {};
      const byEmployee = Object.assign({}, existing.byEmployee);
      const norms = new Set([...Object.keys(byEmployee), ...Object.keys(frozenByEmployee)]);
      let compliant = 0, total = 0;
      norms.forEach(norm => {
        const resolved = hasNewGoals.has(norm) ? byEmployee[norm] : (frozenByEmployee[norm] || byEmployee[norm]);
        byEmployee[norm] = resolved;
        if (resolved) { total++; if (resolved.compliant) compliant++; }
      });
      goalsAll[w.label] = Object.assign({}, existing, { byEmployee, compliant, total });
    });
  }

  // Per-employee goal comment flags for historical weeks (for filter-aware frontend rendering)
  const goalsQ4Hist = {};
  continuityQPastWeeks.forEach(w => {
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
  // empNumToNorm was hoisted above (shared with the Goals PTO exemption).
  const ptoUsageByWk  = buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, extWeeks);
  const plannedAdjAll = subtractPTOFromPlanned_(plannedAll, ptoUsageByWk);

  const kudosFTE    = filterKudosBySubset_(kudosAll,    fteActive);
  const trackedFTE  = filterTimeBySubset_(trackedAll,   timeRoster);
  const plannedFTE  = filterTimeBySubset_(plannedAdjAll, timeRoster);
  // Manager-cohort aggregates ride alongside the team totals in trackedHistory so
  // the brief can state each cohort's number without re-deriving hours client-side.
  const trackedMgr  = filterTimeBySubset_(trackedAll,   timeRosterMgr);
  const plannedMgr  = filterTimeBySubset_(plannedAdjAll, timeRosterMgr);
  const goalsFTE    = filterGoalsBySubset_(goalsAll,   fteActive);

  // ── Assembly ───────────────────────────────────────────────────────────────
  const phData        = readPHData_();
  const phByWeek      = buildPHByWeek_(phData, weeks, roster);
  const teamSummary   = buildTeamSummary_(weeks, rcrAll, siAll, ptoFTE, kudosFTE, trackedFTE, plannedFTE, goalsFTE);
  // continuityQWeeks spans the prior + current fiscal quarter (two-quarter continuity window)
  // up to now — append rolling future weeks so that per-employee planned hours for W+1 and W+2
  // are included in the employee table.
  const futureWeeks   = weeks.filter(w => w.isFuture);
  const employeeWeeks = futureWeeks.length ? continuityQWeeks.concat(futureWeeks) : continuityQWeeks;
  const employees     = buildEmployeeRows_(roster, employeeWeeks, rcrAll, siAll, ptoAll, kudosAll, trackedAll, plannedAdjAll, goalsAll);
  const fteEmployees  = employees.filter(e => !e.isCrewMember);

  // Family×Level scoring config: matrix + catalog resolve per-person weights;
  // `weights` (flat base) remains the universal fallback, so an unseeded
  // deployment scores exactly as before.
  const scoringMatrix = readScoringMatrix_();
  // Ship each employee's resolved weights ONLY when they differ from the flat base
  // (COE/non-contributor/override blocks). weightsForEmployee_ returns the base
  // object itself on every inherit path, so a reference check is exact — and
  // employees without scoreWeights keep following the live SCORE_W on the client
  // (weight preview still works for them).
  employees.forEach(e => {
    const w = weightsForEmployee_(e, scoringMatrix, jobCatalog, weights, null);
    if (w !== weights) e.scoreWeights = w;
  });
  const weightAudit   = [];
  const topPerformers = buildTopPerformers_(fteEmployees, weeks,
    { matrix: scoringMatrix, catalog: jobCatalog, base: weights, audit: weightAudit });
  if (weightAudit.length) {
    Logger.log(`⚠️ Weight resolution misses: ${weightAudit.length} (${[...new Set(weightAudit.map(a => a.reason))].join(", ")})`);
  }

  const curWeek  = weeks.find(w => w.isCurrentWeek) || weeks[Math.floor(weeks.length / 2)];
  const curGoals = goalsFTE[curWeek.label] || { compliant: 0, total: 0 };

  const goalsComm = goalsFTE._weeklyCommenters || {};
  const fte     = fteOnRoll.size  || 1;   // goals-comment percentages (unchanged meaning)
  const fteTime = timeRoster.size || 1;   // tracked/planned percentages (carve-out applied)
  const trackedHistory = extPastWeeks.map(w => {
    const d    = trackedFTE[w.label] || {};
    const p    = plannedFTE[w.label] || {};
    const dm   = trackedMgr[w.label] || {};
    const pm   = plannedMgr[w.label] || {};
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
      trackedPct:           Math.round(hc / fteTime * 100),
      plannedHrs:           phrs,
      plannedHC:            phc,
      avgPlannedHrs:        phc > 0 ? Math.round(phrs / phc * 10) / 10 : 0,
      plannedPct:           Math.round(phc / fteTime * 100),
      // Manager-cohort slice of the four numbers above (spec §6). Subsets of the
      // team totals, never additions — IC = total − manager on every one of them.
      // Absent on a payload built before this change; consumers fall back to the
      // single-cohort prose when mgrHeadcount is undefined.
      mgrHeadcount:         dm.headcount || 0,
      mgrTotalHrs:          dm.totalHrs  || 0,
      mgrPlannedHC:         pm.headcount || 0,
      mgrPlannedHrs:        pm.totalHrs  || 0,
      kudosCount:           k.count || 0,
    };
  });

  // Bounded to the two-quarter continuity window (current + prior fiscal quarter).
  const ptoQ4History = continuityQPastWeeks.map(w => {
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
    q4Weeks:          continuityQWeeks,
    weights,
    headcount: fteOnRoll.size,
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
      team:           { key: team.key, label: team.label, metrics: team.metrics },
      availableTeams: availableTeams || [],
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
      // Prev-quarter open-status truth (from the closed-quarter run): rocketeers with
      // ≥1 goal still In Progress / Planned. Drives the grace-window closure concern.
      prevQOpenGoals:   goalsPrevResult._openGoals || null,
      fiscalContext:    ctx,
      rampUpCount:      [...fteOnRoll.values()].filter(p => p.isRampUp).length,
      activeCount:      fteActive.size,
      // Denominator for tracked/planned coverage: FTE minus non-tracking families
      // minus long leave. The client mirrors this rule for filtered views.
      timeHeadcount:    timeRoster.size,
      // Manager/IC split of timeHeadcount — the denominators each cohort's coverage
      // percentage is measured against. They sum to timeHeadcount by construction.
      timeHeadcountMgr: timeRosterMgr.size,
      timeHeadcountIC:  timeRosterIC.size,
      managerCount:     [...fteOnRoll.values()].filter(p => p.isManager === true).length,
      exemptCount:      [...fteOnRoll.values()].filter(p => p.tracksTime === false).length,
      onLeaveCount:     [...fteRoster.values()].filter(p => p.onLeave).length,
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
    if (!hasAdminPower_(access)) return { ok: false, error: 'Admin access required' };

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
      generationConfig: {
        // Gemini 2.5 Flash is a thinking model: its internal reasoning tokens
        // count against maxOutputTokens. thinkingBudget: 0 disables thinking so
        // the whole budget goes to the visible JSON (a rewrite task needs none),
        // otherwise long briefs finish as MAX_TOKENS with truncated output.
        maxOutputTokens: 8192,
        temperature: 0.45,
        thinkingConfig: { thinkingBudget: 0 },
      },
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
    // Join every non-thought text part — the answer isn't guaranteed to be parts[0]
    // (thinking models may emit a thought part first, or split text across parts).
    const text = (candidate?.content?.parts || [])
      .filter(p => p && p.text && !p.thought)
      .map(p => p.text)
      .join('');

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

// Unit test for the PTO-adjusted weekly target. Run in the GAS editor, or in Node
// (stub Logger — see .superpowers/sdd/task-4-report.md for the sandbox pattern).
function _test_ptoAdjustedTargetHrs_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_ptoAdjustedTargetHrs_: " + msg); }

  const roster = new Map([
    [normPS_("Ana Smith"), { name: "Ana Smith", keyLocation: "Remote", supervisor: "Mgr", jobTitle: "Consultant", dept: "Services", isRampUp: false, isCrewMember: false }],
    [normPS_("Ben Lee"),   { name: "Ben Lee",   keyLocation: "Remote", supervisor: "Mgr", jobTitle: "Consultant", dept: "Services", isRampUp: false, isCrewMember: false }],
  ]);
  const weeks  = [{ label: "2026.W20", isFuture: false }];
  const normAna = normPS_("Ana Smith"), normBen = normPS_("Ben Lee");

  const planned = { "2026.W20": {
    byEmployee:    { [normAna]: 32, [normBen]: 0 },
    ptoByEmployee: { [normAna]: 8,  [normBen]: 40 },
    byEmployeeProjects: {},
  }};
  const emptyByWeek = { "2026.W20": { byEmployee: {} } };

  const employees = buildEmployeeRows_(roster, weeks, { byEmployee: {} }, { byEmployee: {} },
    emptyByWeek, emptyByWeek, emptyByWeek, planned, emptyByWeek);

  const ana = employees.find(e => e.normName === normAna);
  const ben = employees.find(e => e.normName === normBen);

  assert_(ana.weeks["2026.W20"].ptoAdjustedTargetHrs === 32, "Ana (8h PTO): expected target 32, got " + ana.weeks["2026.W20"].ptoAdjustedTargetHrs);
  assert_(ben.weeks["2026.W20"].ptoAdjustedTargetHrs === 0,  "Ben (40h PTO): expected target floored at 0, got " + ben.weeks["2026.W20"].ptoAdjustedTargetHrs);

  Logger.log("✅ _test_ptoAdjustedTargetHrs_ passed");
}

// Unit test for PTO-adjusted plannedNorm/trackedNorm in buildTopPerformers_.
function _test_ptoAdjustedScoring_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_ptoAdjustedScoring_: " + msg); }

  const weeks = [{ label: "2026.W20", isPast: true, dateRange: "May 11-17 2026" }];

  function emp(name, plannedHrs, ptoAdjustedTargetHrs, trackedHrs) {
    return {
      name: name, normName: normPS_(name), keyLocation: "Remote", supervisor: "Mgr",
      jobTitle: "Consultant", isRampUp: false, isCrewMember: false, rcr: null, si: null,
      weeks: { "2026.W20": {
        plannedHrs: plannedHrs, ptoAdjustedTargetHrs: ptoAdjustedTargetHrs, trackedHrs: trackedHrs,
        ptoPlannedHrs: null, ptoHealth: null, kudos: null, goalsDetail: null,
      }},
    };
  }

  // Normal week, no PTO: target stays 40h — unchanged from before this feature.
  const noPto      = emp("Ana Smith", 20, 40, 20);
  // Partial PTO week: 8h PTO -> target 32h. 32h planned now reads as fully planned
  // (was 32/40 = 80% before this fix).
  const partialPto = emp("Ben Lee",  32, 32, 32);
  // Full PTO week: target floors at 0h. 0 planned/0 tracked must read as fully
  // credited (1), not zeroed out or NaN.
  const fullPto     = emp("Cara Diaz", 0,  0,  0);
  // Realistic full-PTO week: production emits NULL (not 0) trackedHrs when nothing was
  // logged — must still earn full tracked credit via the target-floor branch.
  const fullPtoNull = emp("Dan Evans", 0,  0,  null);

  const cfg    = { matrix: {}, catalog: new Map(), base: DEFAULT_WEIGHTS_, audit: [] };
  const result = buildTopPerformers_([noPto, partialPto, fullPto, fullPtoNull], weeks, cfg);
  const byName = {};
  result.performers.forEach(p => { byName[p.name] = p.metrics; });

  assert_(byName["Ana Smith"].plannedNorm === 0.5, "no-PTO week: expected plannedNorm 0.5, got " + byName["Ana Smith"].plannedNorm);
  assert_(byName["Ben Lee"].plannedNorm === 1,     "partial-PTO week: expected plannedNorm 1 (32/32), got " + byName["Ben Lee"].plannedNorm);
  assert_(byName["Cara Diaz"].plannedNorm === 1,   "full-PTO week: expected plannedNorm 1 (target floor), got " + byName["Cara Diaz"].plannedNorm);
  assert_(byName["Cara Diaz"].trackedNorm === 1,   "full-PTO week: expected trackedNorm 1 (target floor), got " + byName["Cara Diaz"].trackedNorm);
  assert_(byName["Dan Evans"].trackedNorm === 1,   "full-PTO week with null tracked: expected trackedNorm 1, got " + byName["Dan Evans"].trackedNorm);
  assert_(byName["Dan Evans"].plannedNorm === 1,   "full-PTO week with null tracked: expected plannedNorm 1, got " + byName["Dan Evans"].plannedNorm);

  Logger.log("✅ _test_ptoAdjustedScoring_ passed");
}

// Unit test for the full-week-PTO exemption on Goals compliance Rule 3 (self-comment
// pacing). Stubs the Goals sheet read so no real spreadsheet access is needed.
function _test_goalsPtoExemption_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_goalsPtoExemption_: " + msg); }

  const week = { label: "2026.W20", monday: "2026-05-11", sunday: "2026-05-17", year: 2026, isoWeek: 20, isFuture: false };
  const ctx  = { goalsQuarter: "TESTQ", qStartIsoYear: 2026, qStartIsoWeek: 14, inGracePeriod: false };

  function goalRows(name, quarter) {
    const rows = [];
    for (let i = 1; i <= 8; i++) {
      rows.push([name, "Goal " + i, "In Progress", "", "", quarter]);
    }
    return rows;
  }
  const header = ["Rocketeer", "Goal Name", "Goal Status", "Comment Date", "Commentator", "Fiscal Quarter"];
  const data = [header]
    .concat(goalRows("Ana Smith", "TESTQ"))   // 40h PTO this week -> exempt
    .concat(goalRows("Ben Lee",   "TESTQ"))   // 0h PTO -> not exempt, fails rule 3
    .concat(goalRows("Cara Diaz", "TESTQ"));  // 39h PTO (just under 40) -> not exempt

  globalThis.SpreadsheetApp = {
    openById: function() {
      return { getSheetByName: function() {
        return { getDataRange: function() { return { getValues: function() { return data; } }; } };
      }};
    }
  };
  globalThis.PropertiesService = { getScriptProperties: function() { return { getProperty: function() { return null; } }; } };

  const normAna = normPS_("Ana Smith"), normBen = normPS_("Ben Lee"), normCara = normPS_("Cara Diaz");
  const psNames = new Map([
    [normAna,  { name: "Ana Smith" }],
    [normBen,  { name: "Ben Lee" }],
    [normCara, { name: "Cara Diaz" }],
  ]);

  const ptoProfiles = {
    "1001": { transactions: [{ date: new Date("2026-05-12"), isUsage: true, amount: 40 }] },
    "1002": { transactions: [] },
    "1003": { transactions: [{ date: new Date("2026-05-13"), isUsage: true, amount: 39 }] },
  };
  const empNumToNorm = new Map([["1001", normAna], ["1002", normBen], ["1003", normCara]]);

  const result = readGoalsEngagement_(psNames, [week], [], ctx, ptoProfiles, empNumToNorm);

  const ana  = result["2026.W20"].byEmployee[normAna];
  const ben  = result["2026.W20"].byEmployee[normBen];
  const cara = result["2026.W20"].byEmployee[normCara];

  assert_(ana.compliant === true,  "Ana (40h PTO) should be exempted (compliant), got " + JSON.stringify(ana));
  assert_(ana.ptoExempt === true,  "Ana should be flagged ptoExempt, got " + JSON.stringify(ana));
  assert_(ben.compliant === false, "Ben (0h PTO) should still fail rule 3, got " + JSON.stringify(ben));
  assert_(ben.ptoExempt === false, "Ben should not be flagged ptoExempt, got " + JSON.stringify(ben));
  assert_(cara.compliant === false, "Cara (39h PTO, just under 40) should still fail rule 3, got " + JSON.stringify(cara));

  Logger.log("✅ _test_goalsPtoExemption_ passed");
}
