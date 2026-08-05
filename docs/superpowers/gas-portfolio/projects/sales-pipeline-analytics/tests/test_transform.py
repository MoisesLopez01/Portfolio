"""Unit tests for the transform chain — the data-engineering core."""

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from config import PipelineConfig  # noqa: E402
import transform as T  # noqa: E402

NOW = pd.Timestamp("2026-07-01")


def _raw():
    """A tiny raw dataset carrying one of every data-quality problem."""
    return [
        # Two rows for the same deal — dedup should keep the most recent.
        {"deal_id": "D1", "deal_name": "A", "owner_id": "o1", "account_name": "Acme",
         "stage_id": "1005", "amount": 100.0, "created_at": "2026-05-01",
         "closed_at": "2026-08-01", "last_activity_at": "2026-06-01"},
        {"deal_id": "D1", "deal_name": "A", "owner_id": "o1", "account_name": "Acme",
         "stage_id": "1005", "amount": 999.0, "created_at": "2026-05-01",
         "closed_at": "2026-08-01", "last_activity_at": "2026-06-20"},
        # Won deal.
        {"deal_id": "D2", "deal_name": "B", "owner_id": "o2", "account_name": "Beta",
         "stage_id": "1006", "amount": 200.0, "created_at": "2026-04-01",
         "closed_at": "2026-06-15", "last_activity_at": "2026-06-15"},
        # Zero amount -> rejected.
        {"deal_id": "D3", "deal_name": "C", "owner_id": "o1", "account_name": "Cee",
         "stage_id": "1002", "amount": 0.0, "created_at": "2026-05-01",
         "closed_at": "2026-08-01", "last_activity_at": "2026-06-01"},
        # Unknown stage -> rejected.
        {"deal_id": "D4", "deal_name": "D", "owner_id": "o3", "account_name": "Dee",
         "stage_id": "9999", "amount": 500.0, "created_at": "2026-05-01",
         "closed_at": "2026-08-01", "last_activity_at": "2026-06-01"},
        # Missing id -> rejected.
        {"deal_id": None, "deal_name": "E", "owner_id": "o3", "account_name": "Eee",
         "stage_id": "1003", "amount": 500.0, "created_at": "2026-05-01",
         "closed_at": "2026-08-01", "last_activity_at": "2026-06-01"},
    ]


def test_full_transform_report_counts():
    df, report = T.transform(_raw(), PipelineConfig(), now=NOW)
    assert report["raw_rows"] == 6
    assert report["duplicates_removed"] == 1
    assert report["rejected_bad_amount"] == 1
    assert report["rejected_unknown_stage"] == 1
    assert report["rejected_missing_id"] == 1
    assert report["final_rows"] == 2  # D1 (deduped) + D2


def test_dedup_keeps_most_recent_activity():
    df, _ = T.transform(_raw(), PipelineConfig(), now=NOW)
    d1 = df[df["deal_id"] == "D1"].iloc[0]
    assert d1["amount"] == 999.0  # the row with the later last_activity_at wins


def test_weighted_amount_uses_stage_win_rate():
    df, _ = T.transform(_raw(), PipelineConfig(), now=NOW)
    d1 = df[df["deal_id"] == "D1"].iloc[0]
    # Commit stage win-rate is 0.90 -> 999 * 0.9 = 899.1
    assert round(d1["weighted_amount"], 1) == 899.1


def test_stage_flags_and_fiscal_period():
    df, _ = T.transform(_raw(), PipelineConfig(), now=NOW)
    d2 = df[df["deal_id"] == "D2"].iloc[0]
    assert bool(d2["is_won"]) is True
    assert bool(d2["is_open"]) is False
    assert d2["fiscal_period"] == "FY26Q4"  # closed 2026-06-15, July-start FY


def test_deal_health_bands():
    df, _ = T.transform(_raw(), PipelineConfig(), now=NOW)
    # D1 last activity 2026-06-20, now 2026-07-01 -> 11 days -> Healthy
    d1 = df[df["deal_id"] == "D1"].iloc[0]
    assert d1["deal_health"] == "Healthy"
