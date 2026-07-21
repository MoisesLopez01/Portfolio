// Syntax-checks the <script> block of ViewDash.html (GAS scriptlets stubbed out).
const fs = require("fs"), path = require("path");
const html = fs.readFileSync(path.join(__dirname, "..", "ViewDash.html"), "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.log("❌ no <script> block found"); process.exit(1); }
const js = m[1].replace(/<\?[=!]?[\s\S]*?\?>/g, "x"); // "<?= userRole ?>" sits inside quotes → "x"
try { new Function(js); console.log("✅ ViewDash.html script parses"); }
catch (e) { console.log("❌ " + e.message); process.exit(1); }
