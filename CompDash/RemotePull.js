// ============================================================
// SCRIPT NAME: Comp Health Report — RemotePull engine (P2)
// PURPOSE:     Per-person market signal governed by the market
//              that can actually poach: remote-pull benchmark
//              first, local market as a labeled fallback.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.remotepull = 48;

// ── SI streak (high-performer gate) ─────────────────────────────────────────
// "SI streak ≥ 4 across the last 3–4 completed reviews": take the ratings that
// fall inside the completed-quarter evidence window, keep the most recent
// up-to-4, require at least streakMinCount of them and every one ≥
// streakMinRating. Sparse raters (fewer than streakMinCount window ratings)
// never qualify — a streak needs evidence, not absence.

/**
 * @param {Array<{fq:string, rate:number}>} history full rating history (buildPerfForEmp_ shape)
 * @param {string[]} windowFqs completed-quarter labels (lastCompletedQuarters_)
 * @param {{streakMinCount:number, streakMinRating:number}} R cfg.P2.REMOTE or cfg.P2.ACCEL
 * @returns {boolean}
 */
function siStreakOk_(history, windowFqs, R) {
  const win = (history || [])
    .filter(r => r && typeof r.rate === "number" && isFinite(r.rate) &&
                 windowFqs.indexOf(String(r.fq)) !== -1)
    .sort((a, b) => String(a.fq).localeCompare(String(b.fq)))
    .slice(-4);
  return win.length >= R.streakMinCount && win.every(r => r.rate >= R.streakMinRating);
}

// ── Person signal — governed by the market that can poach ──────────────────
// Hierarchy (spec 2026-08-12 §RemotePull): remote-pull benchmark governs;
// local market is a labeled fallback; internal percentile is context only —
// an internal-only gap can never raise more than NORMAL.

/**
 * @param {{tccUsd:?number, remoteRow:?{meanUsd:number}, localMarketRatio:?number,
 *   internalRatio:?number, comparable:boolean, siStreakOk:boolean,
 *   onAccelTrack:boolean}} v
 * @param {Object} cfg CONFIG_CD-shaped (P2.REMOTE)
 * @returns {{localRatio:?number, remotePullRatio:?number,
 *   benchScope:("remote"|"local-only"|"none"), signal:string, highPerformer:boolean}}
 */
function buildRemotePullForEmp_(v, cfg) {
  const R = cfg.P2.REMOTE;
  if (v.comparable === false) {
    return { localRatio: null, remotePullRatio: null, benchScope: "none",
             signal: "not-comparable", highPerformer: false };
  }
  // Currency trap: remote ratios computed on tccUsd ONLY — never local TCC.
  const remotePullRatio = (v.remoteRow && v.remoteRow.meanUsd > 0 && v.tccUsd > 0)
    ? Math.round(v.tccUsd / v.remoteRow.meanUsd * 1000) / 1000 : null;
  const benchScope = remotePullRatio != null ? "remote"
    : (v.localMarketRatio != null ? "local-only" : "none");
  const governing = remotePullRatio != null ? remotePullRatio : v.localMarketRatio;
  const highPerformer = !!(v.siStreakOk || v.onAccelTrack);
  let signal = "pending";
  if (governing != null) {
    if (governing >= R.competitiveMin) signal = "COMPETITIVE";
    else if (governing >= R.stableMin) {
      // NORMAL = below the internal group median but market-safe. Internal-only
      // evidence can never escalate past this state (small groups misclassify).
      signal = (v.internalRatio != null && v.internalRatio < 1.0) ? "NORMAL" : "STABLE";
    } else {
      signal = highPerformer ? "RISK_IMMEDIATE" : "RISK";
    }
  }
  return { localRatio: v.localMarketRatio != null ? v.localMarketRatio : null,
           remotePullRatio, benchScope, signal, highPerformer };
}
