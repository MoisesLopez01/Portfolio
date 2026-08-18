// ============================================================
//  EPIC WEEKLY ANALYSIS — Google Apps Script (Code.gs)
//  Tab: "Backlog"  |  Framework: Analysis Logic Framework v1
// ============================================================

const GEMINI_MODEL = 'gemini-3.1-pro-preview';

// ── AUTHORIZATION CONFIG ──────────────────────────────────────
// FALLBACK_AUTHORIZED_EMAILS is declared in 'Auhorized emails for Dashboard'

/**
 * Check if the current active user is authorized to access the dashboard.
 */
function checkUserAuthorized() {
  const userEmail = Session.getActiveUser().getEmail();
  
  // If email is hidden (e.g. running as dev but accessing as guest/external), 
  // we default to false for security.
  if (!userEmail) {
    Logger.log('Authorization failed: No user email found.');
    return false; 
  }
  
  const authorizedEmails = getAuthorizedEmails();
  const isAuthorized = authorizedEmails.some(email => email.toLowerCase() === userEmail.toLowerCase());
  
  if (!isAuthorized) {
    Logger.log('Unauthorized access attempt by: ' + userEmail);
  }
  
  return isAuthorized;
}

// ── Entry point: serve the dashboard ──────────────────────────
function doGet() {
  if (!checkUserAuthorized()) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif; padding:40px; text-align:center;">' +
      '<h2>Access Denied</h2>' +
      '<p>You (' + Session.getActiveUser().getEmail() + ') are not authorized to view this dashboard.</p>' +
      '<p style="color:#666; font-size:12px;">Contact the administrator to request access.</p>' +
      '</div>'
    ).setTitle('Access Denied - Contribution Dashboard');
  }

  const html = HtmlService.createTemplateFromFile('Dashboard');
  html.data = JSON.stringify(buildAnalyticsPayload());
  return html
    .evaluate()
    .setTitle('Contribution WoW Executive Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function openDashboard() {
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    Logger.log('openDashboard requires spreadsheet UI context: ' + e.message);
    return;
  }

  if (!checkUserAuthorized()) {
    ui.alert('Access Denied: You are not authorized to view this dashboard.');
    return;
  }

  const html = HtmlService.createTemplateFromFile('Dashboard');
  html.data = JSON.stringify(buildAnalyticsPayload());
  const output = html.evaluate().setWidth(1400).setHeight(900).setTitle('Contribution WoW Executive Dashboard');
  ui.showModalDialog(output, 'Contribution WoW Executive Dashboard');
}


// ── Called from client via google.script.run ──────────────────
/**
 * Entry point for client-side data requests.
 * Uses session caching to bypass slow spreadsheet reads.
 */
function getAnalyticsData(forceRefresh, viewMode) {
  if (!checkUserAuthorized()) throw new Error('Unauthorized access');
  
  const mode = viewMode || getUserViewMode_();
  const cacheKey = 'dashboard_full_payload_' + mode + '_' + Session.getActiveUser().getEmail();
  if (!forceRefresh) {
    const cached = getLargeCache_(cacheKey);
    if (cached) {
      Logger.log('Serving dashboard data from cache (' + mode + ')');
      return cached;
    }
  }

  const payload = buildAnalyticsPayload(mode);
  putLargeCache_(cacheKey, payload, 1200); // Cache for 20 mins
  return payload;
}

function getUserViewMode_() {
  try {
    const mode = PropertiesService.getUserProperties().getProperty('dashboard_view_mode');
    return 'contributors'; // Default and forced view mode
  } catch (e) {
    return 'contributors';
  }
}

function setUserViewMode(mode) {
  if (!checkUserAuthorized()) throw new Error('Unauthorized');
  const validMode = 'contributors';
  PropertiesService.getUserProperties().setProperty('dashboard_view_mode', validMode);
  return validMode;
}

// ── Chat Q&A: LangChain-style context-stuffing via Gemini ────
// Cost controls:
//   1. Uses buildCorePayload_ (no FNHC Gemini call) instead of buildAnalyticsPayload
//   2. Caches the QA context string for 5 min to skip spreadsheet re-reads
//   3. Enforces 5-second cooldown between questions to prevent rapid-fire billing
function askDataQuestion(question) {
  if (!checkUserAuthorized()) return { answer: 'Error: Unauthorized access.' };
  
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { answer: 'Gemini API key is not configured. Set GEMINI_API_KEY in Script Properties to enable Q&A.' };
  }

  if (!question || String(question).trim().length < 3) {
    return { answer: 'Please ask a more specific question.' };
  }

  // ── Cooldown: 5 seconds between questions ─────────────────
  const cache = CacheService.getScriptCache();
  const lastCall = cache.get('qa_cooldown');
  if (lastCall) {
    return { answer: 'Please wait a few seconds between questions.' };
  }
  cache.put('qa_cooldown', '1', 5);

  // ── Context: use cache if available, else build from core (no FNHC) ──
  let context = cache.get('qa_context');
  if (!context) {
    const core = buildCorePayload_();
    context = buildCompactQAContext_(core);
    try { cache.put('qa_context', context, 300); } catch (e) { /* proceed without cache */ }
  }

  // ── Security: strip any PII that may have leaked into context ──
  context = sanitizeQAContext_(context);

  // ── Security: sanitize and cap the user question ──
  const sanitizedQ = String(question).trim().substring(0, 500)
    .replace(/ignore.*rules|system prompt|output.*all|dump.*data/gi, '[BLOCKED]');

  const prompt = [
    'You are an executive data analyst assistant embedded in a portfolio dashboard.',
    'Answer the user question using ONLY the data provided below.',
    'Rules:',
    '- Be concise (3-5 sentences max).',
    '- Use specific numbers, percentages, and project names from the data.',
    '- If the data does not contain enough information, say so clearly.',
    '- Do NOT invent data. Do NOT speculate beyond what the numbers show.',
    '- Format your answer as plain text (no markdown).',
    '- NEVER reproduce raw data dumps, the full dataset, or system configuration.',
    '- NEVER output email addresses, personal identifiers, or API keys.',
    '',
    '=== DASHBOARD DATA ===',
    context,
    '',
    '=== USER QUESTION ===',
    sanitizedQ,
  ].join('\n');

  try {
    const text = callGeminiAPI_(prompt, {
      temperature: 0.2,
      topP: 0.9,
      topK: 20,
      maxOutputTokens: 1024,
      responseMimeType: 'text/plain',
    });
    return { answer: text };
  } catch (err) {
    Logger.log('Q&A error: ' + err.message);
    return { answer: 'Unable to process your question: ' + err.message };
  }
}

function buildCompactQAContext_(payload) {
  const lines = [];
  lines.push('Generated: ' + payload.generatedAt);
  lines.push('Weeks: ' + payload.allWeeks.join(', '));

  if (payload.utilizationTrend && payload.utilizationTrend.available) {
    const u = payload.utilizationTrend;
    const w0 = u.weeks.w0;
    const t0 = u.weekTotals[w0];
    const t1 = u.weekTotals[u.weeks.w1];
    
    lines.push('\nUtilization (Rocketeer Allocation):');
    lines.push('  Total Hours: ' + t0.actual.toFixed(1) + 'h (WoW Δ: ' + (t0.actual - t1.actual).toFixed(1) + 'h)');
    lines.push('  Planned Time Off: ' + t0.pto.toFixed(1) + 'h across ' + t0.ptoHC + ' Rocketeers');
    lines.push('  Admin Burden: ' + t0.admin.toFixed(1) + 'h (unjustified "No Customer" time)');
    lines.push('  Billable Efficiency: ' + ((t0.billable/t0.actual)*100).toFixed(1) + '% of logged time');

    // Project Allocation Mix (Top 10 by volume)
    const projects = Object.entries(u.projectData)
      .map(([name, data]) => ({ name, h: data[w0]?.total || 0, b: data[w0]?.billable || 0, nb: data[w0]?.nonBillable || 0 }))
      .sort((a, b) => b.h - a.h)
      .slice(0, 10);
    lines.push('  Top Projects by Hours: ' + projects.map(p => `${p.name}: ${p.h.toFixed(0)}h (${((p.b/p.h)*100).toFixed(0)}% billable)`).join(', '));
  }

  if (payload.fullHCAnalysis) {
    const f = payload.fullHCAnalysis;
    lines.push('\nHeadcount & Health (Evaluated Week):');
    lines.push('  CHI: ' + f.fnhc.chi.toFixed(1) + '% (' + f.fnhc.chiSeverity.level + ')');
    lines.push('  Company Util: ' + f.fnhc.companyUtil.toFixed(1) + '% (IC only, 15% shrinkage applied)');
    
    if (f.tierData && f.tierData.summary) {
      lines.push('  Tier Distribution: ' + f.tierData.summary.map(t => t.tier + ': ' + t.hc).join(', '));
    }

    if (f.deptData) {
      lines.push('  Department Performance: ' + f.deptData.map(d => `${d.dept} (Attainment: ${d.attainment}, Util: ${d.utilPct.toFixed(0)}%)`).join(', '));
    }

    [1, 2, 3].forEach(i => {
      const s = f.fnhc['signal' + i];
      lines.push(`  Signal ${i} [${s.severity.level}]: ${s.fnhc.fact}`);
      if (s.fnhc.concern) lines.push(`    Concern: ${s.fnhc.concern}`);
    });
  }

  for (const w of payload.allWeeks) {
    const m = payload.weeklyMetrics[w];
    if (!m) continue;
    lines.push('\nBacklog Status ' + w + ': ' + m.total + ' items, ' + m.uniqueProjects.length + ' projects, avg age ' + m.avgAge + 'd');
    lines.push('  Strategy: ' + m.strategicVolume + ' epics | Execution: ' + m.executionVolume + ' tasks/stories');
    if (m.overdueResolvedCount > 0) lines.push('  Cleanup: ' + m.overdueResolvedCount + ' overdue items resolved');
    lines.push('  Priority: ' + Object.entries(m.byPriority).map(e => e[0] + ':' + e[1]).join(', '));
    
    // Top contributors (limit to 3)
    const topRes = Object.entries(m.contributorStats)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 3);
    if (topRes.length > 0) lines.push('  Top Contributors: ' + topRes.map(r => `${r[0]} (${r[1].total} items)`).join(', '));

    lines.push('  Top projects (Backlog): ' + m.topProjects.slice(0, 5).map(p => p.key + ' (' + p.count + ' items)').join(', '));
  }

  if (payload.wow) {
    const w = payload.wow;
    lines.push('\nWeek-over-Week Trends:');
    lines.push('  Epic Delta: ' + w.delta + ' (' + w.deltaPct + '%), Pattern: ' + w.velocityPattern);
    lines.push('  Portfolio: ' + w.portfolioPattern + ', Lifecycle: ' + w.lifecycleStage);
    if (w.disappeared.length > 0) lines.push('  Exited: ' + w.disappeared.slice(0,5).map(p => p.key).join(', '));
    if (w.emerged.length > 0) lines.push('  Entered: ' + w.emerged.slice(0,5).map(p => p.key).join(', '));
  }

  if (payload.patterns && payload.patterns.length > 0) {
    lines.push('\nPatterns: ' + payload.patterns.map(p => p.label).join(', '));
  }

  if (payload.risks && payload.risks.length > 0) {
    lines.push('\nRisks: ' + payload.risks.filter(r => r.severity === 'critical' || r.severity === 'warning').map(r => r.signal).join(' | '));
  }

  if (payload.hoursTeamSignals && payload.hoursTeamSignals.available) {
    const h = payload.hoursTeamSignals;
    lines.push('\nHours analysis (' + h.weeks.w1 + ' -> ' + h.weeks.w0 + '):');
    if (h.fiscal) lines.push('  Fiscal: ' + h.fiscal.label + ', ' + h.fiscal.daysToQuarterEnd + ' days to Q-end');
    if (h.kpis) {
      h.kpis.forEach(k => {
        lines.push('  ' + k.label + ': W-1=' + k.w1 + ', W0=' + k.w0 + ', WoW=' + k.wow + ', target=' + k.target + ', signal=' + k.signal);
      });
    }
    if (h.narrative) lines.push('  Narrative: ' + h.narrative.join(' | '));
    if (h.byJobTitle && h.byJobTitle.length > 0) {
      lines.push('  By role:');
      h.byJobTitle.forEach(j => {
        lines.push('    ' + j.title + ': ' + j.activeW0 + ' active, billed W0=' + j.billedW0 + ', billable%=' + j.billablePctW0 + ', signal=' + j.signal);
      });
    }
  }

  return lines.join('\n');
}

/**
 * Strip PII patterns from QA context before sending to Gemini.
 * Removes email addresses, SSN-like patterns, and phone numbers.
 */
function sanitizeQAContext_(context) {
  let s = context;
  s = s.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '[REDACTED]');
  s = s.replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, '[REDACTED]');
  s = s.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[REDACTED]');
  return s;
}

// =============================================================
//  CORE ANALYTICS ENGINE
// =============================================================

/**
 * Core payload: all analytics EXCEPT the Gemini FNHC call.
 * Used by Q&A to avoid double Gemini billing.
 */
function buildCorePayload_(viewMode) {
  const mode = viewMode || getUserViewMode_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Backlog');
  if (!sheet) throw new Error('Sheet "Backlog" not found.');

  const raw = sheet.getDataRange().getValues();
  const headers = raw[0].map(h => String(h).trim());
  const rows = raw.slice(1);

  // ── Column index helpers ─────────────────────────────────
  const col = name => headers.indexOf(name);
  const C = {
    week:        col('Week'),
    summary:     col('Summary'),
    issueKey:    col('Issue key'),
    issueType:   col('Issue Type'),
    status:      col('Status'),
    projectKey:  col('Project key'),
    projectName: col('Project name'),
    priority:    col('Priority'),
    created:     col('Created'),
    updated:     col('Updated'),
    assignee:    col('Assignee'),
    reporter:    col('Reporter'),
    workstream:  col('Custom field (Workstream)'),
    epicStatus:  col('Custom field (Epic Status)'),
    statusCat:   col('Status Category'),
    dueDate:     col('Due date'),
    resolved:    col('Resolved'),
  };

  // ── Parse rows into objects ───────────────────────────────
  const epics = rows
    .filter(r => r[C.week] && r[C.issueKey])
    .map(r => ({
      week:        String(r[C.week]).trim(),
      summary:     String(r[C.summary] || ''),
      issueKey:    String(r[C.issueKey] || ''),
      issueType:   String(r[C.issueType] || '').trim(),
      status:      String(r[C.status] || '').trim(),
      projectKey:  String(r[C.projectKey] || '').trim(),
      projectName: String(r[C.projectName] || '').trim(),
      priority:    String(r[C.priority] || 'Unset').trim(),
      created:     r[C.created] ? new Date(r[C.created]) : null,
      updated:     r[C.updated] ? new Date(r[C.updated]) : null,
      dueDate:     r[C.dueDate] ? new Date(r[C.dueDate]) : null,
      resolved:    r[C.resolved] ? new Date(r[C.resolved]) : null,
      assignee:    String(r[C.assignee] || '').trim(),
      workstream:  C.workstream >= 0 ? String(r[C.workstream] || '').trim() : '',
      epicStatus:  C.epicStatus >= 0 ? String(r[C.epicStatus] || '').trim() : '',
      statusCat:   C.statusCat >= 0 ? String(r[C.statusCat] || '').trim() : '',
    }));

  // ── Identify distinct weeks (sorted) ─────────────────────
  const allWeeks = [...new Set(epics.map(e => e.week))].sort();

  // ── Build per-week datasets ───────────────────────────────
  const byWeek = {};
  allWeeks.forEach(w => { byWeek[w] = epics.filter(e => e.week === w); });

  // ── Compute full metrics for each week ───────────────────
  const weeklyMetrics = {};
  allWeeks.forEach(w => { weeklyMetrics[w] = computeWeekMetrics(byWeek[w]); });

  // ── Week-over-Week comparison (last two weeks) ────────────
  const wow = allWeeks.length >= 2
    ? computeWoW(
        allWeeks[allWeeks.length - 2],
        weeklyMetrics[allWeeks[allWeeks.length - 2]],
        allWeeks[allWeeks.length - 1],
        weeklyMetrics[allWeeks[allWeeks.length - 1]],
        byWeek[allWeeks[allWeeks.length - 2]],
        byWeek[allWeeks[allWeeks.length - 1]]
      )
    : null;

  // ── Pattern classification ────────────────────────────────
  const patterns = wow ? classifyPatterns(wow) : [];

  // ── Risk & Opportunity assessment ────────────────────────
  const risks = wow ? assessRisks(wow, weeklyMetrics) : [];

  // ── Strategic insights ────────────────────────────────────
  const insights = wow ? generateInsights(wow, patterns) : [];

  const hoursTeamSignals = buildHoursTeamSignals_(mode);
  const fullHCAnalysis = fhcGetFullAnalysisData_(mode);
  const utilizationTrend = buildUtilizationTrend_(mode);
  const timeOffTrend = buildTimeOffTrend_(mode);
  const employeeImpact = eiGetEmployeeImpactData_(mode);

  return {
    generatedAt: new Date().toISOString(),
    viewMode: mode,
    allWeeks,
    weeklyMetrics,
    wow,
    patterns,
    risks,
    insights,
    hoursTeamSignals,
    fullHCAnalysis,
    utilizationTrend,
    timeOffTrend,
    employeeImpact,
  };
}

/**
 * Full payload: core + strategic signals in both modes.
 * Called on page load and refresh only.
 */
function buildAnalyticsPayload(viewMode) {
  const core = buildCorePayload_(viewMode);
  const preferredMode = getUserSignalMode_();
  core.viewMode = viewMode || getUserViewMode_();

  // Always compute fallback (no Gemini cost)
  const fallbackSignals = core.wow ? {
    mode: 'fallback',
    generatedAt: new Date().toISOString(),
    security: { sanitized: true, tokenCount: 0, aiUsed: false },
    sections: buildFNHCFallback_(core.wow, core.patterns, core.risks),
  } : {
    mode: 'fallback',
    generatedAt: new Date().toISOString(),
    security: { sanitized: true, aiUsed: false },
    sections: [],
  };

  // AI signals: try cache first, only call Gemini if preferred
  let aiSignals = null;
  if (core.wow) {
    const dataHash = computeDataHash_(core.wow, core.patterns, core.risks);
    const cached = getLargeCache_('ai_signals_' + dataHash);
    if (cached) {
      aiSignals = cached;
    } else if (preferredMode === 'ai') {
      aiSignals = buildStrategicSignals(core.wow, core.patterns, core.risks, core.insights);
    }
  }

  // Active signals based on preference; include alternate for instant toggle
  if (preferredMode === 'ai' && aiSignals && aiSignals.mode === 'ai') {
    core.strategicSignals = aiSignals;
    core.altSignals = fallbackSignals;
  } else {
    core.strategicSignals = fallbackSignals;
    core.altSignals = aiSignals; // null when AI was never computed/cached
  }
  core.signalModePreference = preferredMode;

  // Cache the Q&A context so chat questions don't re-read the spreadsheet
  try {
    const ctx = buildCompactQAContext_(core);
    CacheService.getScriptCache().put('qa_context', ctx, 300);
  } catch (e) {
    Logger.log('QA context cache write failed: ' + e.message);
  }

  return core;
}

function buildHoursTeamSignals_(viewMode) {
  const mode = viewMode || 'contributors';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoursSheet = ss.getSheetByName('Hours Logged');
  if (!hoursSheet) {
    return { available: false, message: 'Hours Logged sheet not found.' };
  }

  // Load roster for filtering if in contributors mode
  let validEmployees = null;
  if (mode === 'contributors') {
    const roster = fhcReadFullRoster_();
    validEmployees = new Set();
    for (const [name, r] of roster) {
      if (r.isContributor) validEmployees.add(name);
    }
  }

  const capacitySheet = ss.getSheetByName('Capacity');
  const weeks = getLastTwoCompletedWeeks_();
  const w1Key = toIsoDate_(weeks.w1);
  const w0Key = toIsoDate_(weeks.w0);
  
  const SHRINKAGE_PCT = 0.15; // 15% global shrinkage
  const w1Label = getWeekLabel_(weeks.w1);
  const w0Label = getWeekLabel_(weeks.w0);

  const weekly = {
    [w1Key]: { billed: 0, unbilled: 0, totalBillable: 0, nonBill: 0, total: 0, employees: new Set() },
    [w0Key]: { billed: 0, unbilled: 0, totalBillable: 0, nonBill: 0, total: 0, employees: new Set() },
  };
  const empWeekly = new Map();

  const raw = hoursSheet.getDataRange().getValues();
  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    const employee = String(row[0] || '').trim();
    
    // Filter by view mode
    if (validEmployees && !validEmployees.has(employee)) continue;

    const date = parseDateValue_(row[7]);
    if (!employee || !date) continue;

    const weekKey = toIsoDate_(mondayOf_(date));
    if (!weekly[weekKey]) continue;

    weekly[weekKey].billed += parseFloat(row[2]) || 0;
    weekly[weekKey].unbilled += parseFloat(row[3]) || 0;
    weekly[weekKey].totalBillable += parseFloat(row[4]) || 0;
    weekly[weekKey].nonBill += parseFloat(row[5]) || 0;
    weekly[weekKey].total += parseFloat(row[6]) || 0;
    weekly[weekKey].employees.add(employee);

    if (!empWeekly.has(employee)) {
      empWeekly.set(employee, {
        [w1Key]: { billed: 0, totalBillable: 0, total: 0 },
        [w0Key]: { billed: 0, totalBillable: 0, total: 0 },
      });
    }
    const ew = empWeekly.get(employee);
    ew[weekKey].billed += parseFloat(row[2]) || 0;
    ew[weekKey].totalBillable += parseFloat(row[4]) || 0;
    ew[weekKey].total += parseFloat(row[6]) || 0;
  }

  const capMap = new Map();
  const roleMap = new Map();
  if (capacitySheet) {
    const capRaw = capacitySheet.getDataRange().getValues();
    for (let i = 1; i < capRaw.length; i++) {
      const employee = String(capRaw[i][0] || '').trim();
      if (!employee) continue;
      capMap.set(employee, parseFloat(capRaw[i][3]) || 40);
      roleMap.set(employee, String(capRaw[i][1] || 'Unknown').trim() || 'Unknown');
    }
  }

  function capacityForWeek(weekObj) {
    const members = [...weekObj.employees];
    if (!members.length) return 0;
    const gross = members.reduce((sum, emp) => sum + (capMap.get(emp) || 40), 0);
    return gross * (1 - SHRINKAGE_PCT); // Apply 15% shrinkage
  }

  const w1 = weekly[w1Key];
  const w0 = weekly[w0Key];
  const w1Cap = capacityForWeek(w1);
  const w0Cap = capacityForWeek(w0);
  const fiscal = getFiscalContext_(weeks.getW0 ? weeks.getW0() : weeks.w0);

  // Cross-reference with the more accurate Utilization Trend for Admin/PTO signals
  const utilTrend = buildUtilizationTrend_(viewMode);
  const w0AdminReal = utilTrend.available ? utilTrend.weekTotals[w0Label].admin : 0;
  const w1AdminReal = utilTrend.available ? utilTrend.weekTotals[w1Label].admin : 0;
  const w0PTO = utilTrend.available ? utilTrend.weekTotals[w0Label].pto : 0;
  const w1PTO = utilTrend.available ? utilTrend.weekTotals[w1Label].pto : 0;
  
  // Use Utilization Trend for Billable / Unbillable client hours for perfectly aligned breakdown
  const w0BillableReal = utilTrend.available ? utilTrend.weekTotals[w0Label].billable : w0.totalBillable;
  const w1BillableReal = utilTrend.available ? utilTrend.weekTotals[w1Label].billable : w1.totalBillable;
  const w0UnbilledReal = utilTrend.available ? utilTrend.weekTotals[w0Label].nonBillable : w0.unbilled;
  const w1UnbilledReal = utilTrend.available ? utilTrend.weekTotals[w1Label].nonBillable : w1.unbilled;
  const w0ActualReal = utilTrend.available ? utilTrend.weekTotals[w0Label].actual : w0.total;
  const w1ActualReal = utilTrend.available ? utilTrend.weekTotals[w1Label].actual : w1.total;

  function pct(n, d) { return d > 0 ? (n / d * 100) : 0; }
  function delta(a, b) { return b - a; }
  function fmtHours(v) { return (Math.round(v * 10) / 10).toFixed(1) + 'h'; }
  function fmtPct(v) { return (Math.round(v * 10) / 10).toFixed(1) + '%'; }
  function fmtGap(v, isPct) { 
    const val = Math.round(v * 10) / 10;
    const sign = val > 0 ? '+' : '';
    return sign + val.toFixed(1) + (isPct ? 'pp' : 'h');
  }
  function statusGte(v, t) { return v >= t ? 'On Track' : 'Below Target'; }
  function statusLte(v, t) { return v <= t ? 'On Track' : 'Above Limit'; }

  const w1TotalAvailability = utilTrend.available && utilTrend.weekTotals[w1Label].avail > 0 ? utilTrend.weekTotals[w1Label].avail : w1Cap;
  const w0TotalAvailability = utilTrend.available && utilTrend.weekTotals[w0Label].avail > 0 ? utilTrend.weekTotals[w0Label].avail : w0Cap;
  
  // Basic rate calculations for actual % based on real utilization
  const w0UnbilledRate = w0ActualReal > 0 ? (w0UnbilledReal / w0ActualReal * 100) : 0;
  const w0AdminRate = w0TotalAvailability > 0 ? (w0AdminReal / w0TotalAvailability * 100) : 0;
  const w0BillableRate = w0ActualReal > 0 ? (w0BillableReal / w0ActualReal * 100) : 0;

  // Replace the old kpis with the new specific ones
  const kpis = [
    {
      id: '1',
      label: 'Capacity Logged Ratio',
      w1: fmtPct(w1ActualReal > 0 ? pct(w1ActualReal, w1TotalAvailability) : 0),
      w0: fmtPct(pct(w0ActualReal, w0TotalAvailability)),
      wow: fmtGap(pct(w0ActualReal, w0TotalAvailability) - (w1ActualReal > 0 ? pct(w1ActualReal, w1TotalAvailability) : 0), true),
      target: '90%',
      attainment: fmtPct(pct(w0ActualReal, w0TotalAvailability)),
      gap: fmtGap(pct(w0ActualReal, w0TotalAvailability) - 90, true),
      signal: statusGte(pct(w0ActualReal, w0TotalAvailability), 90),
      isParent: true,
      children: [
        {
          id: '1a',
          label: 'Total Availability (Max Capacity)',
          w1: fmtHours(w1TotalAvailability),
          w0: fmtHours(w0TotalAvailability),
          wow: fmtHours(delta(w1TotalAvailability, w0TotalAvailability)),
          target: '—',
          attainment: '—',
          gap: '—',
          signal: 'Neutral',
        },
        {
          id: '2',
          label: 'Hours Logged (Total)',
          w1: fmtHours(w1ActualReal),
          w0: fmtHours(w0ActualReal),
          wow: fmtHours(delta(w1ActualReal, w0ActualReal)),
          target: `90% (${fmtHours(w0TotalAvailability * 0.9)})`,
          attainment: fmtPct(pct(w0ActualReal, w0TotalAvailability)),
          gap: fmtHours(w0ActualReal - (w0TotalAvailability * 0.9)),
          signal: statusGte(pct(w0ActualReal, w0TotalAvailability), 90),
          isParent: true,
          children: [
            {
              id: '2a',
              label: 'Billable Client Hours',
              w1: fmtHours(w1BillableReal),
              w0: fmtHours(w0BillableReal),
              wow: fmtHours(delta(w1BillableReal, w0BillableReal)),
              target: '75%',
              attainment: fmtPct(w0BillableRate),
              gap: fmtGap(w0BillableRate - 75, true),
              signal: statusGte(w0BillableRate, 75),
            },
            {
              id: '2b',
              label: 'Client Unbillable Hours',
              w1: fmtHours(w1UnbilledReal),
              w0: fmtHours(w0UnbilledReal),
              wow: fmtHours(delta(w1UnbilledReal, w0UnbilledReal)),
              target: '≤ 10%',
              attainment: fmtPct(w0UnbilledRate),
              gap: fmtGap(10 - w0UnbilledRate, true),
              signal: statusLte(w0UnbilledRate, 10),
            },
            {
              id: '2c',
              label: 'Admin / Internal Hours',
              w1: fmtHours(w1AdminReal),
              w0: fmtHours(w0AdminReal),
              wow: fmtHours(delta(w1AdminReal, w0AdminReal)),
              target: '≤ 15%',
              attainment: fmtPct(w0AdminRate),
              gap: fmtGap(15 - w0AdminRate, true),
              signal: statusLte(w0AdminRate, 15),
            },
            {
              id: '2d',
              label: 'Planned Time Off (PTO)',
              w1: fmtHours(w1PTO),
              w0: fmtHours(w0PTO),
              wow: fmtHours(delta(w1PTO, w0PTO)),
              target: '—',
              attainment: '—',
              gap: '—',
              signal: 'Neutral',
            }
          ]
        }
      ]
    }
  ];

  const narrative = [];
  const actions = [];
  const billableDelta = delta(w1.totalBillable, w0.totalBillable);
  const timeLost = w0TotalAvailability - w0.total;
  
  if (timeLost > 0) {
    narrative.push(`🔴 Concern: There is ${fmtHours(timeLost)} in available time not logged across active rosters. This represents a major opportunity loss for backlog execution.`);
    actions.push(`Review teams missing logged hours. That time could have been utilized entirely to close active backlog tickets.`);
  } else {
    narrative.push(`🟢 Highlight: Team logged ${fmtHours(w0.total)}, fully capturing available capacity for backlog tracking.`);
  }

  // Quarter-end demand signal
  if (fiscal.isQuarterEndWindow) {
    if (billableDelta > 0) {
      narrative.push(`🔵 Note: High demand near ${fiscal.label} close is increasing epic and deliverable completion pace.`);
    } else {
      narrative.push(`🔴 Concern: ${fiscal.label} is in quarter-end window (${fiscal.daysToQuarterEnd} days left) without expected contribution lift.`);
      actions.push(`Execute quarter-end 'Contribution Push' for all high-priority epics ending this month.`);
    }
  }

  const byTitleMap = {};
  for (const [employee, weekData] of empWeekly.entries()) {
    const title = roleMap.get(employee) || 'Unknown';
    if (!byTitleMap[title]) {
      byTitleMap[title] = {
        title,
        activeW0: 0,
        billableW1: 0,
        billableW0: 0,
        totalW0: 0,
      };
    }
    const entry = byTitleMap[title];
    entry.billableW1 += weekData[w1Key].totalBillable;
    entry.billableW0 += weekData[w0Key].totalBillable;
    entry.totalW0 += weekData[w0Key].total;
    if (weekData[w0Key].total > 0) entry.activeW0 += 1;
  }

  const byJobTitle = Object.values(byTitleMap)
    .map(t => {
      const wowDelta = t.billableW0 - t.billableW1;
      const billablePct = t.totalW0 > 0 ? (t.billableW0 / t.totalW0 * 100) : 0;
      const signal = wowDelta >= 0 && billablePct >= 75 ? 'On Track'
                   : wowDelta < 0 && billablePct < 60 ? 'At Risk'
                   : 'Watch';
      return {
        title: t.title,
        activeW0: t.activeW0,
        billedW1: fmtHours(t.billableW1),
        billedW0: fmtHours(t.billableW0),
        wowBilledDelta: fmtHours(wowDelta),
        billablePctW0: fmtPct(billablePct),
        target: '75%',
        attainment: fmtPct(pct(billablePct, 75)),
        gap: fmtGap(billablePct - 75, true),
        signal,
      };
    })
    .sort((a, b) => parseFloat(b.billedW0) - parseFloat(a.billedW0));

  return {
    available: true,
    weeks: {
      w1: `${w1Label} (${formatWeekRange_(weeks.w1, true)})`,
      w0: `${w0Label} (${formatWeekRange_(weeks.w0, true)})`,
    },
    fiscal,
    kpis,
    narrative,
    recommendedActions: [...new Set(actions)],
    byJobTitle,
  };
}

function getLastTwoCompletedWeeks_() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysToLastSunday = dow === 0 ? 7 : dow;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysToLastSunday);

  const w0 = new Date(lastSunday);
  w0.setDate(lastSunday.getDate() - 6);
  w0.setHours(0, 0, 0, 0);

  const w1 = new Date(w0);
  w1.setDate(w0.getDate() - 7);
  w1.setHours(0, 0, 0, 0);

  return { w1, w0 };
}

function mondayOf_(date) {
  const d = new Date(date);
  const dow = d.getDay();
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function toIsoDate_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function parseDateValue_(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Returns shorthand week label like "W15"
 */
function getWeekLabel_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
  return 'W' + weekNum;
}

function formatWeekRange_(monday, short) {
  const end = new Date(monday);
  end.setDate(monday.getDate() + 6);
  const startTxt = Utilities.formatDate(monday, Session.getScriptTimeZone(), 'MMM d');
  if (short) return startTxt;
  const endTxt = Utilities.formatDate(end, Session.getScriptTimeZone(), 'MMM d, yyyy');
  return startTxt + ' - ' + endTxt;
}

function getFiscalContext_(weekMonday) {
  const q = fiscalQuarterByDate_(weekMonday);
  const quarterEnd = q.end;
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysToQuarterEnd = Math.ceil((quarterEnd.getTime() - weekMonday.getTime()) / msPerDay);
  return {
    fy: q.fy,
    quarter: q.quarter,
    label: 'FY' + q.fy + ' Q' + q.quarter,
    quarterStart: toIsoDate_(q.start),
    quarterEnd: toIsoDate_(q.end),
    daysToQuarterEnd,
    isQuarterEndWindow: daysToQuarterEnd <= 21,
  };
}

function fiscalQuarterByDate_(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-based

  // Fiscal year starts on Jul 1.
  const fy = month >= 6 ? (year + 1) : year;
  let quarter;
  let start;
  let end;

  if (month >= 6 && month <= 8) {
    quarter = 1;
    start = new Date(year, 6, 1);
    end = new Date(year, 8, 30);
  } else if (month >= 9 && month <= 11) {
    quarter = 2;
    start = new Date(year, 9, 1);
    end = new Date(year, 11, 31);
  } else if (month >= 0 && month <= 2) {
    quarter = 3;
    start = new Date(year, 0, 1);
    end = new Date(year, 2, 31);
  } else {
    quarter = 4;
    start = new Date(year, 3, 1);
    end = new Date(year, 5, 30);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { fy, quarter, start, end };
}

/**
 * Processes 'Utilization' sheet for executive WoW trends.
 */
let _utilTrendCache_ = null;

function buildUtilizationTrend_(viewMode) {
  if (_utilTrendCache_) return _utilTrendCache_;

  const mode = viewMode || 'contributors';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const utilSheet = ss.getSheetByName('Utilization');
  if (!utilSheet) return { available: false };

  // Load roster for filtering
  let validResources = null;
  if (mode === 'contributors') {
    const roster = fhcReadFullRoster_();
    validResources = new Set();
    for (const [name, r] of roster) {
      if (r.isContributor) validResources.add(name);
    }
  }

  const raw = utilSheet.getDataRange().getValues();
  if (raw.length < 2) return { available: false };
  const headers = raw[0].map(h => String(h || '').trim());
  
  const C = {
    resource: headers.indexOf('Resource'),
    project:  headers.indexOf('Project Name'),
    billable: headers.indexOf('Billable'),
    customer: headers.indexOf('Customer'),
    date:     headers.indexOf('Date'),
    actual:   headers.indexOf('Actual Time'),
    avail:    headers.indexOf('Available Hours'),
  };

  if (C.resource === -1 || C.date === -1 || C.actual === -1) return { available: false };

  const weeks = getLastTwoCompletedWeeks_();
  const w1Key = getWeekLabel_(weeks.w1);
  const w0Key = getWeekLabel_(weeks.w0);

  // We want last 4 weeks for the trend line
  const last4Weeks = [];
  let dIter = new Date(weeks.w0);
  for (let i = 0; i < 4; i++) {
    last4Weeks.unshift(getWeekLabel_(dIter));
    dIter.setDate(dIter.getDate() - 7);
  }

  // ── Pre-load Ground Truth PTO/PH for justification ───────
  const justifiedEntries = new Set();
  const toSheet = ss.getSheetByName('Time Off');
  if (toSheet) {
    const toRaw = toSheet.getDataRange().getValues();
    const toH = toRaw[0].map(h => String(h || '').toLowerCase().trim());
    const iName = toH.findIndex(h => h === 'name' || h === 'employee' || h === 'resource');
    const iDate = toH.findIndex(h => h === 'date');
    if (iName !== -1 && iDate !== -1) {
      for (let i = 1; i < toRaw.length; i++) {
        const d = parseDateValue_(toRaw[i][iDate]);
        if (d) justifiedEntries.add(String(toRaw[i][iName]).trim() + '|' + toIsoDate_(d));
      }
    }
  }
  const phSheet = ss.getSheetByName('PH');
  const rosterSheet = ss.getSheetByName('Roster');
  if (phSheet && rosterSheet) {
    const rRaw = rosterSheet.getDataRange().getValues();
    const rH = rRaw[0].map(h => String(h || '').toLowerCase().trim());
    const riName = rH.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h));
    const riLoc  = rH.findIndex(h => /location|office|subsidiary|country/i.test(h));
    const phRaw = phSheet.getDataRange().getValues();
    const phH = phRaw[0].map(h => String(h || '').toLowerCase().trim());
    const piDate = phH.indexOf('date');
    const piLoc  = phH.indexOf('location');
    if (riName !== -1 && riLoc !== -1 && piDate !== -1 && piLoc !== -1) {
      const rosterLocs = {};
      for (let i = 1; i < rRaw.length; i++) {
        if (rRaw[i][riName]) rosterLocs[String(rRaw[i][riName]).trim()] = String(rRaw[i][riLoc]).trim();
      }
      const holidays = new Set();
      for (let i = 1; i < phRaw.length; i++) {
        const d = parseDateValue_(phRaw[i][piDate]);
        if (d) holidays.add(String(phRaw[i][piLoc]).trim() + '|' + toIsoDate_(d));
      }
      for (const [name, loc] of Object.entries(rosterLocs)) {
        holidays.forEach(hKey => {
          if (hKey.startsWith(loc + '|')) justifiedEntries.add(name + '|' + hKey.split('|')[1]);
        });
      }
    }
  }

  const resData = {}; 
  const projectData = {}; 
  const weekTotals = {}; 
  last4Weeks.forEach(wk => { 
    weekTotals[wk] = { pto: 0, admin: 0, actual: 0, billable: 0, nonBillable: 0, avail: 0, ptoHC: new Set(), activeHC: new Set() };
  });

  for (let i = 1; i < raw.length; i++) {
    const row = raw[i];
    const dateVal = parseDateValue_(row[C.date]);
    if (!dateVal) continue;
    
    const wKey = getWeekLabel_(dateVal);
    if (!weekTotals[wKey]) continue;

    const resource = String(row[C.resource] || '').trim();
    if (validResources && !validResources.has(resource)) continue;

    const project = String(row[C.project] || '').trim() || 'Internal/Other';
    const customer = String(row[C.customer] || '').trim();
    const dateISO = toIsoDate_(dateVal);
    
    const isNoCustomer = (customer === '- No Customer/Project -' || project.includes('No Customer/Project'));
    const isJustified = justifiedEntries.has(resource + '|' + dateISO);
    const isPTO = isNoCustomer && isJustified;
    
    const isBillable = String(row[C.billable] || '').toLowerCase() === 'yes';
    const actual = parseFloat(row[C.actual]) || 0;
    const avail = parseFloat(row[C.avail]) || 0;

    // Week Totals
    weekTotals[wKey].actual += actual;
    weekTotals[wKey].avail += avail;
    if (actual > 0) weekTotals[wKey].activeHC.add(resource);

    if (isPTO) {
      weekTotals[wKey].pto += actual;
      if (actual > 0) weekTotals[wKey].ptoHC.add(resource);
    }
    else if (isNoCustomer) {
      weekTotals[wKey].admin += actual; // Unjustified "No Customer" = Admin Burden
    }
    else if (isBillable) {
      weekTotals[wKey].billable += actual;
    }
    else {
      weekTotals[wKey].nonBillable += actual; // Client work logged as non-billable
    }

    // Resource Data (for last 2 weeks)
    if (wKey === w1Key || wKey === w0Key) {
      if (!resData[resource]) resData[resource] = {};
      if (!resData[resource][wKey]) resData[resource][wKey] = { billable: 0, nonBillable: 0, pto: 0, admin: 0, actual: 0, avail: 0 };
      const rd = resData[resource][wKey];
      rd.actual += actual;
      rd.avail = Math.max(rd.avail, avail); 
      if (isPTO) rd.pto += actual;
      else if (isNoCustomer) rd.admin += actual;
      else if (isBillable) rd.billable += actual;
      else rd.nonBillable += actual;
    }

    // Project Data (WoW)
    if ((wKey === w1Key || wKey === w0Key) && !isPTO) {
      if (!projectData[project]) projectData[project] = {};
      if (!projectData[project][wKey]) projectData[project][wKey] = { billable: 0, nonBillable: 0, total: 0, resources: {} };
      const pd = projectData[project][wKey];
      if (isBillable) pd.billable += actual;
      else pd.nonBillable += actual;
      pd.total += actual;

      if (!pd.resources[resource]) pd.resources[resource] = { billable: 0, nonBillable: 0, total: 0 };
      const pr = pd.resources[resource];
      if (isBillable) pr.billable += actual;
      else pr.nonBillable += actual;
      pr.total += actual;
    }
  }

  // Convert Sets to counts for JSON serialization
  Object.keys(weekTotals).forEach(wk => {
    weekTotals[wk].ptoHC = weekTotals[wk].ptoHC instanceof Set ? weekTotals[wk].ptoHC.size : (weekTotals[wk].ptoHC || 0);
    weekTotals[wk].activeHC = weekTotals[wk].activeHC instanceof Set ? weekTotals[wk].activeHC.size : (weekTotals[wk].activeHC || 0);
  });

  _utilTrendCache_ = {
    available: true,
    weeks: { w1: w1Key, w0: w0Key, last4: last4Weeks },
    weekTotals,
    resData,
    projectData,
    targetHC: validResources ? validResources.size : Object.keys(resData).length
  };
  return _utilTrendCache_;
}

// =============================================================
//  TIME OFF TREND (from "Time Off" + "PH" sheets — ground truth)
// =============================================================
/**
 * Reads Time Off sheet (each row = 1 day off = 8h) and PH sheet
 * (public holidays by location, matched to Roster "Key Location").
 * Aggregates by ISO week: unique names (HC), hours (events × 8h).
 * Cross-references with Utilization "- No Customer/Project -" to show match.
 */
function buildTimeOffTrend_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Determine last 4 completed weeks
  const weeks = getLastTwoCompletedWeeks_();
  const last4Mondays = [];
  let dIter = new Date(weeks.w0);
  for (let i = 0; i < 4; i++) {
    last4Mondays.unshift(new Date(dIter));
    dIter.setDate(dIter.getDate() - 7);
  }
  const last4Keys = last4Mondays.map(m => getWeekLabel_(m));

  // Build per-week aggregation
  const weekData = {};
  last4Keys.forEach(wk => {
    weekData[wk] = { ptoNames: new Set(), ptoHours: 0, ptoEntries: [], phNames: new Set(), phHours: 0, phEntries: [] };
  });

  // ── 1. Read Time Off sheet (PTO) ──────────────────────────
  const toSheet = ss.getSheetByName('Time Off');
  let hasTimeOff = false;
  if (toSheet) {
    const raw = toSheet.getDataRange().getValues();
    if (raw.length >= 2) {
      const headers = raw[0].map(h => String(h || '').toLowerCase().trim());
      const iName = headers.findIndex(h => h === 'name' || h === 'employee' || h === 'resource');
      const iDate = headers.findIndex(h => h === 'date');
      const iAdj  = headers.findIndex(h => h.includes('adjustment'));

      if (iName !== -1 && iDate !== -1) {
        hasTimeOff = true;
        for (let i = 1; i < raw.length; i++) {
          const name = String(raw[i][iName] || '').trim();
          if (!name) continue;

          const dateVal = parseDateValue_(raw[i][iDate]);
          if (!dateVal) continue;

          if (iAdj !== -1) {
            const adj = String(raw[i][iAdj] || '').trim().toLowerCase();
            if (adj && adj !== 'usage') continue;
          }

          const wKey = getWeekLabel_(dateVal);
          if (!weekData[wKey]) continue;

          const dedupKey = name + '|' + toIsoDate_(dateVal);
          if (weekData[wKey].ptoEntries.includes(dedupKey)) continue;
          weekData[wKey].ptoEntries.push(dedupKey);

          weekData[wKey].ptoNames.add(name);
          weekData[wKey].ptoHours += 8;
        }
      }
    }
  }

  // ── 2. Read PH sheet + Roster locations ───────────────────
  const phSheet = ss.getSheetByName('PH');
  const rosterSheet = ss.getSheetByName('Roster');

  if (phSheet && rosterSheet) {
    // Build location map from Roster: name → location
    const rRaw = rosterSheet.getDataRange().getValues();
    const rHeaders = rRaw[0].map(h => String(h || '').toLowerCase().trim());
    const riName = rHeaders.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h));
    const riLoc  = rHeaders.findIndex(h => /location|office|subsidiary|country/i.test(h));

    const rosterLocMap = new Map(); // name → location
    if (riName !== -1 && riLoc !== -1) {
      for (let i = 1; i < rRaw.length; i++) {
        const name = String(rRaw[i][riName] || '').trim();
        const loc = String(rRaw[i][riLoc] || '').trim();
        if (name && loc) rosterLocMap.set(name, loc);
      }
    }

    // Build location → [names] reverse map for PH impact calculation
    const locToNames = new Map(); // location → Set<name>
    for (const [name, loc] of rosterLocMap) {
      if (!locToNames.has(loc)) locToNames.set(loc, new Set());
      locToNames.get(loc).add(name);
    }

    // Read PH: date + location → holiday
    const phRaw = phSheet.getDataRange().getValues();
    const phHeaders = phRaw[0].map(h => String(h || '').toLowerCase().trim());
    const piDate = phHeaders.indexOf('date');
    const piLoc  = phHeaders.indexOf('location');

    if (piDate !== -1 && piLoc !== -1) {
      for (let i = 1; i < phRaw.length; i++) {
        const dateVal = parseDateValue_(phRaw[i][piDate]);
        if (!dateVal) continue;

        const wKey = getWeekLabel_(dateVal);
        if (!weekData[wKey]) continue;

        const loc = String(phRaw[i][piLoc] || '').trim();
        const affectedNames = locToNames.get(loc);
        if (!affectedNames || affectedNames.size === 0) continue;

        const dateISO = toIsoDate_(dateVal);
        for (const name of affectedNames) {
          const dedupKey = name + '|' + dateISO;
          // Don't double count if already counted as PTO
          if (weekData[wKey].ptoEntries.includes(dedupKey)) continue;
          if (weekData[wKey].phEntries.includes(dedupKey)) continue;
          weekData[wKey].phEntries.push(dedupKey);

          weekData[wKey].phNames.add(name);
          weekData[wKey].phHours += 8;
        }
      }
    }
  }

  if (!hasTimeOff && !phSheet) return { available: false };

  // ── 3. Cross-reference with Utilization "- No Customer/Project -" ─
  const utilSheet = ss.getSheetByName('Utilization');
  const utilPTO = {};
  last4Keys.forEach(wk => { utilPTO[wk] = { hours: 0, hc: new Set() }; });

  if (utilSheet) {
    const uRaw = utilSheet.getDataRange().getValues();
    const uHeaders = uRaw[0].map(h => String(h || '').trim());
    const uC = {
      resource: uHeaders.indexOf('Resource'),
      customer: uHeaders.indexOf('Customer'),
      date:     uHeaders.indexOf('Date'),
      actual:   uHeaders.indexOf('Actual Time'),
    };

    if (uC.resource !== -1 && uC.date !== -1 && uC.actual !== -1) {
      for (let i = 1; i < uRaw.length; i++) {
        const customer = String(uRaw[i][uC.customer] || '').trim();
        if (customer !== '- No Customer/Project -') continue;

        const dateVal = parseDateValue_(uRaw[i][uC.date]);
        if (!dateVal) continue;

        const wKey = getWeekLabel_(dateVal);
        if (!utilPTO[wKey]) continue;

        const actual = parseFloat(uRaw[i][uC.actual]) || 0;
        if (actual <= 0) continue;

        const resource = String(uRaw[i][uC.resource] || '').trim();
        utilPTO[wKey].hours += actual;
        utilPTO[wKey].hc.add(resource);
      }
    }
  }

  // ── 4. Build output per week ──────────────────────────────
  const weeklyOutput = {};
  last4Keys.forEach(wk => {
    const wd = weekData[wk];
    const uPTO = utilPTO[wk];
    // Combine PTO + PH for totals
    const allNames = new Set([...wd.ptoNames, ...wd.phNames]);
    const totalHours = wd.ptoHours + wd.phHours;
    weeklyOutput[wk] = {
      hc: allNames.size,
      ptoHC: wd.ptoNames.size,
      ptoHours: wd.ptoHours,
      phHC: wd.phNames.size,
      phHours: wd.phHours,
      totalHours: totalHours,
      utilHours: uPTO.hours,
      utilHC: uPTO.hc instanceof Set ? uPTO.hc.size : (uPTO.hc || 0),
      matchPct: totalHours > 0 ? Math.min(100, (uPTO.hours / totalHours) * 100) : 0,
    };
  });

  return {
    available: true,
    weeks: last4Keys,
    w0: last4Keys[last4Keys.length - 1],
    w1: last4Keys.length > 1 ? last4Keys[last4Keys.length - 2] : null,
    data: weeklyOutput,
  };
}

// =============================================================
//  WEEK METRICS
// =============================================================
function computeWeekMetrics(rows) {
  // Issue type groups
  const STRATEGIC_TYPES = ['Kick-off epic', 'Epic', 'Go-live epic'];
  const EXECUTION_TYPES = ['Task', 'Story', 'Sub-task'];

  const strategicVolume = rows.filter(r => STRATEGIC_TYPES.includes(r.issueType)).length;
  const executionVolume = rows.filter(r => EXECUTION_TYPES.includes(r.issueType)).length;
  
  // The 'total' metric for the primary dashboard cards and delta calculations 
  // should represent the management-level Epics (Strategy).
  const total = strategicVolume;

  // Issue type distribution
  const byType = groupCount(rows, 'issueType');

  // Priority distribution
  const byPriority = groupCount(rows, 'priority');

  // Overdue resolution analysis
  let overdueResolvedCount = 0;
  rows.forEach(r => {
    if (r.resolved && r.dueDate && r.resolved > r.dueDate) {
      overdueResolvedCount++;
    }
  });

  // Contributor stats (Task level work)
  const contributorStats = {};
  rows.filter(r => EXECUTION_TYPES.includes(r.issueType)).forEach(r => {
    const name = r.assignee || 'Unassigned';
    if (!contributorStats[name]) contributorStats[name] = { total: 0, byType: {} };
    contributorStats[name].total++;
    contributorStats[name].byType[r.issueType] = (contributorStats[name].byType[r.issueType] || 0) + 1;
  });

  // Project distribution (top 10)
  const projectCounts = {};
  rows.forEach(r => {
    const k = r.projectKey || 'Unknown';
    if (!projectCounts[k]) projectCounts[k] = { count: 0, name: r.projectName || k };
    projectCounts[k].count++;
  });
  const topProjects = Object.entries(projectCounts)
    .map(([key, v]) => ({ key, name: v.name, count: v.count, pct: pct(v.count, total) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Concentration risk
  const top3 = topProjects.slice(0, 3).reduce((s, p) => s + p.count, 0);
  const top3Pct = pct(top3, total);
  const concentrationRisk = top3Pct > 60 ? 'CRITICAL' : top3Pct > 40 ? 'MODERATE' : 'HEALTHY';

  // Epic age analysis
  const ages = rows
    .filter(r => r.created && r.updated)
    .map(r => Math.round((r.updated - r.created) / 86400000));
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
  const medianAge = ages.length ? median(ages) : 0;
  const veryOld = ages.filter(a => a > 180).length;

  // Status distribution
  const byStatus = groupCount(rows, 'status');

  // Workstream distribution
  const byWorkstream = groupCount(rows, 'workstream');

  // Unique projects
  const uniqueProjects = [...new Set(rows.map(r => r.projectKey))];

  return {
    total,
    byType,
    strategicVolume,
    executionVolume,
    overdueResolvedCount,
    contributorStats,
    byPriority,
    topProjects,
    top3Pct,
    concentrationRisk,
    avgAge,
    medianAge,
    veryOld,
    byStatus,
    byWorkstream,
    uniqueProjects,
  };
}

// =============================================================
//  WEEK-OVER-WEEK COMPARISON
// =============================================================
function computeWoW(w1Label, m1, w2Label, m2, rows1, rows2) {
  const delta = m2.total - m1.total;
  const deltaPct = pctChange(m1.total, m2.total);

  // Velocity pattern
  let velocityPattern;
  if (deltaPct > 30) velocityPattern = 'Acceleration';
  else if (deltaPct < -30) velocityPattern = 'Deceleration';
  else velocityPattern = 'Stable';

  // Project movement
  const set1 = new Set(m1.uniqueProjects);
  const set2 = new Set(m2.uniqueProjects);
  const disappeared = [...set1].filter(p => !set2.has(p)).map(p => {
    const count = rows1.filter(r => r.projectKey === p).length;
    const name = rows1.find(r => r.projectKey === p)?.projectName || p;
    return { key: p, name, count, pct: pct(count, m1.total) };
  }).sort((a, b) => b.count - a.count);
  const emerged = [...set2].filter(p => !set1.has(p)).map(p => {
    const count = rows2.filter(r => r.projectKey === p).length;
    const name = rows2.find(r => r.projectKey === p)?.projectName || p;
    return { key: p, name, count, pct: pct(count, m2.total) };
  }).sort((a, b) => b.count - a.count);
  const stable = [...set1].filter(p => set2.has(p));

  // Portfolio pattern
  const churnRate = set1.size > 0 ? disappeared.length / set1.size : 0;
  const acquisitionRate = set2.size > 0 ? emerged.length / set2.size : 0;
  let portfolioPattern;
  if (churnRate > 0.5 && acquisitionRate > 0.3) portfolioPattern = 'Portfolio Rotation';
  else if (churnRate < 0.2) portfolioPattern = 'Stable Portfolio';
  else portfolioPattern = 'Mixed Activity';

  // Priority deltas
  const allPriorities = [...new Set([
    ...Object.keys(m1.byPriority),
    ...Object.keys(m2.byPriority),
  ])];
  const priorityDelta = {};
  allPriorities.forEach(p => {
    const c1 = m1.byPriority[p] || 0;
    const c2 = m2.byPriority[p] || 0;
    priorityDelta[p] = { w1: c1, w2: c2, delta: c2 - c1, deltaPct: pctChange(c1, c2) };
  });

  // Issue type deltas
  const allTypes = [...new Set([
    ...Object.keys(m1.byType),
    ...Object.keys(m2.byType),
  ])];
  const typeDelta = {};
  allTypes.forEach(t => {
    const c1 = m1.byType[t] || 0;
    const c2 = m2.byType[t] || 0;
    typeDelta[t] = { w1: c1, w2: c2, delta: c2 - c1, deltaPct: pctChange(c1, c2) };
  });

  // Kick-off & Go-live
  const kickoff1 = m1.byType['Kick-off epic'] || 0;
  const kickoff2 = m2.byType['Kick-off epic'] || 0;
  const kickoffGrowth = pctChange(kickoff1, kickoff2);
  const golive1 = m1.byType['Go-live epic'] || 0;
  const golive2 = m2.byType['Go-live epic'] || 0;
  const goliveGrowth = pctChange(golive1, golive2);

  let lifecycleStage;
  if (kickoffGrowth > 50) lifecycleStage = 'Initiation Phase — New programs starting';
  else if (goliveGrowth > 50) lifecycleStage = 'Delivery Phase — Programs completing';
  else lifecycleStage = 'Mixed Phase';

  // R&D check (workstream)
  const rd1 = m1.byWorkstream['R&D'] || m1.byWorkstream['RnD'] || m1.byWorkstream['Research'] || 0;
  const rd2 = m2.byWorkstream['R&D'] || m2.byWorkstream['RnD'] || m2.byWorkstream['Research'] || 0;
  const rdDrop = rd1 > 0 && rd2 === 0;

  // Priority uniformity check
  const priorityChanges = Object.values(priorityDelta).map(d => d.deltaPct).filter(v => isFinite(v));
  const maxChange = Math.max(...priorityChanges);
  const minChange = Math.min(...priorityChanges);
  const priorityUniform = (maxChange - minChange) <= 20;

  // Overdue and Execution deltas
  const overdueDelta = m2.overdueResolvedCount - m1.overdueResolvedCount;
  const executionDelta = m2.executionVolume - m1.executionVolume;
  const executionDeltaPct = pctChange(m1.executionVolume, m2.executionVolume);

  return {
    w1Label, w2Label,
    m1, m2,
    delta, deltaPct,
    overdueDelta,
    executionDelta, executionDeltaPct,
    velocityPattern, portfolioPattern, lifecycleStage,
    disappeared, emerged, stable,
    priorityDelta, typeDelta,
    kickoffGrowth, goliveGrowth,
    rdDrop, rd1, rd2,
    priorityUniform,
    churnRate: Math.round(churnRate * 100),
    acquisitionRate: Math.round(acquisitionRate * 100),
  };
}

// =============================================================
//  PATTERN CLASSIFICATION
// =============================================================
function classifyPatterns(wow) {
  const patterns = [];

  if (wow.deltaPct < -40 && wow.disappeared.length >= 3 && wow.emerged.length >= 3) {
    patterns.push({
      id: 'rotation',
      label: 'Portfolio Rotation',
      icon: '🔄',
      severity: 'info',
      description: 'Major programs completed; new ones onboarding. Expected 2–3 week recovery.',
    });
  }
  if (wow.priorityUniform && Math.abs(wow.deltaPct) > 10) {
    patterns.push({
      id: 'uniform',
      label: 'Uniform Priority Shift',
      icon: '⚖️',
      severity: 'info',
      description: 'All priority levels moved proportionally — portfolio-wide capacity shift, not selective deprioritization.',
    });
  }
  if (wow.kickoffGrowth > 50) {
    patterns.push({
      id: 'kickoff',
      label: 'Kick-off Surge',
      icon: '🚀',
      severity: 'positive',
      description: `Kick-off epics grew ${fmt(wow.kickoffGrowth)}% — strong new business pipeline converting.`,
    });
  }
  if (wow.goliveGrowth > 50) {
    patterns.push({
      id: 'golive',
      label: 'Go-live Wave',
      icon: '✅',
      severity: 'positive',
      description: `Go-live epics grew ${fmt(wow.goliveGrowth)}% — delivery maturity; high customer satisfaction signal.`,
    });
  }
  if (wow.rdDrop) {
    patterns.push({
      id: 'rd',
      label: 'R&D Sacrifice',
      icon: '⚠️',
      severity: 'warning',
      description: `R&D epics dropped from ${wow.rd1} → 0. Innovation capacity may be sacrificed for delivery.`,
    });
  }
  if (wow.m2.top3Pct > 60) {
    patterns.push({
      id: 'concentration',
      label: 'High Concentration Risk',
      icon: '🔴',
      severity: 'critical',
      description: `Top 3 customers = ${fmt(wow.m2.top3Pct)}% of Week 2 volume. Revenue volatility risk.`,
    });
  }
  if (wow.m2.overdueResolvedCount > 0) {
    patterns.push({
      id: 'backlog_cleanup',
      label: 'Backlog Cleanup',
      icon: '🧹',
      severity: 'positive',
      description: `Successfully resolved ${wow.m2.overdueResolvedCount} overdue items this week — clearing debt.`,
    });
  }
  if (wow.executionDeltaPct > 25) {
    patterns.push({
      id: 'execution_surge',
      label: 'Rocketeer Execution Surge',
      icon: '👷',
      severity: 'positive',
      description: `Task/Story resolution grew ${fmt(wow.executionDeltaPct)}% — high contributor contribution.`,
    });
  }

  return patterns;
}

// =============================================================
//  RISK & OPPORTUNITY ASSESSMENT
// =============================================================
function assessRisks(wow) {
  const items = [];

  // Velocity
  if (wow.deltaPct < -40) {
    items.push({
      type: 'risk', severity: 'critical',
      signal: `Epic volume dropped ${fmt(Math.abs(wow.deltaPct))}% (${wow.m1.total} → ${wow.m2.total})`,
      impact: 'Severe velocity reduction may impact revenue recognition and customer SLAs.',
      action: 'Immediate executive review. Verify Week 3 recovery to 60-70% of prior volume.',
    });
  } else if (wow.deltaPct < -20) {
    items.push({
      type: 'risk', severity: 'warning',
      signal: `Epic volume dropped ${fmt(Math.abs(wow.deltaPct))}% (${wow.m1.total} → ${wow.m2.total})`,
      impact: 'Moderate deceleration. Monitor for continuation.',
      action: 'Identify root cause: lifecycle timing vs. resource constraint.',
    });
  } else if (wow.deltaPct > 30) {
    items.push({
      type: 'opportunity', severity: 'positive',
      signal: `Epic volume grew ${fmt(wow.deltaPct)}% (${wow.m1.total} → ${wow.m2.total})`,
      impact: 'Strong delivery acceleration — positive for revenue recognition.',
      action: 'Ensure quality standards maintained during acceleration.',
    });
  }

  // Concentration
  if (wow.m2.top3Pct > 60) {
    items.push({
      type: 'risk', severity: 'critical',
      signal: `Top 3 customers = ${fmt(wow.m2.top3Pct)}% of volume`,
      impact: 'Over-reliance creates feast-or-famine delivery volatility.',
      action: 'Diversification strategy: target 5–10 mid-tier customers. Goal: top 3 < 50%.',
    });
  } else if (wow.m2.top3Pct > 40) {
    items.push({
      type: 'risk', severity: 'warning',
      signal: `Top 3 customers = ${fmt(wow.m2.top3Pct)}% of volume`,
      impact: 'Moderate concentration. Portfolio at risk if key customer pauses.',
      action: 'Monitor customer health. Begin diversification planning.',
    });
  }

  // R&D
  if (wow.rdDrop) {
    items.push({
      type: 'risk', severity: 'warning',
      signal: `R&D epics: ${wow.rd1} → 0 (−100%)`,
      impact: 'Innovation capacity sacrificed for customer delivery. Long-term competitive risk.',
      action: 'Reserve 10–15% team capacity for continuous R&D regardless of customer load.',
    });
  }

  // Priority management
  const highPriDelta = wow.priorityDelta['Highest'] || wow.priorityDelta['High'];
  const lowPriDelta  = wow.priorityDelta['Low'] || wow.priorityDelta['Lowest'];
  if (highPriDelta && lowPriDelta) {
    if (highPriDelta.deltaPct < -50 && lowPriDelta.deltaPct > 0) {
      items.push({
        type: 'risk', severity: 'critical',
        signal: `High-priority work stalling (${fmt(highPriDelta.deltaPct)}%) while low-priority continues`,
        impact: 'Priority management failure. Critical work at risk.',
        action: 'Immediate resource reallocation to highest-priority items.',
      });
    }
  }

  // Kick-off opportunity
  if (wow.kickoffGrowth > 50) {
    items.push({
      type: 'opportunity', severity: 'positive',
      signal: `Kick-off epics grew ${fmt(wow.kickoffGrowth)}%`,
      impact: 'Strong new business pipeline converting to delivery programs.',
      action: 'Accelerate onboarding playbooks; target 3-week ramp to full velocity.',
    });
  }

  // Old epics
  if (wow.m2.veryOld > 5) {
    items.push({
      type: 'risk', severity: 'warning',
      signal: `${wow.m2.veryOld} epics aged >180 days in current week`,
      impact: 'Stale epics indicate scope issues, resource constraints, or backlog debt.',
      action: 'Epic aging review: close, re-scope, or escalate each item >180 days.',
    });
  }

  return items;
}

// =============================================================
//  STRATEGIC INSIGHTS
// =============================================================
function generateInsights(wow, patterns) {
  const insights = [];

  // Primary velocity insight
  const direction = wow.delta > 0 ? 'increased' : 'decreased';
  insights.push({
    title: 'Delivery Velocity',
    signal: `Epic volume ${direction} by ${Math.abs(wow.delta)} (${fmt(wow.deltaPct)}%) from ${wow.w1Label} to ${wow.w2Label}`,
    why: wow.velocityPattern === 'Deceleration'
      ? 'Major programs completed milestone batches in the prior week, creating a natural trough.'
      : wow.velocityPattern === 'Acceleration'
      ? 'New programs have reached delivery velocity after onboarding ramp.'
      : 'Velocity is stable week-over-week.',
    rootCause: `Portfolio ${wow.portfolioPattern.toLowerCase()} with ${wow.churnRate}% project churn and ${wow.acquisitionRate}% new project entry.`,
    action: wow.deltaPct < -30
      ? 'Monitor Week 3 recovery. If volume remains below 70% of prior week, escalate to executive team.'
      : 'Maintain current delivery pace. Track week 4 for trend confirmation.',
  });

  // Portfolio rotation insight
  if (wow.disappeared.length > 0 || wow.emerged.length > 0) {
    insights.push({
      title: 'Portfolio Movement',
      signal: `${wow.disappeared.length} projects exited, ${wow.emerged.length} Projects Started between weeks`,
      why: `${wow.disappeared.slice(0,3).map(p => p.key).join(', ')} had no items resolved this week. New entrants: ${wow.emerged.slice(0,3).map(p => p.key).join(', ')}.`,
      rootCause: `${wow.portfolioPattern} — natural variance in program resolution cycles.`,
      action: 'Monitor project throughput. No resolved items doesn\'t imply project exit; verify against active backlog if needed.',
    });
  }

  // Lifecycle stage
  insights.push({
    title: 'Program Lifecycle Stage',
    signal: wow.lifecycleStage,
    why: `Kick-off epics: ${fmt(wow.kickoffGrowth)}% change | Go-live epics: ${fmt(wow.goliveGrowth)}% change`,
    rootCause: wow.kickoffGrowth > 50
      ? 'Sales pipeline converting at high rate. Initiation activity outpacing delivery.'
      : wow.goliveGrowth > 50
      ? 'Delivery maturity peak — multiple programs reaching completion simultaneously.'
      : 'Balanced mix of initiation and delivery work.',
    action: wow.kickoffGrowth > 50
      ? 'Standardize kick-off playbooks to compress ramp time from initiation to delivery.'
      : 'Manage go-live clustering to prevent post-delivery capacity gaps.',
  });

  return insights;
}

// =============================================================
//  FNHC STRATEGIC BRIEF (FACT / NOTE / HIGHLIGHT / CONCERN)
// =============================================================
function buildStrategicSignals(wow, patterns, risks, insights) {
  if (!wow) {
    return {
      mode: 'fallback',
      generatedAt: new Date().toISOString(),
      security: { sanitized: true, tokenCount: 0, aiUsed: false },
      sections: [{
        title: 'Portfolio Readiness',
        facts: ['Insufficient week history to compute strategic signals yet.'],
        notes: ['Load at least 2 weeks of backlog data to enable WoW intelligence.'],
        highlights: [],
        concerns: ['FNHC report is in warm-up mode until historical baseline exists.'],
        visuals: ['KPI Snapshot', 'Week-over-Week Delta'],
      }],
    };
  }

  // ── Cache-first: reuse AI signals when data hasn't changed ──
  const dataHash = computeDataHash_(wow, patterns, risks);
  const cacheKey = 'ai_signals_' + dataHash;
  const cached = getLargeCache_(cacheKey);
  if (cached) {
    Logger.log('Serving AI signals from cache (hash: ' + dataHash + ')');
    return cached;
  }

  const aiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const sanitized = sanitizeStrategicInput_(wow, patterns, risks, insights);

  if (aiKey) {
    try {
      const aiResult = generateFNHCWithGemini_(sanitized.payload);
      const result = {
        mode: 'ai',
        generatedAt: new Date().toISOString(),
        security: {
          sanitized: true,
          tokenCount: Object.keys(sanitized.tokenMap).length,
          aiUsed: true,
        },
        sections: restoreStrategicOutput_(aiResult.sections || [], sanitized.tokenMap),
      };
      // Cache AI result for 1 hour to avoid repeated Gemini calls
      try { putLargeCache_(cacheKey, result, 3600); } catch (ce) { Logger.log('AI cache write failed: ' + ce.message); }
      return result;
    } catch (err) {
      Logger.log('FNHC AI generation failed, using fallback: ' + err.message);
    }
  }

  return {
    mode: 'fallback',
    generatedAt: new Date().toISOString(),
    security: {
      sanitized: true,
      tokenCount: Object.keys(sanitized.tokenMap).length,
      aiUsed: false,
    },
    sections: buildFNHCFallback_(wow, patterns, risks),
  };
}

function buildFNHCFallback_(wow, patterns, risks) {
  const riskSignals = risks.filter(r => r.type === 'risk').slice(0, 5);
  const winSignals = risks.filter(r => r.type === 'opportunity').slice(0, 5);

  return [
    {
      title: 'Portfolio Velocity & Lifecycle',
      facts: [
        `WoW epic delta: ${wow.delta > 0 ? '+' : ''}${wow.delta} (${fmt(wow.deltaPct)})`,
        `Velocity pattern: ${wow.velocityPattern}`,
        `Project churn: ${wow.churnRate}%`,
      ].slice(0, 5),
      notes: [
        `Portfolio pattern detected: ${wow.portfolioPattern}`,
        `Lifecycle stage: ${wow.lifecycleStage}`,
      ].slice(0, 5),
      highlights: winSignals.map(w => w.signal).slice(0, 5),
      concerns: riskSignals.map(r => r.signal).slice(0, 5),
      visuals: ['WoW Volume Trend', 'Lifecycle Mix'],
    },
    {
      title: 'Workforce Health & Capacity',
      facts: [
        `Top 3 concentration: ${fmt(wow.m2.top3Pct)}%`,
        `${wow.disappeared.length} projects exited`,
        `${wow.emerged.length} Projects Started`,
      ].slice(0, 5),
      notes: [
        'Metric direction alone is insufficient; validate root drivers before action.',
        'Prioritize signal quality over short-term metric chasing.',
      ].slice(0, 5),
      highlights: patterns.filter(p => p.severity === 'positive').map(p => p.label).slice(0, 5),
      concerns: patterns.filter(p => p.severity === 'critical' || p.severity === 'warning').map(p => p.label).slice(0, 5),
      visuals: ['Top Customer Concentration', 'Project Entry/Exit'],
    },
  ];
}

function sanitizeStrategicInput_(wow, patterns, risks, insights) {
  const tokenMap = {};
  let projectCounter = 1;

  function registerToken(name) {
    if (!name || tokenMap[name]) return;
    tokenMap[name] = 'SR_PROJECT_' + String(projectCounter).padStart(2, '0');
    projectCounter++;
  }

  wow.disappeared.forEach(p => {
    registerToken(p.key);
    registerToken(p.name);
  });
  wow.emerged.forEach(p => {
    registerToken(p.key);
    registerToken(p.name);
  });

  const payload = JSON.parse(JSON.stringify({ wow, patterns, risks, insights }));
  const keys = Object.keys(tokenMap).sort((a, b) => b.length - a.length);

  function redactString(value) {
    let output = String(value);
    keys.forEach(k => {
      output = output.split(k).join(tokenMap[k]);
    });
    return output;
  }

  function walk(node) {
    if (node === null || node === undefined) return node;
    if (typeof node === 'string') return redactString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object') {
      const out = {};
      Object.keys(node).forEach(k => { out[k] = walk(node[k]); });
      return out;
    }
    return node;
  }

  return {
    payload: walk(payload),
    tokenMap,
  };
}

function restoreStrategicOutput_(sections, tokenMap) {
  const reverse = {};
  Object.keys(tokenMap).forEach(real => { reverse[tokenMap[real]] = real; });
  const tokens = Object.keys(reverse);

  function restore(value) {
    let output = String(value);
    tokens.forEach(token => {
      output = output.split(token).join(reverse[token]);
    });
    return output;
  }

  return sections.map(s => ({
    title: restore(s.title || 'Strategic Section'),
    facts: (s.facts || []).map(restore).slice(0, 5),
    notes: (s.notes || []).map(restore).slice(0, 5),
    highlights: (s.highlights || []).map(restore).slice(0, 5),
    concerns: (s.concerns || []).map(restore).slice(0, 5),
    visuals: (s.visuals || []).map(restore).slice(0, 2),
  }));
}

function generateFNHCWithGemini_(sanitizedPayload) {
  const prompt = [
    'You are an executive strategy analyst for a high-performance team.',
    'Build a concise FNHC brief (Fact, Note, Highlight, Concern) covering:',
    '1. Portfolio Strategy (Epic volume, churn, initiation vs delivery).',
    '2. Contributor Execution (Task/Story volume and resolution pace). Highlight this as the "real contribution" by Rocketeers.',
    '3. Workforce Health & Capacity (Utilization gaps, department attainment).',
    '4. Pipeline Health (Overdue item resolution trends).',
    '',
    'Output ONLY valid JSON following this schema:',
    '{"sections":[{"title":"string","facts":["..."],"notes":["..."],"highlights":["..."],"concerns":["..."],"visuals":["...","..."]}]}',
    'Rules:',
    '- Max 5 data points per category.',
    '- Use "Rocketeer" instead of "employee".',
    '- Explicitly contrast Strategy (management-level Epics) with Execution (individual-level Tasks/Stories).',
    '- Highlight "Backlog Cleanup" (overdue resolved) as a positive fact/highlight.',
    '- PTO/Planned Time Off is quarterly-planned and expected — never flag it as a concern or negative signal.',
    '- The backlog data provided contains ONLY resolved/completed items.',
    '',
    'Data:',
    JSON.stringify(sanitizedPayload),
  ].join('\n');

  const text = callGeminiAPI_(prompt, {
    temperature: 0.1,
    topP: 0.9,
    topK: 20,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  });

  const parsed = JSON.parse(text);
  if (!parsed.sections || !Array.isArray(parsed.sections)) {
    throw new Error('Invalid FNHC schema from Gemini');
  }
  return parsed;
}

function callGeminiAPI_(prompt, config) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured.');

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent';
  const defaultConfig = {
    temperature: 0.0,
    topP: 0.9,
    topK: 20,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json',
  };
  const generationConfig = config ? Object.assign({}, defaultConfig, config) : defaultConfig;

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig,
    }),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const status = response.getResponseCode();
  const body = response.getContentText();

  if (status !== 200) {
    throw new Error('Gemini request failed: HTTP ' + status);
  }

  const json = JSON.parse(body);
  if (json.candidates && json.candidates[0] && json.candidates[0].content && json.candidates[0].content.parts && json.candidates[0].content.parts[0]) {
    return String(json.candidates[0].content.parts[0].text || '').trim();
  }
  throw new Error('No valid Gemini content returned');
}

// =============================================================
//  UTILITY FUNCTIONS
// =============================================================
function groupCount(rows, field) {
  const counts = {};
  rows.forEach(r => {
    const v = r[field] || 'Unknown';
    counts[v] = (counts[v] || 0) + 1;
  });
  return counts;
}

function pct(num, denom) {
  return denom === 0 ? 0 : Math.round((num / denom) * 1000) / 10;
}

function pctChange(from, to) {
  if (from === 0) return to > 0 ? 100 : 0;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function fmt(val) {
  if (!isFinite(val)) return 'N/A';
  const sign = val > 0 ? '+' : '';
  return `${sign}${val}%`;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ==================== AUTHORIZATION ====================

/**
 * Get authorized emails from Script Properties
 */
function getAuthorizedEmails() {
  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const storedEmails = scriptProperties.getProperty('AUTHORIZED_EMAILS');
    if (storedEmails) {
      const emailList = JSON.parse(storedEmails);
      Logger.log('Loaded ' + emailList.length + ' authorized emails');
      return emailList;
    }
  } catch (e) {
    Logger.log('Error loading authorized emails: ' + e.message);
  }
  return FALLBACK_AUTHORIZED_EMAILS; 
}

/**
 * Setup authorized users in Script Properties.
 * Restricted to the dashboard owner (OWNER_EMAIL in Script Properties).
 */
function setupAuthorizedUsers(emails) {
  const owner = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  const caller = Session.getActiveUser().getEmail();
  if (!owner || !caller || caller.toLowerCase() !== owner.toLowerCase()) {
    throw new Error('Only the dashboard owner can modify access.');
  }
  if (!Array.isArray(emails) || emails.length === 0) {
    throw new Error('Please provide a valid array of email addresses');
  }
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty('AUTHORIZED_EMAILS', JSON.stringify(emails));
  Logger.log('Successfully configured ' + emails.length + ' authorized users');
  return 'Authorized users updated successfully';
}

/**
 * UI Helper to manage authorized users from the spreadsheet
 */
function manageAuthorizedUsers() {
  const ui = SpreadsheetApp.getUi();
  const current = getAuthorizedEmails().join(', ');
  const response = ui.prompt('Manage Dashboard Access', 
    'Current authorized users: ' + current + '\n\nEnter new comma-separated list of emails:', 
    ui.ButtonSet.OK_CANCEL);
  
  if (response.getSelectedButton() == ui.Button.OK) {
    const emails = response.getResponseText().split(',').map(e => e.trim()).filter(e => e.length > 0);
    if (emails.length > 0) {
      try {
        const msg = setupAuthorizedUsers(emails);
        ui.alert(msg);
      } catch (e) {
        ui.alert('Error: ' + e.message);
      }
    } else {
      ui.alert('No valid emails provided. Update cancelled.');
    }
  }
}

function getUserViewMode_() {
  try {
    const mode = PropertiesService.getUserProperties().getProperty('dashboard_view_mode');
    return 'contributors';
  } catch (e) {
    return 'contributors';
  }
}

function setUserViewMode(mode) {
  if (!checkUserAuthorized()) throw new Error('Unauthorized');
  const validMode = 'contributors';
  PropertiesService.getUserProperties().setProperty('dashboard_view_mode', validMode);
  return validMode;
}

// ==================== SIGNAL MODE PREFERENCE ====================

function getUserSignalMode_() {
  try {
    const mode = PropertiesService.getUserProperties().getProperty('signal_mode');
    return mode === 'fallback' ? 'fallback' : 'ai';
  } catch (e) {
    return 'ai';
  }
}

function setUserSignalMode(mode) {
  if (!checkUserAuthorized()) throw new Error('Unauthorized');
  const validMode = mode === 'fallback' ? 'fallback' : 'ai';
  PropertiesService.getUserProperties().setProperty('signal_mode', validMode);
  return validMode;
}

/**
 * Called from frontend when user toggles to AI mode and no cached AI signals exist.
 * Computes AI signals on demand (with caching for subsequent calls).
 */
function requestAISignals() {
  if (!checkUserAuthorized()) throw new Error('Unauthorized');
  const core = buildCorePayload_(getUserViewMode_());
  if (!core.wow) return null;
  return buildStrategicSignals(core.wow, core.patterns, core.risks, core.insights);
}

/**
 * Compute an MD5 hash of key metrics to detect data changes for AI caching.
 */
function computeDataHash_(wow, patterns, risks) {
  const fingerprint = JSON.stringify({
    delta: wow.delta,
    deltaPct: wow.deltaPct,
    churn: wow.churnRate,
    velocity: wow.velocityPattern,
    portfolio: wow.portfolioPattern,
    patternCount: (patterns || []).length,
    riskCount: (risks || []).length,
    disappeared: wow.disappeared.length,
    emerged: wow.emerged.length,
  });
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, fingerprint);
  return Utilities.base64Encode(digest).replace(/[^a-zA-Z0-9]/g, '');
}

// ==================== CACHING HELPERS ====================

/**
 * Stores large objects in CacheService by chunking them.
 * GAS limit is 100KB per key.
 */
function putLargeCache_(baseKey, data, expirationSeconds) {
  const cache = CacheService.getUserCache();
  const json = JSON.stringify(data);
  const chunkSize = 90000; // ~90KB safe limit
  const chunks = [];
  
  for (let i = 0; i < json.length; i += chunkSize) {
    chunks.push(json.substring(i, i + chunkSize));
  }
  
  // Store metadata
  cache.put(baseKey, JSON.stringify({ count: chunks.length, timestamp: Date.now() }), expirationSeconds);
  
  // Store chunks
  chunks.forEach((chunk, idx) => {
    cache.put(baseKey + '_' + idx, chunk, expirationSeconds);
  });
}

/**
 * Retrieves and reassembles large objects from CacheService.
 */
function getLargeCache_(baseKey) {
  const cache = CacheService.getUserCache();
  const metadataStr = cache.get(baseKey);
  if (!metadataStr) return null;
  
  try {
    const metadata = JSON.parse(metadataStr);
    let fullJson = '';
    for (let i = 0; i < metadata.count; i++) {
      const chunk = cache.get(baseKey + '_' + i);
      if (chunk === null) return null; // Missing chunk, cache invalid
      fullJson += chunk;
    }
    return JSON.parse(fullJson);
  } catch (e) {
    Logger.log('Cache retrieval error: ' + e.message);
    return null;
  }
}