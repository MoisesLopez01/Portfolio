-- ============================================================
-- TCC Financial Forecasting System — attrition-proration query (SuiteQL)
--
-- SOURCE PENDING — production file to be added before publishing.
--
-- This file is an ILLUSTRATIVE EXCERPT, not the full production source.
-- It shows the documented approach: computing the partial-month TCC cost
-- impact of an attrition event by prorating annual TCC over the days
-- worked in the termination month. The complete production system (the
-- full Apps Script forecasting/LOB-allocation engine and the warehouse
-- query set) is not included in this repo yet.
-- ============================================================

-- Attrition proration: partial-month TCC cost impact.
-- Prorates each terminated employee's annual TCC by the fraction of the
-- termination month they were active, tagging the row as an ATTRITION cost driver.
SELECT
  e.employee_id,
  e.department,
  e.annual_tcc,
  ROUND(e.annual_tcc * (t.term_day / t.days_in_month), 2) AS prorated_cost,
  'ATTRITION' AS cost_driver,
  t.term_date
FROM employees e
JOIN terminations t ON e.employee_id = t.employee_id
WHERE t.term_date BETWEEN :period_start AND :period_end;
