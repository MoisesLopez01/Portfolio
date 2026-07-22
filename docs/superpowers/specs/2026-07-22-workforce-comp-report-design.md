# Workforce & Compensation Report — Design

**Date:** 2026-07-22 (2026.W30)
**Status:** Approved design, pre-implementation
**Owner:** Moises Lopez
**Related:** `docs/superpowers/specs/2026-07-21-comp-health-dashboard-design.md` (CompDash — shares source sheets, not code)

---

## 1. Purpose

Leadership needs regular visibility into attrition, comp trends, and career-growth
signals ahead of the Q1 QTA cycle. This project delivers a **standalone GAS web app**
that renders a Workforce & Compensation Report across fiscal years **FY25, FY26, FY27**
(FY starts Jul 1; FY27 = Jul 2026–Jun 2027, in progress at build time), in two views:

- **View A — Location report** (evidence layer): a per-country or company-wide report
  in the Fact/Assumption/Risk/Note (FAR/N) idiom, modeled on the Chile Workforce &
  Compensation Report example.
- **View B — Board brief** (synthesis layer): a 10-section board-deck story synthesized
  across all locations, with AI-generated interpretive text.

The two views live in one app; the brief's appendix links to the location reports.

## 2. Decisions taken (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Delivery form | Isolated GAS web app (`WorkforceReport/`) | CompDash already large; report iterates on its own deploy cadence |
| Scope | Both views in one app | Brief needs evidence behind claims; appendix links come free |
| AI role | Synthesis only | FACT lines templated from computed numbers — AI can never corrupt a figure |
| Access | CompDash `Security.js` pattern copied | Proven; board emails added as viewers at share time |
| Data layer | Fork CompDash readers | Sheets are the shared contract; matches one-folder-per-app repo pattern |

## 3. Architecture

New folder `WorkforceReport/`:

| File | Role |
|---|---|
| `Code.js` | PURE LOGIC first (Node-testable), GAS layer second. Forked readers, FY engines, report aggregation, `doGet`, `getWorkforceReportData(scope)` |
| `Security.js` | Copied CompDash pattern: bootstrap admin (`moises.lopez@servicerocket.com`), code-level default allowlist, Script Properties runtime list (`WR_DASH_ADMINS` / `WR_DASH_VIEWERS`) |
| `ViewReport.html` | SPA frontend: view switcher (Location report / Board brief), scope selector, FY toggle, print CSS |
| `tests/` | Node test cases for the pure-logic block (CompDash `tests/` pattern) |

### Data flow

```
doGet → checkReportAccess() → ViewReport template
client → getWorkforceReportData(scope)        scope = "company" | <Key Location>
server → readRosterWR_() + readCompHistoryWR_() [+ benchmarks/ratings readers]
       → buildReportPayload_(records, hist, ctx)   // FY25/26/27 blocks per scope
       → cachePutLarge_ (gzip + 90KB chunks), key wr_v<WR_CACHE_VER>_<scope>
client → renders both views from one payload; AI narrative fetched separately
```

### Sources (same spreadsheets as CompDash, own `WR_*` property overrides)

- **Roster** `Data` tab: Employee Number, Name, Employee Status, Job Title, Hire Date,
  Termination/Release Date + Reason + Category + Regretted, Department, LOB, Location,
  Key Location, Currency, TCC, TCC USD, Gender (optional).
- **Comp history** `RD` tab: Employee Number, Effective Date, Total Target Compensation,
  TCC Change Reason, TAG.
- **Benchmarks** `Compilation` tab and **Ratings** tab: optional, for the market/equity
  flags section only.

All column access by header name (`colIdx_` pattern). Crew excluded by the
`/crew member|contractor/i` job-title rule (no employee-type column exists — see §7).

## 4. Fiscal-year model

- FY derivation reuses the `fiscalContextCD_` rules. The payload carries three FY blocks:
  FY25 (complete), FY26 (complete), FY27 (in progress).
- Every FY27 figure renders with an automatic NOTE: *"FY27 in progress — data as of
  {extraction timestamp}"*. Attrition rate for the open FY uses as-of headcount as the
  period end (existing `fyAttritionBlock_` behavior).
- Report header states the extraction timestamp (payload build time), mirroring the
  example's "data extracted on 18 Jun 2026".

### FY25 depth guard

FY25 movement/attrition is only as good as the roster's retention of rows terminated
back to Jul 2024. The payload includes `earliestTermDate`; if it is later than
2024-07-01, the FY25 column renders a RISK line: *"FY25 exits may be undercounted —
earliest retained termination is {date}"*. `debugReportPipeline()` prints per-FY
record coverage (rows with term dates per FY, comp events per FY) for the deploy check.
The same guard applies to RD history: if no comp events predate 2025-07-01, the FY25
lever section renders the analogous RISK line.

## 5. Currency

- **Country scope**: local currency; single-currency countries aggregate directly
  (Chile-example style). If a Key Location spans >1 currency, TCC aggregates switch to
  TCC USD for that location with a NOTE naming the currencies found.
- **Company scope**: TCC USD column, with an ASSUMPTION line naming the column as the
  conversion source and a NOTE counting employees missing a USD value (excluded from
  comp aggregates, included in headcount).

## 6. View A — Location report (FAR/N evidence layer)

Scope = company or one Key Location. Seven sections; every line renders with a
FACT / ASSUMPTION / RISK / NOTE badge. **All sentences are templated with computed
numbers interpolated — no AI in this view.**

1. **Scope & population** — active record counts; crew-exclusion NOTE (job-title rule);
   NOTE that interns cannot be split out (no employee-type column — divergence from the
   NetSuite example, stated explicitly).
2. **Composition** — department headcount table; IC vs Manager split; level distribution
   (`parseLevel_`); tenure buckets (<1y, 1–3y, 3–5y, ≥5y) + average. No ASSUMPTION lines
   (de-hedged 2026-07-22 — parsing/tenure derivations fold into the FACT wording).
3. **Compensation structure** — avg TCC by level table; total TCC envelope + per-head
   average; NOTE: *TCC includes variable target; it is not base wage*. Salary-inversion
   FACT auto-fires when a manager band average sits below a senior IC band average.
4. **Workforce movement** — hires/exits/net per FY25/26/27; attrition rate per FY. The
   rate definition (rate = exits ÷ mean(start, end headcount); end = asOf for FY27) and
   hire-by-hire-date / exit-by-term-date dating render as one NOTE — no ASSUMPTION lines
   (de-hedged 2026-07-22).
5. **Attrition detail** — per FY: regretted count and %; recorded termination reasons;
   departments and levels of leavers; average leaver tenure. RISK lines auto-fire on
   thresholds (config-tunable): regretted share ≥ `RISK_REGRET_PCT` (default 60%),
   single-reason concentration ≥ half of exits.
6. **Compensation growth by lever** — the example's sections 6+7 merged (only source is
   RD comp history; no cycle-event source exists, so no reconciliation NOTE is needed).
   Per FY: promotions vs adjustments vs new hires — event counts, total raise (scope
   currency), aggregate % TCC growth vs prior comp record. The TCC Change Reason domain
   is a KNOWN CLOSED SET (confirmed 2026-07-22): New Hire, Annual Adjustment, Microband
   Adjustment, Promotion, Market Calibration, Internal Transfer, Microband Promotion,
   Historical Data Update — so the classification renders as a NOTE of record, not an
   ASSUMPTION: promotions = Promotion + Microband Promotion; **new hires are their own
   growth event** (baseline record row, count only, no delta); adjustments = every other
   recorded reason (catch-all so a future flavor never silently drops); only Internal
   Transfer / Historical Data Update / blank reasons excluded. Changes lacking a prior
   comp record are excluded from
   deltas (counted, noted). RISK auto-fires on the lever-shift pattern (promotion count
   and size down while adjustment count up, FY-over-FY).
7. **Market & equity flags** — **counts only, never names**: compa-ratio distribution vs
   internal median bands, market-gap flag counts vs benchmark Compilation rows where
   they exist, pay-equity flag counts. Thresholds (`COMPA_*`, `EQUITY_*`,
   `SMALL_GROUP_MIN`) are **copied from CompDash into this project's `CONFIG_WR`** —
   same values at fork time, independently tunable after. Groups smaller than `SMALL_GROUP_MIN` (3) suppressed with a
   NOTE. If gender column absent, equity block states "pending" instead of rendering.

## 7. View B — Board brief (synthesis layer)

Company scope only. Ten sections per the approved outline:

1. **Cover** — ServiceRocket-themed: "Global Workforce & Compensation Review · FY27".
2. **Executive summary** *(AI)* — 3–4 company-wide headline signals.
3. **Company at a glance** — total headcount, split by location & function, total TCC
   envelope (USD).
4. **Movement & attrition** — hires/exits/net, company + per-location matrix,
   regretted-attrition trend FY25→FY27.
5. **The retention signal** — where regretted loss concentrates: level × tenure ×
   reason (computed crosstab).
6. **Compensation strategy** — promotions-vs-adjustments shift, growth by lever,
   FY-over-FY.
7. **Structural risks** — computed candidates only: salary inversions (manager band <
   senior IC band), function concentration (top department share of headcount), tenure
   concentration, mid-level flight (exit share at I3–I4).
8. **Location spotlights** — comparison matrix (headcount, attrition %, regretted %,
   avg TCC USD, promo rate) + one flag per location. *(AI selects the flag from the
   computed candidate list only.)*
9. **Decisions for the board** *(AI draft)* — 2–3 items, rendered as an editable draft,
   clearly marked as AI-generated.
10. **Appendix** — links to each location report (same app, scope param).

Both views ship print CSS so either can go to PDF for board distribution.

## 8. AI narrative mechanics

- **Model/transport**: Gemini 2.5 Flash via the proven `callGeminiNarrative` pattern —
  key in Script Properties `GEMINI_API_KEY`, sent as `x-goog-api-key` header (never in
  the URL or logs).
- **Data minimization by construction**: the prompt receives computed FY aggregates only
  (counts, rates, deltas, the structural-risk candidate list). Never names, emails, or
  per-person TCC.
- **Prompt contract**: cite only figures provided; frame interpretation as
  risk/observation; never invent numbers; British-neutral business register.
- **Rendering**: distinct "✨ AI synthesis" blocks so a reader always knows which text
  is generated. Generated on demand (button), cached per scope + `WR_CACHE_VER`, with
  Regenerate.
- **Degradation**: Gemini failure or absent key → report fully renders with "narrative
  unavailable" placeholders. AI is additive, never load-bearing.

## 9. Error handling

- Missing **required** roster/RD columns → throw with named-column messages (existing
  reader pattern).
- Missing **optional** data degrades to NOTEs: no gender → equity pending; no benchmark
  row for a title → market flag skipped for that title; no TCC USD → per §5.
- FY25 under-coverage → RISK line per §4, never a silently wrong number.
- Cache read with missing chunk → clean miss, recompute (existing `cacheGetLarge_`
  behavior).

## 10. Testing

- Pure-logic block gets Node tests in `WorkforceReport/tests/` (CompDash pattern —
  eval Code.js with stubbed `Logger`): FY bucketing (pin the Jun 30 / Jul 1 edge),
  movement counts, attrition-rate reconstruction, lever classification + delta math,
  inversion/concentration detectors, templated-sentence builders (numbers land in the
  right slots), FY25-coverage guard firing.
- Manual deploy QA: numbers **will differ** from the NetSuite-sourced Chile example
  (different source system; TCC vs base wage) — compare shapes and orders of magnitude,
  not exact matches. Run `debugReportPipeline()` and verify FY25 coverage output.

## 11. Deploy checklist (owner)

1. Create the GAS project; paste `Code.js`, `Security.js`, `ViewReport.html`.
2. Set Script Properties: `GEMINI_API_KEY`; optional `WR_ROSTER_SS_ID` /
   `WR_COMP_HIST_SS_ID` / tab overrides (defaults fall back to the CompDash IDs).
3. Run `debugReportPipeline()` — verify per-FY coverage, FY25 guard, column resolution.
4. Deploy as web app; add viewer emails via the runtime allowlist when ready to share.

## 12. Out of scope (V1)

- Intern/employee-type split (no source column; revisit if the roster gains one).
- NetSuite cycle-event counts (no source; lever analysis covers the story).
- Base-wage reporting (TCC only).
- Editable/saved board-decision text (AI draft is regenerate-only in V1).
- Scheduled email/PDF distribution.
