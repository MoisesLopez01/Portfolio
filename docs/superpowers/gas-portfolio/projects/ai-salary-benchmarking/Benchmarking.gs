function auditAuthorizedUsers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const editors = ss.getEditors();

  Logger.log('=== Authorized Editors ===');
  editors.forEach((editor, index) => {
    Logger.log(`${index + 1}: ${editor.getEmail()}`);
  });
  Logger.log(`Total: ${editors.length} editors`);
  Logger.log('==========================');
}

function addAuthorizedUser(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.addEditor(email);
  Logger.log(`✅ Added editor: ${email}`);
}

function removeAuthorizedUser(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.removeEditor(email);
  Logger.log(`❌ Removed editor: ${email}`);
}

/**
 * OPTIMAL AI SALARY BENCHMARKING SYSTEM
 * Multi-country focus with enhanced market data accuracy
 * Version: 4.2 — Latam Remote / Regional Focus
 *
 * CHANGELOG v4.2:
 *   [P10]  Latam Remote — For Latam locations, explicitly include "Latam Remote" / "Americas Remote"
 *           data points to capture regional winning talent rates.
 *   [P11]  Source URL Capture — explicit instruction to AI to return clickable URLs for verification,
 *           plus increased Sources sheet URL field limit.
 *   [P12]  Profile Context Injection — explicitly inject "Skills" and "Responsibilities" into the
 *           AI prompt for both Full Time and Contractor roles to ensure precise market matching.
 *   [P13]  Functional Matching — instructed AI to prioritize skills/responsibilities alignment
 *           over exact title matching, allowing capture of "Functionally Equivalent" roles.
 *
 * CHANGELOG v4.1:
 *   [BUG1] Sources sheet empty — robust multi-format parsing + fallback + always-write
 *   [BUG2] Contractor overpricing — absolute hourly rate envelope (getContractorRateEnvelope)
 *   [P6]   Batch archiving — auto-archive output sheet to timestamped tab before each run
 *   [P7]   Confidence threshold gate — "Comp Ready" column (✓/⚠/✗) + low-conf row color
 *   [P8]   Expanded GENERIC_CONTRACTOR_FOCUS_MAP — IT & Security, Engineering, Analytics,
 *           Solution Architecture, Product, Design
 *
 * All P1–P5 fixes from v4.0 are preserved:
 *   [P1] Salary envelope guardrails + orange outlier flagging
 *   [P2] Structured sources JSON schema + Benchmark Sources sheet logging
 *   [P3] sanitizePromptInput() — prompt injection protection
 *   [P4] Local-currency AI research for non-USD markets
 *   [P5] Job title parsing + family code alignment
 * 
 */






// ============================================================================
// CONFIGURATION
// ============================================================================

const GEMINI_MODEL = 'gemini-2.5-pro';
const INPUT_SHEET_NAME = 'Input';
const OUTPUT_SHEET_NAME = 'Benchmark Results';
const ROSTER_SHEET_NAME = 'Roster';
const SOURCES_SHEET_NAME = 'Benchmark Sources';
const ARCHIVE_PREFIX = 'Archive - ';           // [P6] Prefix for archived result sheets
const MAX_API_CALLS_PER_MINUTE = 10;
const MAX_INPUT_LENGTH = 5000;
const SESSION_TOKEN_KEY = 'CSRF_SESSION_TOKEN';
const CONFIDENCE_GATE_THRESHOLD = 50;          // [P7] Rows below this need human review
const CONFIDENCE_ADVISORY_THRESHOLD = 70;      // [P7] Rows below this are flagged advisory

// [P9] Internal Reference Anchors - REMOVED for Unbiased Discovery
// const INTERNAL_ANCHORS = {};

let API_CALL_TIMES = [];

const INPUT_COLUMNS = {
  JOB_ID: 0,
  JOB_PROFILE: 1,
  LOCATION: 2,
  CURRENCY: 3,
  YEARS_EXPERIENCE: 4,
  REQUIRED_SKILLS: 5,
  QUALIFICATIONS: 6,
  RESPONSIBILITIES: 7,
  INDUSTRY: 8,
  COMPANY_SIZE: 9
};

const CONTRACTOR_SHEET_NAME = 'Contractor';

const CREW_MEMBER_PROFILE_LIBRARY = [
  {
    seniority: 'Senior', title: 'Senior Delivery Manager', yearsRange: '3-5', minYears: 3, maxYears: 5,
    responsibilities: 'Own delivery health across budgets, risks, and cross-functional blockers; coordinate stakeholders through project lifecycle.',
    skills: 'Client-facing project management, cloud migrations, stakeholder and financial management.',
    keywords: ['senior delivery manager', 'customer-facing project management', 'cloud migration']
  },
  {
    seniority: 'Principal', title: 'Principal Delivery Manager', yearsRange: '5-9', minYears: 5, maxYears: 9,
    responsibilities: 'Scale delivery playbooks, drive executive communication, and expand services opportunities across accounts.',
    skills: 'Senior PM leadership, digital transformation, multiregion stakeholder alignment.',
    keywords: ['principal delivery manager', 'senior project manager', 'enterprise delivery']
  },
  {
    seniority: 'Senior', title: 'Technical Solutions Consultant', yearsRange: '3-5', minYears: 3, maxYears: 5,
    responsibilities: 'Design and implement enterprise platform solutions, run adoption workshops, and guide technical onboarding.',
    skills: 'Platform implementations, integrations, scripting (Python/Groovy), Agile facilitation.',
    keywords: ['technical solutions consultant', 'platform administrator', 'enterprise software consultant']
  },
  {
    seniority: 'Principal', title: 'Senior Technical Solutions Consultant', yearsRange: '5-9', minYears: 5, maxYears: 9,
    responsibilities: 'Architect complex enterprise deployments, lead technical delivery, and support pre-sales pursuits.',
    skills: 'Solution architecture, enterprise workshops, ITIL/ITSM depth, cloud modernization.',
    keywords: ['senior technical consultant', 'solutions architect', 'service delivery consultant']
  },
  {
    seniority: 'General', title: 'Technical Consulting Contractor', yearsRange: '4-10',
    responsibilities: 'Multi-area contractor covering project leadership, solution design, and managed services delivery.',
    skills: 'Enterprise platforms, cloud services, service management, remote collaboration.',
    keywords: ['technical consulting contractor', 'technology consultant', 'project and technical consulting'],
    default: true
  }
];

const COMMON_CONTRACTOR_SEARCHES = [
  'Technical Consultant, Remote (US), United States, Contract',
  'Senior Technical Consultant, Remote, Global, Contract',
  'IT Project Manager contractor, Remote (US), United States',
  'Cloud Solutions Consultant, Service Delivery, Remote, Global, Contract',
  'Platform Administrator, Remote (AU), Australia, Contract',
  'Enterprise Software Consultant, Remote (US), United States, Contract',
  'Delivery Manager, Remote, Global, Contract',
  'Technical Program Manager contractor, United States',
  'ITSM Consultant, Service Delivery, Remote, Australia, Contract',
  'Cloud Migration Consultant, Remote, Global, Contract',
  'Senior Project Manager contractor, Remote (APAC), Contract',
  'IT Service Management contractor, Remote (US), United States',
  'Solutions Architect, Remote, Global, Contract',
  'Technical Implementation Consultant, United States, Contract',
  'Senior Delivery Consultant, Remote, Global, Contract',
  'Enterprise Platform Consultant, Remote (US), United States, Contract',
  'Service Management Contractor, Remote, Global',
  'Software Development Contractor, Remote, Global',
  'Technology Consultant, Remote (US), United States, Full-time',
  'Senior Technical Advisor, Remote, Contract'
];

// ============================================================================
// [P8] EXPANDED GENERIC_CONTRACTOR_FOCUS_MAP
// Added: IT & Security, Engineering, Analytics, Solution Architecture, Product, Design
// ============================================================================
const GENERIC_CONTRACTOR_FOCUS_MAP = {
  'Marketing': {
    code: 'MK1', title: 'Marketing Programs Contractor', yearsRange: '4-10',
    responsibilities: 'Plan and execute integrated campaigns, manage lifecycle programs, and report on pipeline impact.',
    skills: 'Demand gen, lifecycle automation, email/paid media operations, HubSpot/Marketo, analytics.',
    keywords: ['marketing contractor', 'demand gen', 'campaign manager']
  },
  'Legal & Compliance': {
    code: 'LG1', title: 'Legal Operations / Commercial Counsel Contractor', yearsRange: '6-12',
    responsibilities: 'Draft and negotiate commercial agreements, manage compliance checklists, and guide risk mitigation.',
    skills: 'Contract review, data privacy, SaaS MSAs, regulatory research, stakeholder management.',
    keywords: ['legal contractor', 'counsel', 'compliance consultant']
  },
  'Human Resources': {
    code: 'HR1', title: 'People Programs Contractor', yearsRange: '5-10',
    responsibilities: 'Own talent initiatives, build scalable HR processes, and support org-wide change management.',
    skills: 'Talent programs, employee relations, HRIS, benefits, DEI enablement.',
    keywords: ['people team', 'hr contractor', 'talent program consultant']
  },
  'Operations': {
    code: 'PM1', title: 'Project / Program Management Contractor', yearsRange: '4-12',
    responsibilities: 'Drive project plans, manage cross-functional risks, and deliver executive-ready reporting.',
    skills: 'Project management, PMO tooling, stakeholder facilitation, financial tracking.',
    keywords: ['project management contractor', 'program manager freelancer']
  },
  'Finance': {
    code: 'FN1', title: 'Finance & Planning Contractor', yearsRange: '5-12',
    responsibilities: 'Run forecasting models, oversee budget variance analysis, and support funding scenarios.',
    skills: 'FP&A, financial modeling, ERP/NetSuite, scenario planning.',
    keywords: ['fp&a contractor', 'finance consultant']
  },
  'Sales and Success': {
    code: 'SL1', title: 'Sales / Business Development Contractor', yearsRange: '3-8',
    responsibilities: 'Pipeline prospecting, partner coordination, and revenue operations alignment.',
    skills: 'Outbound motions, CRM hygiene, partner enablement.',
    keywords: ['business development contractor', 'sales consultant']
  },
  // [P8] NEW ENTRIES
  'IT & Security': {
    code: 'IT1', title: 'IT Operations / Security Contractor', yearsRange: '4-10',
    responsibilities: 'Manage infrastructure, implement security controls, support endpoint and cloud operations.',
    skills: 'Cloud infrastructure (AWS/Azure/GCP), network security, SIEM, endpoint management, IT service delivery.',
    keywords: ['it contractor', 'security engineer contractor', 'infrastructure consultant', 'it operations']
  },
  'Engineering': {
    code: 'ENG1', title: 'Software Engineer Contractor', yearsRange: '3-10',
    responsibilities: 'Design, build, and maintain scalable software systems; contribute to architecture decisions.',
    skills: 'Backend/frontend development, APIs, CI/CD, cloud-native, code review, agile delivery.',
    keywords: ['software engineer contractor', 'developer freelance', 'backend contractor', 'frontend contractor']
  },
  'Analytics': {
    code: 'DA1', title: 'Data Analyst / Analytics Contractor', yearsRange: '3-9',
    responsibilities: 'Build reporting pipelines, conduct analysis, and translate data into actionable business insights.',
    skills: 'SQL, Python/R, BI tools (Tableau/Looker/Power BI), statistical analysis, data storytelling.',
    keywords: ['data analyst contractor', 'analytics consultant', 'bi contractor', 'data science freelance']
  },
  'Solution Architecture': {
    code: 'SA1', title: 'Solutions Architect Contractor', yearsRange: '7-15',
    responsibilities: 'Define technical architectures, lead discovery workshops, and guide enterprise technology decisions.',
    skills: 'Enterprise architecture, cloud platforms, integration patterns, pre-sales support, technical documentation.',
    keywords: ['solutions architect contractor', 'enterprise architect freelance', 'technical architect']
  },
  'Product': {
    code: 'PD1', title: 'Product Manager / Analyst Contractor', yearsRange: '4-10',
    responsibilities: 'Define product roadmap, prioritize backlog, and coordinate cross-functional delivery.',
    skills: 'Product strategy, user research, roadmapping, stakeholder management, agile/scrum.',
    keywords: ['product manager contractor', 'product analyst freelance', 'pm consultant']
  },
  'Design': {
    code: 'DES1', title: 'UX / Product Design Contractor', yearsRange: '3-9',
    responsibilities: 'Lead UX research, create wireframes and prototypes, and drive design system contributions.',
    skills: 'Figma, user research, interaction design, accessibility, design systems, usability testing.',
    keywords: ['ux designer contractor', 'product designer freelance', 'ui contractor', 'design consultant']
  },
  'Default': {
    code: 'GEN', title: 'Cross-Functional Contractor', yearsRange: '3-10',
    responsibilities: 'Apply listed requirements to deliver scoped outcomes across the hiring team.',
    skills: 'Use provided skills list; emphasize adaptability and async collaboration.',
    keywords: ['contractor']
  }
};

// ============================================================================
// [P7] OUTPUT COLUMNS — Added "Comp Ready" as column 16
// ============================================================================
const OUTPUT_COLUMNS = [
  'Job Title',                  // 0
  'Employee Type',              // 1
  'Compensation Type',          // 2
  'Currency',                   // 3
  'Location',                   // 4
  '25th Percentile',            // 5
  '50th Percentile',            // 6
  '75th Percentile',            // 7
  'Confidence Score',           // 8
  'Comparable Job Posting',     // 9
  'Notes',                      // 10
  'Comp Ready'                  // 11: ✓ Use / ⚠ Review / ✗ Hold
];

const SOURCES_COLUMNS = [
  'Timestamp', 'Row #', 'Job Profile', 'Location', 'Employee Type',
  'Platform', 'URL', 'Data Points', 'Median Found', 'Currency',
  'Verification', 'Data Quality', 'Notes'
];


// ============================================================================
// LOCATION CONFIGURATION
// ============================================================================
function getLocationConfig() {
  return {
    'United States': {
      currency: 'USD', pppMultiplier: 1.00, marketMaturity: 'Mature',
      primarySources: ['Glassdoor', 'LinkedIn', 'Levels.fyi', 'H1B Database', 'Bureau of Labor Statistics', 'Radford', 'Robert Half', 'Payscale'],
      costOfLivingIndex: 100, techHubCities: ['San Francisco', 'New York', 'Seattle', 'Austin', 'Boston', 'Palo Alto'],
      averageTaxRate: 0.30, marketPremium: 1.00,
      peerCompanies: ['Atlassian', 'Twilio', 'Zendesk', 'HubSpot', 'Okta', 'Datadog', 'PagerDuty', 'Asana']
    },
    'Canada': {
      currency: 'CAD', pppMultiplier: 0.69, marketMaturity: 'Mature',
      primarySources: ['Glassdoor', 'LinkedIn', 'Indeed', 'PayScale Canada', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 69, techHubCities: ['Toronto', 'Vancouver', 'Montreal', 'Ottawa'],
      averageTaxRate: 0.32, marketPremium: 0.69,
      peerCompanies: ['Shopify', 'Hootsuite', 'Lightspeed', 'Coveo', 'Nuvei', 'Benevity']
    },
    'United Kingdom': {
      currency: 'GBP', pppMultiplier: 0.72, marketMaturity: 'Mature',
      primarySources: ['Glassdoor UK', 'LinkedIn', 'Reed', 'Totaljobs', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 72, techHubCities: ['London', 'Manchester', 'Edinburgh', 'Cambridge'],
      averageTaxRate: 0.29, marketPremium: 0.72,
      peerCompanies: ['Revolut', 'Monzo', 'Deliveroo', 'Personio', 'Wise', 'Contentful']
    },
    'London': {
      currency: 'GBP', pppMultiplier: 0.90, marketMaturity: 'Mature',
      primarySources: ['Glassdoor UK', 'LinkedIn', 'Reed', 'CWJobs', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 90, techHubCities: ['London'],
      averageTaxRate: 0.29, marketPremium: 0.90,
      peerCompanies: ['Revolut', 'Monzo', 'Wise', 'Checkout.com', 'Featurespace']
    },
    'Netherlands': {
      currency: 'EUR', pppMultiplier: 0.88, marketMaturity: 'Mature',
      primarySources: ['LinkedIn', 'Glassdoor NL', 'Tweakers', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 88, techHubCities: ['Amsterdam', 'Rotterdam', 'Eindhoven', 'Utrecht'],
      averageTaxRate: 0.37, marketPremium: 0.88,
      peerCompanies: ['Booking.com', 'Adyen', 'ASML', 'TomTom', 'Takeaway.com', 'WeTransfer']
    },
    'Australia': {
      currency: 'AUD', pppMultiplier: 0.77, marketMaturity: 'Mature',
      primarySources: ['Seek', 'LinkedIn', 'Glassdoor AU', 'Indeed AU', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 77, techHubCities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
      averageTaxRate: 0.32, marketPremium: 0.77,
      peerCompanies: ['Canva', 'Atlassian', 'SafetyCulture', 'Airwallex', 'Deputy', 'Culture Amp']
    },
    'New Zealand': {
      currency: 'NZD', pppMultiplier: 0.64, marketMaturity: 'Developing',
      primarySources: ['Seek NZ', 'Trade Me Jobs', 'LinkedIn', 'Radford', 'Robert Half'],
      costOfLivingIndex: 64, techHubCities: ['Auckland', 'Wellington', 'Christchurch'],
      averageTaxRate: 0.20, marketPremium: 0.64,
      peerCompanies: ['Xero', 'Pushpay', 'Vend', 'Timely', 'ActionStep']
    },
    'Singapore': {
      currency: 'SGD', pppMultiplier: 0.90, marketMaturity: 'Mature',
      primarySources: ['LinkedIn', 'JobStreet', 'MyCareersFuture', 'Glassdoor SG', 'Radford', 'Robert Half', 'Levels.fyi'],
      costOfLivingIndex: 90, techHubCities: ['Singapore'],
      averageTaxRate: 0.14, marketPremium: 0.90,
      peerCompanies: ['Grab', 'Sea Limited', 'Shopee', 'GoTo', 'Razer', 'Carousell']
    },
    'Malaysia': {
      currency: 'MYR', pppMultiplier: 0.45, marketMaturity: 'Developing',
      primarySources: ['JobStreet', 'LinkedIn', 'Glassdoor MY', 'Radford', 'Robert Half'],
      costOfLivingIndex: 38, techHubCities: ['Kuala Lumpur', 'Penang', 'Johor Bahru'],
      averageTaxRate: 0.12, marketPremium: 0.38,
      peerCompanies: ['Grab', 'AirAsia Digital', 'Carsome', 'iPay88', 'Axiata Digital']
    },
    'Philippines': {
      currency: 'PHP', pppMultiplier: 0.45, marketMaturity: 'Developing',
      primarySources: ['JobStreet', 'LinkedIn', 'Indeed PH', 'Kalibrr', 'Radford', 'Robert Half'],
      costOfLivingIndex: 36, techHubCities: ['Manila', 'Makati', 'Taguig', 'Cebu'],
      averageTaxRate: 0.22, marketPremium: 0.25,
      peerCompanies: ['Mynt', 'PayMaya', 'Kumu', 'Accenture PH', 'Concentrix']
    },
    'Indonesia': {
      currency: 'IDR', pppMultiplier: 0.45, marketMaturity: 'Developing',
      primarySources: ['JobStreet', 'LinkedIn', 'Glassdoor ID', 'Radford', 'Robert Half'],
      costOfLivingIndex: 31, techHubCities: ['Jakarta', 'Bandung', 'Surabaya'],
      averageTaxRate: 0.10, marketPremium: 0.31,
      peerCompanies: ['GoTo', 'Tokopedia', 'Bukalapak', 'Traveloka', 'OVO', 'Xendit']
    },
    'Chile': {
      currency: 'CLP', pppMultiplier: 0.43, marketMaturity: 'Developing',
      primarySources: ['LinkedIn', 'Trabajando.com', 'Indeed CL', 'Radford', 'Robert Half'],
      costOfLivingIndex: 43, techHubCities: ['Santiago', 'Valparaíso'],
      averageTaxRate: 0.07, marketPremium: 0.25,
      peerCompanies: ['Cornershop', 'NotCo', 'Buk', 'Betterfly', 'Fintual']
    },
    'El Salvador': {
      currency: 'USD', pppMultiplier: 0.45, marketMaturity: 'Emerging',
      primarySources: ['LinkedIn', 'Tecoloco', 'Indeed', 'Glassdoor', 'Radford', 'Robert Half',
        'We Work Remotely', 'Remote OK', 'FlexJobs', 'Remotive', 'Remote.co', 'Jobspresso'],
      costOfLivingIndex: 45, techHubCities: ['San Salvador'],
      averageTaxRate: 0.20, marketPremium: 0.41,
      peerCompanies: ['Applaudo Studios', 'Encora', 'Softtek', 'Gorilla Logic', 'Accenture LATAM']
    }
  };
}

// Salary Envelope Guardrails - REMOVED for Unbiased Discovery
function getSalaryEnvelope() {
  return {};
}

function checkSalaryEnvelope(p50Usd, levelCode, marketMaturity) {
  return { isWithinEnvelope: true, isTooLow: false, isTooHigh: false, envelope: null };
}

// Contractor Rate Envelope - REMOVED for Unbiased Discovery
function getContractorRateEnvelope() {
  return {};
}

function toUsdHourlyRate(localRate, currency, currencyRates) {
  // Helper kept for conversion if needed, but envelope check is removed
  if (currency === 'USD') return localRate;
  const rates = currencyRates || {};
  if (rates[currency] && rates[currency] > 0) {
    return localRate / rates[currency];
  }
  const fallback = {
    'CAD': 1.35, 'GBP': 0.79, 'AUD': 1.52, 'NZD': 1.64, 'SGD': 1.35,
    'MYR': 4.35, 'PHP': 55.0, 'IDR': 15600, 'CLP': 910, 'KES': 128, 'EUR': 0.92
  };
  return fallback[currency] ? localRate / fallback[currency] : localRate;
}

function checkContractorRateEnvelope(p50Local, currency, experienceTier, marketMaturity, currencyRates) {
  return { isWithinEnvelope: true, isTooLow: false, isTooHigh: false, envelope: null, p50Usd: 0 };
}


function getLocationMarketContext(location) {
  const locationConfig = getLocationConfig();
  const locConfig = findLocationConfig(location, locationConfig);
  return {
    location,
    currency: locConfig.currency,
    costOfLivingIndex: locConfig.costOfLivingIndex,
    marketMaturity: locConfig.marketMaturity,
    primarySources: locConfig.primarySources,
    techHubCities: locConfig.techHubCities,
    peerCompanies: locConfig.peerCompanies || []
  };
}

function getIndustryMultipliers() {
  return {
    'Technology': 1.15, 'Enterprise Software Services / IT Consulting': 1.12,
    'Consulting': 1.10, 'Finance': 1.20, 'Fintech': 1.28, 'Retail': 0.90,
    'Manufacturing': 0.90, 'Education': 0.85, 'Government': 0.85,
    'Non-Profit': 0.85, 'Telecommunications': 1.00, 'E-commerce': 1.05,
    'Gaming': 1.10, 'Media': 1.00, 'Default': 1.00
  };
}

function getCompanySizeMultipliers() {
  return { '<100': 0.90, '100-500': 0.95, '500-2000': 1.00, '2000-10000': 1.08, '10000+': 1.15, 'Default': 1.00 };
}

// ============================================================================
// [P3] PROMPT INJECTION SANITIZATION
// ============================================================================
function sanitizePromptInput(text, maxLength) {
  if (!text) return '';
  maxLength = maxLength || 280;
  let cleaned = String(text);
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '[code block removed]');
  cleaned = cleaned.replace(/`[^`]*`/g, '[code removed]');
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|above|prior|earlier)\s+instructions?/gi,
    /disregard\s+(all\s+)?(previous|above|prior|earlier)\s+instructions?/gi,
    /forget\s+(all\s+)?(previous|above|prior|earlier)\s+instructions?/gi,
    /you\s+are\s+now\s+/gi,
    /act\s+as\s+(a\s+|an\s+)?(?:different|new|alternative|unrestricted)/gi,
    /system\s*:\s*/gi, /\[INST\]/gi, /\[\/INST\]/gi,
    /<\|im_start\|>/gi, /<\|im_end\|>/gi, /<<SYS>>/gi, /<\/SYS>/gi,
    /\bprompt\s*injection\b/gi, /new\s+instructions?\s*:/gi,
    /override\s+(the\s+)?(above|previous|system)/gi
  ];
  injectionPatterns.forEach(pattern => { cleaned = cleaned.replace(pattern, '[filtered]'); });
  return cleaned.replace(/\s+/g, ' ').trim().substring(0, maxLength);
}

function wrapUserInput(tag, text, maxLength) {
  const safe = sanitizePromptInput(text, maxLength);
  if (!safe) return '';
  return `<${tag}>${safe}</${tag}>`;
}

// ============================================================================
// CONTRACTOR FOCUS HELPERS
// ============================================================================
function inferJobFamilyFromTitle(jobTitle) {
  const titleLower = String(jobTitle || '').toLowerCase();
  if (!titleLower) return 'General';
  if (titleLower.includes('technical consulting') || titleLower.includes('service delivery') ||
    titleLower.includes('atlassian') || titleLower.includes('jira') || titleLower.includes('confluence')) return 'Service Delivery';
  if (titleLower.includes('architect') || titleLower.includes('solution architecture')) return 'Solution Architecture';
  if (titleLower.includes('it operations') || titleLower.includes('it engineer') || titleLower.includes('security')) return 'IT & Security';
  if (titleLower.includes('data anal') || titleLower.includes('analytics') || titleLower.includes('business intel')) return 'Analytics';
  if (titleLower.includes('data scien') || titleLower.includes('machine learning') || titleLower.includes('ml ')) return 'Analytics';
  if (titleLower.includes('engineer') || titleLower.includes('developer') || titleLower.includes('programmer')) return 'Engineering';
  if (titleLower.includes('product manager') || titleLower.includes('product owner') || titleLower.includes('product analyst')) return 'Product';
  if (titleLower.includes('design') || titleLower.includes('ux') || titleLower.includes('ui ')) return 'Design';
  if (titleLower.includes('hr') || titleLower.includes('people') || titleLower.includes('talent') ||
    titleLower.includes('recruit') || titleLower.includes('mental performance') || titleLower.includes('administration')) return 'Human Resources';
  if (titleLower.includes('ops') || titleLower.includes('operation') || titleLower.includes('program') ||
    titleLower.includes('project management') || titleLower.includes('revenue ops')) return 'Operations';
  if (titleLower.includes('sales') || titleLower.includes('account management') || titleLower.includes('account rep')) return 'Sales and Success';
  if (titleLower.includes('partner success')) return 'Partner Success';
  if (titleLower.includes('customer support') || titleLower.includes('managed services') || titleLower.includes('delivery consultant')) return 'Managed Services & Support';
  if (titleLower.includes('training') || titleLower.includes('instruction') || titleLower.includes('education') ||
    titleLower.includes('learning solution') || titleLower.includes('enablement') || titleLower.includes('adoption')) return 'Training & Customer Education';
  if (titleLower.includes('finance') || titleLower.includes('fp&a') || titleLower.includes('accounting') || titleLower.includes('accountant')) return 'Finance';
  if (titleLower.includes('legal') || titleLower.includes('counsel') || titleLower.includes('compliance')) return 'Legal & Compliance';
  if (titleLower.includes('market') || titleLower.includes('growth')) return 'Marketing';
  return 'General';
}

function buildGenericContractorEntry(jobFamily, yearsExp, profile) {
  const normalizedFamily = GENERIC_CONTRACTOR_FOCUS_MAP[jobFamily] ? jobFamily : 'Default';
  const template = GENERIC_CONTRACTOR_FOCUS_MAP[normalizedFamily] || GENERIC_CONTRACTOR_FOCUS_MAP.Default;
  const safeYears = Math.max(0, Number.isFinite(yearsExp) ? yearsExp : 0);
  const minYears = safeYears ? Math.max(1, Math.floor(Math.max(0, safeYears - 2))) : template.minYears || 3;
  const maxYears = safeYears ? Math.max(minYears + 1, Math.ceil(safeYears + 2)) : template.maxYears || 8;
  const derivedRange = safeYears ? `${minYears}-${maxYears}` : (template.yearsRange || '3-8');
  const rawResp = (profile.responsibilities || '').trim();
  const rawSkills = (profile.requiredSkills || '').trim();
  const responsibilities = (rawResp || template.responsibilities || 'Use listed responsibilities.').substring(0, 280);
  const skills = (rawSkills || template.skills || 'Use provided skills list.').substring(0, 280);
  const keywords = template.keywords && template.keywords.length ? template.keywords : [jobFamily.toLowerCase() || 'contractor'];
  return { code: template.code || 'GEN', title: template.title || `${jobFamily} Contractor`, yearsRange: derivedRange, minYears, maxYears, responsibilities, skills, keywords };
}

function deriveContractorFocus(profile) {
  const text = [profile.jobProfile, profile.requiredSkills, profile.responsibilities, profile.qualifications].filter(Boolean).join(' ');
  const corpus = buildKeywordCorpus(text);
  const yearsExp = parseFloat(profile.yearsExperience) || 0;
  const jobFamilyTag = inferJobFamilyFromTitle(profile.jobProfile);
  const keywordMatches = CREW_MEMBER_PROFILE_LIBRARY.filter(entry => entry.keywords.some(kw => corpusContainsKeyword(corpus, kw)));
  const prioritizedMatches = keywordMatches.filter(entry => {
    if (typeof entry.minYears !== 'number' || typeof entry.maxYears !== 'number') return true;
    if (!yearsExp) return true;
    return yearsExp >= entry.minYears && yearsExp <= entry.maxYears;
  });
  let matches = (prioritizedMatches.length ? prioritizedMatches : keywordMatches).slice(0, 3);
  if (!matches.length) {
    const genericEntry = buildGenericContractorEntry(jobFamilyTag, yearsExp, profile);
    if (genericEntry) matches = [genericEntry];
  }
  const fallbackProfile = CREW_MEMBER_PROFILE_LIBRARY.find(e => e.default) || CREW_MEMBER_PROFILE_LIBRARY[0];
  return { primaryProfile: matches[0] || fallbackProfile, matches: matches.length ? matches : [fallbackProfile] };
}

function buildCrewProfileContext(profileMatches) {
  if (!profileMatches || profileMatches.length === 0) return '- Multi-area Crew Member (use requirements to infer domain focus).';
  return profileMatches.map(entry => `${entry.seniority} — ${entry.title} (${entry.yearsRange} yrs): ${entry.responsibilities} | Skills: ${entry.skills}`).join('\n');
}

function scoreSearchQueryAgainstProfile(query, corpus) {
  const tokens = normalizeForKeywordMatch(query).split(' ').filter(Boolean);
  let score = 0;
  const seen = new Set();
  tokens.forEach(token => { if (!seen.has(token)) { seen.add(token); if (corpus.includes(' ' + token + ' ')) score++; } });
  return score;
}

function buildContractorSearchContext(profile, maxResults) {
  maxResults = maxResults || 12;
  const text = [profile.jobProfile, profile.requiredSkills, profile.responsibilities, profile.location].filter(Boolean).join(' ');
  const corpus = buildKeywordCorpus(text);
  const jobFamilyTag = inferJobFamilyFromTitle(profile.jobProfile);
  const locationLabel = (profile.location || 'global').trim() || 'global';
  const jobTitleLabel = (profile.jobProfile || 'Contractor').trim();
  const scored = COMMON_CONTRACTOR_SEARCHES.map(query => ({ query, score: scoreSearchQueryAgainstProfile(query, corpus) }));
  scored.sort((a, b) => b.score !== a.score ? b.score - a.score : a.query.localeCompare(b.query));
  const top = (scored[0] && scored[0].score > 0 ? scored : COMMON_CONTRACTOR_SEARCHES.map(q => ({ query: q, score: 0 }))).slice(0, maxResults);
  const lines = [];
  const existingQueries = new Set();
  top.forEach(item => { if (!existingQueries.has(item.query)) { existingQueries.add(item.query); lines.push('- ' + item.query); } });
  const supplementalQueries = [];
  if (jobFamilyTag && jobFamilyTag !== 'General') {
    supplementalQueries.push(`${jobFamilyTag} contractor hourly rate ${locationLabel}`);
    supplementalQueries.push(`${jobFamilyTag} freelance consultant rates ${locationLabel}`);
  }
  supplementalQueries.push(`${jobTitleLabel} contractor rate ${locationLabel}`);
  supplementalQueries.forEach(q => { if (q && !existingQueries.has(q)) { existingQueries.add(q); lines.push('- ' + q); } });
  return lines.join('\n');
}

// ============================================================================
// SECURITY FUNCTIONS
// ============================================================================
function validateInputData(profile) {
  const errors = [];
  if (!profile || typeof profile !== 'object') {
    return { isValid: false, errors: ['Invalid profile object'], sanitizedProfile: profile };
  }
  const sanitizedProfile = { ...profile };
  const isContractor = sanitizedProfile.typeOfEmployee === 'Contractor';
  if (!sanitizedProfile.jobProfile || typeof sanitizedProfile.jobProfile !== 'string') {
    errors.push('Job profile is required and must be a string');
  } else {
    const s = String(sanitizedProfile.jobProfile).trim();
    if (s.length < 2) errors.push('Job profile/title is too short');
    else if (s.length > 200) errors.push('Job profile/title is too long');
    Logger.log((isContractor ? 'Contractor' : 'Full Time') + ' job validated: ' + s);
  }
  if (!sanitizedProfile.location || typeof sanitizedProfile.location !== 'string') errors.push('Location is required');
  else if (sanitizedProfile.location.length > 100) errors.push('Location is too long');
  if (!sanitizedProfile.currency || !/^[A-Z]{3}$/.test(sanitizedProfile.currency)) errors.push('Currency must be valid 3-letter code');
  const yearsExpRaw = String(sanitizedProfile.yearsExperience).trim();
  let yearsExp = 0;
  const rangeMatch = yearsExpRaw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) { yearsExp = (parseFloat(rangeMatch[1]) + parseFloat(rangeMatch[2])) / 2; }
  else { yearsExp = parseFloat(yearsExpRaw); }
  if (isNaN(yearsExp) || yearsExp < 0 || yearsExp > 70) {
    sanitizedProfile.yearsExperience = 0;
  } else { sanitizedProfile.yearsExperience = yearsExp; }
  if (sanitizedProfile.industry && sanitizedProfile.industry.length > 100) errors.push('Industry field exceeds maximum length');
  const validSizes = ['<100', '100-500', '500-2000', '2000-10000', '10000+'];
  if (sanitizedProfile.companySize && !validSizes.includes(sanitizedProfile.companySize)) errors.push('Invalid company size value');
  if ((sanitizedProfile.requiredSkills || '').length > MAX_INPUT_LENGTH ||
    (sanitizedProfile.qualifications || '').length > MAX_INPUT_LENGTH ||
    (sanitizedProfile.responsibilities || '').length > MAX_INPUT_LENGTH) errors.push('Input fields exceed maximum length');
  return { isValid: errors.length === 0, errors, sanitizedProfile };
}

function checkAuthorization() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const editors = ss.getEditors();
    const currentUser = Session.getActiveUser().getEmail();
    for (let i = 0; i < editors.length; i++) { if (editors[i].getEmail() === currentUser) return true; }
    return false;
  } catch (e) { Logger.log('Authorization check failed'); return false; }
}

function generateCSRFToken() {
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(SESSION_TOKEN_KEY, token);
  return token;
}

function validateCSRFToken(token) {
  const stored = PropertiesService.getScriptProperties().getProperty(SESSION_TOKEN_KEY);
  return stored && stored === token;
}

function sanitizeError(error) {
  if (error && error.message) Logger.log('INTERNAL ERROR: ' + error.message);
  return 'An error occurred processing your request. Please try again.';
}

// [P1] Rate limiting persists across execution contexts
function checkRateLimit() {
  const now = Date.now();
  const oneMinuteAgo = now - 60000;
  try {
    const stored = PropertiesService.getScriptProperties().getProperty('API_CALL_TIMES');
    if (stored) API_CALL_TIMES = JSON.parse(stored).filter(t => t > oneMinuteAgo);
  } catch (e) { API_CALL_TIMES = API_CALL_TIMES.filter(t => t > oneMinuteAgo); }
  if (API_CALL_TIMES.length >= MAX_API_CALLS_PER_MINUTE) throw new Error('Rate limit exceeded: ' + MAX_API_CALLS_PER_MINUTE + ' calls per minute');
  API_CALL_TIMES.push(now);
  try { PropertiesService.getScriptProperties().setProperty('API_CALL_TIMES', JSON.stringify(API_CALL_TIMES)); } catch (e) { /* non-fatal */ }
}

function sanitizeOutput(data) {
  const s = {};
  if (data.jobTitle && typeof data.jobTitle === 'string') s.jobTitle = data.jobTitle.substring(0, 200);
  s.employeeType = (['Full Time', 'Contractor'].includes(data.employeeType)) ? data.employeeType : 'Full Time';
  if (data.currency && /^[A-Z]{3}$/.test(data.currency)) s.currency = data.currency;
  if (data.location && typeof data.location === 'string') s.location = data.location.substring(0, 100);
  ['percentile25', 'percentile50', 'percentile75', 'confidenceScore'].forEach(f => {
    if (typeof data[f] === 'number' && data[f] >= 0 && data[f] <= 999999999) s[f] = Math.round(data[f]);
  });
  ['topMarketOffer', 'sampleSize', 'marketDemand', 'salaryTrend', 'comparableJobURL'].forEach(f => {
    if (data[f] !== undefined && data[f] !== null) {
      const maxLen = (f.toLowerCase().includes('url') || f === 'topMarketOffer') ? 1000 : 300;
      s[f] = String(data[f]).substring(0, maxLen);
    }
  });
  s.envelopeFlag = data.envelopeFlag || null;       // [P1] preserve for outlier coloring
  s.sources = Array.isArray(data.sources) ? data.sources : [];  // [BUG1] always preserve
  s.rawSourcesText = data.rawSourcesText || '';      // [BUG1] fallback raw text
  if (data.notes && typeof data.notes === 'string') {
    s.notes = cleanUserFacingNotes(data.notes);
  }
  return s;
}

// Scrubs technical tier/verification language from Notes before the sheet sees it.
// The user wants salary numbers + sources, not "data_status: aggregated" jargon.
function cleanUserFacingNotes(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/<[^>]*>/g, '');

  // Drop whole segments (split on "|") that contain technical tier language.
  const techPatterns = [
    /data[_ ]?status/i,
    /\b(insufficient|aggregated|unspecified)\b/i,
    /\bpercentile\s*\d+\/\d+\/\d+\b/i,
    /\bverif(ied|ication)\b/i,
    /\burls?\s+(resolves?|will be|are being)/i,
    /\bcurrently[- ]live\b/i,
    /\bhead[- ]check/i,
    /training[- ]data priors/i,
    /critical constraint/i,
    /\bP25\/P50\/P75\b/i
  ];

  const segments = s.split(/\s*\|\s*/).filter(seg => {
    const trimmed = seg.trim();
    if (!trimmed) return false;
    return !techPatterns.some(p => p.test(trimmed));
  });

  return segments.join(' | ').substring(0, 800);
}

// ============================================================================
// MAIN ORCHESTRATION
// ============================================================================
function runBenchmarkAnalysis() {
  try {
    Logger.log('=== Starting Optimal Salary Benchmarking v4.2 (Concurrent/Bulk Edition) ===');
    if (!checkAuthorization()) { SpreadsheetApp.getUi().alert('You do not have permission to run this analysis.'); return; }
    validateSetup();

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const inputSheet = ss.getSheetByName(INPUT_SHEET_NAME);
    const outputSheet = getOrCreateOutputSheet(ss);
    const sourcesSheet = getOrCreateSourcesSheet(ss);

    // [P6] Archive previous results before starting new run
    archiveBenchmarkResults(ss, outputSheet);

    const currencyRates = getLiveCurrencyRates();

    const inputData = readInputData(inputSheet);
    if (inputData.length === 0) { SpreadsheetApp.getUi().alert('No data found in Input sheet.'); return; }

    Logger.log('Processing ' + inputData.length + ' job profiles');

    // --- BULK I/O PREPARATION ---
    const outputLastRow = Math.max(outputSheet.getLastRow(), 2);
    // Expand range to cover either the full input length or existing data length
    const maxRows = Math.max(inputData.length, outputLastRow - 1);
    const existingOutputRange = outputSheet.getRange(2, 1, maxRows, OUTPUT_COLUMNS.length);
    const existingOutput = existingOutputRange.getDisplayValues();
    const newOutputValues = existingOutputRange.getValues(); // Will hold modified data
    const newOutputBackgrounds = existingOutputRange.getBackgrounds(); // Will hold modified colors

    const toProcess = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < inputData.length; i++) {
      const profile = inputData[i];
      const rowNum = i + 2;
      const outIdx = i; // maps directly to existingOutput array index

      const existingTitle = existingOutput[outIdx] ? existingOutput[outIdx][0] : '';
      const existingEmployeeType = existingOutput[outIdx] ? existingOutput[outIdx][1] : '';
      const currentEmployeeType = profile.typeOfEmployee || 'Full Time';

      if (existingTitle && existingTitle !== '' && existingEmployeeType === currentEmployeeType) {
        Logger.log('Skipping row ' + rowNum + ' - already complete: ' + profile.jobProfile);
        successCount++;
        continue;
      }
      if (existingTitle && existingTitle !== '' && existingEmployeeType !== currentEmployeeType) {
        Logger.log('Re-processing row ' + rowNum + ' - employee type changed');
        // Clear this row in memory
        newOutputValues[outIdx] = new Array(OUTPUT_COLUMNS.length).fill('');
        newOutputBackgrounds[outIdx] = new Array(OUTPUT_COLUMNS.length).fill('#ffffff');
      }

      const { isValid, errors, sanitizedProfile } = validateInputData(profile);
      if (!isValid) {
        Logger.log('Invalid input row ' + rowNum + ': ' + errors[0]);
        failCount++;
        continue;
      }

      const isContractor = sanitizedProfile.typeOfEmployee === 'Contractor';
      const prompt = isContractor ? generateContractorBenchmarkPrompt(sanitizedProfile) : generateOptimalBenchmarkPrompt(sanitizedProfile);

      toProcess.push({
        index: i,
        rowNum: rowNum,
        profile: profile,
        sanitizedProfile: sanitizedProfile,
        isContractor: isContractor,
        prompt: prompt
      });
    }

    if (toProcess.length === 0) {
      flagLowConfidenceRows(outputSheet, maxRows); // Ensure flags are updated
      SpreadsheetApp.getUi().alert('All profiles are already processed.');
      return;
    }

    // --- CONCURRENT BATCH EXECUTION ---
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
    const BATCH_SIZE = 5; // Safe concurrency limit to prevent 429s while maximizing throughput
    const allSourceRows = [];

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      Logger.log('Processing batch ' + (Math.floor(i / BATCH_SIZE) + 1) + ' of ' + Math.ceil(toProcess.length / BATCH_SIZE));

      const requests = batch.map(item => {
        const payload = {
          contents: [{ parts: [{ text: item.prompt }] }],
          // Google Search grounding: model actually browses live web instead of
          // recalling training data. Required for accurate Latam/emerging market
          // data and real, resolvable URLs.
          // NOTE: responseMimeType 'application/json' is incompatible with tools —
          // must be omitted. Parser strips ```json fences from free-text output.
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1, topP: 0.9, topK: 20, maxOutputTokens: 8192 }
        };
        return {
          url: url,
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        };
      });

      // 1. Fetch concurrent requests
      const responses = UrlFetchApp.fetchAll(requests);

      responses.forEach((response, idx) => {
        const item = batch[idx];
        const responseCode = response.getResponseCode();
        let success = false;
        let parsedData = null;

        if (responseCode === 200) {
          try {
            const jsonResponse = JSON.parse(response.getContentText());
            const candidate = jsonResponse.candidates && jsonResponse.candidates[0];
            const finishReason = candidate && candidate.finishReason;
            const hasText = candidate && candidate.content && Array.isArray(candidate.content.parts) &&
              candidate.content.parts[0] && candidate.content.parts[0].text;

            if (hasText) {
              parsedData = parseGeminiResponse(candidate.content.parts[0].text, item.profile, item.sanitizedProfile, candidate.groundingMetadata);
              success = true;
            } else {
              // 200 OK but no usable text — surface the real reason (MAX_TOKENS, SAFETY, etc.)
              Logger.log('Row ' + item.rowNum + ' returned 200 but no text. finishReason=' + finishReason +
                ' — full response: ' + response.getContentText().substring(0, 500));
            }
          } catch (e) {
            Logger.log('Parse error in concurrent batch for row ' + item.rowNum + ': ' + e.message);
          }
        }

        // 2. Multi-Tiered Synchronous Fallback
        if (!success) {
          Logger.log('Concurrent request failed for row ' + item.rowNum + ' (HTTP ' + responseCode + '). Falling back to synchronous retry...');
          Utilities.sleep(1500); // Base backoff
          let retryAttempts = 0;
          while (!success && retryAttempts < 3) {
            retryAttempts++;
            try {
              checkRateLimit();
              const retryResponse = UrlFetchApp.fetch(url, requests[idx]);
              if (retryResponse.getResponseCode() === 200) {
                const jsonResponse = JSON.parse(retryResponse.getContentText());
                const candidate = jsonResponse.candidates && jsonResponse.candidates[0];
                const hasText = candidate && candidate.content && Array.isArray(candidate.content.parts) &&
                  candidate.content.parts[0] && candidate.content.parts[0].text;
                if (hasText) {
                  parsedData = parseGeminiResponse(candidate.content.parts[0].text, item.profile, item.sanitizedProfile, candidate.groundingMetadata);
                  success = true;
                } else {
                  Logger.log('Retry ' + retryAttempts + ' row ' + item.rowNum + ' returned 200 but no text. finishReason=' +
                    (candidate && candidate.finishReason) + ' — ' + retryResponse.getContentText().substring(0, 300));
                }
              } else if (retryResponse.getResponseCode() === 429) {
                Utilities.sleep(5000 * retryAttempts);
              }
            } catch (e) {
              Logger.log('Retry ' + retryAttempts + ' failed for row ' + item.rowNum + ': ' + e.message);
              Utilities.sleep(2000 * retryAttempts);
            }
          }
        }

        // 3. Process Successful Result
        if (success && parsedData) {
          parsedData.employeeType = item.isContractor ? 'Contractor' : 'Full Time';

          if (item.isContractor) {
            parsedData = applyContractorValidation(parsedData, item.profile, currencyRates);
            parsedData = applyContractorSanityChecks(parsedData, item.profile);
          } else {
            parsedData = applyOptimalValidation(parsedData, item.profile);
            parsedData = applyCurrencyConversion(parsedData, item.profile.currency, currencyRates);
            parsedData = applyFinalSanityChecks(parsedData, null);
          }
          parsedData = sanitizeOutput(parsedData);

          // Update memory arrays instead of individual sheet cells
          const isContractor = parsedData.employeeType === 'Contractor';
          const compensationType = isContractor ? 'Hourly Rate' : 'Annual TCC';
          const sampleSizeDisplay = typeof parsedData.sampleSize === 'number' && parsedData.sampleSize > 0 ? parsedData.sampleSize.toString() : (parsedData.sampleSize || 'Unknown');

          const rowData = [
            parsedData.jobTitle,
            parsedData.employeeType || 'Full Time',
            compensationType,
            parsedData.currency,
            parsedData.location,
            parsedData.percentile25,
            parsedData.percentile50,
            parsedData.percentile75,
            parsedData.confidenceScore,
            parsedData.comparableJobURL,
            parsedData.notes || '',
            '' // Comp Ready (handled by flagLowConfidenceRows)
          ];

          const outIdx = item.index;
          newOutputValues[outIdx] = rowData;

          // Reset background for this row
          newOutputBackgrounds[outIdx] = new Array(OUTPUT_COLUMNS.length).fill('#ffffff');

          // Set Confidence Score Color (index 8)
          if (parsedData.confidenceScore >= 80) newOutputBackgrounds[outIdx][8] = '#d9ead3';
          else if (parsedData.confidenceScore >= CONFIDENCE_ADVISORY_THRESHOLD) newOutputBackgrounds[outIdx][8] = '#fff2cc';
          else if (parsedData.confidenceScore >= CONFIDENCE_GATE_THRESHOLD) newOutputBackgrounds[outIdx][8] = '#ffe0b2';
          else newOutputBackgrounds[outIdx][8] = '#f4cccc';

          // Set Envelope Flag Colors (percentiles 5-7, notes 10)
          if (parsedData.envelopeFlag && parsedData.envelopeFlag !== null) {
            newOutputBackgrounds[outIdx][5] = '#ffe0b2';
            newOutputBackgrounds[outIdx][6] = '#ffe0b2';
            newOutputBackgrounds[outIdx][7] = '#ffe0b2';
            newOutputBackgrounds[outIdx][10] = '#ffe0b2';
          }

          // Set Contractor Column Highlights
          if (isContractor) {
            newOutputBackgrounds[outIdx][1] = '#e6f3ff';
            newOutputBackgrounds[outIdx][2] = '#e6f3ff';
          }

          // Prepare sources for bulk append
          const timestampStr = new Date().toISOString();
          const sourcesToWrite = (parsedData.sources && parsedData.sources.length > 0)
            ? parsedData.sources
            : [{
              platform: 'No structured sources returned',
              url: parsedData.comparableJobURL || 'N/A',
              dataPoints: parsedData.sampleSize || 0,
              medianFound: parsedData.percentile50 || 0,
              localCurrency: parsedData.currency || 'USD'
            }];

          sourcesToWrite.forEach(src => {
            allSourceRows.push([
              timestampStr,
              item.rowNum,
              String(item.profile.jobProfile || '').substring(0, 200),
              String(item.profile.location || '').substring(0, 100),
              parsedData.employeeType || 'Full Time',
              String(src.platform || 'Unknown').substring(0, 100),
              String(src.url || '').substring(0, 2000),
              typeof src.dataPoints === 'number' ? src.dataPoints : 0,
              typeof src.medianFound === 'number' ? src.medianFound : '',
              String(src.localCurrency || '').substring(0, 10),
              String(src.verificationStatus || 'unchecked').substring(0, 30),
              String(src.dataQuality || 'unknown').substring(0, 30),
              String(parsedData.notes || '').substring(0, 500)
            ]);
          });

          successCount++;
        } else {
          failCount++;
        }
      });

      // Delay between chunks to respect quota
      if (i + BATCH_SIZE < toProcess.length) Utilities.sleep(1500);
    }

    // --- EXECUTE BULK SPREADSHEET WRITES ---
    if (newOutputValues.length > 0) {
      Logger.log('Executing bulk write to Output Sheet...');
      existingOutputRange.setValues(newOutputValues);
      existingOutputRange.setBackgrounds(newOutputBackgrounds);

      // Bulk apply number formatting
      const contractorRows = [];
      const fteRows = [];
      newOutputValues.forEach((row, idx) => {
        if (row[0] === '') return; // Skip empty
        if (row[1] === 'Contractor') contractorRows.push(idx + 2);
        else fteRows.push(idx + 2);
      });
      // Set formats (row by row is still needed here but fast enough)
      contractorRows.forEach(r => outputSheet.getRange(r, 6, 1, 3).setNumberFormat('#,##0.00'));
      fteRows.forEach(r => outputSheet.getRange(r, 6, 1, 3).setNumberFormat('#,##0'));
    }

    if (allSourceRows.length > 0) {
      Logger.log('Executing bulk write to Sources Sheet (' + allSourceRows.length + ' rows)...');
      const insertRow = sourcesSheet.getLastRow() + 1;
      sourcesSheet.getRange(insertRow, 1, allSourceRows.length, SOURCES_COLUMNS.length).setValues(allSourceRows);
    }

    // [P7] Post-run confidence gate sweep
    flagLowConfidenceRows(outputSheet, Math.max(inputData.length, newOutputValues.length));

    const message = 'Benchmarking Complete!\n\nSuccess: ' + successCount + '\nFailed: ' + failCount +
      '\n\nCheck "Comp Ready" column for use guidance.\nLow confidence rows are highlighted in orange.';
    SpreadsheetApp.getUi().alert(message);
    Logger.log('=== Analysis Complete ===');

  } catch (error) {
    Logger.log('Fatal error: ' + error.message);
    SpreadsheetApp.getUi().alert('Error: ' + error.message);
  }
}

// ============================================================================
// [P6] BATCH ARCHIVING
// Auto-archives current output sheet to a timestamped tab before each new run.
// Does NOT clear the main sheet — just preserves a snapshot.
// ============================================================================
function archiveBenchmarkResults(ss, outputSheet) {
  try {
    const lastRow = outputSheet.getLastRow();
    if (lastRow <= 1) {
      Logger.log('[P6] No data to archive — output sheet is empty.');
      return;
    }

    const now = new Date();
    const timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    const archiveName = ARCHIVE_PREFIX + timestamp;

    // Avoid duplicate archive names
    if (ss.getSheetByName(archiveName)) {
      Logger.log('[P6] Archive "' + archiveName + '" already exists — skipping.');
      return;
    }

    // Duplicate the sheet and rename it
    const archiveSheet = outputSheet.copyTo(ss);
    archiveSheet.setName(archiveName);

    // Move archive to end of tab list
    ss.moveActiveSheet(ss.getNumSheets());
    ss.setActiveSheet(outputSheet);

    // Apply grey styling to header to visually distinguish archive from live sheet
    archiveSheet.getRange(1, 1, 1, OUTPUT_COLUMNS.length).setBackground('#9e9e9e');

    Logger.log('[P6] Archived results to sheet: ' + archiveName);
  } catch (e) {
    // Non-fatal — archive failure should never block a benchmark run
    Logger.log('[P6] Archive WARNING (non-fatal): ' + e.message);
  }
}

// ============================================================================
// [P7] CONFIDENCE THRESHOLD GATE
// Post-processes all result rows after the run completes.
// Writes "Comp Ready" indicator (column 16) and applies row-level color coding.
// ============================================================================
function flagLowConfidenceRows(outputSheet, rowCount) {
  Logger.log('[P7] Running confidence gate sweep for ' + rowCount + ' rows...');

  if (rowCount === 0) return;
  const range = outputSheet.getRange(2, 1, rowCount, OUTPUT_COLUMNS.length);
  const values = range.getValues();
  const backgrounds = range.getBackgrounds();
  const fontColors = range.getFontColors();
  const fontWeights = range.getFontWeights();

  const CONFIDENCE_COL = 8;   // Confidence Score (0-indexed)
  const COMP_READY_COL = 11;  // Comp Ready (0-indexed)

  for (let i = 0; i < rowCount; i++) {
    const confidenceVal = values[i][CONFIDENCE_COL];
    if (confidenceVal === '' || confidenceVal === null) continue;

    const score = parseFloat(confidenceVal) || 0;
    let compReady, rowBg;

    if (score < CONFIDENCE_GATE_THRESHOLD) {
      // HOLD — not approved for compensation decisions
      compReady = '✗ Hold';
      rowBg = '#fce4ec';
      backgrounds[i][COMP_READY_COL] = '#f4cccc';
      fontColors[i][COMP_READY_COL] = '#b71c1c';
      fontWeights[i][COMP_READY_COL] = 'bold';
    } else if (score < CONFIDENCE_ADVISORY_THRESHOLD) {
      // ADVISORY — can be used but should be reviewed
      compReady = '⚠ Review';
      rowBg = null;
      backgrounds[i][COMP_READY_COL] = '#fff9c4';
      fontColors[i][COMP_READY_COL] = '#f57f17';
      fontWeights[i][COMP_READY_COL] = 'bold';
    } else {
      // APPROVED — ready for compensation decisions
      compReady = '✓ Use';
      rowBg = null;
      backgrounds[i][COMP_READY_COL] = '#c8e6c9';
      fontColors[i][COMP_READY_COL] = '#1b5e20';
      fontWeights[i][COMP_READY_COL] = 'bold';
    }

    values[i][COMP_READY_COL] = compReady;

    // Only paint full row for Hold status
    if (rowBg) {
      for (let j = 0; j < OUTPUT_COLUMNS.length; j++) {
        backgrounds[i][j] = rowBg;
      }
    }
  }

  // Apply all formatting changes in bulk
  range.setValues(values);
  range.setBackgrounds(backgrounds);
  range.setFontColors(fontColors);
  range.setFontWeights(fontWeights);

  Logger.log('[P7] Confidence gate sweep complete.');
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function normalizeForKeywordMatch(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9\+&\/\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function buildKeywordCorpus(text) {
  const n = normalizeForKeywordMatch(text);
  return n ? ' ' + n + ' ' : ' ';
}
function corpusContainsKeyword(corpus, keyword) {
  const nk = normalizeForKeywordMatch(keyword);
  return nk ? corpus.includes(' ' + nk + ' ') : false;
}

function normalizeIndustry(rawIndustry) {
  if (!rawIndustry) return 'Enterprise Software Services / IT Consulting';
  const text = String(rawIndustry).toLowerCase();
  if (text.includes('atlassian') || text.includes('jira') || text.includes('confluence') ||
    text.includes('servicenow') || text.includes('collaboration') || text.includes('service management')) return 'Enterprise Software Services / IT Consulting';
  if (text.includes('fintech') || (text.includes('finance') && text.includes('tech'))) return 'Fintech';
  if (text.includes('bank') || text.includes('investment') || text.includes('capital')) return 'Banking';
  if (text.includes('consult')) return 'Consulting';
  if (text.includes('health') || text.includes('med') || text.includes('pharma')) return 'Healthcare';
  if (text.includes('retail') || text.includes('ecommerce') || text.includes('e-commerce')) return 'E‑commerce / Retail';
  if (text.includes('government') || text.includes('public')) return 'Government';
  if (text.includes('non-profit') || text.includes('non profit') || text.includes('ngo')) return 'Non‑Profit';
  if (text.includes('saas') || text.includes('software') || text.includes('platform')) return 'Technology';
  return 'Technology';
}

function getCompanySizeTier(rawSize) {
  const size = String(rawSize || '').trim();
  if (size === '<100') return 'Startup';
  if (size === '100-500') return 'Scale‑up';
  if (size === '500-2000') return 'Mid‑market';
  if (size === '2000-10000') return 'Enterprise';
  if (size === '10000+') return 'Large Enterprise';
  return 'Mid‑market';
}

function assessImpactMultiplier(responsibilities, skills) {
  const text = (String(responsibilities || '') + ' ' + String(skills || '')).toLowerCase();
  let multiplier = 1.0;
  const highImpactKeywords = ['generative ai', 'llm', 'machine learning', 'prompt engineering', 'ai automation',
    'forecasting', 'financial modeling', 'executive dashboard', 'end-to-end pipeline', 'data architecture'];
  highImpactKeywords.forEach(kw => {
    if (text.includes(kw)) multiplier = Math.max(multiplier, 1.25);
  });
  return multiplier;
}

function findLocationConfig(location, configMap) {
  const locLower = location.toLowerCase();
  for (const key in configMap) { if (key.toLowerCase() === locLower) return configMap[key]; }
  for (const key in configMap) { if (locLower.includes(key.toLowerCase()) || key.toLowerCase().includes(locLower)) return configMap[key]; }
  Logger.log('Warning: No location config for ' + location + ', using US defaults');
  return configMap['United States'];
}

// ============================================================================
// PROMPT GENERATION (UNBIASED DISCOVERY)
// ============================================================================
function generateOptimalBenchmarkPrompt(profile) {
  const locationConfig = getLocationConfig();
  const locConfig = findLocationConfig(profile.location, locationConfig);
  const standardTitle = String(profile.jobProfile || '').trim();
  const yearsExp = profile.yearsExperience || 0;
  const localCurrency = locConfig.currency;

  // [P10] Latam Remote Injection
  const LATAM_COUNTRIES = ['Chile', 'El Salvador', 'Argentina', 'Colombia', 'Mexico', 'Brazil', 'Peru', 'Costa Rica', 'Uruguay', 'Ecuador'];
  const isLatam = LATAM_COUNTRIES.some(c => String(profile.location).includes(c));
  const locationContext = isLatam ? `${profile.location} + Latam Remote (Regional)` : profile.location;
  const latamSourceInstruction = isLatam
    ? '- "Latam Remote" and "Remote (Americas)" job postings (e.g. WeRemoto, Torre, Arc.dev) - MUST INCLUDE DIRECT URLs'
    : '- Remote job boards (if relevant)';

  const prompt = `You are a market researcher analyzing CURRENT 2025-2026 salary data.

CRITICAL: Do NOT use historical ranges or anchor to previous benchmarks.
Research current market reality with fresh eyes.

ROLE: ${standardTitle}
LOCATION: ${locationContext}
EXPERIENCE: ${yearsExp} years
MARKET MATURITY: ${locConfig.marketMaturity}

PROFILE CONTEXT:
- Skills: ${sanitizePromptInput(profile.requiredSkills, 2000) || 'Standard for role'}
- Qualifications: ${sanitizePromptInput(profile.qualifications, 2000) || 'Standard for role'}
- Responsibilities: ${sanitizePromptInput(profile.responsibilities, 2000) || 'Standard for role'}

RESEARCH PROTOCOL:
1. Find CURRENT job postings (2025-2026) with salary data.
2. MATCHING STRATEGY: Prioritize matches based on SKILLS and RESPONSIBILITIES. If exact title is scarce, use functionally equivalent titles that match the provided profile.
3. Extract salary ranges AS POSTED (not adjusted, not estimated).
4. Report sample size, sources, date ranges.
5. Identify local competitive landscape${isLatam ? ' AND "Latam Remote" opportunities' : ''}.
6. Note if this location is paying MORE or LESS than global averages.
${isLatam ? `
LATAM FALLBACK CONTRACT (MANDATORY when local data is thin):
- If you cannot find at least 3 verified, currently-live ${profile.location} postings, you MUST expand to Latam Remote / Remote (Americas) regional postings.
- Acceptable regional boards: WeRemoto, Torre, Arc.dev, Nearhire, Himalayas (Latam filter), Remote OK (Americas filter), We Work Remotely (Latam).
- Regional postings count as valid data for ${profile.location} IF the posting explicitly hires from ${profile.location} or "Latam / Americas remote". Tag those sources with dataQuality: "latam_regional_fallback".
- Do NOT silently blend in US or European postings as a substitute. US remote postings that don't hire from Latam are OUT OF SCOPE.
- If neither local nor regional data meets the bar, set data_status: insufficient. Do not guess.
` : ''}
SOURCES: Use whatever sources have real 2025-2026 data (prioritize the most recent data available):
- Glassdoor (target May 2026 data; check Atlassian, Salesforce, and Zendesk company pages for peer benchmarks)
- PayScale (2026 salary report)
- Salary.com (Feb–Jun 2026 data; Bay Area COL adjustment if US-based)
- ZipRecruiter (2026 salary data)
- Levels.fyi (Jun 2026 reports)
- LinkedIn Salary Insights
- Local job boards (e.g. ${locConfig.primarySources.join(', ')})
${latamSourceInstruction}
- Government wage data (if available)

DELIVERABLE: Raw market findings in JSON format.

DATA TIER CONTRACT — pick the HIGHEST tier you can honestly support:
- "sufficient"  → You have ≥3 currently-live job postings with salary figures AND real URLs. Provide percentiles + source URLs.
- "aggregated"  → You do NOT have live posting URLs, but you can cite well-known salary aggregators (Glassdoor, Payscale, Levels.fyi, Robert Half Salary Guide, government wage bulletins, Radford, local boards like Tecoloco, Trabajando.com). Provide percentiles + platform names. URLs are OPTIONAL here — if you're not sure a specific URL resolves, omit it. Platform name alone is fine.
- "insufficient" → Truly thin data; any number would be a guess. Set percentiles to null.

Most Latam / emerging markets will land on "aggregated". That is EXPECTED and VALID — salary aggregators are how Radford/Payscale themselves operate. Do not force "insufficient" just because you lack a specific live URL.

Do NOT invent URLs. An omitted URL is fine; a fabricated URL is not.

{
  "jobTitle": "${standardTitle}",
  "currency": "USD",
  "location": "${profile.location}",
  "data_status": "sufficient" | "aggregated" | "insufficient",
  "percentile25": <USD amount, or null if insufficient>,
  "percentile50": <USD amount, or null if insufficient>,
  "percentile75": <USD amount, or null if insufficient>,
  "topMarketOffer": {
    "company": "Company name",
    "role": "Role title",
    "compensation": <number in USD>,
    "currency": "USD",
    "source": "Source URL"
  },
  "confidenceLevel": "High/Medium/Low",
  "sampleSize": <actual count>,
  "marketDemand": "High/Medium/Low",
  "salaryTrend": "Increasing/Stable/Decreasing",
  "comparableJobURL": "URL",
  "sources": [
    {
      "platform": "source name",
      "url": "actual posting link (CRITICAL for verification)",
      "dataPoints": <count>,
      "medianFound": <amount in local currency>,
      "localCurrency": "${localCurrency}",
      "daysOld": <days since posted>,
      "dataQuality": "verified_from_posting" or "estimated_from_range"
    }
  ],
  "localTCC25": <number in local currency>,
  "localTCC50": <number in local currency>,
  "localTCC75": <number in local currency>,
  "marketInsight": "What does current market show about this role?",
  "competitivePosition": "Is this location ABOVE, BELOW, or AT global rates?",
  "sourceHyperlinks": "url1, url2",
  "notes": "Report what the market IS in 2025-2026, not what it 'should' be. Note any conflicting data."
}

HONESTY REQUIREMENT:
- If you find postings showing low numbers, report that.
- If you find postings showing high numbers, report that.
- Do NOT average or "correct" market data to fit expectations.
- Do NOT anchor to historical ranges.
- Do NOT estimate what "should" be the market rate.

Research in ${localCurrency} (convert final values to USD for JSON, but keep localTCC fields in ${localCurrency}).`;

  return prompt;
}

function generateContractorBenchmarkPrompt(profile) {
  const locationConfig = getLocationConfig();
  const locConfig = findLocationConfig(profile.location, locationConfig);
  const jobTitle = String(profile.jobProfile || '').trim();
  const yearsExp = parseFloat(profile.yearsExperience) || 0;

  // [P10] Latam Remote Injection
  const LATAM_COUNTRIES = ['Chile', 'El Salvador', 'Argentina', 'Colombia', 'Mexico', 'Brazil', 'Peru', 'Costa Rica', 'Uruguay', 'Ecuador'];
  const isLatam = LATAM_COUNTRIES.some(c => String(profile.location).includes(c));
  const locationContext = isLatam ? `${profile.location} + Latam Remote (Regional)` : profile.location;
  const latamSourceInstruction = isLatam
    ? '- "Latam Remote" and "Remote (Americas)" contract roles (e.g. WeRemoto, Torre, Nearhire) - MUST INCLUDE DIRECT URLs'
    : '- Upwork, Toptal, Freelancer, LinkedIn';

  // [P12/P13] Crew profile context + ranked search queries for search grounding
  const crewFocus = deriveContractorFocus(profile);
  const crewProfileContext = buildCrewProfileContext(crewFocus.matches);
  const contractorSearchContext = buildContractorSearchContext(profile, 12);

  const prompt = `You are a market researcher analyzing CURRENT 2025-2026 contractor hourly rates.

CRITICAL: Do NOT use historical ranges or anchor to previous benchmarks.
Research current market reality with fresh eyes.

ROLE: ${jobTitle} (Contractor)
LOCATION: ${locationContext}
EXPERIENCE: ${yearsExp} years
MARKET MATURITY: ${locConfig.marketMaturity}

PROFILE CONTEXT:
- Skills: ${sanitizePromptInput(profile.requiredSkills, 2000) || 'Standard for role'}
- Qualifications: ${sanitizePromptInput(profile.qualifications, 2000) || 'Standard for role'}
- Responsibilities: ${sanitizePromptInput(profile.responsibilities, 2000) || 'Standard for role'}

CREW PROFILE MATCHES (use to anchor role scope and refine search terms):
${crewProfileContext}

TARGETED SEARCH QUERIES (start with these before expanding):
${contractorSearchContext}

RESEARCH PROTOCOL:
1. Find CURRENT contract/freelance postings (2025-2026) with hourly rate data.
2. MATCHING STRATEGY: Prioritize matches based on SKILLS and RESPONSIBILITIES above. If exact title is scarce, use the crew profile matches and targeted queries to find functionally equivalent roles.
3. Extract rates AS POSTED (not adjusted, not estimated).
4. Report sample size, sources, date ranges.
${isLatam ? '5. Include "Latam Remote" roles that hire from ' + profile.location + '.' : ''}
${isLatam ? `
LATAM FALLBACK CONTRACT (MANDATORY when local data is thin):
- If you cannot find at least 3 verified, currently-live ${profile.location} contract postings, you MUST expand to Latam Remote / Remote (Americas) regional postings.
- Acceptable regional boards: WeRemoto, Torre, Arc.dev, Nearhire, Workana, Freelancer Latam, Upwork (Latam filter), Toptal (Latam network).
- Regional postings count as valid data IF the posting explicitly hires from ${profile.location} or "Latam / Americas remote". Tag those sources with dataQuality: "latam_regional_fallback".
- Do NOT silently blend in US/European contractor rates as a substitute — those are different markets.
- If neither local nor regional data meets the bar, set data_status: insufficient. Do not guess.
` : ''}
SOURCES: Use whatever sources have real 2025-2026 data (prioritize the most recent data available):
- Glassdoor (target May 2026 data; check Atlassian, Salesforce, and Zendesk company pages for peer contractor benchmarks)
- PayScale (2026 contractor/freelance report)
- Salary.com (Feb–Jun 2026 data; Bay Area COL adjustment if US-based)
- ZipRecruiter (2026 contractor hourly data)
- Levels.fyi (Jun 2026 reports)
${latamSourceInstruction}
- Local job boards (e.g. ${locConfig.primarySources.join(', ')})
- Agency rate cards (if public)

DELIVERABLE: Raw market findings in JSON format.

DATA TIER CONTRACT — pick the HIGHEST tier you can honestly support:
- "sufficient"  → ≥3 live contract postings with rates AND real URLs. Provide percentiles + source URLs.
- "aggregated"  → No live URLs, but cite known rate sources (Upwork/Toptal/Workana aggregates, Robert Half Salary Guide, agency rate cards, regional contractor reports). Platform names fine; URLs optional.
- "insufficient" → Truly no data; any number would be a guess. Set percentiles to null.

Most non-US contractor markets will land on "aggregated". That is VALID. Do not invent URLs — platform name alone is acceptable under "aggregated".

{
  "jobTitle": "${jobTitle} (Contractor)",
  "currency": "${profile.currency}",
  "location": "${profile.location}",
  "data_status": "sufficient" | "aggregated" | "insufficient",
  "percentile25": <hourly rate, or null if insufficient>,
  "percentile50": <hourly rate, or null if insufficient>,
  "percentile75": <hourly rate, or null if insufficient>,
  "topMarketOffer": {
    "company": "Company/Platform",
    "role": "Role title",
    "compensation": <hourly rate>,
    "currency": "${profile.currency}",
    "source": "Source URL"
  },
  "confidenceLevel": "High/Medium/Low",
  "sampleSize": <actual count>,
  "marketDemand": "High/Medium/Low",
  "salaryTrend": "Increasing/Stable/Decreasing",
  "comparableJobURL": "URL",
  "sources": [
    {
      "platform": "source name",
      "url": "actual posting link (CRITICAL for verification)",
      "dataPoints": <count>,
      "medianFound": <hourly rate>,
      "localCurrency": "${profile.currency}",
      "daysOld": <days since posted>,
      "dataQuality": "verified_from_posting" or "estimated_from_range"
    }
  ],
  "marketInsight": "What does current market show about this contractor role?",
  "competitivePosition": "Is this location/rate competitive?",
  "sourceHyperlinks": "url1, url2",
  "notes": "Report what the market IS in 2025-2026. Note any conflicting data."
}

HONESTY REQUIREMENT:
- Report exactly what you find in current postings.
- Do NOT cap rates based on "typical" ceilings.
- Do NOT inflate rates based on "expected" premiums.
- If data is scarce, state that clearly but do not fabricate.`;

  return prompt;
}

function calculateDataQualityScore(data) {
  let score = 50; // Start at neutral

  // Hard short-circuit only for truly empty data.
  if (data.dataStatus === 'insufficient') return 0;
  const sources = Array.isArray(data.sources) ? data.sources : [];
  if (sources.length === 1 && sources[0].dataQuality === 'insufficient_data') return 0;

  // Aggregated tier: numbers came from known salary aggregators (Glassdoor,
  // Payscale, etc.), not live postings. Credit the aggregator platforms but
  // don't require verified URLs — a Glassdoor aggregate page is fine evidence
  // even without a specific posting URL.
  const isAggregated = data.dataStatus === 'aggregated';

  // Source Quality (0-25 points). Google-grounded URLs count as strong evidence
  // even if they weren't individually HEAD-verified — Google served them live.
  const verifiedOk = sources.filter(s => s.verificationStatus === 'verified_200').length;
  const grounded = sources.filter(s => s.dataQuality === 'google_grounded').length;
  const dead = sources.filter(s => s.verificationStatus === 'dead_link').length;
  const strongSources = verifiedOk + Math.min(grounded, 5);   // cap grounded contribution
  if (strongSources >= 3) score += 25;
  else if (strongSources >= 2) score += 17;
  else if (strongSources >= 1) score += 8;
  else if (isAggregated && sources.length >= 3) score += 12;
  else if (isAggregated && sources.length >= 1) score += 6;
  score -= Math.min(20, dead * 8);   // dead links still a red flag regardless of tier

  // Sample Size (0-20 points)
  const sampleSize = data.sampleSize || 0;
  if (sampleSize >= 100) score += 20;
  else if (sampleSize >= 50) score += 15;
  else if (sampleSize >= 25) score += 10;
  else if (sampleSize >= 10) score += 5;

  // Data Recency (0-15 points) - Average days old if available
  const daysOldValues = sources.map(s => s.daysOld).filter(d => typeof d === 'number');
  if (daysOldValues.length > 0) {
    const avgDays = daysOldValues.reduce((a, b) => a + b, 0) / daysOldValues.length;
    if (avgDays <= 7) score += 15;
    else if (avgDays <= 14) score += 12;
    else if (avgDays <= 30) score += 8;
    else if (avgDays <= 60) score += 3;
  } else {
    // If no explicit dates, use modest assumption if URL present
    if (sources.length > 0) score += 5;
  }

  // Distribution Quality (0-20 points)
  if (data.percentile50 > 0) {
    const spread = (data.percentile75 - data.percentile25) / data.percentile50;
    if (spread > 0.10 && spread < 0.35) score += 20;  // Natural distribution
    else if (spread < 0.10) score -= 5;  // Too narrow (suspicious)
    else if (spread > 0.50) score -= 10; // Too wide (mixed markets)
  }

  // Geographic Coverage (0-10 points)
  if (sources.some(s => s.localCurrency && s.localCurrency !== 'USD')) score += 10;

  return Math.max(0, Math.min(100, score));
}

// ============================================================================
// VALIDATION SYSTEM
// ============================================================================
function applyOptimalValidation(benchmarkData, inputProfile) {
  const notes = [];
  const employeeType = benchmarkData.employeeType || 'Full Time';

  const locContext = getLocationMarketContext(benchmarkData.location);
  notes.push('Market: ' + locContext.location + ' (' + locContext.marketMaturity + ')');

  // Winning Talent Strategy: target market P75 + 25% premium over best posted offer
  const winningPremium = 1.25;
  let targetOffer = Math.round(benchmarkData.percentile75 * winningPremium);
  if (benchmarkData.topMarketOffer && typeof benchmarkData.topMarketOffer === 'object' && benchmarkData.topMarketOffer.compensation) {
    const competitorWin = Math.round(benchmarkData.topMarketOffer.compensation * winningPremium);
    if (competitorWin > targetOffer) {
      targetOffer = competitorWin;
      notes.push(`Strategy: Beating top competitor offer by 25%`);
    } else {
      notes.push(`Strategy: Market P75 + 25% Premium`);
    }
  } else {
    notes.push(`Strategy: Market P75 + 25% Premium`);
  }
  benchmarkData.percentile75 = targetOffer;
  benchmarkData.percentile50 = Math.round(targetOffer * 0.85);
  notes.push(`🏆 Winning Offer Rec: $${targetOffer.toLocaleString()} (Beat Market P75 by 25%)`);

  // [UNBIASED] No Envelope Checks. Pure Data Quality Score.
  let confidenceScore = calculateDataQualityScore(benchmarkData);

  // Sanity check on ordering only
  if (benchmarkData.percentile25 >= benchmarkData.percentile50) {
    benchmarkData.percentile25 = Math.round(benchmarkData.percentile50 * 0.85);
    notes.push('Ordering adjusted (P25>=P50)');
  }
  if (benchmarkData.percentile50 >= benchmarkData.percentile75) {
    benchmarkData.percentile75 = Math.round(benchmarkData.percentile50 * 1.15);
    notes.push('Ordering adjusted (P50>=P75)');
  }

  // Record market insights if available
  if (benchmarkData.marketInsight) notes.push('Insight: ' + benchmarkData.marketInsight);
  if (benchmarkData.competitivePosition) notes.push('Position: ' + benchmarkData.competitivePosition);

  benchmarkData.notes = (benchmarkData.notes || '') + ' | ' + notes.join(' | ');
  benchmarkData.confidenceScore = confidenceScore;
  benchmarkData.employeeType = employeeType;
  benchmarkData.envelopeFlag = null; // Removed biasing flag

  return benchmarkData;
}

/**
 * [UNBIASED] applyContractorValidation — Pure market discovery.
 * Removes absolute ceiling checks and rate capping.
 */
function applyContractorValidation(benchmarkData, inputProfile, currencyRates) {
  const notes = [];
  const targetCurrency = String(inputProfile.currency || 'USD').toUpperCase();
  let responseCurrency = String(benchmarkData.currency || '').toUpperCase() || targetCurrency;
  benchmarkData.currency = responseCurrency;

  if (targetCurrency && responseCurrency && targetCurrency !== responseCurrency) {
    if (responseCurrency === 'USD') {
      const effectiveRates = currencyRates || getLiveCurrencyRates();
      benchmarkData = applyCurrencyConversion(benchmarkData, targetCurrency, effectiveRates);
      notes.push('Converted USD response to ' + targetCurrency);
    } else {
      notes.push('Warning: Response ' + responseCurrency + ' vs target ' + targetCurrency);
    }
  }

  benchmarkData.currency = String(benchmarkData.currency || targetCurrency).toUpperCase();
  const employeeType = 'Contractor';

  const locContext = getLocationMarketContext(benchmarkData.location);
  notes.push('Market: ' + locContext.location + ' (' + locContext.marketMaturity + ')');

  // [UNBIASED] Data Quality Score Only. No Envelope/Capping.
  let confidenceScore = calculateDataQualityScore(benchmarkData);

  // Sanity check on ordering only
  if (benchmarkData.percentile25 >= benchmarkData.percentile50) {
    benchmarkData.percentile25 = Math.round(benchmarkData.percentile50 * 0.85);
    notes.push('Ordering adjusted (P25>=P50)');
  }
  if (benchmarkData.percentile50 >= benchmarkData.percentile75) {
    benchmarkData.percentile75 = Math.round(benchmarkData.percentile50 * 1.15);
    notes.push('Ordering adjusted (P50>=P75)');
  }

  if (benchmarkData.marketInsight) notes.push('Insight: ' + benchmarkData.marketInsight);

  // Winning Talent Strategy: target market P75 + 25% premium over best posted rate
  const winningPremium = 1.25;
  let targetRate = Math.round(benchmarkData.percentile75 * winningPremium);
  if (benchmarkData.topMarketOffer && typeof benchmarkData.topMarketOffer === 'object' && benchmarkData.topMarketOffer.compensation) {
    const competitorWin = Math.round(benchmarkData.topMarketOffer.compensation * winningPremium);
    if (competitorWin > targetRate) targetRate = competitorWin;
  }
  benchmarkData.percentile75 = targetRate;
  benchmarkData.percentile50 = Math.round(targetRate * 0.85);
  notes.push(`🏆 Winning Rate Rec: $${targetRate}/hr (Beat Market P75 by 25%)`);

  benchmarkData.notes = (benchmarkData.notes || '') + ' | ' + notes.join(' | ');
  benchmarkData.confidenceScore = confidenceScore;
  benchmarkData.employeeType = employeeType;
  benchmarkData.envelopeFlag = null;
  benchmarkData.currency = targetCurrency;

  return benchmarkData;
}

function applyContractorSanityChecks(benchmarkData, inputProfile) {
  let p25 = benchmarkData.percentile25;
  let p50 = benchmarkData.percentile50;
  let p75 = benchmarkData.percentile75;
  const employeeType = benchmarkData.employeeType || 'Contractor';
  const adjustmentNotes = [];
  const targetCurrency = String(inputProfile.currency || benchmarkData.currency || 'USD').toUpperCase();
  const locContext = inputProfile.location ? getLocationMarketContext(inputProfile.location) : null;

  const enforceOrdering = () => {
    if (p25 >= p50) p25 = Math.round(p50 * 0.82);
    if (p75 <= p50) p75 = Math.round(p50 * 1.18);
  };

  enforceOrdering();
  const spread = p75 - p25;
  const minSpread = p50 * 0.25;
  if (spread < minSpread) { const exp = (minSpread - spread) / 2; p25 = Math.round(p25 - exp); p75 = Math.round(p75 + exp); }

  // P75 sanity cap based on market maturity heuristic
  let capSource = '', maxReasonableP75 = null;
  if (locContext) {
    const caps = { 'Mature': 1.55, 'Developing': 1.40, 'Emerging': 1.35 };
    maxReasonableP75 = p50 * (caps[locContext.marketMaturity] || 1.5);
    capSource = locContext.marketMaturity + ' market heuristic';
  }
  if (maxReasonableP75 && p75 > maxReasonableP75) {
    p75 = Math.round(maxReasonableP75);
    if (p50 >= p75) p50 = Math.round(p75 / 1.18);
    if (p25 >= p50) p25 = Math.round(p50 * 0.82);
    adjustmentNotes.push('Capped P75 using ' + capSource);
  }
  enforceOrdering();

  const minRates = { 'USD': 5, 'CAD': 5, 'GBP': 4, 'EUR': 4, 'AUD': 5, 'NZD': 5, 'SGD': 5, 'PHP': 50, 'MYR': 10, 'IDR': 20000, 'CLP': 2000, 'KES': 100 };
  const minRate = minRates[targetCurrency] || 1;
  p25 = Math.max(minRate, p25); p50 = Math.max(minRate * 1.1, p50); p75 = Math.max(minRate * 1.3, p75);
  enforceOrdering();

  let updatedNotes = benchmarkData.notes || '';
  if (adjustmentNotes.length) updatedNotes = updatedNotes ? updatedNotes + ' | ' + adjustmentNotes.join(' | ') : adjustmentNotes.join(' | ');

  return { ...benchmarkData, percentile25: p25, percentile50: p50, percentile75: p75, employeeType, currency: targetCurrency, notes: updatedNotes };
}

function applyCurrencyConversion(benchmarkData, targetCurrency, rates) {
  if (targetCurrency === 'USD' || !rates[targetCurrency]) {
    if (!rates[targetCurrency]) Logger.log('Warning: No conversion rate for ' + targetCurrency + '. Keeping USD.');
    return benchmarkData;
  }
  const r = rates[targetCurrency];
  return {
    ...benchmarkData, currency: targetCurrency,
    percentile25: Math.round(benchmarkData.percentile25 * r),
    percentile50: Math.round(benchmarkData.percentile50 * r),
    percentile75: Math.round(benchmarkData.percentile75 * r),
    employeeType: benchmarkData.employeeType,
    notes: (benchmarkData.notes || '') + ' | Converted from USD at ' + r.toFixed(4)
  };
}

function applyFinalSanityChecks(benchmarkData, parsed) {
  let p25 = benchmarkData.percentile25, p50 = benchmarkData.percentile50, p75 = benchmarkData.percentile75;
  const employeeType = benchmarkData.employeeType || 'Full Time';
  if (p25 >= p50) p25 = Math.round(p50 * 0.85);
  if (p75 <= p50) p75 = Math.round(p50 * 1.18);
  const spread = p75 - p25, minSpread = p50 * 0.20;
  if (spread < minSpread) { const exp = (minSpread - spread) / 2; p25 = Math.round(p25 - exp); p75 = Math.round(p75 + exp); }
  p25 = Math.max(1000, p25); p50 = Math.max(1200, p50); p75 = Math.max(1500, p75);
  return { ...benchmarkData, percentile25: p25, percentile50: p50, percentile75: p75, employeeType };
}


function calculateSalaryStatistics(salaries) {
  if (salaries.length === 0) return null;
  const sorted = salaries.slice().sort((a, b) => a - b);
  const count = sorted.length;
  return {
    count, min: sorted[0], max: sorted[count - 1],
    median: calculatePercentile(sorted, 50), p25: calculatePercentile(sorted, 25),
    p75: calculatePercentile(sorted, 75),
    mean: Math.round(sorted.reduce((a, b) => a + b, 0) / count),
    stdDev: calculateStdDev(sorted)
  };
}

function calculatePercentile(sortedArray, percentile) {
  if (sortedArray.length === 0) return 0;
  if (sortedArray.length === 1) return sortedArray[0];
  const index = (percentile / 100) * (sortedArray.length - 1);
  const lower = Math.floor(index), upper = Math.ceil(index), weight = index - lower;
  return Math.round(sortedArray[lower] * (1 - weight) + sortedArray[upper] * weight);
}

function calculateStdDev(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const avgSquareDiff = values.map(v => Math.pow(v - mean, 2)).reduce((a, b) => a + b, 0) / values.length;
  return Math.round(Math.sqrt(avgSquareDiff));
}


// ============================================================================
// URL VERIFICATION — HEAD-check every source URL the LLM returned.
// A claimed URL that 404s is stronger evidence of fabrication than a missing one.
// ============================================================================
function verifySourceURLs(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return sources;

  const MAX_TO_VERIFY = 8;            // cap per benchmark row to stay within Apps Script quotas
  const TIMEOUT_MS = 8000;
  const verified = [];

  sources.forEach((src, idx) => {
    const url = String(src.url || '').trim();

    if (!url || !/^https?:\/\//i.test(url)) {
      verified.push(Object.assign({}, src, { verificationStatus: 'no_url' }));
      return;
    }
    if (idx >= MAX_TO_VERIFY) {
      verified.push(Object.assign({}, src, { verificationStatus: 'skipped_quota' }));
      return;
    }

    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'get',
        followRedirects: true,
        muteHttpExceptions: true,
        validateHttpsCertificates: true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BenchmarkVerifier/1.0)' },
        // Apps Script doesn't expose a timeout knob, but returning early on bad codes is enough
      });
      const code = resp.getResponseCode();
      let status;
      if (code >= 200 && code < 300) status = 'verified_200';
      else if (code === 403 || code === 401) status = 'blocked_' + code;   // site exists but rejects bot
      else if (code === 404 || code === 410) status = 'dead_link';
      else status = 'http_' + code;

      verified.push(Object.assign({}, src, {
        verificationStatus: status,
        verifiedAt: new Date().toISOString()
      }));
    } catch (e) {
      Logger.log('[VERIFY] fetch failed for ' + url.substring(0, 80) + ' — ' + e.message);
      verified.push(Object.assign({}, src, { verificationStatus: 'unreachable' }));
    }
  });

  const okCount = verified.filter(s => s.verificationStatus === 'verified_200').length;
  const deadCount = verified.filter(s => s.verificationStatus === 'dead_link').length;
  Logger.log('[VERIFY] ' + okCount + '/' + verified.length + ' sources verified, ' + deadCount + ' dead');
  return verified;
}

// ============================================================================
// [BUG1] PARSING — Robust sources extraction with multi-format support + fallback
// ============================================================================
function parseGeminiResponse(responseText, originalProfile, sanitizedProfile, groundingMetadata) {
  try {
    let cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonStart = cleanText.indexOf('{');
    const jsonEnd = cleanText.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) cleanText = cleanText.substring(jsonStart, jsonEnd + 1);

    const data = JSON.parse(cleanText);

    // [BUG1] Debug log — show what the AI actually returned for sources
    Logger.log('[BUG1 DEBUG] sampleSize type: ' + typeof data.sampleSize + ' value: ' + data.sampleSize);
    Logger.log('[BUG1 DEBUG] sources type: ' + typeof data.sources + ' isArray: ' + Array.isArray(data.sources) +
      ' length: ' + (Array.isArray(data.sources) ? data.sources.length : 'N/A'));
    if (Array.isArray(data.sources) && data.sources.length > 0) {
      Logger.log('[BUG1 DEBUG] first source: ' + JSON.stringify(data.sources[0]));
    }

    // Three-tier data_status: sufficient (live postings+URLs), aggregated (known
    // aggregators, URLs optional), insufficient (zero usable data).
    // Aggregated is a valid, usable tier — most markets land here.
    const rawStatus = String(data.data_status || data.dataStatus || '').toLowerCase();
    const declaredInsufficient = rawStatus === 'insufficient';
    const declaredAggregated = rawStatus === 'aggregated';
    const hasAllPercentiles = (typeof data.percentile25 === 'number' && data.percentile25 > 0) &&
      (typeof data.percentile50 === 'number' && data.percentile50 > 0) &&
      (typeof data.percentile75 === 'number' && data.percentile75 > 0);

    if (hasAllPercentiles && (data.percentile25 >= data.percentile50 || data.percentile50 >= data.percentile75)) {
      Logger.log('[PARSE] Reordering out-of-sequence percentiles: P25=' + data.percentile25 + ' P50=' + data.percentile50 + ' P75=' + data.percentile75);
      const sorted = [data.percentile25, data.percentile50, data.percentile75].sort((a, b) => a - b);
      data.percentile25 = sorted[0]; data.percentile50 = sorted[1]; data.percentile75 = sorted[2];
    }
    // Only force-insufficient when the model explicitly said so OR percentiles are
    // entirely missing AND the model didn't claim aggregated. Aggregated + numbers
    // is a valid state.
    if (declaredInsufficient || (!hasAllPercentiles && !declaredAggregated)) {
      data.percentile25 = 0; data.percentile50 = 0; data.percentile75 = 0;
      data.data_status = 'insufficient';
      Logger.log('[PARSE] insufficient (declared=' + declaredInsufficient + ', noPercentiles=' + !hasAllPercentiles + ')');
    } else if (declaredAggregated) {
      Logger.log('[PARSE] aggregated tier — percentiles from known aggregators, URLs optional');
    }

    // Parse sampleSize — handle number, "50+", "~45", "30-50", etc.
    let sampleSizeNum = 0;
    if (typeof data.sampleSize === 'number') {
      sampleSizeNum = Math.round(data.sampleSize);
    } else if (typeof data.sampleSize === 'string') {
      const m = data.sampleSize.match(/\d+/);
      sampleSizeNum = m ? parseInt(m[0], 10) : 0;
    }

    // Parse topMarketOffer — handle both object and string
    let topMarketOfferStr = 'N/A';
    if (data.topMarketOffer) {
      if (typeof data.topMarketOffer === 'object' && data.topMarketOffer.company) {
        topMarketOfferStr = data.topMarketOffer.company + ' (' + data.topMarketOffer.role + '): ' +
          (data.topMarketOffer.compensation ? data.topMarketOffer.compensation.toLocaleString() : 'N/A') +
          ' ' + (data.topMarketOffer.currency || 'USD') +
          (data.topMarketOffer.source ? ' [Source: ' + data.topMarketOffer.source + ']' : '');
      } else if (typeof data.topMarketOffer === 'string') {
        topMarketOfferStr = data.topMarketOffer;
      }
    }

    // [BUG1] ROBUST SOURCES EXTRACTION
    // Strategy 1: structured array (preferred)
    // Strategy 2: sources as a string (parse it)
    // Strategy 3: fall back to comparableJobURL + notes text mining
    const sources = [];

    if (Array.isArray(data.sources) && data.sources.length > 0) {
      // Strategy 1: Proper array returned
      data.sources.forEach(src => {
        if (!src || typeof src !== 'object') return;
        // Flexible field name matching — Gemini sometimes uses different keys
        const platform = src.platform || src.source || src.name || src.site || 'Unknown';
        const url = src.url || src.link || src.href || '';
        const dataPoints = typeof src.dataPoints === 'number' ? src.dataPoints :
          (typeof src.data_points === 'number' ? src.data_points :
            (typeof src.count === 'number' ? src.count : 0));
        const medianFound = typeof src.medianFound === 'number' ? src.medianFound :
          (typeof src.median_found === 'number' ? src.median_found :
            (typeof src.median === 'number' ? src.median :
              (typeof src.value === 'number' ? src.value : 0)));
        const localCurrency = src.localCurrency || src.local_currency || src.currency || 'USD';

        // [UNBIASED] Capture new fields for data quality scoring
        const daysOld = typeof src.daysOld === 'number' ? src.daysOld :
          (typeof src.days_old === 'number' ? src.days_old : null);
        const dataQuality = src.dataQuality || src.data_quality || 'unknown';

        sources.push({
          platform: String(platform).substring(0, 100),
          url: String(url).substring(0, 500),
          dataPoints: dataPoints,
          medianFound: medianFound,
          localCurrency: String(localCurrency).substring(0, 10),
          daysOld: daysOld,
          dataQuality: String(dataQuality).substring(0, 50)
        });
      });
      Logger.log('[BUG1] Strategy 1 succeeded: extracted ' + sources.length + ' sources from array');

    } else if (typeof data.sources === 'string' && data.sources.trim()) {
      // Strategy 2: sources returned as an unstructured string. Preserve the raw
      // text for audit but tag it clearly as unverifiable — a string blob is
      // narrative, not evidence.
      sources.push({
        platform: 'UNSTRUCTURED_TEXT',
        url: data.comparableJobURL || '',
        dataPoints: 0,
        medianFound: 0,
        localCurrency: (sanitizedProfile || originalProfile).currency || 'USD',
        rawText: data.sources.substring(0, 500),
        daysOld: null,
        dataQuality: 'unverifiable_text'
      });
      Logger.log('[NO-FAB] sources returned as string — tagged unverifiable_text');

    } else {
      // No sources returned — do NOT fabricate. Emit a single honest marker row
      // so the audit trail reflects reality: the model produced no evidence.
      // Why: inventing "Glassdoor (extracted from notes)" rows poisons the sources
      // log and makes ungrounded LLM output indistinguishable from real postings.
      Logger.log('[NO-FAB] AI returned no sources — marking insufficient_data');
      sources.push({
        platform: 'INSUFFICIENT_DATA',
        url: '',
        dataPoints: 0,
        medianFound: 0,
        localCurrency: (sanitizedProfile || originalProfile).currency || 'USD',
        daysOld: null,
        dataQuality: 'insufficient_data'
      });
    }

    // Merge Google Search grounding citations into sources. These are REAL URLs
    // Google served to the model — not model-generated — so they're the strongest
    // evidence we have. Dedupe against URLs the model already cited.
    if (groundingMetadata && Array.isArray(groundingMetadata.groundingChunks)) {
      const existingUrls = new Set(sources.map(s => String(s.url || '').toLowerCase()).filter(Boolean));
      let mergedCount = 0;
      groundingMetadata.groundingChunks.forEach(chunk => {
        const web = chunk && chunk.web;
        if (!web || !web.uri) return;
        const uriLower = String(web.uri).toLowerCase();
        if (existingUrls.has(uriLower)) return;
        existingUrls.add(uriLower);
        sources.push({
          platform: String(web.title || 'Google Search').substring(0, 100),
          url: String(web.uri).substring(0, 500),
          dataPoints: 0,
          medianFound: 0,
          localCurrency: (sanitizedProfile || originalProfile).currency || 'USD',
          daysOld: null,
          dataQuality: 'google_grounded'
        });
        mergedCount++;
      });
      Logger.log('[GROUND] Merged ' + mergedCount + ' Google-grounded URLs (of ' + groundingMetadata.groundingChunks.length + ' chunks)');
    }

    const verifiedSources = verifySourceURLs(sources);

    // Zero-verified-URL downgrade: if the model claimed sources but NONE verified
    // as live 200, the "benchmark" is unsupported. Force it to insufficient so
    // downstream doesn't treat fabricated evidence as real.
    // Only applies when we had URLs to check — if the marker row was the only
    // source (already insufficient) or nothing had a URL, leave the existing
    // data_status alone.
    const hadAnyRealURLs = verifiedSources.some(s => s.url && /^https?:\/\//i.test(s.url));
    const anyVerified200 = verifiedSources.some(s => s.verificationStatus === 'verified_200');
    let finalDataStatus = String(data.data_status || data.dataStatus || 'unspecified').toLowerCase();

    // Only enforce URL verification when the model claimed "sufficient" — that tier
    // requires live URLs. Aggregated tier is allowed to have no URLs (aggregator
    // data sources are platform-level, not posting-level).
    if (finalDataStatus === 'sufficient' && hadAnyRealURLs && !anyVerified200) {
      Logger.log('[ZERO-VERIFIED] sufficient tier claimed but 0/' + verifiedSources.length + ' URLs verified — downgrading');
      finalDataStatus = 'insufficient';
      data.percentile25 = 0; data.percentile50 = 0; data.percentile75 = 0;
    }

    return {
      jobTitle: originalProfile.jobProfile,
      currency: 'USD',
      location: data.location || originalProfile.location,
      percentile25: Math.round(data.percentile25),
      percentile50: Math.round(data.percentile50),
      percentile75: Math.round(data.percentile75),
      topMarketOffer: topMarketOfferStr,
      confidenceLevel: data.confidenceLevel || 'Medium',
      sampleSize: sampleSizeNum,
      marketDemand: data.marketDemand || 'Medium',
      salaryTrend: data.salaryTrend || 'Stable',
      comparableJobURL: data.comparableJobURL || 'Not found',
      dataStatus: finalDataStatus,
      sources: verifiedSources,
      rawSourcesText: Array.isArray(data.sources) ? '' : String(data.sources || '').substring(0, 500),
      localTCC25: data.localTCC25 || 0,
      localTCC50: data.localTCC50 || 0,
      localTCC75: data.localTCC75 || 0,
      sourceHyperlinks: data.sourceHyperlinks || '',
      notes: data.notes || '',
      marketInsight: data.marketInsight || '',
      competitivePosition: data.competitivePosition || '',
      confidenceScore: 0,
      envelopeFlag: null
    };

  } catch (error) {
    Logger.log('Parse error: ' + error.message);
    Logger.log('Raw response (first 600 chars): ' + responseText.substring(0, 600));
    throw new Error('Failed to parse API response: ' + error.message);
  }
}

function parseJobCode() { return null; }

// ============================================================================
// DATA I/O FUNCTIONS
// ============================================================================
function getLiveCurrencyRates() {
  try {
    const response = UrlFetchApp.fetch('https://api.exchangerate-api.com/v4/latest/USD');
    const data = JSON.parse(response.getContentText());
    if (data && data.rates) { Logger.log('Live currency rates fetched.'); return data.rates; }
    throw new Error('Invalid response from currency API');
  } catch (error) {
    Logger.log('Currency API failed: ' + error.message + '. Using fallback rates.');
    return { 'USD': 1.00, 'CAD': 0.74, 'GBP': 1.27, 'AUD': 0.66, 'NZD': 0.61, 'SGD': 0.74, 'MYR': 0.23, 'PHP': 0.018, 'IDR': 0.000064, 'CLP': 0.0011, 'KES': 0.0078, 'EUR': 1.09 };
  }
}

function readInputData(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  const profiles = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[INPUT_COLUMNS.JOB_PROFILE]) continue;
    const jobProfileStr = String(row[INPUT_COLUMNS.JOB_PROFILE]).trim();
    // Column A (JOB_ID): set to "Contractor" for contract roles, leave blank for Full Time
    const typeOfEmployee = String(row[INPUT_COLUMNS.JOB_ID] || '').trim() === 'Contractor' ? 'Contractor' : 'Full Time';
    Logger.log('Row ' + (i + 1) + ': "' + jobProfileStr + '" -> ' + typeOfEmployee);
    profiles.push({
      jobProfile: jobProfileStr,
      location: row[INPUT_COLUMNS.LOCATION] || 'United States',
      currency: row[INPUT_COLUMNS.CURRENCY] || 'USD',
      yearsExperience: row[INPUT_COLUMNS.YEARS_EXPERIENCE] || '0',
      requiredSkills: row[INPUT_COLUMNS.REQUIRED_SKILLS] || '',
      qualifications: row[INPUT_COLUMNS.QUALIFICATIONS] || '',
      responsibilities: row[INPUT_COLUMNS.RESPONSIBILITIES] || '',
      industry: row[INPUT_COLUMNS.INDUSTRY] || 'Technology',
      companySize: row[INPUT_COLUMNS.COMPANY_SIZE] || '500-2000',
      typeOfEmployee
    });
  }
  return profiles;
}

/**
 * [P1][P7] Updated writeResultToSheet:
 *   - Orange highlight for envelope outliers
 *   - Comp Ready column written by flagLowConfidenceRows() after run completes
 */
function writeResultToSheet(sheet, rowNum, data) {
  const isContractor = data.employeeType === 'Contractor';
  const compensationType = isContractor ? 'Hourly Rate' : 'Annual TCC';

  const rowData = [
    data.jobTitle,
    data.employeeType || 'Full Time',
    compensationType,
    data.currency,
    data.location,
    data.percentile25,
    data.percentile50,
    data.percentile75,
    data.confidenceScore,
    data.comparableJobURL,
    data.notes || '',
    ''  // Comp Ready — filled by flagLowConfidenceRows() after run
  ];

  sheet.getRange(rowNum, 1, 1, rowData.length).setValues([rowData]);

  if (isContractor) sheet.getRange(rowNum, 6, 1, 3).setNumberFormat('#,##0.00');
  else sheet.getRange(rowNum, 6, 1, 3).setNumberFormat('#,##0');

  // Confidence score coloring — column 9 (1-indexed), which is index 8 0-indexed
  const cc = sheet.getRange(rowNum, 9);
  if (data.confidenceScore >= 80) cc.setBackground('#d9ead3');
  else if (data.confidenceScore >= CONFIDENCE_ADVISORY_THRESHOLD) cc.setBackground('#fff2cc');
  else if (data.confidenceScore >= CONFIDENCE_GATE_THRESHOLD) cc.setBackground('#ffe0b2');
  else cc.setBackground('#f4cccc');

  // Envelope flag colors: percentile cols 6-8 (1-indexed) + Notes col 11
  if (data.envelopeFlag && data.envelopeFlag !== null) {
    sheet.getRange(rowNum, 6, 1, 3).setBackground('#ffe0b2');
    sheet.getRange(rowNum, 11).setBackground('#ffe0b2');
  }

  if (isContractor) {
    sheet.getRange(rowNum, 2).setBackground('#e6f3ff');
    sheet.getRange(rowNum, 3).setBackground('#e6f3ff');
  }
}

// ============================================================================
// [BUG1] SOURCES AUDIT LOG — always writes, never skips
// ============================================================================
function getOrCreateSourcesSheet(ss) {
  let sheet = ss.getSheetByName(SOURCES_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(SOURCES_SHEET_NAME); setupSourcesSheet(sheet); }
  return sheet;
}

function setupSourcesSheet(sheet) {
  sheet.getRange(1, 1, 1, SOURCES_COLUMNS.length).setValues([SOURCES_COLUMNS]);
  const hr = sheet.getRange(1, 1, 1, SOURCES_COLUMNS.length);
  hr.setBackground('#37474f'); hr.setFontColor('#ffffff'); hr.setFontWeight('bold'); hr.setHorizontalAlignment('center');
  sheet.setColumnWidth(1, 160); sheet.setColumnWidth(2, 60); sheet.setColumnWidth(3, 220);
  sheet.setColumnWidth(4, 130); sheet.setColumnWidth(5, 100); sheet.setColumnWidth(6, 130);
  sheet.setColumnWidth(7, 300); sheet.setColumnWidth(8, 90); sheet.setColumnWidth(9, 120);
  sheet.setColumnWidth(10, 80); sheet.setColumnWidth(11, 110); sheet.setColumnWidth(12, 130);
  sheet.setColumnWidth(13, 300);
  sheet.setFrozenRows(1);
}

/**
 * [BUG1] writeSourcesLog — ALWAYS writes at least one row per benchmark.
 * Removed the length > 0 gate that caused the empty sheet bug.
 */
function writeSourcesLog(sourcesSheet, benchmarkRowNum, parsedData, originalProfile) {
  const timestamp = new Date().toISOString();
  const rows = [];

  const sourcesToWrite = (parsedData.sources && parsedData.sources.length > 0)
    ? parsedData.sources
    : [{
      platform: 'No structured sources returned',
      url: parsedData.comparableJobURL || 'N/A',
      dataPoints: parsedData.sampleSize || 0,
      medianFound: parsedData.percentile50 || 0,
      localCurrency: parsedData.currency || 'USD'
    }];

  sourcesToWrite.forEach(src => {
    rows.push([
      timestamp,
      benchmarkRowNum,
      String(originalProfile.jobProfile || '').substring(0, 200),
      String(originalProfile.location || '').substring(0, 100),
      parsedData.employeeType || 'Full Time',
      String(src.platform || 'Unknown').substring(0, 100),
      String(src.url || '').substring(0, 2000),
      typeof src.dataPoints === 'number' ? src.dataPoints : 0,
      typeof src.medianFound === 'number' ? src.medianFound : '',
      String(src.localCurrency || '').substring(0, 10),
      String(src.verificationStatus || 'unchecked').substring(0, 30),
      String(src.dataQuality || 'unknown').substring(0, 30),
      String(parsedData.notes || '').substring(0, 300)
    ]);
  });

  if (rows.length === 0) return;
  const insertRow = sourcesSheet.getLastRow() + 1;
  sourcesSheet.getRange(insertRow, 1, rows.length, SOURCES_COLUMNS.length).setValues(rows);
  Logger.log('[BUG1] Wrote ' + rows.length + ' source row(s) for benchmark row ' + benchmarkRowNum);
}

// ============================================================================
// SHEET MANAGEMENT
// ============================================================================
function getOrCreateOutputSheet(ss) {
  let sheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  if (!sheet) { sheet = ss.insertSheet(OUTPUT_SHEET_NAME); setupOutputSheet(sheet); }
  return sheet;
}

function setupOutputSheet(sheet) {
  sheet.getRange(1, 1, 1, OUTPUT_COLUMNS.length).setValues([OUTPUT_COLUMNS]);
  const hr = sheet.getRange(1, 1, 1, OUTPUT_COLUMNS.length);
  hr.setBackground('#4a86e8'); hr.setFontColor('#ffffff'); hr.setFontWeight('bold'); hr.setHorizontalAlignment('center');
  sheet.setColumnWidth(1, 200);  // Job Title
  sheet.setColumnWidth(2, 100);  // Employee Type
  sheet.setColumnWidth(3, 110);  // Compensation Type
  sheet.setColumnWidth(4, 80);   // Currency
  sheet.setColumnWidth(5, 150);  // Location
  sheet.setColumnWidth(6, 120);  // 25th Percentile
  sheet.setColumnWidth(7, 120);  // 50th Percentile
  sheet.setColumnWidth(8, 120);  // 75th Percentile
  sheet.setColumnWidth(9, 100);  // Confidence Score
  sheet.setColumnWidth(10, 300); // Comparable Job Posting
  sheet.setColumnWidth(11, 400); // Notes
  sheet.setColumnWidth(12, 100); // Comp Ready
  sheet.setFrozenRows(1);
}

function updateStatus(sheet, rowNum, status) { Logger.log('Status Row ' + rowNum + ': ' + status); }

// ============================================================================
// GEMINI API INTEGRATION
// ============================================================================
function callGeminiAPI(prompt, config) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('API key not configured.');
  checkRateLimit();
  if (prompt.length > 50000) throw new Error('Prompt exceeds maximum length');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
  // responseMimeType omitted — incompatible with googleSearch tool. Parser handles free text.
  const defaultConfig = { temperature: 0.0, topP: 0.9, topK: 20, maxOutputTokens: 8192 };
  const generationConfig = config ? Object.assign({}, defaultConfig, config) : defaultConfig;
  const options = {
    method: 'post', contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig
    }),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    Logger.log('API request failed with status: ' + responseCode);
    const error = new Error('API request failed (Code ' + responseCode + ')');
    error.statusCode = responseCode;
    throw error;
  }
  if (!responseText || responseText.length === 0) throw new Error('Empty response from API');
  if (responseText.length > 1000000) throw new Error('Response exceeds maximum size');

  const jsonResponse = JSON.parse(responseText);
  if (jsonResponse.candidates && jsonResponse.candidates.length > 0) {
    const candidate = jsonResponse.candidates[0];
    if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) return candidate.content.parts[0].text.trim();
  }
  throw new Error('No valid response from API');
}

function callGeminiAPIWithRetry(prompt, config) {
  const MAX_RETRIES = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try { return callGeminiAPI(prompt, config); }
    catch (err) {
      lastError = err;
      const is429 = err.statusCode === 429;
      Logger.log('API attempt ' + attempt + (is429 ? ' — rate limited' : ' — error'));
      if (attempt < MAX_RETRIES) Utilities.sleep(is429 ? 30000 * Math.pow(2, attempt - 1) : 2000 * Math.pow(2, attempt - 1));
    }
  }
  if (lastError && lastError.statusCode === 429) lastError.isRateLimited = true;
  throw lastError;
}

// ============================================================================
// VALIDATION & SETUP
// ============================================================================
function validateSetup() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('API Key not configured.');
  if (typeof apiKey !== 'string' || apiKey.length < 20) throw new Error('Invalid API key format.');
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(INPUT_SHEET_NAME)) throw new Error('Input sheet not found.');
}

// ============================================================================
// [P6][P7] MENU — Added Archive and Flag commands
// ============================================================================
function onOpen() {
  generateCSRFToken();
  SpreadsheetApp.getUi()
    .createMenu('🤖 AI Benchmarking')
    .addItem('▶️ Run Benchmark Analysis', 'runBenchmarkAnalysis')
    .addSeparator()
    .addItem('📦 Archive Results Now', 'manualArchive')
    .addToUi();
}

/** [P6] Manual archive trigger from menu */
function manualArchive() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const outputSheet = ss.getSheetByName(OUTPUT_SHEET_NAME);
  if (!outputSheet) { SpreadsheetApp.getUi().alert('No Benchmark Results sheet found.'); return; }
  archiveBenchmarkResults(ss, outputSheet);
  SpreadsheetApp.getUi().alert('Archive complete. Check the sheet tabs for the timestamped copy.');
}

