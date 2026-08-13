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

// ── TCC AGR: tagRate_ / TAG pass-through ────────────────────
(function () {
  check("tag: percent-formatted cell arrives as fraction, kept", approx(tagRate_(0.0127), 0.0127, 1e-9));
  check("tag: '1.27%' string → 0.0127", approx(tagRate_("1.27%"), 0.0127, 1e-9));
  check("tag: '45.00%' string → 0.45", approx(tagRate_("45.00%"), 0.45, 1e-9));
  check("tag: bare numeric string treated as fraction", approx(tagRate_("0.45"), 0.45, 1e-9));
  check("tag: blank/null/garbage → null",
    tagRate_("") === null && tagRate_(null) === null && tagRate_("n/a") === null);

  const g = buildGrowthForEmp_([
    { date: new Date(2024, 0, 15), reason: "New Hire", tcc: 100000, tag: null },
    { date: new Date(2025, 0, 15), reason: "Salary adjustment", tcc: 110000, tag: 0.0127 },
    { date: new Date(2026, 0, 15), reason: "Promotion", tcc: 132000 }, // TAG column absent
  ]);
  check("tag: passes through to event rows", approx(g.events[1].tag, 0.0127, 1e-9));
  check("tag: missing/absent tag stays null", g.events[0].tag === null && g.events[2].tag === null);
})();

// ── Internal Transfer resets in-role tenure ─────────────────
(function () {
  const asOf = new Date(2026, 6, 15);
  const hire = new Date(2020, 0, 15);
  check("cfg: PROMO_RE matches Internal Transfer",
    CONFIG_CD.PROMO_RE.test("Internal Transfer") && !CONFIG_CD.PROMO_RE.test("Salary adjustment"));
  check("profileTenure: internal transfer resets the in-role clock",
    approx(profileTenureYears_(
      [{ date: new Date(2025, 6, 15), reason: "Internal Transfer", tcc: 1 }],
      hire, asOf, CONFIG_CD.PROMO_RE), 1.0, 0.05));
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

// ── V3 Task 1: RAG config + ragBand_ ────────────────────────
check("CONFIG_CD.RAG exists with all V3 threshold groups",
  !!(CONFIG_CD.RAG && CONFIG_CD.RAG.attritionTotal && CONFIG_CD.RAG.attritionVol &&
     CONFIG_CD.RAG.regrettedShare && CONFIG_CD.RAG.peerVolBand &&
     CONFIG_CD.RAG.floorHeads === 10 && CONFIG_CD.RAG.floorExits === 3 &&
     CONFIG_CD.RAG.spanTarget === 6));
check("CONFIG_CD.MGR_MIN_REPORTS is 3", CONFIG_CD.MGR_MIN_REPORTS === 3);
check("CONFIG_CD.FORECAST_MIN_MONTHS is 6", CONFIG_CD.FORECAST_MIN_MONTHS === 6);
check("CONFIG_CD.REASON_CLASS classifies 'Another Job' as labor-market/comp",
  CONFIG_CD.REASON_CLASS.find(rc => rc.re.test("Another Job")).driver === "labor-market/comp");
check("CONFIG_CD.REASON_CLASS classifies 'Job Position Eliminated or Changed' as role-design/structural",
  CONFIG_CD.REASON_CLASS.find(rc => rc.re.test("Job Position Eliminated or Changed")).driver === "role-design/structural");
check("CONFIG_CD.GLOSSARY has entries and BENCH_SOURCES cited",
  CONFIG_CD.GLOSSARY.length >= 8 && CONFIG_CD.BENCH_SOURCES.length >= 4);

check("ragBand_ green at/below green bound", ragBand_(0.13, { green: 0.13, yellow: 0.18 }) === "green");
check("ragBand_ yellow between bounds", ragBand_(0.15, { green: 0.13, yellow: 0.18 }) === "yellow");
check("ragBand_ red above yellow bound", ragBand_(0.19, { green: 0.13, yellow: 0.18 }) === "red");
check("ragBand_ null-safe", ragBand_(null, { green: 0.13, yellow: 0.18 }) === null);

// ── V3 Task 3: buildManagers_ ───────────────────────────────
function mkV3(over) {
  return Object.assign({
    empNo: "X" + Math.random().toString(36).slice(2, 8), name: "P " + Math.random().toString(36).slice(2, 6),
    active: true, dept: "Services", level: "I3", keyLocation: "Malaysia",
    hireDate: new Date(2022, 0, 15), termDate: null, termCategory: "", termReason: "",
    termRegretted: "", supervisor: "", tcc: 100000, tccUsd: 50000, ratio: null,
  }, over || {});
}
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27, asOf 2027-02-15
  const recs = [];
  // Manager A: 4 active + 2 FY27 exits (1 vol, 1 invol)
  for (let i = 0; i < 4; i++) recs.push(mkV3({ supervisor: "Mgr A" }));
  recs.push(mkV3({ supervisor: "Mgr A", active: false, termDate: new Date(2026, 8, 10), termCategory: "Voluntary" }));
  recs.push(mkV3({ supervisor: "Mgr A", active: false, termDate: new Date(2026, 10, 3), termCategory: "Involuntary" }));
  // Manager B: 5 active, no exits
  for (let i = 0; i < 5; i++) recs.push(mkV3({ supervisor: "Mgr B", dept: "R&D" }));
  // Manager C: 2 active (below MGR_MIN_REPORTS → pooled)
  for (let i = 0; i < 2; i++) recs.push(mkV3({ supervisor: "Mgr C" }));
  // Managers themselves as active employees (so span-of-control can count them)
  ["Mgr A", "Mgr B", "Mgr C"].forEach(n => recs.push(mkV3({ name: n, supervisor: "Mgr Top" })));
  recs.push(mkV3({ name: "Mgr Top" }));

  const m = buildManagers_(recs, ctx, CONFIG_CD);
  check("managers: available", m.available === true);
  const a = m.rows.find(r => r.name === "Mgr A");
  check("managers: Mgr A team of 4 active, 2 FY exits, 1 voluntary",
    a && a.teamSize === 4 && a.exitsFY === 2 && a.voluntaryExits === 1);
  // Mgr A team: hc(fyStart 2026-07-01)=6 (all hired 2022, exits Sep/Nov), hc(asOf)=4 → avg 5 → rate 2/5
  check("managers: Mgr A rate = exits ÷ avg team headcount", approx(a.attritionRate, 0.4));
  check("managers: worst-first sort (Mgr A before Mgr B)",
    m.rows.indexOf(a) < m.rows.indexOf(m.rows.find(r => r.name === "Mgr B")));
  check("managers: Mgr C pooled, not a row",
    !m.rows.find(r => r.name === "Mgr C") && m.pooledSmallTeams && m.pooledSmallTeams.pooledManagers === 1 &&
    m.pooledSmallTeams.teamSize === 2);
  // span: active sups who are themselves active employees = Mgr A/B/C/Top = 4 managers
  check("managers: span counts 4 managers", m.spanOfControl.managers === 4);
  check("managers: span ics = active − managers",
    m.spanOfControl.ics === recs.filter(r => r.active).length - 4);
  check("managers: span target echoed from cfg", m.spanOfControl.target === CONFIG_CD.RAG.spanTarget);

  const none = buildManagers_(recs.map(r => Object.assign({}, r, { supervisor: "" })), ctx, CONFIG_CD);
  check("managers: no supervisor values → available:false", none.available === false);
})();

// ── V3 Task 4: buildFinancialImpact_ ────────────────────────
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27
  const recs = [
    // Exit in Sep 2026 = fiscal month idx 2 → 9 months remaining → 120000/12*9 = 90000
    mkV3({ active: false, termDate: new Date(2026, 8, 10), termCategory: "Voluntary",
           termRegretted: "Yes", tccUsd: 120000 }),
    // Exit in Jul 2026 = idx 0 → 11 months → 60000/12*11 = 55000 (not regretted)
    mkV3({ active: false, termDate: new Date(2026, 6, 20), termCategory: "Involuntary", tccUsd: 60000 }),
    // Exit with NO TCC USD → skipped, counted in coverage.total only
    mkV3({ active: false, termDate: new Date(2026, 9, 1), termCategory: "Voluntary", tccUsd: null }),
    // Prior-FY exit → outside window entirely
    mkV3({ active: false, termDate: new Date(2025, 8, 1), tccUsd: 999999 }),
    mkV3({}), // active — ignored
  ];
  const fi = buildFinancialImpact_(recs, ctx);
  check("financial: released = 90000 + 55000", fi.annualPayrollReleasedUsd === 145000);
  check("financial: regretted portion = 90000", fi.regrettedPortionUsd === 90000);
  check("financial: coverage 2 of 3 FY leavers", fi.coverage.counted === 2 && fi.coverage.total === 3);
})();

// ── V3 Task 5: buildForecast_ + previousFYSamePeriod ────────
(function () {
  const ctx = fiscalContextCD_(new Date(2027, 1, 15)); // FY27, fiscalMonthIdx = 7 → 8 actual months
  const mkFY = terms => ({
    monthly: terms.map(t => ({ terms: t, vol: 0, invol: 0 })),
    avgHeadcount: 100, total: terms.reduce((a, b) => a + b, 0),
  });
  // 8 actual months, 8 exits → baseline 1/mo; prev FY flat 1/mo → seasonal 1 everywhere
  const cur = mkFY([1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
  const prev = mkFY([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  const fc = buildForecast_(cur, prev, ctx, CONFIG_CD);
  check("forecast: exists with 8 actual months", fc != null);
  check("forecast: 12 months, first 8 actual, last 4 forecast",
    fc.months.length === 12 && fc.months[7].forecast === false && fc.months[8].forecast === true);
  check("forecast: flat seasonality projects baseline (1/mo)", approx(fc.months[8].terms, 1));
  check("forecast: projected total 12, annualized 12%", approx(fc.projectedTotal, 12) && approx(fc.annualizedRate, 0.12));

  // Guard: asOf in Oct (idx 3) → 4 actual months < 6 → null
  const early = fiscalContextCD_(new Date(2026, 9, 15));
  check("forecast: <6 actual months → null", buildForecast_(cur, prev, early, CONFIG_CD) === null);

  // Seasonality: prev FY concentrated in Dec (idx 5) → future Dec-equivalent months scale up
  const seasonalPrev = mkFY([0, 0, 0, 0, 0, 12, 0, 0, 0, 0, 0, 0]);
  const fc2 = buildForecast_(cur, seasonalPrev, ctx, CONFIG_CD);
  check("forecast: zero-seasonality future month projects 0", approx(fc2.months[8].terms, 0));

  // previousFYSamePeriod lands on the attrition payload
  const recs = [mkV3({}), mkV3({}), mkV3({ active: false, termDate: new Date(2025, 8, 5), termCategory: "Voluntary" })];
  const attr = buildAttrition_(recs, ctx);
  check("attrition: previousFYSamePeriod block present with a rate",
    attr.previousFYSamePeriod && attr.previousFYSamePeriod.rate != null);
})();

// ── Verdict retarget fixtures (Task 7) ──────────────────────────────────────
// Shared by the V3 Task 6 checks below AND by the "no verdict targets a
// deleted view" check further down (find them, reuse them — do not invent a
// second fixture, or it will drift from this one). The extra signals-bearing
// employee at the end of VERDICT_MODEL_.employees exists solely so every
// signals-gated verdict (promo-stale, recognition-risk, retention-core,
// invisible-contrib) actually fires alongside equity — otherwise the retarget
// test could pass without ever exercising most of the retargeted verdicts.
const VERDICT_CFG_ = CONFIG_CD;
const VERDICT_MODEL_ = (function () {
  const mkFY = (terms, vol, regretted, hc) => ({
    monthly: [], quarterly: [], total: terms, vol, invol: terms - vol,
    regretted, avgHeadcount: hc, rate: hc > 0 ? terms / hc : null, label: "FY27",
  });
  return {
    fyLabel: "FY27", prevFyLabel: "FY26", activeCount: 200, hcFyStart: 205,
    attrition: {
      currentFY: mkFY(40, 30, 15, 200),          // 20% total → red; 15% vol → yellow; 50% regretted → red
      previousFY: mkFY(30, 22, 8, 200),
      previousFYSamePeriod: mkFY(20, 15, 6, 200),
      slices: { department: [
        { key: "Services", terms: 25, vol: 20, invol: 5, headcount: 100, rate: 0.25 },
        { key: "Sales", terms: 10, vol: 7, invol: 3, headcount: 40, rate: 0.25 },
        { key: "R&D", terms: 5, vol: 3, invol: 2, headcount: 60, rate: 0.08 },
      ], level: [], keyLocation: [] },
      detail: [
        { reason: "Another Job", cls: "vol" }, { reason: "Another Job", cls: "vol" },
        { reason: "Another Job", cls: "vol" }, { reason: "Job Position Eliminated or Changed", cls: "invol" },
        { reason: "Personal Reasons", cls: "vol" },
      ],
      financialImpact: { annualPayrollReleasedUsd: 500000, regrettedPortionUsd: 200000,
                         coverage: { counted: 38, total: 40 } },
      forecast: { projectedTotal: 55, annualizedRate: 0.275, method: "trend × prior-FY seasonality (8 actual months)", months: [] },
    },
    managers: { available: true, rows: [
      { name: "A", teamSize: 6, exitsFY: 3, voluntaryExits: 3, attritionRate: 0.42, dept: "Services" },
      { name: "B", teamSize: 9, exitsFY: 3, voluntaryExits: 2, attritionRate: 0.31, dept: "Sales" },
      { name: "C", teamSize: 7, exitsFY: 1, voluntaryExits: 1, attritionRate: 0.14, dept: "Services" },
    ], pooledSmallTeams: null, spanOfControl: { managers: 40, ics: 160, ratio: 4.0, target: 6 } },
    employees: [
      { ratio: 0.75 }, { ratio: 0.9 }, { ratio: 1.0 }, { ratio: null },
      { signals: { everPromoted: true, promoStale: false, earlyCareer: false, coreLevel: false,
                   recognitionRisk: false, retentionRisk: false, invisibleContributor: true, riskFactors: [] } },
    ],
    equity: { genderAvailable: true, gender: [{ flagged: true }, { flagged: false }], outliers: [{}, {}], tenure: [{}] },
  };
})();

// ── V3 Task 6: buildVerdicts_ ───────────────────────────────
(function () {
  const cfg = VERDICT_CFG_;
  const model = VERDICT_MODEL_;
  const mkFY = (terms, vol, regretted, hc) => ({
    monthly: [], quarterly: [], total: terms, vol, invol: terms - vol,
    regretted, avgHeadcount: hc, rate: hc > 0 ? terms / hc : null, label: "FY27",
  });
  const vs = buildVerdicts_(model, cfg);
  const byId = {};
  vs.forEach(v => { byId[v.id] = v; });

  check("verdicts: every verdict has fact + soWhat + view + severity",
    vs.length >= 10 && vs.every(v => v.fact && v.soWhat && v.view &&
      ["FACT", "NOTE", "RISK"].indexOf(v.severity) !== -1));
  check("verdicts: attr-total red → RISK with action",
    byId["attr-total"].severity === "RISK" && byId["attr-total"].action.length > 0);
  check("verdicts: regretted 50% of voluntary → RISK", byId["regretted"].severity === "RISK");
  check("verdicts: concentration names top-2 depts with counts",
    /Services/.test(byId["concentration"].fact) && /Sales/.test(byId["concentration"].fact) &&
    /35 of 40/.test(byId["concentration"].fact));
  check("verdicts: mgr-hotspots counts only, no manager names",
    /2/.test(byId["mgr-hotspots"].fact) && byId["mgr-hotspots"].fact.indexOf("A") !== 0 &&
    !/\bB\b/.test(byId["mgr-hotspots"].fact));
  check("verdicts: manager verdicts deep-link to the Workforce & Attrition view (managers tab retired)",
    byId["mgr-hotspots"].view === "attrition" && byId["span"].view === "attrition");
  // JS stringifies the numeric ratio 4.0 as "4" — accept either rendering.
  // 4.0 sits exactly ON spanNarrow, so it is not flagged narrow and not RISK.
  check("verdicts: span states ratio, managers, ICs and target",
    /1:4(\.0)?\b/.test(byId["span"].fact) && /40 managers/.test(byId["span"].fact) &&
    /1:6 target/.test(byId["span"].fact) && byId["span"].severity === "NOTE");
  check("verdicts: span below spanNarrow reads narrow",
    /narrow/i.test(buildVerdicts_(Object.assign({}, model, { managers: Object.assign({}, model.managers,
      { spanOfControl: { managers: 60, ics: 140, ratio: 2.3, target: 6 } }) }), cfg)
      .find(v => v.id === "span").soWhat));
  check("verdicts: span above spanWide reads RISK",
    buildVerdicts_(Object.assign({}, model, { managers: Object.assign({}, model.managers,
      { spanOfControl: { managers: 10, ics: 190, ratio: 19, target: 6 } }) }), cfg)
      .find(v => v.id === "span").severity === "RISK");
  check("verdicts: compa-below counts ratios under the low band", /1 /.test(byId["compa-below"].fact));
  check("verdicts: trends-drivers names Another Job and classifies labor-market/comp",
    /Another Job/.test(byId["trends-drivers"].fact) && /labor-market\/comp/.test(byId["trends-drivers"].soWhat));
  check("verdicts: financial includes released $ and coverage caveat",
    /500,000/.test(byId["financial"].fact) && /38 of 40/.test(byId["financial"].caveat));
  check("verdicts: forecast projects", /55/.test(byId["forecast"].fact));
  check("verdicts: deterministic — same input, same strings",
    JSON.stringify(buildVerdicts_(model, cfg)) === JSON.stringify(vs));

  // Sample-size guard: 2 exits on 200 heads → severity capped at NOTE + caveat
  const small = JSON.parse(JSON.stringify(model));
  small.attrition.currentFY = mkFY(2, 2, 2, 200); // 100% regretted but only 2 exits
  small.attrition.forecast = null;
  const vs2 = buildVerdicts_(small, cfg);
  const reg2 = vs2.find(v => v.id === "regretted");
  check("verdicts: sample guard caps regretted at NOTE with caveat",
    reg2.severity === "NOTE" && /too few/i.test(reg2.caveat));
  check("verdicts: missing forecast block → no forecast verdict",
    !vs2.find(v => v.id === "forecast"));
  const noMgr = JSON.parse(JSON.stringify(model));
  noMgr.managers = { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };
  check("verdicts: managers unavailable → no mgr-hotspots / span verdicts",
    !buildVerdicts_(noMgr, cfg).find(v => v.id === "mgr-hotspots" || v.id === "span"));
})();

// ── V4: SI window (lastCompletedQuarters_ + windowed buildPerfForEmp_) ──────
(function () {
  const ctxQ1 = fiscalContextCD_(new Date(2026, 6, 28));  // FY27 Q1 in progress
  check("lastCompletedQuarters_: FY27Q1 → the four FY26 quarters, oldest first",
    JSON.stringify(lastCompletedQuarters_(ctxQ1, 4)) ===
    JSON.stringify(["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"]));
  const ctxQ3 = fiscalContextCD_(new Date(2026, 0, 15)); // FY26 Q3 in progress
  check("lastCompletedQuarters_: FY26Q3 → crosses the FY boundary",
    JSON.stringify(lastCompletedQuarters_(ctxQ3, 4)) ===
    JSON.stringify(["FY25Q3", "FY25Q4", "FY26Q1", "FY26Q2"]));
  check("lastCompletedQuarters_: n=2 keeps only the two most recent",
    JSON.stringify(lastCompletedQuarters_(ctxQ1, 2)) === JSON.stringify(["FY26Q3", "FY26Q4"]));

  const rows = [
    { fq: "FY25Q2", rate: 2 }, { fq: "FY26Q1", rate: 4 },
    { fq: "FY26Q3", rate: 5 }, { fq: "FY26Q4", rate: 3 },
  ];
  const win = lastCompletedQuarters_(ctxQ1, 4);
  const p = buildPerfForEmp_(rows, win);
  check("perf window: avg over in-window ratings only", approx(p.avg, 4));
  check("perf window: count windowed, totalCount full", p.count === 3 && p.totalCount === 4);
  check("perf window: windowLatest = most recent in-window rating", p.windowLatest === 3);
  check("perf window: latest stays the overall latest", p.latest === 3);
  check("perf window: full history preserved", p.history.length === 4);
  const stale = buildPerfForEmp_([{ fq: "FY24Q1", rate: 5 }], win);
  check("perf window: no in-window ratings → avg null, never a stale all-time avg",
    stale.avg === null && stale.count === 0 && stale.totalCount === 1 && stale.latest === 5);
  const legacy = buildPerfForEmp_(rows);
  check("perf window: omitted window keeps legacy all-history average", approx(legacy.avg, 3.5));
})();

// ── V4: decision signals (buildSignalsForEmp_) ──────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  const base = { level: "I3", ratio: 1.0, marketRatio: 1.0, ttmGrowthPct: 0.08,
                 profileYears: 1, everPromoted: true, windowLatest: 4 };
  const mk = o => buildSignalsForEmp_(Object.assign({}, base, o), cfg);

  check("signals: clean profile carries no flags", (function () {
    const s = mk({});
    return !s.promoStale && !s.recognitionRisk && !s.retentionRisk && s.riskFactors.length === 0;
  })());
  check("signals: promoStale at exactly the threshold", mk({ profileYears: 3 }).promoStale);
  check("signals: profileYears null never stale", !mk({ profileYears: null }).promoStale);
  check("signals: earlyCareer matches I1–I3, not I4/M5", (function () {
    return mk({ level: "I2" }).earlyCareer && mk({ level: "I3" }).earlyCareer &&
           !mk({ level: "I4" }).earlyCareer && !mk({ level: "M5" }).earlyCareer;
  })());
  check("signals: coreLevel matches I3/I4 only",
    mk({ level: "I4" }).coreLevel && !mk({ level: "I5" }).coreLevel && !mk({ level: "M4" }).coreLevel);
  check("signals: recognition risk = excellent latest quarter + sub-5% TTM",
    mk({ windowLatest: 4.5, ttmGrowthPct: 0.03 }).recognitionRisk);
  check("signals: recognition risk never fires on null TTM (history < 1y)",
    !mk({ windowLatest: 5, ttmGrowthPct: null }).recognitionRisk);
  check("signals: recognition risk never fires on a 4.0 rating",
    !mk({ windowLatest: 4, ttmGrowthPct: 0 }).recognitionRisk);
  check("signals: retention risk needs coreLevel AND 2+ factors", (function () {
    const risky = mk({ level: "I3", ratio: 0.9, marketRatio: 0.85 });   // 2 factors
    const oneFactor = mk({ level: "I3", ratio: 0.9 });                  // 1 factor
    const notCore = mk({ level: "I6", ratio: 0.9, marketRatio: 0.85 }); // 2 factors, wrong level
    return risky.retentionRisk && risky.riskFactors.length === 2 &&
           !oneFactor.retentionRisk && !notCore.retentionRisk;
  })());
  check("signals: factors are named for the UI chips", (function () {
    const s = mk({ level: "I3", ratio: 0.9, marketRatio: 0.85, profileYears: 4,
                   windowLatest: 5, ttmGrowthPct: 0.02 });
    return s.riskFactors.indexOf("below internal anchor") !== -1 &&
           s.riskFactors.indexOf("below market") !== -1 &&
           s.riskFactors.some(f => /promotion stale 4y/.test(f)) &&
           s.riskFactors.indexOf("recognition risk") !== -1 && s.retentionRisk;
  })());
  check("signals: never-promoted staleness names it instead of a number",
    mk({ profileYears: 5, everPromoted: false }).riskFactors
      .some(f => /never promoted/.test(f)));
  check("signals: null ratio / null marketRatio contribute no factor",
    mk({ level: "I3", ratio: null, marketRatio: null }).riskFactors.length === 0);
})();

// ── V4: signals verdicts ─────────────────────────────────────────────────────
(function () {
  const sig = (o) => ({ signals: Object.assign({ everPromoted: true, promoStale: false,
    earlyCareer: false, coreLevel: false, recognitionRisk: false, retentionRisk: false,
    riskFactors: [] }, o) });
  const model = {
    fyLabel: "FY27",
    employees: [
      sig({ promoStale: true, earlyCareer: true }),
      sig({ promoStale: true }),
      sig({ recognitionRisk: true }),
      sig({ coreLevel: true, retentionRisk: true, riskFactors: ["below market", "recognition risk"] }),
      sig({ coreLevel: true }),
    ],
  };
  const vs = buildVerdicts_(model, CONFIG_CD);
  const byId = {};
  vs.forEach(v => { byId[v.id] = v; });
  check("verdicts: promo-stale counts total and early-career subset",
    /2 active/.test(byId["promo-stale"].fact) && /\(1 early-career/.test(byId["promo-stale"].fact) &&
    byId["promo-stale"].severity === "NOTE");
  check("verdicts: recognition-risk counts flagged top performers",
    /^1 top performer/.test(byId["recognition-risk"].fact) && byId["recognition-risk"].severity === "NOTE");
  check("verdicts: retention-core is x-of-y over the core cohort and reads RISK",
    /1 of 2 core-level/.test(byId["retention-core"].fact) && byId["retention-core"].severity === "RISK");
  check("verdicts: clean signals read FACT", (function () {
    const clean = buildVerdicts_({ fyLabel: "FY27", employees: [sig({})] }, CONFIG_CD);
    return clean.find(v => v.id === "promo-stale").severity === "FACT" &&
           clean.find(v => v.id === "retention-core").severity === "FACT";
  })());
})();

// ── V4: employment type (part-time / EOR rules) ─────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  check("empType: EOR and Employee of Record are REGULAR by rule",
    classifyEmpType_("EOR", cfg) === "regular" &&
    classifyEmpType_("Employer of Record", cfg) === "regular");
  check("empType: part-time variants classify",
    classifyEmpType_("Part-Time", cfg) === "part-time" &&
    classifyEmpType_("part time", cfg) === "part-time" &&
    classifyEmpType_("PartTime", cfg) === "part-time");
  check("empType: intern classifies", classifyEmpType_("Intern (Summer)", cfg) === "intern");
  check("empType: blank / full-time / unknown default regular",
    classifyEmpType_("", cfg) === "regular" && classifyEmpType_(null, cfg) === "regular" &&
    classifyEmpType_("Full-Time Regular", cfg) === "regular");

  // Part-timers never feed anchors and never get a ratio.
  const mk = (empNo, tcc, comparable, empType) => ({
    empNo, name: "P" + empNo, keyLocation: "MX", jobTitle: "04.I3.1 Consultant",
    level: "I3", currency: "MXN", tcc, tccUsd: null,
    comparable, employmentType: empType || (comparable ? "regular" : "part-time"),
  });
  const groups = buildCompaGroups_([
    mk("1", 100, true), mk("2", 120, true), mk("3", 140, true),
    mk("4", 60, false), // part-time — would drag the median down if counted
  ], {}, CONFIG_CD);
  const g = groups[0];
  check("compa: part-time excluded from the anchor median", g.anchor === 120 && g.count === 3);
  check("compa: part-time member listed, ratio null, flagged nonComparable", (function () {
    const pt = g.members.find(m => m.empNo === "4");
    return pt && pt.ratio === null && pt.nonComparable === true && pt.employmentType === "part-time";
  })());
  check("compa: comparable members still scored", g.members.find(m => m.empNo === "1").ratio != null);

  // Level cohorts skip part-timers too (small group falling back to a cohort).
  const cohortGroups = buildCompaGroups_([
    mk("1", 100, true), mk("2", 120, true), mk("3", 140, true),
    Object.assign(mk("9", 50, false), { jobTitle: "04.I3.9 Solo Role" }),
    Object.assign(mk("10", 130, true), { jobTitle: "04.I3.9 Solo Role" }),
  ], {}, CONFIG_CD);
  const solo = cohortGroups.find(x => /Solo/.test(x.jobTitle));
  // Cohort MX||I3 = comparable TCCs {100,120,140,130} → median 125. The
  // part-time 50 would have dragged it to 120 if it were (wrongly) counted.
  check("compa: level-cohort fallback median ignores part-time TCC",
    solo.anchorTier === "level" && solo.anchor === 125);

  // Equity lenses skip non-comparable rows entirely.
  const eqCfg = { EQUITY_GAP_PCT: 10, EQUITY_OUTLIER_PCT: 25, TENURE_YEARS_MIN: 3, TENURE_BELOW_PCT: 15 };
  const eq = buildEquity_([
    mk("1", 100, true), mk("2", 110, true), mk("3", 105, true),
    Object.assign(mk("4", 40, false), { hireDate: new Date(2018, 0, 1) }), // would be an outlier if counted
  ], eqCfg, new Date(2026, 6, 1));
  check("equity: part-time never flags as an outlier", eq.outliers.length === 0 && eq.tenure.length === 0);
})();

// ── V4: restricted profiles ─────────────────────────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  const mk = (empNo, title) => ({ empNo, jobTitle: title, level: parseLevel_(title).level });
  check("restricted: CEO / chief / director / VP titles match",
    isRestrictedEmp_(mk("1", "01.M10.1 Chief Executive Officer"), cfg) &&
    isRestrictedEmp_(mk("2", "02.M8.1 Director of Operations"), cfg) &&
    isRestrictedEmp_(mk("3", "03.M8.2 VP Engineering"), cfg));
  check("restricted: M-level floor catches wording the regex misses",
    isRestrictedEmp_(mk("4", "05.M9.1 Head of Everything"), cfg) &&
    !isRestrictedEmp_(mk("5", "05.M8.1 Head of Everything"), cfg));
  check("restricted: rank-and-file titles never match",
    !isRestrictedEmp_(mk("6", "04.I3.1 Consultant"), cfg) &&
    !isRestrictedEmp_(mk("7", "04.M5.1 Delivery Manager"), cfg));
  check("restricted: explicit extra employee number wins",
    isRestrictedEmp_(mk("8", "04.I3.1 Consultant"), cfg, new Set(["8"])));

  const payload = {
    meta: { restricted: { hidden: 0, minMLevel: 9 } },
    restrictedEmpNos: ["100"],
    employees: [{ empNo: "100", name: "Big Boss" }, { empNo: "2", name: "IC" }],
    people: [{ empNo: "100" }, { empNo: "2" }],
    qtaInterim: [{ empNo: "100" }, { empNo: "2" }],
    attrition: { detail: [{ empNo: "100" }, { empNo: "3" }] },
    compaGroups: [{ members: [{ empNo: "100" }, { empNo: "2" }] }],
    equity: { outliers: [{ empNo: "100" }], tenure: [{ empNo: "2" }] },
    history: { "100": { events: [] }, "2": { events: [] } },
  };
  const stripped = stripRestrictedPayload_(JSON.parse(JSON.stringify(payload)));
  check("strip: restricted removed from every name-carrying collection",
    stripped.employees.length === 1 && stripped.people.length === 1 &&
    stripped.qtaInterim.length === 1 && stripped.attrition.detail.length === 1 &&
    stripped.compaGroups[0].members.length === 1 &&
    stripped.equity.outliers.length === 0 && stripped.equity.tenure.length === 1 &&
    !stripped.history["100"] && !!stripped.history["2"]);
  check("strip: the empNo list itself is deleted and hidden count is set",
    stripped.restrictedEmpNos === undefined && stripped.meta.restricted.hidden === 1 &&
    stripped.meta.restricted.minMLevel === 9);
  check("strip: empty restricted list is a no-op with hidden 0", (function () {
    const p = { meta: { restricted: { hidden: 0 } }, restrictedEmpNos: [],
                employees: [{ empNo: "1" }] };
    const s = stripRestrictedPayload_(p);
    return s.employees.length === 1 && s.meta.restricted.hidden === 0;
  })());
})();

// ── V4: contribution snapshot join + invisible contributor (Check L) ────────
(function () {
  const cfg = CONFIG_CD;
  const out = buildContribByEmp_([
    { empNo: "1", quarter: "FY26Q3", score: 0.6 },
    { empNo: "1", quarter: "FY26Q4", score: 0.9 },
    { empNo: "2", quarter: "FY26Q4", score: 0.5 },
    { empNo: "",  quarter: "FY26Q4", score: 1 },   // no empNo → dropped
    { empNo: "3", quarter: "",       score: 1 },   // no quarter → dropped
  ]);
  check("contrib: latest quarter wins per employee",
    out.byEmp["1"].score === 0.9 && out.byEmp["1"].quarter === "FY26Q4");
  check("contrib: latest quarter label + count reported",
    out.quarter === "FY26Q4" && out.count === 2);
  check("contrib: rows without empNo/quarter dropped", !out.byEmp[""] && !out.byEmp["3"]);

  const base = { level: "I5", ratio: 1.0, marketRatio: 1.0, ttmGrowthPct: 0.08,
                 profileYears: 1, everPromoted: true, windowLatest: 4 };
  const mk = o => buildSignalsForEmp_(Object.assign({}, base, o), cfg);
  check("invisible: high evidence + weak SI fires",
    mk({ contribScore: 0.8, perfAvg: 3.2 }).invisibleContributor);
  check("invisible: high evidence + UNRATED fires (no-rating ≠ no contribution)",
    mk({ contribScore: 0.8, perfAvg: null }).invisibleContributor);
  check("invisible: strong SI never fires — the rating already sees them",
    !mk({ contribScore: 0.9, perfAvg: 4.5 }).invisibleContributor);
  check("invisible: no snapshot data never fires",
    !mk({ contribScore: null, perfAvg: null }).invisibleContributor);
  check("invisible: below-threshold evidence never fires",
    !mk({ contribScore: 0.5, perfAvg: 3 }).invisibleContributor);
  check("invisible: a verification trigger, never a retention factor",
    mk({ level: "I3", contribScore: 0.8, perfAvg: null }).riskFactors.indexOf("invisible") === -1);

  const sigE = o => ({ signals: Object.assign({ everPromoted: true, promoStale: false,
    earlyCareer: false, coreLevel: false, recognitionRisk: false, retentionRisk: false,
    invisibleContributor: false, riskFactors: [] }, o) });
  const vs = buildVerdicts_({ fyLabel: "FY27",
    employees: [sigE({ invisibleContributor: true }), sigE({})] }, CONFIG_CD);
  const inv = vs.find(v => v.id === "invisible-contrib");
  check("verdicts: invisible-contrib counts and prescribes manager verification",
    inv && /^1 Rocketeer/.test(inv.fact) && /manager/i.test(inv.action));
  check("verdicts: no invisible flags → no verdict at all",
    !buildVerdicts_({ fyLabel: "FY27", employees: [sigE({})] }, CONFIG_CD)
      .find(v => v.id === "invisible-contrib"));
})();

// ── BUILD_ mismatch guard ───────────────────────────────────────────────────
check("build: all five files agree at rest", buildMismatch_() === null);

check("build: a stale file is named", (function () {
  const real = BUILD_.position;
  BUILD_.position = real - 1;
  const out = buildMismatch_();
  BUILD_.position = real;
  return out && out.length === 1 && out[0] === "position";
})());

check("build: several stale files are all named", (function () {
  const p = BUILD_.position, w = BUILD_.workforce;
  BUILD_.position = 0; BUILD_.workforce = 0;
  const out = buildMismatch_();
  BUILD_.position = p; BUILD_.workforce = w;
  return out && out.length === 2;
})());

check("build: a missing stamp counts as stale", (function () {
  const real = BUILD_.narrative;
  delete BUILD_.narrative;
  const out = buildMismatch_();
  BUILD_.narrative = real;
  return out && out.indexOf("narrative") !== -1;
})());

// ── Verdict deep-links must point at a surviving view ───────────────────────
// P0 deletes ranking/signals/equity/market/contrib. getVerdictsFor(view) filters
// on v.view, so a verdict aimed at a deleted view is unreachable, not merely ugly.
check("verdicts: no verdict targets a deleted view", (function () {
  const DEAD = ["ranking", "signals", "equity", "market", "contrib", "actions"];
  const out = buildVerdicts_(VERDICT_MODEL_, VERDICT_CFG_);
  return out.length > 0 && out.every(v => DEAD.indexOf(v.view) === -1);
})());

// ── THRESHOLDS ──────────────────────────────────────────────────────────────
check("thresholds: internal bands carry value and source",
  CONFIG_CD.THRESHOLDS.internal.low === 0.80 &&
  CONFIG_CD.THRESHOLDS.internal.target === 0.95 &&
  CONFIG_CD.THRESHOLDS.internal.high === 1.10 &&
  typeof CONFIG_CD.THRESHOLDS.internal.source === "string");

check("thresholds: market floor carries value and source",
  CONFIG_CD.THRESHOLDS.market.low === 0.90 &&
  typeof CONFIG_CD.THRESHOLDS.market.source === "string");

check("thresholds: small-group minimum lives here too",
  CONFIG_CD.THRESHOLDS.smallGroupMin === 3);

check("thresholds: legacy keys still resolve to the same numbers",
  CONFIG_CD.COMPA_LOW_MIN === CONFIG_CD.THRESHOLDS.internal.low &&
  CONFIG_CD.COMPA_TARGET_MIN === CONFIG_CD.THRESHOLDS.internal.target &&
  CONFIG_CD.COMPA_HIGH_MAX === CONFIG_CD.THRESHOLDS.internal.high &&
  CONFIG_CD.MARKET_LOW === CONFIG_CD.THRESHOLDS.market.low &&
  CONFIG_CD.SMALL_GROUP_MIN === CONFIG_CD.THRESHOLDS.smallGroupMin);

// ============================================================
// P2a — Task 1: scaffolding (CONFIG_CD.P2, new BUILD_ stamps)
// ============================================================
check("p2 cfg: remote thresholds", CONFIG_CD.P2.REMOTE.competitiveMin === 1.0 &&
  CONFIG_CD.P2.REMOTE.stableMin === 0.85 && CONFIG_CD.P2.REMOTE.streakMinRating === 4 &&
  CONFIG_CD.P2.REMOTE.streakMinCount === 3);
check("p2 cfg: acceleration cadence 6·15·21·30·36",
  JSON.stringify(CONFIG_CD.P2.ACCEL.offsetsMonths) === JSON.stringify([6, 15, 21, 30, 36]) &&
  CONFIG_CD.P2.ACCEL.siGate === 4 && CONFIG_CD.P2.ACCEL.overdueDays === 60 &&
  CONFIG_CD.P2.ACCEL.trackLevelRe.test("I3") && CONFIG_CD.P2.ACCEL.trackLevelRe.test("I4") &&
  !CONFIG_CD.P2.ACCEL.trackLevelRe.test("I2") && CONFIG_CD.P2.ACCEL.trackLevelLabel === "I3–I4");
check("p2 cfg: retention dual-gate numbers", CONFIG_CD.P2.RETENTION.windowQuarters === 4 &&
  CONFIG_CD.P2.RETENTION.baselineMult === 1.5 && CONFIG_CD.P2.RETENTION.consecQuarters === 2 &&
  CONFIG_CD.P2.RETENTION.minExits === 4);
check("p2 cfg: growth economics", CONFIG_CD.P2.GROWTH.replaceFactor === 0.75 &&
  CONFIG_CD.P2.GROWTH.gapTarget === 0.95 &&
  CONFIG_CD.P2.GROWTH.adjustRe.test("Salary Adjustment") &&
  !CONFIG_CD.P2.GROWTH.adjustRe.test("New Hire") &&
  typeof CONFIG_CD.P2.GROWTH.adjustLabel === "string");

check("build: the four P2 engine files carry stamps", (function () {
  return ["remotepull", "acceleration", "retention", "growth"]
    .every(k => typeof BUILD_[k] === "number");
})());
check("build: a stale P2 engine blocks doGet", (function () {
  const real = BUILD_.retention;
  BUILD_.retention = real - 1;
  const out = buildMismatch_();
  BUILD_.retention = real;
  return out && out.indexOf("retention") !== -1;
})());
