// A deterministic synthetic buildContributionModel_ result — ~50 invented people
// across the three segments — shared by contribution-view-checks.js (assertions)
// and make-fixture.js (the JSON the visual harness serves). It calls the real
// Contribution.js helpers (blankEmployee_, classifyRCR_, classifyNonContributor_,
// computeTrend_, RUN_LABELS_), handed in by the caller that loaded the file, so the
// payload schema in the fixture is the one production produces.
// Every name below is made up.
module.exports = function makeModel(api) {
  const { blankEmployee_, classifyRCR_, classifyNonContributor_, computeTrend_, RUN_LABELS_ } = api;
  let seed = 42;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const r1 = v => Math.round(v * 10) / 10;

  const months = ['Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26']
    .map((name, i) => ({ name, sortKey: 2026 * 12 + 3 + i, source: i < 3 ? 'ratio' : 'rate' }));
  const axis = { months, latest: months[5], lastMonths: months.slice(-3).map(m => m.name), byId: new Map() };
  const weeks = [0, 1, 2, 3].map(i => {
    const start = new Date(2026, 8, 28 + i * 7), end = new Date(2026, 9, 4 + i * 7, 23, 59, 59);
    return { start, end, label: 'W' + (40 + i) };
  });

  const sups = ['Gon Riquelme', 'Ana Lead', 'Marcus Oyelaran', 'Priya Nair-Singh', 'Tomás Herrera'];
  const regions = ['Americas', 'EMEA', 'APAC', 'ANZ'];
  const first = ['Ada', 'Ben', 'Chloe', 'Dev', 'Elif', 'Farid', 'Grace', 'Hiro', 'Ines', 'Jonas', 'Kofi', 'Lena', 'Mateo', 'Nia', 'Omar', 'Pia', 'Quinn', 'Rosa', 'Sven', 'Tara', 'Uma', 'Vik', 'Wren', 'Xia', 'Yuri', 'Zoe'];
  const last  = ['Almeida', 'Brandt', 'Castillo', 'Dlamini', 'Eriksen', 'Fontaine', 'Garza', 'Haddad', 'Ivanova', 'Jørgensen', 'Kaplan', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Petrov'];
  const titles = [['Senior Consultant', 'I4'], ['Consultant', 'I3'], ['Support Engineer', 'I3'], ['Senior Support Engineer', 'I4'],
                  ['Solution Architect', 'I5'], ['Project Manager', 'I4'], ['Manager, Services', 'M4'], ['Principal Consultant', 'I5']];
  let n = 0;
  const base = () => {
    const e = blankEmployee_('S' + (1000 + n));
    e.name = first[n % first.length] + ' ' + last[(n * 7) % last.length]; n++;
    e.empNumber = String(30000 + n); e.supervisor = pick(sups); e.region = pick(regions);
    e.tenure = r1(0.4 + rnd() * 7); e.empStatus = 'Active';
    e.kudosL3W = Math.floor(rnd() * 4);
    e.weeklyTrackedHrs = [0, 1, 2, 3].map(() => r1(rnd() < 0.08 ? 0 : 28 + rnd() * 16));
    e.lastWeekTotalHrs = e.weeklyTrackedHrs[3]; e.prevWeekTotalHrs = e.weeklyTrackedHrs[2];
    e.avgTotalHrs = e.weeklyTrackedHrs.reduce((a, b) => a + b, 0) / 4;
    e.jiraEpicCounts = [0, 1, 2, 3].map(() => Math.floor(rnd() * 6));
    e.goalMonthlyComments = [0, 1, 2, 3].map(() => Math.floor(rnd() * 5));
    e.goalAvgCommentsPerWeek = r1(e.goalMonthlyComments.reduce((a, b) => a + b, 0) / 4);
    e.goalEngagementPct = rnd() < 0.06 ? null : Math.round(20 + rnd() * 80);
    e.siScores = [3, 4, 4, 5].map(s => rnd() < 0.15 ? null : Math.max(1, Math.min(5, s + Math.round(rnd() * 2 - 1))));
    e.validSI = e.siScores.filter(s => s !== null);
    e.latestSI = e.validSI.length ? e.validSI[e.validSI.length - 1] : null;
    e.avgSI = e.validSI.length ? e.validSI.reduce((a, b) => a + b, 0) / e.validSI.length : null;
    e.criticalSatelliteCount = 0;
    return e;
  };
  const withRcr = (e, level) => {
    const start = 0.4 + rnd() * 3.2, drift = (rnd() - 0.5) * 0.5;
    const vals = months.map((m, i) => Math.max(0.1, r1(start + drift * i + (rnd() - 0.5) * 0.5)));
    e.monthlyRCR = months.map((m, i) => ({ month: m.name, sortKey: m.sortKey, value: vals[i], source: m.source }));
    e.rcrCurrent = vals[5]; e.rcrCurrentMonth = 'Sep 26'; e.rcrSource = 'rate';
    e.lastMonthsRCR = e.monthlyRCR.slice(-3).map(p => ({ month: p.month, value: p.value }));
    e.ytdRCR = r1(vals.slice(3).reduce((a, b) => a + b, 0) / 3);
    e.trend = computeTrend_(e.monthlyRCR);
    e.tierInfo = classifyRCR_(e.rcrCurrent, level);
    return e;
  };

  const contributors = [];
  for (let i = 0; i < 32; i++) {
    const e = base(); const [t, l] = pick(titles);
    e.jobTitle = t; e.jobLevel = l; e.dept = 'Service Delivery'; e.empClass = 'Professional Services';
    withRcr(e, l); contributors.push(e);
  }
  // Edge cases the view must survive.
  contributors[0].name = "Siobhan O'Brien <b>Ünicode</b>";
  contributors[0].jobTitle = 'Senior Principal Solutions Consultant, Atlassian Cloud Migration Practice';
  contributors[1].rcrCurrent = null; contributors[1].monthlyRCR = [];
  contributors[1].tierInfo = classifyRCR_(null, 'I3'); contributors[1].trend = 'Insufficient Data';
  contributors[2].isRampUp = true; contributors[2].tenure = 0.2;
  const sat = contributors[3];
  sat.rcrCurrent = 0.6; sat.monthlyRCR.forEach((p, i) => { p.value = [1.1, 0.9, 0.8, 0.7, 0.6, 0.6][i]; });
  sat.trend = 'Sustained Low'; sat.goalEngagementPct = 25; sat.weeklyTrackedHrs = [6, 4, 0, 5]; sat.lastWeekTotalHrs = 5;
  sat.tierInfo = Object.assign({}, classifyRCR_(0.6, 'I3'), { note: 'Risk Profile: Low RCR + Low Activity + Low Engagement + Poor Trend' });
  sat.supervisor = 'Gon Riquelme';
  contributors[4].supervisor = '';
  contributors[5].onLeave = true;
  contributors[6].isManager = true;
  contributors[7].weeklyTrackedHrs = [0, 0, 0, 0]; contributors[7].lastWeekTotalHrs = 0;
  contributors[8].supervisor = sat.name;

  const nonContributors = [];
  const ncTitles = [['Operations Analyst', 'I3', 'Operations'], ['Finance Partner', 'I4', 'Finance'], ['Recruiter', 'I3', 'People'],
                    ['Marketing Specialist', 'I3', 'Marketing'], ['Sales Engineer', 'I4', 'Sales']];
  for (let i = 0; i < 10; i++) {
    const e = base(); const [t, l, d] = pick(ncTitles);
    e.jobTitle = t; e.jobLevel = l; e.dept = d; e.empClass = 'Corporate';
    e.tierInfo = classifyNonContributor_(e); e.isInternalGA = true; nonContributors.push(e);
  }
  const crewMembers = [];
  for (let i = 0; i < 6; i++) {
    const e = base(); e.jobTitle = 'Crew Member'; e.jobLevel = 'Contractor'; e.dept = 'Service Delivery'; e.empClass = 'Contractors';
    e.isCrewMember = true;
    if (i < 4) withRcr(e, 'Contractor'); else e.tierInfo = classifyRCR_(null, '');
    crewMembers.push(e);
  }
  sat.criticalSatelliteCount = 0;
  contributors.forEach(e => { if (e.name === sat.supervisor) e.criticalSatelliteCount = 1; });
  contributors[8].criticalSatelliteCount = 1;   // the person who supervises the satellite
  const all = contributors.concat(nonContributors, crewMembers);
  RUN_LABELS_.goalsNote = 'Goals: FY27Q1 — closed quarter, shown until Oct 22 (FY27Q2 opens then)';
  return {
    axis, lastMonths: axis.lastMonths, weeks, orgCtx: null, all, crewMembers, contributors, nonContributors,
    fc: { reportQuarter: 'FY27Q1', siQuarters: ['FY26Q2', 'FY26Q3', 'FY26Q4', 'FY27Q1'] },
  };
};
