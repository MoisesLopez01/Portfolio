"""Unit tests for the goals compliance rule engine."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from audit_goal_compliance import audit_goal_compliance, compliance_rate  # noqa: E402


def _emp(emp_id, active, commented, drafts=0):
    """Build an employee with `active` active goals, `commented` of them commented."""
    goals = []
    for i in range(active):
        goals.append({"status": "Active", "comments": 1 if i < commented else 0})
    for _ in range(drafts):
        goals.append({"status": "Draft", "comments": 0})
    return {"id": emp_id, "name": emp_id, "goals": goals}


def test_fully_compliant():
    data = [_emp("E1", active=10, commented=6)]
    results, exceptions = audit_goal_compliance(data, min_goals=10, min_commented=6)
    assert bool(results.iloc[0]["compliant"]) is True
    assert len(exceptions) == 0


def test_fails_goal_count():
    data = [_emp("E1", active=7, commented=7)]
    results, exceptions = audit_goal_compliance(data, min_goals=10, min_commented=6)
    row = results.iloc[0]
    assert bool(row["compliant"]) is False
    assert row["gap"] == 3
    assert "3 more active goals" in row["reason"]
    assert len(exceptions) == 1


def test_fails_comment_rule_only():
    data = [_emp("E1", active=12, commented=2)]
    results, _ = audit_goal_compliance(data, min_goals=10, min_commented=6)
    row = results.iloc[0]
    assert bool(row["meets_goal_count"]) is True
    assert bool(row["meets_comment_rule"]) is False
    assert bool(row["compliant"]) is False


def test_drafts_do_not_count_as_active():
    data = [_emp("E1", active=9, commented=9, drafts=5)]
    results, _ = audit_goal_compliance(data, min_goals=10, min_commented=6)
    assert results.iloc[0]["active_goals"] == 9  # drafts excluded


def test_compliance_rate():
    data = [_emp("E1", 10, 6), _emp("E2", 4, 4), _emp("E3", 11, 7)]
    results, exceptions = audit_goal_compliance(data)
    assert round(compliance_rate(results), 4) == round(2 / 3, 4)
    assert len(exceptions) == 1
