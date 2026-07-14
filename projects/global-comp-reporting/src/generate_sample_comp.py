"""Generate a synthetic multi-currency compensation roster.

Fully fabricated (fixed seed): fake employees across regions/currencies with
local-currency salaries. No real people or pay data.

    python src/generate_sample_comp.py --out data/roster.json --n 300
"""

from __future__ import annotations

import argparse
import json
import random

# Region -> (currency, rough local-salary range for the demo).
_REGIONS = {
    "US":    ("USD", 80_000, 180_000),
    "UK":    ("GBP", 55_000, 120_000),
    "EU":    ("EUR", 55_000, 120_000),
    "LATAM": ("MXN", 500_000, 1_800_000),
    "APAC":  ("PHP", 900_000, 3_500_000),
    "India": ("INR", 1_500_000, 6_000_000),
}
_ROLES = ["Data Engineer", "Analytics Engineer", "Software Engineer",
          "Product Designer", "Product Manager", "Support Engineer"]


def generate(n: int, seed: int = 42) -> list:
    rng = random.Random(seed)
    regions = list(_REGIONS.keys())
    rows = []
    for i in range(n):
        region = rng.choice(regions)
        currency, lo, hi = _REGIONS[region]
        rows.append({
            "employee_id": "E-{:04d}".format(i),
            "role": rng.choice(_ROLES),
            "region": region,
            "currency": currency,
            "salary_local": round(rng.uniform(lo, hi), 2),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic comp roster")
    parser.add_argument("--out", default="data/roster.json")
    parser.add_argument("--n", type=int, default=300)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rows = generate(args.n, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(rows, fh, indent=2)
    print("Wrote {} synthetic comp records to {}".format(len(rows), args.out))


if __name__ == "__main__":
    main()
