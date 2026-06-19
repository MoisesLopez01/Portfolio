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

- Google Apps Script
- NetSuite SuiteQL
- SQL
- Oracle Warehouse
- Tableau
- Looker

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

> **Source status: PENDING.** The full production source for this system is **not yet
> included** in this repo. [`src/attrition_proration.sql`](./src/attrition_proration.sql)
> contains an **illustrative, well-commented excerpt** (the SuiteQL attrition-proration
> query) drawn from the documented approach — it is a representative stub, not the complete
> production file. The full Apps Script forecasting engine and the warehouse query set will
> be added before publishing.

### When the full source is present

This system runs as a Google Apps Script project against a NetSuite / Oracle warehouse:

```bash
npm install -g @google/clasp
clasp login
clasp push        # push the .gs forecasting engine into the GAS project
```

- Configure warehouse / NetSuite connection details and period bounds in Script Properties.
- The SuiteQL queries (such as `attrition_proration.sql`) are executed against the data
  warehouse; their output feeds the Apps Script proration and LOB-allocation engines, which
  render the Quarterly Actuals vs. Forecast and Department Variance dashboards.

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
