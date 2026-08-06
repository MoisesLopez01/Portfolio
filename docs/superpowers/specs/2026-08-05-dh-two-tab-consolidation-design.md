# Delivery Health — Two-Tab Consolidation Design

**Date:** 2026-08-05 (2026.W32)
**Status:** Approved in brainstorming session (visual companion + terminal Q&A); user review pass applied 2026-08-05 (small-n guard, Hours eligibility, scope tags, epic spine deferred, tab renamed 🎯 Actions)
**Files affected:** `docs/superpowers/delivery-health-dashboard/Code.js`, `Dashboard.html`, `render-smoke.js`, `README.md`
**Supersedes as UI surfaces:** 🌊 Flow tab (spec 2026-08-05-flow-metrics), 👥 People tab, 🧪 Data Hygiene tab. The metrics and data passes behind them all survive — only the tab homes change.

---

## 1. Problem

The dashboard has grown to six tabs (📊 Executive · 🎯 Headroom · 🌊 Flow · 👥 People · 🧪 Data Hygiene · 🔒 Access). Readers wade through overlapping surfaces to answer two questions: *are we healthy?* and *who/what needs action?* The user wants a report that is not overcrowded, lands its impact at first glance, and adopts the modern motion language of the gas-portfolio site (`docs/superpowers/gas-portfolio/index.html`).

## 2. Decision log (user choices, 2026-08-05)

| Decision | Choice |
|---|---|
| Target structure | **Option C**: 2 content tabs — rebuilt 📊 Executive one-pager + 🎯 Actions — plus admin-only 🔒 Access |
| Theme | **Option A**: ServiceRocket cream stays the default; existing dark toggle untouched; modernity via motion + hierarchy |
| Executive blocks | KPI strip + **1** Comparison chart + **3** People-signals block + **5** Data-trust strip, in that order. Secondary flow row rejected; epic spine not included (reclassified **deferred** in review — §10) |
| Flow metrics kept | **All five live** (Lead Time, Throughput, Backlog, WIP, Bug Count) join the KPI strip as a compact tier. Absent placeholders (Cycle Time, Flow Efficiency) stop rendering |
| Person-signal population | **Shared Open ↔ Resolved toggle** with the 🧬 matrix (one chip strip scopes both; Open default) |
| Surviving tools | CSV + PNG exports, hygiene gaps queue, per-person drill-down — all move to the Actions tab |
| Person surface | **Full-roster RAG signal table** (every active employee, sortable columns) replaces the sample's Celebrate/Coach panels; lives on the Actions tab; Executive shows a counts-only summary that deep-links to it |
| Added late | **Billable / non-billable hours per person** — simple stacked-bar column in the roster |
| Review pass (2026-08-05) | Small-n grading guard; Hours column reuses opportunity-table eligibility; epic spine reclassified **deferred**, not rejected; scope tags on every tile; tab renamed 🎯 **Actions** (was "Accountability" — accurate but punitive as a first word, and it framed the matrix/gaps queue — which are about fields and requirements — under a people-blame banner) |

## 3. Information architecture

New `VIEWS` array (Dashboard.html):

```
📊 Executive id "exec"    roles: null               (open to every resolved role)
🎯 Actions   id "actions" roles: ["admin","viewer"] (inherits today's Headroom gate)
🔒 Access    id "access"  roles: ["admin"]
```

Removed: `flow`, `people`, `hygiene`, and the old `trend` id (its content moves into the Actions tab). Every existing deep link re-routes:

- `showHygiene_()` (linked from suppressed KPI cards) → `switchView_("actions")` + scroll to the gaps queue.
- The Headroom "What's missing" link → same.
- Role gating stays enforced inside `switchView_` (forbidden id → `exec`), exactly as today.

`STATE.view` default stays `"exec"`. `STATE` keys for retired surfaces (`expandedWeeks`, `openDetail`) are kept — the drill-down reuses them.

## 4. 📊 Executive tab (top-down, four blocks)

### 4.1 Tiered KPI strip (one block, two visual tiers)

- **Hero tier** — the four verdict tiles exactly as today: On-Time Delivery, Forecast Accuracy, Utilization, Quality/Rework. Targets, RAG grammar, suppression-below-gate behaviour, honesty notes: all unchanged. Forecast + Utilization remain margin-tier (`MARGIN_METRICS_`) and are not rendered for open-access guests, as today.
- **Compact tier** — the five flow metrics as smaller tiles in a row beneath the heroes, inside the same panel: Lead Time (median, p85 in tooltip), Throughput, Backlog, WIP, Bug Count. They keep `flowTileHtml_`'s neutral grammar (target: null → no verdict colour, neutral ▲/▼ deltas, confidence chips, sparklines). Backlog/WIP keep their snapshot semantics including the `flowUnfiltered_()` trend rule.
- The two **declared-absent** flow tiles (Cycle Time, Flow Efficiency) are removed from the UI. Their `status:"absent"` registry entries and reasons stay in the metrics registry / Data Reference — the registry remains the record of what is deliberately not measured.
- PNG button captures the whole strip (both tiers).

### 4.2 Comparison chart

Unchanged mechanics (`renderCompare_`, chip selector, dimension picker). Two changes:

- The metric chip strip **gains the flow metrics** (Lead Time, Throughput, Backlog, WIP, Bugs) so they can be compared by Region/Team/family like the verdict metrics. Margin-tier chips stay hidden from guests as today.
- Bars adopt the grow-in animation (§7).

### 4.3 People signals summary (margin-gated)

- Rendered only when `canSeeMargin_()` — open-access guests never see it; the Executive tab stays safe to project.
- Content: `🟢 N on track · 🟡 N watch · 🔴 N need action · Xh recoverable → open the roster`. Counts come from the same per-person grading the Actions roster uses (§5.2) under the **current filters**; recoverable hours from the existing opportunity math.
- Clicking it deep-links: `switchView_("actions")` with the roster pre-sorted "biggest opportunity first".
- **Counts only, never names, on this tab** — consistent with the standing "no names in widely-read surfaces" rule; the named table lives behind the Actions-tab gate.

### 4.4 Data-trust strip

Four small fill-rate tiles, org-wide (deliberately unfiltered, like the old Hygiene view):

| Tile | Source (existing) | Gate |
|---|---|---|
| Estimate coverage | hygieneBuckets est fill | registry `forecast` coverage gate |
| Due-date fill | hygieneBuckets due fill | registry `onTime` coverage gate |
| Logged fill | hygieneBuckets time fill | registry `forecast` coverage gate |
| Roster join | resAssigned / attr split | 0.95 (matrix's `attr` gate) |

Each tile: fill % vs gate, coloured horizontal bar (`--c-good`/`--c-warn`/`--c-bad` grading same as matrix cells), one-line "why it matters" from the registry. This strip is the executive's replacement for the Data Hygiene tab; the drill-downs live one tab over.

### 4.5 Scope tags (review pass 2026-08-05)

Three time-scopes coexist on this tab — hero tier is period + filtered, Backlog/WIP are snapshot with the `flowUnfiltered_()` trend rule, the trust strip is deliberately org-wide and unfiltered. Each rule is individually correct, but the tab is built to be projected in a room, and "why didn't the trust strip move when I filtered to SEA?" is an inevitable question. Every tile therefore carries a **micro scope tag** in its corner (uppercase, muted, `--muted` colour, tooltip with the full rule):

| Tag | Meaning | Where |
|---|---|---|
| `PERIOD` | analysis period, follows filters | hero tier, Lead Time, Throughput, Bug Count, comparison chart |
| `SNAP` | snapshot at last export, follows filters, no period | Backlog, WIP, signals summary (Open scope) |
| `ORG` | whole org, ignores filters and period | data-trust strip |

The same tag vocabulary is reused on the Actions roster: signal column headers tag `SNAP`/`PERIOD` with the Open ↔ Resolved toggle, and the Hours header always tags `PERIOD` (§5.2).

## 5. 🎯 Actions tab (top-down, four blocks + exports)

Header row: CSV + PNG buttons (top-right), re-pointed at the new tables. CSV = the signals roster (one row per person, all signal values + hours split); the old person-per-period grid CSV retires with the grid.

### 5.1 Where the headroom is

The existing opportunity table (`renderOpportunity_`, `oppRows_`) **unchanged in math and presentation**: cohort-norm baseline under active filters, ranked recoverable hours, ramping hires shown but never counted, `STD_MIN_PERIODS` guard.

### 5.2 People signals roster (new)

One row per **active employee in the dashboard population** (the same tracking-mandated-families population the dashboard already models), respecting the universal filters and population lens. The attribution index is broader than the population (it includes the whole active roster, per the 2026-08-04 decision); issues attributed to someone outside the population/lens simply surface no row and are excluded from the Executive summary counts — same behaviour as every other person-attributed metric.

**Column registry** (client-side array, same pattern as `TYPE_FIELDS_`): each entry = `{ key, label, tooltip, gate | gateOf, cellRenderer, sortFn, csv }`. Adding a future signal = registering a column. Launch set:

| Column | Type | Definition |
|---|---|---|
| Person | identity | name + ▸ drill-down toggle; job title in tooltip |
| n | count | issues in the selected population (Open or Resolved) attributed to the person |
| Due date | RAG signal | share of the person's issues carrying a due date — **same predicate as the 🧬 matrix's `due` field**, graded against the same gate |
| Estimate | RAG signal | share carrying an original estimate — matrix `est` predicate + gate |
| Logged | RAG signal | share carrying logged time (Time Spent > 0) — matrix `time` predicate + gate |
| Hours | info (no RAG) | compact stacked bar: billable / non-billable / idle capacity, from the existing per-person Tempo×NetSuite split (the numbers the old People-grid workload bars drew). **Always scoped to the analysis period**, regardless of the Open ↔ Resolved toggle (worklogs are period-shaped; a backlog snapshot has no hours) — the column header carries a `period` scope tag (§4.5) because it sits beside snapshot-scoped signal columns. **Eligibility reuses the opportunity table's logic** (review pass 2026-08-05): for people `oppRows_` marks ramping/ineligible, the idle segment is not drawn (the bar shows billable/non-billable only, with a "ramping" chip) — a week-6 hire's or a manager's raw idle segment is exactly the false signal the old Headroom list was distrusted for, and the two blocks share a tab so they must not contradict each other. Billable-share sort treats ineligible rows as null (always sorted last). Exact hours in tooltip + CSV |
| Overall | RAG signal | worst of the three RAG signals ("a chain is as compliant as its weakest field"); "—" cells are ignored; all-"—" → overall "—" |

**Cell grammar:** RAG dot + person's own fill % + offending count (e.g. `🔴 33% · 4 missing`). Grading thresholds are the matrix's: ✔ at/above the field's gate · ▲ under 10 pts below · ✖ 10+ pts below. Zero issues in the selected population → `—` (ungraded), never red: no data is not a failure.

**Small-n guard (review pass 2026-08-05):** the matrix gates were calibrated for aggregates; at n = 1–3 a single missing field renders a statistically meaningless red at full visual weight (`🔴 0% · 1 missing`). Below `CONFIG_DH.SIGNAL_MIN_N` (**4**, a named config constant like `STD_MIN_PERIODS`) the cell is rendered **grey/ungraded with the fill % and offending count still shown** and a "below minimum n" tooltip. Ungraded-by-small-n cells do not feed the Overall column, and rows whose grading is entirely small-n are **excluded from the Executive summary's 🟢/🟡/🔴 counts** — the summary's tooltip states "N people ungraded (fewer than 4 issues)" so they are visible without inflating the reds. This is the roster's equivalent of the opportunity table's `STD_MIN_PERIODS` guard.

**Population toggle:** the roster sits under the **same Open ↔ Resolved chip strip as the 🧬 matrix** (`STATE.typePop`), placed once above both. Open (default) = actionable backlog snapshot, ignores the period picker (same rationale and ⓘ note as the matrix). Resolved = the analysis window, explains the period's numbers.

**Sorting:** every column sortable; default = biggest opportunity first (most ✖ signals, then most offending issues). The Executive summary deep-link applies this sort.

**Drill-down (▸ per row):** the person's open items (key, summary, status, priority, due week, remaining hours — the existing `backlogByPerson_` payload, `BACKLOG_MAX_ITEMS` cap noted in the panel) plus their recent weekly tracked/planned/billable detail (the data the old People grid rendered per week). Reuses `STATE.openDetail`.

**Naming rule:** this roster is the deliberate, gated exception to "no names against failures" — it exists to route coaching, sits behind the admin/viewer gate, and pairs every red with the exact records to fix (the drill-down), so it reads as a work queue, not a blame board.

### 5.3 🧬 Field fill by issue type

`typeMatrixHtml_` moved as-is: same chips (now shared, §5.2), same gate grading, uniform-column footnote, impact ordering, PNG button. No logic change.

### 5.4 Gaps queue

The Data Hygiene work queue (gap → owning requirement ID → committed week) moved as-is beneath the matrix. Keeps "requirements, not people" naming. The old `viewHygiene` pane and tab are deleted; `renderHygiene_`'s pieces are refactored into the Actions renderer rather than kept as a hidden view.

## 6. Backend: `personHygiene_` rollup (approach A — server-side)

New pure pass in Code.js, run next to `typeHygieneBuckets_` over the **same `issues` array** (every row, epics included — the matrix's population), attributing via the existing `resolvePerson`/attribution index (leavers already excluded upstream):

```
personHygiene: {
  "<display name>": {
    open:     { n, due, est, logged },   // counts, not rates — client computes %
    resolved: { n, due, est, logged, isos: implicit via window }
  }, …
}
```

- Predicates identical to `typeHygieneBuckets_` (`due` present · `estSec > 0` · `spentSec > 0`) so the roster and the matrix can never disagree about the same record.
- Resolved side is bucketed by ISO week (like other buckets) so the client can scope it to the selected analysis period; open side is a snapshot (no iso), mirroring `flowOpenBuckets`.
- Payload cost ≈ one small object per person — fits the gzip-chunk cache comfortably.
- **Schema v21 → v22** (the spec's earlier v17→v18 reference was stale — `DH_SCHEMA_VER_` is 21 as of 2026-08-05; comment block updated), `bustDeliveryCache_` on deploy. Pre-v22 cached payloads: the roster renders the same "Not in this payload — ↻ Refresh" empty-state pattern as the matrix.
- **No exporter change, no export re-run** — Jira Raw already carries Due Date, Original Estimate (sec), Time Spent (sec), Assignee.
- Rejected alternative (B): shipping slim per-issue records to the client — an order of magnitude more payload against the chunked-cache design, for flexibility the column registry already provides.

## 7. Theme & motion

Cream default, dark toggle untouched, all existing tokens kept. Modernization within the token system:

- Slightly larger hero-tile numbers; softer card radii/shadows on the portfolio's scale; one `--orbe` pulse dot in the header next to the as-of line.
- **Motion, CSS-first, all inside `@media (prefers-reduced-motion: no-preference)`:**
  - Tab switch: outgoing pane fades, incoming pane fades + 8px upward slide, ~150ms, portfolio `--ease` curve.
  - First render per load: tiles stagger-reveal top-down (60ms steps); hero numbers count up once; comparison + workload + trust bars grow in with the portfolio `--spring` curve.
  - Hover lift on tiles and roster rows (translateY(-2px) + shadow step).
  - **One-time only:** filter/period/sort re-renders must not re-animate. Implementation: a `bodyLoaded` class set after the first `renderAll_`, animations keyed off its absence.
- Charts stay on the validated CVD-safe mark tokens; no palette change.

## 8. Testing

- **`render-smoke.js`:** tab count 6 → 3; new assertions — signals roster renders with RAG cells and sorts, Executive summary counts match roster grading, **small-n rows render grey and are excluded from summary counts (a 1-issue person with a missing due date must not be 🔴)**, **Hours bar suppresses idle for a ramping fixture person and sorts them last**, scope tags present on hero/flow/trust tiles and roster headers, trust strip renders four tiles with gates, flow compact tier renders five tiles and no absent placeholders, retired panes (`viewFlow`, `viewPeople`, `viewHygiene`) absent, deep links land on the Actions tab, reduced-motion class present.
- **Code.js unit test `_test_personHygiene_`** alongside `_test_typeHygieneBuckets_`: attribution via resolver, open/resolved split, predicate parity with the matrix on a shared fixture, zero-issue person absent from map, epic rows counted, unattributed issues excluded.
- Manual QA: guest (open-access) sees no Utilization/Forecast tiles, no signals summary, no Actions tab; admin sees all; dark-mode spot check on the new surfaces.

## 9. Deploy (order matters)

1. Push `Code.js` + `Dashboard.html` (single GAS project, one deploy).
2. Run `bustDeliveryCache_` (schema v22 makes stale cache unreadable anyway; bust makes it immediate).
3. Smoke-check live: all four hero numbers move, roster populates, matrix + gaps queue intact.
4. Update `README.md` (tab docs) and post the GTT-605 status comment (dated, per ticket style).

No exporter deploy, no export re-run, no Region/Team dependency change (still blocked on Gon upstream — unaffected).

## 10. Out of scope

- Dark-first "mission control" theme (user: "we already have the dark theme to change it later").
- Secondary flow row (rejected block option — its metrics live in the compact KPI tier instead).
- **Epic spine table — deferred, not rejected** (review pass 2026-08-05): the projected-slip read ("what will slip", remaining estimate ÷ trailing burn vs due week) is the highest-leverage thing this dashboard doesn't do, and the forward-looking audit was an explicit earlier requirement. It is deferred **until estimate coverage reaches its gate** — the projection math is meaningless below it (estimate coverage is at 38% vs a 90% gate today), and shipping it now would publish confident-looking dates built on one-third coverage. The roster drill-down's due-week + remaining-hours is raw material for it, not a substitute. Revisit when the trust strip shows Estimate coverage at gate.
- Celebrate/Coach panels (superseded by the full-roster signals table).
- The sample's level-rate × tenure-ramp norm engine — the existing cohort-norm baseline stays.
- New signal columns beyond Due/Estimate/Logged/Hours (the registry makes them cheap later; none ship now).
- Any exporter (`Jira Backlog.js`) change.
