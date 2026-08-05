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

- Python (pandas)
- Vertex AI (Gemini) — market benchmarking, with an offline fallback
- Multi-currency normalization
- Cost-of-living modeling + micro-banding
- pytest
- PDF / Google Sheets output (production)

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

> This repo ships a **runnable, sanitized** version — synthetic multi-currency roster,
> full normalization + micro-banding, and market benchmarking. The benchmarking layer calls
> **Vertex AI (Gemini)** in production; without GCP credentials it transparently falls back
> to a deterministic market table, so the whole report runs offline. No real pay data.

```bash
pip install -r requirements.txt        # pandas, pytest

# 1. Generate a synthetic multi-currency roster (6 regions)
python src/generate_sample_comp.py --out data/roster.json --n 300

# 2. Run the report: normalize → COL-adjust → micro-band → benchmark (compa-ratio)
python src/run_report.py --roster data/roster.json

# 3. Tests
python -m pytest tests/ -q          # 6 passed
```

To use live Vertex AI benchmarking instead of the fallback table:

```bash
export GCP_PROJECT="your-project"        # + GCP_LOCATION (default us-central1)
pip install google-cloud-aiplatform      # see requirements.txt
```

The tool normalizes each region's salaries to USD with COL adjustment, applies micro-banding
within each role, and computes a market compa-ratio. In production it also writes board-ready
PDF and Google Sheets outputs (omitted from this sanitized demo).

## License

[MIT](./LICENSE) © 2026 Moises Alexander López (Alex López)
