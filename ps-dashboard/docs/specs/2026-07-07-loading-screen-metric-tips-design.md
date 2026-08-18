# Loading-Screen Metric Tips + Flagged-Names Removal — Design

**Date:** 2026-07-07 (2026.W28)
**Status:** Approved (rotating-tips format chosen by owner) · Implemented same day
**File touched:** `PS Dashboard.html` only — no backend changes.

## Problem

1. `getPSReportData` takes ~2.5 minutes on a cold load. Users stare at a bare
   spinner ("Loading contribution data…") the whole time — dead time that could
   teach them how to read the dashboard.
2. The Goals compliance verdict line printed flagged employees' first names
   ("Follow up with 4 flagged (Ana, Luis, Mia, …)"). Names must not appear in
   the chart area. (A partial hand-edit of this line had also left broken JS —
   stray `")" : ""` tokens — which would have crashed the Goals section render.)

## Design

### 1. Rotating educational tips (loading screen)

- A tip card renders under the spinner inside `#loadingState`, auto-advancing
  every **8 s** with a 350 ms opacity fade. Header: "💡 While you wait — know
  your metrics" + "Tip N of 12" counter + progress dots. No interaction needed.
- **12 tips**, wording mirrored from the 📊 Data Reference pane so the loading
  screen and the reference teach identical rules: Goals 3 rules, Goals comment
  ramp, RCR, SI, Time planned, Time tracked, Kudos, PTO, ramp-up exclusion,
  Radar participation-vs-hours, Top Rocketeers score (weights described as
  configurable — no hardcoded numbers), ISO week numbering (ends with a pointer
  to ☰ → 📊 Data Reference).
- At 8 s per tip a 2.5-min load cycles the full catalog ~1.5×.

### Components

- CSS: `.loading-tip*` classes next to the existing `.loading` styles; all
  colors via existing CSS vars (`--surface`, `--border`, `--slate`, `--muted`,
  `--void`, `--orbe`) so light/dark themes both work.
- HTML: static card markup inside `#loadingState`, hidden by default.
- JS: `LOADING_TIPS` array + `startLoadingTips_()` / `renderLoadingTip_()` /
  `stopLoadingTips_()`.

### Lifecycle wiring

- `loadData()` → `startLoadingTips_()` right after showing `#loadingState`
  (also covers the Refresh button's force reload).
- `onDataLoaded()`, `onDataError()`, `showAccessDenied_()` → `stopLoadingTips_()`.
- The interval callback self-heals: if `#loadingTipContent` disappears (the
  error/denied paths replace `loadingState.innerHTML`), the timer stops itself.
- **Ordering constraint:** the boot IIFE `loadData(false)` runs mid-script, so
  the `LOADING_TIPS` block must sit **above** the `// ── BOOT` section —
  function declarations hoist but `var` initializers don't. Placing it after
  boot would throw on first paint and kill the initial load.

### 2. Flagged-names removal (Goals verdict line)

- `_gsNames` variable deleted; verdict action now reads
  `"Follow up with N flagged."` / `"No one currently flagged."` — count only,
  no names. Also repaired the broken ternary left by the partial hand-edit.

## Testing

- `node` syntax check on the extracted `<script>` block: passes (it failed
  before the ternary repair).
- Verified: single `LOADING_TIPS` definition, defined before the boot call,
  stop-calls present on all three exit paths, no `_gsNames` remnants.
- Live QA (GAS preview): confirm tips rotate during load, disappear on data
  arrival, and that the Goals verdict shows count without names.
