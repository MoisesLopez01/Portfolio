// Every Apps Script file runs its top-level code at load, in project order, in ONE
// shared global scope. A top-level statement that reads another file's const
// (the old `...COLORS` spread in Contributionintelligence.js) throws
// "ReferenceError: X is not defined" on EVERY execution — including unrelated
// triggers such as the hourly Tempo exports — whenever the remote order differs
// from filePushOrder (clasp once restored alphabetical order, twice).
// So each file must load cleanly in ANY order. This check loads all files into
// one vm context in every rotation of the list plus alphabetical and reverse
// order and fails on the first load-time error.
// Run: node "ps-dashboard/tests/load-order-checks.js"
const fs = require('fs'), path = require('path'), vm = require('vm');
const dir = path.join(__dirname, '..');
const files = fs.readdirSync(dir).filter(f => /\.js$/.test(f)).sort();

// Apps Script services referenced at load only as bare names; calls happen later.
function newContext() {
  const noop = () => ({});
  const svc = new Proxy({}, { get: () => noop });
  return vm.createContext({
    Logger: { log() {} }, console, SpreadsheetApp: svc, PropertiesService: svc, CacheService: svc, UrlFetchApp: svc,
    Utilities: svc, Session: svc, LockService: svc, ScriptApp: svc, HtmlService: svc, ContentService: svc,
    DriveApp: svc, MailApp: svc, GmailApp: svc, CalendarApp: svc, Charts: svc, XmlService: svc,
  });
}
function tryLoad(order) {
  const ctx = newContext();
  for (const f of order) {
    try { vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }); }
    catch (e) { return f + ': ' + e.message; }
  }
  return null;
}

const orders = [['alphabetical', files], ['reverse', files.slice().reverse()]];
for (let i = 1; i < files.length; i++) orders.push(['rotation ' + i, files.slice(i).concat(files.slice(0, i))]);

let fail = 0;
orders.forEach(([name, order]) => {
  const err = tryLoad(order);
  if (err) { fail++; console.error('  ❌ load order "' + name + '" → ' + err); }
});
console.log(fail ? `\n❌ load-order-checks: ${fail} of ${orders.length} orders failed` : `✅ load-order-checks: ${files.length} files load cleanly in ${orders.length} orders`);
process.exit(fail ? 1 : 0);
