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

/** GAS-editor & Node entry point — grows as tasks add suites. */
function runCapacityTests() {
  _test_capacityWindow_();
  _test_scheduleBucketing_();
  Logger.log("✅ All capacity tests passed");
}
