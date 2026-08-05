// ============================================================
// Security.js — DEMO build: open access, no allowlist.
// This is the public portfolio demo of the Project Demand
// dashboard. All data is synthetic (see DemoData.js); the
// fictional brand is "Helix Delivery Group". The production
// build of this app uses a bootstrap-admin + allowlist model —
// that code path is exercised here with open access ON.
// ============================================================

const SEC_PD = {
  PROP_ADMINS:      "PD_DASH_ADMINS",
  PROP_VIEWERS:     "PD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "PD_DASH_OPEN_ACCESS",

  BOOTSTRAP_ADMIN: "demo.admin@example.com",
  DEFAULT_ADMINS:  [],
  DEFAULT_VIEWERS: [],

  // Public demo: anyone with the link is a viewer.
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

  // Editor "Run" invokes with no args — treat as a no-op save instead of throwing.
  settings = settings || {};

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
  const owner = SEC_PD.BOOTSTRAP_ADMIN;
  const mailto = `mailto:${owner}`
    + `?subject=${encodeURIComponent("Access request — Project Demand dashboard")}`
    + `&body=${encodeURIComponent("Hi, I'd like viewer access to the Project Demand dashboard." + (email ? "\n\nMy account: " + email : ""))}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project Demand — Access Restricted</title>
<style>
  :root{
    --bg:#FFFAF5; --surface:#fff; --surface-2:#FBF6F0; --border:#E7DDD2;
    --text:#0F1941; --muted:#64748B; --chip:#475569; --accent:#058CDC;
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
  .req{display:inline-block;margin-top:18px;background:var(--accent);color:#fff;
       border-radius:8px;padding:9px 18px;font-size:13px;font-weight:700;
       text-decoration:none}
  .req:hover{filter:brightness(1.08)}
  .foot{margin-top:16px;font-size:11px;color:var(--muted)}
</style></head>
<body><div class="card">
  <div class="lock">🔒</div>
  <h1>Access Restricted</h1>
  <p>The Project Demand dashboard is available to authorized<br>
  C-suite and PS leadership only.</p>
  ${safeEmail ? `<div class="email">${safeEmail}</div>` : ""}
  <br><a class="req" href="${mailto}">Request access</a>
  <div class="foot">Requests go to the report owner (${owner}).</div>
</div></body></html>`;
}
