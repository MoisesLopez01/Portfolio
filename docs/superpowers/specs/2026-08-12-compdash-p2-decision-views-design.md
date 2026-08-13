# CompDash P2 — Decision Views (Handoff Pack)

**Date:** 2026-08-12 (2026.W33) · **Design reference:** `mocks/compdash-decision-mock-v5.html`
**Verdict on reuse:** Rebuild the VIEW layer + add NEW server engines. Do NOT
greenfield — the data layer, anchor model, Security.js, cache, BUILD_ contract,
deploy pipeline and all three test harnesses carry over untouched in spirit and
mostly untouched in code.

---

## 1. Reuse vs new — the boundary

### Keep as-is (do not rewrite)
- `Code.js` data readers (Roster `Data`, `RD`, `Small Improvements RD`,
  `Compilation`), header resolution, `CD_*` Script Property overrides
- Anchor model in `Position.js` (T1 title peers → T2 market row → T3 level
  cohort → excluded; `SMALL_GROUP_MIN = 3`)
- `Security.js` allowlists + `stripRestrictedPayload_` (remember: it does NOT
  recompute `g.count`)
- Cache (`cd_v<N>_all`, gzip-chunked, 65-min TTL, `bustCompCache_()`)
- BUILD_ contract, clasp allowlist deploy, `tests/run_tests.js` +
  `parse_html.js` + `render_smoke.js`
- Engines: `buildEquity_` (feeds an Overview KPI only), `buildSignalsForEmp_`,
  `buildContribByEmp_` (Check L inputs), `priorityScore_`

### New server engines (new files, one responsibility each)
| File | Computes | Key rules |
|---|---|---|
| `RemotePull.js` | per-person `localRatio`, `remotePullRatio`, `personSignal` | Signal governed by remote-pull, never internal percentile alone. States: COMPETITIVE ≥ 1.0 · STABLE 0.85–1.0 · NORMAL (below internal median but ≥ 0.85 remote) · RISK < 0.85 · RISK_IMMEDIATE = RISK + high performer (SI streak ≥ 4 across last 3–4 completed reviews OR on acceleration track). NORMAL can never escalate alone. Fallback to local market with an explicit `benchScope:"local-only"` label when no remote set exists for the role × country. |
| `Acceleration.js` | 6·9·6·9·6 cadence state per opted-in I3/I4 | Checkpoints at months 6, 15, 21, 30, 36 from `trackStart`. `readyNow` = checkpoint reached AND SI streak ≥ 4·4·(4). `overdue` = checkpoint passed > 60 days without a review event in RD. Cadence offsets, streak length and SI gate in CONFIG. Signal schedules a review; Check01 governs the outcome. |
| `Retention.js` | cohort rolling 4q rate, slope, ×baseline, FY25/FY26 marks, focus-group trigger | Trigger requires BOTH: market mark (≥ 1.5× baseline, 2 consecutive quarters, ≥ 4 exits) AND historical mark (above the cohort's own FY25 AND FY26 rates). Fails historical → "noted, not alarmed". n-exits < 4 → watch ceiling. Emits the evidence pack (dept/location/employee layers, driver, tenure distribution, leavers-vs-stayers compa). |
| `GrowthEvents.js` | promotions + adjustments per 100 Rocketeers per cohort, FY27 annualized vs FY26 actual | Events detected from RD (`PROMO_RE` + adjustment ChangeTypes). Powers the Grow-the-Tree panel and the retain-vs-rehire card (retainCost = Σ gap-to-0.95 for flagged; rehireExposure = 0.75 × TCC of RISK/RISK_IMMEDIATE people). All constants in CONFIG, echoed in `meta`. |

### Client: rebuild renderers per the v5 mock
Four views — Executive Brief (decision strip · signal map · growth commitment ·
decision cards), Compensation Position (coverage header · acceleration group
table · single-profile stepper · cohort table), Retention Analytics (trend table
with historical gate · opportunity decomposition · focus-group queue), People
Signals (location clusters → job-title groups → individual rows with dual
market ratios). Keep STATE/router/`openDrill`; the mock is a DESIGN REFERENCE —
map its layout and signal vocabulary onto the existing CSS variables so dark
mode keeps working. Do not copy its stylesheet.

## 2. Data prerequisites (blockers — resolve before or during Task 1)
1. **Remote-pull benchmark set**: `Compilation` gains remote-remuneration rows
   (or a `Remote` tab): role × country × remoteMeanUSD/p25/p75 + sourceVersion.
   Until populated, RemotePull.js falls back per-role to local-only and labels it.
   → Confirm with the Benchmarking Engine v9 owner (PEOPLE-39480).
2. **Acceleration `trackStart`**: explicit opt-in date per I3/I4 (new roster
   column or a small config sheet) — cleanest for audit; requires a one-time
   backfill for current I3/I4s.
3. **FY25/FY26 attrition marks**: computable from existing RD/roster term
   dates — no new source, one new function.

## 3. Phasing (each phase = its own writing-plans plan, own release)
- **P2a — engines + data (2026.W34):** the four server files, TDD in
  `tests/cases.js`, payload additions behind `meta.p2`, no UI change. Release N.
- **P2b — views (2026.W35):** renderer rebuild tab by tab against the frozen
  P2a payload; render_smoke grows per view. Release N+1.
- **P2c — polish + rollout (2026.W36):** dark-mode pass, drill integration,
  PROCESS.md, screenshots sign-off, exec pilot.

## 4. Non-negotiables carried from PROCESS.md
Every release: bump BUILD_ in EVERY server file + client SCHEMA →
`clasp push` → `bustCompCache_()` → publish a NEW deployment version.
Currency trap: remote-pull ratios computed on `tccUsd` only; never render
currency amounts in market columns — ratios and percentages. Colspan must equal
the rendered column count. Tests are blind to layout — final step is
screenshots (both themes). Commit trailer: `Co-Authored-By: Claude ...`.

## 5. Contribution / compliance evidence (owner addendum, 2026-08-12)
The Rocketeer's compliance profile — Goals compliance (Goal Compliance
dashboard data), Kudos and PTO health (readers live in
`PS Contribution Report.js`) — is to be read as an actual signal of compliance
supporting promotion / salary-adjustment decisions. The existing plumbing is
the **Contribution Snapshot** join (`buildContribByEmp_`, frozen quarterly
export from the PS Contribution Report project) and the `invisibleContributor`
Check L signal. P2 must surface this evidence wherever a decision is proposed
(decision cards, acceleration evidence packs, People Signals rows) — extent of
its role in signal *escalation* is an open design decision recorded in the P2a
plan (PROCESS.md §7.3 principle: surface for a human conversation, never
re-score automatically).

## 6. Mock responsiveness (owner addendum, 2026-08-12)
`mocks/compdash-decision-mock-v5.html` is the acceptance reference and must
itself adapt from phone to ultra-wide: fluid `--maxw` scaling on wide screens,
tables/matrix/stepper/SVG scroll horizontally inside their own containers on
narrow screens (never compress), tab bar scrolls on phone. Same rules apply to
the P2b renderers.

## 7. Sharing the prototype code
The mock is committed at `mocks/compdash-decision-mock-v5.html` so it versions
alongside this spec — it is the acceptance reference for P2b screenshots.
Do NOT paste mock markup into Views.html; the acceptance test is "same
information architecture and signal vocabulary", not pixel identity.
For stakeholders (Courtney, execs), share the mock file directly — it opens in
any browser with no data attached, which is exactly what makes it safe to
circulate.
