# Rocketeer Global Comp Health Report (V1) — Design

**Date:** 2026-07-21 (2026.W30)
**Status:** Approved design, pending implementation plan
**Author:** Moises Lopez + Claude

---

## 1. Objective

Deliver a repeatable, leadership-ready GAS web-app dashboard that provides global
visibility into compensation standing, career growth trends, and workforce health —
enabling data-driven decisions during the Q1 QTA (Quarterly Talent Assessment) cycle.

It is the data layer behind the Rocketeer Promise ("compensation that is competitive,
fair, and consistent across every location"): managers reviewing salaries, submitting
adjustments, and preparing for QTA need a shared, reliable view of where each Rocketeer
stands relative to peers, the market, and their own growth trajectory.

The manager's mental model (drives the Overview tab):

| Question | Data module |
|---|---|
| Is my team healthy? Are people staying? | Attrition |
| Are my Rocketeers paid fairly relative to peers? | Internal Position (compa) |
| Is our band still competitive in the market? | Market Gap (Payscale) |
| Is anyone being paid inequitably? | Pay Equity |
| Who is coming up for review this quarter? | QTA Status |
| Whose contribution warrants recognition or adjustment? | Contribution (link-out) |

---

## 2. Decisions log

| Decision | Choice |
|---|---|
| Architecture | Standalone GAS project in a new folder; single cached JSON payload |
| Access model | Explicit allowlist only — NO supervisor auto-resolution, NO delegates, NO open access |
| V1 audience | Leadership pilot (bootstrap admin + WFP/leadership allowlist), all seeing global data; broad manager rollout with org-tree scoping is the headline V2 feature |
| Level | Parsed `I#` / `M#` token from Job Title (e.g. `04.I3.1` → `I3`; `I` = IC, `M` = management) |
| Compa anchor | `TCC ÷ max(TCC)` within Key Location + Job Title peer group (active only, local currency), labeled **"Internal Position (vs peer max)"** — never presented as band-midpoint compa. True band compa deferred until band data exists |
| Attrition framing | Fiscal-year comparison: previous FY shadow area + current FY trend line, Quarter/Month drill (FY starts July 1) |
| Crew/contractors | Excluded everywhere in V1 — same rule as the PS Contribution Report (`/crew member|contractor/i` on Job Title; same roster source) |
| Pay equity tab name | **Pay Equity**; lenses = gender, tenure, location anomalies |
| Gender data | User is adding a `Gender` column to the roster; all gender computations degrade to "pending" until it exists |
| QTA tab | Placeholder with a real interim signal: Rocketeers sorted by RD `Next Review` (overdue first) + "official QTA source pending" banner |
| Market Gap tab | Placeholder with live layout; P25/P50/P75 Payscale columns empty until benchmark data lands |
| Contribution tab | Link-out card to the PS Contribution Report web app — no duplication |
| Growth view | Not a tab — a shared employee drill panel opened from any employee row (Compa / Market Gap / Pay Equity) |

---

## 3. Project structure

New folder `D:\Contribution\CompDash\`:

| File | Role |
|---|---|
| `Code.js` | `CONFIG_CD`, data readers, metric assembly, `doGet()`, `getCompReportData()`, cache helpers, fiscal context, `debugCompPipeline()` |
| `ViewDash.html` | SPA served via `HtmlService` — `VIEWS` array navigation, tab renderers, currency toggle, employee drill panel |
| `Security.js` | `SEC_CD` — email-allowlist access control |
| `tests/` | Node-runnable tests for the pure-logic functions |

Deployed as its own GAS project bound to its own spreadsheet, consuming the two
source files by ID. The skeleton (CONFIG pattern, readers, cache, VIEWS nav,
security) is copied from the PS Dashboard best practices and is the intended seed
for a future reusable "GAS dashboard skeleton" skill.

### Config (`CONFIG_CD`)

Fallback IDs in code, overridable via Script Properties:

| Property | Fallback | Meaning |
|---|---|---|
| `CD_ROSTER_SS_ID` | `1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0` | Roster + attrition + `TCC USD` tabs (same source as the contribution report) |
| `CD_COMP_HIST_SS_ID` | `1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU` | Compensation Report — `RD` tab (historical TCC events) |
| `CD_CONTRIB_URL` | — | PS Contribution Report web-app URL for the link-out tab |

Also in `CONFIG_CD`: cache TTL (65 min), equity thresholds (gap %, outlier %,
small-group size), `DEBUG` flag. Verify the actual active-roster tab name at build
time (expected `Data`, per the contribution-report source).

---

## 4. Security model (`Security.js`)

Deliberately **smaller** than PS Security — comp data gets no convenience fallbacks:

1. `SEC_CD.BOOTSTRAP_ADMIN` = `moises.lopez@servicerocket.com` — always Admin, indestructible.
2. `DEFAULT_ADMINS` / `DEFAULT_VIEWERS` — hardcoded arrays, survive property resets.
3. Runtime lists in Script Properties (`CD_DASH_ADMINS`, `CD_DASH_VIEWERS`) managed
   from the admin-only 🔒 Access Control view.

**Removed entirely (not flagged off):** open-access fallback, roster-supervisor
auto-resolution, delegates. Role resolution: admin → viewer → denied.

- `checkDashboardAccess()` is enforced server-side inside `getCompReportData()` (and
  every other `google.script.run` entry point), not just in `doGet()`.
- Admin vs viewer in V1: admins additionally see Access Control; both roles see all
  data tabs (viewers are hand-picked leadership).
- Denied users get a branded denied page (GD Security pattern), never data.

---

## 5. Data model

### Readers (all header-name lookups, never positional; `normPS_`-style name normalization)

- `readRosterCD_()` — every roster row with an `active` flag
  (active = no Termination/Release Date AND Employee Status not matching the inactive
  regex). Active rows feed comp metrics; terminated rows feed attrition. Picks up
  `Gender` when the column exists. Crew regex excluded before anything else.
- `readTccUsd_()` — `TCC USD` tab → Employee Number → USD TCC map (columns read
  dynamically at build time; join key Employee Number).
- `readCompHistory_()` — `RD` tab events grouped by Employee Number, sorted by
  Effective Date ascending. Fields used: Effective Date, TCC Change Reason,
  Total Target Compensation, Next Review.

### Derived fields

- **level** — regex-extract the `I\d+` / `M\d+` token from Job Title
  (`04.I3.1` → `I3`, type IC; `04.M10.2` → `M10`, type Management). Unparseable
  titles → level `"—"`, grouped separately, never dropped.
- **compaRatio (Internal Position)** — active employees only:
  `TCC ÷ max(TCC)` within the same **Key Location + Job Title** group, local
  currency. Group of 1 → ratio 1.0 + `noPeers` flag; group size < 3 → `smallGroup`
  flag. Color bands: ≥ 0.90 green, 0.75–0.90 yellow, < 0.75 red.
- **attrition** — terminated rows bucketed by fiscal year / fiscal quarter / month
  (FY starts July 1; reuse the `computeFiscalContext_()` derivation pattern).
  Voluntary vs involuntary from Termination Category; Termination Regretted
  surfaced as a chip. Rate = terminations ÷ average headcount of the period, where
  average headcount = mean of the active headcount at the period's start and end
  dates (reconstructed from Hire Date / Termination Date, crew excluded).
  Slice dimensions: **Department, level, Key Location**.
- **growth** — per employee from RD events: TCC event series (before → after per
  event) + annualized rate between consecutive events via RRI
  (`(curr/prev)^(1/years) − 1`), skipping the New Hire baseline event; plus an
  overall first-to-latest annualized rate.
- **equity** — computed within Key Location + level groups:
  - *Gender lens*: median-TCC gap % by gender per group; groups exceeding the
    configurable threshold flagged. "Pending" until the `Gender` column exists.
  - *Tenure lens*: long-tenured employees (from Hire Date) sitting near the bottom
    of their group's TCC range.
  - *Location lens*: individuals ≥ X% below their group median.
  All thresholds in `CONFIG_CD`.
- **qtaInterim** — active employees with latest RD `Next Review`, sorted overdue
  first / longest-waiting on top.

### Payload (`getCompReportData()`)

One JSON: `meta` (fiscal context, currency availability, per-source freshness/status),
`employees[]` (roster + level + compa + flags + USD TCC), `attrition`, `compaGroups`,
`equity`, `qtaInterim`, `history` (per-employee event series for the drill).

### Currency

- Local currency is the default display and the ONLY basis for within-group compa math.
- USD (from `TCC USD`) powers all cross-location aggregates (Overview KPIs, global
  medians) and the header **Local | USD** display toggle.

---

## 6. UI (ViewDash.html)

Navigation copies the PS pattern: `VIEWS` array as single source of truth, tab bar +
☰ menu, role gating enforced inside `switchTab()` (forbidden id → Overview).

**Header:** title "Rocketeer Global Comp Health Report", fiscal-context subtitle
(derived, e.g. `FY27 Q1`), **Local | USD** toggle, Refresh (cache-bypass reload).

**Tab bar:**

1. **🏠 Overview** — six KPI cards labeled with the manager's mental-model questions,
   each linking to its tab, + a compact attrition sparkline.
2. **📉 Attrition** — previous-FY shadow area + current-FY trend line, Quarter | Month
   granularity switch; voluntary/involuntary split; regretted-% chip; breakdown table
   by Department / level / Key Location. Counts only in the chart area; names only in
   expandable detail rows (house rule).
3. **⚖️ Internal Position** — Key Location → Job Title groups: peer max (the 1.0
   anchor), member count, per-employee ratio bars with the green/yellow/red bands and
   `noPeers` / `smallGroup` flags. Filters: location, level, department.
4. **🌍 Market Gap** *(placeholder, layout live)* — active employees grouped by
   Key Location, sorted TCC high→low. Columns: Emp #, Name, Job Title, Currency, TCC,
   P25 / P50 / P75 (empty), position-vs-market badge, **Suggestion** column
   (% increase to reach P25 = red priority; to P50 = yellow; at/above P50 = green).
   Visible "Benchmark data pending" banner.
5. **🧭 Pay Equity** — the three lenses (gender / tenure / location) with a flag list;
   group-level gap stats up top, individual flags in expandable rows. "Gender data
   pending" state until the column exists.
6. **📋 QTA Status** *(placeholder + interim signal)* — Next-Review-sorted list
   (overdue first) with a "official QTA source pending" banner; V2 layout sketched.
7. **🚀 Contribution** — card with a short description + button linking out to the PS
   Contribution Report (`CD_CONTRIB_URL`).

**☰ menu:** 🔒 Access Control (admin only), 📊 Data Reference (everyone — formula,
source, refresh cadence, and caveats for every metric, including the honest
explanation of the max-anchor Internal Position metric).

**Employee growth drill (shared component):** clicking an employee row in tabs 3–5
opens a detail panel: RD event history table (date, reason, TCC before → after),
**waterfall chart** of TCC growth event by event, RRI annualized rate per interval
and overall (New Hire baseline excluded). One component, three entry points.

---

## 7. Cache

PS-pattern gzip-chunked cache (`cachePutLarge_` / `cacheGetLarge_` copies): key
`cd_v<VER>_all` (single scope — no manager scoping in V1), TTL 65 min, `CD_CACHE_VER`
Script Property bumped by any settings/access save. Refresh button bypasses cache.
No warmer in V1 (payload is small); add later if cold loads hurt.

---

## 8. Error handling

- Every reader wrapped in try/catch reporting into `meta.sources`
  (`{roster: "ok", tccUsd: "missing", history: "error: …"}`).
- Frontend renders a per-tab "source unavailable" state instead of a blank dashboard.
- Missing optional columns (Gender) → feature-level "pending" states, never crashes.
- `⚠️` / `❌` log prefixes always on; verbose logs behind `CONFIG_CD.DEBUG`.

---

## 9. Testing

- Pure-logic functions written GAS-free (level parser, compa grouping + flags, RRI,
  fiscal attrition bucketing, equity thresholds, QTA interim sort) and covered by a
  Node runner in `CompDash/tests` (same approach as `_test_weightsResolver()`).
- `debugCompPipeline()` diagnostic (mirrors `debugDemandPipeline()`): per-reader row
  counts, join hit-rates (Employee Number ↔ TCC USD ↔ RD), level-parse success rate,
  group-size distribution.
- Security QA before any deploy: allowlist bypass attempts, `google.script.run`
  direct-call gating, denied-page behavior.

---

## 10. Deployment

1. Create the bound spreadsheet + GAS project; push `Code.js`, `ViewDash.html`,
   `Security.js`.
2. Seed Script Properties (`CD_ROSTER_SS_ID`, `CD_COMP_HIST_SS_ID`, `CD_CONTRIB_URL`).
3. Deploy web app: execute as owner, access limited to domain.
4. Allowlist the leadership pilot (WFP + selected execs) via Access Control.

---

## 11. Explicitly deferred (V2+)

- **Org-tree manager scoping** (PS delegate/supervisor model) — the headline V2
  feature enabling broad manager rollout.
- Payscale P25/P50/P75 benchmark data for Market Gap.
- Official QTA-cycle data source.
- Band-midpoint compa ratio (needs salary-band data).
- Crew/contractor inclusion.
- Cache warmer.
- Extraction of the dashboard skeleton into a reusable skill.
