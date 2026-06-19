# ============================================================
# Global Compensation Reporting Tool — currency / COL normalization
#
# SOURCE PENDING — production file to be added before publishing.
#
# This file is an ILLUSTRATIVE EXCERPT, not the full production source.
# It shows the documented approach: normalizing a local-currency salary to
# USD and applying a regional cost-of-living adjustment. The complete
# production system (Gemini Pro prompting logic, micro-banding engine, and
# PDF / Google Sheets output generators) is not included in this repo yet.
# ============================================================


def normalize_to_usd(salary, currency, fx_rates, col_index):
    """Normalize a local-currency salary to USD with a COL adjustment.

    Args:
        salary (float): Salary in local currency.
        currency (str): ISO currency code (must be a key in ``fx_rates``).
        fx_rates (dict): Map of currency code -> units per USD.
        col_index (float): Regional cost-of-living index (1.0 = baseline).

    Returns:
        dict: Nominal USD, COL-adjusted USD, and the inputs used.

    Raises:
        ValueError: If no FX rate is available for ``currency``.
    """
    if currency not in fx_rates:
        raise ValueError('No FX rate for ' + currency)
    nominal_usd = salary / fx_rates[currency]
    return {
        'nominal_usd': round(nominal_usd, 2),
        'col_adjusted': round(nominal_usd / col_index, 2),
        'currency': currency,
        'fx_rate': fx_rates[currency],
        'col_index': col_index,
    }
