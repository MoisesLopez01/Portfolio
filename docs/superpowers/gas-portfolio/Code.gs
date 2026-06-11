// ═══════════════════════════════════════════════════════════════════════════════
// Alex López — Data Strategist · Portfolio GAS Webapp · Code.gs
// Deploy: Execute as Me · Who has access: Anyone · XFrameOptionsMode.ALLOWALL
// ═══════════════════════════════════════════════════════════════════════════════

// ── PROJECT DATA ──────────────────────────────────────────────────────────────
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
      "A global SaaS company's sales leadership was drowning in manual reporting — deal notes were unstructured, revenue forecasts were unreliable, and analysts spent 10+ hours per week consolidating CRM data into reports. There was no systematic way to surface deal blockers or forecast with confidence.",
    action:
      "Engineered an end-to-end AI Sales Analytics Ecosystem integrating a CRM API (v3/v4) with a parallelized ETL pipeline. Added Google Gemini LLM for semantic analysis of unstructured deal notes, automatically detecting deal blockers and generating human-readable weekly summaries. Layered a custom Time Decay forecasting model on top to improve revenue forecast accuracy.",
    resolution:
      "Eliminated 10+ hours/week of manual reporting. Sales leadership now receives AI-generated deal risk flags and narrative summaries every Monday. Revenue forecast reliability improved significantly, giving the C-suite a data-driven foundation for quarterly planning.",
    tech: [
      "HubSpot API v3/v4",
      "Python",
      "Google Gemini LLM",
      "ETL Pipelines",
      "Time Decay Forecasting",
      "Google Apps Script",
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
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "// Concurrent CRM pulls via UrlFetchApp.fetchAll — 20x faster than sequential\nfunction fetchPipelineDataParallel(endpoints, apiKey) {\n  var requests = endpoints.map(function(ep) {\n    return {\n      url: 'https://api.hubapi.com' + ep.path,\n      method: ep.method || 'post',\n      headers: {\n        'Authorization': 'Bearer ' + apiKey,\n        'Content-Type': 'application/json'\n      },\n      payload: ep.payload ? JSON.stringify(ep.payload) : null,\n      muteHttpExceptions: true\n    };\n  });\n  var results = [];\n  for (var i = 0; i < requests.length; i += 20) {\n    UrlFetchApp.fetchAll(requests.slice(i, i + 20)).forEach(function(resp) {\n      var code = resp.getResponseCode();\n      results.push(code >= 200 && code < 300\n        ? JSON.parse(resp.getContentText()) : null);\n    });\n    if (i + 20 < requests.length) Utilities.sleep(500); // rate-limit buffer\n  }\n  return results;\n}",
    },
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
      "Manually benchmarking compensation across 15+ countries was a multi-day exercise for the People team — involving market reports, currency adjustments, COL indexes, and tax rate research. The process was inconsistent, slow, and couldn't scale with global headcount growth.",
    action:
      "Architected a Global Salary Benchmarking Engine using the Gemini Pro API with advanced prompt engineering to simulate a senior compensation analyst's methodology. Built dynamic COL, tax rate, and market maturity adjustments into the prompting logic. Delivered P25/P50/P75 percentile intelligence with micro-banding frameworks and multi-currency logic, co-designed with the CEO and VP of Talent Acquisition.",
    resolution:
      "Cut compensation research time by 90% — from multi-day manual processes to a minutes-long automated workflow. The engine now covers 10+ regions with consistent methodology, country-specific benefits structures, and dynamic PDF/Google Sheets outputs used in board-level compensation decisions.",
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
    codeSnippet: {
      lang: "Python",
      tag: "python",
      code: 'def build_benchmark_prompt(role, country, level, col_index, tax_rate):\n    """Inject COL and tax data into a structured compensation prompt."""\n    return (\n        "As a compensation analyst, benchmark this role:\\n"\n        "Role: " + role + " | Country: " + country + " | Level: " + level + "\\n"\n        "COL Index: " + str(col_index) + " | Effective Tax Rate: " + str(tax_rate) + "%\\n\\n"\n        "Provide P25, P50, P75 base salary in local currency and USD.\\n"\n        "Include: market premium, benefits structure, equity norms, "\n        "and micro-band positioning."\n    )',
    },
  },
  {
    id: "hr-eval",
    domain: "ai",
    title: "360 Leadership Evaluation Automation",
    tagline: "Gemini API + Apps Script → 40% reduction in HR cycle time",
    category: "AI · HR Automation",
    impact: "40% cycle reduction",
    context:
      "The annual 360 Leadership Evaluation process was a manual, time-intensive effort — collecting multi-source survey data, normalizing responses, and producing executive summaries. Cycle time was long, data accuracy was inconsistent, and HR lacked capacity to run continuous evaluations.",
    action:
      "Automated the full 360 Leadership Evaluation workflow using the Gemini API and Google Apps Script. Built automated data pipelines for multi-source survey ingestion, applied Gemini's language understanding to generate structured, executive-ready narrative summaries, and embedded quality checks to improve data accuracy across the evaluation cycle.",
    resolution:
      "Reduced manual HR cycle time by 40%. Leadership evaluations now produce consistent, executive-grade summaries with improved accuracy. The freed capacity allowed HR to run evaluations more frequently, improving leadership development feedback loops across the organization.",
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
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "function generateLeadershipSummary(evaluations) {\n  var aggregated = aggregateByCategory(evaluations);\n  var prompt = buildExecutivePrompt(aggregated, {\n    format: 'strengths | development_areas | recommended_actions',\n    audience: 'C-suite',\n    tone: 'direct and actionable'\n  });\n  return callGeminiAPI(prompt, { temperature: 0.3 });\n}\n\nfunction aggregateByCategory(evals) {\n  return evals.reduce(function(acc, e) {\n    (acc[e.category] = acc[e.category] || []).push(e.score);\n    return acc;\n  }, {});\n}",
    },
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
      "Leadership reviews of weekly Jira discussions and Confluence meeting notes consumed 3+ hours per cycle — with no systematic way to surface which decisions mapped to FY27 strategic OKRs. Signals lived in transcripts; executives were mining text manually across dozens of pages and ticket threads.",
    action:
      "Built an end-to-end Atlassian Signal Intelligence pipeline: automated transcript ingestion from Confluence pages via REST API, Claude API for structured signal extraction (each decision classified by strategic theme and OKR alignment score), and automated Confluence page publishing of the weekly brief. Integrated Rovo agents to answer on-demand strategy questions against the live signal corpus.",
    resolution:
      "Strategic alignment reviews dropped from 3+ hours to under 15 minutes per week. Leadership receives an automated Confluence brief every Monday mapping meeting decisions to FY27 OKRs. Rovo agents give instant answers to ad-hoc strategy questions — no more manual transcript mining.",
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
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "function extractStrategicSignals(transcriptText, okrThemes) {\n  var prompt =\n    'Extract strategic signals from this Confluence meeting transcript.\\n' +\n    'OKR themes to align against: ' + okrThemes.join(', ') + '\\n\\n' +\n    'Return a JSON array — one object per signal found:\\n' +\n    '[{\"signal\":\"...\",\"theme\":\"...\",\"alignmentScore\":0-1,\"isDecision\":true/false}]\\n\\n' +\n    'Transcript (first 6000 chars):\\n' + transcriptText.slice(0, 6000);\n\n  var resp = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {\n    method: 'post', contentType: 'application/json',\n    headers: { 'x-api-key': getApiKey_(), 'anthropic-version': '2023-06-01' },\n    payload: JSON.stringify({\n      model: 'claude-opus-4-8', max_tokens: 1024,\n      messages: [{ role: 'user', content: prompt }]\n    }),\n    muteHttpExceptions: true\n  });\n  var text = JSON.parse(resp.getContentText()).content[0].text;\n  return JSON.parse(text.match(/\\[[\\s\\S]*\\]/)[0]);\n}",
    },
  },
  {
    id: "tcc-forecast",
    domain: "finance",
    title: "TCC Financial Forecasting System",
    tagline: "CFO-ready P&L dashboards replacing manual budget consolidation",
    category: "Finance · Forecasting",
    impact: "CFO-level visibility",
    context:
      "The Finance and People teams were manually consolidating P&L data across departments, creating error-prone quarterly reporting cycles. There was no systematic way to model the cost impact of attrition, promotions, merit increases, or new hires — leaving the CFO without real-time labor cost visibility.",
    action:
      "Developed a Financial Forecasting & TCC Impact System in Google Apps Script with smart attrition proration logic, dynamic Line-of-Business (LOB) budget allocation engines, and automated board dashboards. Built views for Quarterly Actuals vs. Forecast, Top 15 Department Variance, and full P&L breakdowns covering Merit, Promotion, Attrition, and New Hire cost drivers.",
    resolution:
      "Delivered CFO-level visibility into labor cost drivers through fully automated dashboards. Monthly department-level P&L impact analysis now informs C-suite compensation decisions and market calibrations. Led post-adjustment audits achieving 100% accuracy across all sheets via monthly NetSuite snapshots.",
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
    codeSnippet: {
      lang: "SQL (SuiteQL)",
      tag: "sql",
      code: "-- Attrition proration: partial-month TCC cost impact\nSELECT\n  e.employee_id,\n  e.department,\n  e.annual_tcc,\n  ROUND(\n    e.annual_tcc * (t.term_day / t.days_in_month),\n    2\n  ) AS prorated_cost,\n  'ATTRITION' AS cost_driver,\n  t.term_date\nFROM employees e\nJOIN terminations t\n  ON e.employee_id = t.employee_id\nWHERE t.term_date BETWEEN :period_start AND :period_end",
    },
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
      "The bonus eligibility process required every employee to have at least 10 active goals in the performance system. Manual checks were inconsistent — some employees reached bonus payout with fewer goals, and the audit process consumed significant HR and Finance analyst time each cycle.",
    action:
      "Built an automated Goals Quality Audit pipeline using SuiteQL queries to extract goal data from NetSuite, followed by a Python JSON-to-CSV transformation layer that applies the 10-goal compliance rule. The pipeline flags non-compliant employees before the bonus cycle runs, exports a clean audit report, and sends automated notifications to HR.",
    resolution:
      "Achieved 100% compliance enforcement on every bonus cycle with zero manual intervention. The pipeline runs automatically before each cycle, eliminating audit surprises and saving Finance and HR teams hours of manual checking per quarter.",
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
    codeSnippet: {
      lang: "Python",
      tag: "python",
      code: 'def audit_goal_compliance(goals_json, min_goals=10):\n    """Flag employees below the active-goal threshold."""\n    records = json.loads(goals_json)\n    results = []\n    for emp in records:\n        active = [g for g in emp["goals"] if g["status"] == "Active"]\n        results.append({\n            "employee_id": emp["id"],\n            "name":        emp["name"],\n            "active_goals": len(active),\n            "compliant":   len(active) >= min_goals,\n            "gap":         max(0, min_goals - len(active))\n        })\n    df = pd.DataFrame(results)\n    return df, df[~df["compliant"]]  # (full_report, flagged)',
    },
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
      "Compensation decisions at a 500–1,000-employee SaaS company were made with ad hoc spreadsheet comparisons — no consistent band framework, no comp-ratio tracking, and no visibility into where each employee sat relative to market. Each review cycle required re-building the analysis from scratch.",
    action:
      "Built an Employee Compensation Analysis module using Google Apps Script and NetSuite data. Implemented band positioning logic (Q1–Q4) with comp-ratio calculations, automated percentile mapping against internal pay bands, and visual positioning outputs for each role and level. Integrated with the TCC Forecasting System for unified compensation views.",
    resolution:
      "Delivered standardized band positioning and comp-ratio analysis across all roles and levels. Compensation review cycles that previously required days of manual spreadsheet work now run in minutes. HR and Finance leadership have consistent, methodology-aligned data for every review.",
    tech: [
      "Google Apps Script",
      "NetSuite",
      "Compensation Modeling",
      "Google Sheets",
      "Tableau",
    ],
    metrics: [
      { val: "P25–75", label: "band analysis" },
      { val: "Auto", label: "comp ratios" },
      { val: "↑", label: "consistency" },
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
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "function calculateBandPosition(salary, bandMin, bandMid, bandMax) {\n  var compRatio = salary / bandMid;\n  var rangePos  = (salary - bandMin) / (bandMax - bandMin);\n  return {\n    compRatio:     Math.round(compRatio * 100) / 100,\n    rangePosition: Math.round(rangePos * 100),\n    quartile: rangePos < 0.25 ? 'Q1 — Below Mid'\n            : rangePos < 0.50 ? 'Q2 — Below Mid'\n            : rangePos < 0.75 ? 'Q3 — Above Mid'\n            :                   'Q4 — Top of Band'\n  };\n}",
    },
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
      "A globally distributed SaaS company was managing compensation across 10+ regions without a unified framework — each region used separate spreadsheets with no consistent methodology for currency conversion, benefit valuation, or band positioning. Board-level decisions lacked comparative global data.",
    action:
      "Built a Global Compensation Reporting Tool using Python and the Gemini Pro API. Implemented multi-currency normalization with FX rate injection, regional COL adjustment factors, and micro-banding frameworks co-designed with the CEO and VP of Talent Acquisition. Automated PDF and Google Sheets output generation for board presentations.",
    resolution:
      "Delivered a unified global compensation view across 10+ regions. Board-level compensation decisions now use consistent, methodology-aligned data. The tool eliminated ad hoc regional reports and enabled the company to shift from reactive comp adjustments to proactive market positioning.",
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
    codeSnippet: {
      lang: "Python",
      tag: "python",
      code: 'def normalize_to_usd(salary, currency, fx_rates, col_index):\n    """Normalize salary to USD with COL purchasing-power adjustment."""\n    if currency not in fx_rates:\n        raise ValueError("No FX rate for " + currency)\n    nominal_usd = salary / fx_rates[currency]\n    return {\n        "nominal_usd":  round(nominal_usd, 2),\n        "col_adjusted": round(nominal_usd / col_index, 2),\n        "currency":     currency,\n        "fx_rate":      fx_rates[currency],\n        "col_index":    col_index\n    }',
    },
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
      "The People team had no systematic way to track headcount trends across lines of business. Monthly point-in-time snapshots from NetSuite were the only data source — no trend lines, no attrition forecasting, no LOB-level drill-down for workforce planning.",
    action:
      "Built a headcount analytics pipeline using SuiteQL queries against NetSuite, processed via Google Apps Script for automated monthly reporting. Implemented LOB-level aggregations, attrition rate calculations, and growth trend visualizations surfaced in Tableau dashboards for HR and Finance leadership.",
    resolution:
      "Delivered live headcount visibility across all lines of business. Monthly reporting reduced from a 2-day manual effort to fully automated. HR and Finance leadership now proactively identify headcount gaps and model scenarios for workforce planning.",
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
        "Automated LOB headcount analytics with attrition trends in Tableau",
      metrics: "Live visibility · 0 manual effort · Proactive planning",
    },
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "function aggregateHeadcountByLOB(records) {\n  return records.reduce(function(acc, emp) {\n    var lob = emp.lineOfBusiness || 'Unassigned';\n    if (!acc[lob]) acc[lob] = { active: 0, terminated: 0, net: 0 };\n    if (emp.status === 'Active') {\n      acc[lob].active++;\n    } else {\n      acc[lob].terminated++;\n    }\n    acc[lob].net = acc[lob].active - acc[lob].terminated;\n    return acc;\n  }, {});\n}",
    },
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
      "The Professional Services team had no systematic way to track contribution quality or team health metrics. Managers relied on ad hoc manual reports compiled from Jira tickets and Tempo timesheets — time-consuming with no standardized scoring, no role-based access control, and no historical trend visibility. The codebase had no version control or deployment pipeline.",
    action:
      "Built a full-stack web app using Google Apps Script with a 3-layer RBAC model, Jira + Tempo data aggregation, and a weighted composite scoring engine. Added a goals compliance override engine that evaluates Q4 comment thresholds and backfills compliance across all weeks. Automated Confluence executive brief publishing via REST API (PS_Post.js). Set up Bitbucket Pipelines with clasp for staged GAS deployments: syntax validation on every push, HEAD sync on feature branches, manual-gated production release on main.",
    resolution:
      "Delivered automated team health visibility for the Professional Services org. Weekly reports and executive Confluence briefs run without manual intervention. Managers and ICs have role-appropriate views of team performance, and a GitOps pipeline ensures every change goes through syntax validation before reaching production.",
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
    codeSnippet: {
      lang: "YAML · Bitbucket Pipelines",
      tag: "yaml",
      code: "# Feature branches -> dev URL | Main -> manual production release\nbranches:\n  'feature/*':\n    - step:\n        name: 'Deploy to GAS — HEAD (staging)'\n        script:\n          - npm install -g @google/clasp --quiet\n          - echo \"$CLASPRC_JSON\" > ~/.clasprc.json\n          - cd PSContributionReport && clasp push --force\n\n  main:\n    - step:\n        name: 'Sync to GAS HEAD'\n        script:\n          - clasp push --force\n    - step:\n        name: 'Deploy to Production'\n        deployment: production\n        trigger: manual\n        script:\n          - clasp push --force\n          - clasp deploy --deploymentId \"$GAS_DEPLOYMENT_ID\"\n              --description \"v$(date +%Y-%m-%d) build $BITBUCKET_BUILD_NUMBER\"",
    },
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
      "Performance benchmarking across roles was done with inconsistent criteria — different managers applied different standards, making cross-team comparisons unreliable. There was no normalized scoring methodology and no way to rank performance objectively across functions.",
    action:
      "Built a Benchmarking and Performance Engine in Google Apps Script that normalizes raw performance signals to a 0–100 scale, assigns performance tiers (Top Performer, Strong, Developing, Below Band), and produces ranked comparison reports across roles and departments with configurable weights per role type.",
    resolution:
      "Delivered standardized, objective performance benchmarks across all functions. Calibration sessions now start from a consistent data baseline instead of subjective manager discussion. The tiering system provides a common language for performance conversations across the organization.",
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
    codeSnippet: {
      lang: "JavaScript",
      tag: "javascript",
      code: "function normalizeScore(raw, min, max, roleWeights) {\n  if (max === min) return { score: 50, tier: 'Developing' };\n  var pct     = ((raw - min) / (max - min)) * 100;\n  var weighted = pct * (roleWeights.performance || 1.0);\n  var final   = Math.min(100, Math.round(weighted));\n  return {\n    score: final,\n    tier: final >= 80 ? 'Top Performer'\n        : final >= 60 ? 'Strong'\n        : final >= 40 ? 'Developing'\n        :               'Below Band'\n  };\n}",
    },
  },
];

// ── ROUTING ───────────────────────────────────────────────────────────────────
function doGet() {
  var tpl = HtmlService.createTemplateFromFile("index");
  tpl.isAdmin = isAdmin();
  // Escape </script> so project strings can't break out of the inline <script> block (XSS)
  tpl.projectsJson = JSON.stringify(getProjectsData()).replace(/<\/script/gi, "<\\/script");
  tpl.domainsJson  = JSON.stringify(DOMAINS).replace(/<\/script/gi, "<\\/script");
  return tpl
    .evaluate()
    .setTitle("Alex López — Data Strategist")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function isAdmin() {
  try {
    var email = Session.getActiveUser().getEmail();
    return email === "moises.lopez@servicerocket.com";
  } catch (e) {
    return false;
  }
}

// ── DATA ──────────────────────────────────────────────────────────────────────
function getProjectsData() {
  var props = PropertiesService.getScriptProperties();
  var custom = [];
  try {
    custom = JSON.parse(props.getProperty("CUSTOM_PROJECTS") || "[]");
  } catch (e) {
    custom = [];
  }
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
  if (String(projectId).indexOf("custom-") !== 0) {
    throw new Error("Only custom projects can be deleted");
  }
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

// ── GROQ PROXY ────────────────────────────────────────────────────────────────
var PORTFOLIO_CONTEXT =
  "You are the portfolio assistant for Alex López, a Senior Data Analyst at a global SaaS company. " +
  "He has 5+ years of workforce analytics experience and a deep stack spanning Python, SQL/SuiteQL, " +
  "Google Apps Script, Groq API, Gemini Pro API, Tableau, Looker, HubSpot API v3/v4, and NetSuite/Oracle. " +
  "He is pursuing an MSc in Data Science Applied to Business Intelligence (European University of the Atlantic, 2024–2026). " +
  "His 11 portfolio projects span AI & LLM integration (AI Sales Analytics, Salary Benchmarking, 360 Evaluations, Atlassian Signal Intelligence), " +
  "Finance & Data (TCC Forecasting, Goals Audit, Total Rewards), HR & People (Global Comp Reporting, Headcount Analysis), " +
  "and Ops & Engineering (PS Contribution Dashboard with Bitbucket CI/CD, Benchmarking Engine). " +
  "Answer questions about Alex's work in a professional, concise, enthusiastic tone. " +
  "Cite specific numbers when available (10h/week saved, 90% faster, 100% compliance, 40% cycle reduction). " +
  "If unsure about something, acknowledge gracefully.";

// ── GROQ API KEY ───────────────────────────────────────────────────────────────
// To set the key: open the portfolio, log in as admin, go to Admin Panel → Settings → Groq API Key.
// Do NOT hardcode the key here — it would be committed to git and permanently exposed.

function getGroqAPI_() {
  var key = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if (!key)
    throw new Error(
      "Groq API key not configured. The admin must set it in the admin panel.",
    );
  return key;
}

// Called by admin panel JS — stores the key entered in the Settings tab
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

// ── DEAL RISK SCORER ──────────────────────────────────────────────────────────
function calculateDealRisk(dealAgeDays, dealAmountK) {
  var age    = Math.max(0, Math.min(3650, parseInt(dealAgeDays,  10) || 0));
  var amount = Math.max(1, Math.min(10000, parseInt(dealAmountK, 10) || 1));
  var apiKey = getGroqAPI_();
  var prompt =
    "You are a sales risk engine that applies a time-decay scoring model. " +
    "A CRM deal has the following attributes:\n" +
    "  Days in pipeline: " +
    age +
    "\n" +
    "  Deal amount: $" +
    amount +
    "K\n\n" +
    "Rules:\n" +
    "- Base close probability decays ~15% for every 30 days of age\n" +
    "- Deals over $100K have longer sales cycles: apply a 30% decay discount\n" +
    "- Deals over $250K are strategic: apply a 50% decay discount\n\n" +
    "Return ONLY a valid JSON object (no markdown, no extra text):\n" +
    '{"score":0-100,"level":"Low|Medium|High|Critical",' +
    '"decayFactor":0.0-1.0,"nextAction":"one concrete sentence"}';

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
  if (resp.getResponseCode() !== 200) {
    throw new Error("Groq API error " + resp.getResponseCode());
  }
  var raw = JSON.parse(resp.getContentText()).choices[0].message.content.trim();
  raw = raw
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error("Could not parse risk score from model response — try again.");
  }
}

// ── PIPELINE RISK BATCH SCORER ────────────────────────────────────────────────
// Scores up to 8 deals in parallel via UrlFetchApp.fetchAll (single GAS execution)
function calculatePipelineRisk(deals) {
  if (!Array.isArray(deals) || !deals.length) throw new Error("No deals provided.");
  if (deals.length > 8) throw new Error("Maximum 8 deals per batch.");
  var apiKey = getGroqAPI_();

  var requests = deals.map(function(deal) {
    var age    = Math.max(0, Math.min(3650,  parseInt(deal.ageDays, 10)  || 0));
    var amount = Math.max(1, Math.min(10000, parseInt(deal.amountK, 10)  || 1));
    var prompt =
      "You are a sales risk engine. A CRM deal has been in the pipeline for " + age + " days and is worth $" + amount + "K.\n" +
      "Base close probability decays ~15% every 30 days. " +
      "Deals over $100K decay 30% slower (longer sales cycles). " +
      "Deals over $250K decay 50% slower (strategic accounts).\n" +
      "Reply with ONLY a JSON object — no explanation, no markdown:\n" +
      "{\"score\": 68, \"level\": \"High\", \"nextAction\": \"Schedule executive sponsor call this week.\"}";
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + apiKey },
      payload: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.1,
      }),
      muteHttpExceptions: true,
    };
  });

  return UrlFetchApp.fetchAll(requests).map(function(resp) {
    if (resp.getResponseCode() !== 200) {
      return { score: 50, level: "Unknown", nextAction: "API error — retry." };
    }
    var raw = JSON.parse(resp.getContentText()).choices[0].message.content.trim();
    // Strip markdown fences, then extract the first {...} object even if the model adds preamble
    raw = raw.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
    var match = raw.match(/\{[\s\S]*\}/);
    try { return JSON.parse(match ? match[0] : raw); }
    catch (e) { return { score: 50, level: "Unknown", nextAction: "Could not parse response — try again." }; }
  });
}

// ── GROQ CHAT PROXY ───────────────────────────────────────────────────────────
function proxyGroqChat(userMessage, history, sessionId) {
  var apiKey = getGroqAPI_();

  var messages = [{ role: "system", content: PORTFOLIO_CONTEXT }];
  if (history && history.length) {
    var last = history.slice(-6);
    for (var i = 0; i < last.length; i++) {
      messages.push({
        role: last[i].role === "assistant" ? "assistant" : "user",
        content: String(last[i].content),
      });
    }
  }
  messages.push({ role: "user", content: String(userMessage) });

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
        max_tokens: 800,
        temperature: 0.7,
      }),
      muteHttpExceptions: true,
    },
  );
  var code = response.getResponseCode();
  if (code !== 200) {
    var body = response.getContentText();
    var msg = "Groq API error " + code;
    try {
      msg += ": " + JSON.parse(body).error.message;
    } catch (e) {}
    throw new Error(msg);
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
  return reply;
}

// ── CHAT LOGGING ──────────────────────────────────────────────────────────────
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
    // Silent fail — logging must never break the main flow
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

// ── ANALYTICS (ADMIN ONLY) ────────────────────────────────────────────────────
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
    if (!sheet || sheet.getLastRow() <= 1) {
      return {
        sessions: 0,
        messages: 0,
        rows: [],
        loggingEnabled: loggingEnabled,
        ssUrl: ss.getUrl(),
      };
    }
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
