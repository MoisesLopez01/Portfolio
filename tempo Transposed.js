/**
 * ════════════════════════════════════════════════════════════════════
 * TEMPO TRACKED TIME — name correction + transpose
 * ════════════════════════════════════════════════════════════════════
 *
 * Reusable extract from the Tempo ↔ Netsuite Audit pipeline. Two steps:
 *
 *   1. normalizeTempoNames()
 *        Walks the "Tempo Tracked Time" tab and rewrites column B using the
 *        TEMPO → NETSUITE name map. Tempo's display names (e.g. "Chuck
 *        Talk") are replaced by their Netsuite legal counterparts
 *        (e.g. "Charles W Talk") so downstream matching is clean.
 *
 *   2. transposeTempoData()
 *        Reads the wide-format "Tempo Tracked Time" tab (User in col B, dates
 *        across cols E onward) and writes a long-format "Tempo
 *        Transposed" tab with three columns: User | Date | Hours.
 *        One row per user-date that has hours > 0.
 *
 * EXPECTED TABS:
 *   Input :  "Tempo Tracked Time"        (wide format, see CONFIGTemp)
 *   Output:  "Tempo Transposed"  (long format, regenerated each run)
 * ════════════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────────────
// CONFIGTemp
// ─────────────────────────────────────────────────────────────────────
const CONFIGTemp = {
  TEMPO_SHEET_NAME:    "Tempo Tracked Time",
  TRANSPOSED_NAME:     "Tempo Transposed",

  // Tempo Data layout (1-based)
  USER_COLUMN:         2,   // Column B — names that get normalized
  DATE_START_COLUMN:   5,   // Column E — first date column
  FIRST_DATA_ROW:      2,

  SKIP_ZERO_HOURS:     true,
};

// Tempo display name → Netsuite legal name. Edit here to add/correct.
const NAME_MAP_TEMPO_TO_NETSUITE = {
  "Chuck Talk":                          "Charles W Talk",
  "Karl Hoeschen":                       "Karl E Hoeschen",
  "Pravin Mahendran":                    "Pravindran Mahendran",
  "Adrien Low":                          "Adrien Shung Shien Low",
  "Afiq Syed Khaidzir":                  "Syed Afiq Al-Attas Syed Khaidzir",
  "Brian Estavilla":                     "Brian M Estavilla",
  "Dean Espera":                         "Dean D Espera",
  "Hashvin Katheresan":                  "K Hashvin Katheresan",
  "Iman Hashemi (ServiceRocket)":        "Seyed Iman Hashemi Rastegar",
  "Kevin Lew":                           "Wey Khoon Lew",
  "KL Foong":                            "Kah Loun Foong",
  "Mohamed Riza":                        "Mohamed Riza Mohamed",
  "Rahimi Diallo":                       "Thierno Abdoul Rahimi Diallo",
  "Scott Tan":                           "Scott Wai Chee Tan",
  "Teck-En Yew":                         "Teck En Yew",
  "TS Chong":                            "Tze Siong Chong",
  "Vicknesh Shanmugam":                  "Vicknesh A/L Shanmugam",
  "Sam Gatica":                          "Samuel Gatica",
  "Ignacia Ciero R.":                    "Ignacia Ciero",
  "Valentin Lopez":                      "Valentín Lopez",
  "Alexander Moore":                     "Alexander Oneal Moore",
  "Connie Owens":                        "Connie Jo Owens",
  "Danny Garcia":                        "Danny Garcia",
  "Dave Nicholson":                      "David Nicholson",
  "Ahmad Danial Mohammad":               "Ahmad Danial B Mohammad",
  "Azmir Md Zan":                        "Azmir Zan",
  "Farah Othman":                        "Farah Idayu Othman",
  "Luis Atencio Atencio Villasmil":      "Luis Daniel Atencio Villasmil",
  "Amanda Fernandez":                    "Amanda Anusuyia Fernandez",
  "Blake Main":                          "Blake R Main",
  "Ikram Abdul Hamid":                   "Mohd Ikram Hafiz Abdul Hamid",
  "Javi Zabadal":                        "Javier Zabadal",
  "Foogie Sim":                          "Foo Guan Sim",
  "Andrew Wern Sern":                    "Andrew Er Wern Sern",
  "Angel Guo":                           "Angel Qianyi Guo",
  "Esteban Cornejo":                     "Esteban Cornejo Solis",
  "Aliah Mohd Razib":                    "Fatin Aliah Mohd Razib",
  "Florencia Sofia Parraguez Sepulveda": "Florencia Parraguez",
  "Long Nguyen":                         "Hoang Long Nguyen",
  "Josh Hombre":                         "Joshua R Hombre",
  "Jaysen Lim":                          "Jun Hong Lim",
  "Rachael Huston":                      "Rachael A Huston",
  "Rod Aguilera":                        "Rodrigo Aguilera",
  "Ronald Lim":                          "Ronald Sheng Wei Lim",
  "Abby Chong":                          "Se Wha Chong",
  "Steve Monroney":                      "Steven Monroney",
  "Joe Lai":                             "Yong Zhu Lai",
};



function runTempoPrep() {
  normalizeTempoNames();
  transposeTempoData();
  SpreadsheetApp.getActive().toast(
    "Done — see '" + CONFIGTemp.TRANSPOSED_NAME + "'.",
    "Tempo Tracked Time", 5
  );
}

// ─────────────────────────────────────────────────────────────────────
// STEP 1 — normalize Tempo names against the Netsuite name map
// ─────────────────────────────────────────────────────────────────────
function normalizeTempoNames() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIGTemp.TEMPO_SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${CONFIGTemp.TEMPO_SHEET_NAME}" not found.`);

  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIGTemp.FIRST_DATA_ROW) {
    Logger.log("Step 1: no data rows to normalize.");
    return;
  }

  const range  = sheet.getRange(CONFIGTemp.FIRST_DATA_ROW, CONFIGTemp.USER_COLUMN, lastRow - CONFIGTemp.FIRST_DATA_ROW + 1, 1);
  const values = range.getValues();
  let changeCount = 0;

  const updated = values.map(([name]) => {
    const trimmed = String(name || "").trim();
    const mapped  = NAME_MAP_TEMPO_TO_NETSUITE[trimmed];
    if (mapped && mapped !== trimmed) {
      changeCount++;
      return [mapped];
    }
    return [name];
  });

  range.setValues(updated);
  Logger.log(`Step 1 done — ${changeCount} name(s) normalized in "${CONFIGTemp.TEMPO_SHEET_NAME}".`);
}

// ─────────────────────────────────────────────────────────────────────
// STEP 2 — transpose Tempo Data (wide → long: User | Date | Hours)
// ─────────────────────────────────────────────────────────────────────
function transposeTempoData() {
  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(CONFIGTemp.TEMPO_SHEET_NAME);
  if (!src) throw new Error(`Sheet "${CONFIGTemp.TEMPO_SHEET_NAME}" not found.`);

  const lastRow = src.getLastRow();
  const lastCol = src.getLastColumn();
  if (lastRow < 2) throw new Error("No data rows found in source sheet.");

  const allValues  = src.getRange(1, 1, lastRow, lastCol).getValues();
  const headerRow  = allValues[0];
  const dataRows   = allValues.slice(1);

  const dateStartIdx = CONFIGTemp.DATE_START_COLUMN - 1;
  const dateLabels   = headerRow.slice(dateStartIdx);
  const userIdx      = CONFIGTemp.USER_COLUMN - 1;

  // Pre-resolve which columns are real dates. Headers like "Planned",
  // "Total", capacity labels, etc. must NOT contribute to the transpose.
  // Accept ONLY:
  //   • Date objects, OR
  //   • Strings matching dd-MMM-yy / dd-MMM-yyyy exactly (Tempo's format).
  const DATE_HEADER_RE = /^\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2,4}$/;
  const dateColumns = dateLabels.map(rawDate => {
    if (rawDate instanceof Date && !isNaN(rawDate)) return getDateKey(rawDate);
    if (rawDate === null || rawDate === undefined || rawDate === "") return null;
    const str = String(rawDate).trim();
    if (!DATE_HEADER_RE.test(str)) return null;
    return getDateKey(str);
  });

  // Detect duplicate date headers — same calendar date in multiple columns
  // would silently sum together and inflate hours. Log loudly so it's
  // obvious from the execution log.
  const seenDates = new Map();
  const duplicateCols = [];
  dateColumns.forEach((dateStr, i) => {
    if (!dateStr) return;
    if (seenDates.has(dateStr)) {
      duplicateCols.push({ date: dateStr, firstCol: seenDates.get(dateStr), dupCol: i });
    } else {
      seenDates.set(dateStr, i);
    }
  });
  if (duplicateCols.length > 0) {
    duplicateCols.forEach(d => {
      Logger.log(`WARNING duplicate date header "${d.date}" — col ${CONFIGTemp.DATE_START_COLUMN + d.firstCol} & col ${CONFIGTemp.DATE_START_COLUMN + d.dupCol}. Hours will be SUMMED across these columns.`);
    });
  }

  Logger.log(`Step 2 — found ${dateColumns.filter(Boolean).length} date columns out of ${dateColumns.length} examined.`);

  // user||dd-MMM-yy → total hours
  const totals = new Map();
  dataRows.forEach(row => {
    const user = String(row[userIdx] || "").trim();
    if (!user) return;

    dateColumns.forEach((dateStr, i) => {
      if (!dateStr) return;   // skip "Planned" / "Total" / non-date columns

      const hours = parseFloat(row[dateStartIdx + i]) || 0;
      if (CONFIGTemp.SKIP_ZERO_HOURS && hours === 0) return;

      const key = `${user}||${dateStr}`;
      totals.set(key, (totals.get(key) || 0) + hours);
    });
  });

  const output = Array.from(totals.entries())
    .map(([key, hours]) => {
      const [user, date] = key.split("||");
      const d = parseDMMMYY(date);
      const wk = (d && !isNaN(d.getTime())) ? "W" + isoWeekOfDate_(d) : "";
      return [user, date, hours, wk];
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || parseDMMMYY(a[1]) - parseDMMMYY(b[1]));

  let out = ss.getSheetByName(CONFIGTemp.TRANSPOSED_NAME);
  if (!out) {
    out = ss.insertSheet(CONFIGTemp.TRANSPOSED_NAME);
  } else {
    out.clearContents();
    out.clearFormats();
  }

  out.getRange(1, 1, 1, 4)
    .setValues([["User", "Date", "Hours", "Week"]])
    .setBackground("#0F1941")
    .setFontColor("#FFFFFF")
    .setFontWeight("bold")
    .setHorizontalAlignment("center");

  if (output.length > 0) {
    out.getRange(2, 1, output.length, 4).setValues(output);
  }
  out.setFrozenRows(1);
  out.autoResizeColumns(1, 4);
  Logger.log(`Step 2 done — ${output.length} rows written to "${CONFIGTemp.TRANSPOSED_NAME}" (with Week column).`);
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * ISO 8601 week number (Mon = day 1).
 * Matches =ISOWEEKNUM() in Google Sheets and isoWeekNum_() in Jira Backlog.js.
 * Returns a number, e.g. 19 for ISO week 19.
 */
function isoWeekOfDate_(d) {
  var dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  var yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

/**
 * Returns "dd-MMM-yy" as the canonical lookup key for dates.
 * Uses the SPREADSHEET's timezone to ensure what you see is what you match.
 */
function getDateKey(raw) {
  if (!raw) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  let d;
  if (raw instanceof Date && !isNaN(raw)) {
    d = raw;
  } else {
    const s = String(raw).trim();
    if (!s) return null;
    d = parseDMMMYY(s);
    if (!d) d = new Date(s);
  }

  if (!d || isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, tz, "dd-MMM-yy");
}

function parseDMMMYY(str) {
  if (!str) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  // Try Utilities.parseDate first for max consistency with the sheet's TZ.
  try {
    const format = String(str).length > 9 ? "dd-MMM-yyyy" : "dd-MMM-yy";
    const d = Utilities.parseDate(String(str), tz, format);
    if (d && !isNaN(d.getTime())) {
      d.setHours(12, 0, 0, 0); // noon to avoid DST ambiguity
      return d;
    }
  } catch (e) {
    // Fall through to manual parsing.
  }

  const parts = String(str).trim().split("-");
  if (parts.length !== 3) return null;
  const months = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
                   Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const day = parseInt(parts[0], 10);
  const mon = months[parts[1]];
  let yr = parseInt(parts[2], 10);
  if (yr < 100) yr += 2000;
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return new Date(yr, mon, day, 12, 0, 0);
}
