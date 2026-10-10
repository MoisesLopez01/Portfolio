// Synthetic PS payload for the static render harness — fake names, fake numbers.
(function () {
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function monday(n) { var d = new Date(Date.UTC(2025, 11, 29)); d.setUTCDate(d.getUTCDate() + 7 * (n - 1)); return d; }
  function fmt(d) { return MON[d.getUTCMonth()] + ' ' + d.getUTCDate(); }
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  var CUR = 41, FIRST = 14;
  var q4Weeks = [];
  for (var n = FIRST; n <= 43; n++) {
    var m = monday(n), e = new Date(m.getTime()); e.setUTCDate(e.getUTCDate() + 6);
    q4Weeks.push({ label: '2026.W' + n, year: 2026, isoWeek: n, dateRange: fmt(m) + ' – ' + fmt(e),
                   isPast: n < CUR, isFuture: n > CUR, isCurrentWeek: n === CUR });
  }
  var SPEC = [
    ['Ana Reyes', 'Senior Consultant', 'Manila', 'Carla Mendoza', { tr: .97, pl: 39, g: .95, k: .7 }, { tr: .98, pl: 38, g: .95, k: .75 }, [2.6, 2.7], 4],
    ['Ben Okafor', 'Consultant', 'Remote — US', 'Ewa Nowak', { tr: .72, pl: 29, g: .4, k: .2 }, { tr: .98, pl: 39, g: .95, k: .7 }, [1.5, 2.5], 3, { shape: [31, 40] }],
    ['Chloe Tan', 'Principal Consultant', 'Singapore', 'Carla Mendoza', { tr: .98, pl: 39, g: .95, k: .7 }, { tr: .68, pl: 27, g: .35, k: .15 }, [2.7, 1.9], 4, { shape: [31, 40] }],
    ['Diego Ramos', 'Consultant', 'Manila', 'Ana Reyes', { tr: .8, pl: 33, g: .62, k: .35 }, { tr: .78, pl: 33, g: .6, k: .3 }, [2.0, 1.9], 3, { pto: { 33: 40, 34: 40, 38: 16 } }],
    ['Ewa Nowak', 'Delivery Manager', 'Kraków', 'Carla Mendoza', { tr: .6, pl: 30, g: .9, k: .8 }, { tr: .62, pl: 31, g: .92, k: .8 }, [2.5, 2.8], 5, { mgr: true }],
    ['Farid Haddad', 'Associate Consultant', 'Manila', 'Ana Reyes', { tr: .6, pl: 25, g: .3, k: .2 }, { tr: .85, pl: 34, g: .7, k: .4 }, [1.4, 2.0], null, { ramp: true, hire: 32 }],
    ['Grace Liu', 'Associate Consultant', 'Remote — US', 'Ana Reyes', { tr: .45, pl: 18, g: .1, k: .1 }, { tr: .47, pl: 19, g: .12, k: .1 }, [1.0, 1.1], 2],
    ['Hugo Martins', 'Crew Member — Consultant', 'Lisbon', 'Ewa Nowak', { tr: .92, pl: 40, g: 0, k: .3 }, { tr: .9, pl: 39, g: 0, k: .3 }, [2.3, 2.2], null, { crew: true }],
    ['Iris Kaur', 'Consultant', 'Remote — UK', 'Carla Mendoza', { tr: .76, pl: 30, g: .5, k: .4 }, { tr: .78, pl: 31, g: .5, k: .4 }, [1.9, 2.1], 4],
    ['Jon Pérez', 'Solutions Engineer', 'Remote — US', 'Carla Mendoza', { tr: .5, pl: 10, g: .8, k: .5 }, { tr: .5, pl: 10, g: .85, k: .5 }, [0, 0], 4, { noTime: true }],
    ['Kai Long', 'Consultant', 'Singapore', 'Ewa Nowak', { tr: .9, pl: 36, g: .8, k: .5 }, { tr: .9, pl: 36, g: .8, k: .5 }, [2.2, 2.3], 3, { leave: true }],
  ];
  var FIRSTS = ['Lena','Marco','Nia','Omar','Priya','Quinn','Rosa','Sam','Tara','Uma','Vik','Wen','Xavi','Yara','Zed','Ada','Bo','Cy','Dara','Eli','Fay','Gus','Hana','Ivo','Jade','Kofi','Lior','Mae','Nico'];
  FIRSTS.forEach(function (f, i) {
    var r = rng(900 + i), base = .55 + r() * .45;
    SPEC.push([f + ' Sample' + (i + 1), ['Consultant', 'Senior Consultant', 'Associate Consultant'][i % 3], ['Manila', 'Kraków', 'Remote — US', 'Singapore'][i % 4],
      ['Carla Mendoza', 'Ewa Nowak', 'Ana Reyes'][i % 3], { tr: base, pl: 26 + r() * 14, g: base, k: .2 + r() * .6 }, { tr: base + (r() - .5) * .3, pl: 26 + r() * 14, g: base + (r() - .5) * .4, k: .2 + r() * .6 },
      [1 + r() * 2, 1 + r() * 2], 2 + Math.round(r() * 3)]);
  });
  var rcrByEmployee = {}, siByEmployee = {};
  var employees = SPEC.map(function (s, idx) {
    var o = s[8] || {}, R = rng(17 + idx * 101), weeks = {};
    var norm = s[0].toLowerCase();
    for (var n = FIRST; n <= CUR; n++) {
      if (o.hire && n < o.hire) continue;
      var sh = o.shape || [FIRST, CUR], t = clamp((n - sh[0]) / (sh[1] - sh[0]), 0, 1);
      var pto = (o.pto || {})[n] || 0, target = 40 - pto;
      var pl = target <= 0 ? 0 : clamp(lerp(s[4].pl, s[5].pl, t) * target / 40 + (R() - .5) * 3, 4, target);
      var tr = clamp(lerp(s[4].tr, s[5].tr, t) + (R() - .5) * .07, .2, 1.05);
      var kq = lerp(s[4].k, s[5].k, t), gq = lerp(s[4].g, s[5].g, t);
      var kr = R() < kq ? (R() < .3 ? 2 : 1) : 0, kg = R() < kq * .8 ? 1 : 0;
      weeks['2026.W' + n] = {
        trackedHrs: o.leave ? null : Math.round(pl * tr * 10) / 10,
        plannedHrs: o.leave ? null : Math.round(pl * 10) / 10,
        ptoAdjustedTargetHrs: target, ptoPlannedHrs: pto,
        goalsDetail: o.crew ? undefined : { compliant: R() < gq, selfCommentCount: 6 },
        kudos: { count: kr, givenCount: kg, entries: kr ? [{ giver: 'Peer ' + (idx % 5), orgValues: ['Customer obsessed'] }] : [] },
        ptoHealth: o.crew ? undefined : { status: R() < .85 ? 'Good' : 'At Risk', reason: '' },
      };
      if (o.crew) delete weeks['2026.W' + n].goalsDetail;
    }
    var rc = {};
    ['Apr 26', 'May 26', 'Jun 26', 'Jul 26', 'Aug 26', 'Sep 26'].forEach(function (mn, i) { rc[mn] = Math.round(lerp(s[6][0], s[6][1], i / 5) * 10) / 10; });
    if (!o.noTime) rcrByEmployee[norm] = rc;
    if (s[7]) siByEmployee[norm] = { FY26Q4: s[7], FY27Q1: s[7] };
    var hire = Date.UTC(2023, idx % 12, 1 + idx % 20);
    if (o.hire) hire = Date.UTC(2026, 7, 3);
    return { name: s[0], normName: norm, jobTitle: s[1], keyLocation: s[2], supervisor: s[3], hireDate: hire,
             employeeNumber: 'E' + (1000 + idx), isManager: !!o.mgr, isRampUp: !!o.ramp, isCrewMember: !!o.crew,
             onLeave: !!o.leave, tracksTime: o.noTime ? false : undefined, weeks: weeks,
             rcr: { value: o.noTime ? null : s[6][1] }, si: { value: s[7] || null } };
  });
  var hist = [];
  for (var h = 1; h <= CUR; h++) hist.push({ label: '2026.W' + h, isCurrentWeek: h === CUR });
  window.__PS_FIXTURE__ = {
    ok: true, employees: employees, q4Weeks: q4Weeks, weeks: q4Weeks.slice(-8), trackedHistory: hist, teamSummary: [],
    meta: { currentWeekLabel: '2026.W41', generatedAt: '2026-10-10T10:00:00Z', goalsQuarter: 'FY27Q2', siQuarter: 'FY27Q1',
            team: { key: 'services', label: 'Services', metrics: ['goals', 'tracked', 'planned', 'rcr', 'kudos', 'pto', 'si'] },
            rcrByEmployee: rcrByEmployee, siByEmployee: siByEmployee, availableTeams: ['services'] },
    userRole: 'admin', userEmail: 'admin@example.com',
  };
})();
