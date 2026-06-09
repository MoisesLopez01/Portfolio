# Portfolio Enhancement Design
**Date:** 2026-06-08 (2026.W23)  
**Author:** Alex López  
**Status:** Approved

## Goal

Rebuild the projects section of `alex_lopez_portfolio.html` to showcase 10 projects across 4 professional domains, with technical depth (code snippets, before/after comparisons), proper anonymization, and persistence — targeting hiring managers and recruiters.

---

## Architecture

The page retains its existing skeleton (nav, hero, stack bar, about, footer, AI assistant). Only the **Projects section** is replaced.

### Page Sections (unchanged)
- Nav, Hero, Stack Bar, AI Assistant, About, Footer

### Projects Section (replaced)
The current tab+single-card layout is removed. Replaced with:

1. **Domain Grid** — 2×2 grid of domain cards
2. **Project Detail Modal** — full-screen overlay per project

---

## Domain Grid

Four domain cards arranged in a responsive 2×2 grid (1-col on mobile).

| Domain | Accent | Projects |
|---|---|---|
| AI & LLM Integration | teal (existing brand) | AI Sales Analytics, Global Salary Benchmarking, 360 Leadership Evaluation |
| Finance & Data | blue | TCC Financial Forecasting, Goals Quality Audit, Total Rewards Analysis |
| HR & People | purple | Compensation Reporting Tool, Global Headcount Analysis |
| Ops & Engineering | amber | PS Contribution Dashboard, Benchmarking & Performance Engine |

Each domain card contains:
- Domain icon, name, accent color header
- One-line domain tagline
- 2–3 compact project tiles

Each **project tile** shows:
- Project title (left)
- Impact badge (right, e.g. "⚡ 10h/wk saved")
- Tech pills (2–3 tags below title)
- Full tile is clickable → opens Project Detail Modal

---

## Project Detail Modal

Max-width 860px, centered overlay with backdrop. Full-screen on mobile. Four panels top-to-bottom:

### Panel 1 — Header
- Domain badge + impact badge (top left)
- Close button (top right)
- Project title (large)
- Project tagline (subtitle)

### Panel 2 — CAR Narrative
Three columns: Context (green left-border), Action (blue left-border), Resolution (purple left-border). Same visual treatment as current portfolio.

### Panel 3 — Before / After Comparison
Two-column strip:
- **Before:** old process description + pain metric (e.g. "3-day manual cycle", "inconsistent results")
- **After:** new process description + outcome metric (e.g. "automated in 10 min", "C-suite ready")
Visual: left card (gray/red tint) → arrow → right card (teal/green tint)

### Panel 4 — Code Snippet
Collapsible section (collapsed by default). When expanded, shows 10–20 lines of sanitized Python/JS with syntax highlighting (pre/code block, monospace, dark background). No company names, no real endpoints, no credentials — shows logic pattern only.

### Footer
- Tech stack chips (full list)
- Inline metrics row (same as current)

---

## Project Inventory (10 projects)

All references to the employer anonymized as **"Global SaaS Company"**. Exact headcount/revenue figures replaced with ranges (e.g., "500–1,000-employee org").

### AI & LLM Integration

**AI Sales Analytics Ecosystem**
- Impact: 10h+/week saved
- Before: 10h/week manual CRM consolidation, unreliable forecasts
- After: Automated Monday AI summaries, deal risk flags for C-suite
- Code snippet: Gemini batch analysis loop over deal notes (Python)
- Tech: HubSpot API v3/v4, Python, Google Gemini LLM, ETL Pipelines, Time Decay Forecasting, Google Apps Script

**Global Salary Benchmarking Engine**
- Impact: 90% faster compensation research
- Before: Multi-day manual research across 15+ country reports
- After: Minutes-long automated workflow with P25/P50/P75 percentiles
- Code snippet: Prompt engineering template with COL/tax injection (Python)
- Tech: Gemini Pro API, Prompt Engineering, Python, Google Sheets, PDF Automation, COL/Tax Modeling

**360 Leadership Evaluation Automation**
- Impact: 40% cycle time reduction
- Before: Manual survey consolidation, slow cycle, inconsistent summaries
- After: Automated narrative summaries, more frequent evaluation runs
- Code snippet: Multi-source survey ingestion + Gemini summary generation (Apps Script)
- Tech: Gemini API, Google Apps Script, Survey Automation, NLP Pipelines, Google Workspace

### Finance & Data

**TCC Financial Forecasting System**
- Impact: CFO-level P&L visibility, 100% audit accuracy
- Before: Manual P&L consolidation across departments, error-prone quarterly cycles
- After: Automated board dashboards, real-time labor cost drivers
- Code snippet: SuiteQL attrition proration query (SQL)
- Tech: Google Apps Script, NetSuite SuiteQL, SQL, Oracle Warehouse, Tableau, Looker

**Goals Quality Audit**
- Impact: 100% bonus-eligibility compliance enforced
- Before: Manual goal count checks, inconsistent enforcement of 10-goal rule
- After: Automated Python pipeline flags non-compliant employees before bonus cycle
- Code snippet: JSON-to-CSV pipeline with compliance filter (Python)
- Tech: Python, SuiteQL, JSON parsing, Google Sheets

**Total Rewards Analysis**
- Impact: Consistent comp modeling across all bands
- Before: Ad hoc compensation comparisons, no standardized band framework
- After: Automated employee comparison module with band positioning
- Code snippet: Band positioning logic with percentile mapping (JS)
- Tech: Google Apps Script, NetSuite, Compensation Modeling, Google Sheets

### HR & People

**Global Compensation Reporting Tool**
- Impact: 10+ regions, board-level decisions
- Before: Separate manual reports per region, no unified framework
- After: Single automated tool — multi-currency, micro-banding, PDF + Sheets output
- Code snippet: Multi-currency normalization with regional adjustment (Python)
- Tech: Gemini Pro API, Python, PDF Automation, Google Sheets, Multi-currency Logic

**Global Headcount Analysis**
- Impact: Real-time headcount visibility across functions
- Before: Monthly snapshots only, no trend visibility
- After: Live headcount analysis with attrition and growth trends
- Code snippet: Headcount trend aggregation with LOB breakdown (Apps Script)
- Tech: Google Apps Script, NetSuite SuiteQL, SQL, Tableau

### Ops & Engineering

**PS Contribution Dashboard**
- Impact: Team health visibility for professional services
- Before: No systematic way to track contribution quality or team health metrics
- After: Role-based web app dashboard with Jira/Tempo integration, weekly reports
- Code snippet: GAS data aggregation with role-based access control
- Tech: Google Apps Script, Jira API, Tempo API, HTML/CSS, Role-based Access Control

**Benchmarking & Performance Engine**
- Impact: Standardized performance benchmarking across roles
- Before: Manual benchmarking with inconsistent criteria
- After: Automated engine with standardized scoring and comparison logic
- Code snippet: Scoring normalization and ranking logic (JS)
- Tech: Google Apps Script, NetSuite, Performance Modeling, Google Sheets

---

## Other Enhancements

### Anonymization
- Remove "ServiceRocket" from hero, about bio, AI chat context, project narratives
- Replace with "Global SaaS Company" (consistent label throughout)
- Replace exact employee counts / revenue figures with ranges

### Persistence
- `localStorage` key `alex_portfolio_projects` stores user-added projects as JSON
- On load: merge localStorage projects into the projects array before rendering
- Existing 10 projects are hardcoded (not stored in localStorage)
- User-added projects appear under whichever domain the user selects in the Add Project modal; if no domain is selected they appear under a visible "Other" tile appended to the nearest domain card

### API Key Safety
- Remove hardcoded API key pattern from AI chat section
- Add an inline "Configure API Key" input in the AI section header (stores to `localStorage`)
- Show a soft warning banner when no key is set: "Set your Claude API key above to enable the assistant"
- Key is read from `localStorage` at send time, never hardcoded in source

### Mobile Responsiveness
- Domain grid: 2-col on ≥768px, 1-col below
- Project detail modal: full-screen (inset: 0) on mobile, max-width 860px centered on desktop
- Domain cards: tiles stack vertically on narrow screens

---

## Out of Scope
- Backend / server-side proxy for API key (single HTML file constraint)
- PDF export of project cards
- Contact form
- Analytics / tracking
