# Rocketeer Global Comp Health Report — Process Documentation & Review

**File pair:** `CompDash/Code.js` (GAS backend) + `CompDash/ViewDash.html` (SPA) + `CompDash/Security.js` (access)
**Status:** V2 code complete; this document supports the review ahead of the next deployment.
**Prepared:** 2026-07-23 (2026.W30)
**Review focus:** end-to-end process transparency, plus one open dilemma — *high contributors whose work is invisible to the current scoring inputs* (§7).

---

## 1. Purpose

A single web dashboard answering, for every active Rocketeer: **where does their compensation stand, and who should the next QTA cycle look at first?** It consolidates internal position (compa-ratio vs peer anchors), external market gap, pay equity lenses, attrition context, review readiness, and a Priority Score that ranks who most needs a compensation conversation.

It is a **decision-support tool for the QTA (Quarterly Talent Adjustment) process** — it proposes focus, it never decides. The decision framework of record is the
[Compensation Audit Guiding Principles](https://rocketeers.atlassian.net/wiki/spaces/WFP/pages/5088477867) (Checks A–E live since FY26Q2–Q3, F–K staged).

## 2. Data sources

| Source | Sheet / tab | Join key | Feeds |
|---|---|---|---|
| Roster | `Data` tab (+ `TCC USD` column, header-resolved) | Employee Number | population, TCC local + USD, location/level/title, hire & term dates, gender (when present) |
| Compensation history | `RD` tab (Compensation Report) | Employee Number | growth events, promotion detection, profile tenure, TTM growth |
| Performance ratings | `Small Improvements RD` | Employee Number | perf component of Priority Score |
| Market benchmarks | `Compilation` | normalized Location + Job Title | Market Gap view; anchor tier 2 |

All spreadsheet IDs are `CONFIG_CD` fallbacks, overridable via `CD_*` Script Properties. Crew/contractors are excluded at read (`CREW_RE`); Rocketeers on maternity/parental leave **stay in** comp metrics (deliberately narrower inactive regex than PS Security).

## 3. The anchor model (what "position" means)

Every comparison is **within one Key Location** — never across currencies (the rule validated in the Workforce Report exec review: blended multi-currency averages are geography-weighted cost figures, not equity evidence). Each person resolves an internal anchor through tiers:

1. **Title peers** — median TCC of the same Job Title in the same location, needs ≥ `SMALL_GROUP_MIN` (3) members.
2. **Market row** — benchmark mean for that location + title, only if the row's currency matches the roster's.
3. **Level cohort** — median of the same level in the same location (≥ 3 members).
4. **None** — "no resolvable internal anchor": the person is *excluded* from position/equity scoring rather than scored against a bad comparison. Coverage must be stated wherever conclusions are drawn from this view.

Ratio bands (client renders from `meta.compaBands`, never hard-coded): red < 0.80 ≤ yellow < 0.95 ≤ green ≤ 1.10 < violet.

## 4. Priority Score (the ranking view)

`priorityScore_` weights three components, renormalized over whatever data exists per person (`partial` + `missing` flags carried to the UI):

| Component | Weight | Normalization |
|---|---|---|
| Performance (SI rating avg) | **57** | avg ÷ 5 |
| Tenure | **29** | 50% company years (cap 10) + 50% in-role years (cap 5; promotions/transfers reset via `PROMO_RE`) |
| Compa gap | **14** | distance below anchor ÷ 25% cap |

A high score = *look at this person first in the cycle*. **Note for §7: contribution signals (goals, tracked time, RCR, kudos) are not inputs today** — performance here means Small Improvements ratings only.

## 5. Other engines

- **Pay Equity** — three lenses inside location+level groups (same currency by construction): gender median gap ≥ 10%, individual outliers ≥ 25% below group median, long-tenure (≥ 3y) sitting ≥ 15% below median. Groups < 3 suppressed; names only in expandable detail rows.
- **Attrition** — per-FY blocks (hires/exits/rates) with month granularity and dimension slicing; client mirrors of the FY functions are byte-identical to the server's (change both together).
- **QTA Status** — review readiness / overdue tracking for the cycle.
- **Views**: Overview · Priority Ranking · Attrition · Internal Position · Market Gap · Pay Equity · QTA Status · Contribution (pointer to the PS Contribution Dashboard) · ☰ Data Reference · ☰ Access Control (admin).

## 6. Known limitations & planned enhancements (from the 2026.W30 Workforce Report review)

1. **Level-cohort anchors can cross job families.** A one-of-a-kind title (e.g. an Executive Assistant, `15.I5.2`) falls back to the location+level cohort — consultants, engineers, PMs mixed together. Planned: family-aware cohorts (location + level + family when ≥ 3), "level (cross-family)" tier labeling, and a config exclusion list so heterogeneous families (JF015 Operations) never serve as anchor evidence. *(P1, target 2026.W31)*
2. **Anchor coverage is a headline, not a footnote.** The share of actives with no resolvable anchor and the count of suppressed groups should lead the position/equity views.
3. **No build badge.** The deployed version must be visible in the header (`meta.build`) — the Workforce Report burned three debugging rounds on silent stale deployments.
4. **FY27-to-date attrition reads low next to closed years.** Planned: same-period twin comparison (closed FY truncated to equal elapsed span). *(P2)*

## 7. THE REVIEW DILEMMA — invisible high contributors

### 7.1 The problem

The QTA checks and this dashboard both see a Rocketeer through **SI rating + Goal Audit + RCR + TCC growth**. Two groups fall through that lens:

- **Delivery Rocketeers with high "glue" contribution but modest RCR** — Check C (High Contributors, Service Delivery) requires RCR ≥ 2.5, so someone carrying escalations, mentoring, internal tooling, or enablement — work that *protects* revenue rather than invoicing it — can miss the high-contributor category entirely.
- **Non-delivery Rocketeers whose output isn't rating-visible** — Check A relies on SI 4–5; a manager's rating cadence or visibility gap can leave a genuinely high contributor at "3" or unrated.

This is a recognized company problem, not a dashboard invention: **[GTT-35 — The 360° Contribution Framework](https://rocketeers.atlassian.net/browse/GTT-35)** (In Progress) states it directly — *"RCR only captures the financial footprint of a consultant, leaving out the 'invisible' work that drives our brand, technical excellence, and long-term scalability"* — and proposes four non-RCR pillars: **Thought Leadership, Operational Excellence, Technical Growth, Community & Mentorship**.

There is also an audit precedent for exactly this fairness posture: **Check K** rules that *"No Rating" is not a free pass* — missing evidence triggers a manual follow-up, never an auto-reject. The same principle should extend to contribution: **absence of RCR (or a thin rating) is not evidence of absence of contribution.**

### 7.2 What already exists per Rocketeer (the contribution set)

The company already measures a weekly, per-Rocketeer contribution set — it just doesn't reach the comp view:

| Signal | System of record | Today it feeds |
|---|---|---|
| Goal compliance + Goal Audit score | Goals sheets → Goal Compliance dashboard | Checks A/C/D |
| Planned time (Tempo plans) | TempoPlanExport | PS Contribution Dashboard |
| Tracked time | TempoTrackedTime | PS Contribution Dashboard, demand dashboard |
| RCR | Revenue reporting (Delivery) | Check C/D; leadership weekly (per PEOPLE-38647) |
| Kudos given/received | Kudos program | PS Contribution Dashboard (declining trend noted in the W21–W25 Contribution Satellites) |
| SI ratings | Small Improvements | This dashboard's perf component |
| RPI (Rocketeer Performance Index) | Contribution Definitions (ABCT) | weekly Contribution Satellites |

The PS Contribution Dashboard already computes a **team-aligned weighted contribution score per Rocketeer** ("team gates, family tunes" — R&D and Sales members are never scored on tracked/planned/RCR they don't own). That is the closest existing artifact to a fair per-person contribution number.

### 7.3 Proposed solution (for review)

Principle first, consistent with our leadership behaviors: the mechanism must **surface people for a human conversation, never re-score them automatically** — recognition and fairness decisions stay with managers and WFP.

1. **Join the contribution set into the employee drawer (evidence, not score).** Each Rocketeer's drawer in this dashboard gains a "Contribution (last quarter)" block: goal compliance, tracked/planned coverage, kudos, RCR where applicable — read from the PS Contribution data. Reviewers see comp *and* contribution on one card during QTA.
2. **Add a "possible invisible contributor" flag** — deliberately a *verification trigger in the Check K spirit*, not a category: fires when the PS contribution score is high (e.g. top quartile of their team) **and** the comp-visible inputs are weak or missing (SI < 4, or unrated, or RCR below 2.5 for Delivery). Audit action: manager confirms what the work was and whether it maps to a GTT-35 pillar. Proposed as **"Check L — Invisible Contributor"** for the Guiding Principles page.
3. **Optionally, a fourth Priority Score component (later).** Only after GTT-35 standardizes contribution points/tiers should contribution enter the score itself — weighting an unstandardized signal would recreate the RCR problem with a different metric. Sequence: evidence block (2026.W32) → Check L pilot in the next QTA → scoring integration only post-GTT-35.
4. **Kudos deserve a caveat wherever shown**: the Contribution Satellites document a declining kudos trend (2 given in W25 company-wide) — low kudos currently signals program under-use, not low contribution. Rendering it as evidence without that caveat would penalize exactly the invisible people this is meant to protect.

### 7.4 Open questions for this review

1. Who owns the "invisible contributor" verification in the cycle — the manager, WFP, or both (as with Check K's HR follow-up)?
2. Should the flag threshold use the PS contribution score (available now, team-aligned) or wait for GTT-35 contribution points (standardized, not yet defined)?
3. Non-delivery RCR: Check A has no revenue axis at all — is that the intended design, or should Operational Excellence (GTT-35 pillar) provide the equivalent once quantified?
4. Data plumbing: read the PS contribution score live (cross-app call) or via a published snapshot sheet per quarter (simpler, auditable, cycle-frozen)? Recommendation: **snapshot sheet, frozen at cycle open** — QTA evidence shouldn't move mid-review.

---

## 8. Operational notes

- **Cache**: single payload `cd_v<CD_CACHE_VER>_all`, gzip-chunked, 65-min TTL; `bustCompCache_()` bumps the version — required after every deploy.
- **Deploy**: paste `Code.js` + `ViewDash.html` + `Security.js`, run `bustCompCache_()`, publish a **new deployment version** (updating files without a new version keeps serving old code).
- **Access**: email allowlists (admin/viewer) in `Security.js` + Script Properties; role echoed per request, never cached.

*Sources: CompDash code (this repo); HowTo — Compensation Audit Guiding Principles (WFP, v7); GTT-35 The 360° Contribution Framework; Contribution — Definitions (ABCT); Contribution Satellites W17–W25; WFP FY27 Process Improvement Roadmap.*

---

## V3 deploy (2026-07-27 — exec feedback absorption)

Spec: `docs/superpowers/specs/2026-07-27-compdash-v3-exec-feedback-design.md`
Plan: `docs/superpowers/plans/2026-07-27-compdash-v3-exec-feedback.md`

1. Paste `Code.js` + `ViewDash.html` into the GAS project (Security.js unchanged).
2. Run `debugCompPipeline()` — confirm the new log lines: Supervisor column FOUND,
   Managers rows, Financial impact coverage, Forecast status.
3. Run `bustCompCache_()` — **required** (payload adds managers/verdicts/forecast/
   financialImpact/previousFYSamePeriod + meta.ragCfg/glossary/benchmarks).
4. Publish a **new deployment version** (file save alone keeps serving old code).
5. Optional: set `CD_RAG_CFG` Script Property (JSON) to override any threshold, e.g.
   `{"peerVolBand":{"low":0.10,"high":0.16},"spanTarget":7}`.
6. Grant Rob/Forest viewer access via 🔒 Access Control when ready.

V3 behaviors to spot-check live: exec strip paragraph on Overview; 👤 Managers tab
(worst-first, pooled small-teams row, span line); Attrition dashed forecast + shaded
peer band (Month view, no filters); financial line under the chart; RAG dots on the
Breakdown rate column; Data Reference glossary + threshold table with sources.
Known degradations by design: no Supervisor values → Managers tab notice; <6 actual
FY months → no forecast; missing TCC USD rows → financial coverage note.

---

## V4 deploy (2026-07-28 / 2026.W31 — comp decision-maker upgrade)

Spec: `docs/superpowers/specs/2026-07-28-compdash-v4-decision-maker-design.md`

**What V4 adds** — 🚨 Risk Signals view (promotion staleness ≥3y with early-career
lens, recognition risk = top quarter + <5% TTM growth, I3–I4 retention cohort with
factor chips, 👻 invisible contributors per Check L); SI evidence window = last 4
COMPLETED quarters (Priority Score consumes it); restricted profiles (CEO/chiefs/
VPs/directors, M9+) stripped server-side for anyone off the exec-view list;
part-time/EOR population rules (EOR = regular; part-time/intern never anchor,
never scored, muted PT chips); ☀️/🌙 light-dark theme toggle on COMPANY_COLORS;
Data Reference rebuilt as sectioned cards + accordion. §7's dilemma is resolved
by the **Contribution Snapshot** join (frozen quarterly evidence, §7.4's
recommendation) — evidence block in the drawer, verification flag on Risk Signals.

1. Paste `Code.js` + `ViewDash.html` + `Security.js` into the CompDash GAS project.
2. Paste `Contribution Snapshot Export.js` into the **PS Contribution Report**
   project; run `exportContributionSnapshot()` once as the owner at QTA cycle open
   (or install `setupSnapshotTrigger()`). Until the first export the CompDash tab
   reads "pending" — by design.
3. Run `debugCompPipeline()` — new log lines: Employment type column, Restricted
   profiles count, SI window quarters, Signals counts, Contribution snapshot join.
4. Run `bustCompCache_()` — **required** (payload adds signals/contrib/restricted/
   employmentType + meta.signalsCfg/contribution/restricted).
5. Publish a **new deployment version**.
6. Optional Script Properties: `CD_SIGNALS_CFG` (JSON numeric overrides, e.g.
   `{"promoStaleYears":2.5,"recogMaxTtm":0.04}`), `CD_RESTRICTED_EXTRA` (comma
   emp numbers), `CD_CONTRIB_SNAP_SS_ID` / `CD_CONTRIB_SNAP_TAB`.
7. Exec-view grants: 🔒 Access Control → third textarea (or `CD_DASH_EXECVIEW`).
   Admins always see restricted profiles; every other viewer gets them stripped
   server-side with a "N leadership profiles not shown" subtitle note.

V4 spot-checks: 🚨 tab renders all four cards; exec strip shows retention/recognition
chips; a viewer NOT on exec-view sees no CEO row anywhere (ranking, compa groups,
QTA, attrition detail, drill); part-timer shows PT chip and no red band; ☀️ toggle
persists across reload; Data Reference nav chips scroll to sections.
Tests: `node tests/run_tests.js` (240) + the render smoke harness
(`node tests/render_smoke.js` — executes every renderer against a synthetic
payload with a stub DOM; now checked in, no longer scratchpad-only).

## Overview V5 — decision-surface rework (2026.W31)

The Overview tab was split from "reporting surface with action verbs" into
facts + a real work queue:

- **Facts card** — max 3 clickable past-tense sentences (leads with voluntary
  vs peer band), fy-caveat surfaced, plus a per-browser "changed since
  2026.WNN" strip (localStorage `cd_ov_snap`, baseline rolls per ISO week).
- **🎯 Action queue** — every verdict with an `action` becomes a row: severity
  glyph, deep link, evidence sub-line, owner input, deterministic due week
  (RISK → asOf+2 ISO weeks; else fiscal-quarter close, always `2026.WNN · dates`),
  and per-viewer open/acked/snoozed/done state with a "by whom, when" stamp.
  Persistence: `getOverviewActions` / `saveOverviewAction` in Code.js →
  **UserProperties** (`CD_OVERVIEW_ACTIONS_V1`). Per-viewer BY DESIGN; a shared
  WFP/REX/Finance queue would need a sheet-backed store (backlog).
- **Small-denominator rule** — n < 10 → count is primary, rate is caption, no
  trend arrows. Attrition KPI compares YTD vs `previousFYSamePeriod`, never
  partial-vs-full year.
- **KPI cards** — one question each, target-band strip + marker + one-line
  verdict; zero states recede (`✓ 0`, dimmed); Contribution card shows the
  snapshot matched count (link-line fallback until the first export).
- **Terminations chart** — grouped month BARS (current FY solid Orbe `--cta`,
  prior FY outlined ghost, counts labeled, explicit zero ticks). The yellow
  spark line is gone; `svgSpark` removed.
- **Provenance footer** — as-of + ISO week, payload timestamp, cache state,
  per-source status, exclusion-rules tooltip.
- **A11y** — `ragDot` now emits shape glyphs (✓ / ! / ✕) so RAG never encodes
  by color alone; SVG label floor raised to 12px.
- **Manager framing** — `mgr-hotspots` verdict reworded to "teams where the
  manager may need support"; identities stay in the Managers view, never at
  exec level (Develops Rocketeers / Empower Others framing).

**Deploy:** paste `Code.js` + `ViewDash.html`. Run `bustCompCache_()` —
**required** (verdict wording is baked into the cached payload). New deployment
version required (new server RPCs `getOverviewActions`/`saveOverviewAction`).

**Spot-checks:** facts card shows ≤3 sentences and no chips row; queue rows
persist state across reload (per user); attrition KPI reads "N exits" while
FY exits < 10; termination bars show ghost + labels; provenance line renders;
snooze resurfaces the row the following ISO week.

**Known limits:** per-card "delta vs prior quarter" isn't in the payload — the
changed-since strip covers movement (per browser) until a server-side snapshot
of prior-quarter medians exists. Views deep-link internally via `switchTab` +
`setFilter`; there are no URL-level filter params.

## V5.1 — Overview simplification + tab restructure (2026.W31)

Two structural moves, superseding parts of V3/V5 above:

- **Overview is read-only again.** The interactive 🎯 Action queue is gone from
  Overview; in its place a **🚦 Signals** card renders the server verdicts as
  the original judgment groups — ⚠️ Concerns (RISK) / 📝 Notes (NOTE) /
  ✨ Highlights (FACT) — each row deep-linking to its view. Facts card, KPI
  band cards, termination bars and provenance are unchanged.
- **📌 Action Queue is now its own ADMIN-ONLY tab** (second in the tab bar).
  Same rows, owners, due ISO weeks and per-viewer open/acked/snoozed/done state
  as before. Enforcement is layered: viewers never get the tab (`VIEWS` roles),
  `switchTab` bounces a forced id to Overview, and **`getOverviewActions` /
  `saveOverviewAction` now throw for non-admins server-side** — viewers no
  longer even fetch queue state on load.
- **👤 Managers tab retired — Attrition owns it.** The full manager league
  table outgrew a tab of its own; the decision question is "which teams are
  outliers". A **Manager hotspots** card at the bottom of 📉 Attrition lists
  only teams above the attrition yellow line (same rule as the `mgr-hotspots`
  verdict, pooled small-teams row included when it qualifies); everyone else
  is a count ("N teams within threshold not listed"), plus the span-of-control
  line. The `mgr-hotspots` and `span` verdicts moved `view: "managers"` →
  `"attrition"` so their deep links land correctly.

**Deploy:** paste `Code.js` + `ViewDash.html`. Run `bustCompCache_()` —
**required** (verdict `view` targets and wording are baked into the cached
payload; a stale payload would deep-link to the retired managers tab).
Publish a **new deployment version** (server RPC behavior changed).

**Spot-checks:** as a viewer — no 📌 tab, no Action queue anywhere, Overview
shows the Signals card, Attrition ends with Manager hotspots showing outliers
only; as an admin — 📌 tab holds the queue with saved state intact (states
carry over: same UserProperties key); clicking the mgr-hotspots signal on
Overview lands on Attrition.
Tests: `node tests/run_tests.js` (241) + `node tests/render_smoke.js`.
