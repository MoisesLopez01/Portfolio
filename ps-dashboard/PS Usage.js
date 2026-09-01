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
