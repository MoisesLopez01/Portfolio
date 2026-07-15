// ============================================================
// TempoCapacityTime.js
// Exports Tempo capacity (work-schedule required hours) for all
// Rocketeers into the "Capacity Tempo" sheet: one row per person,
// one column per ISO week. Past weeks are FROZEN; each Friday run
// refreshes only the next CONFIGCap.FUTURE_WEEKS future weeks.
// Downstream: utilization = Tracked ÷ Capacity, joined on (User, Week).
// Spec: docs/superpowers/specs/2026-07-15-tempo-capacity-export-design.md
//
// SHARED GLOBALS (from TempoPlanExport.js — do not redeclare):
//   MERGE_MAP, EXCLUDE_IDS, CONFIGPlan (API_BATCH_SIZE only),
//   getCredentials_(), fetchAllTeamMembers_(), fetchUserNames_(),
//   buildWeekRanges_(), isoWeekLabel_(), formatWeekLabel_(),
//   parseDateLocal_(), fmtDate_(), minDate_(), round2_()
// ============================================================

const CONFIGCap = {
  SCRIPT_LABEL: "Tempo Capacity Reports",
  SHEET_NAME: "Capacity Tempo",   // output tab — dashboard joins on (User, Week)
  FUTURE_WEEKS: 4,                // full future ISO weeks refreshed each run
  BACKFILL_FROM: "2026-03-30",    // first-run backfill start — must stay a Monday
  TRIGGER_HOUR: 8,                // Friday trigger hour (24h clock)
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

    const workerIds = fetchAllTeamMembers_(tempoToken);
    if (workerIds.length === 0) throw new Error("❌ No workers found in any Tempo Team.");
    const userMap = fetchUserNames_(workerIds, jiraEmail, jiraToken);

    const endpoint = resolveCapacityEndpoint_(tempoToken, workerIds[0], fromStr, toStr);
    const fetched = fetchSchedulesForWindow_(tempoToken, endpoint, workerIds, userMap, fromStr, toStr);

    const windowIsoWeeks = buildWeekRanges_(win.from, win.to).map((w) => w.isoLabel);
    const grid = mergeCapacityGrid_(existing.rows, fetched, windowIsoWeeks);
    writeCapacitySheet_(grid);

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
 * ONE-OFF: logs both endpoint candidates' raw responses for the first
 * worker over the next 7 days. Run from the GAS editor to verify which
 * capacity source this workspace exposes before the first real run.
 */
function _probeCapacityEndpoint_() {
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
 *   - First run:     empty sheet → historical backfill from CONFIGCap.BACKFILL_FROM.
 *   - to is always the Sunday closing the FUTURE_WEEKSth future week.
 *
 * Pure function (Node-tested): no Sheets/UrlFetch access.
 *
 * @param {string[]} existingIsoWeeks - ISO labels already stored in the sheet
 * @param {Date}     today            - run date (injected for testability)
 * @returns {{ from: Date, to: Date, backfill: boolean }}
 */
function computeCapacityWindow_(existingIsoWeeks, today) {
  const nextMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  nextMonday.setDate(nextMonday.getDate() + (((8 - today.getDay()) % 7) || 7));

  let from;
  let backfill = false;
  if (!existingIsoWeeks || existingIsoWeeks.length === 0) {
    from = parseDateLocal_(CONFIGCap.BACKFILL_FROM);
    backfill = true;
  } else {
    const lastIso = existingIsoWeeks.slice().sort().pop(); // "YYYY.WNN" sorts lexically
    const afterLast = mondayOfIsoWeek_(lastIso);
    afterLast.setDate(afterLast.getDate() + 7);
    from = minDate_(nextMonday, afterLast);
  }

  const to = new Date(nextMonday.getTime());
  to.setDate(to.getDate() + CONFIGCap.FUTURE_WEEKS * 7 - 1);

  return { from, to, backfill };
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
 * @param {Object} existingRows   - accountId → { name, weeks: {iso → hrs} }
 * @param {Object} fetched        - accountId → { name, weeks: {iso → hrs} }
 * @param {string[]} windowIsoWeeks - ISO labels covered by this fetch
 * @returns {{ isoWeeks: string[], rows: Array<{accountId, name, weeks}> }}
 */
function mergeCapacityGrid_(existingRows, fetched, windowIsoWeeks) {
  const windowSet = new Set(windowIsoWeeks);

  const isoSet = new Set(windowIsoWeeks);
  Object.keys(existingRows).forEach((id) => {
    Object.keys(existingRows[id].weeks).forEach((iso) => isoSet.add(iso));
  });
  const isoWeeks = Array.from(isoSet).sort(); // "YYYY.WNN" sorts chronologically

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

    rows.push({ accountId: id, name: name, weeks: weeks });
  });

  rows.sort((a, b) => a.name.localeCompare(b.name));
  return { isoWeeks: isoWeeks, rows: rows };
}

// ── SECTION: TEMPO ENDPOINT ──────────────────────────────────

/**
 * Endpoint candidates, tried in order by resolveCapacityEndpoint_().
 * user-schedule is the documented Tempo v4 source of requiredSeconds/day;
 * the capacity path is a legacy fallback observed in some workspaces.
 * limit=1000 comfortably covers the ~140-day backfill window; a
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
 * Probes the candidates with one real worker and returns the first that
 * answers 200. Throws (sheet untouched) if none work.
 * @param {string} tempoToken
 * @param {string} probeUserId
 * @param {string} fromStr - "YYYY-MM-DD"
 * @param {string} toStr   - "YYYY-MM-DD"
 * @returns {{ key: string, url: Function }}
 */
function resolveCapacityEndpoint_(tempoToken, probeUserId, fromStr, toStr) {
  for (let i = 0; i < CAPACITY_ENDPOINTS_.length; i++) {
    const ep = CAPACITY_ENDPOINTS_[i];
    const res = UrlFetchApp.fetch(ep.url(probeUserId, fromStr, toStr), {
      method: "get",
      headers: { Authorization: `Bearer ${tempoToken}` },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code === 200) {
      Logger.log(`✅ [resolveCapacityEndpoint_] Using "${ep.key}" endpoint.`);
      return ep;
    }
    Logger.log(`⚠️ [resolveCapacityEndpoint_] "${ep.key}" → HTTP ${code}; trying next candidate.`);
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

  // Week columns: C … last-1 (final column is "Total (hrs)").
  const isoWeeks = [];
  const colByIso = {};
  for (let c = 2; c < hdrRow.length - 1; c++) {
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
    rows[accountId] = { name: String(values[r][1] || "").trim(), weeks: weeks };
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
 * Per-user non-200 → that user is absent from the result (window cells
 * stay blank, never zeroed). All users failing → throw, sheet untouched.
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

  const requests = effectiveIds.map((id) => ({
    url: endpoint.url(id, fromStr, toStr),
    method: "get",
    headers: { Authorization: `Bearer ${tempoToken}` },
    muteHttpExceptions: true,
  }));

  Logger.log(
    `ℹ️ [fetchSchedulesForWindow_] ${requests.length} schedule requests (${fromStr} → ${toStr}) via "${endpoint.key}"`,
  );

  const fetched = {};
  let okCount = 0;
  let errCount = 0;

  for (let b = 0; b < requests.length; b += CONFIGPlan.API_BATCH_SIZE) {
    const responses = UrlFetchApp.fetchAll(
      requests.slice(b, b + CONFIGPlan.API_BATCH_SIZE),
    );
    responses.forEach((res, i) => {
      const id = effectiveIds[b + i];
      if (res.getResponseCode() !== 200) {
        errCount++;
        Logger.log(
          `   ⚠️ Schedule HTTP ${res.getResponseCode()} for ${id}: ${res.getContentText().substring(0, 120)}`,
        );
        return; // absent from `fetched` → window cells stay blank
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
      okCount++;
    });
  }

  Logger.log(`ℹ️ [fetchSchedulesForWindow_] ok=${okCount} failed=${errCount} of ${effectiveIds.length}`);
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
  const totalCols = 2 + isoWeeks.length + 1;

  const isoRow = ["", ""];
  const hdrRow = ["Account ID", "User"];
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
    const cells = isoWeeks.map((iso) => {
      const v = row.weeks[iso];
      if (typeof v !== "number") return ""; // blank = unknown, never coerced to 0
      total += v;
      return round2_(v);
    });
    return [row.accountId, row.name].concat(cells, [round2_(total)]);
  });

  const footer = new Array(totalCols).fill("");
  footer[1] = "TOTAL";
  for (let c = 2; c < totalCols; c++) {
    let sum = 0;
    dataRows.forEach((r) => {
      if (typeof r[c] === "number") sum += r[c];
    });
    footer[c] = round2_(sum);
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
  sheet.setFrozenColumns(2);
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

  // Empty sheet → backfill from BACKFILL_FROM; to = Sunday of W33 (next Mon + 4 wks − 1 day).
  const w1 = computeCapacityWindow_([], friday);
  assertEq_(fmtDate_(w1.from), CONFIGCap.BACKFILL_FROM, "empty sheet backfills from BACKFILL_FROM");
  assertEq_(w1.backfill, true, "backfill flag set");
  assertEq_(fmtDate_(w1.to), "2026-08-16", "to = Sunday of 4th future week (W33)");

  // Normal run: stored through W33 → from = next Monday (W30). Current week W29 stays frozen.
  const w2 = computeCapacityWindow_(["2026.W28", "2026.W29", "2026.W33"], friday);
  assertEq_(fmtDate_(w2.from), "2026-07-20", "normal from = next Monday");
  assertEq_(w2.backfill, false, "no backfill flag on normal run");

  // Gap self-heal: run on Friday of W31 but stored only through W29 →
  // from reaches back to Monday of W30 (unstored weeks are not frozen).
  const w3 = computeCapacityWindow_(["2026.W28", "2026.W29"], new Date("2026-07-31T09:00:00"));
  assertEq_(fmtDate_(w3.from), "2026-07-20", "gap heal: from = Monday after last stored week");
  assertEq_(fmtDate_(w3.to), "2026-08-30", "gap heal: to still = 4th future Sunday");

  // Monday run: "next Monday" is STRICTLY after today; gap rule may pull from back to today.
  const w4 = computeCapacityWindow_(["2026.W28"], new Date("2026-07-13T09:00:00"));
  assertEq_(fmtDate_(w4.from), "2026-07-13", "Monday run heals current unstored week");
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
  const g3 = mergeCapacityGrid_({}, { "id-a": { name: "A", weeks: { "2026.W14": 40 } } }, ["2026.W14"]);
  assertEq_(g3.isoWeeks, ["2026.W14"], "empty-sheet grid takes fetched columns");
  assertEq_(g3.rows.length, 1, "empty-sheet grid takes fetched rows");
}

/** GAS-editor & Node entry point — grows as tasks add suites. */
function runCapacityTests() {
  _test_capacityWindow_();
  _test_scheduleBucketing_();
  _test_capacityMerge_();
  Logger.log("✅ All capacity tests passed");
}
