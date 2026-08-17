# Crew Status and Availability — Design

**Date:** written 2026-08-17 (2026.W34) ·
**App:** Delivery Health Dashboard (`delivery-health-dashboard/`) ·
**Status:** **DESIGN APPROVED, NOT BUILT.** Schema 42 → 43, `bustDeliveryCache_()` required.

**Business source of truth:** the crew Employee Status vocabulary as stated by the user
(2026-08-17) and reproduced verbatim in §2. Where this page and the roster's actual status
values disagree, the roster wins and this page is wrong.

**Sequence:** this is spec 1 of 4 agreed on 2026-08-17. It ships before the Smart Split layout
restructure, because it changes numbers the restructure will be judged against. The other three
are the Smart Split, chart/table cross-filtering, and presenter mode.

---

## Why

Bench crew currently count as available capacity.

`DH_TERMINATED_` (`Code.js:3471`) gates every roster row, and `Crew - On the Bench` matches none
of its tokens. A benched contractor therefore enters the population as an ordinary active person:
their headcount lands in the pool grid, their scheduled hours land in the capacity denominator,
and every rate that divides by capacity — Availability Rate, headroom, recoverable hours — is
computed against people nobody can deploy.

This is a numbers defect, not a presentation one. It is wrong in the optimistic direction, which
is the dangerous kind: the dashboard reports more free capacity than exists, and the error grows
with the size of the bench.

A second, smaller problem sits on the same surface. Crew are hired against a contract rather than
a level, so `dhBand_` cannot parse a level token from their free-text job titles and returns
`UNKNOWN`. The pool grid renders that literally, and a row reading `CREW / UNKNOWN` invites the
reader to treat a designed condition as missing data.

---

## The status vocabulary

Seven values, and what each must do:

| Employee Status | Verdict | Today | Correct today? |
|---|---|---|---|
| `Terminated` | excluded from the population | matches `terminat` | ✅ |
| `Terminated - Mobility Relocation` | excluded from the population | matches `terminat` | ✅ |
| `Job Offer Accepted` | excluded from the population | matches `job offer` | ✅ |
| `Crew - Offboarded` | excluded from the population | matches `offboard` | ✅ |
| `Actively Employed` | available to support | no match → active | ✅ |
| `Crew - Deployed` | available to support | no match → active | ✅ |
| **`Crew - On the Bench`** | **present, but NOT available to support** | no match → active **with full capacity** | ❌ |

Six of seven are already correct. One value is wrong, and it is the only one requiring a new
state — the other six are served by the existing active/terminated binary.

### Two near-misses that are correct by accident

Both are pinned by tests in §6 because neither is obvious and both would fail silently:

- `Actively Employed` does **not** match the `inactive` token in `DH_TERMINATED_`. It contains
  `Active`, not `inactive`.
- `Crew - Deployed` does **not** match any terminated token. `deployed` shares no substring with
  `terminat|job offer|resign|left|inactive|former|offboard`.

A future edit that loosens any token — say `inactive` → `activ` — silently empties the roster.
The table test in §6 exists to make that edit fail loudly.

### The rule this spec deliberately does not question

**"On the bench" normally means free.** Treating it as unavailable is the opposite of the usual
reading, and it makes the available-capacity figure smaller — possibly much smaller.

It is written down as the user's explicit instruction (2026-08-17): a benched contractor is
between engagements and is not contracted to deliver, so their hours are not sellable and must
not be offered as capacity. That is a commercial statement, not a scheduling one.

Recorded here so the next reader who finds the availability figure "too low" understands it is a
decision rather than a bug, and takes it back to the user rather than reverting it.

---

## Model

### `p.onBench` — a sibling of `onLeave`, never a reuse of it

```js
/** Crew between engagements. Active on the roster, not contracted to deliver. */
var DH_BENCH_RE_ = /\bbench\b/i;
function dhOnBench_(status) {
  var s = String(status || "");
  return dhRosterRowActive_(s, "") && DH_BENCH_RE_.test(s);
}
```

Evaluated **after** `dhRosterRowActive_`, exactly as `dhOnLeave_` is, so a terminated row can
never acquire a bench flag on its way out.

`\b` word boundaries rather than a bare `bench`: the token is short enough to appear inside an
unrelated free-text status, and a false positive here removes a real person's capacity.

**Why not fold this into `onLeave`,** when the carve is identical:

1. **They are different facts with different owners.** Leave is an absence with a return date,
   owned by HR. Bench is a commercial gap between engagements, owned by resourcing. A dashboard
   that reports them as one state cannot answer either question.
2. **The badge would lie.** `onLeave` paints 🏖. Putting a holiday marker on a contractor who
   wants to be working is wrong on the facts and poor to project on a wall — the same sensitivity
   that governs the presenter-mode spec.
3. **Reversing it later would be lossy.** Merged, the two cannot be separated again without
   re-reading the roster.

Badge: **⏸**, tooltip *"Crew between engagements — not contracted to deliver right now. Hours are
excluded from every availability figure."*

### Where it carves

`onBench` mirrors `onLeave` at the capacity and availability sites, and **nowhere else**:

| Site | Change |
|---|---|
| `Code.js:1425` capacity fold | bench hours excluded, at the same point on-leave hours are |
| `wfSellable_` (`Dashboard.html:7395`) | `p.newHire !== true && p.onLeave !== true && p.onBench !== true` |
| Availability Rate (`wfAvailability_`) | excluded from both halves |
| Recoverable-hours pulse | excluded |
| `oppRows_` | returns null for a benched person |
| Hours cell (`Dashboard.html:2499`) | renders `on the bench`, never `0h` |
| Roster hours sort (`6521`) | ineligible, sorts last with new hires and on-leave |
| Roster detail eligibility (`8678`, `8703`) | ineligible, labelled `on the bench` |
| `personStateBadges_` | adds ⏸ |

Not carved: `personExceptions_` (`6377`). That is a triage-flag site, not a capacity one — a
benched person's data-quality flags are still real and still someone's to fix.

The server-side capacity exclusion is the load-bearing one. Everything else divides by that
denominator, so a client-only carve would leave the rates wrong while the badges looked right.

**A benched person is NOT removed from the population.** They keep their roster row, their
Workforce drill-down row, and their signals. What they leave is every figure that divides by
capacity. This is the second half of the requirement — *"show the right signals, since there are
others that are not working right now"*: the bench is visible as a fact, not as zeros dragging a
rate down.

### The exclusion is stated, never silent

The capacity tile already prints `N on leave excluded` (`Dashboard.html:4517–4522`). Bench gets
the same treatment on the same line: **`N on the bench excluded`**, counted under the active
filters.

A denominator that quietly got smaller is how a rate comes to read better than the workforce
behind it. Both exclusions are named, or neither is trustworthy.

### `CREW / UNKNOWN` → `Crewmembers`

Display only. A new helper:

```js
/** Band label for the pool grid. "UNKNOWN" is a real data-quality signal for an
    FTE — a job title we could not parse — but for CREW it is the designed state:
    they are hired against a contract, not a level. Naming it per pool keeps the
    signal where it means something and removes it where it does not. */
function wfBandLabel_(pool, band) {
  return (pool === "CREW" && band === "UNKNOWN") ? "Crewmembers" : band;
}
```

The band **key** is untouched. `WF_BAND_ORDER_` sorting, `p.cell`, `dimMatch_(p, "level", …)` and
every bucket join keep operating on `UNKNOWN`. Only `renderWfGrid_`'s band cell changes.

`WF_BAND_DESC_.UNKNOWN` already reads *"No level token in the job title — common for crew, who
are hired against a contract rather than a level."* This change makes the grid say what its own
tooltip already knew.

An FTE landing in `UNKNOWN` still renders `UNKNOWN`, deliberately: there it means a job title the
classifier could not read, which is a gap somebody should close.

---

## Decisions taken, with their trade-offs

### 1 · Bench is carved from capacity, not from the population

**Alternative rejected:** treat bench like `Terminated` and drop the rows entirely.

Dropping them makes the availability figure correct and the workforce invisible. A resourcing
lead needs to see that six people are benched — that is the number that starts the conversation
about why. Carving capacity while keeping the row answers both questions; dropping the row
answers one and hides the other.

### 2 · One regex, not a status allowlist

**Alternative rejected:** enumerate the seven statuses and match exactly.

An allowlist fails closed on an eighth value nobody told us about — a new crew status would land
as "available" or vanish, depending on the default. The existing codebase convention is
token-matching (`DH_TERMINATED_`, `DH_LEAVE_RE_`), and consistency is worth more here than
precision against a list that will change. §6's table test is what keeps the tokens honest.

### 3 · The label is per-pool, not global

**Alternative rejected:** rename `UNKNOWN` to `Crewmembers` everywhere.

`UNKNOWN` carries real information for an FTE. A global rename would relabel a data-quality gap
as a workforce category and remove the only prompt to fix it.

---

## Test coverage

1. **The status table.** All seven values from §2, each asserting active/excluded — including the
   four already correct, so a future edit to `DH_TERMINATED_` cannot break them unnoticed.
2. **The two near-misses.** `Actively Employed` is active; `Crew - Deployed` is active. Named
   individually, because both survive today by accident of substring and a looser token would
   silently empty the population.
3. **Bench carve.** A benched person: absent from `wfSellable_`, absent from both halves of
   Availability Rate, absent from recoverable hours, present in the Workforce drill-down, hours
   cell reads `on the bench` rather than `0h`.
4. **The stated exclusion.** With benched people in scope, the capacity tile renders
   `N on the bench excluded` with the correct N under the active filters.
5. **Bench ≠ leave.** A benched person carries ⏸ and not 🏖, and `p.onLeave` stays false — the
   two states are separable in the payload.
6. **Label scoping.** `CREW|UNKNOWN` renders `Crewmembers`; a non-crew `UNKNOWN` band still
   renders `UNKNOWN`; the band key is unchanged in `p.cell` and in the `level` filter.

---

## Deploy

1. `DH_SCHEMA_VER_` **42 → 43** — `p.onBench` is a new payload field.
2. `bustDeliveryCache_()` — a cached v42 model serves bench crew as available capacity, which is
   precisely the bug being fixed. The schema bump alone is not enough; the cache must be busted.
3. Paste `Code.js` and `Dashboard.html` into the GAS project.
4. **Expect the availability figure to fall.** That is the fix landing, not a regression. Note
   the before/after so the size of the correction is on the record.
