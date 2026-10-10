// ============================================================
// TempoCapacityTime.js
// Exports Tempo capacity (work-schedule required hours) for all
// Rocketeers into the "Capacity Tempo" sheet: one row per person,
// one column per ISO week. Past weeks are FROZEN; each Friday run
// refreshes only the week it SERVES (next Monday) plus CONFIGCap.FUTURE_WEEKS
// beyond it. The sheet's span is anchored on that served week so it equals
// what the planned export writes: [served − EXPORT_HISTORY_WEEKS,
// served + FUTURE_WEEKS] — see computeCapacityWindow_ / diagnoseCapacityExport.
// Downstream: utilization = Tracked ÷ Capacity, joined on (User, Week).
// Spec: project-demand-dashboard/docs/specs/2026-07-15-tempo-capacity-export-design.md
//
// SHARED GLOBALS (from TempoPlanExport.js — do not redeclare):
//   MERGE_MAP, EXCLUDE_IDS, CONFIGPlan (API_BATCH_SIZE, FUTURE_WEEKS),
//   getCredentials_(), fetchAllTeamMembers_(), fetchUserNames_(),
//   buildWeekRanges_(), isoWeekLabel_(), formatWeekLabel_(),
//   parseDateLocal_(), fmtDate_(), minDate_(), round2_()
// ============================================================

const CONFIGCap = {
  SCRIPT_LABEL: "Tempo Capacity Reports",
  SHEET_NAME: "Capacity Tempo",   // output tab — dashboard joins on (User, Week)
  // ── Runway beyond the served week — MIRRORS the planned export ──
  // The planned export's tab spans [this Monday − EXPORT_HISTORY_WEEKS,
  // this Sunday + FUTURE_WEEKS]. This export runs on Friday and SERVES the
  // following week, so its floor and horizon are both anchored on that
  // served Monday: a Monday-morning comparison of the two tabs shows the same
  // first and last ISO column. Read from CONFIGPlan so the two dials cannot
  // drift apart again (they had: 4 here vs 5 there).
  get FUTURE_WEEKS() {
    return typeof CONFIGPlan !== "undefined" && typeof CONFIGPlan.FUTURE_WEEKS === "number"
      ? CONFIGPlan.FUTURE_WEEKS
      : 5;
  },
  // ── Rolling history floor (was fixed "2026-05-25" / "2026.W22") ──
  // This sheet is the one MERGE-based export: history lives in the sheet and
  // only the refresh window is fetched. The floor is therefore a TRIM rule —
  // it both sets how deep a backfill goes and how much history is retained.
  // Rolling it off EXPORT_HISTORY_WEEKS keeps the sheet bounded (old columns
  // age out) while matching the depth the other three exports carry.
  // Free to widen: the Tempo user-schedule endpoint takes from/to, so a
  // deeper window is the same one request per person, not one per week.
  get HISTORY_WEEKS() {
    return typeof exportHistoryWeeks_ === "function" ? exportHistoryWeeks_() : 52;
  },
  get BACKFILL_FROM() { return fmtDate_(capacityFloorMonday_(new Date())); },
  get MIN_ISO_WEEK()  { return isoWeekLabel_(capacityFloorMonday_(new Date())); },
  TRIGGER_HOUR: 8,                // Friday trigger hour (24h clock)
  RETRY_ROUNDS: 2,                // extra passes over failed schedule requests
  RETRY_PAUSE_MS: 2000,           // pause before each retry pass (Tempo 500 bursts)
  HEADER_BG: "#4472C4",
  HEADER_FONT: "#FFFFFF",
  TOTAL_ROW_BG: "#D6E4F0",
};

// ── SECTION: MAIN ENTRY POINT ────────────────────────────────

/**
 * Maintains the "Capacity Tempo" sheet. Safe to re-run any time (idempotent
 * for the same window). Reads the stored grid, fetches only the refresh
 * window (next Monday → +FUTURE_WEEKS, backfill/gap-heal when needed),
 * merges in memory, and rewrites the sheet in one pass.
 * Any fetch-stage failure throws BEFORE the sheet is touched.
 * Install the Friday trigger once via createCapacityWeeklyTrigger().
 */
function fetchTempoCapacity() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('fetchTempoCapacity');
  else Logger.log('⚠️ [fetchTempoCapacity] requireMaintainer_ not in this project — running ungated.');
  try {
    Logger.log(`🕐 [fetchTempoCapacity] Started at ${new Date().toISOString()}`);

    const { tempoToken, jiraEmail, jiraToken } = getCredentials_();

    const existing = readCapacitySheet_();
    const win = computeCapacityWindow_(existing.isoWeeks, new Date());
    const fromStr = fmtDate_(win.from);
    const toStr = fmtDate_(win.to);
    Logger.log(
      `ℹ️ Window: ${fromStr} → ${toStr}${win.backfill ? " (backfill — empty sheet)" : ""}; ` +
        `${existing.isoWeeks.length} stored week(s) frozen before ${fromStr}`,
    );
    Logger.log(
      `ℹ️ Serving ${isoWeekLabel_(win.served)}; sheet after this run: ` +
        `${CONFIGCap.MIN_ISO_WEEK} → ${isoWeekLabel_(win.to)} ` +
        `(${CONFIGCap.HISTORY_WEEKS} history + served week + ${CONFIGCap.FUTURE_WEEKS} future — ` +
        `the same span as "${typeof CONFIGPlan !== "undefined" ? CONFIGPlan.SHEET_NAME : "Planned Time Tempo"}").`,
    );
    const lastStored = existing.isoWeeks.slice().sort().pop() || "";
    if (lastStored && lastStored < isoWeekLabel_(win.served)) {
      // Missed Friday(s): the gap rule already pulled `from` back, so this run
      // heals it — but say so, because a silent heal hides a dead trigger.
      Logger.log(
        `⚠️ Stored data ended at ${lastStored}, before the served week — run(s) were missed. ` +
          `Healing from ${fromStr}; check the trigger with diagnoseCapacityExport().`,
      );
    }

    // teamInfoById is filled in place: effectiveId → { teams[] }. Collecting it
    // here is what lets the Team column below exist for EVERY person in a Tempo
    // team, not only those who happened to log time — see writeCapacitySheet_.
    const teamInfoById = {};
    const workerIds = fetchAllTeamMembers_(tempoToken, teamInfoById);
    if (workerIds.length === 0) throw new Error("❌ No workers found in any Tempo Team.");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    const endpoint = resolveCapacityEndpoint_(tempoToken, workerIds.slice(0, 3), fromStr, toStr);
    const fetched = fetchSchedulesForWindow_(tempoToken, endpoint, workerIds, userMap, fromStr, toStr);

    const windowIsoWeeks = buildWeekRanges_(win.from, win.to).map((w) => w.isoLabel);
    const grid = mergeCapacityGrid_(existing.rows, fetched, windowIsoWeeks, teamInfoById);
    writeCapacitySheet_(grid);

    // Name normalization (Change Names.js) — Jira display names → roster
    // legal names, in-place. User lives in column B (column A is the
    // accountId merge key, so renaming can't split anyone's history), and
    // every run rewrites names from Jira, so this must run every time.
    try {
      const capSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGCap.SHEET_NAME);
      const renamed = normalizeSheetNames_(capSheet, NAME_MAPST.TEMPO, 2, 3);
      Logger.log(`ℹ️ Name normalization: ${renamed} name(s) updated.`);
    } catch (e) {
      Logger.log(`⚠️ Name normalization skipped (${e.message}) — run normalizeAllNames() manually.`);
    }

    Logger.log(
      `✅ [fetchTempoCapacity] Done. ${grid.rows.length} rocketeers × ${grid.isoWeeks.length} weeks.`,
    );
  } catch (e) {
    Logger.log(`❌ [fetchTempoCapacity] ${e.message}`);
    throw e;
  }
}

// ── SECTION: TRIGGER SETUP ───────────────────────────────────

/**
 * ONE-TIME SETUP: installs the weekly refresh trigger — every FRIDAY at
 * CONFIGCap.TRIGGER_HOUR — replacing any prior fetchTempoCapacity triggers.
 * Friday cadence is deliberate: the run rewrites FUTURE weeks only, so the
 * current week's final value is what last Friday captured (see spec §3).
 */
function createCapacityWeeklyTrigger() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('createCapacityWeeklyTrigger');
  else Logger.log('⚠️ [createCapacityWeeklyTrigger] requireMaintainer_ not in this project — running ungated.');
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoCapacity")
    .forEach((t) => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger("fetchTempoCapacity")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(CONFIGCap.TRIGGER_HOUR)
    .create();

  Logger.log(
    `⚙️ Weekly trigger installed: every Friday at ${CONFIGCap.TRIGGER_HOUR}:00 → fetchTempoCapacity()`,
  );
}

// ── SECTION: DIAGNOSTICS (read-only, no sheet writes) ────────

/**
 * Health check for the "Capacity Tempo" tab — run from the GAS editor when
 * the range looks stale. Logs the installed fetchTempoCapacity trigger(s),
 * the range the sheet holds now, the window the next run would fetch and the
 * span it would leave behind, next to the planned export's current span
 * (the one this sheet is meant to match). Nothing is fetched or written.
 *
 * Why it exists: in 2026.W39 the tab sat at 2025.W32 → 2026.W36 — exactly one
 * run's output from 2026.W32 — because nothing had run for seven weeks. The
 * window math was right; the trigger was not firing. That is invisible from
 * the code and from the sheet, so this prints it.
 */
function diagnoseCapacityExport() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('diagnoseCapacityExport');
  else Logger.log('⚠️ [diagnoseCapacityExport] requireMaintainer_ not in this project — running ungated.');

  const today = new Date();

  // 1. Trigger. No trigger → the sheet only moves when someone runs it by hand.
  const triggers = ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "fetchTempoCapacity");
  if (triggers.length === 0) {
    Logger.log(
      "❌ No trigger installed for fetchTempoCapacity in THIS project — the sheet only moves " +
        "when someone runs it by hand. Run createCapacityWeeklyTrigger() once, as the script owner.",
    );
  } else {
    triggers.forEach((t) =>
      Logger.log(
        `✅ Trigger: ${t.getHandlerFunction()} · ${t.getEventType()} · ` +
          `source ${t.getTriggerSource()} · id ${t.getUniqueId()}`,
      ),
    );
    Logger.log(
      "   A trigger that exists but keeps failing shows under Executions → Failed; " +
        "the owner also gets the daily 'Summary of failures' email.",
    );
  }

  // 2. What the sheet holds vs what the next run would leave.
  const existing = readCapacitySheet_();
  const stored = existing.isoWeeks.slice().sort();
  const win = computeCapacityWindow_(existing.isoWeeks, today);
  const servedIso = isoWeekLabel_(win.served);
  const horizonIso = isoWeekLabel_(win.to);
  Logger.log(
    stored.length
      ? `ℹ️ Sheet holds ${stored.length} week(s): ${stored[0]} → ${stored[stored.length - 1]}, ` +
          `${Object.keys(existing.rows).length} row(s).`
      : `ℹ️ Sheet is empty or unrecognised — the next run backfills from ${CONFIGCap.MIN_ISO_WEEK}.`,
  );
  Logger.log(`ℹ️ Today ${fmtDate_(today)} (${isoWeekLabel_(today)}); the next run serves ${servedIso}.`);
  Logger.log(
    `ℹ️ Next run fetches ${fmtDate_(win.from)} → ${fmtDate_(win.to)}${win.backfill ? " (backfill)" : ""} ` +
      `and leaves the sheet at ${CONFIGCap.MIN_ISO_WEEK} → ${horizonIso}.`,
  );
  if (typeof CONFIGPlan !== "undefined" && CONFIGPlan.MIN_ISO_WEEK) {
    Logger.log(
      `ℹ️ "${CONFIGPlan.SHEET_NAME}" spans ${CONFIGPlan.MIN_ISO_WEEK} → ` +
        `${isoWeekLabel_(parseDateLocal_(CONFIGPlan.TO_DATE))} today ` +
        `(evaluated on the served Monday, this sheet lands on the same two columns).`,
    );
  }

  // 3. Verdict.
  const last = stored[stored.length - 1] || "";
  if (!last) {
    Logger.log("ℹ️ Nothing stored yet — run fetchTempoCapacity() for the first backfill.");
  } else if (last < servedIso) {
    Logger.log(
      `⚠️ STALE: stored data ends at ${last}, before the served week ${servedIso}. ` +
        `Run fetchTempoCapacity() now — the gap self-heals from ${fmtDate_(win.from)} — ` +
        `then make sure the trigger above exists.`,
    );
  } else if (last < horizonIso) {
    Logger.log(`ℹ️ Horizon short: stored through ${last}; the next run extends to ${horizonIso}.`);
  } else {
    Logger.log(`✅ Sheet is current (through ${last}).`);
  }
}

/**
 * ONE-OFF: logs both endpoint candidates' raw responses for the first
 * worker over the next 7 days. Run from the GAS editor to verify which
 * capacity source this workspace exposes before the first real run.
 * Public (no trailing underscore) so it appears in the editor's run dropdown.
 */
function probeCapacityEndpoint() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('probeCapacityEndpoint');
  else Logger.log('⚠️ [probeCapacityEndpoint] requireMaintainer_ not in this project — running ungated.');
  const { tempoToken } = getCredentials_();
  const workerIds = fetchAllTeamMembers_(tempoToken);
  if (workerIds.length === 0) {
    Logger.log("⚠️ No workers found — cannot probe.");
    return;
  }
  const id = workerIds[0];
  const fromStr = fmtDate_(new Date());
  const toD = new Date();
  toD.setDate(toD.getDate() + 6);
  const toStr = fmtDate_(toD);

  CAPACITY_ENDPOINTS_.forEach((ep) => {
    const res = UrlFetchApp.fetch(ep.url(id, fromStr, toStr), {
      method: "get",
      headers: { Authorization: `Bearer ${tempoToken}` },
      muteHttpExceptions: true,
    });
    Logger.log(
      `🔎 [${ep.key}] HTTP ${res.getResponseCode()} — ${res.getContentText().substring(0, 300)}`,
    );
  });
}

// ── SECTION: WINDOW MATH (pure — Node-tested) ────────────────

/**
 * The Monday of the week a run SERVES: the first Monday strictly after
 * `today`. A Friday run serves next week; a Monday run serves the week after
 * (today's week is already under way and stays frozen). Both the history
 * floor and the future horizon hang off this date, so the sheet's span equals
 * what the planned export writes when it runs during that week.
 * @param {Date} today - run date
 * @returns {Date} local-midnight Monday
 */
function capacityServedMonday_(today) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}

/**
 * Rolling history floor: CONFIGCap.HISTORY_WEEKS full weeks before the served
 * week — the planned export's rollingWindowMonday_(HISTORY_WEEKS) as evaluated
 * during that week. Takes `today` rather than reading the clock so the window
 * math stays deterministic under test — the config getters pass `new Date()`,
 * the tests pass a fixed date.
 * @param {Date} today - run date
 * @returns {Date} local-midnight Monday
 */
function capacityFloorMonday_(today) {
  const d = capacityServedMonday_(today);
  d.setDate(d.getDate() - CONFIGCap.HISTORY_WEEKS * 7);
  return d;
}

/**
 * Returns the local-midnight Monday of an ISO week label ("YYYY.WNN").
 * Inverse of isoWeekLabel_ (TempoPlanExport.js). ISO week 1 contains Jan 4.
 * @param {string} isoLabel - e.g. "2026.W30"
 * @returns {Date}
 */
function mondayOfIsoWeek_(isoLabel) {
  const m = /^(\d{4})\.W(\d{2})$/.exec(String(isoLabel));
  if (!m) throw new Error(`❌ [mondayOfIsoWeek_] Bad ISO week label: "${isoLabel}"`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(year, 0, 4);
  const dayNum = (jan4.getDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(year, 0, 4 - dayNum); // Monday of ISO week 1
  monday.setDate(monday.getDate() + (week - 1) * 7);
  return monday;
}

/**
 * Computes the [from, to] fetch window for a run.
 *
 * FREEZE RULE: stored weeks starting before `from` are never rewritten.
 *   - Normal run:   from = next Monday strictly after `today` → future weeks only;
 *                    the current week keeps what last Friday's run captured.
 *   - Gap self-heal: if stored data ends early (missed Fridays), from reaches
 *                    back to the Monday after the last stored week — those gap
 *                    weeks hold no data, so filling them never breaks the freeze.
 *   - First run:     empty sheet → historical backfill from the rolling floor.
 *   - Floor widened: stored history starts after the floor → one deep
 *                    re-fetch back to the floor, then forward-only again.
 *   - to is always the Sunday closing FUTURE_WEEKS full weeks AFTER the served
 *                    week — the planned export's rollingWindowSunday_(FUTURE_WEEKS)
 *                    as evaluated during the served week, so both tabs end on
 *                    the same ISO column.
 *
 * Pure function (Node-tested): no Sheets/UrlFetch access.
 *
 * @param {string[]} existingIsoWeeks - ISO labels already stored in the sheet
 * @param {Date}     today            - run date (injected for testability)
 * @returns {{ from: Date, to: Date, backfill: boolean, served: Date }}
 */
function computeCapacityWindow_(existingIsoWeeks, today) {
  const nextMonday = capacityServedMonday_(today);

  // Rolling floor for THIS run date (never real "now" — the caller injects
  // today so the window math stays unit-testable).
  const floor = capacityFloorMonday_(today);

  let from;
  let backfill = false;
  if (!existingIsoWeeks || existingIsoWeeks.length === 0) {
    from = floor;
    backfill = true;
  } else {
    const sorted = existingIsoWeeks.slice().sort(); // "YYYY.WNN" sorts lexically
    const firstStored = mondayOfIsoWeek_(sorted[0]);
    // DEEPENED FLOOR (needed the first run after EXPORT_HISTORY_WEEKS is
    // raised): the forward-extension rule below only ever reaches from the
    // last stored week onward, so without this branch the newly-requested
    // older weeks would stay permanently blank — the sheet would silently
    // carry less history than the dashboard asks for. One deep re-fetch, then
    // it converges back to the cheap forward-only path.
    if (floor < firstStored) {
      from = floor;
      backfill = true;
    } else {
      const afterLast = mondayOfIsoWeek_(sorted[sorted.length - 1]);
      afterLast.setDate(afterLast.getDate() + 7);
      from = minDate_(nextMonday, afterLast);
    }
  }

  // Served week + FUTURE_WEEKS further full weeks, closing on a Sunday.
  const to = new Date(nextMonday.getTime());
  to.setDate(to.getDate() + (CONFIGCap.FUTURE_WEEKS + 1) * 7 - 1);

  return { from, to, backfill, served: nextMonday };
}

// ── SECTION: SCHEDULE BUCKETING (pure — Node-tested) ─────────

/**
 * Buckets Tempo user-schedule day entries into ISO-week hour totals.
 * Zero-second days still create/keep their week key: an explicit 0 means
 * "scheduled zero hours" (e.g. full-week holiday), which downstream
 * utilization must distinguish from a blank ("unknown") cell.
 * @param {Array<{date: string, requiredSeconds: number}>} days
 * @returns {Object} isoWeekLabel → hours
 */
function scheduleToWeeklyHours_(days) {
  const weeks = {};
  (days || []).forEach((d) => {
    if (!d || !d.date) return;
    const iso = isoWeekLabel_(parseDateLocal_(d.date));
    weeks[iso] = (weeks[iso] || 0) + (d.requiredSeconds || 0) / 3600;
  });
  return weeks;
}

// ── SECTION: GRID MERGE (pure — Node-tested) ─────────────────

/**
 * Merges the stored sheet model with freshly fetched window data.
 *
 * FREEZE RULE (single source of truth for immutability):
 *   week ∈ windowIsoWeeks → fetched value wins (absent user/week → blank);
 *   week ∉ windowIsoWeeks → stored value wins; fetched values there are IGNORED.
 *
 * Users are unioned: new hires append (blank past), leavers keep frozen
 * history with blank window cells. `undefined` (no key) = blank = "unknown";
 * an explicit 0 = "scheduled zero hours" and IS written.
 *
 * OUTPUT FLOOR: weeks before CONFIGCap.MIN_ISO_WEEK are dropped entirely
 * (stored or fetched) — the next write permanently trims those columns.
 *
 * ── TEAM IS CURRENT, AND SAYS SO ─────────────────────────────────────────────
 * `teams` is deliberately NOT frozen the way week columns are. It is a
 * person-level attribute with ONE value per row, so "current Tempo membership"
 * is the whole and honest meaning of the cell. That is precisely what the
 * per-worklog-row Team stamp in TempoTrackedTime/TempoPlanExport cannot claim:
 * those re-write 52 weeks of history to today's squad and thereby look like
 * historical fact. One current-membership column is the narrower, truthful
 * claim — and it is the column the Delivery Health dashboard should join on.
 *
 * Stored teams survive when Tempo no longer returns the person (they left a
 * team, or the fetch dropped them): losing the label would move them into the
 * dashboard's "(No team)" bucket, which is the exact bug this column exists to
 * close.
 *
 * @param {Object} existingRows   - accountId → { name, teams, weeks: {iso → hrs} }
 * @param {Object} fetched        - accountId → { name, weeks: {iso → hrs} }
 * @param {string[]} windowIsoWeeks - ISO labels covered by this fetch
 * @param {Object=} teamInfoById  - effectiveId → { teams[] } from fetchAllTeamMembers_
 * @returns {{ isoWeeks: string[], rows: Array<{accountId, name, teams, weeks}> }}
 */
function mergeCapacityGrid_(existingRows, fetched, windowIsoWeeks, teamInfoById) {
  const windowSet = new Set(windowIsoWeeks);

  const isoSet = new Set(windowIsoWeeks);
  Object.keys(existingRows).forEach((id) => {
    Object.keys(existingRows[id].weeks).forEach((iso) => isoSet.add(iso));
  });
  const isoWeeks = Array.from(isoSet)
    .filter((iso) => iso >= CONFIGCap.MIN_ISO_WEEK) // "YYYY.WNN" compares chronologically
    .sort();

  const ids = new Set(Object.keys(existingRows).concat(Object.keys(fetched)));
  const rows = [];
  ids.forEach((id) => {
    const oldRow = existingRows[id];
    const newRow = fetched[id];

    // Fetched display name wins unless the Jira lookup fell back to the raw id.
    const name =
      newRow && newRow.name && newRow.name !== id
        ? newRow.name
        : (oldRow && oldRow.name) || (newRow && newRow.name) || id;

    const weeks = {};
    isoWeeks.forEach((iso) => {
      if (windowSet.has(iso)) {
        if (newRow && iso in newRow.weeks) weeks[iso] = newRow.weeks[iso];
      } else if (oldRow && iso in oldRow.weeks) {
        weeks[iso] = oldRow.weeks[iso];
      }
    });

    // Live membership wins; stored label is the fallback so a person Tempo
    // stopped returning keeps their team rather than dropping to "(No team)".
    const live = (teamInfoById && teamInfoById[id] && teamInfoById[id].teams) || [];
    const teams = live.length ? live.join(" | ") : (oldRow && oldRow.teams) || "";

    rows.push({ accountId: id, name: name, teams: teams, weeks: weeks });
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { isoWeeks: isoWeeks, rows: rows };
}

// ── SECTION: TEMPO ENDPOINT ──────────────────────────────────

/**
 * Endpoint candidates, tried in order by resolveCapacityEndpoint_().
 * user-schedule is the documented Tempo v4 source of requiredSeconds/day;
 * the capacity path is a legacy fallback observed in some workspaces.
 * limit=1000 comfortably covers the full backfill window; a
 * metadata.next in the response is logged as an undercount warning.
 */
const CAPACITY_ENDPOINTS_ = [
  {
    key: "user-schedule",
    url: (id, from, to) =>
      `https://api.tempo.io/4/user-schedule/${encodeURIComponent(id)}?from=${from}&to=${to}&limit=1000`,
  },
  {
    key: "capacity",
    url: (id, from, to) =>
      `https://api.tempo.io/4/capacity/users/${encodeURIComponent(id)}?from=${from}&to=${to}&limit=1000`,
  },
];

/**
 * Probes the candidates in order and returns the first that answers 200.
 * Up to three workers are tried per endpoint so a single schedule-less
 * account cannot falsely disqualify a healthy endpoint and abort the run.
 * Throws (sheet untouched) if no candidate answers 200 for any probed worker.
 * @param {string} tempoToken
 * @param {string[]} probeUserIds - first few worker account IDs
 * @param {string} fromStr - "YYYY-MM-DD"
 * @param {string} toStr   - "YYYY-MM-DD"
 * @returns {{ key: string, url: Function }}
 */
function resolveCapacityEndpoint_(tempoToken, probeUserIds, fromStr, toStr) {
  for (let i = 0; i < CAPACITY_ENDPOINTS_.length; i++) {
    const ep = CAPACITY_ENDPOINTS_[i];
    for (let u = 0; u < probeUserIds.length; u++) {
      const res = UrlFetchApp.fetch(ep.url(probeUserIds[u], fromStr, toStr), {
        method: "get",
        headers: { Authorization: `Bearer ${tempoToken}` },
        muteHttpExceptions: true,
      });
      const code = res.getResponseCode();
      if (code === 200) {
        Logger.log(`✅ [resolveCapacityEndpoint_] Using "${ep.key}" endpoint.`);
        return ep;
      }
      Logger.log(
        `⚠️ [resolveCapacityEndpoint_] "${ep.key}" → HTTP ${code} for ${probeUserIds[u]}; trying next probe.`,
      );
    }
  }
  throw new Error(
    "❌ No Tempo capacity endpoint available (user-schedule and capacity both failed). Sheet left untouched.",
  );
}

// ── SECTION: SHEET READ-BACK ─────────────────────────────────

/**
 * Reads the existing "Capacity Tempo" sheet into the in-memory model.
 * Missing sheet, no data rows, or an unrecognized layout (pre-schema tab)
 * all return the empty model → the run enters backfill mode.
 * Non-numeric / blank week cells are skipped (blank = unknown).
 * @returns {{ isoWeeks: string[], rows: Object }} rows: accountId → {name, weeks}
 */
// Fixed (non-week) leading columns written by writeCapacitySheet_:
// Account ID · User · Team. The Team column was added 2026-08-24 so the
// Delivery Health dashboard can join a person to their squad WITHOUT needing a
// worklog row to carry it (see mergeCapacityGrid_).
const CAP_FIXED_COLS_ = 3;

/**
 * How many fixed columns a STORED sheet has.
 *
 * ⚠️ THIS IS LOAD-BEARING, AND ITS FAILURE MODE IS SILENT DATA LOSS.
 * readCapacitySheet_ feeds the freeze half of freeze-and-merge: whatever it
 * fails to return is not frozen, and the next write permanently trims those
 * columns. A sheet written before the Team column exists has TWO fixed columns.
 * Had this stayed hard-coded at the new 3, the first run after deploy would
 * have read every stored week one column out of place, produced garbage or an
 * "unrecognized layout" empty, and silently trimmed up to 52 weeks of capacity
 * history that cannot be re-fetched (Tempo only serves the live window).
 *
 * So the count is DETECTED, not assumed, and the old layout is read correctly
 * one last time — the next write upgrades the sheet in place.
 *
 * @param {Array} hdrRow row 2 of the sheet
 * @returns {number} 3 when the Team column is present, else 2
 */
function capFixedCols_(hdrRow) {
  return String(hdrRow[2] || "").trim() === "Team" ? 3 : 2;
}

function readCapacitySheet_() {
  const empty = { isoWeeks: [], rows: {} };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIGCap.SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 3) return empty;

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();
  const isoRow = values[0];
  const hdrRow = values[1];

  if (hdrRow[0] !== "Account ID" || hdrRow[1] !== "User") {
    Logger.log(
      `⚠️ [readCapacitySheet_] Unrecognized "${CONFIGCap.SHEET_NAME}" layout — treating as empty (backfill mode).`,
    );
    return empty;
  }

  // Week columns: first non-fixed column … last-1 (final column is "Total (hrs)").
  // fixedCols is DETECTED so a pre-Team sheet still reads correctly — see
  // capFixedCols_ for why getting this wrong destroys history.
  const fixedCols = capFixedCols_(hdrRow);
  if (fixedCols === 2) {
    Logger.log(
      `ℹ️ [readCapacitySheet_] Pre-Team layout detected (2 fixed columns). ` +
        `Reading it as-is; this write upgrades the sheet to include "Team".`,
    );
  }
  const isoWeeks = [];
  const colByIso = {};
  for (let c = fixedCols; c < hdrRow.length - 1; c++) {
    const iso = String(isoRow[c] || "").trim();
    if (/^\d{4}\.W\d{2}$/.test(iso)) {
      isoWeeks.push(iso);
      colByIso[iso] = c;
    }
  }

  const rows = {};
  for (let r = 2; r < values.length; r++) {
    const accountId = String(values[r][0] || "").trim();
    if (!accountId) continue; // footer (TOTAL) and stray rows have no accountId
    const weeks = {};
    isoWeeks.forEach((iso) => {
      const v = values[r][colByIso[iso]];
      if (typeof v === "number") weeks[iso] = v;
    });
    rows[accountId] = {
      name: String(values[r][1] || "").trim(),
      // "" on a pre-Team sheet — mergeCapacityGrid_ fills it from live Tempo.
      teams: fixedCols === 3 ? String(values[r][2] || "").trim() : "",
      weeks: weeks,
    };
  }

  return { isoWeeks: isoWeeks, rows: rows };
}

// ── SECTION: SCHEDULE FETCH ──────────────────────────────────

/**
 * Fetches every rocketeer's work schedule for the window and buckets it
 * into ISO-week hours. One request per person for the whole window
 * (daily results are bucketed locally) — ~60 requests/run, not ~300.
 *
 * MERGE_MAP note (differs from the planned/tracked exports on purpose):
 * capacity is per PERSON, not per account. A MERGE_MAP secondary carries
 * its own default 8 h/day Tempo schedule, so SUMMING schedules would
 * double the person's capacity. The list is collapsed to unique effective
 * (primary) IDs and each schedule is fetched exactly once.
 *
 * Per-user non-200 → retried in RETRY_ROUNDS full batches (Tempo answers
 * intermittent 500s under fetchAll bursts; first live backfill lost 26/192
 * without retries). Still failing after retries → that user is absent from
 * the result (window cells stay blank, never zeroed) and logged with their
 * display name. All users failing → throw, sheet untouched.
 *
 * @param {string}   tempoToken
 * @param {{url: Function, key: string}} endpoint - from resolveCapacityEndpoint_
 * @param {string[]} workerIds - raw IDs from fetchAllTeamMembers_
 * @param {Object}   userMap   - accountId → display name
 * @param {string}   fromStr   - "YYYY-MM-DD"
 * @param {string}   toStr     - "YYYY-MM-DD"
 * @returns {Object} effectiveAccountId → { name, weeks: {iso → hrs} }
 */
function fetchSchedulesForWindow_(tempoToken, endpoint, workerIds, userMap, fromStr, toStr) {
  const effectiveIds = [];
  const seen = new Set();
  workerIds.forEach((rawId) => {
    const eff = MERGE_MAP[rawId] || rawId;
    if (!seen.has(eff)) {
      seen.add(eff);
      effectiveIds.push(eff);
    }
  });

  const buildRequest_ = (id) => ({
    url: endpoint.url(id, fromStr, toStr),
    method: "get",
    headers: { Authorization: `Bearer ${tempoToken}` },
    muteHttpExceptions: true,
  });

  Logger.log(
    `ℹ️ [fetchSchedulesForWindow_] ${effectiveIds.length} schedule requests (${fromStr} → ${toStr}) via "${endpoint.key}"`,
  );

  const fetched = {};
  const lastCode = {}; // id → last non-200 HTTP code, for the final report
  let pending = effectiveIds;

  for (
    let attempt = 0;
    attempt <= CONFIGCap.RETRY_ROUNDS && pending.length > 0;
    attempt++
  ) {
    if (attempt > 0) {
      Logger.log(
        `ℹ️ [fetchSchedulesForWindow_] Retry ${attempt}/${CONFIGCap.RETRY_ROUNDS} for ${pending.length} failed request(s) after ${CONFIGCap.RETRY_PAUSE_MS} ms…`,
      );
      Utilities.sleep(CONFIGCap.RETRY_PAUSE_MS);
    }

    const failed = [];
    for (let b = 0; b < pending.length; b += CONFIGPlan.API_BATCH_SIZE) {
      const slice = pending.slice(b, b + CONFIGPlan.API_BATCH_SIZE);
      const responses = UrlFetchApp.fetchAll(slice.map(buildRequest_));
      responses.forEach((res, i) => {
        const id = slice[i];
        if (res.getResponseCode() !== 200) {
          lastCode[id] = res.getResponseCode();
          failed.push(id);
          return;
        }
        const body = JSON.parse(res.getContentText());
        if (body.metadata && body.metadata.next) {
          Logger.log(
            `   ⚠️ Schedule for ${id} paginated beyond limit — window may undercount; shorten BACKFILL window or raise limit.`,
          );
        }
        fetched[id] = {
          name: userMap[id] || id,
          weeks: scheduleToWeeklyHours_(body.results || []),
        };
      });
    }
    pending = failed;
  }

  pending.forEach((id) => {
    Logger.log(
      `   ⚠️ Schedule HTTP ${lastCode[id]} for ${userMap[id] || id} (${id}) after ${CONFIGCap.RETRY_ROUNDS + 1} attempts — window cells left blank.`,
    );
  });

  const okCount = effectiveIds.length - pending.length;
  Logger.log(`ℹ️ [fetchSchedulesForWindow_] ok=${okCount} failed=${pending.length} of ${effectiveIds.length}`);
  if (okCount === 0) {
    throw new Error("❌ Every schedule request failed — aborting without touching the sheet.");
  }
  return fetched;
}

// ── SECTION: SHEET WRITE ─────────────────────────────────────

/**
 * Rewrites the "Capacity Tempo" sheet from a merged grid in one pass.
 * Layout: A=Account ID (hidden), B=User, C… ISO week columns, last=Total (hrs).
 * Row 1 = ISO labels, row 2 = date-range labels; TOTAL footer; frozen 2×2.
 * Blank cell = unknown (skipped in sums); explicit 0 = scheduled zero.
 * Only called AFTER a successful fetch — the sheet is never cleared earlier.
 * @param {{ isoWeeks: string[], rows: Array }} grid - from mergeCapacityGrid_
 */
function writeCapacitySheet_(grid) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIGCap.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIGCap.SHEET_NAME);
  sheet.clear();

  const isoWeeks = grid.isoWeeks;
  const totalCols = CAP_FIXED_COLS_ + isoWeeks.length + 1;

  const isoRow = ["", "", ""];
  const hdrRow = ["Account ID", "User", "Team"];
  isoWeeks.forEach((iso) => {
    const monday = mondayOfIsoWeek_(iso);
    const sunday = new Date(monday.getTime());
    sunday.setDate(sunday.getDate() + 6);
    isoRow.push(iso);
    hdrRow.push(formatWeekLabel_(monday, sunday));
  });
  isoRow.push("");
  hdrRow.push("Total (hrs)");

  const dataRows = grid.rows.map((row) => {
    let total = 0;
    let hasAny = false;
    const cells = isoWeeks.map((iso) => {
      const v = row.weeks[iso];
      if (typeof v !== "number") return ""; // blank = unknown, never coerced to 0
      total += v;
      hasAny = true;
      return round2_(v);
    });
    return [row.accountId, row.name, row.teams || ""].concat(
      cells, [hasAny ? round2_(total) : ""]);
  });

  const footer = new Array(totalCols).fill("");
  footer[1] = "TOTAL";
  for (let c = CAP_FIXED_COLS_; c < totalCols; c++) {
    let sum = 0;
    let seen = false;
    dataRows.forEach((r) => {
      if (typeof r[c] === "number") {
        sum += r[c];
        seen = true;
      }
    });
    footer[c] = seen ? round2_(sum) : ""; // all-blank column = unknown, not 0
  }

  const hdr = sheet.getRange(1, 1, 2, totalCols);
  hdr.setValues([isoRow, hdrRow]);
  hdr
    .setFontWeight("bold")
    .setBackground(CONFIGCap.HEADER_BG)
    .setFontColor(CONFIGCap.HEADER_FONT);

  if (dataRows.length > 0) {
    sheet.getRange(3, 1, dataRows.length, totalCols).setValues(dataRows);
  }
  const footRange = sheet.getRange(3 + dataRows.length, 1, 1, totalCols);
  footRange.setValues([footer]);
  footRange.setFontWeight("bold").setBackground(CONFIGCap.TOTAL_ROW_BG);

  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(CAP_FIXED_COLS_);
  sheet.hideColumns(1);
  sheet.autoResizeColumns(2, totalCols - 1);

  Logger.log(
    `ℹ️ [writeCapacitySheet_] rows=${dataRows.length} weeks=${isoWeeks.length} grand total=${footer[totalCols - 1]} hrs`,
  );
}

// ── SECTION: TESTS ────────────────────────────────────────────

/**
 * Deep-equality assert for the _test_* suite. Throws on mismatch so both
 * the GAS editor run and the Node runner fail loudly.
 * @param {*} actual
 * @param {*} expected
 * @param {string} msg
 */
function assertEq_(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`❌ ${msg}\n   expected: ${e}\n   actual:   ${a}`);
  }
  Logger.log(`   ✅ ${msg}`);
}

/** Window math: backfill, normal Friday run, gap self-heal, Monday edge. */
function _test_capacityWindow_() {
  Logger.log("🧪 _test_capacityWindow_");

  // mondayOfIsoWeek_ inverts isoWeekLabel_ (2026-03-30 is the Monday of 2026.W14).
  assertEq_(fmtDate_(mondayOfIsoWeek_("2026.W14")), "2026-03-30", "W14 Monday is 2026-03-30");
  assertEq_(isoWeekLabel_(mondayOfIsoWeek_("2026.W29")), "2026.W29", "ISO label round-trip");

  const friday = new Date("2026-07-17T09:00:00"); // Friday of 2026.W29

  // The floor is ROLLING off the injected run date, never the real clock —
  // that is what keeps this whole suite deterministic.
  assertEq_(fmtDate_(capacityFloorMonday_(friday)),
            fmtDate_(mondayOfIsoWeek_(isoWeekLabel_(capacityFloorMonday_(friday)))),
            "rolling floor always lands on a Monday");
  const floorIso = isoWeekLabel_(capacityFloorMonday_(friday));

  // Helper: a stored-week list that already reaches the floor, so the
  // forward-extension rules below are what's under test (not the deep
  // backfill branch). Ends at `lastIso`.
  const storedFromFloorTo_ = (lastIso) => {
    const out = [];
    const cur = capacityFloorMonday_(friday);
    const end = mondayOfIsoWeek_(lastIso);
    while (cur <= end) {
      out.push(isoWeekLabel_(cur));
      cur.setDate(cur.getDate() + 7);
    }
    return out;
  };

  // Empty sheet → backfill from the rolling floor; to = Sunday of W35
  // (served week W30 + FUTURE_WEEKS (5) further weeks).
  const w1 = computeCapacityWindow_([], friday);
  assertEq_(fmtDate_(w1.from), fmtDate_(capacityFloorMonday_(friday)),
            "empty sheet backfills from the rolling floor");
  assertEq_(w1.backfill, true, "backfill flag set");
  assertEq_(fmtDate_(w1.to), "2026-08-30", "to = Sunday of served week + FUTURE_WEEKS (W35)");

  // PARITY with the planned export: the served week (W30) is the anchor, so
  // the sheet spans exactly [W30 − HISTORY_WEEKS, W30 + FUTURE_WEEKS] — what
  // rollingWindowMonday_ / rollingWindowSunday_ produce when evaluated in W30.
  // This is the range the tab was drifting from (2026.W39: 4 vs 5 weeks of
  // runway, and a floor one week deeper than the planned tab's).
  assertEq_(CONFIGCap.FUTURE_WEEKS, CONFIGPlan.FUTURE_WEEKS, "FUTURE_WEEKS mirrors the planned export");
  assertEq_(fmtDate_(w1.served), "2026-07-20", "a Friday-of-W29 run serves W30");
  assertEq_(fmtDate_(capacityFloorMonday_(friday)), "2025-07-21",
            "floor = served Monday − HISTORY_WEEKS (2025.W30), not today's Monday − HISTORY_WEEKS");
  assertEq_(isoWeekLabel_(capacityFloorMonday_(friday)), "2025.W30", "floor ISO label");
  assertEq_(isoWeekLabel_(w1.to), "2026.W35", "horizon ISO label = served week + FUTURE_WEEKS");
  // A Monday run serves the week AFTER (this week is under way and frozen).
  assertEq_(fmtDate_(computeCapacityWindow_([], new Date("2026-07-13T09:00:00")).served), "2026-07-20",
            "a Monday-of-W29 run also serves W30");

  // Normal run: stored floor→W33 → from = next Monday (W30). W29 stays frozen.
  const w2 = computeCapacityWindow_(storedFromFloorTo_("2026.W33"), friday);
  assertEq_(fmtDate_(w2.from), "2026-07-20", "normal from = next Monday");
  assertEq_(w2.backfill, false, "no backfill flag on normal run");

  // Gap self-heal: run on Friday of W31 but stored only through W29 →
  // from reaches back to Monday of W30 (unstored weeks are not frozen).
  const w3 = computeCapacityWindow_(storedFromFloorTo_("2026.W29"),
                                    new Date("2026-07-31T09:00:00"));
  assertEq_(fmtDate_(w3.from), "2026-07-20", "gap heal: from = Monday after last stored week");
  assertEq_(fmtDate_(w3.to), "2026-09-13", "gap heal: to still = served week W32 + FUTURE_WEEKS (W37)");

  // Monday run: "next Monday" is STRICTLY after today; gap rule may pull from back to today.
  const w4 = computeCapacityWindow_(storedFromFloorTo_("2026.W28"),
                                    new Date("2026-07-13T09:00:00"));
  assertEq_(fmtDate_(w4.from), "2026-07-13", "Monday run heals current unstored week");

  // DEEPENED FLOOR: history was raised, so the stored grid starts AFTER the
  // floor. Forward-extension alone would leave the older weeks blank forever,
  // so this must re-fetch from the floor exactly once.
  const w5 = computeCapacityWindow_(["2026.W28", "2026.W29", "2026.W33"], friday);
  assertEq_(fmtDate_(w5.from), fmtDate_(capacityFloorMonday_(friday)),
            "stored history shallower than the floor → deep re-fetch from the floor");
  assertEq_(w5.backfill, true, "deepened floor sets the backfill flag");
  assertEq_(fmtDate_(w5.to), "2026-08-30", "deep re-fetch still ends at the future horizon");
  // …and once the grid covers the floor, it converges back to forward-only.
  assertEq_(computeCapacityWindow_(storedFromFloorTo_("2026.W33"), friday).backfill, false,
            "converges to the cheap forward-only path once history is filled");
  assertEq_(floorIso < "2026.W28", true, "52-week floor sits well before the stored sample weeks");
}

/** Daily user-schedule entries → ISO-week hour buckets. */
function _test_scheduleBucketing_() {
  Logger.log("🧪 _test_scheduleBucketing_");

  const days = [
    { date: "2026-07-20", requiredSeconds: 28800 }, // Mon W30 — 8h
    { date: "2026-07-21", requiredSeconds: 28800 }, // Tue W30 — 8h
    { date: "2026-07-25", requiredSeconds: 0 },     // Sat W30 — 0h day
    { date: "2026-07-27", requiredSeconds: 14400 }, // Mon W31 — half day
  ];
  assertEq_(scheduleToWeeklyHours_(days), { "2026.W30": 16, "2026.W31": 4 }, "seconds bucketed to ISO weeks as hours");

  // A fully zero-hour week must be PRESENT as 0 (scheduled zero), never dropped —
  // blank means "unknown" downstream, 0 means "not expected to work".
  assertEq_(
    scheduleToWeeklyHours_([{ date: "2026-07-20", requiredSeconds: 0 }]),
    { "2026.W30": 0 },
    "all-zero week present as explicit 0",
  );

  assertEq_(scheduleToWeeklyHours_([]), {}, "empty schedule → empty buckets");
  assertEq_(scheduleToWeeklyHours_([{ notADate: true }]), {}, "malformed entries skipped");
}

/** Freeze boundary, new hire, leaver, name refresh, blank-vs-zero. */
function _test_capacityMerge_() {
  Logger.log("🧪 _test_capacityMerge_");

  const existing = {
    "id-alice": { name: "Alice", weeks: { "2026.W28": 40, "2026.W29": 40 } },
    "id-bob":   { name: "Bob",   weeks: { "2026.W28": 40, "2026.W29": 32 } },
    "id-carol": { name: "Carol", weeks: { "2026.W28": 40, "2026.W29": 40 } }, // left the team
  };
  const fetched = {
    "id-alice": { name: "Alicia Renamed", weeks: { "2026.W30": 40, "2026.W31": 40 } },
    "id-bob":   { name: "id-bob",         weeks: { "2026.W30": 24, "2026.W31": 0 } }, // Jira name lookup failed
    "id-dave":  { name: "Dave",           weeks: { "2026.W30": 40, "2026.W31": 40 } }, // new hire
  };

  const g = mergeCapacityGrid_(existing, fetched, ["2026.W30", "2026.W31"]);

  assertEq_(g.isoWeeks, ["2026.W28", "2026.W29", "2026.W30", "2026.W31"], "column union, ISO-sorted");

  const byId = {};
  g.rows.forEach((r) => { byId[r.accountId] = r; });

  assertEq_(byId["id-alice"].name, "Alicia Renamed", "fetched display name wins");
  assertEq_(
    byId["id-alice"].weeks,
    { "2026.W28": 40, "2026.W29": 40, "2026.W30": 40, "2026.W31": 40 },
    "frozen weeks kept + window weeks overwritten",
  );
  assertEq_(byId["id-bob"].name, "Bob", "stored name kept when lookup fell back to accountId");
  assertEq_(byId["id-bob"].weeks["2026.W31"], 0, "explicit scheduled-zero preserved in window");
  assertEq_(byId["id-bob"].weeks["2026.W29"], 32, "frozen week value untouched");
  assertEq_(byId["id-carol"].weeks, { "2026.W28": 40, "2026.W29": 40 }, "leaver: history kept, window cells blank");
  assertEq_(byId["id-dave"].weeks, { "2026.W30": 40, "2026.W31": 40 }, "new hire appended with blank past");
  assertEq_(g.rows.map((r) => r.name), ["Alicia Renamed", "Bob", "Carol", "Dave"], "rows sorted by display name");

  // FREEZE RULE hard check: a fetched value for a NON-window week is ignored.
  const g2 = mergeCapacityGrid_(
    { "id-x": { name: "X", weeks: { "2026.W29": 40 } } },
    { "id-x": { name: "X", weeks: { "2026.W29": 8, "2026.W30": 40 } } },
    ["2026.W30"],
  );
  assertEq_(g2.rows[0].weeks, { "2026.W29": 40, "2026.W30": 40 }, "fetched value outside window ignored (freeze)");

  // Empty sheet (first run / backfill): fetched becomes the whole grid.
  const g3 = mergeCapacityGrid_({}, { "id-a": { name: "A", weeks: { "2026.W22": 40 } } }, ["2026.W22"]);
  assertEq_(g3.isoWeeks, ["2026.W22"], "empty-sheet grid takes fetched columns");
  assertEq_(g3.rows.length, 1, "empty-sheet grid takes fetched rows");

  // OUTPUT FLOOR: stored columns before MIN_ISO_WEEK are trimmed on merge.
  // Fixtures are built RELATIVE to the rolling floor — hardcoding weeks here
  // silently stopped testing the trim once the floor became rolling (the old
  // "2026.W14/W21" rows sit long after a 52-week floor, so nothing was
  // dropped and the assertion only passed by coincidence of the fixed date).
  const floorIso = CONFIGCap.MIN_ISO_WEEK;
  const isoAtOffset_ = (weeksFromFloor) => {
    const d = mondayOfIsoWeek_(floorIso);
    d.setDate(d.getDate() + weeksFromFloor * 7);
    return isoWeekLabel_(d);
  };
  const belowFloor2 = isoAtOffset_(-2); // two weeks before the floor — must be dropped
  const belowFloor1 = isoAtOffset_(-1); // one week before the floor  — must be dropped
  const atFloor = floorIso;             // exactly the floor           — must be KEPT
  const inWindow = isoAtOffset_(3);     // well inside history         — must be KEPT
  const stored = {};
  stored[belowFloor2] = 40;
  stored[belowFloor1] = 40;
  stored[atFloor] = 40;
  const fetchedWk = {};
  fetchedWk[inWindow] = 40;
  const g4 = mergeCapacityGrid_(
    { "id-y": { name: "Y", weeks: stored } },
    { "id-y": { name: "Y", weeks: fetchedWk } },
    [inWindow],
  );
  assertEq_(g4.isoWeeks, [atFloor, inWindow], "pre-floor stored weeks dropped, floor week kept");
  assertEq_(g4.rows[0].weeks[belowFloor1], undefined, "trimmed week carries no value");
  const kept = {};
  kept[atFloor] = 40;
  kept[inWindow] = 40;
  assertEq_(g4.rows[0].weeks, kept, "pre-floor cell values discarded");
}

/**
 * The Team column, and the layout guard that keeps it from eating history.
 *
 * The guard is the point. readCapacitySheet_ feeds the FREEZE half of
 * freeze-and-merge, so a misread stored sheet is not a display bug — it is
 * unrecoverable data loss (Tempo only serves the live window, so trimmed
 * history cannot be re-fetched).
 */
function _test_capacityTeamColumn_() {
  Logger.log("🧪 _test_capacityTeamColumn_");

  // Layout detection — the pre-Team sheet must still be read as 2 fixed cols.
  assertEq_(capFixedCols_(["Account ID", "User", "Team", "Jul 20 - Jul 26 2026"]), 3,
            "new layout detected as 3 fixed columns");
  assertEq_(capFixedCols_(["Account ID", "User", "Jul 20 - Jul 26 2026"]), 2,
            "PRE-TEAM layout detected as 2 — misreading this trims stored history");
  assertEq_(capFixedCols_(["Account ID", "User"]), 2, "degenerate short header → 2, never a throw");

  // Live membership lands in the row.
  const teamInfo = { "id-ana": { teams: ["Squad One", "Squad Two"] } };
  const g1 = mergeCapacityGrid_(
    {}, { "id-ana": { name: "Ana", weeks: { "2026.W30": 40 } } }, ["2026.W30"], teamInfo);
  assertEq_(g1.rows[0].teams, "Squad One | Squad Two", "live Tempo teams pipe-joined onto the row");

  // Stored label survives when Tempo stops returning the person. Losing it
  // would drop them into the dashboard's "(No team)" — the exact bug the
  // column exists to close.
  const g2 = mergeCapacityGrid_(
    { "id-ana": { name: "Ana", teams: "Squad One", weeks: { "2026.W30": 40 } } },
    {}, ["2026.W31"], {});
  assertEq_(g2.rows[0].teams, "Squad One", "stored team kept when live membership is absent");

  // Live wins over stored when both exist — membership is a CURRENT fact.
  const g3 = mergeCapacityGrid_(
    { "id-ana": { name: "Ana", teams: "Old Squad", weeks: {} } },
    { "id-ana": { name: "Ana", weeks: { "2026.W30": 40 } } },
    ["2026.W30"], teamInfo);
  assertEq_(g3.rows[0].teams, "Squad One | Squad Two", "live membership supersedes the stored label");

  // No team anywhere is an empty cell, never the string "undefined".
  const g4 = mergeCapacityGrid_(
    {}, { "id-bob": { name: "Bob", weeks: { "2026.W30": 8 } } }, ["2026.W30"], {});
  assertEq_(g4.rows[0].teams, "", "no membership → empty cell, not \"undefined\"");
}

/** GAS-editor & Node entry point — grows as tasks add suites. */
function runCapacityTests() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('runCapacityTests');
  else Logger.log('⚠️ [runCapacityTests] requireMaintainer_ not in this project — running ungated.');
  _test_capacityWindow_();
  _test_scheduleBucketing_();
  _test_capacityMerge_();
  _test_capacityTeamColumn_();
  Logger.log("✅ All capacity tests passed");
}
