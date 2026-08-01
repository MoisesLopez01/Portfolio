// ============================================================
// SCRIPT NAME: Security (Delivery Health — Leadership Dashboard)
// PURPOSE:     Email-based access control for the standalone
//              Delivery Health web app. Inherits the model used by
//              the PS report's "PS Security.js", scoped to a
//              leadership view (admin / viewer / open-access).
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//
//  Three places grant access, applied in order:
//
//  1. BOOTSTRAP ADMIN (SEC_DH.BOOTSTRAP_ADMIN)
//     Always Admin. Cannot be removed via the UI. → Do not change.
//
//  2. DEFAULT ADMINS / VIEWERS (SEC_DH.DEFAULT_ADMINS / DEFAULT_VIEWERS)
//     Hardcoded here; always active regardless of Script Properties.
//     Edit these for permanent leadership stakeholders.
//
//  3. RUNTIME ACCESS (Script Properties: DH_DASH_ADMINS / DH_DASH_VIEWERS)
//     Any admin can add/remove emails at runtime; additive on top of
//     the defaults. Managed by saveDeliveryAccessSettings().
//
//  ROLES:
//    admin  — view + manage the access list
//    viewer — read-only view
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  If SEC_DH.OPEN_ACCESS_DEFAULT = true (or DH_DASH_OPEN_ACCESS),
//  anyone with the link can view (no email check). Use only for an
//  all-hands / demo; flip back to false when done.
//
//  NOTE: this is delivery resourcing data — unlike the PS report there
//  is no manager org-tree scoping here; access is an explicit
//  allowlist (plus the optional open-access flag).
// ============================================================

const SEC_DH = {
  PROP_ADMINS:      "DH_DASH_ADMINS",
  PROP_VIEWERS:     "DH_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "DH_DASH_OPEN_ACCESS",

  // ── 1. BOOTSTRAP ADMIN — always Admin, never removable via UI ──
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // ── 2a. DEFAULT ADMINS — full view + manage access list ──
  DEFAULT_ADMINS: [
    "gonzalo.riquelme@servicerocket.com",     // PS Director
    "william.mock@servicerocket.com",
    "robert.castaneda@servicerocket.com"
  ],

  // ── 2b. DEFAULT VIEWERS — read-only (delivery leadership) ──
  // Always active — no UI step needed. Add permanent read-only stakeholders here;
  // for temporary or ad-hoc access, use the 🔒 Access button in the dashboard
  // (admin-only) instead — those entries live in Script Properties.
  DEFAULT_VIEWERS: [
    // "director@servicerocket.com",           // sample — Delivery leadership
    // "vp@servicerocket.com",                 // sample — Executive stakeholder
  ],

  // ── Open Access default (false = locked, true = anyone with link) ──
  // false = every user is checked against the admin/viewer allowlists; unlisted
  // users get the Access Restricted page. Flip to true only for an all-hands/demo
  // (or toggle it at runtime from the 🔒 Access panel — the Script Property wins
  // over this code default once set). NOTE: the *deployment's* Web App access
  // setting (Deploy > Manage deployments > "Who has access") is a separate, outer
  // gate — keep it "Anyone within [domain]", never public "Anyone".
  OPEN_ACCESS_DEFAULT: false,
};

// ── PRIVATE ──────────────────────────────────────────────

/**
 * Reads the merged access lists: code-level defaults + runtime additions.
 * @returns {{ admins:string[], viewers:string[], openAccess:boolean }}
 */
function _readDeliveryAccessLists_() {
  const p = PropertiesService.getScriptProperties();

  const runtimeAdmins = (p.getProperty(SEC_DH.PROP_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_DH.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const admins = [...new Set([
    SEC_DH.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_DH.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];

  const viewers = [...new Set([
    ...SEC_DH.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];

  const stored = p.getProperty(SEC_DH.PROP_OPEN_ACCESS);
  const openAccess = stored !== null ? stored === "true" : SEC_DH.OPEN_ACCESS_DEFAULT;

  return { admins, viewers, openAccess };
}

// ── PUBLIC ───────────────────────────────────────────────

/**
 * Returns the access status for the current session user.
 * Server-side authority — called from doGet() and getDeliveryData().
 * @returns {{ allowed:boolean, role:'admin'|'viewer'|'denied', email:string }}
 */
function checkDeliveryAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers, openAccess } = _readDeliveryAccessLists_();

  if (admins.includes(email))                return { allowed: true,  role: "admin",  email };
  if (openAccess || viewers.includes(email)) return { allowed: true,  role: "viewer", email };
  return { allowed: false, role: "denied", email };
}

/**
 * Returns the current access lists for the admin settings UI.
 * Admin-only — throws if the caller is not an admin.
 */
function getDeliveryAccessSettings() {
  const access = checkDeliveryAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  const { admins, viewers, openAccess } = _readDeliveryAccessLists_();
  const editableAdmins = admins.filter(e => e !== SEC_DH.BOOTSTRAP_ADMIN.toLowerCase());

  return {
    admins:         editableAdmins,
    viewers,
    openAccess,
    bootstrapAdmin: SEC_DH.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin-only — throws if the caller is not an admin.
 * @param {{ admins?:string[], viewers?:string[], openAccess?:boolean }} settings
 */
function saveDeliveryAccessSettings(settings) {
  const access = checkDeliveryAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  // Editor "Run" invokes with no args — treat as a no-op save instead of throwing.
  settings = settings || {};

  const p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.admins)) {
    const list = settings.admins
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e !== SEC_DH.BOOTSTRAP_ADMIN.toLowerCase());
    p.setProperty(SEC_DH.PROP_ADMINS, list.join(","));
  }
  if (Array.isArray(settings.viewers)) {
    const list = settings.viewers
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);
    p.setProperty(SEC_DH.PROP_VIEWERS, list.join(","));
  }
  if (typeof settings.openAccess === "boolean") {
    p.setProperty(SEC_DH.PROP_OPEN_ACCESS, String(settings.openAccess));
  }

  Logger.log(`Delivery Health Security: access settings updated by ${access.email}`);
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
  const owner = SEC_DH.BOOTSTRAP_ADMIN;
  const mailto = `mailto:${owner}`
    + `?subject=${encodeURIComponent("Access request — Delivery Health dashboard")}`
    + `&body=${encodeURIComponent("Hi, I'd like viewer access to the Delivery Health dashboard." + (email ? "\n\nMy account: " + email : ""))}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Delivery Health — Access Restricted</title>
<style>
  :root{
    --bg:#FFFAF5; --surface:#fff; --surface-2:#FBF6F0; --border:#E7DDD2;
    --text:#0F1941; --muted:#64748B; --chip:#475569; --orbe:#058CDC;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#090F26; --surface:#141C3D; --surface-2:#0F1733; --border:#1E295A;
      --text:#FFFAF5; --muted:#94A3B8; --chip:#94A3B8;
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Roboto',-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:var(--bg);display:flex;align-items:center;
       justify-content:center;min-height:100vh;color:var(--text)}
  .card{background:var(--surface);border-radius:14px;padding:40px 48px;
        text-align:center;max-width:440px;width:90%;
        box-shadow:0 1px 4px rgba(15,25,65,.08);border:1px solid var(--border)}
  .lock{font-size:40px;margin-bottom:16px}
  h1{font-size:19px;font-weight:800;margin-bottom:8px}
  p{color:var(--muted);font-size:13px;line-height:1.65}
  .email{display:inline-block;margin-top:14px;background:var(--surface-2);
         border:1px solid var(--border);border-radius:6px;padding:5px 12px;
         font-family:monospace;font-size:12px;color:var(--chip)}
  .req{display:inline-block;margin-top:18px;background:var(--orbe);color:#fff;
       border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;
       text-decoration:none}
  .req:hover{filter:brightness(1.08)}
  .foot{margin-top:16px;font-size:11px;color:var(--muted)}
</style></head>
<body><div class="card">
  <div class="lock">🔒</div>
  <h1>Access Restricted</h1>
  <p>The Delivery Health dashboard is available to authorized<br>
  delivery leadership — directs and above.</p>
  ${safeEmail ? `<div class="email">${safeEmail}</div>` : ""}
  <br><a class="req" href="${mailto}">Request access</a>
  <div class="foot">Requests go to the report owner (${owner}).</div>
</div></body></html>`;
}
