// ============================================================
// SCRIPT NAME: Comp Health Report — Code
// PURPOSE:     Rocketeer Global Comp Health Report (V1).
//              Data readers, metric engines, doGet, getCompReportData.
// SPEC:        docs/superpowers/specs/2026-07-21-comp-health-dashboard-design.md
//
// Layout: PURE LOGIC first (no GAS APIs — Node-testable via tests/),
//         GAS LAYER second (SpreadsheetApp/CacheService/HtmlService).
// ============================================================

const CONFIG_CD = {
  // Fallback source IDs — overridable via Script Properties (same names, CD_ prefix).
  ROSTER_SS_ID:    "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0", // roster + attrition + TCC USD
  COMP_HIST_SS_ID: "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU", // Compensation Report (RD tab)
  ROSTER_TAB:  "Data",     // verify at deploy; override via CD_ROSTER_TAB property
  TCC_USD_TAB: "TCC USD",
  HIST_TAB:    "RD",

  CACHE_TTL_SEC: 65 * 60,
  CACHE_KEY_PREFIX: "cd_",

  // Equity thresholds (Pay Equity tab) — tune here, never in the UI.
  EQUITY_GAP_PCT:     10, // gender median-gap % that flags a location+level group
  EQUITY_OUTLIER_PCT: 25, // individual % below group median that flags an outlier
  TENURE_YEARS_MIN:    3, // tenure lens: minimum years of service
  TENURE_BELOW_PCT:   15, // tenure lens: % below group median that flags
  SMALL_GROUP_MIN:     3, // compa groups smaller than this get a smallGroup flag

  CREW_RE: /crew member|contractor/i, // same crew rule as the PS Contribution Report
  // Narrower than PS Security's regex ON PURPOSE: Rocketeers on maternity/parental
  // leave are still employed — they stay in comp metrics and headcount.
  INACTIVE_RE: /terminat|job offer|resign|left|inactive|former|offboard/i,

  DEBUG: false,
};

// ============================================================
// PURE LOGIC — no GAS APIs below this line until the GAS LAYER marker
// ============================================================

function normCD_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Extracts the level token from a Job Title like "04.I3.1" / "04.M10.2".
 * @returns {{level: string, track: ("IC"|"M"|null)}} level "—" when unparseable.
 */
function parseLevel_(jobTitle) {
  const m = String(jobTitle || "").match(/(?:^|[^A-Za-z0-9])([IM])(\d{1,2})(?![0-9])/i);
  if (!m) return { level: "—", track: null };
  const letter = m[1].toUpperCase();
  return { level: letter + parseInt(m[2], 10), track: letter === "I" ? "IC" : "M" };
}

/** Sort key: ICs before management, numeric within track, "—" last. */
function levelRank_(level) {
  const m = String(level || "").match(/^([IM])(\d+)$/);
  if (!m) return 999;
  return (m[1] === "I" ? 0 : 100) + parseInt(m[2], 10);
}

function asNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function asDate_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function isoDate_(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

// ── Fiscal calendar (FY starts July 1; FY27 = Jul 2026 – Jun 2027) ─────────
// Same derivation rules as computeFiscalContext_ in PS Contribution Report.js,
// trimmed to what this dashboard needs (no ISO weeks, no grace periods).

function fiscalContextCD_(refDate) {
  const today = (refDate instanceof Date && !isNaN(refDate)) ? refDate : new Date();
  const m = today.getMonth() + 1;
  const yr = today.getFullYear();
  const fyStartCalYear = (m >= 7) ? yr : yr - 1;
  const fyNum = fyStartCalYear + 1;
  const qNum = (m >= 7 && m <= 9) ? 1 : (m >= 10) ? 2 : (m <= 3) ? 3 : 4;
  const ABBR = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  return {
    asOf: today,
    fyNum,
    fyLabel: "FY" + String(fyNum).slice(-2),
    prevFyLabel: "FY" + String(fyNum - 1).slice(-2),
    qLabel: "Q" + qNum,
    fyStartCalYear,
    fyStart: new Date(fyStartCalYear, 6, 1),
    fyEnd: new Date(fyStartCalYear + 1, 5, 30),
    prevFyStart: new Date(fyStartCalYear - 1, 6, 1),
    prevFyEnd: new Date(fyStartCalYear, 5, 30),
    monthLabels: ABBR.map((a, i) =>
      a + " " + String(i < 6 ? fyStartCalYear : fyStartCalYear + 1).slice(-2)),
  };
}

/** 0-based fiscal month index (Jul=0 … Jun=11) of `date` within the FY starting `fyStartCalYear`; -1 if outside. */
function fiscalMonthIdx_(date, fyStartCalYear) {
  if (!(date instanceof Date) || isNaN(date)) return -1;
  const idx = (date.getFullYear() - fyStartCalYear) * 12 + date.getMonth() - 6;
  return (idx >= 0 && idx < 12) ? idx : -1;
}

// ── Attrition engine ────────────────────────────────────────────────────────
// FY-framed per the spec: previous FY renders as a shadow area, current FY as
// a trend line. Rate = terminations ÷ mean(headcount at period start, headcount
// at period end) — end = asOf for the in-progress FY. Crew is excluded upstream.

function classifyTerm_(cat) {
  const c = String(cat || "").toLowerCase();
  if (/invol/.test(c)) return "invol";
  if (/vol/.test(c)) return "vol";
  return "other";
}

function headcountOn_(records, date) {
  return records.filter(r =>
    r.hireDate && r.hireDate <= date && (!r.termDate || r.termDate > date)).length;
}

function fyAttritionBlock_(records, fyStart, fyEnd, asOf, label) {
  const end = (asOf && asOf < fyEnd) ? asOf : fyEnd;
  const fyStartCalYear = fyStart.getFullYear();
  const monthly = Array.from({ length: 12 }, () => ({ terms: 0, vol: 0, invol: 0 }));
  const terms = records.filter(r => r.termDate && r.termDate >= fyStart && r.termDate <= fyEnd);
  terms.forEach(r => {
    const i = fiscalMonthIdx_(r.termDate, fyStartCalYear);
    if (i === -1) return;
    const cls = classifyTerm_(r.termCategory);
    monthly[i].terms++;
    if (cls === "vol") monthly[i].vol++;
    else if (cls === "invol") monthly[i].invol++;
  });
  const quarterly = [0, 1, 2, 3].map(q => {
    const s = monthly.slice(q * 3, q * 3 + 3);
    return {
      terms: s.reduce((t, x) => t + x.terms, 0),
      vol:   s.reduce((t, x) => t + x.vol, 0),
      invol: s.reduce((t, x) => t + x.invol, 0),
    };
  });
  const vol   = terms.filter(r => classifyTerm_(r.termCategory) === "vol").length;
  const invol = terms.filter(r => classifyTerm_(r.termCategory) === "invol").length;
  const regretted = terms.filter(r => /yes|true/i.test(String(r.termRegretted || ""))).length;
  const avgHeadcount = (headcountOn_(records, fyStart) + headcountOn_(records, end)) / 2;
  return {
    label, monthly, quarterly,
    total: terms.length, vol, invol, regretted,
    avgHeadcount,
    rate: avgHeadcount > 0 ? terms.length / avgHeadcount : null,
  };
}

function sliceAttrition_(records, fyStart, fyEnd, end, keyFn) {
  const groups = new Map();
  const get = k => {
    if (!groups.has(k)) groups.set(k, { key: k, terms: 0, vol: 0, invol: 0, hcStart: 0, hcEnd: 0 });
    return groups.get(k);
  };
  records.forEach(r => {
    const g = get(keyFn(r) || "—");
    if (r.hireDate && r.hireDate <= fyStart && (!r.termDate || r.termDate > fyStart)) g.hcStart++;
    if (r.hireDate && r.hireDate <= end && (!r.termDate || r.termDate > end)) g.hcEnd++;
    if (r.termDate && r.termDate >= fyStart && r.termDate <= fyEnd) {
      const cls = classifyTerm_(r.termCategory);
      g.terms++;
      if (cls === "vol") g.vol++;
      else if (cls === "invol") g.invol++;
    }
  });
  return [...groups.values()]
    .map(g => {
      const avg = (g.hcStart + g.hcEnd) / 2;
      return { key: g.key, terms: g.terms, vol: g.vol, invol: g.invol,
               headcount: g.hcEnd, rate: avg > 0 ? g.terms / avg : null };
    })
    .filter(g => g.terms > 0 || g.headcount > 0)
    .sort((x, y) => y.terms - x.terms || y.headcount - x.headcount);
}

function buildAttrition_(records, ctx) {
  const end = (ctx.asOf < ctx.fyEnd) ? ctx.asOf : ctx.fyEnd;
  const detail = records
    .filter(r => r.termDate && r.termDate >= ctx.fyStart && r.termDate <= ctx.fyEnd)
    .map(r => ({
      empNo: r.empNo, name: r.name, dept: r.dept, level: r.level,
      keyLocation: r.keyLocation, termDate: isoDate_(r.termDate),
      cls: classifyTerm_(r.termCategory), category: r.termCategory,
      reason: r.termReason, regretted: /yes|true/i.test(String(r.termRegretted || "")),
    }))
    .sort((a, b) => b.termDate.localeCompare(a.termDate));
  return {
    currentFY:  fyAttritionBlock_(records, ctx.fyStart, ctx.fyEnd, ctx.asOf, ctx.fyLabel),
    previousFY: fyAttritionBlock_(records, ctx.prevFyStart, ctx.prevFyEnd, null, ctx.prevFyLabel),
    slices: {
      department:  sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.dept),
      level:       sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.level)
                     .sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
      keyLocation: sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.keyLocation),
    },
    detail,
  };
}
