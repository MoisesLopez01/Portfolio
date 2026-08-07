# Delivery Health Dashboard — Components and Best Use

**Audience:** anyone who has to read, quote, operate or maintain this dashboard.
**Status as of 2026-08-06 (2026.W32):** code complete, **not yet deployed**. See §7.

---

## 1. What this application is, in one paragraph

A standalone Google Apps Script web app that answers one question for delivery leadership: **how much
work is in front of us, is it growing, and can we trust the numbers saying so?** It reads Jira and
Tempo data out of Google Sheets, joins it to the staff roster, and renders a single-page dashboard.
It is *not* a project tracker and *not* a replacement for Jira — it is a weekly read of the queue and
the evidence behind it.

---

## 2. How the data flows

```
   Jira Cloud                Google Sheets                 GAS Web App
   ──────────                ─────────────                 ───────────

  ┌──────────┐   export    ┌───────────────┐   read     ┌────────────┐
  │  Issues  │────────────▶│  Jira Raw     │───────────▶│            │
  │  Bugs    │  (weekly,   │  Jira Bugs    │            │  Code.js   │
  │  Epics   │   manual)   │  Jira Arrivals│            │  (server)  │
  └──────────┘             │ Flow Snapshots│            │            │
                           └───────────────┘            │  builds a  │
  ┌──────────┐             ┌───────────────┐            │  person ×  │
  │  Tempo   │────────────▶│ Capacity      │───────────▶│  week model│
  │  hours   │             │ Tracked/Plan  │            │            │
  └──────────┘             │ NS Billable   │            └─────┬──────┘
                           └───────────────┘                  │ JSON
  ┌──────────┐             ┌───────────────┐                  ▼
  │  Roster  │────────────▶│ Data +        │───────────▶┌────────────┐
  │  (HR)    │             │ Contractors   │            │Dashboard   │
  └──────────┘             └───────────────┘            │.html       │
                                                        │(browser)   │
                                                        └────────────┘
```

**The critical property:** the export is **manual and periodic**. The dashboard is only ever as fresh
as the last export run. Nothing here is live.

---

## 3. Components

### 3.1 `Jira Backlog.js` — the exporter (v3.11.0)

Runs *inside a different GAS project* and writes the Jira-derived sheets.

| Writes | Shape | Best use |
|---|---|---|
| `Jira Raw` | one row per issue | the source for every Jira metric |
| `Jira Bugs` | one row per bug | bug counts, deliberately population-wide |
| `Jira Arrivals` | one row per ISO week | *"is the queue growing?"* — 52-week window |
| `Flow Snapshots` | one row appended per run | backlog/WIP history that cannot be recomputed later |

**Best use:** run it weekly, before looking at the dashboard. **Never** edit its output sheets by
hand — `Jira Raw`, `Jira Bugs` and `Jira Arrivals` are fully rewritten each run and your edits vanish;
`Flow Snapshots` is append-only and a hand-edit corrupts history permanently.

**Watch for:** it has **no automated tests**. Syntax is checked, behaviour is not. Every change to it
is verified by reading and by the next export's output.

### 3.2 `Code.js` — the server (schema v26)

Reads all nine sheets, joins them to the roster, computes every metric, caches the result.

**Best use:** treat it as the single source of metric definitions. `METRIC_REGISTRY_` (v3.3, 18
metrics) defines every number's name, formula, target, coverage gate, sample floor and known
deviations. If two people compute a metric differently, the registry is the tiebreaker.

**Watch for:** results are cached (~65 min TTL) and a warmer rebuilds them every 30 minutes, so the
dashboard can lag the sheets. The **↻ Refresh** button bypasses cache.

### 3.3 `Dashboard.html` — the client

Three tabs, gated by role.

| Tab | Answers | Who sees it |
|---|---|---|
| 📊 **Executive** | *Are we on target, and where aren't we?* | everyone with access |
| 🎯 **Actions** | *Who and what needs action?* | admin + viewer |
| 🔒 **Access** | — | admin only |

**The Executive tab is the "newspaper"** — eight bands, most important first:

| # | Band | What it tells you | Best use |
|---|---|---|---|
| 1 | Masthead | one-sentence verdict, assembled from ranked findings | the line you quote in a meeting |
| 2 | Backlog band | total queue, net flow, weeks-to-clear + a three-segment ruler | the headline: how deep is the queue |
| 3 | Evidence gates | *"Can we publish these numbers?"* | check **before** quoting anything above |
| 4 | Flow band | Cleared · Arrived · Lead time · On-Time (+ Forecast, Quality when measurable) | are we keeping up |
| 5 | Capacity band | recoverable hours · utilisation · people signals | what you can throw at it |
| 6 | Comparison grid | metric × Region/Team/PM/Job-family, click a column for a bullet chart | where the problem is concentrated |
| 7 | Shelf | *"Not measured this period"* + why | so silence is never mistaken for success |
| 8 | Trust detail | collapsed reconciliation notes | when a number is challenged |

### 3.4 `Security.js`

Email allowlist — admin / viewer / open-access. **Best use:** add stakeholders here rather than
turning on open access.

### 3.5 `node-tests.js` and `render-smoke.js`

Local Node test runners. **Not** pasted into the GAS project.

- `node node-tests.js` — the server's pure functions, plus cross-layer parity suites that prove the
  client's copies of shared rules match the server's
- `node render-smoke.js` — **865 checks** rendering the client against synthetic models

**Best use:** run both before any deploy. They are the only mechanical safety net this app has.

---

## 4. The metrics, and how far to trust each

### Trust and quote freely

| Metric | Why it's solid |
|---|---|
| **Inventory** (total open items) | a count, no join, no estimate |
| **Arrived / Cleared / Net flow** | counts over dates, org-wide, no assignee join |
| **Lead time** | measured from real created/resolved dates |
| **Utilisation** | hours ÷ scheduled capacity, both measured |

### Quote with the stated caveat

| Metric | Caveat |
|---|---|
| **Weeks to clear** | inventory ÷ **median** of the last 8 weeks' clearing. Robust to one holiday week, but it assumes the future looks like the recent past |
| **On-Time delivery** | measured against the Jira **Due Date, which anyone can move after the fact**. A re-baselined milestone reads as on time |
| **Cleared per person** | normalises for team size — the honest comparison — but small groups still swing on one person, so any group under 10 people is shown ungraded |

### Do not quote yet

| Metric | Why |
|---|---|
| **Forecast accuracy** | rests on roughly **one** measurable epic. A mean over one thing is not a mean. It shelves itself |
| **Quality / rework** | there is **no capture path** for rework. Zero flagged items means nobody is recording it, not that nothing was reworked |
| **Region / Team breakdowns** | the Jira fields are still largely unpopulated; the dashboard substitutes person-region from tracked hours. Real numbers, but *"by region"* does not yet mean what the Metrics Dictionary says |

### Numbers with no agreed target

**Weeks-to-clear, net flow and cleared-per-person deliberately have no target line.** Nobody has
signed a "≤4 weeks" bar, and an unratified target on a C-suite page reads as agreed the moment it
appears. They are graded against what the organisation *demonstrably does* (its operating band)
instead. Agreeing real targets is an open decision for the Services Director.

---

## 5. The single most important thing this rebuild changed

The exporter used to filter open issues with `assignee is not EMPTY`. Measured on 2026-08-06:

|  | Items |
|---|---|
| Open **assigned** — all the dashboard could see | **1,440** |
| Open **unassigned** — invisible | **1,839** |
| **True open queue** | **3,279** — 56% unowned |

Weeks-to-clear read **4.9 weeks** — essentially at target. The true figure is **11.0 weeks**. The
dashboard was describing a five-week queue as if that were the whole thing, and the largest single
block of work was the part nobody had picked up.

**That is now visible, and the unowned segment on the queue ruler is clickable.**

---

## 6. Operating notes

**Deploy order is fixed and not negotiable:**

1. `Jira Backlog.js` → save
2. **Run the export**
3. **Verify `Jira Arrivals` holds ~52 rows** — do this *before* step 4
4. `Code.js` + `Dashboard.html` → paste into the GAS project
5. Run `bustDeliveryCache_()`
6. New deployment version
7. Spot-check (below)

**Why step 3 matters:** if that tab is short, the clearing-rate median refuses to publish and the
entire headline — weeks-to-clear, the ruler, both verdict findings, the history — silently disappears,
leaving a masthead that says nothing is wrong. It fails quietly, not loudly.

**Spot-check has two halves. A number in the wrong half is a stop.**

*Must **not** move:* the four KPI cards · the signals roster · Roster join (100%, retired) · the
per-person backlog drill-down.

*Must move:* the queue hero (≈3,279 / ~11w vs ≈1,440 / ~4.9w assigned) · the 🧬 matrix's **open half**
fill rates (down) · Backlog health's unassigned count (up to ~1,839) · the unowned ruler segment
becomes clickable.

**The gaps queue will NOT move** — it computes over resolved work only. Expecting it to move would
make you fail a correct deploy.

---

## 7. Honest status

**What is proven:** 865 rendering checks and a full server suite pass; the boundary rules that decide
how dates and week labels cross between systems are enforced and tested across four timezones; the
live Jira counts were measured directly.

**What is not proven:** **no export has been run with this code, and the dashboard has never rendered
against real new data.** The exporter has no automated tests at all. The first run is the first real
test.

**Expect the exported numbers to differ slightly from the 1,839 / 1,440 above** — those came from
direct queries, which cannot reproduce the exporter's project-scoping rules. The proportions should
hold; the exact figures will not.

---

## 8. Best use, in one line each

- **Weekly:** run the export, open the Executive tab, read the masthead sentence, check the evidence
  gates before quoting anything.
- **In a review:** use the comparison grid to find where a problem concentrates, then the Actions tab
  to find who can act on it.
- **When challenged:** open the trust detail and the shelf — they exist to show what is *not* measured.
- **Never:** quote forecast accuracy or rework rate; treat "by region" as authoritative; hand-edit an
  export sheet; or read the dashboard without running the export first.
