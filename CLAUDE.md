# PS Weekly Contribution Report — Project Intelligence

## What this project is

A Google Apps Script (GAS) web app served via `doGet()` in **PS Contribution Report.js**.
It reads from multiple Google Sheets, assembles a 5-week rolling view of PS team health
(RCR, SI, Goals, Tracked Time, Planned Time, Kudos, PTO), and renders it in
**PS Dashboard.html** as a single-page dashboard.

---

## Dashboard navigation (PS Dashboard.html)

Navigation is driven by the `VIEWS` array — single source of truth for every view's
button/pane ids, label, location, and role allow-list. Add a view by adding one `VIEWS`
entry. Since 2026.W37 every view lives in a fixed left sidebar (main group + a "More"
group that replaced the ☰ menu) and the header + filter bar are one sticky top bar. Full
inventory, role allow-lists, the shell's CSS tokens and the ACL card editor's filter-index
trap live in the `ps-dashboard-navigation` skill.

Since 2026.W41 there is no Leading Behaviours tab: its ranking lives inside 📈 Performance
Record, which sits third (after Team Radar). Its default "People" layout is a ranked list beside
a plain-English person card (`perfStory_`, pure, inside the PERF-ENGINE sentinels), and the old
signal grid is one click away as "Team grid". `switchTab()` aliases `"rocketeers"` to
`"perfrecord"`. Score bands everywhere in that tab are `PERF_BARS.score` (75 / 50). On top of
the one-row header and filter bar, the top bar folds to the filter row when scrolling, aligns
with `main` on wide screens, and on phones (≤ 720 px) the rail becomes a drawer and the filters
a bottom sheet. Spec: `ps-dashboard/docs/specs/2026-10-10-performance-record-merge-and-top-bar-design.md`;
plain-English report: `ps-dashboard/docs/reports/2026-W41-performance-record-and-filters.md`.

Two rules stay here, because they must hold whether or not that skill is loaded:

- Role gating is enforced inside `switchTab()` (forbidden id → Overview), not just by
  hiding buttons.
- Client-side role tests go through `isSuperAdmin_()` / `hasAdminPower_()` — never a
  bare `STATE.userRole === 'admin'`, which silently locks super admins out.

---

## Access control model (PS Security.js)

Five roles, highest first: **superadmin > admin > orgadmin > viewer / manager**.

**Powers and scope are two separate axes.** A role name answers both, but the code
asks them separately — `hasAdminPower_()` / `canManageAdmins_()` for what someone may
DO, `seesFullRoster_()` / `isTeamScoped_()` for what they may SEE. Never gate on a
role string: a bare `role === "admin"` comparison is a bug, and
`tests/access-tier-checks.js` fails the build if one reappears.

| Role | Sees | Teams | Can change | 📈 Perf Record | Own record |
|---|---|---|---|---|---|
| **Super Admin** | everyone | all 3 | everything, incl. the super-admin list | ✅ | ✅ visible |
| **Admin** | everyone | all 3 | all settings + every access list — **not** scoring weights (read-only since 2026.W42) | ✅ | ❌ hidden |
| **Org Admin** | **own org tree** | those their reports sit in | access settings + viewers/delegates — **not** the Super/Admin/Org lists; scoring weights for **their own teams only** (never the company default) | ✅ own tree | ❌ hidden |
| **Viewer** | everyone in **their own team** — or, when they lead people on the roster, **their own org tree** (2026.W42) | **1 (pinned)** — or those their reports sit in | nothing | ✅ own team / own tree | ❌ hidden |
| **Manager** | own org tree (reports & below) | those their reports sit in | nothing | ✅ own tree | ❌ hidden |

📈 Performance Record (opened to every role in 2026.W36) reads **only the report
payload**, so its scope and self-exclusion are the server's — there is no separate
endpoint to gate, and the `VIEWS` entry carries `roles: null`.

### Org Admin — admin powers, manager scope

The tier for a Director who runs the dashboard for their own org without seeing their
peers’. Anchored on their **own** roster name, so `getPSReportData`'s manager branch
works unchanged and `scope.delete(managerNorm)` still removes their own row.

Two rules that must not drift:
- **Barred from the Super / Admin / Org-Admin lists** (`canManageAdmins_`). An
  org-scoped admin who could grant plain Admin would grant it to themselves. The
  server *throws* on the attempt rather than ignoring it.
- **Requires a roster row.** No row → no tree to anchor → **denied**, never widened
  to the company. Grant a non-supervisor plain Admin instead.

⚠️ **Being on an access list overrides roster auto-resolution.** The order is
super → admin → org-admin → viewer → delegate → roster supervisor. So adding a
supervisor to the Admin list silently discards their org scope and hands them the whole
company. The **Viewers list is the exception since 2026.W42**: a listed email that leads
≥1 active person on the roster resolves as a **manager** — own org tree, own row out,
anchored by `_activeSupervisorName_`, with **no** auto-access policy gate (the list is the
grant; the roster only sets the scope). A listed IC, or an off-roster stakeholder, stays a
pinned / company-wide viewer. Before this, listing a manager as a Viewer handed them every
peer manager's people in their org team — reported as a bug on 2026-10-14.
`diagnosePSAccess()` prints a **list audit** showing, per listed email, the role it
resolves to, the people it covers and the teams — with a ⚠️ on any supervisor sitting
on a company-wide tier. `traceAccess()` is its editor-runnable single-email form (the
Run dropdown cannot pass arguments; set Script Property `PS_TRACE_EMAIL`).

### Denied-page wording — not a PS-team product

This is **Global Contribution Access**: company-wide, limited to **managers and above**,
with access requests routed to the **WFP** team. The copy lives in four SEC_ constants
(PRODUCT_NAME / ACCESS_AUDIENCE / ACCESS_REQUEST_TEAM / ACCESS_REQUEST_LINK), never
inline — two different surfaces draw it and they must not diverge:

- `buildAccessDeniedPage_` — the standalone page `doGet` serves before any JS runs.
- `showAccessDenied_` in the frontend — for a denial that arrives from
  `getPSReportData` after the app has loaded (an empty org tree, say). Fed by
  `accessDeniedInfo_()`, which every denial return attaches as `accessInfo`.

ACCESS_REQUEST_LINK is intentionally empty — it renders a Request-access button only
when set. A wrong address on the denied page is worse than none.

### Team pin (viewers) — `resolveTeamScope_`

A Viewer sees **one** org team, derived from their roster row via
`teamForProfile_` — the same rule the report tags every roster row with, so the pin
follows a person when they move org and there is nothing to keep in sync. The job
catalog is read for every pin: since 2026.W36 the PS class is no longer Services by
definition, because **Solution Architecture (JF018) belongs to Sales & Success** in
any Class (HRIS moves those rows to Department "Sales", `CONFIG_PS.SALES_DEPT`, which
is the secondary signal inside the PS class). Do not reintroduce a Class fast path.
Managers need nothing special: `meta.availableTeams` comes from their scoped roster,
so a Director whose tree holds consultants and SAs simply gets two teams in the toggle.

`getPSReportData` **overrides** the requested `teamKey`, never merely validates it,
and does so **before the cache key is built**. Both halves matter: the client's
requested team is untrusted, and viewers share the per-team `_admin` cache entries
with admins — serving R&D data under the Services key would poison what every admin
then reads. `meta.availableTeams` is narrowed to the pinned team too, so the toggle
hides itself (`renderTeamToggle_` needs ≥2) and the team-warm loop skips the rest.

A viewer with **no roster row** (an externally granted stakeholder) resolves to
`null` and keeps the company-wide view — the admin who added them chose that. It is
logged.

There are **three layers** of access, applied in order:

### 1. Bootstrap super admin — code-level, indestructible
```js
SEC_.BOOTSTRAP_ADMIN = "moises.lopez@servicerocket.com"
```
Always **Super Admin**. Cannot be removed via the Settings UI. Do not change.
(The constant keeps its old name; it anchors `superAdmins`, not `admins`.)

### 2. Default super admins / admins / viewers / delegates — code-level, always active
Defined in `SEC_.DEFAULT_SUPER_ADMINS`, `SEC_.DEFAULT_ADMINS`, `SEC_.DEFAULT_VIEWERS`,
`SEC_.DEFAULT_DELEGATES` in `ps-dashboard/PS Security.js`.
These survive a Script Properties reset. Edit this file to add permanent stakeholders.

- **Super Admin**: everything an Admin can do, plus sight of their own record and
  granting/revoking Super Admin.
- **Admin**: full dashboard + can manage admins/viewers/delegates. Reads scoring weights
  (editing is Super Admin / Org Admin, see "Scoring weights").
- **Viewer**: read-only dashboard — their own team, or their own org tree when they lead
  people on the roster (see the ⚠️ note above).
- **Delegate**: manager-scoped — sees only their org tree.
  Format: `{ email: "peer@servicerocket.com", scopeName: "Full Name of Roster Supervisor" }`.

An email present on both the super and plain admin lists resolves as superadmin, and
`_readAccessLists_` de-dupes it out of `admins` so the UI never shows it twice.

### 3. Runtime access — stored in Script Properties, managed via 🔒 Access Control (sidebar › More)
Any Admin can add/remove emails without touching code. Additive on top of defaults.
Property keys: `PS_DASH_SUPER_ADMINS`, `PS_DASH_ADMINS`, `PS_DASH_VIEWERS`, `PS_DASH_DELEGATES`.
`PS_DASH_SUPER_ADMINS` is writable by **super admins only** — `saveAccessSettings`
throws (rather than silently ignoring) when a plain Admin posts that field, so a
failed escalation is visible in the log.

### Open access flag
`SEC_.OPEN_ACCESS_DEFAULT = false` (default). Set to `true` temporarily for demos/all-hands.
Can also be toggled from the 🔒 Access Control page (sidebar › More).

### Who can let themselves in — `SEC_.MANAGER_AUTO_ACCESS`

Auto-manager access is the widest door in the model: a roster supervisor gets in by
**opening the link**, with no approval step and no record beyond the execution log.

| Mode | Who auto-resolves |
|---|---|
| `"any-org"` *(default, historical)* | any active roster member with ≥1 active direct report, **in any org** — Finance, R&D, Sales included |
| `"classes"` | only supervisors whose roster Class **or** Department is in `SEC_.MANAGER_AUTO_ACCESS_SCOPE` (empty list ⇒ nobody, fails closed) |
| `"off"` | nobody — managers must be added as delegates in 🔒 Access Control |

Explicit lists (super/admin/viewer/delegate) work identically in every mode; the
switch only governs *auto* resolution. The Google deployment setting
("Anyone within &lt;domain&gt;") is the only boundary outside this one — it stops the
public internet, not colleagues.

### Every non-underscore global is a public endpoint

In GAS, **any** function without a trailing underscore is callable via
`google.script.run` by anyone who can load the web app. "Run this from the editor"
is a naming convention, not a control — `setupCacheWarmer` (installs triggers),
`runKudosNormalizer` (rewrites a sheet) and `setConfluenceConfig` (deletes a Script
Property) were all reachable that way. Every one now calls `checkDashboardAccess()`,
and `tests/access-tier-checks.js` sweeps all five GAS files to enforce it: adding an
ungated global fails the build unless it is listed in that test's `UNGATED_OK` map
with a stated reason.

### Role resolution ordering (checkDashboardAccess)
Super admin → admin → viewer → delegate → roster supervisor → open-access fallback.
Manager checks (delegate list, roster supervisor) run **before** the Open Access
fallback on purpose: turning on Open Access must never silently promote a scoped
manager into a full-roster viewer. The verdict is memoised per execution
(`_SEC_ACCESS_MEMO_`); `_secResetMemo_()` clears it after any access-list write.

---

## Org tree completeness — a dropped row must not sever the tree

`resolveManagerScope_` is a BFS over the roster's **Supervisor** field, so it can only
walk through people who have a row. `readPSRoster_` drops rows for an unknown Class, an
intern title and an inactive/terminated status — and one dropped **mid-level manager**
used to take their whole sub-tree off the director's dashboard, silently. The realistic
trigger is a termination whose reports have not been re-parented yet.

So `readPSRoster_(bridgesOut)` now also returns those dropped rows' org edges
(`normName → { name, supNorm }`, via `recordRosterBridge_`) and `resolveManagerScope_`
takes them as a third argument. Two invariants:

- **Bridge nodes are traversal-only.** They join `seen`, never `scope` — a dropped row
  still reaches no payload, no aggregate, no Top Rocketeers board.
- **Bridging widens nothing.** Every bridge is a real Supervisor edge from the sheet, so
  the tree it rebuilds is the tree that actually exists. A bridge whose supervisor is
  outside the anchor's tree is never reached.

A bridge that actually carried someone logs an ℹ️ line naming the dropped rows, so the
roster gets fixed rather than the workaround becoming permanent. Covered by §5c-bis of
`tests/access-tier-checks.js`, which also keeps a check that the **unbridged** walk
still loses the sub-tree — the fixture has to keep proving what it fixes.

---

## Self-exclusion — nobody but a super admin sees their own record

A rocketeer's evaluation belongs on **their manager's** dashboard, never their own.
So for every role except superadmin, the signed-in user's roster row is removed from
the payload: `employees[]`, Top Rocketeers, the goals audit, and every per-person map
keyed by `normName` (`meta.siByEmployee`, `meta.rcrByEmployee`, `ptoQ4History[].byEmp`,
`goalsQ4Hist`).

Two enforcement points, deliberately different:

- **Managers** — `getPSReportData` calls `scope.delete(managerNorm)` right after
  `resolveManagerScope_`, so the anchor is gone *before* compute and never reaches the
  org tree's aggregates either. (A small org tree's totals would otherwise give the
  missing row away.) `resolveManagerScope_` still returns the anchor — it seeds the
  BFS; the caller decides.
- **Everyone else** — `applySelfExclusion_(payload, access)` strips the row on the way
  out, after the cache read, keyed off `access.selfRosterName` (resolved once by
  `checkDashboardAccess`). Team aggregates keep counting them; one row among the whole
  company is not a readable evaluation.

`applySelfExclusion_` also **re-stamps `userRole` / `userEmail` per caller.** The
full-roster cache entry is shared across superadmin/admin/viewer, so the role frozen in
at build time belongs to whoever built it (usually the warmer). Without the re-stamp a
viewer landing on a superadmin-built entry would be handed `userRole: "superadmin"` —
and with it the 📈 Performance Record tab. Anything added to the shared entry must stay
impersonal; personalise here, never in `computePSReport_`.

`meta.selfExcluded` / `meta.selfName` ship to the frontend so the role badge can say
why a row is missing.

---

## 👁 View as — a super admin previews someone else's dashboard

`getPSReportData(bustCache, teamKey, viewAs)` swaps the caller's verdict for the target's
via `resolveViewAsAccess_` (PS Security.js) — **super admins only, throws for anyone
else**. The target is resolved through `_resolveAccessFor_`, so team pin, cache key,
org-tree scope, self-exclusion and denial reasons come out exactly as for that person's
own login. **Only the report payload is impersonated**: every settings endpoint still
resolves the real caller, so the preview can never write as the target. The frontend
hides Access Control while previewing (`hideInPreview` on the `VIEWS` entry) because it
would read settings as the real caller; Scoring Weights stays visible but read-only
(`canEditScoring_()` is false while `STATE.viewAs` is set; the page follows the team
toggle, so the preview shows the target's team group). `meta.viewAs` is stamped by
`applySelfExclusion_` (per-caller, never in the shared cache entry); the 👁 sidebar entry keys off
`STATE.realRole` / `isRealSuperAdmin_()`, not the previewed `userRole`. Candidates come
from `listViewAsTargets()`. Spec: `ps-dashboard/docs/specs/2026-09-01-view-as-impersonation-design.md`.

---

## Deploying — clasp, and the file-order trap

`ps-dashboard/.clasp.json` pins the script ID and **`filePushOrder`**. The order is not
cosmetic: Apps Script runs every file's top-level code in project order, and
`Contributionintelligence.js` spreads `COLORS`, a top-level const of `Jira Backlog.js`,
at load. Alphabetical order puts it first and every execution (each `doGet`) dies with
`ReferenceError: COLORS is not defined`. Keep new files at the END of the list unless
they are needed at load by another file.

`clasp push` replaces the whole remote file set and skips when content hashes match
(a pure order change needs a real edit to go up). Data maps such as `Change Names.js`
are sometimes edited in the editor — `clasp pull` into a scratch dir and diff before
pushing. Publish with `clasp deploy -i <deploymentId> -d "<note>"`; the URL is stable.

## RCR — two tabs, one month axis (2026.W42)

RCR comes from two tabs of the container spreadsheet and `readRCR_PS_` merges
them onto one `"Mon YY"` month axis (the label the frontend parses), so the trend
does not restart at the FY boundary:

- **`3. RCR`** (FY26 and earlier, `"Jun 26"` headers) — team value =
  SUM(`1. Revenue Contribution`) / SUM(`2. TCC A+B`) over the Employee-ID bridge.
- **`New RCR`** (FY27 on, `"2026.07 RCR"` headers) — a **direct per-person rate**;
  nothing to sum, team value = mean of the tracking-mandated subset's rates.

A month both tabs carry resolves to the New RCR rate. The latest month is the newest
column with ≥1 numeric roster value in either tab. `meta.rcrMethod`
(`"sum-ratio"` | `"direct-rate"`) drives the tooltip wording; rate months are
`exact: true` by definition. Spec: `docs/specs/2026-10-13-new-rcr-direct-rate-design.md`,
tests: `tests/rcr-source-checks.js`.

### Contributor Intelligence export (Contribution.js) reads the same axis

The sheet exporter behind the 🚀 Contributor Intelligence menu (`Contribution.js`,
same Apps Script project) used to list FY26 month columns by hand and tier people on
the `3. RCR` YTD. Since 2026.W42 `readRcrAxis_` builds the same two-tab axis (reusing
`rcrMonthColumns_`), the trend window is the last three populated months, and tier /
sort / signals use the **latest month** with the dashboard thresholds
(`CONFIG.RCR_*` = 1.0 / 1.5 / 2.5). The YTD column stays, labelled `FY26 YTD RCR`.
Group RCR in the summaries is `groupRcr_` — the dashboard's team method over the
dashboard's population (`joinDashboardFlags_` copies `tracksTime` / `isRampUp` /
`onLeave` from `readPSRoster_`).

**Org-scoped run** — menu › *Run for an org…* opens `Contribution Org Picker.html`;
`runContributorIntelligenceForOrg(leader)` walks the Roster Supervisor column from
the leader (through inactive rows, like `resolveManagerScope_`), **excludes the
leader's own row**, and writes `"<tab> · <Leader>"` sheets for the non-empty segments
only. Both endpoints are `requireMaintainer_`-gated. Spec:
`docs/specs/2026-10-13-org-scoped-contributor-intelligence-design.md`, tests:
`tests/contribution-org-scope-checks.js`.

## Data join keys

| Metric | Joined by |
|---|---|
| Roster → RCR (to Jun 26, `3. RCR`) | Name (normalised) → Employee ID bridge via `3. RCR` sheet |
| Roster → RCR (Jul 26 on, `New RCR`) | `Internal ID` → roster `internalId`, name (normalised) as fallback |
| SI ratings | Employee Number (`employeeNumber` on roster profile) |
| Goals (RD sheet) | Name (normalised via `normPS_()`) |
| Planned Time | Name (with Last, First and "Last First" alias variants) |
| Tracked Time | User name (normalised) |
| Kudos | Recipient / Giver name (normalised) |
| PTO (Accumulation Cost) | Employee Number |

`normPS_(name)` = `toLowerCase().replace(/\s+/g, " ").trim()` — used everywhere for name matching.

---

## Fiscal calendar — fully derived, no quarterly maintenance

All quarter/FY constants (goals quarter label, quarter start/end ISO weeks, SI column
header, RCR month columns, grace-period flags) are derived from today's date by
`computeFiscalContext_()` in `ps-dashboard/PS Contribution Report.js` (FY starts July 1) and shipped
to the frontend as `meta.fiscalContext` / `meta.goalsQuarter` / `meta.siQuarter`.
The frontend's header subtitle and every Documentation-tab quarter mention are filled at
load by `updateQuarterLabels_()` via `.drGoalsQ` / `.drSiQ` / `.drQEnd` / `.drQ1Week`
spans — nothing in the HTML needs a manual update at quarter rollover.
Override hook: `CONFIG_PS.SI_COL_OVERRIDE` forces the SI column header if the
auto-generated name doesn't match the sheet.

Policy constants that still change only if the target changes:

| Constant | Meaning |
|---|---|
| `GOALS_MIN_COUNT` | Min goals for compliance (8) |
| `GOALS_ACTIVE_COMMENT_COUNT` | Goals needing self-comments (6) |
| `GOALS_GRACE_DAYS` | Goals-only transition window after quarter start (21) |

---

## Ramp-up exclusion

Employees hired within `RAMP_UP_MONTHS` (3) of today are excluded from RCR, SI, Goals, and
Kudos team metrics. Included in Tracked/Planned/PTO. Override via `Ramp-Up` column in Roster:
`"No"` graduates early, `"Yes"` forces exclusion regardless of hire date.

Crew members (`/crew member|contractor/i` in Job Title) are additionally separated into an
FTE vs crew toggle in the UI.

---

## Naming conventions

- Private helpers: trailing underscore (`readPSRoster_`, `findCol_PS_`, `log_`)
- Config object: `CONFIG_PS` (all caps prefix, single source of truth)
- Security constants: `SEC_` object in `ps-dashboard/PS Security.js`
- Week labels: `YYYY.WN` format (e.g. `2026.W20`) — never `W20` alone in data keys

---

## Scoring weights (Top Rocketeers)

Default: `{ goals: 30, tracked: 30, planned: 20, rcr: 15, kudos: 5, si: 0, pto: 0 }`
Configurable per deployment via ⚖️ Scoring Weights (sidebar › More) → saved to `PS Settings` sheet.
`saveWeightSettings()` / `readWeightSettings_()` handle persistence.

**Read for everyone (2026.W41); edit for Super Admin — any team — and Org Admin — their
own teams (2026.W42).** Three levels of disclosure on one page, nothing duplicated, no
metric definitions (one line links to 📖 Documentation):

1. **Company default** strip — `cfg.baseWeights` as points out of 100 with the colour mix bar.
2. **Points by role** — **ONE table**, one row per job family **of the team the toggle
   shows** (Services / R&D / Sales & Success — one group at a time, `swTeamKey_()` =
   `DATA.meta.team.key`), all seven metric columns as points out of 100 (largest-remainder
   rounding, `sharesOf100_`) plus a score-mix bar. Never add a second table.
3. **Levels** — folded under each role (▸, `swToggle_`, open state in `STATE.swOpen`): the
   role's Job Catalog levels, the job titles at each, and the points that level scores with;
   a cell that differs from the role row is highlighted and the row carries a "varies by
   level" tag. "How a score is built" (four steps, no definitions) sits folded under the table.

Role rows and level folds are resolved server-side by `familySummaryWeights_` →
`resolveBlockWeights_`, the **same rule as `weightsForEmployee_`** (level cell → `ALL` cell →
`blockFillBase_` → team mask → non-tracking mask), so the page can never drift from what
scores people. Level titles come from the catalog (job titles, never people). **Org-scoped
callers** (payload carries `managerScopeName` — managers, delegates, org admins) get the same
table narrowed to the roles and levels their own people hold, with headcounts
(`buildScopedRows_`: catalog-title-then-job-code match, mirroring the server; uncatalogued →
an "Other job titles" row; crew excluded).

**One place to edit — there is no separate editor (2026.W42).** The "Advanced settings" fold,
the flat-base editor and the Team → Family × Level matrix editor are gone; the page's own
cells are the inputs (plain rate inputs, no sliders anywhere): the company default chips
(super admins, `data-base`), the role cells (`data-row`) and, inside each role's fold, the
level cells (`data-row` + `data-lvl`, with a per-level total and a "follow role" reset).
`swOnInput_` gives live totals and flows a role-row edit down to the levels that were
following it (equal to the row before the edit), never to a level tuned on its own.
`swPending_` says what one Save would write and `saveScoringPage_` writes it: the company
default through `saveWeightSettings` **only when it changed**, then the matrix through
`saveScoringMatrix` — a role row becomes the family's `ALL` cell **only when the row changed**
(an inheriting family keeps inheriting the company default), a level whose values moved
becomes its own cell when it differs from the role row and loses its cell (inherits) when it
matches — then a refetch. A change applies to every rocketeer of that team in that role, and
the table says so.

Two things that must stay true (both broke once, 2026.W42 — "save is not working"):

- **`renderWeightsTab_` is idempotent.** `renderAll()` calls it on every re-render (tab switch,
  filter change, background data refresh). It rebuilds the page only when the `data-sw-key`
  (team · scope · previewed person · edit rights) changes or no config is loaded; otherwise an
  editor's unsaved cells would vanish and Save would go grey mid-edit. A save or a reset forces
  the rebuild through `loadScoringMatrix_(true)`; Refresh clears `MATRIX_CFG`.
- **The confirmation survives the refetch.** `STATE.swFlash` is set by the save / reset and
  shown by `renderScoringSummary_` after the re-render.

**Reset all to defaults** (`swResetDefaults_`, editors, two clicks): posts an empty block for
every family of every team in `cfg.editTeams`, so every role scores with its team's fill and
every level follows its role — the sheet had explicit cells on almost every level, which is why
a role-row change reached nobody. The company default is kept. Editors see a `custom` tag on a
role that still carries its own `ALL` cell.

**Two edit gates, both in PS Security.js, both re-checked by the save endpoints:**

- `canEditScoring_` — superadmin + **orgadmin**; plain admin, viewer and manager read only.
  WHICH teams comes from `scoringEditTeams_` (PS Contribution Report.js): superadmin → every
  team; orgadmin → the teams their own org tree holds, by the same BFS and team tag as their
  dashboard (`resolveManagerScope_` with bridges, own row dropped, `availableTeams_`); an
  org admin with an empty tree is a reader. `getScoringConfig` ships it as `editTeams` and
  narrows an org admin's editor payload (sections, matrix, Services audit list) to those
  teams; `saveScoringMatrix` **refuses the whole save** when the payload names any other
  team (logged), never trims it silently. The client's `swCanEditTeam_(cfg)` keys off
  `cfg.editTeams`, never a role guess.
- `canEditScoringBase_` — superadmin only: the company default (`saveWeightSettings`)
  re-weights every team at once, so an org-scoped editor never touches it.

`getScoringConfig` hands non-editors the summary only (role weights + catalog levels; no
headcounts, unmapped-title audit or raw matrix) and never seeds sheets for them. The config
is fetched once per load (`MATRIX_CFG`); a team switch re-renders from it, a save or the
Refresh button refetches. Guarded by `tests/scoring-weights-view-checks.js`. Spec:
`ps-dashboard/docs/specs/2026-10-12-scoring-weights-team-scoped-editing-design.md`.### Team-aligned scoring matrix (2026-07-09)

Scoring groups follow the org team toggle (`TEAMS_` in `ps-dashboard/PS Teams.js`): **team gates,
family tunes**. **Hard invariant**: every resolution path in `weightsForEmployee_` ends in
a mask to `team.metrics` (`maskToTeamMetrics_`) — R&D / Sales members can never carry
tracked/planned/RCR weight, even from hand-edited sheet rows.

Full mechanics (sheet schema, resolution order, `blockFillBase_` defaults, editor, tests)
live in the `ps-scoring-matrix` skill — `.claude/skills/ps-scoring-matrix/SKILL.md`.
Spec: `ps-dashboard/docs/specs/2026-07-09-team-aligned-scoring-design.md`.

Scoring caps:
- `SCORE_TRACKED_RATIO = 0.9` — tracked/planned threshold for full credit
- `SCORE_PLANNED_CAP_HRS = 40` — max hours for plannedNorm = 1.0
- SI normalised as `value / 5` (score 5 → 100%, score 1 → 20%)
- RCR normalised as `value / 2.5`, capped at 1.0

---

## Gemini narrative

`callGeminiNarrative(prompt)` calls Gemini 2.5 Flash via `UrlFetchApp`.
API key stored in Script Properties as `GEMINI_API_KEY` — sent as `x-goog-api-key` header
(not in the URL) to keep it out of GAS execution logs.

---

## Cache

`getPSReportData()` caches its JSON response in `CacheService.getScriptCache()` via
`cachePutLarge_()` / `cacheGetLarge_()`: the JSON is **gzipped (~10× smaller) and split into
90 KB chunks** (`<key>_0..n` + `<key>_meta`), because CacheService rejects any single value
over 100 KB — a plain `cache.put()` of the report payload fails silently, which historically
made every load a cold multi-minute compute. A missing chunk on read is treated as a clean miss.
TTL is `CONFIG_PS.CACHE_TTL_SEC` (65 min).

**Warmer:** `warmReportCache()` runs on a time trigger (install once by running
`setupCacheWarmer()` in the GAS editor as the owner; interval = `CONFIG_PS.CACHE_WARM_EVERY_MIN`,
30 min) and force-rebuilds the admin-scope entry, so admin/viewer loads are warm ~always.
Data can therefore lag sheet edits by up to the warm interval — the Refresh button
(`loadData(true)`) always bypasses cache for a live read.

Cache key: `ps_v<VER>_<team>_admin` (superadmin/admin/viewer — see `seesFullRoster_`)
or `ps_v<VER>_<team>_<email>` (manager-scoped views). The shared entry is stored
**impersonal** and personalised per caller by `applySelfExclusion_` on read — see
"Self-exclusion" above before adding anything caller-specific to the payload.
`<VER>` is `PS_CACHE_VER` in Script Properties. `saveWeightSettings()` and `saveScoringMatrix()`
call `bustReportCache_()` which bumps `PS_CACHE_VER`, stranding **all** prior-version entries at once
(admin + every manager scope) — CacheService can't enumerate keys, so versioning is how a save takes
effect immediately for everyone, not just the saver.

---

## Usage analytics (PS Usage.js)

Every `doGet` hit — allowed and denied — appends one row to the **`PS Access Log`**
tab of the container spreadsheet via `logDashboardVisit_` (best-effort: try/catch;
the script lock guards only first-write sheet creation, so the hourly Jira export
holding it never costs rows; a lost line is fine, a slow page load is not). Only `doGet` logs —
the warmer calls `getPSReportData`, so trigger runs never pollute the data.
`getUsageAnalytics()` (superadmin-only, throws) feeds the 📶 Usage Analytics sidebar (More)
tab: 13-ISO-week rollup + the *eligible audience* (list members ∪ auto-managers the
current `MANAGER_AUTO_ACCESS` policy admits) with who has NOT engaged. The math is
pure (`computeUsageRollup_`) and covered by `tests/usage-analytics-checks.js`.
The trace is disclosed in the page footer and the 📖 Documentation tab.
