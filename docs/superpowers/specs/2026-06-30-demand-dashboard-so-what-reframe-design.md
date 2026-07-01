# Demand Dashboard — "So What" Reframe
**Date:** 2026-06-30  
**Status:** Design approved  
**Scope:** Project Demand Dashboard (`docs/superpowers/project-demand-dashboard/`)

---

## Problem

The current dashboard mixes three unrelated questions into one visual:

1. **Capacity/switching** — how many projects is someone on?
2. **Execution quality** — are they hitting their planned hours?
3. **Raw fidelity math** — what is the tracked ÷ planned ratio?

Percentage numbers like "800%" are artifacts of the fidelity formula when planned hours are tiny or misestimated. A manager cannot tell whether "800%" is a hero or a planning error. The Tracked vs Planned Signals panel (added 2026-06-30, commit `3bcb6e2`) restates Tempo's own ratio in a different color — it adds no new information and will be removed.

**Goal:** Replace time-compliance framing with behavior-pattern framing. Every element should answer "so what" — what does this mean, and what should a manager do about it?

---

## What Changes

| Panel | Action |
|---|---|
| Tracked vs Planned Signals | **Delete** |
| Planned vs Tracked chart | **Keep** (no changes — fidelity math belongs at org level) |
| Team Availability | **Reframe** — collapsible trend-first rows with 4-state chips |
| Project Key Heatmap | **Enhance** — add per-project collapsible people view |

---

## 4-State Behavior Model

For each person × week, one of four states is derived from `personWeekPlan` and `personWeekTracked`. Thresholds reuse existing CONFIG constants.

| State | Chip label | Chip color | Logic |
|---|---|---|---|
| Aligned | `Aligned` | Green | `planned ≥ DELIVERY_GAP_MIN_HRS` AND `tracked ≥ SWARM_THRESHOLD × planned` |
| Unplanned work | `Unplanned work` | Amber | `tracked > DELIVERY_GAP_MIN_HRS` AND `planned < DELIVERY_GAP_MIN_HRS` |
| Silent gap | `Silent gap` | Grey | `planned ≥ DELIVERY_GAP_MIN_HRS` AND `0 < tracked < SWARM_THRESHOLD × planned` |
| Escalation | `Escalation` | Red | `planned ≥ DELIVERY_GAP_MIN_HRS` AND `tracked = 0`, OR 2+ consecutive weeks of Silent gap |

Constants: `DELIVERY_GAP_MIN_HRS = 4`, `SWARM_THRESHOLD = 0.20`.

**No hours are shown in the people view.** The state chip is the signal. Hours belong to Tempo and the Planned vs Tracked chart.

### Celebration Signals

Derivable from the same data. Shown as inline badges — never converted to a score.

| Signal | Badge | Trigger |
|---|---|---|
| Reliability streak | `N-wk streak` (amber) | N ≥ 3 consecutive Aligned weeks QTD |
| Swarm response | `Swarm` (purple) | Person is in Unplanned work state this week AND at least one other team member is in Escalation this week. (Per-project tracked breakdown is not available; this is a team-level signal, not project-specific.) |
| Stabilizer | `Stabilizer` (blue) | Person active on 4+ projects (based on `personProjectPlan`) with no Escalation or Silent gap in their overall weekly state this week |

Celebration badges appear alongside the status chip in the **collapsed row** — always visible, not hidden behind expand.

---

## Team Availability — Full Redesign

### Sort order

Rows sorted descending by **QTD reliability score** = `aligned_weeks / total_qTD_weeks`. Most consistently Aligned at top; Escalation rows drift to the bottom unless they were recently Aligned. Within the same score, sort alphabetically by name.

### Collapsed row (15–30 visible at once)

```
[Name]  [Status chip]  [Sparkline]  [Trend tag]  [Celebration badges]  [One-line callout]  [▾]
```

- **Name**: display name
- **Status chip**: current week 4-state (Aligned / Unplanned work / Silent gap / Escalation)
- **Sparkline**: QTD project-count trend (bars, one per week). Height = number of active projects that week. Quarter-to-date window (~8–12 weeks depending on week in quarter).
- **Trend tag**: `↑ rising`, `↓ declining`, or `stable` — derived from slope of project-count sparkline
- **Celebration badges**: shown only when earned (streak, swarm, stabilizer). Empty if none.
- **One-line callout**: pattern-specific text (see templates below)
- **▾**: expand toggle

#### Callout templates

| State | Template |
|---|---|
| Aligned, streak ≥ 3 | `"N-week reliability streak — no action needed"` |
| Aligned, no streak | `"On track this week"` |
| Unplanned work | `"Tracking unscheduled work — investigate scope"` |
| Silent gap | `"Planned but not tracking — check in"` |
| Escalation, week 1 | `"Zero activity this week — follow up"` |
| Escalation, week 2+ | `"Nth consecutive week without activity — escalate"` |

### Expanded row (click to open)

```
[Week pattern strip — one cell per QTD week]

[Project list — current week only]
  KEY  Project Name  [State chip]

[Manager note]
```

**Week pattern strip**: one colored cell per QTD week, labeled by ISO week. Color = 4-state color. Current week outlined in indigo. Future weeks shown as dashed blue cells (planned only, no state possible). Cells abbreviated: `ALN`, `UNP`, `SIL`, `ESC`.

**Project list**: current week only. Each row: project key (monospace) + project name + planned hours on that project + the person's **overall weekly 4-state chip**. Per-project tracked hours are not available in the data model (`personWeekTracked` is week-total only); the chip reflects total-week behavior, which is the honest signal a manager needs.

**Manager note**: one-line positive-intent framing tied to the pattern. Pre-generated from templates — not AI. Examples:
- Aligned + Swarm badge: *"Reliable and jumping in where needed — potential kudos trigger."*
- Silent gap: *"Planned hours not tracking — may be blocked or waiting on someone. Worth a quick check."*
- Escalation week 2: *"Two weeks without activity against plan. Needs a conversation — assume positive intent first."*

### Filter bar

Keep existing sticky top bar. Add one new filter:

**Status** chip-group: `All` · `Aligned` · `Unplanned work` · `Silent gap` · `Escalation` · `On leave`

Selecting a status chip filters the list to rows matching that current-week state. Combines with existing Location / Job Family / Manager / FTE|Crew filters (all retained).

### What is removed

- The colored-bar week×person grid (replaced by collapsible rows)
- The blend distribution chart at the top of Team Availability (the QTD sparklines per person make it redundant)
- The category legend chips (≥90%, 60–90%, <60%, over-tracked) — these were fidelity-framing and are retired with the %-compliance model
- Blend tier chips (1/2/3/4+ projects) — project count is now shown per-person via sparkline

---

## Project Key Heatmap — Per-Project Collapsible

No changes to the existing grid, color modes, question-filter chips, or drill-down line chart.

### New: expanded project row

Clicking a project row opens an expanded section **below the heatmap cells** (full grid width). Clicking again collapses it. Only one project can be expanded at a time.

#### Expanded contents

```
[Project name] — W[N] (current week)   [Concentration risk flag — if applicable]

[Person list]
  [Name]  [4-state chip]  [Planned Nh · Tracked Nh]  [Celebration badges]

[Manager note]
```

**Concentration risk flag**: shown when fewer than 2 people are in Aligned state for this project this week. Label: `⚠ Concentration risk — 1 active person` (or `0 active persons`).

**Person list**: all people with `personProjectPlan[person][key][currentIso] > 0`. Each row:
- Display name
- Overall weekly 4-state chip (`personWeekState[np][currentIso]`) — per-project tracked data is not available; the weekly state is the appropriate signal for staffing context
- Planned hours on this specific project (`personProjectPlan[np][key][currentIso]`)
- Any celebration badges earned this week

**Manager note**: project-level summary. Template examples:
- All Aligned: *"Project fully covered this week."*
- Concentration risk + Escalation: *"Only [Name] is active. [Name2] has been silent for N weeks — follow up before next planning cycle."*
- Coverage gap (0 tracked, all planned): *"No tracked activity despite [Nh] planned. Check if the project has started."*

---

## Data Requirements

All signals are derivable from the existing data model. No new sheet reads required.

### New computed fields (backend — `Code.js`)

| Field | Description |
|---|---|
| `personWeekState[np][iso]` | 4-state enum for each person × week |
| `personQtdScore[np]` | `aligned_weeks / total_qtd_weeks` — sort key |
| `personQtdProjectCounts[np][iso]` | Active project count per week (for sparkline) |
| `personStreakLen[np]` | Consecutive Aligned weeks ending at current week |
| `personIsSwarm[np]` | Boolean — Unplanned work on a gap project this week |
| `personIsStabilizer[np]` | Boolean — active on 4+ projects, all Aligned |
| `projectConcentrationRisk[key][iso]` | Boolean — fewer than 2 Aligned people on project |

QTD window: weeks from `Q4_BASE_ISO_WEEK` (current FY Q4 anchor) up to and including the current ISO week. Only Q4 has a configured base week constant — for Q1–Q3 the implementation should fall back to the last 13 ISO weeks as the sparkline window.

### No new Tempo reads

All new fields are computed from the already-fetched `personWeekPlan`, `personWeekTracked`, `personProjectPlan`, and `tracked` model fields. No additional `UrlFetchApp` calls or sheet reads.

---

## Framing Note (rollout)

Chips like "Escalation" and "Silent gap" can read as surveillance if not introduced carefully. Every "needs attention" state should be framed with positive-intent assumption in the Manager note — blocked, unclear scope, waiting on someone — not implied underperformance. Celebration badges (streak, swarm, stabilizer) should be at least as prominent as gap signals so managers use the dashboard to recognize great work, not just to find problems.

---

## Out of Scope (this spec)

- Org-level group signals (pattern distribution chart, concentration risk trends, coverage gap chart) — separate spec
- Left filter rail migration — deferred; sticky top bar with Status chip is sufficient for now
- AI-generated Manager notes — current design uses rule-based templates; Gemini narrative is a future enhancement
- Swarmability view (matching gap projects to available Aligned people) — separate spec
