// Node checks for Contributionintelligence.js — the 4-week evidence window
// (backlog, logged time, kudos, goal self-comments) shared by the sheet and
// the HTML report.
// Run: node "ps-dashboard/tests/contribution-intelligence-checks.js"
//      add --html <path> to also write the rendered HTML report there.
const fs = require('fs');
const path = require('path');

global.Logger = { log: function () {} };
global.COLORS = { VOID_BLUE: '#0F1941', ORBE_BLUE: '#1A52B3', IVORY: '#F4F1EA',
                  LIGHT_CREAM: '#FBF8F2', ROYAL: '#3B5BDB', JUNE: '#F59E0B' };

// ── Fake spreadsheets ────────────────────────────────────────────────────────
const SHEETS = {};
function fakeSheet(name, rows) {
  return {
    getName: () => name,
    getLastColumn: () => rows[0].length,
    getRange: (r, c, nr, nc) => ({ getValues: () => rows.slice(r - 1, r - 1 + nr).map(x => x.slice(c - 1, c - 1 + nc)) }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  };
}
const ACTIVE_SS = {
  getSheetByName: n => SHEETS[n] || null,
  getSheets: () => Object.values(SHEETS),
};
const GOALS_SHEETS = {};
global.SpreadsheetApp = {
  getActiveSpreadsheet: () => ACTIVE_SS,
  openById: () => ({ getSheetByName: n => GOALS_SHEETS[n] || null }),
};

eval(fs.readFileSync(path.join(__dirname, '..', 'Contributionintelligence.js'), 'utf8'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}

// ── ciWeekKey_: every format the sources use, year always kept ───────────────
ck('padded Jira Raw label',   ciWeekKey_('2026.W07') === '2026.W7');
ck('unpadded label',          ciWeekKey_('2026.W7')  === '2026.W7');
ck('dash label',              ciWeekKey_('2026-W12') === '2026.W12');
ck('sentinel Open → ""',      ciWeekKey_('Open') === '');
ck('sentinel Epic Child → ""', ciWeekKey_('Epic Child') === '');
ck('Date → its ISO week',     ciWeekKey_(new Date(2026, 9, 5)) === '2026.W41');
ck('ISO year ≠ calendar year (Jan 1 2027 is 2026.W53)', ciWeekKeyOfDate_(new Date(2027, 0, 1)) === '2026.W53');
ck('2025 and 2026 W40 stay distinct', ciWeekKey_('2025.W40') !== ciWeekKey_('2026.W40'));

// ── Evidence window: 4 completed Mon–Sun weeks, ending before this week ─────
const EV = ciEvidenceWeeks_();
const WK = EV.map(w => w.key);
ck('window has TREND_WEEKS (4) weeks', EV.length === 4);
ck('every window week starts on a Monday', EV.every(w => w.start.getDay() === 1));
ck('every window week ends on a Sunday',   EV.every(w => w.end.getDay() === 0));
ck('weeks are consecutive', EV.every((w, i) => i === 0 || Math.round((w.start - EV[i - 1].start) / 86400000) === 7));
ck('window excludes the in-progress week', !WK.includes(ciWeekKeyOfDate_(new Date())));
ck('window ends last week', WK[3] === ciWeekKeyOfDate_(new Date(Date.now() - 7 * 86400000)));

const pad = k => k.replace(/W(\d)$/, 'W0$1');   // Jira Raw's zero-padded spelling
const [y4] = WK[3].split('.W');
const lastYearSameWeek = (parseInt(y4, 10) - 1) + '.W' + WK[3].split('.W')[1];
const thisWeek = ciWeekKeyOfDate_(new Date());
const dayIn = (i, d) => { const x = new Date(EV[i].start); x.setDate(x.getDate() + (d || 2)); return x; };

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ALICE = 'Alice Example', BOB = 'Bob Example';
const TITLE = '07.I4.2 - Senior Consultant I, Delivery';
SHEETS['Roster'] = fakeSheet('Roster', [
  ['Name', 'Job Title', 'Hire Date'],
  [ALICE, TITLE, new Date(2020, 0, 6)],
  [BOB,   TITLE, new Date(2021, 0, 4)],
]);
SHEETS['Jira Raw'] = fakeSheet('Jira Raw', [
  ['Week', 'Key', 'Work (Summary)', 'Workstream (Issue Type)', 'Space (Project)', 'Assignee'],
  [pad(WK[0]), 'A-1', '', '', '', ALICE],
  [WK[0],      'A-2', '', '', '', ALICE],
  [pad(WK[2]), 'A-3', '', '', '', ALICE],
  [pad(WK[3]), 'A-4', '', '', '', ALICE],
  [lastYearSameWeek, 'A-OLD', '', '', '', ALICE],   // must NOT fold into WK[3]
  [thisWeek,   'A-NOW', '', '', '', ALICE],         // in-progress week: out of window
  ['Open',     'A-OPEN', '', '', '', ALICE],
  [pad(WK[1]), 'B-1', '', '', '', BOB],
  [pad(WK[1]), 'U-1', '', '', '', 'Unassigned'],
]);
SHEETS['Hours'] = fakeSheet('Hours', [
  ['Rocketeer', 'Week', 'CapacityHours', 'PlannedHours', 'PTOHours', 'Tempo Tracked'],
  [ALICE, WK[0], 40, 38, 0, 36],
  [ALICE, WK[1], 40, 40, 0, 40.25],
  [ALICE, WK[3], 40, 30, 8, 30],
  [ALICE, lastYearSameWeek, 40, 0, 0, 1],          // must NOT overwrite WK[3]
]);
SHEETS['Kudos_Normalized'] = fakeSheet('Kudos_Normalized', [
  ['Recipient', 'Giver', 'Description', 'Create Date', 'Week'],
  [ALICE, 'Carol', 'Shipped the <b>cutover</b>', dayIn(1), ''],
  [ALICE, 'Dan',   'Great demo',              dayIn(3), ''],
  [ALICE, 'Erin',  'Old FY kudo',             new Date(2024, 0, 10), ''],
  [BOB,   'Carol', 'Undated, week column only', '', WK[2]],
]);
global.CONFIG_PS = { SHEET_GOALS: 'RD' };
global.getExternalSSIds_ = () => ({ goals: 'goals-id' });
GOALS_SHEETS['RD'] = fakeSheet('RD', [
  ['Rocketeer', 'Goal ID', 'Goal Name', 'Comment Date', 'Commentator'],
  [ALICE, 'G1', '', dayIn(0), ALICE],
  [ALICE, 'G1', '', dayIn(0, 3), 'alice  example'],   // normalised self-comment
  [ALICE, 'G2', '', dayIn(3), 'Some Manager'],        // not self → excluded
  [BOB,   'G1', '', dayIn(2), BOB],
  [BOB,   'G1', '', new Date(2024, 0, 10), BOB],      // outside window
]);

// ── Backlog ──────────────────────────────────────────────────────────────────
const roster = readRoster_();
const jira = readJiraRaw_();
ck('readJiraRaw_ returns the evidence window', JSON.stringify(jira.weeks) === JSON.stringify(WK));
const aJ = jira.counts.get(ALICE);
ck('backlog: padded + unpadded labels merge (WK0 = 2)', aJ.get(WK[0]) === 2);
ck('backlog: last year same week not folded in (WK3 = 1)', aJ.get(WK[3]) === 1);
ck('backlog: in-progress week excluded', !aJ.has(thisWeek));
ck('backlog: Unassigned skipped', !jira.counts.has('Unassigned'));

// ── Logged time ──────────────────────────────────────────────────────────────
const pto = readPtoData_();
const hours = readHoursData_(pto.weeklyHours);
ck('hours: WK3 keeps this year\'s 30h', hours.get(ALICE).get(WK[3]).tempo === 30);

// ── Kudos ────────────────────────────────────────────────────────────────────
const kudos = readKudosData_();
const aK = kudos.get(ALICE);
ck('kudos: one in WK1, one in WK3', aK.weekly.get(WK[1]) === 1 && aK.weekly.get(WK[3]) === 1);
ck('kudos: evidence list newest first', aK.recent.length === 2 && aK.recent[0].giver === 'Dan');
ck('kudos: previous-FY kudo not in FY count', aK.count === 2);
ck('kudos: undated row placed by Week column', kudos.get(BOB).weekly.get(WK[2]) === 1);

// ── Goal self-comments ───────────────────────────────────────────────────────
const cm = readGoalComments_();
ck('comments: two self-comments for Alice in WK0', cm.get(ciNorm_(ALICE)).get(WK[0]) === 2);
ck('comments: manager comment excluded', !cm.get(ciNorm_(ALICE)).has(WK[3]));
ck('comments: out-of-window comment excluded', cm.get(ciNorm_(BOB)).size === 1);

// ── Aggregation: one aligned 4-slot row per signal ───────────────────────────
const profiles = buildProfileAggregation_(roster, jira.weeks, jira.counts, hours, kudos, cm);
const alice = profiles[0].members.find(m => m.name === ALICE);
const bob   = profiles[0].members.find(m => m.name === BOB);
ck('agg: backlog per week',  JSON.stringify(alice.weeklyTots)     === '[2,0,1,1]');
ck('agg: logged per week (null = no row)', JSON.stringify(alice.weeklyHrs) === '[36,40.3,null,30]');
ck('agg: kudos per week',    JSON.stringify(alice.weeklyKudos)    === '[0,1,0,1]');
ck('agg: comments per week', JSON.stringify(alice.weeklyComments) === '[2,0,0,0]');
ck('agg: Bob has no hours → all null', bob.weeklyHrs.every(v => v === null) && bob.loggedTotal === null);
ck('agg: Alice is Active (3/4 Jira wks + time)', alice.status === 'Active');
ck('sheet text', evidenceText_(alice.weeklyHrs, alice.loggedTotal, 'h') === '36h · 40.3h · — · 30h  (106.3h)');
ck('sheet text: no data', evidenceText_(bob.weeklyHrs, bob.loggedTotal, 'h') === 'no data');

// Comments source unavailable → nulls, never zeros (a zero would read as "did not comment").
const noCm = buildProfileAggregation_(roster, jira.weeks, jira.counts, hours, kudos, null);
const aliceNoCm = noCm[0].members.find(m => m.name === ALICE);
ck('agg: no comments source → null, not 0', aliceNoCm.weeklyComments.every(v => v === null) && aliceNoCm.commentsTotal === null);

// ── HTML report ──────────────────────────────────────────────────────────────
const html = generateHtmlReport_(roster, jira.weeks, jira.counts, hours, pto.dateEntries, kudos, cm);
ck('html: embeds the 4 evidence weeks', html.includes('var weeks = ' + JSON.stringify(WK) + ';'));
ck('html: kudos HTML is not raw in the script', !html.includes('<b>cutover</b>'));
ck('html: names the evidence window', html.includes('Evidence window: last 4 completed weeks'));
const htmlArg = process.argv.indexOf('--html');
if (htmlArg > -1) fs.writeFileSync(process.argv[htmlArg + 1], html);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
