"""Pipeline orchestrator — Extract -> Transform -> Load, with a run summary.

Run the demo end-to-end against the bundled synthetic data:

    python src/pipeline.py --source data/sample_deals.json --db warehouse.db

Or against a live CRM endpoint (set CRM_API_KEY in the environment):

    python src/pipeline.py --source https://api.example-crm.com/v3/deals --db warehouse.db

The E/T/L functions are deliberately import-friendly so this same flow can be
wrapped in an Airflow DAG (one task per stage) or a Cloud Function without
changing the core logic.
"""

from __future__ import annotations

import argparse
import logging
import sys

import pandas as pd

from config import PipelineConfig
from extract import extract
from load import load
from transform import transform


def build_config(args: argparse.Namespace) -> PipelineConfig:
    config = PipelineConfig()
    if args.db:
        config.warehouse_path = args.db
    if args.min_amount is not None:
        config.min_amount = args.min_amount
    if args.fy_start_month is not None:
        config.fy_start_month = args.fy_start_month
    return config


def run(source: str, config: PipelineConfig) -> dict:
    """Execute the pipeline and return the data-quality / load summary."""
    logging.info("Starting pipeline run | source=%s | db=%s", source, config.warehouse_path)

    raw = extract(source, config)
    df, report = transform(raw, config)
    rows_loaded = load(df, config.warehouse_path)
    report["rows_loaded"] = rows_loaded

    return report


def _print_summary(report: dict) -> None:
    print("\n" + "=" * 44)
    print("  PIPELINE RUN SUMMARY")
    print("=" * 44)
    labels = [
        ("raw_rows", "Raw records extracted"),
        ("duplicates_removed", "Duplicates removed"),
        ("rejected_missing_id", "Rejected: missing id"),
        ("rejected_unknown_stage", "Rejected: unknown stage"),
        ("rejected_bad_amount", "Rejected: bad amount"),
        ("final_rows", "Clean rows"),
        ("rows_loaded", "Rows loaded to warehouse"),
    ]
    for key, label in labels:
        print("  {:<28} {:>8}".format(label, report.get(key, 0)))
    print("=" * 44 + "\n")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="CRM sales-pipeline ETL")
    parser.add_argument("--source", required=True,
                        help="API URL (https://...) or path to a JSON file of raw deals")
    parser.add_argument("--db", default=None, help="Warehouse (SQLite) path")
    parser.add_argument("--min-amount", type=float, default=None,
                        help="Drop deals below this amount (data-quality floor)")
    parser.add_argument("--fy-start-month", type=int, default=None,
                        help="Fiscal-year start month (1-12); default 7")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    config = build_config(args)
    try:
        report = run(args.source, config)
    except Exception as exc:  # surface a clean failure + non-zero exit for schedulers
        logging.error("Pipeline failed: %s", exc)
        return 1

    _print_summary(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
