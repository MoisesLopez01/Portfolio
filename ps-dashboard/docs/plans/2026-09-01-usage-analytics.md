# Usage Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every dashboard page load to a `PS Access Log` sheet and give super admins a 📶 Usage Analytics menu tab showing weekly engagement and the not-engaged eligible audience.

**Architecture:** One new GAS server file `PS Usage.js` (capture + rollup, with the math in a pure Node-testable function), one `doGet` call-site change, one `VIEWS` entry + pane + renderer in `PS Dashboard.html`, transparency copy, and a new extract-based Node test suite.

**Tech Stack:** Google Apps Script (flat .js files, no modules), vanilla JS + hand-rolled SVG in one HTML file, Node for tests (`node tests/<file>.js`, zero deps).

**Spec:** `docs/specs/2026-09-01-usage-analytics-design.md` — read it first.

**Context an engineer needs (read before Task 1):**
- GAS has no imports: every top-level function in any `.js` file shares one global namespace. `PS Usage.js` may freely call `isoWeekNum_PS_` (defined in `PS Contribution Report.js`) and `_readAccessLists_` (defined in `PS Security.js`).
- Any top-level function WITHOUT a trailing underscore is web-callable by anyone who can load the app. `tests/callable-surface-checks.js` sweeps all `.js` files and fails if such a function's body doesn't mention `checkDashboardAccess`.
- Tests run in Node by regex-extracting function bodies from the GAS sources and `eval`-ing them with stubbed globals — see `tests/access-tier-checks.js:30-107` for the pattern this plan copies.
- There is no build step. "Run the tests" means `node tests/usage-analytics-checks.js` from `D:\Development\ps-dashboard`. Deployment to GAS (clasp push / editor paste) is the owner's manual step and is NOT part of this plan.
- Week labels are always `YYYY.WN` (e.g. `2026.W36`), never `W36` alone.

**File map:**

| File | Responsibility |
|---|---|
| Create `PS Usage.js` | week-window helpers, `logDashboardVisit_`, `usageEligibleSet_`, `computeUsageRollup_` (pure), `getUsageAnalytics()` endpoint |
| Create `tests/usage-analytics-checks.js` | Node suite for all of the above |
| Modify `PS Contribution Report.js` (doGet, ~line 1388) | one `logDashboardVisit_(access)` call |
| Modify `PS Security.js` (`SEC_.BUILD`) | bump to `"2026.W36-usage"` |
| Modify `PS Dashboard.html` | VIEWS entry, `tabUsage` pane, `STATE.usageData`, RENDERERS entry, `renderUsageTab_` + paint/filter/SVG helpers, transparency copy |
| Modify `D:\Development\CLAUDE.md`, `.claude/skills/ps-dashboard-navigation/SKILL.md` | document the new surface |

---

### Task 1: Week-window helpers in `PS Usage.js` + test harness

**Files:**
- Create: `PS Usage.js`
- Create: `tests/usage-analytics-checks.js`

- [ ] **Step 1: Create the test file with harness and failing week-window tests**

Create `tests/usage-analytics-checks.js`:

```js
// Node checks for the usage-analytics feature (2026-09-01).
//
// Covers the rules that are easy to break silently:
//   1. Week windows cross ISO year boundaries correctly (52- vs 53-week years).
//   2. Denied rows count as demand, never as engagement.
//   3. The eligible audience honours the same auto-access policy the gate does.
//   4. logDashboardVisit_ can never break a page load; getUsageAnalytics is
//      superadmin-gated before it reads anything.
//
// Run: node "ps-dashboard/tests/usage-analytics-checks.js"
const fs   = require('fs');
const path = require('path');

const dir      = path.join(__dirname, '..');
const usage    = fs.readFileSync(path.join(dir, 'PS Usage.js'), 'utf8');
const security = fs.readFileSync(path.join(dir, 'PS Security.js'), 'utf8');
const report   = fs.readFileSync(path.join(dir, 'PS Contribution Report.js'), 'utf8');

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; } else { fail++; console.error('  ❌ ' + name + (extra ? '\n     ' + extra : '')); }
}
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) console.error('  ❌ ' + name + '\n     got:  ' + JSON.stringify(got) +
                         '\n     want: ' + JSON.stringify(want));
  ok ? pass++ : fail++;
}
function extract(src, startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i < 0) { console.error('❌ could not find: ' + startsWith); process.exit(1); }
  const j = src.indexOf(endsWith, i);
  if (j < 0) { console.error('❌ could not close: ' + startsWith); process.exit(1); }
  return src.slice(i, j + endsWith.length);
}

// ── Harness ──────────────────────────────────────────────────────────────────
const Logger = { log: () => {} };
const props  = {};
const PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = v; },
  }),
};
let ROSTER_ROWS = [];
function _readRosterForAccess_() { return { ok: true, rows: ROSTER_ROWS, tab: 'Data', error: null }; }

const secSlice = [
  extract(security, 'const SEC_ = {', '\n};'),
  extract(security, 'function _normName_', '\n}'),
  extract(security, 'function _autoAccessAllows_', '\n}'),
  extract(security, 'function _readAccessLists_', '\n}'),
].join('\n');
const repSlice = [
  extract(report, 'function isoWeekNum_PS_', '\n}'),
  extract(report, 'function isoWeekYear_PS_', '\n}'),
].join('\n');
const usageSlice = [
  extract(usage, 'const USAGE_LOG_SHEET_', ';'),
  extract(usage, 'const USAGE_LOG_HEADERS_', ';'),
  extract(usage, 'const USAGE_WEEKS_', ';'),
  extract(usage, 'function usageWeekLabel_', '\n}'),
  extract(usage, 'function usageWeeksInYear_', '\n}'),
  extract(usage, 'function usageWeekWindow_', '\n}'),
].join('\n');

// eslint-disable-next-line no-eval
const api = eval('(function(){' + secSlice + '\n' + repSlice + '\n' + usageSlice +
  '\nreturn { SEC_, usageWeekLabel_, usageWeeksInYear_, usageWeekWindow_,' +
  ' _readAccessLists_, _autoAccessAllows_, USAGE_WEEKS_ };})()');

function reset() {
  Object.keys(props).forEach(k => delete props[k]);
  ROSTER_ROWS = [];
}

// ── 1. Week labels and windows ───────────────────────────────────────────────
const LABEL_RE = /^\d{4}\.W\d{1,2}$/;
ck('usageWeekLabel_ format', LABEL_RE.test(api.usageWeekLabel_(new Date(Date.UTC(2026, 8, 1)))));
eq('2026-09-01 is 2026.W36', api.usageWeekLabel_(new Date(Date.UTC(2026, 8, 1))), '2026.W36');
eq('window is USAGE_WEEKS_ long, oldest first, ending at currentWeek',
   [api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_).length,
    api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_)[0],
    api.usageWeekWindow_('2026.W36', api.USAGE_WEEKS_)[api.USAGE_WEEKS_ - 1]],
   [13, '2026.W24', '2026.W36']);
// ISO year boundary: 2025 has 52 ISO weeks (Jan 1 2025 = Wednesday).
eq('window crosses the year boundary at W52',
   api.usageWeekWindow_('2026.W2', 4), ['2025.W51', '2025.W52', '2026.W1', '2026.W2']);
eq('weeksInYear 2025', api.usageWeeksInYear_(2025), 52);
eq('weeksInYear 2026 (long ISO year)', api.usageWeeksInYear_(2026), 53);
ck('every window label is well-formed',
   api.usageWeekWindow_('2026.W36', 13).every(w => LABEL_RE.test(w)));
eq('garbage currentWeek yields an empty window', api.usageWeekWindow_('nonsense', 13), []);

// (Sections 2–5 are appended by later tasks.)

console.log(fail === 0
  ? '✅ usage-analytics-checks: ' + pass + ' checks passed'
  : '❌ usage-analytics-checks: ' + fail + ' of ' + (pass + fail) + ' checks FAILED');
process.exit(fail === 0 ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails (PS Usage.js does not exist)**

Run: `node tests/usage-analytics-checks.js`
Expected: `Error: ENOENT ... PS Usage.js`

- [ ] **Step 3: Create `PS Usage.js` with constants and the three week helpers**

```js
// ============================================================
// PS USAGE — dashboard access trace + usage analytics.
// Spec: ps-dashboard/docs/specs/2026-09-01-usage-analytics-design.md
//
// Two halves:
//   logDashboardVisit_(access)  — one best-effort log row per doGet hit.
//   getUsageAnalytics()         — superadmin-only rollup for the 📶 tab.
//
// The log lives in the dashboard's OWN container spreadsheet ("PS Access Log"
// tab, beside "PS Settings"). The shared HRIS source spreadsheets are
// read-only by house rule and are never written.
// ============================================================

const USAGE_LOG_SHEET_   = "PS Access Log";
const USAGE_LOG_HEADERS_ = ["Timestamp", "Week", "Email", "Role", "Allowed", "Scope"];
const USAGE_WEEKS_       = 13;   // one quarter of ISO weeks, current week included

// "2026.W36" — the project's week-label convention (never "W36" alone).
// Reuses the report's ISO helpers; never a second week formatter.
function usageWeekLabel_(d) {
  return isoWeekYear_PS_(d) + ".W" + isoWeekNum_PS_(d);
}

// ISO weeks in a year (52 or 53): Dec 28 always sits in the year's last ISO week.
function usageWeeksInYear_(y) {
  return isoWeekNum_PS_(new Date(Date.UTC(y, 11, 28)));
}

// The n week labels ending at `currentWeek` ("YYYY.WN"), oldest first. Pure
// arithmetic — no Date "now" — so the rollup window is Node-testable.
function usageWeekWindow_(currentWeek, n) {
  const m = /^(\d{4})\.W(\d{1,2})$/.exec(String(currentWeek || ""));
  if (!m) return [];
  let y = +m[1], w = +m[2];
  const out = [];
  for (let i = 0; i < n; i++) {
    out.unshift(y + ".W" + w);
    w--;
    if (w < 1) { y--; w = usageWeeksInYear_(y); }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/usage-analytics-checks.js`
Expected: `✅ usage-analytics-checks: 8 checks passed`

- [ ] **Step 5: Commit**

```bash
git add "PS Usage.js" tests/usage-analytics-checks.js
git commit -m "feat(dh): usage-analytics week helpers + test harness"
```

---

### Task 2: `computeUsageRollup_` — the pure rollup

**Files:**
- Modify: `PS Usage.js` (append)
- Modify: `tests/usage-analytics-checks.js` (insert section 2 before the final `console.log`)

- [ ] **Step 1: Add failing rollup tests**

Add `'function computeUsageRollup_'` to the `usageSlice` extracts and `computeUsageRollup_` to the eval return list, then insert before the final `console.log`:

```js
// ── 2. Rollup math ───────────────────────────────────────────────────────────
// Fixture: current week 2026.W36; eligible a + b; c denied; d not eligible;
// one blank-email row; b's only visit is outside the 13-week window.
const ELIGIBLE = {
  'a@x.com': { email: 'a@x.com', name: 'A Person', role: 'manager',    source: 'auto-manager' },
  'b@x.com': { email: 'b@x.com', name: 'B Person', role: 'superadmin', source: 'list' },
};
const ROWS = [
  { ts: '2026-08-31T08:00:00Z', week: '2026.W36', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-09-01T09:00:00Z', week: '2026.W36', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-08-24T09:00:00Z', week: '2026.W35', email: 'a@x.com', role: 'manager',    allowed: true  },
  { ts: '2026-09-01T10:00:00Z', week: '2026.W36', email: 'c@x.com', role: 'denied',     allowed: false },
  { ts: '2026-09-01T11:00:00Z', week: '2026.W36', email: '',        role: 'viewer',     allowed: true  },
  { ts: '2026-09-01T12:00:00Z', week: '2026.W36', email: 'd@x.com', role: 'viewer',     allowed: true  },
  { ts: '2026-01-05T08:00:00Z', week: '2026.W2',  email: 'b@x.com', role: 'superadmin', allowed: true  },
];
const R = api.computeUsageRollup_(ROWS, ELIGIBLE, '2026.W36');
const w36 = R.weeks[R.weeks.length - 1];

eq('13 weeks, oldest first, current last',
   [R.weeks.length, R.weeks[0].week, w36.week], [13, '2026.W24', '2026.W36']);
eq('uniques: a + d, never blank or denied', w36.uniqueVisitors, 2);
eq('total loads counts everything incl. denied and blank', w36.totalLoads, 4);
eq('denied counted separately', w36.denied, 1);
eq('byRole counts allowed identified loads only', w36.byRole, { manager: 2, viewer: 1 });
const pa = R.people.find(p => p.email === 'a@x.com');
const pb = R.people.find(p => p.email === 'b@x.com');
eq('a: 2 this week, 3 in last 4 weeks', [pa.visitsThisWeek, pa.visits4Weeks], [2, 3]);
eq('a lastSeen is the newest visit', pa.lastSeen, '2026-09-01T09:00:00.000Z');
eq('b visited outside the window: ever=true, thisWeek=0',
   [pb.everVisited, pb.visitsThisWeek, pb.visits4Weeks], [true, 0, 0]);
eq('coverage: 1 of 2 engaged this week', R.coverage, { engagedThisWeek: 1, eligibleTotal: 2, pct: 50 });
eq('d lands in otherVisitors', R.otherVisitors.map(v => v.email), ['d@x.com']);
ck('a denied email never becomes a visitor',
   R.otherVisitors.every(v => v.email !== 'c@x.com') && !R.people.some(p => p.email === 'c@x.com'));

// Empty log = honest day-one picture, not an error.
const E = api.computeUsageRollup_([], ELIGIBLE, '2026.W36');
ck('empty log is ok:true', E.ok === true);
eq('empty log: all weeks zero', E.weeks.every(w => w.totalLoads === 0), true);
eq('empty log: everyone never-visited', E.people.every(p => !p.everVisited), true);
eq('empty log coverage 0%', E.coverage.pct, 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/usage-analytics-checks.js`
Expected: `❌ could not find: function computeUsageRollup_` (process exits 1)

- [ ] **Step 3: Append `computeUsageRollup_` to `PS Usage.js`**

```js
// Pure rollup — no GAS services, Node-testable (tests/usage-analytics-checks.js).
//
//   logRows     [{ ts, week, email, role, allowed }]  ts = Date or ISO string
//   eligible    usageEligibleSet_() shape: email → { email, name, role, source }
//   currentWeek "2026.W36"
//
// Rules (spec §2): denied rows count in totalLoads/denied, never as engagement;
// blank-email rows aggregate into totals but attach to nobody; an eligible
// person's engagement counts only allowed visits; lastSeen/everVisited consider
// every row given, the weekly series only the USAGE_WEEKS_-week window.
function computeUsageRollup_(logRows, eligible, currentWeek) {
  const window = usageWeekWindow_(currentWeek, USAGE_WEEKS_);
  const last4  = window.slice(-4);

  const weekAgg = {};
  window.forEach(w => { weekAgg[w] = { week: w, uniques: {}, totalLoads: 0, denied: 0, byRole: {} }; });

  const perEmail = {};
  (logRows || []).forEach(r => {
    const email = String(r.email || "").toLowerCase().trim();
    const week  = String(r.week || "");
    const agg   = weekAgg[week];
    if (agg) {
      agg.totalLoads++;
      if (!r.allowed) { agg.denied++; return; }
      if (email) {
        agg.uniques[email] = true;
        const role = String(r.role || "?");
        agg.byRole[role] = (agg.byRole[role] || 0) + 1;
      }
    }
    if (!r.allowed || !email) return;
    const p = perEmail[email] ||
      (perEmail[email] = { lastSeen: null, lastSeenWeek: null, visitsThisWeek: 0, visits4Weeks: 0 });
    const t = +new Date(r.ts);
    if (!isNaN(t) && (p.lastSeen === null || t > p.lastSeen)) { p.lastSeen = t; p.lastSeenWeek = week; }
    if (week === currentWeek) p.visitsThisWeek++;
    if (last4.indexOf(week) !== -1) p.visits4Weeks++;
  });

  const weeks = window.map(w => ({
    week:           w,
    uniqueVisitors: Object.keys(weekAgg[w].uniques).length,
    totalLoads:     weekAgg[w].totalLoads,
    denied:         weekAgg[w].denied,
    byRole:         weekAgg[w].byRole,
  }));

  const people = Object.keys(eligible || {}).sort().map(email => {
    const e = eligible[email], p = perEmail[email];
    return {
      email: email, name: e.name, role: e.role, source: e.source,
      lastSeen:       p && p.lastSeen !== null ? new Date(p.lastSeen).toISOString() : null,
      lastSeenWeek:   p ? p.lastSeenWeek : null,
      visitsThisWeek: p ? p.visitsThisWeek : 0,
      visits4Weeks:   p ? p.visits4Weeks : 0,
      everVisited:    !!p,
    };
  });

  const engagedThisWeek = people.filter(p => p.visitsThisWeek > 0).length;
  const otherVisitors = Object.keys(perEmail).filter(e => !(eligible && eligible[e])).sort().map(e => ({
    email:          e,
    visitsThisWeek: perEmail[e].visitsThisWeek,
    lastSeen:       perEmail[e].lastSeen !== null ? new Date(perEmail[e].lastSeen).toISOString() : null,
  }));

  return {
    ok: true,
    currentWeek: currentWeek,
    weeks: weeks,
    people: people,
    coverage: {
      engagedThisWeek: engagedThisWeek,
      eligibleTotal:   people.length,
      pct: people.length ? Math.round(engagedThisWeek / people.length * 100) : 0,
    },
    otherVisitors: otherVisitors,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/usage-analytics-checks.js`
Expected: `✅ usage-analytics-checks: 23 checks passed` (if the count differs slightly but the line is ✅, that's fine — the ✅/exit-0 is the gate; this applies to every expected count below)

- [ ] **Step 5: Commit**

```bash
git add "PS Usage.js" tests/usage-analytics-checks.js
git commit -m "feat(dh): computeUsageRollup_ — pure weekly engagement rollup"
```

---

### Task 3: `usageEligibleSet_` — the expected audience

**Files:**
- Modify: `PS Usage.js` (append)
- Modify: `tests/usage-analytics-checks.js` (insert section 3 before the final `console.log`)

- [ ] **Step 1: Add failing eligible-set tests**

Add `'function usageEligibleSet_'` to the `usageSlice` extracts and `usageEligibleSet_` to the eval return list, then insert:

```js
// ── 3. Eligible audience ─────────────────────────────────────────────────────
// Must mirror the real gate: list members + auto-managers the CURRENT policy
// admits — never someone the policy would turn away at the door.
function rrow(name, email, sup, extra) {
  const r = { name, normName: name.toLowerCase(), email,
              supervisor: sup, normSupervisor: (sup || '').toLowerCase(),
              cls: 'Professional Services', dept: 'Services', jobTitle: 'x',
              status: '', active: true, onLeave: false };
  return Object.assign(r, extra || {});
}
reset();
ROSTER_ROWS = [
  rrow('Gon Director', 'gon@x.com', ''),
  rrow('Mgr One',      'm1@x.com',  'Gon Director'),
  rrow('IC A',         'ica@x.com', 'Mgr One'),
  rrow('Away Boss',    'away@x.com', '', { onLeave: true, status: 'Maternity Leave' }),
  rrow('Away Report',  'ar@x.com',  'Away Boss'),
  rrow('Fin Boss',     'fin@x.com', '', { cls: 'Finance' }),
  rrow('Fin Report',   'fr@x.com',  'Fin Boss', { cls: 'Finance' }),
];
props['PS_DASH_VIEWERS']   = 'guest@x.com';
props['PS_DASH_DELEGATES'] = 'peer@x.com:Gon Director';   // format: "email:Supervisor Full Name" per line
let EL = api.usageEligibleSet_();
ck('supervisors with active reports are eligible as auto-managers',
   EL['gon@x.com'] && EL['gon@x.com'].source === 'auto-manager' && EL['gon@x.com'].role === 'manager');
ck('a mid-level manager is eligible too', !!EL['m1@x.com']);
ck('an IC with no reports is NOT eligible', !EL['ica@x.com']);
ck('on-leave supervisor withheld (ALLOW_ONLEAVE_MANAGER=false)', !EL['away@x.com']);
ck('viewer-list member is eligible with role viewer',
   EL['guest@x.com'] && EL['guest@x.com'].role === 'viewer' && EL['guest@x.com'].source === 'list');
ck('delegate is eligible with role manager',
   EL['peer@x.com'] && EL['peer@x.com'].role === 'manager' && EL['peer@x.com'].source === 'list');
ck('bootstrap super admin is always eligible',
   EL[api.SEC_.BOOTSTRAP_ADMIN.toLowerCase()] &&
   EL[api.SEC_.BOOTSTRAP_ADMIN.toLowerCase()].role === 'superadmin');
ck('any-org mode: a Finance supervisor IS eligible', !!EL['fin@x.com']);

// "classes" mode: the Finance supervisor is now outside the policy scope.
const saved = api.SEC_.MANAGER_AUTO_ACCESS;
api.SEC_.MANAGER_AUTO_ACCESS = 'classes';
EL = api.usageEligibleSet_();
ck('classes mode: Finance supervisor is NOT expected', !EL['fin@x.com']);
ck('classes mode: the PS supervisor still is', !!EL['gon@x.com']);
api.SEC_.MANAGER_AUTO_ACCESS = 'off';
EL = api.usageEligibleSet_();
ck('off mode: no auto-managers at all, lists only', !EL['gon@x.com'] && !!EL['guest@x.com']);
api.SEC_.MANAGER_AUTO_ACCESS = saved;

// A supervisor who is ALSO listed keeps the LIST role (mirrors resolution order).
props['PS_DASH_SUPER_ADMINS'] = 'gon@x.com';
EL = api.usageEligibleSet_();
eq('list tier wins over auto-manager', [EL['gon@x.com'].role, EL['gon@x.com'].source],
   ['superadmin', 'list']);
delete props['PS_DASH_SUPER_ADMINS'];
```

- [ ] **Step 2: Run to verify it fails**

Run: `node tests/usage-analytics-checks.js`
Expected: `❌ could not find: function usageEligibleSet_`

- [ ] **Step 3: Append `usageEligibleSet_` to `PS Usage.js`**

```js
// The complete potential audience — everyone on the five access lists, plus
// every active roster supervisor the CURRENT auto-access policy would actually
// admit (via the same _autoAccessAllows_ the gate uses; the audit must never
// call someone "expected" whom the door would turn away). List membership wins
// for the displayed role, mirroring checkDashboardAccess resolution order.
// @returns {Object} email → { email, name, role, source: 'list'|'auto-manager' }
function usageEligibleSet_() {
  const eligible = {};
  const lists  = _readAccessLists_();
  const roster = _readRosterForAccess_();
  const rows   = roster.ok ? roster.rows : [];

  const byEmail = {};
  rows.forEach(r => { if (r.email && r.active && !byEmail[r.email]) byEmail[r.email] = r; });

  const put = (email, role) => {
    const e = String(email || "").toLowerCase().trim();
    if (!e || eligible[e]) return;   // first (highest) tier wins
    const row = byEmail[e];
    eligible[e] = { email: e, name: row ? row.name : e, role: role, source: "list" };
  };
  lists.superAdmins.forEach(e => put(e, "superadmin"));
  lists.admins.forEach(e => put(e, "admin"));
  lists.orgAdmins.forEach(e => put(e, "orgadmin"));
  lists.viewers.forEach(e => put(e, "viewer"));
  lists.delegates.forEach(d => put(d.email, "manager"));

  if ((SEC_.MANAGER_AUTO_ACCESS || "any-org") !== "off" && roster.ok) {
    const reportCounts = {};
    rows.forEach(r => {
      if (r.active && r.normSupervisor && r.normSupervisor !== r.normName) {
        reportCounts[r.normSupervisor] = (reportCounts[r.normSupervisor] || 0) + 1;
      }
    });
    rows.forEach(r => {
      if (!r.email || !r.active || eligible[r.email]) return;
      if ((reportCounts[r.normName] || 0) < 1) return;
      if (r.onLeave && !SEC_.ALLOW_ONLEAVE_MANAGER) return;
      if (!_autoAccessAllows_(r).ok) return;
      eligible[r.email] = { email: r.email, name: r.name, role: "manager", source: "auto-manager" };
    });
  }
  return eligible;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/usage-analytics-checks.js`
Expected: `✅ usage-analytics-checks: 35 checks passed`

- [ ] **Step 5: Commit**

```bash
git add "PS Usage.js" tests/usage-analytics-checks.js
git commit -m "feat(dh): usageEligibleSet_ — the audience the engagement audit measures against"
```

---

### Task 4: `logDashboardVisit_` + `getUsageAnalytics()` + `doGet` wiring

**Files:**
- Modify: `PS Usage.js` (append)
- Modify: `PS Contribution Report.js` — `doGet`, currently at ~line 1388
- Modify: `PS Security.js` — `SEC_.BUILD`
- Modify: `tests/usage-analytics-checks.js` (insert sections 4–5 before the final `console.log`)

- [ ] **Step 1: Add failing capture/gate tests**

Insert before the final `console.log`:

```js
// ── 4. Capture never breaks a page load ─────────────────────────────────────
// logDashboardVisit_ is evaluated with GAS stubs; a throwing SpreadsheetApp and
// a busy lock must both be swallowed, and a healthy write must produce one row
// with a well-formed week label.
const logSlice = extract(usage, 'function logDashboardVisit_', '\n}');
// The eval'd body resolves SpreadsheetApp/LockService to these PARAMETERS —
// pass the stubs explicitly; block-scoped consts at the call site would NOT
// be visible inside this function's eval.
function evalLogger(SpreadsheetApp, LockService) {   // eslint-disable-line no-unused-vars
  // eslint-disable-next-line no-eval
  return eval('(function(){' + repSlice + '\n' +
    extract(usage, 'const USAGE_LOG_SHEET_', ';') + '\n' +
    extract(usage, 'const USAGE_LOG_HEADERS_', ';') + '\n' +
    'function usageWeekLabel_(d){return isoWeekYear_PS_(d)+".W"+isoWeekNum_PS_(d);}\n' +
    logSlice + '\nreturn logDashboardVisit_;})()');
}
const APPENDED = [];
const okSheet = { appendRow: r => { APPENDED.push(r); }, setFrozenRows: () => {} };
const okSS = {
  getActiveSpreadsheet: () => ({ getSheetByName: () => okSheet, insertSheet: () => okSheet }),
};
const badSS   = { getActiveSpreadsheet: () => { throw new Error('boom'); } };
const okLock   = { getScriptLock: () => ({ tryLock: () => true,  releaseLock: () => {} }) };
const busyLock = { getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }) };

{
  const fn = evalLogger(okSS, okLock);
  fn({ allowed: true, email: 'a@x.com', role: 'manager', delegateScopeName: 'Gon Director' });
  fn({ allowed: false, email: 'x@x.com', role: 'denied' });
  eq('two rows appended', APPENDED.length, 2);
  eq('allowed row: email/role/allowed/scope', APPENDED[0].slice(2),
     ['a@x.com', 'manager', true, 'Gon Director']);
  eq('denied row records the denial', APPENDED[1].slice(2), ['x@x.com', 'denied', false, '']);
  ck('week cell is well-formed', LABEL_RE.test(APPENDED[0][1]));
}
{
  let threw = false;
  try { evalLogger(badSS, okLock)({ allowed: true, email: 'a@x.com', role: 'admin' }); }
  catch (e) { threw = true; }
  ck('a throwing SpreadsheetApp is swallowed — the page load survives', !threw);
}
{
  const before = APPENDED.length;
  let threw = false;
  try { evalLogger(okSS, busyLock)({ allowed: true, email: 'a@x.com', role: 'admin' }); }
  catch (e) { threw = true; }
  ck('a busy lock skips the row without throwing', !threw && APPENDED.length === before);
}

// ── 5. Wiring and gates (source checks) ─────────────────────────────────────
ck('doGet logs the visit BEFORE the denied branch',
   /function doGet\([\s\S]{0,200}?logDashboardVisit_\(access\)[\s\S]{0,200}?if \(!access\.allowed\)/.test(report));
ck('getUsageAnalytics is gated superadmin before any read',
   /function getUsageAnalytics\(\)[\s\S]{0,300}?checkDashboardAccess\(\)[\s\S]{0,200}?isSuperAdmin_\(access\)[\s\S]*?SpreadsheetApp/.test(usage));
ck('the gate throws rather than returning quietly',
   /isSuperAdmin_\(access\)\) \{\s*\n\s*throw new Error/.test(usage));
ck('logDashboardVisit_ body is one big try/catch',
   /function logDashboardVisit_\(access\) \{\s*\n\s*try \{/.test(usage) &&
   / catch \(e\) \{\s*\n\s*Logger\.log\("⚠️ \[PS Usage\]/.test(logSlice));
ck('only doGet calls the logger — exactly one call site in the report file',
   (report.match(/logDashboardVisit_\(/g) || []).length === 1 &&
   !/logDashboardVisit_/.test(extract(report, 'function warmReportCache', '\n}')));
ck('SEC_.BUILD was bumped for this change', /BUILD:\s*"2026\.W36-usage"/.test(security));
```

- [ ] **Step 2: Run to verify the new sections fail**

Run: `node tests/usage-analytics-checks.js`
Expected: `❌ could not find: function logDashboardVisit_`

- [ ] **Step 3: Append `logDashboardVisit_` and `getUsageAnalytics` to `PS Usage.js`**

```js
// One log row per doGet hit — allowed AND denied (a denied attempt is demand;
// the rollup counts it separately, never as engagement). Best-effort BY DESIGN:
// every failure is logged and swallowed, because a lost log line is acceptable
// and a slow or broken page load is not. Only doGet calls this — the cache
// warmer and editor runs go through getPSReportData, so trigger executions
// (which run as the owner) never pollute the data.
function logDashboardVisit_(access) {
  try {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(500)) {
      Logger.log("⚠️ [PS Usage] visit log skipped — lock busy");
      return;
    }
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sh = ss.getSheetByName(USAGE_LOG_SHEET_);
      if (!sh) {
        sh = ss.insertSheet(USAGE_LOG_SHEET_);
        sh.appendRow(USAGE_LOG_HEADERS_);
        sh.setFrozenRows(1);
      }
      const now = new Date();
      sh.appendRow([
        now,
        usageWeekLabel_(now),
        (access && access.email) || "",
        (access && access.role)  || "denied",
        !!(access && access.allowed),
        (access && access.delegateScopeName) || "",
      ]);
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    Logger.log("⚠️ [PS Usage] visit log failed (page load unaffected): " + e.message);
  }
}

// ── PUBLIC ENDPOINT ──────────────────────────────────────────
// Superadmin only — this is company-wide behavioural data about colleagues.
// A missing or empty log sheet is NOT an error: the rollup then returns zero
// weeks and the full eligible set as never-visited, the honest day-one picture.
function getUsageAnalytics() {
  const access = checkDashboardAccess();
  if (!access.allowed || !isSuperAdmin_(access)) {
    throw new Error("Unauthorized: usage analytics are super-admin only.");
  }
  try {
    const rows = [];
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(USAGE_LOG_SHEET_);
    if (sh && sh.getLastRow() > 1) {
      sh.getRange(2, 1, sh.getLastRow() - 1, USAGE_LOG_HEADERS_.length).getValues().forEach(v => {
        rows.push({
          ts:      v[0],
          week:    String(v[1] || ""),
          email:   String(v[2] || ""),
          role:    String(v[3] || ""),
          allowed: v[4] === true || v[4] === "TRUE",
        });
      });
    }
    const result = computeUsageRollup_(rows, usageEligibleSet_(), usageWeekLabel_(new Date()));
    result.generatedAt = new Date().toISOString();
    return result;
  } catch (e) {
    Logger.log("❌ [getUsageAnalytics] " + e.message);
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: Wire `doGet` and bump `SEC_.BUILD`**

In `PS Contribution Report.js`, change `doGet` (currently ~line 1388) from:

```js
function doGet(e) {
  const access = checkDashboardAccess();
  if (!access.allowed) {
```

to:

```js
function doGet(e) {
  const access = checkDashboardAccess();
  logDashboardVisit_(access);   // best-effort access trace — never throws, never blocks
  if (!access.allowed) {
```

In `PS Security.js`, change the `BUILD:` line inside `SEC_` from its current value to:

```js
  BUILD: "2026.W36-usage",
```

- [ ] **Step 5: Run tests — new suite AND the callable-surface sweep**

Run: `node tests/usage-analytics-checks.js && node tests/callable-surface-checks.js`
Expected: `✅ usage-analytics-checks: 47 checks passed` then the callable sweep reporting one more gated public function (e.g. `34/34 public functions gated`) — `getUsageAnalytics` is picked up automatically because it lives in a `.js` file and its body mentions `checkDashboardAccess`.

- [ ] **Step 6: Run the remaining suites to catch regressions**

Run: `node tests/access-tier-checks.js && node tests/access-list-editor-checks.js && node tests/open-access-gate-checks.js`
Expected: all ✅, same counts as before this feature.

- [ ] **Step 7: Commit**

```bash
git add "PS Usage.js" "PS Contribution Report.js" "PS Security.js" tests/usage-analytics-checks.js
git commit -m "feat(dh): access trace — every doGet hit logs one PS Access Log row; superadmin rollup endpoint"
```

---

### Task 5: Frontend — 📶 Usage Analytics tab

**Files:**
- Modify: `PS Dashboard.html` — four places: pane HTML (after `tabAccess`'s closing `</div>`, before `</main>`, ~line 2288), `STATE` (~line 2430), `VIEWS` (~line 2458), `RENDERERS` (~line 3504), plus new functions appended near `renderAccessTab_` (~line 9717)

All line numbers are as of this plan; locate by the quoted anchors, not the numbers.

- [ ] **Step 1: Add the pane**

After the `tabAccess` pane's closing `</div>` (anchor: `<!-- ACCESS CONTROL TAB`), before `</main>`:

```html
  <!-- USAGE ANALYTICS TAB (super admin only, opened from the ☰ menu) -->
  <div id="tabUsage" class="tab-pane">
    <div class="section-card">
      <div class="section-head">
        <div>
          <h2>Usage Analytics</h2>
          <p class="section-sub">Who opened the dashboard, week by week · Visible to super admins only</p>
        </div>
      </div>
      <div id="usageBody">
        <!-- Rendered by renderUsageTab_() after data loads -->
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add state, view and renderer registrations**

In `STATE` (anchor: `openMenuTabs:`), add:

```js
  usageData:        null,        // getUsageAnalytics() result, cached per session
```

In `VIEWS`, after the `access` entry:

```js
  // Usage analytics reads as the REAL caller (getUsageAnalytics is never
  // impersonated) → hideInPreview, like the other settings pages.
  { id: "usage",      btnId: "tabBtnUsage",      paneId: "tabUsage",      label: "📶 Usage Analytics", location: "menu",   roles: ["superadmin"], hideInPreview: true },
```

In `RENDERERS` inside `renderAll()`, after `access: function() { renderAccessTab_(); },`:

```js
    usage:      function() { renderUsageTab_(); },
```

- [ ] **Step 3: Add the renderer functions**

Append after `renderAccessTab_` (anchor: its closing `}` before `// ── SCORING WEIGHTS TAB`):

```js
// ── USAGE ANALYTICS TAB (super admin only, opened from the ☰ menu) ──
// Lazy: fetched on first open, cached in STATE for the session, ↻ refetches.
// Never part of the shared report payload — that cache entry is impersonal.
function renderUsageTab_() {
  var container = document.getElementById("usageBody");
  if (!container) return;
  if (STATE.usageData) { usagePaint_(STATE.usageData); return; }
  container.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:16px 0">' +
    '<div class="spinner" style="width:20px;height:20px;border-width:2px;margin:0"></div>' +
    '<span style="font-size:12px;color:var(--muted)">Loading usage analytics…</span></div>';
  google.script.run
    .withSuccessHandler(function(d) {
      if (d && d.ok) { STATE.usageData = d; usagePaint_(d); }
      else usageFail_(d && d.error);
    })
    .withFailureHandler(function(e) { usageFail_(e && e.message); })
    .getUsageAnalytics();
}

function usageRefresh_() { STATE.usageData = null; renderUsageTab_(); }

function usageFail_(msg) {
  var container = document.getElementById("usageBody");
  if (container) container.innerHTML =
    '<p style="color:#B71C1C;font-size:12px;padding:8px 0">Failed to load usage analytics: ' +
    esc(String(msg || "unknown error")) + '</p>';
}

// Hand-rolled bar chart, same idiom as the report's other inline SVGs.
function usageBarSvg_(weeks) {
  var W = 720, H = 120, pad = 4;
  var max = 1;
  weeks.forEach(function(w) { if (w.uniqueVisitors > max) max = w.uniqueVisitors; });
  var bw = (W - pad * 2) / weeks.length;
  var bars = weeks.map(function(w, i) {
    var h = Math.round((H - 34) * w.uniqueVisitors / max);
    var x = pad + i * bw;
    return '<rect x="' + (x + 2) + '" y="' + (H - 20 - h) + '" width="' + (bw - 4) + '" height="' + Math.max(h, 1) +
             '" rx="2" fill="#058CDC" opacity="0.85"><title>' + esc(w.week) + ': ' + w.uniqueVisitors +
             ' unique · ' + w.totalLoads + ' loads · ' + w.denied + ' denied</title></rect>' +
           (w.uniqueVisitors ? '<text x="' + (x + bw / 2) + '" y="' + (H - 24 - h) +
             '" text-anchor="middle" font-size="9" fill="var(--muted)">' + w.uniqueVisitors + '</text>' : '') +
           '<text x="' + (x + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="8" fill="var(--muted)">' +
             esc(w.week.replace(/^\d{4}\./, '')) + '</text>';
  }).join('');
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H +
    '" style="width:100%;max-width:' + W + 'px;height:auto">' + bars + '</svg>';
}

function usagePaint_(d) {
  var container = document.getElementById("usageBody");
  if (!container) return;
  var wk = d.weeks.length ? d.weeks[d.weeks.length - 1]
                          : { uniqueVisitors: 0, totalLoads: 0, denied: 0, byRole: {} };
  // Nudge list: never-visited first, then stalest last-seen.
  var notEngaged = d.people.filter(function(p) { return p.visitsThisWeek === 0; })
    .sort(function(a, b) {
      if (a.everVisited !== b.everVisited) return a.everVisited ? 1 : -1;
      return (a.lastSeen || '').localeCompare(b.lastSeen || '');
    });

  function kpi(label, value, sub) {
    return '<div style="flex:1;min-width:130px;border:1px solid var(--line,#E2E8F0);border-radius:10px;padding:12px 14px">' +
      '<div style="font-size:22px;font-weight:800">' + value + '</div>' +
      '<div style="font-size:11px;color:var(--muted)">' + label + (sub ? ' · ' + sub : '') + '</div></div>';
  }

  var html = '<div class="settings-body">';
  html += '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">' +
    '<button onclick="usageRefresh_()" style="font-size:12px;padding:5px 12px;border:1px solid var(--line,#E2E8F0);' +
    'border-radius:6px;background:transparent;color:inherit;cursor:pointer">↻ Refresh</button></div>';
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
    kpi('Unique visitors', wk.uniqueVisitors, esc(d.currentWeek)) +
    kpi('Coverage', d.coverage.pct + '%', d.coverage.engagedThisWeek + ' of ' + d.coverage.eligibleTotal + ' eligible') +
    kpi('Total loads', wk.totalLoads, esc(d.currentWeek)) +
    kpi('Denied attempts', wk.denied, esc(d.currentWeek)) +
    '</div>';

  html += '<div class="sec-header" style="margin:14px 0 6px">13-week trend — unique visitors</div>';
  html += d.weeks.some(function(w) { return w.totalLoads > 0; })
    ? usageBarSvg_(d.weeks)
    : '<p style="font-size:12px;color:var(--muted)">No visits recorded yet — logging starts with the first page load after this deploys.</p>';

  html += '<div class="sec-header" style="margin:18px 0 6px">Not engaged in ' + esc(d.currentWeek) +
    ' <span style="font-weight:400;color:var(--muted)">(' + notEngaged.length + ' of ' + d.people.length +
    ' eligible)</span></div>';
  if (notEngaged.length > 6) {
    html += '<input id="usageFilter" type="text" placeholder="Filter by name, email or role…" ' +
      'oninput="usageFilterRows_(this.value)" style="width:100%;max-width:340px;margin-bottom:6px;padding:6px 10px;' +
      'font-size:12px;border:1px solid var(--line,#E2E8F0);border-radius:6px;background:transparent;color:inherit">';
  }
  html += '<div style="max-height:340px;overflow-y:auto;border:1px solid var(--line,#E2E8F0);border-radius:8px">' +
    '<table class="dr-tbl" style="margin:0"><thead><tr>' +
    '<th>Name</th><th>Role</th><th>Source</th><th>Last seen</th><th>Visits, last 4 wks</th>' +
    '</tr></thead><tbody id="usageNudgeBody">';
  notEngaged.forEach(function(p) {
    html += '<tr data-usage-hay="' + esc((p.name + ' ' + p.email + ' ' + p.role).toLowerCase()) + '">' +
      '<td>' + esc(p.name) + '<div style="font-size:10px;color:var(--muted)">' + esc(p.email) + '</div></td>' +
      '<td>' + esc(p.role) + '</td><td>' + esc(p.source) + '</td>' +
      '<td>' + (p.everVisited ? esc(p.lastSeenWeek || (p.lastSeen || '').slice(0, 10)) : '<strong>never</strong>') + '</td>' +
      '<td style="text-align:center">' + p.visits4Weeks + '</td></tr>';
  });
  html += '</tbody></table></div>';

  var roles = Object.keys(wk.byRole).sort();
  if (roles.length) {
    html += '<div class="sec-header" style="margin:18px 0 6px">Loads by role — ' + esc(d.currentWeek) + '</div>' +
      '<table class="dr-tbl"><thead><tr><th>Role</th><th>Loads</th></tr></thead><tbody>' +
      roles.map(function(r) { return '<tr><td>' + esc(r) + '</td><td>' + wk.byRole[r] + '</td></tr>'; }).join('') +
      '</tbody></table>';
  }

  if (d.otherVisitors.length) {
    html += '<p style="font-size:11px;color:var(--muted);margin-top:12px">Visitors outside the eligible audience ' +
      '(open access / unlisted): ' +
      d.otherVisitors.map(function(v) { return esc(v.email); }).join(', ') + '</p>';
  }

  html += '<p style="font-size:10.5px;color:var(--muted);margin-top:14px">Generated ' + esc(d.generatedAt || '') +
    ' · Source: the “PS Access Log” sheet, one row per page load.</p>';
  html += '</div>';
  container.innerHTML = html;
}

function usageFilterRows_(q) {
  q = String(q || '').toLowerCase().trim();
  var body = document.getElementById('usageNudgeBody');
  if (!body) return;
  Array.prototype.forEach.call(body.rows, function(tr) {
    tr.style.display = !q || (tr.getAttribute('data-usage-hay') || '').indexOf(q) !== -1 ? '' : 'none';
  });
}
```

- [ ] **Step 4: Add frontend source checks to the test suite**

Insert before the final `console.log` in `tests/usage-analytics-checks.js`:

```js
// ── 6. Frontend wiring (source checks) ───────────────────────────────────────
const html = fs.readFileSync(path.join(dir, 'PS Dashboard.html'), 'utf8');
ck('VIEWS has a superadmin-only usage entry, hidden under 👁 View as',
   /id: "usage"[^\n]*roles: \["superadmin"\][^\n]*hideInPreview: true/.test(html));
ck('the pane exists', /<div id="tabUsage" class="tab-pane">/.test(html));
ck('RENDERERS dispatches usage → renderUsageTab_', /usage:\s*function\(\) \{ renderUsageTab_\(\); \}/.test(html));
ck('the tab lazy-loads via getUsageAnalytics', /\.getUsageAnalytics\(\);/.test(html));
ck('STATE caches the result per session', /usageData:\s*null/.test(html));
```

- [ ] **Step 5: Run the suite plus the sweep**

Run: `node tests/usage-analytics-checks.js && node tests/callable-surface-checks.js`
Expected: `✅ usage-analytics-checks: 52 checks passed`, sweep still ✅.

- [ ] **Step 6: Commit**

```bash
git add "PS Dashboard.html" tests/usage-analytics-checks.js
git commit -m "feat(dh): 📶 Usage Analytics tab — superadmin menu view over the access log"
```

---

### Task 6: Transparency copy

**Files:**
- Modify: `PS Dashboard.html` — two places

- [ ] **Step 1: Add the global footer line**

Immediately before `</main>` (after the `tabUsage` pane added in Task 5):

```html
  <!-- Transparency: the access trace records who opened the page and when. -->
  <div style="text-align:center;font-size:10.5px;color:var(--muted);padding:10px 0 18px">
    Page visits are logged (who and when) to measure adoption.
  </div>
```

- [ ] **Step 2: Add the Data Reference sentence**

In the `tabDataRef` pane's Purpose section (anchor: `<div class="dr-section-title">Purpose</div>`), after the existing two `<p class="dr-p">` paragraphs:

```html
          <p class="dr-p">Page visits are logged (who and when) to measure adoption. Usage analytics are visible to super admins only.</p>
```

- [ ] **Step 3: Add the copy check to the test suite**

Insert before the final `console.log` in `tests/usage-analytics-checks.js` (inside section 6, after the existing frontend checks):

```js
ck('transparency copy appears in BOTH surfaces (footer + Data Reference)',
   (html.match(/Page visits are logged \(who and when\) to measure adoption/g) || []).length >= 2);
```

- [ ] **Step 4: Run tests**

Run: `node tests/usage-analytics-checks.js`
Expected: `✅ usage-analytics-checks: 53 checks passed`

- [ ] **Step 5: Commit**

```bash
git add "PS Dashboard.html" tests/usage-analytics-checks.js
git commit -m "feat(dh): disclose the access trace — footer + Data Reference wording"
```

---

### Task 7: Documentation + full regression run

**Files:**
- Modify: `D:\Development\CLAUDE.md`
- Modify: `D:\Development\.claude\skills\ps-dashboard-navigation\SKILL.md`

- [ ] **Step 1: Add a Usage-analytics section to CLAUDE.md**

Insert after the "Cache" section (end of file):

```markdown
---

## Usage analytics (PS Usage.js)

Every `doGet` hit — allowed and denied — appends one row to the **`PS Access Log`**
tab of the container spreadsheet via `logDashboardVisit_` (best-effort: try/catch +
500 ms tryLock; a lost line is fine, a slow page load is not). Only `doGet` logs —
the warmer calls `getPSReportData`, so trigger runs never pollute the data.
`getUsageAnalytics()` (superadmin-only, throws) feeds the 📶 Usage Analytics ☰-menu
tab: 13-ISO-week rollup + the *eligible audience* (list members ∪ auto-managers the
current `MANAGER_AUTO_ACCESS` policy admits) with who has NOT engaged. The math is
pure (`computeUsageRollup_`) and covered by `tests/usage-analytics-checks.js`.
The trace is disclosed in the page footer and Data Reference.
```

- [ ] **Step 2: Add the menu entry to the navigation skill**

In `D:\Development\.claude\skills\ps-dashboard-navigation\SKILL.md`, under the "## ☰ menu" list, after the Scoring Weights / Access Control line:

```markdown
- 📶 **Usage Analytics** — superadmin only. Lazy-loads `getUsageAnalytics()`;
  weekly engagement + the not-engaged eligible list. `hideInPreview` like the
  other settings pages.
```

- [ ] **Step 3: Full regression run — all five suites**

Run from `D:\Development\ps-dashboard`:

```bash
node tests/usage-analytics-checks.js && \
node tests/access-tier-checks.js && \
node tests/access-list-editor-checks.js && \
node tests/callable-surface-checks.js && \
node tests/open-access-gate-checks.js
```

Expected: five ✅ lines, no ❌.

- [ ] **Step 4: Commit**

```bash
git add ../CLAUDE.md "../.claude/skills/ps-dashboard-navigation/SKILL.md"
git commit -m "docs(dh): record the usage-analytics surface in CLAUDE.md + navigation skill"
```

- [ ] **Step 5: Hand back the manual deploy note**

Tell the owner: push to GAS (clasp or editor paste of `PS Usage.js`, `PS Contribution Report.js`, `PS Security.js`, `PS Dashboard.html`), deploy a new version, then load the page once and confirm (a) a `PS Access Log` tab appeared with one row, and (b) `diagnosePSAccess()` prints build `2026.W36-usage`. No trigger installation is needed.
