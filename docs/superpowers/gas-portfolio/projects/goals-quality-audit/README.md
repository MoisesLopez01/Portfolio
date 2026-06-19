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
intervention**. Highlighted at **Rocket Ops All Hands** for driving company-wide improvement
in goals compliance. Operates at scale: roughly **~230 employees × 10 goals × up to 26
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

> **Source status: PENDING.** The full production source for this pipeline is **not yet
> included** in this repo. [`src/audit_goal_compliance.py`](./src/audit_goal_compliance.py)
> contains an **illustrative, well-commented excerpt** (the core compliance-rule function)
> drawn from the documented approach — it is a representative stub, not the complete
> production file. The full SuiteQL extraction queries and the JSON-to-CSV / HR-notification
> layers will be added before publishing.

### When the full source is present

```bash
pip install -r requirements.txt        # pandas, etc.
# 1. SuiteQL extracts goal data from NetSuite → goals.json
# 2. Run the audit:
python audit_goal_compliance.py --input goals.json --min-goals 10
```

The audit emits a compliance DataFrame plus a non-compliant subset that drives the automated
HR notification and a Google Sheets export.

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
