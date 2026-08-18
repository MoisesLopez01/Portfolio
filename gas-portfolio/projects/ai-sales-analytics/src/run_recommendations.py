"""CLI runner for the cross-sell recommender.

    python src/run_recommendations.py --input data/won_deals.json

Prints a summary and writes the per-account recommendations to a CSV.
"""

from __future__ import annotations

import argparse
import json

import pandas as pd

from cross_sell import pca_coords, recommend


def main() -> int:
    parser = argparse.ArgumentParser(description="Cross-sell recommendations")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", default="recommendations.csv")
    parser.add_argument("--min-confidence", type=float, default=0.10)
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as fh:
        deals = pd.DataFrame(json.load(fh))

    recs = recommend(deals, min_confidence=args.min_confidence)
    _, variance = pca_coords(deals)

    print("\n" + "=" * 50)
    print("  CROSS-SELL RECOMMENDATIONS")
    print("=" * 50)
    print("  Accounts analysed          {:>12}".format(deals["account"].nunique()))
    print("  Accounts with a rec        {:>12}".format(len(recs)))
    if not recs.empty:
        top = recs["recommended"].mode().iloc[0]
        print("  Most-recommended product   {:>12}".format(top))
        print("  Avg confidence             {:>12.1%}".format(recs["confidence"].mean()))
        print("  Clusters (cohorts)         {:>12}".format(recs["cluster"].nunique()))
    print("  PCA variance explained     {:>12}".format(
        "{:.0%}".format(sum(variance))))
    print("=" * 50 + "\n")

    recs.to_csv(args.out, index=False)
    print("Wrote {} recommendations to {}".format(len(recs), args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
