-- ============================================================================
-- attrition_proration — partial-month TCC cost impact of attrition
-- Prorates each terminated employee's annual Total Cost of Compensation (TCC)
-- by the fraction of the termination month they were active, tagging the row as
-- an ATTRITION cost driver. Parameterised by an explicit period window.
-- (Runnable against the demo SQLite warehouse via src/run_sql.py.)
-- ============================================================================
SELECT
    e.employee_id,
    e.department,
    e.annual_tcc,
    ROUND(e.annual_tcc * (t.term_day * 1.0 / t.days_in_month), 2) AS prorated_cost,
    'ATTRITION' AS cost_driver,
    t.term_date
FROM employees e
JOIN terminations t ON e.employee_id = t.employee_id
WHERE t.term_date BETWEEN :period_start AND :period_end
ORDER BY prorated_cost DESC;
