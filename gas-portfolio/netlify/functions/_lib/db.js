// Supabase (serverless PostgreSQL) access layer.
//
// Uses the lightweight `postgres` npm package to connect directly to Supabase.
// You can also browse/query the data via the Supabase web dashboard, or connect
// a SQL editor (DBeaver, pgAdmin) via the connection string shown in Project Settings.
//
// Required env vars (set in Vercel/Netlify → Environment variables):
//   DATABASE_URL  e.g. postgres://user:password@host:port/database
//
// Get this from: Supabase → Project → Settings → Database → Connection string →
// Postgres (select the "Username & password" tab, or use the one shown).
//
// The postgres package handles connection pooling and works great with serverless
// cold starts. If DATABASE_URL is unset, db() throws — callers that want to
// degrade gracefully (e.g. chat logging) should swallow the error.

var conn = null;

function db() {
  if (conn) return conn;
  var url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Database is not configured (DATABASE_URL missing).");
  }
  var postgres = require("postgres");
  conn = postgres(url, { idle_timeout: 30 });
  return conn;
}

/**
 * Runs a parameterized query. Returns an object with { rows, rowsAffected }.
 * The postgres package handles escaping, so SQL injection is not possible.
 */
async function execute(sql, args) {
  var client = db();
  var result = await client(sql, args || []);
  return {
    rows: Array.isArray(result) ? result : [],
    rowsAffected: result.count || 0,
  };
}

module.exports = { db: db, execute: execute };
