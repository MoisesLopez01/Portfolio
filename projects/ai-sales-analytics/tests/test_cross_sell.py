"""Unit tests for the cross-sell recommender."""

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from cross_sell import build_matrix, recommend  # noqa: E402


def _deals(pairs):
    return pd.DataFrame([{"account": a, "product": p, "is_won": True} for a, p in pairs])


def test_build_matrix_is_binary():
    # Account A owns Platform twice -> still a single 1.
    deals = _deals([("A", "Platform"), ("A", "Platform"), ("A", "Analytics"),
                    ("B", "Platform")])
    m = build_matrix(deals)
    assert set(m.columns) >= {"Platform", "Analytics"}
    assert m.loc["A", "Platform"] == 1
    assert m.loc["B", "Analytics"] == 0
    assert set(m.values.flatten()) <= {0, 1}


def test_recommendation_is_a_product_not_already_owned():
    # Two cohorts: {Platform,Analytics} owners and {Platform,Support} owners.
    pairs = []
    for i in range(6):
        pairs += [("PA{}".format(i), "Platform"), ("PA{}".format(i), "Analytics")]
    for i in range(6):
        pairs += [("PS{}".format(i), "Platform"), ("PS{}".format(i), "Support")]
    # One account in the PA cohort is missing Analytics -> should be recommended it.
    pairs = [p for p in pairs if p != ("PA0", "Analytics")]

    # Force the two intended cohorts so the recommendation is deterministic.
    recs = recommend(_deals(pairs), n_clusters=2, min_confidence=0.1)
    assert not recs.empty
    for _, r in recs.iterrows():
        owned = set(r["products_owned"].split(", "))
        assert r["recommended"] not in owned      # never recommend an owned product
        assert 0.0 <= r["confidence"] <= 1.0

    pa0 = recs[recs["account"] == "PA0"]
    assert not pa0.empty
    assert pa0.iloc[0]["recommended"] == "Analytics"


def test_too_small_returns_empty():
    recs = recommend(_deals([("A", "Platform"), ("B", "Platform")]))
    assert recs.empty


def test_ignores_lost_deals():
    deals = pd.DataFrame([
        {"account": "A", "product": "Platform", "is_won": True},
        {"account": "A", "product": "Security", "is_won": False},
    ])
    m = build_matrix(deals)
    assert "Security" not in m.columns    # only won deals count as ownership
