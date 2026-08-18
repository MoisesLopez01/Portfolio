# Policy Calibration Lab — Super-Admin Business-Case Analysis (GDash)

**Date:** 2026-07-08 (2026.W28)
**Files:** `GDash.html` (new tab), `goalCompliance.js` (admin-only history payload extension)
**Visibility:** super-admin only (`VIEWS` roles `['admin']`)
**Status:** Approved design, pending implementation plan

## Purpose

A private, admin-only tab driven live in leadership meetings to answer any
stakeholder's version of "is our comment-cadence policy realistic, and who is
genuinely engaging?" — CEO (overall compliance + FY trend), HR (who needs
support, gaming behaviors), Managers (team rollup). The flexibility is the
multi-perspective answer: tunable policy thresholds plus a Rocketeer/Manager
toggle let the operator pivot to whatever question arises, rather than three
hardcoded views. Goal: calibrate the official policy against historical reality
before adopting a threshold.

## Simulator controls (recompute everything live, client-side)

| Control | Default | Meaning |
|---|---|---|
| Cadence LAG (week − N) | 4 | Per-goal self-comment requirement = clamp(weekOfQuarter − N, minComments, cap). N=6 is today's CONFIG (`RPI_CADENCE_LAG`); 4 is the candidate under test. |
| Goals needing cadence | 6 of 10 | How many of a person's goals must meet the cadence requirement. |
| Min comments/goal | 1 | Floor of the requirement ("at least 1 comment"). |

The cap reuses `RPI_CADENCE_MAX_CMTS` (8). Canceled goals are excluded from the
cadence check, matching `computeRpiScore_`.

`weekOfQuarter` for the requirement: for a **completed** quarter it is the
quarter's full week count (the requirement is at its quarter-end maximum); for
the **in-progress** quarter it is the current week-of-quarter (payload
`weeksElapsedSinceStart`), so its partial compliance reads fairly.

Headline output: **compliant %** per quarter across the full fiscal year — each
completed quarter plus the current in-progress quarter shown separately (the
in-progress quarter is excluded from the calibration baseline because its
week-N cadence is incomplete; it is labelled "in progress").

## Behavioral flags (the "behaviors to change")

Computed on the **compliant-on-count** population so the operator can say "they
comply on paper, but…":

- **Back-loaded** — a person whose self-comments are ≥ `backloadPct` (default
  50%, tunable slider) concentrated in the final 3 weeks of the quarter.
  Uses the per-person weekly self-comment series (`weeklySelf`) + the quarter's
  week list.
- **Bare-minimum ("one-and-done")** — of a person's goals that received any
  self-comment, the share with *exactly 1* self-comment. A high share signals
  box-ticking rather than ongoing reflection. Reported as count + % of the
  compliant population.

## 2D cohort heatmap

Goals bucket × comments bucket grid; each cell = headcount, cell color = %
compliant at the live settings. Click a cell → the person list for that cohort.

Scope selector (dropdown above the grid): a specific quarter (default = most
recent **completed** quarter) or "Full FY (pooled)" — pooled unions every
completed quarter's per-person records so a person appears once per quarter
they were active. The headline compliance table always shows every quarter
regardless of this selector; the selector only drives the grid + person lists.

- Goals buckets: `0 / 1–4 / 5–7 / 8–9 / 10+` (aligned with the existing At Risk
  / Watch / On Target tiers).
- Comment buckets: `0 / 1–9 / 10–29 / 30+`.
- Bucket edges are client constants (`BC_GOALS`, `BC_CMTS`) — easily retuned.

**Rocketeer / Manager toggle:**
- *Rocketeer* — one entry per person.
- *Manager* — same grid rolled up per supervisor (grouped by `supervisor` on
  each lite record): each manager's team contributes median compliance,
  back-loaded %, and bare-minimum %, so teams can be ranked.

## Statistics

Per quarter and per cohort: `n`, compliant %, and the **mean & standard
deviation of self-comments-per-active-goal** (the "6/10 with a standard
deviation" ask). σ quantifies how unequally the policy lands: a high σ means a
few heavy commenters mask many low ones.

`stdDev_(values)` = population standard deviation, pure and unit-tested.

## Data & architecture

The `RD` sheet already holds every quarter (`aggregateByRocketeer_` re-derives
any historical quarter — that is how the Trends tab shows prior quarters). The
current `history` payload ships only weekly totals + `totalGoals`, which is not
enough for the client to recompute per-goal compliance historically.

**Backend change (`goalCompliance.js`):**
- Extend the history lite block (`liteEmp_`) and the current-quarter records
  with a compact **per-goal self-comment count array** `goalSelf: [n, n, …]`
  (one entry per non-canceled goal) — the minimum needed for the client to
  evaluate "X of Y goals meet cadence" and the bare-minimum flag at any policy.
- `weeklySelf` (already present) supplies back-loading.
- **Admin-scope only:** this heavier history is attached only when
  `access.role === 'admin'`, so manager/viewer payloads stay lean. Guard:
  `if (access && access.role === 'admin')` around the `goalSelf` enrichment.
- Bump `CACHE_VER` (admin and non-admin entries diverge in shape; versioning
  strands old entries cleanly).

**Frontend (`GDash.html`):**
- New `VIEWS` entry `{ id: 'policylab', label: 'Policy Lab', location: 'menu',
  roles: ['admin'] }` — placed in the ☰ menu (like Access Control / Data
  Reference) rather than the tab bar, since it is an admin-only power tool.
- `renderPolicyLab()` computes all metrics client-side from
  `S.data.history` + current quarter, filter-aware. Pure helpers
  (`compliesAtPolicy_`, `isBackloaded_`, `bareMinShare_`, `stdDev_`,
  `bucketOf_`) are unit-testable in Node.
- Per-section ⬇ PNG (existing `exportPNG` pattern) for dropping into slides.
- All company-palette colors; compliant/not uses status semantics, cohort
  intensity uses an Orbe ramp.

## Out of scope (v1)

- Stakeholder preset buttons (HR/CEO/Manager snap views) — flexible controls +
  the Rocketeer/Manager toggle cover it; presets are an easy fast-follow.
- CSV export (operator chose on-screen + PNG only).
- Writing a calibrated threshold back to CONFIG from the UI — the Lab informs
  the decision; the CONFIG change stays a deliberate code edit.
- Any change to the live RPI/STF scoring or other tabs.

## Testing

Node-run `_test_*` for each pure helper: `stdDev_` (known values), `bucketOf_`
(edge values at every boundary), `compliesAtPolicy_` (goal at/below/above the
week-N requirement; canceled excluded; min-comments floor), `isBackloaded_`
(all-early vs all-late vs even distributions), `bareMinShare_` (mix of 1-comment
and multi-comment goals, zero-commented goals excluded from denominator).
Frontend script block parse-check + stubbed-DOM smoke of `renderPolicyLab()`.
