# CompDash P2a — Decision Engines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four P2 server engines (RemotePull, Acceleration, Retention, GrowthEvents) to CompDash with TDD, payload additions under `payload.p2` / `meta.p2`, zero UI changes, released as BUILD_ 48.

**Architecture:** Each engine is a new PURE file (no GAS APIs) following the Position.js/Workforce.js contract, so `tests/run_tests.js` exercises it under plain Node. The two new sheet readers (`readRemoteBench_`, `readAccelTrack_`) live in Code.js's GAS layer and degrade to "pending" exactly like the contribution snapshot. `getCompReportData` wires per-person results onto `employees[].p2` and cohort blocks onto `payload.p2`; config echoes via `meta.p2`. `stripRestrictedPayload_` gains one rule for the retention evidence people lists.

**Tech Stack:** Google Apps Script (V8), plain-Node test harness (`eval` concat of server files), clasp allowlist deploy.

**Spec:** `CompDash/docs/specs/2026-08-12-compdash-p2-decision-views-design.md`
**Baseline:** BUILD_ 46, 244 tests green (`node tests/run_tests.js` from `CompDash/`).

---

## Decisions baked into this plan (flagged to owner before execution)

1. **`trackStart` source** = a small config tab **"Acceleration Track"** in the comp-history spreadsheet (columns: `Employee Number | Track Start`), overridable via `CD_ACCEL_TRACK_SS_ID` / `CD_ACCEL_TRACK_TAB`. WFP can maintain it without touching the roster; absent tab degrades to "pending".
2. **Remote-pull benchmark source** = optional tab **"Remote"** in the Benchmarking spreadsheet (columns: `Country | Job Title | Remote Mean USD | 25th Percentile USD | 75th Percentile USD | Source Version`), join key = roster `Key Location` × `Job Title` (same `benchKey_` normalization). Overridable via `CD_REMOTE_BENCH_TAB`. Absent → per-person fallback to local market with `benchScope:"local-only"`.
3. **Contribution compliance (goals/kudos/PTO)** stays **evidence, never an escalation factor** in P2a — the existing `contrib` block and `invisibleContributor` flag are the plumbing; P2b renders them inside decision cards and evidence packs. (PROCESS.md §7.3: surface for a human conversation, never re-score automatically.) RISK_IMMEDIATE's "high performer" gate = SI streak OR acceleration track only, per the handoff pack.
4. **Adjustment ChangeTypes** default regex `/salary adjust|market adjust|merit|comp(ensation)? adjust|salary increase|annual increase/i` — promo classification wins first. `debugCompPipeline` gains a log of unmatched RD reasons so the regex gets verified against live data at deploy.

---

## File map

| File | Change |
|---|---|
| `CompDash/Code.js` | Modify — `CONFIG_CD.P2`, `p2Cfg_()`, `readRemoteBench_()`, `readAccelTrack_()`, assembly wiring, `meta.p2`, `stripRestrictedPayload_` addition, `buildMismatch_` list, debug lines, BUILD_ 48 |
| `CompDash/RemotePull.js` | Create — `siStreakOk_`, `buildRemotePullForEmp_` |
| `CompDash/Acceleration.js` | Create — `addMonthsCD_`, `buildAccelForEmp_`, `buildAccelGroups_` |
| `CompDash/Retention.js` | Create — `quarterRangeCD_`, `rollingRate_`, `buildRetention_`, `buildRetentionEvidence_` |
| `CompDash/GrowthEvents.js` | Create — `classifyGrowthEvent_`, `buildGrowthEvents_`, `retainVsRehire_` |
| `CompDash/Position.js`, `Workforce.js`, `Narrative.js`, `Security.js` | Modify — BUILD_ 46 → 48 only |
| `CompDash/ViewDash.html` | Modify — `const SCHEMA = 46` → `48` only (line 62; the schema-banner guard, not a UI change) |
| `CompDash/.claspignore` | Modify — allowlist the four new files |
| `CompDash/tests/run_tests.js` | Modify — `SERVER_FILES` gains the four new files |
| `CompDash/tests/cases.js` | Modify — new test sections appended |
| `CompDash/PROCESS.md` | Modify — P2a section (release task) |

All commands below run from `D:\Contribution\CompDash` unless stated; commits from `D:\Contribution` (repo root). **Never `git push` — this repo stays local.**

---

### Task 1: P2 scaffolding — config, stamps, harness wiring

**Files:**
- Modify: `CompDash/Code.js` (CONFIG_CD, BUILD_, `buildMismatch_`, new `p2Cfg_`)
- Create: `CompDash/RemotePull.js`, `CompDash/Acceleration.js`, `CompDash/Retention.js`, `CompDash/GrowthEvents.js` (stamp-only stubs)
- Modify: `CompDash/Position.js:12`, `CompDash/Workforce.js:10`, `CompDash/Narrative.js:10`, `CompDash/Security.js:21` (46 → 48)
- Modify: `CompDash/ViewDash.html:62` (SCHEMA 46 → 48)
- Modify: `CompDash/.claspignore`, `CompDash/tests/run_tests.js`
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/run_tests.js`
Expected: FAIL — `CONFIG_CD.P2` undefined (TypeError surfaces as test failures / crash).

- [ ] **Step 3: Add `CONFIG_CD.P2` in Code.js** — insert after the `CONTRIB_SNAP_TAB` line (~line 95):

```js
  // ── P2: decision-engine thresholds (spec 2026-08-12) ─────────────────────
  // Numeric keys overridable via the CD_P2_CFG Script Property (JSON, groups
  // shallow-merged, numbers and number-arrays only — regexes stay code).
  // Everything echoes to the client via meta.p2.cfg; the UI never hardcodes.
  P2: {
    REMOTE: {
      competitiveMin: 1.0,  // ≥ this vs remote-pull mean = COMPETITIVE
      stableMin: 0.85,      // ≥ this (and < competitiveMin) = STABLE/NORMAL; below = RISK
      streakMinCount: 3,    // high-performer gate: at least N window ratings…
      streakMinRating: 4,   // …all ≥ this (last up-to-4 completed reviews)
    },
    ACCEL: {
      offsetsMonths: [6, 15, 21, 30, 36], // 6·9·6·9·6 cadence from trackStart
      siGate: 4,            // every streak rating must be ≥ this
      streakMinCount: 3,    // ratings needed in the window for readyNow
      overdueDays: 60,      // checkpoint passed > this without an RD event = overdue
      trackLevelRe: /^I[34]$/,   // opt-in band — display twin below, change together
      trackLevelLabel: "I3–I4",
    },
    RETENTION: {
      windowQuarters: 4,    // rolling window (4 completed quarters ≈ trailing year)
      baselineMult: 1.5,    // market mark: ≥ this × company baseline…
      consecQuarters: 2,    // …for this many consecutive quarter-end windows
      minExits: 4,          // fewer exits than this can never exceed "watch"
    },
    GROWTH: {
      replaceFactor: 0.75,  // rehire exposure = this × TCC USD of flagged people
      gapTarget: 0.95,      // retain cost = gap to this × internal anchor
      // Adjustment ChangeTypes in RD "TCC Change Reason" — promo wins first
      // (classifyGrowthEvent_). VERIFY against live reasons via debugCompPipeline.
      adjustRe: /salary adjust|market adjust|merit|comp(ensation)? adjust|salary increase|annual increase/i,
      adjustLabel: "salary/market/merit adjustments",
    },
  },
  REMOTE_BENCH_TAB: "Remote",             // CD_REMOTE_BENCH_TAB override (bench SS)
  ACCEL_TRACK_TAB: "Acceleration Track",  // CD_ACCEL_TRACK_TAB override (comp-hist SS by default)
```

- [ ] **Step 4: Extend `buildMismatch_` in Code.js** (~line 202) and bump `BUILD_.code`:

```js
BUILD_.code = 48;
```
```js
  const stale = ["position", "workforce", "narrative", "security",
                 "remotepull", "acceleration", "retention", "growth"]
    .filter(k => BUILD_[k] !== want);
```

- [ ] **Step 5: Add `p2Cfg_()` to the Code.js GAS layer** — right after `signalsCfg_()` (~line 449):

```js
/**
 * CONFIG_CD.P2 with CD_P2_CFG Script Property overrides (JSON: top-level
 * groups REMOTE/ACCEL/RETENTION/GROWTH shallow-merged; numbers and arrays of
 * numbers only — regexes stay code). Invalid JSON logs and falls back.
 */
function p2Cfg_() {
  const base = JSON.parse(JSON.stringify(CONFIG_CD.P2, (k, v) =>
    v instanceof RegExp ? undefined : v));
  // JSON round-trip drops the regexes — restore them from code.
  base.ACCEL.trackLevelRe = CONFIG_CD.P2.ACCEL.trackLevelRe;
  base.GROWTH.adjustRe = CONFIG_CD.P2.GROWTH.adjustRe;
  const raw = props_().getProperty("CD_P2_CFG");
  if (!raw) return base;
  try {
    const o = JSON.parse(raw);
    Object.keys(o).forEach(g => {
      if (!base[g] || typeof o[g] !== "object") return;
      Object.keys(o[g]).forEach(k => {
        const v = o[g][k];
        const numArr = Array.isArray(v) && v.every(x => typeof x === "number" && isFinite(x));
        if ((typeof v === "number" && isFinite(v)) || numArr) base[g][k] = v;
      });
    });
  } catch (e) {
    Logger.log("⚠️ p2Cfg_: CD_P2_CFG is not valid JSON — using defaults: " + e.message);
  }
  return base;
}
```

- [ ] **Step 6: Create the four stub engine files** (full content for each):

`CompDash/RemotePull.js`:
```js
// ============================================================
// SCRIPT NAME: Comp Health Report — RemotePull engine (P2)
// PURPOSE:     Per-person market signal governed by the market
//              that can actually poach: remote-pull benchmark
//              first, local market as a labeled fallback.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.remotepull = 48;
```

`CompDash/Acceleration.js`:
```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Acceleration engine (P2)
// PURPOSE:     6·9·6·9·6 cadence state per opted-in I3/I4 —
//              readyNow / overdue checkpoints. The signal
//              schedules a review; Check01 governs the outcome.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.acceleration = 48;
```

`CompDash/Retention.js`:
```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Retention engine (P2)
// PURPOSE:     Cohort rolling-window attrition with the dual
//              false-alarm gate (market mark AND the cohort's
//              own FY25/FY26 history), plus evidence packs.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.retention = 48;
```

`CompDash/GrowthEvents.js`:
```js
// ============================================================
// SCRIPT NAME: Comp Health Report — GrowthEvents engine (P2)
// PURPOSE:     Promotions + adjustments per 100 Rocketeers per
//              cohort (FY27 annualized vs FY26 actual) and the
//              retain-vs-rehire economics.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.growth = 48;
```

- [ ] **Step 7: Bump the other stamps and SCHEMA.** `Position.js:12`, `Workforce.js:10`, `Narrative.js:10`, `Security.js:21`: `= 46;` → `= 48;`. `ViewDash.html:62`: `const SCHEMA = 46;` → `const SCHEMA = 48;`.

- [ ] **Step 8: Wire the harness and deploy allowlist.**

`tests/run_tests.js:11`:
```js
const SERVER_FILES = ["Code.js", "Position.js", "Workforce.js", "Narrative.js", "Security.js",
                      "RemotePull.js", "Acceleration.js", "Retention.js", "GrowthEvents.js"];
```

`.claspignore` — append after `!Admin.html`:
```
!RemotePull.js
!Acceleration.js
!Retention.js
!GrowthEvents.js
```

- [ ] **Step 9: Run tests**

Run: `node tests/run_tests.js`
Expected: `250 passed, 0 failed` (244 baseline + 6 new).

- [ ] **Step 10: Commit**

```bash
git add CompDash/Code.js CompDash/RemotePull.js CompDash/Acceleration.js CompDash/Retention.js CompDash/GrowthEvents.js CompDash/Position.js CompDash/Workforce.js CompDash/Narrative.js CompDash/Security.js CompDash/ViewDash.html CompDash/.claspignore CompDash/tests/run_tests.js CompDash/tests/cases.js
git commit -m "feat(compdash): P2a scaffolding — CONFIG_CD.P2, four engine stubs, BUILD_ 48 wiring

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: RemotePull.js — SI streak + person signal

**Files:**
- Modify: `CompDash/RemotePull.js`
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/cases.js`:

```js
// ── P2a Task 2: RemotePull ──────────────────────────────────
(function () {
  const R = CONFIG_CD.P2.REMOTE;
  const W = ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"];
  const h = rates => rates.map((r, i) => ({ fq: W[i], rate: r }));

  check("siStreak: 3 window ratings all ≥ 4 → ok",
    siStreakOk_(h([4, 4, 5]), W, R) === true);
  check("siStreak: one rating below the gate kills it",
    siStreakOk_(h([4, 3.5, 5]), W, R) === false);
  check("siStreak: fewer than streakMinCount → false",
    siStreakOk_(h([5, 5]), W, R) === false);
  check("siStreak: only the last 4 window ratings judged (old 2 ignored)",
    siStreakOk_([{ fq: "FY25Q3", rate: 2 }, { fq: "FY25Q4", rate: 2 }]
      .concat(h([4, 4, 4, 5])), ["FY25Q3", "FY25Q4"].concat(W), R) === true);
  check("siStreak: ratings outside the window never count",
    siStreakOk_([{ fq: "FY24Q1", rate: 5 }, { fq: "FY24Q2", rate: 5 },
                 { fq: "FY24Q3", rate: 5 }], W, R) === false);
  check("siStreak: empty history → false", siStreakOk_([], W, R) === false);

  const cfg = CONFIG_CD;
  const base = { tccUsd: 39000, remoteRow: { meanUsd: 58000 }, localMarketRatio: 1.86,
                 internalRatio: 1.02, comparable: true, siStreakOk: false, onAccelTrack: false };
  const mk = over => buildRemotePullForEmp_(Object.assign({}, base, over), cfg);

  const risk = mk({});
  check("remotePull: ratio on tccUsd only", approx(risk.remotePullRatio, 0.672, 0.001));
  check("remotePull: < 0.85 without perf gate → RISK",
    risk.signal === "RISK" && risk.benchScope === "remote");
  check("remotePull: RISK + SI streak → RISK_IMMEDIATE",
    mk({ siStreakOk: true }).signal === "RISK_IMMEDIATE");
  check("remotePull: RISK + acceleration track → RISK_IMMEDIATE",
    mk({ onAccelTrack: true }).signal === "RISK_IMMEDIATE");
  check("remotePull: ≥ 1.0 → COMPETITIVE even for a high performer",
    mk({ tccUsd: 60000, siStreakOk: true }).signal === "COMPETITIVE");
  check("remotePull: 0.85–1.0 at/above internal median → STABLE",
    mk({ tccUsd: 53000 }).signal === "STABLE");
  check("remotePull: 0.85–1.0 below internal median → NORMAL, never escalates",
    mk({ tccUsd: 53000, internalRatio: 0.91, siStreakOk: true }).signal === "NORMAL");
  const localOnly = mk({ remoteRow: null, localMarketRatio: 0.80 });
  check("remotePull: no remote row → local fallback, labeled",
    localOnly.benchScope === "local-only" && localOnly.signal === "RISK" &&
    localOnly.remotePullRatio === null);
  const none = mk({ remoteRow: null, localMarketRatio: null });
  check("remotePull: no benchmark at all → pending, scope none",
    none.signal === "pending" && none.benchScope === "none");
  check("remotePull: part-time/intern never gets a market signal",
    mk({ comparable: false }).signal === "not-comparable");
  check("remotePull: missing tccUsd degrades to local scope",
    mk({ tccUsd: null }).benchScope === "local-only");
})();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/run_tests.js`
Expected: FAIL — `siStreakOk_ is not defined`.

- [ ] **Step 3: Implement** — append to `RemotePull.js`:

```js
// ── SI streak (high-performer gate) ─────────────────────────────────────────
// "SI streak ≥ 4 across the last 3–4 completed reviews": take the ratings that
// fall inside the completed-quarter evidence window, keep the most recent
// up-to-4, require at least streakMinCount of them and every one ≥
// streakMinRating. Sparse raters (fewer than streakMinCount window ratings)
// never qualify — a streak needs evidence, not absence.

/**
 * @param {Array<{fq:string, rate:number}>} history full rating history (buildPerfForEmp_ shape)
 * @param {string[]} windowFqs completed-quarter labels (lastCompletedQuarters_)
 * @param {{streakMinCount:number, streakMinRating:number}} R cfg.P2.REMOTE or cfg.P2.ACCEL
 * @returns {boolean}
 */
function siStreakOk_(history, windowFqs, R) {
  const win = (history || [])
    .filter(r => r && typeof r.rate === "number" && isFinite(r.rate) &&
                 windowFqs.indexOf(String(r.fq)) !== -1)
    .sort((a, b) => String(a.fq).localeCompare(String(b.fq)))
    .slice(-4);
  return win.length >= R.streakMinCount && win.every(r => r.rate >= R.streakMinRating);
}

// ── Person signal — governed by the market that can poach ──────────────────
// Hierarchy (spec 2026-08-12 §RemotePull): remote-pull benchmark governs;
// local market is a labeled fallback; internal percentile is context only —
// an internal-only gap can never raise more than NORMAL.

/**
 * @param {{tccUsd:?number, remoteRow:?{meanUsd:number}, localMarketRatio:?number,
 *   internalRatio:?number, comparable:boolean, siStreakOk:boolean,
 *   onAccelTrack:boolean}} v
 * @param {Object} cfg CONFIG_CD-shaped (P2.REMOTE)
 * @returns {{localRatio:?number, remotePullRatio:?number,
 *   benchScope:("remote"|"local-only"|"none"), signal:string, highPerformer:boolean}}
 */
function buildRemotePullForEmp_(v, cfg) {
  const R = cfg.P2.REMOTE;
  if (v.comparable === false) {
    return { localRatio: null, remotePullRatio: null, benchScope: "none",
             signal: "not-comparable", highPerformer: false };
  }
  // Currency trap: remote ratios computed on tccUsd ONLY — never local TCC.
  const remotePullRatio = (v.remoteRow && v.remoteRow.meanUsd > 0 && v.tccUsd > 0)
    ? Math.round(v.tccUsd / v.remoteRow.meanUsd * 1000) / 1000 : null;
  const benchScope = remotePullRatio != null ? "remote"
    : (v.localMarketRatio != null ? "local-only" : "none");
  const governing = remotePullRatio != null ? remotePullRatio : v.localMarketRatio;
  const highPerformer = !!(v.siStreakOk || v.onAccelTrack);
  let signal = "pending";
  if (governing != null) {
    if (governing >= R.competitiveMin) signal = "COMPETITIVE";
    else if (governing >= R.stableMin) {
      // NORMAL = below the internal group median but market-safe. Internal-only
      // evidence can never escalate past this state (small groups misclassify).
      signal = (v.internalRatio != null && v.internalRatio < 1.0) ? "NORMAL" : "STABLE";
    } else {
      signal = highPerformer ? "RISK_IMMEDIATE" : "RISK";
    }
  }
  return { localRatio: v.localMarketRatio != null ? v.localMarketRatio : null,
           remotePullRatio, benchScope, signal, highPerformer };
}
```

- [ ] **Step 4: Run tests**

Run: `node tests/run_tests.js`
Expected: `267 passed, 0 failed` (250 + 17).

- [ ] **Step 5: Commit**

```bash
git add CompDash/RemotePull.js CompDash/tests/cases.js
git commit -m "feat(compdash): RemotePull engine — SI streak gate + remote-pull-governed person signal

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Acceleration.js — cadence checkpoints

**Files:**
- Modify: `CompDash/Acceleration.js`
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/cases.js`:

```js
// ── P2a Task 3: Acceleration ────────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  const W = ["FY26Q1", "FY26Q2", "FY26Q3", "FY26Q4"];
  const streak = [{ fq: "FY26Q2", rate: 4 }, { fq: "FY26Q3", rate: 4 }, { fq: "FY26Q4", rate: 5 }];
  const weak   = [{ fq: "FY26Q2", rate: 4 }, { fq: "FY26Q3", rate: 3 }, { fq: "FY26Q4", rate: 5 }];

  check("addMonthsCD_: plain add", isoDate_(addMonthsCD_(new Date(2025, 0, 15), 6)) === "2025-07-15");
  check("addMonthsCD_: year rollover", isoDate_(addMonthsCD_(new Date(2025, 10, 1), 15)) === "2027-02-01");

  // trackStart 2024-11-12, asOf 2026-08-12 → month 21: cp1 (m6) + cp2 (m15)
  // reviewed (RD events after each), cp3 (m21) due 2026-08-12 exactly.
  const mk = over => buildAccelForEmp_(Object.assign({
    trackStart: new Date(2024, 10, 12), asOf: new Date(2026, 7, 12),
    siHistory: streak, windowFqs: W,
    reviewDates: [new Date(2025, 5, 20), new Date(2026, 2, 1)],
  }, over || {}), cfg);

  const a = mk({});
  check("accel: five checkpoints", a.checkpoints.length === 5);
  check("accel: cp1/cp2 done (RD events after their due dates)",
    a.checkpoints[0].status === "done" && a.checkpoints[1].status === "done");
  check("accel: cp3 due today, cp4/cp5 future",
    a.checkpoints[2].status === "due" &&
    a.checkpoints[3].status === "future" && a.checkpoints[4].status === "future");
  check("accel: months on track = 21", a.monthsOnTrack === 21);
  check("accel: due checkpoint + streak = readyNow", a.readyNow === true && a.overdue === false);
  check("accel: weak streak → not ready", mk({ siHistory: weak }).readyNow === false);

  // cp3 due 2026-08-12; asOf 2026-11-01 = 81 days past, no event since → overdue
  const late = mk({ asOf: new Date(2026, 10, 1) });
  check("accel: checkpoint > 60 days past without a review = overdue",
    late.checkpoints[2].status === "overdue" && late.overdue === true);
  check("accel: overdue + streak still reads readyNow (review must be scheduled)",
    late.readyNow === true);
  // An RD event AFTER the checkpoint clears it even late
  const caught = mk({ asOf: new Date(2026, 10, 1),
    reviewDates: [new Date(2025, 5, 20), new Date(2026, 2, 1), new Date(2026, 9, 10)] });
  check("accel: late review event clears the overdue checkpoint",
    caught.checkpoints[2].status === "done" && caught.overdue === false);

  check("accel: no trackStart → null", buildAccelForEmp_({
    trackStart: null, asOf: new Date(2026, 7, 12), siHistory: [], windowFqs: W, reviewDates: [],
  }, cfg) === null);

  const groups = buildAccelGroups_([
    { level: "I3", keyLocation: "Chile", governingRatio: 0.79, accel: { readyNow: true,  overdue: false } },
    { level: "I3", keyLocation: "Chile", governingRatio: 0.97, accel: { readyNow: false, overdue: true } },
    { level: "I4", keyLocation: "Malaysia", governingRatio: 1.02, accel: { readyNow: false, overdue: false } },
  ]);
  check("accelGroups: grouped by level × location with counts",
    groups.length === 2 && groups[0].level === "I3" && groups[0].onTrack === 2 &&
    groups[0].readyNow === 1 && groups[0].overdue === 1);
  check("accelGroups: median governing ratio", approx(groups[0].medianMarketRatio, 0.88));
})();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/run_tests.js`
Expected: FAIL — `addMonthsCD_ is not defined`.

- [ ] **Step 3: Implement** — append to `Acceleration.js`:

```js
// ── Calendar helpers ────────────────────────────────────────────────────────

function addMonthsCD_(d, months) {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

/** Whole calendar months from `start` to `asOf` (floor). */
function monthsBetweenCD_(start, asOf) {
  let m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) m--;
  return m;
}

// ── Cadence state per opted-in Rocketeer ────────────────────────────────────
// Checkpoints at cfg.P2.ACCEL.offsetsMonths from trackStart. A checkpoint is
// "done" once ANY RD comp event lands on/after its due date (the review
// happened — the outcome is Check01's business, not this engine's), "overdue"
// when it passed more than overdueDays ago with no such event, "due" when
// reached but inside the grace window. readyNow = a checkpoint is reached
// (due OR overdue) AND the SI streak gate holds — it schedules a review,
// it never grants one.

/**
 * @param {{trackStart:?Date, asOf:Date, siHistory:Array, windowFqs:string[],
 *   reviewDates:Date[]}} v
 * @param {Object} cfg CONFIG_CD-shaped (P2.ACCEL)
 * @returns {?{monthsOnTrack:number, checkpoints:Array, readyNow:boolean,
 *   overdue:boolean, siStreakOk:boolean}} null when not on a track
 */
function buildAccelForEmp_(v, cfg) {
  const A = cfg.P2.ACCEL;
  if (!(v.trackStart instanceof Date) || isNaN(v.trackStart)) return null;
  const DAY = 86400000;
  const streakOk = siStreakOk_(v.siHistory, v.windowFqs,
    { streakMinCount: A.streakMinCount, streakMinRating: A.siGate });
  const events = (v.reviewDates || []).filter(d => d instanceof Date && !isNaN(d));
  const checkpoints = A.offsetsMonths.map((mo, i) => {
    const due = addMonthsCD_(v.trackStart, mo);
    const reviewed = events.some(d => d >= due);
    const daysPast = Math.floor((v.asOf - due) / DAY);
    let status = "future";
    if (reviewed) status = "done";
    else if (daysPast > A.overdueDays) status = "overdue";
    else if (daysPast >= 0) status = "due";
    return { idx: i + 1, monthOffset: mo, due: isoDate_(due), status };
  });
  const open = checkpoints.find(c => c.status === "due" || c.status === "overdue") || null;
  return {
    monthsOnTrack: monthsBetweenCD_(v.trackStart, v.asOf),
    checkpoints,
    readyNow: !!(open && streakOk),
    overdue: checkpoints.some(c => c.status === "overdue"),
    siStreakOk: streakOk,
  };
}

// ── Group rollup (level × Key Location) ─────────────────────────────────────

/**
 * @param {Array<{level:string, keyLocation:string, governingRatio:?number,
 *   accel:{readyNow:boolean, overdue:boolean}}>} rows one per on-track person
 */
function buildAccelGroups_(rows) {
  const map = new Map();
  (rows || []).forEach(r => {
    const k = r.level + "||" + (r.keyLocation || "—");
    if (!map.has(k)) map.set(k, { level: r.level, keyLocation: r.keyLocation || "—",
      onTrack: 0, readyNow: 0, overdue: 0, ratios: [] });
    const g = map.get(k);
    g.onTrack++;
    if (r.accel.readyNow) g.readyNow++;
    if (r.accel.overdue) g.overdue++;
    if (r.governingRatio != null) g.ratios.push(r.governingRatio);
  });
  return [...map.values()].map(g => ({
    level: g.level, keyLocation: g.keyLocation,
    onTrack: g.onTrack, readyNow: g.readyNow, overdue: g.overdue,
    medianMarketRatio: median_(g.ratios) != null
      ? Math.round(median_(g.ratios) * 100) / 100 : null,
  })).sort((a, b) => b.readyNow - a.readyNow || b.overdue - a.overdue ||
    a.keyLocation.localeCompare(b.keyLocation));
}
```

- [ ] **Step 4: Run tests**

Run: `node tests/run_tests.js`
Expected: `281 passed, 0 failed` (267 + 14).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Acceleration.js CompDash/tests/cases.js
git commit -m "feat(compdash): Acceleration engine — 6·9·6·9·6 checkpoints, readyNow/overdue, group rollup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Retention.js — dual-gate cohort trends + evidence packs

**Files:**
- Modify: `CompDash/Retention.js`
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/cases.js` (reuses the existing `mkEmp` helper):

```js
// ── P2a Task 4: Retention ───────────────────────────────────
(function () {
  check("quarterRange: FY26Q4 = Apr–Jun 2026", (function () {
    const r = quarterRangeCD_("FY26Q4");
    return isoDate_(r.start) === "2026-04-01" && isoDate_(r.end) === "2026-06-30";
  })());
  check("quarterRange: FY27Q1 = Jul–Sep 2026", (function () {
    const r = quarterRangeCD_("FY27Q1");
    return isoDate_(r.start) === "2026-07-01" && isoDate_(r.end) === "2026-09-30";
  })());
  check("quarterRange: garbage → null", quarterRangeCD_("nope") === null);

  // asOf 2027-02-10 → FY27 Q3 → current rolling window = FY26Q3..FY27Q2
  // (Jan–Dec 2026), previous window = FY26Q2..FY27Q1 (Oct 2025 – Sep 2026).
  // Deliberately NOT a Q1 asOf: at fiscal-year start the rolling window
  // coincides exactly with the prior FY, so the historical mark (strictly
  // above own FY26) is definitionally unreachable — see the engine docstring.
  const ctx = fiscalContextCD_(new Date(2027, 1, 10));
  const hot = [];      // Santiago Services: 5 exits in-window, quiet FY25
  for (let i = 0; i < 10; i++) hot.push(mkEmp({ keyLocation: "Chile", dept: "Services",
    hireDate: new Date(2022, 0, 1) }));
  for (let i = 0; i < 5; i++) hot.push(mkEmp({ keyLocation: "Chile", dept: "Services",
    active: false, hireDate: new Date(2023, 0, 1),
    termDate: new Date(2026, 2 + i, 10), termCategory: "Voluntary",
    termReason: "Another job - better offer" }));
  // Sydney Sales: elevated but within its own history (2 FY25 exits on tiny team)
  const sales = [];
  for (let i = 0; i < 6; i++) sales.push(mkEmp({ keyLocation: "Australia", dept: "Sales",
    hireDate: new Date(2021, 0, 1) }));
  for (let i = 0; i < 4; i++) sales.push(mkEmp({ keyLocation: "Australia", dept: "Sales",
    active: false, hireDate: new Date(2022, 0, 1),
    termDate: new Date(2026, 1 + i, 5), termCategory: "Voluntary" }));
  for (let i = 0; i < 4; i++) sales.push(mkEmp({ keyLocation: "Australia", dept: "Sales",
    active: false, hireDate: new Date(2021, 0, 1),
    termDate: new Date(2024, 8 + i, 5), termCategory: "Voluntary" })); // FY25 exits
  // Quiet ballast so the company baseline stays low
  const calm = [];
  for (let i = 0; i < 80; i++) calm.push(mkEmp({ keyLocation: "Malaysia", dept: "Engineering",
    hireDate: new Date(2020, 0, 1) }));

  const out = buildRetention_(hot.concat(sales, calm), ctx, CONFIG_CD, function () { return null; });
  const santiago = out.cohorts.find(c => c.keyLocation === "Chile" && c.dept === "Services");
  const sydney = out.cohorts.find(c => c.keyLocation === "Australia" && c.dept === "Sales");

  check("retention: baseline carries a rate", out.baseline.rate > 0);
  check("retention: hot cohort fires both marks → confirmed",
    santiago && santiago.marketMark === true && santiago.historicalMark === true &&
    santiago.verdict === "confirmed");
  check("retention: within-own-history cohort → never confirmed",
    sydney && sydney.historicalMark === false && sydney.verdict !== "confirmed");
  check("retention: confirmed cohort gets an evidence pack",
    out.evidence.length >= 1 && out.evidence.some(e => e.cohortKey === santiago.key));

  const ev = out.evidence.find(e => e.cohortKey === santiago.key);
  check("retention evidence: driver classified from REASON_CLASS",
    ev.driver === "labor-market/comp");
  check("retention evidence: tenure distribution sums to the window exits",
    ev.tenureDist.reduce((t, b) => t + b.n, 0) === 5); // all 5 exits (Mar–Jul 2026) inside Jan–Dec 2026
  check("retention evidence: people list = active cohort members",
    ev.people.length === 10 && ev.people.every(p => p.empNo && p.name));

  // n-exits ceiling: 3 exits on a hot small cohort can never exceed watch
  const small = [];
  for (let i = 0; i < 5; i++) small.push(mkEmp({ keyLocation: "Peru", dept: "Design",
    hireDate: new Date(2021, 0, 1) }));
  for (let i = 0; i < 3; i++) small.push(mkEmp({ keyLocation: "Peru", dept: "Design",
    active: false, hireDate: new Date(2022, 0, 1),
    termDate: new Date(2026, 3 + i, 2), termCategory: "Voluntary" }));
  // Rebuild calm ballast against the same ctx so baselines stay comparable.
  const out2 = buildRetention_(small.concat(calm), ctx, CONFIG_CD, function () { return null; });
  const peru = out2.cohorts.find(c => c.keyLocation === "Peru");
  check("retention: < minExits caps at watch",
    peru && peru.verdict !== "confirmed" && peru.verdict !== "noted");
})();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/run_tests.js`
Expected: FAIL — `quarterRangeCD_ is not defined`.

- [ ] **Step 3: Implement** — append to `Retention.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `node tests/run_tests.js`
Expected: `293 passed, 0 failed` (281 + 12).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Retention.js CompDash/tests/cases.js
git commit -m "feat(compdash): Retention engine — rolling dual-gate cohort trends + evidence packs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: GrowthEvents.js — growth pace + retain-vs-rehire

**Files:**
- Modify: `CompDash/GrowthEvents.js`
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests** — append to `tests/cases.js`:

```js
// ── P2a Task 5: GrowthEvents ────────────────────────────────
(function () {
  const cfg = CONFIG_CD;
  check("growth classify: promotion wins over adjustment wording",
    classifyGrowthEvent_("Promotion with salary adjustment", cfg) === "promo");
  check("growth classify: salary adjustment", classifyGrowthEvent_("Salary Adjustment", cfg) === "adjust");
  check("growth classify: merit increase", classifyGrowthEvent_("Merit", cfg) === "adjust");
  check("growth classify: new hire is neither", classifyGrowthEvent_("New Hire", cfg) === null);

  // asOf 2026-08-12 → FY27 elapsed = 2 fiscal months (Jul, Aug).
  const ctx = fiscalContextCD_(new Date(2026, 7, 12));
  const recs = [];
  for (let i = 0; i < 10; i++) recs.push(mkEmp({ keyLocation: "Chile", dept: "Services",
    hireDate: new Date(2020, 0, 1) }));
  const hist = {};
  // 1 promo + 1 adjustment inside FY27-to-date; 3 adjustments in FY26.
  hist[recs[0].empNo] = [{ date: new Date(2026, 6, 15), reason: "Promotion", tcc: 1 }];
  hist[recs[1].empNo] = [{ date: new Date(2026, 7, 1), reason: "Salary Adjustment", tcc: 1 },
                         { date: new Date(2025, 9, 1), reason: "Salary Adjustment", tcc: 1 }];
  hist[recs[2].empNo] = [{ date: new Date(2026, 0, 10), reason: "Merit", tcc: 1 },
                         { date: new Date(2025, 7, 10), reason: "Market Adjustment", tcc: 1 }];
  const g = buildGrowthEvents_(recs, hist, ctx, cfg);
  const row = g.rows.find(r => r.keyLocation === "Chile");
  check("growth: FY counts split promo vs adjustment", row.promoFY === 1 && row.adjFY === 1);
  // (1+1) events / 2 months × 12 = 12/yr ÷ 10 heads × 100 = 120
  check("growth: FY27 pace annualized per 100", row.per100Cur === 120);
  // FY26: 3 adjustments ÷ 10 heads × 100 = 30
  check("growth: FY26 actual per 100", row.per100Prev === 30);
  check("growth: elapsed months echoed", g.elapsedMonths === 2);
  check("growth: company rollup present", g.company && g.company.per100Cur === 120);

  const rvr = retainVsRehire_([
    { signal: "RISK",           tcc: 100000, tccUsd: 40000, anchor: 120000 },
    { signal: "RISK_IMMEDIATE", tcc: 100000, tccUsd: 39000, anchor: 125000 },
    { signal: "STABLE",         tcc: 100000, tccUsd: 50000, anchor: 100000 },
    { signal: "RISK",           tcc: 90000,  tccUsd: null,  anchor: 100000 }, // no USD → coverage
  ], cfg);
  check("retainVsRehire: only RISK/RISK_IMMEDIATE count", rvr.flagged === 3);
  // rehire = 0.75×(40000+39000) = 59250
  check("retainVsRehire: rehire exposure", rvr.rehireExposureUsd === 59250);
  // gaps: (0.95×120000−100000)=14000 → USD 14000×0.4=5600; (0.95×125000−100000)=18750 → ×0.39=7312.5
  check("retainVsRehire: retain cost in USD via per-person FX", rvr.retainCostUsd === 12913);
  check("retainVsRehire: coverage counts the USD-less person",
    rvr.coverage.counted === 2 && rvr.coverage.total === 3);
  check("retainVsRehire: cents per dollar", rvr.centsPerDollar === 22);
})();
```

- [ ] **Step 2: Run to verify they fail**

Run: `node tests/run_tests.js`
Expected: FAIL — `classifyGrowthEvent_ is not defined`.

- [ ] **Step 3: Implement** — append to `GrowthEvents.js`:

```js
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
```

- [ ] **Step 4: Run tests**

Run: `node tests/run_tests.js`
Expected: `307 passed, 0 failed` (293 + 14).

- [ ] **Step 5: Commit**

```bash
git add CompDash/GrowthEvents.js CompDash/tests/cases.js
git commit -m "feat(compdash): GrowthEvents engine — growth pace per 100 + retain-vs-rehire economics

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Code.js readers — remote benchmarks + acceleration track

GAS-layer only (no Node tests possible) — the guard is `debugCompPipeline` plus graceful degradation identical to the contribution snapshot.

**Files:**
- Modify: `CompDash/Code.js`

- [ ] **Step 1: Extend `ssIds_()`** — add before the closing brace of the returned object:

```js
    remoteBenchTab: p.getProperty("CD_REMOTE_BENCH_TAB") || CONFIG_CD.REMOTE_BENCH_TAB,
    // Acceleration track defaults into the comp-history file (next to RD).
    accelTrack:    p.getProperty("CD_ACCEL_TRACK_SS_ID") || p.getProperty("CD_COMP_HIST_SS_ID") || CONFIG_CD.COMP_HIST_SS_ID,
    accelTrackTab: p.getProperty("CD_ACCEL_TRACK_TAB")   || CONFIG_CD.ACCEL_TRACK_TAB,
```

- [ ] **Step 2: Add the two readers** — after `readContribSnapshot_()` (~line 765):

```js
/**
 * Remote-pull benchmark rows (Benchmarking Engine v9 remote-remuneration set).
 * Keyed by benchKey_(Country, Job Title) — Country joins the roster's Key
 * Location. USD by definition. Absent tab degrades per-role to local-only
 * (meta.sources.remoteBench = "pending").
 * @returns {{map: Object, count: number}}
 */
function readRemoteBench_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.bench, ids.remoteBenchTab);
  const iCountry = colIdx_(headers, "Country", /country|location/i);
  const iTitle   = colIdx_(headers, "Job Title");
  const iMean    = colIdx_(headers, "Remote Mean USD", /remote.*mean|mean.*usd/i);
  const iP25     = colIdx_(headers, "25th Percentile USD", /25th/i);
  const iP75     = colIdx_(headers, "75th Percentile USD", /75th/i);
  const iVer     = colIdx_(headers, "Source Version", /source|version/i);
  if (iCountry === -1 || iTitle === -1 || iMean === -1) {
    Logger.log("❌ readRemoteBench_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Remote benchmark tab: required columns missing (see execution log).");
  }
  const map = {};
  let count = 0;
  rows.forEach(row => {
    const country = String(row[iCountry] || "").trim();
    const title = String(row[iTitle] || "").trim();
    const mean = asNum_(row[iMean]);
    if (!country || !title || !(mean > 0)) return;
    map[benchKey_(country, title)] = {
      meanUsd: mean,
      p25Usd: iP25 !== -1 ? asNum_(row[iP25]) : null,
      p75Usd: iP75 !== -1 ? asNum_(row[iP75]) : null,
      sourceVersion: iVer !== -1 ? String(row[iVer] || "").trim() : "",
    };
    count++;
  });
  log_("readRemoteBench_: " + count + " remote benchmark rows");
  return { map, count };
}

/**
 * Acceleration-track opt-ins: Employee Number → track start date. Lives in a
 * small "Acceleration Track" tab (comp-history file by default) so WFP can
 * maintain opt-ins without touching the roster. Absent tab = program pending.
 * @returns {{byEmp: Object<string,{trackStart: Date}>, count: number}}
 */
function readAccelTrack_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.accelTrack, ids.accelTrackTab);
  const iEmp   = colIdx_(headers, "Employee Number");
  const iStart = colIdx_(headers, "Track Start", /track.*start|start.*date/i);
  if (iEmp === -1 || iStart === -1) {
    Logger.log("❌ readAccelTrack_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Acceleration Track tab: required columns missing (see execution log).");
  }
  const byEmp = {};
  let count = 0;
  rows.forEach(row => {
    const emp = String(row[iEmp] || "").trim();
    const start = asDate_(row[iStart]);
    if (!emp || !start) return;
    byEmp[emp] = { trackStart: start };
    count++;
  });
  log_("readAccelTrack_: " + count + " opt-ins");
  return { byEmp, count };
}
```

- [ ] **Step 3: Extend `debugCompPipeline`** — append before the closing brace:

```js
  try {
    const rb = readRemoteBench_();
    let rbHits = 0;
    active.forEach(x => { if (rb.map[benchKey_(x.keyLocation, x.jobTitle)]) rbHits++; });
    Logger.log("Remote benchmarks: " + rb.count + " rows, " + rbHits + "/" + active.length +
      " active matched (unmatched roles fall back to local-only)");
  } catch (e) { Logger.log("Remote benchmarks: PENDING — " + e.message); }
  try {
    const at = readAccelTrack_();
    const eligible = active.filter(x => CONFIG_CD.P2.ACCEL.trackLevelRe.test(x.level));
    const opted = eligible.filter(x => at.byEmp[x.empNo]).length;
    Logger.log("Acceleration track: " + at.count + " opt-ins, " + opted + "/" + eligible.length +
      " eligible I3–I4 opted in");
  } catch (e) { Logger.log("Acceleration track: PENDING — " + e.message); }
  // Growth-event vocabulary check — unmatched RD reasons the regexes don't classify.
  const unmatched = new Map();
  Object.keys(hist).forEach(emp => hist[emp].forEach(e => {
    const s = String(e.reason || "").trim();
    if (!s || /new hire/i.test(s)) return;
    if (classifyGrowthEvent_(s, CONFIG_CD) == null) unmatched.set(s, (unmatched.get(s) || 0) + 1);
  }));
  Logger.log("Growth events — unmatched RD reasons (tune P2.GROWTH.adjustRe if any should count): " +
    ([...unmatched.entries()].map(([k, n]) => k + " ×" + n).join(" | ") || "none"));
```

- [ ] **Step 4: Run tests** (readers are GAS-only, but the file must still parse under the Node harness)

Run: `node tests/run_tests.js`
Expected: `307 passed, 0 failed` (unchanged).

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): remote-benchmark + acceleration-track readers with pending degradation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Assembly — payload.p2, meta.p2, restricted stripping

**Files:**
- Modify: `CompDash/Code.js` (`getCompReportData`, `stripRestrictedPayload_`)
- Test: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing test for the strip rule** — append to `tests/cases.js`:

```js
// ── P2a Task 7: restricted stripping covers p2 evidence people ──
(function () {
  const payload = {
    meta: {},
    restrictedEmpNos: ["E9"],
    employees: [{ empNo: "E1" }, { empNo: "E9" }],
    people: [], qtaInterim: [], compaGroups: [],
    p2: {
      retention: { evidence: [{ cohortKey: "x", people: [{ empNo: "E1" }, { empNo: "E9" }] }] },
      accelGroups: [], growth: {},
    },
  };
  const out = stripRestrictedPayload_(payload);
  check("strip: p2 retention evidence people filtered",
    out.p2.retention.evidence[0].people.length === 1 &&
    out.p2.retention.evidence[0].people[0].empNo === "E1");
  check("strip: employees still filtered alongside p2", out.employees.length === 1);
})();
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/run_tests.js`
Expected: FAIL — `strip: p2 retention evidence people filtered` (people list keeps E9).

- [ ] **Step 3: Extend `stripRestrictedPayload_`** — insert before the `if (payload.history)` block (~line 291):

```js
  if (payload.p2 && payload.p2.retention && payload.p2.retention.evidence) {
    payload.p2.retention.evidence.forEach(ev => {
      ev.people = (ev.people || []).filter(keep);
    });
  }
```

- [ ] **Step 4: Wire the engines into `getCompReportData`.**

**4a.** After the contribution-snapshot read block (~line 835), add the P2 reads:

```js
  // ── P2 sources (both optional until populated — "pending" is normal) ──────
  let remoteBench = { map: {}, count: 0 };
  sources.remoteBench = "ok";
  try { remoteBench = readRemoteBench_(); }
  catch (e) { sources.remoteBench = "pending: " + e.message; log_("readRemoteBench_: " + e.message); }
  let accelTrack = { byEmp: {}, count: 0 };
  sources.accelTrack = "ok";
  try { accelTrack = readAccelTrack_(); }
  catch (e) { sources.accelTrack = "pending: " + e.message; log_("readAccelTrack_: " + e.message); }
  const p2cfg = p2Cfg_();
```

**4b.** Extend the `cfgV4` line (~line 841) so one config object carries everything:

```js
  const cfgV4 = Object.assign({}, CONFIG_CD, { SIGNALS: sigCfg, P2: p2cfg });
```

**4c.** Inside the `employees` map callback, after the `ttmGrowthPct` line (~line 873), add:

```js
    // P2: acceleration state (opted-in I3/I4 only) + remote-pull person signal.
    const accel = (accelTrack.byEmp[r.empNo] && p2cfg.ACCEL.trackLevelRe.test(r.level))
      ? buildAccelForEmp_({
          trackStart: accelTrack.byEmp[r.empNo].trackStart, asOf: ctx.asOf,
          siHistory: perf ? perf.history : [], windowFqs,
          reviewDates: (histByEmp[r.empNo] || [])
            .map(e => e.date).filter(d => d instanceof Date && !isNaN(d)),
        }, cfgV4)
      : null;
    const remoteRow = remoteBench.map[benchKey_(r.keyLocation, r.jobTitle)] || null;
    const remote = buildRemotePullForEmp_({
      tccUsd: r.tccUsd, remoteRow, localMarketRatio: marketRatio,
      internalRatio: a.ratio, comparable,
      siStreakOk: siStreakOk_(perf ? perf.history : [], windowFqs, p2cfg.REMOTE),
      onAccelTrack: !!accel,
    }, cfgV4);
```

and add to the returned employee object (after the `priority:` entry):

```js
      p2: { remote, accel },
```

**4d.** After the `verdicts` build (~line 943), assemble the cohort blocks:

```js
  // ── P2 cohort blocks ───────────────────────────────────────────────────────
  // Governing ratio per roster record: remote-pull first (tccUsd), internal
  // anchor ratio as context fallback — used by retention leaver/stayer medians.
  const ratioOfP2 = rec => {
    const rr = remoteBench.map[benchKey_(rec.keyLocation, rec.jobTitle)];
    if (rr && rr.meanUsd > 0 && rec.tccUsd > 0) {
      return Math.round(rec.tccUsd / rr.meanUsd * 1000) / 1000;
    }
    const a2 = anchorByEmp[rec.empNo];
    return a2 && a2.ratio != null ? a2.ratio : null;
  };
  const growth = buildGrowthEvents_(records, histByEmp, ctx, cfgV4);
  growth.retainVsRehire = retainVsRehire_(employees.map(e => ({
    signal: e.p2.remote.signal, tcc: e.tcc, tccUsd: e.tccUsd, anchor: e.anchor,
  })), cfgV4);
  const p2Block = {
    accelGroups: buildAccelGroups_(employees
      .filter(e => e.p2.accel)
      .map(e => ({
        level: e.level, keyLocation: e.keyLocation,
        governingRatio: e.p2.remote.remotePullRatio != null
          ? e.p2.remote.remotePullRatio : e.p2.remote.localRatio,
        accel: e.p2.accel,
      }))),
    retention: buildRetention_(records, ctx, cfgV4, ratioOfP2),
    growth,
  };
```

**4e.** In the `payload` object: add `p2: p2Block,` after `history,` — and inside `meta`, after the `contribution:` entry, add:

```js
      p2: {
        cfg: {
          remote: { competitiveMin: p2cfg.REMOTE.competitiveMin, stableMin: p2cfg.REMOTE.stableMin,
                    streakMinCount: p2cfg.REMOTE.streakMinCount, streakMinRating: p2cfg.REMOTE.streakMinRating },
          accel: { offsetsMonths: p2cfg.ACCEL.offsetsMonths, siGate: p2cfg.ACCEL.siGate,
                   streakMinCount: p2cfg.ACCEL.streakMinCount, overdueDays: p2cfg.ACCEL.overdueDays,
                   levels: p2cfg.ACCEL.trackLevelLabel }, // regex's display twin
          retention: { windowQuarters: p2cfg.RETENTION.windowQuarters,
                       baselineMult: p2cfg.RETENTION.baselineMult,
                       consecQuarters: p2cfg.RETENTION.consecQuarters,
                       minExits: p2cfg.RETENTION.minExits },
          growth: { replaceFactor: p2cfg.GROWTH.replaceFactor, gapTarget: p2cfg.GROWTH.gapTarget,
                    adjustLabel: p2cfg.GROWTH.adjustLabel }, // regex's display twin
        },
        remoteBench: { rows: remoteBench.count,
                       matched: employees.filter(e => e.p2.remote.benchScope === "remote").length,
                       available: sources.remoteBench === "ok" },
        accelTrack: { optIns: accelTrack.count,
                      onTrack: employees.filter(e => e.p2.accel).length,
                      available: sources.accelTrack === "ok" },
      },
```

- [ ] **Step 5: Run tests**

Run: `node tests/run_tests.js`
Expected: `309 passed, 0 failed` (307 + 2).

- [ ] **Step 6: Run the other two harnesses** (zero UI change — both must stay green)

Run: `node tests/parse_html.js && node tests/render_smoke.js`
Expected: both PASS unchanged.

- [ ] **Step 7: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): wire P2 engines into the payload — employees[].p2, payload.p2, meta.p2, strip rule

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Release — PROCESS.md, full harness, deploy checklist

**Files:**
- Modify: `CompDash/PROCESS.md`

- [ ] **Step 1: Append the P2a section to PROCESS.md** (after the P0 Rollback section):

```markdown
## P2a deploy (2026.W34 — decision engines, BUILD_ 48)

Spec: `CompDash/docs/specs/2026-08-12-compdash-p2-decision-views-design.md`
Plan: `CompDash/docs/plans/2026-08-12-compdash-p2a-engines.md`

**What P2a adds** — four new PURE server engines, payload-only (zero UI change;
P2b builds the views): `RemotePull.js` (person signal governed by the
remote-pull benchmark — COMPETITIVE / STABLE / NORMAL / RISK / RISK_IMMEDIATE;
NORMAL never escalates alone; local-only fallback is labeled), `Acceleration.js`
(6·9·6·9·6 cadence per opted-in I3/I4 — readyNow schedules a review, Check01
governs the outcome), `Retention.js` (rolling 4-quarter cohort rates with the
dual false-alarm gate: market mark AND the cohort's own FY25/FY26 history;
< 4 exits caps at watch), `GrowthEvents.js` (promotions + adjustments per 100
per cohort, FY27 annualized vs FY26 actual, retain-vs-rehire economics).
The clasp allowlist now pushes **thirteen files** (the nine P0 files + the
four P2 engines); `buildMismatch_` checks eight stamps against `BUILD_.code`.

New payload: `employees[].p2` (remote + accel per person), `payload.p2`
(accelGroups / retention / growth), `meta.p2` (config echo + source coverage).
`stripRestrictedPayload_` also filters `p2.retention.evidence[].people`.

New data sources (both optional — "pending" until populated):
- **Remote** tab in the Benchmarking file: `Country | Job Title |
  Remote Mean USD | 25th Percentile USD | 75th Percentile USD | Source Version`
  (CD_REMOTE_BENCH_TAB override). Owner: Benchmarking Engine v9 (PEOPLE-39480).
- **Acceleration Track** tab in the comp-history file: `Employee Number |
  Track Start` (CD_ACCEL_TRACK_SS_ID / CD_ACCEL_TRACK_TAB overrides). One-time
  backfill of current I3/I4 opt-ins required.
- Threshold overrides: `CD_P2_CFG` Script Property (JSON groups
  REMOTE/ACCEL/RETENTION/GROWTH, numbers and number-arrays only).

Deploy checklist:
1. `clasp push` from `CompDash/` — thirteen files land atomically.
2. Run `debugCompPipeline()` — new lines: Remote benchmarks, Acceleration
   track, Growth events unmatched-reasons list (tune `P2.GROWTH.adjustRe` if
   real adjustment ChangeTypes appear there).
3. Run `bustCompCache_()` — **required** (payload adds p2 blocks).
4. Publish a **new deployment version**.
5. Confirm the dashboard renders identically (P2a is payload-only) and the
   freshness chip works; `meta.p2.remoteBench.available` /
   `meta.p2.accelTrack.available` read false until the tabs exist — by design.

Tests: `node tests/run_tests.js` (309) + `node tests/parse_html.js` +
`node tests/render_smoke.js`.
```

- [ ] **Step 2: Full harness run**

Run: `node tests/run_tests.js && node tests/parse_html.js && node tests/render_smoke.js`
Expected: `309 passed, 0 failed` + both harnesses PASS.

- [ ] **Step 3: Commit**

```bash
git add CompDash/PROCESS.md
git commit -m "docs(compdash): P2a release notes — engines, sources, deploy checklist (BUILD_ 48)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 4 (owner, not the executor): deploy** — `clasp push` → `debugCompPipeline()` → `bustCompCache_()` → new deployment version, per the checklist above. Never `git push` — repo stays local.

---

## Self-review notes

- **Spec coverage:** RemotePull states/fallback (Task 2), acceleration cadence/gates (Task 3), retention dual gate + evidence pack (Task 4), growth pace + retain-vs-rehire (Task 5), data prerequisites as degradable readers (Task 6), `meta.p2` echo + zero-UI payload (Task 7), BUILD_ 48 + harness + PROCESS.md (Tasks 1, 8). FY25/FY26 marks computed from existing roster term dates (Task 4) — no new source, as the spec promised.
- **Not in P2a (by design):** no verdicts/narrative changes, no UI, no Check L escalation change, no snapshot-export changes. Contribution evidence already rides on `employees[].contrib`.
- **Type consistency:** `siStreakOk_` is shared by RemotePull (REMOTE keys) and Acceleration (mapped `{streakMinCount, streakMinRating: siGate}`); `benchKey_`/`median_`/`headcountOn_`/`fyAttritionBlock_`/`lastCompletedQuarters_`/`fiscalMonthIdx_`/`isoDate_`/`tenureYears_` all exist today with the signatures used here.
- **Eval-concat caveat:** all four engine files use `function` declarations and `var BUILD_` (no top-level `const` collisions); `RETENTION_TENURE_BUCKETS_` is a top-level `const` in Retention.js — unique name, single declaration, safe in the single-eval harness.
