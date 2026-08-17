# Delivery Health — PM-owned work view + due-date urgency signal

**Date:** 2026-08-11 (2026.W33)
**App:** `delivery-health-dashboard`
**Status:** Design approved — ready for `writing-plans`
**Related:** GTT-605 · `2026-08-10-dh-actions-compliance-feedback` · `2026-08-04-hygiene-by-issue-type-design`

---

## 1. Why

Two asks from the same conversation, both about due dates, both aimed at
now-and-forward behaviour rather than history:

1. **Managers cannot read urgency in the People drill-down.** The per-person open
   backlog lists a due date as a bare week key. Nothing separates a commitment
   that lapsed in June from one landing on Friday.
2. **PMs own epics, and an epic without a due date is an uncommitted
   commitment.** Nothing on the dashboard reports that per PM, and nothing shows
   what a PM's projects contain in the backlog right now.

These ship as **two independent units** (§7). The first is client-only and can
land immediately; the second changes the payload.

---

## 2. The constraint that shaped this

**PMs are structurally absent from the Delivery Health population.**
`DH_BY_DISCIPLINE_` maps `"15|Project Management" → ["GOVERNOR", "PMO"]`
(`Code.js:3624`), family 15 is not in `CONFIG_DH.TRACKING_FAMILIES`
(`Code.js:91-93`), and a live assertion *requires* `PMO` to appear in
`wf.scope.absentPools` (`Code.js:9926`). The People signals roster therefore
cannot show a PM, by design.

A person-grained approach to "PM-owned work" would have to either weaken that
assertion or invent a second roster. **Neither is necessary**, because the
attribution below never touches the roster.

**Consequence that stands:** PMs are a separate population graded on their own
bar. Nothing here rolls a PM into a published delivery rate.

---

## 3. Decisions

| # | Decision | Chosen |
|---|---|---|
| D1 | Ticket → PM attribution | **Project key → PM**, from Tempo |
| D2 | Surface | **New 🗓 PM tab**; existing filter renamed **"Worked with PM"** |
| D3 | Month window | **Overdue carry-in + due this month**; undated always shown |
| D4 | Grading | **Two separate bars** — owned vs contained, never averaged |
| D5 | Due bands | **3 RAG bands at ISO-week precision** + undated |
| D6 | Undated colour | **Red where the list is started-work-only, grey where it is not** |

---

## 4. Feature 1 — Due-date urgency bands

### 4.1 Bands

| Band | Rule | Meaning |
|---|---|---|
| 🔴 red | due week **earlier** than the current ISO week | overdue |
| 🟠 amber | due week **is** the current ISO week | act now — still doable |
| 🟢 green | due week **later** than the current ISO week | future |
| ⚪ / 🔴 | no due date | see §4.3 |

**Week precision, not day precision.** Day precision would contradict the rule
the managers ratified on 2026-08-10: *the current week is compliant*. Every
reporting surface in this app is weekly; a date is late only once the week it
was committed to has ended.

### 4.2 Mechanics

`it.due` already ships as a week key (`"2026.W33"`) from `weekKeyFromDate_`
(`Code.js:5412`), and the current week already ships inside `meta.gridWeeks` as
the entry with `status === "now"` (`Code.js:1102`). Both values are already in
the payload, so nothing new is sent.

> `meta.headlineIso` is the **last completed** week (`shift(-1)`,
> `Code.js:1106`) and is the wrong anchor — using it would paint the current
> week red.

**The comparison MUST be numeric, not lexicographic.** `isoWeekNum_`
(`Code.js:1062`) returns an unpadded integer, so `weekKeyFromDate_` emits
`"2026.W9"` — not `"2026.W09"`. Under a string compare `"2026.W9" > "2026.W10"`,
so **weeks 1–9 of every year would rank as later than weeks 10–53** and genuinely
overdue work would paint green for the first nine weeks of each year. A bug that
is invisible in August and wrong every February is the worst kind this dashboard
can ship.

`isoWeekBefore_` (`Code.js:1337`) already parses `^(\d{4})\.W(\d{1,2})$` into
year and week integers for exactly this reason. The client comparator follows
that precedent:

```js
/** -1 | 0 | 1 comparing two "YYYY.WN" keys; null when either is unparseable.
    NUMERIC on purpose — week keys are not zero-padded (see spec §4.2). */
function isoCmp_(a, b) {
  var pa = /^(\d{4})\.W(\d{1,2})$/.exec(String(a || ""));
  var pb = /^(\d{4})\.W(\d{1,2})$/.exec(String(b || ""));
  if (!pa || !pb) return null;
  var ya = +pa[1], yb = +pb[1];
  if (ya !== yb) return ya < yb ? -1 : 1;
  var wa = +pa[2], wb = +pb[2];
  return wa === wb ? 0 : (wa < wb ? -1 : 1);
}
```

New client helper `dueBand_(dueIso, nowIso, undatedIsGap)` builds on it and
returns a class name directly — `"sigBad" | "sigWarn" | "sigGood" | ""` — because
`.sigGood/.sigWarn/.sigBad` are already bound to `--c-good/--c-warn/--c-bad`
(`Dashboard.html:305`). Applied at `Dashboard.html:7363`, inside
`rosterDetailRow_`, where `it.due` currently renders raw. **No new palette and no
new CSS.**

### 4.3 Undated is per-surface, and that is deliberate

The People drill-down is fed by `openIssues`, which **already excludes
unstarted-undated tickets** by the managers' rule (`Code.js:5132-5153`). Every
undated row reaching that table is therefore *started work carrying no due
date* — precisely what `BACKLOG_SIGNALS_.undated` grades `kind: "bad"`
(`Code.js:2483`) and what renders red today via `sigBad`.

- **People drill-down → red.** Grey would silently downgrade a live signal.
- **🗓 PM tab → grey.** That list does contain unstarted work, which is not a
  commitment yet and must not be coloured as a failure.

`dueBand_` documents this in-line so a later reader does not "fix" the apparent
inconsistency. The band *rule* is one thing; which band undated earns depends on
whether the surface can contain unstarted work.

### 4.4 Parity requirement

The red band asserts the same claim as the server's `dhOverdue_`
(`Code.js:2434`, `due < dhWeekStart_(now)` — already week-grained). Two
implementations of one rule is the drift trap that produced the billable-split
bug and the confidence-gate bug. A parity test joins `_test_clientParity_` and
`_test_confidenceParity_` in the same family (§8).

---

## 5. Feature 2 — 🗓 PM tab

### 5.1 Attribution: project key → PM

Three pure server-side functions in `Code.js`, each independently testable:

**`pmByProject_(tempoRows)` → `{ "GTT": "Dana Reyes", … }`**
Folds rows already parsed by `readTempoGrid_` (`Code.js:3475-3491`), which
carries `key` (the **project** key — `Code.js:3449` is explicit that it stays
project-grained) beside `pm` (that project's lead) on every row. Time-off rows
never contribute, matching the existing guard at `Code.js:5539`.

*Multi-PM projects:* across the 52-week export window
(`CONFIG_DH.WEEKS_PAST_DEEP = 52`) a project may name more than one PM.
**Last-seen wins** — the row in the most recent week carrying hours — because
this view is about now-and-forward ownership. The count of superseded PMs is
returned and reported, so an overwrite is never silent.

**`dhProjectOf_(key)` → `"GTT"`**
`String(key).replace(/-\d+$/, "")`. A regex rather than `split("-")[0]` so an
unfamiliar key shape degrades predictably instead of truncating at the first
hyphen.

**`pmOwnedWork_(jira, pmByProject, today)` → rows**
One pass over `jira.issues`; attributes each issue, applies the §5.3 window,
returns one row per PM plus the `(No PM)` bucket.

**Why this routes around §2:** attribution is project-grained, so no PM ever
needs to exist on the roster. A PM with zero roster presence still gets a row.

**The honest limit, stated on the tab:** a project with no hours in the Tempo
export has no PM row, and its issues land in `(No PM)`. That is a **coverage gap
with a name**, not an empty state — the same discipline as `Unassigned` vs
`Other` for Region. It reuses the existing `UNTAGGED_.pm` sentinel
(`Dashboard.html:1324`) and sorts last regardless of size.

### 5.2 Layout

Fifth entry in `VIEWS` (`Dashboard.html:778`), label **`🗓 PM`**, pane
`viewPm`, `roles: ["admin", "viewer"]` — matching Actions and Workforce, since
the tab carries the same tier of detail.

> 🧭 is already taken by Workforce (`Dashboard.html:789`). 🗓 is chosen because
> the tab is fundamentally about dated commitments.

Role gating is enforced **inside** `switchView_`, not only by hiding the button —
the standing pattern in this app and in the PS dashboard.

One row per PM, sorted worst-first by undated epic count:

```
Dana Reyes
  OWNS   epic due dates   ▰▰▰▰▰▰▰▱  9/12   bar 100%
         🚩 3 epics undated — GTT-41, GTT-88, GTT-91

  IN PROJECT  task/sub-task readiness  ▰▰▰▰▰▱▱▱ 62%
              (team hygiene — context, not Dana's grade)
```

**Bar 1 — OWNS: epic due-date fill.** A per-PM slice of the logic in
`epicDueAudit_` (`Code.js:2650`): open epics only (`typeHygOpen_`), `dhHasDue_`
as the predicate, keys listed and capped at `EPIC_DUE_MAX_KEYS_` (200). Graded
against the **100% bar** the org already ratified. This is the PM's number.

**Bar 2 — IN PROJECT: task/sub-task readiness.** The `ready` share over
non-epics in the PM's projects, computed from the existing `BACKLOG_SIGNALS_`
table (`Code.js:2469`), already documented there as *"the share of the backlog
that is actually plannable"* — dated **and** estimated **and** linked **and**
fresh. **No new compliance definition is introduced.** Labelled as team hygiene
and never averaged into bar 1.

**Neither bar is windowed by §5.3.** Both measure the standing state of all open
work the PM owns; the month window scopes the **drill-down item lists**, not the
denominators.

> This is load-bearing, not a detail. Windowing bar 1 by due date would make it
> **structurally 100%**: an undated epic has no date and so cannot fall inside a
> date window, which would leave a denominator containing only dated epics —
> a bar that can never report the very gap it exists to report. Bar 2 inherits
> the same trap through `ready`, which has `dated` as a conjunct.

**The two bars are never combined into one number.** A blended score would grade
a PM on fields other people fill, and could not say which half is the problem.

Predicates are **reused, not re-derived**: the 🚩 audit on Actions and this tab
must never disagree about what "undated" means, or one of them is wrong and no
reader can tell which.

### 5.3 Month window

Window = **overdue carry-in + due in the current calendar month**. It scopes the
**drill-down item lists** on the tab. It does **not** scope either bar (§5.2).

```
AUG 2026 window
  🔴 due 2026.W28 · carried from JUL   ← kept
  🔴 due 2026.W32                      ← kept
  🟠 due 2026.W33 (current week)       ← kept
  🟢 due 2026.W35 (still AUG)          ← kept
  ⚪ undated                            ← always shown
  ── out of window ──
     due 2026.W40 (OCT)                ← hidden
```

A strict month filter would let a commitment escape by aging out of its own
window: the longer something slips, the less visible it becomes. A March epic
still open in August is the most actionable row on the page.

**Undated work is shown regardless of the window** — it has no month, so it
cannot be windowed, and it is the entire point of the 🚩 audit. The window is
named in the header strip, the way the Data Hygiene view names its own.

### 5.4 The naming collision

`STATE.pm` already exists and means *"people who worked on a project this PM
leads"* (`Dashboard.html:1390` via `dimMatch_`; scope chip at `:1812`). The new
tab means *"the tickets this PM owns"*. The filter row sits **above** the tabs
(`Dashboard.html:607`), so both meanings would be on screen simultaneously.

**Resolution:** the existing dropdown is renamed to what it actually does —
**"Worked with PM"**. Its behaviour, `STATE` key and tooltip caveat are
unchanged; only the visible label moves. The word "PM" on the new tab can then
mean ownership, unambiguously.

---

## 6. Out of scope

- Any PM-level rollup into a published delivery rate (§2).
- Changing `TRACKING_FAMILIES`, `DH_BY_DISCIPLINE_`, or the `absentPools`
  assertion. PMs remain structurally absent from the delivery population; this
  tab reads *work*, not *people*.
- Region/Team crossing on the PM tab — still blocked upstream on PR-01.

---

## 7. Two shipping units — do not bundle

| | Files | Schema | Cache |
|---|---|---|---|
| **F1 Due bands** | `Dashboard.html` only | none | none |
| **F2 🗓 PM tab** | `Code.js` + `Dashboard.html` | **37 → 38** | `bustDeliveryCache_()` **required** |

F1 can ship the moment it is built. F2 adds `pmOwned` to the payload; a v37
cache entry has no such key, so without the bump the tab renders empty against a
stale model — the exact failure the schema counter exists to prevent.

Deploy order for F2: `Code.js` → `Dashboard.html` → `bustDeliveryCache_()`.
No exporter change: every column this design reads is already exported and
already parsed.

---

## 8. Tests

**`node-tests.js`**

- `pmByProject_` — last-seen wins on a multi-PM project; time-off rows excluded;
  superseded count reported.
- `dhProjectOf_` — `GTT-605 → GTT`; a malformed key degrades without throwing.
- `pmOwnedWork_` — overdue carry-in kept; next-month excluded; undated present
  regardless of window; `(No PM)` populated from a project absent in Tempo.
- **Bars are unwindowed (§5.2).** A PM whose only undated epic sits outside the
  month window still reports below 100% on bar 1 — the assertion that would fail
  if a later change let the window reach the denominators.
- **`_test_dueBandParity_`** — `dueBand_` red agrees with `dhOverdue_` across a
  swept set of due/now week pairs, including year boundaries (§4.4).
- **`isoCmp_` single-digit weeks (§4.2).** `isoCmp_("2026.W9", "2026.W10") === -1`
  — the assertion a lexicographic implementation fails. Swept across W1–W53 so a
  regression cannot hide in the part of the year nobody tests in August.

**`render-smoke.js`**

- The two bars render as two claims; no averaged PM number appears anywhere.
- `dueBand_` emits the right class per band.
- Undated is red in the People drill-down and grey on the PM tab. This is the
  one case where a bare substring assertion would pass wrongly, so it anchors on
  the **class name**, not on a glyph or a percentage.
- `(No PM)` renders as a labelled bucket, sorted last.

Fixtures look people and PMs up **by name, not by position** — concurrent
sessions grow these fixtures.

Both node files keep their "⚠️ DO NOT PASTE THIS FILE INTO THE GAS PROJECT"
banners. **Three files go to GAS, not five.**

---

## 9. Open items

None blocking. Two to confirm on live data during implementation, neither of
which changes the design:

1. **How many projects show more than one PM** across the 52-week window. If the
   count is high, the last-seen rule deserves a visible note on the tab rather
   than only in the payload.
2. **The size of the `(No PM)` bucket.** If it dominates, that is a finding
   about Tempo project coverage worth taking upstream — not a reason to change
   the attribution.
