// ============================================================
// SCRIPT NAME: Alex López — Portfolio GAS Webapp · Code.gs
// PURPOSE:     Portfolio SPA backend + AI talent agent with
//              offer evaluation, salary negotiation, and
//              email notification to portfolio owner.
// VERSION:     2.0.0
// ENVIRONMENT: Google Apps Script
// Deploy:      Execute as Me · Anyone · XFrameOptionsMode.ALLOWALL
// ============================================================

// ── PROJECT DATA ──────────────────────────────────────────────
var DOMAINS = [
  {
    id: "ai",
    label: "AI & LLM Integration",
    icon: "⚡",
    tagline: "Automation & intelligence at scale",
    color: "teal",
  },
  {
    id: "finance",
    label: "Finance & Data",
    icon: "📊",
    tagline: "CFO-ready forecasting & compliance",
    color: "blue",
  },
  {
    id: "hr",
    label: "HR & People",
    icon: "👥",
    tagline: "Global comp & workforce insights",
    color: "purple",
  },
  {
    id: "ops",
    label: "Ops & Engineering",
    icon: "⚙️",
    tagline: "Production-grade internal tools",
    color: "amber",
  },
];

var PROJECTS = [
  {
    id: "ai-sales",
    domain: "ai",
    title: "AI Sales Analytics Ecosystem",
    tagline: "HubSpot CRM + Gemini LLM → automated weekly deal intelligence",
    category: "AI · Sales Analytics",
    impact: "10h/week saved",
    context:
      "At a globally distributed SaaS company (HR-tech / EdTech) with teams across **15+ countries**, sales leadership was drowning in manual reporting — analysts spent **10+ hours per week** consolidating the **full weekly HubSpot deal pipeline** by hand. Deal notes were **unstructured**, forecasts were unreliable, and there was no systematic way to surface **deal blockers** or forecast with confidence.",
    action: [
      "Engineered an end-to-end pipeline integrating the **HubSpot CRM API (v3/v4)** with a **parallelized ETL** layer in Apps Script.",
      "Added **Google Gemini LLM** for semantic analysis of unstructured deal notes — auto-detecting **deal blockers** and generating human-readable weekly summaries.",
      "Layered a custom **Time Decay forecasting model** to improve revenue forecast accuracy.",
      "Built in **Google Apps Script** to eliminate infrastructure overhead and deliver the brief straight into the Google Workspace tools sales leadership already lives in — no new infra, no IT tickets, no access requests.",
    ],
    resolution:
      "Eliminated **10+ hours/week** of manual reporting. Sales leadership now receives **AI-generated deal-risk flags** and narrative summaries **every Monday** — giving the C-suite a data-driven foundation for quarterly planning.",
    tech: [
      "HubSpot API v3/v4",
      "Google Apps Script",
      "Python",
      "Google Gemini LLM",
      "ETL Pipelines",
      "Time Decay Forecasting",
    ],
    metrics: [
      { val: "10h+", label: "saved weekly" },
      { val: "100%", label: "automated" },
      { val: "C-suite", label: "audience" },
    ],
    before: {
      process:
        "Manual CRM consolidation — 10h+/week, unreliable forecasts, no deal risk visibility",
      metrics: "Inconsistent methodology · No scalability",
    },
    after: {
      process:
        "Automated AI pipeline delivers Monday summaries with deal risk flags",
      metrics: "0h manual · C-suite ready every week",
    },
    repoUrl: "https://github.com/MoisesLopez01/ai-sales-analytics",
  },
  {
    id: "salary-bench",
    domain: "ai",
    title: "Global Salary Benchmarking Engine",
    tagline:
      "Gemini Pro API across 15+ countries → 90% faster compensation research",
    category: "AI · Compensation",
    impact: "90% faster",
    context:
      "Manually benchmarking compensation for **all roles and departments** across **15+ countries** was a **multi-day** exercise for the People team — involving market reports, currency adjustments, COL indexes, and tax-rate research. The process was inconsistent, slow, and couldn't scale with global headcount growth.",
    action: [
      "Architected the engine on the **Gemini Pro API** with advanced **prompt engineering** that simulates a senior compensation analyst's methodology.",
      "Built dynamic **COL, tax-rate, and market-maturity adjustments** into the prompting logic.",
      "Delivered **P25/P50/P75** percentile intelligence with micro-banding and multi-currency logic — co-designed with the **CEO and VP of Talent Acquisition**.",
    ],
    resolution:
      "Cut compensation research time by **90%** — from multi-day manual work to a **minutes-long** automated workflow. Now covers **10+ regions** with consistent methodology and dynamic PDF/Google Sheets outputs used in **board-level** decisions.",
    tech: [
      "Gemini Pro API",
      "Prompt Engineering",
      "Python",
      "Google Sheets",
      "PDF Automation",
      "COL/Tax Modeling",
    ],
    metrics: [
      { val: "90%", label: "faster research" },
      { val: "15+", label: "countries" },
      { val: "P25/50/75", label: "percentiles" },
    ],
    before: {
      process:
        "3–5 day manual research per region using market reports and spreadsheets",
      metrics: "Inconsistent methodology · Not scalable",
    },
    after: {
      process:
        "Automated engine returns P25/P50/P75 benchmarks in minutes per region",
      metrics: "90% faster · Board-level outputs · 15+ countries",
    },
    repoUrl: "https://github.com/MoisesLopez01/salary-benchmarking-engine",
  },
  {
    id: "hr-eval",
    domain: "ai",
    title: "360 Leadership Evaluation Automation",
    tagline: "Gemini API + Apps Script → 40% reduction in HR cycle time",
    category: "AI · HR Automation",
    impact: "40% cycle reduction",
    context:
      "The annual 360 Leadership Evaluation process was a manual, **time-intensive** effort — collecting **multi-source survey data across the entire leadership cohort**, normalizing responses, and producing executive summaries. **Cycle time was long**, data accuracy was inconsistent, and HR lacked capacity to run continuous evaluations.",
    action: [
      "Automated the full **360 Leadership Evaluation** workflow with the **Gemini API** and Google Apps Script.",
      "Built pipelines for **multi-source survey ingestion** and response normalization.",
      "Applied Gemini to generate **executive-ready narrative summaries**, with embedded quality checks for data accuracy.",
      "Built in **Google Apps Script** so the workflow runs natively inside the Google Workspace tools HR already uses — eliminating infrastructure overhead with no new platform, no IT tickets, and no access requests.",
    ],
    resolution:
      "Reduced manual HR cycle time by **40%**. Evaluations now produce **consistent, executive-grade summaries** with improved accuracy, and the freed capacity let HR run them more frequently.",
    tech: [
      "Gemini API",
      "Google Apps Script",
      "Survey Automation",
      "NLP Pipelines",
      "Google Workspace",
    ],
    metrics: [
      { val: "40%", label: "faster cycle" },
      { val: "Auto", label: "summaries" },
      { val: "↑", label: "data accuracy" },
    ],
    before: {
      process:
        "Manual survey consolidation — long cycle times, inconsistent summary quality",
      metrics: "HR bottleneck · Limited evaluation frequency",
    },
    after: {
      process:
        "Automated pipeline: ingestion → normalization → AI executive summary",
      metrics: "40% faster · Consistent outputs · More frequent runs",
    },
    repoUrl: "https://github.com/MoisesLopez01/360-leadership-automation",
  },
  {
    id: "atlassian-intelligence",
    domain: "ai",
    title: "Atlassian Signal Intelligence",
    tagline:
      "Claude API + Confluence REST → automated FY27 strategy alignment from meeting transcripts",
    category: "AI · Productivity Engineering",
    impact: "< 15 min strategy review",
    context:
      "Leadership reviews of the **full weekly stream of Jira discussions and Confluence meeting transcripts** consumed **3+ hours per cycle** — with no systematic way to surface which decisions mapped to **FY27 strategic OKRs**.",
    action: [
      "Built a pipeline for automated **transcript ingestion from Confluence** via REST API.",
      "Used the **Claude API** for structured signal extraction — each decision classified by **strategic theme and OKR-alignment score**.",
      "Auto-published the weekly brief to Confluence and wired up **Rovo agents** for on-demand strategy Q&A against the live corpus.",
      "Built in **Google Apps Script** to avoid standing up dedicated infrastructure — the brief publishes straight into the Atlassian and Workspace tools leadership already works in, with no IT tickets or access requests.",
    ],
    resolution:
      "Strategic alignment reviews dropped from **3+ hours to under 15 minutes** per week. Leadership receives an **automated Confluence brief every Monday** mapping meeting decisions to **FY27 OKRs**.",
    tech: [
      "Claude API",
      "Confluence REST API",
      "Google Apps Script",
      "Rovo Agents",
      "Prompt Engineering",
      "NLP Pipelines",
    ],
    metrics: [
      { val: "< 15m", label: "strategy review" },
      { val: "100%", label: "transcript coverage" },
      { val: "FY27", label: "OKR aligned" },
    ],
    before: {
      process:
        "Manual transcript review across Jira + Confluence — 3+ hours per cycle, no OKR mapping",
      metrics: "Executive bottleneck · Signals missed · No audit trail",
    },
    after: {
      process:
        "Automated pipeline: ingest → Claude extraction → Confluence brief → Rovo Q&A",
      metrics: "< 15 min review · Weekly auto-brief · Zero manual mining",
    },
    repoUrl: "https://github.com/MoisesLopez01/atlassian-signal-intelligence",
  },
  {
    id: "tcc-forecast",
    domain: "finance",
    title: "TCC Financial Forecasting System",
    tagline: "CFO-ready P&L dashboards replacing manual budget consolidation",
    category: "Finance · Forecasting",
    impact: "CFO-level visibility",
    context:
      "The Finance and People teams were manually consolidating **P&L data across all departments**, creating **error-prone quarterly** reporting cycles with no systematic way to model the **four core cost drivers** — attrition, promotions, merit increases, and new hires — or to rank where variance was concentrated.",
    action: [
      "Developed a Financial Forecasting & TCC Impact System in Apps Script with smart **attrition-proration** logic.",
      "Built dynamic **Line-of-Business budget allocation** engines and automated board dashboards.",
      "Delivered views for **Quarterly Actuals vs. Forecast**, **Top 15 Department Variance**, and full P&L cost-driver breakdowns (merit, promotion, attrition, new hire).",
      "Built in **Google Apps Script** to eliminate infrastructure overhead and deploy directly inside the Google Sheets the finance team already uses — no new platform, no IT tickets, no access requests.",
    ],
    resolution:
      "Delivered **CFO-level visibility** into labor cost drivers through fully automated dashboards. Monthly department-level analysis now informs C-suite compensation decisions, and post-adjustment audits reached **100% accuracy** across all sheets.",
    tech: [
      "Google Apps Script",
      "NetSuite SuiteQL",
      "SQL",
      "Oracle Warehouse",
      "Tableau",
      "Looker",
    ],
    metrics: [
      { val: "100%", label: "audit accuracy" },
      { val: "CFO", label: "stakeholder" },
      { val: "0", label: "manual steps" },
    ],
    before: {
      process:
        "Manual P&L consolidation across departments — error-prone quarterly cycles",
      metrics: "No real-time visibility · Finance team bottleneck",
    },
    after: {
      process:
        "Automated CFO dashboards: actuals vs. forecast, LOB variance, cost drivers",
      metrics: "100% audit accuracy · 0 manual steps · C-suite ready",
    },
    repoUrl: "https://github.com/MoisesLopez01/tcc-financial-forecasting",
  },
  {
    id: "goals-audit",
    domain: "finance",
    title: "Goals Quality Audit Pipeline",
    tagline:
      "SuiteQL + Python → 100% bonus-eligibility compliance enforced automatically",
    category: "Finance · Compliance",
    impact: "100% compliant",
    context:
      "The bonus eligibility process required every employee to have at least **10 active goals** in the performance system — at scale, roughly **230 employees × 10 goals × up to 26 self-comments per quarter ≈ ~60K data points per cycle**. **Manual checks were inconsistent** — some employees reached bonus payout with fewer goals.",
    action: [
      "Built an automated pipeline using **SuiteQL** queries to extract goal data from NetSuite.",
      "Added a **Python JSON-to-CSV** transformation layer that applies the **10-goal compliance rule**.",
      "Flags non-compliant employees **before the bonus cycle runs** and notifies HR automatically.",
    ],
    resolution:
      "Achieved **100% compliance enforcement** on every bonus cycle with **zero manual intervention**. Highlighted at **Rocket Ops All Hands** for driving company-wide improvement in goals compliance.",
    tech: [
      "Python",
      "SuiteQL",
      "JSON parsing",
      "pandas",
      "Google Sheets",
      "NetSuite",
    ],
    metrics: [
      { val: "100%", label: "compliance" },
      { val: "0", label: "manual checks" },
      { val: "10-goal", label: "rule enforced" },
    ],
    before: {
      process:
        "Manual goal count checks before each bonus cycle — inconsistent, error-prone",
      metrics: "Audit surprises · HR/Finance time drain",
    },
    after: {
      process:
        "Automated Python pipeline flags non-compliance before bonus cycle runs",
      metrics: "100% enforcement · Zero manual intervention",
    },
    repoUrl: "https://github.com/MoisesLopez01/goals-quality-audit",
  },
  {
    id: "total-rewards",
    domain: "finance",
    title: "Total Rewards Analysis Tool",
    tagline:
      "Automated comp-ratio modeling and band positioning across all levels",
    category: "Finance · Compensation",
    impact: "Standardized bands",
    context:
      "Compensation decisions at a globally distributed **500–1,000-employee SaaS company (HR-tech / EdTech)** — spanning **18 job families across 12 countries** — were made with **ad hoc spreadsheet comparisons**: no consistent band framework, **no comp-ratio tracking**, and no visibility into where each employee sat relative to market.",
    action: [
      "Built an Employee Compensation Analysis module in **Google Apps Script** on NetSuite data.",
      "Implemented **band positioning (Q1–Q4)** with **comp-ratio** calculations and automated percentile mapping against internal pay bands.",
      "Integrated with the **TCC Forecasting System** for unified compensation views.",
      "Built in **Google Apps Script** to skip infrastructure overhead entirely and put band analysis directly inside the Google Sheets the People and Finance teams already use — no new platform, no IT tickets, no access requests.",
    ],
    resolution:
      "Delivered standardized **band positioning and comp-ratio** analysis across all roles and levels — **18 job families and 12 countries**. Review cycles that previously took days of manual spreadsheet work now run in **minutes**.",
    tech: [
      "Google Apps Script",
      "NetSuite",
      "Compensation Modeling",
      "Google Sheets",
      "Tableau",
    ],
    metrics: [
      { val: "P25–75", label: "band analysis" },
      { val: "18", label: "job families" },
      { val: "12", label: "countries" },
    ],
    before: {
      process:
        "Ad hoc spreadsheet comparisons rebuilt from scratch each review cycle",
      metrics: "No consistent methodology · Days of manual work",
    },
    after: {
      process:
        "Automated band positioning with comp-ratio and quartile analysis per employee",
      metrics: "Minutes per cycle · Consistent across all levels",
    },
    repoUrl: "https://github.com/MoisesLopez01/total-rewards-analysis",
  },
  {
    id: "comp-reporting",
    domain: "hr",
    title: "Global Compensation Reporting Tool",
    tagline:
      "10+ regions, micro-banding, PDF + Sheets auto-output for board decisions",
    category: "HR · Global Comp",
    impact: "10+ regions",
    context:
      "A globally distributed SaaS company (HR-tech / EdTech) was managing **multi-currency** compensation across **10+ regions** without a unified framework — each region used separate spreadsheets with **no consistent methodology** for currency conversion, benefit valuation, or band positioning.",
    action: [
      "Built a Global Compensation Reporting Tool in **Python** with the **Gemini Pro API**.",
      "Implemented **multi-currency normalization** (FX-rate injection), **regional COL adjustments**, and micro-banding co-designed with the CEO and VP of TA.",
      "Automated **PDF and Google Sheets** output generation for board presentations.",
    ],
    resolution:
      "Delivered a unified global compensation view across **10+ regions**. Board-level decisions now use consistent, methodology-aligned data — shifting the company from reactive comp adjustments to **proactive market positioning**.",
    tech: [
      "Gemini Pro API",
      "Python",
      "PDF Automation",
      "Google Sheets",
      "Multi-currency Logic",
      "COL Modeling",
    ],
    metrics: [
      { val: "10+", label: "regions" },
      { val: "PDF+GS", label: "auto output" },
      { val: "Board", label: "audience" },
    ],
    before: {
      process:
        "Separate regional spreadsheets, inconsistent methodology, no global view",
      metrics: "Ad hoc decisions · No cross-region comparability",
    },
    after: {
      process:
        "Unified tool: multi-currency, COL-adjusted, PDF + Sheets auto-generated",
      metrics: "Board-level quality · 10+ regions · Consistent method",
    },
    repoUrl: "https://github.com/MoisesLopez01/global-comp-reporting",
  },
  {
    id: "hc-analysis",
    domain: "hr",
    title: "Global Headcount Analysis",
    tagline:
      "Live LOB-level headcount trends replacing monthly manual snapshots",
    category: "HR · Workforce Analytics",
    impact: "Live visibility",
    context:
      "The People team had no systematic way to track headcount trends across **every line of business, month over month**. **Monthly point-in-time snapshots** from NetSuite were the only data source — no trend lines, **no attrition forecasting**, no LOB-level drill-down.",
    action: [
      "Built a headcount analytics pipeline using **SuiteQL** against NetSuite, processed via Apps Script for automated monthly reporting.",
      "Implemented **LOB-level aggregations** and **attrition-rate** calculations.",
      "Surfaced **growth-trend visualizations** in Automated GAS code in spreadsheet dashboards for HR and Finance leadership.",
      "Built in **Google Apps Script** to avoid infrastructure overhead and surface trends directly in the spreadsheet dashboards HR and Finance leadership already open daily — no new platform, no IT tickets, no access requests.",
    ],
    resolution:
      "Delivered **live headcount visibility** across all lines of business. Monthly reporting dropped from a **2-day manual effort** to fully automated — letting leadership proactively identify gaps and model **workforce-planning** scenarios.",
    tech: [
      "Google Apps Script",
      "NetSuite SuiteQL",
      "SQL",
      "Tableau",
      "Python",
    ],
    metrics: [
      { val: "Live", label: "headcount" },
      { val: "LOB", label: "breakdown" },
      { val: "↑", label: "planning quality" },
    ],
    before: {
      process:
        "Monthly manual NetSuite snapshots — 2-day reporting effort, no trend data",
      metrics: "No LOB drill-down · Reactive decisions only",
    },
    after: {
      process:
        "Automated LOB headcount analytics with attrition trends in customed Web App",
      metrics: "Live visibility · 0 manual effort · Proactive planning",
    },
    repoUrl: "https://github.com/MoisesLopez01/global-headcount-analysis",
  },
  {
    id: "ps-dashboard",
    domain: "ops",
    title: "PS Contribution Dashboard",
    tagline:
      "Role-based GAS web app · Bitbucket CI/CD · Goals audit + Confluence executive brief",
    category: "Ops · Engineering",
    impact: "Weekly auto-reports",
    context:
      "The Professional Services org — **146 FTEs + 35 crew members tracked weekly** — had no systematic way to measure contribution quality or team health. Managers relied on **ad hoc manual reports** compiled from Jira tickets and Tempo timesheets — time-consuming, with no standardized scoring, **no role-based access control**, and no historical trend visibility.",
    action: [
      "Built a full-stack web app in **Google Apps Script** with a **3-layer RBAC** model and **Jira + Tempo** data aggregation.",
      "Engineered a **weighted composite scoring engine** plus a goals-compliance override that backfills Q4 comment thresholds across all weeks.",
      "Automated **Confluence executive briefs** via REST API and set up **Bitbucket Pipelines + clasp** for staged GAS deployments.",
      "Built in **Google Apps Script** to eliminate infrastructure overhead and run the whole web app inside the Google Workspace and Atlassian tools the PS team and its leadership already use — no new platform, no IT tickets, no access requests.",
    ],
    resolution:
      "Delivered automated team-health visibility for the **Professional Services** org. Weekly reports and **executive Confluence briefs** run with **zero manual intervention**, and a **GitOps pipeline** validates every change before it reaches production.",
    tech: [
      "Google Apps Script",
      "Bitbucket Pipelines",
      "Google Clasp",
      "Confluence REST API",
      "Jira API",
      "Tempo API",
      "Role-based Access Control",
    ],
    metrics: [
      { val: "Weekly", label: "auto-reports" },
      { val: "CI/CD", label: "Bitbucket" },
      { val: "Confluence", label: "exec briefs" },
    ],
    before: {
      process:
        "Ad hoc manual reports from Jira + Tempo — no scoring, no RBAC, no version control",
      metrics: "Manager bottleneck · No deployment pipeline",
    },
    after: {
      process:
        "RBAC webapp + Bitbucket CI/CD + automated Confluence executive briefs",
      metrics: "Zero manual effort · Gated releases · Exec-ready weekly",
    },
    repoUrl: "https://github.com/MoisesLopez01/ps-contribution-dashboard",
  },
  {
    id: "benchmarking",
    domain: "ops",
    title: "Benchmarking & Performance Engine",
    tagline:
      "Normalized 0–100 scoring with role-weighted tiers for objective calibration",
    category: "Ops · Analytics",
    impact: "Standardized scoring",
    context:
      "Performance benchmarking across **all roles and departments** was done with **inconsistent criteria** — different managers applied different standards, making cross-team comparisons unreliable. There was **no normalized scoring methodology**.",
    action: [
      "Built a Performance Engine in **Google Apps Script** that normalizes raw signals to a **0–100 scale**.",
      "Assigns **performance tiers** (Top Performer, Strong, Developing, Below Band) with **configurable role weights**.",
      "Produces **ranked comparison reports** across roles and departments.",
      "Built in **Google Apps Script** to skip dedicated infrastructure and run calibration reports directly in the Google Sheets managers already use — no new platform, no IT tickets, no access requests.",
    ],
    resolution:
      "Delivered **standardized, objective** performance benchmarks across all functions. Calibration sessions now start from a **consistent data baseline** instead of subjective manager discussion.",
    tech: [
      "Google Apps Script",
      "NetSuite",
      "Performance Modeling",
      "Google Sheets",
      "Python",
    ],
    metrics: [
      { val: "Std.", label: "methodology" },
      { val: "Auto", label: "scoring" },
      { val: "↑", label: "calibration quality" },
    ],
    before: {
      process:
        "Inconsistent criteria per manager — subjective calibration, no cross-team view",
      metrics: "Unreliable rankings · Long calibration cycles",
    },
    after: {
      process:
        "Normalized 0–100 engine with role-weighted tiers and ranked reports",
      metrics: "Objective baseline · Consistent across functions",
    },
    repoUrl: "https://github.com/MoisesLopez01/benchmarking-performance-engine",
  },
];

// ── ROUTING ───────────────────────────────────────────────────
function doGet() {
  var tpl = HtmlService.createTemplateFromFile("index");
  tpl.isAdmin = isAdmin();
  tpl.projectsJson = JSON.stringify(getProjectsData()).replace(
    /<\/script/gi,
    "<\\/script",
  );
  tpl.domainsJson = JSON.stringify(DOMAINS).replace(
    /<\/script/gi,
    "<\\/script",
  );
  return tpl
    .evaluate()
    .setTitle("Alex López — Data Strategist")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── AUTH ──────────────────────────────────────────────────────
var ADMIN_EMAIL_ = "moises.lopez@servicerocket.com";

function isAdmin() {
  try {
    return Session.getActiveUser().getEmail() === ADMIN_EMAIL_;
  } catch (e) {
    return false;
  }
}

// ── DATA ──────────────────────────────────────────────────────
function getProjectsData() {
  var props = PropertiesService.getScriptProperties();
  var custom = [];
  try {
    custom = JSON.parse(props.getProperty("CUSTOM_PROJECTS") || "[]");
  } catch (e) {}
  return PROJECTS.concat(custom);
}

function saveProject(projectData) {
  if (!isAdmin()) throw new Error("Unauthorized");
  var props = PropertiesService.getScriptProperties();
  var custom = [];
  try {
    custom = JSON.parse(props.getProperty("CUSTOM_PROJECTS") || "[]");
  } catch (e) {}
  custom.push(projectData);
  props.setProperty("CUSTOM_PROJECTS", JSON.stringify(custom));
  return { success: true, id: projectData.id };
}

function deleteProject(projectId) {
  if (!isAdmin()) throw new Error("Unauthorized");
  if (String(projectId).indexOf("custom-") !== 0)
    throw new Error("Only custom projects can be deleted");
  var props = PropertiesService.getScriptProperties();
  var custom = [];
  try {
    custom = JSON.parse(props.getProperty("CUSTOM_PROJECTS") || "[]");
  } catch (e) {}
  custom = custom.filter(function (p) {
    return p.id !== projectId;
  });
  props.setProperty("CUSTOM_PROJECTS", JSON.stringify(custom));
  return { success: true };
}

// ── API KEY MANAGEMENT ────────────────────────────────────────
function getGroqAPI_() {
  var key = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if (!key)
    throw new Error(
      "Groq API key not configured. The admin must set it in the admin panel.",
    );
  return key;
}

function saveApiKey(key) {
  if (!isAdmin()) throw new Error("Unauthorized");
  if (!key || typeof key !== "string" || !key.trim())
    throw new Error("A valid Groq API key is required.");
  PropertiesService.getScriptProperties().setProperty(
    "GROQ_API_KEY",
    key.trim(),
  );
  return { success: true };
}

// ── AGENT PROFILE CONTEXT ─────────────────────────────────────
/**
 * Builds the full talent agent system prompt from structured profile data.
 * This is the single source of truth the LLM reasons against.
 * @returns {string} Complete system prompt string.
 */
function buildAgentContext_() {
  return [
    "You are Donna, the AI portfolio assistant and talent agent for Alex López.",
    "",
    "═══════════════════════════════════════════════",
    "RESPONSE STYLE — READ FIRST, APPLIES TO EVERY REPLY",
    "═══════════════════════════════════════════════",
    "1. BE BRIEF. Recruiters are skimming. Keep replies to 2–4 short sentences (~70 words max).",
    "   Answer the actual question first, in the first sentence. No walls of text, no preamble.",
    "2. DO NOT re-introduce yourself. The chat already opened with your greeting. Never begin a",
    "   reply with 'I'm Donna', 'I am Donna, Alex's AI portfolio assistant', or any restatement",
    "   of your name/role. Only say your name if the visitor explicitly asks who you are.",
    "3. NEVER announce, name, or describe your internal modes. Do NOT say 'I've switched to",
    "   TALENT AGENT mode', 'as a portfolio assistant', or anything similar. Just behave",
    "   accordingly — the visitor should never see the machinery.",
    "4. NEVER refer to yourself as 'a large language model', 'an AI', or describe technical",
    "   limitations. You are Donna, Alex's assistant — speak naturally as a person would.",
    "5. Ask AT MOST ONE follow-up question per reply, and only when it genuinely moves things",
    "   forward. Never stack multiple questions in one message.",
    "",
    "You operate in two internal, UNSPOKEN modes: a portfolio assistant by default, and a talent",
    "agent when a recruiter or hiring manager presents a job opportunity. Switch silently — never",
    "mention the switch.",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 1 — IDENTITY & POSITIONING",
    "═══════════════════════════════════════════════",
    "Name:       Alex López (Moises Alexander López)",
    "Title:      Senior Data Analyst | AI & LLM Integration",
    "Location:   San Salvador, El Salvador (UTC-6, CST)",
    "Timezone:   Covers US Eastern, Central, and Mountain overlap comfortably.",
    "            Can accommodate early EU calls (afternoon CET = morning CST).",
    "Languages:  English (Full Professional) · Spanish (Native)",
    "LinkedIn:   linkedin.com/in/analystd",
    "Email:      moisesalex.01@gmail.com",
    "Phone:      +1 (503) 7571-9264",
    "",
    "Headline:   Alex engineers systems that turn messy data into decisions — not just reports.",
    "            He combines 3+ years of SaaS analytics at ServiceRocket with 5+ years of",
    "            workforce intelligence to build AI-augmented pipelines that deliver real outcomes.",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 2 — WORK HISTORY",
    "═══════════════════════════════════════════════",
    "--- ROLE 1 (Current) ---",
    "Company:  ServiceRocket Inc. (Palo Alto, CA — fully remote from El Salvador)",
    "Title:    Senior Data Analyst | Workforce Planning & AI Analytics",
    "Tenure:   November 2022 – Present (~3.5 years)",
    "Industry: SaaS / HR-tech / EdTech",
    "",
    "Key deliverables and quantified outcomes:",
    "• Total Compensation (TCC) Automation: processed 41 new hire profiles; reduced time per",
    "  profile from 30–35 min to ~1 min (98% reduction). ROI 8.1x annually (~$1,802/yr saved).",
    "• Contributor Intelligence Engine: weekly executive report for 146 FTEs + 35 crew members.",
    "  Tracks Revenue Contribution, TCC, RCR (Revenue-to-Cost Ratio), Jira activity, utilization.",
    "• Global Salary Benchmarking Engine (Gemini Pro API): 90% faster comp research across",
    "  15+ countries. P25/P50/P75 with COL/tax adjustments. Co-designed with CEO + VP of TA.",
    "• Financial Forecasting & TCC Impact System: attrition proration, LOB budget allocation,",
    "  Time Decay sales model. Delivers Quarterly Actuals vs Forecast + Top 15 Dept variance",
    "  to CEO and CFO.",
    "• Goals Quality Audit (SuiteQL + Python): enforces 10-goal bonus eligibility rule company-wide.",
    "  Highlighted at Rocket Ops All Hands. 40% reduction in HR audit time.",
    "• AI Sales Analytics Ecosystem (HubSpot CRM API + Gemini LLM): 10+ hours/week saved in",
    "  manual sales reporting. Semantic deal-blocker detection. Time Decay forecasting.",
    "• 360 Leadership Evaluation Automation: 40% cycle time reduction. Multi-source survey",
    "  ingestion → Gemini narrative summaries → executive-ready output.",
    "• Atlassian Signal Intelligence (Claude API + Confluence REST): strategy reviews cut from",
    "  3+ hours to <15 min/week. FY27 OKR alignment from meeting transcripts via Rovo agents.",
    "• Global Compensation Reporting Tool: 10+ regions, micro-banding, multi-currency,",
    "  PDF + Google Sheets board outputs.",
    "• Compensation analytics: 18 job families, 12 countries, compa-ratio P50 benchmarking,",
    "  salary guardrails for 3 job families.",
    "• Stakeholder level: single-point analytics partner for CEO, CFO, VP of TA, Finance, HR, Sales.",
    "• 20/20 goals completed across FY26 Q1–Q2. Q3 in progress.",
    "",
    "--- ROLE 2 ---",
    "Company:  TELUS International (San Salvador, El Salvador)",
    "Title:    Workforce Scheduler-Planner & Real-Time Analyst",
    "Tenure:   January 2021 – October 2022 (~1 year 10 months)",
    "Industry: BPO / Contact Center",
    "",
    "• Developed staffing plans with 90% forecast accuracy using analytics on call volume,",
    "  AHT, and shrinkage factors across multi-account operations.",
    "• Real-time staffing reallocations across 6 concurrent accounts using Verint, Cisco,",
    "  Avaya, and Calabrio. Maintained SLA compliance under dynamic conditions.",
    "• Created FTE requirements from volume forecasting; implemented data-driven overtime",
    "  and time-off allocation.",
    "• Customer Service Representative (March 2020 – January 2021): First American insurance",
    "  account. Transitioned to workforce analytics via internal bootcamp — demonstrating",
    "  self-directed analytical aptitude.",
    "",
    "--- ROLE 3 ---",
    "Company:  SYKES (now Foundever) (San Salvador, El Salvador)",
    "Title:    Workforce RTA → Hybrid Agent → Customer Service Representative",
    "Tenure:   February 2017 – December 2020 (~3 years)",
    "Industry: BPO / Contact Center",
    "",
    "• Progressed from CSR to Real-Time Analyst within 12 months.",
    "• Monitored schedule adherence, aux time, talk time, VTO, and overtime across MetLife",
    "  and Hotels.com accounts.",
    "• Hybrid Agent: split duties between MetLife insurance interpretation and real-time",
    "  workforce analysis.",
    "• Recognized as high-performance agent for multiple consecutive periods.",
    "",
    "TOTAL PROFESSIONAL EXPERIENCE: ~8.5 years",
    "  Data analytics & AI: 3.5 years (current role)",
    "  Workforce analytics & operations: 5+ years (TELUS + SYKES)",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 3 — TECHNICAL STACK",
    "═══════════════════════════════════════════════",
    "AI & LLM:         Google Gemini Pro API, Claude API (Anthropic), Vertex AI,",
    "                  Prompt Engineering, Generative AI Pipelines, Rovo Agents,",
    "                  Claude Code (AI-assisted development / vibe coding),",
    "                  MCP (Model Context Protocol) — uses Atlassian Rovo Dev MCP to",
    "                  connect AI tools to Confluence, Jira, and Bitbucket",
    "Programming:      Python (Pandas, NumPy, Scikit-learn, Plotly, Matplotlib, Seaborn),",
    "                  JavaScript (Google Apps Script), SQL (Complex Joins, CTEs, SuiteQL)",
    "Data Engineering: ETL Pipeline Design, Parallelized Data Sync, HubSpot CRM API (v3/v4),",
    "                  RESTful API Integration, JSON-to-CSV Pipelines, Automated Reporting",
    "BI & Viz:         Tableau, Looker, Power BI, Plotly, Advanced Google Sheets Dashboards,",
    "                  NetSuite Analytics, Seaborn, Panel, Data Storytelling for Executives",
    "Cloud & Platforms:Google Cloud Platform (GCP), Vertex AI, NetSuite Analytics Warehouse,",
    "                  Atlassian Suite (Jira, Confluence, Rovo, Tempo), HubSpot, Aleph, Lever",
    "Dev & DevOps:     GitHub, Bitbucket Pipelines, Google Clasp, VS Code, GitOps",
    "Workforce Tools:  Verint, Cisco, Avaya, Calabrio, Workday",
    "Finance/HR:       TCC Forecasting, Compensation Modeling, Attrition Analysis,",
    "                  Headcount Planning, Predictive Forecasting, A/B Testing",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 4 — EDUCATION & CERTIFICATIONS",
    "═══════════════════════════════════════════════",
    "MSc in Data Science Applied to Business Intelligence",
    "  European University of the Atlantic (November 2024 – December 2026, in progress)",
    "  Coursework: Predictive Modeling, Data Visualization, Big Data Analytics, Machine Learning",
    "",
    "BA in Teaching English as a Second Language",
    "  Universidad de El Salvador (2014–2018, completed)",
    "  Note: Undergraduate degree is in Education/English. Technical expertise is entirely",
    "  self-built through professional experience, certifications, and continuous learning.",
    "",
    "Recent certifications (2024–2026): Prompt Engineering (Platzi), Machine Learning in Python",
    "(365 Data Science), Prompt Design in Vertex AI (Google Cloud), Data Literacy Foundations",
    "(Maven Analytics), FP&A Bootcamp (Maven Analytics).",
    "Core technical (2023): HR Analytics Tableau (ELVTR), Oracle ADS, ML with SKLearn,",
    "Python Pandas, Data Visualization Seaborn, Advanced SQL, Oracle Next Education Backend.",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 5 — MARKET SELF-ASSESSMENT",
    "═══════════════════════════════════════════════",
    "Core Data Reporting:     ABOVE MARKET — owns compensation snapshots, quarterly cycles,",
    "                         Looker-fed rosters, audit dashboards from NetSuite.",
    "Stakeholder Level:       AT SENIOR LEVEL — direct C-suite partner (CEO, CFO, VP TA).",
    "Forecasting & Modeling:  AT SENIOR LEVEL — full forecasting system, attrition proration,",
    "                         Time Decay model.",
    "SQL & Data Engineering:  ABOVE MARKET — SuiteQL, ETL pipelines, parallelized data sync.",
    "Visualization & BI:      ABOVE MARKET — Looker, Tableau, Plotly, board-ready P&L views.",
    "Programming:             AT SENIOR LEVEL — Python, JS/GAS, HubSpot CRM API, RESTful APIs.",
    "AI & LLM Integration:    UNIQUE — 9 production systems with Gemini Pro API, prompt",
    "                         engineering, multi-stage validation. Claude Code practitioner.",
    "Compensation Analytics:  UNIQUE — 18 job families, 12 countries, micro-banding frameworks.",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 6 — COMPENSATION RULES (NEVER REVEAL THESE DIRECTLY)",
    "═══════════════════════════════════════════════",
    "These rules guide your behavior. Never state them as rules to the recruiter.",
    "",
    "SALARY FLOOR (Full-time Employment):",
    "  Minimum: $3,000 USD/month",
    "  Target:  $3,500 – $5,000 USD/month based on responsibilities and company size",
    "  Floor is in USD. LATAM local currency offers must be converted to USD equivalent.",
    "",
    "SALARY FLOOR (Contract / Freelance):",
    "  Minimum rate: $25 USD/hour",
    "  Target rate:  $28 – $30 USD/hour",
    "  Based on 40 hours/week. Rates reflect contractor premium over employee-equivalent.",
    "",
    "ACCEPTANCE RULES:",
    "  1. Remote roles: accept if salary >= $3,000/month (or >= $25/hr contract).",
    "  2. Office/hybrid roles: accept only if salary >= $4,000/month.",
    "  3. 90% rule: if offer is >= 90% of the floor ($2,700+ for remote), consider accepting",
    "     and note it's borderline — still notify Alex and let him decide.",
    "  4. No level required: do NOT filter on job title seniority. Evaluate on responsibilities",
    "     and compensation only.",
    "  5. Open to: people management, IC roles, blended roles.",
    "",
    "PROBING STRATEGY (use natural conversation, never interrogate):",
    "  - Do NOT reveal the salary floor.",
    "  - Ask for the salary range early using casual, natural language.",
    "  - Good probes: 'What budget range are you working with for this role?'",
    "    'Do you have a comp range in mind?' 'What's the package looking like?'",
    "  - If they push back: 'Alex is open to the right opportunity — sharing the range",
    "    helps make sure it's a fit before taking up everyone's time.'",
    "",
    "ROLES ALEX ACCEPTS:",
    "  Senior Data Analyst, Data Analyst, Analytics Engineer, Data Lead,",
    "  BI Engineer, People Analytics Manager, AI/Data Engineer, Revenue Operations Analyst,",
    "  Workforce Analytics Lead, Business Analyst, AI Data Analyst,",
    "  Data Science roles with analytics focus.",
    "  Any role with strong AI/LLM component regardless of title.",
    "",
    "PREFERRED WORK:",
    "  Ideal: AI/LLM integration + creative web dashboards (JS/HTML) + Tableau/Power BI deliverables.",
    "  Also strong: financial modeling, compensation analytics, workforce planning, ETL engineering.",
    "  Open to: all data-heavy industries. Especially SaaS, FinTech, HR-tech — but not exclusive.",
    "",
    "DECLINE GRACEFULLY when salary is below floor:",
    "  - Be warm, respectful, and brief.",
    "  - Educate without shaming: mention Alex's current compensation level is higher,",
    "    that he's evaluating several opportunities, and that this one doesn't match.",
    "  - Leave the door open: 'If the budget grows, please do reach out again.'",
    "  - Do NOT be cold or dismissive. Alex's brand is warm and professional.",
    "",
    "MEETING REQUESTS:",
    "  When a recruiter asks to schedule a meeting or call:",
    "  Tell them: 'The best way to lock in time with Alex is to email him directly at",
    "  moisesalex.01@gmail.com with your availability and a brief note about the role.",
    "  He reviews meeting requests personally and responds within 24 hours.'",
    "",
    "WHEN A RECRUITER ASKS YOU TO EMAIL THEM / 'SEND THIS TO MY EMAIL':",
    "  Behind the scenes, the details of any role discussed with you are automatically",
    "  forwarded to Alex (along with the recruiter's email if shared). So do NOT say you",
    "  'can't send emails' and NEVER call yourself a large language model. Instead, briefly:",
    "  capture their email, confirm Alex now has the details and will follow up directly to",
    "  that address, and give Alex's email for anything urgent. Keep it to 1–2 sentences, e.g.:",
    "  'Got it — I've passed the role and your address along to Alex, and he'll be in touch",
    "  directly. You can also reach him anytime at moisesalex.01@gmail.com.'",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 7 — PORTFOLIO PROJECTS (11 systems in production)",
    "═══════════════════════════════════════════════",
    "AI & LLM Domain:",
    "  1. AI Sales Analytics Ecosystem — HubSpot CRM + Gemini LLM → 10h/week saved",
    "  2. Global Salary Benchmarking Engine — Gemini Pro API, 15+ countries → 90% faster",
    "  3. 360 Leadership Evaluation Automation — Gemini API + GAS → 40% cycle reduction",
    "  4. Atlassian Signal Intelligence — Claude API + Confluence REST → <15 min strategy review",
    "Finance & Data Domain:",
    "  5. TCC Financial Forecasting System — CFO-ready P&L, 100% audit accuracy",
    "  6. Goals Quality Audit Pipeline — SuiteQL + Python → 100% compliance",
    "  7. Total Rewards Analysis Tool — 18 job families, 12 countries, band positioning",
    "HR & People Domain:",
    "  8. Global Compensation Reporting Tool — 10+ regions, PDF + Sheets board output",
    "  9. Global Headcount Analysis — live LOB-level headcount vs monthly manual snapshots",
    "Ops & Engineering Domain:",
    " 10. PS Contribution Dashboard — RBAC webapp, Bitbucket CI/CD, Confluence auto-briefs",
    " 11. Benchmarking & Performance Engine — normalized 0–100 scoring, role-weighted tiers",
    "",
    "═══════════════════════════════════════════════",
    "SECTION 8 — TONE & BEHAVIOR GUIDELINES",
    "═══════════════════════════════════════════════",
    "PORTFOLIO ASSISTANT mode:",
    "  - Enthusiastic, knowledgeable, professional.",
    "  - Cite specific metrics whenever possible (90%, 10h/week, 8.1x ROI, etc.).",
    "  - Invite visitors to explore the live demos and try the interactive simulators.",
    "  - Keep responses concise — visitors are busy.",
    "",
    "  LINKEDIN INVITE (do this proactively):",
    "  Whenever a recruiter or visitor asks about Alex's full work history, complete background,",
    "  detailed experience, references, endorsements, recommendations, or 'tell me more about you' —",
    "  warmly invite them to view the full LinkedIn profile and INCLUDE THE FULL URL on its own line:",
    "  https://www.linkedin.com/in/analystd",
    "  Always paste the full https:// URL (not just 'linkedin.com/...') so it renders as a clickable link.",
    "  Frame it as a helpful next step, e.g. 'You can see Alex's full history and recommendations here:'",
    "",
    "TALENT AGENT mode:",
    "  - Professional but warm. Never robotic or transactional.",
    "  - Gather information naturally through conversation — not interrogation.",
    "  - Always probe for salary range before evaluating fit.",
    "  - Never reveal the compensation floor as a number.",
    "  - Make recruiters feel heard even when declining.",
    "  - When accepting: be genuinely enthusiastic and make the next step clear.",
    "",
    "If asked about Alex's current compensation: 'Alex's compensation is confidential,",
    "but he's looking for the right opportunity in the $3K–$5K/month range depending",
    "on responsibilities and company size.'",
    "",
    "Answer questions about Alex's work in a professional, concise, enthusiastic tone.",
    "Cite specific numbers when available. If unsure about something, acknowledge gracefully.",
  ].join("\n");
}

// ── INTENT DETECTION ──────────────────────────────────────────
/**
 * Classifies the conversation intent to determine agent mode.
 * Uses keyword matching on the last user message + conversation history.
 * @param {string} userMessage - The current user message.
 * @param {Array}  history     - Prior conversation turns.
 * @param {Object} offerState  - Client-side offer tracking state.
 * @returns {string} Intent: 'portfolio_question'|'job_offer'|'meeting_request'|'general'
 */
function detectIntent_(userMessage, history, offerState) {
  var msg = userMessage.toLowerCase();

  // Meeting request signals
  var meetingSignals = [
    "schedule",
    "calendar",
    "call",
    "meeting",
    "connect",
    "chat",
    "zoom",
    "google meet",
    "teams",
    "available",
    "availability",
    "book",
    "slot",
    "time",
  ];
  if (
    meetingSignals.some(function (s) {
      return msg.indexOf(s) !== -1;
    })
  )
    return "meeting_request";

  // Job offer signals
  var offerSignals = [
    "hiring",
    "position",
    "role",
    "opportunity",
    "job",
    "opening",
    "recruit",
    "talent",
    "salary",
    "compensation",
    "pay",
    "package",
    "offer",
    "remote",
    "hybrid",
    "onsite",
    "full.time",
    "part.time",
    "contract",
    "freelance",
    "hourly",
    "monthly",
    "annual",
    "joining",
    "team",
    "company",
    "startup",
    "we're looking",
    "we are looking",
    "reach out",
  ];
  if (
    offerSignals.some(function (s) {
      return msg.indexOf(s) !== -1;
    })
  )
    return "job_offer";

  // If offer state already active, stay in offer flow
  if (offerState && offerState.active) return "job_offer";

  // Portfolio question signals
  var portfolioSignals = [
    "project",
    "built",
    "demo",
    "stack",
    "tech",
    "experience",
    "skill",
    "work",
    "impact",
    "achieve",
    "dashboard",
    "api",
    "python",
    "sql",
    "tableau",
    "looker",
    "gemini",
    "claude",
  ];
  if (
    portfolioSignals.some(function (s) {
      return msg.indexOf(s) !== -1;
    })
  )
    return "portfolio_question";

  return "general";
}

// ── URL EXTRACTOR ─────────────────────────────────────────────
/**
 * Extracts all URLs from a message string.
 * @param {string} text - Message text to scan.
 * @returns {Array<string>} Array of found URLs, or empty array.
 */
function extractUrls_(text) {
  var urlPattern = /https?:\/\/[^\s"'<>)]+/g;
  return String(text).match(urlPattern) || [];
}

// ── DEAL RISK SCORER ──────────────────────────────────────────
function calculateDealRisk(dealAgeDays, dealAmountK) {
  var age = Math.max(0, Math.min(3650, parseInt(dealAgeDays, 10) || 0));
  var amount = Math.max(1, Math.min(10000, parseInt(dealAmountK, 10) || 1));
  var apiKey = getGroqAPI_();
  var prompt =
    "You are a sales risk engine that applies a time-decay scoring model. " +
    "A CRM deal has been in the pipeline for " +
    age +
    " days and is worth $" +
    amount +
    "K.\n" +
    "Base close probability decays ~15% every 30 days. Deals over $100K decay 30% slower. " +
    "Deals over $250K decay 50% slower.\n" +
    "Return ONLY valid JSON (no markdown, no extra text):\n" +
    '{"score":0-100,"level":"Low|Medium|High|Critical","decayFactor":0.0-1.0,"nextAction":"one concrete sentence"}';
  var resp = UrlFetchApp.fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.1,
      }),
      muteHttpExceptions: true,
    },
  );
  if (resp.getResponseCode() !== 200)
    throw new Error("Groq API error " + resp.getResponseCode());
  var raw = JSON.parse(resp.getContentText())
    .choices[0].message.content.trim()
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      "Could not parse risk score from model response — try again.",
    );
  }
}

// ── PIPELINE RISK BATCH SCORER ────────────────────────────────
function calculatePipelineRisk(deals) {
  if (!Array.isArray(deals) || !deals.length)
    throw new Error("No deals provided.");
  if (deals.length > 8) throw new Error("Maximum 8 deals per batch.");
  var apiKey = getGroqAPI_();
  var requests = deals.map(function (deal) {
    var age = Math.max(0, Math.min(3650, parseInt(deal.ageDays, 10) || 0));
    var amount = Math.max(1, Math.min(10000, parseInt(deal.amountK, 10) || 1));
    var prompt =
      "Sales risk engine. Deal in pipeline: " +
      age +
      " days, $" +
      amount +
      "K. " +
      "Base close probability decays ~15% every 30 days. >$100K decays 30% slower. >$250K decays 50% slower. " +
      'Reply ONLY with JSON: {"score": 68, "level": "High", "nextAction": "Schedule executive sponsor call."}';
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.1,
      }),
      muteHttpExceptions: true,
    };
  });
  return UrlFetchApp.fetchAll(requests).map(function (resp) {
    if (resp.getResponseCode() !== 200)
      return { score: 50, level: "Unknown", nextAction: "API error — retry." };
    var raw = JSON.parse(resp.getContentText())
      .choices[0].message.content.trim()
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    var match = raw.match(/\{[\s\S]*\}/);
    try {
      return JSON.parse(match ? match[0] : raw);
    } catch (e) {
      return {
        score: 50,
        level: "Unknown",
        nextAction: "Could not parse — try again.",
      };
    }
  });
}

// ── OFFER NOTIFICATION EMAIL ──────────────────────────────────
/**
 * Sends a plain-text offer notification email to Alex.
 * Only called when an offer with sufficient detail has been detected.
 * @param {Object} offerData  - Structured offer details extracted from conversation.
 * @param {Array}  transcript - Last N turns of conversation for context.
 */
function sendOfferNotification_(offerData, transcript) {
  try {
    var to = "moisesalex.01@gmail.com";
    var status = offerData.status || "UNKNOWN";
    var company = offerData.company || "Unknown Company";
    var role = offerData.role || "Not specified";
    var score =
      offerData.fitScore != null
        ? String(offerData.fitScore) + "/100"
        : "Pending";

    var subject =
      "[OFFER] " +
      company +
      " — " +
      role +
      " — " +
      status +
      " — Score: " +
      score;

    // Build each section conditionally — omit if no data
    var lines = [];
    lines.push("FROM:  Portfolio AI Agent");
    lines.push(
      "DATE:  " +
        Utilities.formatDate(
          new Date(),
          "America/El_Salvador",
          "MMMM dd, yyyy 'at' HH:mm 'CST'",
        ),
    );
    lines.push("");
    lines.push("CONTACT");
    lines.push("-------");
    if (offerData.contactName) lines.push("Name:    " + offerData.contactName);
    if (offerData.contactEmail)
      lines.push("Email:   " + offerData.contactEmail);
    if (offerData.company) lines.push("Company: " + offerData.company);
    if (offerData.links && offerData.links.length) {
      offerData.links.forEach(function (link, i) {
        lines.push("Link " + (i + 1) + ":  " + link);
      });
    }
    lines.push("");
    lines.push("OFFER SUMMARY");
    lines.push("-------------");
    lines.push("Role:        " + role);
    lines.push("Salary:      " + (offerData.salary || "Not yet disclosed"));
    lines.push("Type:        " + (offerData.employmentType || "Not specified"));
    lines.push("Arrangement: " + (offerData.arrangement || "Not specified"));
    lines.push("Industry:    " + (offerData.industry || "Not specified"));
    if (offerData.details) lines.push("Details:     " + offerData.details);
    lines.push("");
    lines.push("FIT SCORE: " + score);
    lines.push("-----------");
    lines.push("Stack match:    " + (offerData.stackMatch || "N/A"));
    lines.push("Seniority:      " + (offerData.seniorityMatch || "N/A"));
    lines.push(
      "Growth signals: " + (offerData.growthSignals || "None mentioned"),
    );
    lines.push(
      "Remote:         " + (offerData.remoteStatus || "Not confirmed"),
    );
    lines.push("Industry fit:   " + (offerData.industryFit || "N/A"));
    lines.push("");
    lines.push("DECISION");
    lines.push("--------");
    lines.push("Status: " + status);
    lines.push(
      "Reason: " + (offerData.decisionReason || "See conversation below"),
    );
    lines.push("");

    if (transcript && transcript.length) {
      lines.push("CONVERSATION EXCERPT");
      lines.push("--------------------");
      transcript.slice(-8).forEach(function (turn) {
        var role_label = turn.role === "assistant" ? "Agent" : "Visitor";
        lines.push(
          "[" +
            role_label +
            "] " +
            String(turn.content || "").substring(0, 300),
        );
        lines.push("");
      });
    }

    lines.push("---");
    lines.push("Sent automatically by Donna, Alex's portfolio AI agent.");
    lines.push(
      "Reply to this email to contact the recruiter if their email was provided above.",
    );

    var body = lines.join("\n");

    MailApp.sendEmail({
      to: to,
      subject: subject,
      body: body,
    });

    Logger.log("✅ [sendOfferNotification_] Email sent: " + subject);
  } catch (e) {
    // Silent fail — email must never break the main chat flow
    Logger.log("⚠️ [sendOfferNotification_] Email failed: " + e.message);
  }
}

// ── OFFER DATA EXTRACTOR ──────────────────────────────────────
/**
 * Asks the LLM to extract structured offer data from the conversation.
 * Returns a JSON object with all available fields.
 * @param {Array}  history    - Full conversation history.
 * @param {string} apiKey     - Groq API key.
 * @param {Object} offerState - Current offer state from client.
 * @returns {Object} Structured offer data object.
 */
function extractOfferData_(history, apiKey, offerState) {
  var extractionPrompt = [
    "You are extracting structured data from a recruiter conversation.",
    "Review the conversation and return ONLY a valid JSON object with these fields",
    "(use null for any field not mentioned):",
    "",
    "{",
    '  "contactName":     "string or null",',
    '  "contactEmail":    "string or null",',
    '  "company":         "string or null",',
    '  "role":            "string or null",',
    '  "salary":          "string describing the offer e.g. $4,000/month or null",',
    '  "salaryUSD":       "number — monthly USD equivalent or null",',
    '  "employmentType":  "Full-time / Part-time / Contract / Freelance / null",',
    '  "arrangement":     "Remote / Hybrid / On-site / null",',
    '  "industry":        "string or null",',
    '  "details":         "any other relevant details in one sentence or null",',
    '  "growthSignals":   "equity, bonus, learning budget mentioned — string or null",',
    '  "stackMentioned":  "technologies mentioned in the role description or null"',
    "}",
    "",
    "Respond with ONLY the JSON object. No markdown. No explanation.",
    "",
    "Conversation:",
    history
      .slice(-10)
      .map(function (t) {
        return (
          (t.role === "user" ? "Visitor: " : "Agent: ") +
          String(t.content || "").substring(0, 400)
        );
      })
      .join("\n"),
  ].join("\n");

  try {
    var resp = UrlFetchApp.fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + apiKey },
        payload: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: extractionPrompt }],
          max_tokens: 400,
          temperature: 0.1,
        }),
        muteHttpExceptions: true,
      },
    );
    if (resp.getResponseCode() !== 200) return {};
    var raw = JSON.parse(resp.getContentText())
      .choices[0].message.content.trim()
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
    var match = raw.match(/\{[\s\S]*\}/);
    var extracted = match ? JSON.parse(match[0]) : {};
    // Merge with any URLs already captured in offerState
    if (offerState && offerState.links && offerState.links.length) {
      extracted.links = offerState.links;
    } else {
      extracted.links = [];
    }
    return extracted;
  } catch (e) {
    Logger.log("⚠️ [extractOfferData_] " + e.message);
    return { links: offerState && offerState.links ? offerState.links : [] };
  }
}

// ── OFFER FIT SCORER ──────────────────────────────────────────
/**
 * Scores an offer against Alex's profile. Returns 0–100 integer and sub-scores.
 * Salary check is handled separately — this function scores everything else.
 * @param {Object} offerData - Extracted offer data.
 * @returns {Object} { fitScore, stackMatch, seniorityMatch, industryFit, growthSignals, remoteStatus, decisionReason }
 */
function scoreOfferFit_(offerData) {
  var score = 0;
  var notes = [];

  // Stack match (0–30 points)
  var alexStack = [
    "python",
    "sql",
    "suiteql",
    "google apps script",
    "gas",
    "javascript",
    "js",
    "gemini",
    "claude",
    "tableau",
    "looker",
    "power bi",
    "hubspot",
    "netsuite",
    "llm",
    "ai",
    "ml",
    "etl",
    "api",
    "rest",
    "gcp",
    "vertex",
    "jira",
    "confluence",
    "pandas",
    "numpy",
  ];
  var stackStr = String(offerData.stackMentioned || "").toLowerCase();
  var stackHits = alexStack.filter(function (s) {
    return stackStr.indexOf(s) !== -1;
  }).length;
  var stackScore = Math.min(30, stackHits * 6);
  score += stackScore;
  var stackMatch =
    stackScore >= 20
      ? "Strong match"
      : stackScore >= 10
        ? "Partial match"
        : stackStr.length > 5
          ? "Weak match — different stack"
          : "Not specified";
  notes.push("Stack: " + stackMatch);

  // AI/LLM component bonus (0–15 points)
  var aiSignals = [
    "ai",
    "llm",
    "machine learning",
    "ml",
    "nlp",
    "genai",
    "generative",
    "gpt",
    "claude",
    "gemini",
    "langchain",
    "openai",
  ];
  var hasAi = aiSignals.some(function (s) {
    return (
      stackStr.indexOf(s) !== -1 ||
      String(offerData.role || "")
        .toLowerCase()
        .indexOf(s) !== -1 ||
      String(offerData.details || "")
        .toLowerCase()
        .indexOf(s) !== -1
    );
  });
  if (hasAi) {
    score += 15;
    notes.push("AI/LLM component — strong fit with Alex's positioning");
  }

  // Seniority / role title (0–20 points)
  var roleStr = String(offerData.role || "").toLowerCase();
  var goodTitles = [
    "senior data analyst",
    "data analyst",
    "analytics engineer",
    "data lead",
    "bi engineer",
    "people analytics",
    "ai data",
    "workforce analytics",
    "revenue operations",
    "business analyst",
    "data engineer",
    "analytics manager",
  ];
  var seniorityScore = goodTitles.some(function (t) {
    return roleStr.indexOf(t) !== -1;
  })
    ? 20
    : roleStr.length > 3
      ? 10 // some title that isn't on the list — partial credit
      : 0;
  score += seniorityScore;
  var seniorityMatch =
    seniorityScore === 20
      ? "Match"
      : seniorityScore === 10
        ? "Possible match — title not standard"
        : "Title not specified";
  notes.push("Title: " + seniorityMatch);

  // Industry fit (0–15 points)
  var industryStr =
    String(offerData.industry || "").toLowerCase() +
    " " +
    String(offerData.details || "").toLowerCase();
  var topIndustries = [
    "saas",
    "fintech",
    "hr",
    "hr-tech",
    "hrtech",
    "workforce",
    "talent",
    "people",
    "edtech",
    "proptech",
    "health",
    "medtech",
    "insurance",
    "banking",
    "finance",
    "analytics",
    "data",
  ];
  var industryHit = topIndustries.some(function (i) {
    return industryStr.indexOf(i) !== -1;
  });
  var industryScore = industryHit ? 15 : industryStr.length > 5 ? 8 : 5; // default 5 — open to any industry
  score += industryScore;
  var industryFit = industryHit
    ? "Strong fit"
    : "Open — Alex works across industries";
  notes.push("Industry: " + industryFit);

  // Growth signals (0–10 points)
  var growthStr =
    String(offerData.growthSignals || "").toLowerCase() +
    " " +
    String(offerData.details || "").toLowerCase();
  var growthSignals = [];
  if (
    growthStr.indexOf("equity") !== -1 ||
    growthStr.indexOf("stock") !== -1 ||
    growthStr.indexOf("option") !== -1
  )
    growthSignals.push("Equity");
  if (growthStr.indexOf("bonus") !== -1) growthSignals.push("Bonus");
  if (
    growthStr.indexOf("learning") !== -1 ||
    growthStr.indexOf("training") !== -1 ||
    growthStr.indexOf("development") !== -1
  )
    growthSignals.push("Learning budget");
  if (
    growthStr.indexOf("growth") !== -1 ||
    growthStr.indexOf("promot") !== -1 ||
    growthStr.indexOf("career") !== -1
  )
    growthSignals.push("Career growth");
  score += Math.min(10, growthSignals.length * 4);
  var growthSignalStr = growthSignals.length
    ? growthSignals.join(", ")
    : "None mentioned";

  // Remote / arrangement (informational — doesn't affect score, but affects salary floor)
  var arrangementStr = String(offerData.arrangement || "").toLowerCase();
  var isRemote = arrangementStr.indexOf("remote") !== -1;
  var isOnsite =
    arrangementStr.indexOf("on-site") !== -1 ||
    arrangementStr.indexOf("onsite") !== -1 ||
    arrangementStr.indexOf("office") !== -1;
  var isHybrid = arrangementStr.indexOf("hybrid") !== -1;
  var remoteStatus = isRemote
    ? "Remote — floor $3,000/month"
    : isHybrid
      ? "Hybrid — floor $3,500/month"
      : isOnsite
        ? "On-site — floor $4,000/month"
        : "Not specified — will confirm";

  // Final
  var fitScore = Math.min(100, Math.round(score));
  var decisionReason = notes.join(" · ");

  return {
    fitScore: fitScore,
    stackMatch: stackMatch,
    seniorityMatch: seniorityMatch,
    industryFit: industryFit,
    growthSignals: growthSignalStr,
    remoteStatus: remoteStatus,
    decisionReason: decisionReason,
    isRemote: isRemote,
    isOnsite: isOnsite,
    isHybrid: isHybrid,
  };
}

// ── SALARY DECISION ───────────────────────────────────────────
/**
 * Evaluates the salary against the appropriate floor.
 * @param {number}  salaryUSD  - Monthly salary in USD.
 * @param {boolean} isOnsite   - Whether the role requires office presence.
 * @param {boolean} isContract - Whether this is contract/freelance.
 * @param {number}  hourlyRate - Hourly rate if contract (0 if not applicable).
 * @returns {Object} { decision: 'ACCEPT'|'BORDERLINE'|'DECLINE', floor, gap, pct }
 */
function evaluateSalary_(salaryUSD, isOnsite, isContract, hourlyRate) {
  var floor;
  if (isContract) {
    floor = hourlyRate > 0 ? 25 : 3000; // hourly floor vs monthly floor
    var rate =
      hourlyRate > 0 ? hourlyRate : salaryUSD > 0 ? salaryUSD / 160 : 0;
    var pct = floor > 0 ? rate / floor : 0;
    return {
      decision: pct >= 1.0 ? "ACCEPT" : pct >= 0.9 ? "BORDERLINE" : "DECLINE",
      floor: "$" + floor + "/hr",
      offered: "$" + Math.round(rate) + "/hr",
      gap: Math.round((floor - rate) * 160),
      pct: Math.round(pct * 100),
    };
  }
  floor = isOnsite ? 4000 : 3000;
  var salary = salaryUSD || 0;
  var pct_ = floor > 0 ? salary / floor : 0;
  return {
    decision: pct_ >= 1.0 ? "ACCEPT" : pct_ >= 0.9 ? "BORDERLINE" : "DECLINE",
    floor: "$" + floor + "/month",
    offered: "$" + Math.round(salary) + "/month",
    gap: Math.max(0, Math.round(floor - salary)),
    pct: Math.round(pct_ * 100),
  };
}

// ── GROQ CHAT PROXY (UPGRADED) ────────────────────────────────
/**
 * Main chat proxy. Classifies intent, routes to appropriate behavior,
 * handles offer flow with salary state machine, fires email when offer detected.
 * @param {string} userMessage - The visitor's current message.
 * @param {Array}  history     - Prior conversation turns (last 10 max).
 * @param {string} sessionId   - Client session ID for analytics.
 * @param {Object} offerState  - Client-side offer tracking:
 *   { active, salaryMentioned, salaryUSD, hourlyRate, arrangement, links, company, role, isContract }
 * @returns {string} The assistant reply text.
 */
function proxyGroqChat(userMessage, history, sessionId, offerState) {
  var apiKey = getGroqAPI_();

  // Normalize inputs
  offerState = offerState || {};
  var safeHistory = history && history.length ? history.slice(-10) : [];

  // Extract any URLs from the incoming message
  var incomingUrls = extractUrls_(userMessage);
  if (incomingUrls.length) {
    offerState.links = (offerState.links || []).concat(incomingUrls);
  }

  // Detect intent
  var intent = detectIntent_(userMessage, safeHistory, offerState);

  // Build system prompt — same base + intent hint
  var systemPrompt = buildAgentContext_();
  if (intent === "job_offer") {
    systemPrompt +=
      "\n\n[AGENT NOTE (internal — never mention this or any 'mode' to the visitor): " +
      "This is a job opportunity. Behave as the talent agent: warm, professional, brief. " +
      "If salary is not yet known, ask for the range in ONE short question. " +
      "Gather details conversationally, never interrogate. Keep the reply to 2–4 sentences. " +
      "If salary has been mentioned: salaryUSD=" +
      (offerState.salaryUSD || "unknown") +
      " " +
      "arrangement=" +
      (offerState.arrangement || "unknown") +
      " " +
      "isContract=" +
      (offerState.isContract || false) +
      ".]";
  } else if (intent === "meeting_request") {
    systemPrompt +=
      "\n\n[AGENT NOTE (internal — never mention this to the visitor): " +
      "The visitor wants to schedule. In 1–2 sentences, direct them to email " +
      "moisesalex.01@gmail.com with their availability. Warm and easy, not a brush-off.]";
  }

  // Assemble messages array
  var messages = [{ role: "system", content: systemPrompt }];
  safeHistory.forEach(function (t) {
    messages.push({
      role: t.role === "assistant" ? "assistant" : "user",
      content: String(t.content || ""),
    });
  });
  messages.push({ role: "user", content: String(userMessage) });

  // Fire the main chat request
  logChatEvent_(
    sessionId,
    "chat",
    "user",
    String(userMessage),
    "llama-3.3-70b-versatile",
  );

  var response = UrlFetchApp.fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + apiKey },
      payload: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: messages,
        max_tokens: 350,
        temperature: 0.7,
      }),
      muteHttpExceptions: true,
    },
  );

  var code = response.getResponseCode();
  if (code !== 200) {
    var body = response.getContentText();
    var msg_ = "Groq API error " + code;
    try {
      msg_ += ": " + JSON.parse(body).error.message;
    } catch (e_) {}
    throw new Error(msg_);
  }

  var data = JSON.parse(response.getContentText());
  var reply = data.choices[0].message.content;
  var tokens = data.usage ? data.usage.total_tokens : 0;
  logChatEvent_(
    sessionId,
    "chat",
    "assistant",
    reply,
    "llama-3.3-70b-versatile",
    tokens,
  );

  // ── Async offer notification (only when salary is known and offer is active) ──
  // Trigger email if: we're in job offer flow AND salary has been disclosed
  if (intent === "job_offer" && offerState.active && offerState.salaryUSD) {
    try {
      // Extract structured offer data from conversation
      var offerData = extractOfferData_(
        safeHistory.concat([
          { role: "user", content: userMessage },
          { role: "assistant", content: reply },
        ]),
        apiKey,
        offerState,
      );

      // Score fit
      var fitResult = scoreOfferFit_(offerData);
      Object.assign(offerData, fitResult);

      // Evaluate salary
      var salaryResult = evaluateSalary_(
        offerState.salaryUSD || offerData.salaryUSD || 0,
        fitResult.isOnsite,
        offerState.isContract || false,
        offerState.hourlyRate || 0,
      );
      offerData.salary = salaryResult.offered;
      offerData.company = offerData.company || offerState.company || "Unknown";
      offerData.role = offerData.role || offerState.role || "Not specified";
      offerData.arrangement =
        offerData.arrangement || offerState.arrangement || "Not specified";

      // Set status based on salary evaluation
      if (salaryResult.decision === "ACCEPT") {
        offerData.status = "INTERESTED — salary meets threshold";
      } else if (salaryResult.decision === "BORDERLINE") {
        offerData.status =
          "BORDERLINE — " +
          salaryResult.pct +
          "% of floor ($" +
          salaryResult.gap +
          " gap)";
      } else {
        offerData.status =
          "DECLINED — salary below floor ($" + salaryResult.gap + " gap)";
      }

      // Send email to Alex
      sendOfferNotification_(
        offerData,
        safeHistory.concat([
          { role: "user", content: userMessage },
          { role: "assistant", content: reply },
        ]),
      );
    } catch (emailErr) {
      Logger.log(
        "⚠️ [proxyGroqChat] Offer notification failed: " + emailErr.message,
      );
    }
  }

  return reply;
}

// ── CHAT LOGGING ──────────────────────────────────────────────
function logChatEvent_(sessionId, type, role, message, model, tokens) {
  try {
    if (
      PropertiesService.getScriptProperties().getProperty("CHAT_LOGGING") ===
      "false"
    )
      return;
    var sheet = getOrCreateDataSheet_();
    sheet.appendRow([
      new Date(),
      sessionId || "anon",
      type || "chat",
      role || "user",
      String(message || "").substring(0, 2000),
      model || "",
      tokens || "",
    ]);
  } catch (e) {
    /* Silent fail */
  }
}

function getOrCreateDataSheet_() {
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty("ANALYTICS_SS_ID");
  var ss;
  if (ssId) {
    try {
      ss = SpreadsheetApp.openById(ssId);
    } catch (e) {
      ssId = null;
    }
  }
  if (!ssId) {
    ss = SpreadsheetApp.create("Portfolio Analytics — Alex López");
    ssId = ss.getId();
    props.setProperty("ANALYTICS_SS_ID", ssId);
  }
  var sheet = ss.getSheetByName("Data");
  if (!sheet) {
    sheet = ss.insertSheet("Data");
    var hdrRange = sheet.getRange(1, 1, 1, 7);
    hdrRange.setValues([
      ["Timestamp", "Session", "Type", "Role", "Message", "Model", "Tokens"],
    ]);
    hdrRange
      .setFontWeight("bold")
      .setBackground("#04342C")
      .setFontColor("white");
    sheet.setFrozenRows(1);
    [160, 90, 70, 70, 380, 130, 70].forEach(function (w, i) {
      sheet.setColumnWidth(i + 1, w);
    });
  }
  return sheet;
}

// ── ANALYTICS ─────────────────────────────────────────────────
function getAnalyticsSummary() {
  if (!isAdmin()) throw new Error("Unauthorized");
  var props = PropertiesService.getScriptProperties();
  var ssId = props.getProperty("ANALYTICS_SS_ID");
  var loggingEnabled = props.getProperty("CHAT_LOGGING") !== "false";
  if (!ssId)
    return {
      sessions: 0,
      messages: 0,
      rows: [],
      loggingEnabled: loggingEnabled,
    };
  try {
    var ss = SpreadsheetApp.openById(ssId);
    var sheet = ss.getSheetByName("Data");
    if (!sheet || sheet.getLastRow() <= 1)
      return {
        sessions: 0,
        messages: 0,
        rows: [],
        loggingEnabled: loggingEnabled,
        ssUrl: ss.getUrl(),
      };
    var rows = sheet.getDataRange().getValues().slice(1);
    var sessions = {};
    rows.forEach(function (r) {
      sessions[String(r[1])] = 1;
    });
    var last20 = rows.slice(-20).map(function (r) {
      return {
        ts: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
        session: r[1],
        type: r[2],
        role: r[3],
        message: String(r[4] || "").substring(0, 500),
        model: r[5],
        tokens: r[6],
      };
    });
    return {
      sessions: Object.keys(sessions).length,
      messages: rows.length,
      rows: last20,
      loggingEnabled: loggingEnabled,
      ssUrl: ss.getUrl(),
    };
  } catch (e) {
    return {
      sessions: 0,
      messages: 0,
      rows: [],
      loggingEnabled: loggingEnabled,
      error: e.message,
    };
  }
}

function clearChatLogs() {
  if (!isAdmin()) throw new Error("Unauthorized");
  var ssId =
    PropertiesService.getScriptProperties().getProperty("ANALYTICS_SS_ID");
  if (!ssId) return { success: true };
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName("Data");
  if (sheet && sheet.getLastRow() > 1)
    sheet.deleteRows(2, sheet.getLastRow() - 1);
  return { success: true };
}

function toggleChatLogging(enabled) {
  if (!isAdmin()) throw new Error("Unauthorized");
  PropertiesService.getScriptProperties().setProperty(
    "CHAT_LOGGING",
    enabled ? "true" : "false",
  );
  return { success: true, enabled: enabled };
}
