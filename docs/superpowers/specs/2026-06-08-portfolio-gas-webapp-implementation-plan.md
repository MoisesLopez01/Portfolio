# Portfolio GAS Webapp — Implementation Plan
**Date:** 2026-06-08 (2026.W23)
**Spec:** `2026-06-08-portfolio-gas-webapp-design.md`
**Output files:** `Code.gs`, `index.html`, `JavaScript.html`

---

## Phase 1 — `Code.gs` (server-side, ~180 lines)

| Step | Task |
|---|---|
| 1.1 | PROJECTS constant — 10-project array (reuse objects from alex_lopez_portfolio.html) |
| 1.2 | `isAdmin()` — email guard against moises.lopez@servicerocket.com |
| 1.3 | `include(filename)` — HtmlService helper for template includes |
| 1.4 | `doGet()` — renders index.html template, injects isAdmin + projectsJson |
| 1.5 | `getProjectsData()` — merges PROJECTS + CUSTOM_PROJECTS from ScriptProperties |
| 1.6 | `saveProject(projectData)` — admin-only, appends to CUSTOM_PROJECTS |
| 1.7 | `deleteProject(projectId)` — admin-only, removes from CUSTOM_PROJECTS |
| 1.8 | `proxyClaudeAPI(userMessage, history)` — UrlFetchApp call, key from PropertiesService |
| 1.9 | `saveApiKey(key)` — admin-only, stores to PropertiesService |

---

## Phase 2 — `index.html` (HTML + CSS, ~550 lines)

| Step | Task |
|---|---|
| 2.1 | `<head>` — meta tags, Google Fonts (Inter + JetBrains Mono), CSS variables / reset |
| 2.2 | CSS design tokens — dark/light zones, teal accent system, shadows, spacing |
| 2.3 | CSS components — nav, hero, stack bar, section layout |
| 2.4 | CSS components — domain grid, domain cards, project tiles |
| 2.5 | CSS components — project detail modal (slide-up animation) |
| 2.6 | CSS components — before/after strip, code snippet panel |
| 2.7 | CSS components — AI chat, apikey banner, typing dots |
| 2.8 | CSS components — about section, skill bars, social buttons |
| 2.9 | CSS components — admin panel (slide-in from right), floating + button |
| 2.10 | CSS components — toast notification, mobile nav, scroll-reveal keyframes |
| 2.11 | HTML — nav (dark) with admin badge slot |
| 2.12 | HTML — hero (dark) with animated grid overlay + counter metrics |
| 2.13 | HTML — stack bar marquee |
| 2.14 | HTML — projects section (light) with domain grid container |
| 2.15 | HTML — project detail modal overlay |
| 2.16 | HTML — AI chat section (dark) with chat container |
| 2.17 | HTML — about section (light) with skill bars |
| 2.18 | HTML — footer (dark) |
| 2.19 | HTML — add-project modal (admin conditional via GAS template tags) |
| 2.20 | HTML — admin panel slide-in + API key form (admin conditional) |
| 2.21 | HTML — toast container |
| 2.22 | GAS template script block — window.IS_ADMIN + window.PROJECTS injection |
| 2.23 | GAS include tag — `<?!= include('JavaScript') ?>` at end of body |

---

## Phase 3 — `JavaScript.html` (client-side JS, ~420 lines)

| Step | Task |
|---|---|
| 3.1 | `runServer(fn, args, onSuccess, onError)` — google.script.run wrapper helper |
| 3.2 | `Toast` — show(message, type) / auto-dismiss after 3s |
| 3.3 | `Boot` — DOMContentLoaded init, reads window.IS_ADMIN + window.PROJECTS |
| 3.4 | `DomainGrid.render()` — groups projects by domain, builds cards + tiles |
| 3.5 | `DomainGrid.renderTile(p)` — tile HTML, onclick → ProjectModal.open(id) |
| 3.6 | `ProjectModal.open(id)` — populate all panels, slide-up animation |
| 3.7 | `ProjectModal.close()` — remove open class, restore scroll |
| 3.8 | `ProjectModal.toggleCode()` — expand/collapse snippet panel |
| 3.9 | `AdminPanel.init()` — only runs when IS_ADMIN; wires floating + button |
| 3.10 | `AdminPanel.open() / close()` — slide-in/out panel from right |
| 3.11 | `AdminPanel.submitProject()` — builds projectData, calls saveProject via runServer |
| 3.12 | `AdminPanel.deleteProject(id)` — confirm dialog, calls deleteProject via runServer |
| 3.13 | `AdminPanel.saveApiKey()` — reads key input, calls saveApiKey via runServer |
| 3.14 | `Chat.init()` — wires send button, suggestion pills, Enter key |
| 3.15 | `Chat.send(text)` — appends to history, calls proxyClaudeAPI via runServer |
| 3.16 | `Chat.addMessage(role, text)` — appends bubble, scrolls to bottom |
| 3.17 | `Chat.addTyping() / removeTyping()` — 3-dot animated indicator |
| 3.18 | `UI.CounterAnimation()` — requestAnimationFrame loop for hero counters |
| 3.19 | `UI.ScrollReveal()` — IntersectionObserver adds .visible to .reveal elements |
| 3.20 | `UI.SkillBars()` — IntersectionObserver triggers width animation on .skill-bar-fill |
| 3.21 | `UI.MobileNav()` — hamburger toggle for nav links on <768px |
| 3.22 | `UI.NavHighlight()` — IntersectionObserver updates active dot in nav |

---

## Phase 4 — Deployment Guide (instructions, not code)

| Step | Task |
|---|---|
| 4.1 | Create new Google Apps Script project at script.google.com |
| 4.2 | Paste Code.gs, create index.html file, create JavaScript.html file |
| 4.3 | Set CLAUDE_API_KEY in Project Settings → Script Properties |
| 4.4 | Deploy → New deployment → Web app → Execute as Me, Anyone |
| 4.5 | Copy web app URL → paste into LinkedIn profile website field |

---

## Build order

Code.gs → index.html → JavaScript.html → deployment guide

Each file is independently testable before the next is written.
Code.gs can be tested in the Script editor (run functions manually).
index.html can be previewed by running doGet() and opening the output.
JavaScript.html is tested end-to-end once all three files are in place.
