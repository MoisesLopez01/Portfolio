# Flow Metrics view (🌊 Flow tab) — Design

**Date:** 2026-08-05 (2026.W32)
**Status:** Approved (user, 2026-08-05)
**Owner:** Delivery Health Dashboard (`delivery-health-dashboard/`)
**Exporter:** `Jira Backlog.js` → v3.9.0

## 1. Problem

The Delivery Health Dashboard answers *are we on target* with four Metrics Dictionary
tiles. It does not answer *how does work move through the system*. The classic flow
metrics — Lead Time, Cycle Time, Throughput, Backlog, Flow Efficiency, WIP, Bug Count —
are mostly computable from data `Jira Backlog.js` already exports, but nothing computes
or renders them.

## 2. Decisions (all user-approved 2026-08-05)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Placement | **New 🌊 Flow tab**, all roles | Executive stays the 4-tile Dictionary view; flow is a different question with a different reader |
| D2 | Changelog | **`CONFIGJ.FETCH_CHANGELOG` stays `false`** in this release | User decision — no changelog changes to `Jira Backlog.js` yet. Cycle Time and Flow Efficiency ship as declared-absent tiles |
| D3 | Exporter scope | **Bug fetch + snapshot log OK; changelog frozen** | The only two exporter additions are a `Jira Bugs` tab and a `Flow Snapshots` append log |
| D4 | Issue grain | **Non-epic everywhere** (Stories/Tasks/Sub-tasks) | Consistent with `ONTIME_SCOPE = "delivery"`; an epic's lead time is a programme lifecycle; epic+child estimates would double-count the sums |
| D5 | Architecture | **Approach A: derive in dashboard + append-only snapshot log** | Metric definitions stay in `METRIC_REGISTRY_` (the exporter ships facts, never metrics); WIP/Backlog get a real trend that accumulates forward |
| D6 | Targets | **`target: null` — no RAG in v1** | These metrics have no agreed target. Tiles render neutral (value + trend + confidence). Inventing a target would be worse than showing none; targets are a Services Director decision to add later via the registry |

## 3. Metric definitions

All five live metrics measure the **non-epic** population (`isEpic === false`, the same
substring rule `readJiraRaw_` already applies) and join the roster via Assignee like every
existing Jira tile, so the header filters (Region / Team / PM / Job family) scope them.
Interns (I1) are excluded from published rates per the standing rule.

### 3.1 Lead Time — live

- **Formula:** median calendar days from `Created` → `Resolution Date`, over non-epic
  issues resolved in the period. **Companion: p85** — the tail is the finding; a median
  alone hides the issues that sat for a quarter.
- **Source:** `Jira Raw` — `Created` (col 9), `Resolution Date` (col 11). Both read by
  header name.
- **Coverage:** share of resolved issues carrying both dates (expected ≈100% — `created`
  is always present; a resolved issue nearly always has `resolutiondate`, with
  `Completed Date` as the existing fallback per `dateResolvedOf_`'s convention).
- **Trend:** full 52-week history from day one (both dates are historical facts).
- **Unit note:** calendar days, not working days — stated on the card ⓘ.

### 3.2 Cycle Time — declared absent

Needs the date of the **first transition into In Progress**, which only the issue
changelog carries. `CONFIGJ.FETCH_CHANGELOG` is `false` (D2). The tile renders in the
declared-absent style (like CSAT on Quality): *"needs first-In-Progress date from the
Jira changelog — not yet exported (`FETCH_CHANGELOG` off)"*.

**Rejected approximation:** `resolutiondate − statuscategorychangedate` is ≈0 for Done
issues — `statuscategorychangedate` is the *last* category change, i.e. the resolution
moment itself. There is no honest changelog-free cycle time; publishing a wrong one under
the right name is worse than an absent tile.

### 3.3 Throughput — live

- **Formula:** Σ `Original Estimate` (sec → hrs) over non-epic issues **resolved** in the
  period.
- **Source:** `Jira Raw` — `Original Estimate (sec)` (col 23), `Resolution Date`.
- **Coverage:** share of resolved non-epic issues carrying a non-zero estimate.
  **Deviation recorded in the registry:** unestimated work delivers invisibly here — the
  confidence chip carries the estimated-share, and the card states
  *"N of M resolved issues carried an estimate"*.
- **Trend:** full history from day one.

### 3.4 Backlog (Inventory) — live, snapshot metric

- **Formula:** Σ remaining estimate (hrs) over **open, assigned, non-epic** issues in
  status category **To Do** — "waiting to start", per the user's definition. Remaining
  estimate = `max(0, Original Estimate − Time Spent)`. Companion: item count.
- **Source (current value):** `readJiraRaw_().openIssues` (Week = `"Open"` rows) split by
  `Status Category`; requires `CONFIGJ.OPEN_BACKLOG_ENABLED = true` (it is).
- **Source (trend):** new `Flow Snapshots` tab (§4.2) — last snapshot per period.
- **Coverage:** share of To-Do open issues carrying an estimate.

### 3.5 Work In Progress — live, snapshot metric

- **Formula:** count of **open, assigned, non-epic** issues in status category
  **In Progress**. Same semantics as the exporter's `fetchActiveWIP_()` (which never
  writes to the sheet and is not the data path).
- **Source:** same `openIssues` split; trend from `Flow Snapshots`.
- **Coverage:** always 100% (a count over rows that exist).
- Backlog (To Do) and WIP (In Progress) **partition the open assigned book** by status
  category — the two tiles read as one system, and the drill-through can show the split.

### 3.6 Flow Efficiency — declared absent

Ratio of active time to total elapsed time. Needs per-status dwell from the changelog —
the most code and the most payload of the whole list, and additionally requires an agreed
"active statuses" vocabulary. Declared absent with that reason. Revisit only after
Cycle Time proves the changelog path (cost, completeness — search-API changelog pages are
capped per issue, so long-lived issues may truncate).

### 3.7 Bug Count — live

- **Formula:** count of Bug issues **created** in the period. **Companion:** bugs
  resolved in the period (so the tile can say whether the bug book is growing).
- **Source:** new `Jira Bugs` tab (§4.1).
- **Relationship to Quality/Rework:** none — Quality is `(reopened OR Rework-linked) ÷
  delivered` and bugs feed neither leg. No duplicate tile, no companion on Quality.
- **Noise rule:** `isNoiseIssue_` applies — a bug closed *Won't Do / Duplicate / Canceled*
  was a report, not a defect. Recorded in the registry as a deviation from the raw
  "defects created" reading.
- **Trend:** full history from day one (created date is a historical fact).

### 3.8 Registry entries

Five new `METRIC_REGISTRY_` entries (leadTime, throughput, backlog, wip, bugCount), each
with: name, definition, formula, sources, grain, coverage gate, `owner: "Delivery
leadership"`, `paramOwner: "Services Director"`, `target: null`, deviations. Two
declared-absent entries (cycleTime, flowEfficiency) follow the CSAT precedent: present in
the registry with `status: "absent"` and the reason, so the tile renders itself from the
registry like everything else. Coverage gates (proposed, admin-editable like the rest):
Lead Time 90%, Throughput 60%, Backlog 60%, WIP —, Bug Count —.

## 4. Exporter changes — `Jira Backlog.js` v3.9.0

`FETCH_CHANGELOG`, `EXEC_ISSUE_TYPES`, `RAW_HEADERS` and every existing tab are
**untouched**. Bug rows must never land in `Jira Raw`: every consumer of that tab assumes
the EXEC_ISSUE_TYPES population, and Bug rows would silently move On-Time, Throughput and
the hygiene funnels.

### 4.1 `Jira Bugs` tab (new, full rewrite per run)

- **JQL:** `issuetype = Bug AND created >= <window start>` scoped to the same projects as
  the main export (same space-scoping helper), 52-week window (`EXPORT_HISTORY_WEEKS`).
- **Filter:** `isNoiseIssue_` (§3.7).
- **Columns:** Key, Summary, Project, Priority, Status, Status Category, Created,
  Resolution Date, Resolution, Assignee. Append-only contract from day one — consumers
  read by header name.
- Same "Generated:" footer convention as `Jira Raw` so staleness detection works the
  same way.

### 4.2 `Flow Snapshots` tab (new, append-only)

- One row **appended per export run**: Generated timestamp, ISO week (`YYYY.WN`),
  WIP count, Backlog hrs, Backlog item count — computed by the exporter *as counts over
  the same open rows it writes*, not as metric definitions (the dashboard recomputes
  current values from `openIssues`; snapshots exist only because history cannot be
  reconstructed later).
- The snapshot columns follow §3.4/§3.5 **verbatim** (non-epic, assigned, To Do vs
  In Progress, remaining-estimate floor). This is a necessary duplication of the
  definition — snapshots cannot be recomputed later — so if the definition ever changes,
  older snapshot rows stay as history under the old definition and the trend carries a
  `✎ definition changed` marker, the same convention the registry already uses.
- **Retention:** rows older than the shared 52-week dial pruned on write.
- **Multiple runs per week:** all kept; the dashboard takes the **last row per period**.
- **Header row + footer** follow the existing tab conventions.

**Snapshot scope caveat (recorded in the registry deviations):** snapshot rows are
whole-population (the exporter knows nothing of dashboard filters). When header filters
are active, the trend sparkline is hidden and the card states *"trend available for the
full population only"* — a filtered current value over an unfiltered trend would be a
lie shaped like a chart.

## 5. Dashboard changes

### 5.1 `Code.js`

- `readJiraBugs_()` and `readFlowSnapshots_()` — tolerant readers; a missing tab is
  **absent, not stale** (existing pattern): the dependent tiles render *"export predates
  Jira Backlog.js v3.9.0"* and everything else is unaffected.
- `readJiraRaw_` gains a parsed `created` date on issue records (column already exported;
  currently unread) — needed by Lead Time.
- `buildDeliveryModel_()` computes the five live metrics per period under the same
  bucketing the existing Jira tiles use, ships them in the payload alongside
  `meta.registry` additions.
- `DH_SCHEMA_VER_` bump — payload shape changes; `bustDeliveryCache_()` required on
  deploy.

### 5.2 `Dashboard.html`

- `VIEWS` array gains 🌊 **Flow** (all roles). Tab routing, renderer dispatch and role
  gating derive from `VIEWS` as today — no hand-wired navigation.
- Seven KPI cards using the existing card kit + `sparkHtml_`: five live, two
  declared-absent. `target: null` renders **neutral** — no RAG tint, no vs-target read;
  value + sparkline + vs-prior + confidence chip only.
- `METRICS_` accessor table gains the five metrics; the Trends opportunity table and the
  Executive comparison chart are **out of scope** for these metrics in v1 (they are
  utilization-hour constructs; a later pass can add a Flow breakdown chart if asked).
- Header Week/Month/Quarter chips apply to Lead Time, Throughput, Bug Count natively;
  Backlog/WIP trends resolve last-snapshot-per-period at the selected unit.
- Per-panel ⬇ PNG export like every other view.

## 6. Error handling

| Condition | Behaviour |
|---|---|
| `Jira Bugs` / `Flow Snapshots` tab missing | Dependent tiles: *"export predates Jira Backlog.js v3.9.0"*; all other tiles unaffected |
| Empty period (nothing resolved) | `—` with reason (*"no issues resolved this period"*) — never rendered as zero |
| Bugs tab present, zero bugs in period | **Real zero** — bugs are a countable absence, unlike a measurement |
| Snapshot log has <2 points at the selected unit | Current value, no sparkline, *"history accumulates from {first snapshot date}"* |
| Header filters active | Backlog/WIP sparkline hidden with the whole-population note (§4.2) |
| `Jira Raw` unreadable | Flow tab joins On-Time/Forecast in "Jira data unavailable" (existing behaviour) |

## 7. Testing

- **`Code.js` `_test_flow*_` units** (mirrored in `node-tests.js`): lead-time median +
  p85 over known fixtures; To-Do vs In-Progress partition (every open row lands in
  exactly one of Backlog/WIP); remaining-estimate floor at 0; last-snapshot-per-period
  selection including multi-run weeks; bug noise-filter expectations; missing-tab
  tolerance.
- **`render-smoke.js`**: Flow tab routes and role-gates from `VIEWS`; declared-absent
  tiles render the reason; `target: null` produces no RAG class and no vs-target
  sentence; snapshot-start sentence appears when history is short; filtered state hides
  the snapshot sparkline and shows the population note; "export predates v3.9.0" path.

## 8. Deploy order

1. `Jira Backlog.js` v3.9.0 → deploy, **run the export** (creates both tabs, first
   snapshot row).
2. Dashboard `Code.js` + `Dashboard.html` → paste/deploy.
3. Bump `DH_SCHEMA_VER_`, run `bustDeliveryCache_()`.

(Dashboard-first also works — the readers tolerate missing tabs — but exporter-first
means the Flow tab is never seen empty.)

## 9. Out of scope / future

- **Cycle Time + Flow Efficiency** — blocked on the changelog decision (D2). When
  revisited: turn on `FETCH_CHANGELOG`, add a first-In-Progress extractor (also lights up
  the existing Quality tile's `Reopened` leg, currently blank), validate changelog
  truncation on long-lived issues before trusting dwell sums.
- **Targets/RAG for flow metrics** — Services Director decision; add via registry +
  gates panel, no code change beyond the registry entry.
- **Flow breakdown on the Executive comparison chart / opportunity table** — not in v1.
- **Bug severity/priority weighting** — raw counts only in v1; the Priority column is
  exported so a weighted read needs no exporter change later.
