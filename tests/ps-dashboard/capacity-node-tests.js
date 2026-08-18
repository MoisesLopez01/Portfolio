// Node runner for TempoCapacityTime.js pure-function tests.
// Usage: node tests/ps-dashboard/capacity-node-tests.js
// Evals both GAS files in one scope (they share GAS global scope in production)
// with a stubbed Logger, then runs the _test_* suite.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "..", "ps-dashboard");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

global.Logger = { log: (m) => console.log(m) };

const src = [
  read("TempoPlanExport.js"),
  read("TempoCapacityTime.js"),
  "\nrunCapacityTests();\n",
].join("\n;\n");

try {
  eval(src);
} catch (e) {
  console.error(e.stack || e.message);
  process.exit(1);
}
