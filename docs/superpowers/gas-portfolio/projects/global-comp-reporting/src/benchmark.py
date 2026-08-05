"""Market benchmarking via Vertex AI (Gemini) — with an offline fallback.

In production this module asks a Vertex AI generative model for a market salary
midpoint for a (role, region) pair, then the comp tool computes each employee's
compa-ratio (actual / market) to spot under- and over-paid positions.

For the demo — and any environment without GCP credentials — it transparently
falls back to a **deterministic** market table so the whole report still runs
offline. The public API (`benchmark_salary`) is identical either way, so the
rest of the pipeline never needs to know which path was taken.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, Optional

log = logging.getLogger(__name__)

# Deterministic fallback market midpoints (USD, COL-baseline) by role.
_BASE_MARKET_USD: Dict[str, float] = {
    "Data Engineer": 120_000,
    "Analytics Engineer": 115_000,
    "Software Engineer": 125_000,
    "Product Designer": 110_000,
    "Product Manager": 135_000,
    "Support Engineer": 85_000,
}
# Regional market multipliers relative to the US baseline.
_REGION_MULT: Dict[str, float] = {
    "US": 1.00, "UK": 0.90, "EU": 0.88, "LATAM": 0.55, "APAC": 0.70, "India": 0.45,
}


def _vertex_available() -> bool:
    """True only if the Vertex AI SDK *and* a project id are both present."""
    if not os.environ.get("GCP_PROJECT"):
        return False
    try:
        import vertexai  # noqa: F401
        return True
    except Exception:
        return False


def _benchmark_via_vertex(role: str, region: str) -> Optional[float]:
    """Query Vertex AI for a market midpoint. Returns None on any failure."""
    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel

        vertexai.init(
            project=os.environ["GCP_PROJECT"],
            location=os.environ.get("GCP_LOCATION", "us-central1"),
        )
        model = GenerativeModel("gemini-1.5-pro")
        prompt = (
            "Return only a single integer: the estimated annual market-midpoint "
            "base salary in USD for a {} in the {} region. No text, no currency "
            "symbol.".format(role, region)
        )
        resp = model.generate_content(prompt)
        digits = "".join(ch for ch in resp.text if ch.isdigit())
        return float(digits) if digits else None
    except Exception as exc:  # SDK/auth/quota/parse — fall back gracefully
        log.warning("Vertex AI benchmark failed (%s); using fallback table", exc)
        return None


def _benchmark_fallback(role: str, region: str) -> float:
    base = _BASE_MARKET_USD.get(role, 100_000)
    mult = _REGION_MULT.get(region, 0.75)
    return round(base * mult, 2)


def benchmark_salary(role: str, region: str) -> dict:
    """Return the market midpoint for a (role, region) and which source was used."""
    if _vertex_available():
        value = _benchmark_via_vertex(role, region)
        if value is not None:
            return {"role": role, "region": region, "market_usd": value,
                    "source": "vertex-ai"}
    return {"role": role, "region": region,
            "market_usd": _benchmark_fallback(role, region), "source": "fallback-table"}


def compa_ratio(actual_usd: float, market_usd: float) -> float:
    """Actual pay / market midpoint. <0.9 under-paid, >1.1 over-paid (typical bands)."""
    if not market_usd:
        return 0.0
    return round(actual_usd / market_usd, 3)
