---
name: ps-dashboard-navigation
description: Structure of the PS Dashboard's navigation — the VIEWS array that drives every tab and menu entry, the tab bar and ☰ menu inventory with their role allow-lists, and the ACL card editor on the Access Control page. Use when adding, removing, reordering or role-gating a tab or menu entry in ps-dashboard/PS Dashboard.html, or when touching the 🔒 Access Control list editor.
---

# PS Dashboard navigation

Navigation is driven by the `VIEWS` array in `ps-dashboard/PS Dashboard.html` — the single
source of truth for every view's button/pane ids, label, location, and role allow-list.
`switchTab()`, `renderAll()`'s renderer dispatch, role hiding (`applyRoleToNav_()`), and the
sidebar's "More" group all derive from it. Add a view by adding one `VIEWS` entry, not by
editing those four places.

## The shell (2026.W37) — left sidebar + sticky top bar

Redesigned after the Delivery Health dashboard; spec
`ps-dashboard/docs/specs/2026-09-10-sidebar-shell-brand-design.md`.

- `<nav class="sidenav">` is a fixed rail, **dark in both themes** (its own `--nav-*`
  tokens; only `--nav-border` brightens in dark mode). Brand block on top: the real
  ServiceRocket lockup (`.navLogo`, white wordmark, base64 from the `servicerocket-brand`
  skill's `-on-navy` asset, 124 px wide) with a "CR" monogram tile (`.navMark`) that takes
  over when the rail is collapsed or the viewport is ≤ 900 px.
- `--navw` (`:root`, scaled by `--scale`) is the rail width **and** the body's left
  padding; `body.navCollapsed` narrows both to 56 px. Collapse is persisted per viewer
  (`localStorage['ps-nav-collapsed']`, `setNavCollapsed_` / `toggleNav_`).
- `#tabNav` keeps its id and static buttons; rows are `.tab-btn` = `.tabDot` glyph
  (aria-hidden) + `.tabLbl`. `navRow_(label)` builds that markup for rendered rows and lends
  a leading emoji from the label as the glyph.
- `#topbar` wraps the header, the 👁 banner and `#filterBar` as **one** `position: sticky`
  block (z-index 100; rail 200; 👁 modal 300). Its measured height is published as
  `--topbar-h` by `initShell_` (ResizeObserver) — anything sticky inside a pane (the
  Performance Record drawer) offsets from it instead of a hard-coded pixel value.
- The ☰ dropdown and its closable temp tabs are gone: `openMenuView(id)` is just
  `switchTab(id)`, and `closeMenuTab(id)` only falls back to `STATE.lastRegularTab` when a
  "More" view the caller can no longer see is the active one.
- **Every pane shares the one document scroller.** `.tab-pane` siblings only flip
  `display:none`/`flex`, so the window's scroll offset would survive the swap and Trends
  would open scrolled to wherever Overview was left (2026.W38 bug). `switchTab()` captures
  `prevTab` before it overwrites `STATE.activeTab` and calls `resetViewScroll_()` only when
  the view actually changes — a same-view call (`loadData`'s re-render, a filter change)
  keeps the reader's place. Guarded by `tests/responsive-checks.js`. Do not move panes
  into their own scroll containers to "fix" this; the sticky top bar and the Performance
  Record drawer both offset against the document scroller.

Spec: `ps-dashboard/docs/specs/2026-06-10-dashboard-navigation-redesign-design.md`.

## Sidebar — main group (always visible)

Overview, Team Radar, 📈 Performance Record, Trends, 📋 Team Executive Brief.

- 📈 **Performance Record** — every role (`roles: null`), third since 2026.W41, when it
  absorbed **Leading Behaviours** (that view, its pane and `renderTopRocketeers` are gone;
  `switchTab()` aliases `"rocketeers"` → `"perfrecord"`). Two layouts under
  `STATE.prView`: **People** (default — ranked list + plain-English person card, lens
  Evaluated week / Weekly / Monthly / Quarterly in `STATE.prLens`) and **Team grid** (the
  R/Y/G signal grid with its slide-in panel). Reads only the report payload, so scope
  (own org tree for orgadmin/manager, pinned team for viewers) and self-exclusion are
  already enforced server-side — the tab gate adds no data control of its own.
  Specs: `ps-dashboard/docs/specs/2026-08-18-performance-record-tab-design.md`,
  `ps-dashboard/docs/specs/2026-10-10-performance-record-merge-and-top-bar-design.md`.
- 📋 **Team Executive Brief** — superadmin / admin / viewer / manager.

**Phone (≤ 720 px, 2026.W41):** the rail is a drawer (`body.navOpen`, `#btnMenu` in the
header, `#navScrim`); `switchTab()` closes it. The filter bar shows search + one "Filters"
button that opens a bottom sheet (`body.fb-sheet-open`). Scrolling past ~80 px folds the
header row on every width (`body.tb-scrolled`).

## Sidebar — "More" group (was the ☰ menu until 2026.W37)

Rendered by `renderNavMenu_()` into `#navMenuPanel`, under a divider and a small-caps
"More" label; each row carries its VIEWS `btnId`, so `switchTab()` lights it exactly like a
main tab.

- 📖 **Documentation** — everyone. Renamed from "Data Reference" in 2026.W37: it explains
  to managers what each metric means and how it is evaluated. Internal ids (`dataref`,
  `tabDataRef`, the `dr-*` CSS classes) keep the old name.
- ⚖️ **Scoring Weights** and 🔒 **Access Control** — superadmin + admin + orgadmin.
  Both carry `hideInPreview: true` — hidden while 👁 View as is active, because they
  read settings as the real caller.
- 📶 **Usage Analytics** — superadmin only. Lazy-loads `getUsageAnalytics()`;
  weekly engagement + the not-engaged eligible list. `hideInPreview` like the
  other settings pages.
- 👁 **View dashboard as…** — real super admins only (`isRealSuperAdmin_()`, keyed off
  `STATE.realRole`, not the previewed `userRole`). Not a `VIEWS` entry: it opens the
  target picker modal (`openViewAsPicker`), not a pane, so it is appended explicitly in
  `renderNavMenu_()`. While previewing, an **↩ Exit preview** row follows it and a banner
  (`#viewAsBanner`) sits under the header, inside the sticky top bar.
  Spec: `ps-dashboard/docs/specs/2026-09-01-view-as-impersonation-design.md`.

Selecting one switches to its pane like any tab; a "More" view that loses its role gate
(or is hidden by 👁 preview) falls back to `STATE.lastRegularTab`.

## 🔒 Access Control — the ACL cards

The page renders four **ACL cards** (`ACL` / `ACL_LISTS` / `aclRender_`), not textareas.
Each card gives: a per-list count, a filter box once past 6 entries, bounded scroll, one
removable row per entry, and a bulk-paste mode.

**The trap:** rows carry their **real array index** through the filter. Removing an entry
while the list is filtered must not delete by visible position — that deletes the wrong
person. Covered by `ps-dashboard/tests/access-list-editor-checks.js`; run it after any
change to the editor.

## Related

Two navigation rules live in the root `CLAUDE.md` rather than here, because they must apply
whether or not this skill is loaded: role gating is enforced inside `switchTab()` (not just
by hiding buttons), and client-side role tests always go through `isSuperAdmin_()` /
`hasAdminPower_()`.
