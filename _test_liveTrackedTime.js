// ============================================================
// Live Test for Tempo Tracked Time Matrix Format
// ============================================================
// Add this to your PS Contribution Report.js temporarily to test
// the new "Tempo Tracked Time" tab integration.

function _test_liveTrackedTime() {
  const weeks = buildWeekWindow_PS_();
  const roster = readPSRoster_();
  const psNames = new Map([...roster].filter(([, p]) => !p.isRampUp));
  
  Logger.log('=== LIVE TRACKED TIME TEST ===');
  Logger.log('Testing with ' + weeks.length + ' weeks and ' + psNames.size + ' PS employees');
  
  const result = readTrackedTimeByWeek_(psNames, weeks);
  
  let totalWeeksWithData = 0;
  let totalHours = 0;
  let totalEmployeesTracked = new Set();
  
  weeks.forEach(w => {
    const d = result[w.label];
    if (d && d.headcount > 0) {
      totalWeeksWithData++;
      totalHours += d.totalHrs;
      Object.keys(d.byEmployee).forEach(emp => totalEmployeesTracked.add(emp));
      
      Logger.log(w.label + ': ' + d.headcount + ' people, ' + Math.round(d.totalHrs) + ' hours');
      
      // Show project breakdown stats
      const projCount = Object.keys(d.byEmployeeProjects || {}).length;
      if (projCount > 0) {
        Logger.log('  → ' + projCount + ' employees with project breakdowns');
        
        // Sample 3 employees with project data
        const samples = Object.entries(d.byEmployeeProjects).slice(0, 3);
        samples.forEach(([emp, projects]) => {
          const projList = Object.entries(projects)
            .map(([key, hrs]) => key + '(' + Math.round(hrs) + 'h)')
            .join(', ');
          Logger.log('    • ' + emp + ': ' + projList);
        });
      }
    } else {
      Logger.log(w.label + ': NO DATA');
    }
  });
  
  Logger.log('\n=== SUMMARY ===');
  Logger.log('Weeks with data: ' + totalWeeksWithData + '/' + weeks.length);
  Logger.log('Total hours tracked: ' + Math.round(totalHours));
  Logger.log('Unique employees tracked: ' + totalEmployeesTracked.size + '/' + psNames.size);
  Logger.log('Average hours/week: ' + (totalWeeksWithData > 0 ? Math.round(totalHours / totalWeeksWithData) : 0));
  Logger.log('=== END TEST ===');
}
