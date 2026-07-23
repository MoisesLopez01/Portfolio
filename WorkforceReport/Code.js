// ============================================================
// SCRIPT NAME: Workforce & Compensation Report — Code
// PURPOSE:     Standalone GAS web app rendering the Workforce &
//              Compensation Report across FY25/FY26/FY27 in two views:
//              View A — per-scope Location report (FAR/N evidence layer)
//              View B — company Board brief (synthesis layer, AI-assisted)
// VERSION:     1.1.3 — per-year FY story/comparison, snapshot anchoring,
//              within-location comparison rule (exec review 2026-07-23);
//              body ASSUMPTION lines removed, build badge in the header,
//              "investigation trigger" wording out of section 4
// ENVIRONMENT: Google Apps Script
// SPEC:        docs/superpowers/specs/2026-07-22-workforce-comp-report-design.md
//
// Layout: PURE LOGIC first (no GAS APIs — Node-testable via tests/),
//         GAS LAYER second (SpreadsheetApp/CacheService/HtmlService).
//
// Data-integrity contract: every FACT sentence is TEMPLATED from computed
// numbers — the AI narrative (View B only) receives aggregates and can never
// alter a figure. Ratings reader deliberately omitted: no V1 section consumes
// performance ratings (spec §3 lists it as optional).
// ============================================================

const CONFIG_WR = {
  // Deployed-build marker — echoed as meta.build and shown in the page
  // header, so "did the new version actually deploy?" is answered by
  // looking at the subtitle instead of hunting for changed sentences.
  // Bump alongside the VERSION line above on every deployable change.
  BUILD: "1.1.3",

  // Fallback source IDs — overridable via Script Properties (WR_ prefix).
  // Defaults are the CompDash sources: the sheets are the shared contract.
  ROSTER_SS_ID:    "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0", // roster + attrition + TCC USD
  COMP_HIST_SS_ID: "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU", // Compensation Report (RD tab)
  BENCH_SS_ID:     "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0", // market benchmark compilation
  ROSTER_TAB: "Data",        // override via WR_ROSTER_TAB
  HIST_TAB:   "RD",          // override via WR_HIST_TAB
  BENCH_TAB:  "Compilation", // override via WR_BENCH_TAB
  TCC_USD_COL: "TCC USD",    // column INSIDE the roster tab; position shifts, resolved by header

  CACHE_TTL_SEC: 65 * 60,
  CACHE_KEY_PREFIX: "wr_",

  FY_COUNT: 3, // FYs rendered: current FY and the two before it (FY25/26/27 at build time)

  // Lever classification (RD "TCC Change Reason") — the reason domain is a
  // KNOWN CLOSED SET (confirmed 2026-07-22): New Hire, Annual Adjustment,
  // Microband Adjustment, Promotion, Market Calibration, Internal Transfer,
  // Microband Promotion, Historical Data Update.
  //   promotions  = Promotion + Microband Promotion (well-defined match)
  //   new hires   = their own growth event (baseline record, no delta)
  //   adjustments = everything else (Annual/Microband Adjustment, Market
  //                 Calibration — catch-all so a future flavor never drops)
  //   excluded    = Internal Transfer, Historical Data Update, blank reasons
  PROMO_RE:   /promotion|microband promotion/i,
  NEWHIRE_RE: /new hire/i,
  EXCLUDE_RE: /internal transfer|historical data update/i,

  // Attrition RISK thresholds — spec §6.5 (config-tunable).
  RISK_REGRET_PCT:    60,  // regretted share of exits ≥ this % → RISK line
  RISK_REASON_SHARE: 0.5,  // single recorded reason ≥ this share of exits → RISK line

  // FY-over-FY verdict thresholds (section 2 comparison read) — moves smaller
  // than these percentage points read as "held steady", never as a verdict.
  COMPARE_ATTR_PP:   1.0,  // attrition-rate move ≥ this many pp → improved / attention
  COMPARE_REGRET_PP: 5.0,  // regretted-share move ≥ this many pp → improved / attention

  // The CURRENT exit-reason taxonomy (business-context doc 2026-07-23).
  // Leaver reasons outside this list (after REASON_REMAP) are flagged as
  // legacy in a NOTE — candidates for consolidation, never silently ignored.
  VALID_EXIT_REASONS: [
    "Another Job", "Voluntary Other", "Personal Reasons",
    "Dissatisfaction with Compensation", "Working Conditions",
    "Unsatisfactory Performance", "Job Position Eliminated or Changed",
  ],
  // Structural (company-initiated redundancy) vs organic exits — feeds the
  // per-FY organic/structural split and the regretted-overlap transparency.
  STRUCTURAL_REASON_RE: /job position eliminated/i,

  // Structural-risk detectors — spec §7.7 (computed candidates only).
  SENIOR_IC_MIN:      4,   // IC levels at/above this compare against manager bands
  FUNC_CONC_PCT:     40,   // top department share of headcount ≥ this % → candidate
  TENURE_CONC_PCT:   40,   // single tenure bucket ≥ this % of actives → candidate
  MIDLEVEL_RE:  /^I[34]$/, // "mid-level flight" levels
  MIDLEVEL_FLIGHT_PCT: 40, // exit share at mid levels ≥ this % → candidate
  MIDLEVEL_MIN_EXITS:   4, // shares are noise below this many exits

  // TEMPORARY GATE (2026-07-23): the external benchmark compilation is
  // incomplete, so this version evaluates INTERNAL salary mid-points only —
  // no market data anywhere in the report. Flip to true in a future version
  // to reactivate the market-calibration / compa-ratio competitiveness view
  // (benchmark reader, market anchor tier, market-gap flags, coverage notes).
  MARKET_ENABLED: false,

  // Copied from CONFIG_CD at fork time (spec §6.7) — independently tunable after.
  COMPA_LOW_MIN:    0.80,
  COMPA_TARGET_MIN: 0.95,
  COMPA_HIGH_MAX:   1.10,
  MARKET_LOW:       0.90, // used only while MARKET_ENABLED

  EQUITY_GAP_PCT:     10,
  EQUITY_OUTLIER_PCT: 25,
  TENURE_YEARS_MIN:    3,
  TENURE_BELOW_PCT:   15,
  SMALL_GROUP_MIN:     3,

  CREW_RE: /crew member|contractor/i, // same crew rule as PS / CompDash
  INACTIVE_RE: /terminat|job offer|resign|left|inactive|former|offboard/i,

  // Job family from the Job Title numeric prefix: "04.I3.1" → JF004,
  // "18.M4.3" → JF018 (identity rule, prefix zero-padded to 3 digits —
  // confirmed 2026-07-23). Catalog exceptions go here as prefix → family
  // overrides ({ "NN": "JFxxx" }) — one config entry, no parser change.
  JOB_FAMILY_MAP: {},

  // Employee Type (roster column, restored 2026-07-22): Intern is excluded
  // from the HEADLINE population; Regular Employee, Employer of Record and
  // Part Time are all regular employees. A 30% blended attrition in front of
  // the board when the regular-staff figure is ~21% misdirects the
  // conversation — interns flow in their own strand.
  INTERN_RE: /intern/i,

  // Ghost-department remap — APPLIED BY DEFAULT at roster read, so every
  // scope computes on the same consolidated departments and remapped leavers
  // also count in the target department's HISTORICAL headcount (denominators
  // stay apples-to-apples). Business context doc 2026-07-23: ServiceRocket
  // moved from the color-coded multi-BU model (Blue = Professional Services,
  // Green = Apps, Teal = Managed Services — retired per Lingo List / COE OCD)
  // to 8 active departments (Services 158, Sales 19, Marketing 11, People 11,
  // Finance 7, IT 5, Management 2, Legal 1). All 20 historical departments
  // map below. Extend WITHOUT a code deploy via the WR_DEPT_REMAP Script
  // Property (JSON, merged over this map, property wins).
  DEPT_REMAP: {
    // → Services (Blue/Green/Teal delivery functions consolidated)
    "Managed Services":        "Services", // Teal BU retired; MS terminology deprecated (COE OCD)
    "Professional Services":   "Services",
    "Engineering":             "Services", // Green BU engineering folded into delivery
    "Product":                 "Services", // Green BU product team dissolved
    "PM - Customer Experience": "Services",
    "PM - Customer Success":   "Services",
    "PM - Product":            "Services",
    "Project Management":      "Services", // Blue/PS project management
    "R&D":                     "Services", // R&D capacity embedded in technical delivery
    "Support (Learndot & Apps)": "Services", // Green BU app + Learndot support
    // → Sales (revenue functions incl. Navy License Renewals absorption)
    "Customer Success/Renewals": "Sales",
    "Marketing - SDR":         "Sales", // SDR pipeline ownership moved to Sales
    "Sales - Accounts":        "Sales",
    "Sales - Licensing":       "Sales", // Navy sub-unit
    "Sales - SDR":             "Sales",
    // → Marketing
    "MKT Development, Brand & Story": "Marketing",
    "Marketing Team":          "Marketing", // generic predecessor label
    // → People
    "Rewards & Workforce Planning": "People",
    "Rocketeer Experience":    "People",
    "Talent Acquisition":      "People",
    // → Finance
    "Administration":          "Finance", // procurement / office ops consolidated
  },

  // Exit-reason consolidation to CURRENT classification standards — applied
  // at roster read, same mechanics as DEPT_REMAP (WR_REASON_REMAP Script
  // Property merges over this map). Valid current reasons stay untouched:
  // Another Job, Voluntary Other, Personal Reasons, Dissatisfaction with
  // Compensation, Working Conditions, Unsatisfactory Performance, Job
  // Position Eliminated or Changed.
  REASON_REMAP: {
    // Functionally a forced exit due to role removal, not voluntary retirement.
    "Involuntary Retirement": "Job Position Eliminated or Changed",
    // Relocation detail is a sub-reason of taking another job, not a category.
    "Relocation to a New Employer": "Another Job",
    // Decision 2026-07-23: consolidate under the behavioral-exit bucket
    // rather than a distinct Policy Violation category.
    "Attendance": "Unsatisfactory Performance",
  },

  DEBUG: false,
};

// ============================================================
// PURE LOGIC — no GAS APIs below this line until the GAS LAYER marker
// ============================================================

function normWR_(name) {
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

/**
 * Job family from the Job Title numeric prefix ("04.I3.1" → JF004,
 * "18.M4.3" → JF018). CONFIG_WR.JOB_FAMILY_MAP overrides individual prefixes.
 * @returns {string} "JFnnn", or "" when the title carries no numeric prefix.
 */
function parseJobFamily_(jobTitle, cfg) {
  const m = String(jobTitle || "").match(/^\s*(\d{1,3})\./);
  if (!m) return "";
  const map = (cfg || CONFIG_WR).JOB_FAMILY_MAP || {};
  return map[m[1]] || "JF" + m[1].padStart(3, "0");
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

function median_(nums) {
  const a = nums.filter(n => typeof n === "number" && isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const YEAR_MS_ = 365.25 * 86400000;

function tenureYears_(hireDate, asOf) {
  if (!(hireDate instanceof Date) || isNaN(hireDate)) return null;
  return (asOf - hireDate) / YEAR_MS_;
}

// ── Formatting (templated FACT sentences interpolate through these only) ────

function fmtInt_(n) {
  return (typeof n === "number" && isFinite(n)) ? Math.round(n).toLocaleString("en-US") : "—";
}

/** Fraction → "12.3%". dp defaults to 1. */
function fmtPct_(x, dp) {
  return (typeof x === "number" && isFinite(x))
    ? (x * 100).toFixed(dp == null ? 1 : dp) + "%" : "—";
}

function fmtMoney_(n, code) {
  if (!(typeof n === "number" && isFinite(n))) return "—";
  return Math.round(n).toLocaleString("en-US") + (code ? " " + code : "");
}

/**
 * Executive short number: 1000000 → "1M", 1250000 → "1.25M", 4320 → "4.32K".
 * Managers and the CEO read magnitudes, not digit strings.
 */
function fmtShort_(n) {
  if (!(typeof n === "number" && isFinite(n))) return "—";
  const trim = v => v.toFixed(2).replace(/\.?0+$/, "");
  const abs = Math.abs(n);
  if (abs >= 1e6) return trim(n / 1e6) + "M";
  if (abs >= 1e3) return trim(n / 1e3) + "K";
  return String(Math.round(n));
}

function fmtMoneyShort_(n, code) {
  const s = fmtShort_(n);
  return s === "—" ? s : s + (code ? " " + code : "");
}

// FAR/N line constructors — every View A sentence carries one of these badges.
function fact_(t)   { return { badge: "FACT",       text: t }; }
function assume_(t) { return { badge: "ASSUMPTION", text: t }; }
function risk_(t)   { return { badge: "RISK",       text: t }; }
function note_(t)   { return { badge: "NOTE",       text: t }; }

/** The automatic in-progress-FY NOTE every section with open-FY figures renders. */
function noteInProgress_(fys, asOfIso) {
  const open = fys.find(f => f.inProgress);
  return open
    ? note_(open.label + " in progress — data as of " + asOfIso + ".")
    : null;
}

// ── Fiscal calendar (FY starts July 1; FY27 = Jul 2026 – Jun 2027) ─────────
// Same derivation rules as fiscalContextCD_ / computeFiscalContext_.

function fiscalContextWR_(refDate) {
  const today = (refDate instanceof Date && !isNaN(refDate)) ? refDate : new Date();
  const m = today.getMonth() + 1;
  const yr = today.getFullYear();
  const fyStartCalYear = (m >= 7) ? yr : yr - 1;
  const fyNum = fyStartCalYear + 1;
  return {
    asOf: today,
    fyNum,
    fyLabel: "FY" + String(fyNum).slice(-2),
    fyStartCalYear,
  };
}

/**
 * The FY windows this report renders, OLDEST FIRST — [FY25, FY26, FY27] at
 * build time, self-advancing at every FY rollover (no annual maintenance).
 * @returns {Array<{label, startCalYear, start: Date, end: Date, inProgress: boolean}>}
 */
function fyListWR_(refDate, count) {
  const ctx = fiscalContextWR_(refDate);
  const n = count || CONFIG_WR.FY_COUNT;
  const out = [];
  for (let back = n - 1; back >= 0; back--) {
    const startCalYear = ctx.fyStartCalYear - back;
    out.push({
      label: "FY" + String(startCalYear + 1).slice(-2),
      startCalYear,
      start: new Date(startCalYear, 6, 1),
      end: new Date(startCalYear + 1, 5, 30),
      inProgress: back === 0,
    });
  }
  return out;
}

/**
 * One fiscal quarter's window inside an FY (Q1 = Jul–Sep … Q4 = Apr–Jun).
 * `started` gates the "if any" rule: a quarter of the in-progress FY that
 * hasn't begun yet is dropped from quarterly views rather than rendering zeros.
 * @returns {{label, startCalYear, start: Date, end: Date, inProgress, started}}
 */
function fyQuarterWindow_(fy, q, asOf) {
  const sm = 6 + (q - 1) * 3; // month offset from January; Jul = 6
  const start = new Date(fy.startCalYear, sm, 1);
  const end = new Date(fy.startCalYear, sm + 3, 0); // day 0 = last day of prior month
  return {
    label: fy.label + " Q" + q,
    startCalYear: fy.startCalYear,
    start, end,
    inProgress: !!(fy.inProgress && asOf && asOf >= start && asOf <= end),
    started: !asOf || start <= asOf,
  };
}

function classifyTerm_(cat) {
  const c = String(cat || "").toLowerCase();
  if (/invol/.test(c)) return "invol";
  if (/vol/.test(c)) return "vol";
  return "other";
}

// ── Currency resolution — spec §5 ───────────────────────────────────────────
// Country scope: local currency when the Key Location is single-currency;
// multi-currency locations fall back to TCC USD with a NOTE naming what was
// found. Company scope: always TCC USD.

function currencyModeForScope_(records, scope) {
  if (scope === "company") {
    return { mode: "usd", code: "USD", currencies: [] };
  }
  const currencies = [...new Set(
    records.filter(r => r.active && r.currency).map(r => r.currency))].sort();
  if (currencies.length === 1) {
    return { mode: "local", code: currencies[0], currencies };
  }
  return { mode: "usd", code: "USD", currencies };
}

/** The comp value for a record under the resolved currency mode. */
function tccOf_(r, mode) {
  return mode === "usd" ? r.tccUsd : r.tcc;
}

// ── Headcount / movement / attrition engines — spec §6.4–6.5 ───────────────

// Two headcount instants, chosen so `opening + hires − exits = closing` is an
// IDENTITY for every roster row (the CFO's "why doesn't this add up?" can
// never happen from measurement):
//   opening = START of day: hired strictly before it, not yet terminated
//   closing = END of day:  hired on/before it, terminated after it
// closing(Jun 30) ≡ opening(Jul 1), so the FY chain stays continuous too.
// Null hireDate = employment start unknown → treated as already hired.

function headcountOpenOn_(records, date) {
  return records.filter(r =>
    (!r.hireDate || r.hireDate < date) && (!r.termDate || r.termDate >= date)).length;
}

function headcountCloseOn_(records, date) {
  return records.filter(r =>
    (!r.hireDate || r.hireDate <= date) && (!r.termDate || r.termDate > date)).length;
}

/**
 * The roster as it stood at `date` (closing instant): rows hired by then,
 * with the active flag re-derived from the termination date. Compensation
 * values stay each person's LATEST recorded TCC — historical salaries are
 * not reconstructed; the scope section discloses this whenever it applies.
 * Movement/attrition engines are date-driven, so feeding them this view for
 * windows ending at or before `date` changes nothing — only the snapshot
 * sections (scope, composition, comp structure, flags, brief) re-anchor.
 */
function rosterAsAt_(records, date) {
  return records
    .filter(r => !r.hireDate || r.hireDate <= date)
    .map(r => Object.assign({}, r, { active: !r.termDate || r.termDate > date }));
}

/**
 * One FY's movement block. Rate = exits ÷ mean(opening, closing headcount);
 * the in-progress FY closes at asOf, and its hire/exit counts stop there too
 * (a future-dated hire is not yet a "to date" hire).
 * reclass = closing − opening − hires + exits: 0 by identity for single-stint
 * rows; a non-zero value is genuine reclassification/data residue (e.g. an
 * intern-to-regular conversion recorded as two roster rows) and is surfaced
 * in the reconciliation NOTE, never silently absorbed.
 */
function fyMovement_(records, fy, asOf) {
  const evEnd = (fy.inProgress && asOf && asOf < fy.end) ? asOf : fy.end;
  const hires = records.filter(r =>
    r.hireDate && r.hireDate >= fy.start && r.hireDate <= evEnd).length;
  const exits = records.filter(r =>
    r.termDate && r.termDate >= fy.start && r.termDate <= evEnd).length;
  const hcStart = headcountOpenOn_(records, fy.start);
  const hcEnd = headcountCloseOn_(records, evEnd);
  const avg = (hcStart + hcEnd) / 2;
  return {
    label: fy.label, inProgress: fy.inProgress,
    hires, exits, net: hires - exits,
    hcStart, hcEnd,
    reclass: hcEnd - hcStart - hires + exits,
    rate: avg > 0 ? exits / avg : null,
  };
}

/**
 * Annualized TCC lens on one window's movement (PEOPLE-39417: headcount
 * impact by count AND financial TCC impact): what the window's hires ADD to
 * run-rate compensation cost and what its exits REMOVE. Values are each
 * person's latest recorded roster TCC (a hire's current, a leaver's last) —
 * a cost-structure lens, never payroll actuals. Valued coverage is carried
 * so the reader sees how much of the movement is priced.
 */
function movementTccImpact_(records, w, asOf, mode) {
  const evEnd = (w.inProgress && asOf && asOf < w.end) ? asOf : w.end;
  const sum = list => {
    let total = 0, valued = 0;
    list.forEach(r => {
      const v = tccOf_(r, mode);
      if (v > 0) { total += v; valued++; }
    });
    return { total, valued, count: list.length };
  };
  const hires = sum(records.filter(r =>
    r.hireDate && r.hireDate >= w.start && r.hireDate <= evEnd));
  const exits = sum(records.filter(r =>
    r.termDate && r.termDate >= w.start && r.termDate <= evEnd));
  return {
    label: w.label, inProgress: !!w.inProgress,
    hiresTotal: hires.total, hiresValued: hires.valued, hiresCount: hires.count,
    exitsTotal: exits.total, exitsValued: exits.valued, exitsCount: exits.count,
    net: hires.total - exits.total,
    anyValued: hires.valued + exits.valued > 0,
  };
}

/** One FY's attrition detail — regretted, reasons, leaver slices, leaver tenure. */
function fyAttritionStats_(records, fy, asOf, cfg) {
  const c = cfg || CONFIG_WR;
  const leavers = records.filter(r =>
    r.termDate && r.termDate >= fy.start && r.termDate <= fy.end);
  const structural = leavers.filter(r => c.STRUCTURAL_REASON_RE.test(String(r.termReason || "")));
  const hist = (keyFn) => {
    const m = new Map();
    leavers.forEach(r => {
      const k = keyFn(r) || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return [...m.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  };
  const regretted = leavers.filter(r => /yes|true/i.test(String(r.termRegretted || ""))).length;
  const vol = leavers.filter(r => classifyTerm_(r.termCategory) === "vol").length;
  const invol = leavers.filter(r => classifyTerm_(r.termCategory) === "invol").length;
  const tenures = leavers
    .map(r => tenureYears_(r.hireDate, r.termDate))
    .filter(t => t != null && t >= 0);
  // Joint dept × reason combos feed the single leaver table. Level detail is
  // deliberately absent — the board reads the IC (I-levels) vs Manager
  // (M-levels) split, carried as icExits/mExits below.
  const comboMap = new Map();
  leavers.forEach(r => {
    const k = [(r.dept || "—"), (r.termReason || "—")].join("||");
    comboMap.set(k, (comboMap.get(k) || 0) + 1);
  });
  return {
    label: fy.label, inProgress: fy.inProgress,
    exits: leavers.length, vol, invol,
    regretted,
    regrettedPct: leavers.length ? regretted / leavers.length : null,
    reasons: hist(r => r.termReason),
    depts: hist(r => r.dept),
    levels: hist(r => r.level).sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
    families: hist(r => r.jobFamily),
    icExits: leavers.filter(r => r.track === "IC").length,
    mExits: leavers.filter(r => r.track === "M").length,
    structuralExits: structural.length,
    organicExits: leavers.length - structural.length,
    structuralRegretted: structural.filter(r =>
      /yes|true/i.test(String(r.termRegretted || ""))).length,
    combos: [...comboMap.entries()].map(([k, count]) => {
      const p = k.split("||");
      return { dept: p[0], reason: p[1], count };
    }),
    avgLeaverTenureYears: tenures.length
      ? Math.round(tenures.reduce((t, x) => t + x, 0) / tenures.length * 10) / 10 : null,
  };
}

// ── Compensation growth by lever — spec §6.6 ────────────────────────────────
// Only source is RD comp history. Promotions vs adjustments per FY; each
// event's delta compares against the employee's PRIOR valued comp record.
// Events lacking a prior record are excluded from deltas (counted, noted).

function classifyLever_(reason, cfg) {
  const c = cfg || CONFIG_WR;
  const s = String(reason || "").trim();
  if (!s || c.EXCLUDE_RE.test(s)) return "other"; // blank = unclassifiable, never a lever
  if (c.NEWHIRE_RE.test(s)) return "newhire";     // separate growth event, no delta
  if (c.PROMO_RE.test(s)) return "promo";
  return "adjust"; // catch-all — any other recorded reason is an adjustment
}

/**
 * Lever blocks for one FY over the scope's employees.
 * Amount totals carry native meaning when every event shares one currency
 * (mode "local"). In "usd" mode the RD history is LOCAL TCC with no
 * historical FX, so each event's delta converts at the employee's CURRENT
 * roster rate (TCC USD ÷ local TCC, `usdRates`) — an approximation the
 * section discloses — and growth uses the mean of per-event % deltas
 * (unit-free) instead of sum(delta)/sum(prev).
 * @param {string[]} scopeEmpNos - Employee Numbers in scope
 * @param {Object} histByEmp - Employee Number → RD events
 * @param {Object} [usdRates] - Employee Number → tccUsd/tcc (usd mode only)
 */
function buildLeversForFy_(scopeEmpNos, histByEmp, fy, mode, cfg, usdRates) {
  const mk = () => ({ count: 0, totalRaise: 0, sumPrev: 0, pctDeltas: [], noPrior: 0,
    usdRaise: 0, usdConv: 0 });
  const acc = { promo: mk(), adjust: mk() };
  let excluded = 0, newHires = 0;
  scopeEmpNos.forEach(emp => {
    const evs = (histByEmp[emp] || [])
      .filter(e => e && e.date instanceof Date && !isNaN(e.date))
      .sort((a, b) => a.date - b.date);
    evs.forEach((e, i) => {
      if (e.date < fy.start || e.date > fy.end) return;
      const cls = classifyLever_(e.reason, cfg);
      if (cls === "other") { excluded++; return; }
      if (cls === "newhire") { newHires++; return; } // baseline record — counted, no delta
      const a = acc[cls];
      a.count++;
      // Prior valued record = latest event strictly before this one with TCC.
      let prev = null;
      for (let j = i - 1; j >= 0; j--) {
        if (evs[j].tcc != null && evs[j].tcc > 0) { prev = evs[j]; break; }
      }
      if (!prev || !(e.tcc != null && e.tcc > 0)) { a.noPrior++; return; }
      a.totalRaise += e.tcc - prev.tcc;
      a.sumPrev += prev.tcc;
      a.pctDeltas.push((e.tcc - prev.tcc) / prev.tcc);
      const rate = usdRates ? usdRates[emp] : null;
      if (rate > 0) { a.usdRaise += (e.tcc - prev.tcc) * rate; a.usdConv++; }
    });
  });
  const finish = a => ({
    count: a.count,
    noPrior: a.noPrior,
    totalRaise: mode === "local"
      ? (a.count > a.noPrior ? a.totalRaise : null)
      : (a.usdConv > 0 ? a.usdRaise : null),
    growthPct: mode === "local"
      ? (a.sumPrev > 0 ? a.totalRaise / a.sumPrev : null)
      : (a.pctDeltas.length
          ? a.pctDeltas.reduce((t, x) => t + x, 0) / a.pctDeltas.length : null),
  });
  return {
    label: fy.label, inProgress: fy.inProgress, mode,
    promo: finish(acc.promo), adjust: finish(acc.adjust),
    newHires, excluded,
  };
}

/**
 * FY-over-FY recognition read — the two-year comparison story (user
 * directive 2026-07-23). Fewer promotions with more adjustments is a change
 * of recognition LEVER (salary calibration instead of title moves), NOT a
 * recognition gap — people were still considered, through a different lever.
 * The genuine RISK is a CONTRACTION: total recognition events falling
 * alongside fewer promotions. Pairs touching an in-progress FY are skipped —
 * a partial year always compares low.
 * @returns {Array<{from, to, totalFrom, totalTo, mixShift, contraction}>}
 */
function compareLeverPairs_(leverBlocks) {
  const out = [];
  for (let i = 1; i < leverBlocks.length; i++) {
    const a = leverBlocks[i - 1], b = leverBlocks[i];
    if (a.inProgress || b.inProgress) continue;
    const totalFrom = a.promo.count + a.adjust.count;
    const totalTo = b.promo.count + b.adjust.count;
    out.push({
      from: a, to: b, totalFrom, totalTo,
      mixShift: b.promo.count < a.promo.count &&
                b.adjust.count > a.adjust.count && totalTo >= totalFrom,
      contraction: totalTo < totalFrom && b.promo.count < a.promo.count,
    });
  }
  return out;
}

// ── Composition — spec §6.2 ─────────────────────────────────────────────────

function tenureBucket_(years) {
  if (years == null) return "unknown";
  if (years < 1) return "<1y";
  if (years < 3) return "1–3y";
  if (years < 5) return "3–5y";
  return "≥5y";
}

const TENURE_BUCKETS_ = ["<1y", "1–3y", "3–5y", "≥5y", "unknown"];

function buildComposition_(active, asOf) {
  const deptMap = new Map(), familyMap = new Map();
  active.forEach(r => {
    const k = r.dept || "—";
    deptMap.set(k, (deptMap.get(k) || 0) + 1);
    if (r.jobFamily) familyMap.set(r.jobFamily, (familyMap.get(r.jobFamily) || 0) + 1);
  });
  const levelMap = new Map();
  active.forEach(r => {
    levelMap.set(r.level, (levelMap.get(r.level) || 0) + 1);
  });
  const buckets = {};
  TENURE_BUCKETS_.forEach(b => { buckets[b] = 0; });
  const tenures = [];
  active.forEach(r => {
    const t = tenureYears_(r.hireDate, asOf);
    buckets[tenureBucket_(t)]++;
    if (t != null) tenures.push(t);
  });
  return {
    total: active.length,
    depts: [...deptMap.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    families: [...familyMap.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    icCount: active.filter(r => r.track === "IC").length,
    mCount: active.filter(r => r.track === "M").length,
    unparsedCount: active.filter(r => !r.track).length,
    levels: [...levelMap.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
    tenureBuckets: TENURE_BUCKETS_
      .map(b => ({ key: b, count: buckets[b] }))
      .filter(x => x.key !== "unknown" || x.count > 0),
    avgTenureYears: tenures.length
      ? Math.round(tenures.reduce((t, x) => t + x, 0) / tenures.length * 10) / 10 : null,
  };
}

// ── Compensation structure — spec §6.3 ──────────────────────────────────────
// Level bands with fewer than SMALL_GROUP_MIN members keep their headcount but
// withhold the average — an N-of-1 "average" is an individual's comp.

function buildCompStructure_(active, mode, cfg) {
  const byLevel = new Map();
  let envelope = 0, valued = 0, missingComp = 0;
  active.forEach(r => {
    const v = tccOf_(r, mode);
    if (!(v > 0)) { missingComp++; return; }
    envelope += v;
    valued++;
    if (!byLevel.has(r.level)) byLevel.set(r.level, []);
    byLevel.get(r.level).push(v);
  });
  // Averages render for EVERY band, including 1–2 person levels (user
  // directive 2026-07-23) — small bands are still excluded from inversion
  // comparisons so one salary can never fire a band-level structural flag.
  const bands = [...byLevel.entries()].map(([level, vals]) => ({
    level,
    count: vals.length,
    avg: vals.length
      ? Math.round(vals.reduce((t, x) => t + x, 0) / vals.length) : null,
  })).sort((a, b) => levelRank_(a.level) - levelRank_(b.level));
  return {
    envelope: valued ? envelope : null,
    perHead: valued ? Math.round(envelope / valued) : null,
    valued, missingComp,
    bands,
    // COMPARISON RULE (exec review 2026-07-23): band-vs-band judgments must be
    // within one location — a blended multi-currency USD band average is a
    // geography-weighted MIX (Simpson's paradox: it moves with WHERE people
    // sit, not what they're paid), so it never fires an equity flag. Raw USD
    // stays a cost/budget lens only. Single-currency scopes keep the direct
    // comparison — that is what made the Chile report sound.
    inversions: mode === "usd"
      ? detectInversionsByLocation_(active, cfg)
      : qualifyInversions_(active, detectInversions_(bands, cfg), mode),
  };
}

/**
 * Within-location inversion detection for multi-currency scopes: each Key
 * Location is a single-currency cohort compared on LOCAL TCC, small-group
 * floor applied per location, then family-qualified inside that same
 * location. Mixed-currency locations are skipped — never silently blended.
 * @returns {Array} inversion flags carrying {location, currency}
 */
function detectInversionsByLocation_(active, cfg) {
  const locs = [...new Set(active.map(r => r.keyLocation).filter(Boolean))].sort();
  const out = [];
  locs.forEach(loc => {
    const grp = active.filter(r => r.keyLocation === loc);
    const curs = [...new Set(grp.map(r => r.currency).filter(Boolean))];
    if (curs.length > 1) return;
    const byLevel = new Map();
    grp.forEach(r => {
      if (!(r.tcc > 0)) return;
      if (!byLevel.has(r.level)) byLevel.set(r.level, []);
      byLevel.get(r.level).push(r.tcc);
    });
    const bands = [...byLevel.entries()].map(([level, vals]) => ({
      level, count: vals.length,
      avg: vals.reduce((t, x) => t + x, 0) / vals.length,
    }));
    qualifyInversions_(grp, detectInversions_(bands, cfg), "local").forEach(inv => {
      out.push(Object.assign({ location: loc, currency: curs[0] || "" }, inv));
    });
  });
  return out;
}

/**
 * Job-family qualification of inversion flags — inversions are INVESTIGATION
 * TRIGGERS, not errors: a manager in a lower-market family (People, Finance)
 * can legitimately earn below a senior IC in a high-demand technical family.
 * The dimension is the TRUE job family from the title prefix (JF004, JF018 —
 * parseJobFamily_) when present, falling back to department. For each flagged
 * pair, find groups where BOTH bands are present AND the manager average
 * still sits below the IC average: those are genuine inversion candidates.
 * A pair whose bands never invert inside one group is likely a market-rate
 * mix across families. Only membership is exposed — never the tiny per-group
 * averages themselves.
 */
function qualifyInversions_(active, inversions, mode) {
  if (!inversions.length) return inversions;
  const useFamily = active.some(r => r.jobFamily);
  const field = useFamily ? "jobFamily" : "dept";
  const dimLabel = useFamily ? "job family" : "department";
  const groups = [...new Set(active.map(r => r[field]).filter(Boolean))].sort();
  const bandGroups = level => [...new Set(active
    .filter(r => r.level === level && tccOf_(r, mode) > 0)
    .map(r => r[field]).filter(Boolean))].sort();
  return inversions.map(inv => {
    const withinGroups = groups.filter(g => {
      const grp = active.filter(r => r[field] === g);
      const avgOf = level => {
        const vals = grp.filter(r => r.level === level)
          .map(r => tccOf_(r, mode)).filter(v => v > 0);
        return vals.length
          ? vals.reduce((t, x) => t + x, 0) / vals.length : null;
      };
      const m = avgOf(inv.mLevel), ic = avgOf(inv.icLevel);
      return m != null && ic != null && m < ic;
    });
    return Object.assign({}, inv, {
      withinGroups,
      // Which families each band actually spans — so the reader never has to
      // guess whether the M4s are Services managers or People managers.
      mGroups: bandGroups(inv.mLevel),
      icGroups: bandGroups(inv.icLevel),
      dimLabel,
      crossFamilyOnly: withinGroups.length === 0,
    });
  });
}

/**
 * Salary inversion — a manager band average sitting BELOW a senior IC band
 * average (IC level ≥ SENIOR_IC_MIN). Only bands large enough to carry an
 * average participate (small bands are suppressed upstream).
 * @returns {Array<{mLevel, mAvg, icLevel, icAvg}>}
 */
function detectInversions_(bands, cfg) {
  // Only bands with enough members carry a comparable average — a 1–2 person
  // band's figure is an individual's comp, not a band position.
  const withAvg = bands.filter(b => b.avg != null && b.count >= cfg.SMALL_GROUP_MIN);
  const mgrs = withAvg.filter(b => /^M\d+$/.test(b.level));
  const seniorIcs = withAvg.filter(b => {
    const m = b.level.match(/^I(\d+)$/);
    return m && parseInt(m[1], 10) >= cfg.SENIOR_IC_MIN;
  });
  const out = [];
  mgrs.forEach(m => {
    seniorIcs.forEach(ic => {
      if (m.avg < ic.avg) {
        out.push({ mLevel: m.level, mAvg: m.avg, icLevel: ic.level, icAvg: ic.avg });
      }
    });
  });
  return out;
}

// ── Internal position / market / equity flag COUNTS — spec §6.7 ────────────
// Counts only, never names. Anchor tiering forked from CompDash
// buildCompaGroups_ so the two apps agree on what "position" means.

function benchKey_(location, jobTitle) {
  return normWR_(location) + "||" + normWR_(jobTitle);
}

/** @returns {{row: (Object|null), mismatch: boolean}} */
function lookupBench_(benchMap, keyLocation, jobTitle, empCurrency) {
  const row = benchMap ? benchMap[benchKey_(keyLocation, jobTitle)] : null;
  if (!row) return { row: null, mismatch: false };
  if (row.currency && empCurrency && normWR_(row.currency) !== normWR_(empCurrency)) {
    return { row: null, mismatch: true };
  }
  return { row, mismatch: false };
}

// Forked from CompDash buildCompaGroups_ (V2 tiered anchors); members carry
// ratios only for counting into bands here — no member rows leave this module.
function buildCompaGroups_(activeRecords, benchMap, cfg) {
  const min = cfg.SMALL_GROUP_MIN;
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
                     level: r.level, currency: r.currency || "", members: [] });
    }
    if (r.tcc == null || r.tcc <= 0) return;
    map.get(key).members.push(r);
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
      keyLocation: g.keyLocation, jobTitle: g.jobTitle, anchorTier,
      ratios: anchor > 0 ? g.members.map(r => r.tcc / anchor) : [],
      unresolved: anchorTier === "none" ? count : 0,
    };
  });
}

function compaBandCounts_(groups, cfg) {
  const counts = { belowLow: 0, low: 0, target: 0, aboveHigh: 0, unresolved: 0 };
  groups.forEach(g => {
    counts.unresolved += g.unresolved;
    g.ratios.forEach(r => {
      if (r < cfg.COMPA_LOW_MIN) counts.belowLow++;
      else if (r < cfg.COMPA_TARGET_MIN) counts.low++;
      else if (r <= cfg.COMPA_HIGH_MAX) counts.target++;
      else counts.aboveHigh++;
    });
  });
  return counts;
}

/** Market-gap flags: actives matched to a benchmark row sitting below MARKET_LOW × mean. */
function marketGapCounts_(activeRecords, benchMap, cfg) {
  let matched = 0, below = 0, mismatch = 0;
  const belowLevels = new Map();
  activeRecords.forEach(r => {
    const b = lookupBench_(benchMap, r.keyLocation, r.jobTitle, r.currency);
    if (b.mismatch) mismatch++;
    if (!b.row || !(b.row.mean > 0) || !(r.tcc > 0)) return;
    matched++;
    if (r.tcc / b.row.mean < cfg.MARKET_LOW) {
      below++;
      belowLevels.set(r.level, (belowLevels.get(r.level) || 0) + 1);
    }
  });
  return {
    matched, below, mismatch,
    total: activeRecords.length,
    belowLevels: [...belowLevels.entries()].map(([key, count]) => ({ key, count }))
      .sort((a, b) => levelRank_(a.key) - levelRank_(b.key)),
  };
}

/**
 * Pay-equity flag COUNTS within Key Location + level groups (same location ⇒
 * same local currency). Groups smaller than SMALL_GROUP_MIN are suppressed
 * entirely (counted for the NOTE). Gender lens reports "pending" upstream
 * when the column is absent.
 */
function buildEquityCounts_(activeRecords, cfg, asOf) {
  const groups = new Map();
  activeRecords.forEach(r => {
    if (r.tcc == null || r.tcc <= 0) return;
    const key = (r.keyLocation || "—") + "||" + (r.level || "—");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  const genderAvailable = activeRecords.some(r => r.gender);
  let genderFlagged = 0, genderGroups = 0, outliers = 0, tenureFlags = 0, suppressed = 0;
  groups.forEach(members => {
    if (members.length < cfg.SMALL_GROUP_MIN) { suppressed++; return; }
    const med = median_(members.map(r => r.tcc));
    if (genderAvailable) {
      const byG = new Map();
      members.forEach(r => {
        const gd = String(r.gender || "").trim();
        if (!gd) return;
        if (!byG.has(gd)) byG.set(gd, []);
        byG.get(gd).push(r.tcc);
      });
      const eligible = [...byG.values()].filter(v => v.length >= 2);
      if (eligible.length >= 2) {
        genderGroups++;
        const meds = eligible.map(v => median_(v));
        const gapPct = (Math.max.apply(null, meds) - Math.min.apply(null, meds)) /
                       Math.max.apply(null, meds) * 100;
        if (gapPct >= cfg.EQUITY_GAP_PCT) genderFlagged++;
      }
    }
    members.forEach(r => {
      if (med == null || med <= 0) return;
      const pctBelow = (med - r.tcc) / med * 100;
      if (pctBelow >= cfg.EQUITY_OUTLIER_PCT) outliers++;
      const ten = tenureYears_(r.hireDate, asOf);
      if (ten != null && ten >= cfg.TENURE_YEARS_MIN && pctBelow >= cfg.TENURE_BELOW_PCT) {
        tenureFlags++;
      }
    });
  });
  return { genderAvailable, genderGroups, genderFlagged, outliers, tenureFlags, suppressed };
}

// ── FY25 depth guards — spec §4 ─────────────────────────────────────────────
// FY25 movement/attrition is only as good as the roster's retention of rows
// terminated back to the first FY's start; the lever section is only as good
// as RD history depth. Both fire RISK lines, never a silently wrong number.

function coverageStats_(records, histByEmp, fys) {
  let earliestTerm = null;
  records.forEach(r => {
    if (r.termDate && (!earliestTerm || r.termDate < earliestTerm)) earliestTerm = r.termDate;
  });
  let earliestEvent = null;
  Object.keys(histByEmp).forEach(emp => {
    histByEmp[emp].forEach(e => {
      if (e.date instanceof Date && !isNaN(e.date) &&
          (!earliestEvent || e.date < earliestEvent)) earliestEvent = e.date;
    });
  });
  const first = fys[0];
  // The lever-depth boundary is the first FY's end + 1 day (= the second FY's
  // start when one exists) — derived from first so any FY-range length works.
  const leverBoundary = new Date(first.startCalYear + 1, 6, 1);
  return {
    earliestTermDate: isoDate_(earliestTerm),
    earliestCompEvent: isoDate_(earliestEvent),
    // Terminations guard: earliest retained term row is inside/after the first FY.
    firstFyTermGuard: !earliestTerm || earliestTerm > first.start,
    // Lever guard: no comp events predate the first FY's close (spec: 2025-07-01).
    firstFyLeverGuard: !earliestEvent || earliestEvent >= leverBoundary,
    firstFyLabel: first.label,
    termsPerFy: fys.map(fy => ({
      label: fy.label,
      count: records.filter(r => r.termDate && r.termDate >= fy.start && r.termDate <= fy.end).length,
    })),
    eventsPerFy: fys.map(fy => ({
      label: fy.label,
      count: Object.keys(histByEmp).reduce((t, emp) =>
        t + histByEmp[emp].filter(e => e.date >= fy.start && e.date <= fy.end).length, 0),
    })),
  };
}

// ── View A section builders — spec §6 ───────────────────────────────────────
// Every builder returns { id, title, lines: [{badge, text}], tables: [...] }.
// Tables: { title, headers: string[], rows: Array<Array<string|number>> }.

function secScope_(records, active, scope, mode, activeInternCount, anchorIso, ipNote) {
  const asAt = anchorIso ? " as of " + anchorIso : "";
  const lines = [
    fact_(fmtInt_(active.length) + " active regular employees in scope (" +
      (scope === "company" ? "company-wide" : scope) + ")" + asAt + " — Regular Employee, " +
      "Employer of Record and Part Time types."),
    fact_(fmtInt_(records.length) + " regular roster records in scope including terminated " +
      "rows — the evidence base for movement and attrition."),
    fact_(fmtInt_(activeInternCount || 0) + " active interns" + asAt + " — reported separately; " +
      "excluded from headline movement, attrition and compensation metrics."),
    note_("Crew members and contractors are excluded from this report."),
  ];

  // THE one in-progress caveat of the whole report (exec review 2026-07-23:
  // the same note five times reads as noise) — every other section relies on
  // this line plus its own "(to date)" row labels.
  if (ipNote) lines.push(ipNote);

  if (mode.mode === "usd" && scope !== "company" && mode.currencies.length > 1) {
    lines.push(note_("This location spans " + mode.currencies.length + " currencies (" +
      mode.currencies.join(", ") + ") — compensation aggregates use the TCC USD column."));
  }
  return { id: "scope", title: "1 · Scope & population", lines, tables: [] };
}

/**
 * Headcount & annualized cost by location — the location lens a 12-location
 * company reads first (exec review 2026-07-23: "location is essentially
 * invisible"). USD here is deliberately the COST lens — per-location averages
 * are single-geography figures, so they are also safely comparable.
 * @returns {Object|null} a section table, or null when nothing to compare
 */
function buildLocationTable_(active) {
  const byLoc = new Map();
  active.forEach(r => {
    const k = r.keyLocation || "—";
    if (!byLoc.has(k)) byLoc.set(k, { hc: 0, usd: 0, valued: 0 });
    const e = byLoc.get(k);
    e.hc++;
    const v = tccOf_(r, "usd");
    if (v > 0) { e.usd += v; e.valued++; }
  });
  if (byLoc.size < 2) return null;
  const rows = [...byLoc.entries()]
    .sort((a, b) => b[1].hc - a[1].hc || String(a[0]).localeCompare(String(b[0])))
    .map(([loc, e]) => [loc, e.hc,
      e.valued ? fmtMoneyShort_(e.usd / e.valued, "") : "—",
      e.valued ? fmtMoneyShort_(e.usd, "") : "—"]);
  const tot = [...byLoc.values()].reduce(
    (t, e) => ({ hc: t.hc + e.hc, usd: t.usd + e.usd, valued: t.valued + e.valued }),
    { hc: 0, usd: 0, valued: 0 });
  rows.push(["Total", tot.hc,
    tot.valued ? fmtMoneyShort_(tot.usd / tot.valued, "") : "—",
    tot.valued ? fmtMoneyShort_(tot.usd, "") : "—"]);
  return { title: "Headcount & annualized cost by location (USD)",
    headers: ["Location", "Headcount", "Avg TCC", "Total TCC"], rows };
}

function secComposition_(comp, anchored, locTable) {
  const lines = [
    fact_(fmtInt_(comp.icCount) + " individual contributors and " + fmtInt_(comp.mCount) +
      " managers" + (comp.unparsedCount
        ? " (" + fmtInt_(comp.unparsedCount) + " titles carry no parseable level)" : "") + "."),
    fact_("Average tenure is " + (comp.avgTenureYears != null ? comp.avgTenureYears + " years" : "—") +
      " (Hire Date to " + (anchored ? "the period-end anchor" : "extraction date") + ")."),
  ];
  // Job family stays an ANALYSIS dimension (inversion qualification, leaver
  // sub-function view) — a standalone family headcount table added no
  // decision value and was removed 2026-07-23 per CEO feedback.
  return {
    id: "composition", title: "3 · Composition", lines,
    tables: (locTable ? [locTable] : []).concat([
      { title: "Headcount by department", headers: ["Department", "Headcount"],
        rows: comp.depts.map(d => [d.key, d.count])
          .concat(comp.depts.length > 1
            ? [["Total", comp.depts.reduce((t, d) => t + d.count, 0)]] : []) },
    ]),
    // Tenure reads faster as a bar chart than as a table; level distribution
    // lives ONLY in section 3 (with average cost) — never duplicated here.
    charts: [
      { title: "Tenure distribution", bars: comp.tenureBuckets.map(b => ({ label: b.key, value: b.count })) },
    ],
  };
}

function secCompStructure_(cs, mode, cfg) {
  const lines = [
    fact_("Total TCC envelope is " + fmtMoneyShort_(cs.envelope, mode.code) + " across " +
      fmtInt_(cs.valued) + " employees with a recorded value — " +
      fmtMoneyShort_(cs.perHead, mode.code) + " per head."),
    note_("TCC includes variable target; it is not base wage."),
  ];
  if (mode.mode === "usd") {
    // The rule that keeps this section honest company-wide: blended USD band
    // averages are cost figures, never equity comparisons (exec review
    // 2026-07-23 — a mix of US and El Salvador headcount moves the average,
    // not pay decisions). Inversions below are within-location only.
    lines.push(note_("Band averages in this scope are geography-weighted COST figures " +
      "— useful for budget reading only, never compared band-vs-band for equity. " +
      "Inversion checks run within each location on local currency; person-level " +
      "position is the compa-ratio view in the flags section."));
  }
  cs.inversions.forEach(inv => {
    const code = inv.currency || mode.code;
    const where = inv.location ? " within " + inv.location : "";
    const span = (inv.mGroups && inv.mGroups.length && inv.icGroups && inv.icGroups.length)
      ? " (" + inv.mLevel + " spans " + inv.mGroups.join(", ") + "; " +
        inv.icLevel + " spans " + inv.icGroups.join(", ") + ")"
      : "";
    lines.push(fact_("Salary inversion" + where + " — the " + inv.mLevel +
      " band average (" + fmtMoneyShort_(inv.mAvg, code) + ") sits below the " +
      inv.icLevel + " band average (" + fmtMoneyShort_(inv.icAvg, code) + ")" + span +
      (inv.withinGroups && inv.withinGroups.length
        ? "; the pattern holds inside " + inv.withinGroups.join(", ") +
          " — a genuine inversion candidate"
        : "; the two bands never invert within a single " + (inv.dimLabel || "department") +
          " — likely a job-family market-rate mix, not an equity error") + "."));
  });
  // No caution NOTE (user directive 2026-07-23): each FACT's own branch text
  // ("genuine inversion candidate" / "market-rate mix, not an equity error")
  // carries the read.
  if (!cs.inversions.length && mode.mode === "usd") {
    lines.push(fact_("No within-location salary inversion clears the small-group floor — " +
      "no band-structure flag stands once geography mix is removed."));
  }
  if (cs.missingComp) {
    lines.push(note_(fmtInt_(cs.missingComp) + " employees are missing a " +
      (mode.mode === "usd" ? "TCC USD" : "TCC") +
      " value — excluded from compensation aggregates, included in headcount."));
  }
  // No USD-source line in the body (user directive 2026-07-23): FX lineage
  // lives in the definitions appendix only.
  return {
    id: "comp-structure", title: "4 · Compensation structure", lines,
    tables: [
      // THE level-distribution table of the report (section 2 never repeats it):
      // end-of-period active headcount per level + average cost, exec short form.
      { title: "Level distribution — end active headcount & average cost (" + mode.code + ")",
        headers: ["Level", "End active headcount", "Avg TCC (" + mode.code + ")"],
        rows: cs.bands.map(b => [b.level, b.count, fmtMoneyShort_(b.avg, "")])
          .concat(cs.bands.length > 1
            ? [["Total", cs.bands.reduce((t, b) => t + b.count, 0),
                fmtMoneyShort_(cs.perHead, "")]] : []) },
    ],
  };
}

// ── Section 2 — the fiscal-year story / FY-over-FY comparison ───────────────
// The reason the FY toggles exist (user directive 2026-07-23):
//   ONE window selected  → the year's story — what the period DID (open→close
//     headcount, hiring vs exits, attrition quality, recognition, annualized
//     cost of movement) read in one place instead of assembled from §5–§7.
//   TWO+ windows         → the comparison read — every consecutive selected
//     pair is judged per measure: what improved lands as FACT, what moved
//     against the business as RISK, sub-threshold moves as a held-steady
//     NOTE, plus one side-by-side table. A pair ending in the IN-PROGRESS
//     window compares against the closed year's SAME-PERIOD twin (`matched`,
//     truncated to the same elapsed span) — a partial year must never be
//     judged against a full one; the table still shows full periods with the
//     open one marked "(to date)".
// Headcount change is stated as closing − opening and DECOMPOSED into
// hires − exits ± reclassification — the story sentence must foot exactly,
// like the §5 reconciliation. `allMoves` (regulars + interns) is the tie-out
// to all-population headcount reports that skip the Employee Type split.
// Windows may be full FYs or same-quarter slices (quarter view) — labels
// carry the difference; the logic is identical.

/** "+23" / "−4" / "0" — signed integer for movement sentences. */
function fmtSigned_(n) {
  if (!(typeof n === "number" && isFinite(n))) return "—";
  const r = Math.round(n);
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toLocaleString("en-US");
}

/** Signed percentage-point move: 2.6 → "+2.6 pp". */
function fmtPp_(pp) {
  return (pp >= 0 ? "+" : "−") + Math.abs(pp).toFixed(1) + " pp";
}

function secFyStory_(moves, attr, levers, tccs, windows, mode, cfg, asOfIso, matched, allMoves) {
  const lines = [];
  const tables = [];
  const recTotal = l => l.promo.count + l.adjust.count;
  // The year's REAL headcount change (closing − opening) decomposed so the
  // sentence foots: hires − exits ± reclassification (residue per fyMovement_).
  const hcChange = m => {
    const delta = m.hcEnd - m.hcStart;
    return fmtSigned_(delta) + " for the period (" + fmtInt_(m.hires) + " hires − " +
      fmtInt_(m.exits) + " exits" +
      (m.reclass ? (m.reclass > 0 ? " + " : " − ") + fmtInt_(Math.abs(m.reclass)) +
        " reclassification" : "") + ")";
  };

  if (windows.length === 1) {
    // ── Story mode ──
    const m = moves[0], a = attr[0], l = levers[0], t = tccs[0];
    const tag = m.inProgress ? " (to date)" : "";
    const growthPct = m.hcStart > 0 ? (m.hcEnd - m.hcStart) / m.hcStart : null;
    lines.push(fact_(m.label + tag + ": opened at " + fmtInt_(m.hcStart) +
      " regular employees and closed at " + fmtInt_(m.hcEnd) + " — " + hcChange(m) +
      (growthPct != null ? ", " + (growthPct >= 0 ? "+" : "−") +
        fmtPct_(Math.abs(growthPct)) : "") + "."));
    if (allMoves) {
      const am = allMoves[0];
      lines.push(note_("All employee types (regular + intern/fixed-term): " +
        fmtInt_(am.hcStart) + " → " + fmtInt_(am.hcEnd) +
        " — the tie-out figure for headcount reports that count every roster row."));
    }
    if (a.exits > 0) {
      const top = a.reasons.find(x => x.key !== "—");
      lines.push(fact_("Attrition " + fmtPct_(m.rate) + " for the period; " +
        fmtInt_(a.regretted) + " of " + fmtInt_(a.exits) + " exits regretted (" +
        fmtPct_(a.regrettedPct, 0) + "), " + fmtInt_(a.organicExits) + " organic vs " +
        fmtInt_(a.structuralExits) + " structural" +
        (top ? "; most recorded reason “" + top.key + "” (" +
          fmtInt_(top.count) + " of " + fmtInt_(a.exits) + ")" : "") + "."));
    } else {
      lines.push(fact_("No exits recorded in " + m.label + tag + " — attrition 0%."));
    }
    lines.push(recTotal(l) > 0
      ? fact_("Recognition: " + fmtInt_(recTotal(l)) + " compensation events — " +
          fmtInt_(l.promo.count) + " promotions, " + fmtInt_(l.adjust.count) +
          " adjustments (deltas and growth in the Compensation growth section).")
      : note_("No promotion or adjustment events recorded in " + m.label + tag + "."));
    if (t && t.anyValued) {
      // Valuation caveat rides inside the FACT — the method detail is an
      // appendix row, not a second body line (exec review 2026-07-23).
      lines.push(fact_("Annualized TCC impact of movement (at latest recorded TCC, " +
        "not payroll actuals): hires add ~" +
        fmtMoney_(t.hiresTotal, mode.code) + " (" + fmtInt_(t.hiresValued) + " of " +
        fmtInt_(t.hiresCount) + " priced), exits remove ~" +
        fmtMoney_(t.exitsTotal, mode.code) + " (" + fmtInt_(t.exitsValued) + " of " +
        fmtInt_(t.exitsCount) + " priced) — net " + fmtSigned_(t.net) + " " + mode.code + "."));
    }
    return { id: "fy-story", title: "2 · Fiscal-year story", lines, tables };
  }

  // ── Comparison mode ──
  // Every consecutive selected pair gets verdicts. When the later window is
  // in progress, the earlier one swaps in its same-period twin (`matched`) —
  // never a full year against a partial one.
  for (let i = 1; i < moves.length; i++) {
    let a = moves[i - 1], aa = attr[i - 1], la = levers[i - 1], samePeriod = false;
    const b = moves[i], ab = attr[i], lb = levers[i];
    if (b.inProgress) {
      const tw = matched && matched[i - 1];
      if (!tw) continue; // no twin available — the pair stays table-only
      a = tw.move; aa = tw.attr; la = tw.lever; samePeriod = true;
    }
    const lbl = samePeriod
      ? b.label + " to date vs " + a.label + " same period"
      : b.label + " vs " + a.label;
    lines.push(fact_(lbl + ": headcount " + a.label + (samePeriod ? " same period" : "") +
      " " + fmtInt_(a.hcStart) + " → " + fmtInt_(a.hcEnd) +
      "; " + b.label + (b.inProgress ? " to date" : "") +
      " " + fmtInt_(b.hcStart) + " → " + fmtInt_(b.hcEnd) +
      " (hires " + fmtInt_(a.hires) + " → " + fmtInt_(b.hires) +
      ", exits " + fmtInt_(a.exits) + " → " + fmtInt_(b.exits) + ")."));
    if (a.rate != null && b.rate != null) {
      const pp = (b.rate - a.rate) * 100;
      if (pp <= -cfg.COMPARE_ATTR_PP) {
        lines.push(fact_(lbl + ": attrition improved " + fmtPct_(a.rate) + " → " +
          fmtPct_(b.rate) + " (" + fmtPp_(pp) + ")."));
      } else if (pp >= cfg.COMPARE_ATTR_PP) {
        lines.push(risk_(lbl + ": attrition rose " + fmtPct_(a.rate) + " → " +
          fmtPct_(b.rate) + " (" + fmtPp_(pp) +
          ") — the Attrition detail section carries the reasons."));
      } else {
        lines.push(note_(lbl + ": attrition held steady (" + fmtPct_(a.rate) +
          " → " + fmtPct_(b.rate) + ")."));
      }
    }
    if (aa.exits > 0 && ab.exits > 0 &&
        aa.regrettedPct != null && ab.regrettedPct != null) {
      const pp = (ab.regrettedPct - aa.regrettedPct) * 100;
      if (pp <= -cfg.COMPARE_REGRET_PP) {
        lines.push(fact_(lbl + ": regretted share of exits improved " +
          fmtPct_(aa.regrettedPct, 0) + " → " + fmtPct_(ab.regrettedPct, 0) +
          " (" + fmtPp_(pp) + ") — fewer of the leavers were people the company wanted to keep."));
      } else if (pp >= cfg.COMPARE_REGRET_PP) {
        lines.push(risk_(lbl + ": regretted share of exits rose " +
          fmtPct_(aa.regrettedPct, 0) + " → " + fmtPct_(ab.regrettedPct, 0) +
          " (" + fmtPp_(pp) + ") — more of the leavers were people the company wanted to keep."));
      } else {
        lines.push(note_(lbl + ": regretted share held steady (" +
          fmtPct_(aa.regrettedPct, 0) + " → " + fmtPct_(ab.regrettedPct, 0) + ")."));
      }
    }
    lines.push(fact_(lbl + ": total recognition events " + fmtInt_(recTotal(la)) +
      " → " + fmtInt_(recTotal(lb)) +
      " (the promotion vs adjustment mix is read in the Compensation growth section)."));
  }
  // No same-period NOTE (user directive 2026-07-23): the "to date vs same
  // period" verdict labels carry the meaning; the rule is an appendix row.

  // Side-by-side table — one column per window, a Δ column when the selection
  // is exactly two closed windows (the canonical what-changed read).
  const dCol = moves.length === 2 && moves.every(m => !m.inProgress);
  const d = (fmt, va, vb) =>
    (va != null && vb != null && isFinite(va) && isFinite(vb)) ? fmt(vb - va) : "—";
  const a0 = moves[0], b0 = moves[moves.length - 1];
  const row = (label, vals, delta) => [label].concat(vals).concat(dCol ? [delta] : []);
  tables.push({
    title: "Fiscal periods side by side",
    headers: ["Measure"].concat(moves.map(m =>
      m.label + (m.inProgress ? " (to date)" : ""))).concat(dCol ? ["Δ"] : []),
    rows: [
      row("Headcount start → end",
        moves.map(m => fmtInt_(m.hcStart) + " → " + fmtInt_(m.hcEnd)),
        d(fmtSigned_, a0.hcEnd, b0.hcEnd)),
    ].concat(allMoves ? [
      row("Incl. intern/fixed-term (start → end)",
        allMoves.map(m => fmtInt_(m.hcStart) + " → " + fmtInt_(m.hcEnd)),
        d(fmtSigned_, allMoves[0].hcEnd, allMoves[allMoves.length - 1].hcEnd)),
    ] : []).concat([
      row("Hires", moves.map(m => fmtInt_(m.hires)), d(fmtSigned_, a0.hires, b0.hires)),
      row("Exits", moves.map(m => fmtInt_(m.exits)), d(fmtSigned_, a0.exits, b0.exits)),
      row("Net movement", moves.map(m => fmtSigned_(m.net)), d(fmtSigned_, a0.net, b0.net)),
      row("Attrition rate", moves.map(m => fmtPct_(m.rate)),
        d(x => fmtPp_(x * 100), a0.rate, b0.rate)),
      row("Regretted share of exits", attr.map(s => fmtPct_(s.regrettedPct, 0)),
        d(x => fmtPp_(x * 100), attr[0].regrettedPct, attr[attr.length - 1].regrettedPct)),
      row("Organic / structural exits",
        attr.map(s => fmtInt_(s.organicExits) + " / " + fmtInt_(s.structuralExits)), "—"),
      row("Recognition events (promos + adjustments)",
        levers.map(l => fmtInt_(recTotal(l))),
        d(fmtSigned_, recTotal(levers[0]), recTotal(levers[levers.length - 1]))),
      row("Net TCC impact of movement (" + mode.code + ")",
        tccs.map(t => t.anyValued ? fmtMoney_(t.net) : "—"),
        (tccs[0].anyValued && tccs[tccs.length - 1].anyValued)
          ? d(fmtSigned_, tccs[0].net, tccs[tccs.length - 1].net) : "—"),
    ]),
  });
  return { id: "fy-story", title: "2 · Fiscal years compared", lines, tables };
}

function secMovement_(moves, coverage, fys, asOfIso, internFlow) {
  const lines = [];
  moves.forEach(m => {
    lines.push(fact_(m.label + ": " + fmtInt_(m.hires) + " hires, " + fmtInt_(m.exits) +
      " exits (net " + (m.net >= 0 ? "+" : "") + fmtInt_(m.net) + "), regular-employee " +
      "attrition rate " + fmtPct_(m.rate) + "."));
  });

  // Methodology (rate formula, headcount instants) lives in the definitions
  // appendix only (exec review 2026-07-23) — the body states findings. The
  // reconciliation NOTE renders ONLY when a real ± residue exists: that is a
  // finding (conversions/roster corrections), not method plumbing.
  const offFys = moves.filter(m => m.reclass);
  if (offFys.length) {
    lines.push(note_("Headcount reconciliation: closing = opening + hires − exits ± " +
      "reclassification — " +
      offFys.map(m => m.label + ": " + m.hcStart + " + " + m.hires + " − " + m.exits +
        (m.reclass > 0 ? " + " : " − ") + Math.abs(m.reclass) + " = " + m.hcEnd).join("; ") +
      ". The ± term is movement between the regular and intern/fixed-term populations " +
      "or roster corrections — headcount that changes with no hire or exit event."));
  }
  if (coverage.firstFyTermGuard) {
    lines.push(risk_(coverage.firstFyLabel + " exits may be undercounted — earliest retained " +
      "termination is " + (coverage.earliestTermDate || "none on file") + "."));
  }
  // No Total rows here (user directive 2026-07-23 round 3): per-FY movement
  // rows don't sum into one meaningful figure — a multi-year attrition rate
  // is not an annual rate, and spans across years are the §2 story's job.
  const tables = [
    { title: "Movement by fiscal year — regular employees",
      headers: ["FY", "Hires", "Exits", "Net", "Headcount start → end", "Attrition rate"],
      rows: moves.map(m => [m.label + (m.inProgress ? " (to date)" : ""), m.hires, m.exits,
        (m.net >= 0 ? "+" : "") + m.net, m.hcStart + " → " + m.hcEnd, fmtPct_(m.rate)]) },
  ];
  if (internFlow && internFlow.length) {
    tables.push({
      title: "Intern & fixed-term flow (excluded from the headline)",
      headers: ["FY", "Hires", "Exits", "Active start → end"],
      rows: internFlow.map(m => [m.label + (m.inProgress ? " (to date)" : ""),
        m.hires, m.exits, m.hcStart + " → " + m.hcEnd]),
    });
  }
  return { id: "movement", title: "5 · Workforce movement", lines, tables };
}

function secAttritionDetail_(stats, cfg, coverage, fys, asOfIso, ghostDepts) {
  // Evidence first, caveats last — a CEO reads the FY FACTs and RISKs, not
  // methodology plumbing. Config internals (DEPT_REMAP, REASON_REMAP names,
  // the taxonomy list) live in the Confluence definitions appendix and the
  // debug log, never in reader-facing lines.
  const lines = [];
  stats.forEach(s => {
    lines.push(fact_(s.label + ": " + fmtInt_(s.regretted) + " of " + fmtInt_(s.exits) +
      " exits regretted (" + fmtPct_(s.regrettedPct, 0) + ")" +
      (s.exits > 0
        ? " — " + fmtInt_(s.organicExits) + " organic, " + fmtInt_(s.structuralExits) +
          " structural (position eliminated)"
        : "") +
      (s.avgLeaverTenureYears != null
        ? "; average leaver tenure " + s.avgLeaverTenureYears + " years" : "") +
      (s.exits > 0
        ? "; leavers: " + fmtInt_(s.icExits) + " individual contributors (I-levels), " +
          fmtInt_(s.mExits) + " managers (M-levels)"
        : "") + "."));
    const top = s.reasons.find(x => x.key !== "—");
    if (top && s.exits > 0 && top.count / s.exits >= cfg.RISK_REASON_SHARE) {
      lines.push(risk_(s.label + ": a single recorded reason (\"" + top.key + "\") accounts for " +
        fmtInt_(top.count) + " of " + fmtInt_(s.exits) + " exits."));
    }
  });
  // Regretted-share breaches synthesized into ONE finding (exec review
  // 2026-07-23): a multi-period pattern is the headline — repeating the same
  // RISK per FY scattered the report's strongest signal.
  const breaches = stats.filter(s =>
    s.exits > 0 && s.regrettedPct != null && s.regrettedPct * 100 >= cfg.RISK_REGRET_PCT);
  if (breaches.length > 1) {
    lines.push(risk_("Regretted share of exits has been at or above the " +
      cfg.RISK_REGRET_PCT + "% review threshold in " +
      (breaches.length === stats.length ? "every period shown" :
        breaches.length + " of " + stats.length + " periods") + " (" +
      breaches.map(s => s.label + " " + fmtPct_(s.regrettedPct, 0)).join(" → ") +
      ") — a persistent retention pattern, not a single-period spike."));
  } else if (breaches.length === 1) {
    lines.push(risk_(breaches[0].label + ": regretted share of exits is " +
      fmtPct_(breaches[0].regrettedPct, 0) + " — at or above the " +
      cfg.RISK_REGRET_PCT + "% review threshold."));
  }
  if (coverage.firstFyTermGuard) {
    lines.push(risk_(coverage.firstFyLabel + " attrition detail shares the movement-section " +
      "coverage limit — earliest retained termination is " +
      (coverage.earliestTermDate || "none on file") + "."));
  }
  // Regretted-flag provenance lives in the definitions appendix only (user
  // directive 2026-07-23) — no definition NOTE in the body.
  if (ghostDepts && ghostDepts.length) {
    lines.push(note_("Leaver departments reflect the organisation at exit time — " +
      fmtInt_(ghostDepts.length) + " historical department" +
      (ghostDepts.length === 1 ? " (" : "s (e.g. ") + ghostDepts.slice(0, 3).join(", ") +
      ") " + (ghostDepts.length === 1 ? "has" : "have") + " since been merged or dissolved."));
  }
  // ONE readable table: each row is a department × reason combination with a
  // count column per FY. Level detail stays out — the IC vs Manager split is
  // stated in the per-FY FACT lines above.
  const comboMap = new Map();
  stats.forEach(s => (s.combos || []).forEach(c => {
    const k = [c.dept, c.reason].join("||");
    if (!comboMap.has(k)) {
      comboMap.set(k, { dept: c.dept, reason: c.reason, perFy: {}, total: 0 });
    }
    const e = comboMap.get(k);
    e.perFy[s.label] = (e.perFy[s.label] || 0) + c.count;
    e.total += c.count;
  }));
  const comboRows = [...comboMap.values()].sort((a, b) =>
    b.total - a.total ||
    a.dept.localeCompare(b.dept) ||
    a.reason.localeCompare(b.reason));
  const tables = [
    { title: "Leavers by department and reason",
      headers: ["Department", "Reason"]
        .concat(stats.map(s => s.label)).concat(["Total"]),
      rows: comboRows.map(e => [e.dept, e.reason]
        .concat(stats.map(s => e.perFy[s.label] || 0)).concat([e.total]))
        .concat(comboRows.length > 1 ? [["Total", ""]
          .concat(stats.map(s => s.exits))
          .concat([stats.reduce((t, s) => t + s.exits, 0)])] : []) },
  ];
  // Sub-function breakdown: departments are consolidated (Services can hold
  // ~3/4 of a scope), so job family is the dimension that shows WHERE inside
  // a department the talent is leaving.
  const famMap = new Map();
  stats.forEach(s => (s.families || []).forEach(x => {
    if (x.key === "—") return;
    if (!famMap.has(x.key)) famMap.set(x.key, { perFy: {}, total: 0 });
    const e = famMap.get(x.key);
    e.perFy[s.label] = (e.perFy[s.label] || 0) + x.count;
    e.total += x.count;
  }));
  if (famMap.size) {
    tables.push({
      title: "Leavers by job family (sub-function view)",
      headers: ["Job family"].concat(stats.map(s => s.label)).concat(["Total"]),
      rows: [...famMap.entries()]
        .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
        .map(([fam, e]) => [fam]
          .concat(stats.map(s => e.perFy[s.label] || 0)).concat([e.total]))
        .concat(famMap.size > 1 ? [["Total"]
          .concat(stats.map(s => [...famMap.values()]
            .reduce((t, e) => t + (e.perFy[s.label] || 0), 0)))
          .concat([[...famMap.values()].reduce((t, e) => t + e.total, 0)])] : []),
    });
  }
  return { id: "attrition", title: "6 · Attrition detail", lines, tables };
}

function secLevers_(leverBlocks, mode, coverage, cfg, fys, asOfIso) {
  const lines = [];
  leverBlocks.forEach(b => {
    lines.push(fact_(b.label + ": " + fmtInt_(b.promo.count) + " promotion events" +
      (b.promo.totalRaise != null ? " totalling " + fmtMoney_(b.promo.totalRaise, mode.code) : "") +
      (b.promo.growthPct != null ? " (aggregate growth " + fmtPct_(b.promo.growthPct) + ")" : "") +
      "; " + fmtInt_(b.adjust.count) + " adjustment events" +
      (b.adjust.totalRaise != null ? " totalling " + fmtMoney_(b.adjust.totalRaise, mode.code) : "") +
      (b.adjust.growthPct != null ? " (aggregate growth " + fmtPct_(b.adjust.growthPct) + ")" : "") + "."));
  });
  // FY-over-FY recognition comparison — what improved, what got worse, read
  // REASONABLY: total recognition first, lever mix second. Classification
  // mechanics live in the definitions appendix, never here.
  compareLeverPairs_(leverBlocks).forEach(p => {
    lines.push(fact_(p.from.label + " → " + p.to.label + ": total recognition events " +
      fmtInt_(p.totalFrom) + " → " + fmtInt_(p.totalTo) +
      " — promotions " + fmtInt_(p.from.promo.count) + " → " + fmtInt_(p.to.promo.count) +
      ", adjustments " + fmtInt_(p.from.adjust.count) + " → " + fmtInt_(p.to.adjust.count) + "."));
    if (p.mixShift) {
      lines.push(note_("Fewer promotions with more adjustments is a change of recognition " +
        "lever, not of coverage — rocketeers were considered through salary calibration " +
        "rather than title moves. Weigh promotion growth (" +
        fmtPct_(p.from.promo.growthPct) + " → " + fmtPct_(p.to.promo.growthPct) +
        ") before reading this as under-recognition."));
    }
    if (p.contraction) {
      lines.push(risk_(p.from.label + " → " + p.to.label + ": total recognition events fell (" +
        fmtInt_(p.totalFrom) + " → " + fmtInt_(p.totalTo) + ") alongside fewer promotions — " +
        "a genuine recognition gap, not a lever change."));
    }
  });
  if (mode.mode === "usd") {
    lines.push(note_("Growth percentages are computed in LOCAL currency (mean per-event " +
      "% change) — FX drift never contaminates them. USD raise totals are a labelled " +
      "convenience: each local delta valued at the employee's current TCC USD ÷ local " +
      "TCC rate."));
  }
  if (coverage.firstFyLeverGuard) {
    lines.push(risk_(coverage.firstFyLabel + " lever figures may be incomplete — earliest " +
      "comp event on file is " + (coverage.earliestCompEvent || "none") + "."));
  }
  return {
    id: "levers", title: "7 · Compensation growth by lever", lines,
    tables: [
      // No-prior events stay disclosed via the NOTE above — a column of
      // near-zeros earned no board attention (removed 2026-07-23).
      { title: "Lever events by fiscal year",
        headers: ["FY", "Lever", "Events", "Total raise", "Aggregate growth"],
        rows: leverBlocks.flatMap(b => [
          [b.label, "Promotions", b.promo.count,
           b.promo.totalRaise != null ? fmtMoney_(b.promo.totalRaise, mode.code) : "—",
           fmtPct_(b.promo.growthPct)],
          [b.label, "Adjustments", b.adjust.count,
           b.adjust.totalRaise != null ? fmtMoney_(b.adjust.totalRaise, mode.code) : "—",
           fmtPct_(b.adjust.growthPct)],
        ]) },
    ],
  };
}

function secFlags_(bandCounts, market, equity, cfg) {
  // `market` is null while MARKET_ENABLED is off — this section is then a
  // pure INTERNAL salary mid-point evaluation, and says so.
  const lines = [
    fact_(fmtInt_(bandCounts.belowLow) + " employees sit below " +
      fmtPct_(cfg.COMPA_LOW_MIN, 0) + " of their internal anchor; " +
      fmtInt_(bandCounts.low) + " between " + fmtPct_(cfg.COMPA_LOW_MIN, 0) + " and " +
      fmtPct_(cfg.COMPA_TARGET_MIN, 0) + "; " + fmtInt_(bandCounts.target) +
      " at target; " + fmtInt_(bandCounts.aboveHigh) + " above " +
      fmtPct_(cfg.COMPA_HIGH_MAX, 0) + "."),
  ];
  if (market) {
    lines.push(fact_(fmtInt_(market.below) + " of " + fmtInt_(market.matched) +
      " benchmark-matched employees sit below " + fmtPct_(cfg.MARKET_LOW, 0) +
      " of the external market mean" +
      (market.below && market.belowLevels.length
        ? " (levels: " + market.belowLevels.map(x => x.key + " ×" + x.count).join(", ") + ")"
        : "") + "."));
    lines.push(note_("Benchmark coverage: " + fmtInt_(market.matched) + " of " + fmtInt_(market.total) +
      " active employees matched — external rows exist only where a location + job title " +
      "has been compiled (the compilation grows over time); currency-mismatched rows are " +
      "withheld, and unmatched employees simply have no local benchmark yet."));
  }


  // The gender lens renders only when the data exists — no pending-status
  // NOTE while it doesn't (user directive 2026-07-23).
  if (equity.genderAvailable) {
    lines.push(fact_(fmtInt_(equity.genderFlagged) + " of " + fmtInt_(equity.genderGroups) +
      " gender-comparable groups carry a median gap at or above " + cfg.EQUITY_GAP_PCT + "%; " +
      fmtInt_(equity.outliers) + " below-median outlier flags; " + fmtInt_(equity.tenureFlags) +
      " long-tenure-low-position flags."));
  }
  // Coverage gaps are LIMITATIONS of the equity conclusions, not footnotes
  // (exec review 2026-07-23) — the reader must know how much of the org this
  // section actually assesses before acting on it.
  const anchorTotal = bandCounts.belowLow + bandCounts.low + bandCounts.target +
    bandCounts.aboveHigh + bandCounts.unresolved;
  if (bandCounts.unresolved) {
    lines.push(risk_(fmtInt_(bandCounts.unresolved) + " of " + fmtInt_(anchorTotal) +
      " employees (" + fmtPct_(anchorTotal ? bandCounts.unresolved / anchorTotal : null, 0) +
      ") have no resolvable internal anchor — the position and equity view covers only " +
      "the remaining " + fmtInt_(anchorTotal - bandCounts.unresolved) +
      "; treat its conclusions as partial."));
  }

  if (market && market.mismatch) {
    lines.push(note_(fmtInt_(market.mismatch) + " benchmark rows were withheld for currency " +
      "mismatch — never silently compared across currencies."));
  }
  return { id: "flags",
    title: market ? "8 · Market & equity flags" : "8 · Internal position & equity flags",
    lines, tables: [
    { title: "Internal position distribution",
      headers: ["Band", "Employees"],
      rows: [
        ["Below " + fmtPct_(cfg.COMPA_LOW_MIN, 0), bandCounts.belowLow],
        [fmtPct_(cfg.COMPA_LOW_MIN, 0) + "–" + fmtPct_(cfg.COMPA_TARGET_MIN, 0), bandCounts.low],
        ["At target (" + fmtPct_(cfg.COMPA_TARGET_MIN, 0) + "–" + fmtPct_(cfg.COMPA_HIGH_MAX, 0) + ")", bandCounts.target],
        ["Above " + fmtPct_(cfg.COMPA_HIGH_MAX, 0), bandCounts.aboveHigh],
        ["No resolvable anchor", bandCounts.unresolved],
        ["Total", bandCounts.belowLow + bandCounts.low + bandCounts.target +
          bandCounts.aboveHigh + bandCounts.unresolved],
      ] },
  ] };
}

/**
 * View A — the full Location report for one scope.
 * `windows` are the periods the time-based sections (movement, attrition,
 * levers) run over — the FY list by default, or per-FY quarter windows when
 * the quarterly filter is active. Snapshot sections (scope, composition,
 * comp structure, flags) describe the population in `records` at `ctx.asOf`:
 * the caller anchors both to the END of the selected period (rosterAsAt_)
 * when the selection is fully closed, so a past-FY selection reads as the
 * company as it stood then.
 * @returns {{scope, currency, sections: Array}}
 */
function buildLocationReport_(records, histByEmp, benchMap, scope, windows, ctx, cfg, coverage) {
  const inScope = scope === "company"
    ? records : records.filter(r => r.keyLocation === scope);
  // HEADLINE population = regular employees (Regular Employee, Employer of
  // Record, Part Time). Interns flow in their own strand — a blended
  // attrition figure would misdirect the board (30% blended vs ~21% regular).
  const regulars = inScope.filter(r => !r.isIntern);
  const interns = inScope.filter(r => r.isIntern);
  const active = regulars.filter(r => r.active);
  const activeInterns = interns.filter(r => r.active);
  const mode = currencyModeForScope_(regulars, scope);
  const asOfIso = isoDate_(ctx.asOf);
  const empNos = [...new Set(regulars.map(r => r.empNo).filter(Boolean))];

  // usd mode: per-employee current FX (TCC USD ÷ local TCC) so lever raise
  // totals are reportable company-wide — the active row wins over old stints.
  const usdRates = {};
  if (mode.mode === "usd") {
    regulars.forEach(r => {
      if (!r.empNo || !(r.tcc > 0) || !(r.tccUsd > 0)) return;
      if (!(r.empNo in usdRates) || r.active) usdRates[r.empNo] = r.tccUsd / r.tcc;
    });
  }

  const moves = windows.map(w => fyMovement_(regulars, w, ctx.asOf));
  const internFlow = interns.length
    ? windows.map(w => fyMovement_(interns, w, ctx.asOf)) : [];
  const attr = windows.map(w => fyAttritionStats_(regulars, w, ctx.asOf, cfg));
  const levers = windows.map(w => buildLeversForFy_(empNos, histByEmp, w, mode.mode, cfg, usdRates));
  const tccMoves = windows.map(w => movementTccImpact_(regulars, w, ctx.asOf, mode.mode));

  // Same-period twins: when the selection ends in an in-progress window, each
  // CLOSED window gets a slice truncated to the same elapsed calendar span so
  // section 2 compares apples-to-apples ("FY27 to date vs FY26 same period").
  const curWin = windows[windows.length - 1];
  const matched = windows.map(w => {
    if (!curWin || !curWin.inProgress || w.inProgress) return null;
    const yearGap = curWin.startCalYear - w.startCalYear;
    const end = new Date(ctx.asOf.getFullYear() - yearGap,
      ctx.asOf.getMonth(), ctx.asOf.getDate());
    const twin = { label: w.label, start: w.start, end,
      inProgress: false, startCalYear: w.startCalYear };
    return {
      move: fyMovement_(regulars, twin, ctx.asOf),
      attr: fyAttritionStats_(regulars, twin, ctx.asOf, cfg),
      lever: buildLeversForFy_(empNos, histByEmp, twin, mode.mode, cfg, usdRates),
      endIso: isoDate_(end),
    };
  });
  // All-population movement (regulars + interns) — the tie-out to headcount
  // reports that count every roster row without an Employee Type split.
  const allMoves = interns.length
    ? windows.map(w => fyMovement_(inScope, w, ctx.asOf)) : null;
  // Internal-only mode: an empty bench map disables the market anchor tier,
  // so small groups resolve straight to the level-cohort median.
  const compaGroups = buildCompaGroups_(active, cfg.MARKET_ENABLED ? benchMap : {}, cfg);
  // Ghost departments: present among scope leavers, absent among active
  // regulars ANYWHERE in the company — a department alive elsewhere (e.g. IT
  // with no Chile actives) is NOT a ghost just because this location's
  // actives sit in other functions.
  const companyActiveDepts = new Set(records
    .filter(r => r.active && !r.isIntern).map(r => r.dept).filter(Boolean));
  const ghostDepts = [...new Set(regulars
    .filter(r => r.termDate && r.dept && !companyActiveDepts.has(r.dept))
    .map(r => r.dept))].sort();

  return {
    scope, currency: mode,
    sections: [
      secScope_(regulars, active, scope, mode, activeInterns.length,
        ctx.anchored ? asOfIso : null, noteInProgress_(windows, asOfIso)),
      secFyStory_(moves, attr, levers, tccMoves, windows, mode, cfg, asOfIso, matched, allMoves),
      secComposition_(buildComposition_(active, ctx.asOf), !!ctx.anchored,
        scope === "company" ? buildLocationTable_(active) : null),
      secCompStructure_(buildCompStructure_(active, mode.mode, cfg), mode, cfg),
      secMovement_(moves, coverage, windows, asOfIso, internFlow),
      secAttritionDetail_(attr, cfg, coverage, windows, asOfIso, ghostDepts),
      secLevers_(levers, mode, coverage, cfg, windows, asOfIso),
      secFlags_(compaBandCounts_(compaGroups, cfg),
                cfg.MARKET_ENABLED ? marketGapCounts_(active, benchMap, cfg) : null,
                buildEquityCounts_(active, cfg, ctx.asOf), cfg),
    ],
    // Compact stats reused by the board brief's location matrix.
    stats: {
      headcount: active.length,
      moves, attr, levers,
    },
  };
}

// ── View B — Board brief computed layer — spec §7 ───────────────────────────

/**
 * Regretted-leaver crosstab: level × tenure bucket × reason across the
 * SELECTED FY windows — membership is tested per window (never first-start to
 * last-end) so a non-adjacent selection like FY25 + FY27 never leaks FY26.
 */
function buildRetentionCrosstab_(records, fys) {
  const m = new Map();
  records.forEach(r => {
    if (!r.termDate) return;
    if (!fys.some(fy => r.termDate >= fy.start && r.termDate <= fy.end)) return;
    if (!/yes|true/i.test(String(r.termRegretted || ""))) return;
    const key = [r.level, tenureBucket_(tenureYears_(r.hireDate, r.termDate)),
                 r.termReason || "—"].join("||");
    m.set(key, (m.get(key) || 0) + 1);
  });
  return [...m.entries()].map(([k, count]) => {
    const p = k.split("||");
    return { level: p[0], tenureBucket: p[1], reason: p[2], count };
  }).sort((a, b) => b.count - a.count ||
      levelRank_(a.level) - levelRank_(b.level));
}

/**
 * Structural-risk candidates — spec §7.7. COMPUTED candidates only; the AI
 * may select and phrase around these but can never add one.
 * @param {string} curCode - currency the band averages are stated in.
 */
function buildStructuralRisks_(active, records, fys, ctx, cfg, compStructure, curCode) {
  const out = [];
  compStructure.inversions.forEach(inv => {
    // Within-location inversions (multi-currency scopes) carry their own
    // location + local currency — never relabel them in the blended code.
    const invCode = inv.currency || curCode;
    out.push({
      id: "inversion-" + (inv.location ? inv.location + "-" : "") +
        inv.mLevel + "-" + inv.icLevel, kind: "inversion",
      title: "Salary inversion " + inv.mLevel + " vs " + inv.icLevel +
        (inv.location ? " within " + inv.location : "") +
        (inv.crossFamilyOnly ? " (cross-family — verify)" : ""),
      detail: inv.mLevel + " band average (" + fmtMoneyShort_(inv.mAvg, invCode) +
        ") sits below the " + inv.icLevel + " band average (" +
        fmtMoneyShort_(inv.icAvg, invCode) + "). Investigation trigger: " +
        (inv.withinGroups && inv.withinGroups.length
          ? "the pattern holds inside " + inv.withinGroups.join(", ") +
            " — a genuine inversion candidate."
          : "the bands never invert within a single " + (inv.dimLabel || "department") +
            " — likely a job-family market-rate mix; verify before treating as an equity issue."),
    });
  });
  const total = active.length;
  if (total > 0) {
    const byDept = new Map();
    active.forEach(r => {
      const k = r.dept || "—";
      byDept.set(k, (byDept.get(k) || 0) + 1);
    });
    const top = [...byDept.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = top[1] / total * 100;
    if (share >= cfg.FUNC_CONC_PCT) {
      out.push({
        id: "func-concentration", kind: "concentration",
        title: "Function concentration in " + top[0],
        detail: top[0] + " holds " + fmtInt_(top[1]) + " of " + fmtInt_(total) +
          " active employees (" + Math.round(share) + "% — threshold " + cfg.FUNC_CONC_PCT + "%).",
      });
    }
    const buckets = new Map();
    active.forEach(r => {
      const b = tenureBucket_(tenureYears_(r.hireDate, ctx.asOf));
      buckets.set(b, (buckets.get(b) || 0) + 1);
    });
    const topB = [...buckets.entries()].filter(([k]) => k !== "unknown")
      .sort((a, b) => b[1] - a[1])[0];
    if (topB && topB[1] / total * 100 >= cfg.TENURE_CONC_PCT) {
      out.push({
        id: "tenure-concentration", kind: "concentration",
        title: "Tenure concentration at " + topB[0],
        detail: fmtInt_(topB[1]) + " of " + fmtInt_(total) + " active employees (" +
          Math.round(topB[1] / total * 100) + "%) sit in the " + topB[0] +
          " tenure bucket (threshold " + cfg.TENURE_CONC_PCT + "%).",
      });
    }
  }
  // Mid-level flight — exit share at I3–I4 in the current FY.
  const cur = fys[fys.length - 1];
  const exits = records.filter(r => r.termDate && r.termDate >= cur.start && r.termDate <= cur.end);
  const mid = exits.filter(r => cfg.MIDLEVEL_RE.test(r.level)).length;
  if (exits.length >= cfg.MIDLEVEL_MIN_EXITS && mid / exits.length * 100 >= cfg.MIDLEVEL_FLIGHT_PCT) {
    out.push({
      id: "midlevel-flight", kind: "flight",
      title: "Mid-level flight (I3–I4)",
      detail: fmtInt_(mid) + " of " + fmtInt_(exits.length) + " " + cur.label +
        " exits (" + Math.round(mid / exits.length * 100) + "%) are at I3–I4 (threshold " +
        cfg.MIDLEVEL_FLIGHT_PCT + "%).",
    });
  }
  return out;
}

/**
 * Spotlight rows + per-group computed flag candidates. Company scope groups
 * by Key Location; a single-country brief groups by Department instead. The
 * AI selects ONE flag per group from `candidates` only (enforced server-side
 * in validateNarrative_).
 * @param {{field: string, label: string}} dim - grouping dimension.
 * @param {{mode: string, code: string}} mode - currency mode for avg comp.
 */
function buildSpotlights_(records, histByEmp, fys, ctx, cfg, dim, mode) {
  const cur = fys[fys.length - 1];
  const compOf = r => tccOf_(r, mode.mode);
  const keys = [...new Set(records.filter(r => r.active)
    .map(r => r[dim.field]).filter(Boolean))].sort();
  const scopeMove = fyMovement_(records, cur, ctx.asOf);
  const scopeActive = records.filter(r => r.active).length;
  const scopePromos = countPromosInFy_(records, histByEmp, cur, cfg);
  const scopePromoRate = scopeActive > 0 ? scopePromos / scopeActive : null;
  return keys.map(k => {
    const inGrp = records.filter(r => r[dim.field] === k);
    const active = inGrp.filter(r => r.active);
    const move = fyMovement_(inGrp, cur, ctx.asOf);
    const attr = fyAttritionStats_(inGrp, cur, ctx.asOf);
    const comp = active.map(compOf).filter(v => v > 0);
    const promos = countPromosInFy_(inGrp, histByEmp, cur, cfg);
    const promoRate = active.length > 0 ? promos / active.length : null;
    const bands = buildCompStructure_(active, mode.mode, cfg);
    const candidates = [];
    if (move.rate != null && scopeMove.rate != null && move.rate > scopeMove.rate) {
      candidates.push("Attrition above the scope rate (" + fmtPct_(move.rate) +
        " vs " + fmtPct_(scopeMove.rate) + ").");
    }
    if (attr.exits > 0 && attr.regrettedPct != null &&
        attr.regrettedPct * 100 >= cfg.RISK_REGRET_PCT) {
      candidates.push("Regretted share of exits at " + fmtPct_(attr.regrettedPct, 0) +
        " (threshold " + cfg.RISK_REGRET_PCT + "%).");
    }
    if (bands.inversions.length) {
      candidates.push("Salary inversion present (" +
        bands.inversions.map(i => i.mLevel + "<" + i.icLevel).join(", ") + ").");
    }
    if (promoRate != null && scopePromoRate != null && promoRate < scopePromoRate) {
      candidates.push("Promotion rate below the scope rate (" + fmtPct_(promoRate) +
        " vs " + fmtPct_(scopePromoRate) + ").");
    }
    if (!candidates.length) candidates.push("Steady state — no computed flag this period.");
    return {
      key: k,
      headcount: active.length,
      attritionRate: move.rate,
      regrettedPct: attr.regrettedPct,
      avgComp: comp.length
        ? Math.round(comp.reduce((t, x) => t + x, 0) / comp.length) : null,
      promoRate,
      candidates,
    };
  });
}

function countPromosInFy_(records, histByEmp, fy, cfg) {
  let n = 0;
  [...new Set(records.map(r => r.empNo).filter(Boolean))].forEach(emp => {
    (histByEmp[emp] || []).forEach(e => {
      if (e.date instanceof Date && !isNaN(e.date) &&
          e.date >= fy.start && e.date <= fy.end &&
          classifyLever_(e.reason, cfg) === "promo") n++;
    });
  });
  return n;
}

/**
 * View B — board-brief aggregates (spec §7), for the COMPANY or for a single
 * country (sample: Chile). A country brief spotlights DEPARTMENTS instead of
 * locations and states comp in the scope currency. Sections 2, 8-flags and 9
 * are AI-filled client-side via getBriefNarrative; everything here is math.
 * @param {Object[]} scopeRecords - records already narrowed to the scope.
 */
function buildBrief_(scopeRecords, histByEmp, fys, ctx, cfg, report, allScopes) {
  const scope = report.scope;
  const mode = report.currency;
  const dim = scope === "company"
    ? { field: "keyLocation", label: "Location" }
    : { field: "dept", label: "Department" };
  // Board story = regular employees only; interns surface as one glance count.
  const regulars = scopeRecords.filter(r => !r.isIntern);
  const activeInterns = scopeRecords.filter(r => r.isIntern && r.active).length;
  const active = regulars.filter(r => r.active);
  const comp = active.map(r => tccOf_(r, mode.mode)).filter(v => v > 0);
  const byLoc = new Map(), byDept = new Map();
  active.forEach(r => {
    const l = r.keyLocation || "—", d = r.dept || "—";
    byLoc.set(l, (byLoc.get(l) || 0) + 1);
    byDept.set(d, (byDept.get(d) || 0) + 1);
  });
  const byGroupKeys = [...new Set(active.map(r => r[dim.field] || "—"))].sort();
  const moveByGroup = byGroupKeys.map(k => {
    const inGrp = regulars.filter(r => (r[dim.field] || "—") === k);
    return {
      key: k,
      perFy: fys.map(fy => {
        const m = fyMovement_(inGrp, fy, ctx.asOf);
        const a = fyAttritionStats_(inGrp, fy, ctx.asOf);
        return { label: fy.label, hires: m.hires, exits: m.exits, net: m.net,
                 rate: m.rate, regrettedPct: a.regrettedPct };
      }),
    };
  });
  const cs = buildCompStructure_(active, mode.mode, cfg);
  return {
    scope,
    dim,
    currency: { mode: mode.mode, code: mode.code },
    glance: {
      headcount: active.length,
      interns: activeInterns,
      byLocation: [...byLoc.entries()].map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      byDept: [...byDept.entries()].map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count),
      tccEnvelope: comp.length ? Math.round(comp.reduce((t, x) => t + x, 0)) : null,
      missingComp: active.length - comp.length,
    },
    movement: {
      scopeTotals: report.stats.moves,
      regrettedTrend: report.stats.attr.map(a => ({
        label: a.label, regretted: a.regretted, exits: a.exits, pct: a.regrettedPct,
      })),
      byGroup: moveByGroup,
    },
    retention: buildRetentionCrosstab_(regulars, fys),
    levers: report.stats.levers,
    structuralRisks: buildStructuralRisks_(active, regulars, fys, ctx, cfg, cs, mode.code),
    spotlights: buildSpotlights_(regulars, histByEmp, fys, ctx, cfg, dim, mode),
    appendix: allScopes,
  };
}

// ── Chart + Confluence rendering (pure) ─────────────────────────────────────

/**
 * Text rendering of a section bar chart — ▇-glyph bars scale to the max value
 * so the shape survives in Docs and Confluence, where the CSS bars can't.
 */
function chartAsTable_(chart) {
  const max = Math.max.apply(null, chart.bars.map(b => b.value).concat([1]));
  return {
    title: chart.title,
    headers: ["Bucket", "", "Headcount"],
    rows: chart.bars.map(b => [
      b.label,
      "▇".repeat(Math.max(b.value > 0 ? 1 : 0, Math.round(b.value / max * 18))),
      b.value,
    ]),
  };
}

// Confluence-paste HTML — the report equivalent of PS_Post's ADF idiom:
// bold colored badge tokens, native tables, ▇ bar charts. Copied to the
// clipboard as text/html, the Confluence editor converts it to native
// headings/tables on paste.

const CONF_BADGE_COLORS_ = { FACT: "#1B5E20", ASSUMPTION: "#0D3B8C", RISK: "#B71C1C", NOTE: "#5E6C84" };

function confEsc_(s) {
  return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function confLine_(l) {
  return '<p><strong style="color:' + (CONF_BADGE_COLORS_[l.badge] || CONF_BADGE_COLORS_.NOTE) +
    '">[' + confEsc_(l.badge) + ']</strong> ' + confEsc_(l.text) + "</p>";
}

function confTable_(t) {
  return "<p><strong>" + confEsc_(t.title) + "</strong></p>" +
    "<table><tbody><tr>" +
    t.headers.map(h => "<th>" + confEsc_(h) + "</th>").join("") + "</tr>" +
    t.rows.map(r => {
      const tot = String(r[0]) === "Total"; // section-shipped Total rows read bold
      return "<tr>" + r.map(c => "<td>" +
        (tot ? "<strong>" + confEsc_(c) + "</strong>" : confEsc_(c)) +
        "</td>").join("") + "</tr>";
    }).join("") +
    "</tbody></table>";
}

/**
 * "Data definitions" appendix — generated LIVE from CONFIG_WR at copy time,
 * so the published Confluence page can never drift from the rules the report
 * actually computed with (docs-as-config, decision 2026-07-23).
 */
function confluenceDefinitionsHtml_() {
  const c = CONFIG_WR;
  let html = "<h2>Appendix — Data definitions (generated from configuration)</h2>" +
    "<p><em>Auto-generated from the report configuration at copy time — these are the " +
    "exact rules behind every figure above. Script-property extensions " +
    "(WR_DEPT_REMAP / WR_REASON_REMAP) apply on top of the tables below.</em></p>";
  html += confTable_({ title: "Population & movement rules",
    headers: ["Rule", "Definition"],
    rows: [
      ["Headline population", "Regular employees — Employee Type: Regular Employee, " +
        "Employer of Record, Part Time. Interns reported separately, never blended; " +
        "crew/contractors excluded by job title."],
      ["Attrition rate", "exits ÷ mean(opening, closing headcount); the in-progress FY " +
        "closes at the extraction date."],
      ["Headcount instants", "opening = start of day (hired strictly before, not yet " +
        "terminated); closing = end of day — so closing = opening + hires − exits holds " +
        "by construction."],
      ["Hires / exits", "counted by Hire Date / Termination-Release Date inside the " +
        "fiscal window (FY starts 1 Jul)."],
      ["Fiscal-year story / comparison", "one selected year tells that year's story; " +
        "two or more compare consecutive pairs — attrition moves ≥ " + c.COMPARE_ATTR_PP +
        " pp and regretted-share moves ≥ " + c.COMPARE_REGRET_PP + " pp read as verdicts, " +
        "smaller moves as held steady. The in-progress year is judged against the prior " +
        "year's SAME-PERIOD slice (equal elapsed span), never against a full year."],
      ["TCC impact of movement", "hires and exits priced at each person's latest recorded " +
        "TCC — an annualized cost-structure lens, not payroll actuals."],
      ["Raise totals (multi-currency scopes)", "each comp event's delta converts at the " +
        "employee's current TCC USD ÷ local TCC rate; historical FX is not recorded. " +
        "Growth percentages are always computed in local currency — FX-clean."],
      ["Comparison rule", "band-vs-band and person-vs-anchor comparisons are made WITHIN " +
        "one location (or as a compa-ratio to a local anchor). Blended multi-currency " +
        "USD averages are cost/budget figures only — they move with geography mix and " +
        "never fire equity flags."],
      ["FX lineage", "USD figures come from the roster TCC USD column, the conversion " +
        "source of record; rate basis and as-of date are owned by the roster pipeline. " +
        "A frozen plan rate for FY-over-FY USD comparison is a pending data-side " +
        "improvement."],
      ["All-employee-types tie-out", "story and comparison views also state headcount " +
        "including the intern/fixed-term strand — the figure that matches headcount " +
        "reports counting every roster row."],
      ["Snapshot anchor", "population, composition, compensation-structure and flag " +
        "sections are anchored to the END of the selected period — the extraction date " +
        "while the in-progress fiscal year is selected, otherwise the last selected " +
        "period's closing date. Compensation at the anchor uses each person's latest " +
        "recorded TCC."],
      ["Job family", "Job Title numeric prefix → JF + zero-padded prefix " +
        "(04.I3.1 → JF004, 18.M4.3 → JF018)" +
        (Object.keys(c.JOB_FAMILY_MAP).length
          ? "; exceptions: " + Object.keys(c.JOB_FAMILY_MAP)
              .map(k => k + " → " + c.JOB_FAMILY_MAP[k]).join(", ")
          : "") + "."],
      ["Regretted exit", "the roster's 'Termination Regretted' flag as recorded by " +
        "People at exit — never inferred by the report."],
      ["Exit-reason taxonomy", (c.VALID_EXIT_REASONS || []).join(", ") +
        ". Voluntary Other = voluntary exits not classified under a more specific reason."],
      ["Internal anchor", c.MARKET_ENABLED
        ? "per Key Location + Job Title: title-peer median → market mean for one-of-a-kind roles → level-cohort median."
        : "per Key Location + Job Title: title-peer median → level-cohort median. Internal " +
          "salary mid-point evaluation only — market competitiveness returns as a dedicated " +
          "market-calibration view once the benchmark compilation is complete."],
    ] });
  html += confTable_({ title: "Compensation lever classification (TCC Change Reason)",
    headers: ["Lever", "Reasons"],
    rows: [
      ["Promotions", "Promotion, Microband Promotion"],
      ["Adjustments", "Every other recorded reason (Annual Adjustment, Microband " +
        "Adjustment, Market Calibration, …) — catch-all, new flavors never drop"],
      ["New hires", "New Hire — classified separately, reported under Workforce movement"],
      ["Excluded", "Internal Transfer, Historical Data Update, blank reasons"],
      ["No prior record", "events lacking an earlier comp record count as events but are " +
        "excluded from raise totals and growth"],
      ["Recognition read", "total recognition events = promotions + adjustments; a promotions " +
        "drop offset by adjustments is a lever-mix change, not under-recognition — RISK fires " +
        "only when total recognition falls alongside fewer promotions"],
    ] });
  html += confTable_({ title: "Department consolidation (historical → current)",
    headers: ["Historical department", "Maps to"],
    rows: Object.keys(c.DEPT_REMAP).sort().map(k => [k, c.DEPT_REMAP[k]]) });
  html += confTable_({ title: "Exit-reason consolidation",
    headers: ["Historical reason", "Current classification"],
    rows: Object.keys(c.REASON_REMAP).sort().map(k => [k, c.REASON_REMAP[k]]) });
  const thresholds = [
    ["Regretted-share RISK", c.RISK_REGRET_PCT + "%", "regretted share of exits at/above this fires a RISK line"],
    ["Single-reason RISK", Math.round(c.RISK_REASON_SHARE * 100) + "%", "one recorded reason covering this share of exits fires a RISK line"],
    ["Internal position bands", fmtPct_(c.COMPA_LOW_MIN, 0) + " / " + fmtPct_(c.COMPA_TARGET_MIN, 0) + " / " + fmtPct_(c.COMPA_HIGH_MAX, 0), "below-low / target-from / above-high vs the internal anchor"],
    ["Small-group floor", String(c.SMALL_GROUP_MIN), "groups below this size suppress averages and equity lenses"],
    ["Senior-IC inversion floor", "I" + c.SENIOR_IC_MIN + "+", "manager bands compare against IC bands at/above this level"],
    ["Concentration flags", c.FUNC_CONC_PCT + "% / " + c.TENURE_CONC_PCT + "% / " + c.MIDLEVEL_FLIGHT_PCT + "%", "function share / tenure-bucket share / mid-level (I3–I4) exit share"],
  ];
  if (c.MARKET_ENABLED) {
    thresholds.splice(3, 0,
      ["Market-gap flag", fmtPct_(c.MARKET_LOW, 0), "TCC below this share of the external market mean"]);
  }
  html += confTable_({ title: "Thresholds & flags",
    headers: ["Threshold", "Value", "Meaning"], rows: thresholds });
  return html;
}

/** View A as Confluence-paste HTML. */
function confluenceReportHtml_(payload) {
  const m = payload.meta, r = payload.report;
  const scopeLabel = m.scope === "company" ? "ServiceRocket" : m.scope;
  return "<h1>" + confEsc_(scopeLabel + " Workforce & Compensation Report") + "</h1>" +
    "<p><em>" + confEsc_(m.fys.map(f => f.label).join(" · ") +
      (m.quarter ? " · Q" + m.quarter + " view" : "") +
      " · data extracted on " + m.asOf + " · figures in " + r.currency.code) + "</em></p>" +
    r.sections.map(s =>
      "<h2>" + confEsc_(s.title.replace(" · ", ". ")) + "</h2>" +
      s.lines.map(confLine_).join("") +
      (s.charts || []).map(ch => confTable_(chartAsTable_(ch))).join("") +
      (s.tables || []).map(confTable_).join("")).join("") +
    confluenceDefinitionsHtml_();
}

/** View B as Confluence-paste HTML (AI text only when already generated). */
function confluenceBriefHtml_(payload, narrative) {
  const m = payload.meta, b = payload.brief;
  const fyNow = m.fys[m.fys.length - 1].label;
  const cur = b.currency.code;
  let html = "<h1>" + confEsc_((b.scope === "company" ? "Global" : b.scope) +
      " Workforce & Compensation Review · " + fyNow) + "</h1>" +
    "<p><em>" + confEsc_("ServiceRocket · " + m.fys.map(f => f.label).join(" – ") +
      " · data extracted on " + m.asOf + " · figures in " + cur) + "</em></p>";
  html += "<h2>2. Executive summary</h2>";
  html += (narrative && narrative.execSummary.length)
    ? "<p><em>✨ AI synthesis — figures come from the computed report.</em></p><ul>" +
      narrative.execSummary.map(s => "<li>" + confEsc_(s) + "</li>").join("") + "</ul>"
    : confLine_(note_("AI synthesis not generated at copy time."));
  html += "<h2>3. " + confEsc_(b.scope === "company" ? "Company" : b.scope) + " at a glance</h2>" +
    confLine_(fact_(fmtInt_(b.glance.headcount) + " active regular employees" +
      (b.glance.interns ? " (+" + fmtInt_(b.glance.interns) + " interns, reported separately)" : "") +
      "; TCC envelope " + fmtMoneyShort_(b.glance.tccEnvelope, cur) + "."));
  if (b.glance.byLocation.length > 1) {
    html += confTable_({ title: "Headcount by location", headers: ["Key Location", "Headcount"],
      rows: b.glance.byLocation.map(x => [x.key, x.count]) });
  }
  html += confTable_({ title: "Headcount by function", headers: ["Department", "Headcount"],
    rows: b.glance.byDept.map(x => [x.key, x.count]) });
  html += "<h2>4. Movement & attrition</h2>" +
    confTable_({ title: "Movement by fiscal year",
      headers: ["FY", "Hires", "Exits", "Net", "Attrition rate"],
      rows: b.movement.scopeTotals.map(x => [x.label + (x.inProgress ? " (to date)" : ""),
        x.hires, x.exits, (x.net >= 0 ? "+" : "") + x.net, fmtPct_(x.rate)]) }) +
    confTable_({ title: "Regretted-attrition trend",
      headers: ["FY", "Regretted", "Exits", "Regretted share"],
      rows: b.movement.regrettedTrend.map(t => [t.label, t.regretted, t.exits, fmtPct_(t.pct, 0)]) }) +
    confTable_({ title: "Per-" + b.dim.label.toLowerCase() + " matrix",
      headers: [b.dim.label].concat(m.fys.map(f => f.label + " exits (rate)")),
      rows: b.movement.byGroup.map(L => [L.key].concat(
        L.perFy.map(p => p.exits + " (" + fmtPct_(p.rate) + ")"))) });
  html += "<h2>5. The retention signal</h2>" +
    (b.retention.length
      ? confTable_({ title: "Regretted leavers: level × tenure × reason",
          headers: ["Level", "Tenure", "Reason", "Count"],
          rows: b.retention.map(x => [x.level, x.tenureBucket, x.reason, x.count]) })
      : confLine_(note_("No regretted exits recorded in the window.")));
  html += "<h2>6. Compensation strategy</h2>" +
    confTable_({ title: "Growth by lever",
      headers: ["FY", "Promotions", "Promo growth", "Adjustments", "Adjustment growth"],
      rows: b.levers.map(v => [v.label + (v.inProgress ? " (to date)" : ""),
        v.promo.count, fmtPct_(v.promo.growthPct), v.adjust.count,
        fmtPct_(v.adjust.growthPct)]) });
  html += "<h2>7. Structural risks</h2>" +
    (b.structuralRisks.length
      ? b.structuralRisks.map(x => confLine_(risk_(x.title + " — " + x.detail))).join("")
      : confLine_(note_("No structural-risk candidate fired at current thresholds.")));
  html += "<h2>8. " + confEsc_(b.dim.label) + " spotlights</h2>" +
    confTable_({ title: "Comparison matrix (" + fyNow + ")",
      headers: [b.dim.label, "Headcount", "Attrition", "Regretted", "Avg TCC (" + cur + ")", "Promo rate", "Flag"],
      rows: b.spotlights.map(s => [s.key, s.headcount, fmtPct_(s.attritionRate),
        fmtPct_(s.regrettedPct, 0), fmtMoneyShort_(s.avgComp, ""), fmtPct_(s.promoRate),
        (narrative && narrative.spotlightFlags && narrative.spotlightFlags[s.key]) || s.candidates[0]]) });
  html += "<h2>9. Decisions for the board</h2>";
  html += (narrative && narrative.decisions.length)
    ? "<p><em>✨ AI-generated draft for discussion — not a recommendation of record.</em></p><ul>" +
      narrative.decisions.map(dd => "<li><strong>" + confEsc_(dd.title) + "</strong>" +
        (dd.rationale ? " — " + confEsc_(dd.rationale) : "") + "</li>").join("") + "</ul>"
    : confLine_(note_("AI draft not generated at copy time."));
  html += confluenceDefinitionsHtml_();
  return html;
}

// ── AI narrative contract — spec §8 ─────────────────────────────────────────
// Prompt receives computed FY aggregates ONLY (counts, rates, deltas, the
// candidate list) — never names, emails, or per-person TCC.

function promptForBrief_(brief, meta) {
  const j = o => JSON.stringify(o);
  const scopeLabel = brief.scope === "company"
    ? "the whole company" : "the " + brief.scope + " entity";
  const dimWord = brief.dim.label.toLowerCase();
  return [
    "You are drafting interpretive text for a board-level Workforce & Compensation " +
    "Review of " + scopeLabel + " covering " + meta.fys.map(f => f.label).join(", ") +
    " (data as of " + meta.asOf + "). Fiscal years start July 1. Monetary figures are " +
    brief.currency.code + ".",
    "STRICT RULES: cite only figures provided below; never invent or recompute a number; " +
    "frame interpretation as risk or observation, never as certainty; " +
    "British-neutral business register; no names of individuals.",
    "",
    "SCOPE AT A GLANCE: " + j(brief.glance),
    "MOVEMENT & ATTRITION (scope + per-" + dimWord + "): " + j(brief.movement),
    "REGRETTED-LOSS CROSSTAB (level × tenure × reason): " + j(brief.retention.slice(0, 20)),
    "COMPENSATION LEVERS PER FY: " + j(brief.levers),
    "STRUCTURAL RISK CANDIDATES (the only risks you may reference): " + j(brief.structuralRisks),
    brief.dim.label.toUpperCase() + " SPOTLIGHTS with computed flag candidates: " + j(brief.spotlights),
    "",
    "Return ONLY a JSON object, no markdown fences, with exactly these keys:",
    '{"execSummary": [3-4 headline-signal sentences],',
    ' "spotlightFlags": {<' + dimWord + '>: <ONE flag chosen VERBATIM from that ' + dimWord + "'s candidates>},",
    ' "decisions": [2-3 items of {"title": short imperative, "rationale": 1-2 sentences citing provided figures}]}',
  ].join("\n");
}

/**
 * Server-side enforcement of the AI contract: spotlight flags must be VERBATIM
 * members of the computed candidate list; shapes are coerced, junk dropped.
 * @returns {{execSummary: string[], spotlightFlags: Object, decisions: Array}|null}
 */
function validateNarrative_(obj, brief) {
  if (!obj || typeof obj !== "object") return null;
  const execSummary = Array.isArray(obj.execSummary)
    ? obj.execSummary.filter(s => typeof s === "string" && s.trim()).slice(0, 4) : [];
  const spotlightFlags = {};
  const byKey = {};
  (brief.spotlights || []).forEach(s => { byKey[s.key] = s.candidates; });
  if (obj.spotlightFlags && typeof obj.spotlightFlags === "object") {
    Object.keys(obj.spotlightFlags).forEach(k => {
      const v = obj.spotlightFlags[k];
      if (byKey[k] && byKey[k].indexOf(v) !== -1) spotlightFlags[k] = v;
    });
  }
  // A group the model skipped or corrupted falls back to its first candidate.
  Object.keys(byKey).forEach(k => {
    if (!spotlightFlags[k]) spotlightFlags[k] = byKey[k][0];
  });
  const decisions = Array.isArray(obj.decisions)
    ? obj.decisions
        .filter(d => d && typeof d.title === "string" && d.title.trim())
        .map(d => ({ title: String(d.title).trim(),
                     rationale: typeof d.rationale === "string" ? d.rationale.trim() : "" }))
        .slice(0, 3)
    : [];
  if (!execSummary.length && !decisions.length) return null;
  return { execSummary, spotlightFlags, decisions };
}

/**
 * FY selection: users pick ANY combination of the available fiscal years
 * (FY25 / FY26 / FY27 toggles — 1, 2 or 3 at a time, adjacency optional).
 * Accepted specs: "25,27"-style csv of 2-digit FY numbers (the toggle UI),
 * plus legacy forms — "3"/"2"/"1" trailing windows and "c2" (closed years).
 * An empty/unknown spec = all available FYs.
 * @returns {{all: Array, fys: Array}} available windows + the selected subset.
 */
function selectFys_(ctx, cfg, fyRange) {
  const all = fyListWR_(ctx.asOf, cfg.FY_COUNT);
  const s = String(fyRange == null ? "" : fyRange).trim().toLowerCase();
  let sel = all;
  if (s === "c2") {
    sel = all.filter(f => !f.inProgress);
  } else if (s === "1" || s === "2" || s === "3") {
    sel = all.slice(all.length - parseInt(s, 10));
  } else if (/^\d{2}(,\d{2})*$/.test(s)) {
    const want = new Set(s.split(",").map(x => parseInt(x, 10)));
    sel = all.filter(f => want.has((f.startCalYear + 1) % 100));
  }
  return { all, fys: sel.length ? sel : all };
}

/** Canonical wire form of a selection: "all" or "25,27". Pure — cache keys + meta echo. */
function fyRangeCanon_(all, fys) {
  return fys.length === all.length
    ? "all"
    : fys.map(f => (f.startCalYear + 1) % 100).join(",");
}

/**
 * Full payload for one scope — spec §3 data flow.
 * @param {number} [quarter] - 1–4 applies the quarterly filter to the
 *   time-based sections (Q<n> of every FY, not-yet-started quarters dropped);
 *   anything else = full fiscal years.
 * @param {(number|string)} [fyRange] - see selectFys_ (csv toggles + legacy).
 * @returns {Object} {ok, meta, report, brief?} — brief for ANY scope (company
 *   or a single country) when no quarterly filter is active (the board story
 *   is told in full FYs).
 */
function buildReportPayload_(records, histByEmp, benchMap, scope, ctx, cfg, quarter, fyRange) {
  const fySel = selectFys_(ctx, cfg, fyRange);
  const fys = fySel.fys;
  const q = (quarter >= 1 && quarter <= 4) ? Math.floor(quarter) : 0;
  const qWindows = q ? fys.map(fy => fyQuarterWindow_(fy, q, ctx.asOf)) : null;
  const windows = q ? qWindows.filter(w => w.started) : fys;
  // Coverage guards always judge the FULL first FY — a quarter view narrows
  // the reporting window, not the depth question.
  const coverage = coverageStats_(records, histByEmp, fys);
  // Snapshot anchor (user directive 2026-07-23): the report is a photograph
  // taken at the END of the selected period. While the selection includes the
  // in-progress window, the anchor is the extraction date (live behavior);
  // a fully closed selection re-anchors EVERYTHING downstream — population,
  // composition, compensation structure, flags, brief — so "FY25" reads as
  // the company as it stood on 30 Jun 2025. Movement/attrition figures are
  // window-driven and unaffected. The scope dropdown (meta.scopes) stays on
  // today's roster so navigation never shifts under the reader.
  const lastW = windows[windows.length - 1];
  const anchored = !!(lastW && !lastW.inProgress);
  const view = anchored ? rosterAsAt_(records, lastW.end) : records;
  const viewCtx = anchored
    ? Object.assign({}, ctx, { asOf: lastW.end, anchored: true }) : ctx;
  const report = buildLocationReport_(view, histByEmp, benchMap, scope, windows, viewCtx, cfg, coverage);
  const scopes = [...new Set(records.filter(r => r.active).map(r => r.keyLocation).filter(Boolean))].sort();
  const payload = {
    ok: true,
    meta: {
      scope,
      scopes,
      quarter: q,
      quarterSkipped: q ? qWindows.filter(w => !w.started).map(w => w.label) : [],
      fyCount: fys.length,
      fyRange: fyRangeCanon_(fySel.all, fys),
      availableFys: fySel.all.map(f => ({ label: f.label, num: (f.startCalYear + 1) % 100 })),
      asOf: isoDate_(ctx.asOf),
      anchor: anchored ? isoDate_(lastW.end) : null,
      build: cfg.BUILD,
      fys: fys.map(f => ({ label: f.label, startCalYear: f.startCalYear, inProgress: f.inProgress })),
      currency: report.currency,
      coverage: {
        earliestTermDate: coverage.earliestTermDate,
        earliestCompEvent: coverage.earliestCompEvent,
        firstFyTermGuard: coverage.firstFyTermGuard,
        firstFyLeverGuard: coverage.firstFyLeverGuard,
      },
      // Threshold echoes — the client documents from these, never its own literals.
      cfg: {
        compaBands: { low: cfg.COMPA_LOW_MIN, target: cfg.COMPA_TARGET_MIN, high: cfg.COMPA_HIGH_MAX },
        marketLow: cfg.MARKET_LOW,
        riskRegretPct: cfg.RISK_REGRET_PCT,
        smallGroupMin: cfg.SMALL_GROUP_MIN,
      },
    },
    report: { scope: report.scope, currency: report.currency, sections: report.sections },
  };
  if (!q) {
    const scopeRecords = scope === "company"
      ? view : view.filter(r => r.keyLocation === scope);
    payload.brief = buildBrief_(scopeRecords, histByEmp, fys, viewCtx, cfg, report, scopes);
  }
  return payload;
}

// ============================================================
// GAS LAYER — everything below touches GAS services.
// Nothing below this line is exercised by the Node test harness.
// ============================================================

function log_(msg) { if (CONFIG_WR.DEBUG) Logger.log(msg); }

function props_() { return PropertiesService.getScriptProperties(); }

function ssIdsWR_() {
  const p = props_();
  return {
    roster:    p.getProperty("WR_ROSTER_SS_ID")    || CONFIG_WR.ROSTER_SS_ID,
    hist:      p.getProperty("WR_COMP_HIST_SS_ID") || CONFIG_WR.COMP_HIST_SS_ID,
    bench:     p.getProperty("WR_BENCH_SS_ID")     || CONFIG_WR.BENCH_SS_ID,
    rosterTab: p.getProperty("WR_ROSTER_TAB")      || CONFIG_WR.ROSTER_TAB,
    histTab:   p.getProperty("WR_HIST_TAB")        || CONFIG_WR.HIST_TAB,
    benchTab:  p.getProperty("WR_BENCH_TAB")       || CONFIG_WR.BENCH_TAB,
  };
}

// ── Large-payload cache (gzip + chunking) — same pattern as PS / CompDash ───
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

/** Bump WR_CACHE_VER — strands every prior cache entry (all scopes + AI) at once. */
function bustReportCache_() {
  const p = props_();
  const cur = parseInt(p.getProperty("WR_CACHE_VER") || "1", 10);
  p.setProperty("WR_CACHE_VER", String(cur + 1));
  Logger.log("✅ bustReportCache_: WR_CACHE_VER → " + (cur + 1));
}

// ── Sheet readers (header-name access only) ─────────────────────────────────

function fetchTab_(ssId, tabName) {
  const ss = SpreadsheetApp.openById(ssId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    const want = String(tabName).toLowerCase().replace(/\s+/g, " ").trim();
    sh = ss.getSheets().find(s =>
      s.getName().toLowerCase().replace(/\s+/g, " ").trim() === want) || null;
    if (sh) Logger.log('⚠️ fetchTab_: using tab "' + sh.getName() + '" for requested "' + tabName + '"');
  }
  if (!sh) {
    Logger.log('❌ fetchTab_: tab "' + tabName + '" not found — available: ' +
               ss.getSheets().map(s => s.getName()).join(" | "));
    throw new Error('Tab "' + tabName + '" not found (execution log lists available tabs)');
  }
  const values = sh.getDataRange().getValues();
  const headers = (values.shift() || []).map(h => String(h).trim());
  return { headers, rows: values };
}

function colIdx_(headers, name, re) {
  let i = headers.indexOf(name);
  if (i === -1 && re) i = headers.findIndex(h => re.test(h));
  return i;
}

/** @returns {{records: Object[], genderAvailable: boolean, tccUsdAvailable: boolean}} normalized roster (crew excluded). */
function readRosterWR_() {
  const ids = ssIdsWR_();
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
    gender: col("Gender"),
    empType: col("Employee Type"), // Intern | Regular Employee | Employer of Record | Part Time
    tccUsd: col(CONFIG_WR.TCC_USD_COL, /tcc.*usd/i),
  };
  const required = { empNo: c.empNo, name: c.name, title: c.title, keyLoc: c.keyLoc };
  Object.keys(required).forEach(k => {
    if (required[k] === -1) throw new Error("Roster column missing: " + k);
  });
  const genderAvailable = c.gender !== -1;
  const tccUsdAvailable = c.tccUsd !== -1;
  const empTypeAvailable = c.empType !== -1;
  // Effective remaps = code defaults + Script Property JSON (property wins) —
  // new department merges or reason consolidations never need a code deploy.
  const propMap = (prop, base) => {
    const map = Object.assign({}, base);
    try {
      const extra = props_().getProperty(prop);
      if (extra) Object.assign(map, JSON.parse(extra));
    } catch (e) {
      Logger.log("⚠️ readRosterWR_: " + prop + " property is not valid JSON — ignored (" + e.message + ")");
    }
    return map;
  };
  const deptRemap = propMap("WR_DEPT_REMAP", CONFIG_WR.DEPT_REMAP);
  const reasonRemap = propMap("WR_REASON_REMAP", CONFIG_WR.REASON_REMAP);
  let remapped = 0, reasonRemapped = 0;
  const records = [];
  rows.forEach(row => {
    const name = String(row[c.name] || "").trim();
    if (!name) return;
    const title = String(row[c.title] || "").trim();
    if (CONFIG_WR.CREW_RE.test(title)) return; // crew/contractors out of scope
    const status = c.status !== -1 ? String(row[c.status] || "").trim() : "";
    const termDate = c.term !== -1 ? asDate_(row[c.term]) : null;
    const lvl = parseLevel_(title);
    const empType = empTypeAvailable ? String(row[c.empType] || "").trim() : "";
    const rawDept = c.dept !== -1 ? String(row[c.dept] || "").trim() : "";
    records.push({
      empNo: String(row[c.empNo] || "").trim(),
      name,
      active: !termDate && !CONFIG_WR.INACTIVE_RE.test(status),
      jobTitle: title, level: lvl.level, track: lvl.track,
      jobFamily: parseJobFamily_(title),
      employeeType: empType,
      // Intern is the only non-regular type; Regular Employee, Employer of
      // Record, Part Time (and blank) all count as regular employees.
      isIntern: empTypeAvailable && CONFIG_WR.INTERN_RE.test(empType),
      // Ghost-department remap (renamed/absorbed units live on in leaver rows).
      dept: deptRemap[rawDept] ? (remapped++, deptRemap[rawDept]) : rawDept,
      lob: c.lob !== -1 ? String(row[c.lob] || "").trim() : "",
      keyLocation: String(row[c.keyLoc] || "").trim(),
      location: c.location !== -1 ? String(row[c.location] || "").trim() : "",
      currency: c.currency !== -1 ? String(row[c.currency] || "").trim() : "",
      hireDate: c.hire !== -1 ? asDate_(row[c.hire]) : null,
      termDate,
      termReason: (() => {
        const raw = c.termReason !== -1 ? String(row[c.termReason] || "").trim() : "";
        return reasonRemap[raw] ? (reasonRemapped++, reasonRemap[raw]) : raw;
      })(),
      termCategory: c.termCat !== -1 ? String(row[c.termCat] || "").trim() : "",
      termRegretted: c.termRegret !== -1 ? String(row[c.termRegret] || "").trim() : "",
      gender: genderAvailable ? (String(row[c.gender] || "").trim() || null) : null,
      tcc: c.tcc !== -1 ? asNum_(row[c.tcc]) : null,
      tccUsd: c.tccUsd !== -1 ? asNum_(row[c.tccUsd]) : null,
    });
  });
  log_("readRosterWR_: " + records.length + " records, gender " +
       (genderAvailable ? "available" : "pending") +
       ", TCC USD " + (tccUsdAvailable ? "available" : "pending") +
       ", Employee Type " + (empTypeAvailable ? "available" : "pending") +
       ", dept remap applied to " + remapped + " rows, exit-reason remap to " +
       reasonRemapped + " rows");
  return { records, genderAvailable, tccUsdAvailable, empTypeAvailable, remapped, reasonRemapped };
}

/** @returns {Object<string, Array>} Employee Number → comp events (order NOT guaranteed). */
function readCompHistoryWR_() {
  const ids = ssIdsWR_();
  const { headers, rows } = fetchTab_(ids.hist, ids.histTab);
  const iEmp    = colIdx_(headers, "Employee Number");
  const iDate   = colIdx_(headers, "Effective Date");
  const iTtc    = colIdx_(headers, "Total Target Compensation");
  const iReason = colIdx_(headers, "TCC Change Reason");
  if (iEmp === -1 || iDate === -1 || iTtc === -1) {
    Logger.log("❌ readCompHistoryWR_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("RD tab: required columns missing (see execution log).");
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
      tcc: asNum_(row[iTtc]), // LOCAL Total Target Compensation at the event
    });
  });
  log_("readCompHistoryWR_: " + Object.keys(byEmp).length + " employees with events");
  return byEmp;
}

/** @returns {{map: Object, count: number}} benchmark rows keyed by benchKey_. */
function readBenchmarksWR_() {
  const ids = ssIdsWR_();
  const { headers, rows } = fetchTab_(ids.bench, ids.benchTab);
  const iLoc   = colIdx_(headers, "Location");
  const iTitle = colIdx_(headers, "Job Title");
  const iCur   = colIdx_(headers, "Local Currency");
  const iMean  = colIdx_(headers, "Mean TCC", /mean/i);
  if (iLoc === -1 || iTitle === -1 || iMean === -1) {
    Logger.log("❌ readBenchmarksWR_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Benchmark tab: required columns missing (see execution log).");
  }
  const map = {};
  let count = 0;
  rows.forEach(row => {
    const loc = String(row[iLoc] || "").trim();
    const title = String(row[iTitle] || "").trim();
    const mean = asNum_(row[iMean]);
    if (!loc || !title || mean == null) return;
    map[benchKey_(loc, title)] = {
      mean,
      currency: iCur !== -1 ? String(row[iCur] || "").trim() : "",
    };
    count++;
  });
  log_("readBenchmarksWR_: " + count + " benchmark rows");
  return { map, count };
}

// ── Assembly + web app ──────────────────────────────────────────────────────

function cacheKeyForScope_(scope, quarter, fyRange) {
  const ver = props_().getProperty("WR_CACHE_VER") || "1";
  const slug = scope === "company"
    ? "company" : normWR_(scope).replace(/[^a-z0-9]+/g, "_");
  return CONFIG_WR.CACHE_KEY_PREFIX + "v" + ver + "_" + slug +
    (quarter ? "_q" + quarter : "") +
    (fyRange && fyRange !== "all" ? "_f" + String(fyRange).replace(/[^0-9c]+/g, "_") : "");
}

/** Canonical FY selection ("all" / "25,27") for cache keys — any accepted spec in. */
function sanitizeFyRange_(fyRange) {
  const ctx = fiscalContextWR_();
  const sel = selectFys_(ctx, CONFIG_WR, fyRange);
  return fyRangeCanon_(sel.all, sel.fys);
}

/**
 * Full report payload for one scope. Access-checked server-side (defense in
 * depth — callable directly via google.script.run).
 * @param {string} scope - "company" or a roster Key Location.
 * @param {boolean} force - true bypasses cache (Refresh button).
 * @param {number} [quarter] - 1–4 for the quarterly view; 0/absent = full FYs.
 * @param {(number|string)} [fyRange] - "3"/"2"/"1" trailing FYs, "c2" = closed FYs.
 * @returns {string} JSON string — ViewReport.html parses it client-side
 *   (marshalling a large nested object through the iframe bridge is slow).
 */
function getWorkforceReportData(scope, force, quarter, fyRange) {
  const access = checkReportAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });

  let scopeName = String(scope || "company").trim() || "company";
  const q = (quarter >= 1 && quarter <= 4) ? Math.floor(quarter) : 0;
  const nFy = sanitizeFyRange_(fyRange);
  const cache = CacheService.getScriptCache();
  const key = cacheKeyForScope_(scopeName, q, nFy);
  if (!force) {
    const hit = cacheGetLarge_(cache, key);
    if (hit) {
      const obj = JSON.parse(hit);
      obj.meta.fromCache = true;
      obj.meta.role = access.role;   // never serve the cached builder's identity
      obj.meta.email = access.email;
      return JSON.stringify(obj);
    }
  }

  const t0 = Date.now();
  const ctx = fiscalContextWR_();
  // benchmarks joins sources only while MARKET_ENABLED — a deliberately
  // disabled source must not render as an error banner on the client.
  const sources = { roster: "ok", history: "ok" };
  if (CONFIG_WR.MARKET_ENABLED) sources.benchmarks = "ok";

  let records = [];
  try { records = readRosterWR_().records; }
  catch (e) { sources.roster = "error: " + e.message; Logger.log("❌ readRosterWR_: " + e.message); }
  let histByEmp = {};
  try { histByEmp = readCompHistoryWR_(); }
  catch (e) { sources.history = "error: " + e.message; Logger.log("⚠️ readCompHistoryWR_: " + e.message); }
  let bench = { map: {}, count: 0 };
  if (CONFIG_WR.MARKET_ENABLED) {
    try { bench = readBenchmarksWR_(); }
    catch (e) { sources.benchmarks = "error: " + e.message; Logger.log("⚠️ readBenchmarksWR_: " + e.message); }
  }

  // An unknown scope (stale link, renamed location) degrades to company.
  if (scopeName !== "company" &&
      !records.some(r => r.keyLocation === scopeName)) {
    Logger.log('⚠️ getWorkforceReportData: unknown scope "' + scopeName + '" → company');
    scopeName = "company";
  }

  const payload = buildReportPayload_(records, histByEmp, bench.map, scopeName, ctx, CONFIG_WR, q, nFy);
  payload.meta.generatedAt = new Date().toISOString();
  payload.meta.role = access.role;
  payload.meta.email = access.email;
  payload.meta.fromCache = false;
  payload.meta.sources = sources;
  payload.meta.benchRows = bench.count;

  const json = JSON.stringify(payload);
  cachePutLarge_(cache, cacheKeyForScope_(scopeName, q, nFy), json, CONFIG_WR.CACHE_TTL_SEC);
  Logger.log("✅ getWorkforceReportData(" + scopeName + (q ? " Q" + q : "") +
             (nFy !== "all" ? " fy:" + nFy : "") + "): built in " +
             Math.round((Date.now() - t0) / 1000) + "s — " + json.length + " chars");
  return json;
}

// ── AI narrative — spec §8 ──────────────────────────────────────────────────

/**
 * Board-brief narrative (View B AI blocks) — for the company OR a single
 * country (e.g. Chile). Generated on demand, cached per scope + FY range +
 * WR_CACHE_VER; force = Regenerate. Degrades to {ok:false} — the report
 * renders fully without it (AI is additive, never load-bearing).
 * @returns {string} JSON of {ok, narrative, fromCache} | {ok:false, error}.
 */
function getBriefNarrative(force, scope, fyRange) {
  const access = checkReportAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });

  // Per-user rate limit — same containment pattern as the PS report.
  const RL_MAX = 10, RL_WINDOW = 60;
  const cache = CacheService.getScriptCache();
  const rlKey = "wr_gem_rl_" + (access.email || "anon");
  const rlCount = parseInt(cache.get(rlKey) || "0", 10);
  if (rlCount >= RL_MAX) {
    return JSON.stringify({ ok: false, error: "Rate limit reached — please wait a minute." });
  }
  cache.put(rlKey, String(rlCount + 1), RL_WINDOW);

  // The narrative derives from the same payload the client renders — an
  // unknown scope degrades to company inside getWorkforceReportData.
  const raw = getWorkforceReportData(scope, false, 0, fyRange);
  const payload = JSON.parse(raw);
  if (!payload.ok || !payload.brief) {
    return JSON.stringify({ ok: false, error: "Brief data unavailable for this scope." });
  }

  const aiKey = cacheKeyForScope_(payload.meta.scope, 0, payload.meta.fyRange) + "_ai";
  if (!force) {
    const hit = cacheGetLarge_(cache, aiKey);
    if (hit) {
      const obj = JSON.parse(hit);
      obj.fromCache = true;
      return JSON.stringify(obj);
    }
  }

  const result = callGeminiWR_(promptForBrief_(payload.brief, payload.meta));
  if (!result.ok) return JSON.stringify(result);

  let parsed = null;
  try {
    parsed = JSON.parse(String(result.text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""));
  } catch (e) {
    Logger.log("⚠️ getBriefNarrative: unparseable model output — " + e.message);
  }
  const narrative = validateNarrative_(parsed, payload.brief);
  if (!narrative) return JSON.stringify({ ok: false, error: "Narrative generation failed — try Regenerate." });

  const out = { ok: true, narrative, fromCache: false };
  cachePutLarge_(cache, aiKey, JSON.stringify(out), CONFIG_WR.CACHE_TTL_SEC);
  return JSON.stringify(out);
}

/**
 * Gemini 2.5 Flash via UrlFetchApp — key in Script Properties GEMINI_API_KEY,
 * sent as x-goog-api-key header (never in the URL or logs).
 * @returns {{ok: boolean, text?: string, error?: string}}
 */
function callGeminiWR_(prompt) {
  try {
    const apiKey = props_().getProperty("GEMINI_API_KEY");
    if (!apiKey) return { ok: false, error: "GEMINI_API_KEY not set in Script Properties." };
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: { "x-goog-api-key": apiKey },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          // thinkingBudget 0: reasoning tokens would count against
          // maxOutputTokens and truncate the JSON — a synthesis task needs none.
          maxOutputTokens: 4096,
          temperature: 0.4,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      muteHttpExceptions: true,
    });
    const code = response.getResponseCode();
    if (code !== 200) {
      Logger.log("⚠️ callGeminiWR_: HTTP " + code);
      return { ok: false, error: "Gemini returned HTTP " + code + "." };
    }
    const body = JSON.parse(response.getContentText());
    const parts = body && body.candidates && body.candidates[0] &&
                  body.candidates[0].content && body.candidates[0].content.parts;
    const text = (parts || []).map(p => p.text || "").join("");
    if (!text) return { ok: false, error: "Gemini returned an empty response." };
    return { ok: true, text };
  } catch (e) {
    Logger.log("⚠️ callGeminiWR_: " + e.message);
    return { ok: false, error: "Gemini call failed: " + e.message };
  }
}

// ── Google Doc export — keeps the Chile-example format ──────────────────────
// Big bold title, muted subtitle with FY windows + extraction date, a badge
// legend, numbered navy section headings, badge-chip FAR/N lines, and shaded-
// header tables with a bold Total row on pure count tables.

const DOC_STYLE_ = {
  TITLE_COLOR: "#0F1941", TEXT: "#1E293B", MUTED: "#64748b",
  TH_BG: "#F8FAFC", BORDER: "#E2E8F0",
  BADGES: { FACT: "#17365D", ASSUMPTION: "#D68910", RISK: "#C0392B", NOTE: "#7F8C8D" },
  LEGEND: {
    FACT: "observed in source data", ASSUMPTION: "applied to derive a figure",
    RISK: "exposure implied by the data", NOTE: "definition or caveat",
  },
};

function docTitle_(body, text) {
  const p = body.appendParagraph(text);
  p.editAsText().setBold(true).setFontSize(20).setForegroundColor(DOC_STYLE_.TITLE_COLOR);
  p.setSpacingAfter(4);
  return p;
}

function docSub_(body, text) {
  const p = body.appendParagraph(text);
  p.editAsText().setBold(false).setFontSize(10).setForegroundColor(DOC_STYLE_.MUTED);
  p.setSpacingAfter(10);
  return p;
}

function docHeading_(body, text) {
  const p = body.appendParagraph(text);
  p.editAsText().setBold(true).setFontSize(13).setForegroundColor(DOC_STYLE_.TITLE_COLOR);
  p.setSpacingBefore(16).setSpacingAfter(4);
  return p;
}

/** One FAR/N line: a colored badge chip followed by the sentence. */
function docBadgeLine_(body, badge, text) {
  const p = body.appendParagraph("");
  const chip = p.appendText(" " + badge + " ");
  chip.setBold(true).setFontSize(8).setForegroundColor("#FFFFFF")
      .setBackgroundColor(DOC_STYLE_.BADGES[badge] || DOC_STYLE_.BADGES.NOTE);
  const t = p.appendText("  " + text);
  t.setBold(false).setFontSize(10).setForegroundColor(DOC_STYLE_.TEXT).setBackgroundColor(null);
  p.setSpacingAfter(5);
  return p;
}

/** The FACT/ASSUMPTION/RISK/NOTE legend row under the subtitle. */
function docLegend_(body) {
  const p = body.appendParagraph("");
  Object.keys(DOC_STYLE_.LEGEND).forEach((badge, i) => {
    const chip = p.appendText((i ? "   " : "") + " " + badge + " ");
    chip.setBold(true).setFontSize(8).setForegroundColor("#FFFFFF")
        .setBackgroundColor(DOC_STYLE_.BADGES[badge]);
    const t = p.appendText(" " + DOC_STYLE_.LEGEND[badge]);
    t.setBold(false).setFontSize(9).setForegroundColor(DOC_STYLE_.MUTED).setBackgroundColor(null);
  });
  p.setSpacingAfter(12);
  return p;
}

/**
 * Styled table: shaded bold header row; a bold Total row is appended to pure
 * two-column count tables (the screenshot idiom).
 */
function docTable_(body, tbl) {
  if (tbl.title) {
    const tp = body.appendParagraph(tbl.title.toUpperCase());
    tp.editAsText().setBold(true).setFontSize(8).setForegroundColor(DOC_STYLE_.MUTED);
    tp.setSpacingBefore(8).setSpacingAfter(2);
  }
  const rows = [tbl.headers.map(String)].concat(tbl.rows.map(r => r.map(c => String(c))));
  // Sections now ship their own Total rows — auto-append only when absent.
  const hasOwnTotal = tbl.rows.length &&
    String(tbl.rows[tbl.rows.length - 1][0]) === "Total";
  const isCountTable = !hasOwnTotal && tbl.headers.length === 2 && tbl.rows.length > 1 &&
    tbl.rows.every(r => typeof r[1] === "number" && isFinite(r[1]));
  if (isCountTable) {
    rows.push(["Total", String(tbl.rows.reduce((t, r) => t + r[1], 0))]);
  }
  const t = body.appendTable(rows);
  t.setBorderColor(DOC_STYLE_.BORDER);
  for (let r = 0; r < t.getNumRows(); r++) {
    const row = t.getRow(r);
    const isHeader = r === 0;
    const isTotal = r > 0 && rows[r][0] === "Total";
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      const text = cell.editAsText();
      text.setFontSize(isHeader ? 9 : 10)
          .setBold(isHeader || isTotal)
          .setForegroundColor(isHeader ? DOC_STYLE_.MUTED : DOC_STYLE_.TEXT);
      if (isHeader) cell.setBackgroundColor(DOC_STYLE_.TH_BG);
    }
  }
  return t;
}

/** "FY25 (1 Jul 2024 to 30 Jun 2025)" from a meta.fys entry. */
function docFyWindowLabel_(fy) {
  return fy.label + " (1 Jul " + fy.startCalYear + " to 30 Jun " + (fy.startCalYear + 1) + ")";
}

function writeReportDoc_(body, payload) {
  const m = payload.meta, r = payload.report;
  const scopeLabel = m.scope === "company" ? "ServiceRocket" : m.scope;
  docTitle_(body, scopeLabel + " Workforce & Compensation Report");
  docSub_(body, "fiscal years " + m.fys.map(docFyWindowLabel_).join(" and ") +
    (m.quarter ? " · Q" + m.quarter + " view" : "") +
    " · data extracted on " + m.asOf + " · figures in " + r.currency.code +
    ". All figures are stated as Fact, Assumption, Risk, or Note.");
  docLegend_(body);
  r.sections.forEach(s => {
    docHeading_(body, s.title.replace(" · ", ". "));
    s.lines.forEach(l => docBadgeLine_(body, l.badge, l.text));
    (s.charts || []).forEach(ch => docTable_(body, chartAsTable_(ch)));
    (s.tables || []).forEach(t => docTable_(body, t));
  });
}

function writeBriefDoc_(body, payload, narrative) {
  const m = payload.meta, b = payload.brief;
  const fyNow = m.fys[m.fys.length - 1].label;
  const scopeLabel = b.scope === "company" ? "Global" : b.scope;
  const cur = b.currency.code;
  docTitle_(body, scopeLabel + " Workforce & Compensation Review · " + fyNow);
  docSub_(body, "ServiceRocket · " + m.fys.map(f => f.label).join(" – ") +
    " · data extracted on " + m.asOf + " · figures in " + cur);

  docHeading_(body, "2. Executive summary");
  if (narrative && narrative.execSummary.length) {
    docSub_(body, "✨ AI synthesis — generated text; figures come from the computed report.");
    narrative.execSummary.forEach(s => body.appendListItem(s).editAsText().setFontSize(10));
  } else {
    docBadgeLine_(body, "NOTE", "AI synthesis not generated at export time.");
  }

  docHeading_(body, "3. " + (b.scope === "company" ? "Company" : b.scope) + " at a glance");
  docBadgeLine_(body, "FACT", fmtInt_(b.glance.headcount) + " active regular employees" +
    (b.glance.interns ? " (+" + fmtInt_(b.glance.interns) + " interns, reported separately)" : "") +
    "; TCC envelope " + fmtMoneyShort_(b.glance.tccEnvelope, cur) +
    (b.glance.missingComp ? "; " + fmtInt_(b.glance.missingComp) +
      " employees missing a comp value (headcount only)" : "") + ".");
  if (b.glance.byLocation.length > 1) {
    docTable_(body, { title: "Headcount by location", headers: ["Key Location", "Headcount"],
      rows: b.glance.byLocation.map(x => [x.key, x.count]) });
  }
  docTable_(body, { title: "Headcount by function", headers: ["Department", "Headcount"],
    rows: b.glance.byDept.map(x => [x.key, x.count]) });

  docHeading_(body, "4. Movement & attrition");
  docTable_(body, { title: "Movement by fiscal year",
    headers: ["FY", "Hires", "Exits", "Net", "Attrition rate"],
    rows: b.movement.scopeTotals.map(x => [x.label + (x.inProgress ? " (to date)" : ""),
      x.hires, x.exits, (x.net >= 0 ? "+" : "") + x.net, fmtPct_(x.rate)]) });
  docTable_(body, { title: "Regretted-attrition trend",
    headers: ["FY", "Regretted", "Exits", "Regretted share"],
    rows: b.movement.regrettedTrend.map(t => [t.label, t.regretted, t.exits, fmtPct_(t.pct, 0)]) });
  docTable_(body, { title: "Per-" + b.dim.label.toLowerCase() + " matrix",
    headers: [b.dim.label].concat(m.fys.map(f => f.label + " exits (rate)")),
    rows: b.movement.byGroup.map(L => [L.key].concat(
      L.perFy.map(p => p.exits + " (" + fmtPct_(p.rate) + ")"))) });

  docHeading_(body, "5. The retention signal");
  if (b.retention.length) {
    docTable_(body, { title: "Regretted leavers: level × tenure × reason",
      headers: ["Level", "Tenure", "Reason", "Count"],
      rows: b.retention.map(x => [x.level, x.tenureBucket, x.reason, x.count]) });
  } else {
    docBadgeLine_(body, "NOTE", "No regretted exits recorded in the window.");
  }

  docHeading_(body, "6. Compensation strategy");
  docTable_(body, { title: "Growth by lever",
    headers: ["FY", "Promotions", "Promo growth", "Adjustments", "Adjustment growth"],
    rows: b.levers.map(v => [v.label + (v.inProgress ? " (to date)" : ""),
      v.promo.count, fmtPct_(v.promo.growthPct), v.adjust.count, fmtPct_(v.adjust.growthPct)]) });

  docHeading_(body, "7. Structural risks");
  if (b.structuralRisks.length) {
    b.structuralRisks.forEach(x =>
      docBadgeLine_(body, "RISK", x.title + " — " + x.detail));
  } else {
    docBadgeLine_(body, "NOTE", "No structural-risk candidate fired at current thresholds.");
  }

  docHeading_(body, "8. " + b.dim.label + " spotlights");
  docTable_(body, { title: "Comparison matrix (" + fyNow + ")",
    headers: [b.dim.label, "Headcount", "Attrition", "Regretted", "Avg TCC (" + cur + ")", "Promo rate", "Flag"],
    rows: b.spotlights.map(s => [s.key, s.headcount, fmtPct_(s.attritionRate),
      fmtPct_(s.regrettedPct, 0), fmtInt_(s.avgComp), fmtPct_(s.promoRate),
      (narrative && narrative.spotlightFlags && narrative.spotlightFlags[s.key]) || s.candidates[0]]) });

  docHeading_(body, "9. Decisions for the board");
  if (narrative && narrative.decisions.length) {
    docSub_(body, "✨ AI-generated draft for discussion — not a recommendation of record.");
    narrative.decisions.forEach(dd => {
      const li = body.appendListItem(dd.title + (dd.rationale ? " — " + dd.rationale : ""));
      li.editAsText().setFontSize(10);
    });
  } else {
    docBadgeLine_(body, "NOTE", "AI draft not generated at export time.");
  }
}

/**
 * Exports the current view to a formatted Google Doc and returns its URL.
 * The doc is created in the executing account's Drive; the requesting viewer
 * is added as a Doc viewer when the app runs as the owner.
 * @param {string} view - "report" (View A) or "brief" (View B).
 * @returns {string} JSON of {ok, url, name} | {ok:false, error}.
 */
function exportReportToDoc(scope, quarter, fyRange, view) {
  const access = checkReportAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });
  try {
    // A brief export must not carry a quarterly filter (brief is full-FY).
    const q = view === "brief" ? 0 : quarter;
    const payload = JSON.parse(getWorkforceReportData(scope, false, q, fyRange));
    if (!payload.ok) return JSON.stringify({ ok: false, error: "Report unavailable." });
    const wantBrief = view === "brief" && payload.brief;

    // Include the AI narrative only if already cached — export never spends
    // Gemini quota on its own.
    let narrative = null;
    if (wantBrief) {
      const hit = cacheGetLarge_(CacheService.getScriptCache(),
        cacheKeyForScope_(payload.meta.scope, 0, payload.meta.fyRange) + "_ai");
      if (hit) {
        try { narrative = JSON.parse(hit).narrative || null; } catch (e) { narrative = null; }
      }
    }

    const scopeLabel = payload.meta.scope === "company" ? "Company-wide" : payload.meta.scope;
    const name = (wantBrief ? "Board Brief" : "Workforce & Compensation Report") +
      " — " + scopeLabel +
      " · " + payload.meta.fys.map(f => f.label).join("–") +
      (payload.meta.quarter ? " Q" + payload.meta.quarter : "") +
      " · " + payload.meta.asOf;
    const doc = DocumentApp.create(name);
    const body = doc.getBody();
    if (wantBrief) writeBriefDoc_(body, payload, narrative);
    else writeReportDoc_(body, payload);
    body.editAsText().setFontFamily("Roboto");
    doc.saveAndClose();

    try {
      const me = (Session.getEffectiveUser().getEmail() || "").toLowerCase();
      if (access.email && access.email !== me) {
        DriveApp.getFileById(doc.getId()).addViewer(access.email);
      }
    } catch (e) {
      Logger.log("⚠️ exportReportToDoc share: " + e.message);
    }
    Logger.log("✅ exportReportToDoc: " + name);
    return JSON.stringify({ ok: true, url: doc.getUrl(), name });
  } catch (e) {
    Logger.log("❌ exportReportToDoc: " + e.message);
    // The permission error has a fixed remedy — say it, don't just relay it.
    if (/permission|authoriz/i.test(String(e.message))) {
      return JSON.stringify({ ok: false, error:
        "Doc export is not authorized yet. An admin must run authorizeDocExport() " +
        "in the Apps Script editor (accept the Docs/Drive consent), then publish a " +
        "NEW deployment version." });
    }
    return JSON.stringify({ ok: false, error: "Export failed: " + e.message });
  }
}

/**
 * Confluence-paste HTML for the current view — the client copies it to the
 * clipboard as rich text (PS_Post idiom, paste-not-publish). AI text is
 * embedded only when already cached; this never calls Gemini.
 * @returns {string} JSON of {ok, html} | {ok:false, error}.
 */
function getConfluenceMarkup(scope, quarter, fyRange, view) {
  const access = checkReportAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });
  try {
    const q = view === "brief" ? 0 : quarter;
    const payload = JSON.parse(getWorkforceReportData(scope, false, q, fyRange));
    if (!payload.ok) return JSON.stringify({ ok: false, error: "Report unavailable." });
    if (view === "brief" && payload.brief) {
      let narrative = null;
      const hit = cacheGetLarge_(CacheService.getScriptCache(),
        cacheKeyForScope_(payload.meta.scope, 0, payload.meta.fyRange) + "_ai");
      if (hit) {
        try { narrative = JSON.parse(hit).narrative || null; } catch (e) { narrative = null; }
      }
      return JSON.stringify({ ok: true, html: confluenceBriefHtml_(payload, narrative) });
    }
    return JSON.stringify({ ok: true, html: confluenceReportHtml_(payload) });
  } catch (e) {
    Logger.log("❌ getConfluenceMarkup: " + e.message);
    return JSON.stringify({ ok: false, error: "Copy failed: " + e.message });
  }
}

function doGet() {
  const access = checkReportAccess();
  if (!access.allowed) {
    Logger.log("⚠️ doGet denied: " + access.email);
    return HtmlService.createHtmlOutput(deniedPageHtmlWR_(access.email))
      .setTitle("Access restricted");
  }
  const t = HtmlService.createTemplateFromFile("ViewReport");
  t.userRole = access.role;
  t.userEmail = access.email;
  return t.evaluate()
    .setTitle("Workforce & Compensation Report")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ── One-time setup: Gemini API key (spec §11 step 2) ────────────────────────
// The key lives ONLY in Script Properties, sent as an x-goog-api-key header —
// never in the URL, never in logs, never committed. Pattern:
//   1. Paste the key into KEY below.
//   2. Run setupGeminiKey() ONCE from the GAS editor.
//   3. RESTORE the placeholder and save, so the key never persists in code.
//   4. Run checkGeminiKey() to verify the round trip.

function setupGeminiKey() {
  const KEY = "PASTE-GEMINI-KEY-HERE-THEN-RUN-ONCE";
  if (!KEY || KEY.indexOf("PASTE-GEMINI-KEY") !== -1) {
    throw new Error("Edit setupGeminiKey(): replace the KEY placeholder with your " +
      "Gemini API key (aistudio.google.com/apikey), run once, then restore the placeholder.");
  }
  props_().setProperty("GEMINI_API_KEY", KEY.trim());
  // Length only — the key value must never reach the execution log.
  Logger.log("✅ GEMINI_API_KEY stored in Script Properties (" + KEY.trim().length +
    " chars). Now RESTORE the placeholder in setupGeminiKey() and save.");
}

/** Verifies the stored key with a minimal round trip — safe to run anytime. */
function checkGeminiKey() {
  if (!props_().getProperty("GEMINI_API_KEY")) {
    Logger.log("❌ GEMINI_API_KEY is not set — run setupGeminiKey() first " +
      "(or add it under Project Settings → Script Properties).");
    return;
  }
  const r = callGeminiWR_('Reply with the single word "OK".');
  Logger.log(r.ok
    ? "✅ Gemini reachable — model replied: " + String(r.text).trim().slice(0, 40)
    : "❌ Gemini check failed: " + r.error);
}

/** Removes the stored key — Gemini blocks degrade to 'narrative unavailable'. */
function clearGeminiKey() {
  props_().deleteProperty("GEMINI_API_KEY");
  Logger.log("✅ GEMINI_API_KEY removed from Script Properties.");
}

// ── One-time setup: Google Doc export authorization ─────────────────────────
// "You do not have permission to call DocumentApp.create" means the OAuth
// grant behind the web app predates the export feature. The grant only
// refreshes when the script REQUESTS the scope interactively, and the web app
// only uses the refreshed grant from a NEW deployment version. So:
//   1. Run authorizeDocExport() from the GAS editor and accept the consent
//      screen (it will now list Google Docs and Drive).
//   2. Deploy → Manage deployments → edit the deployment → Version: New
//      version → Deploy. The 📄 Export Doc button works from then on.
// (With the manifest in appsscript.json the consent screen lists the scopes
// explicitly; without it, this function still triggers scope auto-detection.)

/**
 * Creates a throwaway doc to force the Docs+Drive authorization prompt, then
 * trashes it. Safe to run anytime; changes nothing but the OAuth grant.
 */
function authorizeDocExport() {
  const doc = DocumentApp.create("WR authorization check — safe to delete");
  const body = doc.getBody();
  body.appendParagraph("Workforce & Compensation Report")
      .setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph("Authorization check succeeded — the Docs scope is granted.");
  doc.saveAndClose();
  const url = doc.getUrl();
  // Trashing via DriveApp exercises the Drive scope (used to share exports).
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log("✅ authorizeDocExport: Docs + Drive scopes granted. Test doc created and trashed — " + url);
  Logger.log("➡️ Final step: publish a NEW deployment version (Deploy → Manage deployments) " +
             "so the web app runs under the refreshed grant.");
}

// ── Diagnostics — run from the GAS editor at deploy (spec §11 step 3) ───────
function debugReportPipeline() {
  const ctx = fiscalContextWR_();
  const fys = fyListWR_(ctx.asOf, CONFIG_WR.FY_COUNT);
  Logger.log("FY windows: " + fys.map(f =>
    f.label + " " + isoDate_(f.start) + "→" + isoDate_(f.end) +
    (f.inProgress ? " (in progress)" : "")).join(" | "));

  const r = readRosterWR_();
  const active = r.records.filter(x => x.active);
  Logger.log("Roster: " + r.records.length + " rows after crew exclusion, " + active.length +
             " active, gender " + (r.genderAvailable ? "AVAILABLE" : "PENDING") +
             ", TCC USD " + (r.tccUsdAvailable ? "FOUND" : "NOT FOUND") +
             ", Employee Type " + (r.empTypeAvailable ? "FOUND" : "NOT FOUND — intern split inactive"));
  const interns = r.records.filter(x => x.isIntern);
  Logger.log("Employee Type split: " + (r.records.length - interns.length) + " regular records / " +
             interns.length + " intern records (" + interns.filter(x => x.active).length +
             " active interns) — headline attrition covers regulars only");
  const withFam = active.filter(x => x.jobFamily).length;
  const fams = [...new Set(active.map(x => x.jobFamily).filter(Boolean))].sort();
  Logger.log("Job family parse: " + withFam + "/" + active.length + " actives → " +
             fams.length + " families (" + fams.join(", ") + ") — verify against the " +
             "catalog; prefix exceptions go in CONFIG_WR.JOB_FAMILY_MAP");
  const activeDepts = new Set(active.filter(x => !x.isIntern).map(x => x.dept).filter(Boolean));
  const ghosts = [...new Set(r.records
    .filter(x => !x.isIntern && x.termDate && x.dept && !activeDepts.has(x.dept))
    .map(x => x.dept))].sort();
  Logger.log("Dept remap: " + r.remapped + " rows consolidated (defaults + WR_DEPT_REMAP property)");
  Logger.log("Exit-reason remap: " + r.reasonRemapped + " rows consolidated (defaults + WR_REASON_REMAP property)");
  const legacyReasons = new Map();
  r.records.forEach(x => {
    if (x.termDate && x.termReason &&
        CONFIG_WR.VALID_EXIT_REASONS.indexOf(x.termReason) === -1) {
      legacyReasons.set(x.termReason, (legacyReasons.get(x.termReason) || 0) + 1);
    }
  });
  Logger.log(legacyReasons.size
    ? "⚠️ LEGACY EXIT REASONS in history (outside the active taxonomy): " +
      [...legacyReasons.entries()].map(([k, n]) => k + " (" + n + ")").join(", ") +
      " — consolidate via REASON_REMAP / WR_REASON_REMAP if deprecated"
    : "Exit reasons: all leaver reasons sit inside the active taxonomy");
  if (ghosts.length) {
    Logger.log("⚠️ GHOST DEPARTMENTS after remap (leavers only, no active staff): " + ghosts.join(" | ") +
               " — true merges belong in DEPT_REMAP / WR_DEPT_REMAP; eliminated units are correct history");
  } else {
    Logger.log("Ghost departments: none — leaver departments all exist among active staff");
  }
  const usdHits = active.filter(x => x.tccUsd != null).length;
  Logger.log("TCC USD values: " + usdHits + "/" + active.length + " active");

  let hist = {};
  try { hist = readCompHistoryWR_(); }
  catch (e) { Logger.log("⚠️ readCompHistoryWR_ (debug): " + e.message); }
  const cov = coverageStats_(r.records, hist, fys);
  Logger.log("Per-FY coverage — terminations: " +
    cov.termsPerFy.map(x => x.label + ": " + x.count).join(" · "));
  Logger.log("Per-FY coverage — comp events: " +
    cov.eventsPerFy.map(x => x.label + ": " + x.count).join(" · "));
  Logger.log("Earliest termination on file: " + (cov.earliestTermDate || "none") +
    (cov.firstFyTermGuard ? " ⚠️ " + cov.firstFyLabel + " TERM GUARD FIRES" : " — depth ok"));
  Logger.log("Earliest comp event on file: " + (cov.earliestCompEvent || "none") +
    (cov.firstFyLeverGuard ? " ⚠️ " + cov.firstFyLabel + " LEVER GUARD FIRES" : " — depth ok"));

  let bench = { map: {}, count: 0 };
  if (CONFIG_WR.MARKET_ENABLED) {
    try { bench = readBenchmarksWR_(); }
    catch (e) { Logger.log("⚠️ readBenchmarksWR_ (debug): " + e.message); }
    Logger.log("Benchmarks: " + bench.count + " rows");
  } else {
    Logger.log("Benchmarks: DISABLED (MARKET_ENABLED=false) — internal mid-point evaluation only");
  }

  const scopes = [...new Set(active.map(x => x.keyLocation).filter(Boolean))].sort();
  Logger.log("Scopes (" + scopes.length + "): " + scopes.join(" | "));
  scopes.forEach(loc => {
    const inLoc = r.records.filter(x => x.keyLocation === loc);
    const mode = currencyModeForScope_(inLoc, loc);
    if (mode.mode === "usd") {
      Logger.log("⚠️ " + loc + " spans currencies [" + mode.currencies.join(", ") +
                 "] — aggregates fall back to TCC USD");
    }
  });

  const payload = buildReportPayload_(r.records, hist, bench.map, "company", ctx, CONFIG_WR);
  Logger.log("Company payload: " + JSON.stringify(payload).length + " chars, " +
             payload.report.sections.length + " sections, " +
             (payload.brief ? payload.brief.structuralRisks.length : 0) + " structural-risk candidates");
}
