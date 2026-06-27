// ============================================================
// PAGE: Tempo Backlog WoW Summary
// PURPOSE:
//   - Read row-based tempo logs from "Tempo Logged Time"
//   - Join to "Backlog" using User=Assignee and Key=Issue key
//   - Build 3-week WoW summary (fixed window requested)
//   - Output team summary + employee summary + daily detail
// ============================================================

const TBW_CONFIG = {
  SCRIPT_LABEL: "Tempo + Backlog WoW Summary",

  TEMPO_LOGGED_SHEET: "Tempo Logged Time",
  BACKLOG_SHEET: "Backlog",
  OUTPUT_SHEET: "📌 Tempo Backlog WoW", // Create or clear existing

  // Rolling 3-week window (delegates to Hours Analysis getThreeWeekWindow_ when available).
  USE_ROLLING_WINDOW: true,

  // Optional manual aliases if names differ between Tempo and Backlog.
  // Example: { "john smith (contractor)": "john smith" }
  NAME_ALIASES: {},

  // Minimum delta to call meaningful increase/decrease.
  SIGNAL_DELTA_HOURS: 2,
};

function tbNorm_(v) {
  return String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function tbNormKey_(v) {
  return String(v || "").trim().toUpperCase();
}

function tbDisplay_(v) {
  return String(v || "").trim();
}

function tbApplyAlias_(nameNorm) {
  return TBW_CONFIG.NAME_ALIASES[nameNorm] || nameNorm;
}

function tbHeaderIndex_(headers, candidates) {
  const norm = headers.map(h => tbNorm_(h));
  for (const c of candidates) {
    const ix = norm.indexOf(tbNorm_(c));
    if (ix >= 0) return ix;
  }
  return -1;
}

function tbISO_(d) {
  return d.toISOString().substring(0, 10);
}

function tbISOWeekNumber_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Advance to nearest Thursday (ISO weeks start Monday, week 1 contains first Thursday).
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - jan1) / 86400000) + 1) / 7);
}

function tbWeekLabel_(monday) {
  const wn = tbISOWeekNumber_(monday);
  const sun = new Date(monday);
  sun.setDate(sun.getDate() + 6);
  const mStr = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const sStr = sun.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `Week ${wn} (${mStr}\u2013${sStr})`;
}

function tbWeekWindow_() {
  // Prefer Hours Analysis rolling window; fall back to local calculation.
  if (TBW_CONFIG.USE_ROLLING_WINDOW && typeof getThreeWeekWindow_ === "function") {
    return getThreeWeekWindow_();
  }
  // Local rolling fallback: last 3 completed Mon–Sun weeks.
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
  return [w2, w1, w0];
}

function tbWeekTag_(weekKey, w2k, w1k, w0k) {
  if (weekKey === w2k) return "W-2";
  if (weekKey === w1k) return "W-1";
  if (weekKey === w0k) return "W0";
  return "";
}

function tbSignal_(w2, w1, w0, b1, b0) {
  if (w0 <= 0.1) return "⚪ No Logging";
  const dWoW = w0 - w1;
  if (dWoW >= TBW_CONFIG.SIGNAL_DELTA_HOURS && b0 >= b1) return "🟢 Improving";
  if (dWoW <= -TBW_CONFIG.SIGNAL_DELTA_HOURS || b0 < b1) return "🔴 Needs Attention";
  return "🟡 Stable";
}

function tbParseHeaderDate_(raw) {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw;
  const s = String(raw || "").trim();
  if (!s) return null;

  // D/M/YYYY or DD/MM/YYYY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    return isNaN(d.getTime()) ? null : d;
  }

  // D-MMM-YY (Tempo style, e.g., 30-Mar-26)
  m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
  if (m) {
    const d = new Date(`${m[2]} ${parseInt(m[1], 10)}, ${2000 + parseInt(m[3], 10)}`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function tbReadTempoLoggedRows_(windowKeys) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TBW_CONFIG.TEMPO_LOGGED_SHEET);
  if (!sh) throw new Error(`Sheet "${TBW_CONFIG.TEMPO_LOGGED_SHEET}" not found.`);

  const raw = sh.getDataRange().getValues();
  if (raw.length < 2) return [];

  const headers = raw[0];
  const iUser = tbHeaderIndex_(headers, ["User", "Assignee"]);
  const iProject = tbHeaderIndex_(headers, ["SONO - Sonos Inc", "Project"]);
  const iWorklog = tbHeaderIndex_(headers, ["Worklog", "Work log", "Summary"]);
  const iKey = tbHeaderIndex_(headers, ["Key", "Issue key", "Issue Key"]);
  const iDate = tbHeaderIndex_(headers, ["Date", "Work Date", "Logged Date", "Started", "Day"]);
  const iHours = tbHeaderIndex_(headers, ["Logged", "Hours", "Time Spent", "Time", "Duration (h)"]);

  // Some Tempo exports use one column per day instead of Date/Hours columns.
  const dateCols = [];
  for (let c = 0; c < headers.length; c++) {
    const d = tbParseHeaderDate_(headers[c]);
    if (!d) continue;
    const wk = (typeof weekKey_ === "function")
      ? weekKey_(d)
      : (function(x) {
          const dd = new Date(x);
          const dow = dd.getDay();
          dd.setDate(dd.getDate() - (dow === 0 ? 6 : dow - 1));
          dd.setHours(0, 0, 0, 0);
          return dd.toISOString().substring(0, 10);
        })(d);
    if (!windowKeys.has(wk)) continue;
    dateCols.push({ col: c, date: d, weekKey: wk });
  }

  const hasRowBased = iDate >= 0 && iHours >= 0;
  const hasDateColumns = dateCols.length > 0;
  if (iUser < 0 || (!hasRowBased && !hasDateColumns)) {
    throw new Error(
      `Missing required columns in "${TBW_CONFIG.TEMPO_LOGGED_SHEET}". Required: User and either (Date + Hours/Logged) or date columns in the header.`
    );
  }

  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r];

    const userRaw = tbDisplay_(row[iUser]);
    if (!userRaw) continue;

    const project = iProject >= 0 ? tbDisplay_(row[iProject]) : "";
    const worklog = iWorklog >= 0 ? tbDisplay_(row[iWorklog]) : "";
    const keyRaw = iKey >= 0 ? tbDisplay_(row[iKey]) : "";

    // Requested rule: ignore records where Project + Worklog + Key are all empty
    if (!project && !worklog && !keyRaw) continue;

    const nameNorm = tbApplyAlias_(tbNorm_(userRaw));

    if (hasRowBased) {
      const dt = (typeof parseDate_ === "function") ? parseDate_(row[iDate]) : new Date(row[iDate]);
      if (!dt || isNaN(dt.getTime())) continue;

      const wk = (typeof weekKey_ === "function")
        ? weekKey_(dt)
        : (function(d) {
            const x = new Date(d);
            const dow = x.getDay();
            x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1));
            x.setHours(0, 0, 0, 0);
            return x.toISOString().substring(0, 10);
          })(dt);

      if (!windowKeys.has(wk)) continue;

      const hrs = parseFloat(row[iHours]) || 0;
      if (hrs <= 0) continue;

      rows.push({
        userRaw,
        userNorm: nameNorm,
        project,
        worklog,
        keyRaw,
        keyNorm: tbNormKey_(keyRaw),
        date: new Date(dt),
        dateISO: tbISO_(new Date(dt)),
        weekKey: wk,
        hours: hrs,
        sourceRow: r + 1,
      });
      continue;
    }

    // Date-column style: each date header is a day and the cell value is hours.
    for (const dc of dateCols) {
      const hrs = parseFloat(row[dc.col]) || 0;
      if (hrs <= 0) continue;
      rows.push({
        userRaw,
        userNorm: nameNorm,
        project,
        worklog,
        keyRaw,
        keyNorm: tbNormKey_(keyRaw),
        date: new Date(dc.date),
        dateISO: tbISO_(new Date(dc.date)),
        weekKey: dc.weekKey,
        hours: hrs,
        sourceRow: r + 1,
      });
    }
  }

  return rows;
}

function tbReadBacklogIndex_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TBW_CONFIG.BACKLOG_SHEET);
  if (!sh) throw new Error(`Sheet "${TBW_CONFIG.BACKLOG_SHEET}" not found.`);

  const raw = sh.getDataRange().getValues();
  if (raw.length < 2) {
    return {
      compositeSet: new Set(),
      keyToAssignees: new Map(),
      assigneeDisplay: new Map(),
      items: new Map(),
    };
  }

  const headers = raw[0];
  const iAssignee   = tbHeaderIndex_(headers, ["Assignee", "User"]);
  const iIssueKey   = tbHeaderIndex_(headers, ["Issue key", "Issue Key", "Key"]);
  const iStatus     = tbHeaderIndex_(headers, ["Status"]);
  const iPriority   = tbHeaderIndex_(headers, ["Priority"]);
  const iIssueType  = tbHeaderIndex_(headers, ["Issue Type", "Type"]);
  const iProject    = tbHeaderIndex_(headers, ["Project name", "Project key", "Project"]);
  const iSummary    = tbHeaderIndex_(headers, ["Summary"]);

  if (iAssignee < 0 || iIssueKey < 0) {
    throw new Error(`Missing required columns in "${TBW_CONFIG.BACKLOG_SHEET}". Required: Assignee, Issue key.`);
  }

  const compositeSet = new Set();
  const keyToAssignees = new Map();
  const assigneeDisplay = new Map();
  const items = new Map(); // keyNorm → { keyRaw, assignee, status, priority, type, project, summary }

  for (let r = 1; r < raw.length; r++) {
    const assigneeRaw = tbDisplay_(raw[r][iAssignee]);
    const keyRaw = tbDisplay_(raw[r][iIssueKey]);
    if (!assigneeRaw || !keyRaw) continue;

    const assigneeNorm = tbApplyAlias_(tbNorm_(assigneeRaw));
    const keyNorm = tbNormKey_(keyRaw);

    compositeSet.add(`${assigneeNorm}|${keyNorm}`);
    if (!keyToAssignees.has(keyNorm)) keyToAssignees.set(keyNorm, new Set());
    keyToAssignees.get(keyNorm).add(assigneeNorm);

    if (!assigneeDisplay.has(assigneeNorm)) assigneeDisplay.set(assigneeNorm, assigneeRaw);

    // Store richest record per issue key (first occurrence wins).
    if (!items.has(keyNorm)) {
      items.set(keyNorm, {
        keyRaw,
        assignee:  assigneeRaw,
        status:    iStatus >= 0   ? tbDisplay_(raw[r][iStatus])    : "",
        priority:  iPriority >= 0 ? tbDisplay_(raw[r][iPriority])  : "",
        type:      iIssueType >= 0? tbDisplay_(raw[r][iIssueType]) : "",
        project:   iProject >= 0  ? tbDisplay_(raw[r][iProject])   : "",
        summary:   iSummary >= 0  ? tbDisplay_(raw[r][iSummary])   : "",
      });
    }
  }

  return { compositeSet, keyToAssignees, assigneeDisplay, items };
}

function runTempoBacklogWoWSummary() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const weekWindow = tbWeekWindow_();
    const wKeys = weekWindow.map(d => d.toISOString().substring(0, 10));
    const w2k = wKeys[0], w1k = wKeys[1], w0k = wKeys[2];
    const windowKeys = new Set(wKeys);

    const tempoRows = tbReadTempoLoggedRows_(windowKeys);
    const backlog = tbReadBacklogIndex_();

    const empMap = new Map();
    const nameMismatch = new Map();
    const dailyRows = [];

    for (const t of tempoRows) {
      if (!empMap.has(t.userNorm)) {
        empMap.set(t.userNorm, {
          employee: t.userRaw,
          employeeNorm: t.userNorm,
          weeks: new Map([[w2k, 0], [w1k, 0], [w0k, 0]]),
          keysByWeek: new Map([[w2k, new Set()], [w1k, new Set()], [w0k, new Set()]]),
          backlogKeysByWeek: new Map([[w2k, new Set()], [w1k, new Set()], [w0k, new Set()]]),
          projects: new Set(),
        });
      }

      const e = empMap.get(t.userNorm);
      e.weeks.set(t.weekKey, (e.weeks.get(t.weekKey) || 0) + t.hours);
      if (t.project) e.projects.add(t.project);
      if (t.keyNorm) e.keysByWeek.get(t.weekKey).add(t.keyNorm);

      let backlogMatched = false;
      if (t.keyNorm) {
        const composite = `${t.userNorm}|${t.keyNorm}`;
        backlogMatched = backlog.compositeSet.has(composite);
        if (backlogMatched) {
          e.backlogKeysByWeek.get(t.weekKey).add(t.keyNorm);
        } else {
          const assignees = backlog.keyToAssignees.get(t.keyNorm);
          if (assignees && assignees.size > 0) {
            if (!nameMismatch.has(t.userRaw)) nameMismatch.set(t.userRaw, new Set());
            for (const a of assignees) {
              const disp = backlog.assigneeDisplay.get(a) || a;
              nameMismatch.get(t.userRaw).add(disp);
            }
          }
        }
      }

      dailyRows.push({
        employee: e.employee,
        project: t.project,
        key: t.keyRaw,
        dateISO: t.dateISO,
        weekKey: t.weekKey,
        weekTag: tbWeekTag_(t.weekKey, w2k, w1k, w0k),
        hours: t.hours,
        backlogMatched: backlogMatched ? "Yes" : "No",
      });
    }

    const empRows = [];
    let teamW2 = 0, teamW1 = 0, teamW0 = 0;
    let teamBacklogW1 = 0, teamBacklogW0 = 0;

    for (const e of empMap.values()) {
      const w2 = e.weeks.get(w2k) || 0;
      const w1 = e.weeks.get(w1k) || 0;
      const w0 = e.weeks.get(w0k) || 0;
      const b1 = e.backlogKeysByWeek.get(w1k).size;
      const b0 = e.backlogKeysByWeek.get(w0k).size;

      teamW2 += w2; teamW1 += w1; teamW0 += w0;
      teamBacklogW1 += b1; teamBacklogW0 += b0;

      empRows.push({
        employee: e.employee,
        projects: Array.from(e.projects).sort().join(", "),
        w2, w1, w0,
        wow: w0 - w1,
        total3w: w2 + w1 + w0,
        keysW2: e.keysByWeek.get(w2k).size,
        keysW1: e.keysByWeek.get(w1k).size,
        keysW0: e.keysByWeek.get(w0k).size,
        backlogW1: b1,
        backlogW0: b0,
        signal: tbSignal_(w2, w1, w0, b1, b0),
      });
    }

    empRows.sort((a, b) => b.w0 - a.w0 || a.employee.localeCompare(b.employee));
    dailyRows.sort((a, b) =>
      a.employee.localeCompare(b.employee) ||
      a.dateISO.localeCompare(b.dateISO) ||
      a.project.localeCompare(b.project) ||
      a.key.localeCompare(b.key)
    );

    // Output
    const sh = (typeof resetSheet_ === "function")
      ? resetSheet_(ss, TBW_CONFIG.OUTPUT_SHEET, 600)
      : (function() {
          const t = ss.getSheetByName(TBW_CONFIG.OUTPUT_SHEET) || ss.insertSheet(TBW_CONFIG.OUTPUT_SHEET);
          t.clearContents(); t.clearFormats();
          return t;
        })();

    const title = "Tempo Logged Time + Backlog WoW Summary";
    const windowText = (typeof formatWeekRange_ === "function")
      ? `${formatWeekRange_(weekWindow[0])} → ${formatWeekRange_(weekWindow[2])}`
      : `${w2k} → ${w0k}`;

    sh.getRange(1, 1).setValue(title).setFontSize(14).setFontWeight("bold");
    sh.getRange(2, 1).setValue(`Window: ${windowText}`).setFontSize(9).setFontStyle("italic");
    sh.getRange(3, 1).setValue("Rules: Tempo rows with Project+Worklog+Key all empty are ignored.")
      .setFontSize(8).setFontStyle("italic");

    // Section B: Employee summary
    let R = 5;
    const labels = (typeof shortWeekLabel_ === "function")
      ? weekWindow.map(shortWeekLabel_)
      : [w2k, w1k, w0k];

    if (typeof sectionDivider_ === "function") sectionDivider_(sh, R, "▌ B. Employee WoW Summary", 12);
    else sh.getRange(R, 1, 1, 12).merge().setValue("B. Employee WoW Summary").setFontWeight("bold");
    R++;

    const empHdr = [
      "Employee", "Projects",
      `${labels[0]} Hours`, `${labels[1]} Hours`, `${labels[2]} Hours`,
      "WoW Δ (W0-W1)", "3W Total",
      "Keys W-2", "Keys W-1", "Keys W0",
      "Backlog Keys W0", "Signal",
    ];
    sh.getRange(R, 1, 1, empHdr.length).setValues([empHdr]);
    if (typeof styleHeader_ === "function") styleHeader_(sh, R, empHdr.length, 40);
    R++;

    empRows.forEach((e, i) => {
      const row = [
        e.employee, e.projects,
        e.w2.toFixed(1), e.w1.toFixed(1), e.w0.toFixed(1),
        (typeof fmtDelta_ === "function" ? fmtDelta_(e.wow) : e.wow.toFixed(1)),
        e.total3w.toFixed(1),
        e.keysW2, e.keysW1, e.keysW0,
        e.backlogW0, e.signal,
      ];
      const rr = R + i;
      if (typeof ensureRows_ === "function") ensureRows_(sh, rr);
      sh.getRange(rr, 1, 1, row.length).setValues([row]).setBackground(typeof altBg_ === "function" ? altBg_(i) : "#FFFFFF");
    });
    R += empRows.length + 2;

    // ── Section E: Backlog × Logged Time Coverage ──────────────
    // Issue-centric view: for every backlog item, show hours logged per week.
    const hoursByKey = new Map(); // keyNorm → { w2k: h, w1k: h, w0k: h }
    for (const t of tempoRows) {
      if (!t.keyNorm) continue;
      if (!hoursByKey.has(t.keyNorm)) {
        hoursByKey.set(t.keyNorm, { [w2k]: 0, [w1k]: 0, [w0k]: 0 });
      }
      const bucket = hoursByKey.get(t.keyNorm);
      bucket[t.weekKey] = (bucket[t.weekKey] || 0) + t.hours;
    }

    // Build coverage rows: every backlog item + its logged hours.
    const coverageRows = [];
    for (const [keyNorm, meta] of backlog.items.entries()) {
      const hrs = hoursByKey.get(keyNorm) || { [w2k]: 0, [w1k]: 0, [w0k]: 0 };
      const h2 = hrs[w2k] || 0, h1 = hrs[w1k] || 0, h0 = hrs[w0k] || 0;
      const total = h2 + h1 + h0;
      const wow = h0 - h1;

      let coverage;
      if (total <= 0)                coverage = "⚪ No Time Logged";
      else if (h0 <= 0 && h1 > 0)   coverage = "🔴 Dropped (was active)";
      else if (h0 > 0 && h1 <= 0)   coverage = "🟢 Newly Active";
      else if (h0 > 0 && h1 > 0)    coverage = "🔵 Continued";
      else                           coverage = "🟡 Historical Only";

      coverageRows.push({
        key: meta.keyRaw,
        summary: meta.summary,
        type: meta.type,
        priority: meta.priority,
        status: meta.status,
        assignee: meta.assignee,
        project: meta.project,
        h2, h1, h0, total, wow, coverage,
      });
    }

    // Also include Tempo keys that are NOT in the backlog (unplanned work).
    for (const [keyNorm, hrs] of hoursByKey.entries()) {
      if (backlog.items.has(keyNorm)) continue; // already covered above
      const h2 = hrs[w2k] || 0, h1 = hrs[w1k] || 0, h0 = hrs[w0k] || 0;
      const total = h2 + h1 + h0;
      if (total <= 0) continue;
      coverageRows.push({
        key: keyNorm,
        summary: "",
        type: "",
        priority: "",
        status: "",
        assignee: "(not in backlog)",
        project: "",
        h2, h1, h0, total, wow: h0 - h1,
        coverage: "⚠️ Not In Backlog",
      });
    }

    // Sort: active items first (by W0 hours desc), then by key.
    coverageRows.sort((a, b) => b.h0 - a.h0 || b.total - a.total || a.key.localeCompare(b.key));

    // Coverage summary stats
    const covTotal   = coverageRows.length;
    const covLogged  = coverageRows.filter(r => r.total > 0).length;
    const covGap     = coverageRows.filter(r => r.total <= 0).length;
    const covDropped = coverageRows.filter(r => r.coverage.includes("Dropped")).length;
    const covNotBL   = coverageRows.filter(r => r.coverage.includes("Not In Backlog")).length;

    if (typeof sectionDivider_ === "function") sectionDivider_(sh, R, "▌ E. Backlog × Logged Time Coverage", 13);
    else sh.getRange(R, 1, 1, 13).merge().setValue("E. Backlog × Logged Time Coverage").setFontWeight("bold");
    R++;

    // Mini summary row
    const covSummaryText = `${covTotal} backlog items | ${covLogged} with logged time | ${covGap} gaps | ${covDropped} dropped | ${covNotBL} not in backlog`;
    sh.getRange(R, 1, 1, 13).merge().setValue(covSummaryText).setFontSize(8).setFontStyle("italic");
    R++;

    const eHdr = [
      "Issue Key", "Summary", "Type", "Priority", "Status",
      "Assignee", "Project",
      `${labels[0]} Hrs`, `${labels[1]} Hrs`, `${labels[2]} Hrs`,
      "WoW Δ", "3W Total", "Coverage",
    ];
    sh.getRange(R, 1, 1, eHdr.length).setValues([eHdr]);
    if (typeof styleHeader_ === "function") styleHeader_(sh, R, eHdr.length, 40);
    R++;

    coverageRows.forEach((c, i) => {
      const row = [
        c.key, c.summary, c.type, c.priority, c.status,
        c.assignee, c.project,
        c.h2 > 0 ? c.h2.toFixed(1) : "—",
        c.h1 > 0 ? c.h1.toFixed(1) : "—",
        c.h0 > 0 ? c.h0.toFixed(1) : "—",
        (typeof fmtDelta_ === "function" ? fmtDelta_(c.wow) : (c.wow >= 0 ? "+" : "") + c.wow.toFixed(1)),
        c.total > 0 ? c.total.toFixed(1) : "—",
        c.coverage,
      ];
      const rr = R + i;
      if (typeof ensureRows_ === "function") ensureRows_(sh, rr);
      sh.getRange(rr, 1, 1, row.length).setValues([row]).setBackground(typeof altBg_ === "function" ? altBg_(i) : "#FFFFFF");
    });
    R += coverageRows.length + 2;

    // Basic sizing (expanded for 13 columns)
    [110, 220, 80, 80, 100, 150, 120, 75, 75, 75, 75, 75, 160].forEach((w, i) => {
      sh.setColumnWidth(i + 1, w);
    });
    sh.setFrozenRows(0);

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `✅ Tempo+Backlog WoW complete\nEmployees: ${empRows.length}\nTempo rows: ${tempoRows.length}\nBacklog coverage: ${covLogged}/${covTotal}`,
      TBW_CONFIG.SCRIPT_LABEL,
      8
    );
  } catch (e) {
    Logger.log(`❌ Tempo+Backlog WoW error: ${e.message}\n${e.stack}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(`❌ ${e.message}`, TBW_CONFIG.SCRIPT_LABEL, 10);
    throw e;
  }
}