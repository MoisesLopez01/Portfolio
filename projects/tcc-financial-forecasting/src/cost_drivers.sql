-- ============================================================================
-- cost_drivers — forward annualised TCC impact by department & driver
-- Unifies the four levers that move labour cost into one tidy model:
--   ATTRITION  (removes cost)  · MERIT / PROMOTION (raise existing cost)
--   NEW_HIRE   (adds cost)
-- The result is the shape a P&L / variance dashboard groups and stacks.
-- ============================================================================
SELECT e.department, 'ATTRITION' AS cost_driver,
       ROUND(-SUM(e.annual_tcc), 2) AS annual_impact
FROM terminations t
JOIN employees e ON e.employee_id = t.employee_id
GROUP BY e.department

UNION ALL
SELECT e.department, 'MERIT',
       ROUND(SUM(c.delta_annual_tcc), 2)
FROM comp_events c
JOIN employees e ON e.employee_id = c.employee_id
WHERE c.event_type = 'merit'
GROUP BY e.department

UNION ALL
SELECT e.department, 'PROMOTION',
       ROUND(SUM(c.delta_annual_tcc), 2)
FROM comp_events c
JOIN employees e ON e.employee_id = c.employee_id
WHERE c.event_type = 'promotion'
GROUP BY e.department

UNION ALL
SELECT n.department, 'NEW_HIRE',
       ROUND(SUM(n.annual_tcc), 2)
FROM new_hires n
GROUP BY n.department

ORDER BY department, cost_driver;
