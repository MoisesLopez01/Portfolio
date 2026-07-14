"""CLI runner for the goals compliance audit.

    python src/run_audit.py --input data/goals.json --min-goals 10 --min-commented 6

Prints a compliance summary and writes the non-compliant exceptions (the rows
that would drive an automated HR notification) to a CSV.
"""

from __future__ import annotations

import argparse
import json

from audit_goal_compliance import audit_goal_compliance, compliance_rate


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit goal compliance")
    parser.add_argument("--input", required=True, help="Path to goals JSON")
    parser.add_argument("--min-goals", type=int, default=10)
    parser.add_argument("--min-commented", type=int, default=6)
    parser.add_argument("--exceptions-out", default="exceptions.csv")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as fh:
        goals = json.load(fh)

    results, exceptions = audit_goal_compliance(
        goals, min_goals=args.min_goals, min_commented=args.min_commented)

    print("\n" + "=" * 46)
    print("  GOALS COMPLIANCE AUDIT")
    print("=" * 46)
    print("  Employees audited          {:>8}".format(len(results)))
    print("  Compliant                  {:>8}".format(int(results["compliant"].sum())))
    print("  Non-compliant (exceptions) {:>8}".format(len(exceptions)))
    print("  Compliance rate            {:>8.1%}".format(compliance_rate(results)))
    print("=" * 46 + "\n")

    exceptions.to_csv(args.exceptions_out, index=False)
    print("Wrote {} exceptions to {}".format(len(exceptions), args.exceptions_out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
