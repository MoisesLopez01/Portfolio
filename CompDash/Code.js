// ============================================================
// SCRIPT NAME: Comp Health Report — Code
// PURPOSE:     Rocketeer Global Comp Health Report (V1).
//              Data readers, metric engines, doGet, getCompReportData.
// VERSION:     1.0.0
// ENVIRONMENT: Google Apps Script
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
  // TCC USD is a COLUMN inside the roster Data tab (not a separate tab) — its
  // position shifts (seen around col AS/AT), always resolved by header name below.
  TCC_USD_COL: "TCC USD",
  HIST_TAB:    "RD",       // override via CD_HIST_TAB property

  CACHE_TTL_SEC: 65 * 60,
  CACHE_KEY_PREFIX: "cd_",

  // Equity thresholds (Pay Equity tab) — tune here, never in the UI.
  EQUITY_GAP_PCT:     10, // gender median-gap % that flags a location+level group
  EQUITY_OUTLIER_PCT: 25, // individual % below group median that flags an outlier
  TENURE_YEARS_MIN:    3, // tenure lens: minimum years of service
  TENURE_BELOW_PCT:   15, // tenure lens: % below group median that flags
  SMALL_GROUP_MIN:     3, // compa groups smaller than this get a smallGroup flag

  // Internal Position color bands V2 — median anchor means ratios can exceed 1.0.
  // Shipped to the client via meta.compaBands so ratioClass() and the Data
  // Reference prose can never drift from these.
  COMPA_LOW_MIN:    0.80, // ≥ this renders yellow; below is red
  COMPA_TARGET_MIN: 0.95, // ≥ this renders green ("at target", 95–100% guideline)
  COMPA_HIGH_MAX:   1.10, // > this renders the violet "above median" chip

  // Small Improvements performance ratings
  RATINGS_SS_ID: "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // CD_RATINGS_SS_ID override
  RATINGS_TAB:   "Small Improvements RD",                        // CD_RATINGS_TAB override
  RATING_MAX:    5,     // scale ceiling — perf component normalizes as avg ÷ this

  // External market benchmarks (compilation grows over time — missing rows are normal)
  BENCH_SS_ID: "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0",   // CD_BENCH_SS_ID override
  BENCH_TAB:   "Compilation",                                    // CD_BENCH_TAB override
  MARKET_LOW:  0.90,    // vs-market ratio below this = priority read (red chip)

  // Priority Score — mastery band descoped; 40/30/20/10 renormalized to sum 100.
  PRIORITY_W:    { perf: 57, tenure: 29, compaGap: 14 },
  PRIORITY_CAPS: { companyYears: 10, profileYears: 5, gapPct: 0.25 },

  PROMO_RE: /promot|title change|role change/i, // RD reasons that reset profile tenure

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
  // Null hireDate = employment start unknown → treat as already hired, keeping
  // the denominator symmetric with the termination numerator.
  return records.filter(r =>
    (!r.hireDate || r.hireDate <= date) && (!r.termDate || r.termDate > date)).length;
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
    if ((!r.hireDate || r.hireDate <= fyStart) && (!r.termDate || r.termDate > fyStart)) g.hcStart++;
    if ((!r.hireDate || r.hireDate <= end) && (!r.termDate || r.termDate > end)) g.hcEnd++;
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

// ── Internal Position engine ────────────────────────────────────────────────
// ratio = TCC ÷ max(TCC) within the same Key Location + Job Title peer group,
// ACTIVE employees, LOCAL currency. Deliberately labeled "Internal Position
// (vs peer max)" in the UI — it is NOT a band-midpoint compa ratio (no band
// data exists yet), so nobody can sit above 1.0 and the classic above/below-
// midpoint reading must never be attached to it.

function buildCompaGroups_(activeRecords, smallGroupMin) {
  const min = smallGroupMin || CONFIG_CD.SMALL_GROUP_MIN;
  const map = new Map();
  activeRecords.forEach(r => {
    const key = (r.keyLocation || "—") + "||" + (r.jobTitle || "—");
    if (!map.has(key)) {
      map.set(key, { keyLocation: r.keyLocation || "—", jobTitle: r.jobTitle || "—",
                     currency: r.currency || "", members: [], missingTcc: 0 });
    }
    const g = map.get(key);
    if (r.tcc == null || r.tcc <= 0) { g.missingTcc++; return; }
    g.members.push(r);
  });
  return [...map.values()].map(g => {
    const maxTcc = g.members.reduce((m, r) => Math.max(m, r.tcc), 0);
    const count = g.members.length;
    return {
      keyLocation: g.keyLocation, jobTitle: g.jobTitle, currency: g.currency,
      maxTcc, count, missingTcc: g.missingTcc,
      smallGroup: count > 0 && count < min,
      members: g.members
        .map(r => ({
          empNo: r.empNo, name: r.name, level: r.level, currency: r.currency,
          tcc: r.tcc, tccUsd: r.tccUsd,
          ratio: maxTcc > 0 ? Math.round(r.tcc / maxTcc * 1000) / 1000 : null,
          noPeers: count === 1,
        }))
        .sort((a, b) => b.tcc - a.tcc),
    };
  }).sort((a, b) =>
    a.keyLocation.localeCompare(b.keyLocation) || a.jobTitle.localeCompare(b.jobTitle));
}

// ── Market Gap suggestion (used once Payscale P25/P50/P75 data lands) ──────
// Returns the priority-of-read status the UI colors red/yellow/green.
// TODO: wire into getCompReportData() (attach p25/p50/p75 + suggestion per
// employee) once the Payscale source lands — until then only the client-side
// mirror marketRow() in ViewDash.html executes, and the two can drift.
function marketSuggestion_(tcc, p25, p50) {
  if (!(tcc > 0) || !(p25 > 0) || !(p50 > 0)) {
    return { status: "pending", pctToP25: null, pctToP50: null };
  }
  if (tcc < p25) return { status: "below-p25", pctToP25: (p25 - tcc) / tcc, pctToP50: (p50 - tcc) / tcc };
  if (tcc < p50) return { status: "below-p50", pctToP25: 0, pctToP50: (p50 - tcc) / tcc };
  return { status: "at-market", pctToP25: 0, pctToP50: 0 };
}

// ── Growth engine (per-employee comp event history) ─────────────────────────
// Events come from the Compensation Report RD tab: each row is one comp event
// (New Hire, Salary adjustment, Promotion, …) with the local Total Target
// Compensation recorded at that event. The first event is the baseline — it
// gets no delta and no annualized rate (the "New Hire has nothing to compare
// against" rule falls out naturally).

const YEAR_MS_ = 365.25 * 86400000;

/** Annualized growth rate — the sheet RRI(1, prev, curr) generalized to fractional years. */
function rri_(years, prev, curr) {
  if (!(years > 0) || !(prev > 0) || !(curr > 0)) return null;
  return Math.pow(curr / prev, 1 / years) - 1;
}

function buildGrowthForEmp_(events) {
  const evs = (events || [])
    .filter(e => e && e.date instanceof Date && !isNaN(e.date))
    .sort((a, b) => a.date - b.date);
  const out = [];
  let prev = null;
  evs.forEach(e => {
    const row = { date: isoDate_(e.date), reason: e.reason || "", tcc: e.tcc,
                  deltaAbs: null, deltaPct: null, annualized: null };
    if (prev && e.tcc != null && e.tcc > 0) {
      const years = (e.date - prev.date) / YEAR_MS_;
      row.deltaAbs = e.tcc - prev.tcc;
      row.deltaPct = (e.tcc - prev.tcc) / prev.tcc;
      row.annualized = rri_(years, prev.tcc, e.tcc);
    }
    out.push(row);
    if (e.tcc != null && e.tcc > 0) prev = { date: e.date, tcc: e.tcc };
  });
  const valued = evs.filter(e => e.tcc != null && e.tcc > 0);
  const first = valued[0], last = valued[valued.length - 1];
  const overall = (first && last && last.date > first.date)
    ? rri_((last.date - first.date) / YEAR_MS_, first.tcc, last.tcc)
    : null;
  return { events: out, overallAnnualized: overall };
}

// ── Ratings engine (Small Improvements) ─────────────────────────────────────
// Rows come from the "Small Improvements RD" tab keyed by Employee Number.
// Fixed-width fiscal-quarter labels ("FY24Q2") sort correctly as strings.

function buildPerfForEmp_(rows) {
  const hist = (rows || [])
    .filter(r => r && typeof r.rate === "number" && isFinite(r.rate))
    .sort((a, b) => String(a.fq).localeCompare(String(b.fq)));
  if (!hist.length) return { avg: null, latest: null, count: 0, history: [] };
  const avg = hist.reduce((t, r) => t + r.rate, 0) / hist.length;
  return {
    avg: Math.round(avg * 100) / 100,
    latest: hist[hist.length - 1].rate,
    count: hist.length,
    history: hist.map(r => ({ fq: r.fq, rate: r.rate, explanation: r.explanation || "" })),
  };
}

// ── Pay Equity engine ───────────────────────────────────────────────────────
// Three lenses computed within Key Location + level groups (same location ⇒
// same local currency, so TCC comparisons are honest):
//   gender   — median-gap % between genders with ≥2 members each in a group
//   tenure   — long-tenured Rocketeers sitting well below their group median
//   outliers — anyone far below their group median regardless of dimension
// Thresholds live in CONFIG_CD (passed in as cfg for Node-testability).
// Names appear ONLY in flag rows (expandable detail) — group stats carry counts.

function median_(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function tenureYears_(hireDate, asOf) {
  if (!(hireDate instanceof Date) || isNaN(hireDate)) return null;
  return (asOf - hireDate) / YEAR_MS_;
}

function buildEquity_(activeRecords, cfg, asOf) {
  const groups = new Map();
  activeRecords.forEach(r => {
    if (r.tcc == null || r.tcc <= 0) return;
    const key = (r.keyLocation || "—") + "||" + (r.level || "—");
    if (!groups.has(key)) groups.set(key, { keyLocation: r.keyLocation || "—", level: r.level || "—", members: [] });
    groups.get(key).members.push(r);
  });
  const genderAvailable = activeRecords.some(r => r.gender);
  const gender = [], outliers = [], tenure = [];
  groups.forEach(g => {
    const med = median_(g.members.map(r => r.tcc));

    if (genderAvailable) {
      const byG = new Map();
      g.members.forEach(r => {
        const gd = String(r.gender || "").trim();
        if (!gd) return;
        if (!byG.has(gd)) byG.set(gd, []);
        byG.get(gd).push(r.tcc);
      });
      const eligible = [...byG.entries()].filter(([, v]) => v.length >= 2);
      if (eligible.length >= 2) {
        const medians = {};
        eligible.forEach(([k, v]) => { medians[k] = median_(v); });
        const vals = Object.values(medians);
        const gapPct = (Math.max.apply(null, vals) - Math.min.apply(null, vals)) / Math.max.apply(null, vals) * 100;
        const counts = {};
        eligible.forEach(([k, v]) => { counts[k] = v.length; });
        gender.push({ keyLocation: g.keyLocation, level: g.level, counts, medians,
                      gapPct: Math.round(gapPct * 10) / 10, flagged: gapPct >= cfg.EQUITY_GAP_PCT });
      }
    }

    g.members.forEach(r => {
      if (med == null || med <= 0) return;
      const pctBelow = (med - r.tcc) / med * 100;
      if (pctBelow >= cfg.EQUITY_OUTLIER_PCT) {
        outliers.push({ empNo: r.empNo, name: r.name, keyLocation: g.keyLocation, level: g.level,
                        tcc: r.tcc, groupMedian: med, pctBelow: Math.round(pctBelow * 10) / 10 });
      }
      const ten = tenureYears_(r.hireDate, asOf);
      if (ten != null && ten >= cfg.TENURE_YEARS_MIN && pctBelow >= cfg.TENURE_BELOW_PCT) {
        tenure.push({ empNo: r.empNo, name: r.name, keyLocation: g.keyLocation, level: g.level,
                      tenureYears: Math.round(ten * 10) / 10, tcc: r.tcc, groupMedian: med,
                      pctBelow: Math.round(pctBelow * 10) / 10 });
      }
    });
  });
  return {
    genderAvailable,
    gender:   gender.sort((a, b) => b.gapPct - a.gapPct),
    tenure:   tenure.sort((a, b) => b.pctBelow - a.pctBelow),
    outliers: outliers.sort((a, b) => b.pctBelow - a.pctBelow),
  };
}

// ── QTA interim engine ──────────────────────────────────────────────────────
// The official QTA-cycle source doesn't exist yet (placeholder tab). Interim
// signal: each active Rocketeer's Next Review date from their MOST RECENT RD
// event that carries one — sorted overdue-first so "waiting longest" tops the
// list. daysOverdue is positive when past due, negative when upcoming.

function buildQtaInterim_(activeRecords, histByEmp, asOf) {
  const DAY = 86400000;
  const rows = activeRecords.map(r => {
    const evs = (histByEmp[r.empNo] || [])
      .filter(e => e && e.date instanceof Date && !isNaN(e.date))
      .sort((a, b) => b.date - a.date); // newest first
    const last = evs[0] || null;
    const withReview = evs.find(e => e.nextReview instanceof Date && !isNaN(e.nextReview));
    const nextReview = withReview ? withReview.nextReview : null;
    return {
      empNo: r.empNo, name: r.name, dept: r.dept, keyLocation: r.keyLocation, level: r.level,
      nextReview: nextReview ? isoDate_(nextReview) : null,
      daysOverdue: nextReview ? Math.round((asOf - nextReview) / DAY) : null,
      lastEventDate: last ? isoDate_(last.date) : null,
      lastEventReason: last ? (last.reason || "") : "",
    };
  });
  return rows.sort((a, b) => {
    if (a.nextReview && b.nextReview) return b.daysOverdue - a.daysOverdue;
    if (a.nextReview) return -1;
    if (b.nextReview) return 1;
    return a.name.localeCompare(b.name);
  });
}

// ============================================================
// GAS LAYER — everything below touches GAS services.
// Nothing below this line is exercised by the Node test harness.
// ============================================================

function log_(msg) { if (CONFIG_CD.DEBUG) Logger.log(msg); }

function props_() { return PropertiesService.getScriptProperties(); }

function ssIds_() {
  const p = props_();
  return {
    roster:    p.getProperty("CD_ROSTER_SS_ID")    || CONFIG_CD.ROSTER_SS_ID,
    hist:      p.getProperty("CD_COMP_HIST_SS_ID") || CONFIG_CD.COMP_HIST_SS_ID,
    rosterTab: p.getProperty("CD_ROSTER_TAB")      || CONFIG_CD.ROSTER_TAB,
    histTab:   p.getProperty("CD_HIST_TAB")        || CONFIG_CD.HIST_TAB,
  };
}

// ── Large-payload cache (gzip + chunking) ───────────────────────────────────
// Same pattern as PS Contribution Report: CacheService rejects any single
// value over 100 KB and a plain put() fails silently, so the JSON is gzipped
// (~10× smaller) and split across numbered chunk keys. A missing chunk on
// read is a clean miss.
const CACHE_CHUNK_BYTES_ = 90 * 1024;

function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    const b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    const entries = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    log_("cachePutLarge_: " + key + " — " + str.length + " chars → " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

function cacheGetLarge_(cache, key) {
  try {
    const meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    const names = [];
    for (let i = 0; i < meta; i++) names.push(key + "_" + i);
    const got = cache.getAll(names);
    let b64 = "";
    for (let i = 0; i < meta; i++) {
      const part = got[key + "_" + i];
      if (!part) return null; // chunk evicted — treat as a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}

/** Bump CD_CACHE_VER — strands every prior cache entry at once. */
function bustCompCache_() {
  const p = props_();
  const cur = parseInt(p.getProperty("CD_CACHE_VER") || "1", 10);
  p.setProperty("CD_CACHE_VER", String(cur + 1));
  Logger.log("✅ bustCompCache_: CD_CACHE_VER → " + (cur + 1));
}

// ── Sheet readers (header-name access only) ─────────────────────────────────

function fetchTab_(ssId, tabName) {
  const ss = SpreadsheetApp.openById(ssId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    // Tolerate whitespace/case drift in tab names ("TCC USD " vs "TCC USD").
    const want = String(tabName).toLowerCase().replace(/\s+/g, " ").trim();
    sh = ss.getSheets().find(s =>
      s.getName().toLowerCase().replace(/\s+/g, " ").trim() === want) || null;
    if (sh) Logger.log('⚠️ fetchTab_: using tab "' + sh.getName() + '" for requested "' + tabName + '"');
  }
  if (!sh) {
    // Available-tab listing stays log-only — the thrown message reaches
    // dashboard users via meta.sources.
    Logger.log('❌ fetchTab_: tab "' + tabName + '" not found — available: ' +
               ss.getSheets().map(s => s.getName()).join(" | "));
    throw new Error('Tab "' + tabName + '" not found (execution log lists available tabs)');
  }
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  return { headers, rows: values };
}

function colIdx_(headers, name, re) {
  let i = headers.indexOf(name);
  if (i === -1 && re) i = headers.findIndex(h => re.test(h));
  return i;
}

/** @returns {{records: Object[], genderAvailable: boolean, tccUsdAvailable: boolean}} normalized roster records (crew excluded). */
function readRosterCD_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.roster, ids.rosterTab);
  const col = (name, re) => colIdx_(headers, name, re);
  const c = {
    empNo: col("Employee Number"), name: col("Name"), status: col("Employee Status"),
    title: col("Job Title"), hire: col("Hire Date"),
    term: col("Termination/Release Date"), currency: col("Currency"),
    location: col("Location"), tcc: col("Total Cash Compensation (TCC)", /total cash comp/i),
    lob: col("LOB"), dept: col("Department"), email: col("Email"),
    termReason: col("Termination Reason"), termRegret: col("Termination Regretted"),
    termCat: col("Termination Category"), keyLoc: col("Key Location"),
    gender: col("Gender"), // optional — being added to the roster
    tccUsd: col(CONFIG_CD.TCC_USD_COL, /tcc.*usd/i), // optional — column position shifts, resolved by header
  };
  const required = { empNo: c.empNo, name: c.name, title: c.title, keyLoc: c.keyLoc };
  Object.keys(required).forEach(k => {
    if (required[k] === -1) throw new Error("Roster column missing: " + k);
  });
  const genderAvailable = c.gender !== -1;
  const tccUsdAvailable = c.tccUsd !== -1;
  const records = [];
  rows.forEach(row => {
    const name = String(row[c.name] || "").trim();
    if (!name) return;
    const title = String(row[c.title] || "").trim();
    if (CONFIG_CD.CREW_RE.test(title)) return; // crew/contractors out of scope in V1
    const status = c.status !== -1 ? String(row[c.status] || "").trim() : "";
    const termDate = c.term !== -1 ? asDate_(row[c.term]) : null;
    const lvl = parseLevel_(title);
    records.push({
      empNo: String(row[c.empNo] || "").trim(),
      name,
      email: c.email !== -1 ? String(row[c.email] || "").trim().toLowerCase() : "",
      active: !termDate && !CONFIG_CD.INACTIVE_RE.test(status),
      jobTitle: title, level: lvl.level, track: lvl.track,
      dept: c.dept !== -1 ? String(row[c.dept] || "").trim() : "",
      lob: c.lob !== -1 ? String(row[c.lob] || "").trim() : "",
      keyLocation: String(row[c.keyLoc] || "").trim(),
      location: c.location !== -1 ? String(row[c.location] || "").trim() : "",
      currency: c.currency !== -1 ? String(row[c.currency] || "").trim() : "",
      hireDate: c.hire !== -1 ? asDate_(row[c.hire]) : null,
      termDate,
      termReason: c.termReason !== -1 ? String(row[c.termReason] || "").trim() : "",
      termCategory: c.termCat !== -1 ? String(row[c.termCat] || "").trim() : "",
      termRegretted: c.termRegret !== -1 ? String(row[c.termRegret] || "").trim() : "",
      gender: genderAvailable ? (String(row[c.gender] || "").trim() || null) : null,
      tcc: c.tcc !== -1 ? asNum_(row[c.tcc]) : null,
      tccUsd: c.tccUsd !== -1 ? asNum_(row[c.tccUsd]) : null, // read directly off the roster row
    });
  });
  log_("readRosterCD_: " + records.length + " records, gender " + (genderAvailable ? "available" : "pending") +
       ", TCC USD " + (tccUsdAvailable ? "available" : "pending"));
  return { records, genderAvailable, tccUsdAvailable };
}

/**
 * @returns {Object<string, Array>} Employee Number → comp events. Order is NOT
 * guaranteed — every consumer (buildGrowthForEmp_, buildQtaInterim_) sorts for itself.
 */
function readCompHistory_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.hist, ids.histTab);
  const iEmp    = colIdx_(headers, "Employee Number");
  const iDate   = colIdx_(headers, "Effective Date");
  const iTtc    = colIdx_(headers, "Total Target Compensation");
  const iReason = colIdx_(headers, "TCC Change Reason");
  const iNext   = colIdx_(headers, "Next Review");
  if (iEmp === -1 || iDate === -1 || iTtc === -1) {
    // Header dump is log-only, client message generic (same rule as readRosterCD_).
    Logger.log("❌ readCompHistory_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("RD tab: required columns missing (see execution log).");
  }
  const byEmp = {};
  rows.forEach(row => {
    const emp = String(row[iEmp] || "").trim();
    const date = asDate_(row[iDate]);
    if (!emp || !date) return;
    if (!byEmp[emp]) byEmp[emp] = [];
    byEmp[emp].push({
      date,
      reason: iReason !== -1 ? String(row[iReason] || "").trim() : "",
      tcc: asNum_(row[iTtc]), // LOCAL Total Target Compensation recorded at the event
      nextReview: iNext !== -1 ? asDate_(row[iNext]) : null,
    });
  });
  log_("readCompHistory_: " + Object.keys(byEmp).length + " employees with events");
  return byEmp;
}

// ── Assembly + web app ──────────────────────────────────────────────────────

/**
 * Full report payload. Access-checked server-side (defense in depth — the
 * client can call this via google.script.run without going through doGet).
 * @param {boolean} force - true bypasses cache (Refresh button).
 * @returns {string} JSON of {ok, meta, employees[], attrition, compaGroups[],
 *   equity, qtaInterim[], history} — or {ok:false, error:"denied"}. Returned as a
 *   STRING on purpose: google.script.run marshals a large nested object across the
 *   iframe bridge minutes-slow, while one string + client-side JSON.parse is fast.
 *   ViewDash.html's onData() parses it and depends on this exact shape.
 */
function getCompReportData(force) {
  const access = checkDashboardAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });

  const cache = CacheService.getScriptCache();
  const ver = props_().getProperty("CD_CACHE_VER") || "1";
  const key = CONFIG_CD.CACHE_KEY_PREFIX + "v" + ver + "_all";
  if (!force) {
    const hit = cacheGetLarge_(cache, key);
    if (hit) {
      const obj = JSON.parse(hit);
      obj.meta.fromCache = true;
      obj.meta.role = access.role;   // never serve the cached builder's identity
      obj.meta.email = access.email;
      return JSON.stringify(obj);
    }
  }

  const t0 = Date.now();
  const ctx = fiscalContextCD_();
  const sources = { roster: "ok", history: "ok" };

  let records = [], genderAvailable = false, tccUsdAvailable = false;
  try {
    const r = readRosterCD_();
    records = r.records;
    genderAvailable = r.genderAvailable;
    tccUsdAvailable = r.tccUsdAvailable;
  } catch (e) {
    sources.roster = "error: " + e.message;
    Logger.log("❌ readRosterCD_: " + e.message);
  }
  let histByEmp = {};
  try { histByEmp = readCompHistory_(); }
  catch (e) { sources.history = "error: " + e.message; Logger.log("⚠️ readCompHistory_: " + e.message); }

  const active = records.filter(r => r.active);

  const history = {};
  active.forEach(r => { if (histByEmp[r.empNo]) history[r.empNo] = buildGrowthForEmp_(histByEmp[r.empNo]); });

  const payload = {
    ok: true,
    meta: {
      generatedAt: new Date().toISOString(),
      role: access.role, email: access.email, fromCache: false,
      fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel, qLabel: ctx.qLabel,
      monthLabels: ctx.monthLabels,
      fiscalMonthIdx: fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear),
      sources, genderAvailable, tccUsdAvailable,
      activeCount: active.length,
      contribUrl: props_().getProperty("CD_CONTRIB_URL") || "",
      // Threshold echoes — the client colors and documents from these, never
      // from its own literals, so UI text can't drift from CONFIG_CD.
      compaBands: { green: CONFIG_CD.COMPA_GREEN_MIN, yellow: CONFIG_CD.COMPA_YELLOW_MIN },
      equityCfg: {
        gapPct: CONFIG_CD.EQUITY_GAP_PCT, outlierPct: CONFIG_CD.EQUITY_OUTLIER_PCT,
        tenureYearsMin: CONFIG_CD.TENURE_YEARS_MIN, tenureBelowPct: CONFIG_CD.TENURE_BELOW_PCT,
        smallGroupMin: CONFIG_CD.SMALL_GROUP_MIN,
      },
    },
    employees: active.map(r => ({
      empNo: r.empNo, name: r.name, jobTitle: r.jobTitle, level: r.level, track: r.track,
      dept: r.dept, keyLocation: r.keyLocation, currency: r.currency,
      tcc: r.tcc, tccUsd: r.tccUsd, hireDate: isoDate_(r.hireDate), gender: r.gender,
    })),
    attrition: buildAttrition_(records, ctx),
    compaGroups: buildCompaGroups_(active, CONFIG_CD.SMALL_GROUP_MIN),
    equity: buildEquity_(active, CONFIG_CD, ctx.asOf),
    qtaInterim: buildQtaInterim_(active, histByEmp, ctx.asOf),
    history,
  };

  const json = JSON.stringify(payload);
  cachePutLarge_(cache, key, json, CONFIG_CD.CACHE_TTL_SEC);
  Logger.log("✅ getCompReportData: built in " + Math.round((Date.now() - t0) / 1000) + "s — " +
             json.length + " chars, " + active.length + " active");
  return json;
}

function doGet() {
  const access = checkDashboardAccess();
  if (!access.allowed) {
    Logger.log("⚠️ doGet denied: " + access.email);
    return HtmlService.createHtmlOutput(deniedPageHtml_(access.email))
      .setTitle("Access restricted");
  }
  const t = HtmlService.createTemplateFromFile("ViewDash");
  t.userRole = access.role;
  t.userEmail = access.email;
  return t.evaluate()
    .setTitle("Rocketeer Global Comp Health Report")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ── Diagnostics — run from the GAS editor ───────────────────────────────────
function debugCompPipeline() {
  const r = readRosterCD_();
  const active = r.records.filter(x => x.active);
  Logger.log("Roster: " + r.records.length + " rows after crew exclusion, " + active.length +
             " active, gender " + (r.genderAvailable ? "AVAILABLE" : "PENDING"));
  const parsed = active.filter(x => x.level !== "—").length;
  Logger.log("Level parse: " + parsed + "/" + active.length + " (" +
             Math.round(parsed / Math.max(1, active.length) * 100) + "%) — sample misses: " +
             active.filter(x => x.level === "—").slice(0, 5).map(x => x.jobTitle).join(" | "));
  const usdHits = active.filter(x => x.tccUsd != null).length;
  Logger.log("TCC USD column: " + (r.tccUsdAvailable ? "FOUND" : "NOT FOUND") + " — " +
             usdHits + "/" + active.length + " active have a value");
  let hist = {};
  try { hist = readCompHistory_(); }
  catch (e) { Logger.log("⚠️ readCompHistory_ (debug): " + e.message); }
  const histHits = active.filter(x => hist[x.empNo]).length;
  Logger.log("RD history join: " + histHits + "/" + active.length + " active matched, " +
             Object.keys(hist).length + " employees total in RD");
  const groups = buildCompaGroups_(active, CONFIG_CD.SMALL_GROUP_MIN);
  const small = groups.filter(g => g.smallGroup).length;
  Logger.log("Compa groups: " + groups.length + " (" + small + " small, " +
             groups.filter(g => g.count === 1).length + " singletons)");
}
