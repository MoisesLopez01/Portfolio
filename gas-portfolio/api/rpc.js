// api/rpc.js — Vercel serverless entry for the portfolio RPC endpoint.
//
// Thin adapter over the canonical handler in netlify/functions/rpc.js so the
// exact same dispatch, security, and rate-limit code serves both hosts. The
// browser contract is identical either way: POST { fn, args, adminToken } to
// /api/rpc (see runServer in JavaScript.html). Vercel serves this file at
// /api/rpc by convention — no rewrite needed.
//
// Secrets (GROQ_API_KEY, DATABASE_*, RESEND_*, ADMIN_TOKEN) live ONLY in
// Vercel project environment variables — never in the shipped bundle.

var netlifyHandler = require("../netlify/functions/rpc").handler;

module.exports = async function (req, res) {
  // Vercel pre-parses JSON bodies; the canonical handler expects a raw string.
  var body = req.body;
  var event = {
    httpMethod: req.method,
    headers: req.headers || {},
    body: typeof body === "string" ? body : JSON.stringify(body || {}),
  };

  var out = await netlifyHandler(event);

  var headers = out.headers || {};
  Object.keys(headers).forEach(function (k) {
    res.setHeader(k, headers[k]);
  });
  res.status(out.statusCode).send(out.body);
};
