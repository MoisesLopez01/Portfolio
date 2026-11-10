// Node checks for the per-source freshness status (indicator I2 / HT2, 2026.W45).
//
// HT2: every source × cut pair in scope shows its cut-off date, its cadence and its
// availability state, and an overdue source is visibly flagged. The thesis measured
// 8 sources × 4 weekly cuts (2026.W39–2026.W42) = 32 pairs. This suite freezes the
// clock at each of those four cuts and checks all 32 pairs against an expected
// table written BY HAND below (not derived from the code under test).
//
// Cut dates: the Monday after each ISO week, the day the weekly report is read
// (W42 → Mon 19 Oct 2026, the date of the retrospective contrast). The W42 source
// states are the ones Anexo A records for 19 Oct 2026; W39–W41 are synthetic states
// chosen so that every state (current / overdue / no data) and every rule (load
// age, last closed month, last closed quarter, missing sheet, missing stamp) occurs.
//
// Run: node "ps-dashboard/tests/source-freshness-checks.js"
process.env.TZ = 'America/Guatemala';          // the script's zone (appsscript.json)
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');

global.Logger = { log() {} };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Utilities = { formatDate: () => '' };
global.HtmlService = {}; global.Session = { getScriptTimeZone: () => 'America/Guatemala' };

let pass = 0, fail = 0;
const ck = (name, cond, detail) => { if (cond) pass++; else { fail++; console.error('  ❌ ' + name + (detail !== undefined ? '\n     ' + detail : '')); } };

eval(fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'));
// The completion value hands back SOURCE_FRESHNESS_ (a top-level const stays local to the eval).
const SF = eval(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8') + '\n;SOURCE_FRESHNESS_;');
eval(fs.readFileSync(path.join(dir, 'SourceStatus.js'), 'utf8'));

const T = s => s + '-06:00';                     // local Guatemala wall time → ISO

// ── The four cuts of the thesis ────────────────────────────────────────────
const CUTS = [
  { week: '2026.W39', asOf: T('2026-09-28T12:00:00'), signals: {
      roster: { loadedAt: T('2026-09-28T05:40:00') }, rcr: { period: 'Aug 26' }, si: { period: 'FY26Q4' },
      goals: { loadedAt: T('2026-09-26T16:10:00') }, planned: { loadedAt: T('2026-09-28T08:05:00') },
      tracked: { loadedAt: T('2026-09-28T06:02:00') }, kudos: { loadedAt: T('2026-09-27T09:00:00') },
      pto: { loadedAt: T('2026-09-22T10:00:00') } } },
  { week: '2026.W40', asOf: T('2026-10-05T12:00:00'), signals: {
      roster: { loadedAt: T('2026-10-05T05:41:00') }, rcr: { period: 'Aug 26' }, si: { period: 'FY26Q4' },
      goals: { loadedAt: T('2026-10-02T15:00:00') }, planned: { loadedAt: T('2026-09-28T08:05:00') },
      tracked: { loadedAt: T('2026-10-02T06:01:00') }, kudos: { missing: 'Kudos sheet not found' },
      pto: { loadedAt: T('2026-09-22T10:00:00') } } },
  { week: '2026.W41', asOf: T('2026-10-12T12:00:00'), signals: {
      roster: { loadedAt: T('2026-10-12T05:39:00') }, rcr: { period: 'Aug 26' }, si: { period: 'FY26Q4' },
      goals: { loadedAt: T('2026-10-09T11:00:00') }, planned: { loadedAt: T('2026-09-28T08:05:00') },
      tracked: { loadedAt: T('2026-10-12T06:03:00') }, kudos: { loadedAt: T('2026-10-11T22:00:00') },
      pto: { loadedAt: T('2026-10-06T09:00:00') } } },
  // Anexo A, 19 Oct 2026: roster 11:42, goals 11:43, kudos 11:35, PTO 12:45, tracked
  // 15 Oct 11:51; RCR shows August, SI FY26Q4; planned keeps no run time.
  { week: '2026.W42', asOf: T('2026-10-19T13:00:00'), signals: {
      roster: { loadedAt: T('2026-10-19T11:42:00') }, rcr: { period: 'Aug 26' }, si: { period: 'FY26Q4' },
      goals: { loadedAt: T('2026-10-19T11:43:00') }, planned: {},
      tracked: { loadedAt: T('2026-10-15T11:51:00') }, kudos: { loadedAt: T('2026-10-19T11:35:00') },
      pto: { loadedAt: T('2026-10-19T12:45:00') } } },
];

// Expected state per pair, by hand: C current · O overdue · N no data.
// Order: roster rcr si goals planned tracked kudos pto
const EXPECT = {
  '2026.W39': 'C C C C C C C C',   // every source inside its schedule
  '2026.W40': 'C C C C O O N C',   // RCR: Sep not due until day 10; planned 7 d 4 h (> 26 h); tracked 3 d; kudos tab gone; PTO 13 d (≤ 15 d)
  '2026.W41': 'C O C C O C C C',   // RCR still Aug after day 10 → Sep overdue; planned 14 d
  '2026.W42': 'C O C C N O C C',   // Anexo A: RCR Aug overdue, SI FY26Q4 current, planned no stamp, tracked 4 d old
};
const CODE = { C: 'current', O: 'overdue', N: 'nodata' };
const KEYS = ['roster', 'rcr', 'si', 'goals', 'planned', 'tracked', 'kudos', 'pto'];
// Cadence each source must declare (Tabla 2, corrected where Anexo B found the
// label wrong: RCR is monthly, not quarterly). 2026.W46: tracked, planned, goals and
// PTO now share the Source Status ledger's limits — planned runs daily (its live
// trigger was added by hand), PTO is a manual paste due within 15 days.
const CADENCE = { roster: /^Daily/, rcr: /^Monthly/, si: /^Quarterly/, goals: /^Weekly — manual paste/,
                  planned: /^Daily$/, tracked: /^Daily — 06:00/, kudos: /^Daily/, pto: /^Manual paste — within 15 days/ };

// ── Frontend: the panel and chip code, lifted from PS Dashboard.html ──────────
const html = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');
const a = html.indexOf('// ── Per-source freshness (I2 / HT2'), b = html.indexOf('// A `reason` distinguishes', a);
ck('frontend freshness block found', a > 0 && b > a);
const els = {};
const mkEl = id => (els[id] = { id, textContent: '', title: '', className: '', innerHTML: '', style: { display: 'none' },
  attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, contains: () => false });
mkEl('dataFreshnessNote'); mkEl('srcFreshPanel');
let teamMetrics = null;                         // null = every metric visible
const FE = new Function('document', 'hasMetric_', html.slice(a, b) +
  '\nreturn { sourceFreshnessHtml_, sourceFreshnessSummary_, renderSourceFreshness_, toggleSrcFreshPanel_ };')(
  { getElementById: id => els[id] || null, addEventListener() {} },
  m => !teamMetrics || teamMetrics.includes(m));

// ── The 32 pairs ───────────────────────────────────────────────────────────
const ledger = [];
CUTS.forEach(cut => {
  const got = buildSourceFreshness_(cut.signals, new Date(cut.asOf));
  const want = EXPECT[cut.week].split(' ').map(c => CODE[c]);
  ck(cut.week + ': eight sources', got.length === 8, got.length);
  const panel = FE.sourceFreshnessHtml_(got, cut.asOf);
  KEYS.forEach((k, i) => {
    const s = got.find(x => x.key === k) || {};
    const id = cut.week + ' × ' + k;
    const stateOk = s.state === want[i];
    const cadenceOk = CADENCE[k].test(s.cadence || '');
    // Cut-off: a load time or a covered period — or, when there is none, an explicit reason.
    const cutoffOk = s.state === 'nodata' ? !!s.reason : !!(s.cutoff || s.cutoffLabel);
    const row = (panel.match(new RegExp('<tr data-src="' + k + '"[^>]*>(.*?)</tr>')) || [])[0] || '';
    const shown = row.includes('data-state="' + want[i] + '"') && row.includes('src-lz-' + want[i]) &&
                  row.includes(s.cadence) && (s.state === 'nodata' ? row.includes(s.reason) : !/class="src-cut">—</.test(row));
    ck(id + ' state', stateOk, `want ${want[i]}, got ${s.state} (${s.reason})`);
    ck(id + ' cadence', cadenceOk, s.cadence);
    ck(id + ' cut-off', cutoffOk, JSON.stringify(s));
    ck(id + ' shown in panel', shown, row);
    ledger.push({ cut: cut.week, source: k, want: want[i], got: s.state, cadence: s.cadence,
                  cutoff: s.cutoff || s.cutoffLabel || '—', reason: s.reason, valid: stateOk && cadenceOk && cutoffOk && shown });
  });
  // Visible flag: any overdue source turns the header chip red.
  FE.renderSourceFreshness_({ sourceFreshness: got, generatedAt: cut.asOf });
  const anyOverdue = want.includes('overdue');
  ck(cut.week + ': chip red iff a source is overdue', els.dataFreshnessNote.className.includes('fresh-bad') === anyOverdue,
     els.dataFreshnessNote.className + ' / ' + els.dataFreshnessNote.textContent);
  ck(cut.week + ': chip visible', els.dataFreshnessNote.style.display === '');
});

// ── Rule edges ─────────────────────────────────────────────────────────────
const one = (key, sig, asOf) => buildSourceFreshness_({ [key]: sig }, new Date(asOf)).find(s => s.key === key);
ck('daily: 47 h is current', one('roster', { loadedAt: T('2026-10-17T13:00:00') }, T('2026-10-19T12:00:00')).state === 'current');
ck('daily: 49 h is overdue', one('roster', { loadedAt: T('2026-10-17T11:00:00') }, T('2026-10-19T12:00:00')).state === 'overdue');
ck('RCR: Sep 26 current on 19 Oct', one('rcr', { period: 'Sep 26' }, T('2026-10-19T12:00:00')).state === 'current');
ck('RCR: new tab header "2026.09 RCR" reads', one('rcr', { period: '2026.09 RCR' }, T('2026-10-19T12:00:00')).state === 'current');
ck('RCR: year boundary (Dec 26 current on 20 Jan 27)', one('rcr', { period: 'Dec 26' }, T('2027-01-20T12:00:00')).state === 'current');
ck('RCR: year boundary (Nov 26 overdue on 20 Jan 27)', one('rcr', { period: 'Nov 26' }, T('2027-01-20T12:00:00')).state === 'overdue');
ck('SI: FY26Q4 overdue once FY27Q1 window closes (5 Dec)', one('si', { period: 'FY26Q4' }, T('2026-12-05T12:00:00')).state === 'overdue');
ck('SI: FY27Q1 current on 5 Dec', one('si', { period: 'FY27Q1' }, T('2026-12-05T12:00:00')).state === 'current');
ck('no signal at all → nodata', one('pto', {}, T('2026-10-19T12:00:00')).state === 'nodata');
ck('unreadable period → nodata', one('rcr', { period: 'garbage' }, T('2026-10-19T12:00:00')).state === 'nodata');

// ── Team scoping: R&D / Sales do not use tracked, planned or RCR ─────────────
teamMetrics = ['goals', 'kudos', 'si', 'pto'];
const rd = buildSourceFreshness_(CUTS[3].signals, new Date(CUTS[3].asOf));
const rdHtml = FE.sourceFreshnessHtml_(rd, CUTS[3].asOf);
ck('team without time metrics: 5 rows', (rdHtml.match(/<tr data-src=/g) || []).length === 5);
ck('team without time metrics: summary counts only its sources', FE.sourceFreshnessSummary_(rd).total === 5);
teamMetrics = null;

// ── Old cached payload (no sourceFreshness) ─────────────────────────────────
FE.renderSourceFreshness_({});
ck('payload without sourceFreshness asks for a refresh', /refresh/i.test(els.dataFreshnessNote.textContent));
FE.toggleSrcFreshPanel_(true);
ck('panel opens', els.srcFreshPanel.style.display === '' && els.dataFreshnessNote.attrs['aria-expanded'] === 'true');

// ── Live wiring: collectFreshnessSignals_ against stubbed services ──────────
const sheet = (name, extra) => Object.assign({ getName: () => name, getLastColumn: () => 7,
  getRange: () => ({ getValues: () => [['Recipient', 'Giver', 'Description', 'Create Date', 'ISO Week', 'Organizational Values', new Date(T('2026-10-19T11:35:00'))]],
                     getNote: () => 'Last Export: 2026-10-19T14:05:00.000Z' }) }, extra || {});
const tabs = { [CONFIG_PS.SHEET_KUDOS]: sheet('k'), [CONFIG_PS.SHEET_PLANNED]: sheet('p'), [CONFIG_PS.SHEET_TEMPO_TRACKED]: sheet('t') };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: n => tabs[n] || null }) };
global.DriveApp = { getFileById: id => ({ getLastUpdated: () => new Date(id === CONFIG_PS.PTO_ACCUM_SS_ID ? '2026-10-19T18:45:00Z' : '2026-10-19T17:42:00Z') }) };
let sig = collectFreshnessSignals_(240, { _lastExport: '2026-10-15T17:51:00.000Z' }, { lastMonth: 'Aug 26' }, { teamAvg: 3.6, quarter: 'FY26Q4' });
ck('wiring: kudos stamp from row 1', sig.kudos.loadedAt === new Date(T('2026-10-19T11:35:00')).toISOString(), JSON.stringify(sig.kudos));
ck('wiring: planned stamp from A1 note', sig.planned.loadedAt === '2026-10-19T14:05:00.000Z', JSON.stringify(sig.planned));
ck('wiring: tracked from Last Export', sig.tracked.loadedAt === '2026-10-15T17:51:00.000Z');
ck('wiring: PTO from its workbook', sig.pto.loadedAt === '2026-10-19T18:45:00.000Z');
ck('wiring: RCR / SI periods', sig.rcr.period === 'Aug 26' && sig.si.period === 'FY26Q4');
delete tabs[CONFIG_PS.SHEET_KUDOS];
global.DriveApp = { getFileById: () => { throw new Error('no Drive scope'); } };
sig = collectFreshnessSignals_(0, {}, { lastMonth: null }, { teamAvg: null, quarter: 'FY26Q4' });
const nd = buildSourceFreshness_(sig, new Date(T('2026-10-19T13:00:00')));
ck('wiring: failures degrade to nodata, never throw', ['roster', 'rcr', 'si', 'kudos', 'goals', 'pto'].every(k => nd.find(s => s.key === k).state === 'nodata'),
   JSON.stringify(nd.map(s => s.key + ':' + s.state)));
// Static Data Reference text must agree with the chip: Planned runs daily.
const plannedRef = (html.match(/<tr data-metric="planned">.*?<\/tr>/) || [])[0] || '';
ck('Data Reference: Planned row found', !!plannedRef);
ck('Data Reference: Planned cadence is "Daily export"', /<td>Daily export<\/td>/.test(plannedRef), plannedRef);
ck('page never calls the Planned export weekly / Mondays',
   !/(planned|plan export)[^<]{0,80}(weekly export|mondays?\s+0?8)|(weekly export|mondays?\s+0?8)[^<]{0,80}planned/i.test(html) &&
   !/Weekly export \(Mondays/i.test(html));
ck('meta ships sourceFreshness', /sourceFreshness:\s+buildSourceFreshness_\(collectFreshnessSignals_\(/.test(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8')));
ck('plan export writes its run stamp', /setNote\("Last Export: " \+ new Date\(\)\.toISOString\(\)\)/.test(fs.readFileSync(path.join(dir, 'TempoPlanExport.js'), 'utf8')));

// ── One set of limits: chip and Monday email (2026.W46) ──────────────────────
const LEDGER_OF = { tracked: 'tempo_tracked', planned: 'tempo_plan', goals: 'goals', pto: 'pto' };
Object.keys(LEDGER_OF).forEach(k => {
  const f = SF.find(s => s.key === k), l = SOURCE_STATUS.SOURCES.find(s => s.key === LEDGER_OF[k]);
  ck('limits: ' + k + ' maxAgeH = ledger ' + LEDGER_OF[k] + ' staleHours', !!f && !!l && f.maxAgeH === l.staleHours,
     (f && f.maxAgeH) + ' vs ' + (l && l.staleHours));
});
ck('limits: planned 26 h is current', one('planned', { loadedAt: T('2026-11-08T10:00:00') }, T('2026-11-09T12:00:00')).state === 'current');
ck('limits: planned 27 h is overdue', one('planned', { loadedAt: T('2026-11-08T09:00:00') }, T('2026-11-09T12:00:00')).state === 'overdue');
ck('limits: PTO 15 d is current', one('pto', { loadedAt: T('2026-10-25T12:00:00') }, T('2026-11-09T12:00:00')).state === 'current');
ck('limits: PTO 15 d 1 h is overdue', one('pto', { loadedAt: T('2026-10-25T11:00:00') }, T('2026-11-09T12:00:00')).state === 'overdue');

// ── A failed ledger run turns the source overdue ─────────────────────────────
const fl = one('tracked', { failedReason: 'Tempo 401', loadedAt: T('2026-11-09T06:01:00') }, T('2026-11-09T12:00:00'));
ck('failed: state overdue even when the last load is recent', fl.state === 'overdue', JSON.stringify(fl));
ck('failed: reason names the failure', fl.reason === 'Last run failed — Tempo 401', fl.reason);
ck('failed: cut-off kept from the last good load', fl.cutoff === new Date(T('2026-11-09T06:01:00')).toISOString(), fl.cutoff);
const fl2 = one('goals', { failedReason: 'RD tab not found' }, T('2026-11-09T12:00:00'));
ck('failed without a load: overdue, no cut-off', fl2.state === 'overdue' && fl2.cutoff === null && fl2.reason === 'Last run failed — RD tab not found',
   JSON.stringify(fl2));
const flList = buildSourceFreshness_({ tracked: { failedReason: 'Tempo 401 <token>' } }, new Date(T('2026-11-09T12:00:00')));
const flRow = (FE.sourceFreshnessHtml_(flList, T('2026-11-09T12:00:00')).match(/<tr data-src="tracked"[^>]*>(.*?)<\/tr>/) || [])[0] || '';
ck('failed: panel row uses the overdue styling', flRow.includes('data-state="overdue"') && flRow.includes('src-lz-overdue'), flRow);
ck('failed: panel row shows the reason, escaped', flRow.includes('Last run failed — Tempo 401 &lt;token&gt;'), flRow);
FE.renderSourceFreshness_({ sourceFreshness: flList, generatedAt: T('2026-11-09T12:00:00') });
ck('failed: chip turns red', els.dataFreshnessNote.className.includes('fresh-bad'), els.dataFreshnessNote.className);
// A failure found by the daily check (not a run) is worded neutrally.
const trg = one('goals', { failedReason: 'Trigger missing: run installSourceStatusTriggers' }, T('2026-11-09T12:00:00'));
ck('check failure: "Trigger missing:" → Problem prefix', trg.state === 'overdue' && trg.reason === 'Problem — Trigger missing: run installSourceStatusTriggers', JSON.stringify(trg));
const unr = one('pto', { failedReason: 'Cannot read: 2023 RD tab not found', loadedAt: T('2026-11-02T10:00:00') }, T('2026-11-09T12:00:00'));
ck('check failure: "Cannot read:" → Problem prefix, cut-off kept', unr.state === 'overdue' && unr.reason === 'Problem — Cannot read: 2023 RD tab not found' &&
   unr.cutoff === new Date(T('2026-11-02T10:00:00')).toISOString(), JSON.stringify(unr));
ck('run failure mentioning a trigger mid-text stays "Last run failed"',
   one('tracked', { failedReason: 'Tempo 500 (Trigger missing: no)' }, T('2026-11-09T12:00:00')).reason === 'Last run failed — Tempo 500 (Trigger missing: no)');

// ── The ledger feeds the freshness view ──────────────────────────────────────
let ledgerReads = 0, ledgerOpens = 0;
const ledgerTab = values => ({ getDataRange: () => { ledgerReads++; return { getValues: () => values }; } });
const HDR = SOURCE_STATUS.HEADERS.slice();
const lrow = (key, lastUpdated, status, detail) => {
  const r = HDR.map(() => '');
  r[HDR.indexOf('Source')] = key; r[HDR.indexOf('Last updated')] = lastUpdated;
  r[HDR.indexOf('Status')] = status; r[HDR.indexOf('Detail')] = detail || ''; return r;
};
const LEDGER_ROWS = [HDR,
  lrow('tempo_tracked', new Date(T('2026-11-09T06:02:00')), 'ok', 'Run ok in 40 s'),
  lrow('tempo_plan', new Date(T('2026-11-08T08:00:00')), 'failed', 'Tempo 429'),
  lrow('tempo_capacity', new Date(T('2026-11-06T08:00:00')), 'ok'),
  lrow('goals', '', 'pending', 'awaiting first update'),
  lrow('pto', new Date(T('2026-11-02T10:00:00')), 'ok'),
  lrow('roster', new Date(T('2026-11-09T05:00:00')), 'ok'),
  lrow('kudos', 'not a date', 'ok'),
];
const withLedger = (tab, extraTabs) => {
  ledgerReads = 0; ledgerOpens = 0;
  global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'dash-id',
    getSheetByName: n => { if (n === SOURCE_STATUS.SHEET) { ledgerOpens++; return tab; } return (extraTabs || {})[n] || null; } }) };
};
withLedger(ledgerTab(LEDGER_ROWS));
let lf = ledgerFreshnessSignals_();
ck('ledger: tracked ok → loadedAt', lf.tracked && lf.tracked.loadedAt === new Date(T('2026-11-09T06:02:00')).toISOString(), JSON.stringify(lf.tracked));
ck('ledger: plan failed → failedReason', lf.planned && lf.planned.failedReason === 'Tempo 429', JSON.stringify(lf.planned));
ck('ledger: failed keeps the last good load', lf.planned && lf.planned.loadedAt === new Date(T('2026-11-08T08:00:00')).toISOString());
ck('ledger: pending goals without a stamp is omitted', !('goals' in lf), JSON.stringify(lf.goals));
ck('ledger: PTO stamp → loadedAt', lf.pto && lf.pto.loadedAt === new Date(T('2026-11-02T10:00:00')).toISOString());
ck('ledger: kudos with no valid date is omitted', !('kudos' in lf), JSON.stringify(lf.kudos));
ck('ledger: roster, capacity and others are not mapped',
   Object.keys(lf).sort().join() === 'planned,pto,tracked', Object.keys(lf).join());
ck('ledger: read at most once', ledgerReads === 1 && ledgerOpens === 1, ledgerReads + ' reads / ' + ledgerOpens + ' opens');
withLedger(null);
ck('ledger: no tab → {}', JSON.stringify(ledgerFreshnessSignals_()) === '{}');
withLedger(ledgerTab([['Source', 'Label']]));
ck('ledger: missing column → {}, no throw', JSON.stringify(ledgerFreshnessSignals_()) === '{}');
global.SpreadsheetApp = { getActiveSpreadsheet: () => { throw new Error('no container'); } };
let lfThrew = false; try { lf = ledgerFreshnessSignals_(); } catch (e) { lfThrew = true; }
ck('ledger: unreachable spreadsheet → {}, no throw', !lfThrew && JSON.stringify(lf) === '{}');
withLedger(ledgerTab([HDR, lrow('kudos', new Date(T('2026-11-09T09:00:00')), 'failed', 'Kudos sheet missing')]));
lf = ledgerFreshnessSignals_();
ck('ledger: kudos failed → failedReason', lf.kudos && lf.kudos.failedReason === 'Kudos sheet missing', JSON.stringify(lf.kudos));

// collectFreshnessSignals_ merges the ledger over the existing signals.
global.DriveApp = { getFileById: () => ({ getLastUpdated: () => new Date('2026-11-09T11:00:00Z') }) };
withLedger(ledgerTab(LEDGER_ROWS), { [CONFIG_PS.SHEET_PLANNED]: sheet('p'), [CONFIG_PS.SHEET_TEMPO_TRACKED]: sheet('t'), [CONFIG_PS.SHEET_KUDOS]: sheet('k') });
sig = collectFreshnessSignals_(240, { _lastExport: '2026-10-15T17:51:00.000Z' }, { lastMonth: 'Oct 26' }, { teamAvg: 3.6, quarter: 'FY27Q1' });
ck('merge: tracked replaced by the ledger stamp', sig.tracked.loadedAt === new Date(T('2026-11-09T06:02:00')).toISOString(), JSON.stringify(sig.tracked));
ck('merge: planned failure replaces the A1-note stamp', sig.planned.failedReason === 'Tempo 429', JSON.stringify(sig.planned));
ck('merge: goals with no ledger stamp keeps its Drive stamp', sig.goals.loadedAt === '2026-11-09T11:00:00.000Z', JSON.stringify(sig.goals));
ck('merge: roster keeps its Drive stamp', sig.roster.loadedAt === '2026-11-09T11:00:00.000Z', JSON.stringify(sig.roster));
ck('merge: kudos with no ledger stamp keeps its row-1 stamp', sig.kudos.loadedAt === new Date(T('2026-10-19T11:35:00')).toISOString(), JSON.stringify(sig.kudos));
const merged = buildSourceFreshness_(sig, new Date(T('2026-11-09T12:00:00')));
const mp = merged.find(s => s.key === 'planned');
ck('merge: planned shows overdue with the failure', mp.state === 'overdue' && /^Last run failed — Tempo 429$/.test(mp.reason), JSON.stringify(mp));
withLedger(null, { [CONFIG_PS.SHEET_PLANNED]: sheet('p'), [CONFIG_PS.SHEET_TEMPO_TRACKED]: sheet('t'), [CONFIG_PS.SHEET_KUDOS]: sheet('k') });
sig = collectFreshnessSignals_(240, { _lastExport: '2026-10-15T17:51:00.000Z' }, { lastMonth: 'Oct 26' }, { teamAvg: 3.6, quarter: 'FY27Q1' });
ck('no ledger yet: tracked keeps Last Export', sig.tracked.loadedAt === '2026-10-15T17:51:00.000Z', JSON.stringify(sig.tracked));
ck('no ledger yet: planned keeps the A1 note', sig.planned.loadedAt === '2026-10-19T14:05:00.000Z', JSON.stringify(sig.planned));

// ── I2 ledger ──────────────────────────────────────────────────────────────
if (process.argv.includes('--ledger')) {
  console.log('Corte | Fuente | Esperado | Mostrado | Periodicidad | Fecha de corte | Motivo | Par válido');
  ledger.forEach(r => console.log([r.cut, r.source, r.want, r.got, r.cadence, r.cutoff, r.reason, r.valid ? 'sí' : 'NO'].join(' | ')));
}
const valid = ledger.filter(r => r.valid).length;
console.log(`I2: ${valid} de ${ledger.length} pares fuente–corte con fecha de corte, periodicidad y estado correctos y visibles`);
if (fail) { console.error(`❌ source-freshness-checks: ${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`✅ source-freshness-checks: ${pass} checks passed`);
