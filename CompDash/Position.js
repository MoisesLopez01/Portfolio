// ============================================================
// SCRIPT NAME: Comp Health Report — Position engine
// PURPOSE:     Where one person sits — anchors, ratios, growth,
//              ratings, signals, priority, equity, QTA.
//
// PURE. No SpreadsheetApp, no CacheService, no Session. Every
// function takes plain objects and returns plain objects, which is
// what lets tests/run_tests.js exercise it under plain node.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.position = 46;

// ── Internal Position engine V2 ─────────────────────────────────────────────
// ratio = TCC ÷ anchor, ACTIVE employees, LOCAL currency, where the anchor is
// resolved per Key Location + Job Title group in tiers:
//   1 "title"  — group ≥ SMALL_GROUP_MIN → median of the title peers
//   2 "market" — small group with a same-currency benchmark Mean (N-of-1 rule:
//                External Market Parity replaces internal equity for unique roles)
//   3 "level"  — median of the Key Location + Level cohort (≥ SMALL_GROUP_MIN);
//                level "—" never borrows a cohort
//   4 "none"   — insufficientPeers, ratio null
// Anchors always derive from the FULL active population — UI filters never
// recompute them. Ratios may exceed 1.0 (median anchor).

function buildCompaGroups_(activeRecords, benchMap, cfg) {
  const min = (cfg && cfg.SMALL_GROUP_MIN) || CONFIG_CD.SMALL_GROUP_MIN;
  // Part-time / interns (comparable === false) never serve as anchor evidence
  // — not in title-peer medians, not in level cohorts — and never receive a
  // ratio. They still appear in the group listing with a discreet
  // nonComparable flag (V4 employment-type rule).
  const isComparable = r => r.comparable !== false;
  const cohorts = new Map(); // "keyLocation||level" → tcc[]
  activeRecords.forEach(r => {
    if (!isComparable(r) || !(r.tcc > 0) || !r.level || r.level === "—") return;
    const k = (r.keyLocation || "—") + "||" + r.level;
    if (!cohorts.has(k)) cohorts.set(k, []);
    cohorts.get(k).push(r.tcc);
  });
  const map = new Map();
  activeRecords.forEach(r => {
    const key = (r.keyLocation || "—") + "||" + (r.jobTitle || "—");
    if (!map.has(key)) {
      map.set(key, { keyLocation: r.keyLocation || "—", jobTitle: r.jobTitle || "—",
                     level: r.level, currency: r.currency || "", members: [], extras: [],
                     missingTcc: 0 });
    }
    const g = map.get(key);
    if (!isComparable(r)) { g.extras.push(r); return; }
    if (r.tcc == null || r.tcc <= 0) { g.missingTcc++; return; }
    g.members.push(r);
  });
  return [...map.values()].map(g => {
    const count = g.members.length; // anchor basis: comparable members with TCC
    let anchor = null, anchorTier = "none";
    if (count >= min) {
      anchor = median_(g.members.map(r => r.tcc));
      anchorTier = "title";
    } else if (count > 0) {
      const b = lookupBench_(benchMap, g.keyLocation, g.jobTitle, g.currency);
      if (b.row && b.row.mean > 0) {
        anchor = b.row.mean;
        anchorTier = "market";
      } else if (g.level && g.level !== "—") {
        const cohort = cohorts.get(g.keyLocation + "||" + g.level) || [];
        if (cohort.length >= min) { anchor = median_(cohort); anchorTier = "level"; }
      }
    }
    return {
      keyLocation: g.keyLocation, jobTitle: g.jobTitle, currency: g.currency,
      anchor, anchorTier, count, missingTcc: g.missingTcc,
      smallGroup: count > 0 && count < min,
      insufficientPeers: count > 0 && anchorTier === "none",
      members: g.members
        .map(r => ({
          empNo: r.empNo, name: r.name, level: r.level, currency: r.currency,
          tcc: r.tcc, tccUsd: r.tccUsd,
          ratio: anchor > 0 ? Math.round(r.tcc / anchor * 1000) / 1000 : null,
          noPeers: count === 1,
        }))
        .concat(g.extras.map(r => ({
          empNo: r.empNo, name: r.name, level: r.level, currency: r.currency,
          tcc: r.tcc, tccUsd: r.tccUsd,
          ratio: null, noPeers: false,
          nonComparable: true, employmentType: r.employmentType,
        })))
        .sort((a, b) => (a.ratio == null) - (b.ratio == null) || a.ratio - b.ratio),
    };
  }).sort((a, b) =>
    a.keyLocation.localeCompare(b.keyLocation) || a.jobTitle.localeCompare(b.jobTitle));
}

// ── External market benchmarks (Benchmarking → Compilation tab) ────────────
// Joined by normalized Location + Job Title ↔ roster Key Location + Job Title.
// All values LOCAL currency; a row whose currency disagrees with the roster is
// withheld (mismatch flag) — never silently compared across currencies.

function benchKey_(location, jobTitle) {
  return normCD_(location) + "||" + normCD_(jobTitle);
}

/** @returns {{row: (Object|null), mismatch: boolean}} */
function lookupBench_(benchMap, keyLocation, jobTitle, empCurrency) {
  const row = benchMap ? benchMap[benchKey_(keyLocation, jobTitle)] : null;
  if (!row) return { row: null, mismatch: false };
  if (row.currency && empCurrency && normCD_(row.currency) !== normCD_(empCurrency)) {
    return { row: null, mismatch: true };
  }
  return { row, mismatch: false };
}

// ── Market suggestion — runs SERVER-SIDE per employee (V2) ──────────────────
// p50 slot carries the benchmark MEAN (labeled "Mean" in the UI, never P50).
// Red = raise to P25 is the priority read; yellow = move to mean; green = at market.
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

/**
 * Normalize an RD "TAG" cell (system-generated TCC AGR) to a FRACTION.
 * Percent-formatted numeric cells arrive from Sheets already fractional
 * (1.27% → 0.0127) and are kept as-is; string cells carrying "%" are
 * percent points ("45.00%" → 0.45); bare strings are treated as fractions.
 */
function tagRate_(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = asNum_(s);
  if (n == null) return null;
  return s.indexOf("%") !== -1 ? n / 100 : n;
}

function buildGrowthForEmp_(events) {
  const evs = (events || [])
    .filter(e => e && e.date instanceof Date && !isNaN(e.date))
    .sort((a, b) => a.date - b.date);
  const out = [];
  let prev = null;
  evs.forEach(e => {
    const row = { date: isoDate_(e.date), reason: e.reason || "", tcc: e.tcc,
                  tag: (typeof e.tag === "number" && isFinite(e.tag)) ? e.tag : null,
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

/**
 * Performance summary per employee. `windowFqs` (from lastCompletedQuarters_)
 * restricts avg/count/windowLatest to the SI evidence window — full history is
 * always preserved for the drawer. No window ratings → avg null (the Priority
 * Score component drops out as partial °), never a stale all-time average and
 * never a fake zero. Omitting windowFqs keeps the legacy all-history average.
 */
function buildPerfForEmp_(rows, windowFqs) {
  const hist = (rows || [])
    .filter(r => r && typeof r.rate === "number" && isFinite(r.rate))
    .sort((a, b) => String(a.fq).localeCompare(String(b.fq)));
  if (!hist.length) {
    return { avg: null, latest: null, windowLatest: null, count: 0, totalCount: 0, history: [] };
  }
  const win = windowFqs ? hist.filter(r => windowFqs.indexOf(String(r.fq)) !== -1) : hist;
  const avg = win.length ? win.reduce((t, r) => t + r.rate, 0) / win.length : null;
  return {
    avg: avg != null ? Math.round(avg * 100) / 100 : null,
    latest: hist[hist.length - 1].rate,
    windowLatest: win.length ? win[win.length - 1].rate : null,
    count: win.length,
    totalCount: hist.length,
    history: hist.map(r => ({ fq: r.fq, rate: r.rate, explanation: r.explanation || "" })),
  };
}

// ── Decision signals (V4) ───────────────────────────────────────────────────
// Deterministic per-employee flags surfaced via the Compensation Position
// table's drill panel (folded from the standalone Risk Signals view in P0).
// Every flag is explainable: retentionRisk carries the exact factors that
// fired. Thresholds
// come from cfg.SIGNALS (CD_SIGNALS_CFG-overridable) and echo via
// meta.signalsCfg — the UI never hardcodes them.

/**
 * @param {{level:string, ratio:?number, marketRatio:?number, ttmGrowthPct:?number,
 *   profileYears:?number, everPromoted:boolean, windowLatest:?number}} v
 * @param {Object} cfg CONFIG_CD-shaped (SIGNALS, MARKET_LOW, COMPA_TARGET_MIN)
 */
function buildSignalsForEmp_(v, cfg) {
  const S = cfg.SIGNALS;
  const promoStale = v.profileYears != null && v.profileYears >= S.promoStaleYears;
  const earlyCareer = S.earlyCareerRe.test(String(v.level || ""));
  const coreLevel = S.coreLevelRe.test(String(v.level || ""));
  // Excellent latest completed quarter + a sub-threshold trailing increase.
  // ttm null (history < 1y) never fires — a new hire hasn't missed a raise.
  const recognitionRisk = v.windowLatest != null && v.windowLatest >= S.recogMinRating &&
    v.ttmGrowthPct != null && v.ttmGrowthPct < S.recogMaxTtm;
  // Check L spirit: strong contribution evidence + weak/absent rating visibility
  // = verify with the manager. A verification trigger — never a comp risk factor.
  const invisibleContributor = v.contribScore != null && v.contribScore >= S.invisibleMinScore &&
    (v.perfAvg == null || v.perfAvg < S.invisibleWeakSi);
  const riskFactors = [];
  if (v.ratio != null && v.ratio < cfg.COMPA_TARGET_MIN) riskFactors.push("below internal anchor");
  if (v.marketRatio != null && v.marketRatio < cfg.MARKET_LOW) riskFactors.push("below market");
  if (promoStale) riskFactors.push("promotion stale " +
    (v.everPromoted ? Math.round(v.profileYears * 10) / 10 + "y" : "(never promoted)"));
  if (recognitionRisk) riskFactors.push("recognition risk");
  return {
    everPromoted: !!v.everPromoted,
    promoStale, earlyCareer, coreLevel, recognitionRisk, invisibleContributor,
    retentionRisk: coreLevel && riskFactors.length >= S.riskFactorMin,
    riskFactors,
  };
}

/**
 * Latest-quarter contribution snapshot per employee from parsed sheet rows.
 * Fixed-width quarter labels ("FY26Q4") sort correctly as strings, so the
 * lexicographic max is the most recent snapshot.
 * @param {Array<Object>} rows {empNo, quarter, ...evidence fields}
 * @returns {{byEmp: Object, quarter: (string|null), count: number}}
 */
function buildContribByEmp_(rows) {
  const byEmp = {};
  let latestQ = null;
  (rows || []).forEach(r => {
    if (!r || !r.empNo || !r.quarter) return;
    const cur = byEmp[r.empNo];
    if (!cur || String(r.quarter) > String(cur.quarter)) byEmp[r.empNo] = r;
    if (!latestQ || String(r.quarter) > latestQ) latestQ = String(r.quarter);
  });
  return { byEmp, quarter: latestQ, count: Object.keys(byEmp).length };
}

// ── Priority Score ──────────────────────────────────────────────────────────
// Config-weighted composite answering "who to prioritize for adjustment":
// high performers currently underpaid relative to their resolved anchor.
// A missing component drops out and its weight redistributes proportionally —
// no component ever fakes a zero. Weights/caps echo via meta.priorityCfg.

function priorityScore_(v, cfg) {
  const w = cfg.PRIORITY_W, caps = cfg.PRIORITY_CAPS;
  const comps = {
    perf: (v.perfAvg != null && v.perfCount > 0)
      ? Math.min(v.perfAvg / cfg.RATING_MAX, 1) : null,
    tenure: (v.companyYears != null)
      ? 0.5 * Math.min(v.companyYears / caps.companyYears, 1)
      + 0.5 * Math.min((v.profileYears != null ? v.profileYears : v.companyYears) / caps.profileYears, 1)
      : null,
    compaGap: (v.ratio != null)
      ? Math.min(Math.max(0, 1 - v.ratio) / caps.gapPct, 1) : null,
  };
  let totalW = 0, sum = 0;
  const missing = [];
  [["perf", w.perf], ["tenure", w.tenure], ["compaGap", w.compaGap]].forEach(function (p) {
    if (comps[p[0]] == null) { missing.push(p[0]); return; }
    totalW += p[1]; sum += comps[p[0]] * p[1];
  });
  if (!totalW) return { score: null, components: comps, partial: true, missing };
  return { score: Math.round(sum / totalW * 100), components: comps,
           partial: missing.length > 0, missing };
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

/**
 * Years in the CURRENT role: since the most recent RD event whose reason
 * matches promoRe (promotion / title change), falling back to hireDate.
 * The "just getting started vs historical expert" distinction.
 */
function profileTenureYears_(events, hireDate, asOf, promoRe) {
  const promos = (events || [])
    .filter(e => e && e.date instanceof Date && !isNaN(e.date) &&
                 promoRe.test(String(e.reason || "")))
    .sort((a, b) => b.date - a.date);
  const anchor = promos.length ? promos[0].date : hireDate;
  if (!(anchor instanceof Date) || isNaN(anchor)) return null;
  return Math.round((asOf - anchor) / YEAR_MS_ * 10) / 10;
}

/**
 * Trailing-12-month TCC growth: current TCC vs the TCC in effect one year ago
 * (the latest RD event dated ≤ asOf − 1 year). Null when history is younger
 * than a year — never extrapolated.
 */
function ttmGrowth_(events, currentTcc, asOf) {
  if (!(currentTcc > 0)) return null;
  const cutoff = new Date(asOf.getTime() - YEAR_MS_);
  const base = (events || [])
    .filter(e => e && e.date instanceof Date && !isNaN(e.date) &&
                 e.tcc > 0 && e.date <= cutoff)
    .sort((a, b) => b.date - a.date)[0];
  if (!base) return null;
  return Math.round((currentTcc / base.tcc - 1) * 1000) / 1000;
}

function buildEquity_(activeRecords, cfg, asOf) {
  const groups = new Map();
  activeRecords.forEach(r => {
    // Non-comparable employment types (part-time/intern) sit outside the
    // equity lenses entirely — comparing them to full-time medians would
    // manufacture false flags (V4 rule).
    if (r.comparable === false) return;
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

