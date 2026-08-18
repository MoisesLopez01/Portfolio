# Sales Pipeline Analytics — ETL/ELT Pipeline

> Python + SQL pipeline that turns raw CRM deal data into a clean, warehouse-ready
> model for BI dashboards — **runnable end-to-end in one command, with tests.**

A compact but production-shaped data pipeline: it **extracts** deal records from a
cursor-paginated CRM REST API (or a local file), **transforms** them (cleaning,
deduplication, data-quality gating, fiscal-calendar enrichment, risk-adjusted
pipeline value), and **loads** them idempotently into a warehouse table that a
SQL modeling layer and BI tool build on.

This is a **fully synthetic, sanitized** distillation of production analytics
pipelines I've built against live CRM / ERP APIs — no real names, ids, or
company data. Everything here runs offline against generated sample data.

---

## Why this exists

CRM exports are messy: the same deal appears on overlapping API pages, "deals"
with a $0 amount pollute pipeline totals, and stage ids are opaque numeric codes.
Feeding that straight into a dashboard produces numbers leadership can't trust.

This pipeline puts a **reliable, observable transform layer** between the raw API
and the dashboard, so every downstream metric is deduplicated, quality-gated, and
consistently bucketed onto the fiscal calendar.

---

## Architecture

```
                 ┌──────────────┐     ┌──────────────────────────┐     ┌───────────────┐
  CRM REST API   │  extract.py  │     │       transform.py       │     │    load.py    │
  (paginated) ──▶│  • cursor    │────▶│  clean → dedup → quality  │────▶│  upsert (MERGE│
  or JSON file   │    paging    │ raw │  gate → map stages →      │ df  │  by deal_id)  │
                 │  • retry/    │     │  enrich (weighted $,      │     │  + run audit  │
                 │    backoff   │     │  fiscal period, health)   │     │               │
                 └──────────────┘     └──────────────────────────┘     └───────┬───────┘
                                                                                │
                       pipeline.py orchestrates E→T→L + prints a run summary    ▼
                                                                        ┌───────────────┐
                                                                        │  warehouse    │
                                                                        │  (SQLite demo;│
                                                                        │  BigQuery /   │
   sql/models/*      ◀── staging + dim/fact SQL models build on ───────│  Snowflake in │
   sql/analytics/*   ◀── the loaded facts, feeding the BI layer         │  production)  │
                                                                        └───────────────┘
```

Each stage is a set of small, pure functions, so the exact same code drops into
an **Airflow DAG** (one task per stage) or a **Cloud Function** without change.

---

## Data-quality gates (nothing dropped silently)

Every run prints a summary and writes a row to a `pipeline_runs` audit table.
Example run over the bundled 431-record synthetic dataset:

```
============================================
  PIPELINE RUN SUMMARY
============================================
  Raw records extracted             431
  Duplicates removed                 20
  Rejected: missing id                0
  Rejected: unknown stage             1
  Rejected: bad amount               10
  Clean rows                        400
  Rows loaded to warehouse          400
============================================
```

Re-running is **idempotent** — the keyed upsert (`INSERT OR REPLACE` on the
`deal_id` primary key) means the fact table stays at 400 rows, never 800.

---

## Tech

- **Python** (pandas, numpy) — transform + orchestration
- **SQL** — staging / dimension / fact models + an analytics query with window
  functions (`RANK() OVER (PARTITION BY …)`)
- **REST APIs** — cursor pagination, Bearer auth, exponential-backoff retry
- **SQLite** for the zero-setup demo warehouse; the load pattern (stage → MERGE)
  ports directly to **BigQuery / Snowflake / Redshift**
- **pytest** — 12 unit tests covering the transform + fiscal logic

---

## How to run

```bash
pip install -r requirements.txt

# 1. Generate synthetic raw deals (fully fake data, with injected DQ problems)
python src/generate_sample_data.py --out data/sample_deals.json --n 400

# 2. Run the pipeline end-to-end (Extract → Transform → Load)
python src/pipeline.py --source data/sample_deals.json --db warehouse.db --verbose

# 3. Query the warehouse (dashboard-feeding analytics)
python - <<'PY'
import sqlite3
con = sqlite3.connect("warehouse.db")
for row in con.execute(open("sql/analytics/pipeline_by_stage.sql").read()).fetchall()[:8]:
    print(row)
PY

# Run against a live CRM instead of the file:
#   export CRM_API_KEY=...   (see .env.example)
#   python src/pipeline.py --source https://api.example-crm.com/v3/deals --db warehouse.db
```

### Tests

```bash
python -m pytest tests/ -q
# 12 passed
```

---

## Repository layout

```
sales-pipeline-analytics/
├── src/
│   ├── config.py              # single source of truth for tunables
│   ├── extract.py             # API (paginated + retry) / file extraction
│   ├── transform.py           # clean → dedup → quality gate → enrich
│   ├── load.py                # idempotent warehouse upsert + run audit
│   ├── fiscal.py              # configurable fiscal-calendar helpers
│   ├── pipeline.py            # CLI orchestrator (E→T→L + summary)
│   └── generate_sample_data.py# synthetic data generator
├── sql/
│   ├── models/                # stg_deals, dim_owner (staging + dimensional)
│   └── analytics/             # pipeline_by_stage (BI-facing query)
├── tests/                     # pytest suite (transform + fiscal)
└── data/                      # generated synthetic sample data
```

---

## How this maps to a Data / Analytics Engineering role

| Role requirement | Where it shows up |
|---|---|
| Build & maintain ETL/ELT pipelines | `extract.py` → `transform.py` → `load.py`, orchestrated by `pipeline.py` |
| Strong SQL (incl. optimization) | `sql/` — staging, dimensional models, window-function analytics |
| Python / scripting | Entire transform + orchestration layer |
| Improve data reliability & quality | Dedup, quality gates, `pipeline_runs` audit, idempotent loads |
| Data warehousing concepts | Staging → dim/fact separation, keyed MERGE/upsert, run auditing |
| Cloud data systems | Warehouse-portable load (BigQuery/Snowflake); Airflow-ready structure |
| Work independently | Self-contained, documented, tested, one-command runnable |

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
