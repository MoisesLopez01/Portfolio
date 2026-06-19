// ============================================================
// SCRIPT NAME: PS Security
// PURPOSE:     Email-based access control for the PS Dashboard.
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//
//  There are THREE places where you grant access:
//
//  1. BOOTSTRAP ADMIN (below, SEC_.BOOTSTRAP_ADMIN)
//     Always has Admin access. Cannot be removed from the UI.
//     → This is you. Do not change.
//
//  2. DEFAULT ADMINS / VIEWERS (below, SEC_.DEFAULT_ADMINS / DEFAULT_VIEWERS)
//     Hardcoded in this file. These are always active regardless
//     of what is saved in Script Properties. Edit this list when
//     you want permanent access that survives a properties reset.
//     → Add PS leads, managers, or permanent stakeholders here.
//
//  3. RUNTIME ACCESS (Settings tab in the dashboard)
//     Any admin can add/remove emails via the ⚙ Settings tab
//     without touching this file. Those entries are stored in
//     Script Properties and are ADDITIVE on top of the defaults.
//     → Use this for temporary access or viewer-only guests.
//
//  ROLES:
//    Admin  — full dashboard access + can manage the access list
//    Viewer — read-only dashboard access
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  If SEC_.OPEN_ACCESS_DEFAULT = true, anyone with the link can
//  view the dashboard (no email check). Use only for internal
//  all-hands or demo contexts. Flip back to false when done.
// ============================================================

const SEC_ = {
  PROP_ADMINS:      "PS_DASH_ADMINS",
  PROP_VIEWERS:     "PS_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "PS_DASH_OPEN_ACCESS",
  PROP_DELEGATES:   "PS_DASH_DELEGATES",

  // ── 1. BOOTSTRAP ADMIN ─────────────────────────────────────
  // Always an Admin. Cannot be removed via the UI.
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // ── 2a. DEFAULT ADMINS ─────────────────────────────────────
  // Full access + can manage the access list.
  // These are always active — no UI step needed.
  // Add one email per line as a string in the array.
  DEFAULT_ADMINS: [
    // "alex.lopez@servicerocket.com",       // sample — PS Director
    // "maria.santos@servicerocket.com",     // sample — PS Operations Lead
  ],

  // ── 2b. DEFAULT VIEWERS ────────────────────────────────────
  // Read-only access to the dashboard.
  // These are always active — no UI step needed.
  // Add one email per line as a string in the array.
  DEFAULT_VIEWERS: [
    // "john.smith@servicerocket.com",       // sample — Delivery Manager
    // "sarah.kim@servicerocket.com",        // sample — PS Rocketeer
    // "cto@servicerocket.com",              // sample — Executive stakeholder
  ],

  // ── 2c. DEFAULT DELEGATES ──────────────────────────────────
  // Manager-scoped access granted to people not in the Roster as supervisors.
  // Format: { email, scopeName } where scopeName is the full name of the
  // Roster supervisor whose org tree this person should see.
  // These are always active — no UI step needed.
  DEFAULT_DELEGATES: [
    // { email: "peer@servicerocket.com", scopeName: "Juan Lopez" },
  ],

  // ── Open Access default (false = locked, true = anyone with link) ──
  OPEN_ACCESS_DEFAULT: false,
};

// ── PRIVATE ──────────────────────────────────────────────────

/**
 * Reads the roster spreadsheet to verify whether a given email belongs to an
 * active PS supervisor. Uses the same data source as the main report
 * (ROSTER_SS_ID from Script Properties or CONFIG_PS fallback).
 *
 * Active = no Termination/Release Date AND Employee Status not matching
 * the inactive regex — consistent with readPSRoster_() in the main report.
 *
 * @param {string} email - Lowercase email to check.
 * @returns {string|null} The supervisor's canonical Name, or null.
 */
function _resolveRosterSupervisor_(email) {
  try {
    const ssId = PropertiesService.getScriptProperties().getProperty("ROSTER_SS_ID")
              || (typeof CONFIG_PS !== "undefined" ? CONFIG_PS.ROSTER_SS_ID : null);
    if (!ssId) return null;

    const sheet = SpreadsheetApp.openById(ssId).getSheetByName("Roster");
    if (!sheet) return null;

    const [headerRow, ...dataRows] = sheet.getDataRange().getValues();
    const headers = headerRow.map(h => h.toString().trim());
    const idx = col => headers.indexOf(col);

    const iName   = idx("Name");
    const iEmail  = idx("Email");
    const iClass  = idx("Class");
    const iDept   = idx("Department");
    const iSup    = idx("Supervisor");
    const iStatus = idx("Employee Status");
    const iTerm   = idx("Termination/Release Date");
    if (iName === -1 || iEmail === -1) return null;

    const INACTIVE_RE = /terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i;
    const isActive = row => {
      const status   = iStatus !== -1 ? String(row[iStatus] || "").trim() : "";
      const termDate = iTerm   !== -1 ? String(row[iTerm]   || "").trim() : "";
      return !(INACTIVE_RE.test(status) || termDate);
    };

    // Find this email in the PS / Services scope
    const supRow = dataRows.find(row => {
      const rowEmail = String(row[iEmail] || "").toLowerCase().trim();
      const rowClass = iClass !== -1 ? String(row[iClass] || "").trim() : "";
      const rowDept  = iDept  !== -1 ? String(row[iDept]  || "").trim() : "";
      return rowEmail === email
          && rowClass === "Professional Services"
          && rowDept  === "Services";
    });
    if (!supRow) return null;

    const supervisorName = String(supRow[iName] || "").trim();
    if (!supervisorName) return null;

    // Confirm they have at least one active direct report
    const hasReports = dataRows.some(row =>
      String(row[iSup] || "").trim() === supervisorName && isActive(row)
    );

    return hasReports ? supervisorName : null;
  } catch (e) {
    Logger.log("⚠️ [_resolveRosterSupervisor_] " + e.message);
    return null;
  }
}

function _readAccessLists_() {
  const p = PropertiesService.getScriptProperties();

  // Runtime lists from Script Properties (managed via Settings tab)
  const runtimeAdmins  = (p.getProperty(SEC_.PROP_ADMINS)  || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  // Delegates: newline-separated "email:Supervisor Full Name" pairs
  const runtimeDelegates = (p.getProperty(SEC_.PROP_DELEGATES) || "")
    .split("\n")
    .map(line => {
      const sep = line.indexOf(":");
      if (sep === -1) return null;
      const email     = line.slice(0, sep).trim().toLowerCase();
      const scopeName = line.slice(sep + 1).trim();
      return (email && scopeName) ? { email, scopeName } : null;
    })
    .filter(Boolean);

  // Merge: code-level defaults + runtime additions (deduplicated)
  const admins = [...new Set([
    SEC_.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];

  const viewers = [...new Set([
    ...SEC_.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];

  // Delegates merged from code defaults + runtime; last runtime entry wins on duplicate email
  const delegateMap = new Map();
  SEC_.DEFAULT_DELEGATES.forEach(d => { if (d.email && d.scopeName) delegateMap.set(d.email.toLowerCase(), d.scopeName); });
  runtimeDelegates.forEach(d => delegateMap.set(d.email, d.scopeName));
  const delegates = [...delegateMap.entries()].map(([email, scopeName]) => ({ email, scopeName }));

  // Open access: Script Property overrides code default when explicitly set
  const stored = p.getProperty(SEC_.PROP_OPEN_ACCESS);
  const openAccess = stored !== null ? stored === "true" : SEC_.OPEN_ACCESS_DEFAULT;

  return { admins, viewers, openAccess, delegates };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Returns the access status for the current session user.
 * @returns {{ allowed: boolean, role: 'admin'|'viewer'|'manager'|'denied', email: string, delegateScopeName?: string, potential?: boolean }}
 */
function checkDashboardAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers, openAccess, delegates } = _readAccessLists_();

  if (admins.includes(email))                return { allowed: true,  role: "admin",  email };
  if (openAccess || viewers.includes(email)) return { allowed: true,  role: "viewer", email };

  // Explicit delegate: granted manager access with a named supervisor scope
  const delegate = delegates.find(d => d.email === email);
  if (delegate) return { allowed: true, role: "manager", email, delegateScopeName: delegate.scopeName };

  // Not in any explicit list — check whether this email is an active roster supervisor.
  // Reading the roster here gives a definitive answer so doGet/getPSReportData
  // never need to handle an ambiguous "potential" state.
  const supervisorName = _resolveRosterSupervisor_(email);
  if (supervisorName) {
    Logger.log(`Manager access (auto-roster): ${email} → "${supervisorName}"`);
    return { allowed: true, role: "manager", email, delegateScopeName: supervisorName };
  }

  return { allowed: false, role: "denied", email };
}

/**
 * Returns the current access lists for the settings UI.
 * Admin-only — throws if the caller is not an admin.
 */
function getAccessSettings() {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  const { admins, viewers, openAccess, delegates } = _readAccessLists_();
  const editableAdmins = admins.filter(e => e !== SEC_.BOOTSTRAP_ADMIN.toLowerCase());

  return {
    admins:         editableAdmins,
    viewers,
    openAccess,
    delegates,
    bootstrapAdmin: SEC_.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin-only — throws if the caller is not an admin.
 * @param {{ admins?: string[], viewers?: string[], openAccess?: boolean, delegates?: {email:string, scopeName:string}[] }} settings
 */
function saveAccessSettings(settings) {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  const p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.admins)) {
    const list = settings.admins
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e !== SEC_.BOOTSTRAP_ADMIN.toLowerCase());
    p.setProperty(SEC_.PROP_ADMINS, list.join(","));
  }
  if (Array.isArray(settings.viewers)) {
    const list = settings.viewers
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0);
    p.setProperty(SEC_.PROP_VIEWERS, list.join(","));
  }
  if (Array.isArray(settings.delegates)) {
    const lines = settings.delegates
      .filter(d => d.email && d.scopeName)
      .map(d => `${d.email.trim().toLowerCase()}:${d.scopeName.trim()}`);
    p.setProperty(SEC_.PROP_DELEGATES, lines.join("\n"));
  }
  if (typeof settings.openAccess === "boolean") {
    p.setProperty(SEC_.PROP_OPEN_ACCESS, String(settings.openAccess));
  }

  Logger.log(`PS Security: access settings updated by ${access.email}`);
  return { ok: true, savedAt: new Date().toISOString() };
}

/**
 * Returns a minimal HTML page shown to denied users.
 * Called from doGet() in PS Contribution Report.js.
 */
function buildAccessDeniedPage_(email) {
  const safeEmail = email
    ? email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>PS Dashboard — Access Restricted</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#F8FAFC;display:flex;align-items:center;
       justify-content:center;min-height:100vh}
  .card{background:#fff;border-radius:14px;padding:40px 48px;
        text-align:center;max-width:420px;width:90%;
        box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid #E2E8F0}
  .lock{font-size:40px;margin-bottom:16px}
  h1{font-size:18px;font-weight:800;color:#0F1941;margin-bottom:8px}
  p{color:#64748B;font-size:13px;line-height:1.65}
  .email{display:inline-block;margin-top:14px;background:#F1F5F9;
         border-radius:6px;padding:5px 12px;font-family:monospace;
         font-size:12px;color:#475569}
</style></head>
<body><div class="card">
  <div class="lock">🔒</div>
  <h1>Access Restricted</h1>
  <p>This dashboard is available to the PS team only.<br>
  Contact your manager or the report owner to request access.</p>
  ${safeEmail ? `<div class="email">${safeEmail}</div>` : ""}
</div></body></html>`;
}
