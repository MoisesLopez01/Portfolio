"""Unit tests for the fiscal-calendar helpers."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from fiscal import FiscalCalendar  # noqa: E402


def test_fiscal_year_july_start():
    fc = FiscalCalendar(fy_start_month=7)
    # July onward belongs to the *next* calendar year's FY.
    assert fc.fiscal_year("2026-07-01") == 2027
    assert fc.fiscal_year("2026-06-30") == 2026


def test_fiscal_quarter_july_start():
    fc = FiscalCalendar(fy_start_month=7)
    assert fc.fiscal_quarter("2026-07-15") == 1  # Jul-Sep
    assert fc.fiscal_quarter("2026-10-15") == 2  # Oct-Dec
    assert fc.fiscal_quarter("2027-01-15") == 3  # Jan-Mar
    assert fc.fiscal_quarter("2027-04-15") == 4  # Apr-Jun


def test_fiscal_period_label():
    fc = FiscalCalendar(fy_start_month=7)
    assert fc.fiscal_period("2026-08-15") == "FY27Q1"


def test_calendar_year_start_is_configurable():
    fc = FiscalCalendar(fy_start_month=1)
    assert fc.fiscal_year("2026-03-01") == 2026
    assert fc.fiscal_quarter("2026-03-01") == 1


def test_handles_missing_and_bad_dates():
    fc = FiscalCalendar()
    assert fc.fiscal_year(None) is None
    assert fc.fiscal_period("") is None
    assert fc.fiscal_quarter("not-a-date") is None


def test_week_start_is_monday():
    fc = FiscalCalendar()
    # 2026-07-01 is a Wednesday; its ISO week starts Mon 2026-06-29.
    assert str(fc.week_start("2026-07-01")) == "2026-06-29"


def test_invalid_start_month_rejected():
    import pytest
    with pytest.raises(ValueError):
        FiscalCalendar(fy_start_month=13)
