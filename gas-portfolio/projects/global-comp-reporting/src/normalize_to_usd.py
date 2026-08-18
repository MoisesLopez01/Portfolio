"""Global compensation normalization — currency, cost-of-living, micro-banding.

Unifies salaries paid in many local currencies onto a single comparable basis:

  * convert local currency -> USD via injected FX rates,
  * apply a regional cost-of-living (COL) adjustment,
  * assign each employee to a micro-band within their role and report their
    position inside that band.

Pure functions over pandas frames — deterministic and testable. All demo data
is synthetic; nothing here is tied to a specific organisation.
"""

from __future__ import annotations

from typing import Dict

import pandas as pd


def normalize_to_usd(
    salary: float, currency: str, fx_rates: Dict[str, float], col_index: float
) -> dict:
    """Normalize a single local-currency salary to USD with a COL adjustment.

    Args:
        salary: Salary in local currency.
        currency: ISO currency code (must be a key in ``fx_rates``).
        fx_rates: Map of currency code -> units per USD (e.g. ``{"EUR": 0.92}``).
        col_index: Regional cost-of-living index (1.0 = baseline).

    Returns:
        Nominal USD, COL-adjusted USD, and the inputs used.

    Raises:
        ValueError: If no FX rate is available for ``currency``.
    """
    if currency not in fx_rates:
        raise ValueError("No FX rate for " + str(currency))
    nominal_usd = salary / fx_rates[currency]
    return {
        "nominal_usd": round(nominal_usd, 2),
        "col_adjusted": round(nominal_usd / col_index, 2),
        "currency": currency,
        "fx_rate": fx_rates[currency],
        "col_index": col_index,
    }


def normalize_roster(
    df: pd.DataFrame,
    fx_rates: Dict[str, float],
    col_by_region: Dict[str, float],
) -> pd.DataFrame:
    """Add ``nominal_usd`` and ``col_adjusted`` columns to a roster frame.

    Expected columns: ``salary_local``, ``currency``, ``region``. Rows with an
    unknown currency are dropped (and would be reported upstream) rather than
    producing a silently-wrong number.
    """
    out = df.copy()
    known = out["currency"].isin(fx_rates.keys())
    out = out[known].copy()

    out["col_index"] = out["region"].map(col_by_region).fillna(1.0)
    out["nominal_usd"] = (out["salary_local"] / out["currency"].map(fx_rates)).round(2)
    out["col_adjusted"] = (out["nominal_usd"] / out["col_index"]).round(2)
    return out


def assign_bands(df: pd.DataFrame, n_bands: int = 5) -> pd.DataFrame:
    """Assign each employee to a micro-band within their role.

    Bands are quantile cuts of COL-adjusted pay *within each role*, so a "Band 4"
    engineer and a "Band 4" designer are both high in their own role's range.
    Also reports ``band_position`` (0-1) inside the role's pay range.
    """
    out = df.copy()

    def _band(group: pd.DataFrame) -> pd.DataFrame:
        vals = group["col_adjusted"]
        # qcut needs enough distinct values; fall back to a single band otherwise.
        try:
            group["band"] = pd.qcut(vals, q=n_bands, labels=False, duplicates="drop") + 1
        except ValueError:
            group["band"] = 1
        lo, hi = vals.min(), vals.max()
        rng = (hi - lo) or 1.0
        group["band_position"] = ((vals - lo) / rng).round(3)
        return group

    out = out.groupby("role", group_keys=False).apply(_band)
    out["band"] = out["band"].astype(int)
    return out
