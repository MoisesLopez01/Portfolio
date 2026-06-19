# Global Compensation Reporting Tool

> 10+ regions, micro-banding, PDF + Sheets auto-output for board decisions

A Python + Gemini Pro tool that unifies compensation reporting across a globally distributed
SaaS company — normalizing multi-currency salaries, applying regional cost-of-living
adjustments and micro-banding, and auto-generating board-ready PDF and Google Sheets output.

---

## Problem

A globally distributed SaaS company was managing compensation across **10+ regions** without
a unified framework — each region used separate spreadsheets with **no consistent
methodology** for currency conversion, benefit valuation, or band positioning.

## Approach

- Built a Global Compensation Reporting Tool in **Python** with the **Gemini Pro API**.
- Implemented **multi-currency normalization** (FX-rate injection), **regional COL
  adjustments**, and micro-banding co-designed with the CEO and VP of TA.
- Automated **PDF and Google Sheets** output generation for board presentations.

## Tech

- Gemini Pro API
- Python
- PDF Automation
- Google Sheets
- Multi-currency Logic
- COL Modeling

## Results

Delivered a unified global compensation view across **10+ regions**. Board-level decisions
now use consistent, methodology-aligned data — shifting the company from reactive comp
adjustments to **proactive market positioning**.

| Metric | Value |
|---|---|
| Regions | 10+ |
| Auto output | PDF + Google Sheets |
| Audience | Board |

**Before:** Separate regional spreadsheets, inconsistent methodology, no global view. Ad hoc
decisions, no cross-region comparability.

**After:** Unified tool — multi-currency, COL-adjusted, PDF + Sheets auto-generated.
Board-level quality, 10+ regions, consistent method.

---

## How to run

> **Source status: PENDING.** The full production source for this tool is **not yet
> included** in this repo. [`src/normalize_to_usd.py`](./src/normalize_to_usd.py) contains
> an **illustrative, well-commented excerpt** (the multi-currency / COL normalization
> function) drawn from the documented approach — it is a representative stub, not the
> complete production file. The full Gemini-Pro prompting logic, micro-banding engine, and
> PDF / Google Sheets output generators will be added before publishing.

### When the full source is present

```bash
pip install -r requirements.txt
# Set the Gemini Pro API key as an environment variable (never hard-code it):
export GEMINI_API_KEY="..."
python generate_report.py --region all --fx-rates fx.json --col-index col.json
```

The tool normalizes each region's salaries to USD with COL adjustment, applies micro-banding,
and writes board-ready PDF and Google Sheets outputs.

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
