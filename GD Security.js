// ============================================================
// SCRIPT NAME: GD Security
// PURPOSE:     Email-based access control for the Goals Compliance
//              Dashboard (goalCompliance.js / GDash.html).
//
//              Independent of PS Security.js — separate GAS project,
//              own spreadsheet, own Script Properties keys. No code
//              is shared between the two projects.
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//  1. BOOTSTRAP ADMIN (below) — always Admin, cannot be removed via UI.
//  2. DEFAULT ADMINS / VIEWERS / DELEGATES (below) — hardcoded, always
//     active regardless of Script Properties. Edit this file to add
//     permanent stakeholders.
//  3. RUNTIME ACCESS — managed via the 🔒 Access Control page (☰ menu,
//     admin only), stored in Script Properties, additive on top of
//     the defaults above.
//
//  ROLES:
//    Admin   — full dashboard + can manage the access list
//    Viewer  — read-only, full company data
//    Manager — scoped to their own roster org tree (auto-detected via
//              the Roster's Supervisor field, or granted explicitly
//              via a Delegate entry)
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  SEC_GD_.OPEN_ACCESS_DEFAULT = true by default. This preserves the
//  dashboard's original "anyone in the company can view" behavior —
//  turning this to false is what actually starts gating access.
//  Manager checks run BEFORE the Open Access fallback, so flipping
//  Open Access off never silently promotes a scoped manager into a
//  full-roster viewer.
// ============================================================

var SEC_GD_ = {
  PROP_ADMINS:      "GD_DASH_ADMINS",
  PROP_VIEWERS:     "GD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "GD_DASH_OPEN_ACCESS",
  PROP_DELEGATES:   "GD_DASH_DELEGATES",

  // Always an Admin. Cannot be removed via the UI.
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // Always active — no UI step needed. Edit this file to grant
  // permanent access that survives a Script Properties reset.
  DEFAULT_ADMINS: [],
  DEFAULT_VIEWERS: [],

  // Manager-scoped access for people not in the Roster as supervisors.
  // Format: { email, scopeName } — scopeName is the full Roster name
  // of the supervisor whose org tree this person should see.
  DEFAULT_DELEGATES: [
    // { email: "peer@servicerocket.com", scopeName: "Juan Lopez" },
  ],

  // false = locked, true = anyone with the link sees the read-only dashboard.
  OPEN_ACCESS_DEFAULT: true,
};

// ── PRIVATE ──────────────────────────────────────────────────

/**
 * Reads the Roster sheet to check whether `email` belongs to an active
 * supervisor with at least one active direct report. Company-wide — no
 * Class/Department restriction (unlike PS Security's PS-only version),
 * since this dashboard covers every department.
 *
 * Self-contained: does not call into goalCompliance.js. Re-implements
 * the same termination-column auto-detection as getFullRosterMap_()
 * so this file has no cross-file dependency.
 *
 * @param {string} email - Lowercase, trimmed email.
 * @returns {string|null} The supervisor's canonical Name, or null.
 */
function _resolveRosterSupervisor_GD_(email) {
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty("ROSTER_SS_ID")
            || (typeof CONFIG_GD !== "undefined" ? CONFIG_GD.ROSTER_SS_ID : null);
    if (!ssId) return null;

    var sheet = SpreadsheetApp.openById(ssId).getSheetByName("Roster");
    if (!sheet) return null;

    var vals = sheet.getDataRange().getValues();
    if (vals.length < 2) return null;

    var headers = vals[0].map(function(h) { return String(h).trim(); });
    var idx     = function(col) { return headers.indexOf(col); };

    var iName  = idx("Name");
    var iEmail = idx("Email");
    var iSup   = idx("Supervisor");
    if (iName === -1 || iEmail === -1) return null;

    var termKey = null;
    headers.forEach(function(k) {
      var lower = k.toLowerCase().replace(/[\s._-]/g, "");
      if (!termKey   && /termination|termdate|enddate|exitdate/.test(lower))                        termKey   = k;
    });
    var iTerm   = termKey   ? idx(termKey)   : -1;

    var isActiveRow = function(row) {
      if (iTerm === -1) return true; // no termination column found — fail open (treat as active)
      var raw = row[iTerm];
      if (!raw) return true; // no termination date recorded — active
      var termDate = (raw instanceof Date) ? raw : new Date(raw);
      if (isNaN(termDate)) return true; // unparsable value — fail open
      return termDate > new Date(); // inactive once the termination date has arrived or passed
    };

    var dataRows = vals.slice(1);
    var supRow = null;
    for (var i = 0; i < dataRows.length; i++) {
      if (String(dataRows[i][iEmail] || "").toLowerCase().trim() === email) { supRow = dataRows[i]; break; }
    }
    if (!supRow) return null;

    var supervisorName = String(supRow[iName] || "").trim();
    if (!supervisorName) return null;

    var hasReports = dataRows.some(function(row) {
      return String(row[iSup] || "").trim() === supervisorName && isActiveRow(row);
    });

    return hasReports ? supervisorName : null;
  } catch (e) {
    Logger.log("⚠️ [_resolveRosterSupervisor_GD_] " + e.message);
    return null;
  }
}

function _readAccessLists_GD_() {
  var p = PropertiesService.getScriptProperties();

  var runtimeAdmins  = (p.getProperty(SEC_GD_.PROP_ADMINS)  || "")
    .split(",").map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);
  var runtimeViewers = (p.getProperty(SEC_GD_.PROP_VIEWERS) || "")
    .split(",").map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean);

  var runtimeDelegates = (p.getProperty(SEC_GD_.PROP_DELEGATES) || "")
    .split("\n")
    .map(function(line) {
      var sep = line.indexOf(":");
      if (sep === -1) return null;
      var email     = line.slice(0, sep).trim().toLowerCase();
      var scopeName = line.slice(sep + 1).trim();
      return (email && scopeName) ? { email: email, scopeName: scopeName } : null;
    })
    .filter(Boolean);

  var adminSet = {};
  [SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase()]
    .concat(SEC_GD_.DEFAULT_ADMINS.map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean))
    .concat(runtimeAdmins)
    .forEach(function(e) { adminSet[e] = true; });
  var admins = Object.keys(adminSet);

  var viewerSet = {};
  SEC_GD_.DEFAULT_VIEWERS.map(function(e) { return e.trim().toLowerCase(); }).filter(Boolean)
    .concat(runtimeViewers)
    .forEach(function(e) { viewerSet[e] = true; });
  var viewers = Object.keys(viewerSet);

  var delegateMap = {};
  SEC_GD_.DEFAULT_DELEGATES.forEach(function(d) { if (d.email && d.scopeName) delegateMap[d.email.toLowerCase()] = d.scopeName; });
  runtimeDelegates.forEach(function(d) { delegateMap[d.email] = d.scopeName; });
  var delegates = Object.keys(delegateMap).map(function(email) { return { email: email, scopeName: delegateMap[email] }; });

  var stored = p.getProperty(SEC_GD_.PROP_OPEN_ACCESS);
  var openAccess = stored !== null ? stored === "true" : SEC_GD_.OPEN_ACCESS_DEFAULT;

  return { admins: admins, viewers: viewers, openAccess: openAccess, delegates: delegates };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Returns the access status for the current session user.
 * @returns {{ allowed: boolean, role: 'admin'|'viewer'|'manager'|'denied', email: string, delegateScopeName?: string }}
 */
function checkDashboardAccess() {
  var email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  var lists = _readAccessLists_GD_();

  if (lists.admins.indexOf(email)  !== -1) return { allowed: true, role: "admin",  email: email };
  if (lists.viewers.indexOf(email) !== -1) return { allowed: true, role: "viewer", email: email };

  var delegate = lists.delegates.filter(function(d) { return d.email === email; })[0];
  if (delegate) return { allowed: true, role: "manager", email: email, delegateScopeName: delegate.scopeName };

  var supervisorName = _resolveRosterSupervisor_GD_(email);
  if (supervisorName) {
    Logger.log("GD Security: manager access (auto-roster): " + email + " → \"" + supervisorName + "\"");
    return { allowed: true, role: "manager", email: email, delegateScopeName: supervisorName };
  }

  if (lists.openAccess) return { allowed: true, role: "viewer", email: email };

  return { allowed: false, role: "denied", email: email };
}

/**
 * Returns the current access lists for the settings UI.
 * Admin-only — throws if the caller is not an admin.
 */
function getAccessSettings() {
  var access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  var lists = _readAccessLists_GD_();
  var editableAdmins = lists.admins.filter(function(e) { return e !== SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase(); });

  return {
    admins:         editableAdmins,
    viewers:        lists.viewers,
    openAccess:     lists.openAccess,
    delegates:      lists.delegates,
    bootstrapAdmin: SEC_GD_.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin-only — throws if the caller is not an admin.
 * @param {{ admins?: string[], viewers?: string[], openAccess?: boolean, delegates?: {email:string, scopeName:string}[] }} settings
 */
function saveAccessSettings(settings) {
  var access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");

  var p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.admins)) {
    var adminList = settings.admins
      .map(function(e) { return e.trim().toLowerCase(); })
      .filter(function(e) { return e.length > 0 && e !== SEC_GD_.BOOTSTRAP_ADMIN.toLowerCase(); });
    p.setProperty(SEC_GD_.PROP_ADMINS, adminList.join(","));
  }
  if (Array.isArray(settings.viewers)) {
    var viewerList = settings.viewers
      .map(function(e) { return e.trim().toLowerCase(); })
      .filter(function(e) { return e.length > 0; });
    p.setProperty(SEC_GD_.PROP_VIEWERS, viewerList.join(","));
  }
  if (Array.isArray(settings.delegates)) {
    var lines = settings.delegates
      .filter(function(d) { return d.email && d.scopeName; })
      .map(function(d) { return d.email.trim().toLowerCase() + ":" + d.scopeName.trim(); });
    p.setProperty(SEC_GD_.PROP_DELEGATES, lines.join("\n"));
  }
  if (typeof settings.openAccess === "boolean") {
    p.setProperty(SEC_GD_.PROP_OPEN_ACCESS, String(settings.openAccess));
  }

  Logger.log("GD Security: access settings updated by " + access.email);
  return { ok: true, savedAt: new Date().toISOString() };
}
