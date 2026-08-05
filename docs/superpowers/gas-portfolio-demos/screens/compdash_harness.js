// compdash_harness.js — writes compdash_demo.html: the CompDash SPA running on a
// synthetic, de-branded payload with google.script.run stubbed. Open the output
// in a browser and screenshot views for the portfolio case study.
// SPEC §0.3: screenshots come ONLY from this synthetic render, never production.
var fs = require("fs"), path = require("path");
var SRC = path.join(__dirname, "..", "..", "..", "..", "CompDash", "ViewDash.html");
var html = fs.readFileSync(SRC, "utf8").replace(/<\?[=!]?[\s\S]*?\?>/g, "admin");

// Synthetic payload: adapt the `D` object from CompDash/tests/render_smoke.js
// (copy it into payload.json beside this script, then de-brand: replace any
// internal role term with a generic equivalent like "employee", emails with
// x@example.com, keep all numbers).
var D = JSON.parse(fs.readFileSync(path.join(__dirname, "payload.json"), "utf8"));

var stub = "<script>window.google={script:{run:new Proxy({},{get:function(t,k){" +
  "if(k==='withSuccessHandler')return function(fn){window.__ok=fn;return window.google.script.run;};" +
  "if(k==='withFailureHandler')return function(){return window.google.script.run;};" +
  "return function(){if(k==='getCompReportData')setTimeout(function(){window.__ok(" +
  JSON.stringify(D).replace(/<\/script/gi, "<\\/script") + ")},50);};}})}};<\/script>";

html = html.replace(/<script>/, stub + "\n<script>");
fs.writeFileSync(path.join(__dirname, "compdash_demo.html"), html, "utf8");
console.log("Wrote compdash_demo.html — open in a browser, cycle the views, screenshot.");
