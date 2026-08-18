# Org Team Toggle — Services / R&D / Sales & Success

**Date:** 2026-07-08 (2026.W28)
**Status:** Approved design, pending implementation plan
**Files touched:** `PS Contribution Report.js`, `PS Dashboard.html`, new `PS Teams.js`

## Summary

Extend the PS Contribution Dashboard from a Services-only view to three org teams
selectable via a single toggle: **Services** (today's population, unchanged),
**R&D** (everyone outside the Services department and outside JF004), and
**Sales & Success** (Job Catalog family JF004). R&D and Sales & Success score on the
four metrics they have records for — SI, Goals, PTO, Kudos — with the pipeline
parameterized by a per-team metric set so future metrics (e.g. HubSpot deal data for
Sales) attach cleanly later.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Team membership rule | **Revised 2026-07-09 (live data):** Class-driven — roster Class "Professional Services" → `services`; Class "Corporate" / "To be Allocated" → JF004 catalog hit → `sales`, else → `rnd`; unknown Class values dropped at the roster read with a ⚠️ log. (Original Department-based hybrid abandoned: the live roster's Department column is "Services"-only for PS and blank/irrelevant elsewhere — Class is the company-wide axis.) |
| Roster coverage | Roster sheet is company-wide with a single shared Class value — only the Department filter widens |
| Metric source coverage | SI, Goals, Kudos, and PTO Accumulation sheets all contain rows for every department already |
| Sales & Success phasing | Ships now with the four shared metrics; HubSpot metrics (meetings, deal size, conversion, turn rate) are a later phase |
| Toggle access | All roles, scope-aware: admins/viewers toggle freely; managers see only teams present in their org tree |
| R&D / Sales scoring | Reuse `NONCONTRIB_DEFAULT_W_` (Goals 40 / Kudos 20 / SI 20 / PTO 20); rankings computed within each team; family × level matrix overrides still apply **Superseded 2026-07-09** by the team-aligned scoring spec (per-team blocks + hard metric mask). |
| Architecture | Per-team payloads fetched on toggle (Approach A) — not one combined payload, not separate deployments |

## Architecture

### New code tab: `PS Teams.js`

Single source of truth for teams, mirroring the `VIEWS` pattern in the frontend:

```js
const TEAMS_ = [
  { key: "services", label: "Services",
    metrics: ["rcr", "si", "goals", "tracked", "planned", "kudos", "pto"] },
  { key: "rnd",      label: "R&D",
    metrics: ["si", "goals", "kudos", "pto"] },
  { key: "sales",    label: "Sales & Success",
    metrics: ["si", "goals", "kudos", "pto"] },  // HubSpot metrics appended in a later phase
];
```

Functions:

- `teamForProfile_(profile, catalog)` — the membership rule (**revised 2026-07-09**,
  Class-driven). Class = `CONFIG_PS.PS_CLASS` ("Professional Services", case-insensitive)
  → `services`, so a JF004 title inside the PS class stays in the Services team and
  today's population is byte-identical. Any other known Class (`TEAM_KNOWN_CLASSES_`:
  Corporate, To be Allocated) → Job Catalog family JF004 → `sales`, else `rnd`.
  Rows with an unknown/blank Class are dropped at the roster read with a ⚠️ log naming
  the value. **JF004 detection requires the Sales & Success job titles to exist in the
  Job Catalog sheet with code JF004** — uncatalogued sales titles land in `rnd`.
  Scoring mirrors membership: `weightsForEmployee_` routes uncatalogued employees by the
  resolved `emp.team` (non-services → NONCONTRIB policy defaults, never the flat base;
  dept comparison retained only as a legacy fallback), while Services-team uncatalogued
  titles keep the SERVICES/ALL catch-all.
- `teamByKey_(key)` — registry lookup; unknown key returns the `services` entry.
- `teamRoster_(fullRoster, teamKey)` — filters the roster Map to one team.
- `teamHasMetric_(team, key)` — backend twin of the frontend `hasMetric_` gate.

### Roster widening (`readPSRoster_`)

- Drop the `Department === CONFIG_PS.PS_DEPT` row filter. Keep the Class filter,
  inactive-status regex, and termination-date exclusion exactly as they are.
- `readPSRoster_` itself stays catalog-free. Team tagging
  (`profile.team = teamForProfile_(profile, catalog)`) happens in
  `getPSReportData` right after the roster read, where the Job Catalog is loaded —
  the catalog is required to identify JF004.
- Ramp-up logic (hire date + `Ramp-Up` flag) and crew detection apply unchanged to
  all teams.

### Data flow (`getPSReportData` / `computePSReport_`)

- Signature: `getPSReportData(bustCache, teamKey)`. `teamKey` is validated against
  `TEAMS_`; missing/unknown falls back to `"services"`, so existing callers and the
  cache warmer keep working unmodified.
- Scope resolution order: **manager org-tree scope first, then team filter.** A
  manager's BFS scope (`resolveManagerScope_`) is computed on the full roster, then
  intersected with the requested team.
- **Server-side team gating:** if the requested team has zero members inside the
  caller's scope, the backend serves the caller's default team (first team in
  `TEAMS_` order that is non-empty in their scope) instead of an empty dashboard.
  The frontend snaps to whatever `meta.team` says.
- `computePSReport_` receives the team object and skips readers for absent metrics:
  for `rnd`/`sales` the RCR, Tracked (Tempo), and Planned readers are never called —
  those payloads are smaller and faster to compute than today's Services payload.
- `readPTOAccumulationProfiles_` changes its hardcoded `Department: Name = "Services"`
  filter to accept the set of department values present in the requested team's
  roster (passed in by the caller).
- Payload additions:
  - `meta.team = { key, label, metrics }` — the team actually served.
  - `meta.availableTeams = [{ key, label }]` — teams with ≥ 1 member in the caller's
    scope; drives the toggle UI.
- Scoring: no new weight machinery. `weightsForEmployee_` already routes non-PS
  families through the NONCONTRIB branch (policy defaults Goals 40 / Kudos 20 /
  SI 20 / PTO 20, family × level cells as targeted overrides), and JF004 through the
  COE `ALL` cell. `emp.scoreWeights` attaches per employee exactly as today. Top
  Rocketeers ranks within the served team's payload only.

### Cache & warmer

- Cache key gains a team segment: `ps_v<VER>_<team>_admin` and
  `ps_v<VER>_<team>_<email>`.
- `bustReportCache_()` is unchanged — the version bump already strands every entry
  across all teams and scopes at once.
- `warmReportCache()` warms all three admin-scope entries, Services first (R&D and
  Sales computes are cheaper since three heavy readers are skipped).

## Security

`checkDashboardAccess()` and `PS Security.js` are **structurally unchanged** — same
six-step role resolution, bootstrap admin, default lists, Script Properties lists,
and Open Access ordering guarantee.

Two intentional access expansions fall out of the wider roster (both approved):

1. **Company-wide supervisor auto-access.** Resolution step 4 ("active roster
   supervisor → manager") now matches R&D and Sales supervisors, because their rows
   exist in the roster. Each sees only their own org tree, like Services managers
   today.
2. **Existing admins/viewers gain R&D and Sales & Success visibility** via the toggle.

Enforcement notes:

- The team filter applies after the scope filter, so a manager can never see outside
  their org tree regardless of the team requested.
- Team gating is server-side (default-team fallback), matching the philosophy of
  `switchTab()`'s role gating — hiding the button is UX, not security.
- Manager cache keys embed the email and now the team, so every (team × scope) pair
  is an isolated cache entry.

## Frontend (`PS Dashboard.html`)

- **Toggle:** a segmented control in the header next to the ☰ menu, built from
  `meta.availableTeams`. If only one team is available (typical manager), it does
  not render.
- **State:** `STATE.activeTeam` (default `"services"`) and `STATE.teamData = {}` —
  client-side payload cache per team. Switching to a cached team renders instantly;
  an uncached team shows the existing loading screen and fetches.
- `loadData(forceRefresh)` passes `STATE.activeTeam` as the second argument to
  `getPSReportData`. Refresh busts only the active team (and replaces its
  `STATE.teamData` entry).
- **Payload is truth:** after every load the toggle snaps to `meta.team.key`, so a
  server-side fallback is reflected in the UI rather than fought.
- **Metric-aware rendering:** one helper `hasMetric_(key)` reading
  `meta.team.metrics` gates: Overview KPI cards, Team Radar axes (R&D radar renders
  4 axes: SI, Goals, Kudos, PTO), Trends charts, Top Rocketeers table columns, and
  Data Reference rows. The same render functions serve every team — no per-team
  forks.
- **Resets on team switch:** `jobTitleFilter` / `jfFilter` / `lvFilter` clear (they
  describe a different population). `sort`, `activeTab`, and the period
  (Week/Month/Quarter) machinery carry over untouched.
- `VIEWS`, tab structure, ☰ menu, ⚖️ Scoring Weights, and 🔒 Access Control are
  unchanged; the two settings pages remain global (team-independent).

## Error handling

| Condition | Behavior |
|---|---|
| Unknown `teamKey` | Backend serves `services` |
| Requested team empty in caller's scope | Backend serves caller's default team; frontend snaps toggle to `meta.team.key` |
| Fetch fails on toggle | Current team stays rendered; existing error banner shows |
| Team with zero members in scope | Never listed in `meta.availableTeams` |
| Cold cache on first toggle | Existing loading screen (same as today's cold load) |

## Testing

- **Unit:** `_test_teamForProfile_()` — Node-runnable with stubbed `Logger`, same
  pattern as `_test_weightsResolver()`. Cases: Services-dept member (any family),
  JF004 title inside the PS class (→ `services`), JF004 in To be Allocated/Corporate
  (→ `sales`), non-JF004 in To be Allocated/Corporate (→ `rnd`), class compare
  case-insensitive, `classIsKnown_` accepts the three known classes and rejects
  unknown/blank, unknown team key fallback.
- **Manual QA checklist:**
  1. Admin toggles all three teams; headcounts sane; Services view byte-identical to pre-change.
  2. R&D supervisor logs in → manager role, sees only their tree, no toggle (single team).
  3. Viewer sees all three teams read-only.
  4. Refresh per team busts only that team's entry.
  5. Radar/Trends/Top Rocketeers on R&D show only the four metrics.
  6. Execution log shows per-team cache keys.
- **Deploy:** bump `PS_CACHE_VER` (key shape changed) and re-run `setupCacheWarmer()`
  is *not* needed (same trigger, function warms all teams).

## Out of scope (later phases)

- HubSpot metrics for Sales & Success (meetings, deal size, deal conversion, deal
  turn rate) — will extend the `sales` entry's `metrics` list and add a reader.
- Additional R&D-specific metrics ("later we can add more metrics data for them").
- Per-team editable base weights (rejected in favor of existing NONCONTRIB policy
  defaults + matrix overrides). **Superseded 2026-07-09** by the team-aligned scoring spec (per-team blocks + hard metric mask).

## Open items to verify during implementation

- Exact Department column values present in the roster for R&D vs Sales orgs (for
  logging/diagnostics only — membership does not depend on enumerating them).
- Whether the Goals sheet's name normalization (`normPS_`) collides across a
  company-wide population (duplicate full names) — log a warning if two roster rows
  normalize identically.
- SI sheet Employee Number coverage for non-Services rows (join silently yields
  blanks if missing — acceptable, but log coverage counts per team).
