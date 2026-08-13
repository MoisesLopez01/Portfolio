# Attrition Intelligence v1.4.0 — Signals Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the Attrition Intelligence GAS app (scriptId `1_FCF366GsHljMS7N5_sUCtpkFeUodbP_OqjlDOnbtsxDDL0EsvXMTqcg`) to v1.4.0: dedup to one-headline-one-owner, add four structural risk factors + empirical hazard-curve forecast, wire Small Improvements ratings + PayScale (Compilation) benchmarks, add a monthly snapshot store and a new ⚠ Risk tab.

**Spec:** `D:\Contribution\docs\superpowers\specs\2026-08-13-attrition-signals-refinement-design.md` — read it first.

**Architecture:** Keep the existing shell (security, chunked gzip cache, header-resolved readers). All new computation lives in a new pure file `Signals.js` (Node-testable via the same `module.exports` hook `Attritionintel.js` already uses). GAS-layer additions (readers, snapshot writer, payload assembly) go in `Attritionintel.js`. The frontend deletes its six re-implemented engines and consumes server numbers only.

**Tech stack:** Google Apps Script (V8), plain-JS SPA in `AttritionView.html`, Node ≥18 for tests (no framework — a tiny assert runner like the sibling projects), `clasp` for push.

**Working directory:** `C:\Users\moise\gas-projects\attrition-intel` (created in Task 0 from the already-pulled copy at `C:\Users\moise\AppData\Local\Temp\claude\D--Contribution\c8e43fa4-b59c-4567-936e-7377375957f0\scratchpad\attrition-new-app`). If the scratchpad is gone, `clasp pull` with the scriptId above. **All file paths in tasks below are relative to this working directory.**

**Conventions (from the codebase — follow them):**
- Private helpers end in `_`; new pure signal functions are prefixed `sig` (e.g. `sigHazardFit_`).
- Every threshold lives in `CONFIG_AI`, is overridable by an `AI_*` Script Property, and is echoed to the client in `meta.rules`. The client NEVER hardcodes a threshold or reason name.
- Dates compared as `Date` objects server-side; only ISO strings ship to the client. Raw TCC/ratios never ship — bands only.
- `git commit` after every green step. Do NOT `git push` (user rule: local only). Do NOT `clasp push` until the final task.

---

### Task 0: Persistent working clone + Node test harness

**Files:**
- Create: `C:\Users\moise\gas-projects\attrition-intel\` (whole directory)
- Create: `tests/run_tests.js`
- Create: `.claspignore`

- [ ] **Step 1: Create the clone**

```powershell
$src = "C:\Users\moise\AppData\Local\Temp\claude\D--Contribution\c8e43fa4-b59c-4567-936e-7377375957f0\scratchpad\attrition-new-app"
$dst = "C:\Users\moise\gas-projects\attrition-intel"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\*" $dst -Recurse -Force
Set-Location $dst
git init && git add -A && git commit -m "chore: import Attrition Intelligence v1.3.1 as pulled from GAS"
```

Expected: 5 files committed (`.clasp.json`, `appsscript.json`, `Attritionintel.js`, `AttritionView.html`, `security.js`).

- [ ] **Step 2: Write `.claspignore`**

```
tests/**
.git/**
node_modules/**
*.md
```

- [ ] **Step 3: Write the test runner** — `tests/run_tests.js`:

```js
// Tiny assert harness — mirrors the sibling projects (CompDash/tests).
// Usage: node tests/run_tests.js
"use strict";
const path = require("path");
let pass = 0, fail = 0;
const failures = [];
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, failures.push(label + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)));
}
function near(label, got, want, tol) {
  const ok = typeof got === "number" && Math.abs(got - want) <= (tol == null ? 1e-6 : tol);
  ok ? pass++ : (fail++, failures.push(label + "\n  got  " + got + "\n  want " + want));
}
const AI = require(path.join(__dirname, "..", "Attritionintel.js"));
let SIG = null;
try { SIG = require(path.join(__dirname, "..", "Signals.js")); } catch (e) { /* Task 1 adds it */ }

// Existing pure layer still loads and self-checks basics:
eq("aiSignalStatus_ floor", AI.aiSignalStatus_(2, 0.5, 0.1), "low-n");
eq("aiCompaBand_ below", AI.aiCompaBand_(0.94), "below");

require("./signals_tests.js")({ eq, near, AI, SIG });

console.log("── run_tests: " + pass + " passed, " + fail + " failed ──");
if (fail) { failures.forEach(f => console.log("❌ " + f)); process.exit(1); }
```

- [ ] **Step 4: Write the (initially empty) signals test module** — `tests/signals_tests.js`:

```js
"use strict";
module.exports = function ({ eq, near, AI, SIG }) {
  // Signal-engine tests accumulate here task by task.
};
```

- [ ] **Step 5: Run** `node tests/run_tests.js` — Expected: `2 passed, 0 failed`.

- [ ] **Step 6: Commit**

```bash
git add .claspignore tests/ && git commit -m "test: Node harness over the existing module.exports hook"
```

---

### Task 1: `Signals.js` scaffold + `CONFIG_AI` additions

**Files:**
- Create: `Signals.js`
- Modify: `Attritionintel.js` — `CONFIG_AI` (insert after the `PERF:` line, currently `Attritionintel.js:276`)
- Test: `tests/signals_tests.js`

- [ ] **Step 1: Add config.** In `Attritionintel.js`, replace the line

```js
  PERF: { SOURCE: "regretted-proxy", SI_SS_ID: null, SI_TAB: null },
```

with:

```js
  // ── Performance source — Small Improvements ratings (v1.4.0). When the
  //    sheet id is absent (property AND code default), every SI-dependent
  //    surface degrades to the labelled regretted-proxy. ──
  PERF: { SOURCE: "small-improvements", SI_SS_ID: null, SI_TAB: "Small Improvements RD" },

  // ── PayScale market benchmarks — the CompDash "Compilation" sheet, read
  //    as-is (Location · Job Title · Local Currency · P25/Mean/P75 · Source).
  //    Values are LOCAL-currency annual TCC. null id = source unavailable. ──
  BENCH_SS_ID: null,
  BENCH_TAB: "Compilation",

  // ── Monthly snapshot store (dedicated spreadsheet, never an HR source).
  //    null = snapshots disabled; the Risk tab renders live values labelled
  //    "no snapshot yet — live view". ──
  SNAPSHOT_SS_ID: null,
  SNAPSHOT_TAB: "Snapshots",

  // ── Structural risk factors (spec 2026-08-13, decisions table).
  //    Every number here is echoed in meta.rules and overridable via the
  //    AI_SIGNALS Script Property (JSON merge, property wins). ──
  SIGNALS: {
    MARKET_MIN: 0.85,          // factor 1 fires: TCC ÷ PayScale mean < this
    PEER_MIN: 0.90,            // factor 2 fires: TCC ÷ peer median < this
    PEER_MIN_COHORT: 3,        // peers required (excluding the person)
    STALE_COMP_MONTHS: 18,     // factor 3a: months since last promo/adjust event
    STALE_PROMO_MONTHS: 36,    // factor 3b: months since last promotion-class event
    CLIFF_LOOKAHEAD_MONTHS: 3, // factor 4: in, or this close to, a hot hazard bucket
    MIN_FACTORS_AT_RISK: 2,    // at-risk = at least this many factors firing
    SI_HIGH: 4.5,              // latest completed-quarter SI at/above = high performer
    HAZARD_BUCKETS_MONTHS: [0, 6, 12, 18, 24, 36, 60], // bucket starts; last is 60+
    HAZARD_MIN_EXITS: 3,       // buckets under this pool forward (printed)
    FORECAST_HORIZON_MONTHS: 12,
  },
```

- [ ] **Step 2: Create `Signals.js`** with the header, shared helpers, and the Node hook:

```js
/**
 * Signals.js — structural attrition risk engine (v1.4.0).
 *
 * PURE LOGIC ONLY. No SpreadsheetApp / CacheService / Session anywhere in
 * this file — everything here runs under Node (tests/run_tests.js) and under
 * GAS unchanged. All inputs arrive as plain objects; all thresholds arrive
 * via the cfg parameter (CONFIG_AI.SIGNALS shape).
 *
 * Four structural factor families per active person (spec 2026-08-13):
 *   1 market   — TCC ÷ PayScale mean            (< MARKET_MIN fires)
 *   2 peer     — TCC ÷ same family×level×geo peer median (< PEER_MIN fires)
 *   3 stale    — >STALE_COMP_MONTHS since any raise OR >STALE_PROMO_MONTHS
 *                since a promotion-class event
 *   4 cliff    — inside (or within CLIFF_LOOKAHEAD_MONTHS of) a tenure bucket
 *                whose fitted voluntary hazard is above the bucket median
 * At-risk = ≥ MIN_FACTORS_AT_RISK firing. SI is an amplifier, never a factor.
 */

/** Median of a numeric array (nulls pre-filtered by callers). */
function sigMedian_(xs) {
  if (!xs || !xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Whole months between two dates (floor; null-safe). */
function sigMonthsBetween_(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date)) return null;
  if (isNaN(from) || isNaN(to) || to < from) return null;
  let m = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) m -= 1;
  return Math.max(0, m);
}

// Node hook — inert inside GAS.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { sigMedian_, sigMonthsBetween_ };
}
```

- [ ] **Step 3: Append tests** to `tests/signals_tests.js` (inside the exported function):

```js
  eq("sigMedian_ odd", SIG.sigMedian_([3, 1, 2]), 2);
  eq("sigMedian_ even", SIG.sigMedian_([1, 2, 3, 4]), 2.5);
  eq("sigMedian_ empty → null", SIG.sigMedian_([]), null);
  eq("months between anniversary-aware", SIG.sigMonthsBetween_(new Date(2025, 0, 15), new Date(2026, 0, 14)), 11);
  eq("months between exact year", SIG.sigMonthsBetween_(new Date(2025, 0, 15), new Date(2026, 0, 15)), 12);
  eq("months between reversed → null", SIG.sigMonthsBetween_(new Date(2026, 0, 1), new Date(2025, 0, 1)), null);
```

- [ ] **Step 4: Run** `node tests/run_tests.js` — Expected: `8 passed, 0 failed`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(signals): Signals.js scaffold + CONFIG_AI.SIGNALS/BENCH/SI/SNAPSHOT config"`

---

### Task 2: Anchor ladder (3-tier) — `sigAnchorLadder_`

Ports CompDash's ladder: T1 title-peer median (≥3 peers, excluding self) → T2 PayScale mean → T3 location×level cohort median → unresolved. Used for the comp-driven classifier upgrade AND factor 2's fallback narrative.

**Files:** Modify `Signals.js`, `tests/signals_tests.js`.

- [ ] **Step 1: Write failing tests** (append to `tests/signals_tests.js`):

```js
  // sigAnchorLadder_(person, others, benchByKey, cfg)
  // person/others: {keyLocation, jobTitle, level, comp} — comp already
  // currency-resolved by the caller (same compValOf semantics as v1.3.1).
  const AL_CFG = { PEER_MIN_COHORT: 3 };
  const p = { keyLocation: "Chile", jobTitle: "09. Service Delivery I3", level: "I3", comp: 90 };
  const titlePeers = [
    { keyLocation: "Chile", jobTitle: "09. Service Delivery I3", level: "I3", comp: 100 },
    { keyLocation: "Chile", jobTitle: "09. Service Delivery I3", level: "I3", comp: 110 },
    { keyLocation: "Chile", jobTitle: "09. Service Delivery I3", level: "I3", comp: 120 },
  ];
  const t1 = SIG.sigAnchorLadder_(p, titlePeers, {}, AL_CFG);
  eq("T1 title peers win", [t1.tier, t1.anchor], ["title-peers", 110]);
  const bench = { "chile||09. service delivery i3": { mean: 130 } };
  const t2 = SIG.sigAnchorLadder_(p, titlePeers.slice(0, 2), bench, AL_CFG);
  eq("T2 bench when <3 title peers", [t2.tier, t2.anchor], ["payscale", 130]);
  const lvlPeers = [
    { keyLocation: "Chile", jobTitle: "01. Marketing I3", level: "I3", comp: 80 },
    { keyLocation: "Chile", jobTitle: "13. Finance I3",   level: "I3", comp: 90 },
    { keyLocation: "Chile", jobTitle: "15. Operations I3", level: "I3", comp: 100 },
  ];
  const t3 = SIG.sigAnchorLadder_(p, lvlPeers, {}, AL_CFG);
  eq("T3 level cohort fallback", [t3.tier, t3.anchor], ["level-cohort", 90]);
  const t4 = SIG.sigAnchorLadder_(p, [], {}, AL_CFG);
  eq("no rung → unresolved", [t4.tier, t4.anchor], ["unresolved", null]);
```

- [ ] **Step 2: Run** `node tests/run_tests.js` — Expected: FAIL, `sigAnchorLadder_ is not a function`.

- [ ] **Step 3: Implement** in `Signals.js` (before the Node hook), and add `sigAnchorLadder_, sigNormKey_` to `module.exports`:

```js
/** Normalised join key — same shape as CompDash benchKey_. */
function sigNormKey_(a, b) {
  const n = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  return n(a) + "||" + n(b);
}

/**
 * 3-tier anchor ladder (ported from CompDash Position.js).
 * @param {{keyLocation, jobTitle, level, comp}} person comp = currency-resolved TCC.
 * @param {Array} others Same-shape records, SAME keyLocation, EXCLUDING the person.
 * @param {Object} benchByKey sigNormKey_(location, jobTitle) → {mean} (local currency).
 * @param {{PEER_MIN_COHORT: number}} cfg
 * @returns {{anchor: ?number, tier: 'title-peers'|'payscale'|'level-cohort'|'unresolved'}}
 */
function sigAnchorLadder_(person, others, benchByKey, cfg) {
  const val = r => (typeof r.comp === "number" && isFinite(r.comp) && r.comp > 0) ? r.comp : null;
  const titlePeers = others
    .filter(o => sigNormKey_(o.keyLocation, o.jobTitle) === sigNormKey_(person.keyLocation, person.jobTitle))
    .map(val).filter(v => v != null);
  if (titlePeers.length >= cfg.PEER_MIN_COHORT) {
    return { anchor: sigMedian_(titlePeers), tier: "title-peers" };
  }
  const bench = benchByKey[sigNormKey_(person.keyLocation, person.jobTitle)];
  if (bench && typeof bench.mean === "number" && isFinite(bench.mean) && bench.mean > 0) {
    return { anchor: bench.mean, tier: "payscale" };
  }
  const lvlPeers = others
    .filter(o => o.level === person.level && o.level !== "—")
    .map(val).filter(v => v != null);
  if (lvlPeers.length >= cfg.PEER_MIN_COHORT) {
    return { anchor: sigMedian_(lvlPeers), tier: "level-cohort" };
  }
  return { anchor: null, tier: "unresolved" };
}
```

- [ ] **Step 4: Run** `node tests/run_tests.js` — Expected: PASS (12 passed).

- [ ] **Step 5: Commit** — `git commit -am "feat(signals): 3-tier anchor ladder (title peers → PayScale → level cohort)"`

---

### Task 3: Factors 1–3 — market, peer equity, recognition staleness

**Files:** Modify `Signals.js`, `tests/signals_tests.js`.

Every factor returns the same shape: `{fired: boolean, measurable: boolean, band: ?string, detail: Object}`. Unmeasurable NEVER fires and is counted separately (unmeasurable ≠ safe — spec §3).

- [ ] **Step 1: Write failing tests** (append):

```js
  const S_CFG = { MARKET_MIN: 0.85, PEER_MIN: 0.90, PEER_MIN_COHORT: 3,
                  STALE_COMP_MONTHS: 18, STALE_PROMO_MONTHS: 36 };
  // Factor 1 — market: comp vs PayScale mean (both local currency).
  eq("market fires under 0.85", SIG.sigMarketFactor_(80, 100, S_CFG),
    { fired: true, measurable: true, band: "below-market", detail: { ratioBand: "<0.85" } });
  eq("market holds at 0.85", SIG.sigMarketFactor_(85, 100, S_CFG).fired, false);
  eq("market unmeasurable without bench", SIG.sigMarketFactor_(80, null, S_CFG),
    { fired: false, measurable: false, band: null, detail: {} });
  // Factor 2 — peer equity: comp vs peer median, ≥3 peers excluding self.
  eq("peer fires under 0.90", SIG.sigPeerFactor_(80, [100, 100, 100], S_CFG).fired, true);
  eq("peer holds at 0.90", SIG.sigPeerFactor_(90, [100, 100, 100], S_CFG).fired, false);
  eq("peer unmeasurable with 2 peers", SIG.sigPeerFactor_(50, [100, 100], S_CFG).measurable, false);
  // Factor 3 — staleness (months precomputed by caller; null = no RD history).
  eq("stale comp fires past 18mo", SIG.sigStaleFactor_(19, 10, S_CFG).fired, true);
  eq("stale promo fires past 36mo", SIG.sigStaleFactor_(5, 37, S_CFG).fired, true);
  eq("fresh on both holds", SIG.sigStaleFactor_(5, 10, S_CFG).fired, false);
  eq("no RD history → unmeasurable", SIG.sigStaleFactor_(null, null, S_CFG).measurable, false);
  eq("stale detail names which leg", SIG.sigStaleFactor_(19, 37, S_CFG).detail,
    { staleComp: true, stalePromo: true });
```

- [ ] **Step 2: Run** — Expected: FAIL (`sigMarketFactor_ is not a function`).

- [ ] **Step 3: Implement** in `Signals.js`; export all three:

```js
/**
 * Factor 1 — position vs PayScale market mean. Local currency on both sides.
 * @param {?number} comp Person's currency-resolved TCC.
 * @param {?number} benchMean PayScale mean for their location × job title.
 * @param {Object} cfg CONFIG_AI.SIGNALS.
 */
function sigMarketFactor_(comp, benchMean, cfg) {
  const ok = v => typeof v === "number" && isFinite(v) && v > 0;
  if (!ok(comp) || !ok(benchMean)) return { fired: false, measurable: false, band: null, detail: {} };
  const fired = comp / benchMean < cfg.MARKET_MIN;
  return {
    fired, measurable: true,
    band: fired ? "below-market" : "at-market",
    detail: fired ? { ratioBand: "<" + cfg.MARKET_MIN } : { ratioBand: ">=" + cfg.MARKET_MIN },
  };
}

/**
 * Factor 2 — position vs same family × level × geo peers (person excluded).
 * @param {?number} comp
 * @param {number[]} peerComps Valued comps of the peers, person NOT included.
 */
function sigPeerFactor_(comp, peerComps, cfg) {
  const ok = v => typeof v === "number" && isFinite(v) && v > 0;
  const peers = (peerComps || []).filter(ok);
  if (!ok(comp) || peers.length < cfg.PEER_MIN_COHORT) {
    return { fired: false, measurable: false, band: null, detail: { peers: peers.length } };
  }
  const fired = comp / sigMedian_(peers) < cfg.PEER_MIN;
  return {
    fired, measurable: true,
    band: fired ? "below-peers" : "with-peers",
    detail: { peers: peers.length },
  };
}

/**
 * Factor 3 — recognition staleness. Months are computed by the caller from
 * the RD history (null = the person has no RD row at all).
 * @param {?number} monthsSinceRaise Months since ANY promo/adjust event.
 * @param {?number} monthsSincePromo Months since a promotion-class event
 *        (measured from hire when no promotion ever happened).
 */
function sigStaleFactor_(monthsSinceRaise, monthsSincePromo, cfg) {
  if (monthsSinceRaise == null && monthsSincePromo == null) {
    return { fired: false, measurable: false, band: null, detail: {} };
  }
  const staleComp = monthsSinceRaise != null && monthsSinceRaise > cfg.STALE_COMP_MONTHS;
  const stalePromo = monthsSincePromo != null && monthsSincePromo > cfg.STALE_PROMO_MONTHS;
  return {
    fired: staleComp || stalePromo, measurable: true,
    band: staleComp || stalePromo ? "stale" : "fresh",
    detail: { staleComp, stalePromo },
  };
}
```

- [ ] **Step 4: Run** — Expected: PASS (24 passed).

- [ ] **Step 5: Commit** — `git commit -am "feat(signals): market, peer-equity and staleness factors with coverage semantics"`

---

### Task 4: Hazard curve fit — `sigHazardFit_`

Empirical monthly hazard by tenure bucket from voluntary realised exits, with person-month exposure and forward pooling of thin buckets (spec §4).

**Files:** Modify `Signals.js`, `tests/signals_tests.js`.

- [ ] **Step 1: Write failing tests** (append):

```js
  // sigHazardFit_(people, windowStart, asOf, cfg)
  // people: {hireDate, termDate (realised exit or null), voluntary: boolean}
  const H_CFG = { HAZARD_BUCKETS_MONTHS: [0, 6, 12, 18, 24, 36, 60], HAZARD_MIN_EXITS: 1 };
  const w0 = new Date(2024, 6, 1), asOfH = new Date(2026, 6, 1);
  // One person, hired at window start, voluntary exit exactly 10 months in:
  const hz1 = SIG.sigHazardFit_(
    [{ hireDate: w0, termDate: new Date(2025, 4, 1), voluntary: true }], w0, asOfH, H_CFG);
  const b6 = hz1.buckets.find(b => b.fromM === 6);
  eq("exit lands in its tenure bucket", b6.volExits, 1);
  eq("exposure counted month by month (0–6 bucket = 6 person-months)",
    hz1.buckets.find(b => b.fromM === 0).personMonths, 6);
  near("hazard = exits ÷ person-months", b6.hazard, 1 / b6.personMonths, 1e-9);
  // Involuntary exits shape exposure but never the numerator:
  const hz2 = SIG.sigHazardFit_(
    [{ hireDate: w0, termDate: new Date(2025, 4, 1), voluntary: false }], w0, asOfH, H_CFG);
  eq("involuntary exit is not a hazard event",
    hz2.buckets.reduce((t, b) => t + b.volExits, 0), 0);
  // Pooling: with a floor of 2, a 1-exit bucket pools forward and says so.
  const H_CFG2 = { HAZARD_BUCKETS_MONTHS: [0, 6, 12, 18, 24, 36, 60], HAZARD_MIN_EXITS: 2 };
  const hz3 = SIG.sigHazardFit_(
    [{ hireDate: w0, termDate: new Date(2025, 4, 1), voluntary: true },
     { hireDate: w0, termDate: new Date(2025, 6, 15), voluntary: true }], w0, asOfH, H_CFG2);
  eq("thin buckets pool and print it", hz3.buckets.some(b => b.pooledWithNext || b.pooledFromPrev), true);
  // Tenure exposure starts at HIRE even when hire predates the window:
  const hz4 = SIG.sigHazardFit_(
    [{ hireDate: new Date(2020, 0, 1), termDate: null, voluntary: false }], w0, asOfH, H_CFG);
  eq("long-tenured active accrues exposure in the 60+ bucket",
    hz4.buckets.find(b => b.fromM === 60).personMonths > 0, true);
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** in `Signals.js`; export `sigHazardFit_, sigBucketOf_`:

```js
/** Index of the tenure bucket (months) a given tenure-in-months falls into. */
function sigBucketOf_(tenureMonths, starts) {
  for (let i = starts.length - 1; i >= 0; i--) {
    if (tenureMonths >= starts[i]) return i;
  }
  return 0;
}

/**
 * Empirical monthly hazard by tenure bucket, voluntary realised exits only.
 * Exposure = person-months INSIDE the observation window, bucketed by the
 * person's tenure during each month. Buckets with volExits below the floor
 * pool forward into the next bucket (exposure + exits move together) and the
 * pooling is flagged so the UI can print it.
 *
 * @param {Array<{hireDate: ?Date, termDate: ?Date, voluntary: boolean}>} people
 *        termDate = realised exit only (callers pass null for future-dated).
 * @param {Date} windowStart Observation window start (fys[0].start).
 * @param {Date} asOf
 * @param {Object} cfg CONFIG_AI.SIGNALS.
 * @returns {{buckets: Array<{fromM, toM, personMonths, volExits, hazard,
 *            pooledWithNext, pooledFromPrev}>}}
 */
function sigHazardFit_(people, windowStart, asOf, cfg) {
  const starts = cfg.HAZARD_BUCKETS_MONTHS;
  const buckets = starts.map((s, i) => ({
    fromM: s, toM: i + 1 < starts.length ? starts[i + 1] : null,
    personMonths: 0, volExits: 0, hazard: null,
    pooledWithNext: false, pooledFromPrev: false,
  }));
  people.forEach(p => {
    if (!(p.hireDate instanceof Date) || isNaN(p.hireDate)) return;
    const end = (p.termDate instanceof Date && !isNaN(p.termDate) && p.termDate < asOf) ? p.termDate : asOf;
    // Walk whole months from the later of hire / windowStart.
    const cur = new Date(Math.max(p.hireDate.getTime(), windowStart.getTime()));
    while (cur < end) {
      const tenureM = sigMonthsBetween_(p.hireDate, cur);
      buckets[sigBucketOf_(tenureM, starts)].personMonths++;
      cur.setMonth(cur.getMonth() + 1);
    }
    if (p.voluntary && p.termDate instanceof Date && !isNaN(p.termDate) &&
        p.termDate >= windowStart && p.termDate <= asOf) {
      const exitTenureM = sigMonthsBetween_(p.hireDate, p.termDate);
      if (exitTenureM != null) buckets[sigBucketOf_(exitTenureM, starts)].volExits++;
    }
  });
  // Forward pooling of thin buckets — exposure and exits travel together.
  for (let i = 0; i < buckets.length - 1; i++) {
    if (buckets[i].personMonths > 0 && buckets[i].volExits > 0 &&
        buckets[i].volExits < cfg.HAZARD_MIN_EXITS) {
      buckets[i + 1].personMonths += buckets[i].personMonths;
      buckets[i + 1].volExits += buckets[i].volExits;
      buckets[i + 1].pooledFromPrev = true;
      buckets[i].pooledWithNext = true;
      buckets[i].personMonths = 0;
      buckets[i].volExits = 0;
    }
  }
  buckets.forEach(b => {
    b.hazard = b.personMonths > 0 ? b.volExits / b.personMonths : null;
  });
  return { buckets };
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(signals): empirical hazard fit — voluntary exits over person-month exposure, pooled floors"`

---

### Task 5: Cliff factor + person forecast walk

**Files:** Modify `Signals.js`, `tests/signals_tests.js`.

- [ ] **Step 1: Write failing tests** (append):

```js
  // Effective hazard lookup honours pooling (a pooled bucket reads its host's rate):
  const hzB = { buckets: [
    { fromM: 0,  toM: 6,  hazard: null, pooledWithNext: true },
    { fromM: 6,  toM: 12, hazard: 0.02, pooledFromPrev: true },
    { fromM: 12, toM: 18, hazard: 0.005 },
    { fromM: 18, toM: null, hazard: 0.001 },
  ] };
  const C_STARTS = [0, 6, 12, 18];
  near("pooled bucket reads its host", SIG.sigHazardAt_(3, hzB, C_STARTS), 0.02, 1e-9);
  near("plain lookup", SIG.sigHazardAt_(13, hzB, C_STARTS), 0.005, 1e-9);
  // Factor 4 — cliff: hot bucket = hazard above the median of fitted buckets.
  const C_CFG = { CLIFF_LOOKAHEAD_MONTHS: 3 };
  eq("inside a hot bucket fires", SIG.sigCliffFactor_(7, hzB, C_STARTS, C_CFG).fired, true);
  eq("approaching a hot bucket fires", SIG.sigCliffFactor_(4, hzB, C_STARTS, C_CFG).fired, true);
  eq("deep in a cool bucket holds", SIG.sigCliffFactor_(30, hzB, C_STARTS, C_CFG).fired, false);
  eq("no fitted hazard → unmeasurable",
    SIG.sigCliffFactor_(7, { buckets: [] }, C_STARTS, C_CFG).measurable, false);
  // Person forecast: survival walk over the next 12 months.
  const pWalk = SIG.sigPersonExitProb_(10, hzB, C_STARTS, 12);
  near("12-month exit probability compounds monthly hazards",
    pWalk, 1 - Math.pow(1 - 0.02, 2) * Math.pow(1 - 0.005, 6) * Math.pow(1 - 0.001, 4), 1e-9);
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**; export `sigHazardAt_, sigCliffFactor_, sigPersonExitProb_`:

```js
/** Effective monthly hazard at a tenure (months); pooled buckets read forward. */
function sigHazardAt_(tenureMonths, hz, starts) {
  let i = sigBucketOf_(tenureMonths, starts);
  while (i < hz.buckets.length && hz.buckets[i].pooledWithNext) i++;
  const b = hz.buckets[i];
  return b && b.hazard != null ? b.hazard : 0;
}

/**
 * Factor 4 — tenure cliff. Hot bucket = fitted hazard above the median of
 * all fitted (non-null) bucket hazards. Fires when the person is inside one
 * or reaches one within CLIFF_LOOKAHEAD_MONTHS.
 */
function sigCliffFactor_(tenureMonths, hz, starts, cfg) {
  const fitted = hz.buckets.filter(b => b.hazard != null).map(b => b.hazard);
  if (tenureMonths == null || !fitted.length) {
    return { fired: false, measurable: false, band: null, detail: {} };
  }
  const hot = sigMedian_(fitted);
  let fired = false;
  for (let m = 0; m <= cfg.CLIFF_LOOKAHEAD_MONTHS; m++) {
    if (sigHazardAt_(tenureMonths + m, hz, starts) > hot) { fired = true; break; }
  }
  return { fired, measurable: true, band: fired ? "cliff" : "clear", detail: {} };
}

/**
 * Expected exit probability over the horizon: 1 − Π(1 − h(tenure at month t)).
 * Entirely fact-derived — no run-rate hand-waving.
 */
function sigPersonExitProb_(tenureMonths, hz, starts, horizonMonths) {
  if (tenureMonths == null) return null;
  let survive = 1;
  for (let m = 0; m < horizonMonths; m++) {
    survive *= 1 - sigHazardAt_(tenureMonths + m, hz, starts);
  }
  return 1 - survive;
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(signals): tenure-cliff factor + hazard-walk person forecast"`

---

### Task 6: Risk stack assembly + cohort rollup — `sigRiskStack_`

Per-person factor evaluation, SI amplifier, cohort rollup **job family × region** with per-factor coverage. Counts only in the rollup — named people carried in a separate `people` array for the drill (spec: counts on signals, names on drill).

**Files:** Modify `Signals.js`, `tests/signals_tests.js`.

- [ ] **Step 1: Write failing tests** (append):

```js
  // sigRiskStack_(actives, deps, cfg) — actives are roster records enriched by
  // the caller with: comp, benchMean, peerComps, monthsSinceRaise,
  // monthsSincePromo, tenureMonths, siLatest.
  const R_CFG = { MARKET_MIN: 0.85, PEER_MIN: 0.90, PEER_MIN_COHORT: 3,
    STALE_COMP_MONTHS: 18, STALE_PROMO_MONTHS: 36, CLIFF_LOOKAHEAD_MONTHS: 3,
    MIN_FACTORS_AT_RISK: 2, SI_HIGH: 4.5,
    HAZARD_BUCKETS_MONTHS: [0, 6, 12, 18, 24, 36, 60], HAZARD_MIN_EXITS: 1,
    FORECAST_HORIZON_MONTHS: 12 };
  const hzR = { buckets: [
    { fromM: 0, toM: 6, hazard: 0.001 }, { fromM: 6, toM: 12, hazard: 0.03 },
    { fromM: 12, toM: null, hazard: 0.001 }] };
  const mk = o => Object.assign({
    empNo: "E" + Math.floor(o.comp || 0), name: "P", jobFamily: "JF009", region: "LATAM",
    keyLocation: "Chile", level: "I3", jobTitle: "09. SD I3",
    comp: 100, benchMean: 100, peerComps: [100, 100, 100],
    monthsSinceRaise: 5, monthsSincePromo: 10, tenureMonths: 30, siLatest: null,
  }, o);
  // Two factors → at risk; one factor → not.
  const stack = SIG.sigRiskStack_([
    mk({ empNo: "A", comp: 80 }),                                   // market+peer fire → at risk
    mk({ empNo: "B", monthsSinceRaise: 20 }),                       // stale only → not
    mk({ empNo: "C", comp: 80, benchMean: null, siLatest: 4.6 }),   // peer only → not, but high perf
  ], { hazard: hzR, hazardStarts: R_CFG.HAZARD_BUCKETS_MONTHS }, R_CFG);
  eq("at-risk needs ≥2 factors", stack.people.filter(p => p.atRisk).map(p => p.empNo), ["A"]);
  eq("high performer flag rides along", stack.people.find(p => p.empNo === "C").highPerformer, true);
  const co = stack.cohorts[0];
  eq("cohort key is family×region", [co.jobFamily, co.region], ["JF009", "LATAM"]);
  eq("cohort counts, never names", [co.headcount, co.atRisk], [3, 1]);
  eq("factor coverage counted per cohort", co.coverage.market, { measurable: 2, total: 3 });
  near("cohort forecast sums person walks", co.expectedExits12m,
    stack.people.reduce((t, p) => t + (p.exitProb12m || 0), 0), 1e-9);
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**; export `sigRiskStack_`:

```js
/**
 * Full per-person factor stack + family × region cohort rollup.
 * @param {Array} actives Roster records pre-enriched by the GAS layer with:
 *        comp, benchMean, peerComps (self excluded), monthsSinceRaise,
 *        monthsSincePromo, tenureMonths, siLatest (?number).
 * @param {{hazard, hazardStarts}} deps Fitted hazard (sigHazardFit_ output).
 * @param {Object} cfg CONFIG_AI.SIGNALS.
 * @returns {{people: Array, cohorts: Array}} people carry names for the drill;
 *          cohorts carry ONLY counts (identity guardrail, spec §identity).
 */
function sigRiskStack_(actives, deps, cfg) {
  const people = actives.map(a => {
    const f = {
      market: sigMarketFactor_(a.comp, a.benchMean, cfg),
      peer:   sigPeerFactor_(a.comp, a.peerComps, cfg),
      stale:  sigStaleFactor_(a.monthsSinceRaise, a.monthsSincePromo, cfg),
      cliff:  sigCliffFactor_(a.tenureMonths, deps.hazard, deps.hazardStarts, cfg),
    };
    const firedCount = Object.keys(f).filter(k => f[k].fired).length;
    const highPerformer = typeof a.siLatest === "number" && a.siLatest >= cfg.SI_HIGH;
    return {
      empNo: a.empNo, name: a.name, jobFamily: a.jobFamily, region: a.region,
      keyLocation: a.keyLocation, level: a.level,
      factors: f, firedCount,
      atRisk: firedCount >= cfg.MIN_FACTORS_AT_RISK,
      highPerformer,
      exitProb12m: sigPersonExitProb_(a.tenureMonths, deps.hazard, deps.hazardStarts,
        cfg.FORECAST_HORIZON_MONTHS),
    };
  });
  const byKey = {};
  people.forEach(p => {
    const k = p.jobFamily + "||" + p.region;
    const c = byKey[k] = byKey[k] || {
      jobFamily: p.jobFamily, region: p.region, headcount: 0, atRisk: 0,
      highPerfAtRisk: 0, expectedExits12m: 0,
      factorFired: { market: 0, peer: 0, stale: 0, cliff: 0 },
      coverage: {
        market: { measurable: 0, total: 0 }, peer: { measurable: 0, total: 0 },
        stale: { measurable: 0, total: 0 }, cliff: { measurable: 0, total: 0 },
      },
    };
    c.headcount++;
    if (p.atRisk) c.atRisk++;
    if (p.atRisk && p.highPerformer) c.highPerfAtRisk++;
    if (p.exitProb12m != null) c.expectedExits12m += p.exitProb12m;
    Object.keys(p.factors).forEach(k2 => {
      c.coverage[k2].total++;
      if (p.factors[k2].measurable) c.coverage[k2].measurable++;
      if (p.factors[k2].fired) c.factorFired[k2]++;
    });
  });
  const cohorts = Object.keys(byKey).map(k => byKey[k])
    .sort((a, b) => b.atRisk - a.atRisk || b.headcount - a.headcount);
  cohorts.forEach(c => { c.expectedExits12m = Math.round(c.expectedExits12m * 10) / 10; });
  return { people, cohorts };
}
```

Note: the test asserts the raw sum; keep the assertion tolerant (`1e-9` is fine because rounding to one decimal only changes the shipped cohort value — assert against `stack.people` sums BEFORE rounding by comparing to `co.expectedExits12m` with tolerance `0.05` instead). **Adjust the test's tolerance to `0.05`.**

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(signals): risk stack — 4 factors, ≥2 to fire, SI amplifier, family×region rollup with coverage"`

---

### Task 7: Dual-gate group signal (replaces the two competing definitions)

Server-side only. A group fires when it is above the **company** rate AND above its **own** complete-FY history (spec §2). `aiGroupSignals_` grows an `ownBenchRate` and the client's `benchAndNow` notion dies in Task 10.

**Files:** Modify `Attritionintel.js` (`aiSignalStatus_` at ~line 815, `aiGroupSignals_` at ~line 1382, callers at ~line 1557), `tests/signals_tests.js`.

- [ ] **Step 1: Write failing tests** (append — these exercise `AI`, not `SIG`):

```js
  // Dual gate: above company AND above own history. Floors unchanged.
  eq("fires only past both gates", AI.aiSignalStatus_(4, 0.20, 0.10, 0.10), "signal");
  eq("above company but within own norm = quiet",
    AI.aiSignalStatus_(4, 0.20, 0.10, 0.25), "quiet");
  eq("above own norm but not company = quiet",
    AI.aiSignalStatus_(4, 0.12, 0.10, 0.05), "quiet");
  eq("no history yet → company gate only (labelled by caller)",
    AI.aiSignalStatus_(4, 0.20, 0.10, null), "signal");
  eq("floor still wins", AI.aiSignalStatus_(2, 0.9, 0.1, 0.1), "low-n");
```

- [ ] **Step 2: Run** — Expected: FAIL (4-arg calls return wrong verdicts).

- [ ] **Step 3: Replace `aiSignalStatus_`** in `Attritionintel.js` (keep the name — every caller updates in this task):

```js
/**
 * Signal status for one group in one window — THE one hot-group definition
 * (v1.4.0 dual gate; replaces both the old company-only server rule and the
 * client's own-history-only "benchAndNow" rule, which disagreed).
 * Gate 1: rate ≥ companyRate + SIGNAL_MIN_DELTA_PP.
 * Gate 2: rate above the group's OWN complete-FY mean (skipped when the
 *         group has no history — a brand-new group can still fire on gate 1).
 * @param {number} exits
 * @param {?number} rate
 * @param {?number} companyRate
 * @param {?number} ownBenchRate Group's own complete-FY mean rate, or null.
 * @param {Object=} cfg
 * @returns {'signal'|'quiet'|'low-n'}
 */
function aiSignalStatus_(exits, rate, companyRate, ownBenchRate, cfg) {
  const c = cfg || CONFIG_AI;
  if (!exits) return "quiet";
  if (exits < c.MIN_GROUP_EXITS) return "low-n";
  if (rate == null || companyRate == null) return "low-n";
  const aboveCompany = (rate - companyRate) * 100 >= c.SIGNAL_MIN_DELTA_PP;
  const aboveOwn = ownBenchRate == null ? true : rate > ownBenchRate;
  return aboveCompany && aboveOwn ? "signal" : "quiet";
}
```

- [ ] **Step 4: Update `aiGroupSignals_`** to compute the group's own complete-FY bench and pass it. Replace the function body's return-mapping with:

```js
function aiGroupSignals_(records, dimField, fy, asOf, companyRate, completeFys) {
  const groups = [...new Set(records.map(r => r[dimField]).filter(g => g && g !== "—"))].sort();
  return groups.map(g => {
    const inGrp = records.filter(r => r[dimField] === g);
    const m = aiWindowMovement_(inGrp, fy, asOf);
    // Own history = mean rate over the COMPLETE FYs in the window (v1.4.0
    // gate 2; also feeds the pace cards so the client stops re-deriving it).
    const histRates = (completeFys || [])
      .filter(f => f.label !== fy.label)
      .map(f => aiWindowMovement_(inGrp, f, asOf).rate)
      .filter(r => r != null);
    const ownBenchRate = histRates.length
      ? histRates.reduce((t, x) => t + x, 0) / histRates.length : null;
    const leavers = inGrp.filter(r => r.exitFy === fy.label);
    const cost = leavers.reduce((t, r) => t + (r.backfillCost || 0), 0);
    const compLinked = leavers.filter(r => r.compDriven).length;
    const regretted = leavers.filter(r => r.regretted).length;
    return {
      dim: dimField, group: g, fy: fy.label,
      exits: m.exits, hires: m.hires,
      activeNow: inGrp.filter(r => r.active).length,
      avgHeadcount: Math.round(m.avgHeadcount * 10) / 10,
      rate: m.rate, annualizedRate: m.annualizedRate,
      companyRate,
      ownBenchRate: ownBenchRate != null ? Math.round(ownBenchRate * 10000) / 10000 : null,
      deltaPp: (m.rate != null && companyRate != null)
        ? Math.round((m.rate - companyRate) * 1000) / 10 : null,
      status: aiSignalStatus_(m.exits, m.rate, companyRate, ownBenchRate),
      cost: Math.round(cost),
      unpriced: leavers.filter(r => r.backfillCost == null).length,
      compLinked, regretted,
    };
  });
}
```

- [ ] **Step 5: Update the caller** in `aiBuildPayload_` (~line 1557):

```js
  const completeFys = fys.filter(f => !f.inProgress);
  fys.forEach((fy, i) => {
    const companyRate = movementByFy[i].rate;
    CONFIG_AI.SIGNAL_DIMS.forEach(dim => {
      signals.push.apply(signals, aiGroupSignals_(records, dim, fy, asOf, companyRate, completeFys));
    });
  });
```

- [ ] **Step 6: Update the four existing `aiSignalStatus_` self-tests** inside `aiRunSelfTests` (~lines 2015-2018) to the new arity, and add the dual-gate cases:

```js
  eq("2 exits at any rate = low-n", aiSignalStatus_(2, 0.5, 0.1, null), "low-n");
  eq("3 exits +6pp, no history = signal", aiSignalStatus_(3, 0.16, 0.10, null), "signal");
  eq("3 exits +4pp = quiet", aiSignalStatus_(3, 0.14, 0.10, null), "quiet");
  eq("0 exits = quiet, never an alarm", aiSignalStatus_(0, null, 0.10, null), "quiet");
  eq("dual gate: within own norm = quiet", aiSignalStatus_(3, 0.16, 0.10, 0.20), "quiet");
  eq("dual gate: past both = signal", aiSignalStatus_(3, 0.16, 0.10, 0.12), "signal");
```

Also update the Task 0 harness line `eq("aiSignalStatus_ floor", ...)` — it already passes 3 args and stays valid (4th is `undefined` ≡ null-history behaviour, verdict unchanged: `low-n`).

- [ ] **Step 7: Run** `node tests/run_tests.js` — Expected: PASS.

- [ ] **Step 8: Commit** — `git commit -am "feat: dual-gate hot-group definition — one rule, server-side, own-history + company gates"`

---

### Task 8: GAS readers (benchmarks, SI ratings) + risk payload assembly

**Files:** Modify `Attritionintel.js` (GAS layer, after `aiReadCompHistory_`), `tests/signals_tests.js` (pure parts only).

- [ ] **Step 1: Add the source-id plumbing.** In `aiSourceIds_()` (~line 991) extend the returned object:

```js
    benchSsId:    p.getProperty("AI_BENCH_SS_ID")    || CONFIG_AI.BENCH_SS_ID,
    benchTab:     p.getProperty("AI_BENCH_TAB")      || CONFIG_AI.BENCH_TAB,
    siSsId:       p.getProperty("AI_SI_SS_ID")       || CONFIG_AI.PERF.SI_SS_ID,
    siTab:        p.getProperty("AI_SI_TAB")         || CONFIG_AI.PERF.SI_TAB,
    snapshotSsId: p.getProperty("AI_SNAPSHOT_SS_ID") || CONFIG_AI.SNAPSHOT_SS_ID,
    snapshotTab:  p.getProperty("AI_SNAPSHOT_TAB")   || CONFIG_AI.SNAPSHOT_TAB,
```

- [ ] **Step 2: Add the two readers** (after `aiReadCompHistory_`, following its shape — throws are caught by the caller and degrade to labelled unavailability):

```js
/**
 * PayScale market benchmarks — the Compilation sheet, read as-is.
 * @returns {Object} sigNormKey_(location, jobTitle) → {mean, p25, p75, source}
 * @throws when the source id is unset or the tab/columns are missing.
 */
function aiReadBenchmarks_() {
  const src = aiSourceIds_();
  if (!src.benchSsId) throw new Error("Benchmark source not configured (AI_BENCH_SS_ID).");
  const { headers, rows } = aiFetchTab_(src.benchSsId, src.benchTab);
  const col = (want, re) => {
    const i = headers.findIndex(h => String(h).trim() === want);
    if (i !== -1) return i;
    const j = headers.findIndex(h => re.test(String(h)));
    if (j === -1) throw new Error('Benchmark column "' + want + '" not found.');
    return j;
  };
  const cLoc = col("Location", /location/i), cTitle = col("Job Title", /job\s*title/i);
  const cMean = col("Mean TCC", /mean/i);
  const cP25 = col("25th Percentile TCC", /25th/i), cP75 = col("75th Percentile TCC", /75th/i);
  const cSrc = col("Source", /source/i);
  const out = {};
  rows.forEach(row => {
    const mean = aiAsNum_(row[cMean]);
    if (mean == null || mean <= 0) return;   // a bench row without a mean anchors nothing
    out[sigNormKey_(row[cLoc], row[cTitle])] = {
      mean, p25: aiAsNum_(row[cP25]), p75: aiAsNum_(row[cP75]),
      source: String(row[cSrc] || "").trim(),
    };
  });
  return out;
}

/**
 * Small Improvements ratings — real performance records (fills the v1.3.1
 * regretted-proxy stub). Latest completed-quarter rate per employee.
 * @returns {Object} empNo → {latest: number, fq: string, count: number}
 * @throws when the source id is unset or columns are missing.
 */
function aiReadRatings_() {
  const src = aiSourceIds_();
  if (!src.siSsId) throw new Error("SI source not configured (AI_SI_SS_ID).");
  const { headers, rows } = aiFetchTab_(src.siSsId, src.siTab);
  const col = (want, re) => {
    const i = headers.findIndex(h => String(h).trim() === want);
    if (i !== -1) return i;
    const j = headers.findIndex(h => re.test(String(h)));
    if (j === -1) throw new Error('SI column "' + want + '" not found.');
    return j;
  };
  const cId = col("ID", /^id$/i), cFq = col("Fiscal Quarter", /fiscal\s*quarter/i);
  const cRate = col("Rate", /^rate$/i);
  const fqKey = fq => {
    const m = /FY\s*(\d+).*Q\s*(\d)/i.exec(String(fq || ""));
    return m ? parseInt(m[1], 10) * 10 + parseInt(m[2], 10) : -1;
  };
  const byEmp = {};
  rows.forEach(row => {
    const emp = String(row[cId] || "").trim();
    const rate = aiAsNum_(row[cRate]);
    const key = fqKey(row[cFq]);
    if (!emp || rate == null || key < 0) return;
    const cur = byEmp[emp];
    if (!cur || key > cur._k) byEmp[emp] = { latest: rate, fq: String(row[cFq]).trim(), count: (cur ? cur.count : 0) + 1, _k: key };
    else cur.count++;
  });
  Object.keys(byEmp).forEach(k => delete byEmp[k]._k);
  return byEmp;
}
```

(`sigNormKey_` is global in `Signals.js`, visible across GAS files — same pattern the app already relies on between `security.js` and `Attritionintel.js`.)

- [ ] **Step 3: Assemble `computed.risk` in `aiBuildPayload_`.** Insert after the growth-enrichment block (after `records.forEach(...)` that sets `r.lastRaiseIso`, ~line 1550):

```js
  // ── Structural risk stack + hazard forecast (v1.4.0, Signals.js) ─────────
  const sigCfg = aiSignalsCfg_();
  let benchByKey = {}, benchOk = true, benchErr = "";
  try { benchByKey = aiReadBenchmarks_(); } catch (e) { benchOk = false; benchErr = e.message; }
  let siByEmp = {}, siOk = true, siErr = "";
  try { siByEmp = aiReadRatings_(); } catch (e) { siOk = false; siErr = e.message; }

  const windowStart = fys[0].start;
  const hazard = sigHazardFit_(
    records.map(r => ({
      hireDate: r.hireDate,
      termDate: r.exitFy ? r.termDate : null,      // realised exits only
      voluntary: r.tone === "voluntary",
    })), windowStart, asOf, sigCfg);

  // Enrich ACTIVES with everything the pure stack needs. compValOf and
  // locCurrencies are the same currency-resolution rule the anchor block uses.
  const actives = records.filter(r => r.active && !r.leavingSoon);
  const enriched = actives.map(r => {
    const comp = compValOf(r);
    const bench = benchByKey[sigNormKey_(r.keyLocation, r.jobTitle)] || null;
    const peers = actives.filter(o =>
      o !== r && o.jobFamily === r.jobFamily && o.level === r.level &&
      o.keyLocation === r.keyLocation);
    const evs = (histOk && r.empNo && histByEmp[r.empNo]) ? aiSortedEvents_(histByEmp[r.empNo]) : null;
    let monthsSinceRaise = null, monthsSincePromo = null;
    if (evs && evs.length) {
      let lastRaise = null, lastPromo = null;
      evs.forEach(e => {
        const cls = aiClassifyLever_(e.reason);
        if (cls === "promo" || cls === "adjust") lastRaise = e.date;
        if (cls === "promo") lastPromo = e.date;
      });
      monthsSinceRaise = lastRaise ? sigMonthsBetween_(lastRaise, asOf) : sigMonthsBetween_(evs[0].date, asOf);
      monthsSincePromo = lastPromo ? sigMonthsBetween_(lastPromo, asOf)
        : (r.hireDate ? sigMonthsBetween_(r.hireDate, asOf) : null);
    }
    const si = siOk && r.empNo ? siByEmp[r.empNo] : null;
    return {
      empNo: r.empNo, name: r.name, jobFamily: r.jobFamily, region: r.region,
      keyLocation: r.keyLocation, level: r.level, jobTitle: r.jobTitle,
      comp, benchMean: bench ? bench.mean : null,
      peerComps: peers.map(compValOf).filter(v => v != null),
      monthsSinceRaise, monthsSincePromo,
      tenureMonths: r.hireDate ? sigMonthsBetween_(r.hireDate, asOf) : null,
      siLatest: si ? si.latest : null,
    };
  });
  const stack = sigRiskStack_(enriched, { hazard, hazardStarts: sigCfg.HAZARD_BUCKETS_MONTHS }, sigCfg);
```

And add the config-merge helper near `aiSourceIds_`:

```js
/** CONFIG_AI.SIGNALS with the AI_SIGNALS Script Property merged over it. */
function aiSignalsCfg_() {
  return Object.assign({}, CONFIG_AI.SIGNALS, aiPropMap_("AI_SIGNALS", {}));
}
```

- [ ] **Step 4: Ship it.** In the returned `computed` object add (after `growth: {...}`):

```js
      risk: {
        benchAvailable: benchOk, benchError: benchOk ? "" : benchErr,
        siAvailable: siOk, siError: siOk ? "" : siErr,
        hazard: {
          starts: sigCfg.HAZARD_BUCKETS_MONTHS.slice(),
          buckets: hazard.buckets.map(b => ({
            fromM: b.fromM, toM: b.toM, personMonths: b.personMonths,
            volExits: b.volExits,
            hazard: b.hazard != null ? Math.round(b.hazard * 1e5) / 1e5 : null,
            pooledWithNext: b.pooledWithNext, pooledFromPrev: b.pooledFromPrev,
          })),
        },
        cohorts: stack.cohorts,
        // Names for the drill only — never in cohort rows or exports.
        people: stack.people.filter(p => p.atRisk).map(p => ({
          empNo: p.empNo, name: p.name, jobFamily: p.jobFamily, region: p.region,
          keyLocation: p.keyLocation, level: p.level,
          fired: Object.keys(p.factors).filter(k => p.factors[k].fired),
          highPerformer: p.highPerformer,
        })),
        totals: {
          actives: enriched.length,
          atRisk: stack.people.filter(p => p.atRisk).length,
          highPerfAtRisk: stack.people.filter(p => p.atRisk && p.highPerformer).length,
          expectedExits12m: Math.round(stack.people.reduce(
            (t, p) => t + (p.exitProb12m || 0), 0) * 10) / 10,
        },
      },
```

- [ ] **Step 5: Echo the rules.** In `meta.rules` (~line 1352) add:

```js
        signals: aiSignalsCfg_(),
```

and change `perfSource: CONFIG_AI.PERF.SOURCE` to stay as-is (it now reads "small-improvements").

- [ ] **Step 6: Export the new pure caller-visible symbols.** In the `module.exports` block of `Attritionintel.js` nothing new is needed (readers are GAS-layer), but `Signals.js` functions used above must exist in GAS: confirm `Signals.js` has no `require` and both files are plain top-level declarations. Run `node tests/run_tests.js` — Expected: PASS (no regressions; readers aren't Node-tested).

- [ ] **Step 7: Commit** — `git commit -am "feat: benchmark + SI readers, computed.risk payload with hazard, cohorts, drill people, coverage"`

---

### Task 9: Monthly snapshot store + MoM deltas

**Files:** Modify `Attritionintel.js` (GAS layer), `Signals.js` (pure delta), `tests/signals_tests.js`.

- [ ] **Step 1: Pure MoM delta — failing test first** (append):

```js
  // sigMomDelta_(currentCohorts, prevRows) — prevRows are snapshot rows
  // {monthKey, jobFamily, region, atRisk} for the PREVIOUS month.
  const mom = SIG.sigMomDelta_(
    [{ jobFamily: "JF009", region: "LATAM", atRisk: 12 }],
    [{ monthKey: "2026-07", jobFamily: "JF009", region: "LATAM", atRisk: 9 }]);
  eq("MoM delta computed per cohort", mom["JF009||LATAM"], { prev: 9, delta: 3 });
  eq("no prior month → empty map", SIG.sigMomDelta_([{ jobFamily: "X", region: "Y", atRisk: 1 }], []), {});
```

- [ ] **Step 2: Run** — FAIL. **Implement** in `Signals.js` and export:

```js
/** Month-over-month at-risk delta per cohort, from frozen snapshot rows. */
function sigMomDelta_(currentCohorts, prevRows) {
  const out = {};
  if (!prevRows || !prevRows.length) return out;
  const prevBy = {};
  prevRows.forEach(r => { prevBy[r.jobFamily + "||" + r.region] = (prevBy[r.jobFamily + "||" + r.region] || 0) + (r.atRisk ? 1 : r.atRisk === 0 ? 0 : Number(r.atRisk) || 0); });
  // prevRows may be per-person (atRisk boolean) or pre-aggregated (atRisk count);
  // both sum correctly because booleans coerce 1/0 via the expression above.
  currentCohorts.forEach(c => {
    const k = c.jobFamily + "||" + c.region;
    if (prevBy[k] == null) return;
    out[k] = { prev: prevBy[k], delta: c.atRisk - prevBy[k] };
  });
  return out;
}
```

Run — Expected: PASS. Commit: `git commit -am "feat(signals): MoM at-risk delta from frozen snapshot rows"`

- [ ] **Step 3: GAS writer + reader** (after `aiReadRatings_` in `Attritionintel.js`):

```js
const AI_SNAPSHOT_HEADERS_ = ["monthKey", "empNo", "jobFamily", "region", "keyLocation",
  "level", "f_market", "f_peer", "f_stale", "f_cliff", "firedCount", "atRisk",
  "highPerformer", "tenureBucket"];

/**
 * Freezes this month's per-person factor states into the snapshot store.
 * Idempotent per month: existing rows for the month are replaced, not doubled.
 * Run by the monthly trigger (aiSetupSnapshotTrigger) or manually as owner.
 */
function aiWriteMonthlySnapshot() {
  const src = aiSourceIds_();
  if (!src.snapshotSsId) throw new Error("Snapshot store not configured (AI_SNAPSHOT_SS_ID).");
  const payload = aiBuildPayload_();
  const tz = Session.getScriptTimeZone() || "Etc/UTC";
  const monthKey = Utilities.formatDate(new Date(), tz, "yyyy-MM");
  const ss = SpreadsheetApp.openById(src.snapshotSsId);
  const sheet = ss.getSheetByName(src.snapshotTab) || ss.insertSheet(src.snapshotTab);
  if (sheet.getLastRow() === 0) sheet.appendRow(AI_SNAPSHOT_HEADERS_);
  // Replace any rows already written for this month (idempotence).
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === monthKey) sheet.deleteRow(i + 1);
  }
  const rows = payload.computed.risk.peopleAll.map(p => [
    monthKey, p.empNo, p.jobFamily, p.region, p.keyLocation, p.level,
    p.fired.indexOf("market") !== -1, p.fired.indexOf("peer") !== -1,
    p.fired.indexOf("stale") !== -1, p.fired.indexOf("cliff") !== -1,
    p.fired.length, p.atRisk, p.highPerformer, p.tenureBucket || "",
  ]);
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  Logger.log("aiWriteMonthlySnapshot: " + rows.length + " rows frozen for " + monthKey);
  aiBustCache_();   // the Risk tab's MoM read must see the new month at once
  return monthKey + ": " + rows.length + " rows";
}

/**
 * Snapshot rows for the latest FROZEN month strictly before the current one.
 * @returns {{monthKey: ?string, rows: Array}}
 */
function aiReadPrevSnapshot_() {
  const src = aiSourceIds_();
  if (!src.snapshotSsId) return { monthKey: null, rows: [] };
  try {
    const ss = SpreadsheetApp.openById(src.snapshotSsId);
    const sheet = ss.getSheetByName(src.snapshotTab);
    if (!sheet || sheet.getLastRow() < 2) return { monthKey: null, rows: [] };
    const tz = Session.getScriptTimeZone() || "Etc/UTC";
    const cur = Utilities.formatDate(new Date(), tz, "yyyy-MM");
    const data = sheet.getDataRange().getValues();
    const head = data[0].map(String);
    const idx = {}; AI_SNAPSHOT_HEADERS_.forEach(h => { idx[h] = head.indexOf(h); });
    let best = null;
    data.slice(1).forEach(r => {
      const mk = String(r[idx.monthKey]);
      if (mk < cur && (!best || mk > best)) best = mk;
    });
    if (!best) return { monthKey: null, rows: [] };
    return {
      monthKey: best,
      rows: data.slice(1).filter(r => String(r[idx.monthKey]) === best).map(r => ({
        monthKey: best, jobFamily: String(r[idx.jobFamily]), region: String(r[idx.region]),
        atRisk: r[idx.atRisk] === true || String(r[idx.atRisk]).toLowerCase() === "true",
      })),
    };
  } catch (e) {
    Logger.log("⚠️ aiReadPrevSnapshot_: " + e.message);
    return { monthKey: null, rows: [] };
  }
}

/** One-time monthly trigger (owner runs once in the editor). */
function aiSetupSnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "aiWriteMonthlySnapshot") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("aiWriteMonthlySnapshot").timeBased().onMonthDay(1).atHour(3).create();
  return "Monthly snapshot trigger installed (1st, ~03:00).";
}
```

- [ ] **Step 4: `peopleAll` for the writer + MoM wiring.** In Task 8's `computed.risk`, the writer above needs ALL people (not just at-risk). Extend `computed.risk` with a full (name-free) list and the MoM read:

```js
        peopleAll: stack.people.map(p => ({
          empNo: p.empNo, jobFamily: p.jobFamily, region: p.region,
          keyLocation: p.keyLocation, level: p.level,
          fired: Object.keys(p.factors).filter(k => p.factors[k].fired),
          atRisk: p.atRisk, highPerformer: p.highPerformer,
        })),
        snapshot: (() => {
          const prev = aiReadPrevSnapshot_();
          return {
            available: !!prev.monthKey, prevMonthKey: prev.monthKey,
            mom: sigMomDelta_(stack.cohorts, prev.rows),
          };
        })(),
```

Note `peopleAll` deliberately omits `name` — it feeds the snapshot writer and cohort math only. `people` (at-risk, with names) remains the drill's source. **Before shipping to the client**, strip `peopleAll` from the payload in `aiGetReportData` is NOT needed — it carries no names and is small; leave it (the Risk tab uses it for factor-mix bars).

- [ ] **Step 5: Sanity run** `node tests/run_tests.js` — Expected: PASS (GAS-only code paths aren't exercised, but the file must still parse under Node: `node -e "require('./Attritionintel.js')"` — Expected: no throw).

- [ ] **Step 6: Commit** — `git commit -am "feat: monthly snapshot store — idempotent writer, prev-month reader, monthly trigger, MoM wiring"`

---

### Task 10: Frontend — delete client engines, consume server numbers

**Files:** Modify `AttritionView.html`.

- [ ] **Step 1: Delete these client functions entirely** (locations per v1.3.1): `hcOpenOn`/`hcCloseOn` (~:778-787), `fyStats` (~:790), `signalStatus` (~:810), `benchAndNow` (~:1115), `medianOf` (~:1730). Keep `levelSort` (pure display ordering, no server twin shipped per record set — it sorts filter options).

- [ ] **Step 2: Repoint the consumers.** Every panel that called them now reads `DATA.computed.signals` rows (which since Task 7 carry `activeNow`, `ownBenchRate`, `annualizedRate`, `status`):
  - `paceCard` (~:1328): bar = row.annualizedRate for the focus FY; tick = row.ownBenchRate; "above benchmark" chip = `row.status === "signal"`; "early (n<3)" = `row.status === "low-n"`. Group rows come from `DATA.computed.signals.filter(s => s.fy === focusFy && s.dim === dimField)`.
  - `deptRegionMatrixCard` (~:1143): cell colour from the FY25+FY26 rows' mean `rate` for that dept×region pair — the server signal rows for `dim === "dept"` don't carry region×dept pairs, so this card keeps its own **counting** (counts from records are fine to derive client-side — the rule being enforced is that *rates and verdicts* come from the server). Replace its `benchAndNow()` internals with a local helper that ONLY counts exits/headcount from records but takes its per-FY company/group *rates* from `DATA.computed.signals` where a matching row exists; where none exists (a dept×region cell is not a signal dim), compute the mean annual rate inline but render NO verdict chip on cells — verdicts only ever come from `status`. Add a comment stating this boundary.
  - `cohortBullet`/`cohortStats` in Trends (~:2053-2230): status chip = the server row's `status` when `TRENDCUT` is a server dim (`dept`/`keyLocation`/`region`); for client-only cuts (jobFamily, level, supervisorKey, tenureBucket) render the neutral chip "view-only cut — no signal verdicts" instead of computing one. This removes the second signal definition from the UI completely.

- [ ] **Step 3: Per-panel filter honesty.** In `renderControls()` (~:485) no change; in `render()` add per-panel disabling — before building Trends panels compute:

```js
function setFilterDisabled(id, disabled, why) {
  var el = document.getElementById(id);
  if (!el) return;
  el.disabled = !!disabled;
  el.title = disabled ? why : "";
}
```

and when the active tab is Trends: `setFilterDisabled("fFy", false)` but for the two company-wide growth panels append to their `note()` the existing disclosure; additionally in `filtered()` (~:589) make `FILTERS.reason` and `FILTERS.fy` apply consistently: change the two `leaversOnly`-gated lines so `reason` filters leavers within any panel that uses leaver subsets, and `cohortCard`'s focus-FY select keeps its repurposed meaning but the select's label switches to "Focus year" while on Trends (`switchTab` toggles the `.flabel` text of `fFy`). Concretely:
  - In `switchTab`, after `syncControls()`: `var fyLab = document.querySelector('#fFy') && document.querySelector('#fFy').closest('.fgroup').querySelector('.flabel'); if (fyLab) fyLab.textContent = (name === 'trends') ? 'Focus year' : 'Fiscal year';`
  - In Leavers rendering nothing changes (filters already honoured there).

- [ ] **Step 4: `meta.rules` discipline.** Replace the hardcoded literals with rule reads:
  - Comp-verdict cut-points `0.4`/`0.2` at (~:1014-1021 and ~:2250-2254): add to `CONFIG_AI` in `Attritionintel.js` `COMP_SHARE_HIGH: 0.4, COMP_SHARE_SOME: 0.2` (next to `COMP_CANDIDATE_REASONS`) and echo in `meta.rules` as `compShareHigh`/`compShareSome`; the two view sites read `DATA.meta.rules.compShareHigh` etc.
  - Pace-narrative `±2pp` (~:961-965) → `meta.rules.signalMinDeltaPp` is the wrong constant; add `PACE_NOTE_PP: 2` to `CONFIG_AI` + `meta.rules.paceNotePp`, read it.
  - Regretted-RISK `0.5` (~:970) → add `REGRET_RISK_SHARE: 0.5` + `meta.rules.regretRiskShare`, read it.
  - Reason names in prose (~:2299-2301) → build from `DATA.meta.rules.compDirectReasons` / `compCandidateReasons`.
- Export caption fix: `activeFilterText()` (~:2569) add region: `if (FILTERS.region) parts.push("Region: " + FILTERS.region);`

- [ ] **Step 5: Manual check** — `node -e "require('./Attritionintel.js')"` passes; open the HTML in a browser is not possible (google.script.run), so grep-verify no deleted function is still referenced:

```bash
grep -nE "benchAndNow|fyStats\(|signalStatus\(|hcOpenOn|hcCloseOn|medianOf\(" AttritionView.html
```

Expected: zero matches.

- [ ] **Step 6: Commit** — `git commit -am "refactor(view): delete client engines — server numbers only, per-panel filter honesty, rules-driven prose"`

---

### Task 11: Frontend — Overview dedup (tiles = numbers, brief = judgments, bridge line)

**Files:** Modify `AttritionView.html` (`renderOverview` ~:833, `execBriefCard` ~:948, `forecastLine` ~:1061, hero band ~:850-882).

- [ ] **Step 1: Hero band.** Keep the five tiles (exits so far / pace / regretted / est. cost / forecast) as the ONLY numeric headlines. Change the forecast tile to the hazard-based number:

```js
  var rk = DATA.computed.risk;
  tiles.push(heroTile("If the trend holds", rk && rk.totals ? fmtInt(rk.totals.expectedExits12m) : "—",
    "expected exits over the next 12 months — fitted from this company's own tenure hazard, voluntary exits only",
    null));
```

(`fmtInt` already exists; if the risk block is unavailable fall back to the old `computed.forecast.projectedExits` with its run-rate label.)

- [ ] **Step 2: Brief = judgments only.** In `execBriefCard`:
  - Delete the FACT lines that restate tile numbers (O7 exits-to-date, O8 pace restatement, O9 regretted restatement, O16 `forecastLine` NOTE — delete the `forecastLine` function too).
  - Keep and sharpen: per-fired-signal RISK+ACTION lines (O10/O11 — now driven by the dual-gate rows so they can never disagree with Trends chips), carry NOTE/ACTIONs (O12), quiet NOTE (O13), window comp-linked share RISK/FACT (O14 — now reading `meta.rules.compShareHigh/compShareSome`), leaver-vs-stayer growth gap (O15).
  - Add the risk bridge as the brief's closing line:

```js
  if (rk && rk.cohorts && rk.cohorts.length && rk.cohorts[0].atRisk > 0) {
    var top = rk.cohorts[0];
    lines.push(badge("RISK", "Next wave: the risk stack points at " +
      esc(famLabel(top.jobFamily)) + " in " + esc(top.region) + " — " +
      top.atRisk + " of " + top.headcount + " people carry ≥" +
      DATA.meta.rules.signals.MIN_FACTORS_AT_RISK + " structural factors" +
      (top.highPerfAtRisk ? " (" + top.highPerfAtRisk + " high performers)" : "") + "."));
    lines.push(badge("ACTION", "Open the ⚠ Risk tab for the factor mix, the hazard curve, and the named drill."));
  }
```

(`famLabel` = existing family-name helper used by the Leavers table; `badge` = the existing brief line builder — match its real signature when editing.)

- [ ] **Step 3: Regretted tile note keeps the prior-year comparison** (the tile keeps its `sply` note; the deleted brief line was the duplicate).

- [ ] **Step 4: "How to read these numbers"** (`overviewNotes` ~:1652): add a paragraph:

```
Forecast: fitted tenure-hazard (voluntary exits over person-months at risk in this
company's own history), walked over each active person's next 12 months — not a
run-rate. Risk: four structural factors per person (market position, peer equity,
recognition staleness, tenure cliff); at-risk = ≥2 firing. Factors are recalculated
monthly and frozen to the snapshot store; coverage is printed wherever a factor
cannot be measured.
```

Render every threshold in that paragraph from `DATA.meta.rules.signals`, not literals.

- [ ] **Step 5: Grep-verify the dedup:**

```bash
grep -c "forecastLine" AttritionView.html
```

Expected: 0.

- [ ] **Step 6: Commit** — `git commit -am "feat(view): overview dedup — tiles carry numbers, brief carries judgments, hazard forecast + risk bridge"`

---

### Task 12: Frontend — ⚠ Risk tab

**Files:** Modify `AttritionView.html` (nav ~:297-315, `switchTab` ~:439, `render()` dispatch, new `renderRisk()`), `Attritionintel.js` (`ROLE_TABS` ~:280).

- [ ] **Step 1: Server tab gate.** In `CONFIG_AI.ROLE_TABS` add `"risk"` to both roles, Overview-adjacent:

```js
  ROLE_TABS: {
    superadmin: ["overview", "risk", "trends", "leavers", "access"],
    admin:      ["overview", "risk", "trends", "leavers"],
  },
```

- [ ] **Step 2: Static markup.** Nav button after Overview: `<button type="button" class="tab" data-tab="risk" aria-selected="false">⚠ Risk</button>`; panel div after `#overview`: `<div id="riskPanel" class="panel-grid" hidden></div>`. Add `"riskPanel"` to the reset list in `load()` and the visibility lines in `switchTab` (`document.getElementById("riskPanel").hidden = name !== "risk";`). Filter bar stays hidden on Risk (`bar.hidden = (name === "access" || name === "overview" || name === "risk") || !DATA;`) — the Risk tab is company-wide, like Overview, with its own cohort table doing the slicing.

- [ ] **Step 3: `renderRisk()`** — follow the existing `card()`/`tools()`/`CHARTS` patterns exactly (chart flip, CSV; PNG allowed on the cohort table but NOT on the drill). Structure:

```js
function renderRisk() {
  var rk = DATA.computed.risk;
  var el = document.getElementById("riskPanel");
  if (!rk) { el.innerHTML = '<div class="errbox"><h2>Risk engine unavailable</h2></div>'; return; }
  var h = [];
  h.push(riskSummaryStrip(rk));      // 4 KPI tiles: at-risk now (+MoM), high performers at risk, expected exits 12m, coverage line
  h.push(riskCohortCard(rk));        // family × region table
  h.push(hazardCurveCard(rk));       // the fitted curve, bucket counts printed
  h.push(riskSourceNotes(rk));       // bench/SI availability + snapshot stamp
  el.innerHTML = h.join("");
}
```

Key rendering rules (each maps to a spec/inventory requirement):
  - **Summary strip:** `atRisk` with MoM (`rk.snapshot.available` → "was N in <prevMonthKey>"; else `"no snapshot yet — live view"`). Stamp line: `"as of <prevMonthKey or 'live'> · next recalc <1st of next month> (<ISO week label>)"`. Compute the ISO week client-side with a small `isoWeekOf(dateIso)` helper (copy the algorithm: Thursday-based, `YYYY.Www` format — org standard requires the week number alongside the date).
  - **Cohort table columns:** Family · Region · Headcount · At risk (count + MoM delta arrow when snapshot present) · High perf at risk · Factor mix (four mini-bars from `factorFired ÷ headcount`) · Expected exits 12m · Coverage (worst factor: "market 12/40"). Rows sorted by `atRisk` desc (server pre-sorts). Row click opens the drill.
  - **Counts, never rates,** on cohort rows (small-N safe by construction).
  - **Drill drawer** (`riskDrill(cohortKey)`): named list from `rk.people` filtered to the cohort — name, level, keyLocation, fired-factor chips, ★ marker for high performers. Render inside a `<details class="no-export">` block and make `downloadPng` skip `.no-export` nodes: in the PNG clone step add `clone.querySelectorAll(".no-export").forEach(function (n) { n.remove(); });` — this is the names-never-in-exports guarantee.
  - **Hazard curve card:** bar chart over buckets — x = tenure bucket label ("0–6m" … "60m+"), y = monthly hazard %, bar label = `volExits` count; pooled buckets render hatched/merged with a printed "pooled: <1 exit floor" note. Table flip: bucket / person-months / voluntary exits / monthly hazard / pooled note. Chart drawing uses the existing canvas `CHARTS` registration pattern from `exitTrendCard`.
  - **Source notes card:** when `!rk.benchAvailable` → "PayScale benchmark unavailable — market factor unmeasured for everyone (<error>)"; same for SI; snapshot store status; and the guardrail footer: "Signals propose focus. Decisions follow the Guiding Principles." Every threshold printed from `DATA.meta.rules.signals`.

- [ ] **Step 4: Dispatch.** In `render()` add `renderRisk();` alongside the other panel renders and gate the per-tab work: only re-render Risk when `TAB === "risk"` or on payload change (mirror how Overview is handled after Task 10's render-thrift; if `render()` still rebuilds all panels, just add it to the list).

- [ ] **Step 5: Manual grep checks:**

```bash
grep -n "data-tab=\"risk\"" AttritionView.html   # nav button present
grep -n "no-export" AttritionView.html            # drill guard + PNG skip both present (≥2 hits)
```

- [ ] **Step 6: Commit** — `git commit -am "feat(view): ⚠ Risk tab — summary strip, family×region cohorts, hazard curve, name-gated drill"`

---

### Task 13: Leavers recognition cell, dead-code removal, BUILD bump, docs, deploy checklist

**Files:** Modify `Attritionintel.js`, `AttritionView.html`, create `README-DEPLOY.md`.

- [ ] **Step 1: Leavers.** In `recogCell` (~:2413) render `lastRaiseIso` ("last raise <ISO>") and, when `DATA.computed.risk.siAvailable`, the leaver's latest SI is NOT available per-leaver client-side — do not fake it; instead the recognition cell shows the existing 24-month record + `lastRaiseIso` only. (SI per leaver would require shipping per-person ratings; YAGNI — the cohort-level SI amplifier is the decided scope.)

- [ ] **Step 2: Dead code removal** in `Attritionintel.js`: delete `REGULAR_RE`, `EOR_RE` (config), `aiLog_` + `DEBUG` key, `THEME.LOGO_URL` line; stop shipping `exitQuarter`, `pendingStart`, `track` in records (add the three keys to the strip list in the `shipped` map at ~:1611) — first grep the view to confirm nothing reads them:

```bash
grep -nE "exitQuarter|pendingStart|\.track\b" AttritionView.html
```

Expected: zero matches (v1.3.1 inventory says so; verify anyway). Also fix `overviewNotes` (~:1661) population claim to match reality: population = everyone minus crew/interns/pre-window leavers.

- [ ] **Step 3: BUILD + header.** `CONFIG_AI.BUILD: "1.4.0"`. Update the file-header changelog block (~:1-128): add a `1.4.0` section naming: dual-gate signal, Signals.js risk engine, hazard forecast replacing run-rate, SI + PayScale wiring, snapshot store, Risk tab, client-engine deletion, dedup pass. Update the GETTING STARTED block: add `AI_BENCH_SS_ID`, `AI_SI_SS_ID`, `AI_SNAPSHOT_SS_ID` properties, `aiSetupSnapshotTrigger()` step, and note `Signals.js` as a 4th file.

- [ ] **Step 4: Extend `aiRunSelfTests`** with GAS-side smoke of the new pure layer (Signals.js is loaded in the same GAS runtime):

```js
  // ── v1.4.0 signals engine (full fixtures live in tests/signals_tests.js) ──
  const sCfg = CONFIG_AI.SIGNALS;
  eq("market factor fires under threshold", sigMarketFactor_(80, 100, sCfg).fired, true);
  eq("peer factor needs a full cohort", sigPeerFactor_(50, [100, 100], sCfg).measurable, false);
  eq("stale fires past the comp leg", sigStaleFactor_(sCfg.STALE_COMP_MONTHS + 1, 0, sCfg).fired, true);
  const hzT = sigHazardFit_(
    [{ hireDate: new Date(2024, 6, 1), termDate: new Date(2025, 4, 1), voluntary: true }],
    new Date(2024, 6, 1), new Date(2026, 6, 1), sCfg);
  eq("hazard fit places the exit", hzT.buckets.reduce((t, b) => t + b.volExits, 0), 1);
```

- [ ] **Step 5: Full test run** — `node tests/run_tests.js` — Expected: all pass. Then `node -e "require('./Attritionintel.js'); require('./Signals.js')"` — no throw.

- [ ] **Step 6: Write `README-DEPLOY.md`** (in the working dir, clasp-ignored):

```markdown
# v1.4.0 deploy runbook

1. `clasp push` (pushes Attritionintel.js, Signals.js, security.js, AttritionView.html).
2. GAS editor as owner: run `aiRunSelfTests()` — expect all ✅.
3. Script Properties to set (Project Settings → Script Properties):
   - `AI_BENCH_SS_ID` = the Compilation (PayScale) spreadsheet id
   - `AI_SI_SS_ID`    = the Small Improvements RD spreadsheet id
   - `AI_SNAPSHOT_SS_ID` = a NEW empty spreadsheet id (create one, owner-only)
   Missing ids degrade gracefully — set what exists, the app labels the rest.
4. Run `aiDiagnose()` — check the log for reader ✅s.
5. Run `aiWriteMonthlySnapshot()` once (baseline month), then `aiSetupSnapshotTrigger()`.
6. Run `aiClearCache()` (BUILD bump already invalidates, but be explicit).
7. Reload the web app: verify ⚠ Risk tab renders, Overview forecast tile says
   "fitted from this company's own tenure hazard", brief has no number that
   repeats a tile, PNG export of the Risk cohort card contains no names.
8. New deployment version (Deploy → Manage deployments → Edit → New version).
```

- [ ] **Step 7: Commit** — `git commit -am "chore: v1.4.0 — leavers lastRaise, dead code out, changelog, self-tests, deploy runbook"`

---

### Task 14: Final self-review sweep + push gate

- [ ] **Step 1: Cross-file consistency grep** (types/signatures):

```bash
grep -n "aiSignalStatus_(" Attritionintel.js          # every call passes 4+ args
grep -n "sigRiskStack_\|sigHazardFit_\|sigMomDelta_" Attritionintel.js Signals.js
grep -nE "0\.4|0\.2" AttritionView.html               # no verdict literals left (chart geometry hits are fine — inspect each)
```

- [ ] **Step 2: Run everything** — `node tests/run_tests.js` green; both files `require`-clean.

- [ ] **Step 3: Spec walk** — open the spec and tick every §: dedup pairs gone (grep O7/O8-era prose), dual gate live, 4 factors + coverage, hazard voluntary-only, snapshot idempotent, readers degrade, Risk tab names-on-drill-only, PNG name guard, rules echoed.

- [ ] **Step 4: STOP — user gate.** `clasp push` only with the user's explicit go-ahead in the session (production script). Then follow `README-DEPLOY.md` steps 2–8 with the user (Script Properties values are theirs to provide: Compilation id, SI id, new snapshot spreadsheet).

---

## Self-review notes (already applied)

- **Spec coverage:** §1 tabs → Task 12; §2 dedup → Tasks 7, 10, 11; §3 factors/ladder/coverage → Tasks 2, 3, 6, 8; §4 hazard/forecast → Tasks 4, 5, 8, 11; §5 snapshots → Task 9; §6 readers → Task 8; §7 frontend → Tasks 10–12; §8 honesty → woven into 8, 11, 12; §9 testing/delivery → Tasks 0, 13, 14.
- **Type consistency:** factor shape `{fired, measurable, band, detail}` used identically in Tasks 3, 5, 6; `computed.risk.{cohorts, people, peopleAll, totals, hazard, snapshot}` defined in Task 8/9 and consumed by name in Tasks 11–12; `aiSignalStatus_` 4-arg form updated at every call site (Tasks 7, 13).
- **Known deliberate scope cuts (from spec "out of scope"):** no per-leaver SI rendering (Task 13 Step 1), no market Remote-pull, no real backfill coefficients, no hire-vintage survival.
