"""CLI runner for the global compensation report.

    python src/run_report.py --roster data/roster.json

Normalizes every salary to USD, applies COL adjustment + micro-banding, and
benchmarks each role/region against market (Vertex AI in production, offline
fallback here). Prints a summary; in production it also writes board-ready PDF
and Google Sheets outputs (omitted from this sanitized demo).
"""

from __future__ import annotations

import argparse
import json

import pandas as pd

from benchmark import benchmark_salary, compa_ratio
from normalize_to_usd import assign_bands, normalize_roster

# Demo FX rates (units per USD) and regional COL indices (1.0 = US baseline).
FX_RATES = {"USD": 1.0, "GBP": 0.79, "EUR": 0.92, "MXN": 17.0, "PHP": 56.0, "INR": 83.0}
COL_BY_REGION = {"US": 1.00, "UK": 0.95, "EU": 0.90, "LATAM": 0.55, "APAC": 0.50, "India": 0.40}


def main() -> int:
    parser = argparse.ArgumentParser(description="Global compensation report")
    parser.add_argument("--roster", required=True)
    parser.add_argument("--out", default="comp_report.csv")
    args = parser.parse_args()

    with open(args.roster, "r", encoding="utf-8") as fh:
        df = pd.DataFrame(json.load(fh))

    df = normalize_roster(df, FX_RATES, COL_BY_REGION)
    df = assign_bands(df, n_bands=5)

    # Benchmark each (role, region) once, then map compa-ratio onto every row.
    pairs = df[["role", "region"]].drop_duplicates()
    market = {(r.role, r.region): benchmark_salary(r.role, r.region)["market_usd"]
              for r in pairs.itertuples()}
    df["market_usd"] = df.apply(lambda r: market[(r["role"], r["region"])], axis=1)
    df["compa_ratio"] = df.apply(
        lambda r: compa_ratio(r["nominal_usd"], r["market_usd"]), axis=1)

    under = int((df["compa_ratio"] < 0.9).sum())
    over = int((df["compa_ratio"] > 1.1).sum())

    print("\n" + "=" * 48)
    print("  GLOBAL COMPENSATION REPORT")
    print("=" * 48)
    print("  Employees normalized       {:>10}".format(len(df)))
    print("  Regions                    {:>10}".format(df["region"].nunique()))
    print("  Median COL-adjusted USD    {:>10,.0f}".format(df["col_adjusted"].median()))
    print("  Under market (<0.9 compa)  {:>10}".format(under))
    print("  Over market  (>1.1 compa)  {:>10}".format(over))
    print("  Benchmark source           {:>10}".format(
        benchmark_salary("Data Engineer", "US")["source"]))
    print("=" * 48 + "\n")

    cols = ["employee_id", "role", "region", "currency", "salary_local",
            "nominal_usd", "col_adjusted", "band", "band_position",
            "market_usd", "compa_ratio"]
    df[cols].to_csv(args.out, index=False)
    print("Wrote {} rows to {}".format(len(df), args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
