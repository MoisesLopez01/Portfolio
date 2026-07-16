# Utilization V2 — Glance/Explore Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the v1 Utilization panel into a manager glance layer (hero + verdict + reconciled population, always visible) and an analyst explore layer (chart + chips + drill, one click away), per the V2 section of `docs/superpowers/specs/2026-07-16-utilization-decision-chart-design.md`.

**Architecture:** Client-only edits to `docs/superpowers/project-demand-dashboard/Dashboard.html` — no Code.js change, no cache bump. One new pure function (`utilVerdict_`) in UTIL-PURE with a node test; everything else is markup/CSS/render-layer reorganization of the v1 code (base `a16568e`).

**Tech Stack:** Vanilla ES5 in a GAS HtmlService page, inline SVG, `node node-tests.js` harness.

**Global constraints (bind every task):** ES5 only (var/function — no arrows, template literals, let/const). UTIL-PURE block stays pure (no DOM/`DATA`). Commit ONLY `Dashboard.html` (+ `node-tests.js` when tests change) — the repo has unrelated dirty files; never `git add -A`. Run `cd docs/superpowers/project-demand-dashboard && node node-tests.js` (must end `✅ node-tests: all suites passed`) AND the script-parse check `node -e "var fs=require('fs');var s=fs.readFileSync('docs/superpowers/project-demand-dashboard/Dashboard.html','utf8');var m=s.match(/<script>([\s\S]*)<\/script>/);new Function(m[1]);console.log('script parses OK')"` before every commit. The gap stays HOURS ONLY (no dollars, standing decision). No individual names in the chart area.

---

### Task 1: `utilVerdict_` (pure) + test

**Files:** Modify `Dashboard.html` (UTIL-PURE, after `utilIdentity_`), `node-tests.js`.

- [ ] **Step 1: Failing test** — after `_test_utilIdentity_` in node-tests.js, add + wire `_test_utilVerdict_();`:

```js
function _test_utilVerdict_() {
  function assert_(cond, msg) { if (!cond) throw new Error("❌ _test_utilVerdict_: " + msg); }
  var stats = { mean: 65, sigma: 2, lo: 61, hi: 69 };
  assert_(utilVerdict_(57, stats) === "below", "under lo → below");
  assert_(utilVerdict_(72, stats) === "above", "over hi → above");
  assert_(utilVerdict_(65, stats) === "normal", "inside band → normal");
  assert_(utilVerdict_(61, stats) === "normal" && utilVerdict_(69, stats) === "normal", "band edges inclusive");
  assert_(utilVerdict_(null, stats) === null, "no utilization → null");
  assert_(utilVerdict_(57, null) === null, "no band → null");
  Logger.log("✅ _test_utilVerdict_ passed");
}
```

- [ ] **Step 2: Run** `node node-tests.js` → FAIL `utilVerdict_ is not defined`
- [ ] **Step 3: Implement** in UTIL-PURE after `utilIdentity_`:

```js
// One-word band verdict for the glance layer. Band edges count as normal —
// the band IS the definition of normal variation. null when either input is
// missing (no settled utilization, or fewer settled weeks than the band needs).
function utilVerdict_(u, stats){
  if (u == null || !stats) return null;
  if (u < stats.lo) return "below";
  if (u > stats.hi) return "above";
  return "normal";
}
```

- [ ] **Step 4: Run** `node node-tests.js` → all suites pass.
- [ ] **Step 5: Commit** both files: `feat(utilization): pure band verdict for the glance layer`

---

### Task 2: Markup + CSS — glance/explore containers, chip-toggle restyle

**Files:** Modify `Dashboard.html` only (markup ~line 578; CSS `.uchip`/`.util-head` block ~line 127; state vars near `UTIL_INC_NT`).

- [ ] **Step 1: Replace the `#utilPanel` block** with:

```html
    <!-- 1c. Utilization — glance (hero+verdict) always visible; explore (chart/chips/drill) one click away -->
    <div class="panel" id="utilPanel" data-view="overview">
      <div class="panel-h">
        <h2>Utilization — Delivery</h2>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <div class="hint">Tracked ÷ Tempo schedule capacity for tracking-required roles · Coverage = planned ÷ capacity, Fidelity = tracked ÷ planned · verdict = position vs the normal ±2σ band · reflects People filters above</div>
          <button class="btn" id="utilExploreBtn" style="font-size:11px;padding:5px 10px" onclick="utilToggleExplore_()">Explore ▸</button>
          <button class="png-btn" data-png="utilization">⬇ Save PNG</button>
        </div>
      </div>
      <div class="util-head" id="utilHead"></div>
      <div id="utilExplore" style="display:none">
        <div class="util-tools">
          <div class="chip-toggle" id="utilScope">
            <button id="utilChipNt" onclick="utilToggleNt_()" title="Add people whose job family has planned capacity but no tracking mandate — off by default so a scope decision doesn't read as a performance problem">＋ non-tracking roles</button>
            <button id="utilChipMgr" onclick="utilToggleMgr_()" title="Add managers — they legitimately log little delivery time, so they're excluded from the default denominator">＋ managers</button>
          </div>
          <button class="btn" id="utilCsvBtn" style="font-size:11px;padding:5px 10px" title="Person × week capacity report — full population (Delivery + Manager + Non-tracking, Group column), regardless of the toggles; respects the People filters">⇣ CSV</button>
        </div>
        <div id="utilChart"></div>
        <div class="cap-legend" id="utilLegend"></div>
        <div class="sowhat" id="utilSoWhat"></div>
        <div class="util-drill" id="utilDrill"></div>
      </div>
    </div>
```

- [ ] **Step 2: CSS** — DELETE the three `.uchip` rules (the chips now use the existing `.chip-toggle` pattern). ADD, where `.uchip` was:

```css
.util-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:2px 0 8px}
#utilExploreBtn.explore-why{border-color:var(--warn);color:var(--warn);font-weight:700}
.util-head .uh-verdict{display:inline-block;font-size:calc(11px*var(--scale));font-weight:700;
  border:1px solid var(--border);border-radius:10px;padding:1px 8px;margin-left:8px;vertical-align:middle}
.util-head .uh-verdict.v-below{color:var(--warn);border-color:var(--warn)}
.util-head .uh-verdict.v-above{color:var(--pos);border-color:var(--pos)}
.util-head .uh-verdict.v-normal{color:var(--muted)}
```

(Keep the existing `.util-head` and `.util-drill` rule families.)

- [ ] **Step 3: State** — next to `var UTIL_DRILL_OPEN`, add:

```js
var UTIL_EXPLORE_OPEN=false;                     // glance/explore split (v2) — not persisted
function utilToggleExplore_(){ UTIL_EXPLORE_OPEN=!UTIL_EXPLORE_OPEN; renderUtilization(); }
```

- [ ] **Step 4: Verify** node suite + script-parse. The page will render oddly until Task 3 rewires the render (chips exist but `renderUtilChips_` still sets `.uchip` classes — fine transiently).
- [ ] **Step 5: Commit** Dashboard.html: `feat(utilization): glance/explore markup, chip-toggle scope group + verdict CSS`

---

### Task 3: Render rewiring — settled-only anchor, glance layer, explore toggle, chips

**Files:** Modify `Dashboard.html` — `renderUtilization`, `renderUtilHeader_`, `renderUtilChips_`, `renderUtilSoWhat_` (and the call sites' signatures).

- [ ] **Step 1: `renderUtilization` changes:**
  - Error path (`!capIsos.length`): also hide `#utilExploreBtn` and force `$('utilExplore').style.display='none'`; keep existing hides. Happy path re-shows the button (`style.display=''`).
  - Anchor rule (settled ONLY): replace the anchor block with — `anchor = SEL_ISO` when `SEL_ISO!==CURRENT_ISO && SEL_ISO!==provisionalIso && ut.util[SEL_ISO]!=null && settledIsos.indexOf(SEL_ISO)!==-1`; else latest settled with data; else `null` (no provisional fallback anymore). Delete `anchorState` entirely — update every function it was passed to.
  - Explore container: `$('utilExplore').style.display = UTIL_EXPLORE_OPEN ? '' : 'none';`
  - Explore button: text `UTIL_EXPLORE_OPEN?'Explore ▾':'Explore ▸'`; add class `explore-why` iff `utilVerdict_(ut.util[anchor], stats)==='below'` (`btn.className='btn'+(…?' explore-why':'')` — mind the base `btn` class).
  - Compute `var verdict = utilVerdict_(anchor!=null?ut.util[anchor]:null, stats);` once and pass it to the header renderer.
  - Skip chart/legend/so-what/drill work when `!UTIL_EXPLORE_OPEN` (cheap guard; chips too).
- [ ] **Step 2: `renderUtilHeader_(anchor, verdict, ut, npList, capMap, trkMap, split)`** — rewrite:
  - Hero line: big `%` + `utilization · <iso>` + verdict chip when non-null: `<span class="uh-verdict v-below">Below normal</span>` / `v-above` "Above normal" / `v-normal` "Normal".
  - Identity + gap sentences unchanged (anchor is always settled now — drop the `anchorState==='settled'` gate on the gap; hours only).
  - Population line, reconciled (replaces both old lines): `measures <covered> of <scope> tracking-required people · <scope−covered> without capacity data this week · <NT> non-tracking + <M> managers excluded` where covered=`ut.covered[anchor]`, scope=`npList.length`; when a chip is ON, its group is in scope, so its "excluded" clause is replaced by `<n> <group> included` (keep the sentence honest either way); append ` · (filtered)` when `filteredPersonSet_()`. Omit the without-capacity clause when it is 0.
- [ ] **Step 3: `renderUtilChips_`** — chips are now `.chip-toggle` buttons: set `nt.className = UTIL_INC_NT?'on':''` (no `uchip`), same for mgr; label text/delta logic unchanged; empty groups: `style.display='none'` as today (group of one visible button still renders acceptably).
- [ ] **Step 4: `renderUtilSoWhat_(anchor, ut, stats)`** — drop `anchorState` and its hint; DROP the trackedOnly sentence (the glance population line owns that fact now); keep hrs/people/band-verdict sentences.
- [ ] **Step 5: Verify** (node + parse + read your diff), **commit**: `feat(utilization): settled-only anchor, glance hero + verdict, explore toggle`

---

### Task 4: Chart declutter

**Files:** Modify `Dashboard.html` — `renderUtilization` (week domain), `renderUtilChart_`, `renderUtilLegend_`.

- [ ] **Step 1: Week domain ends at the live week** — in `renderUtilization`, after building/sorting `cw`, drop future weeks: `cw=cw.filter(function(w){return w.status!=='plan';});` (the capacity backdrop that justified them is gone).
- [ ] **Step 2: `renderUtilChart_(ut, cw, stats, proj, provisionalIso, anchor)`** (new trailing param; update the call):
  - DELETE the capacity backdrop block (`capMax`/`yc`/`capPts` and its area+segments) and the future-tint block (`firstPlan` — no plan weeks remain).
  - % labels: only when `wk.iso===anchor || i===0` (the projected point gets a callout instead; the provisional point keeps NO label — its tooltip carries the value). Implementation: in the `uPts` label loop, `if(!(p.iso===anchor || p.i===0) ) return;` and skip `state==='proj'`.
  - Projected callout: when `proj` exists, after the whisker draw two small `text` lines anchored `start` at `x(curIdx)+9`: `projected N%` and (when `proj.lo!=null`) `(lo–hi)`, fill `css('--muted')`, sizes 9/8, y positions `yp(proj.pct)-2` and `+9` — clear of the whisker caps.
  - Anchor emphasis on the x-axis: replace `isSel` with `isAnchor = wk.iso===anchor` for the blue/700 label styling (keep `isSel||isCur||isEdge||i%labelStep===0` as the visibility rule but swap `isSel` → `isAnchor` there too).
- [ ] **Step 3: `renderUtilLegend_`** — drop the "Capacity backdrop (hrs)" entry (and the old "Future capacity" if still present); keep Utilization/Normal range/Target/Still settling/Projected.
- [ ] **Step 4: Verify + commit**: `feat(utilization): decluttered %-only chart — backdrop removed, anchor-only labels, projected callout`

---

### Task 5: Drill, sentence-first

**Files:** Modify `Dashboard.html` — `renderUtilDrill_`.

- [ ] **Step 1:** After computing `d` (sorted contributions) and `total`:
  - Finding sentence (before the bars, normal weight text): with `top=d[0]`, `dir = total<0?'drop':'rise'`; if `Math.abs(top.pp) >= 0.6*Math.abs(total)` and `total!==0`: `The <dir> came almost entirely from <top.key> (<±x.x pp>).`; else with the top two groups: `The <dir> was driven by <G1> (<±pp>) and <G2> (<±pp>).`; when `Math.abs(total)<0.05`: `No meaningful move vs <prev>.` and skip bars. Escape group keys.
  - Bars: only `d.slice(0,3)` rows (still filtered `|pp|>=0.05`); if more groups remain, one muted row `<n> others (net <±x.x pp>)` summing the remainder (no bar).
  - Workings: replace the footer sentence with a muted hint: `All groups sum to the full <±x.x pp> move · groups only — person detail is in the CSV.`
- [ ] **Step 2: Verify + commit**: `feat(utilization): sentence-first contribution drill with collapsed tail`

---

### Task 6: Verification + final review (controller)

- [ ] Full node suite + script-parse green at HEAD.
- [ ] Whole-branch V2 review (spec V2 section vs `a16568e..HEAD` diff) on the most capable model; fix loop until READY.
- [ ] Ledger + memory updates; deployment note (Dashboard.html only, no cache bump).
