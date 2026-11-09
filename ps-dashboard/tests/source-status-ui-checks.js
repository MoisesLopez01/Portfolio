// Node checks for the Source Status client rendering (spec 2026-11-09 §6).
// Run: node "ps-dashboard/tests/source-status-ui-checks.js"
const fs   = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond) { if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); } }

const START = '/* SOURCE-STATUS-UI:START */', END = '/* SOURCE-STATUS-UI:END */';
const i0 = html.indexOf(START), i1 = html.indexOf(END);
if (i0 < 0 || i1 < 0) { console.error('❌ SOURCE-STATUS-UI block not found in PS Dashboard.html'); process.exit(1); }
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
let METRICS = { rcr: true, planned: true, tracked: true };
const hasMetric_ = m => !!METRICS[m];
eval(html.slice(i0, i1));

const S = [
  { key: 'tempo_tracked', label: 'Tempo Tracked', status: 'ok', coversPeriod: '2026.W46', lastUpdatedLabel: '2026-11-09 (2026.W46)', nextExpectedLabel: '2026-11-10 (2026.W46)', detail: 'Run ok in 40 s' },
  { key: 'tempo_capacity', label: 'Tempo Capacity', status: 'stale', coversPeriod: '2026.W44', lastUpdatedLabel: '2026-10-30 (2026.W44)', nextExpectedLabel: '', detail: 'No update for 10 days (limit 8 days)' },
  { key: 'rcr', label: 'RCR <TCC>', status: 'pending', coversPeriod: 'Sep 26', lastUpdatedLabel: '', nextExpectedLabel: '', detail: '' },
  { key: 'digest', label: 'Monday digest', status: 'ok', coversPeriod: '', lastUpdatedLabel: '', nextExpectedLabel: '', detail: '' },
];

const rows = renderSourceStatusRows(S);
ck('one <tr> per visible source', (rows.match(/<tr>/g) || []).length === 4);
ck('stale lozenge', /src-loz-stale'>Stale</.test(rows));
ck('labels escaped', /RCR &lt;TCC&gt;/.test(rows));
ck('dash for empty last updated', /<td>—<\/td>/.test(rows));
ck('empty state names the installer', /installSourceStatusTriggers/.test(renderSourceStatusRows([])));

METRICS = { rcr: false, planned: true, tracked: true };
ck('team without RCR hides the RCR row', !/RCR &lt;TCC&gt;/.test(renderSourceStatusRows(S)));
METRICS = { rcr: true, planned: true, tracked: true };

const pillBad = sourcePillText(S);
ck('pill names stale source', pillBad.text === '⚠ Tempo Capacity stale');
ck('pill tooltip lists sources', /Tempo Tracked: ok · 2026-11-09 \(2026\.W46\)/.test(pillBad.title));
ck('pill ignores digest + pending', !/digest|RCR/.test(pillBad.text));
ck('pill all current', sourcePillText([S[0], S[2]]).text === '✓ All sources current');
ck('pill empty', sourcePillText([]).text === '↻ Data freshness: pending');

ck('table body placeholder present', html.indexOf('id="drSourcesBody"') !== -1);
ck('old static Netsuite Kudos row removed', html.indexOf('<td>Kudos given</td><td>Netsuite Export</td>') === -1);

console.log('source-status-ui-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
