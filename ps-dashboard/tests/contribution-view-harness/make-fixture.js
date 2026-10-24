// Writes fixture.js + stub.js for the visual harness: the real
// buildContributionViewPayload_ run over the synthetic model, plus a
// google.script.run stub that serves it (350 ms latency so the loading state shows).
// Run: node ps-dashboard/tests/contribution-view-harness/make-fixture.js <outDir>
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', '..');
global.Logger = { log() {} };
global.Utilities = { formatDate: () => 'Oct 24, 2026' };
global.Session = { getScriptTimeZone: () => 'UTC' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.SpreadsheetApp = {}; global.HtmlService = {};
// Loads this project's own Apps Script sources into Node, as every sibling test does.
eval(fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'Contribution.js'), 'utf8'));

const payload = buildContributionViewPayload_(require('./synthetic.js')({ blankEmployee_, classifyRCR_, classifyNonContributor_, computeTrend_, RUN_LABELS_ }));
const out = process.argv[2];
if (!out) { console.error('usage: make-fixture.js <outDir>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'fixture.js'),
  'window.__CV_FIXTURE__ = ' + JSON.stringify(payload) + ';\n' +
  'window.__CV_CANDIDATES__ = ' + JSON.stringify([
    { name: 'Gon Riquelme', title: 'Director, Services', directReports: 2, orgSize: 18 },
    { name: 'Ana Lead', title: 'Senior Manager, Services', directReports: 9, orgSize: 9 }]) + ';\n');
fs.writeFileSync(path.join(out, 'stub.js'), [
  '(function () {',
  '  function runner(ok, bad) {',
  '    return new Proxy({}, { get: function (_, fn) {',
  "      if (fn === 'withSuccessHandler') return function (f) { return runner(f, bad); };",
  "      if (fn === 'withFailureHandler') return function (f) { return runner(ok, f); };",
  '      return function (arg) {',
  '        setTimeout(function () {',
  "          if (window.__CV_FAIL__ && fn === 'getContributionView') return bad && bad({ message: window.__CV_FAIL__ });",
  "          if (fn === 'getContributionView') {",
  '            var p = JSON.parse(JSON.stringify(window.__CV_FIXTURE__));',
  "            if (arg) { p.meta.scope = 'org'; p.meta.leader = arg; p.contributors = p.contributors.slice(0, 12); p.meta.counts.contributors = 12; }",
  '            return ok && ok(p);',
  '          }',
  "          if (fn === 'listOrgReportCandidates') return ok && ok(window.__CV_CANDIDATES__);",
  '        }, 350);',
  '      };',
  '    } });',
  '  }',
  '  window.google = { script: { run: runner(null, null) } };',
  '})();',
  '',
].join('\n'));
console.log('wrote', out, '— contributors:', payload.contributors.length, 'non:', payload.nonContributors.length, 'crew:', payload.crew.length);
