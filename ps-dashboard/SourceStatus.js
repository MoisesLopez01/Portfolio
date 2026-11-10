// ============================================================
// SOURCE STATUS LEDGER
// Spec: docs/specs/2026-11-09-source-status-ledger-design.md
// One row per data source in the "Source Status" tab of the bound spreadsheet.
// Each producer stamps its own row; the dashboard and the Monday digest read it.
// The Roster, Goals, PTO and Compensation workbooks are NEVER written.
// No top-level const/let in this file: the Node tests eval it.
// ============================================================

var SOURCE_STATUS = {
  SHEET: "Source Status",
  HEADERS: ["Source", "Label", "Covers period", "Last updated", "Last checked", "Status", "Detail", "Next expected"],
  PTO_SHEET: "2023 RD",
  PTO_FIRST_ROW: 2, PTO_FIRST_COL: 1, PTO_LAST_COL: 14,      // A2:N
  GOALS_QUARTER_HEADER: "fiscal quarter",                     // matched lower-cased, trimmed
  SI_LAG_DAYS: 14,
  ROSTER_FP_PROP: "SOURCE_ROSTER_FP",
  LEDGER_SS_PROP: "SOURCE_LEDGER_SS_ID",
  TRIGGER_OWNER_PROP: "SOURCE_TRIGGER_OWNER",
  DIGEST_RECIPIENTS_PROP: "SOURCE_DIGEST_RECIPIENTS",
  DASHBOARD_URL_PROP: "SOURCE_DASHBOARD_URL",
  // staleHours: null = never stale. cadenceHours: used for "Next expected".
  // rule: true = status is computed by checkSourcesDaily / the digest, not by age.
  // trigger: handler that must exist (checked daily); installer: what to run if it is missing.
  // installHint: replaces "run <installer>" when the trigger was made by hand (no creator function).
  SOURCES: [
    { key: "tempo_tracked",  label: "Tempo Tracked",  staleHours: 26,  cadenceHours: 24,  digest: true,
      trigger: "fetchTempoLoggedTime",  installer: "createLoggedDailyTrigger",
      action: "Run fetchTempoLoggedTime from the Apps Script editor and check its log." },
    // Runs DAILY: the live trigger was added by hand on the Triggers page. createWeeklyTrigger()
    // would replace it with a Monday-only one, so it is not offered as the fix.
    { key: "tempo_plan",     label: "Tempo Plan",     staleHours: 26,  cadenceHours: 24,  digest: true,
      trigger: "fetchTempoPlannedTime", installer: null,
      installHint: "add a daily fetchTempoPlannedTime trigger on the Triggers page (not createWeeklyTrigger, which makes it weekly)",
      action: "Run fetchTempoPlannedTime from the Apps Script editor and check its log." },
    { key: "tempo_capacity", label: "Tempo Capacity", staleHours: 192, cadenceHours: 168, digest: true,
      trigger: "fetchTempoCapacity",    installer: "createCapacityWeeklyTrigger",
      action: "Run fetchTempoCapacity from the Apps Script editor and check its log." },
    { key: "goals",          label: "Goals (RD)",     staleHours: 168, cadenceHours: null, digest: true,
      trigger: "onWatchedEdit", watch: "goals", installer: "installSourceStatusTriggers",
      action: "Paste the latest goals export into the RD tab of the Goals workbook." },
    { key: "pto",            label: "PTO (2023 RD)",  staleHours: 360, cadenceHours: null, digest: false,
      trigger: "onWatchedEdit", watch: "ptoAccum", installer: "installSourceStatusTriggers",
      action: "Paste the latest PTO export into the 2023 RD tab." },
    { key: "roster",         label: "Roster",         staleHours: null, checkStaleHours: 50, cadenceHours: null, digest: false,
      trigger: "checkSourcesDaily", installer: "installSourceStatusTriggers", action: "" },
    { key: "kudos",          label: "Kudos",          staleHours: null, cadenceHours: null, digest: false,
      trigger: null, action: "Run runKudosNormalizer." },
    { key: "si",             label: "Small Improvements", rule: true, checkStaleHours: 50, digest: false, trigger: null, action: "" },
    { key: "rcr",            label: "RCR · revenue ÷ compensation (TCC)", rule: true, checkStaleHours: 50, digest: false, trigger: null, action: "" },
    { key: "digest",         label: "Monday digest",  rule: true, checkStaleHours: 192, digest: false,
      trigger: "sendSourceHealthDigest", installer: "installSourceStatusTriggers", action: "" },
  ],
};

// Source definitions with Script Property overrides applied.
// props: a plain object (PropertiesService...getProperties()).
// Override: SOURCE_STALE_HOURS_<KEY>, e.g. SOURCE_STALE_HOURS_TEMPO_CAPACITY = "200".
function sourceDefs_(props) {
  props = props || {};
  return SOURCE_STATUS.SOURCES.map(function (d) {
    var o = {};
    for (var k in d) o[k] = d[k];
    var v = props["SOURCE_STALE_HOURS_" + d.key.toUpperCase()];
    if (v != null && String(v).trim() !== "" && !isNaN(Number(v)) && Number(v) > 0) o.staleHours = Number(v);
    return o;
  });
}

function isoLabel_SS_(d) {
  return isoWeekYear_PS_(d) + ".W" + isoWeekNum_PS_(d);
}

// "2026-11-02 (2026.W45)" — empty string for anything that is not a valid Date.
function stampLabel_SS_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " (" + isoLabel_SS_(d) + ")";
}

function ageText_SS_(ms) {
  return ms < 48 * 3600000 ? Math.floor(ms / 3600000) + " h" : Math.floor(ms / 86400000) + " days";
}

function limitText_SS_(hours) {
  return hours < 48 ? hours + " h" : (hours / 24) + " days";
}

function isDate_SS_(v) {
  return v instanceof Date && !isNaN(v.getTime());
}

// Pure: one ledger row (or undefined) + its definition → evaluated status.
// Status is recomputed at read time so a source that stops updating turns stale
// with nothing running.
function evaluateSourceStatus_(def, row, now) {
  row = row || {};
  var last = isDate_SS_(row.lastUpdated) ? row.lastUpdated : null;
  var next = isDate_SS_(row.nextExpected) ? row.nextExpected : null;
  if (!next && last && def.cadenceHours) next = new Date(last.getTime() + def.cadenceHours * 3600000);

  var status, detail = row.detail ? String(row.detail) : "";
  if (row.status === "failed") {
    status = "failed";
  } else if (def.rule) {
    status = row.status || "pending";
  } else if (!last) {
    status = "pending";
    if (!detail) detail = "awaiting first update";
  } else if (def.staleHours && now.getTime() - last.getTime() > def.staleHours * 3600000) {
    status = "stale";
    detail = "No update for " + ageText_SS_(now.getTime() - last.getTime()) +
             " (limit " + limitText_SS_(def.staleHours) + ")";
  } else {
    status = "ok";
  }

  // A row whose writer (daily check / digest) stopped must show it, not stay green.
  var chk = isDate_SS_(row.lastChecked) ? row.lastChecked : null;
  if (def.checkStaleHours && chk && (status === "ok" || status === "pending") &&
      now.getTime() - chk.getTime() > def.checkStaleHours * 3600000) {
    status = "stale";
    detail = "Not checked for " + ageText_SS_(now.getTime() - chk.getTime()) + " — is " +
             (def.trigger || "checkSourcesDaily") + " running?";
  }

  return {
    key: def.key, label: def.label, digest: !!def.digest, action: def.action || "",
    coversPeriod: row.coversPeriod == null ? "" : row.coversPeriod,
    lastUpdated: last, lastChecked: isDate_SS_(row.lastChecked) ? row.lastChecked : null,
    status: status, detail: detail, nextExpected: next,
  };
}

// ── Rule helpers (pure) ─────────────────────────────────────

function addDays_SS_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

// "FY27Q1" → last calendar day of that fiscal quarter (FY starts July 1).
function quarterEndFromLabel_SS_(label) {
  var m = /^FY(\d{2})Q([1-4])$/.exec(String(label || "").trim().toUpperCase());
  if (!m) return null;
  var fy = 2000 + Number(m[1]), q = Number(m[2]);
  var endMonth = [9, 12, 3, 6][q - 1];        // 1-based calendar month the quarter ends in
  var year = q <= 2 ? fy - 1 : fy;
  return new Date(year, endMonth, 0);         // day 0 of the next month = last day
}

// Small Improvements: ratings for a closed quarter are available on quarter end + 14 days.
// That date is fixed, so the row is a pure function of today's date.
function siStatus_SS_(now) {
  var ctx = computeFiscalContext_(now);
  var closed = ctx.prevGoalsQuarter;
  var due = addDays_SS_(quarterEndFromLabel_SS_(closed), SOURCE_STATUS.SI_LAG_DAYS);
  if (now.getTime() >= due.getTime()) {
    return {
      status: "ok", coversPeriod: closed, lastUpdated: due,
      nextExpected: addDays_SS_(quarterEndFromLabel_SS_(ctx.goalsQuarter), SOURCE_STATUS.SI_LAG_DAYS),
      detail: closed + " ratings available since " + stampLabel_SS_(due),
    };
  }
  return {
    status: "pending", coversPeriod: closed,
    lastUpdated: addDays_SS_(quarterEndFromLabel_SS_(ctx.prev2GoalsQuarter), SOURCE_STATUS.SI_LAG_DAYS),
    nextExpected: due,
    detail: closed + " ratings due " + stampLabel_SS_(due),
  };
}

// Must match readRCR_PS_ exactly: "Oct 26" only.
var RCR_MONTH_RE_SS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{2})$/i;
var MONTHS_SS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var MONTH_ABBR_SS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isFilledNumber_SS_(v) {
  if (typeof v === "number") return !isNaN(v);
  var s = String(v == null ? "" : v).replace(/[,%\s]/g, "");
  return s !== "" && !isNaN(parseFloat(s)) && isFinite(Number(s));
}

// Newest month column ("Oct 26") at or before maxSortKey that holds Finance data: at least
// one filled number, not all of them 0 (an all-zero column is a formula placeholder).
// Scans every fiscal year present, like readRCR_PS_ does.
function latestRcrMonth_SS_(headers, rows, maxSortKey) {
  var cols = [];
  headers.forEach(function (h, i) {
    var m = RCR_MONTH_RE_SS.exec(String(h).trim());
    if (m) {
      var mi = MONTHS_SS.indexOf(m[1].toLowerCase()), yy = 2000 + Number(m[2]);
      cols.push({ name: String(h).trim(), col: i, year: yy, month: mi, sortKey: yy * 12 + mi });
    }
  });
  cols.sort(function (a, b) { return b.sortKey - a.sortKey; });
  for (var k = 0; k < cols.length; k++) {
    var c = cols[k];
    if (maxSortKey != null && c.sortKey > maxSortKey) continue;
    var filled = [];
    rows.forEach(function (r) {
      if (isFilledNumber_SS_(r[c.col])) filled.push(parseFloat(String(r[c.col]).replace(/[,%\s]/g, "")));
    });
    if (filled.some(function (n) { return n !== 0; })) return c;
  }
  return null;
}

// RCR covers through the month end; the last closed month is pending until Finance
// fills its column. Never stale — timing belongs to Finance.
function rcrStatus_SS_(headers, rows, now) {
  var lastClosed = new Date(now.getFullYear(), now.getMonth(), 0);
  var wantKey = lastClosed.getFullYear() * 12 + lastClosed.getMonth();
  var latest = latestRcrMonth_SS_(headers, rows, wantKey);
  var wantName = MONTH_ABBR_SS[lastClosed.getMonth()] + " " + String(lastClosed.getFullYear()).slice(-2);
  if (!latest) {
    return { status: "pending", coversPeriod: "", lastUpdated: null, nextExpected: null,
             detail: "No populated month yet; " + wantName + " is up to Finance" };
  }
  var monthEnd = new Date(latest.year, latest.month + 1, 0);
  if (latest.sortKey >= wantKey) {
    return { status: "ok", coversPeriod: latest.name, lastUpdated: monthEnd, nextExpected: null,
             detail: latest.name + " filled by Finance" };
  }
  return { status: "pending", coversPeriod: latest.name, lastUpdated: monthEnd, nextExpected: null,
           detail: wantName + " (closed " + stampLabel_SS_(lastClosed) + ") not yet filled by Finance" };
}

// edit: {row, numRows, col, numCols}; watch: {firstRow, firstCol, lastCol}.
function editTouchesRange_SS_(edit, watch) {
  var lastRow = edit.row + edit.numRows - 1, lastCol = edit.col + edit.numCols - 1;
  return lastRow >= watch.firstRow && edit.col <= watch.lastCol && lastCol >= watch.firstCol;
}

// True when any edited row belongs to the evaluated quarter (or the previous one
// during the goals grace window, matching readGoalsEngagement_).
function goalsEditQualifies_SS_(quarterValues, ctx) {
  var want = [String(ctx.goalsQuarter).toUpperCase()];
  if (ctx.inGracePeriod && ctx.prevGoalsQuarter) want.push(String(ctx.prevGoalsQuarter).toUpperCase());
  return quarterValues.some(function (v) {
    return want.indexOf(String(v == null ? "" : v).trim().toUpperCase()) !== -1;
  });
}

// "<rowCount>:<djb2 hash>" of the whole tab. Cheap, deterministic, no GAS services.
function fingerprint_SS_(values) {
  var s = JSON.stringify(values), h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return values.length + ":" + (h >>> 0).toString(16);
}

// Fields to record for Roster, or null when the Data tab did not change.
function rosterCheck_SS_(prevFp, fp, dataRows, now) {
  if (!prevFp) return { status: "pending", detail: "Baseline captured " + stampLabel_SS_(now) + "; awaiting next change" };
  if (prevFp === fp) return null;
  return { status: "ok", lastUpdated: now, detail: "Data tab changed (" + dataRows + " rows)" };
}

// A probe or trigger check either raises a "<prefix>: <problem>" failure, clears a
// failure it raised earlier, or does nothing (null). Other failures are left alone.
function flagOutcome_SS_(row, problem, prefix) {
  row = row || {};
  if (problem) return { status: "failed", detail: prefix + ": " + problem };
  if (row.status === "failed" && String(row.detail || "").indexOf(prefix + ":") === 0) {
    var has = isDate_SS_(row.lastUpdated);
    return { status: has ? "ok" : "pending", detail: has ? "" : "awaiting first update" };
  }
  return null;
}

// ids: getExternalSSIds_() → { goals, ptoAccum, ... }
function expectedTriggers_SS_(defs, ids) {
  return defs.filter(function (d) { return d.trigger; }).map(function (d) {
    return { key: d.key, handler: d.trigger, sourceId: d.watch ? ids[d.watch] : null, installer: d.installer, installHint: d.installHint || "" };
  });
}

// actual: [{handler, sourceId}] from ScriptApp.getProjectTriggers().
function missingTriggers_SS_(expected, actual) {
  return expected.filter(function (e) {
    return !actual.some(function (a) {
      return a.handler === e.handler && (!e.sourceId || a.sourceId === e.sourceId);
    });
  });
}

// ── Ledger I/O (Apps Script) ────────────────────────────────

var FIELD_HEADERS_SS = {
  key: "Source", label: "Label", coversPeriod: "Covers period", lastUpdated: "Last updated",
  lastChecked: "Last checked", status: "Status", detail: "Detail", nextExpected: "Next expected",
};

// The bound dashboard spreadsheet. Installable triggers on OTHER workbooks (Goals,
// PTO) run without an active container, so the id is saved at install time.
function ledgerSpreadsheet_SS_() {
  var id = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.LEDGER_SS_PROP);
  if (id) return SpreadsheetApp.openById(id);
  // Never fall back to an external (read-only system of record) workbook.
  var active = SpreadsheetApp.getActiveSpreadsheet();
  var ext = getExternalSSIds_();
  var isExternal = active && [ext.roster, ext.goals, ext.ptoAccum].indexOf(active.getId()) !== -1;
  if (!active || isExternal) {
    throw new Error("Source Status ledger not configured — run installSourceStatusTriggers from the dashboard spreadsheet");
  }
  return active;
}

// Writes headers plus one pending row per source, so every writer only ever
// overwrites its own existing row.
function seedLedger_SS_(sh) {
  var n = SOURCE_STATUS.SOURCES.length, w = SOURCE_STATUS.HEADERS.length;
  sh.getRange(1, 1, 1, w).setValues([SOURCE_STATUS.HEADERS]).setFontWeight("bold");
  var rows = SOURCE_STATUS.SOURCES.map(function (d) {
    var row = new Array(w).fill("");
    row[SOURCE_STATUS.HEADERS.indexOf("Source")] = d.key;
    row[SOURCE_STATUS.HEADERS.indexOf("Label")] = d.label;
    row[SOURCE_STATUS.HEADERS.indexOf("Status")] = "pending";
    row[SOURCE_STATUS.HEADERS.indexOf("Detail")] = "awaiting first update";
    return row;
  });
  // Plain text so "Oct 26" or "2026.W46" are never auto-parsed into dates.
  sh.getRange(2, SOURCE_STATUS.HEADERS.indexOf("Covers period") + 1, n, 1).setNumberFormat("@");
  sh.getRange(2, 1, n, w).setValues(rows);
  sh.setFrozenRows(1);
}

// Creates the tab, or re-seeds it when row 1 was cleared.
function ledgerSheet_SS_() {
  var ss = ledgerSpreadsheet_SS_();
  var sh = ss.getSheetByName(SOURCE_STATUS.SHEET);
  if (!sh) {
    sh = ss.insertSheet(SOURCE_STATUS.SHEET);
    seedLedger_SS_(sh);
    return sh;
  }
  var empty = sh.getLastRow() === 0 || sh.getLastColumn() === 0 ||
    sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].every(function (h) { return String(h).trim() === ""; });
  if (empty) seedLedger_SS_(sh);
  return sh;
}

// → { idx: {field: colIndex}, rows: {key: rowObject}, width }
// Throws listing the headers found when a column is missing.
function readLedgerRows_SS_(sh) {
  var values = sh.getDataRange().getValues();
  var hdr = (values[0] || []).map(function (h) { return String(h).trim(); });
  var idx = {};
  for (var f in FIELD_HEADERS_SS) {
    var i = hdr.indexOf(FIELD_HEADERS_SS[f]);
    if (i === -1) throw new Error("Source Status column missing: " + FIELD_HEADERS_SS[f] + ". Headers found: " + hdr.join(", "));
    idx[f] = i;
  }
  var rows = {};
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][idx.key] || "").trim();
    if (!key) continue;
    var o = { _row: r + 1 };
    for (var g in idx) o[g] = values[r][idx[g]];
    rows[key] = o;
  }
  return { idx: idx, rows: rows, width: hdr.length };
}

// Writes the given fields onto the source's row and stamps "Last checked".
// Never throws: a ledger problem must not break a producer.
// No script lock: the project's script lock is held for minutes by the hourly Jira
// tracker. The tab is seeded with one row per source, so each writer overwrites only
// its own row. If a key's row is missing (older tab) it is appended; a rare duplicate
// from a concurrent first write is harmless because readLedgerRows_SS_ is last-row-wins.
function recordSourceStatus_(key, fields) {
  try {
    var sh = ledgerSheet_SS_();
    var led = readLedgerRows_SS_(sh);
    var def = sourceDefs_().filter(function (d) { return d.key === key; })[0];
    var existing = led.rows[key];
    var rowNum = existing ? existing._row : sh.getLastRow() + 1;
    var current = existing ? sh.getRange(rowNum, 1, 1, led.width).getValues()[0] : new Array(led.width).fill("");
    var merged = Object.assign({ key: key, label: def ? def.label : key }, fields || {}, { lastChecked: new Date() });
    if (merged.detail != null) merged.detail = String(merged.detail).slice(0, 500);
    for (var f in merged) {
      if (led.idx[f] === undefined || merged[f] === undefined) continue;
      current[led.idx[f]] = merged[f] === null ? "" : merged[f];
    }
    // Plain text so "Oct 26" or "2026.W46" are never auto-parsed into dates.
    sh.getRange(rowNum, led.idx.coversPeriod + 1).setNumberFormat("@");
    sh.getRange(rowNum, 1, 1, led.width).setValues([current]);
    return true;
  } catch (e) {
    Logger.log("⚠️ [SourceStatus] could not record " + key + ": " + e.message);
    return false;
  }
}

// Runs a producer body and stamps its row. Success → ok + time + duration.
// Throw → failed + message, then rethrow so Apps Script's own failure notice fires.
// A body that returns {ok:false} (blocked by its own gate) is not an update.
function withSourceStatus_(key, fn) {
  var t0 = Date.now(), result;
  try {
    result = fn();
  } catch (e) {
    recordSourceStatus_(key, { status: "failed", detail: String((e && e.message) || e) });
    throw e;
  }
  if (result && result.ok === false) return result;
  var now = new Date();
  recordSourceStatus_(key, {
    status: "ok", lastUpdated: now, coversPeriod: isoLabel_SS_(now), nextExpected: "",
    detail: "Run ok in " + Math.round((Date.now() - t0) / 1000) + " s",
  });
  return result;
}

// ── Edit handler (installable on-edit, Goals + PTO workbooks) ─

// Public because installable triggers cannot call private (_) functions.
// Deliberately NOT gated with requireMaintainer_: in an edit trigger
// Session.getActiveUser() is the editing colleague, not necessarily an admin, so the
// gate would block legitimate pastes. It returns at once unless given a live Range
// (impossible over google.script.run, which carries JSON only), and its only effect is
// stamping "now" on one ledger row. Allow-listed in tests/callable-surface-checks.js.
function onWatchedEdit(e) {
  if (!e || !e.range || typeof e.range.getRow !== "function" ||
      !e.source || typeof e.source.getId !== "function") return;
  try {
    var ids = getExternalSSIds_();
    var srcId = e.source.getId();
    var sheet = e.range.getSheet();
    var sheetName = sheet.getName();
    var edit = { row: e.range.getRow(), numRows: e.range.getNumRows(),
                 col: e.range.getColumn(), numCols: e.range.getNumColumns() };
    var now = new Date();
    var lastRow = edit.row + edit.numRows - 1;

    if (srcId === ids.ptoAccum && sheetName === SOURCE_STATUS.PTO_SHEET) {
      var watch = { firstRow: SOURCE_STATUS.PTO_FIRST_ROW, firstCol: SOURCE_STATUS.PTO_FIRST_COL,
                    lastCol: SOURCE_STATUS.PTO_LAST_COL };
      if (!editTouchesRange_SS_(edit, watch)) return;
      recordSourceStatus_("pto", {
        status: "ok", lastUpdated: now, coversPeriod: SOURCE_STATUS.PTO_SHEET + "!A2:N",
        detail: "Edited rows " + Math.max(edit.row, 2) + "–" + lastRow,
      });
      return;
    }

    if (srcId === ids.goals && sheetName === CONFIG_PS.SHEET_GOALS) {
      var first = Math.max(edit.row, 2);
      if (lastRow < first) return;
      var hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
        .map(function (h) { return String(h).trim().toLowerCase(); });
      var qCol = hdr.indexOf(SOURCE_STATUS.GOALS_QUARTER_HEADER);
      if (qCol === -1) {
        recordSourceStatus_("goals", { status: "failed",
          detail: "Cannot read: RD column missing: Fiscal Quarter. Headers found: " + hdr.join(", ") });
        return;
      }
      var quarters = sheet.getRange(first, qCol + 1, lastRow - first + 1, 1).getValues()
        .map(function (r) { return r[0]; });
      var ctx = computeFiscalContext_(now);
      if (!goalsEditQualifies_SS_(quarters, ctx)) return;
      recordSourceStatus_("goals", {
        status: "ok", lastUpdated: now, coversPeriod: ctx.goalsQuarter,
        detail: "Edit touched " + (lastRow - first + 1) + " row(s) incl. " + ctx.goalsQuarter,
      });
    }
  } catch (err) {
    Logger.log("⚠️ [onWatchedEdit] " + err.message);
  }
}

// ── Reading the ledger ──────────────────────────────────────

// Evaluated rows (with Date fields) for every defined source, in config order.
// Optional `sh`: a ledger sheet the caller already resolved (saves a second open).
// A source with no row evaluates to pending.
function evaluatedRows_SS_(now, sh) {
  now = now || new Date();
  if (!sh) sh = ledgerSpreadsheet_SS_().getSheetByName(SOURCE_STATUS.SHEET);
  var rows = sh ? readLedgerRows_SS_(sh).rows : {};
  var props = PropertiesService.getScriptProperties().getProperties();
  return sourceDefs_(props).map(function (d) { return evaluateSourceStatus_(d, rows[d.key], now); });
}

// google.script.run cannot carry Date objects: labels only.
function toClientSource_SS_(r) {
  return {
    key: r.key, label: r.label, digest: r.digest, status: r.status, detail: r.detail || "",
    coversPeriod: isDate_SS_(r.coversPeriod) ? stampLabel_SS_(r.coversPeriod) : String(r.coversPeriod || ""),
    lastUpdatedLabel: stampLabel_SS_(r.lastUpdated),
    nextExpectedLabel: stampLabel_SS_(r.nextExpected),
  };
}

// For the report payload (meta.sources). Never throws; [] when there is no ledger yet.
function readSourceStatus_() {
  try {
    var sh = ledgerSpreadsheet_SS_().getSheetByName(SOURCE_STATUS.SHEET);
    if (!sh) return [];
    return evaluatedRows_SS_(new Date(), sh).map(toClientSource_SS_);
  } catch (e) {
    Logger.log("⚠️ [readSourceStatus_] " + e.message);
    return [];
  }
}

// Ledger key → key of the dashboard's live freshness view (SOURCE_FRESHNESS_ in
// PS Contribution Report.js). Roster is not mapped: its ledger stamp moves only when
// the data changes, so a quiet day would look overdue; it keeps its Drive stamp.
var LEDGER_FRESHNESS_KEYS_SS = { tempo_tracked: "tracked", tempo_plan: "planned", goals: "goals", pto: "pto", kudos: "kudos" };

// Signals for collectFreshnessSignals_, from the ledger's stored rows:
//   status "failed"      → { failedReason: detail, loadedAt?: last good update,
//                             failedAt?: "Last checked", i.e. when the failure was recorded }
//   valid "Last updated" → { loadedAt: ISO }
//   otherwise            → key omitted, so the view keeps its own signal.
// Reads the ledger at most once. Never throws; {} when there is no ledger tab.
function ledgerFreshnessSignals_() {
  try {
    var sh = ledgerSpreadsheet_SS_().getSheetByName(SOURCE_STATUS.SHEET);
    if (!sh) return {};
    var rows = readLedgerRows_SS_(sh).rows, out = {};
    for (var key in LEDGER_FRESHNESS_KEYS_SS) {
      var r = rows[key];
      if (!r) continue;
      var at = isDate_SS_(r.lastUpdated) ? r.lastUpdated.toISOString() : null;
      if (String(r.status || "").trim().toLowerCase() === "failed") {
        var sig = { failedReason: String(r.detail || "").trim() || "no detail recorded" };
        if (at) sig.loadedAt = at;
        if (isDate_SS_(r.lastChecked)) sig.failedAt = r.lastChecked.toISOString();
        out[LEDGER_FRESHNESS_KEYS_SS[key]] = sig;
      } else if (at) {
        out[LEDGER_FRESHNESS_KEYS_SS[key]] = { loadedAt: at };
      }
    }
    return out;
  } catch (e) {
    Logger.log("⚠️ [ledgerFreshnessSignals_] " + e.message);
    return {};
  }
}

// ── Daily checks ────────────────────────────────────────────

// Returns a problem string, or null when the tab (and optional header) is readable.
function probeSheet_SS_(ssId, tabName, requiredHeaderLc) {
  var sh = SpreadsheetApp.openById(ssId).getSheetByName(tabName);
  if (!sh) return 'tab "' + tabName + '" not found';
  if (!requiredHeaderLc) return null;
  var hdr = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  return hdr.indexOf(requiredHeaderLc) === -1 ? 'column "' + requiredHeaderLc + '" not found in ' + tabName : null;
}

function recordIf_SS_(key, fields) {
  if (fields) recordSourceStatus_(key, fields);
}

// Keeps the in-memory snapshot in step with what was just written, so a later step
// never judges a row by its state from before this run.
function noteWrite_SS_(rows, key, fields) {
  rows[key] = Object.assign({}, rows[key] || {}, fields);
}

function writeTracked_SS_(rows, key, fields) {
  if (!fields) return;
  recordSourceStatus_(key, fields);
  noteWrite_SS_(rows, key, fields);
}

function isTriggerFlag_SS_(row) {
  return !!row && row.status === "failed" && String(row.detail || "").indexOf("Trigger missing:") === 0;
}

// getProjectTriggers() only lists the CURRENT user's triggers, so the trigger check is
// meaningful only for the account that owns them (SOURCE_TRIGGER_OWNER, set by the installer).
function isTriggerOwner_SS_(props) {
  var owner = props.getProperty(SOURCE_STATUS.TRIGGER_OWNER_PROP);
  return !!owner && owner === Session.getEffectiveUser().getEmail();
}

// Order matters: trigger flags → probes → roster → SI → RCR, so the rule rows written
// last carry today's computed state. Each step is isolated: one failing step is logged
// and reported in the returned array of messages, and the others still run.
function runSourceChecks_() {
  var now = new Date();
  var props = PropertiesService.getScriptProperties();
  var ids = getExternalSSIds_();
  var rows = readLedgerRows_SS_(ledgerSheet_SS_()).rows;
  var defs = sourceDefs_(props.getProperties());
  var errors = [];
  function step(name, fn) {
    try { fn(); } catch (e) {
      Logger.log("⚠️ [runSourceChecks_] " + name + ": " + e.message);
      errors.push(name + ": " + e.message);
    }
  }

  // 1. Missing triggers (catches the 2026.W39 silent stop at its cause)
  step("triggers", function () {
    if (!isTriggerOwner_SS_(props)) {
      Logger.log("ℹ️ [runSourceChecks_] trigger check skipped: SOURCE_TRIGGER_OWNER is unset or another account");
      return;
    }
    var actual = ScriptApp.getProjectTriggers().map(function (t) {
      var sid = null;
      try { sid = t.getTriggerSourceId(); } catch (e) {}
      return { handler: t.getHandlerFunction(), sourceId: sid };
    });
    var expected = expectedTriggers_SS_(defs, ids);
    var missing = missingTriggers_SS_(expected, actual);
    expected.forEach(function (exp) {
      var miss = missing.filter(function (m) { return m.key === exp.key; })[0];
      // Keep an install-failure reason the installer already wrote.
      if (miss && isTriggerFlag_SS_(rows[exp.key])) return;
      writeTracked_SS_(rows, exp.key,
        flagOutcome_SS_(rows[exp.key], miss ? (miss.installHint || "run " + miss.installer) : null, "Trigger missing"));
    });
  });

  // 2. Probes: Goals RD + Fiscal Quarter, PTO 2023 RD
  step("probes", function () {
    [["goals", ids.goals, CONFIG_PS.SHEET_GOALS, SOURCE_STATUS.GOALS_QUARTER_HEADER],
     ["pto", ids.ptoAccum, SOURCE_STATUS.PTO_SHEET, null]].forEach(function (p) {
      var problem;
      try { problem = probeSheet_SS_(p[1], p[2], p[3]); } catch (e) { problem = e.message; }
      writeTracked_SS_(rows, p[0], flagOutcome_SS_(rows[p[0]], problem, "Cannot read"));
    });
  });

  // 3. Roster fingerprint
  step("roster", function () {
    try {
      var rsh = SpreadsheetApp.openById(ids.roster).getSheetByName(CONFIG_PS.SHEET_ROSTER);
      if (!rsh) throw new Error('tab "' + CONFIG_PS.SHEET_ROSTER + '" not found');
      var vals = rsh.getDataRange().getValues();
      var fp = fingerprint_SS_(vals);
      var change = rosterCheck_SS_(props.getProperty(SOURCE_STATUS.ROSTER_FP_PROP), fp, vals.length - 1, now);
      props.setProperty(SOURCE_STATUS.ROSTER_FP_PROP, fp);
      var cur = rows.roster || {};
      if (cur.status === "failed" && String(cur.detail || "").indexOf("Cannot read:") !== 0) {
        // Failed for another reason (e.g. Trigger missing): keep it, only record the change time.
        writeTracked_SS_(rows, "roster", change && change.lastUpdated ? { lastUpdated: change.lastUpdated } : null);
      } else {
        var restore = flagOutcome_SS_(cur, null, "Cannot read");
        writeTracked_SS_(rows, "roster", Object.assign({}, restore || {}, change || {}));
      }
    } catch (e) {
      writeTracked_SS_(rows, "roster", flagOutcome_SS_(rows.roster, e.message, "Cannot read"));
    }
  });

  // 4. Small Improvements (fixed date rule)
  step("small improvements", function () { writeTracked_SS_(rows, "si", siStatus_SS_(now)); });

  // 5. RCR (bound spreadsheet, "3. RCR")
  step("rcr", function () {
    try {
      var rcr = ledgerSpreadsheet_SS_().getSheetByName(CONFIG_PS.SHEET_RCR);
      if (!rcr) throw new Error('tab "' + CONFIG_PS.SHEET_RCR + '" not found');
      var rv = rcr.getDataRange().getValues();
      writeTracked_SS_(rows, "rcr", rcrStatus_SS_(rv[0].map(String), rv.slice(1), now));
    } catch (e) {
      writeTracked_SS_(rows, "rcr", { status: "failed", detail: "Cannot read: " + e.message });
    }
  });

  return errors;
}

// Daily 05:00 trigger handler.
function checkSourcesDaily() {
  requireMaintainer_("checkSourcesDaily");
  var errs = runSourceChecks_();
  if (errs.length) Logger.log("⚠️ [checkSourcesDaily] checks that could not run: " + errs.join("; "));
}

// ── Installer (run once from the editor; safe to re-run) ────

function installSourceStatusTriggers() {
  requireMaintainer_("installSourceStatusTriggers");
  var props = PropertiesService.getScriptProperties();
  // getProjectTriggers() only sees the running account's triggers: keep one owner.
  var me = Session.getEffectiveUser().getEmail();
  var owner = props.getProperty(SOURCE_STATUS.TRIGGER_OWNER_PROP);
  if (owner && owner !== me) {
    throw new Error("Source Status triggers belong to " + owner +
      "; run installSourceStatusTriggers as that account, or clear " + SOURCE_STATUS.TRIGGER_OWNER_PROP);
  }
  props.setProperty(SOURCE_STATUS.TRIGGER_OWNER_PROP, me);
  props.setProperty(SOURCE_STATUS.LEDGER_SS_PROP, SpreadsheetApp.getActiveSpreadsheet().getId());
  var ids = getExternalSSIds_();

  var mine = ["onWatchedEdit", "checkSourcesDaily", "sendSourceHealthDigest"];
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return mine.indexOf(t.getHandlerFunction()) !== -1; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });

  var tempoHandlers = ["fetchTempoLoggedTime", "fetchTempoPlannedTime", "fetchTempoCapacity"];
  if (!ScriptApp.getProjectTriggers().some(function (t) { return tempoHandlers.indexOf(t.getHandlerFunction()) !== -1; })) {
    Logger.log("⚠️ Tempo triggers are not owned by this account — trigger checks would report them missing");
  }

  // ledgerSheet_SS_() creates and seeds the tab (one pending row per source). Only keys
  // missing from an older, pre-seeding tab are added here, so a re-run never overwrites state.
  var rows = readLedgerRows_SS_(ledgerSheet_SS_()).rows;
  sourceDefs_().forEach(function (d) {
    if (!rows[d.key]) recordSourceStatus_(d.key, { status: "pending", detail: "awaiting first update" });
  });

  // Edit triggers need EDIT access to each workbook for the account running this.
  [["goals", ids.goals], ["pto", ids.ptoAccum]].forEach(function (w) {
    try {
      ScriptApp.newTrigger("onWatchedEdit").forSpreadsheet(w[1]).onEdit().create();
      Logger.log("⚙️ on-edit trigger installed for " + w[0] + " (" + w[1] + ")");
    } catch (e) {
      recordSourceStatus_(w[0], { status: "failed", detail: "Trigger missing: install failed — " + e.message });
      Logger.log("❌ on-edit trigger for " + w[0] + " failed: " + e.message);
    }
  });
  ScriptApp.newTrigger("checkSourcesDaily").timeBased().everyDays(1).atHour(5).create();
  ScriptApp.newTrigger("sendSourceHealthDigest").timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(10).create();
  Logger.log("⚙️ checkSourcesDaily daily 05:00 · sendSourceHealthDigest Monday 10:00");

  // Spec §11: confirm the PTO tab and range once, in the log.
  try {
    var pto = SpreadsheetApp.openById(ids.ptoAccum).getSheetByName(SOURCE_STATUS.PTO_SHEET);
    Logger.log(pto
      ? "ℹ️ " + SOURCE_STATUS.PTO_SHEET + " headers A1:N1: " + pto.getRange(1, 1, 1, 14).getValues()[0].join(" | ")
      : "⚠️ " + SOURCE_STATUS.PTO_SHEET + " not found in the PTO workbook");
  } catch (e) { Logger.log("⚠️ PTO probe: " + e.message); }

  runSourceChecks_();
}
