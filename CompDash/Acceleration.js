// ============================================================
// SCRIPT NAME: Comp Health Report — Acceleration engine (P2)
// PURPOSE:     6·9·6·9·6 cadence state per opted-in I3/I4 —
//              readyNow / overdue checkpoints. The signal
//              schedules a review; Check01 governs the outcome.
// PURE. Same contract as Position.js — Node-testable.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.acceleration = 49;

// ── Calendar helpers ────────────────────────────────────────────────────────

function addMonthsCD_(d, months) {
  return new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
}

/** Whole calendar months from `start` to `asOf` (floor). */
function monthsBetweenCD_(start, asOf) {
  let m = (asOf.getFullYear() - start.getFullYear()) * 12 + (asOf.getMonth() - start.getMonth());
  if (asOf.getDate() < start.getDate()) m--;
  return m;
}

// ── Cadence state per opted-in Rocketeer ────────────────────────────────────
// Checkpoints at cfg.P2.ACCEL.offsetsMonths from trackStart. A checkpoint is
// "done" once ANY RD comp event lands on/after its due date (the review
// happened — the outcome is Check01's business, not this engine's), "overdue"
// when it passed more than overdueDays ago with no such event, "due" when
// reached but inside the grace window. readyNow = a checkpoint is reached
// (due OR overdue) AND the SI streak gate holds — it schedules a review,
// it never grants one.

/**
 * @param {{trackStart:?Date, asOf:Date, siHistory:Array, windowFqs:string[],
 *   reviewDates:Date[]}} v
 * @param {Object} cfg CONFIG_CD-shaped (P2.ACCEL)
 * @returns {?{monthsOnTrack:number, checkpoints:Array, readyNow:boolean,
 *   overdue:boolean, siStreakOk:boolean}} null when not on a track
 */
function buildAccelForEmp_(v, cfg) {
  const A = cfg.P2.ACCEL;
  if (!(v.trackStart instanceof Date) || isNaN(v.trackStart)) return null;
  const DAY = 86400000;
  const streakOk = siStreakOk_(v.siHistory, v.windowFqs,
    { streakMinCount: A.streakMinCount, streakMinRating: A.siGate });
  const events = (v.reviewDates || []).filter(d => d instanceof Date && !isNaN(d));
  const checkpoints = A.offsetsMonths.map((mo, i) => {
    const due = addMonthsCD_(v.trackStart, mo);
    const reviewed = events.some(d => d >= due);
    const daysPast = Math.floor((v.asOf - due) / DAY);
    let status = "future";
    if (reviewed) status = "done";
    else if (daysPast > A.overdueDays) status = "overdue";
    else if (daysPast >= 0) status = "due";
    return { idx: i + 1, monthOffset: mo, due: isoDate_(due), status };
  });
  const open = checkpoints.find(c => c.status === "due" || c.status === "overdue") || null;
  return {
    monthsOnTrack: monthsBetweenCD_(v.trackStart, v.asOf),
    checkpoints,
    readyNow: !!(open && streakOk),
    overdue: checkpoints.some(c => c.status === "overdue"),
    siStreakOk: streakOk,
  };
}

// ── Group rollup (level × Key Location) ─────────────────────────────────────

/**
 * @param {Array<{level:string, keyLocation:string, governingRatio:?number,
 *   accel:{readyNow:boolean, overdue:boolean}}>} rows one per on-track person
 */
function buildAccelGroups_(rows) {
  const map = new Map();
  (rows || []).forEach(r => {
    const k = r.level + "||" + (r.keyLocation || "—");
    if (!map.has(k)) map.set(k, { level: r.level, keyLocation: r.keyLocation || "—",
      onTrack: 0, readyNow: 0, overdue: 0, ratios: [] });
    const g = map.get(k);
    g.onTrack++;
    if (r.accel.readyNow) g.readyNow++;
    if (r.accel.overdue) g.overdue++;
    if (r.governingRatio != null) g.ratios.push(r.governingRatio);
  });
  return [...map.values()].map(g => ({
    level: g.level, keyLocation: g.keyLocation,
    onTrack: g.onTrack, readyNow: g.readyNow, overdue: g.overdue,
    medianMarketRatio: median_(g.ratios) != null
      ? Math.round(median_(g.ratios) * 100) / 100 : null,
  })).sort((a, b) => b.readyNow - a.readyNow || b.overdue - a.overdue ||
    a.keyLocation.localeCompare(b.keyLocation));
}
