// claims-gate.js — no stack claim without a code path behind it (spec §1 truth sweep),
// and no stale/contradictory numbers. Run: node tools/claims-gate.js
var fs = require("fs"), path = require("path");
var FILES = ["index.html", "JavaScript.html", "Code.js",
  "netlify/functions/_lib/agent-context.js", "README.md"];
var BANNED = [
  "GPT-4", "Embeddings", "Claude API", "with RAG",
  "11 production apps", "312 contributors", "9 LLM systems",
  "ai-salary-benchmarking", "ps-contribution-dashboard", "ps-dashboard",
  "7571-9264",
];
var hits = 0;
FILES.forEach(function (f) {
  var p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) return;
  var body = fs.readFileSync(p, "utf8");
  BANNED.forEach(function (t) {
    if (body.indexOf(t) !== -1) { hits++; console.log("CLAIM " + f + "  → " + t); }
  });
});
console.log(hits ? "❌ claims-gate: " + hits + " unbacked claim(s)" : "✅ claims-gate: clean");
process.exit(hits ? 1 : 0);
