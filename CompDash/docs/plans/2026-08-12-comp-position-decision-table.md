# Comp Position Decision Table (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Compensation Position tab into one dense, sortable decision table — market competitiveness and act-now signals visible per person without opening the drill — plus the I1/intern process carve, QTA back as an admin tab, and compact solo-cohort rows.

**Architecture:** The server already computes everything per employee (`marketRatio`, `suggestion`, `signals`, `priority`, `perf` in `employees[]`); the client just never surfaces it in the table. P1 therefore adds ONE server concept (the `inProcess` qualification flag: interns and level I1 do not qualify for the calibration process) and rebuilds `renderCompa` around a single `table-layout:fixed` table with 9 columns, cohort band rows, click-to-sort headers, and a Ranked mode that IS the old Priority Ranking tab. Anchor math is untouched — the carve is signal/presentation level only.

**Tech Stack:** Google Apps Script (V8), plain-JS client in HtmlService includes, plain Node test harnesses (no npm). Release stamp: **BUILD_ 47** (bump in EVERY server file + client SCHEMA, Task 8 only).

---

## Context an engineer needs

- **User decisions (2026-08-12, binding):** I1 + interns render greyed with a "not in process" tag — visible, no signal/market/priority grading. QTA becomes a **visible tab, admin-only**. Single-member cohorts render as a slim band row + one member row inside the one table (no per-group card/header).
- **Data reality:** `employees[]` rows (Code.js:856-907) carry `ratio, marketRatio, suggestion{status,pctToP25,pctToP50}, p25, p50(=bench MEAN — label it "mean", never "P50"), p75, benchSource, perfAvg/perfWindowLatest, signals{...riskFactors[]}, priority{score,partial}`. `compaGroups[].members` (Position.js:74-87) carry only `empNo,name,level,currency,tcc,tccUsd,ratio,noPeers[,nonComparable,employmentType]` — the client joins the two via `empIndex` (Views.html:445-446). Keep that join.
- **Currency trap:** only `tcc/tccUsd` are dual-currency. Anchors and benchmarks are LOCAL-only. The Market and Gap columns must therefore show **ratios and percentages, never currency amounts**, and cross-cohort sorting of TCC uses `tccUsd`.
- **Restricted stripping:** `stripRestrictedPayload_` removes members without recomputing `g.count` — never assume `count === members.length`.
- **Harnesses** (run from `D:\Contribution\CompDash`): `node tests/run_tests.js` (currently **244 passed, 0 failed**), `node tests/parse_html.js`, `node tests/render_smoke.js`. render_smoke has NO content assertions on renderCompa today — only "doesn't throw".
- **Layout discipline:** any `colspan` must equal the RENDERED column count (9). Tests are blind to layout — the final step asks the user for a screenshot.
- Commit trailer for every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

## File structure (no new files)

| File | Changes |
|---|---|
| `CompDash/Code.js` | `inProcessCD_()`, carve in `getCompReportData` employee rows, stale comments (28/53) |
| `CompDash/Position.js` | `inProcess` on group members, stale comment (14) |
| `CompDash/Views.html` | `renderCompa` rebuild (cohort + ranked modes), sort handlers, overview KPI retarget |
| `CompDash/ViewDash.html` | `STATE.compa`, `bandBarHtml` dot upgrade, VIEWS qta change, drill null-guards, SCHEMA 47 |
| `CompDash/Styles.html` | `.cmx` table styles, sort indicators, muted rows, perf dot |
| `CompDash/tests/cases.js` | `inProcess` tests |
| `CompDash/tests/render_smoke.js` | fixture I1 employee, new table assertions, schema 47 |
| `CompDash/PROCESS.md` | P1 release section |

---

## Task 1: Server — the `inProcess` qualification flag

Interns and I1s "do not qualify in this process": no signals, no priority, no market read. **Anchor medians are untouched** — an I1's TCC still evidences the cohort median; the carve controls what we *grade and surface*, not the math. Interns were already excluded from math via `comparable === false`; I1 regulars remain comparable.

**Files:**
- Modify: `CompDash/Code.js` (helper + employee-row carve)
- Modify: `CompDash/Position.js` (member flag)
- Modify: `CompDash/tests/cases.js`

- [ ] **Step 1: Write the failing tests.** Append to `tests/cases.js`:

```js
// ── inProcess — I1 + interns do not qualify for the calibration process ─────
// (2026-08-12 manager feedback). Presentation/signal carve ONLY: anchors and
// medians keep counting comparable I1s; what disappears is the grading.
check("inProcess: I1 is out, I2 is in, intern is out",
  inProcessCD_({ level: "I1", comparable: true })  === false &&
  inProcessCD_({ level: "I2", comparable: true })  === true &&
  inProcessCD_({ level: "M9", comparable: true })  === true &&
  inProcessCD_({ level: "I3", comparable: false }) === false &&
  inProcessCD_({ level: "—",  comparable: true })  === true);

check("inProcess: compa group members carry the flag; I1 still feeds the anchor", (function () {
  const recs = [
    { empNo: "1", name: "A", keyLocation: "MY", jobTitle: "Eng", level: "I1", currency: "MYR", tcc: 60000, comparable: true },
    { empNo: "2", name: "B", keyLocation: "MY", jobTitle: "Eng", level: "I3", currency: "MYR", tcc: 80000, comparable: true },
    { empNo: "3", name: "C", keyLocation: "MY", jobTitle: "Eng", level: "I3", currency: "MYR", tcc: 90000, comparable: true },
  ];
  const g = buildCompaGroups_(recs, new Map(), { SMALL_GROUP_MIN: 3 })[0];
  const a = g.members.find(m => m.empNo === "1");
  const b = g.members.find(m => m.empNo === "2");
  return g.anchor === 80000 &&            // I1 still in the median
         a.inProcess === false && a.ratio != null &&  // listed, ratio kept, flagged out
         b.inProcess === true;
})());
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -4
```

Expected: 2 failures — `ReferenceError: inProcessCD_ is not defined`.

- [ ] **Step 3: Add the helper to `Code.js`**, directly below `classifyEmpType_` (find with `grep -n "^function classifyEmpType_" Code.js`):

```js
/**
 * Does this person qualify for the calibration process (ranking, market
 * evaluation, risk/priority grading)? Level I1 and non-comparable
 * (part-time/intern) records do NOT (2026-08-12 manager rule). They stay in
 * headcount and keep feeding anchor medians — the carve is what we grade,
 * not the math.
 */
function inProcessCD_(r) {
  return r.comparable !== false && r.level !== "I1";
}
```

- [ ] **Step 4: Flag group members in `Position.js`.** In `buildCompaGroups_`'s comparable-member map (Position.js:75-80), add one field after `noPeers`:

```js
          noPeers: count === 1,
          inProcess: inProcessCD_(r),
```

And in the extras map (Position.js:81-86), after `employmentType`:

```js
          nonComparable: true, employmentType: r.employmentType,
          inProcess: false,
```

- [ ] **Step 5: Carve the employee rows in `Code.js` (`getCompReportData`).** Directly below `const comparable = r.comparable !== false;` (Code.js:859) add:

```js
    const inProcess = inProcessCD_(r);
```

Then change the `marketRatio` gate from `(comparable && row && …)` to `(inProcess && row && …)`, and in the returned row object make these three edits:

```js
      marketRatio,
      inProcess,
      suggestion: !inProcess
        ? { status: comparable ? "not-in-process" : "not-comparable", pctToP25: null, pctToP50: null }
        : marketSuggestion_(r.tcc, row ? row.p25 : null, row ? row.mean : null),
```

and replace the `signals:` and `priority:` values with `inProcess`-gated versions:

```js
      signals: inProcess ? buildSignalsForEmp_({ /* existing args unchanged */ }, cfgV4) : null,
      priority: inProcess ? priorityScore_({ /* existing args unchanged */ }, CONFIG_CD) : null,
```

(Keep the existing argument objects byte-identical inside the ternaries.) Because verdicts and Overview KPIs are built FROM these rows, I1s drop out of retention/recognition/promo counts automatically — that is the intended meaning of "do not qualify".

- [ ] **Step 6: Null-guard the drill panel.** In `ViewDash.html`'s `openDrill`, every `emp.signals.<x>` read must be guarded. Find them with `grep -n "signals\." ViewDash.html`; wrap the signal-chips block in `if (emp.signals) { … }` (or prefix each with `emp.signals && `), and guard `emp.priority` the same way (`emp.priority &&` before `.score` reads). Add one chip for the new state, next to the existing not-comparable chip (ViewDash.html:503-505 region):

```js
    (emp.inProcess === false && emp.employmentType === "regular"
      ? '<span class="chip" title="Level I1 — not in the calibration process. Counted in headcount and anchors; not graded.">not in process</span>' : '') +
```

- [ ] **Step 7: Run all three harnesses**

```bash
cd "D:/Contribution/CompDash" && node tests/run_tests.js | tail -1 && node tests/parse_html.js && node tests/render_smoke.js | tail -1
```

Expected: `246 passed, 0 failed`, both client harnesses green. (render_smoke's fixture employees have levels ≥ I2 or gain `inProcess` in Task 7 — if a fixture I1 breaks a signal count assertion here, report it, don't silently retune numbers.)

- [ ] **Step 8: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Code.js CompDash/Position.js CompDash/ViewDash.html CompDash/tests/cases.js && git commit -m "feat(compdash): inProcess flag — I1 and interns leave the calibration process

Signals, priority and market reads null out for non-qualifying people; they
stay visible, stay in headcount, and keep feeding anchor medians.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: CSS for the decision table

**Files:**
- Modify: `CompDash/Styles.html`

- [ ] **Step 1: Append the `.cmx` block** at the end of the stylesheet (before `</style>`):

```css
    /* ── Compensation Position decision table (P1) ─────────────────────────── */
    .cmx { width: 100%; table-layout: fixed; border-collapse: collapse; }
    .cmx th { position: sticky; top: 0; background: var(--panel); z-index: 2;
              cursor: pointer; user-select: none; white-space: nowrap; }
    .cmx th .arr { opacity: .45; font-size: 10px; margin-left: 3px; }
    .cmx th.on { color: var(--select); border-bottom: 2px solid var(--select); }
    .cmx td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmx tr.band td { background: var(--panel-2); font-weight: 600; padding: 6px 8px;
                      white-space: normal; border-top: 2px solid var(--border); }
    .cmx tr.band .sub { font-weight: 400; }
    .cmx tr.muted td { opacity: .45; }
    .cmx tr.muted:hover td { opacity: .8; }
    /* perf-colored position dot on the band bar (replaces the 2px marker) */
    .bandbar .mkdot { position: absolute; top: 50%; transform: translate(-50%, -50%);
                      width: 10px; height: 10px; border-radius: 50%;
                      border: 2px solid var(--panel); }
    .dot-strong { background: var(--accent); }
    .dot-meets  { background: var(--cta); }
    .dot-dev    { background: var(--warn); }
    .dot-none   { background: var(--muted); }
    /* group-by / mode control row */
    .cmx-bar { display: flex; gap: 10px; align-items: center; margin: 8px 0 10px; flex-wrap: wrap; }
```

- [ ] **Step 2: Parse check** — `cd "D:/Contribution/CompDash" && node tests/parse_html.js` → ✅ (CSS isn't parsed, but prove nothing broke).

- [ ] **Step 3: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Styles.html && git commit -m "feat(compdash): decision-table styles — sticky sortable headers, band rows, perf dot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Client scaffolding — state, dot marker, sort machinery

**Files:**
- Modify: `CompDash/ViewDash.html` (STATE, bandBarHtml)
- Modify: `CompDash/Views.html` (helpers + handlers, placed directly above `renderCompa`)

- [ ] **Step 1: Extend STATE** (ViewDash.html:79-83). Add one key to the object:

```js
  compa: { mode: "cohort", sortKey: "", sortDir: 1 },  // mode: cohort | ranked
```

(`sortKey: ""` = server order in cohort mode; ranked mode defaults to priority ↓ in the renderer.)

- [ ] **Step 2: Teach `bandBarHtml` an optional dot** (ViewDash.html:411-421). Replace the marker line:

```js
  if (val != null) html += '<span class="mk" style="left:' + pct(val).toFixed(1) + '%"></span>';
```

with:

```js
  if (val != null) html += (arguments.length > 4 && arguments[4]
    ? '<span class="mkdot ' + arguments[4] + '" style="left:' + pct(val).toFixed(1) + '%"></span>'
    : '<span class="mk" style="left:' + pct(val).toFixed(1) + '%"></span>');
```

Existing Overview callers pass 4 args and keep the 2px marker — zero behavior change there.

- [ ] **Step 3: Add helpers + handlers in `Views.html`**, directly above `function renderCompa`:

```js
// ── Compensation Position decision table (P1) ────────────────────────────────
// One row object per person: compaGroups member ⊕ employees[] record. The
// employees row carries market/signals/priority; the member carries the
// cohort-anchored ratio. Missing employees entry (restricted-stripped) → the
// member alone, with a stub of the fields the columns read.
function cmxRows(d) {
  const empIndex = {};
  d.employees.forEach(e => { empIndex[e.empNo] = e; });
  const f = STATE.filters, out = [];
  d.compaGroups
    .filter(g => !f.loc || g.keyLocation === f.loc)
    .forEach(g => g.members.forEach(m => {
      const e = empIndex[m.empNo] || { name: m.name, level: m.level, keyLocation: g.keyLocation, dept: "" };
      if (!visibleEmp(e)) return;
      out.push({ g: g, m: m, e: e });
    }));
  return out;
}
function perfDotCls(e) {
  const r = e.perfWindowLatest != null ? e.perfWindowLatest : e.perfAvg;
  if (r == null) return "dot-none";
  return r >= 4 ? "dot-strong" : r >= 3 ? "dot-meets" : "dot-dev";
}
// Sort accessors. Currency-mixed columns sort on USD; nulls always sink.
const CMX_SORT = {
  name:     r => (r.m.name || "").toLowerCase(),
  level:    r => { const x = /^([IM])(\d+)$/.exec(r.m.level || ""); return x ? (x[1] === "I" ? 0 : 100) + +x[2] : 999; },
  tcc:      r => r.m.tccUsd != null ? r.m.tccUsd : -Infinity,
  ratio:    r => r.m.ratio != null ? r.m.ratio : -Infinity,
  market:   r => r.e.marketRatio != null ? r.e.marketRatio : -Infinity,
  gap:      r => (r.e.suggestion && r.e.suggestion.pctToP50 != null) ? r.e.suggestion.pctToP50 : -Infinity,
  risk:     r => (r.e.signals && r.e.signals.riskFactors) ? r.e.signals.riskFactors.length + (r.e.signals.retentionRisk ? 100 : 0) : -1,
  priority: r => (r.e.priority && r.e.priority.score != null) ? r.e.priority.score : -1,
};
function cmxSortRows(rows) {
  const k = STATE.compa.sortKey;
  if (!k || !CMX_SORT[k]) return rows;
  const dir = STATE.compa.sortDir, acc = CMX_SORT[k];
  return rows.slice().sort((a, b) => {
    const va = acc(a), vb = acc(b);
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
}
function setCompaMode(mode) {
  STATE.compa.mode = mode;
  if (mode === "ranked" && !STATE.compa.sortKey) { STATE.compa.sortKey = "priority"; STATE.compa.sortDir = -1; }
  render();
}
function setCompaSort(key) {
  if (STATE.compa.sortKey === key) STATE.compa.sortDir = -STATE.compa.sortDir;
  else { STATE.compa.sortKey = key; STATE.compa.sortDir = key === "name" || key === "level" ? 1 : -1; }
  render();
}
```

- [ ] **Step 4: Harnesses** — parse_html ✅, render_smoke ✅, run_tests unchanged (246/0).

- [ ] **Step 5: Commit**

```bash
cd "D:/Contribution" && git add CompDash/ViewDash.html CompDash/Views.html && git commit -m "feat(compdash): compa table scaffolding — join, sort machinery, perf dot marker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: The decision table — cohort mode

Replaces `renderCompa` (Views.html:438-478) wholesale. One table, 9 fixed columns, cohort band rows (`colspan="9"` — the rendered count), slim solo bands, greyed not-in-process rows.

**Files:**
- Modify: `CompDash/Views.html`

- [ ] **Step 1: Replace `renderCompa` and add the cell builders** (delete the old function body entirely; `ratioBarColor` at Views.html:6-9 loses its last caller — delete it too):

```js
// Cell builders — shared by cohort and ranked modes so the columns can never
// drift between them. Order (9): Name·Lv·TCC·Band·Ratio·Market·Gap·Risk·Priority.
function cmxColgroup() {
  return '<colgroup><col style="width:17%"><col style="width:5%"><col style="width:11%">' +
    '<col style="width:20%"><col style="width:7%"><col style="width:8%"><col style="width:10%">' +
    '<col style="width:12%"><col style="width:10%"></colgroup>';
}
function cmxHeadHtml() {
  const cols = [["name","Name"],["level","Lv"],["tcc","TCC"],["band","Band position"],
    ["ratio","Ratio"],["market","Market"],["gap","Gap"],["risk","Risk"],["priority","Priority"]];
  const k = STATE.compa.sortKey, dir = STATE.compa.sortDir;
  return '<tr>' + cols.map(c =>
    '<th class="' + (k === c[0] ? "on" : "") + '" onclick="setCompaSort(\'' + c[0] + '\')">' + c[1] +
    '<span class="arr">' + (k === c[0] ? (dir > 0 ? "▲" : "▼") : "↕") + '</span></th>').join("") + '</tr>';
}
function cmxRowHtml(r, showGroup) {
  const m = r.m, e = r.e, mLow = STATE.data.meta.marketLow;
  const out = m.inProcess === false;
  const cls = out ? "" : ratioClass(m.ratio);
  const band = m.ratio != null
    ? bandBarHtml([{ to: 0.80, color: "var(--bad)" }, { to: 0.95, color: "var(--warn)" },
                   { to: 1.10, color: "var(--accent)" }, { to: 1.30, color: "var(--above)" }],
                  Math.max(0.60, Math.min(1.30, m.ratio)), 0.60, 1.30,
                  out ? "dot-none" : perfDotCls(e))
    : '<span class="sub">' + (m.nonComparable ? "not comparable" : "no anchor") + '</span>';
  const mkt = out ? "" : (e.marketRatio != null
    ? '<span class="chip ' + (e.marketRatio < mLow ? "red" : e.marketRatio > 1.15 ? "violet" : "green") +
      '" title="TCC ÷ benchmark mean · ' + esc(e.benchSource || "") + '">' + e.marketRatio.toFixed(2) + '</span>'
    : '<span class="sub" title="No benchmark row for this location + title">—</span>');
  const s = e.suggestion || {};
  const gap = out ? "" :
    s.status === "below-p25" ? '<span class="chip red" title="' + Math.round(s.pctToP25 * 100) + '% below the market P25">+' + Math.round(s.pctToP50 * 100) + '% to mean</span>' :
    s.status === "below-p50" ? '<span class="chip yellow">+' + Math.round(s.pctToP50 * 100) + '% to mean</span>' :
    s.status === "at-market" ? '<span class="sub">at market</span>' : '<span class="sub">—</span>';
  const sg = e.signals;
  const risk = out ? '<span class="chip">not in process</span>' : !sg ? "" :
    sg.retentionRisk ? '<span class="chip red" title="' + esc(sg.riskFactors.join(" · ")) + '">🔥 ' + sg.riskFactors.length + ' factors</span>' :
    sg.riskFactors && sg.riskFactors.length ? '<span class="chip yellow" title="' + esc(sg.riskFactors.join(" · ")) + '">' + sg.riskFactors.length + '</span>' :
    '<span class="sub">—</span>';
  const pr = out ? "" : (e.priority && e.priority.score != null
    ? '<span class="chip ' + (e.priority.score >= 70 ? "red" : e.priority.score >= 45 ? "yellow" : "") +
      '" title="0–100 · perf + tenure + compa gap' + (e.priority.partial ? " · partial data" : "") + '">' +
      e.priority.score + (e.priority.partial ? "±" : "") + '</span>' : '<span class="sub">—</span>');
  return '<tr class="click' + (out ? " muted" : "") + '" onclick="openDrill(\'' + esc(m.empNo) + '\')">' +
    '<td title="' + esc(m.name) + '">' + esc(m.name) +
    (showGroup ? ' <span class="sub">· ' + esc(r.g.keyLocation) + " · " + esc(r.g.jobTitle) + '</span>' : "") + '</td>' +
    '<td>' + esc(m.level) + '</td>' +
    '<td>' + fmtMoney(m.tcc, m.tccUsd, m.currency) + '</td>' +
    '<td>' + band + '</td>' +
    '<td>' + (m.ratio != null ? '<span class="chip ' + cls + '">' + m.ratio.toFixed(2) + '</span>' : '<span class="sub">—</span>') + '</td>' +
    '<td>' + mkt + '</td><td>' + gap + '</td><td>' + risk + '</td><td>' + pr + '</td></tr>';
}
function cmxBandHtml(g) {
  return '<tr class="band"><td colspan="9">' + esc(g.keyLocation) + ' · ' + esc(g.jobTitle) +
    ' <span class="sub">(' + g.count + (g.count === 1 ? " member · no peers" : " members") + ')</span>' +
    ' <span class="chip ' + (g.anchorTier === "market" ? "violet" : "") + '">' + TIER_LABEL[g.anchorTier] + '</span>' +
    (g.smallGroup && g.count > 1 ? ' <span class="chip yellow">small group</span>' : "") +
    (g.missingTcc ? ' <span class="chip">' + g.missingTcc + ' missing TCC</span>' : "") +
    (g.anchor != null ? ' <span class="sub">· anchor ' + fmtMoney(g.anchor, null, g.currency) + '</span>' : "") +
    '</td></tr>';
}
function renderCompa(el) {
  const d = STATE.data, c = STATE.compa;
  let html =
    '<div class="banner">⚖️ <b>Compensation Position</b> — internal ratio (TCC ÷ peer anchor) and market ratio (TCC ÷ benchmark mean) side by side. Click a column to sort; <b>Ranked</b> flattens every cohort into one priority-ordered list. Greyed rows (I1, interns) are not in the calibration process. Click a row for the full profile.</div>' +
    '<div class="cmx-bar"><div class="seg">' +
    '<button class="' + (c.mode === "cohort" ? "on" : "") + '" onclick="setCompaMode(\'cohort\')">Cohorts</button>' +
    '<button class="' + (c.mode === "ranked" ? "on" : "") + '" onclick="setCompaMode(\'ranked\')">Ranked</button>' +
    '</div><span class="sub">' + (c.mode === "cohort"
      ? "grouped by location · job title, sorted within each cohort"
      : "one list across all cohorts — this is the priority ranking") + '</span></div>';
  const rows = cmxRows(d);
  let body = "";
  if (c.mode === "ranked") {
    body = cmxSortRows(rows).map(r => cmxRowHtml(r, true)).join("");
  } else {
    const byG = new Map();
    rows.forEach(r => {
      const k = r.g.keyLocation + "||" + r.g.jobTitle;
      if (!byG.has(k)) byG.set(k, { g: r.g, rows: [] });
      byG.get(k).rows.push(r);
    });
    byG.forEach(x => { body += cmxBandHtml(x.g) + cmxSortRows(x.rows).map(r => cmxRowHtml(r, false)).join(""); });
  }
  html += body
    ? '<div class="card" style="padding:0"><div class="scroll-x"><table class="cmx">' +
      cmxColgroup() + cmxHeadHtml() + body + '</table></div></div>'
    : '<div class="card sub">No people match the current filters.</div>';
  el.innerHTML = html;
}
```

- [ ] **Step 2: Verify `ratioBarColor` is gone and uncalled**

```bash
cd "D:/Contribution/CompDash" && grep -rn "ratioBarColor" Views.html Admin.html ViewDash.html; echo "exit $?"
```

Expected: no hits (`exit 1`).

- [ ] **Step 3: Harnesses** — all three; run_tests 246/0, parse ✅, smoke ✅ (smoke only requires "doesn't throw" for compa today; content assertions come in Task 7).

- [ ] **Step 4: Commit**

```bash
cd "D:/Contribution" && git add CompDash/Views.html && git commit -m "feat(compdash): the decision table — 9 sortable columns, cohort bands, market + gap + risk + priority inline

One fixed-layout table replaces the per-group cards. Solo cohorts are a slim
band + one row. Ranked mode is the old Priority Ranking tab. I1/intern rows
grey out with no grading.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: QTA back as an admin tab + Overview KPI links

**Files:**
- Modify: `CompDash/ViewDash.html` (VIEWS)
- Modify: `CompDash/Views.html` (Overview KPI cards)

- [ ] **Step 1: VIEWS change** (ViewDash.html:70-77). Replace the qta entry:

```js
  { id: "qta",       icon: "i-qta",       label: "QTA Status",            roles: ["admin"] },
```

(remove `menu: true`; roles drop to admin — "the super admin should be able to act on it", more development coming for this tab.)

- [ ] **Step 2: Overview "overdue for review" card.** In `renderOverview`'s cards array (grep `tab: "overview"` in Views.html — the card retargeted there by the P0 final-review fix): retarget to `qta` for admins and make it non-interactive otherwise. In `cardHtml` (or where the card's `onclick` is emitted), a card whose `tab` equals the CURRENT tab or is not visible to `USER_ROLE` must render without `onclick` and without the pointer affordance — add `class="kpi flat"` and this style to Styles.html in the same commit:

```css
    .kpi.flat { cursor: default; }
    .kpi.flat:hover { border-color: var(--border); box-shadow: none; }
```

Concretely: change the card's data to `tab: "qta"`, and in the emit path:

```js
      const dest = VIEWS.find(v => v.id === c.tab);
      const live = dest && dest.roles.includes(USER_ROLE) && c.tab !== STATE.tab;
      // live → onclick + "kpi"; not live → no onclick + "kpi flat"
```

(Adapt to the actual emit code; the invariant is: no rendered onclick may target a menu-less-invisible or same-tab view.)

- [ ] **Step 3: Harnesses** — all three green. render_smoke's `routes: exactly six survive` still passes (count unchanged); if any smoke check pins qta's `menu` flag or the menu item count, update it in this commit and say so.

- [ ] **Step 4: Commit**

```bash
cd "D:/Contribution" && git add CompDash/ViewDash.html CompDash/Views.html CompDash/Styles.html && git commit -m "feat(compdash): QTA returns as an admin-only tab; same-view/invisible KPI cards go inert

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Stale-comment sweep (P0 leftovers)

**Files:** `CompDash/Code.js:28,53`, `CompDash/Position.js:14`

- [ ] **Step 1:** Update the three comments that still say "Pay Equity tab" / "Internal Position" to the current world ("equity lenses (Executive Pulse KPI)", "Compensation Position"). Comment-only — verify with `git diff --stat` that only comment lines changed.
- [ ] **Step 2:** run_tests 246/0.
- [ ] **Step 3: Commit** — `git add CompDash/Code.js CompDash/Position.js && git commit -m "docs(compdash): retire pre-P0 tab names from server comments` + trailer.

---

## Task 7: render_smoke coverage for the decision table

**Files:**
- Modify: `CompDash/tests/render_smoke.js`

- [ ] **Step 1: Extend the fixture.** In the fixture `employees` array add one I1 (carved) employee, and give existing fixture employees `inProcess: true` plus (on one of them) `suggestion: { status: "below-p50", pctToP25: 0, pctToP50: 0.13 }` if the fixture lacks suggestions. Add a matching member to the `compaGroups` fixture with `inProcess: false` on the I1 and `inProcess: true` on the rest:

```js
D.employees.push({ empNo: "E9", name: "Ida One", jobTitle: "07.I1.1 - Junior", level: "I1",
  track: "IC", dept: "Services", keyLocation: "Malaysia", currency: "MYR",
  employmentType: "regular", tcc: 40000, tccUsd: 9000, ratio: 0.9, anchor: 44000,
  anchorTier: "title", marketRatio: null, inProcess: false,
  suggestion: { status: "not-in-process", pctToP25: null, pctToP50: null },
  signals: null, priority: null, perfAvg: null, perfWindowLatest: null });
```

(match the fixture's real field style; the compaGroups member needs `empNo,name,level,currency,tcc,tccUsd,ratio,noPeers,inProcess`.)

- [ ] **Step 2: Add assertions** after the existing overview checks:

```js
// ── Compensation Position decision table (P1) ───────────────────────────────
const cx = el(); renderCompa(cx); const CH = cx.innerHTML;
check("cmx: band rows span exactly the 9 rendered columns", /colspan="9"/.test(CH) && !/colspan="[^9]"/.test(CH));
check("cmx: market + gap + risk + priority headers render", /Market</.test(CH) && /Gap</.test(CH) && /Risk</.test(CH) && /Priority</.test(CH));
check("cmx: not-in-process row is muted and ungraded", /class="click muted"/.test(CH) && /not in process/.test(CH));
check("cmx: sort toggles direction", (function () {
  STATE.compa = { mode: "ranked", sortKey: "", sortDir: 1 };
  setCompaSort("priority"); const d1 = STATE.compa.sortDir;
  setCompaSort("priority"); const d2 = STATE.compa.sortDir;
  const ok = d1 === -1 && d2 === 1 && STATE.compa.mode === "ranked";
  STATE.compa = { mode: "cohort", sortKey: "", sortDir: 1 };
  return ok;
})());
check("cmx: ranked mode flattens — no band rows", (function () {
  STATE.compa = { mode: "ranked", sortKey: "priority", sortDir: -1 };
  const rx = el(); renderCompa(rx);
  const ok = !/class="band"/.test(rx.innerHTML) && /· Malaysia ·/.test(rx.innerHTML);
  STATE.compa = { mode: "cohort", sortKey: "", sortDir: 1 };
  return ok;
})());
check("qta: visible admin tab, not a menu item", (function () {
  const v = VIEWS.find(x => x.id === "qta");
  return v && !v.menu && v.roles.length === 1 && v.roles[0] === "admin";
})());
```

(`setCompaSort` calls `render()` — if the stub `render` throws in the harness, stub `STATE.tab = "compa"` first or temporarily no-op `render` the way existing checks do; follow the file's own conventions.)

- [ ] **Step 3: Run** — render_smoke ✅ with the new checks counted; run_tests 246/0; parse ✅.

- [ ] **Step 4: Commit** — `git add CompDash/tests/render_smoke.js && git commit -m "test(compdash): decision-table smoke coverage — colspan, carve, sort, ranked flatten, qta tab"` + trailer.

---

## Task 8: Release 47 — stamps, schema, docs

**Files:** all five server files, `ViewDash.html`, `tests/render_smoke.js`, `PROCESS.md`

- [ ] **Step 1:** Bump `BUILD_.code/.position/.workforce/.narrative/.security` 46 → 47 (one line each), `const SCHEMA = 46` → 47 in ViewDash.html, and `schema: 46` → 47 in render_smoke's synthetic meta.
- [ ] **Step 2:** All three harnesses green (the BUILD_ tests compare stamps to each other, not to 46 — they must still pass; if any test pins the literal 46, that is a test bug: fix the test to compare against `BUILD_.code`).
- [ ] **Step 3:** Append a `## P1 release (2026.W33 — decision table)` section to PROCESS.md: what shipped (9-column table, ranked mode, inProcess carve, QTA admin tab), deploy = `clasp push` + `bustCompCache_()` (REQUIRED — payload gained `inProcess` and nulled fields) + new deployment version.
- [ ] **Step 4: Commit** — `git add -A CompDash && git commit -m "chore(compdash): release 47 — stamps, schema, P1 deploy notes"` + trailer.
- [ ] **Step 5: STOP — tests are blind to layout.** Deploy and ask the user for screenshots of the Compensation Position tab: a ~20-person cohort (density check), a solo cohort, an I1 row, and Ranked mode — in dark AND light themes.

---

## Done when

1. All three harnesses report zero failures (run_tests 246, render_smoke grown by ~6).
2. The Compensation Position tab is ONE table: 9 sortable columns, cohort band rows (`colspan="9"`), market ratio + gap % + risk + priority visible per row without opening the drill.
3. Ranked mode flattens all cohorts into one list, default priority ↓ — the old Priority Ranking tab lives in a click.
4. I1 + intern rows render greyed with "not in process": no market, no gap, no risk, no priority, neutral ratio; they still appear, and anchors still count comparable I1s (cases.js proves it).
5. QTA is a visible admin-only tab; no Overview card renders a pointer onto a view it can't open.
6. BUILD_ 47 everywhere + SCHEMA 47; PROCESS.md documents the release.
7. The user has confirmed screenshots (cohort density, solo row, I1 row, ranked mode, both themes).

## Explicitly not in P1

Roll-up/exec mode (P2, with the `exec` role), Executive Compensation route (P2), band min/max from a real salary-band sheet (the 0.60–1.30 ratio window is a threshold visualization, not a band structure), currency-denominated market gaps (benchmarks are local-only), proposed-movement modeling (Screenshot_6's orange line — needs a target-setting model that doesn't exist yet), Gender/Ethnicity columns (P3 prerequisites).
