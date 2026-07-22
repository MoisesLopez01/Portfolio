# CompDash Internal Position V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework CompDash's Internal Position to peer-median compa with tiered anchors (title median → market mean for N-of-1 → level cohort), integrate the Benchmarking market file (live Market Gap tab) and Small Improvements ratings, compute a config-weighted Priority Score, and make tabs + filters + name search sticky and universal with client-side filtered recompute.

**Architecture:** All new math lands in the PURE LOGIC section of `CompDash/Code.js` (Node-testable, no GAS APIs), two new GAS readers + assembly changes in the GAS LAYER, and the SPA rework in `CompDash/ViewDash.html`. Two pure functions (`fyAttritionFromPeople_`, `sliceAttritionFromPeople_`) are designed to be string-comparison-only so the client copies them verbatim (marked mirrors) for filtered attrition recompute.

**Tech Stack:** Google Apps Script (V8), vanilla-JS SPA via HtmlService, Node test runner (`CompDash/tests/run_tests.js` evals Code.js + cases.js together; `parse_html.js` syntax-checks the HTML script block).

**Spec:** `docs/superpowers/specs/2026-07-22-compdash-internal-position-v2-design.md`

**Conventions that bind every task:**
- Pure functions above the `GAS LAYER` marker in Code.js; nothing below it is Node-tested.
- Header-name column access only, never positional. `normCD_` for all name/key normalization.
- Test commands: `node CompDash/tests/run_tests.js` (pure logic) and `node CompDash/tests/parse_html.js` (HTML script parses). Run BOTH after any frontend task.
- Test dates: use mid-month dates (e.g. the 10th–20th) in new attrition/tenure cases — `isoDate_` uses UTC getters on local Dates, so month-boundary dates can shift a day on non-UTC machines.
- Commit after every task. Repo stays local — never push.

---

## File map

| File | Changes |
|---|---|
| `CompDash/Code.js` | CONFIG_CD additions + band constants swap; new pure engines (ratings, tenure, TTM growth, benchmark lookup, anchor tiers, priority score, people projection, people-shape attrition); 2 new readers; assembly + debug additions; VERSION → 1.1.0 |
| `CompDash/ViewDash.html` | Sticky bar (header+tabs+filterbar), global filters + name search, Internal Position V2 (ranking + tier badges + 4 bands), live Market Gap, filtered recompute in Overview/Attrition/Equity/QTA, drill additions, Data Reference update |
| `CompDash/tests/cases.js` | Rewrite the V1 `buildCompaGroups_` block; append V2 blocks (Tasks 1–7) |

---

### Task 1: Config V2 (sources, bands, weights)

**Files:**
- Modify: `CompDash/Code.js` (CONFIG_CD, lines ~13–44)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests** — append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL — `PRIORITY_W` undefined (TypeError reading `.perf`) or `❌ cfg:` lines.

- [ ] **Step 3: Implement.** In `CompDash/Code.js`, replace the two old band constants and add the new blocks. Delete:

```js
  // Internal Position color bands — shipped to the client via meta.compaBands
  // so ratioClass() and the Data Reference prose can never drift from these.
  COMPA_GREEN_MIN:  0.90, // ratio ≥ this renders green
  COMPA_YELLOW_MIN: 0.75, // ratio ≥ this renders yellow; below is red
```

Insert in its place:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: PASS (77 + 7 new). Note: the V1 compa block still passes — `buildCompaGroups_` is untouched until Task 5.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): CONFIG_CD V2 — bench/ratings sources, 4-band compa, priority weights"
```

---

### Task 2: Ratings aggregation — `buildPerfForEmp_`

**Files:**
- Modify: `CompDash/Code.js` (PURE LOGIC — insert after the Growth engine section, before Pay Equity)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
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
```

- [ ] **Step 2: Run** `node CompDash/tests/run_tests.js` — Expected: FAIL, `buildPerfForEmp_ is not defined`.

- [ ] **Step 3: Implement** — insert into Code.js pure section:

```js
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
```

- [ ] **Step 4: Run** `node CompDash/tests/run_tests.js` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): ratings aggregation — buildPerfForEmp_ (avg/latest/history)"
```

---

### Task 3: Tenure + TTM growth — `profileTenureYears_`, `ttmGrowth_`

**Files:**
- Modify: `CompDash/Code.js` (PURE LOGIC — insert right after `tenureYears_`)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL, `profileTenureYears_ is not defined`.

- [ ] **Step 3: Implement** — insert after `tenureYears_` in Code.js:

```js
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
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): profile tenure from RD promo events + trailing-12m TCC growth"
```

---

### Task 4: Benchmark lookup — `benchKey_`, `lookupBench_`

**Files:**
- Modify: `CompDash/Code.js` (PURE LOGIC — insert right above `marketSuggestion_`)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL, `benchKey_ is not defined`.

- [ ] **Step 3: Implement** — insert above `marketSuggestion_` in Code.js:

```js
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
```

Also update the stale comment above `marketSuggestion_` (it still says "used once Payscale data lands" with a client-drift TODO). Replace that comment block with:

```js
// ── Market suggestion — runs SERVER-SIDE per employee (V2) ──────────────────
// p50 slot carries the benchmark MEAN (labeled "Mean" in the UI, never P50).
// Red = raise to P25 is the priority read; yellow = move to mean; green = at market.
```

- [ ] **Step 4: Run** — Expected: PASS (existing `marketSuggestion_` tests unchanged and still green).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): benchmark key/lookup with currency-mismatch guard"
```

---

### Task 5: Anchor engine V2 — rewrite `buildCompaGroups_`

**Files:**
- Modify: `CompDash/Code.js:239-270` (`buildCompaGroups_`) and its section comment at 232–237
- Modify: `CompDash/tests/cases.js:125-150` (the V1 compa block asserts the max anchor — rewrite it)

- [ ] **Step 1: Replace the V1 test block.** In `cases.js`, delete the body of the `// ── Task 4: buildCompaGroups_ / marketSuggestion_` IIFE **except** the four `marketSuggestion_` checks (keep those verbatim), and write the new compa checks:

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL (old signature `(activeRecords, smallGroupMin)`, `bench` object passed where a number was; `anchor`/`anchorTier` undefined).

- [ ] **Step 3: Rewrite `buildCompaGroups_`** (replace the whole function AND its section comment):

```js
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
  const cohorts = new Map(); // "keyLocation||level" → tcc[]
  activeRecords.forEach(r => {
    if (!(r.tcc > 0) || !r.level || r.level === "—") return;
    const k = (r.keyLocation || "—") + "||" + r.level;
    if (!cohorts.has(k)) cohorts.set(k, []);
    cohorts.get(k).push(r.tcc);
  });
  const map = new Map();
  activeRecords.forEach(r => {
    const key = (r.keyLocation || "—") + "||" + (r.jobTitle || "—");
    if (!map.has(key)) {
      map.set(key, { keyLocation: r.keyLocation || "—", jobTitle: r.jobTitle || "—",
                     level: r.level, currency: r.currency || "", members: [], missingTcc: 0 });
    }
    const g = map.get(key);
    if (r.tcc == null || r.tcc <= 0) { g.missingTcc++; return; }
    g.members.push(r);
  });
  return [...map.values()].map(g => {
    const count = g.members.length;
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
        .sort((a, b) => (a.ratio == null) - (b.ratio == null) || a.ratio - b.ratio),
    };
  }).sort((a, b) =>
    a.keyLocation.localeCompare(b.keyLocation) || a.jobTitle.localeCompare(b.jobTitle));
}
```

Note: `median_` is currently defined BELOW `buildCompaGroups_` (in the Pay Equity section). Function declarations hoist within the eval scope, so no move is required — but verify the test run passes; if you prefer, move `median_` up next to `asNum_` (cosmetic, optional).

- [ ] **Step 4: Run** — Expected: PASS. The compa checks from the old block are gone; new tier checks green.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): anchor engine V2 — tiered title-median/market-mean/level-cohort anchors"
```

---

### Task 6: Priority Score — `priorityScore_`

**Files:**
- Modify: `CompDash/Code.js` (PURE LOGIC — insert after the ratings engine from Task 2)
- Test: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests:**

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL, `priorityScore_ is not defined`.

- [ ] **Step 3: Implement:**

```js
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
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): priority score composite with weight redistribution"
```

---

### Task 7: People projection + client-mirrorable attrition — `personLite_`, `fyAttritionFromPeople_`, `sliceAttritionFromPeople_`

**Files:**
- Modify: `CompDash/Code.js` (PURE LOGIC — insert after `buildAttrition_`)
- Test: `CompDash/tests/cases.js` (append)

These two attrition functions operate ONLY on ISO date strings (lexicographic compare) so ViewDash.html can carry byte-identical copies for filtered recompute. Parity with the Date-based server engine is asserted here.

- [ ] **Step 1: Write the failing tests** (reuses `mkEmp` defined earlier in cases.js):

```js
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
```

- [ ] **Step 2: Run** — Expected: FAIL, `personLite_ is not defined`.

- [ ] **Step 3: Implement** — insert after `buildAttrition_` in Code.js:

```js
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
```

- [ ] **Step 4: Run** — Expected: PASS (parity checks green). If a monthly-bucket parity check fails on your machine, check the machine timezone: positive-UTC-offset zones shift `isoDate_` a day back for local-midnight dates. Fix the TEST DATES to mid-month (never the implementation).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): people[] projection + string-date attrition for client parity"
```

---

### Task 8: GAS readers — `readRatings_`, `readBenchmarks_`, `ssIds_` additions

**Files:**
- Modify: `CompDash/Code.js` — `ssIds_()` (~line 445) and after `readCompHistory_` (~line 629)

GAS-layer code — not exercised by Node tests, but the eval must still parse.

- [ ] **Step 1: Extend `ssIds_()`** — replace the function with:

```js
function ssIds_() {
  const p = props_();
  return {
    roster:     p.getProperty("CD_ROSTER_SS_ID")    || CONFIG_CD.ROSTER_SS_ID,
    hist:       p.getProperty("CD_COMP_HIST_SS_ID") || CONFIG_CD.COMP_HIST_SS_ID,
    ratings:    p.getProperty("CD_RATINGS_SS_ID")   || CONFIG_CD.RATINGS_SS_ID,
    bench:      p.getProperty("CD_BENCH_SS_ID")     || CONFIG_CD.BENCH_SS_ID,
    rosterTab:  p.getProperty("CD_ROSTER_TAB")      || CONFIG_CD.ROSTER_TAB,
    histTab:    p.getProperty("CD_HIST_TAB")        || CONFIG_CD.HIST_TAB,
    ratingsTab: p.getProperty("CD_RATINGS_TAB")     || CONFIG_CD.RATINGS_TAB,
    benchTab:   p.getProperty("CD_BENCH_TAB")       || CONFIG_CD.BENCH_TAB,
  };
}
```

- [ ] **Step 2: Add the readers** after `readCompHistory_`:

```js
/** @returns {{byEmp: Object<string, Array>, count: number}} Small Improvements ratings by Employee Number. */
function readRatings_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.ratings, ids.ratingsTab);
  const iId   = colIdx_(headers, "ID");
  const iFq   = colIdx_(headers, "Fiscal Quarter");
  const iRate = colIdx_(headers, "Rate");
  const iExp  = colIdx_(headers, "Rating Explanation");
  if (iId === -1 || iFq === -1 || iRate === -1) {
    Logger.log("❌ readRatings_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Ratings tab: required columns missing (see execution log).");
  }
  const byEmp = {};
  let count = 0;
  rows.forEach(row => {
    const emp = String(row[iId] || "").trim();
    const rate = asNum_(row[iRate]);
    if (!emp || rate == null) return;
    if (!byEmp[emp]) byEmp[emp] = [];
    byEmp[emp].push({
      fq: String(row[iFq] || "").trim(),
      rate,
      explanation: iExp !== -1 ? String(row[iExp] || "").trim() : "",
    });
    count++;
  });
  log_("readRatings_: " + count + " ratings across " + Object.keys(byEmp).length + " employees");
  return { byEmp, count };
}

/**
 * @returns {{map: Object, count: number}} benchmark rows keyed by
 * benchKey_(Location, Job Title). LOCAL currency values; partial rows (no Mean
 * but P25/P75 present) are kept — the compilation grows over time.
 */
function readBenchmarks_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.bench, ids.benchTab);
  const iLoc   = colIdx_(headers, "Location");
  const iTitle = colIdx_(headers, "Job Title");
  const iCur   = colIdx_(headers, "Local Currency");
  const iP25   = colIdx_(headers, "25th Percentile TCC", /25th/i);
  const iMean  = colIdx_(headers, "Mean TCC", /mean/i);
  const iP75   = colIdx_(headers, "75th Percentile TCC", /75th/i);
  const iSrc   = colIdx_(headers, "Source or Website", /source/i);
  if (iLoc === -1 || iTitle === -1 || iMean === -1) {
    Logger.log("❌ readBenchmarks_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Benchmark tab: required columns missing (see execution log).");
  }
  const map = {};
  let count = 0;
  rows.forEach(row => {
    const loc = String(row[iLoc] || "").trim();
    const title = String(row[iTitle] || "").trim();
    if (!loc || !title) return;
    const p25  = iP25 !== -1 ? asNum_(row[iP25]) : null;
    const mean = asNum_(row[iMean]);
    const p75  = iP75 !== -1 ? asNum_(row[iP75]) : null;
    if (mean == null && p25 == null && p75 == null) return; // nothing usable yet
    map[benchKey_(loc, title)] = {
      p25, mean, p75,
      currency: iCur !== -1 ? String(row[iCur] || "").trim() : "",
      source:   iSrc !== -1 ? String(row[iSrc] || "").trim() : "",
    };
    count++;
  });
  log_("readBenchmarks_: " + count + " benchmark rows");
  return { map, count };
}
```

- [ ] **Step 3: Run both checks** — `node CompDash/tests/run_tests.js` (still parses + passes) — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): readRatings_ + readBenchmarks_ readers with property overrides"
```

---

### Task 9: Assembly — wire everything into `getCompReportData` + `debugCompPipeline`

**Files:**
- Modify: `CompDash/Code.js` — header VERSION (line 5) → `1.1.0`; `getCompReportData` (~lines 643–721); `debugCompPipeline` (~lines 739–761)

- [ ] **Step 1: Replace the build section of `getCompReportData`.** Keep the access check + cache read exactly as-is. Replace everything from `const t0 = Date.now();` down to (and including) the `payload` literal with:

```js
  const t0 = Date.now();
  const ctx = fiscalContextCD_();
  const sources = { roster: "ok", history: "ok", ratings: "ok", benchmarks: "ok" };

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
  let ratings = { byEmp: {}, count: 0 };
  try { ratings = readRatings_(); }
  catch (e) { sources.ratings = "error: " + e.message; Logger.log("⚠️ readRatings_: " + e.message); }
  let bench = { map: {}, count: 0 };
  try { bench = readBenchmarks_(); }
  catch (e) { sources.benchmarks = "error: " + e.message; Logger.log("⚠️ readBenchmarks_: " + e.message); }

  const active = records.filter(r => r.active);

  const perfByEmp = {};
  active.forEach(r => {
    if (ratings.byEmp[r.empNo]) perfByEmp[r.empNo] = buildPerfForEmp_(ratings.byEmp[r.empNo]);
  });

  const compaGroups = buildCompaGroups_(active, bench.map, CONFIG_CD);
  const anchorByEmp = {};
  compaGroups.forEach(g => g.members.forEach(m => {
    anchorByEmp[m.empNo] = { ratio: m.ratio, anchor: g.anchor, anchorTier: g.anchorTier };
  }));

  let matchedBench = 0, currencyMismatch = 0;
  const employees = active.map(r => {
    const a = anchorByEmp[r.empNo] || { ratio: null, anchor: null, anchorTier: "none" };
    const perf = perfByEmp[r.empNo] || null;
    const b = lookupBench_(bench.map, r.keyLocation, r.jobTitle, r.currency);
    if (b.mismatch) currencyMismatch++;
    if (b.row) matchedBench++;
    const row = b.row;
    const companyYears = r.hireDate
      ? Math.round(tenureYears_(r.hireDate, ctx.asOf) * 10) / 10 : null;
    const profileYears = profileTenureYears_(histByEmp[r.empNo], r.hireDate, ctx.asOf, CONFIG_CD.PROMO_RE);
    return {
      empNo: r.empNo, name: r.name, jobTitle: r.jobTitle, level: r.level, track: r.track,
      dept: r.dept, keyLocation: r.keyLocation, currency: r.currency,
      tcc: r.tcc, tccUsd: r.tccUsd, hireDate: isoDate_(r.hireDate), gender: r.gender,
      ratio: a.ratio, anchor: a.anchor, anchorTier: a.anchorTier,
      p25: row ? row.p25 : null,
      p50: row ? row.mean : null, // MEAN in the p50 slot — UI labels it "Mean", never P50
      p75: row ? row.p75 : null,
      benchSource: row ? row.source : "",
      marketRatio: (row && row.mean > 0 && r.tcc > 0)
        ? Math.round(r.tcc / row.mean * 1000) / 1000 : null,
      suggestion: marketSuggestion_(r.tcc, row ? row.p25 : null, row ? row.mean : null),
      perfAvg: perf ? perf.avg : null, perfLatest: perf ? perf.latest : null,
      perfCount: perf ? perf.count : 0,
      tenureCompanyYears: companyYears, tenureProfileYears: profileYears,
      ttmGrowthPct: ttmGrowth_(histByEmp[r.empNo], r.tcc, ctx.asOf),
      priority: priorityScore_({
        perfAvg: perf ? perf.avg : null, perfCount: perf ? perf.count : 0,
        companyYears, profileYears, ratio: a.ratio,
      }, CONFIG_CD),
    };
  });

  const history = {};
  active.forEach(r => {
    const g = histByEmp[r.empNo]
      ? buildGrowthForEmp_(histByEmp[r.empNo])
      : { events: [], overallAnnualized: null };
    const perf = perfByEmp[r.empNo] || null;
    if (g.events.length || perf) {
      history[r.empNo] = { events: g.events, overallAnnualized: g.overallAnnualized,
                           ratings: perf ? perf.history : [] };
    }
  });

  const payload = {
    ok: true,
    meta: {
      generatedAt: new Date().toISOString(),
      role: access.role, email: access.email, fromCache: false,
      fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel, qLabel: ctx.qLabel,
      monthLabels: ctx.monthLabels,
      fiscalMonthIdx: fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear),
      fyStartCalYear: ctx.fyStartCalYear, asOf: isoDate_(ctx.asOf),
      sources, genderAvailable, tccUsdAvailable,
      activeCount: active.length,
      ratingsCount: ratings.count,
      benchCoverage: { rows: bench.count, matchedEmployees: matchedBench, currencyMismatch },
      contribUrl: props_().getProperty("CD_CONTRIB_URL") || "",
      // Threshold echoes — the client colors and documents from these, never
      // from its own literals, so UI text can't drift from CONFIG_CD.
      compaBands: { low: CONFIG_CD.COMPA_LOW_MIN, target: CONFIG_CD.COMPA_TARGET_MIN,
                    high: CONFIG_CD.COMPA_HIGH_MAX },
      marketLow: CONFIG_CD.MARKET_LOW,
      priorityCfg: { weights: CONFIG_CD.PRIORITY_W, caps: CONFIG_CD.PRIORITY_CAPS,
                     ratingMax: CONFIG_CD.RATING_MAX },
      equityCfg: {
        gapPct: CONFIG_CD.EQUITY_GAP_PCT, outlierPct: CONFIG_CD.EQUITY_OUTLIER_PCT,
        tenureYearsMin: CONFIG_CD.TENURE_YEARS_MIN, tenureBelowPct: CONFIG_CD.TENURE_BELOW_PCT,
        smallGroupMin: CONFIG_CD.SMALL_GROUP_MIN,
      },
    },
    employees,
    people: records.map(personLite_),
    attrition: buildAttrition_(records, ctx),
    compaGroups,
    equity: buildEquity_(active, CONFIG_CD, ctx.asOf),
    qtaInterim: buildQtaInterim_(active, histByEmp, ctx.asOf),
    history,
  };
```

- [ ] **Step 2: Extend `debugCompPipeline`** — append before the closing brace:

```js
  let ratings = { byEmp: {}, count: 0 };
  try { ratings = readRatings_(); }
  catch (e) { Logger.log("⚠️ readRatings_ (debug): " + e.message); }
  const perfHits = active.filter(x => ratings.byEmp[x.empNo]).length;
  Logger.log("Ratings join: " + perfHits + "/" + active.length + " active matched, " +
             ratings.count + " rating rows total");
  let bench = { map: {}, count: 0 };
  try { bench = readBenchmarks_(); }
  catch (e) { Logger.log("⚠️ readBenchmarks_ (debug): " + e.message); }
  let benchHits = 0, mism = 0;
  active.forEach(x => {
    const b = lookupBench_(bench.map, x.keyLocation, x.jobTitle, x.currency);
    if (b.row) benchHits++;
    if (b.mismatch) mism++;
  });
  Logger.log("Benchmark coverage: " + bench.count + " rows, " + benchHits + "/" + active.length +
             " active matched, " + mism + " currency mismatches");
  const groupsV2 = buildCompaGroups_(active, bench.map, CONFIG_CD);
  const tiers = { title: 0, market: 0, level: 0, none: 0 };
  groupsV2.forEach(g => { tiers[g.anchorTier] = (tiers[g.anchorTier] || 0) + 1; });
  Logger.log("Anchor tiers: title " + tiers.title + " · market " + tiers.market +
             " · level " + tiers.level + " · none " + tiers.none);
```

Also DELETE the old `const groups = buildCompaGroups_(active, CONFIG_CD.SMALL_GROUP_MIN);` block at the end of `debugCompPipeline` (its "Compa groups:" log) — `groupsV2` supersedes it (keep a singleton count log if desired: `groupsV2.filter(g => g.count === 1).length`).

- [ ] **Step 3: Bump the file header** — `VERSION: 1.0.0` → `VERSION: 1.1.0`.

- [ ] **Step 4: Run** `node CompDash/tests/run_tests.js` — Expected: PASS (assembly is GAS-layer; this catches syntax errors).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): assembly V2 — ratings/bench/anchors/priority/people in payload, debug coverage"
```

---

### Task 10: ViewDash — sticky bar, universal filters, name search

**Files:**
- Modify: `CompDash/ViewDash.html` — CSS block, body structure, STATE + helpers, `renderCompa` filter removal comes in Task 11

- [ ] **Step 1: CSS.** In `:root`, add `--above: #9d7bff;` after the `--bad` line. Change the `header` rule: remove `position: sticky; top: 0; z-index: 20;` (keep everything else). Add after the `nav` rules:

```css
    #stickyBar { position: sticky; top: 0; z-index: 20; background: var(--bg); }
    .filterbar { display: flex; gap: 8px; padding: 8px 18px 10px; flex-wrap: wrap; align-items: center; border-bottom: 1px solid var(--border); }
    .filterbar input[type=search] { background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font: inherit; min-width: 190px; }
    .chip.violet { border-color: var(--above); color: var(--above); }
```

- [ ] **Step 2: Body structure.** Wrap the existing `<header>…</header>` and `<nav id="tabbar"></nav>` in a sticky container and add the filter bar between nav and `</div>`:

```html
<div id="stickyBar">
<header>
  …existing header content unchanged…
</header>
<nav id="tabbar"></nav>
<div class="filterbar">
  <select id="fLoc" onchange="setFilter('loc', this.value)"></select>
  <select id="fLevel" onchange="setFilter('level', this.value)"></select>
  <select id="fDept" onchange="setFilter('dept', this.value)"></select>
  <input id="fQ" type="search" placeholder="🔎 Find a Rocketeer…" oninput="setFilter('q', this.value)">
  <button id="fClear" class="hidden" onclick="clearFilters()">✕ Clear</button>
  <span class="sub" id="fNote"></span>
</div>
</div>
```

- [ ] **Step 3: STATE + helpers.** In the `STATE` literal, replace `compaFilters: { loc: "", level: "", dept: "" },` with:

```js
  filters: { loc: "", level: "", dept: "", q: "" },
  rankSort: { key: "score", dir: -1 },
```

Add after the `esc()` helper:

```js
// ── universal filters ───────────────────────────────────────
function normName(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function filtersActive() {
  const f = STATE.filters;
  return !!(f.loc || f.level || f.dept || f.q);
}
// One predicate for employees[], people[], and any row carrying these fields.
function visibleEmp(e) {
  const f = STATE.filters;
  return (!f.loc || e.keyLocation === f.loc) &&
         (!f.level || e.level === f.level) &&
         (!f.dept || e.dept === f.dept) &&
         (!f.q || normName(e.name).indexOf(normName(f.q)) !== -1);
}
function setFilter(k, v) {
  STATE.filters[k] = v;
  syncFilterBar();
  render();
}
function clearFilters() {
  STATE.filters = { loc: "", level: "", dept: "", q: "" };
  populateFilters();
  syncFilterBar();
  render();
}
function syncFilterBar() {
  document.getElementById("fClear").classList.toggle("hidden", !filtersActive());
  document.getElementById("fNote").textContent = filtersActive()
    ? STATE.data.employees.filter(visibleEmp).length + " Rocketeers match" : "";
}
function populateFilters() {
  const d = STATE.data;
  if (!d) return;
  const f = STATE.filters;
  const opt = (id, label, vals, cur) => {
    document.getElementById(id).innerHTML =
      '<option value="">' + label + ': All</option>' +
      vals.map(v => '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") +
        '>' + esc(v) + '</option>').join("");
  };
  opt("fLoc", "Location", [...new Set(d.employees.map(e => e.keyLocation))].filter(Boolean).sort(), f.loc);
  opt("fLevel", "Level", [...new Set(d.employees.map(e => e.level))].sort(), f.level);
  opt("fDept", "Department", [...new Set(d.employees.map(e => e.dept))].filter(Boolean).sort(), f.dept);
  document.getElementById("fQ").value = f.q;
}
```

In `onData()`, add `populateFilters();` and `syncFilterBar();` right before `render();`.

- [ ] **Step 4: Run checks**

Run: `node CompDash/tests/parse_html.js` → `✅ ViewDash.html script parses`
Run: `node CompDash/tests/run_tests.js` → PASS
(`renderCompa` still references `STATE.compaFilters` — that's Task 11; if the parse fails on it, it won't: `parse_html` only syntax-checks. Do NOT load the live app between Tasks 10 and 11.)

- [ ] **Step 5: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): sticky header+tabs+filterbar with universal filters and name search"
```

---

### Task 11: ViewDash — Internal Position V2 (ranking table, tier badges, 4 bands)

**Files:**
- Modify: `CompDash/ViewDash.html` — `ratioClass`, `renderCompa`, remove `setCompaFilter`

- [ ] **Step 1: Replace `ratioClass`** (4 bands from the new meta shape):

```js
function ratioClass(r) {
  // Bands come from CONFIG_CD via meta.compaBands — never hardcode them here.
  const b = (STATE.data && STATE.data.meta.compaBands) || { low: 0.8, target: 0.95, high: 1.1 };
  return r == null ? "" : r < b.low ? "red" : r < b.target ? "yellow" : r <= b.high ? "green" : "violet";
}
function ratioBarColor(cls) {
  return cls === "green" ? "var(--accent)" : cls === "yellow" ? "var(--warn)" :
         cls === "violet" ? "var(--above)" : "var(--bad)";
}
```

- [ ] **Step 2: Replace `renderCompa` and `setCompaFilter`** entirely with:

```js
const TIER_LABEL = {
  title: "median · title peers", market: "market mean",
  level: "median · level cohort", none: "insufficient peers",
};
function rankVal(e, key) {
  if (key === "score") return e.priority && e.priority.score != null ? e.priority.score : -1;
  if (key === "ratio") return e.ratio != null ? e.ratio : 99;
  if (key === "marketRatio") return e.marketRatio != null ? e.marketRatio : 99;
  if (key === "perfAvg") return e.perfAvg != null ? e.perfAvg : -1;
  if (key === "tenure") return e.tenureCompanyYears != null ? e.tenureCompanyYears : -1;
  if (key === "ttm") return e.ttmGrowthPct != null ? e.ttmGrowthPct : -99;
  return normName(e.name);
}
function sortRank(key) {
  const s = STATE.rankSort;
  s.dir = (s.key === key) ? -s.dir : (key === "name" ? 1 : -1);
  s.key = key;
  render();
}
function renderCompa(el) {
  const d = STATE.data, s = STATE.rankSort;
  const emps = d.employees.filter(visibleEmp);

  const th = (key, label) => '<th style="cursor:pointer" onclick="sortRank(\'' + key + '\')">' +
    label + (s.key === key ? (s.dir < 0 ? " ▼" : " ▲") : "") + '</th>';
  const ranked = emps.slice().sort((a, b) => {
    const va = rankVal(a, s.key), vb = rankVal(b, s.key);
    return (va < vb ? -1 : va > vb ? 1 : 0) * s.dir;
  });
  const marketLow = d.meta.marketLow || 0.9;

  let html =
    '<div class="banner">⚖️ <b>Internal Position (vs peer median)</b> — TCC ÷ the median TCC of ACTIVE peers with the same Key Location + Job Title, local currency. Small groups fall back to the <b>market mean</b> (external benchmark) or the location&#39;s level cohort — see the badge on each group. 1.00 = the anchor; ratios above 1.00 are expected.</div>' +
    '<div class="card"><h2>🎯 Priority ranking <span class="sub">(config-weighted: performance / tenure / compa gap — click a column to sort)</span></h2>' +
    '<table><tr>' + th("name", "Name") + th("ratio", "Position") + th("marketRatio", "vs Market") +
      th("perfAvg", "Avg rating") + th("tenure", "Tenure C/P") + th("ttm", "TTM growth") + th("score", "Score") + '</tr>' +
    ranked.map(e => {
      const p = e.priority || {};
      const mrCls = e.marketRatio == null ? "" : e.marketRatio < marketLow ? "red" : "green";
      return '<tr class="click" onclick="openDrill(\'' + esc(e.empNo) + '\')">' +
        '<td>' + esc(e.name) + '<div class="sub">' + esc(e.keyLocation) + ' · ' + esc(e.level) + '</div></td>' +
        '<td><span class="chip ' + ratioClass(e.ratio) + '">' + (e.ratio != null ? e.ratio.toFixed(2) : "—") + '</span></td>' +
        '<td>' + (e.marketRatio != null ? '<span class="chip ' + mrCls + '">' + e.marketRatio.toFixed(2) + '</span>' : '<span class="sub">—</span>') + '</td>' +
        '<td>' + (e.perfAvg != null ? e.perfAvg.toFixed(2) + '<span class="sub"> ×' + e.perfCount + '</span>' : "—") + '</td>' +
        '<td>' + (e.tenureCompanyYears != null ? e.tenureCompanyYears + 'y / ' + (e.tenureProfileYears != null ? e.tenureProfileYears + 'y' : "—") : "—") + '</td>' +
        '<td>' + pctFmt(e.ttmGrowthPct) + '</td>' +
        '<td>' + (p.score != null
          ? '<b>' + p.score + '</b>' + (p.partial ? ' <span class="sub" title="missing: ' + esc((p.missing || []).join(", ")) + '">°</span>' : '')
          : "—") + '</td></tr>';
    }).join("") + '</table></div>';

  const f = STATE.filters;
  const empIndex = {};
  d.employees.forEach(e => { empIndex[e.empNo] = e; });
  const groups = d.compaGroups
    .filter(g => !f.loc || g.keyLocation === f.loc)
    .map(g => Object.assign({}, g, { members: g.members.filter(m => {
      const e = empIndex[m.empNo] ||
        { name: m.name, level: m.level, keyLocation: g.keyLocation, dept: "" };
      return visibleEmp(e);
    }) }))
    .filter(g => g.members.length);

  html += groups.map(g =>
    '<div class="card"><h2>' + esc(g.keyLocation) + ' · ' + esc(g.jobTitle) +
    ' <span class="sub">(' + g.count + ' member' + (g.count === 1 ? "" : "s") + ')</span>' +
    ' <span class="chip ' + (g.anchorTier === "market" ? "violet" : "") + '">' + TIER_LABEL[g.anchorTier] + '</span>' +
    (g.smallGroup ? ' <span class="chip yellow">small group</span>' : '') +
    (g.missingTcc ? ' <span class="chip">' + g.missingTcc + ' missing TCC</span>' : '') + '</h2>' +
    (g.anchor != null
      ? '<div class="sub" style="margin-bottom:8px">Anchor: ' + fmtMoney(g.anchor, null, g.currency) + '</div>' : '') +
    '<table><tr><th>Name</th><th>Level</th><th>TCC</th><th style="min-width:170px">Position</th><th>Ratio</th></tr>' +
    g.members.map(m => {
      const cls = ratioClass(m.ratio);
      return '<tr class="click" onclick="openDrill(\'' + esc(m.empNo) + '\')">' +
        '<td>' + esc(m.name) + '</td><td>' + esc(m.level) + '</td>' +
        '<td>' + fmtMoney(m.tcc, m.tccUsd, m.currency) + '</td>' +
        '<td><div class="bar"><i style="width:' + Math.min(100, Math.round((m.ratio || 0) * 100)) + '%;background:' + ratioBarColor(cls) + '"></i></div></td>' +
        '<td>' + (m.ratio != null ? '<span class="chip ' + cls + '">' + m.ratio.toFixed(2) + '</span>' : '<span class="chip">insufficient peers</span>') +
        (m.noPeers ? '<span class="chip">no peers</span>' : '') + '</td></tr>';
    }).join("") + '</table></div>').join("");
  if (!groups.length) html += '<div class="card sub">No groups match the current filters.</div>';
  el.innerHTML = html;
}
```

Delete the old `function setCompaFilter(k, v) { … }` line.

- [ ] **Step 3: Run checks** — `node CompDash/tests/parse_html.js` → parses; `node CompDash/tests/run_tests.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): Internal Position V2 — priority ranking, tier badges, 4-band ratios"
```

---

### Task 12: ViewDash — live Market Gap + Overview

**Files:**
- Modify: `CompDash/ViewDash.html` — `renderMarket`, `marketRow` (delete), `renderOverview`

- [ ] **Step 1: Replace `renderMarket` and DELETE `marketRow`:**

```js
function renderMarket(el) {
  const d = STATE.data, cov = d.meta.benchCoverage || { rows: 0, matchedEmployees: 0, currencyMismatch: 0 };
  const emps = d.employees.filter(visibleEmp);
  const byLoc = new Map();
  emps.forEach(e => {
    const k = e.keyLocation || "—";
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k).push(e);
  });
  let html =
    '<div class="banner">🌍 <b>Market data: ' + cov.matchedEmployees + ' of ' + d.meta.activeCount +
    ' active Rocketeers matched</b> (' + cov.rows + ' benchmark rows — compilation in progress)' +
    (cov.currencyMismatch ? ' · ⚠️ ' + cov.currencyMismatch + ' row(s) skipped for currency mismatch' : '') +
    '. Values are LOCAL currency; the midpoint column is a <b>mean</b>, not P50.</div>' +
    sourceBanner("benchmarks", "Benchmark data");
  [...byLoc.keys()].sort().forEach(loc => {
    const rows = byLoc.get(loc).slice().sort((a, b) => (b.tcc || 0) - (a.tcc || 0));
    html += '<div class="card"><h2>' + esc(loc) + ' <span class="sub">(' + rows.length + ' active)</span></h2>' +
      '<table><tr><th>Emp #</th><th>Name</th><th>Job Title</th><th>TCC</th><th>P25</th><th>Mean (midpoint)</th><th>P75</th><th>vs market</th><th>Suggestion</th></tr>' +
      rows.map(e => {
        const s = suggestionChip(e);
        const tip = e.benchSource ? ' title="' + esc(e.benchSource) + '"' : '';
        return '<tr class="click" onclick="openDrill(\'' + esc(e.empNo) + '\')">' +
          '<td>' + esc(e.empNo) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.jobTitle) + '</td>' +
          '<td>' + fmtMoney(e.tcc, e.tccUsd, e.currency) + '</td>' +
          '<td' + tip + '>' + (e.p25 != null ? Math.round(e.p25).toLocaleString() : "—") + '</td>' +
          '<td' + tip + '>' + (e.p50 != null ? Math.round(e.p50).toLocaleString() : "—") + '</td>' +
          '<td' + tip + '>' + (e.p75 != null ? Math.round(e.p75).toLocaleString() : "—") + '</td>' +
          '<td>' + s.badge + '</td><td>' + s.text + '</td></tr>';
      }).join("") + '</table></div>';
  });
  el.innerHTML = html;
}

// Renders the SERVER-computed suggestion (marketSuggestion_ in Code.js) — no client math.
function suggestionChip(e) {
  const s = e.suggestion || { status: "pending" };
  if (s.status === "below-p25") {
    return { badge: '<span class="chip red">below P25</span>',
             text: "+" + pctFmt(s.pctToP25, 0) + " to reach P25 · +" + pctFmt(s.pctToP50, 0) + " to mean" };
  }
  if (s.status === "below-p50") {
    return { badge: '<span class="chip yellow">below mean</span>',
             text: "+" + pctFmt(s.pctToP50, 0) + " to reach the mean" };
  }
  if (s.status === "at-market") {
    return { badge: '<span class="chip green">at/above mean</span>', text: "market competitive" };
  }
  return { badge: '<span class="chip">pending</span>', text: "—" };
}
```

- [ ] **Step 2: Replace `renderOverview`** (filtered + benchmarked KPI #3):

```js
function renderOverview(el) {
  const d = STATE.data, act = filtersActive();
  const emps = d.employees.filter(visibleEmp);
  const people = act ? d.people.filter(visibleEmp) : d.people;
  const cur = act
    ? fyAttritionFromPeople_(people, d.meta.fyStartCalYear, d.meta.asOf, d.meta.fyLabel)
    : d.attrition.currentFY;
  const prev = act
    ? fyAttritionFromPeople_(people, d.meta.fyStartCalYear - 1, null, d.meta.prevFyLabel)
    : d.attrition.previousFY;
  const eq = d.equity;
  const empIndex = {};
  d.employees.forEach(e => { empIndex[e.empNo] = e; });
  const flagVisible = r => { const e = empIndex[r.empNo]; return e ? visibleEmp(e) : false; };

  const medRatio = median(emps.filter(e => e.ratio != null).map(e => e.ratio));
  const mkt = emps.filter(e => e.marketRatio != null).map(e => e.marketRatio);
  const medMkt = median(mkt);
  const flags = eq.outliers.filter(flagVisible).length + eq.tenure.filter(flagVisible).length +
    (eq.genderAvailable ? eq.gender.filter(g => g.flagged).length : 0);
  const overdue = d.qtaInterim.filter(r => r.daysOverdue != null && r.daysOverdue > 0 && flagVisible(r)).length;
  const suffix = act ? " · filtered" : "";

  const cards = [
    { q: "Is my team healthy? Are people staying?", v: pctFmt(cur.rate),
      s: d.meta.fyLabel + " attrition · " + prev.label + " " + pctFmt(prev.rate) + suffix, tab: "attrition" },
    { q: "Are Rocketeers paid fairly vs peers?", v: medRatio != null ? medRatio.toFixed(2) : "—",
      s: "median Internal Position (vs peer median)" + suffix, tab: "compa" },
    { q: "Is our band still competitive in the market?", v: medMkt != null ? medMkt.toFixed(2) : "Pending",
      s: mkt.length ? "median vs market · " + mkt.length + " benchmarked" + suffix : "benchmark compilation in progress", tab: "market" },
    { q: "Is anyone being paid inequitably?", v: String(flags),
      s: (eq.genderAvailable ? "equity flags to review" : "equity flags (gender lens pending)") + suffix, tab: "equity" },
    { q: "Who is coming up for review this quarter?", v: String(overdue),
      s: "Next Review dates overdue" + suffix, tab: "qta" },
    { q: "Whose contribution warrants recognition?", v: "→",
      s: "open the Contribution Report", tab: "contrib" },
  ];
  el.innerHTML =
    '<div class="kpi-grid">' + cards.map(c =>
      '<div class="kpi" onclick="switchTab(\'' + c.tab + '\')">' +
      '<div class="kpi-q">' + esc(c.q) + '</div><div class="kpi-v">' + esc(c.v) + '</div>' +
      '<div class="kpi-s">' + esc(c.s) + '</div></div>').join("") + '</div>' +
    '<div class="card"><h2>' + esc(cur.label) + ' terminations by fiscal month' + esc(suffix) + '</h2>' +
    svgSpark(cur.monthly.map(m => m.terms), 640, 60, "var(--warn)") +
    '<div class="sub">' + esc(d.meta.monthLabels[0]) + ' → ' + esc(d.meta.monthLabels[11]) + '</div></div>';
}
```

Note: `renderOverview` calls `fyAttritionFromPeople_` — the client MIRROR of that function is added in Task 13. Do Tasks 12+13 as consecutive commits without loading the live app in between (parse check still passes since the call is only evaluated at runtime).

- [ ] **Step 3: Run checks** — `node CompDash/tests/parse_html.js` → parses; `node CompDash/tests/run_tests.js` → PASS.

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): live Market Gap with coverage banner + filtered Overview w/ market KPI"
```

---

### Task 13: ViewDash — filtered recompute for Attrition, Equity, QTA (client mirrors)

**Files:**
- Modify: `CompDash/ViewDash.html` — add the two mirror functions + `levelRankC`, rework `renderAttrition`, `renderEquity`, `renderQta`, `flagTable`

- [ ] **Step 1: Add the mirrors** near the other helpers (below `svgSpark`). Copy `fyAttritionFromPeople_` and `sliceAttritionFromPeople_` **byte-identical** from Code.js (Task 7), each preceded by:

```js
// MIRROR of fyAttritionFromPeople_ in Code.js — parity-tested there; keep in sync.
```
```js
// MIRROR of sliceAttritionFromPeople_ in Code.js — parity-tested there; keep in sync.
```

Also add the small level-sort mirror:

```js
// MIRROR of levelRank_ in Code.js.
function levelRankC(level) {
  const m = String(level || "").match(/^([IM])(\d+)$/);
  if (!m) return 999;
  return (m[1] === "I" ? 0 : 100) + parseInt(m[2], 10);
}
```

- [ ] **Step 2: Rework `renderAttrition`.** Replace its first lines (`const d = …; const a = …, cur = …, prev = …;`) with:

```js
  const d = STATE.data, a = d.attrition, act = filtersActive();
  const dimField = { department: "dept", level: "level", keyLocation: "keyLocation" };
  const people = act ? d.people.filter(visibleEmp) : null;
  const cur = act
    ? fyAttritionFromPeople_(people, d.meta.fyStartCalYear, d.meta.asOf, d.meta.fyLabel)
    : a.currentFY;
  const prev = act
    ? fyAttritionFromPeople_(people, d.meta.fyStartCalYear - 1, null, d.meta.prevFyLabel)
    : a.previousFY;
```

Replace `const slices = a.slices[dim] || [];` with:

```js
  let slices = act
    ? sliceAttritionFromPeople_(people, d.meta.fyStartCalYear, d.meta.asOf, p => p[dimField[dim]])
    : (a.slices[dim] || []);
  if (dim === "level") slices = slices.slice().sort((x, y) => levelRankC(x.key) - levelRankC(y.key));
```

And filter the detail rows: replace `a.detail.map(t =>` with

```js
    a.detail.filter(t => !act || visibleEmp(t)).map(t =>
```

(`detail` rows carry `name`, `dept`, `level`, `keyLocation` — `visibleEmp` works on them directly.)
Also update the `<details>` summary count to use the filtered array — compute `const detail = a.detail.filter(t => !act || visibleEmp(t));` once above the template and use `detail.length` + `detail.map(...)`.

- [ ] **Step 3: Filter Equity + QTA rows.** In `renderEquity`, before building html add:

```js
  const empIndex = {};
  STATE.data.employees.forEach(e => { empIndex[e.empNo] = e; });
  const act = filtersActive();
  const flagVisible = r => !act || (empIndex[r.empNo] ? visibleEmp(empIndex[r.empNo]) : false);
  const f = STATE.filters;
  const groupVisible = g => (!f.loc || g.keyLocation === f.loc) && (!f.level || g.level === f.level);
```

Then: `eq.gender.length` / `eq.gender.map(...)` → use `eq.gender.filter(groupVisible)` (assign to a const first); `flagTable(eq.outliers, false)` → `flagTable(eq.outliers.filter(flagVisible), false)`; same for `eq.tenure`; and the two `<h2>` count chips use the filtered arrays' lengths. Group *stats* (medians, gap %) are NEVER recomputed — server facts about full groups; filters only hide/show rows (add a one-line comment saying so).

In `renderQta`, replace `const rows = d.qtaInterim;` with:

```js
  const rows = d.qtaInterim.filter(r => !filtersActive() || visibleEmp(r));
```

(QTA rows carry `name`, `dept`, `keyLocation`, `level`.)

- [ ] **Step 4: Run checks** — `node CompDash/tests/parse_html.js` → parses; `node CompDash/tests/run_tests.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): universal filters recompute attrition/equity/qta (client mirrors)"
```

---

### Task 14: ViewDash — drill additions + Data Reference + final sweep

**Files:**
- Modify: `CompDash/ViewDash.html` — `openDrill`, `renderReference`

- [ ] **Step 1: Drill additions.** In `openDrill`, after the `emp` lookup add `const marketLow = d.meta.marketLow || 0.9;`. Replace the chip block (`let body = … '</div>';`) so the chips row becomes:

```js
  let body =
    '<button onclick="closeDrill()" style="float:right">✕ Close</button>' +
    '<h2>' + esc(emp.name) + '</h2>' +
    '<div class="sub">' + esc(emp.jobTitle) + ' · ' + esc(emp.keyLocation) + ' · ' + esc(emp.dept) + '</div>' +
    '<div style="margin:10px 0">' +
    '<span class="chip">TCC ' + fmtMoney(emp.tcc, emp.tccUsd, emp.currency) + '</span>' +
    (emp.ratio != null
      ? '<span class="chip ' + ratioClass(emp.ratio) + '" title="anchor: ' + esc(TIER_LABEL[emp.anchorTier] || "") + '">position ' + emp.ratio.toFixed(2) + '</span>' : '') +
    (emp.marketRatio != null
      ? '<span class="chip ' + (emp.marketRatio < marketLow ? "red" : "green") + '" title="' + esc(emp.benchSource || "benchmark") + '">vs market ' + emp.marketRatio.toFixed(2) + '</span>' : '') +
    (emp.tenureCompanyYears != null
      ? '<span class="chip">tenure ' + emp.tenureCompanyYears + 'y company / ' + (emp.tenureProfileYears != null ? emp.tenureProfileYears + 'y in role' : "—") + '</span>' : '') +
    (emp.ttmGrowthPct != null ? '<span class="chip">TTM growth ' + pctFmt(emp.ttmGrowthPct) + '</span>' : '');
  if (g && g.overallAnnualized != null) {
    body += '<span class="chip green">overall growth ' + pctFmt(g.overallAnnualized) + '/yr (RRI)</span>';
  }
  if (emp.priority && emp.priority.score != null) {
    const c = emp.priority.components;
    body += '<span class="chip yellow" title="perf ' + (c.perf != null ? (c.perf * 100).toFixed(0) + '%' : '—') +
      ' · tenure ' + (c.tenure != null ? (c.tenure * 100).toFixed(0) + '%' : '—') +
      ' · gap ' + (c.compaGap != null ? (c.compaGap * 100).toFixed(0) + '%' : '—') +
      (emp.priority.partial ? ' · partial (missing: ' + emp.priority.missing.join(", ") + ')' : '') +
      '">priority ' + emp.priority.score + (emp.priority.partial ? '°' : '') + '</span>';
  }
  body += '</div>';
```

Then, after the existing comp-events table block (inside the `else` branch is wrong — put it AFTER the whole if/else so it renders even without RD events), add the ratings strip:

```js
  const ratings = (g && g.ratings) ? g.ratings : [];
  if (ratings.length) {
    body += '<h3>Performance ratings (Small Improvements)</h3><div>' +
      ratings.map(r =>
        '<span class="chip ' + (r.rate >= 4 ? "green" : r.rate >= 3 ? "" : "red") + '"' +
        (r.explanation ? ' title="' + esc(r.explanation) + '"' : '') + '>' +
        esc(r.fq) + ' · ' + esc(r.rate) + '</span>').join("") + '</div>' +
      '<div class="sub" style="margin-top:4px">avg ' + (emp.perfAvg != null ? emp.perfAvg.toFixed(2) : "—") +
      ' over ' + emp.perfCount + ' quarter(s)</div>';
  }
```

Also update the "no comp history" banner condition: `if (!g || !g.events.length)` stays, but since `history[empNo]` now exists for ratings-only employees, the banner text should only concern comp events — it already does ("No comp history found…"). Fine as-is.

- [ ] **Step 2: Data Reference.** In `renderReference`, extend the top constants:

```js
  const p = m.priorityCfg || { weights: { perf: 57, tenure: 29, compaGap: 14 },
                               caps: { companyYears: 10, profileYears: 5, gapPct: 0.25 }, ratingMax: 5 };
  const cov = m.benchCoverage || { rows: 0, matchedEmployees: 0, currencyMismatch: 0 };
```

Replace the Internal Position formula row with:

```js
    '<tr><td><b>Internal Position</b></td><td>TCC ÷ anchor, ACTIVE peers, local currency. Anchor tiers: (1) median of Key Location + Job Title peers when the group has ≥ ' + q.smallGroupMin + ' members; (2) the external <b>market mean</b> for that Location + Job Title (N-of-1 rule — external parity replaces internal equity for unique roles); (3) median of the Key Location + Level cohort (≥ ' + q.smallGroupMin + '); else &quot;insufficient peers&quot;. Anchors always derive from the FULL active population — the universal filters never recompute them. Bands: red &lt; ' + b.low.toFixed(2) + ', yellow &lt; ' + b.target.toFixed(2) + ', green ≤ ' + b.high.toFixed(2) + ', violet above (ceiling watch).</td></tr>' +
    '<tr><td><b>Priority Score</b></td><td>Weighted 0–100: performance (avg rating ÷ ' + p.ratingMax + ') × ' + p.weights.perf + '% + tenure (50/50 company capped ' + p.caps.companyYears + 'y / in-role capped ' + p.caps.profileYears + 'y) × ' + p.weights.tenure + '% + compa gap (below-anchor %, full credit at ' + Math.round(p.caps.gapPct * 100) + '%) × ' + p.weights.compaGap + '%. Missing components redistribute their weight (° = partial). Mastery banding is a planned future component.</td></tr>' +
    '<tr><td><b>vs Market</b></td><td>TCC ÷ benchmark <b>Mean</b> (a mean, not P50) for the same Location + Job Title, local currency only — currency-mismatched rows are skipped and counted. Below ' + (m.marketLow || 0.9).toFixed(2) + ' renders red (priority read). Coverage: ' + cov.matchedEmployees + ' matched / ' + cov.rows + ' rows' + (cov.currencyMismatch ? ' / ' + cov.currencyMismatch + ' currency mismatches' : '') + '.</td></tr>' +
    '<tr><td><b>Tenure</b></td><td>Company = years since Hire Date. In-role = years since the latest promotion/title-change comp event (falls back to Hire Date). TTM growth = TCC now ÷ TCC in effect 12 months ago − 1 (null when history is younger).</td></tr>' +
```

And add two source rows to the Sources table:

```js
    '<tr><td>Performance ratings</td><td>&quot;Small Improvements RD&quot; tab (contribution data file), joined by Employee Number — ' + (m.ratingsCount || 0) + ' rating rows</td><td>' + esc(m.sources.ratings || "—") + '</td></tr>' +
    '<tr><td>Market benchmarks</td><td>Benchmarking file — &quot;Compilation&quot; tab, joined by normalized Location + Job Title, LOCAL currency; compilation grows over time</td><td>' + esc(m.sources.benchmarks || "—") + '</td></tr>' +
```

Finally, append to the Currency paragraph: `' Universal filters recompute every view for the filtered population, EXCEPT anchors and equity group medians (always full-population facts).'`

- [ ] **Step 3: Full check sweep**

Run: `node CompDash/tests/run_tests.js` → all PASS (expect ~110+)
Run: `node CompDash/tests/parse_html.js` → `✅ ViewDash.html script parses`
Grep sanity: `grep -n "compaFilters\|marketRow\|maxTcc\|COMPA_GREEN_MIN" CompDash/Code.js CompDash/ViewDash.html` → **no hits** (all V1 remnants gone).

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): drill ratings/priority/market chips + Data Reference V2"
```

---

### Task 15: Deployment checklist (owner actions — document, don't execute)

No code. Verify the working tree is clean, then hand the owner this checklist (also in spec §8):

1. Paste `Code.js` + `ViewDash.html` into the GAS project (Security.js unchanged).
2. Script Properties: add `CD_RATINGS_SS_ID` = `1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw`, `CD_BENCH_SS_ID` = `1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0` (both optional — fallbacks in code), and set `CD_CONTRIB_URL` to the live Contribution Report `/exec` URL.
3. GAS editor: run `debugCompPipeline()` — check ratings join hit-rate, benchmark coverage, anchor-tier distribution (expect market/level tiers to absorb most former singletons).
4. Run `bustCompCache_()` (payload shape changed).
5. Deploy → Manage deployments → New version. Load `/exec`, hit ⟳ Refresh once.
6. Live QA: sticky bar pins on scroll; search finds a Rocketeer across tabs; an N-of-1 Rocketeer with a benchmark row shows the "market mean" badge; Market Gap coverage banner counts match `debugCompPipeline` output; Priority ranking sorts; drill shows ratings strip + priority breakdown.

---

## Self-review notes (already applied)

- **Spec coverage:** anchor tiers (T5), ratings (T2/T8), tenure+TTM (T3), benchmarks (T4/T8), priority (T6), people[]+parity (T7), assembly/meta (T9), sticky+filters+search (T10), IP tab V2 (T11), Market Gap live + Overview (T12), filtered attrition/equity/QTA + never-recompute rule (T13), drill+Data Reference (T14), deploy (T15). Deferred items (mastery, COL, skills, per-tier weights) correctly have no tasks.
- **Type consistency:** `priorityScore_` returns `{score, components, partial, missing}` — consumed by T9 (`priority` field) and T11/T14 (`p.score`, `p.missing`). `lookupBench_` returns `{row, mismatch}` — T5/T8/T9 all use that shape. `meta.compaBands` = `{low, target, high}` — T11 `ratioClass` matches. `history[empNo].ratings` — T9 builds, T14 reads via `g.ratings`.
