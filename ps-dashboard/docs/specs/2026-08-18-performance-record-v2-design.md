# 📈 Performance Record v2 — Identity, SI History, Manager-First UX

**Date:** 2026-08-18 (2026.W34) · **Status:** Approved (user: "implement it in code now")
**Builds on:** `2026-08-18-performance-record-tab-design.md` (v1, commits `0e85eb4..6f9d7c4`)
**Driver:** manager UX/data-science critique — cognitive load too high; dashboard must answer
"who needs help, why, what action" at a glance.

## Decisions (approved)

1. **Row identity + exceptions (choice A — derive from carve flags).** Sub-line = full job
   title · JF-code·level · location · supervisor · tenure ("3y 2m", from new `hireDate`
   payload field). Exception chips from existing flags: `tracksTime=false` → "JFxxx · no time
   mandate" (JF018 is the canonical example), `isRampUp` → "ramp-up", crew, on-leave. A carved
   metric WITH data renders real bars in neutral slate, NO dot, tooltip "shown, not
   evaluated", excluded from flag counts and the Brief; without data it stays a dash. No new
   config — exceptions track the allowlist automatically.
2. **SI history, idle current.** Server ships per-employee SI history (`si.hist` =
   `[{quarter, value}]` for every rated quarter column; client selects last 2 closed + current
   if rated). Cell shows record chips ("FY26Q4 4 · FY27Q1 —"); dot = latest CLOSED rated
   record; unrated current quarter = idle "—" + tooltip "not yet rated — not evaluated", never
   a placeholder, never a penalty.
3. **Manager's Brief widget.** Counts-only strip above the table (no names — chart-verdict
   rule): shown · critical (≥1 red) · watch (yellow only) · burnout risk · not fully evaluated.
   **Burnout (choice A) = PTO At-Risk AND trackedNorm ≥ 1.0 in the last closed bucket.**
   Critical/watch chips clickable → Flagged-only + needs-support sort.
4. **Micro charts + tooltips; READING column dropped.** SVG bars ~28px (scale-aware) with
   baseline + target tick at the green threshold; kudos chart labeled "max 4"; per-bucket RAG
   colors, in-progress faded. Native `title` tooltips on every dot/bar: value + cohort target
   ("Tracked 62% of target · IC bar: green ≥85%, yellow ≥55%"). READING column removed from
   the table — text survives in drill header + CSV.
5. **Drill v2.** Blocks ordered red → yellow → green → informational (kudos neutral, never red
   iconography; exceptions last). Tracked-vs-planned becomes an inline-SVG grouped bar chart
   (hour labels per bucket); goals gets compliance bars (x/y). SVG, not Chart.js. Per-card
   **📸 Save Snapshot** (html2canvas, already loaded; hide buttons during capture) →
   `perf-record-<name>-<granularity>.png`. Header-level 📷 captures the whole grid.
6. **Helper text → ⓘ** icon tooltip beside the title (frees the vertical space).
7. **Plumbing.** Server: ship `hireDate` (ISO) + `si.hist`; deploy bumps `PS_CACHE_VER`;
   client tolerates absence on stale payloads. New pure engine functions inside the sentinels
   (tenure label, SI record selection, burnout predicate, threshold tooltip text, quarter
   rank) with node checks. CSS follows the responsive scale-ladder conventions
   (`calc(…*var(--scale))`; chrome-level rules ≥1024px-guarded).

## Out of scope
Admin-editable thresholds · Chart.js in the drill · names in the Brief widget · any
write-back. CSV keeps (not drops) the Reading text and gains Title/Tenure/Exceptions columns.
