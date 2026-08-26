// Supabase (serverless PostgreSQL) access layer.
//
// Uses the lightweight `postgres` npm package to connect directly to Supabase.
// You can also browse/query the data via the Supabase web dashboard, or connect
// a SQL editor (DBeaver, pgAdmin) via the connection string shown in Project Settings.
//
// Required env vars (set in Vercel/Netlify → Environment variables):
//   DATABASE_URL  e.g. postgres://postgres.xxxx:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
//
// Get this from: Supabase → Project → Connect (top bar) → "Transaction pooler"
// connection string. Use the POOLER string (port 6543), not the direct
// connection — serverless hosts like Vercel need the pooler.
//
// If DATABASE_URL is unset, db() throws — callers that want to degrade
// gracefully (e.g. chat logging) should swallow the error.

var conn = null;

function db() {
  if (conn) return conn;
  var url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Database is not configured (DATABASE_URL missing).");
  }
  var postgres = require("postgres");
  // prepare:false — Supabase's transaction pooler (PgBouncer) doesn't support
  // prepared statements. max:1 — one connection per serverless instance.
  conn = postgres(url, { ssl: "require", prepare: false, max: 1, idle_timeout: 20 });
  return conn;
}

/**
 * Runs a parameterized query ($1, $2, … placeholders). Returns { rows, rowsAffected }.
 * client.unsafe() is the raw-string entry point of the postgres package — the
 * "unsafe" refers to the SQL string being caller-supplied; the args are still
 * bound server-side as real parameters, so user input is never interpolated.
 */
async function execute(sql, args) {
  var client = db();
  var result = await client.unsafe(sql, args || []);
  return {
    rows: Array.isArray(result) ? Array.from(result) : [],
    rowsAffected: typeof result.count === "number" ? result.count : 0,
  };
}

module.exports = { db: db, execute: execute };
