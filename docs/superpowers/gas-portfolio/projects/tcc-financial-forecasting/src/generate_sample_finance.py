"""Generate a synthetic finance dataset for the TCC SQL models.

Fully fabricated (fixed seed): employees with annual TCC, plus attrition,
merit/promotion, and new-hire events, and a forecast vs actuals table. No real
people, departments, or financials.

    python src/generate_sample_finance.py --out data/finance.json
"""

from __future__ import annotations

import argparse
import calendar
import datetime as dt
import json
import random

_DEPARTMENTS = ["Delivery", "Engineering", "Support", "Design", "Product", "Data"]


def _days_in_month(d: dt.date) -> int:
    return calendar.monthrange(d.year, d.month)[1]


def generate(n_employees: int, seed: int = 42) -> dict:
    rng = random.Random(seed)

    employees = []
    for i in range(n_employees):
        employees.append({
            "employee_id": "E-{:04d}".format(i),
            "department": rng.choice(_DEPARTMENTS),
            "annual_tcc": round(rng.uniform(60_000, 220_000), 2),
        })

    # ~8% attrition inside the quarter.
    terminations = []
    for emp in rng.sample(employees, k=max(1, n_employees // 12)):
        month = rng.choice([7, 8, 9])
        term = dt.date(2026, month, rng.randint(1, 28))
        terminations.append({
            "employee_id": emp["employee_id"],
            "term_date": term.isoformat(),
            "term_day": term.day,
            "days_in_month": _days_in_month(term),
        })

    # Merit + promotion comp events.
    comp_events = []
    for emp in rng.sample(employees, k=max(1, n_employees // 4)):
        etype = rng.choice(["merit", "merit", "promotion"])
        delta = emp["annual_tcc"] * (rng.uniform(0.02, 0.05) if etype == "merit"
                                     else rng.uniform(0.08, 0.15))
        comp_events.append({
            "employee_id": emp["employee_id"],
            "event_type": etype,
            "effective_date": dt.date(2026, rng.choice([7, 8, 9]), 1).isoformat(),
            "delta_annual_tcc": round(delta, 2),
        })

    # New hires in the quarter.
    new_hires = []
    for j in range(max(1, n_employees // 10)):
        month = rng.choice([7, 8, 9])
        start = dt.date(2026, month, rng.randint(1, 28))
        new_hires.append({
            "employee_id": "N-{:04d}".format(j),
            "department": rng.choice(_DEPARTMENTS),
            "annual_tcc": round(rng.uniform(60_000, 180_000), 2),
            "start_date": start.isoformat(),
            "start_day": start.day,
            "days_in_month": _days_in_month(start),
        })

    # Forecast vs actuals per department for the quarter.
    forecast, actuals = [], []
    for dept in _DEPARTMENTS:
        base = round(rng.uniform(800_000, 3_000_000), 2)
        forecast.append({"department": dept, "period": "FY27Q1", "forecast_tcc": base})
        actuals.append({"department": dept, "period": "FY27Q1",
                        "actual_tcc": round(base * rng.uniform(0.92, 1.10), 2)})

    return {
        "employees": employees,
        "terminations": terminations,
        "comp_events": comp_events,
        "new_hires": new_hires,
        "forecast": forecast,
        "actuals": actuals,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic finance data")
    parser.add_argument("--out", default="data/finance.json")
    parser.add_argument("--n", type=int, default=240)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    tables = generate(args.n, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(tables, fh, indent=2)
    counts = {k: len(v) for k, v in tables.items()}
    print("Wrote synthetic finance data to {} — {}".format(args.out, counts))


if __name__ == "__main__":
    main()
