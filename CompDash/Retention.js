// ============================================================
// SCRIPT NAME: Comp Health Report — Retention engine (P2)
// PURPOSE:     Cohort rolling-window attrition with the dual
//              false-alarm gate (market mark AND the cohort's
//              own FY25/FY26 history), plus evidence packs.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.retention = 49;

// ── Quarter ranges & rolling windows ────────────────────────────────────────

/** "FY26Q4" → {start: 2026-04-01, end: 2026-06-30} (FY starts July 1). */
function quarterRangeCD_(fq) {
  const m = String(fq || "").match(/^FY(\d{2})Q([1-4])$/);
  if (!m) return null;
  const fyStartCalYear = 2000 + parseInt(m[1], 10) - 1;
  const q = parseInt(m[2], 10);
  return {
    start: new Date(fyStartCalYear, 6 + (q - 1) * 3, 1),
    end:   new Date(fyStartCalYear, 6 + q * 3, 0), // day 0 = last day of prior month
  };
}

/**
 * Exit rate over a span of consecutive completed quarters. With the default
 * 4-quarter window this is a trailing-year rate, directly comparable to the
 * FY marks. Rate = exits ÷ mean(headcount at span start, at span end).
 */
function rollingRate_(records, fqs) {
  const first = quarterRangeCD_(fqs[0]), last = quarterRangeCD_(fqs[fqs.length - 1]);
  if (!first || !last) return { exits: 0, avgHeadcount: 0, rate: null };
  const exits = records.filter(r =>
    r.termDate && r.termDate >= first.start && r.termDate <= last.end).length;
  const avgHeadcount = (headcountOn_(records, first.start) + headcountOn_(records, last.end)) / 2;
  return { exits, avgHeadcount, rate: avgHeadcount > 0 ? exits / avgHeadcount : null };
}

// ── Cohort trend engine with the false-alarm gate ───────────────────────────
// A trigger needs BOTH marks (spec 2026-08-12 §Retention):
//   market      — rate ≥ baselineMult × company baseline for consecQuarters
//                 consecutive quarter-end windows, with ≥ minExits exits
//   historical  — above the cohort's OWN FY25 AND FY26 full-year rates
// Market-only → "noted, not alarmed". Elevated with < minExits → "watch".
// Cohort = Key Location × Department (the mock's location × dept matrix).

const RETENTION_TENURE_BUCKETS_ = [
  { label: "<1y", max: 1 }, { label: "1–2y", max: 2 }, { label: "2–3y", max: 3 },
  { label: "3–5y", max: 5 }, { label: "5y+", max: Infinity },
];

function retentionCountBy_(rows, keyFn) {
  const m = new Map();
  rows.forEach(r => { const k = keyFn(r) || "—"; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].map(([key, n]) => ({ key, n })).sort((a, b) => b.n - a.n);
}

/**
 * Evidence pack for one CONFIRMED cohort: driver, tenure distribution of the
 * leavers, leavers-vs-stayers median governing ratio, decomposition layers,
 * and the active-member list (stripped for non-exec viewers upstream).
 * @param {Array} cohortRecords all roster records of the cohort
 * @param {string[]} fqs the current rolling window
 * @param {Object} cfg CONFIG_CD-shaped (REASON_CLASS)
 * @param {function(Object):?number} ratioOf governing market ratio per record
 * @param {Date} asOf
 */
function buildRetentionEvidence_(cohortKey, cohortRecords, fqs, cfg, ratioOf, asOf) {
  const span = { start: quarterRangeCD_(fqs[0]).start, end: quarterRangeCD_(fqs[fqs.length - 1]).end };
  const leavers = cohortRecords.filter(r =>
    r.termDate && r.termDate >= span.start && r.termDate <= span.end);
  const stayers = cohortRecords.filter(r => r.active);
  const drivers = {};
  leavers.forEach(r => {
    const hit = (cfg.REASON_CLASS || []).find(c => c.re.test(String(r.termReason || "")));
    const d = hit ? hit.driver : "other";
    drivers[d] = (drivers[d] || 0) + 1;
  });
  const topDriver = Object.keys(drivers).sort((a, b) => drivers[b] - drivers[a])[0] || null;
  const tenureDist = RETENTION_TENURE_BUCKETS_.map(b => ({ label: b.label, n: 0 }));
  leavers.forEach(r => {
    const t = tenureYears_(r.hireDate, r.termDate);
    if (t == null) return;
    const i = RETENTION_TENURE_BUCKETS_.findIndex(b => t < b.max);
    tenureDist[i === -1 ? tenureDist.length - 1 : i].n++;
  });
  const med = rows => {
    const m = median_(rows.map(ratioOf).filter(v => v != null));
    return m != null ? Math.round(m * 100) / 100 : null;
  };
  return {
    cohortKey,
    driver: topDriver, drivers,
    tenureDist,
    leaversMedianRatio: med(leavers),
    stayersMedianRatio: med(stayers),
    byLevel: retentionCountBy_(leavers, r => r.level),
    byManager: retentionCountBy_(leavers, r => r.supervisor),
    people: stayers.map(r => ({
      empNo: r.empNo, name: r.name, level: r.level,
      tenureYears: tenureYears_(r.hireDate, asOf) != null
        ? Math.round(tenureYears_(r.hireDate, asOf) * 10) / 10 : null,
    })),
  };
}

/**
 * Known property (accepted, spec-mandated marks): during a fiscal Q1 the
 * rolling 4-quarter window coincides exactly with the just-closed FY, so the
 * historical mark (strictly above the cohort's OWN FY26 rate) cannot fire and
 * no cohort can read "confirmed" until the new FY's Q1 completes. The market
 * mark still works; hot cohorts read "noted" during that quarter. The gate
 * re-arms as new-FY quarters replace old ones in the window.
 * @param {Array} records full roster records (crew already excluded upstream)
 * @param {Object} ctx fiscalContextCD_ output
 * @param {Object} cfg CONFIG_CD-shaped (P2.RETENTION, REASON_CLASS)
 * @param {function(Object):?number} ratioOf governing market ratio per record
 * @returns {{baseline:Object, windowFqs:string[], cohorts:Array, evidence:Array}}
 */
function buildRetention_(records, ctx, cfg, ratioOf) {
  const R = cfg.P2.RETENTION;
  const r3 = v => v != null ? Math.round(v * 1000) / 1000 : null;
  // consecQuarters windows sliding one quarter apart, newest last.
  const fqsAll = lastCompletedQuarters_(ctx, R.windowQuarters + R.consecQuarters - 1);
  const windows = [];
  for (let i = 0; i < R.consecQuarters; i++) windows.push(fqsAll.slice(i, i + R.windowQuarters));
  const windowFqs = windows[windows.length - 1];
  const baselines = windows.map(w => rollingRate_(records, w));
  const baseline = baselines[baselines.length - 1];
  const fy26 = { start: ctx.prevFyStart, end: ctx.prevFyEnd };
  const fy25 = { start: new Date(ctx.fyStartCalYear - 2, 6, 1),
                 end:   new Date(ctx.fyStartCalYear - 1, 5, 30) };
  const cohortOf = r => (r.keyLocation || "—") + "||" + (r.dept || "—");
  const keys = [...new Set(records.map(cohortOf))];
  const evidence = [];
  const cohorts = keys.map(k => {
    const recs = records.filter(r => cohortOf(r) === k);
    const wins = windows.map(w => rollingRate_(recs, w));
    const cur = wins[wins.length - 1];
    const fy25Rate = fyAttritionBlock_(recs, fy25.start, fy25.end, null, "").rate;
    const fy26Rate = fyAttritionBlock_(recs, fy26.start, fy26.end, null, "").rate;
    const marketEach = wins.map((w, i) =>
      baselines[i].rate > 0 && w.rate != null && w.rate >= R.baselineMult * baselines[i].rate);
    const marketMark = cur.exits >= R.minExits && marketEach.every(Boolean);
    const historicalMark = cur.rate != null && cur.rate > (fy25Rate || 0) && cur.rate > (fy26Rate || 0);
    const elevated = baseline.rate > 0 && cur.rate != null &&
      cur.rate >= R.baselineMult * baseline.rate;
    let verdict = "ok";
    if (marketMark && historicalMark) verdict = "confirmed";
    else if (marketMark) verdict = "noted"; // hot vs market, normal for this cohort
    else if (elevated && cur.exits > 0) verdict = "watch"; // n<minExits or not yet consecutive
    const [keyLocation, dept] = k.split("||");
    const row = {
      key: k, keyLocation, dept,
      headcount: recs.filter(r => r.active).length,
      exits4q: cur.exits, rate4q: r3(cur.rate),
      xBaseline: (baseline.rate > 0 && cur.rate != null)
        ? Math.round(cur.rate / baseline.rate * 10) / 10 : null,
      fy25Rate: r3(fy25Rate), fy26Rate: r3(fy26Rate),
      marketMark, historicalMark, verdict,
    };
    if (verdict === "confirmed") {
      evidence.push(buildRetentionEvidence_(k, recs, windowFqs, cfg, ratioOf, ctx.asOf));
    }
    return row;
  }).filter(c => c.headcount > 0 || c.exits4q > 0)
    .sort((a, b) => {
      const rank = v => v === "confirmed" ? 0 : v === "noted" ? 1 : v === "watch" ? 2 : 3;
      return rank(a.verdict) - rank(b.verdict) || (b.rate4q || 0) - (a.rate4q || 0);
    });
  return {
    baseline: { exits: baseline.exits, rate: r3(baseline.rate) },
    windowFqs, cohorts, evidence,
  };
}
