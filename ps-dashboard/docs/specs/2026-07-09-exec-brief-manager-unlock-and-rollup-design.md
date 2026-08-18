# Exec Brief — Manager Unlock + Cross-Team Executive Rollup

**Date:** 2026-07-09 (2026.W28)
**Status:** Approved design, pending implementation plan
**Files touched:** `PS Dashboard.html` only (no backend changes)
**Depends on:** org team toggle (2026-07-08 spec), per-team prefetch (report-load-performance,
2026-07-09), team-aligned scoring (2026-07-09 spec — deployed together or after it)
**Jira:** GTT-514 (Contribution Report V3)

## Problem

The 📋 Team Executive Brief is the dashboard's signal engine (Facts → Highlights /
Notes / Concerns / Trends with false-alarm suppression), but:

1. It is `roles: ["admin"]` — the managers whose job it simulates cannot see it.
2. It is scoped to one toggle team at a time — C-suite readers have no side-by-side
   view of Services vs R&D vs Sales & Success.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Rollup audience | **Admins + Viewers** (full-roster roles). Managers never see it — cross-team comparison exceeds org-tree scope |
| Rollup placement | **Strip at the top of the Exec Brief tab** — one executive-reading surface; rollup stays constant while the toggle switches the detailed brief below |
| Manager action buttons | **📋 Copy only.** 🚀 Publish to Confluence and ✨ Enhance with Gemini stay admin-only (shared official page; paid API) |
| Rollup data path | **Client-side from prefetched payloads** (`STATE.teamData`) — the signal logic lives client-side and stays single-source; zero backend changes |

## 1. Manager (and viewer) unlock

- `VIEWS` entry `execbrief`: `roles: ["admin"]` → `roles: ["admin", "viewer", "manager"]`.
  Viewer joins because the rollup (admin+viewer) lives inside this tab, and viewers
  already see every metric full-roster elsewhere — the brief adds no new data surface.
  Tab visibility, `applyRoleToNav_()`, and the `switchTab()` role gate all derive from
  `VIEWS`; no other nav change.
- **Button gating** (in the brief header render): 🚀 `tbPublishBtn` and ✨ `tbGeminiBtn`
  render only for role `admin`. 📋 Copy renders for every role that can open the tab.
  Gating uses the same client role source the `VIEWS` gating already reads.
- **Content:** unchanged. Manager payloads are already scoped server-side (org tree ∩
  team); `hasMetric_()` already trims tracked/planned signals on reduced-metric teams;
  kudos names in a manager's brief are their own reports (appropriate). The week
  selector (`ebWeekSelect`) and Month/Quarter period mode work as-is.
- **Backend:** zero changes — the brief is computed client-side from the scoped payload.

## 2. Cross-team executive rollup

### Placement & gating

A rollup strip renders at the top of `#tabExecBrief`, above the per-team brief, when
**both** hold:

1. Client role is `admin` or `viewer` (explicit gate), and
2. `meta.availableTeams.length > 1` (single-team scopes hide the strip entirely).

Managers structurally cannot render it (single-scope payloads) — the role gate is
defense in depth on top of that.

### Data path

- `generateTeamBrief(weekLabel, prevWeekLabel)` gains an optional third parameter
  `data`, defaulting to the global `DATA`. The existing weekly brief call sites are
  untouched. Internal reads (`DATA.teamSummary`, `DATA.weeks`, `DATA.trackedHistory`,
  `DATA.phByWeek`, `DATA.meta`, employee lists) resolve against the parameter.
- The rollup iterates `meta.availableTeams` in registry order (Services, R&D,
  Sales & Success). The active team's row uses live `DATA`; other teams use their
  prefetched payloads in `STATE.teamData[key]`.
- **Population:** rollup rows always use each team's **unfiltered FTE** population —
  the FTE/crew toggle and job-family/level filters describe the active team's detail
  view, never the comparison. (The parameterized generator therefore takes its
  employee list from the payload directly, not from `getFilteredEmployees()`, when a
  non-default `data` is passed.)
- **Week alignment:** all rows use the week selected in `ebWeekSelect`. Week labels
  are shared ISO keys (`2026.WNN`) across team payloads. A team payload lacking the
  selected week renders "no data for <week>" in that row.

### Row content

One row per team: `Team · headcount | Trajectory | Top concern | Top highlight`.

- **Trajectory (▲ / ▶ / ▼):** derived from week-over-week deltas of the metrics the
  team has:
  - Goals compliance WoW (every team has weekly goals), flat band ±2 percentage points.
  - Tracked avg-hours WoW where `team.metrics` includes `tracked`, flat band ±0.5 h.
  - Both directions up → ▲; both down → ▼; mixed or both flat → ▶. Single-metric
    teams (no tracked) use the goals direction alone with the same flat band.
  - Missing prior-week data → ▶ with title-text "no prior week to compare".
- **Top concern:** `concerns[0]` from that team's generated brief (generation order
  already leads with Goals, the highest-signal metric). Empty list → the existing
  default "No critical concerns — maintain current trajectory…" text, styled muted.
- **Top highlight:** the first entry in `highlights` that does **not** contain `★`
  (kudos per-post lines carry individual names and are marked with ★ stars). This
  plus count-based concerns keeps the rollup **names-free**, consistent with the
  counts-not-names rule for summary surfaces.

### Freshness & refresh

- A team not yet in `STATE.teamData` renders a "loading…" cell; the prefetch success
  handler re-renders the strip when the Exec Brief tab is visible.
- A team whose prefetch previously failed (`_prefetchFailed`) renders
  "not loaded — switch to this team once to load it".
- Non-active-team rows are as fresh as their cached payloads (≤ the cache-warm
  interval — identical to what toggling to that team would show). The Refresh button
  keeps its existing active-team-only semantics; no rollup-specific refresh.

### Scope cut — v1 is weekly only

The rollup renders only in **Week** granularity. In Month/Quarter mode the strip
collapses to one muted line: "Cross-team rollup is weekly — switch to Week view."
Extending to period buckets requires parameterizing `generatePeriodBrief` and
`computePeriodStats_` as well; that is an explicit later phase, not v1.

## 3. Error handling

| Condition | Behavior |
|---|---|
| Role is manager, or single team in scope | Strip not rendered at all |
| Team payload not yet prefetched | "loading…" cell; fills on prefetch completion |
| Team prefetch failed | "not loaded — switch to this team once to load it" |
| Selected week missing from a team's payload | "no data for <week>" in that row |
| No prior week for trajectory | ▶ with explanatory title text |
| Period (Month/Quarter) mode | Strip collapses to the one-line weekly note |

## 4. Testing (manual QA matrix — no Node harness exists for the UI)

1. **Admin:** rollup strip with one row per available team + all three action buttons.
2. **Viewer:** rollup strip; 📋 Copy only; everything read-only.
3. **Manager, single-team scope:** Exec Brief tab visible, scoped brief renders,
   no rollup strip, 📋 Copy only.
4. **Manager on a reduced-metric team:** no tracked/planned signals in their brief.
5. **Rollup consistency:** each row's concern/highlight matches what the full brief
   shows after toggling to that team (same week).
6. **Cold cache:** rows show "loading…" then fill as prefetch completes.
7. **Names-free check:** no individual names anywhere in the strip (kudos ★ lines
   excluded).
8. **Week change:** changing `ebWeekSelect` re-renders all rows to the new week.
9. **Period mode:** strip collapses to the weekly note; returns in Week mode.
10. **Dark mode** rendering of the strip.

## Deploy

`PS Dashboard.html` only; no `PS_CACHE_VER` bump (payload shape unchanged). Ship with
or after the team-aligned scoring deploy (2026.W28).

## Out of scope (later phases)

- Period-mode (Month/Quarter) rollup.
- Severity-ranked top-3 "Executive TL;DR" sentence above the strip.
- Cross-team rollup on any surface outside the Exec Brief tab (e.g. Confluence publish
  of the rollup).
- COE/Sales HubSpot signals (arrive with the sales metric-set phase and flow into the
  brief and rollup automatically via `team.metrics`).
