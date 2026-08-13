// ============================================================
// SCRIPT NAME: Comp Health Report — Code
// PURPOSE:     Rocketeer Global Comp Health Report (V1).
//              Data readers, metric engines, doGet, getCompReportData.
// VERSION:     1.2.0
// ENVIRONMENT: Google Apps Script
// SPEC:        docs/superpowers/specs/2026-07-21-comp-health-dashboard-design.md
// V3 (2026-07-27): managers, verdicts, forecast, financial impact, RAG config —
//              spec 2026-07-27-compdash-v3-exec-feedback-design.md
//
// Layout: PURE LOGIC first (no GAS APIs — Node-testable via tests/),
//         GAS LAYER second (SpreadsheetApp/CacheService/HtmlService).
// ============================================================

const CONFIG_CD = {
  // Fallback source IDs — overridable via Script Properties (same names, CD_ prefix).
  ROSTER_SS_ID:    "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0", // roster + attrition + TCC USD
  COMP_HIST_SS_ID: "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU", // Compensation Report (RD tab)
  ROSTER_TAB:  "Data",     // verify at deploy; override via CD_ROSTER_TAB property
  // TCC USD is a COLUMN inside the roster Data tab (not a separate tab) — its
  // position shifts (seen around col AS/AT), always resolved by header name below.
  TCC_USD_COL: "TCC USD",
  HIST_TAB:    "RD",       // override via CD_HIST_TAB property

  CACHE_TTL_SEC: 65 * 60,
  CACHE_KEY_PREFIX: "cd_",

  // Equity thresholds (Pay Equity tab) — tune here, never in the UI.
  EQUITY_GAP_PCT:     10, // gender median-gap % that flags a location+level group
  EQUITY_OUTLIER_PCT: 25, // individual % below group median that flags an outlier
  TENURE_YEARS_MIN:    3, // tenure lens: minimum years of service
  TENURE_BELOW_PCT:   15, // tenure lens: % below group median that flags

  // ── Signal thresholds — single source of truth ───────────────────────────
  // Echoed wholesale into meta.thresholds so every chip can render its own
  // rule, threshold and source. The flat COMPA_*/MARKET_LOW/SMALL_GROUP_MIN
  // keys below are ALIASES kept for the existing consumers; P1 migrates them
  // and deletes the aliases. Change a number HERE only.
  THRESHOLDS: {
    internal: {
      low: 0.80, target: 0.95, high: 1.10,
      rule: "TCC ÷ the median TCC of active peers sharing Key Location + Job Title",
      source: "Roster TCC · internal peer anchor",
    },
    market: {
      low: 0.90,
      rule: "TCC ÷ the external benchmark mean for Location + Job Title",
      source: "Benchmarking → Compilation tab",
    },
    smallGroupMin: 3,
  },
  // compa groups smaller than this get a smallGroup flag; see THRESHOLDS above.
  // Internal Position color bands V2 — median anchor means ratios can exceed 1.0.
  // Shipped to the client via meta.compaBands so ratioClass() and the Data
  // Reference prose can never drift from these. See THRESHOLDS above.

  // Small Improvements performance ratings
  RATINGS_SS_ID: "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // CD_RATINGS_SS_ID override
  RATINGS_TAB:   "Small Improvements RD",                        // CD_RATINGS_TAB override
  RATING_MAX:    5,     // scale ceiling — perf component normalizes as avg ÷ this

  // External market benchmarks (compilation grows over time — missing rows are normal)
  BENCH_SS_ID: "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0",   // CD_BENCH_SS_ID override
  BENCH_TAB:   "Compilation",                                    // CD_BENCH_TAB override
  // vs-market ratio below this = priority read (red chip); see THRESHOLDS above.

  // Priority Score — mastery band descoped; 40/30/20/10 renormalized to sum 100.
  PRIORITY_W:    { perf: 57, tenure: 29, compaGap: 14 },
  PRIORITY_CAPS: { companyYears: 10, profileYears: 5, gapPct: 0.25 },

  // ── V4: decision signals (2026.W31 exec ask) ─────────────────────────────
  // Deterministic per-employee flags surfaced via the Compensation Position
  // table's drill panel (folded from the standalone Risk Signals view in P0).
  // They surface people for a human conversation — never an automatic re-score.
  // Numeric keys overridable via the CD_SIGNALS_CFG Script Property (JSON,
  // shallow-merged); the regexes stay code (they define cohorts, not tuning).
  SIGNALS: {
    perfWindowQuarters: 4,     // SI ratings window: last N COMPLETED fiscal quarters
    promoStaleYears: 3,        // ≥ N years without a promotion/title-change event
    earlyCareerRe: /^I[123]$/, // early-career lens (exec emphasis: levels 2–3)
    earlyCareerLabel: "I1–I3", // display twin of earlyCareerRe — change together
    coreLevelRe: /^I[34]$/,    // core mature cohort at comp-driven flight risk
    coreLevelLabel: "I3–I4",   // display twin of coreLevelRe — change together
    recogMinRating: 4.5,       // "excellent performer" floor — latest completed-quarter rating
    recogMaxTtm: 0.05,         // excellent rating + TTM TCC growth below 5% = recognition risk
    riskFactorMin: 2,          // retention flag needs ≥ N concurrent factors
    invisibleMinScore: 0.75,   // Check L: contribution evidence score ≥ this…
    invisibleWeakSi: 4,        // …while windowed SI is below this (or absent) = verify, don't assume
  },

  // ── V4: contribution snapshot (PROCESS §7.4 — frozen quarterly evidence) ──
  // Written by exportContributionSnapshot() in the PS Contribution Report
  // project; lives in the contribution data file next to the SI ratings tab.
  // Absent tab degrades gracefully (evidence blocks simply don't render).
  CONTRIB_SNAP_TAB: "Contribution Snapshot", // CD_CONTRIB_SNAP_TAB override; SS via CD_CONTRIB_SNAP_SS_ID

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

  // ── V3: RAG thresholds & benchmarks ─────────────────────────────────────
  // Research-seeded 2026-07-27 (Mercer US Turnover Survey 2025; SHRM
  // Benchmarking 2025; SPI PS Maturity Benchmark 2025/2026; Umbrex regretted-
  // attrition guide; Visier span-of-control 2024; McKinsey span archetypes).
  // Every value overridable via the CD_RAG_CFG Script Property — a JSON object
  // shallow-merged per group over these defaults (see ragCfg_ in the GAS layer).
  // Sources render in Data Reference; services/BPO-adjacent roles run a few
  // points above pure-software norms.
  RAG: {
    attritionTotal: { green: 0.13, yellow: 0.18 }, // ≤green / ≤yellow / above = red
    attritionVol:   { green: 0.10, yellow: 0.18 },
    regrettedShare: { green: 0.25, yellow: 0.40 }, // share of VOLUNTARY exits
    peerVolBand:    { low: 0.11, high: 0.15 },     // PS peer voluntary band (chart zone + text)
    concentration:  0.60,   // top-2 dept share of exits that reads as concentrated
    spanTarget: 6, spanNarrow: 4, spanWide: 10,    // manager:IC ratio guides
    floorHeads: 10, floorExits: 3,                 // sample-size guards (caveat + severity cap)
  },
  MGR_MIN_REPORTS: 3,      // managers below this pool into a "small teams" row
  FORECAST_MIN_MONTHS: 6,  // forecast requires this many actual FY months

  // Exit-reason → driver classification for the "trends & drivers" verdict.
  // First matching regex wins; unmatched reasons read as "other".
  REASON_CLASS: [
    { re: /another job|better offer/i,             driver: "labor-market/comp" },
    { re: /position eliminated|contract ended/i,   driver: "role-design/structural" },
    { re: /unsatisfactory|attendance/i,            driver: "performance-managed" },
    { re: /personal|school|voluntary other/i,      driver: "personal" },
  ],

  BENCH_SOURCES: [
    "Mercer US Turnover Survey 2025 — US avg voluntary 13%, tech ~12%",
    "SHRM Benchmarking Report 2025 — median voluntary 9%, average 13%",
    "SPI Professional Services Maturity Benchmark 2025/2026 — PS total attrition 11.4–12.8%",
    "Umbrex Regretted Attrition guide — typical firms 15–35% of voluntary exits regretted",
    "Visier Span of Control 2024 / McKinsey archetypes — knowledge-work span 6–8",
  ],

  GLOSSARY: [
    { term: "I-level (I1–I8)", def: "Individual-contributor career track parsed from the Job Title level token (e.g. 04.I3.1). Higher number = more senior." },
    { term: "M-level (M4–M10)", def: "Management career track from the same title token (e.g. 04.M5.2)." },
    { term: "JF codes (JF001…)", def: "Job Catalog family codes (e.g. JF004 = Sales & Success). Not displayed in this dashboard; listed here because sibling reports use them." },
    { term: "TCC", def: "Total Cash Compensation — base plus variable target, local currency unless the USD toggle is on." },
    { term: "Compensation Position (compa-ratio)", def: "TCC ÷ peer anchor. 1.00 = at the anchor; bands are shown in the threshold table below." },
    { term: "Anchor tiers", def: "Where the peer anchor comes from: title-peer median (≥3 peers) → external market mean (one-of-a-kind roles) → location level-cohort median → none." },
    { term: "Voluntary / involuntary", def: "From the roster Termination Category. Voluntary = the Rocketeer chose to leave." },
    { term: "Regretted exit", def: "A leaver the company would have preferred to keep (roster Termination Regretted flag). Reported as a share of voluntary exits." },
    { term: "Attrition rate", def: "FY terminations ÷ mean(headcount at FY start, headcount at FY end — today for the running FY)." },
    { term: "Span of control", def: "Active ICs ÷ active managers (anyone who supervises ≥1 active report)." },
    { term: "RAG", def: "Red / Amber(yellow) / Green status coding. Every threshold is configuration, shown with its source in the table below." },
  ],

  // ── V4: restricted profiles (top records — CEO / chiefs / VPs / directors) ──
  // Matching people are stripped SERVER-SIDE from the payload for anyone
  // without exec-view access (Security.js CD_DASH_EXECVIEW; admins always see
  // them). Extra employee numbers via the CD_RESTRICTED_EXTRA property
  // (comma-separated) — for profiles the patterns can't describe.
  RESTRICTED: {
    TITLE_RE: /\b(chief|ceo|cfo|coo|cto|president|vice president|vp|director)\b/i,
    MIN_M_LEVEL: 9, // M9/M10 restricted regardless of title wording
  },

  // ── V4: employment type (optional roster column) ──────────────────────────
  // EOR (Employer of Record) is a REGULAR employee in every engine — explicit
  // rule. Part-time / interns are "not comparable": kept in headcount and
  // attrition, excluded from anchor evidence, ratio scoring, equity lenses and
  // market suggestions — a part-timer must never wear a red band earned
  // against full-time peers. Column absent → everyone regular.
  EMP_TYPE_COL: "Employment Type",
  EMP_TYPE_RE: /employ(ment|ee)?\s*type|worker\s*type/i,
  PART_TIME_RE: /part[\s-]?time/i,
  INTERN_RE: /intern/i,

  // RD reasons that reset in-role (profile) tenure. Internal Transfer counts:
  // it changes job title/responsibilities even when the salary doesn't move.
  PROMO_RE: /promot|title change|role change|internal transfer/i,

  CREW_RE: /crew member|contractor/i, // same crew rule as the PS Contribution Report
  // Narrower than PS Security's regex ON PURPOSE: Rocketeers on maternity/parental
  // leave are still employed — they stay in comp metrics and headcount.
  INACTIVE_RE: /terminat|job offer|resign|left|inactive|former|offboard/i,

  DEBUG: false,
};

// Aliases — every current consumer still reads these flat keys. Assigned from
// THRESHOLDS so the two can never drift. P1 migrates consumers and deletes these.
CONFIG_CD.COMPA_LOW_MIN    = CONFIG_CD.THRESHOLDS.internal.low;
CONFIG_CD.COMPA_TARGET_MIN = CONFIG_CD.THRESHOLDS.internal.target;
CONFIG_CD.COMPA_HIGH_MAX   = CONFIG_CD.THRESHOLDS.internal.high;
CONFIG_CD.MARKET_LOW       = CONFIG_CD.THRESHOLDS.market.low;
CONFIG_CD.SMALL_GROUP_MIN  = CONFIG_CD.THRESHOLDS.smallGroupMin;

// ── Build stamps ────────────────────────────────────────────────────────────
// Nine files are pasted into the GAS editor by hand. Bump the number in EVERY
// server file on every release; doGet refuses to serve when they disagree, so a
// half-finished paste fails loudly instead of reporting stale numbers.
var BUILD_ = BUILD_ || {};
BUILD_.code = 49;

/**
 * @returns {(string[]|null)} names of files whose stamp differs from Code.js,
 *   or null when every file agrees. A missing stamp counts as stale.
 */
function buildMismatch_() {
  const want = BUILD_.code;
  const stale = ["position", "workforce", "narrative", "security",
                 "remotepull", "acceleration", "retention", "growth"]
    .filter(k => BUILD_[k] !== want);
  return stale.length ? stale : null;
}

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

/**
 * Employment-type classification. EOR / Employee of Record / full-time /
 * blank / unknown → "regular" (the deliberate default); part-time and intern
 * are the only non-comparable classes.
 * @returns {("regular"|"part-time"|"intern")}
 */
function classifyEmpType_(raw, cfg) {
  const s = String(raw || "");
  if (cfg.PART_TIME_RE.test(s)) return "part-time";
  if (cfg.INTERN_RE.test(s)) return "intern";
  return "regular";
}

/**
 * Is this roster record a restricted (top) profile? Title pattern, M-level
 * floor, or an explicit employee-number grant (extraSet from
 * CD_RESTRICTED_EXTRA).
 */
function isRestrictedEmp_(rec, cfg, extraSet) {
  if (extraSet && extraSet.has(String(rec.empNo))) return true;
  if (cfg.RESTRICTED.TITLE_RE.test(String(rec.jobTitle || ""))) return true;
  const m = String(rec.level || "").match(/^M(\d+)$/);
  return !!(m && parseInt(m[1], 10) >= cfg.RESTRICTED.MIN_M_LEVEL);
}

/**
 * Removes restricted profiles from every name-carrying collection of an
 * assembled payload, IN PLACE. Aggregates, anchors and verdicts stay
 * full-population (they carry counts, never names). The restrictedEmpNos
 * list itself is deleted — a stripped payload must not enumerate who was
 * hidden. meta.restricted.hidden lets the UI say the view is deliberately
 * partial without saying who.
 * @param {Object} payload parsed getCompReportData payload
 * @returns {Object} the same payload, stripped
 */
function stripRestrictedPayload_(payload) {
  const nos = new Set((payload.restrictedEmpNos || []).map(String));
  delete payload.restrictedEmpNos;
  const setHidden = n => {
    payload.meta.restricted = Object.assign({}, payload.meta.restricted, { hidden: n });
  };
  if (!nos.size) {
    setHidden(0);
    return payload;
  }
  const keep = r => !nos.has(String(r.empNo));
  const hiddenActive = (payload.employees || []).filter(e => !keep(e)).length;
  payload.employees = (payload.employees || []).filter(keep);
  payload.people = (payload.people || []).filter(keep);
  payload.qtaInterim = (payload.qtaInterim || []).filter(keep);
  if (payload.attrition && payload.attrition.detail) {
    payload.attrition.detail = payload.attrition.detail.filter(keep);
  }
  (payload.compaGroups || []).forEach(g => { g.members = (g.members || []).filter(keep); });
  if (payload.equity) {
    payload.equity.outliers = (payload.equity.outliers || []).filter(keep);
    payload.equity.tenure = (payload.equity.tenure || []).filter(keep);
  }
  if (payload.p2 && payload.p2.retention && payload.p2.retention.evidence) {
    payload.p2.retention.evidence.forEach(ev => {
      ev.people = (ev.people || []).filter(keep);
    });
  }
  if (payload.history) {
    nos.forEach(no => { delete payload.history[no]; });
  }
  setHidden(hiddenActive);
  return payload;
}

function asNum_(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
  if (!s) return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

/** RAG band for a fraction metric where LOWER is better. @returns "green"|"yellow"|"red"|null */
function ragBand_(value, bands) {
  if (value == null || !bands) return null;
  return value <= bands.green ? "green" : value <= bands.yellow ? "yellow" : "red";
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

/**
 * Labels of the last `n` COMPLETED fiscal quarters, oldest first, in the
 * fixed-width form the ratings sheet uses ("FY26Q4"). The in-progress quarter
 * never counts — "last 4 completed" is the SI evidence window for comp
 * decisions (V4 rule), so a quarter that hasn't closed can't contribute.
 * @returns {string[]}
 */
function lastCompletedQuarters_(ctx, n) {
  const qNum = parseInt(String(ctx.qLabel).replace(/\D/g, ""), 10);
  const out = [];
  let fy = ctx.fyNum, q = qNum - 1; // step back from the quarter before the current one
  for (let i = 0; i < n; i++) {
    if (q < 1) { q = 4; fy--; }
    out.unshift("FY" + String(fy).slice(-2) + "Q" + q);
    q--;
  }
  return out;
}

// ============================================================
// GAS LAYER — everything below touches GAS services.
// Nothing below this line is exercised by the Node test harness.
// ============================================================

function log_(msg) { if (CONFIG_CD.DEBUG) Logger.log(msg); }

function props_() { return PropertiesService.getScriptProperties(); }

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
    // Contribution snapshot defaults into the same file as the ratings tab.
    contribSnap:    p.getProperty("CD_CONTRIB_SNAP_SS_ID") || p.getProperty("CD_RATINGS_SS_ID") || CONFIG_CD.RATINGS_SS_ID,
    contribSnapTab: p.getProperty("CD_CONTRIB_SNAP_TAB")   || CONFIG_CD.CONTRIB_SNAP_TAB,
    remoteBenchTab: p.getProperty("CD_REMOTE_BENCH_TAB") || CONFIG_CD.REMOTE_BENCH_TAB,
    // Acceleration track defaults into the comp-history file (next to RD).
    accelTrack:    p.getProperty("CD_ACCEL_TRACK_SS_ID") || p.getProperty("CD_COMP_HIST_SS_ID") || CONFIG_CD.COMP_HIST_SS_ID,
    accelTrackTab: p.getProperty("CD_ACCEL_TRACK_TAB")   || CONFIG_CD.ACCEL_TRACK_TAB,
  };
}

/**
 * CONFIG_CD.RAG with CD_RAG_CFG Script Property overrides merged in.
 * The property is a JSON object; each top-level group (attritionTotal, …) is
 * shallow-merged over the default so a partial override ({"peerVolBand":
 * {"high":0.16}}) keeps the untouched keys. Invalid JSON logs and falls back.
 */
function ragCfg_() {
  const base = JSON.parse(JSON.stringify(CONFIG_CD.RAG));
  const raw = props_().getProperty("CD_RAG_CFG");
  if (!raw) return base;
  try {
    const o = JSON.parse(raw);
    Object.keys(o).forEach(k => {
      if (o[k] && typeof o[k] === "object" && base[k] && typeof base[k] === "object") {
        Object.assign(base[k], o[k]);
      } else {
        base[k] = o[k];
      }
    });
  } catch (e) {
    Logger.log("⚠️ ragCfg_: CD_RAG_CFG is not valid JSON — using defaults: " + e.message);
  }
  return base;
}

/**
 * CONFIG_CD.SIGNALS with CD_SIGNALS_CFG Script Property overrides (JSON,
 * numeric keys only — the cohort regexes stay code). Invalid JSON logs and
 * falls back, same contract as ragCfg_.
 */
function signalsCfg_() {
  const base = Object.assign({}, CONFIG_CD.SIGNALS);
  const raw = props_().getProperty("CD_SIGNALS_CFG");
  if (!raw) return base;
  try {
    const o = JSON.parse(raw);
    Object.keys(o).forEach(k => {
      if (typeof o[k] === "number" && isFinite(o[k])) base[k] = o[k];
    });
  } catch (e) {
    Logger.log("⚠️ signalsCfg_: CD_SIGNALS_CFG is not valid JSON — using defaults: " + e.message);
  }
  return base;
}

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
  const ss = SpreadsheetApp.openById(ssId);
  let sh = ss.getSheetByName(tabName);
  if (!sh) {
    // Tolerate whitespace/case drift in tab names ("TCC USD " vs "TCC USD").
    const want = String(tabName).toLowerCase().replace(/\s+/g, " ").trim();
    sh = ss.getSheets().find(s =>
      s.getName().toLowerCase().replace(/\s+/g, " ").trim() === want) || null;
    if (sh) Logger.log('⚠️ fetchTab_: using tab "' + sh.getName() + '" for requested "' + tabName + '"');
  }
  if (!sh) {
    // Available-tab listing stays log-only — the thrown message reaches
    // dashboard users via meta.sources.
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

/** @returns {{records: Object[], genderAvailable: boolean, tccUsdAvailable: boolean, supervisorAvailable: boolean}} normalized roster records (crew excluded). */
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
    tccUsd: col(CONFIG_CD.TCC_USD_COL, /tcc.*usd/i), // optional — column position shifts, resolved by header
    supervisor: col("Supervisor"), // optional — powers the Attrition manager hotspots; absent column degrades gracefully
    empType: col(CONFIG_CD.EMP_TYPE_COL, CONFIG_CD.EMP_TYPE_RE), // optional — part-time/EOR rules; absent → everyone regular
  };
  const required = { empNo: c.empNo, name: c.name, title: c.title, keyLoc: c.keyLoc };
  Object.keys(required).forEach(k => {
    if (required[k] === -1) throw new Error("Roster column missing: " + k);
  });
  const genderAvailable = c.gender !== -1;
  const tccUsdAvailable = c.tccUsd !== -1;
  const supervisorAvailable = c.supervisor !== -1;
  const empTypeAvailable = c.empType !== -1;
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
      supervisor: c.supervisor !== -1 ? String(row[c.supervisor] || "").trim() : "",
      employmentType: empTypeAvailable
        ? classifyEmpType_(row[c.empType], CONFIG_CD) : "regular", // EOR → regular by rule
      tcc: c.tcc !== -1 ? asNum_(row[c.tcc]) : null,
      tccUsd: c.tccUsd !== -1 ? asNum_(row[c.tccUsd]) : null, // read directly off the roster row
    });
  });
  // comparable = may serve as peer-anchor evidence and be ratio-scored.
  records.forEach(r => { r.comparable = r.employmentType === "regular"; });
  log_("readRosterCD_: " + records.length + " records, gender " + (genderAvailable ? "available" : "pending") +
       ", TCC USD " + (tccUsdAvailable ? "available" : "pending") +
       ", supervisor " + (supervisorAvailable ? "available" : "MISSING") +
       ", employment type " + (empTypeAvailable ? "available" : "absent (all regular)"));
  return { records, genderAvailable, tccUsdAvailable, supervisorAvailable, empTypeAvailable };
}

/**
 * @returns {Object<string, Array>} Employee Number → comp events. Order is NOT
 * guaranteed — every consumer (buildGrowthForEmp_, buildQtaInterim_) sorts for itself.
 */
function readCompHistory_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.hist, ids.histTab);
  const iEmp    = colIdx_(headers, "Employee Number");
  const iDate   = colIdx_(headers, "Effective Date");
  const iTtc    = colIdx_(headers, "Total Target Compensation");
  const iReason = colIdx_(headers, "TCC Change Reason");
  const iNext   = colIdx_(headers, "Next Review");
  const iTag    = colIdx_(headers, "TAG"); // system-generated TCC AGR — optional column
  if (iEmp === -1 || iDate === -1 || iTtc === -1) {
    // Header dump is log-only, client message generic (same rule as readRosterCD_).
    Logger.log("❌ readCompHistory_: required columns missing — headers: " + headers.join(" | "));
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
      tcc: asNum_(row[iTtc]), // LOCAL Total Target Compensation recorded at the event
      tag: iTag !== -1 ? tagRate_(row[iTag]) : null,
      nextReview: iNext !== -1 ? asDate_(row[iNext]) : null,
    });
  });
  log_("readCompHistory_: " + Object.keys(byEmp).length + " employees with events");
  return byEmp;
}

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

/**
 * Reads the quarterly Contribution Snapshot (written by the PS project's
 * exportContributionSnapshot). Optional columns tolerated — the tab may be
 * absent entirely (caller degrades gracefully via meta.sources.contribution).
 * @returns {{byEmp: Object, quarter: (string|null), count: number}}
 */
function readContribSnapshot_() {
  const ids = ssIds_();
  const { headers, rows } = fetchTab_(ids.contribSnap, ids.contribSnapTab);
  const c = {
    quarter: colIdx_(headers, "Quarter"),
    empNo:   colIdx_(headers, "Employee Number"),
    team:    colIdx_(headers, "Team"),
    score:   colIdx_(headers, "Contribution Score"),
    goal:    colIdx_(headers, "Goal Compliant"),
    goalsN:  colIdx_(headers, "Goals Total"),
    pto:     colIdx_(headers, "PTO Compliance"),
    tracked: colIdx_(headers, "Tracked Hrs"),
    planned: colIdx_(headers, "Planned Hrs"),
    cover:   colIdx_(headers, "Tracked Coverage"),
    kudosR:  colIdx_(headers, "Kudos Received"),
    kudosG:  colIdx_(headers, "Kudos Given"),
    rcr:     colIdx_(headers, "RCR"),
    si:      colIdx_(headers, "SI"),
  };
  if (c.quarter === -1 || c.empNo === -1) {
    Logger.log("❌ readContribSnapshot_: required columns missing — headers: " + headers.join(" | "));
    throw new Error("Contribution Snapshot tab: required columns missing (see execution log).");
  }
  const val = (row, i) => i !== -1 ? asNum_(row[i]) : null;
  const parsed = rows.map(row => {
    const empNo = String(row[c.empNo] || "").trim();
    const quarter = String(row[c.quarter] || "").trim();
    if (!empNo || !quarter) return null;
    const goalRaw = c.goal !== -1 ? String(row[c.goal] || "").trim() : "";
    return {
      empNo, quarter,
      team: c.team !== -1 ? String(row[c.team] || "").trim() : "",
      score: val(row, c.score),
      goalCompliant: goalRaw ? /^y(es)?$/i.test(goalRaw) : null,
      goalsTotal: val(row, c.goalsN),
      ptoCompliance: val(row, c.pto),
      trackedHrs: val(row, c.tracked),
      plannedHrs: val(row, c.planned),
      trackedCoverage: val(row, c.cover),
      kudosReceived: val(row, c.kudosR),
      kudosGiven: val(row, c.kudosG),
      rcr: val(row, c.rcr), // Services only — null never renders as zero
      si: val(row, c.si),
    };
  }).filter(Boolean);
  const out = buildContribByEmp_(parsed);
  log_("readContribSnapshot_: " + out.count + " employees, latest quarter " + out.quarter);
  return out;
}

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

// ── Assembly + web app ──────────────────────────────────────────────────────

/**
 * Full report payload. Access-checked server-side (defense in depth — the
 * client can call this via google.script.run without going through doGet).
 * @param {boolean} force - true bypasses cache (Refresh button).
 * @returns {string} JSON of {ok, meta, employees[], attrition, managers,
 *   verdicts[], compaGroups[], equity, qtaInterim[], history} — or
 *   {ok:false, error:"denied"}. Returned as a
 *   STRING on purpose: google.script.run marshals a large nested object across the
 *   iframe bridge minutes-slow, while one string + client-side JSON.parse is fast.
 *   ViewDash.html's onData() parses it and depends on this exact shape.
 */
function getCompReportData(force) {
  const access = checkDashboardAccess();
  if (!access.allowed) return JSON.stringify({ ok: false, error: "denied" });

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
      // Cached payloads may predate the current release — the guard in doGet
      // compares CODE versions, not cache vintages, so re-stamp schema from
      // the running BUILD_.code rather than trusting whatever the cache froze.
      obj.meta.schema = BUILD_.code;
      // Cache holds the FULL payload once; restricted profiles are stripped
      // per serve — the gate is this server function, never the client.
      if (!access.canSeeRestricted) stripRestrictedPayload_(obj);
      else delete obj.restrictedEmpNos;
      return JSON.stringify(obj);
    }
  }

  const t0 = Date.now();
  const ctx = fiscalContextCD_();
  const sources = { roster: "ok", history: "ok", ratings: "ok", benchmarks: "ok" };

  let records = [], genderAvailable = false, tccUsdAvailable = false,
      supervisorAvailable = false, empTypeAvailable = false;
  try {
    const r = readRosterCD_();
    records = r.records;
    genderAvailable = r.genderAvailable;
    tccUsdAvailable = r.tccUsdAvailable;
    supervisorAvailable = r.supervisorAvailable;
    empTypeAvailable = r.empTypeAvailable;
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
  // Optional until the first quarterly export runs — "pending" is normal.
  let contrib = { byEmp: {}, quarter: null, count: 0 };
  sources.contribution = "ok";
  try { contrib = readContribSnapshot_(); }
  catch (e) { sources.contribution = "pending: " + e.message; log_("readContribSnapshot_: " + e.message); }

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

  const active = records.filter(r => r.active);

  // SI evidence window: the last N completed fiscal quarters (V4 rule).
  const sigCfg = signalsCfg_(); // regexes included; numeric keys may be overridden
  const cfgV4 = Object.assign({}, CONFIG_CD, { SIGNALS: sigCfg, P2: p2cfg });
  const windowFqs = lastCompletedQuarters_(ctx, sigCfg.perfWindowQuarters);

  const perfByEmp = {};
  active.forEach(r => {
    if (ratings.byEmp[r.empNo]) perfByEmp[r.empNo] = buildPerfForEmp_(ratings.byEmp[r.empNo], windowFqs);
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
    const comparable = r.comparable !== false;
    const b = lookupBench_(bench.map, r.keyLocation, r.jobTitle, r.currency);
    if (b.mismatch) currencyMismatch++;
    if (b.row) matchedBench++;
    const row = b.row;
    const companyYears = r.hireDate
      ? Math.round(tenureYears_(r.hireDate, ctx.asOf) * 10) / 10 : null;
    const profileYears = profileTenureYears_(histByEmp[r.empNo], r.hireDate, ctx.asOf, CONFIG_CD.PROMO_RE);
    const everPromoted = (histByEmp[r.empNo] || []).some(e =>
      e && e.date instanceof Date && !isNaN(e.date) && CONFIG_CD.PROMO_RE.test(String(e.reason || "")));
    // Non-comparable (part-time/intern) → no market read: the benchmark row
    // is a full-time figure, so a ratio against it would be false signal.
    const marketRatio = (comparable && row && row.mean > 0 && r.tcc > 0)
      ? Math.round(r.tcc / row.mean * 1000) / 1000 : null;
    const ttmGrowthPct = ttmGrowth_(histByEmp[r.empNo], r.tcc, ctx.asOf);
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
    return {
      empNo: r.empNo, name: r.name, jobTitle: r.jobTitle, level: r.level, track: r.track,
      dept: r.dept, keyLocation: r.keyLocation, currency: r.currency,
      employmentType: r.employmentType || "regular",
      tcc: r.tcc, tccUsd: r.tccUsd, hireDate: isoDate_(r.hireDate), gender: r.gender,
      ratio: a.ratio, anchor: a.anchor, anchorTier: a.anchorTier,
      p25: row ? row.p25 : null,
      p50: row ? row.mean : null, // MEAN in the p50 slot — UI labels it "Mean", never P50
      p75: row ? row.p75 : null,
      benchSource: row ? row.source : "",
      marketRatio,
      suggestion: comparable
        ? marketSuggestion_(r.tcc, row ? row.p25 : null, row ? row.mean : null)
        : { status: "not-comparable", pctToP25: null, pctToP50: null },
      perfAvg: perf ? perf.avg : null, perfLatest: perf ? perf.latest : null,
      perfWindowLatest: perf ? perf.windowLatest : null,
      perfCount: perf ? perf.count : 0,
      perfTotalCount: perf ? perf.totalCount : 0,
      tenureCompanyYears: companyYears, tenureProfileYears: profileYears,
      ttmGrowthPct,
      contrib: contrib.byEmp[r.empNo] || null,
      signals: buildSignalsForEmp_({
        level: r.level, ratio: a.ratio, marketRatio, ttmGrowthPct,
        profileYears, everPromoted,
        windowLatest: perf ? perf.windowLatest : null,
        contribScore: contrib.byEmp[r.empNo] ? contrib.byEmp[r.empNo].score : null,
        perfAvg: perf ? perf.avg : null,
      }, cfgV4),
      priority: priorityScore_({
        perfAvg: perf ? perf.avg : null, perfCount: perf ? perf.count : 0,
        companyYears, profileYears, ratio: a.ratio,
      }, CONFIG_CD),
      p2: { remote, accel },
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

  // ── V4: restricted profiles — computed over ALL records (a terminated
  // chief is just as restricted in the attrition detail as an active one).
  const extraRestricted = new Set((props_().getProperty("CD_RESTRICTED_EXTRA") || "")
    .split(",").map(s => s.trim()).filter(Boolean));
  const restrictedEmpNos = records
    .filter(r => isRestrictedEmp_(r, CONFIG_CD, extraRestricted))
    .map(r => String(r.empNo)).filter(Boolean);

  // ── V3 blocks — all full-population, deterministic, cached with the payload ──
  const ragCfg = ragCfg_();
  const cfgV3 = Object.assign({}, CONFIG_CD, { RAG: ragCfg, SIGNALS: sigCfg });
  const attrition = buildAttrition_(records, ctx);
  attrition.financialImpact = buildFinancialImpact_(records, ctx);
  attrition.forecast = buildForecast_(attrition.currentFY, attrition.previousFY, ctx, cfgV3);
  const managers = supervisorAvailable
    ? buildManagers_(records, ctx, cfgV3)
    : { available: false, rows: [], pooledSmallTeams: null, spanOfControl: null };
  const equity = buildEquity_(active, CONFIG_CD, ctx.asOf);
  const verdicts = buildVerdicts_({
    fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel,
    activeCount: active.length, hcFyStart: headcountOn_(records, ctx.fyStart),
    attrition, managers, employees, equity,
  }, cfgV3);

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

  const payload = {
    ok: true,
    meta: {
      // Compared against SCHEMA in ViewDash.html — catches a stale client paste,
      // which the server-side BUILD_ guard cannot see.
      schema: BUILD_.code,
      generatedAt: new Date().toISOString(),
      role: access.role, email: access.email, fromCache: false,
      fyLabel: ctx.fyLabel, prevFyLabel: ctx.prevFyLabel, qLabel: ctx.qLabel,
      monthLabels: ctx.monthLabels,
      fiscalMonthIdx: fiscalMonthIdx_(ctx.asOf, ctx.fyStartCalYear),
      fyStartCalYear: ctx.fyStartCalYear, asOf: isoDate_(ctx.asOf),
      sources, genderAvailable, tccUsdAvailable,
      employmentTypeAvailable: empTypeAvailable,
      employmentCounts: {
        partTime: active.filter(r => r.employmentType === "part-time").length,
        intern: active.filter(r => r.employmentType === "intern").length,
      },
      // hidden is overwritten by stripRestrictedPayload_ for non-exec viewers.
      restricted: { hidden: 0, minMLevel: CONFIG_CD.RESTRICTED.MIN_M_LEVEL },
      activeCount: active.length,
      ratingsCount: ratings.count,
      benchCoverage: { rows: bench.count, matchedEmployees: matchedBench, currencyMismatch },
      contribUrl: props_().getProperty("CD_CONTRIB_URL") || "",
      // Threshold echoes — the client colors and documents from these, never
      // from its own literals, so UI text can't drift from CONFIG_CD.
      compaBands: { low: CONFIG_CD.COMPA_LOW_MIN, target: CONFIG_CD.COMPA_TARGET_MIN,
                    high: CONFIG_CD.COMPA_HIGH_MAX },
      marketLow: CONFIG_CD.MARKET_LOW,
      // Whole-object echo — P1's hover UI reads rule/source from here.
      thresholds: CONFIG_CD.THRESHOLDS,
      priorityCfg: { weights: CONFIG_CD.PRIORITY_W, caps: CONFIG_CD.PRIORITY_CAPS,
                     ratingMax: CONFIG_CD.RATING_MAX },
      equityCfg: {
        gapPct: CONFIG_CD.EQUITY_GAP_PCT, outlierPct: CONFIG_CD.EQUITY_OUTLIER_PCT,
        tenureYearsMin: CONFIG_CD.TENURE_YEARS_MIN, tenureBelowPct: CONFIG_CD.TENURE_BELOW_PCT,
        smallGroupMin: CONFIG_CD.SMALL_GROUP_MIN,
      },
      supervisorAvailable,
      ragCfg: Object.assign({}, ragCfg, {
        mgrMinReports: CONFIG_CD.MGR_MIN_REPORTS,
        forecastMinMonths: CONFIG_CD.FORECAST_MIN_MONTHS,
      }),
      // Regexes don't survive JSON — echo displayable twins + numbers only.
      signalsCfg: {
        perfWindowQuarters: sigCfg.perfWindowQuarters, windowFqs,
        promoStaleYears: sigCfg.promoStaleYears,
        earlyCareerLevels: sigCfg.earlyCareerLabel, coreLevels: sigCfg.coreLevelLabel,
        recogMinRating: sigCfg.recogMinRating, recogMaxTtm: sigCfg.recogMaxTtm,
        riskFactorMin: sigCfg.riskFactorMin,
        invisibleMinScore: sigCfg.invisibleMinScore, invisibleWeakSi: sigCfg.invisibleWeakSi,
      },
      contribution: { quarter: contrib.quarter, matched: contrib.count },
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
      benchmarks: { sources: CONFIG_CD.BENCH_SOURCES },
      glossary: CONFIG_CD.GLOSSARY,
    },
    employees,
    people: records.map(personLite_),
    restrictedEmpNos, // deleted by stripRestrictedPayload_ before a non-exec serve
    attrition,
    managers,
    verdicts,
    compaGroups,
    equity,
    qtaInterim: buildQtaInterim_(active, histByEmp, ctx.asOf),
    history,
    p2: p2Block,
  };

  const json = JSON.stringify(payload);
  cachePutLarge_(cache, key, json, CONFIG_CD.CACHE_TTL_SEC);
  Logger.log("✅ getCompReportData: built in " + Math.round((Date.now() - t0) / 1000) + "s — " +
             json.length + " chars, " + active.length + " active, " +
             restrictedEmpNos.length + " restricted profile(s)");
  if (!access.canSeeRestricted) {
    return JSON.stringify(stripRestrictedPayload_(JSON.parse(json)));
  }
  // Exec/admin serve keeps restrictedEmpNos — they see those profiles anyway,
  // and skipping a re-stringify keeps the fresh-build path fast.
  return json;
}

/**
 * Inlines another HTML file into the ViewDash template.
 * Used as <?!= include('Styles') ?>. Include order is load-bearing — see the
 * comment in ViewDash.html.
 * @param {string} name file name without the .html extension
 * @returns {string} the file's raw content
 */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function doGet() {
  const access = checkDashboardAccess();
  if (!access.allowed) {
    Logger.log("⚠️ doGet denied: " + access.email);
    return HtmlService.createHtmlOutput(deniedPageHtml_(access.email))
      .setTitle("Access restricted");
  }
  // A partial paste must never render — stale engine files would report wrong
  // numbers with no visible symptom (PROCESS.md §"No build badge").
  const stale = buildMismatch_();
  if (stale) {
    Logger.log("❌ doGet blocked: build mismatch — stale " + stale.join(", "));
    return HtmlService.createHtmlOutput(
      '<div style="font:14px system-ui;padding:32px;max-width:560px">' +
      '<h2>⚠️ Incomplete deployment</h2>' +
      '<p>These files are stale and must be re-pushed via clasp (hand-paste still possible), then a new deployment ' +
      'version published:</p><ul><li><b>' +
      stale.map(s => s.charAt(0).toUpperCase() + s.slice(1) + ".js").join("</b></li><li><b>") +
      '</b></li></ul></div>').setTitle("Incomplete deployment");
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
  const usdHits = active.filter(x => x.tccUsd != null).length;
  Logger.log("TCC USD column: " + (r.tccUsdAvailable ? "FOUND" : "NOT FOUND") + " — " +
             usdHits + "/" + active.length + " active have a value");
  const supHits = active.filter(x => x.supervisor).length;
  Logger.log("Supervisor column: " + (r.supervisorAvailable ? "FOUND" : "NOT FOUND — manager hotspots (Attrition) will show the unavailable notice") +
             " — " + supHits + "/" + active.length + " active have a value");
  Logger.log("Employment type column: " + (r.empTypeAvailable ? "FOUND" : "NOT FOUND (everyone regular)") +
             " — part-time " + active.filter(x => x.employmentType === "part-time").length +
             " · intern " + active.filter(x => x.employmentType === "intern").length);
  const extraDbg = new Set((PropertiesService.getScriptProperties().getProperty("CD_RESTRICTED_EXTRA") || "")
    .split(",").map(s => s.trim()).filter(Boolean));
  const restrDbg = r.records.filter(x => isRestrictedEmp_(x, CONFIG_CD, extraDbg));
  Logger.log("Restricted profiles: " + restrDbg.length + " (" +
             restrDbg.filter(x => x.active).length + " active) — stripped for non-exec viewers");
  let hist = {};
  try { hist = readCompHistory_(); }
  catch (e) { Logger.log("⚠️ readCompHistory_ (debug): " + e.message); }
  const histHits = active.filter(x => hist[x.empNo]).length;
  Logger.log("RD history join: " + histHits + "/" + active.length + " active matched, " +
             Object.keys(hist).length + " employees total in RD");
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
  const ctxDbg = fiscalContextCD_();
  const cfgDbg = Object.assign({}, CONFIG_CD, { RAG: ragCfg_() });
  const mgrDbg = buildManagers_(r.records, ctxDbg, cfgDbg);
  Logger.log("Managers: " + (mgrDbg.available
    ? mgrDbg.rows.length + " rows (≥" + CONFIG_CD.MGR_MIN_REPORTS + " reports)" +
      (mgrDbg.pooledSmallTeams ? " + pooled " + mgrDbg.pooledSmallTeams.pooledManagers + " small teams" : "") +
      " · span 1:" + (mgrDbg.spanOfControl ? mgrDbg.spanOfControl.ratio : "—")
    : "UNAVAILABLE (no Supervisor values)"));
  const attrDbg = buildAttrition_(r.records, ctxDbg);
  attrDbg.financialImpact = buildFinancialImpact_(r.records, ctxDbg);
  attrDbg.forecast = buildForecast_(attrDbg.currentFY, attrDbg.previousFY, ctxDbg, cfgDbg);
  Logger.log("Financial impact: " + attrDbg.financialImpact.annualPayrollReleasedUsd +
    " USD released, coverage " + attrDbg.financialImpact.coverage.counted + "/" + attrDbg.financialImpact.coverage.total);
  Logger.log("Forecast: " + (attrDbg.forecast
    ? "~" + attrDbg.forecast.projectedTotal + " exits (" + attrDbg.forecast.method + ")"
    : "omitted (needs ≥" + CONFIG_CD.FORECAST_MIN_MONTHS + " actual months)"));
  const sigCfgDbg = signalsCfg_();
  const winDbg = lastCompletedQuarters_(ctxDbg, sigCfgDbg.perfWindowQuarters);
  Logger.log("SI window (completed quarters): " + winDbg.join(", "));
  let ratingsDbg = { byEmp: {}, count: 0 };
  try { ratingsDbg = readRatings_(); } catch (e) { /* already logged above */ }
  let staleN = 0, recogN = 0, coreRiskN = 0;
  active.forEach(x => {
    const perf = ratingsDbg.byEmp[x.empNo] ? buildPerfForEmp_(ratingsDbg.byEmp[x.empNo], winDbg) : null;
    const profileYears = profileTenureYears_(hist[x.empNo], x.hireDate, ctxDbg.asOf, CONFIG_CD.PROMO_RE);
    const s = buildSignalsForEmp_({
      level: x.level, ratio: null, marketRatio: null,
      ttmGrowthPct: ttmGrowth_(hist[x.empNo], x.tcc, ctxDbg.asOf),
      profileYears,
      everPromoted: (hist[x.empNo] || []).some(e => CONFIG_CD.PROMO_RE.test(String(e.reason || ""))),
      windowLatest: perf ? perf.windowLatest : null,
    }, Object.assign({}, CONFIG_CD, { SIGNALS: sigCfgDbg }));
    if (s.promoStale) staleN++;
    if (s.recognitionRisk) recogN++;
    if (s.retentionRisk) coreRiskN++;
  });
  Logger.log("Signals (ratio/market factors excluded in this debug pass): promo-stale " + staleN +
    " · recognition-risk " + recogN + " · core retention (partial factors) " + coreRiskN);
  try {
    const snap = readContribSnapshot_();
    const joined = active.filter(x => snap.byEmp[x.empNo]).length;
    Logger.log("Contribution snapshot: " + snap.count + " rows (latest " + snap.quarter + "), " +
      joined + "/" + active.length + " active joined");
  } catch (e) {
    Logger.log("Contribution snapshot: PENDING — " + e.message);
  }
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
}
