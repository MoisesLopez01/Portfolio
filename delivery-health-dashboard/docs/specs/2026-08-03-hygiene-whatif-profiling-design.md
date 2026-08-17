# Hygiene Data Profiling + WHAT-IF Simulation + CEO Brief — Design

**Date:** 2026-08-03 (2026.W32) · **App:** Delivery Health Dashboard
(`delivery-health-dashboard/`) · **Status:** approved by Moises 2026-08-03

## Purpose

The four Jira delivery metrics are formula-correct but three cannot publish a quotable number
because the underlying data is incomplete (see `dash-loop/DATA-BLOCKERS.md`). This feature gives
the Services Director, inside the 🧪 Data Hygiene tab:

1. **A data profile** — simple per-metric funnels showing exactly where records fall out of
   evaluability (missing assignee, assignee not on roster, missing due date, missing estimate,
   defaulted capacity).
2. **A single WHAT-IF button** — flips the *whole dashboard* into a simulation that keeps only
   valid records, showing the "optimal idealistic" evaluation of every metric.
3. **A deterministic CEO brief** — top 3 Facts, top 3 Highlights, top 3 Notes, top Concerns —
   stating what is OK to keep and what must change, with owner and target week, so the review
   produces action items instead of re-litigating the gap list.

## Decisions ratified in this design (user answers, 2026-08-03)

| Question | Decision |
|---|---|
| WHAT-IF blast radius | **Whole-dashboard mode toggle** (all tabs), with a persistent banner |
| Validity rule | Drop records missing a **roster-joined assignee**, a **due date**, or (epics, for Forecast) a **real estimate + logged time**. **Region and Team are explicitly excluded from the exercise** — Jira does not carry them today |
| CEO brief source | **Deterministic rules** — same data in, same brief out. No Gemini |
| Visibility | **Admin-only** — same gate as the ⚙ Coverage gates editor (`MODEL.viewerRole === "admin"`) |
| Architecture | **Client-side only** in `Dashboard.html`. No server change, no schema bump, no cache bust |

## Why client-side only works

The server already ships everything needed, per ISO week:

- `hygieneBuckets` rows: `{ iso, res, resDue, resAssigned, resAttr, resRegion, resTeam,
  resReady, resFull, epics, epicsEst, epicsTime }` — every funnel stage count.
- `onTimeBuckets`: `{ iso, person, n, onTime, nAll }` — `n`/`onTime` already cover only
  issues **with** a due date and a roster assignee; `nAll` is the coverage denominator.
- `forecastBuckets`: `{ iso, person, n, nWithin, nAll, nNoTime, absVars, nMissOver, nMissUnder }`
  — `n`/`nWithin` already cover only epics with **both** estimate and logged time.
- `people[].weeks[iso]`: `{ tracked, trackedCov, capEst, … }` — classified hours and
  estimated-capacity flags.

The metric **rates** are already computed over valid records; garbage data manifests as
shrunken `n` versus `nAll` and as below-gate coverage flags. The WHAT-IF therefore changes
*which population and which confidence framing* every renderer uses — a presentation-layer
switch, provably consistent with the real numbers because both readings come from the same
buckets.

## 1 · Data Profile panel (🔬)

New section rendered by `renderHygiene_()` **above** the gaps table, admin-only
(returns `""` for other roles, exactly like `gateEditorHtml_()`). It follows the existing
period stepper (`STATE.hygIdx` / ◀ ▶ / Σ All history): profile numbers come from
`hygieneFor_(isos)` and `hygienePeopleFor_(isos)` for the selected window.

One funnel per metric, each stage showing **count, %, and records dropped at that step**,
rendered with the existing `hbar` bar pattern (no new chart machinery):

| Metric | Funnel stages (monotone, each ≤ previous) |
|---|---|
| On-Time Delivery | `res` (resolved in Dictionary scope) → `resAssigned` (has a Jira assignee) → `resAttr` (assignee joins the roster) → `resReady` (…and carries a due date) = **measurable** |
| Forecast Accuracy | `epics` (resolved epics) → `epicsEst` (has an estimate) → `epicsTime` (…and logged time) = **measurable** |
| Billable Utilization | person-weeks → real Tempo capacity (`weeks − capEst`); tracked hours → billable-classified (`trackedCov`) — two short bars, not a chain |
| Quality / Rework | **No funnel.** One line: cannot be profiled — Status Category / Rework Link / Reopened are not in the deployed export (v3.5.0; needs v3.6.0, PR-09) |

Region and Team appear in **no** funnel. They stay in the existing gaps table below, which is
unchanged.

Monotonicity holds by construction: `resolvePerson` returns null for the UNASSIGNED sentinel,
so `res ≥ resAssigned ≥ resAttr ≥ resReady`, and `epics ≥ epicsEst ≥ epicsTime`.

## 2 · WHAT-IF toggle

One button in the profile panel: **`🧪 WHAT-IF: valid records only`** / **`Exit WHAT-IF`**.

- Sets `STATE.whatIf = !STATE.whatIf`, then `renderAll()`; **session-only** — never persisted
  to Script Properties, localStorage, or the URL. A reload always returns in real mode.
- Admin-only: the button only renders for admins, and `renderAll()` force-resets
  `STATE.whatIf = false` when `viewerRole !== "admin"` (defence in depth, mirroring how
  `switchTab()` enforces role gating rather than trusting hidden buttons).

**Effect when ON — implemented in the shared aggregation helpers, not per-renderer patches:**

| Surface | Real mode | WHAT-IF mode |
|---|---|---|
| On-Time card / trends / people rollups | rate = `onTime/n`, coverage = `n/nAll` vs gate | rate unchanged; population = `n` only; coverage reads 100%; gate flags and `below gate — directional only` chips clear |
| Forecast card / trends | band = `nWithin/n`, coverage = `n/nAll` | same treatment; `nNoTime` and unestimated epics vanish from displayed denominators |
| Utilization | capacity includes `capEst` fallback weeks | person-weeks with `capEst` are dropped from the denominator; unclassified hours already leave both sides (unchanged) |
| Quality / Rework | suppressed (feed not exported) | **stays suppressed** — filtering cannot conjure columns that were never exported; the card says so |
| Unattributed honesty notes | "N items had no roster assignee" | restated as "excluded by the WHAT-IF filter", never hidden silently |
| Region / Team slices | person-derived region substitution, `◦` marker | unchanged — out of the exercise by decision |

**Anti-misread guardrails (all mandatory):**

- Persistent banner injected at the top of **every** tab while ON:
  `🧪 WHAT-IF SIMULATION — invalid records removed (kept 2 of 218 delivery items · 3 of 18
  epics). These are not the real numbers. [Exit]` — counts computed live from the Σ-window
  buckets.
- A page-level visual treatment (tinted background + dashed amber page border via a
  `body.whatif` class) so any screenshot is unmistakably a simulation.
- **Small-n honesty line:** a metric whose valid population is below a floor
  (`WHATIF_MIN_N = 5`) renders `n=2 valid records — publishable, not meaningful` on the card
  instead of a confident number. This line is the point of the exercise: the optimal view must
  show that filtering garbage yields an unusable sample, so the fix is upstream data entry.

## 3 · CEO Brief (deterministic)

Rendered inside the profile panel, recomputed live when the window or the toggle changes.
A 📋 Copy button copies the brief as plain text (markdown bullets) for pasting into the review.
Pure functions, no API calls, no randomness — same data in, same brief out.

**Inputs:** the profile for the selected window, the registry gates, and the trend across the
window's complete periods (oldest vs newest, same series `renderHygiene_` already builds).

**Selection rules:**

- **Top 3 Facts** — measured coverage statements ranked by population size, each formatted
  `kept of total (pct% vs gate%)`. E.g. "2 of 18 resolved epics carry a due date — 11% against
  an 80% gate."
- **Top 3 Highlights** — in priority order until 3 are filled: (1) metrics currently publishing
  at/above gate (Utilization); (2) funnel stages at ≥ 70% coverage (assignee fill,
  classification rate); (3) the largest positive trend delta across the window. If fewer than
  3 measured candidates exist, deterministic fallbacks fill the list ("52-week export window in
  place", "every card states its own coverage") — the brief never renders short.
- **Top 3 Notes** — a fixed, date-stamped decision registry kept in code (Dictionary On-Time
  scope ratified 2026-08-03; person-region substitution disclosed with `◦`; Region/Team excluded
  from this exercise; due date is the mutable Jira field, not a baselined commitment). Top 3 by
  recency.
- **Top Concerns** (up to 4) — funnel gaps failing their gate, ranked by
  `(records dropped) × (cards blocked)` descending. Cards-blocked is a fixed map, not parsed
  from text: assignee and roster-join gaps = 4 (they starve every card); due date, estimate,
  logged time, classification, capacity = 1 each. Each concern ends with the action:
  `→ change: <what> · owner: <who> · target: <2026.Wnn>`. Concern #1 always appends the WHAT-IF
  consequence with the measured n: "keeping only valid records leaves On-Time evaluating on
  n=2 — the fix is upstream data entry, not filtering."
- Ties break alphabetically by gap name, so ordering is stable.

**Owner names appear here deliberately.** The public gaps table dropped its Owner column
(2026-08-03 decision: a widely-read blame board doesn't fix tagging). This brief is admin-only
and exists to hand the CEO/Director accountable actions, so owners (Delivery leadership, Gon,
Bill, WFP/this dashboard) are named — sourced from the same assignments as
`dash-loop/DATA-BLOCKERS.md`.

## 4 · Error handling

- Empty window (`res === 0`, no person-weeks): panel renders "no complete-period data in this
  window" instead of funnels; brief renders facts as "not measurable this window".
- All divisions guarded (existing style: `x > 0 ? a/x : null`; null renders "—").
- WHAT-IF with `n = 0` for a metric: card shows "0 valid records — nothing to evaluate",
  never `NaN`, never 100%.
- The toggle never survives an error: any exception in a renderer leaves `STATE.whatIf`
  as-is but the banner is rendered by the same pass — banner and filtered numbers cannot
  desynchronise because both read the same flag in the same render.

## 5 · Testing

Extend **`render-smoke.js`** (local Node harness that evals the inline script against a
synthetic MODEL — never pasted into GAS):

- Profile panel renders for admin, absent for viewer/manager.
- Funnel monotonicity asserted on the synthetic model (each stage ≤ previous).
- Toggle ON: banner present on a non-hygiene tab's HTML, gate chips absent, `body.whatif` set,
  kept/total counts match the synthetic buckets, small-n honesty line appears when `n < 5`.
- Toggle OFF and role-reset: viewer role forces `whatIf` back to false.
- Brief: exactly 3/3/3 bullets + ≥1 concern on both a rich and a sparse synthetic model;
  identical output on repeated renders (determinism); concern #1 contains the WHAT-IF n.

Pure derivation helpers (`profileFor_`, `briefFor_`, `whatIfCounts_`) are written as
standalone functions in the inline script so the harness can reach them.

## 6 · Deploy

`Dashboard.html` only. No `Code.js` change, no schema version bump, no cache bust — the model
payload is untouched. Standard GAS web-app redeploy (new version).

## Out of scope

- Any server-side filtering or a second "clean" bucket set.
- Region/Team validity (excluded by decision until PR-01 lands).
- Quality/Rework profiling (blocked on export v3.6.0 / PR-09).
- Persisting WHAT-IF mode, or exposing it to non-admin roles.
- Gemini prose generation (deterministic bullets only; hybrid rejected).
