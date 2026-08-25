// Security helpers for the public RPC endpoint:
//   - originAllowed(): blocks cross-site browser abuse without breaking
//     same-origin calls (which may omit the Origin header).
//   - clientIp(): best-effort visitor IP from host headers (Netlify or Vercel).
//   - rateLimit(): DB-backed per-IP sliding window so one visitor can't drain
//     the Groq quota. Fails OPEN if the DB is unavailable (availability over
//     strictness for a portfolio site).
//   - isAdminToken(): constant-time-ish comparison against ADMIN_TOKEN.

var execute = require("./db").execute;

function originAllowed(headers) {
  var allowed = process.env.ALLOWED_ORIGIN; // e.g. https://alexlopez.netlify.app
  if (!allowed) return true; // not configured → don't block
  var origin = headers.origin || headers.Origin || "";
  if (!origin) return true; // same-origin requests often omit Origin
  return origin === allowed;
}

function clientIp(headers) {
  return (
    headers["x-nf-client-connection-ip"] || // Netlify
    headers["x-real-ip"] ||                 // Vercel
    (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    "unknown"
  );
}

/**
 * Sliding-window rate limit. Returns true if the call is allowed.
 * @param {string} ip
 * @param {number} max     Max calls per window (default 20).
 * @param {number} windowS Window length in seconds (default 60).
 */
async function rateLimit(ip, max, windowS) {
  max = max || Number(process.env.RATE_LIMIT_MAX || 20);
  windowS = windowS || Number(process.env.RATE_LIMIT_WINDOW_S || 60);
  // windowS is a trusted config integer, not user input. MySQL prepared
  // statements don't reliably accept a placeholder inside INTERVAL, so we
  // inline it after coercing to a safe integer.
  var win = Math.max(1, Math.min(3600, Math.floor(windowS)));
  try {
    await execute("INSERT INTO rate_hits (ip) VALUES (?)", [ip]);
    var res = await execute(
      "SELECT COUNT(*) AS n FROM rate_hits WHERE ip = ? AND ts > (NOW() - INTERVAL " + win + " SECOND)",
      [ip]
    );
    // Opportunistic cleanup of rows older than the window (keeps the table small).
    await execute("DELETE FROM rate_hits WHERE ts < (NOW() - INTERVAL " + win + " SECOND)");
    var n = res.rows && res.rows[0] ? Number(res.rows[0].n) : 0;
    return n <= max;
  } catch (err) {
    console.log("[ratelimit] DB unavailable, failing open: " + (err && err.message));
    return true;
  }
}

function isAdminToken(token) {
  var expected = process.env.ADMIN_TOKEN || "";
  if (!expected) return false;
  if (typeof token !== "string" || token.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < expected.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

module.exports = {
  originAllowed: originAllowed,
  clientIp: clientIp,
  rateLimit: rateLimit,
  isAdminToken: isAdminToken,
};
