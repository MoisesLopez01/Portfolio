// ============================================================
// SCRIPT: Employee Impact — Category-Level Contribution Signals
// ENV:    Google Apps Script
// ============================================================

const EI_CONFIG = {
  SHEET_NAME: "Employee Impact",
  
  // Job Family Groups
  GROUPS: {
    "Solution Architecture": ["Solution Architecture"],
    "Services": ["Managed Services & Support", "Service Delivery"],
    "Project Management": ["Operations"]
  },
  
  // Additional job-title filter: only match employees whose title includes this text
  TITLE_FILTERS: {
    "Project Management": "Project Management"
  },

  // Levels to exclude from signal calculations
  EXCLUDE_LEVELS: ["M4", "M5", "M6", "M7", "M8", "M9", "M10", "M11", "M12"],
  
  // Signal Thresholds
  THRESHOLDS: {
    TOP_BILLABLE_HOURS: 30,
    TOP_BILLABLE_RATIO: 0.80,
    SUPPORT_LOGGED_HOURS: 15,
    SUPPORT_BILLABLE_RATIO: 0.40,
    SUPPORT_UNBILLED_HOURS: 10
  }
};

/**
 * Main entry point for Dashboard data.
 */
function eiGetEmployeeImpactData_(viewMode) {
  const mode = viewMode || "contributors";
  const windowMondays = getThreeWeekWindow_();
  const windowKeys = new Set(windowMondays.map(d => weekKey_(d)));
  const weekList = Array.from(windowKeys);
  const w0Key = weekList[weekList.length - 1]; // Evaluated week
  const w1Key = weekList.length > 1 ? weekList[weekList.length - 2] : null;

  const roster = fhcReadFullRoster_();
  if (roster.size === 0) return { available: false };

  // 1. Read Utilization sheet (Primary source for detailed billed/unbilled by project)
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const utilSheet = ss.getSheetByName('Utilization');
  if (!utilSheet) return { available: false, message: "Utilization sheet not found" };

  const raw = utilSheet.getDataRange().getValues();
  const headers = raw[0].map(h => String(h || '').trim());
  
  const C = {
    resource: headers.indexOf('Resource'),
    project:  headers.indexOf('Project Name'),
    billable: headers.indexOf('Billable'),
    customer: headers.indexOf('Customer'),
    date:     headers.indexOf('Date'),
    actual:   headers.indexOf('Actual Time'),
  };

  const utilMap = new Map(); // employee -> Map<weekKey, { billed: 0, unbilled: 0, total: 0, projects: Set }>

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    const dateVal = parseDateValue_(row[C.date]);
    if (!dateVal) continue;
    
    const wk = weekKey_(dateVal);
    if (!windowKeys.has(wk)) continue;

    const resource = normalizeToRoster_(String(row[C.resource] || '').trim());
    const isBillable = String(row[C.billable] || '').toLowerCase() === 'yes';
    const actual = parseFloat(row[C.actual]) || 0;
    const project = String(row[C.project] || '').trim();
    const customer = String(row[C.customer] || '').trim();
    const isNoCustomer = (customer === '- No Customer/Project -' || project.includes('No Customer/Project'));

    if (!utilMap.has(resource)) utilMap.set(resource, new Map());
    const empMap = utilMap.get(resource);
    if (!empMap.has(wk)) empMap.set(wk, { billed: 0, unbilled: 0, total: 0, projects: new Set(), projectDetail: new Map() });
    const wkData = empMap.get(wk);

    wkData.total += actual;
    if (isBillable) {
      wkData.billed += actual;
    } else if (!isNoCustomer) {
      wkData.unbilled += actual;
    }
    
    if (actual > 0.5 && !isNoCustomer) {
      wkData.projects.add(project);
    }
  }

  // 2. Fallback to Tempo for CrewMembers or missing data (using existing aggregate function)
  const tempoRows = fhcReadTempoWithKeys_(windowKeys);
  const tempoMap = fhcAggregateTempo_(tempoRows);

  const justifiedMap = fhcGetJustifiedTimeOff_(windowKeys);
  const capMap = fhcReadCapacity_();

  // Group employees by category and calculate signals
  const categorySummary = {};
  const resources = [];

  Object.keys(EI_CONFIG.GROUPS).forEach(cat => {
    categorySummary[cat] = {
      name: cat,
      totalHC: 0,
      activeHC: 0,
      wowHC: 0,
      signals: { Top: 0, Normal: 0, Support: 0 },
      ptoHC: 0,
      projects: new Set(),
      levels: {}
    };
  });

  for (const [name, r] of roster) {
    let category = "Other";
    for (const [catName, families] of Object.entries(EI_CONFIG.GROUPS)) {
      if (families.includes(r.jobFamily)) {
        const titleFilter = EI_CONFIG.TITLE_FILTERS[catName];
        if (titleFilter && !(r.jobTitle || '').includes(titleFilter)) continue;
        category = catName;
        break;
      }
    }
    if (category === "Other") continue;

    // 2. Filter based on View Mode
    if (mode === "contributors") {
      if (EI_CONFIG.EXCLUDE_LEVELS.includes(r.level)) continue;
      if (r.profileType !== "IC" && r.profileType !== "Crew Member") continue;
    }

    const cat = categorySummary[category];
    cat.totalHC++;

    const empUtil = utilMap.get(name) || new Map();
    const uW0 = empUtil.get(w0Key) || { billed: 0, unbilled: 0, total: 0, projects: new Set() };
    const uW1 = empUtil.get(w1Key) || { billed: 0, unbilled: 0, total: 0, projects: new Set() };

    const tmW0 = (tempoMap.get(name) || new Map()).get(w0Key) || { tempoTotal: 0 };
    const tmW1 = (tempoMap.get(name) || new Map()).get(w1Key) || { tempoTotal: 0 };

    const billed = uW0.billed;
    const unbilled = uW0.unbilled;
    const total = Math.max(uW0.total, tmW0.tempoTotal);
    const active = total > 0.5;

    const totalW1 = Math.max(uW1.total, tmW1.tempoTotal);
    const activeW1 = totalW1 > 0.5;

    const justified = (justifiedMap.get(name) || new Map()).get(w0Key) || 0;
    const capacity = capMap.get(name) || 40;
    const gap = Math.max(0, capacity - total);
    const unjustified = Math.max(0, gap - justified);
    const tenure = fhcCalculateTenure_(r.hireDate);

    if (active) cat.activeHC++;
    if (active && !activeW1) cat.wowHC++;
    if (!active && activeW1) cat.wowHC--;

    // PTO status — scale signal thresholds by effective capacity
    const ptoRatio = justified / capacity;
    let ptoStatus = "";
    if (ptoRatio >= 0.8) ptoStatus = "On PTO";
    else if (justified >= 16) ptoStatus = "Partial PTO";
    if (ptoStatus) cat.ptoHC++;

    let signal = "Normal";
    const billRatio = total > 0 ? billed / total : 0;

    if (ptoRatio >= 0.8) {
      // Fully on PTO (≥80% capacity justified) — don't penalize
      if (total > 0 && billRatio >= EI_CONFIG.THRESHOLDS.TOP_BILLABLE_RATIO) signal = "Top";
    } else if (total > 0) {
      // Scale hour-based thresholds by effective working capacity
      const effectiveCap = Math.max(1, capacity - justified);
      const capScale = effectiveCap / capacity;

      if (billed >= EI_CONFIG.THRESHOLDS.TOP_BILLABLE_HOURS * capScale || billRatio >= EI_CONFIG.THRESHOLDS.TOP_BILLABLE_RATIO) {
        signal = "Top";
      } else if (unjustified >= 10 || total < EI_CONFIG.THRESHOLDS.SUPPORT_LOGGED_HOURS * capScale || billRatio < EI_CONFIG.THRESHOLDS.SUPPORT_BILLABLE_RATIO || unbilled >= EI_CONFIG.THRESHOLDS.SUPPORT_UNBILLED_HOURS) {
        signal = "Support";
      }
    } else {
      // No time logged — only flag if PTO doesn't cover most of the week
      if (ptoRatio < 0.6) {
        signal = "Support";
      }
    }
    cat.signals[signal]++;

    // Project counts - prioritize Utilization keys but merge with Tempo if missing
    const combinedProjects = new Set([...uW0.projects]);
    if (tmW0.tempoTotal > 0) {
      tempoRows.filter(tr => tr.employee === name && tr.weekKey === w0Key).forEach(tr => {
        if (tr.hours > 0.5) combinedProjects.add(tr.project);
      });
    }
    combinedProjects.forEach(p => cat.projects.add(p));

    resources.push({
      name,
      category,
      level: r.level,
      jobTitle: r.jobTitle,
      jobFamily: r.jobFamily,
      tenure,
      billed,
      unbilled,
      total,
      justified,
      unjustified,
      billRatio,
      signal,
      ptoStatus,
      active,
      projectCount: combinedProjects.size
    });
  }

  const summaries = Object.values(categorySummary).map(s => ({
    ...s,
    projectCount: s.projects.size
  }));

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    w0: w0Key,
    w1: w1Key,
    summaries,
    resources
  };
}

/**
 * Write the Employee Impact analysis to a spreadsheet sheet.
 */
function runEmployeeImpactAnalysis() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const data = eiGetEmployeeImpactData_();
  if (!data.available) return;

  const sh = resetSheet_(ss, EI_CONFIG.SHEET_NAME, 1000);
  let R = 1;

  // Title
  sh.getRange(R, 1).setValue("Employee Impact by Job Category").setFontWeight("bold").setFontSize(14);
  R += 2;

  // Summary Table
  sh.getRange(R, 1, 1, 8).setValues([["Category", "Total HC", "Contributors", "WoW HC Δ", "On PTO", "Top", "Normal", "Needs Support"]]).setFontWeight("bold");
  R++;
  data.summaries.forEach(s => {
    sh.getRange(R, 1, 1, 8).setValues([[
      s.name, s.totalHC, s.activeHC, s.wowHC, s.ptoHC, s.signals.Top, s.signals.Normal, s.signals.Support
    ]]);
    R++;
  });
  R += 2;

  // Resource Detail
  sh.getRange(R, 1, 1, 12).setValues([["Name", "Category", "Tenure", "Level", "Signal", "PTO Status", "Billed", "Unbilled", "Justified", "Unjustified", "Total", "Projects"]]).setFontWeight("bold");
  R++;
  data.resources.sort((a, b) => a.category.localeCompare(b.category) || b.total - a.total).forEach(res => {
    sh.getRange(R, 1, 1, 12).setValues([[
      res.name, res.category, res.tenure, res.level, res.signal, res.ptoStatus, res.billed, res.unbilled, res.justified, res.unjustified, res.total, res.projectCount
    ]]);
    R++;
  });
}
