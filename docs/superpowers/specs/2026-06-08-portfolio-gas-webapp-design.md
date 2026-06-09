# Portfolio GAS Webapp Design
**Date:** 2026-06-08 (2026.W23)
**Author:** Alex López
**Status:** Approved
**Supersedes:** `2026-06-08-portfolio-enhancement-design.md` (single HTML file)

---

## Goal

Rebuild the portfolio as a production-grade Google Apps Script (GAS) webapp — 3 files, publicly accessible, admin-gated via Google account, Claude API proxied server-side. URL will be linked directly from LinkedIn profile (`linkedin.com/in/analystd/`). Target audience: hiring managers and recruiters.

---

## File Structure

```
Code.gs           ← server-side: routing, auth, data, Claude proxy
index.html        ← HTML skeleton + complete CSS design system
JavaScript.html   ← all client-side JS, included via <?!= include('JavaScript') ?>
```

No build step. No external dependencies beyond Google Fonts (Inter + JetBrains Mono).

---

## End-to-End Request Flow

```
Visitor opens GAS web app URL (from LinkedIn)
  ↓
doGet() executes server-side
  → isAdmin() checks Session.getActiveUser().getEmail()
  → getProjectsData() merges PROJECTS array + ScriptProperties custom projects
  → injects isAdmin (bool) + projectsJson (string) into index.html template
  ↓
index.html renders
  → admin UI blocks (<? if (isAdmin) { ?>) never sent to non-admin DOM
  → JavaScript.html included inline via <?!= include('JavaScript') ?>
  ↓
Client-side JS boots from window.IS_ADMIN + window.PROJECTS
  → DomainGrid renders
  → AI chat ready (calls google.script.run.proxyClaudeAPI — key never leaves server)
  → Admin panel visible only if IS_ADMIN === true
```

---

## GAS Deployment Configuration

| Setting | Value |
|---|---|
| Execute as | Me (Alex's Google account) |
| Who has access | Anyone |
| XFrameOptions | ALLOWALL (allows LinkedIn link preview) |
| Web app title | Alex López — Data Strategist |

---

## Security Model

### Three access tiers

| Tier | Identity | Capabilities |
|---|---|---|
| Public visitor | Anyone (logged in or not) | Full portfolio view, AI chat |
| Admin | `moises.lopez@servicerocket.com` only | + Add/delete projects, manage Claude key |
| Other Google account | Any non-admin email | Same as public visitor — no error shown |

### Enforcement rules

1. **`isAdmin()` is the single source of truth** — called by `doGet()` and by every mutating server function. Never trusts client input.
2. **Template-level exclusion** — admin HTML is conditionally rendered server-side via `<? if (isAdmin) { ?>`. Non-admins never receive admin markup in their DOM.
3. **`saveProject()` and `deleteProject()`** — call `isAdmin()` at the top; throw `'Unauthorized'` immediately if false.
4. **`proxyClaudeAPI()`** — public (any visitor can use the chat). The `CLAUDE_API_KEY` is read from `PropertiesService.getScriptProperties()` inside the function; it is never returned to the client.
5. **Client-side `IS_ADMIN`** — controls UI visibility only. The server never trusts it for any decision.

### Minimum backend exposure

Public visitors make exactly one type of server call: `proxyClaudeAPI(message, history)`. All other `google.script.run` calls are admin-only and rejected server-side for everyone else.

---

## `Code.gs` — Server-Side API

### Functions

#### `doGet()`
Renders `index.html` template. Injects:
- `isAdmin` — boolean from `isAdmin()`
- `projectsJson` — JSON string from `getProjectsData()`

Sets page title and `ALLOWALL` iframe mode.

#### `include(filename)`
HtmlService helper used inside templates:
```javascript
<?!= include('JavaScript') ?>
```
Returns raw HTML content of the named file.

#### `isAdmin()`
```javascript
function isAdmin() {
  var email = Session.getActiveUser().getEmail();
  return email === 'moises.lopez@servicerocket.com';
}
```
Returns `true` only for the admin email. Returns `false` (not throws) for unauthenticated or non-admin users.

#### `getProjectsData()`
Returns merged array: hardcoded `PROJECTS` constant + any custom projects stored in `ScriptProperties` under key `CUSTOM_PROJECTS` (JSON array, defaults to `'[]'`). Designed to be called only by `doGet()` at render time. Note: in GAS all Code.gs functions are technically reachable via `google.script.run`, but this function only returns public portfolio data so client calls are harmless.

#### `saveProject(projectData)`
- Guard: throws `'Unauthorized'` if `!isAdmin()`
- Reads `CUSTOM_PROJECTS` from ScriptProperties, parses, appends `projectData`, saves back
- Returns `{ success: true, id: projectData.id }`

#### `deleteProject(projectId)`
- Guard: throws `'Unauthorized'` if `!isAdmin()`
- Only custom projects (id starts with `'custom-'`) can be deleted; hardcoded projects are permanent
- Removes matching entry from `CUSTOM_PROJECTS` ScriptProperty
- Returns `{ success: true }`

#### `proxyClaudeAPI(userMessage, history)`
- Public — no auth guard
- Reads `CLAUDE_API_KEY` from `PropertiesService.getScriptProperties()`
- Builds messages array from `history` (last 6 messages) + new `userMessage`
- Calls `UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options)`
- Returns response text string
- Throws descriptive error on API failure (rate limit, invalid key, etc.)

#### `saveApiKey(key)`
- Guard: throws `'Unauthorized'` if `!isAdmin()`
- Stores `key` in `PropertiesService.getScriptProperties()` under `CLAUDE_API_KEY`
- Returns `{ success: true }`

### ScriptProperties keys

| Key | Type | Description |
|---|---|---|
| `CLAUDE_API_KEY` | string | Anthropic API key — set once via admin panel |
| `CUSTOM_PROJECTS` | JSON string | Array of admin-added project objects, default `'[]'` |

### PROJECTS constant

Top of `Code.gs` — JavaScript array of 10 hardcoded project objects. Each object has: `id`, `domain`, `title`, `tagline`, `category`, `impact`, `context`, `action`, `resolution`, `tech[]`, `metrics[]`, `before{}`, `after{}`, `codeSnippet{}`.

All employer references use **"Global SaaS Company"**. All exact headcount/revenue figures use ranges.

---

## `index.html` — HTML Structure + CSS

### Design system: Split dark/light

```
Dark zones  → nav, hero, AI section, footer    background: #04342C → #0a1f1a
Light zones → projects section, about section  background: #f8fafc → #ffffff
```

### Design tokens

```css
/* Brand */
--teal-900:   #04342C    --teal-vivid: #00c896
--teal-mid:   #1D9E75    --teal-muted: #5DCAA5
--teal-dim:   rgba(0,200,150,0.12)

/* Surfaces */
--dark-bg:      #04342C   --dark-surface: #0a1f1a
--dark-border:  rgba(93,202,165,0.15)
--light-bg:     #f8fafc   --light-surface: #ffffff
--light-border: #e2e8f0

/* Domain accents */
--blue: #3b82f6   --purple: #a855f7   --amber: #f59e0b

/* Typography */
--font-sans: 'Inter', system-ui, sans-serif
--font-mono: 'JetBrains Mono', 'Courier New', monospace

/* Shadows: 3 levels */
--shadow-sm: 0 1px 3px rgba(0,0,0,.08)
--shadow-md: 0 4px 16px rgba(0,0,0,.10)
--shadow-lg: 0 16px 48px rgba(0,0,0,.18)
```

### Section inventory

| Section | Zone | Key upgrade vs current HTML |
|---|---|---|
| Nav | Dark | Blur backdrop, active section dot, admin badge (admin only) |
| Hero | Dark | Animated grid overlay, larger headline, animated counters |
| Stack bar | Dark | Scrolling marquee strip on mobile |
| Projects | Light | Domain cards with shadow + hover lift, colored tile accent border |
| Project modal | Overlay | Slide-up animation, frosted header, IntersectionObserver-free |
| AI chat | Dark | Improved typing indicator, multi-turn history display |
| About | Light | Skill bars animate on scroll (IntersectionObserver) |
| Footer | Dark | Minimal, no change |

### Template variables (injected by `doGet()`)

```html
<script>
  window.IS_ADMIN = <?= isAdmin ?>;
  window.PROJECTS = <?= projectsJson ?>;
</script>
```

### Admin-conditional blocks

```html
<? if (isAdmin) { ?>
  <!-- floating add-project button -->
  <!-- admin panel slide-in -->
  <!-- API key management form -->
<? } ?>
```

### Google Fonts

```html
<link href="https://fonts.googleapis.com/css2?
  family=Inter:wght@400;500;600;700&
  family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

## `JavaScript.html` — Client-Side Modules

Included into `index.html` via `<?!= include('JavaScript') ?>`. Wrapped in a single `<script>` tag.

### Module: Boot
- Reads `window.IS_ADMIN` and `window.PROJECTS`
- Calls all module init functions after `DOMContentLoaded`

### Module: DomainGrid
- Renders 2×2 grid from `window.PROJECTS` grouped by `domain`
- `renderDomainGrid()` — builds domain cards + project tiles
- `renderTile(p)` — compact tile with title, impact badge, 3 tech chips
- Tile click → `ProjectModal.open(projectId)`
- On admin project save: calls `renderDomainGrid()` to refresh

### Module: ProjectModal
- `open(id)` — finds project by id, populates all panels, adds `open` class
- `close()` — removes `open` class, restores `body.overflow`
- `toggleCode()` — expand/collapse code snippet panel
- Panels: header badges → CAR 3-col → before/after strip → code snippet → tech chips + metrics
- Animation: `transform: translateY(40px) → translateY(0)` + `opacity` on open

### Module: AdminPanel
- Renders only when `window.IS_ADMIN === true`
- Floating `+` button (bottom-right, fixed position)
- Slide-in panel from right: full project form (all fields + domain selector)
- `submitProject()` — calls `google.script.run.withSuccessHandler(...).saveProject(data)`
- `deleteProject(id)` — calls `google.script.run.withSuccessHandler(...).deleteProject(id)`
- `saveApiKey()` — calls `google.script.run.withSuccessHandler(...).saveApiKey(key)`
- Success handlers: close panel, re-render grid, show toast notification

### Module: Chat
- `sendMessage(text)` — appends to `conversationHistory` (max last 6 turns = up to 12 message objects, oldest dropped first), calls `proxyClaudeAPI`
- `google.script.run.withSuccessHandler(onResponse).withFailureHandler(onError).proxyClaudeAPI(msg, history)`
- `addMessage(role, text)` — appends bubble to chat container, scrolls to bottom
- `addTyping() / removeTyping()` — animated 3-dot indicator
- Suggestion pills wired to `sendMessage()`

### Module: UI
- `CounterAnimation` — `requestAnimationFrame` loop for hero metric counters
- `ScrollReveal` — `IntersectionObserver` adds `visible` class to `.reveal` elements (`fadeUp` keyframe)
- `SkillBars` — `IntersectionObserver` sets `width` on `.skill-bar-fill` elements
- `MobileNav` — hamburger toggle shows/hides nav links on `<768px`
- `NavHighlight` — `IntersectionObserver` on sections updates active dot in nav

### `google.script.run` call pattern

```javascript
google.script.run
  .withSuccessHandler(function(result) { /* update UI */ })
  .withFailureHandler(function(err)    { /* show toast error */ })
  .functionName(arg1, arg2);
```

All calls wrapped in a `runServer(fn, args, onSuccess, onError)` helper to avoid repetition.

---

## Project Data Structure

Each project object (hardcoded in `Code.gs` PROJECTS array):

```javascript
{
  id:         'ai-sales',           // kebab-case string, unique
  domain:     'ai',                 // 'ai' | 'finance' | 'hr' | 'ops'
  title:      'AI Sales Analytics Ecosystem',
  tagline:    'HubSpot CRM + Gemini LLM → automated weekly deal intelligence',
  category:   'AI · Sales Analytics',
  impact:     '10h/week saved',
  context:    '...',
  action:     '...',
  resolution: '...',
  tech:       ['HubSpot API v3/v4', 'Python', 'Google Gemini LLM', ...],
  metrics:    [{ val: '10h+', label: 'saved weekly' }, ...],
  before:     { process: '...', metrics: '...' },
  after:      { process: '...', metrics: '...' },
  codeSnippet:{ lang: 'Python', tag: 'python', code: '...' }
}
```

Custom projects (saved via admin panel) use identical structure with `id: 'custom-' + timestamp`.

---

## Toast Notification System

Lightweight server-call feedback — no library:
- Success: green pill slides in from top-right, auto-dismisses after 3s
- Error: red pill, same behavior
- Used for: project saved, project deleted, API key saved, chat errors

---

## Out of Scope

- PDF export of project cards
- Analytics / visitor tracking
- Contact form / email integration
- Multi-language support
- Service Worker / PWA offline mode
- GitHub Pages or Vercel deployment (GAS only)
