# Report Load Performance — Single-Pass Team Build + Client Prefetch — Design

**Date:** 2026-07-09 (2026.W28)
**Files touched:** `PS Contribution Report.js` (server), `PS Dashboard.html` (frontend)
**Related:** `ps-dashboard/docs/specs/2026-07-08-org-team-toggle-design.md` (team registry, per-team cache keys)

## Problem

Post org-team-toggle, users report (live QA, 2026.W28):

1. **Initial load is slower.** The warmer rebuilds three team entries per 30-min
   cycle inside a 4.5-min budget; Services runs first and can starve R&D /
   Sales & Success (`⚠️ time budget spent — skipped`). Manager-scoped cache keys
   are never warmed at all, and the new key shape makes each *team × manager*
   combination its own cold entry.
2. **First toggle to another team is slow.** The client caches per team after
   first visit (`STATE.teamData`), but the first visit is a live server call —
   and a cold one re-reads every sheet from scratch, even though all teams
   share the same data sources.

Root cause: each team is computed and cached as a fully independent payload.
Readers take the population as a filter, so per-team calls re-read identical
sheets. Sheet I/O dominates GAS execution time.

## Design

### A1. Execution-scoped sheet memo (server)

All eight heavy readers (RCR ×3 sheets, SI, Kudos, Tracked, Planned, Goals)
fetch through one helper — `loadSheet_PS_(ss, sheetName)`
(`PS Contribution Report.js:1198`). Memoize there:

```js
// Execution-scoped sheet cache: GAS resets globals per execution, so entries
// live exactly one web-app call / trigger run. Computing several teams in one
// execution then costs ONE fetch per sheet instead of one per team.
const SHEET_MEMO_ = {};

function loadSheet_PS_(ss, sheetName) {
  const key = ss.getId() + "::" + sheetName;
  if (!(key in SHEET_MEMO_)) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh) { SHEET_MEMO_[key] = null; }
    else {
      const data = sh.getDataRange().getValues();
      SHEET_MEMO_[key] = (data.length < 2)
        ? { headers: (data[0] || []).map(h => String(h).trim()), rows: [] }
        : { headers: data[0].map(h => String(h).trim()), rows: data.slice(1) };
    }
  }
  const hit = SHEET_MEMO_[key];
  if (!hit) return null;
  // Defensive copies — a caller may mutate rows in place; the master stays pristine.
  return { headers: hit.headers.slice(), rows: hit.rows.map(r => r.slice()) };
}
```

Two readers fetch outside `loadSheet_PS_` and get the same treatment via a
small generic memo access (`memoSheetData_(key, producer)` storing the master,
callers receive copies):

- `readPTOAccumulationProfiles_` (:1720) — external PTO accumulation sheet,
  called **per team** inside `computePSReport_` with a team-dependent
  `deptSet`. Memo the raw `rawData` values; the dept filtering stays per-call.
- `readPHData_` (:2959) — bound PH sheet, small but per-team.

Not memoized (deliberate): `readPSRoster_` (read once per execution already,
in `getPSReportData`), `readWeightSettings_` / `readJobCatalog_` (read once in
`getPSReportData`), `readScoringMatrix_` (small bound sheet; acceptable
per-team cost).

**Copy semantics:** the memo master is never handed out. Every access —
including the first — returns `headers.slice()` + `rows.map(r => r.slice())`.
Cell values are shared references (fine: strings/numbers/Dates that readers
never mutate in place); row arrays are what readers destructure and mutate.

### A2. One live compute warms every team in scope (server)

`getPSReportData(bustCache, teamKey)` keeps its exact current flow through the
primary team's compute + cachePut + return value. After the primary
`cachePutLarge_`, add a **team-warm loop**:

```
for each t in teamsInScope where t.key !== servedTeam.key:
  - if execution elapsed > 4.5 min → log "⚠️ team-warm budget spent — skipped" and stop
  - tScoped = teamRoster_(roster, t.key); skip if empty
  - tCacheKey = reportCacheKey_(_cacheVer, t.key, access)
  - if !bustCache and cache already has tCacheKey → skip (already warm)
  - try { compute via computePSReport_(same access/scope/weeks/weights, teamByKey_(t.key), jobCatalog, teamsInScope); cachePutLarge_ } 
    catch → log "❌ team-warm[key]" and continue (primary result is never at risk)
  - log "✅ team-warm[key]: built in Ns"
return primary result   (unchanged shape)
```

- `reportCacheKey_(ver, teamKey, access)` — new helper extracting the
  admin-vs-email key logic currently inlined at :3101-3103; used for both the
  primary key and the warm loop (DRY).
- Elapsed time measures from the **start of getPSReportData** (`const execT0 =
  Date.now();` as the first statement inside the `try`), not from the loop.
- With A1, each extra team is pure in-memory assembly (no sheet I/O): one cold
  execution leaves **every** team cached for that user's scope — admin or
  manager. A manager's first toggle then serves from cache instead of a fresh
  multi-minute compute.
- `bustCache=true` (Refresh button, warmer) force-rebuilds all in-scope teams.
  Refresh gets marginally slower than before (extra in-memory assemblies);
  accepted — Refresh is the explicit "give me everything fresh" action.
- Scope semantics unchanged: the loop reuses the already-scope-filtered
  `roster`, so a manager's warm entries are their org tree only. Security
  ordering (scope before team) is untouched.
- The existing fallback behavior (requested team empty in scope → serve first
  non-empty team, cached under the REQUESTED key) is untouched.

### A3. Warmer becomes a single call (server)

`warmReportCache()` drops its `TEAMS_.forEach` loop (each iteration was a
force-rebuild; with A2 the first call already rebuilds every team):

```js
function warmReportCache() {
  const s0 = Date.now();
  const res = getPSReportData(true, "services");   // A2 warms every admin-scope team
  const secs = Math.round((Date.now() - s0) / 1000);
  if (res && res.ok) Logger.log(`✅ warmReportCache: all admin team entries rebuilt in ${secs}s`);
  else Logger.log(`❌ warmReportCache after ${secs}s: ${(res && res.error) || "denied/unknown"}`);
}
```

No trigger re-install needed (same handler name); `setupCacheWarmer()`
untouched. The warmer's per-team success/skip logs now come from the A2 loop.

### B. Client background prefetch (frontend)

New module-level state next to `_loadingTeam` (`PS Dashboard.html:2446`):

```js
var _prefetchInFlight = {};   // teamKey → true while a background fetch runs
var _prefetchWanted   = null; // team the user is waiting on (toggle clicked mid-prefetch)
```

**`schedulePrefetch_()`** — called at the end of a successful `onDataLoaded`.
Waits 4 s (`setTimeout`) so first paint wins, then starts `prefetchNext_()`.
Idempotent: bails if a prefetch chain is already running.

**`prefetchNext_()`** — sequential chain (one request at a time):

- Pick the first `meta.availableTeams` key with no `STATE.teamData[key]` and
  no `_prefetchInFlight[key]`; if none, stop.
- `google.script.run.getPSReportData(false, key)`:
  - **Success:** clear in-flight flag. Ignore payloads that are denied/not ok.
    Store under the **served** key (`payload.meta.team.key` — payload is
    truth). If `_prefetchWanted === servedKey && STATE.activeTeam === servedKey`
    (user is staring at the loading screen for this team) → clear
    `_prefetchWanted`, call `onDataLoaded(payload)`. Then chain `prefetchNext_()`.
  - **Failure:** clear in-flight flag; if the user was waiting on this team →
    clear `_prefetchWanted` and fall back to `loadData(false)`; otherwise log
    to console and chain `prefetchNext_()` (next team still gets its shot).
- Prefetch **never** touches `_loadingInFlight`, `_loadingTeam`, or `_loadSeq`
  — it is invisible to `loadData`'s concurrency guards.

**`switchTeam(key)`** — one new branch between the client-cache hit and
`loadData`:

```
cached?               → render instantly (existing)
_prefetchInFlight[key]? → show the loading screen (same three DOM moves loadData
                          makes: loadingState flex, tabNav hidden, panes off),
                          set _prefetchWanted = key — the prefetch response
                          will route through onDataLoaded. No duplicate fetch.
else                  → loadData(false) (existing)
```

**`loadData()`** — sets `_prefetchWanted = null` when it starts (a user-driven
load supersedes any wait-on-prefetch), and on a **forceRefresh** success,
`onDataLoaded` drops every other team from `STATE.teamData` (the server just
rebuilt them — client copies are stale) before `schedulePrefetch_()` re-pulls
them from the now-warm server cache.

### Behavior after A+B

| Scenario | Before | After |
|---|---|---|
| Admin first open (warm cycle healthy) | warm | warm (unchanged) |
| Admin toggle to R&D, first time | cold compute if warmer skipped it | served from cache (warmer A3 builds all) + usually already in client cache via prefetch → instant |
| Manager first open | cold compute (1 team) | cold compute (~same reads, + in-memory extra teams) |
| Manager toggle, first time | full cold compute per team | instant-to-fast: client prefetch or warm per-scope cache |
| Refresh button | rebuild 1 team | rebuild all in-scope teams (marginal extra), client re-syncs all |

## Out of scope

- New metrics for R&D / Sales & Success (pending Contribution-team alignment).
- Payload-shape changes, cache version bump mechanics, CacheService chunking.
- Persisting sheet snapshots across executions (CacheService raw-data cache) —
  revisit only if manager cold loads are still painful after this ships.

## Testing

- **Node unit (server):** stub `ss` counting `getDataRange().getValues()`
  calls — two `loadSheet_PS_` calls fetch once; mutating a returned row does
  not affect the next call's data. Runs with the file's existing Node-eval
  test pattern.
- **Parse checks:** `node --check` equivalent for the .js (vm syntax), script
  block `new Function` parse for the HTML.
- **Live QA (owner, after GAS push of both files):**
  1. Editor: run `warmReportCache` manually → log shows one Services build +
     `✅ team-warm[rnd]` / `[sales]` lines, total well under 6 min.
  2. Dashboard as admin: open (warm), toggle R&D within ~10 s of load → either
     instant (prefetch landed) or a short cache read — never a multi-minute wait.
  3. Toggle all three teams twice — second pass all instant.
  4. Refresh button: full rebuild, then toggles instant again after ~one prefetch delay.
  5. Manager account: first open cold (expected), then toggles instant.
  6. Logs: no `⚠️ team-warm budget spent` under normal data volumes.
