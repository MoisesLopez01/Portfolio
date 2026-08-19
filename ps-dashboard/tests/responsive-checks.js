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
// KPI min is deliberately UNSCALED + auto-fit: width gain becomes more columns,
// spare tracks collapse, and a full KPI set holds one row on wide screens.
ck('kpi grid single-row on wide', html.includes('repeat(auto-fit, minmax(220px, 1fr))'));
ck('kpi grid min not scaled', !html.includes('minmax(calc(220px * var(--scale))'));
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

// ── filter-bar consistency (2026-08-18 screenshot fix) ──
ck('multiselect btn rides the scaled height rule',
   /\.fb-group select, \.fb-search-wrap input, \.fb-reset, \.fb-multi-btn \{ height: calc\(36px \* var\(--scale\)\); \}/.test(html));
ck('multiselect in the 14px type tier', html.includes('.fb-multi-btn, .fb-multi-opt,'));
ck('single-open multiselect panels', /querySelectorAll\('\.fb-multi-panel'\)\.forEach\(function\(p\) \{\s*\n?\s*if \(p !== panel\)/.test(html));

// ── Performance Record rides the type scale (2026-08-18 user feedback) ──
ck('pr-table type scaled', html.includes('.pr-table td { font-size: calc(13px * var(--scale)); }'));
ck('pr drill type scaled', html.includes('.pr-drill { font-size: calc(13px * var(--scale)); }'));
ck('pr KPI value scaled',  html.includes('.pr-kpi b { font-size: calc(20px * var(--scale)); }'));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
