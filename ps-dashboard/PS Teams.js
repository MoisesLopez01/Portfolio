// ============================================================
// PS TEAMS — org team registry for the Services / R&D / Sales & Success toggle.
// Single source of truth for team keys, labels, membership rule and metric sets
// (mirrors the VIEWS pattern in PS Dashboard.html).
// Spec: ps-dashboard/docs/specs/2026-07-08-org-team-toggle-design.md
// ============================================================

// Metric keys match the weight metric keys used across the report
// (goals / tracked / planned / rcr / kudos / si / pto).
const TEAMS_ = [
  { key: "services", label: "Services",
    metrics: ["rcr", "si", "goals", "tracked", "planned", "kudos", "pto"] },
  { key: "rnd",      label: "R&D",
    metrics: ["si", "goals", "kudos", "pto"] },
  { key: "sales",    label: "Sales & Success",
    metrics: ["si", "goals", "kudos", "pto"] },   // HubSpot metrics appended in a later phase
];

// Registry lookup; unknown / missing key falls back to the first entry (services),
// so legacy callers like the pre-toggle warmer keep working unmodified.
function teamByKey_(key) {
  const k = String(key || "").toLowerCase();
  for (const t of TEAMS_) if (t.key === k) return t;
  return TEAMS_[0];
}

// Roster Class values that participate in the dashboard (lower-cased for
// comparison). Anything else is dropped at the roster read — with a ⚠️ log —
// so a new or mistyped class surfaces instead of silently joining a team.
const TEAM_KNOWN_CLASSES_ = ["professional services", "corporate", "to be allocated"];

function classIsKnown_(cls) {
  return TEAM_KNOWN_CLASSES_.indexOf(String(cls || "").trim().toLowerCase()) !== -1;
}

// Class-driven membership rule (2026-07-09: the live roster showed the Class
// column, not Department, is the company-wide org axis — Department is
// "Services"-only for PS, while Class splits the company into
// Professional Services / Corporate / To be Allocated):
//   1. Class = "Professional Services" (CONFIG_PS.PS_CLASS) → services
//   2. any other known Class + Job Catalog family JF004     → sales
//   3. any other known Class otherwise                      → rnd
// FTE rows with an unknown/blank Class never reach tagging — readPSRoster_
// drops them. Crew (Contractors Data tab) are the exception: their Class is
// "Contractors" for everyone, so Department is their SOLE org axis —
// Department = "Services" (CONFIG_PS.PS_DEPT) → services, anything else
// (including blank) → rnd. Crew never land in sales (2026-07-15).
// JF004 detection REQUIRES the Sales & Success job titles to exist in
// the Job Catalog sheet with code JF004; uncatalogued sales titles land in rnd.
// `catalog` is the readJobCatalog_() Map (normPS_(title) → { family, … }).
function teamForProfile_(profile, catalog) {
  if (profile.isCrewMember) {
    const dept = String(profile.dept || "").trim().toLowerCase();
    return dept === CONFIG_PS.PS_DEPT.toLowerCase() ? "services" : "rnd";
  } else {
    const cls = String(profile.cls || "").trim().toLowerCase();
    if (cls === CONFIG_PS.PS_CLASS.toLowerCase()) return "services";
  }
  // Catalog lookup is code-prefix-insensitive (normTitleKey_), and a title whose
  // embedded job code parses (e.g. "04.I2.5 - …" → JF004) self-describes its
  // family even without a catalog row (titleCodeInfo_ fallback).
  const hit = (catalog ? catalog.get(normTitleKey_(profile.jobTitle || "")) : null)
           || titleCodeInfo_(profile.jobTitle);
  if (hit && hit.family === COE_FAMILY_CODE_) return "sales";
  return "rnd";
}

// Filters a roster Map to profiles tagged with `teamKey` (tagging happens in
// getPSReportData right after the roster read).
function teamRoster_(roster, teamKey) {
  return new Map([...roster].filter(([, p]) => p.team === teamKey));
}

function teamHasMetric_(team, key) {
  return team.metrics.indexOf(key) !== -1;
}

// Teams (in registry order) with at least one member in `roster`.
// Drives meta.availableTeams → the frontend toggle.
function availableTeams_(roster) {
  const counts = {};
  roster.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
  return TEAMS_.filter(t => counts[t.key] > 0).map(t => ({ key: t.key, label: t.label }));
}

// ── TESTS ────────────────────────────────────────────────────
// No trailing underscore: the GAS editor's Run dropdown hides trailing-underscore
// (private) functions, and this must be runnable there (like _test_weightsResolver).
// Run in the GAS editor, or in Node (one eval — const bindings don't cross evals):
//   node -e "global.Logger={log:console.log}; const fs=require('fs'); eval(fs.readFileSync('PS Contribution Report.js','utf8') + '\n' + fs.readFileSync('PS Teams.js','utf8')); process.exit(_test_teamForProfile() ? 0 : 1)"
function _test_teamForProfile() {
  const cat = new Map([
    [normPS_("Account Executive"),      { family: "JF004", track: "I", level: 3, levelKey: "I3" }],
    [normPS_("Implementation Manager"), { family: "JF008", track: "M", level: 5, levelKey: "M5" }],
    [normPS_("Software Engineer"),      { family: "JF002", track: "I", level: 4, levelKey: "I4" }],
  ]);
  const cases = [
    // [cls, jobTitle, expected]
    ["Professional Services", "Implementation Manager", "services"],
    ["Professional Services", "Account Executive",      "services"], // JF004 title inside the PS class stays Services
    ["To be Allocated",       "Account Executive",      "sales"],
    ["To be Allocated",       "Totally Unknown Title",  "rnd"],      // non-JF004 To-be-Allocated → R&D
    ["Corporate",             "Software Engineer",      "rnd"],
    ["Corporate",             "Account Executive",      "sales"],    // JF004 signal wins in any non-PS class
    ["PROFESSIONAL SERVICES", "Mystery Role",           "services"], // class compare is case-insensitive
    // Code-prefixed titles: embedded job code self-describes the family even
    // with no catalog row; a prefixed title also matches a clean catalog row.
    ["To be Allocated", "04.I5.3 - Senior Representative II, Account Management", "sales"], // titleCodeInfo_ fallback
    ["To be Allocated", "04.i3.4 - Representative, Account Management",           "sales"], // lowercase track letter
    ["To be Allocated", "99.I3.1 - Account Executive",                            "sales"], // prefix stripped → clean catalog row wins
    ["To be Allocated", "13.M10.10 - Mystery Title",                              "rnd"],   // code parses but family ≠ JF004
  ];
  let fail = 0;
  cases.forEach((c, i) => {
    const got = teamForProfile_({ cls: c[0], jobTitle: c[1] }, cat);
    if (got !== c[2]) { fail++; Logger.log(`❌ case ${i}: (${c[0]} | ${c[1]}) → ${got}, want ${c[2]}`); }
  });
  // Crew (Contractors Data tab): Department is the SOLE org axis — Services or R&D,
  // never sales, regardless of job title / catalog family.
  const crewCases = [
    // [dept, jobTitle, expected]
    ["Services",    "Crew Member",          "services"],
    ["SERVICES",    "Mystery Role",         "services"], // dept compare is case-insensitive
    ["Engineering", "Software Engineer",    "rnd"],
    ["Sales",       "Account Executive",    "rnd"],      // JF004 title does NOT pull crew into sales
    ["",            "Totally Unknown Title","rnd"],      // blank dept → rnd (no signal)
  ];
  crewCases.forEach((c, i) => {
    const got = teamForProfile_({ cls: "Contractors", dept: c[0], jobTitle: c[1], isCrewMember: true }, cat);
    if (got !== c[2]) { fail++; Logger.log(`❌ crew case ${i}: (dept ${c[0]} | ${c[1]}) → ${got}, want ${c[2]}`); }
  });
  ["Professional Services", "corporate", " To be Allocated "].forEach(v => {
    if (!classIsKnown_(v)) { fail++; Logger.log(`❌ classIsKnown_("${v}") should be true`); }
  });
  ["Contractors", "", null].forEach(v => {
    if (classIsKnown_(v)) { fail++; Logger.log(`❌ classIsKnown_(${JSON.stringify(v)}) should be false`); }
  });
  if (teamByKey_("bogus").key !== "services") { fail++; Logger.log(`❌ teamByKey_("bogus") should fall back to services`); }
  if (teamByKey_(null).key   !== "services") { fail++; Logger.log(`❌ teamByKey_(null) should fall back to services`); }
  const m = new Map([["a", { team: "rnd" }], ["b", { team: "services" }], ["c", { team: "rnd" }]]);
  if (teamRoster_(m, "rnd").size !== 2) { fail++; Logger.log(`❌ teamRoster_ should keep 2 rnd members`); }
  const av = availableTeams_(m);
  if (av.length !== 2 || av[0].key !== "services" || av[1].key !== "rnd") {
    fail++; Logger.log(`❌ availableTeams_ should return [services, rnd] in registry order, got ${JSON.stringify(av)}`);
  }
  Logger.log(fail === 0 ? `✅ _test_teamForProfile: all checks passed` : `❌ _test_teamForProfile: ${fail} failure(s)`);
  return fail === 0;
}
