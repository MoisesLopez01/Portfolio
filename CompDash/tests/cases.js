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

// ── Task 4: buildCompaGroups_ / marketSuggestion_ ───────────
(function () {
  const g1 = [
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 100000 }),
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 80000 }),
    mkEmp({ keyLocation: "Mexico", jobTitle: "04.I3.1", tcc: 50000 }),
    mkEmp({ keyLocation: "Malaysia", jobTitle: "04.I3.1", tcc: 90000, currency: "MYR" }),
    mkEmp({ keyLocation: "Mexico", jobTitle: "05.M4.1", tcc: null }),
  ];
  const groups = buildCompaGroups_(g1, 3);
  check("compa: 3 groups", groups.length === 3);
  const mx = groups.find(g => g.keyLocation === "Mexico" && g.jobTitle === "04.I3.1");
  check("compa: max anchor + not small", mx.maxTcc === 100000 && mx.count === 3 && !mx.smallGroup);
  check("compa: ratios 1/0.8/0.5", approx(mx.members[0].ratio, 1) && approx(mx.members[1].ratio, 0.8) && approx(mx.members[2].ratio, 0.5));
  check("compa: members sorted desc by tcc", mx.members[0].tcc === 100000);
  const my = groups.find(g => g.keyLocation === "Malaysia");
  check("compa: singleton noPeers + smallGroup + ratio 1", my.members[0].noPeers === true && my.smallGroup === true && approx(my.members[0].ratio, 1));
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
