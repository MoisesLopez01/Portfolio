# Project Demand Dashboard — Load Performance (Cache + Warmer)

**Date:** 2026-07-10 (2026.W28)
**Status:** Approved
**Files:** `docs/superpowers/project-demand-dashboard/Code.js`, `docs/superpowers/project-demand-dashboard/Dashboard.html`, `docs/superpowers/project-demand-dashboard/README.md`

## Problem

Every dashboard load runs the full `getDemandData()` compute: three full-sheet
`getValues()` reads (Planned Time Tempo, Roster, Tempo Tracked Time) plus all
aggregation (capacity, person availability, behavior signals). There is no caching
layer, so **every load takes ~30 s or more** for every user, every time.

The underlying data only changes when the Tempo export scripts run; the user
confirmed **up to ~30 minutes of staleness is acceptable**, with a manual escape
hatch for a guaranteed-live read.

## Decision

Port the PS Contribution Report's proven cache stack (Option A of three considered):
gzip-chunked `CacheService` entries + a 30-minute time-trigger warmer + a client
Refresh button that forces a live read. Options rejected: inlining the payload into
`doGet()` (marginal gain over A for extra `doGet` complexity) and no-cache compute
optimization (sheet reads dominate; would only reach ~10–15 s and A's staleness
trade was accepted).

Expected outcome: **~1–3 s** loads whenever the cache is warm — which the warmer
makes effectively always. Cold + forced loads stay at today's speed.

## Design

### 1. Server cache layer (`Code.js`)

Copy `cachePutLarge_(cache, key, str, ttlSec)` and `cacheGetLarge_(cache, key)`
from `PS Contribution Report.js` (lines ~136–230 in the donor). Copied, not shared —
this is a standalone GAS project with no cross-project imports (same precedent as
`titleFamilyMap_`). Behavior:

- JSON payload is gzipped (`Utilities.gzip`, ~10× smaller) and split into 90 KB
  chunks stored as `<key>_0..n` plus a `<key>_meta` entry — CacheService rejects
  any single value over 100 KB, and this payload (with `personWeekPlan`,
  `personWeekTracked`, `personProjectPlan`, `behaviorSignals`) will likely exceed it.
- A missing chunk on read is treated as a clean cache miss.

New `CONFIG` keys:

| Key | Value | Meaning |
|---|---|---|
| `CACHE_TTL_SEC` | `3900` | 65 min — outlives one missed warm cycle |
| `CACHE_WARM_EVERY_MIN` | `30` | warmer trigger interval |

Cache key: `pd_v<VER>` where `<VER>` is Script Property `PD_CACHE_VER`
(default `1` when unset). **Single shared entry** — this exec dashboard has no
manager scoping; every allowed user receives the identical payload.
`bustDemandCache_()` bumps `PD_CACHE_VER` for manual invalidation from the editor
(no runtime save path needs it — access-settings saves don't affect cached data).

### 2. `getDemandData(forceRefresh)` flow

Extract the current compute body (everything between the access check and the
viewer-field attachment) into an internal `buildDemandModel_()` shared by the
endpoint and the warmer. New endpoint flow:

1. `checkDemandAccess()` — unchanged, always live, never cached.
2. If not `forceRefresh`: try `cacheGetLarge_`; on hit, parse, attach
   `viewerRole` / `viewerEmail` (per-user — **never stored in the cache**), return.
3. On miss or force: `buildDemandModel_()`, stamp `generatedAt` (ISO datetime),
   write to cache **only if the model is healthy** — no `model.error` and no
   `model.trackedError`. Caching a transient failure would pin a degraded view
   for everyone until the next warm. (`trackedWarning` — 0 rows parsed — is a
   data-content condition, not a transient read failure, and does not block caching.)
   Then attach viewer fields and return.

A force refresh **overwrites** the shared entry, so one person's Refresh warms the
cache for everyone. Old zero-arg calls behave as `forceRefresh = false`
(`undefined` is falsy).

Error models keep today's semantics: returned live, never cached.

### 3. Warmer

- `warmDemandCache()` — calls `buildDemandModel_()` and force-writes the cache
  (same healthy-model guard). Logs a `⚠️` on failure so misses surface in the
  Executions log.
- `setupDemandCacheWarmer()` — one-time install, run in the GAS editor as the
  owner: deletes any existing trigger bound to `warmDemandCache`, then creates a
  time-based trigger every `CACHE_WARM_EVERY_MIN` minutes. Mirrors the PS report's
  `setupCacheWarmer()`.

### 4. Client (`Dashboard.html`)

- `boot()` calls `getDemandData(false)` — cache-first.
- New **↻ Refresh** button in the header (next to the theme / 🔒 Access buttons)
  calling `getDemandData(true)` with a "Refreshing live data…" loading state —
  the escape hatch right after a Tempo export.
- Freshness display: the header badge shows "data as of HH:MM" derived from
  `model.generatedAt`, so execs know whether they're looking at a cached snapshot.
  When `generatedAt` is absent (older cached entries mid-rollout), the badge
  falls back to its current text.

### 5. Testing

- New `_test_cacheRoundtrip_()` — push a synthetic >100 KB model through
  `cachePutLarge_` / `cacheGetLarge_`, assert deep equality; delete one chunk and
  assert a clean miss (null, no throw).
- Existing `_test_*` suites unaffected — `buildDemandModel_()` is a pure
  extraction; parsing/aggregation functions are untouched.
- Manual QA: cold-load timing, warm-load timing (~1–3 s), Refresh button forces
  a live read and updates the freshness badge, warmer runs visible in the
  Executions log after trigger install.

### 6. Deploy

1. Paste updated `Code.js` and `Dashboard.html` into the GAS project.
2. Run `setupDemandCacheWarmer()` once in the editor as the owner.
3. Redeploy the web app. No new auth scopes (CacheService and ScriptApp triggers
   require no additional grants beyond what the project owner already has).
4. Update README "Notes" — remove the "No caching layer" bullet, document the
   cache + warmer + `PD_CACHE_VER`.

## Out of scope

- Inlining the payload into `doGet()` (Option B) — revisit only if ~2 s still
  feels slow.
- Narrowing sheet reads / compute optimization (Option C).
- Any change to access control, aggregation logic, or panel rendering.
