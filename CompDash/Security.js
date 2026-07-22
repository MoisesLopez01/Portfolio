// ============================================================
// SCRIPT NAME: Comp Health Report — Security
// PURPOSE:     Email-allowlist access control.
//
// DELIBERATELY smaller than PS Security: this dashboard carries individual
// compensation data, so there is NO open-access fallback, NO roster-supervisor
// auto-resolution, and NO delegate scoping. Role resolution is
// admin → viewer → denied. Nobody sees comp data without a deliberate grant.
// (Org-tree manager scoping is the headline V2 feature — do not re-add the
// PS mechanisms piecemeal.)
//
//  1. BOOTSTRAP ADMIN (SEC_CD.BOOTSTRAP_ADMIN) — always Admin, not removable via UI.
//  2. DEFAULT ADMINS / VIEWERS — hardcoded here, survive a properties reset.
//  3. RUNTIME lists — Script Properties, managed from 🔒 Access Control (admin only).
//
//  ROLES: Admin — full dashboard + manages the access list.
//         Viewer — full dashboard, read-only settings.
// ============================================================

const SEC_CD = {
  PROP_ADMINS:  "CD_DASH_ADMINS",
  PROP_VIEWERS: "CD_DASH_VIEWERS",

  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  DEFAULT_ADMINS: [
    // "courtney.sutliff@servicerocket.com",  // sample — WFP
  ],
  DEFAULT_VIEWERS: [
    // "exec@servicerocket.com",              // sample — leadership pilot viewer
  ],
};

// ── PRIVATE ──────────────────────────────────────────────────

function _readAccessListsCD_() {
  const p = PropertiesService.getScriptProperties();
  const runtimeAdmins = (p.getProperty(SEC_CD.PROP_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_CD.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const admins = [...new Set([
    SEC_CD.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_CD.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];
  const viewers = [...new Set([
    ...SEC_CD.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];
  return { admins, viewers };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Access status for the current session user.
 * @returns {{allowed: boolean, role: ('admin'|'viewer'|'denied'), email: string}}
 */
function checkDashboardAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers } = _readAccessListsCD_();
  if (admins.includes(email))  return { allowed: true, role: "admin",  email };
  if (viewers.includes(email)) return { allowed: true, role: "viewer", email };
  return { allowed: false, role: "denied", email };
}

/**
 * Admin-only: current lists for the Access Control view.
 * @returns {{admins: string[], viewers: string[], bootstrapAdmin: string, callerEmail: string}}
 * @throws {Error} If the caller is not an admin.
 */
function getAccessSettings() {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  const { admins, viewers } = _readAccessListsCD_();
  return {
    admins: admins.filter(e => e !== SEC_CD.BOOTSTRAP_ADMIN.toLowerCase()),
    viewers,
    bootstrapAdmin: SEC_CD.BOOTSTRAP_ADMIN,
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
function saveAccessSettings(settings) {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clean = list => (Array.isArray(list) ? list : [])
    .map(e => String(e).trim().toLowerCase()).filter(Boolean);
  const bad = clean(settings.admins).concat(clean(settings.viewers))
    .filter(e => !EMAIL_RE.test(e));
  if (bad.length) throw new Error("Not saved — invalid email(s): " + bad.join(", "));

  const before = _readAccessListsCD_();
  const p = PropertiesService.getScriptProperties();
  if (Array.isArray(settings.admins)) {
    p.setProperty(SEC_CD.PROP_ADMINS, clean(settings.admins)
      .filter(e => e !== SEC_CD.BOOTSTRAP_ADMIN.toLowerCase())
      .join(","));
  }
  if (Array.isArray(settings.viewers)) {
    p.setProperty(SEC_CD.PROP_VIEWERS, clean(settings.viewers).join(","));
  }
  const after = _readAccessListsCD_();
  const diff = (b, a) =>
    "+[" + a.filter(e => !b.includes(e)).join(", ") + "] " +
    "-[" + b.filter(e => !a.includes(e)).join(", ") + "]";
  bustCompCache_(); // defined in Code.js
  Logger.log("✅ Access lists saved by " + access.email +
    " — admins " + diff(before.admins, after.admins) +
    " · viewers " + diff(before.viewers, after.viewers));
  return getAccessSettings();
}

/** Branded denied page — reveals nothing about the data or the allowlist. */
function deniedPageHtml_(email) {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:system-ui,"Segoe UI",Arial,sans-serif;background:#10201a;color:#e8f2ec;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
    '.card{background:#183028;border:1px solid #2a4a3c;border-radius:12px;padding:32px 40px;max-width:460px;text-align:center}' +
    'h1{font-size:20px;margin:0 0 8px}p{color:#9fb8ab;font-size:14px;line-height:1.5}' +
    '</style></head><body><div class="card"><h1>🔒 Access restricted</h1>' +
    '<p>This report contains sensitive compensation data and is limited to an approved leadership group.</p>' +
    '<p>Signed in as <b>' + String(email || "unknown").replace(/[<>&]/g, "") + '</b>.<br>' +
    'If you believe you need access, contact Moises Lopez.</p></div></body></html>';
}
