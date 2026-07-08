# GTT-421 — Enhancement on Contribution Dashboard: Monthly & Quarterly Trend Views

> Ready-to-paste ticket comment / sub-task description. Delivered 2026.W28.

---

**Monthly & Quarterly Trend Views (Week | Month | Quarter toggle) — Delivered (2026.W28)**

Follow-up on Gon's feedback: the weekly measurement was solid, but leadership needed to
evaluate how the team performed across a full month or quarter — for each manager's
group and for the whole evaluated group.

**Delivered**
- **Period toggle** on the Executive Brief, Team Radar, and Trends tabs: `Week | Month | Quarter`
  plus a period picker (e.g. "Jun 2026 · 2026.W23–W26", "FY26Q4 · 2026.W14–W26").
  The selected period follows you across tabs.
- **Executive Brief in monthly/quarterly mode**: the same Facts / Highlights / Notes / Concerns
  narrative, computed over the whole period and compared with the prior one
  ("Tracked time avg 31.2h/person/week in Jun 2026, up from 29.8h in May 2026").
  In-progress periods state their coverage explicitly.
- **Team Radar evaluates a period**: compliance standings (Goals, PTO) read at period end;
  activity axes (Tracked, Planned, Kudos) averaged per week across the period; a reference
  polygon compares against the prior month/quarter.
- **All Trends charts re-bucket** into monthly or quarterly points; RCR groups into fiscal
  quarters (marked approximate — true RCR is a ratio, not an average).
- **Two-quarter history** now ships behind the dashboard, so "vs prior quarter" comparisons
  are real — prior-quarter Goals are evaluated against that quarter's own goal set.
- **No misleading numbers**: only periods with full team data are selectable, and missing
  prior-period data suppresses the comparison instead of showing a fake zero.
- Copy-for-Confluence, Gemini narrative polish, and per-section PNG export all work in
  period mode; weekly views are unchanged.

**Impact**
- Managers and the CEO can review any closed month or fiscal quarter in one view with
  prior-period deltas — the evaluated group's story, not just week-by-week snapshots.
- Scoped access is preserved: delegates still see only their org tree, and every period
  view respects the team and FTE/Crew filters.

**Status**: code complete and reviewed (unit tests + multi-pass code review); deploying to
the live dashboard in 2026.W28 after the standard QA pass.

Commit: `GTT-421 Enhancement on Contribution Dashboard`
