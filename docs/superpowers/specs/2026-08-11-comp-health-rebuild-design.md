# Rocketeer Global Comp Health Report — 3-Tab Rebuild

**Status:** Design approved 2026.W33 (2026-08-11)
**Supersedes:** the tab structure and scope of "Rebrand & Modernization Spec v1.1"
**App:** `D:\Contribution\CompDash` — GAS web app, `doGet()` in `Code.js`, UI in `ViewDash.html`
**Owner:** WFP & Compensation Analytics

---

## 1. What this changes and why

The dashboard renders ten tabs. Three of them (Pay Equity, Contribution, Action Queue)
are being deleted outright. Four more collapse into two, because the questions they
answer are the same question asked from different angles: *where does this person sit,
and are they the next adjustment?*

The Internal Position tab renders **one `<div class="card">` containing its own
`<table>` per Location × Job Title group** (`ViewDash.html:1358`). Each table auto-sizes
independently, so no two groups share a column grid — that is the reported symptom of
"fields being misplaced". With one to three members per card, roughly four Rocketeers
fit on a screen.

The rebuild is three tabs, one table component, and one place where a person is
classified.

### Deleted

| Surface | Reason |
|---|---|
| 📌 Action Queue | Per-viewer `UserProperties` checklist. No shared state, no owner accountability. Not replaced. |
| 🧭 Pay Equity | Out of dashboard scope; the equity-flag workflow lives outside this app. |
| 🚀 Contribution | Performance becomes a background field feeding Priority, not a destination. |
| 🚨 Risk Signals | Becomes the **Risk** column of the Compensation Position table. |
| 🌍 Market Gap | Merges into Compensation Position as the **Market** and **Gap to floor** columns. |
| 🎯 Priority Ranking | Becomes the **Priority** column; sorting by it *is* the old tab. |
| Gap waterfall chart (proposed, never built) | The roll-up view's cost-to-floor column already totals the same number. |
| Exit-reason Pareto (proposed) | Each cohort driver narrative already names its dominant reason. |

### Result — three tabs

| # | Tab | Question |
|---|---|---|
| 1 | 🏠 **Executive Pulse** | Is comp health green/amber/red, and what are the top three actions? |
| 2 | ⚖️ **Compensation Position** | Where does each cohort sit internally and vs market, how big is the gap, and who is next? |
| 3 | 📉 **Workforce & Attrition** | Who is leaving, why, how does it compare to the last two FYs, and what does the trend forecast? |

☰ menu (not tabs): 📊 Data Reference · 📋 QTA Status · 🔒 Access Control (admin) ·
🗝️ Executive Compensation (`execView` only).

---

## 2. Architecture

### 2.1 Server — five files, one shared global scope

GAS evaluates every `.js` file into a single global scope, so this split costs nothing
at runtime and buys independently testable units.

| File | Owns | Depends on |
|---|---|---|
| `Code.js` | `CONFIG_CD`, fiscal context, the four sheet readers, payload assembly, gzip-chunk cache, `doGet`, RPC entry points | all of the below |
| `Position.js` | anchor ladder, internal ratio, compa-ratio, gap $, priority score, risk factors, exclusion classification | none — pure |
| `Workforce.js` | 3-FY windows, movement, months × FY matrix, attrition slices, cohort drivers, forecast, manager hotspots, lever engine | none — pure |
| `Narrative.js` | deterministic prose — inclusivity block, driver sentences, signal-card copy | none — pure |
| `Security.js` | roles, allowlists, Executive Compensation gating, audit log | `bustCompCache_` |

`Position.js`, `Workforce.js` and `Narrative.js` take plain objects and return plain
objects. They never touch `SpreadsheetApp`, `CacheService` or `Session`, which is what
makes them runnable in the existing `tests/cases.js` Node harness without stubbing GAS.

### 2.2 Client — four files via `HtmlService` includes

| File | Owns |
|---|---|
| `ViewDash.html` | shell, `<style>`, `VIEWS`, `STATE`, filter bar, tab dispatch, drill panel, shared helpers (`esc`, `fmtMoney`, `visibleEmp`) |
| `Styles.html` | design tokens and component CSS, moved out of the shell |
| `Views.html` | `renderPulse`, `renderPosition`, `renderWorkforce` |
| `Admin.html` | `renderReference`, `renderQta`, `renderAccess`, `renderExecComp` |

`doGet` uses `HtmlService.createTemplateFromFile('ViewDash')` with an
`include(name)` helper; the shell emits `<?!= include('Styles') ?>` etc.

### 2.3 Stale-deploy guard

`PROCESS.md:62` records that silent stale deployments cost the Workforce Report three
debugging rounds. Nine files makes that likelier, so it becomes an error instead of a
silent wrong number.

Each server file declares its build number:

```js
// top of Code.js, Position.js, Workforce.js, Narrative.js, Security.js
var BUILD_ = BUILD_ || {};
BUILD_.position = 46;   // bump on every edit to this file
```

`doGet` compares all five. If any disagree it renders a plain error page naming the
stale file and does not serve the dashboard. `ViewDash.html` carries a `SCHEMA`
constant compared against `meta.schema` from the payload and shows a banner on
mismatch. The existing `meta.build` header badge stays.

### 2.4 Data flow

```
Roster · Comp history · Ratings · Benchmarks
        │  readers in Code.js
        ▼
     records[]
        ├── Position.js   per person: anchor, ratios, gap $, priority, riskFactors, exclusion
        ├── Workforce.js  FY windows, movement, monthly matrix, cohorts, forecast, levers
        └── Narrative.js  prose built from the computed values above, never from raw records
                │
        payload → role strip (server) → gzip chunk cache → client
```

No snapshot store. Every FY comparison computes live from roster hire and termination
dates — the mechanism `fyMovement_` and `fyAttritionBlock_` already use, and the reason
`WorkforceReport` renders FY25/26/27 today with no history table. Trend arrows compare
FY-to-date against the prior FY cut at the same calendar point
(`previousFYSamePeriod`, already built), not against a stored snapshot.

---

## 3. Exclusion — classified once

Spec v1.1 §3.2 defined a unique profile as `internal_peer_count == 0`. At 217 people
across 10 locations with job codes as granular as `09.I3.3`, single-incumbent
title × geo groups are the norm: three of the four Australia & NZ groups visible in the
reported screenshot are `(1 member)`. Applying that test literally would delete most of
the roster from the signals.

`Position.js` sets exactly one field per person, `exclusion`, and every consumer reads
it. A person can never be in the ranking but out of the quadrant.

| Value | Test | Effect |
|---|---|---|
| `null` | anchor resolved, not an executive | fully in scope |
| `"unpositionable"` | the anchor ladder failed at every tier (`anchorTier === "none"`) | out of ranking, quadrant and comp denominators; **stays in headcount**; still listed in the table with a `no anchor` state |
| `"executive"` | `isRestrictedEmp_` — exec-title regex, M-level floor, or explicit `CD_RESTRICTED_EXTRA` grant | out of every comp signal, ranking, quadrant and **comp denominator**; reachable only via Executive Compensation |

`unpositionable` is deliberately narrow: a single-incumbent IC still resolves an anchor
through the market-mean or level-cohort fallback and stays fully in scope.

**Denominator scoping.** Executives leave the *comp-signal* denominators only. They
remain in headcount, FY movement, attrition and the inclusivity counts — excluding them
there would report 208 Rocketeers where the company reports 214, and would drop real
hires and exits from the movement table. Footnote on comp surfaces:

> 217 active · 6 excluded from comp signals as executive profiles

### 3.1 Executive Compensation route

Reuses the existing `PROP_EXECVIEW` allowlist rather than adding a role tier. Admins
keep the access they have today.

- Own route in the ☰ menu, rendered by `Admin.html`.
- Lists executive profiles with market-mean anchoring and a `no peers` badge — the
  badge pattern moves here from the main table.
- Every access writes an audit line: `Logger.log("🗝️ ExecComp viewed by " + email + " · " + iso)`.
- Never exportable outside this route.

---

## 4. Tab 2 — Compensation Position

### 4.1 One table, nine columns, fixed order

`table-layout: fixed` with an explicit `<colgroup>`. Band rows use `colspan="9"` —
the **rendered** column count.

| # | Column | Person row | Cohort band | Roll-up row |
|---|---|---|---|---|
| 1 | Rocketeer / Cohort | name | `Location · code Title` | `Location · Level` |
| 2 | Job title | title | — (in band text) | title |
| 3 | Level | level | — | `n` |
| 4 | TCC | local, USD toggle | — | anchor |
| 5 | Internal | TCC ÷ internal anchor | — | cohort median |
| 6 | Market | TCC ÷ benchmark mean | — | cohort median |
| 7 | Gap to floor | $ to 0.90 × market anchor | cohort total | cost to floor |
| 8 | Priority | 0–100 | — | flagged count |
| 9 | Risk | chip: factor count, hover lists them | — | flagged count |

The cohort band row carries what today repeats on every member row — anchor value,
anchor-tier badge, member count, cohort gap. That alone removes four repeated chips per
person.

### 4.2 Group-by control

One renderer, three groupings. Column order never changes.

| Mode | Row means | Default for |
|---|---|---|
| `cohort` | person, under a full-width cohort band | **admin, viewer** |
| `ranked` | person, flat, sorted by Priority desc | — |
| `rollup` | cohort, click to expand people inline | **exec (locked)** |

### 4.3 Anchor ladder — unchanged

`buildCompaGroups_` already resolves in this order and keeps working as built:

1. `title` — median TCC of ≥ `SMALL_GROUP_MIN` (3) comparable title peers in the same Key Location
2. `market` — external benchmark mean for Location × Job Title
3. `level` — median of the Key Location × Level cohort, ≥ `SMALL_GROUP_MIN`
4. `none` → `exclusion = "unpositionable"`

Part-time and intern records (`comparable === false`) never serve as anchor evidence
and never receive a ratio. Unchanged.

### 4.4 Thresholds

Move to `CONFIG_CD.THRESHOLDS`, echoed into `meta.thresholds` so every chip renders its
rule, threshold and source on hover. No literal appears in a renderer.

| Signal | Definition | Bands |
|---|---|---|
| Internal position | TCC ÷ internal anchor | red < 0.80 · amber 0.80–0.95 · green ≥ 0.95 |
| Market position | TCC ÷ benchmark mean | red < 0.90 (`MARKET_LOW`) · green ≥ 0.90 |
| Gap to floor | `max(0, 0.90 × market anchor − TCC)` | local currency and % of TCC |
| Double flag | internal < 0.80 **and** market < 0.90 | forced to the top of Priority |

### 4.5 Priority score

`priorityScore_` today weights `perf`, `tenure` and `compaGap` — where `compaGap` is
the *internal* gap only. A person who is fine internally but well below market
therefore scores low, which contradicts the purpose of merging the two tabs.

Add a fourth component `marketGap = min(max(0, 1 − marketRatio) / caps.gapPct, 1)` at
the same default weight as `compaGap`. The existing behaviour is preserved: a missing
component drops out and its weight redistributes proportionally, and nothing ever fakes
a zero. `meta.priorityCfg` echoes the new weight.

### 4.6 Quadrant scatter

CSS/SVG, no charting library. x = internal ratio, y = market ratio, both clamped
0.6–1.4. Divider lines at x = 0.80 and y = 0.90; bottom-left quadrant shaded `--june`
at 12%. Clicking a point sets the table filter. Excluded profiles never plot. The exec
role sees cohort centroids only.

---

## 5. Tab 3 — Workforce & Attrition

Render order below. Definitions follow `WorkforceReport` (`D:\Contribution\WorkforceReport\Code.js`),
which is the source of truth for "regular employee" scope.

### 5.1 Fiscal years compared

Current FY vs the previous two — FY27 · FY26 · FY25, fiscal months Jul→Jun aligned.
`fiscalContextCD_` computes current and previous FY only; it gains a third window,
matching `CONFIG_WR.FY_COUNT: 3` which is already live.

- Grouped bars: FY27 solid `--orbe-blue`, FY26 and FY25 as `--border` outlines. CSS, no canvas.
- Months × FY matrix, voluntary attrition rate per cell, each cell coloured by Δ vs the
  same month in the prior FY. This matrix is what produces the "±X pts vs same month
  FY26" figure the driver narratives quote.
- Side-by-side periods only. No cumulative or blended view.

### 5.2 Movement by fiscal year — regular employees

The only movement table on the tab.

| FY | Opening HC | Hires | Voluntary exits | Involuntary exits | Net movement | Closing HC | Voluntary rate % |
|---|---|---|---|---|---|---|---|

- Regular = `employmentType === "regular"`; part-time and intern excluded, crew already
  excluded at read by `CONFIG_CD.CREW_RE`.
- FY27 badged `YTD`, rate annualized.
- `fyMovement_` currently returns a combined `exits`; it needs the voluntary /
  involuntary split, which `classifyTerm_` already provides.
- Row click opens a filtered detail drawer for admin and viewer. Exec gets no drawer.

### 5.3 Cohort driver narratives

Deterministic cards over Key Location × Level cuts. Suppressed below n = 3. Maximum
five, ranked by `Δ pts vs prior FY × cohort size × regretted share`.

```
Chile · I3 — 4 voluntary exits QTD · top reason: competitive offer ·
rate +2.1 pts vs same month FY26 · seasonal pattern consistent with prior years
→ Recommended: stay-interviews for the I3 Santiago cohort before 2026.W40.
```

The recommendation is a config map from dominant exit reason to action text, so no card
invents advice:

| Dominant reason matches | Recommended action |
|---|---|
| competitive offer / better offer | stay-interviews for the cohort |
| career growth / progression | development-plan review with the HRBP |
| manager / management | skip-level conversations |
| compensation / salary / pay | adjustment review against the market floor |
| *(no match)* | HRBP review — reason not mapped |

Card anatomy: cohort chip · count · dominant reason · Δ vs same period prior FY ·
seasonality note · recommended action.

### 5.4 Trend forecast

Transparent and labelled a projection. Documented in an info tooltip. No ML claim.

- **Method:** seasonal index from FY25 + FY26 monthly exit shares × the trailing
  three-month FY27 level.
- **Output:** six months projected. Band = ±1 SD of the two prior FYs' same-month values.
- **Guard:** `low confidence · n=X` when the cohort has fewer than 5 historical exits.
- **Never per person.** Cohort and company level only.
- **Signal:** a projection breaching 13% annualized for any location or level cohort
  raises a WATCH card on Executive Pulse deep-linking here.

### 5.5 Manager hotspots

Retained. Outlier supervisors by exits — a different lens from location × level,
because a manager problem does not respect cohort boundaries. Degrades cleanly when the
roster `Supervisor` column is absent, as it does today.

### 5.6 Compensation growth by lever

Ports `buildLeversForFy_` and `classifyLever_` from `WorkforceReport`. One change:
the current engine accumulates **one entry per comp event**, but the reporting language
counts **Rocketeers**. Each lever gains a distinct-`empNo` set alongside its event count.

| FY | Promotions (people) | Avg promo increase % | Adjustments (people) | Avg adjustment % | Recognition events | % of workforce touched |
|---|---|---|---|---|---|---|

`% of workforce touched` = distinct people with any promo or adjust event ÷ closing
regular headcount. Promotions are a subset of that population, not additive to it.

### 5.7 Inclusivity & Workplace Diversity

Deterministic prose for the **last completed** FY, in a bordered block visually distinct
from the signal cards, with a copy-to-clipboard button. Built by `Narrative.js` from
computed values. No LLM.

Reads two optional roster columns via `colIdx_`, guarded exactly as `gender` is today:

| Header | Flag | Absent behaviour |
|---|---|---|
| `Gender` | `genderAvailable` | gender sentences suppressed |
| `Ethnicity` | `ethnicityAvailable` | replaced by "Ethnicity data pending — column not present in the roster" |

Sentence set:

1. Closing active regular headcount · distinct Key Locations · distinct self-identified
   ethnic groups · % who did not specify
2. Gender split — counts and percentages
3. Promotions in FY by gender, plus the rate against each population's size
4. Adjustments — distinct people, % of workforce, inclusive of promotions, by gender

Small-n suppression: any demographic cut below n = 5 renders a count without a
percentage. Nothing is fabricated when a column is missing.

---

## 6. Tab 1 — Executive Pulse

- **KPI strip**, four question-framed cards with prior-FY ghost values and sparklines:
  *Are people staying?* (voluntary rate, FY-to-date vs prior FY same period) ·
  *Where do we sit vs market?* (median compa-ratio) ·
  *How big is the market gap?* (total $ to the 0.90 floor) ·
  *Who's next?* (double-flagged count). Each click-throughs to its tab.
- **Regretted-loss cost** card — $ of FY payroll released, regretted portion.
- **Signal cards**, maximum 7, ranked by `severity × people affected × payroll $ at
  stake`; overflow into an "All signals" drawer.
- **Forecast breach WATCH** card when §5.4 breaches the band.

### 6.1 SignalCard

```
● RISK   Concentrated exits                    ← severity dot + short title
3 of 5 FY27 exits in People & Services         ← one metric sentence, ≤ 90 chars
[Review with HRBP →]                           ← single action, deep-links
▸ why / method / data source                   ← collapsed detail
```

Severity maps to existing tokens: `RISK` = `--june` · `WATCH` = `--warn` ·
`NOTE` = `--orbe-blue` · `WIN` = `--accent`. Button copy routes to a human
conversation — "Review with HRBP", never "Fix".

### 6.2 Small-sample guard

`150.0% of voluntary exits regretted (3 of 2)` is a ratio computed against a mismatched
denominator. Every ratio in `Narrative.js` is capped at 100%, always shows its counts,
and renders `low confidence · n=X` below n = 5.

---

## 7. Roles

`admin · viewer · exec · denied`, plus the existing `execView` flag. Org-tree
manager scoping is **not** built — `Security.js:9` records it as the headline V2 feature
not to be re-added piecemeal.

| Role | Sees | Group-by | Names | Access Control | Executive Compensation |
|---|---|---|---|---|---|
| `admin` | all three tabs, all menu items | any | yes | yes | with `execView` |
| `viewer` | all three tabs, Reference + QTA | any | yes | no | with `execView` |
| `exec` | all three tabs, Reference | `rollup` only | **no** | no | no |
| `denied` | branded denial page | — | — | — | — |

**Provisioning.** `exec` gets its own allowlist alongside the existing two:
`SEC_CD.PROP_EXECS = "CD_DASH_EXECS"` and `SEC_CD.DEFAULT_EXECS = []`, managed from
🔒 Access Control like the others. Resolution order in `checkDashboardAccess`:

```
1. email in admins?  → "admin"
2. email in viewers? → "viewer"
3. email in execs?   → "exec"
4. else              → "denied"
```

Admin and viewer are checked first on purpose: someone added to both lists keeps the
broader access rather than being silently downgraded to cohort-only.

**Exec enforcement is server-side.** `getCompReportData` strips `name` and `empNo` from
`employees[]` and `people[]` before the payload leaves, keyed instead by an opaque
index. Location, level and department filters still recompute client-side; no identity
is ever sent for the client to hide. No drill panel, no CSV. This mirrors how
`stripRestrictedPayload_` already works and reuses its position in the pipeline.

---

## 8. Visual design

The ServiceRocket tokens are **already implemented** in `ViewDash.html` — `--void-blue`,
`--light-cream`, `--orbe-blue`, `--ivory`, `--june`, a semantic layer (`--bg`,
`--panel`, `--cta`, `--text`), dark default, a light theme via `data-theme` persisted in
`localStorage`, and responsive width tiers. This is a refinement, not a migration.

**Add:**

- `--royal: #2864E6` — missing from the palette. Selection, active indicators, cross-filter state.
- Typography: `Roboto Condensed` for headings and KPI numbers, `Roboto` for body, body
  14/18, table 12/14. Loaded via a Google Fonts `<link>` — a stylesheet, not executable
  script, so it does not carry the supply-chain risk that ruled out a charting CDN.
  System stack (`system-ui, "Segoe UI", Arial`) stays as the fallback.
- Card radius 12px → 8px, hover elevation, skeleton loaders on first paint.
- Freshness chip: `As of 2026.W33 · cached · Refresh`. ISO week format everywhere a
  date appears.
- Emoji tab labels → an inline SVG sprite defined once in `Styles.html`. No icon CDN.

**Accent budget (60/30/10):** 60% canvas (`--bg` + `--text`), 30% structure (`--cta`
navigation, `--border` dividers), 10% accents (`--royal`, `--june`) reserved for signal
chips, warnings and trend arrows. The budget is what enforces "signals, not text".

**Contrast:** RISK renders as a June chip with Void Blue text. Never Orbe text on Cream
or Ivory. White on Orbe only at ≥ 18px or bold.

**Charts:** grouped FY bars, sparklines and the forecast confidence band are CSS and
inline SVG, consistent with the existing `.bar > i` pattern. No canvas, no CDN script.

---

## 9. Security

Retained from the current app: no open-access fallback, no roster-supervisor
auto-resolution, admin → viewer → denied resolution, server-side restricted stripping,
gzip-chunk cache keyed by `CD_CACHE_VER`, allowlist saves bust the cache so a revoked
viewer cannot read a warm payload.

**Added:**

- `exec` role with server-side identity stripping (§7).
- Executive Compensation route behind `execView` with a per-access audit line.
- Exports: exec has none. Admin and viewer CSV carries a requester + timestamp
  watermark. Executive profiles are never exportable outside the Executive
  Compensation route.
- Comp payloads stay in memory. `localStorage` holds the theme choice only.

**Not applicable to this platform** — recorded so the checklist is not re-litigated:
`npm audit`, pinned dependency versions, SRI, CSP headers and axe-core in CI have no
meaning in a GAS HtmlService app deployed by pasting files into the editor
(`PROCESS.md:115`). The accessibility intent survives as a manual keyboard and contrast
pass at hardening.

**Governance:** cross-border comp data review with Legal/People (Chile, ANZ,
El Salvador, Malaysia) remains an open item owned by WFP, tracked outside this spec.

---

## 10. Testing

`tests/cases.js` gains a block per pure module, run by the existing `run_tests.js`
harness:

- `Position.js` — anchor ladder at each tier; exclusion classification; threshold bands
  at boundaries (0.799 / 0.80 / 0.949 / 0.95); priority redistribution with one, two and
  three components missing; `marketGap` present and absent.
- `Workforce.js` — FY window boundaries (Jun 30 / Jul 1); voluntary vs involuntary
  split; movement arithmetic closing to `Opening + Hires − Exits`; forecast with thin
  history; n < 3 narrative suppression.
- `Narrative.js` — ratio cap at 100%; counts always present; missing-column sentences;
  n < 5 suppression.

`render_smoke.js` gains:

- every band row's `colspan` equals the rendered column count (9)
- no `exclusion !== null` profile appears in ranking or quadrant output
- an exec-scoped payload contains zero `name` fields
- the position table emits exactly one `<table>` element

Tests are blind to layout. After P1 renders, produce a screenshot and confirm the column
grid visually before moving on.

---

## 11. Delivery

| Phase | ISO weeks | Scope |
|---|---|---|
| **P0 — Foundation** | 2026.W34 (Aug 17–21) | File split + `include()` wiring, `BUILD_` guard, delete the six dead routes and their renderers, `--royal` + typography + radius + SVG sprite, `THRESHOLDS` extraction |
| **P1 — Position** | 2026.W35–W36 (Aug 24 – Sep 4) | `Position.js`, the one table with Group-by, quadrant, exclusion end-to-end, Executive Compensation route, `exec` role |
| **P2 — Workforce** | 2026.W37–W38 (Sep 7–18) | `Workforce.js` — third FY window, FY compare, movement table, manager hotspots, drivers, forecast |
| **P3 — Narrative** | 2026.W39 (Sep 21–25) | `Narrative.js` — lever engine with distinct-person counts, inclusivity prose, Pulse signal cards |
| **Hardening** | 2026.W40 (Sep 28 – Oct 2) | Keyboard + contrast pass, HRBP and exec UAT, deploy |

**Deploy, every phase:** paste changed files → run `bustCompCache_()` → publish a **new
deployment version**. Saving files without a new version keeps serving old code.

**Roster prerequisite** (owner: Moises, before P3): add `Gender` and `Ethnicity` columns
to the roster sheet. P3 ships either way — the section states what is pending rather
than fabricating it.

---

## 12. Acceptance criteria

1. An exec answers "is comp health green/amber/red, and what are the top three actions?"
   in under 60 seconds on Tab 1 without reading a paragraph.
2. Internal position, market position and salary gap are all answerable from **one tab**
   for any location or level cohort.
3. The position table renders as **exactly one `<table>`** with an unchanging column
   order in all three Group-by modes.
4. No executive profile appears in any signal, ranking, quadrant, comp denominator or
   export outside the Executive Compensation route.
5. Executives remain counted in headcount, FY movement, attrition and inclusivity.
6. Tab 3 shows FY27 · FY26 · FY25 side by side, exactly one movement table, at least one
   driver narrative of the form *⟨location⟩ · ⟨level⟩ — ⟨reason⟩ · ±X pts vs same month
   prior FY*, and a forecast labelled as a projection with a confidence band.
7. No individual identity is reachable from the `exec` role or its exports, verified
   against the payload rather than the rendered DOM.
8. Every number shows its rule, threshold and source in one hover or click; no literal
   threshold appears in a renderer.
9. A partially pasted deploy produces a visible `BUILD_` mismatch error, not wrong numbers.
10. No ratio exceeds 100%; every ratio shows its counts; n < 5 renders `low confidence · n=X`.
