// Syntax-checks the <script> block(s) of the client files (GAS scriptlets stubbed out).
const fs = require("fs"), path = require("path");

// Client JS now spans several files. Read each one's <script> block and join in
// LOAD ORDER — Views/Admin define the renderers, ViewDash's RENDERERS const
// references them by name at evaluation time, so it must come last.
// filter(Boolean) drops missing-file placeholders BEFORE joining, so a leading
// empty entry never pushes ViewDash's "use strict" off position 0 (see the
// matching comment in render_smoke.js for why that matters there).
const CLIENT_FILES = ["Views.html", "Admin.html", "ViewDash.html"];
const js = CLIENT_FILES.map(f => {
  const p = path.join(__dirname, "..", "..", "CompDash", f);
  if (!fs.existsSync(p)) return "";                    // not split out yet
  const m = fs.readFileSync(p, "utf8").match(/<script>([\s\S]*?)<\/script>/);
  return m ? m[1] : "";
}).filter(Boolean).join("\n;\n").replace(/<\?[=!]?[\s\S]*?\?>/g, "x"); // "<?= userRole ?>" sits inside quotes → "x"

if (!js.trim()) { console.log("❌ no <script> content found"); process.exit(1); }
try { new Function(js); console.log("✅ ViewDash.html script parses"); }
catch (e) { console.log("❌ " + e.message); process.exit(1); }
