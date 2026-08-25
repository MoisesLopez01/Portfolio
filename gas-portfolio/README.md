# Data & Analytics Engineering Portfolio — Alex López

A portfolio of data-engineering, analytics, and AI-integration projects: ETL/ELT
pipelines, SQL modeling, and dashboards built on Python, SQL, and cloud data tools.

Everything here is **sanitized** and runs on **synthetic data** — no real people,
identifiers, or proprietary data.

## Featured — runnable & tested

Each of these ships complete source, a synthetic data generator, and a passing test suite.

| Project | Stack | What it shows |
|---|---|---|
| [**sales-pipeline-analytics**](./projects/sales-pipeline-analytics) | Python · SQL | End-to-end ETL/ELT: paginated API extract → dedup + data-quality gates → idempotent warehouse load → SQL models. 12 tests. |
| [ai-sales-analytics](./projects/ai-sales-analytics) | Python · scikit-learn | Cross-sell recommender (KMeans + PCA) over CRM won-deal data. 4 tests. |
| [global-comp-reporting](./projects/global-comp-reporting) | Python · Vertex AI | Multi-currency normalization, COL adjustment, micro-banding, market benchmarking. 6 tests. |
| [tcc-financial-forecasting](./projects/tcc-financial-forecasting) | SQL · SQLite | Attrition proration, cost drivers, actuals-vs-forecast — runnable SQL models. 4 tests. |
| [goals-quality-audit](./projects/goals-quality-audit) | Python · pandas | Compliance rule-engine pipeline with exception reporting. 5 tests. |

```bash
# Run any Python project end-to-end, e.g.:
cd projects/sales-pipeline-analytics
pip install -r requirements.txt
python src/generate_sample_data.py --out data/sample_deals.json --n 400
python src/pipeline.py --source data/sample_deals.json --db warehouse.db --verbose
python -m pytest tests/ -q
```

## Site

The landing page (`index.html`) is a single-page portfolio served as a static
build with serverless functions; the project data lives in `Code.js`.
See `README-VERCEL.md` (Vercel) or `README-NETLIFY.md` (Netlify) for deployment.

## License

MIT © 2026 Moises Alexander López (Alex López)
