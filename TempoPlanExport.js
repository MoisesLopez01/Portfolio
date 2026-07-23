// ============================================================
// ⚙️  CONFIGURATION — Edit these values before running
// ============================================================
const CONFIGPlan = {
  SCRIPT_LABEL: "Tempo Reports", // Label shown in the custom menu and logs
  SHEET_NAME: "Planned Time Tempo", // Exact name of the output sheet tab
  JIRA_BASE: "https://servicerocket-coe.atlassian.net", // Your Jira base URL
  FROM_DATE: "2026-03-30", // Start of date range (YYYY-MM-DD)
  TO_DATE: "2026-12-31", // End of date range (YYYY-MM-DD)
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
//        their ISO labels will not align to calendar weeks.
//
//  2. DATE WINDOW  (CONFIGPlan.FROM_DATE → CONFIGPlan.TO_DATE)
//     Only the portion of each plan that overlaps this range is counted.
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
  const props = PropertiesService.getScriptProperties();
  props.setProperty("TEMPO_API_TOKEN", "PASTE_TEMPO_API_TOKEN_HERE");
  props.setProperty("JIRA_EMAIL", "PASTE_JIRA_EMAIL_HERE");
  props.setProperty("JIRA_API_TOKEN", "PASTE_JIRA_API_TOKEN_HERE");
  Logger.log("🔐 Credentials stored in Script Properties.");
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
 * Main function: fetches all Tempo planned hours for the CONFIGPlanured
 * date range and writes a weekly breakdown table to the output sheet.
 */
function fetchTempoPlannedTime() {
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
    const workerIds = fetchAllTeamMembers_(tempoToken);
    Logger.log(`ℹ️ Workers discovered: ${workerIds.length}`);

    // Step 6: Fetch Jira display names for all discovered worker account IDs
    Logger.log("ℹ️ Fetching user display names from Jira...");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

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
    if (Math.abs(windowTotalHrs - weekScopedTotalHrs) > 0.5) {
      Logger.log(
        `⚠️ Week-scoped total differs from whole-window by ` +
          `${round2_(weekScopedTotalHrs - windowTotalHrs)} hrs — check week tiling / page caps.`,
      );
    }

    // Step 10: Sort rows and build 2D array for the sheet
    const sortedRows = buildSortedRows_(grouped, weeks);

    // Step 11: Prepare the sheet (clear + headers) and write rows +
    // grand-total footer — deferred to here so a failed run above never
    // wipes the previous export.
    const sheet = prepareSheet_(weeks);
    writeRows_(sheet, sortedRows, weeks);

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
 * Row 2 (date header):    "User", "Space", "Key", "PM", "Issue",
 *                         "Planned (hrs)", the week date ranges
 *                         (e.g. "Mar 30 - Apr 05 2026"), and "Total (hrs)".
 *
 * "PM" is the Jira project lead of the plan's project (see attachProjectLeads_).
 * "Issue" is the plan's issue key for ISSUE-level plans (planning-granularity
 * validation); blank means a PROJECT-level plan, which has no issue by nature.
 * Column order mirrors the Tempo Tracked Time sheet. Downstream readers
 * (PS dashboard, demand dashboard) locate columns by header name, so the
 * inserts are safe for them.
 *
 * @param {Array<{label: string, isoLabel: string}>} weeks
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function prepareSheet_(weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGPlan.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGPlan.SHEET_NAME);
  sheet.clear();

  // Row 1 — ISO week names; blank over the fixed columns and the total column.
  const isoRow = ["", "", "", "", "", ""];
  weeks.forEach((w) => isoRow.push(w.isoLabel));
  isoRow.push("");

  // Row 2 — existing date-range headers.
  const dateRow = ["User", "Space", "Key", "PM", "Issue", "Planned (hrs)"];
  weeks.forEach((w) => dateRow.push(w.label));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGPlan.HEADER_BG);
  headerRange.setFontColor(CONFIGPlan.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(6);

  return sheet;
}

// ── SECTION: TEAM MEMBER DISCOVERY ───────────────────────────

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
 * @returns {string[]} Flat, deduplicated array of account IDs to process.
 */
function fetchAllTeamMembers_(token) {
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
 * @param {Object} grouped
 * @param {Array}  weeks
 * @returns {Array[]}
 */
function buildSortedRows_(grouped, weeks) {
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

    const row = [
      entry.worker,
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
function writeRows_(sheet, rows, weeks) {
  if (rows.length === 0) {
    sheet.getRange(3, 1).setValue("⚠️ No rows to display.");
    return;
  }

  // 5 fixed columns (User, Space, Key, PM, Issue) + Planned + weeks + Total
  const FIRST_HOURS_COL = 5; // 0-based index of "Planned (hrs)"
  const totalCols = 6 + weeks.length + 1;

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
