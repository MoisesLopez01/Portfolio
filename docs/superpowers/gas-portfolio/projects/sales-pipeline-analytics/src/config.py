"""Pipeline configuration — single source of truth for tunable values.

Nothing here is environment-specific except values read from the environment
(API base URL, API key, warehouse path). The stage ids below are illustrative
CRM-style codes, not real ones.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Dict


# Raw CRM stage id -> canonical, human-readable stage name.
# A CRM typically exposes opaque numeric stage ids; the pipeline maps them to a
# stable vocabulary so downstream models never depend on raw ids.
STAGE_MAP: Dict[str, str] = {
    "1001": "Prospect",
    "1002": "Qualify",
    "1003": "Proposal",
    "1004": "Negotiate",
    "1005": "Commit",
    "1006": "Closed Won",
    "1007": "Closed Lost",
}

# Probability a deal in a given stage eventually closes-won. Used to compute a
# risk-adjusted ("weighted") pipeline value.
STAGE_WIN_RATES: Dict[str, float] = {
    "Prospect": 0.05,
    "Qualify": 0.20,
    "Proposal": 0.40,
    "Negotiate": 0.60,
    "Commit": 0.90,
    "Closed Won": 1.00,
    "Closed Lost": 0.00,
}

# Deal-health bands by days since last activity (inclusive upper bound).
# Anything beyond the last band is treated as "Stagnant".
HEALTH_BANDS = [
    (14, "Healthy"),
    (30, "Warning"),
    (60, "At-Risk"),
    (90, "Critical"),
]
HEALTH_STAGNANT = "Stagnant"


@dataclass
class PipelineConfig:
    """Runtime configuration, overridable via environment variables."""

    api_base_url: str = field(
        default_factory=lambda: os.environ.get("CRM_API_BASE_URL", "")
    )
    api_key: str = field(
        default_factory=lambda: os.environ.get("CRM_API_KEY", "")
    )
    warehouse_path: str = field(
        default_factory=lambda: os.environ.get("WAREHOUSE_DB_PATH", "warehouse.db")
    )
    fy_start_month: int = 7
    # Data-quality thresholds.
    min_amount: float = 0.01
    # API paging / resilience.
    page_size: int = 100
    max_retries: int = 4
    request_timeout: int = 30
