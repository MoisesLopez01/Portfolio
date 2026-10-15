// Node checks for the Performance Record "open in Tempo" links (2026.W42):
// an hour total in the history table and in the week-by-week evidence opens the
// same person and period in Tempo's own Logged time / Planned time report,
// grouped by space and work item. Server: the worker id comes off the
// "Capacity Tempo" tab and rides on each employee row; the reports base rides on
// meta. Run: node "ps-dashboard/tests/perf-record-tempo-links-checks.js"
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The files are CRLF on disk (core.autocrlf); fold to LF so the function
// extractor and the multi-line patterns below read them the same everywhere.
const lf = (s) => s.split('\r\n').join('\n');
const html = lf(fs.readFileSync(path.join(__dirname, '..', 'PS Dashboard.html'), 'utf8'));
const server = lf(fs.readFileSync(path.join(__dirname, '..', 'PS Contribution Report.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function fnSource(src, name) {
  const m = new RegExp('\\nfunction ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n').exec(src);
  return m ? m[0] : '';
}

// ── Pure helpers live inside the engine region and read no page state ────────
const engStart = html.indexOf('⟦PERF-ENGINE-START⟧'), engEnd = html.indexOf('⟦PERF-ENGINE-END⟧');
ck('engine region markers present', engStart > 0 && engEnd > engStart);
const engine = html.slice(engStart, engEnd);
['perfIsoWeekRange_', 'perfTempoReportUrl_'].forEach(name => {
  const src = fnSource(engine, name);
  ck(`${name} is defined inside the engine region`, src.length > 0);
  ck(`${name} reads neither DATA, STATE nor the DOM`, !/\b(DATA|STATE|document|window)\b/.test(src));
});
['perfTempoLink_', 'perfTempoAnchor_'].forEach(name => {
  ck(`${name} is defined outside the engine region`, fnSource(html, name).length > 0 && fnSource(engine, name).length === 0);
});

// ── perfIsoWeekRange_: ISO week → Monday..Sunday, UTC-safe ───────────────────
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fnSource(engine, 'perfIsoWeekRange_') + fnSource(engine, 'perfTempoReportUrl_'), ctx);
const range = (l) => vm.runInContext('perfIsoWeekRange_(' + JSON.stringify(l) + ')', ctx);
const url = (base, kind, id, labels) => vm.runInContext('perfTempoReportUrl_(' + [base, kind, id, labels].map(x => JSON.stringify(x)).join(',') + ')', ctx);

const w41 = range('2026.W41');
ck('2026.W41 runs Mon 2026-10-05 to Sun 2026-10-11', w41 && w41.from === '2026-10-05' && w41.to === '2026-10-11');
const w1 = range('2026.W1');
ck('2026.W1 starts in the previous calendar year (2025-12-29)', w1 && w1.from === '2025-12-29' && w1.to === '2026-01-04');
const w53 = range('2020.W53');
ck('2020.W53 exists (Mon 2020-12-28)', w53 && w53.from === '2020-12-28' && w53.to === '2021-01-03');
ck('short "W41" and a non-label return null', range('W41') === null && range('October') === null && range('') === null);
ck('week 0 and week 54 return null', range('2026.W0') === null && range('2026.W54') === null);
ck('a padded label is accepted (2026.W07 = 2026.W7)', JSON.stringify(range('2026.W07')) === JSON.stringify(range('2026.W7')));

// ── perfTempoReportUrl_: the exact report Tempo opens ────────────────────────
const BASE = 'https://servicerocket-coe.atlassian.net/jira/apps/app-id/env-id/reports';
const ID = '712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98';
const logged = url(BASE, 'tracked', ID, ['2026.W41']);
ck('logged time opens the logged-time report', logged.indexOf(BASE + '/logged-time?') === 0);
ck('one week = from Monday to Sunday, 7 days', /[?&]from=2026-10-05(&|$)/.test(logged) && /[?&]to=2026-10-11(&|$)/.test(logged) && /[?&]days=7(&|$)/.test(logged));
ck('fixed period, timesheet view, week columns', /periodType=FIXED/.test(logged) && /viewType=TIMESHEET/.test(logged) && /dateDisplayType=weeks/.test(logged));
ck('grouped by space then work item (the issues behind the hours)', /groupBy=project&groupBy=issue/.test(logged));
ck('filtered to the worker, id URL-encoded (the colon)', /workerId=712020%3A7e627eb9-d4c3-4390-aa8f-d03bd4efee98$/.test(logged));
ck('workerId is the last parameter, nothing after it', logged.endsWith('workerId=' + encodeURIComponent(ID)));
ck('no planned-only parameters on the logged report', !/includeProjectPlans/.test(logged) && !/includeRejectedRecords/.test(logged));

const planned = url(BASE, 'planned', ID, ['2026.W41']);
ck('planned time opens the planned-time report', planned.indexOf(BASE + '/planned-time?') === 0);
ck('planned report carries the plan-only parameters', /includeProjectPlans=false/.test(planned) && /includeRejectedRecords=false/.test(planned));

const month = url(BASE, 'tracked', ID, ['2026.W41', '2026.W40', '2026.W39', '2026.W38']);
ck('a month spans the earliest Monday to the latest Sunday whatever the label order', /[?&]from=2026-09-14(&|$)/.test(month) && /[?&]to=2026-10-11(&|$)/.test(month) && /[?&]days=28(&|$)/.test(month));
const yearEnd = url(BASE, 'tracked', ID, ['2025.W52', '2026.W1']);
ck('a bucket across the year boundary still orders by date, not by label', /[?&]from=2025-12-22(&|$)/.test(yearEnd) && /[?&]to=2026-01-04(&|$)/.test(yearEnd));
ck('trailing slash on the base is tolerated', url(BASE + '/', 'tracked', ID, ['2026.W41']).indexOf(BASE + '/logged-time?') === 0);

ck('no base → no link', url('', 'tracked', ID, ['2026.W41']) === '' && url(null, 'tracked', ID, ['2026.W41']) === '');
ck('no worker id → no link', url(BASE, 'tracked', null, ['2026.W41']) === '' && url(BASE, 'tracked', '', ['2026.W41']) === '');
ck('no weeks → no link', url(BASE, 'tracked', ID, []) === '' && url(BASE, 'tracked', ID, null) === '');
ck('only unparseable weeks → no link', url(BASE, 'tracked', ID, ['Sep 2026']) === '');

// ── Page wiring ──────────────────────────────────────────────────────────────
ck('perfTempoLink_ reads the base from meta and the id from the employee', /DATA\.meta\.tempoReportsBase/.test(fnSource(html, 'perfTempoLink_')) && /emp\.tempoId/.test(fnSource(html, 'perfTempoLink_')));
const anchor = fnSource(html, 'perfTempoAnchor_');
ck('anchor opens in a new tab with noopener', /target="_blank" rel="noopener"/.test(anchor));
ck('anchor falls back to plain escaped text when there is no link', /if \(!href\) return esc\(text\);/.test(anchor));
ck('anchor title says which report, which period, and the grouping', /Open ' \+ what \+ ' in Tempo for /.test(anchor) && /by space and work item/.test(anchor));
ck('history time cells go through perfTempoAnchor_ (dash stays a dash)', /\(c\.id === 'tracked' \|\| c\.id === 'planned'\) && x\.t !== '—'/.test(html) && /perfTempoAnchor_\(c\.id, emp, b\.weekLabels, x\.t/.test(html));
ck('month/quarter history buckets keep their weekLabels for the link', /label: lens === 'week' \? perfShortWeek_\(b\.label\) : b\.label, weekLabels: b\.weekLabels,/.test(html));
ck('week-by-week evidence links both hour figures', /perfTempoAnchor_\('tracked', emp, wl, tH, b\.label\)/.test(html) && /perfTempoAnchor_\('planned', emp, wl, pH, b\.label\)/.test(html));
ck('link styling keeps the cell colour and hides the arrow in PNG/print', /a\.prp-hlink \{ color: inherit;/.test(html) && /\.pr-print a\.prp-hlink::after, \.pr-printing a\.prp-hlink::after \{ content: ''; \}/.test(html));
ck('the hours tips tell the reader the total is a link', /var PERF_METRIC_TIPS = \{[\s\S]*?tracked: \{[\s\S]*?Click an hour total to open the same person and period in Tempo[\s\S]*?planned: \{[\s\S]*?Click an hour total to open the same person and period in Tempo/.test(html));
ck('the card hint mentions the link', /prp-ui-hint[\s\S]{0,400}Click an hour total to open the same person and period in Tempo/.test(html));
ck('Documentation: Time tracked and Time planned cards name the Tempo report', /id="docPlanned"[\s\S]{0,1200}Tempo's Planned time report/.test(html) && /id="docTracked"[\s\S]{0,1200}Tempo's Logged time report/.test(html));
ck('Documentation: the History row explains the link', /the colour is the only judgement\. Click an hour total to open the same person and period in Tempo/.test(html));

// ── Server: worker ids off Capacity Tempo, on each employee row, base on meta ─
ck('CONFIG_PS names the Capacity Tempo tab and the reports base', /SHEET_TEMPO_WORKERS:\s+"Capacity Tempo"/.test(server) &&
   /TEMPO_REPORTS_BASE:\s+"https:\/\/servicerocket-coe\.atlassian\.net\/jira\/apps\/[0-9a-f-]+\/[0-9a-f-]+\/reports"/.test(server));
ck('buildEmployeeRows_ takes the id map and ships tempoId', /function buildEmployeeRows_\([^)]*, tempoIds, fullWeek\)/.test(server) && /tempoId:\s+\(tempoIds && tempoIds\[norm\]\) \|\| null,/.test(server));
ck('ids are read only when a time metric is on, then passed in', /const tempoIds\s+= \(hasM\("tracked"\) \|\| hasM\("planned"\)\) \? readTempoWorkerIds_\(\) : \{\};/.test(server) &&
   /buildEmployeeRows_\(roster, employeeWeeks, rcrAll, siAll, ptoAll, kudosAll, trackedAll, plannedAdjAll, goalsAll, tempoIds,\s+\{ ptoUsageByWeek: ptoUsageByWk, phByWeek: phByWeek \}\)/.test(server));
ck('meta carries the reports base', /tempoReportsBase: CONFIG_PS\.TEMPO_REPORTS_BASE \|\| null,/.test(server));
ck('the test fixture call still passes nine arguments (tempoIds optional)', /buildEmployeeRows_\(roster, weeks, \{ byEmployee: \{\} \}, \{ byEmployee: \{\} \},/.test(server));

const sctx = {};
vm.createContext(sctx);
vm.runInContext(fnSource(server, 'normPS_') + fnSource(server, 'parseTempoWorkerIds_'), sctx);
const parse = (rows) => vm.runInContext('parseTempoWorkerIds_(' + JSON.stringify(rows) + ')', sctx);
const sheet = [
  ['', '', '', '2026.W40', '2026.W41', ''],                       // ISO row
  ['Account ID', 'User', 'Team', 'Sep 28 - Oct 04 2026', 'Oct 05 - 11 2026', 'Total (hrs)'],
  ['712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98', 'Ana  Pérez ', 'SR - Delivery', 40, 40, 80],
  ['557058:295406f3-a1fc-4733-b906-dd15d021bd79', 'Charles W Talk', '', 40, 40, 80],
  ['5b1a2c3d4e5f6a7b8c9d0e1f', 'Old Style', '', 40, 40, 80],
  ['712020:duplicate-0000-0000-0000-000000000000', 'Ana Pérez', '', 0, 0, 0],
  ['TOTAL', '', '', 120, 120, 240],
  ['Last Export:', '2026-10-14T06:00:00Z', '', '', '', ''],
];
const ids = parse(sheet);
ck('maps the normalised name to the account id (spaces/case folded)', ids['ana pérez'] === '712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98' && ids['charles w talk'] === '557058:295406f3-a1fc-4733-b906-dd15d021bd79');
ck('accepts a bare 24-hex legacy id', ids['old style'] === '5b1a2c3d4e5f6a7b8c9d0e1f');
ck('first row per name wins (a duplicate never overrides)', ids['ana pérez'] === '712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98');
ck('footer rows (TOTAL, Last Export) never become ids', !ids['total'] && !ids['2026-10-14t06:00:00z'] && Object.keys(ids).length === 3);
ck('a sheet without the Account ID / User header maps nothing', Object.keys(parse([['User', 'Team'], ['Ana Pérez', 'X']])).length === 0 && Object.keys(parse([])).length === 0);
ck('the header is found even on the first row', parse([['Account ID', 'User'], ['712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98', 'Ana Pérez']])['ana pérez'] === '712020:7e627eb9-d4c3-4390-aa8f-d03bd4efee98');

// ── Render harness fixture carries what the links need ───────────────────────
const fixture = fs.readFileSync(path.join(__dirname, 'render-harness', 'fixture.js'), 'utf8');
ck('fixture ships a tempoId on most people and none on some', /tempoId: idx % 3 === 2 \? null : '712020:/.test(fixture));
ck('fixture meta ships a reports base', /tempoReportsBase: 'https:\/\/example\.atlassian\.net\/jira\/apps\/app-id\/env-id\/reports'/.test(fixture));

console.log((fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
