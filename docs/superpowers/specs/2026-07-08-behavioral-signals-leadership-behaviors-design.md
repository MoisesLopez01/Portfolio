# Behavioral Signals — Leadership Behaviors Tab (GDash v2.6.0)

**Date:** 2026-07-08 (2026.W28)
**Files:** `GDash.html`, `goalCompliance.js`
**Status:** Approved design, pending implementation plan

## Purpose

Surface the goal-compliance signals the dashboard already computes as evidence of the
Rocketeer Leadership Behaviors (leadershipbehaviors.org), so managers read the dashboard
as a culture mirror, not just a compliance tracker. Growth-oriented framing throughout —
signals are things to act on together, never a name-and-shame list.

## Behavior mapping (source-verified)

| Dashboard signal | Behavior | Framework language (verbatim) |
|---|---|---|
| Self-comments on own goals | Share the Knowledge | "I ask questions first and actively share experiences and lessons learned" |
| Manager comments on team goals | Develops Rocketeers · Proactive & Responsive | "Provides appropriate feedback focused on professional growth" / "Master of cadence and repeatability" |
| Goals moved promptly through status | Build Process to Drive Outcomes | "I reflect, iterate and continually improve processes through documentation that is shareable and easily accessible" |
| Hitting thresholds + accepting feedback | Think Team | "I hold myself accountable and am open to delivering and receiving feedback" |
| Clarity/quality of goals set | Talk Straight | "I set clear expectations with transparency and always walk the talk" |

Source posts (behavior card headers link to these):

- Develops Rocketeers — https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-2-develops
  Mindset: "When you prioritize developing your team, you're growing your organisation.
  You're planting the seeds of scale." Anti-behavior: "Hasn't fully planned/developed their team."
- Proactive & Responsive — https://leadershipbehaviors.org/p/rocketeer-leadership-behavior-9-proactive
  Mindset: "In structure we find our freedom to be creative and get into flow."
  Anti-behavior: "Reactive and Pressured."
- The full series lives at `/p/rocketeer-leadership-behavior-1-team` … `-10` (Accountable).

Only verbatim framework language appears in behavior copy — no invented mindset text.

## Tab & visibility

- New **Behaviors** tab in the tab bar: `VIEWS` entry
  `{ id: 'behaviors', label: 'Behaviors', location: 'tabbar', roles: ['admin','manager'] }`.
- Existing `canSeeView_()` / `applyRoleToNav_()` / `switchTab()` gating handles button
  hiding and direct-navigation blocking for viewers. No new access-control code.
- Managers and delegates see the tab computed over their own scope (payload is already
  scoped server-side); the tab respects the filter bar like every other view.

## The five cards

Each card renders: behavior name (linked to its post), verbatim mindset quote, a
team-level meter, a counts-only verdict line, and an expandable detail section.
Names appear **only** inside expandable rows (standing no-names-in-verdicts rule).

### 1. Share the Knowledge — self-comment cadence
- **Meter:** % of rocketeers self-commenting at pace — reuses the existing RPI read:
  `commentWeeks` vs. the required comment-weeks threshold. No new definition.
- **Expand:** rocketeers below pace, labeled *"building this habit"*, with their
  comment-week count vs. required.

### 2. Develops Rocketeers · Proactive & Responsive — manager feedback
- **Meter:** X of Y managers who commented on at least one direct's goal this quarter
  (from `totalManagerComments` aggregated per supervisor).
- **Secondary line:** % of rocketeers who received any manager comment.
- **Expand:** per-manager rows — directs covered / total directs (extends the existing
  Manager Scorecard read; does not replace it).

### 3. Build Process to Drive Outcomes — goals moving through status
- **Meter:** % of goals "moving" = goals that are neither
  (a) stuck in Planned with zero comments (`goalsStuckInPlanned`), nor
  (b) Not Completed / Canceled with zero comments (new `goalsClosedNoNote`).
- **Expand:** rocketeers with stuck or unexplained-closed goals, framed as
  *"goals to revisit"*.

### 4. Think Team — accountability + feedback loops
- **Meter (primary):** of goals that received manager feedback, % where the rocketeer
  self-commented on/after the first manager comment (feedback loop closed).
- **Secondary line:** % of rocketeers On Target (`complianceStatus`).
- **Expand:** rocketeers with open feedback loops, framed as
  *"feedback waiting for a reply"*.

### 5. Talk Straight — goal clarity (v2 placeholder)
- Card renders with the mindset quote and a "measurement arrives with goal-quality
  data" note so the framework reads complete. No meter in v1.
- v1 has only Goal Name text — no description field — so any clarity heuristic or
  AI scoring is deferred until richer goal data exists (decision: defer, not heuristic,
  not Gemini).

## Backend changes (goalCompliance.js)

Inside the existing per-goal aggregation loop — no new sheet reads:

1. Track `firstMgrCmtDate` per goal (earliest dated manager comment). Set
   `respondedToMgr = true` when any self-comment is dated **on/after** it
   (same-day counts as a reply). Undated manager comments are excluded from the
   feedback-loop metric.
2. Roll up per employee:
   - `goalsWithMgrFeedback` — goals with ≥1 dated manager comment
   - `goalsFeedbackClosed` — of those, goals with `respondedToMgr`
   - `goalsClosedNoNote` — Not Completed / Canceled goals with zero total comments
3. Bump `CONFIG_GD.CACHE_VER` → `'gd_v17_'` (employee records gain fields).
4. Add `_test_feedbackLoop()` covering: same-day reply counts; self-comment before
   mgr comment does not count; undated mgr comment excluded; no mgr comments →
   goal absent from denominator.

Everything else the cards need already exists: `commentWeeks`, `goalsStuckInPlanned`,
`totalManagerComments`, `weeklyMgr`, `complianceStatus`, `supervisor`.

## Frontend changes (GDash.html)

- `pane-behaviors` + `renderBehaviors()`, dispatched from `switchTab()` like the
  other panes.
- All meters computed client-side from `S.data.employees` — filter-aware and
  scope-aware for free (same pattern as Trends).
- Cards reuse existing section / `section-body` styling; join the per-section PNG
  export (pattern from be5c2a0).
- Expandable detail uses the existing drill-row pattern.

## Framing rules

- Verdict lines: counts only. Names only in expandable rows.
- Growth-oriented labels on this tab: *building this habit*, *goals to revisit*,
  *feedback waiting for a reply*. Never "failing" / "non-compliant" here.
- Consistent with the existing "Needing Support" tone; Talk Straight's own language
  ("never a put-down") is the bar for all copy on this tab.

## Out of scope (v1)

- Talk Straight measurement (v2 — needs goal descriptions or accepted heuristic).
- CSV export of behavior metrics.
- Trends/QoQ history for behavior meters.
- Any change to RPI/STF scoring or the Needing Support tab.
