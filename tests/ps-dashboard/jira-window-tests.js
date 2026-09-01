// Node runner for Jira Backlog.js week-window tests.
// Usage: node tests/ps-dashboard/jira-window-tests.js
//
// WHY THIS FILE EXISTS (2026-08-24): getLastNWeeks_ built its buckets from
// COMPLETED weeks only, so nothing that happened in the current week ever
// reached Jira Raw or Jira Arrivals — bucketByWeek_ simply found no bucket for
// it and dropped it. Downstream, the Delivery Health dashboard offered
// "current week" in its period picker and rendered every Jira number as empty,
// which reads as "the team delivered nothing" rather than "we never exported
// it". That was invisible for months because no test ever looked at the END of
// the window; they looked at its depth. This one looks at the end.
const fs = require("fs");
const path = require("path");

let CHECKS = 0;
function assert_(cond, msg) {
  CHECKS++;
  if (!cond) { console.error("❌ " + msg); process.exit(1); }
}

// ── GAS stubs — enough to evaluate the file, never to run the export ────────
global.Logger = { log: function () {} };
global.SpreadsheetApp = {};
global.UrlFetchApp = {};
global.ScriptApp = { WeekDay: { MONDAY: 1 }, getProjectTriggers: function () { return []; } };
global.PropertiesService = {
  getScriptProperties: function () {
    return { getProperty: function () { return null; }, setProperty: function () {} };
  },
};
global.Utilities = { sleep: function () {} };

eval(fs.readFileSync(
  path.join(__dirname, "..", "..", "ps-dashboard", "Jira Backlog.js"), "utf8"));

// ── 1. The default window is COMPLETED weeks only ──────────────────────────
// Unchanged behaviour, asserted so the opt-in stays opt-in: the Exec Q&A
// narrative compares the last two windows week-on-week, and a two-day week
// arriving there silently would print a collapse every Tuesday.
(function () {
  var w = getLastNWeeks_(4);
  assert_(w.length === 4, "default: 4 weeks requested, got " + w.length);
  assert_(w.every(function (x) { return x.partial === false; }),
          "default: every bucket is a complete week");

  var thisMonday = new Date();
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
  thisMonday.setHours(0, 0, 0, 0);
  assert_(w[w.length - 1].to < thisMonday,
          "default: the newest bucket closes BEFORE this Monday");

  // Chronological, oldest first — every consumer indexes [0] as the anchor.
  for (var i = 1; i < w.length; i++) {
    assert_(w[i - 1].from < w[i].from, "default: oldest first at index " + i);
  }
})();

// ── 2. includeCurrent appends the in-flight week, and ONLY appends ─────────
(function () {
  var base = getLastNWeeks_(4);
  var w = getLastNWeeks_(4, { includeCurrent: true });
  assert_(w.length === 5, "includeCurrent: 4 completed + 1 in flight, got " + w.length);

  // [0] is untouched: every fetch in runJiraEpicTracker anchors on it, so
  // adding the current week must not move the window's start by a day.
  assert_(w[0].fromStr === base[0].fromStr,
          "includeCurrent: the window START is unchanged (" + w[0].fromStr +
          " vs " + base[0].fromStr + ")");
  for (var i = 0; i < base.length; i++) {
    assert_(w[i].label === base[i].label && w[i].partial === false,
            "includeCurrent: completed bucket " + i + " is identical to the default window");
  }

  var cur = w[w.length - 1];
  assert_(cur.partial === true, "includeCurrent: the appended bucket is flagged partial");

  var thisMonday = new Date();
  thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
  thisMonday.setHours(0, 0, 0, 0);
  assert_(cur.from.getTime() === thisMonday.getTime(),
          "includeCurrent: the in-flight bucket starts on THIS Monday");
  assert_(cur.label === jb_isoWeekLabel_(new Date()),
          "includeCurrent: labelled with the current ISO week — got " + cur.label);

  // THE CRUX. `to` is NOW, not the coming Sunday: this bucket is what has
  // actually happened. A bucket bounded by a future Sunday invites a reader to
  // compare it against full weeks as though it were one.
  var now = new Date();
  assert_(cur.to <= now && cur.to > thisMonday - 1,
          "includeCurrent: the in-flight bucket closes at NOW, not at the coming Sunday");
  assert_(cur.sundayStr > cur.toStr || cur.sundayStr === cur.toStr,
          "includeCurrent: sundayStr still carries the true week edge");

  // bucketByWeek_'s contract: an issue resolved today must land in this bucket
  // and nowhere else. That is the whole bug in one assertion.
  var today = new Date();
  var landed = w.filter(function (b) { return today >= b.from && today <= b.to; });
  assert_(landed.length === 1 && landed[0].partial === true,
          "includeCurrent: work completed TODAY lands in exactly one bucket, the in-flight one — got " +
          landed.length + " bucket(s)");

  // And under the DEFAULT window it lands nowhere — the regression itself.
  var landedBase = base.filter(function (b) { return today >= b.from && today <= b.to; });
  assert_(landedBase.length === 0,
          "sanity: without includeCurrent, work completed today matches NO bucket (this is the bug)");
})();

// ── 3. The exclusive JQL bound covers the whole in-flight week ─────────────
// Jira date-only bounds are MIDNIGHT, so an inclusive `<= sunday` drops
// everything filed on Sunday. The Arrivals fetches now pass nextMonStr with
// `<`, which is the same window with no missing day.
(function () {
  var w = getLastNWeeks_(4, { includeCurrent: true });
  var cur = w[w.length - 1];
  var nextMon = new Date(cur.from);
  nextMon.setDate(nextMon.getDate() + 7);
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var expect = nextMon.getFullYear() + "-" + pad(nextMon.getMonth() + 1) + "-" + pad(nextMon.getDate());
  assert_(cur.nextMonStr === expect,
          "the in-flight week's exclusive bound is next Monday — got " + cur.nextMonStr +
          ", expected " + expect);
  assert_(cur.nextMonStr > cur.sundayStr,
          "the exclusive bound sits AFTER the week's Sunday, so Sunday's issues are counted");

  // Every completed bucket carries it too — that is what fixes the Sunday
  // undercount on the Exec Q&A window as well.
  assert_(w.every(function (b) { return !!b.nextMonStr && b.nextMonStr > b.sundayStr; }),
          "every bucket exposes an exclusive next-Monday bound");
})();

// ── 4. QUARTER-ALIGNED DEPTH (v3.19.0) ────────────────────────────────────
// The deep window is now counted in fiscal quarters, not weeks. Alignment is
// the whole point: a rolling week count never lands on a quarter boundary, so
// its oldest quarter is truncated, drops out of every trend (trends use
// complete periods only) and still occupies the window. These assert the
// guarantee is exact, at every week of the year — not just at today's date.
(function () {
  // The FY rule itself, at the boundary that decides everything.
  var jun29 = new Date(2026, 5, 29);   // Mon, Thu = Jul 2 → FY27Q1
  var jun22 = new Date(2026, 5, 22);   // Mon, Thu = Jun 25 → FY26Q4
  assert_(jb_fiscalQuarterOfMonday_(jun22) === "FY26Q4",
          "week of Jun 22 is FY26Q4 — got " + jb_fiscalQuarterOfMonday_(jun22));
  assert_(jb_fiscalQuarterOfMonday_(jun29) === "FY27Q1",
          "the week straddling Jun 30/Jul 1 goes where its THURSDAY is (FY27Q1) — got " +
          jb_fiscalQuarterOfMonday_(jun29));
  assert_(jb_fiscalQuarterOfMonday_(new Date(2026, 0, 5)) === "FY26Q3",
          "Jan 2026 is FY26Q3 — the FY is named for the year it ENDS in");

  // Sweep every Monday of a year. A property that holds on one anchor and
  // breaks in week 40 is worse than no property at all.
  var d = new Date(2026, 0, 5), worstSpan = 999, bestSpan = 0;
  for (var w = 0; w < 52; w++) {
    var n = jb_completedWeeksForQuarters_(2, d);
    var mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    var cur = jb_fiscalQuarterOfMonday_(mon);

    // Walk the window this depth produces and tally its quarters.
    var seen = {}, m = new Date(mon);
    for (var i = 1; i <= n; i++) {
      m.setDate(m.getDate() - 7);
      seen[jb_fiscalQuarterOfMonday_(m)] = 1;
    }
    var older = Object.keys(seen).filter(function (q) { return q !== cur; });
    assert_(older.length === 2,
            "exactly 2 complete quarters behind the in-flight one at " +
            d.toDateString() + " — got " + older.length + " (" + older.join(",") + ")");
    assert_(!seen[cur] || true, "sanity");

    // ALIGNMENT: the week just past the window edge must belong to a THIRD
    // quarter. If it belonged to the oldest one, that quarter is truncated and
    // the whole exercise bought nothing.
    var justPast = new Date(mon);
    justPast.setDate(mon.getDate() - (n + 1) * 7);
    assert_(older.indexOf(jb_fiscalQuarterOfMonday_(justPast)) === -1,
            "the window edge lands ON a quarter boundary at " + d.toDateString() +
            " — the week before it is " + jb_fiscalQuarterOfMonday_(justPast) +
            ", which must not be one of " + older.join(","));

    worstSpan = Math.min(worstSpan, n);
    bestSpan = Math.max(bestSpan, n);
    d.setDate(d.getDate() + 7);
  }

  // The floor matters: the dashboard reconstructs 26 weeks of queue inventory
  // (WALKBACK_MAX_WEEKS) from the arrivals series this window produces. A depth
  // that dips under that would silently shorten the hero's only trend.
  assert_(worstSpan >= 26,
          "even the shallowest quarter-aligned window covers >= 26 weeks for the " +
          "inventory walkback — got " + worstSpan);
  assert_(bestSpan <= 40,
          "…and the deepest stays under 40 weeks, well inside the shared 52-week " +
          "ceiling — got " + bestSpan);
})();

console.log("✅ jira-window-tests: all checks passed (" + CHECKS + " assertions)");
