// ============================================================
// SCRIPT NAME: Billable Contribution Weekly Summary
// PURPOSE:     Reads 'Billable Time' tab, aggregates ALL hours per employee
//              per week (split into Billable / Unbillable), and writes a rolling
//              summary to 'Contribution Summary' tab for AI (Rovo) consumption
//              and executive review.
// AUTHOR:
// CREATED:
// VERSION:     1.3.0
// ENVIRONMENT: Google Apps Script
// CHANGES v1.3.0:

//   - Connected Roster data to Signal Summary
//   - Added dimension breakdowns (Job Title, Level, Class, Location)
//   - Added Service Item analysis
//   - Added Consistent Contributors identification
// CHANGES v1.2.0:
//   - Now includes ALL rows (billable + unbillable) for full contribution view
//   - Hours split into Billable Hrs / Unbillable Hrs columns per week
//   - Billable column read as text "TRUE"/"FALSE" (not checkbox boolean)
//   - Added SUPERVISOR_APPROVAL_COL_INDEX to CONFIGB
//   - Email column fully removed
// ============================================================

// ============================================================
// ⚙️  CONFIGURATION — Edit values here before running
// ============================================================


const CONFIGB = {
  SCRIPT_LABEL:                  "Billable Contribution Summary",
  SOURCE_SHEET_NAME:             "Billable Time",
  SUMMARY_SHEET_NAME:            "Contribution Summary",
  SIGNAL_SUMMARY_SHEET_NAME:     "Signal Summary",

  // Billable Time column indices (0-based)
  DATE_COL_INDEX:                5,   // column F
  ENTITY_ID_COL_INDEX:           2,   // column C  (employee name)
  JOB_TITLE_COL_INDEX:           3,   // column D
  DURATION_COL_INDEX:            13,  // column N
  BILLABLE_COL_INDEX:            11,  // column L  (text: "TRUE" / "FALSE")
  SUPERVISOR_APPROVAL_COL_INDEX: 12,  // column M  (text: "TRUE" / "FALSE")
  PROJECT_TYPE_COL_INDEX:        14,  // column O
  SERVICE_ITEM_COL_INDEX:        10,  // column K
  CUSTOMER_PROJECT_COL:          6,   // column G
  HEADER_ROW:                    1,   // 1-based row number of headers in source sheet

  // Roster — active employees only (separate spreadsheet)
  ROSTER_SPREADSHEET_ID:         "1n6x9Hj9FH5CcCQhhJnD-vCTMpk-D1u0ntnYYqHI-Bp0",
  ROSTER_SHEET_NAME:             "Roster",
  // Roster column indices (0-based): Internal ID | Employee Number | Name | Employee Status |
  //   Supervisor | Job Title | Key Location | Job Profile Category | Class | Hire Date | Department | Level
  ROSTER_INTERNAL_ID_COL:        0,   // Internal ID
  ROSTER_EMPLOYEE_NUMBER_COL:    1,   // Employee Number
  ROSTER_NAME_COL:               2,   // Name (Employee Name)
  ROSTER_STATUS_COL:             3,   // Employee Status
  ROSTER_SUPERVISOR_COL:         4,   // Supervisor
  ROSTER_JOB_TITLE_COL:          5,   // Job Title
  ROSTER_LOCATION_COL:           6,   // Key Location
  ROSTER_JOB_PROFILE_CAT_COL:    7,   // Job Profile Category
  ROSTER_CLASS_COL:              8,   // Class
  ROSTER_HIRE_DATE_COL:          9,   // Hire Date
  ROSTER_DEPARTMENT_COL:         10,  // Department
  ROSTER_LEVEL_COL:              11,  // Level

  // Week configuration — script auto-calculates last completed Mon–Sun week
  USE_MANUAL_DATE_RANGE:         false,
  MANUAL_WEEK_START:             "2026-03-23",  // YYYY-MM-DD — only if USE_MANUAL_DATE_RANGE = true
  MANUAL_WEEK_END:               "2026-03-29",  // YYYY-MM-DD — only if USE_MANUAL_DATE_RANGE = true

  // Project types to include (leave empty [] to include all)
  INCLUDE_PROJECT_TYPES:         ["Consulting", "Managed Service"],

  // Minimum billable hours per week to qualify as a consistent contributor
  CONSISTENT_CONTRIBUTOR_THRESHOLD: 20,
};


// ============================================================
// ── SECTION: HELPERS ─────────────────────────────────────────
// ============================================================

/**
 * Returns the start (Monday) and end (Sunday) of the last fully completed week.
 * @returns {{ start: Date, end: Date, label: string }}
 */
function getLastCompletedWeekRange_() {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysSinceSunday = dayOfWeek === 0 ? 7 : dayOfWeek;
  const lastSunday = new Date(today);
  lastSunday.setDate(today.getDate() - daysSinceSunday);
  lastSunday.setHours(23, 59, 59, 0);
  const lastMonday = new Date(lastSunday);
  lastMonday.setDate(lastSunday.getDate() - 6);
  lastMonday.setHours(0, 0, 0, 0);
  const label = formatDateLabel_(lastMonday) + " – " + formatDateLabel_(lastSunday);
  return { start: lastMonday, end: lastSunday, label: label };
}

/**
 * Returns the start (Monday) and end (Sunday) for the week PRIOR to the last completed week.
 * @returns {{ start: Date, end: Date, label: string }}
 */
function getPreviousWeekRange_() {
  const lastWeek = getLastCompletedWeekRange_();
  const prevSunday = new Date(lastWeek.start);
  prevSunday.setDate(lastWeek.start.getDate() - 1);
  prevSunday.setHours(23, 59, 59, 0);
  const prevMonday = new Date(prevSunday);
  prevMonday.setDate(prevSunday.getDate() - 6);
  prevMonday.setHours(0, 0, 0, 0);
  const label = formatDateLabel_(prevMonday) + " – " + formatDateLabel_(prevSunday);
  return { start: prevMonday, end: prevSunday, label: label };
}

/**
 * Formats a Date as "Mar 23, 2026".
 * @param {Date} date
 * @returns {string}
 */
function formatDateLabel_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "MMM d, yyyy");
}

/**
 * Formats a Date as "YYYY-MM-DD" for use as a unique column key.
 * @param {Date} date
 * @returns {string}
 */
function formatWeekKey_(startDate) {
  return Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * Parses a date string "M/D/YYYY" into a Date object.
 * @param {string|Date} value
 * @returns {Date|null}
 */
function parseDate_(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const str = String(value).trim();
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    return new Date(parseInt(match[3], 10), parseInt(match[1], 10) - 1, parseInt(match[2], 10));
  }
  const fallback = new Date(str);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Converts a raw Duration value to decimal hours.
 *
 * Google Sheets time cells come back from getValues() as Date objects:
 *   "6:00:00 AM"  → getHours()=6                  → 6.0 hrs
 *   "2:30:00 PM"  → getHours()=14, getMinutes()=30 → 14.5 hrs
 *
 * Also handles:
 *   - Numeric fractions < 1  (e.g. 0.25 = 6 hrs — Sheets day fraction)
 *   - Plain decimal hours >= 1 (e.g. 2.5 = 2.5 hrs)
 *
 * @param {*} rawDuration
 * @returns {number}
 */
function durationToHours_(rawDuration) {
  if (rawDuration === null || rawDuration === undefined || rawDuration === "") return 0;
  if (rawDuration instanceof Date) {
    return rawDuration.getHours()
         + rawDuration.getMinutes() / 60
         + rawDuration.getSeconds() / 3600;
  }
  const num = parseFloat(rawDuration);
  if (isNaN(num)) return 0;
  return num < 1 ? num * 24 : num;
}

/**
 * Parses a text "TRUE"/"FALSE" cell (or real boolean) into a JavaScript boolean.
 * Handles: true, "TRUE", "true", "Yes", "1" → true. Everything else → false.
 * @param {*} value
 * @returns {boolean}
 */
function parseBoolean_(value) {
  if (value === true) return true;
  const str = String(value).trim().toLowerCase();
  return str === "true" || str === "yes" || str === "1";
}

/**
 * Checks if a date falls within [startDate, endDate] inclusive.
 * @param {Date} date
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {boolean}
 */
function isInWeek_(date, startDate, endDate) {
  if (!date) return false;
  const d = date.getTime();
  return d >= startDate.getTime() && d <= endDate.getTime();
}

/**
 * Normalizes Project Type for comparison (trims whitespace).
 * @param {*} rawType
 * @returns {string}
 */
function normalizeProjectType_(rawType) {
  return String(rawType || "").trim();
}


// ============================================================
// ── SECTION: CORE LOGIC ──────────────────────────────────────
// ============================================================

/**
 * Reads all rows from the 'Billable Time' source sheet.
 * Returns structured row objects including isBillable and supervisorApproval booleans.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Array<Object>}
 */
function readSourceRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= CONFIGB.HEADER_ROW) {
    Logger.log("⚠️ [readSourceRows_] No data rows found in source sheet.");
    return [];
  }
  const dataRange = sheet.getRange(CONFIGB.HEADER_ROW + 1, 1, lastRow - CONFIGB.HEADER_ROW, sheet.getLastColumn());
  const values = dataRange.getValues();

  return values.map((row, i) => ({
    rowIndex:           i + CONFIGB.HEADER_ROW + 2,
    entityId:           String(row[CONFIGB.ENTITY_ID_COL_INDEX] || "").trim(),
    jobTitle:           String(row[CONFIGB.JOB_TITLE_COL_INDEX] || "").trim(),
    date:               parseDate_(row[CONFIGB.DATE_COL_INDEX]),
    customerProj:       String(row[CONFIGB.CUSTOMER_PROJECT_COL] || "").trim(),
    serviceItem:        String(row[CONFIGB.SERVICE_ITEM_COL_INDEX] || "").trim(),
    isBillable:         parseBoolean_(row[CONFIGB.BILLABLE_COL_INDEX]),
    supervisorApproval: parseBoolean_(row[CONFIGB.SUPERVISOR_APPROVAL_COL_INDEX]),
    duration:           durationToHours_(row[CONFIGB.DURATION_COL_INDEX]),
    projectType:        normalizeProjectType_(row[CONFIGB.PROJECT_TYPE_COL_INDEX]),
  }));
}

/**
 * Filters source rows to those that fall in the given week range.
 * Includes ALL rows regardless of billable flag — full contribution view.
 * Optionally filters by Project Type if CONFIGB.INCLUDE_PROJECT_TYPES is not empty.
 * @param {Array<Object>} rows
 * @param {Date} weekStart
 * @param {Date} weekEnd
 * @returns {Array<Object>}
 */
function filterRowsForWeek_(rows, weekStart, weekEnd) {
  return rows.filter(row => {
    if (!isInWeek_(row.date, weekStart, weekEnd)) return false;
    if (CONFIGB.INCLUDE_PROJECT_TYPES.length > 0) {
      const typeMatch = CONFIGB.INCLUDE_PROJECT_TYPES.some(
        t => t.toLowerCase() === row.projectType.toLowerCase()
      );
      if (!typeMatch) return false;
    }
    return true;
  });
}

/**
 * Aggregates hours by employee for a set of filtered rows.
 * Hours are split into billableHours and unbillableHours based on the Billable column.
 *
 * Returns a map:
 *   { entityId -> { billableHours, unbillableHours, totalHours, uniqueProjects } }
 *
 * @param {Array<Object>} filteredRows
 * @returns {Object}
 */
function aggregateByEmployee_(filteredRows) {
  const map = {};
  filteredRows.forEach(row => {
    const key = row.entityId || "Unknown";
    if (!map[key]) {
      map[key] = {
        entityId:        key,
        jobTitle:        row.jobTitle,
        billableHours:   0,
        unbillableHours: 0,
        totalHours:      0,
        uniqueProjects:  new Set(),
      };
    }
    if (row.isBillable) {
      map[key].billableHours += row.duration;
    } else {
      map[key].unbillableHours += row.duration;
    }
    map[key].totalHours += row.duration;
    if (row.customerProj) map[key].uniqueProjects.add(row.customerProj);
  });
  return map;
}

/**
 * Gets or creates the 'Contribution Summary' sheet.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSummarySheet_(ss) {
  let sheet = ss.getSheetByName(CONFIGB.SUMMARY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIGB.SUMMARY_SHEET_NAME);
    Logger.log(`✅ Created new sheet: ${CONFIGB.SUMMARY_SHEET_NAME}`);
  }
  return sheet;
}

/**
 * Returns the 1-based column index for a given week key in the summary sheet.
 * If the week does not yet exist, appends new columns and writes headers.
 *
 * Summary sheet structure:
 *   Row 1: "Employee Name" static + week keys (merged per 4-col block)
 *   Row 2: Week date-range labels (merged per block)
 *   Row 3: Sub-headers — Billable Hrs | Unbillable Hrs | Total Hrs | Unique Projects
 *   Row 4+: Employee data
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} summarySheet
 * @param {string} weekKey    ISO date string e.g. "2026-03-23"
 * @param {string} weekLabel  Human-readable e.g. "Mar 23, 2026 – Mar 29, 2026"
 * @returns {number} 1-based column index where this week's Billable Hrs begins
 */
function getOrCreateWeekColumn_(summarySheet, weekKey, weekLabel) {
  const STATIC_COLS   = 2; // Employee Name, Job Title
  const COLS_PER_WEEK = 4; // Billable Hrs | Unbillable Hrs | Total Hrs | Unique Projects

  if (summarySheet.getLastRow() === 0) {
    initSummarySheetHeaders_(summarySheet);
  }

  const keyRow  = 1;
  const lastCol = summarySheet.getLastColumn();

  // Search existing week key columns
  if (lastCol > STATIC_COLS) {
    const keyRowValues = summarySheet.getRange(keyRow, STATIC_COLS + 1, 1, lastCol - STATIC_COLS).getValues()[0];
    for (let c = 0; c < keyRowValues.length; c += COLS_PER_WEEK) {
      if (keyRowValues[c] === weekKey) {
        return STATIC_COLS + c + 1; // 1-based
      }
    }
  }

  // Week not found — append new week columns
  const startCol = lastCol + 1;

  summarySheet.getRange(keyRow, startCol).setValue(weekKey);
  try { summarySheet.getRange(keyRow, startCol, 1, COLS_PER_WEEK).merge(); } catch(e) {}

  summarySheet.getRange(2, startCol).setValue("📅 " + weekLabel);
  try { summarySheet.getRange(2, startCol, 1, COLS_PER_WEEK).merge(); } catch(e) {}

  summarySheet.getRange(3, startCol, 1, COLS_PER_WEEK).setValues([[
    "Billable Hrs", "Unbillable Hrs", "Total Hrs", "Unique Projects"
  ]]);

  styleWeekHeader_(summarySheet, startCol, COLS_PER_WEEK);

  Logger.log(`✅ [getOrCreateWeekColumn_] Added columns for week: ${weekLabel} at col ${startCol}`);
  return startCol;
}

/**
 * Writes static headers (rows 1–3) for the Employee Name column.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function initSummarySheetHeaders_(sheet) {
  sheet.getRange("A1:A2").merge().setValue("Employee Name");
  sheet.getRange("B1:B2").merge().setValue("Job Title");

  sheet.getRange(1, 1, 3, 2)
       .setBackground(COMPANY_COLORS.VOID_BLUE)
       .setFontColor("#FFFFFF")
       .setFontWeight("bold")
       .setFontSize(10)
       .setVerticalAlignment("middle")
       .setHorizontalAlignment("center");

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 250);
  sheet.setFrozenColumns(2);
  sheet.setFrozenRows(3);

  Logger.log("✅ [initSummarySheetHeaders_] Static headers initialized.");
}

/**
 * Applies brand styling to a new week header block.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} startCol  1-based start column
 * @param {number} numCols   columns in the week block
 */
function styleWeekHeader_(sheet, startCol, numCols) {
  sheet.getRange(1, startCol, 1, numCols)
       .setBackground(COMPANY_COLORS.VOID_BLUE)
       .setFontColor(COMPANY_COLORS.IVORY)
       .setFontSize(9)
       .setFontWeight("bold")
       .setHorizontalAlignment("center");

  sheet.getRange(2, startCol, 1, numCols)
       .setBackground(COMPANY_COLORS.ORBE_BLUE)
       .setFontColor("#FFFFFF")
       .setFontSize(10)
       .setFontWeight("bold")
       .setHorizontalAlignment("center");

  sheet.getRange(3, startCol, 1, numCols)
       .setBackground(COMPANY_COLORS.IVORY)
       .setFontColor(COMPANY_COLORS.VOID_BLUE)
       .setFontSize(9)
       .setFontWeight("bold")
       .setHorizontalAlignment("center");

  for (let c = 0; c < numCols; c++) {
    sheet.setColumnWidth(startCol + c, c === numCols - 1 ? 200 : 130);
  }
}

/**
 * Returns a map of existing employee rows in the summary sheet.
 * Key = entityId, Value = 1-based row number.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} summarySheet
 * @returns {Object}
 */
function getExistingEmployeeRows_(summarySheet) {
  const lastRow = summarySheet.getLastRow();
  const DATA_START_ROW = 4;
  const map = {};
  if (lastRow < DATA_START_ROW) return map;
  const names = summarySheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 1).getValues();
  names.forEach((rowArr, i) => {
    const name = String(rowArr[0]).trim();
    if (name) map[name] = DATA_START_ROW + i;
  });
  return map;
}

/**
 * Writes aggregated employee data for a given week into the summary sheet.
 * Columns written per week: Billable Hrs | Unbillable Hrs | Total Hrs | Unique Projects
 *
 * Colour coding on Total Hrs cell:
 *   Red    = 0 hrs
 *   Orange = < 20 hrs
 *   Yellow = 20–35 hrs
 *   Green  = 35+ hrs
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} summarySheet
 * @param {Object} aggregated    Output of aggregateByEmployee_()
 * @param {number} weekStartCol  1-based column where Billable Hrs lives for this week
 */
function writeWeekDataToSummary_(summarySheet, aggregated, weekStartCol) {
  const DATA_START_ROW = 4;
  const employeeRowMap = getExistingEmployeeRows_(summarySheet);

  Object.values(aggregated).forEach(emp => {
    let targetRow = employeeRowMap[emp.entityId];

    if (!targetRow) {
      targetRow = Math.max(summarySheet.getLastRow() + 1, DATA_START_ROW);
      summarySheet.getRange(targetRow, 1).setValue(emp.entityId);
      summarySheet.getRange(targetRow, 2).setValue(emp.jobTitle);
      summarySheet.getRange(targetRow, 1, 1, 2)
                  .setBackground(COMPANY_COLORS.LIGHT_CREAM)
                  .setFontColor(COMPANY_COLORS.VOID_BLUE)
                  .setFontWeight("bold");
      employeeRowMap[emp.entityId] = targetRow;
      Logger.log(`  ➕ New employee row added: ${emp.entityId} at row ${targetRow}`);
    }

    const billableHrs   = Math.round(emp.billableHours   * 100) / 100;
    const unbillableHrs = Math.round(emp.unbillableHours * 100) / 100;
    const totalHrs      = Math.round(emp.totalHours      * 100) / 100;
    const projectsList  = Array.from(emp.uniqueProjects).join(", ");

    summarySheet.getRange(targetRow, weekStartCol, 1, 4).setValues([[
      billableHrs, unbillableHrs, totalHrs, projectsList
    ]]);

    // Colour-code the Total Hrs cell (col offset +2)
    const totalCell = summarySheet.getRange(targetRow, weekStartCol + 2);
    if (totalHrs === 0) {
      totalCell.setBackground("#FFE0E0");  // red    — no hours at all
    } else if (totalHrs >= 35) {
      totalCell.setBackground("#D6F4E0");  // green  — strong week
    } else if (totalHrs >= 20) {
      totalCell.setBackground("#FFF9C4");  // yellow — partial week
    } else {
      totalCell.setBackground("#FFE0B2");  // orange — low hours
    }
  });

  Logger.log(`✅ [writeWeekDataToSummary_] Data written for ${Object.keys(aggregated).length} employees.`);
}

/**
 * Writes/overwrites the AI context block below the employee data.
 * Provides Rovo with metadata about the last run and week-over-week totals.
 */
function writeAiContextBlock_(summarySheet, lastWeekLabel, prevWeekLabel, totalEmployees, lastWeekHours, prevWeekHours) {
  const lastDataRow = summarySheet.getLastRow();
  const blockStart  = lastDataRow + 3;

  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, yyyy 'at' h:mm a z");
  const delta      = lastWeekHours - prevWeekHours;
  const deltaSign  = delta >= 0 ? "+" : "";
  const deltaLabel = `${deltaSign}${Math.round(delta * 10) / 10} hrs vs prior week`;

  const contextRows = [
    ["Weekly Contribution Intelligence", "", "", ""],
    ["Report Generated",  now,           "", ""],
    ["Current Week",      lastWeekLabel, "Total Hours",       Math.round(lastWeekHours * 10) / 10],
    ["Prior Week",        prevWeekLabel, "Total Hours",       Math.round(prevWeekHours * 10) / 10],
    ["Week-over-Week",    deltaLabel,    "Active Employees",  totalEmployees],
    ["Scope", "Includes all billable and unbillable hours for Consulting and Managed Service engagements. Hours are classified based on the Billable flag per entry. Performance thresholds — No Hours: Red | Below 20 hrs: Orange | 20–35 hrs: Yellow | 35+ hrs: Green.", "", ""],
  ];

  summarySheet.getRange(blockStart, 1, contextRows.length, 4).setValues(contextRows);
  
  // Unfreeze columns temporarily to allow the title merge across the boundary
  const frozenCols = summarySheet.getFrozenColumns();
  if (frozenCols > 0) summarySheet.setFrozenColumns(0);

  const titleBlock = summarySheet.getRange(blockStart, 1, 1, 4)
              .setBackground(COMPANY_COLORS.VOID_BLUE)
              .setFontColor("#FFFFFF")
              .setFontWeight("bold");
              
  // Merge within the frozen columns (1-2) and outside (3-4) separately to avoid boundary error
  try { summarySheet.getRange(blockStart, 1, 1, 2).merge(); } catch(e) {}
  try { summarySheet.getRange(blockStart, 3, 1, 2).merge(); } catch(e) {}
  
  // Restore frozen columns
  if (frozenCols > 0) summarySheet.setFrozenColumns(frozenCols);

  summarySheet.getRange(blockStart + 1, 1, contextRows.length - 1, 4)
              .setBackground(COMPANY_COLORS.LIGHT_CREAM)
              .setFontColor(COMPANY_COLORS.VOID_BLUE);

  Logger.log(`✅ [writeAiContextBlock_] AI context block written at row ${blockStart}.`);
}


// ============================================================
// ── SECTION: WEEK-OVER-WEEK COMPARISON TABLE ─────────────────
// ============================================================

/**
 * Writes a Week-over-Week comparison table below the AI context block.
 * Shows per employee: Billable Hrs (last vs prior, delta), Unbillable Hrs
 * (last vs prior, delta), Total Hrs delta, and a trend signal.
 *
 * Colour logic on delta cells:
 *   Billable   ↑ = green  | ↓ = red
 *   Unbillable ↑ = red    | ↓ = green  (more unbillable = worse)
 *   Total      ↑ = green  | ↓ = red
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} summarySheet
 * @param {Object} lastWeekAgg
 * @param {Object} prevWeekAgg
 * @param {string} lastWeekLabel
 * @param {string} prevWeekLabel
 */
function writeWoWComparisonTable_(summarySheet, lastWeekAgg, prevWeekAgg, lastWeekLabel, prevWeekLabel) {
  const lastDataRow = summarySheet.getLastRow();
  const blockStart  = lastDataRow + 3;

  // Unfreeze columns temporarily to allow titles to merge across column 2 boundary
  const frozenCols = summarySheet.getFrozenColumns();
  if (frozenCols > 0) summarySheet.setFrozenColumns(0);

  // ── Title row ────────────────────────────────────────────────
  const titleRange = summarySheet.getRange(blockStart, 1, 1, 8);
  titleRange.setBackground(COMPANY_COLORS.ORBE_BLUE)
            .setFontColor("#FFFFFF")
            .setFontWeight("bold")
            .setFontSize(11)
            .setHorizontalAlignment("center")
            .setVerticalAlignment("middle");

  summarySheet.getRange(blockStart, 1).setValue("Week-over-Week Comparison: " + prevWeekLabel + "  to  " + lastWeekLabel);
  
  // Merge within and outside boundary separately to avoid freezing error
  try { summarySheet.getRange(blockStart, 1, 1, 2).merge(); } catch(e) {}
  try { summarySheet.getRange(blockStart, 3, 1, 6).merge(); } catch(e) {}
  
  summarySheet.setRowHeight(blockStart, 30);

  // Restore frozen columns
  if (frozenCols > 0) summarySheet.setFrozenColumns(frozenCols);

  // ── Column headers ───────────────────────────────────────────
  const headers = [
    "Employee",
    "Prior Bill. Hrs",
    "Last Bill. Hrs",
    "Bill. Δ",
    "Prior Unbill. Hrs",
    "Last Unbill. Hrs",
    "Unbill. Δ",
    "Total Δ",
  ];
  const headerRow = blockStart + 1;
  summarySheet.getRange(headerRow, 1, 1, headers.length).setValues([headers])
              .setBackground(COMPANY_COLORS.VOID_BLUE)
              .setFontColor("#FFFFFF")
              .setFontWeight("bold")
              .setFontSize(9)
              .setHorizontalAlignment("center");

  // ── Collect all employees across both weeks ──────────────────
  const allEmployees = new Set([
    ...Object.keys(lastWeekAgg),
    ...Object.keys(prevWeekAgg),
  ]);

  let currentRow = headerRow + 1;

  // Sort alphabetically for readability
  const sorted = Array.from(allEmployees).sort((a, b) => a.localeCompare(b));

  sorted.forEach((name, idx) => {
    const last = lastWeekAgg[name] || { billableHours: 0, unbillableHours: 0, totalHours: 0 };
    const prev = prevWeekAgg[name] || { billableHours: 0, unbillableHours: 0, totalHours: 0 };

    const billPrev  = Math.round(prev.billableHours   * 100) / 100;
    const billLast  = Math.round(last.billableHours   * 100) / 100;
    const billDelta = Math.round((billLast - billPrev) * 100) / 100;

    const unbillPrev  = Math.round(prev.unbillableHours * 100) / 100;
    const unbillLast  = Math.round(last.unbillableHours * 100) / 100;
    const unbillDelta = Math.round((unbillLast - unbillPrev) * 100) / 100;

    const totalPrev  = Math.round(prev.totalHours * 100) / 100;
    const totalLast  = Math.round(last.totalHours * 100) / 100;
    const totalDelta = Math.round((totalLast - totalPrev) * 100) / 100;

    const rowBg = idx % 2 === 0 ? "#FFFFFF" : COMPANY_COLORS.LIGHT_CREAM;

    summarySheet.getRange(currentRow, 1, 1, 8).setValues([[
      name,
      billPrev,
      billLast,
      formatDelta_(billDelta),
      unbillPrev,
      unbillLast,
      formatDelta_(unbillDelta),
      formatDelta_(totalDelta),
    ]]).setBackground(rowBg)
       .setFontColor(COMPANY_COLORS.VOID_BLUE)
       .setFontSize(9)
       .setHorizontalAlignment("center");

    // Employee name — left-align + bold
    summarySheet.getRange(currentRow, 1)
                .setHorizontalAlignment("left")
                .setFontWeight("bold");

    // Colour-code Billable delta (col 4): ↑ green, ↓ red
    colorDeltaCell_(summarySheet.getRange(currentRow, 4), billDelta, false);

    // Colour-code Unbillable delta (col 7): ↑ red, ↓ green (inverted — more unbillable = worse)
    colorDeltaCell_(summarySheet.getRange(currentRow, 7), unbillDelta, true);

    // Colour-code Total delta (col 8): ↑ green, ↓ red
    colorDeltaCell_(summarySheet.getRange(currentRow, 8), totalDelta, false);

    currentRow++;
  });

  // ── Column widths ────────────────────────────────────────────
  summarySheet.setColumnWidth(1, 200);
  [2, 3, 4, 5, 6, 7, 8].forEach(c => summarySheet.setColumnWidth(c, 120));

  Logger.log(`✅ [writeWoWComparisonTable_] WoW table written for ${sorted.length} employees at row ${blockStart}.`);
}

/**
 * Formats a numeric delta as a signed string: "+3.5" or "-1.2" or "–"
 * @param {number} delta
 * @returns {string}
 */
function formatDelta_(delta) {
  if (delta === 0) return "–";
  return (delta > 0 ? "+" : "") + delta.toFixed(2);
}

/**
 * Applies background colour to a delta cell.
 * @param {GoogleAppsScript.Spreadsheet.Range} cell
 * @param {number} delta
 * @param {boolean} invertLogic  true = higher is worse (unbillable hours)
 */
function colorDeltaCell_(cell, delta, invertLogic) {
  if (delta === 0) {
    cell.setBackground("#F5F5F5").setFontColor("#888888");
    return;
  }
  const positive = delta > 0;
  const isGood   = invertLogic ? !positive : positive;

  if (isGood) {
    cell.setBackground("#D6F4E0").setFontColor("#1A6B35").setFontWeight("bold"); // green
  } else {
    cell.setBackground("#FFE0E0").setFontColor("#B71C1C").setFontWeight("bold"); // red
  }
}





// ============================================================
// ── SECTION: ROSTER INTEGRATION ──────────────────────────────
// ============================================================

/**
 * Reads all rows from the 'Roster' sheet (active employees only).
 * Returns an array of structured objects.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {Array<Object>}
 */
function readRosterRows_() {
  let rosterSs;
  try {
    rosterSs = SpreadsheetApp.openById(CONFIGB.ROSTER_SPREADSHEET_ID);
  } catch(e) {
    Logger.log("⚠️ [readRosterRows_] Could not open Roster spreadsheet (ID: " + CONFIGB.ROSTER_SPREADSHEET_ID + "): " + e.message);
    return [];
  }
  const sheet = rosterSs.getSheetByName(CONFIGB.ROSTER_SHEET_NAME);
  if (!sheet) {
    Logger.log("⚠️ [readRosterRows_] Tab '" + CONFIGB.ROSTER_SHEET_NAME + "' not found in Roster spreadsheet — proceeding without workforce attributes.");
    return [];
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  return values.map(row => ({
    internalId:      String(row[CONFIGB.ROSTER_INTERNAL_ID_COL]    || "").trim(),
    employeeNumber:  String(row[CONFIGB.ROSTER_EMPLOYEE_NUMBER_COL]|| "").trim(),
    name:            String(row[CONFIGB.ROSTER_NAME_COL]           || "").trim(),
    status:          String(row[CONFIGB.ROSTER_STATUS_COL]          || "").trim(),
    supervisor:      String(row[CONFIGB.ROSTER_SUPERVISOR_COL]       || "").trim(),
    jobTitle:        String(row[CONFIGB.ROSTER_JOB_TITLE_COL]        || "").trim(),
    location:        String(row[CONFIGB.ROSTER_LOCATION_COL]         || "").trim(),
    jobProfileCat:   String(row[CONFIGB.ROSTER_JOB_PROFILE_CAT_COL] || "").trim(),
    class_:          String(row[CONFIGB.ROSTER_CLASS_COL]            || "").trim(),
    hireDate:        row[CONFIGB.ROSTER_HIRE_DATE_COL],
    department:      String(row[CONFIGB.ROSTER_DEPARTMENT_COL]       || "").trim(),
    level:           String(row[CONFIGB.ROSTER_LEVEL_COL]            || "").trim(),
  })).filter(r => r.name !== "");
}

/**
 * Builds a lookup map from employee name to roster attributes.
 * @param {Array<Object>} rosterRows  Output of readRosterRows_()
 * @returns {Object}  { "Employee Name" -> { jobTitle, level, class_, location, supervisor, department } }
 */
function buildRosterMap_(rosterRows) {
  const map = {};
  rosterRows.forEach(r => { map[r.name] = r; });
  return map;
}

/**
 * Enriches aggregated employee data with roster attributes (level, class, location, supervisor).
 * Modifies the aggregated map in-place.
 * @param {Object} aggregated   Output of aggregateByEmployee_()
 * @param {Object} rosterMap    Output of buildRosterMap_()
 */
function enrichWithRoster_(aggregated, rosterMap) {
  Object.values(aggregated).forEach(emp => {
    const roster = rosterMap[emp.entityId];
    if (roster) {
      emp.internalId     = roster.internalId;
      emp.employeeNumber = roster.employeeNumber;
      emp.status         = roster.status;
      emp.jobProfileCat  = roster.jobProfileCat;
      emp.hireDate       = roster.hireDate;
      emp.level          = roster.level;
      emp.class_         = roster.class_;
      emp.location       = roster.location;
      emp.supervisor     = roster.supervisor;
      emp.department     = roster.department;
      // Prefer Roster job title as the authoritative source
      if (roster.jobTitle) emp.jobTitle = roster.jobTitle;
    } else {
      emp.internalId     = "";
      emp.employeeNumber = "";
      emp.status         = "";
      emp.jobProfileCat  = "";
      emp.hireDate       = "";
      emp.level          = "";
      emp.class_         = "";
      emp.location       = "";
      emp.supervisor     = "";
      emp.department     = "";
    }
  });
}

/**
 * Aggregates billable and unbillable hours by a given dimension (e.g. jobTitle, level, class_, location).
 * @param {Object} aggregated   Enriched output of aggregateByEmployee_()
 * @param {string} dimension    Property name on the employee object to group by
 * @returns {Array<Object>}     Sorted array of { label, billableHours, unbillableHours, totalHours, headcount }
 */
function aggregateByDimension_(aggregated, dimension) {
  const map = {};
  Object.values(aggregated).forEach(emp => {
    const key = emp[dimension] || "Unassigned";
    if (!map[key]) map[key] = { label: key, billableHours: 0, unbillableHours: 0, totalHours: 0, headcount: 0 };
    map[key].billableHours   += emp.billableHours;
    map[key].unbillableHours += emp.unbillableHours;
    map[key].totalHours      += emp.totalHours;
    map[key].headcount++;
  });
  return Object.values(map).sort((a, b) => b.billableHours - a.billableHours);
}

/**
 * Aggregates hours by Service Item across the given set of source rows.
 * @param {Array<Object>} filteredRows  Output of filterRowsForWeek_()
 * @returns {Object}  { serviceItem -> { billableHours, unbillableHours, totalHours } }
 */
function aggregateByServiceItem_(filteredRows) {
  const map = {};
  filteredRows.forEach(row => {
    const key = row.serviceItem || "Unspecified";
    if (!map[key]) map[key] = { label: key, billableHours: 0, unbillableHours: 0, totalHours: 0 };
    if (row.isBillable) {
      map[key].billableHours += row.duration;
    } else {
      map[key].unbillableHours += row.duration;
    }
    map[key].totalHours += row.duration;
  });
  return map;
}

/**
 * Identifies employees who logged billable hours at or above the threshold in BOTH weeks.
 * Returns an array sorted by last-week billable hours descending.
 * @param {Object} lastWeekAgg   Enriched aggregation for last week
 * @param {Object} prevWeekAgg   Enriched aggregation for prior week
 * @returns {Array<Object>}
 */
function identifyConsistentContributors_(lastWeekAgg, prevWeekAgg) {
  const threshold = CONFIGB.CONSISTENT_CONTRIBUTOR_THRESHOLD;
  const results = [];
  Object.values(lastWeekAgg).forEach(emp => {
    if (emp.billableHours < threshold) return;
    const prev = prevWeekAgg[emp.entityId];
    if (!prev || prev.billableHours < threshold) return;
    results.push({
      name:             emp.entityId,
      jobTitle:         emp.jobTitle   || "",
      level:            emp.level      || "",
      location:         emp.location   || "",
      lastBillable:     Math.round(emp.billableHours    * 100) / 100,
      prevBillable:     Math.round(prev.billableHours   * 100) / 100,
      billableDelta:    Math.round((emp.billableHours - prev.billableHours) * 100) / 100,
      lastTotal:        Math.round(emp.totalHours       * 100) / 100,
    });
  });
  return results.sort((a, b) => b.lastBillable - a.lastBillable);
}


// ============================================================
// ── SECTION: SIGNAL SUMMARY SHEET ────────────────────────────
// ============================================================

/**
 * Gets or creates the Signal Summary sheet and clears it for a fresh write.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSignalSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIGB.SIGNAL_SUMMARY_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIGB.SIGNAL_SUMMARY_SHEET_NAME);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
    // Unfreeze to allow header merges without error
    sheet.setFrozenColumns(0);
    sheet.setFrozenRows(0);
  }
  return sheet;
}

/**
 * Writes a section title row and returns the next available row.
 */
function writeSectionTitle_(sheet, row, title, numCols) {
  const range = sheet.getRange(row, 1, 1, numCols);
  range.merge()
       .setValue(title)
       .setBackground(COMPANY_COLORS.VOID_BLUE)
       .setFontColor("#FFFFFF")
       .setFontWeight("bold")
       .setFontSize(11)
       .setHorizontalAlignment("left")
       .setVerticalAlignment("middle");
  sheet.setRowHeight(row, 28);
  return row + 1;
}

/**
 * Writes a dimension breakdown table (Job Title / Level / Class / Location).
 * Columns: Group | Prior Bill. Hrs | Last Bill. Hrs | Bill. Delta |
 *          Prior Unbill. Hrs | Last Unbill. Hrs | Unbill. Delta | Headcount
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number}   startRow
 * @param {string}   sectionTitle     e.g. "Breakdown by Job Title"
 * @param {Array}    lastData         Output of aggregateByDimension_() for last week
 * @param {Array}    prevData         Output of aggregateByDimension_() for prior week
 * @param {string}   lastWeekLabel
 * @param {string}   prevWeekLabel
 * @returns {number} Next available row after this section
 */
function writeDimensionSection_(sheet, startRow, sectionTitle, lastData, prevData, lastWeekLabel, prevWeekLabel) {
  const NUM_COLS = 8;
  let row = writeSectionTitle_(sheet, startRow, sectionTitle, NUM_COLS);

  // Sub-header
  sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
    "Group",
    "Prior Bill. Hrs (" + prevWeekLabel + ")",
    "Current Bill. Hrs (" + lastWeekLabel + ")",
    "Billable Change",
    "Prior Unbill. Hrs",
    "Current Unbill. Hrs",
    "Unbillable Change",
    "Headcount",
  ]])
  .setBackground(COMPANY_COLORS.IVORY)
  .setFontColor(COMPANY_COLORS.VOID_BLUE)
  .setFontWeight("bold")
  .setFontSize(9)
  .setHorizontalAlignment("center");
  row++;

  // Build prev lookup
  const prevMap = {};
  prevData.forEach(d => { prevMap[d.label] = d; });

  // Merge all labels
  const allLabels = new Set([...lastData.map(d => d.label), ...Object.keys(prevMap)]);
  const sorted = Array.from(allLabels).sort((a, b) => {
    const aB = (lastData.find(d => d.label === a) || {}).billableHours || 0;
    const bB = (lastData.find(d => d.label === b) || {}).billableHours || 0;
    return bB - aB;
  });

  sorted.forEach((label, idx) => {
    const last = lastData.find(d => d.label === label) || { billableHours: 0, unbillableHours: 0, headcount: 0 };
    const prev = prevMap[label] || { billableHours: 0, unbillableHours: 0, headcount: 0 };

    const billLast  = Math.round(last.billableHours   * 100) / 100;
    const billPrev  = Math.round(prev.billableHours   * 100) / 100;
    const billDelta = Math.round((billLast - billPrev) * 100) / 100;

    const unbillLast  = Math.round(last.unbillableHours   * 100) / 100;
    const unbillPrev  = Math.round(prev.unbillableHours   * 100) / 100;
    const unbillDelta = Math.round((unbillLast - unbillPrev) * 100) / 100;

    const rowBg = idx % 2 === 0 ? "#FFFFFF" : COMPANY_COLORS.LIGHT_CREAM;
    sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
      label,
      billPrev,
      billLast,
      formatDelta_(billDelta),
      unbillPrev,
      unbillLast,
      formatDelta_(unbillDelta),
      last.headcount || prev.headcount,
    ]])
    .setBackground(rowBg)
    .setFontColor(COMPANY_COLORS.VOID_BLUE)
    .setFontSize(9)
    .setHorizontalAlignment("center");

    sheet.getRange(row, 1).setHorizontalAlignment("left").setFontWeight("bold");
    colorDeltaCell_(sheet.getRange(row, 4), billDelta, false);
    colorDeltaCell_(sheet.getRange(row, 7), unbillDelta, true);
    row++;
  });

  return row + 1; // spacer row
}

/**
 * Writes the Service Item week-over-week section.
 */
function writeServiceItemSection_(sheet, startRow, lastServiceMap, prevServiceMap, lastWeekLabel, prevWeekLabel) {
  const NUM_COLS = 7;
  let row = writeSectionTitle_(sheet, startRow, "Service Item Analysis — Week-over-Week", NUM_COLS);

  sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
    "Service Item",
    "Prior Bill. Hrs (" + prevWeekLabel + ")",
    "Current Bill. Hrs (" + lastWeekLabel + ")",
    "Billable Change",
    "Prior Total Hrs",
    "Current Total Hrs",
    "Total Change",
  ]])
  .setBackground(COMPANY_COLORS.IVORY)
  .setFontColor(COMPANY_COLORS.VOID_BLUE)
  .setFontWeight("bold")
  .setFontSize(9)
  .setHorizontalAlignment("center");
  row++;

  const allItems = new Set([...Object.keys(lastServiceMap), ...Object.keys(prevServiceMap)]);
  const sorted = Array.from(allItems).sort((a, b) => {
    return ((lastServiceMap[b] || {}).billableHours || 0) - ((lastServiceMap[a] || {}).billableHours || 0);
  });

  sorted.forEach((item, idx) => {
    const last = lastServiceMap[item] || { billableHours: 0, totalHours: 0 };
    const prev = prevServiceMap[item] || { billableHours: 0, totalHours: 0 };

    const billLast  = Math.round(last.billableHours * 100) / 100;
    const billPrev  = Math.round(prev.billableHours * 100) / 100;
    const billDelta = Math.round((billLast - billPrev) * 100) / 100;

    const totLast  = Math.round(last.totalHours * 100) / 100;
    const totPrev  = Math.round(prev.totalHours * 100) / 100;
    const totDelta = Math.round((totLast - totPrev) * 100) / 100;

    const rowBg = idx % 2 === 0 ? "#FFFFFF" : COMPANY_COLORS.LIGHT_CREAM;
    sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
      item, billPrev, billLast, formatDelta_(billDelta), totPrev, totLast, formatDelta_(totDelta),
    ]])
    .setBackground(rowBg)
    .setFontColor(COMPANY_COLORS.VOID_BLUE)
    .setFontSize(9)
    .setHorizontalAlignment("center");

    sheet.getRange(row, 1).setHorizontalAlignment("left").setFontWeight("bold");
    colorDeltaCell_(sheet.getRange(row, 4), billDelta, false);
    colorDeltaCell_(sheet.getRange(row, 7), totDelta, false);
    row++;
  });

  return row + 1;
}

/**
 * Writes the Consistent Contributors section — employees billing at or above
 * the threshold in both the current and prior week.
 */
function writeConsistentContributorsSection_(sheet, startRow, contributors) {
  const NUM_COLS = 7;
  let row = writeSectionTitle_(sheet, startRow,
    "Consistent Contributors — Employees billing " + CONFIGB.CONSISTENT_CONTRIBUTOR_THRESHOLD + "+ hrs in both weeks",
    NUM_COLS
  );

  if (contributors.length === 0) {
    sheet.getRange(row, 1, 1, NUM_COLS).merge()
         .setValue("No employees met the consistent contributor threshold for both weeks.")
         .setBackground(COMPANY_COLORS.LIGHT_CREAM)
         .setFontColor(COMPANY_COLORS.VOID_BLUE)
         .setFontSize(9)
         .setHorizontalAlignment("left");
    return row + 2;
  }

  sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
    "Employee", "Job Title", "Level", "Location",
    "Prior Bill. Hrs", "Current Bill. Hrs", "Billable Change",
  ]])
  .setBackground(COMPANY_COLORS.IVORY)
  .setFontColor(COMPANY_COLORS.VOID_BLUE)
  .setFontWeight("bold")
  .setFontSize(9)
  .setHorizontalAlignment("center");
  row++;

  contributors.forEach((c, idx) => {
    const rowBg = idx % 2 === 0 ? "#FFFFFF" : COMPANY_COLORS.LIGHT_CREAM;
    sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
      c.name, c.jobTitle, c.level, c.location,
      c.prevBillable, c.lastBillable, formatDelta_(c.billableDelta),
    ]])
    .setBackground(rowBg)
    .setFontColor(COMPANY_COLORS.VOID_BLUE)
    .setFontSize(9)
    .setHorizontalAlignment("center");

    sheet.getRange(row, 1).setHorizontalAlignment("left").setFontWeight("bold");
    colorDeltaCell_(sheet.getRange(row, 7), c.billableDelta, false);
    row++;
  });

  return row + 1;
}

/**
 * Writes the full Signal Summary sheet.
 * Sections: Org Summary | By Job Title | By Level | By Class | By Location |
 *           Service Item WoW | Consistent Contributors
 */
function writeSignalSummarySheet_(ss, lastWeekAgg, prevWeekAgg, lastWeekRows, prevWeekRows, lastWeekLabel, prevWeekLabel) {
  const sheet = getOrCreateSignalSheet_(ss);
  const NUM_COLS = 8;

  // ── Header banner ───────────────────────────────────────────
  const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMM d, yyyy 'at' h:mm a z");
  sheet.getRange(1, 1, 1, NUM_COLS).merge()
       .setValue("Workforce Productivity Signal Summary")
       .setBackground(COMPANY_COLORS.VOID_BLUE)
       .setFontColor("#FFFFFF")
       .setFontWeight("bold")
       .setFontSize(14)
       .setHorizontalAlignment("center")
       .setVerticalAlignment("middle");
  sheet.setRowHeight(1, 40);

  sheet.getRange(2, 1, 1, NUM_COLS).merge()
       .setValue("Period: " + prevWeekLabel + "  to  " + lastWeekLabel + "   |   Generated: " + now)
       .setBackground(COMPANY_COLORS.ORBE_BLUE)
       .setFontColor("#FFFFFF")
       .setFontSize(9)
       .setHorizontalAlignment("center");

  // ── Org-level summary ───────────────────────────────────────
  const lastTotalBill   = Object.values(lastWeekAgg).reduce((s, e) => s + e.billableHours,   0);
  const lastTotalUnbill = Object.values(lastWeekAgg).reduce((s, e) => s + e.unbillableHours, 0);
  const lastTotalHrs    = Object.values(lastWeekAgg).reduce((s, e) => s + e.totalHours,      0);
  const prevTotalBill   = Object.values(prevWeekAgg).reduce((s, e) => s + e.billableHours,   0);
  const prevTotalUnbill = Object.values(prevWeekAgg).reduce((s, e) => s + e.unbillableHours, 0);
  const prevTotalHrs    = Object.values(prevWeekAgg).reduce((s, e) => s + e.totalHours,      0);

  const billPct     = lastTotalHrs > 0 ? Math.round((lastTotalBill / lastTotalHrs) * 1000) / 10 : 0;
  const billPctPrev = prevTotalHrs > 0 ? Math.round((prevTotalBill / prevTotalHrs) * 1000) / 10 : 0;

  let row = 4;
  row = writeSectionTitle_(sheet, row, "Organization Summary", NUM_COLS);

  sheet.getRange(row, 1, 1, NUM_COLS).setValues([[
    "Metric",
    "Prior Week (" + prevWeekLabel + ")",
    "Current Week (" + lastWeekLabel + ")",
    "Change",
    "Billable %  (Current)",
    "Billable % (Prior)",
    "% Point Change",
    "Active Employees",
  ]])
  .setBackground(COMPANY_COLORS.IVORY)
  .setFontColor(COMPANY_COLORS.VOID_BLUE)
  .setFontWeight("bold")
  .setFontSize(9)
  .setHorizontalAlignment("center");
  row++;

  const summaryRows = [
    ["Billable Hours",   Math.round(prevTotalBill * 10) / 10,   Math.round(lastTotalBill * 10) / 10,
     formatDelta_(Math.round((lastTotalBill - prevTotalBill) * 10) / 10),
     billPct + "%", billPctPrev + "%",
     formatDelta_(Math.round((billPct - billPctPrev) * 10) / 10),
     Object.keys(lastWeekAgg).length],
    ["Unbillable Hours", Math.round(prevTotalUnbill * 10) / 10, Math.round(lastTotalUnbill * 10) / 10,
     formatDelta_(Math.round((lastTotalUnbill - prevTotalUnbill) * 10) / 10),
     "", "", "", ""],
    ["Total Hours",      Math.round(prevTotalHrs * 10) / 10,    Math.round(lastTotalHrs * 10) / 10,
     formatDelta_(Math.round((lastTotalHrs - prevTotalHrs) * 10) / 10),
     "", "", "", ""],
  ];

  summaryRows.forEach((dataRow, idx) => {
    const rowBg = idx % 2 === 0 ? "#FFFFFF" : COMPANY_COLORS.LIGHT_CREAM;
    sheet.getRange(row, 1, 1, NUM_COLS).setValues([dataRow])
         .setBackground(rowBg)
         .setFontColor(COMPANY_COLORS.VOID_BLUE)
         .setFontSize(9)
         .setHorizontalAlignment("center");
    sheet.getRange(row, 1).setHorizontalAlignment("left").setFontWeight("bold");
    
    // Extract raw delta for coloring
    let rawDelta = 0;
    if (dataRow[0] === "Billable Hours") rawDelta = lastTotalBill - prevTotalBill;
    else if (dataRow[0] === "Unbillable Hours") rawDelta = lastTotalUnbill - prevTotalUnbill;
    else if (dataRow[0] === "Total Hours") rawDelta = lastTotalHrs - prevTotalHrs;

    const invert = dataRow[0] === "Unbillable Hours";
    colorDeltaCell_(sheet.getRange(row, 4), rawDelta, invert);
    row++;
  });
  row++;

  // ── Dimension breakdowns ─────────────────────────────────────
  const dimensions = [
    { key: "jobTitle",   title: "Breakdown by Job Title"     },
    { key: "level",      title: "Breakdown by Level"         },
    { key: "class_",     title: "Breakdown by Class"         },
    { key: "location",   title: "Breakdown by Location"      },
  ];

  dimensions.forEach(dim => {
    const lastDim = aggregateByDimension_(lastWeekAgg, dim.key);
    const prevDim = aggregateByDimension_(prevWeekAgg, dim.key);
    row = writeDimensionSection_(sheet, row, dim.title, lastDim, prevDim, lastWeekLabel, prevWeekLabel);
  });

  // ── Service Item WoW ─────────────────────────────────────────
  const lastServiceMap = aggregateByServiceItem_(lastWeekRows);
  const prevServiceMap = aggregateByServiceItem_(prevWeekRows);
  row = writeServiceItemSection_(sheet, row, lastServiceMap, prevServiceMap, lastWeekLabel, prevWeekLabel);

  // ── Consistent Contributors ───────────────────────────────────
  const contributors = identifyConsistentContributors_(lastWeekAgg, prevWeekAgg);
  writeConsistentContributorsSection_(sheet, row, contributors);

  // ── Column widths ─────────────────────────────────────────────
  sheet.setColumnWidth(1, 220);
  [2, 3, 4, 5, 6, 7].forEach(c => sheet.setColumnWidth(c, 150));
  sheet.setColumnWidth(8, 120);
  sheet.setFrozenRows(2);

  Logger.log(`✅ [writeSignalSummarySheet_] Signal Summary written with ${contributors.length} consistent contributors.`);
}


// ============================================================
// ── SECTION: MAIN ENTRY POINT ────────────────────────────────
// ============================================================

/**
 * Main function — generates the weekly contribution summary.
 * Run manually or attach to a Monday 6 AM time-based trigger.
 *
 * What it does:
 *  1. Reads all rows from 'Billable Time' tab
 *  2. Determines last completed week (Mon–Sun) automatically
 *  3. Also evaluates the prior week for WoW comparison
 *  4. Aggregates ALL hours per employee, split into Billable / Unbillable
 *  5. Writes/updates rolling columns in 'Contribution Summary' tab
 *  6. Writes an AI context block for Rovo consumption
 */
function generateWeeklyContributionSummary() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('generateWeeklyContributionSummary');
  else Logger.log('⚠️ [generateWeeklyContributionSummary] requireMaintainer_ not in this project — running ungated.');
  try {
    Logger.log(`🚀 [generateWeeklyContributionSummary] Starting — ${CONFIGB.SCRIPT_LABEL}`);

    const ss          = SpreadsheetApp.getActiveSpreadsheet();
    const sourceSheet = ss.getSheetByName(CONFIGB.SOURCE_SHEET_NAME);
    if (!sourceSheet) throw new Error(`Source sheet '${CONFIGB.SOURCE_SHEET_NAME}' not found.`);

    // ── Step 1: Determine week ranges ─────────────────────────
    let lastWeek, prevWeek;
    if (CONFIGB.USE_MANUAL_DATE_RANGE) {
      const manualStart = new Date(CONFIGB.MANUAL_WEEK_START + "T00:00:00");
      const manualEnd   = new Date(CONFIGB.MANUAL_WEEK_END   + "T23:59:59");
      lastWeek = {
        start: manualStart,
        end:   manualEnd,
        label: formatDateLabel_(manualStart) + " – " + formatDateLabel_(manualEnd),
      };
      const prevStart = new Date(manualStart); prevStart.setDate(manualStart.getDate() - 7);
      const prevEnd   = new Date(manualEnd);   prevEnd.setDate(manualEnd.getDate() - 7);
      prevWeek = {
        start: prevStart,
        end:   prevEnd,
        label: formatDateLabel_(prevStart) + " – " + formatDateLabel_(prevEnd),
      };
      Logger.log(`📅 Using manual date range: ${lastWeek.label}`);
    } else {
      lastWeek = getLastCompletedWeekRange_();
      prevWeek = getPreviousWeekRange_();
      Logger.log(`📅 Auto-detected last week: ${lastWeek.label}`);
      Logger.log(`📅 Previous week: ${prevWeek.label}`);
    }

    // ── Step 2: Read source data ───────────────────────────────
    const allRows = readSourceRows_(sourceSheet);
    Logger.log(`📋 Total source rows read: ${allRows.length}`);

    // ── Step 3: Filter + aggregate for each week ───────────────
    const lastWeekRows = filterRowsForWeek_(allRows, lastWeek.start, lastWeek.end);
    const prevWeekRows = filterRowsForWeek_(allRows, prevWeek.start, prevWeek.end);

    Logger.log(`  Last week rows: ${lastWeekRows.length}`);
    Logger.log(`  Prior week rows: ${prevWeekRows.length}`);

    const lastWeekAgg = aggregateByEmployee_(lastWeekRows);
    const prevWeekAgg = aggregateByEmployee_(prevWeekRows);

    // ── Step 4: Enrich aggregations with Roster attributes ────
    const rosterRows = readRosterRows_();
    const rosterMap  = buildRosterMap_(rosterRows);
    enrichWithRoster_(lastWeekAgg, rosterMap);
    enrichWithRoster_(prevWeekAgg, rosterMap);
    Logger.log(`  Roster loaded: ${rosterRows.length} active employees.`);

    // ── Step 5: Get/create summary sheet ──────────────────────
    const summarySheet = getOrCreateSummarySheet_(ss);
    if (summarySheet.getLastRow() === 0) {
      initSummarySheetHeaders_(summarySheet);
    }

    // ── Step 6: Write prior week data ─────────────────────────
    const prevWeekKey    = formatWeekKey_(prevWeek.start);
    const prevWeekColIdx = getOrCreateWeekColumn_(summarySheet, prevWeekKey, prevWeek.label);
    writeWeekDataToSummary_(summarySheet, prevWeekAgg, prevWeekColIdx);

    // ── Step 7: Write last week data ──────────────────────────
    const lastWeekKey    = formatWeekKey_(lastWeek.start);
    const lastWeekColIdx = getOrCreateWeekColumn_(summarySheet, lastWeekKey, lastWeek.label);
    writeWeekDataToSummary_(summarySheet, lastWeekAgg, lastWeekColIdx);

    // ── Step 8: Compute totals for executive summary block ────
    const lastWeekTotalHrs = Object.values(lastWeekAgg).reduce((s, e) => s + e.totalHours, 0);
    const prevWeekTotalHrs = Object.values(prevWeekAgg).reduce((s, e) => s + e.totalHours, 0);
    const activeEmployees  = Object.keys(lastWeekAgg).length;

    // ── Step 9: Write executive summary block ─────────────────
    writeAiContextBlock_(
      summarySheet,
      lastWeek.label,
      prevWeek.label,
      activeEmployees,
      lastWeekTotalHrs,
      prevWeekTotalHrs
    );

    // ── Step 10: Write WoW Comparison Table ───────────────────
    writeWoWComparisonTable_(
      summarySheet,
      lastWeekAgg,
      prevWeekAgg,
      lastWeek.label,
      prevWeek.label
    );

    // ── Step 11: Write Signal Summary sheet ───────────────────
    writeSignalSummarySheet_(
      ss,
      lastWeekAgg,
      prevWeekAgg,
      lastWeekRows,
      prevWeekRows,
      lastWeek.label,
      prevWeek.label
    );

    Logger.log(`✅ [generateWeeklyContributionSummary] Completed successfully.`);
    Logger.log(`   Last week: ${Math.round(lastWeekTotalHrs * 10) / 10} total hrs across ${activeEmployees} employees.`);

    SpreadsheetApp.getActiveSpreadsheet().toast(
      `Summary updated for ${lastWeek.label}. ${activeEmployees} employees | ${Math.round(lastWeekTotalHrs * 10) / 10} total hrs.`,
      `${CONFIGB.SCRIPT_LABEL} — Complete`,
      6
    );

  } catch (e) {
    Logger.log("❌ [generateWeeklyContributionSummary] " + e.message);
    SpreadsheetApp.getActiveSpreadsheet().toast("Error: " + e.message, "❌ Script Failed", 10);
    throw e;
  }
}
