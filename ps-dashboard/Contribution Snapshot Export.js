// ============================================================
// SCRIPT NAME: Contribution Snapshot Export
// PURPOSE:     Freeze the just-closed fiscal quarter's per-Rocketeer
//              contribution evidence to the "Contribution Snapshot" sheet,
//              where the Comp Health Report (CompDash) joins it by Employee
//              Number. Implements PROCESS §7.4's snapshot-sheet decision:
//              QTA evidence must not move mid-review, so CompDash reads a
//              frozen sheet — never this dashboard's live payload.
// ENVIRONMENT: Google Apps Script — lives in the PS Contribution Report
//              project (needs computeFiscalContext_, buildPrevQWeeks_PS_,
//              readPSRoster_, getPSReportData from that project).
// RUN:         exportContributionSnapshot() from the GAS editor as the owner,
//              once per quarter at QTA cycle open (or on a quarterly trigger
//              via setupSnapshotTrigger()).
// SPEC:        CompDash/docs/specs/2026-07-28-compdash-v4-decision-maker-design.md
// ============================================================

const CONFIG_SNAP = {
  // Target: the contribution data file (same spreadsheet that carries the
  // "Small Improvements RD" tab CompDash already reads). Override via the
  // CONTRIB_SNAPSHOT_SS_ID Script Property.
  TARGET_SS_ID_FALLBACK: "1_V-i2BHvk6RFOdksYSpyW_hrPVJ-pIyAWSN5timy5fw",
  TARGET_TAB: "Contribution Snapshot",
  // Every org team — the snapshot covers the whole company, not just Services.
  TEAM_KEYS: ["services", "rnd", "sales"],
  HEADERS: [
    "Quarter", "Employee Number", "Name", "Team",
    "Contribution Score", "Goal Compliant", "Goals Total",
    "PTO Compliance", "Tracked Hrs", "Planned Hrs", "Tracked Coverage",
    "Kudos Received", "Kudos Given", "RCR", "SI", "Snapshot Date",
  ],
};

/**
 * Exports the previous (closed) fiscal quarter. Existing rows for that
 * quarter are replaced — safe to re-run; other quarters are never touched.
 *
 * Contribution Score is the EVIDENCE SCORE v1: the mean of the components
 * available for that person — goal compliance (0/1), tracked coverage
 * (tracked ÷ planned, capped at 1), PTO compliance share, kudos
 * (0.5 received + 0.5 given). It is NOT the Top Rocketeers weekly score;
 * it exists so CompDash's "invisible contributor" check (Check L spirit)
 * has a deterministic, explainable input until GTT-35 standardizes
 * contribution points. RCR is written only where it exists (Services) —
 * blank never means zero.
 */
function exportContributionSnapshot() {
  const ctx = computeFiscalContext_();
  const quarter = ctx.prevGoalsQuarter;                       // e.g. "FY26Q4"
  const labels = buildPrevQWeeks_PS_(ctx).map(w => w.label);  // closed-quarter ISO weeks
  const roster = readPSRoster_();                             // norm → profile (employeeNumber)
  Logger.log("Snapshot: quarter " + quarter + " — " + labels.length + " weeks (" +
             labels[0] + " … " + labels[labels.length - 1] + ")");

  const rowsOut = [];
  const seen = new Set();
  const today = new Date().toISOString().slice(0, 10);

  CONFIG_SNAP.TEAM_KEYS.forEach(teamKey => {
    let d = getPSReportData(false, teamKey); // owner run = admin scope; closed quarter is frozen, cache is fine
    if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } }
    if (!d || !d.ok) {
      Logger.log("⚠️ Snapshot: team " + teamKey + " payload failed — " + ((d && d.error) || "no data"));
      return;
    }
    const teamLabel = (d.meta && d.meta.team && d.meta.team.label) || teamKey;

    (d.employees || []).forEach(e => {
      if (e.isCrewMember || seen.has(e.normName)) return; // crew out of comp scope; dedupe across teams
      seen.add(e.normName);
      const profile = roster.get(e.normName);
      const empNo = profile ? String(profile.employeeNumber || "").trim() : "";

      let tracked = null, planned = null, kudosR = 0, kudosG = 0, ptoGood = 0, ptoTotal = 0;
      let goalCompliant = null, goalsTotal = null;
      labels.forEach(l => {
        const wd = e.weeks && e.weeks[l];
        if (!wd) return;
        if (wd.trackedHrs != null) tracked = (tracked || 0) + wd.trackedHrs;
        if (wd.plannedHrs != null) planned = (planned || 0) + wd.plannedHrs;
        if (wd.kudos) { kudosR += wd.kudos.count || 0; kudosG += wd.kudos.givenCount || 0; }
        if (wd.ptoHealth) { ptoTotal++; if (wd.ptoHealth.status === "Good") ptoGood++; }
        // Chronological labels → the quarter's LAST evaluated week wins.
        if (wd.goalsDetail && wd.goalsDetail.compliant !== undefined) {
          goalCompliant = wd.goalsDetail.compliant ? 1 : 0;
          if (wd.goalsDetail.totalGoals != null) goalsTotal = wd.goalsDetail.totalGoals;
        }
      });

      const coverage = (tracked != null && planned > 0) ? tracked / planned : null;
      const ptoPct = ptoTotal > 0 ? ptoGood / ptoTotal : null;
      const comps = [];
      if (goalCompliant != null) comps.push(goalCompliant);
      if (coverage != null) comps.push(Math.min(1, coverage));
      if (ptoPct != null) comps.push(ptoPct);
      comps.push((kudosR > 0 ? 0.5 : 0) + (kudosG > 0 ? 0.5 : 0));
      const score = comps.length ? comps.reduce((a, b) => a + b, 0) / comps.length : null;

      rowsOut.push([
        quarter, empNo, e.name, teamLabel,
        score != null ? Math.round(score * 100) / 100 : "",
        goalCompliant == null ? "" : (goalCompliant ? "Yes" : "No"),
        goalsTotal != null ? goalsTotal : "",
        ptoPct != null ? Math.round(ptoPct * 100) / 100 : "",
        tracked != null ? Math.round(tracked * 10) / 10 : "",
        planned != null ? Math.round(planned * 10) / 10 : "",
        coverage != null ? Math.round(coverage * 100) / 100 : "",
        kudosR, kudosG,
        (e.rcr && e.rcr.value != null) ? e.rcr.value : "", // Services only — blank ≠ zero
        (e.si && e.si.value != null) ? e.si.value : "",
        today,
      ]);
    });
  });

  if (!rowsOut.length) {
    Logger.log("❌ Snapshot: no rows built — nothing written.");
    return;
  }

  const ssId = PropertiesService.getScriptProperties().getProperty("CONTRIB_SNAPSHOT_SS_ID") ||
               CONFIG_SNAP.TARGET_SS_ID_FALLBACK;
  const ss = SpreadsheetApp.openById(ssId);
  let sh = ss.getSheetByName(CONFIG_SNAP.TARGET_TAB);
  if (!sh) sh = ss.insertSheet(CONFIG_SNAP.TARGET_TAB);

  // Replace-by-quarter: keep every other quarter's rows, drop this one's.
  const existing = sh.getDataRange().getValues();
  const kept = existing.length > 1
    ? existing.slice(1).filter(r => String(r[0]).trim() && String(r[0]).trim() !== quarter)
    : [];
  const all = [CONFIG_SNAP.HEADERS].concat(kept, rowsOut);
  sh.clearContents();
  sh.getRange(1, 1, all.length, CONFIG_SNAP.HEADERS.length).setValues(
    all.map(r => r.concat(Array(Math.max(0, CONFIG_SNAP.HEADERS.length - r.length)).fill(""))));
  Logger.log("✅ Snapshot: " + rowsOut.length + " rows written for " + quarter +
             " (" + kept.length + " prior-quarter rows kept) → " + CONFIG_SNAP.TARGET_TAB);
  Logger.log("Next: run bustCompCache_() in the CompDash project so the join is picked up.");
}

/**
 * Optional quarterly trigger — runs on the 2nd of Jan/Apr/Jul/Oct (a day
 * into each new fiscal quarter, when the previous quarter is fully closed).
 * Install once from the editor as the owner.
 */
function setupSnapshotTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === "runSnapshotIfQuarterStart_") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("runSnapshotIfQuarterStart_").timeBased().atHour(6).everyDays(1).create();
  Logger.log("✅ Daily 6am check installed — exports on the 2nd day of each fiscal quarter.");
}

function runSnapshotIfQuarterStart_() {
  const d = new Date();
  if (d.getDate() !== 2 || [0, 3, 6, 9].indexOf(d.getMonth()) === -1) return; // Jan/Apr/Jul/Oct 2nd
  exportContributionSnapshot();
}
