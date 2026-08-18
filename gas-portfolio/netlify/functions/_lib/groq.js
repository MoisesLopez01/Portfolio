// Thin Groq (OpenAI-compatible) client. The API key lives ONLY in the
// GROQ_API_KEY environment variable — never in the browser bundle.
// Uses the global fetch available in the Netlify Functions runtime (Node 18+).

var GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Calls Groq chat completions and returns the parsed JSON response.
 * @param {object} body - { model, messages, max_tokens, temperature }
 * @returns {Promise<object>} Parsed Groq response.
 * @throws {Error} On missing key or non-200 response.
 */
async function groqChat(body) {
  var apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    var e = new Error("Donna is not configured yet — GROQ_API_KEY is not set.");
    e.notConfigured = true;
    throw e;
  }

  var resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    var detail = "";
    try {
      var parsed = await resp.json();
      detail = parsed && parsed.error && parsed.error.message ? ": " + parsed.error.message : "";
    } catch (_) {}
    throw new Error("Groq API error " + resp.status + detail);
  }
  return resp.json();
}

module.exports = { groqChat };
