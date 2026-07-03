// ============================================================
// SCRIPT NAME: Security (Project Demand — C-Suite Dashboard)
// PURPOSE:     Email-based access control for the standalone
//              Project Demand web app. Inherits the model used by
//              the PS report's "PS Security.js", scoped to an
//              executive view (admin / viewer / open-access).
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//
//  Three places grant access, applied in order:
//
//  1. BOOTSTRAP ADMIN (SEC_PD.BOOTSTRAP_ADMIN)
//     Always Admin. Cannot be removed via the UI. → Do not change.
//
//  2. DEFAULT ADMINS / VIEWERS (SEC_PD.DEFAULT_ADMINS / DEFAULT_VIEWERS)
//     Hardcoded here; always active regardless of Script Properties.
//     Edit these for permanent C-suite / PS-leadership stakeholders.
//
//  3. RUNTIME ACCESS (Script Properties: PD_DASH_ADMINS / PD_DASH_VIEWERS)
//     Any admin can add/remove emails at runtime; additive on top of
//     the defaults. Managed by saveDemandAccessSettings().
//
//  ROLES:
//    admin  — view + manage the access list
//    viewer — read-only view
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  If SEC_PD.OPEN_ACCESS_DEFAULT = true (or PD_DASH_OPEN_ACCESS),
//  anyone with the link can view (no email check). Use only for an
//  all-hands / demo; flip back to false when done.
//
//  NOTE: this is exec resourcing data — unlike the PS report there
//  is no manager org-tree scoping here; access is an explicit
//  allowlist (plus the optional open-access flag).
// ============================================================

const SEC_PD = {
  PROP_ADMINS:      "PD_DASH_ADMINS",
  PROP_VIEWERS:     "PD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "PD_DASH_OPEN_ACCESS",

  // ── 1. BOOTSTRAP ADMIN — always Admin, never removable via UI ──
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // ── 2a. DEFAULT ADMINS — full view + manage access list ──
  DEFAULT_ADMINS: [
    "alex.lopez@servicerocket.com",     // PS Director
  ],

  // ── 2b. DEFAULT VIEWERS — read-only (C-suite stakeholders) ──
  // Not used while OPEN_ACCESS_DEFAULT is true (see below) — everyone who isn't an
  // admin already gets viewer access. Add explicit emails here if OPEN_ACCESS_DEFAULT
  // is ever flipped back to false and viewers need to be re-enumerated individually.
  DEFAULT_VIEWERS: [
    // "ceo@servicerocket.com",            // sample — Executive stakeholder
    // "coo@servicerocket.com",            // sample — Executive stakeholder
  ],

  // ── Open Access default ──
  // true = everyone who isn't in DEFAULT_ADMINS/runtime-admins gets viewer access —
  // no per-email allowlist needed for viewers. NOTE: this is enforced by the app's own
  // email check, but the *deployment's* own Web App access setting (Apps Script
  // Deploy > Manage deployments > "Who has access") is a separate, outer gate — set it
  // to "Anyone within [domain]" (not public "Anyone") so this doesn't also expose the
  // dashboard outside the org regardless of this flag.
  OPEN_ACCESS_DEFAULT: true,
};

// ── PRIVATE ──────────────────────────────────────────────────

/**
 * Reads the merged access lists: code-level defaults + runtime additions.
 * @returns {{ admins:string[], viewers:string[], openAccess:boolean }}
 */
function _readDemandAccessLists_() {
  const p = PropertiesService.getScriptProperties();

  const runtimeAdmins = (p.getProperty(SEC_PD.PROP_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_PD.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const admins = [...new Set([
    SEC_PD.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_PD.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];

  const viewers = [...new Set([
    ...SEC_PD.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];

  const stored = p.getProperty(SEC_PD.PROP_OPEN_ACCESS);
  const openAccess = stored !== null ? stored === "true" : SEC_PD.OPEN_ACCESS_DEFAULT;

  return { admins, viewers, openAccess };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Returns the access status for the current session user.
 * Server-side authority — called from doGet() and getDemandData().
 * @returns {{ allowed:boolean, role:'admin'|'viewer'|'denied', email:string }}
 */
function checkDemandAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers, openAccess } = _readDemandAccessLists_();

  if (admins.includes(email))                return { allowed: true,  role: "admin",  email };
  if (openAccess || viewers.includes(email)) return { allowed: true,  role: "viewer", email };
  return { allowed: false, role: "denied", email };
}

/**
 * Returns the current access lists for the admin settings UI.
 * Admin-only — throws if the caller is not an admin.
 */
function getDemandAccessSettings() {
  const access = checkDemandAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  const { admins, viewers, openAccess } = _readDemandAccessLists_();
  const editableAdmins = admins.filter(e => e !== SEC_PD.BOOTSTRAP_ADMIN.toLowerCase());

  return {
    admins:         editableAdmins,
    viewers,
    openAccess,
    bootstrapAdmin: SEC_PD.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin-only — throws if the caller is not an admin.
 * @param {{ admins?:string[], viewers?:string[], openAccess?:boolean }} settings
 */
function saveDemandAccessSettings(settings) {
  const access = checkDemandAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  const p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.admins)) {
    const list = settings.admins
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e !== SEC_PD.BOOTSTRAP_ADMIN.toLowerCase());
    p.setProperty(SEC_PD.PROP_ADMINS, list.join(","));
  }
  if (Array.isArray(settings.viewers)) {
    const list = settings.viewers
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);
    p.setProperty(SEC_PD.PROP_VIEWERS, list.join(","));
  }
  if (typeof settings.openAccess === "boolean") {
    p.setProperty(SEC_PD.PROP_OPEN_ACCESS, String(settings.openAccess));
  }

  Logger.log(`Project Demand Security: access settings updated by ${access.email}`);
  return { ok: true, savedAt: new Date().toISOString() };
}

/**
 * Minimal HTML page shown to denied users. Called from doGet().
 * @param {string} email
 * @returns {string}
 */
function buildAccessDeniedPage_(email) {
  const safeEmail = email
    ? email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Project Demand — Access Restricted</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#FFFAF5;display:flex;align-items:center;
       justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:14px;padding:40px 48px;
        text-align:center;max-width:420px;width:90%;
        box-shadow:0 1px 4px rgba(15,25,65,.08);border:1px solid #E7DDD2}
  .lock{font-size:40px;margin-bottom:16px}
  h1{font-size:18px;font-weight:800;color:#0F1941;margin-bottom:8px}
  p{color:#64748B;font-size:13px;line-height:1.65}
  .email{display:inline-block;margin-top:14px;background:#FBF6F0;
         border-radius:6px;padding:5px 12px;font-family:monospace;
         font-size:12px;color:#475569}
</style></head>
<body><div class="card">
  <div class="lock">🔒</div>
  <h1>Access Restricted</h1>
  <p>The Project Demand dashboard is available to authorized<br>
  C-suite and PS leadership only.<br>
  Contact the report owner to request access.</p>
  ${safeEmail ? `<div class="email">${safeEmail}</div>` : ""}
</div></body></html>`;
}
