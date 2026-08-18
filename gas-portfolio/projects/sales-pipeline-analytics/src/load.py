"""Load layer — write the transformed frame to the warehouse, idempotently.

The demo target is SQLite (zero-setup, ships with Python), but the load pattern
is warehouse-agnostic:

  * a keyed **upsert** (``INSERT OR REPLACE`` on the ``deal_id`` primary key)
    so re-running the pipeline is idempotent — no duplicate rows, ever;
  * a ``pipeline_runs`` **audit table** recording every run (timestamp + rows
    loaded) for observability and data-reliability tracking.

Porting to BigQuery / Snowflake / Redshift means swapping the connection and
using their native MERGE — the staging-then-merge shape stays the same.
"""

from __future__ import annotations

import logging
import sqlite3
from typing import List

import pandas as pd

log = logging.getLogger(__name__)

FACT_TABLE = "fct_deals"
RUNS_TABLE = "pipeline_runs"

# Columns persisted to the fact table (order matters for the INSERT ... SELECT).
_FACT_COLUMNS: List[str] = [
    "deal_id", "deal_name", "owner_id", "account_name",
    "stage", "amount", "weighted_amount", "win_rate",
    "is_open", "is_won", "is_lost",
    "created_at", "closed_at", "last_activity_at",
    "fiscal_period", "close_iso_week", "days_since_activity", "deal_health",
]


def load(df: pd.DataFrame, db_path: str) -> int:
    """Upsert ``df`` into the warehouse fact table and log the run.

    Returns the number of rows loaded.
    """
    frame = df.reindex(columns=_FACT_COLUMNS).copy()
    # SQLite has no native bool/datetime — normalise for a clean, portable write.
    for col in ("is_open", "is_won", "is_lost"):
        frame[col] = frame[col].astype(int)
    for col in ("created_at", "closed_at", "last_activity_at"):
        frame[col] = frame[col].astype("string")

    conn = sqlite3.connect(db_path)
    try:
        _ensure_schema(conn)
        _upsert_fact(conn, frame)
        _record_run(conn, len(frame))
        conn.commit()
    finally:
        conn.close()

    log.info("Loaded %d rows into %s (%s)", len(frame), FACT_TABLE, db_path)
    return len(frame)


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS {} (\n"
        "  deal_id TEXT PRIMARY KEY,\n"
        "  deal_name TEXT, owner_id TEXT, account_name TEXT,\n"
        "  stage TEXT, amount REAL, weighted_amount REAL, win_rate REAL,\n"
        "  is_open INTEGER, is_won INTEGER, is_lost INTEGER,\n"
        "  created_at TEXT, closed_at TEXT, last_activity_at TEXT,\n"
        "  fiscal_period TEXT, close_iso_week INTEGER,\n"
        "  days_since_activity INTEGER, deal_health TEXT\n"
        ")".format(FACT_TABLE)
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS {} (\n"
        "  run_id INTEGER PRIMARY KEY AUTOINCREMENT,\n"
        "  loaded_at TEXT DEFAULT CURRENT_TIMESTAMP,\n"
        "  rows_loaded INTEGER\n"
        ")".format(RUNS_TABLE)
    )


def _upsert_fact(conn: sqlite3.Connection, frame: pd.DataFrame) -> None:
    """Stage to a temp table, then MERGE into the fact table by primary key."""
    frame.to_sql("_stage_deals", conn, if_exists="replace", index=False)
    cols = ", ".join(_FACT_COLUMNS)
    conn.execute(
        "INSERT OR REPLACE INTO {fact} ({cols}) SELECT {cols} FROM _stage_deals".format(
            fact=FACT_TABLE, cols=cols)
    )
    conn.execute("DROP TABLE _stage_deals")


def _record_run(conn: sqlite3.Connection, rows_loaded: int) -> None:
    conn.execute(
        "INSERT INTO {} (rows_loaded) VALUES (?)".format(RUNS_TABLE), (rows_loaded,)
    )
