# TCC Financial Forecasting System

> CFO-ready P&L dashboards replacing manual budget consolidation

A Financial Forecasting & Total Cost of Compensation (TCC) Impact System built in Apps
Script that models the cost impact of attrition, promotions, merit increases, and new hires,
and surfaces it through automated, board-ready P&L dashboards.

---

## Problem

The Finance and People teams were manually consolidating **P&L data** across departments,
creating **error-prone quarterly** reporting cycles with no systematic way to model the cost
impact of attrition, promotions, merit increases, or new hires.

## Approach

- Developed a Financial Forecasting & TCC Impact System in Apps Script with smart
  **attrition-proration** logic.
- Built dynamic **Line-of-Business budget allocation** engines and automated board
  dashboards.
- Delivered views for **Quarterly Actuals vs. Forecast**, **Top 15 Department Variance**,
  and full P&L cost-driver breakdowns (merit, promotion, attrition, new hire).

## Tech

- SQL (window-free, warehouse-portable models)
- SQLite demo harness (ports to BigQuery / Snowflake / Oracle)
- Python (data generator + SQL runner)
- pytest
- Tableau / Looker (BI layer, production)

## Results

Delivered **CFO-level visibility** into labor cost drivers through fully automated
dashboards. Monthly department-level analysis now informs C-suite compensation decisions,
and post-adjustment audits reached **100% accuracy** across all sheets.

| Metric | Value |
|---|---|
| Audit accuracy | 100% |
| Stakeholder | CFO |
| Manual steps | 0 |

**Before:** Manual P&L consolidation across departments — error-prone quarterly cycles. No
real-time visibility, Finance team bottleneck.

**After:** Automated CFO dashboards — actuals vs. forecast, LOB variance, cost drivers. 100%
audit accuracy, 0 manual steps, C-suite ready.

---

## How to run

> This repo ships **runnable, sanitized** SQL models plus a tiny SQLite harness and a
> synthetic-data generator, so the queries actually execute — not just parse. All data is
> fabricated. In production these models run against a cloud data warehouse and feed a
> Tableau / Looker P&L dashboard.

Three models are included:
- **`attrition_proration.sql`** — partial-month TCC cost of each attrition event
- **`cost_drivers.sql`** — annualised impact by department & driver (attrition / merit /
  promotion / new-hire)
- **`actuals_vs_forecast.sql`** — quarterly variance (top departments first)

```bash
pip install -r requirements.txt        # pytest only (SQL runs on stdlib sqlite3)

# 1. Generate synthetic finance tables
python src/generate_sample_finance.py --out data/finance.json --n 240

# 2. Run all three SQL models against the demo warehouse
python src/run_sql.py --data data/finance.json --period-start 2026-07-01 --period-end 2026-09-30

# 3. Tests (execute the SQL against in-memory SQLite and assert the math)
python -m pytest tests/ -q          # 4 passed
```

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
