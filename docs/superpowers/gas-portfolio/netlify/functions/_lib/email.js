// Lead-capture email via Resend (https://resend.com).
//
// Required env vars:
//   RESEND_API_KEY   Your Resend API key (re_...).
//   RESEND_FROM      Verified sender, e.g. "Donna <donna@yourdomain.com>".
//                    During testing you may use "onboarding@resend.dev"
//                    (Resend only delivers that sender to your OWN account email).
//   NOTIFY_EMAIL     Where leads land — e.g. moisesalex.01@gmail.com.
//
// sendLeadEmail never throws into the request path: a failed notification must
// not break Donna's reply to the visitor. It logs and resolves false instead.

var RESEND_URL = "https://api.resend.com/emails";

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Emails Alex a captured lead (a hiring / meeting conversation).
 * @param {object} lead - { intent, sessionId, message, history, meta }
 * @returns {Promise<boolean>} true if accepted by Resend, false otherwise.
 */
async function sendLeadEmail(lead) {
  var apiKey = process.env.RESEND_API_KEY;
  var from = process.env.RESEND_FROM;
  var to = process.env.NOTIFY_EMAIL;
  if (!apiKey || !from || !to) {
    console.log("[email] Skipped — RESEND_API_KEY / RESEND_FROM / NOTIFY_EMAIL not all set.");
    return false;
  }

  var history = Array.isArray(lead.history) ? lead.history : [];
  var transcript = history
    .slice(-10)
    .map(function (t) {
      var who = t.role === "assistant" ? "Donna" : "Visitor";
      return "<p style=\"margin:4px 0;\"><strong>" + who + ":</strong> " +
        escapeHtml(t.content) + "</p>";
    })
    .join("");

  var subject = "🔔 Portfolio lead (" + (lead.intent || "interest") + ") — " +
    new Date().toISOString().slice(0, 16).replace("T", " ");

  var html =
    "<div style=\"font-family:system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;\">" +
    "<h2 style=\"margin:0 0 8px;\">New portfolio interest captured</h2>" +
    "<p style=\"margin:0 0 4px;\"><strong>Intent:</strong> " + escapeHtml(lead.intent) + "</p>" +
    "<p style=\"margin:0 0 4px;\"><strong>Session:</strong> " + escapeHtml(lead.sessionId) + "</p>" +
    (lead.meta ? "<p style=\"margin:0 0 4px;\"><strong>Context:</strong> " + escapeHtml(lead.meta) + "</p>" : "") +
    "<h3 style=\"margin:16px 0 4px;\">Latest message</h3>" +
    "<blockquote style=\"margin:0;padding:8px 12px;border-left:3px solid #14b8a6;background:#f0fdfa;\">" +
    escapeHtml(lead.message) + "</blockquote>" +
    (transcript ? "<h3 style=\"margin:16px 0 4px;\">Recent transcript</h3>" + transcript : "") +
    "</div>";

  try {
    var resp = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({ from: from, to: [to], subject: subject, html: html }),
    });
    if (!resp.ok) {
      console.log("[email] Resend returned " + resp.status + ": " + (await resp.text()));
      return false;
    }
    return true;
  } catch (err) {
    console.log("[email] Send failed: " + (err && err.message));
    return false;
  }
}

module.exports = { sendLeadEmail: sendLeadEmail };
