"""Unit tests for compensation normalization, banding, and benchmarking."""

import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from benchmark import benchmark_salary, compa_ratio  # noqa: E402
from normalize_to_usd import assign_bands, normalize_roster, normalize_to_usd  # noqa: E402

FX = {"USD": 1.0, "EUR": 0.92, "INR": 83.0}
COL = {"US": 1.0, "EU": 0.9, "India": 0.4}


def test_normalize_to_usd_basic():
    out = normalize_to_usd(92_000, "EUR", FX, 0.9)
    assert out["nominal_usd"] == 100_000.0        # 92000 / 0.92
    assert out["col_adjusted"] == round(100_000 / 0.9, 2)


def test_normalize_to_usd_unknown_currency():
    with pytest.raises(ValueError):
        normalize_to_usd(1000, "JPY", FX, 1.0)


def test_normalize_roster_drops_unknown_currency():
    df = pd.DataFrame([
        {"employee_id": "1", "role": "DE", "region": "US", "currency": "USD",
         "salary_local": 100_000},
        {"employee_id": "2", "role": "DE", "region": "US", "currency": "JPY",
         "salary_local": 100_000},
    ])
    out = normalize_roster(df, FX, COL)
    assert len(out) == 1
    assert out.iloc[0]["nominal_usd"] == 100_000.0


def test_assign_bands_within_role():
    df = pd.DataFrame([
        {"employee_id": str(i), "role": "DE", "region": "US", "currency": "USD",
         "salary_local": s} for i, s in enumerate(range(50_000, 150_001, 10_000))
    ])
    out = normalize_roster(df, FX, COL)
    out = assign_bands(out, n_bands=5)
    assert out["band"].min() >= 1
    assert out["band"].max() <= 5
    # Highest earner sits at the top of the role range.
    top = out.sort_values("col_adjusted").iloc[-1]
    assert top["band_position"] == 1.0


def test_benchmark_fallback_is_deterministic():
    a = benchmark_salary("Data Engineer", "US")
    b = benchmark_salary("Data Engineer", "US")
    assert a == b
    assert a["source"] == "fallback-table"   # no GCP creds in test env
    assert a["market_usd"] == 120_000


def test_compa_ratio():
    assert compa_ratio(108_000, 120_000) == 0.9
    assert compa_ratio(100_000, 0) == 0.0
