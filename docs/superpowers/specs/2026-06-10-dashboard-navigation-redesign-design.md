# Dashboard Navigation Redesign — Hamburger Menu, Settings Split, Exec Brief Tab

**Date:** 2026-06-10 (2026.W24)
**File affected:** `PS Dashboard.html` (frontend only — no GAS backend changes)

## Goal

Reduce the visible tab bar to the everyday views and move reference/admin pages behind a
top-left hamburger (☰) menu, following the modern-website collapsed-navigation pattern.
Split the monolithic ⚙ Settings page into separate ⚖️ Scoring Weights and 🔒 Access Control
pages, and split the Team Executive Brief out of Leading Behaviours into its own admin-only tab.

## Navigation model

Eight views, two locations:

| View | Location | Who sees it |
|---|---|---|
| Overview | Tab bar | Everyone |
| Team Radar | Tab bar | Everyone |
| Leading Behaviours | Tab bar | Everyone |
| Trends | Tab bar | **Everyone — including managers** (changed; see below) |
| 📋 Team Executive Brief | Tab bar (5th tab) | Admins only |
| 📊 Data Reference | ☰ menu | Everyone |
| ⚖️ Scoring Weights | ☰ menu | Admins only |
| 🔒 Access Control | ☰ menu | Admins only |

### VIEWS config — single source of truth

A `VIEWS` array describes every view: `{ id, label, icon, location: "tabbar" | "menu", roles }`.
Both the tab bar and the ☰ menu render from it. `switchTab()`'s hard-coded
`classList.toggle` block (currently twelve lines for six tabs) becomes a loop over `VIEWS`.

Role gating is enforced **in `switchTab()`**, not only by hiding buttons: navigating to a
view the current role cannot access redirects to `overview` (same pattern as the existing
`settings → overview` guard).

### Trends rule change

The existing rule hiding Trends from managers (`switchTab` guard + button hiding in the
payload handler) is **removed**. Manager-scoped data filtering already limits what a
manager-role user sees, so Trends is safe to expose to all roles.

## Hamburger menu (☰)

- A ☰ button sits top-left in the header, **before the title**.
- Clicking it opens a small dropdown panel anchored under the button, listing only the
  `location: "menu"` views the current role can see:
  - Non-admins: 📊 Data Reference only.
  - Admins: 📊 Data Reference, then a divider, then ⚖️ Scoring Weights and 🔒 Access Control.
- Clicking outside the panel or pressing Esc closes it.
- Mobile uses the same dropdown — the tab bar already scrolls horizontally; no separate
  mobile drawer.
- Styling follows the existing design system (`--void` header, `--orbe` accent, existing
  radius/shadow variables, dark-mode variants).

## Temporary tabs (IDE-style)

- Choosing a menu item appends a **closable tab** to the end of the tab bar
  (e.g. `🔒 Access Control ×`) and activates it.
- The temporary tab persists until its × is clicked — the user can switch freely between
  it and regular tabs.
- Clicking × closes the tab and returns to the **last active regular tab** (fallback:
  Overview), including when the closed tab was not the active view (no view change then).
- Re-selecting an already-open page from the menu re-activates its existing tab (no
  duplicates).
- All three menu pages may be open as temporary tabs simultaneously.
- Temporary-tab state is session-only (in `STATE`); it does not persist across reloads.

## Settings page split

The current admin-only ⚙ Settings tab dissolves into two pages. **No GAS backend changes** —
all existing `google.script.run` endpoints are reused as-is.

### ⚖️ Scoring Weights (admin only)

Contains everything scoring-related, moved verbatim from the Settings renderer:

- Flat base weights editor (`saveWeightSettings()` / `readWeightSettings_()`).
- Scoring Weights by Family & Level matrix editor (`getScoringConfig()` /
  `saveScoringMatrix()`), still loaded async on first open.
- "Unmapped job titles" panel (`weightAudit`).

`renderSettingsTab()` splits into `renderWeightsTab_()` and `renderAccessTab_()`.

### 🔒 Access Control (admin only)

- Open-access toggle.
- Admins / Viewers / Delegates textareas.
- Same `saveAccessSettings()` call and validation.

### Copy updates

In-app text that references the old structure is updated, e.g.:

- "Weights are configured by admins in the **Settings** tab" → "… in **⚖️ Scoring Weights**
  (☰ menu)".
- "Settings → Scoring Weights by Family & Level" → "☰ → Scoring Weights".
- The Data Reference tooltip on the Goals KPI keeps pointing at Data Reference (unchanged
  destination, now reached via ☰).

## Team Executive Brief split

- The brief is **removed from the Leading Behaviours renderer** (today it is concatenated
  into that tab's HTML for admins only). Leading Behaviours then renders identically for
  every role.
- It becomes its own tab panel (admin-only, 5th tab in the tab bar) with its **own week
  selector**, defaulting to the latest week — mirroring the Leading Behaviours selector
  behavior but independent of it.
- `generateTeamBrief()` and `buildTeamBriefHTML()` are reused unchanged: Gemini narrative,
  Copy, and Publish buttons come along as-is.

## Error handling

- Forbidden view ids passed to `switchTab()` (stale state, console calls) redirect to
  Overview.
- Closing the active temporary tab falls back to the last regular tab, then Overview.
- The ☰ panel renders from the same `VIEWS` array as the gating, so menu contents and
  enforcement cannot drift apart.

## Testing

- Manual matrix: 3 roles (admin / viewer / manager) × 8 views — correct visibility,
  correct redirect on forbidden access, menu contents per role.
- Temporary-tab lifecycle: open, switch away, return, close active, close inactive,
  reopen from menu.
- Exec Brief: week selector changes regenerate the brief; Copy / Gemini / Publish work
  from the new tab; Leading Behaviours shows no brief for any role.
- Run `_test_weightsResolver()` in the GAS editor to confirm no scoring regressions
  (the weights logic is untouched; this is a guard).
- Dark mode + mobile spot-checks on the header (☰ button, chip-free tab bar, dropdown).

## Out of scope

- Any GAS backend (`PS Contribution Report.js`, `PS Security.js`) changes.
- Persisting open temporary tabs across sessions.
- Changes to scoring logic, caching, or access-control semantics (other than Trends
  visibility for managers).
