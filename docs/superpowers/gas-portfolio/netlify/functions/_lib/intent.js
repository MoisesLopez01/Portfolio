// Intent classifier — ported from detectIntent_() in Code.gs.
// Returns 'meeting_request' | 'job_offer' | 'portfolio_question' | 'general'.

function detectIntent(userMessage) {
  var msg = String(userMessage || "").toLowerCase();

  var meetingSignals = [
    "schedule", "calendar", "call", "meeting", "connect", "chat", "zoom",
    "google meet", "teams", "available", "availability", "book", "slot", "time",
  ];
  if (meetingSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "meeting_request";

  var offerSignals = [
    "hiring", "position", "role", "opportunity", "job", "opening", "recruit",
    "talent", "salary", "compensation", "pay", "package", "offer", "remote",
    "hybrid", "onsite", "full.time", "part.time", "contract", "freelance",
    "hourly", "monthly", "annual", "joining", "team", "company", "startup",
    "we're looking", "we are looking", "reach out",
  ];
  if (offerSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "job_offer";

  var portfolioSignals = [
    "project", "built", "demo", "stack", "tech", "experience", "skill", "work",
    "impact", "achieve", "dashboard", "api", "python", "sql", "tableau",
    "looker", "gemini", "claude",
  ];
  if (portfolioSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "portfolio_question";

  return "general";
}

module.exports = { detectIntent };
