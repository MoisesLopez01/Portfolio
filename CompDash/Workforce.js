// ============================================================
// SCRIPT NAME: Comp Health Report — Workforce engine
// PURPOSE:     Population flow — attrition, movement, managers,
//              financial impact, forecast.
//
// PURE. Same contract as Position.js.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.workforce = 49;

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
    // Prior FY cut at the same calendar point — the like-for-like basis for
    // "vs last year" trend arrows (a full prior FY vs a part-year FY misleads).
    previousFYSamePeriod: fyAttritionBlock_(records, ctx.prevFyStart, ctx.prevFyEnd,
      new Date(ctx.asOf.getFullYear() - 1, ctx.asOf.getMonth(), ctx.asOf.getDate()),
      ctx.prevFyLabel + " YTD"),
    slices: {
      department:  sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.dept),
      level:       sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.level)
                     .sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
      keyLocation: sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.keyLocation),
    },
    detail,
  };
}

// ── People projection + string-date attrition (client-mirrored) ────────────
// The client recomputes attrition for FILTERED populations from a compact
// people[] payload. These functions compare ISO date STRINGS only
// (YYYY-MM-DD is lexicographically ordered) so ViewDash.html carries
// byte-identical copies — see "MIRROR" comments there; keep in sync.

function personLite_(r) {
  return {
    empNo: r.empNo, name: r.name, dept: r.dept, level: r.level,
    keyLocation: r.keyLocation,
    hireDate: isoDate_(r.hireDate), termDate: isoDate_(r.termDate),
    termCls: r.termDate ? classifyTerm_(r.termCategory) : "",
    regretted: /yes|true/i.test(String(r.termRegretted || "")),
  };
}

// MIRROR of this function lives in ViewDash.html — change both together.
function fyAttritionFromPeople_(people, fyStartCalYear, asOfIso, label) {
  const fyStartIso = fyStartCalYear + "-07-01";
  const fyEndIso = (fyStartCalYear + 1) + "-06-30";
  const endIso = (asOfIso && asOfIso < fyEndIso) ? asOfIso : fyEndIso;
  const idxOf = iso => (+iso.slice(0, 4) - fyStartCalYear) * 12 + (+iso.slice(5, 7) - 1) - 6;
  const hcOn = iso => people.filter(p =>
    (!p.hireDate || p.hireDate <= iso) && (!p.termDate || p.termDate > iso)).length;
  const monthly = Array.from({ length: 12 }, () => ({ terms: 0, vol: 0, invol: 0 }));
  const terms = people.filter(p => p.termDate && p.termDate >= fyStartIso && p.termDate <= fyEndIso);
  terms.forEach(p => {
    const i = idxOf(p.termDate);
    if (i < 0 || i > 11) return;
    monthly[i].terms++;
    if (p.termCls === "vol") monthly[i].vol++;
    else if (p.termCls === "invol") monthly[i].invol++;
  });
  const quarterly = [0, 1, 2, 3].map(q => {
    const s = monthly.slice(q * 3, q * 3 + 3);
    return { terms: s.reduce((t, x) => t + x.terms, 0),
             vol:   s.reduce((t, x) => t + x.vol, 0),
             invol: s.reduce((t, x) => t + x.invol, 0) };
  });
  const vol = terms.filter(p => p.termCls === "vol").length;
  const invol = terms.filter(p => p.termCls === "invol").length;
  const regretted = terms.filter(p => p.regretted).length;
  const avgHeadcount = (hcOn(fyStartIso) + hcOn(endIso)) / 2;
  return { label, monthly, quarterly, total: terms.length, vol, invol, regretted,
           avgHeadcount, rate: avgHeadcount > 0 ? terms.length / avgHeadcount : null };
}

// MIRROR of this function lives in ViewDash.html — change both together.
function sliceAttritionFromPeople_(people, fyStartCalYear, asOfIso, keyFn) {
  const fyStartIso = fyStartCalYear + "-07-01";
  const fyEndIso = (fyStartCalYear + 1) + "-06-30";
  const endIso = (asOfIso && asOfIso < fyEndIso) ? asOfIso : fyEndIso;
  const groups = new Map();
  const get = k => {
    if (!groups.has(k)) groups.set(k, { key: k, terms: 0, vol: 0, invol: 0, hcStart: 0, hcEnd: 0 });
    return groups.get(k);
  };
  people.forEach(p => {
    const g = get(keyFn(p) || "—");
    if ((!p.hireDate || p.hireDate <= fyStartIso) && (!p.termDate || p.termDate > fyStartIso)) g.hcStart++;
    if ((!p.hireDate || p.hireDate <= endIso) && (!p.termDate || p.termDate > endIso)) g.hcEnd++;
    if (p.termDate && p.termDate >= fyStartIso && p.termDate <= fyEndIso) {
      g.terms++;
      if (p.termCls === "vol") g.vol++;
      else if (p.termCls === "invol") g.invol++;
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

// ── Managers engine (V3) ────────────────────────────────────────────────────
// Attrition by supervisor — the "manager-quality vs department-wide" lens.
// Team = everyone whose Supervisor equals the manager's name; rate uses the
// same FY framing as fyAttritionBlock_ (exits ÷ mean team headcount).
// Managers with < cfg.MGR_MIN_REPORTS active reports pool into one row
// (sample-size rule). Verdict lines about this data carry counts only.

function buildManagers_(records, ctx, cfg) {
  const bySup = new Map();
  records.forEach(r => {
    const s = String(r.supervisor || "").trim();
    if (!s) return;
    if (!bySup.has(s)) bySup.set(s, []);
    bySup.get(s).push(r);
  });
  if (!bySup.size) return { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };

  const end = (ctx.asOf < ctx.fyEnd) ? ctx.asOf : ctx.fyEnd;
  const mkRow = (name, team) => {
    const active = team.filter(r => r.active);
    const exits = team.filter(r => r.termDate && r.termDate >= ctx.fyStart && r.termDate <= ctx.fyEnd);
    const avg = (headcountOn_(team, ctx.fyStart) + headcountOn_(team, end)) / 2;
    const deptCounts = {};
    active.forEach(r => { const d = r.dept || "—"; deptCounts[d] = (deptCounts[d] || 0) + 1; });
    const dept = Object.keys(deptCounts).sort((a, b) => deptCounts[b] - deptCounts[a])[0] || "—";
    return {
      name, teamSize: active.length, exitsFY: exits.length,
      voluntaryExits: exits.filter(r => classifyTerm_(r.termCategory) === "vol").length,
      attritionRate: avg > 0 ? exits.length / avg : null,
      dept,
    };
  };

  const rows = [];
  const smallTeams = [];
  bySup.forEach((team, name) => {
    const row = mkRow(name, team);
    if (row.teamSize >= cfg.MGR_MIN_REPORTS) rows.push(row);
    else if (row.teamSize > 0 || row.exitsFY > 0) smallTeams.push(team);
  });
  rows.sort((a, b) =>
    (b.attritionRate || 0) - (a.attritionRate || 0) || b.exitsFY - a.exitsFY ||
    a.name.localeCompare(b.name));

  let pooledSmallTeams = null;
  if (smallTeams.length) {
    const flat = [].concat.apply([], smallTeams);
    pooledSmallTeams = Object.assign(
      mkRow("Small teams (<" + cfg.MGR_MIN_REPORTS + " reports)", flat),
      { pooledManagers: smallTeams.length });
  }

  // Span of control: managers = ACTIVE employees who supervise ≥1 active report.
  const activeNames = new Set(records.filter(r => r.active).map(r => normCD_(r.name)));
  const activeSups = new Set();
  records.filter(r => r.active && r.supervisor).forEach(r => {
    const k = normCD_(r.supervisor);
    if (activeNames.has(k)) activeSups.add(k);
  });
  const managers = activeSups.size;
  const activeCount = records.filter(r => r.active).length;
  const ics = activeCount - managers;
  return {
    available: true, rows, pooledSmallTeams,
    spanOfControl: {
      managers, ics,
      ratio: managers > 0 ? Math.round(ics / managers * 10) / 10 : null,
      target: cfg.RAG.spanTarget,
    },
  };
}

// ── Financial impact of FY exits (V3) ───────────────────────────────────────
// Payroll released this FY by leavers: TCC USD ÷ 12 × full months remaining
// in the FY after the exit month. Rows without TCC USD are skipped and
// reported via coverage — never zero-filled (coverage-counter pattern).
// Field name annualPayrollReleasedUsd is the spec contract; the value is the
// FY-prorated release, not a flat annual sum.

function buildFinancialImpact_(records, ctx) {
  const leavers = records.filter(r =>
    r.termDate && r.termDate >= ctx.fyStart && r.termDate <= ctx.fyEnd);
  let counted = 0, released = 0, regretted = 0;
  leavers.forEach(r => {
    const idx = fiscalMonthIdx_(r.termDate, ctx.fyStartCalYear);
    if (idx === -1 || !(r.tccUsd > 0)) return;
    const amt = r.tccUsd / 12 * (11 - idx);
    counted++;
    released += amt;
    if (/yes|true/i.test(String(r.termRegretted || ""))) regretted += amt;
  });
  return {
    annualPayrollReleasedUsd: Math.round(released),
    regrettedPortionUsd: Math.round(regretted),
    coverage: { counted, total: leavers.length },
  };
}

// ── Attrition forecast (V3) ─────────────────────────────────────────────────
// Trend × prior-FY seasonality, ported (reduced) from termination-analysis
// applyForecasting: baseline = actual FY exits ÷ actual months; each future
// month scales the baseline by the prior FY's share of that fiscal month.
// Returns null with < cfg.FORECAST_MIN_MONTHS actual months (too little
// signal) or when the FY is complete (nothing left to forecast).

function buildForecast_(currentFY, previousFY, ctx, cfg) {
  const actualMonths = fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear) + 1;
  if (actualMonths < cfg.FORECAST_MIN_MONTHS || actualMonths >= 12) return null;
  const actualTerms = currentFY.monthly.slice(0, actualMonths).reduce((t, m) => t + m.terms, 0);
  const baseline = actualTerms / actualMonths;
  const prevTotal = previousFY.monthly.reduce((t, m) => t + m.terms, 0);
  const months = currentFY.monthly.map((m, i) => {
    if (i < actualMonths) return { idx: i, terms: m.terms, forecast: false };
    const seasonal = prevTotal > 0 ? previousFY.monthly[i].terms / (prevTotal / 12) : 1;
    return { idx: i, terms: Math.round(baseline * seasonal * 10) / 10, forecast: true };
  });
  const projectedTotal = months.reduce((t, m) => t + m.terms, 0);
  return {
    months,
    projectedTotal: Math.round(projectedTotal * 10) / 10,
    annualizedRate: currentFY.avgHeadcount > 0
      ? Math.round(projectedTotal / currentFY.avgHeadcount * 1000) / 1000 : null,
    method: "trend × prior-FY seasonality (" + actualMonths + " actual months)",
  };
}

