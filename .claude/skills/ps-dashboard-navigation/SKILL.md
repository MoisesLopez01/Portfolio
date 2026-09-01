---
name: ps-dashboard-navigation
description: Structure of the PS Dashboard's navigation — the VIEWS array that drives every tab and menu entry, the tab bar and ☰ menu inventory with their role allow-lists, and the ACL card editor on the Access Control page. Use when adding, removing, reordering or role-gating a tab or menu entry in ps-dashboard/PS Dashboard.html, or when touching the 🔒 Access Control list editor.
---

# PS Dashboard navigation

Navigation is driven by the `VIEWS` array in `ps-dashboard/PS Dashboard.html` — the single
source of truth for every view's button/pane ids, label, location, and role allow-list.
`switchTab()`, `renderAll()`'s renderer dispatch, role hiding (`applyRoleToNav_()`), and the
☰ menu all derive from it. Add a view by adding one `VIEWS` entry, not by editing those
four places.

Spec: `ps-dashboard/docs/specs/2026-06-10-dashboard-navigation-redesign-design.md`.

## Tab bar (always visible)

Overview, Team Radar, Leading Behaviours, Trends — plus:

- 📋 **Team Executive Brief** — superadmin / admin / viewer / manager.
- 📈 **Performance Record** — every role (`roles: null`). Per-rocketeer R/Y/G signal
  grid over the two closed quarters plus QTD. Reads only the report payload, so scope
  (own org tree for orgadmin/manager, pinned team for viewers) and self-exclusion are
  already enforced server-side — the tab gate adds no data control of its own.
  Spec: `ps-dashboard/docs/specs/2026-08-18-performance-record-tab-design.md`.

## ☰ menu (top-left in header)

- 📊 **Data Reference** — everyone.
- ⚖️ **Scoring Weights** and 🔒 **Access Control** — superadmin + admin + orgadmin.
  Both carry `hideInPreview: true` — hidden while 👁 View as is active, because they
  read settings as the real caller.
- 📶 **Usage Analytics** — superadmin only. Lazy-loads `getUsageAnalytics()`;
  weekly engagement + the not-engaged eligible list. `hideInPreview` like the
  other settings pages.
- 👁 **View dashboard as…** — real super admins only (`isRealSuperAdmin_()`, keyed off
  `STATE.realRole`, not the previewed `userRole`). Not a `VIEWS` entry: it opens the
  target picker modal (`openViewAsPicker`), not a pane, so it is appended explicitly in
  `renderNavMenu_()`. While previewing, an **↩ Exit preview** item follows it and a banner
  (`#viewAsBanner`) sits under the header.
  Spec: `ps-dashboard/docs/specs/2026-09-01-view-as-impersonation-design.md`.

Selecting one opens an IDE-style closable temp tab (`STATE.openMenuTabs`); closing it
returns to `STATE.lastRegularTab`.

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
