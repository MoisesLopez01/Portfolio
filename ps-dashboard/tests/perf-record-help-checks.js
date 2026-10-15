// Node checks for the Performance Record plain-English help, the hour totals in
// the history table, the PTO balance and the RCR-is-context rule (2026.W42):
// every measure column has a hover tip, every tip's Documentation anchor exists
// in the page, the shared bubble accepts .tipq elements, the history is one real
// table with plain hour totals. Run: node "ps-dashboard/tests/perf-record-help-checks.js"
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
ck('no Hours-at-a-glance tip (block removed 2026-10-14)', !TIPS.hours);
ck('RCR tip says it is not in the rocketeer\'s control', /not something the rocketeer controls/.test(TIPS.rcr.text) && /Context only/.test(TIPS.rcr.note));
ck('PTO tip leads with the balance in hours', /PTO balance in hours/.test(TIPS.pto.text));
ck('time tips promise plain totals, no ratio', /plain total/.test(TIPS.tracked.text) && /plain total/.test(TIPS.planned.text));

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

// ── Hours in the history table (2026-10-14: plain totals, no block, no ratio) ─
ck('Hours at a glance block is gone',  !/perfHoursHtml_|perfHoursRows_|pr-hours|Hours at a glance/.test(html.replace(/\/\/[^\n]*/g, '')));
ck('history time cells are plain hour totals', /c\.id === 'tracked'\) t = a\.trackedHrs === null \? '—' : perfFmtHrs_\(a\.trackedHrs\);/.test(html) &&
                                               /c\.id === 'planned'\) t = a\.plannedHrs === null \? '—' : perfFmtHrs_\(a\.plannedHrs\);/.test(html));
ck('no "% of target" / "h/wk" sub-line in the history table', !/% of target'/.test(html) && !/\/wk'/.test(html));
ck('history is ONE real table (header and rows share columns)', /<table class="prp-htable" style="min-width:' \+ Math\.max\(560, 118 \+ buckets\.length \* 56\) \+ 'px">' \+ head \+ rows \+ '<\/table>/.test(html) &&
                                                                 /var head = '<colgroup><col style="width:118px">'/.test(html) && !/grid-template-columns:' \+ colsCss/.test(html));
ck('history table is fixed-layout so the periods share the width', /\.prp-htable \{ width:100%; min-width:560px; border-collapse:separate; border-spacing:0; table-layout:fixed; \}/.test(html));
ck('history measure column is sticky in the table', /\.prp-htable th\.prp-c0, \.prp-htable td\.prp-c0 \{ position:sticky; left:0;/.test(html));
ck('grid tooltips name the hours behind the rate', /perfHoursPhrase_\(hb\.trackedHrs, hb\.plannedHrs, hb\.weeks\)/.test(html));
ck('hour helpers live inside the pure engine region', (() => {
  const i0 = html.indexOf('⟦PERF-ENGINE-START⟧'), i1 = html.indexOf('⟦PERF-ENGINE-END⟧');
  const iH = html.indexOf('function perfFmtHrs_');
  return i0 > 0 && iH > i0 && iH < i1;
})());

// ── PTO balance instead of a bare "Good" (2026-10-14) ────────────────────────
ck('computeRkScore carries ptoBalance', /ptoBalance: \(wd\.ptoHealth && wd\.ptoHealth\.balance != null/.test(html));
ck('bucket aggregate carries ptoBalance', /ptoBalance:\s+lastNonNull\('ptoBalance'\)/.test(html));
ck('history PTO cell shows the balance with the state underneath', /t = perfFmtHrs_\(a\.ptoBalance\); sub = v >= 1 \? 'Good' : 'At risk';/.test(html));
ck('evaluated-week tile names the balance', /'PTO balance ' \+ perfFmtHrs_\(rk\.ptoBalance\)/.test(html));
ck('evidence PTO block leads with the balance', /<b>Balance ' \+ perfFmtHrs_\(ptoBal\) \+ '<\/b>/.test(html));
ck('grid PTO tooltip names the balance', /tip \+= ' · balance ' \+ perfFmtHrs_\(pb\.ptoBalance\)/.test(html));

// ── RCR is context, not a focus (2026-10-14) ─────────────────────────────────
ck('story input no longer builds an rcr block', !/weeks: weeks, rcr: rcr,/.test(html) && !/rcrLine/.test(html));
ck('card summary lists strength + gap only', /\[story\.strength, story\.gap\]\.filter\(Boolean\)/.test(html));
ck('flag counts skip RCR', /x\.sig === 'r' && x\.col\.id !== 'rcr'/.test(html) && /x\.sig === 'y' && x\.col\.id !== 'rcr'/.test(html));
ck('lane driver skips RCR', /c\.id !== 'pto' && c\.id !== 'rcr'/.test(html));
ck('row reading skips RCR', /!x\.notEval && x\.col\.id !== 'rcr'/.test(html));
ck('evidence RCR block is informational', /id === 'kudos' \|\| id === 'rcr'/.test(html));
ck('Documentation says RCR is context only', /<strong>Context only<\/strong>: not something the rocketeer controls/.test(html));

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
