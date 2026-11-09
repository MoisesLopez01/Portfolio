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
