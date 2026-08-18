# PS Dashboard — Non-Tracking Families Carve-Out

**Date:** 2026-08-02 (2026.W32)
**Status:** Approved — implementing
**Files:** `PS Contribution Report.js`, `PS Dashboard.html`
**Related:** `delivery-health-dashboard/Code.js` (source of the patterns),
`ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md`

---

## 1. Problem

JF018 (Solution Architecture) asked not to be counted as part of the team that
tracks time — they do not track at all, or only some of them do. The same is true
of JF008 (Training & Customer Education), JF015 (Operations) and JF017
(Information Technology), and of the operational families embedded in the Services
team (Finance, People, …).

Today those people sit in the Services roster and therefore:

- drag every team-level tracked/planned aggregate down (they are in both the
  numerator and the denominator),
- show 0h week cells that read as failure next to teammates who are mandated to track,
- and — for JF008 and JF018, which are `PS_TEAM_FAMILIES_` natives — are **scored**
  on tracked (30) and planned (20) weight they were never meant to carry.

They belong to the Services team and must stay visible. They simply must not
impact time metrics, even when some of them do plan and track.

A second, independent gap: the roster reader drops maternity/paternity rows
entirely, while "parental leave" and "sabbatical" statuses are not matched at all —
so those people stay in and drag the same metrics for an absence, not a performance
problem.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Full carve-out** — non-tracking people leave both numerator and denominator of every team tracked/planned aggregate and compliance %. Their own hours stay visible on their row, informational only. |
| D2 | **Allowlist semantics** — the mandate is defined as JF007 + JF009. An unresolvable family (uncatalogued, blank, malformed title) and crew are tracking-**required**, so nobody escapes the mandate through a bad job title. |
| D3 | **Scoring = embedded-ops policy** — JF008/JF018 blank matrix cells inherit `RND_DEFAULT_W_` (Goals 40 / Kudos 20 / SI 20 / PTO 20), like JF015/JF017 already do. Tracked/planned are additionally **hard-masked to 0** for every non-tracking person, so a hand-edited sheet row can never re-enable them. |
| D4 | **Muted hours + badge** — week cells keep showing logged hours in a muted style; the name cell carries a `⏱ Exempt` pill. |
| D5 | **Long-leave exclusion** — maternity/paternity/parental/sabbatical/leave-of-absence stay on the roster with a `🏖 On Leave` pill, and are excluded from every metric population. |
| D6 | **Planned ≤ capacity clamp** — per-person weekly planned is clamped to the PTO-adjusted 40h target before it enters any total. Silent, no flag (Tempo per-project plan duplication is systemic). |

### 2.1 Scope consequence, called out deliberately

D2 + D3 mean **JF004 (Sales and Success) members whose Class is "Professional
Services"** are also non-tracking: excluded from Services time aggregates, and their
tracked/planned scoring weight masked to 0. This was not named in the original
request but follows directly from the allowlist. The alternative — excluded from the
team's time metrics yet still scored on them — would be a defect. JF004 members
outside the PS Class already resolve to the `sales` team, where
`maskToTeamMetrics_` zeroes tracked/planned anyway, so this only affects
JF004-in-Services.

### 2.2 Non-goals

- Goals, Kudos, RCR, SI, PTO populations are **unchanged** for non-tracking people.
  They compete on those metrics exactly as today.
  **Superseded for RCR on 2026-08-05 — see §10.**
- No change to what "headcount" means. See §4.3.

## 3. Data model — two new roster flags

Both flags live on the roster profile, so every downstream consumer sees the same
value, and both are shipped on the employee object for the client.

### 3.1 `tracksTime` (boolean, default `true`)

```js
const TRACKING_FAMILIES_ = ["JF007", "JF009"];   // tracking MANDATED (allowlist)
```

`tracksTime_(profile, catalog)` in `PS Contribution Report.js`:

1. Crew → `true` (a Tempo schedule implies the expectation — demand-dashboard parity).
2. Resolve family: `catalog.get(normTitleKey_(jobTitle))` → `titleCodeInfo_(jobTitle)`.
3. No family resolved → `true` (fail-safe: an unmapped title never grants exemption).
4. Family in `TRACKING_FAMILIES_` → `true`; otherwise → `false`.

Assigned in `getPSReportData` next to the existing team tagging (~:3531), which
already has `jobCatalog` in hand:

```js
fullRoster.forEach(p => {
  p.team       = teamForProfile_(p, jobCatalog);
  p.tracksTime = tracksTime_(p, jobCatalog);
});
```

### 3.2 `onLeave` (boolean, default `false`)

In `readRosterTab_`:

- `LONG_LEAVE_RE_ = /maternity|paternity|parental|sabbatical|leave of absence/i`
  tested against `Employee Status`.
- `maternity|paternity` are **removed** from the inactive-drop regex (:1643).
  Terminations, resignations, offboarding still drop.
- Crew rows carry no status signal → `onLeave` always `false` for them, matching the
  existing `!isCrewTab` guard.
- Missing `Employee Status` column → `onLeave` false everywhere (the existing ⚠️ log
  already fires).

## 4. Backend changes (`PS Contribution Report.js`)

### 4.1 Time population

`computePSReport_` gains one subset next to `fteActive` / `fteRoster`:

```js
const timeRoster = new Map([...fteRoster].filter(([, p]) => p.tracksTime !== false && !p.onLeave));
```

Used for:

- `filterTimeBySubset_(trackedAll,   timeRoster)` (was `fteRoster`)
- `filterTimeBySubset_(plannedAdjAll, timeRoster)` (was `fteRoster`)

which carries the carve into `buildTeamSummary_`'s planned/tracked rows,
`trackedHistory`, and `meta.trackedCurWeek` / `trackedHCCurWeek` from one place.

`buildSegmentation_` skips `tracksTime === false` / `onLeave` profiles for its
`trackedHrs` / `plannedHrs` sums only — the PTO/kudos/goals counters in the same
loop are untouched.

### 4.2 Other populations

`activeRoster_` additionally filters `onLeave`, so Goals/Kudos/RCR/SI aggregates and
`fteActive` exclude people on long leave — the same treatment ramp-ups get. Non-tracking
people are **not** filtered here.

### 4.3 Denominators — deliberately unchanged

`headcount`, `meta.totalHeadcount`, `meta.activeCount` and the `fte` denominator
behind the goals-comment percentages keep today's meaning, so no existing headline
number moves for a reason unrelated to this change:

- `fte` (comment %) = `fteRoster.size` minus on-leave. On-leave people were
  previously absent from the roster entirely, so this restores the prior value exactly.
- `headcount` = `fteRoster.size` minus on-leave, for the same reason.
- **New:** `meta.timeHeadcount = timeRoster.size` — the denominator for
  `trackedPct` / `plannedPct` in `trackedHistory` and for the client's KPI targets.

### 4.4 Planned ≤ capacity clamp

In `subtractPTOFromPlanned_`, after the PTO subtraction:

```js
const capHrs = Math.max(CONFIG_PS.PTO_MIN_TARGET_HRS,
                        CONFIG_PS.SCORE_PLANNED_CAP_HRS - ptoHrs);
const netHrs = Math.min(Math.max(0, hrs - ptoHrs), capHrs);
```

`totalHrs` / `headcount` are already derived from the clamped per-person values in
that same loop, so totals, per-person cells and score norms stay consistent.
`byEmployeeProjects` is left raw on purpose: it is the Tempo per-project breakdown,
which is exactly where the duplication is visible.

### 4.5 Scoring

- `blockFillBase_`: the Services branch tests `TRACKING_FAMILIES_` instead of
  `PS_TEAM_FAMILIES_`, so JF008/JF018 blank cells now inherit `RND_DEFAULT_W_`
  alongside JF015/JF017. `PS_TEAM_FAMILIES_` stays as-is for its other three call
  sites (legacy-matrix mapping and the audit gate).
- `weightsForEmployee_`: after `maskToTeamMetrics_`, a non-tracking employee
  (`emp.tracksTime === false`) has `tracked` and `planned` masked to 0 — the hard
  guarantee of D3. The existing base-reference optimisation is preserved: the mask
  returns the input object untouched when nothing needs zeroing.
- The unmapped-title audit narrows to `TRACKING_FAMILIES_`, so missing JF008/JF018
  matrix cells stop being flagged as misses.
- `buildTopPerformers_` excludes `onLeave` alongside the existing ramp-up filter.

### 4.6 Payload additions

On each employee object in `buildEmployeeRows_`: `tracksTime` (boolean),
`onLeave` (boolean). Plus `meta.timeHeadcount`. Payload shape change →
**`PS_CACHE_VER` bump required**.

## 5. Frontend changes (`PS Dashboard.html`)

### 5.1 One shared predicate

```js
function tracksTime_(e)  { return e.tracksTime !== false; }
function timeEligible_(e){ return e.tracksTime !== false && !e.onLeave; }
```

Every client-side tracked/planned aggregation filters through `timeEligible_`:

| Surface | Function |
|---|---|
| Overview KPI tiles | `getWeekStats` (tracked/planned counters only), `renderKPIs` denominator `hcDenomTempo` |
| Overview team table | `buildFilteredSummary` — `planned` and `tracked` rows |
| Filtered meta | `buildFilteredMeta` — `trackedCurWeek` |
| Team Radar | `computeGroupMetrics` — `avgTracked`, `trackedCompliancePct`, `avgPlanned`, `plannedCompliancePct` |
| Trends | `renderPlannedVsTracked`, `computeActivityPct_` |
| Exec Brief | `buildTeamBriefHTML` tracked / planned / silent-regression blocks |
| Period views | `computePeriodStats_` |

Goals/Kudos/PTO/RCR/SI counters in those same functions are **not** filtered by
`tracksTime` (they are filtered by `onLeave`, matching the server).

### 5.2 Per-person rendering (`renderEmployeeTable`)

- Name cell: `⏱ Exempt` pill (Ramp-Up pill pattern, `.gpill` family) with tooltip
  *"Services team member — not held to time planning or tracking. Hours shown are
  informational only and do not affect team metrics."*
  `🏖 On Leave` pill for `onLeave`.
- Week cells for non-tracking people: hour values get `.wc-info` (muted, ~55%
  opacity, `--muted` colour) in both light and dark mode. Values still render.
- `buildActionPrompt_`: the `<20h` low-tracking warning is suppressed when
  `!timeEligible_(e)`.

### 5.3 Naming the two headcounts (added after first review)

Carving the population is only half the job: every surface that shows a headcount
next to a tracked/planned number has to say **which** headcount it means, or the two
denominators read as an inconsistency. One helper produces the phrasing everywhere —
`timeScopeNote_(list, sep)` returns `"4 ⏱ Exempt · 1 🏖 On Leave outside
Tracked/Planned"`, or `""` when the populations are identical, so nothing is said
when there is nothing to explain.

| Surface | Treatment |
|---|---|
| Overview KPI tiles | Denominator already carved (`hcDenomTempo`). Tiles read "—" when it is 0. `.kpi-team-note` appends `timeScopeNote_`. |
| Radar subtitle | `#radarMainSubtitle` appends `timeScopeNote_`. |
| Radar table | HC column shows `12 · 9⏱` when the mandated subset differs, with a tooltip; header tooltip explains the pairing. `computeGroupMetrics` returns `timeHeadcount` / `exemptCount` / `onLeaveCount`. |
| Radar action cards | `RADAR_ACTION_COPY` now takes `(score, metrics)` and reports each axis's **own** numerator/denominator (`trackedEligible − trackedCompliant`) instead of estimating `headcount × (1 − score)`. The axes no longer share a population, so the estimate would have named people the axis never measured. |
| Exec Brief header | Adds `N with a tracking mandate` beside the rocketeer count, tooltipped. Carried into the Confluence copy text. |
| Exec Brief body | A **Population** fact states the split in prose and notes that exempt rocketeers still count in Goals/Kudos/SI/PTO. Reads `meta.exemptCount` / `meta.onLeaveCount`. |
| Exec rollup strip | Per-team HC becomes `N / M⏱` — the trajectory arrow blends goals (whole team) with tracked hours (mandated subset). |
| Leading Behaviours | Subtitle moved after `scored` so it can state the ranked population, and names how many ⏱ Exempt rocketeers are scored without tracked/planned weight. |
| Trends · Planned vs Tracked | `#pvtWeek` now reports `timeFiltered.length`, matching the population the chart actually sums (it previously printed the raw filter count). `#pvtSub` appends `timeScopeNote_`. |
| Trends · Correlation | `chartDenom` (which converts the activity line's % back into "N ppl") switches to the mandated population, matching both `trackedPct` server-side and `computeActivityPct_` client-side. Subtitle states that the activity line is mandate-scoped while the documentation line covers the whole team. |

`buildFilteredMeta` gained `exemptCount` / `onLeaveCount` / `timeHeadcount` so every
one of these works identically under an active filter.

### 5.4 Data Reference

New "Time-tracking mandate" row: JF007 Managed Services & Support and JF009 Service
Delivery are mandated; JF008 / JF015 / JF017 / JF018 and the embedded operational
families belong to Services but never impact time metrics, even when they plan and
track; an unrecognised job title defaults to mandated.

## 6. Error handling

| Condition | Behaviour |
|---|---|
| Job Catalog sheet missing/empty | Every family unresolvable → everyone `tracksTime: true`. Fail-safe: today's behaviour, nobody silently exempted. |
| `Employee Status` column missing | `onLeave` false everywhere; existing ⚠️ log fires. |
| Malformed / prefix-less job title | `tracksTime: true` (D2). |
| Old cached payload without the new fields | `e.tracksTime !== false` and `!e.onLeave` both evaluate as tracking-eligible → renders exactly as today. Cache bump makes this transient. |
| Whole team non-tracking (filtered view) | `timeHeadcount` 0 → tracked/planned tiles show "—" rather than dividing by zero. |

## 7. Testing

- `_test_weightsResolver()` — extend: JF008/JF018 blank cell → `RND_DEFAULT_W_`;
  a sheet cell with `tracked: 30` on a non-tracking employee still resolves to 0.
- New `_test_nonTrackingFlags()` — allowlist default for unmapped title, crew →
  tracking-required, JF007/JF009 → true, JF008/JF015/JF017/JF018 → false,
  leave regex vs. inactive-drop regex, planned clamp at 40 and at a PTO-reduced target.
- Both runnable in the GAS editor and in Node (eval the PS files with a stubbed `Logger`).

## 8. Future direction — sheet-driven mandate (not built)

The mandate is a code constant today. The natural next step is to make it
admin-editable at (team, family, level) granularity, layered the same way access
control is: code default → sheet policy → per-record override.

1. **`TRACKING_FAMILIES_` (code)** — stays as the fallback, never removed. Survives a
   sheet reset and keeps the fail-safe: unresolvable family → tracking-required.
2. **`PS Scoring Matrix` `tracks` row** — the sheet's `Metric` column is already a row
   dimension over `Team | Family | Metric | I1–M10 | ALL`, so a non-weight metric
   named `tracks` holding 1/0 per level cell fits the existing schema with no
   migration. This is the layer that answers "JF018 I-track ICs are exempt but the
   M-track managers are not" without a deploy.
3. **Roster `Tracks Time` column** — per-person override, mirroring how
   `CONFIG_PS.RAMP_UP_FLAG_COL` already overrides the computed ramp-up flag. Covers
   "just some of them" when the split is per-person rather than per-role.

Resolution order: level cell → family `ALL` cell → roster override → code constant.
Most specific wins; blanks fall through. A blank sheet reproduces today's behaviour
exactly.

Implementation notes: `readScoringMatrix_` (:587) and `saveScoringMatrix` (:898) both
filter rows against `WEIGHT_METRICS_`, so `tracks` must be recognised in both while
staying out of the weight arithmetic (`fillWeights_`, `maskToTeamMetrics_`, and the
`availW` sum in `buildTopPerformers_` / `computeRkScore`). The hard mask in
`weightsForEmployee_` then reads the resolved mandate instead of re-deriving it from
the family.

**Explicitly rejected: inferring the mandate from `tracked`/`planned` weights being 0.**
It looks free, but it conflates two different questions — how much tracking counts
toward a score, versus whether tracking is expected at all. Dropping `tracked` to 0 in
the flat base weights (a legitimate scoring choice, e.g. moving to outcome-based
scoring) would silently exempt the entire team and empty the Time tracked / Time
planned tiles company-wide. It is also circular: `weightsForEmployee_` consumes the
mandate to decide the weights.

## 9. Deployment

1. Deploy `PS Contribution Report.js` + `PS Dashboard.html`.
2. **Bump `PS_CACHE_VER`** in Script Properties (payload shape changed).
3. Re-run `warmReportCache()` or wait for the 30-min warmer.
4. QA: confirm Services tracked/planned averages rise, the exempt population is
   badged and muted, on-leave people appear badged, and Top Rocketeers no longer
   penalises JF008/JF018.

## 10. Addendum 2026-08-05 — RCR joins the carve-out

§2.2 originally kept RCR unchanged for non-tracking people. In practice the same
families bill sporadically — some JF008/JF015/JF017/JF018 members show an RCR
month occasionally, JF018 has roughly half its members planning hours without
tracking — so their intermittent months dragged the team ratio for work they were
never expected to bill. The mandate now covers RCR with the same D1/D2/D4
semantics: full carve from every team aggregate, individual values stay visible
as informational.

Server (`PS Contribution Report.js`):

- `readRCR_PS_`'s team-aggregation subset is now `rcrActive` = `fteActive` minus
  `tracksTime === false` — scopes `teamRCR` (SUM RC/TCC), the fallback average,
  and every `rcrHistory` month. `byEmployee` / `rcrByEmployee` still cover all
  active rocketeers, so rows and detail views keep individual values.
- `weightsForEmployee_` hard mask extended: a non-tracking employee's `rcr`
  weight is zeroed alongside `tracked`/`planned` (a hand-edited matrix row can
  never re-enable it). Tests `tracksTime-flag-overrides-family` and
  `jf004-in-services-base-minus-hours` updated to expect `rcr: 0`.
- Pulse-table RCR tooltip names the mandated-families scope.

Client (`PS Dashboard.html`) — every RCR average filters through `tracksTime_`:
`buildFilteredMeta`, `buildFilteredSummary` (Pulse table), `computeGroupMetrics`
+ `computeGroupMetricsPeriod` (Radar), `computeFilteredRCRHistory` + the legacy
fallback (Trends chart), and `renderRcrSupport` (exempt people appear neither in
"needs support" nor "top contributors"). `buildActionPrompt_`'s low-RCR warning
is suppressed for exempt rocketeers. Copy updated: KPI tile sub/tooltip,
`timeScopeNote_` ("outside Tracked/Planned/RCR"), ⏱ Exempt pill tooltip, Exec
Brief Population fact, period-brief RCR fact, Leading Behaviours subtitle,
Data Reference mandate note, filtered-view notes.

Deployment is unchanged from §9 (both files + `PS_CACHE_VER` bump — the cached
`rcrTeamRCR`/`rcrHistory` values change even though the payload shape does not).
