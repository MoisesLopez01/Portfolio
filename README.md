# Data & Analytics Engineering — Project Demos

Runnable, tested demos of data-engineering / analytics work: ETL/ELT pipelines,
SQL modeling, and ML — in Python and SQL.

Everything here runs on **synthetic data** — no real people, identifiers, or
proprietary information. Each project ships complete source, a synthetic data
generator, and a passing test suite.

| Project | Stack | What it shows |
|---|---|---|
| [**sales-pipeline-analytics**](./projects/sales-pipeline-analytics) ⭐ | Python · SQL | End-to-end ETL/ELT: paginated API extract → dedup + data-quality gates → idempotent warehouse load → SQL models (window functions). **12 tests.** |
| [ai-sales-analytics](./projects/ai-sales-analytics) | Python · scikit-learn | Cross-sell recommender (KMeans + PCA) over CRM won-deal data. **4 tests.** |
| [global-comp-reporting](./projects/global-comp-reporting) | Python · Vertex AI | Multi-currency normalization, cost-of-living adjustment, micro-banding, market benchmarking (offline fallback). **6 tests.** |
| [tcc-financial-forecasting](./projects/tcc-financial-forecasting) | SQL · SQLite | Attrition proration, cost drivers, actuals-vs-forecast — runnable SQL models. **4 tests.** |
| [goals-quality-audit](./projects/goals-quality-audit) | Python · pandas | Compliance rule-engine pipeline with exception reporting. **5 tests.** |

## Run any project

```bash
# Example — the flagship ETL pipeline:
cd projects/sales-pipeline-analytics
pip install -r requirements.txt
python src/generate_sample_data.py --out data/sample_deals.json --n 400
python src/pipeline.py --source data/sample_deals.json --db warehouse.db --verbose
python -m pytest tests/ -q          # 12 passed
```

Each project's own `README.md` has the full problem/approach/results write-up and run steps.

## About

Data & Analytics Engineer — SQL, Python, ETL/ELT, cloud data tooling (GCP / Vertex AI),
and BI (Tableau / Looker / Power BI).

## License

MIT © 2026 Moises Alexander López (Alex López)
