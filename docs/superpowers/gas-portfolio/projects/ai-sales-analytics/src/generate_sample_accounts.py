"""Generate a synthetic won-deals dataset with latent product-affinity structure.

Fully fabricated (fixed seed). Accounts are drawn from a few hidden "segments",
each with a characteristic product mix, so the clustering has real structure to
recover. Every account is missing at least one product its segment tends to own
— the cross-sell target.

    python src/generate_sample_accounts.py --out data/won_deals.json --n 120
"""

from __future__ import annotations

import argparse
import json
import random

_ADJ = ["Northwind", "Cobalt", "Summit", "Harbor", "Cedar", "Vertex", "Lumen",
        "Beacon", "Ridge", "Atlas", "Pioneer", "Meridian", "Delta", "Onyx"]
_NOUN = ["Logistics", "Analytics", "Health", "Retail", "Systems", "Foods",
         "Energy", "Media", "Labs", "Freight", "Financial", "Robotics"]

_PRODUCTS = ["Platform", "Analytics", "Automation", "Support", "Integrations",
             "Security", "Mobile", "Compliance"]

# Hidden segments: each favours a subset of products (probability of owning).
_SEGMENTS = [
    {"Platform": 0.95, "Analytics": 0.8, "Automation": 0.7, "Integrations": 0.6},
    {"Platform": 0.9, "Support": 0.85, "Mobile": 0.7, "Security": 0.5},
    {"Analytics": 0.9, "Compliance": 0.8, "Security": 0.75, "Platform": 0.6},
    {"Automation": 0.85, "Integrations": 0.8, "Platform": 0.7, "Support": 0.5},
]


def _account(rng: random.Random) -> str:
    return "{} {}".format(rng.choice(_ADJ), rng.choice(_NOUN))


def generate(n_accounts: int, seed: int = 42) -> list:
    rng = random.Random(seed)
    deals = []
    used = set()
    i = 0
    while len(used) < n_accounts:
        name = _account(rng)
        if name in used:
            continue
        used.add(name)
        segment = _SEGMENTS[i % len(_SEGMENTS)]
        i += 1
        owned_any = False
        for product in _PRODUCTS:
            if rng.random() < segment.get(product, 0.05):
                deals.append({"account": name, "product": product, "is_won": True})
                owned_any = True
        if not owned_any:  # ensure every account owns at least one product
            deals.append({"account": name, "product": "Platform", "is_won": True})
    return deals


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic won deals")
    parser.add_argument("--out", default="data/won_deals.json")
    parser.add_argument("--n", type=int, default=120)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    deals = generate(args.n, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(deals, fh, indent=2)
    n_acc = len({d["account"] for d in deals})
    print("Wrote {} won-deal rows across {} accounts to {}".format(
        len(deals), n_acc, args.out))


if __name__ == "__main__":
    main()
