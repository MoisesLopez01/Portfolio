# AI Sales Analytics Ecosystem

> HubSpot CRM + Gemini LLM → automated weekly deal intelligence

An end-to-end pipeline that pulls deal data from HubSpot, runs semantic analysis on
unstructured deal notes with a Gemini LLM, applies a Time Decay forecasting model, and
delivers AI-generated deal-risk flags and narrative summaries to sales leadership every
Monday.

---

## Problem

A global SaaS company's sales leadership was drowning in manual reporting — deal notes were
**unstructured**, revenue forecasts were unreliable, and analysts spent **10+ hours per
week** consolidating CRM data into reports. There was no systematic way to surface **deal
blockers** or forecast with confidence.

## Approach

- Engineered an end-to-end pipeline integrating the **HubSpot CRM API (v3/v4)** with a
  **parallelized ETL** layer in Apps Script.
- Added **Google Gemini LLM** for semantic analysis of unstructured deal notes —
  auto-detecting **deal blockers** and generating human-readable weekly summaries.
- Layered a custom **Time Decay forecasting model** to improve revenue forecast accuracy.

## Tech

- HubSpot API v3/v4
- Google Apps Script
- Python
- Google Gemini LLM
- ETL Pipelines
- Time Decay Forecasting

## Results

Eliminated **10+ hours/week** of manual reporting. Sales leadership now receives
**AI-generated deal-risk flags** and narrative summaries **every Monday** — giving the
C-suite a data-driven foundation for quarterly planning.

| Metric | Value |
|---|---|
| Saved weekly | 10h+ |
| Automated | 100% |
| Audience | C-suite |

**Before:** Manual CRM consolidation — 10h+/week, unreliable forecasts, no deal risk
visibility. Inconsistent methodology, no scalability.

**After:** Automated AI pipeline delivers Monday summaries with deal risk flags. 0h manual,
C-suite ready every week.

---

## How to run

> **Source status: PENDING.** The full production source for this system is **not yet
> included** in this repo. [`src/ingestion.gs`](./src/ingestion.gs) contains an
> **illustrative, well-commented excerpt** of the Apps Script ingestion layer (the
> parallelized CRM pull) drawn from the documented approach — it is a representative stub,
> not the complete production file. The full GAS ingestion code and the Python
> semantic-analysis / Time Decay forecasting modules will be added before publishing.

### Apps Script ingestion layer (when full source is present)

```bash
npm install -g @google/clasp
clasp login
clasp push    # push the .gs files into the GAS project
```

Set the HubSpot private-app token in Script Properties (e.g. `HUBSPOT_API_KEY`) — never hard
-code it.

### Python downstream layer (when full source is present)

```bash
pip install -r requirements.txt
python run_pipeline.py        # ingestion JSON → Gemini analysis → Time Decay forecast
```

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
