"""Run the TCC SQL models against a demo SQLite warehouse.

Loads synthetic finance tables from JSON, then executes each SQL model and
prints the result — proving the queries actually run, not just that they parse.

    python src/generate_sample_finance.py --out data/finance.json
    python src/run_sql.py --data data/finance.json

The same SQL ports to a real warehouse (BigQuery / Snowflake / Oracle); only the
connection and a couple of dialect notes (see actuals_vs_forecast.sql) change.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
from typing import Dict, List

_SQL_DIR = os.path.join(os.path.dirname(__file__))


def load_tables(conn: sqlite3.Connection, tables: Dict[str, List[dict]]) -> None:
    """Create and populate a table per key, inferring columns from the first row."""
    for name, rows in tables.items():
        if not rows:
            continue
        cols = list(rows[0].keys())
        col_ddl = ", ".join('"{}"'.format(c) for c in cols)
        conn.execute('DROP TABLE IF EXISTS "{}"'.format(name))
        conn.execute('CREATE TABLE "{}" ({})'.format(name, col_ddl))
        placeholders = ", ".join(["?"] * len(cols))
        conn.executemany(
            'INSERT INTO "{}" ({}) VALUES ({})'.format(
                name, ", ".join('"{}"'.format(c) for c in cols), placeholders),
            [tuple(r.get(c) for c in cols) for r in rows],
        )
    conn.commit()


def run_sql_file(conn: sqlite3.Connection, filename: str, params: dict = None):
    """Execute a .sql file from src/ and return (columns, rows)."""
    path = os.path.join(_SQL_DIR, filename)
    with open(path, "r", encoding="utf-8") as fh:
        sql = fh.read()
    cur = conn.execute(sql, params or {})
    columns = [d[0] for d in cur.description]
    return columns, cur.fetchall()


def _print(title, columns, rows, limit=10):
    print("\n== {} ==".format(title))
    print(" | ".join(columns))
    for row in rows[:limit]:
        print(" | ".join(str(v) for v in row))
    if len(rows) > limit:
        print("... ({} rows total)".format(len(rows)))


def main() -> int:
    parser = argparse.ArgumentParser(description="Run TCC SQL models on synthetic data")
    parser.add_argument("--data", default="data/finance.json")
    parser.add_argument("--period-start", default="2026-07-01")
    parser.add_argument("--period-end", default="2026-09-30")
    args = parser.parse_args()

    with open(args.data, "r", encoding="utf-8") as fh:
        tables = json.load(fh)

    conn = sqlite3.connect(":memory:")
    load_tables(conn, tables)

    cols, rows = run_sql_file(conn, "attrition_proration.sql",
                              {"period_start": args.period_start,
                               "period_end": args.period_end})
    _print("Attrition proration (partial-month cost)", cols, rows)

    cols, rows = run_sql_file(conn, "cost_drivers.sql")
    _print("Cost drivers (annualised impact by dept)", cols, rows)

    cols, rows = run_sql_file(conn, "actuals_vs_forecast.sql")
    _print("Actuals vs forecast (top variance)", cols, rows)

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
