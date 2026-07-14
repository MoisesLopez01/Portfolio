"""Goals Quality Audit — bonus-eligibility compliance rule engine.

Given a batch of employee goal records (as exported from a performance / ERP
system), this module flags anyone who is **not** bonus-eligible under two rules:

  1. at least ``min_goals`` goals in ``Active`` status, and
  2. at least ``min_commented`` of those active goals carry a self-comment
     (evidence the goal is actually being worked, not just parked).

The audit is pure and deterministic, so it is trivially testable and can run
before every bonus cycle. All data used in the demo is fully synthetic — no real
employees, ids, or company data.
"""

from __future__ import annotations

import json
from typing import Dict, List, Tuple, Union

import pandas as pd

JsonLike = Union[str, List[Dict]]


def _load(goals: JsonLike) -> List[Dict]:
    return json.loads(goals) if isinstance(goals, str) else goals


def audit_goal_compliance(
    goals: JsonLike,
    min_goals: int = 10,
    min_commented: int = 6,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Apply the bonus-eligibility rules to a batch of goal records.

    Args:
        goals: JSON string or list of employee objects. Each object has an
            ``id``, ``name`` and a ``goals`` list; each goal has a ``status``
            and a ``comments`` count.
        min_goals: Minimum ``Active`` goals required.
        min_commented: Minimum active goals that must have >= 1 self-comment.

    Returns:
        ``(results, exceptions)`` where ``results`` has one row per employee
        (counts, per-rule pass flags, overall ``compliant`` flag, ``gap`` to the
        goal threshold, and a human-readable ``reason``), and ``exceptions`` is
        the non-compliant subset — the rows that drive the HR notification.
    """
    records = _load(goals)
    rows = []
    for emp in records:
        emp_goals = emp.get("goals", [])
        active = [g for g in emp_goals if g.get("status") == "Active"]
        commented = [g for g in active if (g.get("comments") or 0) > 0]

        n_active = len(active)
        n_commented = len(commented)
        meets_count = n_active >= min_goals
        meets_comments = n_commented >= min_commented
        compliant = meets_count and meets_comments

        reasons = []
        if not meets_count:
            reasons.append("needs {} more active goals".format(min_goals - n_active))
        if not meets_comments:
            reasons.append("needs {} more commented goals".format(
                min_commented - n_commented))

        rows.append({
            "employee_id": emp.get("id"),
            "name": emp.get("name"),
            "active_goals": n_active,
            "commented_goals": n_commented,
            "meets_goal_count": meets_count,
            "meets_comment_rule": meets_comments,
            "compliant": compliant,
            "gap": max(0, min_goals - n_active),
            "reason": "; ".join(reasons) if reasons else "compliant",
        })

    df = pd.DataFrame(rows)
    exceptions = df[~df["compliant"]].sort_values("gap", ascending=False)
    return df, exceptions.reset_index(drop=True)


def compliance_rate(results: pd.DataFrame) -> float:
    """Share of employees who are bonus-eligible (0.0-1.0)."""
    if results.empty:
        return 0.0
    return round(results["compliant"].mean(), 4)
