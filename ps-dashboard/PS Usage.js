// ============================================================
// PS USAGE — dashboard access trace + usage analytics.
// Spec: ps-dashboard/docs/specs/2026-09-01-usage-analytics-design.md
//
// Two halves:
//   logDashboardVisit_(access)  — one best-effort log row per doGet hit.
//   getUsageAnalytics()         — superadmin-only rollup for the 📶 tab.
//
// The log lives in the dashboard's OWN container spreadsheet ("PS Access Log"
// tab, beside "PS Settings"). The shared HRIS source spreadsheets are
// read-only by house rule and are never written.
// ============================================================

const USAGE_LOG_SHEET_   = "PS Access Log";
const USAGE_LOG_HEADERS_ = ["Timestamp", "Week", "Email", "Role", "Allowed", "Scope"];
const USAGE_WEEKS_       = 13;   // one quarter of ISO weeks, current week included

// "2026.W36" — the project's week-label convention (never "W36" alone).
// Reuses the report's ISO helpers; never a second week formatter.
function usageWeekLabel_(d) {
  return isoWeekYear_PS_(d) + ".W" + isoWeekNum_PS_(d);
}

// ISO weeks in a year (52 or 53): Dec 31 pinpoints the boundary precisely.
function usageWeeksInYear_(y) {
  const d = new Date(Date.UTC(y, 11, 31));
  return isoWeekYear_PS_(d) === y ? isoWeekNum_PS_(d) : 52;
}

// The n week labels ending at `currentWeek` ("YYYY.WN"), oldest first. Pure
// arithmetic — no Date "now" — so the rollup window is Node-testable.
function usageWeekWindow_(currentWeek, n) {
  const m = /^(\d{4})\.W(\d{1,2})$/.exec(String(currentWeek || ""));
  if (!m) return [];
  let y = +m[1], w = +m[2];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.unshift(y + ".W" + w);
    w--;
    if (w < 1) { y--; w = usageWeeksInYear_(y); }
  }
  return out;
}

// Pure rollup — no GAS services, Node-testable (tests/usage-analytics-checks.js).
//
//   logRows     [{ ts, week, email, role, allowed }]  ts = Date or ISO string
//   eligible    usageEligibleSet_() shape: email → { email, name, role, source }
//   currentWeek "2026.W36"
//
// Rules (spec §2): denied rows count in totalLoads/denied, never as engagement;
// blank-email rows aggregate into totals but attach to nobody; an eligible
// person's engagement counts only allowed visits; lastSeen/everVisited consider
// every row given, the weekly series only the USAGE_WEEKS_-week window.
function computeUsageRollup_(logRows, eligible, currentWeek) {
  const window = usageWeekWindow_(currentWeek, USAGE_WEEKS_);
  const last4  = window.slice(-4);

  const weekAgg = {};
  window.forEach(w => { weekAgg[w] = { week: w, uniques: {}, totalLoads: 0, denied: 0, byRole: {} }; });

  const perEmail = {};
  (logRows || []).forEach(r => {
    const email = String(r.email || "").toLowerCase().trim();
    const week  = String(r.week || "");
    const agg   = weekAgg[week];
    if (agg) {
      agg.totalLoads++;
      if (!r.allowed) { agg.denied++; return; }
      if (email) {
        agg.uniques[email] = true;
        const role = String(r.role || "?");
        agg.byRole[role] = (agg.byRole[role] || 0) + 1;
      }
    }
    if (!r.allowed || !email) return;
    const p = perEmail[email] ||
      (perEmail[email] = { lastSeen: null, lastSeenWeek: null, visitsThisWeek: 0, visits4Weeks: 0 });
    const t = +new Date(r.ts);
    if (!isNaN(t) && (p.lastSeen === null || t > p.lastSeen)) { p.lastSeen = t; p.lastSeenWeek = week; }
    if (week === currentWeek) p.visitsThisWeek++;
    if (last4.indexOf(week) !== -1) p.visits4Weeks++;
  });

  const weeks = window.map(w => ({
    week:           w,
    uniqueVisitors: Object.keys(weekAgg[w].uniques).length,
    totalLoads:     weekAgg[w].totalLoads,
    denied:         weekAgg[w].denied,
    byRole:         weekAgg[w].byRole,
  }));

  const people = Object.keys(eligible || {}).sort().map(email => {
    const e = eligible[email], p = perEmail[email];
    return {
      email: email, name: e.name, role: e.role, source: e.source,
      lastSeen:       p && p.lastSeen !== null ? new Date(p.lastSeen).toISOString() : null,
      lastSeenWeek:   p ? p.lastSeenWeek : null,
      visitsThisWeek: p ? p.visitsThisWeek : 0,
      visits4Weeks:   p ? p.visits4Weeks : 0,
      everVisited:    !!p,
    };
  });

  const engagedThisWeek = people.filter(p => p.visitsThisWeek > 0).length;
  const otherVisitors = Object.keys(perEmail).filter(e => !(eligible && eligible[e])).sort().map(e => ({
    email:          e,
    visitsThisWeek: perEmail[e].visitsThisWeek,
    lastSeen:       perEmail[e].lastSeen !== null ? new Date(perEmail[e].lastSeen).toISOString() : null,
  }));

  return {
    ok: true,
    currentWeek: currentWeek,
    weeks: weeks,
    people: people,
    coverage: {
      engagedThisWeek: engagedThisWeek,
      eligibleTotal:   people.length,
      pct: people.length ? Math.round(engagedThisWeek / people.length * 100) : 0,
    },
    otherVisitors: otherVisitors,
  };
}

// The complete potential audience — everyone on the five access lists, plus
// every active roster supervisor the CURRENT auto-access policy would actually
// admit (via the same _autoAccessAllows_ the gate uses; the audit must never
// call someone "expected" whom the door would turn away). List membership wins
// for the displayed role, mirroring checkDashboardAccess resolution order.
// @returns {Object} email → { email, name, role, source: 'list'|'auto-manager' }
function usageEligibleSet_() {
  const eligible = {};
  const lists  = _readAccessLists_();
  const roster = _readRosterForAccess_();
  const rows   = roster.ok ? roster.rows : [];

  const byEmail = {};
  rows.forEach(r => { if (r.email && r.active && !byEmail[r.email]) byEmail[r.email] = r; });

  const put = (email, role) => {
    const e = String(email || "").toLowerCase().trim();
    if (!e || eligible[e]) return;   // first (highest) tier wins
    const row = byEmail[e];
    eligible[e] = { email: e, name: row ? row.name : e, role: role, source: "list" };
  };
  lists.superAdmins.forEach(e => put(e, "superadmin"));
  lists.admins.forEach(e => put(e, "admin"));
  lists.orgAdmins.forEach(e => put(e, "orgadmin"));
  lists.viewers.forEach(e => put(e, "viewer"));
  lists.delegates.forEach(d => put(d.email, "manager"));

  if ((SEC_.MANAGER_AUTO_ACCESS || "any-org") !== "off" && roster.ok) {
    const reportCounts = {};
    rows.forEach(r => {
      if (r.active && r.normSupervisor && r.normSupervisor !== r.normName) {
        reportCounts[r.normSupervisor] = (reportCounts[r.normSupervisor] || 0) + 1;
      }
    });
    rows.forEach(r => {
      if (!r.email || !r.active || eligible[r.email]) return;
      if ((reportCounts[r.normName] || 0) < 1) return;
      if (r.onLeave && !SEC_.ALLOW_ONLEAVE_MANAGER) return;
      if (!_autoAccessAllows_(r).ok) return;
      eligible[r.email] = { email: r.email, name: r.name, role: "manager", source: "auto-manager" };
    });
  }
  return eligible;
}
