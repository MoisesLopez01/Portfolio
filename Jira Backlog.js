  // ============================================================
  // SCRIPT NAME: Exec Contribution Tracker — Backlog WoW from Jira
  // PURPOSE:     Fetches completed internal work from Jira per Space
  //              (COE, R&D), buckets by completion date across the
  //              last 3 Mon–Sun weeks, writes Jira Raw + Exec Q&A
  //              (WoW Δ for last 2 completed weeks).
  // AUTHOR:      Alex Lopez
  // CREATED:     3/30/2026
  // VERSION:     3.10.0
  // ENVIRONMENT: Google Apps Script
  // CHANGES v3.10.0 (retire two dead candidate columns — 2026-08-06):
  //   "Region (Alt)" (36) and "Tempo Team" (37) are REMOVED from Jira Raw, and
  //   their custom fields dropped from JIRA_FIELDS. Workstream moves 38 → 36.
  //     · They existed to let the attribution field be chosen off real sheet
  //       data. That choice is made (REGION_FIELD/TEAM_FIELD = 10047 / 10001).
  //     · Re-measured live 2026-08-06: customfield_11561 = 4 issues site-wide,
  //       customfield_10065 = 7. Unchanged since 2026-08-04.
  //     · No consumer anywhere ever read either header, and nothing reads Jira
  //       Raw columns 31+ by index (the index-pinned readers stop at 14) — so the
  //       Workstream shift is safe. Verified before removing, not assumed.
  //     · Still MEASURED by probeRegionTeamFields(), which is where a "has anyone
  //       started populating this?" check belongs: one query, not a blank column
  //       on every row forever.
  //   ⚠️ "Rework Link" (34) and "Reopened" (35) also read blank, and were DELIBERATELY
  //   KEPT — they are not dead columns:
  //     · Reopened is a TRISTATE. Blank means "nobody looked" (FETCH_CHANGELOG is
  //       off) and the dashboard depends on that to render Rework Rate as a FLOOR
  //       with no RAG verdict. Delete the column and blank reads as "not
  //       reopened", which silently deflates the rate — the exact failure the
  //       tristate prevents.
  //     · Rework Link is blank because REWORK_LINK_RE matches NO link type that
  //       exists on this site. getIssueLinkTypes (checked 2026-08-06) returns 15
  //       types — Agenda, Blocks, Cloners, Discovery-Connected, Duplicate, I/O,
  //       Parent-Child, Polaris ×3, Problem/Incident, Process/Policy, Relates,
  //       Splitting, Work item split — and not one contains "rework", "defect" or
  //       "bug fix". This is a VOCABULARY gap, not a tagging gap: the column is
  //       correct and has nothing to find. Either create a real "Rework" link
  //       type in Jira, or widen the regex to Problem/Incident and accept it as a
  //       proxy. Until then Rework Rate has zero signal from BOTH its inputs.
  // CHANGES v3.9.0 (flow-metrics feeds — spec 2026-08-05-flow-metrics-design.md):
  //   Two NEW output tabs, zero changes to Jira Raw / Exec Q&A / FETCH_CHANGELOG:
  //     · "Jira Bugs"      — one row per Bug created in the RAW_HISTORY_WEEKS
  //       window (same space scoping + isNoiseIssue_ filter as the main fetch:
  //       a bug closed Won't Do / Duplicate was a report, not a defect).
  //       Bugs are NOT in EXEC_ISSUE_TYPES on purpose — dropping Bug rows into
  //       Jira Raw would silently move every consumer's On-Time/Throughput
  //       denominators. Full rewrite per run, append-only header contract.
  //     · "Flow Snapshots" — ONE ROW APPENDED PER RUN: timestamp, ISO week,
  //       WIP count, backlog hrs, backlog item count, computed over the same
  //       open candidates written to Jira Raw. Snapshots exist because a
  //       backlog is a point-in-time state that can never be reconstructed
  //       later. Rows older than RAW_HISTORY_WEEKS are pruned on write.
  //   Consumer: the delivery-health dashboard's 🌊 Flow tab.
  // CHANGES v3.8.0 (Region vocabulary: APAC retired — reviewer feedback 2026-08-05):
  //   APAC is a superset of ANZ and SEA (and more), so using it as a sibling
  //   bucket next to ANZ double-speaks the taxonomy. Reviewer correction:
  //     · "RR05 South East Asia" → SEA   (was APAC)
  //     · "RR08 Asia"            → SEA   (was APAC; 4 issues site-wide, and this
  //       org's Asia delivery hub is SEA — revisit if East-Asia work appears)
  //   The exported short-form set is now AMER / EMEA / SEA / ANZ / Global.
  //   Re-run the export after deploying — until then the sheet still carries
  //   "APAC" rows (the delivery-health reader maps that legacy token to SEA).
  // CHANGES v3.7.0 (Region actually works — multi-select bug + verified vocabulary):
  //   The Region column was never blank because "the Jira field isn't populated"
  //   (what v3.3.0 and v3.4.0 both recorded). It was blank because
  //   customfield_10047 "Resource region" is a MULTI-SELECT: Jira returns an
  //   ARRAY of option objects, and jbRegionValue_ read `raw.value` off the array
  //   — undefined on an array — so every tagged issue exported "". Probed live
  //   against servicerocket-coe on the rows this export ACTUALLY WRITES — the
  //   52-week Done window (EXEC_ISSUE_TYPES, statusCategory = Done, resolved
  //   within RAW_HISTORY_WEEKS, n = 12,082):
  //     · customfield_10047 "Resource region"  4,158 / 12,082 = 34%  ← the data
  //     · customfield_10001 "Team" (Atlassian) 4,146 / 12,082 = 34%  ← the data
  //     · customfield_11057 "Workstream"       2,499 / 12,082 = 21%
  //     · customfield_11561 "Region"               0 / 12,082 =  0%  (4 site-wide)
  //     · customfield_10065 "Tempo Team"           0 / 12,082 =  0%  (7 site-wide)
  //     · customfield_10600 "Region/Timezone"   DOES NOT EXIST on this site
  //   ⚠️ SCOPE THE NUMBER OR IT MISLEADS. Region tagging is DECLINING, so the
  //   window you measure decides the answer you get:
  //     · 52-week Done window (what Jira Raw holds)  4,158 / 12,082 = 34%
  //     · last 90 days only                             632 /  3,624 = 17%
  //     · OPEN backlog rows (the actionable half)        144 /  1,477 = 10%
  //   Team runs the other way on the backlog (327/1,477 = 22%). An earlier draft
  //   of this comment said "17%" with no window named; it described a 90-day
  //   slice of a 52-week sheet and could not be reconciled against Jira Raw.
  //   Both primaries were already configured correctly. What was broken was the
  //   READER (array) and the VOCABULARY: REGION_VOCAB_ mapped "RR02 EMEA",
  //   "RR03 APAC" and "RR04 ANZ" — three labels that do not exist on this site.
  //   The real option list is RR01/RR02/RR03/RR04/RR05/RR07/RR08/RR09 (below).
  //   - jbRegionValue_ now maps EVERY option in the array through the vocabulary,
  //     dedupes and joins with " | ". On the sampled population 122/126 tagged
  //     issues collapse to one token (24% carry 2 options, 2% carry 3 — usually
  //     "RR01 North America" + "RR02 Latin America", both AMER); only 4 are
  //     genuinely cross-region and export as e.g. "AMER | APAC".
  //   - "RR07 Global" (23 of 126) maps to its own token "Global", NOT folded into
  //     a geography and NOT blanked: it is a deliberate tag, so inventing a
  //     region for it or hiding it as untagged would both be lies (decision
  //     2026-08-04).
  //   - Three APPEND-ONLY candidate columns (36 Region (Alt), 37 Tempo Team,
  //     38 Workstream) so the attribution field can be chosen off the sheet
  //     instead of another probe. Kept OUT of REGION_FIELD/TEAM_FIELD until the
  //     sheet shows one overtaking its primary — promoting a 0% field would
  //     silently zero a working column.
  //     ⚠️ SUPERSEDED by v3.10.0: the first two were retired once the choice was
  //     made; Workstream moved to 36. See RAW_HEADERS.
  //   - probeRegionTeamFields() now probes all six fields, reports multi-select
  //     option counts, and would have caught the array bug: it measured "0%"
  //     because it called the same broken reader.
  // CHANGES v3.6.0 (quality / rework feed — Metrics Dictionary metric #4):
  //   Three APPEND-ONLY columns on Jira Raw (33 Status Category, 34 Rework Link,
  //   35 Reopened) so the delivery-health dashboard can finally compute Rework
  //   Rate instead of showing a "data pending" placeholder.
  //     · Status Category — free: status.statusCategory.name was already in the
  //       response, we just never wrote it. Authoritative "delivered", replacing
  //       the consumer's hand-maintained done-status regex.
  //     · Rework Link — free: `issuelinks` was already fetched and reduced to a
  //       bare count. Matched against CONFIGJ.REWORK_LINK_RE (name + both
  //       direction labels). ⚠️ Confirm the real link-type name via
  //       getIssueLinkTypes before trusting the column.
  //     · Reopened — needs expand=changelog, gated behind CONFIGJ.FETCH_CHANGELOG
  //       (default OFF). Exports "" when not measured, never "No": a consumer
  //       must be able to tell "not reopened" from "nobody looked", or the
  //       Rework Rate silently deflates.
  //   Columns are appended, never inserted — every consumer resolves Jira Raw by
  //   HEADER NAME, so old readers are unaffected and new ones light up with no
  //   redeploy. (This is the rule that Region/Team moving 32/33 → 31/32 broke.)
  // CHANGES v3.5.0 (Jira-only export — dropped all non-Jira sheet reads):
  //   This script is an EXPORTER. Every consumer now joins Tempo hours, capacity
  //   and PTO itself, straight off the Jira Raw sheet plus its own sources, so
  //   reading those tabs here was duplicated work that silently produced nothing
  //   whenever the tabs lived in a different workbook (which is the case today).
  //   - REMOVED readers: readCapacity_ ("Capacity"), readTimeOff_ ("Time Off"),
  //     readTempoTrend_ ("Capacity" + "Tempo Transposed"), readPlannedTimeTempo_
  //     ("Planned Time Tempo"). Plus their now-unused helpers isoWeekNum_ and
  //     jb_weekKey_, and the CONFIGJ keys CAPACITY_SHEET / TIME_OFF_SHEET /
  //     TEMPO_SHEET / PLANNED_TEMPO_SHEET.
  //   - REMOVED the Exec Q&A "Tempo Tracking Trend" section
  //     (writeTempoTrendSection_, ~390 lines) and its call site. It had been
  //     writing NOTHING in practice — it bailed at "not enough week data"
  //     because the Capacity tab isn't in this workbook. No output is lost.
  //   - REMOVED the dead Capacity/PTO aggregation in writeExecQASheet_:
  //     totalCapacityHrs / totalPtoHrs were accumulated and never read by
  //     anything. Also dropped _personMilestones, whose only consumer was the
  //     deleted Tempo section.
  //   - ⚠️ NAMESPACE FIX (side benefit): readCapacity_ and readTimeOff_ were ALSO
  //     defined in "Hours Analysis.js". GAS shares one namespace across a
  //     project, so whichever file loaded last won, and "Full HC Analysis.js"
  //     calls readCapacity_() expecting Hours Analysis's shape. That collision
  //     is now gone.
  //   - The Roster tab is the ONE sheet still read (readTargetedRoster_): Exec
  //     Q&A's engagement rate and runDebugRosterMatching() both depend on it.
  //   - Tempo remains wired up via its REST API (fetchTempoWorklogsForIssues_)
  //     for Jira Raw cols 26–29. Only the SHEET reads went away.
  //   - Documented jb_isoWeekLabel_'s W01-vs-W1 padding divergence from the
  //     delivery-health dashboard's weekKeyFromDate_, and the cross-file
  //     normalizeName_ dependency in getSpaceForIssue_.
  // CHANGES v3.4.0 (Delivery Health alignment):
  //   - Region (col 31) and Team (col 32) restored, with a vocabulary mapping
  //     (REGION_VOCAB_: "RR01 North America" → "AMER", …). Expected to export
  //     BLANK until the Jira custom fields are actually populated — the columns
  //     exist now so the dashboard picks them up by header the moment they fill,
  //     with no second deploy. Run probeRegionTeamFields() to check fill rate.
  //   - Open-issues fetch: unresolved ASSIGNED issues are written to Jira Raw
  //     under the sentinel Week label "Open", feeding the delivery-health
  //     dashboard's per-person backlog drill-down (readJiraRaw_ keys off Status
  //     and Resolution Date, never the Week column). Deduped against the Done
  //     fetch and the epic-child expansion so no issue is written twice.
  //     Bounded by OPEN_BACKLOG_UPDATED_WEEKS and fetched WITHOUT the heavyweight
  //     "comment" field (nothing reads comments off backlog rows).
  //   - Exec Space now falls back to the PROJECT KEY instead of the generic
  //     "Customer" for projects that match no configured space and no entry in
  //     CUSTOMER_PROJECT_MAP, so an unmapped client is identifiable in Jira Raw.
  //     NOTE: this never excluded anything — getSpaceForIssue_ only returns null
  //     for an explicitly DISABLED space (R&D today). No consumer reads the
  //     "Exec Space" column, and scopeForSpace_ / bySpace are both dead code.
  //   - fetchAllIssuesByJql_ takes an optional field-list override.
  // CHANGES v3.3.0:
  //   - Jira Raw trimmed to columns 0–30: dropped "Tempo This Week (hrs)" (31),
  //     "Region" (32) and "Team" (33). All three shipped empty in practice —
  //     Region/Team custom fields aren't populated on these issues, and the
  //     this-week burn is structurally blank because Jira Raw rows are issues
  //     that completed in PAST weeks. REGION_FIELD/TEAM_FIELD left the fetch
  //     field list too, so pages got smaller as a side effect.
  //   - Truncated-response hardening: Jira and Tempo occasionally return a
  //     SHORT 200 body, which used to surface as a bare "SyntaxError: Expected
  //     ',' or ']' after array element in JSON at position …" with no clue
  //     which call died. Both parse sites now go through jb_tryParseJson_ and
  //     retry the same cursor with a halved page size.
  // CHANGES v3.2.0:
  //   - Removed the "Weekly Report" and "Top Performers" tabs (retired) —
  //     writers, CONFIGJ tab names, and the writeReportSheet_ aggregation
  //     adapter are gone. Jira Raw + Exec Q&A are the remaining outputs.
  // CHANGES v3.1.0:
  //   - Epic expansion: children of every in-scope epic land in Jira Raw
  //     under the sentinel Week label "Epic Child" (open or resolved outside
  //     the analysed window) — weekly metrics sheets are unaffected
  //   - Epic-level Tempo rollup columns (28–29) on epic rows: own + child +
  //     sub-task hours and contributors
  //   - "Billing Type" column (30): Billable (SRSO) / Internal / Untagged
  //   - Unassigned issues flagged "⚠️ UNASSIGNED" in the Assignee column
  //   - Exec Q&A: "📐 EPIC FIDELITY" section — planned (Original Estimate)
  //     vs tracked (Tempo) per epic, worst fidelity first
  //   - CUSTOMER_PROJECT_MAP: known client project keys tag the real client
  //     name instead of the generic "Customer" space
  // CHANGES v3.0.0:
  //   - Buckets by resolutiondate (not updated) for accurate completion tracking
  //   - Per-Space JQL fetches (COE, R&D) with statusCategory = Done
  //   - Cursor-based pagination (nextPageToken) via /rest/api/3/search/jql
  //   - New fields: Story Points, Epic Key, Parent Key, Completed Date
  //   - New “Exec Q&A” sheet: WoW metrics per Space (items, contributors, SP)
  //   - Raw sheet columns 0–14 unchanged (backward compatible)
  // ============================================================

  // ============================================================
  // ⚙️  CONFIGJURATION — Edit values here before running
  // ============================================================
  const CONFIGJ = {
    // Your Jira site domain — no trailing slash
    JIRA_BASE_URL: "https://servicerocket-coe.atlassian.net",

    // Jira account email tied to your API token
    JIRA_EMAIL:    "moises.lopez@servicerocket.com",

    // How many days back to fetch from Jira (covers 4 full weeks + buffer)
    // Converted to explicit ISO date at runtime — no relative syntax like "-4w"
    // Fallback only: runJiraEpicTracker fetches from the first week window's
    // Monday, so this never truncates the analysed weeks.
    LOOKBACK_DAYS: 35,

    // ── TWO WINDOWS (split 2026-08-03) ────────────────────────
    // "Jira Raw" feeds the dashboards, which offer Weekly/Monthly/Quarterly
    // period views and therefore need deep history. "Exec Q&A" is a WoW
    // narrative sheet that wants the last few weeks and nothing more — one
    // column per week, so widening it would just bloat the sheet and the
    // runtime for no reader.
    //
    // Both windows are cut from the SAME single broad JQL fetch (see
    // runJiraEpicTracker → fetchJiraIssues_, which is anchored at the DEEP
    // window start and bucketed by resolution date client-side), so the deep
    // window costs no extra Jira queries — only extra result pages.

    // Number of completed calendar weeks in the NARRATIVE sheets (Mon–Sun).
    // Use 4 so Exec Q&A has trend context beyond the 2-week WoW compare.
    WEEKS_BACK: 4,

    // Completed calendar weeks of history written to "Jira Raw" — the depth
    // every dashboard period view is limited by. Reads the shared export dial
    // (EXPORT_HISTORY_WEEKS in TempoPlanExport.js) when the exporters share a
    // GAS project, else falls back to the same value so this file still runs
    // standalone. 52 weeks = 11 complete months and 3 complete fiscal quarters
    // (the window's oldest period is always partial, so usable depth is not
    // weeks/13) — enough for a real Quarterly trend instead of the single data
    // point a 30-week window gave. See the WHY 52 note in TempoPlanExport.js.
    get RAW_HISTORY_WEEKS() {
      return typeof exportHistoryWeeks_ === "function" ? exportHistoryWeeks_() : 52;
    },

    // Epic expansion depth (weeks). Children of epics resolved inside this
    // window are added to "Jira Raw" under the "Epic Child" sentinel week.
    // Deliberately NOT the deep window: expansion is the one part of this
    // export whose cost multiplies (every epic fans out to its children), and
    // children of programmes closed 10 months ago add rows nobody reads. One
    // quarter keeps active programmes fully expanded. Raise if a consumer
    // needs older trees — and watch the row count when you do.
    EPIC_EXPAND_WEEKS: 13,

    // OPTIONAL: fixed starting calendar week (ISO, "YYYY.WN"). When set, the
    // week windows run from this week through the last completed week and
    // WEEKS_BACK is ignored. Set to null for the rolling WEEKS_BACK behaviour.
    // ⚠️ MUST STAY null: a fixed anchor grows the window by one week every
    // week forever, so trigger runtime creeps up until the export starts
    // timing out. It was "2026.W14" (18 weeks and counting by 2026.W32);
    // RAW_HISTORY_WEEKS replaces it with a bounded rolling window.
    START_ISO_WEEK: null,

    // Sheet tab names. RAW_SHEET / EXEC_SHEET are OUTPUTS (auto-created if
    // missing); ROSTER_SHEET is the only tab this script still READS.
    // CAPACITY_SHEET / TIME_OFF_SHEET / TEMPO_SHEET / PLANNED_TEMPO_SHEET were
    // dropped in v3.5.0 along with their readers — see the note under
    // SECTION: HELPERS.
    RAW_SHEET:    "Jira Raw",
    EXEC_SHEET:   "Exec Q&A",
    // Flow-metrics feeds (v3.9.0) — outputs, auto-created like the two above.
    BUGS_SHEET:      "Jira Bugs",
    FLOW_SNAP_SHEET: "Flow Snapshots",
    // Weekly created/resolved tally for the Executive queue metrics (v3.11.0).
    // Counts only — no per-issue rows, so no consumer's denominators move.
    ARRIVALS_SHEET:  "Jira Arrivals",
    ROSTER_SHEET: "Roster",

    // ── Executive reporting ────────────────────────────────────
    // Number of completed weeks used for the Exec Q&A WoW comparison
    EXEC_WEEKS_BACK: 2,

    // Targeted Job Profiles (for Headcount calculation)
    TARGET_PROFILES: [
      "07.I4.2 - Senior Consultant I, Delivery",
      "07.I3.1 - Engineer, Customer Support",
      "15.I5.1 - Senior Consultant II, Project Management",
      "07.I4.1 - Senior Engineer I, Customer Support",
      "18.I6.1 - Senior Consultant III, Solution Architecture",
      "18.I4.1 - Senior Consultant I, Solution Architecture",
      "07.I2.1 - Associate Engineer, Customer Support",
      "09.I5.1 - Senior Consultant II, Service Delivery",
      "07.I5.1 - Senior Engineer II, Customer Support",
      "18.I5.1 - Senior Consultant II, Solution Architecture",
      "07.I5.2 - Senior Consultant II, Delivery",
      "09.I5.3 - Senior Engineer II, Service Delivery",
      "09.I4.3 - Senior Engineer I, Service Delivery",
      "09.I3.1 - Consultant, Technical Consulting",
      "15.I4.1 - Senior Consultant I, Project Management",
      "09.I4.1 - Senior Consultant I, Technical Consulting",
      "09.I3.3 - Engineer, Service Delivery"
    ],

    // "Space" definitions — match by project key OR project name
    // Add every key/name your Jira instance uses for each space
    SPACES: [
      { key: "COE",  enabled: true, match: ["COE", "COEINT", "COE Platform"] },
      { key: "R&D",  enabled: false , match: ["RND", "RND-OPS", "RDP", "R&D", "R&D Projects", "R & D"] }, // To exclude R&D, simply change enabled to false
    ],

    // Customer projects — Jira project key → client display name. Matching
    // issues get the client name (instead of the generic "Customer") in the
    // Exec Space column; unlisted customer projects still fall back to
    // "Customer". Aggregations that bucket by COE / R&D / Customer collapse
    // client names back to "Customer" via scopeForSpace_().
    CUSTOMER_PROJECT_MAP: {
      "CLVT":  "Cultivate",
      "NVDA":  "NVIDIA",
      "MSTLY": "Mostly",
      // add more as needed
    },

    // Issue types considered "execution work"
    EXEC_ISSUE_TYPES: ['Epic', '"Kick-off epic"', '"Go-live epic"', 'Story', 'Task', '"Sub-task"'],

    // Prefer statusCategory over hard-coded status names
    DONE_JQL: 'statusCategory = Done',
    WIP_JQL: 'status IN ("In Progress")', // NEW: For Active Engagement

    // Revenue-linked fix version filter (SRSO)
    FIX_VERSION_JQL: 'fixVersion ~ "SRSO*"',

    // Site-specific custom field IDs (IMPORTANT: verify via /rest/api/3/field)
    STORY_POINTS_FIELD: "customfield_10026",  // ← replace if different
    EPIC_LINK_FIELD:    "customfield_10014",  // ← replace if different (Epic Link)
    EPIC_TYPE_FIELD:    null,                 // e.g. "customfield_12345" if you have one

    // ── REGION / TEAM ATTRIBUTION (IDs VERIFIED live 2026-08-04) ──
    // Measured on the rows this export actually writes — the 52-week Done window
    // (EXEC_ISSUE_TYPES, statusCategory = Done, resolved within RAW_HISTORY_WEEKS,
    // n = 12,082 on servicerocket-coe), with the open-backlog leg beside it
    // (n = 1,477) because Jira Raw carries both:
    //
    //                                          Done 52w      Open backlog
    //   customfield_10047  "Resource region"   4,158  34%    144  10%  ← REGION_FIELD
    //   customfield_10001  "Team" (Atlassian)  4,146  34%    327  22%  ← TEAM_FIELD
    //   customfield_11057  "Workstream"        2,499  21%      —
    //   customfield_11561  "Region"                0   0%      —       (4 site-wide)
    //   customfield_10065  "Tempo Team"            0   0%      —       (7 site-wide)
    //   customfield_10600  "Region/Timezone"   does not exist on this site
    //
    // ⚠️ ALWAYS NAME THE WINDOW. Region tagging is declining — 34% across the
    // 52-week sheet, 17% in the last 90 days, 10% on open work — so an unscoped
    // "the fill rate is N%" is meaningless and will not reconcile against Jira
    // Raw. The open backlog is both the worst-tagged and the only actionable
    // half: tagging a resolved issue rewrites history, tagging an open one moves
    // next period's number.
    //
    // Both primaries were already the right choice. The blank column was a READER
    // bug (Resource region is a MULTI-SELECT — see jbRegionValue_) plus a wrong
    // REGION_VOCAB_, not an unpopulated field. Re-run probeRegionTeamFields()
    // after any Jira field admin change; it now reports all six.
    //
    // ⚠️ Do NOT promote a candidate below into REGION_FIELD/TEAM_FIELD on the
    // strength of its name — "Region" (11561) looks canonical and carries 4
    // issues site-wide. Promote only when the sheet shows it overtaking.
    REGION_FIELD: "customfield_10047",  // multi-select, array of option objects
    TEAM_FIELD:   "customfield_10001",  // Atlassian team object → {id, name, title}

    // Candidate attribution fields. PROBE-ONLY as of v3.10.0 (2026-08-06):
    // REGION_ALT_FIELD and TEAM_TEMPO_FIELD are no longer fetched or exported —
    // they carry 4 and 7 issues SITE-WIDE, the attribution choice they existed to
    // inform has been made, and no consumer ever read their columns. They stay
    // here because probeRegionTeamFields() still reports them: measuring a
    // candidate costs one query, whereas exporting it costs a permanently blank
    // column on every row. Promote one into REGION_FIELD/TEAM_FIELD only when the
    // PROBE shows it overtaking its primary.
    REGION_ALT_FIELD: "customfield_11561",  // "Region" — single-select · probe only
    TEAM_TEMPO_FIELD: "customfield_10065",  // "Tempo Team"                · probe only
    WORKSTREAM_FIELD: "customfield_11057",  // delivery phase: "1. Discovery", … · col 36

    // ── QUALITY / REWORK FEED (Metrics Dictionary metric #4) ──
    // The dictionary defines Rework Rate as "issues reopened or linked as Rework
    // after Done ÷ total issues delivered in period". Two independent signals,
    // with very different costs:
    //
    //   Rework LINK  — free. `issuelinks` is already in JIRA_FIELDS (we were
    //                  throwing away everything but the count). Just needs the
    //                  link type name matched.
    //   REOPENED     — needs `expand=changelog`, which returns the full history
    //                  of every issue. That is a real cost on an export whose
    //                  pages already shrink-and-retry because `comment` returns
    //                  ADF trees. OFF by default; turn it on once a real run has
    //                  been timed (user decision 2026-08-03).
    //
    // ⚠️ Confirm the actual link-type name in your Jira before trusting the
    // column — `getIssueLinkTypes` lists them. If no link of this name exists,
    // the column exports blank and the dashboard's Rework Rate reports on
    // reopens alone (and says so on the card).
    REWORK_LINK_RE: /rework|defect|bug\s*fix/i,
    FETCH_CHANGELOG: false,
    // A reopen = a changelog transition where statusCategory left "Done" (or the
    // resolution was cleared) AFTER the issue had reached Done at least once.
    REOPEN_FROM_DONE_RE: /^(done|closed|resolved|complete)/i,

    // ── OPEN BACKLOG FEED ─────────────────────────────────────
    // Unresolved ASSIGNED issues written to Jira Raw under Week = "Open", for the
    // delivery-health dashboard's per-person backlog drill-down.
    OPEN_BACKLOG_ENABLED: true,

    // Staleness bound: only open issues touched within this many weeks are
    // exported. The backlog feed answers "what load is this person carrying?",
    // and a ticket nobody has touched in 6 months is not real load — it is
    // abandoned work that would inflate every person's backlog total and make
    // the dashboard's "needs planning" signal meaningless. Unlike the Done
    // fetch there is no resolution date to bound this query, so without a
    // filter it returns every open assigned issue on the site, forever.
    // Set to null for a genuinely unbounded fetch (watch the row count).
    OPEN_BACKLOG_UPDATED_WEEKS: 26,

    // Fields to request from Jira REST API
    // To map custom fields: https://servicerocket-coe.atlassian.net/rest/api/3/field
    JIRA_FIELDS: null, // built below after config is defined
  };

  // Build JIRA_FIELDS after CONFIGJ is defined so we can reference the custom field IDs
  CONFIGJ.JIRA_FIELDS = [
    "summary",
    "issuetype",
    "project",
    "assignee",
    "reporter",
    "priority",
    "status",
    "resolution",
    "created",
    "updated",
    "resolutiondate",
    "statuscategorychangedate",
    "duedate",
    "fixVersions",
    "parent",
    "labels",
    "components",
    "timetracking",
    "timeoriginalestimate",
    "timespent",
    "issuelinks",
    "comment",                         // Added for behavioral trend analysis
    "customfield_10015",              // Start Date
    CONFIGJ.STORY_POINTS_FIELD,
    CONFIGJ.EPIC_LINK_FIELD,
    CONFIGJ.REGION_FIELD,
    CONFIGJ.TEAM_FIELD,
    // REGION_ALT_FIELD / TEAM_TEMPO_FIELD deliberately ABSENT (v3.10.0): they are
    // probe-only now, and dropping two custom fields from every page also shrinks
    // the responses that already shrink-and-retry on truncation.
    CONFIGJ.WORKSTREAM_FIELD,
  ].filter(Boolean);
  // NOTE on page size: "comment" above is the heavyweight field — it returns
  // every comment as a full ADF tree, so a 100-issue page can run past 500 KB.
  // It is load-bearing (analyzeComments_ drives the Exec Q&A behavioural
  // scores), so instead of dropping it, fetchAllIssuesByJql_ shrinks its page
  // size when a response comes back truncated.

  // Field list for queries that don't need comment bodies. "comment" is the one
  // heavyweight field in JIRA_FIELDS (a full ADF tree per comment) and only
  // analyzeComments_ — an Exec Q&A concern, driven off the Done fetch — ever
  // reads it. The open-backlog fetch therefore drops it: smaller pages, fewer
  // truncation retries, same columns written.
  var JIRA_FIELDS_NO_COMMENTS = CONFIGJ.JIRA_FIELDS.filter(function(f) {
    return f !== "comment";
  });

  // ── Region vocabulary ────────────────────────────────────────
  // Jira's Resource Region picker uses ordered option labels ("RR01 North
  // America") so they sort in the UI; every downstream consumer — the
  // delivery-health region chips, the Tempo exports, the Roster buckets —
  // speaks the short form. Mapping here means the sheet only ever carries the
  // short form, so nobody has to strip the "RRnn " prefix twice.
  //
  // ⚠️ EVERY key below was read off live Jira on 2026-08-04 (the full set of
  // option labels in use across all 11,658 tagged issues). The previous table
  // guessed at "RR02 EMEA" / "RR03 APAC" / "RR04 ANZ", none of which exist —
  // RR02 is Latin America, RR03 is Europe and RR04 is Australia. Getting this
  // wrong is silent: unmapped labels pass through verbatim, so the sheet said
  // "RR05 South East Asia" and the dashboard bucketed it as "Other".
  //
  // Note RR06 is absent — no issue on the site carries it. If it (or any new
  // option) appears it passes through VERBATIM rather than becoming "Other", so
  // it shows up as itself in probeRegionTeamFields() instead of silently
  // collapsing into a bucket nobody owns.
  //
  // ⚠️ APAC is NOT in the vocabulary (retired v3.8.0, reviewer feedback
  // 2026-08-05): APAC is a superset of ANZ and SEA, so shipping it as a sibling
  // bucket next to ANZ made the taxonomy self-contradictory. South East Asia
  // exports as SEA; "RR08 Asia" (4 issues site-wide) folds into SEA because this
  // org's Asia delivery hub IS the SEA hub — revisit if East-Asia work appears.
  var REGION_VOCAB_ = {
    "RR01 North America":   "AMER",
    "RR02 Latin America":   "AMER",
    "RR03 Europe":          "EMEA",
    "RR09 Africa":          "EMEA",   // EMEA includes Africa
    "RR04 Australia":       "ANZ",
    "RR05 South East Asia": "SEA",
    "RR08 Asia":            "SEA",    // 4 issues site-wide; Asia hub = SEA here
    // "Global" is deliberately NOT a geography and NOT blank. It is the single
    // most common tag (23 of 126 in the sample), so folding it into a real
    // region would invent delivery presence that doesn't exist, and blanking it
    // would file a deliberate choice under "nobody tagged this".
    "RR07 Global":          "Global",
  };

  // Canonical order for compound values, so an issue tagged SEA+AMER and one
  // tagged AMER+SEA produce the SAME string. Without this, Jira's per-issue
  // option order leaks into the sheet and a consumer grouping on the Region
  // column silently gets two groups for one pair. Tokens outside this list sort
  // alphabetically after it.
  var REGION_ORDER_ = ["AMER", "EMEA", "SEA", "ANZ", "Global"];

  /**
   * Short-form region(s) for an issue's Resource Region field value.
   *
   * ⚠️ This field is a MULTI-SELECT: Jira returns an ARRAY of option objects,
   * [{value: "RR01 North America"}, …]. The pre-v3.7.0 reader took `raw.value`
   * off that array — undefined — and returned "", which is the entire reason
   * the Region column looked unpopulated for two releases while 17% of the
   * exported population was in fact tagged. Anything that reads a Jira
   * custom field here must handle the array case first.
   *
   * Multiple options are mapped individually, deduped and joined with " | ", so
   * the common real case (RR01 North America + RR02 Latin America) collapses to
   * a single "AMER" and only genuinely cross-region work carries a compound
   * value like "AMER | SEA". Order is the vocabulary's, not Jira's, so the
   * same pair always produces the same string (a consumer may group on it).
   *
   * @param {*} raw  fields[CONFIGJ.REGION_FIELD] — array, option object, or string
   * @returns {string} e.g. "AMER", "AMER | SEA"; "" when empty or unset.
   */
  function jbRegionValue_(raw) {
    if (!raw) return "";
    var opts = Array.isArray(raw) ? raw : [raw];
    var seen = {}, out = [];
    opts.forEach(function(opt) {
      if (!opt) return;
      var label = String(typeof opt === "object"
        ? (opt.value || opt.name || "") : opt).trim();
      if (!label) return;
      var token = REGION_VOCAB_[label] || label;
      if (seen[token]) return;
      seen[token] = true;
      out.push(token);
    });
    if (out.length < 2) return out.join("");
    out.sort(function(a, b) {
      var ia = REGION_ORDER_.indexOf(a), ib = REGION_ORDER_.indexOf(b);
      if (ia === -1 && ib === -1) return a < b ? -1 : (a > b ? 1 : 0);
      if (ia === -1) return 1;   // unknown tokens sort last
      if (ib === -1) return -1;
      return ia - ib;
    });
    return out.join(" | ");
  }

  /**
   * Display label for any single- or multi-select custom field that has no
   * vocabulary of its own (the candidate Region/Team/Workstream columns).
   * Same array-first rule as jbRegionValue_, and the same shape tolerance as
   * jbTeamValue_ — an id-only value is returned as-is rather than dropped,
   * because a visible id is a fixable mapping problem and a blank cell is
   * indistinguishable from "not tagged".
   * @param {*} raw  any fields[customfield_…] value
   * @returns {string} joined label(s), or "" when empty or unset.
   */
  function jbOptionLabel_(raw) {
    if (!raw) return "";
    var opts = Array.isArray(raw) ? raw : [raw];
    var seen = {}, out = [];
    opts.forEach(function(opt) {
      if (!opt) return;
      var label = typeof opt === "object"
        ? String(opt.value || opt.name || opt.title || opt.id || "").trim()
        : String(opt).trim();
      if (!label || seen[label]) return;
      seen[label] = true;
      out.push(label);
    });
    return out.join(" | ");
  }

  /**
   * Display name for an issue's Atlassian Team field value. The Team picker has
   * returned several shapes across Jira versions — an object with .name, an
   * object with .title, or a bare team id string — so all three are handled and
   * an id-only value is returned as-is rather than dropped (a visible id is a
   * fixable mapping problem; a blank column looks like "no team").
   * @param {*} raw  fields[CONFIGJ.TEAM_FIELD]
   * @returns {string} team name/id, or "" when the field is empty or unset.
   */
  function jbTeamValue_(raw) {
    if (!raw) return "";
    if (typeof raw === "string") return raw.trim();
    // Array-tolerant for the same reason jbRegionValue_ is: a picker that looks
    // single-valued in the UI can still come back as a one-element array, and
    // reading .name off an array yields "" with no error. Verified live
    // 2026-08-04: this field returns a bare object {id, name, title} —
    // real values on this site are "Harbour", "Laneway", "Solution Architect".
    if (Array.isArray(raw)) return jbOptionLabel_(raw);
    return String(raw.name || raw.title || raw.value || raw.id || "").trim();
  }

  // ============================================================
  // 🎨  COMPANY BRAND PALETTE — Do not modify
  // ============================================================
  const COLORS = {
    VOID_BLUE:   "#0F1941",
    ORBE_BLUE:   "#058CDC",
    IVORY:       "#DCCDBE",
    LIGHT_CREAM: "#FFFAF5",
    ROYAL:       "#2864E6",
    JUNE:        "#FF9B87",
  };

  // ============================================================
  // 🔤  NAME MAPPING (Jira -> Roster)
  // ============================================================
  // Relies on the global _NAME_CACHE and NAME_MAPS defined in 
  // "Hours Analysis.js" / "@Change Names.js" to avoid redeclaration errors.

  function normalizeToRoster_(name) {
    if (!name) return "";
    const trimmed = String(name).trim();

    // 1. Prioritise direct mapping from @Change Names.js (NAME_MAPST.TEMPO)
    if (typeof NAME_MAPST !== 'undefined' && NAME_MAPST.TEMPO) {
      var directMap = NAME_MAPST.TEMPO[trimmed];
      if (directMap) return directMap;
    }

    // 2. Fallback to global _NAME_CACHE if available (from Hours Analysis.js)
    if (typeof _NAME_CACHE !== 'undefined') {
      // The global cache usually keys by lowercase or normalized names.
      return _NAME_CACHE[trimmed.toLowerCase()] || trimmed;
    }

    return trimmed;
  }


  // ============================================================
  // 🧠  BEHAVIORAL ANALYSIS DICTIONARY
  // Maps keywords to ServiceRocket Leadership Behaviors
  // ============================================================
  const BEHAVIOR_KEYWORDS = {
    "Team Builder": {
      id: "1.3",
      keywords: ["help", "support", "thanks", "great job", "team", "together", "appreciate", "collaborate", "shoutout"],
      description: "Connects deeply with others and creates a positive climate."
    },
    "Deliberate/Decisive": {
      id: "7.1",
      keywords: ["blocker", "decided", "moving forward", "priority", "focused on", "action", "resolved", "bottleneck"],
      description: "Directly addresses issues and is efficient at decision making."
    },
    "Proactive & Responsive": {
      id: "9.4",
      keywords: ["update", "resolved early", "opportunity", "ahead of schedule", "seize", "proactive", "responsive"],
      description: "Able to respond and seize opportunities; master of cadence."
    },
    "Accountable": {
      id: "10.1",
      keywords: ["delayed", "my bad", "owning", "fixed", "confirmed", "commitment", "responsible", "sorry"],
      description: "Dependable and communicates effectively when unable to deliver."
    }
  };

  /**
   * Analyzes a compiled comment string for behavioral signals based on keywords.
   * Returns an object with counts for each behavioral category.
   */
  function analyzeComments_(commentStr) {
    const scores = {};
    Object.keys(BEHAVIOR_KEYWORDS).forEach(cat => scores[cat] = 0);
    
    if (!commentStr) return scores;
    
    const lowerComment = commentStr.toLowerCase();
    
    Object.keys(BEHAVIOR_KEYWORDS).forEach(category => {
      const data = BEHAVIOR_KEYWORDS[category];
      data.keywords.forEach(keyword => {
        // Use regex with word boundaries to avoid partial matches (e.g., "team" in "steam")
        const regex = new RegExp("\\b" + keyword + "\\b", "gi");
        const matches = lowerComment.match(regex);
        if (matches) {
          scores[category] += matches.length;
        }
      });
    });
    
    return scores;
  }

  // ── SECTION: HELPERS ─────────────────────────────────────────

  // NOTE (v3.5.0): the Capacity / Tempo Transposed / Planned Time Tempo /
  // Time Off readers used to live here. They were removed — this script is a
  // Jira EXPORTER, and every consumer now joins Tempo, capacity and PTO itself
  // straight off the Jira Raw sheet plus its own sources. Two of them
  // (readCapacity_, readTimeOff_) also collided by name with globals in
  // Hours Analysis.js, and GAS shares one namespace across a project.
  // The Roster reader (readTargetedRoster_) deliberately STAYS: Exec Q&A's
  // engagement rate and runDebugRosterMatching() both need it.

  function buildHeaders_() {
    const token = getAPI__Jira();
    return {
      "Authorization": "Basic " + Utilities.base64Encode(CONFIGJ.JIRA_EMAIL + ":" + token),
      "Accept":        "application/json",
      "Content-Type":  "application/json",
    };
  }

  /**
   * Returns the Monday (00:00 local) of a given ISO week.
   * Jan 4 is always inside ISO week 1, so W1's Monday anchors the math.
   * jb_ prefix: TempoCapacityTime.js defines a global mondayOfIsoWeek_(isoLabel)
   * with a different signature — GAS shares one namespace across files, and the
   * unprefixed name got shadowed (label-parser received the year 2026 → threw).
   */
  function jb_mondayOfIsoWeek_(year, week) {
    var jan4 = new Date(year, 0, 4);
    var mon = new Date(jan4);
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
    mon.setHours(0, 0, 0, 0);
    return mon;
  }

  /**
   * Returns the org-standard ISO week label for a date — "2026.W27".
   * Inverse of jb_mondayOfIsoWeek_. Mirrors isoWeekLabel_() in
   * TempoPlanExport.js so the Jira Raw "Week" column, the Tempo tracked /
   * planned / capacity exports, and the dashboards that join them all speak
   * one vocabulary.
   *
   *   - Weeks start Monday; week 1 is the week containing Jan 4 (first Thursday).
   *   - The year prefix is the ISO week-year taken from the week's Thursday, so
   *     late-Dec / early-Jan dates land in the adjacent year where ISO says they
   *     belong (2026-12-31 → "2027.W01").
   *   - The week number is zero-padded to two digits (W01–W53), which also makes
   *     the labels sort lexically.
   *
   * jb_ prefix: PS_Post.js and TempoPlanExport.js both define a global
   * isoWeekLabel_ — same convention as jb_mondayOfIsoWeek_ above, keeping this
   * file independent of whichever copy wins GAS's shared namespace.
   *
   * ⚠️ PADDING DIVERGENCE — this pads to two digits ("2026.W05"); the delivery-
   * health dashboard's weekKeyFromDate_ (Code.js) is
   * `isoWeekYear_(d) + ".W" + isoWeekNum_(d)` and does NOT pad ("2026.W5").
   * The two agree for W10–W53 and disagree for W01–W09. Nothing joins on the
   * Week column across the two systems today — the dashboard derives its own
   * ISO week from the Resolution Date and never reads this column — so the
   * mismatch is currently inert. If a cross-system Week join is ever added,
   * normalise BOTH sides to the unpadded form first. This will not surface
   * until the 52-week window rolls into W01–W09 (January).
   *
   * @param {Date} date  Any day inside the target week (typically the Monday).
   * @returns {string} e.g. "2026.W27"
   */
  function jb_isoWeekLabel_(date) {
    // UTC throughout so DST shifts can't push a Monday into the prior week.
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

    // Thursday of this week — its calendar year IS the ISO week-year.
    var dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    var isoYear = d.getUTCFullYear();

    // Thursday of ISO week 1 (the week containing Jan 4).
    var firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    var firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

    var week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return isoYear + ".W" + String(week).padStart(2, "0");
  }

  function getLastNWeeks_(n) {
    n = n || CONFIGJ.WEEKS_BACK;
    const today = new Date();

    // Find the Monday that started the CURRENT week (Mon–Sun boundary)
    const daysSinceMonday = (today.getDay() + 6) % 7; // Mon=0, Tue=1, … Sun=6
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysSinceMonday);
    thisMonday.setHours(0, 0, 0, 0);

    // START_ISO_WEEK override — anchor the window to a fixed calendar week
    // (e.g. "2026.W14") and run through the last completed week.
    if (CONFIGJ.START_ISO_WEEK) {
      var m = /^(\d{4})\.W(\d{1,2})$/.exec(String(CONFIGJ.START_ISO_WEEK).trim());
      if (m) {
        var startMon = jb_mondayOfIsoWeek_(Number(m[1]), Number(m[2]));
        var span = Math.round((thisMonday - startMon) / (7 * 86400000));
        if (span > 0) {
          n = span;
          Logger.log("📅 START_ISO_WEEK " + CONFIGJ.START_ISO_WEEK + " → " + n +
                     " completed weeks (" + toIsoDate_(startMon) + " onward).");
        } else {
          Logger.log("⚠️ START_ISO_WEEK " + CONFIGJ.START_ISO_WEEK +
                     " is not a past week — falling back to WEEKS_BACK.");
        }
      } else {
        Logger.log("⚠️ START_ISO_WEEK \"" + CONFIGJ.START_ISO_WEEK +
                   "\" invalid (expected \"YYYY.WN\") — falling back to WEEKS_BACK.");
      }
    }

    var weeks = [];
    for (var i = 1; i <= n; i++) {
      var mon = new Date(thisMonday);
      mon.setDate(thisMonday.getDate() - i * 7);
      mon.setHours(0, 0, 0, 0);
      
      var sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);

      var nextMon = new Date(mon);
      nextMon.setDate(mon.getDate() + 7);
      nextMon.setHours(0, 0, 0, 0);

      weeks.unshift({
        label:      jb_isoWeekLabel_(mon),
        from:       mon,
        to:         sun,
        fromStr:    toIsoDate_(mon),
        toStr:      toIsoDate_(sun),
        nextMonStr: toIsoDate_(nextMon) // for exclusive JQL bounds
      });
    }
    return weeks;
  }

  function toIsoDate_(d) {
    return d.getFullYear()
      + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0");
  }

  function toShortDate_(d) {
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }

  function fmtDateTime_(val) {
    if (!val) return "";
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d)) return "";
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear()
      + " " + String(d.getHours()).padStart(2, "0")
      + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function dig_(obj, path) {
    return path.split(".").reduce(function(o, k) {
      return (o && o[k] != null) ? o[k] : null;
    }, obj);
  }

  function jb_getOrCreateSheet_(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName(name) || ss.insertSheet(name);
  }

  /**
   * Reads the Roster sheet to determine the total headcount of the Delivery Team.
   * Uses CONFIGJ.TARGET_PROFILES to filter for targeted individual contributors.
   * Returns an object with { count: number, names: Set<string> }
   */
  function readTargetedRoster_() {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.ROSTER_SHEET);
    const result = { count: 0, names: {} };

    if (!sh) {
      Logger.log("⚠️ Roster sheet not found. Cannot determine targeted headcount.");
      return result;
    }

    const raw = sh.getDataRange().getValues();
    if (raw.length <= 1) return result;

    const headers = raw[0].map(h => String(h || "").trim());
    const f_nameIdx = headers.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h));
    const f_titleIdx = headers.findIndex(h => /job title|title|profile/i.test(h));

    const nameIdx = f_nameIdx !== -1 ? f_nameIdx : 3;
    const titleIdx = f_titleIdx !== -1 ? f_titleIdx : 6;

    for (let i = 1; i < raw.length; i++) {
      const rawName = String(raw[i][nameIdx] || "").trim();
      const title = String(raw[i][titleIdx] || "").trim();

      if (!rawName || rawName.toLowerCase() === "name" || rawName.length < 3) continue;

      // Check if the title exactly matches one of our targeted profiles
      const isTargeted = CONFIGJ.TARGET_PROFILES.includes(title);

      if (isTargeted) {
        result.count++;
        // Store the normalized name to cross-reference with Jira
        result.names[normalizeToRoster_(rawName)] = true;
      }
    }

    Logger.log("✅ Total Targeted Roster Headcount: " + result.count);
    return result;
  }

  /**
   * Recursively extracts plain text from Atlassian Document Format (ADF) used in Jira v3 API.
   */
  function extractTextFromADF_(node) {
    if (!node) return "";
    if (typeof node === 'string') return node;
    if (node.type === "text") return node.text || "";
    if (node.content && Array.isArray(node.content)) {
      var text = node.content.map(extractTextFromADF_).join("");
      if (node.type === "paragraph" || node.type === "heading") return text + "\n";
      return text;
    }
    return "";
  }

  function styleHeader_(range) {
    range
      .setBackground(COLORS.VOID_BLUE)
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(12)
      .setFontFamily("Arial")
      .setVerticalAlignment("middle");
  }

  // ── SECTION: JIRA FETCH ───────────────────────────────────────

  /**
   * Parses a response body as JSON without throwing, returning the evidence
   * needed to tell a TRUNCATED body apart from a genuinely malformed one.
   *
   * Why this exists: Jira and Tempo both occasionally answer 200 with a body
   * that stops mid-array. JSON.parse then dies with
   *   "Expected ',' or ']' after array element in JSON at position 679018"
   * where the position is simply however many characters arrived — it reads
   * like corrupt data, but it's a short read, and the bare SyntaxError names
   * neither the endpoint nor the page. Callers use the {ok:false} result to
   * retry the same cursor with a smaller page (fat pages truncate, small ones
   * don't) and log which call it was.
   *
   * @param {HTTPResponse} resp  a muteHttpExceptions response, code already checked
   * @param {string} what        human label for logs, e.g. "Jira search/jql page"
   * @returns {{ok:boolean, data:Object|null, len:number, tail:string, err:string}}
   */
  function jb_tryParseJson_(resp, what) {
    var txt = "";
    try {
      txt = resp.getContentText();
    } catch (e) {
      return { ok: false, data: null, len: 0, tail: "", err: "getContentText failed: " + e.message };
    }
    try {
      return { ok: true, data: JSON.parse(txt), len: txt.length, tail: "", err: "" };
    } catch (e) {
      Logger.log("⚠️ " + what + ": unparseable body — " + e.message
        + " · received " + txt.length + " chars · tail: …" + txt.slice(-120));
      return { ok: false, data: null, len: txt.length, tail: txt.slice(-120), err: e.message };
    }
  }

  // Jira page size. Starts at JQL_PAGE_MAX and halves toward JQL_PAGE_MIN
  // whenever a body arrives truncated — the "comment" field makes page weight
  // wildly uneven (a handful of heavily-discussed issues can triple a page),
  // so the size that works is data-dependent and can't be picked up front.
  var JQL_PAGE_MAX = 100;
  var JQL_PAGE_MIN = 10;

  /**
   * Generic Jira search using cursor-based pagination (nextPageToken).
   * Uses /rest/api/3/search/jql endpoint. Filters out "to delete" issues.
   *
   * @param {string}   jql      the query
   * @param {string[]} [fields] field list override; defaults to CONFIGJ.JIRA_FIELDS.
   *                            Pass JIRA_FIELDS_NO_COMMENTS for queries whose rows
   *                            nobody reads comments off.
   */
  function fetchAllIssuesByJql_(jql, fields) {
    var fieldList = fields || CONFIGJ.JIRA_FIELDS;
    var headers = buildHeaders_();
    var url     = CONFIGJ.JIRA_BASE_URL + "/rest/api/3/search/jql";
    var all     = [];
    var maxResults = JQL_PAGE_MAX;
    var nextPageToken = null;

    while (true) {
      // One page, with shrink-and-retry on a truncated body. nextPageToken is a
      // POSITION, not a slice, so re-asking the same cursor for fewer issues is
      // safe and skips nothing. A shrink sticks for the rest of the run —
      // slower, but a run that finishes beats a run that dies at page 30.
      var data = null;
      for (var shrink = 0; data === null; shrink++) {
        var body = {
          jql:        jql,
          maxResults: maxResults,
          fields:     fieldList,
        };
        // Reopen detection needs each issue's status history, which only comes
        // back under expand=changelog. OFF by default: the changelog is a full
        // history per issue on an export whose pages already shrink-and-retry
        // because `comment` returns ADF trees, so this is a measured decision,
        // not a default. See CONFIGJ.FETCH_CHANGELOG.
        if (CONFIGJ.FETCH_CHANGELOG) body.expand = ["changelog"];
        if (nextPageToken) body.nextPageToken = nextPageToken;

        var resp = UrlFetchApp.fetch(url, {
          method:             "POST",
          headers:            headers,
          payload:            JSON.stringify(body),
          muteHttpExceptions: true,
        });

        var code = resp.getResponseCode();
        if (code === 401) throw new Error("❌ 401 Unauthorized — check JIRA_EMAIL and re-run setAPI__Jira().");
        if (code === 400) {
          var errParsed = jb_tryParseJson_(resp, "Jira 400 body");
          var err = errParsed.ok ? errParsed.data : {};
          throw new Error("❌ 400 Bad Request — " + JSON.stringify(err.errorMessages || err));
        }
        if (code !== 200) throw new Error("❌ Jira API error " + code + ": " + resp.getContentText().substring(0, 400));

        var parsed = jb_tryParseJson_(resp, "Jira search/jql page (maxResults=" + maxResults + ")");
        if (parsed.ok) { data = parsed.data; break; }

        if (maxResults > JQL_PAGE_MIN) {
          maxResults = Math.max(JQL_PAGE_MIN, Math.floor(maxResults / 2));
          Logger.log("   ↩️ retrying that page with maxResults=" + maxResults
            + " (comment-heavy issues make oversized pages)");
          Utilities.sleep(500 * (shrink + 1));
          continue;
        }
        throw new Error("❌ Jira returned a truncated body even at maxResults=" + JQL_PAGE_MIN
          + " — " + parsed.err + " (received " + parsed.len + " chars). One issue's payload is"
          + " likely oversized; check its comment history. Tail: …" + parsed.tail);
      }

      var issues = data.issues || [];
      all.push.apply(all, issues);

      Logger.log("   Fetched " + all.length + " issues so far…");

      nextPageToken = data.nextPageToken || null;
      if (!nextPageToken) break;
      if (issues.length === 0) break;
    }

    // Filter out "To delete" issues (contains, case-insensitive)
    return all.filter(function(i) {
      return !String(i.fields.summary || "").toLowerCase().includes("to delete");
    });
  }

  /**
   * Fetches current Work In Progress (WIP) to measure Active Engagement.
   * Looks for items that are currently "In Progress" with an assignee.
   */
  function fetchActiveWIP_() {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      CONFIGJ.WIP_JQL,
      'project NOT IN (TEMPLATE)',
      'assignee is not EMPTY',
      'summary !~ "to delete"'
    ].join(" AND ");
    
    Logger.log("📋 Active WIP JQL: " + jql);

    // Fetch and then filter by enabled spaces
    var all = fetchAllIssuesByJql_(jql);
    return all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
  }
  /**
   * Broad fetch — original working JQL that returns all Done issues
   * across all projects. Uses fetchAllIssuesByJql_ for pagination.
   */
  function fetchJiraIssues_(sinceStr) {
    // Default: rolling LOOKBACK_DAYS window. runJiraEpicTracker passes the
    // first week window's Monday so the fetch always covers every analysed week.
    if (!sinceStr) {
      var since = new Date();
      since.setDate(since.getDate() - CONFIGJ.LOOKBACK_DAYS);
      sinceStr = toIsoDate_(since);
    }
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");

    var jql = [
      'issuetype in (' + types + ')',
      CONFIGJ.DONE_JQL,
      'project NOT IN (TEMPLATE)',
      'resolutiondate >= "' + sinceStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ")
    + ' ORDER BY resolutiondate DESC';
    Logger.log("📋 JQL: " + jql);

    // Fetch, then filter by enabled spaces and drop non-delivery noise
    var all = fetchAllIssuesByJql_(jql);
    var scoped = all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
    var clean = scoped.filter(function(i) { return !isNoiseIssue_(i); });
    Logger.log("🧹 Noise filter: dropped " + (scoped.length - clean.length) +
               " of " + scoped.length + " issues (Canceled/Expired status or non-delivery resolution).");
    return clean;
  }

  /**
   * Fetches UNRESOLVED assigned issues — the open-backlog feed for the
   * delivery-health dashboard's per-person drill-down.
   *
   * Why a second query: fetchJiraIssues_ is scoped to statusCategory = Done, so
   * nothing in Jira Raw described work still in flight. The dashboard's
   * readJiraRaw_ picks these up by Status + an empty Resolution Date, so they
   * ride in the same sheet under the sentinel Week label "Open" — it never reads
   * the Week column, and the tile buckets ignore rows with no resolution date.
   *
   * Bounded by CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS: with no resolution date to
   * anchor on, an unbounded query returns every open assigned issue on the site
   * for all time, and abandoned tickets would inflate every person's backlog.
   *
   * @returns {Object[]} in-scope, non-noise open issues (empty when disabled).
   */
  function fetchOpenIssues_() {
    if (CONFIGJ.OPEN_BACKLOG_ENABLED === false) {
      Logger.log("ℹ️ Open-backlog feed disabled (CONFIGJ.OPEN_BACKLOG_ENABLED = false).");
      return [];
    }

    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var clauses = [
      'issuetype in (' + types + ')',
      'statusCategory != Done',
      'assignee is not EMPTY',
      'project NOT IN (TEMPLATE)',
      'summary !~ "to delete"'
    ];

    var staleWeeks = CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS;
    if (staleWeeks) {
      var since = new Date();
      since.setDate(since.getDate() - staleWeeks * 7);
      clauses.push('updated >= "' + toIsoDate_(since) + '"');
    }

    var jql = clauses.join(" AND ") + ' ORDER BY priority DESC';
    Logger.log("📋 Open-issues JQL (backlog): " + jql);

    // No comment bodies: nothing reads comments off a backlog row, and dropping
    // the field keeps this extra fetch cheap.
    var all = fetchAllIssuesByJql_(jql, JIRA_FIELDS_NO_COMMENTS);
    var open = all.filter(function(i) {
      return getSpaceForIssue_(i) !== null && !isNoiseIssue_(i);
    });
    Logger.log("   Open issues fetched: " + all.length + " → " + open.length +
               " in scope" + (staleWeeks ? " (updated within " + staleWeeks + " weeks)" : ""));
    return open;
  }

  /**
   * Returns true if a resolution name indicates the item was *not* actually
   * delivered (i.e. closed without shipping value). Used to compute
   * "Delivery Quality %" — throughput minus closed-but-not-shipped.
   */
  function isNonDelivery_(resolutionName) {
    if (!resolutionName) return false;
    var s = String(resolutionName).toLowerCase();
    return s === "won't do" || s === "wont do"
        || s === "duplicate" || s === "cannot reproduce"
        || s === "not a bug"  || s === "declined"
        || s === "rejected"   || s === "incomplete"
        || s === "known error"
        || s === "canceled"   || s === "cancelled"
        || s === "expired";
  }

  // Status names that mean the item was closed without delivering value —
  // statusCategory is still "Done", so JQL alone can't exclude them.
  var NOISE_STATUSES_ = { "canceled": true, "cancelled": true, "expired": true };

  /**
   * True when a Done-category issue carries no delivery value: closed via a
   * noise status (Canceled / Expired) or a non-delivery resolution (Won't Do,
   * Duplicate, Incomplete, Known Error, …). Filtered at the fetch so these
   * never reach Jira Raw or Exec Q&A.
   */
  function isNoiseIssue_(issue) {
    var f = issue.fields || {};
    var status = String(dig_(f, "status.name") || "").toLowerCase().trim();
    if (NOISE_STATUSES_[status]) return true;
    var resName = (f.resolution && f.resolution.name) || "";
    return isNonDelivery_(resName);
  }

  /**
   * Fetches issues CREATED inside a date window (for backlog-health "Added" metric).
   * Includes all statuses — we only care about creation date, not resolution.
   */
  function fetchCreatedIssues_(fromStr, toStr) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      'project NOT IN (TEMPLATE)',
      'created >= "' + fromStr + '"',
      'created <= "' + toStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY created DESC';
    Logger.log("📋 Created-issues JQL: " + jql);

    // Fetch and then filter by enabled spaces
    var all = fetchAllIssuesByJql_(jql);
    return all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
  }

  /**
   * Fetches issues RESOLVED inside a date window — the second half of the
   * Executive net-flow subtraction (v3.11.0).
   *
   * No assignee clause, deliberately, and it must stay that way: both halves of
   * "arrived minus cleared" have to describe the SAME population or the
   * subtraction is meaningless. Person-keyed arrivals also under-report the
   * newest weeks, because an issue filed unassigned only counts once somebody
   * picks it up — so a growing queue would read as flat exactly when it matters.
   *
   * Space-scoped only (v3.11.1) — matches fetchCreatedIssues_'s shape exactly,
   * which also filters space and nothing else. Noise (Won't Do / Duplicate /
   * Cancelled) is deliberately NOT filtered here: it's applied once, symmetrically
   * to both the created and resolved arrays, inside writeArrivals_ instead — see
   * that function's comment. Filtering noise independently on each half is how
   * the two populations drifted apart in the first place.
   */
  function fetchResolvedInWindow_(fromStr, toStr) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      'project NOT IN (TEMPLATE)',
      CONFIGJ.DONE_JQL,
      'resolutiondate >= "' + fromStr + '"',
      'resolutiondate <= "' + toStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY resolutiondate DESC';
    Logger.log("📋 Resolved-in-window JQL: " + jql);

    var all = fetchAllIssuesByJql_(jql, JIRA_FIELDS_NO_COMMENTS);
    return all.filter(function (i) {
      return getSpaceForIssue_(i) !== null;
    });
  }

  /**
   * Fetches Bug issues CREATED inside the deep window — the flow-metrics
   * Bug Count feed (v3.9.0). A separate tab and a separate query on purpose:
   * Bug is not in EXEC_ISSUE_TYPES, and Bug rows inside Jira Raw would
   * silently move every consumer's On-Time/Throughput denominators.
   *
   * isNoiseIssue_ applies: a bug closed Won't Do / Duplicate / Canceled was a
   * report, not a defect (spec §3.7). Open bugs carry no noise status or
   * resolution and always pass.
   */
  function fetchBugsCreated_(sinceStr) {
    var jql = [
      'issuetype = Bug',
      'project NOT IN (TEMPLATE)',
      'created >= "' + sinceStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY created DESC';
    Logger.log("📋 Bugs-created JQL: " + jql);

    // No comment bodies — nothing reads comments off a bug-count row.
    var all = fetchAllIssuesByJql_(jql, JIRA_FIELDS_NO_COMMENTS);
    var scoped = all.filter(function(i) {
      return getSpaceForIssue_(i) !== null && !isNoiseIssue_(i);
    });
    Logger.log("🐛 Bugs fetched: " + all.length + " → " + scoped.length +
               " in scope (disabled spaces + noise excluded).");
    return scoped;
  }

  /**
   * Determines the Space key for an issue based on its project key or name.
   * Matches against CONFIGJ.SPACES[].match array.
   *
   * Return contract:
   *   null            → the issue matched a space with enabled:false (R&D today).
   *                     THIS IS THE ONLY EXCLUSION — callers drop these issues.
   *   space.key       → matched an enabled configured space (e.g. "COE").
   *   client name     → project key found in CUSTOMER_PROJECT_MAP.
   *   project key     → matched nothing (v3.4.0; was the generic "Customer").
   *                     An unmapped client project is now identifiable in Jira
   *                     Raw instead of blending into one "Customer" blob.
   *
   * Note this function never excluded "projects outside COE/R&D/Customer" —
   * unmatched projects have always fallen through to the last branch.
   */
  function getSpaceForIssue_(issue) {
    var f = issue.fields || {};
    var projKey  = (dig_(f, "project.key")  || "").toUpperCase();
    // normalizeName_ is a CROSS-FILE global defined in "Contribution Report.js"
    // (lowercase + collapse whitespace + trim). GAS shares one namespace across
    // the project, so it resolves at runtime — but this file will not run
    // standalone without it. Do NOT add a local copy: a second declaration of
    // the same top-level name breaks the whole project at load.
    var projName = normalizeName_(dig_(f, "project.name") || "");

    if (!projKey && !projName) return "Customer";

    for (var i = 0; i < CONFIGJ.SPACES.length; i++) {
      var space = CONFIGJ.SPACES[i];
      var matches = space.match;
      for (var j = 0; j < matches.length; j++) {
        var m = matches[j];
        var mNorm = normalizeName_(m);
        var mKey  = m.toUpperCase();
        
        // Match against project key OR normalized project name
        if (mKey === projKey || mNorm === projName) {
          // If the space is explicitly disabled, return null to signal exclusion
          if (space.enabled === false) return null;
          return space.key;
        }
      }
    }
    // Known client projects surface the actual client name so the Exec Space
    // column differentiates customers instead of one "Customer" blob; unmapped
    // ones fall back to their project key for the same reason (v3.4.0).
    var clientName = CONFIGJ.CUSTOMER_PROJECT_MAP && CONFIGJ.CUSTOMER_PROJECT_MAP[projKey];
    return clientName || projKey || "Other";
  }

  /**
   * Collapses client-named customer spaces (CUSTOMER_PROJECT_MAP values) back
   * to the generic "Customer" key for aggregations that bucket by
   * COE / R&D / Customer. Configured space keys pass through unchanged.
   */
  function scopeForSpace_(space) {
    if (!space) return space;
    var configured = CONFIGJ.SPACES.some(function(s) { return s.key === space; });
    return configured ? space : "Customer";
  }

  /**
   * Returns the best "completion date" for an issue.
   * Prefers resolutiondate; falls back to statuscategorychangedate.
   */
  function getCompletedDate_(issue) {
    var f = issue.fields || {};
    return f.resolutiondate           ? new Date(f.resolutiondate)
        : f.statuscategorychangedate ? new Date(f.statuscategorychangedate)
        : null;
  }

  /**
   * Best-effort epic key for an issue: the classic Epic Link custom field,
   * or the parent key when the parent itself is an epic (team-managed
   * projects). Sub-tasks (parent = story) resolve transitively in
   * rollupTempoToEpics_; here they return "".
   */
  function resolvedEpicKey_(f) {
    if (f[CONFIGJ.EPIC_LINK_FIELD]) return f[CONFIGJ.EPIC_LINK_FIELD];
    var pType = String(dig_(f, "parent.fields.issuetype.name") || "").toLowerCase();
    if (pType.indexOf("epic") !== -1) return (f.parent && f.parent.key) || "";
    return "";
  }

  /**
   * Fetches all child issues (Stories, Tasks, Sub-tasks) of the given epic
   * keys, in ANY status — classic projects link children via "Epic Link"
   * (CONFIGJ.EPIC_LINK_FIELD), team-managed projects via parent. Keys are
   * batched to keep the JQL under the length limit; if the "Epic Link" field
   * name isn't valid on this site, the batch retries with parent-only JQL.
   * Returns a flat array of Jira issue objects.
   */
  function fetchChildrenForEpics_(epicKeys) {
    if (!epicKeys || !epicKeys.length) return [];
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var all = [];
    var BATCH = 50;
    Logger.log("🔗 Fetching children for " + epicKeys.length + " epics…");
    for (var i = 0; i < epicKeys.length; i += BATCH) {
      var keyList = epicKeys.slice(i, i + BATCH)
        .map(function(k) { return '"' + k + '"'; }).join(", ");
      var base = [
        'issuetype in (' + types + ')',
        'project NOT IN (TEMPLATE)',
        'summary !~ "to delete"'
      ];
      var jqlBoth = base
        .concat(['("Epic Link" in (' + keyList + ') OR parent in (' + keyList + '))'])
        .join(" AND ") + " ORDER BY created ASC";
      try {
        all = all.concat(fetchAllIssuesByJql_(jqlBoth));
      } catch (e) {
        Logger.log('⚠️ "Epic Link" JQL failed (' + e.message + ') — retrying batch with parent-only.');
        var jqlParent = base
          .concat(['parent in (' + keyList + ')'])
          .join(" AND ") + " ORDER BY created ASC";
        all = all.concat(fetchAllIssuesByJql_(jqlParent));
      }
    }
    Logger.log("   → " + all.length + " child issues found.");
    return all;
  }

  /**
   * Builds a JQL query for completed work in a specific Space + week window.
   */
  function buildCompletedWorkJql_(spaceJql, week) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    return [
      "(" + spaceJql + ")",
      "issuetype in (" + types + ")",
      CONFIGJ.DONE_JQL,
      'resolved >= "' + week.fromStr + '"',
      'resolved < "' + week.toStr + '"',
      'summary !~ "to delete"',
      "project not in (TEMPLATE)",
      "assignee is not EMPTY",
    ].join(" AND ");
  }

  /**
   * Fetches completed issues for each Space × Week combination.
   * Returns [{label, space, jql, issues}].
   */
  function fetchWeeklyData_(weeks) {
    var weeklyData = [];
    weeks.forEach(function(week) {
      CONFIGJ.SPACES.forEach(function(space) {
        var jql = buildCompletedWorkJql_(space.jql, week);
        Logger.log("📋 JQL [" + space.key + " | " + week.label + "]: " + jql);
        var issues = fetchAllIssuesByJql_(jql);
        issues.forEach(function(i) {
          i.__spaceKey  = space.key;
          i.__weekLabel = week.label;
        });
        weeklyData.push({
          label:  week.label,
          space:  space.key,
          jql:    jql,
          issues: issues,
        });
      });
    });
    return weeklyData;
  }

  // ── SECTION: TEMPO WORKLOG ENRICHMENT ─────────────────────────

  /**
   * Fetches Tempo worklogs for the already-fetched Jira issues and rolls
   * them up per issue key, so Jira Raw can connect Fix Version (engagement /
   * SRSO code) → issue → actual hours per person.
   *
   * Uses POST /4/worklogs/search (batched issue ids, offset pagination).
   * Tempo v4 returns only numeric issue ids and author accountIds — issue
   * keys come from the in-memory issues, author names are resolved via Jira
   * and normalised to roster names so they match the Assignee column.
   *
   * Reuses the TEMPO_API_TOKEN stored by storeCredentials() (TempoPlanExport.js).
   * Skips gracefully (empty result) when the token is absent.
   *
   * @param {Object[]} issues  Jira issue objects (need .id and .key).
   * @returns {Object} issueKey → { totalHrs, contributors: Object<name, hrs> }
   */
  function fetchTempoWorklogsForIssues_(issues) {
    var tempoToken = PropertiesService.getScriptProperties().getProperty("TEMPO_API_TOKEN");
    if (!tempoToken) {
      Logger.log("⚠️ TEMPO_API_TOKEN not found — skipping Tempo worklog enrichment. Run storeCredentials() to enable.");
      return {};
    }

    // Tempo v4 identifies issues by numeric id only — map back to keys here.
    var idToKey = {};
    issues.forEach(function(iss) {
      if (iss.id && iss.key) idToKey[String(iss.id)] = iss.key;
    });
    var issueIds = Object.keys(idToKey).map(Number);
    if (!issueIds.length) return {};

    var byIssue   = {}; // issueKey → { totalHrs, byAuthor: accountId → hrs }
    var authorIds = {};
    // PAGE halves toward PAGE_MIN on a truncated body, same tactic as the Jira
    // fetch above — 1000 fat worklog objects is comfortably enough to produce a
    // several-hundred-KB response, and that is where short reads show up.
    var ID_BATCH = 100, PAGE = 1000, PAGE_MIN = 50;

    for (var b = 0; b < issueIds.length; b += ID_BATCH) {
      var batchIds = issueIds.slice(b, b + ID_BATCH);
      var offset = 0, hasMore = true;

      while (hasMore) {
        var results = null;
        while (results === null) {
          // Tempo throws transient 500s under load — retry 5xx/429 twice with
          // backoff; a failed page here silently drops a whole batch's hours.
          var resp, respCode;
          for (var attempt = 0; attempt < 3; attempt++) {
            if (attempt > 0) Utilities.sleep(500 * attempt);
            resp = UrlFetchApp.fetch(
              "https://api.tempo.io/4/worklogs/search?offset=" + offset + "&limit=" + PAGE,
              {
                method: "post",
                contentType: "application/json",
                headers: { "Authorization": "Bearer " + tempoToken, "Accept": "application/json" },
                payload: JSON.stringify({ issueIds: batchIds }),
                muteHttpExceptions: true,
              }
            );
            respCode = resp.getResponseCode();
            if (respCode === 200 || (respCode < 500 && respCode !== 429)) break;
          }

          if (respCode !== 200) {
            Logger.log("⚠️ Tempo worklogs/search HTTP " + respCode +
                       " (batch @" + b + ", after retries): " + resp.getContentText().slice(0, 300));
            results = []; hasMore = false; break;
          }

          var parsed = jb_tryParseJson_(resp, "Tempo worklogs/search (batch @" + b + ", limit=" + PAGE + ")");
          if (parsed.ok) { results = parsed.data.results || []; break; }

          if (PAGE > PAGE_MIN) {
            PAGE = Math.max(PAGE_MIN, Math.floor(PAGE / 2));
            Logger.log("   ↩️ retrying Tempo page @" + offset + " with limit=" + PAGE);
            Utilities.sleep(500);
            continue;
          }
          // Fail-soft, matching the HTTP-error path above: Tempo enrichment is
          // additive (hours columns go blank), so one bad batch must not take
          // the whole Jira Raw export down with it.
          Logger.log("⚠️ Tempo worklogs unreadable at limit=" + PAGE_MIN
            + " — dropping batch @" + b + " (" + batchIds.length + " issues). Their logged hours will be blank.");
          results = []; hasMore = false; break;
        }

        results.forEach(function(wl) {
          var key = idToKey[String(wl.issue && wl.issue.id)];
          if (!key) return;
          var hrs  = (wl.timeSpentSeconds || 0) / 3600;
          var acct = (wl.author && wl.author.accountId) || "unknown";
          if (!byIssue[key]) byIssue[key] = { totalHrs: 0, byAuthor: {} };
          byIssue[key].totalHrs += hrs;
          byIssue[key].byAuthor[acct] = (byIssue[key].byAuthor[acct] || 0) + hrs;
          authorIds[acct] = true;
        });

        // `hasMore &&` keeps an explicit stop from the HTTP-error / unreadable
        // paths above, instead of relying on their empty results to re-derive it.
        // offset advances by the CURRENT PAGE, so a mid-batch shrink leaves
        // neither a gap nor an overlap in the cursor.
        hasMore = hasMore && results.length >= PAGE;
        offset += PAGE;
        Utilities.sleep(150); // be kind to the Tempo API
      }
    }

    // Resolve author accountIds → display names once, then re-key each
    // issue's contributor map onto roster-normalised names.
    var nameMap = fetchJiraUserNames_(
      Object.keys(authorIds).filter(function(a) { return a !== "unknown"; })
    );
    Object.keys(byIssue).forEach(function(key) {
      var named = {};
      Object.keys(byIssue[key].byAuthor).forEach(function(acct) {
        var name = normalizeToRoster_(nameMap[acct] || acct);
        named[name] = (named[name] || 0) + byIssue[key].byAuthor[acct];
      });
      byIssue[key].contributors = named;
      delete byIssue[key].byAuthor;
    });

    return byIssue;
  }

  /**
   * Resolves Jira accountIds → displayName via /rest/api/3/user (fetchAll batches).
   * @param {string[]} accountIds
   * @returns {Object} accountId → displayName (falls back to the id itself)
   */
  function fetchJiraUserNames_(accountIds) {
    var nameMap = {};
    if (!accountIds.length) return nameMap;

    var headers = buildHeaders_();
    var requests = accountIds.map(function(id) {
      return {
        url: CONFIGJ.JIRA_BASE_URL + "/rest/api/3/user?accountId=" + encodeURIComponent(id),
        method: "get",
        headers: headers,
        muteHttpExceptions: true,
      };
    });

    var BATCH = 25;
    for (var b = 0; b < requests.length; b += BATCH) {
      var responses = UrlFetchApp.fetchAll(requests.slice(b, b + BATCH));
      responses.forEach(function(res, i) {
        var id = accountIds[b + i];
        try {
          nameMap[id] = res.getResponseCode() === 200
            ? (JSON.parse(res.getContentText()).displayName || id)
            : id;
        } catch (e) {
          nameMap[id] = id;
        }
      });
    }
    return nameMap;
  }

  /**
   * Rolls Tempo hours up to the epic level: an epic's own worklogs plus every
   * child's — and sub-task grandchild's, resolved via the child's parent —
   * so epic rows can show the true burn across the whole tree.
   *
   * @param {Object}   tempoMap  issueKey → { totalHrs, contributors } (fetchTempoWorklogsForIssues_)
   * @param {Object[]} issues    all issues headed for Jira Raw (epics + children)
   * @returns {Object} epicKey → { totalHrs: number, contributors: Object<name, hrs> }
   */
  function rollupTempoToEpics_(tempoMap, issues) {
    var directEpic = {}, parentOf = {}, isEpic = {};
    issues.forEach(function(issue) {
      var f = issue.fields || {};
      isEpic[issue.key] = String(dig_(f, "issuetype.name") || "").toLowerCase().indexOf("epic") !== -1;
      directEpic[issue.key] = resolvedEpicKey_(f);
      parentOf[issue.key] = (f.parent && f.parent.key) || "";
    });

    var rollup = {}, seen = {};
    issues.forEach(function(issue) {
      if (seen[issue.key]) return; // an issue can sit in more than one week group
      seen[issue.key] = true;
      var tempo = tempoMap[issue.key];
      if (!tempo) return;

      // Epic rows roll to themselves; sub-tasks without a direct epic link
      // fall back to their parent story's epic.
      var epicKey = isEpic[issue.key] ? issue.key
        : (directEpic[issue.key] || directEpic[parentOf[issue.key]] || "");
      if (!epicKey) return;

      if (!rollup[epicKey]) rollup[epicKey] = { totalHrs: 0, contributors: {} };
      rollup[epicKey].totalHrs += tempo.totalHrs;
      Object.keys(tempo.contributors || {}).forEach(function(name) {
        rollup[epicKey].contributors[name] =
          (rollup[epicKey].contributors[name] || 0) + tempo.contributors[name];
      });
    });
    return rollup;
  }

  // ── SECTION: SHEET WRITERS ────────────────────────────────────

  // Columns 0–14 are locked for backward compatibility (Contribution Report reads by index).
  // New columns appended at indices 15–32 — append-only, never insert.
  //
  // "Tempo This Week (hrs)" (was 31) stays REMOVED: Jira Raw rows are issues that
  // completed in PAST weeks, so a this-week burn column is structurally blank.
  //
  // Region (31) and Team (32) came back in v3.4.0 at NEW indices — they sat at
  // 32–33 before v3.3.0 dropped them, so an index-based reader written against
  // the pre-v3.3.0 layout would now be off by one. Nothing reads them by index:
  // the delivery-health dashboard resolves both BY HEADER (readJiraRaw_) and
  // guards on -1, so it picks up whichever layout the sheet currently has.
  //
  // As of v3.7.0 both columns carry DATA (Region 17%, Team 35% of the exported
  // population). The "expect both to export BLANK" note that stood here for two
  // releases was wrong: the field was populated all along and the reader was
  // dropping it. See jbRegionValue_ and CONFIGJ.REGION_FIELD.
  var RAW_HEADERS = [
    /* 0 */ "Week", /* 1 */ "Key", /* 2 */ "Work (Summary)",
    /* 3 */ "Workstream (Issue Type)", /* 4 */ "Space (Project)",
    /* 5 */ "Assignee", /* 6 */ "Reporter", /* 7 */ "Priority", /* 8 */ "Status",
    /* 9 */ "Created", /* 10 */ "Updated", /* 11 */ "Resolution Date",
    /* 12 */ "Due Date", /* 13 */ "Start Date", /* 14 */ "Fix Versions",
    /* 15 */ "Exec Space",
    /* 16 */ "Assignee AccountId",
    /* 17 */ "Epic Key",
    /* 18 */ "Parent Key",
    /* 19 */ "Completed Date",
    /* 20 */ "Labels",
    /* 21 */ "Components",
    /* 22 */ "Resolution",
    /* 23 */ "Original Estimate (sec)",
    /* 24 */ "Time Spent (sec)",
    /* 25 */ "Issue Links (count)",
    /* 26 */ "Tempo Logged (hrs)",
    /* 27 */ "Tempo Contributors",
    /* 28 */ "Epic Tempo Rollup (hrs)",
    /* 29 */ "Epic Tempo Contributors",
    /* 30 */ "Billing Type", // "Billable (SRSO)" | "Internal" | "Untagged"
    /* 31 */ "Region",       // CONFIGJ.REGION_FIELD, short form via REGION_VOCAB_
    /* 32 */ "Team",         // CONFIGJ.TEAM_FIELD (Atlassian Team picker)
    // ── Quality / Rework feed (v3.6.0) ──
    // APPEND-ONLY. Every consumer resolves Jira Raw columns BY HEADER NAME
    // (colIdx_ in the delivery-health reader, the same pattern elsewhere), so
    // adding to the end is safe and an older consumer simply doesn't see them.
    // Never insert into the middle — that is what made Region/Team move from
    // 32/33 to 31/32 and broke readers pinned to indices.
    /* 33 */ "Status Category",  // status.statusCategory.name — authoritative Done
    /* 34 */ "Rework Link",      // "Yes" when any issue link matches REWORK_LINK_RE
    /* 35 */ "Reopened",         // "Yes"/"No" from changelog; blank = not measured
    // ── Delivery phase (v3.7.0) ──
    // v3.10.0 (2026-08-06) RETIRED the two candidate attribution columns that
    // used to sit at 36–37 ("Region (Alt)" = customfield_11561, "Tempo Team" =
    // customfield_10065). They existed for ONE purpose — let the attribution
    // field be chosen off real sheet data rather than another probe — and that
    // choice has been made: REGION_FIELD/TEAM_FIELD (10047 / 10001) at ~34% each.
    // Re-measured live 2026-08-06: 4 and 7 issues site-wide respectively, i.e.
    // unchanged, and NOTHING in any consumer ever read either header. Keeping two
    // permanently blank columns teaches readers to expect blank columns.
    //
    // They are still MEASURED, just not exported: probeRegionTeamFields() reports
    // all five candidates against live Jira, which is the right home for "has
    // anyone started populating this yet" — it costs one query, not a column on
    // every row forever. If either ever overtakes its primary, the probe says so.
    //
    // ⚠️ Workstream MOVED 38 → 36. Safe, and verified before removing: every
    // consumer resolves Jira Raw BY HEADER (colIdx_), and nothing anywhere reads
    // columns 31+ by index — the index-pinned readers stop at 14. This is the one
    // deviation from the APPEND-ONLY rule above, and it is a deletion from the
    // TAIL, not an insertion into the middle.
    /* 36 */ "Workstream",     // CONFIGJ.WORKSTREAM_FIELD — delivery phase, not a team
  ];

  function issueToRow_(issue, weekLabel, spaceKey, tempoMap, epicTempoRollup) {
    var f = issue.fields || {};
    var assignee  = f.assignee || {};
    var completed = getCompletedDate_(issue);
    var epicKey   = resolvedEpicKey_(f);
    var parentKey = (f.parent && f.parent.key) || "";

    var labels    = (f.labels || []).join(", ");
    var comps     = (f.components || []).map(function(c){ return c.name; }).join(", ");
    var resName   = (f.resolution && f.resolution.name) ? f.resolution.name : "";
    var origEst   = Number(f.timeoriginalestimate || 0);
    var timeSpent = Number(f.timespent || 0);
    var linkCount = (f.issuelinks || []).length;

    // Tempo enrichment — actual logged hours per issue, all authors
    var tempo = tempoMap ? tempoMap[issue.key] : null;
    var tempoHrs = tempo ? Math.round(tempo.totalHrs * 10) / 10 : 0;
    var tempoContribs = tempo
      ? Object.keys(tempo.contributors)
          .sort(function(a, b) { return tempo.contributors[b] - tempo.contributors[a]; })
          .map(function(n) {
            return n + " (" + (Math.round(tempo.contributors[n] * 10) / 10) + "h)";
          })
          .join(", ")
      : "";

    // Epic-level Tempo rollup — populated on epic rows only (own + child hrs)
    var typeIsEpic = String(dig_(f, "issuetype.name") || "").toLowerCase().indexOf("epic") !== -1;
    var epicTempo = (typeIsEpic && epicTempoRollup) ? epicTempoRollup[issue.key] : null;
    var epicTempoHrs = epicTempo ? Math.round(epicTempo.totalHrs * 10) / 10 : "";
    var epicTempoContribs = epicTempo
      ? Object.keys(epicTempo.contributors)
          .sort(function(a, b) { return epicTempo.contributors[b] - epicTempo.contributors[a]; })
          .map(function(n) {
            return n + " (" + (Math.round(epicTempo.contributors[n] * 10) / 10) + "h)";
          })
          .join(", ")
      : "";

    // Billing classification from Fix Versions (same SRSO token rule as Exec Q&A)
    var fixNames = (f.fixVersions || []).map(function(v) { return v.name || ""; });
    var hasSRSO = fixNames.some(function(n) { return /\bSRSO\b|SRSO-/i.test(n); });
    var billingType = hasSRSO ? "Billable (SRSO)"
      : fixNames.length > 0 ? "Internal"
      : "Untagged";

    // Assignment hygiene — unassigned issues carry a visible flag so they
    // surface on any Jira Raw sort/filter without a separate debug run
    var assigneeName = normalizeToRoster_(dig_(f, "assignee.displayName") || "");

    // Issue-level region / team. Both carry real data as of v3.7.0 (17% and 35%
    // of the exported population respectively) — the blanks before that were a
    // multi-select reader bug, not an empty Jira field. Candidate alternatives
    // ride along in columns 36–38 so the choice is visible in the sheet.
    var regionVal = jbRegionValue_(f[CONFIGJ.REGION_FIELD]);
    var teamVal   = jbTeamValue_(f[CONFIGJ.TEAM_FIELD]);
    var workstream = jbOptionLabel_(f[CONFIGJ.WORKSTREAM_FIELD]);

    return [
      // ── Columns 0–14 (unchanged) ──
      weekLabel,
      issue.key,
      f.summary || "",
      dig_(f, "issuetype.name") || "",
      dig_(f, "project.name")   || "",
      assigneeName || "⚠️ UNASSIGNED",
      dig_(f, "reporter.displayName") || "",
      dig_(f, "priority.name") || "",
      dig_(f, "status.name")   || "",
      fmtDateTime_(f.created),
      fmtDateTime_(f.updated),
      fmtDateTime_(f.resolutiondate),
      fmtDateTime_(f.duedate),
      fmtDateTime_(f.customfield_10015),
      fixNames.join(", "),
      // ── Columns 15–25 ──
      spaceKey || "",
      assignee.accountId || "",
      epicKey,
      parentKey,
      completed ? fmtDateTime_(completed) : "",
      labels,
      comps,
      resName,
      origEst,
      timeSpent,
      linkCount,
      // ── Columns 26–27 (Tempo enrichment) ──
      tempoHrs,
      tempoContribs,
      // ── Columns 28–29 (epic rollup, epic rows only) ──
      epicTempoHrs,
      epicTempoContribs,
      // ── Column 30 (billing classification) ──
      billingType,
      // ── Columns 31–32 (issue-level region / team) ──
      regionVal,
      teamVal,
      // ── Columns 33–35 (quality / rework feed, v3.6.0) ──
      dig_(f, "status.statusCategory.name") || "",
      jbHasReworkLink_(f) ? "Yes" : "",
      jbReopenedFlag_(issue),
      // ── Column 36 (delivery phase, v3.7.0) ──
      workstream,
    ];
  }

  /**
   * True when any issue link is of a rework-ish type (CONFIGJ.REWORK_LINK_RE).
   *
   * `issuelinks` was already being fetched and reduced to a bare count, so this
   * costs nothing extra. Both directions count: an issue can be the source of a
   * "causes rework" link or its target, and either way it is entangled in
   * rework — the dictionary asks for work "linked as Rework", not for who
   * pointed at whom.
   */
  function jbHasReworkLink_(f) {
    var links = (f && f.issuelinks) || [];
    for (var i = 0; i < links.length; i++) {
      var t = links[i].type || {};
      // Match the type NAME plus both direction labels: sites commonly name the
      // type something neutral ("Problem/Incident") and put the meaning in the
      // inward/outward wording ("is caused by", "causes rework for").
      var hay = [t.name, t.inward, t.outward].filter(Boolean).join(" ");
      if (CONFIGJ.REWORK_LINK_RE.test(hay)) return true;
    }
    return false;
  }

  /**
   * "Yes" / "No" when the changelog was fetched, "" when it wasn't.
   *
   * The empty string is load-bearing: a consumer must be able to tell "this
   * issue was never reopened" from "nobody looked". Reporting an unmeasured
   * issue as "No" would silently deflate the Rework Rate — the exact failure the
   * dashboard's coverage gates exist to prevent.
   *
   * A reopen = any transition whose FROM value looks Done-ish
   * (CONFIGJ.REOPEN_FROM_DONE_RE) — i.e. the issue had reached Done and then
   * left it. Counted at most once per issue: the dictionary asks whether work
   * required rework, not how many times it bounced.
   */
  function jbReopenedFlag_(issue) {
    if (!CONFIGJ.FETCH_CHANGELOG) return "";
    var histories = dig_(issue, "changelog.histories");
    if (!histories) return "";            // expand didn't come back — not measured
    for (var i = 0; i < histories.length; i++) {
      var items = histories[i].items || [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (String(it.field || "").toLowerCase() !== "status") continue;
        if (CONFIGJ.REOPEN_FROM_DONE_RE.test(String(it.fromString || "").trim())) return "Yes";
      }
    }
    return "No";
  }

  function writeRawSheet_(weeklyData) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.RAW_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    // One Tempo batch pass across all weeks — issueToRow_ looks up by issue key
    var allIssues = [];
    weeklyData.forEach(function(w) {
      allIssues = allIssues.concat(w.issues);
    });
    Logger.log("⏱️ Fetching Tempo worklogs for " + allIssues.length + " issues...");
    var tempoMap = fetchTempoWorklogsForIssues_(allIssues);
    Logger.log("   Tempo worklogs found for " + Object.keys(tempoMap).length + " issues.");

    var epicTempoRollup = rollupTempoToEpics_(tempoMap, allIssues);
    Logger.log("   Epic Tempo rollup: " + Object.keys(epicTempoRollup).length + " epics with logged hours.");

    var rows = [RAW_HEADERS];
    weeklyData.forEach(function(w) {
      w.issues.forEach(function(issue) {
        rows.push(issueToRow_(issue, w.label, getSpaceForIssue_(issue), tempoMap, epicTempoRollup));
      });
    });

    sheet.getRange(1, 1, rows.length, RAW_HEADERS.length).setValues(rows);
    styleHeader_(sheet.getRange(1, 1, 1, RAW_HEADERS.length));
    sheet.setFrozenRows(1);

    var foot = rows.length + 2;
    sheet.getRange(foot, 1)
      .setValue("Generated: " + fmtDateTime_(new Date()))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);
    sheet.getRange(foot + 1, 1)
      .setValue("Total rows: " + (rows.length - 1))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);

    Logger.log("✅ Raw sheet: " + (rows.length - 1) + " data rows written.");
  }

  // APPEND-ONLY, same contract as RAW_HEADERS: consumers resolve columns by
  // header name, so new columns go at the END, never the middle.
  var BUGS_HEADERS = [
    /* 0 */ "Key", /* 1 */ "Summary", /* 2 */ "Project", /* 3 */ "Priority",
    /* 4 */ "Status", /* 5 */ "Status Category", /* 6 */ "Created",
    /* 7 */ "Resolution Date", /* 8 */ "Resolution", /* 9 */ "Assignee",
  ];

  function writeBugsSheet_(bugs) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.BUGS_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    var rows = [BUGS_HEADERS];
    bugs.forEach(function(issue) {
      var f = issue.fields || {};
      rows.push([
        issue.key,
        String(f.summary || ""),
        dig_(f, "project.key") || "",
        dig_(f, "priority.name") || "",
        dig_(f, "status.name") || "",
        dig_(f, "status.statusCategory.name") || "",
        fmtDateTime_(f.created),
        fmtDateTime_(f.resolutiondate),
        (f.resolution && f.resolution.name) || "",
        dig_(f, "assignee.displayName") || "",
      ]);
    });

    sheet.getRange(1, 1, rows.length, BUGS_HEADERS.length).setValues(rows);
    styleHeader_(sheet.getRange(1, 1, 1, BUGS_HEADERS.length));
    sheet.setFrozenRows(1);

    // Same "Generated:" footer convention as Jira Raw, so the dashboard's
    // staleness parse works identically on this tab.
    var foot = rows.length + 2;
    sheet.getRange(foot, 1)
      .setValue("Generated: " + fmtDateTime_(new Date()))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);
    sheet.getRange(foot + 1, 1)
      .setValue("Total rows: " + (rows.length - 1))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);

    Logger.log("✅ Jira Bugs: " + (rows.length - 1) + " rows written.");
  }

  /**
   * Appends ONE row per export run to the Flow Snapshots tab: timestamp,
   * ISO week, WIP count, backlog hrs, backlog item count, and (v3.11.0) the
   * unassigned half of the queue — unassigned open item count + unassigned
   * to-do hrs.
   *
   * APPEND-ONLY — never clearContents. A snapshot can't be recomputed later,
   * so this tab is the system of record for WIP/Backlog history. Rows older
   * than RAW_HISTORY_WEEKS are pruned on write (the shared 52-week dial).
   * New columns are appended at the END and every reader indexes by header
   * NAME, so rows written before v3.11.0 stay valid — they simply carry no
   * value for the two unassigned columns.
   *
   * The split follows the spec (§3.4/3.5) VERBATIM — non-epic, assigned,
   * unresolved; status category To Do = backlog (waiting), In Progress = WIP.
   * Backlog hours = max(0, Original Estimate − Time Spent). The dashboard
   * recomputes today's values from Jira Raw with the same rules; this row
   * exists only because history cannot be rebuilt. If the definition ever
   * changes, old rows stay as old-definition history (✎ definition changed).
   *
   * @param {Object[]} openCandidates raw Jira issues — the union of the
   *   open-backlog fetch and the epic-children fetch (the same open issues
   *   that reach Jira Raw), unresolved rows filtered here. Until a later task
   *   removes 'assignee is not EMPTY' from fetchOpenIssues_, this array
   *   contains no unassigned rows, so the two new columns legitimately read 0.
   */
  function writeFlowSnapshot_(openCandidates) {
    // APPEND-ONLY contract: new columns go on the END, and every reader indexes
    // by header NAME, so historical rows stay valid and simply carry no value
    // for columns that did not exist when they were written (v3.11.0).
    var FLOW_HEADERS = ["Generated", "ISO Week", "WIP Count", "Backlog Hrs", "Backlog Items",
                        "Unassigned Items", "Unassigned Hrs"];
    var sheet = jb_getOrCreateSheet_(CONFIGJ.FLOW_SNAP_SHEET);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, FLOW_HEADERS.length).setValues([FLOW_HEADERS]);
      styleHeader_(sheet.getRange(1, 1, 1, FLOW_HEADERS.length));
      sheet.setFrozenRows(1);
    }

    // Header MIGRATION, not just creation. This tab has existed since v3.9.0, so
    // getLastRow() is never 0 on a live sheet and the create-only branch above
    // never fires again — appending new columns would populate F/G under a row 1
    // that still names only the original five, and every colIdx_ lookup by the
    // new names would return -1 forever, silently killing the whole point of
    // Part A with nothing erroring. Append-only means new columns arrive over
    // time BY DESIGN, so the header has to be able to catch up. Only row 1 is
    // ever written here — the range is 1 row tall, so data rows are untouched.
    //
    // Widen only when the CURRENT row 1 is a strict prefix of FLOW_HEADERS —
    // i.e. nobody has hand-edited, reordered, or renamed the existing header
    // cells. If it isn't a clean prefix, log a warning and leave row 1 alone
    // rather than blindly overwrite someone's edits; the new columns still get
    // written by appendRow below, just unlabeled until a human reconciles it.
    var lastCol = sheet.getLastColumn();
    if (sheet.getLastRow() > 0 && lastCol > 0 && lastCol < FLOW_HEADERS.length) {
      var curHeader = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
      var isCleanPrefix = true;
      for (var hc = 0; hc < lastCol; hc++) {
        if (String(curHeader[hc]) !== FLOW_HEADERS[hc]) { isCleanPrefix = false; break; }
      }
      if (isCleanPrefix) {
        sheet.getRange(1, 1, 1, FLOW_HEADERS.length).setValues([FLOW_HEADERS]);
        styleHeader_(sheet.getRange(1, 1, 1, FLOW_HEADERS.length));
      } else {
        Logger.log("⚠️ Flow Snapshots header (" + curHeader.join(", ") + ") is not a " +
                   "clean prefix of FLOW_HEADERS — leaving row 1 untouched. New columns " +
                   "will be written but unlabeled until this is reconciled by hand.");
      }
    }

    var wip = 0, backlogHrs = 0, backlogN = 0;
    // The unassigned half of the queue. Reachable only because v3.11.0 dropped
    // 'assignee is not EMPTY' from fetchOpenIssues_ (spec D7) — before that
    // these rows were never fetched, which is why the dashboard reported a
    // 1,440-item queue when the true figure was 3,279.
    //
    // Hours are TO-DO ONLY, matching the dashboard's flowOpenBuckets_ /
    // queueSnapshot_ on both halves (Task 4 review): neither contributes
    // hours for In Progress work, so an "all open" figure here would put a
    // different population in the sheet than the dashboard computes from
    // Jira Raw, and the two would quietly disagree.
    //
    // Items counts To Do + In Progress ONLY, so this column equals
    // queueSnapshot_.unassigned.items on the dashboard side EXACTLY (u.items =
    // u.wipN + u.todoN there). A row in neither category is a status-hygiene
    // oddity, not inventory; the dashboard tallies those separately as
    // `uncategorized`, and counting them here would make the measured
    // snapshot series step away from the series it is meant to be the
    // measured continuation of — the "sheet and dashboard quietly disagree
    // about the same number" failure this whole log exists to prevent.
    //
    // Folded into the SAME pass as wip/backlogN/backlogHrs above (rather than
    // a second forEach over openCandidates) so both halves share one "open"
    // definition — epic-excluded, unresolved, not Done — instead of drifting
    // if the two loops' guards are ever edited independently.
    var unItems = 0, unHrs = 0;
    openCandidates.forEach(function(issue) {
      var f = issue.fields || {};
      if (String(dig_(f, "issuetype.name") || "").toLowerCase().indexOf("epic") !== -1) return;
      if (f.resolutiondate) return;   // resolved-outside-window epic children
      var cat = String(dig_(f, "status.statusCategory.name") || "");
      if (/^done$/i.test(cat)) return;
      if (!dig_(f, "assignee.displayName")) {
        if (/in progress/i.test(cat)) { unItems++; return; }
        if (/to do/i.test(cat)) {
          unItems++;
          var uEst   = Number(f.timeoriginalestimate || 0);
          var uSpent = Number(f.timespent || 0);
          unHrs += Math.max(0, uEst - uSpent) / 3600;
        }
        // any other category (custom): a status-hygiene oddity, not counted —
        // mirrors queueSnapshot_'s `uncategorized` split on the unassigned side.
        return;
      }
      if (/in progress/i.test(cat)) { wip++; return; }
      if (/to do/i.test(cat)) {
        backlogN++;
        var est   = Number(f.timeoriginalestimate || 0);
        var spent = Number(f.timespent || 0);
        backlogHrs += Math.max(0, est - spent) / 3600;
      }
      // any other category (custom): measured as neither — same rule as the
      // dashboard's flowOpenBuckets_, so the two stay reconcilable.
    });

    // Prune BEFORE appending so the tab never grows past the retained window.
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CONFIGJ.RAW_HISTORY_WEEKS * 7);
    var vals = sheet.getDataRange().getValues();
    for (var r = vals.length - 1; r >= 1; r--) {
      var d = new Date(vals[r][0]);
      if (!isNaN(d.getTime()) && d < cutoff) sheet.deleteRow(r + 1);
    }

    sheet.appendRow([
      fmtDateTime_(new Date()),
      jb_isoWeekLabel_(new Date()),
      wip,
      Math.round(backlogHrs * 10) / 10,
      backlogN,
      unItems,
      Math.round(unHrs * 10) / 10,
    ]);
    Logger.log("🌊 Flow snapshot: WIP " + wip + ", backlog " +
               (Math.round(backlogHrs * 10) / 10) + "h across " + backlogN + " items, " +
               "unassigned " + unItems + " (" + (Math.round(unHrs * 10) / 10) + "h to-do).");
  }

  /**
   * Writes the Jira Arrivals tab: one row per ISO week with org-wide created and
   * resolved counts, plus how many of the created are still unassigned.
   *
   * FULL REWRITE per run (unlike Flow Snapshots, which appends): these are
   * counts over date fields, so they are recomputable from Jira at any time and
   * a rewrite keeps the tab self-healing after a partial run.
   *
   * ── Week Start is a CALENDAR DATE, shipped as a "yyyy-mm-dd" STRING ──
   * Not a label — jb_isoWeekLabel_ zero-pads ("2026.W07"); the dashboard's
   * weekKeyFromDate_ does not ("2026.W7"). Writing a label here would silently
   * fail to join for weeks 1-9, so this ships the week's Monday and lets the
   * dashboard own week labelling — exactly as the Jira Bugs tab ships raw
   * Created dates for parseBugRows_ to bucket.
   *
   * And not a Date OBJECT either (v3.11.1 fix) — Apps Script serializes a Date
   * to a cell using the SCRIPT's timezone. `keyOf_` below already derives the
   * correct calendar day via `.toISOString()`, which the ES spec fixes to UTC
   * regardless of the running environment; wrapping that string back into
   * `new Date(k + "T00:00:00Z")` reintroduced the exact bug this exists to avoid
   * — a UTC-midnight INSTANT that a behind-UTC script timezone then reads back
   * as the previous calendar day, bucketing the row one ISO week early. `k` is
   * already the right string — write it as-is, never re-wrap it in a Date.
   */
  function writeArrivals_(createdIssues, resolvedIssues) {
    var HEADERS = ["Week Start", "Created", "Resolved", "Created Unassigned"];
    var sheet = jb_getOrCreateSheet_(CONFIGJ.ARRIVALS_SHEET);

    // Both halves must describe the SAME population or "arrived minus cleared"
    // is meaningless. fetchCreatedIssues_ is shared with Exec Q&A and applies no
    // noise filter, so filter here rather than upstream: a ticket closed Won't Do
    // / Duplicate / Cancelled was never delivery work, and counting it as an
    // arrival that can never be cleared inflates net flow forever. Filtered on
    // both arrays, in this one place, so the two halves can't drift apart again.
    var createdClean = (createdIssues || []).filter(function (i) { return !isNoiseIssue_(i); });
    var resolvedClean = (resolvedIssues || []).filter(function (i) { return !isNoiseIssue_(i); });

    // Monday of the ISO week containing `d`, in UTC — same convention as
    // jb_isoWeekLabel_ so a DST shift cannot push a Monday into the prior week.
    function mondayUtc_(d) {
      var u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      var dayNum = (u.getUTCDay() + 6) % 7;         // Mon=0 … Sun=6
      u.setUTCDate(u.getUTCDate() - dayNum);
      return u;
    }
    // toISOString() always renders in UTC regardless of the running environment's
    // timezone (ES spec) — so this string is the UTC calendar day mondayUtc_
    // computed, full stop, with no local-timezone re-interpretation possible.
    // Do NOT swap this for toIsoDate_: that helper reads Date via LOCAL getters,
    // and applying local getters to mondayUtc_'s UTC-instant Date reintroduces
    // the identical class of shift in any script timezone behind UTC.
    function keyOf_(d) { return mondayUtc_(d).toISOString().slice(0, 10); }

    var byWeek = {};
    function row_(k) {
      if (!byWeek[k]) byWeek[k] = { created: 0, resolved: 0, createdUnassigned: 0 };
      return byWeek[k];
    }

    createdClean.forEach(function (i) {
      var raw = dig_(i, "fields.created");
      if (!raw) return;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return;
      var r = row_(keyOf_(d));
      r.created++;
      if (!dig_(i, "fields.assignee.displayName")) r.createdUnassigned++;
    });

    resolvedClean.forEach(function (i) {
      var raw = dig_(i, "fields.resolutiondate");
      if (!raw) return;
      var d = new Date(raw);
      if (isNaN(d.getTime())) return;
      row_(keyOf_(d)).resolved++;
    });

    var keys = Object.keys(byWeek).sort();
    var out = [HEADERS];
    keys.forEach(function (k) {
      var r = byWeek[k];
      // k is already "yyyy-mm-dd", UTC-correct by construction — write the
      // STRING, never a `new Date(...)` wrapper. See the function docstring.
      out.push([k, r.created, r.resolved, r.createdUnassigned]);
    });

    sheet.clearContents();
    sheet.clearFormats();
    sheet.getRange(1, 1, out.length, HEADERS.length).setValues(out);
    styleHeader_(sheet.getRange(1, 1, 1, HEADERS.length));
    // Column A is plain text now, not a Date-typed cell (see docstring) — a
    // date number format has no effect on a text value, so it is dropped here
    // rather than left as dead formatting.
    Logger.log("📈 Jira Arrivals written: " + keys.length + " weeks");
  }

  // ── SECTION: EXEC Q&A — Duplo + Lego signal levels ───────────

  /**
   * Writes the "Exec Q&A" sheet — executive-ready weekly signal dashboard.
   *
   * Sections (top → bottom):
   *   💡 EXECUTIVE SUMMARY        — C-level summary of what this sheet tells you
   *   🏢 COMPANY SIGNAL            — throughput, contributors, cycle, blocked, quality, effort
   *   💰 REVENUE PROTECTION EVENTS — overdue items cleared (duedate < resolutiondate)
   *   📊 SPACE BREAKDOWN           — per-Space deliverables
  /**
   * 💡 EXEC Q&A GENERATOR
   * Generates the executive-facing summary and trending report.
   * Focuses on:
   *   1. 🚀 VALUE DELIVERY         — Customer vs Internal output
   *   2. ⏱️ VELOCITY & RELIABILITY  — Cycle times and Planning Gaps
   *   3. 🔍 DATA HYGIENE              — signal-integrity checks (exec trust)
   *
   * @param {object[]} weeklyData        — bucketed Done issues per week
   * @param {object[]} execWeeks         — the 4 completed weeks for trend
   * @param {object[]} createdIssues     — issues created in the exec window
   * @param {object[]} activeWIP         — issues currently 'In Progress'
   */
  function writeExecQASheet_(weeklyData, execWeeks, createdIssues, activeWIP) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.EXEC_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    // Labels from oldest to newest. execWeeks typically has 4.
    var labels = execWeeks.map(function(w) { return w.label; });
    var latestLabel = labels[labels.length - 1];
    var priorLabel = labels[labels.length - 2];

    var headers = ["Level", "Metric"].concat(labels).concat(["WoW Δ", "WoW %", "Signal"]);
    var numCols = headers.length;

    // ── Aggregation scaffolding ────────────────────────────────
    function blankAgg() {
      var agg = {
        count: 0, genuinelyDone: 0, cycle: [], blocked: 0, _c: {},
        rpe: 0, rpeEffortSec: 0, totalEffortSec: 0,
        dueGaps: [], earlyCount: 0, unassigned: 0, missingDue: 0, missingEpic: 0,
        // Time-of-resolution tracking (Resolution = "Done" only)
        doneCount: 0, doneEstSec: 0, doneSpentSec: 0,
        missingEstimate: 0, missingTimeSpent: 0,
        // Throughput by type
        doneEpics: 0, doneStories: 0, doneTasks: 0,
        // Behavioral Scores
        behaviorScores: {},
        // On-time delivery (resolved on or before due date)
        onTimeCount: 0,
        // Revenue milestone tracking (SRSO fix versions)
        srsoMilestones: 0, srsoContributors: {},
        // Contributor display names for Signal column
        _names: {}
      };
      Object.keys(BEHAVIOR_KEYWORDS).forEach(cat => agg.behaviorScores[cat] = 0);
      return agg;
    }
    
    var company = {};
    var bySpace = {}; // label -> space -> agg
    labels.forEach(function(l) { 
      company[l] = blankAgg(); 
      bySpace[l] = {};
    });

    // ── WIP Analysis ───────────────────────────────────────────
    var wipAssignees = {};
    (activeWIP || []).forEach(function(issue) {
      var rawName = dig_(issue.fields, "assignee.displayName");
      if (rawName) {
        wipAssignees[normalizeToRoster_(rawName)] = true;
      }
    });

    // Re-bucket all issues based on resolutiondate boundaries
    var doneAssigneesLatestWeek = {};
    (weeklyData || []).forEach(function(weekGroup) {
      (weekGroup.issues || []).forEach(function(issue) {
        var f = issue.fields || {};
        var resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
        if (!resolved) return;

        var targetLabel = null;
        for (var i = 0; i < execWeeks.length; i++) {
          if (resolved >= execWeeks[i].from && resolved <= execWeeks[i].to) {
            targetLabel = execWeeks[i].label;
            break;
          }
        }
        if (!targetLabel) return;

        var space = getSpaceForIssue_(issue);
        var typeName = dig_(f, "issuetype.name") || "Unknown";
        var typeNorm = typeName.toLowerCase();
        var isEpicType = typeNorm.indexOf("epic") !== -1;
        var aid = dig_(f, "assignee.accountId");
        var rawName = dig_(f, "assignee.displayName");
        var normName = normalizeToRoster_(rawName);
        var epicKey = f[CONFIGJ.EPIC_LINK_FIELD] || (f.parent && f.parent.key) || "";
        var created = f.created ? new Date(f.created) : null;
        var due = f.duedate ? new Date(f.duedate) : null;
        var daysToDone = (created && resolved) ? (resolved - created) / 86400000 : null;
        var isBlocked = (f.issuelinks || []).some(function(l) { return l.inwardIssue; });
        var timeSpentSec = Number(f.timespent || 0);
        var origEstSec = Number(f.timeoriginalestimate || 0);
        var resName = (f.resolution && f.resolution.name) ? f.resolution.name : "";
        var nonDelivery = isNonDelivery_(resName);
        var isResolutionDone = String(resName).toLowerCase() === "done";
        
        // Mark as engaged if they completed work in the LATEST week
        if (targetLabel === latestLabel && normName) {
          doneAssigneesLatestWeek[normName] = true;
        }

        // Behavioral Analysis via Comments
        var commentsArr = (f.comment && f.comment.comments) || [];
        var compiledComments = commentsArr.map(function(c) {
          return extractTextFromADF_(c.body);
        }).join(" ");
        var issueBehaviorScores = analyzeComments_(compiledComments);

        // RPE: any item with a Due Date that reached a resolution
        var isRPE = !!(due && resolved);
        // SRSO token anywhere in the name — covers both "SRSO-016559" and
        // client-prefixed names like "CLVT02 SRSO-016559"
        var isSRSO = (f.fixVersions || []).some(function(fv) { return /\bSRSO\b|SRSO-/i.test(fv.name || ''); });

        function bump(agg) {
          agg.count++;
          if (!nonDelivery) agg.genuinelyDone++;
          agg.totalEffortSec += timeSpentSec;
          if (aid) agg._c[aid] = true;
          else agg.unassigned++;
          if (normName) agg._names[normName] = true;
          if (daysToDone !== null) agg.cycle.push(daysToDone);
          if (isBlocked) agg.blocked++;
          if (!due) agg.missingDue++;
          if (!isEpicType && !epicKey) agg.missingEpic++;
          if (isRPE) {
            agg.rpe++;
            agg.rpeEffortSec += timeSpentSec;
            var gapDays = (resolved - due) / 86400000;
            agg.dueGaps.push(gapDays);
            if (resolved <= due) agg.onTimeCount++;
            if (resolved < due) agg.earlyCount++;
          }
          if (isResolutionDone) {
            agg.doneCount++;
            agg.doneEstSec += origEstSec;
            agg.doneSpentSec += timeSpentSec;
            if (origEstSec === 0) agg.missingEstimate++;
            if (timeSpentSec === 0) agg.missingTimeSpent++;
          }
          if (!nonDelivery) {
            if (isEpicType) agg.doneEpics++;
            else if (typeNorm === "story") agg.doneStories++;
            else if (typeNorm === "task" || typeNorm === "sub-task" || typeNorm === "subtask") agg.doneTasks++;
          }
          if (!nonDelivery && isSRSO && !isEpicType) {
            agg.srsoMilestones++;
            if (normName) agg.srsoContributors[normName] = (agg.srsoContributors[normName] || 0) + 1;
          }
          // Accumulate Behavioral Scores
          Object.keys(BEHAVIOR_KEYWORDS).forEach(function(cat) {
            agg.behaviorScores[cat] += (issueBehaviorScores[cat] || 0);
          });
        }

        bump(company[targetLabel]);
        if (!bySpace[targetLabel][space]) bySpace[targetLabel][space] = blankAgg();
        bump(bySpace[targetLabel][space]);
      });
    });

    // Backlog health (Added items)
    var createdTotal = {};
    labels.forEach(function(l) { createdTotal[l] = 0; });
    (createdIssues || []).forEach(function(issue) {
      var f = issue.fields || {};
      var created = f.created ? new Date(f.created) : null;
      if (!created) return;
      for (var i = 0; i < execWeeks.length; i++) {
        if (created >= execWeeks[i].from && created <= execWeeks[i].to) {
          createdTotal[execWeeks[i].label]++;
          break;
        }
      }
    });

    // Statistics helpers
    function getMedian(arr) {
      if (!arr.length) return 0;
      var s = arr.slice().sort(function(a, b) { return a - b; });
      var mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    function pctOf(num, den) { return den > 0 ? Math.round(num / den * 1000) / 10 : 0; }
    function r1(n) { return Math.round(n * 10) / 10; }

    function trendWord(vPrior, vLatest, goodWhen) {
      var d = vLatest - vPrior;
      if (d === 0) return "► Flat";
      if (goodWhen === "down") return d < 0 ? "▲ Improving" : "▼ Worsening";
      return d > 0 ? "▲ Up" : "▼ Down";
    }

    // ── Aggregation & Trend Helpers ────────────────────────────
    var stats = labels.map(function(l) {
      var agg = company[l];
      var milestones = (agg.doneStories || 0) + (agg.doneTasks || 0);
      var early = agg.earlyCount || 0;
      var netValue = agg.genuinelyDone || 0;
      var rate = pctOf(agg.genuinelyDone, agg.count);
      var ics = Object.keys(agg._c || {}).length;
      var epics = agg.doneEpics || 0;
      var totalClosed = agg.count || 0;
      return { 
        milestones: milestones, 
        stories: agg.doneStories || 0,
        tasks: agg.doneTasks || 0,
        early: early, 
        netValue: netValue, 
        rate: rate, 
        ics: ics, 
        epics: epics, 
        totalClosed: totalClosed 
      };
    });

    var latest = stats[stats.length - 1];
    var prior = stats[stats.length - 2];

    // ── Row builders ───────────────────────────────────────────
    var rows = [headers];
    var sectionIdxs = [], execSummaryIdxs = [];

    function wowRow(level, metric, vals, signal) {
      var vLatest = vals[vals.length - 1];
      var vPrior = vals[vals.length - 2];
      var delta = vLatest - vPrior;
      var p = (vPrior === 0) ? (vLatest === 0 ? 0 : 100) : Math.round(delta / vPrior * 1000) / 10;
      return [level, metric].concat(vals).concat([delta, p, signal || ""]);
    }
    function sectionRow(title) {
      sectionIdxs.push(rows.length);
      var r = [title, ""];
      while (r.length < numCols) r.push("");
      return r;
    }
    function execRow(type, text) {
      execSummaryIdxs.push(rows.length);
      var r = ["", type, text];
      while (r.length < numCols) r.push("");
      return r;
    }

    // ── 0. EXECUTIVE SUMMARY ───────────────────────────────────
    rows.push(sectionRow("💡 EXECUTIVE SUMMARY"));

    var icsDiff = latest.ics - prior.ics;
    rows.push(execRow("FACT", "Active Contributors: " + latest.ics + " this week (" + (icsDiff >= 0 ? "+" : "") + icsDiff + " WoW)."));

    var milestoneDiff = latest.milestones - prior.milestones;
    rows.push(execRow("FACT", "Total Milestones: " + latest.milestones + " items (" + (milestoneDiff >= 0 ? "+" : "") + milestoneDiff + " WoW) — Tasks + Stories + Sub-tasks."));
    
    var latestSrso = company[latestLabel].srsoMilestones || 0;
    var priorSrso = company[priorLabel].srsoMilestones || 0;
    var srsoDiff = latestSrso - priorSrso;
    rows.push(execRow("FACT", "Revenue Milestones (SRSO): " + latestSrso + " items (" + (srsoDiff >= 0 ? "+" : "") + srsoDiff + " WoW) — fixVersion ~ SRSO*."));

    var rosterData = readTargetedRoster_();
    var totalHC = rosterData.count;
    if (totalHC > 0) {
      var engagedCount = 0, deliveredCount = 0, buildingCount = 0;
      Object.keys(rosterData.names).forEach(function(name) {
        var delivered = doneAssigneesLatestWeek[name];
        var building = wipAssignees[name];
        if (delivered || building) engagedCount++;
        if (delivered) deliveredCount++;
        if (!delivered && building) buildingCount++;
      });
      var engagementRate = Math.round((engagedCount / totalHC) * 100);
      var deliveryRate = Math.round((deliveredCount / totalHC) * 100);
      var buildingRate = Math.round((buildingCount / totalHC) * 100);
      var idleRate = 100 - engagementRate;
      rows.push(execRow("NOTE", "Engagement: " + engagementRate + "% of Targeted ICs engaged (" + deliveryRate + "% Delivered, " + buildingRate + "% Building)."));
      if (idleRate > 20) {
        var idleCount = totalHC - engagedCount;
        rows.push(execRow("CONCERN", "Idle Capacity: " + idleRate + "% (" + idleCount + " of " + totalHC + " Targeted ICs) have no completed or in-progress items."));
      }
    } else {
      var combinedActive = 0, seen = {};
      Object.keys(doneAssigneesLatestWeek).forEach(function(n) { seen[n] = true; combinedActive++; });
      Object.keys(wipAssignees).forEach(function(n) { if (!seen[n]) combinedActive++; });
      rows.push(execRow("NOTE", "Engagement: " + combinedActive + " Rocketeers actively engaged (Targeted Roster not found)."));
    }

    // ── 1. ACTIVE CONTRIBUTORS ─────────────────────────────────
    rows.push(sectionRow("👥 ACTIVE CONTRIBUTORS"));

    var contributorCounts = labels.map(function(l) { return Object.keys(company[l]._c).length; });
    var latestNames = Object.keys(company[latestLabel]._names || {}).sort().join(", ");
    rows.push(wowRow("", "Active Contributors", contributorCounts, latestNames || "—"));

    // ── 2. MILESTONES ──────────────────────────────────────────
    rows.push(sectionRow("📋 MILESTONES"));

    var milestoneCounts = labels.map(function(l) { return (company[l].doneStories || 0) + (company[l].doneTasks || 0); });
    rows.push(wowRow("", "Total Milestones (Tasks + Stories + Sub-tasks)", milestoneCounts,
      "Stories: " + latest.stories + " | Tasks & Sub-tasks: " + latest.tasks));

    var onTimeCounts = labels.map(function(l) { return company[l].onTimeCount || 0; });
    var latestRpe = company[latestLabel].rpe || 0;
    var onTimeRate = latestRpe > 0 ? Math.round((company[latestLabel].onTimeCount || 0) / latestRpe * 100) : 0;
    rows.push(wowRow("", "Delivered On Time (≤ Due Date)", onTimeCounts,
      "Items with a Due Date resolved on or before it. On-time rate: " + onTimeRate + "% of scheduled items this week."));

    var srsoCounts = labels.map(function(l) { return company[l].srsoMilestones || 0; });
    var srsoContribSummary = Object.keys(company[latestLabel].srsoContributors || {})
      .sort(function(a, b) { return (company[latestLabel].srsoContributors[b] || 0) - (company[latestLabel].srsoContributors[a] || 0); })
      .map(function(n) { return n + " (" + company[latestLabel].srsoContributors[n] + ")"; })
      .join(", ") || "—";
    rows.push(wowRow("SRSO", "Revenue Milestones (fixVersion ~ SRSO*)", srsoCounts, srsoContribSummary));

    // ── 3. EPIC FIDELITY — planned (Original Estimate) vs tracked (Tempo) ──
    // Reads the just-written Jira Raw sheet (runJiraEpicTracker flushes it
    // first), so the rollup includes the epic-children rows — open tickets
    // and out-of-window completions count toward each epic's burn.
    rows.push(sectionRow("📐 EPIC FIDELITY — Planned vs Tracked"));

    function fidelityRow(cells, signal) {
      var r = [""].concat(cells);
      while (r.length < numCols - 1) r.push("");
      r.push(signal || "");
      return r;
    }

    var epicFidelity = {};
    var rawSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.RAW_SHEET);
    var rawVals = rawSh ? rawSh.getDataRange().getValues() : [];
    if (rawVals.length > 1) {
      var rHdr = rawVals[0];
      var iEpicK  = rHdr.indexOf("Epic Key");
      var iOrig   = rHdr.indexOf("Original Estimate (sec)");
      var iTempoH = rHdr.indexOf("Tempo Logged (hrs)");
      var iBill   = rHdr.indexOf("Billing Type");
      if (iEpicK !== -1 && iOrig !== -1 && iTempoH !== -1) {
        for (var ri = 1; ri < rawVals.length; ri++) {
          var ek = String(rawVals[ri][iEpicK] || "").trim();
          if (!ek) continue;
          if (!epicFidelity[ek]) epicFidelity[ek] = { planned: 0, tracked: 0, billing: "Untagged" };
          epicFidelity[ek].planned += (Number(rawVals[ri][iOrig]) || 0) / 3600; // sec → hrs
          epicFidelity[ek].tracked += Number(rawVals[ri][iTempoH]) || 0;
          // Billing precedence: any SRSO child makes the epic Billable,
          // otherwise any tagged child makes it Internal.
          var childBill = iBill !== -1 ? String(rawVals[ri][iBill] || "") : "";
          if (/SRSO/i.test(childBill)) epicFidelity[ek].billing = "Billable (SRSO)";
          else if (childBill === "Internal" && epicFidelity[ek].billing === "Untagged") epicFidelity[ek].billing = "Internal";
        }
      }
    }

    var fidelityKeys = Object.keys(epicFidelity).filter(function(ek) {
      var e = epicFidelity[ek];
      return e.planned > 0 || e.tracked > 0;
    }).sort(function(a, b) {
      var ea = epicFidelity[a], eb = epicFidelity[b];
      var ra = ea.planned > 0 ? ea.tracked / ea.planned : 0;
      var rb = eb.planned > 0 ? eb.tracked / eb.planned : 0;
      return ra - rb; // worst fidelity (incl. no-estimate) first
    });

    if (fidelityKeys.length === 0) {
      rows.push(fidelityRow(["No epic carries estimates or logged hours in the current Jira Raw."]));
    } else {
      rows.push(fidelityRow(["Epic Key", "Planned (hrs)", "Tracked (hrs)", "Fidelity %", "Billing"], "Signal"));
      var FIDELITY_MAX_ROWS = 25;
      fidelityKeys.slice(0, FIDELITY_MAX_ROWS).forEach(function(ek) {
        var e = epicFidelity[ek];
        var fidelityPct = e.planned > 0 ? Math.round(e.tracked / e.planned * 100) : "—";
        var signal = e.planned === 0 ? "⚠️ No estimate set"
          : fidelityPct < 50 ? "🚨 Under-tracked"
          : fidelityPct > 130 ? "🔴 Over-burning"
          : "✅ On track";
        rows.push(fidelityRow([ek, r1(e.planned), r1(e.tracked), fidelityPct, e.billing], signal));
      });
      if (fidelityKeys.length > FIDELITY_MAX_ROWS) {
        rows.push(fidelityRow(["… " + (fidelityKeys.length - FIDELITY_MAX_ROWS)
          + " more epics not shown (worst fidelity listed first)"]));
      }
    }

    // ── Write to Sheet ─────────────────────────────────────────
    if (rows.length > 0) {
      var range = sheet.getRange(1, 1, rows.length, numCols);
      range.setValues(rows);
      
      sheet.setFrozenRows(1);
      var fullRange = sheet.getRange(1, 1, rows.length, numCols);
      fullRange.setFontFamily("Consolas").setFontSize(12).setVerticalAlignment("middle");

      // Header styling
      sheet.getRange(1, 1, 1, numCols)
        .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

      // Section styling
      sectionIdxs.forEach(function(idx) {
        sheet.getRange(idx + 1, 1, 1, numCols)
          .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");
      });

      // Executive Summary Specifics
      execSummaryIdxs.forEach(function(idx) {
        var cell = sheet.getRange(idx + 1, 2);
        cell.setFontWeight("bold");
        var val = cell.getValue();
        if (val === "FACT") cell.setFontColor(COLORS.ROYAL);
        if (val === "CONCERN") cell.setFontColor("#C62828");
        if (val === "NOTE") cell.setFontColor("#E65100");
      });

      // Delta and Pct coloring: up = good (green), down = bad (red)
      var dCol = numCols - 2;
      var pCol = numCols - 1;
      var GREEN = "#2E7D32", RED = "#C62828";
      for (var r = 1; r < rows.length; r++) {
        var dCell = sheet.getRange(r + 1, dCol), pCell = sheet.getRange(r + 1, pCol);
        var dv = dCell.getValue(), pv = pCell.getValue();
        if (typeof dv === "number" && dv !== 0) dCell.setFontColor(dv > 0 ? GREEN : RED).setFontWeight("bold");
        if (typeof pv === "number" && pv !== 0) pCell.setFontColor(pv > 0 ? GREEN : RED).setFontWeight("bold");
      }

      sheet.setColumnWidth(1, 120);
      sheet.setColumnWidth(2, 320);
      for (var c = 3; c <= numCols - 1; c++) sheet.setColumnWidth(c, 100);
      sheet.setColumnWidth(numCols, 450); // Wider for Signals
    }
  }


  // ── SECTION: MAIN ENTRY POINT ─────────────────────────────────

  function runJiraEpicTracker() {
    try {
      Logger.log("🚀 Exec Contribution Tracker starting…");

      // NARRATIVE window (Exec Q&A).
      var weeks = getLastNWeeks_(CONFIGJ.WEEKS_BACK);
      Logger.log("📅 Narrative week windows (" + weeks.length + " weeks):");
      weeks.forEach(function(w, i) {
        Logger.log("   Wk " + (i + 1) + ": " + w.fromStr + " → " + w.toStr);
      });

      // DEEP window ("Jira Raw" only) — what the dashboards' Weekly/Monthly/
      // Quarterly period views are limited by. Rolling, so runtime stays flat.
      var rawWeeks = getLastNWeeks_(CONFIGJ.RAW_HISTORY_WEEKS);
      Logger.log("📅 Jira Raw deep window: " + rawWeeks.length + " weeks (" +
                 rawWeeks[0].fromStr + " → " + rawWeeks[rawWeeks.length - 1].toStr + ")");

      // Broad fetch — all Done issues across all projects (original working
      // approach), anchored at the DEEP window start so ONE query serves both
      // windows. This is why deeper history costs pages, not queries.
      var allIssues = fetchJiraIssues_(rawWeeks[0].fromStr);

      // Active Engagement fetch (Phase 2)
      var activeWIP = fetchActiveWIP_();
      Logger.log("🛠️ Active WIP issues fetched: " + activeWIP.length);

      // Epic expansion — fetch every child of the in-scope epics so Jira Raw
      // shows what's inside each epic, not just the epic row. Children that
      // completed inside the analysed window are already in allIssues (the
      // broad Done fetch); everything else (open, or resolved outside the
      // window) is collected separately for the raw sheet.
      // Expansion is scoped to EPIC_EXPAND_WEEKS, not the deep window: this is
      // the one fan-out cost in the export (each epic pulls its whole child
      // tree), and children of programmes closed months ago add rows no
      // consumer reads.
      var expandWeeks = getLastNWeeks_(
        Math.min(CONFIGJ.EPIC_EXPAND_WEEKS, CONFIGJ.RAW_HISTORY_WEEKS));
      var expandFrom = expandWeeks[0].from;
      var epicKeys = allIssues
        .filter(function(i) {
          if (String(dig_(i.fields, "issuetype.name") || "").toLowerCase().indexOf("epic") === -1) return false;
          var completed = getCompletedDate_(i);
          return completed && completed >= expandFrom;
        })
        .map(function(i) { return i.key; });
      Logger.log("📦 Epic expansion scope: " + epicKeys.length + " epic(s) resolved since "
        + expandWeeks[0].fromStr + " (" + expandWeeks.length + "-week expansion window).");

      // Shared across the epic-child expansion AND the open-backlog fetch below,
      // so an issue lands in Jira Raw exactly once no matter how many fetches
      // legitimately return it (an OPEN child of a recent epic is returned by
      // both, and would otherwise be written twice under two different week
      // labels).
      var seenKeys = {};
      allIssues.forEach(function(i) { seenKeys[i.key] = true; });

      var epicChildren = [];
      if (epicKeys.length > 0) {
        var children = fetchChildrenForEpics_(epicKeys);
        children.forEach(function(i) {
          if (seenKeys[i.key]) return;                // already fetched
          if (getSpaceForIssue_(i) === null) return;  // disabled space
          if (isNoiseIssue_(i)) return;               // Canceled / Won't Do etc.
          seenKeys[i.key] = true;
          epicChildren.push(i);
        });
        Logger.log("📦 Epic expansion: " + children.length + " children fetched, "
          + epicChildren.length + " new (open or resolved outside the window).");
      }

      // Bucket by Resolution Date into weeks. Each issue resolves exactly once,
      // so it lands in exactly ONE bucket — row count grows with the number of
      // issues, never with weeks × issues. That is what makes a 52-week Jira
      // Raw affordable.
      function bucketByWeek_(weekList, quiet) {
        return weekList.map(function(week) {
          var issues = allIssues.filter(function(issue) {
            var completed = getCompletedDate_(issue);
            return completed && completed >= week.from && completed <= week.to;
          });
          if (!quiet) Logger.log("   " + week.label + ": " + issues.length + " completed issues");
          return { label: week.label, issues: issues };
        });
      }

      // Exec Q&A: the narrow window, exactly as before.
      var weeklyData = bucketByWeek_(weeks, false);

      // Jira Raw: the DEEP window, plus the epic children that fall outside
      // the weekly buckets under the sentinel Week label "Epic Child". Exec Q&A
      // keeps using weeklyData only, so its WoW numbers are unaffected by the
      // deeper raw history.
      var rawWeeklyData = bucketByWeek_(rawWeeks, true);
      var rawRowCount = rawWeeklyData.reduce(function(n, w) { return n + w.issues.length; }, 0);
      Logger.log("📊 Jira Raw: " + rawRowCount + " completed-issue rows across "
        + rawWeeks.length + " weeks" + (epicChildren.length
            ? " + " + epicChildren.length + " epic-child rows" : ""));
      if (epicChildren.length > 0) {
        rawWeeklyData = rawWeeklyData.concat([{ label: "Epic Child", issues: epicChildren }]);
      }

      // Open-backlog feed — unresolved assigned work, under the sentinel week
      // label "Open". Same pattern as "Epic Child": these rows have no
      // resolution date, so every date-bucketed consumer skips them, while the
      // delivery-health dashboard reads them as each person's carried backlog.
      var openIssues = fetchOpenIssues_().filter(function(i) {
        if (seenKeys[i.key]) return false;   // already written (Done or epic child)
        seenKeys[i.key] = true;
        return true;
      });
      if (openIssues.length > 0) {
        rawWeeklyData = rawWeeklyData.concat([{ label: "Open", issues: openIssues }]);
        Logger.log("📊 Jira Raw: + " + openIssues.length + " open-backlog rows.");
      }

      Logger.log("📝 Writing 'Jira Raw' sheet...");
      writeRawSheet_(rawWeeklyData);
      Logger.log("💾 Flushing 'Jira Raw'...");
      SpreadsheetApp.flush();

      // ── Flow-metrics feeds (v3.9.0) ─────────────────────────
      // Bugs created in the deep window — Bug Count for the 🌊 Flow tab.
      // A separate tab: Bug is NOT in EXEC_ISSUE_TYPES, and Bug rows in
      // Jira Raw would move every consumer's denominators.
      Logger.log("🐛 Fetching bugs for the flow feed...");
      var bugs = fetchBugsCreated_(rawWeeks[0].fromStr);
      Logger.log("📝 Writing 'Jira Bugs' sheet...");
      writeBugsSheet_(bugs);
      SpreadsheetApp.flush();

      // Point-in-time WIP/backlog snapshot over the same open candidates that
      // reach Jira Raw (open-backlog fetch + open epic children). Appended,
      // never rewritten — see writeFlowSnapshot_.
      writeFlowSnapshot_(epicChildren.concat(openIssues));
      SpreadsheetApp.flush();

      // Exec Q&A — uses all weeks for trend context, but WoW compares last 2.
      Logger.log("📦 Fetching created issues for Exec window...");
      var createdIssues = fetchCreatedIssues_(weeks[0].fromStr, weeks[weeks.length-1].toStr);
      Logger.log("   Created issues fetched: " + createdIssues.length);

      // Jira Arrivals (v3.11.0) — reuses the created fetch above and adds the
      // resolved half over the SAME window, so net flow subtracts like for like.
      Logger.log("📦 Fetching resolved issues for the Arrivals tally...");
      var resolvedWindow = fetchResolvedInWindow_(weeks[0].fromStr, weeks[weeks.length - 1].toStr);
      writeArrivals_(createdIssues, resolvedWindow);

      Logger.log("📝 Writing 'Exec Q&A' sheet...");
      writeExecQASheet_(weeklyData, weeks, createdIssues, activeWIP);
      Logger.log("💾 Flushing 'Exec Q&A'...");
      SpreadsheetApp.flush();

      Logger.log("✅ Done. Check tabs: \"" + CONFIGJ.RAW_SHEET
        + "\", \"" + CONFIGJ.EXEC_SHEET + "\", \"" + CONFIGJ.BUGS_SHEET
        + "\", \"" + CONFIGJ.FLOW_SNAP_SHEET + "\".");

    } catch (e) {
      Logger.log("❌ [runJiraEpicTracker] " + e.message);
      throw e;
    }
  }

  // ── SECTION: TEMPORARY DEBUG HELPER ─────────────────────────

  /**
   * TEMPORARY HELPER: runDebugRosterMatching()
   * Helps identify why the "Total Contributors" (Jira) and "Targeted ICs" (Roster) don't match.
   * Creates a "Debug Matching" sheet showing:
   *   1. People in the Targeted Roster with ZERO Jira activity (Idle/Mismatched).
   *   2. People with Jira activity who are NOT in the Targeted Roster (Wrong profile/Mismatched).
   *   3. All "Unassigned" tickets so you can go fix them in Jira.
   * Reads directly from the 'Jira Raw' sheet to save API calls.
   */
  function runDebugRosterMatching() {
    try {
      Logger.log("🔍 Starting Roster vs Jira Debug Matching...");
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      
      var rawSheet = ss.getSheetByName(CONFIGJ.RAW_SHEET);
      if (!rawSheet) {
        Logger.log("❌ 'Jira Raw' sheet not found. Please run the main report first.");
        return;
      }

      var sheetName = "Debug Matching";
      var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
      sheet.clear();

      // 1. Get Targeted Roster Names
      var rosterData = readTargetedRoster_();
      var targetedNames = Object.keys(rosterData.names);
      Logger.log("   Found " + targetedNames.length + " targeted names in Roster.");

      // 2. Get Jira Activity from 'Jira Raw' sheet
      var rawData = rawSheet.getDataRange().getValues();
      if (rawData.length <= 1) {
        Logger.log("❌ 'Jira Raw' sheet is empty.");
        return;
      }

      var headers = rawData[0];
      var assigneeIdx = headers.indexOf("Assignee");
      var weekIdx = headers.indexOf("Week");
      var keyIdx = headers.indexOf("Key");
      var summaryIdx = headers.indexOf("Work (Summary)");
      var statusIdx = headers.indexOf("Status");

      if (assigneeIdx === -1 || keyIdx === -1 || statusIdx === -1) {
        Logger.log("❌ Could not find necessary columns (Assignee, Key, Status) in 'Jira Raw'.");
        return;
      }

      var jiraActiveNames = {};
      var unassignedKeys = [];

      for (var i = 1; i < rawData.length; i++) {
        var row = rawData[i];
        var rawName = String(row[assigneeIdx] || "").trim();
        var key = row[keyIdx];
        var summary = row[summaryIdx];
        var status = String(row[statusIdx] || "").toLowerCase();
        
        // Jira Raw is no longer Done-only: the Week column carries an ISO label
        // ("2026.W30") for completed work and a sentinel for the two additive
        // feeds — "Epic Child" (v3.1.0) and "Open" (v3.4.0, unresolved backlog).
        // Read it so this helper reports what a person actually has, instead of
        // labelling every row "Done".
        var weekVal = weekIdx === -1 ? "" : String(row[weekIdx] || "").trim();
        var type = /^\d{4}\.W\d{1,2}$/.test(weekVal) ? "Done" : (weekVal || "Done");

        if (!rawName || /unassigned/i.test(rawName)) { // covers "Unassigned" and "⚠️ UNASSIGNED"
          unassignedKeys.push(key + " (" + type + " - " + summary + ")");
          continue;
        }

        var normName = normalizeToRoster_(rawName);
        if (!jiraActiveNames[normName]) {
          jiraActiveNames[normName] = { rawName: rawName, types: [type] };
        } else {
          if (jiraActiveNames[normName].types.indexOf(type) === -1) {
            jiraActiveNames[normName].types.push(type);
          }
        }
      }

      // 3. Cross-reference
      var idleInRoster = targetedNames.filter(function(n) { return !jiraActiveNames[n]; });
      var activeNotInRoster = Object.keys(jiraActiveNames).filter(function(n) { return !rosterData.names[n]; });

      // 4. Output to Sheet
      var rows = [["Category", "Normalized Name (Matched)", "Raw Name (Jira)", "Activity Type / Details"]];

      idleInRoster.forEach(function(n) {
        rows.push(["🚨 Idle / Missing in Jira", n, "—", "In targeted roster, but 0 items found in Jira Raw."]);
      });

      activeNotInRoster.forEach(function(n) {
        var entry = jiraActiveNames[n];
        rows.push(["⚠️ Active / Not in Roster", n, entry.rawName, entry.types.join(" & ")]);
      });

      unassignedKeys.forEach(function(detail) {
        rows.push(["👻 Unassigned Issue", "—", "Unassigned", detail]);
      });

      sheet.getRange(1, 1, rows.length, 4).setValues(rows);
      sheet.getRange(1, 1, 1, 4).setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");
      sheet.setFrozenRows(1);

      Logger.log("✅ Debug complete. Check the '" + sheetName + "' tab.");
    } catch (e) {
      Logger.log("❌ Debug Failed: " + e.message);
    }
  }

  // ── SECTION: UTILITIES ────────────────────────────────────────

  function testJiraConnection() {
    try {
      Logger.log("🔌 Testing Jira connection…");
      var issues = fetchJiraIssues_();
      if (issues.length > 0) {
        Logger.log("✅ Success — " + issues.length + " issues returned. Samples:");
        issues.slice(0, 3).forEach(function(issue) {
          Logger.log("   " + issue.key
            + " | " + (dig_(issue.fields, "status.name") || "?")
            + " | updated: " + fmtDateTime_(issue.fields.updated)
            + " | " + (issue.fields.summary || "").substring(0, 60));
        });
      } else {
        Logger.log("⚠️  Connection OK but 0 issues returned.");
        Logger.log("   Check: status names, issuetype names, LOOKBACK_DAYS = " + CONFIGJ.LOOKBACK_DAYS + ".");
      }
    } catch (e) {
      Logger.log("❌ [testJiraConnection] " + e.message);
    }
  }

  /**
   * DIAGNOSTIC — measures every region/team candidate field against live Jira,
   * so the attribution field is chosen from fill rates instead of field names.
   *
   * Run this in the GAS editor. It answers three questions:
   *   1. Do the configured ids exist, and what are they really called?
   *      (/rest/api/3/field, matched by name)
   *   2. What share of the exported population carries each candidate, and what
   *      values do they hold? (samples the same Done population the export writes)
   *   3. Are any region option labels missing from REGION_VOCAB_?
   *
   * ⚠️ Read the RAW-SHAPE line for each field. This probe reported "0%" for
   * Region across v3.4.0–v3.6.0 and the conclusion drawn was "the field isn't
   * populated" — wrong. It called jbRegionValue_, which silently returned "" for
   * every multi-select array, so the probe was measuring the bug rather than the
   * data. It now prints the raw JSON shape of the first non-empty value it sees,
   * which is the check that would have caught it.
   */
  function probeRegionTeamFields() {
    Logger.log("🔍 Region / Team field probe — site: " + CONFIGJ.JIRA_BASE_URL);
    Logger.log("   Configured: REGION_FIELD=" + CONFIGJ.REGION_FIELD
      + ", TEAM_FIELD=" + CONFIGJ.TEAM_FIELD);
    Logger.log("   Candidates: REGION_ALT_FIELD=" + CONFIGJ.REGION_ALT_FIELD
      + ", TEAM_TEMPO_FIELD=" + CONFIGJ.TEAM_TEMPO_FIELD
      + ", WORKSTREAM_FIELD=" + CONFIGJ.WORKSTREAM_FIELD);

    // ── 1. Do the IDs exist, and what are they really called? ──
    try {
      var resp = UrlFetchApp.fetch(CONFIGJ.JIRA_BASE_URL + "/rest/api/3/field", {
        method: "get", headers: buildHeaders_(), muteHttpExceptions: true,
      });
      if (resp.getResponseCode() !== 200) {
        Logger.log("⚠️ /rest/api/3/field returned HTTP " + resp.getResponseCode()
          + " — skipping the ID check: " + resp.getContentText().slice(0, 200));
      } else {
        var parsed = jb_tryParseJson_(resp, "Jira /field");
        var fields = parsed.ok ? (parsed.data || []) : [];
        var byId = {};
        fields.forEach(function(fl) { byId[fl.id] = fl.name; });

        PROBE_FIELDS_.forEach(function(pf) {
          var name = byId[pf.id];
          Logger.log(name
            ? "   ✅ " + pf.key + " " + pf.id + " exists → \"" + name + "\""
            : "   ❌ " + pf.key + " " + pf.id + " does NOT exist on this site.");
        });

        // Name-side search: catches the case where the right field exists under a
        // DIFFERENT id than the one configured above. Widened past /region|team/
        // to the words this org actually uses for delivery attribution — the
        // Workstream field would never have surfaced under the old pattern.
        var configuredIds = {};
        PROBE_FIELDS_.forEach(function(pf) { configuredIds[pf.id] = true; });
        var candidates = fields.filter(function(fl) {
          return /region|team|workstream|squad|practice|geo|location/i.test(fl.name || "");
        });
        Logger.log("   Fields whose name mentions region/team/workstream ("
          + candidates.length + "):");
        candidates.forEach(function(fl) {
          Logger.log("      " + fl.id + "  \"" + fl.name + "\""
            + (configuredIds[fl.id] ? "   ← configured" : ""));
        });
      }
    } catch (e) {
      Logger.log("⚠️ Field-list check failed: " + e.message);
    }

    // ── 2. Fill rate on the population the export ACTUALLY WRITES ──
    //
    // ⚠️ This leg used to sample "Done, last 90 days, first 300" and report that
    // as THE fill rate. It is not: Jira Raw carries RAW_HISTORY_WEEKS (52) of
    // Done work plus the open backlog, and the three populations disagree badly
    // — measured 2026-08-04: 34% over the 52-week window, 17% over 90 days, 10%
    // on open rows. A probe scoped to a window the export doesn't write produced
    // a number nobody could reconcile against the sheet, which is the same class
    // of mistake as the multi-select bug: measuring something adjacent to the
    // thing you ship. Both legs are now measured and reported separately.
    try {
      var probeIds = PROBE_FIELDS_.map(function(pf) { return pf.id; });
      var probeFields = ["summary", "project"].concat(probeIds).filter(Boolean);

      var deepSince = new Date();
      deepSince.setDate(deepSince.getDate() - CONFIGJ.RAW_HISTORY_WEEKS * 7);
      var doneJql = [
        'issuetype in (' + CONFIGJ.EXEC_ISSUE_TYPES.join(", ") + ')',
        CONFIGJ.DONE_JQL,
        'project NOT IN (TEMPLATE)',
        'resolutiondate >= "' + toIsoDate_(deepSince) + '"',
      ].join(" AND ") + ' ORDER BY resolutiondate DESC';

      // The open backlog is the ACTIONABLE half — tagging one of these changes a
      // future number, where tagging resolved work only rewrites history. It is
      // also the worst-tagged half, so leaving it out flatters the report.
      var openClauses = [
        'issuetype in (' + CONFIGJ.EXEC_ISSUE_TYPES.join(", ") + ')',
        'statusCategory != Done',
        'assignee is not EMPTY',
        'project NOT IN (TEMPLATE)',
      ];
      if (CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS) {
        var openSince = new Date();
        openSince.setDate(openSince.getDate() - CONFIGJ.OPEN_BACKLOG_UPDATED_WEEKS * 7);
        openClauses.push('updated >= "' + toIsoDate_(openSince) + '"');
      }
      var openJql = openClauses.join(" AND ") + ' ORDER BY updated DESC';

      var legs = [
        { label: "Done · " + CONFIGJ.RAW_HISTORY_WEEKS + "-week export window", jql: doneJql },
      ];
      if (CONFIGJ.OPEN_BACKLOG_ENABLED !== false) {
        legs.push({ label: "Open backlog (actionable half)", jql: openJql });
      }

      legs.forEach(function(leg) {
        // NOT capped at 300. The cap was the other half of the reconciliation
        // problem: a truncated sample of a 12,000-row window is a different
        // population again, and nobody reading "17%" knew it came from 300 rows.
        var sample = fetchAllIssuesByJql_(leg.jql, probeFields);
        probeReportLeg_(leg.label, sample);
      });
    } catch (e) {
      Logger.log("⚠️ Fill-rate sample failed: " + e.message);
    }
  }

  /**
   * Reports every PROBE_FIELDS_ fill rate over one sampled population, plus the
   * region-vocabulary check. Split out of probeRegionTeamFields so the Done and
   * open-backlog legs are measured identically — two copies of this loop would
   * drift, and a fill rate that means something different per leg is worse than
   * no fill rate.
   * @param {string} label  human name for the population
   * @param {Object[]} sample  issues, already fetched with the probe field list
   */
  function probeReportLeg_(label, sample) {
    var n = sample.length;
    Logger.log("   ── " + label + " — " + n + " issues ──");
    if (!n) {
      Logger.log("      (no issues returned — nothing to measure)");
      return;
    }

    var regionVals = {};   // kept aside for the vocabulary check below
    PROBE_FIELDS_.forEach(function(pf) {
      var filled = 0, multi = 0, vals = {}, rawShape = null;

      sample.forEach(function(iss) {
        var f = iss.fields || {};
        var raw = f[pf.id];
        if (raw === null || raw === undefined || raw === "") return;
        if (Array.isArray(raw) && !raw.length) return;
        if (rawShape === null) rawShape = JSON.stringify(raw).slice(0, 160);
        if (Array.isArray(raw) && raw.length > 1) multi++;

        // NOT named `label` — that is this function's parameter, and shadowing
        // it here is how a leg silently reports under the wrong heading.
        var readVal = pf.read(raw);
        if (!readVal) return;   // present in Jira but the reader dropped it
        filled++;
        vals[readVal] = (vals[readVal] || 0) + 1;
      });

      Logger.log("      " + pf.label + " (" + pf.id + "): " + filled + "/" + n
        + " (" + Math.round(filled / n * 100) + "%)"
        + (multi ? "  [" + multi + " carry 2+ options]" : ""));
      if (rawShape !== null) {
        // The line that would have caught the v3.4.0 array bug: if the raw
        // shape shows values but the fill rate above is 0%, the READER is
        // broken, not the Jira field.
        Logger.log("         raw shape: " + rawShape);
        if (!filled) {
          Logger.log("         ⚠️ Jira RETURNED values but the reader produced none"
            + " — this is a reader bug, not an unpopulated field.");
        }
      }
      if (filled) Logger.log("         values: " + JSON.stringify(vals));
      if (pf.id === CONFIGJ.REGION_FIELD) regionVals = vals;
    });

    // Any region label that fell through REGION_VOCAB_ unmapped needs either
    // a vocabulary entry here or a fix in the dashboard's chip list. Compound
    // values ("AMER | SEA") are split so a single bad half still surfaces.
    var mapped = {};
    Object.keys(REGION_VOCAB_).forEach(function(k) { mapped[REGION_VOCAB_[k]] = true; });
    var unmapped = {};
    Object.keys(regionVals).forEach(function(v) {
      v.split(" | ").forEach(function(part) {
        if (!mapped[part]) unmapped[part] = true;
      });
    });
    var unmappedList = Object.keys(unmapped);
    Logger.log(unmappedList.length
      ? "      ⚠️ Region values outside REGION_VOCAB_: " + unmappedList.join(", ")
        + " — add them to REGION_VOCAB_ (and to the dashboard's chip list)."
      : "      ✅ All region values map to the short-form vocabulary.");
  }

  /**
   * The region/team attribution fields this probe measures, with the reader each
   * column actually uses — so the probe can never report a fill rate the export
   * doesn't reproduce. Add a row here when a new candidate field appears.
   */
  var PROBE_FIELDS_ = [
    { key: "REGION_FIELD",     id: CONFIGJ.REGION_FIELD,
      label: "Region (col 31)",       read: jbRegionValue_ },
    { key: "TEAM_FIELD",       id: CONFIGJ.TEAM_FIELD,
      label: "Team (col 32)",         read: jbTeamValue_ },
    // Probe-only since v3.10.0 — measured here, never exported. The label says so
    // rather than naming a column, because a label naming a column that no longer
    // exists is how somebody spends an afternoon looking for it in the sheet.
    { key: "REGION_ALT_FIELD", id: CONFIGJ.REGION_ALT_FIELD,
      label: "Region (Alt) (not exported)", read: jbOptionLabel_ },
    { key: "TEAM_TEMPO_FIELD", id: CONFIGJ.TEAM_TEMPO_FIELD,
      label: "Tempo Team (not exported)",   read: jbTeamValue_ },
    { key: "WORKSTREAM_FIELD", id: CONFIGJ.WORKSTREAM_FIELD,
      label: "Workstream (col 36)",         read: jbOptionLabel_ },
  ].filter(function(pf) { return !!pf.id; });

  function previewWeekWindows() {
    var weeks = getLastNWeeks_(CONFIGJ.WEEKS_BACK);
    Logger.log("📅 Narrative window — Exec Q&A (today = "
      + toShortDate_(new Date()) + "):");
    weeks.forEach(function(w, i) {
      Logger.log("   Week " + (i + 1) + ": " + w.fromStr + " → " + w.toStr + "  (" + w.label + ")");
    });
    Logger.log("📊 Exec Q&A will compare: Week " + (weeks.length - 1) + " vs Week " + weeks.length);

    // Deep window — what the dashboards' Monthly/Quarterly views are capped by.
    var rawWeeks = getLastNWeeks_(CONFIGJ.RAW_HISTORY_WEEKS);
    var expandWeeks = getLastNWeeks_(
      Math.min(CONFIGJ.EPIC_EXPAND_WEEKS, CONFIGJ.RAW_HISTORY_WEEKS));
    Logger.log("📅 Jira Raw deep window: " + rawWeeks.length + " weeks, "
      + rawWeeks[0].fromStr + " → " + rawWeeks[rawWeeks.length - 1].toStr);
    Logger.log("   Epic expansion window: " + expandWeeks.length + " weeks, from "
      + expandWeeks[0].fromStr);
    if (CONFIGJ.START_ISO_WEEK) {
      Logger.log("⚠️ START_ISO_WEEK is set to \"" + CONFIGJ.START_ISO_WEEK
        + "\" — that is a FIXED anchor and grows the narrative window by a week "
        + "every week until the export times out. It should be null.");
    }
  }



  // ============================================================
  // 🔐  API KEY SETUP — Run setAPI__Jira() once to store your token
  // ============================================================



  function getAPI__Jira() {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty("ADMIN_AC") !== "035X")
      throw new Error("❌ Access not permitted. Run setAPI__Jira() first.");
    const key = props.getProperty("API__Jira");
    if (!key) throw new Error("❌ Jira API token not found. Run setAPI__Jira() first.");
    return key;
  }

  // ============================================================
  // 🚀  GETTING STARTED
  // ============================================================
  // 1. Run setAPI__Jira()         → paste your Jira API token, run once, then clear it.
  //    Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens
  //
  // 2. Confirm CONFIGJ.JIRA_EMAIL  → must match the account that owns the token.
  //
  // 3. Verify CONFIGJ.SPACES       → project keys must match your Jira instance.
  //
  // 4. Verify custom field IDs     → STORY_POINTS_FIELD, EPIC_LINK_FIELD.
  //    Discover yours at: https://servicerocket-coe.atlassian.net/rest/api/3/field
  //    If Story Points column is all 0 after first run, the field ID is wrong.
  //
  // 5. Run previewWeekWindows()   → verify the 3 week windows look correct in Logs.
  //
  // 6. Run testJiraConnection()   → should return sample issues with keys + summaries.
  //
  // 7. Run runJiraEpicTracker()   → writes "Jira Raw" + "Exec Q&A".
  // ============================================================OINTS_FIELD, EPIC_LINK_FIELD.
  //    Discover yours at: https://servicerocket-coe.atlassian.net/rest/api/3/field
  //    If Story Points column is all 0 after first run, the field ID is wrong.
  //
  // 5. Run previewWeekWindows()   → verify the 3 week windows look correct in Logs.
  //
  // 6. Run testJiraConnection()   → should return sample issues with keys + summaries.
  //
  // 7. Run runJiraEpicTracker()   → writes "Jira Raw" + "Exec Q&A".
  // ============================================================
