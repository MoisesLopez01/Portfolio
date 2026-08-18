# Drill-down rows as controls, "no reference" removal, Over-allocated — design

**Date:** 2026-08-17 (2026.W34) · **Status:** implemented · **Files:** `Dashboard.html`,
`tests/delivery-health/render-smoke.js` · **No schema change, no cache action.**

Requirements arrived fully specified from director feedback (three numbered "Developer
Action" items); this spec records the decisions and the one pre-existing bug the work
surfaced, rather than re-deriving the requirements.

## 1 · Active-by-click table interaction

**Requirement.** Clicking any drill-down row must (a) visibly select it and (b) make the
"Who is available →" button inherit that row's context, so the Workforce tab opens
pre-filtered to the clicked region/team/family.

**Design.** The row IS `drillPick_` — the same universal-filter toggle the deleted
"narrow it" chips used. No second routing mechanism exists:

- Each `<tr>` in the drill grid carries `onclick="drillRowPick_(i)"`, `role="button"`,
  `tabindex="0"`, an Enter/Space handler, and `aria-pressed`. Keys travel by **index**
  through `DRILL_ROW_KEYS_` (rewritten every `renderCompare_` pass), never inlined into
  the onclick string — a category named `O'Brien & Co` must not break the handler.
- Active state: `STATE[compareDim] === row.key` → `.rowActive` (blue `--c-target` left
  bar + 12% tint), declared after `.rowOffender` so a selected offender shows the
  selection bar while keeping its ▸ glyph.
- Button inheritance was already built: `drillActionsHtml_` reads `STATE[dim]` and names
  the slice on the button ("Who is available → · ANZ"). Row click → `drillPick_` →
  `renderAll_` re-renders the buttons with the new slice. Toggle semantics: clicking the
  active row clears it.
- Untagged rows ("(No team)" etc.) work unchanged: `passesFilters_` routes through
  `dimMatch_`, whose `vals()` returns the untagged sentinel.

**Bug surfaced and fixed.** `renderCompare_` documented that the compare dimension's own
filter is "switched off while the bars are built" — true only for row *membership*
(`passesFilters_(p, STATE.compare)` skips it); the metric accessors inside
`scopedMetric_` apply the raw filters with no skip. Selecting AMER therefore nulled
every other row's values and reshuffled the ranking under the click. Fix: the
dimension's own filter is **parked** (`STATE[dim] = ""`) for the duration of the row
fold *and* the per-column operating-band computation, restored in a `finally`. Bands
stay whole-population — a band recomputed from only the selected category would
silently re-grade every other row.

## 2 · "no reference" caption removed

The caption became live again when the Availability column (no ratified target) joined
the grid. Removed from the cell entirely; the fact moved to the cell tooltip: *"No
organizational target has been set for this metric, and there is not yet enough history
for an operating norm — the value is shown ungraded."* The neutral grey bar
(`--c-ref`) and the absent RAG glyph already read as "not graded". The
operating-band branch (norm published, still no target) is unchanged.

## 3 · Over-allocated, never a negative rate

Availability = (scheduled − planned) ÷ scheduled. Planned CAN exceed scheduled — neither
`availabilityFor_` (per-person fold) nor `wfAvailability_` (pool × band fold) caps, by
design parity with the server. A negative percentage is real over-commitment, so it is
**translated, not hidden**, identically on every surface that publishes the rate:

| Surface | Rendering when raw < 0 |
|---|---|
| Drill-down cell (`gridCellHtml_`) | `0% Over-allocated` pill; tooltip keeps the magnitude ("exceed … by 25% of it") |
| Availability Rate card (`availabilityTileHtml_`) | headline clamped to 0%; pill + "Nh planned beyond the Mh scheduled" |
| Workforce "one honest number" (`renderWfConsumers_`) | same clamp, same pill, same hours wording |

The pill is `.pillOver` — red (`--c-bad`) pill, the vocabulary of an earned verdict:
booking people past capacity is a burnout signal. The guard is `!o.unit && value < 0`,
so unit metrics (days/hours) never take the branch. Raw metric accessors stay uncapped —
clamping at the source would erase the signal the pill exists to raise.

## Testing

`node tests/delivery-health/render-smoke.js` — 1570 checks. New coverage: row handler
present, no active row before a click, click sets the filter + highlights exactly one
row + `aria-pressed`, buttons inherit the slice, unselected rows keep their values
(pins the parked-filter fix), second click clears; caption absent + tooltip present on
target-less cells; over-allocation on all three surfaces plus the negative-fixture
proof that the raw folds really go negative.
