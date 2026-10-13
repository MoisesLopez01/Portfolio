# Contributor Intelligence — org-scoped export on the New RCR axis

**Date:** 2026-10-13 (2026.W42) · **Status:** implemented, not deployed ·
**Tests:** `tests/contribution-org-scope-checks.js` · **File:** `Contribution.js`,
`Contribution Org Picker.html`

## Why

`Contribution.js` is the sheet exporter behind the 🚀 Contributor Intelligence menu
of the Contribution Dataset spreadsheet. Two things had drifted from the PS Dashboard:

1. **It only ran company-wide.** A director who asked for their org's view got the
   whole company, including their peers and their own evaluation.
2. **RCR was FY26-bound.** The month columns were a hard-coded `Jul 25 … Jun 26`
   list and the tier came from the `3. RCR` YTD. From July 2026 RCR is published as
   a direct per-person rate in the `New RCR` tab (`2026.07 RCR` columns), which the
   dashboard already reads on one merged month axis (spec
   `2026-10-13-new-rcr-direct-rate-design.md`). The export did not see it at all.

## Design

### One RCR axis, two tabs — `readRcrAxis_`

Mirrors `readRCR_PS_`. Reuses `rcrMonthColumns_` / `rcrMonthFromHeader_` from
`PS Contribution Report.js` (same project), so both spellings land on the same
`"Mon YY"` labels and sort chronologically.

| Tab | Join | Month value | Group value for that month |
|---|---|---|---|
| `3. RCR` (FY26-) | Employee ID = Roster Internal ID; rows with a Termination Date skipped | ratio | SUM(RC)/SUM(TCC) over the group's IDs, mean as the documented fallback |
| `New RCR` (FY27+) | Internal ID (commas stripped), name fallback | rate | mean of the tracking-mandated, non-ramp-up, non-leave FTE members with a value |

Rules carried over from the dashboard: a month in both tabs resolves to the **rate**;
a month column with no numeric value for any roster member is **skipped**; an ID or
name that is not on the roster is **dropped**.

Per person: `monthlyRCR` is the merged series; `rcrCurrent` is their value for the
axis's latest month (null if they have none — the dashboard's `byEmployee`
behaviour). Tier, bucket order, Satellite risk and the signal counts now read
`rcrCurrent`. Thresholds moved to the dashboard's **1.0 / 1.5 / 2.5**. The legacy
YTD column stays as `FY26 YTD RCR` (`CONFIG.LEGACY_YTD_LABEL`) and is informational.

The population flags come from the dashboard's own roster reader
(`joinDashboardFlags_` → `readPSRoster_`, `tracksTime_`, `isPeopleManager_`); when
that read fails, everyone counts, which is the same fail-open direction `tracksTime_`
takes.

### Org scope — `resolveOrgScope_`

BFS over the employee map's `supervisor` field from the leader, **through inactive
rows** (the map holds every roster row; the active filter is applied afterwards), so a
terminated mid-level manager whose reports are not re-parented yet does not sever the
tree — the same reason `resolveManagerScope_` carries bridges. The leader's own row
seeds the walk and is never added to the scope. Aliases in `NAME_MAPS` resolve; the
match is case- and whitespace-insensitive.

### Output

| Run | Tabs | Empty segment |
|---|---|---|
| Company | the three configured names | written with "No employees to display." |
| Org | `"<tab> · <Leader>"` (100-char cap) | **not written**; a stale same-named tab from an earlier run is deleted |

Org banners gain a third line: org size, the explicit "leader's own record is
excluded" note, and the group RCR with its method and `n`. The Contributor table
gains an **RCR Tier** badge column after the three trend months.

### Entry points and gating

| Function | Reachable from | Gate |
|---|---|---|
| `runContributorIntelligence()` | menu, editor | `requireMaintainer_` |
| `runContributorIntelligenceForOrg(leader)` | the picker dialog via `google.script.run` | `requireMaintainer_`; throws on an unknown leader or an empty org |
| `listOrgReportCandidates()` | the picker dialog | `requireMaintainer_` |
| `showOrgPicker_()` | menu › *Run for an org…* | private (menu only) |

`tests/callable-surface-checks.js` sweeps `Contribution.js` too, so a new ungated
public function fails the build.

## Not done here

- No clasp push / deploy. `Contribution Org Picker.html` is appended to
  `filePushOrder`; it has no load-time dependencies.
- The picker lists every active roster supervisor. It does not consult the
  dashboard's access lists — whoever can run the export (an admin) can run it for
  any org, which matches the company-wide run's behaviour.
