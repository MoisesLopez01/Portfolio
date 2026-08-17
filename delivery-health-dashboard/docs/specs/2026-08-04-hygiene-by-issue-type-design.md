# Data Hygiene by Issue Type — Design

**Date:** 2026-08-04 (2026.W32) · **App:** Delivery Health Dashboard
(`delivery-health-dashboard/`) · **Status:** **BUILT** 2026-08-04, schema v17,
uncommitted. node-tests + 400 render-smoke checks green.

## Changed during the build

**Uniform columns are shown ungraded (not in the original design).** The spec said to include
Region/Team "labelled as the known org-wide gap". Rendering the real matrix showed why a label
isn't enough: with Region and Team blank everywhere, *every row* ended in two red cells and the
genuine per-type findings drowned in them — the exact "swamps the chart" failure the spec was
trying to avoid. A column identical across every type carries **no per-type information**, which
is the only thing this table exists to show.

So `typeColUniform_` mutes any such column, keeps the real percentage and miss count on screen,
and moves the severity into the footnote. It is computed from the data, not hardcoded to
Region/Team: the day PR-01 lands and Region varies by type, the column grades itself again with
no code change. Caught by rendering the table and reading it, not by a test — the same lesson as
the dark-mode invisible-bar bug (2026-08-03).

**No owner names in the matrix.** First draft footnoted "PR-01, owner Gon" and tripped the
existing render-smoke guard. Correct catch: the 2026-08-03 decision bars owner names from this
widely-read view — the prereq ID points at accountability in the requirements doc, and a standing
table of names against failures reads as a blame board. Prereq IDs stay, people don't.

## Purpose

The 🧪 Data Hygiene view answers *how much* is missing. It cannot answer **where to go and fix
it**, because every gap is reported as one org-wide percentage across all issue types pooled
together. A Services Director reading "308 of 402 epics carry a due date (77%)" has the size of
the job but no idea whether the missing 94 are Go-live epics (a real committed-date failure) or
generic container epics (a nothing-burger).

This feature adds, inside the existing Data Hygiene tab, a **field-fill matrix broken down by
`Workstream (Issue Type)`**, over two populations:

1. **Resolved** — explains the numbers currently on the cards. Diagnostic.
2. **Open** — the current and future backlog. **Actionable**: a due date added to an open ticket
   changes next quarter's On-Time rate; one added to a closed ticket is archaeology.

## The finding this is expected to surface

`readJiraRaw_` classifies epics with a substring match:

```js
var isEpic = type.indexOf("epic") !== -1;      // Code.js:1771
```

`Kick-off epic` and `Go-live epic` therefore **already sit inside the On-Time dictionary scope
and inside the Forecast denominator**, pooled invisibly with plain `Epic`. Every published epic
number is an average across three semantically different work objects:

| Live FY26 Q4 (pooled, from `dash-loop/DATA-BLOCKERS.md`) | |
|---|---|
| Epics with a due date | 308 / 402 (77%) — gate 80% |
| Epics with an estimate | 91 / 402 (23%) — gate 70% |
| Epics with estimate **and** logged time | 49 / 402 (12%) |

A `Go-live epic` almost certainly carries a real committed date; a container `Epic` almost
certainly does not. If the split confirms that, two things follow:

- **Delivery leadership gets a targeted ask** instead of "improve due dates" — fix the one type
  that gates the metric.
- **DATA-BLOCKERS #5 is partly answerable.** It currently reads: *"There are no `Milestone`-typed
  issues and no `Client Commitment` labels anywhere, so the Dictionary's 'Epic or Milestone or
  Client Commitment' reduces in practice to 'epics'."* Milestone-like types **do** exist here —
  they are named `Kick-off epic` and `Go-live epic`. That reframes the question for Bill from
  "create a Milestone type" to "is a Go-live epic the Milestone the Dictionary means?"

The matrix is what turns that from a hypothesis into a measured statement, so it must ship
before the conversation, not after.

## Decisions ratified in this design

| Question | Decision |
|---|---|
| Type vocabulary | **Measured, never assumed.** `probeDeliverySources` gains a `typeRaw` tally (mirroring the existing `regionRaw` pattern) so the real strings are logged before anything is designed against them. The matrix renders whatever types the export actually contains — no hardcoded list |
| Populations | **Both**, one toggle: Resolved (diagnostic) / Open (actionable). Open is the default — it is the half a PM can act on |
| Which fields | Due date · Assignee (Jira) · Assignee (joins roster) · Estimate · Logged time · Region · Team |
| Rows that gate nothing today | **Shown, but marked.** Under `ONTIME_SCOPE: "dictionary"` a Story's due date feeds no published metric. A `feeds` column names the metric each cell gates, and cells gating nothing today are styled as forward-looking hygiene rather than as gaps. Without this the matrix drives a Sub-task due-date campaign that moves no number |
| Region column | **Included but labelled as the known org-wide gap** (PR-01, Gon). It will read 0% for every type; unlabelled, it visually swamps every other finding |
| Estimate / logged time on non-epic types | Shown for completeness, marked as gating nothing — Forecast Accuracy is epic-grain only |
| Ordering | By **recoverable impact** = records missing the field × whether that field gates a published metric for that type. Not alphabetical, not by worst percentage: 4 missing due dates on Go-live epics outranks 400 on Sub-tasks |
| Failing keys | Each cell exports the actual issue keys as CSV, capped at `TYPE_HYG_MAX_KEYS` (500/cell). The list **is** the deliverable; a percentage is not a work queue |
| Filters | **Unfiltered**, like the rest of the Data Hygiene view — hygiene is a whole-population question |
| Visibility | **All roles.** Unlike 🔬 Data Profile / WHAT-IF (admin-only), this is a work queue for PMs and delivery leads, not a measurement-methodology surface. It carries no rates, no margin data, and no per-person judgement — only field fill on tickets those readers already own in Jira |
| Architecture | **Server + client.** The type string is discarded at ingestion today, so this cannot be client-only |

## Why this needs a server change (unlike the 2026-08-03 profiling work)

`readJiraRaw_` reads the type column and immediately collapses it to two booleans:

```js
var type = iType === -1 ? "" : normDH_(raw[r][iType]);   // Code.js:1770
var isEpic = type.indexOf("epic") !== -1;
var rec = { isEpic: isEpic, isMilestone: /milestone/.test(type), … };
```

`type` never reaches `rec`, so no client code can group by it. `rec` also lacks `key` and
`status`, both needed here (`key` for the CSV, `status` to separate genuinely-open work from
closed-but-unresolved). All three are added to `rec` — server-side only, since `jira.issues` is
never shipped to the client.

`openIssues` **cannot** be reused: it excludes epics by construction (`!isEpic`, `Code.js:1808`)
because the per-person backlog drill-down rolls epics up through their children. Open epics
missing estimates are the single biggest lever this feature exists to expose, so the by-type
aggregation runs over `jira.issues` (which holds every row, resolved or not) rather than over
`openIssues`. The backlog drill-down is left completely untouched.

## Data contract

New payload key `typeHygiene`, alongside `hygieneBuckets`:

```js
typeHygiene: {
  resolved: [ TypeRow, … ],     // resolved in the window, by ISO week
  open:     [ TypeRow, … ],     // unresolved and not closed-ish (no week — a snapshot)
}
```

```js
TypeRow = {
  iso:   "2026.W31",  // resolved rows only; open rows carry "" (a backlog is a snapshot,
                      //   not a time series — see "Open work carries no ISO week" below)
  type:  "Go-live epic",   // raw export string, trimmed; "(blank)" when the cell is empty
  isEpic: true,            // matches the same substring rule the metrics use
  n: 34,                   // records of this type in this population/week
  due: 31, assigned: 34, attr: 30, est: 28, time: 19, region: 0, team: 0,   // fill counts
  keys: { due: ["ABC-1", …], est: [ … ], … },   // FAILING keys per field, capped
}
```

`keys` holds the records **missing** the field — the work queue, not the healthy ones.

### Open work carries no ISO week

A resolved issue belongs to the week it resolved in; that is what makes `hygieneBuckets`
a trend. An open issue has no such date — bucketing it by anything (created, updated, due)
would invent a time series and let a reader "walk the history" of a backlog that only has a
present tense. Open rows therefore carry `iso: ""` and are summed whole regardless of the
selected period, with the UI stating that the open matrix is a snapshot at export time. The
period picker still drives the Resolved matrix exactly like every other surface.

### Payload cost

7 types × 7 fields × 2 populations ≈ 100 count integers — negligible. The `keys` arrays are the
only real weight; capped at 500 per field per type, and the cap is stated in the UI whenever it
bites (silent truncation would read as "that's the whole list").

## Schema version

`DH_SCHEMA_VER_` **14 → 15**. A cached v14 model has no `typeHygiene` at all, so the matrix
would render empty — indistinguishable from "your data is perfect". Must miss cleanly.

Deploy consequence: `bustDeliveryCache_` is required, which is why this ships in the **same
window** as the already-code-complete schema-v12/v13 attribution fix rather than as its own
deploy. Two cache-busting deploys in a week for one dashboard is a self-inflicted outage window.

## UI

Inside 🧪 Data Hygiene, **below** the existing gaps table (which stays exactly as it is — it is
the metric-owner's view; this is the ticket-owner's view).

```
🧬 Field fill by issue type · [ Open backlog ] [ Resolved · 2026.W31 ]

Open backlog — snapshot at export time, 214 issues. Fix these and next quarter's numbers move.

Type              n    Due date   Assignee  → roster  Estimate  Logged   Region  Team
Go-live epic     12    ✖ 25%  9   ✔ 100%    ▲ 83%  2  ✖  8% 11  ✖  0%   ✖ 0%   ✖ 0%
                       └ gates On-Time              └ gates Forecast     └ PR-01 (org-wide)
Kick-off epic     8    ▲ 75%  2   ✔ 100%    ✔ 100%    ✖ 12%  7  ✖  0%   ✖ 0%   ✖ 0%
Epic             46    ✖ 41% 27   ✔  98%  1 ▲ 87%  6  ✖ 21% 36  ✖  0%   ✖ 0%   ✖ 0%
Story            88    — 62% 33   ✔  95%  4 ▲ 88% 11  — 34% 58  — 0%    ✖ 0%   ✖ 0%
Task             52    — 55% 23   …
Sub-task         38    — 21% 30   …
Workstream        6    — 33%  4   …

✔ at/above gate · ▲ under 10 pts below · ✖ 10+ pts below · — gates no published metric today
Small grey number = records missing the field. Click it for the keys. [⬇ CSV all gaps]
```

Rules:

- **Only epic-family rows carry a live grade on Due date and Estimate/Logged.** Non-epic rows
  render `—` with the fill percentage in muted type: informational, not a gap. Which rows are
  live is derived from the same `onTimeInScope_` predicate the metric uses, never a second copy
  of the rule (the mistake `hygieneBuckets_` already documents avoiding at `Code.js:1092`).
- **Gates come from the registry**, not re-typed: On-Time 80%, Forecast 70%, assignee 95%.
- **Colour key on the surface**, per the 2026-08-04 colour-key convention already applied to
  every other coloured surface in this app.
- **Region/Team columns carry a footnote naming PR-01** so their uniform 0% is read as one
  org-wide field gap, not as seven per-type failures.
- Rows sorted by recoverable impact, descending. Ties broken by `n` descending.

## Tests

| Test | Asserts |
|---|---|
| `_test_typeHygieneBuckets_` (Code.js, run by node-tests.js) | types split; `(blank)` bucket for empty cells; `isEpic` matches `Kick-off epic`/`Go-live epic`; failing-key lists hold the MISSING records not the present ones; key cap enforced and `keysCapped` flagged; open population excludes resolved AND closed-ish status; open population INCLUDES epics (the `openIssues` divergence); resolved rows bucket by resolution week |
| `_test_typeHygieneScopeParity_` (Code.js) | every row whose `feeds` claims On-Time passes `onTimeInScope_` — the predicate is shared, not copied |
| render-smoke: type matrix | matrix renders; Open is the default population; a non-epic row shows `—` not a red grade on Due date; Region column carries the PR-01 note; the key cap is stated when it bites; the colour key is present; all four roles can see it |

## Out of scope

- **Per-issue-type On-Time / Forecast *rates*.** This ships field fill only. Splitting the rate
  by type is the obvious follow-on, and it is deliberately separate: it changes what the cards
  publish and needs Bill's answer on whether `Go-live epic` is the Dictionary's Milestone first.
- **Fixing anything in Jira.** This names the queue; PR-08 owns the discipline.
- **The `Workstream` type itself.** Listed by the user as a type; if the probe shows it is
  actually the *column* name rather than a type value, the matrix will show it or not show it
  from measured data, and no code assumes either way.
