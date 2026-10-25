// Engine-vs-engine: does @305 differ from the corrected build on the same goals extract?
const [a0, b0] = process.argv.slice(2);
const a = require(a0), b = require(b0);
const same = JSON.stringify(a.verdicts) === JSON.stringify(b.verdicts) && JSON.stringify(a.comments) === JSON.stringify(b.comments);
console.log('engine outputs identical:', same);
let verdictDiff = 0, peopleDiff = new Set(), commentDiff = 0, checksV = 0, checksC = 0;
for (const r of Object.keys(a.verdicts)) for (const w of Object.keys(a.verdicts[r])) for (const n of Object.keys(a.verdicts[r][w])) {
  checksV++;
  const x = a.verdicts[r][w][n], y = (b.verdicts[r][w] || {})[n];
  if (!y || x.join() !== y.join()) { verdictDiff++; peopleDiff.add(n); }
}
for (const w of Object.keys(a.comments)) for (const n of Object.keys(a.comments[w])) { checksC++; if (a.comments[w][n] !== (b.comments[w] || {})[n]) commentDiff++; }
console.log('person-week verdicts compared:', checksV, '| different:', verdictDiff, '| people with a different verdict:', peopleDiff.size);
console.log('person-week comment counts compared:', checksC, '| different:', commentDiff);
console.log('quarter runs:', Object.keys(a.verdicts).map(r => r + ':' + Object.keys(a.verdicts[r]).length + ' weeks').join(' | '));
console.log('history weeks with comment counts:', Object.keys(a.comments).length, '| window:', a.weeks.hist[0].label, '->', a.weeks.hist[a.weeks.hist.length - 1].label);
