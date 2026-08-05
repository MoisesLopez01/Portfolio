"""Fiscal-calendar helpers for time-based analytics.

Many businesses run on a fiscal year that does not start in January. This module
maps any date to its fiscal year / quarter / period label and to ISO calendar
weeks, so downstream models can bucket records consistently regardless of the
company's fiscal start month.

The fiscal start month is configurable (default: July) — nothing here is tied to
a specific organisation.
"""

from __future__ import annotations

import datetime as _dt
from typing import Optional, Union

DateLike = Union[_dt.date, _dt.datetime, str, None]


def _coerce_date(value: DateLike) -> Optional[_dt.date]:
    """Best-effort coercion of a date/datetime/ISO-string into a ``date``.

    Returns ``None`` for empty / unparseable input so callers can decide how to
    treat missing dates rather than crashing on bad data.
    """
    if value is None or value == "":
        return None
    if isinstance(value, _dt.datetime):
        return value.date()
    if isinstance(value, _dt.date):
        return value
    try:
        # Handles "2026-03-30" and "2026-03-30T12:00:00Z" style strings.
        text = str(value).strip().replace("Z", "").split("T")[0]
        return _dt.date.fromisoformat(text)
    except (ValueError, TypeError):
        return None


class FiscalCalendar:
    """Maps dates onto a configurable fiscal calendar.

    Args:
        fy_start_month: Month (1-12) the fiscal year begins. Default 7 (July).

    Example:
        >>> fc = FiscalCalendar(fy_start_month=7)
        >>> fc.fiscal_period("2026-08-15")
        'FY27Q1'
    """

    def __init__(self, fy_start_month: int = 7) -> None:
        if not 1 <= fy_start_month <= 12:
            raise ValueError("fy_start_month must be between 1 and 12")
        self.fy_start_month = fy_start_month

    def fiscal_year(self, value: DateLike) -> Optional[int]:
        d = _coerce_date(value)
        if d is None:
            return None
        # A January start is just the calendar year (no offset). For any later
        # start month, name the fiscal year by the calendar year it *ends* in
        # (e.g. a July-start FY covering Jul-2026..Jun-2027 is "FY2027").
        if self.fy_start_month == 1:
            return d.year
        return d.year + 1 if d.month >= self.fy_start_month else d.year

    def fiscal_quarter(self, value: DateLike) -> Optional[int]:
        d = _coerce_date(value)
        if d is None:
            return None
        offset = (d.month - self.fy_start_month) % 12
        return offset // 3 + 1

    def fiscal_period(self, value: DateLike) -> Optional[str]:
        """Compact label such as ``FY27Q1`` (fiscal year suffix + quarter)."""
        fy = self.fiscal_year(value)
        fq = self.fiscal_quarter(value)
        if fy is None or fq is None:
            return None
        return "FY{:02d}Q{}".format(fy % 100, fq)

    @staticmethod
    def iso_week(value: DateLike) -> Optional[int]:
        d = _coerce_date(value)
        return d.isocalendar()[1] if d else None

    @staticmethod
    def week_start(value: DateLike) -> Optional[_dt.date]:
        """Monday of the ISO week containing ``value``."""
        d = _coerce_date(value)
        if d is None:
            return None
        return d - _dt.timedelta(days=d.weekday())
