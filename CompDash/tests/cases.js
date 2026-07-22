// ============================================================
// CompDash test cases — run via: node CompDash/tests/run_tests.js
// Uses check(desc, cond) and approx(a, b, eps) from the runner prelude.
// ============================================================

// ── Task 1: normCD_ / parseLevel_ / levelRank_ ──────────────
check("normCD_ lowercases and collapses spaces",
  normCD_("  Alex   LOPEZ ") === "alex lopez");
check("normCD_ handles null", normCD_(null) === "");

check("parseLevel_ 04.I3.1 → I3 IC",
  JSON.stringify(parseLevel_("04.I3.1")) === JSON.stringify({ level: "I3", track: "IC" }));
check("parseLevel_ 04.M10.2 → M10 M",
  JSON.stringify(parseLevel_("04.M10.2")) === JSON.stringify({ level: "M10", track: "M" }));
check("parseLevel_ lowercase token still parses",
  parseLevel_("07.m4.1").level === "M4");
check("parseLevel_ plain title → dash",
  JSON.stringify(parseLevel_("Senior Engineer")) === JSON.stringify({ level: "—", track: null }));
check("parseLevel_ empty/null → dash", parseLevel_(null).level === "—");

check("levelRank_ orders IC before M and numerically",
  levelRank_("I3") < levelRank_("I8") && levelRank_("I8") < levelRank_("M4") && levelRank_("M4") < levelRank_("M10"));
check("levelRank_ dash sorts last", levelRank_("—") > levelRank_("M10"));

check("asNum_ parses currency strings", asNum_("$1,234.50") === 1234.5);
check("asNum_ passes numbers through", asNum_(42) === 42);
check("asNum_ blank → null", asNum_("") === null && asNum_(null) === null);
check("asDate_ parses ISO strings", asDate_("2026-07-01") instanceof Date);
check("asDate_ blank → null", asDate_("") === null);
check("isoDate_ formats", isoDate_(new Date(Date.UTC(2026, 6, 21))) === "2026-07-21");

// ── Task 2: fiscalContextCD_ / fiscalMonthIdx_ ──────────────
(function () {
  const ctx = fiscalContextCD_(new Date(2026, 6, 21)); // 2026-07-21 → FY27 Q1
  check("fiscal: FY27 on 2026-07-21", ctx.fyLabel === "FY27");
  check("fiscal: prev FY26", ctx.prevFyLabel === "FY26");
  check("fiscal: Q1", ctx.qLabel === "Q1");
  check("fiscal: FY starts 2026-07-01", isoDate_(ctx.fyStart) === "2026-07-01" || (ctx.fyStart.getFullYear() === 2026 && ctx.fyStart.getMonth() === 6 && ctx.fyStart.getDate() === 1));
  check("fiscal: FY ends 2027-06-30", ctx.fyEnd.getFullYear() === 2027 && ctx.fyEnd.getMonth() === 5 && ctx.fyEnd.getDate() === 30);
  check("fiscal: prev FY range", ctx.prevFyStart.getFullYear() === 2025 && ctx.prevFyEnd.getFullYear() === 2026);
  check("fiscal: 12 month labels starting Jul 26", ctx.monthLabels.length === 12 && ctx.monthLabels[0] === "Jul 26" && ctx.monthLabels[6] === "Jan 27");
  check("fiscal: fyStartCalYear", ctx.fyStartCalYear === 2026);

  const feb = fiscalContextCD_(new Date(2027, 1, 10)); // Feb 2027 → still FY27, Q3
  check("fiscal: Feb 2027 is FY27 Q3", feb.fyLabel === "FY27" && feb.qLabel === "Q3");

  check("fiscalMonthIdx_: Jul = 0", fiscalMonthIdx_(new Date(2026, 6, 15), 2026) === 0);
  check("fiscalMonthIdx_: Dec = 5", fiscalMonthIdx_(new Date(2026, 11, 1), 2026) === 5);
  check("fiscalMonthIdx_: Jan = 6", fiscalMonthIdx_(new Date(2027, 0, 2), 2026) === 6);
  check("fiscalMonthIdx_: Jun = 11", fiscalMonthIdx_(new Date(2027, 5, 30), 2026) === 11);
  check("fiscalMonthIdx_: outside FY → -1", fiscalMonthIdx_(new Date(2026, 5, 30), 2026) === -1);
  check("fiscalMonthIdx_: null-safe", fiscalMonthIdx_(null, 2026) === -1);
})();

// ── Task 3: attrition engine ────────────────────────────────
var __seq = 0;
function mkEmp(over) {
  __seq++;
  const base = {
    empNo: "E" + __seq, name: "Emp " + __seq, email: "",
    active: true, jobTitle: "04.I3.1", level: "I3", track: "IC",
    dept: "Services", lob: "", keyLocation: "Mexico", location: "", currency: "MXN",
    hireDate: new Date(2020, 0, 1), termDate: null,
    termReason: "", termCategory: "", termRegretted: "",
    gender: null, tcc: 100000, tccUsd: null,
  };
  return Object.assign(base, over || {});
}

(function () {
  const ctx = fiscalContextCD_(new Date(2026, 6, 21)); // FY27, asOf 2026-07-21
  const records = [
    mkEmp({}),                                                        // active all along
    mkEmp({}),                                                        // active all along
    mkEmp({ dept: "R&D" }),                                           // active, other dept
    mkEmp({ active: false, termDate: new Date(2026, 6, 10),           // FY27 Jul (idx 0) voluntary regretted
            termCategory: "Voluntary", termRegretted: "Yes" }),
    mkEmp({ active: false, termDate: new Date(2027, 1, 5),            // FY27 Feb (idx 7) involuntary
            termCategory: "Involuntary", dept: "R&D" }),
    mkEmp({ active: false, termDate: new Date(2026, 2, 15),           // FY26 Mar — previous FY only
            termCategory: "Voluntary" }),
    mkEmp({ hireDate: new Date(2026, 7, 1) }),                        // hired Aug 2026 — not in FY-start headcount
  ];
  const a = buildAttrition_(records, ctx);

  check("attrition: current FY total 2", a.currentFY.total === 2);
  check("attrition: current FY vol/invol", a.currentFY.vol === 1 && a.currentFY.invol === 1);
  check("attrition: regretted count", a.currentFY.regretted === 1);
  check("attrition: Jul bucket", a.currentFY.monthly[0].terms === 1 && a.currentFY.monthly[0].vol === 1);
  check("attrition: Feb bucket", a.currentFY.monthly[7].terms === 1 && a.currentFY.monthly[7].invol === 1);
  check("attrition: Q1 rollup", a.currentFY.quarterly[0].terms === 1);
  check("attrition: Q3 rollup", a.currentFY.quarterly[2].terms === 1);
  check("attrition: previous FY total 1", a.previousFY.total === 1);
  check("attrition: labels", a.currentFY.label === "FY27" && a.previousFY.label === "FY26");

  // Headcount on 2026-07-01: E1,E2,E3 active; E4 terms Jul 10 (>Jul 1 → still active); E5 terms Feb; E6 termed Mar 2026; E7 not hired yet → 5
  // Headcount on asOf 2026-07-21: E1,E2,E3,E5 → 4 (E4 gone, E7 not hired)
  check("attrition: avg headcount 4.5", approx(a.currentFY.avgHeadcount, 4.5));
  check("attrition: rate 2/4.5", approx(a.currentFY.rate, 2 / 4.5));

  const dept = a.slices.department.find(s => s.key === "R&D");
  check("attrition slice: R&D has 1 term", dept && dept.terms === 1 && dept.invol === 1);
  check("attrition slices exist", a.slices.level.length > 0 && a.slices.keyLocation.length > 0);

  check("attrition detail: 2 rows, newest first",
    a.detail.length === 2 && a.detail[0].termDate === "2027-02-05");
  check("attrition detail: classification field", a.detail[0].cls === "invol" && a.detail[1].cls === "vol");

  check("classifyTerm_: fuzzy match", classifyTerm_("Vol - resignation") === "vol" &&
    classifyTerm_("INVOLUNTARY") === "invol" && classifyTerm_("") === "other");
})();

// ── Task 3 fix: null hireDate stays symmetric numerator/denominator ──
(function () {
  const ctx = fiscalContextCD_(new Date(2026, 6, 21));
  const recs = [
    mkEmp({}),
    mkEmp({ hireDate: null, active: false, termDate: new Date(2026, 6, 10), termCategory: "Voluntary" }),
  ];
  const a = buildAttrition_(recs, ctx);
  check("attrition: null hireDate counts in headcount (denominator symmetric)", approx(a.currentFY.avgHeadcount, 1.5));
  check("attrition: null hireDate termination still counted", a.currentFY.total === 1);
})();

// ── Task 4 (V2): buildCompaGroups_ tiered anchors / marketSuggestion_ ──
(function () {
  const bench = {
    [benchKey_("El Salvador", "03.I2.1 Data Analyst")]:
      { p25: 20000, mean: 26000, p75: 32000, currency: "USD", source: "AI scan" },
    [benchKey_("Peru", "03.I2.1 Data Analyst")]:
      { p25: 1, mean: 90000, p75: 2, currency: "PEN", source: "site" }, // currency mismatch below
  };
  const recs = [
    // Tier 1: Mexico title group of 3 → median anchor 100000
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 120000 }),
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 100000 }),
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 80000 }),
    // Tier 2: N-of-1 Data Analyst in El Salvador with a benchmark row
    mkEmp({ keyLocation: "El Salvador", jobTitle: "03.I2.1 Data Analyst",
            level: "I2", currency: "USD", tcc: 20800 }),
    // Tier 3: N-of-1 title, no benchmark, but I3 level cohort of 4 in Mexico
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.9 Special", tcc: 90000 }),
    // Tier 4: N-of-1, no benchmark, unparseable level → insufficient peers
    mkEmp({ keyLocation: "Mexico", jobTitle: "Wizard", level: "—", track: null, tcc: 70000 }),
    // Currency mismatch: PEN benchmark vs MXN employee → market tier skipped, no I2 cohort → none
    mkEmp({ keyLocation: "Peru", jobTitle: "03.I2.1 Data Analyst", level: "I2", tcc: 50000 }),
    // Missing TCC still tracked
    mkEmp({ keyLocation: "Mexico", jobTitle: "05.M4.1", level: "M4", tcc: null }),
  ];
  const groups = buildCompaGroups_(recs, bench, CONFIG_CD);

  const mx = groups.find(g => g.keyLocation === "Mexico" && g.jobTitle === "04.I3.1");
  check("compa: title tier median anchor", mx.anchor === 100000 && mx.anchorTier === "title");
  check("compa: ratio can exceed 1.0", approx(mx.members[2].ratio, 1.2));
  check("compa: members sorted ratio ASC", mx.members[0].ratio <= mx.members[1].ratio);

  const sv = groups.find(g => g.keyLocation === "El Salvador");
  check("compa: N-of-1 anchors to market mean", sv.anchorTier === "market" && sv.anchor === 26000);
  check("compa: market ratio computed", approx(sv.members[0].ratio, 0.8));
  check("compa: small group still flagged", sv.smallGroup === true);

  const lvl = groups.find(g => g.jobTitle === "04.I3.9 Special");
  // I3 cohort in Mexico = 120000/100000/80000/90000 → median 95000
  check("compa: level-cohort fallback", lvl.anchorTier === "level" && lvl.anchor === 95000);

  const wiz = groups.find(g => g.jobTitle === "Wizard");
  check("compa: dash level never borrows a cohort",
    wiz.anchorTier === "none" && wiz.insufficientPeers === true && wiz.members[0].ratio === null);

  const pe = groups.find(g => g.keyLocation === "Peru");
  check("compa: currency-mismatched benchmark skipped", pe.anchorTier === "none");

  const missing = groups.find(g => g.jobTitle === "05.M4.1");
  check("compa: missing tcc tracked, no members", missing.missingTcc === 1 && missing.count === 0);

  const s1 = marketSuggestion_(80, 100, 120);
  check("market: below p25 with both raises", s1.status === "below-p25" && approx(s1.pctToP25, 0.25) && approx(s1.pctToP50, 0.5));
  check("market: below p50", marketSuggestion_(110, 100, 120).status === "below-p50");
  check("market: at market", marketSuggestion_(130, 100, 120).status === "at-market");
  check("market: pending when no benchmark", marketSuggestion_(80, null, null).status === "pending");
})();

// ── Task 5: rri_ / buildGrowthForEmp_ ───────────────────────
(function () {
  check("rri: 21% over 2y ≈ 10%/yr", approx(rri_(2, 100, 121), 0.1, 1e-9));
  check("rri: guards return null", rri_(0, 100, 121) === null && rri_(1, 0, 5) === null && rri_(1, 100, null) === null);

  const g = buildGrowthForEmp_([
    { date: new Date(2024, 0, 1), reason: "New Hire", tcc: 100000 },
    { date: new Date(2025, 0, 1), reason: "Salary adjustment", tcc: 110000 },
    { date: new Date(2026, 0, 1), reason: "Promotion", tcc: 132000 },
  ]);
  check("growth: 3 events out", g.events.length === 3);
  check("growth: baseline event has no deltas", g.events[0].deltaAbs === null && g.events[0].annualized === null);
  check("growth: adjustment delta 10k / 10%", g.events[1].deltaAbs === 10000 && approx(g.events[1].deltaPct, 0.1, 1e-3));
  check("growth: promotion annualized ≈ 20%", approx(g.events[2].annualized, 0.2, 0.01));
  check("growth: overall annualized ≈ √1.32−1", approx(g.overallAnnualized, Math.pow(1.32, 0.5) - 1, 0.01));
  check("growth: unsorted input is sorted", buildGrowthForEmp_([
    { date: new Date(2026, 0, 1), reason: "Adj", tcc: 121000 },
    { date: new Date(2024, 0, 1), reason: "New Hire", tcc: 100000 },
  ]).events[0].reason === "New Hire");
  check("growth: empty input safe", buildGrowthForEmp_([]).overallAnnualized === null);
})();

// ── Task 6: buildEquity_ ────────────────────────────────────
(function () {
  const cfg = { EQUITY_GAP_PCT: 10, EQUITY_OUTLIER_PCT: 25, TENURE_YEARS_MIN: 3, TENURE_BELOW_PCT: 15 };
  const asOf = new Date(2026, 6, 21);
  const emps = [
    mkEmp({ keyLocation: "Mexico", level: "I3", gender: "F", tcc: 80000 }),
    mkEmp({ keyLocation: "Mexico", level: "I3", gender: "F", tcc: 82000 }),
    mkEmp({ keyLocation: "Mexico", level: "I3", gender: "M", tcc: 100000 }),
    mkEmp({ keyLocation: "Mexico", level: "I3", gender: "M", tcc: 98000 }),
    mkEmp({ keyLocation: "Mexico", level: "I3", gender: "M", tcc: 60000, hireDate: new Date(2018, 0, 1) }),
  ];
  const eq = buildEquity_(emps, cfg, asOf);
  check("equity: gender available", eq.genderAvailable === true);
  check("equity: one gender group (needs ≥2 per gender)", eq.gender.length === 1);
  // Medians: F = 81000, M = 98000 → gap = 17000/98000 ≈ 17.3% ≥ 10% → flagged
  check("equity: gap flagged at ≈17.3%", eq.gender[0].flagged === true && approx(eq.gender[0].gapPct, 17.3, 0.2));
  // Group median (all 5) = 82000 → 60000 is ≈26.8% below ≥ 25% → outlier
  check("equity: outlier flagged", eq.outliers.length === 1 && eq.outliers[0].tcc === 60000);
  // Same emp: 8.5y tenure ≥ 3 and ≥15% below median → tenure flag
  check("equity: tenure flagged", eq.tenure.length === 1 && eq.tenure[0].tenureYears > 8);

  const noG = buildEquity_([mkEmp({ gender: null })], cfg, asOf);
  check("equity: gender-pending path", noG.genderAvailable === false && noG.gender.length === 0);
})();

// ── Task 7: buildQtaInterim_ ────────────────────────────────
(function () {
  const asOf = new Date(2026, 6, 21);
  const emps = [
    mkEmp({ empNo: "Q1", name: "Alpha" }),
    mkEmp({ empNo: "Q2", name: "Beta" }),
    mkEmp({ empNo: "Q3", name: "Gamma" }),
  ];
  const hist = {
    Q1: [{ date: new Date(2026, 0, 1), reason: "Salary adjustment", tcc: 1, nextReview: new Date(2026, 5, 1) }],
    Q2: [{ date: new Date(2025, 0, 1), reason: "New Hire", tcc: 1, nextReview: new Date(2026, 3, 1) },
         { date: new Date(2026, 2, 1), reason: "Promotion", tcc: 1, nextReview: new Date(2026, 11, 1) }],
  };
  const rows = buildQtaInterim_(emps, hist, asOf);
  check("qta: overdue first", rows[0].empNo === "Q1" && rows[0].daysOverdue > 0);
  check("qta: latest event's nextReview wins", rows[1].empNo === "Q2" && rows[1].nextReview === "2026-12-01");
  check("qta: no history sorts last with null review", rows[2].empNo === "Q3" && rows[2].nextReview === null);
  check("qta: last event surfaced", rows[0].lastEventReason === "Salary adjustment");
})();

// ── V2 Task 1: CONFIG_CD additions ──────────────────────────
(function () {
  const w = CONFIG_CD.PRIORITY_W;
  check("cfg: priority weights sum to 100", w.perf + w.tenure + w.compaGap === 100);
  check("cfg: priority caps present",
    CONFIG_CD.PRIORITY_CAPS.companyYears === 10 &&
    CONFIG_CD.PRIORITY_CAPS.profileYears === 5 &&
    approx(CONFIG_CD.PRIORITY_CAPS.gapPct, 0.25));
  check("cfg: compa bands low<target<high",
    CONFIG_CD.COMPA_LOW_MIN < CONFIG_CD.COMPA_TARGET_MIN &&
    CONFIG_CD.COMPA_TARGET_MIN < CONFIG_CD.COMPA_HIGH_MAX);
  check("cfg: old band constants removed",
    CONFIG_CD.COMPA_GREEN_MIN === undefined && CONFIG_CD.COMPA_YELLOW_MIN === undefined);
  check("cfg: PROMO_RE matches promotion reasons",
    CONFIG_CD.PROMO_RE.test("Promotion") && CONFIG_CD.PROMO_RE.test("Title Change") &&
    !CONFIG_CD.PROMO_RE.test("Salary adjustment"));
  check("cfg: rating max 5", CONFIG_CD.RATING_MAX === 5);
  check("cfg: market low 0.90", approx(CONFIG_CD.MARKET_LOW, 0.90));
})();

// ── V2 Task 2: buildPerfForEmp_ ─────────────────────────────
(function () {
  const p = buildPerfForEmp_([
    { fq: "FY25Q1", rate: 4, explanation: "Exceeds" },
    { fq: "FY24Q2", rate: 3, explanation: "Meets" },
    { fq: "FY24Q4", rate: 3, explanation: "Meets" },
  ]);
  check("perf: avg rounded 2dp", approx(p.avg, 3.33, 0.005));
  check("perf: latest = newest fiscal quarter", p.latest === 4);
  check("perf: count", p.count === 3);
  check("perf: history sorted by fq asc", p.history[0].fq === "FY24Q2" && p.history[2].fq === "FY25Q1");
  check("perf: history keeps explanation", p.history[0].explanation === "Meets");

  const bad = buildPerfForEmp_([{ fq: "FY24Q1", rate: null }, { fq: "FY24Q2", rate: NaN }]);
  check("perf: non-numeric rates dropped", bad.count === 0 && bad.avg === null && bad.latest === null);
  check("perf: empty/null input safe", buildPerfForEmp_(null).count === 0);
})();

// ── V2 Task 3: profileTenureYears_ / ttmGrowth_ ─────────────
(function () {
  const asOf = new Date(2026, 6, 15); // 2026-07-15
  const hire = new Date(2020, 0, 15);
  const evs = [
    { date: new Date(2020, 0, 15), reason: "New Hire",          tcc: 50000 },
    { date: new Date(2023, 3, 15), reason: "Salary adjustment", tcc: 60000 },
    { date: new Date(2024, 6, 15), reason: "Promotion",         tcc: 75000 },
    { date: new Date(2025, 3, 15), reason: "Salary adjustment", tcc: 80000 },
  ];
  check("profileTenure: since latest promotion (2y)",
    approx(profileTenureYears_(evs, hire, asOf, CONFIG_CD.PROMO_RE), 2.0, 0.05));
  check("profileTenure: no promo → falls back to hire date",
    approx(profileTenureYears_([{ date: new Date(2022, 0, 15), reason: "Salary adjustment", tcc: 1 }],
      hire, asOf, CONFIG_CD.PROMO_RE), 6.5, 0.05));
  check("profileTenure: no promo + no hire date → null",
    profileTenureYears_([], null, asOf, CONFIG_CD.PROMO_RE) === null);

  // TTM: base = last event dated ≤ asOf − 1y = 2025-07-15 → the 2025-04 event (80000)
  check("ttm: current 88000 vs 80000 = +10%",
    approx(ttmGrowth_(evs, 88000, asOf), 0.1, 0.001));
  check("ttm: history younger than 1y → null",
    ttmGrowth_([{ date: new Date(2026, 1, 10), reason: "New Hire", tcc: 70000 }], 70000, asOf) === null);
  check("ttm: no current TCC → null", ttmGrowth_(evs, null, asOf) === null);
  check("ttm: null events safe", ttmGrowth_(null, 80000, asOf) === null);
})();

// ── V2 Task 4: benchKey_ / lookupBench_ ─────────────────────
(function () {
  const map = {
    [benchKey_("El Salvador", "Data Analyst")]:
      { p25: 20000, mean: 26000, p75: 32000, currency: "USD", source: "AI scan" },
    [benchKey_("Chile", "04.I3.1 Consultant")]:
      { p25: null, mean: null, p75: 40000000, currency: "CLP", source: "site" },
  };
  check("benchKey: normalized", benchKey_("  El  SALVADOR ", "Data  Analyst") ===
    benchKey_("El Salvador", "Data Analyst"));

  const hit = lookupBench_(map, "El Salvador", "Data Analyst", "USD");
  check("lookup: match returns row", hit.row && hit.row.mean === 26000 && !hit.mismatch);
  check("lookup: case/space tolerant", lookupBench_(map, "el salvador", "DATA ANALYST", "USD").row !== null);
  const miss = lookupBench_(map, "Mexico", "Data Analyst", "MXN");
  check("lookup: no row → null, no mismatch", miss.row === null && !miss.mismatch);
  const cur = lookupBench_(map, "El Salvador", "Data Analyst", "MXN");
  check("lookup: currency disagreement → mismatch, row withheld", cur.row === null && cur.mismatch === true);
  check("lookup: blank emp currency tolerated",
    lookupBench_(map, "El Salvador", "Data Analyst", "").row !== null);
  check("lookup: null map safe", lookupBench_(null, "X", "Y", "USD").row === null);
})();

// ── V2 Task 6: priorityScore_ ───────────────────────────────
(function () {
  // Full data: perf 4/5=0.8, tenure 0.5*min(6/10,1)+0.5*min(2/5,1)=0.5, gap (1-0.85)/0.25=0.6
  const full = priorityScore_(
    { perfAvg: 4, perfCount: 3, companyYears: 6, profileYears: 2, ratio: 0.85 }, CONFIG_CD);
  // score = (0.8*57 + 0.5*29 + 0.6*14) / 100 * 100 = 45.6+14.5+8.4 = 68.5 → 69 (Math.round)
  check("priority: weighted score", full.score === 69);
  check("priority: not partial with all components", full.partial === false && full.missing.length === 0);
  check("priority: components exposed",
    approx(full.components.perf, 0.8) && approx(full.components.tenure, 0.5) && approx(full.components.compaGap, 0.6));

  // Gap saturates at 25% below anchor; ratio above 1 → gap 0
  check("priority: gap capped at 1",
    approx(priorityScore_({ perfAvg: null, perfCount: 0, companyYears: null, profileYears: null, ratio: 0.5 },
      CONFIG_CD).components.compaGap, 1));
  check("priority: above-median ratio → zero gap",
    priorityScore_({ perfAvg: 5, perfCount: 1, companyYears: 1, profileYears: 1, ratio: 1.2 },
      CONFIG_CD).components.compaGap === 0);

  // Missing perf → weight redistributes over tenure+compaGap (29+14=43)
  const noPerf = priorityScore_(
    { perfAvg: null, perfCount: 0, companyYears: 10, profileYears: 5, ratio: 1.0 }, CONFIG_CD);
  // tenure=1, gap=0 → (1*29 + 0*14)/43*100 = 67.44 → 67
  check("priority: redistribution without perf", noPerf.score === 67 && noPerf.partial === true);
  check("priority: missing names the component", noPerf.missing.indexOf("perf") !== -1);

  // Everything missing → null score, partial
  const none = priorityScore_(
    { perfAvg: null, perfCount: 0, companyYears: null, profileYears: null, ratio: null }, CONFIG_CD);
  check("priority: all missing → null", none.score === null && none.partial === true);

  // Profile tenure null falls back to company inside the blend
  const noProf = priorityScore_(
    { perfAvg: null, perfCount: 0, companyYears: 5, profileYears: null, ratio: null }, CONFIG_CD);
  check("priority: profile falls back to company in blend",
    approx(noProf.components.tenure, 0.5 * 0.5 + 0.5 * 1));

  // Defensive: rating above scale clamps to 1
  check("priority: perf clamps at 1",
    priorityScore_({ perfAvg: 7, perfCount: 1, companyYears: null, profileYears: null, ratio: null },
      CONFIG_CD).components.perf === 1);
})();

// ── V2 Task 7: personLite_ / people-shape attrition parity ──
(function () {
  const ctx = fiscalContextCD_(new Date(2026, 6, 21)); // FY27, asOf 2026-07-21
  const records = [
    mkEmp({}),
    mkEmp({ dept: "R&D" }),
    mkEmp({ active: false, termDate: new Date(2026, 6, 10),
            termCategory: "Voluntary", termRegretted: "Yes" }),
    mkEmp({ active: false, termDate: new Date(2027, 1, 5),
            termCategory: "Involuntary", dept: "R&D" }),
    mkEmp({ active: false, termDate: new Date(2026, 2, 15), termCategory: "Voluntary" }), // prev FY
    mkEmp({ hireDate: null, active: false, termDate: new Date(2026, 7, 12), termCategory: "Voluntary" }),
  ];
  const people = records.map(personLite_);
  check("personLite: iso dates + termCls",
    people[2].termDate === "2026-07-10" && people[2].termCls === "vol" && people[2].regretted === true);
  check("personLite: active row has blank termCls", people[0].termDate === "" && people[0].termCls === "");

  const server = fyAttritionBlock_(records, ctx.fyStart, ctx.fyEnd, ctx.asOf, ctx.fyLabel);
  const client = fyAttritionFromPeople_(people, ctx.fyStartCalYear, isoDate_(ctx.asOf), ctx.fyLabel);
  check("parity: totals match", client.total === server.total && client.vol === server.vol &&
    client.invol === server.invol && client.regretted === server.regretted);
  check("parity: rate matches", approx(client.rate, server.rate));
  check("parity: monthly buckets match",
    JSON.stringify(client.monthly) === JSON.stringify(server.monthly));
  check("parity: quarterly buckets match",
    JSON.stringify(client.quarterly) === JSON.stringify(server.quarterly));

  const prevServer = fyAttritionBlock_(records, ctx.prevFyStart, ctx.prevFyEnd, null, ctx.prevFyLabel);
  const prevClient = fyAttritionFromPeople_(people, ctx.fyStartCalYear - 1, null, ctx.prevFyLabel);
  check("parity: previous FY (no asOf cut)", prevClient.total === prevServer.total &&
    approx(prevClient.rate, prevServer.rate));

  const end = ctx.asOf < ctx.fyEnd ? ctx.asOf : ctx.fyEnd;
  const sSlice = sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.dept);
  const cSlice = sliceAttritionFromPeople_(people, ctx.fyStartCalYear, isoDate_(ctx.asOf), p => p.dept);
  check("parity: dept slice keys+terms match",
    JSON.stringify(cSlice.map(s => [s.key, s.terms, s.headcount])) ===
    JSON.stringify(sSlice.map(s => [s.key, s.terms, s.headcount])));
})();
