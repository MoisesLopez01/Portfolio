// intent-tests.js — recruiter-style questions must never be brushed off.
var detectIntent = require("../netlify/functions/_lib/intent.js").detectIntent;
var CASES = [
  ["What was your role on that team?",                 ["portfolio_question", "general"]],
  ["Which company was this project at?",               ["portfolio_question", "general"]],
  ["Walk me through the TCC forecasting approach",     ["portfolio_question"]],
  ["What's Alex's experience with AI and LLMs?",       ["portfolio_question"]],
  ["Tell me about the workforce dashboards",           ["portfolio_question"]],
  ["How did you build the demand dashboard?",          ["portfolio_question"]],
  ["Is Alex open to remote work?",                     ["portfolio_question", "general"]],
  ["We're hiring for a senior data engineer position", ["job_offer"]],
  ["What are your salary expectations?",               ["job_offer"]],
  ["I'd like to discuss a job opportunity",            ["job_offer"]],
  ["Can we schedule a meeting next week?",             ["meeting_request"]],
  ["What's your availability for a Zoom?",             ["meeting_request"]],
];
var fails = 0;
CASES.forEach(function (c) {
  var got = detectIntent(c[0]);
  if (c[1].indexOf(got) === -1) { fails++; console.log("❌ \"" + c[0] + "\" → " + got + " (wanted " + c[1].join("|") + ")"); }
});
console.log(fails ? fails + " failed" : "✅ intent-tests: all passed");
process.exit(fails ? 1 : 0);
