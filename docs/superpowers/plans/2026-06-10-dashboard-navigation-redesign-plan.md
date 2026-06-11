# Implementation Plan — Dashboard Navigation Redesign

**Spec:** `docs/superpowers/specs/2026-06-10-dashboard-navigation-redesign-design.md`
**Date:** 2026-06-10 (2026.W24)
**Targets:** `PS Dashboard.html` only (frontend; no GAS backend changes)

## Guiding principles for sequencing

1. **Parity first.** Phase 0 is a pure refactor — same six tabs, same behavior — so the
   `VIEWS`-driven engine is proven before any visible change lands.
2. **One visible change per phase.** Each phase is shippable and individually testable
   against the 3-roles × views matrix.
3. **Renderers move, they don't change.** `renderSettingsTab()` content and
   `buildTeamBriefHTML()` are relocated verbatim; behavior diffs live only in navigation code.

---

## Phase 0 — `VIEWS` config + `switchTab` refactor (no behavior change)

**0.1** Define `VIEWS` next to `STATE` (~line 1780):

```js
var VIEWS = [
  { id:"overview",   btnId:"tabBtnOverview",   paneId:"tabOverview",   label:"Overview",            location:"tabbar", roles:null },
  { id:"radar",      btnId:"tabBtnRadar",      paneId:"tabRadar",      label:"Team Radar",          location:"tabbar", roles:null },
  { id:"rocketeers", btnId:"tabBtnRocketeers", paneId:"tabRocketeers", label:"LEADING BEHAVIOURS",  location:"tabbar", roles:null },
  { id:"trends",     btnId:"tabBtnTrends",     paneId:"tabTrends",     label:"Trends",              location:"tabbar", roles:["admin","viewer"] },
  { id:"dataref",    btnId:"tabBtnDataRef",    paneId:"tabDataRef",    label:"Data Reference",      location:"tabbar", roles:null },
  { id:"settings",   btnId:"tabBtnSettings",   paneId:"tabSettings",   label:"⚙ Settings",          location:"tabbar", roles:["admin"] },
];
```

`roles:null` = everyone. (Phase 0 keeps today's exact rules, including Trends hidden from
managers and `dataref`/`settings` still in the tab bar — parity only.)

**0.2** Add `viewById_(id)` and `canSeeView_(view)` (checks `STATE.userRole` against
`view.roles`). Rewrite `switchTab()` (line 1922): the redirect guards and the twelve
`classList.toggle` lines become a single loop over `VIEWS` — forbidden id → `"overview"`.

**0.3** Replace the per-button hide logic in the payload handler (lines ~1867–1871,
`settingsBtn`/`trendsBtn`) with `applyRoleToNav_()` — loop over `VIEWS`, set
`display:none` on buttons whose view fails `canSeeView_`.

**0.4** Convert the `renderAll()` tab dispatch (lines 1963–1977) to a `RENDERERS` map
keyed by view id.

**Verify (parity):** As admin, viewer, and manager: all six tabs render exactly as today;
manager still has no Trends; non-admin still has no Settings; `switchTab('settings')` from
the console as viewer still bounces to Overview.

---

## Phase 1 — Open Trends to managers

**1.1** Change the `trends` entry to `roles:null` and delete the now-dead manager redirect
remnant (old line 1924 behavior) if any survived Phase 0 outside the config.

**Verify:** Manager role sees the Trends tab; its data is the manager-scoped payload
(already filtered server-side per delegate scope). Admin/viewer unchanged.

---

## Phase 2 — Hamburger menu + temporary tabs

**2.1 Markup.** In `<header>` (line 1160), insert before `.header-logo`:
`<button id="navMenuBtn" class="nav-menu-btn" aria-label="Menu">☰</button>` and a hidden
`<div id="navMenuPanel" class="nav-menu-panel">` populated from `VIEWS` where
`location === "menu"`.

**2.2 Config.** Flip `dataref` to `location:"menu"` (roles stay `null`) and `settings` to
`location:"menu"` (roles `["admin"]`). Remove their static buttons from `#tabNav`
(lines 1267–1268). Menu panel renders Data Reference first, then a divider, then
admin-only items — and is rebuilt by `applyRoleToNav_()` so contents always match the role.

**2.3 Menu behavior.** `toggleNavMenu()` on ☰ click; close on outside click and Esc
(follow the existing `fb-multi-panel` dropdown pattern, lines 1216–1224).

**2.4 Temporary tabs.** Add to `STATE`: `openMenuTabs: []` (view ids) and
`lastRegularTab: "overview"`.
- Selecting a menu item: push id into `openMenuTabs` (if absent), append a
  `.tab-btn.tab-btn-temp` button to `#tabNav` with a trailing `×` (`.tab-close`), then
  `switchTab(id)`.
- `switchTab()` updates `lastRegularTab` whenever the target is a `tabbar` view.
- `closeMenuTab(id)`: remove from `openMenuTabs`, remove the button; if it was the active
  view, `switchTab(STATE.lastRegularTab || "overview")`; otherwise no view change.
- Re-selecting an open page from the menu just activates its existing temp button.
- Guard in `switchTab()`: a `menu` view that isn't in `openMenuTabs` gets opened (so
  programmatic calls behave like menu clicks).

**2.5 CSS.** `.nav-menu-btn` (header-btn family, top-left), `.nav-menu-panel`
(white card, `--radius`, `--shadow`, divider), `.tab-btn-temp .tab-close`
(hover state), plus `body.dark-mode` variants alongside the existing dark-mode block
(~line 993) and the mobile tab-bar rules (~line 750).

**Verify:** All roles: ☰ shows only permitted items; Data Reference opens as a closable
tab; closing returns to the last regular tab; switching away and back preserves the temp
tab; Esc/outside-click closes the panel; mobile tab bar still scrolls with a temp tab open;
dark mode renders the panel and temp tab correctly. Admin additionally sees ⚙ Settings in
the menu (still the combined page at this phase).

---

## Phase 3 — Split Settings into ⚖️ Scoring Weights + 🔒 Access Control

**3.1 Panes.** Duplicate the `#tabSettings` pane shell (line 1716) into `#tabWeights` and
`#tabAccess`; delete `#tabSettings`.

**3.2 Config.** Replace the `settings` entry with:
- `{ id:"weights", label:"⚖️ Scoring Weights", location:"menu", roles:["admin"] }`
- `{ id:"access",  label:"🔒 Access Control",  location:"menu", roles:["admin"] }`

**3.3 Renderer split.** Split `renderSettingsTab()` (line 5537) at the existing seam —
Access Control is rendered first today (comment at line 5543), weights from line 5551:
- `renderAccessTab_()`: open-access toggle + admins/viewers/delegates textareas +
  `saveAccessSettings()` flow (lines ~5897–6010). Verbatim move.
- `renderWeightsTab_()`: flat weights editor (`saveWeightSettings()`), async Family × Level
  matrix loader (`getScoringConfig()` / `saveScoringMatrix()`, lines 5608+), and the
  "Unmapped job titles" panel. Verbatim move.
- Update the `RENDERERS` map; delete `renderSettingsTab()`.

**3.4 Copy updates.** Repoint old references:
- Line ~5530: "configured by admins in the **Settings** tab" → "in **⚖️ Scoring Weights**
  (☰ menu)".
- Line ~5533: "Settings → Scoring Weights by Family & Level" → "☰ → Scoring Weights".
- Line ~5716: "Edit these in **Scoring Weights** above" → "in the flat weights section of
  this page" (wording to match the new page layout).
- Sweep for remaining `Settings` strings tied to navigation (incl. Data Reference tab copy).

**Verify:** Admin: both pages open from ☰ as separate temp tabs, save flows work
(weights save busts the report cache — confirm via Refresh showing new weights; access
save round-trips). Viewer/manager: neither appears in ☰, and `switchTab('weights'|'access')`
from the console bounces to Overview. `_test_weightsResolver()` still passes (guard; logic
untouched).

---

## Phase 4 — Team Executive Brief as its own admin tab

**4.1 Pane + tab.** Add `{ id:"execbrief", label:"📋 Team Executive Brief",
location:"tabbar", roles:["admin"] }` after `trends` in `VIEWS`; add button to `#tabNav`
and a `#tabExecBrief` pane with its own week selector `ebWeekSelect` (clone the
`rkWeekSelect` pattern, line 1371; `populateWeekSelect_("ebWeekSelect")` alongside line 2203).

**4.2 Renderer.** New `renderExecBriefTab_()`: read `ebWeekSelect` (default latest week),
compute `prevWeek`, call `generateTeamBrief()` + `buildTeamBriefHTML()` (currently invoked
at lines 3060–3062) and inject into the pane. Copy / Gemini narrative / Publish handlers
come along unchanged — they live in `buildTeamBriefHTML()`'s markup.

**4.3 Remove from Leading Behaviours.** In `renderTopRocketeers()` delete the
`teamBrief` generation (3060–3062) and both `STATE.userRole === 'admin' ? teamBriefHTML : ''`
concatenations (lines 3089, 3184). Leading Behaviours renders identically for all roles.

**Verify:** Admin: 5th tab appears, brief renders for the default week, changing the week
regenerates it, Copy/Gemini/Publish work; Leading Behaviours shows no brief. Viewer/manager:
no 5th tab; console `switchTab('execbrief')` bounces to Overview. Filtered states (search,
member type) leave the Exec Brief unaffected (it consumes unfiltered team data, as today).

---

## Phase 5 — Final sweep

**5.1** Full manual matrix: 3 roles × 8 views (visibility, redirect, menu contents,
temp-tab lifecycle).
**5.2** Dark mode + mobile spot-check on header, ☰ panel, temp tabs.
**5.3** Grep `PS Dashboard.html` for `tabSettings|renderSettingsTab|Settings tab` —
zero live references.
**5.4** Push to GAS (`clasp push` / editor paste per current workflow) and smoke-test the
deployed web app as each role (use a delegate account or temporary delegate entry for the
manager case).
