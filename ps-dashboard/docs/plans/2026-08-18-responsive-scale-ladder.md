# Responsive Scale Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PS Dashboard.html` adapt from phone to ultrawide by porting the Delivery Health dashboard's fluid `--scale` token ladder, including Chart.js text scaling.

**Architecture:** A `:root` `--scale` token stepped by six media queries multiplies the existing late-cascade "Typography Lift" tiers via `calc()`. New large-screen chrome rules (main width, grids, KPI value) are wrapped in `@media (min-width: 1024px)` because the phone blocks (768/640/480) sit *earlier* in the file — an unguarded later rule would override phone stacking. Chart fonts route through a `csz_(n)` helper reading the live token.

**Tech Stack:** Single-file GAS HtmlService SPA (`ps-dashboard/PS Dashboard.html`), Chart.js 4, plain-node check scripts in `ps-dashboard/tests/`.

**Spec:** `ps-dashboard/docs/specs/2026-08-18-responsive-scale-ladder-design.md`

---

## Cascade map (why the guard matters)

Order of the relevant CSS in `PS Dashboard.html` today:

1. Base rules (`:root` ~line 20, `.header` 56, `main` 110, `.kpi-grid` 152, `.perf-grid` 567)
2. **Responsive phone/tablet blocks** (`@media max-width` 768/640/480 — lines ~886–985)
3. **Typography Lift** (~1019–1110) — deliberately last so it wins; contains its own trailing 768/480 re-overrides
4. Dark mode (colour-only)

Converting existing Lift rules to `calc()` is safe (they already win everywhere and the Lift's own trailing phone blocks still re-override them). Any **new** rule added to the Lift for a selector the phone blocks also touch (`main`, `.header`, `.nav-menu-btn`, `.kpi-grid`, `.kpi-value`) MUST be inside `@media (min-width: 1024px)`.

---

### Task 1: Failing checks file

**Files:**
- Create: `ps-dashboard/tests/responsive-checks.js`

- [ ] **Step 1: Write the checks (they must fail against the unmodified HTML)**

```js
// Node checks for the responsive --scale ladder (spec 2026-08-18).
// Static assertions on PS Dashboard.html — the ladder exists, the typography
// lift multiplies it, chart fonts route through csz_, and the superseded
// min-width:1440px notch is gone.
// Run: node "ps-dashboard/tests/responsive-checks.js"
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── scale ladder ──────────────────────────────────────────────────────────────
ck('--scale: 1 declared in :root', /--scale:\s*1;/.test(html));
ck('≤420 step .94',   /@media\(max-width:420px\)\{:root\{--scale:\.94\}\}/.test(html));
ck('≥1024 step 1.08', /@media\(min-width:1024px\)\{:root\{--scale:1\.08\}\}/.test(html));
ck('≥1440 step 1.16', /@media\(min-width:1440px\)\{:root\{--scale:1\.16\}\}/.test(html));
ck('≥1920 step 1.28', /@media\(min-width:1920px\)\{:root\{--scale:1\.28\}\}/.test(html));
ck('≥2560 step 1.4',  /@media\(min-width:2560px\)\{:root\{--scale:1\.4\}\}/.test(html));
ck('≥3440 step 1.5',  /@media\(min-width:3440px\)\{:root\{--scale:1\.5\}\}/.test(html));

// ── typography lift multiplies the token ─────────────────────────────────────
ck('body tier scaled', html.includes('body { font-size: calc(15px * var(--scale)); }'));
ck('11px tier scaled', html.includes('{ font-size: calc(11px * var(--scale)); }'));
ck('12px tier scaled', html.includes('{ font-size: calc(12px * var(--scale)); }'));
ck('13px tier scaled', html.includes('{ font-size: calc(13px * var(--scale)); }'));
ck('14px tier scaled', html.includes('{ font-size: calc(14px * var(--scale)); }'));
ck('15px tier scaled', html.includes('{ font-size: calc(15px * var(--scale)); }'));
ck('h1 scaled', html.includes('.header-title h1 { font-size: calc(18px * var(--scale)); }'));

// ── large-screen chrome guarded at ≥1024 so phone blocks keep winning ────────
ck('scale chrome block guarded', html.includes('@media (min-width: 1024px) {'));
ck('main max-width scaled', html.includes('max-width: calc(1600px * var(--scale))'));
ck('kpi grid scaled',  html.includes('minmax(calc(220px * var(--scale)), 1fr)'));
ck('perf grid scaled', html.includes('minmax(calc(280px * var(--scale)), 1fr)'));
ck('kpi-value scaled', html.includes('.kpi-value { font-size: calc(28px * var(--scale)); }'));
ck('phone kpi-value override intact', html.includes('.kpi-value { font-size: 24px; }'));
ck('old 1440 notch gone (310px minmax)', !html.includes('minmax(310px, 1fr)'));
ck('old 1440 notch gone (fixed 16px body)',
   !/@media \(min-width: 1440px\) \{\s*\n\s*body \{ font-size: 16px; \}/.test(html));

// ── chart fonts route through csz_ ───────────────────────────────────────────
ck('csz_ defined once', (html.match(/function csz_\(/g) || []).length === 1);
ck('no literal chart font sizes left', !/font: \{ size: \d/.test(html));
ck('all 25 chart font sites wrapped',
   (html.match(/font: \{ size: csz_\(/g) || []).length === 25);
ck('csz_ falls back to 1', (function () {
  const i = html.indexOf('function csz_(');
  return i >= 0 && html.slice(i, i + 400).includes('|| 1;');
})());

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node "ps-dashboard/tests/responsive-checks.js"`
Expected: FAIL — only `phone kpi-value override intact` passes against today's file: `1 passed, 25 failed`, exit code 1.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/tests/responsive-checks.js"
git commit -m "test(ps): responsive scale-ladder checks (red)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Scale ladder in `:root`

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (`:root` block, ~line 20–47)

- [ ] **Step 1: Add the token + ladder** — one Edit, old string:

```css
  --th-bg:     #F8FAFC;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
```

new string:

```css
  --th-bg:     #F8FAFC;

  /* Fluid type/space scale — the typography-lift tiers and the ≥1024px chrome
     block multiply this token, so laptops and ultrawide screens get visibly
     bigger text and controls instead of a fixed column floating in margin. */
  --scale: 1;
}
@media(max-width:420px){:root{--scale:.94}}
@media(min-width:1024px){:root{--scale:1.08}}
@media(min-width:1440px){:root{--scale:1.16}}
@media(min-width:1920px){:root{--scale:1.28}}
@media(min-width:2560px){:root{--scale:1.4}}
@media(min-width:3440px){:root{--scale:1.5}}
* { box-sizing: border-box; margin: 0; padding: 0; }
```

- [ ] **Step 2: Run checks**

Run: `node "ps-dashboard/tests/responsive-checks.js"`
Expected: the 7 ladder checks now pass (`8 passed, 18 failed`), still exit 1.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): fluid --scale token ladder (420px–3440px)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Typography Lift tiers → `calc()`

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (Typography Lift section, ~lines 1025–1086)

Nine surgical Edits. Only the px value changes to `calc(Npx * var(--scale))`; selector lists are untouched. Each old string below is unique in the file.

- [ ] **Step 1: body tier** — old:

```css
body { font-size: 15px; }

/* 11px tier — was 8–9px */
```

new:

```css
body { font-size: calc(15px * var(--scale)); }

/* 11px tier — was 8–9px */
```

- [ ] **Step 2: 11px tier tail** — old: `.ws-label { font-size: 11px; }` → new: `.ws-label { font-size: calc(11px * var(--scale)); }`

- [ ] **Step 3: 12px tier tail** — old: `.weight-strip-leg-item, .dr-section-title { font-size: 12px; }` → new: `.weight-strip-leg-item, .dr-section-title { font-size: calc(12px * var(--scale)); }`

- [ ] **Step 4: 13px tier tail** — old: `.weight-desc, .perf-toggle-btn { font-size: 13px; }` → new: `.weight-desc, .perf-toggle-btn { font-size: calc(13px * var(--scale)); }`

- [ ] **Step 5: 14px tier tail** — old: `.weight-warning, .sec-toggle-info .sec-toggle-title { font-size: 14px; }` → new: `.weight-warning, .sec-toggle-info .sec-toggle-title { font-size: calc(14px * var(--scale)); }`

- [ ] **Step 6: 15px tier tail** — old: `.wc-hrs, .settings-intro, .perf-name { font-size: 15px; }` → new: `.wc-hrs, .settings-intro, .perf-name { font-size: calc(15px * var(--scale)); }`

- [ ] **Step 7: Header & chrome block** — old:

```css
/* Header & chrome */
.header-title h1 { font-size: 18px; }
.header-btn { font-size: 13px; }
.tab-btn { font-size: 13px; padding: 10px 18px; }
.perf-header-bar h2 { font-size: 15px; }
.team-brief-head h3 { font-size: 14px; }
.perf-week-pill { font-size: 13px; }
.kpi-card { padding: 20px; }
```

new:

```css
/* Header & chrome */
.header-title h1 { font-size: calc(18px * var(--scale)); }
.header-btn { font-size: calc(13px * var(--scale)); }
.tab-btn { font-size: calc(13px * var(--scale)); padding: calc(10px * var(--scale)) calc(18px * var(--scale)); }
.perf-header-bar h2 { font-size: calc(15px * var(--scale)); }
.team-brief-head h3 { font-size: calc(14px * var(--scale)); }
.perf-week-pill { font-size: calc(13px * var(--scale)); }
.kpi-card { padding: calc(20px * var(--scale)); }
```

(`.tab-btn` and header sizes are safe unguarded: the Lift's own trailing `@media (max-width: 768px)` / `480px` blocks re-override them on phones, same as today.)

- [ ] **Step 8: Filter controls** — old:

```css
/* Filter controls — taller to fit larger type */
.fb-group select, .fb-search-wrap input, .fb-reset { height: 36px; }
```

new:

```css
/* Filter controls — taller to fit larger type */
.fb-group select, .fb-search-wrap input, .fb-reset { height: calc(36px * var(--scale)); }
```

- [ ] **Step 9: Employee table padding** — old:

```css
/* Employee table — breathing room for 14px text */
.emp-table th { padding: 11px 16px; }
.emp-table td { padding: 11px 16px; }
```

new:

```css
/* Employee table — breathing room for 14px text */
.emp-table th { padding: calc(11px * var(--scale)) calc(16px * var(--scale)); }
.emp-table td { padding: calc(11px * var(--scale)) calc(16px * var(--scale)); }
```

- [ ] **Step 10: Run checks**

Run: `node "ps-dashboard/tests/responsive-checks.js"`
Expected: the 7 tier checks join the passes (`15 passed, 11 failed`), exit still 1.

- [ ] **Step 11: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): typography-lift tiers multiply the --scale token

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Scale-driven chrome block (replaces the 1440px notch)

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (~lines 1088–1093)

- [ ] **Step 1: Replace the old notch** — old:

```css
/* Widescreen: one more notch + wider grid columns */
@media (min-width: 1440px) {
  body { font-size: 16px; }
  .perf-grid { grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); }
  .kpi-grid  { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
}
```

new:

```css
/* Scale-driven chrome — width, spacing and grids grow with the --scale ladder.
   Guarded at ≥1024px: the phone/tablet blocks above (768/640/480) touch these
   same selectors and MUST keep winning on small screens. Supersedes the old
   min-width:1440px notch (body 16px + hand-tuned 310px/240px grid columns). */
@media (min-width: 1024px) {
  main { max-width: calc(1600px * var(--scale)); padding: calc(20px * var(--scale)) calc(24px * var(--scale)); }
  .header { padding: calc(14px * var(--scale)) calc(24px * var(--scale)); }
  .nav-menu-btn { width: calc(38px * var(--scale)); height: calc(38px * var(--scale)); }
  .kpi-grid  { grid-template-columns: repeat(auto-fill, minmax(calc(220px * var(--scale)), 1fr)); }
  .perf-grid { grid-template-columns: repeat(auto-fill, minmax(calc(280px * var(--scale)), 1fr)); }
  .kpi-value { font-size: calc(28px * var(--scale)); }
}
```

- [ ] **Step 2: Run checks**

Run: `node "ps-dashboard/tests/responsive-checks.js"`
Expected: all chrome checks pass (`22 passed, 4 failed`); only the 4 `csz_` checks still fail.

- [ ] **Step 3: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): scale-driven ≥1024px chrome — main width, grids, KPI value

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `csz_` helper + wrap all 25 chart font sites

**Files:**
- Modify: `ps-dashboard/PS Dashboard.html` (`_chartTheme` at ~line 10846; 25 `font: { size: N` sites at lines ~6016–10504)

- [ ] **Step 1: Add the helper directly below `_chartTheme`** (it uses `document`, which is fine here — `_chartTheme` already does; it must NOT go inside the ⟦PERF-ENGINE⟧ sentinels). Old:

```js
    legendText: dark ? '#94A3B8' : '#64748b',
  };
}
```

new:

```js
    legendText: dark ? '#94A3B8' : '#64748b',
  };
}

/**
 * Chart font size scaled by the CSS --scale ladder. Sizes bind at chart build
 * time; charts rebuild on tab switch / renderAll, so crossing a breakpoint
 * mid-session updates on the next render (deliberate — no resize plumbing).
 * Falls back to 1 when the variable is missing (stripped-CSS contexts:
 * html2canvas export clone, tests).
 */
function csz_(n) {
  var s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--scale')) || 1;
  return Math.round(n * s);
}
```

- [ ] **Step 2: Bulk-wrap the 25 sites** (all share the exact `font: { size: N` shape — verified by grep; CRLF preserved by line-wise perl):

```bash
perl -i -pe 's/font: \{ size: (\d+(?:\.\d+)?)/font: { size: csz_($1)/g' "ps-dashboard/PS Dashboard.html"
```

- [ ] **Step 3: Verify the wrap**

```bash
grep -c 'font: { size: csz_(' "ps-dashboard/PS Dashboard.html"   # expect 25
grep -c 'font: { size: [0-9]'  "ps-dashboard/PS Dashboard.html"  # expect 0 (grep exits 1)
```

- [ ] **Step 4: Run ALL check files**

```bash
node "ps-dashboard/tests/responsive-checks.js"   # expect: 26 passed, 0 failed, exit 0
node "ps-dashboard/tests/perf-record-checks.js"  # expect: all green (engine gained no document/window)
node "ps-dashboard/tests/fiscal-window-checks.js" # expect: all green
```

- [ ] **Step 5: Commit**

```bash
git add "ps-dashboard/PS Dashboard.html"
git commit -m "feat(ps): chart fonts scale with --scale via csz_ helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Visual QA (manual — tests are blind to layout)

No commit. Standing feedback: render + screenshot before calling layout work done.

- [ ] **Step 1:** Deploy or preview the web app, open DevTools responsive mode.
- [ ] **Step 2:** At 420 / 768 / 1024 / 1440 / 1920 / 2560 / 3440 px verify: text and grids grow smoothly; `main` fills ultrawide instead of floating; tab bar scrolls on phone; KPI grid stacks 2-col at 768, 1-col at 640; tables scroll horizontally, never compress.
- [ ] **Step 3:** Chart hover tooltips work at 1920+ (no zoom regression); radar point labels legible; ⬇ PNG export renders correctly; dark mode at 1920+.

**Deploy note:** frontend-only — redeploy the web app with the new `PS Dashboard.html`. No `PS_CACHE_VER` bump (report cache stores data JSON, not HTML).
