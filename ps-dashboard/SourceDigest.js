// ============================================================
// SOURCE STATUS — MONDAY DIGEST
// Spec §8: email only when Goals or a Tempo export is failed or stale.
// No top-level const/let in this file: the Node tests eval it.
// ============================================================

// rows: evaluated rows (evaluateSourceStatus_ output). Returns null when nothing
// that belongs in the email has a problem.
function buildDigest_SS_(rows, now, dashboardUrl) {
  var bad = rows.filter(function (r) { return r.digest && (r.status === "failed" || r.status === "stale"); });
  if (!bad.length) return null;
  var wk = isoLabel_SS_(now);
  var subject = "PS Dashboard sources: " + bad.length + (bad.length === 1 ? " needs" : " need") +
                " attention (" + wk + ")";
  var blocks = bad.map(function (r) {
    return "• " + r.label + " — " + r.status.toUpperCase() +
           "\n   Last good update: " + (r.lastUpdated ? stampLabel_SS_(r.lastUpdated) : "never") +
           "\n   Detail: " + (r.detail || "—") +
           (r.action ? "\n   Action: " + r.action : "");
  });
  var body = "Sources that need attention this week (" + wk + "):\n\n" + blocks.join("\n\n") +
             (dashboardUrl ? "\n\nData Reference: " + dashboardUrl : "") +
             "\n\nSent by sendSourceHealthDigest (PS Dashboard). Weeks with nothing to report send no email.";
  return { subject: subject, body: body, count: bad.length };
}

// One line per source, for the preview email.
function buildStatusSummary_SS_(rows) {
  return rows.map(function (r) {
    return r.label + ": " + r.status +
           (r.lastUpdated ? " · last " + stampLabel_SS_(r.lastUpdated) : "") +
           (r.detail ? " · " + r.detail : "");
  }).join("\n");
}

// ── Apps Script glue ────────────────────────────────────────

function digestRecipients_SS_() {
  var p = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.DIGEST_RECIPIENTS_PROP);
  return (p && p.trim()) ? p.trim() : Session.getEffectiveUser().getEmail();
}

function dashboardUrl_SS_() {
  var p = PropertiesService.getScriptProperties().getProperty(SOURCE_STATUS.DASHBOARD_URL_PROP);
  if (p) return p;
  try { return ScriptApp.getService().getUrl() || ""; } catch (e) { return ""; }
}

// Runs the checks; a failure (thrown or reported) never blocks the email.
function runChecksSafe_SS_() {
  try { return runSourceChecks_() || []; } catch (e) { return ["checks: " + e.message]; }
}

function checksNote_SS_(errs) {
  return errs.length ? "\n\nChecks that could not run: " + errs.join("; ") : "";
}

// Monday 10:00 trigger handler. Re-evaluates everything at send time.
function sendSourceHealthDigest() {
  requireMaintainer_("sendSourceHealthDigest");
  var now = new Date(), wk = isoLabel_SS_(now);
  var errs = runChecksSafe_SS_();
  var d = buildDigest_SS_(evaluatedRows_SS_(now), now, dashboardUrl_SS_());
  if (!d) {
    recordSourceStatus_("digest", { status: "ok", lastUpdated: now, coversPeriod: wk,
      detail: "Nothing to report" + (errs.length ? " (checks partly failed: " + errs.join("; ") + ")" : "") });
    return { sent: false };
  }
  try {
    MailApp.sendEmail({ to: digestRecipients_SS_(), subject: d.subject, body: d.body + checksNote_SS_(errs) });
    recordSourceStatus_("digest", { status: "ok", lastUpdated: now, coversPeriod: wk,
                                    detail: "Sent: " + d.count + " source(s) need attention" });
    return { sent: true, count: d.count };
  } catch (e) {
    recordSourceStatus_("digest", { status: "failed", detail: "Send failed: " + e.message });
    throw e;
  }
}

// Run from the editor: emails ONLY the caller, whatever the state, with every row listed.
function previewSourceHealthDigest() {
  var me = requireMaintainer_("previewSourceHealthDigest");
  var now = new Date(), wk = isoLabel_SS_(now);
  var errs = runChecksSafe_SS_();
  var rows = evaluatedRows_SS_(now);
  var d = buildDigest_SS_(rows, now, dashboardUrl_SS_()) ||
          { subject: "PS Dashboard sources: nothing to report (" + wk + ")",
            body: "No Goals or Tempo source needs attention — the scheduled digest would send nothing this week." };
  MailApp.sendEmail({ to: me, subject: "[Preview] " + d.subject,
                      body: d.body + checksNote_SS_(errs) + "\n\nAll sources:\n" + buildStatusSummary_SS_(rows) });
  return { previewedTo: me };
}
