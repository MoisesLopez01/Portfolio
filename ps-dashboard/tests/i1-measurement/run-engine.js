// Runs the REAL dashboard engine (PS Contribution Report.js) over the re-extracted workbooks
// and prints per-person-week PTO and planned hours for a window, as JSON.
//   node run-engine.js <engineDir> <sheets.json> <out.json> [W39,W40,W41,W42] [mutateLedger]
// The script zone is America/Guatemala (appsscript.json). A Sheets date CELL reaches
// getValues() as a Date at midnight in the WORKBOOK's zone — reproduced here exactly.
process.env.TZ = 'America/Guatemala';
const fs = require('fs'), path = require('path');
const [engineDir, sheetsPath, outPath, weeksArg, mutateArg] = process.argv.slice(2);
const TZ = { pto: process.env.CV_TZ_PTO || 'America/Chicago', roster: process.env.CV_TZ_ROSTER || 'America/Guatemala', container: process.env.CV_TZ_CONTAINER || 'America/Guatemala', goals: process.env.CV_TZ_GOALS || 'America/Los_Angeles' };
const raw = JSON.parse(fs.readFileSync(sheetsPath, 'utf8'));

// civil "YYYY-MM-DDTHH:MM:SS" in `tz` → the instant Sheets hands the script
const fmt = {};
function civilToInstant(iso, tz) {
  const k = tz + '|' + iso;
  if (fmt[k]) return new Date(fmt[k]);
  const m = iso.match(/^(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+)$/); const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const df = fmt[tz] || (fmt[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  // Zone offset at instant t, in ms (works for DST and for pre-1918 local-mean-time offsets such as -6:02).
  const offsetAt = t => { const p = Object.fromEntries(df.formatToParts(new Date(t)).map(x => [x.type, x.value])); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000; };
  const civil = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = civil - offsetAt(civil);
  t = civil - offsetAt(t);                       // second pass settles the DST edge
  const back = Object.fromEntries(df.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  if (+back.year !== y || +back.month !== mo || +back.day !== d || +back.hour !== h) throw new Error('no instant for ' + iso + ' in ' + tz);
  fmt[k] = t; return new Date(t);
}
function sheetOf(book, tab) {
  const rows = raw[book][tab].map(r => r.map(c => (c && typeof c === 'object' && c.$d) ? civilToInstant(c.$d, TZ[book]) : c));
  return {
    getName: () => tab, getLastRow: () => rows.length, getLastColumn: () => (rows[0] || []).length,
    getRange: (r, c, nr, nc) => ({
      getValues: () => rows.slice(r - 1, r - 1 + (nr || 1)).map(x => x.slice(c - 1, c - 1 + (nc || 1))),
      getValue: () => (rows[r - 1] || [])[c - 1] || '',
    }),
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
  };
}
const book = (key, id) => { const cache = {}; return {
  getId: () => id, getSpreadsheetTimeZone: () => TZ[key],
  getSheetByName: t => raw[key][t] ? (cache[t] || (cache[t] = sheetOf(key, t))) : null, getSheets: () => [] }; };
const IDS = { roster: '1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0', pto: '1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo', goals: '1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ', container: 'container-1' };
const books = { [IDS.roster]: book('roster', IDS.roster), [IDS.pto]: book('pto', IDS.pto), [IDS.goals]: book('goals', IDS.goals), [IDS.container]: book('container', IDS.container) };

global.Logger = { log() {} };
global.SpreadsheetApp = { getActiveSpreadsheet: () => books[IDS.container], openById: id => books[id] || (() => { throw new Error('no book ' + id); })() };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.Utilities = { formatDate: (d, tz, f) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) };
global.Session = { getScriptTimeZone: () => 'America/Guatemala', getActiveUser: () => ({ getEmail: () => '' }) };
global.CacheService = { getScriptCache: () => ({ get: () => null, put() {}, remove() {} }) };
global.HtmlService = {}; global.ScriptApp = {}; global.LockService = {};

function run() {
  // Loads the project's own Apps Script sources (the version under test) into Node, as the unit tests do.
  eval(fs.readFileSync(path.join(engineDir, 'PS Teams.js'), 'utf8'));
  eval(fs.readFileSync(path.join(engineDir, 'PS Contribution Report.js'), 'utf8'));
  const labels = (weeksArg || 'W39,W40,W41,W42').split(',').map(w => '2026.' + w);
  const weeks = labels.map(label => ({ label }));
  const nowMs = Date.now();          // ramp-up is "hired within 3 months of NOW": the reconciler judges at this same instant
  const roster = readPSRoster_();
  if (process.env.I1_ROSTER_ONLY) {  // roster contrast: dump every profile the app built, nothing else
    const ymd = d => d ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') : '';
    const people = {};
    roster.forEach((p, norm) => { people[norm] = { name: p.name, internalId: p.internalId, employeeNumber: p.employeeNumber, keyLocation: p.keyLocation, supervisor: p.supervisor, jobTitle: p.jobTitle, cls: p.cls, dept: p.dept, email: p.email, hireDate: ymd(p.hireDate), isRampUp: !!p.isRampUp, isCrewMember: !!p.isCrewMember, onLeave: !!p.onLeave }; });
    return { engine: path.basename(engineDir), nowMs, rosterSize: roster.size, people };
  }
  if (process.env.I1_GOALS) {        // goals contrast: the production flow (three quarter runs + 41-week history), without the PTO exemption
    const ctx = computeFiscalContext_();
    const active = activeRoster_(roster);
    const cur = buildCurrentQWeeks_PS_(ctx), prev = buildPrevQWeeks_PS_(ctx), prev2 = buildPrev2QWeeks_PS_(ctx);
    const prevCtx  = { goalsQuarter: ctx.prevGoalsQuarter,  qStartIsoYear: ctx.prevQStartIsoYear,  qStartIsoWeek: ctx.prevQStartIsoWeek,  inGracePeriod: false, quarterClosed: true };
    const prev2Ctx = { goalsQuarter: ctx.prev2GoalsQuarter, qStartIsoYear: ctx.prev2QStartIsoYear, qStartIsoWeek: ctx.prev2QStartIsoWeek, inGracePeriod: false, quarterClosed: true };
    const extPast = [...buildHistWeeks_(CONFIG_PS.TRACKED_HIST_WEEKS), ...buildWeekWindow_PS_()].filter(w => !w.isFuture);
    const runs = { prev2: readGoalsEngagement_(active, prev2, [], prev2Ctx, null, null), prev: readGoalsEngagement_(active, prev, [], prevCtx, null, null), cur: readGoalsEngagement_(active, cur, extPast, ctx, null, null) };
    const wk = ws => ws.map(w => ({ label: w.label, monday: w.monday, sunday: w.sunday, isoWeek: w.isoWeek, year: w.year, isFuture: !!w.isFuture }));
    const out = { engine: path.basename(engineDir), nowMs,
      ctx: { goalsQuarter: ctx.goalsQuarter, inGracePeriod: !!ctx.inGracePeriod, quarterClosed: !!ctx.quarterClosed, qStartIsoYear: ctx.qStartIsoYear, qStartIsoWeek: ctx.qStartIsoWeek, prevGoalsQuarter: ctx.prevGoalsQuarter, prev2GoalsQuarter: ctx.prev2GoalsQuarter,
              prevQStartIsoYear: ctx.prevQStartIsoYear, prevQStartIsoWeek: ctx.prevQStartIsoWeek, prev2QStartIsoYear: ctx.prev2QStartIsoYear, prev2QStartIsoWeek: ctx.prev2QStartIsoWeek },
      activeNames: Array.from(active.keys()), weeks: { cur: wk(cur), prev: wk(prev), prev2: wk(prev2), hist: wk(extPast) },
      verdicts: {}, comments: {} };
    ['prev2', 'prev', 'cur'].forEach(r => { out.verdicts[r] = {}; Object.keys(runs[r]).filter(k => k[0] !== '_').forEach(w => { out.verdicts[r][w] = {}; Object.entries(runs[r][w].byEmployee).forEach(([n, e]) => { out.verdicts[r][w][n] = [e.compliant ? 1 : 0, e.rule === undefined || e.rule === null ? 0 : e.rule, e.qualifying === undefined ? -1 : e.qualifying, e.totalGoals === undefined ? -1 : e.totalGoals, e.overrideCompliant ? 1 : 0]; }); }); });
    Object.keys(runs.cur).filter(k => k[0] !== '_').forEach(w => { Object.entries(runs.cur[w].byEmployee).forEach(([n, e]) => { if (e.selfCommentCount !== undefined) { (out.comments[w] = out.comments[w] || {})[n] = e.selfCommentCount; } }); });
    return out;
  }
  const ptoProfiles = readPTOAccumulationProfiles_(null);
  const empNumToNorm = rosterIdMap_(roster, 'employeeNumber');
  const ptoUsage = buildPTOUsageByWeek_(ptoProfiles, empNumToNorm, weeks, roster);
  const plannedAll = readPlannedTimeByWeek_(roster, weeks);
  const adj = subtractPTOFromPlanned_(plannedAll, ptoUsage);
  const trackedAll = readTrackedTimeByWeek_(roster, weeks);
  const r2 = v => Math.round(v * 100) / 100;
  const out = { engine: path.basename(engineDir), weeks: labels, rosterSize: roster.size, rosterNames: Array.from(roster.keys()), ledgerProfiles: Object.keys(ptoProfiles).length, byWeek: {} };
  labels.forEach(w => {
    const p = ptoUsage[w].byEmployee, a = adj[w];
    out.byWeek[w] = { pto: {}, plannedNet: {}, plannedRaw: {}, tempoOff: {}, tracked: {} };
    Object.keys(trackedAll[w].byEmployee).forEach(n => out.byWeek[w].tracked[n] = r2(trackedAll[w].byEmployee[n]));
    Object.keys(p).forEach(n => out.byWeek[w].pto[n] = r2(p[n]));
    Object.keys(a.byEmployee).forEach(n => out.byWeek[w].plannedNet[n] = r2(a.byEmployee[n]));
    Object.keys(a.byEmployeeRaw).forEach(n => out.byWeek[w].plannedRaw[n] = r2(a.byEmployeeRaw[n]));
    Object.keys(a.byEmployeeTimeOff).forEach(n => out.byWeek[w].tempoOff[n] = r2(a.byEmployeeTimeOff[n]));
  });
  return out;
}
const result = run();
fs.writeFileSync(outPath, JSON.stringify(result));
const cnt = o => Object.keys(o).length;
if (result.people) { console.log(result.engine, 'roster-only: people', result.rosterSize); process.exit(0); }
if (result.verdicts) { console.log(result.engine, 'goals: active', result.activeNames.length, '| quarter', result.ctx.goalsQuarter, '| history weeks', result.weeks.hist.length); process.exit(0); }
console.log(result.engine, 'roster', result.rosterSize, 'ledger profiles', result.ledgerProfiles,
  result.weeks.map(w => `${w}: pto ${cnt(result.byWeek[w].pto)}, planned ${cnt(result.byWeek[w].plannedNet)}`).join(' | '));
