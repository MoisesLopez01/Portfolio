// Node checks for the Performance Record plain-English help and Hours at a glance
// (2026.W42): every measure column has a hover tip, every tip's Documentation
// anchor exists in the page, the shared bubble accepts .tipq elements, and the
// hours surfaces are wired. Run: node "ps-dashboard/tests/perf-record-help-checks.js"
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── The tip registry, evaluated on its own ───────────────────────────────────
const m = /var PERF_METRIC_TIPS = (\{[\s\S]*?\n\});/.exec(html);
ck('PERF_METRIC_TIPS literal found', !!m);
const TIPS = m ? vm.runInNewContext('(' + m[1] + ')') : {};

const colsM = /var PERF_COLS = \[([\s\S]*?)\];/.exec(html);
const colIds = colsM ? (colsM[1].match(/id: '([a-z]+)'/g) || []).map(s => s.match(/'([a-z]+)'/)[1]) : [];
ck('PERF_COLS has the eight measures', colIds.length === 8);
colIds.forEach(id => {
  const t = TIPS[id];
  ck(`column "${id}" has a hover tip`, !!t && typeof t.text === 'string' && typeof t.title === 'string');
  if (!t) return;
  ck(`tip "${id}" is a readable paragraph (120–560 chars)`, t.text.length >= 120 && t.text.length <= 560);
  ck(`tip "${id}" has a bar/source note`, typeof t.note === 'string' && t.note.length >= 20);
  ck(`tip "${id}" is plain prose, no HTML`, !/<[a-z]/i.test(t.text) && !/<[a-z]/i.test(t.note));
  ck(`tip "${id}" names a Documentation anchor`, typeof t.doc === 'string' && t.doc.length > 0);
  ck(`tip "${id}" names no colour (Met / Close / Missed only)`, !/\b(green|yellow|orange|red|blue)\b/i.test(t.text + ' ' + t.note));
});
ck('Hours at a glance has its own tip', !!TIPS.hours && /logged ÷ planned/.test(TIPS.hours.text));

// ── Every anchor the tips point at exists exactly once on the page ───────────
const anchors = new Set(Object.keys(TIPS).map(k => TIPS[k].doc));
anchors.forEach(id => {
  const n = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
  ck(`anchor #${id} exists once in Documentation`, n === 1);
});
ck('goals tip opens Goals Evaluation (the calculation), not the metric card', TIPS.goals.doc === 'docGoals' &&
   /id="docGoals"[\s\S]{0,200}Goals Evaluation/.test(html));
ck('time tips open the rates table', TIPS.tracked.doc === 'docRates' && TIPS.planned.doc === 'docRates' && TIPS.score.doc === 'docRates');
ck('rates table explains 3 of 4 weeks = 75%', /3 of 4 = 75%/.test(html) && /3 of 4 weeks of a month shows as 75%/.test(TIPS.goals.text));

// ── The copy answers the questions managers actually asked ───────────────────
ck('goals tip says the rate is a share of weeks', /share of checked weeks/.test(TIPS.goals.text));
ck('tracked tip states the 90% of plan basis', /90% of the hours planned/.test(TIPS.tracked.text));
ck('planned tip states the 40 h week after PTO', /40 h working week after PTO/.test(TIPS.planned.text));
ck('kudos tip says it is never a miss', /never Missed/.test(TIPS.kudos.text));

// ── Wiring ───────────────────────────────────────────────────────────────────
ck('shared bubble accepts .tipq elements', /var SEL = '\.row-label\[data-tip\], \.tipq\[data-tip\]';/.test(html));
ck('bubble shows the click-to-Documentation footer', /Click to open this section in 📖 Documentation/.test(html));
ck('keyboard focus shows the bubble', /addEventListener\('focusin'/.test(html) && /addEventListener\('focusout'/.test(html));
ck('openDocSection_ switches to the Documentation view', /function openDocSection_\(anchorId\) \{\s*switchTab\('dataref'\);/.test(html));
ck('openDocSection_ flashes the target', /classList\.add\('doc-flash'\)/.test(html) && /@keyframes docFlash/.test(html));
ck('history measure labels use perfTipLabel_', /<b>' \+ perfTipLabel_\(c\.id, meta\.label\) \+ '<\/b>/.test(html));
ck('grid headers carry the bubble + ⓘ link', /perfTipAttrs_\(key, '', \{ doc: false, docVia: true \}\)/.test(html) && /perfDocLink_\(key\)/.test(html));
ck('the ⓘ link never sorts (stops propagation)', /event\.preventDefault\(\);event\.stopPropagation\(\);openDocSection_\(/.test(html));

// ── Hours at a glance ────────────────────────────────────────────────────────
ck('perfHoursHtml_ exists', /function perfHoursHtml_\(emp, row, exc\)/.test(html));
ck('card renders the hours box when the team has the tracked metric', /var hoursHtml = hasMetric_\('tracked'\) \? '<div class="prp-box">' \+ perfHoursHtml_\(emp, row, exc\)/.test(html));
ck('grid panel renders the hours block, embedded drill skips it', /if \(cellByCol\.tracked && !\(opts && opts\.embedded\)\)/.test(html));
ck('hours rows cover week, month and quarter', /\['month', 'quarter'\]\.forEach\(function\(g\)/.test(html) && /push\('week', evW\.label/.test(html));
ck('history time cells show hours with the rate underneath', /% of target'\) \+ \(single \|\| a\.trackedHrs === null/.test(html) && /% of week'\) \+ \(single/.test(html));
ck('grid tooltips name the hours behind the rate', /perfHoursPhrase_\(hb\.trackedHrs, hb\.plannedHrs, hb\.weeks\)/.test(html));
ck('hours helpers live inside the pure engine region', (() => {
  const i0 = html.indexOf('⟦PERF-ENGINE-START⟧'), i1 = html.indexOf('⟦PERF-ENGINE-END⟧');
  const iH = html.indexOf('function perfHoursLine_');
  return i0 > 0 && iH > i0 && iH < i1;
})());

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
