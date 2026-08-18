// Node test runner for CompDash pure logic.
const fs = require("fs");
const path = require("path");

global.Logger = { log: (...a) => console.log(...a) };

const root = path.join(__dirname, "..", "..", "CompDash");
// Every server file, concatenated into ONE eval string. Top-level const/let
// created by eval are scoped to that eval call, so a second eval could not see
// CONFIG_CD. Code.js goes first because it declares it. Do not split this.
const SERVER_FILES = ["Code.js", "Position.js", "Workforce.js", "Narrative.js", "Security.js",
                      "RemotePull.js", "Acceleration.js", "Retention.js", "GrowthEvents.js"];
const src = SERVER_FILES
  .map(f => "\n// ===== " + f + " =====\n" + fs.readFileSync(path.join(root, f), "utf8"))
  .join("\n");
const cases = fs.readFileSync(path.join(__dirname, "cases.js"), "utf8");

const PRELUDE = `
var __passes = 0, __fails = 0;
function check(desc, cond) {
  if (cond) { __passes++; }
  else { __fails++; console.log("❌ " + desc); }
}
function approx(a, b, eps) {
  if (a == null || b == null) return a === b;
  return Math.abs(a - b) <= (eps == null ? 1e-6 : eps);
}
`;
const EPILOGUE = `
console.log(__passes + " passed, " + __fails + " failed");
if (__fails > 0) process.exit(1);
`;

eval(PRELUDE + "\n" + src + "\n" + cases + "\n" + EPILOGUE);
