// ============================================================
// SCRIPT NAME: Kudos Normalizer
// PURPOSE:     Reads the Kudos tab, splits multi-recipient rows
//              so every person gets their own dedicated row,
//              and writes the result to Kudos_Normalized.
//              Columns are detected by header name — no hardcoded
//              index assumptions.
// AUTHOR:
// CREATED:
// VERSION:     2.0.0
// ENVIRONMENT: Google Apps Script
// ============================================================

// ============================================================
// ⚙️  CONFIGKudosURATION — Edit values here before running
// ============================================================
const CONFIGKudos = {
  SCRIPT_LABEL:     "Kudos Normalizer",

  // ── Source ────────────────────────────────────────────────
  SOURCE_SHEET:     "Kudos",             // Raw data tab name
  HEADER_ROW:       1,                   // Row number that contains column headers
  MAX_ROWS:         5000,                // Safety cap

  // ── Expected header names (case-insensitive, trimmed) ─────
  // If your sheet uses slightly different names, update these.
  HEADER_RECIPIENTS:      "recipients",
  HEADER_GIVER:           "giver",
  HEADER_DESCRIPTION:     "description",
  HEADER_CREATE_DATE:     "create date",
  HEADER_ORG_VALUES:      "organizational values",

  // ── Output ────────────────────────────────────────────────
  OUTPUT_SHEET:     "Kudos_Normalized",
};

// ============================================================
// 🎨  COMPANY BRAND PALETTE — Do not modify
// ============================================================
const BRAND = {
  VOID_BLUE:   "#0F1941",
  ORBE_BLUE:   "#058CDC",
  IVORY:       "#DCCDBE",
  LIGHT_CREAM: "#FFFAF5",
  ROYAL:       "#2864E6",
  JUNE:        "#FF9B87",
};


// ── SECTION: HELPERS ──────────────────────────────────────────

/**
 * Reads the header row of a sheet and returns a map of
 * { normalizedHeaderName: 0-based column index }.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {Object} Header map.
 */
function buildHeaderMap_(sheet) {
  const headers = sheet
    .getRange(CONFIGKudos.HEADER_ROW, 1, 1, sheet.getLastColumn())
    .getValues()[0];

  const map = {};
  headers.forEach((h, i) => {
    map[String(h).trim().toLowerCase()] = i;
  });
  return map;
}

/**
 * Resolves a column index from the header map.
 * Throws a descriptive error if the header is not found.
 * @param {Object} map   - Header map from buildHeaderMap_().
 * @param {string} key   - CONFIGKudos.HEADER_* value (already lowercased).
 * @returns {number} 0-based column index.
 */
function colIdx_(map, key) {
  if (map[key] === undefined) {
    throw new Error(
      `Column "${key}" not found in the "${CONFIGKudos.SOURCE_SHEET}" header row. ` +
      `Available headers: ${Object.keys(map).join(", ")}`
    );
  }
  return map[key];
}

/**
 * Splits a recipient cell (comma-separated) into a clean name array.
 * Handles trailing commas, double spaces, and empty tokens.
 * @param {string} raw
 * @returns {string[]}
 */
function splitRecipients_(raw) {
  if (!raw || String(raw).trim() === "") return [];
  return String(raw)
    .split(",")
    .map(n => n.trim())
    .filter(n => n.length > 0);
}

/**
 * Safely formats a date cell value as "yyyy-MM-dd".
 * Returns "" if the value is blank or unparseable.
 * @param {*} val
 * @returns {string}
 */
function formatDate_(val) {
  if (!val) return "";
  let d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val); // keep raw string if unparseable
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/**
 * Returns an ISO week label like "2026.W24" for a given Date value.
 * Accepts Date objects or strings parseable by new Date() (e.g. "6/9/2026 6:51").
 * Returns "" if the value is blank or unparseable.
 * @param {*} val
 * @returns {string}
 */
function dateToIsoWeekLabel_(val) {
  if (!val) return "";
  const raw = val instanceof Date ? val : new Date(val);
  if (isNaN(raw.getTime())) return "";
  const d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return d.getUTCFullYear() + ".W" + week;
}

/**
 * Gets or creates a sheet, clearing its contents if it already exists.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} name
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getOrCreateSheet_(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  } else {
    sheet.clearContents();
    sheet.clearFormats();
  }
  return sheet;
}

/**
 * Writes a styled header row to the given sheet.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} headers
 */
function writeHeader_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setBackground(BRAND.VOID_BLUE);
  range.setFontColor("#FFFFFF");
  range.setFontWeight("bold");

}


// ── SECTION: CORE LOGIC ───────────────────────────────────────

/**
 * Reads the source Kudos sheet, detects column positions by header name,
 * and returns a flat normalised array — one entry per individual recipient.
 *
 * Output columns per row (0-based):
 *   0  Recipient             — single name
 *   1  Giver
 *   2  Description
 *   3  Create Date           — formatted yyyy-MM-dd
 *   4  ISO Week              — derived from Create Date, e.g. "2026.W24"
 *   5  Organizational Values — raw cell value (comma-separated company values)
 *
 * @returns {{ headers: string[], rows: Array[] }}
 */
function buildNormalizedRows_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(CONFIGKudos.SOURCE_SHEET);
  if (!src) throw new Error(`Source sheet "${CONFIGKudos.SOURCE_SHEET}" not found.`);

  // ── Detect columns by header name ─────────────────────────
  const hMap = buildHeaderMap_(src);
  Logger.log("📋 Detected headers: " + JSON.stringify(hMap));

  const iRecipients = colIdx_(hMap, CONFIGKudos.HEADER_RECIPIENTS);
  const iGiver      = colIdx_(hMap, CONFIGKudos.HEADER_GIVER);
  const iDesc       = colIdx_(hMap, CONFIGKudos.HEADER_DESCRIPTION);
  const iDate       = colIdx_(hMap, CONFIGKudos.HEADER_CREATE_DATE);
  // Organizational Values is optional — present in newer exports, absent in older ones
  const iOrgValues  = hMap[CONFIGKudos.HEADER_ORG_VALUES] !== undefined
    ? hMap[CONFIGKudos.HEADER_ORG_VALUES] : -1;

  // ── Read data rows ─────────────────────────────────────────
  const lastRow  = src.getLastRow();
  if (lastRow <= CONFIGKudos.HEADER_ROW) {
    Logger.log("⚠️  No data rows found in source sheet.");
    return { headers: [], rows: [] };
  }

  const dataStart = CONFIGKudos.HEADER_ROW + 1;
  const rowCount  = Math.min(lastRow - CONFIGKudos.HEADER_ROW, CONFIGKudos.MAX_ROWS);
  const colCount  = src.getLastColumn();
  const rawData   = src.getRange(dataStart, 1, rowCount, colCount).getValues();

  // ── Expand recipients ──────────────────────────────────────
  const output = [];

  for (const row of rawData) {
    const rawRecipients = row[iRecipients];
    const giver         = row[iGiver];
    const description   = row[iDesc];
    const createDate    = row[iDate];
    const orgValues     = iOrgValues !== -1 ? String(row[iOrgValues] || "") : "";

    // Skip entirely blank rows
    if (!rawRecipients && !giver && !description) continue;

    const names = splitRecipients_(rawRecipients);

    // If cell is blank / unparseable keep a placeholder so the row isn't lost
    const recipientList = names.length > 0 ? names : ["[Unknown]"];

    // Compute ISO week from Create Date (e.g. "2026.W24")
    let createDateVal = createDate instanceof Date ? createDate : new Date(createDate);
    const isoWeek = dateToIsoWeekLabel_(createDateVal);

    for (const name of recipientList) {
      output.push([
        name,                            // Recipient (one per row)
        String(giver       || ""),       // Giver
        String(description || ""),       // Description
        formatDate_(createDate),         // Create Date
        isoWeek,                         // ISO Week (derived from Create Date)
        orgValues,                       // Organizational Values
      ]);
    }
  }

  const headers = [
    "Recipient",
    "Giver",
    "Description",
    "Create Date",
    "ISO Week",
    "Organizational Values",
  ];

  return { headers, rows: output };
}

/**
 * Writes the normalised data to the output sheet with light formatting.
 * @param {{ headers: string[], rows: Array[] }} data
 */
function writeOutput_(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, CONFIGKudos.OUTPUT_SHEET);

  writeHeader_(sheet, data.headers);

  sheet.getRange(1, 7).setValue(new Date());

  if (data.rows.length === 0) {
    Logger.log("⚠️  [writeOutput_] No rows to write.");
    return;
  }

  // Write data
  sheet.getRange(2, 1, data.rows.length, data.headers.length)
       .setValues(data.rows);

  // Zebra stripe for readability
  for (let i = 0; i < data.rows.length; i++) {
    const bg = i % 2 === 0 ? BRAND.LIGHT_CREAM : "#FFFFFF";
    sheet.getRange(i + 2, 1, 1, data.headers.length).setBackground(bg);
  }

  // Auto-size columns
  sheet.autoResizeColumns(1, data.headers.length);

  // Wrap Description column only (col 3)
  sheet.getRange(1, 3, data.rows.length + 1, 1)
       .setWrap(true)
       .setVerticalAlignment("top");

  Logger.log(`✅ [writeOutput_] ${data.rows.length} rows written to "${CONFIGKudos.OUTPUT_SHEET}".`);
}


// ── SECTION: LAST-WEEK RECOGNITION SUMMARY ───────────────────

/**
 * Reads the source Kudos sheet and returns one row per original kudos post
 * from last ISO week (unmodified — recipients stay comma-separated as in source).
 *
 * Output columns per row (0-based):
 *   0  ISO Week              — e.g. "2026.W23"
 *   1  Giver
 *   2  Recipients            — raw comma-separated string from source
 *   3  # Recognized          — count of individual recipients in that post
 *   4  Description
 *   5  Organizational Values
 *
 * @returns {{ headers: string[], rows: Array[], weekLabel: string }}
 */
function buildLastWeekRecognitionRows_() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(CONFIGKudos.SOURCE_SHEET);
  if (!src) throw new Error(`Source sheet "${CONFIGKudos.SOURCE_SHEET}" not found.`);

  const hMap        = buildHeaderMap_(src);
  const iRecipients = colIdx_(hMap, CONFIGKudos.HEADER_RECIPIENTS);
  const iGiver      = colIdx_(hMap, CONFIGKudos.HEADER_GIVER);
  const iDesc       = colIdx_(hMap, CONFIGKudos.HEADER_DESCRIPTION);
  const iDate       = colIdx_(hMap, CONFIGKudos.HEADER_CREATE_DATE);
  const iOrgValues  = hMap[CONFIGKudos.HEADER_ORG_VALUES] !== undefined
    ? hMap[CONFIGKudos.HEADER_ORG_VALUES] : -1;

  // Determine last ISO week label (today − 7 days)
  const lastWeekDate  = new Date(new Date().getTime() - 7 * 24 * 60 * 60 * 1000);
  const lastWeekLabel = dateToIsoWeekLabel_(lastWeekDate);

  const lastRow = src.getLastRow();
  if (lastRow <= CONFIGKudos.HEADER_ROW) {
    return { headers: [], rows: [], weekLabel: lastWeekLabel };
  }

  const dataStart = CONFIGKudos.HEADER_ROW + 1;
  const rowCount  = Math.min(lastRow - CONFIGKudos.HEADER_ROW, CONFIGKudos.MAX_ROWS);
  const rawData   = src.getRange(dataStart, 1, rowCount, src.getLastColumn()).getValues();

  const output = [];
  for (const row of rawData) {
    const createDate = row[iDate];
    const isoWeek    = dateToIsoWeekLabel_(createDate instanceof Date ? createDate : new Date(createDate));
    if (isoWeek !== lastWeekLabel) continue;

    const giver      = String(row[iGiver]      || "").trim();
    const recipients = String(row[iRecipients] || "").trim();
    const desc       = String(row[iDesc]        || "").trim();
    const orgValues  = iOrgValues !== -1 ? String(row[iOrgValues] || "").trim() : "";
    const count      = splitRecipients_(recipients).length || 1;

    output.push([isoWeek, giver, recipients, count, desc, orgValues]);
  }

  // Sort: most recipients per post first, then alphabetically by giver
  output.sort((a, b) => (b[3] - a[3]) || String(a[1]).localeCompare(String(b[1])));

  const headers = [
    "ISO Week", "Giver", "Recipients", "# Recognized", "Description", "Organizational Values",
  ];
  return { headers, rows: output, weekLabel: lastWeekLabel };
}

/**
 * Writes the last-week recognition summary to the "Kudos_LastWeek" sheet.
 * @param {{ headers: string[], rows: Array[], weekLabel: string }} data
 */
function writeLastWeekSheet_(data) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, "Kudos_LastWeek");

  writeHeader_(sheet, data.headers);
  sheet.getRange(1, data.headers.length + 2).setValue("Last Week: " + data.weekLabel);
  sheet.getRange(1, data.headers.length + 3).setValue(new Date());

  if (data.rows.length === 0) {
    Logger.log(`⚠️  [writeLastWeekSheet_] No kudos found for ${data.weekLabel}.`);
    sheet.getRange(2, 1).setValue(`No kudos found for week ${data.weekLabel}`);
    return;
  }

  sheet.getRange(2, 1, data.rows.length, data.headers.length).setValues(data.rows);

  for (let i = 0; i < data.rows.length; i++) {
    const bg = i % 2 === 0 ? BRAND.LIGHT_CREAM : "#FFFFFF";
    sheet.getRange(i + 2, 1, 1, data.headers.length).setBackground(bg);
  }

  sheet.autoResizeColumns(1, data.headers.length);

  // Wrap Recipients (col 3) and Description (col 5)
  sheet.getRange(1, 3, data.rows.length + 1, 1).setWrap(true).setVerticalAlignment("top");
  sheet.getRange(1, 5, data.rows.length + 1, 1).setWrap(true).setVerticalAlignment("top");

  Logger.log(`✅ [writeLastWeekSheet_] ${data.rows.length} posts for ${data.weekLabel} written to "Kudos_LastWeek".`);
}


// ── SECTION: ENTRY POINTS ─────────────────────────────────────

/**
 * MAIN — Reads Kudos, expands multi-recipient rows, writes Kudos_Normalized.
 * Also writes Kudos_LastWeek — last week's recognition summary (one row per post).
 * Run this from the Apps Script editor or attach to a button.
 */
function runKudosNormalizer() {
  try {
    // Rewrites the normalised Kudos output sheet, and every non-underscore
    // global is callable via google.script.run by anyone who can load the
    // dashboard web app. Gate the write.
    const access = checkDashboardAccess();
    if (!hasAdminPower_(access)) {
      Logger.log(`⚠️ [Kudos] runKudosNormalizer blocked for ${access.email} (${access.role}).`);
      return { ok: false, error: "Admin access required" };
    }

    Logger.log(`🚀 [${CONFIGKudos.SCRIPT_LABEL}] Started.`);

    const data = buildNormalizedRows_();
    Logger.log(`   → ${data.rows.length} normalised rows built.`);

    writeOutput_(data);

    const lastWeek = buildLastWeekRecognitionRows_();
    Logger.log(`   → ${lastWeek.rows.length} last-week posts for ${lastWeek.weekLabel}.`);
    writeLastWeekSheet_(lastWeek);

    const msg = `Done! ${data.rows.length} rows → "${CONFIGKudos.OUTPUT_SHEET}" · ${lastWeek.rows.length} posts → "Kudos_LastWeek" (${lastWeek.weekLabel}).`;
    Logger.log(`✅ [${CONFIGKudos.SCRIPT_LABEL}] ${msg}`);
    SpreadsheetApp.getActiveSpreadsheet().toast(msg, CONFIGKudos.SCRIPT_LABEL, 5);

  } catch (e) {
    Logger.log(`❌ [runKudosNormalizer] ${e.message}`);
    SpreadsheetApp.getActiveSpreadsheet()
      .toast(`Error: ${e.message}`, "❌ " + CONFIGKudos.SCRIPT_LABEL, 10);
    throw e;
  }
}

/**
 * DIAGNOSTIC — Logs detected column positions and the first 5 parsed
 * recipient splits so you can verify mapping before running the full job.
 * Safe to run — writes nothing to the sheet.
 */
function diagnoseMappings() {
  try {
    const access = checkDashboardAccess();
    if (!hasAdminPower_(access)) {
      Logger.log(`⚠️ [Kudos] diagnoseMappings blocked for ${access.email} (${access.role}).`);
      return { ok: false, error: "Admin access required" };
    }

    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const src = ss.getSheetByName(CONFIGKudos.SOURCE_SHEET);
    if (!src) throw new Error(`Sheet "${CONFIGKudos.SOURCE_SHEET}" not found.`);

    const hMap = buildHeaderMap_(src);
    Logger.log("📋 All detected headers:\n" +
      Object.entries(hMap).map(([k, v]) => `  col ${v + 1} → "${k}"`).join("\n"));

    // Preview first 10 data rows: show recipient splits
    const lastRow  = src.getLastRow();
    const rowCount = Math.min(lastRow - CONFIGKudos.HEADER_ROW, 10);
    if (rowCount <= 0) { Logger.log("⚠️  No data rows."); return; }

    const iRecipients = colIdx_(hMap, CONFIGKudos.HEADER_RECIPIENTS);
    const rows = src.getRange(CONFIGKudos.HEADER_ROW + 1, 1, rowCount, src.getLastColumn()).getValues();

    Logger.log("\n🔍 Recipient split preview (first 10 rows):");
    rows.forEach((row, i) => {
      const raw    = row[iRecipients];
      const splits = splitRecipients_(raw);
      Logger.log(`  Row ${i + 2}: raw="${raw}" → [${splits.join(" | ")}]`);
    });

    SpreadsheetApp.getActiveSpreadsheet()
      .toast("Diagnostics logged. Open Apps Script Logs to review.", "Diagnose", 5);

  } catch (e) {
    Logger.log(`❌ [diagnoseMappings] ${e.message}`);
    throw e;
  }
}


// ============================================================
// 🚀  GETTING STARTED
// ============================================================
// 1. Paste this file into Extensions > Apps Script.
// 2. Run diagnoseMappings() first — check the Logs (View > Logs
//    or Ctrl+Enter) to confirm column headers are detected
//    correctly and recipient splitting looks right.
// 3. If a header isn't found, update the matching HEADER_*
//    value in CONFIGKudos to match your sheet exactly.
// 4. Run runKudosNormalizer() — it creates/replaces the
//    "Kudos_Normalized" tab with one row per recipient.
// ============================================================