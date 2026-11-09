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
