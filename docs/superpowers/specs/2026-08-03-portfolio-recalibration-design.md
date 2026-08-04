# Portfolio Recalibration — Design

**Date:** 2026-08-03 (2026.W32)
**Status:** Approved by Moises (design dialogue, this session)
**Scope root:** `docs/superpowers/gas-portfolio/` (site) + new `docs/superpowers/gas-portfolio-demos/workforce-demand/` (flagship demo)

## Goal

Recalibrate the portfolio so a technical recruiter's first impression matches the real
level of the work: senior workforce-analytics engineering worth a $100K+ hire. The
canonical surface is the **GAS web app deployment** (Netlify is secondary). The current
site undersells: the four "live demos" are browser slider toys disconnected from real
code, the strongest real work (three internal dashboards, ~24K lines, 250+ tests) is
invisible, and several credibility leaks (broken build, dead RAG claim, inflated stack
tags, contradictory numbers) actively damage trust.

Approved shape: **Approach A — surgical recalibration.** Fix credibility leaks first,
reposition around workforce analytics, then add one sanitized live flagship + two deep
case studies. Keep the existing dark ink theme and site structure.

## Decisions ratified during design

| Question | Decision |
|---|---|
| Primary surface | GAS web app link (Netlify build fix included but secondary) |
| Demo depth | One flagship live (Demand dashboard, offline/CSV mode) + CompDash and PS Contribution as case studies |
| Existing simulators | Keep Pipeline Risk + Team Scoring (real server-side AI calls); fold TCC Forecast + Salary Benchmark into their project modals |
| Positioning | Workforce analytics lead, AI woven in as the differentiator |
| Execution approach | A — surgical recalibration (not a demo-shell rebuild) |

## Section 0 — Data protection (HARD RULES, gate everything)

The user's explicit instruction: *"be careful to give out real data from the company…
we need to blind myself from any possible problem, I sell the solutions and the
approaches taken."* These rules override convenience everywhere:

1. **Zero company data reaches anything a recruiter can reach.** No real employee
   names/emails, no live spreadsheet/Drive/deployment IDs, no real headcounts, revenue,
   utilization, comp, or attrition figures. Case-study numbers are either engineering
   facts about the code (line counts, test counts, cache timings) or clearly
   approximate/rounded framing ("a ~200-person services org"), never internal metrics.
2. **The three internal production apps are never modified and never deployed publicly.**
   All public material comes from sanitized copies or synthetic renders.
3. **Screenshots: never production pixels.** Every image is captured from a
   synthetic-data render of a sanitized copy, carrying the fictional brand. If a
   synthetic render can't be produced for a view, that view gets no screenshot.
4. **Fictional brand throughout demo + case-study surfaces.** ServiceRocket, Rocketeer,
   Orbe, rocketeers.atlassian.net, SRSO-*, and internal job codes never appear in the
   demo app, dataset, screenshots, or case-study copy. Internal system names are
   generalized in public copy (Tempo → "time-tracking system", NetSuite → "ERP",
   Small Improvements → "performance-review tool", RCR/QTA → descriptive phrases).
   Exception (pre-existing, user-ratified 2026.W29): the employer name in Donna's
   work-history bio may remain — employment history is public; company *data* is not.
5. **Automated leak gate before any deploy:** a grep sweep script over every deployable
   artifact (site source, demo source, dataset, built output) for: the 7 known live
   spreadsheet IDs, the 2 Drive asset IDs, the known real emails, `servicerocket`
   (case-insensitive, excluding the ratified bio lines), `rocketeer`, `orbe`, `SRSO`,
   `atlassian.net`, the live `/exec` deployment URL, and `customfield_`. Any hit = no
   deploy. The sweep list lives in the repo so it grows as new sensitive tokens appear.
6. **Known live IDs to purge from anything copied** (survey findings): spreadsheet IDs
   in `PS Contribution Report.js:12,13,22`, `CompDash\Code.js:17,18,43,48`,
   `project-demand-dashboard\Code.js:13,32`; Drive IDs in `PS Dashboard.html:14,1269`;
   3 real emails in `project-demand-dashboard\Security.js:46-50`; the `/exec` URL in
   `PS Dashboard.html:10031`. (These stay as-is in the internal apps — they are only
   scrubbed in copies.)

## Section 1 — Positioning & information architecture

### Hero (`index.html`)

- **Headline:** workforce-first. Default (used unless changed during spec review):
  *"I build the workforce analytics that leadership actually opens."* It must name the
  domain, not generic "data".
- **Sub-line:** the three solution areas — resourcing/demand, compensation health,
  contribution/performance — with AI/LLM engineering as the differentiator.
- **Metric cell-range (A1:D1 device kept), true numbers only:**
  ~24K lines of production dashboard code · 250+ automated tests (242 CompDash + 12
  pipeline + PS `_test_` suites) · years of experience including 5+ yrs contact-center
  WFM · the existing "90% avg. process automation" metric kept only if its footnote
  methodology re-verifies, otherwise dropped (no replacement invented). Exact figures
  verified against code at implementation time.
- **Hero terminal:** rewritten to narrate a truthful run of the *demand* pipeline
  (capacity net of PTO + public holidays, ±2σ control band, warm-cache timing) —
  every line true of the flagship demo below. No "Gemini narrative" line (Gemini is
  claimed via the PS case study, not the portfolio runtime). Fictional-brand data only.
- **PROOF rotator:** every claim backed by code or by a case study; drop "9 LLM systems
  live (Gemini · Claude)" unless re-derived truthfully.

### Projects section

- **New domain "Workforce Analytics", ordered first**, containing three new `PROJECTS`
  entries: `workforce-demand` (flagship, `demo: live`), `comp-health` (case study),
  `ps-contribution` (case study). Existing DOMAINS reorder behind it.
- `sales-pipeline-etl` promoted (better impact line than "Runnable + tested"; surfaces
  the 12-test, one-command story).
- TCC Forecast + Salary Benchmark simulators move out of the demo bar into their
  project modals as "try the model" widgets.
- **Single source of truth:** domain grid order, "N projects" heading count, hero
  project count, and Donna's grounding all derive from `PROJECTS`. No hand-counted
  numbers anywhere.

### Truth sweep (copy)

Every stack/capability claim on the page must have a code path or case study behind
it. Remove: GPT-4, Claude-as-runtime, "Embeddings", the always-on "RAG" pill (rename
to "Grounded" — keyword retrieval is what it is; greeting updated to match). Gemini
becomes claimable via the PS case study (`callGeminiNarrative` is real). Footer and
About tags re-audited under the same rule.

## Section 2 — Flagship live demo (sanitized Demand dashboard)

A copy of `docs/superpowers/project-demand-dashboard/` deployed as its **own public
GAS web app reading a generated synthetic demo workbook**.

> **Mechanism amendment (2026-08-03, during planning):** the app's "offline/CSV"
> path turned out to be a degraded fallback — it hides the capacity/utilization
> panel (the ±2σ band) and drops holiday data, exactly the features being
> showcased. The full experience requires `getDemandData()` reading sheets. The
> demo therefore ships a checked-in `buildDemoWorkbook()` seeder that generates
> ONE synthetic Google Sheets workbook (all 7 tabs, deterministic, anchored on
> the run date) and points the sanitized copy's `CONFIG` at it. The
> data-protection guarantee is unchanged: zero company sheets, zero company data.

- **Source:** new folder `docs/superpowers/gas-portfolio-demos/workforce-demand/`
  (`Code.js`, `Dashboard.html`, `Security.js`, README). Internal app untouched.
- **Sanitization spec:** every live spreadsheet ID in the copied files (2 in the
  demand app: `Code.js:13,32`) → obvious placeholders (`DEMO_…`), and the leak gate
  still checks for all 7 known IDs; real emails → commented placeholder pattern (as
  PS/CompDash `Security.js` already do); brand vocabulary → the fictional brand
  **"Helix Delivery Group"** (banner marks it fictional); eyebrow "ServiceRocket ·
  C-Suite Resourcing Review" → "Helix Delivery Group · Resourcing Review"; palette
  may stay (it's a design asset) with brand tokens renamed.
- **Access model:** open access, no allowlist (personal public demo per
  gas-project-standards: personal + no security). A persistent, visible banner:
  *"Live demo — synthetic data, fictional company."* Badge remains `○ Offline / CSV`.
- **Synthetic dataset:** a deterministic, seeded `buildDemoWorkbook()` GAS function
  (checked in — it is itself a portfolio artifact) generates one demo workbook with
  all 7 tabs (Planned Time Tempo, Tempo Tracked Time, PH, Capacity Tempo, Jira Raw,
  Data, Contractors Data): ~27 fictional people, 4 regions (incl. ANZ for the
  38h/7.6h rules), 23 ISO weeks anchored on the run date, seeded PTO + public
  holidays, billable/internal mix — tuned so every panel demonstrates: 🏖 tooltips
  fire with named (fictional) holidays, the ±2σ band renders, every question
  chip returns hits, the billable-evidence panel classifies, the CSV export works.
  No value derived from real company data.
- **Portfolio integration:** demos section led by a flagship hero card — synthetic
  screenshot, three wow bullets (holiday-aware capacity model · ±2σ SPC control band ·
  30s→2s gzip-chunk cache story), "Open live demo →" to the demo app URL. Pipeline
  Risk + Team Scoring cards sit below it.

## Section 3 — Case studies (CompDash + PS Contribution)

Upgraded project-modal content type: **problem → architecture sketch → proof points →
screenshots → engineering stories.** Copy sells the solution and the approach; employer
specifics and internal metrics excluded per Section 0.

- **CompDash leads with:** 242 automated assertions + render smoke harness in a GAS
  project; the 4-tier anchor-resolution model ("no anchor → excluded; coverage is a
  headline, not a footnote"); server-side payload redaction (restricted profiles
  stripped before the payload leaves the server — devtools-provable); statistical
  honesty rules (small-n suppression, like-for-like YTD).
- **PS Contribution leads with:** the gzip-chunked CacheService story (silent >100KB
  failure → multi-minute cold loads → gzip ~10× + 90KB chunks → megabyte ceiling,
  30s→2s); adaptive Team Radar (axis count follows grouping level); 4-role access
  model with roster-derived manager scoping ordered *before* the open-access fallback;
  Gemini exec-brief with prompt-allowlisting and five distinct handled failure modes.
- **Screenshots:** Demand images come free from the synthetic flagship. CompDash uses
  its existing synthetic-payload render harness extended to a browser render; PS gets
  a minimal synthetic feed for the views worth capturing. Any view that can't be
  synthetically rendered ships without a screenshot rather than with a redacted real one.
- Case-study copy lives in `PROJECTS`, so modals and Donna stay in sync automatically.

## Section 4 — Credibility fixes (phase 1, before anything new ships)

1. `escHtml` (`JavaScript.html:9-15`): restore the missing `>` escape.
2. Intent classifier (`_lib/intent.js` + GAS `detectIntent_`): portfolio signals
   checked first; overbroad tokens (`role`, `team`, `company`, `work`, `time`, `call`,
   `connect`, `available`, `remote`, `startup`) removed from offer/meeting lists.
3. One project database: `Code.js PROJECTS` is canonical; the stale
   `PROJECT_DATABASE` copies in `JavaScript.html` and `Code.js
   retrieveProjectContext` are generated from it or deleted; invented projects and
   phantom metrics ("23% slippage", "$2.1M") removed.
4. Number reconciliation: one canonical stats object feeds hero counters, section
   headings, terminal, PROOF rotator, and Donna.
5. Contact: fix or drop the mangled phone (`+1 (503) 7571-9264`); remove the
   pre-filled `Salary range:` mailto field (contradicts Donna's no-salary rule).
6. Dead references: `ps-dashboard` demo tab + RAG remnants, README link to deleted
   `ai-salary-benchmarking`, `ScrollNudge` hints naming nonexistent demos,
   `DemosSection.init` stale comment.
7. `build-static.js`: `Code.gs` → `Code.js`; drop the deleted `_shot_hero.png` copy
   step; `rpc.js proxyGroqChat` reads `args[3]` (ragContext) so the deployed behavior
   matches the GAS one.

## Verification

- **Leak gate (Section 0.5) — hard gate on every deploy.** Run over site source, demo
  source, dataset, and built output.
- `node build-static.js` completes; output loads.
- Donna regression: ~10 recruiter-style questions ("What was your role on that team?",
  "Which company was this at?", "Walk me through the TCC forecasting approach") — none
  may deflect to LinkedIn; salary questions still route to Alex.
- Grep sweep for banned stack claims (GPT-4, Claude-as-runtime, Embeddings) returns
  zero.
- Manual QA checklist on the GAS deployment: every flagship view renders from the
  synthetic CSV, every question chip and 🏖 tooltip works, every project modal opens,
  both AI simulators complete a server round-trip, counts agree everywhere.
- Existing tests still pass (`node-tests.js` in the demand copy; site has none — the
  Donna regression + leak gate scripts are the new automated coverage).

## Out of scope

- GitHub repo curation beyond removing dead links from README/site (user: "I do not
  care about the github thing" for now). `repoUrl` buttons stay only where the target
  exists.
- Netlify/PlanetScale production setup and hosting decisions (build must merely work).
- Restyling the ink theme.
- Any behavior change to the three internal production apps.
- Donna scope changes (no-salary rule and Q&A-only behavior unchanged).

## Phasing

1. **Phase 1 — Stop the bleeding:** Section 4 fixes + truth sweep. Deployable on its own.
2. **Phase 2 — Reposition:** Section 1 hero/projects/IA changes.
3. **Phase 3 — Flagship + case studies:** Section 2 demo app + dataset + leak gate,
   Section 3 case studies + synthetic screenshots.

Each phase ends with the verification steps that exist by that point; Phase 1 must be
complete before Phases 2–3 deploy.
