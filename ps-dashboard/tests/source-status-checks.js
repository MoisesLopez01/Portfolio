// Node checks for the Source Status ledger (spec 2026-11-09).
// Run: node "ps-dashboard/tests/source-status-checks.js"
const fs   = require('fs');
const path = require('path');

global.Logger = { log: function () {} };
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null, getProperties: () => ({}), setProperty: () => {} }),
};

const dir = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
eval(read('PS Contribution Report.js'));
eval(read('SourceStatus.js'));
if (fs.existsSync(path.join(dir, 'SourceDigest.js'))) eval(read('SourceDigest.js'));

let pass = 0, fail = 0;
function ck(name, cond) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error('  ❌ ' + name + '\n     got:  ' + JSON.stringify(got) +
                         '\n     want: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
const H = 3600000, D = 86400000;
function def(key) { return sourceDefs_({}).filter(d => d.key === key)[0]; }
function ymd(d) { return d instanceof Date ? stampLabel_SS_(d).slice(0, 10) : String(d); }

// ── Task 1: config, labels, evaluator ────────────────────────────────────────
eq('ten sources in order', sourceDefs_({}).map(d => d.key),
   ['tempo_tracked', 'tempo_plan', 'tempo_capacity', 'goals', 'pto', 'roster', 'kudos', 'si', 'rcr', 'digest']);
eq('stale override by Script Property',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: '12' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 12);
eq('bad override ignored',
   sourceDefs_({ SOURCE_STALE_HOURS_TEMPO_CAPACITY: 'abc' }).filter(d => d.key === 'tempo_capacity')[0].staleHours, 192);

eq('ISO label 2026-11-09', isoLabel_SS_(new Date(2026, 10, 9, 12)), '2026.W46');
eq('ISO label 53-week year', isoLabel_SS_(new Date(2026, 11, 31, 12)), '2026.W53');
eq('ISO label unpadded', isoLabel_SS_(new Date(2027, 0, 4, 12)), '2027.W1');
eq('stamp label', stampLabel_SS_(new Date(2026, 10, 2, 9)), '2026-11-02 (2026.W45)');
eq('stamp label empty for non-date', stampLabel_SS_(''), '');

const NOW = new Date(2026, 10, 9, 10, 0);
const at = ms => new Date(NOW.getTime() - ms);

eq('tracked 25 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(25 * H) }, NOW).status, 'ok');
eq('tracked 26 h → ok',  evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(26 * H) }, NOW).status, 'ok');
const tr27 = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: at(27 * H) }, NOW);
eq('tracked 27 h → stale', tr27.status, 'stale');
eq('tracked stale detail', tr27.detail, 'No update for 27 h (limit 26 h)');

eq('capacity 8 d → ok', evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D) }, NOW).status, 'ok');
const cap = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(8 * D + H) }, NOW);
eq('capacity 8 d 1 h → stale', cap.status, 'stale');
eq('capacity stale detail', cap.detail, 'No update for 8 days (limit 8 days)');
eq('plan 8 d 1 h → stale', evaluateSourceStatus_(def('tempo_plan'), { lastUpdated: at(8 * D + H) }, NOW).status, 'stale');
eq('goals 7 d → ok',     evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D) }, NOW).status, 'ok');
eq('goals 7 d 1 h → stale', evaluateSourceStatus_(def('goals'), { lastUpdated: at(7 * D + H) }, NOW).status, 'stale');
eq('pto 15 d → ok',      evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D) }, NOW).status, 'ok');
eq('pto 15 d 1 h → stale', evaluateSourceStatus_(def('pto'), { lastUpdated: at(15 * D + H) }, NOW).status, 'stale');
eq('roster never stale', evaluateSourceStatus_(def('roster'), { lastUpdated: at(400 * D) }, NOW).status, 'ok');

const pend = evaluateSourceStatus_(def('tempo_plan'), {}, NOW);
eq('no stamp → pending', pend.status, 'pending');
eq('no stamp detail', pend.detail, 'awaiting first update');
eq('failed is sticky', evaluateSourceStatus_(def('tempo_plan'),
   { lastUpdated: at(H), status: 'failed', detail: 'boom' }, NOW).status, 'failed');
eq('rule row keeps stored status', evaluateSourceStatus_(def('si'), { status: 'pending' }, NOW).status, 'pending');
eq('rule row with no status → pending', evaluateSourceStatus_(def('rcr'), {}, NOW).status, 'pending');

const nx = evaluateSourceStatus_(def('tempo_tracked'), { lastUpdated: new Date(2026, 10, 9, 6, 0) }, NOW);
eq('next expected = last + cadence', ymd(nx.nextExpected), '2026-11-10');
const ev = evaluateSourceStatus_(def('tempo_capacity'), { lastUpdated: at(H) }, NOW);
eq('evaluator carries label/digest/action', [ev.label, ev.digest, /fetchTempoCapacity/.test(ev.action)],
   ['Tempo Capacity', true, true]);

// ── SUMMARY ──────────────────────────────────────────────────────────────────
console.log('source-status-checks: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
