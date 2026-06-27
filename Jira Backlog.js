  // ============================================================
  // SCRIPT NAME: Exec Contribution Tracker — Backlog WoW from Jira
  // PURPOSE:     Fetches completed internal work from Jira per Space
  //              (COE, R&D), buckets by completion date across the
  //              last 3 Mon–Sun weeks, writes Jira Raw + Weekly Report
  //              + Exec Q&A (WoW Δ for last 2 completed weeks).
  // AUTHOR:      Alex Lopez
  // CREATED:     3/30/2026
  // VERSION:     3.0.0
  // ENVIRONMENT: Google Apps Script
  // CHANGES v3.0.0:
  //   - Buckets by resolutiondate (not updated) for accurate completion tracking
  //   - Per-Space JQL fetches (COE, R&D) with statusCategory = Done
  //   - Cursor-based pagination (nextPageToken) via /rest/api/3/search/jql
  //   - New fields: Story Points, Epic Key, Parent Key, Completed Date
  //   - New “Exec Q&A” sheet: WoW metrics per Space (items, contributors, SP)
  //   - Raw sheet columns 0–14 unchanged (backward compatible)
  // ============================================================

  // ============================================================
  // ⚙️  CONFIGJURATION — Edit values here before running
  // ============================================================
  const CONFIGJ = {
    // Your Jira site domain — no trailing slash
    JIRA_BASE_URL: "https://servicerocket-coe.atlassian.net",

    // Jira account email tied to your API token
    JIRA_EMAIL:    "moises.lopez@servicerocket.com",

    // How many days back to fetch from Jira (covers 4 full weeks + buffer)
    // Converted to explicit ISO date at runtime — no relative syntax like "-4w"
    LOOKBACK_DAYS: 35, // Changed from 35 for one-time 20-week export

    // Number of completed calendar weeks to analyse (Mon–Sun boundaries)
    // Use 4 so Exec Q&A has trend context beyond the 2-week WoW compare.
    WEEKS_BACK: 4, // Changed from 4 for one-time 20-week export

    // Sheet tab names — auto-created if missing
    RAW_SHEET:    "Jira Raw",
    REPORT_SHEET: "Weekly Report",
    EXEC_SHEET:   "Exec Q&A",
    TOP_SHEET:    "Top Performers",
    ROSTER_SHEET: "Roster",
    CAPACITY_SHEET: "Capacity",
    TIME_OFF_SHEET: "Time Off",

    // ── Executive reporting ────────────────────────────────────
    // Number of completed weeks used for the Exec Q&A WoW comparison
    EXEC_WEEKS_BACK: 2,

    // Targeted Job Profiles (for Headcount calculation)
    TARGET_PROFILES: [
      "07.I4.2 - Senior Consultant I, Delivery",
      "07.I3.1 - Engineer, Customer Support",
      "15.I5.1 - Senior Consultant II, Project Management",
      "07.I4.1 - Senior Engineer I, Customer Support",
      "18.I6.1 - Senior Consultant III, Solution Architecture",
      "18.I4.1 - Senior Consultant I, Solution Architecture",
      "07.I2.1 - Associate Engineer, Customer Support",
      "09.I5.1 - Senior Consultant II, Service Delivery",
      "07.I5.1 - Senior Engineer II, Customer Support",
      "18.I5.1 - Senior Consultant II, Solution Architecture",
      "07.I5.2 - Senior Consultant II, Delivery",
      "09.I5.3 - Senior Engineer II, Service Delivery",
      "09.I4.3 - Senior Engineer I, Service Delivery",
      "09.I3.1 - Consultant, Technical Consulting",
      "15.I4.1 - Senior Consultant I, Project Management",
      "09.I4.1 - Senior Consultant I, Technical Consulting",
      "09.I3.3 - Engineer, Service Delivery"
    ],

    // "Space" definitions — match by project key OR project name
    // Add every key/name your Jira instance uses for each space
    SPACES: [
      { key: "COE",  enabled: true, match: ["COE", "COEINT", "COE Platform"] },
      { key: "R&D",  enabled: false , match: ["RND", "RND-OPS", "RDP", "R&D", "R&D Projects", "R & D"] }, // To exclude R&D, simply change enabled to false
    ],

    // Issue types considered "execution work"
    EXEC_ISSUE_TYPES: ['Epic', '"Kick-off epic"', '"Go-live epic"', 'Story', 'Task', '"Sub-task"'],

    // Prefer statusCategory over hard-coded status names
    DONE_JQL: 'statusCategory = Done',
    WIP_JQL: 'status IN ("In Progress")', // NEW: For Active Engagement

    // Revenue-linked fix version filter (SRSO)
    FIX_VERSION_JQL: 'fixVersion ~ "SRSO*"',

    // Tempo tracking sheet name (transposed: rows = employees, cols = weeks)
    TEMPO_SHEET: "Tempo Transposed",

    // Planned Time Tempo sheet (fields: User (Resource), Resource Type, Program, Team, Role, Skills, W21, W22, ...)
    PLANNED_TEMPO_SHEET: "Planned Time Tempo",

    // Site-specific custom field IDs (IMPORTANT: verify via /rest/api/3/field)
    STORY_POINTS_FIELD: "customfield_10026",  // ← replace if different
    EPIC_LINK_FIELD:    "customfield_10014",  // ← replace if different (Epic Link)
    EPIC_TYPE_FIELD:    null,                 // e.g. "customfield_12345" if you have one

    // Fields to request from Jira REST API
    // To map custom fields: https://servicerocket-coe.atlassian.net/rest/api/3/field
    JIRA_FIELDS: null, // built below after config is defined
  };

  // Build JIRA_FIELDS after CONFIGJ is defined so we can reference the custom field IDs
  CONFIGJ.JIRA_FIELDS = [
    "summary",
    "issuetype",
    "project",
    "assignee",
    "reporter",
    "priority",
    "status",
    "resolution",
    "created",
    "updated",
    "resolutiondate",
    "statuscategorychangedate",
    "duedate",
    "fixVersions",
    "parent",
    "labels",
    "components",
    "timetracking",
    "timeoriginalestimate",
    "timespent",
    "issuelinks",
    "comment",                         // Added for behavioral trend analysis
    "customfield_10015",              // Start Date
    CONFIGJ.STORY_POINTS_FIELD,
    CONFIGJ.EPIC_LINK_FIELD,
  ].filter(Boolean);

  // ============================================================
  // 🎨  COMPANY BRAND PALETTE — Do not modify
  // ============================================================
  const COLORS = {
    VOID_BLUE:   "#0F1941",
    ORBE_BLUE:   "#058CDC",
    IVORY:       "#DCCDBE",
    LIGHT_CREAM: "#FFFAF5",
    ROYAL:       "#2864E6",
    JUNE:        "#FF9B87",
  };

  // ============================================================
  // 🔤  NAME MAPPING (Jira -> Roster)
  // ============================================================
  // Relies on the global _NAME_CACHE and NAME_MAPS defined in 
  // "Hours Analysis.js" / "@Change Names.js" to avoid redeclaration errors.

  function normalizeToRoster_(name) {
    if (!name) return "";
    const trimmed = String(name).trim();

    // 1. Prioritise direct mapping from @Change Names.js (NAME_MAPST.TEMPO)
    if (typeof NAME_MAPST !== 'undefined' && NAME_MAPST.TEMPO) {
      var directMap = NAME_MAPST.TEMPO[trimmed];
      if (directMap) return directMap;
    }

    // 2. Fallback to global _NAME_CACHE if available (from Hours Analysis.js)
    if (typeof _NAME_CACHE !== 'undefined') {
      // The global cache usually keys by lowercase or normalized names.
      return _NAME_CACHE[trimmed.toLowerCase()] || trimmed;
    }

    return trimmed;
  }


  // ============================================================
  // 🧠  BEHAVIORAL ANALYSIS DICTIONARY
  // Maps keywords to ServiceRocket Leadership Behaviors
  // ============================================================
  const BEHAVIOR_KEYWORDS = {
    "Team Builder": {
      id: "1.3",
      keywords: ["help", "support", "thanks", "great job", "team", "together", "appreciate", "collaborate", "shoutout"],
      description: "Connects deeply with others and creates a positive climate."
    },
    "Deliberate/Decisive": {
      id: "7.1",
      keywords: ["blocker", "decided", "moving forward", "priority", "focused on", "action", "resolved", "bottleneck"],
      description: "Directly addresses issues and is efficient at decision making."
    },
    "Proactive & Responsive": {
      id: "9.4",
      keywords: ["update", "resolved early", "opportunity", "ahead of schedule", "seize", "proactive", "responsive"],
      description: "Able to respond and seize opportunities; master of cadence."
    },
    "Accountable": {
      id: "10.1",
      keywords: ["delayed", "my bad", "owning", "fixed", "confirmed", "commitment", "responsible", "sorry"],
      description: "Dependable and communicates effectively when unable to deliver."
    }
  };

  /**
   * Analyzes a compiled comment string for behavioral signals based on keywords.
   * Returns an object with counts for each behavioral category.
   */
  function analyzeComments_(commentStr) {
    const scores = {};
    Object.keys(BEHAVIOR_KEYWORDS).forEach(cat => scores[cat] = 0);
    
    if (!commentStr) return scores;
    
    const lowerComment = commentStr.toLowerCase();
    
    Object.keys(BEHAVIOR_KEYWORDS).forEach(category => {
      const data = BEHAVIOR_KEYWORDS[category];
      data.keywords.forEach(keyword => {
        // Use regex with word boundaries to avoid partial matches (e.g., "team" in "steam")
        const regex = new RegExp("\\b" + keyword + "\\b", "gi");
        const matches = lowerComment.match(regex);
        if (matches) {
          scores[category] += matches.length;
        }
      });
    });
    
    return scores;
  }

  // ── SECTION: HELPERS ─────────────────────────────────────────

  /**
   * Reads the Capacity sheet to determine the weekly capacity hours per employee.
   * Returns a Map: Normalized Name -> { weeklyCapacity: number }
   */
  function readCapacity_() {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.CAPACITY_SHEET || "Capacity");
    if (!sh) {
      Logger.log("⚠️ Capacity sheet not found. Using default capacity (40h).");
      return new Map();
    }
    
    const raw = sh.getDataRange().getValues();
    if (raw.length <= 1) return new Map();

    const headers = raw[0].map(h => String(h || "").trim());
    const f_empIdx = headers.findIndex(h => /employee|name|resource|worker/i.test(h) && !/role|title/i.test(h));
    
    // Find capacity columns (W18, W19, etc.)
    const capCols = [];
    headers.forEach((h, idx) => {
      if (/capacity \(hrs\) w\d+/i.test(h)) {
        capCols.push({ idx: idx, label: h.match(/W\d+/i)[0].toUpperCase() });
      }
    });

    const map = new Map();
    for (let i = 1; i < raw.length; i++) {
      const empRaw = String(raw[i][f_empIdx] || "").trim();
      if (!empRaw || empRaw.toLowerCase() === "employee") continue;
      const emp = normalizeToRoster_(empRaw);
      
      const weeklyCaps = {};
      capCols.forEach(col => {
        weeklyCaps[col.label] = parseFloat(raw[i][col.idx]) || 40;
      });
      
      map.set(emp, { weeklyCaps: weeklyCaps });
    }

    return map;
  }

  function isoWeekNum_(d) {
    var dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  }

  /**
   * Reads the Capacity sheet (wide format: one row per employee, one col per week)
   * and the "Tempo Transposed" sheet (same shape, but tracking hours).
   * Returns { weeks, weekAgg, byEmp, currentWn, nextW1, nextW2, planningTotal, planningMet }
   * weekAgg[wKey] = { headcount, totalCap, totalTempo }
   * byEmp[normName][wKey] = { cap, tempo }
   */
  function readTempoTrend_() {
    var result = { weeks: [], weekAgg: {}, byEmp: {}, currentWn: 0, nextW1: "", nextW2: "", planningTotal: 0, planningMet: 0, targetedTotal: 0, targetedNames: {} };

    var capSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.CAPACITY_SHEET || "Capacity");
    if (!capSh) { Logger.log("⚠️ Capacity sheet not found — Tempo trend skipped."); return result; }

    var raw = capSh.getDataRange().getValues();
    if (raw.length <= 1) return result;

    var headers = raw[0].map(function(h) { return String(h || "").trim(); });
    var empIdx = -1;
    for (var j = 0; j < headers.length; j++) {
      if (/employee|name|rocketeer|resource/i.test(headers[j]) && !/role|title|id/i.test(headers[j])) { empIdx = j; break; }
    }
    if (empIdx === -1) return result;

    // Capacity week cols: "Capacity (hrs) W18"
    var capCols = [];
    // Tempo cols embedded in Capacity sheet (fallback): "Tempo (hrs) W18" or "Tempo Tracked W18"
    var inlineTempoCols = [];
    headers.forEach(function(h, idx) {
      var cm = h.match(/capacity.*w(\d+)/i);
      if (cm) { capCols.push({ wNum: parseInt(cm[1]), idx: idx, key: "W" + cm[1] }); return; }
      var tm = h.match(/tempo.*w(\d+)/i) || h.match(/tracked.*w(\d+)/i);
      if (tm) inlineTempoCols.push({ wNum: parseInt(tm[1]), idx: idx, key: "W" + tm[1] });
    });
    if (capCols.length === 0) return result;

    // Read Tempo sheet — supports two layouts:
    //   Wide/transposed:  User | W16 | W17 | W18 | ...
    //   Long-form:        User | Date | Hours  (one row per day — auto-summed into ISO weeks)
    var tempoData = {};  // tempoData[normName][wKey] = total hours
    var tempoShName = CONFIGJ.TEMPO_SHEET || "Tempo Transposed";
    var tempoSh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tempoShName);
    if (tempoSh) {
      var tRaw = tempoSh.getDataRange().getValues();
      if (tRaw.length > 1) {
        var tHdr = tRaw[0].map(function(h) { return String(h || "").trim(); });
        var tEmpIdx = -1;
        for (var j = 0; j < tHdr.length; j++) {
          if (/user|employee|name|rocketeer|resource/i.test(tHdr[j]) && !/role|title|id|type/i.test(tHdr[j])) { tEmpIdx = j; break; }
        }
        if (tEmpIdx !== -1) {
          // Detect format: wide if any column header is exactly W\d+
          var isWide = tHdr.some(function(h) { return /^W\d+$/i.test(h); });
          if (isWide) {
            // Wide format: one row per employee, week totals in W\d+ columns
            var tWeekCols = [];
            tHdr.forEach(function(h, idx) {
              var m = h.match(/^W(\d+)$/i);
              if (m) tWeekCols.push({ wNum: parseInt(m[1]), idx: idx, key: "W" + m[1] });
            });
            for (var i = 1; i < tRaw.length; i++) {
              var empRaw = String(tRaw[i][tEmpIdx] || "").trim();
              if (!empRaw) continue;
              var emp = normalizeToRoster_(empRaw);
              if (!tempoData[emp]) tempoData[emp] = {};
              tWeekCols.forEach(function(col) {
                tempoData[emp][col.key] = (tempoData[emp][col.key] || 0) + (parseFloat(tRaw[i][col.idx]) || 0);
              });
            }
          } else {
            // Long-form format: User | Date | Hours — one row per day entry
            var tDateIdx = -1, tHoursIdx = -1;
            for (var j = 0; j < tHdr.length; j++) {
              if (/^date$/i.test(tHdr[j]) || (/date|day/i.test(tHdr[j]) && tDateIdx === -1)) tDateIdx = j;
              if (/^hours?$/i.test(tHdr[j]) || (/hours?|time|duration/i.test(tHdr[j]) && tHoursIdx === -1)) tHoursIdx = j;
            }
            if (tDateIdx !== -1 && tHoursIdx !== -1) {
              for (var i = 1; i < tRaw.length; i++) {
                var empRaw = String(tRaw[i][tEmpIdx] || "").trim();
                if (!empRaw) continue;
                var emp = normalizeToRoster_(empRaw);
                var dateVal = tRaw[i][tDateIdx];
                var d = (dateVal instanceof Date) ? dateVal : new Date(dateVal);
                if (isNaN(d.getTime())) continue;
                var wKey = "W" + isoWeekNum_(d);
                var hrs = parseFloat(tRaw[i][tHoursIdx]) || 0;
                if (!tempoData[emp]) tempoData[emp] = {};
                tempoData[emp][wKey] = (tempoData[emp][wKey] || 0) + hrs;
              }
            } else {
              Logger.log("⚠️ Tempo sheet: could not find Date or Hours columns. Headers: " + tHdr.join(", "));
            }
          }
        }
      }
    }

    // Determine current ISO week first — used to filter to completed weeks only
    var currentWn = isoWeekNum_(new Date());
    result.currentWn = currentWn;
    result.nextW1 = "W" + (currentWn + 1);
    result.nextW2 = "W" + (currentWn + 2);

    // Build week list: completed weeks only (strictly < currentWn), sorted ascending
    result.weeks = capCols
      .map(function(c) { return c.wNum; })
      .filter(function(n, i, a) { return a.indexOf(n) === i && n < currentWn; })
      .sort(function(a, b) { return a - b; })
      .map(function(n) { return "W" + n; });

    // Init aggregates only for completed weeks
    result.weeks.forEach(function(wKey) {
      result.weekAgg[wKey] = { headcount: 0, totalCap: 0, totalTempo: 0 };
    });

    // Load targeted roster — only targeted ICs contribute to headcount / capacity / tempo
    var rosterData = readTargetedRoster_();
    var targetedNames = rosterData.names; // { normName: true }
    result.targetedTotal = rosterData.count;
    result.targetedNames = targetedNames;
    // lowercase → canonical roster name, so byEmp keys always match targetedNames keys
    var targetedLower = {};
    var targetedCanonical = {};
    Object.keys(targetedNames).forEach(function(n) {
      targetedLower[n.toLowerCase()] = true;
      targetedCanonical[n.toLowerCase()] = n;
    });

    // Build lowercased tempoData keys so Capacity↔Tempo name casing mismatches don't break lookups
    var tempoDataLC = {};
    Object.keys(tempoData).forEach(function(k) { tempoDataLC[k.toLowerCase()] = tempoData[k]; });

    // Aggregate per employee row — targeted contributors only
    for (var i = 1; i < raw.length; i++) {
      var empRaw = String(raw[i][empIdx] || "").trim();
      if (!empRaw || /employee|name/i.test(empRaw)) continue;
      var emp = normalizeToRoster_(empRaw);

      if (!targetedNames[emp] && !targetedLower[emp.toLowerCase()]) continue; // skip non-targeted ICs

      capCols.forEach(function(col) {
        if (!result.weekAgg[col.key]) return; // skip future / non-completed weeks
        var cap = parseFloat(raw[i][col.idx]) || 0;
        if (cap <= 0) return;

        var agg = result.weekAgg[col.key];
        agg.headcount++;
        agg.totalCap += cap;

        // Tempo: prefer Transposed sheet (case-insensitive name lookup), fall back to inline column
        var tempo = 0;
        var empLC = emp.toLowerCase();
        var empTempoRow = tempoData[emp] || tempoDataLC[empLC];
        if (empTempoRow && empTempoRow[col.key] !== undefined) {
          tempo = empTempoRow[col.key];
        } else {
          for (var ti = 0; ti < inlineTempoCols.length; ti++) {
            if (inlineTempoCols[ti].key === col.key) { tempo = parseFloat(raw[i][inlineTempoCols[ti].idx]) || 0; break; }
          }
        }
        agg.totalTempo += tempo;

        // Per-employee record — keyed by canonical roster name so compliance lookups match
        var canonical = targetedCanonical[emp.toLowerCase()] || emp;
        if (!result.byEmp[canonical]) result.byEmp[canonical] = {};
        result.byEmp[canonical][col.key] = { cap: cap, tempo: tempo };
      });
    }

    return result;
  }

  /**
   * Reads the "Planned Time Tempo" sheet.
   * Fields: User (Resource), Resource Type, Program, Team, Role, Skills, W21, W22, W23, ...
   * Week columns grow over time as contributors plan further ahead.
   *
   * Returns:
   *   total       — total unique contributors found
   *   none        — 0 future weeks planned
   *   one         — exactly 1 future week planned
   *   two         — exactly 2 future weeks planned  (meets minimum)
   *   threeplus   — 3+ future weeks planned         (positive/proactive)
   *   byEmp       — { normName: { count: N, weeks: ["W21","W22",...] } }
   *   futureWeeks — sorted list of future week keys found in the sheet
   */
  function readPlannedTimeTempo_() {
    var result = { total: 0, none: 0, one: 0, two: 0, threeplus: 0, byEmp: {}, futureWeeks: [] };

    var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.PLANNED_TEMPO_SHEET || "Planned Time Tempo");
    if (!sh) { Logger.log("⚠️ 'Planned Time Tempo' sheet not found — planning section skipped."); return result; }

    var raw = sh.getDataRange().getValues();
    if (raw.length <= 1) return result;

    var headers = raw[0].map(function(h) { return String(h || "").trim(); });

    // Find the employee/resource column ("User (Resource)" or similar)
    var empIdx = -1;
    for (var j = 0; j < headers.length; j++) {
      if (/user|resource|rocketeer|name|employee/i.test(headers[j]) &&
          !/type|role|skill|program|team/i.test(headers[j])) { empIdx = j; break; }
    }
    if (empIdx === -1) { Logger.log("⚠️ Employee column not found in Planned Time Tempo."); return result; }

    var currentWn = isoWeekNum_(new Date());

    // Collect all week columns; split into past/current and future
    var futureWeekCols = [];
    headers.forEach(function(h, idx) {
      var m = h.match(/^W(\d+)$/i);
      if (!m) return;
      var wn = parseInt(m[1]);
      if (wn > currentWn) futureWeekCols.push({ wNum: wn, idx: idx, key: "W" + wn });
    });
    futureWeekCols.sort(function(a, b) { return a.wNum - b.wNum; });

    if (futureWeekCols.length === 0) {
      Logger.log("⚠️ No future week columns found in Planned Time Tempo (current week: W" + currentWn + ").");
      return result;
    }
    result.futureWeeks = futureWeekCols.map(function(c) { return c.key; });

    // Scope to targeted contributors only (case-insensitive fallback for name mismatches)
    var rosterData = readTargetedRoster_();
    var targetedNames = rosterData.names;
    var targetedLower = {};
    var targetedCanonical = {};
    Object.keys(targetedNames).forEach(function(n) {
      targetedLower[n.toLowerCase()] = true;
      targetedCanonical[n.toLowerCase()] = n;
    });

    for (var i = 1; i < raw.length; i++) {
      var empRaw = String(raw[i][empIdx] || "").trim();
      if (!empRaw) continue;
      var emp = normalizeToRoster_(empRaw);
      if (!targetedNames[emp] && !targetedLower[emp.toLowerCase()]) continue; // skip non-targeted ICs
      var canonical = targetedCanonical[emp.toLowerCase()] || emp;
      result.total++;

      // Count future weeks where the person has planned hours > 0
      var plannedWeeks = [];
      futureWeekCols.forEach(function(col) {
        if ((parseFloat(raw[i][col.idx]) || 0) > 0) plannedWeeks.push(col.key);
      });

      result.byEmp[canonical] = { count: plannedWeeks.length, weeks: plannedWeeks };

      if      (plannedWeeks.length === 0) result.none++;
      else if (plannedWeeks.length === 1) result.one++;
      else if (plannedWeeks.length === 2) result.two++;
      else                                result.threeplus++;
    }

    return result;
  }

  /**
   * Reads the Time Off sheet to determine PTO hours per employee per day.
   * Returns a Map: "Normalized Name|YYYY-MM-DD" -> hours
   */
  function readTimeOff_() {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.TIME_OFF_SHEET || "Time Off");
    if (!sh) {
      Logger.log("⚠️ Time Off sheet not found. Assuming 0 PTO.");
      return new Map();
    }
    
    const raw = sh.getDataRange().getValues();
    if (raw.length <= 1) return new Map();

    const headers = raw[0].map(h => String(h || "").toLowerCase().trim());
    const iEmp = headers.findIndex(h => h === "name" || h === "employee" || h === "resource");
    const iDate = headers.findIndex(h => h === "date");
    const iHours = headers.findIndex(h => /hours|amount|sum/i.test(h));

    const map = new Map();
    for (let i = 1; i < raw.length; i++) {
      const empRaw = String(raw[i][iEmp] || "").trim();
      if (!empRaw) continue;
      const emp = normalizeToRoster_(empRaw);

      const date = (raw[i][iDate] instanceof Date) ? raw[i][iDate] : new Date(raw[i][iDate]);
      if (isNaN(date.getTime())) continue;
      
      const iso = toIsoDate_(date);
      const key = emp + "|" + iso;
      const hrs = iHours !== -1 ? (parseFloat(raw[i][iHours]) || 8) : 8;
      map.set(key, (map.get(key) || 0) + hrs);
    }
    
    return map;
  }

  function buildHeaders_() {
    const token = getAPI__Jira();
    return {
      "Authorization": "Basic " + Utilities.base64Encode(CONFIGJ.JIRA_EMAIL + ":" + token),
      "Accept":        "application/json",
      "Content-Type":  "application/json",
    };
  }

  function getLastNWeeks_(n) {
    n = n || CONFIGJ.WEEKS_BACK;
    const today = new Date();

    // Find the Monday that started the CURRENT week (Mon–Sun boundary)
    const daysSinceMonday = (today.getDay() + 6) % 7; // Mon=0, Tue=1, … Sun=6
    const thisMonday = new Date(today);
    thisMonday.setDate(today.getDate() - daysSinceMonday);
    thisMonday.setHours(0, 0, 0, 0);

    var weeks = [];
    for (var i = 1; i <= n; i++) {
      var mon = new Date(thisMonday);
      mon.setDate(thisMonday.getDate() - i * 7);
      mon.setHours(0, 0, 0, 0);
      
      var sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);

      var nextMon = new Date(mon);
      nextMon.setDate(mon.getDate() + 7);
      nextMon.setHours(0, 0, 0, 0);

      weeks.unshift({
        label:      getWeekLabel_(mon),
        from:       mon,
        to:         sun,
        fromStr:    toIsoDate_(mon),
        toStr:      toIsoDate_(sun),
        nextMonStr: toIsoDate_(nextMon) // for exclusive JQL bounds
      });
    }
    return weeks;
  }

  function toIsoDate_(d) {
    return d.getFullYear()
      + "-" + String(d.getMonth() + 1).padStart(2, "0")
      + "-" + String(d.getDate()).padStart(2, "0");
  }

  function toShortDate_(d) {
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear();
  }

  function fmtDateTime_(val) {
    if (!val) return "";
    var d = (val instanceof Date) ? val : new Date(val);
    if (isNaN(d)) return "";
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear()
      + " " + String(d.getHours()).padStart(2, "0")
      + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function dig_(obj, path) {
    return path.split(".").reduce(function(o, k) {
      return (o && o[k] != null) ? o[k] : null;
    }, obj);
  }

  function jb_getOrCreateSheet_(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName(name) || ss.insertSheet(name);
  }

  /**
   * Reads the Roster sheet to determine the total headcount of the Delivery Team.
   * Uses CONFIGJ.TARGET_PROFILES to filter for targeted individual contributors.
   * Returns an object with { count: number, names: Set<string> }
   */
  function readTargetedRoster_() {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIGJ.ROSTER_SHEET);
    const result = { count: 0, names: {} };

    if (!sh) {
      Logger.log("⚠️ Roster sheet not found. Cannot determine targeted headcount.");
      return result;
    }

    const raw = sh.getDataRange().getValues();
    if (raw.length <= 1) return result;

    const headers = raw[0].map(h => String(h || "").trim());
    const f_nameIdx = headers.findIndex(h => (/name/i.test(h) || /worker/i.test(h)) && !/number|id|status|type/i.test(h));
    const f_titleIdx = headers.findIndex(h => /job title|title|profile/i.test(h));

    const nameIdx = f_nameIdx !== -1 ? f_nameIdx : 3;
    const titleIdx = f_titleIdx !== -1 ? f_titleIdx : 6;

    for (let i = 1; i < raw.length; i++) {
      const rawName = String(raw[i][nameIdx] || "").trim();
      const title = String(raw[i][titleIdx] || "").trim();

      if (!rawName || rawName.toLowerCase() === "name" || rawName.length < 3) continue;

      // Check if the title exactly matches one of our targeted profiles
      const isTargeted = CONFIGJ.TARGET_PROFILES.includes(title);

      if (isTargeted) {
        result.count++;
        // Store the normalized name to cross-reference with Jira
        result.names[normalizeToRoster_(rawName)] = true;
      }
    }

    Logger.log("✅ Total Targeted Roster Headcount: " + result.count);
    return result;
  }

  /**
   * Recursively extracts plain text from Atlassian Document Format (ADF) used in Jira v3 API.
   */
  function extractTextFromADF_(node) {
    if (!node) return "";
    if (typeof node === 'string') return node;
    if (node.type === "text") return node.text || "";
    if (node.content && Array.isArray(node.content)) {
      var text = node.content.map(extractTextFromADF_).join("");
      if (node.type === "paragraph" || node.type === "heading") return text + "\n";
      return text;
    }
    return "";
  }

  function styleHeader_(range) {
    range
      .setBackground(COLORS.VOID_BLUE)
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setFontSize(12)
      .setFontFamily("Arial")
      .setVerticalAlignment("middle");
  }

  // ── SECTION: JIRA FETCH ───────────────────────────────────────

  /**
   * Generic Jira search using cursor-based pagination (nextPageToken).
   * Uses /rest/api/3/search/jql endpoint. Filters out "to delete" issues.
   */
  function fetchAllIssuesByJql_(jql) {
    var headers = buildHeaders_();
    var url     = CONFIGJ.JIRA_BASE_URL + "/rest/api/3/search/jql";
    var all     = [];
    var maxResults = 100;
    var nextPageToken = null;

    while (true) {
      var body = {
        jql:        jql,
        maxResults: maxResults,
        fields:     CONFIGJ.JIRA_FIELDS,
      };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      var resp = UrlFetchApp.fetch(url, {
        method:             "POST",
        headers:            headers,
        payload:            JSON.stringify(body),
        muteHttpExceptions: true,
      });

      var code = resp.getResponseCode();
      if (code === 401) throw new Error("❌ 401 Unauthorized — check JIRA_EMAIL and re-run setAPI__Jira().");
      if (code === 400) {
        var err = JSON.parse(resp.getContentText());
        throw new Error("❌ 400 Bad Request — " + JSON.stringify(err.errorMessages || err));
      }
      if (code !== 200) throw new Error("❌ Jira API error " + code + ": " + resp.getContentText().substring(0, 400));

      var data   = JSON.parse(resp.getContentText());
      var issues = data.issues || [];
      all.push.apply(all, issues);

      Logger.log("   Fetched " + all.length + " issues so far…");

      nextPageToken = data.nextPageToken || null;
      if (!nextPageToken) break;
      if (issues.length === 0) break;
    }

    // Filter out "To delete" issues (contains, case-insensitive)
    return all.filter(function(i) {
      return !String(i.fields.summary || "").toLowerCase().includes("to delete");
    });
  }

  /**
   * Fetches current Work In Progress (WIP) to measure Active Engagement.
   * Looks for items that are currently "In Progress" with an assignee.
   */
  function fetchActiveWIP_() {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      CONFIGJ.WIP_JQL,
      'project NOT IN (TEMPLATE)',
      'assignee is not EMPTY',
      'summary !~ "to delete"'
    ].join(" AND ");
    
    Logger.log("📋 Active WIP JQL: " + jql);

    // Fetch and then filter by enabled spaces
    var all = fetchAllIssuesByJql_(jql);
    return all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
  }
  /**
   * Broad fetch — original working JQL that returns all Done issues
   * across all projects. Uses fetchAllIssuesByJql_ for pagination.
   */
  function fetchJiraIssues_() {
    var since    = new Date();
    since.setDate(since.getDate() - CONFIGJ.LOOKBACK_DAYS);
    var sinceStr = toIsoDate_(since);
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");

    var jql = [
      'issuetype in (' + types + ')',
      CONFIGJ.DONE_JQL,
      'project NOT IN (TEMPLATE)',
      'resolutiondate >= "' + sinceStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ")
    + ' ORDER BY resolutiondate DESC';
    Logger.log("📋 JQL: " + jql);

    // Fetch and then filter by enabled spaces
    var all = fetchAllIssuesByJql_(jql);
    return all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
  }

  /**
   * Returns true if a resolution name indicates the item was *not* actually
   * delivered (i.e. closed without shipping value). Used to compute
   * "Delivery Quality %" — throughput minus closed-but-not-shipped.
   */
  function isNonDelivery_(resolutionName) {
    if (!resolutionName) return false;
    var s = String(resolutionName).toLowerCase();
    return s === "won't do" || s === "wont do"
        || s === "duplicate" || s === "cannot reproduce"
        || s === "not a bug"  || s === "declined"
        || s === "rejected"   || s === "incomplete";
  }

  /**
   * Fetches issues CREATED inside a date window (for backlog-health "Added" metric).
   * Includes all statuses — we only care about creation date, not resolution.
   */
  function fetchCreatedIssues_(fromStr, toStr) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    var jql = [
      'issuetype in (' + types + ')',
      'project NOT IN (TEMPLATE)',
      'created >= "' + fromStr + '"',
      'created <= "' + toStr + '"',
      'summary !~ "to delete"'
    ].join(" AND ") + ' ORDER BY created DESC';
    Logger.log("📋 Created-issues JQL: " + jql);

    // Fetch and then filter by enabled spaces
    var all = fetchAllIssuesByJql_(jql);
    return all.filter(function(i) {
      return getSpaceForIssue_(i) !== null;
    });
  }

  /**
   * Determines the Space key for an issue based on its project key or name.
   * Matches against CONFIGJ.SPACES[].match array. Returns "Other" if no match.
   * NEW: Respects the 'enabled' flag in CONFIGJ.SPACES.
   */
  function getSpaceForIssue_(issue) {
    var f = issue.fields || {};
    var projKey  = (dig_(f, "project.key")  || "").toUpperCase();
    var projName = normalizeName_(dig_(f, "project.name") || "");

    if (!projKey && !projName) return "Customer";

    for (var i = 0; i < CONFIGJ.SPACES.length; i++) {
      var space = CONFIGJ.SPACES[i];
      var matches = space.match;
      for (var j = 0; j < matches.length; j++) {
        var m = matches[j];
        var mNorm = normalizeName_(m);
        var mKey  = m.toUpperCase();
        
        // Match against project key OR normalized project name
        if (mKey === projKey || mNorm === projName) {
          // If the space is explicitly disabled, return null to signal exclusion
          if (space.enabled === false) return null;
          return space.key;
        }
      }
    }
    return "Customer";
  }

  /**
   * Returns the best "completion date" for an issue.
   * Prefers resolutiondate; falls back to statuscategorychangedate.
   */
  function getCompletedDate_(issue) {
    var f = issue.fields || {};
    return f.resolutiondate           ? new Date(f.resolutiondate)
        : f.statuscategorychangedate ? new Date(f.statuscategorychangedate)
        : null;
  }

  /**
   * Builds a JQL query for completed work in a specific Space + week window.
   */
  function buildCompletedWorkJql_(spaceJql, week) {
    var types = CONFIGJ.EXEC_ISSUE_TYPES.join(", ");
    return [
      "(" + spaceJql + ")",
      "issuetype in (" + types + ")",
      CONFIGJ.DONE_JQL,
      'resolved >= "' + week.fromStr + '"',
      'resolved < "' + week.toStr + '"',
      'summary !~ "to delete"',
      "project not in (TEMPLATE)",
      "assignee is not EMPTY",
    ].join(" AND ");
  }

  /**
   * Fetches completed issues for each Space × Week combination.
   * Returns [{label, space, jql, issues}].
   */
  function fetchWeeklyData_(weeks) {
    var weeklyData = [];
    weeks.forEach(function(week) {
      CONFIGJ.SPACES.forEach(function(space) {
        var jql = buildCompletedWorkJql_(space.jql, week);
        Logger.log("📋 JQL [" + space.key + " | " + week.label + "]: " + jql);
        var issues = fetchAllIssuesByJql_(jql);
        issues.forEach(function(i) {
          i.__spaceKey  = space.key;
          i.__weekLabel = week.label;
        });
        weeklyData.push({
          label:  week.label,
          space:  space.key,
          jql:    jql,
          issues: issues,
        });
      });
    });
    return weeklyData;
  }

  /**
   * Adapts the new space×week weeklyData into the old per-week format
   * needed by writeReportSheet_ (merges all spaces per week).
   */
  function aggregateByWeek_(weeklyData, weeks) {
    return weeks.map(function(week) {
      var merged = [];
      weeklyData.forEach(function(wd) {
        if (wd.label === week.label) {
          merged.push.apply(merged, wd.issues);
        }
      });
      return { label: week.label, issues: merged };
    });
  }

  // ── SECTION: SHEET WRITERS ────────────────────────────────────

  // Columns 0–14 are locked for backward compatibility (Contribution Report reads by index).
  // New columns appended at indices 15–26.
  var RAW_HEADERS = [
    /* 0 */ "Week", /* 1 */ "Key", /* 2 */ "Work (Summary)",
    /* 3 */ "Workstream (Issue Type)", /* 4 */ "Space (Project)",
    /* 5 */ "Assignee", /* 6 */ "Reporter", /* 7 */ "Priority", /* 8 */ "Status",
    /* 9 */ "Created", /* 10 */ "Updated", /* 11 */ "Resolution Date",
    /* 12 */ "Due Date", /* 13 */ "Start Date", /* 14 */ "Fix Versions",
    /* 15 */ "Exec Space",
    /* 16 */ "Assignee AccountId",
    /* 17 */ "Epic Key",
    /* 18 */ "Parent Key",
    /* 19 */ "Completed Date",
    /* 20 */ "Labels",
    /* 21 */ "Components",
    /* 22 */ "Resolution",
    /* 23 */ "Original Estimate (sec)",
    /* 24 */ "Time Spent (sec)",
    /* 25 */ "Issue Links (count)",
    /* 26 */ "Comments (ADF Extracted)",
  ];

  function issueToRow_(issue, weekLabel, spaceKey) {
    var f = issue.fields || {};
    var assignee  = f.assignee || {};
    var completed = getCompletedDate_(issue);
    var epicKey   = f[CONFIGJ.EPIC_LINK_FIELD] || "";
    var parentKey = (f.parent && f.parent.key) || "";

    var labels    = (f.labels || []).join(", ");
    var comps     = (f.components || []).map(function(c){ return c.name; }).join(", ");
    var resName   = (f.resolution && f.resolution.name) ? f.resolution.name : "";
    var origEst   = Number(f.timeoriginalestimate || 0);
    var timeSpent = Number(f.timespent || 0);
    var linkCount = (f.issuelinks || []).length;

    // Extract comments for behavioral analysis
    var commentsArr = (f.comment && f.comment.comments) || [];
    var commentStr = commentsArr.map(function(c) {
      var author = (c.author && c.author.displayName) || "Unknown";
      var date = fmtDateTime_(c.created);
      var bodyText = extractTextFromADF_(c.body).trim();
      return "[" + author + " @ " + date + "]: " + bodyText;
    }).join("\n---\n");

    return [
      // ── Columns 0–14 (unchanged) ──
      weekLabel,
      issue.key,
      f.summary || "",
      dig_(f, "issuetype.name") || "",
      dig_(f, "project.name")   || "",
      normalizeToRoster_(dig_(f, "assignee.displayName") || "Unassigned"),
      dig_(f, "reporter.displayName") || "",
      dig_(f, "priority.name") || "",
      dig_(f, "status.name")   || "",
      fmtDateTime_(f.created),
      fmtDateTime_(f.updated),
      fmtDateTime_(f.resolutiondate),
      fmtDateTime_(f.duedate),
      fmtDateTime_(f.customfield_10015),
      (f.fixVersions || []).map(function(v) { return v.name; }).join(", "),
      // ── Columns 15–26 ──
      spaceKey || "",
      assignee.accountId || "",
      epicKey,
      parentKey,
      completed ? fmtDateTime_(completed) : "",
      labels,
      comps,
      resName,
      origEst,
      timeSpent,
      linkCount,
      commentStr,
    ];
  }

  function writeRawSheet_(weeklyData) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.RAW_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    var rows = [RAW_HEADERS];
    weeklyData.forEach(function(w) {
      w.issues.forEach(function(issue) {
        rows.push(issueToRow_(issue, w.label, getSpaceForIssue_(issue)));
      });
    });

    sheet.getRange(1, 1, rows.length, RAW_HEADERS.length).setValues(rows);
    styleHeader_(sheet.getRange(1, 1, 1, RAW_HEADERS.length));
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, RAW_HEADERS.length);

    var foot = rows.length + 2;
    sheet.getRange(foot, 1)
      .setValue("Generated: " + fmtDateTime_(new Date()))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);
    sheet.getRange(foot + 1, 1)
      .setValue("Total rows: " + (rows.length - 1))
      .setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);

    Logger.log("✅ Raw sheet: " + (rows.length - 1) + " data rows written.");
  }

  function writeReportSheet_(weeklyData, weeks) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.REPORT_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    // Build pivot
    var pivot = {};
    weeklyData.forEach(function(week) {
      week.issues.forEach(function(issue) {
        var rawName = dig_(issue.fields, "assignee.displayName") || "Unassigned";
        var name    = normalizeToRoster_(rawName);
        var status = dig_(issue.fields, "status.name") || "Unknown";
        if (!pivot[name]) pivot[name] = {};
        if (!pivot[name][week.label]) pivot[name][week.label] = { count: 0, statuses: {} };
        pivot[name][week.label].count++;
        pivot[name][week.label].statuses[status] =
          (pivot[name][week.label].statuses[status] || 0) + 1;
      });
    });

    var assignees  = Object.keys(pivot).sort();
    var weekLabels = weeks.map(function(w) { return w.label; });
    var numWeeks   = weekLabels.length;
    var numDeltas  = numWeeks - 1;

    var headers = ["Assignee"]
      .concat(weekLabels)
      .concat(weeks.slice(1).map(function(_, i) { return "Δ Wk" + (i+1) + "→Wk" + (i+2); }))
      .concat(["Latest Week — Status Breakdown"]);

    var reportRows = [headers];

    assignees.forEach(function(name) {
      var counts = weekLabels.map(function(lbl) {
        return pivot[name][lbl] ? pivot[name][lbl].count : 0;
      });
      var deltas = [];
      for (var i = 1; i < counts.length; i++) {
        var d = counts[i] - counts[i - 1];
        deltas.push((d > 0 ? "↑ +" : d < 0 ? "↓ " : "→ ") + d);
      }
      var lastData  = pivot[name][weekLabels[numWeeks - 1]];
      var breakdown = lastData
        ? Object.keys(lastData.statuses).map(function(s) {
            return s + ": " + lastData.statuses[s];
          }).join(" | ")
        : "—";
      reportRows.push([name].concat(counts).concat(deltas).concat([breakdown]));
    });

    // Totals row
    var totalCounts = weekLabels.map(function(lbl) {
      var t = 0;
      weeklyData.forEach(function(w) { if (w.label === lbl) t = w.issues.length; });
      return t;
    });
    var totalDeltas = [];
    for (var i = 1; i < totalCounts.length; i++) {
      var d = totalCounts[i] - totalCounts[i - 1];
      totalDeltas.push((d > 0 ? "↑ +" : d < 0 ? "↓ " : "→ ") + d);
    }
    reportRows.push(["TOTAL"].concat(totalCounts).concat(totalDeltas).concat([""]));

    var numCols = headers.length;
    sheet.getRange(1, 1, reportRows.length, numCols).setValues(reportRows);

    // Header styling
    styleHeader_(sheet.getRange(1, 1, 1, numCols));
    sheet.setRowHeight(1, 36);

    // ── Batch formatting (avoids per-cell round-trips) ──
    var dataRows = reportRows.length - 1; // excludes header
    if (dataRows > 0) {
      // Delta columns — build background + fontColor + fontWeight arrays
      var deltaBg    = [];
      var deltaFc    = [];
      for (var r = 1; r < reportRows.length; r++) {
        var bgRow = [];
        var fcRow = [];
        for (var dc = 0; dc < numDeltas; dc++) {
          var val = String(reportRows[r][1 + numWeeks + dc]);
          if (val.indexOf("↑") === 0)      { bgRow.push("#C6EFCE"); fcRow.push("#276221"); }
          else if (val.indexOf("↓") === 0) { bgRow.push("#FFC7CE"); fcRow.push("#9C0006"); }
          else                             { bgRow.push("#F2F2F2"); fcRow.push("#666666"); }
        }
        deltaBg.push(bgRow);
        deltaFc.push(fcRow);
      }
      var deltaRange = sheet.getRange(2, 1 + numWeeks + 1, dataRows, numDeltas);
      deltaRange.setBackgrounds(deltaBg);
      deltaRange.setFontColors(deltaFc);
      deltaRange.setFontWeight("bold");
      deltaRange.setHorizontalAlignment("center");

      // Count columns — center align in one call
      sheet.getRange(2, 2, dataRows, numWeeks).setHorizontalAlignment("center");
    }

    // Totals row styling
    sheet.getRange(reportRows.length, 1, 1, numCols)
      .setFontWeight("bold").setBackground(COLORS.IVORY);

    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    sheet.autoResizeColumns(1, numCols);

    // Footer
    var metaRow = reportRows.length + 2;
    sheet.getRange(metaRow, 1, 1, 2)
      .setValues([["Generated:", fmtDateTime_(new Date())]]);
    sheet.getRange(metaRow + 1, 1, 1, 2)
      .setValues([["Window:", weeks[0].fromStr + " → " + weeks[numWeeks - 1].toStr]]);
    sheet.getRange(metaRow, 1, 2, 1)
      .setFontColor(COLORS.VOID_BLUE).setFontWeight("bold");

    Logger.log("✅ Report sheet: " + assignees.length + " assignees × " + numWeeks + " weeks.");
  }

  // ── SECTION: EXEC Q&A — Duplo + Lego signal levels ───────────

  /**
   * Writes the "Exec Q&A" sheet — executive-ready weekly signal dashboard.
   *
   * Sections (top → bottom):
   *   💡 EXECUTIVE SUMMARY        — C-level summary of what this sheet tells you
   *   🏢 COMPANY SIGNAL            — throughput, contributors, cycle, blocked, quality, effort
   *   💰 REVENUE PROTECTION EVENTS — overdue items cleared (duedate < resolutiondate)
   *   📊 SPACE BREAKDOWN           — per-Space deliverables
  /**
   * 💡 EXEC Q&A GENERATOR
   * Generates the executive-facing summary and trending report.
   * Focuses on:
   *   1. 🚀 VALUE DELIVERY         — Customer vs Internal output
   *   2. ⏱️ VELOCITY & RELIABILITY  — Cycle times and Planning Gaps
   *   3. 🔍 DATA HYGIENE              — signal-integrity checks (exec trust)
   *
   * @param {object[]} weeklyData        — bucketed Done issues per week
   * @param {object[]} execWeeks         — the 4 completed weeks for trend
   * @param {object[]} createdIssues     — issues created in the exec window
   * @param {object[]} activeWIP         — issues currently 'In Progress'
   */
  function writeExecQASheet_(weeklyData, execWeeks, createdIssues, activeWIP) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.EXEC_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    // Labels from oldest to newest. execWeeks typically has 4.
    var labels = execWeeks.map(function(w) { return w.label; });
    var latestLabel = labels[labels.length - 1];
    var priorLabel = labels[labels.length - 2];

    var headers = ["Level", "Metric"].concat(labels).concat(["WoW Δ", "WoW %", "Signal"]);
    var numCols = headers.length;

    // ── Load External Context ──────────────────────────────────
    var capacityMap = readCapacity_();
    var ptoMap = readTimeOff_();

    // ── Aggregation scaffolding ────────────────────────────────
    function blankAgg() {
      var agg = {
        count: 0, genuinelyDone: 0, cycle: [], blocked: 0, _c: {},
        rpe: 0, rpeEffortSec: 0, totalEffortSec: 0,
        dueGaps: [], earlyCount: 0, unassigned: 0, missingDue: 0, missingEpic: 0,
        // Time-of-resolution tracking (Resolution = "Done" only)
        doneCount: 0, doneEstSec: 0, doneSpentSec: 0,
        missingEstimate: 0, missingTimeSpent: 0,
        // Throughput by type
        doneEpics: 0, doneStories: 0, doneTasks: 0,
        // Behavioral Scores
        behaviorScores: {},
        // Capacity & PTO
        totalCapacityHrs: 0, totalPtoHrs: 0,
        // On-time delivery (resolved on or before due date)
        onTimeCount: 0,
        // Revenue milestone tracking (SRSO fix versions)
        srsoMilestones: 0, srsoContributors: {},
        // Contributor display names for Signal column
        _names: {},
        // Per-person milestone count (tasks + stories, non-epic, genuinely done)
        _personMilestones: {}
      };
      Object.keys(BEHAVIOR_KEYWORDS).forEach(cat => agg.behaviorScores[cat] = 0);
      return agg;
    }
    
    var company = {};
    var bySpace = {}; // label -> space -> agg
    labels.forEach(function(l) { 
      company[l] = blankAgg(); 
      bySpace[l] = {};
    });

    // ── WIP Analysis ───────────────────────────────────────────
    var wipAssignees = {};
    (activeWIP || []).forEach(function(issue) {
      var rawName = dig_(issue.fields, "assignee.displayName");
      if (rawName) {
        wipAssignees[normalizeToRoster_(rawName)] = true;
      }
    });

    // ── Calculate Weekly Capacity & PTO ────────────────────────
    execWeeks.forEach(function(week) {
      var label = week.label;
      var wNum = label.match(/W\d+/i) ? label.match(/W\d+/i)[0].toUpperCase() : null;
      
      capacityMap.forEach(function(cap, empName) {
        // Add Capacity for this week
        var weeklyCap = (wNum && cap.weeklyCaps[wNum]) ? cap.weeklyCaps[wNum] : 40;
        company[label].totalCapacityHrs += weeklyCap;
        
        // Calculate PTO for this week
        var d = new Date(week.from);
        while (d <= week.to) {
          var dayKey = empName + "|" + toIsoDate_(d);
          var ptoHrs = ptoMap.get(dayKey) || 0;
          company[label].totalPtoHrs += ptoHrs;
          d.setDate(d.getDate() + 1);
        }
      });
    });

    // Re-bucket all issues based on resolutiondate boundaries
    var doneAssigneesLatestWeek = {};
    (weeklyData || []).forEach(function(weekGroup) {
      (weekGroup.issues || []).forEach(function(issue) {
        var f = issue.fields || {};
        var resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
        if (!resolved) return;

        var targetLabel = null;
        for (var i = 0; i < execWeeks.length; i++) {
          if (resolved >= execWeeks[i].from && resolved <= execWeeks[i].to) {
            targetLabel = execWeeks[i].label;
            break;
          }
        }
        if (!targetLabel) return;

        var space = getSpaceForIssue_(issue);
        var typeName = dig_(f, "issuetype.name") || "Unknown";
        var typeNorm = typeName.toLowerCase();
        var isEpicType = typeNorm.indexOf("epic") !== -1;
        var aid = dig_(f, "assignee.accountId");
        var rawName = dig_(f, "assignee.displayName");
        var normName = normalizeToRoster_(rawName);
        var epicKey = f[CONFIGJ.EPIC_LINK_FIELD] || (f.parent && f.parent.key) || "";
        var created = f.created ? new Date(f.created) : null;
        var due = f.duedate ? new Date(f.duedate) : null;
        var daysToDone = (created && resolved) ? (resolved - created) / 86400000 : null;
        var isBlocked = (f.issuelinks || []).some(function(l) { return l.inwardIssue; });
        var timeSpentSec = Number(f.timespent || 0);
        var origEstSec = Number(f.timeoriginalestimate || 0);
        var resName = (f.resolution && f.resolution.name) ? f.resolution.name : "";
        var nonDelivery = isNonDelivery_(resName);
        var isResolutionDone = String(resName).toLowerCase() === "done";
        
        // Mark as engaged if they completed work in the LATEST week
        if (targetLabel === latestLabel && normName) {
          doneAssigneesLatestWeek[normName] = true;
        }

        // Behavioral Analysis via Comments
        var commentsArr = (f.comment && f.comment.comments) || [];
        var compiledComments = commentsArr.map(function(c) {
          return extractTextFromADF_(c.body);
        }).join(" ");
        var issueBehaviorScores = analyzeComments_(compiledComments);

        // RPE: any item with a Due Date that reached a resolution
        var isRPE = !!(due && resolved);
        var isSRSO = (f.fixVersions || []).some(function(fv) { return /^SRSO/i.test(fv.name || ''); });

        function bump(agg) {
          agg.count++;
          if (!nonDelivery) agg.genuinelyDone++;
          agg.totalEffortSec += timeSpentSec;
          if (aid) agg._c[aid] = true;
          else agg.unassigned++;
          if (normName) agg._names[normName] = true;
          if (daysToDone !== null) agg.cycle.push(daysToDone);
          if (isBlocked) agg.blocked++;
          if (!due) agg.missingDue++;
          if (!isEpicType && !epicKey) agg.missingEpic++;
          if (isRPE) {
            agg.rpe++;
            agg.rpeEffortSec += timeSpentSec;
            var gapDays = (resolved - due) / 86400000;
            agg.dueGaps.push(gapDays);
            if (resolved <= due) agg.onTimeCount++;
            if (resolved < due) agg.earlyCount++;
          }
          if (isResolutionDone) {
            agg.doneCount++;
            agg.doneEstSec += origEstSec;
            agg.doneSpentSec += timeSpentSec;
            if (origEstSec === 0) agg.missingEstimate++;
            if (timeSpentSec === 0) agg.missingTimeSpent++;
          }
          if (!nonDelivery) {
            if (isEpicType) agg.doneEpics++;
            else if (typeNorm === "story") agg.doneStories++;
            else if (typeNorm === "task" || typeNorm === "sub-task" || typeNorm === "subtask") agg.doneTasks++;
          }
          if (!nonDelivery && isSRSO && !isEpicType) {
            agg.srsoMilestones++;
            if (normName) agg.srsoContributors[normName] = (agg.srsoContributors[normName] || 0) + 1;
          }
          if (!nonDelivery && !isEpicType && normName) {
            agg._personMilestones[normName] = (agg._personMilestones[normName] || 0) + 1;
          }
          // Accumulate Behavioral Scores
          Object.keys(BEHAVIOR_KEYWORDS).forEach(function(cat) {
            agg.behaviorScores[cat] += (issueBehaviorScores[cat] || 0);
          });
        }

        bump(company[targetLabel]);
        if (!bySpace[targetLabel][space]) bySpace[targetLabel][space] = blankAgg();
        bump(bySpace[targetLabel][space]);
      });
    });

    // Backlog health (Added items)
    var createdTotal = {};
    labels.forEach(function(l) { createdTotal[l] = 0; });
    (createdIssues || []).forEach(function(issue) {
      var f = issue.fields || {};
      var created = f.created ? new Date(f.created) : null;
      if (!created) return;
      for (var i = 0; i < execWeeks.length; i++) {
        if (created >= execWeeks[i].from && created <= execWeeks[i].to) {
          createdTotal[execWeeks[i].label]++;
          break;
        }
      }
    });

    // Statistics helpers
    function getMedian(arr) {
      if (!arr.length) return 0;
      var s = arr.slice().sort(function(a, b) { return a - b; });
      var mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
    function pctOf(num, den) { return den > 0 ? Math.round(num / den * 1000) / 10 : 0; }
    function r1(n) { return Math.round(n * 10) / 10; }

    function trendWord(vPrior, vLatest, goodWhen) {
      var d = vLatest - vPrior;
      if (d === 0) return "► Flat";
      if (goodWhen === "down") return d < 0 ? "▲ Improving" : "▼ Worsening";
      return d > 0 ? "▲ Up" : "▼ Down";
    }

    // ── Aggregation & Trend Helpers ────────────────────────────
    var stats = labels.map(function(l) {
      var agg = company[l];
      var milestones = (agg.doneStories || 0) + (agg.doneTasks || 0);
      var early = agg.earlyCount || 0;
      var netValue = agg.genuinelyDone || 0;
      var rate = pctOf(agg.genuinelyDone, agg.count);
      var ics = Object.keys(agg._c || {}).length;
      var epics = agg.doneEpics || 0;
      var totalClosed = agg.count || 0;
      return { 
        milestones: milestones, 
        stories: agg.doneStories || 0,
        tasks: agg.doneTasks || 0,
        early: early, 
        netValue: netValue, 
        rate: rate, 
        ics: ics, 
        epics: epics, 
        totalClosed: totalClosed 
      };
    });

    var latest = stats[stats.length - 1];
    var prior = stats[stats.length - 2];

    // ── Row builders ───────────────────────────────────────────
    var rows = [headers];
    var sectionIdxs = [], execSummaryIdxs = [];

    function wowRow(level, metric, vals, signal) {
      var vLatest = vals[vals.length - 1];
      var vPrior = vals[vals.length - 2];
      var delta = vLatest - vPrior;
      var p = (vPrior === 0) ? (vLatest === 0 ? 0 : 100) : Math.round(delta / vPrior * 1000) / 10;
      return [level, metric].concat(vals).concat([delta, p, signal || ""]);
    }
    function sectionRow(title) {
      sectionIdxs.push(rows.length);
      var r = [title, ""];
      while (r.length < numCols) r.push("");
      return r;
    }
    function execRow(type, text) {
      execSummaryIdxs.push(rows.length);
      var r = ["", type, text];
      while (r.length < numCols) r.push("");
      return r;
    }

    // ── 0. EXECUTIVE SUMMARY ───────────────────────────────────
    rows.push(sectionRow("💡 EXECUTIVE SUMMARY"));

    var icsDiff = latest.ics - prior.ics;
    rows.push(execRow("FACT", "Active Contributors: " + latest.ics + " this week (" + (icsDiff >= 0 ? "+" : "") + icsDiff + " WoW)."));

    var milestoneDiff = latest.milestones - prior.milestones;
    rows.push(execRow("FACT", "Total Milestones: " + latest.milestones + " items (" + (milestoneDiff >= 0 ? "+" : "") + milestoneDiff + " WoW) — Tasks + Stories + Sub-tasks."));
    
    var latestSrso = company[latestLabel].srsoMilestones || 0;
    var priorSrso = company[priorLabel].srsoMilestones || 0;
    var srsoDiff = latestSrso - priorSrso;
    rows.push(execRow("FACT", "Revenue Milestones (SRSO): " + latestSrso + " items (" + (srsoDiff >= 0 ? "+" : "") + srsoDiff + " WoW) — fixVersion ~ SRSO*."));

    var rosterData = readTargetedRoster_();
    var totalHC = rosterData.count;
    if (totalHC > 0) {
      var engagedCount = 0, deliveredCount = 0, buildingCount = 0;
      Object.keys(rosterData.names).forEach(function(name) {
        var delivered = doneAssigneesLatestWeek[name];
        var building = wipAssignees[name];
        if (delivered || building) engagedCount++;
        if (delivered) deliveredCount++;
        if (!delivered && building) buildingCount++;
      });
      var engagementRate = Math.round((engagedCount / totalHC) * 100);
      var deliveryRate = Math.round((deliveredCount / totalHC) * 100);
      var buildingRate = Math.round((buildingCount / totalHC) * 100);
      var idleRate = 100 - engagementRate;
      rows.push(execRow("NOTE", "Engagement: " + engagementRate + "% of Targeted ICs engaged (" + deliveryRate + "% Delivered, " + buildingRate + "% Building)."));
      if (idleRate > 20) {
        var idleCount = totalHC - engagedCount;
        rows.push(execRow("CONCERN", "Idle Capacity: " + idleRate + "% (" + idleCount + " of " + totalHC + " Targeted ICs) have no completed or in-progress items."));
      }
    } else {
      var combinedActive = 0, seen = {};
      Object.keys(doneAssigneesLatestWeek).forEach(function(n) { seen[n] = true; combinedActive++; });
      Object.keys(wipAssignees).forEach(function(n) { if (!seen[n]) combinedActive++; });
      rows.push(execRow("NOTE", "Engagement: " + combinedActive + " Rocketeers actively engaged (Targeted Roster not found)."));
    }

    // ── 1. ACTIVE CONTRIBUTORS ─────────────────────────────────
    rows.push(sectionRow("👥 ACTIVE CONTRIBUTORS"));

    var contributorCounts = labels.map(function(l) { return Object.keys(company[l]._c).length; });
    var latestNames = Object.keys(company[latestLabel]._names || {}).sort().join(", ");
    rows.push(wowRow("", "Active Contributors", contributorCounts, latestNames || "—"));

    // ── 2. MILESTONES ──────────────────────────────────────────
    rows.push(sectionRow("📋 MILESTONES"));

    var milestoneCounts = labels.map(function(l) { return (company[l].doneStories || 0) + (company[l].doneTasks || 0); });
    rows.push(wowRow("", "Total Milestones (Tasks + Stories + Sub-tasks)", milestoneCounts,
      "Stories: " + latest.stories + " | Tasks & Sub-tasks: " + latest.tasks));

    var onTimeCounts = labels.map(function(l) { return company[l].onTimeCount || 0; });
    var latestRpe = company[latestLabel].rpe || 0;
    var onTimeRate = latestRpe > 0 ? Math.round((company[latestLabel].onTimeCount || 0) / latestRpe * 100) : 0;
    rows.push(wowRow("", "Delivered On Time (≤ Due Date)", onTimeCounts,
      "Items with a Due Date resolved on or before it. On-time rate: " + onTimeRate + "% of scheduled items this week."));

    var srsoCounts = labels.map(function(l) { return company[l].srsoMilestones || 0; });
    var srsoContribSummary = Object.keys(company[latestLabel].srsoContributors || {})
      .sort(function(a, b) { return (company[latestLabel].srsoContributors[b] || 0) - (company[latestLabel].srsoContributors[a] || 0); })
      .map(function(n) { return n + " (" + company[latestLabel].srsoContributors[n] + ")"; })
      .join(", ") || "—";
    rows.push(wowRow("SRSO", "Revenue Milestones (fixVersion ~ SRSO*)", srsoCounts, srsoContribSummary));

    // ── Write to Sheet ─────────────────────────────────────────
    if (rows.length > 0) {
      var range = sheet.getRange(1, 1, rows.length, numCols);
      range.setValues(rows);
      
      sheet.setFrozenRows(1);
      var fullRange = sheet.getRange(1, 1, rows.length, numCols);
      fullRange.setFontFamily("Consolas").setFontSize(12).setVerticalAlignment("middle");

      // Header styling
      sheet.getRange(1, 1, 1, numCols)
        .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

      // Section styling
      sectionIdxs.forEach(function(idx) {
        sheet.getRange(idx + 1, 1, 1, numCols)
          .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");
      });

      // Executive Summary Specifics
      execSummaryIdxs.forEach(function(idx) {
        var cell = sheet.getRange(idx + 1, 2);
        cell.setFontWeight("bold");
        var val = cell.getValue();
        if (val === "FACT") cell.setFontColor(COLORS.ROYAL);
        if (val === "CONCERN") cell.setFontColor("#C62828");
        if (val === "NOTE") cell.setFontColor("#E65100");
      });

      // Delta and Pct coloring: up = good (green), down = bad (red)
      var dCol = numCols - 2;
      var pCol = numCols - 1;
      var GREEN = "#2E7D32", RED = "#C62828";
      for (var r = 1; r < rows.length; r++) {
        var dCell = sheet.getRange(r + 1, dCol), pCell = sheet.getRange(r + 1, pCol);
        var dv = dCell.getValue(), pv = pCell.getValue();
        if (typeof dv === "number" && dv !== 0) dCell.setFontColor(dv > 0 ? GREEN : RED).setFontWeight("bold");
        if (typeof pv === "number" && pv !== 0) pCell.setFontColor(pv > 0 ? GREEN : RED).setFontWeight("bold");
      }

      sheet.setColumnWidth(1, 120);
      sheet.setColumnWidth(2, 320);
      for (var c = 3; c <= numCols - 1; c++) sheet.setColumnWidth(c, 100);
      sheet.setColumnWidth(numCols, 450); // Wider for Signals

      // ── Tempo Tracking Trend (below Jira section) ────────────────────────
      var foot = rows.length + 2;
      writeTempoTrendSection_(sheet, foot, company[latestLabel]._personMilestones || {},
        execWeeks[0].fromStr + " → " + execWeeks[execWeeks.length-1].toStr);
    }
  }



  // ── SECTION: TEMPO TREND ─────────────────────────────────────────

  /**
   * Writes the Tempo tracking trend table directly into the Exec Q&A sheet,
   * starting at startRow (below the Jira section footer).
   *
   * Columns: [blank] | Metric | W(n-3) | W(n-2) | W(n-1) | W(n) | WoW Δ | WoW % | Signal
   *
   * Rows:
   *   Section header
   *   Column header
   *   Headcount (employees with planned capacity)
   *   Total Capacity (hrs)
   *   Tempo Tracked (hrs)
   *   Tracking Rate (%)
   *   Planned Ahead for next 2 weeks (ratio + names)
   */
  function writeTempoTrendSection_(sheet, startRow, jiraMilestones, windowStr) {
    jiraMilestones = jiraMilestones || {};
    var trend = readTempoTrend_();
    if (!trend.weeks || trend.weeks.length < 2) {
      Logger.log("⚠️ Tempo trend: not enough week data to write section.");
      return;
    }

    var displayWeeks = trend.weeks.slice(-4); // last 4 available weeks
    var latestW = displayWeeks[displayWeeks.length - 1];
    var priorW  = displayWeeks[displayWeeks.length - 2];
    var agg = trend.weekAgg;
    var r1 = function(n) { return Math.round(n * 10) / 10; };

    // col1=blank, col2=Metric, col3..col(2+n)=week data, col(n+3)=WoW Δ, col(n+4)=WoW %, col(n+5)=Signal
    var numCols = 2 + displayWeeks.length + 3;

    function tRow(metric, vals, signal) {
      var vLatest = vals[vals.length - 1] || 0;
      var vPrior  = vals[vals.length - 2] || 0;
      var delta = vLatest - vPrior;
      var pct = vPrior === 0 ? (vLatest === 0 ? 0 : 100) : Math.round(delta / vPrior * 1000) / 10;
      return ["", metric].concat(vals).concat([delta, pct, signal || ""]);
    }

    function sRow(title) {
      var r = [title, ""];
      while (r.length < numCols) r.push("");
      return r;
    }

    var rows = [];

    // Section header
    rows.push(sRow("⏱️ TEMPO TRACKING TREND — Targeted HC | Last 4 completed weeks"));

    // Column header
    rows.push(["", "Metric"].concat(displayWeeks).concat(["WoW Δ", "WoW %", "Signal"]));

    // Headcount
    var hcVals = displayWeeks.map(function(w) { return (agg[w] || {}).headcount || 0; });
    rows.push(tRow("Headcount (Targeted HC with capacity)", hcVals,
      "Targeted ICs from roster with planned capacity > 0 for that week"));

    // Total Capacity
    var capVals = displayWeeks.map(function(w) { return r1((agg[w] || {}).totalCap || 0); });
    rows.push(tRow("Total Capacity (hrs)", capVals,
      "Sum of all planned capacity hours across the team"));

    // Tempo Tracked
    var tempoVals = displayWeeks.map(function(w) { return r1((agg[w] || {}).totalTempo || 0); });
    rows.push(tRow("Tempo Tracked (hrs)", tempoVals,
      "Hours logged in Tempo. Source: Tempo Transposed sheet."));

    // Tracking Rate
    var trackVals = displayWeeks.map(function(w) {
      var a = agg[w] || {};
      return a.totalCap > 0 ? Math.round((a.totalTempo || 0) / a.totalCap * 1000) / 10 : 0;
    });
    var latestRate = trackVals[trackVals.length - 1];
    rows.push(tRow("Tracking Rate (%)", trackVals,
      "Tempo logged as % of capacity. Target: ≥ 80%. Latest: " + latestRate + "%."));

    // ── Write trend rows ──────────────────────────────────────────────
    sheet.getRange(startRow, 1, rows.length, numCols).setValues(rows);

    var fullRange = sheet.getRange(startRow, 1, rows.length, numCols);
    fullRange.setFontFamily("Consolas").setFontSize(12).setVerticalAlignment("middle");

    // Section header + column header: dark blue
    sheet.getRange(startRow, 1, 2, numCols)
      .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

    var GREEN = "#2E7D32", AMBER = "#E65100", RED = "#C62828";
    var dCol = numCols - 2;
    var pCol = numCols - 1;
    for (var r = 2; r < rows.length; r++) {
      var dv = rows[r][numCols - 3];
      var pv = rows[r][numCols - 2];
      if (typeof dv === "number" && dv !== 0)
        sheet.getRange(startRow + r, dCol).setFontColor(dv > 0 ? GREEN : RED).setFontWeight("bold");
      if (typeof pv === "number" && pv !== 0)
        sheet.getRange(startRow + r, pCol).setFontColor(pv > 0 ? GREEN : RED).setFontWeight("bold");
    }

    sheet.setColumnWidth(2, 320);
    sheet.setColumnWidth(numCols, 460);

    // ── Build shared contributor data for all three tables ───────────────
    var pt = readPlannedTimeTempo_();
    var totalHC = trend.targetedTotal || 1; // denominator for compliance rates

    // ── Compliance Summary Table ─────────────────────────────────────────
    // Sits between the trend aggregate and the individual top-10 tables.
    // Answers: how many targeted ICs are tracking AND planning?
    var compStart = startRow + rows.length + 2;
    var COMP_COLS = 7; // Metric | Period | Met ✓ | Not Met | Total HC | Rate | Focus (names)

    var compLastTwo = displayWeeks.slice(-2);
    var trackedCount = 0, plannedMet = 0, bothCount = 0;
    // Both byEmp dicts now use canonical roster names as keys — case-insensitive fallback kept for safety
    var ptByEmpLCComp = {};
    Object.keys(pt.byEmp).forEach(function(n) { ptByEmpLCComp[n.toLowerCase()] = pt.byEmp[n]; });

    // Build set of names that have tracked time in last 2 completed weeks
    var trackedSet = {};
    Object.keys(trend.byEmp).forEach(function(name) {
      var weekData = trend.byEmp[name];
      var w1 = (weekData[compLastTwo[0]] && weekData[compLastTwo[0]].tempo) || 0;
      var w2 = (weekData[compLastTwo[1]] && weekData[compLastTwo[1]].tempo) || 0;
      if (w1 + w2 > 0) { trackedCount++; trackedSet[name.toLowerCase()] = true; }
    });

    // Build set of names that have >= 2 future weeks planned
    var plannedSet = {};
    Object.keys(pt.byEmp).forEach(function(name) {
      if ((pt.byEmp[name].count || 0) >= 2) { plannedMet++; plannedSet[name.toLowerCase()] = true; }
    });

    // Both
    Object.keys(plannedSet).forEach(function(nameLc) {
      if (trackedSet[nameLc]) bothCount++;
    });

    // "Focus" lists — targeted ICs who have NOT met each criterion
    var allTargeted = Object.keys(trend.targetedNames); // full 134 list
    var notTrackedNames = allTargeted
      .filter(function(n) { return !trackedSet[n.toLowerCase()]; })
      .sort().join(", ") || "—";
    var notPlannedNames = allTargeted
      .filter(function(n) {
        var pd = pt.byEmp[n] || ptByEmpLCComp[n.toLowerCase()];
        return !pd || (pd.count || 0) < 2;
      })
      .sort().join(", ") || "—";
    var notBothNames = allTargeted
      .filter(function(n) {
        return !(trackedSet[n.toLowerCase()] && plannedSet[n.toLowerCase()]);
      })
      .sort().join(", ") || "—";

    function compRate(n) { return totalHC > 0 ? Math.round(n / totalHC * 100) + "%" : "—"; }

    // Build a human-readable summary of the 17 targeted job profile families
    var profileFamilies = "Customer Support · Delivery · Service Delivery · Technical Consulting · Solution Architecture · Project Management";
    var scopeNote = "Scope: Individual Contributors (ICs), Delivery Team — " + totalHC + " people across 17 job profiles · " + profileFamilies;

    // Pre-build the two standard FACT statements
    var trackedPct  = compRate(trackedCount);
    var plannedPct  = compRate(plannedMet);
    var factTracked = trackedPct + " (" + trackedCount + "/" + totalHC + ") Service Individual Contributors reported consistent Tracking Time (" + compLastTwo.join(" + ") + ")";
    var factPlanned = plannedPct + " (" + plannedMet  + "/" + totalHC + ") Service Individual Contributors are Planning Time for Next 2 Weeks";

    var compRows = [
      // Row 0 — Section header (dark)
      (function() { var r = ["📊 TEMPO COMPLIANCE SUMMARY"]; while (r.length < COMP_COLS) r.push(""); return r; })(),
      // Row 1 — Scope note (ivory subtitle)
      (function() { var r = [scopeNote]; while (r.length < COMP_COLS) r.push(""); return r; })(),
      // Row 2 — FACT: Tracking Time statement
      (function() { var r = ["FACT", factTracked]; while (r.length < COMP_COLS) r.push(""); return r; })(),
      // Row 3 — FACT: Planning Time statement
      (function() { var r = ["FACT", factPlanned]; while (r.length < COMP_COLS) r.push(""); return r; })(),
      // Row 4 — Column header (dark)
      ["Metric", "Period", "Met ✓", "Not Met", "Targeted HC", "Rate", "Focus — who needs follow-up"],
      // Row 5 — Tracked time
      ["⏱️ Tracked Time",
        compLastTwo.join(" + ") + " (Mon–Sun)",
        trackedCount, totalHC - trackedCount, totalHC, compRate(trackedCount),
        notTrackedNames],
      // Row 6 — Planned ahead
      ["📅 Planned Ahead (≥ 2 wks)",
        pt.futureWeeks.length > 0 ? pt.futureWeeks.slice(0, 3).join(", ") + (pt.futureWeeks.length > 3 ? "…" : "") : "—",
        plannedMet, totalHC - plannedMet, totalHC, compRate(plannedMet),
        notPlannedNames],
      // Row 7 — Both
      ["✅ Both (Tracked + Planned)",
        "—",
        bothCount, totalHC - bothCount, totalHC, compRate(bothCount),
        notBothNames]
    ];

    sheet.getRange(compStart, 1, compRows.length, COMP_COLS).setValues(compRows);
    sheet.getRange(compStart, 1, compRows.length, COMP_COLS)
      .setFontFamily("Consolas").setFontSize(12).setVerticalAlignment("middle")
      .setWrap(true);

    // Row 0: dark section header
    sheet.getRange(compStart, 1, 1, COMP_COLS)
      .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

    // Row 1: ivory scope note — italic
    sheet.getRange(compStart + 1, 1, 1, COMP_COLS)
      .setBackground(COLORS.IVORY).setFontColor(COLORS.VOID_BLUE)
      .setFontStyle("italic").setFontWeight("normal").setFontSize(10);

    // Rows 2–3: FACT statements — light cream background, "FACT" label in royal blue
    sheet.getRange(compStart + 2, 1, 2, COMP_COLS)
      .setBackground(COLORS.LIGHT_CREAM).setFontColor(COLORS.VOID_BLUE);
    sheet.getRange(compStart + 2, 1, 2, 1) // "FACT" label column
      .setFontColor(COLORS.ROYAL).setFontWeight("bold");

    // Row 4: dark column header
    sheet.getRange(compStart + 4, 1, 1, COMP_COLS)
      .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

    // Colour Met / Not Met / Rate per row (data starts at row 5)
    var compDataRows = [
      { row: compStart + 5, val: trackedCount },
      { row: compStart + 6, val: plannedMet },
      { row: compStart + 7, val: bothCount }
    ];
    compDataRows.forEach(function(cr) {
      var rate = totalHC > 0 ? cr.val / totalHC : 0;
      var rateCol = rate >= 0.8 ? GREEN : (rate >= 0.5 ? AMBER : RED);
      sheet.getRange(cr.row, 3).setFontColor(GREEN).setFontWeight("bold");
      sheet.getRange(cr.row, 4).setFontColor(cr.val < totalHC ? RED : GREEN).setFontWeight("bold");
      sheet.getRange(cr.row, 6).setFontColor(rateCol).setFontWeight("bold");
      sheet.getRange(cr.row, 7).setFontColor(RED).setFontSize(10); // Focus names in red, smaller
    });

    sheet.setColumnWidth(1, 240); // Metric
    sheet.setColumnWidth(2, 160); // Period
    sheet.setColumnWidth(3, 80);  // Met
    sheet.setColumnWidth(4, 80);  // Not Met
    sheet.setColumnWidth(5, 90);  // Total HC
    sheet.setColumnWidth(6, 100); // Rate
    sheet.setColumnWidth(7, 500); // Focus names — wide for the list

    var tableStart = compStart + compRows.length + 2;

    var lastTwoWeeks = compLastTwo; // last 2 completed Mon–Sun weeks (same as compliance table)

    var allNames = {};
    Object.keys(jiraMilestones).forEach(function(n) { allNames[n] = true; });
    Object.keys(trend.byEmp).forEach(function(n) { allNames[n] = true; });
    // Case-insensitive merge: Planned Time names may differ in casing vs Tempo/Roster
    Object.keys(pt.byEmp).forEach(function(n) {
      var matched = allNames[n] ? n
        : Object.keys(allNames).find(function(k) { return k.toLowerCase() === n.toLowerCase(); });
      allNames[matched || n] = true;
    });

    var r1f = function(n) { return Math.round(n * 10) / 10; };

    var empEntries = Object.keys(allNames).map(function(name) {
      var weekData = trend.byEmp[name] || {};
      var w1 = (weekData[lastTwoWeeks[0]] && weekData[lastTwoWeeks[0]].tempo) || 0;
      var w2 = (weekData[lastTwoWeeks[1]] && weekData[lastTwoWeeks[1]].tempo) || 0;
      var twoWkTracked = w1 + w2;
      var milestones = jiraMilestones[name] || 0;
      var plannedData = pt.byEmp[name] || ptByEmpLCComp[name.toLowerCase()] || { count: 0, weeks: [] };
      return { name: name, milestones: milestones, w1: w1, w2: w2,
               twoWkTracked: twoWkTracked,
               plannedCount: plannedData.count || 0,
               plannedWeeks: plannedData.weeks || [] };
    });

    function consistencySignal(e) {
      var hasOutput  = e.milestones > 0;
      var hasTracked = e.twoWkTracked > 0;
      var hasPlanned = e.plannedCount >= 2;
      if (hasOutput && hasTracked && hasPlanned)   return "✅ All-in — output + tracked + planned";
      if (hasOutput && hasTracked && !hasPlanned)  return "⚠️ Not planned ahead (< 2 wks)";
      if (hasOutput && !hasTracked && hasPlanned)  return "⚠️ Not tracking time";
      if (hasOutput && !hasTracked && !hasPlanned) return "🚨 No tracking & no planning";
      if (!hasOutput && hasTracked && hasPlanned)  return "⭐ Tracking + planned (no Jira output yet)";
      if (!hasOutput && hasTracked)                return "⏱️ Time tracked, no Jira output";
      if (!hasOutput && e.plannedCount > 0)        return "📅 Planned only, no output yet";
      return "";
    }

    var C_COLS = 8;
    var podiumColors = ["#FFF9C4", "#F1F8E9", "#E3F2FD"];

    // Shared table writer — returns the row number after the last data row
    function writeTop10Table_(title, entries, colHdrs, rowBuilder, atRow) {
      var tRows = [];
      var hdr = [title]; while (hdr.length < C_COLS) hdr.push("");
      tRows.push(hdr);
      tRows.push(colHdrs);
      entries.slice(0, 10).forEach(function(e, idx) {
        tRows.push([idx + 1].concat(rowBuilder(e)));
      });

      sheet.getRange(atRow, 1, tRows.length, C_COLS).setValues(tRows);
      sheet.getRange(atRow, 1, tRows.length, C_COLS)
        .setFontFamily("Consolas").setFontSize(12).setVerticalAlignment("middle");
      sheet.getRange(atRow, 1, 2, C_COLS)
        .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");

      for (var pi = 0; pi < Math.min(3, tRows.length - 2); pi++) {
        sheet.getRange(atRow + 2 + pi, 1, 1, C_COLS).setBackground(podiumColors[pi]);
      }
      for (var ri = 0; ri < tRows.length - 2; ri++) {
        var sig = tRows[2 + ri][C_COLS - 1];
        if (!sig) continue;
        var sc = sheet.getRange(atRow + 2 + ri, C_COLS);
        if (sig.indexOf("✅") === 0 || sig.indexOf("⭐") === 0) sc.setFontColor(GREEN).setFontWeight("bold");
        else if (sig.indexOf("⚠️") === 0) sc.setFontColor(AMBER).setFontWeight("bold");
        else if (sig.indexOf("🚨") === 0) sc.setFontColor(RED).setFontWeight("bold");
      }
      return atRow + tRows.length;
    }

    // ── Table 1: Top 10 by Milestones ─────────────────────────────────────
    var byMilestones = empEntries
      .filter(function(e) { return e.milestones > 0; })
      .sort(function(a, b) { return b.milestones !== a.milestones ? b.milestones - a.milestones : b.twoWkTracked - a.twoWkTracked; });

    var t1End = writeTop10Table_(
      "🎯 TOP 10 — Milestones (Jira Throughput)",
      byMilestones,
      ["Rank", "Contributor", "Milestones", lastTwoWeeks[0] + " Tracked", lastTwoWeeks[1] + " Tracked", "2-wk Tracked", "Planned Wks", "Consistency"],
      function(e) { return [e.name, e.milestones, r1f(e.w1), r1f(e.w2), r1f(e.twoWkTracked), e.plannedCount, consistencySignal(e)]; },
      tableStart
    );

    // ── Table 2: Top 10 by Tracked Time (last 2 completed Mon–Sun weeks) ──
    var byTracked = empEntries
      .filter(function(e) { return e.twoWkTracked > 0; })
      .sort(function(a, b) { return b.twoWkTracked !== a.twoWkTracked ? b.twoWkTracked - a.twoWkTracked : b.milestones - a.milestones; });

    var t2End = writeTop10Table_(
      "⏱️ TOP 10 — Tracked Time (" + lastTwoWeeks.join(" & ") + ", Mon–Sun)",
      byTracked,
      ["Rank", "Contributor", lastTwoWeeks[0] + " Tracked", lastTwoWeeks[1] + " Tracked", "2-wk Total (hrs)", "Milestones", "Planned Wks", "Consistency"],
      function(e) { return [e.name, r1f(e.w1), r1f(e.w2), r1f(e.twoWkTracked), e.milestones, e.plannedCount, consistencySignal(e)]; },
      t1End + 2
    );

    // ── Table 3: Top 10 by Planned Ahead (future weeks) ───────────────────
    var byPlanned = empEntries
      .filter(function(e) { return e.plannedCount > 0; })
      .sort(function(a, b) { return b.plannedCount !== a.plannedCount ? b.plannedCount - a.plannedCount : b.milestones - a.milestones; });

    var t3End = writeTop10Table_(
      "📅 TOP 10 — Planned Ahead (Next 2+ Weeks)",
      byPlanned,
      ["Rank", "Contributor", "Planned Wks", "Weeks Planned", "Milestones", "2-wk Tracked", "", "Consistency"],
      function(e) { return [e.name, e.plannedCount, e.plannedWeeks.join(", ") || "—", e.milestones, r1f(e.twoWkTracked), "", consistencySignal(e)]; },
      t2End + 2
    );

    sheet.setColumnWidth(1, 60);   // Rank
    sheet.setColumnWidth(2, 220);  // Contributor
    sheet.setColumnWidth(3, 130);  // col 3 varies per table
    sheet.setColumnWidth(4, 130);  // col 4
    sheet.setColumnWidth(5, 130);  // col 5
    sheet.setColumnWidth(6, 110);  // col 6
    sheet.setColumnWidth(7, 100);  // col 7
    sheet.setColumnWidth(8, 320);  // Consistency

    // ── Footer — written once, after all three tables ────────────────────
    var footRow = t3End + 2;
    sheet.getRange(footRow, 1, 1, 2).setValues([["Generated:", fmtDateTime_(new Date())]]);
    if (windowStr) {
      sheet.getRange(footRow + 1, 1, 1, 2).setValues([["Window:", windowStr]]);
    }
    sheet.getRange(footRow, 1, 2, 1).setFontColor(COLORS.VOID_BLUE).setFontWeight("bold")
      .setFontStyle("italic").setFontSize(9);
    sheet.getRange(footRow, 2, 2, 1).setFontColor("#5f6368").setFontStyle("italic").setFontSize(9);

    Logger.log("⏱️ Tempo sections written. Trend at row " + startRow
      + ". Tables at rows " + tableStart + " / " + (t1End + 2) + " / " + (t2End + 2)
      + ". Weeks (tracked): " + lastTwoWeeks.join(", "));
  }


  // ── SECTION: TOP PERFORMERS ───────────────────────────────────

  /**
   * Writes the "Top Performers" tab — behaviour-led recognition, not volume ranking.
   *
   * Anchor phrase (lead line of the tab):
   *   "We recognise how the work gets done, not just how much."
   *
   * Sections (top → bottom):
   *   🏅 Consistency Champions — cadence & repeatability (Leadership 9.5, 10.1)
   *   🎯 Committed Delivery — dependability / decisive (10.1, 7.2)
   *   🧭 Epic Stewards — vision & coherent strategy (1.1, 8.6)
   *   🧠 Deep Work & Focus — sustained engagement on complex initiatives
   *
   * Each section shows top 5.
   * Every section carries a 📏 "How this is measured" + 🗣️ "How to recognise it"
   * box so execs have the evaluation criteria and recognition language in hand.
   * Scope: Company-wide.
   */
  function writeTopPerformersSheet_(weeklyData, weeks, activeWIP) {
    var sheet = jb_getOrCreateSheet_(CONFIGJ.TOP_SHEET);
    sheet.clearContents();
    sheet.clearFormats();

    var labels = weeks.map(function(w) { return w.label; });
    var scopes = ["Company", "R&D", "Customer"];

    // ── Tallies ─────────────────────────────────────────────────
    // tally[scope][label][name] = count of Done tasks
    var tally = {};
    // weeksActive[name] = Set of week labels where the person closed ≥1 Done task (company-wide)
    var weeksActive = {};
    // committedDelivery[scope][name] = count of items with Due Date that were resolved on/before it
    var committed = {};
    // epicCounts[scope][name] = count of Done Epics
    var epicCounts = {};

    scopes.forEach(function(sc) {
      tally[sc] = {};
      committed[sc] = {};
      epicCounts[sc] = {};
      labels.forEach(function(l) { tally[sc][l] = {}; });
    });

    function bumpName(bucket, scope, label, name) {
      if (label) { // Weekly bucketing
        if (!bucket[scope][label][name]) bucket[scope][label][name] = 0;
        bucket[scope][label][name]++;
      } else { // Flat bucketing (like Epic counts)
        if (!bucket[scope][name]) bucket[scope][name] = 0;
        bucket[scope][name]++;
      }
    }

    (weeklyData || []).forEach(function(weekGroup) {
      (weekGroup.issues || []).forEach(function(issue) {
        var f = issue.fields || {};
        var resName = (f.resolution && f.resolution.name) ? f.resolution.name : "";
        if (String(resName).toLowerCase() !== "done") return;

        var resolved = f.resolutiondate ? new Date(f.resolutiondate) : null;
        if (!resolved) return;

        var targetLabel = null;
        for (var i = 0; i < weeks.length; i++) {
          if (resolved >= weeks[i].from && resolved <= weeks[i].to) {
            targetLabel = weeks[i].label;
            break;
          }
        }
        if (!targetLabel) return;

        var rawName = dig_(f, "assignee.displayName");
        if (!rawName) return;
        var name = normalizeToRoster_(rawName);
        var space = getSpaceForIssue_(issue);
        var typeName = String(dig_(f, "issuetype.name") || "").toLowerCase();
        var isEpic = typeName.indexOf("epic") !== -1;
        var due = f.duedate ? new Date(f.duedate) : null;

        // Base tally — weekly counts for Weekly Trend + Monthly Rollup.
        bumpName(tally, "Company", targetLabel, name);
        if (tally[space]) bumpName(tally, space, targetLabel, name);

        // Consistency: record which weeks the person was active.
        if (!weeksActive[name]) weeksActive[name] = {};
        weeksActive[name][targetLabel] = true;

        // Committed Delivery: had a Due Date and landed on/before it.
        if (due && resolved <= due) {
          if (!committed["Company"][name]) committed["Company"][name] = 0;
          committed["Company"][name]++;
          if (committed[space]) {
            if (!committed[space][name]) committed[space][name] = 0;
            committed[space][name]++;
          }
        }

        // Epic Stewards: Rank by count of Done Epics
        if (isEpic) {
          bumpName(epicCounts, "Company", null, name);
          if (epicCounts[space]) bumpName(epicCounts, space, null, name);
        }
      });
    });

    // ── Deep Work (Active WIP) Analysis ─────────────────────────
    var wipCounts = {};
    (activeWIP || []).forEach(function(issue) {
      var rawName = dig_(issue.fields, "assignee.displayName");
      if (!rawName) return;
      var name = normalizeToRoster_(rawName);
      wipCounts[name] = (wipCounts[name] || 0) + 1;
    });

    // ── Query helper ───────────────────────────────────────────
    function topNFlat(obj, n) {
      return Object.keys(obj)
        .map(function(k) { return [k, obj[k]]; })
        .sort(function(a, b) { return b[1] - a[1] || a[0].localeCompare(b[0]); })
        .slice(0, n);
    }

    // Consistency: for each person, weeks present + total Done count (company-wide).
    // Qualifier: present in ≥ ceil(weeks/2)+1 of the window (i.e. majority + 1).
    var minWeeksForConsistency = Math.min(labels.length, Math.max(3, Math.ceil(labels.length * 0.75)));
    var consistency = Object.keys(weeksActive).map(function(name) {
      var wks = Object.keys(weeksActive[name]).length;
      var totalDone = 0;
      labels.forEach(function(l) { totalDone += (tally["Company"][l][name] || 0); });
      return { name: name, weeks: wks, total: totalDone };
    })
      .filter(function(r) { return r.weeks >= minWeeksForConsistency; })
      .sort(function(a, b) {
        if (b.weeks !== a.weeks) return b.weeks - a.weeks;
        if (b.total !== a.total) return b.total - a.total;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 10);

    // Epic Stewards: Top closed Epics
    var topEpics = topNFlat(epicCounts["Company"] || {}, 5);

    // Deep Work & Focus: Top In-Progress count (excluding those who just close tiny tickets)
    var deepWorkTop = topNFlat(wipCounts, 5);

    // ── Build rows ─────────────────────────────────────────────
    var rows = [];
    var sectionIdxs = [];
    var subheaderIdxs = [];
    var explainerIdxs = [];
    var anchorIdx = -1;
    var NUM_COLS = 6;

    function pad(arr, len) {
      while (arr.length < len) arr.push("");
      return arr;
    }
    function sectionRow(title) {
      sectionIdxs.push(rows.length);
      return pad([title], NUM_COLS);
    }
    function subheaderRow(cells) {
      subheaderIdxs.push(rows.length);
      return pad(cells.slice(), NUM_COLS);
    }
    function explainerRow(text) {
      explainerIdxs.push(rows.length);
      return pad([text], NUM_COLS);
    }

    // Title + anchor phrase + 3-bullet explainer.
    rows.push(pad(["🏆 TOP PERFORMERS"], NUM_COLS));
    anchorIdx = rows.length;
    rows.push(pad(['"We recognise how the work gets done, not just how much."'], NUM_COLS));
    rows.push(pad([""], NUM_COLS));
    rows.push(explainerRow("📖 How to read this tab"));
    rows.push(explainerRow("• Each section below surfaces a specific behaviour aligned with ServiceRocket Leadership Behaviors. The box under each heading shows exactly how people are evaluated."));
    rows.push(explainerRow("• A missing estimate or missing time log does NOT disqualify anyone. Consistent contributors are consistent contributors — full stop."));
    rows.push(explainerRow("• Scope: Company-wide across the last " + labels.length + " weeks. All recognitions show top 5."));
    rows.push(pad([""], NUM_COLS));

    // Helper: renders the "How this is measured / How to recognise" box that sits
    // under every section header. This is what execs cite when appraising someone.
    function metricBox(measured, recognise) {
      rows.push(explainerRow("📏 How this is measured: " + measured));
      rows.push(explainerRow("🗣️ How to recognise it: " + recognise));
    }

    // ── Recognition 1: Consistency Champions ───────────────────
    rows.push(sectionRow("🏅 CONSISTENCY CHAMPIONS"));
    metricBox(
      "Lego Signal (Reliability): Weeks where the person closed ≥1 Done task, contributing to Net Value Delivered. Qualifier: active in ≥" + minWeeksForConsistency + " weeks.",
      "\"Master of cadence and repeatability — shows up week after week.\" Leadership Behaviors 9.5 (Master of cadence and repeatability) and 10.1 (Dependable)."
    );
    rows.push(subheaderRow(["Rank", "Rocketeer", "Weeks Active", "Total Done (context)", "", ""]));
    if (consistency.length === 0) {
      rows.push(pad(["—", "No one met the consistency threshold in this window.", "", "", "", ""], NUM_COLS));
    } else {
      consistency.slice(0, 5).forEach(function(r, i) {
        rows.push(pad([i + 1, r.name, r.weeks + " / " + labels.length, r.total], NUM_COLS));
      });
    }
    rows.push(pad([""], NUM_COLS));

    // ── Recognition 2: Committed Delivery ──────────────────────
    rows.push(sectionRow("🎯 COMMITTED DELIVERY"));
    metricBox(
      "Lego Signal (Planning Reliability & Availability): Count of Revenue Protection Events (RPEs) resolved on or before their committed Due Date.",
      "\"Keeps commitments. Decisive — the team can count on their dates.\" Leadership Behaviors 10.1 (Dependable and communicates effectively) and 7.2 (Efficient at decision making)."
    );
    rows.push(subheaderRow(["Rank", "Rocketeer", "On-Time Deliveries", "", "", ""]));
    var committedTop = topNFlat(committed["Company"] || {}, 5);
    if (committedTop.length === 0) {
      rows.push(pad(["—", "No on-time committed deliveries in this window.", "", "", "", ""], NUM_COLS));
    } else {
      committedTop.forEach(function(entry, i) {
        rows.push(pad([i + 1, entry[0], entry[1]], NUM_COLS));
      });
    }
    rows.push(pad([""], NUM_COLS));

    // ── Recognition 3: Epic Stewards ───────────────────────────
    rows.push(sectionRow("🧭 EPIC STEWARDS"));
    metricBox(
      "Duplo Signal (Throughput): Count of Epics closed with Resolution = 'Done'. Epics are the largest unit of Net Value Delivered and drive revenue.",
      "\"Stewards larger initiatives — articulates vision and integrates work into a coherent strategy.\" Leadership Behaviors 1.1 (Articulates a vision aligned with Company, Customers and Rocketeers) and 8.6 (Integrates multiple streams of information into a coherent strategy)."
    );
    rows.push(subheaderRow(["Rank", "Rocketeer", "Epics Closed", "", "", ""]));
    if (topEpics.length === 0) {
      rows.push(pad(["—", "No Epics were closed in this window.", "", "", "", ""], NUM_COLS));
    } else {
      topEpics.forEach(function(entry, i) {
        rows.push(pad([i + 1, entry[0], entry[1]], NUM_COLS));
      });
    }
    rows.push(pad([""], NUM_COLS));

    // ── Recognition 4: Deep Work & Focus ───────────────────────
    rows.push(sectionRow("🧠 DEEP WORK & FOCUS"));
    metricBox(
      "Duplo Signal (Active Engagement): Count of high-value items currently 'In Progress'. Measures sustained effort on complex or long-running initiatives.",
      "\"Maintains focus on the big picture. Handles complexity without getting distracted by noise.\" Leadership Behaviors 8.6 (Integrates streams of info into a coherent strategy) and 9.4 (Focuses on the most impactful work)."
    );
    rows.push(subheaderRow(["Rank", "Rocketeer", "Items In-Progress", "", "", ""]));
    if (deepWorkTop.length === 0) {
      rows.push(pad(["—", "No Active In-Progress items found.", "", "", "", ""], NUM_COLS));
    } else {
      deepWorkTop.forEach(function(entry, i) {
        rows.push(pad([i + 1, entry[0], entry[1]], NUM_COLS));
      });
    }

    // ── Write + style ─────────────────────────────────────────
    sheet.getRange(1, 1, rows.length, NUM_COLS).setValues(rows);

    // Title
    sheet.getRange(1, 1, 1, NUM_COLS)
      .merge()
      .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM)
      .setFontWeight("bold").setFontSize(14).setHorizontalAlignment("center");

    // Anchor phrase — larger, June accent, centered, italic.
    if (anchorIdx >= 0) {
      sheet.getRange(anchorIdx + 1, 1, 1, NUM_COLS)
        .merge()
        .setBackground(COLORS.LIGHT_CREAM).setFontColor(COLORS.VOID_BLUE)
        .setFontWeight("bold").setFontStyle("italic").setFontSize(12)
        .setHorizontalAlignment("center");
    }

    // Explainer rows — style depends on content:
    //   "📖 How to read this tab" → Ivory header
    //   "📏 How this is measured" / "🗣️ How to recognise it" → Ivory metric box (bold)
    //   anything else → cream italic body
    explainerIdxs.forEach(function(idx) {
      var cellVal = String(rows[idx][0] || "");
      var range = sheet.getRange(idx + 1, 1, 1, NUM_COLS).merge();
      if (cellVal.indexOf("📖") === 0) {
        range.setBackground(COLORS.IVORY).setFontWeight("bold").setFontColor(COLORS.VOID_BLUE);
      } else if (cellVal.indexOf("📏") === 0 || cellVal.indexOf("🗣️") === 0) {
        range.setBackground(COLORS.IVORY).setFontColor(COLORS.VOID_BLUE)
          .setFontWeight("bold").setWrap(true);
      } else {
        range.setBackground(COLORS.LIGHT_CREAM).setFontColor("#333333").setFontStyle("italic");
      }
    });

    sectionIdxs.forEach(function(idx) {
      sheet.getRange(idx + 1, 1, 1, NUM_COLS)
        .merge()
        .setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM)
        .setFontWeight("bold");
    });
    subheaderIdxs.forEach(function(idx) {
      sheet.getRange(idx + 1, 1, 1, NUM_COLS)
        .setBackground(COLORS.IVORY).setFontWeight("bold");
    });

    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 80);   // Rank / Epic Key
    sheet.setColumnWidth(2, 220);  // Rocketeer / Assignee
    sheet.setColumnWidth(3, 180);  // Weeks / Spaces / Count / Space
    sheet.setColumnWidth(4, 360);  // Total Done / Summary
    sheet.setColumnWidth(5, 80);
    sheet.setColumnWidth(6, 80);

    // Footer
    var foot = rows.length + 2;
    sheet.getRange(foot, 1, 1, 2).setValues([["Generated:", fmtDateTime_(new Date())]]);
    sheet.getRange(foot + 1, 1, 1, 2).setValues([["Window:", weeks[0].fromStr + " → " + weeks[weeks.length - 1].toStr]]);
    sheet.getRange(foot, 1, 2, 1).setFontColor(COLORS.VOID_BLUE).setFontWeight("bold");

    Logger.log("✅ Top Performers sheet written.");
  }

  // ── SECTION: MAIN ENTRY POINT ─────────────────────────────────

  function runJiraEpicTracker() {
    try {
      Logger.log("🚀 Exec Contribution Tracker starting…");

      var weeks = getLastNWeeks_(CONFIGJ.WEEKS_BACK);
      Logger.log("📅 Week windows (" + weeks.length + " weeks):");
      weeks.forEach(function(w, i) {
        Logger.log("   Wk " + (i + 1) + ": " + w.fromStr + " → " + w.toStr);
      });

      // Broad fetch — all Done issues across all projects (original working approach)
      var allIssues = fetchJiraIssues_();

      // Active Engagement fetch (Phase 2)
      var activeWIP = fetchActiveWIP_();
      Logger.log("🛠️ Active WIP issues fetched: " + activeWIP.length);

      // Bucket by Resolution Date into weeks
      var weeklyData = weeks.map(function(week) {
        var issues = allIssues.filter(function(issue) {
          var completed = getCompletedDate_(issue);
          return completed && completed >= week.from && completed <= week.to;
        });
        Logger.log("   " + week.label + ": " + issues.length + " completed issues");
        return { label: week.label, issues: issues };
      });

      Logger.log("📝 Writing 'Jira Raw' sheet...");
      writeRawSheet_(weeklyData);
      Logger.log("💾 Flushing 'Jira Raw'...");
      SpreadsheetApp.flush();

      Logger.log("📝 Writing 'Weekly Report' sheet...");
      writeReportSheet_(weeklyData, weeks);
      Logger.log("💾 Flushing 'Weekly Report'...");
      SpreadsheetApp.flush();

      // Exec Q&A — uses all weeks for trend context, but WoW compares last 2.
      Logger.log("📦 Fetching created issues for Exec window...");
      var createdIssues = fetchCreatedIssues_(weeks[0].fromStr, weeks[weeks.length-1].toStr);
      Logger.log("   Created issues fetched: " + createdIssues.length);

      Logger.log("📝 Writing 'Exec Q&A' sheet...");
      writeExecQASheet_(weeklyData, weeks, createdIssues, activeWIP);
      Logger.log("💾 Flushing 'Exec Q&A'...");
      SpreadsheetApp.flush();

      Logger.log("📝 Writing 'Top Performers' sheet...");
      writeTopPerformersSheet_(weeklyData, weeks, activeWIP);

      Logger.log("✅ Done. Check tabs: \"" + CONFIGJ.RAW_SHEET + "\", \""
        + CONFIGJ.REPORT_SHEET + "\", \"" + CONFIGJ.EXEC_SHEET
        + "\", \"" + CONFIGJ.TOP_SHEET + "\".");

    } catch (e) {
      Logger.log("❌ [runJiraEpicTracker] " + e.message);
      throw e;
    }
  }

  // ── SECTION: TEMPORARY DEBUG HELPER ─────────────────────────

  /**
   * TEMPORARY HELPER: runDebugRosterMatching()
   * Helps identify why the "Total Contributors" (Jira) and "Targeted ICs" (Roster) don't match.
   * Creates a "Debug Matching" sheet showing:
   *   1. People in the Targeted Roster with ZERO Jira activity (Idle/Mismatched).
   *   2. People with Jira activity who are NOT in the Targeted Roster (Wrong profile/Mismatched).
   *   3. All "Unassigned" tickets so you can go fix them in Jira.
   * Reads directly from the 'Jira Raw' sheet to save API calls.
   */
  function runDebugRosterMatching() {
    try {
      Logger.log("🔍 Starting Roster vs Jira Debug Matching...");
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      
      var rawSheet = ss.getSheetByName(CONFIGJ.RAW_SHEET);
      if (!rawSheet) {
        Logger.log("❌ 'Jira Raw' sheet not found. Please run the main report first.");
        return;
      }

      var sheetName = "Debug Matching";
      var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
      sheet.clear();

      // 1. Get Targeted Roster Names
      var rosterData = readTargetedRoster_();
      var targetedNames = Object.keys(rosterData.names);
      Logger.log("   Found " + targetedNames.length + " targeted names in Roster.");

      // 2. Get Jira Activity from 'Jira Raw' sheet
      var rawData = rawSheet.getDataRange().getValues();
      if (rawData.length <= 1) {
        Logger.log("❌ 'Jira Raw' sheet is empty.");
        return;
      }

      var headers = rawData[0];
      var assigneeIdx = headers.indexOf("Assignee");
      var keyIdx = headers.indexOf("Key");
      var summaryIdx = headers.indexOf("Work (Summary)");
      var statusIdx = headers.indexOf("Status");

      if (assigneeIdx === -1 || keyIdx === -1 || statusIdx === -1) {
        Logger.log("❌ Could not find necessary columns (Assignee, Key, Status) in 'Jira Raw'.");
        return;
      }

      var jiraActiveNames = {};
      var unassignedKeys = [];

      for (var i = 1; i < rawData.length; i++) {
        var row = rawData[i];
        var rawName = String(row[assigneeIdx] || "").trim();
        var key = row[keyIdx];
        var summary = row[summaryIdx];
        var status = String(row[statusIdx] || "").toLowerCase();
        
        // Determine if it's "Done" or "WIP" based on the fact that 'Jira Raw' currently only has Done items.
        // Note: If you want to debug WIP, you need to write WIP to a sheet first or fetch it.
        // For now, this just looks at the existing Done data.
        var type = "Done"; 

        if (!rawName || rawName === "Unassigned") {
          unassignedKeys.push(key + " (" + type + " - " + summary + ")");
          continue;
        }

        var normName = normalizeToRoster_(rawName);
        if (!jiraActiveNames[normName]) {
          jiraActiveNames[normName] = { rawName: rawName, types: [type] };
        } else {
          if (jiraActiveNames[normName].types.indexOf(type) === -1) {
            jiraActiveNames[normName].types.push(type);
          }
        }
      }

      // 3. Cross-reference
      var idleInRoster = targetedNames.filter(function(n) { return !jiraActiveNames[n]; });
      var activeNotInRoster = Object.keys(jiraActiveNames).filter(function(n) { return !rosterData.names[n]; });

      // 4. Output to Sheet
      var rows = [["Category", "Normalized Name (Matched)", "Raw Name (Jira)", "Activity Type / Details"]];

      idleInRoster.forEach(function(n) {
        rows.push(["🚨 Idle / Missing in Jira", n, "—", "In targeted roster, but 0 items found in Jira Raw."]);
      });

      activeNotInRoster.forEach(function(n) {
        var entry = jiraActiveNames[n];
        rows.push(["⚠️ Active / Not in Roster", n, entry.rawName, entry.types.join(" & ")]);
      });

      unassignedKeys.forEach(function(detail) {
        rows.push(["👻 Unassigned Issue", "—", "Unassigned", detail]);
      });

      sheet.getRange(1, 1, rows.length, 4).setValues(rows);
      sheet.getRange(1, 1, 1, 4).setBackground(COLORS.VOID_BLUE).setFontColor(COLORS.LIGHT_CREAM).setFontWeight("bold");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, 4);

      Logger.log("✅ Debug complete. Check the '" + sheetName + "' tab.");
    } catch (e) {
      Logger.log("❌ Debug Failed: " + e.message);
    }
  }

  // ── SECTION: UTILITIES ────────────────────────────────────────

  function testJiraConnection() {
    try {
      Logger.log("🔌 Testing Jira connection…");
      var issues = fetchJiraIssues_();
      if (issues.length > 0) {
        Logger.log("✅ Success — " + issues.length + " issues returned. Samples:");
        issues.slice(0, 3).forEach(function(issue) {
          Logger.log("   " + issue.key
            + " | " + (dig_(issue.fields, "status.name") || "?")
            + " | updated: " + fmtDateTime_(issue.fields.updated)
            + " | " + (issue.fields.summary || "").substring(0, 60));
        });
      } else {
        Logger.log("⚠️  Connection OK but 0 issues returned.");
        Logger.log("   Check: status names, issuetype names, LOOKBACK_DAYS = " + CONFIGJ.LOOKBACK_DAYS + ".");
      }
    } catch (e) {
      Logger.log("❌ [testJiraConnection] " + e.message);
    }
  }

  function previewWeekWindows() {
    var weeks = getLastNWeeks_(CONFIGJ.WEEKS_BACK);
    Logger.log("📅 Week windows (today = " + toShortDate_(new Date()) + "):");
    weeks.forEach(function(w, i) {
      Logger.log("   Week " + (i + 1) + ": " + w.fromStr + " → " + w.toStr + "  (" + w.label + ")");
    });
    Logger.log("📊 Exec Q&A will compare: Week " + (weeks.length - 1) + " vs Week " + weeks.length);
  }



  // ============================================================
  // 🔐  API KEY SETUP — Run setAPI__Jira() once to store your token
  // ============================================================



  function getAPI__Jira() {
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty("ADMIN_AC") !== "035X")
      throw new Error("❌ Access not permitted. Run setAPI__Jira() first.");
    const key = props.getProperty("API__Jira");
    if (!key) throw new Error("❌ Jira API token not found. Run setAPI__Jira() first.");
    return key;
  }

  // ============================================================
  // 🚀  GETTING STARTED
  // ============================================================
  // 1. Run setAPI__Jira()         → paste your Jira API token, run once, then clear it.
  //    Get a token at: https://id.atlassian.com/manage-profile/security/api-tokens
  //
  // 2. Confirm CONFIGJ.JIRA_EMAIL  → must match the account that owns the token.
  //
  // 3. Verify CONFIGJ.SPACES       → project keys must match your Jira instance.
  //
  // 4. Verify custom field IDs     → STORY_POINTS_FIELD, EPIC_LINK_FIELD.
  //    Discover yours at: https://servicerocket-coe.atlassian.net/rest/api/3/field
  //    If Story Points column is all 0 after first run, the field ID is wrong.
  //
  // 5. Run previewWeekWindows()   → verify the 3 week windows look correct in Logs.
  //
  // 6. Run testJiraConnection()   → should return sample issues with keys + summaries.
  //
  // 7. Run runJiraEpicTracker()   → writes "Jira Raw" + "Weekly Report" + "Exec Q&A".
  // ============================================================OINTS_FIELD, EPIC_LINK_FIELD.
  //    Discover yours at: https://servicerocket-coe.atlassian.net/rest/api/3/field
  //    If Story Points column is all 0 after first run, the field ID is wrong.
  //
  // 5. Run previewWeekWindows()   → verify the 3 week windows look correct in Logs.
  //
  // 6. Run testJiraConnection()   → should return sample issues with keys + summaries.
  //
  // 7. Run runJiraEpicTracker()   → writes "Jira Raw" + "Weekly Report" + "Exec Q&A".
  // ============================================================