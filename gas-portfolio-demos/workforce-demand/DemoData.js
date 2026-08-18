// ============================================================
// DemoData.js — builds the synthetic "Helix Delivery Group"
// workbook this demo reads. Run buildDemoWorkbook() once in the
// GAS editor; it logs the new spreadsheet ID — paste it into
// CONFIG.SOURCE_SS_ID and CONFIG.ROSTER_SS_ID.
// Deterministic (seeded PRNG) and anchored on the run date, so
// data always straddles "today" (window: current−18 … current+4
// ISO weeks — covers the 8-week view, QTD panels, and charts).
// All names, projects, and numbers are fictional.
// ============================================================

function buildDemoWorkbook() {
  var rng = mulberry32_(20260803);
  var W = demoWeeks_(18, 4); // [{iso:"2026.W14", pad:"2026.W14"→padded, date:...}, ...]

  var PEOPLE = demoPeople_();
  var PROJECTS = [
    { key: "ATLAS",  name: "Atlas Rollout",        pm: "Priya Raman" },
    { key: "ORION",  name: "Orion Migration",      pm: "Priya Raman" },
    { key: "VEGA",   name: "Vega Managed Services", pm: "Daniel Cho" },
    { key: "LYRA",   name: "Lyra Integration",     pm: "Daniel Cho" },
    { key: "NOVA",   name: "Nova Onboarding",      pm: "Sofia Marin" },
    { key: "QUASAR", name: "Quasar Analytics",     pm: "Sofia Marin" },
    { key: "PULSAR", name: "Pulsar Support",       pm: "Priya Raman" },
    { key: "COMET",  name: "Comet Discovery",      pm: "Daniel Cho" },
  ];

  var ss = SpreadsheetApp.create("Helix Demo Workbook — synthetic");
  var planned = [], tracked = [], jira = [], issueSeq = 100;
  var epicOf = {}; PROJECTS.forEach(function (p, i) { epicOf[p.key] = "HELIX-E" + (i + 1); });

  // Per-person weekly plan: 1–3 projects, 6–34h; a couple of fragmented people;
  // PTO (NETSUITE) weeks sprinkled in; tracked = plan × 0.65–1.1 for past weeks.
  PEOPLE.forEach(function (person, pi) {
    var homeProjects = pick_(rng, PROJECTS, 2 + (pi % 3)); // 2–4 projects per person
    W.forEach(function (w, wi) {
      var isPast = w.status !== "plan";
      var onPto = rng() < 0.04;
      if (onPto) {
        var ptoH = rng() < 0.5 ? 40 : 8;
        planned.push([person.name, "Time off", "NETSUITE", "", "", w.iso, ptoH]);
        if (isPast) tracked.push([person.name, "Time off", "NETSUITE", "", "", w.iso, ptoH]);
        return;
      }
      var n = 1 + Math.floor(rng() * Math.min(3, homeProjects.length));
      if (pi < 2 && wi % 4 === 2) n = Math.min(homeProjects.length, 5); // fragmentation signal
      var projs = homeProjects.slice(0, n), left = 30 + Math.floor(rng() * 8);
      projs.forEach(function (p, k) {
        var h = k === projs.length - 1 ? Math.max(4, left) : Math.max(4, Math.round(left * (0.3 + rng() * 0.4)));
        left -= h;
        var issue = p.key + "-" + (100 + ((pi * 7 + wi * 3 + k) % 60));
        planned.push([person.name, p.name, p.key, p.pm, issue, w.iso, h]);
        if (isPast) {
          var ratio = 0.65 + rng() * 0.45;
          if (rng() < 0.05) ratio = 0.1; // "planned but not tracked" swarm signal
          var th = Math.round(h * ratio * 2) / 2;
          if (th > 0) tracked.push([person.name, p.name, p.key, p.pm, issue, w.iso, th]);
        }
      });
    });
  });

  // ── Tab: Planned Time Tempo / Tempo Tracked Time (two-row header) ──
  writeTempoTab_(ss, "Planned Time Tempo", W, planned, null);
  writeTempoTab_(ss, "Tempo Tracked Time", W, tracked, new Date());

  // ── Tab: PH (text dates, locations fuzzy-matching roster Key Locations) ──
  var ph = [["Date", "Location", "Holiday"]];
  [[1, "Chile", "Día Nacional"], [5, "Australia & New Zealand", "Bank Holiday"],
   [8, "Malaysia", "Hari Kebangsaan"], [21, "Chile", "Fiestas Patrias"]].forEach(function (h) {
    var d = new Date(W[14].date.getTime() + h[0] * 86400000); // inside the visible window
    ph.push([Utilities.formatDate(d, "UTC", "yyyy-MM-dd"), h[1], h[2]]);
  });
  sheetWith_(ss, "PH", ph);

  // ── Tab: Capacity Tempo (padded ISO row 1, Account ID + trailing total) ──
  var capHdr1 = ["", ""], capHdr2 = ["Account ID", "User"];
  W.forEach(function (w) { capHdr1.push(padIso_(w.iso)); capHdr2.push("wk"); });
  capHdr1.push(""); capHdr2.push("Total (hrs)");
  var capRows = [capHdr1, capHdr2];
  PEOPLE.forEach(function (p, i) {
    var row = ["712020:demo" + i, p.name], tot = 0;
    W.forEach(function (w) {
      var isPto = planned.some(function (r) { return r[0] === p.name && r[5] === w.iso && r[2] === "NETSUITE" && r[6] >= 40; });
      var base = p.loc === "Australia & New Zealand" ? 38 : 40;
      var v = isPto ? 0 : base;
      row.push(v); tot += v;
    });
    row.push(tot);
    capRows.push(row);
  });
  sheetWith_(ss, "Capacity Tempo", capRows);

  // ── Tab: Jira Raw (headers exact; epics as own rows, blank Epic Key) ──
  jira.push(["Key", "Work (Summary)", "Status", "Fix Versions", "Epic Key", "Assignee",
             "Created", "Updated", "Resolution Date", "Original Estimate (sec)"]);
  PROJECTS.forEach(function (p) {
    jira.push([epicOf[p.key], p.name + " (Epic)", "In Progress", "", "", p.pm,
               ymdOffset_(-120), ymdOffset_(-3), "", ""]);
  });
  var seen = {};
  tracked.concat(planned).forEach(function (r) {
    var issue = r[4]; if (!issue || seen[issue]) return; seen[issue] = 1;
    var key = r[2], person = r[0], roll = rng();
    var status = roll < 0.45 ? "In Progress" : roll < 0.75 ? "Done" : roll < 0.9 ? "To Do" : "In Review";
    var fx = rng() < 0.6 ? "BILL-2026.3" : (rng() < 0.5 ? "internal-2026" : "");
    var assignee = rng() < 0.08 ? "Unassigned" : person;
    var updated = rng() < 0.1 ? ymdOffset_(-20) : ymdOffset_(-2); // few aging-WIP rows
    jira.push([issue, "Work item for " + key, status, fx, epicOf[key], assignee,
               ymdOffset_(-90), updated, status === "Done" ? ymdOffset_(-5) : "",
               String(Math.round((4 + rng() * 30)) * 3600)]);
  });
  sheetWith_(ss, "Jira Raw", jira);

  // ── Tabs: Data + Contractors Data (roster) ──
  var hdr = ["Name", "Class", "Department", "Employee Status", "Termination/Release Date",
             "Key Location", "Job Title", "Job Family", "Supervisor"];
  var data = [hdr], crew = [hdr];
  PEOPLE.forEach(function (p) {
    var row = [p.name, "Professional Services", "Services", "Active", "",
               p.loc, p.title, "", p.supervisor || ""];
    (p.crew ? crew : data).push(row);
  });
  sheetWith_(ss, "Data", data);
  sheetWith_(ss, "Contractors Data", crew);

  ss.deleteSheet(ss.getSheets()[0]); // default "Sheet1"
  Logger.log("Demo workbook ready: " + ss.getId());
  Logger.log("Paste this ID into CONFIG.SOURCE_SS_ID and CONFIG.ROSTER_SS_ID, then run bustDemandCache_().");
  return ss.getId();
}

// ── helpers ──────────────────────────────────────────────────

function demoPeople_() {
  var mk = function (name, loc, title, supervisor, crew) {
    return { name: name, loc: loc, title: title, supervisor: supervisor, crew: !!crew };
  };
  var sup1 = "Priya Raman", sup2 = "Daniel Cho", sup3 = "Sofia Marin";
  return [
    mk(sup1, "United States", "09.M4.1 Manager, Delivery", ""),
    mk(sup2, "Australia & New Zealand", "09.M3.1 Manager, Delivery", sup1),
    mk(sup3, "Chile", "09.M3.2 Manager, Delivery", sup1),
    mk("Alice Doe", "Malaysia", "07.I3.2 Consultant, Delivery", sup1),
    mk("Omar Haddad", "Malaysia", "07.I3.1 Consultant, Delivery", sup1),
    mk("Mei Lin Tan", "Malaysia", "07.I4.1 Senior Consultant, Delivery", sup1),
    mk("Ravi Pillai", "Malaysia", "07.I2.1 Associate Consultant, Delivery", sup2),
    mk("Nadia Osman", "Malaysia", "07.I3.2 Consultant, Delivery", sup2),
    mk("Jun Wei Ng", "Malaysia", "07.I3.1 Consultant, Delivery", sup2),
    mk("Farah Aziz", "Malaysia", "07.I4.2 Senior Consultant, Delivery", sup3),
    mk("Kavya Nair", "Malaysia", "07.I2.2 Associate Consultant, Delivery", sup3),
    mk("Hana Yusof", "Malaysia", "07.I3.1 Consultant, Delivery", sup3),
    mk("Liam O'Brien", "Australia & New Zealand", "07.I4.1 Senior Consultant, Delivery", sup2),
    mk("Ruby Clarke", "Australia & New Zealand", "07.I3.2 Consultant, Delivery", sup2),
    mk("Tane Walker", "Australia & New Zealand", "07.I3.1 Consultant, Delivery", sup2),
    mk("Isla Thompson", "Australia & New Zealand", "07.I2.1 Associate Consultant, Delivery", sup2),
    mk("Camila Rojas", "Chile", "07.I3.1 Consultant, Delivery", sup3),
    mk("Matías Silva", "Chile", "07.I3.2 Consultant, Delivery", sup3),
    mk("Valentina Paz", "Chile", "07.I4.1 Senior Consultant, Delivery", sup3),
    mk("Diego Fuentes", "Chile", "07.I2.2 Associate Consultant, Delivery", sup3),
    mk("Josefa Vidal", "Chile", "07.I3.1 Consultant, Delivery", sup3),
    mk("Ethan Brooks", "United States", "07.I4.2 Senior Consultant, Delivery", sup1),
    mk("Grace Miller", "United States", "07.I3.1 Consultant, Delivery", sup1),
    mk("Noah Bennett", "United States", "07.I2.1 Associate Consultant, Delivery", sup1),
    mk("Aroha Ngata", "Australia & New Zealand", "Crew Member — Delivery", sup2, true),
    mk("Pablo Mora", "Chile", "Crew Member — Delivery", sup3, true),
    mk("Suraya Bakar", "Malaysia", "Crew Member — Delivery", sup1, true),
  ];
}

function demoWeeks_(past, future) {
  var out = [], today = new Date();
  for (var off = -past; off <= future; off++) {
    var d = new Date(today.getTime() + off * 7 * 86400000);
    var iso = isoWeekYear_(d) + ".W" + isoWeekNum_(d); // reuses app helpers (same file scope in GAS)
    out.push({ iso: iso, date: mondayOf_(d), status: off < 0 ? "done" : off === 0 ? "now" : "plan" });
  }
  return out;
}
function mondayOf_(d) {
  var x = new Date(d); var day = x.getDay() || 7; x.setDate(x.getDate() - day + 1);
  x.setHours(0, 0, 0, 0); return x;
}
function padIso_(iso) {
  var m = iso.match(/^(\d{4})\.W(\d+)$/);
  return m[1] + ".W" + (m[2].length === 1 ? "0" + m[2] : m[2]);
}
function ymdOffset_(days) {
  return Utilities.formatDate(new Date(Date.now() + days * 86400000), "UTC", "yyyy-MM-dd");
}
function mulberry32_(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick_(rng, arr, n) {
  var copy = arr.slice(), out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  return out;
}
function sheetWith_(ss, name, rows) {
  var sh = ss.insertSheet(name);
  if (rows.length) sh.getRange(1, 1, rows.length, rows[0].length).setValues(padRows_(rows));
  return sh;
}
function padRows_(rows) {
  var w = 0; rows.forEach(function (r) { if (r.length > w) w = r.length; });
  return rows.map(function (r) { return r.concat(new Array(w - r.length).fill("")); });
}
// Two-row-header Tempo tab: row1 = ISO labels over the week columns (4-digit
// year REQUIRED for detection), row2 = field headers, TOTAL footer, optional
// "Last Export:" stamp (tracked only).
function writeTempoTab_(ss, name, W, recs, exportStamp) {
  var fixed = ["User", "Space", "Key", "PM", "Issue"];
  var row1 = fixed.map(function () { return ""; }).concat(W.map(function (w) { return w.iso; })).concat([""]);
  var row2 = fixed.concat(W.map(function (w) { return "wk"; })).concat(["Total (hrs)"]);
  var byPerson = {};
  recs.forEach(function (r) {
    var k = r[0] + "|" + r[2] + "|" + r[1] + "|" + r[3] + "|" + r[4];
    byPerson[k] = byPerson[k] || { fixed: [r[0], r[1], r[2], r[3], r[4]], weeks: {} };
    byPerson[k].weeks[r[5]] = (byPerson[k].weeks[r[5]] || 0) + r[6];
  });
  var rows = [row1, row2];
  Object.keys(byPerson).sort().forEach(function (k) {
    var e = byPerson[k], tot = 0;
    var wcells = W.map(function (w) { var v = e.weeks[w.iso] || ""; if (v) tot += v; return v; });
    rows.push(e.fixed.concat(wcells).concat([tot]));
  });
  rows.push(["TOTAL"]);
  if (exportStamp) rows.push(["Last Export:", Utilities.formatDate(exportStamp, "UTC", "yyyy-MM-dd HH:mm")]);
  sheetWith_(ss, name, rows);
}
