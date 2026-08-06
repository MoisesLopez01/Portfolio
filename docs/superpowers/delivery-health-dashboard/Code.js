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

  JIRA_RAW_SHEET:    "Jira Raw",
  // Flow-metrics feeds (Jira Backlog.js v3.9.0). Absent tab = absent feature,
  // never an error — see readJiraBugs_ / readFlowSnapshots_.
  JIRA_BUGS_SHEET:   "Jira Bugs",
  FLOW_SNAP_SHEET:   "Flow Snapshots",
  ARRIVALS_SHEET:    "Jira Arrivals",   // weekly created/resolved tally (Jira Backlog.js v3.11.0)
  ROSTER_SHEET:      "Data",
  CONTRACTORS_SHEET: "Contractors Data",
  ROSTER_CLASS:      "Professional Services",
  ROSTER_DEPT:       "Services",
  // NETSUITE keys mark Tempo rows with no client project behind them (PTO and
  // other time off). USER DECISION 2026-08-04: this dashboard models NO
  // absenteeism — there is no absence signal in planned time, tracked time, or
  // any leave feed. Time off a person TRACKS is simply non-billable time (it
  // cannot be charged to a customer project); it never reduces capacity.
  // Time-off rows in PLANNED time are dropped — they plan no project work.
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

  // ── Region buckets: roster "Key Location" → bucket (FALLBACK lens only;
  //    primary person-region = majority of Jira-tagged tracked hours).
  //    Extend after the W32 Key Location audit (spec §10.2). ──
  LOCATION_REGION_MAP: {
    "australia & new zealand": "ANZ",
    // SEA, not APAC — APAC retired 2026-08-05 (superset of ANZ + SEA; see
    // JIRA_REGION_TO_DH_). These three ARE literally South East Asia.
    "malaysia": "SEA", "singapore": "SEA", "philippines": "SEA",
    "united states": "AMER", "canada": "AMER", "costa rica": "AMER",
    "chile": "AMER", "colombia": "AMER", "mexico": "AMER",
    "united kingdom": "EMEA", "spain": "EMEA", "portugal": "EMEA",
    // Netherlands was falling through to "Other" — the only real roster
    // location the map missed (user report + roster audit 2026-08-04).
    "netherlands": "EMEA",
  },
  REGION_FALLBACK: "Other",
  // A rocketeer with NO region signal at all — no Jira-tagged hours and a blank
  // roster location — lands in EMEA (user decision 2026-08-04: "empty region
  // rocketeers → EMEA"). Distinct from REGION_FALLBACK, which is for a REAL
  // location the map doesn't know yet: that discomfort stays visible as "Other".
  PERSON_REGION_DEFAULT: "EMEA",

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

  // Minimum issues before a person's compliance signal is GRADED (Actions
  // roster, spec 2026-08-05). Below it the cell shows the % ungraded/grey —
  // one missing due date on one ticket must never render the same red as
  // fifteen on forty. The roster's equivalent of STD_MIN_PERIODS.
  SIGNAL_MIN_N: 4,

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

  // ── Export freshness ──
  // Hours after which the Jira Raw export is called stale on the header stamp.
  // The exporter runs on a daily ~03:00 trigger, so a healthy stamp is under 24h
  // old and anything past 30 means a run was MISSED, not merely that it is
  // afternoon. Set deliberately above 24: warning at 24h sharp would paint the
  // banner amber every single day between 03:00 and the next run.
  // Owner: whoever owns the Jira Backlog.js trigger cadence — change both together.
  JIRA_EXPORT_STALE_H: 30,
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
  version: "3.2",
  updated: "2026-08-05",  // 2026.W32

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
      sources: ["Tempo Tracked Time", "Capacity Tempo", "NS Billable", "Roster"],
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
        "Tracked time is classified TWO ways only: billable and non-billable. Time off tracked in Tempo (NETSUITE rows) is non-billable time — it cannot be charged to a customer project.",
        "NO absenteeism is modelled — there is no absence signal in planned time, tracked time, PTO, medical or parental leave feeds (user decision 2026-08-04). Capacity is always gross scheduled hours; nothing is netted out for absence.",
        "Population is the tracking-mandated job families only (JF007/JF009 + blank/crew). Families with no tracking obligation are out of the dashboard entirely.",
        "People on long leave (roster Employee Status) are excluded from both numerator and denominator: Tempo capacity can lag HR, so their scheduled hours would otherwise read as idle capacity.",
        "Interns (job-title level I1) are excluded from every published rate — they are in training, not delivery capacity, and a metric must never punish an intern (user decision 2026-08-04). Their profiles and hours stay visible on the roster, marked 🎓.",
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

    // ── 🌊 FLOW METRICS (spec 2026-08-05-flow-metrics-design.md) ──
    // All five live metrics: NON-EPIC grain (D4), target: null (D6 — no RAG
    // until the Services Director sets targets; a neutral tile beats an
    // invented threshold). Two more are declared absent below, CSAT-style.
    leadTime: {
      id: "leadTime",
      name: "Lead Time",
      definition: "Calendar days between a work item's creation and its resolution — how long a request lives in the system end to end.",
      formula: "median(resolution date − created date) in calendar days over non-epic issues resolved in period; p85 companion (the tail is the finding)",
      sources: ["Jira Raw — Created, Resolution Date, Issue Type, Assignee"],
      grain: "Non-epic issue (Story/Task/Sub-task), rolled up by person → team → region",
      target: null,
      unit: "days",
      lowerIsBetter: true,
      coverageGate: 0.90,
      coverageOf: "resolved non-epic issues carrying both dates",
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once one is agreed)",
      ebitda: "Long lead times delay revenue recognition and stretch client commitments. Not quantified — no rate basis (PR-06).",
      deviations: [
        "CALENDAR days, not working days — weekends and holidays count. Stated on the card so a 9-day median is never read as 9 working days.",
        "Non-epic grain (spec D4): an epic's lead time is a programme lifecycle, not a work-item lifecycle — same reasoning as ONTIME_SCOPE.",
        "Issues whose created date postdates their resolution (clock skew / imported records) count toward coverage but are never scored.",
      ],
    },

    cycleTime: {
      id: "cycleTime",
      name: "Cycle Time",
      definition: "Calendar days between the first transition into In Progress and resolution — how long active work takes once started.",
      formula: "median(resolution date − first In-Progress date); NOT COMPUTABLE on the current export",
      sources: ["Jira changelog (first In-Progress transition) — NOT EXPORTED (CONFIGJ.FETCH_CHANGELOG is off, user decision 2026-08-05)"],
      grain: "Non-epic issue",
      target: null,
      unit: "days",
      lowerIsBetter: true,
      coverageGate: 0,
      coverageOf: "n/a — no feed",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Not quantified.",
      status: "absent",
      absentReason: "Needs the first In-Progress date from the Jira changelog — not yet exported (FETCH_CHANGELOG off, user decision 2026-08-05). The changelog-free approximation (resolution − last status change) is ≈0 for every Done issue and is deliberately NOT published.",
      deviations: [],
    },

    throughput: {
      id: "throughput",
      name: "Throughput",
      definition: "Estimated hours of work delivered in the period — the sum of Original Estimate on resolved items.",
      formula: "Σ Original Estimate (hrs) over non-epic issues resolved in period",
      sources: ["Jira Raw — Original Estimate (sec), Resolution Date, Issue Type, Assignee"],
      grain: "Non-epic issue (epic + child estimates would double-count the sum — spec D4), rolled up by person → team → region",
      target: null,
      unit: "hrs",
      coverageGate: 0.60,
      coverageOf: "resolved non-epic issues carrying a non-zero estimate",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Throughput × blended rate approximates delivered value per period. Not quantified — no rate basis (PR-06).",
      deviations: [
        "UNESTIMATED WORK DELIVERS INVISIBLY here — the sum only sees issues carrying an estimate. The card states the estimated share; the fix is estimate fill, not a different formula.",
      ],
    },

    backlog: {
      id: "backlog",
      name: "Backlog (Inventory)",
      definition: "Estimated hours of assigned work waiting to start — open items in status category To Do.",
      formula: "Σ max(0, Original Estimate − Time Spent) (hrs) over open, assigned, non-epic issues in status category To Do",
      sources: ["Jira Raw — Week=Open rows: Status Category, Original Estimate (sec), Time Spent (sec), Assignee",
                "Flow Snapshots tab (trend — the exporter appends one row per run; history accumulates forward)"],
      grain: "Open non-epic issue, by person → team → region (current value); whole population (trend)",
      target: null,
      unit: "hrs",
      coverageGate: 0.60,
      coverageOf: "waiting items carrying an estimate",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Backlog hours × blended rate approximates contracted-but-undelivered value. Not quantified (PR-06).",
      deviations: [
        "The open-backlog export is bounded by CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS (26): a ticket untouched for 6 months is treated as abandoned, not inventory.",
        "The TREND is whole-population (the exporter's snapshot knows nothing of dashboard filters) — the sparkline hides under active filters and the card says so.",
        "History accumulates from the first v3.9.0 export run — snapshots cannot be back-filled.",
      ],
    },

    wip: {
      id: "wip",
      name: "Work In Progress",
      definition: "Open assigned items currently in status category In Progress — the active work inside the system right now.",
      formula: "count of open, assigned, non-epic issues in status category In Progress",
      sources: ["Jira Raw — Week=Open rows: Status Category, Assignee",
                "Flow Snapshots tab (trend)"],
      grain: "Open non-epic issue, by person → team → region (current value); whole population (trend)",
      target: null,
      unit: "items",
      coverageGate: 0,
      coverageOf: "n/a — a count over rows that exist",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "No direct translation — WIP is a flow-control signal, not a cost line.",
      deviations: [
        "Together with Backlog this PARTITIONS the open assigned book by status category; items in a custom category that is neither To Do nor In Progress land in neither tile and are counted on the card.",
        "Same trend caveats as Backlog: whole-population snapshots, history from the first v3.9.0 run.",
      ],
    },

    flowEfficiency: {
      id: "flowEfficiency",
      name: "Flow Efficiency",
      definition: "Share of an item's elapsed life spent actively being worked vs waiting.",
      formula: "Σ active-status dwell ÷ Σ (resolution − created); NOT COMPUTABLE on the current export",
      sources: ["Jira changelog (per-status dwell time) — NOT EXPORTED"],
      grain: "Non-epic issue",
      target: null,
      unit: "%",
      coverageGate: 0,
      coverageOf: "n/a — no feed",
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Not quantified.",
      status: "absent",
      absentReason: "Needs per-status dwell time from the Jira changelog plus an agreed active-statuses vocabulary — the most expensive item on the flow list. Revisit only after Cycle Time proves the changelog path (cost + truncation on long-lived issues).",
      deviations: [],
    },

    bugCount: {
      id: "bugCount",
      name: "Bug Count",
      definition: "Defects reported in the period — Bug issues created, with bugs resolved as the companion so the tile says whether the bug book is growing.",
      formula: "count of Bug issues created in period (companion: resolved in period)",
      sources: ["Jira Bugs tab (Jira Backlog.js v3.9.0) — Created, Resolution Date"],
      grain: "Bug issue, POPULATION-WIDE (header filters do not apply — see deviations)",
      target: null,
      unit: "bugs",
      lowerIsBetter: true,
      coverageGate: 0,
      coverageOf: "n/a — a count over rows that exist",
      owner: "Delivery + CX",
      paramOwner: "Services Director",
      ebitda: "Bug fixing is uncompensated labour — hours on bugs × cost rate. Not quantified (PR-06).",
      deviations: [
        "POPULATION-WIDE, unlike every other tile: bugs are routinely unassigned at creation, so a roster join would silently drop most of the population — the exact silent-subset failure the comparison charts were fixed for. The card states it.",
        "Noise-filtered at export: a bug closed Won't Do / Duplicate / Canceled was a report, not a defect (isNoiseIssue_ in Jira Backlog.js).",
        "DISTINCT from Quality/Rework: rework counts delivered work that came back; this counts defects reported. A bug feeds neither leg of the rework rate.",
      ],
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
    // PRESENTATION change only — nothing recomputes, nothing stops being
    // measured, so `affects` is empty. The retirement is evaluated from the data
    // on every render, which is why there is no config flag to find later.
    { version: "3.2", date: "2026-08-06", author: "Alex López",
      affects: [],
      change: "'…and that assignee resolves to a roster person' is retired from the gaps queue, the Executive data-trust strip and the 🧬 matrix's → roster column while it measures 100%. It is still computed on every rebuild and returns to all three surfaces automatically — no deploy — if a single record stops joining.",
      rationale: "User decision 2026-08-06: the roster-join discrepancies are solved, so the check is a column of 100%s that trains readers to skim past the fields that do vary. Hidden rather than deleted, because this is the dashboard's only view of a loss that was 173 of 351 records (49%) on the 2026-08-04 profile — and if it regressed it would show up as four wrong cards, not as a missing column. The queue names what it retired and says the measurement is still running, so a disappearing check can't be mistaken for a deleted one." },
    // Coverage-measurement change on a hygiene surface, not a metric definition:
    // no registry metric recomputes, so `affects` is empty and no trend line gets
    // a "definition changed" marker. The Logged COLUMN on the 🧬 matrix and the
    // 👥 roster will still step visibly upward on deploy — that step is the
    // denominator being corrected, and this entry is what explains it.
    { version: "3.1", date: "2026-08-06", author: "Alex López",
      affects: [],
      change: "Logged time is now expected only on work that has STARTED (Jira status category In Progress). On the open backlog, To Do issues are excluded from the Logged column's denominator on both the 🧬 field-fill matrix and the 👥 signals roster instead of counting as gaps. Resolved work is unchanged — finished work is still expected to carry its cost.",
      rationale: "User report 2026-08-06. Time is logged as work is done, so a ticket nobody has picked up should carry no worklog. Live check on the 26-week open backlog (1,444 assigned open issues): 782 of the 1,116 flagged rows — 70% — were To Do tickets, and open Logged fill read 23% when the honest figure against the started population is 45%. The queue was seven times larger than the work in it, which is why none of the 334 real gaps were being cleared. Separately, 57 To Do tickets DO carry logged time; those are a status-hygiene problem with a different owner and are excluded from both halves rather than scored as credit." },
    { version: "3.0", date: "2026-08-05", author: "Alex López",
      affects: [],
      change: "Added the 🌊 Flow metric family: Lead Time, Throughput, Backlog, WIP, Bug Count (live, target: null — informational until targets are agreed) and Cycle Time + Flow Efficiency (declared absent — changelog not exported). Non-epic grain throughout.",
      rationale: "Spec 2026-08-05-flow-metrics-design.md, decisions D1–D6. New metrics on a new tab; nothing existing recomputes, so affects is empty and no existing trend line gets a definition-changed marker." },
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

// ── REGION RESOLUTION (spec: issue-level standard, roster fallback) ──

function regionBucketFromLocation_(keyLocation) {
  var k = normDH_(keyLocation);
  // Blank location = an EMPTY region, not an unknown one — those rocketeers
  // land in EMEA (user decision 2026-08-04), never in "Other".
  if (!k) return CONFIG_DH.PERSON_REGION_DEFAULT;
  return CONFIG_DH.LOCATION_REGION_MAP[k] || CONFIG_DH.REGION_FALLBACK;
}

/**
 * Person region = GEOGRAPHIC region receiving the most Jira-tagged tracked
 * hours in the trend window; ties break alphabetically (deterministic). No
 * geographic tagged hours (> 0) → roster-location fallback, labeled
 * source:"roster"; no roster signal either → PERSON_REGION_DEFAULT (EMEA —
 * empty-region rocketeers, 2026-08-04).
 *
 * "Global" and "Other" hours are EXCLUDED from the vote (2026-08-05, reviewer
 * report "ANZ has no members"): Global is the single most common Jira tag and
 * says what the WORK serves, not where the PERSON sits — letting it vote
 * systematically vacuumed people out of small regions (the roster has ~10
 * active ANZ rocketeers, yet ANZ rendered empty because their tracked issues
 * were mostly Global-tagged). Global-tagged work rolls up under its assignee's
 * geographic region — every metric bucket is keyed by person, which is also
 * why there is no "Global" chip in meta.regions: it could never match anyone.
 */
var DH_NON_GEO_REGIONS_ = { "Global": true, "Other": true };
function assignPersonRegion_(hoursByRegion, rosterBucket) {
  var best = null, bestH = 0;
  Object.keys(hoursByRegion).sort().forEach(function (r) {
    if (DH_NON_GEO_REGIONS_[r]) return;
    var h = Number(hoursByRegion[r]) || 0;
    if (h > bestH) { best = r; bestH = h; }
  });
  if (best !== null && bestH > 0) return { region: best, source: "jira" };
  return { region: rosterBucket || CONFIG_DH.PERSON_REGION_DEFAULT, source: "roster" };
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
 * People on long leave (p.onLeave — roster Employee Status) are ALWAYS
 * excluded, no include flag: their capacity rows may still carry avail > 0
 * (Tempo schedules lag HR), which would drag the rate down for an employment
 * status, not a performance signal.
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
    // Interns (I1) never move a rate — in training, not delivery capacity
    // (user decision 2026-08-04). Unlike onLeave, their grid hours stay shown.
    if (p.isIntern === true) return;
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
  // One denominator: gross scheduled capacity — the Metrics Dictionary's rate
  // (billable ÷ headcount × standard hours). NO absenteeism is modelled
  // (user decision 2026-08-04), so avail === cap and the old net-of-absence
  // companion rate is gone; billablePct is kept as a field name for the client
  // mirror but is numerically the same gross rate.
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
 * gapHours = Σ|NS raw total − Tempo PROJECT-tracked| over classified
 * person-weeks (time-off tracked hours are excluded from the comparison — NS
 * never sees them, so counting them would report the no-absenteeism rule as a
 * feed disagreement). Large values mean the feeds disagree about how much work
 * happened, which the ratio model absorbs silently (it trusts Tempo's total) —
 * so it is surfaced here rather than left invisible. unmatchedNames are NS
 * employees no roster alias resolved: their hours classify nothing at all.
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
                      ((Number(w.tracked) || 0) - (Number(w.trackedOff) || 0)));
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

/**
 * Resolved NON-EPIC issues → per-week lead-time buckets (🌊 Flow, spec
 * 2026-08-05 §3.1). Same shape and rules as onTimeBuckets_: person-attributed
 * via the roster join, unattributed tallied for the honesty note.
 *
 * Median (and p85) are NOT additive, so the raw day values ship per bucket and
 * the client aggregates whatever the active filter selects — the same pattern
 * as forecast's absVars. Values rounded to 0.1d and capped at 1000d so one
 * archaeological ticket can't bloat the payload.
 *
 *   nAll  every resolved non-epic issue (coverage denominator)
 *   n     those with a usable created date (created ≤ resolved)
 *   days  calendar days created → resolved, one per measured issue
 */
function leadTimeBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;                       // grain decision D4
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, n: 0, nAll: 0, days: [] };
    map[k].nAll++;
    if (!it.created || isNaN(it.created.getTime())) return;
    var days = (it.resolved.getTime() - it.created.getTime()) / 86400000;
    if (days < 0) return;  // clock skew / bad data — a gap, not a measurement
    map[k].n++;
    map[k].days.push(Math.round(Math.min(1000, days) * 10) / 10);
  });
  return { buckets: Object.keys(map).map(function (k) { return map[k]; }),
           unattributed: unattributed };
}

/**
 * Resolved NON-EPIC issues → per-week throughput buckets (🌊 Flow, spec §3.3):
 * Σ Original Estimate hours delivered. Non-epic only — an epic AND its children
 * both carrying estimates would double-count the sum (grain decision D4).
 *
 *   nAll    every resolved non-epic issue (coverage denominator)
 *   nEst    those carrying a non-zero estimate
 *   estHrs  Σ estimate hours over nEst — unestimated work delivers INVISIBLY
 *           here; the card's coverage chip carries that caveat.
 */
function throughputBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var person = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!person) { unattributed++; return; }
    var iso = weekKeyFromDate_(it.resolved);
    var k = iso + "" + person;
    if (!map[k]) map[k] = { iso: iso, person: person, nAll: 0, nEst: 0, estHrs: 0 };
    map[k].nAll++;
    var est = Number(it.estSec) || 0;
    if (est <= 0) return;
    map[k].nEst++;
    map[k].estHrs += est / 3600;
  });
  var buckets = Object.keys(map).map(function (k) {
    map[k].estHrs = Math.round(map[k].estHrs * 10) / 10;
    return map[k];
  });
  return { buckets: buckets, unattributed: unattributed };
}

/**
 * OPEN assigned non-epic issues → per-PERSON backlog/WIP buckets (🌊 Flow,
 * spec §3.4/§3.5). No iso key — a backlog is a snapshot, not a time series
 * (history comes from the exporter's Flow Snapshots tab instead).
 *
 * Status category partitions the open book:
 *   "To Do"       → backlog (waiting to start): todoN, todoEst,
 *                   todoHrs = Σ max(0, est − spent)
 *   "In Progress" → WIP: wipN (same semantics as the exporter's fetchActiveWIP_)
 *   blank/other   → uncategorized tally — a pre-v3.6.0 export has no Status
 *                   Category column, and inventing a side would be a guess.
 *
 * Open = unresolved + assigned + status not closed-ish — the SAME rule as
 * readJiraRaw_'s openIssues, restated over `issues` because openIssues records
 * don't carry statusCategory/estSec.
 */
function flowOpenBuckets_(issues, resolvePerson) {
  var map = {}, unattributed = 0, uncategorized = 0;
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;
    if (it.resolved && !isNaN(it.resolved.getTime())) return;
    var raw = String(it.assignee || "").trim();
    if (!raw || /unassigned/i.test(raw)) return;
    if (DH_CLOSED_STATUS_.test(String(it.status || ""))) return;
    var person = resolvePerson ? resolvePerson(raw) : null;
    if (!person) { unattributed++; return; }
    if (!map[person]) map[person] = { person: person, wipN: 0,
                                      todoN: 0, todoEst: 0, todoHrs: 0 };
    var cat = String(it.statusCategory || "");
    if (/in progress/i.test(cat)) { map[person].wipN++; return; }
    if (/to do/i.test(cat)) {
      map[person].todoN++;
      var est = Number(it.estSec) || 0;
      if (est > 0) map[person].todoEst++;
      map[person].todoHrs += Math.max(0, est - (Number(it.spentSec) || 0)) / 3600;
      return;
    }
    uncategorized++;
  });
  var buckets = Object.keys(map).map(function (k) {
    map[k].todoHrs = Math.round(map[k].todoHrs * 10) / 10;
    return map[k];
  });
  return { buckets: buckets, unattributed: unattributed, uncategorized: uncategorized };
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
      // Both exist because a single strict composite used to be useless as a
      // trend: resFull was pinned at 0% and STAYED there however much the
      // due-date and assignee fill rates improved, and a number that cannot move
      // is a number people stop looking at.
      //
      // ⚠ The reason recorded here was "the Region field is unpopulated
      // org-wide". That was WRONG — corrected 2026-08-04. Region was populated on
      // ~34% of the 52-week resolved window all along; the Jira Raw exporter was
      // dropping it, because Jira's "Resource region" is a MULTI-SELECT and the
      // reader took .value off the array (fixed in "Jira Backlog.js" v3.7.0).
      // resFull can now move, so the two composites are no longer 0%-vs-real —
      // they are strict-vs-published, which is what they should always have been.
      // Both stay: resFull remains the headline (the target is the finished
      // system); resReady is shown beside it as the bar today's metrics clear.
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

// ══════════════════════════════════════════════════════════════════════════
// FIELD FILL BY ISSUE TYPE (spec 2026-08-04-hygiene-by-issue-type-design.md)
//
// hygieneBuckets_ answers "how much is missing". This answers "WHERE DO I GO
// AND FIX IT", which is a different question with a different owner: the gaps
// table is read by whoever owns the metric, this is read by whoever owns the
// tickets.
//
// Two populations, because they answer different questions:
//   resolved — explains the numbers on the cards today. Diagnostic. Bucketed by
//              resolution week so the period picker drives it like every other
//              surface.
//   open     — the current and future backlog. ACTIONABLE: a due date added to
//              an open ticket moves next quarter's On-Time rate; one added to a
//              closed ticket is archaeology. Carries NO ISO week — a backlog is
//              a snapshot, not a time series, and bucketing it by created /
//              updated / due would invent a history it does not have.
//
// WHY IT MATTERS THAT THIS SPLITS BY TYPE: `isEpic` is a substring match on
// "epic", so Kick-off epic and Go-live epic already sit inside the On-Time
// dictionary scope and the Forecast denominator, pooled with plain Epic. Every
// epic-grain number the dashboard publishes is an average across three
// semantically different work objects, and nothing on screen says so.
// ══════════════════════════════════════════════════════════════════════════

/** Failing keys carried per field per type. Enough to BE the work queue; capped
    so one badly-tagged type can't dominate the payload. The cap is reported
    (keysCapped) rather than silently truncating — a clipped list read as
    complete is how "we fixed them all" becomes wrong. */
var TYPE_HYG_MAX_KEYS_ = 500;

/** The seven fields the matrix grades, in display order. */
var TYPE_HYG_FIELDS_ = ["due", "assigned", "attr", "est", "time", "region", "team"];

/**
 * Is this record open work? Unresolved AND not sitting in a closed-ish status.
 * Both halves are needed: Jira leaves Resolution Date empty on some closed
 * workflows, so "no resolution date" alone would drag genuinely-finished
 * tickets into the backlog matrix and inflate every gap in it.
 */
function typeHygOpen_(it) {
  if (it.resolved && !isNaN(it.resolved.getTime())) return false;
  return !DH_CLOSED_STATUS_.test(String(it.status || ""));
}

/**
 * Has this record STARTED — status CATEGORY "In Progress"?
 *
 * One truth for two readers: the Flow tab's `wip` metric and the logged-time
 * expectation below. They must never disagree about whether a ticket is being
 * worked on.
 *
 * Category, not status name, on purpose. The live vocabulary inside the
 * In Progress category (servicerocket-coe, 604 open assigned issues, 2026-08-06)
 * is In Progress · Review · Blocked · Ready — all four are work somebody has
 * picked up, and a name-based rule would have to be re-edited every time a
 * project adds a workflow step. Falls back to the status name only on a
 * pre-v3.6.0 export that carries no Status Category column.
 */
function dhStarted_(it) {
  return /in\s*progress/i.test(String(it.statusCategory || it.status || ""));
}

/**
 * Is logged time EXPECTED on this record — i.e. does its absence count as a gap?
 *
 * ── WHY THIS IS NOT "every open ticket" (2026-08-06, user finding) ───────────
 * Time is logged against work as it is done. A ticket nobody has started yet
 * SHOULD carry no worklog: that is the process working, not a hygiene failure.
 * Counting it as one produced a queue that could not be worked. Measured live
 * over the 26-week open backlog the exporter actually feeds (1,444 assigned
 * open issues, servicerocket-coe, 2026-08-06):
 *
 *     To Do        840 — 782 with no worklog   ← every one of these was flagged
 *     In Progress  604 — 334 with no worklog   ← the real queue
 *
 * So 782 of the 1,116 "missing logged time" rows — 70% — were tickets nobody
 * had started. Open Logged fill read 23% (328/1,444) when the honest number
 * against the started population is 45% (270/604). A metric that is wrong in
 * the pessimistic direction is not the safe kind of wrong: it made the field
 * unfixable, so nobody fixed the 334 that were real.
 *
 * The counterpart gap is NOT measured here and is deliberately left alone: 57
 * To Do tickets DO carry logged time, which is a status-hygiene problem (work
 * started, board never moved) with a different owner and a different fix. They
 * are excluded from both halves of this ratio rather than scored as credit.
 *
 * Resolved work is always expected to carry its cost — finished work with no
 * worklog is exactly the forecast-coverage gap the Forecast tile already owns.
 *
 * @param {Object} it     issue record from readJiraRaw_
 * @param {boolean} isOpen  true for the open-backlog population
 * @returns {boolean}
 */
function timeExpected_(it, isOpen) {
  return isOpen ? dhStarted_(it) : true;
}

/**
 * Per-issue-type field fill, over the resolved and open populations.
 *
 * @param {Object} jira      readJiraRaw_ output
 * @param {Function} resolvePerson  Jira assignee → roster display name, or null
 * @param {string=} scope    ONTIME_SCOPE reading (test hook); defaults to config
 * @returns {{resolved:Array, open:Array, keyCap:number}}
 */
function typeHygieneBuckets_(jira, resolvePerson, scope) {
  var sc = scope || CONFIG_DH.ONTIME_SCOPE || "dictionary";
  var res = {}, open = {};

  function row(map, k, type, isEpic, inOnTimeScope) {
    if (!map[k]) {
      map[k] = { iso: "", type: type, isEpic: !!isEpic,
                 // Whether THIS type's due date actually gates the published
                 // On-Time rate. Derived from onTimeInScope_ — the same
                 // predicate the metric uses, never a second copy of the rule.
                 // Without it the matrix invites a Sub-task due-date campaign
                 // that moves no number.
                 gatesOnTime: !!inOnTimeScope,
                 // Estimates only gate Forecast at epic grain.
                 gatesForecast: !!isEpic,
                 n: 0, due: 0, assigned: 0, attr: 0, est: 0, time: 0, region: 0, team: 0,
                 // `timeN` is a SEPARATE denominator for the `time` column, not a
                 // typo for n — see timeExpected_. Every other field is expected on
                 // every record in the row, so they divide by n; logged time is only
                 // expected once work has started. Same tristate shape as billN on
                 // the person roster: measure what you can grade, grade what you
                 // measured. On the resolved half timeN === n by construction.
                 timeN: 0,
                 // `attrN` — attr's OWN denominator, exactly like timeN below.
                 // A record with no assignee has no assignee to fail to join: it
                 // belongs in neither half. Dividing attr by n instead scores an
                 // ABSENT assignee as a FAILED roster join, which is a different
                 // fact and one the `assigned` column already reports. That
                 // conflation is harmless only while unassigned rows are absent
                 // from Jira Raw; once they are exported it drops a solved,
                 // retired check to ~44% and puts a false failure on three
                 // surfaces at once (spec §4.6, D12).
                 attrN: 0,
                 keys: {}, keysCapped: {} };
    }
    return map[k];
  }

  function tally(r, it, isOpen) {
    r.n++;
    // "⚠️ UNASSIGNED" is the exporter's sentinel for an empty Jira assignee, so
    // an unassigned issue is NOT an empty string here — treating it as a name
    // would score the gap as filled.
    var rawA = String(it.assignee || "").trim();
    var hasAssignee = !!rawA && !/unassigned/i.test(rawA);
    var est = Number(it.estSec) || 0;
    var got = {
      due:      !!(it.due && !isNaN(it.due.getTime())),
      assigned: hasAssignee,
      attr:     !!(resolvePerson && resolvePerson(it.assignee || "")),
      est:      est > 0,
      time:     (Number(it.spentSec) || 0) > 0,
      region:   !!it.region && it.region !== DH_REGION_UNASSIGNED_,
      team:     !!it.team,
    };
    // Not-yet-started open work is outside the logged-time question entirely:
    // neither numerator nor denominator, and no key in the queue. Scoring it as
    // a hit instead would be worse than the bug it replaces — it would report an
    // untouched backlog as perfectly tracked.
    var wantTime = timeExpected_(it, isOpen);
    if (wantTime) r.timeN++;
    // attr is only ANSWERABLE where an assignee exists — same tristate shape as
    // timeN above: measure what you can grade, grade what you measured.
    if (hasAssignee) r.attrN++;
    TYPE_HYG_FIELDS_.forEach(function (f) {
      if (f === "time" && !wantTime) return;
      if (f === "attr" && !hasAssignee) return;
      if (got[f]) { r[f]++; return; }
      // MISSING records are what we collect — the queue, not the healthy ones.
      if (!r.keys[f]) r.keys[f] = [];
      if (r.keys[f].length < TYPE_HYG_MAX_KEYS_) r.keys[f].push(it.key);
      else r.keysCapped[f] = true;
    });
  }

  (jira.issues || []).forEach(function (it) {
    var type = it.typeLabel || "(blank)";
    var inScope = onTimeInScope_(it, sc);
    if (it.resolved && !isNaN(it.resolved.getTime())) {
      // Resolved work is bucketed by WEEK as well as type, so the matrix follows
      // the period picker. Key on both or two weeks of one type collapse.
      var iso = weekKeyFromDate_(it.resolved);
      var r = row(res, iso + "" + type, type, it.isEpic, inScope);
      r.iso = iso;
      tally(r, it, false);
    } else if (typeHygOpen_(it)) {
      tally(row(open, type, type, it.isEpic, inScope), it, true);
    }
    // Everything else — closed without a resolution date — is deliberately in
    // NEITHER population. It is not open work anyone can fix, and it is not
    // resolved work any metric measures.
  });

  function out(map) {
    return Object.keys(map).sort().map(function (k) { return map[k]; });
  }
  return { resolved: out(res), open: out(open), keyCap: TYPE_HYG_MAX_KEYS_ };
}

/**
 * Per-PERSON field fill over the same populations as the by-type matrix —
 * the data behind the Actions roster (spec 2026-08-05 §6). Predicates are
 * IDENTICAL to typeHygieneBuckets_ (due present · estSec>0 · spentSec>0) so
 * the roster and the matrix can never disagree about the same record.
 * Epics are counted (open epics missing estimates are the matrix's biggest
 * lever, and the person who owns the epic owns the gap).
 * Unattributed issues carry no person and are deliberately absent — they are
 * the matrix's problem to expose, not a roster row.
 *
 * @param {Object} jira            readJiraRaw_ output (leaver-scoped)
 * @param {Function} resolvePerson raw assignee → roster display name, or null
 * Carries three COMMERCIAL-READINESS signals beyond the original three
 * (2026-08-06): `link` (rollup-ability — hours that cannot reach an engagement
 * cannot price the next one), `bill` over its own `billN` denominator (the
 * revenue join) and `start` (started-late vs ran-long). Plus `estSec`/`spentSec`
 * /`wip` so the open half reports how far along the load actually is, not only
 * whether its fields are filled.
 *
 * @returns {{resolved:Array<{iso,person,n,due,est,logged,loggedN,link,start,bill,billN,estSec,spentSec,wip}>,
 *            open:Array<{person,n,due,est,logged,loggedN,link,start,bill,billN,estSec,spentSec,wip}>}}
 *          resolved is bucketed person × ISO week so the client can scope it
 *          to the analysis period; open is a snapshot (no iso), mirroring
 *          flowOpenBuckets.
 */
function personHygieneBuckets_(jira, resolvePerson) {
  var res = {}, open = {};
  function row(map, k, person) {
    if (!map[k]) map[k] = { iso: "", person: person, n: 0, due: 0, est: 0, logged: 0,
                            // Denominator for `logged` only — the started
                            // population. See timeExpected_: an unstarted ticket is
                            // not a logging gap, and on the open half n counts the
                            // whole backlog. On the resolved half loggedN === n.
                            loggedN: 0,
                            // Commercial-readiness counts (2026-08-06).
                            link: 0, start: 0, bill: 0,
                            // `billN` is a SEPARATE denominator, not a typo for n.
                            // Billing Type is tristate: an absent column means
                            // nobody looked, and dividing by n would report a
                            // 0%-tagged red for every person on an export that
                            // never carried the column. Measured rows only.
                            billN: 0,
                            // Progress on the load being carried (open population).
                            // Hours, not counts: "12 of 18 tickets logged
                            // something" says nothing about how far along the work
                            // is. Summed as seconds and converted once, at render.
                            estSec: 0, spentSec: 0, wip: 0 };
    return map[k];
  }
  function tally(r, it, isOpen) {
    r.n++;
    if (it.due && !isNaN(it.due.getTime())) r.due++;
    var est = Number(it.estSec) || 0, spent = Number(it.spentSec) || 0;
    if (est > 0) r.est++;
    // Gated on BOTH sides (timeExpected_): a To Do ticket that happens to carry a
    // worklog is a status-hygiene gap, not logging credit, so it scores in
    // neither half. Leaving it in the numerator alone would push the ratio past
    // 100% on anyone whose board has drifted.
    if (timeExpected_(it, isOpen)) { r.loggedN++; if (spent > 0) r.logged++; }
    // Rollup-ability: can this record's hours reach an engagement? Epics count as
    // linked by construction (they ARE the container) — see readJiraRaw_.
    if (it.linked) r.link++;
    if (it.start && !isNaN(it.start.getTime())) r.start++;
    var bill = String(it.billing || "").trim();
    if (bill) { r.billN++; if (!/untagged/i.test(bill)) r.bill++; }
    r.estSec += est;
    r.spentSec += spent;
    // WIP = actively being worked, per the dictionary's wip metric (status
    // CATEGORY "In Progress"). Same predicate as the logged-time expectation —
    // one function, so "started" can never mean two things on one row.
    if (dhStarted_(it)) r.wip++;
  }
  (jira.issues || []).forEach(function (it) {
    var dn = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!dn) return;
    if (it.resolved && !isNaN(it.resolved.getTime())) {
      var r = row(res, weekKeyFromDate_(it.resolved) + "|" + dn, dn);
      r.iso = weekKeyFromDate_(it.resolved);
      tally(r, it, false);
    } else if (typeHygOpen_(it)) {
      tally(row(open, dn, dn), it, true);
    }
    // Closed without a resolution date: in NEITHER population — same rule and
    // same reason as typeHygieneBuckets_.
  });
  function out(map) { return Object.keys(map).sort().map(function (k) { return map[k]; }); }
  return { resolved: out(res), open: out(open) };
}

// ══════════════════════════════════════════════════════════════════════════
// BACKLOG HEALTH (2026-08-06)
//
// Every other Jira surface here answers "what did we deliver, and was the record
// clean". This one answers the question a delivery manager actually opens the
// dashboard with: **is the work we are carrying ready to be worked?**
//
// WHY IT IS A SEPARATE SURFACE and not more columns on the hygiene matrix:
// hygiene grades FIELD FILL on a population. Backlog health is about STATES that
// only exist on open work — overdue, stale, in-progress-but-never-logged, past
// its own start date. None of those are a missing field; three of them are
// combinations, and the most useful one (`ready`) is an intersection of four.
//
// WHY GOOD SIGNALS AT ALL, when a work queue only needs the bad ones: a list of
// only failures gives no denominator and no sense of movement, so it reads as an
// indictment rather than a state. "645 fresh / 492 stale" is a manageable
// backlog; "492 stale" alone is just an accusation. The panel shows both sides.
//
// SNAPSHOT, never a time series. Same rule as flowOpenBuckets and the open half
// of typeHygieneBuckets_: a backlog is a state of today, and bucketing it by
// created/updated/due would invent a history it does not have. The Flow
// Snapshots tab is where backlog history actually lives.
//
// ⚠️ `now` is MODEL BUILD TIME, not render time. Overdue and staleness are
// computed server-side and then cached (CACHE_TTL, warmed every 30 min), so a
// tab left open overnight shows yesterday's ageing. That is the same contract as
// every other cached number here, and the header's freshness line is what tells
// the reader how old the model is.
// ══════════════════════════════════════════════════════════════════════════

/** Failing keys carried per signal — enough to BE the work queue. Capped and the
    cap REPORTED, same contract as TYPE_HYG_MAX_KEYS_: a clipped list read as
    complete is how "we fixed them all" becomes wrong. */
var BACKLOG_MAX_KEYS_ = 300;

/** Days without an update before open work stops counting as live load. */
var BACKLOG_STALE_DAYS_ = 30;
var BACKLOG_STALE_HARD_DAYS_ = 90;
/** Days within which an update makes a ticket "fresh" — one working fortnight. */
var BACKLOG_FRESH_DAYS_ = 14;

function bhDays_(from, to) { return (to - from) / 86400000; }

/**
 * The signal roster. ONE table, so a predicate can never drift between the count
 * and the queue behind it, and adding a signal is one entry rather than edits in
 * four places.
 *
 * `kind` splits the panel: "good" = ready to be worked, "bad" = needs an action.
 * `queue: false` marks a signal whose key list is not worth carrying (the healthy
 * ones — nobody drills into "these are fine").
 */
var BACKLOG_SIGNALS_ = [
  // ── healthy ────────────────────────────────────────────────────────────────
  { k: "fresh", kind: "good", queue: false,
    test: function (it, now) { return !!it.updated && bhDays_(it.updated, now) <= BACKLOG_FRESH_DAYS_; } },
  { k: "dated", kind: "good", queue: false,
    test: function (it) { return !!it.due; } },
  { k: "futureDated", kind: "good", queue: false,
    test: function (it, now) { return !!it.due && it.due >= now; } },
  { k: "estimated", kind: "good", queue: false,
    test: function (it) { return (Number(it.estSec) || 0) > 0; } },
  { k: "linked", kind: "good", queue: false,
    test: function (it) { return !!it.linked; } },
  { k: "started", kind: "good", queue: false,
    test: function (it) { return !!it.start; } },
  // READY = the intersection that matters. Dated so it can be committed to,
  // estimated so it can be planned and priced, linked so its hours reach an
  // engagement, fresh so the other three are not stale claims. This is the
  // headline: the share of the backlog that is actually plannable.
  { k: "ready", kind: "good", queue: false,
    test: function (it, now) {
      return !!it.due && (Number(it.estSec) || 0) > 0 && !!it.linked &&
             !!it.updated && bhDays_(it.updated, now) <= BACKLOG_STALE_DAYS_;
    } },

  // ── needs action, each one a queue ─────────────────────────────────────────
  { k: "unestimated", kind: "bad",
    test: function (it) { return !(Number(it.estSec) > 0); } },
  { k: "undated", kind: "bad",
    test: function (it) { return !it.due; } },
  { k: "unlinked", kind: "bad",
    test: function (it) { return !it.linked; } },
  { k: "noStart", kind: "bad",
    test: function (it) { return !it.start; } },
  { k: "stale", kind: "bad",
    test: function (it, now) { return !!it.updated && bhDays_(it.updated, now) > BACKLOG_STALE_DAYS_; } },
  { k: "staleHard", kind: "bad",
    test: function (it, now) { return !!it.updated && bhDays_(it.updated, now) > BACKLOG_STALE_HARD_DAYS_; } },
  { k: "overdue", kind: "bad",
    test: function (it, now) { return !!it.due && it.due < now; } },
  // Ageing bands, because one "overdue" count hides the difference between a
  // ticket that slipped a day and a commitment abandoned two months ago. Live
  // measurement 2026-08-06: 62% of overdue open work was >30 days past due.
  { k: "overdue7", kind: "bad",
    test: function (it, now) { var d = it.due ? bhDays_(it.due, now) : -1; return d > 0 && d <= 7; } },
  { k: "overdue30", kind: "bad",
    test: function (it, now) { var d = it.due ? bhDays_(it.due, now) : -1; return d > 7 && d <= 30; } },
  { k: "overdueOver30", kind: "bad",
    test: function (it, now) { return !!it.due && bhDays_(it.due, now) > 30; } },
  // Status says started, the clock says nothing happened. Either it is not really
  // in progress or the time is not being tracked — and both are a conversation.
  { k: "wipNoLog", kind: "bad",
    test: function (it) {
      return /in\s*progress/i.test(String(it.statusCategory || it.status || "")) &&
             !((Number(it.spentSec) || 0) > 0);
    } },
  // The only FORWARD-looking signal in the set: everything else reports a miss
  // that already happened, this one predicts the next.
  { k: "shouldHaveStarted", kind: "bad",
    test: function (it, now) {
      return !!it.start && it.start < now &&
             !/in\s*progress/i.test(String(it.statusCategory || it.status || ""));
    } },
];

/**
 * Per-person backlog-health counts over the OPEN population.
 *
 * Person-keyed for the same reason flowOpenBuckets_ is: every filter on this
 * dashboard selects PEOPLE, so a panel keyed any other way could not follow them
 * and would silently disagree with the Backlog and WIP tiles beside it.
 * Unattributed open work carries no person and is counted separately rather than
 * dropped — a backlog total that quietly omits it understates the load.
 *
 * @param {Object} jira readJiraRaw_ output (leaver-scoped)
 * @param {Function} resolvePerson raw assignee → roster display name, or null
 * @param {Date=} now injection point for tests; defaults to real now
 * @returns {{buckets:Array, unattributed:number, keyCap:number, asOf:string}}
 */
function backlogHealthBuckets_(jira, resolvePerson, now) {
  now = now || new Date();
  var map = {}, unattributed = 0;

  function row(person) {
    if (!map[person]) {
      var r = { person: person, n: 0, keys: {}, keysCapped: {} };
      BACKLOG_SIGNALS_.forEach(function (s) { r[s.k] = 0; });
      map[person] = r;
    }
    return map[person];
  }

  (jira.issues || []).forEach(function (it) {
    // Resolved work is not backlog. typeHygOpen_ is reused rather than re-derived
    // so "open" means the same thing on every surface — including its second
    // half, which catches closed workflows that leave Resolution Date empty.
    if (!typeHygOpen_(it)) return;
    var dn = resolvePerson ? resolvePerson(it.assignee || "") : null;
    if (!dn) { unattributed++; return; }
    var r = row(dn);
    r.n++;
    BACKLOG_SIGNALS_.forEach(function (s) {
      if (!s.test(it, now)) return;
      r[s.k]++;
      if (s.queue === false) return;
      if (!r.keys[s.k]) r.keys[s.k] = [];
      if (r.keys[s.k].length < BACKLOG_MAX_KEYS_) r.keys[s.k].push(it.key);
      else r.keysCapped[s.k] = true;
    });
  });

  return {
    buckets: Object.keys(map).sort().map(function (k) { return map[k]; }),
    unattributed: unattributed,
    keyCap: BACKLOG_MAX_KEYS_,
    // Stamped because overdue/staleness are relative to BUILD time, not render
    // time — a reader looking at an hour-old cached model deserves to know which
    // "today" the ageing was measured against.
    asOf: now.toISOString(),
    thresholds: { fresh: BACKLOG_FRESH_DAYS_, stale: BACKLOG_STALE_DAYS_,
                  staleHard: BACKLOG_STALE_HARD_DAYS_ },
  };
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
// Anything unrecognised lands in "Other", anything BLANK lands in "Unassigned" —
// and the two are deliberately different: "Other" is a region we haven't mapped,
// "Unassigned" is a tagging gap somebody owns. §4.2 requires the gap be
// displayed, counted and trended, never quietly folded into a real region's
// total, because visible discomfort is the only mechanism that gets Jira tagging
// fixed.
//
// ✅ OPEN DECISION #1 CLOSED 2026-08-04 — the option list was read straight off
// live Jira (all 11,658 tagged issues) instead of waiting on PR-01. The guessed
// RRnn labels were wrong on three counts: RR02 is Latin America (not EMEA), RR03
// is Europe (not APAC), RR04 is Australia. Anything mapped to the wrong
// continent here is invisible — it just shows up in a plausible-looking chip.
// ⚠️ APAC RETIRED 2026-08-05 (reviewer feedback): APAC is a superset of ANZ and
// SEA (and more), so an APAC chip sitting NEXT TO an ANZ chip made the taxonomy
// self-contradictory. South East Asia is SEA; "RR08 Asia" (4 issues site-wide)
// folds into SEA because this org's Asia delivery hub IS the SEA hub. Legacy
// "APAC" tokens in a pre-v3.8.0 Jira Raw sheet map to SEA in mapRegionToDh_.
var JIRA_REGION_TO_DH_ = {
  // ── VERIFIED live 2026-08-04: the complete option list in use ──
  "rr01 north america":   "AMER",
  "rr02 latin america":   "AMER",
  "rr03 europe":          "EMEA",
  "rr09 africa":          "EMEA",
  "rr04 australia":       "ANZ",
  "rr05 south east asia": "SEA",
  "rr08 asia":            "SEA",   // 4 issues site-wide; Asia hub = SEA here
  // RR07 is not a geography. It is the MOST COMMON tag, so folding it into a
  // real region would invent delivery presence and blanking it would file a
  // deliberate choice under "nobody tagged this" (decision 2026-08-04).
  "rr07 global":          "Global",
  // ── UNVERIFIED aliases kept for tolerance, NOT observed on this site ──
  // Harmless (exact match wins, and no issue carries these) but do not read them
  // as evidence of what the picker contains — the verified block above is.
  "rr01 americas":        "AMER",
  "rr02 emea":            "EMEA",
  // Load-bearing for the containment matcher: "RR02 Europe/Middle East/Africa"
  // resolves through this prefix, not through the verified "rr03 europe".
  "rr02 europe":          "EMEA",
  "rr03 apac":            "SEA",
  "rr03 asia pacific":    "SEA",
  "rr04 anz":             "ANZ",
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
  // A bare token already in the vocabulary ("SEA", "amer") passes through.
  // This is the path that carries production traffic: the Jira Raw exporter maps
  // RRnn → token itself (REGION_VOCAB_ in "Jira Backlog.js"), so the sheet holds
  // short forms and the raw-label table above only fires if someone points this
  // reader at unmapped Jira output. "Global" must be listed or the single most
  // common tag on the site silently reports as "Other".
  var bare = key.toUpperCase();
  if (["AMER", "EMEA", "SEA", "ANZ"].indexOf(bare) !== -1) return bare;
  // Legacy token: exporter versions ≤ v3.7.0 wrote "APAC" for RR05/RR08 rows.
  // Both now map to SEA, so a stale Jira Raw sheet stays readable until the
  // first post-v3.8.0 export run replaces it.
  if (bare === "APAC") return "SEA";
  if (bare === "GLOBAL") return "Global";
  // Cross-region work exports as a compound token ("AMER | SEA" — about 3% of
  // tagged issues). It is deliberately NOT resolved to its first half: charging
  // shared work to one region would misstate both. It lands in "Other", which is
  // the bucket for "a real value this dashboard cannot attribute".
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
 * Builds the "is this name a former employee?" test used to drop attrition from
 * every delivery rate (user decision 2026-08-04).
 *
 * Same one-sided rule as filterActiveNames_, and for the same reason: a name
 * counts as gone only when the roster PROVES it — an inactive row AND no active
 * row anywhere. Boomerang rehires therefore stay in (their active row wins), and
 * a name the roster has never heard of is NOT a leaver. It is an unattributed
 * issue, which is a real hygiene gap somebody owns. Confusing the two would let
 * this policy quietly swallow genuine data problems.
 *
 * Matching goes through the SAME alias machinery as attribution, so "Alvarez,
 * Maria" on a Jira issue tests against a roster "Maria Alvarez" — a leaver whose
 * name is spelled the other way round must not slip back into the rates.
 *
 * @param {Object} roster readRosterPeople_ output
 * @returns {function(string):boolean} raw assignee name → is a known leaver
 */
function leaverTest_(roster) {
  var act = (roster && roster.activeAll) || {};
  var inact = (roster && roster.inactiveAll) || {};
  // Display names of the proven-gone, so the alias index can be built over them.
  var gone = ((roster && roster.attrib) || []).filter(function (p) {
    var k = normDH_(p.name);
    return inact[k] && !act[k];
  }).map(function (p) { return p.name; });
  if (!gone.length) return function () { return false; };
  var idx = buildNameIndex_(gone);
  return function (raw) {
    if (!raw) return false;            // unassigned is a gap, never "a leaver"
    return !!resolveName_(idx, raw);
  };
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

/** Intern = level token I1 (user decision 2026-08-04). I10+ never matches —
    dhLevelTrack_ parses the full number, so "I10" reads as level I10, not I1. */
function dhIsIntern_(jobTitle) {
  return dhLevelTrack_(jobTitle).level === "I1";
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
/**
 * Parses the Jira Raw footer stamp into an ISO string, or null.
 *
 * Jira Backlog.js fmtDateTime_ writes `M/D/YYYY HH:MM` in 24-hour time with
 * zero-padded H/M and NO padding on month/day — e.g. "8/4/2026 03:00". It is
 * written as a STRING (setValue on a concatenated label), so Sheets does not
 * coerce it; but a hand-edit or a locale-driven re-parse could turn it into a
 * Date, so both shapes are accepted.
 *
 * Parsed EXPLICITLY rather than via `new Date(str)`: this script's timezone and
 * the exporter's are the same project timezone, but `new Date("8/4/2026 03:00")`
 * is implementation-defined for non-ISO input, and a US-format string parsed as
 * D/M would silently report April 8th — a four-month-old export reading as
 * fresh. Ambiguity here defeats the whole point of the stamp.
 *
 * Returns an ISO string (UTC) so the payload stays JSON-safe through the cache.
 *
 * @param {string|Date} val the text after "Generated:"
 * @returns {?string} ISO timestamp, or null when unparseable
 */
function parseExportStamp_(val) {
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString();
  var s = String(val == null ? "" : val).trim();
  if (!s) return null;
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(s);
  if (!m) return null;
  var mo = Number(m[1]), d = Number(m[2]), y = Number(m[3]);
  var hh = m[4] === undefined ? 0 : Number(m[4]);
  var mi = m[5] === undefined ? 0 : Number(m[5]);
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  if (!(hh >= 0 && hh <= 23) || !(mi >= 0 && mi <= 59)) return null;
  var dt = new Date(y, mo - 1, d, hh, mi);
  if (isNaN(dt.getTime())) return null;
  // Reject a rolled-over date (2/30 → Mar 2): a stamp that had to be corrected
  // to exist is a stamp we cannot trust to report age.
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt.toISOString();
}

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
    var iCreated = colIdx_(h, ["Created"]);
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
    // ── COMMERCIAL-READINESS columns (read from 2026-08-06) ──────────────────
    // These four have been written by Jira Backlog.js for releases (RAW_HEADERS
    // 13/14/17/18/30) and were never read here. They are what turns hygiene from
    // "is the ticket tidy" into "can we price the next engagement":
    //   Epic Key / Parent Key — without a parent, delivered hours cannot be
    //     rolled to an engagement, so they cannot inform a quote. The live audit
    //     (2026-08-05) put Story/Task linkage at 91% but found ~1,023 delivered
    //     sub-tasks whose parent is a Story, not an epic — hence BOTH columns:
    //     Epic Key is the direct link, Parent Key catches the sub-task chain.
    //   Billing Type — "Billable (SRSO)" | "Internal" | "Untagged". The revenue
    //     join. Untagged delivered work cannot be recognised against a milestone.
    //   Start Date — separates "started late" from "ran long". A due date alone
    //     tells you a commitment was missed but not which lever to pull.
    // Same contract as every other column: colIdx_ → -1 on an older export, and
    // the consumers below degrade to "not measured" rather than a false zero.
    // `Updated` has been in Jira Raw since the beginning (column 10) and was
    // never read. It is the ONLY input the backlog-health staleness signals need:
    // an open assigned ticket nobody has touched in 90 days is not load, it is
    // abandoned work inflating every capacity figure that counts it.
    var iUpdated = colIdx_(h, ["Updated"]);
    var iEpicKey = colIdx_(h, ["Epic Key"]);
    var iParentKey = colIdx_(h, ["Parent Key"]);
    var iBilling = colIdx_(h, ["Billing Type"]);
    var iStart = colIdx_(h, ["Start Date"]);
    if (iKey === -1) return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false };
    // ── EXPORT FRESHNESS STAMP ────────────────────────────────────────────────
    // Jira Backlog.js writes two italic footer rows in column A, two rows below
    // the last data row (writeRawSheet_): "Generated: M/D/YYYY HH:MM" and
    // "Total rows: N". That first line is the ONLY record of when the DATA was
    // refreshed, and it is the number a reader actually needs: meta.generatedAt
    // is when this dashboard last rebuilt its model, which the cache warmer
    // resets every 30 minutes whether or not the export ever ran again. A
    // dashboard rebuilt 5 minutes ago on a three-day-old export looks perfectly
    // fresh by generatedAt alone — that is the failure this parse closes.
    //
    // Read from column A regardless of where the Key column sits, because the
    // exporter writes the footer to A1-relative position, not to the Key column.
    var exportedAt = null;
    for (var fr = raw.length - 1; fr >= 1 && fr > raw.length - 12; fr--) {
      var m = /^\s*Generated:\s*(.+?)\s*$/i.exec(String(raw[fr][0] || ""));
      if (!m) continue;
      exportedAt = parseExportStamp_(m[1]);
      break;
    }
    var byKey = {};
    for (var r = 1; r < raw.length; r++) {
      var key = String(raw[r][iKey] || "").trim().toUpperCase();
      if (!key) continue;
      // The footer rows live in column A, which IS the Key column — so without
      // this they were being ingested as two pseudo-issues keyed
      // "GENERATED: …" / "TOTAL ROWS: …". They carried no resolution date and no
      // assignee, so they never reached a metric bucket, but they did inflate
      // j.issues.length and would land in any by-type tally as a blank type.
      if (/^(GENERATED|TOTAL ROWS):/.test(key)) continue;
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
    var issues = [], epics = [], openIssues = [], keyRegion = {}, regionRaw = {}, typeRaw = {};
    Object.keys(byKey).forEach(function (key) {
      var r = byKey[key];
      // Region vocabulary is normalised HERE, at ingestion (§4.3) — the rest of
      // the codebase only ever sees AMER/EMEA/SEA/ANZ/Global/Other/Unassigned.
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
      // DISPLAY string, kept alongside the normalised one. `type` is lowercased
      // for matching; the by-type hygiene matrix has to show the vocabulary as
      // Jira actually spells it ("Go-live epic", not "go-live epic"), because
      // the whole point of that view is to be actionable in Jira's own words.
      var typeLabel = (iType === -1 ? "" : String(raw[r][iType] || "").trim()) || "(blank)";
      // Raw tally for probeDeliverySources — same reason as regionRaw: the type
      // vocabulary must be MEASURED before anything is designed against it.
      // Nobody should hardcode "Kick-off epic" on the strength of remembering it.
      typeRaw[typeLabel] = (typeRaw[typeLabel] || 0) + 1;
      var labels = iLabels === -1 ? "" : String(raw[r][iLabels] || "");
      var statCat = iStatCat === -1 ? "" : String(raw[r][iStatCat] || "").trim();
      var reopenCell = iReopen === -1 ? "" : String(raw[r][iReopen] || "").trim();
      var status = iStatus === -1 ? "" : String(raw[r][iStatus] || "").trim();
      var rec = {
        // key/type/status reach the record for the by-type hygiene matrix: key so
        // a gap cell can hand over the actual work queue, type so it can group,
        // status so it can tell genuinely-open work from closed-but-unresolved.
        // Server-side only — jira.issues is never shipped to the client.
        key: key,
        type: type, typeLabel: typeLabel, status: status,
        isEpic: isEpic,
        // The Metrics Dictionary scopes On-Time to "issue type Epic/Milestone OR
        // Client Commitment label", so both signals have to survive ingestion.
        isMilestone: /milestone/.test(type),
        isClientCommitment: DH_CLIENT_COMMITMENT_.test(labels),
        due: iDue === -1 ? null : parseDhDate_(raw[r][iDue]),
        resolved: iRes === -1 ? null : parseDhDate_(raw[r][iRes]),
        // Lead Time input (flow metrics, spec 2026-08-05). Optional like every
        // header here: -1 on an exotic export → null → coverage gap, not zero.
        created: iCreated === -1 ? null : parseDhDate_(raw[r][iCreated]),
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
        // ── Commercial-readiness inputs ──
        // linked = this record can be rolled up to a programme. An epic IS the
        // container, so it is linked by definition — grading an epic for having
        // no parent would put a permanent red on the one row that cannot have
        // one. For everything else, either link counts: Epic Key is the direct
        // one, Parent Key catches sub-task → story → epic.
        linked: isEpic || !!(
          (iEpicKey !== -1 && String(raw[r][iEpicKey] || "").trim()) ||
          (iParentKey !== -1 && String(raw[r][iParentKey] || "").trim())),
        // TRISTATE like `reopened`: "" = the column is absent, so nobody looked.
        // Never collapse an absent column into "Untagged" — that would invent a
        // commercial gap on every row of an older export.
        billing: iBilling === -1 ? "" : String(raw[r][iBilling] || "").trim(),
        start: iStart === -1 ? null : parseDhDate_(raw[r][iStart]),
        updated: iUpdated === -1 ? null : parseDhDate_(raw[r][iUpdated]),
      };
      issues.push(rec);
      if (isEpic) epics.push(rec);
      // Open backlog: assigned, unresolved, status not closed-ish, not an epic
      // (epics roll up their children — listing both would double the load).
      // ⚠ This array is the PER-PERSON DRILL-DOWN's population and excludes
      // epics by design. The by-type hygiene matrix must NOT reuse it — open
      // epics missing estimates are the biggest lever it exists to expose — so
      // typeHygieneBuckets_ works over `issues` (every row) instead.
      var assignee = rec.assignee;
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
             regionRaw: regionRaw, typeRaw: typeRaw, exportedAt: exportedAt, available: true };
  } catch (e) {
    return { issues: [], epics: [], openIssues: [], keyRegion: {}, available: false, error: e.message };
  }
}

/**
 * Pure parse of the Jira Bugs tab (Jira Backlog.js v3.9.0). Columns BY NAME.
 * Bug Count needs only created/resolved; assignee is deliberately unused —
 * the tile is population-wide (bugs are routinely unassigned at creation, so
 * a person join would silently drop most of the population).
 */
function parseBugRows_(values) {
  if (!values || values.length < 2) return { bugs: [], available: false };
  var h = values[0].map(String);
  var iKey = colIdx_(h, ["Key"]);
  var iCreated = colIdx_(h, ["Created"]);
  var iRes = colIdx_(h, ["Resolution Date"]);
  if (iKey === -1 || iCreated === -1) return { bugs: [], available: false };
  var bugs = [];
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][iKey] || "").trim();
    if (!key || /^(GENERATED|TOTAL ROWS):/i.test(key)) continue;
    var created = parseDhDate_(values[r][iCreated]);
    if (!created || isNaN(created.getTime())) continue;
    bugs.push({ key: key.toUpperCase(), created: created,
                resolved: iRes === -1 ? null : parseDhDate_(values[r][iRes]) });
  }
  return { bugs: bugs, available: true };
}

/** Bugs → per-ISO-week tallies. One bug can hit TWO weeks: nCreated at its
    creation week, nResolved at its resolution week. Population-wide (no person
    key) — see parseBugRows_. */
function bugWeekly_(bugs) {
  var map = {};
  function row(iso) {
    if (!map[iso]) map[iso] = { iso: iso, nCreated: 0, nResolved: 0 };
    return map[iso];
  }
  (bugs || []).forEach(function (b) {
    if (b.created && !isNaN(b.created.getTime())) row(weekKeyFromDate_(b.created)).nCreated++;
    if (b.resolved && !isNaN(b.resolved.getTime())) row(weekKeyFromDate_(b.resolved)).nResolved++;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

/** Thin sheet wrapper — a missing tab is ABSENT (export predates v3.9.0),
    never an error. Same contract as readJiraRaw_. */
function readJiraBugs_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
               .getSheetByName(CONFIG_DH.JIRA_BUGS_SHEET);
    if (!sh) return { bugs: [], available: false };
    return parseBugRows_(sh.getDataRange().getValues());
  } catch (e) { return { bugs: [], available: false, error: e.message }; }
}

/**
 * Pure parse of the Jira Arrivals tab (Jira Backlog.js v3.11.0). Columns BY NAME.
 *
 * One row per ISO week, org-wide: no assignee join anywhere in this feed. That is
 * the point of it — person-keyed arrivals under-report the newest weeks, because
 * an issue filed unassigned on Monday only counts once somebody picks it up, so a
 * growing queue can read as flat exactly when it matters most. Same reasoning as
 * parseBugRows_'s deliberate refusal to join bugs to a person.
 *
 * The ISO key is derived from Week Start HERE. The exporter's jb_isoWeekLabel_
 * zero-pads ("2026.W07") and weekKeyFromDate_ does not ("2026.W7"); shipping a
 * date keeps ONE week-label authority and makes the divergence unreachable.
 *
 * @param {Array<Array>} values raw getValues() including the header row
 * @returns {{weeks:Array<{iso,created,resolved,createdUnassigned}>, available:boolean}}
 */
function parseArrivalRows_(values) {
  if (!values || values.length < 2) return { weeks: [], available: false };
  var h = values[0];
  var iWeek = colIdx_(h, ["Week Start"]);
  var iCreated = colIdx_(h, ["Created"]);
  var iResolved = colIdx_(h, ["Resolved"]);
  var iUnassigned = colIdx_(h, ["Created Unassigned"]);
  if (iWeek === -1 || iCreated === -1 || iResolved === -1) {
    return { weeks: [], available: false };
  }
  var weeks = [];
  for (var r = 1; r < values.length; r++) {
    var d = parseDhDate_(values[r][iWeek]);
    if (!d || isNaN(d.getTime())) continue;   // blank or unparseable row: skip, never bucket to epoch
    weeks.push({
      iso: weekKeyFromDate_(d),
      created: Number(values[r][iCreated]) || 0,
      resolved: Number(values[r][iResolved]) || 0,
      // TRISTATE: an ABSENT column means nobody measured it. Collapsing that to 0
      // would report "no unowned intake" on an older export, which is good news
      // the data does not support.
      createdUnassigned: iUnassigned === -1
        ? null
        : (Number(values[r][iUnassigned]) || 0),
    });
  }
  // `available` reports that the tab is READABLE (has the required columns),
  // not that it currently holds data. A tab whose rows all fail to parse is then
  // distinguishable from one that was never exported — the former signals a
  // data-quality issue, the latter an expected pre-launch state.
  return { weeks: weeks, available: true };
}

/** Reads the Jira Arrivals tab. Absent tab is a clean unavailable, not an error:
    Code.js may legitimately be deployed before the export has run (spec §5). */
function readArrivals_() {
  try {
    var ss = SpreadsheetApp.openById(dhSourceIds_().source);
    var sh = ss.getSheetByName(CONFIG_DH.ARRIVALS_SHEET);
    if (!sh) return { weeks: [], available: false };
    return parseArrivalRows_(sh.getDataRange().getValues());
  } catch (e) {
    Logger.log("⚠️ readArrivals_ failed: " + e.message);
    return { weeks: [], available: false };
  }
}

/**
 * Pure parse of the Flow Snapshots tab. The exporter appends one row per RUN
 * and can run several times a week — the LAST row per ISO week wins (freshest
 * state of that week). Rows whose ISO Week cell isn't YYYY.WN are skipped.
 */
function parseFlowSnapshotRows_(values) {
  if (!values || values.length < 2) return { snaps: [], available: false };
  var h = values[0].map(String);
  var iGen = colIdx_(h, ["Generated"]);
  var iIso = colIdx_(h, ["ISO Week"]);
  var iWip = colIdx_(h, ["WIP Count"]);
  var iHrs = colIdx_(h, ["Backlog Hrs"]);
  var iN = colIdx_(h, ["Backlog Items"]);
  if (iGen === -1 || iIso === -1) return { snaps: [], available: false };
  var byIso = {}, order = [];
  for (var r = 1; r < values.length; r++) {
    var iso = String(values[r][iIso] || "").trim();
    if (!/^\d{4}\.W\d{1,2}$/.test(iso)) continue;
    if (!byIso[iso]) order.push(iso);
    byIso[iso] = { iso: iso, at: String(values[r][iGen] || ""),
                   wip: Number(values[r][iWip]) || 0,
                   backlogHrs: Number(values[r][iHrs]) || 0,
                   backlogN: Number(values[r][iN]) || 0 };
  }
  return { snaps: order.map(function (k) { return byIso[k]; }), available: true };
}

/** Thin sheet wrapper for Flow Snapshots — same absent-≠-error contract. */
function readFlowSnapshots_() {
  try {
    var sh = SpreadsheetApp.openById(dhSourceIds_().source)
               .getSheetByName(CONFIG_DH.FLOW_SNAP_SHEET);
    if (!sh) return { snaps: [], available: false };
    return parseFlowSnapshotRows_(sh.getDataRange().getValues());
  } catch (e) { return { snaps: [], available: false, error: e.message }; }
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
  //
  // LEAVERS ARE NOT IN THIS INDEX (user decision 2026-08-04). Their issues are
  // already filtered out before any bucket is built, so this is belt-and-braces:
  // if one ever slipped past the filter it must land as "unattributed" — visible,
  // countable, obviously wrong — rather than quietly re-entering a rate that is
  // supposed to describe only people who can still be coached.
  var attribPeople = inputs.roster.attrib || [];
  var rosterActive = (inputs.roster.activeAll) || {};
  var rosterInactive = (inputs.roster.inactiveAll) || {};
  var attribIdx = buildNameIndex_(
    displayNames.concat(attribPeople.filter(function (p) {
      var k = normDH_(p.name);
      return !(rosterInactive[k] && !rosterActive[k]);   // boomerangs stay in
    }).map(function (p) { return p.name; })));
  var byPerson = {}; // display name → accumulator
  population.forEach(function (p) {
    byPerson[p.name] = { roster: p, teams: [], pms: [], weeks: {}, regionHours: {} };
  });

  // Tempo tracked/planned rows → per-person weekly sums, team collection,
  // region-tagged hours (tracked keys × Jira Region). NO absence signal is
  // read (user decision 2026-08-04): tracked NETSUITE/time-off hours are real
  // tracked time and classify as NON-BILLABLE by rule (no customer project to
  // charge); planned time-off rows plan no project work, so they are dropped.
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
      if (!acc.weeks[iso]) acc.weeks[iso] = { planned: 0, tracked: 0, trackedOff: 0 };
      var h = row.weekHours[iso];
      if (kind === "planned") {
        if (!timeOff) acc.weeks[iso].planned += h;
      } else {
        acc.weeks[iso].tracked += h;
        if (timeOff) acc.weeks[iso].trackedOff += h;
        else {
          var region = inputs.jira.keyRegion[row.key];
          if (region) acc.regionHours[region] = (acc.regionHours[region] || 0) + h;
        }
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
      var w = acc.weeks[iso] || { planned: 0, tracked: 0, trackedOff: 0 };
      var capCell = capMap[normDH_(dn)] ? capMap[normDH_(dn)][iso] : undefined;
      var capEst = capCell === undefined;
      var cap = capEst
        ? (normDH_(p.keyLocation) === normDH_(CONFIG_DH.ANZ_LOCATION)
            ? CONFIG_DH.ANZ_CAPACITY_HRS : CONFIG_DH.WEEKLY_CAPACITY_HRS)
        : capCell;
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
      // Tracked time classifies TWO ways only — billable and non-billable
      // (user decision 2026-08-04). Time off tracked in Tempo (NETSUITE rows,
      // w.trackedOff) is non-billable BY RULE — it cannot be charged to a
      // customer project — so it skips the NS ratio and lands directly in the
      // non-billable bucket. The ratio applies to the project-tracked portion.
      // NO absenteeism is modelled: capacity is gross scheduled hours, always
      // (avail === cap; the field survives for the client's shared accessors).
      var projTracked = Math.max(0, w.tracked - w.trackedOff);
      var nsTot = ns.billable + ns.nonBillable;
      // No NS signal for this person-week = UNCLASSIFIABLE, not 0% billable. The
      // week keeps its tracked hours but leaves the billable numerator AND its
      // matching denominator (availCov) entirely — otherwise an export that lags
      // or covers fewer weeks than the trend window paints real zeros and the
      // sparkline shows a ramp that is pure coverage.
      var nsCov = nsAvailable && nsTot > 0;
      var share = nsCov ? ns.billable / nsTot : null;
      weeks[iso] = { cap: cap, capEst: capEst, avail: cap,
                     planned: w.planned, tracked: w.tracked,
                     // Time-off tracked hours (NETSUITE rows) — inside
                     // `tracked` and `nonBillable`, called out for drill-downs.
                     trackedOff: w.trackedOff,
                     nsCov: nsCov,
                     availCov: nsCov ? cap : 0,
                     // capCov = GROSS scheduled capacity of NS-classified weeks.
                     // The Metrics Dictionary's Utilization denominator is
                     // "headcount × standard hours". Summing per-person `cap`
                     // gives exactly that, and handles part-timers better than a
                     // flat headcount × 40 would. It has to be coverage-matched
                     // the same way availCov is, or an unclassified week would
                     // sit in the denominator with a forced-zero numerator.
                     capCov: nsCov ? cap : 0,
                     // trackedCov = classified tracked hours: the NS-ratio'd
                     // project hours plus time-off hours (classified by rule),
                     // so unclassified = tracked − trackedCov stays honest.
                     trackedCov: (nsCov ? projTracked : 0) + w.trackedOff,
                     billShare: share,
                     billable: nsCov ? projTracked * share : 0,
                     nonBillable: (nsCov ? projTracked * (1 - share) : 0) + w.trackedOff,
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
             // Intern = I1 in the same token (user decision 2026-08-04):
             // profile stays on the roster, but no published rate may move on
             // their account — they are in training, not delivery capacity.
             isIntern: dhIsIntern_(p.jobTitle),
             jobFamily: p.jobFamily || "", tracks: p.tracks !== false,
             newHire: isDhNewHire_(p.hireDate, win.today || new Date()),
             hired: dhDateStr_(p.hireDate),
             backlog: backlogMap[dn] || null, weeks: weeks };
  });

  // Jira buckets, person-attributed via Assignee → roster (user decision
  // 2026-07-31: every filter drives every KPI card). Bucket teams no longer
  // feed the Team dropdown — the vocabulary is Tempo teams only.
  var resolvePerson = function (raw) { return raw ? resolveName_(attribIdx, raw) : null; };

  // ── ATTRITION IS OUT OF SCOPE, NOT A DATA GAP (user decision 2026-08-04) ──
  //
  // "Attrition cannot be acted on, while active we can coach employees." So a
  // former employee's work leaves EVERY rate — numerator and denominator both —
  // rather than counting as delivered work or, worse, reading as a broken
  // roster join that someone is sent to fix.
  //
  // This SUPERSEDES the v13 decision taken earlier the same day, which widened
  // the attribution index to include terminated rows so their work would stop
  // showing as "unattributed". That fixed the symptom by counting the work; the
  // policy is to exclude it. Both agree it is not a hygiene gap.
  //
  // Filtered HERE, once, before any bucket is built — not threaded through five
  // bucket functions. One place decides who is in scope, so a metric added
  // later inherits the policy instead of having to remember it, and there is a
  // single line to read when someone asks why a number moved.
  var jiraScoped = inputs.jira, leaverExcluded = { issues: 0, epics: 0 };
  if (inputs.jira.available) {
    var isLeaver = leaverTest_(inputs.roster);
    var keptIssues = [], keptEpics = [];
    (inputs.jira.issues || []).forEach(function (it) {
      if (isLeaver(it.assignee)) { leaverExcluded.issues++; return; }
      keptIssues.push(it);
    });
    (inputs.jira.epics || []).forEach(function (ep) {
      if (isLeaver(ep.assignee)) { leaverExcluded.epics++; return; }
      keptEpics.push(ep);
    });
    // Shallow clone: keyRegion / typeRaw / exportedAt travel unchanged, and the
    // ORIGINAL inputs.jira is left intact for anything that legitimately wants
    // the whole feed.
    jiraScoped = Object.keys(inputs.jira).reduce(function (o, k) {
      o[k] = inputs.jira[k]; return o;
    }, {});
    jiraScoped.issues = keptIssues;
    jiraScoped.epics = keptEpics;
  }

  var onTime = inputs.jira.available
    ? onTimeBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  var forecast = inputs.jira.available
    ? forecastBuckets_(jiraScoped.epics, resolvePerson) : { buckets: [], unattributed: 0 };
  var hygiene = inputs.jira.available
    ? hygieneBuckets_(jiraScoped, resolvePerson) : [];
  var typeHyg = inputs.jira.available
    ? typeHygieneBuckets_(jiraScoped, resolvePerson)
    : { resolved: [], open: [], keyCap: TYPE_HYG_MAX_KEYS_ };
  var rework = inputs.jira.available
    ? reworkBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  // 🌊 Flow metrics (spec 2026-08-05) — same person-attribution join (and the
  // same leaver-scoped issue set) as the other issue metrics; Bug Count is
  // population-wide (see registry deviation) and reads inputs.bugs directly.
  var leadTime = inputs.jira.available
    ? leadTimeBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  var throughput = inputs.jira.available
    ? throughputBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0 };
  var flowOpen = inputs.jira.available
    ? flowOpenBuckets_(jiraScoped.issues, resolvePerson) : { buckets: [], unattributed: 0, uncategorized: 0 };
  var personHyg = inputs.jira.available
    ? personHygieneBuckets_(jiraScoped, resolvePerson)
    : { resolved: [], open: [] };
  var backlogHealth = inputs.jira.available
    ? backlogHealthBuckets_(jiraScoped, resolvePerson)
    : { buckets: [], unattributed: 0, keyCap: 0, asOf: null, thresholds: {} };
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
                  isIntern: dhIsIntern_(rec.jobTitle || ""),
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
      // ── TWO DIFFERENT CLOCKS, DELIBERATELY BOTH SHIPPED ──
      // generatedAt = when this model was assembled. The cache warmer resets it
      // every CACHE_WARM_EVERY_MIN, so it is ALWAYS fresh and therefore says
      // nothing about the data.
      // dataAsOf   = when the Jira export last wrote the Jira Raw tab, read from
      // the exporter's own "Generated:" footer. This is the number a reader means
      // by "how current is this?", and it is the one that can be days old while
      // the dashboard looks brand new.
      // Age is computed HERE, against the same clock that stamped generatedAt, so
      // the client never diffs a server timestamp against a browser clock — a
      // reader in another timezone with a skewed laptop would otherwise see a
      // different staleness verdict from the person beside them.
      dataAsOf: (function () {
        var iso = inputs.jira.exportedAt || null;
        if (!iso) {
          return { jira: null, jiraAgeH: null, jiraStale: false,
                   // Absent ≠ stale. An older Jira Backlog.js, or a Jira Raw tab
                   // whose footer was cropped by a hand-edit, means "unknown" —
                   // and a warning nobody can act on trains people to ignore the
                   // real one. The UI says "unknown", not "stale".
                   jiraUnknown: !!inputs.jira.available };
        }
        var ageH = (Date.now() - new Date(iso).getTime()) / 3600000;
        return { jira: iso, jiraAgeH: Math.round(ageH * 10) / 10,
                 jiraStale: ageH > CONFIG_DH.JIRA_EXPORT_STALE_H,
                 jiraUnknown: false };
      })(),
      jiraExportStaleH: CONFIG_DH.JIRA_EXPORT_STALE_H,
      thresholds: { green: CONFIG_DH.TINT_GREEN, amber: CONFIG_DH.TINT_AMBER },
      targets: CONFIG_DH.TARGETS,
      signalMinN: CONFIG_DH.SIGNAL_MIN_N,
      // No "Global" chip (removed 2026-08-05, user report "Global shows 0 for
      // the whole data"): region chips filter PEOPLE (every metric bucket is
      // keyed by person, and person region is geographic-only since the
      // Global-vote fix), so a Global chip can never match anyone — it sat at
      // 0 across the entire dataset. "Global" survives as a mapped ISSUE token
      // (JIRA_REGION_TO_DH_) so RR07 work counts as tagged in Data Hygiene and
      // rolls up under its assignee's geographic region everywhere else.
      regions: ["AMER", "EMEA", "SEA", "ANZ", "Other"],
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
                          rework: rework.unattributed,
                          leadTime: leadTime.unattributed, throughput: throughput.unattributed,
                          flowOpen: flowOpen.unattributed },
      // 🌊 Flow feeds. Absent tab = export predates Jira Backlog.js v3.9.0 —
      // the tiles say so instead of erroring (absent ≠ stale, same pattern as
      // dataAsOf.jiraUnknown).
      bugsAvailable: !!inputs.bugs.available,
      flowSnapshotsAvailable: !!inputs.flowSnaps.available,
      flowSnapshots: inputs.flowSnaps.snaps,
      flowUncategorized: flowOpen.uncategorized,
      // Work by former employees, removed from every rate before bucketing.
      // Reported as a COUNT so the exclusion is stated rather than inferred —
      // a number that quietly got smaller is indistinguishable from a broken
      // feed, and this one is a policy, not a gap. Never a hygiene row.
      leaverExcluded: leaverExcluded,
      // Which issue types the On-Time rate covers — the card names it so the
      // number is never read as "all delivery work" when it isn't.
      onTimeScope: CONFIG_DH.ONTIME_SCOPE || "delivery",
      forecastBand: CONFIG_DH.FORECAST_BAND || 0.10,
      // Only an explicit true suppresses. A cached model predating this field
      // therefore publishes rather than going dark for the rest of the TTL —
      // the safer failure direction for a flag whose shipped value is false.
      suppressBelowGate: CONFIG_DH.SUPPRESS_BELOW_GATE === true,
      capacityError: inputs.capacity.error || null,
      // Canonical metric definitions, targets, coverage gates, owners and known
      // deviations (FR-1.1). The client renders labels, tooltips, the RAG bands
      // and the suppressed state from this — never from its own constants.
      registry: registryWithOverrides_(readGateOverrides_()),
      // Source systems + refresh cadence (FR-2.5): every view has to be able to
      // say where its numbers came from and how fresh they are.
      sources: [
        { system: "Jira (via Exec Contribution Tracker export)", feeds: "On-Time, Forecast, backlog", tab: CONFIG_DH.JIRA_RAW_SHEET },
        { system: "Jira (via Exec Contribution Tracker export)", feeds: "Bug Count, WIP/Backlog trend",
          tab: CONFIG_DH.JIRA_BUGS_SHEET + " · " + CONFIG_DH.FLOW_SNAP_SHEET },
        { system: "Tempo", feeds: "tracked hours, planned hours, capacity",
          tab: [CONFIG_DH.TRACKED_SHEET, CONFIG_DH.PLANNED_SHEET, CONFIG_DH.CAPACITY_SHEET].join(" · ") },
        { system: "NetSuite", feeds: "billable / non-billable classification", tab: CONFIG_DH.NS_SHEET },
        { system: "Roster", feeds: "population, job family, region fallback, hire dates", tab: CONFIG_DH.ROSTER_SHEET },
      ],
      refreshEveryMin: CONFIG_DH.CACHE_WARM_EVERY_MIN,
    },
    people: people, onTimeBuckets: onTime.buckets, forecastBuckets: forecast.buckets,
    reworkBuckets: rework.buckets,
    leadTimeBuckets: leadTime.buckets,
    throughputBuckets: throughput.buckets,
    flowOpenBuckets: flowOpen.buckets,
    bugWeekly: bugWeekly_(inputs.bugs.bugs),
    hygieneBuckets: hygiene,
    // Field fill per issue type, resolved + open. The gaps table says how much
    // is missing; this says which type to go and fix.
    typeHygiene: typeHyg,
    // Per-person field fill — the Actions roster (spec 2026-08-05). Same
    // predicates as typeHygiene, person grain, unattributed absent by design.
    personHygiene: personHyg,
    // 🌊 Backlog health — snapshot, person-keyed, no iso (see the section header).
    backlogHealth: backlogHealth,
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
// v14: NO-ABSENTEEISM MODEL (user decision 2026-08-04). weeks[] lose pto/hol
//      (avail === cap, gross scheduled capacity — the Metrics Dictionary
//      denominator); tracked NETSUITE/time-off hours now count IN tracked and
//      classify directly as non-billable (PTO cannot be charged to a customer
//      project), planned time-off rows are dropped; meta.ptoSource is gone.
//      A cached v13 model still nets PTO/holidays out of the denominator and
//      drops time-off tracked hours, so it must miss cleanly.
// v15: people[] gain isIntern (level token I1, dhIsIntern_) — interns stay on
//      the roster with their hours visible but are EXCLUDED from every
//      published rate (user decision 2026-08-04: never punish an intern in a
//      metric). A cached v14 model has no flag, so interns would keep moving
//      the rates until the TTL; it must miss cleanly.
// v16: meta.dataAsOf — the Jira export's own "Generated:" footer stamp, its age
//      in hours and a stale verdict, so the header can state when the DATA was
//      refreshed rather than only when the model was rebuilt. Also stops the two
//      export footer rows being ingested as pseudo-issues. A cached v15 model has
//      no dataAsOf; the header would fall back to "unknown" and report a missing
//      stamp on an export that has one, which is exactly the wrong direction for
//      a freshness indicator.
// v17: meta-level `typeHygiene` — field fill per Workstream (Issue Type) over
//      the resolved AND open populations, with the failing issue keys per gap.
//      Needs `type`/`typeLabel`/`key`/`status` on the ingested record, which a
//      v16 model never carried, so the matrix would render empty — and an empty
//      matrix reads as "no gaps", the exact opposite of the truth.
// v18: ATTRITION EXCLUDED FROM EVERY RATE (user decision 2026-08-04) — a former
//      employee's issues are filtered out before any bucket is built, so
//      On-Time / Forecast / Quality and the whole hygiene surface describe only
//      people who can still be coached. Adds meta.leaverExcluded. SUPERSEDES v13,
//      which counted that work to stop it reading as "unattributed". Every
//      issue-based number moves, so a cached v17 model must miss cleanly.
// v19: APAC RETIRED (reviewer feedback 2026-08-05) — region vocabulary is now
//      AMER/EMEA/SEA/ANZ/Global/Other: RR05 South East Asia and RR08 Asia map
//      to SEA (APAC is a superset of ANZ+SEA, so the two chips contradicted
//      each other), and Malaysia/Singapore/Philippines roster locations follow.
//      assignPersonRegion_ also stops letting Global/Other hours vote, so
//      Global-heavy rocketeers keep a geographic home ("ANZ has no members").
//      A cached v18 model carries APAC people/buckets and an APAC chip, so it
//      must miss cleanly.
// v20: GLOBAL CHIP REMOVED (user report 2026-08-05: "Global shows 0 for the
//      whole data"). Region chips filter PEOPLE — every metric bucket is keyed
//      by person — and once Global/Other stopped voting in assignPersonRegion_
//      (v19) no person can ever be "Global", so the chip was structurally
//      pinned at 0. meta.regions drops it; "Global" remains an ISSUE token for
//      hygiene fill counts. A cached v19 model still ships the dead chip.
// v21: 🌊 Flow metrics — leadTimeBuckets/throughputBuckets/flowOpenBuckets/
//      bugWeekly + meta.flowSnapshots/bugsAvailable/flowSnapshotsAvailable.
//      A cached older model has none of these; the Flow tab would render
//      every tile as absent, so force one clean rebuild.
// v22: TWO-TAB CONSOLIDATION (spec 2026-08-05) — new `personHygiene`
//      (per-person field fill, resolved person×week + open snapshot) and
//      meta.signalMinN behind the Actions roster. A cached v21 model has
//      neither; the roster would render its "Not in this payload" empty state
//      for a whole TTL, so it must miss cleanly.
// v23: COMMERCIAL READINESS ON THE ROSTER (2026-08-06) — personHygiene rows
//      gain `link`/`start`/`bill` (+`billN`, its own denominator) and
//      `estSec`/`spentSec`/`wip`. Sourced from four Jira Raw columns the reader
//      had never picked up (Epic Key, Parent Key, Billing Type, Start Date), so
//      no export change is involved. A cached v22 row has none of these fields:
//      the three new signal columns would grade every person off `undefined`
//      (0% — a fabricated red on the whole roster) and the progress column would
//      read 0h carried, which is indistinguishable from "no open work". Must
//      miss cleanly.
// v24: LOGGED TIME IS EXPECTED ONLY ON STARTED WORK (user report 2026-08-06 —
//      "we are considering tickets in the status 'To Do' when we should expect
//      this to happen on tickets in progress"). typeHygiene rows gain `timeN`
//      and personHygiene rows gain `loggedN`: on the OPEN population both count
//      only status-category "In Progress" records, so an unstarted ticket is no
//      longer a logging gap. Resolved is unchanged (timeN === n, loggedN === n).
//      A cached v23 row has neither denominator, so the Logged column would
//      divide by 0 and render ungraded "—" for a whole TTL. Must miss cleanly.
// v25: 🌊 BACKLOG HEALTH (2026-08-06) — new meta-level `backlogHealth`
//      (person-keyed snapshot: 18 signals + per-signal work queues + an asOf
//      stamp), behind the Actions-tab panel. Needs `updated` on the ingested
//      record, which no earlier model carried — so on a cached v24 model all
//      three staleness signals would read 0 and the panel would report a
//      perfectly fresh backlog, which is worse than reporting nothing. Must miss
//      cleanly. `Updated` itself is Jira Raw column 10 and has always been
//      exported: no export change, no re-run.
var DH_SCHEMA_VER_ = 25;

/** Full I/O compute — shared by getDeliveryData and warmDeliveryCache. */
function buildDeliveryModel_() {
  var win = buildDhWindow_(new Date());
  return assembleModel_({
    roster: readRosterPeople_(),
    capacity: readCapacitySheet_(),
    tracked: readTempoGrid_(CONFIG_DH.TRACKED_SHEET),
    planned: readTempoGrid_(CONFIG_DH.PLANNED_SHEET),
    ns: readNsBillable_(),
    jira: readJiraRaw_(),
    bugs: readJiraBugs_(),
    flowSnaps: readFlowSnapshots_(),
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
  // ── ISSUE-TYPE VOCABULARY ──
  // The by-type hygiene matrix renders whatever the export actually contains —
  // nothing hardcodes a type list. This is where you find out what those strings
  // really are. Two things to look for:
  //   · which types the "epic" substring rule sweeps up (Kick-off epic and
  //     Go-live epic ALREADY count as epics for On-Time and Forecast, pooled
  //     invisibly with plain Epic);
  //   · whether a Milestone type exists at all (DATA-BLOCKERS #5 says it does
  //     not, which is what reduces the Dictionary's On-Time scope to "epics").
  var tr = j.typeRaw || {};
  var tKeys = Object.keys(tr).sort(function (a, b) { return tr[b] - tr[a]; });
  if (!tKeys.length) {
    Logger.log("⚠️ Issue types: none found — check the \"Workstream (Issue Type)\" column exists.");
  } else {
    Logger.log("Issue types (" + tKeys.length + " distinct): " +
      tKeys.map(function (k) { return k + " ×" + tr[k]; }).join(" · "));
    var epicish = tKeys.filter(function (k) { return normDH_(k).indexOf("epic") !== -1; });
    Logger.log("  → counted as EPIC by the substring rule (so inside On-Time dictionary scope " +
      "and the Forecast denominator): " + (epicish.join(", ") || "NONE"));
    var milestone = tKeys.filter(function (k) { return /milestone/i.test(k); });
    Logger.log(milestone.length
      ? "  → Milestone-typed work EXISTS: " + milestone.join(", ")
      : "  → ℹ️ No Milestone type in this export (DATA-BLOCKERS #5). The Dictionary's " +
        "\"Epic or Milestone or Client Commitment\" reduces to epics — but note the epic-ish " +
        "types above; one of them may be the milestone the Dictionary means. Question for Bill.");
  }

  // Export freshness — the header's "Data as of" stamp comes from here, so a
  // parse failure has to be loud in the probe rather than showing up as a quiet
  // "unknown" on every reader's screen.
  if (j.exportedAt) {
    var ageH = (Date.now() - new Date(j.exportedAt).getTime()) / 3600000;
    Logger.log((ageH > CONFIG_DH.JIRA_EXPORT_STALE_H ? "⚠️" : "✅") +
               " Jira export stamp: " + j.exportedAt + " (" + (Math.round(ageH * 10) / 10) +
               "h old; stale past " + CONFIG_DH.JIRA_EXPORT_STALE_H + "h)");
  } else if (j.available) {
    Logger.log("⚠️ Jira export stamp: NOT FOUND in the last rows of column A. " +
               "Jira Backlog.js writeRawSheet_ writes \"Generated: M/D/YYYY HH:MM\" two rows " +
               "below the data — check the exporter version and that nothing cropped the footer. " +
               "The header will read \"refresh time unknown\" until this parses.");
  }
  var idx = buildNameIndex_(r.people.map(function (x) { return x.name; }));
  var nsMatched = ns.rows.filter(function (row) { return resolveName_(idx, row.name); }).length;
  Logger.log("NS→roster join: " + nsMatched + "/" + ns.rows.length + " rows matched");
  // No PTO/holiday probes: the model reads NO absence source (user decision
  // 2026-08-04) — tracked time off is just non-billable time, capacity is gross.

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
  // values exist and which of them fall through to "Other".
  // Open decision #1 is CLOSED (2026-08-04): the option list was read off live
  // Jira and JIRA_REGION_TO_DH_ now carries all eight verified labels. Keep this
  // probe — it is how a NEW option gets noticed before it silently becomes
  // "Other".
  var raw = j.regionRaw || {};
  var rawKeys = Object.keys(raw).filter(function (k) { return k !== "(blank)"; });
  var blanks = raw["(blank)"] || 0;
  if (!rawKeys.length) {
    Logger.log("⚠️ Jira Region: " + blanks + " rows, ALL BLANK. This is NO LONGER the " +
               "expected state — ~34% of the 52-week resolved window carries a Resource region " +
               "as of 2026-08-04. All-blank now means the DEPLOYED export predates \"Jira Backlog.js\" " +
               "v3.7.0 (which fixed the multi-select reader) or the export hasn't been re-run. " +
               "Meanwhile every issue lands in Unassigned and person region resolves from the roster.");
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

function _test_regionMap_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionMap_: " + m); }
  assert_(regionBucketFromLocation_("Malaysia") === "SEA", "known location (SEA since APAC retired 2026-08-05)");
  assert_(regionBucketFromLocation_("  MALAYSIA ") === "SEA", "case/space insensitive");
  assert_(regionBucketFromLocation_("Netherlands") === "EMEA",
    "Netherlands → EMEA (was falling through to Other, user report 2026-08-04)");
  assert_(regionBucketFromLocation_("Atlantis") === "Other", "unknown → Other");
  assert_(regionBucketFromLocation_("") === "EMEA",
    "blank → EMEA (empty-region rocketeers, user decision 2026-08-04)");
  Logger.log("✅ _test_regionMap_ passed");
}

function _test_personRegion_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personRegion_: " + m); }
  // hoursByRegion from Key→Jira Raw join over the trend window
  var r = assignPersonRegion_({ "AMER": 60, "EMEA": 20 }, "SEA");
  assert_(r.region === "AMER" && r.source === "jira", "majority wins");
  var t = assignPersonRegion_({ "AMER": 40, "EMEA": 40 }, "SEA");
  assert_(t.region === "AMER" && t.source === "jira", "tie → alphabetical (deterministic)");
  var f = assignPersonRegion_({}, "SEA");
  assert_(f.region === "SEA" && f.source === "roster", "no tagged hours → roster fallback");
  var z = assignPersonRegion_({ "AMER": 0 }, "SEA");
  assert_(z.region === "SEA" && z.source === "roster", "zero hours = untagged");
  // Global/Other never vote (2026-08-05, "ANZ has no members"): Global-heavy
  // people keep a geographic home instead of being vacuumed into the Global chip.
  var g = assignPersonRegion_({ "Global": 100, "ANZ": 5 }, "SEA");
  assert_(g.region === "ANZ" && g.source === "jira", "Global hours excluded — minority geography still wins");
  var go = assignPersonRegion_({ "Global": 100, "Other": 30 }, "ANZ");
  assert_(go.region === "ANZ" && go.source === "roster", "only non-geo hours → roster fallback");
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
      weeks: { W1: { avail: 0, availCov: 0, billable: 0, tracked: 0, planned: 0 } } }, // zero-capacity week
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
  // Intern carve (user decision 2026-08-04): never in a rate, include flag or not.
  var withIntern = people.concat([{ name: "F", region: "AMER", teams: [], isIntern: true,
    weeks: { W1: { avail: 40, availCov: 40, billable: 0, tracked: 0, planned: 40 } } }]);
  assert_(utilRollup_(withIntern, "W1", null, null).avail === 72, "intern excluded by default");
  assert_(utilRollup_(withIntern, "W1", null, null, true).avail === 72, "intern excluded even with include flag");
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

function _test_flowBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowBuckets_: " + m); }
  var who = function (a) { return a === "maria" ? "Maria Alvarez" : null; };
  var d = function (s) { return new Date(s); };
  var issues = [
    // resolved story, 4.0 days lead, 7200s estimate → counted everywhere
    { isEpic: false, assignee: "maria", created: d("2026-07-20T09:00:00"),
      resolved: d("2026-07-24T09:00:00"), estSec: 7200, spentSec: 3600 },
    // resolved task, NO created date → nAll only (lead-time coverage gap)
    { isEpic: false, assignee: "maria", created: null,
      resolved: d("2026-07-24T12:00:00"), estSec: 0, spentSec: 0 },
    // epic → excluded from BOTH metrics (grain decision D4)
    { isEpic: true, assignee: "maria", created: d("2026-07-01"),
      resolved: d("2026-07-24"), estSec: 360000, spentSec: 0 },
    // non-roster assignee → unattributed tally
    { isEpic: false, assignee: "ghost", created: d("2026-07-20"),
      resolved: d("2026-07-24"), estSec: 3600, spentSec: 0 },
    // unresolved → ignored by both
    { isEpic: false, assignee: "maria", created: d("2026-07-20"),
      resolved: null, estSec: 3600, spentSec: 0 },
  ];

  var lt = leadTimeBuckets_(issues, who);
  assert_(lt.buckets.length === 1, "one iso+person lead-time bucket");
  var b = lt.buckets[0];
  assert_(b.person === "Maria Alvarez", "person resolved via roster join");
  assert_(b.nAll === 2 && b.n === 1, "nAll counts both resolved stories; n only the dated one");
  assert_(b.days.length === 1 && Math.abs(b.days[0] - 4) < 0.05, "4.0 days lead time");
  assert_(lt.unattributed === 1, "ghost assignee tallied, not dropped silently");

  var tp = throughputBuckets_(issues, who);
  assert_(tp.buckets.length === 1, "one throughput bucket");
  var t = tp.buckets[0];
  assert_(t.nAll === 2 && t.nEst === 1, "coverage = estimated ÷ resolved");
  assert_(Math.abs(t.estHrs - 2) < 0.001, "7200s = 2.0 estimate-hours delivered");
  assert_(tp.unattributed === 1, "throughput tallies the ghost too");

  // negative lead time (created after resolved — clock skew) is not a measurement
  var skew = leadTimeBuckets_([{ isEpic: false, assignee: "maria",
    created: d("2026-07-25"), resolved: d("2026-07-24") }], who);
  assert_(skew.buckets[0].nAll === 1 && skew.buckets[0].n === 0 &&
          skew.buckets[0].days.length === 0, "negative lead time → coverage gap, not a data point");
  Logger.log("✅ _test_flowBuckets_ passed");
}

function _test_flowOpenBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowOpenBuckets_: " + m); }
  var who = function (a) { return a === "maria" ? "Maria Alvarez" : null; };
  var issues = [
    // waiting to start: To Do, 2h est, 0.5h spent → backlog 1.5h
    { isEpic: false, assignee: "maria", resolved: null, status: "To Do",
      statusCategory: "To Do", estSec: 7200, spentSec: 1800 },
    // active: In Progress → WIP, hours NOT counted in backlog
    { isEpic: false, assignee: "maria", resolved: null, status: "In Progress",
      statusCategory: "In Progress", estSec: 36000, spentSec: 0 },
    // To Do with no estimate → item counted, 0 hours, coverage gap
    { isEpic: false, assignee: "maria", resolved: null, status: "Backlog",
      statusCategory: "To Do", estSec: 0, spentSec: 0 },
    // blank status category (pre-v3.6.0 export) → measured as NEITHER
    { isEpic: false, assignee: "maria", resolved: null, status: "Waiting",
      statusCategory: "", estSec: 3600, spentSec: 0 },
    // epic → excluded; resolved → excluded; unassigned → excluded
    { isEpic: true, assignee: "maria", resolved: null, statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    { isEpic: false, assignee: "maria", resolved: new Date(), statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    { isEpic: false, assignee: "⚠️ UNASSIGNED", resolved: null, statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    // closed-ish status but no resolution date → excluded (matches openIssues rule)
    { isEpic: false, assignee: "maria", resolved: null, status: "Canceled",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    // non-roster assignee → unattributed
    { isEpic: false, assignee: "ghost", resolved: null, status: "To Do",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
  ];
  var r = flowOpenBuckets_(issues, who);
  assert_(r.buckets.length === 1, "one person bucket");
  var b = r.buckets[0];
  assert_(b.person === "Maria Alvarez", "keyed by roster name");
  assert_(b.wipN === 1, "one item in progress");
  assert_(b.todoN === 2 && b.todoEst === 1, "two waiting items, one estimated");
  assert_(Math.abs(b.todoHrs - 1.5) < 0.001, "backlog hrs = max(0, est − spent) = 1.5");
  assert_(r.uncategorized === 1, "blank status category measured as neither, tallied");
  assert_(r.unattributed === 1, "ghost tallied");
  Logger.log("✅ _test_flowOpenBuckets_ passed");
}

function _test_bugFeed_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_bugFeed_: " + m); }
  // Header order shuffled on purpose — consumers resolve BY NAME.
  var values = [
    ["Summary", "Key", "Created", "Resolution Date", "Status Category"],
    ["login broken", "BUG-1", "7/20/2026 09:00", "7/22/2026 10:00", "Done"],
    ["slow page", "BUG-2", "7/21/2026 09:00", "", "To Do"],
    ["", "", "", "", ""],                       // blank spacer row
    ["", "Generated: 8/5/2026 07:00", "", "", ""],  // footer must not parse as a bug
  ];
  var r = parseBugRows_(values);
  assert_(r.available === true, "parsed feed is available");
  assert_(r.bugs.length === 2, "two bugs, footer + blank skipped");
  assert_(r.bugs[0].key === "BUG-1" && r.bugs[0].resolved instanceof Date, "resolved date parsed");
  assert_(r.bugs[1].resolved === null, "open bug has null resolved");

  var wk = bugWeekly_(r.bugs);
  // both created in the week of 2026-07-20 (2026.W30); one resolved same week
  var w30 = wk.filter(function (x) { return x.iso === "2026.W30"; })[0];
  assert_(w30 && w30.nCreated === 2 && w30.nResolved === 1,
          "weekly tally: 2 created, 1 resolved in 2026.W30");

  assert_(parseBugRows_(null).available === false, "no values → unavailable");
  assert_(parseBugRows_([["Key"]]).available === false, "header-only → unavailable");
  Logger.log("✅ _test_bugFeed_ passed");
}

/**
 * Jira Arrivals parse. Three rules, each a bug that has bitten this codebase:
 *  · columns BY NAME, so a column order change upstream cannot silently shift data;
 *  · a MISSING column yields null, never 0 — "nobody measured" and "measured zero"
 *    are different facts, and conflating them is how a feed outage reads as good news;
 *  · the ISO week key is computed HERE from Week Start. weekKeyFromDate_ emits
 *    "2026.W7"; the exporter's jb_isoWeekLabel_ emits "2026.W07". A label written
 *    upstream would fail to join for weeks 1-9 (spec §4.1).
 */
function _test_arrivalParse_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_arrivalParse_: " + m); }

  // Sheets delivers dates as local midnight. Construct them the same way to ensure
  // isoWeekNum_'s local getters (getFullYear/getMonth/getDate) read the correct
  // calendar day. A UTC instant like new Date("2026-07-27T00:00:00Z") would bucket
  // to the prior day in behind-UTC timezones (e.g. America/Guatemala), causing the
  // same week-label code to silently return the wrong week.
  // Deliberately NOT in the order the exporter writes them.
  var values = [
    ["Resolved", "Week Start", "Created Unassigned", "Created"],
    [204, new Date(2026, 6, 27), 90, 224],  // Monday of ISO week 31
    [297, new Date(2026, 6, 20), 71, 250],  // Monday of ISO week 30
    ["", "", "", ""],                        // trailing blank row
  ];
  var r = parseArrivalRows_(values);
  assert_(r.available === true, "available on a well-formed tab");
  assert_(r.weeks.length === 2, "blank rows skipped — got " + r.weeks.length);
  var w31 = r.weeks[0];
  assert_(w31.iso === "2026.W31", "week key computed from Week Start — got " + w31.iso);
  assert_(w31.created === 224 && w31.resolved === 204, "counts read by NAME, not position");
  assert_(w31.createdUnassigned === 90, "createdUnassigned read");
  var w30 = r.weeks[1];
  assert_(w30.iso === "2026.W30", "second week is W30 — got " + w30.iso);

  // Missing optional column → null, not 0.
  var noUnassigned = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    [new Date(2026, 6, 27), 224, 204],
  ]);
  assert_(noUnassigned.weeks[0].createdUnassigned === null,
          "absent column → null, never 0 — got " + noUnassigned.weeks[0].createdUnassigned);

  // An unusable Week Start is skipped, not crashed on and not bucketed to epoch.
  var junk = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    ["not a date", 5, 5],
    [new Date(2026, 6, 27), 224, 204],
  ]);
  assert_(junk.weeks.length === 1, "unparseable Week Start skipped — got " + junk.weeks.length);

  // No tab / empty tab is a clean unavailable, not an exception.
  assert_(parseArrivalRows_([]).available === false, "empty values → unavailable");
  assert_(parseArrivalRows_([["Week Start", "Created", "Resolved"]]).available === false,
          "header-only → unavailable");

  // Valid header with zero usable rows: `available: true` (tab is readable)
  // but `weeks.length === 0` (no data), distinguishing this from "export not yet run".
  var allUnparseable = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    ["not a date", 5, 5],
  ]);
  assert_(allUnparseable.available === true && allUnparseable.weeks.length === 0,
          "all-unparseable rows: available=true, weeks.length=0 — got available=" +
          allUnparseable.available + ", weeks.length=" + allUnparseable.weeks.length);

  // Missing a required column: unavailable, never readable.
  var missingResolved = parseArrivalRows_([
    ["Week Start", "Created"],
    [new Date(2026, 6, 27), 224],
  ]);
  assert_(missingResolved.available === false, "missing required column → unavailable");

  Logger.log("✅ _test_arrivalParse_ passed");
}

function _test_flowSnapshots_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowSnapshots_: " + m); }
  var values = [
    ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items"],
    ["7/28/2026 07:00", "2026.W31", "10", "120.5", "40"],
    ["7/30/2026 07:00", "2026.W31", "12", "118",   "38"],  // later run, same week
    ["8/3/2026 07:00",  "2026.W32", "11", "99",    "35"],
    ["not a date",      "garbage",  "",   "",      ""],    // junk row skipped
  ];
  var r = parseFlowSnapshotRows_(values);
  assert_(r.available === true, "parsed");
  assert_(r.snaps.length === 2, "one snapshot per ISO week, junk skipped");
  assert_(r.snaps[0].iso === "2026.W31" && r.snaps[0].wip === 12,
          "LAST run of the week wins (12, not 10)");
  assert_(Math.abs(r.snaps[0].backlogHrs - 118) < 0.001, "hours from the winning row");
  assert_(r.snaps[1].iso === "2026.W32" && r.snaps[1].backlogN === 35, "second week intact");
  assert_(parseFlowSnapshotRows_([]).available === false, "empty → unavailable");
  Logger.log("✅ _test_flowSnapshots_ passed");
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

/** 🌊 Flow metric registry entries (spec 2026-08-05-flow-metrics-design.md):
    five live metrics ship with NO target (D6 — neutral tile, no invented RAG
    threshold), and two more (Cycle Time, Flow Efficiency) are declared
    absent, CSAT-style, because the Jira changelog isn't exported. */
function _test_flowRegistry_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowRegistry_: " + m); }
  var m = METRIC_REGISTRY_.metrics;
  ["leadTime", "throughput", "backlog", "wip", "bugCount"].forEach(function (id) {
    assert_(m[id], id + " registered");
    assert_(m[id].target === null, id + " ships with NO target (D6 — neutral tile, no RAG)");
    assert_(m[id].owner, id + " has an owner");
    assert_(typeof m[id].coverageGate === "number", id + " has a numeric coverage gate");
  });
  ["cycleTime", "flowEfficiency"].forEach(function (id) {
    assert_(m[id] && m[id].status === "absent", id + " is declared absent");
    assert_(m[id].absentReason && m[id].absentReason.length > 10, id + " states why");
  });
  // The v3.0 change-log entry exists and marks no existing trend line. Looked up
  // BY VERSION, not by position: this test is about the Flow entry, and pinning
  // it to index 0 made the next unrelated change-log entry fail this suite.
  var flowEntry = METRIC_REGISTRY_.changeLog.filter(function (e) {
    return e.version === "3.0";
  })[0];
  assert_(flowEntry, "changeLog carries the 3.0 Flow entry");
  assert_(flowEntry.affects.length === 0,
          "new metrics move no EXISTING metric's values — no ✎ marker on old trends");
  Logger.log("✅ _test_flowRegistry_ passed");
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

/**
 * attr (roster join) must divide by records that HAVE an assignee, not by every
 * record. An unassigned issue has no assignee to fail to join — that gap is what
 * the `assigned` column measures. Scoring it as a join failure is how adding
 * unassigned rows to the feed (Jira Backlog.js v3.11.0) would un-retire a solved
 * check and report ~44% where the truth is 100%.
 */
function _test_attrDenominator_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_attrDenominator_: " + m); }
  var who = function (raw) {
    var n = String(raw || "").toLowerCase().trim();
    return n === "maria" ? "Maria" : null;   // "ghost" and the sentinel resolve to nobody
  };
  var issues = [
    // open, assigned, resolves → attrN 1, attr 1
    { key: "A-1", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "maria", estSec: 3600, spentSec: 0, due: new Date() },
    // open, UNASSIGNED sentinel → in NEITHER half of attr
    { key: "A-2", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "⚠️ UNASSIGNED", estSec: 0, spentSec: 0, due: null },
    // open, assigned but does NOT resolve → attrN 1, attr 0 (a real join failure)
    { key: "A-3", typeLabel: "Story", type: "story", isEpic: false, status: "Open",
      statusCategory: "To Do", assignee: "ghost", estSec: 0, spentSec: 0, due: null },
  ];
  var r = typeHygieneBuckets_({ issues: issues }, who, "delivery");
  var row = r.open[0];
  assert_(row, "one open row for the Story type");
  assert_(row.n === 3, "n counts every record — got " + row.n);
  assert_(row.attrN === 2, "attrN counts only records WITH an assignee — got " + row.attrN);
  assert_(row.attr === 1, "attr counts records whose assignee resolves — got " + row.attr);
  assert_(row.assigned === 2, "assigned counts records with an assignee (A-1 maria + A-3 ghost, but not A-2 UNASSIGNED) — got " + row.assigned);

  // The regression this exists to prevent: an all-unassigned population must not
  // read as 0% roster join. attrN 0 means "nothing to grade", never "all failed".
  var allBlank = typeHygieneBuckets_({ issues: [issues[1]] }, who, "delivery");
  assert_(allBlank.open[0].attrN === 0, "all-unassigned → attrN 0");
  assert_(allBlank.open[0].attr === 0, "all-unassigned → attr 0 (over a 0 denominator)");

  // And a missing key in the queue: an unassigned record is not an attr miss, so
  // it must not appear in the attr work queue.
  assert_(!(row.keys.attr || []).length || (row.keys.attr || []).indexOf("A-2") === -1,
          "the unassigned record must not be queued as an attr gap");
  assert_((row.keys.attr || []).indexOf("A-3") !== -1,
          "the genuine join failure IS queued as an attr gap");
  Logger.log("✅ _test_attrDenominator_ passed");
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

/**
 * The Jira export's "Generated:" footer stamp → ISO.
 *
 * The stakes: this stamp is the ONLY statement of how old the data is. A
 * misparse that lands months away reports a stale export as fresh, which is
 * strictly worse than showing nothing — so every rejection path is pinned here,
 * and M/D vs D/M is asserted explicitly rather than left to `new Date`.
 */
function _test_parseExportStamp_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_parseExportStamp_: " + m); }
  // The exact shape Jira Backlog.js fmtDateTime_ writes: M/D/YYYY HH:MM, 24h,
  // no padding on month/day, zero-padded hour/minute.
  var iso = parseExportStamp_("8/4/2026 03:00");
  var d = new Date(iso);
  assert_(d.getMonth() === 7 && d.getDate() === 4, "8/4 is AUGUST 4th (M/D), not April 8th");
  assert_(d.getHours() === 3 && d.getMinutes() === 0, "24-hour time preserved");
  assert_(d.getFullYear() === 2026, "year preserved");
  // 24-hour clock: 15:30 must NOT be read as 3:30am.
  assert_(new Date(parseExportStamp_("12/31/2026 15:30")).getHours() === 15, "afternoon stays PM");
  // Date-only stamp (an older exporter, or a hand-trimmed cell) → midnight.
  assert_(new Date(parseExportStamp_("1/9/2026")).getHours() === 0, "date-only → midnight");
  // A real Date object, in case Sheets ever coerces the cell.
  var real = new Date(2026, 7, 4, 3, 0);
  assert_(parseExportStamp_(real) === real.toISOString(), "a Date passes through");
  // Rejections — each must be null, never a guess. A wrong date here is a
  // freshness LIE, so "unknown" is the only safe failure.
  ["", null, undefined, "   ", "Total rows: 402", "Generated:", "not a date",
   "13/1/2026 03:00",      // month 13
   "2/30/2026 03:00",      // Feb 30 — JS would roll it to Mar 2
   "8/4/2026 25:00",       // hour 25
   "8/4/2026 03:99",       // minute 99
  ].forEach(function (bad) {
    assert_(parseExportStamp_(bad) === null, "rejects " + JSON.stringify(bad));
  });
  // The label itself is stripped by the caller, not here — confirm this function
  // is not accidentally tolerant of it, or a regex change upstream would go unseen.
  assert_(parseExportStamp_("Generated: 8/4/2026 03:00") === null,
          "the 'Generated:' label is the CALLER's to strip");
  Logger.log("✅ _test_parseExportStamp_ passed");
}

/**
 * Field fill per issue type, resolved + open.
 *
 * The failure this suite guards: a matrix that quietly measures the wrong
 * population reads as "your data is fine". So it pins the population split,
 * the epic substring rule that silently pools three types, the fact that the
 * failing-KEY lists hold what is MISSING, and the cap being reported.
 */
function _test_typeHygieneBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_typeHygieneBuckets_: " + m); }
  var W = new Date(2026, 6, 28);   // a Tuesday — resolution week 2026.W31
  function it_(o) {
    return Object.assign({ key: "K", typeLabel: "Story", type: "story", status: "In Progress",
                           isEpic: false, isMilestone: false, isClientCommitment: false,
                           due: null, resolved: null, estSec: 0, spentSec: 0,
                           region: "", team: "", assignee: "" }, o);
  }
  var resolve = function (n) { return /maria/i.test(n) ? "Maria Alvarez" : null; };

  var jira = { issues: [
    // Resolved, fully attributed Go-live epic.
    it_({ key: "A-1", typeLabel: "Go-live epic", type: "go-live epic", isEpic: true,
          resolved: W, due: W, estSec: 3600, spentSec: 1800,
          region: "AMER", team: "Atlas", assignee: "Maria Alvarez" }),
    // Resolved Go-live epic missing due date + estimate.
    it_({ key: "A-2", typeLabel: "Go-live epic", type: "go-live epic", isEpic: true,
          resolved: W, assignee: "Maria Alvarez" }),
    // Resolved plain Epic, assignee present but NOT on the roster.
    it_({ key: "A-3", typeLabel: "Epic", type: "epic", isEpic: true,
          resolved: W, due: W, assignee: "Random Dev" }),
    // OPEN epic with no estimate — the record the whole feature exists to expose.
    it_({ key: "A-4", typeLabel: "Go-live epic", type: "go-live epic", isEpic: true,
          status: "In Progress", assignee: "Maria Alvarez" }),
    // Open Story.
    it_({ key: "A-5", status: "To Do", assignee: "Maria Alvarez", due: W }),
    // Closed-ish status but NO resolution date — belongs to NEITHER population.
    it_({ key: "A-6", status: "Done" }),
    // Blank type.
    it_({ key: "A-7", typeLabel: "(blank)", type: "", status: "To Do" }),
  ] };

  var t = typeHygieneBuckets_(jira, resolve, "dictionary");
  function find_(rows, type) {
    return rows.filter(function (r) { return r.type === type; })[0];
  }

  // ── Populations ──
  var openTypes = t.open.map(function (r) { return r.type; }).sort();
  assert_(openTypes.join("|") === "(blank)|Go-live epic|Story",
          "open population = unresolved and not closed-ish, got " + openTypes.join("|"));
  assert_(!t.open.some(function (r) { return r.keys && (r.keys.due || []).indexOf("A-6") !== -1; }),
          "a closed status with no resolution date is in NEITHER population");
  assert_(t.resolved.reduce(function (s, r) { return s + r.n; }, 0) === 3, "3 resolved records");
  assert_(t.open.reduce(function (s, r) { return s + r.n; }, 0) === 3, "3 open records");

  // ── The divergence from openIssues that makes this feature work ──
  var openEpic = find_(t.open, "Go-live epic");
  assert_(openEpic && openEpic.n === 1,
          "OPEN EPICS ARE INCLUDED — openIssues excludes them, this must not");
  assert_(openEpic.est === 0 && openEpic.keys.est.join() === "A-4",
          "the open epic's missing estimate is captured as a key");

  // ── Resolved rows carry their week; open rows must not invent one ──
  assert_(t.resolved.every(function (r) { return r.iso === "2026.W31"; }),
          "resolved rows bucket by resolution week");
  assert_(t.open.every(function (r) { return r.iso === ""; }),
          "open rows carry NO iso — a backlog is a snapshot, not a time series");

  // ── Types stay separate, and the epic rule is visible ──
  var rGolive = find_(t.resolved, "Go-live epic"), rEpic = find_(t.resolved, "Epic");
  assert_(rGolive.n === 2 && rEpic.n === 1, "Go-live epic and Epic are SEPARATE rows");
  assert_(rGolive.isEpic === true && rEpic.isEpic === true,
          "both count as epics — the substring rule pools them for the metrics");
  assert_(rGolive.gatesOnTime === true && rGolive.gatesForecast === true,
          "an epic-family type gates both epic-grain metrics");
  var oStory = find_(t.open, "Story");
  assert_(oStory.gatesOnTime === false,
          "a Story gates NO published On-Time rate under dictionary scope — must be marked, " +
          "or the matrix drives a campaign that moves no number");
  assert_(oStory.gatesForecast === false, "…and no Forecast either (epic grain only)");
  // The scope predicate is SHARED, not copied: flip the scope, flip the flag.
  assert_(find_(typeHygieneBuckets_(jira, resolve, "all").open, "Story").gatesOnTime === true,
          "gatesOnTime follows onTimeInScope_, it is not a second copy of the rule");
  assert_(find_(typeHygieneBuckets_(jira, resolve, "delivery").resolved, "Epic").gatesOnTime === false,
          "…and under 'delivery' scope an Epic gates nothing");

  // ── Fill counts + the KEY lists hold what is MISSING ──
  assert_(rGolive.due === 1 && rGolive.keys.due.join() === "A-2",
          "the failing key list holds the record MISSING the field, not the healthy one");
  assert_(rGolive.est === 1 && rGolive.time === 1, "estimate/logged-time counted independently");
  assert_(rEpic.assigned === 1 && rEpic.attr === 0,
          "'has an assignee' and 'that assignee joins the roster' are SEPARATE gaps");
  assert_(rEpic.keys.attr.join() === "A-3", "the roster-join failure names its issue");
  assert_(rGolive.region === 1 && rGolive.team === 1, "region/team fill counted");
  assert_(find_(t.open, "(blank)").n === 1, "a blank type gets its own row, never dropped");

  // The "⚠️ UNASSIGNED" sentinel must not read as a filled assignee.
  var sent = typeHygieneBuckets_({ issues: [
    it_({ key: "S-1", status: "To Do", assignee: "⚠️ UNASSIGNED" }) ] }, resolve, "dictionary");
  assert_(find_(sent.open, "Story").assigned === 0,
          "the exporter's UNASSIGNED sentinel is a GAP, not a name");

  // ── LOGGED TIME IS EXPECTED ONLY ON STARTED WORK (user report 2026-08-06) ──
  // The regression this pins: `time` divided by n, so 782 of 1,116 flagged rows
  // on the live backlog were tickets nobody had started. Every assertion here is
  // about the DENOMINATOR — a numerator-only fix would have looked identical on
  // a healthy fixture and still shipped the unworkable queue.
  assert_(openEpic.timeN === 1 && openEpic.time === 0 && openEpic.keys.time.join() === "A-4",
          "an OPEN, STARTED ticket with no worklog IS a logging gap — counted and queued");
  assert_(oStory.timeN === 0 && oStory.time === 0,
          "an OPEN, NOT-STARTED ticket is in NEITHER half of the logged ratio");
  assert_(!oStory.keys.time,
          "…and never enters the work queue — a To Do ticket has nothing to log against yet");
  assert_(rGolive.timeN === rGolive.n && rEpic.timeN === rEpic.n,
          "RESOLVED work is always expected to carry its cost — timeN === n, unchanged by this rule");
  // Every other column keeps dividing by n: the carve-out is time-specific, and
  // a shared helper applied one field too wide would silently stop counting due
  // dates on the backlog — the matrix's single most actionable column.
  assert_(oStory.n === 1 && oStory.due === 1 && find_(t.open, "(blank)").keys.due.join() === "A-7",
          "due/est/assignee still measure the WHOLE open population, started or not");

  // A To Do ticket that DOES carry a worklog scores in neither half. It is a
  // status-hygiene gap (work started, board never moved) with a different owner;
  // counting it as credit would let a drifted board read as good tracking.
  var drift = find_(typeHygieneBuckets_({ issues: [
    it_({ key: "D-1", status: "To Do", spentSec: 3600, assignee: "Maria Alvarez" }) ] },
    resolve, "dictionary").open, "Story");
  assert_(drift.timeN === 0 && drift.time === 0,
          "logged time on an unstarted ticket is neither credit nor gap");

  // Status CATEGORY is authoritative — the live In Progress category holds
  // Blocked/Review/Ready too, and all of them are work somebody has picked up.
  var blocked = find_(typeHygieneBuckets_({ issues: [
    it_({ key: "B-1", status: "Blocked", statusCategory: "In Progress" }) ] },
    resolve, "dictionary").open, "Story");
  assert_(blocked.timeN === 1 && blocked.keys.time.join() === "B-1",
          "Blocked/Review/Ready sit in the In Progress CATEGORY — started work, time expected");
  var groomed = find_(typeHygieneBuckets_({ issues: [
    it_({ key: "G-1", status: "Ready for Dev", statusCategory: "To Do" }) ] },
    resolve, "dictionary").open, "Story");
  assert_(groomed.timeN === 0,
          "an unrecognised status name in the To Do CATEGORY is still unstarted");

  // ── Key cap is enforced AND reported ──
  var many = [];
  for (var i = 0; i < TYPE_HYG_MAX_KEYS_ + 25; i++) many.push(it_({ key: "M-" + i, status: "To Do" }));
  var capped = find_(typeHygieneBuckets_({ issues: many }, resolve, "dictionary").open, "Story");
  assert_(capped.n === TYPE_HYG_MAX_KEYS_ + 25, "the COUNT covers every record");
  assert_(capped.keys.due.length === TYPE_HYG_MAX_KEYS_, "the key LIST is capped");
  assert_(capped.keysCapped.due === true,
          "…and the cap is flagged — a clipped list read as complete is how 'all fixed' goes wrong");

  assert_(typeHygieneBuckets_({ issues: [] }, resolve, "dictionary").open.length === 0,
          "empty feed → no rows");
  Logger.log("✅ _test_typeHygieneBuckets_ passed");
}

function _test_personHygieneBuckets_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_personHygieneBuckets_: " + m); }
  var resolve = function (raw) {
    if (/maria/i.test(raw || "")) return "Maria Alvarez";
    if (/ken/i.test(raw || "")) return "Ken Lim";
    return null;                       // anyone else is unattributed
  };
  var d = function (s) { return new Date(s); };
  var jira = { issues: [
    // Resolved, fully filled → Maria resolved bucket W31: n1 due1 est1 logged1
    { assignee: "Alvarez, Maria", resolved: d("2026-07-29"), due: d("2026-07-30"),
      estSec: 3600, spentSec: 1800, status: "Done", typeLabel: "Story", key: "T-1" },
    // Resolved, all three missing → Maria resolved W31: n2, counts unchanged
    { assignee: "Maria Alvarez", resolved: d("2026-07-30"), due: null,
      estSec: 0, spentSec: 0, status: "Done", typeLabel: "Story", key: "T-2" },
    // OPEN, missing due + logged, has estimate → Maria open: n1 est1
    { assignee: "Maria Alvarez", resolved: null, due: null,
      estSec: 7200, spentSec: 0, status: "In Progress", typeLabel: "Task", key: "T-3" },
    // Open EPIC → epics are counted (matrix parity — open epics missing
    // estimates are the biggest lever)
    { assignee: "Ken Lim", resolved: null, due: d("2026-09-01"),
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Epic", isEpic: true, key: "T-4" },
    // Unattributed → in NO person bucket
    { assignee: "Stranger Danger", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Task", key: "T-5" },
    // ⚠️ UNASSIGNED sentinel → resolver gets it, returns null → excluded
    { assignee: "⚠️ UNASSIGNED", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "To Do", typeLabel: "Task", key: "T-6" },
    // Closed WITHOUT a resolution date → in NEITHER population (typeHygOpen_ rule)
    { assignee: "Ken Lim", resolved: null, due: null,
      estSec: 0, spentSec: 0, status: "Closed", typeLabel: "Task", key: "T-7" },
  ] };
  var ph = personHygieneBuckets_(jira, resolve);

  var mOpen = ph.open.filter(function (b) { return b.person === "Maria Alvarez"; })[0];
  assert_(mOpen && mOpen.n === 1 && mOpen.due === 0 && mOpen.est === 1 && mOpen.logged === 0,
          "Maria open bucket counts");
  var kOpen = ph.open.filter(function (b) { return b.person === "Ken Lim"; })[0];
  assert_(kOpen && kOpen.n === 1 && kOpen.due === 1 && kOpen.est === 0,
          "open epic counted for Ken (closed-no-resolution excluded)");
  assert_(ph.open.length === 2, "exactly two open persons — unattributed excluded");

  var mRes = ph.resolved.filter(function (b) { return b.person === "Maria Alvarez"; });
  assert_(mRes.length === 1 && mRes[0].iso === "2026.W31",
          "resolved bucketed by ISO week (both fell in W31)");
  assert_(mRes[0].n === 2 && mRes[0].due === 1 && mRes[0].est === 1 && mRes[0].logged === 1,
          "resolved counts: 2 issues, one filled");

  // PREDICATE PARITY with the matrix: the same fixture through
  // typeHygieneBuckets_ must count the same fills — the roster and the matrix
  // must never disagree about the same record. The matrix counts EVERY row
  // (attributed or not): its open population is the roster's 2 PLUS the
  // unattributed one and the ⚠️ UNASSIGNED sentinel = 4.
  var th = typeHygieneBuckets_(jira, resolve, "all");
  function sum_(rows, k) { return rows.reduce(function (s, r) { return s + (r[k] || 0); }, 0); }
  assert_(sum_(th.open, "n") === 4, "matrix open population = 4 (incl. unattributed + sentinel)");
  assert_(sum_(ph.open, "n") === 2, "roster open population = 2 (attributed only)");
  // Only Maria's open Task carries estSec>0; nothing open carries spentSec>0;
  // only Ken's open Epic carries a due date. Both passes agree on each.
  assert_(sum_(th.open, "est") === 1 && sum_(ph.open, "est") === 1, "est predicate parity");
  assert_(sum_(th.open, "time") === 0 && sum_(ph.open, "logged") === 0, "logged predicate parity");
  assert_(sum_(th.open, "due") === 1 && sum_(ph.open, "due") === 1, "due predicate parity");

  // ── LOGGED DENOMINATOR = STARTED WORK ONLY (user report 2026-08-06) ────────
  // Maria's open Task is In Progress → in the ratio. Ken's open Epic is To Do →
  // outside it, so Ken's Logged cell reads ungraded rather than 0%. That is the
  // whole fix at person grain: nobody is graded on a ticket they have not begun.
  assert_(mOpen.loggedN === 1, "Maria's STARTED open task is in the logged denominator");
  assert_(kOpen.loggedN === 0,
          "Ken's unstarted open epic is NOT — an unbegun ticket cannot be a logging failure");
  assert_(mRes[0].loggedN === mRes[0].n,
          "resolved: every record is expected to carry its cost — loggedN === n");
  // DENOMINATOR PARITY with the matrix, tested like the numerators above: the
  // two surfaces must agree on the population as well as on each record.
  assert_(sum_(th.open, "timeN") === 1 && sum_(ph.open, "loggedN") === 1,
          "matrix and roster measure the logged ratio over the SAME started population");

  // A To Do ticket carrying a worklog is excluded from BOTH halves. Left in the
  // numerator alone it would score 1/0 and render over 100% on a drifted board.
  var drift = personHygieneBuckets_({ issues: [
    { assignee: "Maria Alvarez", resolved: null, due: null, estSec: 0, spentSec: 3600,
      status: "To Do", typeLabel: "Task", key: "D-1" } ] }, resolve).open[0];
  assert_(drift.loggedN === 0 && drift.logged === 0,
          "logged time on an unstarted ticket is neither credit nor gap");
  // `wip` and the logged expectation now share dhStarted_. Pin that they move
  // together, or the roster could report 0 work in progress while grading the
  // same person's logged time over it.
  assert_(mOpen.wip === 1 && kOpen.wip === 0 && mOpen.wip === mOpen.loggedN,
          "wip and loggedN read the same 'started' predicate");
  Logger.log("✅ _test_personHygieneBuckets_ passed");
}

/**
 * Attrition exclusion (user decision 2026-08-04).
 *
 * The two failures that matter: a boomerang rehire wrongly treated as gone
 * (their live work vanishes from the report), and an unknown name treated as a
 * leaver (a genuine hygiene gap silently swallowed by a policy exclusion).
 */
function _test_leaverTest_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_leaverTest_: " + m); }
  var roster = {
    attrib: [{ name: "Maria Alvarez" }, { name: "Gone Person" },
             { name: "Boomer Ang" }, { name: "Ana Perez" }],
    activeAll: { "maria alvarez": 1, "boomer ang": 1, "ana perez": 1 },
    inactiveAll: { "gone person": 1, "boomer ang": 1 },
  };
  var isLeaver = leaverTest_(roster);

  assert_(isLeaver("Gone Person") === true, "an inactive row with no active row is a leaver");
  assert_(isLeaver("Maria Alvarez") === false, "an active person is not");
  // BOOMERANG: inactive AND active rows both exist — the active row wins, same
  // one-sided rule as filterActiveNames_. Getting this wrong deletes the live
  // work of someone who is sitting at their desk.
  assert_(isLeaver("Boomer Ang") === false, "a rehire is NOT a leaver — active row wins");
  // UNKNOWN ≠ GONE. A name the roster has never heard of is an unattributed
  // issue, which somebody owns; calling it attrition would let this policy
  // quietly absorb real data problems.
  assert_(isLeaver("Never Heard Of") === false, "an unknown name is a gap, not a leaver");
  assert_(isLeaver("") === false && isLeaver(null) === false,
          "unassigned is a gap, never attrition");
  assert_(isLeaver("⚠️ UNASSIGNED") === false, "the exporter sentinel is not a leaver");
  // Alias forms must be caught, or a leaver written "Last, First" walks back in.
  assert_(isLeaver("Person, Gone") === true, "comma-form leaver name still matches");
  assert_(isLeaver("PERSON GONE") === true, "…and 'Last First', case-insensitively");
  // No leavers at all → a cheap always-false test, not a crash.
  assert_(leaverTest_({ attrib: [], activeAll: {}, inactiveAll: {} })("Anyone") === false,
          "an all-active roster excludes nobody");
  assert_(leaverTest_({})("Anyone") === false, "a rosterless call is safe");
  Logger.log("✅ _test_leaverTest_ passed");
}

/** Jira Region vocabulary normalisation (§4.3) + the Unassigned bucket (§4.2). */
function _test_regionVocab_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionVocab_: " + m); }
  assert_(mapRegionToDh_("RR01 North America") === "AMER", "exact option value maps");
  // The verified live option list (read off Jira 2026-08-04). These are the
  // labels that actually exist — three of them used to map to the wrong
  // continent, which is invisible in the UI: a wrong chip still looks like data.
  assert_(mapRegionToDh_("RR02 Latin America") === "AMER", "RR02 is Latin America → AMER, not EMEA");
  assert_(mapRegionToDh_("RR03 Europe") === "EMEA", "RR03 is Europe → EMEA, not APAC");
  assert_(mapRegionToDh_("RR04 Australia") === "ANZ", "RR04 is Australia → ANZ");
  assert_(mapRegionToDh_("RR05 South East Asia") === "SEA", "RR05 → SEA (not APAC — APAC is a superset of ANZ+SEA, retired 2026-08-05)");
  assert_(mapRegionToDh_("RR08 Asia") === "SEA", "RR08 → SEA (4 issues site-wide; Asia hub = SEA)");
  assert_(mapRegionToDh_("RR09 Africa") === "EMEA", "RR09 Africa → EMEA");
  // RR07 is the most common tag on the site. It must survive as its own TOKEN:
  // folded into a geography it invents delivery presence, blanked it hides a
  // deliberate choice, and dropped to Other it is indistinguishable from a bug.
  // It is NOT a chip though (removed 2026-08-05) — chips filter people, and no
  // person can be "Global"; RR07 counts as tagged in hygiene and its work rolls
  // up under the assignee's geographic region.
  assert_(mapRegionToDh_("RR07 Global") === "Global", "RR07 → Global (own token)");
  assert_(mapRegionToDh_("Global") === "Global", "short form from the exporter passes through");
  assert_(mapRegionToDh_("global") === "Global", "…case-insensitively");
  assert_(CONFIG_DH.REGION_FALLBACK !== "Global", "Global is not the Other bucket");
  // Cross-region work (~3% of tagged issues) is NOT charged to its first half.
  assert_(mapRegionToDh_("AMER | SEA") === "Other", "compound region → Other, never one of its halves");
  assert_(mapRegionToDh_("AMER | APAC") === "Other", "legacy compound token → Other too");
  assert_(mapRegionToDh_("  rr02   EMEA  ") === "EMEA", "case + whitespace tolerated");
  assert_(mapRegionToDh_("RR02 Europe/Middle East/Africa") === "EMEA", "prefix match on a longer label");
  assert_(mapRegionToDh_("RR03 Asia Pacific") === "SEA", "asia pacific maps to SEA");
  assert_(mapRegionToDh_("RR04 Australia & New Zealand") === "ANZ", "anz maps");
  assert_(mapRegionToDh_("SEA") === "SEA", "a bare token already in the vocabulary passes through");
  assert_(mapRegionToDh_("APAC") === "SEA", "legacy bare APAC (pre-v3.8.0 sheet rows) reads as SEA");
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
      { name: "Maria Alvarez", keyLocation: "Malaysia", rosterBucket: "SEA", isCrew: false,
        jobFamily: "Service Delivery", tracks: true },
      { name: "Tom Baker", keyLocation: "Australia & New Zealand", rosterBucket: "ANZ", isCrew: false,
        jobFamily: "", tracks: true,                // uncatalogued (crew-like) — stays in
        jobTitle: "07.M5.1 - Manager, Service Delivery", // M-level → isManager
        onLeave: true, leaveStatus: "Paternity Leave" }, // long leave — 🏖 not zeros
      { name: "Nina New", keyLocation: "Malaysia", rosterBucket: "SEA", isCrew: false,
        jobFamily: "Service Delivery", tracks: true,
        jobTitle: "09.I1.1 - Associate Consultant", // I1 → intern flag
        hireDate: new Date(2026, 6, 15) },          // hired mid-window (ISO 2026.W29)
      { name: "Zoe Ops", keyLocation: "Malaysia", rosterBucket: "SEA", isCrew: false,
        jobFamily: "Operations", tracks: false },   // non-tracking family — dropped entirely
    ] },
    capacity: { byName: { "maria alvarez": { "2026.W31": 40, "2026.W30": 40 } } }, // Tom missing → fallback
    tracked: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W30": 20, "2026.W31": 8 } },
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "NETSUITE-TIMEOFF", pm: "Ghost PM",
        weekHours: { "2026.W31": 8 } },  // tracked time-off → non-billable by rule; PM ignored
    ] },
    planned: { rows: [
      { user: "Maria Alvarez", teamCell: "Team A | Team B", key: "ACME-1", pm: "Pat Manager",
        weekHours: { "2026.W31": 30 } },
      { user: "Maria Alvarez", teamCell: "", key: "NETSUITE-TIMEOFF",
        weekHours: { "2026.W31": 8 } },  // planned time-off → dropped (plans no project work)
    ] },
    ns: { rows: [
      { name: "Alvarez, Maria", date: new Date(2026, 6, 27), billable: 6, nonBillable: 2 },
      { name: "Alvarez, Maria", date: new Date(2026, 6, 20), billable: 5, nonBillable: 3 }, // Mon W30
    ] },
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
                      status: "In Progress", priority: "High", due: null, remHrs: 5 } ],
      // The export's own "Generated:" footer, parsed by readJiraRaw_. Fixed 7h
      // back so the freshness assertions below don't drift with wall-clock time.
      exportedAt: new Date(Date.now() - 7 * 3600 * 1000).toISOString() },
    // 🌊 Flow feeds absent in this fixture (export predates Jira Backlog.js
    // v3.9.0) — assembleModel_ must read inputs.bugs/inputs.flowSnaps
    // unconditionally (readJiraBugs_/readFlowSnapshots_ always return this
    // shape even when the tab is missing), so a fixture without these keys
    // would crash rather than degrade.
    bugs: { bugs: [], available: false },
    flowSnaps: { snaps: [], available: false },
  };
  var m = assembleModel_(inputs, win);
  assert_(!m.error, "no fatal error");
  assert_(m.schemaVer === DH_SCHEMA_VER_, "payload stamped with the current schema version");
  // ── Export freshness (v16) ──
  // meta.generatedAt is the model rebuild; meta.dataAsOf is the DATA. The header
  // reports the second, so the payload has to carry it separately — a cached
  // model whose generatedAt is minutes old can still sit on a week-old export.
  var da = m.meta.dataAsOf;
  assert_(da && da.jira === inputs.jira.exportedAt, "the export stamp reaches the payload verbatim");
  assert_(Math.abs(da.jiraAgeH - 7) < 0.2, "age computed server-side, in hours");
  assert_(da.jiraStale === false, "7h is inside the " + CONFIG_DH.JIRA_EXPORT_STALE_H + "h window");
  assert_(da.jiraUnknown === false, "a parsed stamp is not 'unknown'");
  assert_(m.meta.jiraExportStaleH === CONFIG_DH.JIRA_EXPORT_STALE_H,
          "the staleness threshold ships so the client never re-types it");
  assert_(m.meta.generatedAt !== da.jira, "the two clocks are distinct fields, not aliases");
  // No stamp + an available feed = UNKNOWN, never stale. A warning a reader
  // cannot act on trains them to ignore the one that matters.
  var noStamp = assembleModel_(
    Object.assign({}, inputs, { jira: Object.assign({}, inputs.jira, { exportedAt: null }) }), win);
  assert_(noStamp.meta.dataAsOf.jiraUnknown === true && noStamp.meta.dataAsOf.jiraStale === false,
          "a missing stamp reads as unknown, not as stale");
  // Feed unavailable entirely → not even "unknown": there is no export to age.
  var noJira = assembleModel_(
    Object.assign({}, inputs, { jira: { available: false, issues: [], epics: [], openIssues: [], keyRegion: {} } }), win);
  assert_(noJira.meta.dataAsOf.jiraUnknown === false,
          "no Jira feed at all → no freshness claim of any kind");
  assert_(m.people.length === 3 && m.people[0].name === "Maria Alvarez", "alphabetical people");
  var maria = m.people[0], w31 = maria.weeks["2026.W31"];
  // NO-ABSENTEEISM MODEL (2026-08-04): capacity is gross — avail === cap.
  assert_(w31.cap === 40 && w31.avail === 40, "gross capacity, nothing netted for absence");
  assert_(w31.tracked === 16 && w31.trackedOff === 8 && w31.planned === 30,
          "tracked time-off counts IN tracked; planned time-off dropped");
  // ── Ratio classification (audit 2026-08-03) ──
  // W31: NS 6b/2nb = 8h total classifies the 8h of PROJECT-tracked time
  // (share 0.75 → 6b/2nb); the 8h of tracked time off is non-billable BY RULE
  // (it cannot be charged to a customer project), so non-billable = 2 + 8.
  assert_(w31.nsCov === true && w31.billShare === 0.75, "NS joined via comma-name alias → 75% billable share");
  assert_(w31.billable === 6, "share applied to project-tracked: 8h × 0.75");
  assert_(w31.nonBillable === 10, "NS non-billable 2h + tracked time-off 8h");
  assert_(Math.abs(w31.billable + w31.nonBillable - w31.tracked) < 1e-9,
          "INVARIANT: billable + nonBillable === tracked");
  assert_(w31.trackedCov === 16, "time-off hours are CLASSIFIED (by rule), never 'unclassified'");
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
  assert_(cov.classifiedHours === 36 && cov.trackedHours === 36,
          "classified vs total tracked hours (time-off classified by rule)");
  assert_(cov.gapHours === 12,
          "reconciliation gap = |NS 8h − project-tracked 20h| in W30; time-off never in the gap");
  var mUn = assembleModel_(Object.assign({}, inputs, { ns: { rows: inputs.ns.rows.concat(
    [{ name: "Ghost Employee", date: new Date(2026, 6, 27), billable: 9, nonBillable: 1 }]) } }), win);
  assert_(mUn.meta.nsCoverage.unmatchedRows === 1 && mUn.meta.nsCoverage.unmatchedHours === 10 &&
          mUn.meta.nsCoverage.unmatchedNames[0] === "Ghost Employee",
          "unresolved NS employee reported, not silently dropped");
  assert_(w30.avail === 40 && w30.trackedOff === 0, "no absence deduction in any week");
  assert_(m.meta.ptoSource === undefined, "no PTO source in meta — absence is not modelled");
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
  assert_(nina.isIntern === true && maria.isIntern === false,
          "I1 title → isIntern shipped; everyone else stays false");
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
  assert_(m.meta.sources.length >= 5, "source systems listed for the data-provenance line (Jira Bugs/Flow Snapshots row added v21)");
  assert_(m.meta.jiraUnattributed.onTime === 1 && m.meta.jiraUnattributed.forecast === 0,
          "non-roster assignee tallied as unattributed");
  // ── 🌊 Flow metrics wiring (v21) ── same two fixture issues (Maria attributed
  // via alias, Random Dev not) drive leadTime/throughput; neither carries a
  // `created` date or a non-zero estimate, and neither is open, so the buckets
  // exist but score nothing measurable — exactly what a partially-filled export
  // should show, not an error.
  assert_(m.leadTimeBuckets.length === 1 && m.leadTimeBuckets[0].person === "Maria Alvarez" &&
          m.leadTimeBuckets[0].nAll === 1 && m.leadTimeBuckets[0].n === 0,
          "leadTime bucketed and person-attributed; no created date → measured n=0");
  assert_(m.throughputBuckets.length === 1 && m.throughputBuckets[0].person === "Maria Alvarez" &&
          m.throughputBuckets[0].nAll === 1 && m.throughputBuckets[0].estHrs === 0,
          "throughput bucketed; zero estimate → estHrs=0, still counted in nAll");
  assert_(m.flowOpenBuckets.length === 0,
          "both fixture issues are resolved → nothing open, no WIP/backlog bucket");
  assert_(m.meta.jiraUnattributed.leadTime === 1 && m.meta.jiraUnattributed.throughput === 1 &&
          m.meta.jiraUnattributed.flowOpen === 0,
          "Random Dev is unattributed for the flow metrics too, same roster join as onTime/forecast");
  assert_(m.meta.flowUncategorized === 0, "no open issues in the fixture → nothing uncategorized either");
  assert_(m.bugWeekly.length === 0, "no bugs in the fixture → empty weekly tally, not an error");
  assert_(m.meta.bugsAvailable === false && m.meta.flowSnapshotsAvailable === false,
          "absent flow tabs are reported as absent, never as an error or a silent zero");
  assert_(Array.isArray(m.meta.flowSnapshots) && m.meta.flowSnapshots.length === 0,
          "no Flow Snapshots tab → empty trend array shipped, client can render 'no history yet'");
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
              attrib: [{ name: "Carlos Crew", rosterBucket: "SEA", isCrew: true,
                         jobFamily: "", jobTitle: "", hireDate: null }] },
    jira: Object.assign({}, inputs.jira, {
      issues: inputs.jira.issues.concat([
        { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
          assignee: "Crew, Carlos", estSec: 0, spentSec: 0, isClientCommitment: true }]) }),
  }), win);
  var carlos = m6.people.filter(function (x) { return x.name === "Carlos Crew"; })[0];
  assert_(!!carlos && carlos.attribOnly === true && Object.keys(carlos.weeks).length === 0,
          "contractor referenced by an issue → weeks-less attribOnly stub");
  assert_(carlos.region === "SEA" && carlos.isCrew === true,
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

  // ── ATTRITION LEAVES EVERY RATE (v18, user decision 2026-08-04) ──
  // End-to-end, because the exclusion is applied once in assembleModel_ and the
  // whole point is that no bucket function has to remember it.
  var m7 = assembleModel_(Object.assign({}, inputs, {
    roster: { people: inputs.roster.people,
              attrib: [{ name: "Departed Dev", rosterBucket: "SEA", isCrew: false,
                         jobFamily: "Service Delivery", jobTitle: "", hireDate: null }],
              activeAll: { "maria alvarez": 1 },
              inactiveAll: { "departed dev": 1 } },
    jira: Object.assign({}, inputs.jira, {
      issues: inputs.jira.issues.concat([
        // Resolved LATE by someone who has since left. If it counted, it would
        // drag the live team's On-Time rate down for a person nobody can coach.
        { due: new Date(2026, 6, 20), resolved: new Date(2026, 6, 28),
          assignee: "Departed Dev", estSec: 0, spentSec: 0, isClientCommitment: true }]) }),
  }), win);
  assert_(m7.meta.leaverExcluded.issues === 1, "the leaver's issue is counted as excluded");
  assert_(!m7.onTimeBuckets.some(function (b) { return b.person === "Departed Dev"; }),
          "…and never reaches a metric bucket");
  var hyg7 = m7.hygieneBuckets.filter(function (h) { return h.iso === "2026.W31"; })[0];
  assert_(hyg7.res === 2, "the leaver's issue leaves the hygiene DENOMINATOR too — " +
          "excluded work must not read as a coverage failure");
  assert_(m7.meta.jiraUnattributed.onTime === 1,
          "attrition is NOT counted as unattributed — that would make a policy look like a gap");
  assert_(!m7.people.some(function (x) { return x.name === "Departed Dev"; }),
          "no attribOnly stub for someone excluded from every rate");
  // A rehire must survive all of this: active row present → still counted.
  var m8 = assembleModel_(Object.assign({}, inputs, {
    roster: { people: inputs.roster.people,
              attrib: [{ name: "Departed Dev", rosterBucket: "SEA", isCrew: false,
                         jobFamily: "Service Delivery", jobTitle: "", hireDate: null }],
              activeAll: { "maria alvarez": 1, "departed dev": 1 },
              inactiveAll: { "departed dev": 1 } },
    jira: Object.assign({}, inputs.jira, {
      issues: inputs.jira.issues.concat([
        { due: new Date(2026, 6, 28), resolved: new Date(2026, 6, 28),
          assignee: "Departed Dev", estSec: 0, spentSec: 0, isClientCommitment: true }]) }),
  }), win);
  assert_(m8.meta.leaverExcluded.issues === 0 &&
          m8.onTimeBuckets.some(function (b) { return b.person === "Departed Dev"; }),
          "a BOOMERANG rehire keeps counting — an active row beats an inactive one");
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
  // Intern flag (user decision 2026-08-04): I1 exactly — never I10+, never M1.
  assert_(dhIsIntern_("09.I1.2 - Associate Consultant") === true, "I1 title → intern");
  assert_(dhIsIntern_("09.I10.1 - Principal Consultant") === false, "I10 is not I1");
  assert_(dhIsIntern_("07.M1.1 - Team Lead") === false, "M1 is a manager level, not an intern");
  assert_(dhIsIntern_("") === false && dhIsIntern_(null) === false, "blank/null → not intern");
  Logger.log("✅ _test_levelTrack_ passed");
}

