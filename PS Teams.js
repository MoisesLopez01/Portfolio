// ============================================================
// PS TEAMS — org team registry for the Services / R&D / Sales & Success toggle.
// Single source of truth for team keys, labels, membership rule and metric sets
// (mirrors the VIEWS pattern in PS Dashboard.html).
// Spec: docs/superpowers/specs/2026-07-08-org-team-toggle-design.md
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

// Hybrid membership rule (order matters):
//   1. Department = Services      → services (today's population, byte-identical)
//   2. Job Catalog family = JF004 → sales
//   3. everyone else              → rnd
// `catalog` is the readJobCatalog_() Map (normPS_(title) → { family, … }).
function teamForProfile_(profile, catalog) {
  // Blank/missing Department preserves the pre-toggle filter's semantics — those
  // rows were always kept in the Services view, so only a non-empty, non-Services
  // department can leave the services team.
  const dept = (profile.dept || "").trim();
  if (!dept || dept === CONFIG_PS.PS_DEPT) return "services";
  const hit = catalog ? catalog.get(normPS_(profile.jobTitle || "")) : null;
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
    // [dept, jobTitle, expected]
    ["Services",    "Implementation Manager", "services"],
    ["Services",    "Account Executive",      "services"], // JF004 inside Services stays Services
    ["Sales",       "Account Executive",      "sales"],
    ["Engineering", "Software Engineer",      "rnd"],
    ["Engineering", "Totally Unknown Title",  "rnd"],      // uncatalogued, non-Services
    ["",            "Account Executive",      "services"], // blank dept preserves pre-toggle Services membership
    ["",            "Mystery Role",           "services"],
  ];
  let fail = 0;
  cases.forEach((c, i) => {
    const got = teamForProfile_({ dept: c[0], jobTitle: c[1] }, cat);
    if (got !== c[2]) { fail++; Logger.log(`❌ case ${i}: (${c[0]} | ${c[1]}) → ${got}, want ${c[2]}`); }
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
