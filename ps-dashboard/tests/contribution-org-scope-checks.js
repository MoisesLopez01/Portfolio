// Node checks for Contribution.js — the org-scoped export and the merged RCR
// axis (spec 2026-10-13 org-scoped contributor intelligence):
//   • readRcrAxis_      — "3. RCR" (FY26-) + "New RCR" (FY27+) on one month axis,
//                          rate wins on overlap, empty month columns skipped,
//                          Internal ID join with name fallback.
//   • resolveOrgScope_  — BFS over Supervisor, bridges through inactive rows,
//                          never includes the leader's own row.
//   • groupRcr_         — the dashboard's team method (mean of the tracking-
//                          mandated, non-ramp-up subset for a rate month).
//   • orgCandidatesFrom_ / orgSheetName_ / the end-to-end org run against a
//     recording Sheets fake (banner, headers, who is and is not in the tabs).
// Run: node "ps-dashboard/tests/contribution-org-scope-checks.js"
const fs   = require('fs');
const path = require('path');
const dir  = path.join(__dirname, '..');

global.Logger = { log: function () {} };

// ── Fakes ────────────────────────────────────────────────────────────────────
function dataSheet(rows) {
  return {
    getLastRow:    () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange:      (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
    getDataRange:  () => ({ getValues: () => rows.map(r => r.slice()) }),
  };
}
// Output sheets: every write is recorded; every formatting call chains.
const OUT = {};
function outSheet(name) {
  const rec = { name, values: [], deleted: false };
  const rangeProxy = (r, c) => {
    const p = new Proxy({}, {
      get: (_, k) => {
        if (k === 'setValues') return v => { rec.values.push({ r, c, v }); return p; };
        if (k === 'setValue')  return v => { rec.values.push({ r, c, v: [[v]] }); return p; };
        if (k === 'getValues') return () => [[]];
        return () => p;
      },
    });
    return p;
  };
  const sh = new Proxy({}, {
    get: (_, k) => {
      if (k === 'getRange')      return (r, c) => rangeProxy(r, c);
      if (k === 'getName')       return () => name;
      if (k === 'getLastColumn') return () => 30;
      if (k === 'getMaxColumns') return () => 30;
      if (k === 'getLastRow')    return () => 0;
      if (k === '__rec')         return rec;
      return () => sh;
    },
  });
  OUT[name] = { sheet: sh, rec };
  return sh;
}
const SHEETS = {}, ROSTER = {}, GOALS = {};
let fixtureId = 0;
const ACTIVE_SS = {
  getId:          () => 'container-' + fixtureId,
  getSheetByName: n => SHEETS[n] || (OUT[n] && !OUT[n].rec.deleted ? OUT[n].sheet : null),
  getSheets:      () => Object.values(SHEETS).concat(Object.values(OUT).filter(o => !o.rec.deleted).map(o => o.sheet)),
  insertSheet:    n => outSheet(n),
  deleteSheet:    sh => { sh.__rec.deleted = true; },
  setActiveSheet: () => {},
};
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ACTIVE_SS,
  openById: id => ({
    getId: () => id,
    getSheetByName: n => ROSTER[n] || GOALS[n] || null,
    getSheets: () => [],
  }),
  BorderStyle: { DOTTED: 'DOTTED' },
  getUi: () => ({ alert: () => {}, createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Utilities = { formatDate: () => 'Oct 13, 2026 09:00' };
global.Session   = { getScriptTimeZone: () => 'UTC', getActiveUser: () => ({ getEmail: () => 'tester@servicerocket.com' }) };
global.HtmlService = { createHtmlOutputFromFile: () => ({ setWidth() { return this; }, setHeight() { return this; } }) };
// From other project files Contribution.js leans on.
global.getTempoTrackedHrs_ = () => new Map();
global.requireMaintainer_  = () => 'tester@servicerocket.com';

// eval() loads this project's own Apps Script sources into Node — the same
// harness every sibling test in this folder uses; nothing external is executed.
eval(fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'Contribution.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++; console.error('  ❌ ' + name + (detail !== undefined ? '\n     ' + detail : ''));
}
const near = (a, b) => a !== null && a !== undefined && Math.abs(a - b) < 1e-9;

// ── Fixture ──────────────────────────────────────────────────────────────────
const longAgo = new Date(Date.now() - 400 * 86400000);
const lastMonth = new Date(Date.now() - 30 * 86400000);
const RH = ['Internal ID', 'Employee Number', 'Name', 'Department', 'Job Title', 'Job Profile Category', 'Class',
            'Level', 'Supervisor', 'Key Location', 'Employee Status', 'Hire Date', 'Email', 'Ramp-Up', 'Termination/Release Date'];
const row = (id, num, name, dept, title, cls, lvl, sup, status, hire, extra) => Object.assign(
  [id, num, name, dept, title, 'Other', cls, lvl, sup, 'Remote', status, hire, name.toLowerCase().replace(/ /g, '.') + '@servicerocket.com', '', ''],
  extra || {});
const PS = 'Professional Services', CORP = 'Corporate';
ROSTER['Data'] = dataSheet([RH,
  row('108', '20108', 'Ceo Person',     'Executive',        'Chief Executive Officer',  CORP, 'M8', '',               'Active', longAgo),
  row('100', '20100', 'Gon Riquelme',   'Service Delivery', 'Director, Services',       PS,   'M6', 'Ceo Person',     'Active', longAgo),
  row('101', '20101', 'Ana Lead',       'Service Delivery', 'Senior Manager, Services', PS,   'M5', 'Gon Riquelme',   'Active', longAgo),
  row('102', '20102', 'Ben Consultant', 'Service Delivery', 'Senior Consultant',        PS,   'I4', 'Ana Lead',       'Active', longAgo),
  row('103', '20103', 'Carl Gone',      'Service Delivery', 'Manager, Services',        PS,   'M4', 'Gon Riquelme',   'Terminated', longAgo),
  row('104', '20104', 'Dana Report',    'Service Delivery', 'Consultant',               PS,   'I3', 'Carl Gone',      'Active', longAgo),
  row('105', '20105', 'Eve Other',      'Service Delivery', 'Consultant',               PS,   'I3', 'Other Director', 'Active', longAgo),
  row('106', '20106', 'Fay Ramp',       'Service Delivery', 'Consultant',               PS,   'I3', 'Ana Lead',       'Active', lastMonth),
  row('107', '20107', 'Gus Ops',        'Operations',       'Operations Analyst',       CORP, 'I3', 'Gon Riquelme',   'Active', longAgo),
]);
ROSTER['Contractors Data'] = dataSheet([RH,
  row('200', '',      'Hank Crew',      'Service Delivery', 'Crew Member',              'Contractors', '', 'Ana Lead', 'Active', longAgo),
  row('201', '',      'Ivy Released',   'Service Delivery', 'Crew Member',              'Contractors', '', 'Ana Lead', 'Active', longAgo, { 14: '2026-01-31' }),
]);
GOALS['RD'] = dataSheet([['rocketeer', 'goal id', 'goal status', 'comment date', 'commentator', 'fiscal quarter']]);

const RCR_H = ['Employee ID', 'Employee Name', 'Employee Status', 'Job Category', 'Employee Class', 'Job Level',
               'Supervisor', 'Resource Region', 'Tenure (years)', 'Termination Date', 'May 26', 'Jun 26', 'YTD'];
const rcrRow = (id, name, may, jun, ytd, term) => [id, name, 'Active', 'Services Delivery Utilization', PS, 'I3', '', 'Remote', 2, term || '', may, jun, ytd];
SHEETS['3. RCR'] = dataSheet([RCR_H,
  rcrRow('101', 'Ana Lead',       1.0, 1.1, 1.05),
  rcrRow('102', 'Ben Consultant', 2.1, 2.2, 2.15),
  rcrRow('104', 'Dana Report',    0.8, 0.9, 0.85),
  rcrRow('105', 'Eve Other',      3.1, 3.2, 3.15),
  rcrRow('106', 'Fay Ramp',       '',  '',  ''),
  rcrRow('109', 'Old Timer',      1.0, 1.0, 1.0, '2026-05-31'),   // terminated → skipped
]);
const NEW_H = ['Internal ID', 'Employee', 'Class', 'Job Level', 'Supervisor', 'Status',
               '2026.06 RCR', '2026.07 RCR', '2026.08 RCR', '2026.09 RCR'];
SHEETS['New RCR'] = dataSheet([NEW_H,
  ['101',  'Ana Lead',       PS, 'M5', 'Gon Riquelme', 'Active', '',  1.2, 1.4, ''],
  ['1,02', 'Ben Consultant', PS, 'I4', 'Ana Lead',     'Active', 9.9, 2.0, 2.8, ''],   // comma-formatted ID; Jun overlap
  ['',     'Dana Report',    PS, 'I3', 'Carl Gone',    'Active', '',  1.1, 1.0, ''],   // no ID → name fallback
  ['105',  'Eve Other',      PS, 'I3', 'Other',        'Active', '',  0.9, 0.9, ''],
  ['106',  'Fay Ramp',       PS, 'I3', 'Ana Lead',     'Active', '',  3.0, 3.0, ''],
  ['999',  'Nobody Known',   PS, 'I3', '',             'Active', '',  5.0, 5.0, ''],   // not on the roster: own row only
]);
SHEETS['1. Revenue Contribution'] = dataSheet([['Employee ID', 'YTD'], ['101', 1000], ['102', 2000]]);
SHEETS['2. TCC A+B']              = dataSheet([['Employee ID', 'YTD'], ['101', 900],  ['102', 950]]);
SHEETS['SI'] = dataSheet([['Employee Number', 'Small Improvements Manager Rating FY26Q3'], ['20102', 4], ['20101', 3]]);

// ── readRcrAxis_ ─────────────────────────────────────────────────────────────
const rosterData = loadRosterSheet_();
const crewData   = loadContractorsSheet_();
const axis = readRcrAxis_(loadSheet_(ACTIVE_SS, '3. RCR'), loadSheet_(ACTIVE_SS, 'New RCR'), rosterNameIdMap_(rosterData, crewData));
ck('axis months, oldest → newest, empty Sep skipped',
   axis.months.map(m => m.name).join('|') === 'May 26|Jun 26|Jul 26|Aug 26', axis.months.map(m => m.name).join('|'));
ck('latest month is Aug 26 from New RCR',           axis.latest && axis.latest.name === 'Aug 26' && axis.latest.source === 'rate');
ck('trend window = last three populated months',   axis.lastMonths.join('|') === 'Jun 26|Jul 26|Aug 26');
ck('Jun 26 is in both tabs → New RCR rate wins (axis)',  axis.months[1].source === 'rate');
ck('Jun 26 rate wins per person (9.9, not 2.2)',   near(axis.byId.get('102').get('Jun 26').value, 9.9));
ck('May 26 stays a 3. RCR ratio month',            axis.months[0].source === 'ratio' && near(axis.byId.get('102').get('May 26').value, 2.1));
ck('comma-formatted Internal ID joins ("1,02")',   near(axis.byId.get('102').get('Aug 26').value, 2.8));
ck('blank Internal ID falls back to the name',     axis.byId.has('104') && near(axis.byId.get('104').get('Jul 26').value, 1.1));
ck('3. RCR row with a Termination Date is skipped', !axis.byId.has('109'));
ck('unknown person without roster match is dropped', !axis.byId.has('999'));
ck('rcrSeriesFor_ is chronological',               rcrSeriesFor_(axis, '102').map(p => p.month).join('|') === 'May 26|Jun 26|Jul 26|Aug 26');
ck('detectLastClosedMonths_ copies the window',    detectLastClosedMonths_(axis).join('|') === 'Jun 26|Jul 26|Aug 26');
ck('empty axis has no latest and no window',       detectLastClosedMonths_(readRcrAxis_(null, null, new Map())).length === 0);

// ── orgCandidatesFrom_ ───────────────────────────────────────────────────────
const cands = orgCandidatesFrom_(rosterPeople_(rosterData, crewData));
const cand  = n => cands.find(c => c.name === n);
ck('candidates are sorted by name',                 cands.map(c => c.name).join('|') === 'Ana Lead|Ceo Person|Gon Riquelme');
ck('Gon: 2 active direct (Carl is terminated), 6 in org via the bridge',
   cand('Gon Riquelme') && cand('Gon Riquelme').directReports === 2 && cand('Gon Riquelme').orgSize === 6,
   JSON.stringify(cand('Gon Riquelme')));
ck('Ana: Ben, Fay, Hank are direct; released crew Ivy is not',
   cand('Ana Lead') && cand('Ana Lead').directReports === 3 && cand('Ana Lead').orgSize === 3, JSON.stringify(cand('Ana Lead')));
ck('CEO sees the whole tree (7)',                   cand('Ceo Person') && cand('Ceo Person').orgSize === 7);
ck('a terminated manager is not offered',           !cand('Carl Gone'));
ck('an IC with no reports is not offered',          !cand('Eve Other'));
ck('candidate carries the job title',               cand('Gon Riquelme').title === 'Director, Services');

// ── orgSheetName_ ────────────────────────────────────────────────────────────
ck('company run keeps the configured tab name',     orgSheetName_('📊 Contributor Intelligence', null) === '📊 Contributor Intelligence');
ck('org run suffixes the leader',                   orgSheetName_('📊 Contributor Intelligence', { orgLeader: 'Gon Riquelme' }) === '📊 Contributor Intelligence · Gon Riquelme');
ck('tab names are capped at 100 chars',             orgSheetName_('📊 Contributor Intelligence', { orgLeader: 'X'.repeat(120) }).length === 100);

// ── End-to-end org run ───────────────────────────────────────────────────────
const writtenRows = name => (OUT[name] ? OUT[name].rec.values : []).flatMap(w => w.v);
const cellText    = name => writtenRows(name).flat().map(v => String(v)).join('\n');
const nameCells   = name => writtenRows(name).filter(r => r.length > 10).map(r => r[2]);

const res = runContributorIntelligence_({ orgLeader: 'gon riquelme' });   // case-insensitive
const C = '📊 Contributor Intelligence · Gon Riquelme';
const N = '📊 Non-Contributor Intelligence · Gon Riquelme';
const K = '📊 Crew Member Intelligence · Gon Riquelme';
ck('leader resolves to the roster spelling',        res.leader === 'Gon Riquelme');
ck('org size: 6 active under Gon (Carl out, Gon out, Eve out)', res.orgSize === 6, JSON.stringify(res));
ck('segments: 4 contributors, 1 non-contributor, 1 crew', res.contributors === 4 && res.nonContributors === 1 && res.crew === 1, JSON.stringify(res));
ck('three org tabs written',                        res.sheets.join('|') === [C, N, K].join('|'), res.sheets.join('|'));
ck('latest month and method reported',              res.latestMonth === 'Aug 26' && res.rcrMethod === 'direct-rate');
ck('org RCR = mean of Ana 1.4, Ben 2.8, Dana 1.0 (Fay ramping up, Hank crew, Gus no value)',
   res.rcr.method === 'direct-rate' && res.rcr.n === 3 && near(res.rcr.value, 1.73), JSON.stringify(res.rcr));

const ctext = cellText(C);
ck('contributor tab: the leader is in the banner, not in a row',
   /GON RIQUELME ORG/.test(ctext) && !nameCells(C).includes('Gon Riquelme'));
ck('contributor tab: banner names the org scope and the exclusion',
   /Org scope: 6 rocketeers/.test(ctext) && /Gon Riquelme's own record is excluded/.test(ctext));
ck('contributor tab: banner carries the org RCR and method',
   /RCR \(Aug 26\): 1\.73/.test(ctext) && /direct rate/.test(ctext));
ck('contributor tab: nobody outside the org',       !/Eve Other|Ceo Person|Old Timer|Nobody Known/.test(ctext));
ck('contributor tab: Ana, Ben, Dana, Fay are rows', ['Ana Lead', 'Ben Consultant', 'Dana Report', 'Fay Ramp'].every(n => nameCells(C).includes(n)));
ck('contributor tab: headers carry the legacy YTD label and the three axis months',
   /FY26 YTD RCR/.test(ctext) && /Jun 26 RCR/.test(ctext) && /Jul 26 RCR/.test(ctext) && /Aug 26 RCR/.test(ctext) && /RCR Tier/.test(ctext));
const benRow = writtenRows(C).find(r => r[2] === 'Ben Consultant');
const anaRow = writtenRows(C).find(r => r[2] === 'Ana Lead');
const danaRow = writtenRows(C).find(r => r[2] === 'Dana Report');
ck('Ben: FY26 YTD 2.15 | Jun 9.9 (rate won) | Jul 2.0 | Aug 2.8 → Champion on the latest month',
   benRow && benRow[9] === '2.15' && benRow[10] === '9.90' && benRow[11] === '2.00' && benRow[12] === '2.80' && benRow[13] === 'Champion', JSON.stringify(benRow));
ck('Ana: 1.4 → Watch (dashboard threshold 1.5, not the old 2.0)', anaRow && anaRow[13] === 'Watch', JSON.stringify(anaRow));
ck('Dana: 1.0 → Critical',                          danaRow && danaRow[13] === 'Critical', JSON.stringify(danaRow));
ck('rows are bucketed Critical → Watch → Healthy → Champion',
   nameCells(C).filter(n => ['Dana Report', 'Ana Lead', 'Ben Consultant'].includes(n)).join('|') === 'Dana Report|Ana Lead|Ben Consultant');
ck('group summaries use the latest-month label',    /RCR \(Aug 26\)/.test(ctext) && !/Avg YTD RCR/.test(ctext));
ck('non-contributor tab holds Gus only',            nameCells(N).includes('Gus Ops') && !nameCells(N).includes('Eve Other'));
ck('crew tab holds Hank, not the released Ivy',     /Hank Crew/.test(cellText(K)) && !/Ivy Released/.test(cellText(K)));

// ── Org with empty segments: no tab written, stale tab removed ──────────────
outSheet('📊 Non-Contributor Intelligence · Ana Lead');       // left over from an earlier run
const res2 = runContributorIntelligence_({ orgLeader: 'Ana Lead' });
ck('Ana org: Ben, Fay, Hank (3), leader excluded',  res2.orgSize === 3 && res2.contributors === 2 && res2.crew === 1 && res2.nonContributors === 0, JSON.stringify(res2));
ck('empty segment tab is not written',             !res2.sheets.includes('📊 Non-Contributor Intelligence · Ana Lead'));
ck('stale empty-segment tab is removed',           OUT['📊 Non-Contributor Intelligence · Ana Lead'].rec.deleted === true);
ck('Ana org RCR excludes Fay (ramp-up): Ben only', res2.rcr.n === 1 && near(res2.rcr.value, 2.8), JSON.stringify(res2.rcr));

// ── Company run is unchanged in shape ────────────────────────────────────────
const resAll = runContributorIntelligence_(null);
ck('company run writes the three configured tabs',
   resAll.sheets.join('|') === '📊 Contributor Intelligence|📊 Non-Contributor Intelligence|📊 Crew Member Intelligence', resAll.sheets.join('|'));
ck('company run keeps every active person (9)',    resAll.orgSize === 9 && resAll.leader === null, JSON.stringify(resAll));
ck('company tab has no org banner line',           !/Org scope:/.test(cellText('📊 Contributor Intelligence')));
ck('company tab still lists Gon and Eve',          nameCells('📊 Contributor Intelligence').includes('Gon Riquelme') && nameCells('📊 Contributor Intelligence').includes('Eve Other'));

// ── Errors the dialog shows ──────────────────────────────────────────────────
const throwsWith = (fn, re) => { try { fn(); return false; } catch (e) { return re.test(e.message); } };
ck('unknown leader throws a roster message',       throwsWith(() => runContributorIntelligence_({ orgLeader: 'Nobody Here' }), /not found on the Roster/));
ck('leader with no reports throws',                throwsWith(() => runContributorIntelligence_({ orgLeader: 'Ben Consultant' }), /no active reports/));
ck('public org entry rejects an empty name',       throwsWith(() => runContributorIntelligenceForOrg(''), /Pick an org leader/));
ck('public candidates endpoint returns the picker list', listOrgReportCandidates().length === 3);

// ── resolveOrgScope_ on a bare map ───────────────────────────────────────────
const m = new Map([
  ['1', { name: 'Top Boss',  supervisor: '',          empStatus: 'Active' }],
  ['2', { name: 'Mid Gone',  supervisor: 'Top Boss',  empStatus: 'Terminated' }],
  ['3', { name: 'Leaf One',  supervisor: 'Mid Gone',  empStatus: 'Active' }],
  ['4', { name: 'Leaf Two',  supervisor: 'top  boss', empStatus: 'Active' }],   // spacing/case in the Supervisor cell
  ['5', { name: 'Stranger',  supervisor: 'Someone',   empStatus: 'Active' }],
  ['6', { name: 'Self Loop', supervisor: 'Self Loop', empStatus: 'Active' }],
]);
const sc = resolveOrgScope_(m, 'TOP BOSS');
ck('scope walks through the terminated manager',   [...sc.scope].sort().join() === '2,3,4');
ck('scope never contains the anchor',              !sc.scope.has('1') && sc.anchor && sc.anchor.name === 'Top Boss');
ck('unknown anchor → null, empty scope',           resolveOrgScope_(m, 'Ghost').anchor === null && resolveOrgScope_(m, 'Ghost').scope.size === 0);
ck('self-supervising row is only its own tree',    resolveOrgScope_(m, 'Self Loop').scope.size === 0);

// ── groupRcr_ on bare records ────────────────────────────────────────────────
const rate = { latest: { name: 'Aug 26', source: 'rate' } };
const emps = [
  { rcrCurrent: 1.0 }, { rcrCurrent: 3.0 },
  { rcrCurrent: 9.0, isRampUp: true }, { rcrCurrent: 9.0, tracksTime: false },
  { rcrCurrent: 9.0, onLeave: true },  { rcrCurrent: 9.0, isCrewMember: true }, { rcrCurrent: null },
];
const g = groupRcr_(emps, rate);
ck('rate month: mean of the counted subset only',  g.method === 'direct-rate' && g.n === 2 && near(g.value, 2.0), JSON.stringify(g));
const ratio = { latest: { name: 'Jun 26', source: 'ratio' } };
const g2 = groupRcr_([{ rcrCurrent: 1.0, rcLatest: 100, tccLatest: 200 }, { rcrCurrent: 3.0, rcLatest: 300, tccLatest: 100 }], ratio);
ck('ratio month: SUM(RC)/SUM(TCC) = 400/300, not the mean 2.0', g2.method === 'sum-ratio' && near(g2.value, 1.33), JSON.stringify(g2));
const g3 = groupRcr_([{ rcrCurrent: 1.0 }, { rcrCurrent: 3.0 }], ratio);
ck('ratio month without RC/TCC falls back to the mean', g3.method === 'mean-fallback' && near(g3.value, 2.0));
ck('no latest month → null',                       groupRcr_(emps, { latest: null }).value === null);
ck('empty pool keeps the month and method',        groupRcr_([{ rcrCurrent: null }], rate).n === 0 && groupRcr_([{ rcrCurrent: null }], rate).month === 'Aug 26');

// ── Tier thresholds follow the dashboard ─────────────────────────────────────
ck('classifyRCR_ 1.4 → Watch, 2.4 → Healthy, 2.6 → Champion',
   classifyRCR_(1.4, '').tier === 'Watch' && classifyRCR_(2.4, '').tier === 'Healthy' && classifyRCR_(2.6, '').tier === 'Champion');
ck('tier legend is derived from CONFIG',           /1\.01–1\.5\s+Watch/.test(tierLegend_()) && /> 2\.5\s+Champion/.test(tierLegend_()));

if (fail) { console.error('❌ contribution-org-scope-checks: ' + fail + ' failed, ' + pass + ' passed'); process.exit(1); }
console.log('✅ contribution-org-scope-checks: ' + pass + ' checks passed');
