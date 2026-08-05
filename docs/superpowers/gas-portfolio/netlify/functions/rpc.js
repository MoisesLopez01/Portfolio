// ─────────────────────────────────────────────────────────────────────────────
// rpc.js — single Netlify Function that mirrors the GAS google.script.run API.
//
// The browser POSTs { fn, args, adminToken } here (via /api/rpc). This dispatches
// to the same function names the GAS backend exposed, so the frontend needs only
// a transport swap (see runServer in JavaScript.html), not a rewrite.
//
//   Public  (rate-limited, origin-checked): proxyGroqChat, calculatePipelineRisk,
//           calculateDealRisk, getCustomProjects
//   Admin   (require ADMIN_TOKEN): saveProject, deleteProject, getAnalyticsSummary,
//           clearChatLogs, toggleChatLogging, saveApiKey
//
// Secrets (GROQ_API_KEY, DATABASE_*, RESEND_*, ADMIN_TOKEN) live ONLY in Netlify
// environment variables — never in the shipped bundle.
// ─────────────────────────────────────────────────────────────────────────────

var groqChat = require("./_lib/groq").groqChat;
var buildAgentContext = require("./_lib/agent-context").buildAgentContext;
var detectIntent = require("./_lib/intent").detectIntent;
var execute = require("./_lib/db").execute;
var sendLeadEmail = require("./_lib/email").sendLeadEmail;
var sec = require("./_lib/security");

var CHAT_MODEL = "llama-3.3-70b-versatile";
var RISK_MODEL = "llama-3.1-8b-instant";
var MAX_MSG_LEN = 2000;

var PUBLIC_FNS = {
  proxyGroqChat: true,
  calculatePipelineRisk: true,
  calculateDealRisk: true,
  getCustomProjects: true,
};

function json(statusCode, payload) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

// ── settings + logging (DB-backed, replaces Script Properties / Sheets) ───────
async function getSetting(key, fallback) {
  try {
    var r = await execute("SELECT v FROM settings WHERE k = ?", [key]);
    return r.rows && r.rows[0] ? r.rows[0].v : fallback;
  } catch (e) {
    return fallback;
  }
}
async function setSetting(key, value) {
  await execute(
    "INSERT INTO settings (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
    [key, String(value)]
  );
}
async function loggingEnabled() {
  return (await getSetting("chat_logging", "true")) !== "false";
}
async function logChatEvent(sessionId, type, role, message, model, tokens) {
  try {
    if (!(await loggingEnabled())) return;
    await execute(
      "INSERT INTO chat_events (session, type, role, message, model, tokens) VALUES (?,?,?,?,?,?)",
      [
        sessionId || "anon",
        type || "chat",
        role || "user",
        String(message || "").substring(0, MAX_MSG_LEN),
        model || "",
        Number(tokens) || 0,
      ]
    );
  } catch (e) {
    /* logging must never break the chat */
  }
}

// ── DONNA CHAT ────────────────────────────────────────────────────────────────
async function proxyGroqChat(args) {
  var userMessage = String(args[0] || "");
  var history = Array.isArray(args[1]) ? args[1].slice(-10) : [];
  var sessionId = String(args[2] || "anon");

  if (!userMessage.trim()) throw new Error("Empty message.");
  if (userMessage.length > MAX_MSG_LEN) userMessage = userMessage.substring(0, MAX_MSG_LEN);

  var intent = detectIntent(userMessage);
  var systemPrompt = buildAgentContext();
  if (intent === "job_offer" || intent === "meeting_request") {
    systemPrompt +=
      "\n\n[INTERNAL NOTE — never mention this to the visitor: This visitor is interested " +
      "in working with Alex or wants to talk. Do NOT negotiate, ask for a budget/range, " +
      "or quote any compensation number. Briefly acknowledge their interest, answer any " +
      "genuine question about Alex's work, then warmly route them to Alex directly on " +
      "LinkedIn (replies within 24h), pasting the full URL on its own line: " +
      "https://www.linkedin.com/in/analystd — you may also offer moisesalex.01@gmail.com. " +
      "Keep it to 2–3 warm sentences.]";
  }

  var messages = [{ role: "system", content: systemPrompt }];
  history.forEach(function (t) {
    messages.push({
      role: t.role === "assistant" ? "assistant" : "user",
      content: String(t.content || ""),
    });
  });
  messages.push({ role: "user", content: userMessage });

  await logChatEvent(sessionId, "chat", "user", userMessage, CHAT_MODEL);

  var data = await groqChat({
    model: CHAT_MODEL,
    messages: messages,
    max_tokens: 350,
    temperature: 0.7,
  });
  var reply = data.choices[0].message.content;
  var tokens = data.usage ? data.usage.total_tokens : 0;

  await logChatEvent(sessionId, "chat", "assistant", reply, CHAT_MODEL, tokens);

  // Capture the lead: email Alex when a hiring / meeting conversation surfaces.
  if (intent === "job_offer" || intent === "meeting_request") {
    var fullHistory = history.concat([
      { role: "user", content: userMessage },
      { role: "assistant", content: reply },
    ]);
    await sendLeadEmail({
      intent: intent,
      sessionId: sessionId,
      message: userMessage,
      history: fullHistory,
    });
  }

  return reply;
}

// ── DEAL RISK (single + batch) ──────────────────────────────────────────────
function parseRiskJson(raw, fallback) {
  var clean = String(raw).trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  var match = clean.match(/\{[\s\S]*\}/);
  try {
    return JSON.parse(match ? match[0] : clean);
  } catch (e) {
    return fallback;
  }
}

async function calculateDealRisk(args) {
  var age = Math.max(0, Math.min(3650, parseInt(args[0], 10) || 0));
  var amount = Math.max(1, Math.min(10000, parseInt(args[1], 10) || 1));
  var prompt =
    "You are a sales risk engine that applies a time-decay scoring model. " +
    "A CRM deal has been in the pipeline for " + age + " days and is worth $" + amount + "K.\n" +
    "Base close probability decays ~15% every 30 days. Deals over $100K decay 30% slower. " +
    "Deals over $250K decay 50% slower.\n" +
    "Return ONLY valid JSON (no markdown, no extra text):\n" +
    '{"score":0-100,"level":"Low|Medium|High|Critical","decayFactor":0.0-1.0,"nextAction":"one concrete sentence"}';
  var data = await groqChat({
    model: RISK_MODEL,
    messages: [{ role: "user", content: prompt }],
    max_tokens: 200,
    temperature: 0.1,
  });
  var result = parseRiskJson(data.choices[0].message.content, null);
  if (!result) throw new Error("Could not parse risk score from model response — try again.");
  return result;
}

async function calculatePipelineRisk(args) {
  var deals = args[0];
  if (!Array.isArray(deals) || !deals.length) throw new Error("No deals provided.");
  if (deals.length > 8) throw new Error("Maximum 8 deals per batch.");

  var results = await Promise.all(
    deals.map(async function (deal) {
      var age = Math.max(0, Math.min(3650, parseInt(deal.ageDays, 10) || 0));
      var amount = Math.max(1, Math.min(10000, parseInt(deal.amountK, 10) || 1));
      var closeP = Math.max(0, Math.min(100, parseInt(deal.closePct, 10) || 0));
      var gapK = Math.max(0, Math.min(1000000, parseInt(deal.gapK, 10) || 0));
      var name = String(deal.name || "Deal").replace(/[^\w \-&.]/g, "").slice(0, 60);
      var prompt = buildPipelinePrompt(name, age, amount, closeP, gapK);
      try {
        var data = await groqChat({
          model: RISK_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 240,
          temperature: 0.25,
        });
        return parseRiskJson(data.choices[0].message.content, {
          score: 50, level: "Unknown", lossRisk: "", who: "Deal Desk",
          nextAction: "Could not parse — try again.", timeline: "", proposal: "",
        });
      } catch (e) {
        return {
          score: 50, level: "Unknown", lossRisk: "", who: "Deal Desk",
          nextAction: "API error — retry.", timeline: "", proposal: "",
        };
      }
    })
  );
  return results;
}

// Revenue-recovery prompt shared shape with GAS Code.js buildPipelinePrompt_.
// Returns { score, level, lossRisk, who, nextAction, timeline, proposal }.
function buildPipelinePrompt(name, age, amount, closeP, gapK) {
  return (
    "You are a revenue-recovery strategist for a B2B sales team. Write for the rep who owns this deal — " +
    "concrete, specific, and useful today. No filler, no generic 'schedule a call' advice.\n" +
    'Deal: "' + name + '" — $' + amount + "K, " + age + " days in pipeline, current close probability " +
    closeP + "%. The team is $" + gapK + "K short of quota this quarter.\n" +
    "Close probability decays ~15% every 30 days; deals over $100K decay 30% slower, over $250K 50% slower. " +
    "An aging, high-value deal below 50% is where the quarter is won or lost. Infer the likely deal type from its name " +
    "(renewal, new logo, expansion, mid-market, SMB) and tailor every field to it.\n" +
    "Return a rescue plan with these fields:\n" +
    "1. score — close probability 0-100 (integer).\n" +
    "2. level — one of Low, Medium, High, Critical (risk of LOSING the deal).\n" +
    "3. lossRisk — one sentence: WHY it is slipping and roughly WHEN it slips if nobody acts (a week window). Deal-specific.\n" +
    "4. who — the specific role AND stakeholder to reach now (e.g. 'Economic buyer (VP Ops) — bring in your Exec Sponsor and loop VP Sales'). Never a person's name.\n" +
    "5. nextAction — the single highest-leverage play this week (name the meeting, the lever, the blocker to clear). Time-bound.\n" +
    "6. timeline — how fast this must move, with a concrete gate (e.g. '5 business days — decision gate by Thursday').\n" +
    "7. proposal — a specific commercial offer to accelerate signature (term, discount, bundle, pilot, or milestone). Deal-appropriate.\n" +
    "Reply ONLY with JSON, no markdown: " +
    '{"score":62,"level":"High","lossRisk":"Momentum stalled after the security review; likely to push to next quarter within ~2 weeks without a forcing event.","who":"Economic buyer (VP Operations) — bring in your Exec Sponsor and loop VP Sales for air cover.","nextAction":"Run a mutual close plan and clear the open security-review item; secure a verbal commit.","timeline":"5 business days — lock a decision gate by Thursday.","proposal":"Offer a 2-year term at an 8% discount to pull signature into this quarter."}'
  );
}

// ── PROJECTS (custom only; built-ins are baked into the static page) ──────────
async function getCustomProjects() {
  try {
    var r = await execute("SELECT data FROM projects ORDER BY created_at ASC");
    return (r.rows || []).map(function (row) {
      return typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    });
  } catch (e) {
    return [];
  }
}
async function saveProject(args) {
  var p = args[0] || {};
  if (!p.id) throw new Error("Project id required.");
  await execute(
    "INSERT INTO projects (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)",
    [String(p.id), JSON.stringify(p)]
  );
  return { success: true };
}
async function deleteProject(args) {
  await execute("DELETE FROM projects WHERE id = ?", [String(args[0])]);
  return { success: true };
}

// ── ANALYTICS ─────────────────────────────────────────────────────────────────
async function getAnalyticsSummary() {
  var enabled = await loggingEnabled();
  try {
    var counts = await execute(
      "SELECT COUNT(*) AS messages, COUNT(DISTINCT session) AS sessions FROM chat_events"
    );
    var recent = await execute(
      "SELECT ts, session, type, role, message, model, tokens FROM chat_events ORDER BY id DESC LIMIT 20"
    );
    var rows = (recent.rows || []).reverse().map(function (r) {
      return {
        ts: r.ts,
        session: r.session,
        type: r.type,
        role: r.role,
        message: String(r.message || "").substring(0, 500),
        model: r.model,
        tokens: r.tokens,
      };
    });
    var c = counts.rows && counts.rows[0] ? counts.rows[0] : { messages: 0, sessions: 0 };
    return {
      sessions: Number(c.sessions) || 0,
      messages: Number(c.messages) || 0,
      rows: rows,
      loggingEnabled: enabled,
    };
  } catch (e) {
    return { sessions: 0, messages: 0, rows: [], loggingEnabled: enabled, error: e.message };
  }
}
async function clearChatLogs() {
  await execute("DELETE FROM chat_events");
  return { success: true };
}
async function toggleChatLogging(args) {
  var enabled = args[0] !== false && args[0] !== "false";
  await setSetting("chat_logging", enabled ? "true" : "false");
  return { success: true, loggingEnabled: enabled };
}
function saveApiKey() {
  // On Netlify the Groq key is a managed environment variable (GROQ_API_KEY),
  // not a runtime secret. This endpoint is kept so the existing admin UI doesn't
  // error; it simply confirms the managed setup.
  return { success: true, managed: true };
}

var HANDLERS = {
  proxyGroqChat: proxyGroqChat,
  calculateDealRisk: calculateDealRisk,
  calculatePipelineRisk: calculatePipelineRisk,
  getCustomProjects: getCustomProjects,
  saveProject: saveProject,
  deleteProject: deleteProject,
  getAnalyticsSummary: getAnalyticsSummary,
  clearChatLogs: clearChatLogs,
  toggleChatLogging: toggleChatLogging,
  saveApiKey: saveApiKey,
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });
  var headers = event.headers || {};
  if (!sec.originAllowed(headers)) return json(403, { ok: false, error: "Forbidden origin" });

  var req;
  try {
    req = JSON.parse(event.body || "{}");
  } catch (e) {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  var fn = req.fn;
  var args = Array.isArray(req.args) ? req.args : [];
  var handler = HANDLERS[fn];
  if (!handler) return json(400, { ok: false, error: "Unknown function: " + fn });

  // Admin gate.
  if (!PUBLIC_FNS[fn] && !sec.isAdminToken(req.adminToken)) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  // Rate limit public LLM calls.
  if (PUBLIC_FNS[fn] && fn !== "getCustomProjects") {
    var ip = sec.clientIp(headers);
    var ok = await sec.rateLimit(ip);
    if (!ok) return json(429, { ok: false, error: "Too many requests — please slow down a moment." });
  }

  try {
    var result = await handler(args);
    return json(200, { ok: true, result: result });
  } catch (err) {
    var status = err && err.notConfigured ? 503 : 500;
    return json(status, { ok: false, error: String((err && err.message) || err) });
  }
};
