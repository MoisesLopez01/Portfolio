# GDash — STF Gaps & RPI: Rules, Measurements and Follow-Up Signals

> **What this is.** Every rule and threshold behind the **💰 STF Gaps** tab and the **RPI**
> score in the Goals Compliance Dashboard, written so a non-engineer can defend a number in
> front of a manager. Includes the signals Kushum needs to run focus-group follow-ups and
> collect justification notes.
>
> **As of** 2026-08-10 (2026.W33) · Backend `goalCompliance.js` v2.10.0 · `CACHE_VER gd_v25_`

---

## 0. Where the rules actually live

- **UI + STF-gap classification** — `GDash.html`
  - `D:\Contribution\GDash.html` — the copy you asked about.
  - `C:\Users\moise\gas-projects\goal-audit\GDash.html` — the **clasp / deployed source of truth**.
- **All measurement (RPI, STF eligibility, population, calendar)** — `goalCompliance.js`
  (clasp: `GoalCompliance.js`). The HTML only *renders* what the backend computed, with one
  exception (below).
- ⚠️ **The two copies are not identical.** The `D:` copy has **no 📤 Focus Group Sheet export** —
  that feature exists only in the clasp copy (`openFocusGroupModal_` / `createFocusGroupSheet_` in
  `GDash.html`, `createStfFocusGroupSheet()` in `GoalCompliance.js`). Section 8 documents the
  clasp behaviour. Never deploy the `D:` copy over the clasp one.
- ⚠️ **Threshold duplication.** The STF bars exist twice: `CONFIG_GD.STF_MIN_COMPLETED` /
  `STF_MIN_CMT_GOALS` on the server, and `STF_COMPLETED_BAR_ = 8` / `STF_CMT_GOALS_BAR_ = 6` as
  local consts in `GDash.html` (so the pure block can be unit-tested standalone). **If a bar
  changes, both must change.**

---

## 1. Who is measured at all (the population rule)

Signals are only defensible if the population is. In order of application:

- **Source of people** — every Rocketeer found in the **RD goals sheet**, plus every **active,
  in-scope, non-intern roster employee with zero goals** (injected as a 0-goal row so
  "no goals at all" is visible, not silently missing).
- **Interns — fully excluded.** Title matched by regex `/intern/i` against *either* the roster
  Job Title *or* the RD-derived title (checked independently — one source can lag the other).
  Interns aren't required to log goals and never qualify for STF.
- **Crew / contractors — included only if they have RD goals.** A goal-less contractor is
  **never** injected as a 0-goal At Risk row (goal-count policy isn't asserted for crew).
  Crew are tagged with their own `Crew` job family.
- **Attrition (terminated) — split out into an isolated list.** They keep a full RPI/STF read for
  HR reference but are **never** summed into compliance rate, RPI, STF, or engagement totals.
- **New hires — excluded from Needing Support and from the STF Gaps list.**
  Rule: hired **on or after the quarter's first day** (`isNewHire_`). Fails safe — a missing or
  unparseable hire date is **not** treated as a new hire. Flagged 🌱 New Hire instead of a concern
  badge. They rejoin the pool from their first full quarter.
- **On leave — excluded the same way.** Roster **Employee Status** matching
  `CONFIG_GD.LEAVE_STATUSES` (`maternity leave`, `parental leave`; extensible, matched
  case-/space-insensitively). Flagged 🏖 On Leave. A 0-goal quarter while away is *expected*,
  not a failure.
- **Overview totals still count new hires and on-leave** — only Needing Support / STF Gaps /
  engagement exclude them. Every card states its own base.
- **Manager-scoped views** are cut to the viewer's org tree before any of this; a scoped manager
  cannot probe a name outside their tree (the drill-down rejects outright).

---

## 2. Calendar rules (everything is quarter-bound)

- **Fiscal year runs Jul 1 → Jun 30.** `FY26Q4` = Apr–Jun 2026.
- **A goal belongs to a quarter by its own Start Date** (`dateToFiscalQuarter_`), resolved once per
  Goal ID — *not* by the RD `Fiscal Quarter` text column, which is blank/inconsistent often enough
  that it used to silently drop whole Rocketeers.
- **Quarter length = calendar ISO weeks** (13–14), not "weeks that happen to have comment data".
  This is the `Cmts/Wks` denominator.
- **`weeksElapsed`** = calendar weeks since quarter start, clamped to `[1, totalQtrWeeks]`.
  Drives the RPI cadence bar and the engagement pace threshold.
- **Comments dated outside the quarter window do not count** toward `commentWeeks` — late updates
  on a quarter-bucketed goal can't retro-fill cadence.
- **Goal-creation grace** — first **4 weeks** of an *active* quarter. While on, Watch-tier people
  appear in Needing Support but are not yet mandatory follow-up.
- **Completion grace** — final **2 weeks** of an *active* quarter: flag goals not yet moved to Completed.
- **Closed quarters never show an active grace window** (historical bug: the completion flag had
  no upper bound and stayed true forever).

---

## 3. Goal counting & status vocabulary

| Measure | Rule |
|---|---|
| `totalGoals` | Distinct Goal IDs bucketed into the quarter by Start Date |
| `goalsCompleted` | status matches `/complet/i` **and not** `/not.?complet/i` |
| `goalsInProgress` | `/in.?progress/i` |
| `goalsPlanned` | `/planned/i` |
| `goalsCanceled` | `/cancel/i` |
| `goalsNotCompleted` | `/not.?complet/i` |
| **Compliance tier** | **On Target = 10+ goals · Watch = 8–9 · At Risk = <8** (`GOALS_ON_TARGET 10`, `GOALS_WATCH 8`) |
| Completion rate | Completed ÷ **non-canceled** goals — a canceled goal is neither achieved nor missed, so it leaves the denominator |

**Comment vocabulary — the single most misread rule:**

- `totalComments` on a goal = **every** comment row on it (Rocketeer + manager + anyone else).
- `selfComments` = comments whose author normalises to the **goal owner's own name**.
- 🚩 **STF counts `totalComments`. RPI cadence counts `selfComments` only.**
  A Rocketeer whose manager wrote most of the comments can clear the STF comment bar and still
  fail RPI criterion 2. Expect this question in a focus group.
- All name joins use the normalised full name (lowercase, accents stripped, whitespace collapsed).

---

## 4. STF eligibility (Set-the-Future)

**Two bars, both must be met — the math never bends:**

- ① **`stfGoalsCompleted ≥ 8`** — completed goals this quarter (`STF_MIN_COMPLETED`).
- ② **`stfGoalsWithSufficientComments ≥ 6`** — of those completed goals, at least 6 must each carry
  **≥ 8 total comments** (`STF_MIN_CMT_GOALS = 6`, `STF_MIN_COMMENTS = 8`).
- `stfEligible = ① AND ②`. Anything else is ineligible, full stop.
- The **STF ✓ / ✗ badge is one shared renderer** (`stfBadge_`) used by the STF Gaps table, the
  Needing Support table and the roster — the tag can never disagree between tabs.
- Badge tooltip when ineligible spells the shortfall: `Needs: 5/8 completed, 3/6 goals w/8+ cmts`.

---

## 5. STF Gaps tab — the follow-up signals

Tab is **admin-only** (`VIEWS` roles `['admin']`). Rows exclude new hires and on-leave, respect the
filter bar, and are sorted **worst record first** (completed ascending → well-commented ascending →
name). Click any row for the person's goal detail.

### 5.1 Primary reason — first match wins, exhaustive

Computed by `classifyStfReason_()`; returns `null` when the person is eligible.

Let `gap = 8 − completed`, `pending = inProgress + planned`, `lost = canceled + notCompleted`.

| Order | Reason key | Condition | What it means / the ask |
|---|---|---|---|
| 1 | **`comments`** 🗨 Comments shortfall (blue) | `completed ≥ 8` | Completion bar met — the **only** gap is comments. Typical senior-manager pattern. Ask: add comments to completed goals. |
| 2 | **`pending`** ⏳ Pending closure (amber) | `completed < 8` **and** `pending ≥ gap` | Still **mathematically reachable** — the open Planned/In-Progress goals can close the gap. Ask: close them before quarter end. |
| 3 | **`canceled`** ✖ Canceled / Not-completed (red) | `completed < 8`, `pending < gap`, `lost > 0` | **Unreachable** — goals were canceled or marked not completed. Ask: justification for the cancellations. |
| 4 | **`toofew`** ▽ Too few goals (slate) | `completed < 8`, `pending < gap`, `lost = 0` | Never enough goals logged to reach the bar. Ask: why the goal set was short at setting time. |

### 5.2 Exception candidate (near miss) ☆

- `nearMiss = completed ≥ 8 AND wellCommented === 5` (exactly one goal short of the 6 bar).
- Flagged **green** as a candidate to have STF **paid as an exception**.
- **It is a note only — `stfEligible` stays false.** The eligibility math never bends for it.
- Near-miss suppresses the plain `🗨 needs comments` badge (they'd say the same thing).

### 5.3 Row badges (a person can carry several)

- `⏳ N pending` — whenever `pending > 0`, eligible or not.
- `✖ N canceled/not-completed` — whenever `lost > 0`.
- `☆ exception candidate (5/6)` — near miss.
- `🗨 needs comments (n/6)` — completion bar met, comment bar not, not a near miss.
- `▽ only N goals logged` — primary reason is `toofew`.

### 5.4 Summary chips (click to filter; count always equals the filtered row count)

| Chip | Counts | Use it for |
|---|---|---|
| ⏳ **Open goals to close** (`withPending`) | anyone — **eligible included** — with `pending > 0` | the "please close your open goals" broadcast before quarter end |
| 🗨 **Completed, missing comments** (`comments`) | `primary === 'comments'` | the comment-discipline conversation |
| ☆ **Exception candidates** (`nearmiss`) | `nearMiss` | the exception-approval list for Finance |
| ✖ **Canceled/NC** (`canceled`) | `primary === 'canceled'` | the justification conversation |
| ▽ **Too few** (`toofew`) | `primary === 'toofew'` | the goal-setting conversation |
| ✓ **STF eligible** (`eligible`) | already qualified | control group |

Footer reads `N to follow up · N eligible · N evaluated`.

### 5.5 Table columns

`Emp # · Rocketeer · Job Title · Manager · Completed (n/8) · Well-commented (n/6) · Pending ·
Canceled/NC · Reason signal(s) · STF`

- Two view modes: **STF Gaps** (ineligible only, default) and **All evaluated** (eligible rows sort
  last with the green ✓).
- **⬇ CSV** exports exactly what is displayed (filter + mode + active chip), with columns:
  Employee #, Rocketeer, Job Title, Manager, Department, Completed, Well-commented, Pending,
  Canceled/NotCompleted, STF Eligible, Exception candidate, Primary reason, All reasons.

---

## 6. RPI — Rocketeer Performance Index (0–6)

**Three criteria × 2 points each** (`RPI_PTS = 2`). The green **RPI signal fires only at a perfect
6/6**; amber = partial credit; red = 0. The badge tooltip spells out each criterion in place.

| # | Criterion | Rule | Notes |
|---|---|---|---|
| **C1** | Goals set, correctly dated | **≥ 10 goals whose own Start Date falls inside the quarter window** | **Status-blind** (v2.5.2): a goal approved and later *Canceled* or *Not Completed* still counts — approval already happened; the outcome is C3's business. RD carries no approval column, so the date check *is* the criterion. |
| **C2** | Comment cadence | On **≥ 6 non-canceled goals**, the Rocketeer has at least `required` **self-comments** | `required = clamp(weekOfQuarter − 6, 1, 8)`. Canceled goals never count. Self-comments only. |
| **C3** | Delivery | **≥ 8 goals completed** (`GOALS_WATCH`) | Same completed count STF criterion ① uses. |

### 6.1 The cadence bar, week by week

`required = min(max(1, week − RPI_CADENCE_LAG), RPI_CADENCE_MAX_CMTS)` with `LAG = 6`, `MAX = 8`.

| Week of quarter | 1–7 | 8 | 9 | 10 | 11 | 12 | 13 | 14+ |
|---|---|---|---|---|---|---|---|---|
| Self-comments required **per goal**, on 6 goals | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |

- **Why LAG 6** = the 4-week goal-setting window **+ 2 flex weeks** for PTO, sick time, manager
  follow-up delay and late commenting starts. It is a **rolling allowance that applies at any point
  in the quarter**, not just at the end.
- **Why cap 8** — deliberately equals `STF_MIN_COMMENTS`, so RPI and STF share one comment bar at
  quarter end.
- Closed quarters use the **calendar** week count, so a finished quarter can't drift into an
  impossible requirement as late comments keep arriving.

### 6.2 What RPI is *not*

- It is not a manager metric and not an average — it is 0/2/4/6, a policy scorecard.
- It **never** flexes for new hires or on-leave; those people are simply pulled from the
  follow-up pools (§1), and their badge is neutral.
- The analytical companion is **CPR pace** (§7) — never stack the two allowances (RPI uses the
  flat 2-week flex, CPR uses the true 4-week lag plus PTO).

---

## 7. Supporting signals (Needing Support tab & pace)

### 7.1 Who lands in the Needing Support pool

Anyone **not** a new hire and **not** on leave with either:
- **compliance failure** — `At Risk`, or `Watch` while the goal-creation grace is active; or
- **engagement failure** — `hasEngagementConcern` **or** `goalsStuckInPlanned > 0`.

Sorted by urgency (`supportPriority_`): `No Goals (0) → 1–4 (1) → 5–7 (2) → 8–9 Watch during grace (3) → engagement-only (4)`, then by name.

### 7.2 Signal badges

| Badge | Rule |
|---|---|
| 🏖 **On Leave** | roster status in `LEAVE_STATUSES` — checked **before** New Hire; suppresses all concern badges |
| 🌱 **New Hire** | hired on/after quarter start — suppresses all concern badges |
| **No Goals** | `totalGoals === 0` |
| **1–4 Goals** / **5–7 Goals** | `totalGoals < 5` / `< 8` |
| **8–9 Watch** | Watch tier, **only while the goal-creation grace is active** |
| **Not Commenting** | `hasEngagementConcern` = has goals but **zero self-comments all quarter** |
| **Stuck (N)** | `goalsStuckInPlanned` = Planned goals with **zero comments of any kind** — not started, not discussed |

Row also shows `Cmts/Wks` = distinct in-quarter ISO weeks with ≥1 self-comment ÷ calendar weeks.

### 7.3 Engagement / pace measures

- **Engagement %** = Rocketeers with ≥1 self-comment ÷ Rocketeers **with goals** (not headcount —
  that's why the engagement and headcount cards differ legitimately).
- **paceThreshold** = `floor(weeksElapsed / 2)`.
  `Silent` = 0 self-comments · `Below Pace` = self-comments < threshold · `At Pace` = ≥ threshold.
- **CPR (v2.7.0)** — PTO-adjusted comments per eligible week.
  `eligibleWeeks = max(0, weeksElapsed − 4) − PTO absence (hours/40 per week, capped at 1)`.
  Person CPR = **median of their top-6 goals** by CPR. `activityRatio` = eligible-window weeks with
  ≥1 self-comment ÷ eligible weeks, capped at 1.
  - Bands: `< P10 → Behind Pace`, `> P90 → high (informational)`, else `on`.
    `activityRatio < P10 → bursty`, else `steady`.
  - **Reference population is decontaminated**: excludes new hires and anyone already At Risk.
  - Classification is **suppressed entirely** (`na`) when the PTO ledger read failed, when the
    reference population is `< 20`, or on **any manager-scoped payload** — a per-org-tree
    percentile would classify the same person differently for a manager than for an admin.
- **Manager scorecard**: `avgCmts` = manager comments ÷ team size; `covered` = team members with
  ≥1 manager comment. Senior leaders detected by title regex (`vp|director|chief|c*o`).
  `MANAGER_ENGAGEMENT_EXCEPTIONS` managers are tagged **Excepted**, never hidden.

---

## 8. Focus-group follow-ups (Kushum's workflow)

> Clasp copy only — `📤 Focus Group Sheet` button on the STF Gaps tab, **admin role required**
> (re-checked server-side in `createStfFocusGroupSheet`).

### 8.1 What it exports

- **Always and only the ❌ needs-follow-up group** — `buildFinanceRows_(…, false).rows` filtered to
  `!eligible`. STF-eligible Rocketeers **never** appear, regardless of the on-screen toggle or the
  active chip.
- Scope = the current filter bar, then a manager picker: **one manager**, or **All managers**
  (grouped by manager, worst record first inside each block).
- Output: a new Google Sheet named `STF Focus Group | <scope> | <quarter>`, tab
  `<quarter> Focus Group`, ServiceRocket-branded header bands.

### 8.2 Sheet columns — and what each one proves in the room

| Column | Signal it carries |
|---|---|
| Rocketeer · Department · Class · Supervisor | who owns the conversation |
| **Comments by Employee** | the RPI-cadence side of the story (self only) |
| **Comments by Supervisor** | the manager's own engagement — is the gap one-sided? |
| **Goals Completed** | STF criterion ① (against the bar of 8) |
| **Not Completed · Canceled** | whether the gap is **unreachable** and needs justification |
| **In Progress · Planned** | whether the gap is **still closable** before quarter end |
| **Total Goals** | goal-setting discipline (the `toofew` conversation) |
| **Supervisor Comments: Month 1/2/3** | manager cadence — was feedback front-loaded or absent? |
| **Rocketeer Comments: Month 1/2/3** | backloading — 0/0/24 is a very different story from 8/8/8 |
| **Details** | the prose rendering of the exact on-screen signal (see below) |
| **Please add justification note** (coral) | the manager's input column — the whole point of the sheet |

### 8.3 The `Details` sentence (auto-written, matches the on-screen badges exactly)

Format: `<completed>/8 goals completed, <wellCommented>/6 well-commented (8+ comments) · <reason clause>` where the reason clause is:

- `comments` → *"completion bar met — the comment shortfall is the only gap"*
- `pending` → *"N open goal(s) (In Progress/Planned) can still close the N-goal gap — needs closure before quarter end"*
- `canceled` → *"gap can no longer be closed — N goal(s) canceled/not completed"*
- `toofew` → *"only N goal(s) logged — cannot reach the 8-completed bar"*
- plus, when applicable: *"☆ exception candidate: one goal short of the comment bar"*

### 8.4 Signal → question to put to the manager

| Signal on the row | What to ask for as justification |
|---|---|
| ⏳ **Pending** (gap still closable) | A closure commitment with a date **before quarter end** — this is the only reason still fixable |
| 🗨 **Comments shortfall** | Why completed work wasn't documented; note that **manager comments count toward the STF bar** — the manager can close part of this gap themselves |
| ☆ **Exception candidate (5/6)** | The justification that lets Finance pay STF as an exception — this is the highest-value row in the sheet |
| ✖ **Canceled / Not Completed** | Why goals were cancelled: re-prioritisation, project cancelled, scope moved — and whether replacement goals were set |
| ▽ **Too few goals** | Why fewer than 8 goals were ever set — a goal-setting failure, usually shared with the manager |
| **Not Commenting** (0 self-comments) | Engagement conversation, not a compliance one |
| **Stuck (N)** | Planned goals nobody has touched or discussed — a manager-visibility gap |
| **RPI 4/6 with STF ✓** | Usually C2: manager wrote the comments, the Rocketeer didn't. Worth naming explicitly |
| Low **Supervisor Comments Month 1–3** | The manager's own accountability — pair it with the Manager Scorecard before the meeting |

### 8.5 Practical cadence

- Pull the sheet **before the completion-grace window** (final 2 weeks) so `pending` rows are still
  actionable — after that, only `comments` and exception candidates can move.
- One sheet per manager keeps the conversation scoped; use **All managers** only for the roll-up read.
- The 💰 STF Gaps CSV (§5.5) is the analyst's copy; the Focus Group sheet is the manager's copy —
  same numbers, different column set.

---

## 9. Data sources & join keys

| Thing | Source |
|---|---|
| Goals & comments | Goals spreadsheet · **RD** sheet, bucketed by each goal's Start Date |
| Employees (FTE) | Roster spreadsheet · **Data** tab (unfiltered HRIS export — company-wide, not the PS-filtered tab) |
| Crew / contractors | Roster spreadsheet · **Contractors Data** tab (Data tab wins on a name collision) |
| PTO (CPR only) | **Accumulation Cost** sheet, company-wide, joined on **Employee Number** |
| HR follow-ups | **HR Follow-Up Tracker** sheet (REX tab reads/writes here) |
| **Join key** | Normalised full name — lowercase, accents stripped, whitespace collapsed (`normName_`) |

Cache: gzipped + chunked in `CacheService`, TTL 65 min, warmer every 30 min. **Data can lag sheet
edits by up to 30 minutes — Refresh forces a live read.** Bump `CONFIG_GD.CACHE_VER` after any rule
change or the old numbers keep serving.

---

## 10. Constants to keep in sync when a rule changes

| Constant | Value | Where |
|---|---|---|
| `GOALS_ON_TARGET` | 10 | `CONFIG_GD` — On Target tier **and** RPI C1 |
| `GOALS_WATCH` | 8 | `CONFIG_GD` — Watch tier **and** RPI C3 |
| `STF_MIN_COMPLETED` | 8 | `CONFIG_GD` **+ `STF_COMPLETED_BAR_` in GDash.html** |
| `STF_MIN_CMT_GOALS` | 6 | `CONFIG_GD` **+ `STF_CMT_GOALS_BAR_` in GDash.html** |
| `STF_MIN_COMMENTS` | 8 | `CONFIG_GD` (per-goal total comments) |
| `RPI_PTS` / `RPI_CMT_GOALS` | 2 / 6 | `CONFIG_GD` |
| `RPI_CADENCE_LAG` / `RPI_CADENCE_MAX_CMTS` | 6 / 8 | `CONFIG_GD` — cap intentionally = `STF_MIN_COMMENTS` |
| `PACE_LAG_WEEKS` / `PACE_BAND_LO_PCT` / `PACE_MIN_REF_N` | 4 / 10 / 20 | `CONFIG_GD` — CPR only |
| `LEAVE_STATUSES` | maternity, parental | `CONFIG_GD` — extend as new statuses appear |
