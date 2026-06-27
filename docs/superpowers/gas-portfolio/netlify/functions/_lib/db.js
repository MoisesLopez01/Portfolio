// PlanetScale (serverless MySQL) access layer.
//
// The @planetscale/database driver talks to PlanetScale over HTTP fetch, which
// is the right model for serverless functions (no TCP pools to exhaust on cold
// starts). Your MySQL Workbench connects to the SAME database over the normal
// MySQL protocol using the same host/username/password — so you keep your
// existing workflow for browsing/querying the data.
//
// Required env vars (set in Netlify → Site settings → Environment variables):
//   DATABASE_HOST       e.g. aws.connect.psdb.cloud
//   DATABASE_USERNAME
//   DATABASE_PASSWORD
//
// If these are unset, db() throws — callers that want to degrade gracefully
// (e.g. chat logging) should swallow the error.

var conn = null;

function db() {
  if (conn) return conn;
  var host = process.env.DATABASE_HOST;
  var username = process.env.DATABASE_USERNAME;
  var password = process.env.DATABASE_PASSWORD;
  if (!host || !username || !password) {
    throw new Error("Database is not configured (DATABASE_* env vars missing).");
  }
  var planetscale = require("@planetscale/database");
  conn = planetscale.connect({ host: host, username: username, password: password });
  return conn;
}

/**
 * Runs a parameterized query. Returns the driver result
 * ({ rows, insertId, rowsAffected, ... }).
 */
async function execute(sql, args) {
  return db().execute(sql, args || []);
}

module.exports = { db: db, execute: execute };
