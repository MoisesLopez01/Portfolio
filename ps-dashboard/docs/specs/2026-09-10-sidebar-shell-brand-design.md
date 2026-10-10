# Sidebar shell + ServiceRocket brand — design

**Date:** 2026-09-10 (2026.W37) · **File:** `PS Dashboard.html` · **Reference:**
`gas-projects/delivery-health/Dashboard.html` (its 2026-08-17 rail redesign)

## Goal

Brand the PS Weekly Contribution Report with the real ServiceRocket lockup, move the tabs
into a left sidebar, and pin the filters at the top of the page — the shell every modern
data tool uses, and the one the Delivery Health dashboard already ships.

## What changed

### 1. Left sidebar (`<nav class="sidenav" id="sidenav">`)

- A `position: fixed` rail, `--navw` wide (212 px × `--scale`), dark in **both** themes.
  It owns its own tokens (`--nav-bg/-text/-muted/-border/-hover/-active`); only
  `--nav-border` brightens under `body.dark-mode` so the edge survives against a dark page.
- **Brand block:** the ServiceRocket lockup with the white wordmark (`-on-navy` asset from
  the `servicerocket-brand` skill, embedded as base64 — the old Google Drive `uc?` URL was
  fragile in HtmlService), width-only sizing at 124 px, and the app name "Contribution
  Report" underneath. Collapsed rail / ≤ 900 px: a "CR" monogram tile replaces the lockup,
  because a horizontal wordmark at icon width would be 14 px tall.
- **Main group** = the existing `#tabNav` with its six static buttons (same `btnId`s), now
  vertical rows: `.tabDot` glyph (aria-hidden) + `.tabLbl`. Hidden until the payload lands,
  as before.
- **"More" group** = `#navMenuPanel`, rendered by `renderNavMenu_()` from the VIEWS entries
  with `location: "menu"` plus the 👁 View-as rows. This replaces the ☰ dropdown and its
  closable temp tabs. Each row carries its VIEWS `btnId`, so `switchTab()`'s active toggle
  and `applyRoleToNav_()`'s role hiding work unchanged.
- **Collapse** (`#btnNav`) toggles `body.navCollapsed`, which narrows `--navw` to 56 px —
  the rail and the body's left padding follow the same token, so they cannot drift.
  Persisted per viewer in `localStorage['ps-nav-collapsed']`.

### 2. Sticky top bar (`<div class="topbar" id="topbar">`)

One `position: sticky; top: 0` wrapper around the header (title, team toggle, week badge,
freshness note, role badge, Dark, Refresh), the 👁 banner and `#filterBar`. The old pair
of separately-sticky bars needed a hard-coded `top: 65px` that broke whenever the header
wrapped. `initShell_` publishes the wrapper's measured height as `--topbar-h`
(ResizeObserver + resize), and the Performance Record drawer offsets from it.

z-index order: 👁 modal 300 · rail 200 · top bar 100 · multiselect panels 60.

### 3. Body offset

`body { padding-left: var(--navw) }`. `main` keeps its centred `max-width`. Print hides the
rail and top bar and zeroes the padding.

### 4. Removed

`.nav-menu-wrap/.nav-menu-btn/.nav-menu-panel` dropdown, `toggleNavMenu`,
`ensureMenuTabOpen_`, `STATE.openMenuTabs`, `.tab-close`, the `#srLogo` Drive image and its
lightning-bolt fallback, the horizontal tab-strip CSS and its ≤ 768 px scroll rules.

## Invariants kept

- Role gating still happens inside `switchTab()`; `canSeeView_` unchanged.
- The test-pinned strings survive verbatim: `.header-title h1 { font-size: calc(18px * var(--scale)); }`,
  the `.fb-*` height rule, the `usage` and `perfrecord` VIEWS lines, the
  `if (isRealSuperAdmin_()) { html += '<div class="nav-menu-divider">` shape.
- `#tabNav.visible` still gates the nav's appearance; the "More" group chains to it via
  `.tab-nav.visible + .tab-nav-more`.

## Verification

All eight `tests/*.js` suites pass. Rendered locally at 1440 × 900 (light, dark, collapsed,
scrolled) and 800 × 900 (forced icon rail): the chrome stays pinned while content scrolls,
the lockup renders at 124 × 48, the monogram takes over when collapsed.
