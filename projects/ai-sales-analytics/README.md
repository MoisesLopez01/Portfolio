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

- Python (pandas, numpy)
- scikit-learn — KMeans clustering + PCA
- HubSpot API v3/v4 (ingestion, production)
- Google Apps Script (ingestion excerpt)
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

> This repo ships a **runnable, sanitized** ML layer: an unsupervised cross-sell recommender
> (KMeans + PCA) over synthetic won-deal data, with a pytest suite. No real accounts,
> products, or revenue. The Apps Script ingestion excerpt
> ([`src/ingestion.gs`](./src/ingestion.gs)) shows the production CRM-pull pattern.

### Python ML layer (runnable)

```bash
pip install -r requirements.txt        # pandas, numpy, scikit-learn, pytest

# 1. Generate synthetic won-deal data (accounts have latent product-affinity segments)
python src/generate_sample_accounts.py --out data/won_deals.json --n 120

# 2. Cluster accounts and recommend each one's next-best product
python src/run_recommendations.py --input data/won_deals.json

# 3. Tests
python -m pytest tests/ -q          # 4 passed
```

Example run (120 synthetic accounts): **99 accounts receive a cross-sell recommendation
across 5 cohorts; PCA explains ~61% of variance in two components.**

### Apps Script ingestion layer (production)

```bash
npm install -g @google/clasp && clasp login && clasp push
```

Set the CRM private-app token in Script Properties (e.g. `HUBSPOT_API_KEY`) — never
hard-code it.

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
