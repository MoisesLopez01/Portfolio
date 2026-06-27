
const CONFIGN = {
  SHEETS_TO_NORMALIZE: [
    "Capacity",
    "Planned Time Tempo",
    "Tempo Tracked Time",
  ],
  NAME_COLUMN:    2,
  FIRST_DATA_ROW: 2,
};

const NAME_MAPST = {
  TEMPO: {
    "Chuck Talk" : "Charles W Talk",
    "Karl Hoeschen" : "Karl E Hoeschen",
    "Pravin Mahendran" : "Pravindran Mahendran",
    "Adrien Low" : "Adrien Shung Shien Low",
    "Afiq Syed Khaidzir" : "Syed Afiq Al-Attas Syed Khaidzir",
    "Brian Estavilla" : "Brian M Estavilla",
    "Dean Espera" : "Dean D Espera",
    "Hashvin Katheresan" : "K Hashvin Katheresan",
    "Iman Hashemi (ServiceRocket)" : "Seyed Iman Hashemi Rastegar",
    "Kevin Lew" : "Wey Khoon Lew",
    "KL Foong" : "Kah Loun Foong",
    "Mohamed Riza" : "Mohamed Riza Mohamed",
    "Rahimi Diallo" : "Thierno Abdoul Rahimi Diallo",
    "Scott Tan" : "Scott Wai Chee Tan",
    "Teck-En Yew" : "Teck En Yew",
    "TS Chong" : "Tze Siong Chong",
    "Vicknesh Shanmugam" : "Vicknesh A/L Shanmugam",
    "Sam Gatica" : "Samuel Gatica",
    "Ignacia Ciero R." : "Ignacia Ciero",
    "Valentin Lopez" : "Valentín Lopez",
    "Alexander Moore" : "Alexander Oneal Moore",
    "Connie Owens" : "Connie Jo Owens",
    "Danny Garcia" : "Danny Garcia",
    "Dave Nicholson" : "David Nicholson",
    "Ahmad Danial Mohammad" : "Ahmad Danial B Mohammad",
    "Azmir Md Zan" : "Azmir Zan",
    "Farah Othman" : "Farah Idayu Othman",
    "Luis Atencio Atencio Villasmil" : "Luis Daniel Atencio Villasmil",
    "Amanda Fernandez" : "Amanda Anusuyia Fernandez",
    "Blake Main" : "Blake R Main",
    "Ikram Abdul Hamid" : "Mohd Ikram Hafiz Abdul Hamid",
    "Javi Zabadal" : "Javier Zabadal",
    "Foogie Sim" : "Foo Guan Sim",
    "Andrew Wern Sern" : "Andrew Er Wern Sern",
    "Angel Guo" : "Angel Qianyi Guo",
    "Esteban Cornejo" : "Esteban Cornejo Solis",
    "Aliah Mohd Razib" : "Fatin Aliah Mohd Razib",
    "Florencia Sofia Parraguez Sepulveda" : "Florencia Parraguez",
    "Long Nguyen" : "Hoang Long Nguyen",
    "Josh Hombre" : "Joshua R Hombre",
    "Jaysen Lim" : "Jun Hong Lim",
    "Rachael Huston" : "Rachael A Huston",
    "Rod Aguilera" : "Rodrigo Aguilera",
    "Ronald Lim" : "Ronald Sheng Wei Lim",
    "Abby Chong" : "Se Wha Chong",
    "Steve Monroney" : "Steven Monroney",
    "Joe Lai" : "Yong Zhu Lai",
    "Kumar Ramajillu" : "Jaya Kumar Ramajillu",
    "Nick Vermillion" : "Nicholas Vermillion",
    "Adrian Cisternas" : "Adrian Alejandro Cisternas Arevalo",
  },
};

// Normalizes column B names in a single sheet. Returns the count of changes made.
function normalizeSheetNames_(sheet, nameMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIGN.FIRST_DATA_ROW) return 0;

  const range   = sheet.getRange(CONFIGN.FIRST_DATA_ROW, CONFIGN.NAME_COLUMN, lastRow - CONFIGN.FIRST_DATA_ROW + 1, 1);
  const values  = range.getValues();
  let   changes = 0;

  const updated = values.map(([name]) => {
    const trimmed = (name || "").toString().trim();
    const mapped  = nameMap[trimmed];
    if (mapped !== undefined) {
      changes++;
      return [mapped];
    }
    return [name];
  });

  range.setValues(updated);
  return changes;
}

// Entry point — runs across all sheets listed in CONFIGN.SHEETS_TO_NORMALIZE.
// To add a new sheet: append its name to that array.
function normalizeAllNames() {
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const nameMap = NAME_MAPST.TEMPO;
  let   total   = 0;

  CONFIGN.SHEETS_TO_NORMALIZE.forEach(sheetName => {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`Sheet "${sheetName}" not found — skipped.`);
      return;
    }
    const count = normalizeSheetNames_(sheet, nameMap);
    Logger.log(`"${sheetName}" — ${count} name(s) updated.`);
    total += count;
  });

  Logger.log(`Done — ${total} total name(s) updated across ${CONFIGN.SHEETS_TO_NORMALIZE.length} sheet(s).`);
}

// Kept for backward compatibility if it's referenced elsewhere.
function normalizeCapacityNames() {
  normalizeAllNames();
}
