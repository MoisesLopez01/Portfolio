// ─────────────────────────────────────────────────────────────────────────────
// build-static.js — turns the canonical GAS sources into a static index.html
// that Netlify can serve, with ZERO data duplication.
//
// It reads PROJECTS and DOMAINS straight out of Code.gs (executed in a sandbox
// with stubbed GAS globals), resolves the HtmlService templating tags in
// index.html (<?= ?>, <?!= ?>, <? ... ?>), inlines JavaScript.html, and writes
// dist/index.html. Re-run it (or let Netlify's build do it) whenever the GAS
// source changes — the portfolio data never drifts.
// ─────────────────────────────────────────────────────────────────────────────

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = __dirname;
var DIST = path.join(ROOT, "dist");

function read(f) {
  return fs.readFileSync(path.join(ROOT, f), "utf8");
}

// 1. Extract PROJECTS / DOMAINS from Code.gs without a GAS runtime.
function extractData() {
  var code = read("Code.js");
  var noop = function () {};
  var stub = new Proxy({}, { get: function () { return noop; } });
  var sandbox = {
    PropertiesService: stub, SpreadsheetApp: stub, Session: stub,
    UrlFetchApp: stub, HtmlService: stub, CacheService: stub,
    Utilities: stub, console: console, Logger: { log: noop },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "Code.js" });
  if (!Array.isArray(sandbox.PROJECTS) || !Array.isArray(sandbox.DOMAINS)) {
    throw new Error("Could not extract PROJECTS/DOMAINS from Code.js");
  }
  return { PROJECTS: sandbox.PROJECTS, DOMAINS: sandbox.DOMAINS };
}

// Make a JSON literal safe to embed inside a <script> block.
function safeJson(obj) {
  return JSON.stringify(obj).replace(/<\/script/gi, "<\\/script");
}

function build() {
  var data = extractData();
  var html = read("index.html");
  var js = read("JavaScript.html");

  // Inline the client JS (use a function replacer so $-sequences are literal).
  html = html.replace(/<\?!=\s*include\(['"]JavaScript['"]\)\s*\?>/g, function () {
    return js;
  });

  // Bake server-injected data. On the static site there is no Google session,
  // so IS_ADMIN starts false; the admin panel is unlocked client-side with the
  // ADMIN_TOKEN and enforced server-side by the rpc function.
  html = html.replace(/window\.IS_ADMIN\s*=\s*<\?=\s*isAdmin\s*\?>\s*;/, "window.IS_ADMIN  = false;");
  html = html.replace(/<\?!=\s*projectsJson\s*\?>/g, function () { return safeJson(data.PROJECTS); });
  html = html.replace(/<\?!=\s*domainsJson\s*\?>/g, function () { return safeJson(data.DOMAINS); });

  // Any remaining print tags we don't know about → blank (and warn).
  html = html.replace(/<\?!?=([\s\S]*?)\?>/g, function (m, inner) {
    console.warn("[build] Unresolved print tag blanked:", inner.trim());
    return "";
  });

  // Strip GAS control scriptlets (<? if (isAdmin) { ?> … <? } ?>), keeping the
  // inner DOM so the admin panel exists and can be unlocked with the token.
  html = html.replace(/<\?[\s\S]*?\?>/g, "");

  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, "index.html"), html, "utf8");

  console.log(
    "[build] dist/index.html written — " +
      data.PROJECTS.length + " projects, " + data.DOMAINS.length + " domains baked in."
  );
}

build();
