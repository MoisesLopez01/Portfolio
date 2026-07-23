// ============================================================
// WorkforceReport test cases — run via: node WorkforceReport/tests/run_tests.js
// Uses check(desc, cond) and approx(a, b, eps) from the runner prelude.
// Reference date everywhere: 2026-07-21 → FY27 in progress, fys = [FY25, FY26, FY27].
// ============================================================

var REF = new Date(2026, 6, 21);

var __seq = 0;
function mkEmp(over) {
  __seq++;
  const base = {
    empNo: "E" + __seq, name: "Emp " + __seq,
    active: true, jobTitle: "04.I3.1", level: "I3", track: "IC",
    jobFamily: "JF004",
    employeeType: "Regular Employee", isIntern: false,
    dept: "Services", lob: "", keyLocation: "Mexico", location: "", currency: "MXN",
    hireDate: new Date(2020, 0, 1), termDate: null,
    termReason: "", termCategory: "", termRegretted: "",
    gender: null, tcc: 100000, tccUsd: 5000,
  };
  return Object.assign(base, over || {});
}
function term(over) {
  return mkEmp(Object.assign({ active: false, termCategory: "Voluntary" }, over || {}));
}

// ── FY calendar: fyListWR_ + the Jun 30 / Jul 1 edge ────────────────────────
(function () {
  const fys = fyListWR_(REF, 3);
  check("fyList: three FYs oldest first",
    fys.length === 3 && fys[0].label === "FY25" && fys[1].label === "FY26" && fys[2].label === "FY27");
  check("fyList: FY25 window Jul 2024 – Jun 2025",
    fys[0].start.getFullYear() === 2024 && fys[0].start.getMonth() === 6 && fys[0].start.getDate() === 1 &&
    fys[0].end.getFullYear() === 2025 && fys[0].end.getMonth() === 5 && fys[0].end.getDate() === 30);
  check("fyList: only the last FY is in progress",
    !fys[0].inProgress && !fys[1].inProgress && fys[2].inProgress);
  check("fyList: self-advances at rollover",
    fyListWR_(new Date(2027, 6, 1), 3)[2].label === "FY28");
  check("fiscalContextWR_: Jun 30 is the closing FY",
    fiscalContextWR_(new Date(2026, 5, 30)).fyLabel === "FY26");
  check("fiscalContextWR_: Jul 1 opens the next FY",
    fiscalContextWR_(new Date(2026, 6, 1)).fyLabel === "FY27");
})();

// ── Movement engine: counts + boundary pins + rate reconstruction ───────────
(function () {
  const fys = fyListWR_(REF, 3);
  const records = [
    mkEmp({ hireDate: new Date(2020, 0, 1) }),                    // long-tenured active
    mkEmp({ hireDate: new Date(2024, 5, 30) }),                   // hired Jun 30 2024 → FY24, NOT an FY25 hire
    mkEmp({ hireDate: new Date(2024, 6, 1) }),                    // hired Jul 1 2024 → FY25 hire (edge)
    term({ hireDate: new Date(2022, 0, 1), termDate: new Date(2025, 5, 30) }), // Jun 30 2025 → FY25 exit (edge)
    term({ hireDate: new Date(2022, 0, 1), termDate: new Date(2025, 6, 1) }),  // Jul 1 2025 → FY26 exit (edge)
    term({ hireDate: new Date(2022, 0, 1), termDate: new Date(2026, 6, 10),    // FY27 exit before asOf
           termCategory: "Involuntary" }),
  ];
  const m25 = fyMovement_(records, fys[0], REF);
  const m26 = fyMovement_(records, fys[1], REF);
  const m27 = fyMovement_(records, fys[2], REF);
  check("movement: FY25 hires = 1 (Jul 1 in, Jun 30 out)", m25.hires === 1);
  check("movement: FY25 exits = 1 (Jun 30 edge in)", m25.exits === 1);
  check("movement: FY26 exits = 1 (Jul 1 edge in)", m26.exits === 1);
  check("movement: FY27 exits = 1", m27.exits === 1);
  check("movement: net math", m25.net === 0 && m26.net === -1);
  // FY27 headcount: start Jul 1 2026 → E1,E2,E3 active + E6 (terms Jul 10 > Jul 1) = 4;
  // end = asOf Jul 21 2026 → E1,E2,E3 = 3. Rate = 1 / mean(4,3) = 1/3.5.
  check("movement: FY27 headcount start→end uses asOf", m27.hcStart === 4 && m27.hcEnd === 3);
  check("movement: rate = exits ÷ mean(start,end)", approx(m27.rate, 1 / 3.5));
  check("movement: closed FY uses FY end not asOf", m25.inProgress === false && m27.inProgress === true);
})();

// ── Attrition detail: regretted, reasons, leaver tenure ─────────────────────
(function () {
  const fys = fyListWR_(REF, 3);
  const records = [
    mkEmp({}),
    term({ hireDate: new Date(2024, 6, 1), termDate: new Date(2026, 6, 5),
           termRegretted: "Yes", termReason: "Better offer", level: "I4", dept: "R&D" }),
    term({ hireDate: new Date(2025, 6, 1), termDate: new Date(2026, 6, 10),
           termRegretted: "Yes", termReason: "Better offer" }),
    term({ hireDate: new Date(2016, 6, 1), termDate: new Date(2026, 6, 15),
           termRegretted: "No", termReason: "Relocation", termCategory: "Involuntary" }),
  ];
  const s = fyAttritionStats_(records, fys[2], REF);
  check("attr: exits 3, vol 2, invol 1", s.exits === 3 && s.vol === 2 && s.invol === 1);
  check("attr: regretted 2 of 3", s.regretted === 2 && approx(s.regrettedPct, 2 / 3));
  check("attr: top reason histogram", s.reasons[0].key === "Better offer" && s.reasons[0].count === 2);
  check("attr: leaver levels sorted by rank", s.levels[0].key === "I3" && s.levels[1].key === "I4");
  check("attr: IC vs Manager leaver split", s.icExits === 3 && s.mExits === 0);
  check("attr: all organic when no position eliminations",
    s.organicExits === 3 && s.structuralExits === 0);
  const sStruct = fyAttritionStats_(records.concat([
    term({ termDate: new Date(2026, 6, 18), termRegretted: "Yes",
           termReason: "Job Position Eliminated or Changed" }),
  ]), fys[2], REF, CONFIG_WR);
  check("attr: structural exits split out with regretted overlap",
    sStruct.structuralExits === 1 && sStruct.organicExits === 3 &&
    sStruct.structuralRegretted === 1);
  check("attr: leaver families histogram for the sub-function view",
    s.families.some(x => x.key === "JF004" && x.count === 3));
  // Tenures: ~2.0y + ~1.0y + ~10.0y → avg ≈ 4.36, rounds to 4.4 (1 decimal)
  check("attr: avg leaver tenure", s.avgLeaverTenureYears != null &&
    Math.abs(s.avgLeaverTenureYears - 4.4) <= 0.11);
})();

// ── Lever engine: classification, delta math, no-prior, currency modes ──────
(function () {
  check("lever: promotion reasons", classifyLever_("Promotion", CONFIG_WR) === "promo" &&
    classifyLever_("Microband Promotion", CONFIG_WR) === "promo");
  check("lever: known adjustment reasons",
    classifyLever_("Annual Adjustment", CONFIG_WR) === "adjust" &&
    classifyLever_("Microband Adjustment", CONFIG_WR) === "adjust" &&
    classifyLever_("Market Calibration", CONFIG_WR) === "adjust");
  check("lever: adjustments are the catch-all — unseen reasons never drop",
    classifyLever_("Compensation Review", CONFIG_WR) === "adjust" &&
    classifyLever_("Cost of Living Adjustment", CONFIG_WR) === "adjust" &&
    classifyLever_("Other", CONFIG_WR) === "adjust" &&
    classifyLever_("Retention Bonus Restructure", CONFIG_WR) === "adjust");
  check("lever: New Hire is its own growth event",
    classifyLever_("New Hire", CONFIG_WR) === "newhire");
  check("lever: excluded non-raise reasons → other",
    classifyLever_("Internal Transfer", CONFIG_WR) === "other" &&
    classifyLever_("Historical Data Update", CONFIG_WR) === "other");
  check("lever: blank reason is unclassifiable, never a lever",
    classifyLever_("", CONFIG_WR) === "other" &&
    classifyLever_("   ", CONFIG_WR) === "other" &&
    classifyLever_(null, CONFIG_WR) === "other");

  const fys = fyListWR_(REF, 3);
  const hist = {
    A: [
      { date: new Date(2024, 7, 1), reason: "New Hire", tcc: 100 },
      { date: new Date(2025, 7, 1), reason: "Annual Adjustment", tcc: 110 },   // FY26: +10 vs 100
      { date: new Date(2026, 6, 10), reason: "Promotion", tcc: 130 },          // FY27: +20 vs 110
    ],
    B: [
      { date: new Date(2025, 8, 1), reason: "Promotion", tcc: 200 },           // FY26: no prior record
    ],
  };
  const f26 = buildLeversForFy_(["A", "B"], hist, fys[1], "local", CONFIG_WR);
  check("lever FY26: 1 adjustment, delta 10, growth 10%",
    f26.adjust.count === 1 && f26.adjust.totalRaise === 10 && approx(f26.adjust.growthPct, 0.10));
  check("lever FY26: promo counted but no-prior excluded from deltas",
    f26.promo.count === 1 && f26.promo.noPrior === 1 && f26.promo.totalRaise === null);
  const f27 = buildLeversForFy_(["A", "B"], hist, fys[2], "local", CONFIG_WR);
  check("lever FY27: promo +20 vs 110",
    f27.promo.count === 1 && f27.promo.totalRaise === 20 && approx(f27.promo.growthPct, 20 / 110));
  const f25 = buildLeversForFy_(["A", "B"], hist, fys[0], "local", CONFIG_WR);
  check("lever FY25: New Hire counted as its own event, not excluded",
    f25.promo.count === 0 && f25.newHires === 1 && f25.excluded === 0);

  const u27 = buildLeversForFy_(["A", "B"], hist, fys[2], "usd", CONFIG_WR);
  check("lever usd mode: totals withheld, growth = mean per-event pct",
    u27.promo.totalRaise === null && approx(u27.promo.growthPct, 20 / 110));

  const mk = (label, pc, pg, ac) => ({ label,
    promo: { count: pc, growthPct: pg, noPrior: 0, totalRaise: null },
    adjust: { count: ac, growthPct: 0.03, noPrior: 0, totalRaise: null } });
  check("lever shift: fires on count+size down, adjustments up",
    detectLeverShift_([mk("FY26", 10, 0.12, 5), mk("FY27", 6, 0.08, 9)]).join() === "FY26→FY27");
  check("lever shift: silent when promo size holds",
    detectLeverShift_([mk("FY26", 10, 0.12, 5), mk("FY27", 6, 0.15, 9)]).length === 0);
})();

// ── Currency mode — spec §5 ─────────────────────────────────────────────────
(function () {
  const recs = [mkEmp({ currency: "CLP" }), mkEmp({ currency: "CLP" })];
  const single = currencyModeForScope_(recs, "Chile");
  check("currency: single-currency country → local", single.mode === "local" && single.code === "CLP");
  const multi = currencyModeForScope_(recs.concat([mkEmp({ currency: "USD" })]), "Chile");
  check("currency: multi-currency location → USD with currencies named",
    multi.mode === "usd" && multi.currencies.join() === "CLP,USD");
  check("currency: company scope always USD",
    currencyModeForScope_(recs, "company").mode === "usd");
  const r = mkEmp({ tcc: 900, tccUsd: 42 });
  check("currency: tccOf_ obeys mode", tccOf_(r, "local") === 900 && tccOf_(r, "usd") === 42);
})();

// ── Composition + tenure buckets ────────────────────────────────────────────
(function () {
  const active = [
    mkEmp({ hireDate: new Date(2026, 3, 1) }),                        // <1y
    mkEmp({ hireDate: new Date(2024, 6, 1) }),                        // 1–3y
    mkEmp({ hireDate: new Date(2022, 6, 1), jobTitle: "04.M4.1", level: "M4", track: "M" }), // 3–5y
    mkEmp({ hireDate: new Date(2016, 6, 1), dept: "R&D" }),           // ≥5y
    mkEmp({ hireDate: null, jobTitle: "Advisor", level: "—", track: null }),
  ];
  const c = buildComposition_(active, REF);
  check("comp: IC/M/unparsed split", c.icCount === 3 && c.mCount === 1 && c.unparsedCount === 1);
  check("comp: dept table sorted desc", c.depts[0].key === "Services" && c.depts[0].count === 4);
  const b = {};
  c.tenureBuckets.forEach(x => { b[x.key] = x.count; });
  check("comp: tenure buckets", b["<1y"] === 1 && b["1–3y"] === 1 && b["3–5y"] === 1 &&
    b["≥5y"] === 1 && b["unknown"] === 1);
  check("comp: levels sorted by rank", c.levels[0].key === "I3" && c.levels[1].key === "M4" &&
    c.levels[c.levels.length - 1].key === "—");
  check("tenureBucket_ boundaries", tenureBucket_(0.99) === "<1y" && tenureBucket_(1) === "1–3y" &&
    tenureBucket_(3) === "3–5y" && tenureBucket_(5) === "≥5y" && tenureBucket_(null) === "unknown");
})();

// ── Job family from the title prefix ────────────────────────────────────────
(function () {
  check("jobFamily: 04.I3.1 → JF004 (identity, zero-padded)",
    parseJobFamily_("04.I3.1", CONFIG_WR) === "JF004");
  check("jobFamily: 18.M4.3 → JF018", parseJobFamily_("18.M4.3", CONFIG_WR) === "JF018");
  check("jobFamily: no numeric prefix → unknown",
    parseJobFamily_("Senior Engineer", CONFIG_WR) === "" && parseJobFamily_(null, CONFIG_WR) === "");
  check("jobFamily: JOB_FAMILY_MAP override wins",
    parseJobFamily_("04.I3.1", Object.assign({}, CONFIG_WR, { JOB_FAMILY_MAP: { "04": "JF005" } })) === "JF005");
})();

// ── Comp structure: bands, small-band suppression, inversions ───────────────
(function () {
  const mk3 = (level, track, tcc) => [1, 2, 3].map(() =>
    mkEmp({ jobTitle: "04." + level + ".1", level, track, tcc, tccUsd: tcc / 20 }));
  const active = []
    .concat(mk3("I5", "IC", 120000))       // senior IC band avg 120k
    .concat(mk3("M4", "M", 110000))        // manager band avg 110k → INVERTED vs I5
    .concat(mk3("I3", "IC", 90000))        // junior IC — never compared (below SENIOR_IC_MIN)
    .concat([mkEmp({ jobTitle: "04.M8.1", level: "M8", track: "M", tcc: 300000 }),
             mkEmp({ jobTitle: "04.M8.1", level: "M8", track: "M", tcc: 310000 })]); // 2 members → suppressed
  const cs = buildCompStructure_(active, "local", CONFIG_WR);
  check("structure: envelope + per-head", cs.valued === 11 &&
    cs.envelope === 120000 * 3 + 110000 * 3 + 90000 * 3 + 610000);
  const m8 = cs.bands.find(x => x.level === "M8");
  check("structure: small band suppressed (count kept, avg withheld)",
    m8.count === 2 && m8.avg === null && m8.suppressed === true);
  check("structure: inversion M4 < I5 detected", cs.inversions.length === 1 &&
    cs.inversions[0].mLevel === "M4" && cs.inversions[0].icLevel === "I5");
  check("structure: junior IC never triggers inversion",
    !cs.inversions.some(i => i.icLevel === "I3"));
  const noInv = buildCompStructure_(mk3("I5", "IC", 100000).concat(mk3("M4", "M", 150000)), "local", CONFIG_WR);
  check("structure: no inversion when manager band higher", noInv.inversions.length === 0);

  // Job-family qualification (title-prefix families, JF004 fixtures):
  // the same-family inversion is a genuine candidate.
  check("inversion qual: pattern holding within a job family is flagged as genuine",
    cs.inversions[0].withinGroups.join() === "JF004" &&
    cs.inversions[0].dimLabel === "job family" &&
    cs.inversions[0].crossFamilyOnly === false);
  // Cross-family case: the manager band is JF007, the IC band JF004 —
  // scope-wide averages invert but no single family does.
  const cross = buildCompStructure_(
    mk3("M4", "M", 110000).map(r => Object.assign(r, { jobFamily: "JF007", jobTitle: "07.M4.1" }))
      .concat(mk3("I5", "IC", 120000)), "local", CONFIG_WR);
  check("inversion qual: bands that never share a family read cross-family",
    cross.inversions.length === 1 && cross.inversions[0].crossFamilyOnly === true &&
    cross.inversions[0].withinGroups.length === 0);
  // Family absent everywhere → the qualifier falls back to department.
  const noFam = buildCompStructure_(
    mk3("M4", "M", 110000).concat(mk3("I5", "IC", 120000))
      .map(r => Object.assign(r, { jobFamily: "" })), "local", CONFIG_WR);
  check("inversion qual: department fallback when no family parses",
    noFam.inversions[0].dimLabel === "department" &&
    noFam.inversions[0].withinGroups.join() === "Services");

  const secInv = secCompStructure_(cs, { mode: "local", code: "MXN" }, CONFIG_WR);
  check("inversion FACT: investigation-trigger wording + genuine-candidate branch",
    secInv.lines.some(l => l.badge === "FACT" &&
      l.text.indexOf("investigation trigger") !== -1 &&
      l.text.indexOf("holds inside JF004 — a genuine inversion candidate") !== -1));
  check("inversion FACT: names the families each band spans",
    secInv.lines.some(l => l.text.indexOf("(M4 spans JF004; I5 spans JF004)") !== -1));
  const secCross = secCompStructure_(cross, { mode: "local", code: "MXN" }, CONFIG_WR);
  check("inversion FACT: cross-family branch names the market-rate mix",
    secCross.lines.some(l => l.badge === "FACT" &&
      l.text.indexOf("never invert within a single job family") !== -1 &&
      l.text.indexOf("(M4 spans JF007; I5 spans JF004)") !== -1 &&
      l.text.indexOf("job-family market-rate mix") !== -1));
  check("inversion NOTE: triggers-not-errors guidance renders once",
    secInv.lines.filter(l => l.badge === "NOTE" &&
      l.text.indexOf("investigation triggers, not errors") !== -1).length === 1);
})();

// ── Compa band counts + market gap + equity counts ──────────────────────────
(function () {
  const mkT = (tcc, over) => mkEmp(Object.assign({ jobTitle: "04.I3.1 Analyst", level: "I3", tcc }, over));
  const active = [mkT(80000), mkT(100000), mkT(120000)]; // title peers, median 100k
  const groups = buildCompaGroups_(active, {}, CONFIG_WR);
  check("compa: title-tier anchor for 3 peers", groups.length === 1 && groups[0].anchorTier === "title");
  const bc = compaBandCounts_(groups, CONFIG_WR);
  check("compa bands: 0.8→low, 1.0→target, 1.2→above",
    bc.belowLow === 0 && bc.low === 1 && bc.target === 1 && bc.aboveHigh === 1);
  const lone = [mkEmp({ jobTitle: "Unicorn Wrangler", level: "—", tcc: 50000 })];
  const g2 = buildCompaGroups_(lone, {}, CONFIG_WR);
  check("compa: unresolvable singleton counted", compaBandCounts_(g2, CONFIG_WR).unresolved === 1);

  const bench = {};
  bench[benchKey_("Mexico", "04.I3.1 Analyst")] = { mean: 100000, currency: "MXN" };
  const mg = marketGapCounts_([mkT(80000), mkT(95000), mkT(110000)], bench, CONFIG_WR);
  check("market gap: below MARKET_LOW counted", mg.matched === 3 && mg.below === 1);
  check("market gap: below-market flags carry a level distribution + coverage total",
    mg.total === 3 && mg.belowLevels.length === 1 &&
    mg.belowLevels[0].key === "I3" && mg.belowLevels[0].count === 1);
  const mism = {};
  mism[benchKey_("Mexico", "04.I3.1 Analyst")] = { mean: 100000, currency: "USD" };
  check("market gap: currency mismatch withheld",
    marketGapCounts_([mkT(80000)], mism, CONFIG_WR).matched === 0 &&
    marketGapCounts_([mkT(80000)], mism, CONFIG_WR).mismatch === 1);

  const eq = buildEquityCounts_([
    mkT(100000, { hireDate: new Date(2016, 0, 1) }),
    mkT(100000),
    mkT(70000, { hireDate: new Date(2016, 0, 1) }),   // 30% below median, long tenure
  ], CONFIG_WR, REF);
  check("equity: outlier + tenure flags counted", eq.outliers === 1 && eq.tenureFlags === 1);
  check("equity: gender pending when column absent", eq.genderAvailable === false);
  const eqSmall = buildEquityCounts_([mkT(100000), mkT(50000)], CONFIG_WR, REF);
  check("equity: small groups suppressed entirely",
    eqSmall.suppressed === 1 && eqSmall.outliers === 0);
  const eqG = buildEquityCounts_([
    mkT(100000, { gender: "F" }), mkT(102000, { gender: "F" }),
    mkT(120000, { gender: "M" }), mkT(122000, { gender: "M" }),
  ], CONFIG_WR, REF);
  check("equity: gender gap ≥ threshold flagged",
    eqG.genderAvailable && eqG.genderGroups === 1 && eqG.genderFlagged === 1);
})();

// ── FY25 depth guards — spec §4 ─────────────────────────────────────────────
(function () {
  const fys = fyListWR_(REF, 3);
  const shallow = [mkEmp({}), term({ termDate: new Date(2025, 8, 1) })]; // earliest term Sep 2025
  const covShallow = coverageStats_(shallow, { A: [{ date: new Date(2025, 7, 1), reason: "x", tcc: 1 }] }, fys);
  check("guard: shallow roster fires the FY25 term guard",
    covShallow.firstFyTermGuard === true && covShallow.firstFyLabel === "FY25");
  check("guard: shallow RD fires the FY25 lever guard", covShallow.firstFyLeverGuard === true);

  const deep = [mkEmp({}), term({ termDate: new Date(2024, 6, 1) })]; // term on FY25 day one
  const covDeep = coverageStats_(deep, { A: [{ date: new Date(2025, 5, 30), reason: "x", tcc: 1 }] }, fys);
  check("guard: term on 2024-07-01 does NOT fire (retention reaches FY25 start)",
    covDeep.firstFyTermGuard === false);
  check("guard: comp event on 2025-06-30 does NOT fire the lever guard",
    covDeep.firstFyLeverGuard === false);
  check("guard: per-FY coverage counts", covDeep.termsPerFy[0].count === 1 &&
    covDeep.eventsPerFy[0].count === 1 && covDeep.eventsPerFy[1].count === 0);

  const noTerms = coverageStats_([mkEmp({})], {}, fys);
  check("guard: empty history fires both guards",
    noTerms.firstFyTermGuard === true && noTerms.firstFyLeverGuard === true);
})();

// ── Templated sentence builders: numbers land in the right slots ────────────
(function () {
  const fys = fyListWR_(REF, 3);
  const moves = [
    { label: "FY25", inProgress: false, hires: 12, exits: 7, net: 5, hcStart: 90, hcEnd: 95, rate: 7 / 92.5 },
    { label: "FY26", inProgress: false, hires: 9, exits: 11, net: -2, hcStart: 95, hcEnd: 93, rate: 11 / 94 },
    { label: "FY27", inProgress: true, hires: 3, exits: 2, net: 1, hcStart: 93, hcEnd: 94, rate: 2 / 93.5 },
  ];
  const cov = { firstFyTermGuard: true, firstFyLabel: "FY25", earliestTermDate: "2024-10-02",
                firstFyLeverGuard: false, earliestCompEvent: "2024-01-05" };
  const sec = secMovement_(moves, cov, fys, "2026-07-21");
  check("sentences: FY25 movement FACT carries its numbers",
    sec.lines[0].badge === "FACT" &&
    sec.lines[0].text.indexOf("12 hires") !== -1 &&
    sec.lines[0].text.indexOf("7 exits") !== -1 &&
    sec.lines[0].text.indexOf("net +5") !== -1 &&
    sec.lines[0].text.indexOf("7.6%") !== -1);
  check("sentences: negative net renders with sign",
    sec.lines[1].text.indexOf("net -2") !== -1);
  check("sentences: rate definition is a NOTE, movement carries no ASSUMPTION",
    sec.lines.some(l => l.badge === "NOTE" && l.text.indexOf("mean(headcount") !== -1) &&
    sec.lines.every(l => l.badge !== "ASSUMPTION"));
  check("sentences: FY25 coverage RISK fires with the retained date",
    sec.lines.some(l => l.badge === "RISK" && l.text.indexOf("2024-10-02") !== -1 &&
      l.text.indexOf("FY25 exits may be undercounted") !== -1));
  check("sentences: in-progress NOTE stamps the extraction date",
    sec.lines.some(l => l.badge === "NOTE" && l.text.indexOf("FY27 in progress — data as of 2026-07-21") !== -1));
  check("sentences: movement table row shape",
    sec.tables[0].rows.length === 3 && sec.tables[0].rows[2][0] === "FY27 (to date)");

  const attrStats = [{
    label: "FY27", inProgress: true, exits: 5, vol: 4, invol: 1,
    regretted: 4, regrettedPct: 0.8,
    reasons: [{ key: "Better offer", count: 3 }, { key: "Relocation", count: 2 }],
    depts: [{ key: "Services", count: 5 }], levels: [{ key: "I3", count: 5 }],
    avgLeaverTenureYears: 2.4,
  }];
  const sa = secAttritionDetail_(attrStats, CONFIG_WR, { firstFyTermGuard: false }, fys, "2026-07-21");
  check("sentences: regretted RISK fires at 80% ≥ 60%",
    sa.lines.some(l => l.badge === "RISK" && l.text.indexOf("80%") !== -1));
  check("sentences: single-reason RISK fires at 3 of 5",
    sa.lines.some(l => l.badge === "RISK" && l.text.indexOf("Better offer") !== -1));

  const lv = [
    { label: "FY26", inProgress: false, mode: "local",
      promo: { count: 4, noPrior: 0, totalRaise: 40000, growthPct: 0.11 },
      adjust: { count: 6, noPrior: 1, totalRaise: 30000, growthPct: 0.05 },
      newHires: 3, excluded: 2 },
  ];
  const sl = secLevers_(lv, { mode: "local", code: "MXN" },
    { firstFyLeverGuard: true, firstFyLabel: "FY25", earliestCompEvent: "2025-09-01" },
    CONFIG_WR, fys, "2026-07-21");
  check("sentences: lever FACT carries counts + totals + growth, NO new hires",
    sl.lines[0].text.indexOf("4 promotion events") !== -1 &&
    sl.lines[0].text.indexOf("40,000 MXN") !== -1 &&
    sl.lines[0].text.indexOf("11.0%") !== -1 &&
    sl.lines[0].text.indexOf("6 adjustment events") !== -1 &&
    sl.lines[0].text.indexOf("new-hire") === -1);
  check("sentences: classification NOTE routes New Hire to Workforce movement",
    sl.lines.some(l => l.badge === "NOTE" && l.text.indexOf("Market Calibration") !== -1 &&
      l.text.indexOf("Workforce movement") !== -1) &&
    sl.lines.every(l => l.badge !== "ASSUMPTION"));
  check("sentences: lever table has no new-hire row (movement owns that story)",
    sl.tables[0].rows.every(r => String(r[1]).indexOf("New hire") === -1));
  check("sentences: no-prior NOTE counts excluded deltas",
    sl.lines.some(l => l.badge === "NOTE" && l.text.indexOf("1 lever events lack a prior comp record") !== -1));
  check("sentences: FY25 lever RISK fires with earliest event",
    sl.lines.some(l => l.badge === "RISK" && l.text.indexOf("2025-09-01") !== -1));
})();

// ── Regular vs intern split + headcount chain + ghost departments ───────────
(function () {
  const ctx = { asOf: REF };
  const mkIntern = over => mkEmp(Object.assign(
    { employeeType: "Intern", isIntern: true }, over || {}));
  const records = [
    mkEmp({}), mkEmp({}), mkEmp({ employeeType: "Employer of Record" }),
    mkEmp({ employeeType: "Part Time" }),
    term({ termDate: new Date(2026, 6, 5), dept: "Managed Services" }),   // regular FY27 exit, GHOST dept
    mkIntern({}),                                                          // active intern
    mkIntern({ active: false, termDate: new Date(2026, 6, 8),
               termCategory: "Voluntary" }),                               // intern FY27 exit
    mkIntern({ hireDate: new Date(2026, 6, 2) }),                          // intern FY27 hire
  ];
  const p = buildReportPayload_(records, {}, {}, "company", ctx, CONFIG_WR);
  const scope = p.report.sections.find(s => s.id === "scope");
  check("split: scope headline counts regulars only (EOR + Part Time included)",
    scope.lines[0].text.indexOf("4 active regular employees") !== -1);
  check("split: active interns stated separately",
    scope.lines.some(l => l.badge === "FACT" && l.text.indexOf("2 active interns") !== -1));
  const mv = p.report.sections.find(s => s.id === "movement");
  // Regular exits FY27 = 1 (the Managed Services leaver) — intern exit NOT blended.
  check("split: headline FY27 exits exclude the intern exit",
    mv.tables[0].rows[2][2] === 1);
  check("split: intern flow table present with its own counts",
    mv.tables.length === 2 && mv.tables[1].title.indexOf("Intern") === 0 &&
    mv.tables[1].rows[2][1] === 1 && mv.tables[1].rows[2][2] === 1); // FY27: 1 hire, 1 exit
  check("split: headline FACT names the regular-employee rate",
    mv.lines[0].text.indexOf("regular-employee attrition rate") !== -1);
  check("split: brief glance = regulars + intern count",
    p.brief.glance.headcount === 4 && p.brief.glance.interns === 2);

  const attrSec = p.report.sections.find(s => s.id === "attrition");
  // Re-org directive 2026-07-22: historical departments are expected, so ONE
  // quiet NOTE — never a per-department RISK wall.
  check("ghost dept: single NOTE names the restructuring, no RISK lines",
    attrSec.lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("1 historical department") !== -1 &&
      l.text.indexOf("Managed Services") !== -1 &&
      l.text.indexOf("DEPT_REMAP") !== -1) &&
    attrSec.lines.every(l => l.badge !== "RISK" || l.text.indexOf("Managed Services") === -1));

  // Business-context notes (2026-07-23 doc): consolidation policy is stated
  // in FAR/N, both when ghosts remain and when the remap has fully landed.
  check("remap notes: exit-reason consolidation policy stated from config",
    attrSec.lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("Involuntary Retirement → Job Position Eliminated or Changed") !== -1 &&
      l.text.indexOf("Relocation to a New Employer → Another Job") !== -1));
  const clean = buildReportPayload_(
    records.filter(r => r.dept !== "Managed Services"), {}, {}, "company", ctx, CONFIG_WR);
  check("remap notes: ghost-free data states the apples-to-apples consolidation",
    clean.report.sections.find(s => s.id === "attrition")
      .lines.some(l => l.badge === "NOTE" && l.text.indexOf("apples-to-apples") !== -1));

  // Headcount chain + the CFO identity: closing = opening + hires − exits.
  const fys = fyListWR_(REF, 3);
  const chain = [
    mkEmp({ hireDate: new Date(2019, 0, 1) }),
    mkEmp({ hireDate: new Date(2025, 6, 1) }),   // hired Jul 1 2025 — the old ±2 seam artifact
    term({ hireDate: new Date(2020, 0, 1), termDate: new Date(2025, 5, 30) }), // term Jun 30 2025
  ];
  const m25 = fyMovement_(chain, fys[0], REF);
  const m26 = fyMovement_(chain, fys[1], REF);
  const m27 = fyMovement_(chain, fys[2], REF);
  check("chain: FY25 closing headcount === FY26 opening headcount",
    m25.hcEnd === m26.hcStart && m25.hcEnd === 1);
  check("identity: closing = opening + hires − exits for every FY (reclass 0)",
    [m25, m26, m27].every(m =>
      m.hcEnd === m.hcStart + m.hires - m.exits && m.reclass === 0));
  check("identity: Jul-1 hire is an FY26 hire, not FY25 closing headcount",
    m25.hires === 0 && m26.hires === 1 && m25.hcEnd === 1 && m26.hcEnd === 2);
  // In-progress FY: a future-dated hire is not yet a "to date" hire.
  const future = chain.concat([mkEmp({ hireDate: new Date(2026, 7, 15) })]); // Aug 2026 > asOf
  const f27 = fyMovement_(future, fys[2], REF);
  check("identity: future-dated hire excluded from to-date counts, still foots",
    f27.hires === 0 && f27.reclass === 0 && f27.hcEnd === f27.hcStart);
  // Reconciliation NOTE: clean data states that the table foots exactly.
  const secClean = secMovement_([m25, m26, m27], { firstFyTermGuard: false }, fys, "2026-07-21");
  check("recon NOTE: clean data → 'foots exactly'",
    secClean.lines.some(l => l.badge === "NOTE" && l.text.indexOf("foots exactly") !== -1));
  // Genuine residue (e.g. a two-row intern→regular conversion) is stated per FY.
  const off = Object.assign({}, m26, { reclass: 2, hcEnd: m26.hcEnd + 2 });
  const secOff = secMovement_([m25, off], { firstFyTermGuard: false }, fys, "2026-07-21");
  check("recon NOTE: residue renders the per-FY equation with the ± term",
    secOff.lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("± reclassification") !== -1 &&
      l.text.indexOf("FY26: " + off.hcStart + " + " + off.hires + " − " + off.exits + " + 2 = " + off.hcEnd) !== -1));
})();

// ── Exec short numbers + section reshape (composition/structure/attrition) ──
(function () {
  check("fmtShort_: exec magnitudes", fmtShort_(1000000) === "1M" &&
    fmtShort_(1250000) === "1.25M" && fmtShort_(4320) === "4.32K" &&
    fmtShort_(950) === "950" && fmtShort_(null) === "—");
  check("fmtMoneyShort_: code appended", fmtMoneyShort_(4050000, "MXN") === "4.05M MXN" &&
    fmtMoneyShort_(null, "MXN") === "—");

  const active = [1, 2, 3].map(() => mkEmp({ tcc: 1250000, hireDate: new Date(2024, 6, 1) }))
    .concat([1, 2, 3].map(() => mkEmp({ jobTitle: "04.M4.1", level: "M4", track: "M",
      tcc: 2000000, hireDate: new Date(2016, 0, 1) })));
  const comp = buildComposition_(active, REF);
  const secC = secComposition_(comp);
  check("composition: no level-distribution table (lives in section 3 only)",
    secC.tables.every(t => t.title.indexOf("Level") === -1));
  check("composition: tenure renders as a bar chart, not a table",
    secC.charts.length === 1 && secC.charts[0].title === "Tenure distribution" &&
    secC.charts[0].bars.some(b => b.label === "1–3y" && b.value === 3));
  check("composition: job-family headcount table renders when families parse",
    secC.tables.some(t => t.title === "Headcount by job family" &&
      t.rows.some(r => r[0] === "JF004" && r[1] === 6)));

  const cs = buildCompStructure_(active, "local", CONFIG_WR);
  const secS = secCompStructure_(cs, { mode: "local", code: "MXN" }, CONFIG_WR);
  const tbl = secS.tables[0];
  check("structure: level table = end active headcount + short avg cost",
    tbl.headers[1] === "End active headcount" && tbl.headers[2] === "Avg TCC (MXN)" &&
    tbl.rows.some(r => r[0] === "I3" && r[1] === 3 && r[2] === "1.25M") &&
    tbl.rows.some(r => r[0] === "M4" && r[2] === "2M"));
  check("structure: envelope FACT uses short format",
    secS.lines[0].text.indexOf("9.75M MXN") !== -1);

  const chart = chartAsTable_({ title: "Tenure distribution",
    bars: [{ label: "<1y", value: 9 }, { label: "≥5y", value: 3 }, { label: "3–5y", value: 0 }] });
  check("chartAsTable_: ▇ bars scale to max, zero stays empty",
    chart.rows[0][1] === "▇".repeat(18) && chart.rows[1][1] === "▇".repeat(6) &&
    chart.rows[2][1] === "");
})();

// ── Single leaver table: department × level × reason, per-FY columns ────────
(function () {
  const fys = fyListWR_(REF, 3);
  const records = [
    mkEmp({}),
    term({ termDate: new Date(2024, 8, 1), dept: "Services", termReason: "Better offer" }),  // FY25
    term({ termDate: new Date(2025, 8, 1), dept: "Services", termReason: "Better offer" }),  // FY26
    term({ termDate: new Date(2025, 9, 1), dept: "Services", termReason: "Better offer" }),  // FY26
    term({ termDate: new Date(2026, 6, 5), dept: "R&D", level: "M5", jobTitle: "04.M5.1",
           termReason: "Relocation" }),                                                       // FY27
  ];
  const stats = fys.map(fy => fyAttritionStats_(records, fy, REF));
  const sec = secAttritionDetail_(stats, CONFIG_WR, { firstFyTermGuard: false }, fys, "2026-07-21");
  check("leavers: combined dept×reason table is level-free",
    sec.tables[0].title === "Leavers by department and reason" &&
    sec.tables[0].headers.indexOf("Level") === -1);
  check("leavers: headers = dept + reason + one column per FY + Total",
    sec.tables[0].headers.join() === "Department,Reason,FY25,FY26,FY27,Total");
  const rows = sec.tables[0].rows;
  check("leavers: combo rows aggregate per FY and sort by total",
    rows.length === 2 &&
    rows[0].join() === "Services,Better offer,1,2,0,3" &&
    rows[1].join() === "R&D,Relocation,0,0,1,1");
  check("leavers: IC/Manager split stated in the FY FACT lines",
    sec.lines.some(l => l.badge === "FACT" &&
      l.text.indexOf("individual contributors (I-levels)") !== -1 &&
      l.text.indexOf("managers (M-levels)") !== -1));
  check("leavers: organic/structural split in the FY FACT lines",
    sec.lines.some(l => l.badge === "FACT" && l.text.indexOf("organic") !== -1 &&
      l.text.indexOf("structural (position eliminated)") !== -1));
  check("leavers: job-family sub-function table with per-FY columns",
    sec.tables.length === 2 &&
    sec.tables[1].title === "Leavers by job family (sub-function view)" &&
    sec.tables[1].headers.join() === "Job family,FY25,FY26,FY27,Total" &&
    sec.tables[1].rows[0][0] === "JF004" && sec.tables[1].rows[0][4] === 4);
  check("leavers: regretted definition NOTE (recorded flag, never inferred)",
    sec.lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("'Termination Regretted' flag as recorded") !== -1));
  check("leavers: taxonomy NOTE lists active reasons + legacy stragglers",
    sec.lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("Active exit-reason taxonomy") !== -1 &&
      l.text.indexOf("Voluntary Other = voluntary exits") !== -1 &&
      l.text.indexOf("Better offer (3)") !== -1));
})();

// ── Confluence-paste HTML builders ──────────────────────────────────────────
(function () {
  check("confLine_: badge token colored + escaped",
    confLine_(fact_("5 < 10 exits")).indexOf('[FACT]</strong> 5 &lt; 10 exits') !== -1);
  const t = confTable_({ title: "T", headers: ["A", "B"], rows: [["x", 1]] });
  check("confTable_: native table markup",
    t.indexOf("<table><tbody><tr><th>A</th>") !== -1 && t.indexOf("<td>1</td>") !== -1);
  const ctx = { asOf: REF };
  const payload = buildReportPayload_([mkEmp({}), mkEmp({}), mkEmp({})], {}, {}, "company", ctx, CONFIG_WR);
  const html = confluenceReportHtml_(payload);
  check("confluenceReportHtml_: title + every section heading present",
    html.indexOf("<h1>ServiceRocket Workforce &amp; Compensation Report</h1>") !== -1 &&
    payload.report.sections.every(s =>
      html.indexOf("<h2>" + confEsc_(s.title.replace(" · ", ". ")) + "</h2>") !== -1));
  const bhtml = confluenceBriefHtml_(payload, null);
  check("confluenceBriefHtml_: brief sections render without narrative",
    bhtml.indexOf("Executive summary") !== -1 &&
    bhtml.indexOf("AI synthesis not generated") !== -1 &&
    bhtml.indexOf("Decisions for the board") !== -1);
  // Docs-as-config appendix (decision 2026-07-23): both views publish the
  // exact applied rules — remap tables, lever classes, thresholds.
  [html, bhtml].forEach((h, i) => {
    const which = i === 0 ? "report" : "brief";
    check("definitions appendix on the " + which + " copy",
      h.indexOf("Data definitions (generated from configuration)") !== -1 &&
      h.indexOf("<td>Managed Services</td><td>Services</td>") !== -1 &&
      h.indexOf("<td>Attendance</td><td>Unsatisfactory Performance</td>") !== -1 &&
      h.indexOf("Microband Promotion") !== -1);
  });
  check("definitions appendix: thresholds echo config values",
    html.indexOf(CONFIG_WR.RISK_REGRET_PCT + "%") !== -1 &&
    html.indexOf("I" + CONFIG_WR.SENIOR_IC_MIN + "+") !== -1);
})();

// ── Structural risks + retention crosstab + spotlights — spec §7 ────────────
(function () {
  const fys = fyListWR_(REF, 3);
  const ctx = { asOf: REF };
  // 10 actives: 5 in Consulting (50% ≥ 40% threshold), all hired ≥ 5y ago.
  const active = [];
  for (let i = 0; i < 5; i++) active.push(mkEmp({ dept: "Consulting", hireDate: new Date(2015, 0, 1) }));
  for (let i = 0; i < 3; i++) active.push(mkEmp({ dept: "R&D", hireDate: new Date(2015, 0, 1) }));
  for (let i = 0; i < 2; i++) active.push(mkEmp({ dept: "Sales", hireDate: new Date(2015, 0, 1) }));
  // 4 current-FY exits, 2 at I3/I4 (50% ≥ 40%).
  const exits = [
    term({ termDate: new Date(2026, 6, 5), level: "I3", termRegretted: "Yes",
           termReason: "Better offer", hireDate: new Date(2024, 6, 1) }),
    term({ termDate: new Date(2026, 6, 6), level: "I4", jobTitle: "04.I4.1", termRegretted: "Yes",
           termReason: "Better offer", hireDate: new Date(2024, 6, 1) }),
    term({ termDate: new Date(2026, 6, 7), level: "M5", jobTitle: "04.M5.1" }),
    term({ termDate: new Date(2026, 6, 8), level: "M6", jobTitle: "04.M6.1" }),
  ];
  const records = active.concat(exits);
  const cs = { inversions: [{ mLevel: "M4", mAvg: 5000, icLevel: "I5", icAvg: 6000 }] };
  const risks = buildStructuralRisks_(active, records, fys, ctx, CONFIG_WR, cs, "USD");
  const ids = risks.map(r => r.id);
  check("risks: inversion candidate emitted", ids.indexOf("inversion-M4-I5") !== -1);
  check("risks: function concentration at 50%", ids.indexOf("func-concentration") !== -1);
  check("risks: tenure concentration at 100% ≥5y", ids.indexOf("tenure-concentration") !== -1);
  check("risks: mid-level flight at 2 of 4 exits", ids.indexOf("midlevel-flight") !== -1);
  check("risks: candidates carry templated detail",
    risks.find(r => r.id === "func-concentration").detail.indexOf("5 of 10") !== -1);

  const belowThresh = buildStructuralRisks_(
    active, active.concat(exits.slice(0, 2)), fys, ctx, CONFIG_WR, { inversions: [] }, "USD");
  check("risks: mid-level share below MIN_EXITS stays silent",
    belowThresh.every(r => r.id !== "midlevel-flight"));
  check("risks: inversion detail states the scope currency",
    risks.find(r => r.kind === "inversion").detail.indexOf("USD") !== -1);

  const xt = buildRetentionCrosstab_(records, fys);
  check("crosstab: regretted-only, level × tenure × reason",
    xt.length === 1 && xt[0].count === 2 || (xt.length === 2 && xt[0].count === 1));
  check("crosstab: reason + bucket populated",
    xt.every(r => r.reason === "Better offer" && r.tenureBucket === "1–3y"));

  const LOC_DIM = { field: "keyLocation", label: "Location" };
  const USD_MODE = { mode: "usd", code: "USD" };
  const spots = buildSpotlights_(records, {}, fys, ctx, CONFIG_WR, LOC_DIM, USD_MODE);
  check("spotlights: one row per active location", spots.length === 1 && spots[0].key === "Mexico");
  check("spotlights: regretted candidate fires at 50% ≥ 60%? no — 2 of 4 = 50% < 60%",
    spots[0].candidates.every(c => c.indexOf("Regretted share") === -1));
  check("spotlights: candidates never empty", spots[0].candidates.length >= 1);
  // Department dimension (single-country brief): same records, grouped by dept.
  const dSpots = buildSpotlights_(records, {}, fys, ctx, CONFIG_WR,
    { field: "dept", label: "Department" }, USD_MODE);
  check("spotlights: department dimension groups by dept",
    dSpots.length >= 1 && dSpots.every(s => ["Consulting", "R&D", "Sales", "Services"].indexOf(s.key) !== -1));
})();

// ── AI narrative validation: verbatim-candidate enforcement — spec §8 ───────
(function () {
  const brief = { spotlights: [
    { key: "Chile", candidates: ["Attrition above the scope rate (10.0% vs 8.0%).", "Steady state — no computed flag this period."] },
    { key: "Mexico", candidates: ["Steady state — no computed flag this period."] },
  ] };
  const good = validateNarrative_({
    execSummary: ["Signal one.", "Signal two.", "Signal three."],
    spotlightFlags: { Chile: "Attrition above the scope rate (10.0% vs 8.0%).",
                      Mexico: "An invented risk the model made up." },
    decisions: [{ title: "Fund a retention pool", rationale: "Because of the 10.0% rate." },
                { title: "", rationale: "dropped" }, { junk: true }],
  }, brief);
  check("narrative: verbatim flag kept", good.spotlightFlags.Chile.indexOf("Attrition above") === 0);
  check("narrative: invented flag replaced by first computed candidate",
    good.spotlightFlags.Mexico === "Steady state — no computed flag this period.");
  check("narrative: junk decisions dropped, valid kept",
    good.decisions.length === 1 && good.decisions[0].title === "Fund a retention pool");
  check("narrative: exec summary capped and clean", good.execSummary.length === 3);
  check("narrative: garbage input → null", validateNarrative_(null, brief) === null &&
    validateNarrative_({ execSummary: [], decisions: [] }, brief) === null);
})();

// ── Quarterly filter: fyQuarterWindow_ + windowed payload ───────────────────
(function () {
  const fys = fyListWR_(REF, 3); // asOf 2026-07-21 → FY27 Q1 in progress
  const q1_25 = fyQuarterWindow_(fys[0], 1, REF);
  check("qwin: FY25 Q1 = Jul 1 – Sep 30 2024",
    q1_25.label === "FY25 Q1" &&
    q1_25.start.getFullYear() === 2024 && q1_25.start.getMonth() === 6 && q1_25.start.getDate() === 1 &&
    q1_25.end.getFullYear() === 2024 && q1_25.end.getMonth() === 8 && q1_25.end.getDate() === 30);
  const q3_25 = fyQuarterWindow_(fys[0], 3, REF);
  check("qwin: Q3 spans the calendar-year change (Jan–Mar)",
    q3_25.start.getFullYear() === 2025 && q3_25.start.getMonth() === 0 &&
    q3_25.end.getMonth() === 2 && q3_25.end.getDate() === 31);
  const q4_25 = fyQuarterWindow_(fys[0], 4, REF);
  check("qwin: Q4 = Apr 1 – Jun 30", q4_25.start.getMonth() === 3 &&
    q4_25.end.getMonth() === 5 && q4_25.end.getDate() === 30);
  const q1_27 = fyQuarterWindow_(fys[2], 1, REF);
  const q2_27 = fyQuarterWindow_(fys[2], 2, REF);
  check("qwin: FY27 Q1 started + in progress on Jul 21",
    q1_27.started === true && q1_27.inProgress === true);
  check("qwin: FY27 Q2 not started yet ('if any' rule)",
    q2_27.started === false && q2_27.inProgress === false);
  check("qwin: closed-FY quarters never flag in progress",
    q1_25.started === true && q1_25.inProgress === false);

  const ctx = { asOf: REF };
  const records = [
    mkEmp({}), mkEmp({}), mkEmp({}),
    term({ termDate: new Date(2024, 7, 15) }),   // FY25 Q1 exit (Aug 2024)
    term({ termDate: new Date(2025, 1, 10) }),   // FY25 Q3 exit (Feb 2025)
    term({ termDate: new Date(2026, 6, 5) }),    // FY27 Q1 exit (Jul 2026)
  ];
  const p1 = buildReportPayload_(records, {}, {}, "company", ctx, CONFIG_WR, 1);
  const mv1 = p1.report.sections.find(s => s.id === "movement");
  check("qpayload: Q1 movement rows labeled per FY-quarter",
    mv1.tables[0].rows.length === 3 && String(mv1.tables[0].rows[0][0]).indexOf("FY25 Q1") === 0);
  check("qpayload: Q1 exits land in the right windows",
    mv1.tables[0].rows[0][2] === 1 && mv1.tables[0].rows[1][2] === 0 && mv1.tables[0].rows[2][2] === 1);
  check("qpayload: meta echoes the quarter, nothing skipped for Q1",
    p1.meta.quarter === 1 && p1.meta.quarterSkipped.length === 0);
  check("qpayload: quarterly company view drops the brief", p1.brief === undefined);
  check("qpayload: in-progress NOTE names the quarter window",
    mv1.lines.some(l => l.badge === "NOTE" && l.text.indexOf("FY27 Q1 in progress") !== -1));

  const p3 = buildReportPayload_(records, {}, {}, "company", ctx, CONFIG_WR, 3);
  const mv3 = p3.report.sections.find(s => s.id === "movement");
  check("qpayload: Q3 drops the not-started FY27 window",
    mv3.tables[0].rows.length === 2 && p3.meta.quarterSkipped.join() === "FY27 Q3");
  check("qpayload: FY25 Q3 exit counted", mv3.tables[0].rows[0][2] === 1);

  const pAll = buildReportPayload_(records, {}, {}, "company", ctx, CONFIG_WR, 0);
  check("qpayload: quarter 0 keeps full FYs + brief",
    pAll.meta.quarter === 0 && pAll.brief != null &&
    pAll.report.sections.find(s => s.id === "movement").tables[0].rows.length === 3);
})();

// ── End-to-end payload shape — spec §3 ──────────────────────────────────────
(function () {
  const ctx = { asOf: REF };
  const records = [
    mkEmp({ keyLocation: "Chile", currency: "CLP" }),
    mkEmp({ keyLocation: "Chile", currency: "CLP" }),
    mkEmp({ keyLocation: "Chile", currency: "CLP" }),
    mkEmp({ keyLocation: "Mexico" }),
    term({ keyLocation: "Mexico", termDate: new Date(2026, 6, 3), termRegretted: "Yes" }),
  ];
  const hist = { E1: [{ date: new Date(2024, 6, 15), reason: "Annual Adjustment", tcc: 90000 }] };

  const company = buildReportPayload_(records, hist, {}, "company", ctx, CONFIG_WR);
  check("payload: company carries brief + 7 sections",
    company.ok && company.brief != null && company.report.sections.length === 7);
  check("payload: meta FY labels", company.meta.fys.map(f => f.label).join() === "FY25,FY26,FY27");
  check("payload: company currency is USD", company.report.currency.mode === "usd");
  check("payload: scopes sorted", company.meta.scopes.join() === "Chile,Mexico");
  check("payload: appendix mirrors scopes", company.brief.appendix.join() === "Chile,Mexico");
  check("payload: sections all carry FAR/N lines",
    company.report.sections.every(s => s.lines.length > 0 &&
      s.lines.every(l => ["FACT", "ASSUMPTION", "RISK", "NOTE"].indexOf(l.badge) !== -1)));
  // De-hedged sections (user directive 2026-07-22): the reason domain is a
  // known closed set, so 2/4/6 carry definitions as NOTEs, never ASSUMPTIONs.
  check("payload: composition, movement and levers carry no ASSUMPTION lines",
    ["composition", "movement", "levers"].every(id =>
      company.report.sections.find(s => s.id === id)
        .lines.every(l => l.badge !== "ASSUMPTION")));

  check("payload: company brief spotlights by location",
    company.brief.dim.field === "keyLocation" && company.brief.currency.code === "USD");

  const chile = buildReportPayload_(records, hist, {}, "Chile", ctx, CONFIG_WR);
  check("payload: single-currency location stays local",
    chile.report.currency.mode === "local" && chile.report.currency.code === "CLP");
  check("payload: location scope excludes other locations",
    chile.report.sections[0].lines[0].text.indexOf("3 active regular employees") !== -1);
  check("scope NOTE: location scope explains current-Key-Location semantics",
    chile.report.sections[0].lines.some(l => l.badge === "NOTE" &&
      l.text.indexOf("CURRENT Key Location") !== -1));
  check("scope NOTE: company scope carries no transfer note",
    company.report.sections[0].lines.every(l =>
      l.text.indexOf("CURRENT Key Location") === -1));
  // Single-country board brief — the Chile sample.
  check("payload: country brief present, spotlights by department, local currency",
    chile.brief != null && chile.brief.scope === "Chile" &&
    chile.brief.dim.field === "dept" && chile.brief.currency.code === "CLP");
  check("payload: country brief glance counts scope only",
    chile.brief.glance.headcount === 3 &&
    chile.brief.glance.byLocation.length === 1);
  check("payload: country brief appendix still lists every scope",
    chile.brief.appendix.join() === "Chile,Mexico");
  check("payload: country brief spotlight rows are departments",
    chile.brief.spotlights.every(s => s.key === "Services"));

  // FY comparison range — manager view: previous + current, or current only.
  const two = buildReportPayload_(records, hist, {}, "company", ctx, CONFIG_WR, 0, 2);
  check("payload: fyCount 2 = previous + current FY",
    two.meta.fys.map(f => f.label).join() === "FY26,FY27" && two.meta.fyCount === 2);
  check("payload: fyCount 2 movement table carries two rows",
    two.report.sections.find(s => s.id === "movement").tables[0].rows.length === 2);
  check("payload: fyCount 2 brief trend matches the range",
    two.brief.movement.regrettedTrend.map(t => t.label).join() === "FY26,FY27");
  const one = buildReportPayload_(records, hist, {}, "company", ctx, CONFIG_WR, 0, 1);
  check("payload: fyCount 1 = current FY only",
    one.meta.fys.map(f => f.label).join() === "FY27" && one.brief != null);
  const bad = buildReportPayload_(records, hist, {}, "company", ctx, CONFIG_WR, 0, 9);
  check("payload: out-of-range fyCount falls back to all FYs", bad.meta.fyCount === 3);

  // Closed-years view — the FY25–FY26 board-deck range (no in-progress noise).
  const closed = buildReportPayload_(records, hist, {}, "company", ctx, CONFIG_WR, 0, "c2");
  check("payload: c2 = the two closed FYs",
    closed.meta.fys.map(f => f.label).join() === "FY25,FY26" &&
    closed.meta.fyRange === "c2" && closed.meta.fyCount === 2);
  check("payload: c2 has no in-progress window (no as-of NOTE)",
    closed.meta.fys.every(f => !f.inProgress) &&
    closed.report.sections.find(s => s.id === "movement")
      .lines.every(l => l.text.indexOf("in progress") === -1));
  check("payload: c2 keeps the brief and two movement rows",
    closed.brief != null &&
    closed.report.sections.find(s => s.id === "movement").tables[0].rows.length === 2);
})();
