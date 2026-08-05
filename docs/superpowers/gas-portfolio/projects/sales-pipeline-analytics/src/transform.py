"""Transform layer — turn raw CRM deals into a clean, analytics-ready frame.

Pipeline of pure, independently testable steps:

    to_dataframe -> clean -> deduplicate -> apply_quality_filters
                 -> map_stages -> enrich

Every step is deterministic and returns a new frame, so the whole transform is
easy to unit-test and to reason about. ``transform()`` runs the full chain and
also returns a data-quality report (row counts at each gate) so pipeline runs
are observable and regressions in source data are caught early.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from config import (
    HEALTH_BANDS,
    HEALTH_STAGNANT,
    STAGE_MAP,
    STAGE_WIN_RATES,
    PipelineConfig,
)
from fiscal import FiscalCalendar

log = logging.getLogger(__name__)

# Raw fields the pipeline consumes. Unknown extra fields are ignored.
_DATE_COLS = ["created_at", "closed_at", "last_activity_at"]
_NUMERIC_COLS = ["amount"]


def to_dataframe(raw_records: List[Dict]) -> pd.DataFrame:
    """Flatten raw deal dicts into a DataFrame with a stable column set."""
    rows = []
    for rec in raw_records:
        rows.append({
            "deal_id": rec.get("deal_id"),
            "deal_name": rec.get("deal_name"),
            "owner_id": rec.get("owner_id"),
            "account_name": rec.get("account_name"),
            "stage_id": rec.get("stage_id"),
            "amount": rec.get("amount"),
            "created_at": rec.get("created_at"),
            "closed_at": rec.get("closed_at"),
            "last_activity_at": rec.get("last_activity_at"),
        })
    return pd.DataFrame(rows)


def clean(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce types defensively: numeric amounts, tz-naive datetimes, trimmed ids."""
    df = df.copy()
    for col in _NUMERIC_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in _DATE_COLS:
        df[col] = pd.to_datetime(df[col], errors="coerce", utc=True).dt.tz_localize(None)
    for col in ("deal_id", "stage_id", "owner_id"):
        df[col] = df[col].astype("string").str.strip()
    return df


def deduplicate(df: pd.DataFrame) -> pd.DataFrame:
    """Keep the most recently active row per ``deal_id``.

    CRM exports frequently contain the same deal more than once (paging
    overlaps, replays). Sorting by last activity and keeping the first row is a
    deterministic, idempotent way to collapse duplicates.
    """
    return (
        df.sort_values(["deal_id", "last_activity_at"], ascending=[True, False],
                       na_position="last")
          .drop_duplicates(subset=["deal_id"], keep="first")
          .reset_index(drop=True)
    )


def apply_quality_filters(
    df: pd.DataFrame, config: PipelineConfig
) -> Tuple[pd.DataFrame, Dict[str, int]]:
    """Drop rows that would corrupt downstream metrics; report what was dropped.

    Rejects (each counted, never silently discarded):
      * missing ``deal_id``          — cannot be keyed / joined
      * missing / unknown ``stage_id`` — cannot be classified
      * amount <= ``min_amount``     — zero/placeholder deals skew pipeline value
    """
    report: Dict[str, int] = {}

    missing_id = df["deal_id"].isna() | (df["deal_id"] == "")
    report["rejected_missing_id"] = int(missing_id.sum())
    df = df[~missing_id]

    unknown_stage = ~df["stage_id"].isin(STAGE_MAP.keys())
    report["rejected_unknown_stage"] = int(unknown_stage.sum())
    df = df[~unknown_stage]

    bad_amount = df["amount"].isna() | (df["amount"] < config.min_amount)
    report["rejected_bad_amount"] = int(bad_amount.sum())
    df = df[~bad_amount]

    return df.reset_index(drop=True), report


def map_stages(df: pd.DataFrame) -> pd.DataFrame:
    """Resolve opaque stage ids to the canonical vocabulary + win probability."""
    df = df.copy()
    df["stage"] = df["stage_id"].map(STAGE_MAP)
    df["win_rate"] = df["stage"].map(STAGE_WIN_RATES).fillna(0.0)
    df["is_won"] = df["stage"] == "Closed Won"
    df["is_lost"] = df["stage"] == "Closed Lost"
    df["is_open"] = ~(df["is_won"] | df["is_lost"])
    return df


def enrich(df: pd.DataFrame, config: PipelineConfig, now: pd.Timestamp) -> pd.DataFrame:
    """Add derived analytics columns: weighted value, fiscal period, deal health."""
    df = df.copy()
    fc = FiscalCalendar(fy_start_month=config.fy_start_month)

    # Risk-adjusted pipeline value.
    df["weighted_amount"] = (df["amount"] * df["win_rate"]).round(2)

    # Fiscal bucketing on expected/actual close date.
    df["fiscal_period"] = df["closed_at"].apply(
        lambda d: fc.fiscal_period(d) if pd.notna(d) else None)
    df["close_iso_week"] = df["closed_at"].apply(
        lambda d: fc.iso_week(d) if pd.notna(d) else None)

    # Deal health from recency of activity.
    days_idle = (now - df["last_activity_at"]).dt.days
    df["days_since_activity"] = days_idle.fillna(9999).astype(int)
    conditions = [df["days_since_activity"] <= bound for bound, _ in HEALTH_BANDS]
    choices = [label for _, label in HEALTH_BANDS]
    df["deal_health"] = np.select(conditions, choices, default=HEALTH_STAGNANT)

    return df


def transform(
    raw_records: List[Dict],
    config: PipelineConfig,
    now: pd.Timestamp = None,
) -> Tuple[pd.DataFrame, Dict[str, int]]:
    """Run the full transform chain, returning (clean_frame, dq_report)."""
    now = now if now is not None else pd.Timestamp.utcnow().tz_localize(None)

    report: Dict[str, int] = {}
    df = to_dataframe(raw_records)
    report["raw_rows"] = len(df)

    df = clean(df)
    df = deduplicate(df)
    report["after_dedup"] = len(df)
    report["duplicates_removed"] = report["raw_rows"] - report["after_dedup"]

    df, dq = apply_quality_filters(df, config)
    report.update(dq)

    df = map_stages(df)
    df = enrich(df, config, now)
    report["final_rows"] = len(df)

    log.info("Transform report: %s", report)
    return df, report
