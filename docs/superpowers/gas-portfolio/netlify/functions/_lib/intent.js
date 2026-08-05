// Intent classifier — kept in sync with detectIntent_() in Code.js.
// Portfolio questions are checked FIRST: a recruiter asking about the work must
// get an answer, never a brush-off. Offer/meeting lists carry only unambiguous
// tokens; salary/comp words stay so Donna still routes those to Alex.
// Returns 'meeting_request' | 'job_offer' | 'portfolio_question' | 'general'.

function detectIntent(userMessage) {
  var msg = String(userMessage || "").toLowerCase();

  var portfolioSignals = [
    "project", "built", "build", "demo", "stack", "tech", "experience", "skill",
    "impact", "achieve", "dashboard", "api", "python", "sql", "apps script",
    "gemini", "llm", "pipeline", "forecast", "workforce", "capacity", "approach",
  ];
  if (portfolioSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "portfolio_question";

  var meetingSignals = [
    "schedule", "calendar", "meeting", "zoom", "google meet",
    "availability", "book a", "book time", "slot",
  ];
  if (meetingSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "meeting_request";

  var offerSignals = [
    "hiring", "position", "opportunity", "job", "opening", "recruit", "talent",
    "salary", "compensation", "pay", "package", "offer",
    "we're looking", "we are looking", "reach out",
  ];
  if (offerSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "job_offer";

  return "general";
}

module.exports = { detectIntent };
