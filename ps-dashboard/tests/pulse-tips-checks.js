// Node checks for the Team Contribution Pulse row tooltips (PULSE_ROW_TIPS in
// PS Dashboard.html): every row id the server emits has a plain-English hover,
// the copy stays readable in a bubble, and the builder wires the attribute.
// Run: node "ps-dashboard/tests/pulse-tips-checks.js"
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html   = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── Extract the literal and evaluate it on its own (no DOM needed) ───────────
const m = /var PULSE_ROW_TIPS = (\{[\s\S]*?\n\});/.exec(html);
ck('PULSE_ROW_TIPS literal found', !!m);
const TIPS = m ? vm.runInNewContext('(' + m[1] + ')') : {};

// ── Every pulse row the server builds has a hover ────────────────────────────
const serverIds = [];
const idRe = /^\s*id: "([a-z]+)", label:/gm;
let r;
while ((r = idRe.exec(server))) serverIds.push(r[1]);
ck('server emits the seven pulse rows', serverIds.length === 7 &&
   ['goals', 'planned', 'tracked', 'kudos', 'pto', 'rcr', 'si'].every(id => serverIds.includes(id)));
serverIds.forEach(id => {
  const t = TIPS[id];
  ck(`row "${id}" has a tip`, !!t && typeof t.text === 'string');
  if (!t) return;
  ck(`row "${id}" tip is a readable paragraph (120–620 chars)`, t.text.length >= 120 && t.text.length <= 620);
  ck(`row "${id}" tip has a source/scope note`, typeof t.note === 'string' && t.note.length >= 20);
  ck(`row "${id}" tip is plain prose, no HTML`, !/<[a-z]/i.test(t.text) && !/<[a-z]/i.test(t.note));
});
ck('no tip for an id the server never emits', Object.keys(TIPS).every(id => serverIds.includes(id)));

// ── The copy says what the dashboard actually measures ───────────────────────
ck('goals tip states the 10 / 8 / 6 goal numbers', /10 goals/.test(TIPS.goals.text) && /8 is the minimum/.test(TIPS.goals.text) && /6 goals/.test(TIPS.goals.text));
ck('goals tip explains the growing comment ramp', /week 6/.test(TIPS.goals.text));
ck('tracked tip frames it as behaviour, not productivity', /behaviour/.test(TIPS.tracked.text) && /not productivity/.test(TIPS.tracked.text));
ck('rcr tip names the New RCR switch-over', /New RCR/.test(TIPS.rcr.text) && /Jul 26/.test(TIPS.rcr.text));
ck('pto tip carries the 100h / 80% rule in words', /100 hours/.test(TIPS.pto.text) && /80%/.test(TIPS.pto.text));

// ── Builder wiring + styling present ────────────────────────────────────────
ck('buildMetricsTableHTML reads PULSE_ROW_TIPS[row.id]', /var rowTip = PULSE_ROW_TIPS\[row\.id\]/.test(html));
ck('row label carries data-tip and data-tip-note', /data-tip="' \+ esc\(rowTip\.text\)/.test(html) && /data-tip-note="' \+ esc\(rowTip\.note/.test(html));
ck('#pulseTip is fixed-position (survives .tbl-wrap overflow clipping)', /#pulseTip \{[^}]*position:fixed/.test(html));
ck('dark mode restyles the bubble', /body\.dark-mode #pulseTip\s*\{/.test(html));
ck('delegated mouseover/mouseout listeners installed', /initPulseTips_/.test(html) && /addEventListener\('mouseover'/.test(html) && /addEventListener\('mouseout'/.test(html));

console.log(fail ? `❌ ${pass} passed, ${fail} failed` : `✅ ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
