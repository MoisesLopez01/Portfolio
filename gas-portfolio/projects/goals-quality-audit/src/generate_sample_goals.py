"""Generate a synthetic goals dataset for the audit demo.

Fully fabricated (fixed seed): fake employees, each with a random number of
goals in various statuses and comment counts. A deliberate slice of employees is
made non-compliant so the audit has real exceptions to surface.

    python src/generate_sample_goals.py --out data/goals.json --n 230
"""

from __future__ import annotations

import argparse
import json
import random

_FIRST = ["Jordan", "Priya", "Sam", "Mei", "Diego", "Ava", "Noah", "Ivy",
          "Omar", "Lena", "Kai", "Rosa", "Theo", "Nadia", "Cole", "Yuki"]
_LAST = ["Rivera", "Nair", "Okafor", "Tanaka", "Santos", "Lindqvist", "Cole",
         "Haddad", "Novak", "Bauer", "Costa", "Adeyemi", "Fischer", "Park"]
_STATUSES = ["Active", "Active", "Active", "Draft", "Completed"]


def _name(rng: random.Random) -> str:
    return "{} {}".format(rng.choice(_FIRST), rng.choice(_LAST))


def generate(n: int, seed: int = 42) -> list:
    rng = random.Random(seed)
    records = []
    for i in range(n):
        # Most employees are compliant; ~25% are deliberately short.
        compliant_target = rng.random() > 0.25
        n_goals = rng.randint(10, 14) if compliant_target else rng.randint(3, 9)

        goals = []
        for _ in range(n_goals):
            status = "Active" if compliant_target else rng.choice(_STATUSES)
            has_comment = rng.random() > (0.15 if compliant_target else 0.6)
            goals.append({
                "status": status,
                "comments": rng.randint(1, 8) if has_comment else 0,
            })

        records.append({
            "id": "E-{:04d}".format(i),
            "name": _name(rng),
            "goals": goals,
        })
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic goal records")
    parser.add_argument("--out", default="data/goals.json")
    parser.add_argument("--n", type=int, default=230)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    records = generate(args.n, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=2)
    print("Wrote {} synthetic employee goal records to {}".format(len(records), args.out))


if __name__ == "__main__":
    main()
