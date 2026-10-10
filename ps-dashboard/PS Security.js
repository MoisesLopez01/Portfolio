// ============================================================
// SCRIPT NAME: PS Security
// PURPOSE:     Email-based access control for the PS Dashboard.
//
// ── HOW ACCESS WORKS ─────────────────────────────────────────
//
//  There are THREE places where you grant access:
//
//  1. BOOTSTRAP SUPER ADMIN (below, SEC_.BOOTSTRAP_ADMIN)
//     Always has Super Admin access. Cannot be removed from the UI.
//     → This is you. Do not change.
//
//  2. DEFAULT SUPER ADMINS / ADMINS / VIEWERS (below, SEC_.DEFAULT_*)
//     Hardcoded in this file. These are always active regardless
//     of what is saved in Script Properties. Edit this list when
//     you want permanent access that survives a properties reset.
//     → Add PS leads, managers, or permanent stakeholders here.
//
//  3. RUNTIME ACCESS (Settings tab in the dashboard)
//     Any admin can add/remove emails via the ⚙ Settings tab
//     without touching this file. Those entries are stored in
//     Script Properties and are ADDITIVE on top of the defaults.
//     The Super Admin list is editable by Super Admins only.
//     → Use this for temporary access or viewer-only guests.
//
//  ROLES — POWERS and SCOPE are two separate axes. A role name answers both,
//  but the code asks them separately: hasAdminPower_/canManageAdmins_ for what
//  someone may DO, seesFullRoster_/isTeamScoped_ for what they may SEE.
//
//    Role         Sees                        Can change
//    ----------   -------------------------   ---------------------------------
//    Super Admin  everyone, all 3 teams       everything, incl. the Super list
//                 (incl. their OWN record)    — only role with 📈 Perf Record
//    Admin        everyone, all 3 teams       all settings + every access list
//    Org Admin    their org tree only         all settings + viewers/delegates
//                                             — NOT the Super/Admin/Org lists
//    Viewer       their own org team          nothing
//    Manager      their org tree only         nothing
//
//  Org Admin is the tier for a Director who should run the dashboard for their
//  own org without seeing their peers’. It is deliberately barred from the
//  admin lists: an org-scoped admin who could grant plain Admin would grant it
//  to themselves, and the scope would be worth nothing.
//
// ── SELF-EXCLUSION (2026-08-31) ──────────────────────────────
//  Nobody except a Super Admin sees their OWN record. A manager's
//  evaluation belongs to THEIR manager's dashboard, so the signed-in
//  user's roster row is removed from every payload — roster lists,
//  Performance Record, SI, scores and per-person drill-downs alike.
//  checkDashboardAccess() resolves `selfRosterName` for this; the strip
//  itself happens in applySelfExclusion_() (PS Contribution Report.js).
//
// ── OPEN ACCESS ──────────────────────────────────────────────
//  If SEC_.OPEN_ACCESS_DEFAULT = true, anyone with the link who is
//  not already an admin/viewer/manager falls through to read-only
//  "viewer" access (no email check). Managers are still resolved and
//  scoped to their own org tree FIRST — Open Access only catches
//  genuinely unidentified users. Use only for internal all-hands or
//  demo contexts. Flip back to false when done.
// ============================================================

const SEC_ = {
  PROP_SUPER_ADMINS: "PS_DASH_SUPER_ADMINS",
  PROP_ORG_ADMINS:  "PS_DASH_ORG_ADMINS",
  PROP_ADMINS:      "PS_DASH_ADMINS",
  PROP_VIEWERS:     "PS_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "PS_DASH_OPEN_ACCESS",
  PROP_DELEGATES:   "PS_DASH_DELEGATES",

  // ── 1. BOOTSTRAP SUPER ADMIN ───────────────────────────────
  // Always a Super Admin. Cannot be removed via the UI.
  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  // ── 2a. DEFAULT SUPER ADMINS ───────────────────────────────
  // Everything an Admin can do, PLUS: sight of their own record and
  // granting/revoking Super Admin.
  // These are always active — no UI step needed.
  DEFAULT_SUPER_ADMINS: [
    // "ps.director@servicerocket.com",      // sample — PS Director
  ],

  // ── 2b. DEFAULT ADMINS ─────────────────────────────────────
  // Full access + can manage the access list.
  // These are always active — no UI step needed.
  // Add one email per line as a string in the array.
  DEFAULT_ADMINS: [
    // "alex.lopez@servicerocket.com",       // sample — PS Director
    // "maria.santos@servicerocket.com",     // sample — PS Operations Lead
  ],

  // ── 2b-ii. DEFAULT ORG ADMINS ──────────────────────────────
  // Admin POWERS with a manager's SCOPE — the tier for a Director who should run
  // the dashboard for their own org without seeing their peers' orgs.
  //
  // Sees: their org tree only (direct reports and everyone beneath them), their
  //       own row excluded, exactly like a manager.
  // Can:  scoring weights, the scoring matrix, Gemini, Confluence publish, and
  //       the viewer + delegate access lists.
  // Cannot: see outside their tree, or edit the super/admin/org-admin lists —
  //       otherwise they could promote themselves to full Admin and the scope
  //       would be worth nothing. (📈 Performance Record IS open to them, on
  //       their own tree, own row excluded — same as a manager.)
  //
  // Requires an org tree: the person must be a roster supervisor, or they land on
  // the "nothing to show" page. Grant a non-supervisor plain Admin instead.
  DEFAULT_ORG_ADMINS: [
    // "gonzalo.riquelme@servicerocket.com",  // sample — PS Director, own org only
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

  // ── WHAT THE DENIED PAGE SAYS ──────────────────────────────
  // This is not a PS-team report any more: it is Global Contribution Access,
  // company-wide, limited to managers and above. The denied page is the only
  // thing most people who bounce off this link will ever read, so it has to name
  // the right audience and the right team to ask — kept here rather than inlined
  // so the server page and the in-app message cannot drift apart.
  PRODUCT_NAME:         "Global Contribution",
  ACCESS_AUDIENCE:      "managers and above",
  ACCESS_REQUEST_TEAM:  "WFP",
  // Optional. A mailto:, Slack channel or Confluence link for requests — rendered
  // as a button when set, omitted entirely when blank. Left empty rather than
  // guessed: a wrong address on the denied page is worse than none.
  ACCESS_REQUEST_LINK:  "",

  // Bumped by hand whenever this file changes in a way worth confirming is live.
  // diagnosePSAccess prints it, so the execution log answers "did my push and new
  // deployment version actually take?" without guessing from behaviour.
  BUILD: "2026.W36-usage",

  // ── Open Access default (false = locked, true = anyone with link) ──
  OPEN_ACCESS_DEFAULT: false,

  // Whether a supervisor on long leave (maternity / paternity / parental /
  // sabbatical) still auto-resolves into manager access. Default false: access
  // is a separate decision from visibility — grant it explicitly via
  // 🔒 Access Control when a particular person should keep it while away.
  ALLOW_ONLEAVE_MANAGER: false,

  // ── AUTO-MANAGER ACCESS ────────────────────────────────────
  // Who gets manager access WITHOUT anyone granting it, just by opening the link.
  //
  //   "any-org"  — any active roster member with ≥1 active direct report, in any
  //                org (Services, R&D, Sales & Success). This is the historical
  //                behaviour: a Finance manager who is forwarded the link is in,
  //                scoped to their own reports, with no approval step and no
  //                record beyond the execution log.
  //   "classes"  — same, but only for supervisors whose roster Class or
  //                Department appears in MANAGER_AUTO_ACCESS_SCOPE below.
  //   "off"      — nobody auto-resolves. Managers must be added explicitly as
  //                delegates via 🔒 Access Control. Tightest, and the only mode
  //                where the access list is the whole truth.
  //
  // The Google deployment setting ("Anyone within <domain>") is the only boundary
  // outside this one — it stops the public internet, not colleagues.
  MANAGER_AUTO_ACCESS: "any-org",

  // Only consulted when MANAGER_AUTO_ACCESS === "classes". Matched
  // case-insensitively against the roster's Class column first, then Department.
  MANAGER_AUTO_ACCESS_SCOPE: ["Professional Services"],
};

// Role tests — superadmin > admin > viewer/manager > denied. Everything that asks
// "can this role do X" goes through these two helpers rather than comparing role
// strings inline, so adding a tier never means hunting for missed
// `role === "admin"` checks. tests/access-tier-checks.js fails if one reappears.

/** True for superadmin only — sight of own record, super-list edits, open-access toggle. */
function isSuperAdmin_(roleOrAccess) {
  const r = (roleOrAccess && roleOrAccess.role) || roleOrAccess;
  return r === "superadmin";
}

/**
 * True for every role that may CHANGE things — superadmin, admin, orgadmin.
 * Powers and scope are separate axes: an orgadmin has full admin powers but a
 * manager's field of view, so this answers "may they act", never "what may they see".
 * For that, use seesFullRoster_ / isTeamScoped_.
 */
function hasAdminPower_(roleOrAccess) {
  const r = (roleOrAccess && roleOrAccess.role) || roleOrAccess;
  return r === "superadmin" || r === "admin" || r === "orgadmin";
}

/**
 * True for the roles that may edit the SUPER / ADMIN / ORG-ADMIN lists.
 *
 * Deliberately excludes orgadmin. An org-scoped admin who could grant plain Admin
 * would simply grant it to themselves, and their scope would mean nothing — so
 * they manage viewers and delegates only. (isSuperAdmin_ still gates the super
 * list on top of this.)
 */
function canManageAdmins_(roleOrAccess) {
  const r = (roleOrAccess && roleOrAccess.role) || roleOrAccess;
  return r === "superadmin" || r === "admin";
}

/**
 * True when this role is pinned to its OWN org team (Services / R&D / Sales &
 * Success) rather than the whole company — currently viewers only.
 *
 * A team-pinned caller still reads the shared per-team cache entry: that entry is
 * already "this team's people only", which is precisely the scope, so pinning
 * costs nothing in load time. The pin is enforced server-side in getPSReportData
 * (the requested teamKey is overridden, never merely validated) so a viewer
 * cannot widen their own view by asking for another team.
 */
function isTeamScoped_(roleOrAccess) {
  const r = (roleOrAccess && roleOrAccess.role) || roleOrAccess;
  return r === "viewer";
}

/**
 * Guard for MAINTENANCE entry points — the exporters, trigger installers and
 * name normalisers that are meant to be run from the GAS editor or a time
 * trigger, never from the web app.
 *
 * Why this exists: in Apps Script EVERY top-level function without a trailing
 * underscore is reachable via google.script.run by anyone the DEPLOYMENT admits
 * ("Anyone within <domain>") — an audience far wider than the dashboard's own
 * role gate. doGet() and getPSReportData() were gated; these were not. Before
 * this guard, a colleague holding the link could fire a full Tempo export, rewrite
 * the name columns of live sheets, or call storeCredentials() and overwrite the
 * working Tempo/Jira tokens with their literal "PASTE_..." placeholders — silently
 * breaking every export until someone noticed and re-pasted them.
 *
 * Deliberately list-only (Script Properties, no roster read), for two reasons:
 * maintenance rights never come from the roster — only manager scope does — and
 * an exporter should not pay for a spreadsheet read on every trigger run.
 *
 * Time triggers and editor runs both execute as the owner, who anchors the
 * super-admin list, so legitimate use is unaffected.
 *
 * Throws rather than returning, so a blocked call is loud in the execution log
 * and the caller is never handed half-finished work.
 *
 * @param {string} fnName - Name of the calling function, for the log line.
 * @returns {string} The authorised caller's email.
 */
function requireMaintainer_(fnName) {
  let email = "";
  try {
    email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  } catch (e) {
    Logger.log("⚠️ [requireMaintainer_] Session.getActiveUser() threw: " + e.message);
  }
  const { superAdmins, admins } = _readAccessLists_();
  const ok = !!email &&
    (superAdmins.indexOf(email) !== -1 || admins.indexOf(email) !== -1);
  if (!ok) {
    Logger.log("⛔ [" + fnName + "] BLOCKED — maintenance function, admin only. " +
               "Caller: " + (email || "(unidentified session)"));
    throw new Error("Not authorized: " + fnName + " is a maintenance function and " +
                    "can only be run by an admin from the Apps Script editor or a trigger.");
  }
  return email;
}

// ── PRIVATE ──────────────────────────────────────────────────

// Name normaliser — must match normPS_() in PS Contribution Report.js so a
// Supervisor cell and a Name cell that differ only in case or in double spaces
// still join. Kept local so this file stays readable on its own.
function _normName_(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// Per-execution memo of the access-relevant roster columns. One web-app request
// calls checkDashboardAccess() several times (doGet, then getPSReportData, then
// getScoringConfig …); without this the roster spreadsheet was re-opened and
// re-parsed on every single one of them.
var _SEC_ROSTER_MEMO_ = null;
// Per-execution memo of the resolved access verdict for the session user.
var _SEC_ACCESS_MEMO_ = null;

/** Clears both per-execution memos. Called after any access-list write. */
function _secResetMemo_() {
  _SEC_ROSTER_MEMO_ = null;
  _SEC_ACCESS_MEMO_ = null;
  _SEC_TEAMSCOPE_MEMO_ = null;
}

/**
 * Reads the access-relevant columns of the Roster spreadsheet, once per execution.
 *
 * The tab name comes from CONFIG_PS.SHEET_ROSTER — the same single source of truth
 * the report itself reads. Hardcoding "Roster" here is exactly what silently broke
 * every manager's access when that tab was renamed to "Data": getSheetByName()
 * returned null, the resolver returned null, and each manager fell straight through
 * to the Access Restricted page with nothing in the log to say why. The historical
 * names stay on as ordered fallbacks, and a miss now logs loudly.
 *
 * Column headers are matched flexibly for the same reason — a renamed "Email"
 * column must degrade into a logged error, never into a silent lockout.
 *
 * @returns {{ ok: boolean, rows: Object[], tab: (string|null), error: (string|null) }}
 *   rows = [{ name, normName, email, supervisor, normSupervisor, cls, dept,
 *             jobTitle, status, active, onLeave }]
 */
function _readRosterForAccess_() {
  if (_SEC_ROSTER_MEMO_) return _SEC_ROSTER_MEMO_;

  const fail = (error) => {
    Logger.log("❌ [PS Security] roster read failed — manager auto-access is OFF: " + error);
    _SEC_ROSTER_MEMO_ = { ok: false, rows: [], tab: null, error: error };
    return _SEC_ROSTER_MEMO_;
  };

  try {
    const ssId = PropertiesService.getScriptProperties().getProperty("ROSTER_SS_ID")
              || (typeof CONFIG_PS !== "undefined" ? CONFIG_PS.ROSTER_SS_ID : null);
    if (!ssId) return fail("no ROSTER_SS_ID in Script Properties and no CONFIG_PS fallback");

    const ss = SpreadsheetApp.openById(ssId);

    // Configured name first, then the names this tab has historically carried.
    const candidates = [
      (typeof CONFIG_PS !== "undefined" ? CONFIG_PS.SHEET_ROSTER : null),
      "Data", "Roster",
    ].filter(Boolean).filter((n, i, a) => a.indexOf(n) === i);

    let sheet = null, tab = null;
    for (const name of candidates) {
      const s = ss.getSheetByName(name);
      if (s) { sheet = s; tab = name; break; }
    }
    if (!sheet) {
      return fail("none of the roster tabs [" + candidates.join(", ") + "] exist in " + ssId +
                  ". Available: " + ss.getSheets().map(s => s.getName()).join(" | "));
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2) return fail('roster tab "' + tab + '" has no data rows');

    const raw     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    const headers = raw[0].map(h => String(h).trim());
    const lower   = headers.map(h => h.toLowerCase());

    // Exact header first, then a loose pattern — a renamed column degrades to a
    // logged error instead of a silent lockout.
    const pick = (exact, loose) => {
      const i = lower.indexOf(exact.toLowerCase());
      if (i !== -1) return i;
      return loose ? lower.findIndex(h => loose.test(h)) : -1;
    };

    const iName  = pick("Name",                     /^(full |employee )?name$/);
    const iEmail = pick("Email",                    /e-?mail/);
    const iSup   = pick("Supervisor",               /^supervisor|reports to/);
    const iStat  = pick("Employee Status",          /^employee status$|^status$/);
    const iTerm  = pick("Termination/Release Date", /terminat|release date/);
    // Only consulted by MANAGER_AUTO_ACCESS === "classes"; a missing column
    // there degrades to "no match", which is the safe direction.
    const iClass = pick("Class",                    /^class$/);
    const iDept  = pick("Department",               /^department$|^dept$/);
    // Job Title (and Department) feed teamForProfile_ for the Sales & Success
    // signal — JF004 outside the PS class, JF018 / Department "Sales" inside it.
    // See resolveTeamScope_.
    const iTitle = pick("Job Title",                /^job title$|^title$/);

    if (iName === -1 || iEmail === -1) {
      return fail('roster tab "' + tab + '" is missing a ' + (iName === -1 ? "Name" : "Email") +
                  " column (headers: " + headers.join(" | ") + ")");
    }
    if (iSup === -1) {
      Logger.log('⚠️ [PS Security] roster tab "' + tab + '" has no Supervisor column — ' +
                 "nobody will resolve as a manager (headers: " + headers.join(" | ") + ")");
    }

    // Terminated vs on long leave are two different decisions, so they get two
    // named patterns instead of one merged regex. TERMINATED always costs access;
    // LONG_LEAVE costs it only while SEC_.ALLOW_ONLEAVE_MANAGER is false.
    const TERMINATED_RE = /terminat|job offer|resign|left|inactive|former|offboard/i;
    const LONG_LEAVE_RE = /maternity|paternity|parental|sabbatical/i;

    const rows = raw.slice(1).map(r => {
      const name       = String(r[iName] || "").trim();
      const status     = iStat !== -1 ? String(r[iStat] || "").trim() : "";
      const term       = iTerm !== -1 ? String(r[iTerm] || "").trim() : "";
      const supervisor = iSup  !== -1 ? String(r[iSup]  || "").trim() : "";
      return {
        name:           name,
        normName:       _normName_(name),
        email:          String(r[iEmail] || "").toLowerCase().trim(),
        supervisor:     supervisor,
        normSupervisor: _normName_(supervisor),
        cls:            iClass !== -1 ? String(r[iClass] || "").trim() : "",
        dept:           iDept  !== -1 ? String(r[iDept]  || "").trim() : "",
        jobTitle:       iTitle !== -1 ? String(r[iTitle] || "").trim() : "",
        status:         status,
        active:         !(TERMINATED_RE.test(status) || term),
        onLeave:        !!status && LONG_LEAVE_RE.test(status),
      };
    }).filter(r => r.name);

    Logger.log('[PS Security] roster tab "' + tab + '": ' + rows.length + " rows, " +
               rows.filter(r => r.active).length + " active, " +
               rows.filter(r => r.email).length + " with an email.");

    _SEC_ROSTER_MEMO_ = { ok: true, rows: rows, tab: tab, error: null };
    return _SEC_ROSTER_MEMO_;
  } catch (e) {
    return fail(e.message);
  }
}

/**
 * Resolves whether `email` belongs to an active roster supervisor (any org —
 * Services, R&D, Sales & Success) and therefore earns manager-scoped access.
 *
 * A supervisor is someone who (a) is on the roster under this exact email,
 * (b) is active, and (c) has at least one active direct report other than
 * themselves. Condition (c) is what keeps a lone IC whose Supervisor cell
 * happens to name themselves out of manager access.
 *
 * NOTE on long leave: the report keeps long-leave rocketeers ON the roster,
 * badged and excluded from metrics. Access is a separate decision from
 * visibility, so by default a supervisor on extended leave does not auto-resolve
 * into manager access here — flip SEC_.ALLOW_ONLEAVE_MANAGER, or grant it
 * explicitly via 🔒 Access Control, when that is wanted for a particular person.
 *
 * @param {string} email - Lowercase email to check.
 * @returns {string|null} The supervisor's canonical roster Name, or null.
 */
/**
 * Does SEC_.MANAGER_AUTO_ACCESS let THIS roster row auto-resolve into manager
 * access? Shared by _resolveRosterSupervisor_ (which enforces it) and
 * diagnosePSAccess (which reports it) so the audit can never claim someone will
 * get in under a policy that would actually turn them away.
 *
 * @param {Object} row - A row from _readRosterForAccess_().
 * @returns {{ok: boolean, why: string}}
 */
function _autoAccessAllows_(row) {
  const mode = SEC_.MANAGER_AUTO_ACCESS || "any-org";
  if (mode === "off") {
    return { ok: false, why: 'SEC_.MANAGER_AUTO_ACCESS is "off" — grant access explicitly as a delegate' };
  }
  if (mode === "classes") {
    const scope = (SEC_.MANAGER_AUTO_ACCESS_SCOPE || []).map(s => String(s).trim().toLowerCase());
    const mine  = [row.cls, row.dept].map(v => String(v || "").trim().toLowerCase()).filter(Boolean);
    if (!mine.some(v => scope.indexOf(v) !== -1)) {
      return { ok: false, why: 'outside SEC_.MANAGER_AUTO_ACCESS_SCOPE (Class "' + (row.cls || "blank") +
                               '" / Dept "' + (row.dept || "blank") + '") — add them as a delegate' };
    }
  }
  return { ok: true, why: "" };
}

function _resolveRosterSupervisor_(email) {
  // An unidentified session (getActiveUser() returns "" outside the domain, or
  // when the deployment does not expose the caller) must never resolve. Without
  // this guard "" matched the first active roster row whose Email cell was blank
  // and handed an anonymous visitor that person's entire org tree.
  if (!email) return null;

  // Policy gate — see SEC_.MANAGER_AUTO_ACCESS. "off" means the access lists are
  // the whole truth and nobody lets themselves in by opening the link.
  if ((SEC_.MANAGER_AUTO_ACCESS || "any-org") === "off") return null;

  const roster = _readRosterForAccess_();
  if (!roster.ok) return null;

  const me = roster.rows.find(r => r.email && r.email === email && r.active);
  if (!me) return null;

  const policy = _autoAccessAllows_(me);
  if (!policy.ok) {
    Logger.log("[PS Security] " + email + " is a supervisor but " + policy.why);
    return null;
  }

  if (me.onLeave && !SEC_.ALLOW_ONLEAVE_MANAGER) {
    Logger.log("[PS Security] " + email + ' is an active supervisor but on long leave ("' +
               me.status + '") — manager auto-access withheld by policy.');
    return null;
  }

  const hasReports = roster.rows.some(r =>
    r.active && r.normSupervisor === me.normName && r.normName !== me.normName
  );
  if (!hasReports) {
    Logger.log("[PS Security] " + email +
               " is on the roster but has no active direct reports — not a manager.");
    return null;
  }

  return me.name;
}

/**
 * The signed-in user's own canonical roster Name, whatever their role.
 *
 * This is the anchor for self-exclusion: every role except Super Admin has this
 * person's row stripped from the report payload, because a rocketeer's own
 * evaluation belongs on their MANAGER's dashboard, not their own. Reads the same
 * per-execution roster memo the supervisor resolver uses, so it costs nothing
 * extra on a request that already resolved manager access.
 *
 * Deliberately does NOT require an active row's supervisor or reports — an admin
 * or viewer who happens to be on the roster is self-excluded just the same.
 *
 * @param {string} email - Lowercase email to look up.
 * @returns {string|null} Canonical roster Name, or null when not on the roster.
 */
function _resolveSelfRosterName_(email) {
  if (!email) return null;                       // unidentified session — nothing to strip
  const roster = _readRosterForAccess_();
  if (!roster.ok) {
    Logger.log("⚠️ [PS Security] roster unreadable — self-exclusion cannot resolve " + email);
    return null;
  }
  const me = roster.rows.find(r => r.email && r.email === email && r.active);
  return me ? me.name : null;
}

// Per-execution memo for resolveTeamScope_ — the job-catalog read below is worth
// doing at most once per request.
var _SEC_TEAMSCOPE_MEMO_ = null;

/**
 * The org team a team-scoped caller is PINNED to — "services" | "rnd" | "sales".
 *
 * Team membership is derived from the caller's own roster row, never configured:
 * teamForProfile_ (PS Teams.js) maps Class / Department / job family → team,
 * which is the same rule the report itself tags every roster row with. Deriving
 * rather than storing means the pin follows a person when they move org, with
 * nothing to keep in sync.
 *
 * The job catalog is always consulted (since 2026.W36): the PS class is no
 * longer Services by definition — Solution Architecture (JF018) sits in it and
 * belongs to Sales & Success — and every other class needs the JF004 / JF018
 * signal from the job title to tell Sales from R&D. Getting that wrong would show
 * someone the wrong team's data, so it is worth the read.
 *
 * @param {Object} access - A verdict from checkDashboardAccess().
 * @returns {string|null} Team key, or null when the caller is not on the roster
 *                        (an externally granted stakeholder — see the caller).
 */
function resolveTeamScope_(access) {
  if (!access || !access.allowed || !isTeamScoped_(access)) return null;
  if (_SEC_TEAMSCOPE_MEMO_ && _SEC_TEAMSCOPE_MEMO_.email === access.email) {
    return _SEC_TEAMSCOPE_MEMO_.team;
  }

  const remember = (team) => {
    _SEC_TEAMSCOPE_MEMO_ = { email: access.email, team: team };
    return team;
  };

  const roster = _readRosterForAccess_();
  if (!roster.ok) return remember(null);

  const me = roster.rows.find(r => r.email && r.email === access.email && r.active);
  if (!me) {
    Logger.log("[PS Security] " + access.email + " is a viewer but has no active roster row — " +
               "no team to pin them to; they keep the company-wide view.");
    return remember(null);
  }

  // No Class fast path any more (2026.W36): a PS-class row can be Solution
  // Architecture (JF018) and belong to Sales & Success, so the job catalog is
  // read for every pin. Getting this wrong would show a viewer the wrong team's
  // data — one catalog read per execution is worth it.
  let catalog = null;
  try {
    catalog = (typeof readJobCatalog_ === "function") ? readJobCatalog_() : null;
  } catch (e) {
    Logger.log("⚠️ [PS Security] job catalog unreadable while pinning " + access.email + ": " + e.message);
  }

  const team = teamForProfile_(
    { cls: me.cls, dept: me.dept, jobTitle: me.jobTitle, isCrewMember: false },
    catalog);
  Logger.log('[PS Security] Team pin: ' + access.email + ' (Class "' + me.cls +
             '", Title "' + me.jobTitle + '") → ' + team);
  return remember(team);
}

function _readAccessLists_() {
  const p = PropertiesService.getScriptProperties();

  // Runtime lists from Script Properties (managed via Settings tab)
  const runtimeSuperAdmins = (p.getProperty(SEC_.PROP_SUPER_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeOrgAdmins = (p.getProperty(SEC_.PROP_ORG_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
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
  // The bootstrap email anchors the SUPER admin list, not the admin list —
  // superadmin outranks admin, so it keeps every power it had before.
  const superAdmins = [...new Set([
    SEC_.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_.DEFAULT_SUPER_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeSuperAdmins,
  ])];

  // An email on both lists resolves as superadmin (checked first in
  // checkDashboardAccess) — filtered here so the Access Control UI never shows
  // the same person twice.
  const admins = [...new Set([
    ...SEC_.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])].filter(e => superAdmins.indexOf(e) === -1);

  // Org admins rank below admin, so an email on both resolves as the wider one
  // and is filtered out here — the UI must never show a person on two tiers.
  const orgAdmins = [...new Set([
    ...SEC_.DEFAULT_ORG_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeOrgAdmins,
  ])].filter(e => superAdmins.indexOf(e) === -1 && admins.indexOf(e) === -1);

  const viewers = [...new Set([
    ...SEC_.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])].filter(e => superAdmins.indexOf(e) === -1 && admins.indexOf(e) === -1 &&
                  orgAdmins.indexOf(e) === -1);

  // Delegates merged from code defaults + runtime; last runtime entry wins on duplicate email
  const delegateMap = new Map();
  SEC_.DEFAULT_DELEGATES.forEach(d => { if (d.email && d.scopeName) delegateMap.set(d.email.toLowerCase(), d.scopeName); });
  runtimeDelegates.forEach(d => delegateMap.set(d.email, d.scopeName));
  const delegates = [...delegateMap.entries()].map(([email, scopeName]) => ({ email, scopeName }));

  // Open access: Script Property overrides code default when explicitly set
  const stored = p.getProperty(SEC_.PROP_OPEN_ACCESS);
  const openAccess = stored !== null ? stored === "true" : SEC_.OPEN_ACCESS_DEFAULT;

  return { superAdmins, orgAdmins, admins, viewers, openAccess, delegates };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Resolves the access verdict for one email. Pure policy — no Session call — so
 * diagnosePSAccess() can ask "what would <manager> get?" without impersonation.
 *
 * @param {string} email - Already lowercased/trimmed. "" = unidentified session.
 * @returns {{ allowed: boolean, role: string, email: string,
 *             delegateScopeName?: string, reason: string }}
 */
function _resolveAccessFor_(email) {
  const { superAdmins, orgAdmins, admins, viewers, openAccess, delegates } = _readAccessLists_();

  // Every allowed verdict carries the caller's own roster identity so the report
  // can enforce self-exclusion without a second roster read. Resolved lazily —
  // an unidentified or denied session never touches the roster for it.
  const self = () => _resolveSelfRosterName_(email);

  // An unidentified caller can never be matched against any list, so resolve it
  // here rather than letting "" fall through and compare equal to blank cells.
  // This is also the signature of a mis-configured deployment: see the log line.
  if (!email) {
    Logger.log("⚠️ [PS Security] Session.getActiveUser().getEmail() is empty — the caller " +
               "cannot be identified. Check the deployment is 'Execute as: Me' + " +
               "'Who has access: Anyone within ServiceRocket'.");
    return openAccess
      ? { allowed: true,  role: "viewer", email: "", selfRosterName: null, reason: "open-access (unidentified session)" }
      : { allowed: false, role: "denied", email: "", selfRosterName: null, reason: "unidentified session (no email)" };
  }

  // Super admin is checked first — it outranks admin, and _readAccessLists_
  // already removes super admins from the admin list so the two never collide.
  if (superAdmins.includes(email)) {
    return { allowed: true, role: "superadmin", email, selfRosterName: self(), reason: "super-admin list" };
  }
  if (admins.includes(email))  return { allowed: true, role: "admin",  email, selfRosterName: self(), reason: "admin list" };

  // Org admin — admin powers, manager scope. The org tree is anchored on their
  // OWN roster name, so getPSReportData's manager branch works unchanged.
  // Without a roster row there is no tree to anchor: rather than silently hand
  // them the whole company (which is exactly what this tier exists to prevent),
  // refuse and say so. An off-roster person who needs this should be a plain Admin.
  if (orgAdmins.includes(email)) {
    const own = self();
    if (!own) {
      Logger.log("⚠️ [PS Security] " + email + " is an org admin but has no active roster row — " +
                 "there is no org tree to scope them to. Grant plain Admin instead, or fix the roster Email cell.");
      return { allowed: false, role: "denied", email, selfRosterName: null,
               reason: "org-admin with no roster row — no org tree to scope to" };
    }
    return { allowed: true, role: "orgadmin", email, selfRosterName: own,
             delegateScopeName: own, reason: "org-admin list" };
  }

  if (viewers.includes(email)) return { allowed: true, role: "viewer", email, selfRosterName: self(), reason: "viewer list" };

  // Manager checks run BEFORE the Open Access fallback so that turning on Open
  // Access never silently promotes a scoped manager into a full-roster viewer.
  // Only genuinely unidentified users fall through to the Open Access branch.

  // Explicit delegate: granted manager access with a named supervisor scope
  const delegate = delegates.find(d => d.email === email);
  if (delegate) {
    return { allowed: true, role: "manager", email, selfRosterName: self(),
             delegateScopeName: delegate.scopeName, reason: "delegate list" };
  }

  // Not in any explicit list — check whether this email is an active roster
  // supervisor. Reading the roster here gives a definitive answer so
  // doGet/getPSReportData never need to handle an ambiguous "potential" state.
  const supervisorName = _resolveRosterSupervisor_(email);
  if (supervisorName) {
    Logger.log('[PS Security] Manager access (auto-roster): ' + email + ' → "' + supervisorName + '"');
    return { allowed: true, role: "manager", email, selfRosterName: supervisorName,
             delegateScopeName: supervisorName, reason: "roster supervisor (auto)" };
  }

  // Open Access fallback — everyone not matched above sees the read-only dashboard.
  // Keep false for normal operation; flip on only for all-hands/demo contexts.
  if (openAccess) return { allowed: true, role: "viewer", email, selfRosterName: self(), reason: "open-access fallback" };

  const rosterErr = (_SEC_ROSTER_MEMO_ && !_SEC_ROSTER_MEMO_.ok) ? _SEC_ROSTER_MEMO_.error : null;
  Logger.log("[PS Security] DENIED " + email +
             (rosterErr ? " — roster unreadable: " + rosterErr : " — not on any list and not a roster supervisor"));
  return { allowed: false, role: "denied", email, selfRosterName: null,
           reason: rosterErr ? "roster unreadable: " + rosterErr : "no list match, no direct reports" };
}

/**
 * Returns the access status for the current session user.
 * Memoised per execution — a single page load calls this from doGet,
 * getPSReportData and getScoringConfig, and each call used to re-read the roster.
 *
 * @returns {{ allowed: boolean, role: 'admin'|'viewer'|'manager'|'denied', email: string, delegateScopeName?: string, reason: string }}
 */
function checkDashboardAccess() {
  if (_SEC_ACCESS_MEMO_) return _SEC_ACCESS_MEMO_;

  let email = "";
  try {
    email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  } catch (e) {
    // Some deployment/scope combinations throw instead of returning "".
    Logger.log("⚠️ [PS Security] Session.getActiveUser() threw: " + e.message);
  }

  _SEC_ACCESS_MEMO_ = _resolveAccessFor_(email);
  return _SEC_ACCESS_MEMO_;
}

/**
 * What the current caller resolves to. Safe for anyone to call — it only ever
 * reports on the caller's own session, never on anyone else's.
 * @returns {{ email: string, role: string, allowed: boolean, scopeName: (string|null), reason: string }}
 */
function whoAmI() {
  const a = checkDashboardAccess();
  return {
    email:     a.email,
    role:      a.role,
    allowed:   a.allowed,
    scopeName: a.delegateScopeName || null,
    reason:    a.reason || "",
  };
}

// ── 👁 VIEW AS — super-admin impersonation of the REPORT view ─────────────────
// Answers "what does this manager / director actually see?" without borrowing
// their browser. Only getPSReportData honours a target: every settings endpoint
// keeps resolving the real caller, so the preview can never write as someone else.
// Spec: docs/specs/2026-09-01-view-as-impersonation-design.md

/**
 * Swap the caller's verdict for the TARGET's, for the report payload only.
 *
 * Resolves the target through _resolveAccessFor_ — the very path their own login
 * takes — so team pins, org-tree scope, self-exclusion and denial reasons all come
 * out exactly as they would for that person. The caller's own memoised verdict is
 * left untouched.
 *
 * Throws (never silently ignores) when a non-super-admin posts a target: a plain
 * Admin trying `viewAs` is a privilege probe and belongs in the execution log.
 *
 * @param {Object} callerAccess - checkDashboardAccess() verdict for the real caller.
 * @param {string} [viewAsEmail] - Target email; empty/null = no impersonation.
 * @returns {Object} callerAccess unchanged, or the target's verdict stamped with
 *          `viewAs: { email, name, role, allowed, reason, byEmail }`.
 */
function resolveViewAsAccess_(callerAccess, viewAsEmail) {
  const target = String(viewAsEmail || "").toLowerCase().trim();
  if (!target) return callerAccess;

  if (!callerAccess || !callerAccess.allowed || !isSuperAdmin_(callerAccess)) {
    Logger.log("⛔ [PS Security] View-as BLOCKED — " + ((callerAccess && callerAccess.email) || "(unidentified)") +
               " (" + ((callerAccess && callerAccess.role) || "denied") + ") asked to view as " + target);
    throw new Error("Unauthorized: 'View as' is available to super admins only.");
  }
  if (target === callerAccess.email) return callerAccess;

  const verdict = _resolveAccessFor_(target);
  const out = Object.assign({}, verdict, {
    viewAs: {
      email:   target,
      name:    verdict.selfRosterName || verdict.delegateScopeName || null,
      role:    verdict.role,
      allowed: verdict.allowed,
      reason:  verdict.reason || "",
      byEmail: callerAccess.email,
    },
  });
  Logger.log("👁 [PS Security] View-as: " + callerAccess.email + " → " + target +
             " resolves to " + verdict.role + (verdict.allowed ? "" : " (DENIED)") +
             (verdict.delegateScopeName ? ' scoped to "' + verdict.delegateScopeName + '"' : "") +
             " — " + verdict.reason);
  return out;
}

/**
 * The people a super admin can preview the dashboard as.
 *
 * Every active roster supervisor (≥1 active direct report, has an email) plus
 * everyone on an access list — each resolved once through the real access path,
 * so the picker can say up front what role and scope a pick will land on, and
 * flag those who would be DENIED (their denial page is worth previewing too).
 *
 * Super admin only: this is company-wide people data (names, emails, report
 * counts, resolved access), the same width as diagnosePSAccess.
 *
 * @returns {{ targets: Object[], count: number }}
 */
function listViewAsTargets() {
  const caller = checkDashboardAccess();
  if (!caller.allowed || !isSuperAdmin_(caller)) {
    Logger.log("⛔ [listViewAsTargets] BLOCKED — super-admin only. Caller: " +
               (caller.email || "(unidentified)") + " (" + caller.role + ")");
    throw new Error("Unauthorized: 'View as' is available to super admins only.");
  }

  const roster = _readRosterForAccess_();
  const lists  = _readAccessLists_();
  const rows   = roster.ok ? roster.rows : [];

  // Active direct-report counts per supervisor (normalised name).
  const reportsBySup = new Map();
  rows.forEach(r => {
    if (!r.active || !r.normSupervisor || r.normSupervisor === r.normName) return;
    reportsBySup.set(r.normSupervisor, (reportsBySup.get(r.normSupervisor) || 0) + 1);
  });

  // email → { source } — roster supervisors first, then every list.
  const cand = new Map();
  const add = (email, source) => {
    const e = String(email || "").toLowerCase().trim();
    if (!e || e === caller.email) return;
    if (!cand.has(e)) cand.set(e, { source });
  };
  rows.forEach(r => {
    if (r.active && r.email && reportsBySup.get(r.normName)) add(r.email, "roster supervisor");
  });
  lists.superAdmins.forEach(e => add(e, "super-admin list"));
  lists.admins.forEach(e => add(e, "admin list"));
  lists.orgAdmins.forEach(e => add(e, "org-admin list"));
  lists.viewers.forEach(e => add(e, "viewer list"));
  lists.delegates.forEach(d => add(d.email, "delegate list"));

  const RANK = { orgadmin: 0, manager: 1, admin: 2, viewer: 3, superadmin: 4, denied: 5 };
  const targets = [];
  cand.forEach((info, email) => {
    const v   = _resolveAccessFor_(email);
    const row = rows.find(r => r.email === email && r.active) || rows.find(r => r.email === email) || null;
    const savedPin = _SEC_TEAMSCOPE_MEMO_;
    const pin = resolveTeamScope_(v);
    _SEC_TEAMSCOPE_MEMO_ = savedPin;
    targets.push({
      email,
      name:          row ? row.name : (v.delegateScopeName ? "(delegate for " + v.delegateScopeName + ")" : email),
      jobTitle:      row ? row.jobTitle : "",
      directReports: row ? (reportsBySup.get(row.normName) || 0) : 0,
      role:          v.role,
      allowed:       v.allowed,
      reason:        v.reason || "",
      scopeName:     v.delegateScopeName || null,
      teamPin:       pin || null,
      source:        info.source,
    });
  });
  targets.sort((a, b) =>
    (RANK[a.role] !== undefined ? RANK[a.role] : 9) - (RANK[b.role] !== undefined ? RANK[b.role] : 9) ||
    b.directReports - a.directReports ||
    a.name.localeCompare(b.name));

  Logger.log("👁 [listViewAsTargets] " + targets.length + " candidates for " + caller.email);
  return { targets, count: targets.length, rosterOk: roster.ok, rosterError: roster.error || null };
}

/**
 * Access diagnostics. Run from the GAS editor (as the owner) to answer
 * "why doesn't <manager> get their org when I share the link?" without having to
 * borrow their browser.
 *
 * With no argument it audits the whole roster: which tab was read, how many
 * supervisors there are, and — the list that matters — every supervisor who will
 * be DENIED, with the reason. Pass an email to trace that one person.
 *
 * Admin-only: it reports on other people's access.
 *
 * @param {string} [email] - Optional single email to trace.
 * @returns {Object} Structured result; also written to the execution log.
 */
/**
 * Trace ONE person's access — the editor-runnable form of diagnosePSAccess(email).
 *
 * The GAS Run dropdown cannot pass arguments: it always calls the selected
 * function with none. So `diagnosePSAccess("someone@…")` typed into the editor is
 * not runnable at all, and selecting diagnosePSAccess from the dropdown silently
 * runs the whole-roster audit instead — which looks like the trace "not working".
 *
 * Two ways to use this, no code edit needed for the second:
 *   1. Set Script Property  PS_TRACE_EMAIL = the address to trace, or
 *   2. Edit FALLBACK_EMAIL below.
 * Then pick `traceAccess` in the Run dropdown.
 *
 * Admin-only, same as diagnosePSAccess — it reports on someone else's access.
 *
 * @returns {Object} The same structure diagnosePSAccess(email) returns.
 */
function traceAccess() {
  const FALLBACK_EMAIL = "";   // ← or put an address here instead of the property

  // Gated directly as well as via diagnosePSAccess: every non-underscore global
  // is a google.script.run endpoint, and the callable-surface sweep expects the
  // check to be visible in the function that is reachable, not one call deeper.
  const caller = checkDashboardAccess();
  if (!hasAdminPower_(caller)) throw new Error("Unauthorized: admin access required.");

  const email = (PropertiesService.getScriptProperties().getProperty("PS_TRACE_EMAIL") ||
                 FALLBACK_EMAIL || "").trim();
  if (!email) {
    Logger.log('❌ [traceAccess] No address to trace. Either set Script Property ' +
               '"PS_TRACE_EMAIL" to the person you want to check, or fill in ' +
               'FALLBACK_EMAIL at the top of traceAccess(). ' +
               'Run diagnosePSAccess (no argument) for the whole-roster audit instead.');
    return { ok: false, error: "no PS_TRACE_EMAIL set" };
  }
  return diagnosePSAccess(email);
}

function diagnosePSAccess(email) {
  const caller = checkDashboardAccess();
  // canManageAdmins_, NOT hasAdminPower_. This function's output is company-wide
  // people data: every supervisor's name, email and report count, plus — on the
  // single-email path — any employee's roster name, active flag and LONG-LEAVE
  // status. An orgadmin has admin powers but a manager's field of view, and this
  // is the widest read in the file; handing it to them would undo the scope the
  // tier exists to enforce. Both roles that keep it (superadmin, admin) already
  // see the whole roster, so it tells them nothing they cannot already read.
  if (!canManageAdmins_(caller)) {
    Logger.log(`⛔ [diagnosePSAccess] BLOCKED — company-wide access audit, ` +
               `not available to role "${caller.role}". Caller: ${caller.email}`);
    throw new Error("Unauthorized: the access audit is company-wide and requires " +
                    "full-roster admin access.");
  }

  const roster = _readRosterForAccess_();
  const lists  = _readAccessLists_();
  const out = {
    build:          SEC_.BUILD || null,
    rosterTab:      roster.tab,
    rosterOk:       roster.ok,
    rosterError:    roster.error,
    rosterRows:     roster.rows.length,
    activeRows:     roster.rows.filter(r => r.active).length,
    rowsWithEmail:  roster.rows.filter(r => r.email).length,
    openAccess:     lists.openAccess,
    admins:         lists.admins.length,
    viewers:        lists.viewers.length,
    delegates:      lists.delegates.length,
  };

  Logger.log("=== PS ACCESS DIAGNOSTICS ===  build " + (SEC_.BUILD || "(unset)"));
  Logger.log("Roster tab read:   " + (roster.ok ? roster.tab : "FAILED — " + roster.error));
  Logger.log("Rows:              " + out.rosterRows + " total, " + out.activeRows +
             " active, " + out.rowsWithEmail + " with an email");
  Logger.log("Open access:       " + out.openAccess);
  Logger.log("Lists:             " + out.admins + " admins, " + out.viewers +
             " viewers, " + out.delegates + " delegates");

  // Single-email trace
  if (email) {
    const e = String(email).toLowerCase().trim();
    // Resolve against policy without touching the session memo.
    const savedRoster = _SEC_ROSTER_MEMO_;
    const verdict = _resolveAccessFor_(e);
    _SEC_ROSTER_MEMO_ = savedRoster;
    const row = roster.rows.find(r => r.email === e);
    // Which org team this verdict lands on. Only team-scoped roles are pinned;
    // for everyone else the answer is genuinely "all of them", and saying so is
    // the point of the trace — role alone no longer describes what someone sees.
    const savedPin = _SEC_TEAMSCOPE_MEMO_;
    const pin = resolveTeamScope_(verdict);
    _SEC_TEAMSCOPE_MEMO_ = savedPin;

    out.trace = {
      email:     e,
      role:      verdict.role,
      allowed:   verdict.allowed,
      scopeName: verdict.delegateScopeName || null,
      reason:    verdict.reason,
      onRoster:  !!row,
      rosterName: row ? row.name : null,
      active:     row ? row.active : null,
      onLeave:    row ? row.onLeave : null,
      status:     row ? row.status : null,
      cls:        row ? row.cls : null,
      // Three genuinely different answers, and calling them all "all teams" reads
      // as "sees the whole company" for the two roles that do not. A manager or
      // org admin is not pinned, but their teams are still only the ones their org
      // tree happens to span — which this function cannot know without loading the
      // report roster, so it says where the answer comes from instead of guessing.
      teamScope:  !verdict.allowed        ? "n/a"
                : isTeamScoped_(verdict)  ? (pin || "ALL — not on the roster, cannot be pinned")
                : seesFullRoster_(verdict) ? "all 3 teams (company-wide)"
                : "whichever teams their org tree spans (not pinned)",
      directReports: row
        ? roster.rows.filter(r => r.active && r.normSupervisor === row.normName &&
                                  r.normName !== row.normName).length
        : 0,
    };
    Logger.log("--- trace: " + e + " ---");
    Logger.log("  role: " + out.trace.role + " (" + out.trace.reason + ")");
    Logger.log("  roster name: " + (out.trace.rosterName || "NOT ON ROSTER") +
               " | active: " + out.trace.active + " | on leave: " + out.trace.onLeave +
               " | status: " + (out.trace.status || "(blank)"));
    Logger.log("  class: " + (out.trace.cls || "(blank)") + " | team scope: " + out.trace.teamScope);
    Logger.log("  active direct reports: " + out.trace.directReports);
    Logger.log("  org-tree scope: " + (out.trace.scopeName || "n/a") +
               (verdict.role === "manager" ? " (their own row excluded)" : ""));
    return out;
  }

  // ── Who is on a list, and what will they ACTUALLY see? ──────────────────────
  // Being on the admin or viewer list overrides roster auto-resolution, so a
  // supervisor added as an "admin" silently loses their org scope and gains the
  // whole company. That is invisible in the lists themselves — this prints it.
  const listAudit = [];
  const noteList = (label, emails) => emails.forEach(e => {
    const savedRoster = _SEC_ROSTER_MEMO_;
    const savedPin    = _SEC_TEAMSCOPE_MEMO_;
    const v = _resolveAccessFor_(e);
    _SEC_ROSTER_MEMO_    = savedRoster;
    const pin = resolveTeamScope_(v);
    _SEC_TEAMSCOPE_MEMO_ = savedPin;

    const row = roster.rows.find(r => r.email === e);
    const reports = row
      ? roster.rows.filter(r => r.active && r.normSupervisor === row.normName &&
                                r.normName !== row.normName).length
      : 0;
    listAudit.push({
      list: label, email: e, role: v.role,
      people: v.role === "manager" || v.role === "orgadmin"
        ? 'org tree of "' + (v.delegateScopeName || "?") + '"'
        : "EVERYONE",
      teams: isTeamScoped_(v) ? (pin || "all (not on roster)") : "all teams",
      directReports: reports,
      note: (reports > 0 && (v.role === "admin" || v.role === "superadmin"))
        ? "⚠️ supervisor of " + reports + " — on a company-wide tier, so their org scope is discarded"
        : "",
    });
  });
  noteList("super", lists.superAdmins);
  noteList("admin", lists.admins);
  noteList("orgadmin", lists.orgAdmins);
  noteList("viewer", lists.viewers);
  out.listAudit = listAudit;

  Logger.log("--- who is on a list, and what they will see (" + listAudit.length + ") ---");
  listAudit.forEach(a => Logger.log(
    "  [" + a.list + "] " + a.email + " → role " + a.role +
    " | people: " + a.people + " | teams: " + a.teams +
    (a.note ? "\n      " + a.note : "")));

  // Full audit: every supervisor and whether the shared link will work for them.
  const bySup = new Map();   // normName → count of active reports
  roster.rows.forEach(r => {
    if (!r.active || !r.normSupervisor) return;
    bySup.set(r.normSupervisor, (bySup.get(r.normSupervisor) || 0) + 1);
  });

  const granted = [], blocked = [];
  bySup.forEach((reports, supNorm) => {
    const row = roster.rows.find(r => r.normName === supNorm);
    const entry = { name: row ? row.name : supNorm, email: row ? row.email : "", reports };
    if (!row) {
      entry.why = "named as Supervisor but not a roster row (off-roster manager) — add a delegate";
      blocked.push(entry);
    } else if (!row.active) {
      entry.why = "roster row is inactive (status: " + (row.status || "blank") + " / termination date)";
      blocked.push(entry);
    } else if (!row.email) {
      entry.why = "roster Email cell is blank — nothing to match the session against";
      blocked.push(entry);
    } else if (row.onLeave && !SEC_.ALLOW_ONLEAVE_MANAGER) {
      entry.why = "on long leave (" + row.status + ") — withheld by SEC_.ALLOW_ONLEAVE_MANAGER";
      blocked.push(entry);
    } else {
      // The auto-access policy has the last word. Without this the audit would
      // report ✅ for every supervisor even with MANAGER_AUTO_ACCESS set to
      // "off" — telling you the link works for people it would turn away.
      const policy = _autoAccessAllows_(row);
      if (policy.ok) { granted.push(entry); }
      else { entry.why = policy.why; blocked.push(entry); }
    }
  });

  granted.sort((a, b) => b.reports - a.reports);
  blocked.sort((a, b) => b.reports - a.reports);
  out.supervisorsGranted = granted;
  out.supervisorsBlocked = blocked;

  Logger.log("--- supervisors who WILL get manager access (" + granted.length + ") ---");
  granted.forEach(s => Logger.log("  ✅ " + s.name + " <" + s.email + "> — " + s.reports + " reports"));
  Logger.log("--- supervisors who will be DENIED (" + blocked.length + ") ---");
  blocked.forEach(s => Logger.log("  ❌ " + s.name + " <" + (s.email || "no email") + "> — " +
                                  s.reports + " reports — " + s.why));
  Logger.log("=== end ===");
  return out;
}

/**
 * Returns the current access lists for the settings UI.
 * Admin or Super Admin — throws for anyone else.
 *
 * The Super Admin list is returned to plain Admins too (who holds the keys is
 * not a secret worth hiding from an Admin), but `canManageSuperAdmins` is false
 * for them and saveAccessSettings rejects any super-list write they attempt —
 * the UI's disabled textarea is a courtesy, not the control.
 */
function getAccessSettings() {
  const access = checkDashboardAccess();
  if (!hasAdminPower_(access)) throw new Error("Unauthorized: admin access required.");

  const { superAdmins, orgAdmins, admins, viewers, openAccess, delegates } = _readAccessLists_();
  const editableSupers = superAdmins.filter(e => e !== SEC_.BOOTSTRAP_ADMIN.toLowerCase());

  // Withholding, not just locking. canManageAdmins_ already stops an orgadmin
  // EDITING the three company-wide tiers, but sending the lists and merely
  // disabling the cards still discloses who every super admin and admin is — one
  // devtools glance, or one hand-rolled google.script.run.getAccessSettings(),
  // away. The tier is documented as "NOT the Super/Admin/Org lists", so it must
  // not receive them either. Empty arrays rather than omitted keys keeps the
  // client's render path uniform; canManageAdmins tells it the cards are read-only.
  const seesAdminTiers = canManageAdmins_(access);
  if (!seesAdminTiers) {
    Logger.log(`[PS Security] Admin-tier lists withheld from ${access.email} (${access.role}).`);
  }

  return {
    superAdmins:    seesAdminTiers ? editableSupers : [],
    orgAdmins:      seesAdminTiers ? orgAdmins      : [],
    admins:         seesAdminTiers ? admins         : [],
    viewers,
    openAccess,
    delegates,
    bootstrapAdmin: SEC_.BOOTSTRAP_ADMIN,
    callerEmail:    access.email,
    callerRole:     access.role,
    canManageSuperAdmins: isSuperAdmin_(access),
    // Org admins may run their own org but must not be able to hand themselves —
    // or anyone else — the company-wide tiers. False for them, true for the rest.
    canManageAdmins:      canManageAdmins_(access),
    // Separate capability rather than reusing canManageSuperAdmins: they happen to
    // resolve identically today, but they are two different grants and the client
    // must not have to know they coincide.
    canManageOpenAccess:  isSuperAdmin_(access),
  };
}

/**
 * Saves updated access lists to Script Properties.
 * Admin or Super Admin — throws for anyone else.
 *
 * `superAdmins` is honoured for Super Admins only: a plain Admin who posts one
 * (hand-rolled google.script.run included) is rejected outright rather than
 * silently ignored, so a failed privilege escalation is visible, not quiet.
 *
 * @param {{ superAdmins?: string[], admins?: string[], viewers?: string[], openAccess?: boolean, delegates?: {email:string, scopeName:string}[] }} settings
 */
function saveAccessSettings(settings) {
  const access = checkDashboardAccess();
  if (!hasAdminPower_(access)) throw new Error("Unauthorized: admin access required.");

  const p = PropertiesService.getScriptProperties();

  if (Array.isArray(settings.superAdmins)) {
    if (!isSuperAdmin_(access)) {
      Logger.log(`⚠️ PS Security: ${access.email} (${access.role}) tried to edit the Super Admin list — rejected.`);
      throw new Error("Unauthorized: only a Super Admin can change the Super Admin list.");
    }
    // The bootstrap super admin is filtered out on the way in — it lives in code
    // and is re-added by _readAccessLists_, so it can never be removed here.
    const list = settings.superAdmins
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e !== SEC_.BOOTSTRAP_ADMIN.toLowerCase());
    p.setProperty(SEC_.PROP_SUPER_ADMINS, list.join(","));
  }
  if (Array.isArray(settings.orgAdmins)) {
    if (!canManageAdmins_(access)) {
      Logger.log(`⚠️ PS Security: ${access.email} (${access.role}) tried to edit the Org Admin list — rejected.`);
      throw new Error("Unauthorized: an Org Admin cannot change the Org Admin list.");
    }
    const list = settings.orgAdmins
      .map(e => e.trim().toLowerCase())
      .filter(e => e.length > 0 && e !== SEC_.BOOTSTRAP_ADMIN.toLowerCase());
    p.setProperty(SEC_.PROP_ORG_ADMINS, list.join(","));
  }
  if (Array.isArray(settings.admins)) {
    // Same reasoning as the org-admin list: this is the escalation path, so it is
    // closed to the one role whose whole point is a narrower field of view.
    if (!canManageAdmins_(access)) {
      Logger.log(`⚠️ PS Security: ${access.email} (${access.role}) tried to edit the Admin list — rejected.`);
      throw new Error("Unauthorized: an Org Admin cannot change the Admin list.");
    }
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
    // SUPER ADMIN ONLY. Open Access is the single switch that drops the email
    // check for the whole dashboard — one click turns a scoped, per-manager view
    // into read-only company-wide data for anyone holding the link. That is a
    // wider grant than any individual entry on the admin/viewer lists, so it sits
    // at the same tier as editing the Super Admin list, not with routine
    // list maintenance. Throws (rather than ignoring the field) so a plain Admin's
    // attempt fails visibly instead of appearing to save and silently doing nothing.
    if (!isSuperAdmin_(access)) {
      Logger.log(`⚠️ PS Security: ${access.email} (${access.role}) tried to set Open Access ` +
                 `to ${settings.openAccess} — rejected, Super Admin only.`);
      throw new Error("Unauthorized: only a Super Admin can change Open Access.");
    }
    p.setProperty(SEC_.PROP_OPEN_ACCESS, String(settings.openAccess));
    Logger.log(`🔓 PS Security: Open Access set to ${settings.openAccess} by ${access.email}`);
  }

  // The verdict memo now describes the pre-save world — drop it so anything
  // later in this execution re-resolves against what was just written.
  _secResetMemo_();

  Logger.log(`PS Security: access settings updated by ${access.email} (${access.role})`);
  return { ok: true, savedAt: new Date().toISOString() };
}

/**
 * Returns a minimal HTML page shown to denied users.
 * Called from doGet() in PS Contribution Report.js.
 */
/**
 * The denied-page wording, as data, for the in-app message to render.
 *
 * doGet serves buildAccessDeniedPage_ before any JS runs; getPSReportData can
 * ALSO deny later (a manager whose org tree turns out to be empty, say), and that
 * one is drawn by the client. Both read these same constants so the two screens
 * can never tell people different things.
 */
function accessDeniedInfo_() {
  return {
    product:  SEC_.PRODUCT_NAME        || "Contribution",
    audience: SEC_.ACCESS_AUDIENCE     || "managers and above",
    team:     SEC_.ACCESS_REQUEST_TEAM || "the report owner",
    link:     String(SEC_.ACCESS_REQUEST_LINK || "").trim(),
  };
}

function buildAccessDeniedPage_(email) {
  const safeEmail = email
    ? email.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    : "";
  const esc_ = s => String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const product  = esc_(SEC_.PRODUCT_NAME        || "Contribution");
  const audience = esc_(SEC_.ACCESS_AUDIENCE     || "managers and above");
  const team     = esc_(SEC_.ACCESS_REQUEST_TEAM || "the report owner");
  const link     = String(SEC_.ACCESS_REQUEST_LINK || "").trim();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${product} — Access Restricted</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
       background:#F8FAFC;display:flex;align-items:center;
       justify-content:center;min-height:100vh;padding:20px}
  .card{background:#fff;border-radius:14px;padding:40px 48px;
        text-align:center;max-width:460px;width:100%;
        box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid #E2E8F0}
  .lock{font-size:40px;margin-bottom:16px}
  h1{font-size:18px;font-weight:800;color:#0F1941;margin-bottom:10px}
  p{color:#64748B;font-size:13px;line-height:1.7}
  .who{margin-top:14px;background:#F8FAFC;border:1px solid #E2E8F0;
       border-radius:8px;padding:12px 16px;font-size:12.5px;
       color:#475569;line-height:1.7;text-align:left}
  .who strong{color:#0F1941}
  .cta{display:inline-block;margin-top:16px;background:#0F1941;color:#fff;
       text-decoration:none;border-radius:8px;padding:9px 20px;
       font-size:12.5px;font-weight:700}
  .email{display:inline-block;margin-top:16px;background:#F1F5F9;
         border-radius:6px;padding:5px 12px;font-family:monospace;
         font-size:12px;color:#475569}
</style></head>
<body><div class="card">
  <div class="lock">🔒</div>
  <h1>Access Restricted</h1>
  <p><strong>${product} Access</strong> is company-wide but limited to ${audience}.</p>
  <div class="who">
    You reach this page when your account is not on an access list and you have no
    active direct reports on the roster.<br>
    <strong>Request access from the ${team} team.</strong>
  </div>
  ${link ? `<a class="cta" href="${esc_(link)}">Request access</a>` : ""}
  ${safeEmail ? `<div class="email">${safeEmail}</div>` : ""}
</div></body></html>`;
}
