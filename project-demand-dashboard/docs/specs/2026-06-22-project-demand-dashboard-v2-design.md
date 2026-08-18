# Project Demand — Week over Week (C-Suite Dashboard) — v2 "Signal-Ready" Design

**Date:** 2026-06-22 (2026.W26)
**Status:** Approved design — ready for implementation plan
**Project:** `project-demand-dashboard/` (existing, in production)
**Supersedes / extends:** `2026-06-22-project-demand-dashboard-design.md` (v1 — the live build)

---

## 1. Why this exists

v1 shipped a working C-suite Project Demand dashboard (5 panels, live read of the
`Planned Time Tempo` tab). A C-suite review found that it **describes state more than it drives
decisions**. The blunt test for every tile is *"what would I do differently because of this?"* —
and several tiles don't answer it:

- The **hero strip** shows the same winner (COE-0009 Appfire) for all 8 weeks → one fact, eight cards.
- The **heatmap** colors by raw magnitude → asks an executive to hunt instead of surfacing exceptions.
- The **trend** lines are unlabeled and "movers" means *biggest*, not *moving*.
- **People & blending** is the strongest tile (number → so-what → check) but is a single snapshot.
- The whole board is in **absolute hours with no denominator** — 780 hrs can't be read as
  over- or under-staffed.

This v2 reworks each tile to end in a *so-what*, surfaces exceptions instead of state, and adds
**demand vs capacity** as the missing denominator. It also adds **Save PNG** and removes
repetition.

**Guiding principle (applies to every tile):** `number → so-what → suggested check`.

---

## 2. Decisions locked in this design

| Decision | Choice |
|---|---|
| Capacity denominator | **Roster headcount × 40 hrs** (cross-read the Roster sheet by ID) |
| Hero strip | **Replace with Risers & Fallers** (week-over-week movers) |
| Strategic-project tagging | **Top-N by in-window hours as proxy** (no maintained list in v1) |
| Rollout | **All five changes in one pass** + Save PNG + de-dup sweep |

---

## 3. New data source — Roster (capacity denominator)

The dashboard is a **separate** GAS project; it gains a second `SpreadsheetApp.openById(...)`
read (new auth scope on next deploy).

- **Spreadsheet ID:** `1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0` → new CONFIG key `ROSTER_SS_ID`.
- **Tab:** `Roster` → CONFIG key `ROSTER_SHEET`.
- **Active-headcount filter** (mirrors the PS report's `readPSRoster_`, simplified for a count):
  - `Class` == `"Professional Services"` (CONFIG `ROSTER_CLASS`).
  - `Department` == `"Services"` when the column is present and non-empty (CONFIG `ROSTER_DEPT`).
  - **Exclude inactive:** `Employee Status` matching
    `/terminat|job offer|resign|left|inactive|former|offboard|maternity|paternity/i`, **or** a
    non-empty `Termination/Release Date`.
  - **Include** ramp-up and crew members — they appear in the Tempo plan and consume capacity, so
    they belong in the denominator. (No ramp-up exclusion here, unlike RCR/SI/Goals in the PS report.)
- **headcount** = count of rows surviving the filter.
- **Capacity:** `capByWeek[iso] = headcount × WEEKLY_CAPACITY_HRS` for every in-window week
  (constant in v1; per-week map shape kept so PTO-adjusted capacity can be added later without a
  client change).

### Resilience (must not break the live dashboard)

The roster read is wrapped in its own try/catch, independent of the Tempo read:

- **Success:** `capacityMode = "roster"`, `headcount` set, `capByWeek` from roster × 40.
- **Failure** (sheet missing, no access, error): `capacityMode = "planned"` fallback —
  `capByWeek[iso] = activePeople[iso] × WEEKLY_CAPACITY_HRS` (distinct people planned that week).
  The capacity tile renders with a caveat label *"capacity estimated from planned roster"*. The
  Tempo-driven panels are unaffected either way.

---

## 4. Server changes (`Code.js`)

### 4.1 CONFIG additions
```js
ROSTER_SS_ID:   "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
ROSTER_SHEET:   "Roster",
ROSTER_CLASS:   "Professional Services",
ROSTER_DEPT:    "Services",
FRAG_MIN:       4,     // people on >= FRAG_MIN distinct projects are "fragmented" (drill-down)
TOPN_STRATEGIC: 10,    // top-N projects by in-window hours treated as "strategic" (proxy)
MOVERS_N:       5,     // # of risers and # of fallers shown in the Risers & Fallers panel
// Utilization status bands (fraction of capacity); CONFIG-tunable, not hard-coded:
UTIL_TIGHT:     0.85,  // >= TIGHT and < OVER  -> "Tight"
UTIL_OVER:      1.00,  // >= OVER             -> "Over"  (< TIGHT -> "Headroom")
```
(`WEEKLY_CAPACITY_HRS: 40` already exists.)

### 4.2 New roster reader
`readActiveHeadcount_()` → opens `ROSTER_SS_ID`, reads `ROSTER_SHEET`, applies the §3 filter,
returns `{ headcount, ok:true }` or `{ headcount:0, ok:false, error }`. Defensive column lookup
by header name (case-insensitive), same style as the PS report.

### 4.3 `getDemandData()` — capacity wiring
After `aggregate_(...)`, call `readActiveHeadcount_()`:
- `ok` → `capacityMode="roster"`, `headcount=h`, `capByWeek[iso]=h*40`.
- `!ok` → `capacityMode="planned"`, `headcount=null`, `capByWeek[iso]=activePeople[iso]*40`.

Add to the model: `capByWeek`, `capacityMode`, `headcount`. (Existing `weekTotal[iso]` is the
demand numerator.)

### 4.4 Fragmentation drill-down — new aggregate
In `aggregate_`, while computing blend, also retain per-person project keys so the client can
drill down without a second call. Add:
```
fragByWeek[iso] = [ { person, keys:[...], n }, ... ]   // only people with n >= FRAG_MIN
```
Sorted by `n` desc then person. `keys` are the project keys that person is planned on that week.
This is the only new per-person data leaving the server, and only for the fragmented few (small).

### 4.5 Strategic proxy
No new field needed: the existing `order` (keys by total in-window hours) defines strategic =
`order.slice(0, TOPN_STRATEGIC)`. The client marks fragmented people whose `keys` intersect that
set. `TOPN_STRATEGIC` is sent in the model (or read from a small `meta` block) so the client
doesn't hard-code it.

### 4.6 Test
Extend `_test_demandParse_`:
- Assert `fragByWeek` lists the right person(s) with their project keys for the fixture
  (Ana on ACME+BETA is n=2 < FRAG_MIN=4, so with FRAG_MIN lowered in the test fixture, assert the
  membership and `keys` contents).
- Add a small `_test_headcount_` (or extend) feeding a fake roster matrix: assert active count
  excludes terminated / wrong-class / wrong-dept rows and includes ramp-up + crew.

---

## 5. Client changes (`Dashboard.html`)

Panel order top→bottom becomes: **Demand vs Capacity** (headline) → **Risers & Fallers** →
**Ranked demand + People & blending** (two-col, kept) → **8-week trend** → **Project key heatmap**
(demoted, drill-down) → footer. Week selector bar stays at the top under the header.

### 5.1 Demand vs Capacity (NEW — headline band)
- **Headline (current/selected week):** `Demand {weekTotal} hrs vs capacity {capByWeek} hrs ·
  {util}% utilized` + status chip from the bands (`Headroom` / `Tight` / `Over`).
- **Mini area chart**, 8 weeks: capacity reference line + planned-demand area; gap shaded.
  Actual weeks solid, planned tail dashed + tinted background, "now" marker. Reuses the trend
  SVG scaffolding (axis/x/y helpers).
- **So-what line** generated from the data, e.g.
  *"W27 planned at 112% of capacity — over-committed; rebalance before locking,"* or
  *"3 weeks of headroom ahead — capacity to absorb a new ask."*
- If `capacityMode==="planned"`, show the *"capacity estimated from planned roster"* caveat and a
  ℹ tooltip explaining the fallback.

### 5.2 Risers & Fallers (replaces hero strip)
- Remove `renderHero()` + `.heroStrip`/`.heroCard` markup and CSS.
- New `renderMovers()`: for the **selected week vs its prior in-window week**, compute per-project
  `Δhrs` and `Δ%` from `cap`. Show top `MOVERS_N` (default 5) **risers** (▲) and top `MOVERS_N`
  **fallers** (▼) as compact cards: key chip · name · `+Δ hrs (Δ%)` · so-what tag
  (`ramping` / `winding down` / `new` / `dropped to 0`).
- **Risk flag:** any project whose planned tail reaches 0 after being >0 gets a flagged card —
  *"{key} → 0 in {week}: planned wind-down or gap?"*
- Empty/first-week guard (no prior week) → friendly message.

### 5.3 People & blending (evolve)
- **Sparkline** above the distribution: `stretched[iso]` (people on ≥ FRAG_MIN) across all 8 weeks,
  with the trend direction stated in words (*"climbing"* / *"easing"* / *"steady"*).
- **Drill-down:** clicking the `4+ projects` row expands a list from `fragByWeek[SEL_ISO]`:
  each person → the project chips they're split across. Projects in the strategic top-N are
  badged. Header line: *"{x} of {total} fragmented people are split across top-demand work."*
- Keep the existing number→so-what→check note.

### 5.4 8-week trend (legible movers)
- **End-of-line labels:** render the key chip at each line's last point (no more color guessing);
  keep the legend too.
- **"Movers" redefined:** leaders = top-5 by **max |WoW slope|** across the window. Add a
  `chip-toggle`: `Biggest movers` (default) vs `Top by volume` (old behavior).
- **Actual/planned separation:** draw each line solid over `done`+`now` weeks and **dashed** over
  the `plan` tail; tint the planned-region background; keep the dashed "now" vertical marker.
- **Drop-to-zero annotation:** mark the point where any leader line hits 0 in the planned tail.
- Title → "8-week trend — biggest movers".

### 5.5 Heatmap (demoted, exception-first)
- **Color-mode toggle** (new `chip-toggle`): `Change` (**default**; diverging — green for WoW ↑,
  red for ↓, neutral mid), `Risk` (highlight cells trending to zero / high volatility), `Hours`
  (the existing magnitude ramp). `heatColor()` gains a mode parameter.
- **Question-filter chips** become the primary control (replace search as the headline action,
  search kept as a small secondary input): `Losing >20% WoW` · `Dropping to zero` ·
  `New this window` · `Volatile`. Each filters `visibleOrder()` by a predicate over `cap`.
- **Caption surfaces the exception count:** *"{n} projects losing >20% of hours this week."*
- Keep Top 15/30/All, row-click → trend highlight, tooltips, ★ winner marker.

### 5.6 Save PNG (NEW)
- Header button **"⬇ Save PNG"**.
- On first click, lazy-load **html2canvas** from a pinned CDN
  (`https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js`). On load,
  capture `#dash` to a canvas → `toBlob` → download as `project-demand-<CURRENT_ISO>.png`.
- **Graceful fallback:** if the script fails to load (sandbox/CSP/offline), show a non-blocking
  message *"PNG export unavailable in this environment"* — the dashboard is otherwise unaffected.
- Light theme is forced for the capture (decks expect light) then restored, to avoid a dark export.

### 5.7 De-duplication sweep (the "don't over-repeat" ask)
- Hero/weekbar overlap removed (hero → movers; weekbar stays the selector).
- Collapse the repeated *"planned hours / NETSUITE excluded"* explanation into the single footer;
  remove per-panel restatements of the same definition.
- Each panel hint becomes a *so-what* cue, not a restatement of the unit.

---

## 6. Files touched

| File | Change |
|---|---|
| `project-demand-dashboard/Code.js` | CONFIG keys; `readActiveHeadcount_()`; capacity + `fragByWeek` in `aggregate_`/`getDemandData()`; extended tests |
| `project-demand-dashboard/Dashboard.html` | New capacity band; movers replaces hero; blend trend + drill-down; trend redesign; heatmap risk-color + question filters; Save PNG; de-dup |
| `project-demand-dashboard/README.md` | Note the new Roster read + auth scope on redeploy; Save PNG; new CONFIG keys |

No change to `TempoPlanExport.js`, the source sheets, or the PS report.

---

## 7. Out of scope (v1 of v2)

- Per-week PTO-adjusted capacity (capacity is static headcount × 40 for now; per-week map shape
  is in place for later).
- A persisted/maintained strategic-project list (using top-N-by-hours proxy per the decision).
- Vendoring html2canvas offline (CDN lazy-load with fallback is sufficient; can inline later if
  offline export is required).
- Write-back, scheduling, CacheService.

---

## 8. Risks & notes

- **Second auth scope:** the roster read triggers a new authorization prompt on redeploy; the
  deploying owner must be able to read the Roster spreadsheet. If not, the `planned` fallback keeps
  the dashboard alive.
- **Utilization reads low:** Tempo planned hours are project hours, not all 40 — utilization will
  look conservative. Bands are CONFIG-tunable (`UTIL_TIGHT`/`UTIL_OVER`), and the tile is framed as
  *planned project hours vs available hours*, not a precise loading figure.
- **html2canvas + GAS sandbox:** export quality of the SVG charts via html2canvas is generally
  good but not pixel-perfect; the fallback covers any sandbox block.
- **Strategic proxy ≠ strategic truth:** top-N-by-hours conflates *biggest* with *most important*;
  acceptable for v1, swap for a maintained list when one exists.
- **Movers on the first in-window week:** no prior week → that week's movers panel shows a guard
  message rather than spurious deltas.
