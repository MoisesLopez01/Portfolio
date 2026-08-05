// leak-gate.js — HARD deploy gate (spec §0.5). Scans deployable trees for
// company data. Any hit = exit 1 = no deploy. Run: node tools/leak-gate.js
var fs = require("fs"), path = require("path");

var ROOTS = [
  path.join(__dirname, ".."),                                   // gas-portfolio
  path.join(__dirname, "..", "..", "gas-portfolio-demos"),      // demos (may not exist yet)
];
var SKIP_DIRS = /node_modules|\.git|^tools$/;
var TEXT_EXT = /\.(html|js|gs|json|md|toml|sql|css|txt|yml|yaml)$/i;

// Case-insensitive substrings — live production identifiers. NEVER shorten this list.
var EXACT_TOKENS = [
  "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",   // Roster SS
  "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",   // Tempo plan SS
  "1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ",   // PS goals SS
  "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",   // PS PTO SS
  "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU",   // CompDash SS
  "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0",   // CompDash SS 2
  "1HIRAMuKZAfPWgOsbFw-r_6UmxgfSUHZC",                // PS dashboard header logo asset
  "moises.lopez@servicerocket.com",
  "gonzalo.riquelme", "william.mock", "robert.castaneda",
  "rocketeers.atlassian", "atlassian.net", "customfield_",
  "script.google.com/a/",                            // domain-bound deployment URLs
  "PEOPLE-38", "GTT-",
];
var WORD_TOKENS = [/\brocketeers?\b/i, /\borbe\b/i, /\bSRSO\b/i];
// "servicerocket" is allowed ONLY as Donna's employer-history bio lines (spec §0.4),
// capped at the counts ratified 2026.W29. Keyed by path SUFFIX so the demo
// folder's Code.js can never inherit the allowance.
var BRAND_ALLOWANCE = [
  { suffix: "gas-portfolio/Code.js", max: 4 },
  { suffix: "_lib/agent-context.js", max: 4 },
];

var hits = 0;
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function (name) {
    if (SKIP_DIRS.test(name)) return;
    var p = path.join(dir, name);
    var st = fs.statSync(p);
    if (st.isDirectory()) return scan(p);
    if (!TEXT_EXT.test(name)) return;
    var body = fs.readFileSync(p, "utf8"), low = body.toLowerCase();
    EXACT_TOKENS.forEach(function (t) {
      if (low.indexOf(t.toLowerCase()) !== -1) { hits++; console.log("LEAK  " + p + "  → " + t); }
    });
    WORD_TOKENS.forEach(function (re) {
      var m = body.match(new RegExp(re.source, re.flags.replace("i", "gi")));
      if (m) { hits++; console.log("LEAK  " + p + "  → " + re + " ×" + m.length); }
    });
    var brand = (low.match(/servicerocket/g) || []).length;
    var posix = p.replace(/\\/g, "/");
    var rule = BRAND_ALLOWANCE.filter(function (r) { return posix.slice(-r.suffix.length) === r.suffix; })[0];
    var allowed = rule ? rule.max : 0;
    if (brand > allowed) { hits++; console.log("LEAK  " + p + "  → servicerocket ×" + brand + " (allowed " + allowed + ")"); }
  });
}
ROOTS.forEach(scan);
console.log(hits ? "❌ leak-gate: " + hits + " hit(s) — DO NOT DEPLOY" : "✅ leak-gate: clean");
process.exit(hits ? 1 : 0);
