# Portfolio Recalibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recalibrate the GAS portfolio so a technical recruiter's first impression matches the real work: fix every credibility leak, reposition around workforce analytics, and ship a sanitized live flagship (Demand dashboard on a synthetic demo workbook) plus two deep case studies.

**Architecture:** Three phases against the existing site (`docs/superpowers/gas-portfolio/`): Phase 1 repairs trust (XSS escaper, intent classifier, single project source of truth, dead refs, broken build) gated by new automated leak/claims checks; Phase 2 rewrites hero/projects/Donna around a new Workforce Analytics domain; Phase 3 copies the internal Demand dashboard into `docs/superpowers/gas-portfolio-demos/workforce-demand/`, sanitizes it (fictional brand "Helix Delivery Group"), seeds a synthetic Google Sheets workbook via a checked-in `buildDemoWorkbook()` function, and deploys it as a public GAS web app linked from a flagship card.

**Tech Stack:** Google Apps Script (HtmlService SPA), vanilla ES5 JS, Node (gate scripts + static build), Groq/Llama (Donna), Google Sheets (demo data).

**Spec:** `docs/superpowers/specs/2026-08-03-portfolio-recalibration-design.md` — Section 0 data-protection rules are HARD GATES on every task.

---

## File structure

| Path | Action | Responsibility |
|---|---|---|
| `docs/superpowers/gas-portfolio/tools/leak-gate.js` | Create | Fails on any company token/ID/email in deployable trees |
| `docs/superpowers/gas-portfolio/tools/claims-gate.js` | Create | Fails on unbacked stack claims / stale numbers |
| `docs/superpowers/gas-portfolio/tools/intent-tests.js` | Create | Unit tests for the intent classifier |
| `docs/superpowers/gas-portfolio/JavaScript.html` | Modify | escHtml, retrieveProject, demo tabs, terminal, counters |
| `docs/superpowers/gas-portfolio/Code.js` | Modify | DOMAINS/PROJECTS, detectIntent_, Donna context, delete dead fn |
| `docs/superpowers/gas-portfolio/index.html` | Modify | Hero, capabilities, demos section, contact, claims |
| `docs/superpowers/gas-portfolio/netlify/functions/_lib/intent.js` | Modify | Classifier reorder/tightening |
| `docs/superpowers/gas-portfolio/netlify/functions/_lib/agent-context.js` | Modify | Donna context parity (must mirror Code.js) |
| `docs/superpowers/gas-portfolio/netlify/functions/rpc.js` | Modify | Read ragContext (args[3]) |
| `docs/superpowers/gas-portfolio/build-static.js` | Modify | Code.gs→Code.js, drop deleted asset |
| `docs/superpowers/gas-portfolio/README.md` | Modify | Remove dead link row |
| `docs/superpowers/gas-portfolio-demos/workforce-demand/` | Create | Sanitized copy of the demand app + `DemoData.js` seeder |
| `docs/superpowers/gas-portfolio-demos/screens/compdash_harness.js` | Create | Browser render of CompDash on synthetic payload (screenshots) |

Internal production apps (`docs/superpowers/project-demand-dashboard/`, `CompDash/`, `PS *.js|html`) are **read-only** for this plan.

**Conventions:** run all commands from `D:\Contribution`. Commit after every task; commit **only** the files that task touched (the repo has unrelated dirty files — never `git add -A`).

---

# Phase 1 — Stop the bleeding

### Task 1: Gate scripts (leak-gate + claims-gate)

**Files:**
- Create: `docs/superpowers/gas-portfolio/tools/leak-gate.js`
- Create: `docs/superpowers/gas-portfolio/tools/claims-gate.js`

- [ ] **Step 1: Extract the two Drive asset IDs** referenced by the internal PS dashboard (they go into the token list):

Run: `node -e "const fs=require('fs');const t=fs.readFileSync('PS Dashboard.html','utf8');const lines=t.split('\n');console.log(lines[13]);console.log(lines[1268]);"`
Expected: two lines each containing a long Drive file ID — copy both IDs into `EXACT_TOKENS` below.

- [ ] **Step 2: Write `docs/superpowers/gas-portfolio/tools/leak-gate.js`**

```js
// leak-gate.js — HARD deploy gate (spec §0.5). Scans deployable trees for
// company data. Any hit = exit 1 = no deploy. Run: node tools/leak-gate.js
var fs = require("fs"), path = require("path");

var ROOTS = [
  path.join(__dirname, ".."),                                   // gas-portfolio
  path.join(__dirname, "..", "..", "gas-portfolio-demos"),      // demos (may not exist yet)
];
var SKIP_DIRS = /node_modules|\.git|^tools$/;
var TEXT_EXT = /\.(html|js|gs|json|md|toml|sql|css|txt|yml|yaml)$/i;

// Case-insensitive substrings — live production identifiers. NEVER shorten this list.
var EXACT_TOKENS = [
  "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",   // Roster SS
  "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",   // Tempo plan SS
  "1v5s0Ogka8nrxfT8u71BwG9KidwhD32TjzV_miKad5HQ",   // PS goals SS
  "1J_5EhrQqMMjUFH1Zm_Wpcbd47OFDlcKsdoGm-haS8Yo",   // PS PTO SS
  "1I_JeFU3mcF0wYrENUT-9tqGAgSHymLAdlOb8l0MASpU",   // CompDash SS
  "1juJwP9RLCYoaz3-ONYR8HvaHG9fp5a5AIEMCuouNlx0",   // CompDash SS 2
  "DRIVE_ID_1_FROM_STEP_1",                          // ← replace (logo asset)
  "DRIVE_ID_2_FROM_STEP_1",                          // ← replace (embed asset)
  "moises.lopez@servicerocket.com",
  "gonzalo.riquelme", "william.mock", "robert.castaneda",
  "rocketeers.atlassian", "atlassian.net", "customfield_",
  "script.google.com/a/",                            // domain-bound deployment URLs
  "PEOPLE-38", "GTT-",
];
var WORD_TOKENS = [/\brocketeers?\b/i, /\borbe\b/i, /\bSRSO\b/i];
// "servicerocket" is allowed ONLY as Donna's employer-history bio lines (spec §0.4),
// capped at the counts ratified 2026.W29. Keyed by path SUFFIX so the demo
// folder's Code.js can never inherit the allowance.
var BRAND_ALLOWANCE = [
  { suffix: "gas-portfolio/Code.js", max: 4 },
  { suffix: "_lib/agent-context.js", max: 4 },
];

var hits = 0;
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(function (name) {
    if (SKIP_DIRS.test(name)) return;
    var p = path.join(dir, name);
    var st = fs.statSync(p);
    if (st.isDirectory()) return scan(p);
    if (!TEXT_EXT.test(name)) return;
    var body = fs.readFileSync(p, "utf8"), low = body.toLowerCase();
    EXACT_TOKENS.forEach(function (t) {
      if (low.indexOf(t.toLowerCase()) !== -1) { hits++; console.log("LEAK  " + p + "  → " + t); }
    });
    WORD_TOKENS.forEach(function (re) {
      var m = body.match(new RegExp(re.source, re.flags.replace("i", "gi")));
      if (m) { hits++; console.log("LEAK  " + p + "  → " + re + " ×" + m.length); }
    });
    var brand = (low.match(/servicerocket/g) || []).length;
    var posix = p.replace(/\\/g, "/");
    var rule = BRAND_ALLOWANCE.filter(function (r) { return posix.slice(-r.suffix.length) === r.suffix; })[0];
    var allowed = rule ? rule.max : 0;
    if (brand > allowed) { hits++; console.log("LEAK  " + p + "  → servicerocket ×" + brand + " (allowed " + allowed + ")"); }
  });
}
ROOTS.forEach(scan);
console.log(hits ? "❌ leak-gate: " + hits + " hit(s) — DO NOT DEPLOY" : "✅ leak-gate: clean");
process.exit(hits ? 1 : 0);
```

- [ ] **Step 3: Write `docs/superpowers/gas-portfolio/tools/claims-gate.js`**

```js
// claims-gate.js — no stack claim without a code path behind it (spec §1 truth sweep),
// and no stale/contradictory numbers. Run: node tools/claims-gate.js
var fs = require("fs"), path = require("path");
var FILES = ["index.html", "JavaScript.html", "Code.js",
  "netlify/functions/_lib/agent-context.js", "README.md"];
var BANNED = [
  "GPT-4", "Embeddings", "Claude API", "with RAG",
  "11 production apps", "312 contributors", "9 LLM systems",
  "ai-salary-benchmarking", "ps-contribution-dashboard", "'ps-dashboard'",
  "7571-9264",
];
var hits = 0;
FILES.forEach(function (f) {
  var p = path.join(__dirname, "..", f);
  if (!fs.existsSync(p)) return;
  var body = fs.readFileSync(p, "utf8");
  BANNED.forEach(function (t) {
    if (body.indexOf(t) !== -1) { hits++; console.log("CLAIM " + f + "  → " + t); }
  });
});
console.log(hits ? "❌ claims-gate: " + hits + " unbacked claim(s)" : "✅ claims-gate: clean");
process.exit(hits ? 1 : 0);
```

- [ ] **Step 4: Run both — leak-gate must PASS now; claims-gate must FAIL (it goes green at the end of Phase 2)**

Run: `node docs/superpowers/gas-portfolio/tools/leak-gate.js`
Expected: `✅ leak-gate: clean`. If it reports hits inside gas-portfolio, those are real leaks — fix them in this task (replace/remove the token) before committing.

Run: `node docs/superpowers/gas-portfolio/tools/claims-gate.js`
Expected: FAIL listing GPT-4, Embeddings, Claude API, with RAG, 11 production apps, 312 contributors, 9 LLM systems, ai-salary-benchmarking, ps-dashboard, 7571-9264. This is the phase's failing test.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/gas-portfolio/tools/leak-gate.js" "docs/superpowers/gas-portfolio/tools/claims-gate.js"
git commit -m "portfolio: add leak-gate + claims-gate deploy gates"
```

### Task 2: Fix escHtml (missing `>` escape)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:9-15`

- [ ] **Step 1: Verify the bug**

Run: `node -e "var s=require('fs').readFileSync('docs/superpowers/gas-portfolio/JavaScript.html','utf8'); process.exit(/\.replace\(\/>\/g, '&gt;'\)/.test(s)?0:1)" && echo PRESENT || echo MISSING`
Expected: `MISSING`

- [ ] **Step 2: Fix.** In `JavaScript.html` replace:

```js
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')

    .replace(/"/g, '&quot;');
}
```

with:

```js
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

- [ ] **Step 3: Re-run the Step 1 command** — Expected: `PRESENT`

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html"
git commit -m "portfolio: escHtml escapes '>' (XSS hardening on LLM-rendered output)"
```

### Task 3: Intent classifier — recruiters get answers, not brush-offs

**Files:**
- Create: `docs/superpowers/gas-portfolio/tools/intent-tests.js`
- Modify: `docs/superpowers/gas-portfolio/netlify/functions/_lib/intent.js`
- Modify: `docs/superpowers/gas-portfolio/Code.js:1109-1165` (`detectIntent_`)

Design (spec §4.2): portfolio signals are checked **first**; the meeting/offer lists lose every overbroad token (`role`, `team`, `company`, `remote`, `startup`, `time`, `chat`, `call`, `connect`, `available`, `joining`). Salary/comp words stay in offer signals — Donna must still route those to Alex.

- [ ] **Step 1: Write the failing tests** — `docs/superpowers/gas-portfolio/tools/intent-tests.js`:

```js
// intent-tests.js — recruiter-style questions must never be brushed off.
var detectIntent = require("../netlify/functions/_lib/intent.js").detectIntent;
var CASES = [
  ["What was your role on that team?",                 ["portfolio_question", "general"]],
  ["Which company was this project at?",               ["portfolio_question", "general"]],
  ["Walk me through the TCC forecasting approach",     ["portfolio_question"]],
  ["What's Alex's experience with AI and LLMs?",       ["portfolio_question"]],
  ["Tell me about the workforce dashboards",           ["portfolio_question"]],
  ["How did you build the demand dashboard?",          ["portfolio_question"]],
  ["Is Alex open to remote work?",                     ["portfolio_question", "general"]],
  ["We're hiring for a senior data engineer position", ["job_offer"]],
  ["What are your salary expectations?",               ["job_offer"]],
  ["I'd like to discuss a job opportunity",            ["job_offer"]],
  ["Can we schedule a meeting next week?",             ["meeting_request"]],
  ["What's your availability for a Zoom?",             ["meeting_request"]],
];
var fails = 0;
CASES.forEach(function (c) {
  var got = detectIntent(c[0]);
  if (c[1].indexOf(got) === -1) { fails++; console.log("❌ \"" + c[0] + "\" → " + got + " (wanted " + c[1].join("|") + ")"); }
});
console.log(fails ? fails + " failed" : "✅ intent-tests: all passed");
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node docs/superpowers/gas-portfolio/tools/intent-tests.js`
Expected: FAIL — at least "What was your role on that team?" → job_offer.

- [ ] **Step 3: Rewrite `netlify/functions/_lib/intent.js`** (full new file):

```js
// Intent classifier — kept in sync with detectIntent_() in Code.js.
// Portfolio questions are checked FIRST: a recruiter asking about the work must
// get an answer, never a brush-off. Offer/meeting lists carry only unambiguous
// tokens; salary/comp words stay so Donna still routes those to Alex.
// Returns 'meeting_request' | 'job_offer' | 'portfolio_question' | 'general'.

function detectIntent(userMessage) {
  var msg = String(userMessage || "").toLowerCase();

  var portfolioSignals = [
    "project", "built", "build", "demo", "stack", "tech", "experience", "skill",
    "impact", "achieve", "dashboard", "api", "python", "sql", "apps script",
    "gemini", "llm", "pipeline", "forecast", "workforce", "capacity", "approach",
  ];
  if (portfolioSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "portfolio_question";

  var meetingSignals = [
    "schedule", "calendar", "meeting", "zoom", "google meet",
    "availability", "book a", "book time", "slot",
  ];
  if (meetingSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "meeting_request";

  var offerSignals = [
    "hiring", "position", "opportunity", "job", "opening", "recruit", "talent",
    "salary", "compensation", "pay", "package", "offer",
    "we're looking", "we are looking", "reach out",
  ];
  if (offerSignals.some(function (s) { return msg.indexOf(s) !== -1; }))
    return "job_offer";

  return "general";
}

module.exports = { detectIntent };
```

- [ ] **Step 4: Run tests** — `node docs/superpowers/gas-portfolio/tools/intent-tests.js` — Expected: `✅ intent-tests: all passed`

- [ ] **Step 5: Mirror in `Code.js` `detectIntent_`** (line ~1109). Keep the existing `demoSignals` block FIRST exactly as-is (demo requests are the most specific), then replace the meeting/offer/portfolio blocks so the order after `demoSignals` is: portfolio → meeting → offer, with the same three lists as Step 3. The GAS version returns the same four strings plus `demo_request`.

- [ ] **Step 6: Eyeball parity** — the three lists in `Code.js` and `intent.js` must be identical strings. Then commit:

```bash
git add "docs/superpowers/gas-portfolio/tools/intent-tests.js" "docs/superpowers/gas-portfolio/netlify/functions/_lib/intent.js" "docs/superpowers/gas-portfolio/Code.js"
git commit -m "portfolio: intent classifier answers recruiters first, routes only real offer/meeting asks"
```

### Task 4: One project database (kill the three contradictory copies)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:668-694` (client `PROJECT_DATABASE` + `retrieveProject`)
- Modify: `docs/superpowers/gas-portfolio/Code.js:1030-1105` (delete dead `retrieveProjectContext`)

- [ ] **Step 1: Confirm `retrieveProjectContext` is dead code**

Run: `grep -rn "retrieveProjectContext" "docs/superpowers/gas-portfolio"`
Expected: exactly one hit — its own definition at `Code.js:1030`. (If more appear, stop and update callers first.)

- [ ] **Step 2: Delete** the whole `function retrieveProjectContext(query) { … }` block from `Code.js` (from line 1030 to its closing brace, ~75 lines — it contains the phantom "23%"/"$2.1M" metrics).

- [ ] **Step 3: Replace the client database with a `PROJECTS` derivation.** In `JavaScript.html`, delete the entire `var PROJECT_DATABASE = { … };` literal (lines 668–681) and replace `retrieveProject` (683–694) with:

```js
  // Grounding retrieval — single source of truth is window.PROJECTS (injected by
  // the server / baked by build-static). No parallel copies, no invented metrics.
  function retrieveProject(query) {
    var q = query.toLowerCase();
    var all = window.PROJECTS || [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var hay = [p.id.replace(/-/g, ' '), p.title, p.category || '', (p.tech || []).join(' ')]
        .join(' ').toLowerCase();
      var words = p.title.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 4; });
      var titleHit = words.some(function (w) { return q.indexOf(w) !== -1; });
      if (titleHit || q.indexOf(p.id.replace(/-/g, ' ')) !== -1 ||
          (p.category && q.indexOf(p.category.toLowerCase()) !== -1)) {
        return { id: p.id, data: { name: p.title, domain: p.category || p.domain,
          tech: (p.tech || []).slice(0, 4), impact: p.impact || '' } };
      }
      void hay;
    }
    return null;
  }
```

- [ ] **Step 4: Smoke-check in Node** (PROJECTS lookup logic only):

Run: `node -e "global.window={PROJECTS:[{id:'ai-sales',title:'AI Sales Analytics Ecosystem',category:'AI · Sales Analytics',tech:['HubSpot'],impact:'10h/week'}]}; eval(require('fs').readFileSync('docs/superpowers/gas-portfolio/JavaScript.html','utf8').match(/function retrieveProject[\s\S]*?\n  \}/)[0]); console.log(JSON.stringify(retrieveProject('tell me about the sales analytics ecosystem')));"`
Expected: JSON with `"id":"ai-sales"`.

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/Code.js"
git commit -m "portfolio: PROJECTS is the only project database — stale RAG copies deleted"
```

### Task 5: Contact — phone + salary field

**Files:**
- Modify: `docs/superpowers/gas-portfolio/Code.js:706`
- Modify: `docs/superpowers/gas-portfolio/netlify/functions/_lib/agent-context.js:63`
- Modify: `docs/superpowers/gas-portfolio/index.html:2494`

- [ ] **Step 1:** Delete the line `"Phone:      +1 (503) 7571-9264",` from **both** `Code.js` and `agent-context.js` (the number is mangled — El Salvador +503 formatted as a fake US number; email + LinkedIn remain).

- [ ] **Step 2:** In `index.html:2494`, replace the Gmail-compose `href` with one whose body has no salary field (Donna's no-salary rule must not be contradicted by our own template):

```
https://mail.google.com/mail/?view=cm&amp;fs=1&amp;to=moisesalex.01@gmail.com&amp;su=Opportunity%20for%20Alex%20L%C3%B3pez&amp;body=Hi%20Alex%2C%0D%0A%0D%0AI%20came%20across%20your%20portfolio%20and%20would%20like%20to%20discuss%20a%20role.%0D%0A%0D%0A-%20Role%20%2F%20Title%3A%0D%0A-%20Company%3A%0D%0A-%20Work%20arrangement%20(remote%20%2F%20hybrid%20%2F%20onsite)%3A%0D%0A-%20Timeline%3A%0D%0A%0D%0AThanks!
```

- [ ] **Step 3:** Run `node docs/superpowers/gas-portfolio/tools/claims-gate.js` — the `7571-9264` line must no longer appear among the hits.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio/Code.js" "docs/superpowers/gas-portfolio/netlify/functions/_lib/agent-context.js" "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: drop mangled phone + salary-range mailto field"
```

### Task 6: Dead references

**Files:**
- Modify: `docs/superpowers/gas-portfolio/README.md:20`
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:2342-2347` (ScrollNudge HINTS), `:1991` (stale comment)

- [ ] **Step 1:** Delete README.md line 20 (the `[ai-salary-benchmarking](./projects/ai-salary-benchmarking)` table row — the directory no longer exists).

- [ ] **Step 2:** In `ScrollNudge` `HINTS`, replace `'demos': 'How does the Pipeline Risk Analyzer work?'` with `'demos': 'Which demo should I try first?'` (the name "Pipeline Risk Analyzer" existed only in the deleted RAG table; Task 19 sets the final flagship-aware hint).

- [ ] **Step 3:** In `DemosSection.init` replace the comment `// Mount the default tab (Ops / ps-dashboard, marked .active in the markup)` with `// Mount the default tab (the button marked .active in the markup)`.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio/README.md" "docs/superpowers/gas-portfolio/JavaScript.html"
git commit -m "portfolio: remove references to deleted projects/demos"
```

### Task 7: Repair the static build + Netlify RAG parity

**Files:**
- Modify: `docs/superpowers/gas-portfolio/build-static.js:25,77`
- Modify: `docs/superpowers/gas-portfolio/netlify/functions/rpc.js:81-102`

- [ ] **Step 1: Verify the build is broken**

Run: `cd docs/superpowers/gas-portfolio && node build-static.js`
Expected: `ENOENT … Code.gs`

- [ ] **Step 2:** In `build-static.js` line 25 change `read("Code.gs")` → `read("Code.js")` (and line 34's `filename: "Code.gs"` → `"Code.js"`). Delete the `["_shot_hero.png"].forEach(…)` block (lines 76–80) — the asset was removed.

- [ ] **Step 3:** In `rpc.js` `proxyGroqChat`, after `var sessionId = String(args[2] || "anon");` add:

```js
  var ragContext = args[3] || null;
```

and after the `var messages = [{ role: "system", content: systemPrompt }];` line insert (mirrors `Code.js:1394-1402`):

```js
  if (ragContext) {
    messages.push({
      role: "system",
      content: "[RETRIEVED PROJECT CONTEXT]\n" + JSON.stringify(ragContext, null, 2) +
        "\n\nUse this context to answer the user's question. If they asked about a specific " +
        "demo, you can suggest they try it live by saying something like: 'You can try this " +
        "live in the demos section above' or include a [DEMO:demoId] tag in your response."
    });
  }
```

- [ ] **Step 4: Run the build**

Run: `cd docs/superpowers/gas-portfolio && node build-static.js`
Expected: `[build] dist/index.html written — 12 projects, 4 domains baked in.` (counts will grow in Phase 2).

- [ ] **Step 5: Commit**

```bash
git add "docs/superpowers/gas-portfolio/build-static.js" "docs/superpowers/gas-portfolio/netlify/functions/rpc.js"
git commit -m "portfolio: fix static build (Code.js) + rpc reads ragContext — grounding works on Netlify"
```

### Task 8: Truthful stack claims

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html:2288-2293, 2389-2397, 2439`

- [ ] **Step 1: AI capability card tags** (`index.html:2288-2293`) — replace:

```html
          <span class="cap-tag">RAG</span>
          <span class="cap-tag">GPT-4</span>
          <span class="cap-tag">Embeddings</span>
          <span class="cap-tag">Groq</span>
```

with (every tag has a code path or case study behind it):

```html
          <span class="cap-tag">Grounded agents</span>
          <span class="cap-tag">Groq · Llama 3.3</span>
          <span class="cap-tag">Gemini API</span>
          <span class="cap-tag">Prompt guardrails</span>
```

- [ ] **Step 2: About tag** (`index.html:2439`) — change `<span class="about-tag">Claude API</span>` → `<span class="about-tag">Gemini API</span>`. (Keep `Claude Code · MCP` at 2442 — it's true tooling.)

- [ ] **Step 3: RAG pill → Grounded** (`index.html:2389-2391`): change the indicator `title` to `"Grounded: answers come from Alex's real project data"` and `<span class="rag-label">RAG</span>` → `<span class="rag-label">Grounded</span>`.

- [ ] **Step 4: Greeting** (`index.html:2397`): replace `powered by <strong>Llama 3.3 with RAG</strong>` with `powered by <strong>Llama 3.3, grounded in his real project data</strong>`.

- [ ] **Step 5:** Run `node docs/superpowers/gas-portfolio/tools/claims-gate.js` — remaining hits must ONLY be the terminal/rotator numbers (`11 production apps`, `312 contributors`, `9 LLM systems`) which Phase 2 Task 12 removes.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: every stack claim now has a code path behind it"
```

---

# Phase 2 — Reposition around workforce analytics

### Task 9: New Workforce Analytics domain + three flagship PROJECTS entries

**Files:**
- Modify: `docs/superpowers/gas-portfolio/Code.js:13-44` (DOMAINS) and the top of `PROJECTS`

- [ ] **Step 1:** Insert as the FIRST element of `DOMAINS`:

```js
  {
    id: "workforce",
    label: "Workforce Analytics",
    icon: "📈",
    tagline: "Resourcing, comp health & contribution — decision-grade",
    color: "teal",
  },
```

- [ ] **Step 2:** Insert the three entries below as the FIRST elements of `PROJECTS` (spec §0: solution/approach language, engineering facts only, no internal metrics; org size stays approximate):

```js
  {
    id: "workforce-demand",
    domain: "workforce",
    title: "Project Demand — C-Suite Resourcing Dashboard",
    tagline: "Weekly demand vs true available capacity — holiday-aware, statistically honest",
    category: "Workforce Analytics · Resourcing",
    impact: "Live demo",
    langScale: "~8K lines",
    liveUrl: "",   // filled by the Phase 3 deploy task
    context:
      "Leadership's Monday question is simple: are we over- or under-staffed next month, and what changed since last week? Answering it honestly needs a real capacity denominator — not headcount × 40.",
    action: [
      "Modeled **available capacity** per person-week: regional base hours (38/40), net of PTO **and** public holidays, with double-count protection when time off is booked over a holiday.",
      "Put a **±2σ statistical control band** on utilization and a 90% planning-target line — honesty instead of a trendline; every tile ends in a written *so-what* sentence.",
      "Engineered the load path: gzip + chunked CacheService entries kept warm by a trigger — **~30s cold compute → ~2s warm**, with graceful degradation when any source is missing.",
      "Zero runtime JS dependencies: 25 hand-rolled SVG chart panels, question-filter chips, a week-paged heatmap, and a formula-injection-safe CSV export.",
    ],
    resolution:
      "A live, clickable demo of the real app — synthetic data, fictional company. The same architecture runs in production for a global professional-services org.",
    tech: [
      "Google Apps Script",
      "HtmlService SPA",
      "CacheService (gzip + chunked)",
      "Statistical process control",
      "Hand-rolled SVG charts",
      "ISO-week engine",
    ],
    metrics: [
      { val: "30s→2s", label: "cold → warm load" },
      { val: "±2σ", label: "control band" },
      { val: "0", label: "JS dependencies" },
    ],
    before: {
      process: "Resourcing debates ran on anecdote and a static spreadsheet nobody trusted",
      metrics: "No capacity denominator · no week-over-week visibility",
    },
    after: {
      process: "One page: demand vs true available capacity, WoW, with so-what verdicts",
      metrics: "±2σ honesty · ~2s warm loads · holiday-aware",
    },
  },
  {
    id: "comp-health",
    domain: "workforce",
    title: "Global Comp Health Dashboard",
    tagline: "Who should the next comp cycle look at first — defensible, tested, redacted",
    category: "Workforce Analytics · Compensation",
    impact: "242 tests",
    langScale: "12 views",
    context:
      "Compensation review across countries and currencies fails in predictable ways: bad peer comparisons, scores quietly fabricated from missing data, and sensitive rows 'hidden' only by CSS. This tool was built to fail in none of them.",
    action: [
      "Built a **4-tier anchor-resolution model** (title peers → market row → level cohort → *excluded*): a person with no sound comparison is excluded and the coverage number is a headline, never a footnote.",
      "Priority scoring **renormalizes over the data that exists** per person, carrying partial/missing flags all the way to the UI — a number is never silently invented.",
      "**Server-side redaction**: restricted profiles are stripped from the payload before it leaves the server — open devtools and there is nothing to unhide.",
      "**242 automated assertions** plus a render smoke harness that executes all 12 view renderers against a synthetic payload — in a Google Apps Script project.",
      "Pay-equity lenses (gender gap, individual outliers, long-tenure drift) with small-group suppression; statistical honesty rules (small-n → counts, not rates).",
    ],
    resolution:
      "Quarterly comp triage runs on evidence: ranked focus lists, provable privacy, and a test suite most SaaS dashboards don't have.",
    tech: [
      "Google Apps Script",
      "Node test harness (242 assertions)",
      "Server-side RBAC + redaction",
      "CacheService (gzip + chunked)",
      "Hand-rolled SVG charts",
    ],
    metrics: [
      { val: "242", label: "test assertions" },
      { val: "12", label: "views" },
      { val: "4-tier", label: "anchor model" },
    ],
    before: {
      process: "Spreadsheet passes and gut feel; sensitive rows hidden client-side at best",
      metrics: "Unverifiable scores · privacy by CSS",
    },
    after: {
      process: "Anchored comparisons, renormalized scores, server-redacted payloads",
      metrics: "242 assertions green · coverage as a headline",
    },
  },
  {
    id: "ps-contribution",
    domain: "workforce",
    title: "PS Weekly Contribution Report",
    tagline: "Seven metrics, one Monday picture — with an AI exec brief that writes itself",
    category: "Workforce Analytics · Performance",
    impact: "30s→2s loads",
    langScale: "~15K lines",
    context:
      "A services leader needs one Monday view of a ~200-person org: who's on track, who needs support, and what to say in the leadership meeting — across goals, tracked/planned time, recognition, PTO and quality signals.",
    action: [
      "Diagnosed CacheService's **silent >100KB failure** (every load was a cold multi-minute compute) and fixed it with gzip (~10×) + 90KB chunked entries — **~30s → ~2s**, warmed by a trigger.",
      "Built a **team-aligned scoring matrix** ('team gates, family tunes'): nobody is ever scored on a metric their role doesn't own, enforced by a hard mask on every resolution path.",
      "**4-role access model** (admin/viewer/manager/denied) where manager scope resolves automatically from the roster's supervisor column — checked *before* the open-access fallback so a demo flag can never over-share.",
      "**Gemini-written executive brief** with prompt allowlisting and five distinct handled failure modes (missing key, API error, block reason, empty text, token truncation).",
      "Adaptive Team Radar: axis count follows the grouping level — more context earns more dimensions.",
    ],
    resolution:
      "Leadership opens it every Monday. The engineering underneath — caching, RBAC, LLM guardrails, unit-tested fiscal calendar — is the portfolio's deepest case study.",
    tech: [
      "Google Apps Script",
      "Chart.js",
      "Gemini API (guardrailed)",
      "CacheService (gzip + chunked)",
      "RBAC (roster-scoped managers)",
      "Unit-tested ISO fiscal engine",
    ],
    metrics: [
      { val: "7", label: "metrics per person" },
      { val: "30s→2s", label: "cache story" },
      { val: "4-role", label: "access model" },
    ],
    before: {
      process: "Manual weekly consolidation; slow loads; one-size-fits-all scoring",
      metrics: "Multi-minute loads · unscoped access",
    },
    after: {
      process: "Cached, role-scoped dashboard with an AI brief and fair per-team scoring",
      metrics: "~2s loads · masked scoring invariant · 5 LLM failure modes handled",
    },
  },
```

- [ ] **Step 3: Verify the data still extracts** — `cd docs/superpowers/gas-portfolio && node build-static.js`
Expected: `… 15 projects, 5 domains baked in.`

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio/Code.js"
git commit -m "portfolio: Workforce Analytics domain first + 3 flagship case-study entries"
```

### Task 10: ProjectModal `liveUrl` button

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (modal template — locate `id="pm-github-btn"`)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:258-272`

- [ ] **Step 1:** In `index.html`, find the element `id="pm-github-btn"` and add a sibling `<div id="pm-live-btn"></div>` immediately BEFORE it.

- [ ] **Step 2:** In `JavaScript.html` `ProjectModal.open`, immediately before the `var githubWrap = document.getElementById('pm-github-btn');` line, add:

```js
    var liveWrap = document.getElementById('pm-live-btn');
    if (liveWrap) {
      liveWrap.innerHTML = p.liveUrl
        ? '<a class="pm-github-link pm-live-link" href="' + escHtml(p.liveUrl) +
          '" target="_blank" rel="noopener" aria-label="Open the live demo">▶ Open the live demo →</a>'
        : '';
    }
```

- [ ] **Step 3:** Rebuild: `cd docs/superpowers/gas-portfolio && node build-static.js` → success, then open `dist/index.html` in a browser, click the "Project Demand" tile: modal opens, no live button yet (liveUrl empty), no console errors.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio/index.html" "docs/superpowers/gas-portfolio/JavaScript.html"
git commit -m "portfolio: project modal supports liveUrl demo button"
```

### Task 11: Hero rewrite (headline, sub, metrics, nav brand)

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html:2171, 2204-2235`

- [ ] **Step 1: Measure the true line count** (feeds the B1 cell):

```powershell
(Get-Content "docs/superpowers/project-demand-dashboard/Code.js","docs/superpowers/project-demand-dashboard/Dashboard.html","docs/superpowers/project-demand-dashboard/Security.js","CompDash/Code.js","CompDash/ViewDash.html","CompDash/Security.js","PS Contribution Report.js","PS Dashboard.html","PS Security.js" | Measure-Object -Line).Lines
```
Expected: ~28,000+. Round DOWN to the nearest thousand for the claim (e.g. 28 → "28K+").

- [ ] **Step 2:** Nav brand (`index.html:2171`): `alex.lópez · data strategist` → `alex.lópez · workforce analytics`.

- [ ] **Step 3:** Replace the h1 + sub (`index.html:2204-2208`):

```html
    <h1>I build the <em>workforce analytics</em><br>that leadership<br>actually opens.</h1>
    <p class="hero-sub">
      Resourcing demand, compensation health, contribution scoring — three production
      dashboards a C-suite reads every week, with AI woven through: grounded assistants,
      LLM-written exec briefs, and caches engineered from 30-second loads down to 2.
    </p>
```

- [ ] **Step 4:** Replace the four `cr-cell` blocks + footnote (`index.html:2216-2235`) with true numbers (use the Step 1 measurement in B1):

```html
      <div class="cr-cell">
        <span class="cr-v"><span class="counter" data-target="15" data-stat="projects">0</span></span>
        <span class="cr-l">Production Projects</span>
      </div>
      <div class="cr-cell">
        <span class="cr-v"><span class="counter" data-target="28">0</span>K+</span>
        <span class="cr-l">Lines · 3 Prod Dashboards</span>
      </div>
      <div class="cr-cell">
        <span class="cr-v"><span class="counter" data-target="250">0</span>+</span>
        <span class="cr-l">Automated Tests</span>
      </div>
      <div class="cr-cell selected">
        <span class="cr-v" aria-describedby="auto-stat-note"><span class="counter" data-target="5">0</span>+<sup class="cr-footnote-mark" aria-hidden="true">†</sup></span>
        <span class="cr-l">Yrs Data &amp; WFM</span>
      </div>
    </div>
    <p class="cell-range-note" id="auto-stat-note" role="note">
      <span class="cr-footnote-mark" aria-hidden="true">†</span> Lines/tests measured across the three workforce dashboards (demand, comp health, contribution) and their suites; 5+ years across contact-center WFM and data analytics.
    </p>
```

- [ ] **Step 5:** Commit:

```bash
git add "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: workforce-first hero with measured, defensible numbers"
```

### Task 12: Terminal, PROOF rotator, dynamic counts

**Files:**
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:2556-2570` (LINES/ROTATE), UI init (~line 2005)
- Modify: `docs/superpowers/gas-portfolio/index.html:2251, 2256, 2329`

- [ ] **Step 1:** Terminal window name (`index.html:2251`): `weekly-contribution · pipeline` → `demand-dashboard · weekly review`. Initial rotator text (`index.html:2256`): `11 production apps shipped` → `3 dashboards a C-suite opens weekly`.

- [ ] **Step 2:** Replace `LINES` and `ROTATE` in `JavaScript.html:2556-2570` (every line true of the flagship demo one scroll below):

```js
  var LINES = [
    { cmd: 'alex run demand-dashboard --week current' },
    { out: '<span class="c-arrow">→</span> reading planned · tracked · roster <span class="c-dim">…</span> <span class="c-ok">ok</span>' },
    { out: '<span class="c-arrow">→</span> capacity = base − PTO − public holidays <span class="c-dim">3 regions</span>' },
    { out: '<span class="c-arrow">→</span> ±2σ control band <span class="c-dim">8-week sample</span>' },
    { out: '<span class="c-arrow">→</span> 6 chart panels · every tile ends in a so-what <span class="c-ok">done</span>' },
    { out: '<span class="c-ok">✓</span> served warm in ~2s <span class="c-dim">(cold compute ~30s, gzip-chunked cache)</span>' },
    { out: '<span class="c-dim">  try it live in the demos section below</span>' }
  ];
  var ROTATE = [
    '3 dashboards a C-suite opens weekly',
    '250+ automated tests across the suite',
    'gzip-chunked caching: 30s → 2s',
    '4-role access · roster-scoped managers'
  ];
```

- [ ] **Step 3: Dynamic counts.** In `UI` module's init (the function that calls `initCounters`), BEFORE counters start, add:

```js
    // Counts derive from PROJECTS/DOMAINS — hand-typed numbers can't drift again.
    var pc = document.querySelector('.counter[data-stat="projects"]');
    if (pc && window.PROJECTS) pc.setAttribute('data-target', String(window.PROJECTS.length));
    var ph = document.querySelector('#projects .section-title');
    if (ph && window.PROJECTS && window.DOMAINS) {
      ph.innerHTML = window.PROJECTS.length + ' projects. ' + window.DOMAINS.length + ' domains.<br>Real impact.';
    }
```

(`index.html:2329`'s static "12 projects. 4 domains." remains as the no-JS fallback text — update it to `15 projects. 5 domains.<br>Real impact.` anyway.)

- [ ] **Step 4:** Run `node docs/superpowers/gas-portfolio/tools/claims-gate.js` — Expected: the ONLY remaining hits are `'ps-dashboard'` occurrences (the demo-tab key, removed in Task 14). Everything numeric/stack-related must be gone.

- [ ] **Step 5:** Rebuild + eyeball `dist/index.html`: terminal types the demand run; counters show 15 / 28K+ / 250+ / 5+.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: truthful hero terminal + self-deriving counts — claims-gate green"
```

### Task 13: Capabilities section — workforce card first

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html:2275-2321`

- [ ] **Step 1:** Reorder the three `capability-card` divs to: Workforce Analytics, AI/LLM Integration, Financial Forecasting. Replace the Workforce card's desc/tags with:

```html
        <p class="capability-desc">
          Resourcing demand vs true capacity, comp health with provable privacy, and
          contribution scoring — three dashboards leadership actually opens, every week.
        </p>
        <div class="capability-tags">
          <span class="cap-tag">Capacity modeling</span>
          <span class="cap-tag">SPC (±2σ)</span>
          <span class="cap-tag">RBAC + redaction</span>
          <span class="cap-tag">5 yrs WFM</span>
        </div>
```

- [ ] **Step 2:** Update the section desc (`index.html:2276-2279`) to lead with workforce:

```html
      I lead with workforce analytics — resourcing, compensation, contribution — and bridge
      AI/LLM engineering and financial forecasting into systems leadership relies on weekly.
```

- [ ] **Step 3:** Rebuild, eyeball, commit:

```bash
git add "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: capabilities lead with workforce analytics"
```

### Task 14: Demo bar — two AI simulators, honest copy

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html:537-540, 2344-2354`
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html:698-715 (triggers), 1951-1956 (DEMOS), 1994 (fallback)`

Keep `DealRiskDemo` (real Groq call) + `ContribScoreDemo` (real LLM exec brief) as tabs; `TccDemo`/`CompNormalizerDemo` stay in `DEMOS` so their project modals still mount them, but lose their tabs. Rename key `ps-dashboard` → `team-scoring` (dead project id).

- [ ] **Step 1:** `index.html:2348-2351` — replace the four tab buttons with two:

```html
      <button class="demo-tab active" data-demo="ai-sales"     role="tab" aria-selected="true"  data-formula="=RISK(DealAge, Amount, Signal) → P(close) × Weighted_value">Pipeline Risk · Groq AI</button>
      <button class="demo-tab"        data-demo="team-scoring" role="tab" aria-selected="false" data-formula="=WEIGHTED(Alignment×0.30 + Performance×0.35 + Health×0.20 + Recognition×0.15)">Team Scoring · LLM brief</button>
```

- [ ] **Step 2:** CSS (`index.html:537-540`): delete the `tcc-forecast` and `comp-reporting` active-tab rules; change the `ps-dashboard` selector to `[data-demo="team-scoring"]`.

- [ ] **Step 3:** Section copy (`index.html:2345`): replace "Four working simulators built from real projects. Synthetic data — everything runs in your browser." with `Two AI-powered simulators — synthetic data in the browser, real LLM calls on the server.` (Task 19 adds the flagship card above them.)

- [ ] **Step 4:** `JavaScript.html` — `DEMOS` registry becomes:

```js
var DEMOS = {
  'ai-sales':       DealRiskDemo,
  'team-scoring':   ContribScoreDemo,
  'tcc-forecast':   TccDemo,          // modal-only (project tile still mounts it)
  'comp-reporting': CompNormalizerDemo // modal-only
};
```

`DemosSection.init` fallback `mount(… : 'ps-dashboard')` → `'ai-sales'`. `checkDemoTrigger` triggers object becomes:

```js
    var triggers = {
      'ai-sales':     ['pipeline', 'risk', 'deal', 'sales forecast', 'close probability'],
      'team-scoring': ['contribution', 'scorer', 'team scoring', 'team metrics', 'leaderboard']
    };
```

- [ ] **Step 5:** Grep check: `grep -n "ps-dashboard" "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html"` → Expected: no hits. Then `node docs/superpowers/gas-portfolio/tools/claims-gate.js` → Expected: `✅ claims-gate: clean` (the Phase-1 failing test finally goes green here). Rebuild + click both tabs in `dist/index.html`.

- [ ] **Step 6: Commit**

```bash
git add "docs/superpowers/gas-portfolio/index.html" "docs/superpowers/gas-portfolio/JavaScript.html"
git commit -m "portfolio: demo bar = two AI simulators; slider toys fold into their project modals"
```

### Task 15: Donna knows the flagship trio

**Files:**
- Modify: `docs/superpowers/gas-portfolio/Code.js` (`buildAgentContext_`, ~line 650+)
- Modify: `docs/superpowers/gas-portfolio/netlify/functions/_lib/agent-context.js` (must stay in sync — same text)
- Modify: `docs/superpowers/gas-portfolio/index.html` (suggestion pills near `#chat-section`)

- [ ] **Step 1:** In BOTH context files, locate the projects/work-history section of the prompt string array (search for the first line mentioning a project name) and insert this block at its top:

```
"THREE FLAGSHIP WORKFORCE DASHBOARDS (Alex's strongest work — lead with these):",
"1. Project Demand — C-Suite resourcing dashboard. Weekly demand vs TRUE available capacity (regional base hours net of PTO + public holidays, double-count protected). ±2σ statistical control band. gzip-chunked CacheService: ~30s cold → ~2s warm. Zero JS dependencies, 25 hand-rolled SVG panels. A LIVE sanitized demo with synthetic data is in the demos section — [DEMO:workforce-demand] is not a tab; tell visitors to click 'Open the live demo'.",
"2. Global Comp Health Dashboard — comp-cycle triage for a global org. 4-tier anchor model (no sound comparison → excluded, coverage is a headline). Server-side redaction of restricted profiles (nothing to unhide in devtools). 242 automated test assertions + a render smoke harness. Pay-equity lenses with small-group suppression.",
"3. PS Weekly Contribution Report — 7 metrics per person, ~200-person services org, every Monday. Team-aligned scoring ('team gates, family tunes' — nobody scored on metrics their role doesn't own). 4-role RBAC with roster-derived manager scoping. Gemini-written exec brief with prompt allowlisting and 5 handled failure modes. The 30s→2s gzip-chunk cache story started here.",
"These run in production at Alex's employer; the portfolio shows sanitized demos and case studies only — never real company data.",
```

- [ ] **Step 2:** Update the chat suggestion pills in `index.html` (near `#chat-section`, search `suggestion`): make the first pill `What makes the demand dashboard's capacity model honest?` and keep 3 others (AI/LLM experience, role fit, comp-health testing story).

- [ ] **Step 3:** Diff-check parity: the inserted block must be byte-identical in `Code.js` and `agent-context.js`.

- [ ] **Step 4:** Run all gates:

Run: `node docs/superpowers/gas-portfolio/tools/leak-gate.js && node docs/superpowers/gas-portfolio/tools/claims-gate.js && node docs/superpowers/gas-portfolio/tools/intent-tests.js`
Expected: all three ✅. (leak-gate: the new text mentions no company name — "Alex's employer" only.)

- [ ] **Step 5: Commit + deploy checkpoint.** Commit, then this is the first user-visible milestone: redeploy the GAS web app (portfolio) from the GAS editor and spot-check hero, projects grid, demos, Donna.

```bash
git add "docs/superpowers/gas-portfolio/Code.js" "docs/superpowers/gas-portfolio/netlify/functions/_lib/agent-context.js" "docs/superpowers/gas-portfolio/index.html"
git commit -m "portfolio: Donna leads with the flagship workforce trio"
```

---

# Phase 3 — Flagship live demo + case-study assets

### Task 16: Sanitized copy of the demand app ("Helix Delivery Group")

**Files:**
- Create: `docs/superpowers/gas-portfolio-demos/workforce-demand/Code.js` (copy, then edit)
- Create: `docs/superpowers/gas-portfolio-demos/workforce-demand/Dashboard.html` (copy, then edit)
- Create: `docs/superpowers/gas-portfolio-demos/workforce-demand/Security.js` (rewrite)
- Create: `docs/superpowers/gas-portfolio-demos/workforce-demand/README.md`

- [ ] **Step 1: Copy** (never touch the source dir):

```powershell
New-Item -ItemType Directory -Force "docs/superpowers/gas-portfolio-demos/workforce-demand"
Copy-Item "docs/superpowers/project-demand-dashboard/Code.js","docs/superpowers/project-demand-dashboard/Dashboard.html" "docs/superpowers/gas-portfolio-demos/workforce-demand/"
```

- [ ] **Step 2: Edit the copy's `Code.js` CONFIG** (top of file):
  - `SOURCE_SS_ID:` → `"PASTE_DEMO_WORKBOOK_ID"` and `ROSTER_SS_ID:` → `"PASTE_DEMO_WORKBOOK_ID"` (Task 17's seeder creates ONE workbook holding all 7 tabs; Task 18 pastes its ID into both).
  - `TITLE:` → `"Helix Delivery Group — Project Demand (Live Demo)"`.

- [ ] **Step 3: De-brand the copy's `Code.js`:**
  - Line ~2031 header-detector regex: remove `rocketeer` → `/user|resource|name|employee/i` (demo headers use `User`).
  - `billingTypeFor_` (~line 1416-1423): change the billable regex `/\bSRSO\b|SRSO-/i` → `/\bBILL\b|BILL-/i` and update its comment (`Fix Version prefix "BILL-" ⇒ billable`).
  - Sweep the rest: `grep -in "servicerocket\|rocketeer\|orbe\|srso\|atlassian" "docs/superpowers/gas-portfolio-demos/workforce-demand/Code.js"` and neutralize every hit (comments included).

- [ ] **Step 4: De-brand the copy's `Dashboard.html`:**
  - Line ~456 eyebrow: `ServiceRocket · C-Suite Resourcing Review` → `Helix Delivery Group · Resourcing Review`.
  - Directly under that eyebrow element, add the always-visible banner:

```html
<div class="demo-banner">🔬 Live demo — synthetic data. “Helix Delivery Group” is a fictional company.</div>
```

  and in the `<style>` block add:

```css
.demo-banner{margin:4px 0 8px;padding:6px 12px;border:1px dashed var(--warn,#d97706);border-radius:8px;font-size:12px;opacity:.9;display:inline-block}
```

  - Same brand-sweep grep as Step 3 on `Dashboard.html`; neutralize hits.

- [ ] **Step 5: Write the demo `Security.js`** (full replacement — public demo, open access):

```js
// ============================================================
// Security.js — DEMO build: open access, no allowlist.
// This is the public portfolio demo of the Project Demand
// dashboard. All data is synthetic (see DemoData.js); the
// fictional brand is "Helix Delivery Group". The production
// build of this app uses a bootstrap-admin + allowlist model —
// that code path is exercised here with open access ON.
// ============================================================

const SEC_PD = {
  PROP_ADMINS:      "PD_DASH_ADMINS",
  PROP_VIEWERS:     "PD_DASH_VIEWERS",
  PROP_OPEN_ACCESS: "PD_DASH_OPEN_ACCESS",

  BOOTSTRAP_ADMIN: "demo.admin@example.com",
  DEFAULT_ADMINS:  [],
  DEFAULT_VIEWERS: [],

  // Public demo: anyone with the link is a viewer.
  OPEN_ACCESS_DEFAULT: true,
};
```

  then append, unchanged, everything from the original `Security.js` BELOW its `SEC_PD` block (the `// ── PRIVATE ──` section onward — reader/merge/role functions are reused verbatim).

- [ ] **Step 6: Write `README.md`** for the demo folder (10 lines: what it is, fictional brand, synthetic data, deploy steps pointer, "production source lives elsewhere and is never deployed publicly").

- [ ] **Step 7: Run the leak gate** (it already scans `gas-portfolio-demos/`):

Run: `node docs/superpowers/gas-portfolio/tools/leak-gate.js`
Expected: `✅ leak-gate: clean`. Any hit in the new folder = fix before commit.

- [ ] **Step 8: Commit**

```bash
git add "docs/superpowers/gas-portfolio-demos/workforce-demand"
git commit -m "demo: sanitized Helix Delivery Group copy of the demand dashboard"
```

### Task 17: `DemoData.js` — deterministic synthetic workbook seeder

**Files:**
- Create: `docs/superpowers/gas-portfolio-demos/workforce-demand/DemoData.js`

This is itself a portfolio artifact. It builds ONE spreadsheet with all 7 tabs, anchored on the run date so it never goes stale. Every format rule below comes from the parser audit (see spec §2): exact tab names; Planned/Tracked two-row header (ISO labels with 4-digit years in the row ABOVE the field header); non-padded ISO keys except Capacity Tempo (zero-padded, plus `Account ID` and a trailing `Total (hrs)` column, numbers as real numbers); `Key` column mandatory; PTO = `NETSUITE` rows; PH as text `yyyy-MM-dd` (Date cells shift a day in positive-UTC-offset timezones); Jira Raw headers exactly `Key, Work (Summary), Status, Fix Versions, Epic Key, Assignee, Created, Updated, Resolution Date, Original Estimate (sec)` within columns A..X, epics as their own rows with blank `Epic Key`; roster `Data` tab needs `Name` (as "First Last", matching Tempo `User` after lowercase/whitespace-collapse), `Class` = `Professional Services`, `Department` = `Services`, blank termination, `Key Location` fuzzy-matching PH locations; tracked footer `Last Export:`.

- [ ] **Step 1: Write `DemoData.js`:**

```js
// ============================================================
// DemoData.js — builds the synthetic "Helix Delivery Group"
// workbook this demo reads. Run buildDemoWorkbook() once in the
// GAS editor; it logs the new spreadsheet ID — paste it into
// CONFIG.SOURCE_SS_ID and CONFIG.ROSTER_SS_ID.
// Deterministic (seeded PRNG) and anchored on the run date, so
// data always straddles "today" (window: current−18 … current+4
// ISO weeks — covers the 8-week view, QTD panels, and charts).
// All names, projects, and numbers are fictional.
// ============================================================

function buildDemoWorkbook() {
  var rng = mulberry32_(20260803);
  var W = demoWeeks_(18, 4); // [{iso:"2026.W14", pad:"2026.W14"→padded, date:...}, ...]

  var PEOPLE = demoPeople_();
  var PROJECTS = [
    { key: "ATLAS",  name: "Atlas Rollout",        pm: "Priya Raman" },
    { key: "ORION",  name: "Orion Migration",      pm: "Priya Raman" },
    { key: "VEGA",   name: "Vega Managed Services", pm: "Daniel Cho" },
    { key: "LYRA",   name: "Lyra Integration",     pm: "Daniel Cho" },
    { key: "NOVA",   name: "Nova Onboarding",      pm: "Sofia Marin" },
    { key: "QUASAR", name: "Quasar Analytics",     pm: "Sofia Marin" },
    { key: "PULSAR", name: "Pulsar Support",       pm: "Priya Raman" },
    { key: "COMET",  name: "Comet Discovery",      pm: "Daniel Cho" },
  ];

  var ss = SpreadsheetApp.create("Helix Demo Workbook — synthetic");
  var planned = [], tracked = [], jira = [], issueSeq = 100;
  var epicOf = {}; PROJECTS.forEach(function (p, i) { epicOf[p.key] = "HELIX-E" + (i + 1); });

  // Per-person weekly plan: 1–3 projects, 6–34h; a couple of fragmented people;
  // PTO (NETSUITE) weeks sprinkled in; tracked = plan × 0.65–1.1 for past weeks.
  PEOPLE.forEach(function (person, pi) {
    var homeProjects = pick_(rng, PROJECTS, 2 + (pi % 3)); // 2–4 projects per person
    W.forEach(function (w, wi) {
      var isPast = w.status !== "plan";
      var onPto = rng() < 0.04;
      if (onPto) {
        var ptoH = rng() < 0.5 ? 40 : 8;
        planned.push([person.name, "Time off", "NETSUITE", "", "", w.iso, ptoH]);
        if (isPast) tracked.push([person.name, "Time off", "NETSUITE", "", "", w.iso, ptoH]);
        return;
      }
      var n = 1 + Math.floor(rng() * Math.min(3, homeProjects.length));
      if (pi < 2 && wi % 4 === 2) n = Math.min(homeProjects.length, 5); // fragmentation signal
      var projs = homeProjects.slice(0, n), left = 30 + Math.floor(rng() * 8);
      projs.forEach(function (p, k) {
        var h = k === projs.length - 1 ? Math.max(4, left) : Math.max(4, Math.round(left * (0.3 + rng() * 0.4)));
        left -= h;
        var issue = p.key + "-" + (100 + ((pi * 7 + wi * 3 + k) % 60));
        planned.push([person.name, p.name, p.key, p.pm, issue, w.iso, h]);
        if (isPast) {
          var ratio = 0.65 + rng() * 0.45;
          if (rng() < 0.05) ratio = 0.1; // "planned but not tracked" swarm signal
          var th = Math.round(h * ratio * 2) / 2;
          if (th > 0) tracked.push([person.name, p.name, p.key, p.pm, issue, w.iso, th]);
        }
      });
    });
  });

  // ── Tab: Planned Time Tempo / Tempo Tracked Time (two-row header) ──
  writeTempoTab_(ss, "Planned Time Tempo", W, planned, null);
  writeTempoTab_(ss, "Tempo Tracked Time", W, tracked, new Date());

  // ── Tab: PH (text dates, locations fuzzy-matching roster Key Locations) ──
  var ph = [["Date", "Location", "Holiday"]];
  [[1, "Chile", "Día Nacional"], [5, "Australia & New Zealand", "Bank Holiday"],
   [8, "Malaysia", "Hari Kebangsaan"], [21, "Chile", "Fiestas Patrias"]].forEach(function (h) {
    var d = new Date(W[14].date.getTime() + h[0] * 86400000); // inside the visible window
    ph.push([Utilities.formatDate(d, "UTC", "yyyy-MM-dd"), h[1], h[2]]);
  });
  sheetWith_(ss, "PH", ph);

  // ── Tab: Capacity Tempo (padded ISO row 1, Account ID + trailing total) ──
  var capHdr1 = ["", ""], capHdr2 = ["Account ID", "User"];
  W.forEach(function (w) { capHdr1.push(padIso_(w.iso)); capHdr2.push("wk"); });
  capHdr1.push(""); capHdr2.push("Total (hrs)");
  var capRows = [capHdr1, capHdr2];
  PEOPLE.forEach(function (p, i) {
    var row = ["712020:demo" + i, p.name], tot = 0;
    W.forEach(function (w) {
      var isPto = planned.some(function (r) { return r[0] === p.name && r[5] === w.iso && r[2] === "NETSUITE" && r[6] >= 40; });
      var base = p.loc === "Australia & New Zealand" ? 38 : 40;
      var v = isPto ? 0 : base;
      row.push(v); tot += v;
    });
    row.push(tot);
    capRows.push(row);
  });
  sheetWith_(ss, "Capacity Tempo", capRows);

  // ── Tab: Jira Raw (headers exact; epics as own rows, blank Epic Key) ──
  jira.push(["Key", "Work (Summary)", "Status", "Fix Versions", "Epic Key", "Assignee",
             "Created", "Updated", "Resolution Date", "Original Estimate (sec)"]);
  PROJECTS.forEach(function (p) {
    jira.push([epicOf[p.key], p.name + " (Epic)", "In Progress", "", "", p.pm,
               ymdOffset_(-120), ymdOffset_(-3), "", ""]);
  });
  var seen = {};
  tracked.concat(planned).forEach(function (r) {
    var issue = r[4]; if (!issue || seen[issue]) return; seen[issue] = 1;
    var key = r[2], person = r[0], roll = rng();
    var status = roll < 0.45 ? "In Progress" : roll < 0.75 ? "Done" : roll < 0.9 ? "To Do" : "In Review";
    var fx = rng() < 0.6 ? "BILL-2026.3" : (rng() < 0.5 ? "internal-2026" : "");
    var assignee = rng() < 0.08 ? "Unassigned" : person;
    var updated = rng() < 0.1 ? ymdOffset_(-20) : ymdOffset_(-2); // few aging-WIP rows
    jira.push([issue, "Work item for " + key, status, fx, epicOf[key], assignee,
               ymdOffset_(-90), updated, status === "Done" ? ymdOffset_(-5) : "",
               String(Math.round((4 + rng() * 30)) * 3600)]);
  });
  sheetWith_(ss, "Jira Raw", jira);

  // ── Tabs: Data + Contractors Data (roster) ──
  var hdr = ["Name", "Class", "Department", "Employee Status", "Termination/Release Date",
             "Key Location", "Job Title", "Job Family", "Supervisor"];
  var data = [hdr], crew = [hdr];
  PEOPLE.forEach(function (p) {
    var row = [p.name, "Professional Services", "Services", "Active", "",
               p.loc, p.title, "", p.supervisor || ""];
    (p.crew ? crew : data).push(row);
  });
  sheetWith_(ss, "Data", data);
  sheetWith_(ss, "Contractors Data", crew);

  ss.deleteSheet(ss.getSheets()[0]); // default "Sheet1"
  Logger.log("Demo workbook ready: " + ss.getId());
  Logger.log("Paste this ID into CONFIG.SOURCE_SS_ID and CONFIG.ROSTER_SS_ID, then run bustDemandCache_().");
  return ss.getId();
}

// ── helpers ──────────────────────────────────────────────────

function demoPeople_() {
  var mk = function (name, loc, title, supervisor, crew) {
    return { name: name, loc: loc, title: title, supervisor: supervisor, crew: !!crew };
  };
  var sup1 = "Priya Raman", sup2 = "Daniel Cho", sup3 = "Sofia Marin";
  return [
    mk(sup1, "United States", "09.M4.1 Manager, Delivery", ""),
    mk(sup2, "Australia & New Zealand", "09.M3.1 Manager, Delivery", sup1),
    mk(sup3, "Chile", "09.M3.2 Manager, Delivery", sup1),
    mk("Alice Doe", "Malaysia", "07.I3.2 Consultant, Delivery", sup1),
    mk("Omar Haddad", "Malaysia", "07.I3.1 Consultant, Delivery", sup1),
    mk("Mei Lin Tan", "Malaysia", "07.I4.1 Senior Consultant, Delivery", sup1),
    mk("Ravi Pillai", "Malaysia", "07.I2.1 Associate Consultant, Delivery", sup2),
    mk("Nadia Osman", "Malaysia", "07.I3.2 Consultant, Delivery", sup2),
    mk("Jun Wei Ng", "Malaysia", "07.I3.1 Consultant, Delivery", sup2),
    mk("Farah Aziz", "Malaysia", "07.I4.2 Senior Consultant, Delivery", sup3),
    mk("Kavya Nair", "Malaysia", "07.I2.2 Associate Consultant, Delivery", sup3),
    mk("Hana Yusof", "Malaysia", "07.I3.1 Consultant, Delivery", sup3),
    mk("Liam O'Brien", "Australia & New Zealand", "07.I4.1 Senior Consultant, Delivery", sup2),
    mk("Ruby Clarke", "Australia & New Zealand", "07.I3.2 Consultant, Delivery", sup2),
    mk("Tane Walker", "Australia & New Zealand", "07.I3.1 Consultant, Delivery", sup2),
    mk("Isla Thompson", "Australia & New Zealand", "07.I2.1 Associate Consultant, Delivery", sup2),
    mk("Camila Rojas", "Chile", "07.I3.1 Consultant, Delivery", sup3),
    mk("Matías Silva", "Chile", "07.I3.2 Consultant, Delivery", sup3),
    mk("Valentina Paz", "Chile", "07.I4.1 Senior Consultant, Delivery", sup3),
    mk("Diego Fuentes", "Chile", "07.I2.2 Associate Consultant, Delivery", sup3),
    mk("Josefa Vidal", "Chile", "07.I3.1 Consultant, Delivery", sup3),
    mk("Ethan Brooks", "United States", "07.I4.2 Senior Consultant, Delivery", sup1),
    mk("Grace Miller", "United States", "07.I3.1 Consultant, Delivery", sup1),
    mk("Noah Bennett", "United States", "07.I2.1 Associate Consultant, Delivery", sup1),
    mk("Aroha Ngata", "Australia & New Zealand", "Crew Member — Delivery", sup2, true),
    mk("Pablo Mora", "Chile", "Crew Member — Delivery", sup3, true),
    mk("Suraya Bakar", "Malaysia", "Crew Member — Delivery", sup1, true),
  ];
}

function demoWeeks_(past, future) {
  var out = [], today = new Date();
  for (var off = -past; off <= future; off++) {
    var d = new Date(today.getTime() + off * 7 * 86400000);
    var iso = isoWeekYear_(d) + ".W" + isoWeekNum_(d); // reuses app helpers (same file scope in GAS)
    out.push({ iso: iso, date: mondayOf_(d), status: off < 0 ? "done" : off === 0 ? "now" : "plan" });
  }
  return out;
}
function mondayOf_(d) {
  var x = new Date(d); var day = x.getDay() || 7; x.setDate(x.getDate() - day + 1);
  x.setHours(0, 0, 0, 0); return x;
}
function padIso_(iso) {
  var m = iso.match(/^(\d{4})\.W(\d+)$/);
  return m[1] + ".W" + (m[2].length === 1 ? "0" + m[2] : m[2]);
}
function ymdOffset_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000), "UTC", "yyyy-MM-dd");
}
function mulberry32_(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick_(rng, arr, n) {
  var copy = arr.slice(), out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}
function sheetWith_(ss, name, rows) {
  var sh = ss.insertSheet(name);
  if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(padRows_(rows));
  return sh;
}
function padRows_(rows) {
  var w = 0; rows.forEach(function (r) { if (r.length > w) w = r.length; });
  return rows.map(function (r) { return r.concat(new Array(w - r.length).fill("")); });
}
// Two-row-header Tempo tab: row1 = ISO labels over the week columns (4-digit
// year REQUIRED for detection), row2 = field headers, TOTAL footer, optional
// "Last Export:" stamp (tracked only).
function writeTempoTab_(ss, name, W, recs, exportStamp) {
  var fixed = ["User", "Space", "Key", "PM", "Issue"];
  var row1 = fixed.map(function () { return ""; }).concat(W.map(function (w) { return w.iso; })).concat([""]);
  var row2 = fixed.concat(W.map(function (w) { return "wk"; })).concat(["Total (hrs)"]);
  var byPerson = {};
  recs.forEach(function (r) {
    var k = r[0] + "|" + r[2] + "|" + r[1] + "|" + r[3] + "|" + r[4];
    byPerson[k] = byPerson[k] || { fixed: [r[0], r[1], r[2], r[3], r[4]], weeks: {} };
    byPerson[k].weeks[r[5]] = (byPerson[k].weeks[r[5]] || 0) + r[6];
  });
  var rows = [row1, row2];
  Object.keys(byPerson).sort().forEach(function (k) {
    var e = byPerson[k], tot = 0;
    var wcells = W.map(function (w) { var v = e.weeks[w.iso] || ""; if (v) tot += v; return v; });
    rows.push(e.fixed.concat(wcells).concat([tot]));
  });
  rows.push(["TOTAL"]);
  if (exportStamp) rows.push(["Last Export:", Utilities.formatDate(exportStamp, "UTC", "yyyy-MM-dd HH:mm")]);
  sheetWith_(ss, name, rows);
}
```

- [ ] **Step 2: Lint-parse locally** (GAS runs it later, Node just checks syntax — GAS globals will be undefined, that's fine):

Run: `node --check "docs/superpowers/gas-portfolio-demos/workforce-demand/DemoData.js"`
Expected: no output (syntax OK).

- [ ] **Step 3: Leak-gate** — `node docs/superpowers/gas-portfolio/tools/leak-gate.js` → ✅.

- [ ] **Step 4: Commit**

```bash
git add "docs/superpowers/gas-portfolio-demos/workforce-demand/DemoData.js"
git commit -m "demo: deterministic synthetic workbook seeder (buildDemoWorkbook)"
```

### Task 18: Deploy the demo (USER-ASSISTED) and verify every panel

No repo files change except the two CONFIG IDs and the `liveUrl`. The human runs the GAS console steps.

- [ ] **Step 1 (user):** script.google.com → New project "Helix Demand Demo" → create files `Code`, `Dashboard` (HTML), `Security`, `DemoData` and paste the four files from `docs/superpowers/gas-portfolio-demos/workforce-demand/`.
- [ ] **Step 2 (user):** Run `buildDemoWorkbook()` (authorize when prompted) → copy the logged spreadsheet ID.
- [ ] **Step 3:** Paste the ID into `CONFIG.SOURCE_SS_ID` and `CONFIG.ROSTER_SS_ID` — in the GAS project AND in the repo copy (keep them identical), commit the repo copy:

```bash
git add "docs/superpowers/gas-portfolio-demos/workforce-demand/Code.js"
git commit -m "demo: point CONFIG at the generated Helix workbook"
```

- [ ] **Step 4 (user):** In the GAS editor run `debugPlannedPeopleCoverage()` → every planned person must have a roster match (zero unmatched). Then `debugDemandPipeline()` → no errors. Then `getDemandData(true)` once to build the cache.
- [ ] **Step 5 (user):** Deploy → New deployment → Web app → Execute as **Me**, access **Anyone**. Copy the `/exec` URL.
- [ ] **Step 6: Verify against the checklist** (open the URL in an incognito window):
  - [ ] Badge shows "Data as of …" (live), not `○ Offline / CSV`
  - [ ] Demo banner + "Helix Delivery Group · Resourcing Review" eyebrow visible
  - [ ] Capacity headline shows a real denominator (not "capacity estimated")
  - [ ] 🏖 appears on at least one week header; hover names a fictional holiday + location + people count
  - [ ] Utilization panel renders with the ±2σ band (Capacity Tempo parsed)
  - [ ] Billing panel classifies Billable/Internal/Untagged (BILL-* fix versions)
  - [ ] Question chips return non-empty results; heatmap renders; Delivery & PM view lists PMs and epics
  - [ ] CSV export downloads and opens
  - [ ] No real name, company, or ID anywhere on any tab (spot-check + view-source)

### Task 19: Flagship card in the portfolio demos section

**Files:**
- Modify: `docs/superpowers/gas-portfolio/index.html` (demos section + CSS)
- Modify: `docs/superpowers/gas-portfolio/Code.js` (`workforce-demand.liveUrl`)
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (ScrollNudge final hint)

- [ ] **Step 1:** Set `liveUrl` in the `workforce-demand` PROJECTS entry to the Task 18 `/exec` URL.

- [ ] **Step 2:** In `index.html`, insert ABOVE the `<div class="demo-tabs …">` block:

```html
    <div class="flagship-card reveal reveal-delay-2" id="flagship-card">
      <p class="flagship-eyebrow">Flagship · live Google Apps Script web app</p>
      <h3 class="flagship-title">Project Demand — C-Suite Resourcing Dashboard</h3>
      <ul class="flagship-points">
        <li>Capacity = regional base hours − PTO − public holidays, double-count-protected</li>
        <li>±2σ statistical control band on utilization — honesty, not a trendline</li>
        <li>~30s cold compute → ~2s warm via gzip-chunked CacheService</li>
      </ul>
      <a class="btn-primary" id="flagship-open" href="PASTE_EXEC_URL" target="_blank" rel="noopener">Open the live demo →</a>
      <p class="flagship-note">Synthetic data · “Helix Delivery Group” is fictional · same architecture as the production app</p>
    </div>
```

(replace `PASTE_EXEC_URL` with the real URL) and add CSS next to the `.demo-tabs` rules:

```css
.flagship-card{border:1px solid rgba(76,201,138,.35);border-radius:14px;padding:22px 24px;margin:0 0 26px;background:linear-gradient(160deg,rgba(76,201,138,.07),transparent 60%)}
.flagship-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75;margin:0 0 6px}
.flagship-title{font-family:'Fraunces',serif;font-size:1.5rem;margin:0 0 10px}
.flagship-points{margin:0 0 16px;padding-left:18px;font-size:.92rem;line-height:1.7}
.flagship-note{font-size:.78rem;opacity:.65;margin:10px 0 0}
```

- [ ] **Step 3:** Update the demos section desc (`index.html:2345`) to `One live production-grade dashboard. Two AI simulators. Synthetic data everywhere.` and `ScrollNudge` `'demos'` hint to `What makes the demand dashboard's capacity model honest?`.

- [ ] **Step 4:** Gates + rebuild: leak-gate ✅ (note: the `/exec` URL is `script.google.com/macros/...`, not the banned `script.google.com/a/` domain form), claims-gate ✅, `node build-static.js` ✅. Open `dist/index.html`, click "Open the live demo" → Helix demo loads.

- [ ] **Step 5 (user): redeploy the portfolio GAS web app.** Commit:

```bash
git add "docs/superpowers/gas-portfolio/index.html" "docs/superpowers/gas-portfolio/Code.js" "docs/superpowers/gas-portfolio/JavaScript.html"
git commit -m "portfolio: flagship demo card wired to the live Helix demand demo"
```

### Task 20: Case-study screenshots (flagship + CompDash harness)

**Files:**
- Create: `docs/superpowers/gas-portfolio-demos/screens/compdash_harness.js`
- Modify: `docs/superpowers/gas-portfolio/JavaScript.html` (modal `shots` strip)
- Modify: `docs/superpowers/gas-portfolio/index.html` (modal `pm-shots` container)
- Modify: `docs/superpowers/gas-portfolio/Code.js` (shots arrays when URLs exist)

- [ ] **Step 1: Modal support.** In `index.html` add `<div id="pm-shots"></div>` after the before/after strip container; in `ProjectModal.open` (after the before/after innerHTML assignment) add:

```js
    var shotsWrap = document.getElementById('pm-shots');
    if (shotsWrap) {
      shotsWrap.innerHTML = (p.shots || []).map(function (s) {
        return '<figure class="pm-shot"><img loading="lazy" src="' + escHtml(s.src) +
          '" alt="' + escHtml(s.caption) + '"><figcaption>' + escHtml(s.caption) + '</figcaption></figure>';
      }).join('');
    }
```

with CSS in `index.html`:

```css
#pm-shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin:18px 0}
.pm-shot img{width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.12)}
.pm-shot figcaption{font-size:.75rem;opacity:.65;margin-top:4px}
```

- [ ] **Step 2: CompDash harness** — `docs/superpowers/gas-portfolio-demos/screens/compdash_harness.js` (reads the internal file, never modifies it). It reuses the synthetic-payload approach of `CompDash/tests/render_smoke.js`, but in a real browser:

```js
// compdash_harness.js — writes compdash_demo.html: the CompDash SPA running on a
// synthetic, de-branded payload with google.script.run stubbed. Open the output
// in a browser and screenshot views for the portfolio case study.
// SPEC §0.3: screenshots come ONLY from this synthetic render, never production.
var fs = require("fs"), path = require("path");
var SRC = path.join(__dirname, "..", "..", "..", "..", "CompDash", "ViewDash.html");
var html = fs.readFileSync(SRC, "utf8").replace(/<\?[=!]?[\s\S]*?\?>/g, "admin");

// Synthetic payload: adapt the `D` object from CompDash/tests/render_smoke.js
// (copy it into payload.json beside this script, then de-brand: replace every
// "Rocketeer" with "employee", emails with x@example.com, keep all numbers).
var D = JSON.parse(fs.readFileSync(path.join(__dirname, "payload.json"), "utf8"));

var stub = "<script>window.google={script:{run:new Proxy({},{get:function(t,k){" +
  "if(k==='withSuccessHandler')return function(fn){window.__ok=fn;return window.google.script.run;};" +
  "if(k==='withFailureHandler')return function(){return window.google.script.run;};" +
  "return function(){if(k==='getCompReportData')setTimeout(function(){window.__ok(" +
  JSON.stringify(D).replace(/<\/script/gi, "<\\/script") + ")},50);};}})}};<\/script>";

html = html.replace(/<script>/, stub + "\n<script>");
fs.writeFileSync(path.join(__dirname, "compdash_demo.html"), html, "utf8");
console.log("Wrote compdash_demo.html — open in a browser, cycle the views, screenshot.");
```

- [ ] **Step 3 (user-assisted):** Create `payload.json` (copy `D` from `render_smoke.js:61-145` as JSON, de-brand: "Rocketeer"→"employee", `x@sr.com`→`x@example.com`). Run `node docs/superpowers/gas-portfolio-demos/screens/compdash_harness.js`, open the HTML, capture: Overview, Attrition, Pay Equity, Priority Ranking. From the live Helix demo capture: Overview, heatmap with 🏖 tooltip, Utilization band. **PS Dashboard ships without screenshots for now** (spec §3 allows it; its synthetic feed is a follow-up).

- [ ] **Step 4 (user):** Host the captures (Drive → public "anyone with link" images, or any host), then fill `shots: [{src:"…", caption:"…"}]` on the `workforce-demand` and `comp-health` PROJECTS entries.

- [ ] **Step 5:** Run ALL gates + build; rebuild; verify modals show the strips. Commit:

```bash
git add "docs/superpowers/gas-portfolio-demos/screens/compdash_harness.js" "docs/superpowers/gas-portfolio/JavaScript.html" "docs/superpowers/gas-portfolio/index.html" "docs/superpowers/gas-portfolio/Code.js"
git commit -m "portfolio: case-study screenshot strips from synthetic renders only"
```

### Task 21: Final verification sweep

- [ ] **Step 1:** `node docs/superpowers/gas-portfolio/tools/leak-gate.js && node docs/superpowers/gas-portfolio/tools/claims-gate.js && node docs/superpowers/gas-portfolio/tools/intent-tests.js` → three ✅.
- [ ] **Step 2:** `cd docs/superpowers/gas-portfolio && node build-static.js` → success; open `dist/index.html`: hero terminal, counters, projects grid (workforce column first), flagship card, both simulators, all modals.
- [ ] **Step 3 (user): Donna regression on the deployed GAS portfolio** — ask the 12 questions from `tools/intent-tests.js` in the live chat; recruiter-style questions get real answers; salary question routes to LinkedIn; "show me the demand demo" points at the flagship card.
- [ ] **Step 4 (user):** Full portfolio walkthrough on the GAS `/exec` URL: every nav link, every tile, every demo tab, CV download, contact buttons.
- [ ] **Step 5:** Update the memory file `project_portfolio_recalibration.md` (status → phases complete, demo URL noted as deployed) — per repo convention this is Claude-side, not a git commit.

---

## Self-review notes (kept for the executor)

- **Spec coverage:** §0 → Task 1 + gates rerun in 5, 15–17, 19–21; §1 → Tasks 8, 9, 11–13, 15; §2 → Tasks 16–19 (mechanism amended: synthetic demo *workbook*, not CSV mode — spec §2 update committed with this plan); §3 → Tasks 9, 10, 20 (PS screenshots explicitly deferred, allowed by §3); §4 → Tasks 2–8; verification → Tasks 18, 21.
- **Known simplifications:** demo `Security.js` reuses the original's private section verbatim; `DemoData.js` reuses the app's own ISO helpers (same GAS file scope). The `hay` variable in Task 4's `retrieveProject` is intentionally unused (kept for future fuzzy matching) — remove the `void hay;` line and `hay` if the reviewer prefers.
- **Numbers discipline:** any figure shown to a visitor is measured in-plan (Task 11 Step 1) or comes from the internal apps' own test suites (242/12), never from company business data.
