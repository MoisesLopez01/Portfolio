// ============================================================
// SCRIPT NAME: PS_POST — Weekly Contribution Section Publisher
// PURPOSE:     Publish the weekly "This Week: YYYY.Www" Confluence blog post.
//              If the post exists, update ONLY the "C: Contribution Team Updates"
//              section. If it does NOT exist, create it from a standard template
//              (Backlog / Availability / Contribution, each with four sub-panels
//              and owners), then fill in section C.
// AUTHOR:      <leave blank — fill in>
// CREATED:     <leave blank — fill in>
// VERSION:     3.2.0
// ENVIRONMENT: Google Apps Script
//
// Companion file to "PS Contribution Report.js" — shares the same GAS project
// scope, so checkDashboardAccess() (from "PS Security.js") is available here
// without any import.
//
// IMPORTANT — why the config object is called CONFIG_POST (not CONFIG):
//   Every file in a GAS project shares ONE global scope. Another file in this
//   project already declares `const CONFIG`, so naming it `CONFIG` here would
//   throw "Identifier 'CONFIG' has already been declared" and nothing would run.
//   CONFIG_POST is unique to this file and avoids that collision.
//
// HOW TO RUN / TEST FROM THE EDITOR:
//   Do NOT run publishContributionSection() directly — it needs a payload and
//   will simply no-op. Instead select one of these in the Run dropdown:
//     • previewWeeklyTarget()  — read-only; shows what would happen
//     • runPublishTest()       — writes placeholder content for this week
//   The dashboard calls publishContributionSection(payload) with real data.
//
// PANEL COLOUR -> AREA mapping (same in every section):
//      info (blue) = Facts | success (green) = Highlights
//      note (purple) = Notes | warning (yellow) = Concerns
// ============================================================


// ============================================================
// ⚙️  CONFIGURATION — Edit these values before running
// ============================================================
const CONFIG_POST = {
  SCRIPT_LABEL:      'PS Weekly Contribution Post', // Name shown in the menu and logs

  SPACE_KEY:         'ABCT',                         // Space key (used to search by title)
  SPACE_ID:          '5311004842',                   // Numeric space id (used to CREATE posts)
  BLOG_TITLE_PREFIX: 'This Week:',                   // Full title becomes "This Week: 2026.W26"
  SECTION_HEADING:   'C: Contribution Team Updates', // The H1 heading of the section we own
  CREATE_IF_MISSING: true,                           // Create this week's post if it doesn't exist

  // Which ADF panel colour maps to which area. Do not change unless the template
  // panel colours change.
  PANEL_TO_AREA: {
    info:    'facts',       // blue   panel -> Facts
    success: 'highlights',  // green  panel -> Highlights
    note:    'notes',       // purple panel -> Notes
    warning: 'concerns',    // yellow panel -> Concerns
  },

  // The four sub-sections, in the order they appear inside every section.
  TEMPLATE_AREAS: [
    { panelType: 'info',    title: 'Facts'      },
    { panelType: 'success', title: 'Highlights' },
    { panelType: 'note',    title: 'Notes'      },
    { panelType: 'warning', title: 'Concerns'   },
  ],

  // The sections that make up a fresh weekly post, in order, each with its owners.
  // Owner "id" is the Atlassian account id; "name" is the @mention display text.
  TEMPLATE_SECTIONS: [
    {
      heading: 'B: Backlog Team Updates',
      owners: [
        { id: '6385947e5fc160544e1b525b', name: '@Andrea Zaldana' },
        { id: '624151902e101c006a8c4933', name: '@Adriano Moran'  },
      ],
    },
    {
      heading: 'A: Availability Team Updates',
      owners: [
        { id: '5d40fa515e485d0dab01de52', name: '@Jennifer Szuszan' },
        { id: '5be03e82f8460347a10cd8ad', name: '@Tais Agulhari'     },
      ],
    },
    {
      heading: 'C: Contribution Team Updates',
      owners: [
        { id: '62f20a41c1b3a10ac3abcf12',              name: '@Claudia Egan Reyes' },
        { id: '62bcc002f53d9167386907a6',              name: '@Marge Hermansen'    },
        { id: '636385bce14026a73981909f',              name: '@Alex Lopez'         },
        { id: '712020:364ad298-817b-45cb-a782-d64971ae136a', name: '@Courtney Sutliff' },
      ],
    },
  ],
};




// ============================================================
// 🔐  ONE-TIME SETUP — Save Confluence credentials to Script Properties
//     Run setConfluenceConfig() ONCE from the editor, then clear the values
//     below and save the file. The values are then stored safely and reused.
// ============================================================

/**
 * ONE-TIME SETUP: stores Confluence credentials/config in Script Properties.
 *
 * Where to find each value:
 *   CLOUD_ID  — open https://rocketeers.atlassian.net/_edge/tenant_info in a
 *               browser; copy the "cloudId" value. (Likely already set.)
 *   API_TOKEN — create at https://id.atlassian.com/manage-profile/security/api-tokens
 *   EMAIL     — the Atlassian account email that OWNS that API token (must match
 *               exactly, or every request returns 401).
 *   BLOG_ID   — OPTIONAL. Leave blank to auto-find/create this week's post.
 *               Set it only to force a specific post for testing.
 *
 * @returns {void}
 */
function setConfluenceConfig() {
  // ── EDIT these, run once, then clear them again and save the file ──
  const CLOUD_ID  = 'PASTE_CLOUD_ID_HERE';
  const API_TOKEN = 'PASTE_API_TOKEN_HERE';
  const EMAIL     = 'PASTE_ATLASSIAN_EMAIL_HERE';
  const BLOG_ID   = ''; // optional override; blank = auto-find/create by week

  try {
    // Editor-only by convention, google.script.run-callable in fact. Step 2
    // below DELETES the blog-post override when BLOG_ID is blank — which it is
    // in committed code — so an ungated call is a real state change for anyone
    // holding the dashboard link.
    const access = checkDashboardAccess();
    if (!hasAdminPower_(access)) {
      Logger.log(`⚠️ [setConfluenceConfig] Blocked for ${access.email} (${access.role}).`);
      return { ok: false, error: 'Admin access required.' };
    }

    const p = PropertiesService.getScriptProperties();

    // Step 1: Save each value only if it was actually filled in (skip placeholders)
    if (CLOUD_ID  && CLOUD_ID  !== 'PASTE_CLOUD_ID_HERE')        p.setProperty('CONFLUENCE_CLOUD_ID',  CLOUD_ID);
    if (API_TOKEN && API_TOKEN !== 'PASTE_API_TOKEN_HERE')       p.setProperty('CONFLUENCE_API_TOKEN', API_TOKEN);
    if (EMAIL     && EMAIL     !== 'PASTE_ATLASSIAN_EMAIL_HERE') p.setProperty('CONFLUENCE_EMAIL',     EMAIL);

    // Step 2: Set or clear the optional fixed blog-post override
    if (BLOG_ID) p.setProperty('CONFLUENCE_BLOG_POST_ID', BLOG_ID);
    else         p.deleteProperty('CONFLUENCE_BLOG_POST_ID');

    Logger.log('✅ [setConfluenceConfig] Configuration saved to Script Properties.');

    // Step 3: Print a diagnosis so you can confirm what is now stored
    diagnoseConfig_();
  } catch (e) {
    Logger.log(`❌ [setConfluenceConfig] ${e.message}`);
    throw e;
  }
}


// ── SECTION: DATA COLLECTION — Blog section builders ─────────

/**
 * Builds the four blog section arrays (facts / highlights / notes / concerns)
 * for a given ISO week label by reading the PS report data (cache-first via
 * getPSReportData from PS Contribution Report.js, same GAS project scope).
 *
 * Mirrors the logic of generateTeamBrief() in PS Dashboard.html so the Confluence
 * post always reflects the same metrics the dashboard shows, even when called
 * from the GAS editor or another server-side entry point with no client payload.
 *
 * @param {string} weekLabel  e.g. "2026.W26"
 * @returns {{ weekLabel:string, facts:string[], highlights:string[], notes:string[], concerns:string[] }}
 */
function buildBlogSections_(weekLabel) {
  const report = getPSReportData();
  if (!report || !report.ok) {
    return {
      weekLabel:  weekLabel,
      facts:      ['Report data unavailable — check script permissions and spreadsheet access.'],
      highlights: [],
      notes:      [],
      concerns:   [],
      kudosDetail: [],
    };
  }

  const facts = [], highlights = [], notes = [], concerns = [];
  // Per-post kudos lines live in their own channel, NOT in highlights: the
  // publisher renders them inside a collapsed Confluence expand so 100+
  // recognition posts never bury the brief. The Kudos summary stays in highlights.
  const kudosDetail = [];
  const weeks     = report.weeks          || [];
  const meta      = report.meta           || {};
  const history   = report.trackedHistory || [];
  const teamSum   = report.teamSummary    || [];
  const phByWeek  = report.phByWeek       || {};
  const employees = report.employees      || [];
  const headcount = meta.activeCount      || 1;
  // Tracked/planned denominators use the time-mandated population, not the full
  // active headcount — pairing carved-out aggregates with activeCount invents
  // "not logging" people who were never held to the mandate.
  const timeHC    = meta.timeHeadcount    || headcount;

  // ── Manager / IC cohorts (spec 2026-08-02 §6) ───────────────────────────────
  // Managers are held to planning and tracking at their OWN bar: their week is
  // coaching, escalation and 1:1s, which never lands in Tempo. Reporting one
  // blended number blames managers for doing the job they were promoted into.
  // Cohort figures come from the manager aggregates the report ships alongside
  // the team totals; IC = total − manager, so the two always reconcile.
  const MGR_BAR = { planGood: 70, planWatch: 40, trackGood: 20, trackFloor: 10, coverGood: 70 };
  const cohortSplit = function(h) {
    if (!h || h.mgrHeadcount === undefined) return null;
    const mgrHC = meta.timeHeadcountMgr, icHC = meta.timeHeadcountIC;
    if (mgrHC === undefined || icHC === undefined) return null;
    if (mgrHC <= 0 || icHC <= 0) return null;   // single-cohort scope — nothing to split
    const side = function(hc, logged, hrs, planned, planHrs) {
      return {
        hc: hc, logged: logged, hrs: Math.round(hrs),
        avg: logged > 0 ? Math.round(hrs / logged * 10) / 10 : 0,
        coverPct: hc > 0 ? Math.round(logged / hc * 100) : 0,
        planned: planned, planHrs: Math.round(planHrs),
        planPct: hc > 0 ? Math.round(planned / hc * 100) : 0,
      };
    };
    const mL = h.mgrHeadcount || 0, mH = h.mgrTotalHrs || 0;
    const mP = h.mgrPlannedHC || 0, mPH = h.mgrPlannedHrs || 0;
    return {
      ic:  side(icHC,  Math.max(0, (h.headcount  || 0) - mL),
                       Math.max(0, (h.totalHrs   || 0) - mH),
                       Math.max(0, (h.plannedHC  || 0) - mP),
                       Math.max(0, (h.plannedHrs || 0) - mPH)),
      mgr: side(mgrHC, mL, mH, mP, mPH),
    };
  };

  // Mirrors generateTeamBrief() in PS Dashboard.html: every talking point carries a
  // metric tag so all four sections list metrics in the SAME order (goals → tracked →
  // planned → kudos → pto → context; rcr/si ranks kept for crew-mode parity with the
  // dashboard, unused here). Bullets may embed **bold** and
  // {red}…{/red} markers — buildBulletList_ maps them to ADF strong/textColor marks.
  const BRIEF_RANK = { goals: 0, tracked: 1, planned: 2, kudos: 3, pto: 4, rcr: 5, si: 6, ph: 7, other: 8 };
  function addI(arr, metric, text) {
    arr.push({ _r: BRIEF_RANK[metric] !== undefined ? BRIEF_RANK[metric] : BRIEF_RANK.other, _i: arr.length, t: text });
  }
  function orderI(arr) {
    return arr.slice()
      .sort(function(a, b) { return a._r - b._r || a._i - b._i; })
      .map(function(x) { return x.t; });
  }

  function getRow(id) { return teamSum.find(function(r) { return r.id === id; }) || null; }
  function getCell(row, lbl) {
    if (!row || !lbl) return null;
    const idx = weeks.findIndex(function(w) { return w.label === lbl; });
    return (idx !== -1 && row.cells && row.cells[idx]) ? row.cells[idx] : null;
  }

  const closedWeeks   = weeks.filter(function(w) { return !w.isFuture && w.label !== weekLabel; });
  const prevWeekLabel = closedWeeks.length > 0 ? closedWeeks[closedWeeks.length - 1].label : null;

  const histCur = history.find(function(h) { return h.label === weekLabel; }) || null;
  const histPrv = prevWeekLabel ? (history.find(function(h) { return h.label === prevWeekLabel; }) || null) : null;
  const selWeek = weeks.find(function(w) { return w.label === weekLabel; }) || null;

  const goalsRow = getRow('goals');
  const kudosRow = getRow('kudos');
  const ptoRow   = getRow('pto');

  const goalsCell = getCell(goalsRow, weekLabel);
  const goalsPrev = getCell(goalsRow, prevWeekLabel);
  const kudosCell = getCell(kudosRow, weekLabel);
  const ptoCell   = getCell(ptoRow,   weekLabel);

  const _phCur  = (phByWeek[weekLabel]      && phByWeek[weekLabel].totalAffected)      || 0;
  const _phPrev = (prevWeekLabel && phByWeek[prevWeekLabel] && phByWeek[prevWeekLabel].totalAffected) || 0;

  // ── Public holidays ────────────────────────────────────────────────────────
  weeks.filter(function(w) { return !w.isFuture; }).forEach(function(w) {
    const ph = phByWeek[w.label];
    if (!ph || !ph.entries || !ph.entries.length) return;
    const locations = ph.entries.map(function(e) { return e.location + ': ' + e.holiday; }).join('; ');
    addI(facts, 'ph', '**Public holidays:** ' + ph.totalAffected + ' rocketeer' + (ph.totalAffected !== 1 ? 's' : '') +
      ' in holiday regions · ' + w.label + ' · ' + locations);
    if (w.label === weekLabel && ph.totalAffected > 0) {
      addI(notes, 'tracked', ph.totalAffected + ' team member' + (ph.totalAffected !== 1 ? 's' : '') +
        ' were in a public holiday week (' + locations + ') — lower time tracking or planning may reflect this.');
    }
  });
  weeks.filter(function(w) { return w.isFuture; }).forEach(function(w) {
    const ph = phByWeek[w.label];
    if (!ph || !ph.entries || !ph.entries.length) return;
    const locations = ph.entries.map(function(e) { return e.location + ': ' + e.holiday; }).join('; ');
    addI(notes, 'ph', '**Heads up · ' + w.label + ':** ' +
      ph.totalAffected + ' rocketeer' + (ph.totalAffected !== 1 ? 's' : '') +
      ' in public holiday regions (' + locations + ').');
  });

  // ── Goals ──────────────────────────────────────────────────────────────────
  // Quarter-transition aware (mirrors the dashboard): during the goal grace window
  // compliance is still the PREVIOUS quarter's closing view; after it, the new
  // quarter's in-progress view (expected to build from low as goals are written).
  const fc      = meta.fiscalContext || {};
  const goalsQ  = meta.goalsQuarter || fc.goalsQuarter || '';
  const prevQ   = fc.prevGoalsQuarter || '';
  const inGrace = !!fc.inGracePeriod;
  const inRamp  = !!fc.inGoalWritingRamp;
  const graceEndLbl = fc.graceEndIsoWeek
    ? fc.graceEndIsoYear + '.W' + ('0' + fc.graceEndIsoWeek).slice(-2) : '';
  if (goalsCell && goalsCell.value !== null) {
    const compPct = goalsCell.value;
    const compN   = goalsCell.compliant != null ? goalsCell.compliant : null;
    const compTot = goalsCell.total     != null ? goalsCell.total     : null;
    const wowG    = (goalsPrev && goalsPrev.value !== null) ? compPct - goalsPrev.value : null;
    const wowGStr = wowG !== null ? (wowG > 0 ? ' +' + wowG + '% WoW' : wowG < 0 ? ' ' + wowG + '% WoW' : ' flat WoW') : '';
    const compStr = (compN != null && compTot != null) ? compN + ' of ' + compTot + ' rocketeers' : compPct + '%';
    const missing = (compTot != null && compN != null) ? compTot - compN : null;
    if (inGrace && prevQ) {
      addI(facts, 'goals', '**Goals (' + prevQ + ' closure):** ' + compStr + ' compliant (' + compPct + '%)' + wowGStr +
        ' — closing view of ' + prevQ + (graceEndLbl ? '; ' + goalsQ + ' tracking takes over after ' + graceEndLbl : ''));
    } else if (inRamp && goalsQ) {
      addI(facts, 'goals', '**Goals (' + goalsQ + ' in progress):** ' + compStr + ' compliant (' + compPct + '%)' + wowGStr +
        ' — early-quarter view; compliance builds as ' + goalsQ + ' goals are written and updated' +
        (prevQ ? ' (' + prevQ + ' closed in the ' + (graceEndLbl || 'prior') + ' post)' : ''));
    } else {
      addI(facts, 'goals', '**Goals:** ' + compStr + ' compliant (' + compPct + '%)' + wowGStr);
    }
    if (compPct >= 70) {
      addI(highlights, 'goals', inGrace && prevQ
        ? '**Goals:** ' + compStr + ' (' + compPct + '%) closing ' + prevQ + ' compliant — a strong finish to the quarter'
        : '**Goals:** ' + compStr + ' meeting ' + (goalsQ || 'quarterly') + ' commitments (' + compPct + '%)' + (wowG > 0 ? ', improving WoW' : ''));
    } else if (compPct >= 50 || (inRamp && !inGrace)) {
      addI(notes, 'goals', '**Goals:** compliance at ' + compPct + '%' +
        ((inRamp && !inGrace) ? ' — expected to be low this early in ' + goalsQ + '; watch that it climbs week over week'
          : (missing ? ' — ' + missing + ' rocketeer' + (missing > 1 ? 's' : '') + ' need goal updates' : '')));
    } else {
      addI(concerns, 'goals', '**Goals:** compliance at ' + compPct + '%' + (wowG !== null && wowG < 0 ? ' and declining' : '') +
        (missing ? ' — ' + missing + ' rocketeer' + (missing > 1 ? 's' : '') + ' need coaching on goal documentation and In-Progress ratio' : ''));
    }
    // Closure call-to-action: only rocketeers whose prev-quarter goals genuinely still
    // carry an open status (In Progress / Planned) — the non-compliant count is dominated
    // by Not Completed / too-few-goals cases that need no status change, so it must not
    // drive this note (meta.prevQOpenGoals comes from the closed-quarter goals run).
    const og = meta.prevQOpenGoals || null;
    if (inGrace && prevQ && og && og.people > 0) {
      const ogParts = [];
      if (og.inProgress > 0) ogParts.push(og.inProgress + ' In Progress');
      if (og.planned    > 0) ogParts.push(og.planned + ' Planned');
      addI(concerns, 'goals', '**Goals:** ' + og.goals + ' ' + prevQ + ' goal' + (og.goals !== 1 ? 's' : '') +
        ' still open' + (ogParts.length ? ' (' + ogParts.join(', ') + ')' : '') +
        ' across ' + og.people + ' rocketeer' + (og.people !== 1 ? 's' : '') +
        ' — managers to confirm final statuses before the window closes' +
        (graceEndLbl ? ' (' + graceEndLbl + ')' : ''));
    }
  }

  // ── Tracked time ──────────────────────────────────────────────────────────
  if (histCur && histCur.totalHrs > 0) {
    const avgH      = histCur.avgHrs || 0;
    const totalH    = Math.round(histCur.totalHrs);
    const logHC     = histCur.headcount || 0;
    const notLogged = Math.max(0, timeHC - logHC);
    const wowH      = histPrv ? Math.round(histCur.totalHrs - histPrv.totalHrs) : null;
    const wowHStr   = wowH !== null ? (wowH > 0 ? ' +' + wowH + 'h WoW' : wowH < 0 ? ' ' + wowH + 'h WoW' : '') : '';
    let _phNote = '';
    if (wowH !== null && wowH < 0) {
      if (_phCur > 0)       _phNote = ' · ' + _phCur + ' rocketeer' + (_phCur > 1 ? 's' : '') + ' on PH this week';
      else if (_phPrev > 0) _phNote = ' · prev week had ' + _phPrev + ' rocketeer' + (_phPrev > 1 ? 's' : '') + ' on PH (elevated baseline)';
    }
    const ckT = cohortSplit(histCur);
    if (ckT) {
      // Team total stays the headline fact; each cohort is then judged on its own
      // bar, and the manager lines name that bar so no reader applies the IC one.
      addI(facts, 'tracked', '**Tracked time:** ' + totalH + 'h by ' + logHC + '/' + timeHC +
        ' rocketeers (avg ' + avgH + 'h/person)' + wowHStr + _phNote +
        ' · ICs ' + ckT.ic.logged + '/' + ckT.ic.hc + ' (avg ' + ckT.ic.avg + 'h)' +
        ' · Managers ' + ckT.mgr.logged + '/' + ckT.mgr.hc + ' (avg ' + ckT.mgr.avg + 'h)');
      const icNotLogged = Math.max(0, ckT.ic.hc - ckT.ic.logged);
      if (ckT.ic.avg >= 36) {
        addI(highlights, 'tracked', '**Tracked time (ICs):** ' + ckT.ic.hrs + 'h by ' + ckT.ic.logged + ' of ' + ckT.ic.hc +
          ' ICs' + (wowH > 0 ? ', up ' + wowH + 'h WoW team-wide' : '') + ' (avg ' + ckT.ic.avg + 'h) — strong execution signal');
      } else if (ckT.ic.avg >= 28) {
        addI(notes, 'tracked', '**Tracked time (ICs):** avg ' + ckT.ic.avg + 'h/person' + _phNote +
          (icNotLogged > 0 ? ' · ' + icNotLogged + ' IC' + (icNotLogged > 1 ? 's' : '') + ' with no logged hours' : '') +
          ' — above the 28h floor, below the 36h target');
      } else {
        const _tempoCtxIC = (_phCur > 0 || _phPrev > 0) ? '' : ' · Tempo data pipeline under IT review — known sync issues may affect totals';
        addI(concerns, 'tracked', '**Tracked time (ICs):** avg ' + ckT.ic.avg + 'h/person' + _phNote +
          (icNotLogged > 0 ? ' — ' + icNotLogged + ' IC' + (icNotLogged > 1 ? 's' : '') + ' with no logged hours' : '') +
          '; delivery capacity is the exposure here — agree a per-person support action with their supervisor' + _tempoCtxIC);
      }
      const mgrBarTxt = ' (manager bar: ' + MGR_BAR.trackGood + 'h/week and ' + MGR_BAR.coverGood +
        '% logging — not the 36h IC target)';
      if (ckT.mgr.avg >= MGR_BAR.trackGood && ckT.mgr.coverPct >= MGR_BAR.coverGood) {
        addI(highlights, 'tracked', '**Tracked time (managers):** ' + ckT.mgr.logged + ' of ' + ckT.mgr.hc +
          ' managers logged ' + ckT.mgr.hrs + 'h (avg ' + ckT.mgr.avg + 'h) — at the manager bar; the balance is coaching and escalation time, which never reaches Tempo');
      } else if (ckT.mgr.avg >= MGR_BAR.trackFloor || ckT.mgr.coverPct >= MGR_BAR.coverGood) {
        addI(notes, 'tracked', '**Tracked time (managers):** ' + ckT.mgr.logged + ' of ' + ckT.mgr.hc +
          ' managers logged time, avg ' + ckT.mgr.avg + 'h' + mgrBarTxt +
          ' — expected to sit well below the IC average; watch the trend, not the week');
      } else {
        addI(notes, 'tracked', '**Tracked time (managers):** only ' + ckT.mgr.logged + ' of ' + ckT.mgr.hc +
          ' managers logged any time (avg ' + ckT.mgr.avg + 'h)' + mgrBarTxt +
          ' — below the manager floor too, so delivery hours managers do carry are invisible to capacity planning');
      }
    } else {
    addI(facts, 'tracked', '**Tracked time:** ' + totalH + 'h by ' + logHC + '/' + timeHC + ' rocketeers (avg ' + avgH + 'h/person)' + wowHStr + _phNote);
    if (avgH >= 36) {
      addI(highlights, 'tracked', '**Tracked time:** ' + totalH + 'h by ' + logHC + ' of ' + timeHC + ' rocketeers' + (wowH > 0 ? ', up ' + wowH + 'h WoW' : '') + ' (avg ' + avgH + 'h) — strong execution signal');
    } else if (avgH >= 28) {
      addI(notes, 'tracked', '**Tracked time:** avg ' + avgH + 'h/person' + wowHStr + _phNote +
        (notLogged > 0 ? ' · ' + notLogged + ' rocketeer' + (notLogged > 1 ? 's' : '') + ' with no logged hours' : '') +
        ' — above the 28h floor, below the 36h target');
    } else {
      const _tempoCtx = (_phCur > 0 || _phPrev > 0) ? '' : ' · Tempo data pipeline under IT review — known sync issues may affect totals';
      addI(concerns, 'tracked', '**Tracked time:** avg ' + avgH + 'h/person' + wowHStr + _phNote +
        (notLogged > 0 ? ' — ' + notLogged + ' rocketeer' + (notLogged > 1 ? 's' : '') + ' with no logged hours' : '') +
        _tempoCtx);
    }
    }
  } else if (selWeek && !selWeek.isFuture) {
    addI(facts, 'tracked', '**Tracked time:** no data for ' + weekLabel);
    addI(concerns, 'tracked', '**Tracked time:** no data for ' + weekLabel + ' — ensure the team is logging time in Tempo');
  }

  // ── Planned time ──────────────────────────────────────────────────────────
  if (histCur) {
    const planPct   = histCur.plannedPct || 0;
    const planHC    = histCur.plannedHC  || 0;
    const planH     = Math.round(histCur.plannedHrs || 0);
    const unplanned = Math.max(0, timeHC - planHC);
    const wowP      = histPrv ? Math.round((histCur.plannedHrs || 0) - (histPrv.plannedHrs || 0)) : null;
    const wowPStr   = wowP !== null ? (wowP > 0 ? ' +' + wowP + 'h WoW' : wowP < 0 ? ' ' + wowP + 'h WoW' : '') : '';
    const ckP = cohortSplit(histCur);
    if (ckP) {
      addI(facts, 'planned', '**Tempo plans:** ' + planHC + ' rocketeers (' + planPct + '%) planned, ' + planH + 'h total' + wowPStr +
        ' · ICs ' + ckP.ic.planned + '/' + ckP.ic.hc + ' (' + ckP.ic.planPct + '%)' +
        ' · Managers ' + ckP.mgr.planned + '/' + ckP.mgr.hc + ' (' + ckP.mgr.planPct + '%)');
      const icUnplanned = Math.max(0, ckP.ic.hc - ckP.ic.planned);
      if (ckP.ic.planPct >= 80) {
        addI(highlights, 'planned', '**Tempo plans (ICs):** ' + ckP.ic.planned + ' of ' + ckP.ic.hc + ' ICs (' + ckP.ic.planPct +
          '%) planned ahead (' + ckP.ic.planHrs + 'h) — proactive capacity management');
      } else if (ckP.ic.planPct >= 50) {
        addI(notes, 'planned', '**Tempo plans (ICs):** coverage at ' + ckP.ic.planPct + '% — ' + icUnplanned + ' IC' +
          (icUnplanned > 1 ? 's' : '') + ' missing forward capacity visibility; encourage weekly planning');
      } else {
        addI(concerns, 'planned', '**Tempo plans (ICs):** only ' + ckP.ic.planPct + '% of ICs planned — ' + icUnplanned + ' IC' +
          (icUnplanned > 1 ? 's' : '') + ' missing forward capacity visibility (Build Process to Drive Outcomes); this is the cohort to support first');
      }
      // Planning IS a manager duty, so this cohort can raise a concern — at its own bar.
      const mgrUnplanned = Math.max(0, ckP.mgr.hc - ckP.mgr.planned);
      const planBarTxt = ' (manager bar: ' + MGR_BAR.planGood + '%, not the 80% IC target)';
      if (ckP.mgr.planPct >= MGR_BAR.planGood) {
        addI(highlights, 'planned', '**Tempo plans (managers):** ' + ckP.mgr.planned + ' of ' + ckP.mgr.hc + ' managers (' +
          ckP.mgr.planPct + '%) planned — at or above the ' + MGR_BAR.planGood + '% manager bar; their teams inherit the planning habit they model');
      } else if (ckP.mgr.planPct >= MGR_BAR.planWatch) {
        addI(notes, 'planned', '**Tempo plans (managers):** coverage at ' + ckP.mgr.planPct + '%' + planBarTxt + ' — ' +
          mgrUnplanned + ' manager' + (mgrUnplanned > 1 ? 's' : '') + ' without a plan; managers set the example their teams follow');
      } else {
        addI(concerns, 'planned', '**Tempo plans (managers):** only ' + ckP.mgr.planPct + '% of managers planned' + planBarTxt +
          ' — ' + mgrUnplanned + ' of ' + ckP.mgr.hc + ' have no forward plan. Unlike logging hours, planning is squarely a manager duty: ' +
          'without it their team capacity is unforecastable and the IC planning habit has no example to follow');
      }
    } else {
    addI(facts, 'planned', '**Tempo plans:** ' + planHC + ' rocketeers (' + planPct + '%) planned, ' + planH + 'h total' + wowPStr);
    if (planPct >= 80) {
      addI(highlights, 'planned', '**Tempo plans:** ' + planHC + ' rocketeers (' + planPct + '%) planned ahead (' + planH + 'h) — proactive capacity management');
    } else if (planPct >= 50) {
      addI(notes, 'planned', '**Tempo plans:** coverage at ' + planPct + '% — ' + unplanned + ' rocketeer' + (unplanned > 1 ? 's' : '') + ' missing forward capacity visibility; encourage weekly planning');
    } else {
      addI(concerns, 'planned', '**Tempo plans:** only ' + planPct + '% of the team planned — ' + unplanned + ' rocketeer' + (unplanned > 1 ? 's' : '') + ' missing forward capacity visibility (Build Process to Drive Outcomes)');
    }
    }
    // Planned vs. executed gap, computed over the time-tracking cohort only: Services
    // includes roles (Solution Architects, Training, IT) that plan without tracking —
    // tracking isn't mandatory for them — so team-total planned hours would overstate
    // the gap. Cohort = tracked this week, OR tracked last week and not on full PTO
    // now (the blocked / lapsed cases this concern exists to catch).
    // Managers are excluded once the cohort split is available: a manager who plans
    // 40h and logs 8h is doing the job, not leaking delivery hours, and folding them
    // in inflates a gap that exists to surface IC blockers and missed Tempo entries.
    const ptoThreshG = (typeof CONFIG_PS !== 'undefined' && CONFIG_PS.PTO_IMPACT_THRESHOLD_HRS) || 8;
    const gapIcOnly = !!cohortSplit(histCur);
    let gapPlanH = 0, gapTrackH = 0;
    employees.forEach(function(e) {
      if (e.isCrewMember) return;
      if (gapIcOnly && e.isManager) return;
      const cur = (e.weeks && e.weeks[weekLabel]) || {};
      const prv = (prevWeekLabel && e.weeks && e.weeks[prevWeekLabel]) || {};
      const tracksNow = (cur.trackedHrs || 0) > 0;
      const lapsed    = !tracksNow && (prv.trackedHrs || 0) > 0 && (cur.ptoPlannedHrs || 0) < ptoThreshG;
      if (!tracksNow && !lapsed) return;
      gapPlanH  += cur.plannedHrs || 0;
      gapTrackH += cur.trackedHrs || 0;
    });
    gapPlanH = Math.round(gapPlanH); gapTrackH = Math.round(gapTrackH);
    if (gapTrackH > 0 && gapPlanH > gapTrackH) {
      const gapPct = Math.round((gapPlanH - gapTrackH) / gapPlanH * 100);
      if (gapPct >= 25) {
        addI(concerns, 'tracked', '**Planned vs. executed:** ' + gapTrackH + 'h tracked against ' + gapPlanH +
          'h planned among ' + (gapIcOnly ? 'time-tracking ICs' : 'time-tracking rocketeers') + ' — ' + gapPct +
          '% of planned hours went untracked; check for blockers or missed Tempo entries');
      }
    }
  }

  // ── Tracking/planning regressions: active before, silent this week ────────
  // Flags rocketeers who logged or planned time in the previous week but show
  // nothing this week (full-PTO-day people excluded — that's absence, not a
  // habit slipping). Counts only, never names. Mirrors the dashboard brief.
  if (prevWeekLabel) {
    const ptoThresh = (typeof CONFIG_PS !== 'undefined' && CONFIG_PS.PTO_IMPACT_THRESHOLD_HRS) || 8;
    // A regression is measured against the person's OWN prior week, so it needs no
    // cohort bar — but the count is attributed, because "3 people stopped logging"
    // reads very differently when all three are managers. Non-tracking families and
    // people on long leave are excluded here too: they were never held to the habit.
    const silentSplit_ = function(hrsKey) {
      const hits = employees.filter(function(e) {
        if (e.isCrewMember || e.tracksTime === false || e.onLeave) return false;
        const prv = e.weeks && e.weeks[prevWeekLabel];
        if (!prv || (prv[hrsKey] || 0) <= 0) return false;
        const cur = e.weeks && e.weeks[weekLabel];
        if (cur && (cur.ptoPlannedHrs || 0) >= ptoThresh) return false;
        return !cur || (cur[hrsKey] || 0) <= 0;
      });
      const mgr = hits.filter(function(e) { return !!e.isManager; }).length;
      return { total: hits.length, mgr: mgr, ic: hits.length - mgr };
    };
    // Omitted when no manager is involved, so the all-IC case reads as before.
    const attr_ = function(s) {
      if (!s.mgr) return '';
      return ' (' + s.ic + ' IC' + (s.ic !== 1 ? 's' : '') + ' · ' +
        s.mgr + ' manager' + (s.mgr !== 1 ? 's' : '') + ')';
    };
    const stoppedT = silentSplit_('trackedHrs');
    if (stoppedT.total >= 3) {
      addI(concerns, 'tracked', '**Tracked time:** ' + stoppedT.total + ' rocketeers who logged hours in ' + prevWeekLabel +
        ' logged none this week' + attr_(stoppedT) + ' — check for blockers or missed Tempo entries');
    } else if (stoppedT.total > 0) {
      addI(notes, 'tracked', '**Tracked time:** ' + stoppedT.total + ' rocketeer' + (stoppedT.total > 1 ? 's' : '') +
        ' who logged hours in ' + prevWeekLabel + ' logged none this week' + attr_(stoppedT));
    }
    const stoppedP = silentSplit_('plannedHrs');
    if (stoppedP.total >= 3) {
      addI(concerns, 'planned', '**Tempo plans:** ' + stoppedP.total + ' rocketeers who planned in ' + prevWeekLabel +
        ' have no plan this week' + attr_(stoppedP) + ' — the planning habit is slipping; supervisors to follow up');
    } else if (stoppedP.total > 0) {
      addI(notes, 'planned', '**Tempo plans:** ' + stoppedP.total + ' rocketeer' + (stoppedP.total > 1 ? 's' : '') +
        ' who planned in ' + prevWeekLabel + ' have no plan this week' + attr_(stoppedP));
    }
  }

  // ── Kudos ─────────────────────────────────────────────────────────────────
  if (kudosCell && kudosCell.value !== null) {
    const kudosPrevCell = getCell(kudosRow, prevWeekLabel);
    const kudosPrev     = kudosPrevCell && kudosPrevCell.value !== null ? kudosPrevCell.value : null;
    const kWow          = kudosPrev !== null ? kudosCell.value - kudosPrev : null;
    const kWowStr       = kWow !== null ? (kWow > 0 ? ' +' + kWow + ' WoW' : kWow < 0 ? ' ' + kWow + ' WoW' : ' flat WoW') : '';
    addI(facts, 'kudos', '**Kudos:** ' + kudosCell.value + ' given this week' + kWowStr);
    if (kudosCell.value > 0) {
      if (kWow !== null && kWow >= 0) {
        addI(highlights, 'kudos', '**Kudos:** ' + kudosCell.value + ' given' + (kWow > 0 ? ', up ' + kWow + ' from last week' : ', matching last week') + ' — recognition momentum sustained (Think Team)');
      } else if (kWow !== null && kWow < 0) {
        addI(notes, 'kudos', '**Kudos:** ' + kudosCell.value + ' given this week, down from ' + kudosPrev + ' last week — keep peer recognition moving');
      } else {
        addI(highlights, 'kudos', '**Kudos:** ' + kudosCell.value + ' given this week — Think Team value in practice');
      }
      // Per-post recognition detail grouped by giver + description
      const postMap = {};
      employees.filter(function(e) { return !e.isCrewMember; }).forEach(function(emp) {
        const kd = emp.weeks && emp.weeks[weekLabel] && emp.weeks[weekLabel].kudos;
        if (!kd || !kd.entries || !kd.entries.length) return;
        kd.entries.forEach(function(e) {
          const key = '\x01' + (e.giver || '') + '\x02' + (e.desc || '');
          if (!postMap[key]) postMap[key] = { giver: e.giver || '', orgValues: e.orgValues || '', recipients: [] };
          if (postMap[key].recipients.indexOf(emp.name) === -1) postMap[key].recipients.push(emp.name);
        });
      });
      const posts = Object.keys(postMap).map(function(k) { return postMap[k]; });
      posts.sort(function(a, b) {
        if (b.recipients.length !== a.recipients.length) return b.recipients.length - a.recipients.length;
        return a.giver.localeCompare(b.giver);
      });
      posts.forEach(function(post) {
        let stars = '';
        for (let si = 0; si < post.recipients.length; si++) stars += '★';
        let line = '**Kudos for ' + post.recipients.join(', ') + '** ' + stars + ' — given by ' + (post.giver || '—');
        if (post.orgValues) line += ' · ' + post.orgValues;
        kudosDetail.push(line);
      });
    } else {
      if (kudosPrev !== null && kudosPrev === 0) {
        addI(concerns, 'kudos', '**Kudos:** none given for the second consecutive week — managers should actively prompt recognition (Think Team)');
      } else if (kudosPrev !== null && kudosPrev > 0) {
        addI(concerns, 'kudos', '**Kudos:** none given this week, down from ' + kudosPrev + ' last week — prompt the team to recognize each other\'s contributions (Think Team)');
      } else {
        addI(concerns, 'kudos', '**Kudos:** none given this week — prompt the team to recognize each other\'s contributions (Think Team)');
      }
    }
  }

  // ── PTO ───────────────────────────────────────────────────────────────────
  if (ptoCell && ptoCell.value !== null) {
    const ptoPct = ptoCell.value;
    const sub    = ptoCell.sub || '';
    const arM    = sub.match(/(\d+)\s+need/);
    const arN    = arM ? parseInt(arM[1]) : null;
    // At-risk count renders red so managers can spot and act on it at a glance.
    const arStr = arN === null ? '' : (arN > 0 ? ' ({red}' + arN + ' at risk{/red})' : ' (0 at risk)');
    addI(facts, 'pto', '**PTO compliance:** ' + ptoPct + '%' + arStr);
    if (ptoPct >= 80) {
      addI(highlights, 'pto', '**PTO:** ' + ptoPct + '% of the team has PTO under control' + (arN === 0 ? ' — full team recovery planned' : '') + '; sustainable pace maintained');
      if (arN > 0) {
        addI(notes, 'pto', '**PTO:** {red}' + arN + ' rocketeer' + (arN > 1 ? 's' : '') + ' need a recovery plan{/red} — managers to schedule PTO with each of them');
      }
    } else if (ptoPct >= 60) {
      addI(notes, 'pto', '**PTO:** compliance at ' + ptoPct + '%' + (arN !== null ? ' — {red}' + arN + ' rocketeer' + (arN > 1 ? 's' : '') + ' need a recovery plan{/red}' : '') + '; monitor before year-end');
    } else {
      addI(concerns, 'pto', '**PTO:** compliance at ' + ptoPct + '%' +
        (arN !== null ? ' — {red}' + arN + ' rocketeer' + (arN > 1 ? 's' : '') + ' need a recovery plan{/red}' : '') +
        ' (Build Process to Drive Outcomes — sustainable pace at risk)');
    }
  }

  // NOTE — RCR and SI are deliberately OMITTED from the weekly post: they update
  // monthly/quarterly, so they never move week to week, and the Team Contribution
  // Pulse image at the top of the post already carries those benchmarks. They
  // remain in the dashboard's period (month/quarter) brief where they do change.

  // ── Historical trends (last 3–4 closed weeks) ────────────────────────────
  const closedH = history.filter(function(h) { return !h.isCurrentWeek; });
  if (closedH.length >= 3) {
    const recent = closedH.slice(-4);

    // "Rising" requires BOTH window-over-window growth AND no decline into the
    // current week — otherwise a WoW dip prints as "momentum building" right next
    // to a negative WoW fact.
    const tAvg   = recent.map(function(h) { return +(h.avgHrs || 0).toFixed(1); });
    const tUp    = tAvg[tAvg.length - 1] > tAvg[0] && tAvg[tAvg.length - 1] >= tAvg[tAvg.length - 2];
    const tFloor = tAvg.every(function(v) { return v >= 28; });
    if (tFloor && tUp) {
      const tStr = recent.map(function(h, i) { return h.label + ' ' + tAvg[i] + 'h'; }).join(' → ');
      addI(highlights, 'tracked', '**Tracked time:** improving ' + tStr + '/person — delivery momentum building');
    }

    // Compliance and comment-pace trends merge into ONE bullet when both rise, so
    // the integrated signal (writing AND discussing goals) reads as one story.
    let gcRising = null;
    if (goalsRow) {
      const gcArr   = recent.map(function(h) { const c = getCell(goalsRow, h.label); return (c && c.value !== null) ? c.value : null; });
      const gcValid = gcArr.filter(function(v) { return v !== null; });
      if (gcValid.length >= 3 && gcValid[gcValid.length - 1] > gcValid[0] &&
          gcValid[gcValid.length - 1] >= gcValid[gcValid.length - 2]) {
        gcRising = recent.map(function(h, i) { return gcArr[i] !== null ? h.label + ' ' + gcArr[i] + '%' : null; }).filter(Boolean).join(' → ');
      }
    }

    const cArr = recent.map(function(h) { return +(h.avgCommentsPerPerson || 0).toFixed(1); });
    const cRising = (cArr[cArr.length - 1] > cArr[0] && cArr[cArr.length - 1] >= cArr[cArr.length - 2] && cArr[cArr.length - 1] >= 2)
      ? recent.map(function(h, i) { return h.label + ' ' + cArr[i]; }).join(' → ') : null;

    if (gcRising && cRising) {
      addI(highlights, 'goals', '**Goals & engagement rising together:** compliance ' + gcRising +
        ' with self-comment pace ' + cRising + '/person — rocketeers are writing AND discussing commitments throughout the quarter, not just at the deadline');
    } else if (gcRising) {
      addI(highlights, 'goals', '**Goals:** compliance rising ' + gcRising + ' — documentation habits building quarter over quarter');
    } else if (cRising) {
      addI(highlights, 'goals', '**Goals:** self-comment pace accelerating ' + cRising + '/person — engagement with quarterly commitments growing');
    }

    if (kudosRow) {
      let streak = 0;
      for (let ki = closedH.length - 1; ki >= 0; ki--) {
        const kc = getCell(kudosRow, closedH[ki].label);
        if (kc && kc.value > 0) streak++; else break;
      }
      if (streak >= 2) addI(highlights, 'kudos', '**Kudos:** ' + streak + ' consecutive weeks of peer recognition — Think Team value sustained in practice');
    }
  }

  if (!facts.length)      addI(facts, 'other', 'Metric data unavailable for ' + weekLabel);
  if (!highlights.length) addI(highlights, 'other', 'Team operational metrics stable — no exceptional positive signals this week');
  if (!notes.length)      addI(notes, 'other', 'No watch items this week — all metrics within expected range');
  if (!concerns.length)   addI(concerns, 'other', 'No critical concerns — maintain current trajectory across all dimensions');

  return { weekLabel: weekLabel, facts: orderI(facts), highlights: orderI(highlights), notes: orderI(notes), concerns: orderI(concerns), kudosDetail: kudosDetail };
}


// ── SECTION: CORE LOGIC ──────────────────────────────────────

/**
 * MAIN ENTRY POINT — called from the dashboard with the week's computed content.
 *
 * NOTE: Do not run this directly from the editor — it needs `payload`. Use
 * runPublishTest() or previewWeeklyTarget() instead.
 *
 * Behaviour:
 *   - If this week's post exists  -> update section C only.
 *   - If it does not exist        -> create it from the standard template
 *                                    (with C filled from the payload), provided
 *                                    CONFIG_POST.CREATE_IF_MISSING is true.
 *
 * Section content priority:
 *   1. Pre-built sections in payload (e.g. Gemini-enhanced from the dashboard) — used as-is.
 *   2. No sections in payload (e.g. called from the editor) → buildBlogSections_() assembles
 *      them server-side from the live PS report data.
 *
 * Two distinct weeks are in play (weekly briefs publish THIS week's page with LAST
 * week's data, so they differ by design):
 *   • weekLabel     — the DATA week the content reflects (last completed week).
 *   • postWeekLabel — the week the PAGE is titled/targeted by (the current calendar
 *                     week). Falls back to weekLabel when omitted.
 *
 * @param {{
 *   weekLabel:     (string|undefined),  DATA week, e.g. "2026.W28"; omitted = current ISO week
 *   postWeekLabel: (string|undefined),  PAGE week, e.g. "2026.W29"; omitted = weekLabel
 *   facts:         (string[]|undefined),
 *   highlights:    (string[]|undefined),
 *   notes:         (string[]|undefined),
 *   concerns:      (string[]|undefined),
 *   kudosDetail:   (string[]|undefined),  per-post kudos lines — rendered as a collapsed expand under Highlights

 *   blogPostId:    (string|undefined)   force a specific post (testing); usually omitted
 * }} payload
 * @returns {{ ok: boolean, created?: boolean, url?: string, title?: string,
 *             weekLabel?: string, dataWeekLabel?: string, blogPostId?: string,
 *             areasUpdated?: string[], areasMissing?: string[], error?: string }}
 *             (weekLabel = the PAGE week acted on; dataWeekLabel = the CONTENT week)
 */
function publishContributionSection(payload) {
  try {
    Logger.log(`🕐 [publishContributionSection] Started at ${new Date().toISOString()}`);

    // Step 0: Basic payload guard (so a stray "Run" in the editor fails LOUDLY)
    if (!payload || typeof payload !== 'object') {
      Logger.log('⚠️ [publishContributionSection] No payload received. If you are testing from the editor, run runPublishTest() or previewWeeklyTarget() instead of running this function directly.');
      return { ok: false, error: 'No payload. Call from the dashboard, or use runPublishTest()/previewWeeklyTarget() to test from the editor.' };
    }

    // Step 1: Only admins may publish (real gate from PS Security.js).
    // hasAdminPower_ covers superadmin AND admin — a bare role !== 'admin' here
    // locked super admins out of publishing, which is the exact failure the
    // role-predicate rule in PS Security.js exists to prevent.
    const access = checkDashboardAccess();
    if (!access || !hasAdminPower_(access)) {
      Logger.log(`⚠️ [publishContributionSection] Blocked: requires admin access (got role="${access && access.role}").`);
      return { ok: false, error: 'Publish requires admin access.' };
    }

    // Step 2: Load and validate Confluence credentials
    const cfg = getConfluenceConfig_(access.email);

    // Step 3: Decide the two weeks in play (they differ by design — see JSDoc):
    //   dataWeekLabel — the week the CONTENT reflects (last completed week). Drives
    //                   server-side section building.
    //   postWeekLabel — the PAGE we publish TO (the current calendar week). Drives the
    //                   post title, lookup, and creation.
    const dataWeekLabel = payload.weekLabel || isoWeekLabel_(new Date());
    const postWeekLabel = payload.postWeekLabel || dataWeekLabel;
    Logger.log(`ℹ️ [publishContributionSection] Post week: ${postWeekLabel} · data week: ${dataWeekLabel}`);

    // Step 3b: If the payload has no pre-built sections, build them server-side from the PS report.
    // Pre-built sections (e.g. Gemini-enhanced from the dashboard) are used as-is when present.
    // Sections always reflect the DATA week, never the (later) post week.
    const hasSections = Array.isArray(payload.facts) && payload.facts.length > 0;
    const sections = hasSections ? payload : buildBlogSections_(dataWeekLabel);
    if (!hasSections) Logger.log(`ℹ️ [publishContributionSection] Sections built server-side for ${dataWeekLabel}`);

    const existingId = payload.blogPostId || cfg.blogPostId || findBlogPostIdByWeek_(cfg, postWeekLabel);

    // Step 4a: POST EXISTS -> read, update section C, save back
    if (existingId) {
      Logger.log(`ℹ️ [publishContributionSection] Found existing post id ${existingId} — updating section C.`);
      const post   = getBlogPostAdf_(cfg, existingId);
      const result = updateContributionSection_(post.doc, sections);
      if (!result.areasUpdated.length) {
        Logger.log(`⚠️ [publishContributionSection] "${CONFIG_POST.SECTION_HEADING}" found but none of its info/success/note/warning panels were present.`);
        return { ok: false, error: `Found "${CONFIG_POST.SECTION_HEADING}" but none of its four panels. Check the template.` };
      }
      if (result.areasMissing.length) {
        Logger.log(`⚠️ [publishContributionSection] Panels not found, skipped: ${result.areasMissing.join(', ')}`);
      }
      const saved = putBlogPostAdf_(cfg, existingId, post, post.doc, postWeekLabel);
      Logger.log(`✅ [publishContributionSection] Updated [${result.areasUpdated.join(', ')}] in "${post.title}" — ${saved.url}`);
      return {
        ok: true, created: false, url: saved.url, title: post.title,
        weekLabel: postWeekLabel, dataWeekLabel: dataWeekLabel,
        blogPostId: existingId, areasUpdated: result.areasUpdated, areasMissing: result.areasMissing,
      };
    }

    // Step 4b: POST MISSING -> create from template (with C pre-filled), then post it
    if (!CONFIG_POST.CREATE_IF_MISSING) {
      Logger.log(`⚠️ [publishContributionSection] No post for ${postWeekLabel} and CREATE_IF_MISSING is off — nothing done.`);
      return { ok: false, error: `No post found for "${CONFIG_POST.BLOG_TITLE_PREFIX} ${postWeekLabel}" and CREATE_IF_MISSING is off.` };
    }
    Logger.log(`ℹ️ [publishContributionSection] No post for ${postWeekLabel} — creating from template.`);

    const doc    = buildWeeklyTemplateDoc_(postWeekLabel);  // B / A / C, all four panels each
    const result = updateContributionSection_(doc, sections); // fill section C in memory
    const created = createWeeklyBlogPost_(cfg, postWeekLabel, doc);

    Logger.log(`✅ [publishContributionSection] Created "${created.title}" (id ${created.id}) and set [${result.areasUpdated.join(', ')}] — ${created.url}`);
    return {
      ok: true, created: true, url: created.url, title: created.title,
      weekLabel: postWeekLabel, dataWeekLabel: dataWeekLabel,
      blogPostId: created.id, areasUpdated: result.areasUpdated, areasMissing: result.areasMissing,
    };

  } catch (e) {
    Logger.log(`❌ [publishContributionSection] ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Read-only check: resolves this week's post and reports what is in section C,
 * or that the post would be created. Writes nothing. Safe to run any time.
 * @returns {Object} A summary object (also written to the logs).
 */
function previewWeeklyTarget() {
  try {
    Logger.log(`🕐 [previewWeeklyTarget] Started at ${new Date().toISOString()}`);

    const access    = checkDashboardAccess();
    // Read-only, but it returns the live Confluence post's contents — and it is
    // callable via google.script.run by anyone who can load the dashboard.
    // Same gate as the publish it previews.
    if (!hasAdminPower_(access)) {
      Logger.log(`⚠️ [previewWeeklyTarget] Blocked for ${access.email} (${access.role}).`);
      return { ok: false, error: 'Preview requires admin access.' };
    }
    const cfg       = getConfluenceConfig_(access && access.email);
    const weekLabel = isoWeekLabel_(new Date());
    const blogPostId = cfg.blogPostId || findBlogPostIdByWeek_(cfg, weekLabel);

    if (!blogPostId) {
      Logger.log(`ℹ️ [previewWeeklyTarget] No post for ${weekLabel}. It would be ${CONFIG_POST.CREATE_IF_MISSING ? 'CREATED from template' : 'an ERROR (CREATE_IF_MISSING is off)'}.`);
      return { ok: true, weekLabel: weekLabel, exists: false, wouldCreate: CONFIG_POST.CREATE_IF_MISSING };
    }

    const post  = getBlogPostAdf_(cfg, blogPostId);
    const found = inspectContributionSection_(post.doc);
    Logger.log(`ℹ️ [previewWeeklyTarget] Post: "${post.title}" (id ${blogPostId})`);
    Logger.log(`ℹ️ [previewWeeklyTarget] Owners line present: ${found.hasOwners ? 'yes' : 'NO'}`);
    Logger.log(`ℹ️ [previewWeeklyTarget] Panels found: ${found.panels.length ? found.panels.join(', ') : 'NONE'}`);
    Logger.log('✅ [previewWeeklyTarget] Done (nothing was changed).');
    return { ok: true, weekLabel: weekLabel, exists: true, blogPostId: blogPostId, title: post.title, found: found };
  } catch (e) {
    Logger.log(`❌ [previewWeeklyTarget] ${e.message}`);
    return { ok: false, error: e.message || String(e) };
  }
}


// ── SECTION: HELPERS — CREDENTIALS & ENDPOINTS ───────────────

/**
 * Loads Confluence credentials from Script Properties and builds API base URLs.
 * @param {string} fallbackEmail Email to use if CONFLUENCE_EMAIL is unset.
 * @returns {{cloudId:string, authHeader:string, spaceKey:string, spaceId:string|null,
 *            blogPostId:string|null, apiRoot:string, v2:string, search:string,
 *            siteBase:string}}
 * @throws {Error} If any required credential is missing.
 */
function getConfluenceConfig_(fallbackEmail) {
  const p        = PropertiesService.getScriptProperties();
  const cloudId  = p.getProperty('CONFLUENCE_CLOUD_ID');
  const apiToken = p.getProperty('CONFLUENCE_API_TOKEN');
  const email    = p.getProperty('CONFLUENCE_EMAIL') || fallbackEmail;

  if (!cloudId || !apiToken) {
    throw new Error('Set CONFLUENCE_CLOUD_ID and CONFLUENCE_API_TOKEN — run setConfluenceConfig() once.');
  }
  if (!email) {
    throw new Error('Set CONFLUENCE_EMAIL — it must match the Atlassian account that owns the API token.');
  }

  const apiRoot = `https://api.atlassian.com/ex/confluence/${cloudId}`;
  return {
    cloudId:    cloudId,
    authHeader: 'Basic ' + Utilities.base64Encode(`${email}:${apiToken}`),
    spaceKey:   p.getProperty('CONFLUENCE_SPACE_KEY') || CONFIG_POST.SPACE_KEY,
    spaceId:    p.getProperty('CONFLUENCE_SPACE_ID')  || CONFIG_POST.SPACE_ID || null,
    blogPostId: p.getProperty('CONFLUENCE_BLOG_POST_ID') || null,
    apiRoot:    apiRoot,
    v2:         `${apiRoot}/wiki/api/v2`,
    search:     `${apiRoot}/wiki/rest/api/content/search`,
    siteBase:   'https://rocketeers.atlassian.net/wiki',
  };
}

/**
 * Finds the blog-post id for a given ISO week label, within the space.
 *
 * IMPORTANT: this LISTS blog posts from the content API (which reads the
 * database) and matches the title in code. It deliberately does NOT use CQL
 * search, because (a) Confluence's search tokenizer splits "2026.W26" on the
 * dot so `title ~ "2026.W26"` never matches, and (b) the search index lags
 * behind newly created posts by minutes-to-hours, so a post we just created
 * would not be found and we'd wrongly create a duplicate. The content API has
 * neither problem.
 *
 * @param {Object} cfg       Config from getConfluenceConfig_.
 * @param {string} weekLabel e.g. "2026.W26".
 * @returns {string|null} The post id, or null if not found.
 * @throws {Error} On HTTP errors.
 */
function findBlogPostIdByWeek_(cfg, weekLabel) {
  const spaceId   = resolveSpaceId_(cfg);
  const fullTitle = `${CONFIG_POST.BLOG_TITLE_PREFIX} ${weekLabel}`; // "This Week: 2026.W26"
  let cursor = '';

  // Page through newest-first; the current week is at the top, so this is fast.
  // The 5-page cap is a safety net (5 x 100 = 500 posts ≈ many years of weeks).
  for (let page = 0; page < 5; page++) {
    let url = `${cfg.v2}/blogposts?space-id=${encodeURIComponent(spaceId)}` +
              `&status=current&sort=-created-date&limit=100`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    const resp = UrlFetchApp.fetch(url, {
      headers: { 'Authorization': cfg.authHeader, 'Accept': 'application/json' },
      muteHttpExceptions: true,
    });
    const code = resp.getResponseCode();
    const text = resp.getContentText();
    if (code >= 400) {
      Logger.log(`❌ [findBlogPostIdByWeek_] HTTP ${code}: ${text.substring(0, 300)}`);
      throw new Error(`Blog-post listing failed (HTTP ${code}). Check CONFLUENCE_CLOUD_ID and credentials.`);
    }

    const json    = JSON.parse(text);
    const results = json.results || [];

    // Exact title match preferred; fall back to "title contains the week label".
    const match = results.filter(function (r) {
      return r && r.title && (r.title === fullTitle || r.title.indexOf(weekLabel) >= 0);
    })[0];
    if (match) return match.id;

    // Follow the next-page cursor if Confluence provided one; otherwise stop.
    const next = json._links && json._links.next;
    if (!next) break;
    const m = String(next).match(/[?&]cursor=([^&]+)/);
    cursor = m ? decodeURIComponent(m[1]) : '';
    if (!cursor) break;
  }

  return null;
}

/**
 * Fetches a blog post's body as ADF and parses it.
 * @param {Object} cfg        Config from getConfluenceConfig_.
 * @param {string} blogPostId The blog post id.
 * @returns {{id:string, title:string, version:number, doc:Object}}
 * @throws {Error} On HTTP errors or unexpected body.
 */
function getBlogPostAdf_(cfg, blogPostId) {
  const url = `${cfg.v2}/blogposts/${encodeURIComponent(blogPostId)}?body-format=atlas_doc_format`;
  const resp = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': cfg.authHeader, 'Accept': 'application/json' },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 400) {
    Logger.log(`❌ [getBlogPostAdf_] HTTP ${code}: ${text.substring(0, 300)}`);
    throw new Error(`Could not read blog post ${blogPostId} (HTTP ${code}).`);
  }

  const json = JSON.parse(text);
  let doc = json.body && json.body.atlas_doc_format && json.body.atlas_doc_format.value;
  if (typeof doc === 'string') doc = JSON.parse(doc); // v2 returns the ADF as a JSON string
  if (!doc || !Array.isArray(doc.content)) {
    throw new Error(`Blog post ${blogPostId} did not return ADF content as expected.`);
  }

  return {
    id:      json.id,
    title:   json.title,
    version: (json.version && json.version.number) || 1,
    doc:     doc,
  };
}

/**
 * Saves an updated ADF doc back to a blog post, bumping the version by 1.
 * @param {Object} cfg        Config from getConfluenceConfig_.
 * @param {string} blogPostId The blog post id.
 * @param {{title:string, version:number}} post The post read earlier.
 * @param {Object} doc        The modified ADF document.
 * @param {string} weekLabel  Used for the version message.
 * @returns {{url:string}}
 * @throws {Error} On HTTP errors.
 */
function putBlogPostAdf_(cfg, blogPostId, post, doc, weekLabel) {
  const body = {
    id:      String(blogPostId),
    status:  'current',
    title:   post.title,
    version: { number: post.version + 1, message: `Contribution section auto-update ${weekLabel}` },
    body:    { representation: 'atlas_doc_format', value: JSON.stringify(doc) },
  };

  const resp = UrlFetchApp.fetch(`${cfg.v2}/blogposts/${encodeURIComponent(blogPostId)}`, {
    method: 'put',
    contentType: 'application/json',
    headers: { 'Authorization': cfg.authHeader },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 400) {
    Logger.log(`❌ [putBlogPostAdf_] HTTP ${code}: ${text.substring(0, 300)}`);
    let err; try { err = JSON.parse(text); } catch (_) { err = {}; }
    throw new Error(`Save failed (HTTP ${code}): ${err.message || text.substring(0, 200)}`);
  }

  const json = JSON.parse(text);
  const webui = json._links && json._links.webui;
  return { url: webui ? `${cfg.siteBase}${webui}` : '' };
}

/**
 * Creates a new blog post in the space from a prepared ADF document.
 * @param {Object} cfg       Config from getConfluenceConfig_.
 * @param {string} weekLabel e.g. "2026.W26" (used for the title).
 * @param {Object} doc       The ADF document to publish.
 * @returns {{id:string, title:string, url:string}}
 * @throws {Error} On HTTP errors or if the space id can't be resolved.
 */
function createWeeklyBlogPost_(cfg, weekLabel, doc) {
  const spaceId = resolveSpaceId_(cfg);
  const title   = `${CONFIG_POST.BLOG_TITLE_PREFIX} ${weekLabel}`;

  const body = {
    spaceId: String(spaceId),
    status:  'current',
    title:   title,
    body:    { representation: 'atlas_doc_format', value: JSON.stringify(doc) },
  };

  const resp = UrlFetchApp.fetch(`${cfg.v2}/blogposts`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Authorization': cfg.authHeader },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 400) {
    Logger.log(`❌ [createWeeklyBlogPost_] HTTP ${code}: ${text.substring(0, 300)}`);
    let err; try { err = JSON.parse(text); } catch (_) { err = {}; }
    throw new Error(`Create failed (HTTP ${code}): ${err.message || text.substring(0, 200)}`);
  }

  const json  = JSON.parse(text);
  const webui = json._links && json._links.webui;
  return { id: json.id, title: title, url: webui ? `${cfg.siteBase}${webui}` : '' };
}

/**
 * Resolves the numeric space id used when creating a post:
 * Script Property override -> CONFIG_POST.SPACE_ID -> dynamic /spaces lookup by key.
 * @param {Object} cfg Config from getConfluenceConfig_.
 * @returns {string} The numeric space id.
 * @throws {Error} If it cannot be resolved.
 */
function resolveSpaceId_(cfg) {
  if (cfg.spaceId) return cfg.spaceId;

  const resp = UrlFetchApp.fetch(`${cfg.v2}/spaces?keys=${encodeURIComponent(cfg.spaceKey)}`, {
    headers: { 'Authorization': cfg.authHeader, 'Accept': 'application/json' },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  if (code >= 400) {
    Logger.log(`❌ [resolveSpaceId_] HTTP ${code}: ${text.substring(0, 300)}`);
    throw new Error(`Could not resolve space id for "${cfg.spaceKey}". Set CONFIG_POST.SPACE_ID.`);
  }
  const results = (JSON.parse(text).results) || [];
  const id = results[0] && results[0].id;
  if (!id) throw new Error(`Space "${cfg.spaceKey}" not found. Set CONFIG_POST.SPACE_ID.`);
  return String(id);
}


// ── SECTION: HELPERS — TEMPLATE BUILDING ─────────────────────

/**
 * Builds a fresh weekly post as an ADF document: each configured section with
 * its owner mentions and the four empty sub-panels (Facts/Highlights/Notes/Concerns).
 * @param {string} weekLabel e.g. "2026.W26" (kept for clarity; not embedded in body).
 * @returns {Object} An ADF document ({type:'doc', version:1, content:[...]}).
 */
function buildWeeklyTemplateDoc_(weekLabel) {
  const content = [];

  CONFIG_POST.TEMPLATE_SECTIONS.forEach(function (section, idx) {
    // Visual separator between sections (not before the first)
    if (idx > 0) content.push({ type: 'rule' });

    // Section heading (H1) + owners line
    content.push({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: section.heading }] });
    content.push(buildOwnersParagraph_(section.owners));

    // The four sub-panels, each followed by an empty "—" bullet list
    CONFIG_POST.TEMPLATE_AREAS.forEach(function (area) {
      content.push(buildPanel_(area.panelType, area.title));
      content.push(buildBulletList_([]));
    });
  });

  return { type: 'doc', version: 1, content: content };
}

/**
 * Builds the owners paragraph: a row of @mentions separated by spaces.
 * @param {{id:string, name:string}[]} owners Owner account ids + display names.
 * @returns {Object} An ADF paragraph node.
 */
function buildOwnersParagraph_(owners) {
  const inline = [];
  (owners || []).forEach(function (o, i) {
    if (i > 0) inline.push({ type: 'text', text: ' ' });
    inline.push({ type: 'mention', attrs: { id: o.id, text: o.name } });
  });
  if (!inline.length) inline.push({ type: 'text', text: ' ' });
  return { type: 'paragraph', content: inline };
}

/**
 * Builds a coloured panel with a level-3 heading title.
 * @param {string} panelType One of info/success/note/warning.
 * @param {string} title     The panel title text (e.g. "Facts").
 * @returns {Object} An ADF panel node.
 */
function buildPanel_(panelType, title) {
  return {
    type: 'panel',
    attrs: { panelType: panelType },
    content: [{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: title }] }],
  };
}


// ── SECTION: HELPERS — ADF SECTION EDITING ───────────────────

/**
 * Replaces the bullet list under each of the four panels in section C, in place.
 * Everything else in the section (heading, @owner mentions, chart images,
 * spacers) is left untouched. Only section C is affected.
 *
 * @param {Object} doc     The ADF document (mutated in place).
 * @param {Object} payload Object with facts/highlights/notes/concerns arrays.
 * @returns {{areasUpdated:string[], areasMissing:string[]}}
 * @throws {Error} If the section heading cannot be found.
 */
function updateContributionSection_(doc, payload) {
  const content = doc.content;

  const bounds = findSectionBounds_(content);
  if (bounds.start < 0) {
    throw new Error(`Could not find the "${CONFIG_POST.SECTION_HEADING}" heading in the post.`);
  }

  const rebuilt = [];
  const areasUpdated = [];
  const foundPanelTypes = {};

  let i = bounds.start;
  while (i < bounds.end) {
    const node = content[i];
    rebuilt.push(node);

    const panelType = node && node.type === 'panel' && node.attrs && node.attrs.panelType;
    const areaKey   = panelType && CONFIG_POST.PANEL_TO_AREA[panelType];

    if (areaKey) {
      foundPanelTypes[panelType] = true;

      // Skip the existing body nodes for this area (until the next structural node).
      // expand is deliberately NOT structural, so last week's kudos expand is
      // swallowed and replaced here along with the bullet list.
      let j = i + 1;
      while (j < bounds.end && !isStructuralNode_(content[j])) j++;

      rebuilt.push(buildBulletList_(payload[areaKey]));
      if (areaKey === 'highlights' && Array.isArray(payload.kudosDetail) && payload.kudosDetail.length) {
        rebuilt.push(buildKudosExpand_(payload.kudosDetail));
      }
      areasUpdated.push(areaKey);
      i = j;
      continue;
    }
    i++;
  }

  doc.content = content.slice(0, bounds.start)
    .concat(rebuilt)
    .concat(content.slice(bounds.end));

  const areasMissing = Object.keys(CONFIG_POST.PANEL_TO_AREA)
    .filter(function (pt) { return !foundPanelTypes[pt]; })
    .map(function (pt) { return CONFIG_POST.PANEL_TO_AREA[pt]; });

  return { areasUpdated: areasUpdated, areasMissing: areasMissing };
}

/**
 * Read-only inspection of section C: reports whether the owners line and each
 * panel are present. Used by previewWeeklyTarget().
 * @param {Object} doc The ADF document.
 * @returns {{hasOwners:boolean, panels:string[]}}
 */
function inspectContributionSection_(doc) {
  const content = doc.content;
  const bounds  = findSectionBounds_(content);
  if (bounds.start < 0) return { hasOwners: false, panels: [] };

  let hasOwners = false;
  const panels = [];
  for (let i = bounds.start + 1; i < bounds.end; i++) {
    const node = content[i];
    if (node && node.type === 'paragraph' && containsMention_(node)) hasOwners = true;
    if (node && node.type === 'panel' && node.attrs && CONFIG_POST.PANEL_TO_AREA[node.attrs.panelType]) {
      panels.push(CONFIG_POST.PANEL_TO_AREA[node.attrs.panelType]);
    }
  }
  return { hasOwners: hasOwners, panels: panels };
}

/**
 * Finds the [start, end) index range of section C within a content array.
 * Section runs from its H1 heading up to (but not including) the next H1 heading,
 * or the end of the document.
 * @param {Object[]} content The ADF top-level content array.
 * @returns {{start:number, end:number}} start is -1 if the heading is not found.
 */
function findSectionBounds_(content) {
  let start = -1;

  for (let i = 0; i < content.length; i++) {
    if (isHeadingLevel1_(content[i]) && nodeText_(content[i]).trim() === CONFIG_POST.SECTION_HEADING) {
      start = i; break;
    }
  }
  if (start < 0) {
    for (let i = 0; i < content.length; i++) {
      if (isHeadingLevel1_(content[i]) && nodeText_(content[i]).indexOf('Contribution Team Updates') >= 0) {
        start = i; break;
      }
    }
  }
  if (start < 0) return { start: -1, end: -1 };

  let end = content.length;
  for (let i = start + 1; i < content.length; i++) {
    if (isHeadingLevel1_(content[i])) { end = i; break; }
  }
  return { start: start, end: end };
}

/**
 * Converts one bullet string into ADF inline text nodes, honouring the brief's
 * lightweight markup: **bold** → strong mark, {red}…{/red} → red textColor (+strong,
 * so the at-risk number pops the same way it does in the dashboard preview).
 * Text outside the markers becomes plain text nodes. No nesting support.
 * @param {string} text A bullet string, possibly containing markers.
 * @returns {Object[]} ADF inline text nodes.
 */
function briefInlineNodes_(text) {
  const nodes = [];
  const re = /\*\*([^*]+)\*\*|\{red\}([\s\S]+?)\{\/red\}/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push({ type: 'text', text: text.substring(last, m.index) });
    if (m[1] !== undefined) {
      nodes.push({ type: 'text', text: m[1], marks: [{ type: 'strong' }] });
    } else {
      nodes.push({ type: 'text', text: m[2], marks: [{ type: 'strong' }, { type: 'textColor', attrs: { color: '#DE350B' } }] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.substring(last) });
  if (!nodes.length) nodes.push({ type: 'text', text: text });
  return nodes;
}

/**
 * Builds an ADF bulletList node from an array of bullet strings (plain text plus
 * the optional **bold** / {red}…{/red} markers — see briefInlineNodes_).
 * Empty/blank entries are dropped; an empty list becomes a single "—" item so
 * the panel is never left blank (and so there is always a list to replace next week).
 * @param {string[]} items Bullet strings.
 * @returns {Object} An ADF bulletList node.
 */
function buildBulletList_(items) {
  const cleaned = (Array.isArray(items) ? items : [])
    .map(function (t) { return String(t == null ? '' : t).trim(); })
    .filter(function (t) { return t.length > 0; });

  const finalItems = cleaned.length ? cleaned : ['—'];

  return {
    type: 'bulletList',
    content: finalItems.map(function (text) {
      return {
        type: 'listItem',
        content: [{ type: 'paragraph', content: briefInlineNodes_(text) }],
      };
    }),
  };
}

/**
 * Builds a collapsed ADF expand holding the per-post kudos recognition lines.
 * Rendered right under the Highlights bullet list: readers see one titled,
 * closed expand instead of 100+ bullets, and open it only when they want the
 * full recognition roll.
 * @param {string[]} items Kudos detail bullet strings ("**Kudos for …** ★ — given by …").
 * @returns {Object} An ADF expand node.
 */
function buildKudosExpand_(items) {
  const stars = items.join('').split('★').length - 1;
  return {
    type: 'expand',
    attrs: {
      title: '🏅 Recognition detail — ' + items.length + ' kudos post' + (items.length !== 1 ? 's' : '') +
             ' · ' + stars + ' kudos (click to expand)',
    },
    content: [buildBulletList_(items)],
  };
}

/**
 * A node is "structural" if it marks the start of the next area, chart, or
 * section — i.e. where an area's body content stops.
 * @param {Object} node An ADF node.
 * @returns {boolean}
 */
function isStructuralNode_(node) {
  if (!node) return false;
  return node.type === 'panel'
      || node.type === 'mediaSingle'
      || node.type === 'rule'
      || node.type === 'heading';
}

/**
 * @param {Object} node An ADF node.
 * @returns {boolean} True if it is a level-1 heading.
 */
function isHeadingLevel1_(node) {
  return !!node && node.type === 'heading' && node.attrs && node.attrs.level === 1;
}

/**
 * @param {Object} node An ADF node (typically a paragraph).
 * @returns {boolean} True if it directly contains a mention.
 */
function containsMention_(node) {
  return !!node && Array.isArray(node.content)
    && node.content.some(function (c) { return c && c.type === 'mention'; });
}

/**
 * Recursively extracts the plain text of an ADF node.
 * @param {Object} node An ADF node.
 * @returns {string}
 */
function nodeText_(node) {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(nodeText_).join('');
  return '';
}


// ── SECTION: HELPERS — ISO WEEK ──────────────────────────────

/**
 * Returns the ISO-8601 week label for a date, e.g. "2026.W26".
 * Uses ISO rules (weeks start Monday; week 1 contains the year's first Thursday),
 * so the year part is the ISO week-year, not always the calendar year.
 * @param {Date} date Any date.
 * @returns {string} Label in the form "YYYY.Www".
 */
function isoWeekLabel_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week

  const isoYear = d.getUTCFullYear();

  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);

  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${isoYear}.W${String(week).padStart(2, '0')}`;
}


// ── SECTION: TEST & DIAGNOSTICS (run from the editor) ────────

/**
 * Writes a small set of PLACEHOLDER bullets into this week's section C to verify
 * end-to-end behaviour (creates the post first if it doesn't exist). Re-run the
 * dashboard afterwards to put the real content back.
 *
 * ➜ THIS is the function to run from the editor when testing — not
 *   publishContributionSection (which needs a payload and will no-op).
 * @returns {Object} The result of publishContributionSection().
 */
function runPublishTest() {
  // Publishes a real TEST section to the live Confluence post, so it is gated in
  // its own right — publishContributionSection would refuse anyway, but relying on
  // the callee's gate leaves the intent unstated and the log line unhelpful.
  requireMaintainer_('runPublishTest');
  const result = publishContributionSection({
    // weekLabel omitted -> current ISO week
    facts:      ['TEST — connectivity check, please ignore', 'Second test fact'],
    highlights: ['TEST highlight — owners and charts should be untouched'],
    notes:      ['TEST note'],
    concerns:   ['TEST concern'],
  });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Prints what is currently stored in Script Properties (no secrets are shown).
 * @returns {void}
 */
function diagnoseConfig_() {
  const p = PropertiesService.getScriptProperties();
  let access; try { access = checkDashboardAccess(); } catch (_) { access = {}; }

  Logger.log('=== PS_POST CONFIGURATION ===');
  Logger.log('User: ' + (access.email || 'unknown') + ' | Role: ' + (access.role || 'unknown'));
  Logger.log('CONFLUENCE_CLOUD_ID:      ' + (p.getProperty('CONFLUENCE_CLOUD_ID')  ? 'SET' : 'NOT SET'));
  Logger.log('CONFLUENCE_API_TOKEN:     ' + (p.getProperty('CONFLUENCE_API_TOKEN') ? 'SET' : 'NOT SET'));
  Logger.log('CONFLUENCE_EMAIL:         ' + (p.getProperty('CONFLUENCE_EMAIL') || 'NOT SET (will use session email)'));
  Logger.log('CONFLUENCE_SPACE_KEY:     ' + (p.getProperty('CONFLUENCE_SPACE_KEY') || 'default ' + CONFIG_POST.SPACE_KEY));
  Logger.log('CONFLUENCE_SPACE_ID:      ' + (p.getProperty('CONFLUENCE_SPACE_ID')  || 'default ' + CONFIG_POST.SPACE_ID));
  Logger.log('CONFLUENCE_BLOG_POST_ID:  ' + (p.getProperty('CONFLUENCE_BLOG_POST_ID') || 'not set (auto-find/create by week)'));
  Logger.log('CREATE_IF_MISSING:        ' + CONFIG_POST.CREATE_IF_MISSING);
  Logger.log('This week label:          ' + isoWeekLabel_(new Date()));
}


// ============================================================
// 🚀  GETTING STARTED
// ============================================================
// 1. Paste this file into your existing GAS project (with "PS Contribution
//    Report.js" and "PS Security.js"). The config object is CONFIG_POST so it
//    does not collide with the CONFIG declared in the other file.
//
// 2. Fill in CLOUD_ID, API_TOKEN and EMAIL inside setConfluenceConfig(), run it
//    once from the editor, then clear those values and save.
//
// 3. In the editor's function dropdown, choose previewWeeklyTarget() and Run.
//    It confirms whether this week's post exists (with owners + four panels) or
//    would be created. It writes nothing.
//
// 4. (Optional) Choose runPublishTest() and Run once to write placeholder bullets
//    (creating the post if needed). Then publish real content.
//    ⚠️ Do NOT run publishContributionSection directly — it needs a payload and
//       will just log a warning and stop.
//
// 5. Wire your dashboard's publish action to:
//        publishContributionSection(payload)
//    where payload = { weekLabel, facts[], highlights[], notes[], concerns[] }.
//    Omit weekLabel to target the current ISO week automatically.
//
// NOTES:
//    - Section C is the only section this script ever writes. Sections A and B
//      are created as empty "—" templates for those teams to fill in.
//    - Owners/ordering live in CONFIG_POST.TEMPLATE_SECTIONS and TEMPLATE_AREAS.
//    - To stop auto-creation, set CONFIG_POST.CREATE_IF_MISSING = false.
// ============================================================
