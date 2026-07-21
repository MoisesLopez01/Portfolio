# Rocketeer Global Comp Health Report (V1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the standalone `CompDash/` GAS web app (Code.js + ViewDash.html + Security.js) that gives an allowlisted leadership pilot global visibility into attrition, internal compensation position, pay equity, QTA readiness, and comp growth history.

**Architecture:** One GAS project, one cached JSON payload. `Code.js` holds a pure-logic core (Node-testable, no GAS APIs) + a thin GAS layer (readers, cache, `doGet`). `ViewDash.html` is a single-page app driven by a `VIEWS` array. `Security.js` is an allowlist-only trim of the PS Security pattern (admin → viewer → denied; no supervisor resolution, no delegates, no open access).

**Tech Stack:** Google Apps Script (V8), HtmlService, CacheService (gzip-chunked), plain JS + inline SVG charts (no libraries), Node for pure-logic tests.

**Spec:** `docs/superpowers/specs/2026-07-21-comp-health-dashboard-design.md`

---

## File structure

| Path | Responsibility |
|---|---|
| `CompDash/Code.js` | `CONFIG_CD`; pure-logic core (level parser, fiscal calendar, attrition/compa/growth/equity/QTA engines); GAS layer (readers, cache helpers, `getCompReportData`, `doGet`, `debugCompPipeline`) |
| `CompDash/Security.js` | `SEC_CD` allowlist, `checkDashboardAccess`, `getAccessSettings` / `saveAccessSettings`, denied page |
| `CompDash/ViewDash.html` | SPA: header (currency toggle, refresh), `VIEWS` nav, 7 tab renderers + 2 menu views, employee drill panel, SVG chart helpers |
| `CompDash/tests/run_tests.js` | Node harness — evals `Code.js` + `cases.js` in ONE eval (top-level `const` in Code.js is invisible across separate evals) |
| `CompDash/tests/cases.js` | All test cases, appended task by task |

**Conventions (from CLAUDE.md — follow exactly):**
- Private helpers end in `_`. Config object is `CONFIG_CD`. Security constants `SEC_CD`.
- Column access ALWAYS by header name, never by index.
- `⚠️`/`❌` log prefixes use `Logger.log` directly (always on); verbose logs go through `log_()` gated by `CONFIG_CD.DEBUG`.
- The repo is LOCAL-ONLY: commit, never push.
- Pure-logic functions must not touch `SpreadsheetApp`/`PropertiesService`/`Session` — that is what makes them Node-testable.

**Run tests from repo root (`D:\Contribution`):** `node CompDash/tests/run_tests.js`

---

### Task 1: Scaffold + test harness + name/level parsing

**Files:**
- Create: `CompDash/tests/run_tests.js`
- Create: `CompDash/tests/cases.js`
- Create: `CompDash/Code.js`

- [ ] **Step 1: Create the Node test harness**

Create `CompDash/tests/run_tests.js`:

```js
// Node test runner for CompDash pure logic.
// Code.js + cases.js are eval'd TOGETHER in one call: top-level `const`/`let`
// bindings created by eval are scoped to that eval call, so a second eval
// could not see CONFIG_CD or the functions. Do not split this into two evals.
const fs = require("fs");
const path = require("path");

global.Logger = { log: (...a) => console.log(...a) };

const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "Code.js"), "utf8");
const cases = fs.readFileSync(path.join(__dirname, "cases.js"), "utf8");

const PRELUDE = `
var __passes = 0, __fails = 0;
function check(desc, cond) {
  if (cond) { __passes++; }
  else { __fails++; console.log("❌ " + desc); }
}
function approx(a, b, eps) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
}
`;
const EPILOGUE = `
console.log(__passes + " passed, " + __fails + " failed");
if (__fails > 0) process.exit(1);
`;

eval(PRELUDE + "\n" + src + "\n" + cases + "\n" + EPILOGUE);
```

- [ ] **Step 2: Write the failing tests for `normCD_` and `parseLevel_`**

Create `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: crash with `ReferenceError: normCD_ is not defined` (Code.js doesn't exist yet — create an empty `CompDash/Code.js` first if fs throws ENOENT, then re-run to see the ReferenceError).

- [ ] **Step 4: Write `Code.js` header, `CONFIG_CD`, and the Task-1 helpers**

Create `CompDash/Code.js`:

```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Code
// PURPOSE:     Rocketeer Global Comp Health Report (V1).
//              Data readers, metric engines, doGet, getCompReportData.
// SPEC:        docs/superpowers/specs/2026-07-21-comp-health-dashboard-design.md
//
// Layout: PURE LOGIC first (no GAS APIs — Node-testable via tests/),
//         GAS LAYER second (SpreadsheetApp/CacheService/HtmlService).
// ============================================================

const CONFIG_CD = {
  // Fallback source IDs — overridable via Script Properties (same names, CD_ prefix).
  ROSTER_SS_ID:    "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0", // roster + attrition + TCC USD
  COMP_HIST_SS_ID: "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU", // Compensation Report (RD tab)
  ROSTER_TAB:  "Data",     // verify at deploy; override via CD_ROSTER_TAB property
  TCC_USD_TAB: "TCC USD",
  HIST_TAB:    "RD",

  CACHE_TTL_SEC: 65 * 60,
  CACHE_KEY_PREFIX: "cd_",

  // Equity thresholds (Pay Equity tab) — tune here, never in the UI.
  EQUITY_GAP_PCT:     10, // gender median-gap % that flags a location+level group
  EQUITY_OUTLIER_PCT: 25, // individual % below group median that flags an outlier
  TENURE_YEARS_MIN:    3, // tenure lens: minimum years of service
  TENURE_BELOW_PCT:   15, // tenure lens: % below group median that flags
  SMALL_GROUP_MIN:     3, // compa groups smaller than this get a smallGroup flag

  CREW_RE: /crew member|contractor/i, // same crew rule as the PS Contribution Report
  // Narrower than PS Security's regex ON PURPOSE: Rocketeers on maternity/parental
  // leave are still employed — they stay in comp metrics and headcount.
  INACTIVE_RE: /terminat|job offer|resign|left|inactive|former|offboard/i,

  DEBUG: false,
};

// ============================================================
// PURE LOGIC — no GAS APIs below this line until the GAS LAYER marker
// ============================================================

function normCD_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Extracts the level token from a Job Title like "04.I3.1" / "04.M10.2".
 * @returns {{level: string, track: ("IC"|"M"|null)}} level "—" when unparseable.
 */
function parseLevel_(jobTitle) {
  const m = String(jobTitle || "").match(/(?:^|[^A-Za-z0-9])([IM])(\d{1,2})(?![0-9])/i);
  if (!m) return { level: "—", track: null };
  const letter = m[1].toUpperCase();
  return { level: letter + parseInt(m[2], 10), track: letter === "I" ? "IC" : "M" };
}

/** Sort key: ICs before management, numeric within track, "—" last. */
function levelRank_(level) {
  const m = String(level || "").match(/^([IM])(\d+)$/);
  if (!m) return 999;
  return (m[1] === "I" ? 0 : 100) + parseInt(m[2], 10);
}

function asNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function asDate_(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function isoDate_(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  const p = n => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `15 passed, 0 failed`

Note: `isoDate_` uses UTC getters and the test constructs with `Date.UTC` — sheet-parsed dates come back as local-midnight Dates, which is fine because only the date part is ever displayed. If the isoDate_ check fails locally, the local timezone is east of UTC — switch isoDate_ to local getters (`getFullYear` etc.) AND the test to `new Date(2026, 6, 21)`; either consistent pair passes.

- [ ] **Step 6: Commit**

```bash
git add CompDash/Code.js CompDash/tests/run_tests.js CompDash/tests/cases.js
git commit -m "feat(compdash): scaffold Code.js + Node test harness, level parser"
```

---

### Task 2: Fiscal calendar helpers

**Files:**
- Modify: `CompDash/Code.js` (append to PURE LOGIC section)
- Modify: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `fiscalContextCD_ is not defined`

- [ ] **Step 3: Implement the fiscal helpers**

Append to the PURE LOGIC section of `CompDash/Code.js` (before the GAS LAYER marker, which doesn't exist yet — just append at end of file):

```js
// ── Fiscal calendar (FY starts July 1; FY27 = Jul 2026 – Jun 2027) ─────────
// Same derivation rules as computeFiscalContext_ in PS Contribution Report.js,
// trimmed to what this dashboard needs (no ISO weeks, no grace periods).

function fiscalContextCD_(refDate) {
  const today = (refDate instanceof Date && !isNaN(refDate)) ? refDate : new Date();
  const m = today.getMonth() + 1;
  const yr = today.getFullYear();
  const fyStartCalYear = (m >= 7) ? yr : yr - 1;
  const fyNum = fyStartCalYear + 1;
  const qNum = (m >= 7 && m <= 9) ? 1 : (m >= 10) ? 2 : (m <= 3) ? 3 : 4;
  const ABBR = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May", "Jun"];
  return {
    asOf: today,
    fyNum,
    fyLabel: "FY" + String(fyNum).slice(-2),
    prevFyLabel: "FY" + String(fyNum - 1).slice(-2),
    qLabel: "Q" + qNum,
    fyStartCalYear,
    fyStart: new Date(fyStartCalYear, 6, 1),
    fyEnd: new Date(fyStartCalYear + 1, 5, 30),
    prevFyStart: new Date(fyStartCalYear - 1, 6, 1),
    prevFyEnd: new Date(fyStartCalYear, 5, 30),
    monthLabels: ABBR.map((a, i) =>
      a + " " + String(i < 6 ? fyStartCalYear : fyStartCalYear + 1).slice(-2)),
  };
}

/** 0-based fiscal month index (Jul=0 … Jun=11) of `date` within the FY starting `fyStartCalYear`; -1 if outside. */
function fiscalMonthIdx_(date, fyStartCalYear) {
  if (!(date instanceof Date) || isNaN(date)) return -1;
  const idx = (date.getFullYear() - fyStartCalYear) * 12 + date.getMonth() - 6;
  return (idx >= 0 && idx < 12) ? idx : -1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `30 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): fiscal calendar helpers (FY July 1, month indexing)"
```

---

### Task 3: Attrition engine

**Files:**
- Modify: `CompDash/Code.js` (append)
- Modify: `CompDash/tests/cases.js` (append)

The engine consumes **normalized roster records** (the reader in Task 9 produces them; tests build them directly). Record shape used from here on:

```js
// { empNo, name, email, active, jobTitle, level, track, dept, lob,
//   keyLocation, location, currency, hireDate: Date|null, termDate: Date|null,
//   termReason, termCategory, termRegretted, gender: string|null,
//   tcc: number|null, tccUsd: number|null }
```

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `buildAttrition_ is not defined`

- [ ] **Step 3: Implement the attrition engine**

Append to `CompDash/Code.js`:

```js
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
  return records.filter(r =>
    r.hireDate && r.hireDate <= date && (!r.termDate || r.termDate > date)).length;
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
    if (r.hireDate && r.hireDate <= fyStart && (!r.termDate || r.termDate > fyStart)) g.hcStart++;
    if (r.hireDate && r.hireDate <= end && (!r.termDate || r.termDate > end)) g.hcEnd++;
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
    slices: {
      department:  sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.dept),
      level:       sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.level)
                     .sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
      keyLocation: sliceAttrition_(records, ctx.fyStart, ctx.fyEnd, end, r => r.keyLocation),
    },
    detail,
  };
}
```

Note on `isoDate_` vs local-midnight term dates: `new Date(2027, 1, 5)` is local midnight; `isoDate_` reads UTC fields. In timezones west of UTC this yields the SAME calendar date (local midnight is later in UTC), east of UTC it can shift a day. The Task 1 note already covers the consistent fix — whichever variant passed Task 1 makes this test's `2027-02-05` expectation correct too (Moises' machine is UTC-6).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `46 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): FY-framed attrition engine with dept/level/location slices"
```

---

### Task 4: Internal Position (compa) engine + market suggestion logic

**Files:**
- Modify: `CompDash/Code.js` (append)
- Modify: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `buildCompaGroups_ is not defined`

- [ ] **Step 3: Implement the engines**

Append to `CompDash/Code.js`:

```js
// ── Internal Position engine ────────────────────────────────────────────────
// ratio = TCC ÷ max(TCC) within the same Key Location + Job Title peer group,
// ACTIVE employees, LOCAL currency. Deliberately labeled "Internal Position
// (vs peer max)" in the UI — it is NOT a band-midpoint compa ratio (no band
// data exists yet), so nobody can sit above 1.0 and the classic above/below-
// midpoint reading must never be attached to it.

function buildCompaGroups_(activeRecords, smallGroupMin) {
  const min = smallGroupMin || CONFIG_CD.SMALL_GROUP_MIN;
  const map = new Map();
  activeRecords.forEach(r => {
    const key = (r.keyLocation || "—") + "||" + (r.jobTitle || "—");
    if (!map.has(key)) {
      map.set(key, { keyLocation: r.keyLocation || "—", jobTitle: r.jobTitle || "—",
                     currency: r.currency || "", members: [], missingTcc: 0 });
    }
    const g = map.get(key);
    if (r.tcc == null || r.tcc <= 0) { g.missingTcc++; return; }
    g.members.push(r);
  });
  return [...map.values()].map(g => {
    const maxTcc = g.members.reduce((m, r) => Math.max(m, r.tcc), 0);
    const count = g.members.length;
    return {
      keyLocation: g.keyLocation, jobTitle: g.jobTitle, currency: g.currency,
      maxTcc, count, missingTcc: g.missingTcc,
      smallGroup: count > 0 && count < min,
      members: g.members
        .map(r => ({
          empNo: r.empNo, name: r.name, level: r.level, currency: r.currency,
          tcc: r.tcc, tccUsd: r.tccUsd,
          ratio: maxTcc > 0 ? Math.round(r.tcc / maxTcc * 1000) / 1000 : null,
          noPeers: count === 1,
        }))
        .sort((a, b) => b.tcc - a.tcc),
    };
  }).sort((a, b) =>
    a.keyLocation.localeCompare(b.keyLocation) || a.jobTitle.localeCompare(b.jobTitle));
}

// ── Market Gap suggestion (used once Payscale P25/P50/P75 data lands) ──────
// Returns the priority-of-read status the UI colors red/yellow/green.
function marketSuggestion_(tcc, p25, p50) {
  if (!(tcc > 0) || !(p25 > 0) || !(p50 > 0)) {
    return { status: "pending", pctToP25: null, pctToP50: null };
  }
  if (tcc < p25) return { status: "below-p25", pctToP25: (p25 - tcc) / tcc, pctToP50: (p50 - tcc) / tcc };
  if (tcc < p50) return { status: "below-p50", pctToP25: 0, pctToP50: (p50 - tcc) / tcc };
  return { status: "at-market", pctToP25: 0, pctToP50: 0 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `56 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): internal-position (peer-max) engine + market suggestion logic"
```

---

### Task 5: Growth engine (RRI + comp event history)

**Files:**
- Modify: `CompDash/Code.js` (append)
- Modify: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `rri_ is not defined`

- [ ] **Step 3: Implement the growth engine**

Append to `CompDash/Code.js`:

```js
// ── Growth engine (per-employee comp event history) ─────────────────────────
// Events come from the Compensation Report RD tab: each row is one comp event
// (New Hire, Salary adjustment, Promotion, …) with the local Total Target
// Compensation recorded at that event. The first event is the baseline — it
// gets no delta and no annualized rate (the "New Hire has nothing to compare
// against" rule falls out naturally).

const YEAR_MS_ = 365.25 * 86400000;

/** Annualized growth rate — the sheet RRI(1, prev, curr) generalized to fractional years. */
function rri_(years, prev, curr) {
  if (!(years > 0) || !(prev > 0) || !(curr > 0)) return null;
  return Math.pow(curr / prev, 1 / years) - 1;
}

function buildGrowthForEmp_(events) {
  const evs = (events || [])
    .filter(e => e && e.date instanceof Date && !isNaN(e.date))
    .sort((a, b) => a.date - b.date);
  const out = [];
  let prev = null;
  evs.forEach(e => {
    const row = { date: isoDate_(e.date), reason: e.reason || "", tcc: e.tcc,
                  deltaAbs: null, deltaPct: null, annualized: null };
    if (prev && e.tcc != null && e.tcc > 0) {
      const years = (e.date - prev.date) / YEAR_MS_;
      row.deltaAbs = e.tcc - prev.tcc;
      row.deltaPct = (e.tcc - prev.tcc) / prev.tcc;
      row.annualized = rri_(years, prev.tcc, e.tcc);
    }
    out.push(row);
    if (e.tcc != null && e.tcc > 0) prev = { date: e.date, tcc: e.tcc };
  });
  const valued = evs.filter(e => e.tcc != null && e.tcc > 0);
  const first = valued[0], last = valued[valued.length - 1];
  const overall = (first && last && last.date > first.date)
    ? rri_((last.date - first.date) / YEAR_MS_, first.tcc, last.tcc)
    : null;
  return { events: out, overallAnnualized: overall };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `65 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): RRI growth engine over comp event history"
```

---

### Task 6: Pay Equity engine

**Files:**
- Modify: `CompDash/Code.js` (append)
- Modify: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `buildEquity_ is not defined`

- [ ] **Step 3: Implement the equity engine**

Append to `CompDash/Code.js`:

```js
// ── Pay Equity engine ───────────────────────────────────────────────────────
// Three lenses computed within Key Location + level groups (same location ⇒
// same local currency, so TCC comparisons are honest):
//   gender   — median-gap % between genders with ≥2 members each in a group
//   tenure   — long-tenured Rocketeers sitting well below their group median
//   outliers — anyone far below their group median regardless of dimension
// Thresholds live in CONFIG_CD (passed in as cfg for Node-testability).
// Names appear ONLY in flag rows (expandable detail) — group stats carry counts.

function median_(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function tenureYears_(hireDate, asOf) {
  if (!(hireDate instanceof Date) || isNaN(hireDate)) return null;
  return (asOf - hireDate) / YEAR_MS_;
}

function buildEquity_(activeRecords, cfg, asOf) {
  const groups = new Map();
  activeRecords.forEach(r => {
    if (r.tcc == null || r.tcc <= 0) return;
    const key = (r.keyLocation || "—") + "||" + (r.level || "—");
    if (!groups.has(key)) groups.set(key, { keyLocation: r.keyLocation || "—", level: r.level || "—", members: [] });
    groups.get(key).members.push(r);
  });
  const genderAvailable = activeRecords.some(r => r.gender);
  const gender = [], outliers = [], tenure = [];
  groups.forEach(g => {
    const med = median_(g.members.map(r => r.tcc));

    if (genderAvailable) {
      const byG = new Map();
      g.members.forEach(r => {
        const gd = String(r.gender || "").trim();
        if (!gd) return;
        if (!byG.has(gd)) byG.set(gd, []);
        byG.get(gd).push(r.tcc);
      });
      const eligible = [...byG.entries()].filter(([, v]) => v.length >= 2);
      if (eligible.length >= 2) {
        const medians = {};
        eligible.forEach(([k, v]) => { medians[k] = median_(v); });
        const vals = Object.values(medians);
        const gapPct = (Math.max.apply(null, vals) - Math.min.apply(null, vals)) / Math.max.apply(null, vals) * 100;
        const counts = {};
        eligible.forEach(([k, v]) => { counts[k] = v.length; });
        gender.push({ keyLocation: g.keyLocation, level: g.level, counts, medians,
                      gapPct: Math.round(gapPct * 10) / 10, flagged: gapPct >= cfg.EQUITY_GAP_PCT });
      }
    }

    g.members.forEach(r => {
      if (med == null || med <= 0) return;
      const pctBelow = (med - r.tcc) / med * 100;
      if (pctBelow >= cfg.EQUITY_OUTLIER_PCT) {
        outliers.push({ empNo: r.empNo, name: r.name, keyLocation: g.keyLocation, level: g.level,
                        tcc: r.tcc, groupMedian: med, pctBelow: Math.round(pctBelow * 10) / 10 });
      }
      const ten = tenureYears_(r.hireDate, asOf);
      if (ten != null && ten >= cfg.TENURE_YEARS_MIN && pctBelow >= cfg.TENURE_BELOW_PCT) {
        tenure.push({ empNo: r.empNo, name: r.name, keyLocation: g.keyLocation, level: g.level,
                      tenureYears: Math.round(ten * 10) / 10, tcc: r.tcc, groupMedian: med,
                      pctBelow: Math.round(pctBelow * 10) / 10 });
      }
    });
  });
  return {
    genderAvailable,
    gender:   gender.sort((a, b) => b.gapPct - a.gapPct),
    tenure:   tenure.sort((a, b) => b.pctBelow - a.pctBelow),
    outliers: outliers.sort((a, b) => b.pctBelow - a.pctBelow),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `71 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): pay-equity engine (gender/tenure/outlier lenses)"
```

---

### Task 7: QTA interim engine

**Files:**
- Modify: `CompDash/Code.js` (append)
- Modify: `CompDash/tests/cases.js` (append)

- [ ] **Step 1: Write the failing tests**

Append to `CompDash/tests/cases.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node CompDash/tests/run_tests.js`
Expected: FAIL with `buildQtaInterim_ is not defined`

- [ ] **Step 3: Implement the QTA interim engine**

Append to `CompDash/Code.js`:

```js
// ── QTA interim engine ──────────────────────────────────────────────────────
// The official QTA-cycle source doesn't exist yet (placeholder tab). Interim
// signal: each active Rocketeer's Next Review date from their MOST RECENT RD
// event that carries one — sorted overdue-first so "waiting longest" tops the
// list. daysOverdue is positive when past due, negative when upcoming.

function buildQtaInterim_(activeRecords, histByEmp, asOf) {
  const DAY = 86400000;
  const rows = activeRecords.map(r => {
    const evs = (histByEmp[r.empNo] || [])
      .filter(e => e && e.date instanceof Date && !isNaN(e.date))
      .sort((a, b) => b.date - a.date); // newest first
    const last = evs[0] || null;
    const withReview = evs.find(e => e.nextReview instanceof Date && !isNaN(e.nextReview));
    const nextReview = withReview ? withReview.nextReview : null;
    return {
      empNo: r.empNo, name: r.name, dept: r.dept, keyLocation: r.keyLocation, level: r.level,
      nextReview: nextReview ? isoDate_(nextReview) : null,
      daysOverdue: nextReview ? Math.round((asOf - nextReview) / DAY) : null,
      lastEventDate: last ? isoDate_(last.date) : null,
      lastEventReason: last ? (last.reason || "") : "",
    };
  });
  return rows.sort((a, b) => {
    if (a.nextReview && b.nextReview) return b.daysOverdue - a.daysOverdue;
    if (a.nextReview) return -1;
    if (b.nextReview) return 1;
    return a.name.localeCompare(b.name);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node CompDash/tests/run_tests.js`
Expected: `75 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add CompDash/Code.js CompDash/tests/cases.js
git commit -m "feat(compdash): QTA interim engine (Next Review, overdue-first)"
```

---

### Task 8: Security.js — allowlist-only access control

**Files:**
- Create: `CompDash/Security.js`

No Node tests (every function touches `Session`/`PropertiesService`); verification is manual in the GAS editor at deploy time (Task 17 checklist).

- [ ] **Step 1: Write `CompDash/Security.js` in full**

```js
// ============================================================
// SCRIPT NAME: Comp Health Report — Security
// PURPOSE:     Email-allowlist access control.
//
// DELIBERATELY smaller than PS Security: this dashboard carries individual
// compensation data, so there is NO open-access fallback, NO roster-supervisor
// auto-resolution, and NO delegate scoping. Role resolution is
// admin → viewer → denied. Nobody sees comp data without a deliberate grant.
// (Org-tree manager scoping is the headline V2 feature — do not re-add the
// PS mechanisms piecemeal.)
//
//  1. BOOTSTRAP ADMIN (SEC_CD.BOOTSTRAP_ADMIN) — always Admin, not removable via UI.
//  2. DEFAULT ADMINS / VIEWERS — hardcoded here, survive a properties reset.
//  3. RUNTIME lists — Script Properties, managed from 🔒 Access Control (admin only).
//
//  ROLES: Admin — full dashboard + manages the access list.
//         Viewer — full dashboard, read-only settings.
// ============================================================

const SEC_CD = {
  PROP_ADMINS:  "CD_DASH_ADMINS",
  PROP_VIEWERS: "CD_DASH_VIEWERS",

  BOOTSTRAP_ADMIN: "moises.lopez@servicerocket.com",

  DEFAULT_ADMINS: [
    // "courtney.sutliff@servicerocket.com",  // sample — WFP
  ],
  DEFAULT_VIEWERS: [
    // "exec@servicerocket.com",              // sample — leadership pilot viewer
  ],
};

// ── PRIVATE ──────────────────────────────────────────────────

function _readAccessListsCD_() {
  const p = PropertiesService.getScriptProperties();
  const runtimeAdmins = (p.getProperty(SEC_CD.PROP_ADMINS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const runtimeViewers = (p.getProperty(SEC_CD.PROP_VIEWERS) || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

  const admins = [...new Set([
    SEC_CD.BOOTSTRAP_ADMIN.toLowerCase(),
    ...SEC_CD.DEFAULT_ADMINS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeAdmins,
  ])];
  const viewers = [...new Set([
    ...SEC_CD.DEFAULT_VIEWERS.map(e => e.trim().toLowerCase()).filter(Boolean),
    ...runtimeViewers,
  ])];
  return { admins, viewers };
}

// ── PUBLIC ───────────────────────────────────────────────────

/**
 * Access status for the current session user.
 * @returns {{allowed: boolean, role: ('admin'|'viewer'|'denied'), email: string}}
 */
function checkDashboardAccess() {
  const email = (Session.getActiveUser().getEmail() || "").toLowerCase().trim();
  const { admins, viewers } = _readAccessListsCD_();
  if (admins.includes(email))  return { allowed: true, role: "admin",  email };
  if (viewers.includes(email)) return { allowed: true, role: "viewer", email };
  return { allowed: false, role: "denied", email };
}

/** Admin-only: current lists for the Access Control view. */
function getAccessSettings() {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  const { admins, viewers } = _readAccessListsCD_();
  return {
    admins: admins.filter(e => e !== SEC_CD.BOOTSTRAP_ADMIN.toLowerCase()),
    viewers,
    bootstrapAdmin: SEC_CD.BOOTSTRAP_ADMIN,
    callerEmail: access.email,
  };
}

/**
 * Admin-only: persist runtime lists. Busts the report cache so a revoked
 * viewer can't keep reading a warm cached payload under the old version key.
 * @param {{admins?: string[], viewers?: string[]}} settings
 */
function saveAccessSettings(settings) {
  const access = checkDashboardAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  const p = PropertiesService.getScriptProperties();
  if (Array.isArray(settings.admins)) {
    p.setProperty(SEC_CD.PROP_ADMINS, settings.admins
      .map(e => String(e).trim().toLowerCase())
      .filter(e => e && e !== SEC_CD.BOOTSTRAP_ADMIN.toLowerCase())
      .join(","));
  }
  if (Array.isArray(settings.viewers)) {
    p.setProperty(SEC_CD.PROP_VIEWERS, settings.viewers
      .map(e => String(e).trim().toLowerCase())
      .filter(Boolean)
      .join(","));
  }
  bustCompCache_(); // defined in Code.js
  Logger.log("✅ Access lists saved by " + access.email);
  return getAccessSettings();
}

/** Branded denied page — reveals nothing about the data or the allowlist. */
function deniedPageHtml_(email) {
  return '<!DOCTYPE html><html><head><base target="_top"><style>' +
    'body{font-family:system-ui,"Segoe UI",Arial,sans-serif;background:#10201a;color:#e8f2ec;' +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0}' +
    '.card{background:#183028;border:1px solid #2a4a3c;border-radius:12px;padding:32px 40px;max-width:460px;text-align:center}' +
    'h1{font-size:20px;margin:0 0 8px}p{color:#9fb8ab;font-size:14px;line-height:1.5}' +
    '</style></head><body><div class="card"><h1>🔒 Access restricted</h1>' +
    '<p>This report contains sensitive compensation data and is limited to an approved leadership group.</p>' +
    '<p>Signed in as <b>' + String(email || "unknown").replace(/[<>&]/g, "") + '</b>.<br>' +
    'If you believe you need access, contact Moises Lopez.</p></div></body></html>';
}
```

- [ ] **Step 2: Sanity-check the file parses under Node**

Run: `node -e "new Function(require('fs').readFileSync('CompDash/Security.js','utf8')); console.log('parses OK')"`
Expected: `parses OK`

- [ ] **Step 3: Commit**

```bash
git add CompDash/Security.js
git commit -m "feat(compdash): allowlist-only security (admin/viewer/denied, no fallbacks)"
```

---

### Task 9: GAS layer — cache, readers, assembly, doGet, diagnostics

**Files:**
- Modify: `CompDash/Code.js` (append the GAS LAYER section)

These functions touch `SpreadsheetApp`/`CacheService`/`HtmlService`, so no Node tests — the harness never CALLS them (eval only defines them), so `node CompDash/tests/run_tests.js` must still pass after this task. Live verification happens via `debugCompPipeline()` in Task 17.

Note on rehires (boomerang stints): a rehired Rocketeer has an old terminated row AND a current active row in the roster. No collapse is needed here — active metrics filter to `active` rows only, the old stint's termination legitimately counts in that FY's attrition, and `headcountOn_` evaluates each stint row by its own hire/term dates. (This differs from goalCompliance, which needed active-wins collapsing because it joins by Name.)

- [ ] **Step 1: Append the GAS layer to `CompDash/Code.js`**

```js
// ============================================================
// GAS LAYER — everything below touches GAS services.
// Nothing below this line is exercised by the Node test harness.
// ============================================================

function log_(msg) { if (CONFIG_CD.DEBUG) Logger.log(msg); }

function props_() { return PropertiesService.getScriptProperties(); }

function ssIds_() {
  const p = props_();
  return {
    roster:    p.getProperty("CD_ROSTER_SS_ID")    || CONFIG_CD.ROSTER_SS_ID,
    hist:      p.getProperty("CD_COMP_HIST_SS_ID") || CONFIG_CD.COMP_HIST_SS_ID,
    rosterTab: p.getProperty("CD_ROSTER_TAB")      || CONFIG_CD.ROSTER_TAB,
  };
}

// ── Large-payload cache (gzip + chunking) ───────────────────────────────────
// Same pattern as PS Contribution Report: CacheService rejects any single
// value over 100 KB and a plain put() fails silently, so the JSON is gzipped
// (~10× smaller) and split across numbered chunk keys. A missing chunk on
// read is a clean miss.
const CACHE_CHUNK_BYTES_ = 90 * 1024;

function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    const b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    const entries = {};
    let n = 0;
    for (let i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    log_("cachePutLarge_: " + key + " — " + str.length + " chars → " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

function cacheGetLarge_(cache, key) {
  try {
    const meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    const names = [];
    for (let i = 0; i < meta; i++) names.push(key + "_" + i);
    const got = cache.getAll(names);
    let b64 = "";
    for (let i = 0; i < meta; i++) {
      const part = got[key + "_" + i];
      if (!part) return null; // chunk evicted — treat as a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}

/** Bump CD_CACHE_VER — strands every prior cache entry at once. */
function bustCompCache_() {
  const p = props_();
  const cur = parseInt(p.getProperty("CD_CACHE_VER") || "1", 10);
  p.setProperty("CD_CACHE_VER", String(cur + 1));
  Logger.log("✅ bustCompCache_: CD_CACHE_VER → " + (cur + 1));
}

// ── Sheet readers (header-name access only) ─────────────────────────────────

function fetchTab_(ssId, tabName) {
  const sh = SpreadsheetApp.openById(ssId).getSheetByName(tabName);
  if (!sh) throw new Error('Tab "' + tabName + '" not found');
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  return { headers, rows: values };
}

function colIdx_(headers, name, re) {
  let i = headers.indexOf(name);
  if (i === -1 && re) i = headers.findIndex(h => re.test(h));
  return i;
}

/** @returns {{records: Object[], genderAvailable: boolean}} normalized roster records (crew excluded). */
function readRosterCD_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.roster, ids.rosterTab);
  const col = (name, re) => colIdx_(headers, name, re);
  const c = {
    empNo: col("Employee Number"), name: col("Name"), status: col("Employee Status"),
    title: col("Job Title"), hire: col("Hire Date"),
    term: col("Termination/Release Date"), currency: col("Currency"),
    location: col("Location"), tcc: col("Total Cash Compensation (TCC)", /total cash comp/i),
    lob: col("LOB"), dept: col("Department"), email: col("Email"),
    termReason: col("Termination Reason"), termRegret: col("Termination Regretted"),
    termCat: col("Termination Category"), keyLoc: col("Key Location"),
    gender: col("Gender"), // optional — being added to the roster
  };
  const required = { empNo: c.empNo, name: c.name, title: c.title, keyLoc: c.keyLoc };
  Object.keys(required).forEach(k => {
    if (required[k] === -1) throw new Error("Roster column missing: " + k);
  });
  const genderAvailable = c.gender !== -1;
  const records = [];
  rows.forEach(row => {
    const name = String(row[c.name] || "").trim();
    if (!name) return;
    const title = String(row[c.title] || "").trim();
    if (CONFIG_CD.CREW_RE.test(title)) return; // crew/contractors out of scope in V1
    const status = c.status !== -1 ? String(row[c.status] || "").trim() : "";
    const termDate = c.term !== -1 ? asDate_(row[c.term]) : null;
    const lvl = parseLevel_(title);
    records.push({
      empNo: String(row[c.empNo] || "").trim(),
      name,
      email: c.email !== -1 ? String(row[c.email] || "").trim().toLowerCase() : "",
      active: !termDate && !CONFIG_CD.INACTIVE_RE.test(status),
      jobTitle: title, level: lvl.level, track: lvl.track,
      dept: c.dept !== -1 ? String(row[c.dept] || "").trim() : "",
      lob: c.lob !== -1 ? String(row[c.lob] || "").trim() : "",
      keyLocation: String(row[c.keyLoc] || "").trim(),
      location: c.location !== -1 ? String(row[c.location] || "").trim() : "",
      currency: c.currency !== -1 ? String(row[c.currency] || "").trim() : "",
      hireDate: c.hire !== -1 ? asDate_(row[c.hire]) : null,
      termDate,
      termReason: c.termReason !== -1 ? String(row[c.termReason] || "").trim() : "",
      termCategory: c.termCat !== -1 ? String(row[c.termCat] || "").trim() : "",
      termRegretted: c.termRegret !== -1 ? String(row[c.termRegret] || "").trim() : "",
      gender: genderAvailable ? (String(row[c.gender] || "").trim() || null) : null,
      tcc: c.tcc !== -1 ? asNum_(row[c.tcc]) : null,
      tccUsd: null, // joined from the TCC USD tab in getCompReportData
    });
  });
  log_("readRosterCD_: " + records.length + " records, gender " + (genderAvailable ? "available" : "pending"));
  return { records, genderAvailable };
}

/** @returns {Object<string, number>} Employee Number → USD TCC. */
function readTccUsd_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.roster, CONFIG_CD.TCC_USD_TAB);
  const iEmp = colIdx_(headers, "Employee Number", /employee.*number/i);
  const iTcc = colIdx_(headers, "Total Cash Compensation (TCC)", /tcc|total cash/i);
  if (iEmp === -1 || iTcc === -1) {
    throw new Error("TCC USD tab: columns not recognized — headers: " + headers.join(" | "));
  }
  const map = {};
  rows.forEach(row => {
    const emp = String(row[iEmp] || "").trim();
    const usd = asNum_(row[iTcc]);
    if (emp && usd != null) map[emp] = usd;
  });
  log_("readTccUsd_: " + Object.keys(map).length + " employees");
  return map;
}

/** @returns {Object<string, Array>} Employee Number → comp events sorted asc by Effective Date. */
function readCompHistory_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.hist, CONFIG_CD.HIST_TAB);
  const iEmp    = colIdx_(headers, "Employee Number");
  const iDate   = colIdx_(headers, "Effective Date");
  const iTtc    = colIdx_(headers, "Total Target Compensation");
  const iReason = colIdx_(headers, "TCC Change Reason");
  const iNext   = colIdx_(headers, "Next Review");
  if (iEmp === -1 || iDate === -1 || iTtc === -1) {
    throw new Error("RD tab: required columns missing — headers: " + headers.join(" | "));
  }
  const byEmp = {};
  rows.forEach(row => {
    const emp = String(row[iEmp] || "").trim();
    const date = asDate_(row[iDate]);
    if (!emp || !date) return;
    if (!byEmp[emp]) byEmp[emp] = [];
    byEmp[emp].push({
      date,
      reason: iReason !== -1 ? String(row[iReason] || "").trim() : "",
      tcc: asNum_(row[iTtc]), // LOCAL Total Target Compensation recorded at the event
      nextReview: iNext !== -1 ? asDate_(row[iNext]) : null,
    });
  });
  Object.keys(byEmp).forEach(k => byEmp[k].sort((a, b) => a.date - b.date));
  log_("readCompHistory_: " + Object.keys(byEmp).length + " employees with events");
  return byEmp;
}

// ── Assembly + web app ──────────────────────────────────────────────────────

/**
 * Full report payload. Access-checked server-side (defense in depth — the
 * client can call this via google.script.run without going through doGet).
 * @param {boolean} force - true bypasses cache (Refresh button).
 */
function getCompReportData(force) {
  const access = checkDashboardAccess();
  if (!access.allowed) return { ok: false, error: "denied" };

  const cache = CacheService.getScriptCache();
  const ver = props_().getProperty("CD_CACHE_VER") || "1";
  const key = CONFIG_CD.CACHE_KEY_PREFIX + "v" + ver + "_all";
  if (!force) {
    const hit = cacheGetLarge_(cache, key);
    if (hit) {
      const obj = JSON.parse(hit);
      obj.meta.fromCache = true;
      obj.meta.role = access.role;   // never serve the cached builder's identity
      obj.meta.email = access.email;
      return obj;
    }
  }

  const t0 = Date.now();
  const ctx = fiscalContextCD_();
  const sources = { roster: "ok", tccUsd: "ok", history: "ok" };

  let records = [], genderAvailable = false;
  try {
    const r = readRosterCD_();
    records = r.records;
    genderAvailable = r.genderAvailable;
  } catch (e) {
    sources.roster = "error: " + e.message;
    Logger.log("❌ readRosterCD_: " + e.message);
  }
  let usdMap = {};
  try { usdMap = readTccUsd_(); }
  catch (e) { sources.tccUsd = "error: " + e.message; Logger.log("⚠️ readTccUsd_: " + e.message); }
  let histByEmp = {};
  try { histByEmp = readCompHistory_(); }
  catch (e) { sources.history = "error: " + e.message; Logger.log("⚠️ readCompHistory_: " + e.message); }

  records.forEach(r => { r.tccUsd = (usdMap[r.empNo] != null) ? usdMap[r.empNo] : null; });
  const active = records.filter(r => r.active);

  const history = {};
  active.forEach(r => { if (histByEmp[r.empNo]) history[r.empNo] = buildGrowthForEmp_(histByEmp[r.empNo]); });

  const payload = {
    ok: true,
    meta: {
      generatedAt: new Date().toISOString(),
      role: access.role, email: access.email, fromCache: false,
      fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel, qLabel: ctx.qLabel,
      monthLabels: ctx.monthLabels,
      fiscalMonthIdx: fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear),
      sources, genderAvailable,
      activeCount: active.length,
      contribUrl: props_().getProperty("CD_CONTRIB_URL") || "",
    },
    employees: active.map(r => ({
      empNo: r.empNo, name: r.name, jobTitle: r.jobTitle, level: r.level, track: r.track,
      dept: r.dept, keyLocation: r.keyLocation, currency: r.currency,
      tcc: r.tcc, tccUsd: r.tccUsd, hireDate: isoDate_(r.hireDate), gender: r.gender,
    })),
    attrition: buildAttrition_(records, ctx),
    compaGroups: buildCompaGroups_(active, CONFIG_CD.SMALL_GROUP_MIN),
    equity: buildEquity_(active, CONFIG_CD, ctx.asOf),
    qtaInterim: buildQtaInterim_(active, histByEmp, ctx.asOf),
    history,
  };

  const json = JSON.stringify(payload);
  cachePutLarge_(cache, key, json, CONFIG_CD.CACHE_TTL_SEC);
  Logger.log("✅ getCompReportData: built in " + Math.round((Date.now() - t0) / 1000) + "s — " +
             json.length + " chars, " + active.length + " active");
  return payload;
}

function doGet() {
  const access = checkDashboardAccess();
  if (!access.allowed) {
    Logger.log("⚠️ doGet denied: " + access.email);
    return HtmlService.createHtmlOutput(deniedPageHtml_(access.email))
      .setTitle("Access restricted");
  }
  const t = HtmlService.createTemplateFromFile("ViewDash");
  t.userRole = access.role;
  t.userEmail = access.email;
  return t.evaluate()
    .setTitle("Rocketeer Global Comp Health Report")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ── Diagnostics — run from the GAS editor ───────────────────────────────────
function debugCompPipeline() {
  const r = readRosterCD_();
  const active = r.records.filter(x => x.active);
  Logger.log("Roster: " + r.records.length + " rows after crew exclusion, " + active.length +
             " active, gender " + (r.genderAvailable ? "AVAILABLE" : "PENDING"));
  const parsed = active.filter(x => x.level !== "—").length;
  Logger.log("Level parse: " + parsed + "/" + active.length + " (" +
             Math.round(parsed / Math.max(1, active.length) * 100) + "%) — sample misses: " +
             active.filter(x => x.level === "—").slice(0, 5).map(x => x.jobTitle).join(" | "));
  const usd = readTccUsd_();
  const usdHits = active.filter(x => usd[x.empNo] != null).length;
  Logger.log("TCC USD join: " + usdHits + "/" + active.length + " active matched");
  const hist = readCompHistory_();
  const histHits = active.filter(x => hist[x.empNo]).length;
  Logger.log("RD history join: " + histHits + "/" + active.length + " active matched, " +
             Object.keys(hist).length + " employees total in RD");
  const groups = buildCompaGroups_(active, CONFIG_CD.SMALL_GROUP_MIN);
  const small = groups.filter(g => g.smallGroup).length;
  Logger.log("Compa groups: " + groups.length + " (" + small + " small, " +
             groups.filter(g => g.count === 1).length + " singletons)");
}
```

- [ ] **Step 2: Verify the Node suite still passes (GAS layer must not break the eval)**

Run: `node CompDash/tests/run_tests.js`
Expected: `75 passed, 0 failed` — the GAS-layer functions are defined but never called by the harness.

- [ ] **Step 3: Commit**

```bash
git add CompDash/Code.js
git commit -m "feat(compdash): GAS layer — readers, gzip cache, getCompReportData, doGet"
```

---

### Task 10: ViewDash.html shell — nav, load, helpers, stub renderers

**Files:**
- Create: `CompDash/ViewDash.html`
- Create: `CompDash/tests/parse_html.js`

The shell ships with stub renderers; Tasks 11–16 replace them one by one (edit the function declarations in the source file — the `RENDERERS` map picks up whatever is declared when the file is pushed). GAS template scriptlets (`<?= ?>`) prevent opening the file locally, so a parse-check script guards against syntax errors.

- [ ] **Step 1: Create the parse-check script**

Create `CompDash/tests/parse_html.js`:

```js
// Syntax-checks the <script> block of ViewDash.html (GAS scriptlets stubbed out).
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "ViewDash.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.log("❌ no <script> block found"); process.exit(1); }
const js = m[1].replace(/<\?[=!]?[\s\S]*?\?>/g, "x"); // "<?= userRole ?>" sits inside quotes → "x"
try { new Function(js); console.log("✅ ViewDash.html script parses"); }
catch (e) { console.log("❌ " + e.message); process.exit(1); }
```

- [ ] **Step 2: Create `CompDash/ViewDash.html` in full**

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    :root {
      /* Ink-green house palette. To match PS Dashboard exactly, copy its :root values over these. */
      --bg: #0f1e18; --panel: #172b22; --panel-2: #1d3529; --border: #2a4a3c;
      --text: #e8f2ec; --muted: #9fb8ab; --chip: #234034;
      --accent: #35c26e;  /* green — good / primary */
      --warn:   #e8b93c;  /* yellow — attention */
      --bad:    #e05252;  /* red — priority read */
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, "Segoe UI", Arial, sans-serif; }
    header { display: flex; align-items: center; gap: 14px; padding: 12px 18px; background: var(--panel); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; flex-wrap: wrap; }
    header h1 { font-size: 17px; margin: 0; }
    .sub { color: var(--muted); font-size: 12px; }
    .hdr-right { margin-left: auto; display: flex; gap: 10px; align-items: center; }
    button { background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 12px; cursor: pointer; font: inherit; }
    button:hover { border-color: var(--accent); }
    .seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; border-radius: 0; background: transparent; }
    .seg button.on { background: var(--accent); color: #08130d; font-weight: 600; }
    nav { display: flex; gap: 6px; padding: 10px 18px 0; flex-wrap: wrap; }
    nav button.on { background: var(--panel-2); border-color: var(--accent); font-weight: 600; }
    main { padding: 16px 18px 60px; max-width: 1280px; margin: 0 auto; }
    .card { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 14px; }
    .banner { background: #3a3320; border: 1px solid var(--warn); color: #f2e2ad; border-radius: 10px; padding: 10px 14px; margin-bottom: 14px; font-size: 13px; }
    .banner.err { background: #3a2020; border-color: var(--bad); color: #f2b8b8; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-weight: 600; font-size: 12px; }
    tr.click { cursor: pointer; }
    tr.click:hover td { background: var(--panel-2); }
    .chip { display: inline-block; background: var(--chip); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 12px; margin: 0 6px 6px 0; }
    .chip.green { border-color: var(--accent); color: var(--accent); }
    .chip.yellow { border-color: var(--warn); color: var(--warn); }
    .chip.red { border-color: var(--bad); color: var(--bad); }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; margin-bottom: 14px; }
    .kpi { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 14px; cursor: pointer; }
    .kpi:hover { border-color: var(--accent); }
    .kpi-q { color: var(--muted); font-size: 12px; min-height: 30px; }
    .kpi-v { font-size: 26px; font-weight: 700; margin: 4px 0 2px; }
    .kpi-s { color: var(--muted); font-size: 11px; }
    .bar { height: 8px; border-radius: 4px; background: var(--chip); overflow: hidden; }
    .bar > i { display: block; height: 100%; }
    .menu { position: absolute; top: 52px; left: 12px; background: var(--panel-2); border: 1px solid var(--border); border-radius: 10px; padding: 6px; z-index: 30; display: flex; flex-direction: column; gap: 4px; min-width: 200px; }
    .menu button { text-align: left; border: none; background: transparent; }
    .menu button:hover { background: var(--chip); }
    .drill { position: fixed; top: 0; right: 0; width: min(560px, 96vw); height: 100vh; background: var(--panel); border-left: 1px solid var(--border); z-index: 40; padding: 18px; overflow-y: auto; box-shadow: -12px 0 30px rgba(0,0,0,.4); }
    .hidden { display: none; }
    #loading { position: fixed; inset: 0; background: rgba(10,20,15,.85); display: flex; align-items: center; justify-content: center; z-index: 50; font-size: 15px; color: var(--muted); }
    select, textarea { background: var(--chip); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 6px 10px; font: inherit; }
    details { margin-top: 8px; }
    summary { cursor: pointer; color: var(--muted); }
    h2 { font-size: 15px; margin: 0 0 10px; }
    h3 { font-size: 13px; color: var(--muted); margin: 14px 0 6px; }
    a { color: var(--accent); }
    svg text { fill: var(--muted); font-size: 10px; }
  </style>
</head>
<body>
<header>
  <button id="menuBtn" title="Menu">☰</button>
  <div>
    <h1>Rocketeer Global Comp Health Report</h1>
    <div class="sub" id="subTitle">loading…</div>
  </div>
  <div class="hdr-right">
    <div class="seg" id="curToggle">
      <button data-cur="LOCAL" class="on">Local</button>
      <button data-cur="USD">USD</button>
    </div>
    <button id="refreshBtn" title="Bypass cache for a live read">⟳ Refresh</button>
  </div>
</header>
<div id="menuPanel" class="menu hidden"></div>
<nav id="tabbar"></nav>
<main><div id="pane"></div></main>
<div id="drill" class="drill hidden"></div>
<div id="loading">Loading compensation data…</div>

<script>
"use strict";
const USER_ROLE  = "<?= userRole ?>";
const USER_EMAIL = "<?= userEmail ?>";

// Single source of truth for navigation — same pattern as PS Dashboard.
const VIEWS = [
  { id: "overview",  label: "🏠 Overview",           roles: ["admin", "viewer"] },
  { id: "attrition", label: "📉 Attrition",           roles: ["admin", "viewer"] },
  { id: "compa",     label: "⚖️ Internal Position",   roles: ["admin", "viewer"] },
  { id: "market",    label: "🌍 Market Gap",          roles: ["admin", "viewer"] },
  { id: "equity",    label: "🧭 Pay Equity",          roles: ["admin", "viewer"] },
  { id: "qta",       label: "📋 QTA Status",          roles: ["admin", "viewer"] },
  { id: "contrib",   label: "🚀 Contribution",        roles: ["admin", "viewer"] },
  { id: "reference", label: "📊 Data Reference",      roles: ["admin", "viewer"], menu: true },
  { id: "access",    label: "🔒 Access Control",      roles: ["admin"],           menu: true },
];

const STATE = {
  data: null, tab: "overview", currency: "LOCAL",
  attrGran: "month", attrDim: "department",
  compaFilters: { loc: "", level: "", dept: "" },
};

// ── helpers ─────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtMoney(tcc, tccUsd, currency) {
  if (STATE.currency === "USD") return tccUsd != null ? "$" + Math.round(tccUsd).toLocaleString() : "—";
  return tcc != null ? Math.round(tcc).toLocaleString() + (currency ? " " + currency : "") : "—";
}
function pctFmt(x, dp) { return x == null ? "—" : (x * 100).toFixed(dp == null ? 1 : dp) + "%"; }
function ratioClass(r) { return r == null ? "" : r >= 0.9 ? "green" : r >= 0.75 ? "yellow" : "red"; }
function median(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function sourceBanner(key, label) {
  const s = STATE.data.meta.sources[key];
  return s === "ok" ? "" :
    '<div class="banner err">⚠️ ' + esc(label) + ' unavailable — ' + esc(s) + '</div>';
}

// ── navigation ──────────────────────────────────────────────
function buildNav() {
  const bar = document.getElementById("tabbar");
  bar.innerHTML = "";
  VIEWS.filter(v => !v.menu && v.roles.includes(USER_ROLE)).forEach(v => {
    const b = document.createElement("button");
    b.textContent = v.label;
    b.id = "tab_" + v.id;
    b.onclick = () => switchTab(v.id);
    bar.appendChild(b);
  });
  const menu = document.getElementById("menuPanel");
  menu.innerHTML = "";
  VIEWS.filter(v => v.menu && v.roles.includes(USER_ROLE)).forEach(v => {
    const b = document.createElement("button");
    b.textContent = v.label;
    b.onclick = () => { menu.classList.add("hidden"); switchTab(v.id); };
    menu.appendChild(b);
  });
}
function switchTab(id) {
  const v = VIEWS.find(x => x.id === id);
  // Role gate enforced HERE, not just by hiding buttons.
  if (!v || !v.roles.includes(USER_ROLE)) id = "overview";
  STATE.tab = id;
  VIEWS.filter(x => !x.menu).forEach(x => {
    const b = document.getElementById("tab_" + x.id);
    if (b) b.classList.toggle("on", x.id === id);
  });
  closeDrill();
  render();
}
function render() {
  if (!STATE.data) return;
  (RENDERERS[STATE.tab] || renderOverview)(document.getElementById("pane"));
}

// ── data load ───────────────────────────────────────────────
function loadData(force) {
  document.getElementById("loading").classList.remove("hidden");
  google.script.run
    .withSuccessHandler(onData)
    .withFailureHandler(onLoadError)
    .getCompReportData(!!force);
}
function onData(d) {
  if (!d || !d.ok) { onLoadError(new Error((d && d.error) || "Unknown load failure")); return; }
  STATE.data = d;
  document.getElementById("subTitle").textContent =
    d.meta.fyLabel + " " + d.meta.qLabel + " · " + d.meta.activeCount + " active Rocketeers · " +
    (d.meta.fromCache ? "cached" : "live") + " · " + USER_ROLE;
  document.getElementById("loading").classList.add("hidden");
  render();
}
function onLoadError(err) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("pane").innerHTML =
    '<div class="banner err">❌ Could not load the report: ' + esc((err && err.message) || err) + '</div>';
}

// ── stub renderers — each is REPLACED (in this source file) by a later task ──
function renderOverview(el)  { el.innerHTML = '<div class="card">Overview — Task 11</div>'; }
function renderAttrition(el) { el.innerHTML = '<div class="card">Attrition — Task 12</div>'; }
function renderCompa(el)     { el.innerHTML = '<div class="card">Internal Position — Task 13</div>'; }
function renderMarket(el)    { el.innerHTML = '<div class="card">Market Gap — Task 15</div>'; }
function renderEquity(el)    { el.innerHTML = '<div class="card">Pay Equity — Task 15</div>'; }
function renderQta(el)       { el.innerHTML = '<div class="card">QTA Status — Task 16</div>'; }
function renderContrib(el)   { el.innerHTML = '<div class="card">Contribution — Task 16</div>'; }
function renderReference(el) { el.innerHTML = '<div class="card">Data Reference — Task 16</div>'; }
function renderAccess(el)    { el.innerHTML = '<div class="card">Access Control — Task 16</div>'; }

const RENDERERS = {
  overview: renderOverview, attrition: renderAttrition, compa: renderCompa,
  market: renderMarket, equity: renderEquity, qta: renderQta,
  contrib: renderContrib, reference: renderReference, access: renderAccess,
};

// ── employee drill panel (implemented in Task 14) ───────────
function openDrill(empNo) {}
function closeDrill() { document.getElementById("drill").classList.add("hidden"); }

// ── wiring ──────────────────────────────────────────────────
document.getElementById("menuBtn").onclick = () =>
  document.getElementById("menuPanel").classList.toggle("hidden");
document.getElementById("refreshBtn").onclick = () => loadData(true);
document.querySelectorAll("#curToggle button").forEach(b => {
  b.onclick = () => {
    STATE.currency = b.dataset.cur;
    document.querySelectorAll("#curToggle button").forEach(x => x.classList.toggle("on", x === b));
    render();
  };
});
document.addEventListener("click", e => {
  const menu = document.getElementById("menuPanel");
  if (!menu.classList.contains("hidden") &&
      !menu.contains(e.target) && e.target.id !== "menuBtn") menu.classList.add("hidden");
});

buildNav();
switchTab("overview");
loadData(false);
</script>
</body>
</html>
```

- [ ] **Step 3: Run the parse check**

Run: `node CompDash/tests/parse_html.js`
Expected: `✅ ViewDash.html script parses`

- [ ] **Step 4: Commit**

```bash
git add CompDash/ViewDash.html CompDash/tests/parse_html.js
git commit -m "feat(compdash): ViewDash shell — VIEWS nav, currency toggle, loader, stubs"
```

---

### Task 11: Overview tab (manager mental-model KPI cards)

**Files:**
- Modify: `CompDash/ViewDash.html` (replace the `renderOverview` stub; add `svgSpark` next to the other helpers)

- [ ] **Step 1: Add the sparkline helper**

Insert after `sourceBanner` in the helpers section:

```js
function svgSpark(series, w, h, color) {
  const max = Math.max.apply(null, series.concat([1]));
  const step = w / Math.max(1, series.length - 1);
  const pts = series.map((v, i) =>
    (i * step).toFixed(1) + "," + (h - v / max * (h - 4) - 2).toFixed(1)).join(" ");
  return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
         '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2"/></svg>';
}
```

- [ ] **Step 2: Replace the `renderOverview` stub**

```js
function renderOverview(el) {
  const d = STATE.data, cur = d.attrition.currentFY, prev = d.attrition.previousFY, eq = d.equity;
  const ratios = [];
  d.compaGroups.forEach(g => g.members.forEach(m => {
    if (m.ratio != null && !m.noPeers) ratios.push(m.ratio);
  }));
  const medRatio = median(ratios);
  const flags = eq.outliers.length + eq.tenure.length +
    (eq.genderAvailable ? eq.gender.filter(g => g.flagged).length : 0);
  const overdue = d.qtaInterim.filter(r => r.daysOverdue != null && r.daysOverdue > 0).length;

  // The six manager mental-model questions, in reading order (spec §1).
  const cards = [
    { q: "Is my team healthy? Are people staying?", v: pctFmt(cur.rate),
      s: d.meta.fyLabel + " attrition · " + prev.label + " " + pctFmt(prev.rate), tab: "attrition" },
    { q: "Are Rocketeers paid fairly vs peers?", v: medRatio != null ? medRatio.toFixed(2) : "—",
      s: "median Internal Position (vs peer max)", tab: "compa" },
    { q: "Is our band still competitive in the market?", v: "Pending",
      s: "Payscale benchmarks not loaded yet", tab: "market" },
    { q: "Is anyone being paid inequitably?", v: String(flags),
      s: eq.genderAvailable ? "equity flags to review" : "equity flags (gender lens pending)", tab: "equity" },
    { q: "Who is coming up for review this quarter?", v: String(overdue),
      s: "Next Review dates overdue", tab: "qta" },
    { q: "Whose contribution warrants recognition?", v: "→",
      s: "open the Contribution Report", tab: "contrib" },
  ];
  el.innerHTML =
    '<div class="kpi-grid">' + cards.map(c =>
      '<div class="kpi" onclick="switchTab(\'' + c.tab + '\')">' +
      '<div class="kpi-q">' + esc(c.q) + '</div><div class="kpi-v">' + esc(c.v) + '</div>' +
      '<div class="kpi-s">' + esc(c.s) + '</div></div>').join("") + '</div>' +
    '<div class="card"><h2>' + esc(d.meta.fyLabel) + ' terminations by fiscal month</h2>' +
    svgSpark(cur.monthly.map(m => m.terms), 640, 60, "var(--warn)") +
    '<div class="sub">' + esc(d.meta.monthLabels[0]) + ' → ' + esc(d.meta.monthLabels[11]) + '</div></div>';
}
```

- [ ] **Step 3: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): overview tab — mental-model KPI cards + term sparkline"
```

---

### Task 12: Attrition tab (FY shadow-vs-trend chart, slices, detail)

**Files:**
- Modify: `CompDash/ViewDash.html` (replace the `renderAttrition` stub; add `attritionChart`, `setAttrGran`, `setAttrDim`)

- [ ] **Step 1: Add the FY comparison chart helper** (next to `svgSpark`)

```js
// Previous FY as a shadow area, current FY as a trend line cut at the current
// fiscal month (uptoIdx) so future months don't render as zero.
function attritionChart(prevSeries, curSeries, labels, uptoIdx, w, h) {
  const P = 26, n = labels.length;
  const prevV = prevSeries.map(m => m.terms);
  const curV = curSeries.map(m => m.terms);
  const maxY = Math.max.apply(null, prevV.concat(curV, [1]));
  const x = i => P + i * ((w - P - 6) / Math.max(1, n - 1));
  const y = v => h - 18 - v / maxY * (h - 30);
  const area = prevV.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ") +
    " " + x(n - 1).toFixed(1) + "," + y(0).toFixed(1) + " " + x(0).toFixed(1) + "," + y(0).toFixed(1);
  const cut = Math.max(0, Math.min(uptoIdx, n - 1));
  const line = curV.slice(0, cut + 1).map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
  const ticks = labels.map((L, i) =>
    (n <= 4 || i % 3 === 0 || i === n - 1)
      ? '<text x="' + x(i).toFixed(1) + '" y="' + (h - 4) + '" text-anchor="middle">' + esc(L) + '</text>'
      : "").join("");
  const yTicks = [0, Math.ceil(maxY / 2), maxY].map(v =>
    '<text x="2" y="' + (y(v) + 3).toFixed(1) + '">' + v + '</text>').join("");
  return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none">' +
    '<polygon points="' + area + '" fill="var(--chip)" opacity="0.75"/>' +
    '<polyline points="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' +
    ticks + yTicks + '</svg>';
}
```

- [ ] **Step 2: Replace the `renderAttrition` stub and add its state setters**

```js
function renderAttrition(el) {
  const d = STATE.data, a = d.attrition, cur = a.currentFY, prev = a.previousFY;
  const isM = STATE.attrGran === "month";
  const labels = isM ? d.meta.monthLabels : ["Q1", "Q2", "Q3", "Q4"];
  const upto = isM ? d.meta.fiscalMonthIdx : Math.floor(d.meta.fiscalMonthIdx / 3);
  const dim = STATE.attrDim;
  const dimLabel = { department: "Department", level: "Level", keyLocation: "Key Location" };
  const slices = a.slices[dim] || [];
  el.innerHTML =
    sourceBanner("roster", "Roster data") +
    '<div class="card"><h2>' + esc(cur.label) + ' vs ' + esc(prev.label) + ' terminations</h2>' +
    '<div class="seg" style="margin-bottom:10px">' +
      '<button onclick="setAttrGran(\'month\')" class="' + (isM ? "on" : "") + '">Month</button>' +
      '<button onclick="setAttrGran(\'quarter\')" class="' + (!isM ? "on" : "") + '">Quarter</button></div>' +
    attritionChart(isM ? prev.monthly : prev.quarterly, isM ? cur.monthly : cur.quarterly, labels, upto, 720, 190) +
    '<div class="sub">Shadow area = ' + esc(prev.label) + ' · line = ' + esc(cur.label) + ' to date</div>' +
    '<div style="margin-top:10px">' +
      '<span class="chip">' + cur.total + ' terminations ' + esc(cur.label) + '</span>' +
      '<span class="chip green">' + cur.vol + ' voluntary</span>' +
      '<span class="chip yellow">' + cur.invol + ' involuntary</span>' +
      '<span class="chip red">' + (cur.total ? Math.round(cur.regretted / cur.total * 100) : 0) + '% regretted</span>' +
      '<span class="chip">rate ' + pctFmt(cur.rate) + ' (prev ' + pctFmt(prev.rate) + ')</span>' +
    '</div></div>' +
    '<div class="card"><h2>Breakdown</h2>' +
    '<select onchange="setAttrDim(this.value)">' +
      Object.keys(dimLabel).map(k =>
        '<option value="' + k + '"' + (k === dim ? " selected" : "") + '>By ' + dimLabel[k] + '</option>').join("") +
    '</select>' +
    '<table><tr><th>' + esc(dimLabel[dim]) + '</th><th>Headcount</th><th>Terms</th><th>Voluntary</th><th>Involuntary</th><th>Rate</th></tr>' +
    slices.map(s =>
      '<tr><td>' + esc(s.key) + '</td><td>' + s.headcount + '</td><td>' + s.terms + '</td><td>' + s.vol +
      '</td><td>' + s.invol + '</td><td>' + pctFmt(s.rate) + '</td></tr>').join("") + '</table>' +
    '<details><summary>Termination detail — ' + a.detail.length + ' rows (names inside)</summary>' +
    '<table><tr><th>Date</th><th>Name</th><th>Dept</th><th>Level</th><th>Location</th><th>Type</th><th>Regretted</th><th>Reason</th></tr>' +
    a.detail.map(t =>
      '<tr><td>' + esc(t.termDate) + '</td><td>' + esc(t.name) + '</td><td>' + esc(t.dept) + '</td><td>' + esc(t.level) +
      '</td><td>' + esc(t.keyLocation) + '</td><td>' + esc(t.cls) + '</td><td>' + (t.regretted ? "⚠️ yes" : "no") +
      '</td><td>' + esc(t.reason) + '</td></tr>').join("") + '</table></details></div>';
}
function setAttrGran(g) { STATE.attrGran = g; render(); }
function setAttrDim(k) { STATE.attrDim = k; render(); }
```

House rule honored: the chart/chip area carries counts only; individual names appear exclusively inside the expandable detail rows.

- [ ] **Step 3: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): attrition tab — FY shadow/trend chart, slices, detail rows"
```

---

### Task 13: Internal Position tab (peer-max groups, ratio bars, filters)

**Files:**
- Modify: `CompDash/ViewDash.html` (replace the `renderCompa` stub; add `setCompaFilter`)

- [ ] **Step 1: Replace the `renderCompa` stub**

```js
function renderCompa(el) {
  const d = STATE.data, f = STATE.compaFilters;
  const locs = [...new Set(d.compaGroups.map(g => g.keyLocation))].sort();
  const levels = [...new Set(d.employees.map(e => e.level))].sort();
  const depts = [...new Set(d.employees.map(e => e.dept))].filter(Boolean).sort();
  const empIndex = {};
  d.employees.forEach(e => { empIndex[e.empNo] = e; });

  const groups = d.compaGroups
    .filter(g => !f.loc || g.keyLocation === f.loc)
    .map(g => Object.assign({}, g, {
      members: g.members.filter(m => {
        const e = empIndex[m.empNo] || {};
        return (!f.level || m.level === f.level) && (!f.dept || e.dept === f.dept);
      }),
    }))
    .filter(g => g.members.length);

  const sel = (id, label, opts, val) =>
    '<label class="sub">' + label + ' </label>' +
    '<select onchange="setCompaFilter(\'' + id + '\', this.value)">' +
    '<option value="">All</option>' +
    opts.map(o => '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + '>' + esc(o) + '</option>').join("") +
    '</select> ';

  el.innerHTML =
    '<div class="banner">⚖️ <b>Internal Position (vs peer max)</b> — each Rocketeer&#39;s TCC ÷ the highest TCC among ACTIVE peers with the same Key Location + Job Title, in local currency. This is <b>not</b> a band-midpoint compa ratio: 1.00 means &quot;the local peer max&quot;, and nobody can sit above it.</div>' +
    '<div class="card">' + sel("loc", "Location", locs, f.loc) + sel("level", "Level", levels, f.level) + sel("dept", "Department", depts, f.dept) + '</div>' +
    groups.map(g =>
      '<div class="card"><h2>' + esc(g.keyLocation) + ' · ' + esc(g.jobTitle) +
      ' <span class="sub">(' + g.count + ' member' + (g.count === 1 ? "" : "s") + ')</span>' +
      (g.smallGroup ? ' <span class="chip yellow">small group</span>' : '') +
      (g.missingTcc ? ' <span class="chip">' + g.missingTcc + ' missing TCC</span>' : '') + '</h2>' +
      '<div class="sub" style="margin-bottom:8px">Anchor (peer max): ' +
        fmtMoney(g.maxTcc, null, g.currency) + '</div>' +
      '<table><tr><th>Name</th><th>Level</th><th>TCC</th><th style="min-width:170px">Position</th><th>Ratio</th></tr>' +
      g.members.map(m => {
        const cls = ratioClass(m.ratio);
        const barColor = cls === "green" ? "var(--accent)" : cls === "yellow" ? "var(--warn)" : "var(--bad)";
        return '<tr class="click" onclick="openDrill(\'' + esc(m.empNo) + '\')">' +
          '<td>' + esc(m.name) + '</td><td>' + esc(m.level) + '</td>' +
          '<td>' + fmtMoney(m.tcc, m.tccUsd, m.currency) + '</td>' +
          '<td><div class="bar"><i style="width:' + Math.round((m.ratio || 0) * 100) + '%;background:' + barColor + '"></i></div></td>' +
          '<td><span class="chip ' + cls + '">' + (m.ratio != null ? m.ratio.toFixed(2) : "—") + '</span>' +
          (m.noPeers ? '<span class="chip">no peers</span>' : '') + '</td></tr>';
      }).join("") + '</table></div>').join("");
  if (!groups.length) el.innerHTML += '<div class="card sub">No groups match the current filters.</div>';
}
function setCompaFilter(k, v) { STATE.compaFilters[k] = v; render(); }
```

- [ ] **Step 2: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): internal-position tab — grouped ratio bars, filters, flags"
```

---

### Task 14: Employee growth drill (waterfall + RRI)

**Files:**
- Modify: `CompDash/ViewDash.html` (replace the empty `openDrill`; add `waterfallSvg`)

One shared component, opened from Internal Position, Market Gap, Pay Equity, and QTA rows.

- [ ] **Step 1: Replace `openDrill` and add the waterfall helper**

```js
function openDrill(empNo) {
  const d = STATE.data;
  const emp = d.employees.find(e => e.empNo === empNo);
  const g = d.history[empNo];
  const box = document.getElementById("drill");
  if (!emp) {
    box.innerHTML = '<button onclick="closeDrill()" style="float:right">✕ Close</button><p class="sub">Employee not found in the active payload.</p>';
    box.classList.remove("hidden");
    return;
  }
  let body =
    '<button onclick="closeDrill()" style="float:right">✕ Close</button>' +
    '<h2>' + esc(emp.name) + '</h2>' +
    '<div class="sub">' + esc(emp.jobTitle) + ' · ' + esc(emp.keyLocation) + ' · ' + esc(emp.dept) + '</div>' +
    '<div style="margin:10px 0"><span class="chip">TCC ' + fmtMoney(emp.tcc, emp.tccUsd, emp.currency) + '</span>';
  if (g && g.overallAnnualized != null) {
    body += '<span class="chip green">overall growth ' + pctFmt(g.overallAnnualized) + '/yr (RRI)</span>';
  }
  body += '</div>';
  if (!g || !g.events.length) {
    body += '<div class="banner">No comp history found in the Compensation Report (RD) for this Rocketeer.</div>';
  } else {
    body +=
      '<h3>TCC growth waterfall (local Total Target Compensation)</h3>' +
      waterfallSvg(g.events, 500, 200) +
      '<h3>Comp events</h3>' +
      '<table><tr><th>Date</th><th>Event</th><th>TCC</th><th>Δ</th><th>Δ%</th><th>Annualized</th></tr>' +
      g.events.map(e =>
        '<tr><td>' + esc(e.date) + '</td><td>' + esc(e.reason) + '</td>' +
        '<td>' + (e.tcc != null ? Math.round(e.tcc).toLocaleString() : "—") + '</td>' +
        '<td>' + (e.deltaAbs != null ? (e.deltaAbs >= 0 ? "+" : "") + Math.round(e.deltaAbs).toLocaleString() : "—") + '</td>' +
        '<td>' + pctFmt(e.deltaPct) + '</td><td>' + pctFmt(e.annualized) + '</td></tr>').join("") +
      '</table>' +
      '<div class="sub" style="margin-top:6px">First event is the baseline (usually New Hire) — no growth math applies to it.</div>';
  }
  box.innerHTML = body;
  box.classList.remove("hidden");
}

// Waterfall: first bar is the grey baseline; each later bar spans prev TCC → new TCC
// (green up, red down). Y-axis starts at 90% of the minimum so deltas stay readable.
function waterfallSvg(events, w, h) {
  const evs = events.filter(e => e.tcc != null);
  if (!evs.length) return "";
  const minV = Math.min.apply(null, evs.map(e => e.tcc));
  const maxV = Math.max.apply(null, evs.map(e => e.tcc));
  const lo = minV * 0.9, span = Math.max(1, maxV - lo);
  const bw = Math.max(18, Math.min(64, (w - 30) / evs.length - 8));
  const y = v => 12 + (h - 40) * (1 - (v - lo) / span);
  let sx = 10;
  const parts = [];
  evs.forEach((e, i) => {
    const top = y(e.tcc);
    const base = y(i === 0 ? lo : evs[i - 1].tcc);
    const fill = i === 0 ? "var(--chip)" : (e.tcc >= evs[i - 1].tcc ? "var(--accent)" : "var(--bad)");
    parts.push('<rect x="' + sx + '" y="' + Math.min(top, base).toFixed(1) + '" width="' + bw +
      '" height="' + Math.max(2, Math.abs(base - top)).toFixed(1) + '" rx="3" fill="' + fill + '"/>');
    parts.push('<text x="' + (sx + bw / 2).toFixed(1) + '" y="' + (h - 6) +
      '" text-anchor="middle">' + esc(e.date.slice(0, 7)) + '</text>');
    sx += bw + 8;
  });
  return '<svg width="100%" height="' + h + '" viewBox="0 0 ' + Math.max(w, sx) + " " + h +
    '" preserveAspectRatio="xMinYMid meet">' + parts.join("") + '</svg>';
}
```

- [ ] **Step 2: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): shared employee drill — comp event waterfall + RRI chips"
```

---

### Task 15: Market Gap (placeholder w/ live layout) + Pay Equity tabs

**Files:**
- Modify: `CompDash/ViewDash.html` (replace `renderMarket` and `renderEquity`; add `marketRow` and `flagTable`)

- [ ] **Step 1: Replace the `renderMarket` stub and add `marketRow`**

```js
function renderMarket(el) {
  const d = STATE.data;
  const byLoc = new Map();
  d.employees.forEach(e => {
    const k = e.keyLocation || "—";
    if (!byLoc.has(k)) byLoc.set(k, []);
    byLoc.get(k).push(e);
  });
  let html =
    '<div class="banner">🌍 <b>Benchmark data pending</b> — the Payscale P25/P50/P75 columns light up automatically when the market source lands (fields <code>p25/p50/p75</code> on each employee). Meanwhile this view surfaces within-location TCC ordering to spot title discrepancies.</div>';
  [...byLoc.keys()].sort().forEach(loc => {
    const emps = byLoc.get(loc).slice().sort((a, b) => (b.tcc || 0) - (a.tcc || 0));
    html += '<div class="card"><h2>' + esc(loc) + ' <span class="sub">(' + emps.length + ' active)</span></h2>' +
      '<table><tr><th>Emp #</th><th>Name</th><th>Job Title</th><th>TCC</th><th>P25</th><th>P50</th><th>P75</th><th>vs market</th><th>Suggestion</th></tr>' +
      emps.map(e => {
        const s = marketRow(e);
        return '<tr class="click" onclick="openDrill(\'' + esc(e.empNo) + '\')">' +
          '<td>' + esc(e.empNo) + '</td><td>' + esc(e.name) + '</td><td>' + esc(e.jobTitle) + '</td>' +
          '<td>' + fmtMoney(e.tcc, e.tccUsd, e.currency) + '</td>' +
          '<td>' + (e.p25 != null ? Math.round(e.p25).toLocaleString() : "—") + '</td>' +
          '<td>' + (e.p50 != null ? Math.round(e.p50).toLocaleString() : "—") + '</td>' +
          '<td>' + (e.p75 != null ? Math.round(e.p75).toLocaleString() : "—") + '</td>' +
          '<td>' + s.badge + '</td><td>' + s.text + '</td></tr>';
      }).join("") + '</table></div>';
  });
  el.innerHTML = html;
}

// Client-side mirror of marketSuggestion_ (Code.js) — red = raise to P25 is the
// priority read, yellow = move to P50 for competitiveness, green = at market.
function marketRow(e) {
  if (e.p25 == null || e.p50 == null || e.tcc == null) {
    return { badge: '<span class="chip">pending</span>', text: "—" };
  }
  if (e.tcc < e.p25) {
    return { badge: '<span class="chip red">below P25</span>',
             text: "+" + pctFmt((e.p25 - e.tcc) / e.tcc, 0) + " to reach P25 · +" +
                   pctFmt((e.p50 - e.tcc) / e.tcc, 0) + " to P50" };
  }
  if (e.tcc < e.p50) {
    return { badge: '<span class="chip yellow">below P50</span>',
             text: "+" + pctFmt((e.p50 - e.tcc) / e.tcc, 0) + " to reach P50" };
  }
  return { badge: '<span class="chip green">at/above P50</span>', text: "market competitive" };
}
```

- [ ] **Step 2: Replace the `renderEquity` stub and add `flagTable`**

```js
function renderEquity(el) {
  const eq = STATE.data.equity;
  let html = "";
  if (!eq.genderAvailable) {
    html += '<div class="banner">🧭 <b>Gender data pending</b> — the Gender column hasn&#39;t landed in the roster yet; the gender lens activates automatically when it does.</div>';
  }
  html += '<div class="card"><h2>Gender pay gap by location + level</h2>';
  if (eq.gender.length) {
    html += '<table><tr><th>Location</th><th>Level</th><th>Group</th><th>Medians (local)</th><th>Gap</th><th></th></tr>' +
      eq.gender.map(g =>
        '<tr><td>' + esc(g.keyLocation) + '</td><td>' + esc(g.level) + '</td>' +
        '<td>' + Object.keys(g.counts).map(k => esc(k) + ": " + g.counts[k]).join(" · ") + '</td>' +
        '<td>' + Object.keys(g.medians).map(k => esc(k) + " " + Math.round(g.medians[k]).toLocaleString()).join(" · ") + '</td>' +
        '<td>' + g.gapPct + '%</td>' +
        '<td>' + (g.flagged ? '<span class="chip red">flagged</span>' : '<span class="chip green">ok</span>') + '</td></tr>'
      ).join("") + '</table>';
  } else {
    html += '<p class="sub">No location+level groups with ≥2 members per gender yet.</p>';
  }
  html += '</div>' +
    '<div class="card"><h2>Outliers far below group median <span class="chip red">' + eq.outliers.length + '</span></h2>' +
    flagTable(eq.outliers, false) + '</div>' +
    '<div class="card"><h2>Long tenure, low position <span class="chip yellow">' + eq.tenure.length + '</span></h2>' +
    flagTable(eq.tenure, true) + '</div>';
  el.innerHTML = html;
}

// Group stats above carry counts only; names live inside this expandable table.
function flagTable(rows, withTenure) {
  if (!rows.length) return '<p class="sub">No flags at current thresholds.</p>';
  return '<details><summary>' + rows.length + ' flag' + (rows.length === 1 ? "" : "s") + ' — names inside</summary>' +
    '<table><tr><th>Name</th><th>Location</th><th>Level</th>' + (withTenure ? '<th>Tenure</th>' : '') +
    '<th>TCC (local)</th><th>Group median</th><th>% below</th></tr>' +
    rows.map(r =>
      '<tr class="click" onclick="openDrill(\'' + esc(r.empNo) + '\')">' +
      '<td>' + esc(r.name) + '</td><td>' + esc(r.keyLocation) + '</td><td>' + esc(r.level) + '</td>' +
      (withTenure ? '<td>' + r.tenureYears + 'y</td>' : '') +
      '<td>' + Math.round(r.tcc).toLocaleString() + '</td>' +
      '<td>' + Math.round(r.groupMedian).toLocaleString() + '</td>' +
      '<td><span class="chip red">' + r.pctBelow + '%</span></td></tr>').join("") +
    '</table></details>';
}
```

- [ ] **Step 3: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): market-gap placeholder + pay-equity lenses"
```

---

### Task 16: QTA, Contribution, Data Reference, Access Control views

**Files:**
- Modify: `CompDash/ViewDash.html` (replace the four remaining stubs; add `renderAccessForm` and `saveAccess`)

- [ ] **Step 1: Replace the `renderQta` stub**

```js
function renderQta(el) {
  const d = STATE.data;
  const rows = d.qtaInterim;
  const overdue = rows.filter(r => r.daysOverdue != null && r.daysOverdue > 0).length;
  el.innerHTML =
    '<div class="banner">📋 <b>Official QTA-cycle source pending</b> — interim signal below uses each Rocketeer&#39;s latest <i>Next Review</i> date from the Compensation Report, waiting-longest first.</div>' +
    sourceBanner("history", "Compensation history") +
    '<div class="card"><h2>Review readiness <span class="chip red">' + overdue + ' overdue</span>' +
    '<span class="chip">' + rows.length + ' active Rocketeers</span></h2>' +
    '<table><tr><th>Name</th><th>Dept</th><th>Location</th><th>Level</th><th>Next Review</th><th>Status</th><th>Last comp event</th></tr>' +
    rows.map(r => {
      const st = r.daysOverdue == null ? '<span class="chip">no review date</span>'
        : r.daysOverdue > 0 ? '<span class="chip red">' + r.daysOverdue + 'd overdue</span>'
        : '<span class="chip green">in ' + (-r.daysOverdue) + 'd</span>';
      return '<tr class="click" onclick="openDrill(\'' + esc(r.empNo) + '\')">' +
        '<td>' + esc(r.name) + '</td><td>' + esc(r.dept) + '</td><td>' + esc(r.keyLocation) + '</td>' +
        '<td>' + esc(r.level) + '</td><td>' + esc(r.nextReview || "—") + '</td><td>' + st + '</td>' +
        '<td>' + esc(r.lastEventReason) + (r.lastEventDate ? " · " + esc(r.lastEventDate) : "") + '</td></tr>';
    }).join("") + '</table></div>';
}
```

- [ ] **Step 2: Replace the `renderContrib` stub**

```js
function renderContrib(el) {
  const url = STATE.data.meta.contribUrl;
  el.innerHTML =
    '<div class="card" style="max-width:560px;margin:40px auto;text-align:center">' +
    '<h2>🚀 Contribution data lives in the Contribution Report</h2>' +
    '<p class="sub">Comp decisions need contribution context — goals, tracked time, kudos, and recognition signals are already curated there. This report links out instead of duplicating that work.</p>' +
    (url
      ? '<p><a href="' + esc(url) + '" target="_blank"><button>Open the Contribution Report ↗</button></a></p>'
      : '<div class="banner">Link not configured — an admin should set the <b>CD_CONTRIB_URL</b> Script Property to the Contribution Report web-app URL.</div>') +
    '</div>';
}
```

- [ ] **Step 3: Replace the `renderReference` stub**

Threshold numbers in the text below must match `CONFIG_CD` (10 / 25 / 3y / 15) — update both together if tuned.

```js
function renderReference(el) {
  const m = STATE.data.meta;
  el.innerHTML =
    '<div class="card"><h2>📊 Data Reference</h2>' +
    '<h3>Sources</h3><table><tr><th>Module</th><th>Source</th><th>Status</th></tr>' +
    '<tr><td>Roster, attrition, TCC</td><td>Roster file — active + terminated rows; crew/contractors excluded everywhere in V1</td><td>' + esc(m.sources.roster) + '</td></tr>' +
    '<tr><td>USD conversion</td><td>&quot;TCC USD&quot; tab, joined by Employee Number</td><td>' + esc(m.sources.tccUsd) + '</td></tr>' +
    '<tr><td>Comp history + QTA interim</td><td>Compensation Report — &quot;RD&quot; tab, joined by Employee Number</td><td>' + esc(m.sources.history) + '</td></tr></table>' +
    '<h3>Formulas</h3><table>' +
    '<tr><td><b>Internal Position</b></td><td>TCC ÷ max TCC among ACTIVE peers in the same Key Location + Job Title, local currency. NOT band-midpoint compa — 1.00 = the local peer max. Bands: green ≥ 0.90, yellow 0.75–0.90, red &lt; 0.75. Groups under 3 members flagged &quot;small group&quot;; singletons &quot;no peers&quot;.</td></tr>' +
    '<tr><td><b>Attrition rate</b></td><td>FY terminations ÷ mean(headcount at FY start, headcount at FY end — or today for the running FY). Voluntary/involuntary from Termination Category. Fiscal year starts July 1.</td></tr>' +
    '<tr><td><b>Growth (RRI)</b></td><td>(current ÷ previous)^(1 ÷ years) − 1 between consecutive comp events from the RD tab. The first event (usually New Hire) is the baseline and gets no rate.</td></tr>' +
    '<tr><td><b>Pay Equity lenses</b></td><td>Within Key Location + level groups: gender median gap ≥ 10% flags the group (needs ≥2 members per gender); individuals ≥ 25% below group median flag as outliers; ≥ 3y tenure AND ≥ 15% below median flags the tenure lens.</td></tr>' +
    '<tr><td><b>QTA interim</b></td><td>Latest &quot;Next Review&quot; per Rocketeer from RD events, sorted overdue-first.</td></tr></table>' +
    '<h3>Currency</h3><p class="sub">Within-group math always runs in local currency. The Local | USD toggle changes display only; cross-location aggregates (Overview) use USD where available.</p>' +
    '<h3>Freshness</h3><p class="sub">Payload generated ' + esc(m.generatedAt) +
    (m.fromCache ? " — served from cache (⟳ Refresh forces a live read)." : " — live read.") +
    ' Cache TTL 65 minutes.</p></div>';
}
```

- [ ] **Step 4: Replace the `renderAccess` stub and add the save flow**

```js
function renderAccess(el) {
  el.innerHTML = '<div class="card"><h2>🔒 Access Control</h2><p class="sub">Loading…</p></div>';
  google.script.run
    .withSuccessHandler(s => renderAccessForm(el, s))
    .withFailureHandler(e => {
      el.innerHTML = '<div class="banner err">❌ ' + esc((e && e.message) || e) + '</div>';
    })
    .getAccessSettings();
}
function renderAccessForm(el, s) {
  el.innerHTML =
    '<div class="card"><h2>🔒 Access Control</h2>' +
    '<p class="sub">One email per line (commas also work). Bootstrap admin (' + esc(s.bootstrapAdmin) +
    ') is always active and not listed here. Every grant means <b>global</b> comp visibility — ' +
    'org-scoped manager access is a V2 feature; do not hand this out casually.</p>' +
    '<h3>Admins (manage this list + full dashboard)</h3>' +
    '<textarea id="accAdmins" rows="4" style="width:100%">' + esc(s.admins.join("\n")) + '</textarea>' +
    '<h3>Viewers (full dashboard, read-only settings)</h3>' +
    '<textarea id="accViewers" rows="6" style="width:100%">' + esc(s.viewers.join("\n")) + '</textarea>' +
    '<p><button onclick="saveAccess()">Save access lists</button> <span id="accMsg" class="sub"></span></p></div>';
}
function saveAccess() {
  const split = id => document.getElementById(id).value.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
  document.getElementById("accMsg").textContent = "saving…";
  google.script.run
    .withSuccessHandler(() => { document.getElementById("accMsg").textContent = "✅ saved — cache version bumped"; })
    .withFailureHandler(e => { document.getElementById("accMsg").textContent = "❌ " + ((e && e.message) || e); })
    .saveAccessSettings({ admins: split("accAdmins"), viewers: split("accViewers") });
}
```

- [ ] **Step 5: Parse check + commit**

Run: `node CompDash/tests/parse_html.js` → Expected: `✅ ViewDash.html script parses`
Run: `node CompDash/tests/run_tests.js` → Expected: `75 passed, 0 failed` (regression guard)

```bash
git add CompDash/ViewDash.html
git commit -m "feat(compdash): QTA, contribution link-out, data reference, access control views"
```

---

### Task 17: Reviews, deployment, and live QA gate

**Files:** none created — this is the ship gate.

- [ ] **Step 1: Run the review agents (house pre-deploy practice)**

Dispatch `gas-clean-code-reviewer` on `CompDash/Code.js`, `CompDash/Security.js`, `CompDash/ViewDash.html`, and `gas-security-auditor` on `CompDash/Security.js` + the `getCompReportData` access path. Fix findings, re-run `node CompDash/tests/run_tests.js` and `node CompDash/tests/parse_html.js`, commit fixes as `fix(compdash): …`.

- [ ] **Step 2: Create the GAS project (owner action — Moises)**

1. Create a new Google Sheet named `Comp Health Report (app host)` → Extensions → Apps Script.
2. Create files matching the local names: `Code.gs` ← paste `CompDash/Code.js`; `Security.gs` ← paste `CompDash/Security.js`; `ViewDash.html` ← paste as-is (File → New → HTML, name it exactly `ViewDash` — `doGet` loads it by that name).
3. Script Properties (Project Settings → Script properties) — set only what differs from `CONFIG_CD` fallbacks: `CD_CONTRIB_URL` = the PS Contribution Report web-app URL; optionally `CD_ROSTER_SS_ID`, `CD_COMP_HIST_SS_ID`, `CD_ROSTER_TAB`.

- [ ] **Step 3: Pipeline verification in the GAS editor (as owner)**

Run `debugCompPipeline()` and check the log:
- Roster rows load; if it throws `Tab "Data" not found`, list the spreadsheet's tabs and set `CD_ROSTER_TAB` to the actual roster tab name.
- Level parse rate should be high (>90%); eyeball the sample misses for unexpected title formats.
- TCC USD and RD join rates: investigate if either is far below the active count (join key is Employee Number — mismatches usually mean formatting, e.g. numbers vs strings; `asNum_`/`String().trim()` normalization should already absorb that).
- Then run `getCompReportData(true)` once; confirm the `✅ getCompReportData: built in …` log and note payload size.

- [ ] **Step 4: Deploy the web app**

Deploy → New deployment → Web app → Execute as **Me**, Who has access **Anyone within ServiceRocket** → copy URL.

- [ ] **Step 5: Live QA checklist**

- Owner loads the URL → dashboard renders; subtitle shows FY/quarter + active count; role shows `admin`.
- All 7 tabs render with real data; ☰ shows Data Reference + Access Control.
- Currency toggle flips TCC displays (USD "—" where the TCC USD join missed).
- Attrition: Month/Quarter toggle, breakdown dimension select, detail rows expand.
- Internal Position: filters narrow groups; clicking a row opens the drill; waterfall renders for someone with several RD events.
- QTA: overdue rows on top; Market Gap shows the pending banner; Pay Equity shows the gender-pending banner until the roster column lands.
- ⟳ Refresh forces a live rebuild (subtitle flips to "live").
- **Security:** from a non-allowlisted test account, the URL shows the denied page and nothing else. Add that account as viewer via Access Control → it sees the dashboard but ☰ has no Access Control; remove it → denied again (save busts the cache version). Bootstrap admin never appears in the editable admin list.
- Confirm data lag expectation: payload may be up to 65 min stale; Refresh always live.

- [ ] **Step 6: Close out**

Update the project memory (`project_comp_health_dashboard.md`) with deploy state and commit range. If QA surfaced no issues:

```bash
git add -A CompDash
git commit -m "chore(compdash): post-QA polish"   # only if fixes were needed
```

---

## Self-review notes (already applied)

- Spec coverage: every spec §2 decision maps to a task (attrition→3/12, compa→4/13, growth→5/14, equity→6/15, QTA→7/16, market placeholder→4/15, contribution link→16, security→8, cache→9, Data Reference→16, denied page→8, diagnostics→9/17).
- Deliberately out of plan (spec §11 defers them): manager scoping, Payscale data, official QTA source, band compa, crew inclusion, cache warmer, skeleton skill.
- Type consistency spot-checks: record shape (Task 3 header) matches `readRosterCD_` output (Task 9); `history[empNo]` = `buildGrowthForEmp_` return consumed by `openDrill` (Task 14); `meta.fiscalMonthIdx` produced in Task 9, consumed in Task 12; `bustCompCache_` defined in Task 9, called from Task 8 (same GAS project — fine at runtime, and the Node parse check on Security.js never calls it).
