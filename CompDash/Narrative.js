// ============================================================
// SCRIPT NAME: Comp Health Report — Narrative engine
// PURPOSE:     Turns computed values into sentences. Verdict
//              formatting and the verdict engine.
//
// PURE. Same contract as Position.js. Deterministic — no LLM.
// ============================================================

var BUILD_ = BUILD_ || {};
BUILD_.narrative = 48;

// ── Verdict engine (V3) ─────────────────────────────────────────────────────
// Rule-based, deterministic callouts: every verdict states fact → so-what →
// recommended action (action may be "" where none applies). Full-population
// only — client filters never recompute verdicts. Counts only, never names.
// Severity: FACT (healthy/neutral), NOTE (watch), RISK (act). Sample-size
// guard caps rate-based verdicts at NOTE with a caveat when the denominator
// is under cfg.RAG floors — FY-openers with 2 exits must never read as truth.

function pctV_(x, dp) { return x == null ? "—" : (x * 100).toFixed(dp == null ? 1 : 1) + "%"; }
function usdV_(x) { return x == null ? "—" : "$" + Math.round(x).toLocaleString("en-US"); }
function sevFromBand_(band) { return band === "red" ? "RISK" : band === "yellow" ? "NOTE" : "FACT"; }

function sampleGuard_(v, heads, exits, cfg) {
  const R = cfg.RAG;
  const tooFew = (heads != null && heads < R.floorHeads) || (exits != null && exits < R.floorExits);
  if (tooFew) {
    if (v.severity === "RISK") v.severity = "NOTE";
    v.caveat = ((v.caveat ? v.caveat + " " : "") +
      "Small sample (" + (exits != null ? exits + " exit" + (exits === 1 ? "" : "s") : heads + " heads") +
      ") — too few to read as a trend.").trim();
  }
  return v;
}

function buildVerdicts_(model, cfg) {
  const R = cfg.RAG, out = [];
  const A = model.attrition || {};
  const cur = A.currentFY, prevSp = A.previousFYSamePeriod;
  const fy = model.fyLabel || "";
  const push = v => { v.action = v.action || ""; v.caveat = v.caveat || ""; out.push(v); };

  // 1 — headcount stability (Overview strip)
  if (model.activeCount != null && model.hcFyStart != null && model.hcFyStart > 0) {
    const chg = (model.activeCount - model.hcFyStart) / model.hcFyStart;
    const word = Math.abs(chg) <= 0.02 ? "stable" : chg > 0 ? "growing" : "shrinking";
    push({
      id: "headcount", view: "overview", severity: "FACT",
      fact: "Headcount " + word + " at " + model.activeCount + " active (" + model.hcFyStart + " at " + fy + " start).",
      soWhat: word === "stable" ? "No structural size shift this FY."
        : "Net " + pctV_(Math.abs(chg)) + " " + (chg > 0 ? "growth" : "reduction") + " since " + fy + " start.",
    });
  }

  // 2 — total attrition vs RAG thresholds
  if (cur && cur.rate != null) {
    const band = ragBand_(cur.rate, R.attritionTotal);
    push(sampleGuard_({
      id: "attr-total", view: "attrition", severity: sevFromBand_(band), band,
      fact: fy + " total attrition " + pctV_(cur.rate) +
        (prevSp && prevSp.rate != null ? " (" + prevSp.label + " " + pctV_(prevSp.rate) + ")" : "") + ".",
      soWhat: band === "green" ? "Within the healthy band (≤ " + pctV_(R.attritionTotal.green) + ")."
        : band === "yellow" ? "In the watch band (" + pctV_(R.attritionTotal.green) + "–" + pctV_(R.attritionTotal.yellow) + ")."
        : "Above the at-risk line (> " + pctV_(R.attritionTotal.yellow) + ").",
      action: band === "red" ? "Review the manager hotspots and department concentration in the Workforce & Attrition view this quarter." : "",
    }, cur.avgHeadcount, cur.total, cfg));
  }

  // 3 — voluntary attrition vs peer band
  if (cur && cur.avgHeadcount > 0) {
    const volRate = cur.vol / cur.avgHeadcount;
    const band = ragBand_(volRate, R.attritionVol);
    push(sampleGuard_({
      id: "attr-vol", view: "attrition", severity: sevFromBand_(band), band,
      fact: fy + " voluntary attrition " + pctV_(volRate) + " vs professional-services peers " +
        pctV_(R.peerVolBand.low) + "–" + pctV_(R.peerVolBand.high) + ".",
      soWhat: volRate > R.peerVolBand.high
        ? "Losing people faster than the peer set — a competitiveness signal, not just an internal one."
        : volRate < R.peerVolBand.low
          ? "Below the peer band — voluntary churn is not the current problem."
          : "Inside the peer band.",
      action: volRate > R.peerVolBand.high ? "Pair with the Compensation Position table to check pay competitiveness in exit-heavy locations." : "",
    }, cur.avgHeadcount, cur.vol, cfg));
  }

  // 4 — regretted share of voluntary exits
  if (cur && cur.vol > 0) {
    const share = cur.regretted / cur.vol;
    const band = ragBand_(share, R.regrettedShare);
    push(sampleGuard_({
      id: "regretted", view: "attrition", severity: sevFromBand_(band), band,
      fact: pctV_(share) + " of " + fy + " voluntary exits were regretted (" + cur.regretted + " of " + cur.vol + ").",
      soWhat: band === "red" ? "We are losing people we wanted to keep — the costliest kind of attrition."
        : band === "yellow" ? "Regretted share is drifting above typical firms (15–35% of voluntary exits)."
        : "Most voluntary exits were not regretted — churn quality is acceptable.",
      action: band !== "green" ? "Run an exit-driver review with the HRBP; prioritize stay-interviews for at-risk high performers." : "",
    }, null, cur.vol, cfg));
  }

  // 5 — department concentration of exits
  if (cur && cur.total > 0 && A.slices && A.slices.department && A.slices.department.length >= 2) {
    const d = A.slices.department;
    const topTerms = d[0].terms + d[1].terms;
    const share = topTerms / cur.total;
    push({
      id: "concentration", view: "attrition",
      severity: share >= R.concentration ? "RISK" : "NOTE",
      fact: d[0].key + " and " + d[1].key + " carry " + topTerms + " of " + cur.total + " " + fy + " exits (" + pctV_(share) + ").",
      soWhat: share >= R.concentration
        ? "Exits are concentrated, not company-wide — the problem has an address."
        : "Exits are reasonably spread across departments.",
      action: share >= R.concentration ? "Focus retention actions on the concentrated departments rather than company-wide programs." : "",
    });
  }

  // 6 — teams that may need manager support (counts only — identities live in
  // the Workforce & Attrition view's manager-hotspots table, never at exec level: a
  // scoreboard changes how managers behave toward the tool. Framed as Develops
  // Rocketeers / Empower Others — support, not surveillance — which keeps Talk
  // Straight possible in the skip-level conversations.)
  if (model.managers && model.managers.available && model.managers.rows.length) {
    const hot = model.managers.rows.filter(r =>
      r.attritionRate != null && r.attritionRate > R.attritionTotal.yellow).length;
    push({
      id: "mgr-hotspots", view: "attrition",
      severity: hot > 0 ? "RISK" : "FACT",
      fact: hot + " of " + model.managers.rows.length + " teams (managers with 3+ reports) show attrition above " + pctV_(R.attritionTotal.yellow) + " — the manager may need support.",
      soWhat: hot > 0 ? "Exits cluster in specific teams — a signal to support those managers, distinct from department-wide pressure."
        : "No team's attrition stands out beyond the at-risk line.",
      action: hot > 0 ? "Offer skip-level support conversations for the flagged teams this quarter (identities stay in the Workforce & Attrition view's manager hotspots, not in decks)." : "",
    });
  }

  // 7 — span of control
  if (model.managers && model.managers.available && model.managers.spanOfControl &&
      model.managers.spanOfControl.ratio != null) {
    const s = model.managers.spanOfControl;
    const wide = s.ratio > R.spanWide, narrow = s.ratio < R.spanNarrow;
    push({
      id: "span", view: "attrition",
      severity: wide ? "RISK" : "NOTE",
      fact: "Span of control 1:" + s.ratio + " (" + s.managers + " managers · " + s.ics + " ICs) vs 1:" + s.target + " target.",
      soWhat: wide ? "Managers are stretched beyond the knowledge-work norm (6–8) — coaching capacity suffers."
        : narrow ? "Spans are narrow — more management layers than the work may need."
        : "Within the healthy 5–8 range for knowledge work.",
      action: wide ? "Review team sizes above 1:" + R.spanWide + " when planning the next org change." : "",
    });
  }

  // 8 — below-anchor pay positions (the CompDash "inversion-class" flag)
  if (model.employees && model.employees.length) {
    const low = model.employees.filter(e => e.ratio != null && e.ratio < cfg.COMPA_LOW_MIN).length;
    push({
      id: "compa-below", view: "compa",
      severity: low > 0 ? "RISK" : "FACT",
      fact: low + " Rocketeer" + (low === 1 ? " sits" : "s sit") + " below " + cfg.COMPA_LOW_MIN.toFixed(2) + " of their peer anchor.",
      soWhat: low > 0 ? "Pay positions this far below internal peers are retention and equity exposure."
        : "Nobody sits below the red internal-position band.",
      action: low > 0 ? "Review the flagged cases with the HRBP before the next comp cycle closes (Compensation Position view, red chips)." : "",
    });
  }

  // 9 — equity flags
  if (model.equity) {
    const eq = model.equity;
    const flaggedGender = eq.genderAvailable ? eq.gender.filter(g => g.flagged).length : 0;
    const n = flaggedGender + eq.outliers.length + eq.tenure.length;
    push({
      id: "equity", view: "overview",
      severity: n > 0 ? "NOTE" : "FACT",
      fact: n + " equity flag" + (n === 1 ? "" : "s") + " open (" +
        (eq.genderAvailable ? flaggedGender + " gender-gap groups, " : "gender lens pending, ") +
        eq.outliers.length + " outliers, " + eq.tenure.length + " tenure).",
      soWhat: n > 0 ? "Each flag is a case to explain or correct — unexplained flags become audit findings."
        : "No equity flags at current thresholds.",
      action: n > 0 ? "Work the flag list from the Executive Pulse equity rollup; document the rationale where the position is justified." : "",
    });
  }

  // 9b — decision signals (V4): counts only, detail lives in the Compensation
  // Position table's drill panel.
  if (model.employees && model.employees.length && cfg.SIGNALS) {
    const S = cfg.SIGNALS;
    const sig = model.employees.filter(e => e.signals);
    const stale = sig.filter(e => e.signals.promoStale);
    const staleEarly = stale.filter(e => e.signals.earlyCareer).length;
    push({
      id: "promo-stale", view: "compa",
      severity: staleEarly > 0 ? "NOTE" : "FACT",
      fact: stale.length + " active Rocketeer" + (stale.length === 1 ? "" : "s") + " have gone " +
        S.promoStaleYears + "+ years without a promotion (" + staleEarly + " early-career, levels " +
        S.earlyCareerLabel + ").",
      soWhat: staleEarly > 0
        ? "Early-career people stall fastest — a stale profile at I2/I3 is a growth-path signal, not just a comp one."
        : "No early-career profiles are promotion-stale.",
      action: staleEarly > 0 ? "Review the early-career rows in the Compensation Position table before the next promotion cycle." : "",
    });

    const recog = sig.filter(e => e.signals.recognitionRisk).length;
    push({
      id: "recognition-risk", view: "compa",
      severity: recog > 0 ? "NOTE" : "FACT",
      fact: recog + " top performer" + (recog === 1 ? "" : "s") + " (latest completed quarter ≥ " +
        S.recogMinRating + ") received under " + Math.round(S.recogMaxTtm * 100) + "% TCC growth in the trailing 12 months.",
      soWhat: recog > 0
        ? "Excellent quarters answered with flat pay reads as non-recognition — a leading indicator of regretted exits."
        : "Every recent top performer saw meaningful TCC movement.",
      action: recog > 0 ? "Cross-check these names against the Compensation Position table before the next QTA cycle closes." : "",
    });

    const core = sig.filter(e => e.signals.coreLevel);
    const risky = core.filter(e => e.signals.retentionRisk).length;
    push({
      id: "retention-core", view: "compa",
      severity: risky > 0 ? "RISK" : "FACT",
      fact: risky + " of " + core.length + " core-level Rocketeers (" + S.coreLevelLabel + ") carry " +
        S.riskFactorMin + "+ concurrent comp risk factors.",
      soWhat: risky > 0
        ? "Core mature employees are the costliest cohort to lose to compensation — factors are listed per person."
        : "No core-level Rocketeer stacks multiple comp risk factors.",
      action: risky > 0 ? "Work the retention cohort rows in the Compensation Position table with the HRBP, worst-stacked first." : "",
    });

    const invisible = sig.filter(e => e.signals.invisibleContributor).length;
    if (invisible > 0) {
      push({
        id: "invisible-contrib", view: "compa", severity: "NOTE",
        fact: invisible + " Rocketeer" + (invisible === 1 ? "" : "s") + " show strong contribution evidence (score ≥ " +
          S.invisibleMinScore + ") but weak or missing performance ratings.",
        soWhat: "Absence of a rating is not evidence of absence of contribution (Check K spirit) — these may be invisible contributors.",
        action: "Ask the manager to confirm the work and whether it maps to a GTT-35 pillar before the cycle closes.",
      });
    }
  }

  // 10 — trends & drivers (dominant exit reasons → driver classification)
  if (A.detail && A.detail.length) {
    const counts = {};
    A.detail.forEach(t => { const k = t.reason || "(no reason)"; counts[k] = (counts[k] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 2);
    const driverOf = reason => {
      const hit = (cfg.REASON_CLASS || []).find(rc => rc.re.test(reason));
      return hit ? hit.driver : "other";
    };
    const READ = {
      "labor-market/comp": "reads as a labor-market/comp pattern — people leaving for other jobs",
      "role-design/structural": "reads as a role-design/structural pattern — positions eliminated or contracts ended",
      "performance-managed": "reads as managed performance exits, not a retention failure",
      "personal": "reads as personal-circumstance exits, not a comp problem",
      "other": "has no dominant classified driver",
    };
    const domDriver = driverOf(top[0]);
    push({
      id: "trends-drivers", view: "attrition", severity: "NOTE",
      fact: "Top " + fy + " exit reasons: " + top.map(r => r + " (" + counts[r] + ")").join(", ") + ".",
      soWhat: "The dominant reason (" + domDriver + ") " + READ[domDriver] + ".",
      action: domDriver === "labor-market/comp"
        ? "Cross-check exit-heavy groups against the Compensation Position table before concluding it is only the market." : "",
    });
  }

  // 11 — financial impact
  if (A.financialImpact && A.financialImpact.coverage.total > 0) {
    const fi = A.financialImpact;
    push({
      id: "financial", view: "attrition", severity: "NOTE",
      fact: fy + " exits released ~" + usdV_(fi.annualPayrollReleasedUsd) + " of FY payroll (regretted portion ~" + usdV_(fi.regrettedPortionUsd) + ").",
      soWhat: "The regretted portion is value lost, not savings — backfill and ramp costs land on top.",
      caveat: fi.coverage.counted < fi.coverage.total
        ? "Based on " + fi.coverage.counted + " of " + fi.coverage.total + " leavers (others missing TCC USD)." : "",
    });
  }

  // 12 — forecast
  if (A.forecast) {
    const band = ragBand_(A.forecast.annualizedRate, R.attritionTotal);
    push({
      id: "forecast", view: "attrition", severity: sevFromBand_(band), band,
      fact: "Full-year projection ~" + A.forecast.projectedTotal + " exits (~" + pctV_(A.forecast.annualizedRate) + ") via " + A.forecast.method + ".",
      soWhat: band === "red" ? "On the current pace the FY closes above the at-risk line."
        : band === "yellow" ? "On pace to close in the watch band."
        : "On pace to close within the healthy band.",
      action: band === "red" ? "Treat the projection as the planning number for backfill budget, not the year-to-date rate." : "",
    });
  }

  // 13 — FY-in-progress small-sample caveat (the "0.9% on 2 exits" rule)
  if (cur && cur.total < R.floorExits) {
    push({
      id: "fy-caveat", view: "overview", severity: "NOTE",
      fact: fy + " figures rest on " + cur.total + " exit" + (cur.total === 1 ? "" : "s") + " so far.",
      soWhat: "Too few to read — rates this early look dramatically healthy or dramatically bad by accident.",
    });
  }

  return out;
}
