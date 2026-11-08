
const CONFIGN = {
  // Per-sheet layout: which column carries the person name and where data
  // starts. Capacity Tempo keys column A by Account ID — its name lives in
  // column B (the old flat NAME_COLUMN: 1 scanned accountIds there and
  // silently normalized nothing). All three sheets have 2 header rows.
  SHEETS_TO_NORMALIZE: [
    { name: "Tempo Tracked Time", nameColumn: 1, firstDataRow: 3 },
    { name: "Planned Time Tempo", nameColumn: 1, firstDataRow: 3 },
    { name: "Capacity Tempo",     nameColumn: 2, firstDataRow: 3 },
  ],
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
    "Chris Kron":"Christopher R Kron",
    "Don Jacobsmeyer":"Donald Jacobsmeyer",
    "Gareth Weiss":"Gareth M Weiss",
    "Lea Columna":"Mary Lea Columna",
    "Tom Jaskowski":"Tomasz Jaśkowski",
    "YC Lian":"Yuen Chi Lian",
    "Andy Quah" : "Choon Kean Quah",
    "Bill Cushard" : "William G Cushard",
    "Elizabeth Tai" : "Siew Lin Elizabeth Tai",
    "Fatin Hazirah Surizan" : "Fatin Aliah Mohd Razib",
    "Hilman Zuhdi" : "Hilman Aizat Bin Zuhdi",
    "Ines Sica" : "Maria Ines Sica",
    "Jenny Steele Malone" : "Jennifer Steele Malone",
    "Juan Carlos Jerez" : "Juan Carlos Jerez Velasquez",
    "Maximiliano K." : "Maximiliano Kriz Sepúlveda",
    "Miri Hernandez" : "Miranda Hernandez",
    "Silvi Ocampo" : "Silvana Ocampo",
    "Suba Veeriah" : "Subatra Dewi A/P Veeriah",
    "Therese Obsequio" : "Therese M Obsequio",
    "Zed Yap" : "Eng Hiam Z Yap",
    "Ángela Manriquez Benito" : "Angela Sofia Manriquez Benito",
    "Rodney Nissen" : "Rodney G Nissen",
    "Abel Sanchez Jimenez":"Abel Sanchez",
    "Alfie Gomez Perez":"Alfonso A Gomez Perez",
    "Aloysius J John Augustine":"Aloysius Raj A John Augustine",
    "Claudia Egan Reyes":"Claudia Egan",
    "Iman Hashemi Hashemi Rastegar":"Seyed Iman Hashemi Rastegar",
    "Janice Cheang":"Keet Cheng Janice Cheang",
    "Marge Hermansen":"Marcela Hermansen",
    "Nathan Parmeter":"Nathan Joseph Parmeter",
    "Samuel Hien Ta":"Hien Ta",
    "Yaz Amestica":"Yazmin Amestica",
    "Devin Thompson":"Devin Wayne Thompson",
    "Tomas Meneses Salazar":"Tomas Joaquin Meneses Salazar",
    "Christopher Taylor":"Paul Taylor",
    // 2026-10-28 (2026.W44): the two Services people whose Tempo spelling the
    // roster could not place — found by comparing Capacity Tempo with the
    // roster. The Tempo Users tab's email now joins them regardless.
    "Doods Perea":"Dindo D Perea",
    "Samuel Ta":"Hien Ta",
    "":"",
    "":"",
    "":"",
  },
};

// Normalizes the name column of a single sheet in place. Returns the count of
// changes made. nameColumn/firstDataRow default to the classic layout
// (names in column A, data from row 2) for callers that don't pass them.
function normalizeSheetNames_(sheet, nameMap, nameColumn, firstDataRow) {
  nameColumn   = nameColumn || 1;
  firstDataRow = firstDataRow || 2;

  const lastRow = sheet.getLastRow();
  if (lastRow < firstDataRow) return 0;

  const range   = sheet.getRange(firstDataRow, nameColumn, lastRow - firstDataRow + 1, 1);
  const values  = range.getValues();
  let   changes = 0;

  const updated = values.map(([name]) => {
    const trimmed = (name || "").toString().trim();
    if (!trimmed) return [name]; // blank/footer cells — the map's "" entry must not count
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
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('normalizeAllNames');
  else Logger.log('⚠️ [normalizeAllNames] requireMaintainer_ not in this project — running ungated.');
  const ss      = SpreadsheetApp.getActiveSpreadsheet();
  const nameMap = NAME_MAPST.TEMPO;
  let   total   = 0;

  CONFIGN.SHEETS_TO_NORMALIZE.forEach(cfg => {
    const sheet = ss.getSheetByName(cfg.name);
    if (!sheet) {
      Logger.log(`Sheet "${cfg.name}" not found — skipped.`);
      return;
    }
    const count = normalizeSheetNames_(sheet, nameMap, cfg.nameColumn, cfg.firstDataRow);
    Logger.log(`"${cfg.name}" — ${count} name(s) updated.`);
    total += count;
  });

  Logger.log(`Done — ${total} total name(s) updated across ${CONFIGN.SHEETS_TO_NORMALIZE.length} sheet(s).`);
}

// Kept for backward compatibility if it's referenced elsewhere.
function normalizeCapacityNames() {
  // Web-reachable via google.script.run by anyone the deployment admits, so it is
  // gated. The typeof test is not defensive noise: if this file lives in its OWN
  // Apps Script project rather than the dashboard's, requireMaintainer_ (PS Security.js)
  // is not in scope — and there it needs no gate, because it is not on the
  // dashboard's callable surface at all. Hard-calling it would break every export.
  if (typeof requireMaintainer_ === 'function') requireMaintainer_('normalizeCapacityNames');
  else Logger.log('⚠️ [normalizeCapacityNames] requireMaintainer_ not in this project — running ungated.');
  normalizeAllNames();
}
