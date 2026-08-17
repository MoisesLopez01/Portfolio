// ============================================================
// SCRIPT NAME: Delivery Health Dashboard (4-tile: Utilization,
//              On-Time Delivery, Forecast Accuracy, Rework-placeholder)
// PURPOSE:     Standalone GAS web app. Reads Tempo/NS/Jira tabs +
//              Roster by spreadsheet ID, builds one person×week +
//              Jira-bucket model, serves Dashboard.html.
// ACCESS:      Email allowlist — see Security.js (checkDeliveryAccess()).
// SPEC:        delivery-health-dashboard/docs/specs/2026-07-31-delivery-health-dashboard-design.md
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
  CLEAR_RATE_WEEKS:  8,   // trailing window for the weeks-to-clear denominator
  CLEAR_RATE_MIN_N:  5,   // below this it publishes nothing — same bar as STD_MIN_PERIODS
  WALKBACK_MAX_WEEKS: 26,  // reconstruction horizon — matches OPEN_BACKLOG_UPDATED_WEEKS upstream
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
  // ── Jira deep links (2026-08-10) ──
  // Every key this dashboard shows is a real ticket somebody wants to open. The
  // base is CONFIG, not a literal in the renderer: a second Jira site (or a
  // sandbox) is a Script Property away, and a hardcoded host in the HTML would
  // send a manager to the wrong instance with no way to tell.
  // Override: PropertiesService.getScriptProperties().setProperty('DH_JIRA_BASE', '…')
  JIRA_BASE_URL: "https://servicerocket-coe.atlassian.net",

  BACKLOG_MAX_ITEMS: 8,   // issues shown per person when the detail row first opens
  // Second-level expand (manager request 2026-08-10: "in case the manager wants
  // to see all tickets, not only 8"). The PAYLOAD carries up to this many so the
  // ▾ Show all is instant and needs no round-trip; 8 stays the opening view
  // because a 60-row table inside a roster row buries the signal it sits under.
  // Not unbounded on purpose — one pathological assignee would otherwise dominate
  // a payload that is gzipped, chunked and cached, and the row states plainly
  // when it clipped (totals always cover ALL of the person's open work).
  BACKLOG_MAX_ITEMS_ALL: 60,

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
  version: "4.1",
  updated: "2026-08-17",  // 2026.W34

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
      // SAMPLE FLOOR (Task 6, sampleFloorFor_ — spec §4.4), separate instrument
      // from the coverage gate above: a share computed over one or two resolved
      // commitments is not a rate, no matter how much of the population is
      // visible. Same bar as the other rate metrics' floors.
      sampleFloor: 5,
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
      // SAMPLE FLOOR (Task 6, sampleFloorFor_), separate instrument from the
      // coverage gate above: a mean over one or two closed epics is not a mean,
      // no matter how much of the population is visible. Same bar as
      // CLEAR_RATE_MIN_N / the other rate metrics' floors.
      sampleFloor: 5,
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
      // SAMPLE FLOOR (Task 6, sampleFloorFor_ — spec §4.4). `n` here is a
      // different kind of quantity than it is for a per-record rate (util is a
      // ratio over HOURS, not over a count of records) — Task 16's
      // metricSampleN_ decides per metric what n even means, returning null
      // where a metric has no sample notion. The floor still belongs on the
      // registry entry; it is sampleFloorFor_'s caller's job to feed it a
      // meaningful n, not this entry's.
      sampleFloor: 5,
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
      // SAMPLE FLOOR (Task 6, sampleFloorFor_ — spec §4.4 calls this metric
      // "rework"; the registry id is quality, and the id is what binds). A
      // rework rate over one or two delivered issues is not a rate.
      sampleFloor: 5,
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
      // SAMPLE FLOOR (Task 6, sampleFloorFor_ — spec §4.4), separate instrument
      // from the coverage gate above: a median over one or two resolved issues
      // is not a median.
      sampleFloor: 5,
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

    // ── Queue metrics (spec 2026-08-06, Executive newspaper) ──
    // All three ship target: null (D11). Nobody owns a ≤4w or ≤0 bar, and an
    // unratified target on the C-suite headline reads as agreed the moment it is
    // on screen — it would be the number a board pack quotes. target: null is an
    // established convention here, not a special case: neutral colour, no RAG
    // verdict, no target rule drawn on any chart, neutral delta arrows, and
    // grading against the operating norm from standardRate_ only.
    queueCover: {
      id: "queueCover",
      name: "Weeks to Clear",
      definition: "Open inventory divided by the median weekly clearing rate — how long the current queue would take to drain at the rate the organisation has actually been clearing.",
      formula: "(assigned open + unassigned open) ÷ median(resolved per week, last 8 complete weeks)",
      sources: ["Jira Raw — Status Category, Resolution Date, Assignee",
                "Jira Arrivals — Resolved per week"],
      grain: "snapshot ÷ trailing rate",
      unit: "weeks",
      target: null,
      dir: "down",
      coverageGate: 0,
      coverageOf: "n/a — a ratio of the whole open queue to the whole trailing clearing rate; neither side is a per-record attribute gate",
      sampleFloor: 5,
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once agreed)",
      ebitda: "Not yet established: weeks of queue depth plausibly translates to cost of delay (SLA risk, client patience), but there is no agreed cost-of-delay rate to quantify it — same PR-06 rate-basis gap as the other metrics, stated rather than guessed.",
      deviations: [
        "The trailing basis is a MEDIAN of 8 complete weeks, not last week's rate. Measured 2026-08-06: W31 cleared 204 against an 8-week mean of 297, so a one-week denominator read 16.1 weeks where the trailing basis reads 11.0.",
        "History behind the current week is RECONSTRUCTED by walking weekly deltas back from the measured present, capped at 26 weeks. It assumes nothing was deleted or moved out of scope, and the anchor carries the export's updated>=-26w bound while the deltas do not, so drift grows with distance from today.",
        "The unassigned half is bounded by OPEN_BACKLOG_UPDATED_WEEKS (26), so genuinely abandoned tickets are excluded. The figure is a FLOOR on dead inventory, not the whole of it.",
        "No target has been agreed. The metric is graded against its own operating norm only.",
      ],
    },
    // ── Workforce Health (spec v1.1, 2026-08-10) ────────────────────────────
    // All five ship target: null, same rule as the queue metrics (D11). The
    // POOLS envelopes are Workforce Planning's PROPOSAL, not a ratified
    // operating target — and an unratified number on a C-suite surface reads as
    // agreed the moment it is on screen. Grading is against each pool's own
    // envelope, shown as an action state, never as a RAG verdict on a target.
    poolHeadroom: {
      id: "poolHeadroom",
      name: "Sellable Headroom",
      definition: "Scheduled capacity a pool has left after everything it is already committed to — the hours Sales could actually sell, within one pool at one level band.",
      formula: "(gross scheduled capacity − planned hours) ÷ gross scheduled capacity, per pool × band",
      sources: ["Capacity Tempo — scheduled hours per person per week",
                "Planned Time Tempo — planned hours per person per week",
                "Roster — Job Title (job code → pool, band)"],
      grain: "pool × band × period",
      unit: "%",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "n/a — capacity and plan are both whole-population sums within the pool, not per-record attribute fills",
      sampleFloor: null,
      owner: "Workforce Planning",
      paramOwner: "Services Director (pool envelopes, once agreed)",
      ebitda: "Headroom is unsold capacity: hours × blended bill rate is revenue foregone if it stays idle, or cost avoided if it absorbs backlog. Not quantified — same PR-06 rate-basis gap as every other metric here.",
      deviations: [
        "BENCH IS NOT SUBTRACTED. Bench is the RESULT of capacity minus commitment, not an input to it. Subtracting it would make headroom read ≈0 always, which is the exact failure this model exists to avoid.",
        "PTO IS NOT SUBTRACTED and capacity truth is NOT MEASURED. The spec nets absence out of capacity; there is no absence feed here, only Tempo-tracked time off, which measures what people LOGGED rather than when they were away — subtracting it would make the best-tracking teams look least available. Capacity is gross scheduled hours (user decision 2026-08-10, upholding 2026-08-04).",
        "NEVER PUBLISHED AS A SINGLE BLENDED NUMBER. A company-wide availability figure averages people who cannot do each other's work; the consumers-only figure is the honest version and always ships with its denominator.",
        "Managers (M-track in families 07/09/18) are GOVERNORS and hold no pool, so they are outside every pool denominator (2026-08-10). This moved every capacity rate on deploy — see the 4.0 changeLog entry.",
      ],
    },
    commitmentFidelity: {
      id: "commitmentFidelity",
      name: "Commitment Fidelity",
      definition: "Share of what a pool was committed to that it actually delivered — how far the plan and reality have drifted apart.",
      formula: "tracked hours on committed epics ÷ planned hours, per pool × band",
      sources: ["Planned Time Tempo — Issue, planned hours",
                "Tempo Tracked Time — Issue / Epic Key / Parent Key, logged hours",
                "Jira Raw — Components (SRSO binding), Epic Key"],
      grain: "pool × band × period",
      unit: "%",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "share of planned hours that name an issue and so can be resolved to an epic — reported as planIssueCoverage",
      sampleFloor: null,
      owner: "Resource Management",
      paramOwner: "Services Director (floor, once agreed)",
      ebitda: "The execution gap is allocated-but-undelivered labour: gap hours × cost rate is capacity paid for and not converted. Not quantified (PR-06).",
      deviations: [
        "COMMITMENT IS PER POOL, not global. An engineer working a consulting epic that only the consulting pool was staffed onto counts as not-committed, because that is a staffing decision somebody needs to see — not planned work.",
        "PROJECT-LEVEL PLANS NAME NO EPIC. The Planned export carries an Issue only for issue-level plans, so the committed set is a LOWER BOUND and planIssueCoverage states how much of the planned volume could be resolved at all.",
        "NULL, NOT ZERO, when every tracked hour in a cell was unclassifiable. A raw 0% would fire INTERVENE at a team that may have delivered everything — it was the measurement that was missing, not the work.",
        "Generic (unnamed placeholder) allocations are NOT MEASURED: the Planned export resolves every plan to a named user before writing a row, so a pool running on unstaffed placeholders is currently invisible. Needs an exporter change.",
      ],
    },
    shadowWork: {
      id: "shadowWork",
      name: "Shadow Work",
      definition: "Share of logged hours that cannot be traced to a committed, sales-order-bound epic — real demand that planning cannot see.",
      formula: "shadow hours ÷ (tracked hours − unmeasurable hours), per pool × band; shadow splits into no-epic, no-srso and not-committed",
      sources: ["Tempo Tracked Time — Issue / Epic Key / Parent Key",
                "Jira Raw — Epic Key, Parent Key, Components"],
      grain: "pool × band × period",
      unit: "%",
      target: null,
      dir: "down",
      coverageGate: 0,
      coverageOf: "share of tracked hours that could be classified at all — hours on an export with no Epic Key or Components column are unmeasurable, not shadow",
      sampleFloor: null,
      owner: "Delivery leadership",
      paramOwner: "Services Director (ceiling, once agreed)",
      ebitda: "Shadow work is unrecognised delivery: hours worked against no sales order cannot be recognised against a milestone. Hours × rate is the exposure. Not quantified (PR-06).",
      deviations: [
        "SPLIT BY REASON, NEVER SUMMED INTO ONE NUMBER. no-epic (Project Manager), no-srso (PM + Finance) and not-committed (Resource Manager) are three problems with three owners and three fixes — reported as one figure they get routed to a desk with nothing to do, the same failure the assignee/roster split already fixed.",
        "UNMEASURABLE HOURS ARE EXCLUDED FROM THE DENOMINATOR. On an export missing the Epic Key or Components column the ratio would otherwise read ~100% and send the whole delivery org chasing a reporting artefact — the single named trap in the source spec.",
        "SRSO binding is read from the COMPONENT field (runbook B2.6), not from Fix Versions. Work bound exactly as the runbook instructs but carrying no SRSO fix version is correctly counted as bound here, and still exports as 'Untagged' upstream.",
        "Tracked time off (NETSUITE rows) is excluded from both sides — it is not project work, and counting it as shadow would make PTO look like invisible demand.",
      ],
    },
    poolCover: {
      id: "poolCover",
      name: "Cover by Pool",
      definition: "Weeks of remaining backlog a pool is carrying at its own weekly capacity — how long that pool could work without new sales.",
      formula: "estimate-adjusted remaining backlog hours ÷ (pool weekly capacity), per pool; null for demand-driven pools",
      sources: ["Jira Raw — Original Estimate, Time Spent, Status Category",
                "Capacity Tempo — scheduled hours", "Tempo Tracked Time — Epic Key (routing history)"],
      grain: "pool × period",
      unit: "weeks",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "estimate coverage — share of a pool's open epics carrying an original estimate; the raw hours figure is a lower bound below 100%",
      sampleFloor: null,
      owner: "Workforce Planning",
      paramOwner: "Services Director (pool cover targets, once agreed)",
      ebitda: "Cover below floor is a sales problem and above target a delivery-capacity problem; both translate to revenue timing rather than to a cost line. Not quantified (PR-06).",
      deviations: [
        "NULL FOR DEMAND-DRIVEN POOLS (MS-SUPPORT, PMO), rendered n/a and never 0. Their work arrives as tickets, not as a plannable backlog; a zero would imply 'no work left' for a pool that has no backlog BY DESIGN.",
        "REMAINING IS A PROXY: the export carries Original Estimate and Time Spent but not Jira's remaining estimate, so remaining = max(0, original − spent). An epic that overran reads 0 remaining while real work is left, making the raw figure a lower bound twice over.",
        "GROSSED UP BY ESTIMATE COVERAGE. At ~78% coverage the raw remaining-hours figure understates the real obligation by roughly a fifth. Both numbers ship and the raw one is labelled a lower bound.",
        "ROUTING IS HISTORICAL, not declared. No requiredPool custom field and no allocationType field exist, so an epic routes to whichever pool logged the most hours to it. An epic nobody has touched routes to UNROUTED and is shown as its own bar — never distributed across the pools.",
      ],
    },
    poolConstraint: {
      id: "poolConstraint",
      name: "Constraint Index",
      definition: "A pool's cover against the portfolio median — which pool everybody else's plan is queuing behind.",
      formula: "pool cover weeks ÷ median(cover weeks across pools that carry backlog)",
      sources: ["derived from Cover by Pool"],
      grain: "pool × period",
      unit: "ratio",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "n/a — a ratio of one pool's cover to the median of the same measure",
      sampleFloor: null,
      owner: "Workforce Planning",
      paramOwner: "Services Director",
      ebitda: "The bottleneck pool sets portfolio throughput, so its constraint is the binding limit on delivered revenue. Not quantified (PR-06).",
      deviations: [
        "RELATIVE, NOT ABSOLUTE. Every pool can be under-covered and the index will still show one of them near 1.0 — it says who is tightest, never whether the portfolio is healthy. Read it beside Cover, never instead of it.",
        "Null for demand-driven pools, which carry no cover to compare.",
        "The median is taken across the pools present in THIS population, so it moves when a pool enters or leaves scope.",
      ],
    },
    netFlow: {
      id: "netFlow",
      name: "Net Flow",
      definition: "Items arriving minus items cleared, per week, org-wide — whether the queue is growing or draining.",
      formula: "created per week − resolved per week (both counted over every issue, no assignee join)",
      sources: ["Jira Arrivals — Created, Resolved"],
      grain: "week",
      unit: "items",
      target: null,
      dir: "down",
      coverageGate: 0,
      coverageOf: "n/a — a count has no coverage denominator",
      sampleFloor: null,   // a COUNT: never floored
      owner: "Delivery leadership",
      paramOwner: "Services Director (target, once agreed)",
      ebitda: "No direct translation — Net Flow is a flow-control signal (is the queue growing or draining), not a cost line, same reasoning as WIP.",
      deviations: [
        "Counted org-wide with no assignee join on either half. Person-keyed arrivals under-report the newest weeks — an issue filed unassigned only counts once somebody picks it up — so a growing queue could read as flat exactly when it matters most. Same reasoning as the Bug Count feed.",
        "Probe figures include R&D projects because JQL cannot reproduce getSpaceForIssue_; the exported series excludes them and reads slightly lower.",
        "No target has been agreed.",
      ],
    },
    workforceChange: {
      id: "workforceChange",
      name: "Workforce Change",
      definition: "Scheduled delivery capacity gained from people who joined and lost from people who left, in hours per week, over the period.",
      formula: "Σ typical weekly scheduled capacity of joiners (hire date in period) − Σ typical weekly scheduled capacity of leavers (termination date in period). 'Typical' = median of that person's non-zero scheduled weeks in the 8 weeks after joining / before leaving.",
      sources: ["Roster — Hire Date, Termination/Release Date, Employee Status", "Capacity Tempo — scheduled hours per person per week"],
      grain: "period",
      unit: "hrs",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "n/a — a count of roster events, not an attribute fill rate. People whose capacity is unknown are reported separately rather than counted as zero hours.",
      sampleFloor: null,   // a COUNT of movements: never floored
      owner: "Delivery leadership",
      paramOwner: "n/a — no threshold to set",
      ebitda: "The clearest cost line on this dashboard, and deliberately NOT quantified here: hours × a blended rate needs PR-06, and a headcount number carrying an invented money figure is worse than one carrying none.",
      deviations: [
        "Capacity, not delivered work. It says what the team can no longer staff, not what stopped being delivered — a leaver's final weeks are usually low-tracking (notice, handover), so a delivered-hours reading would understate every departure.",
        "Median of the surrounding non-zero weeks, not the last week: the final week before a departure and the first after a hire are nearly always partial.",
        "Attrition is one-sided, same rule as every other roster join here — a person counts as gone only when the roster proves it (an inactive row and no active row anywhere), so a boomerang rehire is never a departure.",
        "Counts and hours ONLY. Who joined or left is never published; this is a capacity measure, not a personnel record.",
        "A new joiner's capacity is scheduled from their hire week, but ramp-up means it is not yet fully productive. The ramping count is stated beside the number rather than discounted from it — the discount would be a guess.",
        "No target has been agreed, and none is meaningful: net zero is not automatically good.",
      ],
    },
    clearedPerHead: {
      id: "clearedPerHead",
      name: "Cleared per Person",
      definition: "Items cleared per person per week within a comparison group — throughput normalised for group size.",
      formula: "items resolved in period ÷ people in the group ÷ weeks in period",
      sources: ["Jira Raw — Resolution Date, Assignee", "Roster — headcount"],
      grain: "group × period",
      unit: "items",
      target: null,
      dir: "up",
      coverageGate: 0,
      coverageOf: "n/a — a ratio of resolved count to comparison-group headcount; neither side is a per-record attribute gate",
      sampleFloor: 5,
      owner: "Delivery leadership",
      paramOwner: "Services Director",
      ebitda: "Cleared-per-head × blended rate approximates delivered value normalised for group size. Not quantified — no rate basis (PR-06).",
      deviations: [
        "Replaces absolute cleared counts in the comparison grid. Grading absolute throughput against a flat target ranked groups by headcount: 8 people clearing 12 items scored a miss while 63 people clearing 61 scored a pass.",
        "No target has been agreed. Graded against the operating norm only.",
      ],
    },
    inventory: { id: "inventory", name: "Open Inventory", definition: "Open non-epic issues, assigned plus unassigned.",
      formula: "count of open non-epic issues", sources: ["Jira Raw"], grain: "snapshot", unit: "items",
      target: null, dir: "down", coverageGate: 0,
      coverageOf: "n/a — a count has no coverage denominator", sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director",
      ebitda: "No direct translation — Open Inventory is a flow-control signal (queue depth), not a cost line; see Backlog (hours) for the EBITDA-linked view of open work.",
      deviations: [] },
    arrived: { id: "arrived", name: "Arrived", definition: "Issues created in the period, org-wide.",
      formula: "count of issues created in period", sources: ["Jira Arrivals — Created"],
      grain: "week", unit: "items", target: null, dir: "down", coverageGate: 0,
      coverageOf: "n/a — a count has no coverage denominator", sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director",
      ebitda: "No direct translation — Arrived is a flow-control signal (demand entering the system), not a cost line.",
      deviations: [] },
    cleared: { id: "cleared", name: "Cleared", definition: "Issues resolved in the period.",
      formula: "count of issues resolved in period", sources: ["Jira Raw — Resolution Date"],
      grain: "week", unit: "items", target: null, dir: "up", coverageGate: 0,
      coverageOf: "n/a — a count has no coverage denominator", sampleFloor: null,
      owner: "Delivery leadership", paramOwner: "Services Director",
      ebitda: "No direct translation — Cleared is a flow-control signal (work leaving the system), not a cost line.",
      deviations: [] },
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
    // POPULATION-WIDENING change, not a definition change: no metric in
    // `metrics` is redefined, and queueCover/netFlow/inventory are NEW metrics
    // shipping in the same release (same rule as the 3.0 Flow entry — a metric
    // with no prior value cannot be marked as having moved). `affects` is empty
    // on purpose even though the 🧬 matrix's open half and the gaps queue DO
    // drop on deploy, deliberately — that is a population getting bigger, not a
    // trend line stepping on a changed formula, so the `✎ definition changed`
    // marker is the wrong tool for it. This entry is the dated note instead.
    // ⚠ THE ONE ENTRY IN THIS LOG WHERE PUBLISHED NUMBERS MOVE DOWNWARD ON
    // PURPOSE. Two changes ship together and both are definition changes:
    //
    //   1. POOL SEPARATION. Capacity was published as ONE blended figure across
    //      JF007 (Managed Services & Support) and JF009 (Service Delivery).
    //      Support capacity is contracted and recurring — it is never drawn from
    //      the project backlog — so blending it made the org read as far more
    //      available than it is, and mathematically hid whichever pool was
    //      actually out of room. Every capacity reading is now per pool × band.
    //   2. MGMT_GOVERNS. M-track people in families 07/09/18 are GOVERNORS and
    //      hold no pool, so they leave every pool denominator. Before this, a
    //      delivery manager's scheduled hours read as consultant capacity that
    //      Sales could theoretically sell.
    //
    // `affects` names every rate whose COMPUTED VALUE moves, so each of their
    // trend lines carries the "✎ definition changed" marker at this date. The
    // step people will see in W33 is the definition moving, not delivery moving
    // — which is exactly what that marker exists to say.
    //
    // The source spec's §9 asks for a dual-publish phase before cut-over, on the
    // grounds that the new numbers look worse and that needs explaining before
    // it needs defending. The user directed a straight cut-over (2026-08-10),
    // with the trade stated. The blended prior reading is kept on screen as the
    // pool grid's own footnote so the "why did this drop" answer is on the page
    // rather than in a meeting — the dual read without the dual phase.
    // REMOVAL entry. Two surfaces leave the product and one check stops being
    // published; NO metric in `metrics` is redefined and no computed value
    // moves, so `affects` is empty and no trend line gets a `✎ definition
    // changed` marker. This entry is the dated note instead — a reader who
    // comes looking for the 🧬 matrix in three months needs to find out here
    // that it was retired on purpose, not assume it broke.
    { version: "4.1", date: "2026-08-17", author: "Alex López",
      affects: [],
      change: "The 🧬 field-fill-by-issue-type matrix and the roster-join check are REMOVED (user decision 2026-08-17): both summarised compliance per evaluated parameter, and the 👥 signals roster already reads the same parameters per rocketeer — which names somebody who can act, where a per-type or org-wide percentage names nobody. Gone: `typeHygiene` from the payload, `typeHygieneBuckets_` / `TYPE_HYG_FIELDS_` / `TYPE_HYG_MAX_KEYS_` from the server, `hygieneBuckets[].resAttr`, the gaps queue's '…and that assignee resolves to a roster person' row, and the data-trust strip's 'Roster join' tile. Kept: `typeHygOpen_` / `dhStarted_` / `dueExpected_` / `timeExpected_` / `dhHasDue_`, which five other surfaces read, and `typeFieldGate_`, which the roster uses to resolve a gate from this registry. The join itself is UNCHANGED and still gates every card — what stopped is the published measurement of it, which had read 100% since the 2026-08-04 attribution fix. Reversal is not a config flag: restoring it means restoring the builder from git.",
      rationale: "A check nobody can fail is a row people learn to scroll past, and next to it the checks that CAN fail lose urgency. The roster-join figure had also been retired from all three of its surfaces since 3.2 on exactly that reasoning — this makes the retirement permanent rather than data-driven. The trade accepted: if the name index ever regresses, no surface will announce it. What catches that instead is the gaps queue's 'Resolved work carries a Jira assignee' row plus each card's own unattributed count in `meta.jiraUnattributed`, which are unchanged." },
    { version: "4.0", date: "2026-08-10", author: "Alex López",
      affects: ["util", "poolHeadroom", "commitmentFidelity", "shadowWork", "poolCover", "poolConstraint"],
      change: "Capacity is reported per DEPLOYMENT POOL × LEVEL BAND, never as one blended availability figure. People classify from their job code (family.variant sub-track) into a backlog role, a pool and a level band; M-track people in delivery families become GOVERNORS and leave the pool denominators. Five new metrics ship: Sellable Headroom, Commitment Fidelity, Shadow Work, Cover by Pool, Constraint Index.",
      rationale: "Capacity is not fungible. A single company-wide availability percentage averages together people who cannot do each other's work — of this population only the CONSUMER pools draw on project backlog, while Managed Services & Support capacity is contracted and recurring. Blending them overstated availability and made it impossible to see the pool that is actually out of room. Source: Workforce Health Implementation Spec v1.1 (Workforce Planning, 2026.W32)." },
    { version: "3.3", date: "2026-08-06", author: "Alex López",
      affects: [],
      change: "Open-backlog population widened to include unassigned work: `Jira Backlog.js` v3.11.0 drops 'assignee is not EMPTY' from `fetchOpenIssues_()` (spec 2026-08-06-dh-executive-newspaper-design.md, D7). Measured live against servicerocket-coe (2026-08-06): 1,839 unassigned open issues against 1,440 assigned — the true open inventory is 3,279, 56% of it unowned. Weeks-to-clear reads 4.9w on the assigned-only queue this dashboard used to see and 11.0w on the true queue. `attr` (the roster-join check) gained its own denominator `attrN` in the same release (D12) — measured only over records that HAVE an assignee, so an absent assignee is 'nothing to grade' rather than a failed join. Without that fix this widening would have dropped the just-retired, solved Roster-join check to roughly 1,440/3,279 ≈ 44% on all three surfaces it was just removed from.",
      rationale: "Every resolved-work bucket (`onTimeBuckets_`, `throughputBuckets_`, `forecastBuckets_`, `leadTimeBuckets_`, `reworkBuckets_`) skips unresolved records, and `personHygieneBuckets_` is person-keyed, so the four KPI cards and the signals roster do not move. `typeHygOpen_` has no assignee requirement, so unassigned rows enter the 🧬 matrix's open half and the gaps queue: `assigned`, `due`, `est`, `region` and `team` fill rates drop there, materially — unowned tickets are the worst-tagged population on the site, so this is previously-hidden hygiene debt becoming visible, not tagging getting worse. Without this note the next reader sees those fill rates fall on deploy and 'fixes' the regression by putting the assignee clause back, which is exactly the 56%-of-the-queue blind spot this release exists to remove. If the drop is judged unacceptable, the lever is `OPEN_BACKLOG_UPDATED_WEEKS` (open decision O4, owned by Delivery leadership) — never re-hiding the work." },
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

/**
 * Org-level SAMPLE FLOOR — is there enough to average?
 *
 * Distinct from the coverage gate, and the distinction is the whole point. A
 * coverage gate asks "how much of the population can we see?" and a metric below
 * it still publishes (CONFIG_DH.SUPPRESS_BELOW_GATE = false, user decision
 * 2026-08-03, with the Data trust strip carrying the gate read). A sample floor
 * asks "is there anything to average?" and a metric below it CANNOT publish —
 * a mean over one epic is not a mean.
 *
 * Treating the two as one instrument was the prototype's inconsistency: it
 * shelved Forecast at n=1 while publishing On-Time at n=19, and both are below
 * their coverage gate. Sample size was doing the work.
 *
 * Rates are floored; COUNTS never are. Three items cleared is three items
 * cleared, and labelling it "not measured" would hide real work.
 *
 * Fails CLOSED on an unknown id: a metric nobody registered must not publish on
 * the strength of a typo.
 *
 * @param {string} metricId registry key
 * @param {number} n measurable records behind the value
 * @returns {{ok:boolean, need:number|null, n:number}}
 */
function sampleFloorFor_(metricId, n) {
  var m = (METRIC_REGISTRY_.metrics || {})[metricId];
  if (!m) return { ok: false, need: null, n: n };
  // sampleFloor === null marks a COUNT — publishable at any n, zero included.
  if (m.sampleFloor === null || m.sampleFloor === undefined) {
    return { ok: true, need: null, n: n };
  }
  var need = m.sampleFloor;
  return { ok: (Number(n) || 0) >= need, need: need, n: Number(n) || 0 };
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
 * Numeric sort key for a "YYYY.WN" label — year*100+week. A STRING compare is
 * wrong here and silently so: weekKeyFromDate_ does not zero-pad (bug fix,
 * Task 7 review 2026-08-06), so "2026.W10" < "2026.W6" lexicographically
 * ('1' < '6') and a naive .sort() on the label scrambles any window that spans
 * the single/double-digit boundary — which the live 26-week walkback does
 * every year, not just at a January rollover. Week numbers never reach 100
 * (max 53), so year*100+week preserves chronological order exactly.
 * Unparseable labels sort OLDEST (key 0), never newest: both consumers of
 * this order trust it without re-checking — clearRateMedian_ takes the last
 * N elements as "the last N weeks", and inventoryWalkback_ anchors on the
 * LAST element as the measured present. Parking a garbage label at the new
 * end would mislabel it as "now"; parking it at the old end merely loses it
 * to the walkback's window cap, which is the safer failure.
 */
function isoSortKey_(iso) {
  var m = String(iso || "").match(/^(\d{4})\.W(\d{1,2})$/);
  return m ? parseInt(m[1], 10) * 100 + parseInt(m[2], 10) : 0;
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

/** The geographic regions people are actually assigned to, in reading order. */
var DH_GEO_REGIONS_ = ["AMER", "EMEA", "SEA", "ANZ"];

/**
 * The region chip list shipped as `meta.regions`.
 *
 * The four geographic regions always, plus REGION_FALLBACK ("Other") ONLY when
 * at least one person in the population actually carries it.
 *
 * WHY IT IS COMPUTED RATHER THAN LISTED. The user's instruction on 2026-08-17
 * was "delete Other, we have everyone in an assigned region already", and today
 * that is true. But the chip is what makes a person REACHABLE: every region
 * filter matches on `p.region`, so a person sitting in a bucket with no chip is
 * counted in every org-wide total and selectable by no filter — invisible in
 * exactly the view somebody would use to go and find them, with nothing on
 * screen to say a slice is incomplete. That is the silent-subset failure the
 * comparison charts were rebuilt for, and it would arrive the day somebody is
 * hired into a country LOCATION_REGION_MAP has never seen.
 *
 * So: gone while the statement holds, back by itself the moment it stops
 * holding. Same data-driven idiom as the gaps queue's retire-at-100% rule, and
 * for the same reason — the honest version of "delete it" is "stop rendering it
 * while it is empty", not "make the people underneath it unreachable".
 *
 * Its reappearance is also the alarm worth having: it means the roster carries a
 * real location the map does not know yet, which is a one-line CONFIG_DH fix.
 *
 * @param {Array<Object>} people population + attribution stubs
 * @returns {string[]} chip list for meta.regions
 */
function dhRegionChips_(people) {
  var fallback = CONFIG_DH.REGION_FALLBACK;
  var used = (people || []).some(function (p) { return p && p.region === fallback; });
  return used ? DH_GEO_REGIONS_.concat([fallback]) : DH_GEO_REGIONS_.slice();
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

/**
 * The open queue in TWO HALVES: assigned (person-keyed, filterable downstream)
 * and unassigned (org-wide). Returned separately and NEVER pre-summed.
 *
 * Why not one number: the assigned half passes through passesFilters_ on the
 * client, the unassigned half cannot — an unassigned issue belongs to no person
 * and therefore to no Region/Team/PM/Family bucket. Adding a filtered count to
 * an unfiltered one produces a figure that belongs to neither population, so the
 * sum is the CALLER's decision, made once, in one place, with a scope tag on it.
 *
 * Why this matters at all (measured live 2026-08-06): 1,839 unassigned against
 * 1,440 assigned. Assigned-only, weeks-to-clear reads 4.9w; the true queue reads
 * 11.0w. The dashboard was describing a five-week queue as if that were all of it.
 *
 * The unassigned half is counted here off `issues` rather than off the Flow
 * Snapshots log because Jira Raw is authoritative for NOW; the snapshot tab is
 * the log that gives it a history (spec §4.1). Same split as WIP/backlog already.
 *
 * @param {Array<Object>} issues readJiraRaw_ `issues` — every row, all statuses
 * @param {Function} resolvePerson raw assignee → roster display name, or null
 * @param {Object} flowOpen optional precomputed flowOpenBuckets_ result
 * @returns {{assigned:{items,wipN,todoN,todoHrs,unattributed,uncategorized}, unassigned:{items,wipN,todoN,todoHrs,uncategorized}}}
 */
function queueSnapshot_(issues, resolvePerson, flowOpen) {
  // Accept a precomputed flowOpenBuckets_ result. assembleModel_ already calls
  // flowOpenBuckets_ over the same issues and resolvePerson, and repeating an
  // O(n) pass over every Jira issue to rebuild an identical answer is waste on a
  // payload already large enough to need gzipping and chunking. The fallback
  // keeps this function callable on its own, which is what the tests do.
  var assigned = flowOpen || flowOpenBuckets_(issues, resolvePerson);
  var a = { items: 0, wipN: 0, todoN: 0, todoHrs: 0 };
  assigned.buckets.forEach(function (b) {
    a.wipN += b.wipN || 0;
    a.todoN += b.todoN || 0;
    a.todoHrs += b.todoHrs || 0;
  });
  a.items = a.wipN + a.todoN;
  a.todoHrs = Math.round(a.todoHrs * 10) / 10;

  // These two are the records that fall out of BOTH halves: an assignee that
  // exists but does not resolve to a roster person (unattributed), and a status
  // category that is neither To Do nor In Progress (uncategorized). Neither is
  // unassigned, so the complement guard below never sees them, and no bucket was
  // built for them either. Carried here so the hero's own number owns its loss
  // rather than relying on a counter computed somewhere else in the payload —
  // the same "tally, don't drop silently" rule the rest of this file follows.
  a.unattributed = assigned.unattributed || 0;
  a.uncategorized = assigned.uncategorized || 0;

  var u = { items: 0, wipN: 0, todoN: 0, todoHrs: 0, uncategorized: 0 };
  (issues || []).forEach(function (it) {
    if (it.isEpic) return;                                        // epics roll up their children
    if (it.resolved && !isNaN(it.resolved.getTime())) return;      // an inventory is open work
    if (DH_CLOSED_STATUS_.test(String(it.status || ""))) return;
    var raw = String(it.assignee || "").trim();
    // The complement of flowOpenBuckets_'s guard, so the halves are disjoint by
    // construction rather than by coincidence.
    if (raw && !/unassigned/i.test(raw)) return;
    // Mirror the status category split from flowOpenBuckets_ so the two shapes
    // never drift and both exclude WIP hours identically.
    var cat = String(it.statusCategory || "");
    if (/in progress/i.test(cat)) { u.wipN++; return; }
    if (/to do/i.test(cat)) {
      u.todoN++;
      var est = Number(it.estSec) || 0;
      u.todoHrs += Math.max(0, est - (Number(it.spentSec) || 0)) / 3600;
      return;
    }
    u.uncategorized++;
  });
  u.items = u.wipN + u.todoN;
  u.todoHrs = Math.round(u.todoHrs * 10) / 10;

  return { assigned: a, unassigned: u };
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
                                // resAssigned = the Jira discipline gap: an issue
                                // closed with nobody on it. Its former companion
                                // resAttr — "…and that assignee resolves to a
                                // roster person" — was RETIRED 2026-08-17 (user
                                // decision): it had measured 100% since the
                                // 2026-08-04 attribution fix, and a check nobody
                                // can fail is a row people learn to scroll past.
                                // The join itself is unchanged and still gates
                                // every card; what is gone is the published
                                // measurement of it. `hasPerson` below survives
                                // because the resReady/resFull composites are
                                // still defined against it.
                                resAssigned: 0,
                                resRegion: 0, resTeam: 0, resReady: 0, resFull: 0,
                                epics: 0, epicsEst: 0, epicsTime: 0,
                                // ── SRSO binding (2026-08-07) ────────────────
                                // srsoAny  = bound to a sales order by EITHER
                                //            route (fix version or component)
                                // srsoSeen = …and our Billing Type reader saw it
                                // srsoCompOnly = bound the way the runbook says
                                //            (component) and read as untagged —
                                //            the count this exists to produce
                                // srsoMeasurable = rows where the Components
                                //            column was actually present, so a
                                //            missing column reads as "not
                                //            measured" rather than "none found"
                                srsoAny: 0, srsoSeen: 0, srsoCompOnly: 0, srsoMeasurable: 0 };
    return map[iso];
  }
  (jira.issues || []).forEach(function (it) {
    if (!it.resolved || isNaN(it.resolved.getTime())) return;
    var iso = weekKeyFromDate_(it.resolved);
    // ── SRSO BINDING, over ALL delivered work ────────────────────────────────
    // Counted OUTSIDE the On-Time scope block on purpose. The runbook's
    // component binding (B2.6) is set once for the whole customer project, so
    // the question "is delivered work bound to its sales order" is about every
    // resolved issue — not just the epic/milestone/client-commitment slice
    // On-Time happens to measure. Scoping this to that slice would answer a
    // narrower question than the one the mismatch is about.
    if (it.srsoComponent !== null && it.srsoComponent !== undefined) {
      var sr = row(iso);
      sr.srsoMeasurable++;
      var billed = it.billing === "Billable (SRSO)";
      if (billed || it.srsoComponent) sr.srsoAny++;
      if (billed) sr.srsoSeen++;
      // THE COUNT THIS EXISTS TO PRODUCE: bound the way the runbook instructs,
      // invisible to the reader that decides Billing Type.
      if (it.srsoComponent && !billed) sr.srsoCompOnly++;
    }
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
// SHARED WORK-STATE PREDICATES
//
// One definition each of "open", "started", "expected to carry a date" and
// "expected to carry a worklog", read by every surface that has to decide
// whether a record is answerable: the signals roster, backlog health, the
// epic due-date audit, the PM tab and the gaps queue.
//
// They were written for the 🧬 by-type matrix (spec
// 2026-08-04-hygiene-by-issue-type-design.md), which was REMOVED 2026-08-17 —
// its per-parameter summary is now read per person on the signals roster
// instead. The predicates stayed, because five other surfaces had already
// adopted them and re-deriving "open" per surface is exactly how two panels
// on one tab come to disagree about the same ticket.
// ══════════════════════════════════════════════════════════════════════════

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
 * Is a DUE DATE expected on this record — i.e. does its absence count as a gap?
 *
 * ── THE THREE RULES (managers, 2026-08-10) ───────────────────────────────────
 * Stated by the team as three rules, which reduce to ONE exclusion:
 *
 *   1. A due date inside the current week is compliant → dhOverdue_, not here.
 *   2. A To Do ticket with NO due date is ignored entirely — not delayed, not
 *      missing. It is not a commitment yet, and a date guessed onto work nobody
 *      has picked up is what makes dates meaningless later.
 *   3. **Anything that HAS a due date is tracked, whatever its status.** A date
 *      is a commitment the moment somebody sets one, and a commitment nobody is
 *      working is exactly the case worth seeing.
 *
 * So the excluded set is the intersection — unstarted AND undated — and nothing
 * else. This is deliberately NOT the shape of `timeExpected_` above, which
 * excludes every unstarted ticket including the ones carrying worklogs: logged
 * time on a To Do ticket is a status-hygiene problem with a different owner,
 * whereas a due date on a To Do ticket is a real commitment on real work.
 *
 * Reading the ratio: the denominator is "started, or carrying a date", so the
 * column answers *"of the work that is either underway or committed to a date,
 * how much carries a date"*. A To Do ticket WITH a date is a hit, never a
 * silently-dropped row — rule 3 — which is also what keeps the ratio ≤ 100%.
 *
 * Resolved work is always expected to carry a due date — On-Time Delivery is
 * exactly the question "did it land by the date we committed to", and a resolved
 * item with no date is that metric's own coverage gap.
 *
 * ⚠️ NOT applied to backlog health's `undated`/`dated` signals, on purpose. That
 * panel asks "is this backlog ready to be PLANNED", where an undated To Do item
 * genuinely is not plannable — a different question from "is this person's
 * record compliant", which is what the roster and the 🧬 matrix grade.
 *
 * ⚠️ Epics are exempt from rule 2 by team agreement — every epic must carry a
 * date even when it is only the project end date. That agreement has its own
 * surface (epicDueAudit_) rather than an exception in here, because it is a
 * 100%-target audit over ALL epics, not a graded share of a population.
 *
 * @param {Object} it       issue record from readJiraRaw_
 * @param {boolean} isOpen  true for the open-backlog population
 * @returns {boolean}
 */
function dueExpected_(it, isOpen) {
  if (!isOpen) return true;
  return dhStarted_(it) || dhHasDue_(it);
}

/** Does this record carry a usable due date? One predicate, because "has a date"
    is asked by the audit, the ageing bands and the fill columns, and a Date that
    failed to parse must never read as a filled field. */
function dhHasDue_(it) {
  return !!(it && it.due && !isNaN(it.due.getTime()));
}

/**
 * Per-PERSON field fill over the resolved and open populations — the data
 * behind the Actions roster (spec 2026-08-05 §6), and since 2026-08-17 the
 * ONLY per-parameter compliance read the dashboard publishes: the 🧬 by-type
 * matrix that used to sit beside it was removed, because the same parameters
 * read per rocketeer name someone who can act on them.
 * Predicates are the shared ones above (due present · estSec>0 · spentSec>0),
 * so the roster can never disagree with backlog health or the 🚩 epic audit
 * about the same record.
 * Epics are counted (an open epic missing an estimate is the biggest single
 * lever here, and the person who owns the epic owns the gap).
 * Unattributed issues carry no person and are deliberately absent: a row with
 * no name on it is not a roster row. They stay visible as the gaps queue's
 * "Resolved work carries a Jira assignee" line.
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
 * @returns {{resolved:Array<{iso,person,n,due,dueN,est,logged,loggedN,link,start,bill,billN,estSec,spentSec,wip}>,
 *            open:Array<{person,n,due,dueN,est,logged,loggedN,link,start,bill,billN,estSec,spentSec,wip}>}}
 *          resolved is bucketed person × ISO week so the client can scope it
 *          to the analysis period; open is a snapshot (no iso), mirroring
 *          flowOpenBuckets.
 */
function personHygieneBuckets_(jira, resolvePerson) {
  var res = {}, open = {};
  function row(map, k, person) {
    if (!map[k]) map[k] = { iso: "", person: person, n: 0, due: 0, est: 0, logged: 0,
                            // Denominator for `due` only — the started population,
                            // exactly like loggedN below (2026-08-10 managers'
                            // feedback; see dueExpected_). A person's undated To Do
                            // tickets are no longer graded against them. On the
                            // resolved half dueN === n.
                            dueN: 0,
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
    // Due-date carve (dueExpected_): on the open half the only rows outside the
    // ratio are the unstarted AND undated ones. A dated To Do ticket counts, and
    // counts as a HIT — rule 3, and the reason this ratio cannot exceed 100%.
    if (dueExpected_(it, isOpen)) {
      r.dueN++;
      if (dhHasDue_(it)) r.due++;
    }
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
    cap REPORTED, never silently truncated: a clipped list read as complete is how
    "we fixed them all" becomes wrong. (The 🧬 matrix's TYPE_HYG_MAX_KEYS_ held the
    same contract until that surface was removed on 2026-08-17; EPIC_DUE_MAX_KEYS_
    still does.) */
var BACKLOG_MAX_KEYS_ = 300;

/** Days without an update before open work stops counting as live load. */
var BACKLOG_STALE_DAYS_ = 30;
var BACKLOG_STALE_HARD_DAYS_ = 90;
/** Days within which an update makes a ticket "fresh" — one working fortnight. */
var BACKLOG_FRESH_DAYS_ = 14;

function bhDays_(from, to) { return (to - from) / 86400000; }

/**
 * Monday 00:00 of the ISO week containing `now` — the boundary a due date has to
 * fall behind before this dashboard calls it late.
 *
 * ── WHY A WEEK AND NOT A TIMESTAMP (2026-08-10, managers' feedback) ───────────
 * `due < now` reads late the instant a date passes, which put tickets due EARLIER
 * THIS WEEK — Monday's date, read on Wednesday — into the overdue queue while the
 * week they were committed to was still running. Every reporting surface here is
 * weekly (`YYYY.WN` labels, weekly exports, a weekly managers' review), so a
 * commitment for this week is in compliance until the week is over.
 *
 * The bar was also unfair in a way that compounds: the model is rebuilt by the
 * cache warmer, so the same ticket could read on-time at 9am and overdue at 10am
 * with nobody having done anything. Now the boundary only moves on Mondays.
 *
 * Local-time Monday, matching the ISO-week labels the rest of the file uses. The
 * boundary is stamped into the payload (`weekStart`) so a reader can see which
 * week's edge the ageing was measured against.
 */
function dhWeekStart_(now) {
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var dow = d.getDay() || 7;          // JS Sunday = 0 → ISO Sunday = 7
  d.setDate(d.getDate() - (dow - 1)); // back to Monday
  return d;
}

/**
 * Is this item's due date actually late? False for anything due in the CURRENT
 * ISO week — that is a live commitment, not a broken one (see dhWeekStart_).
 *
 * ONE predicate for the overdue total, all three ageing bands and the
 * `futureDated` counterpart, so "late" can never mean two things on one panel.
 */
function dhOverdue_(it, now) {
  return !!it.due && it.due < dhWeekStart_(now);
}

// ═══════════════════════════════════════════════════════════════════════════
// PM ATTRIBUTION (spec 2026-08-11)
//
// A ticket reaches a PM through its PROJECT, never through a person. That is
// not a convenience — it is what makes this view possible at all. PMs are
// structurally absent from the delivery population: DH_BY_DISCIPLINE_ maps
// "15|Project Management" to GOVERNOR/PMO, family 15 is not a TRACKING_FAMILY,
// and a live assertion REQUIRES PMO to appear in wf.scope.absentPools. A
// person-grained approach would have to weaken that assertion or invent a
// second roster; a project-grained one needs neither.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Project key for a Jira issue key. "GTT-605" → "GTT".
 *
 * Strips only the FINAL "-<digits>". Not split("-")[0], which would truncate any
 * project key containing a hyphen at its first one and silently merge unrelated
 * projects into a single PM's bucket. A key that does not end in -N is returned
 * unchanged: an unfamiliar shape must land in a visible bucket of its own rather
 * than collapse to "".
 */
function dhProjectOf_(key) {
  var s = String(key == null ? "" : key).trim().toUpperCase();
  return s.replace(/-\d+$/, "");
}

/**
 * Canonical identity key for a PM name, so the SAME person from two sources
 * collapses to one row.
 *
 * Jira writes an assignee as "Lopez, Moises"; the Tempo PM column writes
 * "Moises Lopez". Without this the tab would list one person twice, split their
 * epics between the two rows, and report both as half-done — a failure that
 * looks like data rather than like a bug. Comma form is flipped to "first last",
 * which is also the spelling dhPmName_ displays.
 */
function dhPmKey_(raw) {
  var norm = normDH_(raw);
  var m = norm.match(/^([^,]+),\s*(.+)$/);
  return m ? normDH_(m[2] + " " + m[1]) : norm;
}

/** Display spelling for a PM name: "Lopez, Moises" → "Moises Lopez", original
    capitalisation preserved. Everything else is returned untouched. */
function dhPmName_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  var m = s.match(/^([^,]+),\s*(.+)$/);
  return m ? (m[2].trim() + " " + m[1].trim()) : s;
}

/**
 * A REAL assignee, or "" when the field is empty.
 *
 * `Jira Backlog.js` writes the literal string **"⚠️ UNASSIGNED"** where a Jira
 * issue has no assignee (writeRawSheet_, `assigneeName || "⚠️ UNASSIGNED"`), so
 * the column is never blank and a naive truthiness check treats the sentinel as
 * a person. On the live feed that put 267 epics under a PM called "UNASSIGNED"
 * instead of falling back to the project lead — a fabricated owner at the top of
 * a page about ownership.
 *
 * The rest of this file already guards it (`/unassigned/i` in the flow reader,
 * and the attribution notes in hygieneBuckets_); this is the same rule, applied
 * where PM attribution needs it.
 */
function dhAssigneeOf_(raw) {
  var s = String(raw == null ? "" : raw).trim();
  return (!s || /unassigned/i.test(s)) ? "" : s;
}

/**
 * Fold the Tempo rows into a project → PM index.
 *
 * readTempoGrid_ already carries `key` (the PROJECT key) beside `pm` (that
 * project's lead) on every row, so nothing new is read from the sheet.
 *
 * LAST-SEEN WINS on a project that names more than one PM across the 52-week
 * window: the row in the most recent week carrying hours. This view is about
 * now-and-forward ownership, so the current owner is the right answer — but the
 * overwrite is COUNTED and reported (`superseded`), because a handover that
 * resolves silently is indistinguishable from a data error.
 *
 * The week comparison is NUMERIC (see isoWeekBefore_ / spec §4.2). Week keys are
 * unpadded, so a lexicographic max would resolve a W9→W10 handover backwards.
 *
 * Time-off rows never confer ownership, mirroring the acc.pms guard in
 * assembleModel_ — a NETSUITE row carries no project, so it cannot name a lead.
 * The test is isTimeOffKey_(row.key), the SAME predicate eachTempoRow_ uses:
 * there is no `row.timeOff` property on a readTempoGrid_ row, and checking for
 * one would leave the guard permanently disabled.
 *
 * @param {Array<Object>} rows readTempoGrid_ output rows
 * @returns {{byProject: Object<string,string>, superseded: number}}
 */
function pmByProject_(rows) {
  var best = {};       // project → { pm, y, w }
  var superseded = 0;
  (rows || []).forEach(function (row) {
    if (!row || isTimeOffKey_(row.key)) return;
    var proj = String(row.key || "").trim().toUpperCase();
    var pm = String(row.pm || "").trim();
    if (!proj || !pm) return;
    // Most recent week in which this row carries hours. A row with no hours
    // carries no evidence of current ownership.
    var y = -1, w = -1;
    var wh = row.weekHours || {};
    for (var iso in wh) {
      if (!wh[iso]) continue;
      var m = /^(\d{4})\.W(\d{1,2})$/.exec(iso);
      if (!m) continue;
      var yy = +m[1], ww = +m[2];
      if (yy > y || (yy === y && ww > w)) { y = yy; w = ww; }
    }
    if (y === -1) return;
    var cur = best[proj];
    if (!cur) { best[proj] = { pm: pm, y: y, w: w }; return; }
    if (cur.pm === pm) {
      if (y > cur.y || (y === cur.y && w > cur.w)) { cur.y = y; cur.w = w; }
      return;
    }
    // A genuine conflict: two different PMs on one project. Either way round it
    // is counted — the reader needs to know the project changed hands, not just
    // which name survived.
    if (y > cur.y || (y === cur.y && w > cur.w)) best[proj] = { pm: pm, y: y, w: w };
    superseded++;
  });
  var byProject = {};
  for (var p in best) byProject[p] = best[p].pm;
  return { byProject: byProject, superseded: superseded };
}

/** The sentinel for work whose project has no PM in the Tempo export. Matches
    the client's UNTAGGED_.pm exactly — one string, or the bucket the server
    builds and the bucket the client filters on are two different things. */
var DH_NO_PM_ = "(No PM)";

/**
 * The `ready` signal, reused rather than redefined. BACKLOG_SIGNALS_ already
 * holds the org's definition — dated AND estimated AND linked AND fresh — and it
 * is described there as "the share of the backlog that is actually plannable".
 * Reading it out of that table is what stops the PM tab and the backlog panel
 * from drifting into two meanings of one word.
 */
function dhBacklogReady_(it, now) {
  for (var i = 0; i < BACKLOG_SIGNALS_.length; i++) {
    if (BACKLOG_SIGNALS_[i].k === "ready") return !!BACKLOG_SIGNALS_[i].test(it, now);
  }
  return false;
}

/**
 * PM-owned work: two bars per PM plus a month-windowed item list.
 *
 * TWO BARS, NEVER AVERAGED (spec §5.2):
 *   OWNS       epicDated / epicN     — open epics carrying a due date, over the
 *                                      epics that are COMMITMENTS: started, or
 *                                      dated, or both. Undated To Do epics are
 *                                      assigned backlog and sit outside this
 *                                      denominator (user 2026-08-17), counted in
 *                                      `epicBacklogN` and named in
 *                                      `epicBacklogKeys`. The PM's own field,
 *                                      graded against the 100% bar.
 *   IN PROJECT readyN / readyDen     — the `ready` share over open non-epics,
 *                                      using the EXISTING BACKLOG_SIGNALS_
 *                                      definition. Team hygiene, shown as
 *                                      context.
 * A blended score would grade a PM on fields other people fill, and could not
 * say which half is the problem.
 *
 * NEITHER BAR IS WINDOWED, and that is load-bearing. An undated epic has no date
 * and so cannot fall inside a date window; windowing bar 1 would leave a
 * denominator of only dated epics and pin every PM at 100% — a bar that can
 * never report the very gap it exists to report. Bar 2 inherits the same trap
 * through `ready`, which has `dated` as a conjunct. The window scopes `items`.
 *
 * ⚠ The 2026-08-17 backlog carve is NOT that trap returning, and the difference
 * is worth being precise about because they look alike. Windowing would have
 * removed undated epics because they have no date to match — an artefact of the
 * filter. The carve removes undated epics that ALSO have not been started, on
 * the ground that nobody has committed to them yet — a statement about the work.
 * A STARTED epic with no date stays in the denominator and still fails the bar,
 * which is the case the bar exists for: work under way with no committed end.
 *
 * WINDOW (spec §5.3): overdue carry-in + due in the current calendar month.
 * A strict month filter would let a commitment escape by ageing out of its own
 * window — the longer something slips, the less visible it becomes.
 * Undated items are ALWAYS included: they have no month, and they are the point.
 *
 * @param {Object} jira        readJiraRaw_ output (use the leaver-scoped feed)
 * @param {Object} byProject   pmByProject_(…).byProject
 * @param {Date}   today       injectable for tests
 * @param {Function=} resolvePerson  Jira assignee → roster display name, or null.
 *        Feeds `epics[].owners`, which is how the universal filters reach a tab
 *        whose unit is an epic rather than a person.
 * @returns {{rows:Array, keyCap:number}}
 */
function pmOwnedWork_(jira, byProject, today, resolvePerson) {
  var now = today || new Date();
  var monthY = now.getFullYear(), monthM = now.getMonth();
  var weekStart = dhWeekStart_(now);
  var idx = byProject || {};
  var all = (jira && jira.issues) || [];
  var map = {};

  // Key → issue, for the parent chain walk below.
  var byKey = {};
  all.forEach(function (it) { if (it && it.key) byKey[String(it.key).toUpperCase()] = it; });

  // ── WHO OWNS AN EPIC: the assignee, and only then the project lead ────────
  // An epic's assignee IS its owner — the ticket states it. The Tempo project
  // lead is an INFERENCE from who logs hours where, and it is right only as far
  // as one project has one PM. Direct evidence first, inference to fill the
  // gaps, and the source recorded either way so a PM can challenge a row rather
  // than having to trust it.
  //
  // Resolved epics are included here even though the bars count only open ones:
  // a child of a closed epic still has to reach the right PM.
  var epicPm = {};                                  // EPIC KEY → { name, source }
  var childCountAll = {};                           // EPIC KEY → children, any status
  all.forEach(function (it) {
    if (!it || !it.isEpic) return;
    var lead = idx[dhProjectOf_(it.key)] || "";
    var assignee = dhAssigneeOf_(it.assignee);
    epicPm[String(it.key).toUpperCase()] = assignee
      ? { name: dhPmName_(assignee), source: "assignee" }
      : (lead ? { name: lead, source: "project" } : { name: DH_NO_PM_, source: "none" });
  });
  all.forEach(function (it) {
    if (!it || it.isEpic) return;
    var ek = dhEpicOfChain_(it, byKey);
    if (ek) childCountAll[ek] = (childCountAll[ek] || 0) + 1;
  });

  /** The PM an issue belongs to. Children inherit their EPIC's PM — that is what
      keeps the epic ▸ children hierarchy intact: a child assigned to an engineer
      still belongs to the PM accountable for the epic above it. */
  function pmOf(it) {
    if (it.isEpic) return epicPm[String(it.key).toUpperCase()] || { name: DH_NO_PM_, source: "none" };
    var ek = dhEpicOfChain_(it, byKey);
    if (ek && epicPm[ek]) return epicPm[ek];
    var lead = idx[dhProjectOf_(it.key)] || "";
    return lead ? { name: lead, source: "project" } : { name: DH_NO_PM_, source: "none" };
  }

  // Bucketed by CANONICAL key so "Lopez, Moises" and "Moises Lopez" are one row.
  // The display name prefers a spelling with no comma — whichever source it came
  // from — because that is how a person's name is normally written.
  function rowFor(who) {
    var k = who.name === DH_NO_PM_ ? DH_NO_PM_ : dhPmKey_(who.name);
    if (!map[k]) {
      map[k] = { pm: who.name, epicN: 0, epicDated: 0, epicMissingKeys: [], epicCapped: false,
                 // Undated AND unstarted epics — assigned backlog, carved out of
                 // the Owns bar on 2026-08-17 but counted and nameable, never
                 // silently dropped.
                 epicBacklogN: 0, epicBacklogKeys: [],
                 readyDen: 0, readyN: 0, ignoredN: 0, epics: [],
                 viaAssignee: 0, viaProject: 0,
                 oppNoDue: 0, oppEpicsAtRisk: 0, oppEpicsBreached: 0,
                 oppNoChildren: 0, oppStale: 0 };
    }
    if (who.name !== DH_NO_PM_ && map[k].pm.indexOf(",") !== -1 && who.name.indexOf(",") === -1) {
      map[k].pm = who.name;
    }
    return map[k];
  }

  // In window = overdue (before this week's Monday) OR due inside the current
  // calendar month. Undated is NOT in the window — an undated item has no month,
  // and the epic-scope rule below is what decides whether it is shown.
  function inWindow(it) {
    if (!dhHasDue_(it)) return false;
    if (it.due < weekStart) return true;
    return it.due.getFullYear() === monthY && it.due.getMonth() === monthM;
  }

  // UNSTARTED AND UNDATED = not a commitment yet. The managers' rule (2026-08-10,
  // the same one `undatedIgnored` encodes) — queueing these produced a list
  // nobody could work, which is exactly what the first cut of this tab did.
  // COUNTED, never listed: a silent drop and a considered exclusion look
  // identical on screen, and only one of them is honest.
  function ignorable(it) { return !dhHasDue_(it) && !dhStarted_(it); }

  all.forEach(function (it) {
    if (!typeHygOpen_(it)) return;                 // open work only — same predicate
    var who = pmOf(it);
    var r = rowFor(who);
    if (it.isEpic) {
      if (who.source === "assignee") r.viaAssignee++;
      else if (who.source === "project") r.viaProject++;
    }

    // ── The two bars. UNFILTERED and UNWINDOWED, always (spec §5.2). ──────────
    //
    // ⚠ THE ignorable() CARVE NOW APPLIES TO BAR 1 (user decision 2026-08-17),
    // REVERSING the 2026-08-10 rule recorded below it. The instruction:
    // "Project managers cannot be punished for Epics available with no due date
    // if they have the status TO DO, since it is part of the assigned backlog."
    //
    // An epic sitting in To Do with no date is work that has been PUT somewhere,
    // not work that has been PROMISED. Grading a PM on it treats the backlog
    // itself as a failure, and the fix it implies — put a date on everything in
    // the backlog — manufactures commitments nobody has made, which then arrive
    // as On-Time misses. The epic becomes the PM's the moment either thing is
    // true: somebody starts it, or somebody dates it.
    //
    // The previous reasoning (kept, because it is still the risk): dropping
    // these from the denominator can pin the bar at 100% for a PM whose whole
    // portfolio is undated backlog. Two things stop that reading:
    //   · they are COUNTED, in `epicBacklogN`, and named in `epicBacklogKeys` —
    //     the client states the exclusion beside the bar, so a 100% is never
    //     presented as "nothing to fix here";
    //   · when the carve takes EVERY epic, `epicN` is 0 and the bar renders as
    //     "no committed epics" rather than as a clean 100%.
    // A silent drop and a considered exclusion look identical on screen, and
    // only one of them is honest — the same rule the item list already follows.
    //
    // The ORG-scope 🚩 audit on Actions deliberately does NOT take this carve:
    // it names tickets, attributes nothing to anybody, and the managers ratified
    // it at 100% on 2026-08-10. So the two counts CAN now differ, and both
    // surfaces say why — see epicDueAudit_'s header.
    if (it.isEpic) {
      if (ignorable(it)) {
        r.epicBacklogN++;
        if (r.epicBacklogKeys.length < EPIC_DUE_MAX_KEYS_) r.epicBacklogKeys.push(it.key);
      } else {
        r.epicN++;
        if (dhHasDue_(it)) r.epicDated++;
        else if (r.epicMissingKeys.length < EPIC_DUE_MAX_KEYS_) r.epicMissingKeys.push(it.key);
        else r.epicCapped = true;
      }
    } else {
      r.readyDen++;
      if (dhBacklogReady_(it, now)) r.readyN++;
    }
    if (ignorable(it)) r.ignoredN++;
  });

  // ── The epic list: WIP (any date) or in the window ────────────────────────
  // Two rules composed, not one replacing the other. "In progress or carrying a
  // due date" is the focus rule; the month window is what keeps a dated epic
  // six months out from crowding the page. An epic that is neither started nor
  // dated satisfies neither and is counted only — it is still named in the
  // Owns bar's 🚩 key list, so the fix stays one click away.
  var epicOf = {};
  all.forEach(function (it) {
    if (!it.isEpic || !typeHygOpen_(it)) return;
    if (!(dhStarted_(it) || inWindow(it))) return;
    var ek = String(it.key).toUpperCase();
    var who = pmOf(it);
    // Untouched for longer than the backlog's own staleness bar. Reused rather
    // than a second threshold, so "stale" means one thing across the app.
    var stale = !!it.updated && bhDays_(it.updated, now) > BACKLOG_STALE_DAYS_;
    var e = { key: it.key, name: it.summary || "", status: it.status || "",
              started: dhStarted_(it), assignee: dhPmName_(dhAssigneeOf_(it.assignee)),
              via: who.source,
              due: dhHasDue_(it) ? weekKeyFromDate_(it.due) : "",
              overdue: dhOverdue_(it, now), _dueDate: dhHasDue_(it) ? it.due : null,
              stale: stale, staleDays: it.updated ? Math.round(bhDays_(it.updated, now)) : null,
              // Counted over EVERY status: an epic whose children are all
              // delivered is linked, not empty. Only an epic nothing rolls up to
              // is the gap — its hours can never reach an engagement.
              childrenAll: childCountAll[ek] || 0,
              // `owners` = the roster people assigned to this epic's children.
              // It is what lets the universal filters reach a tab whose unit is
              // an epic: an epic belongs to whichever slices its WORKERS belong
              // to. Empty means unattributable — no child resolves to anyone on
              // the roster — which the client must state rather than hide.
              owners: [],
              children: [], within: 0, atRisk: 0, breached: 0, noDate: 0, ignoredN: 0 };
    epicOf[ek] = e;
    rowFor(who).epics.push(e);
  });

  // ── Children, attached to the epic they roll up to ───────────────────────
  all.forEach(function (it) {
    if (it.isEpic || !typeHygOpen_(it)) return;
    var epicKey = dhEpicOfChain_(it, byKey);
    var e = epicKey ? epicOf[epicKey] : null;
    if (!e) return;                                // no epic, or epic not listed
    // Who is actually working on this epic. Recorded even for the ignorable
    // children below, because a To Do ticket with no date is still evidence of
    // which slice the epic belongs to — dropping it here would make an epic
    // vanish from a filtered view for a reason that has nothing to do with the
    // filter.
    var owner = resolvePerson ? resolvePerson(it.assignee) : null;
    if (owner && e.owners.indexOf(owner) === -1) e.owners.push(owner);

    if (ignorable(it)) { e.ignoredN++; return; }   // To Do with no date — counted only
    var verdict = dhChildVerdict_(it, e._dueDate, now);
    if (verdict.v === "within") e.within++;
    else if (verdict.v === "atRisk") e.atRisk++;
    else if (verdict.v === "breached") e.breached++;
    else if (verdict.v === "nodate") e.noDate++;
    e.children.push({
      key: it.key, summary: it.summary || "", status: it.status || "",
      due: dhHasDue_(it) ? weekKeyFromDate_(it.due) : "",
      verdict: verdict.v, overByWeeks: verdict.weeks,
    });
  });

  var rows = Object.keys(map).map(function (k) { return map[k]; });
  rows.forEach(function (r) {
    // ── AREAS OF OPPORTUNITY ────────────────────────────────────────────────
    // Four countable gaps, each one a different conversation, so they are never
    // summed into a single "score": a missing date is a commitment nobody made,
    // a child past its epic is a plan that cannot land, an epic nothing rolls up
    // to cannot reach an engagement, and a stale epic may not be real work at
    // all. Derived from what is already computed — no new definitions.
    // Counted per EPIC, not per child: one badly-planned epic is ONE decision a
    // PM makes, not nine problems. Nine sub-tasks past their epic is a single
    // conversation about that epic's date.
    r.oppNoDue = r.epicN - r.epicDated;
    r.epics.forEach(function (e) {
      if (e.atRisk) r.oppEpicsAtRisk++;
      if (e.breached) r.oppEpicsBreached++;
      if (!e.childrenAll) r.oppNoChildren++;
      if (e.stale) r.oppStale++;
    });

    // Worst first inside a PM: epics missing a date, then those with children
    // past the epic's own deadline, then the rest.
    r.epics.sort(function (a, b) {
      return (!a.due) - (!b.due) === 0
        ? (b.breached - a.breached) || (b.atRisk - a.atRisk) || a.key.localeCompare(b.key)
        : (a.due ? 1 : -1);
    });
    r.epics.forEach(function (e) {
      delete e._dueDate;                           // internal, never shipped
      e.children.sort(function (a, b) {
        var rank = { breached: 0, atRisk: 1, nodate: 2, ungraded: 3, within: 4 };
        return (rank[a.verdict] - rank[b.verdict]) || a.key.localeCompare(b.key);
      });
    });
  });
  rows.sort(function (a, b) {
    // (No PM) sorts LAST whatever its size: it is a coverage gap with a name,
    // not a person, and ranking it among PMs invites reading it as one.
    var an = a.pm === DH_NO_PM_, bn = b.pm === DH_NO_PM_;
    if (an !== bn) return an ? 1 : -1;
    var am = a.epicN - a.epicDated, bm = b.epicN - b.epicDated;
    return (bm - am) || (b.epicN - a.epicN) || a.pm.localeCompare(b.pm);
  });
  return { rows: rows, keyCap: EPIC_DUE_MAX_KEYS_ };
}

/**
 * The epic a non-epic issue rolls up to, walking the parent chain.
 *
 * WHY A CHAIN AND NOT `epicKey || parentKey`. A sub-task's parent is very often
 * a STORY, not an epic — the 2026-08-05 audit found roughly 1,023 delivered
 * sub-tasks in exactly that shape. A one-level fallback resolves those to the
 * story's key, which is not an epic, so they attach to nothing and silently
 * vanish from the epic they actually belong to. Walking up finds the epic.
 *
 * Depth-guarded and cycle-guarded: Jira does not forbid a parent loop, and an
 * unguarded walk over a loop hangs the whole model build.
 *
 * @returns {string} UPPERCASE epic key, or "" when the chain reaches nothing
 */
function dhEpicOfChain_(it, byKey) {
  var seen = {};
  var cur = it;
  for (var hop = 0; cur && hop < 6; hop++) {
    var ek = String(cur.epicKey || "").toUpperCase();
    if (ek) return ek;
    var pk = String(cur.parentKey || "").toUpperCase();
    if (!pk || seen[pk]) return "";
    seen[pk] = 1;
    var parent = byKey[pk];
    // The parent is itself an epic — the sub-task hangs directly off it.
    if (parent && parent.isEpic) return pk;
    cur = parent;
  }
  return "";
}

/**
 * Is a child within its epic's committed deadline, past it, or ungradeable?
 *
 * WEEK-GRAINED, via dhWeekStart_ on both sides — the same boundary dhOverdue_
 * uses, so "late" means one thing everywhere. Comparing raw dates would make a
 * child due Friday "over" an epic due Monday of the same week, which is not a
 * slip by any rule this dashboard applies.
 *
 *   within   → the child lands on or before the epic's week
 *   over     → the child is committed past the epic it belongs to. This is the
 *              finding: the epic cannot land on its date if its own work is
 *              scheduled after it.
 *   nodate   → started, but carries no date of its own. It cannot be within or
 *              over a deadline it never committed to, and started work with no
 *              date is a gap in its own right — never quietly counted as within.
 *   ungraded → the EPIC has no due date, so there is nothing to measure against.
 *              The epic itself is the flag.
 */
function dhChildVerdict_(child, epicDue, now) {
  if (!epicDue) return { v: "ungraded", weeks: null };
  if (!dhHasDue_(child)) return { v: "nodate", weeks: null };
  var c = dhWeekStart_(child.due), e = dhWeekStart_(epicDue);
  if (c <= e) return { v: "within", weeks: null };
  var weeks = Math.round((c - e) / (7 * 86400000));
  // ── AT RISK vs BREACHED ──
  // Same geometry, two different conversations, and the difference is WHEN.
  // Anchored on the EPIC's week because that is the commitment being protected:
  // while it has not passed, moving the child or moving the epic are both real
  // options, and this is a planning inconsistency caught early. Once it has
  // passed, the commitment is already missed and the conversation is recovery.
  //
  // Reported as one red before this split, so an epic due in October with a
  // child due a week later looked exactly like one whose date went by in July
  // (user 2026-08-11). A red that fires on future, fixable work is a red people
  // learn to skip.
  //
  // The child's OWN lateness is deliberately not the anchor — the Due column
  // beside this one already bands it, and reusing dhOverdue_ here keeps "late"
  // meaning exactly one thing across the whole app.
  return { v: dhOverdue_({ due: epicDue }, now) ? "breached" : "atRisk", weeks: weeks };
}

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
  // "Not yet due" is week-grained: a date inside the CURRENT week is still a live
  // commitment. Expressed as the negation of dhOverdue_ so `dated` always splits
  // exactly into this row plus the overdue row — no item can fall in both or
  // neither, whatever the boundary rule is.
  { k: "futureDated", kind: "good", queue: false,
    test: function (it, now) { return !!it.due && !dhOverdue_(it, now); } },
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
  // Undated work that somebody has STARTED. An unstarted undated ticket is
  // excluded by rule 2 (user report 2026-08-10 — the queue was sending people
  // after tickets the rate had already stopped counting), and is tallied
  // separately as `undatedIgnored` so the three still partition the population:
  //     dated + undated + undatedIgnored = n
  { k: "undated", kind: "bad",
    test: function (it) { return !dhHasDue_(it) && dhStarted_(it); } },
  // Context, not a queue: reported as a sentence on the panel, never as a row to
  // work. `queue: false` keeps its keys out of the payload — nobody is meant to
  // go and fix these, and a key list is an invitation to.
  { k: "undatedIgnored", kind: "good", queue: false,
    test: function (it) { return !dhHasDue_(it) && !dhStarted_(it); } },
  { k: "unlinked", kind: "bad",
    test: function (it) { return !it.linked; } },
  { k: "noStart", kind: "bad",
    test: function (it) { return !it.start; } },
  { k: "stale", kind: "bad",
    test: function (it, now) { return !!it.updated && bhDays_(it.updated, now) > BACKLOG_STALE_DAYS_; } },
  { k: "staleHard", kind: "bad",
    test: function (it, now) { return !!it.updated && bhDays_(it.updated, now) > BACKLOG_STALE_HARD_DAYS_; } },
  // Late means "the week we committed to has ended" — see dhOverdue_. Anything
  // due inside the current week is in compliance and appears in no queue here.
  { k: "overdue", kind: "bad",
    test: function (it, now) { return dhOverdue_(it, now); } },
  // Ageing bands, because one "overdue" count hides the difference between a
  // ticket that slipped a day and a commitment abandoned two months ago. Live
  // measurement 2026-08-06: 62% of overdue open work was >30 days past due.
  // Each band is gated on dhOverdue_ FIRST and then aged in days: without the
  // gate, "≤7 days" would re-admit the current week's dates that the rule above
  // just excluded, and the bands would not sum to the overdue total.
  { k: "overdue7", kind: "bad",
    test: function (it, now) { return dhOverdue_(it, now) && bhDays_(it.due, now) <= 7; } },
  { k: "overdue30", kind: "bad",
    test: function (it, now) {
      if (!dhOverdue_(it, now)) return false;
      var d = bhDays_(it.due, now);
      return d > 7 && d <= 30;
    } },
  { k: "overdueOver30", kind: "bad",
    test: function (it, now) { return dhOverdue_(it, now) && bhDays_(it.due, now) > 30; } },
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
 * @returns {{buckets:Array, unattributed:number, unassigned:number, keyCap:number, asOf:string}}
 */
function backlogHealthBuckets_(jira, resolvePerson, now) {
  now = now || new Date();
  var map = {}, unattributed = 0, unassigned = 0;

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
    // hasAssignee mirrors typeHygieneBuckets_'s tally() EXACTLY (same sentinel
    // check, same reasoning, spec §4.6/D12): "⚠️ UNASSIGNED" / blank is NOT a
    // failed roster join, it is no assignee to join at all. Since unassigned
    // rows joined the export (v3.11.0, +~1,839 open issues), collapsing both
    // cases into one "unattributed" counter would report an ABSENT assignee as
    // a FAILED roster join — the exact conflation attrN exists to prevent,
    // now reappearing here as a fourth surface. Split exactly like attrN does.
    var rawA = String(it.assignee || "").trim();
    var hasAssignee = !!rawA && !/unassigned/i.test(rawA);
    if (!hasAssignee) { unassigned++; return; }
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
    unassigned: unassigned,
    keyCap: BACKLOG_MAX_KEYS_,
    // Stamped because overdue/staleness are relative to BUILD time, not render
    // time — a reader looking at an hour-old cached model deserves to know which
    // "today" the ageing was measured against.
    asOf: now.toISOString(),
    // The Monday every overdue verdict on this panel was measured against, so the
    // week-grained rule is legible rather than folklore (2026-08-10).
    weekStart: dhWeekStart_(now).toISOString(),
    thresholds: { fresh: BACKLOG_FRESH_DAYS_, stale: BACKLOG_STALE_DAYS_,
                  staleHard: BACKLOG_STALE_HARD_DAYS_ },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 🚩 EPICS WITHOUT A DUE DATE — the audit (team agreement, 2026-08-10)
//
// The team agreed that EVERY epic carries a due date, "even if it is just the
// project end date". That makes this the only field rule on this dashboard with a
// ratified 100% target, and it is why this is a flag rather than another graded
// column: a gate of 80% would declare success while a fifth of the engagements
// have no committed end.
//
// WHY IT IS A SEPARATE SURFACE from the 🧬 matrix, which already prints due-date
// fill for the three epic types:
//   · The matrix grades a SHARE against a coverage gate. This has a target of
//     100% and an owner (Gon + the PMs), so it needs to name the offenders, not
//     rate them.
//   · The matrix's open half now excludes unstarted undated tickets by rule
//     (dueExpected_). An epic in To Do with no date is EXACTLY what this audit is
//     for, so it must not inherit that carve — hence its own pass over the feed
//     rather than a filter on the matrix rows.
//   · Epics are containers, so the assignee is often nobody. A surface keyed on
//     people cannot see them at all.
//
// ⚠ THIS AUDIT AND THE PROJECT MANAGERS TAB NO LONGER RECONCILE, ON PURPOSE
// (2026-08-17). This panel counts EVERY open epic with no due date, including
// the undated To Do ones; the PM tab carves those out of its Owns bar, because
// grading a named person on unstarted backlog is a different act from listing a
// ticket nobody is accused of owning. So this number is the larger of the two,
// and the gap between them is exactly `sum(epicBacklogN)`. Both surfaces say so
// on screen — a reader who finds two counts of "the same" epics must be able to
// tell which question each one answers, or they will assume one is broken.
//
// ORG SCOPE, deliberately: no person filter, no roster join, unassigned epics
// included. This is an audit of tickets, and an epic that resolves to no
// rocketeer is not thereby somebody else's problem.
//
// NAMES NOTHING BUT ISSUE KEYS. Same rule as the gaps queue: a standing list of
// people against failures in a widely-read view is a blame board. An epic key is
// a work item anyone can open and fix.
// ══════════════════════════════════════════════════════════════════════════

/** Keys carried per epic type. Capped and the cap REPORTED — a clipped list read
    as complete is how "we dated them all" becomes wrong. */
var EPIC_DUE_MAX_KEYS_ = 200;

/**
 * Open epics with no due date, split by epic type.
 *
 * @param {Object} jira readJiraRaw_ output (leaver-scoped, same feed as every
 *                      other hygiene surface — so the counts reconcile)
 * @returns {{rows:Array<{type:string,n:number,missing:number,keys:string[],capped:boolean}>,
 *            n:number, missing:number, keyCap:number}}
 *          `rows` sorted most-missing first: the audit's own work order.
 */
function epicDueAudit_(jira) {
  var map = {}, n = 0, missing = 0;
  (jira.issues || []).forEach(function (it) {
    if (!it.isEpic) return;
    // OPEN epics only. A resolved epic's missing date cannot be fixed in any way
    // that changes a future number — the dashboard's standing rule about the open
    // vs resolved split (typeHygOpen_ is reused so "open" means one thing here).
    if (!typeHygOpen_(it)) return;
    var type = it.typeLabel || "(blank)";
    if (!map[type]) map[type] = { type: type, n: 0, missing: 0, keys: [], capped: false };
    var r = map[type];
    r.n++; n++;
    if (dhHasDue_(it)) return;
    r.missing++; missing++;
    if (r.keys.length < EPIC_DUE_MAX_KEYS_) r.keys.push(it.key);
    else r.capped = true;
  });
  var rows = Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return (b.missing - a.missing) || (b.n - a.n); });
  return { rows: rows, n: n, missing: missing, keyCap: EPIC_DUE_MAX_KEYS_ };
}

/** Median of a numeric array; null when empty. Backs the forecast secondary
    form (median absolute % variance) over the active filter's selection. */
function medianOf_(vals) {
  if (!vals || !vals.length) return null;
  var s = vals.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Median weekly clearing rate over the last `weeks` complete weeks.
 *
 * A MEDIAN, not a mean, and trailing rather than last-week: this is the
 * denominator of the Executive tab's headline, and a single holiday week in it
 * inflates weeks-to-clear by roughly the size of the holiday. Measured on the
 * live feed 2026-08-06: W31 resolved 204 against an eight-week mean of 297, so
 * a one-week basis read 16.1 weeks where the trailing basis read 11.0.
 *
 * Same median-and-MAD reasoning standardRate_ applies to every operating norm
 * here, and the same refusal to publish below a minimum — reusing that bar
 * rather than inventing a second one.
 *
 * @param {Array<number|null>} series weekly resolved counts, oldest first
 * @param {number} weeks trailing window size
 * @returns {number|null} null when fewer than CLEAR_RATE_MIN_N usable weeks
 */
function clearRateMedian_(series, weeks) {
  if (!series || !series.length) return null;
  var n = weeks || CONFIG_DH.CLEAR_RATE_WEEKS;
  var win = series.slice(Math.max(0, series.length - n));
  // A null week is a GAP (no export ran) and is dropped. A zero week is DATA
  // (a shutdown) and counts — treating the two alike would let a broken feed
  // masquerade as a quiet fortnight.
  var vals = win.filter(function (v) { return v !== null && v !== undefined && !isNaN(v); });
  if (vals.length < (CONFIG_DH.CLEAR_RATE_MIN_N || 5)) return null;
  return medianOf_(vals);
}

/**
 * Reconstructs a weekly open-inventory series by walking deltas BACKWARDS from
 * the measured present:
 *
 *     inventory(W-1) = inventory(W) - created(W) + resolved(W)
 *
 * Why reconstruct at all: Flow Snapshots appends one row per export run and
 * started 2026.W32, so the measured series is a single point — and a hero number
 * with no trend is a headline with no context. Cumulative created-minus-resolved
 * from scratch would undercount (anything created before the export window is
 * missing), but anchoring on a MEASURED total removes that error entirely: only
 * the deltas need to be right, and they are, because created and resolution dates
 * are on every row.
 *
 * Two limits, both recorded in the registry's deviations:
 *  1. it assumes nothing was deleted or moved out of scope;
 *  2. the anchor carries the updated>=-26w bound while the deltas do not, so
 *     drift grows with distance from today — hence the 26-week cap, where that
 *     bound is coherent.
 *
 * Every point carries `measured`, so the client can draw reconstructed points
 * differently. As Flow Snapshots accumulates real measurements they replace
 * reconstructed points week by week and the series improves on its own.
 *
 * @param {number|null} anchorItems measured open inventory NOW
 * @param {Array<{iso,created,resolved}>} weeks oldest first, ending at the anchor week
 * @param {number} maxWeeks horizon cap
 * @returns {Array<{iso,items,measured}>} oldest first; empty when unanchorable
 */
function inventoryWalkback_(anchorItems, weeks, maxWeeks) {
  if (anchorItems === null || anchorItems === undefined || isNaN(anchorItems)) return [];
  if (!weeks || !weeks.length) return [];
  var cap = maxWeeks || CONFIG_DH.WALKBACK_MAX_WEEKS || 26;
  var win = weeks.slice(Math.max(0, weeks.length - cap));
  var out = new Array(win.length);
  var items = Number(anchorItems);
  for (var i = win.length - 1; i >= 0; i--) {
    out[i] = {
      iso: win[i].iso,
      items: Math.max(0, Math.round(items)),   // a negative inventory is not a state
      // Only the newest point is measured; everything behind it is inferred.
      measured: i === win.length - 1,
    };
    items = items - (Number(win[i].created) || 0) + (Number(win[i].resolved) || 0);
  }
  return out;
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

/**
 * The Jira site every deep link points at. Script Property first, config second.
 *
 * Trailing slashes are trimmed HERE, once, rather than defended against in each
 * renderer: an override pasted with a trailing "/" would otherwise produce
 * `…net//browse/KEY`, which Jira serves as a 404 and a reader reports as "the
 * links are broken" rather than "somebody typed a slash".
 */
function dhJiraBase_() {
  var p = null;
  // Same try/catch idiom as readGateOverrides_: a property store that is
  // unavailable must not take the whole model build down. Links to the default
  // site are a small wrong; a dashboard that fails to render is a large one.
  try { p = PropertiesService.getScriptProperties().getProperty("DH_JIRA_BASE"); } catch (e) { p = null; }
  return String(p || CONFIG_DH.JIRA_BASE_URL || "").trim().replace(/\/+$/, "");
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

/**
 * Reads a bare CALENDAR date ("Week Start" — no time-of-day, no offset) from
 * local components, never through `new Date(string)`. Do NOT use parseDhDate_
 * for this column: a bare "yyyy-mm-dd" string is parsed as UTC MIDNIGHT per the
 * ES spec (unlike a full ISO datetime, which carries its own offset and is
 * unambiguous), so `new Date("2026-07-27")` read back with local getters lands
 * on 2026-07-26 in any behind-UTC timezone — and weekKeyFromDate_ reads with
 * local getters, so that one calendar day shifts the whole row one ISO week
 * early. Silent, and it feeds the Executive net-flow figure directly.
 *
 * Handles both forms getValues() can hand back for this column:
 *   - a STRING "yyyy-mm-dd" — what the exporter writes (v3.11.1+, deliberately
 *     a string rather than a Date, so Apps Script's own Date→cell serialization,
 *     which uses the SCRIPT's timezone, can't reintroduce the same shift on write).
 *   - a DATE — what Sheets may hand back if it coerced that string into a
 *     date-typed cell; its LOCAL y/m/d is the calendar day the reading script
 *     sees, so re-deriving local components (not trusting the instant) keeps
 *     this correct regardless of which timezone wrote it.
 */
function dhCellDateLocal_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  }
  if (typeof v === "string") {
    var m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
 * Bench detector on roster Employee Status — crew between engagements.
 *
 * A benched contractor is ACTIVE on the roster and NOT contracted to deliver.
 * They stay in the population (a resourcing lead needs to see the bench) but
 * leave every figure that divides by capacity, because their hours are not
 * sellable. See the spec for why "on the bench" is treated as unavailable
 * despite the usual reading of the phrase — it is a commercial statement, not
 * a scheduling one, and it is the user's explicit instruction (2026-08-17).
 *
 * NOT folded into dhOnLeave_ despite the identical carve. Leave is an absence
 * with a return date and an HR owner; bench is a commercial gap with a
 * resourcing owner. Merged, the two could not be told apart again without
 * re-reading the roster — and the 🏖 badge would paint a holiday marker on a
 * contractor who wants to be working.
 *
 * \b word boundaries: the token is short enough to appear inside an unrelated
 * free-text status, and a false positive here deletes a real person's capacity.
 */
var DH_BENCH_RE_ = /\bbench\b/i;
function dhOnBench_(status) {
  var s = String(status || "");
  return dhRosterRowActive_(s, "") && DH_BENCH_RE_.test(s);
}

/**
 * The leave/bench flag pair for one roster Employee Status, built once.
 *
 * Extracted so the roster read and the tests agree by construction rather than
 * by two copies of the same three expressions — the roster row previously
 * called dhOnLeave_ twice on the same string to derive the flag and its label.
 */
function dhBuildPersonFlags_(status) {
  var onLeave = dhOnLeave_(status);
  var onBench = dhOnBench_(status);
  return {
    onLeave: onLeave,
    leaveStatus: onLeave ? String(status).trim() : "",
    onBench: onBench,
    benchStatus: onBench ? String(status).trim() : "",
  };
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
        // ── Population gates, hoisted (2026-08-07) ────────────────────────────
        // Evaluated here rather than inline below because WORKFORCE CHANGE needs
        // them for people the population itself excludes: a leaver is gated out
        // by `active` three lines down, and measuring the capacity they took with
        // them requires knowing whether they were one of ours before they went.
        // Same booleans drive both, so "a Services delivery person" cannot come
        // to mean two things.
        var cls = iClass === -1 ? "" : String(raw[r][iClass] || "").trim();
        var dept = iDept === -1 ? "" : String(raw[r][iDept] || "").trim();
        // Fail-closed, unchanged: blank Class (FTE) or blank Department excludes.
        var classOk = src.crew || normDH_(cls) === normDH_(CONFIG_DH.ROSTER_CLASS);
        var deptOk = normDH_(dept) === normDH_(CONFIG_DH.ROSTER_DEPT);
        var inScope = classOk && deptOk;
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
                        hireDate: iHire === -1 ? null : parseDhDate_(raw[r][iHire]),
                        // WORKFORCE CHANGE (2026-08-07). The termination date was
                        // read on the line above and thrown away — only its
                        // truthiness reached dhRosterRowActive_ — so the roster
                        // could say a person is gone but never WHEN. Without the
                        // date a departure cannot be placed in a period, and a
                        // capacity loss that cannot be placed in a period cannot
                        // be set against the queue growth in that same period.
                        termDate: iTerm === -1 ? null : parseDhDate_(raw[r][iTerm]),
                        active: active,
                        // Was this person part of the Services delivery
                        // population? The family gate is NOT applied here —
                        // dhTracksTime_ is a separate policy applied by the
                        // caller, exactly as it is for the live population.
                        inScope: inScope });
        }
        if (!active) continue;                           // attrition — never in the population
        if (seen[normDH_(name)]) continue;               // boomerang/collision: first active wins
        // Gates are FAIL-CLOSED: a missing/blank Class or Department cell excludes
        // the row instead of waving it through — the Contractors Data tab has no
        // Department column, and fail-open here let every contractor (any dept,
        // any status) into the population. Unallocated crew = R&D by default
        // (demand-dashboard rule 2026-07-15), so no Department → not Services.
        // Computed above as classOk/deptOk so the workforce-change reader applies
        // the identical test to people this loop is about to drop.
        if (!inScope) continue;
        var loc = iLoc === -1 ? "" : String(raw[r][iLoc] || "").trim();
        var fam = dhFamilyFromTitle_(
          iFam === -1 ? "" : String(raw[r][iFam] || "").trim(),
          iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim());
        seen[normDH_(name)] = 1;
        var flags_ = dhBuildPersonFlags_(status);
        out.push({ name: name, keyLocation: loc,
                   rosterBucket: regionBucketFromLocation_(loc), isCrew: src.crew,
                   jobFamily: fam, tracks: dhTracksTime_(fam),
                   jobTitle: iTitle === -1 ? "" : String(raw[r][iTitle] || "").trim(),
                   onLeave: flags_.onLeave,
                   leaveStatus: flags_.leaveStatus,
                   onBench: flags_.onBench,
                   benchStatus: flags_.benchStatus,
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

// ══════════════════════════════════════════════════════════════════════════
// WORKFORCE CHANGE (user request 2026-08-07) — the capacity that joined and
// left, per ISO week.
//
// WHY THIS EXISTS. Every other number on this dashboard describes the people
// who are here now. A departure removes someone from the population entirely
// (readRosterPeople_ drops inactive rows) and their capacity silently leaves
// the denominators with them, so the utilization rate holds steady while the
// team's actual ability to deliver falls. The queue is growing ~75 items a
// week and nothing on the page could say whether that is demand arriving or
// supply leaving. This is the supply side, stated once, in hours.
//
// WHAT IT IS NOT. It is not a performance measure and it is not a list. Only
// counts and hours are published — never who left. Turnover is a fact about a
// team's capacity; naming the people inside it turns a planning number into a
// notice board, and this view is read by the whole company.
// ══════════════════════════════════════════════════════════════════════════

/**
 * A person's typical weekly scheduled capacity over a set of weeks.
 *
 * MEDIAN of the non-zero weeks, not the last week and not the mean. The final
 * week before a departure and the first week after a hire are nearly always
 * partial — notice period, handover, onboarding — and reading either as "the
 * capacity this person carried" would understate every departure and every
 * arrival. Zero weeks are dropped rather than averaged in for the same reason:
 * a zero is "not scheduled", which is what a leaver's last fortnight looks
 * like, not a measurement of what they were worth.
 *
 * @returns {?number} hours per week, or null when the person has no scheduled
 *   capacity anywhere in the window — an unknown, never a zero.
 */
function typicalWeeklyCap_(byIso, isos) {
  if (!byIso) return null;
  var vals = (isos || []).map(function (iso) { return byIso[iso]; })
    .filter(function (h) { return typeof h === "number" && !isNaN(h) && h > 0; });
  return vals.length ? medianOf_(vals) : null;
}

/** The up-to-`n` weeks of `weeks` that sit before (dir<0) or from (dir>0) `iso`. */
function weeksAround_(weeks, iso, dir, n) {
  var i = weeks.indexOf(iso);
  if (i === -1) return [];
  return dir < 0 ? weeks.slice(Math.max(0, i - n), i) : weeks.slice(i, i + n);
}

var WORKFORCE_CAP_LOOKBACK_ = 8;   // weeks of capacity behind a joiner/leaver

/**
 * Joiners and leavers per ISO week, with the scheduled capacity each carried.
 *
 * Additive per week, like every other bucket here, so the client can aggregate
 * over whatever period the header picker is on without the server knowing which
 * one that is.
 *
 * Scope is the SAME Services delivery population as every other card — the
 * class/department gates (`inScope`, hoisted in readRosterPeople_) and the
 * job-family tracking mandate. A departure from Sales is not a delivery
 * capacity loss, and counting it here would make this number disagree with the
 * roster beside it.
 *
 * ATTRITION IS ONE-SIDED, same rule as leaverTest_/filterActiveNames_: a person
 * counts as gone only when the roster PROVES it (an inactive row and no active
 * row anywhere). A boomerang rehire is therefore never a departure. Someone who
 * joined AND left inside the window is counted on both sides — both happened,
 * and the net correctly reads zero.
 *
 * @param {Object} roster readRosterPeople_ output
 * @param {Object} capByName readCapacitySheet_().byName
 * @param {Array<string>} weeks window.allWeeks, oldest first
 * @returns {Array<Object>} one row per ISO week that had any movement
 */
function workforceChangeBuckets_(roster, capByName, weeks) {
  var out = {}, act = (roster && roster.activeAll) || {},
      inact = (roster && roster.inactiveAll) || {};
  function row(iso) {
    if (!out[iso]) out[iso] = { iso: iso, joiners: 0, leavers: 0,
                                hoursGained: 0, hoursLost: 0,
                                // People whose movement is known but whose
                                // capacity is not. Counted separately rather
                                // than as 0 hours: "we lost someone and cannot
                                // say how much" is a different statement from
                                // "we lost nobody", and folding the first into
                                // the second is how a real loss disappears.
                                joinersNoCap: 0, leaversNoCap: 0 };
    return out[iso];
  }
  var inWindow = {};
  (weeks || []).forEach(function (w) { inWindow[w] = 1; });

  ((roster && roster.attrib) || []).forEach(function (p) {
    if (!p.inScope) return;
    if (dhTracksTime_(p.jobFamily) === false) return;
    var key = normDH_(p.name), cap = capByName ? capByName[key] : null;

    if (p.hireDate && !isNaN(p.hireDate.getTime())) {
      var hIso = weekKeyFromDate_(p.hireDate);
      if (inWindow[hIso]) {
        var r = row(hIso), gained = typicalWeeklyCap_(
          cap, weeksAround_(weeks, hIso, 1, WORKFORCE_CAP_LOOKBACK_));
        r.joiners++;
        if (gained === null) r.joinersNoCap++; else r.hoursGained += gained;
      }
    }
    // Proven-gone only. An inactive row for someone who also has an active row
    // is a rehire, and a termination date with no inactive status is a planned
    // future exit the roster has not applied yet — neither is attrition today.
    var gone = inact[key] && !act[key];
    if (gone && p.termDate && !isNaN(p.termDate.getTime())) {
      var tIso = weekKeyFromDate_(p.termDate);
      if (inWindow[tIso]) {
        var r2 = row(tIso), lost = typicalWeeklyCap_(
          cap, weeksAround_(weeks, tIso, -1, WORKFORCE_CAP_LOOKBACK_));
        r2.leavers++;
        if (lost === null) r2.leaversNoCap++; else r2.hoursLost += lost;
      }
    }
  });
  return Object.keys(out).sort().map(function (k) { return out[k]; });
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
    // ── ISSUE-LEVEL TRACE (read from 2026-08-10, Workforce Health) ────────────
    // Exported all along and never read here — the same shape as the Components
    // discovery: TempoTrackedTime.js has written "Issue", "Epic Key" and
    // "Parent Key" since the sheet was created, and this reader took only
    // User/Team/Key/PM. Without them tracked time is project-grained, and the
    // shadow split (spec §5.3) cannot ask the one question it exists to ask:
    // does this hour roll up to an epic anybody committed to?
    //
    // "Key" stays the PROJECT key — every existing consumer joins on it, and
    // repurposing it would silently redefine the team/PM/region vocabularies.
    // These three are ADDITIVE and default to "" so an older export (or the
    // Planned sheet, which has "Issue" but no epic columns) degrades to
    // "not measured" rather than to a false "no epic".
    var iIssue = colIdx_(hdRow, ["Issue"]);
    var iEpicK = colIdx_(hdRow, ["Epic Key"]);
    var iParentK = colIdx_(hdRow, ["Parent Key"]);
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
                  // Issue-level trace. Uppercased to match readJiraRaw_'s keys —
                  // the two exporters do not agree on casing and Jira keys are
                  // case-insensitive, so one canonical form is the only way the
                  // epic index can join. hasIssueCol distinguishes "this export
                  // has no Issue column" from "this row has no issue": the first
                  // is a coverage gap, the second is a project-level row, and
                  // collapsing them would report unmeasured work as unlinked work.
                  issue: iIssue === -1 ? "" : String(raw[r][iIssue] || "").trim().toUpperCase(),
                  epicKey: iEpicK === -1 ? "" : String(raw[r][iEpicK] || "").trim().toUpperCase(),
                  parentKey: iParentK === -1 ? "" : String(raw[r][iParentK] || "").trim().toUpperCase(),
                  hasIssueCol: iIssue !== -1,
                  hasEpicCol: iEpicK !== -1 || iParentK !== -1,
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

// ═══════════════════════════════════════════════════════════════════════════
// WORKFORCE HEALTH — CLASSIFICATION LAYER
// (Workforce Health Implementation Spec v1.1, 2026.W32, owner Workforce Planning)
//
// THE CLAIM THIS EXISTS TO SERVE: capacity is not fungible. A single blended
// availability percentage averages together people who cannot do each other's
// work, and this dashboard has exactly that disease — JF007 (Managed Services &
// Support) and JF009 (Service Delivery) sit in ONE population and report ONE
// utilisation, ONE planned-coverage and ONE weeks-to-clear. Support capacity is
// contracted and recurring; it is never drawn from the project backlog. Blending
// it makes the org look far more available than it is and mathematically
// guarantees you cannot see the pool that is actually out of room.
//
// WHY THE JOB CODE AND NOT THE TITLE TEXT: a job title carries four independent
// facts, and only the first four tokens are governed by the job architecture:
//
//     09.I4.3  -  Senior Engineer I,  Service Delivery
//     │  │ │ │     └── stem ──────┘   └── label ────┘
//     │  │ │ └── VARIANT   sub-track inside the family   ← THE KEY
//     │  │ └──── LEVEL     seniority                     ← level band
//     │  └────── TRACK     I = individual, M = management ← the mgmt override
//     └───────── FAMILY    job family                     ← scopes everything
//
// The discipline STRING cannot be the key, for three reasons measured on the
// live 215-row catalogue (spec §4.0):
//   1. It SPLITS.     "09|Service Delivery" is 36 people — 21 are .3 engineers
//                     and 15 are .1 consultants. Two pools, not interchangeable.
//   2. It COLLIDES.   "Delivery" appears in family 07 (delivery consultants,
//                     CONSUMER) and family 15 (SVP Delivery, GOVERNOR).
//   3. It FRAGMENTS.  Family 07 uses three strings — Customer Support (64),
//                     Support (2), Managed Services (1) — for what variant .1
//                     captures as one sub-track.
// And it is free text: an HRIS rename silently breaks the join. The variant
// digit does not move when someone retitles a discipline.
//
// The v1.0 draft of this spec DID key on discipline and put all 36 of
// "09|Service Delivery" into PS-ENGINEER. Five IC Senior Consultants on 09.1
// belong in PS-CONSULT: PS-ENGINEER was overstated by roughly a fifth, which
// moves its cover and headroom materially. dhStemWarning (below) is the
// cross-check that catches that class of error.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Job-code parser. TOLERANT BY DESIGN — the separator is optional and trailing
 * parentheticals are stripped, because a strict parser silently drops real rows:
 * this repo's own CompDash fixtures carry "03.I2.1 Data Analyst" (no dash) and
 * "07.m4.1" (lowercase track), and the live catalogue carries one row with a
 * trailing "(556)". A dropped row is an UNCLASSIFIED person, which reads on the
 * dashboard as a governance failure rather than as the parser bug it is.
 *
 * Case-insensitive on the track letter. The spec's own regex is not, and
 * CompDash has a passing test pinning "07.m4.1" → M4 — so a case-sensitive
 * parser here would disagree with the level splitter already shipping beside it.
 *
 * @param {string} raw full Job Title cell
 * @returns {{ok:boolean, reason?:string, raw:string, family?:string, track?:string,
 *             level?:number, variant?:string, subTrack?:string, stem?:string,
 *             stemBase?:string, discipline?:string}}
 */
function dhParseTitle_(raw) {
  var s = String(raw == null ? "" : raw);
  var m = /^\s*(\d{2})\.([IM])(\d{1,2})\.(\d)\s*(?:-\s*)?(.*)$/i.exec(s);
  if (!m) return { ok: false, reason: "does not match FF.Tn.v pattern", raw: s };

  var family = m[1], track = m[2].toUpperCase(), level = Number(m[3]), variant = m[4];
  var clean = String(m[5] || "")
    .replace(/\(\d+\)\s*$/, "")     // trailing "(556)" style suffixes
    .replace(/\s+/g, " ")
    .trim();

  // lastIndexOf, not indexOf: "Senior Engineer I, Service Delivery" splits at
  // the LAST comma, so a stem that itself contains a comma keeps its own text.
  var comma = clean.lastIndexOf(",");
  var stem = (comma === -1 ? clean : clean.slice(0, comma)).trim();
  var discipline = (comma === -1 ? clean : clean.slice(comma + 1)).trim();

  return {
    ok: true, raw: s,
    family: family, track: track, level: level, variant: variant,
    subTrack: family + "." + variant,                   // ← the classification key
    stem: stem,                                          // "Senior Engineer I"
    stemBase: stem.replace(/\s+(I{1,3})$/, "").trim(),   // "Senior Engineer"
    discipline: discipline,                              // display label only
  };
}

/**
 * family.variant → [backlogRole, deploymentPool, displayLabel].
 * The label is documentation: the UI shows it, the engine never reads it.
 */
var DH_SUB_TRACK_ = {
  "07.1": ["SUSTAINER", "MS-SUPPORT",  "Customer Support & Managed Services"],
  "07.2": ["CONSUMER",  "PS-CONSULT",  "Delivery Consulting"],
  "08.2": ["CONSUMER",  "TRAINING",    "Learning Solutions"],
  "09.1": ["CONSUMER",  "PS-CONSULT",  "Consulting (technical & service delivery)"],
  "09.3": ["CONSUMER",  "PS-ENGINEER", "Service Delivery Engineering"],
  "18.1": ["CREATOR",   "ARCH",        "Solution Architecture"],
};

/**
 * Fallback for families where the variant digit is NOT a sub-track boundary.
 * Every pool here is NONE, so the precision lost by falling back to free text
 * costs nothing — none of these people absorb backlog.
 */
var DH_BY_DISCIPLINE_ = {
  "15|Project Management":  ["GOVERNOR", "PMO"],
  "15|Resource Planning":   ["GOVERNOR", "NONE"],
  "15|Revenue Operations":  ["GOVERNOR", "NONE"],
  "15|Operations":          ["GOVERNOR", "NONE"],
  "15|Customer Operations": ["GOVERNOR", "NONE"],
  "15|Delivery":            ["GOVERNOR", "NONE"],
  "04|Account Management":     ["CREATOR", "NONE"],
  "04|Customer Solutions":     ["CREATOR", "NONE"],
  "04|Partner Practice Owner": ["CREATOR", "NONE"],
};

/** Families with no relationship to delivery backlog, whatever the discipline says. */
var DH_ENABLER_FAMILIES_ = { "01": 1, "03": 1, "13": 1, "14": 1, "16": 1, "17": 1 };

/** Titles that are enablers regardless of family. */
var DH_ENABLER_TITLES_ = {
  "chief executive officer": 1, "chief customer officer": 1, "strategic operations": 1,
};

/**
 * M-track inside a delivery family GOVERNS backlog rather than consuming it.
 *
 * ⚠ ADOPTING THIS MOVES EVERY PUBLISHED CAPACITY RATE (user decision
 * 2026-08-10). Before this, a delivery manager's scheduled hours sat in the
 * pool denominator and read as consultant capacity Sales could theoretically
 * sell. They now leave the pool entirely. Ships with a DH_SCHEMA_VER_ bump, a
 * changeLog entry, and `affects` populated so every affected trend line carries
 * the "✎ definition changed" marker — the step people see is the definition
 * moving, not delivery moving.
 */
var DH_MGMT_GOVERNS_ = { "07": 1, "09": 1, "18": 1 };

/**
 * Pool → expected stem shape. VALIDATES ONLY, never reclassifies.
 *
 * This is the guard that would have caught the v1.0 discipline-keying error
 * before it shipped: a person landing in PS-ENGINEER whose title stem says
 * "Consultant" is either a mistyped variant digit or a genuine hybrid role that
 * needs its own sub-track. Either way a human decides, not this file.
 */
var DH_STEM_EXPECT_ = {
  "PS-ENGINEER": /engineer/i,
  "PS-CONSULT":  /consultant|associate|intern|specialist/i,
  "ARCH":        /consultant|architect|director|manager/i,
};

/**
 * Level for a crew title that carries no full job code. Reuses the proven
 * level-token parser (`dhLevelTrack_`, which handles "I3" / "M5" anywhere in a
 * title), so a contractor hired against a level still lands in the right band
 * instead of collapsing everyone into UNKNOWN.
 */
function dhCrewLevel_(jobTitle) {
  var lt = dhLevelTrack_(jobTitle);
  if (!lt.track) return { track: null, level: null };
  return { track: lt.track === "M" ? "M" : "I",
           level: parseInt(String(lt.level).replace(/^[IM]/, ""), 10) || null };
}

/** Level → band. MGMT wins over level: an M-track person is never JUNIOR. */
function dhBand_(track, level) {
  if (track === "M") return "MGMT";
  if (!(level > 0)) return "UNKNOWN";
  return level <= 2 ? "JUNIOR" : level <= 4 ? "CORE" : "SENIOR";
}

/**
 * Classifies one person from their Job Title into the three attributes the
 * whole model turns on: backlog role, deployment pool, level band.
 *
 * The reporting grain is pool × band (`cell`). Not person, not department, not
 * company — an I3 cannot absorb an I5's epic, and a support engineer cannot
 * absorb a consulting epic at any level.
 *
 * UNCLASSIFIED IS NEVER ZERO BY ACCIDENT. A rising unclassified count means new
 * job codes were created and nobody told Workforce Planning. That is a real
 * signal, surfaced on the dashboard even at zero — a field that only appears
 * when it is broken gets ignored when it breaks.
 *
 * CREW ARE CLASSIFIED BY EMPLOYMENT TYPE, NOT BY JOB CODE (user report
 * 2026-08-10). Contractors carry no job-architecture code, so the parser
 * correctly failed on all 30 of them and the first live render showed
 * "30 unclassified" — a governance alarm for a population that was never
 * missing a rule, only a home. `isCrew` comes off the roster's Contractors tab
 * and is checked FIRST: a crew member's commercial model is what makes their
 * capacity non-interchangeable with an FTE consultant's, and that is true
 * whatever their title happens to say.
 *
 * @param {string} jobTitle
 * @param {boolean} [isCrew] roster Contractors-tab membership
 * @returns {{role:string, pool:string, band:string, cell:string, subTrack:string|null,
 *            disciplineLabel:string, level:number|null, track:string|null,
 *            family:string|null, stemWarning:string|null, classificationError:string|null}}
 */
function dhClassify_(jobTitle, isCrew) {
  var t = dhParseTitle_(jobTitle);
  if (isCrew) {
    // A crew title MAY still carry a level token (some contractors are hired
    // against a level); use it for the band when it is there, and fall back to
    // the IC level parser for titles that carry "I3" without a full job code.
    var lvl = t.ok ? { track: t.track, level: t.level } : dhCrewLevel_(jobTitle);
    return { role: "CONSUMER", pool: "CREW", band: dhBand_(lvl.track, lvl.level),
             cell: "CREW|" + dhBand_(lvl.track, lvl.level),
             subTrack: t.ok ? t.subTrack : null,
             disciplineLabel: "Crew (on demand)",
             level: lvl.level || null, track: lvl.track || null,
             family: t.ok ? t.family : null,
             stemWarning: null, classificationError: null, isCrew: true };
  }
  if (!t.ok) return dhUnclassified_(t.reason);

  var role = null, pool = null, label = t.discipline;
  var discKey = t.family + "|" + t.discipline;

  if (DH_ENABLER_TITLES_[normDH_(t.discipline)] || DH_ENABLER_FAMILIES_[t.family]) {
    role = "ENABLER"; pool = "NONE";
  } else if (DH_SUB_TRACK_[t.subTrack]) {
    role = DH_SUB_TRACK_[t.subTrack][0];
    pool = DH_SUB_TRACK_[t.subTrack][1];
    label = DH_SUB_TRACK_[t.subTrack][2];
  } else if (DH_BY_DISCIPLINE_[discKey]) {
    role = DH_BY_DISCIPLINE_[discKey][0];
    pool = DH_BY_DISCIPLINE_[discKey][1];
  } else {
    return dhUnclassified_("no rule for " + t.subTrack + " / " + discKey, t);
  }

  // Management override — applied AFTER the sub-track resolves, so a manager in
  // a delivery family keeps their family/variant for the audit trail while
  // leaving the pool their reports sit in.
  if (t.track === "M" && DH_MGMT_GOVERNS_[t.family]) { role = "GOVERNOR"; pool = "NONE"; }

  // Stem cross-check — a WARNING, never a reclassification (spec §4.3).
  // IC-only: an M-track title stem is a management noun and would false-positive
  // against every pool regex.
  var expect = DH_STEM_EXPECT_[pool];
  var stemWarning = (expect && t.track === "I" && t.stemBase && !expect.test(t.stemBase))
    ? 'stem "' + t.stemBase + '" unexpected for pool ' + pool : null;

  var band = dhBand_(t.track, t.level);
  return { role: role, pool: pool, band: band, cell: pool + "|" + band,
           subTrack: t.subTrack, disciplineLabel: label,
           level: t.level, track: t.track, family: t.family,
           stemWarning: stemWarning, classificationError: null };
}

/** The one shape an unclassifiable person takes. Never throws, never guesses. */
function dhUnclassified_(reason, t) {
  return { role: "UNCLASSIFIED", pool: "NONE", band: "UNKNOWN", cell: "NONE|UNKNOWN",
           subTrack: (t && t.subTrack) || null,
           disciplineLabel: (t && t.discipline) || "",
           level: (t && t.level) || null, track: (t && t.track) || null,
           family: (t && t.family) || null,
           stemWarning: null, classificationError: reason };
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFORCE HEALTH — POOL CONFIG AND SIGNAL THRESHOLDS (spec v1.1 §5.6)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Per-pool operating envelope.
 *
 * coverTarget: 0 means the pool is DEMAND-DRIVEN — its work arrives as tickets,
 * not as a plannable backlog. Cover is meaningless there and must render `n/a`,
 * never 0: a zero implies "no work left" for a pool that has no backlog BY
 * DESIGN, which is the single most dangerous false read on this surface.
 *
 * These are Workforce Planning's proposed envelopes, NOT ratified operating
 * targets. Every one carries `target: null` in the registry for the same reason
 * the queue metrics do — an unratified number on a C-suite surface reads as
 * agreed the moment it is on screen. Owner for ratification: Services Director.
 */
var DH_POOLS_ = {
  "PS-CONSULT":  { coverTarget: 10, coverFloor: 4, headroomFloor: 0.10, headroomCeil: 0.30, consumes: true },
  "PS-ENGINEER": { coverTarget: 10, coverFloor: 4, headroomFloor: 0.10, headroomCeil: 0.30, consumes: true },
  "MS-SUPPORT":  { coverTarget: 0,  coverFloor: 0, headroomFloor: 0.05, headroomCeil: 0.20, consumes: false },
  "ARCH":        { coverTarget: 6,  coverFloor: 3, headroomFloor: 0.15, headroomCeil: 0.35, consumes: true },
  "PMO":         { coverTarget: 0,  coverFloor: 0, headroomFloor: 0.10, headroomCeil: 0.25, consumes: false },
  "TRAINING":    { coverTarget: 8,  coverFloor: 3, headroomFloor: 0.10, headroomCeil: 0.35, consumes: true },
  // ── CREW — contracted delivery capacity, engaged on demand ────────────────
  // Added 2026-08-10 after the first live render showed 30 UNCLASSIFIED people
  // who are in fact crew (user report). They were unclassified because they are
  // contractors and carry no job-architecture code — the parser was working
  // correctly and the registry simply had no home for them.
  //
  // consumes:false and coverTarget:0 are the load-bearing choices, and they are
  // NOT a claim that crew do no project work — they plainly do. Cover asks "how
  // many weeks of backlog does this pool hold at its own weekly capacity", and
  // that question presumes a FIXED capacity the backlog is measured against.
  // On-demand capacity is the opposite: it is scaled TO the backlog. Publishing
  // a cover figure for it would invite the reading that crew are "running out
  // of work", when the correct reading is that nobody has booked them this week.
  // Their headroom is also not sellable headroom — unbooked crew is not paid
  // idle capacity, it is simply capacity not engaged.
  "CREW":        { coverTarget: 0,  coverFloor: 0, headroomFloor: 0,    headroomCeil: 1,    consumes: false },
  "NONE":        { coverTarget: 0,  coverFloor: 0, headroomFloor: 0,    headroomCeil: 1,    consumes: false },
};

/** Signal thresholds. A threshold change that breaks a test is a rollback, not a debate. */
var DH_WFH_CONFIG_ = {
  fidelityFloor:         0.80,
  shadowCeiling:         0.15,
  estimateCoverageFloor: 0.80,
  constraintFloor:       0.50,
  keyPersonThreshold:    3,
  // Population drift alarm (spec §7, the population trap). Availability is
  // published against 168 heads, Contribution against 152, the catalogue holds
  // 215 — three populations, one conversation. A trend drawn across a moving
  // population measures membership change as if it were performance change.
  popDriftAlert:         0.05,
};

/** Pool config lookup that never returns undefined. */
function dhPoolCfg_(pool) { return DH_POOLS_[pool] || DH_POOLS_.NONE; }

/** Division that yields null (not 0, not NaN) on a zero or absent denominator.
    null means "not measurable"; 0 means "measured, and it is zero". Collapsing
    the two is how a dashboard reports confident falsehoods. */
function dhSafeDiv_(a, b) {
  var n = Number(a), d = Number(b);
  if (!isFinite(n) || !isFinite(d) || d === 0) return null;
  return n / d;
}

/** Accumulator fetch-or-create, so no pass has to pre-seed its cell map. */
function dhCell_(map, key, seed) {
  if (!map[key]) {
    map[key] = { head: 0, grossHrs: 0, ptoHrs: 0,
                 committedHrs: 0, matchableCommittedHrs: 0, genericHrs: 0,
                 trackedTotalHrs: 0, trackedCommittedHrs: 0, trackedShadowHrs: 0,
                 shadowReasons: { "no-epic": 0, "no-srso": 0, "not-committed": 0 },
                 unmeasuredHrs: 0 };
    if (seed) for (var k in seed) map[key][k] = seed[k];
  }
  return map[key];
}

/**
 * Per-week accumulator: weekly[cellKey][iso].
 *
 * WHY WEEKLY AND NOT ONE PERIOD TOTAL. The payload is built once over the deep
 * window, but the reader drives a week/month/quarter picker. Shipping only a
 * period total would either freeze this view on one window or force a
 * round-trip per click. Shipping per-week buckets lets the client fold exactly
 * the weeks on screen — the same reason the utilization grid ships all weeks.
 *
 * Hours only. HEAD IS NOT WEEKLY: a person is one head across a period, not one
 * per week, so summing a weekly head count would multiply the population by the
 * window length. Heads are counted from the people list on whichever side is
 * doing the folding.
 */
function dhWeekCell_(weekly, key, iso) {
  if (!weekly[key]) weekly[key] = {};
  if (!weekly[key][iso]) {
    weekly[key][iso] = { grossHrs: 0, ptoHrs: 0, committedHrs: 0, matchableCommittedHrs: 0, genericHrs: 0,
                         trackedTotalHrs: 0, trackedCommittedHrs: 0,
                         trackedShadowHrs: 0, unmeasuredHrs: 0,
                         shadowReasons: { "no-epic": 0, "no-srso": 0, "not-committed": 0 } };
  }
  return weekly[key][iso];
}

/**
 * Payload trim for the weekly map: round every hour figure to 2dp and drop any
 * week that carries nothing at all.
 *
 * An hour sum accumulated in floating point serialises as 37.400000000000006 —
 * twenty characters for a figure no surface shows past one decimal. Across
 * cells × 52 weeks × ten fields that is most of this block's bytes, on a payload
 * that already has to be gzipped and chunked to fit CacheService's 100 KB
 * per-value ceiling.
 *
 * A dropped week is genuinely absent, not zero: the folds skip missing weeks
 * anyway (`if (!w) return`), so removing an all-zero bucket cannot change a
 * single folded total. Both twins are covered by _test_workforceParity_.
 */
function dhTrimWeekly_(weekly) {
  var r2 = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };
  var out = {};
  Object.keys(weekly || {}).forEach(function (key) {
    var weeks = {};
    Object.keys(weekly[key]).forEach(function (iso) {
      var w = weekly[key][iso];
      var sum = w.grossHrs + w.ptoHrs + w.committedHrs + w.genericHrs +
                w.trackedTotalHrs + w.unmeasuredHrs + w.matchableCommittedHrs;
      if (sum <= 0.005) return;      // nothing here — the fold would skip it anyway
      weeks[iso] = {
        grossHrs: r2(w.grossHrs), ptoHrs: r2(w.ptoHrs),
        committedHrs: r2(w.committedHrs),
        matchableCommittedHrs: r2(w.matchableCommittedHrs),
        genericHrs: r2(w.genericHrs),
        trackedTotalHrs: r2(w.trackedTotalHrs),
        trackedCommittedHrs: r2(w.trackedCommittedHrs),
        trackedShadowHrs: r2(w.trackedShadowHrs),
        unmeasuredHrs: r2(w.unmeasuredHrs),
        shadowReasons: { "no-epic": r2(w.shadowReasons["no-epic"]),
                         "no-srso": r2(w.shadowReasons["no-srso"]),
                         "not-committed": r2(w.shadowReasons["not-committed"]) },
      };
    });
    if (Object.keys(weeks).length) out[key] = weeks;
  });
  return out;
}

/** Merges b's hour buckets into a (both dhWeekCell_ shaped). */
function dhAddWeek_(a, b) {
  a.grossHrs += b.grossHrs; a.ptoHrs += b.ptoHrs;
  a.committedHrs += b.committedHrs;
  a.matchableCommittedHrs += (b.matchableCommittedHrs || 0);
  a.genericHrs += b.genericHrs;
  a.trackedTotalHrs += b.trackedTotalHrs;
  a.trackedCommittedHrs += b.trackedCommittedHrs;
  a.trackedShadowHrs += b.trackedShadowHrs;
  a.unmeasuredHrs += b.unmeasuredHrs;
  a.shadowReasons["no-epic"] += b.shadowReasons["no-epic"];
  a.shadowReasons["no-srso"] += b.shadowReasons["no-srso"];
  a.shadowReasons["not-committed"] += b.shadowReasons["not-committed"];
  return a;
}

/**
 * Folds weekly buckets down to one accumulator per cell over `isos`, attaching
 * the head count from `headByCell`.
 *
 * ⚠ CLIENT TWIN: Dashboard.html carries a copy so the period picker can
 * re-slice without a round-trip, and _test_workforceParity_ walks both. Two
 * copies of one fold drift silently and each looks correct alone — the same
 * failure mode utilFor_ and metricConfidence_ already have parity tests for.
 * Change one, change both.
 */
function dhFoldWeekly_(weekly, isos, headByCell) {
  var cells = {};
  Object.keys(weekly || {}).forEach(function (key) {
    var acc = null;
    (isos || []).forEach(function (iso) {
      var w = weekly[key][iso];
      if (!w) return;
      if (!acc) acc = dhCell_(cells, key);
      dhAddWeek_(acc, w);
    });
  });
  // Heads are attached for EVERY cell that has people, even one with no hours in
  // the window — a pool staffed but entirely unplanned and unlogged is a real
  // finding, and dropping it would hide the emptiest cell on the grid.
  Object.keys(headByCell || {}).forEach(function (key) {
    dhCell_(cells, key).head = headByCell[key];
  });
  return cells;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.1 CAPACITY — what we pay for
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gross scheduled capacity per pool×band cell over a set of ISO weeks.
 *
 * ⚠ PTO IS NOT SUBTRACTED (user decision 2026-08-10, upholding 2026-08-04).
 * The spec's §5.1 nets PTO and protected time out of capacity to produce a
 * "capacity truth" ratio. This dashboard cannot: there is no absence feed. The
 * only available proxy is Tempo-tracked NETSUITE time-off, which measures what
 * people LOGGED, not when they were away — so subtracting it would make the
 * teams with the best time-tracking discipline look least available, inverting
 * the signal exactly where it matters most. Capacity is therefore GROSS
 * scheduled hours, `capacityTruth` is null (not-measured, never 1.0 — a forced
 * 1.0 would assert "no capacity is lost before work starts", which is a claim
 * nobody measured), and ptoHrs is carried alongside for the drill-down so the
 * hours stay VISIBLE without entering the denominator.
 *
 * BENCH IS NOT SUBTRACTED EITHER, and that one is structural rather than a data
 * gap: bench is the RESULT of capacity minus commitment. Subtracting it would
 * make headroom always read ≈0, which is precisely the failure mode this whole
 * model exists to avoid.
 *
 * @param {Array<Object>} people model people (classified, with weeks)
 * @param {Array<string>} isos ISO week keys in the period
 * @returns {Object} cell key → accumulator
 */
function buildCapacity_(people, isos, weekly) {
  (people || []).forEach(function (p) {
    // attribOnly stubs carry a pool for display but no capacity by construction.
    // Filtered on the FLAG, not on an empty weeks map — a real person whose
    // whole period predates their hire date also has no weeks, and they must
    // still count as a head in their cell.
    if (p.attribOnly) return;
    var key = p.cell || "NONE|UNKNOWN";
    (isos || []).forEach(function (iso) {
      var w = p.weeks && p.weeks[iso];
      if (!w) return;                       // pre-hire week: does not exist for them
      var c = dhWeekCell_(weekly, key, iso);
      c.grossHrs += Number(w.cap) || 0;
      c.ptoHrs += Number(w.trackedOff) || 0;   // carried, never subtracted
    });
  });
  return weekly;
}

/** Head count per cell. Not weekly — see dhWeekCell_ on why. */
function dhHeadByCell_(people) {
  var head = {};
  (people || []).forEach(function (p) {
    if (p.attribOnly) return;
    var key = p.cell || "NONE|UNKNOWN";
    head[key] = (head[key] || 0) + 1;
  });
  return head;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.2 COMMITMENT — what we promised
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Planned (committed) hours per cell.
 *
 * DEVIATION FROM THE SPEC, STATED: the spec reads Tempo Plans directly and can
 * therefore separate USER from GENERIC (placeholder) assignees. This pipeline
 * reads the Planned Time Tempo EXPORT, which resolves every plan to a named
 * user before writing a row — so a generic allocation either lands on a person
 * or never reaches the sheet at all. `genericHrs` is consequently always 0 and
 * is reported as NOT MEASURED rather than as "no generic allocations", which
 * would be a confident claim about a thing nobody looked at. Surfacing generic
 * placeholders needs an exporter change (DATA-BLOCKERS).
 *
 * Plan rows for people outside the population are already dropped upstream by
 * the nameIdx join in assembleModel_, so there is no UNMATCHED bucket to build
 * here — the unmatched count is reported by that join, once, where it happens.
 */
function buildCommitment_(people, isos, weekly) {
  (people || []).forEach(function (p) {
    if (p.attribOnly) return;
    var key = p.cell || "NONE|UNKNOWN";
    (isos || []).forEach(function (iso) {
      var w = p.weeks && p.weeks[iso];
      if (!w) return;
      dhWeekCell_(weekly, key, iso).committedHrs += Number(w.planned) || 0;
    });
  });
  return weekly;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.3 CONSUMPTION — what actually happened, and the shadow split
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Epic index built from Jira Raw. Two lookups, both needed downstream:
 *   byKey  — issue key → record   (does this epic carry an SRSO component?)
 *   epicOf — child key → epic key (roll a worklog up to its programme)
 *
 * The chain is walked, not assumed: a sub-task's Parent Key is a Story, whose
 * own Epic Key is the epic. Walking one hop at a time with a visited guard
 * means a mis-exported cycle degrades to "no epic" instead of hanging the
 * rebuild — this runs inside a GAS execution with a hard timeout.
 */
function dhEpicIndex_(issues) {
  var byKey = {}, parentOf = {};
  (issues || []).forEach(function (it) {
    var k = String(it.key || "").trim().toUpperCase();
    if (!k) return;
    byKey[k] = it;
    // Epic Key is the direct link; Parent Key catches the sub-task → story hop.
    var up = it.epicKey || it.parentKey || "";
    if (up && up !== k) parentOf[k] = up;
  });
  return {
    byKey: byKey,
    /** Walks up to the containing epic. Returns "" when there is none. */
    epicFor: function (key) {
      var k = String(key || "").trim().toUpperCase();
      if (!k) return "";
      var seen = {}, hops = 0;
      while (k && !seen[k] && hops++ < 8) {
        seen[k] = 1;
        var rec = byKey[k];
        if (rec && rec.isEpic) return k;
        var up = parentOf[k];
        if (!up) return "";
        k = up;
      }
      return "";
    },
  };
}

/**
 * Epics that somebody was actually PLANNED onto, from the Planned Time export.
 *
 * COVERAGE IS THE POINT HERE. The Planned sheet carries an `Issue` column that
 * is populated only for ISSUE-level plans; a PROJECT-level plan has no issue by
 * nature and therefore names no epic. So this set is a LOWER BOUND on what was
 * committed, and `planIssueCoverage` reports how much of the planned volume
 * could be resolved to an epic at all. Without that ratio on screen, every
 * project-level plan in the company would read as `not-committed` shadow work
 * and route a real Resource Manager to a queue with nothing in it.
 *
 * COMMITMENT IS PER POOL, NOT GLOBAL. The spec is precise about this: a worklog
 * is committed consumption only if it rolls up to an epic that THE PERSON'S POOL
 * was committed to. A global epic set would silently absolve every pool the
 * moment any one pool was planned onto an epic — an engineer picking up a
 * consulting epic nobody staffed them on would read as planned work, which is
 * exactly the staffing decision `not-committed` exists to surface.
 *
 * @returns {{byPool:Object, set:Object, hrsWithIssue:number, hrsTotal:number,
 *            coverage:number|null}}
 */
function dhCommittedEpics_(plannedRows, epicIdx, isos, resolveName, peopleByName, weekly) {
  var byPool = {}, set = {}, hrsWithIssue = 0, hrsTotal = 0;
  var inWin = {};
  (isos || []).forEach(function (i) { inWin[i] = 1; });
  (plannedRows || []).forEach(function (row) {
    if (isTimeOffKey_(row.key)) return;          // time off plans no project work
    var hrs = 0;
    for (var iso in row.weekHours) if (inWin[iso]) hrs += Number(row.weekHours[iso]) || 0;
    if (hrs <= 0) return;
    hrsTotal += hrs;
    var ep = row.issue ? epicIdx.epicFor(row.issue) : "";
    // ── THE MATCHABLE DENOMINATOR (2026-08-10) ──────────────────────────────
    // Recorded per cell per week, because it is what fidelity must divide by.
    // Fidelity asks "of what we planned, how much got logged to those epics" —
    // and a PROJECT-level plan names no issue, so it can never be matched no
    // matter how well the work went. Dividing by ALL planned hours therefore
    // caps fidelity at the pool's plan-issue coverage and reports a pool that
    // plans at project level as one that delivers nothing.
    //
    // This was not hypothetical: the first live render showed PS-ENGINEER at
    // 1% fidelity, which is not a delivery signal at all — it is the shape of
    // that pool's planning. Dividing by the matchable hours asks a question the
    // data can actually answer.
    if (weekly && ep) {
      var dnM = resolveName ? resolveName(row.user) : null;
      var pM = dnM && peopleByName ? peopleByName[dnM] : null;
      if (pM && !pM.attribOnly) {
        var keyM = pM.cell || "NONE|UNKNOWN";
        for (var isoM in row.weekHours) {
          if (!inWin[isoM]) continue;
          var hM = Number(row.weekHours[isoM]) || 0;
          if (hM > 0) dhWeekCell_(weekly, keyM, isoM).matchableCommittedHrs += hM;
        }
      }
    }
    if (!ep) return;
    hrsWithIssue += hrs;
    set[ep] = 1;
    // Which pool was committed. A plan for someone outside the population still
    // counts toward coverage above — it was a real plan — but it commits no pool
    // here, because no pool of ours was staffed by it.
    var dn = resolveName ? resolveName(row.user) : null;
    var p = dn && peopleByName ? peopleByName[dn] : null;
    if (!p || !p.pool) return;
    if (!byPool[p.pool]) byPool[p.pool] = {};
    byPool[p.pool][ep] = 1;
  });
  return { byPool: byPool, set: set, hrsWithIssue: hrsWithIssue, hrsTotal: hrsTotal,
           coverage: dhSafeDiv_(hrsWithIssue, hrsTotal) };
}

/**
 * Tracked hours per cell, split into committed work and SHADOW work.
 *
 * A worklog counts as COMMITTED only if it rolls up to an epic that is bound to
 * a sales order AND that somebody was planned onto. Everything else is shadow —
 * real demand that planning cannot see. The three shadow reasons have three
 * different owners, which is why they are never summed into one number:
 *
 *   no-epic        worklog on an issue with no epic parent    → Project Manager
 *   no-srso        epic exists, carries no SRSO component     → PM + Finance
 *   not-committed  real committed work, nobody planned them   → Resource Manager
 *
 * MEASURABILITY IS SEPARATED FROM THE VERDICT. If the export has no Epic Key
 * column, or Jira Raw has no Components column, those hours land in
 * `unmeasuredHrs` — NOT in shadow. Collapsing "we did not look" into "there is
 * no epic" would report a ~100% shadow ratio on an older export and send the
 * whole delivery org chasing a reporting artefact. Same tristate discipline the
 * SRSO and reopened columns already use.
 *
 * Time-off (NETSUITE) hours are excluded from both sides: they are not project
 * work, and counting them as shadow would make PTO look like invisible demand.
 */
function buildConsumption_(trackedRows, resolveName, peopleByName, epicIdx, committed, isos, weekly) {
  var inWin = {};
  (isos || []).forEach(function (i) { inWin[i] = 1; });

  (trackedRows || []).forEach(function (row) {
    var dn = resolveName(row.user);
    if (!dn) return;                                  // outside the population
    var p = peopleByName[dn];
    if (!p || p.attribOnly) return;
    if (isTimeOffKey_(row.key)) return;               // time off is not project work

    // The VERDICT is a property of the row (which epic, bound or not, committed
    // or not) and does not vary by week — so it is decided ONCE here, then the
    // row's hours are posted to whichever weeks they were logged in. Deciding
    // per week would re-walk the epic chain for every week of every row.
    var key = p.cell || "NONE|UNKNOWN";
    var bucket;                                       // which field the hours land in
    var reason = null;
    if (!row.hasEpicCol && !row.hasIssueCol) {
      bucket = "unmeasuredHrs";                       // this export cannot answer
    } else {
      var epicKey = row.epicKey ? epicIdx.epicFor(row.epicKey)
                  : row.parentKey ? epicIdx.epicFor(row.parentKey)
                  : row.issue ? epicIdx.epicFor(row.issue) : "";
      var epic = epicKey ? epicIdx.byKey[epicKey] : null;
      if (!epicKey) {
        bucket = "trackedShadowHrs"; reason = "no-epic";
      } else if (epic && (epic.srsoComponent === null || epic.srsoComponent === undefined)) {
        // TRISTATE: null = the Components column was absent, so nobody looked.
        // Those hours are unmeasured, not unbound.
        bucket = "unmeasuredHrs";
      } else if (!epic || !epic.srsoComponent) {
        bucket = "trackedShadowHrs"; reason = "no-srso";
      } else if (!committed.byPool[p.pool] || !committed.byPool[p.pool][epicKey]) {
        // Per POOL, not globally — see dhCommittedEpics_. An engineer working a
        // consulting epic nobody staffed them on is a staffing decision to
        // surface, not planned work to absolve.
        bucket = "trackedShadowHrs"; reason = "not-committed";
      } else {
        bucket = "trackedCommittedHrs";
      }
    }

    for (var iso in row.weekHours) {
      if (!inWin[iso]) continue;
      var hrs = Number(row.weekHours[iso]) || 0;
      if (hrs <= 0) continue;
      var c = dhWeekCell_(weekly, key, iso);
      c.trackedTotalHrs += hrs;
      c[bucket] += hrs;
      if (reason) c.shadowReasons[reason] += hrs;
    }
  });
  return weekly;
}

// ═══════════════════════════════════════════════════════════════════════════
// §4.6 requiredPool — which pool can actually absorb this epic
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pool that has historically worked each epic — the dominant logger of hours
 * over the trailing window. This is resolution step 3, and in this deployment it
 * is the FIRST step that can fire: there is no `requiredPool` custom field in
 * Jira (step 1) and no `allocationType` field in the export (step 2), so both
 * are noted as upstream asks rather than coded against fields that do not exist.
 *
 * @returns {Object} epicKey → { pool, hrs, poolHrs }
 */
function dhDominantPoolByEpic_(trackedRows, resolveName, peopleByName, epicIdx, isos) {
  var byEpic = {};
  var inWin = {};
  (isos || []).forEach(function (i) { inWin[i] = 1; });
  (trackedRows || []).forEach(function (row) {
    if (isTimeOffKey_(row.key)) return;
    var dn = resolveName(row.user);
    if (!dn) return;
    var p = peopleByName[dn];
    if (!p || !p.pool || p.pool === "NONE") return;   // governors route nothing
    var epicKey = row.epicKey ? epicIdx.epicFor(row.epicKey)
                : row.parentKey ? epicIdx.epicFor(row.parentKey)
                : row.issue ? epicIdx.epicFor(row.issue) : "";
    if (!epicKey) return;
    var hrs = 0;
    for (var iso in row.weekHours) if (inWin[iso]) hrs += Number(row.weekHours[iso]) || 0;
    if (hrs <= 0) return;
    if (!byEpic[epicKey]) byEpic[epicKey] = {};
    byEpic[epicKey][p.pool] = (byEpic[epicKey][p.pool] || 0) + hrs;
  });
  var out = {};
  Object.keys(byEpic).forEach(function (ek) {
    var best = null, bestHrs = 0, total = 0;
    Object.keys(byEpic[ek]).forEach(function (pool) {
      var h = byEpic[ek][pool];
      total += h;
      // Deterministic tie-break by pool name — a tie that flipped between
      // rebuilds would move backlog between pools with no data change, and the
      // trend would show a reallocation nobody made.
      if (h > bestHrs || (h === bestHrs && best !== null && pool < best)) { best = pool; bestHrs = h; }
    });
    if (best) out[ek] = { pool: best, hrs: bestHrs, poolHrs: total };
  });
  return out;
}

/**
 * Resolves the pool that must absorb an epic. First hit wins (spec §4.6).
 *
 * UNROUTED IS NOT NOISE AND IS NEVER SILENTLY DISTRIBUTED. It is work no pool
 * can plan — the direct analogue of the Delivery Manager coverage gap — so it
 * gets its own bar rather than being spread across the pools that happen to
 * exist. Spreading it would make every pool's cover look worse by an amount
 * nobody chose, and would hide the routing gap entirely.
 */
function dhRequiredPool_(epic, dominant, projectDefaults) {
  if (epic && epic.requiredPool) return epic.requiredPool;          // step 1 — field absent today
  if (epic && epic.allocationType && DH_ALLOCATION_TO_POOL_[epic.allocationType])
    return DH_ALLOCATION_TO_POOL_[epic.allocationType];             // step 2 — field absent today
  var key = String((epic && epic.key) || "").trim().toUpperCase();
  var h = dominant[key];
  if (h) return h.pool;                                             // step 3 — measured history
  var proj = key.split("-")[0];
  if (projectDefaults && projectDefaults[proj]) return projectDefaults[proj];  // step 4
  return "UNROUTED";                                                // step 5 — counted, shown
}

/** allocationType → pool. Empty until the Jira custom field exists (DATA-BLOCKERS). */
var DH_ALLOCATION_TO_POOL_ = {};

// ═══════════════════════════════════════════════════════════════════════════
// §5.4 BACKLOG — remaining obligation per pool
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Open backlog hours per required pool, with the estimate grossing-up.
 *
 * DEVIATION, STATED: the spec reads Jira's `timeestimate` (remaining). This
 * export carries only `Original Estimate (sec)` and `Time Spent (sec)`, so
 * remaining is derived as max(0, original − spent). That is a PROXY: on an epic
 * that overran, remaining reads 0 when real work is left, so the raw figure is
 * a lower bound twice over. The card says so.
 *
 * The grossing-up matters more than it looks. Estimate coverage sits around 78%
 * company-wide, so publishing raw remaining hours understates the real
 * obligation by roughly a fifth. Both numbers ship, and the raw one is labelled
 * a lower bound rather than quietly replaced.
 */
function buildBacklog_(epics, dominant, projectDefaults) {
  var byPool = {};
  (epics || []).forEach(function (e) {
    if (e.statusCategory === "Done" || e.resolved) return;   // open backlog only
    var pool = dhRequiredPool_(e, dominant, projectDefaults);
    if (!byPool[pool]) byPool[pool] = { backlogHrs: 0, epicCount: 0, unestimatedEpics: 0 };
    var b = byPool[pool];
    var est = Number(e.estSec) || 0;
    var spent = Number(e.spentSec) || 0;
    b.backlogHrs += Math.max(0, est - spent) / 3600;
    b.epicCount++;
    if (!est) b.unestimatedEpics++;
  });
  Object.keys(byPool).forEach(function (pool) {
    var b = byPool[pool];
    b.estimateCoverage = b.epicCount ? 1 - b.unestimatedEpics / b.epicCount : null;
    // Gross up for the work we know exists but nobody estimated. At zero
    // coverage there is nothing to scale FROM, so the adjusted figure is the raw
    // one and the card reports coverage 0 rather than inventing a multiplier.
    b.backlogAdjHrs = (b.estimateCoverage && b.estimateCoverage > 0)
      ? b.backlogHrs / b.estimateCoverage
      : b.backlogHrs;
  });
  return byPool;
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.5 RECONCILE — the three quantities meet, and the gaps become the signal
// ═══════════════════════════════════════════════════════════════════════════

/**
 * One row per pool×band cell.
 *
 *   CAPACITY  − COMMITMENT  = sellable headroom  → true availability, for Sales
 *   COMMITMENT − CONSUMPTION = execution gap     → allocated, not delivered
 *   CONSUMPTION with no epic = shadow work       → demand nobody planned
 *
 * The health signal lives in the DISAGREEMENT between the three, which is why
 * none of them is published alone.
 *
 * @param {number} weeksInPeriod real week count — NOT the spec's 4.33 constant.
 *   This dashboard's period picker spans weeks, months and quarters, so a fixed
 *   weeks-per-period would misstate cover by up to 3× on a quarterly view. Cover
 *   is weeks of work, so the denominator must be the weeks actually selected.
 */
function reconcileWorkforce_(folded, backlog, weeksInPeriod) {
  var cells = Object.keys(folded || {}).sort().map(function (key) {
    var parts = key.split("|");
    var pool = parts[0], band = parts[1];
    var cap = folded[key], com = cap, con = cap;   // one folded accumulator per cell
    var bl = backlog[pool] || null;
    var cfg = dhPoolCfg_(pool);

    var deployable = cap.grossHrs;   // gross — see buildCapacity_ on why
    var weekly = weeksInPeriod > 0 ? deployable / weeksInPeriod : 0;
    var shadowDen = con.trackedTotalHrs - con.unmeasuredHrs;

    return {
      pool: pool, band: band, cell: key, head: cap.head, cfg: cfg,
      grossHrs: cap.grossHrs, deployableHrs: deployable,
      ptoHrs: cap.ptoHrs,
      // NOT MEASURED, deliberately null — no absence feed exists. A forced 1.0
      // would assert that no paid capacity is lost before work starts.
      capacityTruth: null,
      committedHrs: com.committedHrs,
      // Planned hours that name an issue and so CAN be matched to an epic. The
      // fidelity denominator — see dhCommittedEpics_ on why the full committed
      // figure is the wrong one.
      matchableCommittedHrs: com.matchableCommittedHrs,
      planMatchable: dhSafeDiv_(com.matchableCommittedHrs, com.committedHrs),
      // Always 0 in this deployment; the export resolves every plan to a named
      // user. Reported as not-measured by the renderer, never as "none".
      genericHrs: com.genericHrs,
      headroomHrs: deployable - com.committedHrs,
      headroomPct: dhSafeDiv_(deployable - com.committedHrs, deployable),
      trackedTotalHrs: con.trackedTotalHrs,
      trackedCommittedHrs: con.trackedCommittedHrs,
      trackedShadowHrs: con.trackedShadowHrs,
      unmeasuredHrs: con.unmeasuredHrs,
      // Gap measured on the MATCHABLE basis, so it is the same population the
      // fidelity ratio describes. A gap against all planned hours would include
      // plans that could never be matched and would always look enormous.
      executionGapHrs: com.matchableCommittedHrs - con.trackedCommittedHrs,
      // FIDELITY IS NULL WHEN NOTHING WAS MEASURABLE, and the denominator is the
      // MATCHABLE planned hours (see dhCommittedEpics_). Two separate ways this
      // number can be unmeasurable rather than bad:
      //   · every logged hour in the cell was unclassifiable (no Epic Key or no
      //     Components column) — trackedCommitted is 0 for want of a
      //     measurement, not for want of delivery;
      //   · the cell's plans are all project-level, so nothing can be matched at
      //     all. This is what produced the 1% PS-ENGINEER reading on the first
      //     live render — the shape of that pool's planning, not its delivery.
      // A cell that logged NOTHING against plans that COULD have matched is
      // different: that 0 is a measurement, and it stands.
      commitmentFidelity: (con.trackedTotalHrs > 0 && shadowDen <= 0)
        ? null
        : dhSafeDiv_(con.trackedCommittedHrs, com.matchableCommittedHrs),
      shadowReasons: con.shadowReasons,
      // Denominator EXCLUDES unmeasured hours: a ratio over hours nobody could
      // classify would read as shadow that isn't there.
      shadowRatio: dhSafeDiv_(con.trackedShadowHrs, shadowDen),
      estimateCoverage: bl ? bl.estimateCoverage : null,
      backlogHrs: bl ? bl.backlogHrs : null,
      backlogAdjHrs: bl ? bl.backlogAdjHrs : null,
      // Cover is meaningless for a demand-driven pool — null, never 0.
      coverWeeks: (cfg.coverTarget > 0 && bl) ? dhSafeDiv_(bl.backlogAdjHrs, weekly) : null,
    };
  });

  // Constraint index = this pool's cover against the portfolio median. Below
  // 0.5 means everyone else's plan queues behind this pool.
  var covers = cells.map(function (c) { return c.coverWeeks; })
                    .filter(function (v) { return v !== null && isFinite(v); });
  var medianCover = covers.length ? medianOf_(covers) : null;
  cells.forEach(function (c) {
    c.constraintIndex = (c.coverWeeks === null || medianCover === null || medianCover === 0)
      ? null : c.coverWeeks / medianCover;
    c.actionState = dhActionState_(c);
    // "SMALL CELL", not the spec's "KEY-PERSON": it is a statement about the
    // SAMPLE — every figure on the row turns on one person's week — not a
    // judgement that the team is a risk (user decision 2026-08-10).
    c.structuralRisk = c.head > 0 && c.head <= DH_WFH_CONFIG_.keyPersonThreshold ? "SMALL CELL" : "";
    c.read = dhWorkforceRead_(c);
  });
  return { cells: cells, medianCover: medianCover };
}

// ═══════════════════════════════════════════════════════════════════════════
// §5.6 SIGNALS AND ACTION STATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The state of a cell, as a DESCRIPTION of where it sits — not a verdict on it.
 *
 * ⚠ THIS IS DELIBERATELY NOT THE SPEC'S VOCABULARY (user decision 2026-08-10).
 * The source spec names these INTERVENE / SELL / HIRE / REASSESS / EXECUTE.
 * Those are instructions, and three of them are alarms. On a business that is
 * delivering week over week and carrying a healthy backlog, an INTERVENE chip
 * is simply wrong: it asserts a problem from a signal that has ordinary
 * explanations, and a dashboard that cries wolf on a good week gets ignored on
 * a bad one.
 *
 * So the states say WHERE THE CELL SITS and let the reader draw the conclusion:
 *
 *   STEADY         inside its own envelope
 *   HEADROOM       room to take on more
 *   AT CAPACITY    little room left against a deep backlog
 *   REVIEW         thin backlog and little room — worth a look, not an alarm
 *   RECONCILE      plan and logged time disagree, or work is landing outside
 *                  the planned epics. A measurement gap first, a delivery
 *                  question only after somebody checks.
 *   DEMAND-DRIVEN  no plannable backlog by design
 *
 * A null signal never triggers a state: "not measured" is not "breached". The
 * spec's own safeDiv returns 0 on a zero denominator, which would put RECONCILE
 * on every pool that simply has no plan. dhSafeDiv_ returns null and this chain
 * skips it.
 */
function dhActionState_(c) {
  var fidelityGap = c.commitmentFidelity !== null && c.commitmentFidelity < DH_WFH_CONFIG_.fidelityFloor;
  var shadowGap = c.shadowRatio !== null && c.shadowRatio > DH_WFH_CONFIG_.shadowCeiling;
  if (fidelityGap || shadowGap) return "RECONCILE";
  if (c.coverWeeks === null) return "DEMAND-DRIVEN";
  if (c.headroomPct === null) return "NOT MEASURED";
  var cfg = c.cfg;
  if (c.coverWeeks < cfg.coverFloor && c.headroomPct > cfg.headroomCeil) return "HEADROOM";
  if (c.coverWeeks >= cfg.coverTarget && c.headroomPct < cfg.headroomFloor) return "AT CAPACITY";
  if (c.coverWeeks < cfg.coverFloor && c.headroomPct < cfg.headroomFloor) return "REVIEW";
  return "STEADY";
}

/** Largest shadow reason by hours, for the Read sentence. */
function dhTopShadowReason_(reasons) {
  var best = null, bestHrs = 0;
  Object.keys(reasons || {}).forEach(function (k) {
    if (reasons[k] > bestHrs) { best = k; bestHrs = reasons[k]; }
  });
  return best;
}

/** Owner of each shadow reason — three reasons, three different desks. */
var DH_SHADOW_OWNER_ = {
  "no-epic": "Project Manager",
  "no-srso": "Project Manager + Finance",
  "not-committed": "Resource Manager",
};

/**
 * The most notable OBSERVATION about a cell, in one sentence.
 *
 * ⚠ OBSERVATIONS, NOT DIAGNOSES (user decision 2026-08-10). The source spec's
 * sentences read as verdicts — *"Allocations are ahead of reality — find the
 * blocker before adding work"* — and that is a claim about CAUSE that this data
 * cannot support. A planned-versus-logged gap has several ordinary
 * explanations before it has an alarming one:
 *
 *   · plans are coarse-grained and worklogs are not, so they never tie exactly;
 *   · logging lags the work by days, so a period boundary splits them;
 *   · the window can include planned weeks that have not happened yet;
 *   · only issue-level plans resolve to an epic at all, so the committed set is
 *     a lower bound by construction (see dhCommittedEpics_).
 *
 * On an organisation delivering steadily week over week, a confident
 * "allocations are ahead of reality" is simply wrong — and a surface that
 * raises a false alarm on a good week is ignored on a bad one.
 *
 * So each sentence states WHAT WAS MEASURED, against WHAT DENOMINATOR, and —
 * where the number is easy to misread — what it does NOT mean. The reader draws
 * the conclusion; that is the whole point of showing them the number.
 *
 * Structural risk is deliberately NOT in this chain — a small pool must never
 * crowd out a reconciliation signal. It renders in its own column instead.
 */
function dhWorkforceRead_(c) {
  var pct = function (v) { return Math.round(v * 100) + "%"; };
  var hrs = function (v) { return Math.round(v).toLocaleString() + "h"; };
  if (c.commitmentFidelity !== null && c.commitmentFidelity < DH_WFH_CONFIG_.fidelityFloor)
    return hrs(c.matchableCommittedHrs) + " planned at issue level, " +
           hrs(c.trackedCommittedHrs) + " logged against those epics (" +
           pct(c.commitmentFidelity) + "). " +
           "Plans and worklogs are different grains and rarely tie exactly — read this as a " +
           "reconciliation signal, not as work that did not happen.";
  if (c.shadowRatio !== null && c.shadowRatio > DH_WFH_CONFIG_.shadowCeiling) {
    var top = dhTopShadowReason_(c.shadowReasons);
    return pct(c.shadowRatio) + " of classifiable hours here are on work outside the planned, " +
           "sales-order-bound epics" +
           (top ? " — mostly " + top + ", which sits with the " + DH_SHADOW_OWNER_[top] : "") +
           ". Delivered work, just not traceable to a plan yet.";
  }
  if (c.coverWeeks !== null && c.estimateCoverage !== null &&
      c.estimateCoverage < DH_WFH_CONFIG_.estimateCoverageFloor)
    return pct(c.estimateCoverage) + " of this pool's open epics carry an estimate, so its " +
           "backlog figure is a lower bound rather than a measurement.";
  if (c.constraintIndex !== null && c.constraintIndex < DH_WFH_CONFIG_.constraintFloor)
    return "Cover is " + (c.constraintIndex < 1 ? "well below" : "around") +
           " the portfolio median for pools that carry backlog — the tightest pool of the set.";
  if (c.head > 0 && c.head <= DH_WFH_CONFIG_.keyPersonThreshold)
    return c.head + (c.head === 1 ? " person" : " people") + " in this cell, so every number on " +
           "this row moves on one individual's week.";
  return "Nothing notable — the measures sit inside this pool's own range.";
}

// ═══════════════════════════════════════════════════════════════════════════
// §4.4 DISCIPLINE SECTION — how humans navigate the same cells
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The engine groups by pool; PEOPLE navigate by discipline. This is a
 * PRESENTATION layer over the same cells, never a second source of truth — it
 * re-buckets the already-classified population and cannot disagree with the
 * pool grid, because it never recomputes anything.
 *
 * Sorted consumers-first, then by headcount: the order leadership should read in.
 */
var DH_ROLE_ORDER_ = { CONSUMER: 0, CREATOR: 1, GOVERNOR: 2, SUSTAINER: 3, ENABLER: 4, UNCLASSIFIED: 5 };

function disciplineSection_(people) {
  var rows = {};
  (people || []).forEach(function (p) {
    if (p.attribOnly) return;
    var key = (p.pool || "NONE") + "|" + (p.disciplineLabel || "—");
    if (!rows[key]) rows[key] = { pool: p.pool || "NONE", discipline: p.disciplineLabel || "—",
                                  role: p.backlogRole || "UNCLASSIFIED", subTrack: p.subTrack || null,
                                  head: 0, bands: {} };
    var r = rows[key];
    r.head++;
    r.bands[p.band] = (r.bands[p.band] || 0) + 1;
  });
  return Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) {
    var ao = DH_ROLE_ORDER_[a.role], bo = DH_ROLE_ORDER_[b.role];
    if (ao !== bo) return (ao === undefined ? 9 : ao) - (bo === undefined ? 9 : bo);
    return b.head - a.head;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKFORCE HEALTH — TOP-LEVEL ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Runs all six passes and returns the payload the Workforce Health view renders.
 *
 * Pure: every reader output is injected. Same input, same output, no I/O.
 *
 * SCOPE IS PINNED AND ASSERTED, not assumed (spec §7, the population trap).
 * Availability is published against 168 heads, Contribution against 152, and
 * the job catalogue holds 215 — three populations in one conversation. This
 * dashboard's population is narrower still (Class Professional Services +
 * Department Services + the tracking-mandate allowlist), so the banner states
 * the count and the pools that are OUT of scope by construction. Without that,
 * every trend drawn here measures membership change as if it were performance.
 */
function buildWorkforceHealth_(people, trackedRows, plannedRows, jira, resolveName, isos, prevPop) {
  var byName = {};
  (people || []).forEach(function (p) { byName[p.name] = p; });
  var weeksInPeriod = (isos || []).length || 1;

  var epicIdx = dhEpicIndex_((jira && jira.issues) || []);
  // ONE weekly map, written by every pass. They accumulate different fields of
  // the same per-cell-per-week bucket, so a cell that exists in only one of them
  // (capacity but no plan, plan but no logged time) still appears with the
  // others at zero rather than being dropped by a key mismatch.
  //
  // Declared BEFORE dhCommittedEpics_ because that pass also writes to it: the
  // matchable-planned-hours denominator is a per-cell-per-week figure and has to
  // fold with the period picker like everything else.
  var weekly = {};
  var committed = dhCommittedEpics_(plannedRows, epicIdx, isos, resolveName, byName, weekly);
  var dominant = dhDominantPoolByEpic_(trackedRows, resolveName, byName, epicIdx, isos);

  buildCapacity_(people, isos, weekly);
  buildCommitment_(people, isos, weekly);
  buildConsumption_(trackedRows, resolveName, byName, epicIdx, committed, isos, weekly);
  var headByCell = dhHeadByCell_(people);
  var backlog = buildBacklog_((jira && jira.epics) || [], dominant, {});
  var rec = reconcileWorkforce_(dhFoldWeekly_(weekly, isos, headByCell), backlog, weeksInPeriod);

  // ── Scope facts. Reported even at zero, always (spec §6.3). ────────────────
  var inPop = (people || []).filter(function (p) { return !p.attribOnly; });
  var unclassified = inPop.filter(function (p) { return p.backlogRole === "UNCLASSIFIED"; });
  var stemWarnings = inPop.filter(function (p) { return !!p.stemWarning; });
  var consumers = inPop.filter(function (p) { return p.backlogRole === "CONSUMER"; });

  // Pools the classification knows about but this population cannot contain,
  // because the tracking-mandate allowlist excludes their families entirely.
  // Named explicitly so "PS-CONSULT, PS-ENGINEER, MS-SUPPORT" does not read as
  // the whole company's pool structure.
  var present = {};
  inPop.forEach(function (p) { present[p.pool] = 1; });
  var absentPools = Object.keys(DH_POOLS_).filter(function (pool) {
    return pool !== "NONE" && !present[pool];
  });

  // Population drift alarm. A trend line that moves because the population
  // moved is measuring membership, not performance.
  var drift = null;
  if (prevPop > 0) {
    var delta = (inPop.length - prevPop) / prevPop;
    drift = { prev: prevPop, now: inPop.length, pct: delta,
              alert: Math.abs(delta) > DH_WFH_CONFIG_.popDriftAlert };
  }

  // ── Consumers-only summary: the honest backlog-cover denominator ───────────
  // "32% available" is a rumour. "32% available (of 63 consumers)" is a fact.
  var consumerCells = rec.cells.filter(function (c) { return dhPoolCfg_(c.pool).consumes; });
  var sum = function (f) {
    return consumerCells.reduce(function (a, c) { return a + (Number(f(c)) || 0); }, 0);
  };
  var consGross = sum(function (c) { return c.grossHrs; });
  var consCommitted = sum(function (c) { return c.committedHrs; });
  var consumersOnly = {
    head: consumerCells.reduce(function (a, c) { return a + c.head; }, 0),
    grossHrs: consGross, committedHrs: consCommitted,
    headroomHrs: consGross - consCommitted,
    headroomPct: dhSafeDiv_(consGross - consCommitted, consGross),
    // The denominator, shipped WITH the number so no surface can drop it.
    denominatorLabel: "of " + consumers.length + " backlog consumers",
  };

  return {
    // Per-cell-per-week hours, so the client can fold exactly the weeks the
    // period picker has on screen (dhFoldWeekly_ + reconcileWorkforce_ both have
    // client twins with a parity test). `cells` below is the DEEP-WINDOW fold,
    // kept for anything that wants the whole history without re-folding.
    //
    // TRIMMED before it ships. This is cells × 52 weeks × ten figures on a
    // payload already large enough to need gzipping and chunking, and the raw
    // numbers are floating-point hour sums that serialise as things like
    // 37.400000000000006 — twenty characters to express two decimal places
    // nobody displays. Rounding and dropping all-zero weeks costs no accuracy
    // any surface can see and takes a large bite out of the JSON.
    weekly: dhTrimWeekly_(weekly),
    headByCell: headByCell,
    cells: rec.cells,
    medianCover: rec.medianCover,
    disciplines: disciplineSection_(people),
    backlogByPool: backlog,
    consumersOnly: consumersOnly,
    scope: {
      population: inPop.length,
      consumers: consumers.length,
      unclassified: unclassified.length,
      unclassifiedReasons: unclassified.slice(0, 12).map(function (p) {
        return { jobTitle: p.jobTitle, reason: p.classificationError };
      }),
      stemWarnings: stemWarnings.length,
      stemWarningDetail: stemWarnings.slice(0, 12).map(function (p) {
        return { jobTitle: p.jobTitle, pool: p.pool, warning: p.stemWarning };
      }),
      absentPools: absentPools,
      weeksInPeriod: weeksInPeriod,
      drift: drift,
    },
    coverage: {
      // How much planned volume could be resolved to an epic at all. Without
      // this, project-level plans read as `not-committed` shadow.
      planIssueCoverage: committed.coverage,
      plannedHrsTotal: committed.hrsTotal,
      plannedHrsWithIssue: committed.hrsWithIssue,
      committedEpics: Object.keys(committed.set).length,
      routedEpics: Object.keys(dominant).length,
      unroutedHrs: backlog.UNROUTED ? backlog.UNROUTED.backlogAdjHrs : 0,
      unroutedEpics: backlog.UNROUTED ? backlog.UNROUTED.epicCount : 0,
      // Never measured in this deployment — stated, not defaulted to zero.
      genericPlansMeasured: false,
      capacityTruthMeasured: false,
    },
  };
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
 * The sales-order token, character-for-character the rule "Jira Backlog.js"
 * applies to Fix Versions when it writes the Billing Type column
 * (`/\bSRSO\b|SRSO-/i`).
 *
 * Deliberately the SAME expression rather than a tidier one: this reader exists
 * to compare the COMPONENT field against that exporter verdict, and a token rule
 * that differed even slightly would produce mismatches that are artefacts of two
 * regexes rather than evidence about how PMs bind their work. It matches both
 * bare "SRSO-016559" and the client-prefixed "CLVT02 SRSO-016559" form.
 */
var DH_SRSO_TOKEN_ = /\bSRSO\b|SRSO-/i;

/**
 * The Components cell → tristate "is this bound to a sales order by component".
 *
 * A one-line function with its own name because the ONE thing that can go wrong
 * here is invisible at the call site: collapsing an ABSENT column into `false`.
 * That reads as "we looked and found no runbook binding" on every row of an
 * older export, which would let the gaps row report a confident finding built
 * on a column nobody read. Extracted so a test can reach it — `readJiraRaw_`
 * opens a spreadsheet and cannot be exercised from node.
 *
 * @param {boolean} hasCol did colIdx_ find a Components column
 * @param {*} cell the raw cell value
 * @returns {?boolean} null = nobody looked · true/false = looked
 */
function dhSrsoComponent_(hasCol, cell) {
  if (!hasCol) return null;
  return DH_SRSO_TOKEN_.test(String(cell == null ? "" : cell));
}

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
    // ── COMPONENTS (read from 2026-08-07) ─────────────────────────────────────
    // Exported since the beginning as column 21 and never read here, which
    // matters because of a mismatch between the documented process and this
    // pipeline: the services runbook (HOWTO — Customer Projects in Jira, BL02
    // step B2.6) tells the PM to bind delivery work to the money by creating a
    // Jira COMPONENT named for the sales order — "SRSO-0xxxxx", NetSuite URL in
    // the description — while "Jira Backlog.js" derives Billing Type from FIX
    // VERSIONS alone (`fixVersion ~ "SRSO*"`). An engagement bound exactly as
    // the runbook instructs, with no SRSO fix version, therefore exports as
    // "Untagged" — delivered work that by our own reckoning cannot be
    // recognised against a milestone. Reading this column is what turns that
    // from a suspicion into a count.
    var iComp = colIdx_(h, ["Components"]);
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
    // Epic KEY → epic summary, filled as the rows stream past. Resolved into the
    // open-backlog rows after the loop, because a ticket can be read before its
    // own epic's row appears (the export is not ordered parent-first).
    var epicNames = {};
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
      // Read ONCE and reused: the drill-down list needs it, and so does the epic
      // NAME index below — an epic's summary is the only human-readable thing
      // that says what a ticket belongs to (manager request 2026-08-10).
      var summaryTxt = iSummary === -1 ? "" : String(raw[r][iSummary] || "").trim();
      if (isEpic) epicNames[key] = summaryTxt;
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
        // ── THE KEYS THEMSELVES (retained 2026-08-10, Workforce Health) ────────
        // Both columns were read above and immediately collapsed into the
        // `linked` BOOLEAN — the values were discarded. The shadow split needs
        // the actual key to roll a worklog up to its epic (spec §5.3), and
        // requiredPool needs it to find the pool that has historically worked an
        // epic (§4.6). Uppercased on read so the epic index and the Tempo side
        // join on one canonical form; Jira keys are case-insensitive but the two
        // exports do not agree on casing.
        epicKey: iEpicKey === -1 ? "" : String(raw[r][iEpicKey] || "").trim().toUpperCase(),
        parentKey: iParentKey === -1 ? "" : String(raw[r][iParentKey] || "").trim().toUpperCase(),
        // TRISTATE like `reopened`: "" = the column is absent, so nobody looked.
        // Never collapse an absent column into "Untagged" — that would invent a
        // commercial gap on every row of an older export.
        billing: iBilling === -1 ? "" : String(raw[r][iBilling] || "").trim(),
        // TRISTATE, same rule as `billing` and `reopened`: null = the Components
        // column is absent from this export, so nobody looked. false = we looked
        // and there is no SRSO component. Collapsing the first into the second
        // would report "the runbook binding is unused" on every row of an older
        // export — a confident finding built on a column that wasn't there.
        srsoComponent: dhSrsoComponent_(iComp !== -1, raw[r][iComp]),
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
          summary: summaryTxt,
          // What this ticket BELONGS TO (manager request 2026-08-10: "epic name
          // along with the ticket so they get a quick view on data relation").
          // Epic Key is the direct link; Parent Key catches sub-task → story →
          // epic. Both are kept raw here — the NAME is resolved after the loop,
          // once every epic row has been seen.
          epicKey: rec.epicKey || rec.parentKey || "",
          assignee: assignee, status: status,
          priority: iPriority === -1 ? "" : String(raw[r][iPriority] || "").trim(),
          due: rec.due,
          remHrs: Math.max(0, rec.estSec - rec.spentSec) / 3600,
          // Rule 2 resolved HERE, where the status CATEGORY is still in scope —
          // these records only carry the status NAME, and a name-based re-derive
          // downstream would silently diverge from dueExpected_ the first time a
          // project adds a workflow step. `ignored` = unstarted and undated: the
          // ticket the team asked us to stop putting in front of people.
          ignored: !dueExpected_(rec, true),
        });
      }
    });
    // Epic NAMES, resolved now that every row has been seen. A key with no name is
    // an epic outside this export's window: the key still ships (it is a real
    // relation a manager can paste into Jira) and the name renders as blank rather
    // than as "no epic", which would be a different and wrong statement.
    openIssues.forEach(function (o) {
      o.epicName = o.epicKey ? (epicNames[o.epicKey] || "") : "";
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
 * Week Start is parsed via dhCellDateLocal_, NOT parseDhDate_ — parseDhDate_
 * calls `new Date(string)`, which is exactly the UTC-midnight trap that shifts
 * a bare "yyyy-mm-dd" calendar date one ISO week early in a behind-UTC zone.
 * See dhCellDateLocal_'s comment for the full reasoning.
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
    var d = dhCellDateLocal_(values[r][iWeek]);
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
 * Canonicalises an ISO-week label's "YYYY.W0N" padded form to "YYYY.WN" —
 * the form weekKeyFromDate_ (and buildDhWindow_) actually emit.
 *
 * Why this exists: writeFlowSnapshot_ (Jira Backlog.js) writes the ISO Week
 * cell via jb_isoWeekLabel_, which zero-pads the week number — "2026.W07".
 * Every OTHER iso key this dashboard builds is unpadded — "2026.W7". Left
 * unreconciled, the snapshot trend's `byIso[s.iso]` never matches a lookup
 * key built from a Date (Dashboard.html's `byIso[p.isos[i]]`), which silently
 * drops the Backlog/WIP trend for weeks 1–9 of every year — invisible in
 * testing because it looks like "no export ran" rather than a join mismatch.
 *
 * Fixed on the READ side only (not in the exporter): the padded form loses
 * no information — "2026.W07" and "2026.W7" denote the same week — so this
 * function alone recovers the canonical key, and because Flow Snapshots is
 * append-only with 52-week retention, normalising here repairs ALL existing
 * history immediately, with no re-export required.
 *
 * @param {string} iso e.g. "2026.W07" or "2026.W31"
 * @returns {string} unpadded form, e.g. "2026.W7" or "2026.W31"
 */
function canonicalIsoWeek_(iso) {
  var m = /^(\d{4}\.W)0*(\d+)$/.exec(String(iso || ""));
  return m ? (m[1] + m[2]) : String(iso || "");
}

/**
 * Pure parse of the Flow Snapshots tab. The exporter appends one row per RUN
 * and can run several times a week — the LAST row per ISO week wins (freshest
 * state of that week). Rows whose ISO Week cell isn't YYYY.WN are skipped.
 * The ISO Week cell is canonicalised (see canonicalIsoWeek_) before it is
 * used as a key, so a zero-padded write ("2026.W07") joins correctly against
 * unpadded lookup keys built from a Date elsewhere in this dashboard.
 *
 * Unassigned Items / Unassigned Hrs (added to the exporter after this tab was
 * already live, v3.11.0) are the MEASURED history behind the hero's unowned
 * figure — everything before that export version has neither column. Same
 * TRISTATE discipline as parseArrivalRows_'s createdUnassigned: an ABSENT
 * column reads as null (nobody measured it — collapsing to 0 would assert
 * "no unowned work" on an export that predates the columns, which is good
 * news the data does not support), while a PRESENT-but-blank cell is a real
 * measured zero.
 */
function parseFlowSnapshotRows_(values) {
  if (!values || values.length < 2) return { snaps: [], available: false };
  var h = values[0].map(String);
  var iGen = colIdx_(h, ["Generated"]);
  var iIso = colIdx_(h, ["ISO Week"]);
  var iWip = colIdx_(h, ["WIP Count"]);
  var iHrs = colIdx_(h, ["Backlog Hrs"]);
  var iN = colIdx_(h, ["Backlog Items"]);
  var iUnN = colIdx_(h, ["Unassigned Items"]);
  var iUnHrs = colIdx_(h, ["Unassigned Hrs"]);
  if (iGen === -1 || iIso === -1) return { snaps: [], available: false };
  var byIso = {}, order = [];
  for (var r = 1; r < values.length; r++) {
    var iso = String(values[r][iIso] || "").trim();
    if (!/^\d{4}\.W\d{1,2}$/.test(iso)) continue;
    iso = canonicalIsoWeek_(iso);
    if (!byIso[iso]) order.push(iso);
    byIso[iso] = { iso: iso, at: String(values[r][iGen] || ""),
                   wip: Number(values[r][iWip]) || 0,
                   backlogHrs: Number(values[r][iHrs]) || 0,
                   backlogN: Number(values[r][iN]) || 0,
                   // TRISTATE — see doc comment above.
                   unassignedN: iUnN === -1 ? null : (Number(values[r][iUnN]) || 0),
                   unassignedHrs: iUnHrs === -1 ? null : (Number(values[r][iUnHrs]) || 0) };
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
 * remaining estimate DESC then due ASC, capped at BACKLOG_MAX_ITEMS_ALL per person.
 * The client opens on BACKLOG_MAX_ITEMS (8) and expands to the rest in place, so
 * the cap here is the payload's, not the view's (2026-08-10).
 *
 * ── UNSTARTED, UNDATED WORK IS NOT LISTED (user report 2026-08-10) ───────────
 * *"I still see tickets in the status To Do with no due date in each rocketeer.
 * We should not have them shown in the list."* Rule 2 stopped those tickets
 * counting against anyone's due-date percentage, but they were still printed in
 * the per-person drill-down with a red em-dash in the Due column — which is the
 * same accusation the rate had just stopped making, one surface over.
 *
 * They leave `items` entirely. They are NOT deleted from the person's load:
 * `count` and `remHrs` still describe every open ticket, because a rule about
 * what we GRADE must never quietly shrink what somebody is carrying. The two
 * populations are reported apart — `listed`/`ignoredN`/`ignoredHrs` — so the
 * drill-down can say "8 of 43 listed, 20 undated To Do not shown" rather than
 * leaving a reader to wonder why the list is shorter than the count.
 *
 * @returns {Object} display name →
 *   { count, remHrs, listed, ignoredN, ignoredHrs, items:[] }
 *   count/remHrs = the WHOLE open backlog · listed = what the list can show
 */
function backlogByPerson_(openIssues, nameIdx) {
  var by = {};
  (openIssues || []).forEach(function (it) {
    var dn = resolveName_(nameIdx, it.assignee);
    if (!dn) return; // not in population
    if (!by[dn]) by[dn] = { count: 0, remHrs: 0, listed: 0, ignoredN: 0, ignoredHrs: 0, items: [] };
    var b = by[dn];
    b.count++;
    b.remHrs += it.remHrs;
    // `ignored` is decided in readJiraRaw_ off the status CATEGORY — never
    // re-derived here from the status name.
    if (it.ignored) { b.ignoredN++; b.ignoredHrs += it.remHrs; return; }
    b.listed++;
    b.items.push({ key: it.key, summary: it.summary, status: it.status,
                   priority: it.priority, remHrs: it.remHrs,
                   // The engagement this ticket belongs to. Key AND name: the key
                   // is what a manager pastes into Jira, the name is what makes
                   // the row readable without opening anything.
                   epicKey: it.epicKey || "", epicName: it.epicName || "",
                   due: it.due ? weekKeyFromDate_(it.due) : "" });
  });
  Object.keys(by).forEach(function (dn) {
    by[dn].items.sort(function (a, b) {
      if (b.remHrs !== a.remHrs) return b.remHrs - a.remHrs;
      return (a.due || "9999").localeCompare(b.due || "9999");
    });
    by[dn].items = by[dn].items.slice(0, CONFIG_DH.BACKLOG_MAX_ITEMS_ALL);
    by[dn].remHrs = Math.round(by[dn].remHrs * 10) / 10;
    by[dn].ignoredHrs = Math.round(by[dn].ignoredHrs * 10) / 10;
  });
  return by;
}

/**
 * Adds `epicsN` — open epics attributed to each person — to the backlog map.
 *
 * ── WHY (user report 2026-08-10: "n = 79 but the drill-down shows 1 ticket") ──
 * The roster's `n` and its drill-down have always described different
 * populations, and nothing on screen said so:
 *
 *   n            = every open issue attributed to the person, EPICS INCLUDED
 *                  (personHygieneBuckets_ — an open epic with no estimate is the
 *                  single biggest lever the hygiene matrix exists to expose).
 *   the list      = openIssues, which EXCLUDES epics by design (they roll up
 *                  their children, so listing both double-counts the load) and,
 *                  since v34, excludes unstarted undated tickets by rule.
 *
 * So a person can legitimately read "79" beside a list of one, and the reader is
 * left assuming the dashboard lost 78 tickets. Counting the epics here lets the
 * drill-down close the arithmetic exactly:
 *
 *     n = listed + ignoredN + epicsN
 *
 * A number that cannot be reconciled is a number nobody trusts twice, and this
 * one had three different exclusions stacked behind it with no way to see any.
 *
 * People who own ONLY open epics have no `backlogByPerson_` entry at all, so the
 * row is created here rather than assumed to exist — otherwise the very people
 * this explains best (delivery managers holding epics) keep the unexplained gap.
 *
 * @param {Object} map     backlogByPerson_ output, MUTATED in place
 * @param {Array} issues   readJiraRaw_ `issues` (every row, epics included)
 * @param {Object} nameIdx name index for the roster join
 */
function addOpenEpicCounts_(map, issues, nameIdx) {
  (issues || []).forEach(function (it) {
    if (!it.isEpic) return;
    if (!typeHygOpen_(it)) return;          // same "open" rule as every other surface
    var dn = resolveName_(nameIdx, it.assignee);
    if (!dn) return;
    if (!map[dn]) {
      map[dn] = { count: 0, remHrs: 0, listed: 0, ignoredN: 0, ignoredHrs: 0, epicsN: 0, items: [] };
    }
    map[dn].epicsN = (map[dn].epicsN || 0) + 1;
  });
  // Zero is a MEASUREMENT here, not an absence: the drill-down's reconciliation
  // line adds these up, and an undefined would make it read NaN.
  Object.keys(map).forEach(function (dn) {
    if (map[dn].epicsN === undefined) map[dn].epicsN = 0;
  });
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
  // Window membership as a HASH, not a 56-element array scan.
  // `eachTempoRow_` below runs once per Tempo row per week-with-hours, over both
  // the tracked and the planned grid — issue-grained, so tens of thousands of
  // rows on a 52-week window. An `indexOf` there is a linear scan of allWeeks
  // inside the innermost loop, i.e. rows × weeks × 56 string compares for a
  // membership test that is O(1) with an object. Pure hot-path waste: same
  // answer, same order, no behaviour change.
  var inWindow = {};
  win.allWeeks.forEach(function (iso) { inWindow[iso] = 1; });

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
      if (!inWindow[iso]) return;
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
  // Open EPICS per person, counted but never listed — the third and last piece of
  // the roster's `n`. See addOpenEpicCounts_ for why the drill-down has to be able
  // to account for every one of the issues that column claims.
  addOpenEpicCounts_(backlogMap, inputs.jira.issues, nameIdx);
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
    // WORKFORCE HEALTH (spec v1.1 §4): pool / band / backlog role, derived from
    // the job code alone. Attached per person so every downstream surface — the
    // pool grid, the shadow split, requiredPool's history lookup — reads ONE
    // classification rather than each re-deriving its own from the title.
    var cls = dhClassify_(p.jobTitle, p.isCrew === true);
    return { name: dn, region: reg.region, regionSource: reg.source,
             teams: acc.teams.slice().sort(), pms: acc.pms.slice().sort(), isCrew: p.isCrew,
             jobTitle: p.jobTitle || "",
             pool: cls.pool, band: cls.band, backlogRole: cls.role, cell: cls.cell,
             subTrack: cls.subTrack, disciplineLabel: cls.disciplineLabel,
             stemWarning: cls.stemWarning, classificationError: cls.classificationError,
             onLeave: p.onLeave === true, leaveStatus: p.leaveStatus || "",
             // Crew between engagements (spec 2026-08-17). Explicit === true so
             // an older roster read that never set the field cannot arrive as
             // undefined and be treated as a third state downstream.
             onBench: p.onBench === true, benchStatus: p.benchStatus || "",
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

  // ── Queue model (spec 2026-08-06) ──────────────────────────────────────────
  // Two halves, never summed here: one is filterable downstream, the other is
  // org-wide. The client decides, once, with a scope tag on it.
  // `flowOpen` is passed IN, not recomputed: assembleModel_ already built it
  // above over the same issues and resolvePerson, and a second O(n) pass over
  // every Jira issue to rebuild an identical answer is waste on a payload
  // already large enough to need gzipping and chunking. Passing it also carries
  // its `unattributed` / `uncategorized` counts through to the hero's own
  // number, so the total owns its loss instead of deferring to a counter
  // computed elsewhere in the payload (review finding, Task 4).
  var queue = inputs.jira.available
    ? queueSnapshot_(jiraScoped.issues, resolvePerson, flowOpen)
    : { assigned: { items: 0, wipN: 0, todoN: 0, todoHrs: 0,
                    unattributed: 0, uncategorized: 0 },
        // NULL, not 0 — with no feed we did not look, and "0 unowned" is the
        // most dangerous false read on this surface (spec §5). uncategorized
        // is null too, matching queueSnapshot_'s real unassigned shape
        // (items, wipN, todoN, todoHrs, uncategorized) key-for-key — the brief's
        // original fallback dropped this key entirely (Task 7 review finding).
        unassigned: { items: null, wipN: null, todoN: null, todoHrs: null,
                      uncategorized: null } };

  var arrWeeks = (inputs.arrivals && inputs.arrivals.available) ? inputs.arrivals.weeks : [];
  // Ordered oldest-first by ISO key so the walkback and the median both read a
  // series in time order regardless of how the sheet happened to be sorted.
  // NUMERIC key (isoSortKey_), not a string compare — weekKeyFromDate_ does not
  // zero-pad, so "2026.W10" < "2026.W6" as strings and a naive sort scrambles
  // any window spanning the single/double-digit boundary (bug fix, Task 7
  // review 2026-08-06; see isoSortKey_'s comment for why this corrupts both
  // consumers below silently rather than erroring).
  arrWeeks = arrWeeks.slice().sort(function (a, b) { return isoSortKey_(a.iso) - isoSortKey_(b.iso); });
  var resolvedSeries = arrWeeks.map(function (w) { return w.resolved; });
  var clearRate = clearRateMedian_(resolvedSeries, CONFIG_DH.CLEAR_RATE_WEEKS);
  var totalItems = (queue.unassigned.items === null)
    ? null
    : queue.assigned.items + queue.unassigned.items;

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
    var scls = dhClassify_(rec.jobTitle || "", rec.isCrew === true);
    people.push({ name: dn, region: reg.region, regionSource: reg.source,
                  teams: [], pms: [], isCrew: rec.isCrew === true,
                  jobTitle: rec.jobTitle || "",
                  // Classified for DISPLAY only. These stubs are outside the
                  // capacity population by construction (weeks: {}, attribOnly),
                  // and buildCapacity_ filters on attribOnly rather than trusting
                  // an empty weeks map — so a stub can label itself PS-CONSULT on
                  // a drill-down without ever entering a pool denominator.
                  pool: scls.pool, band: scls.band, backlogRole: scls.role, cell: scls.cell,
                  subTrack: scls.subTrack, disciplineLabel: scls.disciplineLabel,
                  stemWarning: scls.stemWarning, classificationError: scls.classificationError,
                  onLeave: false, leaveStatus: "",
                  // A stub is an attribution shell, never a live roster row —
                  // it carries no capacity to carve, so both flags are false by
                  // construction rather than by lookup.
                  onBench: false, benchStatus: "",
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
      // Roster drill-down: what the row opens with, and what the payload carries
      // behind the ▾ Show all. Shipped rather than re-typed on the client so one
      // config edit moves both the view and the honest "N of M" line with it.
      backlogItemsShown: CONFIG_DH.BACKLOG_MAX_ITEMS,
      backlogItemCap: CONFIG_DH.BACKLOG_MAX_ITEMS_ALL,
      // Jira site for every deep link the client builds. Trailing slash trimmed
      // once here rather than defended against in four renderers.
      jiraBase: dhJiraBase_(),
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
      //
      // "Other" left the list on 2026-08-17 (user: "we have everyone in an
      // assigned region already"), but it is DATA-DRIVEN, not deleted — see
      // dhRegionChips_. Hard-coding the four geographic regions would have been
      // the same class of bug this dashboard keeps finding: the chip is what
      // makes a person reachable, so dropping it while anyone still resolves to
      // "Other" would make those people unselectable by any filter — present in
      // every total, absent from every slice, and nothing on screen saying so.
      // The chip therefore returns by itself the moment one person lands there,
      // which is also the signal that LOCATION_REGION_MAP has met a new country.
      regions: dhRegionChips_(people),
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
      arrivalsAvailable: !!(inputs.arrivals && inputs.arrivals.available),
      clearRateMedian: clearRate,
      clearRateWeeks: CONFIG_DH.CLEAR_RATE_WEEKS,
      walkbackMaxWeeks: CONFIG_DH.WALKBACK_MAX_WEEKS,
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
    // Queue halves kept separate all the way to the client (spec §3 §2).
    queue: queue,
    arrivalWeeks: arrWeeks,
    // Reconstructed inventory history — anchored on the measured total, so it is
    // empty rather than fabricated when the total cannot be measured.
    inventoryHistory: inventoryWalkback_(totalItems, arrWeeks, CONFIG_DH.WALKBACK_MAX_WEEKS),
    bugWeekly: bugWeekly_(inputs.bugs.bugs),
    hygieneBuckets: hygiene,
    // Per-person field fill — the Actions roster (spec 2026-08-05), and since
    // schema 42 the only per-parameter compliance read shipped. Its by-type
    // twin (`typeHygiene`) was removed with the 🧬 matrix on 2026-08-17: the
    // same parameters read per rocketeer, and a summary nobody could act on
    // was costing a payload section on every rebuild.
    personHygiene: personHyg,
    // 🌊 Backlog health — snapshot, person-keyed, no iso (see the section header).
    backlogHealth: backlogHealth,
    // 🚩 Epics with no due date — ORG scope, issue keys only, 100% target by team
    // agreement. Deliberately built off the SAME leaver-scoped feed as every other
    // hygiene surface so its counts reconcile with the 🧬 matrix's epic rows, but
    // WITHOUT the person join or the unstarted-undated carve.
    epicDueAudit: inputs.jira.available
      ? epicDueAudit_(jiraScoped)
      : { rows: [], n: 0, missing: 0, keyCap: EPIC_DUE_MAX_KEYS_ },
    // 🗓 PM-owned work — attributed by PROJECT, so it needs no PM on the roster
    // (PMs are structurally absent from the delivery population by design; see
    // the PM ATTRIBUTION header). Built off the SAME leaver-scoped feed as
    // epicDueAudit_ so the two reconcile: a manager reading 🚩 on Actions and
    // this tab must never see two different counts of the same epics.
    pmOwned: inputs.jira.available
      ? (function () {
          var pmIdx = pmByProject_((inputs.tracked.rows || [])
                        .concat(inputs.planned.rows || []));
          // resolvePerson feeds epics[].owners — the roster people working on
          // each epic, which is what lets the universal filters reach this tab.
          var w = pmOwnedWork_(jiraScoped, pmIdx.byProject, win.today || new Date(),
                               resolvePerson);
          return { rows: w.rows, keyCap: w.keyCap, supersededPms: pmIdx.superseded };
        })()
      : { rows: [], keyCap: EPIC_DUE_MAX_KEYS_, supersededPms: 0 },
    // Joiners/leavers and the capacity they carried, per ISO week. The one
    // number here that describes people who are NOT in `people` — by the time
    // a leaver is in this bucket the roster has already dropped them, which is
    // exactly why their capacity had to be counted somewhere.
    workforceWeeks: workforceChangeBuckets_(inputs.roster, inputs.capacity.byName,
                                            win.allWeeks),
    // ── WORKFORCE HEALTH (spec v1.1, 2026-08-10) ─────────────────────────────
    // Computed over the DEEP window (win.allWeeks) rather than one period, so
    // the client can re-slice by the period picker without a round-trip — the
    // same reason the weekly grid ships all weeks. The client re-runs the pure
    // reconcile over its own selection; this payload carries the deep baseline
    // and every scope fact the banner has to state.
    //
    // `people` is passed AFTER the attribution stubs are appended, so the
    // population filter (attribOnly) is the one that decides who holds capacity,
    // not an accident of ordering.
    workforce: buildWorkforceHealth_(people, inputs.tracked.rows, inputs.planned.rows,
                                     jiraScoped, resolveName_.bind(null, nameIdx),
                                     win.allWeeks, null),
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
// v26: Executive newspaper (spec 2026-08-06) — model.queue {assigned,unassigned}
//      (halves NEVER summed server-side), model.arrivalWeeks, model.inventoryHistory
//      (walked back from the measured anchor, `measured` flag per point),
//      meta.arrivalsAvailable/clearRateMedian/clearRateWeeks/walkbackMaxWeeks,
//      typeHygiene rows gain `attrN`, and registry gains queueCover/netFlow/
//      clearedPerHead/inventory/arrived/cleared (all target: null).
// v27: meta.flowSnapshots rows gain `unassignedN`/`unassignedHrs` — the exporter's
//      Flow Snapshots tab has carried these two columns for a while but nothing
//      read them, so the unowned-queue trend was reconstructed by walkback
//      forever instead of accumulating real measurements. TRISTATE: null on a
//      row from before the columns existed, 0 on a measured-but-empty row. A
//      cached v26 model has neither field, so a later chart reading them would
//      render every point as undefined rather than null — must miss cleanly.
// v28: WORKFORCE CHANGE (user request 2026-08-07) — model.workforceWeeks carries
//      joiners/leavers and the scheduled capacity each carried, per ISO week.
//      roster.attrib rows gain termDate/active/inScope; the termination DATE was
//      previously read and discarded (only its truthiness reached
//      dhRosterRowActive_), so a cached v27 model cannot place a departure in a
//      period at all — it must miss cleanly rather than render an empty card
//      that reads as "nobody left".
// v29: hygiene rows gain srsoAny/srsoSeen/srsoCompOnly/srsoMeasurable, and Jira
//      records gain `srsoComponent` — the Components column (exported since the
//      beginning, never read) tested for the sales-order token. Measures the gap
//      between the documented binding (runbook B2.6: a COMPONENT named for the
//      SRSO) and the one this pipeline reads (Billing Type, derived from FIX
//      VERSIONS). A cached v28 row has none of these fields, so the gaps row
//      would compute 0 of 0 and render "solved" — it must miss cleanly.
// v30: WORKFORCE HEALTH. `people[]` rows gain pool / band / backlogRole / cell /
//      subTrack / disciplineLabel / stemWarning / classificationError, Jira
//      records gain epicKey + parentKey (the VALUES — both columns were read
//      before and collapsed into the `linked` boolean), Tempo tracked rows gain
//      issue / epicKey / parentKey / hasIssueCol / hasEpicCol, and the payload
//      gains the whole `workforce` block (cells, disciplines, backlogByPool,
//      consumersOnly, scope, coverage).
//      A cached v29 model has NONE of it, and the failure would not be a blank
//      panel: every person would read pool `undefined`, collapsing the entire
//      population into one cell and reproducing the exact blended figure this
//      release exists to retire — a wrong number that looks like a right one.
//      It must miss cleanly.
// v31: Workforce Health, first-render corrections (2026-08-10).
//      · `people[]` may now carry pool "CREW" — 30 contractors were landing in
//        UNCLASSIFIED because they hold no job-architecture code (user report).
//      · weekly buckets and cells gain `matchableCommittedHrs` (+ `planMatchable`
//        on cells): the fidelity denominator is now the planned hours that NAME
//        AN ISSUE, not all planned hours. A v30 entry has neither, and the fold
//        would read `undefined` — arithmetic on it yields NaN, which §8 forbids
//        reaching render. The folds coalesce defensively as well, but the schema
//        miss is what keeps the two layers honest.
// v32: ACTIONS-TAB COMPLIANCE FEEDBACK (managers, 2026-08-10). Three changes,
//      one payload:
//      · typeHygiene and personHygiene rows gain `dueN` — the due-date column now
//        grades STARTED work only on the open half (dueExpected_), exactly as
//        `timeN`/`loggedN` did for logged time in v24. A cached v31 row has no
//        dueN; the client's `denomFallbackN` would silently fall back to n and go
//        on grading the To Do half, i.e. keep publishing the number the feedback
//        asked us to stop publishing. Must miss cleanly.
//      · backlogHealth's overdue total and its three ageing bands are now
//        week-grained (dhOverdue_ / dhWeekStart_): a due date inside the CURRENT
//        ISO week is in compliance and appears in no queue. `futureDated` is its
//        exact complement, and the boundary ships as `backlogHealth.weekStart`.
//        The counts MOVE DOWN on deploy — this is a definition change, not a
//        delivery improvement, and the panel says so.
//      · backlogByPerson_ carries up to BACKLOG_MAX_ITEMS_ALL items per person
//        (was 8) so the roster's ▾ Show all needs no round-trip; meta gains
//        backlogItemsShown / backlogItemCap.
// v33: THE THREE RULES, FINAL FORM + THE EPIC FLAG (managers, 2026-08-10, same
//      review). Two changes:
//      · `dueExpected_` REVISED. v32 excluded every unstarted ticket from the
//        due-date ratio; rule 3 says anything carrying a date is tracked whatever
//        its status, so the excluded set is now the INTERSECTION — unstarted AND
//        undated. `dueN` therefore counts "started, or dated", and a dated To Do
//        ticket is a hit. A v32 cache entry carries the narrower denominator, so
//        both the share and the queue behind it would be wrong (and unexplainably
//        so, since the copy would describe the new rule). Must miss cleanly.
//      · NEW `epicDueAudit` — open epics with no due date, per epic type, with
//        the offending keys. ORG scope: no person join, unassigned epics included,
//        and NOT subject to the carve above, because an undated To Do epic is
//        precisely what the team agreed must not exist. A cached v32 model has no
//        such field and the panel would report "no epics" — a clean 100% on an
//        audit nobody ran, which is the worst of the three possible wrong answers.
// v34: THE RULE REACHES THE LIST (user report 2026-08-10 — "I still see tickets
//      in the status To Do with no due date in each rocketeer"). Rule 2 had
//      changed what we GRADE but not what we SHOW: those tickets were still
//      printed in every person's drill-down with a red em-dash in the Due column,
//      which is the same accusation the rate had just stopped making. openIssues
//      rows gain `ignored` (decided off the status CATEGORY in readJiraRaw_, never
//      re-derived from the status NAME downstream), and `people[].backlog` gains
//      `listed` / `ignoredN` / `ignoredHrs` beside the UNCHANGED `count` /
//      `remHrs` — the load is not reduced, only the list. A cached v33 payload has
//      no `listed`, so the row would print "8 of 63" over a list that can only
//      ever reach 43, and would list the ignored tickets again. Must miss cleanly.
// v35: `people[].backlog` gains `epicsN` (user report 2026-08-10 — "n = 79 but
//      the drill-down shows 1 ticket! where do the rest go?"). Three exclusions
//      stood between that column and its own list — epics, ignored tickets, and
//      the display cap — with nothing on screen naming any of them, so the only
//      available reading was that the dashboard had lost the difference. The
//      drill-down now closes it exactly: n = listed + ignoredN + epicsN. A cached
//      v34 payload has no epicsN, and the breakdown would come up short by the
//      person's epics — an arithmetic explanation that does not add up is worse
//      than no explanation, because it looks like a second bug. Must miss cleanly.
// v36: backlog `items` gain `epicKey` / `epicName` — what each ticket BELONGS TO
//      (manager request 2026-08-10: "epic name along with the ticket so they get
//      a quick view on data relation"). Sourced from Epic Key, falling back to
//      Parent Key, with the name resolved from the epic rows in the same export.
//      A cached v35 payload has neither field, and the new column would render
//      "— not linked" on every row: an assertion that the work cannot reach an
//      engagement, made about tickets that may well be linked. A false red on
//      every line is worse than a blank column. Must miss cleanly.
// v37: `meta.jiraBase` — the Jira site every deep link is built from
//      (`DH_JIRA_BASE` Script Property, else CONFIG_DH.JIRA_BASE_URL). Every key
//      on the roster, the epic audit and the backlog-health queues is now a link,
//      and multi-key links are `key in (…)` JQL over exactly the keys on screen.
//      A cached v36 payload has no jiraBase: the client renders keys as PLAIN
//      TEXT there rather than guessing a host — a link to /browse/KEY on the Apps
//      Script origin is a 404 that reads as "the dashboard is broken". The bump
//      is what makes the links appear at all rather than after a TTL.
// 38 — `pmOwned` (🗓 PM tab, spec 2026-08-11). A v37 entry has no pmOwned, so
//      the tab would render empty against a stale model rather than rebuild.
// 39 — pmOwned restructured epic-first (user feedback 2026-08-11): rows carry
//      `epics` (each with its own `children`) instead of a flat `items` list,
//      plus `ignoredN`. A v38 entry has `items` and would render no epics.
// 40 — pmOwned attribution is ASSIGNEE-FIRST (user decision 2026-08-11) and rows
//      carry the four opportunity counts + viaAssignee/viaProject; epics carry
//      assignee/via/stale/staleDays/childrenAll. A v39 entry attributes every
//      epic by project lead and shows no gap line — the numbers would be wrong,
//      not merely missing, which is the case a schema bump exists for.
// 41 — child verdicts split `over` into `atRisk` / `breached` (a plan that can
//      still be fixed vs a date already missed), rows carry oppEpicsAtRisk /
//      oppEpicsBreached instead of oppChildOver, and epics carry `owners` so the
//      universal filters can reach a tab whose unit is an epic. A v40 entry has
//      none of these: the verdict cell renders blank and the gap line silently
//      loses a row.
// 42 — REMOVALS, not additions (user decision 2026-08-17). `typeHygiene` leaves
//      the payload with the 🧬 field-fill-by-issue-type matrix, and the roster
//      -join check (`hygieneBuckets[].resAttr`, the gaps queue's "…and that
//      assignee resolves to a roster person" row, and the data-trust strip's
//      "Roster join" tile) leaves with the metric. Both were per-parameter
//      summaries of compliance; the same parameters are read PER PERSON on the
//      signals roster, which names somebody who can act.
//      A v41 entry is harmless in the other direction — the client simply stops
//      reading two fields it no longer renders — but the bump is still correct
//      and still worth busting: the payload gets materially smaller (typeHygiene
//      carried up to 500 issue keys per field per type) and there is no reason
//      to keep paying for it in the cache for a whole TTL after the deploy.
// 43 — PM rows carry `epicBacklogN` / `epicBacklogKeys`, and `epicN` narrows to
//      epics that are COMMITMENTS (started, or dated, or both). Undated To Do
//      epics are assigned backlog and leave the Owns bar (user 2026-08-17:
//      "Project managers cannot be punished for Epics available with no due date
//      if they have the status TO DO").
//      A v42 entry is the dangerous kind: `epicN` still carries the OLD, wider
//      denominator, so every PM's Owns bar reads LOWER than the rule now says it
//      should — a stale model quietly accusing named people of missing
//      commitments they were just excused from. It also has no `epicBacklogN`,
//      so the "N in backlog, not graded" note renders as nothing and the
//      exclusion the bar depends on is invisible. Bust the cache.
var DH_SCHEMA_VER_ = 43;

/** Full I/O compute — shared by getDeliveryData and warmDeliveryCache. */
/**
 * Full compute, with a per-stage timing breakdown.
 *
 * WHY THE TIMINGS ARE HERE. A cold rebuild was reported at 4+ minutes and
 * nothing recorded where that time went — the warmer logged one total and the
 * payload carried nothing, so every conversation about it was guesswork. Each
 * reader is now timed, the breakdown goes to the execution log AND rides on the
 * payload as `meta.buildMs`, so the next warmer run answers the question
 * instead of raising it.
 *
 * The expensive ones are expected to be the two Tempo grids and Jira Raw: all
 * three are `getDataRange().getValues()` over issue-grained sheets spanning 52
 * weeks, which is where a GAS script spends its time. If the breakdown shows
 * otherwise, believe it over that expectation.
 */
function buildDeliveryModel_() {
  var t = {}, mark = function (k, fn) {
    var s = Date.now(), out = fn();
    t[k] = Date.now() - s;
    return out;
  };
  var win = buildDhWindow_(new Date());
  var inputs = {
    roster:    mark("roster",    readRosterPeople_),
    capacity:  mark("capacity",  readCapacitySheet_),
    tracked:   mark("tracked",   function () { return readTempoGrid_(CONFIG_DH.TRACKED_SHEET); }),
    planned:   mark("planned",   function () { return readTempoGrid_(CONFIG_DH.PLANNED_SHEET); }),
    ns:        mark("ns",        readNsBillable_),
    jira:      mark("jira",      readJiraRaw_),
    bugs:      mark("bugs",      readJiraBugs_),
    flowSnaps: mark("flowSnaps", readFlowSnapshots_),
    arrivals:  mark("arrivals",  readArrivals_),
  };
  var model = mark("assemble", function () { return assembleModel_(inputs, win); });

  // Row counts alongside the millisecond costs: 40s on a reader is a different
  // problem at 2,000 rows than at 200,000, and the fix is different too.
  t.rows = { tracked: (inputs.tracked.rows || []).length,
             planned: (inputs.planned.rows || []).length,
             jira: (inputs.jira.issues || []).length,
             ns: (inputs.ns.rows || []).length };
  t.total = Object.keys(t).reduce(function (a, k) {
    return a + (typeof t[k] === "number" ? t[k] : 0);
  }, 0);
  Logger.log("⏱ buildDeliveryModel_ " + t.total + "ms — " +
    Object.keys(t).filter(function (k) { return typeof t[k] === "number" && k !== "total"; })
      .sort(function (a, b) { return t[b] - t[a]; })
      .map(function (k) { return k + " " + t[k] + "ms"; }).join(" · ") +
    " · rows tracked=" + t.rows.tracked + " planned=" + t.rows.planned +
    " jira=" + t.rows.jira + " ns=" + t.rows.ns);
  if (model && model.meta) model.meta.buildMs = t;
  return model;
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
          // Super-admin tier (redesign 2026-08-17). Resolved per REQUEST, never
          // cached: the payload is shared across viewers, so a cached true
          // would hand the Tier-3 trust panel to the next reader. Same reason
          // viewerRole/viewerEmail are stamped here rather than built in.
          cached.viewerSuper = dhSuperAdmin_(access.email);
          return cached;
        }
        Logger.log("ℹ️ getDeliveryData: cache schema v" + cached.schemaVer +
                   " ≠ v" + DH_SCHEMA_VER_ + " — stale shape, recomputing");
      } catch (e) { Logger.log("⚠️ getDeliveryData: bad cache entry — recomputing"); }
    }
  }
  // ── THUNDERING-HERD GUARD ───────────────────────────────────────────────────
  // A cold rebuild takes minutes. Without a lock, every user who opens the page
  // in that window starts their OWN full rebuild: five people at 09:00 on a
  // Monday means five concurrent passes over the same large sheets, each one
  // slower than a single pass would have been because they contend for the same
  // quota and the same Sheets backend. The wait gets worse the more people are
  // waiting — exactly backwards.
  //
  // So the first caller computes and the rest queue on the lock, then re-read
  // the cache the winner just wrote and return in milliseconds.
  //
  // waitLock, not tryLock: a caller that gave up immediately would fall through
  // and start the very rebuild this exists to prevent. The timeout is generous
  // because it must exceed a realistic cold build; if it is exceeded we compute
  // anyway rather than fail, because a slow page beats a broken one.
  var lock = LockService.getScriptLock();
  var haveLock = false;
  try { haveLock = lock.tryLock(DH_BUILD_LOCK_MS_); } catch (e) { haveLock = false; }
  try {
    if (haveLock && !forceRefresh) {
      // Somebody may have finished building while we queued. Re-read before
      // spending minutes reproducing their work.
      var second = cacheGetLarge_(cache, key);
      if (second) {
        try {
          var fresh = JSON.parse(second);
          if (fresh.schemaVer === DH_SCHEMA_VER_) {
            Logger.log("ℹ️ getDeliveryData: another request built it while we waited — serving that");
            fresh.viewerRole = access.role;
            fresh.viewerEmail = access.email;
            fresh.viewerSuper = dhSuperAdmin_(access.email);
            return fresh;
          }
        } catch (e) { /* fall through and rebuild */ }
      }
    }
    var model = buildDeliveryModel_();
    if (!model.error) cachePutLarge_(cache, key, JSON.stringify(model), CONFIG_DH.CACHE_TTL_SEC);
    model.viewerRole = access.role;
    model.viewerEmail = access.email;
    model.viewerSuper = dhSuperAdmin_(access.email);
    return model;
  } finally {
    if (haveLock) { try { lock.releaseLock(); } catch (e) { /* released by timeout */ } }
  }
}

/**
 * How long a queued request waits for the in-flight rebuild before giving up
 * and building its own. Must exceed a realistic cold build — a timeout shorter
 * than the thing it is waiting for turns the guard into pure added latency.
 */
var DH_BUILD_LOCK_MS_ = 300000;   // 5 min

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

/**
 * The region chip list is DATA-DRIVEN, not a literal (user 2026-08-17: "delete
 * Other, we have everyone in an assigned region already").
 *
 * The failure this guards is the reason it was not simply deleted: the chip is
 * what makes a person reachable by the region filter, so a population that still
 * contains an "Other" person with no "Other" chip is a silent subset — in every
 * org-wide total, in no slice, with nothing on screen saying so.
 */
function _test_regionChips_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_regionChips_: " + m); }
  var geo = [{ name: "A", region: "AMER" }, { name: "B", region: "EMEA" },
             { name: "C", region: "SEA" }, { name: "D", region: "ANZ" }];
  assert_(dhRegionChips_(geo).join(",") === "AMER,EMEA,SEA,ANZ",
          "everyone assigned → the geographic four, no Other chip");
  assert_(dhRegionChips_([]).indexOf(CONFIG_DH.REGION_FALLBACK) === -1,
          "an empty population does not invent an Other chip");
  // …and it comes back BY ITSELF. No deploy, no code change — the same
  // data-driven idiom the gaps queue's retire-at-100% rule uses.
  var withOther = geo.concat([{ name: "E", region: CONFIG_DH.REGION_FALLBACK }]);
  assert_(dhRegionChips_(withOther).indexOf(CONFIG_DH.REGION_FALLBACK) !== -1,
          "one unmapped person brings the Other chip back, so nobody is unreachable");
  assert_(dhRegionChips_(withOther).length === 5 &&
          dhRegionChips_(withOther)[4] === CONFIG_DH.REGION_FALLBACK,
          "…appended last, after the geographic four");
  // The four are the ORDER, not a set: a reader scanning the chip strip should
  // find them in the same place every time.
  assert_(dhRegionChips_(geo)[0] === "AMER" && dhRegionChips_(geo)[3] === "ANZ",
          "reading order is stable and does not follow the population");
  Logger.log("✅ _test_regionChips_ passed");
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
  // What the ticket BELONGS TO travels with it (2026-08-10). Blank rather than a
  // guess when the export carried no link: the drill-down paints "not linked" red,
  // so an invented value here would be a false accusation on a real ticket.
  assert_("epicKey" in m.items[0] && "epicName" in m.items[0],
          "every listed item carries its epic key and name, even when empty");
  assert_(!by["Nobody Here"], "non-roster assignee dropped");
  // Cap: totals cover ALL issues even when the item list is truncated.
  // Since v32 the PAYLOAD cap is BACKLOG_MAX_ITEMS_ALL (the client opens on
  // BACKLOG_MAX_ITEMS and expands to the rest in place), so 12 items now ship
  // whole — that is the point of the change, and the cap is tested below at its
  // real boundary rather than at the view's.
  var many = [];
  for (var i = 0; i < 12; i++) {
    many.push({ key: "K-" + i, summary: "s", assignee: "Maria Alvarez",
                status: "To Do", priority: "", due: null, remHrs: 1 });
  }
  var carried = backlogByPerson_(many, idx)["Maria Alvarez"];
  assert_(carried.items.length === 12 && carried.count === 12,
          "12 items are all carried — the ▾ Show all expand needs no round-trip");
  assert_(CONFIG_DH.BACKLOG_MAX_ITEMS_ALL > CONFIG_DH.BACKLOG_MAX_ITEMS,
          "the payload must carry MORE than the row opens with, or Show all shows nothing new");
  var over = [];
  for (var j = 0; j < CONFIG_DH.BACKLOG_MAX_ITEMS_ALL + 5; j++) {
    over.push({ key: "O-" + j, summary: "s", assignee: "Maria Alvarez",
                status: "To Do", priority: "", due: null, remHrs: 1 });
  }
  var capped = backlogByPerson_(over, idx)["Maria Alvarez"];
  assert_(capped.items.length === CONFIG_DH.BACKLOG_MAX_ITEMS_ALL &&
          capped.count === CONFIG_DH.BACKLOG_MAX_ITEMS_ALL + 5,
          "items capped at the payload cap, totals still uncapped");

  // ── UNSTARTED + UNDATED WORK IS NOT LISTED (user report 2026-08-10) ─────────
  // "I still see tickets in the status To Do with no due date in each rocketeer."
  // The rule had reached the RATE but not the LIST, so the same tickets were
  // still being shown per person with a red em-dash in the Due column.
  var mixed = backlogByPerson_([
    { key: "L-1", summary: "started, dated", assignee: "Maria Alvarez", status: "In Progress",
      priority: "", due: new Date(2026, 7, 20), remHrs: 5, ignored: false },
    { key: "L-2", summary: "To Do but dated", assignee: "Maria Alvarez", status: "To Do",
      priority: "", due: new Date(2026, 7, 21), remHrs: 3, ignored: false },
    { key: "L-3", summary: "started, undated", assignee: "Maria Alvarez", status: "In Progress",
      priority: "", due: null, remHrs: 2, ignored: false },
    { key: "X-1", summary: "To Do, undated", assignee: "Maria Alvarez", status: "To Do",
      priority: "", due: null, remHrs: 4, ignored: true },
    { key: "X-2", summary: "To Do, undated", assignee: "Maria Alvarez", status: "To Do",
      priority: "", due: null, remHrs: 6, ignored: true },
  ], idx)["Maria Alvarez"];
  assert_(mixed.items.map(function (i) { return i.key; }).sort().join() === "L-1,L-2,L-3",
          "only the three listable tickets reach the list — got " +
          mixed.items.map(function (i) { return i.key; }).join());
  assert_(mixed.listed === 3 && mixed.ignoredN === 2,
          "the two populations are counted APART, so the drill-down can state both");
  // The load is NOT reduced. A rule about what we GRADE must never quietly shrink
  // what somebody is carrying — that would be a second wrong number replacing the
  // first, and this one would flatter us.
  assert_(mixed.count === 5 && mixed.remHrs === 20,
          "count and remaining hours still cover the WHOLE open backlog, ignored included");
  assert_(mixed.ignoredHrs === 10, "…and the ignored hours are reported on their own");
  // Rule 3 lives on the far side of this too: a To Do ticket WITH a date is
  // listed like any other. If this ever flips, the list quietly stops showing
  // committed work nobody has started — the exact opposite of the intent.
  assert_(mixed.items.some(function (i) { return i.key === "L-2"; }),
          "a DATED To Do ticket is still listed — rule 3 applies to the list as well as the rate");

  // ── n MUST RECONCILE (user report 2026-08-10: "n = 79, drill-down shows 1") ──
  // The roster's n counts open EPICS as well, and the list never does. Unless the
  // three counters add up, the only available reading of the difference is that
  // the dashboard lost the tickets.
  var withEpics = { "Maria Alvarez": mixed };
  addOpenEpicCounts_(withEpics, [
    { key: "E-1", isEpic: true, assignee: "Maria Alvarez", status: "In Progress", resolved: null },
    { key: "E-2", isEpic: true, assignee: "Maria Alvarez", status: "To Do", resolved: null },
    { key: "E-3", isEpic: true, assignee: "Maria Alvarez", status: "Done",
      resolved: new Date(2026, 7, 1) },                       // resolved → not open
    { key: "E-4", isEpic: true, assignee: "Nobody Here", status: "To Do", resolved: null },
    { key: "S-9", isEpic: false, assignee: "Maria Alvarez", status: "To Do", resolved: null },
  ], idx);
  assert_(withEpics["Maria Alvarez"].epicsN === 2,
          "open epics attributed to the person are counted — resolved ones and other people's are not");
  var b = withEpics["Maria Alvarez"];
  assert_(b.listed + b.ignoredN + b.epicsN === b.count + b.epicsN,
          "listed + ignored accounts for every non-epic open ticket…");
  assert_(b.listed === 3 && b.ignoredN === 2 && b.epicsN === 2,
          "…so the drill-down can print 3 listed · 2 ignored · 2 epics and have it add up");
  // Somebody who owns ONLY epics gets a row created for them. Those are the people
  // the explanation is FOR — a delivery manager holding six epics and nothing else
  // was reading "n = 6" against an empty list.
  var epicOnly = {};
  addOpenEpicCounts_(epicOnly, [
    { key: "E-9", isEpic: true, assignee: "Maria Alvarez", status: "In Progress", resolved: null },
  ], idx);
  assert_(epicOnly["Maria Alvarez"] && epicOnly["Maria Alvarez"].epicsN === 1 &&
          epicOnly["Maria Alvarez"].items.length === 0,
          "a person with only open epics still gets a backlog record, so the row can explain itself");
  // Zero is a measurement: an undefined here would render the breakdown as NaN.
  var noEpics = { "Maria Alvarez": { count: 1, remHrs: 1, listed: 1, ignoredN: 0, ignoredHrs: 0, items: [] } };
  addOpenEpicCounts_(noEpics, [], idx);
  assert_(noEpics["Maria Alvarez"].epicsN === 0, "no epics reads 0, never undefined");
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
 * Jira Arrivals parse. Four rules, each a bug that has bitten this codebase:
 *  · columns BY NAME, so a column order change upstream cannot silently shift data;
 *  · a MISSING column yields null, never 0 — "nobody measured" and "measured zero"
 *    are different facts, and conflating them is how a feed outage reads as good news;
 *  · the ISO week key is computed HERE from Week Start. weekKeyFromDate_ emits
 *    "2026.W7"; the exporter's jb_isoWeekLabel_ emits "2026.W07". A label written
 *    upstream would fail to join for weeks 1-9 (spec §4.1);
 *  · Week Start must parse correctly as BOTH a "yyyy-mm-dd" STRING (what the
 *    exporter writes) and a Date (what Sheets may coerce it to) — via
 *    dhCellDateLocal_, never parseDhDate_'s `new Date(string)`, which is UTC
 *    midnight per spec and shifts a bare calendar date a day early (and a week
 *    early) in any behind-UTC timezone.
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

  // The exporter (v3.11.1+) ships Week Start as a "yyyy-mm-dd" STRING, not a
  // Date object — pin that form directly, not just the Date form above. A bare
  // string parsed via `new Date(string)` is UTC midnight per spec and would
  // bucket to the prior day (and prior ISO week) in any behind-UTC timezone;
  // dhCellDateLocal_ must read it from the string's digits instead. Run under
  // multiple TZ env vars (see task-8-report.md) to prove this holds everywhere,
  // not just on whichever machine happens to run this file.
  var fromString = parseArrivalRows_([
    ["Week Start", "Created", "Resolved"],
    ["2026-07-27", 224, 204],
  ]);
  assert_(fromString.weeks[0].iso === "2026.W31",
          "STRING Week Start '2026-07-27' → 2026.W31 — got " + fromString.weeks[0].iso);

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

/**
 * The median basis exists so one holiday week cannot move the headline. W31
 * resolved 204 against an eight-week mean of 297 — on a one-week denominator
 * weeks-to-clear read 16.1w against 11.0w on the trailing basis (spec §1.1).
 */
function _test_clearRateMedian_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_clearRateMedian_: " + m); }

  var steady = [300, 290, 310, 295, 305, 300, 298, 302];
  assert_(clearRateMedian_(steady, 8) === 300,
          "median of a steady series — got " + clearRateMedian_(steady, 8));

  // One holiday week at a third of normal must barely move it.
  var holiday = [300, 290, 310, 295, 305, 300, 298, 100];
  var m = clearRateMedian_(holiday, 8);
  assert_(m >= 295 && m <= 300, "one bad week cannot move the median — got " + m);

  // Refuses to publish under 5 weeks, and says nothing rather than guessing.
  assert_(clearRateMedian_([300, 290, 310, 295], 8) === null,
          "4 weeks → null");
  assert_(clearRateMedian_([300, 290, 310, 295, 305], 8) === 300,
          "5 weeks is enough — got " + clearRateMedian_([300, 290, 310, 295, 305], 8));
  assert_(clearRateMedian_([], 8) === null, "empty → null");
  assert_(clearRateMedian_(null, 8) === null, "null input → null");

  // Only the LAST n weeks count: an old spike outside the window is ignored.
  var withOldSpike = [9999, 9999, 9999, 300, 290, 310, 295, 305, 300, 298, 302, 300];
  assert_(clearRateMedian_(withOldSpike, 8) === 300,
          "window respected — got " + clearRateMedian_(withOldSpike, 8));

  // A zero week is DATA (a shutdown), not a gap: it counts.
  assert_(clearRateMedian_([0, 0, 0, 0, 0, 0], 8) === 0, "all-zero series → 0, not null");
  // A null week is a GAP and is dropped before the median.
  var withGap = [300, null, 310, 295, 305, 300];
  assert_(clearRateMedian_(withGap, 8) === 300,
          "null weeks dropped, not treated as 0 — got " + clearRateMedian_(withGap, 8));

  // THE CRUX: the minimum is checked AFTER the nulls are dropped. Eight weeks
  // of which four are gaps leaves four usable points — below the floor — so this
  // must refuse to publish. A check against the pre-filter count would see 8, sail
  // past the floor, and return a median over four points instead. This assertion is
  // the only one that tells those two implementations apart.
  var halfGaps = [300, null, 290, null, 310, null, 295, null];
  assert_(clearRateMedian_(halfGaps, 8) === null,
          "8 weeks with 4 gaps → null (4 usable < 5), not a median over the survivors — got " +
          clearRateMedian_(halfGaps, 8));
  Logger.log("✅ _test_clearRateMedian_ passed");
}

/**
 * The assigned and unassigned halves must be DISJOINT and never pre-summed.
 * Disjoint because flowOpenBuckets_ keeps its unassigned guard, so the same
 * record cannot land in both; never pre-summed because one half is filterable
 * and the other is org-wide, and a caller adding them would produce a number
 * belonging to neither population (spec §3 §2).
 */
function _test_unassignedInventory_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_unassignedInventory_: " + m); }
  var who = function (raw) {
    return String(raw || "").toLowerCase().trim() === "maria" ? "Maria" : null;
  };
  var issues = [
    // assigned + open + To Do → the assigned half
    { key: "Q-1", isEpic: false, resolved: null, assignee: "maria", status: "Open",
      statusCategory: "To Do", estSec: 7200, spentSec: 0 },
    // assigned + open + In Progress → assigned WIP (contributes items but NOT hours)
    { key: "Q-2", isEpic: false, resolved: null, assignee: "maria", status: "In Progress",
      statusCategory: "In Progress", estSec: 3600, spentSec: 1800 },
    // UNASSIGNED + open + To Do → the unassigned half only
    { key: "Q-3", isEpic: false, resolved: null, assignee: "⚠️ UNASSIGNED", status: "Open",
      statusCategory: "To Do", estSec: 3600, spentSec: 0 },
    // UNASSIGNED + open + In Progress → unassigned WIP (contributes items but NOT hours)
    { key: "Q-4", isEpic: false, resolved: null, assignee: "", status: "Open",
      statusCategory: "In Progress", estSec: 1800, spentSec: 0 },
    // RESOLVED → neither half; an inventory is open work only
    { key: "Q-5", isEpic: false, resolved: new Date("2026-07-28"), assignee: "⚠️ UNASSIGNED",
      status: "Done", statusCategory: "Done", estSec: 3600, spentSec: 3600 },
    // EPIC → neither half; epics roll up their children (same rule as flowOpenBuckets_)
    { key: "Q-6", isEpic: true, resolved: null, assignee: "⚠️ UNASSIGNED", status: "Open",
      statusCategory: "To Do", estSec: 36000, spentSec: 0 },
    // assignee exists but does NOT resolve to a person → falls out of both halves
    { key: "Q-7", isEpic: false, resolved: null, assignee: "ghost", status: "Open",
      statusCategory: "To Do", estSec: 1800, spentSec: 0 },
    // UNASSIGNED + open + blank statusCategory → unassigned uncategorized (not items)
    { key: "Q-8", isEpic: false, resolved: null, assignee: "⚠️ UNASSIGNED", status: "Open",
      statusCategory: "", estSec: 2400, spentSec: 600 },
    // assigned + open + blank statusCategory → assigned uncategorized (not items)
    { key: "Q-9", isEpic: false, resolved: null, assignee: "maria", status: "Open",
      statusCategory: "", estSec: 1200, spentSec: 0 },
  ];
  var s = queueSnapshot_(issues, who);

  assert_(s.assigned.items === 2, "assigned half = 2 (Q-1 To Do + Q-2 WIP) — got " + s.assigned.items);
  assert_(s.assigned.wipN === 1 && s.assigned.todoN === 1, "assigned split into WIP and To Do");
  assert_(s.assigned.todoHrs === 2, "assigned To Do hours only (Q-1: 2h) — got " + s.assigned.todoHrs);

  assert_(s.unassigned.items === 2, "unassigned half = 2 (Q-3 To Do + Q-4 WIP) — got " + s.unassigned.items);
  assert_(s.unassigned.wipN === 1 && s.unassigned.todoN === 1, "unassigned split into WIP and To Do");
  assert_(s.unassigned.todoHrs === 1, "unassigned To Do hours only (Q-3: 1h, not Q-4 WIP) — got " + s.unassigned.todoHrs);

  // Q-7 (ghost) falls out of BOTH halves because assignee exists but doesn't resolve.
  assert_(s.assigned.unattributed === 1, "Q-7 ghost tallied in unattributed — got " + s.assigned.unattributed);

  // Q-8 and Q-9 have blank statusCategory, landing in uncategorized, not items.
  assert_(s.assigned.uncategorized === 1, "Q-9 blank statusCategory in assigned uncategorized — got " + s.assigned.uncategorized);
  assert_(s.unassigned.uncategorized === 1, "Q-8 blank statusCategory in unassigned uncategorized — got " + s.unassigned.uncategorized);

  // No pre-summed total on the object: the caller must ask for it explicitly.
  assert_(s.items === undefined && s.total === undefined,
          "queueSnapshot_ must NOT expose a pre-summed total");

  // PARTITION CHECK. Every record that survives the base filters (non-epic,
  // unresolved, not closed-ish) must land in exactly one of five places:
  // assigned-bucketed, assigned-unattributed, assigned-uncategorized,
  // unassigned-bucketed, unassigned-uncategorized. This is the only assertion
  // here that catches a record going missing ANYWHERE — the per-half counts
  // above each pin one outcome, but none of them notices a record that falls
  // out of every bucket at once, which is the exact defect this task fixed.
  var eligible = 7;   // Q-1..Q-4, Q-7, Q-8, Q-9 — Q-5 resolved, Q-6 is an epic
  var accounted = s.assigned.items + s.assigned.unattributed + s.assigned.uncategorized +
                  s.unassigned.items + s.unassigned.uncategorized;
  assert_(accounted === eligible,
          "every eligible record is accounted for exactly once — expected " + eligible +
          ", got " + accounted);

  // The flowOpen parameter must be USED, not just accepted. Hand-build a result
  // that could not arise from the fixture, so a version that ignored the argument
  // and recomputed from `issues` would produce different numbers and fail here.
  var fakeFlowOpen = { buckets: [{ person: "Maria", wipN: 5, todoN: 3, todoEst: 0, todoHrs: 9 }],
                       unattributed: 7, uncategorized: 2 };
  var supplied = queueSnapshot_(issues, who, fakeFlowOpen);
  assert_(supplied.assigned.wipN === 5 && supplied.assigned.todoN === 3,
          "flowOpen argument is used, not recomputed — got wipN=" + supplied.assigned.wipN +
          " todoN=" + supplied.assigned.todoN);
  assert_(supplied.assigned.todoHrs === 9, "supplied todoHrs carried through — got " + supplied.assigned.todoHrs);
  assert_(supplied.assigned.unattributed === 7 && supplied.assigned.uncategorized === 2,
          "supplied loss counters carried through");
  // The unassigned half is computed from `issues` regardless, so it is unchanged.
  assert_(supplied.unassigned.items === 2, "unassigned half still computed from issues");

  // An all-assigned population reports zero unassigned, which is a MEASURED zero
  // (we looked and found none) and legitimately different from the null the
  // client shows when the feed cannot answer at all.
  var noneBlank = queueSnapshot_([issues[0]], who);
  assert_(noneBlank.unassigned.items === 0, "measured zero unassigned");
  assert_(noneBlank.unassigned.wipN === 0 && noneBlank.unassigned.todoN === 0,
          "unassigned shape preserved on all-assigned data");
  Logger.log("✅ _test_unassignedInventory_ passed");
}

/**
 * inventory(W-1) = inventory(W) - created(W) + resolved(W), anchored on the
 * MEASURED present and walked backwards. Recovers a real weeks-to-clear trend on
 * day one instead of waiting for Flow Snapshots to accumulate (spec §4.5).
 *
 * Capped at 26 weeks because the anchor carries the updated>=-26w bound while the
 * weekly deltas do not, so drift grows with distance from today. Reconstructed
 * points are FLAGGED, never silently mixed with measured ones.
 */
function _test_inventoryWalkback_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_inventoryWalkback_: " + m); }

  // Forward truth: start at 100, apply the deltas, end at 130.
  //   W28: +20 -10 → 110 | W29: +15 -5 → 120 | W30: +10 -10 → 120 | W31: +20 -10 → 130
  var weeks = [
    { iso: "2026.W28", created: 20, resolved: 10 },
    { iso: "2026.W29", created: 15, resolved: 5 },
    { iso: "2026.W30", created: 10, resolved: 10 },
    { iso: "2026.W31", created: 20, resolved: 10 },
  ];
  var r = inventoryWalkback_(130, weeks, 26);

  assert_(r.length === 4, "one point per week — got " + r.length);
  assert_(r[3].iso === "2026.W31" && r[3].items === 130, "newest point IS the anchor");
  assert_(r[2].items === 120, "W30 = 130 - 20 + 10 = 120 — got " + r[2].items);
  assert_(r[1].items === 120, "W29 = 120 - 10 + 10 = 120 — got " + r[1].items);
  assert_(r[0].items === 110, "W28 = 120 - 15 + 5 = 110 — got " + r[0].items);

  // The anchor is MEASURED; everything behind it is RECONSTRUCTED and says so.
  assert_(r[3].measured === true, "the anchor is flagged measured");
  assert_(r[0].measured === false && r[1].measured === false && r[2].measured === false,
          "walked-back points are flagged reconstructed");

  // SELF-CONSISTENCY on the capped window. The 4-week fixture above pins every
  // value by hand, so a round-trip there proves nothing new — but this one
  // supplies 30 weeks to exercise the cap, and asserting only `.length` would
  // let an off-by-one in the slice window, or a window taken from the wrong end,
  // pass unnoticed. Non-uniform deltas matter too: with created === resolved
  // every point is identical and a direction error is invisible.
  var varied = [];
  for (var j = 0; j < 30; j++) {
    varied.push({ iso: "2026.W" + (j + 1), created: 10 + (j % 5), resolved: 10 - (j % 3) });
  }
  var capped = inventoryWalkback_(500, varied, 26);
  assert_(capped.length === 26, "capped at 26 — got " + capped.length);
  assert_(capped[capped.length - 1].items === 500, "newest point is the anchor");
  // The window must be the LAST 26 weeks, not the first.
  assert_(capped[0].iso === "2026.W5" && capped[capped.length - 1].iso === "2026.W30",
          "capped window is the trailing one — got " + capped[0].iso + ".." +
          capped[capped.length - 1].iso);
  // Walk FORWARD through the reconstruction and confirm each step lands on the
  // next reported point. This is the invariant that makes the series trustworthy:
  // spot-checking values proves individual arithmetic, this proves the series
  // hangs together.
  for (var k = 0; k < capped.length - 1; k++) {
    var w = varied[varied.length - capped.length + k + 1];
    var stepped = capped[k].items + (w.created - w.resolved);
    assert_(stepped === capped[k + 1].items,
            "forward step from " + capped[k].iso + " lands on " + capped[k + 1].iso +
            " — expected " + capped[k + 1].items + ", stepped to " + stepped);
  }

  // Inventory can never be negative: a bad delta clamps at 0 rather than printing
  // a queue of -900 items, which is not a state the world can be in.
  // The oversized delta sits on the NEWEST week deliberately. Put it on the oldest
  // and the resulting negative lands in the accumulator AFTER the final write and
  // is discarded — the clamp is never invoked and the assertion passes with the
  // clamp deleted. Here W31's delta is applied while walking back to W30, so the
  // negative is a value that actually gets stored.
  var bad = [{ iso: "2026.W30", created: 10, resolved: 10 },
             { iso: "2026.W31", created: 1000, resolved: 0 }];
  var clamped = inventoryWalkback_(100, bad, 26);
  assert_(clamped[1].items === 100, "anchor week is unaffected by the clamp");
  assert_(clamped[0].items === 0,
          "walked-back negative clamps to exactly 0 — got " + clamped[0].items);

  // No anchor means no series. A reconstruction with nothing to anchor on is a
  // guess, and a guessed trend under a headline is worse than no trend.
  assert_(inventoryWalkback_(null, weeks, 26).length === 0, "null anchor → empty");
  assert_(inventoryWalkback_(130, [], 26).length === 0, "no weeks → empty");
  Logger.log("✅ _test_inventoryWalkback_ passed");
}

/**
 * The floor guards RATES, never COUNTS. A mean over one epic is not a mean, so
 * Forecast shelves at n=1; but three items cleared IS three items cleared, and
 * flooring a count would hide real work behind a "not measured" label.
 *
 * Also pins that the three new metrics carry NO target (spec D11): an unratified
 * bar on a C-suite headline reads as agreed the moment it is on screen.
 */
function _test_sampleFloor_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_sampleFloor_: " + m); }

  // Rates are floored.
  assert_(sampleFloorFor_("forecast", 1).ok === false, "forecast at n=1 is below the floor");
  assert_(sampleFloorFor_("forecast", 1).need === 5, "the floor states what it needs");
  assert_(sampleFloorFor_("forecast", 5).ok === true, "n=5 clears the floor");
  assert_(sampleFloorFor_("onTime", 19).ok === true, "onTime at n=19 clears it");
  assert_(sampleFloorFor_("queueCover", 2).ok === false, "queueCover is a rate and IS floored");

  // A floor is a THRESHOLD, not a decoration: it must actually bite between 1
  // and the stated need, and release exactly at the need — not one below it,
  // not one above it. Pins the boundary itself, which the n=1/n=5 pair above
  // does not: those two alone would still pass with the floor set to 2, 3, or
  // 4, or with `>=` swapped for `>`.
  assert_(sampleFloorFor_("forecast", 4).ok === false, "n=4 still short of a floor of 5");
  assert_(sampleFloorFor_("queueCover", 4).ok === false, "n=4 still short of queueCover's floor of 5");
  assert_(sampleFloorFor_("queueCover", 5).ok === true, "n=5 exactly clears queueCover's floor");

  // A rate BELOW its floor must not publish. This is the assertion that proves the
  // floor is actually attached to these metrics rather than merely defined: with
  // sampleFloor absent, sampleFloorFor_ treats the metric as a COUNT and returns
  // ok:true at any n, so this line fails until the entry carries a floor.
  ["onTime", "util", "leadTime", "quality"].forEach(function (id) {
    assert_(sampleFloorFor_(id, 2).ok === false,
            id + " below its floor must not publish — got ok=" + sampleFloorFor_(id, 2).ok);
    // n=2/n=5 alone pin only "a floor at or below 5 exists" — a regression to
    // sampleFloor:3 or :4 passes both (2<3 and 2<4 still fail; 5 still clears
    // either). n=4 pins the VALUE, not just its existence.
    assert_(sampleFloorFor_(id, 4).ok === false,
            id + " at n=4 is still below a floor of 5 — got ok=" + sampleFloorFor_(id, 4).ok);
    assert_(sampleFloorFor_(id, 5).ok === true,
            id + " at exactly its floor publishes — got ok=" + sampleFloorFor_(id, 5).ok);
  });

  // The floor and the coverage gate are DELIBERATELY separate instruments (the
  // whole point of this task) — proven here by picking two metrics that share
  // the same sampleFloor but carry different coverageGate values, and asserting
  // `need` is identical for both. A mutation that coupled `need` to coverageGate
  // (e.g. scaling it, or reading the wrong field) would pass every assertion
  // above — onTime/util/leadTime/quality/forecast/queueCover/clearedPerHead ALL
  // happen to carry sampleFloor:5, so a coupling bug would need two different
  // gates to surface, which nothing above supplies.
  assert_(METRIC_REGISTRY_.metrics.onTime.coverageGate !== METRIC_REGISTRY_.metrics.leadTime.coverageGate,
          "fixture check: onTime and leadTime must actually differ in coverageGate for this to test anything");
  assert_(sampleFloorFor_("onTime", 1).need === sampleFloorFor_("leadTime", 1).need,
          "same sampleFloor, different coverageGate (0.80 vs 0.90) — need must not vary with the gate");

  // Counts are never floored, at any n — including zero.
  ["netFlow", "arrived", "cleared", "inventory"].forEach(function (id) {
    assert_(sampleFloorFor_(id, 0).ok === true, id + " is a count and must never be floored");
    assert_(sampleFloorFor_(id, 1).ok === true, id + " at n=1 still publishes");
    // n=0/n=1 alone can't tell "never floored" apart from "floored at a value
    // that happens to coerce to 0" — sampleFloor:null coerces to 0 in a numeric
    // `>=`, so (0 >= null) is already true even if the dedicated null-branch is
    // deleted and every id falls through to the floored arithmetic. A NEGATIVE
    // n is the one input where the two code paths disagree: the real
    // never-floored branch ignores n entirely and always says ok, while the
    // fallthrough computes (-1 >= 0) === false. This is what actually proves
    // the branch exists rather than being accidentally unreachable.
    assert_(sampleFloorFor_(id, -1).ok === true, id + " is never floored even for a garbage negative n");
  });

  // An unknown id must not silently publish — fail closed.
  assert_(sampleFloorFor_("nonsense", 1).ok === false, "unknown metric fails closed");

  // D11: no targets on ANY of the six new metrics — the three headline entries
  // AND the three minimal count entries from the brief's trailing Note. All six
  // are new to this task, and the contract ("target: null") binds all six
  // equally; checking only three would leave the other three free to grow a
  // target unnoticed.
  var reg = METRIC_REGISTRY_.metrics;
  ["queueCover", "netFlow", "clearedPerHead", "inventory", "arrived", "cleared"].forEach(function (id) {
    assert_(reg[id], id + " is in the registry");
    assert_(reg[id].target === null, id + " must ship target: null — got " + reg[id].target);
    assert_(reg[id].hasOwnProperty("target"), id + " must EXPLICITLY carry target: null, not merely omit it");
  });
  assert_(reg.queueCover.dir === "down", "lower weeks-to-clear is better");
  assert_(reg.clearedPerHead.dir === "up", "more cleared per head is better");
  assert_((reg.queueCover.deviations || []).length > 0,
          "queueCover records its deviations (R&D scope, median basis, walkback limits)");
  // The forward reference from inventoryWalkback_'s JSDoc (Task 5): both walkback
  // limits — that nothing was deleted/moved out of scope, and that the anchor
  // carries the export's updated>=-26w bound while the weekly deltas do not —
  // must actually be recorded here, not just asserted to be non-empty above.
  var devText = reg.queueCover.deviations.join(" ");
  assert_(/nothing was deleted or moved out of scope/i.test(devText),
          "queueCover deviations record the walkback's no-deletion assumption");
  assert_(/updated>=-26w/i.test(devText),
          "queueCover deviations record the anchor's updated>=-26w bound vs. the deltas' lack of it");
  Logger.log("✅ _test_sampleFloor_ passed");
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

  // ── Unassigned columns: the TRISTATE is the whole point ──────────────────────
  // The exporter gained "Unassigned Items"/"Unassigned Hrs" after this tab already
  // held rows, and the tab is append-only with 52-week retention — so historical
  // rows genuinely have no value for them. An ABSENT column must therefore read
  // `null` ("nobody measured this week"), while a present-but-EMPTY cell reads `0`
  // ("we looked and the queue was fully owned"). Collapsing the two would assert
  // that nobody was unassigned in weeks nobody measured, which is the most
  // dangerous false read this dashboard has — it is the exact claim the whole
  // unowned-queue feature exists to disprove.
  assert_(r.snaps[0].unassignedN === null && r.snaps[0].unassignedHrs === null,
          "columns ABSENT → null, never 0 — got " + r.snaps[0].unassignedN +
          " / " + r.snaps[0].unassignedHrs);

  var withUn = parseFlowSnapshotRows_([
    ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items",
     "Unassigned Items", "Unassigned Hrs"],
    ["8/3/2026 07:00", "2026.W32", "11", "99", "35", "1839", "412.5"],
    // A present-but-BLANK cell is a MEASURED ZERO, not a gap: the exporter ran,
    // counted, and found none. This row is what separates a correct reader from
    // one that treats blank and absent alike.
    ["8/10/2026 07:00", "2026.W33", "9", "80", "30", "", ""],
  ]);
  assert_(withUn.snaps[0].unassignedN === 1839,
          "unassigned items read by NAME — got " + withUn.snaps[0].unassignedN);
  assert_(Math.abs(withUn.snaps[0].unassignedHrs - 412.5) < 0.001,
          "unassigned hours read — got " + withUn.snaps[0].unassignedHrs);
  assert_(withUn.snaps[1].unassignedN === 0 && withUn.snaps[1].unassignedHrs === 0,
          "present-but-blank → 0 (measured zero), NOT null — got " +
          withUn.snaps[1].unassignedN + " / " + withUn.snaps[1].unassignedHrs);

  // Column ORDER must not matter — every reader here resolves by header name.
  var shuffled = parseFlowSnapshotRows_([
    ["Unassigned Hrs", "ISO Week", "Backlog Items", "Generated", "Unassigned Items",
     "WIP Count", "Backlog Hrs"],
    ["412.5", "2026.W32", "35", "8/3/2026 07:00", "1839", "11", "99"],
  ]);
  assert_(shuffled.snaps[0].unassignedN === 1839 && shuffled.snaps[0].backlogN === 35,
          "columns resolved by name, not position");
  Logger.log("✅ _test_flowSnapshots_ passed");
}

/**
 * Pins the padded/unpadded ISO-week join bug (audit 2026-08-06):
 * writeFlowSnapshot_ writes via jb_isoWeekLabel_, which zero-pads
 * ("2026.W07"); weekKeyFromDate_ never does ("2026.W7"). A fixture built only
 * from two-digit weeks (e.g. the "2026.W31" rows in _test_flowSnapshots_
 * above) passes under BOTH the broken and the fixed implementation — that is
 * exactly how this survived — so this test's fixture MUST use a single-digit
 * week to have any chance of failing.
 */
function _test_flowSnapshotIsoCanon_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_flowSnapshotIsoCanon_: " + m); }
  var values = [
    ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items"],
    ["2/16/2026 07:00", "2026.W07", "5", "40", "12"],   // single-digit week, zero-padded
    ["8/3/2026 07:00",  "2026.W31", "11", "99", "35"],  // two-digit week, must pass through as-is
  ];
  var r = parseFlowSnapshotRows_(values);
  assert_(r.available === true, "parsed");
  assert_(r.snaps.length === 2, "both rows kept");
  assert_(r.snaps[0].iso === "2026.W7",
          "single-digit week is canonicalised: 2026.W07 → 2026.W7, matching weekKeyFromDate_");
  assert_(r.snaps[1].iso === "2026.W31",
          "two-digit week passes through unchanged — normalisation must not over-reach");

  // Unit-level pin on the helper itself, independent of the sheet-row parse.
  assert_(canonicalIsoWeek_("2026.W07") === "2026.W7", "helper: single-digit padded → unpadded");
  assert_(canonicalIsoWeek_("2026.W7") === "2026.W7", "helper: already-unpadded is idempotent");
  assert_(canonicalIsoWeek_("2026.W31") === "2026.W31", "helper: two-digit week is untouched");
  Logger.log("✅ _test_flowSnapshotIsoCanon_ passed");
}

/** Registry integrity (FR-1.1/FR-1.2) — the payload's definitional contract.
    A metric that ships without an owner or a coverage gate can't be defended in
    a review, and a gate the tiles can't read is a gate that never fires. */
function _test_registry_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_registry_: " + m); }
  var R = METRIC_REGISTRY_;
  assert_(R.version && R.updated, "registry carries a version and a date");

  // CORE KEY SET — every metric, live or absent, rate or count, must carry all
  // of these. This used to be checked on 5 hand-picked ids only, which is how 6
  // new entries (queueCover/netFlow/clearedPerHead/inventory/arrived/cleared)
  // shipped missing id/coverageOf/ebitda with every suite green — the omission
  // was real but nothing was looking at those 6 ids. Iterating every registered
  // id, not a fixed list, is what makes the next such omission loud.
  //
  // `target` is DELIBERATELY exempted from a SHAPE check in this loop: its
  // value legitimately varies by design — a graded {green,amber} object for a
  // metric with a client-visible RAG band, or null under the D6/D11 no-target
  // convention for a metric nobody owns a bar for yet. What IS universal, and
  // checked here, is that the KEY itself is always present rather than simply
  // omitted — an omitted key and an explicit null must not be indistinguishable
  // (see the D11 assertions above, which is exactly the omission this guards).
  // The narrower graded-target loop below still pins the shape for the metrics
  // that DO carry one.
  var ids = Object.keys(R.metrics);
  assert_(ids.length >= 10, "sanity: the registry actually has metrics registered");
  ids.forEach(function (id) {
    var m = R.metrics[id];
    ["name", "definition", "formula", "grain", "owner", "paramOwner", "ebitda"].forEach(function (f) {
      assert_(m[f] && String(m[f]).trim().length >= 3, id + " has a " + f);
    });
    assert_(m.id === id, id + " id matches its key");
    assert_(m.sources && m.sources.length, id + " names its source fields");
    assert_(typeof m.coverageGate === "number" && m.coverageGate >= 0 && m.coverageGate <= 1,
            id + " coverage gate is a 0–1 fraction");
    assert_(m.hasOwnProperty("coverageOf") && String(m.coverageOf || "").trim().length >= 3,
            id + " states what its coverage gate measures over, even when the answer is n/a");
    assert_(m.deviations instanceof Array, id + " carries a deviations array (may legitimately be empty)");
    assert_(m.hasOwnProperty("target"), id + " explicitly carries a target key (a graded object, or null)");
  });

  // GRADED TARGETS — narrower than the core set above: only the metrics that
  // actually carry a client-visible RAG band need target.green to be a number.
  ["onTime", "forecast", "util", "quality", "hygiene"].forEach(function (id) {
    var m = R.metrics[id];
    assert_(m.target && typeof m.target.green === "number", id + " has a graded target");
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
 * Pins the fix for the fourth "absent assignee scored as failed roster join"
 * surface (spec §4.6/D12 conflation, reappearing in backlogHealthBuckets_):
 * an issue with NO assignee must land in `unassigned`, never `unattributed` —
 * mirroring typeHygieneBuckets_'s hasAssignee/attrN split exactly. Before the
 * fix both cases fell through the same `if (!dn) unattributed++` line, so
 * this assertion would still pass under the OLD code if it only checked the
 * SUM of the two counters — it deliberately checks them apart.
 *
 * Self-invoking (like node-tests.js's own _test_clientParity_/_test_
 * confidenceParity_) rather than added to the call list at the bottom of
 * node-tests.js — that runner file was out of scope for this fix set, so this
 * test wires itself in at eval() time instead of needing a second file touched.
 */
(function _test_backlogHealthUnassigned_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_backlogHealthUnassigned_: " + m); }
  var resolve = function (raw) { return /maria/i.test(raw || "") ? "Maria Alvarez" : null; };
  var jira = { issues: [
    // Has an assignee, resolves to a roster person → a normal bucket row.
    { key: "K-1", assignee: "Maria Alvarez", status: "To Do", statusCategory: "To Do" },
    // Has an assignee, NOT on the roster → unattributed (a FAILED join).
    { key: "K-2", assignee: "Random Dev", status: "To Do", statusCategory: "To Do" },
    // No assignee at all (blank) → unassigned (nothing to join).
    { key: "K-3", assignee: "", status: "To Do", statusCategory: "To Do" },
    // No assignee at all (exporter's sentinel) → unassigned, same as blank.
    { key: "K-4", assignee: "⚠️ UNASSIGNED", status: "To Do", statusCategory: "To Do" },
    // Resolved work is not backlog — must not appear in either counter.
    { key: "K-5", assignee: "", status: "Done", resolved: new Date(2026, 6, 28) },
  ] };
  var r = backlogHealthBuckets_(jira, resolve, new Date(2026, 6, 30));
  assert_(r.unassigned === 2, "K-3 blank + K-4 sentinel → unassigned = 2, got " + r.unassigned);
  assert_(r.unattributed === 1, "K-2 (assignee present, not on roster) → unattributed = 1, got " + r.unattributed);
  assert_(r.buckets.length === 1 && r.buckets[0].person === "Maria Alvarez" && r.buckets[0].n === 1,
          "only K-1 lands in a person bucket");
  // The regression this guards: collapsing both into one counter would still
  // read "3 excluded" in total, which is why the two must be asserted apart,
  // not just their sum.
  assert_(r.unassigned !== r.unattributed, "the two populations are genuinely different sizes here");
  Logger.log("✅ _test_backlogHealthUnassigned_ passed");
})();

/**
 * OVERDUE IS WEEK-GRAINED (managers' feedback 2026-08-10).
 *
 * The regression this pins is a timestamp comparison that flagged a ticket due
 * EARLIER THIS WEEK while the committed week was still running. It is invisible
 * on a fixture whose dates are months old, which is why every case here sits
 * within a few days of the boundary — and why `now` is a fixed Wednesday rather
 * than a real clock.
 */
(function _test_backlogOverdueWeekGrain_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_backlogOverdueWeekGrain_: " + m); }
  var resolve = function () { return "Maria Alvarez"; };
  // Wednesday 2026-08-12, 15:00 — ISO week 2026.W33, which starts Monday the 10th.
  var now = new Date(2026, 7, 12, 15, 0);
  assert_(dhWeekStart_(now).getTime() === new Date(2026, 7, 10).getTime(),
          "the boundary is Monday 00:00 of the current ISO week");
  assert_(dhWeekStart_(new Date(2026, 7, 10, 0, 30)).getTime() === new Date(2026, 7, 10).getTime(),
          "Monday itself resolves to its own midnight, not the week before");
  assert_(dhWeekStart_(new Date(2026, 7, 16, 23, 0)).getTime() === new Date(2026, 7, 10).getTime(),
          "Sunday belongs to the week that STARTED on Monday — JS day 0 is not day 1");

  function due_(key, d) {
    return { key: key, assignee: "Maria Alvarez", status: "In Progress",
             statusCategory: "In Progress", due: d, updated: now };
  }
  var jira = { issues: [
    due_("MON",  new Date(2026, 7, 10)),   // earlier THIS week — was flagged before v32
    due_("WED",  new Date(2026, 7, 12)),   // today
    due_("FRI",  new Date(2026, 7, 14)),   // later this week
    due_("LAST", new Date(2026, 7, 7)),    // last Friday → 5 days late  → band ≤7
    due_("OLD",  new Date(2026, 6, 27)),   // 16 days late               → band 8–30
    due_("ANCIENT", new Date(2026, 4, 1)), // ~100 days late             → band >30
  ] };
  var b = backlogHealthBuckets_(jira, resolve, now).buckets[0];

  assert_(b.overdue === 3, "only the three whose committed WEEK has ended are late, got " + b.overdue);
  assert_(b.futureDated === 3,
          "MON/WED/FRI are live commitments — a date inside the current week is in compliance");
  assert_(b.keys.overdue.indexOf("MON") === -1 && b.keys.overdue.indexOf("WED") === -1,
          "…and they are absent from the work QUEUE too, not merely from the count");
  assert_(b.keys.overdue.join() === "LAST,OLD,ANCIENT", "the queue holds exactly the late three");

  // The partition invariant: `dated` splits exactly into futureDated + overdue.
  // If the two rules ever drift, a ticket appears twice or vanishes — and both
  // failures read as a plausible number rather than as a bug.
  assert_(b.dated === b.futureDated + b.overdue,
          "dated === futureDated + overdue, always — the good row is the complement of the bad one");

  // Bands: gated on the same rule, then aged. LAST is 5 days past due but its week
  // has ended, so it belongs in ≤7 — the gate must not swallow it either.
  assert_(b.overdue7 === 1 && b.overdue30 === 1 && b.overdueOver30 === 1,
          "each band holds one: LAST (5d) / OLD (~6w) / ANCIENT (>30d)");
  assert_(b.overdue7 + b.overdue30 + b.overdueOver30 === b.overdue,
          "the three bands PARTITION the overdue total — no gap, no double count");

  // Same fixture, read on the Monday the boundary moves: LAST is now inside the
  // current week and stops being late, which is the whole point of the rule.
  var mon = backlogHealthBuckets_(jira, resolve, new Date(2026, 7, 10, 9, 0)).buckets[0];
  assert_(mon.overdue === 3 && mon.keys.overdue.indexOf("LAST") !== -1,
          "on Monday the 10th, last Friday's date is in the week that just ended — still late");
  var prevWeek = backlogHealthBuckets_(jira, resolve, new Date(2026, 7, 7, 9, 0)).buckets[0];
  assert_(prevWeek.overdue === 2 && prevWeek.keys.overdue.indexOf("LAST") === -1,
          "read DURING that Friday's own week, it is a live commitment — 2 late, not 3");

  // An item with no due date is in none of these rows: it is the `undated` queue's,
  // and counting it here would double-report one record as two different problems.
  var noDue = backlogHealthBuckets_({ issues: [
    { key: "N-1", assignee: "Maria Alvarez", status: "In Progress",
      statusCategory: "In Progress", due: null, updated: now } ] }, resolve, now).buckets[0];
  assert_(noDue.overdue === 0 && noDue.futureDated === 0 && noDue.undated === 1,
          "no due date is an 'undated' finding, never a late one");

  // ── THE UNDATED QUEUE HOLDS STARTED WORK ONLY (user report 2026-08-10) ──────
  // The queue was sending people after tickets the RATE had already stopped
  // counting. Now the unstarted ones are tallied apart, as context rather than as
  // a queue — and the three counters must still partition the population, or the
  // panel's own reconciliation goes quiet about records nobody can see.
  var split = backlogHealthBuckets_({ issues: [
    { key: "U-1", assignee: "Maria Alvarez", status: "In Progress",
      statusCategory: "In Progress", due: null, updated: now },          // started, undated → QUEUE
    { key: "U-2", assignee: "Maria Alvarez", status: "To Do",
      statusCategory: "To Do", due: null, updated: now },                // unstarted, undated → ignored
    { key: "U-3", assignee: "Maria Alvarez", status: "To Do",
      statusCategory: "To Do", due: null, updated: now },                // …and another
    { key: "U-4", assignee: "Maria Alvarez", status: "To Do",
      statusCategory: "To Do", due: new Date(2026, 7, 20), updated: now }, // unstarted but DATED → dated
  ] }, resolve, now).buckets[0];
  assert_(split.undated === 1 && split.keys.undated.join() === "U-1",
          "only the STARTED undated ticket is a due-date gap with a queue behind it");
  assert_(split.undatedIgnored === 2,
          "the two unstarted undated tickets are counted apart, not lost");
  assert_(!split.keys.undatedIgnored,
          "…and carry NO key list: nobody is meant to go and work them, and a key list invites it");
  assert_(split.dated === 1,
          "rule 3 again: an unstarted ticket that HAS a date is dated like any other");
  assert_(split.dated + split.undated + split.undatedIgnored === split.n,
          "the three still PARTITION the open population — no record is in two of them or in none");

  // The boundary ships, so the panel can state which Monday it judged against.
  assert_(backlogHealthBuckets_(jira, resolve, now).weekStart === new Date(2026, 7, 10).toISOString(),
          "the payload carries the week boundary it measured against");
  Logger.log("✅ _test_backlogOverdueWeekGrain_ passed");
})();

/**
 * 🚩 EPICS WITHOUT A DUE DATE (team agreement 2026-08-10).
 *
 * The audit's whole value is that it CANNOT be flattered, so this suite is mostly
 * about what it refuses to exclude: unassigned epics, epics whose assignee is off
 * the roster, and — the one that matters most — epics sitting in To Do, which the
 * fill columns now deliberately skip.
 */
(function _test_epicDueAudit_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_epicDueAudit_: " + m); }
  var W = new Date(2026, 6, 28);
  function ep(o) {
    return Object.assign({ key: "K", isEpic: true, typeLabel: "Epic", status: "In Progress",
                           statusCategory: "In Progress", due: null, resolved: null,
                           assignee: "Maria Alvarez" }, o);
  }
  var a = epicDueAudit_({ issues: [
    ep({ key: "E-1" }),                                   // open Epic, no date → FLAG
    ep({ key: "E-2", due: W }),                           // dated → fine
    // To Do with no date. The 🧬 matrix and the roster skip this row by rule
    // (dueExpected_); the audit MUST NOT — it is the case the agreement is about.
    ep({ key: "E-3", status: "To Do", statusCategory: "To Do" }),
    // No assignee at all. An epic is a container; "nobody owns it" is not a reason
    // to stop asking for its end date.
    ep({ key: "E-4", assignee: "⚠️ UNASSIGNED" }),
    // Assignee who does not join the roster — same argument.
    ep({ key: "E-5", assignee: "Random Contractor" }),
    // A different epic TYPE — must get its own row, not be pooled.
    ep({ key: "G-1", typeLabel: "Go-live epic" }),
    ep({ key: "G-2", typeLabel: "Go-live epic", due: W }),
    // NOT epics → invisible to this audit however undated they are.
    ep({ key: "S-1", isEpic: false, typeLabel: "Story" }),
    ep({ key: "T-1", isEpic: false, typeLabel: "Task", status: "To Do", statusCategory: "To Do" }),
    // RESOLVED epic with no date → out: a date added now moves no future number.
    ep({ key: "R-1", resolved: W, status: "Done" }),
    // Closed-ish with no resolution date → in NEITHER population, same rule as
    // every other surface here (typeHygOpen_).
    ep({ key: "C-1", status: "Closed" }),
  ] });

  assert_(a.n === 7 && a.missing === 5,
          "7 open epics, 5 with no date, got " + a.n + "/" + a.missing);
  var epicRow = a.rows.filter(function (r) { return r.type === "Epic"; })[0];
  var goRow = a.rows.filter(function (r) { return r.type === "Go-live epic"; })[0];
  assert_(epicRow && goRow, "each epic TYPE gets its own row — pooling them hides where to go");
  assert_(epicRow.keys.join() === "E-1,E-3,E-4,E-5",
          "the queue names the offending keys, To Do and unassigned INCLUDED — got " +
          epicRow.keys.join());
  assert_(goRow.n === 2 && goRow.missing === 1 && goRow.keys.join() === "G-1",
          "the second type counts independently");
  assert_(a.rows[0].type === "Epic",
          "rows sort most-missing first — that ordering IS the audit's work order");
  assert_(!a.rows.some(function (r) { return /Story|Task/.test(r.type); }),
          "non-epics never appear, however undated");
  assert_(a.rows.every(function (r) { return r.keys.indexOf("R-1") === -1 && r.keys.indexOf("C-1") === -1; }),
          "resolved and closed-without-a-date epics are out of the audit");

  // The intersection with dueExpected_ — stated as an assertion because it is the
  // single most confusing thing about this release: the SAME To Do epic is skipped
  // by the fill columns and flagged by the audit, on purpose.
  assert_(dueExpected_(ep({ status: "To Do", statusCategory: "To Do" }), true) === false &&
          epicRow.keys.indexOf("E-3") !== -1,
          "an undated To Do epic is OUT of the graded fill columns and IN the audit — " +
          "if these two ever agree, one of the two rules has been lost");

  // A clean org reports zero, not an absent panel: "we checked and found none" and
  // "we did not check" must never render the same.
  var clean = epicDueAudit_({ issues: [ep({ key: "OK-1", due: W })] });
  assert_(clean.n === 1 && clean.missing === 0 && clean.rows.length === 1,
          "a fully-dated epic set still emits its row, with missing 0");
  assert_(epicDueAudit_({ issues: [] }).rows.length === 0, "an empty feed emits no rows");

  // Cap is enforced AND flagged, same contract as every other key list here.
  var many = [];
  for (var i = 0; i < EPIC_DUE_MAX_KEYS_ + 10; i++) many.push(ep({ key: "M-" + i }));
  var capped = epicDueAudit_({ issues: many }).rows[0];
  assert_(capped.missing === EPIC_DUE_MAX_KEYS_ + 10, "the COUNT covers every offender");
  assert_(capped.keys.length === EPIC_DUE_MAX_KEYS_ && capped.capped === true,
          "…the key LIST is capped and says so");
  Logger.log("✅ _test_epicDueAudit_ passed");
})();

// ── PM ATTRIBUTION (spec 2026-08-11) ─────────────────────────
function _test_pmAttribution_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_pmAttribution_: " + m); }

  // ── dhProjectOf_ ──
  assert_(dhProjectOf_("GTT-605") === "GTT", "plain key");
  assert_(dhProjectOf_("gtt-605") === "GTT", "lowercased key is canonicalised");
  assert_(dhProjectOf_("ABC123-7") === "ABC123", "digits inside a project key survive");
  assert_(dhProjectOf_("GTT-605-2") === "GTT-605", "only the FINAL -N is stripped");
  assert_(dhProjectOf_("") === "", "empty in, empty out");
  assert_(dhProjectOf_(null) === "", "null does not throw");
  assert_(dhProjectOf_("NOTAKEY") === "NOTAKEY",
          "a key with no -N degrades to itself rather than to a blank bucket");

  // ── pmByProject_ ──
  var rows = [
    { user: "Ana", key: "GTT", pm: "Dana Reyes", weekHours: { "2026.W30": 8 } },
    { user: "Bo",  key: "GTT", pm: "Dana Reyes", weekHours: { "2026.W31": 8 } },
    { user: "Cy",  key: "ACME", pm: "Sam Ortiz", weekHours: { "2026.W31": 4 } },
    // A blank PM must not create a "" entry — that would collide with the
    // (No PM) bucket and make a tagging gap look like a named owner.
    { user: "Di",  key: "NOPM", pm: "", weekHours: { "2026.W31": 4 } },
  ];
  var idx = pmByProject_(rows);
  assert_(idx.byProject.GTT === "Dana Reyes", "GTT maps to its PM");
  assert_(idx.byProject.ACME === "Sam Ortiz", "ACME maps to its PM");
  assert_(!("NOPM" in idx.byProject), "a blank PM creates no entry");
  assert_(idx.superseded === 0, "no conflicts in the clean case");

  // Multi-PM project: LAST-SEEN WINS (spec §5.1) — the row in the most recent
  // week carrying hours. Deliberately listed oldest-last to prove the rule is
  // reading the WEEK, not the array order.
  var churn = [
    { user: "Ana", key: "GTT", pm: "New Owner", weekHours: { "2026.W33": 8 } },
    { user: "Bo",  key: "GTT", pm: "Old Owner", weekHours: { "2026.W20": 8 } },
  ];
  var c = pmByProject_(churn);
  assert_(c.byProject.GTT === "New Owner",
          "last-seen wins — and by week, not by position in the array");
  assert_(c.superseded === 1, "the overwrite is COUNTED, never silent");

  // Single-digit weeks again: W9 vs W10 must compare numerically here too, or a
  // handover in early spring resolves backwards.
  var spring = [
    { user: "Ana", key: "GTT", pm: "Later Owner", weekHours: { "2026.W10": 8 } },
    { user: "Bo",  key: "GTT", pm: "Earlier Owner", weekHours: { "2026.W9": 8 } },
  ];
  assert_(pmByProject_(spring).byProject.GTT === "Later Owner",
          "W10 is later than W9 — numeric week compare, not lexicographic");

  // Time-off rows never confer ownership (mirrors the acc.pms guard at :5539).
  // NOTE the key: time-off is decided by isTimeOffKey_(row.key) — CONFIG_DH
  // .NONPROJECT_KEYS is ["NETSUITE"] and matches on PREFIX. There is no
  // `row.timeOff` property; asserting on a fabricated one would pass while the
  // production guard did nothing.
  var off = [{ user: "Ana", key: "NETSUITE-PTO", pm: "Dana Reyes",
               weekHours: { "2026.W31": 8 } }];
  assert_(Object.keys(pmByProject_(off).byProject).length === 0,
          "a NETSUITE time-off row confers no project ownership");
  assert_(isTimeOffKey_("NETSUITE-PTO") === true,
          "…and the guard is the shared predicate, not a local re-derivation");

  // A row with a PM but no hours anywhere carries no evidence of CURRENT
  // ownership, so it must not claim the project out from under a row that does.
  var noHours = [
    { user: "Ana", key: "GTT", pm: "Real Owner", weekHours: { "2026.W31": 8 } },
    { user: "Bo",  key: "GTT", pm: "Ghost Owner", weekHours: {} },
  ];
  assert_(pmByProject_(noHours).byProject.GTT === "Real Owner",
          "a zero-hours row cannot take ownership from a row with hours");

  // ── pmOwnedWork_ ──
  var today = new Date(2026, 7, 11);           // 2026.W33, AUG 2026
  function iss(o) {
    return { key: o.key, isEpic: !!o.isEpic, due: o.due || null,
             status: o.status || "In Progress", statusCategory: o.cat || "In Progress",
             estSec: o.estSec === undefined ? 3600 : o.estSec,
             linked: o.linked === undefined ? true : o.linked,
             start: o.start === undefined ? new Date(2026, 6, 1) : o.start,
             updated: o.updated || new Date(2026, 7, 10),
             epicKey: o.epicKey || "", parentKey: o.parentKey || "",
             assignee: o.assignee || "",
             typeLabel: o.isEpic ? "Epic" : "Task", summary: o.key };
  }
  var pmIdx = { GTT: "Dana Reyes", ACME: "Sam Ortiz" };
  var work = pmOwnedWork_({ issues: [
    // Dana's epics under the 2026-08-17 rule: GTT-1 and GTT-2 are GRADED (both
    // dated) → bar 1 = 2/2; GTT-3 is undated AND unstarted, so it is backlog,
    // not a commitment, and leaves the bar into epicBacklogN.
    iss({ key: "GTT-1", isEpic: true, due: new Date(2026, 7, 20) }),  // AUG — in window
    iss({ key: "GTT-2", isEpic: true, due: new Date(2026, 9, 15),     // OCT — out of window
          status: "To Do", cat: "To Do" }),                           //   …unstarted but DATED
    iss({ key: "GTT-3", isEpic: true, due: null,                      // undated AND unstarted
          status: "To Do", cat: "To Do" }),
    // Children of GTT-1 (epic due 2026.W34)
    iss({ key: "GTT-10", due: new Date(2026, 7, 17), epicKey: "GTT-1" }),  // W34 — within
    iss({ key: "GTT-11", due: new Date(2026, 8, 10), epicKey: "GTT-1" }),  // W37 — OVER
    iss({ key: "GTT-12", due: null, epicKey: "GTT-1" }),                   // started, no date
    iss({ key: "GTT-13", due: null, epicKey: "GTT-1",                      // To Do, no date
          status: "To Do", cat: "To Do" }),
    // A SUB-TASK whose parent is a STORY, not the epic — the chain case.
    iss({ key: "GTT-14", due: new Date(2026, 7, 18), parentKey: "GTT-10" }),
    // Sam's project
    iss({ key: "ACME-1", isEpic: true, due: new Date(2026, 7, 5) }),
    // A project with no PM row at all
    iss({ key: "ORPH-1", isEpic: true, due: null }),
  ] }, pmIdx, today);

  var byPm = {};
  work.rows.forEach(function (r) { byPm[r.pm] = r; });

  var dana = byPm["Dana Reyes"];
  assert_(dana, "Dana has a row");
  // ── BAR 1 UNDER THE 2026-08-17 RULE ──────────────────────────────────────
  // "Project managers cannot be punished for Epics available with no due date
  // if they have the status TO DO, since it is part of the assigned backlog."
  // An epic becomes the PM's commitment when somebody STARTS it or DATES it.
  assert_(dana.epicN === 2 && dana.epicDated === 2,
          "bar 1 grades only COMMITTED epics — started or dated — and both of Dana's are dated");
  assert_(dana.epicMissingKeys.length === 0,
          "…so an undated backlog epic is not named as a missing due date");

  // THE EXCLUSION IS COUNTED, NEVER SILENT. This is what keeps a 100% bar
  // honest: a PM whose whole portfolio is undated backlog reads 0 committed
  // epics plus a named backlog count, not a clean 100% with nothing to fix.
  assert_(dana.epicBacklogN === 1, "the carved epic is COUNTED in epicBacklogN, not dropped");
  assert_(dana.epicBacklogKeys.indexOf("GTT-3") !== -1, "…and named, so the exclusion is auditable");

  // THE TRAP, restated for the new rule (spec §5.2). The carve is narrow: ONLY
  // undated-and-unstarted leaves. GTT-2 is out of window and sitting in To Do,
  // but it is DATED — that is a commitment somebody made, and if the window
  // carve ever reached this bar the denominator would shrink and every PM would
  // drift toward 100%.
  assert_(dana.epicN === 2,
          "bar 1 is still UNWINDOWED — a dated To Do epic due in October stays in the denominator");
  assert_(dana.epicBacklogN === 1,
          "…and only the undated+unstarted one is carved, never the merely out-of-window one");
  assert_(dana.readyDen === 5,
          "bar 2 denominator is all open non-epics, including the ignored ones");

  // ── The epic LIST: WIP or in-window, and nothing else ────────────────────
  var listed = dana.epics.map(function (e) { return e.key; });
  assert_(listed.indexOf("GTT-1") !== -1, "a dated, in-window epic is listed");
  assert_(listed.indexOf("GTT-2") === -1,
          "a To Do epic due in OCTOBER is neither started nor in window — not listed");
  assert_(listed.indexOf("GTT-3") === -1,
          "an unstarted, undated epic is not listed — it is backlog, not a commitment");
  // It leaves the bar too under the 2026-08-17 rule, so what makes hiding it
  // fair is no longer epicMissingKeys — it is being counted and NAMED as
  // carried backlog, plus the ORG-scope 🚩 audit on Actions, which takes no
  // carve at all and still names the ticket.
  assert_(dana.epicBacklogKeys.indexOf("GTT-3") !== -1,
          "…so it is still named, as carried backlog rather than as a missed due date");

  // ── Children graded against the EPIC's deadline ──────────────────────────
  var e1 = dana.epics.filter(function (e) { return e.key === "GTT-1"; })[0];
  var ck = {};
  e1.children.forEach(function (c) { ck[c.key] = c; });
  assert_(ck["GTT-10"].verdict === "within", "a child due inside the epic's week is within");
  // GTT-1 is due 2026-08-20 (W34) — still ahead of the W33 anchor — so a child
  // beyond it is a plan that can still be fixed, not a failure.
  assert_(ck["GTT-11"].verdict === "atRisk",
          "a child past an epic whose date has NOT passed is at risk, not breached");
  assert_(ck["GTT-11"].overByWeeks === 3, "…and says by how many weeks");
  assert_(ck["GTT-12"].verdict === "nodate",
          "a STARTED child with no date of its own is ungraded and counted, never 'within'");
  assert_(!ck["GTT-13"],
          "a To Do child with no due date is NOT listed — not a commitment yet (2026-08-10)");
  assert_(e1.ignoredN === 1, "…it is COUNTED instead, so the exclusion is visible");
  assert_(e1.within === 2 && e1.atRisk === 1 && e1.breached === 0 && e1.noDate === 1,
          "the epic row tallies its children: 2 within (incl. the sub-task), 1 at risk, 1 no-date");

  // The chain walk: GTT-14's parent is GTT-10, a STORY, whose epic is GTT-1.
  assert_(ck["GTT-14"] && ck["GTT-14"].verdict === "within",
          "a sub-task parented to a STORY still reaches the epic — the chain walk");

  // Over-deadline children sort first: that is the finding on the row.
  assert_(e1.children[0].verdict === "atRisk", "children sort worst-first");
  assert_(!("_dueDate" in e1), "the internal epic Date is not shipped");

  // (No PM) is a named coverage gap, not an empty state, and sorts last.
  var orphan = byPm["(No PM)"];
  assert_(orphan && orphan.epicN === 1, "a project absent from Tempo lands in (No PM)");
  assert_(work.rows[work.rows.length - 1].pm === "(No PM)",
          "(No PM) sorts LAST regardless of size — it is a hygiene bucket, not a PM");

  // Worst-first among real PMs, by undated epic count.
  assert_(work.rows[0].pm === "Dana Reyes", "sorted worst-first by undated epics");

  // An epic with NO due date but WIP is listed (it is in progress), and its
  // children cannot be graded against a deadline that does not exist.
  var wip = pmOwnedWork_({ issues: [
    iss({ key: "GTT-5", isEpic: true, due: null }),                   // WIP, undated
    iss({ key: "GTT-50", due: new Date(2026, 7, 20), epicKey: "GTT-5" }),
  ] }, pmIdx, today);
  var e5 = wip.rows[0].epics.filter(function (e) { return e.key === "GTT-5"; })[0];
  assert_(e5, "a WIP epic with no due date IS listed — it is in progress");
  assert_(e5.children[0].verdict === "ungraded",
          "its children are ungraded — there is no deadline to be within or over");

  // Cycle guard: a parent loop must not hang the model build.
  var loop = pmOwnedWork_({ issues: [
    iss({ key: "GTT-6", isEpic: true, due: new Date(2026, 7, 20) }),
    iss({ key: "GTT-60", parentKey: "GTT-61" }),
    iss({ key: "GTT-61", parentKey: "GTT-60" }),
  ] }, pmIdx, today);
  assert_(loop.rows.length === 1, "a parent cycle resolves to no epic instead of hanging");

  // ── ASSIGNEE-FIRST ATTRIBUTION (user decision 2026-08-11) ────────────────
  assert_(dhPmName_("Lopez, Moises") === "Moises Lopez", "comma form flips for display");
  assert_(dhPmName_("Moises Lopez") === "Moises Lopez", "plain form is untouched");
  assert_(dhPmKey_("Lopez, Moises") === dhPmKey_("Moises Lopez"),
          "both spellings collapse to ONE identity — else a PM is listed twice, " +
          "their epics split between the rows, and both halves read as half-done");

  var att = pmOwnedWork_({ issues: [
    // Assignee present → the assignee owns it, NOT the Tempo project lead.
    iss({ key: "GTT-100", isEpic: true, due: new Date(2026, 7, 20),
          assignee: "Rita Chen" }),
    // Same person, Jira's OTHER spelling — must land in the same row.
    iss({ key: "GTT-101", isEpic: true, due: new Date(2026, 7, 21),
          assignee: "Chen, Rita" }),
    // No assignee → falls back to the Tempo project lead (Dana Reyes for GTT).
    iss({ key: "GTT-102", isEpic: true, due: new Date(2026, 7, 22) }),
    // A child assigned to someone else entirely still belongs to the epic's PM.
    iss({ key: "GTT-103", due: new Date(2026, 7, 19), epicKey: "GTT-100",
          assignee: "Some Engineer" }),
  ] }, pmIdx, today);
  var byName = {};
  att.rows.forEach(function (r) { byName[r.pm] = r; });

  assert_(byName["Rita Chen"], "the epic's ASSIGNEE owns it, not the project lead");
  assert_(byName["Rita Chen"].epicN === 2,
          "…and both spellings of that assignee land in ONE row, got " +
          (byName["Rita Chen"] || {}).epicN);
  assert_(byName["Rita Chen"].pm.indexOf(",") === -1,
          "the comma-free spelling is preferred for display");
  assert_(byName["Rita Chen"].viaAssignee === 2 && byName["Rita Chen"].viaProject === 0,
          "the row records WHICH rule placed it, so a PM can challenge an attribution");
  assert_(byName["Dana Reyes"] && byName["Dana Reyes"].epicN === 1,
          "an epic with no assignee falls back to the Tempo project lead");

  // THE SENTINEL. Jira Backlog.js writes "⚠️ UNASSIGNED" rather than a blank, so
  // a truthiness check invents a PM of that name — 267 epics landed under it on
  // the live feed before this guard existed.
  assert_(dhAssigneeOf_("⚠️ UNASSIGNED") === "", "the exporter's sentinel is NOT a person");
  assert_(dhAssigneeOf_("Unassigned") === "", "…nor is the plain spelling");
  assert_(dhAssigneeOf_("  ") === "", "…nor is whitespace");
  assert_(dhAssigneeOf_("Rita Chen") === "Rita Chen", "…but a real name survives");
  var unassigned = pmOwnedWork_({ issues: [
    iss({ key: "GTT-400", isEpic: true, due: new Date(2026, 7, 20),
          assignee: "⚠️ UNASSIGNED" }),
  ] }, pmIdx, today);
  assert_(unassigned.rows[0].pm === "Dana Reyes",
          "an epic carrying the sentinel falls back to the project lead, NOT to a " +
          "fabricated PM named UNASSIGNED");
  assert_(unassigned.rows[0].viaProject === 1 && unassigned.rows[0].viaAssignee === 0,
          "…and is recorded as an inference");
  assert_(!unassigned.rows[0].epics[0].assignee,
          "…with the Assignee cell left empty rather than showing the sentinel");
  assert_(byName["Dana Reyes"].viaProject === 1 && byName["Dana Reyes"].viaAssignee === 0,
          "…and is recorded as an inference, not as direct evidence");

  var rita = byName["Rita Chen"];
  var e100 = rita.epics.filter(function (e) { return e.key === "GTT-100"; })[0];
  assert_(e100.children.length === 1 && e100.children[0].key === "GTT-103",
          "a child assigned to an ENGINEER still sits under the epic's PM — " +
          "otherwise the epic ▸ children hierarchy falls apart");

  // ── AREAS OF OPPORTUNITY ────────────────────────────────────────────────
  var opp = pmOwnedWork_({ issues: [
    iss({ key: "GTT-200", isEpic: true, due: null, assignee: "Rita Chen" }),   // WIP, no date
    iss({ key: "GTT-201", isEpic: true, due: new Date(2026, 7, 20),           // nothing rolls up
          assignee: "Rita Chen" }),
    iss({ key: "GTT-202", isEpic: true, due: new Date(2026, 7, 20),           // untouched 60d
          assignee: "Rita Chen", updated: new Date(2026, 5, 12) }),
    iss({ key: "GTT-203", due: new Date(2026, 8, 30), epicKey: "GTT-202" }),  // past the epic
  ] }, pmIdx, today);
  var o = opp.rows[0];
  assert_(o.oppNoDue === 1, "opportunity: epics with no due date");
  assert_(o.oppEpicsAtRisk === 1,
          "opportunity: counted per EPIC — one badly-planned epic is ONE decision, not N tickets");
  assert_(o.oppNoChildren === 2,
          "opportunity: epics nothing rolls up to — their hours cannot reach an engagement");
  assert_(o.oppStale === 1, "opportunity: epics untouched beyond the backlog's staleness bar");
  // A delivered child still counts as linkage — an epic whose work is DONE is
  // not an unlinked epic, and counting it as one would send someone to fix
  // something that is already finished.
  var linked = pmOwnedWork_({ issues: [
    iss({ key: "GTT-300", isEpic: true, due: new Date(2026, 7, 20), assignee: "Rita Chen" }),
    iss({ key: "GTT-301", epicKey: "GTT-300", status: "Done", cat: "Done" }),
  ] }, pmIdx, today);
  assert_(linked.rows[0].oppNoChildren === 0,
          "an epic whose only child is DELIVERED is linked, not empty");

  // ── AT RISK vs BREACHED (user 2026-08-11) ────────────────────────────────
  // The distinction is WHEN, not by how much. Anchor: today = 2026.W33.
  // The user's own example: epic Oct 9 (W41), child Oct 16 (W42) — both two
  // months out. Nothing has failed; the plan simply cannot land as written.
  var future = pmOwnedWork_({ issues: [
    iss({ key: "GTT-500", isEpic: true, due: new Date(2026, 9, 9), assignee: "Rita Chen" }),
    iss({ key: "GTT-501", due: new Date(2026, 9, 16), epicKey: "GTT-500" }),
  ] }, pmIdx, today);
  var eF = future.rows[0].epics[0];
  assert_(eF.children[0].verdict === "atRisk",
          "epic Oct 9 + child Oct 16, today August: AT RISK — a plan to fix, not a miss");
  assert_(eF.children[0].overByWeeks === 1, "…1 week past, and it says so");
  assert_(eF.atRisk === 1 && eF.breached === 0, "the epic tallies it as at risk");
  assert_(future.rows[0].oppEpicsAtRisk === 1 && future.rows[0].oppEpicsBreached === 0,
          "…and the PM's gap line offers the fixable one");

  // Same geometry, epic's week already gone → the commitment is already missed.
  var past = pmOwnedWork_({ issues: [
    iss({ key: "GTT-600", isEpic: true, due: new Date(2026, 6, 10), assignee: "Rita Chen" }),
    iss({ key: "GTT-601", due: new Date(2026, 9, 16), epicKey: "GTT-600" }),
  ] }, pmIdx, today);
  var eP = past.rows[0].epics[0];
  assert_(eP.children[0].verdict === "breached",
          "epic Jul 10 + child Oct 16: BREACHED — the epic's date has already passed");
  assert_(eP.breached === 1 && eP.atRisk === 0, "the epic tallies it as breached");
  assert_(past.rows[0].oppEpicsBreached === 1 && past.rows[0].oppEpicsAtRisk === 0,
          "…and it lands in the breached count, not the fixable one");

  // THE INVARIANT the epic-level verdict rests on: the split is decided by the
  // EPIC's week, so every child of one epic falls on the same side. An epic can
  // never be both at risk and breached — if it could, "cannot land as planned"
  // would have no single meaning.
  var many = pmOwnedWork_({ issues: [
    iss({ key: "GTT-700", isEpic: true, due: new Date(2026, 9, 9), assignee: "Rita Chen" }),
    iss({ key: "GTT-701", due: new Date(2026, 9, 16), epicKey: "GTT-700" }),
    iss({ key: "GTT-702", due: new Date(2026, 10, 20), epicKey: "GTT-700" }),
    iss({ key: "GTT-703", due: new Date(2026, 9, 1), epicKey: "GTT-700" }),
  ] }, pmIdx, today);
  var eM = many.rows[0].epics[0];
  assert_(eM.atRisk === 2 && eM.breached === 0 && eM.within === 1,
          "two children past a future epic are BOTH at risk; the earlier one is within");
  assert_(!(eM.atRisk > 0 && eM.breached > 0),
          "an epic is never both at risk and breached — the invariant the verdict rests on");
  assert_(many.rows[0].oppEpicsAtRisk === 1,
          "…and two offending children still count as ONE epic to fix");

  // An epic with no date cannot put its children at risk — there is no
  // commitment to be past.
  var undatedEpic = pmOwnedWork_({ issues: [
    iss({ key: "GTT-800", isEpic: true, due: null, assignee: "Rita Chen" }),
    iss({ key: "GTT-801", due: new Date(2026, 9, 16), epicKey: "GTT-800" }),
  ] }, pmIdx, today);
  assert_(undatedEpic.rows[0].epics[0].children[0].verdict === "ungraded",
          "an undated epic yields ungraded children, never atRisk");
  assert_(undatedEpic.rows[0].oppEpicsAtRisk === 0,
          "…and contributes nothing to the at-risk count");

  // ── epics[].owners — how the universal filters reach this tab ────────────
  var withOwners = pmOwnedWork_({ issues: [
    iss({ key: "GTT-900", isEpic: true, due: new Date(2026, 9, 9), assignee: "Rita Chen" }),
    iss({ key: "GTT-901", due: new Date(2026, 9, 1), epicKey: "GTT-900", assignee: "Ana Perez" }),
    // A To Do child with no date is ignored by the managers' rule, but it is
    // still evidence of WHO works on this epic — dropping its owner would make
    // the epic vanish from a filtered view for a reason unrelated to the filter.
    iss({ key: "GTT-902", epicKey: "GTT-900", assignee: "Bo Ng",
          due: null, status: "To Do", cat: "To Do" }),
  ] }, pmIdx, today, function (raw) { return raw || null; });
  var eO = withOwners.rows[0].epics[0];
  assert_(eO.owners.indexOf("Ana Perez") !== -1, "an epic records who works on it");
  assert_(eO.owners.indexOf("Bo Ng") !== -1,
          "…including the owner of a child the rules ignore for grading");
  assert_(eO.owners.length === 2, "…deduped, and only real resolutions");
  var noOwners = pmOwnedWork_({ issues: [
    iss({ key: "GTT-910", isEpic: true, due: new Date(2026, 9, 9), assignee: "Rita Chen" }),
  ] }, pmIdx, today, function () { return null; });
  assert_(noOwners.rows[0].epics[0].owners.length === 0,
          "an epic nobody on the roster works on is UNATTRIBUTABLE — the client must " +
          "say so rather than silently hide it");

  // Closed work is out entirely — the same typeHygOpen_ predicate every other
  // hygiene surface uses, so the counts reconcile with the 🚩 audit.
  var closed = pmOwnedWork_({ issues: [
    iss({ key: "GTT-9", isEpic: true, due: null, status: "Done" }),
  ] }, pmIdx, today);
  assert_(closed.rows.length === 0,
          "a resolved epic's missing date is not actionable and is not counted");

  Logger.log("✅ _test_pmAttribution_ passed");
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
  // Ken's open epic is To Do WITH a due date → rule 3: tracked, and a hit.
  assert_(kOpen && kOpen.n === 1 && kOpen.due === 1 && kOpen.dueN === 1 && kOpen.est === 0,
          "open epic counted for Ken (closed-no-resolution excluded)");
  assert_(ph.open.length === 2, "exactly two open persons — unattributed excluded");

  var mRes = ph.resolved.filter(function (b) { return b.person === "Maria Alvarez"; });
  assert_(mRes.length === 1 && mRes[0].iso === "2026.W31",
          "resolved bucketed by ISO week (both fell in W31)");
  assert_(mRes[0].n === 2 && mRes[0].due === 1 && mRes[0].est === 1 && mRes[0].logged === 1,
          "resolved counts: 2 issues, one filled");

  // PREDICATE PARITY. Until 2026-08-17 this compared the roster against
  // typeHygieneBuckets_, a second implementation of the same rules. That
  // implementation was deleted with the 🧬 matrix, so the parity is now against
  // the SHARED PREDICATES themselves — which is what it was always really for:
  // typeHygOpen_ / dhHasDue_ / dueExpected_ / timeExpected_ are read by the
  // roster, backlog health, the 🚩 epic audit and the PM tab, so a drift here
  // is four surfaces disagreeing about one ticket.
  function sum_(rows, k) { return rows.reduce(function (s, r) { return s + (r[k] || 0); }, 0); }
  var openAttributed = jira.issues.filter(function (it) {
    return typeHygOpen_(it) && !!resolve(it.assignee);
  });
  function pred_(fn) {
    return openAttributed.filter(function (it) { return fn(it, true); }).length;
  }
  // The roster is the attributed subset: 2 of the 4 open records, with the
  // unattributed one and the ⚠️ UNASSIGNED sentinel correctly absent.
  assert_(sum_(ph.open, "n") === 2, "roster open population = 2 (attributed only)");
  assert_(openAttributed.length === 2, "…and the shared open predicate selects the same 2");
  // Only Maria's open Task carries estSec>0; nothing open carries spentSec>0; the
  // one open due date belongs to Ken's UNSTARTED epic, which rule 3 keeps.
  assert_(sum_(ph.open, "est") === 1, "est predicate parity");
  assert_(sum_(ph.open, "logged") === 0, "logged predicate parity");
  assert_(sum_(ph.open, "due") === openAttributed.filter(function (it) { return dhHasDue_(it); }).length,
          "due parity: the roster counts exactly the open records dhHasDue_ accepts");

  // ── LOGGED DENOMINATOR = STARTED WORK ONLY (user report 2026-08-06) ────────
  // Maria's open Task is In Progress → in the ratio. Ken's open Epic is To Do →
  // outside it, so Ken's Logged cell reads ungraded rather than 0%. That is the
  // whole fix at person grain: nobody is graded on a ticket they have not begun.
  assert_(mOpen.loggedN === 1, "Maria's STARTED open task is in the logged denominator");
  assert_(kOpen.loggedN === 0,
          "Ken's unstarted open epic is NOT — an unbegun ticket cannot be a logging failure");
  assert_(mRes[0].loggedN === mRes[0].n,
          "resolved: every record is expected to carry its cost — loggedN === n");
  // DENOMINATOR PARITY, tested like the numerators above: the roster must
  // measure over exactly the population the shared predicate defines, not over
  // a count that happens to match today.
  assert_(sum_(ph.open, "loggedN") === pred_(timeExpected_) && pred_(timeExpected_) === 1,
          "the roster measures the logged ratio over exactly timeExpected_'s population");

  // ── DUE DENOMINATOR = STARTED WORK ONLY (managers' feedback 2026-08-10) ──────
  // Same three checks as the logged rule above, because this is the same mistake
  // one column over: a person was being graded on dates for work they had not
  // begun, which is a queue nobody can act on.
  assert_(mOpen.dueN === 1 && mOpen.due === 0,
          "Maria's STARTED open task with no due date IS a due-date gap");
  assert_(kOpen.dueN === 1 && kOpen.due === 1,
          "rule 3: Ken's unstarted epic CARRIES a date, so it is tracked and it is a hit");
  assert_(mRes[0].dueN === mRes[0].n,
          "resolved: On-Time is exactly the date question — dueN === n");
  assert_(sum_(ph.open, "dueN") === pred_(dueExpected_) && pred_(dueExpected_) === 2,
          "the roster measures the due-date ratio over exactly dueExpected_'s 'started or dated' population");
  // THE TWO RULES ARE DIFFERENT SHAPES, and this is the assertion that says so.
  // Logged excludes every unstarted ticket; Due keeps the dated ones. Ken's epic
  // is the record that separates them, so a refactor that "unifies" the two
  // predicates fails here rather than silently reverting rule 3.
  assert_(kOpen.loggedN === 0 && kOpen.dueN === 1,
          "an unstarted DATED ticket is outside the logged ratio but inside the due one — " +
          "timeExpected_ and dueExpected_ must not be collapsed into one predicate");

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

/**
 * Workforce change (user request 2026-08-07).
 *
 * The failures that matter here are all ways of UNDER-reporting a loss, which
 * is the direction that flatters us: a boomerang counted as attrition, a
 * departure whose capacity is unknown quietly counted as zero hours, a leaver's
 * partial final weeks read as their capacity, and an out-of-scope departure
 * (Sales, non-tracking family) inflating a delivery number.
 */
function _test_workforceChange_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_workforceChange_: " + m); }
  var weeks = ["2026.W26", "2026.W27", "2026.W28", "2026.W29", "2026.W30", "2026.W31"];
  function d(s) { return new Date(s + "T00:00:00Z"); }
  // 2026.W29 = Mon 2026-07-13 … Sun 2026-07-19 (ISO).
  var roster = {
    attrib: [
      // Left in W29 after four full 40h weeks — a clean 40h/wk loss.
      { name: "Gone Person", inScope: true, jobFamily: "Service Delivery",
        hireDate: null, termDate: d("2026-07-15") },
      // Joined in W29.
      { name: "New Joiner", inScope: true, jobFamily: "Service Delivery",
        hireDate: d("2026-07-14"), termDate: null },
      // Rehire: both rows exist, so NOT a departure however plain the term date.
      { name: "Boomer Ang", inScope: true, jobFamily: "Service Delivery",
        hireDate: null, termDate: d("2026-07-15") },
      // Out of the delivery population — a Sales departure is not delivery capacity.
      { name: "Sales Sam", inScope: false, jobFamily: "Service Delivery",
        hireDate: null, termDate: d("2026-07-15") },
      // In scope by class/dept but a non-tracking family — same carve-out the
      // live population applies, or this number describes a different team.
      { name: "Ops Olive", inScope: true, jobFamily: "Operations",
        hireDate: null, termDate: d("2026-07-15") },
      // Left in W29 with no capacity row anywhere — a KNOWN loss of an UNKNOWN size.
      { name: "Ghost Grey", inScope: true, jobFamily: "Service Delivery",
        hireDate: null, termDate: d("2026-07-15") },
    ],
    activeAll: { "new joiner": 1, "boomer ang": 1 },
    inactiveAll: { "gone person": 1, "boomer ang": 1, "sales sam": 1,
                   "ops olive": 1, "ghost grey": 1 },
  };
  var cap = {
    // Note W28: the last week before leaving is a 6h stub (handover). The median
    // of the non-zero weeks must ignore it, or every departure under-reports.
    "gone person": { "2026.W25": 40, "2026.W26": 40, "2026.W27": 40, "2026.W28": 6 },
    "new joiner":  { "2026.W29": 8, "2026.W30": 40, "2026.W31": 40 },
    "boomer ang":  { "2026.W27": 40, "2026.W28": 40 },
    "sales sam":   { "2026.W27": 40, "2026.W28": 40 },
    "ops olive":   { "2026.W27": 40, "2026.W28": 40 },
  };
  var rows = workforceChangeBuckets_(roster, cap, weeks);
  assert_(rows.length === 1 && rows[0].iso === "2026.W29",
          "only weeks with movement produce a row, and the movement lands in the week of the date");
  var w = rows[0];
  assert_(w.leavers === 2, "2 in-scope departures (Gone Person + Ghost Grey), got " + w.leavers);
  assert_(w.joiners === 1, "1 joiner, got " + w.joiners);
  // 40, not 6 and not the mean of {40,40,6}=28.7.
  assert_(w.hoursLost === 40,
          "the leaver's capacity is the MEDIAN of their non-zero weeks — a 6h handover week " +
          "must not be read as what they were carrying; got " + w.hoursLost);
  assert_(w.hoursGained === 40,
          "…and the joiner's is the median of their scheduled weeks, not their 8h first week; got " +
          w.hoursGained);
  // The one that would otherwise vanish: counted as a person, never as 0 hours.
  assert_(w.leaversNoCap === 1,
          "a departure with no capacity data is counted and flagged, never folded in as 0 hours");
  assert_(w.joinersNoCap === 0, "…and the joiner's capacity WAS known");

  // ── The four exclusions, each on its own ──
  function loneRows(name) {
    return workforceChangeBuckets_({
      attrib: roster.attrib.filter(function (p) { return p.name === name; }),
      activeAll: roster.activeAll, inactiveAll: roster.inactiveAll,
    }, cap, weeks);
  }
  assert_(loneRows("Boomer Ang").length === 0,
          "a rehire is never a departure — an active row anywhere wins");
  assert_(loneRows("Sales Sam").length === 0, "an out-of-population departure is not counted");
  assert_(loneRows("Ops Olive").length === 0,
          "a non-tracking job family is carved out here exactly as it is from the population");

  // A termination date with no inactive row = a future exit the roster has not
  // applied. Counting it would report a loss that has not happened.
  var planned = workforceChangeBuckets_({
    attrib: [{ name: "Notice Given", inScope: true, jobFamily: "Service Delivery",
               hireDate: null, termDate: d("2026-07-15") }],
    activeAll: { "notice given": 1 }, inactiveAll: {},
  }, { "notice given": { "2026.W27": 40, "2026.W28": 40 } }, weeks);
  assert_(planned.length === 0,
          "a termination date on someone the roster still lists as active is not attrition yet");

  // Movement outside the window is not this period's news.
  var outside = workforceChangeBuckets_({
    attrib: [{ name: "Gone Person", inScope: true, jobFamily: "Service Delivery",
               hireDate: null, termDate: d("2025-01-15") }],
    activeAll: {}, inactiveAll: { "gone person": 1 },
  }, cap, weeks);
  assert_(outside.length === 0, "a departure before the window does not enter it");

  // Joined AND left inside the window: both are true, and the net is zero.
  var churn = workforceChangeBuckets_({
    attrib: [{ name: "Brief Visit", inScope: true, jobFamily: "Service Delivery",
               hireDate: d("2026-06-23"), termDate: d("2026-07-15") }],
    activeAll: {}, inactiveAll: { "brief visit": 1 },
  }, { "brief visit": { "2026.W27": 40, "2026.W28": 40 } }, weeks);
  assert_(churn.length === 2, "a joiner who also left is counted in BOTH weeks");
  assert_(churn.reduce(function (a, r) { return a + r.joiners + r.leavers; }, 0) === 2,
          "…once on each side, so the net correctly reads zero people");

  // Empty/malformed inputs are a quiet no-op, never a crash on a dashboard load.
  assert_(workforceChangeBuckets_({}, {}, weeks).length === 0, "a rosterless call is safe");
  assert_(workforceChangeBuckets_(roster, null, weeks).length === 1,
          "no capacity sheet at all still counts the PEOPLE — the movement is known even " +
          "when its size is not");
  assert_(workforceChangeBuckets_(roster, null, weeks)[0].hoursLost === 0 &&
          workforceChangeBuckets_(roster, null, weeks)[0].leaversNoCap === 2,
          "…and every one of them lands in the unknown-capacity count, not in the hours");

  // typicalWeeklyCap_ in isolation — the rule the two branches above share.
  assert_(typicalWeeklyCap_({ a: 40, b: 0, c: 40 }, ["a", "b", "c"]) === 40,
          "zero weeks are dropped, not averaged in");
  assert_(typicalWeeklyCap_({ a: 0, b: 0 }, ["a", "b"]) === null,
          "no scheduled hours at all is UNKNOWN, never 0");
  assert_(typicalWeeklyCap_(null, ["a"]) === null, "a person with no capacity row is unknown");
  Logger.log("✅ _test_workforceChange_ passed");
}

/**
 * SRSO binding — component (what the runbook tells PMs to do) vs fix version
 * (what the exporter's Billing Type reads).
 *
 * The failure that matters: reporting a mismatch that is really an artefact of
 * OUR two regexes, or reporting "no mismatch" on an export whose Components
 * column isn't there at all. Either one sends someone to argue with a PM about
 * a process they followed correctly.
 */
function _test_srsoBinding_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_srsoBinding_: " + m); }
  // The token rule must stay identical to the exporter's, or every mismatch is
  // suspect. Both forms the exporter documents must match.
  assert_(DH_SRSO_TOKEN_.test("SRSO-016559"), "bare sales-order form matches");
  assert_(DH_SRSO_TOKEN_.test("CLVT02 SRSO-016559"), "client-prefixed form matches");
  assert_(DH_SRSO_TOKEN_.test("srso-1"), "case-insensitive, like the exporter's rule");
  assert_(!DH_SRSO_TOKEN_.test("Platform"), "an ordinary component name does not");
  assert_(!DH_SRSO_TOKEN_.test("MYSRSOTHING"), "…nor a word that merely contains the letters");

  // ── THE TRISTATE, AT THE READER ──────────────────────────────────────────
  // Tested here rather than only through hygieneBuckets_ because this is where
  // it can actually be got wrong: readJiraRaw_ opens a spreadsheet and cannot
  // run from node, so a bug that collapses an absent column into `false` was
  // invisible to a consumer test built on hand-made records. (Confirmed by
  // deliberately introducing that collapse — the consumer suite stayed green,
  // and this block goes red.)
  assert_(dhSrsoComponent_(false, "SRSO-016559") === null,
          "NO Components column = nobody looked, whatever happens to be in the cell");
  assert_(dhSrsoComponent_(false, "") === null, "…null, never false");
  assert_(dhSrsoComponent_(true, "SRSO-016559") === true, "column present + token = bound");
  assert_(dhSrsoComponent_(true, "Platform, Backend") === false,
          "column present + no token = looked, and it is not bound");
  assert_(dhSrsoComponent_(true, "") === false, "an empty cell in a present column IS a measurement");
  assert_(dhSrsoComponent_(true, null) === false, "…and so is a null cell — no crash, no null verdict");
  assert_(dhSrsoComponent_(true, "Platform, CLVT02 SRSO-016559") === true,
          "one bound component among several still binds the issue");

  function iss(o) {
    return { resolved: new Date("2026-07-15T00:00:00Z"), assignee: "Ana Perez",
             isEpic: false, isClientCommitment: true, billing: o.billing,
             srsoComponent: o.comp, due: null, region: "AMER", team: "T" };
  }
  var rows = hygieneBuckets_({ issues: [
    // Bound by fix version — the exporter saw it. No mismatch.
    iss({ billing: "Billable (SRSO)", comp: true }),
    iss({ billing: "Billable (SRSO)", comp: false }),
    // THE FINDING: bound by component exactly as the runbook says, read as
    // untagged because no SRSO fix version exists.
    iss({ billing: "Untagged", comp: true }),
    iss({ billing: "Internal", comp: true }),
    // Bound by neither — not a mismatch, just unbound work.
    iss({ billing: "Untagged", comp: false }),
  ] }, function () { return "Ana Perez"; }, "all");
  assert_(rows.length === 1, "one resolution week");
  var w = rows[0];
  assert_(w.srsoMeasurable === 5, "every row with a readable Components column is measurable");
  assert_(w.srsoSeen === 2, "two are visible to the Billing Type reader");
  assert_(w.srsoAny === 4, "four are bound by ONE route or the other");
  assert_(w.srsoCompOnly === 2,
          "two are bound the runbook way and invisible to the reader — got " + w.srsoCompOnly);
  // "Internal" counts as a miss as surely as "Untagged": both mean the Billing
  // Type reader did not see a sales order, and only the reason differs.
  assert_(w.srsoAny - w.srsoSeen === w.srsoCompOnly,
          "the arithmetic closes — every bound-but-unseen row is a component-only row");

  // ── ABSENT COLUMN ≠ NOTHING FOUND. An older export must not report a clean
  // bill of health for a field nobody read.
  var older = hygieneBuckets_({ issues: [
    iss({ billing: "Untagged", comp: null }),
    iss({ billing: "Billable (SRSO)", comp: null }),
  ] }, function () { return "Ana Perez"; }, "all");
  assert_(older.length === 1, "the week still exists — the other gaps are still counted");
  assert_(older[0].srsoMeasurable === 0,
          "…but NOTHING is measurable for SRSO binding, so the row reads 'not measured'");
  assert_(older[0].srsoCompOnly === 0 && older[0].srsoAny === 0,
          "…and no mismatch is claimed on evidence that does not exist");

  // Scope independence: the binding question is about ALL delivered work, not
  // the epic/milestone slice On-Time measures. Same issues under the narrowest
  // scope must produce the SAME srso counts.
  var narrow = hygieneBuckets_({ issues: [
    iss({ billing: "Untagged", comp: true }),
  ] }, function () { return "Ana Perez"; }, "epic");
  assert_(narrow[0].srsoCompOnly === 1,
          "a non-epic issue still counts toward SRSO binding under the epic scope — the " +
          "component is set once for the whole project, not per issue type");
  assert_(narrow[0].res === 0,
          "…while the On-Time population correctly excludes it, proving the two are independent");
  Logger.log("✅ _test_srsoBinding_ passed");
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
  // Asserted through resReady since the published roster-join count (resAttr)
  // was removed 2026-08-17 — the DENOMINATOR behaviour it guarded is the part
  // that mattered, and it still holds.
  assert_(h.res > h.resReady, "unattributed issues stay in the hygiene denominator");
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
  assert_(hyg && hyg.res === 2 && hyg.resDue === 2 && hyg.resReady === 1,
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
  // The contractor join itself is proven by the onTimeBuckets_ assertion above;
  // this one only pins that hygiene still reads the whole raw feed.
  assert_(hyg6.res === 3, "hygiene counts all three resolved issues from the raw feed");
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

  // ── Queue model wiring (Task 7, schema v26) ──────────────────────────────
  // 1. Happy path: arrivals populated with 7 weeks, supplied OUT OF ORDER and
  // SPANNING THE SINGLE/DOUBLE-DIGIT BOUNDARY (W6..W12) — not just a shuffle
  // within same-width labels. weekKeyFromDate_ does not zero-pad, so a naive
  // string sort puts W10/W11/W12 before W6..W9 ('1' < '6'); the original
  // version of this fixture used W27..W31 (all two-digit), which a broken
  // string comparator sorts identically to a correct numeric one — the exact
  // blind spot that let the bug ship (Task 7 review, 2026-08-06). Also carries
  // two new open issues so the queue halves show real (non-zero) numbers,
  // proving they are wired to `issues`, not just present-but-empty objects.
  //
  // Chronological resolved series (for the median derivation below):
  //   W6=310  W7=295  W8=300  W9=305  W10=290  W11=320  W12=315
  // Supplied order: W10, W7, W12, W6, W9, W11, W8.
  var arrivalsFixture = { available: true, weeks: [
    { iso: "2026.W10", created: 305, resolved: 290, createdUnassigned: 9 },
    { iso: "2026.W7",  created: 310, resolved: 295, createdUnassigned: 8 },
    { iso: "2026.W12", created: 330, resolved: 315, createdUnassigned: 13 },
    { iso: "2026.W6",  created: 325, resolved: 310, createdUnassigned: 11 },
    { iso: "2026.W9",  created: 320, resolved: 305, createdUnassigned: 10 },
    { iso: "2026.W11", created: 335, resolved: 320, createdUnassigned: 14 },
    { iso: "2026.W8",  created: 315, resolved: 300, createdUnassigned: 9 },
  ] };
  var queueIssues = inputs.jira.issues.concat([
    // Open, assigned to a roster person, In Progress → assigned.wipN.
    { key: "ACME-9", status: "In Progress", statusCategory: "In Progress",
      assignee: "Alvarez, Maria", estSec: 0, spentSec: 0, resolved: null },
    // Open, unassigned, To Do, 2h remaining → unassigned.todoN/todoHrs, and
    // ONLY the unassigned half, proving the two halves are not conflated.
    { key: "ACME-10", status: "Open", statusCategory: "To Do",
      assignee: "Unassigned", estSec: 7200, spentSec: 0, resolved: null },
  ]);
  var qInputs = Object.assign({}, inputs, {
    arrivals: arrivalsFixture,
    jira: Object.assign({}, inputs.jira, { issues: queueIssues }),
  });
  var mQ = assembleModel_(qInputs, win);
  assert_(mQ.queue && mQ.queue.assigned && mQ.queue.unassigned,
          "both queue halves present on the payload");
  assert_(mQ.queue.assigned.wipN === 1 && mQ.queue.assigned.items === 1,
          "assigned half counts the new open+assigned issue");
  assert_(mQ.queue.unassigned.todoN === 1 && Math.abs(mQ.queue.unassigned.todoHrs - 2) < 1e-9,
          "unassigned half counted independently off `issues` — the assigned issue never lands here");
  var isoOrder = mQ.arrivalWeeks.map(function (w) { return w.iso; }).join("|");
  assert_(isoOrder === "2026.W6|2026.W7|2026.W8|2026.W9|2026.W10|2026.W11|2026.W12",
          "arrivalWeeks sorted oldest-first NUMERICALLY across the digit-width boundary " +
          "even though the fixture supplied them out of order — got " + isoOrder);
  assert_(mQ.inventoryHistory.length > 0, "inventory history reconstructed from a measurable anchor");
  assert_(mQ.inventoryHistory.filter(function (p) { return p.measured; }).length === 1,
          "exactly one measured point in the walkback");
  assert_(mQ.inventoryHistory[mQ.inventoryHistory.length - 1].measured === true &&
          mQ.inventoryHistory[mQ.inventoryHistory.length - 1].iso === "2026.W12",
          "the measured point is the newest — chronologically W12, not whatever a string sort " +
          "happened to put last");
  // 7 weeks all sit inside the 8-week trailing window (CLEAR_RATE_WEEKS), so
  // the WHOLE series is used; medianOf_ sorts numerically internally, so the
  // median value itself doesn't move with a scrambled order here — the
  // digit-boundary bug is caught by isoOrder/the walkback anchor above, not by
  // this number. Median of [290,295,300,305,310,315,320] (7 values) = 305.
  assert_(mQ.meta.clearRateMedian === 305,
          "median of the 7-week resolved series — got " + mQ.meta.clearRateMedian);
  assert_(mQ.meta.arrivalsAvailable === true, "arrivals tab reported available");
  assert_(mQ.meta.clearRateWeeks === CONFIG_DH.CLEAR_RATE_WEEKS &&
          mQ.meta.walkbackMaxWeeks === CONFIG_DH.WALKBACK_MAX_WEEKS,
          "the window/cap constants ship so the client never re-types them");

  // 2. flowOpen is THREADED into queueSnapshot_, not recomputed. Both paths
  // (threaded vs. queueSnapshot_'s own `flowOpen || flowOpenBuckets_(...)`
  // fallback) produce the SAME NUMBER on identical inputs, so no value-only
  // assertion can tell them apart — a dropped third argument is invisible to
  // every assertion above. A call-count spy is what actually discriminates:
  // correct wiring calls flowOpenBuckets_ exactly once (to build `flowOpen`
  // itself); a dropped third argument makes queueSnapshot_'s fallback call it
  // a second time on the same issues/resolvePerson.
  var realFlowOpenBuckets_ = flowOpenBuckets_;
  var flowOpenCallCount = 0;
  flowOpenBuckets_ = function (issues, resolvePersonArg) {
    flowOpenCallCount++;
    return realFlowOpenBuckets_(issues, resolvePersonArg);
  };
  try {
    assembleModel_(qInputs, win);
  } finally {
    flowOpenBuckets_ = realFlowOpenBuckets_;
  }
  assert_(flowOpenCallCount === 1,
          "flowOpenBuckets_ computed exactly once per assembleModel_ run and threaded into " +
          "queueSnapshot_'s third argument — got " + flowOpenCallCount + " call(s)");

  // 3. Arrivals tab absent — empty history, not a fabricated one, and no median.
  var mNoArrivals = assembleModel_(
    Object.assign({}, inputs, { arrivals: { weeks: [], available: false } }), win);
  assert_(mNoArrivals.meta.arrivalsAvailable === false, "no arrivals tab → reported absent");
  assert_(mNoArrivals.meta.clearRateMedian === null, "no arrivals data → no clear-rate median");
  assert_(Array.isArray(mNoArrivals.inventoryHistory) && mNoArrivals.inventoryHistory.length === 0,
          "no arrival weeks → EMPTY inventory history, never a fabricated series");

  // 4. THE DANGEROUS ONE — Jira unavailable. "0 unowned" would claim the whole
  // queue is owned when nobody looked; it must be null, and explicitly not 0.
  var mNoJiraQueue = assembleModel_(Object.assign({}, inputs, {
    jira: { available: false, issues: [], epics: [], openIssues: [], keyRegion: {} },
  }), win);
  var noJiraU = mNoJiraQueue.queue.unassigned;
  assert_(noJiraU.items === null && noJiraU.items !== 0,
          "no Jira feed → unassigned.items is null, never a false '0 unowned' (spec §5)");
  assert_(noJiraU.wipN === null && noJiraU.wipN !== 0, "…and wipN null, not 0");
  assert_(noJiraU.todoN === null && noJiraU.todoN !== 0, "…and todoN null, not 0");
  assert_(noJiraU.todoHrs === null && noJiraU.todoHrs !== 0, "…and todoHrs null, not 0");
  assert_(noJiraU.uncategorized === null,
          "unassigned.uncategorized is also unknowable with no feed — matches queueSnapshot_'s " +
          "real 5-key unassigned shape (items/wipN/todoN/todoHrs/uncategorized)");
  var noJiraA = mNoJiraQueue.queue.assigned;
  assert_(noJiraA.items === 0 && noJiraA.unattributed === 0 && noJiraA.uncategorized === 0,
          "assigned half stays 0 (known-empty), not null — only the UNOWNED half is unknowable");

  // 5. Schema version — read off the model, not the constant, so a payload
  // change that forgets the bump (or a bump that forgets the payload) is caught
  // even if DH_SCHEMA_VER_ itself silently drifted.
  // v27: meta.flowSnapshots rows gained unassignedN/unassignedHrs. Bumping the
  // literal here is DELIBERATE work, not maintenance friction — this assertion
  // firing is the signal that a payload shape changed, and it is the moment to
  // ask whether stale cached entries can still be read safely. If you are here
  // because the suite went red, the answer is usually "bump DH_SCHEMA_VER_ too".
  assert_(m.schemaVer === 43,
          "payload schema is v43 (PM Owns bar excludes undated To Do epics) — " +
          "literal check, independent of DH_SCHEMA_VER_");
  // The REMOVAL is asserted, not just the version. A deletion that silently
  // half-happened — the builder gone but the key still written, or the reverse —
  // is exactly what a version number alone cannot catch.
  assert_(m.typeHygiene === undefined,
          "typeHygiene left the payload with the 🧬 matrix (user decision 2026-08-17)");
  assert_(m.hygieneBuckets.every(function (h) { return h.resAttr === undefined; }),
          "…and resAttr left the hygiene buckets with the Roster join metric");
  assert_(m.personHygiene && Array.isArray(m.personHygiene.open),
          "…while the PER-PERSON read that replaces both is still shipped");
  // The workforce block must be PRESENT and SHAPED, not merely truthy: a cached
  // v29 model read as v30 would give every person pool `undefined`, collapse the
  // population into one cell, and reproduce the exact blended figure this
  // release retires — a wrong number wearing a right number's clothes.
  assert_(m.workforce && m.workforce.scope && m.workforce.cells,
          "the workforce block ships with the payload");
  assert_(typeof m.workforce.scope.unclassified === "number",
          "…and states its unclassified count even at zero");
  assert_(m.people.every(function (p) { return typeof p.pool === "string"; }),
          "every person carries a pool — never undefined, which would silently re-blend them");

  assert_(m.pmOwned && Array.isArray(m.pmOwned.rows),
          "the model ships pmOwned.rows");
  assert_(typeof m.pmOwned.supersededPms === "number",
          "…and the count of superseded PM handovers, so an overwrite is never silent");
  assert_(m.schemaVer === 43,
          "schema is 43 — a v42 entry carries the OLD, wider epicN, so every PM's Owns bar " +
          "would read lower than the To Do carve says it should");
  assert_(!m.pmOwned.rows.length || typeof m.pmOwned.rows[0].oppEpicsAtRisk === "number",
          "…and any row carries the opportunity counts the gap line is built from");
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

/**
 * WORKFORCE HEALTH — classification (spec v1.1 §4).
 * The parser cases are the ones that silently DROP people if a strict regex
 * ships, and the sub-track cases are the ones the v1.0 discipline-keyed model
 * got wrong.
 */
function _test_classification_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_classification_: " + m); }

  // ── Parser tolerance: every one of these is a real shape in this company's data
  var t = dhParseTitle_("09.I4.3 - Senior Engineer I, Service Delivery");
  assert_(t.ok && t.family === "09" && t.track === "I" && t.level === 4 && t.variant === "3",
          "canonical four-token code decomposes");
  assert_(t.subTrack === "09.3", "subTrack is family.variant");
  assert_(t.stem === "Senior Engineer I" && t.stemBase === "Senior Engineer",
          "stem keeps its roman numeral, stemBase strips it");
  assert_(t.discipline === "Service Delivery", "discipline is the text after the LAST comma");

  // No dash separator — CompDash carries "03.I2.1 Data Analyst" in its own fixtures.
  t = dhParseTitle_("09.I2.1 Associate Consultant");
  assert_(t.ok && t.subTrack === "09.1", "missing dash separator still parses");
  // Lowercase track letter — CompDash has a passing test pinning "07.m4.1" → M4.
  t = dhParseTitle_("07.m4.1 - Manager, Customer Support");
  assert_(t.ok && t.track === "M" && t.level === 4, "lowercase track letter parses and normalises");
  // Trailing parenthetical — one row in the live 215 carries "(556)".
  t = dhParseTitle_("09.I3.1 - Consultant, Technical Consulting (556)");
  assert_(t.ok && t.discipline === "Technical Consulting", "trailing (nnn) stripped before the split");
  // Stem containing its own comma splits at the LAST comma, not the first.
  t = dhParseTitle_("18.I5.1 - Director, Solutions, Solution Architecture");
  assert_(t.discipline === "Solution Architecture" && t.stem === "Director, Solutions",
          "lastIndexOf keeps a comma-bearing stem intact");
  // No comma at all: the whole tail is both stem and label, never a crash.
  t = dhParseTitle_("09.I3.1 - Consultant");
  assert_(t.ok && t.stem === "Consultant" && t.discipline === "Consultant",
          "no comma → tail serves as both stem and label");
  assert_(dhParseTitle_("Senior Engineer").ok === false, "free-text title does not parse");
  assert_(dhParseTitle_("").ok === false && dhParseTitle_(null).ok === false, "blank/null do not parse");
  assert_(dhParseTitle_("09.I4").ok === false, "three-token code (no variant) does not parse");

  // ── THE v1.0 CORRECTION: 09|Service Delivery is TWO pools, not one ──────────
  // Keying on the discipline string sent all 36 of these to PS-ENGINEER.
  var eng = dhClassify_("09.I4.3 - Senior Engineer I, Service Delivery");
  var con = dhClassify_("09.I5.1 - Senior Consultant, Service Delivery");
  assert_(eng.pool === "PS-ENGINEER", "09.3 is engineering");
  assert_(con.pool === "PS-CONSULT", "09.1 is consulting — SAME discipline string, different pool");
  assert_(eng.disciplineLabel !== con.disciplineLabel,
          "and they carry different display labels, so the UI cannot merge them back");

  // ── Sub-tracks ──
  assert_(dhClassify_("07.I3.1 - Support Engineer, Customer Support").pool === "MS-SUPPORT",
          "07.1 is support — the pool that must never blend with consulting");
  assert_(dhClassify_("07.I3.1 - Support Engineer, Customer Support").role === "SUSTAINER",
          "support SUSTAINS; it does not consume project backlog");
  assert_(dhClassify_("07.I3.2 - Consultant, Delivery").pool === "PS-CONSULT",
          "07.2 is delivery consulting — same family as support, different pool");
  assert_(dhClassify_("08.I3.2 - Trainer, Learning Solutions").pool === "TRAINING", "08.2 is training");
  assert_(dhClassify_("18.I5.1 - Architect, Solution Architecture").pool === "ARCH", "18.1 is architecture");
  assert_(dhClassify_("18.I5.1 - Architect, Solution Architecture").role === "CREATOR",
          "architects CREATE backlog rather than consume it");

  // ── Level bands ──
  assert_(dhClassify_("09.I1.1 - Associate Consultant, Professional Services").band === "JUNIOR", "I1 → JUNIOR");
  assert_(dhClassify_("09.I2.1 - Associate Consultant, Professional Services").band === "JUNIOR", "I2 → JUNIOR");
  assert_(dhClassify_("09.I3.1 - Consultant, Professional Services").band === "CORE", "I3 → CORE");
  assert_(dhClassify_("09.I4.3 - Engineer, Service Delivery").band === "CORE", "I4 → CORE");
  assert_(dhClassify_("09.I5.1 - Senior Consultant, Professional Services").band === "SENIOR", "I5 → SENIOR");
  assert_(dhClassify_("09.I10.1 - Principal Consultant, Professional Services").band === "SENIOR",
          "I10 → SENIOR, not JUNIOR — the full number is parsed");

  // ── MGMT_GOVERNS: the override that moves every published capacity rate ─────
  var mgr = dhClassify_("09.M5.3 - Manager, Service Delivery");
  assert_(mgr.role === "GOVERNOR" && mgr.pool === "NONE",
          "M-track in a delivery family governs; it leaves the pool");
  assert_(mgr.band === "MGMT", "…and lands in the MGMT band, never a level band");
  assert_(mgr.subTrack === "09.3", "…while keeping its sub-track for the audit trail");
  assert_(dhClassify_("07.M4.1 - Manager, Customer Support").pool === "NONE", "same for family 07");
  assert_(dhClassify_("18.M5.1 - Director, Solution Architecture").pool === "NONE", "same for family 18");
  // A manager OUTSIDE the governing families keeps their mapped pool.
  assert_(dhClassify_("15.M5.1 - Manager, Project Management").pool === "PMO",
          "PMO managers stay in PMO — family 15 is not in MGMT_GOVERNS");

  // ── Enablers ──
  assert_(dhClassify_("13.I4.1 - Analyst, Finance").role === "ENABLER", "family 13 is an enabler whatever the discipline");
  assert_(dhClassify_("16.I3.1 - Partner, People").pool === "NONE", "enablers hold no pool");
  assert_(dhClassify_("15.I5.1 - Officer, Chief Executive Officer").role === "ENABLER",
          "an enabler TITLE overrides its family");

  // ── Discipline fallback for families where variant is not a boundary ────────
  assert_(dhClassify_("15.I4.1 - Manager, Project Management").pool === "PMO", "15|Project Management → PMO");
  assert_(dhClassify_("15.I4.9 - Manager, Project Management").pool === "PMO",
          "…and the variant digit is irrelevant there, by design");
  assert_(dhClassify_("15.I5.1 - Director, Delivery").role === "GOVERNOR",
          "15|Delivery GOVERNS — the same word that means CONSUMER in family 07");
  assert_(dhClassify_("04.I4.1 - Manager, Account Management").role === "CREATOR", "04 disciplines create demand");

  // ── CREW: classified by employment type, not by job code ──────────────────
  // The first live render reported 30 UNCLASSIFIED people. They were crew, who
  // hold no job-architecture code — the parser was right and the registry had
  // no home for them. A governance alarm for a known, ordinary population.
  var crew = dhClassify_("Senior Developer", true);
  assert_(crew.pool === "CREW" && crew.role === "CONSUMER",
          "a contractor with a free-text title is CREW, not UNCLASSIFIED");
  assert_(!crew.classificationError, "…and raises no classification error");
  assert_(crew.disciplineLabel === "Crew (on demand)", "…and says what they are on the grid");
  assert_(dhPoolCfg_("CREW").consumes === false && dhPoolCfg_("CREW").coverTarget === 0,
          "CREW is demand-driven: capacity is scaled TO the work, so cover would mislead");
  assert_(dhClassify_("Senior Developer", true).band === "UNKNOWN",
          "no level token in a crew title → UNKNOWN band, not a guessed one");
  assert_(dhClassify_("I4 Contract Engineer", true).band === "CORE",
          "…but a crew title that DOES carry a level uses it");
  assert_(dhClassify_("09.I3.1 - Consultant, Professional Services", true).pool === "CREW",
          "employment type wins over the job code — a crew member's commercial model " +
          "is what makes their capacity non-interchangeable with an FTE's");
  assert_(dhClassify_("09.I3.1 - Consultant, Professional Services", false).pool === "PS-CONSULT",
          "…and the identical title on an FTE still classifies normally");
  assert_(dhClassify_("", true).pool === "CREW" && dhClassify_(null, true).pool === "CREW",
          "a blank crew title still lands in CREW rather than falling through");

  // ── Unclassified is a signal, not an error ──
  var u = dhClassify_("Consultant");
  assert_(u.role === "UNCLASSIFIED" && u.pool === "NONE" && u.band === "UNKNOWN",
          "unparseable title → UNCLASSIFIED, never a guessed pool");
  assert_(u.cell === "NONE|UNKNOWN" && !!u.classificationError, "…with a cell and a stated reason");
  var u2 = dhClassify_("99.I3.1 - Widget Wrangler, Widgetry");
  assert_(u2.role === "UNCLASSIFIED" && /no rule for 99\.1/.test(u2.classificationError),
          "a NEW job family is unclassified with a reason naming the missing rule");
  assert_(u2.family === "99" && u2.level === 3,
          "…and keeps what DID parse, so the fix is one registry row away");

  // ── Stem cross-check: warns, never reclassifies ──
  var odd = dhClassify_("09.I4.3 - Senior Consultant, Service Delivery");
  assert_(odd.pool === "PS-ENGINEER", "the variant digit still decides the pool");
  assert_(!!odd.stemWarning, "…but a 'Consultant' stem in PS-ENGINEER raises a warning");
  assert_(!dhClassify_("09.I4.3 - Senior Engineer I, Service Delivery").stemWarning,
          "a matching stem raises nothing");
  assert_(!dhClassify_("09.M5.3 - Manager, Service Delivery").stemWarning,
          "M-track is never stem-checked — management nouns match no pool regex");
  assert_(!dhClassify_("07.I3.1 - Support Engineer, Customer Support").stemWarning,
          "MS-SUPPORT has no stem expectation, so it never warns");

  Logger.log("✅ _test_classification_ passed");
}

/**
 * WORKFORCE HEALTH — the computation pipeline (spec v1.1 §5) plus the §8
 * validation invariants. Every assertion here is a failure mode the spec names:
 * pooled support, cover on a demand-driven pool, shadow measured on an export
 * that cannot measure it, NaN reaching render.
 */
function _test_workforceHealth_() {
  function assert_(c, m) { if (!c) throw new Error("❌ _test_workforceHealth_: " + m); }
  var ISOS = ["2026.W30", "2026.W31"];

  function wk(cap, planned, tracked, off) {
    return { cap: cap, avail: cap, planned: planned, tracked: tracked,
             trackedOff: off || 0, availCov: cap, capCov: cap, trackedCov: tracked,
             billable: 0, nonBillable: 0, nsCov: true, capEst: false };
  }
  function person(name, title, weeks) {
    var c = dhClassify_(title);
    return { name: name, jobTitle: title, pool: c.pool, band: c.band,
             backlogRole: c.role, cell: c.cell, subTrack: c.subTrack,
             disciplineLabel: c.disciplineLabel, stemWarning: c.stemWarning,
             classificationError: c.classificationError, weeks: weeks || {} };
  }

  // A consultant, an engineer, a support person, a delivery manager.
  var people = [
    person("Cora Consult", "09.I3.1 - Consultant, Professional Services",
           { "2026.W30": wk(40, 30, 32), "2026.W31": wk(40, 30, 30) }),
    person("Ewan Engineer", "09.I4.3 - Engineer, Service Delivery",
           { "2026.W30": wk(40, 36, 20), "2026.W31": wk(40, 36, 20) }),
    person("Sam Support", "07.I3.1 - Support Engineer, Customer Support",
           { "2026.W30": wk(40, 38, 38), "2026.W31": wk(40, 38, 38) }),
    person("Mia Manager", "09.M5.3 - Manager, Service Delivery",
           { "2026.W30": wk(40, 10, 10), "2026.W31": wk(40, 10, 10) }),
  ];

  // ── THE CENTRAL CLAIM: support must not blend with consulting ──────────────
  assert_(people[0].pool === "PS-CONSULT" && people[2].pool === "MS-SUPPORT",
          "consultant and support person land in DIFFERENT pools");
  assert_(people[3].pool === "NONE",
          "the delivery manager GOVERNS — they leave the pool denominator entirely");

  var heads = dhHeadByCell_(people);
  var cap = dhFoldWeekly_(buildCapacity_(people, ISOS, {}), ISOS, heads);
  assert_(cap["PS-CONSULT|CORE"].head === 1 && cap["PS-CONSULT|CORE"].grossHrs === 80,
          "capacity accrues to the pool×band cell");
  assert_(cap["MS-SUPPORT|CORE"].grossHrs === 80, "support capacity is its OWN cell, not pooled");
  assert_(!cap["PS-ENGINEER|MGMT"], "the manager contributes to no delivery pool cell");
  assert_(cap["NONE|MGMT"].head === 1, "…they are counted, in NONE|MGMT — never dropped");

  // Folding a SUBSET of weeks halves the hours but never the head count — a
  // person is one head across a period, not one per week.
  var oneWk = dhFoldWeekly_(buildCapacity_(people, ISOS, {}), ["2026.W30"], heads);
  assert_(oneWk["PS-CONSULT|CORE"].grossHrs === 40, "folding one week takes one week's hours");
  assert_(oneWk["PS-CONSULT|CORE"].head === 1, "…and the head count does not multiply by weeks");

  // PTO is carried but never subtracted (user decision 2026-08-10).
  var withPto = [person("P", "09.I3.1 - Consultant, Professional Services",
                        { "2026.W30": wk(40, 20, 30, 8) })];
  var capPto = dhFoldWeekly_(buildCapacity_(withPto, ISOS, {}), ISOS, dhHeadByCell_(withPto));
  assert_(capPto["PS-CONSULT|CORE"].grossHrs === 40, "gross capacity ignores tracked time off");
  assert_(capPto["PS-CONSULT|CORE"].ptoHrs === 8, "…but the hours are carried for the drill-down");

  // ── Jira side: one bound epic, one unbound, one with no Components column ───
  var epics = [
    { key: "DEL-1", isEpic: true, srsoComponent: true, estSec: 360000, spentSec: 0,
      statusCategory: "In Progress", resolved: null, epicKey: "", parentKey: "" },
    { key: "DEL-2", isEpic: true, srsoComponent: false, estSec: 180000, spentSec: 0,
      statusCategory: "In Progress", resolved: null, epicKey: "", parentKey: "" },
    { key: "DEL-3", isEpic: true, srsoComponent: null, estSec: 0, spentSec: 0,
      statusCategory: "In Progress", resolved: null, epicKey: "", parentKey: "" },
    // DEL-4 / DEL-5: nobody has ever logged to these, so no pool has a history
    // claim on them. They are the UNROUTED case — work no pool can plan.
    { key: "DEL-4", isEpic: true, srsoComponent: true, estSec: 180000, spentSec: 0,
      statusCategory: "In Progress", resolved: null, epicKey: "", parentKey: "" },
    { key: "DEL-5", isEpic: true, srsoComponent: true, estSec: 0, spentSec: 0,
      statusCategory: "In Progress", resolved: null, epicKey: "", parentKey: "" },
  ];
  var stories = [
    { key: "DEL-10", isEpic: false, epicKey: "DEL-1", parentKey: "", srsoComponent: true },
    { key: "DEL-20", isEpic: false, epicKey: "DEL-2", parentKey: "", srsoComponent: false },
    { key: "DEL-30", isEpic: false, epicKey: "DEL-3", parentKey: "", srsoComponent: null },
    { key: "DEL-40", isEpic: false, epicKey: "", parentKey: "DEL-10", srsoComponent: true },
    { key: "DEL-99", isEpic: false, epicKey: "", parentKey: "", srsoComponent: true },
  ];
  var jira = { issues: epics.concat(stories), epics: epics };
  var idx = dhEpicIndex_(jira.issues);
  assert_(idx.epicFor("DEL-10") === "DEL-1", "a story resolves to its epic");
  assert_(idx.epicFor("DEL-40") === "DEL-1", "a sub-task walks story → epic");
  assert_(idx.epicFor("DEL-99") === "", "an orphan resolves to no epic");
  assert_(idx.epicFor("DEL-1") === "DEL-1", "an epic is its own epic");
  assert_(idx.epicFor("") === "" && idx.epicFor(null) === "", "blank input never throws");
  // A cycle must degrade, not hang — this runs inside a GAS execution timeout.
  var cyc = dhEpicIndex_([{ key: "A", isEpic: false, epicKey: "B" },
                          { key: "B", isEpic: false, epicKey: "A" }]);
  assert_(cyc.epicFor("A") === "", "a mis-exported parent cycle returns no epic instead of hanging");

  var resolve = function (n) { return n; };
  function trow(user, issue, epicKey, hrs, key) {
    var w = {}; w["2026.W30"] = hrs;
    return { user: user, key: key || "DEL", issue: issue, epicKey: epicKey, parentKey: "",
             hasIssueCol: true, hasEpicCol: true, weekHours: w };
  }
  var planned = [trow("Cora Consult", "DEL-10", "DEL-1", 30)];
  var byName = {}; people.forEach(function (p) { byName[p.name] = p; });
  // The weekly map is shared by every pass, and dhCommittedEpics_ is one of
  // them — it writes the matchable-planned-hours denominator per cell per week.
  var allWeekly = {};
  var committed = dhCommittedEpics_(planned, idx, ISOS, resolve, byName, allWeekly);
  assert_(committed.set["DEL-1"] === 1, "an issue-level plan commits its epic");
  assert_(committed.coverage === 1, "…and plan-issue coverage is 100% when every plan names an issue");

  // A project-level plan names no issue — coverage must fall, NOT be assumed.
  var mixedPlans = planned.concat([trow("Cora Consult", "", "", 10)]);
  var mixedCommitted = dhCommittedEpics_(mixedPlans, idx, ISOS, resolve, byName);
  assert_(Math.abs(mixedCommitted.coverage - 0.75) < 1e-9,
          "a project-level plan lowers plan-issue coverage rather than reading as uncommitted");
  assert_(committed.byPool["PS-CONSULT"]["DEL-1"] === 1,
          "the plan commits the PLANNED person's pool");
  assert_(!committed.byPool["PS-ENGINEER"],
          "…and only that pool — commitment is never global");

  var tracked = [
    trow("Cora Consult", "DEL-10", "DEL-1", 20),   // committed
    trow("Cora Consult", "DEL-20", "DEL-2", 6),    // no-srso
    trow("Cora Consult", "DEL-99", "", 4),         // no-epic
    trow("Ewan Engineer", "DEL-10", "DEL-1", 10),  // committed epic, but HE was not planned on it
    trow("Sam Support", "DEL-30", "DEL-3", 12),    // Components column absent → unmeasured
  ];
  var conWeekly = buildConsumption_(tracked, resolve, byName, idx, committed, ISOS, {});
  var con = dhFoldWeekly_(conWeekly, ISOS, {});
  var cc = con["PS-CONSULT|CORE"];
  assert_(cc.trackedCommittedHrs === 20, "hours on a bound, planned epic are committed");
  assert_(cc.shadowReasons["no-srso"] === 6, "an epic with no SRSO component is no-srso shadow");
  assert_(cc.shadowReasons["no-epic"] === 4, "an orphan issue is no-epic shadow");
  assert_(cc.trackedShadowHrs === 10, "shadow is the sum of its reasons");
  var ec = con["PS-ENGINEER|CORE"];
  assert_(ec.shadowReasons["not-committed"] === 10,
          "a bound epic nobody planned this person onto is not-committed shadow");
  var sc = con["MS-SUPPORT|CORE"];
  assert_(sc.unmeasuredHrs === 12 && sc.trackedShadowHrs === 0,
          "an ABSENT Components column is unmeasured, NEVER shadow — the trap that reads ~100%");

  // §8: tracked splits exactly, on every cell.
  Object.keys(con).forEach(function (k) {
    var c = con[k];
    assert_(Math.abs(c.trackedCommittedHrs + c.trackedShadowHrs + c.unmeasuredHrs
                     - c.trackedTotalHrs) < 1e-9, "tracked splits exactly for " + k);
  });

  // Time off never enters the shadow denominator.
  var offRow = trow("Cora Consult", "", "", 8, "NETSUITE-PTO");
  var conOff = buildConsumption_([offRow], resolve, byName, idx, committed, ISOS, {});
  assert_(!conOff["PS-CONSULT|CORE"], "a NETSUITE time-off row contributes no consumption at all");

  // ── requiredPool and UNROUTED ──────────────────────────────────────────────
  var dom = dhDominantPoolByEpic_(tracked, resolve, byName, idx, ISOS);
  assert_(dom["DEL-1"].pool === "PS-CONSULT",
          "the epic routes to the pool that logged the most hours (20 vs 10)");
  assert_(dom["DEL-3"].pool === "MS-SUPPORT", "…and support's epic routes to support");
  assert_(!dom["DEL-4"], "an epic nobody has logged to has no history claim");
  var backlog = buildBacklog_(epics, dom, {});
  // DEL-1 (100h) + DEL-2 (50h) both route to PS-CONSULT on measured history.
  assert_(backlog["PS-CONSULT"].backlogHrs === 150, "history routes both worked epics to PS-CONSULT");
  assert_(backlog["MS-SUPPORT"].epicCount === 1, "support's backlog is its own, never pooled");
  assert_(!!backlog["UNROUTED"], "epics nobody has worked land in UNROUTED");
  assert_(backlog["UNROUTED"].epicCount === 2, "…both of them, counted, never distributed");
  // Estimate grossing-up: UNROUTED holds DEL-4 (estimated 50h) and DEL-5 (not).
  assert_(backlog["UNROUTED"].backlogHrs === 50, "raw remaining is the lower bound");
  assert_(backlog["UNROUTED"].estimateCoverage === 0.5, "estimate coverage is measured per pool");
  assert_(Math.abs(backlog["UNROUTED"].backlogAdjHrs - 100) < 1e-9,
          "50h raw at 50% estimate coverage grosses up to 100h — publishing raw understates by half");
  // Remaining is derived as original − spent; an overrun cannot go negative.
  var overrun = buildBacklog_([{ key: "X-1", isEpic: true, estSec: 3600, spentSec: 999999,
                                 statusCategory: "In Progress", resolved: null }], {}, {});
  assert_(overrun["UNROUTED"].backlogHrs === 0, "an overrun epic reports 0 remaining, never negative");
  var resolvedEpic = [{ key: "DEL-9", isEpic: true, srsoComponent: true, estSec: 3600,
                        spentSec: 0, statusCategory: "Done", resolved: "2026-01-01" }];
  assert_(Object.keys(buildBacklog_(resolvedEpic, {}, {})).length === 0,
          "a resolved epic is not open backlog");

  // ── Reconcile ──────────────────────────────────────────────────────────────
  // Fold every pass through ONE weekly map, exactly as the assembler does.
  // dhCommittedEpics_ already wrote its matchable hours into allWeekly above.
  buildCapacity_(people, ISOS, allWeekly);
  buildCommitment_(people, ISOS, allWeekly);
  buildConsumption_(tracked, resolve, byName, idx, committed, ISOS, allWeekly);
  var rec = reconcileWorkforce_(dhFoldWeekly_(allWeekly, ISOS, heads), backlog, 2);
  var byCell = {};
  rec.cells.forEach(function (c) { byCell[c.cell] = c; });

  var consult = byCell["PS-CONSULT|CORE"];
  assert_(consult.committedHrs === 60 && consult.grossHrs === 80, "commitment and capacity meet");
  assert_(Math.abs(consult.headroomHrs - 20) < 1e-9, "headroom = capacity − commitment");
  assert_(Math.abs(consult.headroomPct - 0.25) < 1e-9, "…as a share of ALL planned hours");
  // ── The MATCHABLE denominator ─────────────────────────────────────────────
  // Headroom uses every planned hour (all of them consume capacity). Fidelity
  // uses only the hours that name an issue and can therefore be matched.
  assert_(Math.abs(consult.matchableCommittedHrs - 30) < 1e-9,
          "only the issue-level plan hours are matchable");
  assert_(Math.abs(consult.executionGapHrs - 10) < 1e-9,
          "execution gap is matchable − delivered, not all-planned − delivered");
  assert_(Math.abs(consult.commitmentFidelity - 20 / 30) < 1e-9,
          "fidelity divides by the matchable hours, so a project-level plan cannot deflate it");
  assert_(consult.capacityTruth === null,
          "capacity truth is NOT MEASURED (null), never a forced 1.0 — there is no absence feed");
  assert_(consult.coverWeeks !== null, "a consuming pool reports cover");

  var support = byCell["MS-SUPPORT|CORE"];
  assert_(support.coverWeeks === null,
          "a DEMAND-DRIVEN pool reports null cover — n/a, never 0 (the most dangerous false read)");
  assert_(support.constraintIndex === null, "…and no constraint index either");
  assert_(support.commitmentFidelity === null,
          "every one of its tracked hours was UNMEASURABLE, so fidelity is null — " +
          "a raw 0% would flag a plan-vs-logged gap at a team that may have delivered everything");
  assert_(support.actionState === "DEMAND-DRIVEN",
          "…and its own descriptive state, not a false RECONCILE");
  // A cell whose plans COULD have matched but logged nothing against them is a
  // different case: that zero IS a measurement and still surfaces to reconcile.
  var silent = reconcileWorkforce_(
    { "PS-CONSULT|CORE": dhCell_({}, "a", { head: 1, grossHrs: 40, committedHrs: 40,
                                            matchableCommittedHrs: 40 }) },
    {}, 1);
  assert_(silent.cells[0].commitmentFidelity === 0,
          "a matchable plan with zero hours logged against it is 0% fidelity, not null");
  assert_(silent.cells[0].actionState === "RECONCILE", "…and that does surface as RECONCILE");

  // ── THE ARTEFACT THIS DENOMINATOR EXISTS TO KILL ──────────────────────────
  // A pool that plans entirely at PROJECT level names no issue, so nothing can
  // ever be matched. Under the old all-planned denominator this read ~0%
  // fidelity and painted RECONCILE — that was the shape of the pool's planning
  // being reported as a delivery failure. It is now null: not measurable.
  var projectPlanned = reconcileWorkforce_(
    { "PS-ENGINEER|CORE": dhCell_({}, "b", { head: 8, grossHrs: 320, committedHrs: 300,
                                             matchableCommittedHrs: 0,
                                             trackedTotalHrs: 280, trackedShadowHrs: 280 }) },
    {}, 1);
  assert_(projectPlanned.cells[0].commitmentFidelity === null,
          "a pool whose plans are all project-level reports NULL fidelity, not 0% — " +
          "there is nothing it could have been matched against");
  assert_(projectPlanned.cells[0].planMatchable === 0,
          "…and planMatchable states WHY, so the n/a is explainable rather than mysterious");
  assert_(projectPlanned.cells[0].headroomHrs === 20,
          "…while headroom still counts every planned hour — all of them consume capacity");

  // §8: no NaN reaches render, on any cell, on any numeric field.
  rec.cells.forEach(function (c) {
    Object.keys(c).forEach(function (k) {
      var v = c[k];
      assert_(typeof v !== "number" || isFinite(v), "no NaN/Infinity in " + c.cell + "." + k);
    });
  });

  // §8: pool totals equal headcount.
  var totalHead = rec.cells.reduce(function (a, c) { return a + c.head; }, 0);
  assert_(totalHead === people.length, "every person is in exactly one cell");

  // §8: deployable ≤ gross.
  rec.cells.forEach(function (c) {
    assert_(c.deployableHrs <= c.grossHrs + 1e-9, "deployable never exceeds gross for " + c.cell);
  });

  // ── State: DESCRIPTIVE, never directive (user decision 2026-08-10) ─────────
  // The spec's INTERVENE / SELL / HIRE / REASSESS / EXECUTE are instructions,
  // and three of them are alarms. These say where the cell SITS.
  assert_(dhActionState_({ commitmentFidelity: 0.5, shadowRatio: 0, coverWeeks: 8,
                           headroomPct: 0.2, cfg: DH_POOLS_["PS-CONSULT"] }) === "RECONCILE",
          "a plan-vs-logged gap outranks the capacity 2x2 — it is what to check first");
  assert_(dhActionState_({ commitmentFidelity: 1, shadowRatio: 0.4, coverWeeks: 8,
                           headroomPct: 0.2, cfg: DH_POOLS_["PS-CONSULT"] }) === "RECONCILE",
          "work landing outside the planned epics does too");
  assert_(dhActionState_({ commitmentFidelity: 1, shadowRatio: 0, coverWeeks: 2,
                           headroomPct: 0.5, cfg: DH_POOLS_["PS-CONSULT"] }) === "HEADROOM",
          "thin backlog + real room = HEADROOM — a description, not an instruction to sell");
  assert_(dhActionState_({ commitmentFidelity: 1, shadowRatio: 0, coverWeeks: 12,
                           headroomPct: 0.02, cfg: DH_POOLS_["PS-CONSULT"] }) === "AT CAPACITY",
          "deep backlog + no room = AT CAPACITY — not an instruction to hire");
  assert_(dhActionState_({ commitmentFidelity: 1, shadowRatio: 0, coverWeeks: 2,
                           headroomPct: 0.02, cfg: DH_POOLS_["PS-CONSULT"] }) === "REVIEW",
          "thin backlog + no room = REVIEW");
  assert_(dhActionState_({ commitmentFidelity: 1, shadowRatio: 0, coverWeeks: 7,
                           headroomPct: 0.2, cfg: DH_POOLS_["PS-CONSULT"] }) === "STEADY",
          "inside its own envelope = STEADY");
  // A NULL signal must never fire a state. safeDiv-returns-0 would put
  // RECONCILE on every pool that simply has no plan.
  assert_(dhActionState_({ commitmentFidelity: null, shadowRatio: null, coverWeeks: 7,
                           headroomPct: 0.2, cfg: DH_POOLS_["PS-CONSULT"] }) === "STEADY",
          "an UNMEASURED signal is not a BREACHED signal");

  // ── The Read reports, it does not diagnose ────────────────────────────────
  // Pinned because the regression is invisible: a sentence that reads well and
  // asserts a cause the data cannot support looks exactly like a good one.
  var gapRead = dhWorkforceRead_({ commitmentFidelity: 0.5, committedHrs: 1600, matchableCommittedHrs: 1399,
    trackedCommittedHrs: 700, executionGapHrs: 699, shadowRatio: 0, shadowReasons: {},
    coverWeeks: null, estimateCoverage: null, constraintIndex: null, head: 20 });
  assert_(/1,399h planned at issue level/.test(gapRead) && /700h logged/.test(gapRead),
          "the plan-vs-logged Read states BOTH sides, so the gap can be judged");
  assert_(!/ahead of reality|not delivered|find the blocker|blocker/i.test(gapRead),
          "…and asserts no cause: plans and worklogs are different grains, and a gap has " +
          "ordinary explanations before it has an alarming one");
  assert_(/reconciliation signal/.test(gapRead), "…it is named as a signal, explicitly");
  var outsideRead = dhWorkforceRead_({ commitmentFidelity: 1, shadowRatio: 0.4,
    shadowReasons: { "no-epic": 1, "no-srso": 9 }, coverWeeks: null,
    estimateCoverage: null, constraintIndex: null, head: 40 });
  assert_(/Delivered work/.test(outsideRead),
          "work outside the plan is stated as DELIVERED work with a paper-trail gap");
  assert_(!/invisible|cannot see/i.test(outsideRead), "…not as demand nobody can see");
  var smallRead = dhWorkforceRead_({ commitmentFidelity: 1, shadowRatio: 0,
    coverWeeks: null, estimateCoverage: null, constraintIndex: null, head: 2 });
  assert_(/2 people in this cell/.test(smallRead) && !/risk|succession/i.test(smallRead),
          "a small cell is described as a small SAMPLE, not labelled a risk");

  // dhSafeDiv_ is the reason that holds.
  assert_(dhSafeDiv_(5, 0) === null, "zero denominator → null, not 0");
  assert_(dhSafeDiv_(0, 5) === 0, "a real zero is still zero");

  // ── Read: severity order, structural risk NOT in the chain ─────────────────
  assert_(/planned at issue level/.test(dhWorkforceRead_({ commitmentFidelity: 0.5, committedHrs: 100, matchableCommittedHrs: 100,
    trackedCommittedHrs: 40, executionGapHrs: 60,
    shadowRatio: 0.9, shadowReasons: {}, coverWeeks: null, estimateCoverage: null,
    constraintIndex: null, head: 1 })), "the plan-vs-logged line outranks the outside-plan one");
  var shadowRead = dhWorkforceRead_({ commitmentFidelity: 1, shadowRatio: 0.5,
    shadowReasons: { "no-epic": 1, "no-srso": 9 }, coverWeeks: null,
    estimateCoverage: null, constraintIndex: null, head: 40 });
  assert_(/no-srso/.test(shadowRead) && /Finance/.test(shadowRead),
          "the outside-plan Read names the top reason AND whose desk it sits on");
  assert_(/every number on this row moves on one individual/.test(
    dhWorkforceRead_({ commitmentFidelity: 1, shadowRatio: 0, coverWeeks: null,
      estimateCoverage: null, constraintIndex: null, head: 2 })),
          "a small cell is described as a small sample, not graded as a risk");
  assert_(/Nothing notable/.test(dhWorkforceRead_({ commitmentFidelity: 1, shadowRatio: 0,
    coverWeeks: null, estimateCoverage: null, constraintIndex: null, head: 40 })),
          "an unremarkable pool says so plainly — no manufactured finding");

  // ── Assembly, scope facts, and the consumers-only denominator ──────────────
  var wf = buildWorkforceHealth_(people, tracked, planned, jira, resolve, ISOS, 4);
  assert_(wf.scope.population === 4, "scope states the population");
  // TWO consumers, not three: support SUSTAINS contracted work, it does not
  // consume project backlog. This gap between "population" and "consumers" is
  // the entire §1.1 claim, in one assertion.
  assert_(wf.scope.consumers === 2, "…and the consumer count separately — support is NOT a consumer");
  assert_(wf.scope.unclassified === 0, "unclassified is reported even at zero");
  assert_(wf.scope.absentPools.indexOf("PMO") !== -1,
          "pools this population cannot contain are named, not silently missing");
  assert_(/of 2 backlog consumers/.test(wf.consumersOnly.denominatorLabel),
          "the consumers-only figure ships WITH its denominator");
  assert_(wf.consumersOnly.head === 2, "consumers-only counts consuming pools only");
  // The blended reading this replaces would have divided across all four heads.
  assert_(wf.consumersOnly.head < wf.scope.population,
          "the honest denominator is SMALLER than the population — that gap is the whole point");
  assert_(wf.coverage.capacityTruthMeasured === false && wf.coverage.genericPlansMeasured === false,
          "the two things this deployment cannot measure say so, rather than defaulting to 0");
  assert_(wf.disciplines.length > 0 && wf.disciplines[0].role === "CONSUMER",
          "the discipline section reads consumers-first");
  var discHead = wf.disciplines.reduce(function (a, r) { return a + r.head; }, 0);
  assert_(discHead === 4, "discipline labels roll up to the whole population — no second truth");

  // Population drift alarm.
  assert_(wf.scope.drift.alert === false, "a stable population raises no drift alarm");
  var drifted = buildWorkforceHealth_(people, tracked, planned, jira, resolve, ISOS, 10);
  assert_(drifted.scope.drift.alert === true,
          "a >5% population move raises the alarm — membership change is not performance change");

  // An unclassified person is visible and holds no pool.
  var mystery = people.concat([person("Xavier Unknown", "Consultant", {})]);
  var wfx = buildWorkforceHealth_(mystery, [], [], jira, resolve, ISOS, null);
  assert_(wfx.scope.unclassified === 1, "a new job code surfaces as unclassified");
  assert_(wfx.scope.unclassifiedReasons[0].reason, "…with a stated reason, not a silent drop");
  assert_(wfx.scope.drift === null, "no prior population → no drift claim, rather than a false one");

  // Empty inputs never throw and never invent numbers.
  var wfEmpty = buildWorkforceHealth_([], [], [], { issues: [], epics: [] }, resolve, ISOS, null);
  assert_(wfEmpty.cells.length === 0 && wfEmpty.scope.population === 0, "an empty population is clean");
  assert_(wfEmpty.consumersOnly.headroomPct === null, "…and reports null headroom, never 0%");

  // ── Payload trim: smaller bytes, identical folded totals ───────────────────
  var rawWeekly = {};
  buildCapacity_(people, ISOS, rawWeekly);
  buildCommitment_(people, ISOS, rawWeekly);
  buildConsumption_(tracked, resolve, byName, idx, committed, ISOS, rawWeekly);
  // An all-zero bucket: dhWeekCell_ seeds every field at 0 and we add nothing.
  dhWeekCell_(rawWeekly, "EMPTY|CORE", "2026.W30");
  var trimmed = dhTrimWeekly_(rawWeekly);
  assert_(!trimmed["EMPTY|CORE"], "a cell whose every week is all-zero drops out of the payload");
  var foldRaw = dhFoldWeekly_(rawWeekly, ISOS, heads);
  var foldTrim = dhFoldWeekly_(trimmed, ISOS, heads);
  ["PS-CONSULT|CORE", "PS-ENGINEER|CORE", "MS-SUPPORT|CORE"].forEach(function (k) {
    ["grossHrs", "committedHrs", "trackedTotalHrs", "trackedCommittedHrs",
     "trackedShadowHrs", "unmeasuredHrs"].forEach(function (f) {
      assert_(Math.abs(foldRaw[k][f] - foldTrim[k][f]) < 0.02,
              "trimming does not move " + k + "." + f + " — " +
              foldRaw[k][f] + " vs " + foldTrim[k][f]);
    });
  });
  assert_(JSON.stringify(trimmed).length < JSON.stringify(rawWeekly).length,
          "…and it is genuinely smaller on the wire");

  Logger.log("✅ _test_workforceHealth_ passed");
}

