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
  DIGEST_RECIPIENTS_PROP: "SOURCE_DIGEST_RECIPIENTS",
  DASHBOARD_URL_PROP: "SOURCE_DASHBOARD_URL",
  // staleHours: null = never stale. cadenceHours: used for "Next expected".
  // rule: true = status is computed by checkSourcesDaily / the digest, not by age.
  // trigger: handler that must exist (checked daily); installer: what to run if it is missing.
  SOURCES: [
    { key: "tempo_tracked",  label: "Tempo Tracked",  staleHours: 26,  cadenceHours: 24,  digest: true,
      trigger: "fetchTempoLoggedTime",  installer: "createLoggedDailyTrigger",
      action: "Run fetchTempoLoggedTime from the Apps Script editor and check its log." },
    { key: "tempo_plan",     label: "Tempo Plan",     staleHours: 192, cadenceHours: 168, digest: true,
      trigger: "fetchTempoPlannedTime", installer: "createWeeklyTrigger",
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
    { key: "roster",         label: "Roster",         staleHours: null, cadenceHours: null, digest: false,
      trigger: "checkSourcesDaily", installer: "installSourceStatusTriggers", action: "" },
    { key: "kudos",          label: "Kudos",          staleHours: null, cadenceHours: null, digest: false,
      trigger: null, action: "Run runKudosNormalizer." },
    { key: "si",             label: "Small Improvements", rule: true, digest: false, trigger: null, action: "" },
    { key: "rcr",            label: "RCR · revenue ÷ compensation (TCC)", rule: true, digest: false, trigger: null, action: "" },
    { key: "digest",         label: "Monday digest",  rule: true, digest: false,
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
    if (v != null && String(v).trim() !== "" && !isNaN(Number(v))) o.staleHours = Number(v);
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

var RCR_MONTH_RE_SS = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*[-\s]?\s*(\d{2})$/i;
var MONTHS_SS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var MONTH_ABBR_SS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isFilledNumber_SS_(v) {
  if (typeof v === "number") return !isNaN(v);
  var s = String(v == null ? "" : v).replace(/[,%\s]/g, "");
  return s !== "" && !isNaN(parseFloat(s)) && isFinite(Number(s));
}

// Newest month column ("Oct 26" / "Oct-26") holding at least one numeric value.
// Scans every fiscal year present, like readRCR_PS_ does.
function latestRcrMonth_SS_(headers, rows) {
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
    if (rows.some(function (r) { return isFilledNumber_SS_(r[c.col]); })) return c;
  }
  return null;
}

// RCR covers through the month end; the last closed month is pending until Finance
// fills its column. Never stale — timing belongs to Finance.
function rcrStatus_SS_(headers, rows, now) {
  var latest = latestRcrMonth_SS_(headers, rows);
  var lastClosed = new Date(now.getFullYear(), now.getMonth(), 0);
  var wantKey = lastClosed.getFullYear() * 12 + lastClosed.getMonth();
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
    return { key: d.key, handler: d.trigger, sourceId: d.watch ? ids[d.watch] : null, installer: d.installer };
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
