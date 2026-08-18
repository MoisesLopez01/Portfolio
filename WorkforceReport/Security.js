// ============================================================
// SCRIPT NAME: Workforce & Compensation Report — Security
// PURPOSE:     Email-allowlist access control (CompDash pattern, WR_ names).
//
// DELIBERATELY minimal — this report carries aggregate compensation data, so
// there is NO open-access fallback, NO roster-supervisor auto-resolution, and
// NO delegate scoping. Role resolution is admin → viewer → denied. Nobody
// sees the report without a deliberate grant.
//
//  1. BOOTSTRAP ADMIN (SEC_WR.BOOTSTRAP_ADMIN) — always Admin, not removable via UI.
//  2. DEFAULT ADMINS / VIEWERS — hardcoded here, survive a properties reset.
//  3. RUNTIME lists — Script Properties, managed from 🔒 Access (admin only).
//     Board emails are added as VIEWERS at share time (spec §2).
//
//  ROLES: Admin — full report + manages the access list.
//         Viewer — full report, read-only settings.
// ============================================================

const SEC_WR = {
  PROP_ADMINS:  "WR_DASH_ADMINS",
  PROP_VIEWERS: "WR_DASH_VIEWERS",

  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  DEFAULT_ADMINS: [
    "courtney.sutliff@servicerocket.com",     // WFP
  ],
  DEFAULT_VIEWERS: [
    // "exec@servicerocket.com",              // sample — board viewer at share time
  ],
};

// ── PRIVATE ──────────────────────────────────────────────────

function _readAccessListsWR_() {
  const p = PropertiesService.getScriptProperties();
  const runtimeAdmins = (p.getProperty(SEC_WR.PROP_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_WR.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const admins = [...new Set([
    SEC_WR.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_WR.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];
  const viewers = [...new Set([
    ...SEC_WR.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];
  return { admins, viewers };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Access status for the current session user.
 * @returns {{allowed: boolean, role: ('admin'|'viewer'|'denied'), email: string}}
 */
function checkReportAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers } = _readAccessListsWR_();
  if (admins.includes(email))  return { allowed: true, role: "admin",  email };
  if (viewers.includes(email)) return { allowed: true, role: "viewer", email };
  return { allowed: false, role: "denied", email };
}

/**
 * Admin-only: current lists for the Access view.
 * @returns {{admins: string[], viewers: string[], bootstrapAdmin: string, callerEmail: string}}
 * @throws {Error} If the caller is not an admin.
 */
function getReportAccessSettings() {
  const access = checkReportAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  const { admins, viewers } = _readAccessListsWR_();
  return {
    admins: admins.filter(e => e !== SEC_WR.BOOTSTRAP_ADMIN.toLowerCase()),
    viewers,
    bootstrapAdmin: SEC_WR.BOOTSTRAP_ADMIN,
    callerEmail: access.email,
  };
}

/**
 * Admin-only: persist runtime lists. Busts the report cache so a revoked
 * viewer can't keep reading a warm cached payload under the old version key.
 * Rejects the whole save if any entry isn't a plausible email (a silent typo
 * here would silently grant nobody — fail loudly instead), and logs the
 * added/removed diff as an audit trail for this comp-data gate.
 * @param {{admins?: string[], viewers?: string[]}} settings
 * @throws {Error} If the caller is not an admin, or any entry is malformed.
 */
function saveReportAccessSettings(settings) {
  const access = checkReportAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  if (!settings || typeof settings !== "object") {
    // Running this from the GAS editor toolbar passes no arguments — fail with
    // directions instead of a cryptic TypeError on settings.admins.
    throw new Error("No settings passed — this function is called by the 🔒 Access page in the web app. " +
      "To grant access from the editor, add the email to DEFAULT_ADMINS or DEFAULT_VIEWERS at the top of Security.js, " +
      "or run grantAccessFromEditorWR() after editing its constants.");
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clean = list => (Array.isArray(list) ? list : [])
    .map(e => String(e).trim().toLowerCase()).filter(Boolean);
  const bad = clean(settings.admins).concat(clean(settings.viewers))
    .filter(e => !EMAIL_RE.test(e));
  if (bad.length) throw new Error("Not saved — invalid email(s): " + bad.join(", "));

  const before = _readAccessListsWR_();
  const p = PropertiesService.getScriptProperties();
  if (Array.isArray(settings.admins)) {
    p.setProperty(SEC_WR.PROP_ADMINS, clean(settings.admins)
      .filter(e => e !== SEC_WR.BOOTSTRAP_ADMIN.toLowerCase())
      .join(","));
  }
  if (Array.isArray(settings.viewers)) {
    p.setProperty(SEC_WR.PROP_VIEWERS, clean(settings.viewers).join(","));
  }
  const after = _readAccessListsWR_();
  const diff = (b, a) =>
    "+[" + a.filter(e => !b.includes(e)).join(", ") + "] " +
    "-[" + b.filter(e => !a.includes(e)).join(", ") + "]";
  bustReportCache_(); // defined in Code.js
  Logger.log("✅ Access lists saved by " + access.email +
    " — admins " + diff(before.admins, after.admins) +
    " · viewers " + diff(before.viewers, after.viewers));
  return getReportAccessSettings();
}

/**
 * Editor-only convenience: grant access without the web UI.
 * Edit the two arrays below, run this function from the GAS editor, then
 * restore them to empty. Appends to the runtime Script Properties lists
 * (never removes anyone). Alternative: hardcode in DEFAULT_ADMINS/VIEWERS.
 */
function grantAccessFromEditorWR() {
  const GRANT_ADMINS  = [];  // e.g. ["courtney.sutliff@servicerocket.com"]
  const GRANT_VIEWERS = [];  // e.g. ["board.member@example.com"]

  if (!GRANT_ADMINS.length && !GRANT_VIEWERS.length) {
    throw new Error("Nothing to grant — add email(s) to GRANT_ADMINS / GRANT_VIEWERS inside this function, run it, then clear them again.");
  }
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clean = list => list.map(e => String(e).trim().toLowerCase()).filter(Boolean);
  const bad = clean(GRANT_ADMINS).concat(clean(GRANT_VIEWERS)).filter(e => !EMAIL_RE.test(e));
  if (bad.length) throw new Error("Not saved — invalid email(s): " + bad.join(", "));

  const before = _readAccessListsWR_();
  const p = PropertiesService.getScriptProperties();
  if (GRANT_ADMINS.length) {
    p.setProperty(SEC_WR.PROP_ADMINS,
      [...new Set([...before.admins, ...clean(GRANT_ADMINS)])]
        .filter(e => e !== SEC_WR.BOOTSTRAP_ADMIN.toLowerCase())
        .join(","));
  }
  if (GRANT_VIEWERS.length) {
    p.setProperty(SEC_WR.PROP_VIEWERS,
      [...new Set([...before.viewers, ...clean(GRANT_VIEWERS)])].join(","));
  }
  bustReportCache_(); // defined in Code.js
  const after = _readAccessListsWR_();
  Logger.log("✅ Granted from editor — admins: [" + after.admins.join(", ") +
    "] · viewers: [" + after.viewers.join(", ") + "]");
}

/** Branded denied page — reveals nothing about the data or the allowlist. */
function deniedPageHtmlWR_(email) {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:system-ui,"Segoe UI",Arial,sans-serif;background:#0F1941;color:#FFFAF5;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
    '.card{background:#16224E;border:1px solid #2C3D78;border-radius:12px;padding:32px 40px;max-width:460px;text-align:center}' +
    'h1{font-size:20px;margin:0 0 8px}p{color:#DCCDBE;font-size:14px;line-height:1.5}' +
    '</style></head><body><div class="card"><h1>🔒 Access restricted</h1>' +
    '<p>This report contains sensitive workforce and compensation data and is limited to an approved leadership group.</p>' +
    '<p>Signed in as <b>' + String(email || "unknown").replace(/[<>&]/g, "") + '</b>.<br>' +
    'If you believe you need access, contact Moises Lopez.</p></div></body></html>';
}
