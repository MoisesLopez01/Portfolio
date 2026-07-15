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
  FROM_DATE:        "2026-03-30",              // FY26 Q4 start — must stay a Monday
  get TO_DATE()   { return fmtDate_(new Date()); }, // always today, evaluated on every access
  DIAG_PER_WORKLOG: true,
  API_BATCH_SIZE:   50,
  TEMPO_PAGE_LIMIT: 500,
  HEADER_BG:        "#4472C4",
  HEADER_FONT:      "#FFFFFF",
  TOTAL_ROW_BG:     "#D6E4F0",
};

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
//     ⚠️ DEPENDENCY: FROM_DATE must be a Monday, or the week buckets and
//        their ISO labels will not align to calendar weeks.
//
//  2. DATE WINDOW  (CONFIGLogged.FROM_DATE → CONFIGLogged.TO_DATE)
//     Tempo is queried for worklogs in this range only. TO_DATE is always
//     today (live getter). A worklog whose startDate somehow falls outside
//     the built week buckets is DROPPED with a ⚠️ log line, and surfaces in
//     the collected-vs-grouped integrity check.
//
//  3. WORKER DISCOVERY SCOPE  (Tempo Teams)
//     Only people who are members of at least one Tempo Team are processed
//     (plus MERGE_MAP secondary IDs, see #5). Anyone not on a Tempo Team —
//     even if they have worklogs — is OMITTED ENTIRELY.
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
//     effectiveUserId | worklogId | issueId | startDate | timeSpentSeconds | description.
//     Exact repeats (e.g. the same worklog surfaced via two merged accounts)
//     are skipped and reported as "Duplicates skipped".
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

/**
 * Main function: fetches all Tempo logged (actual) time for the configured
 * date range and writes a weekly breakdown table to the output sheet.
 */
function fetchTempoLoggedTime() {
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

    const sheet = prepareLoggedSheet_(weeks);

    Logger.log("ℹ️ Discovering team members from Tempo Teams...");
    const workerIds = fetchAllTeamMembers_(tempoToken);
    Logger.log(`ℹ️ Workers discovered: ${workerIds.length}`);

    Logger.log("ℹ️ Fetching user display names from Jira...");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    Logger.log("ℹ️ Fetching Tempo worklogs for every worker...");
    const { allWorklogs, issueIds, skippedCount } = fetchAllWorklogs_(
      tempoToken, workerIds, userMap,
    );
    Logger.log(
      `ℹ️ Worklogs collected: ${allWorklogs.length} | Duplicates skipped: ${skippedCount}`,
    );

    if (allWorklogs.length === 0) {
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

    const sortedRows = buildLoggedSortedRows_(grouped, weeks);
    writeLoggedRows_(sheet, sortedRows, weeks);

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

  // 6. Duplicate dedup (rule; count reported later)
  Logger.log(
    "6. Duplicate worklogs: collapsed by fingerprint user|worklogId|issue|date|seconds|description (count logged after fetch).",
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
 * Row 2 (date header):    "User", "Space", "Key", "PM", "Issue", "Summary",
 *                         "Logged (hrs)", the week date ranges
 *                         (e.g. "Mar 30 - Apr 05 2026"), and "Total (hrs)".
 *
 * "Key" stays the PROJECT key — the PS dashboard and the demand dashboard
 * both locate it by that exact header for project context. "PM" is the Jira
 * project lead (see attachProjectLeads_), placed after "Key" to match the
 * Planned Time Tempo sheet. "Issue" carries the issue-level trace
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

  const isoRow = ["", "", "", "", "", "", ""];
  weeks.forEach((w) => isoRow.push(w.isoLabel));
  isoRow.push("");

  const dateRow = ["User", "Space", "Key", "PM", "Issue", "Summary", "Logged (hrs)"];
  weeks.forEach((w) => dateRow.push(w.label));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGLogged.HEADER_BG);
  headerRange.setFontColor(CONFIGLogged.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(7);

  return sheet;
}

// ── SECTION: TEMPO DATA FETCHING ─────────────────────────────

/**
 * Fetches Tempo worklogs for all workers and collects the issue IDs to resolve.
 *
 * DEDUP STRATEGY (mirrors fetchAllPlans_ in TempoPlanExport.js):
 * The duplicate fingerprint is content-based —
 *   effectiveUserId + worklogId + issueId + startDate + timeSpentSeconds + description
 * — so the same worklog surfaced via two merged accounts is counted once,
 * while distinct worklogs that share a date/issue are all kept.
 *
 * @param {string} tempoToken
 * @param {string[]} workerIds - Dynamic list from fetchAllTeamMembers_()
 * @param {Object} userMap - accountId → display name (for logging only)
 * @returns {{ allWorklogs: Array, issueIds: string[], skippedCount: number }}
 */
function fetchAllWorklogs_(tempoToken, workerIds, userMap) {
  const allWorklogs = [];
  const issueIds = new Set();
  let skippedCount = 0;
  const seenFingerprintsByUser = {};

  for (let w = 0; w < workerIds.length; w++) {
    const rawId = workerIds[w];
    const effectiveId = MERGE_MAP[rawId] || rawId;
    const displayName = userMap[effectiveId] || effectiveId;

    Logger.log(`ℹ️ [${w + 1}/${workerIds.length}] ${displayName} (raw: ${rawId})`);

    const userWorklogs = fetchUserWorklogs_(tempoToken, rawId);
    Logger.log(`   → ${userWorklogs.length} worklogs returned from Tempo`);

    if (!seenFingerprintsByUser[effectiveId]) {
      seenFingerprintsByUser[effectiveId] = new Set();
    }

    for (let i = 0; i < userWorklogs.length; i++) {
      const wl = userWorklogs[i];
      const issueId =
        wl.issue && wl.issue.id
          ? String(wl.issue.id)
          : wl.issueId
            ? String(wl.issueId)
            : "none";

      const fingerprint = [
        effectiveId,
        wl.tempoWorklogId || wl.id || "",
        issueId,
        wl.startDate || "",
        wl.timeSpentSeconds || 0,
        wl.description || "",
      ].join("|");

      if (seenFingerprintsByUser[effectiveId].has(fingerprint)) {
        Logger.log(`   ⚠️ Duplicate worklog skipped for ${displayName}: ${fingerprint}`);
        skippedCount++;
        continue;
      }
      seenFingerprintsByUser[effectiveId].add(fingerprint);
      wl._userId = effectiveId;
      allWorklogs.push(wl);

      if (issueId !== "none") {
        issueIds.add(issueId);
      }
    }
  }

  return {
    allWorklogs,
    issueIds: Array.from(issueIds),
    skippedCount,
  };
}

/**
 * Fetches all Tempo worklogs for a single user, handling pagination automatically.
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

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() !== 200) {
      Logger.log(
        `   ⚠️ Tempo Worklogs API ${response.getResponseCode()} for user ${userId}: ${response.getContentText()}`,
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
 * the caller fills it afterwards via attachProjectLeads_.
 *
 * @param {string[]} issueIds
 * @param {string}   email
 * @param {string}   token
 * @returns {Object} issueId → { name, key, issueKey, summary, issueType }
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
            fields: ["project", "summary", "issuetype"],
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
        url: `${CONFIGLogged.JIRA_BASE}/rest/api/3/issue/${id}?fields=project,summary,issuetype`,
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
              };
            } else {
              itemMap[id] = { name: "Unknown", key: "", issueKey: "", summary: "", issueType: "" };
            }
          } catch (e2) {
            itemMap[id] = { name: "Unknown", key: "", issueKey: "", summary: "", issueType: "" };
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
 * Second-chance resolution for issues Jira could not return (deleted issues,
 * archived projects, missing browse permission). Tempo's default worklog
 * description is "Working on issue KEY-123", so the issue key is usually
 * recoverable from the worklog itself:
 *   - issueKey   = first KEY-123 token found in any of that issue's worklogs
 *   - projectKey = the KEY prefix
 *   - project    = real project name when another resolved issue shares the
 *                  prefix, otherwise the prefix itself
 * Heuristic by design: a hand-written description mentioning a different
 * issue would mislabel the record, so every rescue is logged with a 🛟 line.
 * Mutates issueMap in place; entries Jira resolved are never touched.
 *
 * @param {Array}  allWorklogs - Deduplicated worklogs from fetchAllWorklogs_()
 * @param {Object} issueMap    - issueId → { name, key, issueKey, summary, issueType }
 */
function enrichUnresolvedFromDescriptions_(allWorklogs, issueMap) {
  const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

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

    const m = ISSUE_KEY_RE.exec(String(wl.description || ""));
    if (!m) continue; // another worklog on this issue may still match

    const issueKey = m[1];
    const projectKey = issueKey.split("-")[0];
    issueMap[issueId] = {
      name:      keyToName[projectKey] || projectKey,
      key:       projectKey,
      issueKey:  issueKey,
      summary:   (info && info.summary) || "",
      issueType: (info && info.issueType) || "",
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
 * @param {Object} issueMap - issueId → { name, key, pm, issueKey, summary, issueType }
 * @returns {Object} groupKey → { worker, project, projectKey, pm, issueRef, summary, weeklyHours[], total }
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
    const issueRef =
      issueInfo && issueInfo.issueKey ? issueInfo.issueKey : `#${issueId}`;
    const summary = issueInfo && issueInfo.summary ? issueInfo.summary : "";

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
        issueRef,
        summary,
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
 * @returns {Array[]}
 */
function buildLoggedSortedRows_(grouped, weeks) {
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
    const row = [
      entry.worker,
      entry.project,
      entry.projectKey,
      entry.pm || "",
      entry.issueRef,
      summary,
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

  // 7 fixed columns (User, Space, Key, PM, Issue, Summary, Logged) + weeks + Total
  const FIRST_HOURS_COL = 6; // 0-based index of "Logged (hrs)"
  const totalCols = 7 + weeks.length + 1;
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
  sheet.setColumnWidth(6, 250); // cap the Summary column — autoResize makes it huge

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
  }
}

function _diagFetchAllWorklogs_() {
  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);
  const { allWorklogs, issueIds, skippedCount } = fetchAllWorklogs_(
    tempoToken, workerIds, userMap,
  );
  Logger.log(`✅ allWorklogs: ${allWorklogs.length}`);
  Logger.log(`   issueIds collected: ${issueIds.length}`);
  Logger.log(`   skippedCount (dupes): ${skippedCount}`);
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
  Logger.log(`Row 0 cols: [${rows[0].join(", ")}] (expect Alice,Proj A,PA,,PA-1,Task one,12,8,4,12 — blank PM col)`);

  const sheet = prepareLoggedSheet_(fakeWeeks);
  writeLoggedRows_(sheet, rows, fakeWeeks);
  Logger.log("✅ writeLoggedRows_ ran — check the Tempo Tracked Time sheet.");
}
