"""Generate a synthetic raw-deals dataset for the runnable demo.

Everything here is fabricated with a fixed random seed — no real people,
companies, ids, or brands. The generator intentionally injects data-quality
problems (duplicate deal ids, zero-amount deals, an unknown stage id) so the
pipeline's cleaning / dedup / quality gates have realistic work to do.

    python src/generate_sample_data.py --out data/sample_deals.json --n 400
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random

# Fictional building blocks — clearly synthetic.
_ADJECTIVES = ["Northwind", "Cobalt", "Summit", "Harbor", "Cedar", "Vertex",
               "Lumen", "Beacon", "Ridge", "Atlas", "Pioneer", "Meridian"]
_NOUNS = ["Logistics", "Analytics", "Robotics", "Health", "Retail", "Systems",
          "Foods", "Energy", "Media", "Labs", "Freight", "Financial"]
_SUFFIX = ["Inc", "LLC", "Group", "Co", "Holdings"]

# Fake owner directory: synthetic ids -> synthetic display names.
_OWNERS = {
    "owner-01": "Jordan Rivera", "owner-02": "Priya Nair",
    "owner-03": "Sam Okafor", "owner-04": "Mei Tanaka",
    "owner-05": "Diego Santos", "owner-06": "Ava Lindqvist",
}

# Real stage ids (from config.STAGE_MAP) plus one bogus id to exercise the gate.
_VALID_STAGES = ["1001", "1002", "1003", "1004", "1005", "1006", "1007"]
_BOGUS_STAGE = "9999"


def _company(rng: random.Random) -> str:
    return "{} {} {}".format(rng.choice(_ADJECTIVES), rng.choice(_NOUNS),
                             rng.choice(_SUFFIX))


def _iso(d: dt.datetime) -> str:
    return d.replace(microsecond=0).isoformat() + "Z"


def generate(n: int, seed: int = 42) -> list:
    rng = random.Random(seed)
    today = dt.datetime(2026, 7, 1)  # fixed "now" so output is reproducible
    records = []

    for i in range(n):
        created = today - dt.timedelta(days=rng.randint(10, 240))
        last_activity = created + dt.timedelta(days=rng.randint(0, 60))
        closed = created + dt.timedelta(days=rng.randint(20, 180))
        stage = rng.choice(_VALID_STAGES)
        owner_id = rng.choice(list(_OWNERS.keys()))

        records.append({
            "deal_id": "D-{:05d}".format(i),
            "deal_name": "{} renewal".format(_company(rng)),
            "owner_id": owner_id,
            "account_name": _company(rng),
            "stage_id": stage,
            "amount": round(rng.uniform(2_000, 250_000), 2),
            "created_at": _iso(created),
            "closed_at": _iso(closed),
            "last_activity_at": _iso(last_activity),
        })

    # ── Inject deliberate data-quality problems ──────────────────────────
    # 1. Duplicate rows (same deal_id, differing last_activity) — dedup target.
    for dup in rng.sample(records, k=max(1, n // 20)):
        clone = dict(dup)
        clone["last_activity_at"] = _iso(today - dt.timedelta(days=rng.randint(0, 5)))
        clone["amount"] = dup["amount"] + 1  # stale copy with a slightly wrong value
        records.append(clone)
    # 2. Zero-amount placeholder deals — quality gate target.
    for _ in range(max(1, n // 40)):
        records.append({
            "deal_id": "D-Z{:04d}".format(rng.randint(0, 9999)),
            "deal_name": "placeholder", "owner_id": "owner-01",
            "account_name": _company(rng), "stage_id": "1002", "amount": 0,
            "created_at": _iso(today), "closed_at": _iso(today),
            "last_activity_at": _iso(today),
        })
    # 3. Unknown stage id — mapping gate target.
    records.append({
        "deal_id": "D-BADSTAGE", "deal_name": "mystery deal", "owner_id": "owner-03",
        "account_name": _company(rng), "stage_id": _BOGUS_STAGE, "amount": 50_000,
        "created_at": _iso(today), "closed_at": _iso(today),
        "last_activity_at": _iso(today),
    })

    rng.shuffle(records)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic raw deals")
    parser.add_argument("--out", default="data/sample_deals.json")
    parser.add_argument("--n", type=int, default=400)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    records = generate(args.n, args.seed)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(records, fh, indent=2)
    print("Wrote {} synthetic records to {}".format(len(records), args.out))


if __name__ == "__main__":
    main()
