"""Tests for the TCC SQL models — executed against an in-memory SQLite warehouse."""

import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from run_sql import load_tables, run_sql_file  # noqa: E402


def _conn(tables):
    conn = sqlite3.connect(":memory:")
    load_tables(conn, tables)
    return conn


def test_attrition_proration_math():
    tables = {
        "employees": [
            {"employee_id": "E1", "department": "Data", "annual_tcc": 120_000},
            {"employee_id": "E2", "department": "Data", "annual_tcc": 90_000},
        ],
        "terminations": [
            # Worked 15 of 30 days -> exactly half of annual TCC prorated.
            {"employee_id": "E1", "term_date": "2026-08-15", "term_day": 15,
             "days_in_month": 30},
        ],
    }
    conn = _conn(tables)
    cols, rows = run_sql_file(conn, "attrition_proration.sql",
                              {"period_start": "2026-07-01", "period_end": "2026-09-30"})
    assert len(rows) == 1
    row = dict(zip(cols, rows[0]))
    assert row["prorated_cost"] == 60_000.0     # 120000 * 15/30
    assert row["cost_driver"] == "ATTRITION"


def test_attrition_respects_period_window():
    tables = {
        "employees": [{"employee_id": "E1", "department": "Data", "annual_tcc": 120_000}],
        "terminations": [
            {"employee_id": "E1", "term_date": "2026-12-10", "term_day": 10,
             "days_in_month": 31},
        ],
    }
    conn = _conn(tables)
    _, rows = run_sql_file(conn, "attrition_proration.sql",
                           {"period_start": "2026-07-01", "period_end": "2026-09-30"})
    assert rows == []   # December termination is outside the Q1 window


def test_cost_drivers_signs():
    tables = {
        "employees": [
            {"employee_id": "E1", "department": "Data", "annual_tcc": 100_000},
            {"employee_id": "E2", "department": "Data", "annual_tcc": 100_000},
        ],
        "terminations": [{"employee_id": "E1", "term_date": "2026-08-01",
                          "term_day": 1, "days_in_month": 31}],
        "comp_events": [{"employee_id": "E2", "event_type": "merit",
                         "effective_date": "2026-08-01", "delta_annual_tcc": 5_000}],
        "new_hires": [{"employee_id": "N1", "department": "Data", "annual_tcc": 80_000,
                       "start_date": "2026-08-01", "start_day": 1, "days_in_month": 31}],
    }
    conn = _conn(tables)
    cols, rows = run_sql_file(conn, "cost_drivers.sql")
    by_driver = {r[1]: r[2] for r in rows}
    assert by_driver["ATTRITION"] == -100_000.0   # removes cost
    assert by_driver["MERIT"] == 5_000.0
    assert by_driver["NEW_HIRE"] == 80_000.0


def test_actuals_vs_forecast_variance():
    tables = {
        "forecast": [{"department": "Data", "period": "FY27Q1", "forecast_tcc": 1_000_000}],
        "actuals": [{"department": "Data", "period": "FY27Q1", "actual_tcc": 1_100_000}],
    }
    conn = _conn(tables)
    cols, rows = run_sql_file(conn, "actuals_vs_forecast.sql")
    row = dict(zip(cols, rows[0]))
    assert row["variance"] == 100_000.0
    assert row["variance_pct"] == 10.0
