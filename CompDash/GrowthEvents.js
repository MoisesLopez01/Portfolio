// ============================================================
// SCRIPT NAME: Comp Health Report — GrowthEvents engine (P2)
// PURPOSE:     Promotions + adjustments per 100 Rocketeers per
//              cohort (FY27 annualized vs FY26 actual) and the
//              retain-vs-rehire economics.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.growth = 49;

// ── Event classification ────────────────────────────────────────────────────
// RD "TCC Change Reason" → promo | adjust | null. Promotion wins first so a
// "Promotion with salary adjustment" never double-counts. adjustRe default is
// a starting vocabulary — verify against live reasons (debugCompPipeline logs
// the unmatched set) and tune via CONFIG_CD.P2.GROWTH.adjustRe.

function classifyGrowthEvent_(reason, cfg) {
  const s = String(reason || "");
  if (cfg.PROMO_RE.test(s)) return "promo";
  if (cfg.P2.GROWTH.adjustRe.test(s)) return "adjust";
  return null;
}

// ── Growth pace per cohort ──────────────────────────────────────────────────
// "Grow the Tree, Share the Fruit", audited: (promotions + adjustments) ÷
// headcount × 100 — current FY annualized from elapsed fiscal months, prior FY
// actual. Events attribute to the person's CURRENT cohort (Key Location ×
// Department) — cohort history at event time isn't recorded anywhere.

/**
 * @param {Array} records roster records
 * @param {Object<string,Array>} histByEmp readCompHistory_ output
 * @param {Object} ctx fiscalContextCD_ output
 * @param {Object} cfg CONFIG_CD-shaped (PROMO_RE, P2.GROWTH)
 * @returns {{rows:Array, company:Object, elapsedMonths:number}}
 */
function buildGrowthEvents_(records, histByEmp, ctx, cfg) {
  const cohortOf = r => (r.keyLocation || "—") + "||" + (r.dept || "—");
  const elapsedMonths = fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear) + 1;
  const cur = { start: ctx.fyStart, end: ctx.asOf };
  const prev = { start: ctx.prevFyStart, end: ctx.prevFyEnd };
  const mkCounts = () => ({ promoCur: 0, adjCur: 0, promoPrev: 0, adjPrev: 0 });
  const map = new Map();
  const company = mkCounts();
  records.forEach(r => {
    const k = cohortOf(r);
    if (!map.has(k)) map.set(k, mkCounts());
    const g = map.get(k);
    (histByEmp[r.empNo] || []).forEach(e => {
      if (!e || !(e.date instanceof Date) || isNaN(e.date)) return;
      const cls = classifyGrowthEvent_(e.reason, cfg);
      if (!cls) return;
      const slot = (e.date >= cur.start && e.date <= cur.end) ? "Cur"
        : (e.date >= prev.start && e.date <= prev.end) ? "Prev" : null;
      if (!slot) return;
      const field = (cls === "promo" ? "promo" : "adj") + slot;
      g[field]++;
      company[field]++;
    });
  });
  const per100 = (n, hc, annualize) => {
    if (!(hc > 0)) return null;
    const yearly = annualize ? (elapsedMonths > 0 ? n * 12 / elapsedMonths : 0) : n;
    return Math.round(yearly / hc * 100);
  };
  const avgHc = (recs, span) =>
    (headcountOn_(recs, span.start) + headcountOn_(recs, span.end)) / 2;
  const rows = [...map.entries()].map(([k, g]) => {
    const recs = records.filter(r => cohortOf(r) === k);
    const [keyLocation, dept] = k.split("||");
    return {
      key: k, keyLocation, dept,
      headcount: recs.filter(r => r.active).length,
      promoFY: g.promoCur, adjFY: g.adjCur,
      promoPrevFY: g.promoPrev, adjPrevFY: g.adjPrev,
      per100Cur: per100(g.promoCur + g.adjCur, avgHc(recs, cur), true),
      per100Prev: per100(g.promoPrev + g.adjPrev, avgHc(recs, prev), false),
    };
  }).filter(r => r.headcount > 0 || r.promoFY + r.adjFY + r.promoPrevFY + r.adjPrevFY > 0)
    .sort((a, b) => (a.per100Cur == null) - (b.per100Cur == null) ||
      (a.per100Cur || 0) - (b.per100Cur || 0));
  return {
    rows,
    company: {
      promoFY: company.promoCur, adjFY: company.adjCur,
      per100Cur: per100(company.promoCur + company.adjCur, avgHc(records, cur), true),
      per100Prev: per100(company.promoPrev + company.adjPrev, avgHc(records, prev), false),
    },
    elapsedMonths,
  };
}

// ── Retain vs rehire economics ──────────────────────────────────────────────
// Flagged = RISK / RISK_IMMEDIATE person signals. rehireExposure = replaceFactor
// × TCC USD. retainCost = gap to gapTarget × internal anchor, converted to USD
// at the person's own tccUsd/tcc rate (never a blended FX). Missing tccUsd
// rows are skipped and reported via coverage — never zero-filled.

/**
 * @param {Array<{signal:string, tcc:?number, tccUsd:?number, anchor:?number}>} emps
 * @param {Object} cfg CONFIG_CD-shaped (P2.GROWTH)
 */
function retainVsRehire_(emps, cfg) {
  const G = cfg.P2.GROWTH;
  let retain = 0, rehire = 0, flagged = 0, counted = 0;
  (emps || []).forEach(e => {
    if (e.signal !== "RISK" && e.signal !== "RISK_IMMEDIATE") return;
    flagged++;
    if (!(e.tccUsd > 0)) return;
    counted++;
    rehire += G.replaceFactor * e.tccUsd;
    if (e.anchor > 0 && e.tcc > 0) {
      retain += Math.max(0, G.gapTarget * e.anchor - e.tcc) * (e.tccUsd / e.tcc);
    }
  });
  return {
    flagged,
    retainCostUsd: Math.round(retain),
    rehireExposureUsd: Math.round(rehire),
    centsPerDollar: rehire > 0 ? Math.round(retain / rehire * 100) : null,
    coverage: { counted, total: flagged },
  };
}
