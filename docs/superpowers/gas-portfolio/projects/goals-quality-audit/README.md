# Goals Quality Audit Pipeline

> SuiteQL + Python → 100% bonus-eligibility compliance enforced automatically

An automated pipeline that extracts goal data from NetSuite, applies the company's bonus
eligibility rule (every employee must have at least 10 active goals), and flags
non-compliant employees before the bonus cycle runs — at a scale of roughly **60K data
points per cycle** (~230 employees × 10 goals × up to 26 comments/quarter).

---

## Problem

The bonus eligibility process required every employee to have at least **10 active goals**
in the performance system. **Manual checks were inconsistent** — some employees reached
bonus payout with fewer goals.

## Approach

- Built an automated pipeline using **SuiteQL** queries to extract goal data from NetSuite.
- Added a **Python JSON-to-CSV** transformation layer that applies the **10-goal compliance
  rule**.
- Flags non-compliant employees **before the bonus cycle runs** and notifies HR
  automatically.

## Tech

- Python
- SuiteQL
- JSON parsing
- pandas
- Google Sheets
- NetSuite

## Results

Achieved **100% compliance enforcement** on every bonus cycle with **zero manual
intervention**. Recognized at a company all-hands for driving org-wide improvement in goals
compliance. Operates at scale: roughly **~230 employees × 10 goals × up to 26
comments/quarter ≈ 60K data points per cycle.**

| Metric | Value |
|---|---|
| Compliance | 100% |
| Manual checks | 0 |
| Rule enforced | 10-goal |

**Before:** Manual goal count checks before each bonus cycle — inconsistent, error-prone.
Audit surprises, HR/Finance time drain.

**After:** Automated Python pipeline flags non-compliance before the bonus cycle runs. 100%
enforcement, zero manual intervention.

---

## How to run

> This repo ships a **runnable, sanitized** version of the compliance rule engine with a
> synthetic data generator and a pytest suite. All data is fabricated — no real employees,
> ids, or company data. In production the goals JSON is produced by warehouse extraction
> queries; here a generator stands in so the audit runs offline.

```bash
pip install -r requirements.txt        # pandas, pytest

# 1. Generate synthetic goal records (with deliberate non-compliant cases)
python src/generate_sample_goals.py --out data/goals.json --n 230

# 2. Run the audit (two rules: min active goals + min commented goals)
python src/run_audit.py --input data/goals.json --min-goals 10 --min-commented 6

# 3. Tests
python -m pytest tests/ -q          # 5 passed
```

The audit emits a full compliance DataFrame plus a non-compliant subset (written to
`exceptions.csv`) — the rows that drive the automated HR notification in production.

Example run (230 synthetic employees): **174 compliant / 56 exceptions → 75.6% compliance.**

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
