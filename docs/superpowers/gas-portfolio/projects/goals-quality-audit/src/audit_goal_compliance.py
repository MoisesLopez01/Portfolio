# ============================================================
# Goals Quality Audit Pipeline — compliance-rule layer
#
# SOURCE PENDING — production file to be added before publishing.
#
# This file is an ILLUSTRATIVE EXCERPT, not the full production source.
# It shows the documented approach: parsing the NetSuite goal-data JSON and
# applying the 10-goal bonus-eligibility rule to flag non-compliant
# employees. The complete production system (the SuiteQL extraction queries
# and the JSON-to-CSV / HR-notification layers) is not included in this repo
# yet.
# ============================================================

import json
import pandas as pd


def audit_goal_compliance(goals_json, min_goals=10):
    """Apply the bonus-eligibility goal-count rule to NetSuite goal data.

    Args:
        goals_json (str): JSON string — a list of employee objects, each with
            an ``id``, ``name``, and a ``goals`` list of objects carrying a
            ``status`` field.
        min_goals (int): Minimum active goals required for compliance.

    Returns:
        tuple[pandas.DataFrame, pandas.DataFrame]:
            (full results, non-compliant subset). The full frame has one row
            per employee with active-goal count, a ``compliant`` flag, and the
            ``gap`` to the threshold.
    """
    records = json.loads(goals_json)
    results = []
    for emp in records:
        active = [g for g in emp["goals"] if g["status"] == "Active"]
        results.append({
            "employee_id": emp["id"],
            "name": emp["name"],
            "active_goals": len(active),
            "compliant": len(active) >= min_goals,
            "gap": max(0, min_goals - len(active)),
        })
    df = pd.DataFrame(results)
    return df, df[~df["compliant"]]
