// Node checks for the Team Radar tab (2026.W38 redesign).
// Static assertions on PS Dashboard.html — the "Recognition signal — low" callout
// is gone, the radar sits in a two-column stage with the observer's axis detail
// beside it, and the group table uses one cell shape per column.
// Run: node "ps-dashboard/tests/radar-tab-checks.js"
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function fnSource(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = html.indexOf('\n}', i);
  return html.slice(i, j + 2);
}

// ── callout removed ──────────────────────────────────────────────────────────
ck('no "Recognition signal" banner copy', !html.includes('Recognition signal'));
ck('no kudosCalloutCard element', !html.includes('kudosCalloutCard'));
ck('renderKudosCallout gone', !html.includes('renderKudosCallout'));
ck('kudos still an action-card entry', /kudos:\s+function\(\)\s+\{ return 'Recognition is near zero/.test(html));

// ── radar stage: chart + side detail ─────────────────────────────────────────
// 2026.W41: signals first — a ≤420px radar beside a grid of signal tiles.
ck('.radar-stage is a two-column grid (compact radar + signals)',
   /\.radar-stage \{\s*\n?\s*display: grid; grid-template-columns: minmax\(260px, calc\(420px \* var\(--scale\)\)\) minmax\(0, 1fr\);/.test(html));
ck('stage collapses to one column below 1100px, signals on top',
   html.includes('@media (max-width: 1100px) { .radar-stage { grid-template-columns: 1fr; } .radar-side { order: -1; } }'));
ck('canvas wrapper owns a scaled width (no height cap → no Chart.js shrink loop)',
   html.includes('position: relative; width: min(100%, calc(420px * var(--scale)));') &&
   !/\.radar-canvas-wrap canvas \{[^}]*max-height/.test(html));
ck('signal tiles are a grid', html.includes('.radar-side { display: grid; grid-template-columns: repeat(auto-fill, minmax(calc(230px * var(--scale)), 1fr));'));
ck('whole team shows every metric (RCR and SI included)',
   /all:\s+\['goals', 'tracked', 'planned', 'kudos', 'pto', 'rcr', 'si'\]/.test(html));
ck('signals sorted below-target first', fnSource('renderRadarSide_').includes('var SEV = { bad: 0, warn: 1, none: 2, good: 3 };') &&
   fnSource('renderRadarSide_').includes("tiles.sort("));
ck('signal summary pills', fnSource('renderRadarSide_').includes("' below target</span>'"));
ck('#radarSide sits inside .radar-stage next to the canvas',
   /<div class="radar-stage">\s*<div class="radar-canvas-wrap">\s*<canvas id="radarMain"><\/canvas>\s*<\/div>\s*<aside class="radar-side" id="radarSide"/.test(html));
ck('renderRadarSide_ defined once', (html.match(/function renderRadarSide_\(/g) || []).length === 1);
ck('renderRadarTab calls renderRadarSide_ with the prior polygon',
   /renderRadarSide_\(groups, activeAxes, refDataset,/.test(fnSource('renderRadarTab')));
ck('side panel shows the prior-period delta', fnSource('renderRadarSide_').includes("'</span> vs prior'"));
ck('side panel shows leads/trails in multi-group mode', fnSource('renderRadarSide_').includes("'Leads: '"));

// ── status helper: kudos never red ───────────────────────────────────────────
const statusSrc = fnSource('radarStatus_');
ck('radarStatus_ present', statusSrc.length > 0);
const radarStatus_ = new Function('RADAR_AXIS_TARGETS', statusSrc + '\nreturn radarStatus_;')({ goals: 80, kudos: 50 });
ck('at/above target → good', radarStatus_('goals', 80) === 'good');
ck('a bit below target → warn', radarStatus_('goals', 60) === 'warn');
ck('far below target → bad',   radarStatus_('goals', 20) === 'bad');
ck('kudos far below target stays warn', radarStatus_('kudos', 3) === 'warn');
ck('missing value → none',     radarStatus_('goals', null) === 'none');

// ── group table: one cell shape, right-aligned numbers ───────────────────────
const tblSrc = fnSource('buildRadarTable');
ck('table cells use rt-val / rt-sub', tblSrc.includes('class="rt-val"') && tblSrc.includes('class="rt-sub"'));
ck('numeric cells carry class num', tblSrc.includes('<td class="num">'));
ck('axis headers right-aligned', tblSrc.includes("'<th class=\"num\" title=\"' + esc(a.desc || '') + '\">'"));
ck('no inline 10px spans left in the table', !tblSrc.includes('font-size:10px'));
ck('tracked/planned headline is the compliance %', tblSrc.includes("cell(Math.round(m.trackedCompliancePct) + '%'"));
ck('composite rank uses the shared cell shape', tblSrc.includes("cell('#' + (ri + 1), Math.round(item.score) + ' pts', null)"));
ck('.num right-aligns in CSS', html.includes('.radar-tbl th.num, .radar-tbl td.num { text-align: right; }'));
ck('rt-sub rides the type scale', /\.radar-tbl \.rt-sub \{ display: block; font-size: calc\(11px \* var\(--scale\)\);/.test(html));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
