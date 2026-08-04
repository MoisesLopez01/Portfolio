// ============================================================
// SCRIPT NAME: Delivery Health Dashboard (4-tile: Utilization,
//              On-Time Delivery, Forecast Accuracy, Rework-placeholder)
// PURPOSE:     Standalone GAS web app. Reads Tempo/NS/Jira tabs +
//              Roster by spreadsheet ID, builds one person×week +
//              Jira-bucket model, serves Dashboard.html.
// ACCESS:      Email allowlist — see Security.js (checkDeliveryAccess()).
// SPEC:        docs/superpowers/specs/2026-07-31-delivery-health-dashboard-design.md
// ============================================================

var CONFIG_DH = {
  // ── Sources (Script Properties DH_SOURCE_SS_ID / DH_ROSTER_SS_ID override) ──
  SOURCE_SS_ID:      "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw", // Tempo hours SS
  ROSTER_SS_ID:      "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  CAPACITY_SHEET:    "Capacity Tempo",
  TRACKED_SHEET:     "Tempo Tracked Time",
  PLANNED_SHEET:     "Planned Time Tempo",
  NS_SHEET:          "NS Billable",
  PH_SHEET:          "PH",

  // ── PTO source (user decision 2026-08-01): the Accumulation Cost ledger —
  //    "the most accurate PTO record we have" (same workbook the PS Dashboard's
  //    PTO metric reads; Script Property DH_PTO_SS_ID overrides). Usage
  //    transactions are dated per employee → bucketed into ISO weeks. The
  //    NETSUITE rows in Planned Time Tempo remain the FALLBACK when this
  //    workbook is unreadable.
  PTO_ACCUM_SS_ID:   "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",
  PTO_ACCUM_SHEET:   "Accumulation Cost",
  PTO_UNIT:          "hours",   // "hours" | "days" — VERIFY via probeDeliverySources at deploy
  PTO_HOURS_PER_DAY: 8,         // only used when PTO_UNIT = "days"
  JIRA_RAW_SHEET:    "Jira Raw",
  ROSTER_SHEET:      "Data",
  CONTRACTORS_SHEET: "Contractors Data",
  ROSTER_CLASS:      "Professional Services",
  ROSTER_DEPT:       "Services",
  NONPROJECT_KEYS:   ["NETSUITE"],       // time-off rows (case-insensitive)

  // ── On-Time Delivery scope (policy switch, audit 2026-08-03) ──
  // The pre-audit code counted EVERY resolved issue type in one rate, which is
  // the one reading nobody wants: an epic's Due Date is a programme milestone
  // set by the PM and its resolution trails its last child, so epics and Stories
  // measure two different lifecycles — and epics' much lower Due-Date fill rate
  // also inflated the coverage denominator.
  //   "delivery" — non-epic issues only (Stories/Tasks: the team's commitments)
  //   "epic"     — epics only (the metrics-dictionary reading: milestone-level
  //                client commitments; see spec §11 open item)
  //   "all"      — every resolved issue (the pre-audit behaviour; not recommended)
  // USER DECISION 2026-08-03: ship "delivery". This is a KNOWN, ACCEPTED
  // deviation from the Metrics Dictionary (owner: Bill), which asks for
  // Epic/Milestone or Client-Commitment-labelled items — raise it with Bill as a
  // dictionary question, don't silently switch. Changing this changes the rate's
  // MEANING: bump DH_SCHEMA_VER_ and bust the cache with it.
  // ── On-Time scope ──
  // "dictionary" (SHIPPED 2026-08-03, user directive "set the formulas as
  //   requested") = the Metrics Dictionary definition verbatim: issue type
  //   Epic or Milestone, OR any issue carrying the Client Commitment label.
  // "delivery" = Stories/Tasks, epics excluded — the previous shipped default
  //   and an accepted deviation at the time. Kept so the two can be compared.
  // "epic" / "all" = the other two readings, kept for the same reason.
  //
  // ⚠️ DO NOT FLIP THIS TO RAISE THE NUMBER. Measured on the real export
  // (2026.W32 profile, 218 rows): the dictionary scope selects 18 epics of which
  // only 2 carry a due date — n=2 at 11% coverage against an 80% gate, so the
  // card publishes flagged as below-gate. "delivery" would report 146 of 200 at
  // 73% instead.
  //
  // That gap is the POINT, not a bug. n=2 is what "we do not set due dates on
  // milestones" looks like when you measure the metric the Dictionary actually
  // defines. Switching back to "delivery" would lift the number by measuring
  // something the Dictionary does not define, and would hide the blocker the
  // Services Director is being asked to fix (dash-loop/DATA-BLOCKERS.md, item 1;
  // owner Delivery leadership, PR-08, target 2026.W34).
  //
  // Ratified by the user 2026-08-03 after seeing the measured n=2, with the
  // alternative on the table: "keep dictionary scope, that's the right call."
  // _test_onTimeRate_ pins this value so a future change is a decision, not a
  // drive-by. Reopen it with Bill, not in this file.
  ONTIME_SCOPE:      "dictionary",

  // ── Tracking mandate (ALLOWLIST, not blocklist) ──
  // Only these families are held to a time-tracking standard, and ONLY they are
  // in the dashboard population. Everyone else (JF008 Training, JF015 Operations,
  // JF018 Solution Architecture, …) has no tracking obligation — their capacity
  // means nothing if they don't plan and track it, so they are excluded ENTIRELY
  // (grid, tiles, filters; user decision 2026-07-31). Blank/unknown family
  // (incl. crew) = tracking-required: a Tempo schedule implies the expectation
  // (same rule as utilSplitPopulation_ in the demand dashboard).
  TRACKING_FAMILIES: ["Managed Services & Support",  // JF007 — tracking MANDATED
                      "Service Delivery",            // JF009 — tracking MANDATED
                      "Professional Services"],      // defensive — see demand note

  // ── Backlog drill-down (open Jira issues per assignee, spec: swarm view) ──
  BACKLOG_MAX_ITEMS: 8,   // issues listed per person in the detail row (totals cover all)

  // ── New-hire handling (user decision 2026-07-31) ──
  // Weeks BEFORE a person's hire date are removed from every per-person metric
  // (no capacity, no denominators, no grid cell). People hired within this many
  // months stay IN all metrics but carry a 🌱 watch flag in the UI.
  RAMP_UP_MONTHS: 3,

  // ── Window ──
  WEEKS_PAST_GRID:   2,   // completed weeks shown in the weekly grid
  WEEKS_PAST_TREND:  6,   // completed weeks in the WEEKLY tile trend
  // Full history depth. Raised 30 → 52 on 2026-08-03 together with the
  // exporters' shared EXPORT_HISTORY_WEEKS dial: at 30 weeks the Monthly view
  // had its 6 complete months but the QUARTERLY view spanned only ONE complete
  // fiscal quarter, so its tiles showed a single data point — no trend line and
  // no "vs prior" delta (renderTiles_ counts only periods that are done and not
  // partial). Worst-case complete periods by depth, measured (see _test_periods_):
  //     30 wk → 1 quarter,  6 months
  //     52 wk → 3 quarters, 11 months   ← here
  //     65 wk → 4 quarters, 14 months   (cliff for a full-year / YoY compare)
  // Stopped at 52 rather than 65 deliberately: 52 weeks of one person's
  // worklogs still fits inside Tempo's single 500-result page, so the exports
  // stay at one request per person. 65 tips typical users onto a second page,
  // doubling request count and with it the transient-500 exposure.
  // ⚠ This must never exceed what the exports carry, or the deep weeks come
  // back empty and read as zero activity. Exports first, dashboard second.
  WEEKS_PAST_DEEP:   52,
  WEEKS_FUTURE:      3,

  // ── Capacity fallbacks (used only when Capacity Tempo has no cell) ──
  WEEKLY_CAPACITY_HRS:     40,
  ANZ_LOCATION:            "Australia & New Zealand",
  ANZ_CAPACITY_HRS:        38,
  HOLIDAY_HRS_PER_DAY:     8,
  ANZ_HOLIDAY_HRS_PER_DAY: 7.6,

  // ── Region buckets: roster "Key Location" → bucket (FALLBACK lens only;
  //    primary person-region = majority of Jira-tagged tracked hours).
  //    Extend after the W32 Key Location audit (spec §10.2). ──
  LOCATION_REGION_MAP: {
    "australia & new zealand": "ANZ",
    "malaysia": "APAC", "singapore": "APAC", "philippines": "APAC",
    "united states": "AMER", "canada": "AMER", "costa rica": "AMER",
    "chile": "AMER", "colombia": "AMER", "mexico": "AMER",
    "united kingdom": "EMEA", "spain": "EMEA", "portugal": "EMEA",
  },
  REGION_FALLBACK: "Other",

  // ── RAG tint thresholds (billable util %, spec §10.3) ──
  TINT_GREEN: 70,
  TINT_AMBER: 50,

  // ── Per-metric tile targets (director feedback 2026-07-31: one shared
  //    orange made 0%, 58% and 10% look equally alarming). green = target,
  //    amber = watch floor; below amber = red. ──
  TARGETS: {
    util:     { green: 70, amber: 50 },   // billable utilization %
    onTime:   { green: 85, amber: 70 },   // on-time delivery %
    forecast: { green: 80, amber: 60 },   // forecast accuracy %
    hygiene:  { green: 90, amber: 75 },   // % of delivery work fully attributed
    // Rework Rate is the one metric where LOWER IS BETTER, so green is a
    // CEILING not a floor. The registry entry carries invertTarget:true and the
    // client's ragOf_/tileHtml_ read it — without that a 3% rework rate would
    // paint red for sitting "below target".
    quality:  { green: 5,  amber: 10 },   // % of delivered work needing rework
  },

  // ── Coverage-gate policy (requirements v1.1 FR-2.2) ──
  // false = a metric below its registry coverage gate is still PUBLISHED, with
  // its confidence level and attribution % shown beside it.
  // true  = it is suppressed and replaced with "Not yet measurable".
  //
  // USER DECISION 2026-08-03: ship false. This is a KNOWN, ACCEPTED deviation
  // from FR-2.2, which calls publishing a low-confidence number a defect. The
  // trade was made deliberately: gating dark two of four tiles (On-Time at 64%
  // attributed against an 80% gate, Forecast at 23% against 70%) and took the
  // historical series with them, and a dashboard nobody can read teaches nobody
  // anything. Confidence is still computed, still displayed on every tile, and
  // a low-confidence card still links into the hygiene queue — what changed is
  // that the reader decides what to do with a weak number instead of the tool
  // deciding for them.
  //
  // The whole suppression path is intact behind this flag. Flip it to true and
  // the FR-2.2 behaviour returns with no other change; render-smoke covers both
  // settings. Owner of this decision: Services Director (same as the gates).
  SUPPRESS_BELOW_GATE: false,

  // ── Quality / Rework Rate (Metrics Dictionary metric #4) ──
  // Resolutions that mean the work was NEVER DELIVERED. The dictionary's
  // denominator is "total issues delivered in period", so these leave it —
  // counting a cancelled ticket as delivered work would deflate the rate.
  // Matches FIELD_REFERENCE.md ("Exclude Won't Do, Duplicate, Incomplete").
  NON_DELIVERED_RESOLUTIONS: /won'?t\s*(do|fix)|duplicate|incomplete|cannot\s*reproduce|declined|abandoned/i,

  // ── Forecast Accuracy tolerance band (requirements v1.1 FR-1.4) ──
  // An epic counts as "on estimate" when |actual − estimate| ÷ estimate ≤ this.
  // Registry parameter — owner: Services Director; reviewable at fiscal period
  // close (open decision #9: is ±10% right for 40h-week granularity?).
  // Changing it changes the metric's MEANING: add a METRIC_REGISTRY_.changeLog
  // entry and bump DH_SCHEMA_VER_ with it.
  FORECAST_BAND: 0.10,

  TITLE: "Delivery Health Dashboard",

  // ── Cache ──
  CACHE_TTL_SEC:        3900,
  CACHE_WARM_EVERY_MIN: 30,
};

/**
 * ── CANONICAL METRIC REGISTRY (requirements v1.1 FR-1.1/FR-1.2) ─────────────
 *
 * The single definitional source for every published metric: what it means, how
 * it is computed, what it reads, what "good" is, how much of the data has to be
 * there before the number may be shown at all, who owns the number, and who may
 * change its parameters.
 *
 * The dashboard renders labels, targets, coverage gates, tooltips and the
 * suppressed state FROM this object. A definition must never live only in
 * presentation code — that is exactly how two people reading one tile compute
 * two different numbers (principle P8: one definition, one owner).
 *
 * `deviations` is not decoration. Every entry is a known, accepted gap between
 * what the metric SAYS and what the data can currently support; they surface
 * in-product on the metric's ⓘ so nobody quotes a number without them.
 *
 * CHANGING A DEFINITION: add a `changeLog` entry AND bump `version`. The client
 * marks trend lines whose metric changed inside the visible window, so a step in
 * a trend is never misread as a performance move (FR-1.2).
 *
 * Shipped to the client as meta.registry.
 */
var METRIC_REGISTRY_ = {
  version: "2.1",
  updated: "2026-08-03",  // 2026.W32

  metrics: {
    onTime: {
      id: "onTime",
      name: "On-Time Delivery",
      definition: "Share of committed delivery milestones completed on or before the committed due date.",
      formula: "milestones resolved on or before the due calendar day ÷ milestones resolved in period carrying a due date × 100",
      sources: ["Jira Raw — Due Date, Resolution Date, Issue Type, Labels, Assignee"],
      grain: "Epic or Milestone, OR any issue labelled Client Commitment (CONFIG_DH.ONTIME_SCOPE = \"dictionary\"), rolled up by person → team → region",
      target: CONFIG_DH.TARGETS.onTime,
      coverageGate: 0.80,
      coverageOf: "resolved issues that carry a due date",
      owner: "Delivery leadership",
      paramOwner: "Services Director (target); Delivery leadership (issue scope)",
      ebitda: "Late delivery → cost of lateness: client credits, expedite/overtime premium, subcontractor spend. Not yet quantified — blocked on PR-06 (cost/bill rate) and PR-07 (engagement key).",
      deviations: [
        "Measured against the MUTABLE Jira Due Date. The baselined committed date (PR-02) does not exist yet, so a re-baselined milestone reads as on time and the rate is optimistic by an unknown amount.",
        "Milestone detection is by issue-type NAME. If this Jira has no Milestone type, the scope reduces to Epics plus Client-Commitment-labelled issues.",
        "The Client Commitment label is matched loosely (client-commitment / ClientCommitment / client_commitment). PR-08 label discipline is what makes this scope complete rather than approximate.",
      ],
    },

    forecast: {
      id: "forecast",
      name: "Forecast Accuracy",
      definition: "How closely actual hours on an engagement track the original estimate at kickoff.",
      formula: "mean of max(0, 1 − |actual − estimate| ÷ estimate) across epics closed in period × 100",
      formulaSecondary: "companions: share of epics inside the ±10% tolerance band, and the median absolute % variance. The mean answers \"how close on average\", the band answers \"how often did we actually hit it\" — 40% inside the band at a 12% median is a very different engagement from 40% at 90%.",
      sources: ["Jira Raw — Original Estimate (sec), Time Spent (sec), Resolution Date, Assignee"],
      grain: "Epic, rolled up by person → team → region",
      target: CONFIG_DH.TARGETS.forecast,
      coverageGate: 0.70,
      coverageOf: "closed epics carrying an estimate AND logged time",
      owner: "Delivery leadership",
      paramOwner: "Services Director (±10% band width; Finance for any rate-based variant)",
      ebitda: "Forecast variance → margin erosion on engagements closed in period: (actual cost − estimated cost) against contracted value. Not yet quantified — blocked on PR-06/PR-07.",
      deviations: [
        "Estimate is the MUTABLE Jira Original Estimate. The baselined estimate (PR-03) does not exist yet, so an estimate revised mid-flight toward the actual scores as accurate.",
        "Accuracy is FLOORED AT ZERO. The raw Dictionary expression goes negative past a 2× over-run (1 − 2.0 = −100%), which is not a share of anything; the floor keeps the mean interpretable.",
        "Epics carrying an estimate but zero logged time are a time-tracking failure, not a forecasting one: counted toward coverage only, never scored. The raw formula would score them 0% accuracy, reporting a worklog gap as a forecasting miss.",
        "Time Spent comes from Jira, not Tempo. Where a team logs to Tempo but not to the Jira issue, the two diverge.",
      ],
    },

    util: {
      id: "util",
      name: "Billable Utilization",
      definition: "Percentage of available delivery hours logged as billable client work.",
      formula: "(Tempo tracked hours × NetSuite billable share) ÷ scheduled capacity (headcount × standard hours) × 100, over NetSuite-classified person-weeks only",
      formulaSecondary: "net-of-absence companion = the same numerator ÷ (capacity − PTO − holiday); the gap between the two IS the cost of approved absence",
      sources: ["Tempo Tracked Time", "Capacity Tempo", "NS Billable", "PTO Accumulation Cost ledger", "PH (public holidays)", "Roster"],
      grain: "Person → team → region",
      target: CONFIG_DH.TARGETS.util,
      coverageGate: 0.90,
      coverageOf: "tracked hours carrying a NetSuite billable classification",
      owner: "WFP",
      paramOwner: "Services Director (target); Delivery + Tempo admin (billable-flag discipline)",
      ebitda: "Utilization gap → unrecovered labour cost: (target hours − billable hours) × blended cost rate. Not yet quantified — blocked on PR-06 (Finance rate basis, open decision #3).",
      deviations: [
        "Headcount × standard hours is summed from each person's SCHEDULED Tempo capacity (40h, 38h ANZ), not a flat headcount × 40. Same figure for a full-timer and more accurate for a part-timer.",
        "Billable is a RATIO applied to Tempo hours — NetSuite classifies, Tempo quantifies — never NetSuite absolute hours. Billable can therefore never exceed tracked.",
        "Population is the tracking-mandated job families only (JF007/JF009 + blank/crew). Families with no tracking obligation are out of the dashboard entirely.",
        "People on long leave are excluded from both numerator and denominator: Tempo capacity can lag HR, so their scheduled hours would otherwise read as idle capacity.",
      ],
    },

    quality: {
      id: "quality",
      name: "Quality / Rework",
      definition: "Share of delivered work requiring rework after client acceptance, paired with CSAT where available.",
      formula: "issues reopened OR carrying a Rework link ÷ issues delivered in period × 100",
      formulaSecondary: "CSAT (0–100) is a declared companion input, not part of this rate — the survey API is not connected (PR-09).",
      sources: [
        "Jira Raw — Rework Link (issue link type, Jira Backlog.js v3.6.0)",
        "Jira Raw — Reopened (changelog; only populated when CONFIGJ.FETCH_CHANGELOG is on)",
        "Jira Raw — Status Category, Resolution (the delivered denominator)",
        "CSAT survey API — NOT CONNECTED",
      ],
      grain: "Delivered issue, rolled up by person → team → region",
      target: { green: 5, amber: 10 },   // LOWER IS BETTER — see invertTarget
      invertTarget: true,
      coverageGate: 0.80,
      coverageOf: "delivered issues whose rework signals were actually measured",
      owner: "Delivery + CX",
      paramOwner: "Services Director (target threshold); Delivery leadership (Rework link-type discipline)",
      ebitda: "Rework → uncompensated labour: hours on reopened or Rework-linked issues × cost rate, presented as margin given away.",
      deviations: [
        "REOPENS ARE NOT COUNTED unless CONFIGJ.FETCH_CHANGELOG is on in the export — it is off by default because expand=changelog is expensive. Until it is enabled the rate is link-only and UNDERSTATES rework; the card says so and coverage reflects it.",
        "The Rework link type name is matched by pattern (CONFIGJ.REWORK_LINK_RE). If this Jira has no such link type, the numerator is reopens alone — confirm with getIssueLinkTypes.",
        "Denominator excludes Won't Do / Duplicate / Incomplete resolutions: those were never delivered, and counting them would deflate the rate.",
        "\"After client acceptance\" is approximated by \"after Done\" — Jira records no client-acceptance event, so an internal reopen counts the same as a client-triggered one.",
        "CSAT is not connected, so the Dictionary's companion score is absent (PR-09, target 2026.W37).",
      ],
    },

    hygiene: {
      id: "hygiene",
      name: "Delivery Data Attributed",
      definition: "Share of resolved delivery work carrying every field the published metrics need: a due date, an assignee who joins the roster, and a region.",
      formula: "resolved delivery issues with due date AND roster-joinable assignee AND a region ÷ all resolved delivery issues × 100",
      sources: ["Jira Raw — Due Date, Assignee, Region"],
      grain: "Issue",
      target: CONFIG_DH.TARGETS.hygiene,
      coverageGate: 0,   // this metric IS the coverage metric — always publishable
      coverageOf: "n/a — measures attribution itself",
      owner: "WFP (measurement) · Delivery leadership + Gon (the fix)",
      paramOwner: "Services Director (target threshold)",
      ebitda: "No direct translation. Closing this gap is what makes the other four quotable — it is an organisational instruction, not a technical chore.",
      deviations: [],
    },
  },

  /** Newest first. Each entry names what changed, why, and which metrics moved. */
  changeLog: [
    // `affects` drives the in-product "definition changed" marker, so it lists
    // ONLY the metrics whose computed VALUES moved. Introducing the registry and
    // the coverage gates changed what gets published, not what any other metric
    // computes — marking every trend line for it would put a "the step in this
    // trend is a definition change" note on a series that didn't step, which
    // trains people to ignore the marker when it's real.
    // Publication-rule change: no metric's computed values move, so `affects` is
    // empty and no trend line gets a "definition changed" marker.
    // METRICS-DICTIONARY CONFORMANCE. Three of the four rates change how they
    // are COMPUTED and a fourth appears for the first time, so `affects` lists
    // all of them and every visible trend line gets a "definition changed"
    // marker at this date. That marker is the point: the step people will see
    // in W32 is the definition moving, not delivery moving.
    // Measurement change, not a definition change: no metric's computed value
    // moves, so `affects` is empty and no trend line gets a marker.
    { version: "2.1", date: "2026-08-03", author: "Alex López",
      affects: [],
      change: "Data Hygiene splits the assignee gap in two: 'resolved work carries a Jira assignee' and 'that assignee resolves to a roster person'. No metric definition changed.",
      rationale: "Profiling the real export (2025.W32-33, 218 rows) showed 94% of resolved issues DO carry an assignee while only about half resolve to a roster person. Reported as one number it read as a Jira hygiene failure and was routed to the Jira admin queue, where there was nothing to fix. They are two problems with two owners and two different fixes." },
    { version: "2.0", date: "2026-08-03", author: "Alex López",
      affects: ["onTime", "forecast", "util", "quality"],
      change: "Aligned all four metrics to the Metrics Dictionary. On-Time rescoped from Stories/Tasks to Epic/Milestone OR Client-Commitment-labelled issues. Forecast Accuracy headline returned to mean(max(0, 1 − |A−E|/E)), with the ±10% band and median variance kept as companions. Utilization headline denominator returned to gross scheduled capacity (headcount × standard hours), with the net-of-absence rate kept as a companion. Quality / Rework built and published for the first time, replacing the placeholder tile.",
      rationale: "User directive 2026-08-03: \"set the formulas as requested so we can provide the actual results, and definitions based on the documented requirements\". The dashboard and the Dictionary had drifted into describing different metrics under the same four names, which is worse than either definition being wrong — two readers of one tile computed two numbers. Expect all four values to move on deploy; the earlier readings survive as companions or config switches rather than being deleted." },
    { version: "1.1", date: "2026-08-03", author: "Alex López",
      affects: [],
      change: "Coverage gates no longer suppress. A metric below its gate is published with its confidence level and attribution % shown beside it (CONFIG_DH.SUPPRESS_BELOW_GATE = false). Gates, confidence bands and the hygiene queue are unchanged.",
      rationale: "Accepted deviation from FR-2.2, decided by the Services Director. Suppression darkened two of four tiles and removed their history with them; a dashboard nobody can read teaches nobody anything. Confidence is still on every card and a weak number still links to the hygiene queue — the reader judges it rather than the tool refusing to show it." },
    { version: "1.0", date: "2026-08-03", author: "Alex López",
      affects: ["forecast"],
      change: "Forecast Accuracy switched from 1 − |A−E|/E to the ±10% binary band, with median absolute variance as the secondary form. Registry established and coverage gates made binding across all metrics (below gate → suppressed, not published) — a publication rule, so no other metric's values changed.",
      rationale: "requirements v1.1 FR-1.1/FR-1.4/FR-2.2. The old accuracy form was asymmetric (a 50% over-run and a 50% under-run scored identically), produced meaningless decimals on n=28, and conflated direction. Publishing a 17% figure built on 28 epics is the single largest credibility risk to the programme." },
    { version: "0.9", date: "2026-08-03", author: "Alex López",
      affects: ["onTime", "forecast"],   // both rates genuinely moved
      change: "On-Time scoped to delivery issues (epics excluded). Forecast stopped scoring zero-worklog epics as total misses.",
      rationale: "W32 code audit. Epics and Stories measure different lifecycles; a closed epic with no worklog is a time-tracking failure, not a forecasting one." },
  ],
};

/**
 * Data-confidence verdict for one metric (requirements v1.1 FR-2.1/2.2/2.6).
 *
 * High   — coverage ≥ gate AND ≥2 complete periods of data
 * Medium — coverage within 10 points of the gate, or fewer than 2 periods
 * Low    — coverage below (gate − 10 pts): the value is SUPPRESSED, not shown
 *
 * Suppression is the point of this function. A number whose inputs are two
 * thirds missing is not a cautious number, it is a different number, and the
 * only safe thing to publish in its place is what is missing and who owns it.
 *
 * FR-2.6 reads two ways — "Medium = within 10 pts of threshold" overlaps "Low =
 * below threshold". Resolved in favour of the spec's own §13.3 skeleton: the
 * suppression line sits at gate − 10 pts, and the band between that and the gate
 * publishes as Medium with a "coverage approaching threshold" note.
 *
 * Pure and duplicated verbatim in Dashboard.html (coverage is filter-dependent,
 * so the client recomputes it) — _test_confidenceParity_ in node-tests.js diffs
 * the two copies. Keep them identical.
 *
 * @param {number} gate     registry coverageGate, 0–1
 * @param {number} coverage measured attribution, 0–1 (null when nothing in scope)
 * @param {number} periods  complete periods carrying data
 * @returns {{level:string, publish:boolean, coverage:number}}
 */
// ── ADMIN GATE OVERRIDES ──────────────────────────────────────
//
// The registry holds the AGREED gate for each metric. Admins can override it at
// runtime from the Data Hygiene view without a deploy, because "what counts as
// enough coverage" is a judgement the Services Director owns and revisits at
// period close — and making that a code change means it happens in a deploy
// window rather than in the review where the decision is actually made.
//
// Stored as one JSON blob in Script Properties, applied over the registry when
// the model is built. An override is a decision with a name and a date on it,
// so each one records who set it and when, and the hygiene view shows both.
// Registry defaults are never mutated: clearing an override restores the agreed
// value exactly, which is what makes the override safe to experiment with.
var DH_GATES_PROP_ = "DH_GATE_OVERRIDES";

/** @returns {Object} metricId → {gate, by, at} — {} when nothing is overridden. */
function readGateOverrides_() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(DH_GATES_PROP_);
    if (!raw) return {};
    var o = JSON.parse(raw);
    return (o && typeof o === "object") ? o : {};
  } catch (e) {
    Logger.log("⚠️ readGateOverrides_: " + e.message);
    return {};
  }
}

/**
 * Deep-copies the registry and applies any admin overrides, tagging each
 * affected metric so the UI can say the gate is not the agreed one.
 * Pure apart from the property read, so the result is safe to cache.
 */
function registryWithOverrides_(overrides) {
  var reg = JSON.parse(JSON.stringify(METRIC_REGISTRY_));
  Object.keys(overrides || {}).forEach(function (id) {
    var m = reg.metrics[id], o = overrides[id];
    if (!m || !o || typeof o.gate !== "number") return;
    if (!(o.gate >= 0 && o.gate <= 1)) return;      // ignore anything nonsensical
    m.gateDefault = m.coverageGate;                  // what the registry agreed
    m.coverageGate = o.gate;
    m.gateOverride = { by: o.by || "", at: o.at || "" };
  });
  return reg;
}

/**
 * Saves an admin's gate overrides. Admin-only.
 * A gate of null/absent clears that metric back to the registry default.
 * Busts the cache, because every tile's published/withheld state and the whole
 * hygiene view are computed against these numbers.
 * @param {Object} gates metricId → percentage 0–100, or null to clear
 */
function saveGateOverrides(gates) {
  var access = checkDeliveryAccess();
  if (access.role !== "admin") throw new Error("Unauthorized: admin access required.");
  gates = gates || {};
  var cur = readGateOverrides_();
  var stamp = new Date().toISOString().slice(0, 10);
  Object.keys(gates).forEach(function (id) {
    if (!METRIC_REGISTRY_.metrics[id]) return;       // unknown metric — ignore
    var v = gates[id];
    if (v === null || v === "" || v === undefined) { delete cur[id]; return; }
    var pct = Number(v);
    if (!(pct >= 0 && pct <= 100)) throw new Error("Gate for " + id + " must be 0–100.");
    var frac = Math.round(pct) / 100;
    // An "override" back to the agreed value is not an override — clear it, so
    // the UI doesn't show a permanent "changed by" badge on an unchanged gate.
    if (Math.abs(frac - METRIC_REGISTRY_.metrics[id].coverageGate) < 1e-9) {
      delete cur[id];
      return;
    }
    cur[id] = { gate: frac, by: access.email || "", at: stamp };
  });
  PropertiesService.getScriptProperties().setProperty(DH_GATES_PROP_, JSON.stringify(cur));
  bustDeliveryCache_();
  Logger.log("✅ saveGateOverrides by " + access.email + ": " + JSON.stringify(cur));
  return cur;
}

function metricConfidence_(gate, coverage, periods) {
  var g = Number(gate) || 0;
  if (coverage === null || coverage === undefined || isNaN(coverage)) {
    return { level: "none", publish: false, coverage: null };
  }
  var c = Math.max(0, Math.min(1, Number(coverage)));
  var p = Number(periods) || 0;
  if (g <= 0) return { level: "high", publish: true, coverage: c };  // ungated
  if (c >= g && p >= 2) return { level: "high", publish: true, coverage: c };
  if (c >= g - 0.10) return { level: "medium", publish: true, coverage: c };
  return { level: "low", publish: false, coverage: c };
}

// ── ISO WEEK HELPERS (Monday-start, ISO-8601 — ported from demand Code.js) ──

function isoWeekNum_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  var y = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - y) / 86400000 + 1) / 7);
}

function isoWeekYear_(date) {
  var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return d.getUTCFullYear();
}

function weeksInYear_(year) {
  return isoWeekNum_(new Date(Date.UTC(year, 11, 28)));
}

/** "YYYY.WN" label for any Date (used to bucket NS daily rows + Jira dates). */
function weekKeyFromDate_(date) {
  return isoWeekYear_(date) + ".W" + isoWeekNum_(date);
}

/**
 * Rolling window anchored on `today` (injectable for tests).
 * @returns {{ gridWeeks: Array<{iso:string,status:string}>,
 *             trendWeeks: string[],       // 6 completed, oldest first
 *             allWeeks: string[],         // union, oldest first
 *             headlineIso: string }}
 */
function buildDhWindow_(today) {
  var curW = isoWeekNum_(today), curY = isoWeekYear_(today);
  function shift(off) {
    var w = curW + off, y = curY;
    while (w <= 0) { y--; w += weeksInYear_(y); }
    while (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
    return y + ".W" + w;
  }
  var trendWeeks = [], gridWeeks = [], allWeeks = [];
  for (var t = -CONFIG_DH.WEEKS_PAST_TREND; t <= -1; t++) trendWeeks.push(shift(t));
  for (var off = -CONFIG_DH.WEEKS_PAST_GRID; off <= CONFIG_DH.WEEKS_FUTURE; off++) {
    gridWeeks.push({ iso: shift(off), status: off < 0 ? "done" : (off === 0 ? "now" : "plan") });
  }
  for (var a = -CONFIG_DH.WEEKS_PAST_DEEP; a <= CONFIG_DH.WEEKS_FUTURE; a++) allWeeks.push(shift(a));
  return { gridWeeks: gridWeeks, trendWeeks: trendWeeks, allWeeks: allWeeks,
           headlineIso: shift(-1), today: today };
}

// ── PERIOD CALENDAR (Week / Month / fiscal Quarter — FY starts Jul 1,
//    named for the calendar year it ENDS in: Jul 2026–Jun 2027 = FY27) ──

var DH_MONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Thursday (UTC) of an ISO year+week — the day that decides which month or
    quarter the week belongs to (ISO majority rule). */
function isoWeekThursday_(year, wk) {
  var jan4 = new Date(Date.UTC(year, 0, 4)); // Jan 4 is always in ISO W1
  var thu = new Date(jan4);
  thu.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (wk - 1) * 7 + 3);
  return thu;
}

/** "YYYY.WN" → { month:"2026-07", monthLabel:"Jul 2026", quarter:"FY27Q1",
    quarterLabel:"FY27 Q1" }. */
function periodInfoForIso_(iso) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  var thu = isoWeekThursday_(parseInt(m[1], 10), parseInt(m[2], 10));
  var y = thu.getUTCFullYear(), mo = thu.getUTCMonth() + 1;
  var fy = mo >= 7 ? y + 1 : y;
  var q = mo >= 7 ? Math.ceil((mo - 6) / 3) : Math.ceil(mo / 3) + 2;
  return {
    month: y + "-" + (mo < 10 ? "0" : "") + mo,
    monthLabel: DH_MONTHS_[mo - 1] + " " + y,
    quarter: "FY" + String(fy).slice(-2) + "Q" + q,
    quarterLabel: "FY" + String(fy).slice(-2) + " Q" + q,
  };
}

/** ISO label offset by ±1 week (year-wrap safe). */
function adjacentIso_(iso, dir) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  var y = parseInt(m[1], 10), w = parseInt(m[2], 10) + dir;
  if (w <= 0) { y--; w += weeksInYear_(y); }
  else if (w > weeksInYear_(y)) { w -= weeksInYear_(y); y++; }
  return y + ".W" + w;
}

/**
 * Groups the window's weeks into Month and fiscal-Quarter periods for the
 * client's period toggle. Each period: { key, label, isos[], status, partial }.
 * status: "now" when it contains the current week, "done" when fully past,
 * "plan" when fully future. partial: the window truncates the period at
 * either edge (the bordering out-of-window week belongs to the same period).
 */
function buildPeriods_(win) {
  var nowIso = null;
  win.gridWeeks.forEach(function (g) { if (g.status === "now") nowIso = g.iso; });
  var nowIdx = win.allWeeks.indexOf(nowIso);
  function build(kind) {
    var list = [], byKey = {};
    win.allWeeks.forEach(function (iso) {
      var info = periodInfoForIso_(iso);
      var key = kind === "month" ? info.month : info.quarter;
      if (!byKey[key]) {
        byKey[key] = { key: key, label: kind === "month" ? info.monthLabel : info.quarterLabel, isos: [] };
        list.push(byKey[key]);
      }
      byKey[key].isos.push(iso);
    });
    function periodKey(iso) {
      var i = periodInfoForIso_(iso);
      return kind === "month" ? i.month : i.quarter;
    }
    list.forEach(function (p) {
      var hasNow = p.isos.indexOf(nowIso) !== -1;
      var allPast = p.isos.every(function (iso) { return win.allWeeks.indexOf(iso) < nowIdx; });
      p.status = hasNow ? "now" : (allPast ? "done" : "plan");
      var first = p.isos[0], last = p.isos[p.isos.length - 1];
      p.partial =
        (win.allWeeks[0] === first && periodKey(adjacentIso_(first, -1)) === p.key) ||
        (win.allWeeks[win.allWeeks.length - 1] === last && periodKey(adjacentIso_(last, 1)) === p.key);
    });
    return list;
  }
  return { month: build("month"), quarter: build("quarter") };
}

// ── NAME JOINS ───────────────────────────────────────────────

/** Canonical name key — same convention as normPS_ in the PS report. */
function normDH_(name) {
  return String(name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * All normalized variants a source cell may appear as. "Last, First" cells
 * (NS Billable / Planned) also produce "First Last" and "Last First".
 * @returns {string[]} deduped normalized keys
 */
function nameAliases_(raw) {
  var norm = normDH_(raw);
  if (!norm) return [];
  var out = [norm];
  var m = norm.match(/^([^,]+),\s*(.+)$/);
  if (m) {
    var flipped = normDH_(m[2] + " " + m[1]);   // "first last"
    var spaced  = normDH_(m[1] + " " + m[2]);   // "last first"
    if (out.indexOf(flipped) === -1) out.push(flipped);
    if (out.indexOf(spaced) === -1) out.push(spaced);
  }
  return out;
}

/** Roster display names → lookup index: every alias key → display name. */
function buildNameIndex_(displayNames) {
  var idx = {};
  displayNames.forEach(function (dn) {
    nameAliases_(dn).forEach(function (k) { if (!(k in idx)) idx[k] = dn; });
    // Also index the "Last, First" form of a "First Last" roster name so
    // comma-form source cells resolve: "Maria Alvarez" → key "alvarez, maria".
    var parts = normDH_(dn).split(" ");
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      var first = parts.slice(0, -1).join(" ");
      var commaKey = normDH_(last + ", " + first);
      if (!(commaKey in idx)) idx[commaKey] = dn;
      var lastFirstKey = normDH_(last + " " + first);
      if (!(lastFirstKey in idx)) idx[lastFirstKey] = dn;
    }
  });
  return idx;
}

/** Resolves a raw source-cell name to the roster display name, else null. */
function resolveName_(idx, raw) {
  var aliases = nameAliases_(raw);
  for (var i = 0; i < aliases.length; i++) {
    if (aliases[i] in idx) return idx[aliases[i]];
  }
  return null;
}

// ── TEAM SPLIT (spec: filter = individual Tempo teams, membership match) ──

/** "Team A | Team B" → ["Team A","Team B"], trimmed, deduped, blanks dropped. */
function splitTeams_(cell) {
  var seen = {}, out = [];
  String(cell || "").split("|").forEach(function (t) {
    var v = t.trim();
    if (v && !(v.toLowerCase() in seen)) { seen[v.toLowerCase()] = 1; out.push(v); }
  });
  return out;
}

// ── NS BILLABLE WEEK AGGREGATION ─────────────────────────────

/**
 * Daily NS rows → { normName: { iso: {billable, nonBillable} } }.
 * @param {Array<{name:string,date:Date,billable:number,nonBillable:number}>} rows
 */
function aggregateNsWeeks_(rows) {
  var map = {};
  rows.forEach(function (r) {
    if (!r.date || isNaN(r.date.getTime())) return;
    var key = normDH_(r.name);
    if (!key) return;
    var iso = weekKeyFromDate_(r.date);
    if (!map[key]) map[key] = {};
    if (!map[key][iso]) map[key][iso] = { billable: 0, nonBillable: 0 };
    map[key][iso].billable += Number(r.billable) || 0;
    map[key][iso].nonBillable += Number(r.nonBillable) || 0;
  });
  return map;
}

// ── NET CAPACITY (spec §4) ───────────────────────────────────

/**
 * available = max(0, cap − pto − effectiveHoliday);
 * effectiveHoliday = max(0, holidayHrs − pto) so a holiday already booked as
 * NETSUITE time-off is never counted twice (demand-dashboard convention).
 * @returns {{avail:number, hol:number}} hol = effective (deduped) holiday hours
 */
function netCapacity_(cap, pto, holidayHrs) {
  var c = Number(cap) || 0, p = Number(pto) || 0, h = Number(holidayHrs) || 0;
  var effHol = Math.max(0, h - p);
  return { avail: Math.max(0, c - p - effHol), hol: effHol };
}

// ── REGION RESOLUTION (spec: issue-level standard, roster fallback) ──

function regionBucketFromLocation_(keyLocation) {
  var k = normDH_(keyLocation);
  return CONFIG_DH.LOCATION_REGION_MAP[k] || CONFIG_DH.REGION_FALLBACK;
}

/**
 * Person region = region receiving the most Jira-tagged tracked hours in the
 * trend window; ties break alphabetically (deterministic). No tagged hours
 * (> 0) → roster-location fallback, labeled source:"roster".
 */
function assignPersonRegion_(hoursByRegion, rosterBucket) {
  var best = null, bestH = 0;
  Object.keys(hoursByRegion).sort().forEach(function (r) {
    var h = Number(hoursByRegion[r]) || 0;
    if (h > bestH) { best = r; bestH = h; }
  });
  if (best !== null && bestH > 0) return { region: best, source: "jira" };
  return { region: rosterBucket || CONFIG_DH.REGION_FALLBACK, source: "roster" };
}

// ── NEW-HIRE HANDLING (user decision 2026-07-31) ─────────────

/** True when ISO week label `iso` falls entirely before the week containing `date`. */
function isoWeekBefore_(iso, date) {
  var m = String(iso).match(/^(\d{4})\.W(\d{1,2})$/);
  if (!m || !date || isNaN(date.getTime())) return false;
  var y = parseInt(m[1], 10), w = parseInt(m[2], 10);
  var dy = isoWeekYear_(date), dw = isoWeekNum_(date);
  return y < dy || (y === dy && w < dw);
}

/** Hired within RAMP_UP_MONTHS of `today` → 🌱 watch flag (still in all metrics).
    Fails safe to false when the roster has no parseable hire date. */
function isDhNewHire_(hireDate, today) {
  if (!hireDate || isNaN(hireDate.getTime())) return false;
  var cutoff = new Date(today.getFullYear(), today.getMonth() - CONFIG_DH.RAMP_UP_MONTHS,
                        today.getDate());
  return hireDate.getTime() > cutoff.getTime();
}

/** "YYYY-MM-DD" for UI tooltips; "" for missing/invalid dates. */
function dhDateStr_(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return "";
  var mo = d.getMonth() + 1, da = d.getDate();
  return d.getFullYear() + "-" + (mo < 10 ? "0" : "") + mo + "-" + (da < 10 ? "0" : "") + da;
}

// ── BAR OVERFLOW CLAMP (spec §5: clamp at 100% + ⚠ flag) ──────

function clampToCapacity_(hours, capacity) {
  var c = Number(capacity) || 0, h = Number(hours) || 0;
  if (c <= 0) return { pct: null, over: false, realPct: null };
  var real = h / c * 100;
  return { pct: Math.min(100, real), over: real > 100, realPct: Math.round(real) };
}

// ── UTILIZATION ROLLUP (also mirrored client-side for filtering) ──

/**
 * Filter-scoped weekly sums. region/team null = All. Team matching is by
 * MEMBERSHIP (multi-team person counts in each of their teams — per-team
 * rates honest; team numbers do not sum to All by design, spec §4).
 * People with no tracking mandate (p.tracks === false) are EXCLUDED unless
 * includeNonTracking — holding JF008/JF015/JF018 to a tracked-based rate
 * punishes a scope decision, not performance (demand-dashboard parity).
 * People on long leave (p.onLeave — maternity/paternity/parental/sabbatical)
 * are ALWAYS excluded, no include flag: their capacity rows may still carry
 * avail > 0 (Tempo schedules lag HR), which would drag the rate down for an
 * absence, not a performance signal.
 * Billable % divides by availCov — the availability of NS-CLASSIFIED person-weeks
 * only — not by total avail. Mixing them would put unclassifiable weeks in the
 * denominator with a forced-zero numerator, understating the rate by however much
 * the NS export lags (audit fix 2026-08-03). Tracked % keeps the full avail base.
 * @returns {{avail,availCov,billable,tracked,planned,billablePct,trackedPct}}
 */
function utilRollup_(people, iso, region, team, includeNonTracking) {
  var s = { avail: 0, availCov: 0, cap: 0, capCov: 0, billable: 0, tracked: 0, planned: 0 };
  people.forEach(function (p) {
    if (p.onLeave === true) return;
    if (!includeNonTracking && p.tracks === false) return;
    if (region && p.region !== region) return;
    if (team && (p.teams || []).indexOf(team) === -1) return;
    var w = p.weeks && p.weeks[iso];
    if (!w) return;
    s.avail += Number(w.avail) || 0;
    s.availCov += Number(w.availCov) || 0;
    s.cap += Number(w.cap) || 0;
    s.capCov += Number(w.capCov) || 0;
    s.billable += Number(w.billable) || 0;
    s.tracked += Number(w.tracked) || 0;
    s.planned += Number(w.planned) || 0;
  });
  // TWO denominators, both published, because they answer different questions
  // and each one alone is misleading:
  //   grossPct — the Metrics Dictionary's rate: billable ÷ headcount × standard
  //              hours. "How much of the capacity we PAY FOR did we bill?"
  //              Approved absence is a cost, so it stays in the denominator.
  //   billablePct — billable ÷ net available (PTO/holidays removed). "Of the
  //              capacity the team actually HAD, how much did they bill?" This
  //              is the fair operational read and the one a manager is judged on.
  // The gap between them is the cost of absence, which is why the card shows
  // both instead of picking a side.
  s.grossPct = s.capCov > 0 ? s.billable / s.capCov * 100 : null;
  s.billablePct = s.availCov > 0 ? s.billable / s.availCov * 100 : null;
  s.trackedPct = s.avail > 0 ? s.tracked / s.avail * 100 : null;
  return s;
}

// ── NS COVERAGE TELEMETRY (audit 2026-08-03) ─────────────────

/**
 * How much of the tracked-hour base the NS feed actually classified, plus the
 * reconciliation gap between the two feeds. Every field is diagnostic — none of
 * it enters a rate.
 *
 * gapHours = Σ|NS raw total − Tempo tracked| over classified person-weeks. Large
 * values mean the feeds disagree about how much work happened, which the ratio
 * model absorbs silently (it trusts Tempo's total) — so it is surfaced here
 * rather than left invisible. unmatchedNames are NS employees no roster alias
 * resolved: their hours classify nothing at all.
 *
 * @returns {{personWeeks,covered,coveredPct,trackedHours,classifiedHours,
 *            classifiedPct,gapHours,unmatchedRows,unmatchedHours,unmatchedNames}}
 */
function nsCoverage_(people, unmatched) {
  var pw = 0, cov = 0, trk = 0, clf = 0, gap = 0;
  (people || []).forEach(function (p) {
    Object.keys(p.weeks || {}).forEach(function (iso) {
      var w = p.weeks[iso];
      pw++;
      trk += Number(w.tracked) || 0;
      if (!w.nsCov) return;
      cov++;
      clf += Number(w.trackedCov) || 0;
      gap += Math.abs(((Number(w.nsBillRaw) || 0) + (Number(w.nsNonBillRaw) || 0)) -
                      (Number(w.tracked) || 0));
    });
  });
  var u = unmatched || { rows: 0, hours: 0, names: {} };
  var names = Object.keys(u.names || {}).sort();
  return {
    personWeeks: pw, covered: cov,
    coveredPct: pw > 0 ? Math.round(cov / pw * 1000) / 10 : null,
    trackedHours: Math.round(trk * 10) / 10,
    classifiedHours: Math.round(clf * 10) / 10,
    classifiedPct: trk > 0 ? Math.round(clf / trk * 1000) / 10 : null,
    gapHours: Math.round(gap * 10) / 10,
    unmatchedRows: u.rows || 0,
    unmatchedHours: Math.round((u.hours || 0) * 10) / 10,
    // Capped: this rides in the cached payload and only needs to be actionable.
    unmatchedNames: names.slice(0, 25),
  };
}

// ── JIRA TILE BUCKETS (additive per iso×region×team, spec §11) ──

/**
 * Is this issue inside the On-Time scope?
 *
 * One predicate, four readings, so the scopes can never drift apart and each is
 * testable in isolation:
 *
 *   "dictionary" — the Metrics Dictionary verbatim: issue type Epic OR
 *                  Milestone, OR any issue carrying the Client Commitment
 *                  label. A commitment to a client is a commitment whatever
 *                  the issue type, which is why the label is a UNION and not
 *                  a narrowing filter.
 *   "delivery"   — Stories/Tasks only (epics excluded). The team's own
 *                  commitments rather than programme milestones.
 *   "epic"       — epics only.
 *   "all"        — every resolved issue type.
 *
 * Milestone detection is by type NAME because the export writes the type name
 * and sites differ on whether "Milestone" is a real type or an epic subtype.
 */
function onTimeInScope_(it, scope) {
  switch (scope) {
    case "dictionary": return !!(it.isEpic || it.isMilestone || it.isClientCommitment);
    case "epic":       return !!it.isEpic;
    case "all":        return true;
    case "delivery":
    default:           return !it.isEpic;
  }
}

/**
 * Resolved DELIVERED issues → per-week rework buckets (Metrics Dictionary
 * metric #4, built 2026-08-03).
 *
 *   Rework Rate = (reopened OR rework-linked) ÷ delivered in period × 100
 *
 * Denominator = work actually DELIVERED, so resolutions meaning "never shipped"
 * (Won't Do / Duplicate / Incomplete — CONFIG_DH.NON_DELIVERED_RESOLUTIONS) are
 * excluded. Counting a cancelled ticket as delivered work would deflate the
 * rate, which is the direction that flatters us.
 *
 * COVERAGE IS TRACKED SEPARATELY per signal, and this is the whole reason the
 * metric can be trusted:
 *   nLinkCov — issues from an export that carried a Rework Link column at all
 *   nReopenCov — issues whose Reopened cell was actually populated (the export
 *                only fills it when CONFIG_DH/CONFIGJ.FETCH_CHANGELOG is on)
 * An unmeasured signal reads as "not measured", never as "no rework". With
 * changelog off, the rate is link-only and the card says so — a partially
 * measured rate presented as complete is exactly the failure mode the coverage
 * gates exist to catch.
 *
 * @param {Array} issues     records from readJiraRaw_
 * @param {Function} resolvePerson  raw assignee → roster display name
 * @returns {{buckets:Array, unattributed:number}}
 */
function reworkBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0;
  (issues || []).forEach(function (it) {
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    // Delivered only. statusCategory is authoritative when the export provides
    // it; otherwise a resolution date already implies the issue reached Done.
    if (it.statusCategory && !/^done$/i.test(it.statusCategory)) return;
    if (it.resolution && CONFIG_DH.NON_DELIVERED_RESOLUTIONS.test(it.resolution)) return;
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) {
      map[k] = { iso: iso, person: person, nDelivered: 0, nRework: 0,
                 nLinked: 0, nReopened: 0, nReopenCov: 0 };
    }
    var b = map[k];
    b.nDelivered++;
    if (it.reworkLink) b.nLinked++;
    if (it.reopened !== null && it.reopened !== undefined) {
      b.nReopenCov++;
      if (it.reopened) b.nReopened++;
    }
    // The dictionary says "reopened OR linked as Rework" — one issue that did
    // both is still one piece of rework, so this is a union, not a sum.
    if (it.reworkLink || it.reopened === true) b.nRework++;
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/** Resolved DELIVERY issues → per-week on-time buckets. n/onTime cover issues
    WITH a due date; nAll counts every resolved delivery issue (coverage
    denominator).

    Epics are excluded (audit fix 2026-08-03): an epic is a container whose due
    date is a programme milestone set by the PM and whose resolution lags its
    last child by days or weeks. Mixing them with Stories/Tasks measured two
    different lifecycles in one rate, and because epics have a much lower
    due-date fill rate they also inflated the nAll coverage denominator — the
    card read as a delivery miss when it was really a missing-due-date artifact.
    Epic-level forecasting lives in forecastBuckets_ instead.

    scope — CONFIG_DH.ONTIME_SCOPE; see onTimeInScope_ and the config note.
    Passed in so the tests can pin each reading. */
function onTimeBuckets_(issues, resolvePerson, scope) {
  var map = {}, unattributed = 0;
  var sc = scope || CONFIG_DH.ONTIME_SCOPE || "dictionary";
  issues.forEach(function (it) {
    if (!onTimeInScope_(it, sc)) return;
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    // Person attribution (user decision 2026-07-31: ALL filters drive ALL three
    // KPI cards): issues join to the roster via Assignee, so the tiles filter
    // through the same passesFilters_ predicate as the grid. Items without a
    // roster assignee are excluded and tallied for the honesty note.
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, onTime: 0, nAll: 0 };
    // nAll = EVERY resolved issue, due date or not — the tile states coverage
    // ("139 of 210 resolved had a due date"); without it a low-hygiene week
    // reads as a delivery metric when it's really a missing-due-date metric.
    map[k].nAll++;
    if (!it.due || isNaN(it.due.getTime())) return;
    map[k].n++;
    // On time = resolved on or before the due CALENDAR DAY (time-of-day ignored)
    var d = new Date(it.due.getFullYear(), it.due.getMonth(), it.due.getDate());
    var r = new Date(it.resolved.getFullYear(), it.resolved.getMonth(), it.resolved.getDate());
    if (r <= d) map[k].onTime++;
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/**
 * Resolved epics → per-week forecast-accuracy buckets. n/nWithin cover epics
 * that are actually MEASURABLE (estimate AND logged time both present); nAll
 * counts every resolved epic (coverage denominator), nNoTime the
 * estimated-but-untracked ones.
 *
 * Zero-logged-time guard (audit fix 2026-08-03): a resolved epic with est > 0
 * and spent = 0 scored acc = max(0, 1 − est/est) = 0 — the WORST possible
 * accuracy — so Jira time-tracking hygiene (time logged on children only, or
 * an epic closed without any worklog) was reported as a forecasting failure and
 * silently dragged the tile down. Nothing was measured, so it now counts toward
 * coverage only, exactly like an unestimated epic.
 *
 * ±10% BINARY BAND (requirements v1.1 FR-1.4, registry v1.0 — this REPLACED the
 * old `1 − |A−E|/E` accuracy score). The old form was retired because:
 *   · it is asymmetric in meaning but symmetric in score — an engagement that
 *     ran 50% over and one that closed 50% early lost identical points, and
 *     those two need opposite conversations;
 *   · it floors at 0, so a 3× over-run and a 10× over-run read the same;
 *   · averaged over n=28 it produces a decimal nobody can act on.
 * The band answers the executive question directly ("are we hitting estimates?")
 * and the median absolute variance (secondary form) answers the director's
 * follow-up ("by how much are we off?").
 *
 * Bucket fields:
 *   n         measurable epics — the band's denominator
 *   nWithin   measurable epics inside ±band — the band's numerator
 *   absVars   |actual − estimate| ÷ estimate per measurable epic. A median is
 *             NOT additive across buckets, so the raw values ship and the client
 *             takes the median of whatever the active filter selects. Rounded to
 *             3 dp and capped at 20× so one runaway epic can't bloat the payload;
 *             n here is tens of epics per window, not thousands.
 *   nMissOver / nMissUnder   misses by direction (FR-1.6) — additive, so they
 *             roll up under any filter. Counted on MISSES only: an epic inside
 *             the band is on target and which side of centre it sat is noise.
 *
 * @param {Array} epics resolved-epic records
 * @param {Function} resolvePerson Jira assignee → roster display name, or null
 * @param {number=} band tolerance, default CONFIG_DH.FORECAST_BAND (test hook)
 */
function forecastBuckets_(epics, resolvePerson, band) {
  var map = {}, unattributed = 0;
  var bnd = band === undefined ? (CONFIG_DH.FORECAST_BAND || 0.10) : band;
  epics.forEach(function (ep) {
    if (!ep.resolved || isNaN(ep.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(ep.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(ep.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, nWithin: 0, nAll: 0,
                            nNoTime: 0, absVars: [],
                            nMissOver: 0, nMissUnder: 0 };
    map[k].nAll++; // every resolved epic — coverage denominator for the tile
    var est = Number(ep.estSec) || 0;
    if (est <= 0) return; // unestimated — counted in coverage only
    var spent = Number(ep.spentSec) || 0;
    if (spent <= 0) { map[k].nNoTime++; return; } // no worklog — nothing measured
    var dev = (spent - est) / est;   // signed relative deviation
    var absDev = Math.abs(dev);
    map[k].n++;
    map[k].absVars.push(Math.round(Math.min(20, absDev) * 1000) / 1000);
    if (absDev <= bnd) { map[k].nWithin++; return; }
    if (dev > 0) map[k].nMissOver++; else map[k].nMissUnder++;
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/**
 * Per-week attribution counts over the raw Jira feed (requirements v1.1
 * FR-2.3/FR-2.4, §4.2).
 *
 * These are the numbers the KPI cards used to carry in small grey type — "404 of
 * 615 resolved had a due date" — presented as if they qualified a metric when
 * they are really a work queue with an owner. They live here so the Data Hygiene
 * view can show each gap with a trend, and so the confidence gate has a
 * denominator that includes the records the metrics THREW AWAY.
 *
 * That last part matters: onTimeBuckets_ drops issues whose assignee isn't on
 * the roster, so its own nAll can't see them. Coverage measured only over what
 * survived the join would always look better than the truth.
 *
 * @param {Object} jira readJiraRaw_ output
 * @param {Function} resolvePerson Jira assignee → roster display name, or null
 * @param {string=} scope CONFIG_DH.ONTIME_SCOPE reading (delivery|epic|all)
 * @returns {Array} one row per ISO week, additive so the client can aggregate
 */
function hygieneBuckets_(jira, resolvePerson, scope) {
  // Same scope predicate as the metric (onTimeInScope_), never a second copy of
  // the rule: hygiene reports the coverage of the population On-Time actually
  // measures, so if the two ever disagreed the view would be diagnosing a
  // denominator nobody publishes.
  var sc = scope || CONFIG_DH.ONTIME_SCOPE || "delivery";
  var map = {};
  function row(iso) {
    if (!map[iso]) map[iso] = { iso: iso, res: 0, resDue: 0,
                                // resAssigned vs resAttr: SEPARATE PROBLEMS with
                                // separate owners. Measured 2025.W32-33 sample:
                                // 94% of resolved issues carry a Jira assignee,
                                // but only ~54% of those resolve to a roster
                                // person. Reporting one number ("unattributed")
                                // sent a name-matching problem to the Jira admin
                                // queue, where it sat because there was nothing
                                // for them to fix.
                                resAssigned: 0, resAttr: 0,
                                resRegion: 0, resTeam: 0, resReady: 0, resFull: 0,
                                epics: 0, epicsEst: 0, epicsTime: 0 };
    return map[iso];
  }
  (jira.issues || []).forEach(function (it) {
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var iso = weekKeyFromDate_(it.resolved);
    if (onTimeInScope_(it, sc)) {
      var r = row(iso);
      r.res++;
      var hasDue = !!(it.due && !isNaN(it.due.getTime()));
      // "⚠️ UNASSIGNED" is what the exporter writes for an empty Jira assignee,
      // so an unassigned issue is NOT an empty string here — it is a sentinel,
      // and treating it as a name would score the gap as filled.
      var raw = String(it.assignee || "").trim();
      var hasAssignee = !!raw && !/unassigned/i.test(raw);
      var hasPerson = !!(resolvePerson && resolvePerson(it.assignee || ""));
      if (hasAssignee) r.resAssigned++;
      var hasRegion = !!it.region && it.region !== DH_REGION_UNASSIGNED_;
      if (hasDue) r.resDue++;
      if (hasPerson) r.resAttr++;
      if (hasRegion) r.resRegion++;
      if (it.team) r.resTeam++;
      // TWO composites, on purpose.
      //
      // resFull = everything the finished system needs, region included. Region
      // is in the AND deliberately: without it there is no Region × Team
      // comparison, which is the executive layer's whole premise.
      //
      // resReady = what the metrics published TODAY actually need — a due date
      // and an assignee who joins the roster. Region is excluded.
      //
      // Both exist because a single strict composite is useless as a trend right
      // now: the Region field is unpopulated org-wide, so resFull is pinned at 0%
      // and STAYS at 0% however much the due-date and assignee fill rates
      // improve. A number that cannot move is a number people stop looking at,
      // and it would hide exactly the progress the hygiene push is meant to
      // create. resFull remains the headline (the target is the finished
      // system); resReady is shown beside it so movement is visible.
      if (hasDue && hasPerson) r.resReady++;
      if (hasDue && hasPerson && hasRegion) r.resFull++;
    }
    if (it.isEpic) {
      var e = row(iso);
      e.epics++;
      var est = Number(it.estSec) || 0;
      if (est > 0) {
        e.epicsEst++;
        if ((Number(it.spentSec) || 0) > 0) e.epicsTime++;
      }
    }
  });
  return Object.keys(map).sort().map(function (k) { return map[k]; });
}

/** Median of a numeric array; null when empty. Backs the forecast secondary
    form (median absolute % variance) over the active filter's selection. */
function medianOf_(vals) {
  if (!vals || !vals.length) return null;
  var s = vals.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ── JIRA REGION VOCABULARY (requirements v1.1 §4.3) ───────────
//
// The Jira Region custom field (customfield_10047) stores option values in the
// form "RR01 North America". Every rollup in this dashboard speaks a five-value
// vocabulary. The translation happens ONCE, at the data-ingestion layer — never
// in presentation code, or the same raw value ends up mapped two ways on two
// screens.
//
// ⚠ Confirm the exact option list with Gon during PR-01 and extend this table
// (open decision #1, target 2026.W34). Anything unrecognised lands in "Other",
// anything BLANK lands in "Unassigned" — and the two are deliberately different:
// "Other" is a region we haven't mapped, "Unassigned" is a tagging gap somebody
// owns. §4.2 requires the gap be displayed, counted and trended, never quietly
// folded into a real region's total, because visible discomfort is the only
// mechanism that gets Jira tagging fixed.
var JIRA_REGION_TO_DH_ = {
  "rr01 north america": "AMER",
  "rr01 americas":      "AMER",
  "rr02 emea":          "EMEA",
  "rr02 europe":        "EMEA",
  "rr03 apac":          "APAC",
  "rr03 asia pacific":  "APAC",
  "rr04 anz":           "ANZ",
  "rr04 australia":     "ANZ",
};

/** Jira Region option value → dashboard token. Blank → "Unassigned". */
function mapRegionToDh_(jiraValue) {
  var key = String(jiraValue === null || jiraValue === undefined ? "" : jiraValue)
              .toLowerCase().replace(/\s+/g, " ").trim();
  if (!key) return DH_REGION_UNASSIGNED_;
  if (JIRA_REGION_TO_DH_[key]) return JIRA_REGION_TO_DH_[key];
  // Prefix/containment match so "RR02 Europe/Middle East/Africa" and a bare
  // "EMEA" both land, without needing every variant enumerated up front.
  var keys = Object.keys(JIRA_REGION_TO_DH_);
  for (var i = 0; i < keys.length; i++) {
    if (key.indexOf(keys[i]) !== -1 || keys[i].indexOf(key) !== -1) {
      return JIRA_REGION_TO_DH_[keys[i]];
    }
  }
  // A bare token already in the vocabulary ("APAC", "amer") passes through.
  var bare = key.toUpperCase();
  if (["AMER", "EMEA", "APAC", "ANZ"].indexOf(bare) !== -1) return bare;
  return CONFIG_DH.REGION_FALLBACK;  // recognised as a value, not as a region
}

var DH_REGION_UNASSIGNED_ = "Unassigned";

// ── CACHE (gzip chunked) ──────────────────────────────────────

var CACHE_CHUNK_BYTES_ = 90 * 1024; // CacheService hard-fails >100KB per value

/** Current cache version — Script Property DH_CACHE_VER (default 1). */
function deliveryCacheVer_() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty("DH_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch (e) { return 1; }
}

/**
 * Bumps DH_CACHE_VER, stranding all prior-version entries (they expire on TTL —
 * CacheService can't enumerate keys, so versioning is how invalidation works).
 * Run manually from the GAS editor to force-invalidate the cache.
 */
function bustDeliveryCache_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = (parseInt(props.getProperty("DH_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("DH_CACHE_VER", String(next));
    Logger.log("✅ bustDeliveryCache_: cache version bumped to " + next);
    return next;
  } catch (e) {
    Logger.log("⚠️ bustDeliveryCache_: " + e.message);
    return null;
  }
}

/** The single shared cache key for the delivery model. */
function deliveryCacheKey_() { return "dh_v" + deliveryCacheVer_(); }

/** Gzips + chunks `str` into `<key>_0..n` + `<key>_meta`. Returns true on success. */
function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    var b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    var entries = {};
    var n = 0;
    for (var i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    Logger.log("cachePutLarge_: " + key + " — " + str.length + " chars → " + b64.length + " b64 in " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

/** Reads a chunked entry; returns the JSON string or null on any miss. */
function cacheGetLarge_(cache, key) {
  try {
    var meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    var names = [];
    for (var i = 0; i < meta; i++) names.push(key + "_" + i);
    var got = cache.getAll(names);
    var b64 = "";
    for (var j = 0; j < meta; j++) {
      var part = got[key + "_" + j];
      if (!part) return null;  // chunk expired/evicted — whole entry is a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}

// ── SHEET READERS (GAS-only; header-name column lookups) ─────

function dhSourceIds_() {
  var p = PropertiesService.getScriptProperties();
  return {
    source: p.getProperty("DH_SOURCE_SS_ID") || CONFIG_DH.SOURCE_SS_ID,
    roster: p.getProperty("DH_ROSTER_SS_ID") || CONFIG_DH.ROSTER_SS_ID,
  };
}

/** Case-insensitive header index lookup; -1 when absent. */
function colIdx_(headers, names) {
  var low = headers.map(function (h) { return normDH_(h); });
  for (var i = 0; i < names.length; i++) {
    var at = low.indexOf(normDH_(names[i]));
    if (at !== -1) return at;
  }
  return -1;
}

// ── JOB FAMILY → TRACKING MANDATE (demand-dashboard parity) ──

/** JF code number → family display name (same catalog as parseJobFamily_ / ACTIVE_FAMILY_NAMES_). */
var DH_FAMILY_NAMES_ = {
  1: "Marketing", 3: "Analytics", 4: "Sales and Success", 5: "Partner Success",
  7: "Managed Services & Support", 8: "Training & Customer Education",
  9: "Service Delivery", 13: "Finance", 14: "Legal & Compliance", 15: "Operations",
  16: "People", 17: "Information Technology", 18: "Solution Architecture",
};

/**
 * Family for a roster row. Precedence: explicit "Job Family" cell → numeric
 * code prefix on the Job Title ("09." / "009." → JF009 → name). Crew and
 * unlisted titles resolve to "" (treated as tracking-required — see CONFIG note).
 */
function dhFamilyFromTitle_(famCol, title) {
  if (famCol) return String(famCol).trim();
  var m = String(title || "").trim().match(/^(\d{2,3})\./);
  if (!m) return "";
  return DH_FAMILY_NAMES_[String(parseInt(m[1], 10))] || "";
}

/** True when this family is held to the tracking standard (blank = yes). */
function dhTracksTime_(family) {
  var fam = normDH_(family);
  if (!fam) return true;
  return CONFIG_DH.TRACKING_FAMILIES.some(function (f) { return normDH_(f) === fam; });
}

function parseDhDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string" && v.trim()) {
    var d = new Date(v.trim());
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/** Gone-for-good roster statuses (demand-dashboard convention — readRosterFull_). */
var DH_TERMINATED_ = /terminat|job offer|resign|left|inactive|former|offboard/i;

/**
 * True when a roster row belongs to the ACTIVE population. Attrition = a
 * gone-for-good status OR any value in "Termination/Release Date" — those rows
 * must never reach the dashboard (FTE and crew alike).
 */
function dhRosterRowActive_(status, termDate) {
  if (String(termDate || "").trim()) return false;
  return !DH_TERMINATED_.test(String(status || ""));
}

/**
 * Long-leave detector on roster Employee Status (maternity/paternity/parental/
 * other leave, sabbatical). Leave people stay IN the population but the UI
 * shows a 🏖 marker instead of zeros — absence is not non-delivery
 * (GDash "🏖 On Leave" precedent).
 */
var DH_LEAVE_RE_ = /matern|patern|parental|sabbat|leave/i;
function dhOnLeave_(status) {
  var s = String(status || "");
  return dhRosterRowActive_(s, "") && DH_LEAVE_RE_.test(s);
}

/**
 * Population: active Class=Professional Services / Department=Services from
 * Data + Contractors Data (crew: the Class gate is skipped — their Class is
 * "Contractors"; Department must still be Services).
 * Attrition handling mirrors the demand dashboard's readRosterFull_:
 * "Employee Status" + "Termination/Release Date" gate every row, and rows are
 * deduped by normalized name FIRST-ACTIVE-WINS — a rehired (boomerang) person
 * with an old terminated stint keeps only their active row, and Data beats
 * Contractors Data on a name collision.
 * @returns {{ people: Array<{name, keyLocation, rosterBucket, isCrew, jobFamily, tracks}>, error?:string }}
 */
function readRosterPeople_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().roster);
    var out = [], seen = {};
    // Whole-roster attribution list (2026-08-04, user decision): every ACTIVE
    // row on either tab, captured BEFORE the class/department gates. The gates
    // scope the CAPACITY population (who owes planned+tracked time); issue
    // metrics attribute by Jira Assignee, and a contractor's or a non-Services
    // FTE's closed epic was still delivered — it must land on a person, not on
    // "unattributed". Live FY26 Q4 measured the narrow index losing 173 of 351
    // assigned issues (49%), the single largest evaluability drop.
    var attrib = [], seenAttr = {};
    // Employment status of EVERY roster row, whatever the department or class.
    // `out` is the Services delivery population; these two are a wider lookup so
    // names that appear in the data but not in the population — Tempo project
    // managers, most of all — can still be checked for "is this person gone?".
    // Without it a PM who left last year keeps a filter chip and a chart bar
    // forever, because their name is stamped on projects other people still
    // book to.
    var activeAll = {}, inactiveAll = {};
    [{ tab: CONFIG_DH.ROSTER_SHEET, crew: false },
     { tab: CONFIG_DH.CONTRACTORS_SHEET, crew: true }].forEach(function (src) {
      var sh = ss.getSheetByName(src.tab);
      if (!sh) { if (!src.crew) throw new Error('Tab "' + src.tab + '" not found'); return; }
      var raw = sh.getDataRange().getValues();
      if (raw.length < 2) return;
      var h = raw[0].map(String);
      var iName = colIdx_(h, ["Full Name", "Employee Name", "Name"]);
      var iStatus = colIdx_(h, ["Employee Status", "Status", "Employment Status"]);
      var iTerm = colIdx_(h, ["Termination/Release Date", "Termination Date"]);
      var iClass = colIdx_(h, ["Class"]);
      var iDept = colIdx_(h, ["Department"]);
      var iLoc = colIdx_(h, ["Key Location", "Location"]);
      var iFam = colIdx_(h, ["Job Family"]);
      var iTitle = colIdx_(h, ["Job Title"]);
      var iEmpNum = colIdx_(h, ["Employee Number", "Employee #", "Employee ID"]);
      var iHire = colIdx_(h, ["Hire Date", "Hire/Rehire Date", "Most Recent Hire Date",
                              "Original Hire Date", "Start Date"]);
      if (iName === -1) throw new Error('No name column in "' + src.tab + '"');
      if (iDept === -1) {
        Logger.log('⚠️ readRosterPeople_: "' + src.tab + '" has no Department column — ' +
                   'every row excluded (fail-closed; unallocated = R&D by default)');
      }
      if (iStatus === -1 && iTerm === -1) {
        Logger.log('⚠️ readRosterPeople_: "' + src.tab + '" has no Employee Status / ' +
                   'Termination column — attrition rows CANNOT be filtered');
      }
      for (var r = 1; r < raw.length; r++) {
        var name = String(raw[r][iName] || "").trim();
        if (!name) continue;
        var status = iStatus === -1 ? "" : String(raw[r][iStatus] || "");
        var term = iTerm === -1 ? "" : String(raw[r][iTerm] || "");
        var active = dhRosterRowActive_(status, term);
        // Recorded BEFORE the department/class gates — a PM in Sales or R&D is
        // still a live person, and we only want to drop the ones who have left.
        if (active) activeAll[normDH_(name)] = 1;
        else inactiveAll[normDH_(name)] = 1;
        // Attribution record — pre-gates AND pre-attrition (v13, 2026-08-04):
        // work delivered last quarter by someone who has since left was still
        // delivered, so historical issue attribution needs every roster row
        // ever seen. Only the POPULATION below stays active-only. Dedup is
        // first-row-wins; for a rehire the two rows share the same name string,
        // which is all the join needs.
        if (!seenAttr[normDH_(name)]) {
          seenAttr[normDH_(name)] = 1;
          attrib.push({ name: name,
                        rosterBucket: regionBucketFromLocation_(
                          iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim()),
                        isCrew: src.crew,
                        jobFamily: dhFamilyFromTitle_(
                          iFam === -1 ? "" : String(raw[r][iFam] || "").trim(),
                          iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim()),
                        jobTitle: iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim(),
                        hireDate: iHire === -1 ? null : parseDhDate_(raw[r][iHire]) });
        }
        if (!active) continue;                           // attrition — never in the population
        if (seen[normDH_(name)]) continue;               // boomerang/collision: first active wins
        // Gates are FAIL-CLOSED: a missing/blank Class or Department cell excludes
        // the row instead of waving it through — the Contractors Data tab has no
        // Department column, and fail-open here let every contractor (any dept,
        // any status) into the population. Unallocated crew = R&D by default
        // (demand-dashboard rule 2026-07-15), so no Department → not Services.
        if (!src.crew) {
          var cls = iClass === -1 ? "" : String(raw[r][iClass] || "").trim();
          if (normDH_(cls) !== normDH_(CONFIG_DH.ROSTER_CLASS)) continue;
        }
        var dept = iDept === -1 ? "" : String(raw[r][iDept] || "").trim();
        if (normDH_(dept) !== normDH_(CONFIG_DH.ROSTER_DEPT)) continue;
        var loc = iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim();
        var fam = dhFamilyFromTitle_(
          iFam === -1 ? "" : String(raw[r][iFam] || "").trim(),
          iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim());
        seen[normDH_(name)] = 1;
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew,
                   jobFamily: fam, tracks: dhTracksTime_(fam),
                   jobTitle: iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim(),
                   onLeave: dhOnLeave_(status),
                   leaveStatus: dhOnLeave_(status) ? String(status).trim() : "",
                   empNum: iEmpNum === -1 ? "" :
                     String(typeof raw[r][iEmpNum] === "number" ? Math.round(raw[r][iEmpNum])
                       : (raw[r][iEmpNum] || "")).replace(/,/g, "").trim(),
                   hireDate: iHire === -1 ? null : parseDhDate_(raw[r][iHire]) });
      }
    });
    return { people: out, attrib: attrib, activeAll: activeAll, inactiveAll: inactiveAll };
  } catch (e) {
    return { people: [], attrib: [], activeAll: {}, inactiveAll: {},
             error: "Roster read failed: " + e.message };
  }
}

/**
 * Drops names the roster can PROVE have left (user report 2026-08-03: the PM
 * filter carried 52 entries, several of them former employees).
 *
 * The rule is deliberately one-sided. A name is removed only when the roster
 * shows it inactive AND shows no active row for it; anything the roster doesn't
 * know — an external PM, a contractor never listed, a spelling the join can't
 * resolve — is KEPT. Guessing that an unknown name is a leaver would quietly
 * delete live work from the filters, which is a worse failure than one stale
 * chip: the first is invisible, the second is merely untidy.
 *
 * @returns {{kept: Array, dropped: Array}} dropped is reported in meta so the
 *   count is visible rather than the list silently shrinking.
 */
function filterActiveNames_(names, roster) {
  var act = roster.activeAll || {}, inact = roster.inactiveAll || {};
  var kept = [], dropped = [];
  (names || []).forEach(function (n) {
    var k = normDH_(n);
    if (inact[k] && !act[k]) dropped.push(n); else kept.push(n);
  });
  return { kept: kept, dropped: dropped };
}

/**
 * Capacity Tempo grid → { normName: { iso: hours } }.
 * Sheet shape (TempoCapacityTime.js): header row carries "YYYY.WN" labels;
 * fixed cols before the week columns include the User column.
 * @returns {{ byName: Object, error?: string }}
 */
function readCapacitySheet_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
      .getSheetByName(CONFIG_DH.CAPACITY_SHEET);
    if (!sh) return { byName: {}, error: 'Tab "' + CONFIG_DH.CAPACITY_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { byName: {} };
    // Find the header row: first row containing a ".W" week label
    var hRow = -1;
    for (var r = 0; r < Math.min(3, raw.length); r++) {
      if (raw[r].some(function (c) { return /^\d{4}\.W\d{1,2}$/.test(String(c).trim()); })) { hRow = r; break; }
    }
    if (hRow === -1) return { byName: {}, error: "No week columns found in Capacity Tempo" };
    var headers = raw[hRow].map(function (c) { return String(c).trim(); });
    var iUser = colIdx_(headers, ["User"]);
    if (iUser === -1) iUser = 1; // TempoCapacityTime.js: User is column B
    var weekCols = [];
    headers.forEach(function (hh, i) { if (/^\d{4}\.W\d{1,2}$/.test(hh)) weekCols.push({ col: i, iso: hh }); });
    var byName = {};
    for (var r2 = hRow + 1; r2 < raw.length; r2++) {
      var user = String(raw[r2][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var key = normDH_(user);
      if (!byName[key]) byName[key] = {};
      weekCols.forEach(function (wc) {
        var v = raw[r2][wc.col];
        if (v !== "" && v !== null && !isNaN(Number(v))) byName[key][wc.iso] = Number(v);
      });
    }
    return { byName: byName };
  } catch (e) {
    return { byName: {}, error: "Capacity read failed: " + e.message };
  }
}

/**
 * Shared Tempo grid reader for Tracked/Planned. Detects the week-label row
 * and the fixed-header row, then aggregates.
 * @returns {{ rows: Array<{user,teamCell,key,weekHours:Object}>, weekIsos:string[], error?:string }}
 */
function readTempoGrid_(sheetName) {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(sheetName);
    if (!sh) return { rows: [], weekIsos: [], error: 'Tab "' + sheetName + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [], weekIsos: [] };
    // Field-header row: scan the first 5 rows for the employee column instead
    // of assuming row 2 — same approach as the demand dashboard's reader, which
    // tolerates banner rows / layout drift in the Tempo exports.
    var isEmpHdr = function (h) {
      return /user|resource|rocketeer|name|employee/i.test(h) && !/type|role|skill|program|team/i.test(h);
    };
    var hr = -1, iUser = -1;
    for (var r0 = 0; r0 < Math.min(raw.length, 5) && hr === -1; r0++) {
      for (var c0 = 0; c0 < raw[r0].length; c0++) {
        if (isEmpHdr(String(raw[r0][c0]).trim())) { hr = r0; iUser = c0; break; }
      }
    }
    if (hr === -1) return { rows: [], weekIsos: [], error: 'No user/employee header found in ' + sheetName };
    var hdRow = raw[hr].map(function (c) { return String(c).trim(); });
    var iTeam = colIdx_(hdRow, ["Team"]);
    var iKey = colIdx_(hdRow, ["Key"]);
    var iPm = colIdx_(hdRow, ["PM"]); // per-project lead (both Tempo exports)
    // Week labels: the row ABOVE the field headers when it carries ISO labels
    // (two-row stacked export), else the field-header row itself (legacy).
    var wkRow = (hr > 0 && raw[hr - 1].some(function (cell) { return /^\d{4}\.W\d{1,2}$/.test(String(cell).trim()); }))
      ? raw[hr - 1] : raw[hr];
    var weekCols = [];
    wkRow.forEach(function (w, i) {
      var s = String(w).trim();
      if (/^\d{4}\.W\d{1,2}$/.test(s)) weekCols.push({ col: i, iso: s });
    });
    var rows = [];
    for (var r = hr + 1; r < raw.length; r++) {
      var user = String(raw[r][iUser] || "").trim();
      if (!user || /^total/i.test(user)) continue;
      var weekHours = {};
      weekCols.forEach(function (wc) {
        var v = Number(raw[r][wc.col]);
        if (v) weekHours[wc.iso] = (weekHours[wc.iso] || 0) + v;
      });
      rows.push({ user: user,
                  teamCell: iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim(),
                  key: iKey === -1 ? "" : String(raw[r][iKey] || "").trim().toUpperCase(),
                  pm: iPm === -1 ? "" : String(raw[r][iPm] || "").trim(),
                  weekHours: weekHours });
    }
    return { rows: rows, weekIsos: weekCols.map(function (w) { return w.iso; }) };
  } catch (e) {
    return { rows: [], weekIsos: [], error: sheetName + " read failed: " + e.message };
  }
}

/**
 * Level-token parser ported from CompDash's parseLevel_ (the proven
 * manager/IC splitter): extracts "I3"/"M10" from titles like "04.I3.1",
 * "04.M10.2", or "M5 - Manager, X". Boundary rules prevent false positives
 * on the word "Manager" or on codes like "PM5".
 * @returns {{level: string, track: ("IC"|"M"|null)}} level "—" when unparseable
 */
function dhLevelTrack_(jobTitle) {
  var m = String(jobTitle || "").match(/(?:^|[^A-Za-z0-9])([IM])(\d{1,2})(?![0-9])/i);
  if (!m) return { level: "—", track: null };
  var letter = m[1].toUpperCase();
  return { level: letter + parseInt(m[2], 10), track: letter === "I" ? "IC" : "M" };
}

/**
 * PTO usage per employee per ISO week from Accumulation Cost ledger rows
 * (pure — testable). Usage/TimeOff transactions carry the hours either as an
 * explicit amount or as the balance delta vs the previous transaction.
 * @param {Array<{empNum:string, date:Date, adjType:string,
 *                amount:(number|null), balance:(number|null)}>} rows
 * @param {string} unit "hours"|"days"   @param {number} hoursPerDay
 * @returns {{byEmp: Object<string, Object<string, number>>, skipped: number}}
 */
function ptoUsageFromRows_(rows, unit, hoursPerDay) {
  var byEmpRows = {};
  (rows || []).forEach(function (r, i) {
    if (!r.empNum || !r.date || isNaN(r.date.getTime())) return;
    (byEmpRows[r.empNum] = byEmpRows[r.empNum] || []).push({ r: r, seq: i });
  });
  var byEmp = {}, skipped = 0;
  Object.keys(byEmpRows).forEach(function (emp) {
    // Same-date rows (a NetSuite batch can post an accrual and a usage on one
    // day) must keep LEDGER ORDER: the delta fallback below reads prevBalance,
    // so reordering them would attribute the accrual's balance jump to the
    // usage. V8's sort is already stable, but seq makes that a guarantee of
    // this function rather than of the engine — the balance-delta path is the
    // one place where row order changes the reported hours.
    var list = byEmpRows[emp].slice()
      .sort(function (a, b) { return (a.r.date - b.r.date) || (a.seq - b.seq); })
      .map(function (x) { return x.r; });
    var prevBalance = null;
    list.forEach(function (r) {
      var t = String(r.adjType || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      var isUsage = t.indexOf("usage") !== -1 || t.indexOf("timeoff") !== -1;
      if (isUsage) {
        var hrs = r.amount !== null && r.amount !== undefined && !isNaN(r.amount)
          ? Math.abs(r.amount)
          : (prevBalance !== null && r.balance !== null && r.balance !== undefined
              ? Math.abs(r.balance - prevBalance) : null);
        if (hrs === null) { skipped++; }
        else {
          if (unit === "days") hrs *= hoursPerDay;
          var iso = weekKeyFromDate_(r.date);
          if (!byEmp[emp]) byEmp[emp] = {};
          byEmp[emp][iso] = (byEmp[emp][iso] || 0) + hrs;
        }
      }
      if (r.balance !== null && r.balance !== undefined && !isNaN(r.balance)) prevBalance = r.balance;
    });
  });
  return { byEmp: byEmp, skipped: skipped };
}

/**
 * Accumulation Cost reader (GAS): dated PTO transactions keyed by Employee
 * Number → weekly usage map via ptoUsageFromRows_. { ok:false } on any
 * failure — the caller falls back to the NETSUITE rows.
 */
function readPtoAccum_() {
  try {
    var p = PropertiesService.getScriptProperties();
    var ssId = p.getProperty("DH_PTO_SS_ID") || CONFIG_DH.PTO_ACCUM_SS_ID;
    var sh = SpreadsheetApp.openById(ssId).getSheetByName(CONFIG_DH.PTO_ACCUM_SHEET);
    if (!sh) return { ok: false, byEmp: {}, error: 'Tab "' + CONFIG_DH.PTO_ACCUM_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { ok: false, byEmp: {}, error: "no data rows" };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee Number"]);
    var iDate = colIdx_(h, ["Date"]);
    var iBal = colIdx_(h, ["Balance"]);
    var iType = colIdx_(h, ["Adjustment Type"]);
    var iAmt = colIdx_(h, ["Amount", "Hours", "AdjustmentAmount", "AdjustmentHours"]);
    if (iEmp === -1 || iDate === -1 || iType === -1) {
      return { ok: false, byEmp: {}, error: "required columns missing (Employee Number/Date/Adjustment Type)" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var empRaw = raw[r][iEmp];
      var empNum = String(typeof empRaw === "number" ? Math.round(empRaw) : (empRaw || ""))
        .replace(/,/g, "").trim();
      if (!empNum) continue;
      var amt = iAmt === -1 ? null : parseFloat(raw[r][iAmt]);
      rows.push({ empNum: empNum, date: parseDhDate_(raw[r][iDate]),
                  adjType: String(raw[r][iType] || ""),
                  amount: isNaN(amt) ? null : amt,
                  balance: iBal === -1 ? null : (isNaN(parseFloat(raw[r][iBal])) ? null : parseFloat(raw[r][iBal])) });
    }
    var usage = ptoUsageFromRows_(rows, CONFIG_DH.PTO_UNIT, CONFIG_DH.PTO_HOURS_PER_DAY);
    return { ok: true, byEmp: usage.byEmp, skipped: usage.skipped, rowCount: rows.length };
  } catch (e) {
    return { ok: false, byEmp: {}, error: "Accumulation Cost read failed: " + e.message };
  }
}

/** True when a Tempo Key is a NETSUITE/time-off row. */
function isTimeOffKey_(key) {
  return CONFIG_DH.NONPROJECT_KEYS.some(function (k) {
    return String(key || "").toUpperCase().indexOf(k.toUpperCase()) === 0;
  });
}

/**
 * NS Billable daily rows → aggregateNsWeeks_ input.
 * Headers: Employee, Employee Type Category, Billable Hours Billed,
 * Billable Hours Unbilled, Total Billable Hours, Non-Billable Hours,
 * Total Hours (B+NB), Date.
 */
function readNsBillable_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.NS_SHEET);
    if (!sh) return { rows: [], error: 'Tab "' + CONFIG_DH.NS_SHEET + '" not found' };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { rows: [] };
    var h = raw[0].map(String);
    var iEmp = colIdx_(h, ["Employee", "Resource"]);
    var iBill = colIdx_(h, ["Total Billable Hours", "Total Billable"]);
    var iNon = colIdx_(h, ["Non-Billable Hours", "Non-Billable"]);
    var iDate = colIdx_(h, ["Date"]);
    if (iEmp === -1 || iDate === -1 || iBill === -1) {
      return { rows: [], error: "NS Billable: required columns missing" };
    }
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var emp = String(raw[r][iEmp] || "").trim();
      var d = parseDhDate_(raw[r][iDate]);
      if (!emp || !d) continue;
      rows.push({ name: emp, date: d,
                  billable: Number(raw[r][iBill]) || 0,
                  nonBillable: iNon === -1 ? 0 : Number(raw[r][iNon]) || 0 });
    }
    return { rows: rows };
  } catch (e) {
    return { rows: [], error: "NS Billable read failed: " + e.message };
  }
}

/** PH tab (Date | Location | Holiday) → [{date, location}]. */
function readHolidays_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.PH_SHEET);
    if (!sh) return { rows: [] };  // silently off per spec §7
    var raw = sh.getDataRange().getValues();
    var h = raw[0].map(String);
    var iDate = colIdx_(h, ["Date"]), iLoc = colIdx_(h, ["Location"]);
    if (iDate === -1 || iLoc === -1) return { rows: [] };
    var rows = [];
    for (var r = 1; r < raw.length; r++) {
      var d = parseDhDate_(raw[r][iDate]);
      var loc = String(raw[r][iLoc] || "").trim();
      if (d && loc) rows.push({ date: d, location: loc });
    }
    return { rows: rows };
  } catch (e) { return { rows: [] }; }
}

/**
 * Fuzzy PH-location ↔ roster Key Location matcher — ported verbatim from the
 * demand dashboard's phLocMatchesEmp_ (compound locations split on "&"/"and"/"/",
 * case-insensitive substring both directions, blank never matches).
 */
function phLocMatchesEmp_(phLoc, empLoc) {
  var a = normDH_(phLoc), b = normDH_(empLoc);
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  var parts = a.split(/\s*(?:&|\band\b|\/)\s*/).filter(Boolean);
  return parts.some(function (p) {
    return p.indexOf(b) !== -1 || b.indexOf(p) !== -1;
  });
}

/** Status names that mean the item is no longer open work (Jira Backlog.js convention). */
var DH_CLOSED_STATUS_ = /done|closed|resolved|complete|cancel|abandon|reject|won'?t|duplicate|deploy/i;

/**
 * The Metrics Dictionary's "Client Commitment" label, matched loosely because
 * label conventions drift across projects (`client-commitment`,
 * `ClientCommitment`, `client_commitment` are all the same intent).
 * Word-bounded on "client" so an unrelated `client-portal` label can't smuggle
 * an issue into the On-Time denominator.
 */
var DH_CLIENT_COMMITMENT_ = /\bclient[\s_-]*commitment\b/i;

/**
 * Jira Raw → issues + epics for the tile buckets, keyRegion for person-region,
 * openIssues (unresolved, assigned) for the per-person backlog drill-down.
 * Columns by header name: Key(1), Work (Summary)(2), Workstream (Issue Type)(3),
 * Assignee(5), Priority(7), Status(8), Resolution Date(11), Due Date(12),
 * Epic Key(17), Original Estimate (sec)(23), Time Spent (sec)(24).
 * Rows repeat per weekly snapshot — dedupe on Key keeping the LAST occurrence
 * (latest snapshot wins).
 * @returns {{ issues:[], epics:[], openIssues:[], keyRegion:Object, available:boolean, error?:string }}
 */
function readJiraRaw_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
    if (!sh) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var raw = sh.getDataRange().getValues();
    if (raw.length < 2) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var h = raw[0].map(String);
    var iKey = colIdx_(h, ["Key"]);
    var iSummary = colIdx_(h, ["Work (Summary)", "Summary"]);
    var iType = colIdx_(h, ["Workstream (Issue Type)", "Issue Type"]);
    var iAssignee = colIdx_(h, ["Assignee"]);
    var iPriority = colIdx_(h, ["Priority"]);
    var iStatus = colIdx_(h, ["Status"]);
    var iRes = colIdx_(h, ["Resolution Date", "Resolved"]);
    var iDue = colIdx_(h, ["Due Date"]);
    var iEst = colIdx_(h, ["Original Estimate (sec)"]);
    var iSpent = colIdx_(h, ["Time Spent (sec)"]);
    // Region / Team: the columns are BACK (Jira Backlog.js v3.4.0 restored them
    // after v3.3.0 dropped them) but the underlying Jira custom fields are still
    // unpopulated, so they export blank — every row lands in "Unassigned" until
    // PR-01 closes. Person region therefore still resolves from the roster
    // (assignPersonRegion_ source:"roster") and team vocabulary from Tempo.
    // The gap is not hidden: hygieneBuckets_ counts it and the Data Hygiene view
    // trends it with Gon's name against it (§4.2).
    var iRegion = colIdx_(h, ["Region"]);
    var iTeam = colIdx_(h, ["Team"]);
    // ── Metrics-Dictionary columns (Jira Backlog.js v3.6.0, append-only) ──
    // All resolved BY HEADER, all optional: colIdx_ returns -1 on an older
    // export and every consumer below degrades to "not measured" rather than to
    // a false zero. That is what lets the export and the dashboard deploy in
    // either order.
    var iLabels = colIdx_(h, ["Labels"]);
    var iResName = colIdx_(h, ["Resolution"]);
    var iStatCat = colIdx_(h, ["Status Category"]);
    var iRework = colIdx_(h, ["Rework Link"]);
    var iReopen = colIdx_(h, ["Reopened"]);
    if (iKey === -1) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    var byKey = {};
    for (var r = 1; r < raw.length; r++) {
      var key = String(raw[r][iKey] || "").trim().toUpperCase();
      if (!key) continue;
      // Jira Raw carries one row per issue PER WEEK BUCKET, and Jira Backlog.js
      // rewrites the whole tab (clearContents + setValues) on every export — so
      // duplicate rows for a key all come from the same API fetch and differ
      // only in the week label, which this dashboard never reads. Any row is
      // therefore equivalent; keeping the last is arbitrary, not chronological.
      //
      // NFR-10 / CA-04: this is why "last row wins" is safe here, and it holds
      // only while the tab stays export-owned. The constraint is: Jira Raw is
      // rewritten whole on every run and is never hand-edited or re-sorted
      // between runs. If incremental writes are ever introduced, this dedup must
      // change with them — add a Snapshot Date column and keep MAX(date) per key.
      // (The v1.1 audit flagged a re-sort as a live risk; it isn't today, because
      // the rows carry no ordering the dashboard depends on.)
      byKey[key] = r;
    }
    var issues = [], epics = [], openIssues = [], keyRegion = {}, regionRaw = {};
    Object.keys(byKey).forEach(function (key) {
      var r = byKey[key];
      // Region vocabulary is normalised HERE, at ingestion (§4.3) — the rest of
      // the codebase only ever sees AMER/EMEA/APAC/ANZ/Other/Unassigned.
      var rawRegion = iRegion === -1 ? "" : String(raw[r][iRegion] || "").trim();
      var region = mapRegionToDh_(rawRegion);
      var team = iTeam === -1 ? "" : String(raw[r][iTeam] || "").trim();
      if (rawRegion && region !== DH_REGION_UNASSIGNED_) keyRegion[key] = region;
      // Raw tally for probeDeliverySources: once the mapping runs, every value
      // downstream is already in the vocabulary, so a probe over MAPPED values
      // can only ever report "✅ all match" — which verifies nothing. The raw
      // counts are what tell you an option value is missing from the table.
      var rawKey = rawRegion || "(blank)";
      regionRaw[rawKey] = (regionRaw[rawKey] || 0) + 1;
      var type = iType === -1 ? "" : normDH_(raw[r][iType]);
      var isEpic = type.indexOf("epic") !== -1;
      var labels = iLabels === -1 ? "" : String(raw[r][iLabels] || "");
      var statCat = iStatCat === -1 ? "" : String(raw[r][iStatCat] || "").trim();
      var reopenCell = iReopen === -1 ? "" : String(raw[r][iReopen] || "").trim();
      var rec = {
        isEpic: isEpic,
        // The Metrics Dictionary scopes On-Time to "issue type Epic/Milestone OR
        // Client Commitment label", so both signals have to survive ingestion.
        isMilestone: /milestone/.test(type),
        isClientCommitment: DH_CLIENT_COMMITMENT_.test(labels),
        due: iDue === -1 ? null : parseDhDate_(raw[r][iDue]),
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        estSec: iEst === -1 ? 0 : Number(raw[r][iEst]) || 0,
        spentSec: iSpent === -1 ? 0 : Number(raw[r][iSpent]) || 0,
        region: region, team: team,
        assignee: iAssignee === -1 ? "" : String(raw[r][iAssignee] || "").trim(),
        // ── Quality / Rework inputs ──
        // resolution: the dictionary's denominator is work DELIVERED, so
        // Won't Do / Duplicate / Incomplete are excluded — they were never
        // delivered, and counting them would deflate the rework rate.
        resolution: iResName === -1 ? "" : String(raw[r][iResName] || "").trim(),
        // statusCategory is authoritative "Done"; fall back to the status-name
        // regex only on a pre-v3.6.0 export that has no such column.
        statusCategory: statCat,
        reworkLink: iRework !== -1 && /^y/i.test(String(raw[r][iRework] || "")),
        // TRISTATE, deliberately: true / false / null = "nobody looked".
        // A blank cell must never read as "not reopened" — that silently
        // deflates the rate, which is the failure the coverage gates exist for.
        reopened: reopenCell === "" ? null : /^y/i.test(reopenCell),
      };
      issues.push(rec);
      if (isEpic) epics.push(rec);
      // Open backlog: assigned, unresolved, status not closed-ish, not an epic
      // (epics roll up their children — listing both would double the load).
      var assignee = rec.assignee;
      var status = iStatus === -1 ? "" : String(raw[r][iStatus] || "").trim();
      if (assignee && !/unassigned/i.test(assignee) && !rec.resolved &&
          !DH_CLOSED_STATUS_.test(status) && !isEpic) {
        openIssues.push({
          key: key,
          summary: iSummary === -1 ? "" : String(raw[r][iSummary] || "").trim(),
          assignee: assignee, status: status,
          priority: iPriority === -1 ? "" : String(raw[r][iPriority] || "").trim(),
          due: rec.due,
          remHrs: Math.max(0, rec.estSec - rec.spentSec) / 3600,
        });
      }
    });
    return { issues: issues, epics: epics, openIssues: openIssues, keyRegion: keyRegion,
             regionRaw: regionRaw, available: true };
  } catch (e) {
    return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false, error: e.message };
  }
}

/**
 * Groups open Jira issues by roster person (name-alias join). Items sorted by
 * remaining estimate DESC then due ASC, capped at BACKLOG_MAX_ITEMS per person —
 * count/estHrs totals always cover ALL of the person's open issues.
 * @returns {Object} display name → { count, remHrs, items:[] }
 */
function backlogByPerson_(openIssues, nameIdx) {
  var by = {};
  (openIssues || []).forEach(function (it) {
    var dn = resolveName_(nameIdx, it.assignee);
    if (!dn) return; // not in population
    if (!by[dn]) by[dn] = { count: 0, remHrs: 0, items: [] };
    by[dn].count++;
    by[dn].remHrs += it.remHrs;
    by[dn].items.push({ key: it.key, summary: it.summary, status: it.status,
                        priority: it.priority, remHrs: it.remHrs,
                        due: it.due ? weekKeyFromDate_(it.due) : "" });
  });
  Object.keys(by).forEach(function (dn) {
    by[dn].items.sort(function (a, b) {
      if (b.remHrs !== a.remHrs) return b.remHrs - a.remHrs;
      return (a.due || "9999").localeCompare(b.due || "9999");
    });
    by[dn].items = by[dn].items.slice(0, CONFIG_DH.BACKLOG_MAX_ITEMS);
    by[dn].remHrs = Math.round(by[dn].remHrs * 10) / 10;
  });
  return by;
}

// ── MODEL ASSEMBLY (pure — all reader outputs injected) ──────

function assembleModel_(inputs, win) {
  if (inputs.roster.error) {
    return { meta: {}, people: [], onTimeBuckets: [], forecastBuckets: [],
             error: inputs.roster.error };
  }
  // Population = tracking-mandated families only (JF007/JF009 + blank/crew).
  // Non-tracking families are dropped ENTIRELY — their capacity means nothing
  // without a planning+tracking obligation (user decision 2026-07-31).
  var population = inputs.roster.people.filter(function (p) { return p.tracks !== false; });
  var displayNames = population.map(function (p) { return p.name; });
  var nameIdx = buildNameIndex_(displayNames);
  // ── ISSUE-ATTRIBUTION INDEX (2026-08-04, user decision) ─────────────────────
  // Delivery metrics attribute against the WHOLE active roster — Data tab AND
  // Contractors — not just the utilization population above. nameIdx keeps
  // scoping Tempo/NS/backlog joins (capacity math stays population-only);
  // attribIdx feeds resolvePerson only. Population names go in first so their
  // display strings win any alias collision. Falls back to the population when
  // an injected/legacy roster has no attrib list.
  var attribPeople = inputs.roster.attrib || [];
  var attribIdx = buildNameIndex_(
    displayNames.concat(attribPeople.map(function (p) { return p.name; })));
  var byPerson = {}; // display name → accumulator
  population.forEach(function (p) {
    byPerson[p.name] = { roster: p, teams: [], pms: [], weeks: {}, regionHours: {} };
  });

  // Tempo tracked/planned rows → per-person weekly sums, team collection,
  // PTO (NETSUITE planned rows), region-tagged hours (tracked keys × Jira Region)
  function eachTempoRow_(row, kind) {
    var dn = resolveName_(nameIdx, row.user);
    if (!dn) return; // not in population — excluded per spec §7
    var acc = byPerson[dn];
    splitTeams_(row.teamCell).forEach(function (t) {
      if (acc.teams.indexOf(t) === -1) acc.teams.push(t);
    });
    var timeOff = isTimeOffKey_(row.key);
    // PM membership: the person works on a project this PM leads (never from
    // NETSUITE time-off rows — those carry no project).
    if (row.pm && !timeOff && acc.pms.indexOf(row.pm) === -1) acc.pms.push(row.pm);
    Object.keys(row.weekHours).forEach(function (iso) {
      if (win.allWeeks.indexOf(iso) === -1) return;
      if (!acc.weeks[iso]) acc.weeks[iso] = { pto: 0, planned: 0, tracked: 0 };
      var h = row.weekHours[iso];
      if (kind === "planned") {
        if (timeOff) acc.weeks[iso].pto += h;
        else acc.weeks[iso].planned += h;
      } else if (!timeOff) {
        acc.weeks[iso].tracked += h;
        var region = inputs.jira.keyRegion[row.key];
        if (region) acc.regionHours[region] = (acc.regionHours[region] || 0) + h;
      }
    });
  }
  inputs.planned.rows.forEach(function (r) { eachTempoRow_(r, "planned"); });
  inputs.tracked.rows.forEach(function (r) { eachTempoRow_(r, "tracked"); });

  // NS billable weekly aggregation, joined through the alias index.
  // Unmatched employee names are counted, not just dropped: a silent join failure
  // reads downstream as "this person billed nothing", which is indistinguishable
  // from a real 0% — so meta.nsCoverage reports it (audit fix 2026-08-03).
  var nsAvailable = !inputs.ns.error;
  var ptoAccumOk = !!(inputs.pto && inputs.pto.ok);
  var ptoByEmp = ptoAccumOk ? inputs.pto.byEmp : {};
  var nsUnmatched = { rows: 0, hours: 0, names: {} };
  var nsWeekly = aggregateNsWeeks_(inputs.ns.rows.map(function (r) {
    var dn = resolveName_(nameIdx, r.name);
    if (!dn) {
      nsUnmatched.rows++;
      nsUnmatched.hours += (Number(r.billable) || 0) + (Number(r.nonBillable) || 0);
      nsUnmatched.names[String(r.name || "").trim()] = 1;
      return null;
    }
    return { name: dn, date: r.date, billable: r.billable, nonBillable: r.nonBillable };
  }).filter(Boolean));

  // Holiday hours per person-week (fuzzy location match, per-day hours by region)
  var holByPersonWeek = {}; // dn → iso → hrs
  inputs.holidays.rows.forEach(function (hrow) {
    var iso = weekKeyFromDate_(hrow.date);
    if (win.allWeeks.indexOf(iso) === -1) return;
    population.forEach(function (p) {
      if (!phLocMatchesEmp_(hrow.location, p.keyLocation)) return;
      var perDay = normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
        ? CONFIG_DH.ANZ_HOLIDAY_HRS_PER_DAY : CONFIG_DH.HOLIDAY_HRS_PER_DAY;
      if (!holByPersonWeek[p.name]) holByPersonWeek[p.name] = {};
      holByPersonWeek[p.name][iso] = (holByPersonWeek[p.name][iso] || 0) + perDay;
    });
  });

  // Assemble people records
  var capMap = inputs.capacity.byName || {};
  var backlogMap = backlogByPerson_(inputs.jira.openIssues, nameIdx);
  var teamSet = {}, famSet = {}, pmSet = {};
  var people = displayNames.slice().sort(function (a, b) {
    return a.localeCompare(b);
  }).map(function (dn) {
    var acc = byPerson[dn], p = acc.roster;
    var reg = assignPersonRegion_(acc.regionHours, p.rosterBucket);
    acc.teams.forEach(function (t) { teamSet[t] = 1; });
    acc.pms.forEach(function (m) { pmSet[m] = 1; });
    famSet[p.jobFamily || "Uncatalogued"] = 1;
    var weeks = {};
    win.allWeeks.forEach(function (iso) {
      // Pre-hire weeks do not exist for this person: no capacity, no metric
      // denominators, no grid cell (user decision 2026-07-31 — a new hire must
      // never drag any metric for weeks before they were in the company).
      if (p.hireDate && isoWeekBefore_(iso, p.hireDate)) return;
      var w = acc.weeks[iso] || { pto: 0, planned: 0, tracked: 0 };
      var capCell = capMap[normDH_(dn)] ? capMap[normDH_(dn)][iso] : undefined;
      var capEst = capCell === undefined;
      var cap = capEst
        ? (normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
            ? CONFIG_DH.ANZ_CAPACITY_HRS : CONFIG_DH.WEEKLY_CAPACITY_HRS)
        : capCell;
      var holHrs = (holByPersonWeek[dn] && holByPersonWeek[dn][iso]) || 0;
      // PTO precedence (user decision 2026-08-01): the Accumulation Cost ledger
      // (joined by Employee Number) is the source of truth; the NETSUITE rows
      // in Planned Time Tempo are only the fallback when that workbook is
      // unreadable or the person has no Employee Number.
      var ptoH = w.pto;
      if (ptoAccumOk) {
        ptoH = (p.empNum && ptoByEmp[p.empNum] && ptoByEmp[p.empNum][iso]) || 0;
        if (!p.empNum) ptoH = w.pto; // no join key → keep NETSUITE rows for this person
      }
      var net = netCapacity_(cap, ptoH, holHrs);
      var ns = (nsWeekly[normDH_(dn)] && nsWeekly[normDH_(dn)][iso]) || { billable: 0, nonBillable: 0 };
      // ── NS CLASSIFIES, TEMPO QUANTIFIES (user decision 2026-08-03) ──
      // Tempo is the source of truth for HOW MANY hours were worked; NS is the
      // source of truth for WHAT KIND. So the NS billable/non-billable split is
      // applied as a RATIO to the Tempo tracked total rather than being carried
      // as absolute hours.
      //
      // Why: the two feeds are independent, so NS absolutes are not bounded by
      // hours anyone actually logged. Carrying them directly let billable hours
      // exceed tracked hours, and billable ÷ available then reported utilization
      // that no worklog supported — the headline inflated by exactly the feed
      // disagreement. Under the ratio, billable + nonBillable === tracked by
      // construction, so billableUtil can never exceed trackedUtil.
      //
      // NS "Non-Billable Hours" = REAL project non-billable work. PTO/holidays
      // live ONLY in the Time off Report (the NETSUITE rows + PH tab feeding
      // pto/hol above) — they never appear in this bucket, so nothing is netted
      // out (user clarification 2026-08-01, reverting the same-day OOO
      // subtraction). PTO's only metric effect is shrinking the avail denominator.
      var nsTot = ns.billable + ns.nonBillable;
      // No NS signal for this person-week = UNCLASSIFIABLE, not 0% billable. The
      // week keeps its tracked hours but leaves the billable numerator AND its
      // matching denominator (availCov) entirely — otherwise an export that lags
      // or covers fewer weeks than the trend window paints real zeros and the
      // sparkline shows a ramp that is pure coverage.
      var nsCov = nsAvailable && nsTot > 0;
      var share = nsCov ? ns.billable / nsTot : null;
      weeks[iso] = { cap: cap, capEst: capEst, pto: ptoH, hol: net.hol, avail: net.avail,
                     planned: w.planned, tracked: w.tracked,
                     nsCov: nsCov,
                     availCov: nsCov ? net.avail : 0,
                     // capCov = GROSS scheduled capacity of NS-classified weeks.
                     // The Metrics Dictionary's Utilization denominator is
                     // "headcount × standard hours", i.e. capacity BEFORE PTO
                     // and holidays are removed. Summing per-person `cap` gives
                     // exactly that, and handles part-timers better than a flat
                     // headcount × 40 would. It has to be coverage-matched the
                     // same way availCov is, or an unclassified week would sit
                     // in the denominator with a forced-zero numerator.
                     capCov: nsCov ? cap : 0,
                     trackedCov: nsCov ? w.tracked : 0,
                     billShare: share,
                     billable: nsCov ? w.tracked * share : 0,
                     nonBillable: nsCov ? w.tracked * (1 - share) : 0,
                     // Finance's raw NS absolutes, kept for the drill-down and the
                     // reconciliation flag — never used in any rate.
                     nsBillRaw: ns.billable, nsNonBillRaw: ns.nonBillable };
    });
    return { name: dn, region: reg.region, regionSource: reg.source,
             teams: acc.teams.slice().sort(), pms: acc.pms.slice().sort(), isCrew: p.isCrew,
             jobTitle: p.jobTitle || "",
             onLeave: p.onLeave === true, leaveStatus: p.leaveStatus || "",
             // Manager = M career track in the title level token, parsed the
             // same way CompDash splits managers from ICs (dhLevelTrack_).
             isManager: dhLevelTrack_(p.jobTitle).track === "M",
             jobFamily: p.jobFamily || "", tracks: p.tracks !== false,
             newHire: isDhNewHire_(p.hireDate, win.today || new Date()),
             hired: dhDateStr_(p.hireDate),
             backlog: backlogMap[dn] || null, weeks: weeks };
  });

  // Jira buckets, person-attributed via Assignee → roster (user decision
  // 2026-07-31: every filter drives every KPI card). Bucket teams no longer
  // feed the Team dropdown — the vocabulary is Tempo teams only.
  var resolvePerson = function (raw) { return raw ? resolveName_(attribIdx, raw) : null; };
  var onTime = inputs.jira.available
    ? onTimeBuckets_(inputs.jira.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  var forecast = inputs.jira.available
    ? forecastBuckets_(inputs.jira.epics, resolvePerson) : { buckets: [], unattributed: 0 };
  var hygiene = inputs.jira.available
    ? hygieneBuckets_(inputs.jira, resolvePerson) : [];
  var rework = inputs.jira.available
    ? reworkBuckets_(inputs.jira.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  // PM vocabulary comes from the Tempo project rows, which carry whoever led the
  // project at the time — including people who have since left. Gate it on the
  // roster so the filter and the PM comparison chart describe the people who can
  // actually be asked about the work.
  var activePms = filterActiveNames_(Object.keys(pmSet), inputs.roster);

  // Attribution-only stubs: a bucket person outside the utilization population
  // still needs a person record — the client joins every bucket to
  // MODEL.people and drives it through the universal filters. Stubs carry
  // identity fields only (weeks: {}), so they can never move a capacity or
  // hygiene denominator; the client keeps them out of the grid, the scope
  // headcount and the dropdown counts via the attribOnly flag. Only persons
  // the buckets actually reference ship, so the payload grows by the people
  // who did work, not by the whole company.
  var attribByNorm = {};
  attribPeople.forEach(function (p) { attribByNorm[normDH_(p.name)] = p; });
  var referenced = {};
  [onTime.buckets, forecast.buckets, rework.buckets].forEach(function (bs) {
    (bs || []).forEach(function (b) { if (b.person) referenced[b.person] = 1; });
  });
  Object.keys(referenced).sort().forEach(function (dn) {
    if (byPerson[dn]) return;                 // already a population person
    var rec = attribByNorm[normDH_(dn)];
    if (!rec) return;                         // unknown name — cannot stub it
    var reg = assignPersonRegion_({}, rec.rosterBucket);
    people.push({ name: dn, region: reg.region, regionSource: reg.source,
                  teams: [], pms: [], isCrew: rec.isCrew === true,
                  jobTitle: rec.jobTitle || "",
                  onLeave: false, leaveStatus: "",
                  isManager: dhLevelTrack_(rec.jobTitle || "").track === "M",
                  jobFamily: rec.jobFamily || "", tracks: false,
                  newHire: isDhNewHire_(rec.hireDate, win.today || new Date()),
                  hired: dhDateStr_(rec.hireDate),
                  backlog: null, weeks: {}, attribOnly: true });
  });

  return {
    schemaVer: DH_SCHEMA_VER_,
    meta: {
      gridWeeks: win.gridWeeks, trendWeeks: win.trendWeeks, headlineIso: win.headlineIso,
      periods: buildPeriods_(win),
      generatedAt: new Date().toISOString(),
      thresholds: { green: CONFIG_DH.TINT_GREEN, amber: CONFIG_DH.TINT_AMBER },
      targets: CONFIG_DH.TARGETS,
      regions: ["AMER", "EMEA", "APAC", "ANZ", "Other"],
      teams: Object.keys(teamSet).sort(),
      pms: activePms.kept.sort(),
      // Count only — the tooltip says how many former employees were removed
      // without listing people who have left the company on a dashboard.
      pmsDropped: activePms.dropped.length,
      families: Object.keys(famSet).sort(),
      nsAvailable: nsAvailable, jiraAvailable: !!inputs.jira.available,
      // NS join/coverage telemetry — the billable split is only as good as this.
      // Reported so a low rate can be read as "poor coverage" vs "low billing",
      // the same way jiraUnattributed qualifies the issue tiles.
      nsCoverage: nsCoverage_(people, nsUnmatched),
      jiraUnattributed: { onTime: onTime.unattributed, forecast: forecast.unattributed,
                          rework: rework.unattributed },
      // Which issue types the On-Time rate covers — the card names it so the
      // number is never read as "all delivery work" when it isn't.
      onTimeScope: CONFIG_DH.ONTIME_SCOPE || "delivery",
      forecastBand: CONFIG_DH.FORECAST_BAND || 0.10,
      // Only an explicit true suppresses. A cached model predating this field
      // therefore publishes rather than going dark for the rest of the TTL —
      // the safer failure direction for a flag whose shipped value is false.
      suppressBelowGate: CONFIG_DH.SUPPRESS_BELOW_GATE === true,
      ptoSource: ptoAccumOk ? "accumulation" : "netsuite-fallback",
      capacityError: inputs.capacity.error || null,
      // Canonical metric definitions, targets, coverage gates, owners and known
      // deviations (FR-1.1). The client renders labels, tooltips, the RAG bands
      // and the suppressed state from this — never from its own constants.
      registry: registryWithOverrides_(readGateOverrides_()),
      // Source systems + refresh cadence (FR-2.5): every view has to be able to
      // say where its numbers came from and how fresh they are.
      sources: [
        { system: "Jira (via Exec Contribution Tracker export)", feeds: "On-Time, Forecast, backlog", tab: CONFIG_DH.JIRA_RAW_SHEET },
        { system: "Tempo", feeds: "tracked hours, planned hours, capacity",
          tab: [CONFIG_DH.TRACKED_SHEET, CONFIG_DH.PLANNED_SHEET, CONFIG_DH.CAPACITY_SHEET].join(" · ") },
        { system: "NetSuite", feeds: "billable / non-billable classification", tab: CONFIG_DH.NS_SHEET },
        { system: "PTO ledger", feeds: "PTO hours", tab: CONFIG_DH.PTO_ACCUM_SHEET },
        { system: "Roster", feeds: "population, job family, region fallback, hire dates", tab: CONFIG_DH.ROSTER_SHEET },
      ],
      refreshEveryMin: CONFIG_DH.CACHE_WARM_EVERY_MIN,
    },
    people: people, onTimeBuckets: onTime.buckets, forecastBuckets: forecast.buckets,
    reworkBuckets: rework.buckets,
    hygieneBuckets: hygiene,
  };
}

/**
 * Payload schema version — BUMP THIS on every payload-shape change (new/renamed
 * fields, re-keyed buckets). getDeliveryData treats a cached model with a
 * different schemaVer as a clean miss, so a deploy can never serve a
 * stale-shaped cache entry (the "empty cards until someone busts the cache" bug).
 */
// v5: On-Time excludes epics; forecast buckets gain nNoTime/nOver/nUnder/
//     lossOver/lossUnder (variance direction) and skip zero-worklog epics.
// v6: WEEKS_PAST_DEEP 30 → 52. The shape is unchanged, but a cached v5 model
//     carries only 34 weeks of people[].weeks — served as-is, the Quarterly
//     view would render its older quarters as empty (which reads as zero
//     activity, not missing data). Bumping forces one clean rebuild.
// v7: billable/nonBillable are now the NS split applied as a RATIO to Tempo
//     tracked hours, not NS absolute hours. New per-week fields nsCov/availCov/
//     trackedCov/billShare/nsBillRaw/nsNonBillRaw + meta.nsCoverage. A cached v6
//     model would keep serving the inflated absolutes against the wrong
//     denominator, so this MUST force a rebuild.
// v8: Forecast Accuracy re-formulated to the ±10% binary band (FR-1.4) — the
//     buckets lose sumAcc/nOver/nUnder/lossOver/lossUnder and gain nWithin/
//     absVars/nMissOver/nMissUnder, so a cached v7 model would render the
//     forecast tile as 0% (no nWithin anywhere). Also adds hygieneBuckets and
//     meta.registry/sources/forecastBand, and normalises Jira Region to the
//     AMER/EMEA/APAC/ANZ/Other/Unassigned vocabulary at ingestion.
// v9: hygieneBuckets gain resReady (due date + roster assignee, region excluded).
//     Without it the Data Hygiene headline is pinned at 0% for as long as the
//     Jira Region field stays unpopulated, so no amount of due-date or assignee
//     progress would ever show. A cached v8 model has no resReady and would
//     render that second figure as 0%.
// v10: METRICS-DICTIONARY CONFORMANCE PASS (2026-08-03). New payload fields:
//      people[].weeks[].capCov (gross NS-classified capacity, the dictionary
//      Utilization denominator), reworkBuckets (metric #4, previously a
//      placeholder tile), issue records carry resolution/statusCategory/
//      reworkLink/reopened, and meta.jiraUnattributed.rework. On-Time also
//      changes SCOPE (delivery -> dictionary) and Forecast changes FORMULA,
//      so a v9 entry would serve the old readings under the new labels.
// v11: hygieneBuckets gain resAssigned — 'has a Jira assignee' split from
//      'assignee resolves to a roster person'. Two gaps, two owners; a v10
//      entry has no resAssigned and the split row would read 0%.
// v12: WHOLE-ROSTER ISSUE ATTRIBUTION (2026-08-04) — resolvePerson joins
//      against every active roster row (Data + Contractors, pre-gates), and
//      people[] gains weeks-less attribOnly stubs for bucket persons outside
//      the utilization population. A cached v11 model was built on the narrow
//      index (measured: it dropped 173 of 351 assigned issues), so it MUST
//      miss cleanly — serving it would keep every card undercounting.
// v13: attribution index also covers INACTIVE roster rows (leavers) — the
//      live tiles showed "419 unattributed" across the 52-week window, mostly
//      historical work by people who have since left; their names are on the
//      roster, just on terminated rows. Population stays active-only. A cached
//      v12 model was bucketed without leaver attribution, so it must rebuild.
var DH_SCHEMA_VER_ = 13;

/** Full I/O compute — shared by getDeliveryData and warmDeliveryCache. */
function buildDeliveryModel_() {
  var win = buildDhWindow_(new Date());
  return assembleModel_({
    roster: readRosterPeople_(),
    capacity: readCapacitySheet_(),
    tracked: readTempoGrid_(CONFIG_DH.TRACKED_SHEET),
    planned: readTempoGrid_(CONFIG_DH.PLANNED_SHEET),
    ns: readNsBillable_(),
    pto: readPtoAccum_(),
    holidays: readHolidays_(),
    jira: readJiraRaw_(),
  }, win);
}

// ── ENTRY POINT + DATA ENDPOINT ──────────────────────────────

function doGet() {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return HtmlService.createHtmlOutput(buildAccessDeniedPage_(access.email))
      .setTitle(CONFIG_DH.TITLE + " — Access Restricted");
  }
  return HtmlService.createHtmlOutputFromFile("Dashboard")
    .setTitle(CONFIG_DH.TITLE)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function getDeliveryData(forceRefresh) {
  var access = checkDeliveryAccess();
  if (!access.allowed) {
    return { error: "Access restricted to authorized users.", meta: {}, people: [] };
  }
  var cache = CacheService.getScriptCache();
  var key = deliveryCacheKey_();
  if (!forceRefresh) {
    var hit = cacheGetLarge_(cache, key);
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        // Schema guard: a cache entry built by OLDER code has a different
        // shape — serving it renders empty/broken cards and users start
        // "fixing" it by refreshing. Mismatch = clean miss, recompute,
        // overwrite. Self-healing on every deploy; no manual bust needed
        // for shape changes (bustDeliveryCache_ remains for data resets).
        if (cached.schemaVer === DH_SCHEMA_VER_) {
          cached.viewerRole = access.role;
          cached.viewerEmail = access.email;
          return cached;
        }
        Logger.log("ℹ️ getDeliveryData: cache schema v" + cached.schemaVer +
                   " ≠ v" + DH_SCHEMA_VER_ + " — stale shape, recomputing");
      } catch (e) { Logger.log("⚠️ getDeliveryData: bad cache entry — recomputing"); }
    }
  }
  var model = buildDeliveryModel_();
  if (!model.error) cachePutLarge_(cache, key, JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  model.viewerRole = access.role;
  model.viewerEmail = access.email;
  return model;
}

// ── CACHE WARMER ─────────────────────────────────────────────

function warmDeliveryCache() {
  var s0 = Date.now();
  var model = buildDeliveryModel_();
  var secs = Math.round((Date.now() - s0) / 1000);
  if (model.error) { Logger.log("❌ warmDeliveryCache after " + secs + "s: " + model.error); return; }
  var ok = cachePutLarge_(CacheService.getScriptCache(), deliveryCacheKey_(),
                          JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
  Logger.log(ok ? "✅ warmDeliveryCache: rebuilt in " + secs + "s"
                : "❌ warmDeliveryCache: compute ok but cache write failed");
}

function setupDeliveryCacheWarmer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "warmDeliveryCache"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("warmDeliveryCache").timeBased()
    .everyMinutes(CONFIG_DH.CACHE_WARM_EVERY_MIN).create();
  Logger.log("✅ Delivery cache warmer installed — every " + CONFIG_DH.CACHE_WARM_EVERY_MIN + " min");
}

// ── DIAGNOSTICS (run once in the GAS editor after deploy) ────

/** Verifies every source is reachable and logs shape + join coverage. */
function probeDeliverySources() {
  var r = readRosterPeople_();
  Logger.log("Roster: " + r.people.length + " people" + (r.error ? " — ❌ " + r.error : ""));
  var c = readCapacitySheet_();
  Logger.log("Capacity: " + Object.keys(c.byName).length + " users" + (c.error ? " — ⚠️ " + c.error : ""));
  var t = readTempoGrid_(CONFIG_DH.TRACKED_SHEET);
  Logger.log("Tracked: " + t.rows.length + " rows / weeks " + t.weekIsos.join(","));
  var p = readTempoGrid_(CONFIG_DH.PLANNED_SHEET);
  Logger.log("Planned: " + p.rows.length + " rows");
  // PM coverage (feeds the PM filter): distinct PMs seen across both exports.
  var pmSeen = {};
  t.rows.concat(p.rows).forEach(function (row) { if (row.pm) pmSeen[row.pm] = (pmSeen[row.pm] || 0) + 1; });
  var pmNames = Object.keys(pmSeen);
  Logger.log(pmNames.length
    ? "PMs: " + pmNames.length + " distinct (" + pmNames.slice(0, 5).join(", ") + (pmNames.length > 5 ? ", …" : "") + ")"
    : "⚠️ PMs: none found — check the PM column exists in both Tempo export tabs (PM filter will be empty)");
  var ns = readNsBillable_();
  Logger.log("NS Billable: " + ns.rows.length + " rows" + (ns.error ? " — ⚠️ " + ns.error : ""));
  if (ns.rows.length) Logger.log("NS sample Employee: \"" + ns.rows[0].name + "\" (verify name format — spec §10.1)");
  var j = readJiraRaw_();
  Logger.log("Jira Raw: available=" + j.available + ", issues=" + j.issues.length +
             ", epics=" + j.epics.length + ", open assigned=" + j.openIssues.length);
  var idx = buildNameIndex_(r.people.map(function (x) { return x.name; }));
  var nsMatched = ns.rows.filter(function (row) { return resolveName_(idx, row.name); }).length;
  Logger.log("NS→roster join: " + nsMatched + "/" + ns.rows.length + " rows matched");

  // PTO source (Accumulation Cost ledger — primary since 2026-08-01)
  var pto = readPtoAccum_();
  if (!pto.ok) {
    Logger.log("⚠️ PTO Accumulation: UNREADABLE (" + (pto.error || "?") + ") — dashboard falls back to NETSUITE rows");
  } else {
    var emps = Object.keys(pto.byEmp);
    var withEmpNum = r.people.filter(function (x) { return x.empNum; }).length;
    var joined = r.people.filter(function (x) { return x.empNum && pto.byEmp[x.empNum]; }).length;
    var sample = [];
    emps.slice(0, 20).forEach(function (e) {
      Object.keys(pto.byEmp[e]).forEach(function (iso) { sample.push(pto.byEmp[e][iso]); });
    });
    var maxV = sample.length ? Math.max.apply(null, sample) : 0;
    Logger.log("PTO Accumulation: " + pto.rowCount + " tx rows, " + emps.length + " employees, " +
               pto.skipped + " amount-less usages skipped; roster empNum coverage " + withEmpNum + "/" +
               r.people.length + ", ledger join " + joined + " people");
    if (maxV > 0 && maxV <= 6) {
      Logger.log("⚠️ PTO unit check: max weekly usage sample is " + maxV +
                 " — values this small suggest the ledger is in DAYS; set CONFIG_DH.PTO_UNIT = \"days\"");
    }
  }

  // Region vocabulary check (final-review finding I3): the chip list is the
  // hardcoded meta.regions — Jira Region values that don't match it would make
  // every chip look empty. Any value logged outside the expected set must be
  // added to the chip vocabulary or mapped before trusting region filters.
  //
  // Jira Backlog.js v3.3.0 retired the Jira Raw "Region" column (it always
  // exported blank), so keyRegion is expected to be empty now and region comes
  // from the roster. That case is called out explicitly — an empty map would
  // otherwise sail through the check below and print "✅ all match", which reads
  // as a verified pass when nothing was actually checked.
  //
  // Probed over RAW values, not mapped ones: mapRegionToDh_ guarantees the
  // output vocabulary, so a check on its output could only ever print
  // "✅ all match" and would verify nothing. What matters is which raw option
  // values exist and which of them fall through to "Other" — that's the list to
  // take to Gon (open decision #1).
  var raw = j.regionRaw || {};
  var rawKeys = Object.keys(raw).filter(function (k) { return k !== "(blank)"; });
  var blanks = raw["(blank)"] || 0;
  if (!rawKeys.length) {
    Logger.log("ℹ️ Jira Region: " + blanks + " rows, ALL BLANK — expected until PR-01 " +
               "(the custom field isn't populated yet). Every issue lands in the Unassigned " +
               "bucket; the Data Hygiene view trends the gap. Person region resolves from the roster.");
  } else {
    var unmapped = rawKeys.filter(function (v) { return mapRegionToDh_(v) === CONFIG_DH.REGION_FALLBACK; });
    Logger.log("Jira Region raw values: " + JSON.stringify(raw));
    Logger.log("  → mapped: " + rawKeys.map(function (v) {
      return '"' + v + '" → ' + mapRegionToDh_(v);
    }).join(" · "));
    Logger.log(unmapped.length
      ? "⚠️ Region values falling through to \"Other\" — add them to JIRA_REGION_TO_DH_ (§4.3): " + unmapped.join(", ")
      : "✅ Every Jira Region value maps to a dashboard region");
    if (blanks) Logger.log("ℹ️ " + blanks + " rows have no Region → Unassigned bucket (PR-01, owner Gon)");
  }
}

/** Spec §10.5 — Jira Raw fill-rate audit. Run once before trusting the tiles. */
function auditJiraFillRates() {
  var sh = SpreadsheetApp.openById(dhSourceIds_().source).getSheetByName(CONFIG_DH.JIRA_RAW_SHEET);
  if (!sh) { Logger.log("❌ Jira Raw tab not found"); return; }
  var raw = sh.getDataRange().getValues();
  var h = raw[0].map(String);
  // Region/Team deliberately absent from this list — Jira Backlog.js v3.3.0
  // removed those columns, so auditing them would report a "❌ column missing"
  // defect for a decision, and train the reader to ignore this audit's ❌ lines.
  ["Due Date", "Original Estimate (sec)"].forEach(function (col) {
    var i = colIdx_(h, [col]);
    if (i === -1) { Logger.log("❌ column missing: " + col); return; }
    var filled = 0;
    for (var r = 1; r < raw.length; r++) if (String(raw[r][i] || "").trim()) filled++;
    Logger.log(col + ": " + filled + "/" + (raw.length - 1) + " filled (" +
               Math.round(filled / (raw.length - 1) * 100) + "%)");
  });
}

// ── TESTS ────────────────────────────────────────────────────

function _test_dhWindow_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_dhWindow_: " + m); }
  // 2026-07-31 is a Friday in ISO 2026.W31
  var w = buildDhWindow_(new Date(2026, 6, 31));
  assert_(w.gridWeeks.length === 6, "grid = 6 weeks");
  assert_(w.gridWeeks.map(function (x) { return x.iso; }).join("|") ===
          "2026.W29|2026.W30|2026.W31|2026.W32|2026.W33|2026.W34", "grid labels");
  assert_(w.gridWeeks[2].status === "now" && w.gridWeeks[0].status === "done" &&
          w.gridWeeks[5].status === "plan", "statuses");
  assert_(w.trendWeeks.join("|") ===
          "2026.W25|2026.W26|2026.W27|2026.W28|2026.W29|2026.W30", "trend = 6 completed");
  assert_(w.headlineIso === "2026.W30", "headline = last completed");
  // Derived from CONFIG_DH, not hardcoded: the depth is a tuning dial that
  // moves with the exporters' window, and a literal here just breaks the suite
  // every time it changes instead of testing anything.
  var expDeep = CONFIG_DH.WEEKS_PAST_DEEP + 1 + CONFIG_DH.WEEKS_FUTURE;
  assert_(w.allWeeks.length === expDeep,
          "allWeeks spans deep history→future (" + CONFIG_DH.WEEKS_PAST_DEEP + "+1+" +
          CONFIG_DH.WEEKS_FUTURE + " = " + expDeep + "), got " + w.allWeeks.length);
  assert_(w.allWeeks[w.allWeeks.length - 1] === "2026.W34", "allWeeks ends at the future horizon");
  assert_(w.allWeeks.indexOf("2026.W31") === CONFIG_DH.WEEKS_PAST_DEEP,
          "the current week sits exactly WEEKS_PAST_DEEP into allWeeks");
  // Year boundary: 2026-01-01 is Thursday of ISO 2026.W1 → past weeks wrap into 2025
  var y = buildDhWindow_(new Date(2026, 0, 1));
  assert_(y.trendWeeks[0].indexOf("2025.") === 0, "trend wraps into prior ISO year");
  assert_(weekKeyFromDate_(new Date(2026, 6, 27)) === "2026.W31", "Mon 2026-07-27 → W31");
  assert_(weekKeyFromDate_(new Date(2026, 7, 2)) === "2026.W31", "Sun 2026-08-02 → W31");
  Logger.log("✅ _test_dhWindow_ passed");
}

function _test_nameJoin_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nameJoin_: " + m); }
  assert_(normDH_("  Maria   ALVAREZ ") === "maria alvarez", "normalize whitespace+case");
  var a = nameAliases_("Alvarez, Maria");
  // "Last, First" cell → also match "First Last" and "Last First"
  assert_(a.indexOf("alvarez, maria") !== -1 && a.indexOf("maria alvarez") !== -1 &&
          a.indexOf("alvarez maria") !== -1, "comma cell yields all variants");
  var b = nameAliases_("Maria Alvarez");
  assert_(b.indexOf("maria alvarez") !== -1 && b.length === 1, "no-comma name = itself only");
  // Index build + lookup: NS "Last, First" resolves to roster "First Last"
  var idx = buildNameIndex_(["Maria Alvarez", "Tom Baker"]);
  assert_(resolveName_(idx, "ALVAREZ,  Maria") === "Maria Alvarez", "comma variant resolves");
  assert_(resolveName_(idx, "Tom Baker") === "Tom Baker", "exact resolves");
  assert_(resolveName_(idx, "Nobody Here") === null, "unknown → null");
  Logger.log("✅ _test_nameJoin_ passed");
}

function _test_teamSplit_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_teamSplit_: " + m); }
  assert_(splitTeams_("Team A | Team B").join("|") === "Team A|Team B", "split pipe-join");
  assert_(splitTeams_(" Team A ").join("|") === "Team A", "single team trimmed");
  assert_(splitTeams_("").length === 0 && splitTeams_(null).length === 0, "blank → []");
  assert_(splitTeams_("A | A | B").join("|") === "A|B", "dedup within a cell");
  Logger.log("✅ _test_teamSplit_ passed");
}

function _test_nsWeekBucketing_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_nsWeekBucketing_: " + m); }
  var rows = [
    { name: "Maria Alvarez", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 }, // Mon W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 2),  billable: 4, nonBillable: 0 }, // Sun W31
    { name: "Maria Alvarez", date: new Date(2026, 7, 3),  billable: 8, nonBillable: 0 }, // Mon W32
    { name: "Tom Baker",     date: new Date(2026, 6, 28), billable: 0, nonBillable: 8 },
  ];
  var m = aggregateNsWeeks_(rows);
  assert_(m["maria alvarez"]["2026.W31"].billable === 10, "Mon+Sun same ISO week");
  assert_(m["maria alvarez"]["2026.W31"].nonBillable === 2, "nonBillable summed");
  assert_(m["maria alvarez"]["2026.W32"].billable === 8, "Monday starts next week");
  assert_(m["tom baker"]["2026.W31"].billable === 0 && m["tom baker"]["2026.W31"].nonBillable === 8, "zero billable kept");
  Logger.log("✅ _test_nsWeekBucketing_ passed");
}

function _test_netCapacity_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_netCapacity_: " + m); }
  // holiday hrs arg is the person's holiday hours that week BEFORE dedup vs booked PTO
  assert_(netCapacity_(40, 8, 0).avail === 32, "cap − pto");
  assert_(netCapacity_(40, 0, 8).avail === 32, "cap − holiday");
  // booked-holiday no-double-count: effective holiday = max(0, hol − pto)
  var n = netCapacity_(40, 8, 8);
  assert_(n.avail === 32 && n.hol === 0, "booked holiday not double-counted");
  var p = netCapacity_(40, 4, 8);
  assert_(p.hol === 4 && p.avail === 32, "partial booking subtracts remainder only");
  assert_(netCapacity_(32, 40, 0).avail === 0, "floor at 0");
  assert_(netCapacity_(0, 8, 0).avail === 0, "zero capacity stays 0");
  // Part-timer in a two-holiday week: holiday hours can exceed the whole
  // schedule (ANZ 38h contract vs a 16h public-holiday pair on a 8h/wk row).
  var ph = netCapacity_(8, 0, 16);
  assert_(ph.avail === 0 && ph.hol === 16, "holiday > capacity floors avail, hol stays gross");
  var pq = netCapacity_(8, 4, 16);
  assert_(pq.avail === 0 && pq.hol === 12, "holiday > capacity with partial PTO booking");
  Logger.log("✅ _test_netCapacity_ passed");
}

function _test_regionMap_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionMap_: " + m); }
  assert_(regionBucketFromLocation_("Malaysia") === "APAC", "known location");
  assert_(regionBucketFromLocation_("  MALAYSIA ") === "APAC", "case/space insensitive");
  assert_(regionBucketFromLocation_("Atlantis") === "Other", "unknown → Other");
  assert_(regionBucketFromLocation_("") === "Other", "blank → Other");
  Logger.log("✅ _test_regionMap_ passed");
}

function _test_personRegion_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personRegion_: " + m); }
  // hoursByRegion from Key→Jira Raw join over the trend window
  var r = assignPersonRegion_({ "AMER": 60, "EMEA": 20 }, "APAC");
  assert_(r.region === "AMER" && r.source === "jira", "majority wins");
  var t = assignPersonRegion_({ "AMER": 40, "EMEA": 40 }, "APAC");
  assert_(t.region === "AMER" && t.source === "jira", "tie → alphabetical (deterministic)");
  var f = assignPersonRegion_({}, "APAC");
  assert_(f.region === "APAC" && f.source === "roster", "no tagged hours → roster fallback");
  var z = assignPersonRegion_({ "AMER": 0 }, "APAC");
  assert_(z.region === "APAC" && z.source === "roster", "zero hours = untagged");
  Logger.log("✅ _test_personRegion_ passed");
}

function _test_overflowClamp_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_overflowClamp_: " + m); }
  var ok = clampToCapacity_(30, 40);
  assert_(ok.pct === 75 && ok.over === false, "under capacity");
  var over = clampToCapacity_(44, 40);
  assert_(over.pct === 100 && over.over === true && over.realPct === 110, "clamped + flagged");
  assert_(clampToCapacity_(10, 0).pct === null, "zero capacity → null pct");
  Logger.log("✅ _test_overflowClamp_ passed");
}

function _test_utilizationRollup_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_utilizationRollup_: " + m); }
  var people = [
    { name: "A", region: "AMER", teams: ["T1", "T2"],
      weeks: { W1: { avail: 32, availCov: 32, billable: 24, tracked: 28, planned: 30 } } },
    { name: "B", region: "EMEA", teams: ["T2"],
      weeks: { W1: { avail: 40, availCov: 40, billable: 10, tracked: 20, planned: 40 } } },
    { name: "C", region: "AMER", teams: [],
      weeks: { W1: { avail: 0, availCov: 0, billable: 0, tracked: 0, planned: 0 } } }, // full-PTO week
  ];
  var all = utilRollup_(people, "W1", null, null);
  // avail 72, billable 34 → 47.2%
  assert_(Math.abs(all.billablePct - 34 / 72 * 100) < 1e-9, "billable util all");
  assert_(Math.abs(all.trackedPct - 48 / 72 * 100) < 1e-9, "tracked util all");
  var amer = utilRollup_(people, "W1", "AMER", null);
  assert_(amer.avail === 32 && amer.billable === 24, "region filter");
  var t2 = utilRollup_(people, "W1", null, "T2");
  assert_(t2.avail === 72, "team membership filter (A on T1|T2 counts in T2)");
  var t1 = utilRollup_(people, "W1", null, "T1");
  assert_(t1.avail === 32, "single-team filter");
  assert_(utilRollup_(people, "W9", null, null).billablePct === null, "no data week → null");
  // Coverage-matched denominator (audit 2026-08-03): an NS-uncovered week keeps
  // its tracked hours in trackedPct but leaves billablePct entirely — its avail
  // must NOT sit in the billable denominator with a forced-zero numerator.
  var partial = [
    { name: "A", region: "AMER", teams: [],
      weeks: { W1: { avail: 40, availCov: 40, billable: 30, tracked: 40, planned: 40, nsCov: true } } },
    { name: "B", region: "AMER", teams: [], // NS export hasn't reached this person yet
      weeks: { W1: { avail: 40, availCov: 0, billable: 0, tracked: 36, planned: 40, nsCov: false } } },
  ];
  var pr = utilRollup_(partial, "W1", null, null);
  assert_(Math.abs(pr.billablePct - 75) < 1e-9, "uncovered week excluded from billable denominator");
  assert_(Math.abs(pr.trackedPct - 76 / 80 * 100) < 1e-9, "uncovered week still counts in tracked util");
  // Ratio invariant: billable can never exceed tracked, so billable util can
  // never exceed tracked util on the same covered base (the old inflation).
  var same = [{ name: "A", region: "AMER", teams: [],
    weeks: { W1: { avail: 40, availCov: 40, billable: 40, tracked: 40, planned: 40, nsCov: true } } }];
  var sm = utilRollup_(same, "W1", null, null);
  assert_(sm.billablePct <= sm.trackedPct + 1e-9, "billable util never exceeds tracked util");
  // Non-tracking carve: tracks:false excluded by default, back via the include flag;
  // legacy people without the flag (undefined) stay included.
  var mixed = people.concat([{ name: "D", region: "AMER", teams: [], tracks: false,
    weeks: { W1: { avail: 40, availCov: 40, billable: 0, tracked: 0, planned: 40 } } }]);
  assert_(utilRollup_(mixed, "W1", null, null).avail === 72, "tracks:false carved out by default");
  assert_(utilRollup_(mixed, "W1", null, null, true).avail === 112, "include flag brings them back");
  // Long-leave carve: onLeave people never move utilization, even with the
  // include flag — leave is an absence, not a tracking-scope decision.
  var withLeave = people.concat([{ name: "E", region: "AMER", teams: [], onLeave: true,
    weeks: { W1: { avail: 40, availCov: 40, billable: 0, tracked: 0, planned: 40 } } }]);
  assert_(utilRollup_(withLeave, "W1", null, null).avail === 72, "onLeave excluded by default");
  assert_(utilRollup_(withLeave, "W1", null, null, true).avail === 72, "onLeave excluded even with include flag");
  Logger.log("✅ _test_utilizationRollup_ passed");
}

function _test_familyTracks_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_familyTracks_: " + m); }
  assert_(dhFamilyFromTitle_("", "08.I4.1 Senior Trainer") === "Training & Customer Education", "JF008 from title prefix");
  assert_(dhFamilyFromTitle_("", "15.M4.1 Manager, Operations") === "Operations", "JF015 from title prefix");
  assert_(dhFamilyFromTitle_("", "18.I6.2 Solution Architect") === "Solution Architecture", "JF018 from title prefix");
  assert_(dhFamilyFromTitle_("Operations", "09.I3.2 Consultant") === "Operations", "explicit Job Family cell wins");
  assert_(dhFamilyFromTitle_("", "Crew Member") === "", "uncoded title → blank family");
  assert_(dhTracksTime_("Managed Services & Support") === true, "JF007 tracks");
  assert_(dhTracksTime_("Service Delivery") === true, "JF009 tracks");
  assert_(dhTracksTime_("Training & Customer Education") === false, "JF008 no mandate");
  assert_(dhTracksTime_("Operations") === false, "JF015 no mandate");
  assert_(dhTracksTime_("Solution Architecture") === false, "JF018 no mandate");
  assert_(dhTracksTime_("") === true, "blank/unknown family = tracking-required (crew)");
  Logger.log("✅ _test_familyTracks_ passed");
}

function _test_rosterActive_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_rosterActive_: " + m); }
  assert_(dhRosterRowActive_("Active", "") === true, "active row stays");
  assert_(dhOnLeave_("Maternity Leave") === true && dhOnLeave_("Leave of Absence") === true,
          "leave statuses flagged");
  assert_(dhOnLeave_("Active") === false && dhOnLeave_("Terminated") === false,
          "active/terminated never flagged on-leave");
  assert_(dhRosterRowActive_("", "") === true, "blank status = active (no gone marker)");
  assert_(dhRosterRowActive_("Terminated", "") === false, "terminated status dropped");
  assert_(dhRosterRowActive_("Terminated - Mobility Relocation", "") === false, "terminated variant dropped");
  assert_(dhRosterRowActive_("Resigned", "") === false, "resigned dropped");
  assert_(dhRosterRowActive_("Offboarding", "") === false, "offboarding dropped");
  assert_(dhRosterRowActive_("Active", "2026-07-15") === false, "termination date alone drops the row");
  assert_(dhRosterRowActive_("Active", new Date(2026, 6, 15)) === false, "Date-typed termination cell drops too");
  // Leave statuses are NOT attrition — person is still employed
  assert_(dhRosterRowActive_("Maternity Leave", "") === true, "maternity leave stays");
  Logger.log("✅ _test_rosterActive_ passed");
}

function _test_newHire_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_newHire_: " + m); }
  // isoWeekBefore_: hire Wed 2026-07-15 sits in ISO 2026.W29
  var hire = new Date(2026, 6, 15);
  assert_(isoWeekBefore_("2026.W28", hire) === true, "prior week is pre-hire");
  assert_(isoWeekBefore_("2026.W29", hire) === false, "hire week itself counts");
  assert_(isoWeekBefore_("2026.W30", hire) === false, "later week counts");
  assert_(isoWeekBefore_("2025.W52", hire) === true, "prior ISO year is pre-hire");
  assert_(isoWeekBefore_("2026.W28", null) === false, "no hire date → nothing removed");
  // isDhNewHire_: ~3-month watch window anchored on today (2026-07-31 → cutoff 2026-05-01)
  var today = new Date(2026, 6, 31);
  assert_(isDhNewHire_(new Date(2026, 6, 15), today) === true, "2 weeks in → flagged");
  assert_(isDhNewHire_(new Date(2026, 4, 2), today) === true, "just inside the window");
  assert_(isDhNewHire_(new Date(2026, 3, 30), today) === false, "3+ months in → not new");
  assert_(isDhNewHire_(null, today) === false, "missing hire date fails safe");
  assert_(dhDateStr_(new Date(2026, 6, 15)) === "2026-07-15", "tooltip date string");
  assert_(dhDateStr_(null) === "", "blank for missing date");
  Logger.log("✅ _test_newHire_ passed");
}

function _test_backlogGrouping_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_backlogGrouping_: " + m); }
  var idx = buildNameIndex_(["Maria Alvarez"]);
  var open = [
    { key: "ACME-1", summary: "Big one", assignee: "Alvarez, Maria", status: "In Progress",
      priority: "High", due: new Date(2026, 7, 10), remHrs: 12 },
    { key: "ACME-2", summary: "Small one", assignee: "Maria Alvarez", status: "To Do",
      priority: "Low", due: null, remHrs: 2 },
    { key: "ZZZ-9", summary: "Not ours", assignee: "Nobody Here", status: "To Do",
      priority: "", due: null, remHrs: 8 },
  ];
  var by = backlogByPerson_(open, idx);
  var m = by["Maria Alvarez"];
  assert_(m && m.count === 2, "comma + plain assignee variants both join");
  assert_(m.remHrs === 14, "remaining hours totalled");
  assert_(m.items[0].key === "ACME-1", "sorted by remaining estimate desc");
  assert_(m.items[0].due === "2026.W33", "due date as ISO week label");
  assert_(!by["Nobody Here"], "non-roster assignee dropped");
  // Cap: totals cover ALL issues even when the item list is truncated
  var many = [];
  for (var i = 0; i < 12; i++) {
    many.push({ key: "K-" + i, summary: "s", assignee: "Maria Alvarez",
                status: "To Do", priority: "", due: null, remHrs: 1 });
  }
  var capped = backlogByPerson_(many, idx)["Maria Alvarez"];
  assert_(capped.items.length === CONFIG_DH.BACKLOG_MAX_ITEMS && capped.count === 12,
          "items capped, totals uncapped");
  Logger.log("✅ _test_backlogGrouping_ passed");
}

function _test_onTimeRate_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_onTimeRate_: " + m); }
  // Resolver stub: only Ana/Ben are roster people (person attribution).
  var roster = { "ana": "Ana", "ben": "Ben" };
  var resolve = function (raw) { return roster[String(raw).toLowerCase()] || null; };
  var issues = [
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), assignee: "Ana" }, // early ✓
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 29), assignee: "ANA" }, // boundary day ✓ (resolver case-insensitive)
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), assignee: "Ben" }, // late ✗
    { due: null,                  resolved: new Date(2026, 6, 30), assignee: "Ana" }, // no due — coverage only
    { due: new Date(2026, 6, 20), resolved: null,                  assignee: "Ana" }, // unresolved — excluded
    { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28), assignee: "Outsider Dev" }, // not roster — unattributed
    { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28), assignee: "" },             // unassigned — unattributed
    // Epics are programme containers, not delivery commitments: excluded from
    // BOTH the rate and the coverage denominator (audit fix 2026-08-03).
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), assignee: "Ana", isEpic: true }, // late epic — must not count
    { due: null,                  resolved: new Date(2026, 6, 30), assignee: "Ana", isEpic: true }, // no-due epic — must not count
  ];
  var r = onTimeBuckets_(issues, resolve, "delivery");
  // resolved dates 2026-07-28/29/30 are all ISO 2026.W31
  var a = r.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(a.iso === "2026.W31" && a.n === 2 && a.onTime === 2, "Ana: 2 with due, both on time");
  assert_(a.nAll === 3, "coverage: no-due resolved issue counts in nAll only");
  assert_(a.n === 2 && a.nAll === 3, "epics excluded from the rate AND the coverage denominator");

  // The other two readings of the scope switch (CONFIG_DH.ONTIME_SCOPE).
  var epicOnly = onTimeBuckets_(issues, resolve, "epic");
  var ea = epicOnly.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(ea.n === 1 && ea.onTime === 0 && ea.nAll === 2,
          'scope "epic": only the 2 epics, 1 with a due date, resolved late');
  assert_(epicOnly.buckets.length === 1, 'scope "epic": Ben has no epics, so no bucket');
  var everything = onTimeBuckets_(issues, resolve, "all");
  var aa = everything.buckets.filter(function (b) { return b.person === "Ana"; })[0];
  assert_(aa.n === 3 && aa.nAll === 5, 'scope "all": pre-audit behaviour, epics folded back in');
  // Shipped default moved "delivery" → "dictionary" on 2026-08-03 (align the
  // formulas with the Metrics Dictionary). The assertion is pinned rather than
  // read from the config on purpose: this switch changes what the published rate
  // MEANS, so it should never move without a test failing and someone deciding.
  assert_(CONFIG_DH.ONTIME_SCOPE === "dictionary", "shipped default is the dictionary scope");
  // Omitting the scope must land on the CONFIG_DH default — compared against an
  // explicit run of that same scope, not against `r` (which pins "delivery"),
  // so this stays true whatever the shipped default becomes.
  assert_(JSON.stringify(onTimeBuckets_(issues, resolve).buckets) ===
          JSON.stringify(onTimeBuckets_(issues, resolve, CONFIG_DH.ONTIME_SCOPE).buckets),
          "omitted scope falls back to the CONFIG_DH default");
  // ── SHIPPED SCOPE: the Metrics Dictionary reading (2026-08-03) ──
  // "issue type Epic/Milestone OR Client Commitment label" — a UNION, because a
  // commitment made to a client is a commitment whatever the issue type.
  var dictIssues = [
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), assignee: "Ana", isEpic: true },          // epic, on time
    { due: new Date(2026, 6, 27), resolved: new Date(2026, 6, 30), assignee: "Ana", isMilestone: true },     // milestone, late
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), assignee: "Ana", isClientCommitment: true }, // labelled story, on time
    { due: new Date(2026, 6, 29), resolved: new Date(2026, 6, 28), assignee: "Ana" },                        // plain story — OUT of scope
    { due: null,                  resolved: new Date(2026, 6, 30), assignee: "Ana", isEpic: true },          // epic, no due — coverage only
  ];
  var dict = onTimeBuckets_(dictIssues, resolve, "dictionary").buckets[0];
  assert_(dict.nAll === 4, "dictionary scope: epics + milestones + labelled issues, plain story excluded");
  assert_(dict.n === 3, "dictionary scope: 3 of those 4 carry a due date");
  assert_(dict.onTime === 2, "dictionary scope: epic + labelled story on time, milestone late");
  // Each of the three signals must ADMIT on its own — an AND here would silently
  // shrink the metric to epics that also happen to be labelled.
  assert_(onTimeInScope_({ isEpic: true }, "dictionary"), "epic alone is in scope");
  assert_(onTimeInScope_({ isMilestone: true }, "dictionary"), "milestone alone is in scope");
  assert_(onTimeInScope_({ isClientCommitment: true }, "dictionary"), "the label alone is in scope");
  assert_(!onTimeInScope_({}, "dictionary"), "a plain Story carries none of the three and is out");
  // The label regex tolerates the ways people actually write labels, but must
  // not swallow an unrelated label that merely starts with "client".
  assert_(DH_CLIENT_COMMITMENT_.test("client-commitment") &&
          DH_CLIENT_COMMITMENT_.test("ClientCommitment") &&
          DH_CLIENT_COMMITMENT_.test("a, client_commitment, b"),
          "Client Commitment label matched across the common spellings");
  assert_(!DH_CLIENT_COMMITMENT_.test("client-portal"), "an unrelated client-* label is not a commitment");

  var e = r.buckets.filter(function (b) { return b.person === "Ben"; })[0];
  assert_(e.n === 1 && e.onTime === 0 && e.nAll === 1, "late issue counted, not on time");
  assert_(r.buckets.length === 2, "person-keyed buckets; unresolved rows excluded");
  assert_(r.unattributed === 2, "non-roster + unassigned resolved issues tallied as unattributed");
  Logger.log("✅ _test_onTimeRate_ passed");
}

function _test_forecastAccuracy_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_forecastAccuracy_: " + m); }
  var resolve = function (raw) { return raw === "Ana" ? "Ana" : null; };
  var epics = [
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 28), assignee: "Ana" }, // exact: within band
    { estSec: 36000, spentSec: 54000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 50% over: miss
    { estSec: 36000, spentSec: 90000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 150% over: miss
    { estSec: 36000, spentSec: 18000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // 50% UNDER: miss
    { estSec: 0,     spentSec: 36000, resolved: new Date(2026, 6, 29), assignee: "Ana" }, // no estimate — coverage only
    { estSec: 36000, spentSec: 0,     resolved: new Date(2026, 6, 29), assignee: "Ana" }, // estimated, ZERO worklog — coverage only
    { estSec: 36000, spentSec: 36000, resolved: null,                  assignee: "Ana" }, // unresolved — excluded
    { estSec: 36000, spentSec: 36000, resolved: new Date(2026, 6, 29), assignee: "Ghost" }, // not roster — unattributed
  ];
  var r = forecastBuckets_(epics, resolve);
  assert_(r.buckets.length === 1, "one person bucket");
  var b = r.buckets[0];
  assert_(b.person === "Ana" && b.iso === "2026.W31" && b.n === 4, "4 measurable resolved epics for Ana");
  assert_(b.nAll === 6, "coverage: unestimated + zero-worklog epics count in nAll only");
  assert_(b.nNoTime === 1, "estimated epic with no logged time tallied separately");
  // ±10% BAND (FR-1.4): only the exact epic lands inside it. The three misses
  // are 50% over, 150% over and 50% under.
  assert_(b.nWithin === 1, "band: 1 of 4 measurable epics inside ±10%");
  assert_(Math.abs(b.nWithin / b.n * 100 - 25) < 1e-9, "forecast accuracy = 25%");
  assert_(b.nMissOver === 2 && b.nMissUnder === 1, "misses split by direction");
  assert_(b.nMissOver + b.nMissUnder + b.nWithin === b.n, "every measurable epic is within or a miss");
  // Secondary form: median |variance| over 0, 0.5, 1.5, 0.5 → (0.5 + 0.5)/2.
  assert_(medianOf_(b.absVars) === 0.5, "median absolute variance = 50%");
  // The old score would have read 1 + 0.5 + 0 (floored) + 0.5 = 50% — the same
  // number for a team that over-runs 150% as for one that closes 50% early.
  assert_(b.sumAcc === undefined, "retired accuracy score no longer emitted");
  // A zero-worklog epic must stay OUT of the band denominator: in nAll, not n.
  assert_(b.n === 4 && b.nAll === 6, "zero-worklog + unestimated epics are coverage-only");
  // The band width is a registry parameter, not a constant baked into the loop.
  var wide = forecastBuckets_(epics, resolve, 0.60).buckets[0];
  assert_(wide.nWithin === 3, "±60% band admits the two 50% epics as well");
  assert_(CONFIG_DH.FORECAST_BAND === 0.10, "shipped band is ±10% (registry v1.0)");
  assert_(r.unattributed === 1, "non-roster epic tallied as unattributed");

  // ── SHIPPED HEADLINE: the Metrics Dictionary mean (2026-08-03) ──
  // absVars are 0, 0.5, 1.5, 0.5 → per-epic accuracy 1, 0.5, 0 (FLOORED), 0.5
  // → mean 0.5 → 50%. The floor is the load-bearing part: without it the 150%
  // over-run would score −50% and drag the mean to 25%, letting one runaway
  // engagement cancel out two good ones.
  var accPct = function (v) {         // mirror of the client's forecastAccuracyPct_
    if (!v || !v.length) return null;
    var t = 0;
    v.forEach(function (x) { t += Math.max(0, 1 - x); });
    return t / v.length * 100;
  };
  assert_(Math.abs(accPct(b.absVars) - 50) < 1e-9,
          "dictionary mean accuracy = 50% (1 + 0.5 + 0 floored + 0.5) / 4");
  assert_(accPct([1.5]) === 0, "a 150% over-run floors at 0, never negative");
  assert_(accPct([0]) === 100, "an exact estimate scores 100%");
  assert_(accPct([]) === null, "nothing measurable → no number, not a zero");
  // The band and the mean must stay INDEPENDENT: same epics, different answers,
  // and publishing either alone is quotable in a misleading direction.
  assert_(Math.abs(b.nWithin / b.n * 100 - 25) < 1e-9 && Math.abs(accPct(b.absVars) - 50) < 1e-9,
          "25% inside the band but 50% mean accuracy — both true, both shipped");
  Logger.log("✅ _test_forecastAccuracy_ passed");
}

/**
 * Quality / Rework Rate (Metrics Dictionary metric #4, built 2026-08-03).
 *
 * The rules that matter here are all about NOT overstating what was measured:
 * an unmeasured reopen must never read as "no rework", and work that was never
 * delivered must never sit in the delivered denominator.
 */
function _test_reworkRate_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_reworkRate_: " + m); }
  var resolve = function (raw) { return raw === "Ana" ? "Ana" : null; };
  var W = new Date(2026, 6, 29);   // ISO 2026.W31
  var issues = [
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: true,  reopened: false },                       // rework via link
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: false, reopened: true },                        // rework via reopen
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: true,  reopened: true },                        // BOTH — still ONE piece of rework
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: false, reopened: false },                       // clean
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: false, reopened: null },                        // clean, reopen NOT measured
    // Never delivered — out of the denominator entirely.
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Won't Do",
      reworkLink: true,  reopened: true },
    { resolved: W, assignee: "Ana", statusCategory: "Done", resolution: "Duplicate",
      reworkLink: false, reopened: false },
    // Not Done, unresolved, and non-roster — each excluded for its own reason.
    { resolved: W, assignee: "Ana", statusCategory: "In Progress", resolution: "",
      reworkLink: true,  reopened: false },
    { resolved: null, assignee: "Ana", statusCategory: "Done", resolution: "Done",
      reworkLink: true, reopened: true },
    { resolved: W, assignee: "Ghost", statusCategory: "Done", resolution: "Done",
      reworkLink: true, reopened: false },
  ];
  var r = reworkBuckets_(issues, resolve);
  assert_(r.buckets.length === 1, "one person bucket");
  var b = r.buckets[0];
  assert_(b.person === "Ana" && b.iso === "2026.W31", "keyed by iso × person");
  assert_(b.nDelivered === 5, "denominator = delivered only (Won't Do / Duplicate / not-Done excluded)");
  assert_(b.nRework === 3, "numerator = reopened OR linked, counted once each");
  assert_(b.nLinked === 2 && b.nReopened === 2,
          "the two signals are also reported separately, and they overlap");
  assert_(b.nLinked + b.nReopened !== b.nRework,
          "the union is NOT the sum — the issue that did both must not be double-counted");
  assert_(Math.abs(b.nRework / b.nDelivered * 100 - 60) < 1e-9, "rework rate = 3 of 5 = 60%");
  assert_(r.unattributed === 1, "non-roster delivered issue tallied as unattributed");

  // COVERAGE: the reopen signal is tristate, and the difference between
  // "not reopened" and "nobody looked" is the whole credibility of this metric.
  assert_(b.nReopenCov === 4, "only the 4 issues with a populated Reopened cell count toward coverage");
  var unmeasured = issues.map(function (it) {
    return { resolved: it.resolved, assignee: it.assignee, statusCategory: it.statusCategory,
             resolution: it.resolution, reworkLink: it.reworkLink, reopened: null };
  });
  var u = reworkBuckets_(unmeasured, resolve).buckets[0];
  assert_(u.nReopenCov === 0, "changelog off → zero reopen coverage");
  assert_(u.nReopened === 0 && u.nRework === 2,
          "with reopens unmeasured the rate falls back to links alone — an UNDERSTATEMENT, " +
          "which is why the card calls it a floor rather than a measurement");
  assert_(u.nRework < b.nRework, "and it is strictly lower than the fully measured rate");

  // A pre-v3.6.0 export has no Rework/Reopened columns at all: every signal
  // absent must produce a 0% rate with 0 coverage, never a crash and never a
  // confident zero.
  var bare = reworkBuckets_([{ resolved: W, assignee: "Ana", statusCategory: "Done",
                               resolution: "Done", reworkLink: false, reopened: null }], resolve).buckets[0];
  assert_(bare.nDelivered === 1 && bare.nRework === 0 && bare.nReopenCov === 0,
          "old export: delivered counted, no rework claimed, no reopen coverage");

  // The denominator regex is the contract with FIELD_REFERENCE.md.
  ["Won't Do", "Wont Fix", "Duplicate", "Incomplete", "Declined"].forEach(function (res) {
    assert_(CONFIG_DH.NON_DELIVERED_RESOLUTIONS.test(res), res + " is not delivered work");
  });
  ["Done", "Fixed", "Completed"].forEach(function (res) {
    assert_(!CONFIG_DH.NON_DELIVERED_RESOLUTIONS.test(res), res + " IS delivered work");
  });
  Logger.log("✅ _test_reworkRate_ passed");
}

/** Registry integrity (FR-1.1/FR-1.2) — the payload's definitional contract.
    A metric that ships without an owner or a coverage gate can't be defended in
    a review, and a gate the tiles can't read is a gate that never fires. */
function _test_registry_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_registry_: " + m); }
  var R = METRIC_REGISTRY_;
  assert_(R.version && R.updated, "registry carries a version and a date");
  ["onTime", "forecast", "util", "quality", "hygiene"].forEach(function (id) {
    var m = R.metrics[id];
    assert_(m, "registry defines " + id);
    ["name", "definition", "formula", "grain", "owner", "paramOwner", "ebitda"].forEach(function (f) {
      assert_(m[f] && String(m[f]).trim().length >= 3, id + " has a " + f);
    });
    assert_(m.id === id, id + " id matches its key");
    assert_(m.sources && m.sources.length, id + " names its source fields");
    assert_(typeof m.coverageGate === "number" && m.coverageGate >= 0 && m.coverageGate <= 1,
            id + " coverage gate is a 0–1 fraction");
    assert_(m.target && typeof m.target.green === "number", id + " has a target");
  });
  // Targets are shared with the tile RAG bands — one number, not two.
  assert_(R.metrics.onTime.target === CONFIG_DH.TARGETS.onTime, "onTime target is the CONFIG_DH one");
  assert_(R.metrics.util.target === CONFIG_DH.TARGETS.util, "util target is the CONFIG_DH one");
  assert_(R.changeLog.length >= 1 && R.changeLog[0].version === R.version,
          "newest change-log entry matches the registry version");
  R.changeLog.forEach(function (c) {
    // `affects` may legitimately be EMPTY: a publication-rule change (e.g. gates
    // no longer suppressing) moves no metric's values, and marking trend lines
    // for it would put a false "definition changed" note on a series that
    // didn't step. The property must still be present and be an array.
    assert_(c.date && c.author && c.change && c.rationale && c.affects instanceof Array,
            "change-log entry " + c.version + " is complete");
  });
  // Known deviations are part of the definition, not a footnote someone can drop.
  assert_(R.metrics.onTime.deviations.length >= 1, "on-time records its baselined-date gap");
  assert_(R.metrics.forecast.deviations.length >= 1, "forecast records its mutable-estimate gap");
  Logger.log("✅ _test_registry_ passed");
}

/** PM vocabulary must not carry people who have left (user report 2026-08-03). */
function _test_activeNameFilter_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_activeNameFilter_: " + m); }
  var roster = {
    activeAll:   { "ana perez": 1, "sam lee": 1, "rita boomerang": 1 },
    inactiveAll: { "gone guy": 1, "rita boomerang": 1 },  // rehired: both rows exist
  };
  var r = filterActiveNames_(["Ana Perez", "Gone Guy", "Rita Boomerang", "External PM"], roster);
  assert_(r.kept.indexOf("Ana Perez") !== -1, "active name kept");
  assert_(r.dropped.indexOf("Gone Guy") !== -1, "terminated name dropped");
  assert_(r.kept.indexOf("Gone Guy") === -1, "…and not also kept");
  // A rehire has both an old terminated row and a current active one. Active
  // wins — the same first-active-wins rule the roster reader uses.
  assert_(r.kept.indexOf("Rita Boomerang") !== -1, "boomerang rehire kept (an active row exists)");
  // The rule is one-sided ON PURPOSE: only names the roster PROVES are gone get
  // dropped. Deleting unknown names would silently remove live work from the
  // filters, which is invisible; a stale chip is merely untidy.
  assert_(r.kept.indexOf("External PM") !== -1, "unknown name kept — absence of proof is not proof");
  assert_(r.kept.length === 3 && r.dropped.length === 1, "counts add up");
  // Case/spacing differences must not resurrect a leaver.
  assert_(filterActiveNames_(["  GONE   GUY "], roster).dropped.length === 1,
          "name match is normalised");
  assert_(filterActiveNames_(["Anyone"], {}).kept.length === 1, "no roster data → keep everything");
  Logger.log("✅ _test_activeNameFilter_ passed");
}

/** Admin gate overrides layer over the registry (user request 2026-08-03). */
function _test_gateOverrides_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_gateOverrides_: " + m); }
  var base = METRIC_REGISTRY_.metrics.onTime.coverageGate;
  var plain = registryWithOverrides_({});
  assert_(plain.metrics.onTime.coverageGate === base, "no overrides → registry values");
  assert_(plain.metrics.onTime.gateOverride === undefined, "…and no override badge");

  var r = registryWithOverrides_({ onTime: { gate: 0.55, by: "a@b.com", at: "2026-08-03" } });
  assert_(r.metrics.onTime.coverageGate === 0.55, "override applied");
  assert_(r.metrics.onTime.gateDefault === base, "agreed default preserved for the UI");
  assert_(r.metrics.onTime.gateOverride.by === "a@b.com", "who changed it is recorded");
  assert_(r.metrics.onTime.gateOverride.at === "2026-08-03", "…and when");
  // The registry itself must never be mutated, or one override would leak into
  // every later build in the same execution and there'd be no default to restore.
  assert_(METRIC_REGISTRY_.metrics.onTime.coverageGate === base, "REGISTRY UNTOUCHED");
  assert_(r.metrics.forecast.coverageGate === METRIC_REGISTRY_.metrics.forecast.coverageGate,
          "other metrics unaffected");

  // Garbage in must not silently redefine a gate.
  ["", null, 1.5, -0.2, "0.5", undefined].forEach(function (bad) {
    var g = registryWithOverrides_({ onTime: { gate: bad } });
    assert_(g.metrics.onTime.coverageGate === base, "invalid gate ignored: " + String(bad));
  });
  assert_(registryWithOverrides_({ nosuch: { gate: 0.5 } }).metrics.nosuch === undefined,
          "unknown metric id ignored");
  assert_(registryWithOverrides_({ onTime: { gate: 0 } }).metrics.onTime.coverageGate === 0,
          "0 is a legitimate gate (ungated), not a falsy no-op");
  Logger.log("✅ _test_gateOverrides_ passed");
}

/** Confidence gate + suppression (FR-2.1/2.2/2.6). */
function _test_confidence_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_confidence_: " + m); }
  var gate = 0.80;
  assert_(metricConfidence_(gate, 0.92, 6).level === "high", "above gate with history → high");
  assert_(metricConfidence_(gate, 0.92, 6).publish === true, "high publishes");
  assert_(metricConfidence_(gate, 0.92, 1).level === "medium", "above gate but <2 periods → medium");
  assert_(metricConfidence_(gate, 0.75, 6).level === "medium", "within 10 pts of gate → medium");
  assert_(metricConfidence_(gate, 0.75, 6).publish === true, "medium still publishes, with a note");
  assert_(metricConfidence_(gate, 0.69, 6).level === "low", "10+ pts below gate → low");
  assert_(metricConfidence_(gate, 0.69, 6).publish === false, "LOW IS SUPPRESSED — the whole point");
  // The two numbers that started this: 43% forecast coverage and 66% on-time.
  assert_(metricConfidence_(0.70, 0.43, 6).publish === false, "forecast at 43% coverage is suppressed");
  assert_(metricConfidence_(0.80, 0.66, 6).publish === false, "on-time at 66% coverage is suppressed");
  // Nothing in scope is not the same as badly attributed.
  assert_(metricConfidence_(gate, null, 6).level === "none", "no data → none, not low");
  assert_(metricConfidence_(gate, null, 6).publish === false, "no data never publishes");
  // The hygiene metric measures coverage, so it can't be gated on its own.
  assert_(metricConfidence_(0, 0.10, 0).publish === true, "an ungated metric always publishes");
  assert_(metricConfidence_(gate, 1.4, 6).coverage === 1, "coverage clamps to 1");
  Logger.log("✅ _test_confidence_ passed");
}

/** Jira Region vocabulary normalisation (§4.3) + the Unassigned bucket (§4.2). */
function _test_regionVocab_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionVocab_: " + m); }
  assert_(mapRegionToDh_("RR01 North America") === "AMER", "exact option value maps");
  assert_(mapRegionToDh_("  rr02   EMEA  ") === "EMEA", "case + whitespace tolerated");
  assert_(mapRegionToDh_("RR02 Europe/Middle East/Africa") === "EMEA", "prefix match on a longer label");
  assert_(mapRegionToDh_("RR03 Asia Pacific") === "APAC", "asia pacific maps");
  assert_(mapRegionToDh_("RR04 Australia & New Zealand") === "ANZ", "anz maps");
  assert_(mapRegionToDh_("APAC") === "APAC", "a bare token already in the vocabulary passes through");
  assert_(mapRegionToDh_("RR09 Antarctica") === "Other", "unrecognised value → Other");
  // The distinction the executive layer depends on: a region we haven't mapped
  // is a mapping bug, a BLANK region is a tagging gap somebody owns. Folding
  // blanks into "Other" would hide the gap §4.2 exists to make uncomfortable.
  assert_(mapRegionToDh_("") === "Unassigned", "blank → Unassigned, never Other");
  assert_(mapRegionToDh_(null) === "Unassigned", "null → Unassigned");
  assert_(mapRegionToDh_(undefined) === "Unassigned", "undefined → Unassigned");
  assert_(DH_REGION_UNASSIGNED_ !== CONFIG_DH.REGION_FALLBACK, "Unassigned and Other are different buckets");
  Logger.log("✅ _test_regionVocab_ passed");
}

/** Attribution counters behind the Data Hygiene view (FR-2.3/2.4). */
function _test_hygieneBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_hygieneBuckets_: " + m); }
  var resolve = function (raw) { return String(raw).toLowerCase() === "ana" ? "Ana" : null; };
  var d = new Date(2026, 6, 29); // 2026.W31
  var jira = { issues: [
    // fully attributed: due + roster assignee + region
    { resolved: d, due: d, assignee: "Ana", region: "AMER", team: "RR: SEA 1", isEpic: false },
    // no due date
    { resolved: d, due: null, assignee: "Ana", region: "AMER", team: "", isEpic: false },
    // assignee not on the roster — the metrics DROP this one, hygiene must not
    { resolved: d, due: d, assignee: "Contractor X", region: "AMER", team: "", isEpic: false },
    // region never tagged
    { resolved: d, due: d, assignee: "Ana", region: "Unassigned", team: "", isEpic: false },
    // unresolved — out of scope entirely
    { resolved: null, due: d, assignee: "Ana", region: "AMER", team: "", isEpic: false },
    // epics: one measurable, one estimated-but-untracked, one unestimated
    { resolved: d, due: d, assignee: "Ana", region: "AMER", team: "", isEpic: true,
      estSec: 3600, spentSec: 3600 },
    { resolved: d, due: null, assignee: "Ana", region: "Unassigned", team: "", isEpic: true,
      estSec: 3600, spentSec: 0 },
    { resolved: d, due: null, assignee: "Ana", region: "Unassigned", team: "", isEpic: true,
      estSec: 0, spentSec: 7200 },
  ] };
  var rows = hygieneBuckets_(jira, resolve, "delivery");
  assert_(rows.length === 1 && rows[0].iso === "2026.W31", "one ISO-week row");
  var h = rows[0];
  assert_(h.res === 4, "4 resolved delivery issues in scope (epics and unresolved excluded)");
  assert_(h.resDue === 3, "3 carry a due date");
  assert_(h.resAttr === 3, "3 join the roster");
  assert_(h.resRegion === 3, "3 carry a mapped region");
  assert_(h.resTeam === 1, "1 carries a team");
  assert_(h.resFull === 1, "fully attributed = due AND roster assignee AND region");
  // resReady drops the region term: with Region unpopulated org-wide, resFull is
  // pinned at 0 and can't show due-date/assignee progress. Fixture: issues 1 and
  // 4 both carry a due date and a roster assignee; only issue 1 has a region.
  assert_(h.resReady === 2, "ready = due AND roster assignee, region excluded");
  assert_(h.resReady >= h.resFull, "resReady is the looser composite, always ≥ resFull");
  // This is why hygiene reads the raw feed instead of the metric buckets: the
  // non-roster issue is invisible to onTimeBuckets_, so coverage measured there
  // would flatter itself by dropping the very records that are the problem.
  assert_(h.res > h.resAttr, "unattributed issues stay in the hygiene denominator");
  assert_(h.epics === 3, "epics counted separately, whatever the on-time scope");
  assert_(h.epicsEst === 2 && h.epicsTime === 1, "estimate fill vs measurable epics");
  // Scope switch moves the delivery counts but never the epic ones.
  var asEpic = hygieneBuckets_(jira, resolve, "epic")[0];
  assert_(asEpic.res === 3 && asEpic.epics === 3, 'scope "epic" counts epics as the delivery population');
  // Hygiene shares onTimeInScope_ with the metric rather than keeping its own
  // copy of the rule — otherwise the view would diagnose the coverage of a
  // population nobody publishes. Under "dictionary" that means epics +
  // milestones + client-commitment items.
  var jiraD = { issues: jira.issues.concat([
    { resolved: d, due: d, assignee: "Ana", region: "AMER", team: "", isEpic: false,
      isClientCommitment: true },
  ]) };
  var asDict = hygieneBuckets_(jiraD, resolve, "dictionary")[0];
  assert_(asDict.res === 4, 'scope "dictionary" counts epics + client-commitment items (3 epics + 1)');
  assert_(hygieneBuckets_(jiraD, resolve, "delivery")[0].res === 5,
          '…while "delivery" counts the non-epics instead');
  assert_(hygieneBuckets_({ issues: [] }, resolve, "delivery").length === 0, "empty feed → no rows");
  Logger.log("✅ _test_hygieneBuckets_ passed");
}

function _test_cacheRoundtrip_(cache) {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_cacheRoundtrip_: " + m); }
  var big = JSON.stringify({ people: new Array(4000).fill({ name: "Maria Alvarez", weeks: { "2026.W31": { cap: 40, avail: 32 } } }) });
  assert_(cachePutLarge_(cache, "dh_test", big, 60) === true, "put ok");
  assert_(cacheGetLarge_(cache, "dh_test") === big, "roundtrip identical");
  assert_(cacheGetLarge_(cache, "dh_missing") === null, "missing key → null");
  // Simulate an evicted chunk → whole entry misses cleanly
  var meta = parseInt(cache.get("dh_test_meta"), 10);
  if (meta > 1) { cache.m["dh_test_1"] = null; delete cache.m["dh_test_1"]; }
  else { delete cache.m["dh_test_0"]; }
  assert_(cacheGetLarge_(cache, "dh_test") === null, "missing chunk → clean miss");
  Logger.log("✅ _test_cacheRoundtrip_ passed");
}

function _test_modelAssembly_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_modelAssembly_: " + m); }
  var win = buildDhWindow_(new Date(2026, 6, 31)); // grid W29–W34, trend W25–W30
  var inputs = {
    roster: { people: [
      { name: "Maria Alvarez", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Service Delivery", tracks: true, empNum: "1001" },
      { name: "Tom Baker", keyLocation: "Australia & New Zealand", rosterBucket: "ANZ", isCrew: false,
        jobFamily: "", tracks: true,                // uncatalogued (crew-like) — stays in
        jobTitle: "07.M5.1 - Manager, Service Delivery", // M-level → isManager
        onLeave: true, leaveStatus: "Paternity Leave" }, // long leave — 🏖 not zeros
      { name: "Nina New", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Service Delivery", tracks: true,
        hireDate: new Date(2026, 6, 15) },          // hired mid-window (ISO 2026.W29)
      { name: "Zoe Ops", keyLocation: "Malaysia", rosterBucket: "APAC", isCrew: false,
        jobFamily: "Operations", tracks: false },   // non-tracking family — dropped entirely
    ] },
    capacity: { byName: { "maria alvarez": { "2026.W31": 40, "2026.W30": 40 } } }, // Tom missing → fallback
    tracked: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W30": 20, "2026.W31": 8 } },
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "NETSUITE-TIMEOFF", pm: "Ghost PM",
        weekHours: { "2026.W31": 8 } },  // tracked time-off excluded from `tracked` AND from PMs
    ] },
    planned: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W31": 30 } },
      { user: "Maria Alvarez", teamCell: "", key: "NETSUITE-TIMEOFF",
        weekHours: { "2026.W31": 8 } },  // → PTO 8h in W31
    ] },
    ns: { rows: [
      { name: "Alvarez, Maria", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 },
      { name: "Alvarez, Maria", date: new Date(2026, 6, 20), billable: 5, nonBillable: 3 }, // Mon W30, no PTO that week
    ] },
    holidays: { rows: [ { date: new Date(2026, 6, 29), location: "Malaysia" } ] }, // Wed W31, 8h
    // Accumulation Cost usage (source of truth): W31 8h matches the NETSUITE
    // row; W30 4h exists ONLY here — proves the ledger wins over NETSUITE.
    pto: { ok: true, byEmp: { "1001": { "2026.W31": 8, "2026.W30": 4 } } },
    jira: { available: true, keyRegion: { "ACME-1": "AMER" },
      // isClientCommitment so both rows sit inside the shipped "dictionary"
      // scope as well as "delivery" — this fixture is testing the roster join
      // and the hygiene counters, and it should not silently empty out the next
      // time ONTIME_SCOPE moves.
      issues: [ { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
                  assignee: "Alvarez, Maria", estSec: 0, spentSec: 0,
                  isClientCommitment: true },                             // comma-form → alias join
                { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
                  assignee: "Random Dev", estSec: 0, spentSec: 0,
                  isClientCommitment: true } ],                           // not roster → unattributed
      epics: [ { estSec: 36000, spentSec: 18000, resolved: new Date(2026, 6, 28),
                 assignee: "Maria Alvarez" } ],
      openIssues: [ { key: "ACME-7", summary: "Open work", assignee: "Alvarez, Maria",
                      status: "In Progress", priority: "High", due: null, remHrs: 5 } ] },
  };
  var m = assembleModel_(inputs, win);
  assert_(!m.error, "no fatal error");
  assert_(m.schemaVer === DH_SCHEMA_VER_, "payload stamped with the current schema version");
  assert_(m.people.length === 3 && m.people[0].name === "Maria Alvarez", "alphabetical people");
  var maria = m.people[0], w31 = maria.weeks["2026.W31"];
  // cap 40, pto 8 (planned NETSUITE), holiday 8h but fully booked → effHol 0, avail 32
  assert_(w31.cap === 40 && w31.pto === 8 && w31.hol === 0 && w31.avail === 32, "net capacity chain");
  assert_(w31.tracked === 8 && w31.planned === 30, "NETSUITE excluded from tracked/planned");
  // ── Ratio classification (audit 2026-08-03) ──
  // W31: NS 6b/2nb = 8h total, Tempo tracked 8h — the feeds agree, so the split
  // is identical to the old absolute reading (6/2). This is the happy path.
  assert_(w31.nsCov === true && w31.billShare === 0.75, "NS joined via comma-name alias → 75% billable share");
  assert_(w31.billable === 6, "share applied to tracked: 8h × 0.75");
  // NS Non-Billable = real project work — PTO lives only in the Time off
  // Report (NETSUITE rows), never in this bucket, so the 2h survives even in
  // a week with 8h PTO (user clarification 2026-08-01, no OOO netting).
  assert_(w31.nonBillable === 2, "non-billable work untouched by PTO");
  assert_(Math.abs(w31.billable + w31.nonBillable - w31.tracked) < 1e-9,
          "INVARIANT: billable + nonBillable === tracked");
  // W30: NS captured only 8h (5b/3nb) of a 20h tracked week. The old absolute
  // reading reported 5h billable — understating a 20h week to 13.9% util. The
  // share (62.5%) now classifies the FULL tracked total: 12.5h / 7.5h. The raw
  // absolutes stay on the record for the finance drill-down + the gap flag.
  var w30 = maria.weeks["2026.W30"];
  assert_(w30.tracked === 20 && w30.billShare === 0.625, "W30 share from NS mix");
  assert_(w30.billable === 12.5 && w30.nonBillable === 7.5, "share extrapolated over the full tracked total");
  assert_(w30.nsBillRaw === 5 && w30.nsNonBillRaw === 3, "raw NS absolutes retained");
  assert_(Math.abs(w30.billable + w30.nonBillable - w30.tracked) < 1e-9,
          "INVARIANT: billable + nonBillable === tracked (W30)");
  // An NS-uncovered week is unclassifiable, NOT 0% billable: it keeps tracked
  // hours but contributes nothing to either side of the billable rate.
  var w29 = maria.weeks["2026.W29"];
  assert_(w29 && w29.nsCov === false && w29.availCov === 0 && w29.billable === 0,
          "no NS rows → uncovered, zero billable denominator");
  // Coverage telemetry: 2 of Maria's weeks classified, unmatched NS names counted.
  var cov = m.meta.nsCoverage;
  assert_(cov.covered === 2 && cov.personWeeks > 2, "coverage counts classified person-weeks");
  assert_(cov.classifiedHours === 28 && cov.trackedHours === 28, "classified vs total tracked hours");
  assert_(cov.gapHours === 12, "reconciliation gap = |NS 8h − tracked 20h| in W30");
  var mUn = assembleModel_(Object.assign({}, inputs, { ns: { rows: inputs.ns.rows.concat(
    [{ name: "Ghost Employee", date: new Date(2026, 6, 27), billable: 9, nonBillable: 1 }]) } }), win);
  assert_(mUn.meta.nsCoverage.unmatchedRows === 1 && mUn.meta.nsCoverage.unmatchedHours === 10 &&
          mUn.meta.nsCoverage.unmatchedNames[0] === "Ghost Employee",
          "unresolved NS employee reported, not silently dropped");
  assert_(w30.pto === 4 && w30.avail === 36,
          "W30 PTO comes from the Accumulation ledger (no NETSUITE row that week)");
  assert_(m.meta.ptoSource === "accumulation", "meta names the PTO source");
  // Accumulation workbook unreadable → per-person NETSUITE fallback
  var m5 = assembleModel_(Object.assign({}, inputs, { pto: { ok: false, byEmp: {} } }), win);
  var maria5 = m5.people.filter(function (x) { return x.name === "Maria Alvarez"; })[0];
  assert_(maria5.weeks["2026.W31"].pto === 8 && maria5.weeks["2026.W30"].pto === 0,
          "fallback: NETSUITE rows drive PTO when the ledger is unreadable");
  assert_(m5.meta.ptoSource === "netsuite-fallback", "fallback labeled in meta");
  assert_(maria.teams.join("|") === "Team A|Team B", "teams split");
  assert_(maria.pms.join("|") === "Pat Manager", "PM collected from project rows only (time-off PM ignored, no dupes)");
  assert_(maria.isManager === false, "no M-level in title → IC");
  assert_(maria.region === "AMER" && maria.regionSource === "jira", "region from tracked ACME-1 hours");
  assert_(maria.tracks === true && maria.jobFamily === "Service Delivery", "tracking flag carried");
  assert_(maria.backlog && maria.backlog.count === 1 && maria.backlog.items[0].key === "ACME-7",
          "open backlog joined via comma-name alias");
  var tom = m.people[2], t31 = tom.weeks["2026.W31"];
  assert_(t31.cap === 38 && t31.capEst === true, "ANZ fallback capacity flagged estimated");
  assert_(tom.region === "ANZ" && tom.regionSource === "roster", "no tracked → roster fallback");
  assert_(tom.backlog === null, "no open issues → null backlog");
  // New hire: pre-hire weeks removed from the model entirely, 🌱 flag carried
  var nina = m.people[1];
  assert_(nina.name === "Nina New" && nina.newHire === true && nina.hired === "2026-07-15",
          "new-hire flag + hire date shipped");
  assert_(nina.weeks["2026.W28"] === undefined && nina.weeks["2026.W1"] === undefined,
          "pre-hire weeks do not exist");
  assert_(nina.weeks["2026.W29"] && nina.weeks["2026.W29"].cap === 40,
          "hire week onward present (fallback capacity)");
  assert_(maria.newHire === false && maria.weeks["2026.W1"] !== undefined,
          "no hire date → not flagged, full history kept");
  // Non-tracking family excluded from the population ENTIRELY
  assert_(m.people.every(function (p) { return p.name !== "Zoe Ops"; }),
          "non-tracking family dropped from population");
  assert_(m.meta.families.join("|") === "Service Delivery|Uncatalogued",
          "families list = included population only, blank → Uncatalogued");
  assert_(m.onTimeBuckets.length === 1 && m.onTimeBuckets[0].onTime === 1 &&
          m.onTimeBuckets[0].person === "Maria Alvarez", "onTime buckets person-attributed via alias join");
  // Fixture epic ran 18000s against a 36000s estimate — 50% under, well outside
  // the ±10% band, so it is measurable (n=1) but not on target (nWithin=0).
  assert_(m.forecastBuckets.length === 1 && m.forecastBuckets[0].n === 1 &&
          m.forecastBuckets[0].nWithin === 0 && m.forecastBuckets[0].nMissUnder === 1 &&
          m.forecastBuckets[0].person === "Maria Alvarez", "forecast buckets person-attributed");
  // Hygiene reads the RAW feed, so it sees the non-roster issue the tiles drop.
  var hyg = m.hygieneBuckets.filter(function (h) { return h.iso === "2026.W31"; })[0];
  assert_(hyg && hyg.res === 2 && hyg.resDue === 2 && hyg.resAttr === 1,
          "hygiene counts both resolved issues, only one of them attributed");
  assert_(hyg.resRegion === 0 && hyg.resFull === 0,
          "no issue-level region in the fixture → nothing fully attributed");
  assert_(m.meta.registry.version === METRIC_REGISTRY_.version, "registry shipped in meta");
  assert_(m.meta.forecastBand === CONFIG_DH.FORECAST_BAND, "band shipped so the tile can name it");
  assert_(m.meta.sources.length >= 4, "source systems listed for the data-provenance line");
  assert_(m.meta.jiraUnattributed.onTime === 1 && m.meta.jiraUnattributed.forecast === 0,
          "non-roster assignee tallied as unattributed");
  assert_(m.meta.teams.indexOf("Team A") !== -1 && m.meta.teams.indexOf("Squad X") === -1,
          "team dropdown = Tempo teams only (bucket teams no longer unioned)");
  assert_(m.meta.pms.join("|") === "Pat Manager", "PM dropdown vocabulary");
  var tom2 = m.people.filter(function (x) { return x.name === "Tom Baker"; })[0];
  assert_(tom2.pms.length === 0, "no project rows → no PMs");
  assert_(tom2.isManager === true && tom2.jobTitle.indexOf(".M5.") !== -1,
          "M-level job code → isManager, title carried in payload");
  assert_(tom2.onLeave === true && tom2.leaveStatus === "Paternity Leave",
          "leave status carried in payload");
  assert_(m.meta.headlineIso === "2026.W30" && m.meta.nsAvailable === true && m.meta.jiraAvailable === true, "meta");
  // Degradation: NS missing → nsAvailable false, people still built
  var m2 = assembleModel_(Object.assign({}, inputs, { ns: { rows: [], error: "missing" } }), win);
  assert_(m2.meta.nsAvailable === false && m2.people.length === 3, "NS-off degradation");
  // Fatal: roster error → model.error set
  var m3 = assembleModel_(Object.assign({}, inputs, { roster: { people: [], error: "boom" } }), win);
  assert_(!!m3.error, "roster failure is fatal");
  // ── Whole-roster attribution (v12, 2026-08-04) ──
  // A contractor sits outside the utilization population (no Department column
  // on the Contractors tab) but closes an issue: it must attribute via the
  // pre-gates attrib list, ship a weeks-less attribOnly stub, and never touch
  // capacity math or the family dropdown.
  var m6 = assembleModel_(Object.assign({}, inputs, {
    roster: { people: inputs.roster.people,
              attrib: [{ name: "Carlos Crew", rosterBucket: "APAC", isCrew: true,
                         jobFamily: "", jobTitle: "", hireDate: null }] },
    jira: Object.assign({}, inputs.jira, {
      issues: inputs.jira.issues.concat([
        { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
          assignee: "Crew, Carlos", estSec: 0, spentSec: 0, isClientCommitment: true }]) }),
  }), win);
  var carlos = m6.people.filter(function (x) { return x.name === "Carlos Crew"; })[0];
  assert_(!!carlos && carlos.attribOnly === true && Object.keys(carlos.weeks).length === 0,
          "contractor referenced by an issue → weeks-less attribOnly stub");
  assert_(carlos.region === "APAC" && carlos.isCrew === true,
          "stub carries roster-bucket region + crew flag");
  assert_(m6.onTimeBuckets.some(function (b) { return b.person === "Carlos Crew"; }),
          "comma-form contractor assignee attributes via the whole-roster index");
  assert_(m6.meta.jiraUnattributed.onTime === 1,
          "Random Dev is still the only unattributed issue");
  var hyg6 = m6.hygieneBuckets.filter(function (h) { return h.iso === "2026.W31"; })[0];
  assert_(hyg6.res === 3 && hyg6.resAttr === 2, "hygiene resAttr counts the contractor join");
  assert_(m6.people.length === 4 && m6.people[3].name === "Carlos Crew",
          "stubs appended after the alphabetical population");
  assert_(m6.meta.families.join("|") === "Service Delivery|Uncatalogued",
          "attribOnly stubs never widen the family dropdown");
  assert_(m6.meta.nsCoverage.personWeeks === m.meta.nsCoverage.personWeeks,
          "weeks-less stub adds nothing to the NS-coverage denominator");
  Logger.log("✅ _test_modelAssembly_ passed");
}

function _test_periods_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_periods_: " + m); }
  // Anchor: Fri 2026-07-31 = ISO 2026.W31 → window 2026.W1..2026.W34
  var win = buildDhWindow_(new Date(2026, 6, 31));
  var per = buildPeriods_(win);

  // periodInfoForIso_ basics
  var i31 = periodInfoForIso_("2026.W31"); // Thu 2026-07-30
  assert_(i31.month === "2026-07" && i31.monthLabel === "Jul 2026", "W31 → Jul 2026");
  assert_(i31.quarter === "FY27Q1" && i31.quarterLabel === "FY27 Q1", "Jul 2026 → FY27 Q1 (FY named for end year)");
  var i1 = periodInfoForIso_("2026.W1"); // Thu 2026-01-01
  assert_(i1.month === "2026-01" && i1.quarter === "FY26Q3", "W1 → Jan 2026, FY26 Q3");
  var iOct = periodInfoForIso_("2026.W41"); // Thu 2026-10-08
  assert_(iOct.quarter === "FY27Q2", "Oct → FY27 Q2");

  // Window EXTENT is derived from CONFIG_DH.WEEKS_PAST_DEEP, so assert the
  // relationship rather than a literal count — the depth is a tuning dial that
  // moves with the exporters' window.
  var months = per.month;
  var firstIso = win.allWeeks[0], lastIso = win.allWeeks[win.allWeeks.length - 1];
  assert_(months[0].key === periodInfoForIso_(firstIso).month &&
          months[months.length - 1].key === periodInfoForIso_(lastIso).month,
          "months span exactly the window, oldest → newest");
  assert_(months.length >= 8, "window covers at least 8 months, got " + months.length);

  // THE REQUIREMENT that drove WEEKS_PAST_DEEP 30 → 52 (2026-08-03): the tile
  // trends only use periods that are done AND not partial, so a window has to
  // contain enough COMPLETE periods or a view renders a single data point with
  // no trend line and no "vs prior" delta. At 30 weeks the quarterly view had
  // exactly one, which is what this guards against.
  var completeMonths = months.filter(function (p) { return p.status === "done" && !p.partial; });
  assert_(completeMonths.length >= 6,
          "Monthly view needs >= 6 complete months for a full trend, got " + completeMonths.length);

  var jul = months.filter(function (p) { return p.key === "2026-07"; })[0];
  assert_(jul.status === "now" && jul.partial === false, "Jul = now, complete (W27..W31 all in window)");
  assert_(jul.isos[0] === "2026.W27" && jul.isos[jul.isos.length - 1] === "2026.W31", "Jul member weeks");
  var jun = months.filter(function (p) { return p.key === "2026-06"; })[0];
  assert_(jun.status === "done" && jun.partial === false, "Jun = done, complete");
  var aug = months.filter(function (p) { return p.key === "2026-08"; })[0];
  assert_(aug.status === "plan" && aug.partial === true, "Aug = plan, truncated by window end");
  var jan = months.filter(function (p) { return p.key === "2026-01"; })[0];
  assert_(jan.status === "done" && jan.partial === false, "Jan complete (prior week W52/2025 is Dec)");

  // Quarters — newest is always the current one (FY27Q1 at this anchor), and
  // the span follows the window depth.
  var quarters = per.quarter;
  assert_(quarters[0].key === periodInfoForIso_(firstIso).quarter &&
          quarters[quarters.length - 1].key === "FY27Q1", "quarters span the window → current quarter");
  var curQ = quarters[quarters.length - 1];
  assert_(curQ.status === "now" && curQ.partial === true, "FY27Q1 now, truncated (Q runs to Sep)");
  assert_(quarters.filter(function (q) { return q.key === "FY26Q4"; })[0].status === "done",
          "FY26Q4 (Apr–Jun 2026) is a completed quarter");

  // The quarterly counterpart of the monthly guard above — this is the exact
  // assertion that fails at WEEKS_PAST_DEEP = 30 (one complete quarter only).
  // Measured worst case (running in the LAST week of a quarter, which is when
  // the window's oldest quarter is most truncated):
  //   30 weeks → 1 complete quarter   (no trend at all — the bug this fixes)
  //   52 weeks → 3 complete quarters  ← current setting
  //   65 weeks → 4 complete quarters  (the cliff for a full-year / YoY compare)
  // The window's OLDEST quarter is always partial, so the count is never
  // simply floor(weeks / 13).
  var completeQuarters = quarters.filter(function (q) { return q.status === "done" && !q.partial; });
  assert_(completeQuarters.length >= 3,
          "Quarterly view needs >= 3 complete fiscal quarters for a trend, got " +
          completeQuarters.length + " — raise CONFIG_DH.WEEKS_PAST_DEEP (and the " +
          "exporters' EXPORT_HISTORY_WEEKS with it; 65 buys the 4th quarter)");
  completeQuarters.forEach(function (q) {
    assert_(q.isos.length >= 12, q.key + " complete quarter holds >= 12 weeks, got " + q.isos.length);
  });

  // adjacentIso_ year wrap
  assert_(adjacentIso_("2026.W1", -1) === "2025.W52", "W1 − 1 wraps to prior year");
  assert_(adjacentIso_("2025.W52", 1) === "2026.W1", "W52 + 1 wraps forward");
  Logger.log("✅ _test_periods_ passed");
}

function _test_levelTrack_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_levelTrack_: " + m); }
  // Ported from CompDash parseLevel_ — same fixtures, same expectations.
  var t;
  t = dhLevelTrack_("04.I3.1 - Consultant, Delivery");
  assert_(t.level === "I3" && t.track === "IC", "dotted IC token");
  t = dhLevelTrack_("04.M10.2 - Director, Services");
  assert_(t.level === "M10" && t.track === "M", "two-digit M-level");
  t = dhLevelTrack_("M5 - Manager, Service Delivery");
  assert_(t.track === "M" && t.level === "M5", "token at start of title (no dot prefix)");
  t = dhLevelTrack_("Team Manager");
  assert_(t.track === null && t.level === "—", "the WORD Manager is not a level token");
  t = dhLevelTrack_("PM5 Coordinator");
  assert_(t.track === null, "letter-adjacent M (PM5) never matches");
  assert_(dhLevelTrack_("").track === null && dhLevelTrack_(null).track === null, "blank/null → null track");
  Logger.log("✅ _test_levelTrack_ passed");
}

function _test_ptoUsage_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_ptoUsage_: " + m); }
  var rows = [
    // Explicit amount wins; usage on Mon 2026-07-27 (W31) + Fri 2026-07-31 (W31)
    { empNum: "1001", date: new Date(2026, 6, 27), adjType: "Usage", amount: 8, balance: 92 },
    { empNum: "1001", date: new Date(2026, 6, 31), adjType: "Time Off", amount: 8, balance: 84 },
    // Accrual rows never count as usage
    { empNum: "1001", date: new Date(2026, 6, 28), adjType: "Accrual", amount: 10, balance: 100 },
    // Delta fallback: no amount column → |balance − prev balance|
    { empNum: "2002", date: new Date(2026, 6, 20), adjType: "Accrual", amount: null, balance: 50 },
    { empNum: "2002", date: new Date(2026, 6, 21), adjType: "Usage", amount: null, balance: 42 }, // 8h W30
    // Usage with no amount and no prior balance → skipped (counted)
    { empNum: "3003", date: new Date(2026, 6, 21), adjType: "Usage", amount: null, balance: null },
    // Blank empNum / invalid date rows ignored
    { empNum: "", date: new Date(2026, 6, 21), adjType: "Usage", amount: 8, balance: 10 },
  ];
  var r = ptoUsageFromRows_(rows, "hours", 8);
  assert_(r.byEmp["1001"]["2026.W31"] === 16, "two explicit-amount usages sum in the week");
  assert_(!("2026.W30" in (r.byEmp["1001"] || {})), "accrual rows never create usage");
  assert_(r.byEmp["2002"]["2026.W30"] === 8, "delta fallback |42−50| = 8h");
  assert_(r.skipped === 1, "amount-less usage without prior balance skipped + counted");
  // Same-date batch (accrual + amount-less usage posted on one day): the delta
  // fallback reads prevBalance, so LEDGER ORDER must survive the sort. Accrual
  // first (50 → 60), then usage to 52 = 8h. Sorting the usage ahead of the
  // accrual would read |52 − 50| = 2h and under-report the absence.
  var same = ptoUsageFromRows_([
    { empNum: "4004", date: new Date(2026, 6, 13), adjType: "Accrual", amount: null, balance: 50 },
    { empNum: "4004", date: new Date(2026, 6, 20), adjType: "Accrual", amount: null, balance: 60 },
    { empNum: "4004", date: new Date(2026, 6, 20), adjType: "Usage",   amount: null, balance: 52 },
  ], "hours", 8);
  assert_(same.byEmp["4004"]["2026.W30"] === 8, "same-date accrual+usage keeps ledger order (8h, not 2h)");
  // Days unit converts
  var d = ptoUsageFromRows_([{ empNum: "9", date: new Date(2026, 6, 27), adjType: "usage", amount: 1, balance: null }], "days", 8);
  assert_(d.byEmp["9"]["2026.W31"] === 8, "days unit × hoursPerDay");
  Logger.log("✅ _test_ptoUsage_ passed");
}
