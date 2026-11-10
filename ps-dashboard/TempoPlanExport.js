// ============================================================
// 📅  EXPORT WINDOW — THE SINGLE DIAL FOR ALL FOUR EXPORTERS
//
// Every exporter's history depth derives from this one number, and every
// window is ROLLING (computed from today), never a fixed anchor date. That
// matters for the daily/weekly triggers: the old fixed FROM_DATE anchors grew
// the window by one week every week forever, so runtime crept up until an
// export would eventually blow the execution limit and fail silently. A
// rolling window is bounded — runtime is flat, week after week.
//
// Consumers of this dial (each reads it defensively so a file can still run
// standalone in a separate GAS project):
//   TempoTrackedTime.js    CONFIGLogged.FROM_DATE    (rolling Monday)
//   TempoCapacityTime.js   CONFIGCap.MIN_ISO_WEEK    (rolling output floor)
//   Jira Backlog.js        CONFIGJ.RAW_HISTORY_WEEKS (deep "Jira Raw" window)
//
// ⚠️ NOT a consumer: CONFIGPlan (this file) keeps its OWN, smaller
// HISTORY_WEEKS. Its pass 2 (groupPlansByWeekScoped_) needs per-week accuracy
// and so issues one request per (week × user) — O(weeks × users) — whereas the
// three above cost one request per PERSON for the whole range regardless of
// depth. Wiring the plan export to this dial produced 10,532 requests on the
// 2026-08-03 run. See the warning on CONFIGPlan.HISTORY_WEEKS.
//
// WHY 52: the dashboards offer Weekly / Monthly / Quarterly views, and a
// period view is only as deep as the export behind it. A period counts toward
// a trend only when it is COMPLETE, and the window's oldest period is always
// truncated — so usable depth is not simply weeks/13. Measured worst case
// (running in the last week of a quarter):
//   30 weeks →  1 complete quarter,  6 complete months  ← quarterly unusable
//   52 weeks →  3 complete quarters, 11 complete months ← HERE
//   65 weeks →  4 complete quarters, 14 complete months ← full-year / YoY
//
// Stopped at 52, not 65: 52 weeks of one person's worklogs still fits in a
// single Tempo page (TEMPO_PAGE_LIMIT = 500, and ~8 worklogs/week ≈ 416), so
// the Tempo exports stay at ONE request per person. 65 weeks (~520) tips
// typical users onto a second page, doubling request count and with it the
// transient-500 exposure these exports already have to retry around.
//
// The jump from 30 to 52 is close to free for the THREE exports that read this
// dial: TempoTrackedTime and TempoCapacityTime paginate per USER over the whole
// range, and Jira Backlog does ONE broad JQL and buckets by resolution date
// client-side. Raise to 65 if a director asks for quarter-over-quarter against
// the same quarter last year — the cost is a second Tempo page per person plus
// ~25% more Jira Raw rows.
//
// The plan export is the exception and is deliberately excluded — see the
// warning above. Its planned history is therefore SHALLOWER than the other
// three carry (CONFIGPlan.HISTORY_WEEKS), which matters downstream: a week with
// tracked hours but no planned row reads as "planned 0h", not "planned
// unknown". Closing that gap means giving this export the freeze-and-merge
// treatment, not raising its window.
//
// Raising this: bump the number, re-run all four exports once (to refill the
// widened window), then raise CONFIG_DH.WEEKS_PAST_DEEP in the delivery-health
// dashboard to match and bust its cache. Keep exports >= dashboard depth.
// ============================================================
var EXPORT_HISTORY_WEEKS = 52;

/**
 * Set by backfillPlanHistory() to widen the plan export's FETCH window for one
 * run (normally it only fetches the small refresh window and freezes the rest).
 * null = normal cheap run. Module-level rather than a parameter because
 * CONFIGPlan.FROM_DATE is read from a dozen places deep in the pipeline.
 */
var PLAN_BACKFILL_WEEKS_ = null;

/** Read the shared dial, tolerating a standalone deployment. */
function exportHistoryWeeks_() {
  return typeof EXPORT_HISTORY_WEEKS !== "undefined" ? EXPORT_HISTORY_WEEKS : 52;
}

/** Monday of THIS ISO week (local), time zeroed. */
function thisIsoMonday_() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Mon=0 … Sun=6
  return d;
}

/**
 * Rolling window start: the Monday `weeksBack` full weeks before this week.
 * Always a Monday, which every week-bucketing helper here depends on.
 * @param {number} weeksBack
 * @returns {Date}
 */
function rollingWindowMonday_(weeksBack) {
  const d = thisIsoMonday_();
  d.setDate(d.getDate() - Math.max(0, weeksBack) * 7);
  return d;
}

/**
 * Rolling window end: the Sunday that closes the current week plus
 * `weeksForward` further full weeks.
 * @param {number} weeksForward
 * @returns {Date}
 */
function rollingWindowSunday_(weeksForward) {
  const d = thisIsoMonday_();
  d.setDate(d.getDate() + (Math.max(0, weeksForward) + 1) * 7 - 1);
  return d;
}

// ============================================================
// ⚙️  CONFIGURATION — Edit these values before running
// ============================================================
const CONFIGPlan = {
  SCRIPT_LABEL: "Tempo Reports", // Label shown in the custom menu and logs
  SHEET_NAME: "Planned Time Tempo", // Exact name of the output sheet tab
  JIRA_BASE: "https://servicerocket-coe.atlassian.net", // Your Jira base URL

  // ── Rolling date range (was fixed "2026-05-25" → "2026-12-31") ──
  // The old TO_DATE was a hard calendar stop: the window SHRANK by a week
  // every week and would have exported nothing at all from 2027-01-01. Both
  // ends are now derived from today, so the trigger keeps working unattended.
  // Getters (not plain values) so they re-evaluate on every access — a
  // long-lived trigger process must never cache yesterday's window.
  //
  // ⚠️ THIS EXPORT IS THE ONE THAT SCALES PER WEEK. Pass 2
  // (groupPlansByWeekScoped_) needs per-week accuracy and therefore issues one
  // request per (week × user) — O(weeks × users) — whereas the other three
  // exports cost one request per PERSON for the whole range regardless of
  // depth. Pointing the FETCH window at 52 weeks produced 10,532 requests and
  // an ~18-minute run on 2026-08-03.
  //
  // FREEZE-AND-MERGE (2026-08-03) — the fix that decouples the two:
  //   A completed week's plan is HISTORY and never changes. So the sheet keeps
  //   history (RETAIN_HISTORY_WEEKS) while each run only week-scope-fetches a
  //   small recent+future REFRESH window and merges it over the stored grid.
  //   Same pattern as TempoCapacityTime.js.
  //
  //   fetch window  = REFRESH_PAST_WEEKS + current + FUTURE_WEEKS  (8 weeks)
  //   sheet window  = RETAIN_HISTORY_WEEKS of history               (52 weeks)
  //
  //   ~1,300 requests / ~2 min per run — 3× cheaper than the 18-week full
  //   rebuild it replaced — and history depth is now FREE, so this can finally
  //   match the other three exports.
  //
  // REFRESH_PAST_WEEKS covers late edits to just-completed weeks. Everything
  // older is frozen from the sheet and never re-fetched. Raise it if planners
  // routinely revise plans more than a fortnight after the fact.
  REFRESH_PAST_WEEKS: 2, // completed weeks re-fetched each run
  FUTURE_WEEKS: 5,       // full future weeks of runway (dashboards need 3)

  // How much history the SHEET retains. Costs nothing per run now that history
  // is frozen, so it tracks the shared dial like the other three exports.
  // Weeks below this floor are trimmed on write, keeping the sheet bounded.
  get RETAIN_HISTORY_WEEKS() {
    return typeof exportHistoryWeeks_ === "function" ? exportHistoryWeeks_() : 52;
  },
  get MIN_ISO_WEEK() {
    return isoWeekLabel_(rollingWindowMonday_(this.RETAIN_HISTORY_WEEKS));
  },

  // FETCH window. Everything downstream — pass 1, pass 2, the parity checks and
  // the person-parity repair — operates on this one window, so those integrity
  // checks stay exactly as valid as before (they compare like with like). The
  // frozen history is merged in afterwards, outside their scope.
  // PLAN_BACKFILL_WEEKS_ widens it for a single manual backfillPlanHistory() run.
  get FROM_DATE() {
    var back = typeof PLAN_BACKFILL_WEEKS_ === "number" && PLAN_BACKFILL_WEEKS_ !== null
      ? PLAN_BACKFILL_WEEKS_
      : this.REFRESH_PAST_WEEKS;
    return fmtDate_(rollingWindowMonday_(back));
  },
  get TO_DATE()   { return fmtDate_(rollingWindowSunday_(this.FUTURE_WEEKS)); },

  // Pre-flight guard: groupPlansByWeekScoped_ logs its projected request count
  // BEFORE fetching and warns past this. 10,532 requests should never have been
  // a surprise discovered from a log line mid-run.
  WEEK_SCOPED_WARN_REQUESTS: 6000,
  INCLUDE_PROJECT_PLANS: true, // true = include PROJECT-level plans
  DIAG_PER_PLAN: true, // true = log a per-plan + per-project diagnostic table (find missing hours)
  API_BATCH_SIZE: 50, // Max items per Jira batch request
  TEMPO_PAGE_LIMIT: 500, // Max results per Tempo API page
  // fetchAll batch size for the week-scoped Tempo pass. Larger batches cut
  // wall time roughly linearly (each batch is one parallel round-trip); the
  // retry rounds absorb the extra transient 500s that bursts provoke.
  WEEK_FETCH_BATCH: 100,
  HEADER_BG: "#4472C4", // Header row background color
  HEADER_FONT: "#FFFFFF", // Header row font color
  TOTAL_ROW_BG: "#D6E4F0", // Total row background color
};

// ============================================================
// 👥  WORKER SOURCE — Dynamic team member discovery
//
// Workers are now fetched automatically from all Tempo Teams.
// No need to maintain a manual list — new rocketeers are included
// automatically as soon as they are added to a Tempo Team.
//
// EXCLUDE_IDS: add any account IDs here to skip specific people
//              (e.g. bots, contractors, former employees).
//              Leave empty to include everyone from all teams.
// ============================================================
const EXCLUDE_IDS = [
  // "712020:example-id-here",  // Example: Bot account to skip
];

// ============================================================
// 🔁  MERGE MAP — Duplicate account IDs → Primary account ID
//     When the same person has two Jira/Tempo accounts, both
//     are fetched and merged under one display name.
//     Add new duplicate pairs here as needed.
// ============================================================

const MERGE_MAP = {
  "712020:3894faed-d630-4443-808d-3b2452b861fc":
    "712020:725b3bfc-13d0-4d77-b598-93e82260c55d",
  "712020:3f516529-7972-482c-9add-1d178d86f33e":
    "712020:3e054b89-1a0e-4b76-97d6-cf092a425c6d",
};

// ============================================================
// 🔎  FILTERS & EXCLUSIONS — What is left out of the report
//
// The pipeline narrows the data at several points. Each filter below
// removes, clamps, or reshapes records on the way to the sheet. They are
// listed in the order they take effect. logActiveFilters_() echoes the
// active configuration to the Apps Script log at the start of every run so
// you can follow exactly what was excluded.
//
//  1. WEEK CONVENTION (Mon–Sun)
//     Weeks run Monday→Sunday (ISO-8601). buildWeekRanges_ starts each week
//     at FROM_DATE and ends it 6 days later (Sunday). The ISO week label
//     (e.g. 2026.W14) is derived from the week's Monday.
//     ⚠️ DEPENDENCY: FROM_DATE must be a Monday, or the week buckets and
//        their ISO labels will not align to calendar weeks. This is now
//        guaranteed by construction — rollingWindowMonday_() always lands on
//        a Monday — so the old "must stay a Monday" manual discipline is gone.
//
//  2. DATE WINDOW  (CONFIGPlan.FROM_DATE → CONFIGPlan.TO_DATE)
//     ROLLING, derived from today: EXPORT_HISTORY_WEEKS back → FUTURE_WEEKS
//     forward. Bounded, so trigger runtime stays flat instead of creeping up
//     a week at a time. Only the portion of each plan that overlaps this
//     range is counted.
//     Hours before FROM_DATE or after TO_DATE are clamped off. Plans wholly
//     outside the window contribute nothing.
//
//  3. WORKER DISCOVERY SCOPE  (Tempo Teams)
//     Only people who are members of at least one Tempo Team are processed
//     (plus MERGE_MAP secondary IDs, see #5). Anyone not on a Tempo Team —
//     even if they have plans — is OMITTED ENTIRELY.
//
//  4. EXCLUDE_IDS
//     Account IDs listed in EXCLUDE_IDS are dropped during discovery
//     (bots, contractors, former employees, etc.). Currently: see EXCLUDE_IDS.
//
//  5. MERGE_MAP  (consolidation, not removal)
//     Secondary accounts are fetched and their hours merged into the primary
//     account under one display name. No hours are lost; rows are combined.
//
//  6. PROJECT-LEVEL PLANS  (CONFIGPlan.INCLUDE_PROJECT_PLANS)
//     When false, PROJECT-type plans are skipped and only ISSUE-level plans
//     are kept. When true (current default), both are included.
//
//  7. DUPLICATE PLANS  (content fingerprint)
//     A plan is counted once per fingerprint of
//     effectiveUserId | planItemId | startDate | endDate | plannedSecondsPerDay.
//     Exact repeats (e.g. the same plan surfaced via two merged accounts)
//     are skipped and reported as "Duplicates skipped".
//
//  8. WORKING-DAY DISTRIBUTION  (Mon–Fri)
//     Hours are spread across weekdays only; Saturday/Sunday are excluded
//     from the working-day count. EXCEPTION: a plan whose date range lands
//     entirely on a weekend is rescued via totalPlannedSecondsInScope so it
//     is not silently dropped (see groupPlansByUserProject_).
// ============================================================

// ============================================================
// 🔐  CREDENTIALS SETUP
//     Run storeCredentials() once to save your tokens securely.
// ============================================================

/**
 * ONE-TIME SETUP: Stores API credentials into Script Properties.
 * Edit the values below, run once, then clear them from this function.
 */
function storeCredentials() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('storeCredentials');
  else Logger.log('⚠️ [storeCredentials] requireMaintainer_ not in this project — running ungated.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty("TEMPO_API_TOKEN", "PASTE_TEMPO_API_TOKEN_HERE");
  props.setProperty("JIRA_EMAIL", "PASTE_JIRA_EMAIL_HERE");
  props.setProperty("JIRA_API_TOKEN", "PASTE_JIRA_API_TOKEN_HERE");
  Logger.log("🔐 Credentials stored in Script Properties.");
}

/**
 * DIAGNOSTIC: Checks whether the stored Tempo token is currently accepted.
 * Run from the GAS editor when exports fail with 401. Logs the token's
 * shape (masked), flags accidental whitespace, and probes one lightweight
 * Tempo endpoint. A persistent 401 here = the token itself is expired or
 * revoked (Tempo tokens are created WITH an expiration date) → generate a
 * new one in Tempo > Settings > API Integration, then update the
 * TEMPO_API_TOKEN Script Property (Project Settings > Script Properties,
 * or edit + run storeCredentials()).
 */
function probeTempoAuth() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('probeTempoAuth');
  else Logger.log('⚠️ [probeTempoAuth] requireMaintainer_ not in this project — running ungated.');
  const raw = PropertiesService.getScriptProperties().getProperty("TEMPO_API_TOKEN");
  if (!raw) {
    Logger.log("❌ TEMPO_API_TOKEN is not set in Script Properties.");
    return;
  }
  const trimmed = raw.trim();
  Logger.log(
    `ℹ️ Token: length ${raw.length}, starts "${trimmed.slice(0, 4)}…", ends "…${trimmed.slice(-4)}"`,
  );
  if (raw !== trimmed) {
    Logger.log(
      "⚠️ Token has leading/trailing whitespace — re-store it without the stray characters.",
    );
  }
  const res = UrlFetchApp.fetch("https://api.tempo.io/4/teams?limit=1", {
    method: "get",
    headers: { Authorization: `Bearer ${trimmed}` },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  Logger.log(`ℹ️ GET /4/teams → HTTP ${code} — body: ${res.getContentText().slice(0, 300)}`);
  if (code === 200) {
    Logger.log("✅ Token accepted. If trigger runs still fail, the 401s are transient (now retried).");
  } else if (code === 401) {
    Logger.log(
      "❌ Token REJECTED — it is expired or revoked. Generate a new Tempo API token " +
        "(Tempo > Settings > API Integration) and update the TEMPO_API_TOKEN Script Property.",
    );
  } else {
    Logger.log("⚠️ Unexpected status — see body above.");
  }
}

/**
 * Retrieves stored credentials from Script Properties.
 * @returns {{ tempoToken: string, jiraEmail: string, jiraToken: string }}
 * @throws {Error} If any credential is missing.
 */
function getCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const tempoToken = props.getProperty("TEMPO_API_TOKEN");
  const jiraEmail = props.getProperty("JIRA_EMAIL");
  const jiraToken = props.getProperty("JIRA_API_TOKEN");
  if (!tempoToken || !jiraEmail || !jiraToken) {
    throw new Error("❌ Missing credentials. Run storeCredentials() first.");
  }
  return { tempoToken, jiraEmail, jiraToken };
}

// ── SECTION: MAIN ENTRY POINT ────────────────────────────────

/**
 * ONE-TIME manual backfill of planned history.
 *
 * The normal run (and the daily trigger) only week-scope-fetches the small
 * refresh window and freezes everything older from the sheet — that is what
 * keeps it at ~2 minutes. So on a brand-new sheet, or right after
 * EXPORT_HISTORY_WEEKS is raised, the older columns simply don't exist yet.
 * This widens the fetch window to the full retention depth for a single run to
 * fill them, then normal runs take over and never pay that cost again.
 *
 * ⚠️ EXPENSIVE and deliberately NOT on a trigger: pass 2 is O(weeks × users),
 * so this is the ~10,000-request / ~16-minute run. Launch it by hand from the
 * GAS editor, once, and watch it finish. Re-running is safe (idempotent for the
 * same window) but pointless.
 */
function backfillPlanHistory() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('backfillPlanHistory');
  else Logger.log('⚠️ [backfillPlanHistory] requireMaintainer_ not in this project — running ungated.');
  const weeksBack = CONFIGPlan.RETAIN_HISTORY_WEEKS;
  PLAN_BACKFILL_WEEKS_ = weeksBack;
  try {
    Logger.log(
      `🏗️ [backfillPlanHistory] ONE-TIME deep run: fetching ${weeksBack} weeks of ` +
        `history + ${CONFIGPlan.FUTURE_WEEKS} future (${CONFIGPlan.FROM_DATE} → ` +
        `${CONFIGPlan.TO_DATE}). This is the expensive pass — expect ~15–20 minutes.`,
    );
    fetchTempoPlannedTime();
    Logger.log(
      `✅ [backfillPlanHistory] done. Normal runs now refresh only ` +
        `${CONFIGPlan.REFRESH_PAST_WEEKS} past + current + ${CONFIGPlan.FUTURE_WEEKS} ` +
        `future week(s) and freeze the rest — do NOT put this function on a trigger.`,
    );
  } finally {
    // Always restore, even on throw: a leaked override would turn every
    // subsequent trigger run into the expensive deep fetch.
    PLAN_BACKFILL_WEEKS_ = null;
  }
}

// Entry point for the daily trigger (added by hand on the Triggers page) and manual runs. See fetchTempoLoggedTime.
function fetchTempoPlannedTime() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoPlannedTime');
  if (typeof withSourceStatus_ !== 'function') return fetchTempoPlannedTimeBody_();
  return withSourceStatus_("tempo_plan", fetchTempoPlannedTimeBody_);
}

/**
 * Main function: fetches all Tempo planned hours for the CONFIGPlanured
 * date range and writes a weekly breakdown table to the output sheet.
 *
 * Fetches only the REFRESH window (CONFIGPlan.REFRESH_PAST_WEEKS + current +
 * FUTURE_WEEKS) and merges it over the stored grid, freezing completed weeks —
 * see the freeze-and-merge note on CONFIGPlan. Use backfillPlanHistory() to
 * populate history the first time.
 */
function fetchTempoPlannedTimeBody_() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoPlannedTime');
  else Logger.log('⚠️ [fetchTempoPlannedTime] requireMaintainer_ not in this project — running ungated.');
  try {
    Logger.log(
      `🕐 [fetchTempoPlannedTime] Started at ${new Date().toISOString()}`,
    );

    // Step 1: Load stored API credentials
    const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

    // Step 2: Parse the CONFIGPlanured date range into Date objects
    const fromDate = parseDateLocal_(CONFIGPlan.FROM_DATE);
    const toDate = parseDateLocal_(CONFIGPlan.TO_DATE);
    Logger.log(
      `ℹ️ Date range: ${CONFIGPlan.FROM_DATE} → ${CONFIGPlan.TO_DATE}`,
    );

    // Step 3: Build week column ranges spanning the full date range
    const weeks = buildWeekRanges_(fromDate, toDate);
    Logger.log(`ℹ️ Built ${weeks.length} week columns`);

    // Step 3b: Echo the active filters so the log shows what will be left out
    logActiveFilters_(fromDate, weeks);

    // Step 4 (moved): the output sheet is prepared (cleared) only AFTER the
    // fetches succeed — preparing it up front meant a failed Tempo/Jira call
    // (e.g. the 2026-07-23 transient 401 on the Teams fetch) left a wiped,
    // empty sheet instead of keeping yesterday's data.

    // Step 5: Discover all worker account IDs dynamically from Tempo Teams.
    //         Any ID in EXCLUDE_IDS is removed. MERGE_MAP secondary IDs are
    //         automatically included so their plans are fetched and merged.
    Logger.log("ℹ️ Discovering team members from Tempo Teams...");
    const teamInfoById = {};
    const workerIds = fetchAllTeamMembers_(tempoToken, teamInfoById);
    Logger.log(`ℹ️ Workers discovered: ${workerIds.length}`);

    // Step 6: Fetch Jira display names for all discovered worker account IDs
    Logger.log("ℹ️ Fetching user display names from Jira...");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    // Step 6b: Team lookup keyed by display name — the same key the
    // grouped rows carry (grouping collapses merged accounts to one name).
    const teamInfoByName = buildTeamInfoByName_(teamInfoById, userMap);

    // Step 7: Fetch all Tempo plans for every worker
    //         Duplicate accounts are merged; true plan duplicates are skipped
    const {
      allPlans, typeMap, skippedCount, planRangesByUser, failedUserIds,
      windowHrsByWorker, rawIdsByWorker,
    } = fetchAllPlans_(tempoToken, workerIds, userMap);
    Logger.log(
      `ℹ️ Plans collected: ${allPlans.length} | Duplicates skipped: ${skippedCount}`,
    );

    if (allPlans.length === 0) {
      prepareSheet_(weeks)
        .getRange(3, 1)
        .setValue("⚠️ No planned time data found for this period.");
      Logger.log("⚠️ No plans found — nothing to write.");
      return;
    }

    // Step 8: Resolve plan item IDs → project names and keys via Jira
    const itemIdList = Object.keys(typeMap);
    Logger.log(`ℹ️ Resolving ${itemIdList.length} plan items via Jira...`);
    const itemMap = resolvePlanItems_(
      itemIdList,
      typeMap,
      jiraEmail,
      jiraToken,
    );

    // Step 9: Build per-week hours by re-querying Tempo scoped to each
    //         Monday→Sunday week (exact for any work week — Sun–Thu, Mon–Fri,
    //         etc. — and for holidays). No Mon–Fri heuristic, no scaleFactor.
    let grouped = groupPlansByWeekScoped_(
      tempoToken,
      weeks,
      workerIds,
      userMap,
      itemMap,
      toDate,
      planRangesByUser,
      failedUserIds,
    );

    // Step 9b: Integrity — the per-week scoped grand total should equal the
    //          whole-window total (weeks tile the window exactly).
    const windowTotalHrs =
      allPlans.reduce(
        (s, p) => s + (p.totalPlannedSecondsInScope || 0) / 3600,
        0,
      );
    let weekScopedTotalHrs = Object.values(grouped).reduce(
      (s, g) => s + g.total,
      0,
    );
    Logger.log(
      `ℹ️ Grand total — whole-window: ${round2_(windowTotalHrs)} hrs | ` +
        `per-week scoped: ${round2_(weekScopedTotalHrs)} hrs`,
    );

    // Step 9c: PERSON-PARITY repair. Grand-total tolerance can't see a few
    // low-hour people vanish (lost cells dropped whole employees from the
    // dashboard: 147 → 134 on 2026-07-15). Every worker's grid total must
    // reproduce their whole-window total; any shortfall re-fetches JUST that
    // worker's weeks, unfiltered, and replaces their rows.
    const gridHrsByWorker = {};
    Object.values(grouped).forEach((g) => {
      gridHrsByWorker[g.worker] = (gridHrsByWorker[g.worker] || 0) + g.total;
    });
    const repairRawIds = [];
    const repairWorkers = new Set();
    Object.keys(windowHrsByWorker).forEach((worker) => {
      const shortBy = windowHrsByWorker[worker] - (gridHrsByWorker[worker] || 0);
      if (shortBy > 0.5) {
        repairWorkers.add(worker);
        (rawIdsByWorker[worker] || []).forEach((id) => repairRawIds.push(id));
        Logger.log(
          `   🔧 [personParity] ${worker}: grid ${round2_(gridHrsByWorker[worker] || 0)} hrs ` +
            `< window ${round2_(windowHrsByWorker[worker])} hrs — re-fetching their weeks.`,
        );
      }
    });
    if (repairRawIds.length > 0) {
      Logger.log(
        `🔧 [personParity] repairing ${repairWorkers.size} worker(s) (${repairRawIds.length} account id(s))…`,
      );
      const repaired = groupPlansByWeekScoped_(
        tempoToken, weeks, repairRawIds, userMap, itemMap, toDate,
      );
      Object.keys(grouped).forEach((k) => {
        if (repairWorkers.has(grouped[k].worker)) delete grouped[k];
      });
      Object.keys(repaired).forEach((k) => { grouped[k] = repaired[k]; });
      weekScopedTotalHrs = Object.values(grouped).reduce((s, g) => s + g.total, 0);
      Logger.log(`ℹ️ [personParity] post-repair total: ${round2_(weekScopedTotalHrs)} hrs.`);
    }

    // Self-healing: a material UNDER-count with the prefilter active means
    // the prefilter skipped cells that really had plans (e.g. a plan shape
    // whose coverage the ranges don't capture). Redo the pass unfiltered
    // rather than write a lossy sheet — slower, never wrong.
    const shortfall = windowTotalHrs - weekScopedTotalHrs;
    if (shortfall > Math.max(40, windowTotalHrs * 0.01)) {
      Logger.log(
        `⚠️ Week-scoped total is ${round2_(shortfall)} hrs BELOW the whole-window total — ` +
          `re-running the week-scoped pass WITHOUT the plan-range prefilter.`,
      );
      grouped = groupPlansByWeekScoped_(
        tempoToken, weeks, workerIds, userMap, itemMap, toDate,
      );
      weekScopedTotalHrs = Object.values(grouped).reduce((s, g) => s + g.total, 0);
      Logger.log(
        `ℹ️ Unfiltered re-run total: ${round2_(weekScopedTotalHrs)} hrs.`,
      );
    }
    // Final parity report. The threshold used to be an ABSOLUTE 0.5 hrs, which
    // against a 377,000-hour total (the 2026-08-03 run) is 0.00013% — so it
    // fired on every wide-window run and trained the reader to ignore a warning
    // that is supposed to mean something. It is now relative, like the
    // self-heal threshold above it, and the residue is reported per (user,week)
    // cell because that is the number that tells the two causes apart:
    //   • a few seconds per cell, scaling with week count → per-slice rounding
    //     when ONE window query is split into N weekly queries. Benign.
    //   • a large amount concentrated in few cells → real loss (page caps,
    //     cells that failed after retries, or a prefilter miss). Not benign.
    // Cross-check against the "[weekScoped] … still failed after" and
    // "hit the … page cap" warnings: absent those, it is the first case.
    const parityDiff = weekScopedTotalHrs - windowTotalHrs;
    const parityPct = windowTotalHrs > 0
      ? Math.abs(parityDiff) / windowTotalHrs * 100 : 0;
    const cells = weeks.length * workerIds.length;
    const perCellSec = cells > 0 ? Math.abs(parityDiff) * 3600 / cells : 0;
    if (parityPct > 0.25) {
      Logger.log(
        `⚠️ Week-scoped total differs from whole-window by ${round2_(parityDiff)} hrs ` +
          `(${parityPct.toFixed(3)}% — MATERIAL). Check the [weekScoped] failed-cell and ` +
          `page-cap warnings above, then week tiling.`,
      );
    } else if (Math.abs(parityDiff) > 0.5) {
      Logger.log(
        `ℹ️ Week-scoped total differs from whole-window by ${round2_(parityDiff)} hrs ` +
          `(${parityPct.toFixed(3)}%, ~${perCellSec.toFixed(1)}s per (user,week) cell across ` +
          `${cells} cells) — consistent with per-slice rounding from splitting one ` +
          `window query into ${weeks.length} weekly queries. Within tolerance.`,
      );
    }

    // Step 10: FREEZE-AND-MERGE. The fetch above covered only the refresh
    // window; completed weeks outside it are read back from the sheet and kept
    // as-is (a past week's plan is history). This is what lets the run stay at
    // ~8 weeks of fetching while the sheet carries a year of history.
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const existing = readExistingPlanGrid_(ss);
    const refreshIsoWeeks = weeks.map((w) => w.isoLabel);
    const fetchedRows = groupedToPlanRows_(grouped, weeks, teamInfoByName);
    const floorIso = CONFIGPlan.MIN_ISO_WEEK;
    const merged = mergePlanGrid_(existing.rows, fetchedRows, refreshIsoWeeks, floorIso);

    const frozenCols = merged.isoWeeks.filter(
      (iso) => refreshIsoWeeks.indexOf(iso) === -1,
    ).length;
    const trimmed = existing.isoWeeks.filter((iso) => iso < floorIso);
    Logger.log(
      `ℹ️ [merge] refreshed ${refreshIsoWeeks.length} week(s) ` +
        `(${refreshIsoWeeks[0]}→${refreshIsoWeeks[refreshIsoWeeks.length - 1]}), ` +
        `froze ${frozenCols} stored week(s), ` +
        `${merged.isoWeeks.length} column(s) total, ` +
        `${Object.keys(existing.rows).length} stored row(s) → ${merged.rows.length} merged row(s)` +
        (trimmed.length ? `; trimmed ${trimmed.length} week(s) below the ${floorIso} floor` : ""),
    );
    if (existing.isoWeeks.length === 0) {
      Logger.log(
        `ℹ️ [merge] no stored history found — this run writes the refresh window only. ` +
          `Run backfillPlanHistory() ONCE (manually, off-trigger) to fill ` +
          `${CONFIGPlan.RETAIN_HISTORY_WEEKS} weeks of planned history.`,
      );
    }

    // Step 11: Prepare the sheet (clear + headers) and write rows +
    // grand-total footer — deferred to here so a failed run above never
    // wipes the previous export.
    const sheet = prepareSheetForIsoWeeks_(ss, merged.isoWeeks);
    writeRows_(sheet, buildMergedRows_(merged), merged.isoWeeks);

    // Step 12: Name normalization (Change Names.js) — Tempo display names →
    // roster legal names, in-place, so downstream joins match without the
    // manual normalizeAllNames() step after every run.
    try {
      const renamed = normalizeSheetNames_(sheet, NAME_MAPST.TEMPO, 1, 3);
      Logger.log(`ℹ️ Name normalization: ${renamed} name(s) updated.`);
    } catch (e) {
      Logger.log(`⚠️ Name normalization skipped (${e.message}) — run normalizeAllNames() manually.`);
    }

    Logger.log(
      `✅ [fetchTempoPlannedTime] Done. ${sortedRows.length} rows written.`,
    );
  } catch (e) {
    Logger.log(`❌ [fetchTempoPlannedTime] ${e.message}`);
    throw e;
  }
}

// ── SECTION: FILTER REPORTING ────────────────────────────────

/**
 * Logs every active filter/exclusion so each run shows what will be left out.
 * See the "FILTERS & EXCLUSIONS" block at the top of this file for the full
 * description of each filter. This only reports configuration that is known
 * up front; counts that are only knowable after fetching (duplicates skipped,
 * project plans skipped) are logged later by fetchAllPlans_ / writeRows_.
 *
 * @param {Date}  fromDate - Parsed CONFIGPlan.FROM_DATE.
 * @param {Array<{isoLabel: string, label: string}>} weeks
 */
function logActiveFilters_(fromDate, weeks) {
  const firstWeek = weeks[0];
  const lastWeek = weeks[weeks.length - 1];
  const fromIsMonday = fromDate.getDay() === 1; // 0=Sun … 1=Mon

  Logger.log("────────────────────────────────────────────");
  Logger.log("🔎 ACTIVE FILTERS — what is left out this run");
  Logger.log("────────────────────────────────────────────");

  // 1. Week convention + FROM_DATE-is-Monday dependency
  Logger.log(
    `1. Weeks: Mon→Sun. Range ${firstWeek.isoLabel} (${firstWeek.label}) → ${lastWeek.isoLabel} (${lastWeek.label})`,
  );
  if (!fromIsMonday) {
    Logger.log(
      `   ⚠️ FROM_DATE (${CONFIGPlan.FROM_DATE}) is NOT a Monday — week buckets/ISO labels will be misaligned.`,
    );
  }

  // 2. Date window
  Logger.log(
    `2. Date window: ${CONFIGPlan.FROM_DATE} → ${CONFIGPlan.TO_DATE} (hours outside are clamped off).`,
  );

  // 3. Worker discovery scope
  Logger.log(
    "3. Workers: only members of a Tempo Team are included (non-members are omitted entirely).",
  );

  // 4. Explicit exclusions
  Logger.log(
    `4. EXCLUDE_IDS: ${EXCLUDE_IDS.length} account(s) skipped${EXCLUDE_IDS.length ? " → " + EXCLUDE_IDS.join(", ") : "."}`,
  );

  // 5. Merge map (consolidation)
  Logger.log(
    `5. MERGE_MAP: ${Object.keys(MERGE_MAP).length} secondary account(s) merged into a primary (hours combined, not dropped).`,
  );

  // 6. Project-level plans
  Logger.log(
    `6. PROJECT-level plans: ${CONFIGPlan.INCLUDE_PROJECT_PLANS ? "INCLUDED" : "EXCLUDED (only ISSUE-level plans kept)"}.`,
  );

  // 7. Duplicate dedup (rule; count reported later)
  Logger.log(
    "7. Duplicate plans: collapsed by fingerprint user|item|start|end|secondsPerDay (count logged after fetch).",
  );

  // 8. Working-day distribution
  Logger.log(
    "8. Distribution: weekdays (Mon–Fri) only; weekend-only plans rescued via totalPlannedSecondsInScope.",
  );

  Logger.log("────────────────────────────────────────────");
}

// ── SECTION: SHEET SETUP ─────────────────────────────────────

/**
 * Creates or clears the output sheet and writes the two stacked header rows.
 *
 * Row 1 (initial header): ISO calendar week name above each week column,
 *                         e.g. "2026.W14". Fixed columns are left blank.
 * Row 2 (date header):    "User", "Team", "Space", "Key", "PM",
 *                         "Issue", "Planned (hrs)", the week date ranges
 *                         (e.g. "Mar 30 - Apr 05 2026"), and "Total (hrs)".
 *
 * "PM" is the Jira project lead of the plan's project (see attachProjectLeads_).
 * "Issue" is the plan's issue key for ISSUE-level plans (planning-granularity
 * validation); blank means a PROJECT-level plan, which has no issue by nature.
 * "Team" is a PERSON-level attribute from Tempo Team membership (see
 * fetchAllTeamMembers_ / buildTeamInfoByName_): every Tempo team the person
 * belongs to, " | "-joined into one cell — each distinct combination is its
 * own filter value. Blank when they have none.
 * Column order mirrors the Tempo Tracked Time sheet. Downstream readers
 * (PS dashboard, demand dashboard) locate columns by header name, so the
 * inserts are safe for them.
 *
 * @param {Array<{label: string, isoLabel: string}>} weeks
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
/**
 * Reads the stored "Planned Time Tempo" grid so completed weeks can be frozen
 * instead of re-fetched. Missing sheet / no ISO header row / no data rows all
 * return an empty grid, which makes the caller behave exactly like a first run.
 * @returns {{ isoWeeks: string[], rows: Object }} groupKey → row record
 */
function readExistingPlanGrid_(ss) {
  const empty = { isoWeeks: [], rows: {} };
  const sheet = ss.getSheetByName(CONFIGPlan.SHEET_NAME);
  if (!sheet) return empty;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 3 || lastCol < 8) return empty; // headers only, or pre-week layout

  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const isoHeader = values[0];

  // Row 1 carries ISO labels only over the week columns (fixed cols and the
  // trailing Total column are blank), so this also locates the week block.
  const isoByCol = {};
  const isoWeeks = [];
  for (let c = 0; c < isoHeader.length; c++) {
    const iso = String(isoHeader[c] || "").trim();
    if (/^\d{4}\.W\d{1,2}$/.test(iso)) {
      isoByCol[c] = iso;
      isoWeeks.push(iso);
    }
  }
  if (isoWeeks.length === 0) return empty; // legacy sheet without the ISO row

  const rows = {};
  for (let r = 2; r < values.length; r++) {
    const row = values[r];
    const worker = String(row[0] || "").trim();
    if (!worker || worker === "TOTAL") continue;          // footer / blank
    if (String(row[0]).indexOf("⚠️") === 0) continue;     // "no rows" placeholder
    const project = String(row[2] || "").trim();
    const issue = String(row[5] || "").trim();
    const key = `${worker}|||${project}|||${issue}`;
    const weeks = {};
    Object.keys(isoByCol).forEach((c) => {
      const v = parseFloat(row[c]);
      if (!isNaN(v) && v !== 0) weeks[isoByCol[c]] = v;
    });
    // Later duplicate rows (shouldn't exist, but a hand-edited sheet can) merge
    // rather than clobber, so no stored hours are silently dropped.
    if (rows[key]) {
      Object.keys(weeks).forEach((iso) => {
        rows[key].weeks[iso] = (rows[key].weeks[iso] || 0) + weeks[iso];
      });
      return;
    }
    rows[key] = {
      worker: worker,
      team: String(row[1] || "").trim(),
      project: project,
      projectKey: String(row[3] || "").trim(),
      pm: String(row[4] || "").trim(),
      issue: issue,
      weeks: weeks,
    };
  }
  return { isoWeeks: isoWeeks, rows: rows };
}

/**
 * Clears and re-headers the sheet for a given ISO week list. Takes ISO labels
 * (not week objects) so FROZEN weeks — which were never fetched this run and so
 * have no week object — still get correct headers.
 * @param {string[]} isoWeeks - full merged column list, chronological
 */
function prepareSheetForIsoWeeks_(ss, isoWeeks) {
  let sheet = ss.getSheetByName(CONFIGPlan.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGPlan.SHEET_NAME);
  sheet.clear();

  // Row 1 — ISO week names; blank over the fixed columns and the total column.
  const isoRow = ["", "", "", "", "", "", ""];
  isoWeeks.forEach((iso) => isoRow.push(iso));
  isoRow.push("");

  // Row 2 — date-range headers, rebuilt from each ISO label.
  const dateRow = ["User", "Team", "Space", "Key", "PM", "Issue", "Planned (hrs)"];
  isoWeeks.forEach((iso) => dateRow.push(planWeekLabelForIso_(iso)));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGPlan.HEADER_BG);
  headerRange.setFontColor(CONFIGPlan.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(7);

  return sheet;
}

function prepareSheet_(weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGPlan.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGPlan.SHEET_NAME);
  sheet.clear();

  // Row 1 — ISO week names; blank over the fixed columns and the total column.
  const isoRow = ["", "", "", "", "", "", ""];
  weeks.forEach((w) => isoRow.push(w.isoLabel));
  isoRow.push("");

  // Row 2 — existing date-range headers.
  const dateRow = ["User", "Team", "Space", "Key", "PM", "Issue", "Planned (hrs)"];
  weeks.forEach((w) => dateRow.push(w.label));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGPlan.HEADER_BG);
  headerRange.setFontColor(CONFIGPlan.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(7);

  return sheet;
}

// ── SECTION: TEAM MEMBER DISCOVERY ───────────────────────────

// Regional Tempo Teams are named "SR - RRxx <Region name>". They are pure
// location groupings, not squads, so they are skipped when collecting a
// person's Team labels (none exist in Tempo today; the guard keeps the Team
// column clean if they ever reappear).
const TEMPO_RR_TEAM_RE_ = /^SR\s*-\s*RR(\d{2})\s+(.+)$/i;

/**
 * Builds a display-name-keyed Team lookup from the accountId-keyed map
 * fetchAllTeamMembers_ fills. Display name is the join key because the
 * grouped sheet rows only carry the worker's name (merged accounts already
 * collapse to the primary's name via userMap).
 *
 * @param {Object} teamInfoById - effectiveId → { teams[] } (from fetchAllTeamMembers_)
 * @param {Object} userMap      - accountId → Jira display name
 * @returns {Object} display name → { team: string }
 */
function buildTeamInfoByName_(teamInfoById, userMap) {
  const byName = {};
  Object.keys(teamInfoById).forEach((id) => {
    const name = userMap[id];
    if (!name || byName[name]) return;
    byName[name] = { team: teamInfoById[id].teams.join(" | ") };
  });
  return byName;
}

/**
 * Discovers all worker account IDs dynamically by querying every Tempo Team.
 *
 * Flow:
 *   1. GET /4/teams          → list all teams in the Tempo workspace
 *   2. GET /4/teams/{id}/members → list members of each team
 *   3. Deduplicate across teams (a person can be in multiple teams)
 *   4. Apply EXCLUDE_IDS filter (bots, contractors, etc.)
 *   5. Inject any MERGE_MAP secondary IDs that weren't returned by Tempo
 *      (so their plans are still fetched and merged into the primary account)
 *   6. Log every newly discovered account ID not previously in MERGE_MAP
 *      so you're always aware of who was auto-included
 *
 * @param {string} token - Tempo Bearer token.
 * @param {Object=} teamInfoOut - Optional. When passed, filled with
 *        effectiveId → { teams[] }: every non-regional Tempo team the
 *        person belongs to ("SR - RRxx …" location teams are skipped).
 *        Keyed on the MERGE_MAP primary so merged accounts inherit one
 *        entry. Callers that don't pass it (Capacity export, diagnostics)
 *        are unaffected.
 * @returns {string[]} Flat, deduplicated array of account IDs to process.
 */
function fetchAllTeamMembers_(token, teamInfoOut) {
  const headers = { Authorization: `Bearer ${token}` };

  // Tempo throws transient 500s under load — one on the very first call
  // killed an entire run (2026-07-15), and per-team 500s silently dropped
  // whole teams' members. Tempo's auth layer ALSO throws transient 401s
  // (daily 5:57 AM trigger runs died on them, 2026-07-23) — the token is
  // valid again minutes later, so 401 is retried like 5xx/429. A genuinely
  // revoked token still fails every attempt and surfaces the same error.
  const fetchWithRetry = (url) => {
    let res, code;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) Utilities.sleep(1500 * attempt);
      res = UrlFetchApp.fetch(url, {
        method: "get",
        headers: headers,
        muteHttpExceptions: true,
      });
      code = res.getResponseCode();
      if (code === 200 || (code < 500 && code !== 429 && code !== 401)) break;
    }
    return res;
  };

  // Step 1: Fetch all Tempo Teams
  Logger.log("ℹ️ [fetchAllTeamMembers_] Fetching all Tempo Teams...");
  const teamsRes = fetchWithRetry("https://api.tempo.io/4/teams?limit=200");

  if (teamsRes.getResponseCode() !== 200) {
    throw new Error(
      `❌ Failed to fetch Tempo Teams after retries: HTTP ${teamsRes.getResponseCode()} — ${teamsRes.getContentText()}`,
    );
  }

  const teams = JSON.parse(teamsRes.getContentText()).results || [];
  Logger.log(`ℹ️ [fetchAllTeamMembers_] Found ${teams.length} team(s)`);

  // Step 2: Fetch members for every team and collect all unique account IDs
  const seenIds = new Set();
  const allIds = [];
  const excludeSet = new Set(EXCLUDE_IDS);

  for (let t = 0; t < teams.length; t++) {
    const team = teams[t];
    const teamId = team.id;
    Logger.log(`ℹ️ [fetchAllTeamMembers_] Team "${team.name}" (id: ${teamId})`);

    // Regional teams ("SR - RRxx <name>") are location groupings, not
    // squads — every other team name is collected as a Team label.
    const isRegionalTeam = TEMPO_RR_TEAM_RE_.test(String(team.name || ""));

    // Paginate through team members in case a team has >200 people
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const membersRes = fetchWithRetry(
        `https://api.tempo.io/4/teams/${teamId}/members?limit=200&offset=${offset}`,
      );

      if (membersRes.getResponseCode() !== 200) {
        Logger.log(
          `   ⚠️ Could not fetch members for team ${teamId} after retries: ` +
            `HTTP ${membersRes.getResponseCode()} — this team's members are ` +
            `MISSING from this run unless they're in another team.`,
        );
        break;
      }

      const membersData = JSON.parse(membersRes.getContentText());
      const members = membersData.results || [];

      for (let m = 0; m < members.length; m++) {
        // Tempo team member objects expose the Jira accountId under member.accountId
        const accountId =
          members[m].accountId ||
          (members[m].member && members[m].member.accountId);
        if (!accountId) continue;

        // Skip excluded accounts
        if (excludeSet.has(accountId)) {
          Logger.log(`   ⏭️ Excluded: ${accountId}`);
          continue;
        }

        // Record Team labels per person — for EVERY (team, member) pair,
        // not just first-seen: each membership is a distinct label of the
        // same person.
        if (teamInfoOut) {
          const effId = MERGE_MAP[accountId] || accountId;
          const info = teamInfoOut[effId] || (teamInfoOut[effId] = { teams: [] });
          if (!isRegionalTeam && team.name && info.teams.indexOf(team.name) === -1) {
            info.teams.push(team.name);
          }
        }

        // Deduplicate across teams
        if (!seenIds.has(accountId)) {
          seenIds.add(accountId);
          allIds.push(accountId);
          Logger.log(`   ✅ Member: ${accountId}`);
        }
      }

      hasMore = members.length >= 200;
      offset += 200;
    }
  }

  // Step 3: Inject MERGE_MAP secondary IDs that Tempo may not list in any team.
  //         We still need to fetch their plans so hours can be merged into the primary.
  Object.keys(MERGE_MAP).forEach((secondaryId) => {
    if (!seenIds.has(secondaryId) && !excludeSet.has(secondaryId)) {
      seenIds.add(secondaryId);
      allIds.push(secondaryId);
      Logger.log(
        `ℹ️ [fetchAllTeamMembers_] Injected MERGE_MAP secondary ID: ${secondaryId}`,
      );
    }
  });

  Logger.log(
    `✅ [fetchAllTeamMembers_] Total worker IDs to process: ${allIds.length}`,
  );
  return allIds;
}

// ── SECTION: TEMPO DATA FETCHING ─────────────────────────────

/**
 * Fetches Tempo plans for all workers and builds a plan-item type map.
 *
 * DEDUP STRATEGY (v3):
 * Using plan.id alone to skip duplicates was too aggressive — it caused
 * legitimate plans assigned to the same person under different projects
 * to be dropped. The correct duplicate fingerprint is the combination of:
 *   effectiveUserId + planItemId + startDate + endDate + plannedSecondsPerDay
 * This matches what Tempo itself shows as a "duplicate event": same person,
 * same dates, same hours — regardless of whether plan.id differs.
 *
 * @param {string} tempoToken
 * @param {string[]} workerIds - Dynamic list from fetchAllTeamMembers_()
 * @param {Object} userMap - accountId → display name (for logging only)
 * @returns {{ allPlans: Array, typeMap: Object, skippedCount: number,
 *             planRangesByUser: Object, failedUserIds: Object }}
 *          planRangesByUser: rawId → [{start, end}] plan date ranges (raw,
 *          pre-dedup) — lets the week-scoped pass skip weeks a user provably
 *          has no plans in. failedUserIds: rawId → true for users whose fetch
 *          failed after retries (coverage unknown — never prefilter them).
 */
function fetchAllPlans_(tempoToken, workerIds, userMap) {
  const allPlans = [];
  const typeMap = {};
  let skippedCount = 0;
  const planRangesByUser = {};
  const failedUserIds = {};

  // One fingerprint Set per effective (merged) user ID
  const seenFingerprintsByUser = {};

  for (let w = 0; w < workerIds.length; w++) {
    const rawId = workerIds[w];
    const effectiveId = MERGE_MAP[rawId] || rawId;
    const displayName = userMap[effectiveId] || effectiveId;

    Logger.log(
      `ℹ️ [${w + 1}/${workerIds.length}] ${displayName} (raw: ${rawId})`,
    );

    const fetchResult = fetchUserPlans_(tempoToken, rawId);
    const userPlans = fetchResult.plans;
    if (!fetchResult.ok) failedUserIds[rawId] = true;
    // Coverage ranges for the week-scoped prefilter. RECURRING plans carry
    // startDate/endDate for the FIRST occurrence only — the repeats live in
    // rule + recurrenceEndDate, so the range must extend to recurrenceEndDate
    // or the user's later weeks get skipped (a first cut ignored this and
    // dropped ~30 people whose plans recur from before the window). Missing
    // dates widen to sentinels: over-fetching an empty cell is cheap, a
    // skipped real one silently zeroes the sheet.
    planRangesByUser[rawId] = userPlans.map((p) => {
      const start = p.startDate || "0000-01-01";
      let end = p.endDate || "";
      if (p.recurrenceEndDate && p.recurrenceEndDate > end) end = p.recurrenceEndDate;
      const recursForever = p.rule && p.rule !== "NEVER" && !p.recurrenceEndDate;
      if (!end || recursForever) end = "9999-12-31";
      return { start: start, end: end };
    });
    Logger.log(`   → ${userPlans.length} plans returned from Tempo`);

    if (!seenFingerprintsByUser[effectiveId]) {
      seenFingerprintsByUser[effectiveId] = new Set();
    }

    for (let p = 0; p < userPlans.length; p++) {
      const plan = userPlans[p];
      const planType = plan.planItem ? plan.planItem.type : "UNKNOWN";

      // Skip PROJECT-level plans if CONFIGPlanured to exclude them
      if (!CONFIGPlan.INCLUDE_PROJECT_PLANS && planType === "PROJECT") {
        skippedCount++;
        continue;
      }

      // Build a content-based fingerprint: user + item + dates + hours/day
      // This catches true duplicates (same plan in two accounts) without
      // blocking distinct plans that happen to share a Tempo plan.id
      const itemId = plan.planItem ? String(plan.planItem.id) : "none";
      const fingerprint = [
        effectiveId,
        itemId,
        plan.startDate || "",
        plan.endDate || "",
        plan.plannedSecondsPerDay || 0,
      ].join("|");

      if (seenFingerprintsByUser[effectiveId].has(fingerprint)) {
        Logger.log(
          `   ⚠️ True duplicate plan skipped for ${displayName}: ${fingerprint}`,
        );
        skippedCount++;
        continue;
      }
      seenFingerprintsByUser[effectiveId].add(fingerprint);

      // Tag the plan with its resolved primary user ID for grouping later
      plan._userId = effectiveId;
      allPlans.push(plan);

      // Register item type for the resolution step
      if (plan.planItem && plan.planItem.id) {
        typeMap[String(plan.planItem.id)] = planType;
      }
    }
  }

  // Per-worker control totals + raw-id map for the person-parity check:
  // the week-scoped grid must reproduce each worker's whole-window hours;
  // any shortfall means lost cells (failed requests / prefilter miss) and
  // that worker's weeks get re-fetched individually.
  const windowHrsByWorker = {};
  const rawIdsByWorker = {};
  allPlans.forEach((plan) => {
    const worker = userMap[plan._userId] || plan._userId;
    windowHrsByWorker[worker] =
      (windowHrsByWorker[worker] || 0) +
      (plan.totalPlannedSecondsInScope || 0) / 3600;
  });
  workerIds.forEach((rawId) => {
    const worker = userMap[MERGE_MAP[rawId] || rawId] || (MERGE_MAP[rawId] || rawId);
    (rawIdsByWorker[worker] = rawIdsByWorker[worker] || []).push(rawId);
  });

  return {
    allPlans, typeMap, skippedCount, planRangesByUser, failedUserIds,
    windowHrsByWorker, rawIdsByWorker,
  };
}

/**
 * Fetches all Tempo plans for a single user, handling pagination automatically.
 * @param {string} token - Tempo Bearer token.
 * @param {string} userId - Jira account ID.
 * @returns {{ plans: Array, ok: boolean }} ok=false when a fetch failed after
 *          retries — the caller must then treat this user's coverage as
 *          UNKNOWN (never as "has no plans").
 */
function fetchUserPlans_(token, userId) {
  const allResults = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url =
      `https://api.tempo.io/4/plans/user/${userId}` +
      `?from=${CONFIGPlan.FROM_DATE}&to=${CONFIGPlan.TO_DATE}` +
      `&offset=${offset}&limit=${CONFIGPlan.TEMPO_PAGE_LIMIT}`;

    // Tempo throws transient 500s under load (a 2026-07-15 run lost ~40 of
    // 222 users to them) and transient 401s (2026-07-23). Retry 5xx/429/401
    // twice with backoff before giving up — a lost user here also strands
    // their plan items unresolved (no Key/PM/Issue) even when the
    // week-scoped pass later recovers their hours.
    let response, code;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Utilities.sleep(500 * attempt);
      response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: { Authorization: `Bearer ${token}` },
        muteHttpExceptions: true,
      });
      code = response.getResponseCode();
      if (code === 200 || (code < 500 && code !== 429 && code !== 401)) break;
    }

    if (code !== 200) {
      Logger.log(
        `   ⚠️ Tempo API ${code} for user ${userId} (after retries)`,
      );
      return { plans: allResults, ok: false };
    }

    const data = JSON.parse(response.getContentText());
    const results = data.results || [];
    allResults.push(...results);

    hasMore = results.length >= CONFIGPlan.TEMPO_PAGE_LIMIT;
    offset += CONFIGPlan.TEMPO_PAGE_LIMIT;
  }

  return { plans: allResults, ok: true };
}

// ── SECTION: JIRA DATA RESOLUTION ────────────────────────────

/**
 * Resolves plan item IDs → { name, key, pm, issueKey } using Jira.
 * Dispatches PROJECT IDs and ISSUE IDs to separate resolvers, then fills the
 * project-manager (Jira project lead) for entries the resolvers couldn't.
 * issueKey carries the issue trace for ISSUE-type plan items (e.g. MAVC-227);
 * it is "" for PROJECT-type items, whose plans have no issue by nature.
 * @param {string[]} itemIds
 * @param {Object} typeMap - itemId → "PROJECT" | "ISSUE"
 * @param {string} email
 * @param {string} token
 * @returns {Object} itemId → { name: string, key: string, pm: string, issueKey: string }
 */
function resolvePlanItems_(itemIds, typeMap, email, token) {
  const itemMap = {};
  const auth = Utilities.base64Encode(`${email}:${token}`);
  const projectIds = itemIds.filter((id) => typeMap[id] === "PROJECT");
  const issueIds = itemIds.filter((id) => typeMap[id] === "ISSUE");

  Logger.log(
    `ℹ️ Items to resolve: ${projectIds.length} projects, ${issueIds.length} issues`,
  );

  if (projectIds.length > 0) resolveProjects_(projectIds, itemMap, auth);
  if (issueIds.length > 0) resolveIssues_(issueIds, itemMap, auth);
  attachProjectLeads_(itemMap, auth);

  const resolved = Object.values(itemMap).filter(
    (v) => !v.name.startsWith("Unknown") && !v.name.startsWith("Project-"),
  ).length;
  Logger.log(`ℹ️ Resolved ${resolved} of ${itemIds.length} plan items`);

  return itemMap;
}

/**
 * Resolves PROJECT plan items via Jira's /project/{id} endpoint (batched).
 * @param {string[]} projectIds
 * @param {Object}   itemMap - mutated in place
 * @param {string}   auth
 */
function resolveProjects_(projectIds, itemMap, auth) {
  const requests = projectIds.map((id) => ({
    url: `${CONFIGPlan.JIRA_BASE}/rest/api/2/project/${id}`,
    method: "get",
    headers: { Authorization: `Basic ${auth}` },
    muteHttpExceptions: true,
  }));

  for (let b = 0; b < requests.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const responses = UrlFetchApp.fetchAll(
      requests.slice(b, b + CONFIGPlan.API_BATCH_SIZE),
    );
    responses.forEach((res, i) => {
      const id = projectIds[b + i];
      try {
        itemMap[id] =
          res.getResponseCode() === 200
            ? (() => {
                const p = JSON.parse(res.getContentText());
                return {
                  name: p.name || `Project-${id}`,
                  key: p.key || "",
                  pm: p.lead?.displayName || "",
                  issueKey: "", // PROJECT-level plan item — no issue trace
                };
              })()
            : { name: `Project-${id}`, key: "", pm: "", issueKey: "" };
      } catch (e) {
        itemMap[id] = { name: `Project-${id}`, key: "", pm: "", issueKey: "" };
      }
    });
  }
}

/**
 * Resolves ISSUE plan items via JQL batch search (Jira API v3).
 * Falls back to individual GET requests for any IDs not returned by JQL.
 * @param {string[]} issueIds
 * @param {Object}   itemMap - mutated in place
 * @param {string}   auth
 */
function resolveIssues_(issueIds, itemMap, auth) {
  for (let b = 0; b < issueIds.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const batch = issueIds.slice(b, b + CONFIGPlan.API_BATCH_SIZE);
    const jql = `id in (${batch.join(",")})`;

    try {
      const res = UrlFetchApp.fetch(
        `${CONFIGPlan.JIRA_BASE}/rest/api/3/search/jql`,
        {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: `Basic ${auth}` },
          payload: JSON.stringify({
            jql,
            fields: ["project", "issuetype"],
            maxResults: CONFIGPlan.API_BATCH_SIZE,
          }),
          muteHttpExceptions: true,
        },
      );

      if (res.getResponseCode() === 200) {
        (JSON.parse(res.getContentText()).issues || []).forEach((issue) => {
          // NOTE: the project object embedded in issue responses is slimmed —
          // it never carries `lead`. PM is filled later by attachProjectLeads_.
          itemMap[String(issue.id)] = {
            name: issue.fields?.project?.name || "Unknown",
            key: issue.fields?.project?.key || "",
            pm: "",
            issueKey: issue.key || "",
          };
        });
      }
    } catch (e) {
      Logger.log(`⚠️ [resolveIssues_] JQL batch error: ${e.message}`);
    }

    // Per-ID fallback for anything the JQL search didn't return
    const unresolved = batch.filter((id) => !itemMap[id]);
    if (unresolved.length > 0) {
      const fallback = unresolved.map((id) => ({
        url: `${CONFIGPlan.JIRA_BASE}/rest/api/3/issue/${id}?fields=project,issuetype`,
        method: "get",
        headers: { Authorization: `Basic ${auth}` },
        muteHttpExceptions: true,
      }));

      try {
        UrlFetchApp.fetchAll(fallback).forEach((res, i) => {
          const id = unresolved[i];
          try {
            itemMap[id] =
              res.getResponseCode() === 200
                ? (() => {
                    const iss = JSON.parse(res.getContentText());
                    return {
                      name: iss.fields?.project?.name || "Unknown",
                      key: iss.fields?.project?.key || "",
                      pm: "",
                      issueKey: iss.key || "",
                    };
                  })()
                : { name: "Unknown", key: "", pm: "", issueKey: "" };
          } catch (e2) {
            itemMap[id] = { name: "Unknown", key: "", pm: "", issueKey: "" };
          }
        });
      } catch (e3) {
        Logger.log(`⚠️ [resolveIssues_] Fallback error: ${e3.message}`);
      }
    }
  }
}

/**
 * Fills the `pm` field (project manager = Jira project lead) on every itemMap
 * entry that has a project key but no PM yet. Shared by TempoPlanExport.js and
 * TempoTrackedTime.js.
 *
 * WHY A SEPARATE STEP: the project object embedded in Jira ISSUE responses is
 * a slimmed version that never includes `lead`, so issue resolution cannot
 * capture the PM directly. Leads are instead fetched once per DISTINCT project
 * key (a handful of requests), then stamped onto every entry sharing that key.
 * PMs already learned by resolveProjects_ (full project GET) are reused, never
 * re-fetched. Mutates itemMap in place.
 *
 * @param {Object} itemMap - itemId → { name, key, pm, ... }
 * @param {string} auth    - Base64 "email:token" for Jira Basic auth
 */
function attachProjectLeads_(itemMap, auth) {
  const entries = Object.values(itemMap);

  // Leads already known from full-project resolution, keyed by project key.
  const knownPm = {};
  entries.forEach((v) => {
    if (v.key && v.pm) knownPm[v.key] = v.pm;
  });

  const missingKeys = Array.from(
    new Set(
      entries
        .filter((v) => v.key && !v.pm && !knownPm[v.key])
        .map((v) => v.key),
    ),
  );

  const fetchedPm = missingKeys.length
    ? fetchProjectLeads_(missingKeys, auth)
    : {};

  let filled = 0;
  entries.forEach((v) => {
    if (!v.pm && v.key) {
      v.pm = knownPm[v.key] || fetchedPm[v.key] || "";
      if (v.pm) filled++;
    }
  });
  Logger.log(
    `ℹ️ [attachProjectLeads_] PM filled on ${filled} item(s) ` +
      `(${missingKeys.length} project lead(s) fetched from Jira).`,
  );
}

/**
 * Fetches the project lead's display name for each project key (batched).
 * @param {string[]} projectKeys - Distinct Jira project keys.
 * @param {string}   auth        - Base64 "email:token" for Jira Basic auth
 * @returns {Object} projectKey → lead display name ("" when unavailable)
 */
function fetchProjectLeads_(projectKeys, auth) {
  const pmMap = {};

  const requests = projectKeys.map((key) => ({
    url: `${CONFIGPlan.JIRA_BASE}/rest/api/3/project/${encodeURIComponent(key)}?expand=lead`,
    method: "get",
    headers: { Authorization: `Basic ${auth}` },
    muteHttpExceptions: true,
  }));

  for (let b = 0; b < requests.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const responses = UrlFetchApp.fetchAll(
      requests.slice(b, b + CONFIGPlan.API_BATCH_SIZE),
    );
    responses.forEach((res, i) => {
      const key = projectKeys[b + i];
      try {
        pmMap[key] =
          res.getResponseCode() === 200
            ? JSON.parse(res.getContentText()).lead?.displayName || ""
            : "";
      } catch (e) {
        pmMap[key] = "";
      }
      if (!pmMap[key]) {
        Logger.log(`   ⚠️ [fetchProjectLeads_] No lead found for project ${key}`);
      }
    });
  }

  return pmMap;
}

/**
 * Fetches Jira display names for all worker account IDs (batched).
 * @param {string[]} userIds
 * @param {string}   email
 * @param {string}   token
 * @returns {Object} accountId → display name
 */
function fetchUserNames_(userIds, email, token) {
  const userMap = {};
  const auth = Utilities.base64Encode(`${email}:${token}`);

  const requests = userIds.map((id) => ({
    url: `${CONFIGPlan.JIRA_BASE}/rest/api/2/user?accountId=${encodeURIComponent(id)}`,
    method: "get",
    headers: { Authorization: `Basic ${auth}` },
    muteHttpExceptions: true,
  }));

  for (let b = 0; b < requests.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const responses = UrlFetchApp.fetchAll(
      requests.slice(b, b + CONFIGPlan.API_BATCH_SIZE),
    );
    responses.forEach((res, i) => {
      const userId = userIds[b + i];
      try {
        userMap[userId] =
          res.getResponseCode() === 200
            ? JSON.parse(res.getContentText()).displayName || userId
            : userId;
      } catch (e) {
        userMap[userId] = userId;
      }
    });
  }

  return userMap;
}

// ── SECTION: HOUR DISTRIBUTION LOGIC ─────────────────────────

/**
 * Formats a Date as local "YYYY-MM-DD" (no time component, no UTC shift).
 * Inverse of parseDateLocal_, used to scope Tempo API calls per week.
 * @param {Date} d
 * @returns {string}
 */
function fmtDate_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Builds per-week hours by re-querying Tempo scoped to each Monday→Sunday week
 * and reading each plan's totalPlannedSecondsInScope for that exact window.
 *
 * WHY (v6 — replaces the Mon–Fri-distribute-then-scaleFactor approach):
 * Distributing a plan's whole-window total across weeks with a hard-coded Mon–Fri
 * day counter and one global scaleFactor keeps the *grand total* correct but
 * mis-splits the weekly columns for anyone NOT on a Mon–Fri week — e.g. Sun–Thu
 * rocketeers whose Sunday was dropped and Friday wrongly counted — and for weeks
 * with holidays or mid-week plan boundaries. Tempo's totalPlannedSecondsInScope
 * is exact for ANY window we pass (proven: the whole-window grand total matches
 * Tempo). So we ask Tempo directly, one Monday→Sunday window per week column.
 * No weekday assumption, no scaleFactor, no weekend-rescue needed.
 *
 * Weeks tile the report window exactly, so summing the per-week scoped values
 * reproduces the whole-window total. Plans are de-duplicated per (effective user,
 * week) by the same content fingerprint used in fetchAllPlans_; PROJECT-level
 * plans honour CONFIGPlan.INCLUDE_PROJECT_PLANS.
 *
 * @param {string} tempoToken
 * @param {Array}  weeks      - from buildWeekRanges_ (start, calcEnd, label…)
 * @param {string[]} workerIds - raw account IDs (MERGE_MAP applied per row)
 * @param {Object} userMap    - effectiveId → display name
 * @param {Object} itemMap    - planItemId → { name, key, pm, issueKey }
 * @param {Date}   toDate     - report end; clamps the final partial week
 * @param {Object=} planRangesByUser - rawId → [{start, end}] from fetchAllPlans_;
 *                  a (user, week) with no overlapping range provably has no
 *                  plans, so its request is skipped (the 2026-07-15 run spent
 *                  ~6 of its 8 minutes on 8,880 requests, most of them empty).
 * @param {Object=} failedUserIds - rawId → true where pass 1 failed after
 *                  retries; those users' coverage is unknown → never skipped.
 * @returns {Object} groupKey → { worker, project, projectKey, pm, issue, weeklyHours[], total }
 */
function groupPlansByWeekScoped_(
  tempoToken,
  weeks,
  workerIds,
  userMap,
  itemMap,
  toDate,
  planRangesByUser,
  failedUserIds,
) {
  const grouped = {};

  // PRE-FLIGHT COST PROJECTION. This pass is O(weeks × users) — the only one in
  // the four exporters that is — so a widened window multiplies it directly.
  // Stating the worst case up front means a costly window is visible in the
  // first seconds of a run instead of being inferred from a log line minutes in.
  const worstCase = weeks.length * workerIds.length;
  Logger.log(
    `ℹ️ [weekScoped] pre-flight: up to ${worstCase} requests ` +
      `(${weeks.length} weeks × ${workerIds.length} users) before the ` +
      `plan-free prefilter. This pass is O(weeks × users).`,
  );
  if (worstCase > CONFIGPlan.WEEK_SCOPED_WARN_REQUESTS) {
    Logger.log(
      `⚠️ [weekScoped] projected ${worstCase} requests exceeds the ` +
        `WEEK_SCOPED_WARN_REQUESTS guard (${CONFIGPlan.WEEK_SCOPED_WARN_REQUESTS}). ` +
        `Expect a long run and elevated transient-500 retries. Reduce ` +
        `CONFIGPlan.HISTORY_WEEKS / FUTURE_WEEKS, or give this export the ` +
        `freeze-and-merge treatment used by TempoCapacityTime.js so completed ` +
        `weeks are not re-fetched every run.`,
    );
  }

  // Build one request per (week, raw worker id) that MAY have plans;
  // fetchAll batches them.
  const requests = [];
  const meta = []; // parallel to requests: { wi, rawId }
  let skippedCells = 0;
  for (let wi = 0; wi < weeks.length; wi++) {
    const fromStr = fmtDate_(weeks[wi].start);
    const toStr = fmtDate_(minDate_(weeks[wi].calcEnd, toDate));
    for (let u = 0; u < workerIds.length; u++) {
      const rawId = workerIds[u];

      // Prefilter: skip the cell when pass 1 succeeded for this user and none
      // of their plan ranges touch this week (YYYY-MM-DD strings compare
      // lexicographically). Unknown coverage (pass-1 failure or no range
      // info) always fetches.
      const ranges = planRangesByUser ? planRangesByUser[rawId] : null;
      const unknown = !ranges || (failedUserIds && failedUserIds[rawId]);
      if (!unknown) {
        const overlaps = ranges.some(
          (r) => r.start <= toStr && r.end >= fromStr,
        );
        if (!overlaps) {
          skippedCells++;
          continue;
        }
      }

      requests.push({
        url:
          `https://api.tempo.io/4/plans/user/${rawId}` +
          `?from=${fromStr}&to=${toStr}&limit=${CONFIGPlan.TEMPO_PAGE_LIMIT}`,
        method: "get",
        headers: { Authorization: `Bearer ${tempoToken}` },
        muteHttpExceptions: true,
      });
      meta.push({ wi: wi, rawId: rawId });
    }
  }

  Logger.log(
    `ℹ️ [weekScoped] ${requests.length} requests ` +
      `(${weeks.length} weeks × ${workerIds.length} users; ` +
      `${skippedCells} plan-free cell(s) skipped via pass-1 ranges)`,
  );

  const seen = {}; // fingerprint → true, scoped per (effective user, week)
  let pageCapHits = 0;

  // Tempo throws transient 500s under load — a 2026-07-15 run lost 1512 of
  // 8880 (user,week) cells to them, silently zeroing those weeks in the
  // sheet. Failed requests re-queue for up to 2 retry rounds (with a pause)
  // before a cell is finally given up on.
  const MAX_ROUNDS = 3;
  let pending = requests.map((req, i) => ({ req: req, m: meta[i] }));

  for (let round = 1; round <= MAX_ROUNDS && pending.length > 0; round++) {
    if (round > 1) {
      Logger.log(
        `ℹ️ [weekScoped] retry round ${round - 1}: ${pending.length} failed request(s)…`,
      );
      Utilities.sleep(2000 * (round - 1));
    }
    const failed = [];

    // The transient 500s are load-induced (~17% of a 100-wide burst fails),
    // so retry rounds drop to small batches — slower per request, but nearly
    // every retried cell recovers instead of failing again.
    const batchSize = round === 1 ? CONFIGPlan.WEEK_FETCH_BATCH : 25;
    for (let b = 0; b < pending.length; b += batchSize) {
      const slice = pending.slice(b, b + batchSize);
      const responses = UrlFetchApp.fetchAll(slice.map((s) => s.req));
      responses.forEach((res, i) => {
        const wi = slice[i].m.wi;
        const rawId = slice[i].m.rawId;
        const effectiveId = MERGE_MAP[rawId] || rawId;
        const worker = userMap[effectiveId] || effectiveId;

        if (res.getResponseCode() !== 200) {
          failed.push(slice[i]);
          return;
        }

        const results = JSON.parse(res.getContentText()).results || [];
        if (results.length >= CONFIGPlan.TEMPO_PAGE_LIMIT) pageCapHits++;

        for (let p = 0; p < results.length; p++) {
          const plan = results[p];
          const planType = plan.planItem ? plan.planItem.type : "UNKNOWN";
          if (!CONFIGPlan.INCLUDE_PROJECT_PLANS && planType === "PROJECT") {
            continue;
          }

          const itemId = plan.planItem ? String(plan.planItem.id) : "none";

          // Dedup true duplicates within this (effective user, week) bucket.
          const fingerprint = [
            effectiveId,
            wi,
            itemId,
            plan.startDate || "",
            plan.endDate || "",
            plan.plannedSecondsPerDay || 0,
          ].join("|");
          if (seen[fingerprint]) continue;
          seen[fingerprint] = true;

          const inScope = (plan.totalPlannedSecondsInScope || 0) / 3600;
          if (inScope <= 0) continue;

          const itemInfo = itemMap[itemId];
          const project = itemInfo ? itemInfo.name : `${planType}-${itemId}`;
          const projectKey = itemInfo ? itemInfo.key : "";
          const pm = itemInfo && itemInfo.pm ? itemInfo.pm : "";
          // Issue trace: blank for PROJECT-level plans; "#<id>" keeps an
          // unresolved ISSUE-level plan traceable instead of collapsing it.
          const issue =
            itemInfo && itemInfo.issueKey
              ? itemInfo.issueKey
              : planType === "ISSUE"
                ? `#${itemId}`
                : "";
          const groupKey = `${worker}|||${project}|||${issue}`;

          if (!grouped[groupKey]) {
            grouped[groupKey] = {
              worker,
              project,
              projectKey,
              pm,
              issue,
              weeklyHours: new Array(weeks.length).fill(0),
              total: 0,
            };
          }
          grouped[groupKey].weeklyHours[wi] += inScope;
          grouped[groupKey].total += inScope;
        }
      });
    }

    pending = failed;
  }

  if (pending.length > 0) {
    // Cells that failed every round — the sheet shows 0 planned hours for
    // these (user, week) pairs, so name them instead of hiding the gap.
    pending.forEach((s) => {
      Logger.log(
        `   ⚠️ Tempo gave up on ${s.m.rawId} (week ${s.m.wi + 1}) after ${MAX_ROUNDS} attempts.`,
      );
    });
    Logger.log(
      `⚠️ [weekScoped] ${pending.length} (user,week) cell(s) still failed after ` +
        `${MAX_ROUNDS - 1} retry round(s) — those weeks read as 0 planned hours.`,
    );
  }
  if (pageCapHits > 0) {
    Logger.log(
      `⚠️ [weekScoped] ${pageCapHits} (user,week) response(s) hit the ` +
        `${CONFIGPlan.TEMPO_PAGE_LIMIT}-row page cap — those weeks may be ` +
        `truncated. Raise TEMPO_PAGE_LIMIT or add pagination.`,
    );
  }

  // Per-project rollup so DIAG_PER_PLAN keeps surfacing where hours land.
  // Rows are split per issue for ISSUE-level plans, so the issue trace is shown.
  if (CONFIGPlan.DIAG_PER_PLAN) {
    Logger.log("   ──────── PER-PROJECT TOTALS (week-scoped) ────────");
    Object.values(grouped)
      .sort((a, b) =>
        (a.worker + a.project + (a.issue || "")).localeCompare(
          b.worker + b.project + (b.issue || ""),
        ),
      )
      .forEach((g) => {
        const flag =
          g.project.startsWith("Unknown") ||
          g.project.startsWith("PROJECT-") ||
          g.project.startsWith("ISSUE-")
            ? " ⚠️UNRESOLVED"
            : "";
        Logger.log(
          `   📊 ${g.worker} | "${g.project}" ${g.projectKey}${g.issue ? " | " + g.issue : ""} = ${round2_(g.total)} hrs${flag}`,
        );
      });
  }

  return grouped;
}

/**
 * Distributes each plan's hours across weeks and groups totals by user + project.
 *
 * ROUNDING STRATEGY (v3 fix):
 * All intermediate arithmetic is done in full floating-point precision.
 * round2_() is called ONLY at the final write step in buildSortedRows_().
 * Previously, rounding at each accumulation step caused compounding
 * precision loss — enough to produce the 0.35 hr gap vs the CSV export.
 *
 * WEEK BOUNDARY (carry-forward from v2):
 * Each week stores calcEnd (true Sunday, used for overlap math) separately
 * from the display label (clipped to toDate). This ensures plans that span
 * across a week boundary are never under-counted.
 *
 * RECURRING PLANS (carry-forward from v2):
 * When rule ≠ NEVER and recurrenceEndDate is absent, we default to toDate
 * so all occurrences in the report window are captured.
 *
 * @param {Array}  allPlans
 * @param {Array}  weeks
 * @param {Object} userMap
 * @param {Object} itemMap
 * @param {Date}   fromDate
 * @param {Date}   toDate
 * @returns {Object} groupKey → { worker, project, projectKey, pm, issue, weeklyHours[], total }
 */
function groupPlansByUserProject_(
  allPlans,
  weeks,
  userMap,
  itemMap,
  fromDate,
  toDate,
) {
  const grouped = {};

  for (let i = 0; i < allPlans.length; i++) {
    const plan = allPlans[i];
    const userId = plan._userId;
    const itemId = String(plan.planItem ? plan.planItem.id : "unknown");
    const itemType = plan.planItem ? plan.planItem.type : "UNKNOWN";
    const worker = userMap[userId] || userId;
    const itemInfo = itemMap[itemId];
    const project = itemInfo ? itemInfo.name : `${itemType}-${itemId}`;
    const projectKey = itemInfo ? itemInfo.key : "";
    const pm = itemInfo && itemInfo.pm ? itemInfo.pm : "";
    const issue =
      itemInfo && itemInfo.issueKey
        ? itemInfo.issueKey
        : itemType === "ISSUE"
          ? `#${itemId}`
          : "";
    const groupKey = `${worker}|||${project}|||${issue}`;

    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        worker,
        project,
        projectKey,
        pm,
        issue,
        weeklyHours: new Array(weeks.length).fill(0), // full precision floats
        total: 0,
      };
    }

    const hoursPerDay = (plan.plannedSecondsPerDay || 0) / 3600;
    const inScopeHours = (plan.totalPlannedSecondsInScope || 0) / 3600;
    const rule = plan.rule || "NEVER";
    const planStartRaw = parseDateLocal_(plan.startDate);
    const planEndRaw = parseDateLocal_(plan.endDate);

    // For recurring plans with no recurrenceEndDate, default to report end
    let recEndDate;
    if (rule !== "NEVER") {
      recEndDate = plan.recurrenceEndDate
        ? parseDateLocal_(plan.recurrenceEndDate)
        : toDate;
    } else {
      recEndDate = planEndRaw;
    }

    // Calculate raw (unscaled) hours per week — full float precision
    const rawWeekHours = new Array(weeks.length).fill(0);
    let rawTotal = 0;

    if (rule === "NEVER") {
      // Non-recurring plan: clamp to report window, distribute across weeks
      const planStart = maxDate_(planStartRaw, fromDate);
      const planEnd = minDate_(planEndRaw, toDate);

      if (planStart <= planEnd) {
        for (let wi = 0; wi < weeks.length; wi++) {
          // Use calcEnd (full Sunday boundary) — never the clipped label end
          const overlapStart = maxDate_(planStart, weeks[wi].start);
          const overlapEnd = minDate_(planEnd, weeks[wi].calcEnd);
          if (overlapStart <= overlapEnd) {
            const days = countWorkingDays_(overlapStart, overlapEnd);
            rawWeekHours[wi] += hoursPerDay * days;
            rawTotal += hoursPerDay * days;
          }
        }
      }
    } else {
      // Recurring plan: generate each weekly occurrence, clamp, distribute
      const patternDays = getDaySpan_(planStartRaw, planEndRaw);
      const effectiveEnd = minDate_(recEndDate, toDate);
      let occStart = new Date(planStartRaw.getTime());

      while (occStart <= effectiveEnd) {
        const occEnd = new Date(occStart.getTime());
        occEnd.setDate(occEnd.getDate() + patternDays);

        const clampedStart = maxDate_(occStart, fromDate);
        const clampedEnd = minDate_(occEnd, toDate);

        if (clampedStart <= clampedEnd) {
          for (let wi = 0; wi < weeks.length; wi++) {
            const oStart = maxDate_(clampedStart, weeks[wi].start);
            const oEnd = minDate_(clampedEnd, weeks[wi].calcEnd);
            if (oStart <= oEnd) {
              const days = countWorkingDays_(oStart, oEnd);
              rawWeekHours[wi] += hoursPerDay * days;
              rawTotal += hoursPerDay * days;
            }
          }
        }

        occStart.setDate(occStart.getDate() + 7);
      }
    }

    // FIX v4 — Weekend-only date range guard:
    // When a plan's date range falls entirely on a weekend (e.g. startDate=Saturday,
    // endDate=Saturday), countWorkingDays_ returns 0 → rawTotal = 0 → rawWeekHours
    // are all zero. The previous scaleFactor logic (0 raw hours × any factor = 0)
    // silently dropped the full inScopeHours for those plans.
    // Tempo still records hours for such plans via totalPlannedSecondsInScope because
    // it uses its own capacity calendar, not a Mon-Fri weekday counter.
    //
    // Solution: when rawTotal = 0 but inScopeHours > 0, skip the scale-factor path
    // entirely and distribute inScopeHours directly into whichever week bucket
    // contains the plan's startDate (clamped to the report window).
    // This faithfully replicates what Tempo's CSV export does for those records.

    let diagPath; // for the per-plan diagnostic
    let diagScale = 1;
    if (rawTotal === 0 && inScopeHours > 0) {
      // Find the week that contains this plan's (clamped) start date
      const planMidpoint = maxDate_(parseDateLocal_(plan.startDate), fromDate);
      let targetWeek = 0;
      for (let wi = 0; wi < weeks.length; wi++) {
        if (
          planMidpoint >= weeks[wi].start &&
          planMidpoint <= weeks[wi].calcEnd
        ) {
          targetWeek = wi;
          break;
        }
        // If beyond last week, keep assigning to the last bucket
        if (wi === weeks.length - 1) targetWeek = wi;
      }
      grouped[groupKey].weeklyHours[targetWeek] += inScopeHours;
      grouped[groupKey].total += inScopeHours;
      diagPath = `weekend-rescue→wk${targetWeek + 1}`;
      Logger.log(
        `   ℹ️ Weekend plan for ${worker} (${plan.startDate}→${plan.endDate}): ` +
          `${inScopeHours} hrs assigned directly to week ${targetWeek + 1}`,
      );
    } else {
      // Normal path: scale working-day-based raw hours to match Tempo's scoped total
      const scaleFactor =
        rawTotal > 0 && inScopeHours > 0 ? inScopeHours / rawTotal : 1;
      diagScale = scaleFactor;
      diagPath = inScopeHours > 0 ? "scaled" : "raw(noInScope)";
      for (let si = 0; si < weeks.length; si++) {
        // Accumulate in full precision — NO round2_ here
        grouped[groupKey].weeklyHours[si] += rawWeekHours[si] * scaleFactor;
        grouped[groupKey].total += rawWeekHours[si] * scaleFactor;
      }
    }

    // Per-plan diagnostic — high-signal fields for tracing missing hours.
    // What contributes to the row Total is `contribHrs` (= inScopeHours on the
    // scaled/rescue paths; = rawTotal when totalPlannedSecondsInScope is absent).
    if (CONFIGPlan.DIAG_PER_PLAN) {
      const unresolved =
        !itemInfo ||
        project.startsWith("Unknown") ||
        project.startsWith("PROJECT-") ||
        project.startsWith("ISSUE-");
      const contribHrs = inScopeHours > 0 ? inScopeHours : rawTotal;
      Logger.log(
        `   🧩 PLAN ${worker} | ${itemType} ${itemId} → "${project}" ${projectKey} | ` +
          `${plan.startDate}→${plan.endDate} | rule=${rule} | ` +
          `h/day=${round2_(hoursPerDay)} inScope=${round2_(inScopeHours)} ` +
          `raw=${round2_(rawTotal)} scale=${round2_(diagScale)} ` +
          `path=${diagPath} contrib=${round2_(contribHrs)}` +
          (inScopeHours <= 0 ? " ⚠️NO_INSCOPE" : "") +
          (unresolved ? " ⚠️UNRESOLVED_PROJECT(splits row)" : ""),
      );
    }
  }

  // Per-project group summary — makes split rows / missing projects obvious.
  if (CONFIGPlan.DIAG_PER_PLAN) {
    Logger.log("   ──────── PER-PROJECT TOTALS (groupKey → total) ────────");
    Object.values(grouped)
      .sort((a, b) =>
        (a.worker + a.project).localeCompare(b.worker + b.project),
      )
      .forEach((g) => {
        const flag =
          g.project.startsWith("Unknown") ||
          g.project.startsWith("PROJECT-") ||
          g.project.startsWith("ISSUE-")
            ? " ⚠️UNRESOLVED"
            : "";
        Logger.log(
          `   📊 ${g.worker} | "${g.project}" ${g.projectKey} = ${round2_(g.total)} hrs${flag}`,
        );
      });
  }

  return grouped;
}

// ── SECTION: ROW BUILDING ────────────────────────────────────

/**
 * Converts grouped plan data into sorted rows for the sheet.
 * round2_() is applied HERE — once, at the final output stage —
 * never during intermediate accumulation.
 * Superseded for the main flow by groupedToPlanRows_ + mergePlanGrid_ +
 * buildMergedRows_ (freeze-and-merge); kept for the _diag helpers, which
 * report on a single fetch window with no stored history involved.
 * @param {Object} grouped
 * @param {Array}  weeks
 * @param {Object=} teamInfoByName - display name → { team } from
 *                  buildTeamInfoByName_; missing names get a blank cell.
 * @returns {Array[]}
 */
// ── SECTION: FREEZE-AND-MERGE (pure — Node-tested) ───────────
//
// A completed week's plan is history and never changes, so the sheet is the
// system of record for it and only a small recent+future window is re-fetched.
// Mirrors mergeCapacityGrid_ in TempoCapacityTime.js, but this grid is keyed by
// (worker, project, issue) rather than a flat (user, week).

/** Local-midnight Monday of an ISO week label ("YYYY.WNN"). Named distinctly
    from TempoCapacityTime's mondayOfIsoWeek_ — every file in a GAS project
    shares one top-level scope, so a duplicate declaration would silently
    override one of them. */
function planMondayOfIso_(isoLabel) {
  const m = /^(\d{4})\.W(\d{1,2})$/.exec(String(isoLabel));
  if (!m) throw new Error(`❌ [planMondayOfIso_] Bad ISO week label: "${isoLabel}"`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(year, 0, 4 - ((jan4.getDay() + 6) % 7)); // Monday of ISO wk 1
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

/** "Mar 30 - Apr 05 2026" display label for an ISO week, rebuilt from the label
    alone so FROZEN weeks (never fetched this run) still get a proper header. */
function planWeekLabelForIso_(isoLabel) {
  const mon = planMondayOfIso_(isoLabel);
  const sun = new Date(mon.getTime());
  sun.setDate(sun.getDate() + 6);
  return formatWeekLabel_(mon, sun);
}

/**
 * Normalizes the week-scoped `grouped` output into the merge grid's shape:
 * per-ISO-week hours instead of a positional weeklyHours[] array.
 * @param {Object} grouped - groupKey → { worker, project, projectKey, pm, issue, weeklyHours[], total }
 * @param {Array}  weeks   - the FETCH window (parallel to weeklyHours indices)
 * @param {Object=} teamInfoByName - worker → { team }
 * @returns {Object} groupKey → { worker, team, project, projectKey, pm, issue, weeks: {iso → hrs} }
 */
function groupedToPlanRows_(grouped, weeks, teamInfoByName) {
  const out = {};
  Object.keys(grouped).forEach((key) => {
    const g = grouped[key];
    const ti = (teamInfoByName && teamInfoByName[g.worker]) || {};
    const wk = {};
    for (let i = 0; i < weeks.length; i++) {
      // Every fetched week is recorded, INCLUDING an explicit 0: inside the
      // refresh window "no plan" is a fact that must overwrite a stale value,
      // not a gap that falls through to the frozen one.
      wk[weeks[i].isoLabel] = Number(g.weeklyHours[i]) || 0;
    }
    out[key] = {
      worker: g.worker,
      team: ti.team || "",
      project: g.project,
      projectKey: g.projectKey || "",
      pm: g.pm || "",
      issue: g.issue || "",
      weeks: wk,
    };
  });
  return out;
}

/**
 * Merges a freshly-fetched refresh window over the stored grid.
 *
 * FREEZE RULE: a week outside `refreshIsoWeeks` keeps its STORED value and is
 * never touched. A week inside it is fully replaced by the fetched value —
 * absent from `fetched` means 0, so a plan deleted in Tempo actually disappears
 * instead of lingering forever.
 *
 * OUTPUT FLOOR: weeks before `floorIso` are dropped entirely (stored or
 * fetched), which is what keeps the sheet bounded as the window rolls.
 *
 * Rows present only in storage are KEPT (with their history) — a project that
 * had no plan activity in the refresh window must not lose its past. Rows whose
 * every remaining week is empty are dropped, so trimmed-out history doesn't
 * leave permanent all-zero rows behind.
 *
 * @param {Object} existingRows   - groupKey → { worker, team, project, projectKey, pm, issue, weeks }
 * @param {Object} fetchedRows    - same shape, from groupedToPlanRows_
 * @param {string[]} refreshIsoWeeks - ISO labels covered by this run's fetch
 * @param {string} floorIso       - retention floor, e.g. "2025.W32"
 * @returns {{ isoWeeks: string[], rows: Array }}
 */
function mergePlanGrid_(existingRows, fetchedRows, refreshIsoWeeks, floorIso) {
  const refreshSet = {};
  refreshIsoWeeks.forEach((iso) => { refreshSet[iso] = true; });

  // Column union: stored history + this run's window, floor-trimmed, sorted.
  // "YYYY.WNN" compares chronologically as a string (weeks are zero-padded).
  const isoSet = {};
  refreshIsoWeeks.forEach((iso) => { isoSet[iso] = true; });
  Object.keys(existingRows).forEach((k) => {
    Object.keys(existingRows[k].weeks).forEach((iso) => { isoSet[iso] = true; });
  });
  const isoWeeks = Object.keys(isoSet)
    .filter((iso) => iso >= floorIso)
    .sort();

  const keys = {};
  Object.keys(existingRows).forEach((k) => { keys[k] = true; });
  Object.keys(fetchedRows).forEach((k) => { keys[k] = true; });

  const rows = [];
  Object.keys(keys).forEach((key) => {
    const old = existingRows[key];
    const fresh = fetchedRows[key];

    // Fetched metadata wins — a renamed project or reassigned PM should update
    // — but never let a blank overwrite something the sheet already knew.
    const pick = (field) =>
      (fresh && fresh[field]) || (old && old[field]) || "";

    const weeks = {};
    let any = false;
    isoWeeks.forEach((iso) => {
      let v;
      if (refreshSet[iso]) {
        v = fresh && fresh.weeks[iso] !== undefined ? fresh.weeks[iso] : 0;
      } else {
        v = old && old.weeks[iso] !== undefined ? old.weeks[iso] : 0;
      }
      v = Number(v) || 0;
      weeks[iso] = v;
      if (v > 0) any = true;
    });
    if (!any) return; // nothing left after the floor trim — drop the row

    rows.push({
      key: key,
      worker: pick("worker"),
      team: pick("team"),
      project: pick("project"),
      projectKey: pick("projectKey"),
      pm: pick("pm"),
      issue: pick("issue"),
      weeks: weeks,
    });
  });

  // Same order the old buildSortedRows_ produced: worker, project, issue.
  rows.sort((a, b) => {
    let c = a.worker.localeCompare(b.worker);
    if (c !== 0) return c;
    c = a.project.localeCompare(b.project);
    return c !== 0 ? c : (a.issue || "").localeCompare(b.issue || "");
  });

  return { isoWeeks: isoWeeks, rows: rows };
}

/**
 * Merged grid → the sheet's 2D row array (same column contract as before:
 * User, Team, Space, Key, PM, Issue, Planned (hrs), …weeks…, Total (hrs)).
 * @param {{isoWeeks: string[], rows: Array}} grid
 * @returns {Array<Array>}
 */
function buildMergedRows_(grid) {
  return grid.rows.map((r) => {
    let total = 0;
    const weekCells = grid.isoWeeks.map((iso) => {
      const v = Number(r.weeks[iso]) || 0;
      total += v;
      return round2_(v);
    });
    const roundedTotal = round2_(total);
    return [r.worker, r.team, r.project, r.projectKey, r.pm, r.issue, roundedTotal]
      .concat(weekCells)
      .concat([roundedTotal]); // repeated last column, unchanged contract
  });
}

function buildSortedRows_(grouped, weeks, teamInfoByName) {
  const entries = Object.values(grouped);

  // Sort: worker name, then project name, then issue trace
  entries.sort((a, b) => {
    let c = a.worker.localeCompare(b.worker);
    if (c !== 0) return c;
    c = a.project.localeCompare(b.project);
    return c !== 0 ? c : (a.issue || "").localeCompare(b.issue || "");
  });

  return entries.map((entry) => {
    // Round the per-week hours and total only at this final output step
    const roundedWeeks = entry.weeklyHours.map((h) => round2_(h));
    const roundedTotal = round2_(entry.total);

    const ti = (teamInfoByName && teamInfoByName[entry.worker]) || {};
    const row = [
      entry.worker,
      ti.team || "",
      entry.project,
      entry.projectKey,
      entry.pm || "",
      entry.issue || "",
      roundedTotal,
    ];
    roundedWeeks.forEach((h) => row.push(h));
    row.push(roundedTotal); // repeated in the last column for quick scanning
    return row;
  });
}

// ── SECTION: SHEET WRITING ─────────────────────────────────────

/**
 * Writes all data rows and a grand-total footer to the output sheet.
 * The grand total is computed by summing the UNROUNDED grouped totals
 * (still available via the grouped object) to avoid compounding rounding error.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array[]} rows - Already-rounded 2D row array from buildSortedRows_()
 * @param {Array}   weeks
 */
/** @param {Array} weeks - only .length is used, so either week objects or the
    merged ISO-label array may be passed. */
function writeRows_(sheet, rows, weeks) {
  if (rows.length === 0) {
    sheet.getRange(3, 1).setValue("⚠️ No rows to display.");
    return;
  }

  // 6 fixed columns (User, Team, Space, Key, PM, Issue) + Planned + weeks + Total
  const FIRST_HOURS_COL = 6; // 0-based index of "Planned (hrs)"
  const totalCols = 7 + weeks.length + 1;

  // Write data rows starting at row 3 (rows 1–2 are the stacked headers)
  sheet.getRange(3, 1, rows.length, totalCols).setValues(rows);

  // Build grand-total footer by summing the rounded column values
  // (column-by-column sum of rounded rows is the most transparent approach
  //  and matches what a user would expect when they manually sum the sheet)
  const totalRow = new Array(totalCols).fill(0);
  totalRow[0] = "TOTAL";
  for (let c = 1; c < FIRST_HOURS_COL; c++) totalRow[c] = "";

  rows.forEach((row) => {
    for (let c = FIRST_HOURS_COL; c < totalCols; c++) {
      totalRow[c] += row[c] || 0;
    }
  });

  // Round the grand-total footer values
  for (let c = FIRST_HOURS_COL; c < totalCols; c++) {
    totalRow[c] = round2_(totalRow[c]);
  }

  // Write and style the total footer row (offset by the two header rows)
  const totalRowNum = rows.length + 3;
  const totalRowRange = sheet.getRange(totalRowNum, 1, 1, totalCols);
  totalRowRange.setValues([totalRow]);
  totalRowRange.setFontWeight("bold");
  totalRowRange.setBackground(CONFIGPlan.TOTAL_ROW_BG);

  // Auto-resize all columns for readability
  sheet.autoResizeColumns(1, totalCols);

  // Diagnostic summary
  const uniqueUsers = new Set(rows.map((r) => r[0]));
  const grandTotal = totalRow[totalCols - 1];
  const plannedTotal = totalRow[FIRST_HOURS_COL];

  Logger.log(`ℹ️ Unique users : ${uniqueUsers.size}`);
  Logger.log(`ℹ️ Total rows   : ${rows.length}`);
  Logger.log(`ℹ️ Grand Total  : ${grandTotal} hrs`);

  // Per-user totals for quick sanity check — flag anyone under 16 hrs
  const userTotals = {};
  rows.forEach((row) => {
    const user = row[0];
    userTotals[user] = (userTotals[user] || 0) + (row[FIRST_HOURS_COL] || 0);
  });
  Object.keys(userTotals)
    .sort()
    .forEach((user) => {
      const hrs = round2_(userTotals[user]);
      if (hrs < 16) {
        Logger.log(
          `⚠️ LOW HOURS: ${user} = ${hrs} hrs (expected ≥ 16 — check for missing plans)`,
        );
      } else {
        Logger.log(`   ${user}: ${hrs} hrs`);
      }
    });

  // Integrity check: "Planned (hrs)" column sum vs "Total (hrs)" column sum
  if (Math.abs(plannedTotal - grandTotal) > 0.01) {
    Logger.log(
      `⚠️ Integrity: Planned col (${plannedTotal}) ≠ Total col (${grandTotal})`,
    );
  } else {
    Logger.log(`✅ Integrity check passed`);
  }
}

// ── SECTION: DATE & WEEK HELPERS ─────────────────────────────

/**
 * Builds week range objects spanning fromDate → toDate.
 *
 * Each week has:
 *   start   : Monday (or report start) — used in overlap math
 *   calcEnd : Full Sunday boundary of the week — used in overlap math (NEVER clipped)
 *   label   : Display string, with end clipped to toDate for readability
 *
 * Separating calcEnd from the label end prevents the boundary-clipping bug
 * where hours in the final partial week were silently under-counted.
 *
 * @param {Date} fromDate
 * @param {Date} toDate
 * @returns {Array<{start: Date, calcEnd: Date, label: string}>}
 */
function buildWeekRanges_(fromDate, toDate) {
  const weeks = [];
  let current = new Date(fromDate.getTime());

  while (current <= toDate) {
    const weekStart = new Date(current.getTime());
    const weekCalcEnd = new Date(current.getTime());
    weekCalcEnd.setDate(weekCalcEnd.getDate() + 6); // true Sunday end — never clipped

    // Clip only for the display label, not for calculations
    const weekLabelEnd =
      weekCalcEnd > toDate
        ? new Date(toDate.getTime())
        : new Date(weekCalcEnd.getTime());

    weeks.push({
      start: weekStart,
      calcEnd: weekCalcEnd,
      label: formatWeekLabel_(weekStart, weekLabelEnd),
      isoLabel: isoWeekLabel_(weekStart), // e.g. "2026.W14" — calendar week name
    });

    current.setDate(current.getDate() + 7);
  }

  return weeks;
}

/**
 * Formats a week boundary as "Mar 30 - Apr 05 2026".
 * @param {Date} start
 * @param {Date} end
 * @returns {string}
 */
function formatWeekLabel_(start, end) {
  const s = start.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
  });
  const e = end
    .toLocaleDateString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
    })
    .replace(",", "");
  return `${s} - ${e}`;
}

/**
 * Returns the ISO-8601 calendar week name for a date, e.g. "2026.W14".
 *
 * ISO rules:
 *   - Weeks start on Monday.
 *   - Week 1 is the week containing the year's first Thursday (i.e. Jan 4).
 *   - Late-Dec / early-Jan dates can belong to the adjacent ISO year, so the
 *     year prefix is the ISO week-year (derived from the week's Thursday),
 *     not necessarily the calendar year of the input date.
 *   - The week number is zero-padded to two digits (W01–W53) to match the
 *     organization's 2026.Wnn format.
 *
 * @param {Date} date - Any day within the target week (typically the Monday).
 * @returns {string} ISO week label, e.g. "2026.W01".
 */
function isoWeekLabel_(date) {
  // Work in UTC to avoid DST/offset drift; normalize to midnight.
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );

  // Shift to the Thursday of this week (Mon=0 … Sun=6). The ISO week-year is
  // the calendar year of that Thursday.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const isoYear = d.getUTCFullYear();

  // Thursday of ISO week 1 (the week containing Jan 4).
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

  const weekNum =
    1 +
    Math.round(
      (d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000),
    );
  const ww = weekNum < 10 ? `0${weekNum}` : `${weekNum}`;

  return `${isoYear}.W${ww}`;
}

/**
 * Parses "YYYY-MM-DD" as a local midnight Date.
 * Using "T00:00:00" avoids UTC offset issues that can shift the date by one day.
 * @param {string} dateStr
 * @returns {Date}
 */
function parseDateLocal_(dateStr) {
  return new Date(dateStr + "T00:00:00");
}

/**
 * Counts weekdays (Mon–Fri) between two dates, inclusive.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {number}
 */
function countWorkingDays_(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate.getTime());
  while (cur <= endDate) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Returns the calendar day span from start to end.
 * Used to measure the pattern length of a recurring plan.
 * @param {Date} start
 * @param {Date} end
 * @returns {number}
 */
function getDaySpan_(start, end) {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

/** Returns the later of two Dates. */
function maxDate_(a, b) {
  return a >= b ? a : b;
}

/** Returns the earlier of two Dates. */
function minDate_(a, b) {
  return a <= b ? a : b;
}

/**
 * Rounds to 2 decimal places.
 * Called ONLY at final output — never during intermediate accumulation.
 * @param {number} n
 * @returns {number}
 */
function round2_(n) {
  return Math.round(n * 100) / 100;
}

// ── SECTION: TRIGGER SETUP ────────────────────────────────────

/**
 * ONE-TIME SETUP: Installs a weekly trigger to auto-refresh every Monday at 8 AM.
 * Run once from the Apps Script editor; check Apps Script > Triggers to confirm.
 */
function createWeeklyTrigger() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('createWeeklyTrigger');
  else Logger.log('⚠️ [createWeeklyTrigger] requireMaintainer_ not in this project — running ungated.');
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoPlannedTime")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("fetchTempoPlannedTime")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  Logger.log(
    "⚙️ Weekly trigger installed: every Monday at 8 AM → fetchTempoPlannedTime()",
  );
}

// ── SECTION: DIAGNOSTICS (read-only, no sheet writes) ─────────

/**
 * Fetches a single user's Tempo plans scoped to an arbitrary [from,to] window.
 * Mirrors fetchUserPlans_ but with caller-supplied dates instead of CONFIGPlan.
 * @param {string} token
 * @param {string} userId
 * @param {string} fromStr - "YYYY-MM-DD"
 * @param {string} toStr   - "YYYY-MM-DD"
 * @returns {Array} plan objects
 */
function fetchUserPlansRange_(token, userId, fromStr, toStr) {
  const all = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const url =
      `https://api.tempo.io/4/plans/user/${userId}` +
      `?from=${fromStr}&to=${toStr}` +
      `&offset=${offset}&limit=${CONFIGPlan.TEMPO_PAGE_LIMIT}`;
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      Logger.log(`   ⚠️ Tempo ${res.getResponseCode()} for ${userId}`);
      return all;
    }
    const results = JSON.parse(res.getContentText()).results || [];
    all.push(...results);
    hasMore = results.length >= CONFIGPlan.TEMPO_PAGE_LIMIT;
    offset += CONFIGPlan.TEMPO_PAGE_LIMIT;
  }
  return all;
}

/**
 * VALIDATION TEST — does Tempo's totalPlannedSecondsInScope, when the API is
 * scoped to a single Monday→Sunday week, equal what Tempo's UI shows for that
 * week? If yes, per-week API scoping is the exact fix for the per-week drift.
 *
 * Edit NAME / WEEK_FROM / WEEK_TO below, then run from the Apps Script editor
 * and read the log. Read-only: fetches plans, writes nothing to the sheet.
 */
function _diagWeekScope_() {
  const NAME = "John"; // substring of the display name to test (e.g. "John")
  const WEEK_FROM = "2026-03-30"; // Monday
  const WEEK_TO = "2026-04-05"; // Sunday

  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

  // Match raw IDs whose (merged) display name contains NAME
  const matches = workerIds.filter((rawId) => {
    const eff = MERGE_MAP[rawId] || rawId;
    return (userMap[eff] || "").toLowerCase().includes(NAME.toLowerCase());
  });

  if (matches.length === 0) {
    Logger.log(`❌ No worker matched "${NAME}"`);
    return;
  }

  Logger.log(`──── WEEK-SCOPE TEST: "${NAME}" | ${WEEK_FROM} → ${WEEK_TO} ────`);
  let weekSum = 0;
  matches.forEach((rawId) => {
    const eff = MERGE_MAP[rawId] || rawId;
    const name = userMap[eff] || eff;
    const plans = fetchUserPlansRange_(tempoToken, rawId, WEEK_FROM, WEEK_TO);
    plans.forEach((p) => {
      const inScope = (p.totalPlannedSecondsInScope || 0) / 3600;
      const perDay = (p.plannedSecondsPerDay || 0) / 3600;
      weekSum += inScope;
      Logger.log(
        `   🧩 ${name} | ${p.planItem ? p.planItem.type + " " + p.planItem.id : "?"} | ` +
          `${p.startDate}→${p.endDate} | rule=${p.rule || "NEVER"} | ` +
          `h/day=${round2_(perDay)} inScope=${round2_(inScope)}`,
      );
    });
  });
  Logger.log(
    `   ✅ WEEK-SCOPED SUM for "${NAME}" = ${round2_(weekSum)} hrs ` +
      `(compare to Tempo UI for that week)`,
  );
}
