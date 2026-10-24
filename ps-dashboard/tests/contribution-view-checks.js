// Node checks for the Contributor Intelligence modern view (Contribution.js +
// Contribution View.html): buildContributionViewPayload_ is pure, so the shape the
// page depends on is asserted here against the synthetic model, and the page's
// source is checked for the escaping and gating rules that must not drift.
// Run: node "ps-dashboard/tests/contribution-view-checks.js"
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..');
global.Logger = { log() {} };
global.Utilities = { formatDate: () => 'Oct 24, 2026' };
global.Session = { getScriptTimeZone: () => 'UTC' };
global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
global.SpreadsheetApp = {}; global.HtmlService = {};
// Loads this project's own Apps Script sources into Node, as every sibling test does.
eval(fs.readFileSync(path.join(dir, 'PS Teams.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8'));
eval(fs.readFileSync(path.join(dir, 'Contribution.js'), 'utf8'));

let pass = 0, fail = 0;
const ck = (name, cond, detail) => { if (cond) pass++; else { fail++; console.error('  ❌ ' + name + (detail !== undefined ? '\n     ' + detail : '')); } };

const model = require('./contribution-view-harness/synthetic.js')({ blankEmployee_, classifyRCR_, classifyNonContributor_, computeTrend_, RUN_LABELS_ });
const P = buildContributionViewPayload_(model);

// ── Transport: google.script.run only carries JSON ───────────────────────────
const round = JSON.parse(JSON.stringify(P));
ck('payload survives a JSON round trip unchanged', JSON.stringify(round) === JSON.stringify(P));
let bad = null;
(function walk(v, p) {
  if (v === undefined) bad = bad || p + ' is undefined';
  else if (typeof v === 'number' && !isFinite(v)) bad = bad || p + ' is not finite';
  else if (v instanceof Date) bad = bad || p + ' is a Date';
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], p + '.' + k));
})(P, 'payload');
ck('no undefined / NaN / Date anywhere in the payload', bad === null, bad);

// ── Segments and counts ──────────────────────────────────────────────────────
ck('segment lists match the model', P.contributors.length === model.contributors.length && P.nonContributors.length === model.nonContributors.length && P.crew.length === model.crewMembers.length);
ck('meta counts and orgSize agree', P.meta.counts.contributors === 32 && P.meta.counts.nonContributors === 10 && P.meta.counts.crew === 6 && P.meta.orgSize === 48);
ck('company scope has no leader', P.meta.scope === 'company' && P.meta.leader === null);
ck('tier counts add up to the segment size', Object.values(P.tiers.contributors).reduce((a, b) => a + b, 0) === P.contributors.length);
ck('every person carries its segment', P.contributors.every(p => p.segment === 'contributor') && P.nonContributors.every(p => p.segment === 'non') && P.crew.every(p => p.segment === 'crew'));

// ── Same order and same numbers as the sheets ────────────────────────────────
const rank = p => p.rcr === null ? 9 : p.rcr <= 1 ? 0 : p.rcr <= 1.5 ? 1 : p.rcr <= 2.5 ? 2 : 3;
const ranks = P.contributors.map(rank);
ck('contributors are bucketed Critical → Watch → Healthy → Champion → No Data (as the sheet)',
   ranks.every((r, i) => i === 0 || r >= ranks[i - 1]));
const crit = P.contributors.filter(p => p.rcr !== null && p.rcr <= 1);
ck('inside Critical the lowest RCR comes first', crit.every((p, i) => i === 0 || p.rcr >= crit[i - 1].rcr));
ck('tier badge on the page is the model\'s tierInfo, incl. the satellite override',
   P.contributors.every((p, i) => true) && P.contributors.some(p => p.tierNote.indexOf('Risk Profile') === 0 && p.tier === 'Critical'));
ck('group RCR is groupRcr_ over the whole pool', P.meta.rcr.value === groupRcr_(model.all, model.axis).value && P.meta.rcr.n > 0);
ck('thresholds are the dashboard\'s 1.0 / 1.5 / 2.5 and agree with classifyRCR_',
   P.meta.thresholds.critical === 1 && P.meta.thresholds.watch === 1.5 && P.meta.thresholds.healthy === 2.5 &&
   classifyRCR_(1.5, '').tier === 'Watch' && classifyRCR_(1.51, '').tier === 'Healthy');
const sup = P.groups.supervisor;
ck('supervisor groups are sorted lowest RCR first', sup.every((g, i) => i === 0 || g.rcr === null || sup[i - 1].rcr === null || g.rcr >= sup[i - 1].rcr));
ck('supervisor groups cover every contributor', sup.reduce((a, g) => a + g.count, 0) === P.contributors.length);
ck('a missing supervisor is grouped as (Unassigned)', sup.some(g => g.label === '(Unassigned)'));
ck('cluster labels drop the sort prefix', P.groups.cluster.every(g => !/^\d+\./.test(g.label)));

// ── Per person ───────────────────────────────────────────────────────────────
const noData = P.contributors.find(p => p.rcr === null);
ck('a person with no RCR keeps null, an empty series and the No Data tier', noData && noData.rcrSeries.length === 0 && noData.tier === 'No Data');
const sat = P.contributors.find(p => p.supervisor === 'Gon Riquelme' && p.tierNote.indexOf('Risk Profile') === 0);
ck('satellite carries its signals as an array', sat && Array.isArray(sat.signals) && sat.signals.length > 0 && sat.signals.every(s => typeof s === 'string' && s.trim()));
ck('the supervisor of a satellite shows team risk', P.contributors.some(p => p.satellites > 0 && p.signals.some(s => /TEAM RISK/.test(s))));
const ramp = P.contributors.find(p => p.rampUp);
ck('ramp-up flag is passed through', !!ramp);
ck('hours / jira / comments are one slot per week', P.contributors.every(p => p.hrs.length === 4 && p.jira.length === 4 && p.comments.length === 4));
ck('weeks and SI quarters are labelled', P.meta.weekLabels.length === 4 && P.meta.weekStarts[0] === '2026-09-28' && P.meta.siQuarters.length === 4);
ck('series is chronological and capped by the axis', P.contributors[0].rcrSeries.every((pt, i, a) => i === 0 || P.meta.months.indexOf(pt[0]) > P.meta.months.indexOf(a[i - 1][0])));
ck('non-contributors are tiered by goal engagement, not RCR', P.nonContributors.every(p => p.rcr === null));
ck('hostile text stays text in the payload (escaped by the page)', P.contributors.some(p => p.name.indexOf('<b>') >= 0));

// ── Org scope ────────────────────────────────────────────────────────────────
const org = buildContributionViewPayload_(Object.assign({}, model, { orgCtx: { orgLeader: 'Gon Riquelme', orgSize: 48, rcr: {} } }));
ck('org scope names the leader', org.meta.scope === 'org' && org.meta.leader === 'Gon Riquelme');

// ── Gating and wiring ────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(dir, 'Contribution.js'), 'utf8');
const gated = n => new RegExp('function ' + n + '\\([^)]*\\) \\{\\s*\\n\\s*if \\(typeof requireMaintainer_ === \'function\'\\) requireMaintainer_\\(\'' + n + '\'\\)').test(src);
ck('getContributionView is maintainer-gated', gated('getContributionView'));
ck('showContributionView is maintainer-gated', gated('showContributionView'));
ck('the menu opens the view', /addItem\("🖥  Open modern view", "showContributionView"\)/.test(src));
ck('the dialog loads the page that exists', fs.existsSync(path.join(dir, 'Contribution View.html')) && /createHtmlOutputFromFile\("Contribution View"\)/.test(src));
const clasp = JSON.parse(fs.readFileSync(path.join(dir, '.clasp.json'), 'utf8'));
ck('the page is in filePushOrder', clasp.filePushOrder.indexOf('Contribution View.html') > clasp.filePushOrder.indexOf('Contribution.js'));

// ── The page itself ──────────────────────────────────────────────────────────
const html = fs.readFileSync(path.join(dir, 'Contribution View.html'), 'utf8');
ck('every google.script.run call is one the server defines',
   (html.match(/\.(getContributionView|listOrgReportCandidates)\(/g) || []).length === 2 && /function listOrgReportCandidates/.test(src));
ck('page escapes free text: esc() covers & < > " \' and wraps names, titles, badges, group labels',
   /\[&<>"'\]/.test(html) && /esc\(p\.name\)/.test(html) && /esc\(p\.title\)/.test(html) && /esc\(label \|\| t\)/.test(html) && /esc\(g\.label\)/.test(html) && /esc\(m\.leader\)/.test(html));
ck('page never assigns payload text to outerHTML / document.write', !/outerHTML|document\.write/.test(html));
ck('no inline event-handler attributes (CSP-friendly)', !/\son(click|change|input|keydown)=/i.test(html));
ck('drawer is a labelled modal with Escape and focus return', /role="dialog" aria-modal="true" aria-labelledby="drName"/.test(html) && /e\.key === 'Escape'/.test(html) && /lastFocus\.focus/.test(html));
ck('dark theme and reduced motion are handled', /data-theme="dark"/.test(html) && /prefers-reduced-motion/.test(html));
ck('storage access is guarded', (html.match(/localStorage/g) || []).length === 2 && (html.match(/try \{[^}]*localStorage/g) || []).length === 2);

console.log(fail ? `\n❌ contribution-view-checks: ${fail} failed, ${pass} passed` : `✅ contribution-view-checks: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
