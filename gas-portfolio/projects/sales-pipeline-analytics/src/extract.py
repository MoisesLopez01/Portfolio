"""Extract layer — pull raw deal records from a CRM REST API or a local file.

Two sources are supported:

* **API**  — cursor-paginated REST endpoint with retry/backoff. This mirrors a
  real CRM (e.g. a ``/crm/v3/objects/deals`` style endpoint) without depending
  on any specific vendor.
* **File** — a JSON array of raw deal objects. Used for the runnable demo and
  for tests, so the whole pipeline works offline with synthetic data.

The API path imports ``requests`` lazily so the file/demo path (and the test
suite) has no third-party network dependency.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Dict, List, Optional

from config import PipelineConfig

log = logging.getLogger(__name__)


def extract(source: str, config: Optional[PipelineConfig] = None) -> List[Dict]:
    """Dispatch to the right extractor based on ``source``.

    Args:
        source: An ``http(s)://`` URL (API mode) or a filesystem path (file mode).
        config: Pipeline configuration (API key, paging, retries).

    Returns:
        A list of raw deal dicts exactly as the source provides them — no
        transformation happens here (single-responsibility E/T/L boundary).
    """
    config = config or PipelineConfig()
    if source.startswith("http://") or source.startswith("https://"):
        return extract_from_api(source, config)
    return extract_from_file(source)


def extract_from_file(path: str) -> List[Dict]:
    """Read raw deals from a local JSON array."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    records = data.get("results", data) if isinstance(data, dict) else data
    log.info("Extracted %d raw records from file %s", len(records), path)
    return records


def extract_from_api(base_url: str, config: PipelineConfig) -> List[Dict]:
    """Cursor-paginate a CRM REST endpoint, collecting every page.

    Resilience built in:
      * exponential backoff with retry on 429 / 5xx / network errors
      * request timeout so a hung endpoint can't stall the pipeline
      * bounded retries so a persistent failure surfaces instead of looping
    """
    import requests  # lazy import: only needed for live API extraction

    session = requests.Session()
    session.headers.update({"Authorization": "Bearer {}".format(config.api_key)})

    all_records: List[Dict] = []
    cursor: Optional[str] = None
    page = 0

    while True:
        page += 1
        params = {"limit": config.page_size}
        if cursor:
            params["after"] = cursor

        payload = _get_with_retry(session, base_url, params, config)
        results = payload.get("results", [])
        all_records.extend(results)
        log.info("Page %d: +%d records (%d total)", page, len(results), len(all_records))

        paging = payload.get("paging") or {}
        cursor = (paging.get("next") or {}).get("after")
        if not cursor or not results:
            break

    log.info("Extracted %d raw records from API", len(all_records))
    return all_records


def _get_with_retry(session, url, params, config: PipelineConfig) -> Dict:
    """GET with exponential backoff. Raises after ``max_retries`` failures."""
    last_error = None
    for attempt in range(1, config.max_retries + 1):
        try:
            resp = session.get(url, params=params, timeout=config.request_timeout)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code in (429, 500, 502, 503, 504):
                last_error = "HTTP {}".format(resp.status_code)
            else:
                # 4xx (bad request / auth) won't fix itself — fail fast.
                resp.raise_for_status()
        except Exception as exc:  # network error, timeout, JSON error
            last_error = repr(exc)

        backoff = min(2 ** attempt, 30)
        log.warning("Attempt %d failed (%s); retrying in %ss", attempt, last_error, backoff)
        time.sleep(backoff)

    raise RuntimeError("Extraction failed after {} attempts: {}".format(
        config.max_retries, last_error))
