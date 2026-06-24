# TempoTrackedTime.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `TempoTrackedTime.js` — a GAS script that exports Tempo logged (actual) time for all Rocketeers into a `"Logged Time Tempo"` sheet tab, mirroring the structure of `TempoPlanExport.js` but using the worklogs API instead of the plans API.

**Architecture:** A thin new file (~280 lines) that declares one config constant (`CONFIGLogged`) and nine functions. All infrastructure — `MERGE_MAP`, `EXCLUDE_IDS`, `getCredentials_()`, `fetchAllTeamMembers_()`, `fetchUserNames_()`, `buildWeekRanges_()`, and all date/math helpers — is inherited from `TempoPlanExport.js` via GAS shared scope. Zero changes to `TempoPlanExport.js`.

**Tech Stack:** Google Apps Script (V8), Tempo API v4 (`/worklogs/user/{id}`), Jira REST API v3 (JQL search + per-issue fallback), Google Sheets via `SpreadsheetApp`.

---

## File structure

| File | Action | Responsibility |
|---|---|---|
| `D:\Contribution\TempoTrackedTime.js` | **Create** | `CONFIGLogged` + 9 logged-time functions |
| `D:\Contribution\TempoPlanExport.js` | **No changes** | Provides shared globals and helpers |

---

> **GAS testing note:** GAS has no unit test runner. Each task follows an adapted TDD cycle:
> write a `_diag*_()` diagnostic function → paste into Apps Script editor → run it and confirm expected log output → implement the real function → run diag again to verify. Diagnostics live at the bottom of `TempoTrackedTime.js` and are safe to delete after the project ships.

---

### Task 1: Scaffold the file — `CONFIGLogged` + config smoke test

**Files:**
- Create: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Create `TempoTrackedTime.js` with `CONFIGLogged` and a config diagnostic**

Create the file with this exact content:

```js
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
  SHEET_NAME:       "Logged Time Tempo",
  JIRA_BASE:        "https://servicerocket-coe.atlassian.net",
  FROM_DATE:        "2026-03-30",         // FY26 Q4 start — must stay a Monday
  TO_DATE:          fmtDate_(new Date()), // dynamic: today at runtime
  DIAG_PER_WORKLOG: true,
  API_BATCH_SIZE:   50,
  TEMPO_PAGE_LIMIT: 500,
  HEADER_BG:        "#4472C4",
  HEADER_FONT:      "#FFFFFF",
  TOTAL_ROW_BG:     "#D6E4F0",
};

// ── SECTION: DIAGNOSTICS ──────────────────────────────────────

function _diagConfig_() {
  Logger.log(`SCRIPT_LABEL : ${CONFIGLogged.SCRIPT_LABEL}`);
  Logger.log(`SHEET_NAME   : ${CONFIGLogged.SHEET_NAME}`);
  Logger.log(`FROM_DATE    : ${CONFIGLogged.FROM_DATE}`);
  Logger.log(`TO_DATE      : ${CONFIGLogged.TO_DATE}`);
  Logger.log(`API_BATCH_SIZE  : ${CONFIGLogged.API_BATCH_SIZE}`);
  Logger.log(`TEMPO_PAGE_LIMIT: ${CONFIGLogged.TEMPO_PAGE_LIMIT}`);
}
```

- [ ] **Step 2: Paste into Apps Script editor and run `_diagConfig_`**

In the GAS editor (Extensions → Apps Script), paste the file contents. Select `_diagConfig_` from the function dropdown and click Run.

Expected log output (TO_DATE will show today's date — e.g., `2026-06-24`):
```
SCRIPT_LABEL : Tempo Logged Time Reports
SHEET_NAME   : Logged Time Tempo
FROM_DATE    : 2026-03-30
TO_DATE      : 2026-06-24
API_BATCH_SIZE  : 50
TEMPO_PAGE_LIMIT: 500
```

If `TO_DATE` is blank or errors, `fmtDate_` from `TempoPlanExport.js` is not yet in scope — confirm both files are in the same GAS project.

- [ ] **Step 3: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): scaffold CONFIGLogged with dynamic TO_DATE"
```

---

### Task 2: Sheet setup — `prepareLoggedSheet_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add the sheet-setup diagnostic to `TempoTrackedTime.js`** (before implementing the function)

Append inside the `DIAGNOSTICS` section:

```js
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
  Logger.log('✅ prepareLoggedSheet_ ran — check the "Logged Time Tempo" sheet tab.');
}
```

Run `_diagPrepareLoggedSheet_`. Expected: error `prepareLoggedSheet_ is not defined`.

- [ ] **Step 2: Add `prepareLoggedSheet_` before the DIAGNOSTICS section**

```js
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
```

- [ ] **Step 3: Run `_diagPrepareLoggedSheet_` again**

Expected:
- Log: `✅ prepareLoggedSheet_ ran — check the "Logged Time Tempo" sheet tab.`
- In the spreadsheet: a new sheet tab `"Logged Time Tempo"` appears with:
  - Row 1 (blue background, white text): blank | blank | blank | blank | `2026.W14` | `2026.W15` | `2026.W16` | blank
  - Row 2 (same style): `User` | `Space` | `Key` | `Logged (hrs)` | `Mar 30 - Apr 05 2026` | `Apr 06 - Apr 12 2026` | `Apr 13 - Apr 19 2026` | `Total (hrs)`
  - Columns A–D frozen, rows 1–2 frozen

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add prepareLoggedSheet_"
```

---

### Task 3: Per-user worklog fetch — `fetchUserWorklogs_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add diagnostic for single-user worklog fetch**

Append to DIAGNOSTICS section:

```js
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
```

Run `_diagFetchUserWorklogs_`. Expected: error `fetchUserWorklogs_ is not defined`.

> Also use this run to confirm the **live worklog response shape** — the log shows whether `wl.issue.id`, `wl.startDate`, and `wl.tempoWorklogId` are present. If field names differ from expected, adjust the references in Task 4 (`fetchAllWorklogs_`) and Task 6 (`groupWorklogsByUserProjectWeek_`) before implementing them.

- [ ] **Step 2: Add `fetchUserWorklogs_`**

```js
// ── SECTION: TEMPO DATA FETCHING ─────────────────────────────

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
```

- [ ] **Step 3: Run `_diagFetchUserWorklogs_` and verify**

Expected log (counts will vary):
```
ℹ️ Sample worker ID: 712020:xxxxxxxx-...
✅ Got 47 worklogs for 712020:xxxxxxxx-...
   First worklog:
     startDate        : 2026-04-01
     timeSpentSeconds : 28800
     issue.id         : 100234
     issueId (alt)    : n/a
     tempoWorklogId   : 99001
```

If `issue.id` shows `n/a` but `issueId` shows a value, adjust the fingerprint and grouping logic in Tasks 4 and 6 to use `wl.issueId` as the primary lookup. If `metadata.next` appears in the response body instead of `results`, update `fetchUserWorklogs_` to follow `data.metadata.next` for pagination.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add fetchUserWorklogs_ with offset pagination"
```

---

### Task 4: All-workers worklog fetch — `fetchAllWorklogs_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add diagnostic**

Append to DIAGNOSTICS section:

```js
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
```

Run `_diagFetchAllWorklogs_`. Expected: error `fetchAllWorklogs_ is not defined`.

- [ ] **Step 2: Add `fetchAllWorklogs_`**

```js
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
```

- [ ] **Step 3: Run `_diagFetchAllWorklogs_` and verify**

Expected log (counts vary by team size):
```
ℹ️ [1/32] Alice Rocketeer (raw: 712020:aaa...)
   → 41 worklogs returned from Tempo
ℹ️ [2/32] Bob Rocketeer (raw: 712020:bbb...)
   → 38 worklogs returned from Tempo
...
✅ allWorklogs: 1243
   issueIds collected: 89
   skippedCount (dupes): 0
```

Non-zero `skippedCount` is fine — it means the same worklog appeared via two merged Tempo accounts and was correctly deduplicated.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add fetchAllWorklogs_ with dedup fingerprint"
```

---

### Task 5: Issue → project resolution — `resolveWorklogIssues_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add diagnostic**

Append to DIAGNOSTICS section:

```js
function _diagResolveWorklogIssues_() {
  const { tempoToken, jiraEmail, jiraToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);
  const { issueIds } = fetchAllWorklogs_(tempoToken, workerIds, userMap);
  Logger.log(`ℹ️ Resolving ${issueIds.length} issue IDs...`);
  const issueMap = resolveWorklogIssues_(issueIds, jiraEmail, jiraToken);
  const resolved = Object.values(issueMap).filter((v) => v.name !== "Unknown").length;
  Logger.log(`✅ Resolved ${resolved} of ${issueIds.length} issues`);
  const sample = Object.entries(issueMap).slice(0, 3);
  sample.forEach(([id, info]) => {
    Logger.log(`   ${id} → ${info.name} (${info.key}) / issueKey: ${info.issueKey}`);
  });
}
```

Run `_diagResolveWorklogIssues_`. Expected: error `resolveWorklogIssues_ is not defined`.

- [ ] **Step 2: Add `resolveWorklogIssues_`**

```js
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
            name:      issue.fields?.project?.name     || "Unknown",
            key:       issue.fields?.project?.key      || "",
            issueKey:  issue.key                       || "",
            summary:   issue.fields?.summary           || "",
            issueType: issue.fields?.issuetype?.name  || "",
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
```

- [ ] **Step 3: Run `_diagResolveWorklogIssues_` and verify**

Expected log (values vary):
```
ℹ️ Resolving 89 logged-time issues via Jira...
✅ Resolved 87 of 89 issues
   100234 → ServiceRocket COE (GTT) / issueKey: GTT-1234
   100235 → Customer Success (CS) / issueKey: CS-567
   100236 → Internal IT (IT) / issueKey: IT-89
```

Any `Unknown` entries in the resolved map are issues Jira can't find (deleted or no-access). They'll appear as `Unknown issue {id}` rows in the sheet — acceptable.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add resolveWorklogIssues_ with JQL batch + per-ID fallback"
```

---

### Task 6: Week bucketing — `groupWorklogsByUserProjectWeek_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add diagnostic with fixture data**

Append to DIAGNOSTICS section:

```js
function _diagGroupWorklogs_() {
  // Fixture: two worklogs for the same user, different weeks
  const fakeWorklogs = [
    { _userId: "u1", issue: { id: 10 }, startDate: "2026-04-01",
      timeSpentSeconds: 28800, tempoWorklogId: 1, description: "" },
    { _userId: "u1", issue: { id: 10 }, startDate: "2026-04-08",
      timeSpentSeconds: 14400, tempoWorklogId: 2, description: "" },
    { _userId: "u2", issue: { id: 20 }, startDate: "2026-04-01",
      timeSpentSeconds: 3600,  tempoWorklogId: 3, description: "" },
  ];
  const fakeWeeks = [
    { isoLabel: "2026.W14", label: "Mar 30 - Apr 05 2026",
      start: parseDateLocal_("2026-03-30"), calcEnd: parseDateLocal_("2026-04-05") },
    { isoLabel: "2026.W15", label: "Apr 06 - Apr 12 2026",
      start: parseDateLocal_("2026-04-06"), calcEnd: parseDateLocal_("2026-04-12") },
  ];
  const fakeUserMap  = { u1: "Alice",   u2: "Bob" };
  const fakeIssueMap = { "10": { name: "Proj A", key: "PA" },
                         "20": { name: "Proj B", key: "PB" } };

  const grouped = groupWorklogsByUserProjectWeek_(
    fakeWorklogs, fakeWeeks, fakeUserMap, fakeIssueMap,
  );

  // Verify Alice|Proj A week 0 = 8 hrs, week 1 = 4 hrs, total = 12 hrs
  const alice = grouped["Alice|||Proj A"];
  Logger.log(`Alice|Proj A week[0]: ${alice.weeklyHours[0]} (expect 8)`);
  Logger.log(`Alice|Proj A week[1]: ${alice.weeklyHours[1]} (expect 4)`);
  Logger.log(`Alice|Proj A total  : ${alice.total}          (expect 12)`);
  // Verify Bob|Proj B week 0 = 1 hr
  const bob = grouped["Bob|||Proj B"];
  Logger.log(`Bob|Proj B   week[0]: ${bob.weeklyHours[0]}  (expect 1)`);
  Logger.log(`Bob|Proj B   total  : ${bob.total}           (expect 1)`);
}
```

Run `_diagGroupWorklogs_`. Expected: error `groupWorklogsByUserProjectWeek_ is not defined`.

- [ ] **Step 2: Add `groupWorklogsByUserProjectWeek_`**

```js
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
```

- [ ] **Step 3: Run `_diagGroupWorklogs_` and verify**

Expected log:
```
Alice|Proj A week[0]: 8 (expect 8)
Alice|Proj A week[1]: 4 (expect 4)
Alice|Proj A total  : 12          (expect 12)
Bob|Proj B   week[0]: 1  (expect 1)
Bob|Proj B   total  : 1           (expect 1)
```

All four assertions must match. If any differ, fix the bucketing logic before continuing.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add groupWorklogsByUserProjectWeek_ with startDate bucketing"
```

---

### Task 7: Row building and writing — `buildLoggedSortedRows_` + `writeLoggedRows_`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add diagnostic**

Append to DIAGNOSTICS section:

```js
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

  // Verify sort order: Alice|Proj A, Alice|Proj B, Bob|Proj B
  Logger.log(`Row 0 user/project: ${rows[0][0]} / ${rows[0][1]} (expect Alice / Proj A)`);
  Logger.log(`Row 1 user/project: ${rows[1][0]} / ${rows[1][1]} (expect Alice / Proj B)`);
  Logger.log(`Row 2 user/project: ${rows[2][0]} / ${rows[2][1]} (expect Bob / Proj B)`);
  // Verify columns: [worker, project, projectKey, total, week0, week1, total]
  Logger.log(`Row 0 cols: [${rows[0].join(", ")}] (expect Alice,Proj A,PA,12,8,4,12)`);

  const sheet = prepareLoggedSheet_(fakeWeeks);
  writeLoggedRows_(sheet, rows, fakeWeeks);
  Logger.log("✅ writeLoggedRows_ ran — check the Logged Time Tempo sheet.");
}
```

Run `_diagBuildAndWriteRows_`. Expected: error `buildLoggedSortedRows_ is not defined`.

- [ ] **Step 2: Add `buildLoggedSortedRows_` and `writeLoggedRows_`**

```js
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
```

- [ ] **Step 3: Run `_diagBuildAndWriteRows_` and verify**

Expected log:
```
Row 0 user/project: Alice / Proj A (expect Alice / Proj A)
Row 1 user/project: Alice / Proj B (expect Alice / Proj B)
Row 2 user/project: Bob / Proj B (expect Bob / Proj B)
Row 0 cols: [Alice, Proj A, PA, 12, 8, 4, 12] (expect Alice,Proj A,PA,12,8,4,12)
ℹ️ Unique users : 2
ℹ️ Total rows   : 3
ℹ️ Grand Total  : 15 hrs
   Alice: 14 logged hrs
   Bob: 1 logged hrs
✅ Integrity check passed
✅ writeLoggedRows_ ran — check the Logged Time Tempo sheet.
```

In the sheet: 3 data rows + a bold TOTAL row at row 6. TOTAL row: `TOTAL | | | 15 | 11 | 4 | 15`.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add buildLoggedSortedRows_ and writeLoggedRows_"
```

---

### Task 8: Main entry point — `fetchTempoLoggedTime`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add `fetchTempoLoggedTime` at the top of the file, after `CONFIGLogged`**

Insert before the `// ── SECTION: SHEET SETUP` comment:

```js
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
```

- [ ] **Step 2: Run `fetchTempoLoggedTime` end-to-end**

Select `fetchTempoLoggedTime` from the function dropdown in the GAS editor and click Run.

Expected log sequence:
```
🕐 [fetchTempoLoggedTime] Started at 2026-06-24T...
ℹ️ Logged time date range: 2026-03-30 → 2026-06-24
ℹ️ Built 13 week columns
ℹ️ Discovering team members from Tempo Teams...
ℹ️ Workers discovered: 32
ℹ️ Fetching user display names from Jira...
ℹ️ Fetching Tempo worklogs for every worker...
ℹ️ [1/32] Alice Rocketeer (raw: 712020:...)
   → 41 worklogs returned from Tempo
...
ℹ️ Worklogs collected: 1243 | Duplicates skipped: 0
ℹ️ Resolving 89 logged-time issues via Jira...
...
ℹ️ Unique users : 32
ℹ️ Total rows   : 187
ℹ️ Grand Total  : 4821.5 hrs
   Alice Rocketeer: 152.5 logged hrs
   ...
✅ Integrity check passed
✅ [fetchTempoLoggedTime] Done. 187 rows written.
```

- [ ] **Step 3: Verify the sheet output**

Open the `"Logged Time Tempo"` tab in the spreadsheet:
- Row 1: ISO week labels (`2026.W14`, `2026.W15`, ...) over week columns, blank over fixed cols
- Row 2: `User | Space | Key | Logged (hrs) | [date ranges…] | Total (hrs)`
- Data rows: sorted alphabetically by User then project — no blank rows between users
- Final row: `TOTAL` in bold with light-blue background; week column values sum to the Grand Total
- Column D (`Logged (hrs)`) and the last `Total (hrs)` column contain the same value per row

If any user row shows `Unknown issue {id}` in the Space column, the issue either was deleted in Jira or the Jira API token lacks read access to that project — acceptable, no fix needed.

- [ ] **Step 4: Commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add fetchTempoLoggedTime main entry point"
```

---

### Task 9: Trigger setup — `createLoggedWeeklyTrigger`

**Files:**
- Modify: `D:\Contribution\TempoTrackedTime.js`

- [ ] **Step 1: Add `createLoggedWeeklyTrigger` at the end of the file (before DIAGNOSTICS)**

```js
// ── SECTION: TRIGGER SETUP ────────────────────────────────────

function createLoggedWeeklyTrigger() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoLoggedTime")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("fetchTempoLoggedTime")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(8)
    .create();

  Logger.log(
    "⚙️ Weekly trigger installed: every Monday at 8 AM → fetchTempoLoggedTime()",
  );
}
```

- [ ] **Step 2: Run `createLoggedWeeklyTrigger` once**

Select it from the function dropdown and click Run.

Expected log:
```
⚙️ Weekly trigger installed: every Monday at 8 AM → fetchTempoLoggedTime()
```

- [ ] **Step 3: Verify the trigger in GAS UI**

In the GAS editor, go to **Triggers** (clock icon in the left sidebar). Confirm:
- A trigger row for `fetchTempoLoggedTime` exists
- Type: Time-driven, every Monday, 8–9 AM
- No duplicate trigger for `fetchTempoLoggedTime` (the function deletes any prior one before creating)

- [ ] **Step 4: Final commit**

```bash
git add "D:\Contribution\TempoTrackedTime.js"
git commit -m "feat(TempoTrackedTime): add createLoggedWeeklyTrigger for Monday 8 AM refresh"
```

---

## Self-review checklist

- [x] **CONFIGLogged with dynamic TO_DATE** → Task 1
- [x] **prepareLoggedSheet_** — 2-row stacked header, frozen rows/cols → Task 2
- [x] **fetchUserWorklogs_** — paginated, offset-based → Task 3
- [x] **fetchAllWorklogs_** — MERGE_MAP dedup, content fingerprint → Task 4
- [x] **resolveWorklogIssues_** — JQL batch + per-ID fallback, captures issueKey/summary → Task 5
- [x] **groupWorklogsByUserProjectWeek_** — startDate bucketing, DIAG_PER_WORKLOG logging → Task 6
- [x] **buildLoggedSortedRows_** — sort by user→project, round2_ at output only → Task 7
- [x] **writeLoggedRows_** — TOTAL footer, integrity check, per-user log, no low-hours threshold → Task 7
- [x] **fetchTempoLoggedTime** — full 12-step pipeline, empty-guard → Task 8
- [x] **createLoggedWeeklyTrigger** — distinct name from TempoPlanExport's trigger → Task 9
- [x] **Zero changes to TempoPlanExport.js** — verified: no task modifies it
- [x] **API pitfalls flagged inline** — response shape check in Task 3, pagination variant in Task 3, token scope in spec
