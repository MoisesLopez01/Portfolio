// ============================================================
// TempoTrackedTime.js
// Exports Tempo logged (actual) time for all Rocketeers.
//
// SHARED GLOBALS (from TempoPlanExport.js — do not redeclare):
//   MERGE_MAP, EXCLUDE_IDS, getCredentials_(), fetchAllTeamMembers_(),
//   fetchUserNames_(), buildWeekRanges_(), fmtDate_(), parseDateLocal_(),
//   isoWeekLabel_(), formatWeekLabel_(), maxDate_(), minDate_(), round2_(),
//   attachProjectLeads_(), fetchProjectLeads_()
// ============================================================

const CONFIGLogged = {
  SCRIPT_LABEL:     "Tempo Logged Time Reports",
  // Must match CONFIG_PS.SHEET_TEMPO_TRACKED in "PS Contribution Report.js" — this is
  // the sheet the dashboard reads tracked time (and the "Last Export:" stamp) from.
  SHEET_NAME:       "Tempo Tracked Time",
  JIRA_BASE:        "https://servicerocket-coe.atlassian.net",
  // ── Rolling history window (was a fixed "2026-05-25" anchor) ──
  // The fixed anchor grew the window by a week every week forever; the export
  // is now bounded to EXPORT_HISTORY_WEEKS of history (shared dial, defined in
  // TempoPlanExport.js), so daily-trigger runtime stays flat.
  //
  // Cost of widening: Tempo is queried ONCE PER USER for the whole range
  // (fetchWorklogsBatched_ below), paginated at TEMPO_PAGE_LIMIT=500. One
  // person logs roughly 5–10 worklogs a week, so even a 52-week range is
  // ~250–520 worklogs — one page, occasionally two. Request count therefore
  // tracks HEADCOUNT, not window length: going from 10 to 52 weeks costs at
  // most one extra page for the busiest people, not 5× the calls.
  get FROM_DATE() {
    return typeof rollingWindowMonday_ === "function"
      ? fmtDate_(rollingWindowMonday_(exportHistoryWeeks_()))
      : "2026-05-25"; // standalone fallback — TempoPlanExport.js not loaded
  },
  get TO_DATE()   { return fmtDate_(new Date()); }, // always today, evaluated on every access
  // OFF since 2026-10-28 (2026.W44): one Logger line per worklog and then one
  // per grouped row (~25,000 lines a run) was the whole difference between a
  // 28-minute run and the 30-minute trigger ceiling — the export timed out on
  // Oct 24, 27 and 28 inside that loop (Apps Script "Exceeded maximum
  // execution time"), leaving the Tempo Tracked Time tab stale for every
  // dashboard. Flip to true only for a one-off manual run from the editor.
  DIAG_PER_WORKLOG: false,
  API_BATCH_SIZE:   50,
  // Classic Epic Link custom field (matches CONFIGJ.EPIC_LINK_FIELD in
  // "Jira Backlog.js"). Team-managed projects link via parent instead.
  EPIC_LINK_FIELD:  "customfield_10014",
  TEMPO_PAGE_LIMIT: 500,
  HEADER_BG:        "#4472C4",
  HEADER_FONT:      "#FFFFFF",
  TOTAL_ROW_BG:     "#D6E4F0",
};

// Tempo's own service account authors synced worklogs — it is a sync artifact,
// never a real time-logger. (This is the account Jira showed for every
// MAVC-227 worklog.) Add further app/bot accountIds here as they surface.
const NON_HUMAN_AUTHOR_IDS = new Set([
  "557058:295406f3-a1fc-4733-b906-dd15d021bd79", // "Timesheets by Tempo - Jira Time Tracking"
]);
const UNATTRIBUTED_LABEL = "⚠️ Unattributed (no human author)";

// ============================================================
// 🔎  FILTERS & EXCLUSIONS — What is left out of the report
//
// The worklog pipeline narrows the data at several points. Each filter below
// removes or reshapes records on the way to the sheet. They are listed in the
// order they take effect. logActiveLoggedFilters_() echoes the active
// configuration to the Apps Script log at the start of every run so you can
// follow exactly what was excluded.
//
//  1. WEEK CONVENTION (Mon–Sun)
//     Weeks run Monday→Sunday (ISO-8601). buildWeekRanges_ starts each week
//     at FROM_DATE and ends it 6 days later (Sunday). The ISO week label
//     (e.g. 2026.W14) is derived from the week's Monday.
//     ⚠️ DEPENDENCY: FROM_DATE must be a Monday — now guaranteed by
//        construction (rollingWindowMonday_ always returns a Monday), so the
//        old manual "must stay a Monday" discipline no longer applies.
//
//  2. DATE WINDOW  (CONFIGLogged.FROM_DATE → CONFIGLogged.TO_DATE)
//     ROLLING: EXPORT_HISTORY_WEEKS of history back from this week's Monday
//     (shared dial in TempoPlanExport.js) through today. Bounded, so runtime
//     stays flat instead of creeping up one week per week.
//     Tempo is queried for worklogs in this range only. TO_DATE is always
//     today (live getter). A worklog whose startDate somehow falls outside
//     the built week buckets is DROPPED with a ⚠️ log line, and surfaces in
//     the collected-vs-grouped integrity check.
//
//  3. WORKER DISCOVERY SCOPE  (Tempo Teams)
//     Only people who are members of at least one Tempo Team are QUERIED
//     (plus MERGE_MAP secondary IDs, see #5). Anyone not on a Tempo Team is
//     not fetched directly — their worklogs appear only if surfaced under a
//     member's endpoint (on-behalf logging), in which case they are credited
//     to the real author (see #6a) and their display name is resolved.
//
//  4. EXCLUDE_IDS
//     Account IDs listed in EXCLUDE_IDS are dropped during discovery
//     (bots, contractors, former employees, etc.). Currently: see EXCLUDE_IDS.
//
//  5. MERGE_MAP  (consolidation, not removal)
//     Secondary accounts are fetched and their hours merged into the primary
//     account under one display name. No hours are lost; rows are combined.
//
//  6. DUPLICATE WORKLOGS  (content fingerprint)
//     A worklog is counted once per fingerprint of
//     effectiveAuthorId | worklogId | issueId | startDate | timeSpentSeconds | description.
//     Exact repeats (e.g. the same worklog surfaced via two merged accounts,
//     or an on-behalf worklog returned under both users' endpoints) are
//     skipped and reported as "Duplicates skipped".
//
//  6a. AUTHOR ATTRIBUTION
//     Hours are credited to the worklog's own author.accountId, never to the
//     account whose endpoint returned it. Query-vs-author mismatches are
//     logged as ⚠️ AUTHOR MISMATCH lines.
//
//  7. ZERO-HOUR WORKLOGS
//     Worklogs with timeSpentSeconds ≤ 0 contribute nothing and are skipped
//     silently (they carry no hours to trace).
//
//  8. MISSING START DATE
//     A worklog without a startDate cannot be placed in a week bucket; it is
//     DROPPED with a ⚠️ log line and surfaces in the integrity check.
// ============================================================

// ── SECTION: MAIN ENTRY POINT ────────────────────────────────

// Entry point for the daily trigger and manual runs. The gate runs first so an
// unauthorized google.script.run call never stamps the ledger as "failed".
// typeof guards: this file can live in its own Apps Script project.
function fetchTempoLoggedTime() {
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoLoggedTime');
  if (typeof withSourceStatus_ !== 'function') return fetchTempoLoggedTimeBody_();
  return withSourceStatus_("tempo_tracked", fetchTempoLoggedTimeBody_);
}

/**
 * Main function: fetches all Tempo logged (actual) time for the configured
 * date range and writes a weekly breakdown table to the output sheet.
 */
function fetchTempoLoggedTimeBody_() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoLoggedTime');
  else Logger.log('⚠️ [fetchTempoLoggedTime] requireMaintainer_ not in this project — running ungated.');
  try {
    Logger.log(`🕐 [fetchTempoLoggedTime] Started at ${new Date().toISOString()}`);

    const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

    const fromDate = parseDateLocal_(CONFIGLogged.FROM_DATE);
    const toDate   = parseDateLocal_(CONFIGLogged.TO_DATE);
    Logger.log(`ℹ️ Logged time date range: ${CONFIGLogged.FROM_DATE} → ${CONFIGLogged.TO_DATE}`);

    const weeks = buildWeekRanges_(fromDate, toDate);
    Logger.log(`ℹ️ Built ${weeks.length} week columns`);

    // Echo the active filters so the log shows what will be left out
    logActiveLoggedFilters_(fromDate, weeks);

    // The sheet is prepared (cleared) only AFTER every fetch has succeeded —
    // preparing it up front meant a failed Tempo/Jira call (e.g. the
    // 2026-07-23 transient 401 on the Teams fetch) left a wiped, empty
    // sheet instead of keeping yesterday's data.
    Logger.log("ℹ️ Discovering team members from Tempo Teams...");
    const teamInfoById = {};
    const workerIds = fetchAllTeamMembers_(tempoToken, teamInfoById);
    Logger.log(`ℹ️ Workers discovered: ${workerIds.length}`);

    Logger.log("ℹ️ Fetching user display names from Jira...");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    // Team lookup keyed by display name — the key the grouped rows carry.
    // On-behalf authors resolved later aren't on any Tempo Team, so they
    // simply get a blank Team cell. Shared with TempoPlanExport.
    const teamInfoByName = buildTeamInfoByName_(teamInfoById, userMap);

    Logger.log("ℹ️ Fetching Tempo worklogs for every worker...");
    const { allWorklogs, issueIds, skippedCount, unknownAuthorIds } = fetchAllWorklogs_(
      tempoToken, workerIds, userMap,
    );
    Logger.log(
      `ℹ️ Worklogs collected: ${allWorklogs.length} | Duplicates skipped: ${skippedCount}`,
    );

    // Worklog authors outside the Tempo-team roster (on-behalf logging) still
    // need display names, or their rows would show a raw accountId.
    if (unknownAuthorIds.length > 0) {
      Logger.log(
        `ℹ️ Resolving ${unknownAuthorIds.length} worklog author(s) not on any Tempo Team...`,
      );
      const extraNames = fetchUserNames_(unknownAuthorIds, jiraEmail, jiraToken);
      Object.keys(extraNames).forEach((id) => { userMap[id] = extraNames[id]; });
    }

    if (allWorklogs.length === 0) {
      const sheet = prepareLoggedSheet_(weeks);
      sheet.getRange(3, 1).setValue("⚠️ No logged time data found for this period.");
      Logger.log("⚠️ No worklogs found — nothing to write.");
      return;
    }

    const issueMap = resolveWorklogIssues_(issueIds, jiraEmail, jiraToken);

    // Rescue issues Jira couldn't return (deleted / no browse permission)
    // by parsing the issue key out of the worklog descriptions.
    enrichUnresolvedFromDescriptions_(allWorklogs, issueMap);

    // Fill the PM (Jira project lead) per distinct project key — after the
    // rescue step so rescued entries get a PM too. Shared with TempoPlanExport.
    attachProjectLeads_(
      issueMap,
      Utilities.base64Encode(`${jiraEmail}:${jiraToken}`),
    );

    const grouped = groupWorklogsByUserIssueWeek_(
      allWorklogs, weeks, userMap, issueMap,
    );

    // Integrity — every collected worklog hour should land in a week bucket.
    // A gap means worklogs were dropped (missing startDate / outside the
    // built week range) — the per-record ⚠️ lines above say which ones.
    const collectedTotalHrs = allWorklogs.reduce(
      (s, w) => s + (w.timeSpentSeconds || 0) / 3600,
      0,
    );
    const groupedTotalHrs = Object.values(grouped).reduce(
      (s, g) => s + g.total,
      0,
    );
    Logger.log(
      `ℹ️ Grand total — collected: ${round2_(collectedTotalHrs)} hrs | ` +
        `grouped into weeks: ${round2_(groupedTotalHrs)} hrs`,
    );
    if (Math.abs(collectedTotalHrs - groupedTotalHrs) > 0.5) {
      Logger.log(
        `⚠️ Grouped total differs from collected by ` +
          `${round2_(groupedTotalHrs - collectedTotalHrs)} hrs — check dropped worklogs above.`,
      );
    }

    const sortedRows = buildLoggedSortedRows_(grouped, weeks, teamInfoByName);
    const sheet = prepareLoggedSheet_(weeks);
    writeLoggedRows_(sheet, sortedRows, weeks);

    // Name normalization (Change Names.js) — Tempo display names → roster
    // legal names, in-place, so downstream joins match without the manual
    // normalizeAllNames() step after every run.
    try {
      const renamed = normalizeSheetNames_(sheet, NAME_MAPST.TEMPO, 1, 3);
      Logger.log(`ℹ️ Name normalization: ${renamed} name(s) updated.`);
    } catch (e) {
      Logger.log(`⚠️ Name normalization skipped (${e.message}) — run normalizeAllNames() manually.`);
    }

    Logger.log(`✅ [fetchTempoLoggedTime] Done. ${sortedRows.length} rows written.`);
  } catch (e) {
    Logger.log(`❌ [fetchTempoLoggedTime] ${e.message}`);
    throw e;
  }
}

// ── SECTION: FILTER REPORTING ────────────────────────────────

/**
 * Logs every active filter/exclusion so each run shows what will be left out.
 * See the "FILTERS & EXCLUSIONS" block at the top of this file for the full
 * description of each filter. This only reports configuration that is known
 * up front; counts that are only knowable after fetching (duplicates skipped,
 * dropped worklogs) are logged later by fetchAllWorklogs_ /
 * groupWorklogsByUserIssueWeek_ and the integrity check.
 *
 * @param {Date}  fromDate - Parsed CONFIGLogged.FROM_DATE.
 * @param {Array<{isoLabel: string, label: string}>} weeks
 */
function logActiveLoggedFilters_(fromDate, weeks) {
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
      `   ⚠️ FROM_DATE (${CONFIGLogged.FROM_DATE}) is NOT a Monday — week buckets/ISO labels will be misaligned.`,
    );
  }

  // 2. Date window
  Logger.log(
    `2. Date window: ${CONFIGLogged.FROM_DATE} → ${CONFIGLogged.TO_DATE} (worklogs outside the week buckets are dropped with a warning).`,
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

  // 6. Duplicate dedup + author attribution (rule; counts reported later)
  Logger.log(
    "6. Duplicate worklogs: collapsed by fingerprint author|worklogId|issue|date|seconds|description (count logged after fetch); hours credited to the worklog author, not the queried account.",
  );

  // 7–8. Record-level drops
  Logger.log(
    "7. Zero-hour worklogs skipped; worklogs missing startDate dropped with a ⚠️ line (both surface in the integrity check).",
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
 *                         "Assignee", "Issue", "Summary", "Epic Key",
 *                         "Parent Key", "Logged (hrs)", the week date ranges
 *                         (e.g. "Mar 30 - Apr 05 2026"), and "Total (hrs)".
 *
 * "Team" is a PERSON-level attribute of User from Tempo Team membership
 * (fetchAllTeamMembers_ / buildTeamInfoByName_ in TempoPlanExport.js):
 * every non-regional Tempo team the person belongs to, " | "-joined into
 * one cell — each distinct combination is its own filter value. Blank
 * when none.
 *
 * "Key" stays the PROJECT key — the PS dashboard and the demand dashboard
 * both locate it by that exact header for project context. "PM" is the Jira
 * project lead (see attachProjectLeads_), placed after "Key" to match the
 * Planned Time Tempo sheet. "Assignee" is the Jira issue assignee (ticket
 * owner) — shown beside User (who logged the time) so the two stop reading
 * as a contradiction. "Issue" carries the issue-level trace
 * (e.g. SRSO-123, or #<id> when unresolvable).
 *
 * @param {Array<{label: string, isoLabel: string}>} weeks
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function prepareLoggedSheet_(weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGLogged.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGLogged.SHEET_NAME);
  sheet.clear();

  const isoRow = ["", "", "", "", "", "", "", "", "", "", ""];
  weeks.forEach((w) => isoRow.push(w.isoLabel));
  isoRow.push("");

  const dateRow = ["User", "Team", "Space", "Key", "PM", "Assignee", "Issue", "Summary", "Epic Key", "Parent Key", "Logged (hrs)"];
  weeks.forEach((w) => dateRow.push(w.label));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGLogged.HEADER_BG);
  headerRange.setFontColor(CONFIGLogged.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(11);

  return sheet;
}

// ── SECTION: TEMPO DATA FETCHING ─────────────────────────────

/**
 * Fetches Tempo worklogs for all workers and collects the issue IDs to resolve.
 *
 * AUTHOR ATTRIBUTION (v2 fix): each worklog is credited to its own
 * author.accountId, NOT the account the endpoint was queried with. Tempo's
 * /4/worklogs/user/{id} can return worklogs authored by someone else (logged
 * on behalf, shared accounts, MERGE_MAP overlaps); stamping the queried id
 * credited those hours to the wrong person (e.g. MAVC-227 showed the querier,
 * not the real author). Every query-vs-author mismatch is logged with an
 * ⚠️ AUTHOR MISMATCH line. Authors missing from the Tempo-team roster are
 * returned in unknownAuthorIds so the caller can resolve their display names.
 *
 * DEDUP STRATEGY (mirrors fetchAllPlans_ in TempoPlanExport.js):
 * The duplicate fingerprint is content-based —
 *   effectiveAuthorId + worklogId + issueId + startDate + timeSpentSeconds + description
 * — keyed to the REAL author, so the same on-behalf worklog surfacing under
 * two users' endpoints is counted once (previously it double-counted), while
 * distinct worklogs that share a date/issue are all kept.
 *
 * @param {string} tempoToken
 * @param {string[]} workerIds - Dynamic list from fetchAllTeamMembers_()
 * @param {Object} userMap - accountId → display name (for logging only)
 * @returns {{ allWorklogs: Array, issueIds: string[], skippedCount: number, unknownAuthorIds: string[] }}
 */
function fetchAllWorklogs_(tempoToken, workerIds, userMap) {
  const allWorklogs = [];
  const issueIds = new Set();
  const unknownAuthorIds = new Set();
  let skippedCount = 0;
  let mismatchCount = 0;
  let noAuthorCount = 0;
  let unattributedCount = 0;
  const seenFingerprintsByUser = {};

  // One parallel batched fetch for every user (was 1 sequential round-trip
  // per user — the export's dominant cost). Attribution below is unchanged:
  // it works off each worklog's own author, not the queried account.
  Logger.log(`ℹ️ Fetching worklogs for ${workerIds.length} workers (batched)…`);
  const worklogsByUser = fetchWorklogsBatched_(tempoToken, workerIds);

  for (let w = 0; w < workerIds.length; w++) {
    const rawId = workerIds[w];
    const effectiveId = MERGE_MAP[rawId] || rawId;
    const displayName = userMap[effectiveId] || effectiveId;

    const userWorklogs = worklogsByUser[rawId] || [];
    Logger.log(
      `ℹ️ [${w + 1}/${workerIds.length}] ${displayName} (raw: ${rawId}) → ${userWorklogs.length} worklogs`,
    );

    for (let i = 0; i < userWorklogs.length; i++) {
      const wl = userWorklogs[i];
      const issueId =
        wl.issue && wl.issue.id
          ? String(wl.issue.id)
          : wl.issueId
            ? String(wl.issueId)
            : "none";

      // Credit the worklog's ACTUAL author. Tempo has shipped the author in
      // several shapes, so resolve across all of them before giving up:
      //   1. v4 nested object   { author: { accountId: "..." } }
      //   2. flat field         { authorAccountId: "..." }
      //   3. author self URL    { author: { self: "...user?accountId=..." } }
      // Only when every path is empty does the queried account stand in —
      // and that fallback is logged LOUDLY, never applied silently.
      const authorFromSelf =
        wl.author && wl.author.self
          ? (String(wl.author.self).match(/accountId=([^&]+)/) || [])[1]
          : null;
      const actualAuthorId =
        (wl.author && wl.author.accountId ? String(wl.author.accountId) : null) ||
        (wl.authorAccountId ? String(wl.authorAccountId) : null) ||
        (authorFromSelf ? decodeURIComponent(authorFromSelf) : null);

      if (!actualAuthorId) {
        noAuthorCount++;
        Logger.log(
          `   ⚠️ NO AUTHOR FIELD on worklog ${wl.tempoWorklogId || wl.id || "?"} ` +
            `(issue ${issueId}, date ${wl.startDate || "?"}). ` +
            `raw: ${JSON.stringify(wl).slice(0, 200)}`,
        );
      }

      // An app-account author is a sync artifact — treat it as no human author.
      let humanAuthorId = actualAuthorId;
      if (humanAuthorId && NON_HUMAN_AUTHOR_IDS.has(humanAuthorId)) humanAuthorId = null;

      // NEVER silently credit the queried account. If the real author is
      // unknown, quarantine the worklog so its hours stay visible but are not
      // pinned on whoever we happened to query (this is what put MAVC-227
      // under two different consultants and double-counted it).
      let resolvedAuthor;
      if (humanAuthorId) {
        resolvedAuthor = MERGE_MAP[humanAuthorId] || humanAuthorId;
        if (humanAuthorId !== rawId) {
          mismatchCount++;
          Logger.log(
            `   ⚠️ AUTHOR MISMATCH: queried ${rawId} but worklog author is ${humanAuthorId} ` +
              `(issue ${issueId}, date ${wl.startDate || "?"}) — credited to the author.`,
          );
        }
      } else {
        unattributedCount++;
        resolvedAuthor = UNATTRIBUTED_LABEL;
        Logger.log(
          `   ⛔ UNATTRIBUTED worklog ${wl.tempoWorklogId || wl.id || "?"} ` +
            `(issue ${issueId}, date ${wl.startDate || "?"}) — no human author; ` +
            `queried ${rawId}. NOT credited to the queried account.`,
        );
      }

      if (!seenFingerprintsByUser[resolvedAuthor]) {
        seenFingerprintsByUser[resolvedAuthor] = new Set();
      }

      const fingerprint = [
        resolvedAuthor,
        wl.tempoWorklogId || wl.id || "",
        issueId,
        wl.startDate || "",
        wl.timeSpentSeconds || 0,
        wl.description || "",
      ].join("|");

      if (seenFingerprintsByUser[resolvedAuthor].has(fingerprint)) {
        Logger.log(`   ⚠️ Duplicate worklog skipped (author ${resolvedAuthor}): ${fingerprint}`);
        skippedCount++;
        continue;
      }
      seenFingerprintsByUser[resolvedAuthor].add(fingerprint);
      wl._userId = resolvedAuthor;
      // The sentinel is a display label, not an accountId — keep it out of
      // the Jira name-resolution batch.
      if (resolvedAuthor !== UNATTRIBUTED_LABEL && !userMap[resolvedAuthor]) {
        unknownAuthorIds.add(resolvedAuthor);
      }
      allWorklogs.push(wl);

      if (issueId !== "none") {
        issueIds.add(issueId);
      }
    }
  }

  if (mismatchCount > 0) {
    Logger.log(
      `⚠️ [fetchAllWorklogs_] ${mismatchCount} worklog(s) had an author different from the ` +
        `queried account — see AUTHOR MISMATCH lines above; each was credited to its real author.`,
    );
  }
  if (noAuthorCount > 0) {
    Logger.log(
      `⚠️ [fetchAllWorklogs_] ${noAuthorCount} worklog(s) carried NO author field in any known ` +
        `shape — see NO AUTHOR FIELD lines above. If this count is high, run ` +
        `_diagFetchUserWorklogs_ to inspect the raw Tempo response shape.`,
    );
  }
  if (unattributedCount > 0) {
    Logger.log(
      `⛔ [fetchAllWorklogs_] ${unattributedCount} worklog(s) had no identifiable human author ` +
        `(missing field or Tempo app account) and were bucketed under "${UNATTRIBUTED_LABEL}" ` +
        `rather than credited to the queried account.`,
    );
  }

  return {
    allWorklogs,
    issueIds: Array.from(issueIds),
    skippedCount,
    unknownAuthorIds: Array.from(unknownAuthorIds),
  };
}

/**
 * Fetches worklogs for ALL users in parallel via UrlFetchApp.fetchAll —
 * the sequential per-user loop was the tracked export's main cost (~228
 * round-trips ≈ 6+ minutes; batched it's a handful of parallel rounds).
 *
 * Queue mechanics: every (user, offset) page is one request. A page that
 * fills up (results ≥ TEMPO_PAGE_LIMIT) enqueues the user's next offset;
 * a transient failure (5xx/429) re-enqueues the same page up to 2 retries
 * with a pause. Final failures are logged per user — that user's remaining
 * pages are lost, same contract as fetchUserWorklogs_.
 *
 * @param {string} token - Tempo Bearer token.
 * @param {string[]} workerIds - raw account IDs.
 * @returns {Object} rawId → worklog objects (possibly empty array).
 */
function fetchWorklogsBatched_(token, workerIds) {
  const byUser = {};
  workerIds.forEach((id) => { byUser[id] = []; });

  const BATCH = 40;
  const mkReq = (userId, offset) => ({
    url:
      `https://api.tempo.io/4/worklogs/user/${userId}` +
      `?from=${CONFIGLogged.FROM_DATE}&to=${CONFIGLogged.TO_DATE}` +
      `&offset=${offset}&limit=${CONFIGLogged.TEMPO_PAGE_LIMIT}`,
    method: "get",
    headers: { Authorization: `Bearer ${token}` },
    muteHttpExceptions: true,
  });

  let queue = workerIds.map((id) => ({ userId: id, offset: 0, attempts: 0 }));
  const gaveUp = [];

  while (queue.length > 0) {
    const next = [];
    for (let b = 0; b < queue.length; b += BATCH) {
      const slice = queue.slice(b, b + BATCH);
      const responses = UrlFetchApp.fetchAll(
        slice.map((q) => mkReq(q.userId, q.offset)),
      );
      responses.forEach((res, i) => {
        const q = slice[i];
        const code = res.getResponseCode();
        if (code !== 200) {
          if ((code >= 500 || code === 429 || code === 401) && q.attempts < 2) {
            next.push({ userId: q.userId, offset: q.offset, attempts: q.attempts + 1, isRetry: true });
          } else {
            gaveUp.push(`${q.userId} (HTTP ${code} @offset ${q.offset})`);
          }
          return;
        }
        const results = JSON.parse(res.getContentText()).results || [];
        byUser[q.userId].push(...results);
        if (results.length >= CONFIGLogged.TEMPO_PAGE_LIMIT) {
          next.push({ userId: q.userId, offset: q.offset + CONFIGLogged.TEMPO_PAGE_LIMIT, attempts: 0 });
        }
      });
    }
    if (next.some((q) => q.isRetry)) {
      Logger.log(`ℹ️ [fetchWorklogsBatched_] retrying ${next.filter((q) => q.isRetry).length} failed page(s)…`);
      Utilities.sleep(1500);
    }
    queue = next;
  }

  if (gaveUp.length > 0) {
    Logger.log(
      `⚠️ [fetchWorklogsBatched_] gave up on ${gaveUp.length} page(s) after retries — ` +
        `those users' hours are incomplete: ${gaveUp.join("; ")}`,
    );
  }
  return byUser;
}

/**
 * Fetches all Tempo worklogs for a single user, handling pagination automatically.
 * Kept for the _diag helpers; the main run uses fetchWorklogsBatched_.
 * @param {string} token - Tempo Bearer token.
 * @param {string} userId - Jira account ID.
 * @returns {Array} All worklog objects from Tempo for this user.
 */
function fetchUserWorklogs_(token, userId) {
  const allResults = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url =
      `https://api.tempo.io/4/worklogs/user/${userId}` +
      `?from=${CONFIGLogged.FROM_DATE}&to=${CONFIGLogged.TO_DATE}` +
      `&offset=${offset}&limit=${CONFIGLogged.TEMPO_PAGE_LIMIT}`;

    // Tempo throws transient 500s under load (the planned-time export lost
    // ~40 of 222 users to them on 2026-07-15) and transient 401s
    // (2026-07-23). Retry 5xx/429/401 twice with backoff before giving up —
    // a lost user here silently drops ALL their tracked hours from the sheet.
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
        `   ⚠️ Tempo Worklogs API ${code} for user ${userId} (after retries): ${response.getContentText()}`,
      );
      return allResults;
    }

    const data = JSON.parse(response.getContentText());
    const results = data.results || [];
    allResults.push(...results);

    hasMore = results.length >= CONFIGLogged.TEMPO_PAGE_LIMIT;
    offset += CONFIGLogged.TEMPO_PAGE_LIMIT;
  }

  return allResults;
}

// ── SECTION: JIRA DATA RESOLUTION ────────────────────────────

/**
 * Resolves worklog issue IDs → project + issue trace info via Jira.
 * Uses JQL batch search first, then a per-ID fallback for anything missed.
 * Each entry carries the fields needed to trace a record back to its source:
 * project name/key plus the issue's own key, summary, and type.
 *
 * PM (project lead) is NOT resolved here — issue responses never carry it;
 * the caller fills it afterwards via attachProjectLeads_. `assignee` is the
 * Jira issue assignee (who owns the ticket) — deliberately distinct from the
 * sheet's User column (who logged the time); surfacing both stops them from
 * reading as a contradiction.
 *
 * @param {string[]} issueIds
 * @param {string}   email
 * @param {string}   token
 * @returns {Object} issueId → { name, key, issueKey, summary, issueType, assignee }
 */
function resolveWorklogIssues_(issueIds, email, token) {
  const itemMap = {};
  const auth = Utilities.base64Encode(`${email}:${token}`);
  Logger.log(`ℹ️ Resolving ${issueIds.length} logged-time issues via Jira...`);

  for (let b = 0; b < issueIds.length; b += CONFIGLogged.API_BATCH_SIZE) {
    const batch = issueIds.slice(b, b + CONFIGLogged.API_BATCH_SIZE);
    const jql = `id in (${batch.join(",")})`;

    try {
      const res = UrlFetchApp.fetch(
        `${CONFIGLogged.JIRA_BASE}/rest/api/3/search/jql`,
        {
          method: "post",
          contentType: "application/json",
          headers: { Authorization: `Basic ${auth}` },
          payload: JSON.stringify({
            jql,
            fields: ["project", "summary", "issuetype", "assignee", "parent", CONFIGLogged.EPIC_LINK_FIELD],
            maxResults: CONFIGLogged.API_BATCH_SIZE,
          }),
          muteHttpExceptions: true,
        },
      );

      if (res.getResponseCode() === 200) {
        const issues = JSON.parse(res.getContentText()).issues || [];
        issues.forEach((issue) => {
          itemMap[String(issue.id)] = {
            name:      issue.fields?.project?.name    || "Unknown",
            key:       issue.fields?.project?.key     || "",
            issueKey:  issue.key                      || "",
            summary:   issue.fields?.summary          || "",
            issueType: issue.fields?.issuetype?.name || "",
            assignee:  issue.fields?.assignee?.displayName || "",
            epicKey:   epicKeyFromFields_(issue.fields),
            parentKey: issue.fields?.parent?.key      || "",
          };
        });
      } else {
        Logger.log(
          `⚠️ [resolveWorklogIssues_] Jira search failed: HTTP ${res.getResponseCode()} — ${res.getContentText()}`,
        );
      }
    } catch (e) {
      Logger.log(`⚠️ [resolveWorklogIssues_] JQL batch error: ${e.message}`);
    }

    // Per-ID fallback for anything the JQL batch didn't return
    const unresolved = batch.filter((id) => !itemMap[id]);
    if (unresolved.length > 0) {
      const fallback = unresolved.map((id) => ({
        url: `${CONFIGLogged.JIRA_BASE}/rest/api/3/issue/${id}?fields=project,summary,issuetype,assignee,parent,${CONFIGLogged.EPIC_LINK_FIELD}`,
        method: "get",
        headers: { Authorization: `Basic ${auth}` },
        muteHttpExceptions: true,
      }));

      try {
        UrlFetchApp.fetchAll(fallback).forEach((res, i) => {
          const id = unresolved[i];
          try {
            if (res.getResponseCode() === 200) {
              const issue = JSON.parse(res.getContentText());
              itemMap[id] = {
                name:      issue.fields?.project?.name    || "Unknown",
                key:       issue.fields?.project?.key     || "",
                issueKey:  issue.key                      || "",
                summary:   issue.fields?.summary          || "",
                issueType: issue.fields?.issuetype?.name || "",
                assignee:  issue.fields?.assignee?.displayName || "",
                epicKey:   epicKeyFromFields_(issue.fields),
                parentKey: issue.fields?.parent?.key      || "",
              };
            } else {
              itemMap[id] = { name: "Unknown", key: "", issueKey: "", summary: "", issueType: "", assignee: "", epicKey: "", parentKey: "" };
            }
          } catch (e2) {
            itemMap[id] = { name: "Unknown", key: "", issueKey: "", summary: "", issueType: "", assignee: "", epicKey: "", parentKey: "" };
          }
        });
      } catch (e3) {
        Logger.log(`⚠️ [resolveWorklogIssues_] Fallback error: ${e3.message}`);
      }
    }
  }

  const resolved = Object.values(itemMap).filter(
    (v) => v.name !== "Unknown",
  ).length;
  Logger.log(`ℹ️ Resolved ${resolved} of ${issueIds.length} logged-time issues`);

  return itemMap;
}

/**
 * Best-effort epic key from a Jira issue's fields: the classic Epic Link
 * custom field, or the parent key when the parent itself is an epic
 * (team-managed projects). Mirrors resolvedEpicKey_ in "Jira Backlog.js".
 * @param {Object} fields - Jira issue fields object
 * @returns {string} epic key or ""
 */
function epicKeyFromFields_(fields) {
  if (!fields) return "";
  if (fields[CONFIGLogged.EPIC_LINK_FIELD]) return fields[CONFIGLogged.EPIC_LINK_FIELD];
  const pType = String(fields.parent?.fields?.issuetype?.name || "").toLowerCase();
  if (pType.indexOf("epic") !== -1) return fields.parent?.key || "";
  return "";
}

/**
 * Second-chance resolution for issues Jira could not return (deleted issues,
 * archived projects, missing browse permission). Tempo's default worklog
 * description is exactly "Working on issue KEY-123", so the issue key is
 * usually recoverable from the worklog itself:
 *   - issueKey   = the key in that exact auto-generated phrase (anchored —
 *                  a hand-written "blocked by OTHER-99" can no longer hijack
 *                  an unrelated worklog)
 *   - projectKey = the KEY prefix — rescued ONLY when another Jira-resolved
 *                  issue already confirmed that project exists
 *   - project    = the confirmed project name
 * Every rescue is logged with a 🛟 line; refused rescues log 🛟✋.
 * Mutates issueMap in place; entries Jira resolved are never touched.
 *
 * @param {Array}  allWorklogs - Deduplicated worklogs from fetchAllWorklogs_()
 * @param {Object} issueMap    - issueId → { name, key, issueKey, summary, issueType }
 */
function enrichUnresolvedFromDescriptions_(allWorklogs, issueMap) {
  // Tempo's auto-generated description is exactly "Working on issue KEY-123".
  // Anchoring to it stops a hand-written mention of another ticket from
  // hijacking an unrelated worklog.
  const TEMPO_DEFAULT_DESC_RE = /^\s*Working on issue ([A-Z][A-Z0-9]+-\d+)\s*$/;

  // Project names learned from the issues Jira DID resolve, keyed by project key.
  const keyToName = {};
  Object.values(issueMap).forEach((info) => {
    if (info.name !== "Unknown" && info.key) keyToName[info.key] = info.name;
  });

  let rescued = 0;
  for (let i = 0; i < allWorklogs.length; i++) {
    const wl = allWorklogs[i];
    const issueId =
      wl.issue && wl.issue.id
        ? String(wl.issue.id)
        : wl.issueId
          ? String(wl.issueId)
          : null;
    if (!issueId) continue;

    const info = issueMap[issueId];
    if (info && info.name !== "Unknown") continue; // resolved (or already rescued)

    const m = TEMPO_DEFAULT_DESC_RE.exec(String(wl.description || ""));
    if (!m) continue; // another worklog on this issue may still match

    const issueKey = m[1];
    const projectKey = issueKey.split("-")[0];
    if (!keyToName[projectKey]) { // unverified project → don't guess
      Logger.log(`   🛟✋ Skipped rescue for ${issueKey} — unknown project ${projectKey}.`);
      continue;
    }
    issueMap[issueId] = {
      name:      keyToName[projectKey],
      key:       projectKey,
      issueKey:  issueKey,
      summary:   (info && info.summary) || "",
      issueType: (info && info.issueType) || "",
      assignee:  (info && info.assignee) || "",
      epicKey:   (info && info.epicKey) || "",
      parentKey: (info && info.parentKey) || "",
    };
    rescued++;
    Logger.log(
      `   🛟 Issue ${issueId} rescued from worklog description → ${issueKey} ("${issueMap[issueId].name}")`,
    );
  }

  const stillUnresolved = Object.values(issueMap).filter(
    (v) => v.name === "Unknown",
  ).length;
  Logger.log(
    `ℹ️ [enrichUnresolvedFromDescriptions_] Rescued ${rescued} issue(s) from descriptions; ` +
      `${stillUnresolved} remain unresolved.`,
  );
}

// ── SECTION: GROUPING LOGIC ───────────────────────────────────

/**
 * Buckets each worklog's hours into its Monday→Sunday week and groups totals
 * by user + project + issue, so every row traces to the exact Jira issue the
 * employee worked on. Unlike planned time, no distribution or scaling is
 * needed — every worklog carries an exact startDate, so it lands in exactly
 * one week bucket.
 *
 * ISSUE TRACE: issueRef is the Jira issue key (e.g. SRSO-123). When an issue
 * could not be resolved at all, issueRef falls back to "#<issueId>" so the
 * record stays traceable instead of collapsing into an anonymous bucket.
 *
 * ROUNDING STRATEGY (mirrors TempoPlanExport.js):
 * All accumulation is done in full floating-point precision. round2_() is
 * called ONLY at the final write step in buildLoggedSortedRows_().
 *
 * Worklogs missing a startDate or falling outside the built weeks are dropped
 * with a ⚠️ log line; the caller's integrity check surfaces the total gap.
 *
 * @param {Array}  allWorklogs
 * @param {Array}  weeks
 * @param {Object} userMap  - effectiveId → display name
 * @param {Object} issueMap - issueId → { name, key, pm, issueKey, summary, issueType, assignee, epicKey, parentKey }
 * @returns {Object} groupKey → { worker, project, projectKey, pm, assignee, issueRef, summary, epicKey, parentKey, weeklyHours[], total }
 */
function groupWorklogsByUserIssueWeek_(allWorklogs, weeks, userMap, issueMap) {
  const grouped = {};

  for (let i = 0; i < allWorklogs.length; i++) {
    const wl = allWorklogs[i];
    const userId = wl._userId;
    const worker = userMap[userId] || userId;

    const issueId =
      wl.issue && wl.issue.id
        ? String(wl.issue.id)
        : wl.issueId
          ? String(wl.issueId)
          : "unknown";

    const issueInfo = issueMap[issueId];
    const project    = issueInfo ? issueInfo.name : `Unknown issue ${issueId}`;
    const projectKey = issueInfo ? issueInfo.key  : "";
    const pm = issueInfo && issueInfo.pm ? issueInfo.pm : "";
    const assignee = issueInfo && issueInfo.assignee ? issueInfo.assignee : "";
    const issueRef =
      issueInfo && issueInfo.issueKey ? issueInfo.issueKey : `#${issueId}`;
    const summary = issueInfo && issueInfo.summary ? issueInfo.summary : "";
    const epicKey   = issueInfo && issueInfo.epicKey   ? issueInfo.epicKey   : "";
    const parentKey = issueInfo && issueInfo.parentKey ? issueInfo.parentKey : "";

    const worklogDateStr = wl.startDate;
    if (!worklogDateStr) {
      Logger.log(`⚠️ Worklog missing startDate for ${worker}`);
      continue;
    }

    const worklogDate = parseDateLocal_(worklogDateStr);
    const hours = (wl.timeSpentSeconds || 0) / 3600;
    if (hours <= 0) continue;

    let weekIndex = -1;
    for (let wi = 0; wi < weeks.length; wi++) {
      if (worklogDate >= weeks[wi].start && worklogDate <= weeks[wi].calcEnd) {
        weekIndex = wi;
        break;
      }
    }

    if (weekIndex === -1) {
      Logger.log(
        `⚠️ Worklog date outside configured weeks: ${worker} | ${worklogDateStr} | ${hours} hrs`,
      );
      continue;
    }

    const groupKey = `${worker}|||${project}|||${issueRef}`;
    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        worker,
        project,
        projectKey,
        pm,
        assignee,
        issueRef,
        summary,
        epicKey,
        parentKey,
        weeklyHours: new Array(weeks.length).fill(0),
        total: 0,
      };
    }

    grouped[groupKey].weeklyHours[weekIndex] += hours;
    grouped[groupKey].total += hours;

    // Per-worklog diagnostic — includes the issue ref so each record can be
    // traced back to the exact Jira issue the employee worked on.
    if (CONFIGLogged.DIAG_PER_WORKLOG) {
      const unresolved = !issueInfo || project.startsWith("Unknown");
      Logger.log(
        `   🧾 WORKLOG ${worker} | ${project} ${projectKey} | ${issueRef} | ` +
          `${worklogDateStr} | ${round2_(hours)} hrs` +
          (unresolved ? " ⚠️UNRESOLVED_ISSUE" : ""),
      );
    }
  }

  // Per-issue group summary — makes split rows / missing projects obvious.
  if (CONFIGLogged.DIAG_PER_WORKLOG) {
    Logger.log("   ──────── PER-ISSUE LOGGED TOTALS ────────");
    Object.values(grouped)
      .sort((a, b) =>
        (a.worker + a.project + a.issueRef).localeCompare(
          b.worker + b.project + b.issueRef,
        ),
      )
      .forEach((g) => {
        const flag = g.project.startsWith("Unknown") ? " ⚠️UNRESOLVED" : "";
        Logger.log(
          `   📊 ${g.worker} | "${g.project}" ${g.projectKey} | ${g.issueRef} = ${round2_(g.total)} hrs${flag}`,
        );
      });
  }

  return grouped;
}

// ── SECTION: ROW BUILDING ────────────────────────────────────

/**
 * Converts grouped worklog data into sorted rows for the sheet.
 * round2_() is applied HERE — once, at the final output stage —
 * never during intermediate accumulation. Long issue summaries are
 * truncated to keep the sheet readable; the full text stays in Jira.
 * @param {Object} grouped
 * @param {Array}  weeks
 * @param {Object=} teamInfoByName - display name → { team } from
 *                  buildTeamInfoByName_ (TempoPlanExport.js); authors not on
 *                  any Tempo Team get a blank cell.
 * @returns {Array[]}
 */
function buildLoggedSortedRows_(grouped, weeks, teamInfoByName) {
  const SUMMARY_MAX = 100;
  const entries = Object.values(grouped);
  entries.sort((a, b) => {
    let c = a.worker.localeCompare(b.worker);
    if (c !== 0) return c;
    c = a.project.localeCompare(b.project);
    return c !== 0 ? c : a.issueRef.localeCompare(b.issueRef);
  });

  return entries.map((entry) => {
    const roundedWeeks = entry.weeklyHours.map((h) => round2_(h));
    const roundedTotal = round2_(entry.total);
    const summary =
      entry.summary.length > SUMMARY_MAX
        ? entry.summary.slice(0, SUMMARY_MAX - 1) + "…"
        : entry.summary;
    const ti = (teamInfoByName && teamInfoByName[entry.worker]) || {};
    const row = [
      entry.worker,
      ti.team || "",
      entry.project,
      entry.projectKey,
      entry.pm || "",
      entry.assignee || "",
      entry.issueRef,
      summary,
      entry.epicKey || "",
      entry.parentKey || "",
      roundedTotal,
    ];
    roundedWeeks.forEach((h) => row.push(h));
    row.push(roundedTotal);
    return row;
  });
}

// ── SECTION: SHEET WRITING ────────────────────────────────────

/**
 * Writes all data rows, a grand-total footer, and the "Last Export:" timestamp
 * (read by the PS dashboard) to the output sheet. The footer sums the rounded
 * column values — the most transparent approach, matching what a user gets by
 * manually summing the sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array[]} rows - Already-rounded 2D row array from buildLoggedSortedRows_()
 * @param {Array}   weeks
 */
function writeLoggedRows_(sheet, rows, weeks) {
  if (rows.length === 0) {
    sheet.getRange(3, 1).setValue("⚠️ No rows to display.");
    return;
  }

  // 11 fixed columns (User, Team, Space, Key, PM, Assignee, Issue, Summary, Epic Key, Parent Key, Logged) + weeks + Total
  const FIRST_HOURS_COL = 10; // 0-based index of "Logged (hrs)"
  const totalCols = 11 + weeks.length + 1;
  sheet.getRange(3, 1, rows.length, totalCols).setValues(rows);

  const totalRow = new Array(totalCols).fill(0);
  totalRow[0] = "TOTAL";
  for (let c = 1; c < FIRST_HOURS_COL; c++) totalRow[c] = "";

  rows.forEach((row) => {
    for (let c = FIRST_HOURS_COL; c < totalCols; c++) {
      totalRow[c] += row[c] || 0;
    }
  });
  for (let c = FIRST_HOURS_COL; c < totalCols; c++) {
    totalRow[c] = round2_(totalRow[c]);
  }

  const totalRowNum = rows.length + 3;
  const totalRowRange = sheet.getRange(totalRowNum, 1, 1, totalCols);
  totalRowRange.setValues([totalRow]);
  totalRowRange.setFontWeight("bold");
  totalRowRange.setBackground(CONFIGLogged.TOTAL_ROW_BG);
  
  // Write export timestamp in the row below TOTAL
  const timestampRowNum = totalRowNum + 1;
  const timestamp = new Date().toISOString();
  sheet.getRange(timestampRowNum, 1).setValue("Last Export:");
  sheet.getRange(timestampRowNum, 2).setValue(timestamp);
  sheet.getRange(timestampRowNum, 1, 1, 2).setFontSize(9).setFontColor("#666666");
  
  sheet.autoResizeColumns(1, totalCols);
  sheet.setColumnWidth(8, 250); // cap the Summary column — autoResize makes it huge

  const uniqueUsers = new Set(rows.map((r) => r[0]));
  const grandTotal  = totalRow[totalCols - 1];
  const loggedTotal = totalRow[FIRST_HOURS_COL];

  Logger.log(`ℹ️ Unique users : ${uniqueUsers.size}`);
  Logger.log(`ℹ️ Total rows   : ${rows.length}`);
  Logger.log(`ℹ️ Grand Total  : ${grandTotal} hrs`);

  const userTotals = {};
  rows.forEach((row) => {
    const user = row[0];
    userTotals[user] = (userTotals[user] || 0) + (row[FIRST_HOURS_COL] || 0);
  });
  Object.keys(userTotals).sort().forEach((user) => {
    Logger.log(`   ${user}: ${round2_(userTotals[user])} logged hrs`);
  });

  if (Math.abs(loggedTotal - grandTotal) > 0.01) {
    Logger.log(`⚠️ Integrity: Logged col (${loggedTotal}) ≠ Total col (${grandTotal})`);
  } else {
    Logger.log(`✅ Integrity check passed`);
  }
}

// ── SECTION: TRIGGER SETUP ────────────────────────────────────

/**
 * ONE-TIME SETUP: Installs a daily trigger to auto-refresh every day at 6 AM.
 * Run once from the Apps Script editor; check Apps Script > Triggers to confirm.
 */
function createLoggedDailyTrigger() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('createLoggedDailyTrigger');
  else Logger.log('⚠️ [createLoggedDailyTrigger] requireMaintainer_ not in this project — running ungated.');
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoLoggedTime")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("fetchTempoLoggedTime")
    .timeBased()
    .everyDays(1)
    .atHour(6)
    .create();

  Logger.log(
    "⚙️ Daily trigger installed: every day at 6 AM → fetchTempoLoggedTime()",
  );
}

// ── SECTION: DIAGNOSTICS ─────────────────────────────────────

/**
 * WEEK GAP AUDIT — read-only, writes nothing. Explains a "sheet total ≠
 * Tempo total" gap for ONE week by comparing per person:
 *   Tempo side  = the GLOBAL /4/worklogs feed for the week (every author,
 *                 team member or not — the same scope the Tempo UI reports),
 *   Sheet side  = the stored week column, summed per User.
 * Each short person is tagged with the likely cause: NOT ON ANY TEMPO TEAM
 * (structural — the export never queries them), EXCLUDE_IDS (deliberate),
 * or a team member (late logging after the 6 AM run, or lost fetch pages —
 * check that run's log for "gave up on N page(s)").
 * Edit the three constants, then run from the Apps Script editor.
 */
function _diagWeekGap_() {
  const WEEK_ISO = "2026.W30";    // row-1 label of the sheet column to audit
  const WEEK_FROM = "2026-07-20"; // that week's Monday
  const WEEK_TO = "2026-07-26";   // that week's Sunday

  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

  // 1. Global Tempo feed for the week — all authors, with retry + pagination.
  const raw = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const url =
      `https://api.tempo.io/4/worklogs?from=${WEEK_FROM}&to=${WEEK_TO}` +
      `&offset=${offset}&limit=${CONFIGLogged.TEMPO_PAGE_LIMIT}`;
    let res, code;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) Utilities.sleep(1000 * attempt);
      res = UrlFetchApp.fetch(url, {
        method: "get",
        headers: { Authorization: `Bearer ${tempoToken}` },
        muteHttpExceptions: true,
      });
      code = res.getResponseCode();
      if (code === 200 || (code < 500 && code !== 429 && code !== 401)) break;
    }
    if (code !== 200) {
      throw new Error(`❌ [_diagWeekGap_] Tempo global worklogs ${code} @offset ${offset}: ${res.getContentText().slice(0, 200)}`);
    }
    const results = JSON.parse(res.getContentText()).results || [];
    raw.push(...results);
    hasMore = results.length >= CONFIGLogged.TEMPO_PAGE_LIMIT;
    offset += CONFIGLogged.TEMPO_PAGE_LIMIT;
  }
  Logger.log(`ℹ️ [_diagWeekGap_] ${raw.length} worklogs in Tempo for ${WEEK_FROM} → ${WEEK_TO}`);

  // 2. Sum hours per resolved author (same attribution shapes as the export).
  const seenIds = new Set();
  const tempoHrsById = {};
  raw.forEach((wl) => {
    const wlId = String(wl.tempoWorklogId || wl.id || "");
    if (wlId && seenIds.has(wlId)) return;
    if (wlId) seenIds.add(wlId);
    const authorFromSelf =
      wl.author && wl.author.self
        ? (String(wl.author.self).match(/accountId=([^&]+)/) || [])[1]
        : null;
    let author =
      (wl.author && wl.author.accountId ? String(wl.author.accountId) : null) ||
      (wl.authorAccountId ? String(wl.authorAccountId) : null) ||
      (authorFromSelf ? decodeURIComponent(authorFromSelf) : null);
    if (author && NON_HUMAN_AUTHOR_IDS.has(author)) author = null;
    const key = author ? MERGE_MAP[author] || author : UNATTRIBUTED_LABEL;
    tempoHrsById[key] = (tempoHrsById[key] || 0) + (wl.timeSpentSeconds || 0) / 3600;
  });

  // 3. Resolve names like the export does (Jira display name → roster name).
  const authorIds = Object.keys(tempoHrsById).filter((id) => id !== UNATTRIBUTED_LABEL);
  const nameById = fetchUserNames_(authorIds, jiraEmail, jiraToken);
  const tempoHrsByName = {};
  authorIds.forEach((id) => {
    const jiraName = nameById[id] || id;
    const name = NAME_MAPST.TEMPO[jiraName] || jiraName;
    tempoHrsByName[name] = (tempoHrsByName[name] || 0) + tempoHrsById[id];
  });
  if (tempoHrsById[UNATTRIBUTED_LABEL]) {
    tempoHrsByName[UNATTRIBUTED_LABEL] = tempoHrsById[UNATTRIBUTED_LABEL];
  }

  // 4. Tag the export's scope: team membership + explicit exclusions.
  const teamEffectiveIds = new Set(
    fetchAllTeamMembers_(tempoToken).map((id) => MERGE_MAP[id] || id),
  );
  const excludeSet = new Set(EXCLUDE_IDS);
  const scopeTagByName = {};
  authorIds.forEach((id) => {
    const jiraName = nameById[id] || id;
    const name = NAME_MAPST.TEMPO[jiraName] || jiraName;
    if (excludeSet.has(id)) scopeTagByName[name] = "EXCLUDE_IDS (deliberately skipped)";
    else if (!teamEffectiveIds.has(id)) scopeTagByName[name] = "NOT ON ANY TEMPO TEAM (export never queries them)";
  });

  // 5. Sheet side: locate the week column by its row-1 ISO label, sum per User.
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGLogged.SHEET_NAME);
  if (!sheet) throw new Error(`❌ [_diagWeekGap_] Sheet "${CONFIGLogged.SHEET_NAME}" not found.`);
  const values = sheet.getDataRange().getValues();
  const weekCol = values[0].findIndex((v) => String(v).trim() === WEEK_ISO);
  if (weekCol < 0) throw new Error(`❌ [_diagWeekGap_] No "${WEEK_ISO}" column in row 1 — check the label.`);
  const sheetHrsByName = {};
  for (let r = 2; r < values.length; r++) {
    const user = String(values[r][0] || "").trim();
    if (!user || user === "TOTAL" || user === "Last Export:") continue;
    const v = values[r][weekCol];
    if (typeof v === "number") sheetHrsByName[user] = (sheetHrsByName[user] || 0) + v;
  }

  // 6. Per-person deltas, biggest gap first.
  const names = Array.from(new Set(Object.keys(tempoHrsByName).concat(Object.keys(sheetHrsByName))));
  const rows = names
    .map((n) => ({
      name: n,
      tempo: round2_(tempoHrsByName[n] || 0),
      sheet: round2_(sheetHrsByName[n] || 0),
    }))
    .map((r) => ({ ...r, delta: round2_(r.tempo - r.sheet) }))
    .filter((r) => Math.abs(r.delta) > 0.01)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  const tempoTotal = round2_(Object.values(tempoHrsByName).reduce((s, h) => s + h, 0));
  const sheetTotal = round2_(Object.values(sheetHrsByName).reduce((s, h) => s + h, 0));
  Logger.log(`──── WEEK GAP AUDIT ${WEEK_ISO} (${WEEK_FROM} → ${WEEK_TO}) ────`);
  Logger.log(`ℹ️ Tempo total: ${tempoTotal} hrs | Sheet total: ${sheetTotal} hrs | gap: ${round2_(tempoTotal - sheetTotal)} hrs`);
  if (rows.length === 0) {
    Logger.log("✅ No per-person differences — sheet matches Tempo for this week.");
    return;
  }
  rows.forEach((r) => {
    const tag = scopeTagByName[r.name] ? ` ← ${scopeTagByName[r.name]}` : "";
    Logger.log(
      `   ${r.delta > 0 ? "🔻" : "🔺"} ${r.name}: Tempo ${r.tempo} vs sheet ${r.sheet} ` +
        `(Δ ${r.delta > 0 ? "+" : ""}${r.delta} hrs)${tag}`,
    );
  });
  Logger.log(
    "ℹ️ Untagged team members short on the sheet = hours logged AFTER that morning's 6 AM run " +
      "(self-heals on the next run) or fetch pages lost that run (check its log for \"gave up on N page(s)\").",
  );
}

function _diagConfig_() {
  Logger.log(`SCRIPT_LABEL    : ${CONFIGLogged.SCRIPT_LABEL}`);
  Logger.log(`SHEET_NAME      : ${CONFIGLogged.SHEET_NAME}`);
  Logger.log(`FROM_DATE       : ${CONFIGLogged.FROM_DATE}`);
  Logger.log(`TO_DATE         : ${CONFIGLogged.TO_DATE}`);
  Logger.log(`API_BATCH_SIZE  : ${CONFIGLogged.API_BATCH_SIZE}`);
  Logger.log(`TEMPO_PAGE_LIMIT: ${CONFIGLogged.TEMPO_PAGE_LIMIT}`);
}

function _diagPrepareLoggedSheet_() {
  const fakeWeeks = [
    { isoLabel: "2026.W14", label: "Mar 30 - Apr 05 2026",
      start: new Date("2026-03-30T00:00:00"), calcEnd: new Date("2026-04-05T00:00:00") },
    { isoLabel: "2026.W15", label: "Apr 06 - Apr 12 2026",
      start: new Date("2026-04-06T00:00:00"), calcEnd: new Date("2026-04-12T00:00:00") },
    { isoLabel: "2026.W16", label: "Apr 13 - Apr 19 2026",
      start: new Date("2026-04-13T00:00:00"), calcEnd: new Date("2026-04-19T00:00:00") },
  ];
  prepareLoggedSheet_(fakeWeeks);
  Logger.log('✅ prepareLoggedSheet_ ran — check the "Tempo Tracked Time" sheet tab.');
}

function _diagFetchUserWorklogs_() {
  const { tempoToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const sampleId = workerIds[0];
  Logger.log(`ℹ️ Sample worker ID: ${sampleId}`);
  const worklogs = fetchUserWorklogs_(tempoToken, sampleId);
  Logger.log(`✅ Got ${worklogs.length} worklogs for ${sampleId}`);
  if (worklogs.length > 0) {
    const wl = worklogs[0];
    Logger.log(`   First worklog:`);
    Logger.log(`     startDate        : ${wl.startDate}`);
    Logger.log(`     timeSpentSeconds : ${wl.timeSpentSeconds}`);
    Logger.log(`     issue.id         : ${wl.issue ? wl.issue.id : "n/a"}`);
    Logger.log(`     issueId (alt)    : ${wl.issueId || "n/a"}`);
    Logger.log(`     tempoWorklogId   : ${wl.tempoWorklogId || wl.id || "n/a"}`);
    // Author shape inspection — confirms which field carries the author so
    // fetchAllWorklogs_'s multi-path resolver is known to cover it.
    Logger.log(`     RAW WORKLOG      : ${JSON.stringify(wl)}`);
    Logger.log(`     author field     : ${JSON.stringify(wl.author)}`);
    Logger.log(`     author.accountId : ${wl.author?.accountId || "n/a"}`);
    Logger.log(`     authorAccountId  : ${wl.authorAccountId || "n/a"}`);
    Logger.log(`     queried sampleId : ${sampleId}`);
    const mismatched = worklogs.filter((x) => {
      const a = x.author?.accountId || x.authorAccountId;
      return a && String(a) !== String(sampleId);
    });
    Logger.log(`     worklogs whose author ≠ queried id: ${mismatched.length} of ${worklogs.length}`);
  }
}

function _diagFetchAllWorklogs_() {
  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);
  const { allWorklogs, issueIds, skippedCount, unknownAuthorIds } = fetchAllWorklogs_(
    tempoToken, workerIds, userMap,
  );
  Logger.log(`✅ allWorklogs: ${allWorklogs.length}`);
  Logger.log(`   issueIds collected: ${issueIds.length}`);
  Logger.log(`   skippedCount (dupes): ${skippedCount}`);
  Logger.log(`   unknownAuthorIds (off-roster authors): ${unknownAuthorIds.length}`);
}

function _diagResolveWorklogIssues_() {
  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);
  const { issueIds } = fetchAllWorklogs_(tempoToken, workerIds, userMap);
  Logger.log(`ℹ️ Resolving ${issueIds.length} issue IDs...`);
  const issueMap = resolveWorklogIssues_(issueIds, jiraEmail, jiraToken);
  const resolved = Object.values(issueMap).filter((v) => v.name !== "Unknown").length;
  Logger.log(`✅ Resolved ${resolved} of ${issueIds.length} issues`);
  Object.entries(issueMap).slice(0, 3).forEach(([id, info]) => {
    Logger.log(`   ${id} → ${info.name} (${info.key}) / issueKey: ${info.issueKey}`);
  });
}

function _diagGroupWorklogs_() {
  const fakeWorklogs = [
    { _userId: "u1", issue: { id: 10 }, startDate: "2026-04-01",
      timeSpentSeconds: 28800, tempoWorklogId: 1, description: "" },
    { _userId: "u1", issue: { id: 10 }, startDate: "2026-04-08",
      timeSpentSeconds: 14400, tempoWorklogId: 2, description: "" },
    { _userId: "u2", issue: { id: 20 }, startDate: "2026-04-01",
      timeSpentSeconds:  3600, tempoWorklogId: 3, description: "" },
  ];
  const fakeWeeks = [
    { isoLabel: "2026.W14", label: "Mar 30 - Apr 05 2026",
      start: parseDateLocal_("2026-03-30"), calcEnd: parseDateLocal_("2026-04-05") },
    { isoLabel: "2026.W15", label: "Apr 06 - Apr 12 2026",
      start: parseDateLocal_("2026-04-06"), calcEnd: parseDateLocal_("2026-04-12") },
  ];
  const fakeUserMap  = { u1: "Alice", u2: "Bob" };
  const fakeIssueMap = {
    "10": { name: "Proj A", key: "PA", issueKey: "PA-1", summary: "Task one", issueType: "Task" },
    "20": { name: "Proj B", key: "PB", issueKey: "PB-9", summary: "Task nine", issueType: "Task" },
  };

  const grouped = groupWorklogsByUserIssueWeek_(
    fakeWorklogs, fakeWeeks, fakeUserMap, fakeIssueMap,
  );

  const alice = grouped["Alice|||Proj A|||PA-1"];
  Logger.log(`Alice|Proj A|PA-1 week[0]: ${alice.weeklyHours[0]} (expect 8)`);
  Logger.log(`Alice|Proj A|PA-1 week[1]: ${alice.weeklyHours[1]} (expect 4)`);
  Logger.log(`Alice|Proj A|PA-1 total  : ${alice.total}           (expect 12)`);
  const bob = grouped["Bob|||Proj B|||PB-9"];
  Logger.log(`Bob|Proj B|PB-9   week[0]: ${bob.weeklyHours[0]}   (expect 1)`);
  Logger.log(`Bob|Proj B|PB-9   total  : ${bob.total}             (expect 1)`);
}

function _diagBuildAndWriteRows_() {
  const fakeWeeks = [
    { isoLabel: "2026.W14", label: "Mar 30 - Apr 05 2026",
      start: parseDateLocal_("2026-03-30"), calcEnd: parseDateLocal_("2026-04-05") },
    { isoLabel: "2026.W15", label: "Apr 06 - Apr 12 2026",
      start: parseDateLocal_("2026-04-06"), calcEnd: parseDateLocal_("2026-04-12") },
  ];
  const fakeGrouped = {
    "Alice|||Proj A|||PA-1": { worker: "Alice", project: "Proj A", projectKey: "PA",
                               issueRef: "PA-1", summary: "Task one",
                               weeklyHours: [8, 4], total: 12 },
    "Bob|||Proj B|||PB-9":   { worker: "Bob",   project: "Proj B", projectKey: "PB",
                               issueRef: "PB-9", summary: "Task nine",
                               weeklyHours: [1, 0], total: 1 },
    "Alice|||Proj B|||PB-2": { worker: "Alice", project: "Proj B", projectKey: "PB",
                               issueRef: "PB-2", summary: "Task two",
                               weeklyHours: [2, 0], total: 2 },
  };

  const rows = buildLoggedSortedRows_(fakeGrouped, fakeWeeks);

  Logger.log(`Row 0: ${rows[0][0]} / ${rows[0][1]} (expect Alice / Proj A)`);
  Logger.log(`Row 1: ${rows[1][0]} / ${rows[1][1]} (expect Alice / Proj B)`);
  Logger.log(`Row 2: ${rows[2][0]} / ${rows[2][1]} (expect Bob / Proj B)`);
  Logger.log(`Row 0 cols: [${rows[0].join(", ")}] (expect Alice,Proj A,PA,,,PA-1,Task one,,,12,8,4,12 — blank PM/Assignee/Epic Key/Parent Key cols)`);

  const sheet = prepareLoggedSheet_(fakeWeeks);
  writeLoggedRows_(sheet, rows, fakeWeeks);
  Logger.log("✅ writeLoggedRows_ ran — check the Tempo Tracked Time sheet.");
}
