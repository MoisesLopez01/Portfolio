// ============================================================
// TempoTrackedTime.js
// Exports Tempo logged (actual) time for all Rocketeers.
//
// SHARED GLOBALS (from TempoPlanExport.js — do not redeclare):
//   MERGE_MAP, EXCLUDE_IDS, getCredentials_(), fetchAllTeamMembers_(),
//   fetchUserNames_(), buildWeekRanges_(), fmtDate_(), parseDateLocal_(),
//   isoWeekLabel_(), formatWeekLabel_(), maxDate_(), minDate_(), round2_()
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

// ── SECTION: MAIN ENTRY POINT ────────────────────────────────

function fetchTempoLoggedTime() {
  try {
    Logger.log(`🕐 [fetchTempoLoggedTime] Started at ${new Date().toISOString()}`);

    const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

    const fromDate = parseDateLocal_(CONFIGLogged.FROM_DATE);
    const toDate   = parseDateLocal_(CONFIGLogged.TO_DATE);
    Logger.log(`ℹ️ Logged time date range: ${CONFIGLogged.FROM_DATE} → ${CONFIGLogged.TO_DATE}`);

    const weeks = buildWeekRanges_(fromDate, toDate);
    Logger.log(`ℹ️ Built ${weeks.length} week columns`);

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

    const grouped = groupWorklogsByUserProjectWeek_(
      allWorklogs, weeks, userMap, issueMap,
    );

    const sortedRows = buildLoggedSortedRows_(grouped, weeks);
    writeLoggedRows_(sheet, sortedRows, weeks);

    Logger.log(`✅ [fetchTempoLoggedTime] Done. ${sortedRows.length} rows written.`);
  } catch (e) {
    Logger.log(`❌ [fetchTempoLoggedTime] ${e.message}`);
    throw e;
  }
}

// ── SECTION: SHEET SETUP ─────────────────────────────────────

function prepareLoggedSheet_(weeks) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGLogged.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGLogged.SHEET_NAME);
  sheet.clear();

  const isoRow = ["", "", "", ""];
  weeks.forEach((w) => isoRow.push(w.isoLabel));
  isoRow.push("");

  const dateRow = ["User", "Space", "Key", "Logged (hrs)"];
  weeks.forEach((w) => dateRow.push(w.label));
  dateRow.push("Total (hrs)");

  const totalCols = dateRow.length;
  const headerRange = sheet.getRange(1, 1, 2, totalCols);
  headerRange.setValues([isoRow, dateRow]);
  headerRange.setFontWeight("bold");
  headerRange.setBackground(CONFIGLogged.HEADER_BG);
  headerRange.setFontColor(CONFIGLogged.HEADER_FONT);
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(4);

  return sheet;
}

// ── SECTION: TEMPO DATA FETCHING ─────────────────────────────

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

  return itemMap;
}

// ── SECTION: GROUPING LOGIC ───────────────────────────────────

function groupWorklogsByUserProjectWeek_(allWorklogs, weeks, userMap, issueMap) {
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

    const groupKey = `${worker}|||${project}`;
    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        worker,
        project,
        projectKey,
        weeklyHours: new Array(weeks.length).fill(0),
        total: 0,
      };
    }

    grouped[groupKey].weeklyHours[weekIndex] += hours;
    grouped[groupKey].total += hours;

    if (CONFIGLogged.DIAG_PER_WORKLOG) {
      Logger.log(
        `   🧾 WORKLOG ${worker} | ${project} ${projectKey} | ${worklogDateStr} | ${round2_(hours)} hrs`,
      );
    }
  }

  if (CONFIGLogged.DIAG_PER_WORKLOG) {
    Logger.log("   ──────── PER-PROJECT LOGGED TOTALS ────────");
    Object.values(grouped)
      .sort((a, b) => (a.worker + a.project).localeCompare(b.worker + b.project))
      .forEach((g) => {
        Logger.log(
          `   📊 ${g.worker} | "${g.project}" ${g.projectKey} = ${round2_(g.total)} hrs`,
        );
      });
  }

  return grouped;
}

// ── SECTION: ROW BUILDING ────────────────────────────────────

function buildLoggedSortedRows_(grouped, weeks) {
  const entries = Object.values(grouped);
  entries.sort((a, b) => {
    const c = a.worker.localeCompare(b.worker);
    return c !== 0 ? c : a.project.localeCompare(b.project);
  });

  return entries.map((entry) => {
    const roundedWeeks = entry.weeklyHours.map((h) => round2_(h));
    const roundedTotal = round2_(entry.total);
    const row = [entry.worker, entry.project, entry.projectKey, roundedTotal];
    roundedWeeks.forEach((h) => row.push(h));
    row.push(roundedTotal);
    return row;
  });
}

// ── SECTION: SHEET WRITING ────────────────────────────────────

function writeLoggedRows_(sheet, rows, weeks) {
  if (rows.length === 0) {
    sheet.getRange(3, 1).setValue("⚠️ No rows to display.");
    return;
  }

  const totalCols = 4 + weeks.length + 1;
  sheet.getRange(3, 1, rows.length, totalCols).setValues(rows);

  const totalRow = new Array(totalCols).fill(0);
  totalRow[0] = "TOTAL";
  totalRow[1] = "";
  totalRow[2] = "";

  rows.forEach((row) => {
    for (let c = 3; c < totalCols; c++) {
      totalRow[c] += row[c] || 0;
    }
  });
  for (let c = 3; c < totalCols; c++) {
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

  const uniqueUsers = new Set(rows.map((r) => r[0]));
  const grandTotal  = totalRow[totalCols - 1];
  const loggedTotal = totalRow[3];

  Logger.log(`ℹ️ Unique users : ${uniqueUsers.size}`);
  Logger.log(`ℹ️ Total rows   : ${rows.length}`);
  Logger.log(`ℹ️ Grand Total  : ${grandTotal} hrs`);

  const userTotals = {};
  rows.forEach((row) => {
    const user = row[0];
    userTotals[user] = (userTotals[user] || 0) + (row[3] || 0);
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
  const fakeIssueMap = { "10": { name: "Proj A", key: "PA" },
                         "20": { name: "Proj B", key: "PB" } };

  const grouped = groupWorklogsByUserProjectWeek_(
    fakeWorklogs, fakeWeeks, fakeUserMap, fakeIssueMap,
  );

  const alice = grouped["Alice|||Proj A"];
  Logger.log(`Alice|Proj A week[0]: ${alice.weeklyHours[0]} (expect 8)`);
  Logger.log(`Alice|Proj A week[1]: ${alice.weeklyHours[1]} (expect 4)`);
  Logger.log(`Alice|Proj A total  : ${alice.total}           (expect 12)`);
  const bob = grouped["Bob|||Proj B"];
  Logger.log(`Bob|Proj B   week[0]: ${bob.weeklyHours[0]}   (expect 1)`);
  Logger.log(`Bob|Proj B   total  : ${bob.total}             (expect 1)`);
}

function _diagBuildAndWriteRows_() {
  const fakeWeeks = [
    { isoLabel: "2026.W14", label: "Mar 30 - Apr 05 2026",
      start: parseDateLocal_("2026-03-30"), calcEnd: parseDateLocal_("2026-04-05") },
    { isoLabel: "2026.W15", label: "Apr 06 - Apr 12 2026",
      start: parseDateLocal_("2026-04-06"), calcEnd: parseDateLocal_("2026-04-12") },
  ];
  const fakeGrouped = {
    "Alice|||Proj A": { worker: "Alice", project: "Proj A", projectKey: "PA",
                        weeklyHours: [8, 4], total: 12 },
    "Bob|||Proj B":   { worker: "Bob",   project: "Proj B", projectKey: "PB",
                        weeklyHours: [1, 0], total: 1 },
    "Alice|||Proj B": { worker: "Alice", project: "Proj B", projectKey: "PB",
                        weeklyHours: [2, 0], total: 2 },
  };

  const rows = buildLoggedSortedRows_(fakeGrouped, fakeWeeks);

  Logger.log(`Row 0: ${rows[0][0]} / ${rows[0][1]} (expect Alice / Proj A)`);
  Logger.log(`Row 1: ${rows[1][0]} / ${rows[1][1]} (expect Alice / Proj B)`);
  Logger.log(`Row 2: ${rows[2][0]} / ${rows[2][1]} (expect Bob / Proj B)`);
  Logger.log(`Row 0 cols: [${rows[0].join(", ")}] (expect Alice,Proj A,PA,12,8,4,12)`);

  const sheet = prepareLoggedSheet_(fakeWeeks);
  writeLoggedRows_(sheet, rows, fakeWeeks);
  Logger.log("✅ writeLoggedRows_ ran — check the Tempo Tracked Time sheet.");
}
