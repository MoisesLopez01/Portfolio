# Demand Dashboard Load Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Project Demand Dashboard's ~30 s every-load compute into ~1–3 s loads via a gzip-chunked CacheService layer, a 30-minute warmer trigger, and a client force-refresh escape hatch.

**Architecture:** Port the PS Contribution Report's proven cache stack (`cachePutLarge_`/`cacheGetLarge_` gzip + 90 KB chunking) into the standalone demand project. Extract the existing `getDemandData()` compute into `buildDemandModel_()`, shared by a cache-first `getDemandData(forceRefresh)` endpoint and a `warmDemandCache()` timed trigger. One shared cache entry serves everyone (no per-user scoping here); per-caller `viewerRole`/`viewerEmail` are attached after the cache read, never stored.

**Tech Stack:** Google Apps Script (V8, ES5-style `var` code in this project), CacheService, ScriptApp triggers, plain-JS client in `Dashboard.html`. Local verification via Node (`node --check` + a small stub harness).

**Spec:** `project-demand-dashboard/docs/specs/2026-07-10-demand-dashboard-load-performance-design.md`

**Conventions:** All paths relative to repo root `D:\Contribution`. This repo is **local-only — never `git push`**. Line numbers reference the files as of commit `5fceafa`; re-locate by the quoted code if they've drifted.

---

## File Structure

| File | Change |
|---|---|
| `project-demand-dashboard/Code.js` | Add CONFIG cache keys; add cache helpers (`demandCacheVer_`, `bustDemandCache_`, `demandCacheKey_`, `cachePutLarge_`, `cacheGetLarge_`); rename compute to `buildDemandModel_()`; new cache-first `getDemandData(forceRefresh)`; `warmDemandCache()` + `setupDemandCacheWarmer()`; `_test_cacheRoundtrip_()` |
| `project-demand-dashboard/node-tests.js` | **New** — Node runner for the pure `_test_` functions with GAS stubs (Logger, Utilities via zlib, in-memory cache) |
| `project-demand-dashboard/Dashboard.html` | `boot(force)`; `reloadBtn` → `↻ Refresh` calling `boot(true)`; freshness badge from `model.generatedAt` |
| `project-demand-dashboard/README.md` | Document cache + warmer, update Files table, Deploy steps, Notes |

---

### Task 1: Cache helpers + roundtrip test (TDD)

**Files:**
- Modify: `project-demand-dashboard/Code.js` (CONFIG block ~line 12–43; insert helpers after `sumHoursByIso_` ~line 145; append test at end of file)
- Create: `project-demand-dashboard/node-tests.js`

- [ ] **Step 1: Write the failing test**

Append at the very end of `Code.js` (after `_test_behaviorSignals`):

```js
/**
 * Cache chunking roundtrip — verifies cachePutLarge_/cacheGetLarge_ survive a
 * >100 KB payload (multi-chunk) and treat a missing chunk as a clean miss.
 * Run in the GAS editor with no args (uses the real script cache), or via
 * node-tests.js which passes an in-memory stub cache.
 */
function _test_cacheRoundtrip_(cacheOpt) {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_cacheRoundtrip_: " + msg); }
  var cache = cacheOpt || CacheService.getScriptCache();
  var key = "pd_test_roundtrip";

  // Low-compressibility payload: pseudo-random digits so gzip+base64 still
  // exceeds one 90 KB chunk (forces the multi-chunk path).
  var arr = [];
  for (var i = 0; i < 60000; i++) arr.push((i * 104729) % 1000000007);
  var str = JSON.stringify({ rows: arr });

  assert_(cachePutLarge_(cache, key, str, 60) === true, "put failed");
  var meta = parseInt(cache.get(key + "_meta"), 10);
  assert_(meta >= 2, "expected >= 2 chunks, got " + meta + " — payload too small to exercise chunking");
  var back = cacheGetLarge_(cache, key);
  assert_(back === str, "roundtrip mismatch (" + (back ? back.length : "null") + " vs " + str.length + " chars)");

  cache.remove(key + "_0");   // simulate partial eviction
  assert_(cacheGetLarge_(cache, key) === null, "missing chunk must read as a clean miss, not throw/partial");

  Logger.log("✅ _test_cacheRoundtrip_ passed");
}
```

- [ ] **Step 2: Create the Node test harness**

Create `project-demand-dashboard/node-tests.js` with exactly:

```js
// node-tests.js — local runner for the pure _test_ functions in Code.js.
// GAS services are stubbed just enough: Logger→console, Utilities gzip/base64
// via zlib/Buffer, and an in-memory cache passed into _test_cacheRoundtrip_.
// (SpreadsheetApp/CacheService/ScriptApp are NOT stubbed — only functions that
// avoid them run here; everything also runs for real in the GAS editor.)
// Usage: node node-tests.js   (from this directory)
var fs = require("fs");
var path = require("path");
var zlib = require("zlib");

global.Logger = { log: function (m) { console.log(m); } };
global.Utilities = {
  newBlob: function (data) {
    return { _buf: Buffer.isBuffer(data) ? data : Buffer.from(data) };
  },
  gzip: function (blob) {
    return { getBytes: function () { return zlib.gzipSync(blob._buf); } };
  },
  ungzip: function (blob) {
    return { getDataAsString: function () { return zlib.gunzipSync(blob._buf).toString("utf8"); } };
  },
  base64Encode: function (bytes) { return Buffer.from(bytes).toString("base64"); },
  base64Decode: function (b64) { return Buffer.from(b64, "base64"); },
};

function FakeCache() { this.m = {}; }
FakeCache.prototype.putAll = function (entries) { for (var k in entries) this.m[k] = entries[k]; };
FakeCache.prototype.get = function (k) { return (k in this.m) ? this.m[k] : null; };
FakeCache.prototype.getAll = function (names) {
  var out = {};
  for (var i = 0; i < names.length; i++) if (names[i] in this.m) out[names[i]] = this.m[names[i]];
  return out;
};
FakeCache.prototype.remove = function (k) { delete this.m[k]; };

eval(fs.readFileSync(path.join(__dirname, "Code.js"), "utf8"));

_test_demandParse_();
_test_headcount_();
_test_buildPersonAvailability_();
_test_personWeekPTO_();
_test_scopeRecsToServices_();
_test_isCrew_();
_test_behaviorSignals();
_test_cacheRoundtrip_(new FakeCache());
console.log("✅ node-tests: all suites passed");
```

- [ ] **Step 3: Run harness to verify the new test fails**

Run: `node "project-demand-dashboard/node-tests.js"`
Expected: the seven existing suites log `✅ … passed`, then **FAIL** with `ReferenceError: cachePutLarge_ is not defined`. (If an *existing* suite throws on a GAS-only API instead, note it, comment that call out of the harness, and continue — it still runs in the GAS editor.)

- [ ] **Step 4: Add CONFIG cache keys**

In `Code.js`, inside the `CONFIG` object, immediately after the `Q4_BASE_YEAR: 2026,` line (~line 42), add:

```js
  // ── Cache (gzip + chunked CacheService — see README) ──
  CACHE_TTL_SEC:        3900, // 65 min — outlives one missed 30-min warm cycle
  CACHE_WARM_EVERY_MIN: 30,   // warmDemandCache() trigger interval (setupDemandCacheWarmer)
```

- [ ] **Step 5: Add the cache helpers**

Insert after the closing brace of `sumHoursByIso_` (~line 145) and **before** the `// ── MAIN DATA ENDPOINT …` banner:

```js
// ── CACHE (gzip + chunking) ─────────────────────────────────
// Ported from PS Contribution Report.js. CacheService rejects any single value
// over 100 KB and the demand payload (person-level maps + behavior signals)
// exceeds that, so the JSON is gzipped (~10× smaller) and split across numbered
// chunk keys (`<key>_0..n` + `<key>_meta`). A missing chunk on read (partial
// eviction) is treated as a clean cache miss. One shared entry serves every
// viewer — this dashboard has no per-user scoping (viewerRole/viewerEmail are
// attached after the cache read, never stored).
var CACHE_CHUNK_BYTES_ = 90 * 1024;  // margin under the 100 KB per-value cap

/** Current cache version — Script Property PD_CACHE_VER (default 1). */
function demandCacheVer_() {
  try {
    var v = parseInt(PropertiesService.getScriptProperties().getProperty("PD_CACHE_VER"), 10);
    return v > 0 ? v : 1;
  } catch (e) { return 1; }
}

/**
 * Bumps PD_CACHE_VER, stranding all prior-version entries (they expire on TTL —
 * CacheService can't enumerate keys, so versioning is how invalidation works).
 * Run manually from the GAS editor to force-invalidate the cache.
 */
function bustDemandCache_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var next = (parseInt(props.getProperty("PD_CACHE_VER"), 10) || 1) + 1;
    props.setProperty("PD_CACHE_VER", String(next));
    Logger.log("✅ bustDemandCache_: cache version bumped to " + next);
    return next;
  } catch (e) {
    Logger.log("⚠️ bustDemandCache_: " + e.message);
    return null;
  }
}

/** The single shared cache key for the demand model. */
function demandCacheKey_() { return "pd_v" + demandCacheVer_(); }

/** Gzips + chunks `str` into `<key>_0..n` + `<key>_meta`. Returns true on success. */
function cachePutLarge_(cache, key, str, ttlSec) {
  try {
    var b64 = Utilities.base64Encode(
      Utilities.gzip(Utilities.newBlob(str, "application/json")).getBytes());
    var entries = {};
    var n = 0;
    for (var i = 0; i < b64.length; i += CACHE_CHUNK_BYTES_, n++) {
      entries[key + "_" + n] = b64.slice(i, i + CACHE_CHUNK_BYTES_);
    }
    entries[key + "_meta"] = String(n);
    cache.putAll(entries, ttlSec);
    Logger.log("cachePutLarge_: " + key + " — " + str.length + " chars → " + b64.length + " b64 in " + n + " chunk(s)");
    return true;
  } catch (e) {
    Logger.log("⚠️ cachePutLarge_ (" + key + "): " + e.message);
    return false;
  }
}

/** Reads a chunked entry; returns the JSON string or null on any miss. */
function cacheGetLarge_(cache, key) {
  try {
    var meta = parseInt(cache.get(key + "_meta"), 10);
    if (!(meta > 0)) return null;
    var names = [];
    for (var i = 0; i < meta; i++) names.push(key + "_" + i);
    var got = cache.getAll(names);
    var b64 = "";
    for (var j = 0; j < meta; j++) {
      var part = got[key + "_" + j];
      if (!part) return null;  // chunk expired/evicted — whole entry is a miss
      b64 += part;
    }
    return Utilities.ungzip(
      Utilities.newBlob(Utilities.base64Decode(b64), "application/x-gzip")).getDataAsString();
  } catch (e) {
    Logger.log("⚠️ cacheGetLarge_ (" + key + "): " + e.message);
    return null;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --check "project-demand-dashboard/Code.js" && node "project-demand-dashboard/node-tests.js"`
Expected: all eight `✅ … passed` lines plus `✅ node-tests: all suites passed`.

- [ ] **Step 7: Commit**

```bash
git add "project-demand-dashboard/Code.js" "project-demand-dashboard/node-tests.js"
git commit -m "feat(demand-dash): gzip-chunked cache helpers + roundtrip test and Node harness

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `buildDemandModel_()`, cache-first `getDemandData(forceRefresh)`

**Files:**
- Modify: `project-demand-dashboard/Code.js` (the `getDemandData` block, ~lines 147–256 pre-Task-1; shifted down by Task 1's insertions)

- [ ] **Step 1: Replace the endpoint head**

Find this exact block (banner + JSDoc + function head + access check + weeks line):

```js
// ── MAIN DATA ENDPOINT (called from the client via google.script.run) ──

/**
 * Reads the Planned Time Tempo sheet and the Roster, returning the aggregated
 * demand model for the current 8-week window. All demand figures are PLANNED HOURS.
 * Access is re-checked server-side (defense in depth — the page is already gated).
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData() {
  var access = checkDemandAccess();
  if (!access.allowed) {
    var denied = emptyModel_(buildWindow_());
    denied.error = "Access restricted to authorized users.";
    return denied;
  }

  var weeks = buildWindow_();
```

Replace with:

```js
// ── MAIN DATA ENDPOINT (called from the client via google.script.run) ──

/**
 * Cache-first data endpoint. Returns the shared gzip-chunked cache entry when
 * present (~1–3 s) and only runs the full compute on a miss or when
 * forceRefresh is true — a force refresh overwrites the shared entry, so one
 * person's Refresh warms the cache for everyone. The computed model is cached
 * only when healthy (no error / trackedError) so a transient sheet-read
 * failure never gets pinned until the next warm. viewerRole/viewerEmail are
 * per-caller — attached after the cache read, never stored in the cache.
 * Access is re-checked server-side (defense in depth — the page is already gated).
 * @param {boolean} [forceRefresh] true → bypass the cache and rewrite it (↻ Refresh).
 * @returns {Object} model (see aggregate_); model.error is set on failure.
 */
function getDemandData(forceRefresh) {
  var access = checkDemandAccess();
  if (!access.allowed) {
    var denied = emptyModel_(buildWindow_());
    denied.error = "Access restricted to authorized users.";
    return denied;
  }

  var cache = CacheService.getScriptCache();
  var key = demandCacheKey_();
  if (!forceRefresh) {
    var hit = cacheGetLarge_(cache, key);
    if (hit) {
      try {
        var cached = JSON.parse(hit);
        cached.viewerRole = access.role;
        cached.viewerEmail = access.email;
        return cached;
      } catch (e) {
        Logger.log("⚠️ getDemandData: bad cache entry (" + e.message + ") — recomputing");
      }
    }
  }

  var model = buildDemandModel_();
  if (!model.error && !model.trackedError) {
    cachePutLarge_(cache, key, JSON.stringify(model), CONFIG.CACHE_TTL_SEC);
  }
  model.viewerRole = access.role;
  model.viewerEmail = access.email;
  return model;
}

/**
 * Full demand-model compute — three sheet reads (Planned Time Tempo, Roster,
 * Tempo Tracked Time) plus all aggregation. All demand figures are PLANNED
 * HOURS. Shared by getDemandData (cache miss / force) and warmDemandCache
 * (timed trigger). No access check and no viewer fields here: triggers have no
 * meaningful Session user, and the result is cached for everyone.
 * @returns {Object} model (see aggregate_); model.error is set on failure — callers never cache those.
 */
function buildDemandModel_() {
  var weeks = buildWindow_();
```

(The rest of the original function body — `try { … } catch (e) { … }` — now belongs to `buildDemandModel_` unchanged, except Steps 2–3 below.)

- [ ] **Step 2: Remove the viewer-field attachment from the compute**

Inside what is now `buildDemandModel_`, delete these four lines (just before `return model;`):

```js
    // Caller's resolved role — the client uses this to show the admin-only
    // 🔒 Access button. Display-only: every privileged call re-checks server-side.
    model.viewerRole  = access.role;
    model.viewerEmail = access.email;
```

- [ ] **Step 3: Stamp `generatedAt`**

In `buildDemandModel_`, immediately after the `model.anzLocation = CONFIG.ANZ_LOCATION || '';` line, add:

```js
    model.generatedAt = new Date().toISOString();   // freshness badge ("Data as of HH:MM")
```

- [ ] **Step 4: Run tests**

Run: `node --check "project-demand-dashboard/Code.js" && node "project-demand-dashboard/node-tests.js"`
Expected: all suites pass (the extraction touches no parsing/aggregation function).

- [ ] **Step 5: Commit**

```bash
git add "project-demand-dashboard/Code.js"
git commit -m "feat(demand-dash): cache-first getDemandData(forceRefresh); extract buildDemandModel_ with generatedAt stamp

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Warmer — `warmDemandCache()` + `setupDemandCacheWarmer()`

**Files:**
- Modify: `project-demand-dashboard/Code.js` (insert directly after the closing brace of `buildDemandModel_`)

- [ ] **Step 1: Add the warmer functions**

```js
// ── CACHE WARMER ────────────────────────────────────────────

/**
 * Rebuilds the shared cache entry. Runs on the time trigger installed by
 * setupDemandCacheWarmer(), so real visitors virtually always hit warm cache.
 * Skips the write when the model is unhealthy — a transient sheet-read failure
 * must not overwrite a good entry.
 */
function warmDemandCache() {
  var s0 = Date.now();
  var model = buildDemandModel_();
  var secs = Math.round((Date.now() - s0) / 1000);
  if (model.error || model.trackedError) {
    Logger.log("❌ warmDemandCache after " + secs + "s: " + (model.error || model.trackedError));
    return;
  }
  var ok = cachePutLarge_(CacheService.getScriptCache(), demandCacheKey_(),
                          JSON.stringify(model), CONFIG.CACHE_TTL_SEC);
  Logger.log(ok ? "✅ warmDemandCache: rebuilt in " + secs + "s"
                : "❌ warmDemandCache: compute ok (" + secs + "s) but cache write failed");
}

/**
 * One-time setup — run manually from the GAS editor as the dashboard owner.
 * Replaces any existing warmer trigger, so it is safe to re-run after changing
 * CONFIG.CACHE_WARM_EVERY_MIN. (everyMinutes accepts 1/5/10/15/30 only.)
 */
function setupDemandCacheWarmer() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === "warmDemandCache"; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("warmDemandCache")
    .timeBased()
    .everyMinutes(CONFIG.CACHE_WARM_EVERY_MIN)
    .create();
  Logger.log("✅ Demand cache warmer installed — every " + CONFIG.CACHE_WARM_EVERY_MIN +
             " min, TTL " + CONFIG.CACHE_TTL_SEC + "s");
}
```

- [ ] **Step 2: Run tests**

Run: `node --check "project-demand-dashboard/Code.js" && node "project-demand-dashboard/node-tests.js"`
Expected: all suites pass. (The warmer itself needs GAS services — it's exercised in the deploy QA, Task 6.)

- [ ] **Step 3: Commit**

```bash
git add "project-demand-dashboard/Code.js"
git commit -m "feat(demand-dash): warmDemandCache 30-min trigger + setupDemandCacheWarmer installer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Client — cache-first boot, ↻ Refresh, freshness badge

**Files:**
- Modify: `project-demand-dashboard/Dashboard.html` (header button ~line 357, `boot()` ~line 666, `updateBadge()` ~line 705, reload handler ~line 1833)

- [ ] **Step 1: Repurpose the Reload button as force-refresh**

The header already has a `⟳ Reload` button that re-runs `boot()` — after caching, a plain reload would just re-read the cache, so it becomes the live-read escape hatch instead of adding a second button. Replace:

```html
      <button id="reloadBtn">⟳ Reload</button>
```

with:

```html
      <button id="reloadBtn" title="Bypass the cache — read live from the sheets and re-warm it for everyone">↻ Refresh</button>
```

- [ ] **Step 2: `boot(force)`**

Replace the current `boot()`:

```js
function boot(){
  setState("Loading data…");
  if (typeof google !== "undefined" && google.script && google.script.run){
    google.script.run.withSuccessHandler(onData).withFailureHandler(onErr).getDemandData();
  } else {
```

with:

```js
function boot(force){
  setState(force ? "Refreshing live data…" : "Loading data…");
  if (typeof google !== "undefined" && google.script && google.script.run){
    google.script.run.withSuccessHandler(onData).withFailureHandler(onErr).getDemandData(!!force);
  } else {
```

(The `else` branch and everything after are unchanged. The initial `boot();` call at the bottom of the file stays as-is — `force` is `undefined` → cache-first.)

- [ ] **Step 3: Wire the button to a forced load**

Replace:

```js
$('reloadBtn').onclick=function(){ ACTIVE_ROW=null; boot(); };
```

with:

```js
$('reloadBtn').onclick=function(){ ACTIVE_ROW=null; boot(true); };
```

- [ ] **Step 4: Freshness badge**

Replace the current `updateBadge()`:

```js
function updateBadge(){
  var b=$('srcBadge'); if(!b) return;
  if(SOURCE==="live"){
    var ts=DATA&&DATA.trackedLastExport;
    b.className="srcbadge live";
    b.textContent=ts ? fmtExport(ts) : 'Data loaded';
  } else { b.className="srcbadge offline"; b.textContent="○ Offline / CSV"; }
}
```

with:

```js
function updateBadge(){
  var b=$('srcBadge'); if(!b) return;
  if(SOURCE==="live"){
    b.className="srcbadge live";
    // Snapshot freshness (generatedAt = when the server computed this model —
    // it may be a cached snapshot; ↻ Refresh forces a live read). Falls back
    // to the tracked-export stamp for models without generatedAt (mid-rollout).
    var ga=DATA&&DATA.generatedAt ? new Date(DATA.generatedAt) : null;
    if(ga && !isNaN(ga)){
      b.textContent='Data as of '+ga.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      b.title='When this snapshot was computed — ↻ Refresh forces a live read';
    } else {
      var ts=DATA&&DATA.trackedLastExport;
      b.textContent=ts ? fmtExport(ts) : 'Data loaded';
    }
  } else { b.className="srcbadge offline"; b.textContent="○ Offline / CSV"; }
}
```

- [ ] **Step 5: Verify wiring by grep**

Run (from repo root):

```bash
grep -n "getDemandData(!!force)\|boot(true)\|Data as of\|↻ Refresh" "project-demand-dashboard/Dashboard.html"
```

Expected: four matches — the `boot` call, the button handler, the badge text, and the button label. Also confirm exactly one `getDemandData` call site remains: `grep -c "getDemandData" "project-demand-dashboard/Dashboard.html"` → `1`.

- [ ] **Step 6: Commit**

```bash
git add "project-demand-dashboard/Dashboard.html"
git commit -m "feat(demand-dash): cache-first boot, ↻ Refresh force-reload, data-as-of freshness badge

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: README update

**Files:**
- Modify: `project-demand-dashboard/README.md`

- [ ] **Step 1: Update the Files table rows**

In the Files table, replace the `Code.js` row's trailing text `\`_test_demandParse_()\` + \`_test_headcount_()\` unit tests.` with:

```
`buildDemandModel_()` is the full compute, shared by the cache-first `getDemandData(forceRefresh)` endpoint and the `warmDemandCache()` 30-min trigger (`setupDemandCacheWarmer()` installs it). `_test_demandParse_()` + `_test_headcount_()` + `_test_cacheRoundtrip_()` unit tests.
```

Replace the `Dashboard.html` row's `loads live via \`google.script.run.getDemandData()\`` with:

```
loads cache-first via `google.script.run.getDemandData(false)`; the header ↻ Refresh forces a live read and re-warms the cache
```

After the `Dashboard.html` row, add a new table row:

```
| `node-tests.js` | Local Node runner for the pure `_test_` functions (stubs Logger/Utilities/cache) — `node node-tests.js`. Not pasted into the GAS project. |
```

- [ ] **Step 2: Update the Deploy section**

In Deploy step 3, replace `run \`_test_demandParse_\` and \`_test_headcount_\` once; confirm both log` with `run \`_test_demandParse_\`, \`_test_headcount_\` and \`_test_cacheRoundtrip_\` once; confirm each logs`.

After Deploy step 6 (the "Deploy → New deployment" step), insert a new step and renumber the old step 7 to 8:

```
7. Run `setupDemandCacheWarmer()` once in the editor as the owner — installs the 30-min
   `warmDemandCache` trigger that keeps the shared cache entry warm.
```

- [ ] **Step 3: Replace the "No caching layer" note**

In Notes, replace the first bullet:

```
- No caching layer — each load is two `getValues()` reads (Tempo + Roster). Add `CacheService`
  later only if load latency warrants it.
```

with:

```
- **Caching:** `getDemandData()` serves a shared gzip-chunked `CacheService` entry
  (`pd_v<PD_CACHE_VER>`, TTL `CACHE_TTL_SEC` = 65 min), kept warm by the 30-min
  `warmDemandCache` trigger — warm loads are ~1–3 s vs the ~30 s full compute. Data can lag
  sheet edits by up to the warm interval; the ↻ Refresh button forces a live read and
  re-warms the entry for everyone. Error / `trackedError` models are never cached. Bump the
  version manually with `bustDemandCache_()` in the editor to force-invalidate. The badge
  shows "Data as of HH:MM" (`generatedAt`).
```

- [ ] **Step 4: Commit**

```bash
git add "project-demand-dashboard/README.md"
git commit -m "docs(demand-dash): document cache + warmer + refresh in README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy & QA (manual — owner only, in the GAS editor / browser)

No repo changes. These steps require the deployed GAS project and the owner account; an agentic executor should surface this task as a checklist for the user rather than attempt it.

- [ ] Paste updated `Code.js` and `Dashboard.html` into the GAS project (script.google.com).
- [ ] Run `_test_demandParse_`, `_test_headcount_`, `_test_cacheRoundtrip_` in the editor — each logs `✅ … passed`. (`_test_cacheRoundtrip_` also proves CacheService accepts the multi-chunk write.)
- [ ] Run `setupDemandCacheWarmer()` once as the owner — Executions log shows `✅ Demand cache warmer installed — every 30 min, TTL 3900s`.
- [ ] Run `warmDemandCache()` once manually — log shows `✅ warmDemandCache: rebuilt in <n>s` (this is the cold-compute baseline timing).
- [ ] Open the dashboard: load completes in ~1–3 s and the badge reads `Data as of HH:MM`.
- [ ] Click `↻ Refresh`: "Refreshing live data…" state, takes the full compute time, badge timestamp advances.
- [ ] Reload the page (browser reload): fast again (the refresh re-warmed the shared entry).
- [ ] After ~30–60 min, check Executions log: `warmDemandCache` runs appear every 30 min with `✅` lines.
- [ ] No `PS_CACHE_VER`-style bump needed — the cache is new; `PD_CACHE_VER` stays unset (defaults to 1).

---

## Self-Review Notes

- **Spec coverage:** §1 cache layer → Task 1; §2 endpoint flow → Task 2; §3 warmer → Task 3; §4 client → Task 4; §5 testing → Tasks 1 (roundtrip + harness) and 6 (manual QA); §6 deploy + README → Tasks 5–6. The spec's "New ↻ Refresh button" is implemented by repurposing the existing `reloadBtn` (a plain reload would silently become a cache read — repurposing keeps one button with honest semantics); labeled deviation, same intent.
- **Names used consistently:** `demandCacheVer_`, `bustDemandCache_`, `demandCacheKey_`, `cachePutLarge_`, `cacheGetLarge_`, `CACHE_CHUNK_BYTES_`, `buildDemandModel_`, `getDemandData(forceRefresh)`, `warmDemandCache`, `setupDemandCacheWarmer`, `_test_cacheRoundtrip_`, CONFIG keys `CACHE_TTL_SEC` / `CACHE_WARM_EVERY_MIN`, Script Property `PD_CACHE_VER`, model field `generatedAt`.
- **`trackedWarning` (0 rows parsed) does not block caching** — data-content condition, per spec.
