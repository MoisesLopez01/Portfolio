// ============================================================
// SCRIPT NAME: Delivery Health Dashboard (4-tile: Utilization,
//              On-Time Delivery, Forecast Accuracy, Rework-placeholder)
// PURPOSE:     Standalone GAS web app. Reads Tempo/NS/Jira tabs +
//              Roster by spreadsheet ID, builds one person×week +
//              Jira-bucket model, serves Dashboard.html.
// ACCESS:      Email allowlist — see Security.js (checkDeliveryAccess()).
// SPEC:        docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md
// ============================================================

var CONFIG_DH = {
  // ── Sources (Script Properties DH_SOURCE_SS_ID / DH_ROSTER_SS_ID override) ──
  SOURCE_SS_ID:      "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // Tempo hours SS
  ROSTER_SS_ID:      "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  CAPACITY_SHEET:    "Capacity Tempo",
  TRACKED_SHEET:     "Tempo Tracked Time",
  PLANNED_SHEET:     "Planned Time Tempo",
  NS_SHEET:          "NS Billable",
  PH_SHEET:          "PH",

  // ── PTO source (user decision 2026-08-01): the Accumulation Cost ledger —
  //    "the most accurate PTO record we have" (same workbook the PS Dashboard's
  //    PTO metric reads; Script Property DH_PTO_SS_ID overrides). Usage
  //    transactions are dated per employee → bucketed into ISO weeks. The
  //    NETSUITE rows in Planned Time Tempo remain the FALLBACK when this
  //    workbook is unreadable.
  PTO_ACCUM_SS_ID:   "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:   "Accumulation Cost",
  PTO_UNIT:          "hours",   // "hours" | "days" — VERIFY via probeDeliverySources at deploy
  PTO_HOURS_PER_DAY: 8,         // only used when PTO_UNIT = "days"
  JIRA_RAW_SHEET:    "Jira Raw",
  ROSTER_SHEET:      "Data",
  CONTRACTORS_SHEET: "Contractors Data",
  ROSTER_CLASS:      "Professional Services",
  ROSTER_DEPT:       "Services",
  NONPROJECT_KEYS:   ["NETSUITE"],       // time-off rows (case-insensitive)

  // ── On-Time Delivery scope (policy switch, audit 2026-08-03) ──
  // The pre-audit code counted EVERY resolved issue type in one rate, which is
  // the one reading nobody wants: an epic's Due Date is a programme milestone
  // set by the PM and its resolution trails its last child, so epics and Stories
  // measure two different lifecycles — and epics' much lower Due-Date fill rate
  // also inflated the coverage denominator.
  //   "delivery" — non-epic issues only (Stories/Tasks: the team's commitments)
  //   "epic"     — epics only (the metrics-dictionary reading: milestone-level
  //                client commitments; see spec §11 open item)
  //   "all"      — every resolved issue (the pre-audit behaviour; not recommended)
  // USER DECISION 2026-08-03: ship "delivery". This is a KNOWN, ACCEPTED
  // deviation from the Metrics Dictionary (owner: Bill), which asks for
  // Epic/Milestone or Client-Commitment-labelled items — raise it with Bill as a
  // dictionary question, don't silently switch. Changing this changes the rate's
  // MEANING: bump DH_SCHEMA_VER_ and bust the cache with it.
  ONTIME_SCOPE:      "delivery",

  // ── Tracking mandate (ALLOWLIST, not blocklist) ──
  // Only these families are held to a time-tracking standard, and ONLY they are
  // in the dashboard population. Everyone else (JF008 Training, JF015 Operations,
  // JF018 Solution Architecture, …) has no tracking obligation — their capacity
  // means nothing if they don't plan and track it, so they are excluded ENTIRELY
  // (grid, tiles, filters; user decision 2026-07-31). Blank/unknown family
  // (incl. crew) = tracking-required: a Tempo schedule implies the expectation
  // (same rule as utilSplitPopulation_ in the demand dashboard).
  TRACKING_FAMILIES: ["Managed Services & Support",  // JF007 — tracking MANDATED
                      "Service Delivery",            // JF009 — tracking MANDATED
                      "Professional Services"],      // defensive — see demand note

  // ── Backlog drill-down (open Jira issues per assignee, spec: swarm view) ──
  BACKLOG_MAX_ITEMS: 8,   // issues listed per person in the detail row (totals cover all)

  // ── New-hire handling (user decision 2026-07-31) ──
  // Weeks BEFORE a person's hire date are removed from every per-person metric
  // (no capacity, no denominators, no grid cell). People hired within this many
  // months stay IN all metrics but carry a 🌱 watch flag in the UI.
  RAMP_UP_MONTHS: 3,

  // ── Window ──
  WEEKS_PAST_GRID:   2,   // completed weeks shown in the weekly grid
  WEEKS_PAST_TREND:  6,   // completed weeks in the WEEKLY tile trend
  // Full history depth. Raised 30 → 52 on 2026-08-03 together with the
  // exporters' shared EXPORT_HISTORY_WEEKS dial: at 30 weeks the Monthly view
  // had its 6 complete months but the QUARTERLY view spanned only ONE complete
  // fiscal quarter, so its tiles showed a single data point — no trend line and
  // no "vs prior" delta (renderTiles_ counts only periods that are done and not
  // partial). Worst-case complete periods by depth, measured (see _test_periods_):
  //     30 wk → 1 quarter,  6 months
  //     52 wk → 3 quarters, 11 months   ← here
  //     65 wk → 4 quarters, 14 months   (cliff for a full-year / YoY compare)
  // Stopped at 52 rather than 65 deliberately: 52 weeks of one person's
  // worklogs still fits inside Tempo's single 500-result page, so the exports
  // stay at one request per person. 65 tips typical users onto a second page,
  // doubling request count and with it the transient-500 exposure.
  // ⚠ This must never exceed what the exports carry, or the deep weeks come
  // back empty and read as zero activity. Exports first, dashboard second.
  WEEKS_PAST_DEEP:   52,
  WEEKS_FUTURE:      3,

  // ── Capacity fallbacks (used only when Capacity Tempo has no cell) ──
  WEEKLY_CAPACITY_HRS:     40,
  ANZ_LOCATION:            "Australia & New Zealand",
  ANZ_CAPACITY_HRS:        38,
  HOLIDAY_HRS_PER_DAY:     8,
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,

  // ── Region buckets: roster "Key Location" → bucket (FALLBACK lens only;
  //    primary person-region = majority of Jira-tagged tracked hours).
  //    Extend after the W32 Key Location audit (spec §10.2). ──
  LOCATION_REGION_MAP: {
    "australia & new zealand": "ANZ",
    "malaysia": "APAC", "singapore": "APAC", "philippines": "APAC",
    "united states": "AMER", "canada": "AMER", "costa rica": "AMER",
    "chile": "AMER", "colombia": "AMER", "mexico": "AMER",
    "united kingdom": "EMEA", "spain": "EMEA", "portugal": "EMEA",
  },
  REGION_FALLBACK: "Other",

  // ── RAG tint thresholds (billable util %, spec §10.3) ──
  TINT_GREEN: 70,
  TINT_AMBER: 50,

  // ── Per-metric tile targets (director feedback 2026-07-31: one shared
  //    orange made 0%, 58% and 10% look equally alarming). green = target,
  //    amber = watch floor; below amber = red. ──
  TARGETS: {
    util:     { green: 70, amber: 50 },   // billable utilization %
    onTime:   { green: 85, amber: 70 },   // on-time delivery %
    forecast: { green: 80, amber: 60 },   // forecast accuracy %
  },

  TITLE: "Delivery Health Dashboard",

  // ── Cache ──
  CACHE_TTL_SEC:        3900,
  CACHE_WARM_EVERY_MIN: 30,
};

// ── ISO WEEK HELPERS (Monday-start, ISO-8601 — ported from demand Code.js) ──

function isoWeekNum_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_(year) {
  return isoWeekNum_(new Date(Date.UTC(year, 11, 28)));
}

/** "YYYY.WN" label for any Date (used to bucket NS daily rows + Jira dates). */
function weekKeyFromDate_(date) {
  return isoWeekYear_(date) + ".W" + isoWeekNum_(date);
}

/**
 * Rolling window anchored on `today` (injectable for tests).
 * @returns {{ gridWeeks: Array<{iso:string,status:string}>,
 *             trendWeeks: string[],       // 6 completed, oldest first
 *             allWeeks: string[],         // union, oldest first
 *             headlineIso: string }}
 */
function buildDhWindow_(today) {
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  function shift(off) {
    var w = curW + off, y = curY;
    while (w <= 0) { y--; w += weeksInYear_(y); }
    while (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
    return y + ".W" + w;
  }
  var trendWeeks = [], gridWeeks = [], allWeeks = [];
  for (var t = -CONFIG_DH.WEEKS_PAST_TREND; t <= -1; t++) trendWeeks.push(shift(t));
  for (var off = -CONFIG_DH.WEEKS_PAST_GRID; off <= CONFIG_DH.WEEKS_FUTURE; off++) {
    gridWeeks.push({ iso: shift(off), status: off < 0 ? "done" : (off === 0 ? "now" : "plan") });
  }
  for (var a = -CONFIG_DH.WEEKS_PAST_DEEP; a <= CONFIG_DH.WEEKS_FUTURE; a++) allWeeks.push(shift(a));
  return { gridWeeks: gridWeeks, trendWeeks: trendWeeks, allWeeks: allWeeks,
           headlineIso: shift(-1), today: today };
}

// ── PERIOD CALENDAR (Week / Month / fiscal Quarter — FY starts Jul 1,
//    named for the calendar year it ENDS in: Jul 2026–Jun 2027 = FY27) ──

var DH_MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Thursday (UTC) of an ISO year+week — the day that decides which month or
    quarter the week belongs to (ISO majority rule). */
function isoWeekThursday_(year, wk) {
  var jan4 = new Date(Date.UTC(year, 0, 4)); // Jan 4 is always in ISO W1
  var thu = new Date(jan4);
  thu.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (wk - 1) * 7 + 3);
  return thu;
}

/** "YYYY.WN" → { month:"2026-07", monthLabel:"Jul 2026", quarter:"FY27Q1",
    quarterLabel:"FY27 Q1" }. */
function periodInfoForIso_(iso) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  var thu = isoWeekThursday_(parseInt(m[1], 10), parseInt(m[2], 10));
  var y = thu.getUTCFullYear(), mo = thu.getUTCMonth() + 1;
  var fy = mo >= 7 ? y + 1 : y;
  var q = mo >= 7 ? Math.ceil((mo - 6) / 3) : Math.ceil(mo / 3) + 2;
  return {
    month: y + "-" + (mo < 10 ? "0" : "") + mo,
    monthLabel: DH_MONTHS_[mo - 1] + " " + y,
    quarter: "FY" + String(fy).slice(-2) + "Q" + q,
    quarterLabel: "FY" + String(fy).slice(-2) + " Q" + q,
  };
}

/** ISO label offset by ±1 week (year-wrap safe). */
function adjacentIso_(iso, dir) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  var y = parseInt(m[1], 10), w = parseInt(m[2], 10) + dir;
  if (w <= 0) { y--; w += weeksInYear_(y); }
  else if (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
  return y + ".W" + w;
}

/**
 * Groups the window's weeks into Month and fiscal-Quarter periods for the
 * client's period toggle. Each period: { key, label, isos[], status, partial }.
 * status: "now" when it contains the current week, "done" when fully past,
 * "plan" when fully future. partial: the window truncates the period at
 * either edge (the bordering out-of-window week belongs to the same period).
 */
function buildPeriods_(win) {
  var nowIso = null;
  win.gridWeeks.forEach(function (g) { if (g.status === "now") nowIso = g.iso; });
  var nowIdx = win.allWeeks.indexOf(nowIso);
  function build(kind) {
    var list = [], byKey = {};
    win.allWeeks.forEach(function (iso) {
      var info = periodInfoForIso_(iso);
      var key = kind === "month" ? info.month : info.quarter;
      if (!byKey[key]) {
        byKey[key] = { key: key, label: kind === "month" ? info.monthLabel : info.quarterLabel, isos: [] };
        list.push(byKey[key]);
      }
      byKey[key].isos.push(iso);
    });
    function periodKey(iso) {
      var i = periodInfoForIso_(iso);
      return kind === "month" ? i.month : i.quarter;
    }
    list.forEach(function (p) {
      var hasNow = p.isos.indexOf(nowIso) !== -1;
      var allPast = p.isos.every(function (iso) { return win.allWeeks.indexOf(iso) < nowIdx; });
      p.status = hasNow ? "now" : (allPast ? "done" : "plan");
      var first = p.isos[0], last = p.isos[p.isos.length - 1];
      p.partial =
        (win.allWeeks[0] === first && periodKey(adjacentIso_(first, -1)) === p.key) ||
        (win.allWeeks[win.allWeeks.length - 1] === last && periodKey(adjacentIso_(last, 1)) === p.key);
    });
    return list;
  }
  return { month: build("month"), quarter: build("quarter") };
}

// ── NAME JOINS ───────────────────────────────────────────────

/** Canonical name key — same convention as normPS_ in the PS report. */
function normDH_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * All normalized variants a source cell may appear as. "Last, First" cells
 * (NS Billable / Planned) also produce "First Last" and "Last First".
 * @returns {string[]} deduped normalized keys
 */
function nameAliases_(raw) {
  var norm = normDH_(raw);
  if (!norm) return [];
  var out = [norm];
  var m = norm.match(/^([^,]+),\s*(.+)$/);
  if (m) {
    var flipped = normDH_(m[2] + " " + m[1]);   // "first last"
    var spaced  = normDH_(m[1] + " " + m[2]);   // "last first"
    if (out.indexOf(flipped) === -1) out.push(flipped);
    if (out.indexOf(spaced) === -1) out.push(spaced);
  }
  return out;
}

/** Roster display names → lookup index: every alias key → display name. */
function buildNameIndex_(displayNames) {
  var idx = {};
  displayNames.forEach(function (dn) {
    nameAliases_(dn).forEach(function (k) { if (!(k in idx)) idx[k] = dn; });
    // Also index the "Last, First" form of a "First Last" roster name so
    // comma-form source cells resolve: "Maria Alvarez" → key "alvarez, maria".
    var parts = normDH_(dn).split(" ");
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var first = parts.slice(0, -1).join(" ");
      var commaKey = normDH_(last + ", " + first);
      if (!(commaKey in idx)) idx[commaKey] = dn;
      var lastFirstKey = normDH_(last + " " + first);
      if (!(lastFirstKey in idx)) idx[lastFirstKey] = dn;
    }
  });
  return idx;
}

/** Resolves a raw source-cell name to the roster display name, else null. */
function resolveName_(idx, raw) {
  var aliases = nameAliases_(raw);
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] in idx) return idx[aliases[i]];
  }
  return null;
}

// ── TEAM SPLIT (spec: filter = individual Tempo teams, membership match) ──

/** "Team A | Team B" → ["Team A","Team B"], trimmed, deduped, blanks dropped. */
function splitTeams_(cell) {
  var seen = {}, out = [];
  String(cell || "").split("|").forEach(function (t) {
    var v = t.trim();
    if (v && !(v.toLowerCase() in seen)) { seen[v.toLowerCase()] = 1; out.push(v); }
  });
  return out;
}

// ── NS BILLABLE WEEK AGGREGATION ─────────────────────────────

/**
 * Daily NS rows → { normName: { iso: {billable, nonBillable} } }.
 * @param {Array<{name:string,date:Date,billable:number,nonBillable:number}>} rows
 */
function aggregateNsWeeks_(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!r.date || isNaN(r.date.getTime())) return;
    var key = normDH_(r.name);
    if (!key) return;
    var iso = weekKeyFromDate_(r.date);
    if (!map[key]) map[key] = {};
    if (!map[key][iso]) map[key][iso] = { billable: 0, nonBillable: 0 };
    map[key][iso].billable += Number(r.billable) || 0;
    map[key][iso].nonBillable += Number(r.nonBillable) || 0;
  });
  return map;
}

// ── NET CAPACITY (spec §4) ───────────────────────────────────

/**
 * available = max(0, cap − pto − effectiveHoliday);
 * effectiveHoliday = max(0, holidayHrs − pto) so a holiday already booked as
 * NETSUITE time-off is never counted twice (demand-dashboard convention).
 * @returns {{avail:number, hol:number}} hol = effective (deduped) holiday hours
 */
function netCapacity_(cap, pto, holidayHrs) {
  var c = Number(cap) || 0, p = Number(pto) || 0, h = Number(holidayHrs) || 0;
  var effHol = Math.max(0, h - p);
  return { avail: Math.max(0, c - p - effHol), hol: effHol };
}

// ── REGION RESOLUTION (spec: issue-level standard, roster fallback) ──

function regionBucketFromLocation_(keyLocation) {
  var k = normDH_(keyLocation);
  return CONFIG_DH.LOCATION_REGION_MAP[k] || CONFIG_DH.REGION_FALLBACK;
}

/**
 * Person region = region receiving the most Jira-tagged tracked hours in the
 * trend window; ties break alphabetically (deterministic). No tagged hours
 * (> 0) → roster-location fallback, labeled source:"roster".
 */
function assignPersonRegion_(hoursByRegion, rosterBucket) {
  var best = null, bestH = 0;
  Object.keys(hoursByRegion).sort().forEach(function (r) {
    var h = Number(hoursByRegion[r]) || 0;
    if (h > bestH) { best = r; bestH = h; }
  });
  if (best !== null && bestH > 0) return { region: best, source: "jira" };
  return { region: rosterBucket || CONFIG_DH.REGION_FALLBACK, source: "roster" };
}

// ── NEW-HIRE HANDLING (user decision 2026-07-31) ─────────────

/** True when ISO week label `iso` falls entirely before the week containing `date`. */
function isoWeekBefore_(iso, date) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  if (!m || !date || isNaN(date.getTime())) return false;
  var y = parseInt(m[1], 10), w = parseInt(m[2], 10);
  var dy = isoWeekYear_(date), dw = isoWeekNum_(date);
  return y < dy || (y === dy && w < dw);
}

/** Hired within RAMP_UP_MONTHS of `today` → 🌱 watch flag (still in all metrics).
    Fails safe to false when the roster has no parseable hire date. */
function isDhNewHire_(hireDate, today) {
  if (!hireDate || isNaN(hireDate.getTime())) return false;
  var cutoff = new Date(today.getFullYear(), today.getMonth() - CONFIG_DH.RAMP_UP_MONTHS,
                        today.getDate());
  return hireDate.getTime() > cutoff.getTime();
}

/** "YYYY-MM-DD" for UI tooltips; "" for missing/invalid dates. */
function dhDateStr_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  var mo = d.getMonth() + 1, da = d.getDate();
  return d.getFullYear() + "-" + (mo < 10 ? "0" : "") + mo + "-" + (da < 10 ? "0" : "") + da;
}

// ── BAR OVERFLOW CLAMP (spec §5: clamp at 100% + ⚠ flag) ──────

function clampToCapacity_(hours, capacity) {
  var c = Number(capacity) || 0, h = Number(hours) || 0;
  if (c <= 0) return { pct: null, over: false, realPct: null };
  var real = h / c * 100;
  return { pct: Math.min(100, real), over: real > 100, realPct: Math.round(real) };
}

// ── UTILIZATION ROLLUP (also mirrored client-side for filtering) ──

/**
 * Filter-scoped weekly sums. region/team null = All. Team matching is by
 * MEMBERSHIP (multi-team person counts in each of their teams — per-team
 * rates honest; team numbers do not sum to All by design, spec §4).
 * People with no tracking mandate (p.tracks === false) are EXCLUDED unless
 * includeNonTracking — holding JF008/JF015/JF018 to a tracked-based rate
 * punishes a scope decision, not performance (demand-dashboard parity).
 * People on long leave (p.onLeave — maternity/paternity/parental/sabbatical)
 * are ALWAYS excluded, no include flag: their capacity rows may still carry
 * avail > 0 (Tempo schedules lag HR), which would drag the rate down for an
 * absence, not a performance signal.
 * Billable % divides by availCov — the availability of NS-CLASSIFIED person-weeks
 * only — not by total avail. Mixing them would put unclassifiable weeks in the
 * denominator with a forced-zero numerator, understating the rate by however much
 * the NS export lags (audit fix 2026-08-03). Tracked % keeps the full avail base.
 * @returns {{avail,availCov,billable,tracked,planned,billablePct,trackedPct}}
 */
function utilRollup_(people, iso, region, team, includeNonTracking) {
  var s = { avail: 0, availCov: 0, billable: 0, tracked: 0, planned: 0 };
  people.forEach(function (p) {
    if (p.onLeave === true) return;
    if (!includeNonTracking && p.tracks === false) return;
    if (region && p.region !== region) return;
    if (team && (p.teams || []).indexOf(team) === -1) return;
    var w = p.weeks && p.weeks[iso];
    if (!w) return;
    s.avail += Number(w.avail) || 0;
    s.availCov += Number(w.availCov) || 0;
    s.billable += Number(w.billable) || 0;
    s.tracked += Number(w.tracked) || 0;
    s.planned += Number(w.planned) || 0;
  });
  s.billablePct = s.availCov > 0 ? s.billable / s.availCov * 100 : null;
  s.trackedPct = s.avail > 0 ? s.tracked / s.avail * 100 : null;
  return s;
}

// ── NS COVERAGE TELEMETRY (audit 2026-08-03) ─────────────────

/**
 * How much of the tracked-hour base the NS feed actually classified, plus the
 * reconciliation gap between the two feeds. Every field is diagnostic — none of
 * it enters a rate.
 *
 * gapHours = Σ|NS raw total − Tempo tracked| over classified person-weeks. Large
 * values mean the feeds disagree about how much work happened, which the ratio
 * model absorbs silently (it trusts Tempo's total) — so it is surfaced here
 * rather than left invisible. unmatchedNames are NS employees no roster alias
 * resolved: their hours classify nothing at all.
 *
 * @returns {{personWeeks,covered,coveredPct,trackedHours,classifiedHours,
 *            classifiedPct,gapHours,unmatchedRows,unmatchedHours,unmatchedNames}}
 */
function nsCoverage_(people, unmatched) {
  var pw = 0, cov = 0, trk = 0, clf = 0, gap = 0;
  (people || []).forEach(function (p) {
    Object.keys(p.weeks || {}).forEach(function (iso) {
      var w = p.weeks[iso];
      pw++;
      trk += Number(w.tracked) || 0;
      if (!w.nsCov) return;
      cov++;
      clf += Number(w.trackedCov) || 0;
      gap += Math.abs(((Number(w.nsBillRaw) || 0) + (Number(w.nsNonBillRaw) || 0)) -
                      (Number(w.tracked) || 0));
    });
  });
  var u = unmatched || { rows: 0, hours: 0, names: {} };
  var names = Object.keys(u.names || {}).sort();
  return {
    personWeeks: pw, covered: cov,
    coveredPct: pw > 0 ? Math.round(cov / pw * 1000) / 10 : null,
    trackedHours: Math.round(trk * 10) / 10,
    classifiedHours: Math.round(clf * 10) / 10,
    classifiedPct: trk > 0 ? Math.round(clf / trk * 1000) / 10 : null,
    gapHours: Math.round(gap * 10) / 10,
    unmatchedRows: u.rows || 0,
    unmatchedHours: Math.round((u.hours || 0) * 10) / 10,
    // Capped: this rides in the cached payload and only needs to be actionable.
    unmatchedNames: names.slice(0, 25),
  };
}

// ── JIRA TILE BUCKETS (additive per iso×region×team, spec §11) ──

/** Resolved DELIVERY issues → per-week on-time buckets. n/onTime cover issues
    WITH a due date; nAll counts every resolved delivery issue (coverage
    denominator).

    Epics are excluded (audit fix 2026-08-03): an epic is a container whose due
    date is a programme milestone set by the PM and whose resolution lags its
    last child by days or weeks. Mixing them with Stories/Tasks measured two
    different lifecycles in one rate, and because epics have a much lower
    due-date fill rate they also inflated the nAll coverage denominator — the
    card read as a delivery miss when it was really a missing-due-date artifact.
    Epic-level forecasting lives in forecastBuckets_ instead.

    scope — CONFIG_DH.ONTIME_SCOPE ("delivery" | "epic" | "all"); see the config
    note. Passed in so the tests can pin each reading. */
function onTimeBuckets_(issues, resolvePerson, scope) {
  var map = {}, unattributed = 0;
  var sc = scope || CONFIG_DH.ONTIME_SCOPE || "delivery";
  issues.forEach(function (it) {
    // Scope gate: an epic is a programme container, a Story/Task is the team's
    // own commitment — never both in one rate.
    if (sc === "delivery" && it.isEpic) return;
    if (sc === "epic" && !it.isEpic) return;
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    // Person attribution (user decision 2026-07-31: ALL filters drive ALL three
    // KPI cards): issues join to the roster via Assignee, so the tiles filter
    // through the same passesFilters_ predicate as the grid. Items without a
    // roster assignee are excluded and tallied for the honesty note.
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, onTime: 0, nAll: 0 };
    // nAll = EVERY resolved issue, due date or not — the tile states coverage
    // ("139 of 210 resolved had a due date"); without it a low-hygiene week
    // reads as a delivery metric when it's really a missing-due-date metric.
    map[k].nAll++;
    if (!it.due || isNaN(it.due.getTime())) return;
    map[k].n++;
    // On time = resolved on or before the due CALENDAR DAY (time-of-day ignored)
    var d = new Date(it.due.getFullYear(), it.due.getMonth(), it.due.getDate());
    var r = new Date(it.resolved.getFullYear(), it.resolved.getMonth(), it.resolved.getDate());
    if (r <= d) map[k].onTime++;
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/**
 * Resolved epics → per-week forecast-accuracy buckets. n/sumAcc cover epics
 * that are actually MEASURABLE (estimate AND logged time both present); nAll
 * counts every resolved epic (coverage denominator), nNoTime the
 * estimated-but-untracked ones.
 *
 * Zero-logged-time guard (audit fix 2026-08-03): a resolved epic with est > 0
 * and spent = 0 scored acc = max(0, 1 − est/est) = 0 — the WORST possible
 * accuracy — so Jira time-tracking hygiene (time logged on children only, or
 * an epic closed without any worklog) was reported as a forecasting failure and
 * silently dragged the tile down. Nothing was measured, so it now counts toward
 * coverage only, exactly like an unestimated epic.
 *
 * Variance direction: accuracy alone can't tell a team that closes early from
 * one that over-runs — both lose the same points. lossOver/lossUnder split the
 * lost accuracy by direction (additive across buckets, so the client can roll
 * them up under any filter) which is the actionable half of the number.
 */
function forecastBuckets_(epics, resolvePerson) {
  var map = {}, unattributed = 0;
  epics.forEach(function (ep) {
    if (!ep.resolved || isNaN(ep.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(ep.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(ep.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, sumAcc: 0, nAll: 0,
                            nNoTime: 0, nOver: 0, nUnder: 0,
                            lossOver: 0, lossUnder: 0 };
    map[k].nAll++; // every resolved epic — coverage denominator for the tile
    var est = Number(ep.estSec) || 0;
    if (est <= 0) return; // unestimated — counted in coverage only
    var spent = Number(ep.spentSec) || 0;
    if (spent <= 0) { map[k].nNoTime++; return; } // no worklog — nothing measured
    var dev = (spent - est) / est;          // signed relative deviation
    var loss = Math.min(1, Math.abs(dev));  // accuracy points lost (acc floors at 0)
    map[k].n++;
    map[k].sumAcc += 1 - loss;
    if (dev > 0) { map[k].nOver++; map[k].lossOver += loss; }
    else if (dev < 0) { map[k].nUnder++; map[k].lossUnder += loss; }
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

// ── CACHE (gzip chunked) ──────────────────────────────────────

var CACHE_CHUNK_BYTES_ = 90 * 1024; // CacheService hard-fails >100KB per value

/** Current cache version — Script Property DH_CACHE_VER (default 1). */
function deliveryCacheVer_() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty("DH_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch (e) { return 1; }
}

/**
 * Bumps DH_CACHE_VER, stranding all prior-version entries (they expire on TTL —
 * CacheService can't enumerate keys, so versioning is how invalidation works).
 * Run manually from the GAS editor to force-invalidate the cache.
 */
function bustDeliveryCache_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = (parseInt(props.getProperty("DH_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("DH_CACHE_VER", String(next));
    Logger.log("✅ bustDeliveryCache_: cache version bumped to " + next);
    return next;
  } catch (e) {
    Logger.log("⚠️ bustDeliveryCache_: " + e.message);
    return null;
  }
}

/** The single shared cache key for the delivery model. */
function deliveryCacheKey_() { return "dh_v" + deliveryCacheVer_(); }

/** Gzips + chunks `str` into `<key>_0..n` + `<key>_meta`. Returns true on success. */
function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    var b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    var entries = {};
    var n = 0;
    for (var i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    Logger.log("cachePutLarge_: " + key + " — " + str.length + " chars → " + b64.length + " b64 in " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

/** Reads a chunked entry; returns the JSON string or null on any miss. */
function cacheGetLarge_(cache, key) {
  try {
    var meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    var names = [];
    for (var i = 0; i < meta; i++) names.push(key + "_" + i);
    var got = cache.getAll(names);
    var b64 = "";
    for (var j = 0; j < meta; j++) {
      var part = got[key + "_" + j];
      if (!part) return null;  // chunk expired/evicted — whole entry is a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}

// ── SHEET READERS (GAS-only; header-name column lookups) ─────

function dhSourceIds_() {
  var p = PropertiesService.getScriptProperties();
  return {
    source: p.getProperty("DH_SOURCE_SS_ID") || CONFIG_DH.SOURCE_SS_ID,
    roster: p.getProperty("DH_ROSTER_SS_ID") || CONFIG_DH.ROSTER_SS_ID,
  };
}

/** Case-insensitive header index lookup; -1 when absent. */
function colIdx_(headers, names) {
  var low = headers.map(function (h) { return normDH_(h); });
  for (var i = 0; i < names.length; i++) {
    var at = low.indexOf(normDH_(names[i]));
    if (at !== -1) return at;
  }
  return -1;
}

// ── JOB FAMILY → TRACKING MANDATE (demand-dashboard parity) ──

/** JF code number → family display name (same catalog as parseJobFamily_ / ACTIVE_FAMILY_NAMES_). */
var DH_FAMILY_NAMES_ = {
  1: "Marketing", 3: "Analytics", 4: "Sales and Success", 5: "Partner Success",
  7: "Managed Services & Support", 8: "Training & Customer Education",
  9: "Service Delivery", 13: "Finance", 14: "Legal & Compliance", 15: "Operations",
  16: "People", 17: "Information Technology", 18: "Solution Architecture",
};

/**
 * Family for a roster row. Precedence: explicit "Job Family" cell → numeric
 * code prefix on the Job Title ("09." / "009." → JF009 → name). Crew and
 * unlisted titles resolve to "" (treated as tracking-required — see CONFIG note).
 */
function dhFamilyFromTitle_(famCol, title) {
  if (famCol) return String(famCol).trim();
  var m = String(title || "").trim().match(/^(\d{2,3})\./);
  if (!m) return "";
  return DH_FAMILY_NAMES_[String(parseInt(m[1], 10))] || "";
}

/** True when this family is held to the tracking standard (blank = yes). */
function dhTracksTime_(family) {
  var fam = normDH_(family);
  if (!fam) return true;
  return CONFIG_DH.TRACKING_FAMILIES.some(function (f) { return normDH_(f) === fam; });
}

function parseDhDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    var d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Gone-for-good roster statuses (demand-dashboard convention — readRosterFull_). */
var DH_TERMINATED_ = /terminat|job offer|resign|left|inactive|former|offboard/i;

/**
 * True when a roster row belongs to the ACTIVE population. Attrition = a
 * gone-for-good status OR any value in "Termination/Release Date" — those rows
 * must never reach the dashboard (FTE and crew alike).
 */
function dhRosterRowActive_(status, termDate) {
  if (String(termDate || "").trim()) return false;
  return !DH_TERMINATED_.test(String(status || ""));
}

/**
 * Long-leave detector on roster Employee Status (maternity/paternity/parental/
 * other leave, sabbatical). Leave people stay IN the population but the UI
 * shows a 🏖 marker instead of zeros — absence is not non-delivery
 * (GDash "🏖 On Leave" precedent).
 */
var DH_LEAVE_RE_ = /matern|patern|parental|sabbat|leave/i;
function dhOnLeave_(status) {
  var s = String(status || "");
  return dhRosterRowActive_(s, "") && DH_LEAVE_RE_.test(s);
}

/**
 * Population: active Class=Professional Services / Department=Services from
 * Data + Contractors Data (crew: the Class gate is skipped — their Class is
 * "Contractors"; Department must still be Services).
 * Attrition handling mirrors the demand dashboard's readRosterFull_:
 * "Employee Status" + "Termination/Release Date" gate every row, and rows are
 * deduped by normalized name FIRST-ACTIVE-WINS — a rehired (boomerang) person
 * with an old terminated stint keeps only their active row, and Data beats
 * Contractors Data on a name collision.
 * @returns {{ people: Array<{name, keyLocation, rosterBucket, isCrew, jobFamily, tracks}>, error?:string }}
 */
function readRosterPeople_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().roster);
    var out = [], seen = {};
    [{ tab: CONFIG_DH.ROSTER_SHEET, crew: false },
     { tab: CONFIG_DH.CONTRACTORS_SHEET, crew: true }].forEach(function (src) {
      var sh = ss.getSheetByName(src.tab);
      if (!sh) { if (!src.crew) throw new Error('Tab "' + src.tab + '" not found'); return; }
      var raw = sh.getDataRange().getValues();
      if (raw.length < 2) return;
      var h = raw[0].map(String);
      var iName = colIdx_(h, ["Full Name", "Employee Name", "Name"]);
      var iStatus = colIdx_(h, ["Employee Status", "Status", "Employment Status"]);
      var iTerm = colIdx_(h, ["Termination/Release Date", "Termination Date"]);
      var iClass = colIdx_(h, ["Class"]);
      var iDept = colIdx_(h, ["Department"]);
      var iLoc = colIdx_(h, ["Key Location", "Location"]);
      var iFam = colIdx_(h, ["Job Family"]);
      var iTitle = colIdx_(h, ["Job Title"]);
      var iEmpNum = colIdx_(h, ["Employee Number", "Employee #", "Employee ID"]);
      var iHire = colIdx_(h, ["Hire Date", "Hire/Rehire Date", "Most Recent Hire Date",
                              "Original Hire Date", "Start Date"]);
      if (iName === -1) throw new Error('No name column in "' + src.tab + '"');
      if (iDept === -1) {
        Logger.log('⚠️ readRosterPeople_: "' + src.tab + '" has no Department column — ' +
                   'every row excluded (fail-closed; unallocated = R&D by default)');
      }
      if (iStatus === -1 && iTerm === -1) {
        Logger.log('⚠️ readRosterPeople_: "' + src.tab + '" has no Employee Status / ' +
                   'Termination column — attrition rows CANNOT be filtered');
      }
      for (var r = 1; r < raw.length; r++) {
        var name = String(raw[r][iName] || "").trim();
        if (!name) continue;
        var status = iStatus === -1 ? "" : String(raw[r][iStatus] || "");
        var term = iTerm === -1 ? "" : String(raw[r][iTerm] || "");
        if (!dhRosterRowActive_(status, term)) continue; // attrition — never shown
        if (seen[normDH_(name)]) continue;               // boomerang/collision: first active wins
        // Gates are FAIL-CLOSED: a missing/blank Class or Department cell excludes
        // the row instead of waving it through — the Contractors Data tab has no
        // Department column, and fail-open here let every contractor (any dept,
        // any status) into the population. Unallocated crew = R&D by default
        // (demand-dashboard rule 2026-07-15), so no Department → not Services.
        if (!src.crew) {
          var cls = iClass === -1 ? "" : String(raw[r][iClass] || "").trim();
          if (normDH_(cls) !== normDH_(CONFIG_DH.ROSTER_CLASS)) continue;
        }
        var dept = iDept === -1 ? "" : String(raw[r][iDept] || "").trim();
        if (normDH_(dept) !== normDH_(CONFIG_DH.ROSTER_DEPT)) continue;
        var loc = iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim();
        var fam = dhFamilyFromTitle_(
          iFam === -1 ? "" : String(raw[r][iFam] || "").trim(),
          iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim());
        seen[normDH_(name)] = 1;
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew,
                   jobFamily: fam, tracks: dhTracksTime_(fam),
                   jobTitle: iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim(),
                   onLeave: dhOnLeave_(status),
                   leaveStatus: dhOnLeave_(status) ? String(status).trim() : "",
                   empNum: iEmpNum === -1 ? "" :
                     String(typeof raw[r][iEmpNum] === "number" ? Math.round(raw[r][iEmpNum])
                       : (raw[r][iEmpNum] || "")).replace(/,/g, "").trim(),
                   hireDate: iHire === -1 ? null : parseDhDate_(raw[r][iHire]) });
      }
    });
    return { people: out };
  } catch (e) {
    return { people: [], error: "Roster read failed: " + e.message };
  }
}

/**
 * Capacity Tempo grid → { normName: { iso: hours } }.
 * Sheet shape (TempoCapacityTime.js): header row carries "YYYY.WN" labels;
 * fixed cols before the week columns include the User column.
 * @returns {{ byName: Object, error?: string }}
 */
function readCapacitySheet_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
      .getSheetByName(CONFIG_DH.CAPACITY_SHEET);
    if (!sh) return { byName: {}, error: 'Tab "' + CONFIG_DH.CAPACITY_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { byName: {} };
    // Find the header row: first row containing a ".W" week label
    var hRow = -1;
    for (var r = 0; r < Math.min(3, raw.length); r++) {
      if (raw[r].some(function (c) { return /^\d{4}\.W\d{1,2}$/.test(String(c).trim()); })) { hRow = r; break; }
    }
    if (hRow === -1) return { byName: {}, error: "No week columns found in Capacity Tempo" };
    var headers = raw[hRow].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(headers, ["User"]);
    if (iUser === -1) iUser = 1; // TempoCapacityTime.js: User is column B
    var weekCols = [];
    headers.forEach(function (hh, i) { if (/^\d{4}\.W\d{1,2}$/.test(hh)) weekCols.push({ col: i, iso: hh }); });
    var byName = {};
    for (var r2 = hRow + 1; r2 < raw.length; r2++) {
      var user = String(raw[r2][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var key = normDH_(user);
      if (!byName[key]) byName[key] = {};
      weekCols.forEach(function (wc) {
        var v = raw[r2][wc.col];
        if (v !== "" && v !== null && !isNaN(Number(v))) byName[key][wc.iso] = Number(v);
      });
    }
    return { byName: byName };
  } catch (e) {
    return { byName: {}, error: "Capacity read failed: " + e.message };
  }
}

/**
 * Shared Tempo grid reader for Tracked/Planned. Detects the week-label row
 * and the fixed-header row, then aggregates.
 * @returns {{ rows: Array<{user,teamCell,key,weekHours:Object}>, weekIsos:string[], error?:string }}
 */
function readTempoGrid_(sheetName) {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(sheetName);
    if (!sh) return { rows: [], weekIsos: [], error: 'Tab "' + sheetName + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [], weekIsos: [] };
    // Field-header row: scan the first 5 rows for the employee column instead
    // of assuming row 2 — same approach as the demand dashboard's reader, which
    // tolerates banner rows / layout drift in the Tempo exports.
    var isEmpHdr = function (h) {
      return /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
    };
    var hr = -1, iUser = -1;
    for (var r0 = 0; r0 < Math.min(raw.length, 5) && hr === -1; r0++) {
      for (var c0 = 0; c0 < raw[r0].length; c0++) {
        if (isEmpHdr(String(raw[r0][c0]).trim())) { hr = r0; iUser = c0; break; }
      }
    }
    if (hr === -1) return { rows: [], weekIsos: [], error: 'No user/employee header found in ' + sheetName };
    var hdRow = raw[hr].map(function (c) { return String(c).trim(); });
    var iTeam = colIdx_(hdRow, ["Team"]);
    var iKey = colIdx_(hdRow, ["Key"]);
    var iPm = colIdx_(hdRow, ["PM"]); // per-project lead (both Tempo exports)
    // Week labels: the row ABOVE the field headers when it carries ISO labels
    // (two-row stacked export), else the field-header row itself (legacy).
    var wkRow = (hr > 0 && raw[hr - 1].some(function (cell) { return /^\d{4}\.W\d{1,2}$/.test(String(cell).trim()); }))
      ? raw[hr - 1] : raw[hr];
    var weekCols = [];
    wkRow.forEach(function (w, i) {
      var s = String(w).trim();
      if (/^\d{4}\.W\d{1,2}$/.test(s)) weekCols.push({ col: i, iso: s });
    });
    var rows = [];
    for (var r = hr + 1; r < raw.length; r++) {
      var user = String(raw[r][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var weekHours = {};
      weekCols.forEach(function (wc) {
        var v = Number(raw[r][wc.col]);
        if (v) weekHours[wc.iso] = (weekHours[wc.iso] || 0) + v;
      });
      rows.push({ user: user,
                  teamCell: iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim(),
                  key: iKey === -1 ? "" : String(raw[r][iKey] || "").trim().toUpperCase(),
                  pm: iPm === -1 ? "" : String(raw[r][iPm] || "").trim(),
                  weekHours: weekHours });
    }
    return { rows: rows, weekIsos: weekCols.map(function (w) { return w.iso; }) };
  } catch (e) {
    return { rows: [], weekIsos: [], error: sheetName + " read failed: " + e.message };
  }
}

/**
 * Level-token parser ported from CompDash's parseLevel_ (the proven
 * manager/IC splitter): extracts "I3"/"M10" from titles like "04.I3.1",
 * "04.M10.2", or "M5 - Manager, X". Boundary rules prevent false positives
 * on the word "Manager" or on codes like "PM5".
 * @returns {{level: string, track: ("IC"|"M"|null)}} level "—" when unparseable
 */
function dhLevelTrack_(jobTitle) {
  var m = String(jobTitle || "").match(/(?:^|[^A-Za-z0-9])([IM])(\d{1,2})(?![0-9])/i);
  if (!m) return { level: "—", track: null };
  var letter = m[1].toUpperCase();
  return { level: letter + parseInt(m[2], 10), track: letter === "I" ? "IC" : "M" };
}

/**
 * PTO usage per employee per ISO week from Accumulation Cost ledger rows
 * (pure — testable). Usage/TimeOff transactions carry the hours either as an
 * explicit amount or as the balance delta vs the previous transaction.
 * @param {Array<{empNum:string, date:Date, adjType:string,
 *                amount:(number|null), balance:(number|null)}>} rows
 * @param {string} unit "hours"|"days"   @param {number} hoursPerDay
 * @returns {{byEmp: Object<string, Object<string, number>>, skipped: number}}
 */
function ptoUsageFromRows_(rows, unit, hoursPerDay) {
  var byEmpRows = {};
  (rows || []).forEach(function (r, i) {
    if (!r.empNum || !r.date || isNaN(r.date.getTime())) return;
    (byEmpRows[r.empNum] = byEmpRows[r.empNum] || []).push({ r: r, seq: i });
  });
  var byEmp = {}, skipped = 0;
  Object.keys(byEmpRows).forEach(function (emp) {
    // Same-date rows (a NetSuite batch can post an accrual and a usage on one
    // day) must keep LEDGER ORDER: the delta fallback below reads prevBalance,
    // so reordering them would attribute the accrual's balance jump to the
    // usage. V8's sort is already stable, but seq makes that a guarantee of
    // this function rather than of the engine — the balance-delta path is the
    // one place where row order changes the reported hours.
    var list = byEmpRows[emp].slice()
      .sort(function (a, b) { return (a.r.date - b.r.date) || (a.seq - b.seq); })
      .map(function (x) { return x.r; });
    var prevBalance = null;
    list.forEach(function (r) {
      var t = String(r.adjType || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      var isUsage = t.indexOf("usage") !== -1 || t.indexOf("timeoff") !== -1;
      if (isUsage) {
        var hrs = r.amount !== null && r.amount !== undefined && !isNaN(r.amount)
          ? Math.abs(r.amount)
          : (prevBalance !== null && r.balance !== null && r.balance !== undefined
              ? Math.abs(r.balance - prevBalance) : null);
        if (hrs === null) { skipped++; }
        else {
          if (unit === "days") hrs *= hoursPerDay;
          var iso = weekKeyFromDate_(r.date);
          if (!byEmp[emp]) byEmp[emp] = {};
          byEmp[emp][iso] = (byEmp[emp][iso] || 0) + hrs;
        }
      }
      if (r.balance !== null && r.balance !== undefined && !isNaN(r.balance)) prevBalance = r.balance;
    });
  });
  return { byEmp: byEmp, skipped: skipped };
}

/**
 * Accumulation Cost reader (GAS): dated PTO transactions keyed by Employee
 * Number → weekly usage map via ptoUsageFromRows_. { ok:false } on any
 * failure — the caller falls back to the NETSUITE rows.
 */
function readPtoAccum_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var ssId = p.getProperty("DH_PTO_SS_ID") || CONFIG_DH.PTO_ACCUM_SS_ID;
    var sh = SpreadsheetApp.openById(ssId).getSheetByName(CONFIG_DH.PTO_ACCUM_SHEET);
    if (!sh) return { ok: false, byEmp: {}, error: 'Tab "' + CONFIG_DH.PTO_ACCUM_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { ok: false, byEmp: {}, error: "no data rows" };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee Number"]);
    var iDate = colIdx_(h, ["Date"]);
    var iBal = colIdx_(h, ["Balance"]);
    var iType = colIdx_(h, ["Adjustment Type"]);
    var iAmt = colIdx_(h, ["Amount", "Hours", "AdjustmentAmount", "AdjustmentHours"]);
    if (iEmp === -1 || iDate === -1 || iType === -1) {
      return { ok: false, byEmp: {}, error: "required columns missing (Employee Number/Date/Adjustment Type)" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var empRaw = raw[r][iEmp];
      var empNum = String(typeof empRaw === "number" ? Math.round(empRaw) : (empRaw || ""))
        .replace(/,/g, "").trim();
      if (!empNum) continue;
      var amt = iAmt === -1 ? null : parseFloat(raw[r][iAmt]);
      rows.push({ empNum: empNum, date: parseDhDate_(raw[r][iDate]),
                  adjType: String(raw[r][iType] || ""),
                  amount: isNaN(amt) ? null : amt,
                  balance: iBal === -1 ? null : (isNaN(parseFloat(raw[r][iBal])) ? null : parseFloat(raw[r][iBal])) });
    }
    var usage = ptoUsageFromRows_(rows, CONFIG_DH.PTO_UNIT, CONFIG_DH.PTO_HOURS_PER_DAY);
    return { ok: true, byEmp: usage.byEmp, skipped: usage.skipped, rowCount: rows.length };
  } catch (e) {
    return { ok: false, byEmp: {}, error: "Accumulation Cost read failed: " + e.message };
  }
}

/** True when a Tempo Key is a NETSUITE/time-off row. */
function isTimeOffKey_(key) {
  return CONFIG_DH.NONPROJECT_KEYS.some(function (k) {
    return String(key || "").toUpperCase().indexOf(k.toUpperCase()) === 0;
  });
}

/**
 * NS Billable daily rows → aggregateNsWeeks_ input.
 * Headers: Employee, Employee Type Category, Billable Hours Billed,
 * Billable Hours Unbilled, Total Billable Hours, Non-Billable Hours,
 * Total Hours (B+NB), Date.
 */
function readNsBillable_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.NS_SHEET);
    if (!sh) return { rows: [], error: 'Tab "' + CONFIG_DH.NS_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [] };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee", "Resource"]);
    var iBill = colIdx_(h, ["Total Billable Hours", "Total Billable"]);
    var iNon = colIdx_(h, ["Non-Billable Hours", "Non-Billable"]);
    var iDate = colIdx_(h, ["Date"]);
    if (iEmp === -1 || iDate === -1 || iBill === -1) {
      return { rows: [], error: "NS Billable: required columns missing" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var emp = String(raw[r][iEmp] || "").trim();
      var d = parseDhDate_(raw[r][iDate]);
      if (!emp || !d) continue;
      rows.push({ name: emp, date: d,
                  billable: Number(raw[r][iBill]) || 0,
                  nonBillable: iNon === -1 ? 0 : Number(raw[r][iNon]) || 0 });
    }
    return { rows: rows };
  } catch (e) {
    return { rows: [], error: "NS Billable read failed: " + e.message };
  }
}

/** PH tab (Date | Location | Holiday) → [{date, location}]. */
function readHolidays_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.PH_SHEET);
    if (!sh) return { rows: [] };  // silently off per spec §7
    var raw = sh.getDataRange().getValues();
    var h = raw[0].map(String);
    var iDate = colIdx_(h, ["Date"]), iLoc = colIdx_(h, ["Location"]);
    if (iDate === -1 || iLoc === -1) return { rows: [] };
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var d = parseDhDate_(raw[r][iDate]);
      var loc = String(raw[r][iLoc] || "").trim();
      if (d && loc) rows.push({ date: d, location: loc });
    }
    return { rows: rows };
  } catch (e) { return { rows: [] }; }
}

/**
 * Fuzzy PH-location ↔ roster Key Location matcher — ported verbatim from the
 * demand dashboard's phLocMatchesEmp_ (compound locations split on "&"/"and"/"/",
 * case-insensitive substring both directions, blank never matches).
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var a = normDH_(phLoc), b = normDH_(empLoc);
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  var parts = a.split(/\s*(?:&|\band\b|\/)\s*/).filter(Boolean);
  return parts.some(function (p) {
    return p.indexOf(b) !== -1 || b.indexOf(p) !== -1;
  });
}

/** Status names that mean the item is no longer open work (Jira Backlog.js convention). */
var DH_CLOSED_STATUS_ = /done|closed|resolved|complete|cancel|abandon|reject|won'?t|duplicate|deploy/i;

/**
 * Jira Raw → issues + epics for the tile buckets, keyRegion for person-region,
 * openIssues (unresolved, assigned) for the per-person backlog drill-down.
 * Columns by header name: Key(1), Work (Summary)(2), Workstream (Issue Type)(3),
 * Assignee(5), Priority(7), Status(8), Resolution Date(11), Due Date(12),
 * Epic Key(17), Original Estimate (sec)(23), Time Spent (sec)(24).
 * Rows repeat per weekly snapshot — dedupe on Key keeping the LAST occurrence
 * (latest snapshot wins).
 * @returns {{ issues:[], epics:[], openIssues:[], keyRegion:Object, available:boolean, error?:string }}
 */
function readJiraRaw_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
    if (!sh) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var h = raw[0].map(String);
    var iKey = colIdx_(h, ["Key"]);
    var iSummary = colIdx_(h, ["Work (Summary)", "Summary"]);
    var iType = colIdx_(h, ["Workstream (Issue Type)", "Issue Type"]);
    var iAssignee = colIdx_(h, ["Assignee"]);
    var iPriority = colIdx_(h, ["Priority"]);
    var iStatus = colIdx_(h, ["Status"]);
    var iRes = colIdx_(h, ["Resolution Date", "Resolved"]);
    var iDue = colIdx_(h, ["Due Date"]);
    var iEst = colIdx_(h, ["Original Estimate (sec)"]);
    var iSpent = colIdx_(h, ["Time Spent (sec)"]);
    // Region / Team: RETIRED upstream. Jira Backlog.js v3.3.0 dropped these two
    // Jira Raw columns because the underlying custom fields were never populated
    // (they always exported blank), so both lookups now return -1 permanently and
    // the guarded fallbacks below are the only live path: person region comes from
    // the roster (assignPersonRegion_ source:"roster"), team vocabulary from the
    // Tempo exports. Kept as lookups rather than deleted so an older Jira Raw
    // snapshot still parses identically.
    var iRegion = colIdx_(h, ["Region"]);
    var iTeam = colIdx_(h, ["Team"]);
    if (iKey === -1) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var byKey = {};
    for (var r = 1; r < raw.length; r++) {
      var key = String(raw[r][iKey] || "").trim().toUpperCase();
      if (!key) continue;
      // Jira Raw carries one row per issue PER WEEK BUCKET, and Jira Backlog.js
      // rewrites the whole tab (clearContents + setValues) on every export — so
      // duplicate rows for a key all come from the same API fetch and differ
      // only in the week label, which this dashboard never reads. Any row is
      // therefore equivalent; keeping the last is arbitrary, not chronological.
      byKey[key] = r;
    }
    var issues = [], epics = [], openIssues = [], keyRegion = {};
    Object.keys(byKey).forEach(function (key) {
      var r = byKey[key];
      var region = iRegion === -1 ? "" : String(raw[r][iRegion] || "").trim();
      var team = iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim();
      if (region) keyRegion[key] = region;
      var type = iType === -1 ? "" : normDH_(raw[r][iType]);
      var isEpic = type.indexOf("epic") !== -1;
      var rec = {
        isEpic: isEpic,
        due: iDue === -1 ? null : parseDhDate_(raw[r][iDue]),
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        estSec: iEst === -1 ? 0 : Number(raw[r][iEst]) || 0,
        spentSec: iSpent === -1 ? 0 : Number(raw[r][iSpent]) || 0,
        region: region || "Other", team: team,
        assignee: iAssignee === -1 ? "" : String(raw[r][iAssignee] || "").trim(),
      };
      issues.push(rec);
      if (isEpic) epics.push(rec);
      // Open backlog: assigned, unresolved, status not closed-ish, not an epic
      // (epics roll up their children — listing both would double the load).
      var assignee = rec.assignee;
      var status = iStatus === -1 ? "" : String(raw[r][iStatus] || "").trim();
      if (assignee && !/unassigned/i.test(assignee) && !rec.resolved &&
          !DH_CLOSED_STATUS_.test(status) && !isEpic) {
        openIssues.push({
          key: key,
          summary: iSummary === -1 ? "" : String(raw[r][iSummary] || "").trim(),
          assignee: assignee, status: status,
          priority: iPriority === -1 ? "" : String(raw[r][iPriority] || "").trim(),
          due: rec.due,
          remHrs: Math.max(0, rec.estSec - rec.spentSec) / 3600,
        });
      }
    });
    return { issues: issues, epics: epics, openIssues: openIssues, keyRegion: keyRegion, available: true };
  } catch (e) {
    return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false, error: e.message };
  }
}

/**
 * Groups open Jira issues by roster person (name-alias join). Items sorted by
 * remaining estimate DESC then due ASC, capped at BACKLOG_MAX_ITEMS per person —
 * count/estHrs totals always cover ALL of the person's open issues.
 * @returns {Object} display name → { count, remHrs, items:[] }
 */
function backlogByPerson_(openIssues, nameIdx) {
  var by = {};
  (openIssues || []).forEach(function (it) {
    var dn = resolveName_(nameIdx, it.assignee);
    if (!dn) return; // not in population
    if (!by[dn]) by[dn] = { count: 0, remHrs: 0, items: [] };
    by[dn].count++;
    by[dn].remHrs += it.remHrs;
    by[dn].items.push({ key: it.key, summary: it.summary, status: it.status,
                        priority: it.priority, remHrs: it.remHrs,
                        due: it.due ? weekKeyFromDate_(it.due) : "" });
  });
  Object.keys(by).forEach(function (dn) {
    by[dn].items.sort(function (a, b) {
      if (b.remHrs !== a.remHrs) return b.remHrs - a.remHrs;
      return (a.due || "9999").localeCompare(b.due || "9999");
    });
    by[dn].items = by[dn].items.slice(0, CONFIG_DH.BACKLOG_MAX_ITEMS);
    by[dn].remHrs = Math.round(by[dn].remHrs * 10) / 10;
  });
  return by;
}

// ── MODEL ASSEMBLY (pure — all reader outputs injected) ──────

function assembleModel_(inputs, win) {
  if (inputs.roster.error) {
    return { meta: {}, people: [], onTimeBuckets: [], forecastBuckets: [],
             error: inputs.roster.error };
  }
  // Population = tracking-mandated families only (JF007/JF009 + blank/crew).
  // Non-tracking families are dropped ENTIRELY — their capacity means nothing
  // without a planning+tracking obligation (user decision 2026-07-31).
  var population = inputs.roster.people.filter(function (p) { return p.tracks !== false; });
  var displayNames = population.map(function (p) { return p.name; });
  var nameIdx = buildNameIndex_(displayNames);
  var byPerson = {}; // display name → accumulator
  population.forEach(function (p) {
    byPerson[p.name] = { roster: p, teams: [], pms: [], weeks: {}, regionHours: {} };
  });

  // Tempo tracked/planned rows → per-person weekly sums, team collection,
  // PTO (NETSUITE planned rows), region-tagged hours (tracked keys × Jira Region)
  function eachTempoRow_(row, kind) {
    var dn = resolveName_(nameIdx, row.user);
    if (!dn) return; // not in population — excluded per spec §7
    var acc = byPerson[dn];
    splitTeams_(row.teamCell).forEach(function (t) {
      if (acc.teams.indexOf(t) === -1) acc.teams.push(t);
    });
    var timeOff = isTimeOffKey_(row.key);
    // PM membership: the person works on a project this PM leads (never from
    // NETSUITE time-off rows — those carry no project).
    if (row.pm && !timeOff && acc.pms.indexOf(row.pm) === -1) acc.pms.push(row.pm);
    Object.keys(row.weekHours).forEach(function (iso) {
      if (win.allWeeks.indexOf(iso) === -1) return;
      if (!acc.weeks[iso]) acc.weeks[iso] = { pto: 0, planned: 0, tracked: 0 };
      var h = row.weekHours[iso];
      if (kind === "planned") {
        if (timeOff) acc.weeks[iso].pto += h;
        else acc.weeks[iso].planned += h;
      } else if (!timeOff) {
        acc.weeks[iso].tracked += h;
        var region = inputs.jira.keyRegion[row.key];
        if (region) acc.regionHours[region] = (acc.regionHours[region] || 0) + h;
      }
    });
  }
  inputs.planned.rows.forEach(function (r) { eachTempoRow_(r, "planned"); });
  inputs.tracked.rows.forEach(function (r) { eachTempoRow_(r, "tracked"); });

  // NS billable weekly aggregation, joined through the alias index.
  // Unmatched employee names are counted, not just dropped: a silent join failure
  // reads downstream as "this person billed nothing", which is indistinguishable
  // from a real 0% — so meta.nsCoverage reports it (audit fix 2026-08-03).
  var nsAvailable = !inputs.ns.error;
  var ptoAccumOk = !!(inputs.pto && inputs.pto.ok);
  var ptoByEmp = ptoAccumOk ? inputs.pto.byEmp : {};
  var nsUnmatched = { rows: 0, hours: 0, names: {} };
  var nsWeekly = aggregateNsWeeks_(inputs.ns.rows.map(function (r) {
    var dn = resolveName_(nameIdx, r.name);
    if (!dn) {
      nsUnmatched.rows++;
      nsUnmatched.hours += (Number(r.billable) || 0) + (Number(r.nonBillable) || 0);
      nsUnmatched.names[String(r.name || "").trim()] = 1;
      return null;
    }
    return { name: dn, date: r.date, billable: r.billable, nonBillable: r.nonBillable };
  }).filter(Boolean));

  // Holiday hours per person-week (fuzzy location match, per-day hours by region)
  var holByPersonWeek = {}; // dn → iso → hrs
  inputs.holidays.rows.forEach(function (hrow) {
    var iso = weekKeyFromDate_(hrow.date);
    if (win.allWeeks.indexOf(iso) === -1) return;
    population.forEach(function (p) {
      if (!phLocMatchesEmp_(hrow.location, p.keyLocation)) return;
      var perDay = normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
        ? CONFIG_DH.ANZ_HOLIDAY_HRS_PER_DAY : CONFIG_DH.HOLIDAY_HRS_PER_DAY;
      if (!holByPersonWeek[p.name]) holByPersonWeek[p.name] = {};
      holByPersonWeek[p.name][iso] = (holByPersonWeek[p.name][iso] || 0) + perDay;
    });
  });

  // Assemble people records
  var capMap = inputs.capacity.byName || {};
  var backlogMap = backlogByPerson_(inputs.jira.openIssues, nameIdx);
  var teamSet = {}, famSet = {}, pmSet = {};
  var people = displayNames.slice().sort(function (a, b) {
    return a.localeCompare(b);
  }).map(function (dn) {
    var acc = byPerson[dn], p = acc.roster;
    var reg = assignPersonRegion_(acc.regionHours, p.rosterBucket);
    acc.teams.forEach(function (t) { teamSet[t] = 1; });
    acc.pms.forEach(function (m) { pmSet[m] = 1; });
    famSet[p.jobFamily || "Uncatalogued"] = 1;
    var weeks = {};
    win.allWeeks.forEach(function (iso) {
      // Pre-hire weeks do not exist for this person: no capacity, no metric
      // denominators, no grid cell (user decision 2026-07-31 — a new hire must
      // never drag any metric for weeks before they were in the company).
      if (p.hireDate && isoWeekBefore_(iso, p.hireDate)) return;
      var w = acc.weeks[iso] || { pto: 0, planned: 0, tracked: 0 };
      var capCell = capMap[normDH_(dn)] ? capMap[normDH_(dn)][iso] : undefined;
      var capEst = capCell === undefined;
      var cap = capEst
        ? (normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
            ? CONFIG_DH.ANZ_CAPACITY_HRS : CONFIG_DH.WEEKLY_CAPACITY_HRS)
        : capCell;
      var holHrs = (holByPersonWeek[dn] && holByPersonWeek[dn][iso]) || 0;
      // PTO precedence (user decision 2026-08-01): the Accumulation Cost ledger
      // (joined by Employee Number) is the source of truth; the NETSUITE rows
      // in Planned Time Tempo are only the fallback when that workbook is
      // unreadable or the person has no Employee Number.
      var ptoH = w.pto;
      if (ptoAccumOk) {
        ptoH = (p.empNum && ptoByEmp[p.empNum] && ptoByEmp[p.empNum][iso]) || 0;
        if (!p.empNum) ptoH = w.pto; // no join key → keep NETSUITE rows for this person
      }
      var net = netCapacity_(cap, ptoH, holHrs);
      var ns = (nsWeekly[normDH_(dn)] && nsWeekly[normDH_(dn)][iso]) || { billable: 0, nonBillable: 0 };
      // ── NS CLASSIFIES, TEMPO QUANTIFIES (user decision 2026-08-03) ──
      // Tempo is the source of truth for HOW MANY hours were worked; NS is the
      // source of truth for WHAT KIND. So the NS billable/non-billable split is
      // applied as a RATIO to the Tempo tracked total rather than being carried
      // as absolute hours.
      //
      // Why: the two feeds are independent, so NS absolutes are not bounded by
      // hours anyone actually logged. Carrying them directly let billable hours
      // exceed tracked hours, and billable ÷ available then reported utilization
      // that no worklog supported — the headline inflated by exactly the feed
      // disagreement. Under the ratio, billable + nonBillable === tracked by
      // construction, so billableUtil can never exceed trackedUtil.
      //
      // NS "Non-Billable Hours" = REAL project non-billable work. PTO/holidays
      // live ONLY in the Time off Report (the NETSUITE rows + PH tab feeding
      // pto/hol above) — they never appear in this bucket, so nothing is netted
      // out (user clarification 2026-08-01, reverting the same-day OOO
      // subtraction). PTO's only metric effect is shrinking the avail denominator.
      var nsTot = ns.billable + ns.nonBillable;
      // No NS signal for this person-week = UNCLASSIFIABLE, not 0% billable. The
      // week keeps its tracked hours but leaves the billable numerator AND its
      // matching denominator (availCov) entirely — otherwise an export that lags
      // or covers fewer weeks than the trend window paints real zeros and the
      // sparkline shows a ramp that is pure coverage.
      var nsCov = nsAvailable && nsTot > 0;
      var share = nsCov ? ns.billable / nsTot : null;
      weeks[iso] = { cap: cap, capEst: capEst, pto: ptoH, hol: net.hol, avail: net.avail,
                     planned: w.planned, tracked: w.tracked,
                     nsCov: nsCov,
                     availCov: nsCov ? net.avail : 0,
                     trackedCov: nsCov ? w.tracked : 0,
                     billShare: share,
                     billable: nsCov ? w.tracked * share : 0,
                     nonBillable: nsCov ? w.tracked * (1 - share) : 0,
                     // Finance's raw NS absolutes, kept for the drill-down and the
                     // reconciliation flag — never used in any rate.
                     nsBillRaw: ns.billable, nsNonBillRaw: ns.nonBillable };
    });
    return { name: dn, region: reg.region, regionSource: reg.source,
             teams: acc.teams.slice().sort(), pms: acc.pms.slice().sort(), isCrew: p.isCrew,
             jobTitle: p.jobTitle || "",
             onLeave: p.onLeave === true, leaveStatus: p.leaveStatus || "",
             // Manager = M career track in the title level token, parsed the
             // same way CompDash splits managers from ICs (dhLevelTrack_).
             isManager: dhLevelTrack_(p.jobTitle).track === "M",
             jobFamily: p.jobFamily || "", tracks: p.tracks !== false,
             newHire: isDhNewHire_(p.hireDate, win.today || new Date()),
             hired: dhDateStr_(p.hireDate),
             backlog: backlogMap[dn] || null, weeks: weeks };
  });

  // Jira buckets, person-attributed via Assignee → roster (user decision
  // 2026-07-31: every filter drives every KPI card). Bucket teams no longer
  // feed the Team dropdown — the vocabulary is Tempo teams only.
  var resolvePerson = function (raw) { return raw ? resolveName_(nameIdx, raw) : null; };
  var onTime = inputs.jira.available
    ? onTimeBuckets_(inputs.jira.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  var forecast = inputs.jira.available
    ? forecastBuckets_(inputs.jira.epics, resolvePerson) : { buckets: [], unattributed: 0 };

  return {
    schemaVer: DH_SCHEMA_VER_,
    meta: {
      gridWeeks: win.gridWeeks, trendWeeks: win.trendWeeks, headlineIso: win.headlineIso,
      periods: buildPeriods_(win),
      generatedAt: new Date().toISOString(),
      thresholds: { green: CONFIG_DH.TINT_GREEN, amber: CONFIG_DH.TINT_AMBER },
      targets: CONFIG_DH.TARGETS,
      regions: ["AMER", "EMEA", "APAC", "ANZ", "Other"],
      teams: Object.keys(teamSet).sort(),
      pms: Object.keys(pmSet).sort(),
      families: Object.keys(famSet).sort(),
      nsAvailable: nsAvailable, jiraAvailable: !!inputs.jira.available,
      // NS join/coverage telemetry — the billable split is only as good as this.
      // Reported so a low rate can be read as "poor coverage" vs "low billing",
      // the same way jiraUnattributed qualifies the issue tiles.
      nsCoverage: nsCoverage_(people, nsUnmatched),
      jiraUnattributed: { onTime: onTime.unattributed, forecast: forecast.unattributed },
      // Which issue types the On-Time rate covers — the card names it so the
      // number is never read as "all delivery work" when it isn't.
      onTimeScope: CONFIG_DH.ONTIME_SCOPE || "delivery",
      ptoSource: ptoAccumOk ? "accumulation" : "netsuite-fallback",
      capacityError: inputs.capacity.error || null,
    },
    people: people, onTimeBuckets: onTime.buckets, forecastBuckets: forecast.buckets,
  };
}

/**
 * Payload schema version — BUMP THIS on every payload-shape change (new/renamed
 * fields, re-keyed buckets). getDeliveryData treats a cached model with a
 * different schemaVer as a clean miss, so a deploy can never serve a
 * stale-shaped cache entry (the "empty cards until someone busts the cache" bug).
 */
// v5: On-Time excludes epics; forecast buckets gain nNoTime/nOver/nUnder/
//     lossOver/lossUnder (variance direction) and skip zero-worklog epics.
// v6: WEEKS_PAST_DEEP 30 → 52. The shape is unchanged, but a cached v5 model
//     carries only 34 weeks of people[].weeks — served as-is, the Quarterly
//     view would render its older quarters as empty (which reads as zero
//     activity, not missing data). Bumping forces one clean rebuild.
// v7: billable/nonBillable are now the NS split applied as a RATIO to Tempo
//     tracked hours, not NS absolute hours. New per-week fields nsCov/availCov/
//     trackedCov/billShare/nsBillRaw/nsNonBillRaw + meta.nsCoverage. A cached v6
//     model would keep serving the inflated absolutes against the wrong
//     denominator, so this MUST force a rebuild.
var DH_SCHEMA_VER_ = 7;

/** Full I/O compute — shared by getDeliveryData and warmDeliveryCache. */
function buildDeliveryModel_() {
  var win = buildDhWindow_(new Date());
  return assembleModel_({
    roster: readRosterPeople_(),
    capacity: readCapacitySheet_(),
    tracked: readTempoGrid_(CONFIG_DH.TRACKED_SHEET),
    planned: readTempoGrid_(CONFIG_DH.PLANNED_SHEET),
    ns: readNsBillable_(),
    pto: readPtoAccum_(),
    holidays: readHolidays_(),
    jira: readJiraRaw_(),
  }, win);
}

// ── ENTRY POINT + DATA ENDPOINT ──────────────────────────────

function doGet() {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle(CONFIG_DH.TITLE + " — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle(CONFIG_DH.TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDeliveryData(forceRefresh) {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return { error: "Access restricted to authorized users.", meta: {}, people: [] };
  }
  var cache = CacheService.getScriptCache();
  var key = deliveryCacheKey_();
  if (!forceRefresh) {
    var hit = cacheGetLarge_(cache, key);
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        // Schema guard: a cache entry built by OLDER code has a different
        // shape — serving it renders empty/broken cards and users start
        // "fixing" it by refreshing. Mismatch = clean miss, recompute,
        // overwrite. Self-healing on every deploy; no manual bust needed
        // for shape changes (bustDeliveryCache_ remains for data resets).
        if (cached.schemaVer === DH_SCHEMA_VER_) {
          cached.viewerRole = access.role;
          cached.viewerEmail = access.email;
          return cached;
        }
        Logger.log("ℹ️ getDeliveryData: cache schema v" + cached.schemaVer +
                   " ≠ v" + DH_SCHEMA_VER_ + " — stale shape, recomputing");
      } catch (e) { Logger.log("⚠️ getDeliveryData: bad cache entry — recomputing"); }
    }
  }
  var model = buildDeliveryModel_();
  if (!model.error) cachePutLarge_(cache, key, JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  model.viewerRole = access.role;
  model.viewerEmail = access.email;
  return model;
}

// ── CACHE WARMER ─────────────────────────────────────────────

function warmDeliveryCache() {
  var s0 = Date.now();
  var model = buildDeliveryModel_();
  var secs = Math.round((Date.now() - s0) / 1000);
  if (model.error) { Logger.log("❌ warmDeliveryCache after " + secs + "s: " + model.error); return; }
  var ok = cachePutLarge_(CacheService.getScriptCache(), deliveryCacheKey_(),
                          JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  Logger.log(ok ? "✅ warmDeliveryCache: rebuilt in " + secs + "s"
                : "❌ warmDeliveryCache: compute ok but cache write failed");
}

function setupDeliveryCacheWarmer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "warmDeliveryCache"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("warmDeliveryCache").timeBased()
    .everyMinutes(CONFIG_DH.CACHE_WARM_EVERY_MIN).create();
  Logger.log("✅ Delivery cache warmer installed — every " + CONFIG_DH.CACHE_WARM_EVERY_MIN + " min");
}

// ── DIAGNOSTICS (run once in the GAS editor after deploy) ────

/** Verifies every source is reachable and logs shape + join coverage. */
function probeDeliverySources() {
  var r = readRosterPeople_();
  Logger.log("Roster: " + r.people.length + " people" + (r.error ? " — ❌ " + r.error : ""));
  var c = readCapacitySheet_();
  Logger.log("Capacity: " + Object.keys(c.byName).length + " users" + (c.error ? " — ⚠️ " + c.error : ""));
  var t = readTempoGrid_(CONFIG_DH.TRACKED_SHEET);
  Logger.log("Tracked: " + t.rows.length + " rows / weeks " + t.weekIsos.join(","));
  var p = readTempoGrid_(CONFIG_DH.PLANNED_SHEET);
  Logger.log("Planned: " + p.rows.length + " rows");
  // PM coverage (feeds the PM filter): distinct PMs seen across both exports.
  var pmSeen = {};
  t.rows.concat(p.rows).forEach(function (row) { if (row.pm) pmSeen[row.pm] = (pmSeen[row.pm] || 0) + 1; });
  var pmNames = Object.keys(pmSeen);
  Logger.log(pmNames.length
    ? "PMs: " + pmNames.length + " distinct (" + pmNames.slice(0, 5).join(", ") + (pmNames.length > 5 ? ", …" : "") + ")"
    : "⚠️ PMs: none found — check the PM column exists in both Tempo export tabs (PM filter will be empty)");
  var ns = readNsBillable_();
  Logger.log("NS Billable: " + ns.rows.length + " rows" + (ns.error ? " — ⚠️ " + ns.error : ""));
  if (ns.rows.length) Logger.log("NS sample Employee: \"" + ns.rows[0].name + "\" (verify name format — spec §10.1)");
  var j = readJiraRaw_();
  Logger.log("Jira Raw: available=" + j.available + ", issues=" + j.issues.length +
             ", epics=" + j.epics.length + ", open assigned=" + j.openIssues.length);
  var idx = buildNameIndex_(r.people.map(function (x) { return x.name; }));
  var nsMatched = ns.rows.filter(function (row) { return resolveName_(idx, row.name); }).length;
  Logger.log("NS→roster join: " + nsMatched + "/" + ns.rows.length + " rows matched");

  // PTO source (Accumulation Cost ledger — primary since 2026-08-01)
  var pto = readPtoAccum_();
  if (!pto.ok) {
    Logger.log("⚠️ PTO Accumulation: UNREADABLE (" + (pto.error || "?") + ") — dashboard falls back to NETSUITE rows");
  } else {
    var emps = Object.keys(pto.byEmp);
    var withEmpNum = r.people.filter(function (x) { return x.empNum; }).length;
    var joined = r.people.filter(function (x) { return x.empNum && pto.byEmp[x.empNum]; }).length;
    var sample = [];
    emps.slice(0, 20).forEach(function (e) {
      Object.keys(pto.byEmp[e]).forEach(function (iso) { sample.push(pto.byEmp[e][iso]); });
    });
    var maxV = sample.length ? Math.max.apply(null, sample) : 0;
    Logger.log("PTO Accumulation: " + pto.rowCount + " tx rows, " + emps.length + " employees, " +
               pto.skipped + " amount-less usages skipped; roster empNum coverage " + withEmpNum + "/" +
               r.people.length + ", ledger join " + joined + " people");
    if (maxV > 0 && maxV <= 6) {
      Logger.log("⚠️ PTO unit check: max weekly usage sample is " + maxV +
                 " — values this small suggest the ledger is in DAYS; set CONFIG_DH.PTO_UNIT = \"days\"");
    }
  }

  // Region vocabulary check (final-review finding I3): the chip list is the
  // hardcoded meta.regions — Jira Region values that don't match it would make
  // every chip look empty. Any value logged outside the expected set must be
  // added to the chip vocabulary or mapped before trusting region filters.
  //
  // Jira Backlog.js v3.3.0 retired the Jira Raw "Region" column (it always
  // exported blank), so keyRegion is expected to be empty now and region comes
  // from the roster. That case is called out explicitly — an empty map would
  // otherwise sail through the check below and print "✅ all match", which reads
  // as a verified pass when nothing was actually checked.
  var expected = { "AMER": 1, "EMEA": 1, "APAC": 1, "ANZ": 1, "Other": 1 };
  var seen = {};
  Object.keys(j.keyRegion).forEach(function (k) { seen[j.keyRegion[k]] = (seen[j.keyRegion[k]] || 0) + 1; });
  var unexpected = Object.keys(seen).filter(function (v) { return !(v in expected); });
  if (!Object.keys(seen).length) {
    Logger.log("ℹ️ No Jira region values — expected: the Jira Raw Region column was retired in " +
               "Jira Backlog.js v3.3.0. Person region resolves from the roster instead.");
  } else {
    Logger.log("Jira Region distinct values: " + JSON.stringify(seen));
    Logger.log(unexpected.length
      ? "⚠️ Region values NOT in the chip vocabulary (AMER/EMEA/APAC/ANZ/Other): " + unexpected.join(", ")
      : "✅ All Jira Region values match the chip vocabulary");
  }
}

/** Spec §10.5 — Jira Raw fill-rate audit. Run once before trusting the tiles. */
function auditJiraFillRates() {
  var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
  if (!sh) { Logger.log("❌ Jira Raw tab not found"); return; }
  var raw = sh.getDataRange().getValues();
  var h = raw[0].map(String);
  // Region/Team deliberately absent from this list — Jira Backlog.js v3.3.0
  // removed those columns, so auditing them would report a "❌ column missing"
  // defect for a decision, and train the reader to ignore this audit's ❌ lines.
  ["Due Date", "Original Estimate (sec)"].forEach(function (col) {
    var i = colIdx_(h, [col]);
    if (i === -1) { Logger.log("❌ column missing: " + col); return; }
    var filled = 0;
    for (var r = 1; r < raw.length; r++) if (String(raw[r][i] || "").trim()) filled++;
    Logger.log(col + ": " + filled + "/" + (raw.length - 1) + " filled (" +
               Math.round(filled / (raw.length - 1) * 100) + "%)");
  });
}

// ── TESTS ────────────────────────────────────────────────────

function _test_dhWindow_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_dhWindow_: " + m); }
  // 2026-07-31 is a Friday in ISO 2026.W31
  var w = buildDhWindow_(new Date(2026, 6, 31));
  assert_(w.gridWeeks.length === 6, "grid = 6 weeks");
  assert_(w.gridWeeks.map(function (x) { return x.iso; }).join("|") ===
          "2026.W29|2026.W30|2026.W31|2026.W32|2026.W33|2026.W34", "grid labels");
  assert_(w.gridWeeks[2].status === "now" && w.gridWeeks[0].status === "done" &&
          w.gridWeeks[5].status === "plan", "statuses");
  assert_(w.trendWeeks.join("|") ===
          "2026.W25|2026.W26|2026.W27|2026.W28|2026.W29|2026.W30", "trend = 6 completed");
  assert_(w.headlineIso === "2026.W30", "headline = last completed");
  // Derived from CONFIG_DH, not hardcoded: the depth is a tuning dial that
  // moves with the exporters' window, and a literal here just breaks the suite
  // every time it changes instead of testing anything.
  var expDeep = CONFIG_DH.WEEKS_PAST_DEEP + 1 + CONFIG_DH.WEEKS_FUTURE;
  assert_(w.allWeeks.length === expDeep,
          "allWeeks spans deep history→future (" + CONFIG_DH.WEEKS_PAST_DEEP + "+1+" +
          CONFIG_DH.WEEKS_FUTURE + " = " + expDeep + "), got " + w.allWeeks.length);
  assert_(w.allWeeks[w.allWeeks.length - 1] === "2026.W34", "allWeeks ends at the future horizon");
  assert_(w.allWeeks.indexOf("2026.W31") === CONFIG_DH.WEEKS_PAST_DEEP,
          "the current week sits exactly WEEKS_PAST_DEEP into allWeeks");
  // Year boundary: 2026-01-01 is Thursday of ISO 2026.W1 → past weeks wrap into 2025
  var y = buildDhWindow_(new Date(2026, 0, 1));
  assert_(y.trendWeeks[0].indexOf("2025.") === 0, "trend wraps into prior ISO year");
  assert_(weekKeyFromDate_(new Date(2026, 6, 27)) === "2026.W31", "Mon 2026-07-27 → W31");
  assert_(weekKeyFromDate_(new Date(2026, 7, 2)) === "2026.W31", "Sun 2026-08-02 → W31");
  Logger.log("✅ _test_dhWindow_ passed");
}

function _test_nameJoin_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nameJoin_: " + m); }
  assert_(normDH_("  Maria   ALVAREZ ") === "maria alvarez", "normalize whitespace+case");
  var a = nameAliases_("Alvarez, Maria");
  // "Last, First" cell → also match "First Last" and "Last First"
  assert_(a.indexOf("alvarez, maria") !== -1 && a.indexOf("maria alvarez") !== -1 &&
          a.indexOf("alvarez maria") !== -1, "comma cell yields all variants");
  var b = nameAliases_("Maria Alvarez");
  assert_(b.indexOf("maria alvarez") !== -1 && b.length === 1, "no-comma name = itself only");
  // Index build + lookup: NS "Last, First" resolves to roster "First Last"
  var idx = buildNameIndex_(["Maria Alvarez", "Tom Baker"]);
  assert_(resolveName_(idx, "ALVAREZ,  Maria") === "Maria Alvarez", "comma variant resolves");
  assert_(resolveName_(idx, "Tom Baker") === "Tom Baker", "exact resolves");
  assert_(resolveName_(idx, "Nobody Here") === null, "unknown → null");
  Logger.log("✅ _test_nameJoin_ passed");
}

function _test_teamSplit_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_teamSplit_: " + m); }
  assert_(splitTeams_("Team A | Team B").join("|") === "Team A|Team B", "split pipe-join");
  assert_(splitTeams_(" Team A ").join("|") === "Team A", "single team trimmed");
  assert_(splitTeams_("").length === 0 && splitTeams_(null).length === 0, "blank → []");
  assert_(splitTeams_("A | A | B").join("|") === "A|B", "dedup within a cell");
  Logger.log("✅ _test_teamSplit_ passed");
}

function _test_nsWeekBucketing_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nsWeekBucketing_: " + m); }
  var rows = [
    { name: "Maria Alvarez", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 }, // Mon W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 2),  billable: 4, nonBillable: 0 }, // Sun W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 3),  billable: 8, nonBillable: 0 }, // Mon W32
    { name: "Tom Baker",     date: new Date(2026, 6, 28), billable: 0, nonBillable: 8 },
  ];
  var m = aggregateNsWeeks_(rows);
  assert_(m["maria alvarez"]["2026.W31"].billable === 10, "Mon+Sun same ISO week");
  assert_(m["maria alvarez"]["2026.W31"].nonBillable === 2, "nonBillable summed");
  assert_(m["maria alvarez"]["2026.W32"].billable === 8, "Monday starts next week");
  assert_(m["tom baker"]["2026.W31"].billable === 0 && m["tom baker"]["2026.W31"].nonBillable === 8, "zero billable kept");
  Logger.log("✅ _test_nsWeekBucketing_ passed");
}

function _test_netCapacity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_netCapacity_: " + m); }
  // holiday hrs arg is the person's holiday hours that week BEFORE dedup vs booked PTO
  assert_(netCapacity_(40, 8, 0).avail === 32, "cap − pto");
  assert_(netCapacity_(40, 0, 8).avail === 32, "cap − holiday");
  // booked-holiday no-double-count: effective holiday = max(0, hol − pto)
  var n = netCapacity_(40, 8, 8);
  assert_(n.avail === 32 && n.hol === 0, "booked holiday not double-counted");
  var p = netCapacity_(40, 4, 8);
  assert_(p.hol === 4 && p.avail === 32, "partial booking subtracts remainder only");
  assert_(netCapacity_(32, 40, 0).avail === 0, "floor at 0");
  assert_(netCapacity_(0, 8, 0).avail === 0, "zero capacity stays 0");
  // Part-timer in a two-holiday week: holiday hours can exceed the whole
  // schedule (ANZ 38h contract vs a 16h public-holiday pair on a 8h/wk row).
  var ph = netCapacity_(8, 0, 16);
  assert_(ph.avail === 0 && ph.hol === 16, "holiday > capacity floors avail, hol stays gross");
  var pq = netCapacity_(8, 4, 16);
  assert_(pq.avail === 0 && pq.hol === 12, "holiday > capacity with partial PTO booking");
  Logger.log("✅ _test_netCapacity_ passed");
}

function _test_regionMap_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionMap_: " + m); }
  assert_(regionBucketFromLocation_("Malaysia") === "APAC", "known location");
  assert_(regionBucketFromLocation_("  MALAYSIA ") === "APAC", "case/space insensitive");
  assert_(regionBucketFromLocation_("Atlantis") === "Other", "unknown → Other");
  assert_(regionBucketFromLocation_("") === "Other", "blank → Other");
  Logger.log("✅ _test_regionMap_ passed");
}

function _test_personRegion_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personRegion_: " + m); }
  // hoursByRegion from Key→Jira Raw join over the trend window
  var r = assignPersonRegion_({ "AMER": 60, "EMEA": 20 }, "APAC");
  assert_(r.region === "AMER" && r.source === "jira", "majority wins");
  var t = assignPersonRegion_({ "AMER": 40, "EMEA": 40 }, "APAC");
  assert_(t.region === "AMER" && t.source === "jira", "tie → alphabetical (deterministic)");
  var f = assignPersonRegion_({}, "APAC");
  assert_(f.region === "APAC" && f.source === "roster", "no tagged hours → roster fallback");
  var z = assignPersonRegion_({ "AMER": 0 }, "APAC");
  assert_(z.region === "APAC" && z.source === "roster", "zero hours = untagged");
  Logger.log("✅ _test_personRegion_ passed");
}

function _test_overflowClamp_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_overflowClamp_: " + m); }
  var ok = clampToCapacity_(30, 40);
  assert_(ok.pct === 75 && ok.over === false, "under capacity");
  var over = clampToCapacity_(44, 40);
  assert_(over.pct === 100 && over.over === true && over.realPct === 110, "clamped + flagged");
  assert_(clampToCapacity_(10, 0).pct === null, "zero capacity → null pct");
  Logger.log("✅ _test_overflowClamp_ passed");
}

function _test_utilizationRollup_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_utilizationRollup_: " + m); }
  var people = [
    { name: "A", region: "AMER", teams: ["T1", "T2"],
      weeks: { W1: { avail: 32, availCov: 32, billable: 24, tracked: 28, planned: 30 } } },
    { name: "B", region: "EMEA", teams: ["T2"],
      weeks: { W1: { avail: 40, availCov: 40, billable: 10, tracked: 20, planned: 40 } } },
    { name: "C", region: "AMER", teams: [],
      weeks: { W1: { avail: 0, availCov: 0, billable: 0, tracked: 0, planned: 0 } } }, // full-PTO week
  ];
  var all = utilRollup_(people, "W1", null, null);
  // avail 72, billable 34 → 47.2%
  assert_(Math.abs(all.billablePct - 34 / 72 * 100) < 1e-9, "billable util all");
  assert_(Math.abs(all.trackedPct - 48 / 72 * 100) < 1e-9, "tracked util all");
  var amer = utilRollup_(people, "W1", "AMER", null);
  assert_(amer.avail === 32 && amer.billable === 24, "region filter");
  var t2 = utilRollup_(people, "W1", null, "T2");
  assert_(t2.avail === 72, "team membership filter (A on T1|T2 counts in T2)");
  var t1 = utilRollup_(people, "W1", null, "T1");
  assert_(t1.avail === 32, "single-team filter");
  assert_(utilRollup_(people, "W9", null, null).billablePct === null, "no data week → null");
  // Coverage-matched denominator (audit 2026-08-03): an NS-uncovered week keeps
  // its tracked hours in trackedPct but leaves billablePct entirely — its avail
  // must NOT sit in the billable denominator with a forced-zero numerator.
  var partial = [
    { name: "A", region: "AMER", teams: [],
      weeks: { W1: { avail: 40, availCov: 40, billable: 30, tracked: 40, planned: 40, nsCov: true } } },
    { name: "B", region: "AMER", teams: [], // NS export hasn't reached this person yet
      weeks: { W1: { avail: 40, availCov: 0, billable: 0, tracked: 36, planned: 40, nsCov: false } } },
  ];
  var pr = utilRollup_(partial, "W1", null, null);
  assert_(Math.abs(pr.billablePct - 75) < 1e-9, "uncovered week excluded from billable denominator");
  assert_(Math.abs(pr.trackedPct - 76 / 80 * 100) < 1e-9, "uncovered week still counts in tracked util");
  // Ratio invariant: billable can never exceed tracked, so billable util can
  // never exceed tracked util on the same covered base (the old inflation).
  var same = [{ name: "A", region: "AMER", teams: [],
    weeks: { W1: { avail: 40, availCov: 40, billable: 40, tracked: 40, planned: 40, nsCov: true } } }];
  var sm = utilRollup_(same, "W1", null, null);
  assert_(sm.billablePct <= sm.trackedPct + 1e-9, "billable util never exceeds tracked util");
  // Non-tracking carve: tracks:false excluded by default, back via the include flag;
  // legacy people without the flag (undefined) stay included.
  var mixed = people.concat([{ name: "D", region: "AMER", teams: [], tracks: false,
    weeks: { W1: { avail: 40, availCov: 40, billable: 0, tracked: 0, planned: 40 } } }]);
  assert_(utilRollup_(mixed, "W1", null, null).avail === 72, "tracks:false carved out by default");
  assert_(utilRollup_(mixed, "W1", null, null, true).avail === 112, "include flag brings them back");
  // Long-leave carve: onLeave people never move utilization, even with the
  // include flag — leave is an absence, not a tracking-scope decision.
  var withLeave = people.concat([{ name: "E", region: "AMER", teams: [], onLeave: true,
    weeks: { W1: { avail: 40, availCov: 40, billable: 0, tracked: 0, planned: 40 } } }]);
  assert_(utilRollup_(withLeave, "W1", null, null).avail === 72, "onLeave excluded by default");
  assert_(utilRollup_(withLeave, "W1", null, null, true).avail === 72, "onLeave excluded even with include flag");
  Logger.log("✅ _test_utilizationRollup_ passed");
}

function _test_familyTracks_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_familyTracks_: " + m); }
  assert_(dhFamilyFromTitle_("", "08.I4.1 Senior Trainer") === "Training & Customer Education", "JF008 from title prefix");
  assert_(dhFamilyFromTitle_("", "15.M4.1 Manager, Operations") === "Operations", "JF015 from title prefix");
  assert_(dhFamilyFromTitle_("", "18.I6.2 Solution Architect") === "Solution Architecture", "JF018 from title prefix");
  assert_(dhFamilyFromTitle_("Operations", "09.I3.2 Consultant") === "Operations", "explicit Job Family cell wins");
  assert_(dhFamilyFromTitle_("", "Crew Member") === "", "uncoded title → blank family");
  assert_(dhTracksTime_("Managed Services & Support") === true, "JF007 tracks");
  assert_(dhTracksTime_("Service Delivery") === true, "JF009 tracks");
  assert_(dhTracksTime_("Training & Customer Education") === false, "JF008 no mandate");
  assert_(dhTracksTime_("Operations") === false, "JF015 no mandate");
  assert_(dhTracksTime_("Solution Architecture") === false, "JF018 no mandate");
  assert_(dhTracksTime_("") === true, "blank/unknown family = tracking-required (crew)");
  Logger.log("✅ _test_familyTracks_ passed");
}

function _test_rosterActive_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_rosterActive_: " + m); }
  assert_(dhRosterRowActive_("Active", "") === true, "active row stays");
  assert_(dhOnLeave_("Maternity Leave") === true && dhOnLeave_("Leave of Absence") === true,
          "leave statuses flagged");
  assert_(dhOnLeave_("Active") === false && dhOnLeave_("Terminated") === false,
          "active/terminated never flagged on-leave");
  assert_(dhRosterRowActive_("", "") === true, "blank status = active (no gone marker)");
  assert_(dhRosterRowActive_("Terminated", "") === false, "terminated status dropped");
  assert_(dhRosterRowActive_("Terminated - Mobility Relocation", "") === false, "terminated variant dropped");
  assert_(dhRosterRowActive_("Resigned", "") === false, "resigned dropped");
  assert_(dhRosterRowActive_("Offboarding", "") === false, "offboarding dropped");
  assert_(dhRosterRowActive_("Active", "2026-07-15") === false, "termination date alone drops the row");
  assert_(dhRosterRowActive_("Active", new Date(2026, 6, 15)) === false, "Date-typed termination cell drops too");
  // Leave statuses are NOT attrition — person is still employed
  assert_(dhRosterRowActive_("Maternity Leave", "") === true, "maternity leave stays");
  Logger.log("✅ _test_rosterActive_ passed");
}

function _test_newHire_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_newHire_: " + m); }
  // isoWeekBefore_: hire Wed 2026-07-15 sits in ISO 2026.W29
  var hire = new Date(2026, 6, 15);
  assert_(isoWeekBefore_("2026.W28", hire) === true, "prior week is pre-hire");
  assert_(isoWeekBefore_("2026.W29", hire) === false, "hire week itself counts");
  assert_(isoWeekBefore_("2026.W30", hire) === false, "later week counts");
  assert_(isoWeekBefore_("2025.W52", hire) === true, "prior ISO year is pre-hire");
  assert_(isoWeekBefore_("2026.W28", null) === false, "no hire date → nothing removed");
  // isDhNewHire_: ~3-month watch window anchored on today (2026-07-31 → cutoff 2026-05-01)
  var today = new Date(2026, 6, 31);
  assert_(isDhNewHire_(new Date(2026, 6, 15), today) === true, "2 weeks in → flagged");
  assert_(isDhNewHire_(new Date(2026, 4, 2), today) === true, "just inside the window");
  assert_(isDhNewHire_(new Date(2026, 3, 30), today) === false, "3+ months in → not new");
  assert_(isDhNewHire_(null, today) === false, "missing hire date fails safe");
  assert_(dhDateStr_(new Date(2026, 6, 15)) === "2026-07-15", "tooltip date string");
  assert_(dhDateStr_(null) === "", "blank for missing date");
  Logger.log("✅ _test_newHire_ passed");
}

function _test_backlogGrouping_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_backlogGrouping_: " + m); }
  var idx = buildNameIndex_(["Maria Alvarez"]);
  var open = [
    { key: "ACME-1", summary: "Big one", assignee: "Alvarez, Maria", status: "In Progress",
      priority: "High", due: new Date(2026, 7, 10), remHrs: 12 },
    { key: "ACME-2", summary: "Small one", assignee: "Maria Alvarez", status: "To Do",
      priority: "Low", due: null, remHrs: 2 },
    { key: "ZZZ-9", summary: "Not ours", assignee: "Nobody Here", status: "To Do",
      priority: "", due: null, remHrs: 8 },
  ];
  var by = backlogByPerson_(open, idx);
  var m = by["Maria Alvarez"];
  assert_(m && m.count === 2, "comma + plain assignee variants both join");
  assert_(m.remHrs === 14, "remaining hours totalled");
  assert_(m.items[0].key === "ACME-1", "sorted by remaining estimate desc");
  assert_(m.items[0].due === "2026.W33", "due date as ISO week label");
  assert_(!by["Nobody Here"], "non-roster assignee dropped");
  // Cap: totals cover ALL issues even when the item list is truncated
  var many = [];
  for (var i = 0; i < 12; i++) {
    many.push({ key: "K-" + i, summary: "s", assignee: "Maria Alvarez",
                status: "To Do", priority: "", due: null, remHrs: 1 });
  }
  var capped = backlogByPerson_(many, idx)["Maria Alvarez"];
  assert_(capped.items.length === CONFIG_DH.BACKLOG_MAX_ITEMS && capped.count === 12,
          "items capped, totals uncapped");
  Logger.log("✅ _test_backlogGrouping_ passed");
}

function _test_onTimeRate_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_onTimeRate_: " + m); }
  // Resolver stub: only Ana/Ben are roster people (person attribution).
  var roster = { "ana": "Ana", "ben": "Ben" };
  var resolve = function (raw) { return roster[String(raw).toLowerCase()] || null; };
  var issues = [
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), assignee: "Ana" }, // early ✓
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 29), assignee: "ANA" }, // boundary day ✓ (resolver case-insensitive)
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), assignee: "Ben" }, // late ✗
    { due: null,                  resolved: new Date(2026, 6, 30), assignee: "Ana" }, // no due — coverage only
    { due: new Date(2026, 6, 20), resolved: null,                  assignee: "Ana" }, // unresolved — excluded
    { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28), assignee: "Outsider Dev" }, // not roster — unattributed
    { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28), assignee: "" },             // unassigned — unattributed
    // Epics are programme containers, not delivery commitments: excluded from
    // BOTH the rate and the coverage denominator (audit fix 2026-08-03).
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), assignee: "Ana", isEpic: true }, // late epic — must not count
    { due: null,                  resolved: new Date(2026, 6, 30), assignee: "Ana", isEpic: true }, // no-due epic — must not count
  ];
  var r = onTimeBuckets_(issues, resolve, "delivery");
  // resolved dates 2026-07-28/29/30 are all ISO 2026.W31
  var a = r.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(a.iso === "2026.W31" && a.n === 2 && a.onTime === 2, "Ana: 2 with due, both on time");
  assert_(a.nAll === 3, "coverage: no-due resolved issue counts in nAll only");
  assert_(a.n === 2 && a.nAll === 3, "epics excluded from the rate AND the coverage denominator");

  // The other two readings of the scope switch (CONFIG_DH.ONTIME_SCOPE).
  var epicOnly = onTimeBuckets_(issues, resolve, "epic");
  var ea = epicOnly.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(ea.n === 1 && ea.onTime === 0 && ea.nAll === 2,
          'scope "epic": only the 2 epics, 1 with a due date, resolved late');
  assert_(epicOnly.buckets.length === 1, 'scope "epic": Ben has no epics, so no bucket');
  var everything = onTimeBuckets_(issues, resolve, "all");
  var aa = everything.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(aa.n === 3 && aa.nAll === 5, 'scope "all": pre-audit behaviour, epics folded back in');
  assert_(CONFIG_DH.ONTIME_SCOPE === "delivery", "shipped default is the delivery-issue scope");
  assert_(onTimeBuckets_(issues, resolve).buckets.length === r.buckets.length,
          "omitted scope falls back to the CONFIG_DH default");
  var e = r.buckets.filter(function (b) { return b.person === "Ben"; })[0];
  assert_(e.n === 1 && e.onTime === 0 && e.nAll === 1, "late issue counted, not on time");
  assert_(r.buckets.length === 2, "person-keyed buckets; unresolved rows excluded");
  assert_(r.unattributed === 2, "non-roster + unassigned resolved issues tallied as unattributed");
  Logger.log("✅ _test_onTimeRate_ passed");
}

function _test_forecastAccuracy_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_forecastAccuracy_: " + m); }
  var resolve = function (raw) { return raw === "Ana" ? "Ana" : null; };
  var epics = [
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 28), assignee: "Ana" }, // perfect: acc 1
    { estSec: 36000, spentSec: 54000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 50% over: acc .5
    { estSec: 36000, spentSec: 90000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 150% over: acc floored 0
    { estSec: 36000, spentSec: 18000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 50% UNDER: acc .5
    { estSec: 0,     spentSec: 36000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // no estimate — coverage only
    { estSec: 36000, spentSec: 0,     resolved: new Date(2026, 6, 29), assignee: "Ana" }, // estimated, ZERO worklog — coverage only
    { estSec: 36000, spentSec: 36000, resolved: null,                  assignee: "Ana" }, // unresolved — excluded
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 29), assignee: "Ghost" }, // not roster — unattributed
  ];
  var r = forecastBuckets_(epics, resolve);
  assert_(r.buckets.length === 1, "one person bucket");
  var b = r.buckets[0];
  assert_(b.person === "Ana" && b.iso === "2026.W31" && b.n === 4, "4 measurable resolved epics for Ana");
  assert_(b.nAll === 6, "coverage: unestimated + zero-worklog epics count in nAll only");
  assert_(b.nNoTime === 1, "estimated epic with no logged time tallied separately");
  assert_(Math.abs(b.sumAcc - 2.0) < 1e-9, "acc: 1 + 0.5 + 0 (floored) + 0.5 under");
  // A zero-worklog epic used to score acc 0 — the worst possible — which would
  // have made sumAcc 2.0 over n=5 (40%) instead of 2.0 over n=4 (50%).
  assert_(Math.abs(b.sumAcc / b.n * 100 - 50) < 1e-9, "zero-worklog epic no longer drags the rate down");
  assert_(b.nOver === 2 && b.nUnder === 1, "variance direction counted per epic");
  assert_(Math.abs(b.lossOver - 1.5) < 1e-9, "over-run loss: 0.5 + 1.0 (capped)");
  assert_(Math.abs(b.lossUnder - 0.5) < 1e-9, "under-run loss: 0.5");
  assert_(r.unattributed === 1, "non-roster epic tallied as unattributed");
  Logger.log("✅ _test_forecastAccuracy_ passed");
}

function _test_cacheRoundtrip_(cache) {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_cacheRoundtrip_: " + m); }
  var big = JSON.stringify({ people: new Array(4000).fill({ name: "Maria Alvarez", weeks: { "2026.W31": { cap: 40, avail: 32 } } }) });
  assert_(cachePutLarge_(cache, "dh_test", big, 60) === true, "put ok");
  assert_(cacheGetLarge_(cache, "dh_test") === big, "roundtrip identical");
  assert_(cacheGetLarge_(cache, "dh_missing") === null, "missing key → null");
  // Simulate an evicted chunk → whole entry misses cleanly
  var meta = parseInt(cache.get("dh_test_meta"), 10);
  if (meta > 1) { cache.m["dh_test_1"] = null; delete cache.m["dh_test_1"]; }
  else { delete cache.m["dh_test_0"]; }
  assert_(cacheGetLarge_(cache, "dh_test") === null, "missing chunk → clean miss");
  Logger.log("✅ _test_cacheRoundtrip_ passed");
}

function _test_modelAssembly_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_modelAssembly_: " + m); }
  var win = buildDhWindow_(new Date(2026, 6, 31)); // grid W29–W34, trend W25–W30
  var inputs = {
    roster: { people: [
      { name: "Maria Alvarez", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Service Delivery", tracks: true, empNum: "1001" },
      { name: "Tom Baker", keyLocation: "Australia & New Zealand", rosterBucket: "ANZ", isCrew: false,
        jobFamily: "", tracks: true,                // uncatalogued (crew-like) — stays in
        jobTitle: "07.M5.1 - Manager, Service Delivery", // M-level → isManager
        onLeave: true, leaveStatus: "Paternity Leave" }, // long leave — 🏖 not zeros
      { name: "Nina New", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Service Delivery", tracks: true,
        hireDate: new Date(2026, 6, 15) },          // hired mid-window (ISO 2026.W29)
      { name: "Zoe Ops", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Operations", tracks: false },   // non-tracking family — dropped entirely
    ] },
    capacity: { byName: { "maria alvarez": { "2026.W31": 40, "2026.W30": 40 } } }, // Tom missing → fallback
    tracked: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W30": 20, "2026.W31": 8 } },
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "NETSUITE-TIMEOFF", pm: "Ghost PM",
        weekHours: { "2026.W31": 8 } },  // tracked time-off excluded from `tracked` AND from PMs
    ] },
    planned: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W31": 30 } },
      { user: "Maria Alvarez", teamCell: "", key: "NETSUITE-TIMEOFF",
        weekHours: { "2026.W31": 8 } },  // → PTO 8h in W31
    ] },
    ns: { rows: [
      { name: "Alvarez, Maria", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 },
      { name: "Alvarez, Maria", date: new Date(2026, 6, 20), billable: 5, nonBillable: 3 }, // Mon W30, no PTO that week
    ] },
    holidays: { rows: [ { date: new Date(2026, 6, 29), location: "Malaysia" } ] }, // Wed W31, 8h
    // Accumulation Cost usage (source of truth): W31 8h matches the NETSUITE
    // row; W30 4h exists ONLY here — proves the ledger wins over NETSUITE.
    pto: { ok: true, byEmp: { "1001": { "2026.W31": 8, "2026.W30": 4 } } },
    jira: { available: true, keyRegion: { "ACME-1": "AMER" },
      issues: [ { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
                  assignee: "Alvarez, Maria", estSec: 0, spentSec: 0 },   // comma-form → alias join
                { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
                  assignee: "Random Dev", estSec: 0, spentSec: 0 } ],     // not roster → unattributed
      epics: [ { estSec: 36000, spentSec: 18000, resolved: new Date(2026, 6, 28),
                 assignee: "Maria Alvarez" } ],
      openIssues: [ { key: "ACME-7", summary: "Open work", assignee: "Alvarez, Maria",
                      status: "In Progress", priority: "High", due: null, remHrs: 5 } ] },
  };
  var m = assembleModel_(inputs, win);
  assert_(!m.error, "no fatal error");
  assert_(m.schemaVer === DH_SCHEMA_VER_, "payload stamped with the current schema version");
  assert_(m.people.length === 3 && m.people[0].name === "Maria Alvarez", "alphabetical people");
  var maria = m.people[0], w31 = maria.weeks["2026.W31"];
  // cap 40, pto 8 (planned NETSUITE), holiday 8h but fully booked → effHol 0, avail 32
  assert_(w31.cap === 40 && w31.pto === 8 && w31.hol === 0 && w31.avail === 32, "net capacity chain");
  assert_(w31.tracked === 8 && w31.planned === 30, "NETSUITE excluded from tracked/planned");
  // ── Ratio classification (audit 2026-08-03) ──
  // W31: NS 6b/2nb = 8h total, Tempo tracked 8h — the feeds agree, so the split
  // is identical to the old absolute reading (6/2). This is the happy path.
  assert_(w31.nsCov === true && w31.billShare === 0.75, "NS joined via comma-name alias → 75% billable share");
  assert_(w31.billable === 6, "share applied to tracked: 8h × 0.75");
  // NS Non-Billable = real project work — PTO lives only in the Time off
  // Report (NETSUITE rows), never in this bucket, so the 2h survives even in
  // a week with 8h PTO (user clarification 2026-08-01, no OOO netting).
  assert_(w31.nonBillable === 2, "non-billable work untouched by PTO");
  assert_(Math.abs(w31.billable + w31.nonBillable - w31.tracked) < 1e-9,
          "INVARIANT: billable + nonBillable === tracked");
  // W30: NS captured only 8h (5b/3nb) of a 20h tracked week. The old absolute
  // reading reported 5h billable — understating a 20h week to 13.9% util. The
  // share (62.5%) now classifies the FULL tracked total: 12.5h / 7.5h. The raw
  // absolutes stay on the record for the finance drill-down + the gap flag.
  var w30 = maria.weeks["2026.W30"];
  assert_(w30.tracked === 20 && w30.billShare === 0.625, "W30 share from NS mix");
  assert_(w30.billable === 12.5 && w30.nonBillable === 7.5, "share extrapolated over the full tracked total");
  assert_(w30.nsBillRaw === 5 && w30.nsNonBillRaw === 3, "raw NS absolutes retained");
  assert_(Math.abs(w30.billable + w30.nonBillable - w30.tracked) < 1e-9,
          "INVARIANT: billable + nonBillable === tracked (W30)");
  // An NS-uncovered week is unclassifiable, NOT 0% billable: it keeps tracked
  // hours but contributes nothing to either side of the billable rate.
  var w29 = maria.weeks["2026.W29"];
  assert_(w29 && w29.nsCov === false && w29.availCov === 0 && w29.billable === 0,
          "no NS rows → uncovered, zero billable denominator");
  // Coverage telemetry: 2 of Maria's weeks classified, unmatched NS names counted.
  var cov = m.meta.nsCoverage;
  assert_(cov.covered === 2 && cov.personWeeks > 2, "coverage counts classified person-weeks");
  assert_(cov.classifiedHours === 28 && cov.trackedHours === 28, "classified vs total tracked hours");
  assert_(cov.gapHours === 12, "reconciliation gap = |NS 8h − tracked 20h| in W30");
  var mUn = assembleModel_(Object.assign({}, inputs, { ns: { rows: inputs.ns.rows.concat(
    [{ name: "Ghost Employee", date: new Date(2026, 6, 27), billable: 9, nonBillable: 1 }]) } }), win);
  assert_(mUn.meta.nsCoverage.unmatchedRows === 1 && mUn.meta.nsCoverage.unmatchedHours === 10 &&
          mUn.meta.nsCoverage.unmatchedNames[0] === "Ghost Employee",
          "unresolved NS employee reported, not silently dropped");
  assert_(w30.pto === 4 && w30.avail === 36,
          "W30 PTO comes from the Accumulation ledger (no NETSUITE row that week)");
  assert_(m.meta.ptoSource === "accumulation", "meta names the PTO source");
  // Accumulation workbook unreadable → per-person NETSUITE fallback
  var m5 = assembleModel_(Object.assign({}, inputs, { pto: { ok: false, byEmp: {} } }), win);
  var maria5 = m5.people.filter(function (x) { return x.name === "Maria Alvarez"; })[0];
  assert_(maria5.weeks["2026.W31"].pto === 8 && maria5.weeks["2026.W30"].pto === 0,
          "fallback: NETSUITE rows drive PTO when the ledger is unreadable");
  assert_(m5.meta.ptoSource === "netsuite-fallback", "fallback labeled in meta");
  assert_(maria.teams.join("|") === "Team A|Team B", "teams split");
  assert_(maria.pms.join("|") === "Pat Manager", "PM collected from project rows only (time-off PM ignored, no dupes)");
  assert_(maria.isManager === false, "no M-level in title → IC");
  assert_(maria.region === "AMER" && maria.regionSource === "jira", "region from tracked ACME-1 hours");
  assert_(maria.tracks === true && maria.jobFamily === "Service Delivery", "tracking flag carried");
  assert_(maria.backlog && maria.backlog.count === 1 && maria.backlog.items[0].key === "ACME-7",
          "open backlog joined via comma-name alias");
  var tom = m.people[2], t31 = tom.weeks["2026.W31"];
  assert_(t31.cap === 38 && t31.capEst === true, "ANZ fallback capacity flagged estimated");
  assert_(tom.region === "ANZ" && tom.regionSource === "roster", "no tracked → roster fallback");
  assert_(tom.backlog === null, "no open issues → null backlog");
  // New hire: pre-hire weeks removed from the model entirely, 🌱 flag carried
  var nina = m.people[1];
  assert_(nina.name === "Nina New" && nina.newHire === true && nina.hired === "2026-07-15",
          "new-hire flag + hire date shipped");
  assert_(nina.weeks["2026.W28"] === undefined && nina.weeks["2026.W1"] === undefined,
          "pre-hire weeks do not exist");
  assert_(nina.weeks["2026.W29"] && nina.weeks["2026.W29"].cap === 40,
          "hire week onward present (fallback capacity)");
  assert_(maria.newHire === false && maria.weeks["2026.W1"] !== undefined,
          "no hire date → not flagged, full history kept");
  // Non-tracking family excluded from the population ENTIRELY
  assert_(m.people.every(function (p) { return p.name !== "Zoe Ops"; }),
          "non-tracking family dropped from population");
  assert_(m.meta.families.join("|") === "Service Delivery|Uncatalogued",
          "families list = included population only, blank → Uncatalogued");
  assert_(m.onTimeBuckets.length === 1 && m.onTimeBuckets[0].onTime === 1 &&
          m.onTimeBuckets[0].person === "Maria Alvarez", "onTime buckets person-attributed via alias join");
  assert_(m.forecastBuckets.length === 1 && Math.abs(m.forecastBuckets[0].sumAcc - 0.5) < 1e-9 &&
          m.forecastBuckets[0].person === "Maria Alvarez", "forecast buckets person-attributed");
  assert_(m.meta.jiraUnattributed.onTime === 1 && m.meta.jiraUnattributed.forecast === 0,
          "non-roster assignee tallied as unattributed");
  assert_(m.meta.teams.indexOf("Team A") !== -1 && m.meta.teams.indexOf("Squad X") === -1,
          "team dropdown = Tempo teams only (bucket teams no longer unioned)");
  assert_(m.meta.pms.join("|") === "Pat Manager", "PM dropdown vocabulary");
  var tom2 = m.people.filter(function (x) { return x.name === "Tom Baker"; })[0];
  assert_(tom2.pms.length === 0, "no project rows → no PMs");
  assert_(tom2.isManager === true && tom2.jobTitle.indexOf(".M5.") !== -1,
          "M-level job code → isManager, title carried in payload");
  assert_(tom2.onLeave === true && tom2.leaveStatus === "Paternity Leave",
          "leave status carried in payload");
  assert_(m.meta.headlineIso === "2026.W30" && m.meta.nsAvailable === true && m.meta.jiraAvailable === true, "meta");
  // Degradation: NS missing → nsAvailable false, people still built
  var m2 = assembleModel_(Object.assign({}, inputs, { ns: { rows: [], error: "missing" } }), win);
  assert_(m2.meta.nsAvailable === false && m2.people.length === 3, "NS-off degradation");
  // Fatal: roster error → model.error set
  var m3 = assembleModel_(Object.assign({}, inputs, { roster: { people: [], error: "boom" } }), win);
  assert_(!!m3.error, "roster failure is fatal");
  Logger.log("✅ _test_modelAssembly_ passed");
}

function _test_periods_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_periods_: " + m); }
  // Anchor: Fri 2026-07-31 = ISO 2026.W31 → window 2026.W1..2026.W34
  var win = buildDhWindow_(new Date(2026, 6, 31));
  var per = buildPeriods_(win);

  // periodInfoForIso_ basics
  var i31 = periodInfoForIso_("2026.W31"); // Thu 2026-07-30
  assert_(i31.month === "2026-07" && i31.monthLabel === "Jul 2026", "W31 → Jul 2026");
  assert_(i31.quarter === "FY27Q1" && i31.quarterLabel === "FY27 Q1", "Jul 2026 → FY27 Q1 (FY named for end year)");
  var i1 = periodInfoForIso_("2026.W1"); // Thu 2026-01-01
  assert_(i1.month === "2026-01" && i1.quarter === "FY26Q3", "W1 → Jan 2026, FY26 Q3");
  var iOct = periodInfoForIso_("2026.W41"); // Thu 2026-10-08
  assert_(iOct.quarter === "FY27Q2", "Oct → FY27 Q2");

  // Window EXTENT is derived from CONFIG_DH.WEEKS_PAST_DEEP, so assert the
  // relationship rather than a literal count — the depth is a tuning dial that
  // moves with the exporters' window.
  var months = per.month;
  var firstIso = win.allWeeks[0], lastIso = win.allWeeks[win.allWeeks.length - 1];
  assert_(months[0].key === periodInfoForIso_(firstIso).month &&
          months[months.length - 1].key === periodInfoForIso_(lastIso).month,
          "months span exactly the window, oldest → newest");
  assert_(months.length >= 8, "window covers at least 8 months, got " + months.length);

  // THE REQUIREMENT that drove WEEKS_PAST_DEEP 30 → 52 (2026-08-03): the tile
  // trends only use periods that are done AND not partial, so a window has to
  // contain enough COMPLETE periods or a view renders a single data point with
  // no trend line and no "vs prior" delta. At 30 weeks the quarterly view had
  // exactly one, which is what this guards against.
  var completeMonths = months.filter(function (p) { return p.status === "done" && !p.partial; });
  assert_(completeMonths.length >= 6,
          "Monthly view needs >= 6 complete months for a full trend, got " + completeMonths.length);

  var jul = months.filter(function (p) { return p.key === "2026-07"; })[0];
  assert_(jul.status === "now" && jul.partial === false, "Jul = now, complete (W27..W31 all in window)");
  assert_(jul.isos[0] === "2026.W27" && jul.isos[jul.isos.length - 1] === "2026.W31", "Jul member weeks");
  var jun = months.filter(function (p) { return p.key === "2026-06"; })[0];
  assert_(jun.status === "done" && jun.partial === false, "Jun = done, complete");
  var aug = months.filter(function (p) { return p.key === "2026-08"; })[0];
  assert_(aug.status === "plan" && aug.partial === true, "Aug = plan, truncated by window end");
  var jan = months.filter(function (p) { return p.key === "2026-01"; })[0];
  assert_(jan.status === "done" && jan.partial === false, "Jan complete (prior week W52/2025 is Dec)");

  // Quarters — newest is always the current one (FY27Q1 at this anchor), and
  // the span follows the window depth.
  var quarters = per.quarter;
  assert_(quarters[0].key === periodInfoForIso_(firstIso).quarter &&
          quarters[quarters.length - 1].key === "FY27Q1", "quarters span the window → current quarter");
  var curQ = quarters[quarters.length - 1];
  assert_(curQ.status === "now" && curQ.partial === true, "FY27Q1 now, truncated (Q runs to Sep)");
  assert_(quarters.filter(function (q) { return q.key === "FY26Q4"; })[0].status === "done",
          "FY26Q4 (Apr–Jun 2026) is a completed quarter");

  // The quarterly counterpart of the monthly guard above — this is the exact
  // assertion that fails at WEEKS_PAST_DEEP = 30 (one complete quarter only).
  // Measured worst case (running in the LAST week of a quarter, which is when
  // the window's oldest quarter is most truncated):
  //   30 weeks → 1 complete quarter   (no trend at all — the bug this fixes)
  //   52 weeks → 3 complete quarters  ← current setting
  //   65 weeks → 4 complete quarters  (the cliff for a full-year / YoY compare)
  // The window's OLDEST quarter is always partial, so the count is never
  // simply floor(weeks / 13).
  var completeQuarters = quarters.filter(function (q) { return q.status === "done" && !q.partial; });
  assert_(completeQuarters.length >= 3,
          "Quarterly view needs >= 3 complete fiscal quarters for a trend, got " +
          completeQuarters.length + " — raise CONFIG_DH.WEEKS_PAST_DEEP (and the " +
          "exporters' EXPORT_HISTORY_WEEKS with it; 65 buys the 4th quarter)");
  completeQuarters.forEach(function (q) {
    assert_(q.isos.length >= 12, q.key + " complete quarter holds >= 12 weeks, got " + q.isos.length);
  });

  // adjacentIso_ year wrap
  assert_(adjacentIso_("2026.W1", -1) === "2025.W52", "W1 − 1 wraps to prior year");
  assert_(adjacentIso_("2025.W52", 1) === "2026.W1", "W52 + 1 wraps forward");
  Logger.log("✅ _test_periods_ passed");
}

function _test_levelTrack_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_levelTrack_: " + m); }
  // Ported from CompDash parseLevel_ — same fixtures, same expectations.
  var t;
  t = dhLevelTrack_("04.I3.1 - Consultant, Delivery");
  assert_(t.level === "I3" && t.track === "IC", "dotted IC token");
  t = dhLevelTrack_("04.M10.2 - Director, Services");
  assert_(t.level === "M10" && t.track === "M", "two-digit M-level");
  t = dhLevelTrack_("M5 - Manager, Service Delivery");
  assert_(t.track === "M" && t.level === "M5", "token at start of title (no dot prefix)");
  t = dhLevelTrack_("Team Manager");
  assert_(t.track === null && t.level === "—", "the WORD Manager is not a level token");
  t = dhLevelTrack_("PM5 Coordinator");
  assert_(t.track === null, "letter-adjacent M (PM5) never matches");
  assert_(dhLevelTrack_("").track === null && dhLevelTrack_(null).track === null, "blank/null → null track");
  Logger.log("✅ _test_levelTrack_ passed");
}

function _test_ptoUsage_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_ptoUsage_: " + m); }
  var rows = [
    // Explicit amount wins; usage on Mon 2026-07-27 (W31) + Fri 2026-07-31 (W31)
    { empNum: "1001", date: new Date(2026, 6, 27), adjType: "Usage", amount: 8, balance: 92 },
    { empNum: "1001", date: new Date(2026, 6, 31), adjType: "Time Off", amount: 8, balance: 84 },
    // Accrual rows never count as usage
    { empNum: "1001", date: new Date(2026, 6, 28), adjType: "Accrual", amount: 10, balance: 100 },
    // Delta fallback: no amount column → |balance − prev balance|
    { empNum: "2002", date: new Date(2026, 6, 20), adjType: "Accrual", amount: null, balance: 50 },
    { empNum: "2002", date: new Date(2026, 6, 21), adjType: "Usage", amount: null, balance: 42 }, // 8h W30
    // Usage with no amount and no prior balance → skipped (counted)
    { empNum: "3003", date: new Date(2026, 6, 21), adjType: "Usage", amount: null, balance: null },
    // Blank empNum / invalid date rows ignored
    { empNum: "", date: new Date(2026, 6, 21), adjType: "Usage", amount: 8, balance: 10 },
  ];
  var r = ptoUsageFromRows_(rows, "hours", 8);
  assert_(r.byEmp["1001"]["2026.W31"] === 16, "two explicit-amount usages sum in the week");
  assert_(!("2026.W30" in (r.byEmp["1001"] || {})), "accrual rows never create usage");
  assert_(r.byEmp["2002"]["2026.W30"] === 8, "delta fallback |42−50| = 8h");
  assert_(r.skipped === 1, "amount-less usage without prior balance skipped + counted");
  // Same-date batch (accrual + amount-less usage posted on one day): the delta
  // fallback reads prevBalance, so LEDGER ORDER must survive the sort. Accrual
  // first (50 → 60), then usage to 52 = 8h. Sorting the usage ahead of the
  // accrual would read |52 − 50| = 2h and under-report the absence.
  var same = ptoUsageFromRows_([
    { empNum: "4004", date: new Date(2026, 6, 13), adjType: "Accrual", amount: null, balance: 50 },
    { empNum: "4004", date: new Date(2026, 6, 20), adjType: "Accrual", amount: null, balance: 60 },
    { empNum: "4004", date: new Date(2026, 6, 20), adjType: "Usage",   amount: null, balance: 52 },
  ], "hours", 8);
  assert_(same.byEmp["4004"]["2026.W30"] === 8, "same-date accrual+usage keeps ledger order (8h, not 2h)");
  // Days unit converts
  var d = ptoUsageFromRows_([{ empNum: "9", date: new Date(2026, 6, 27), adjType: "usage", amount: 1, balance: null }], "days", 8);
  assert_(d.byEmp["9"]["2026.W31"] === 8, "days unit × hoursPerDay");
  Logger.log("✅ _test_ptoUsage_ passed");
}
