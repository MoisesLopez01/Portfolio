-- ============================================================================
-- actuals_vs_forecast — quarterly variance by department
-- Full-outer-join actuals to forecast per (department, period), returning the
-- absolute and percentage variance. Departments over the top variance threshold
-- surface first — the "Top Department Variance" view a CFO dashboard leads with.
--
-- SQLite has no FULL OUTER JOIN, so it is emulated with LEFT JOIN + UNION.
-- (In BigQuery/Snowflake this collapses to a single FULL OUTER JOIN.)
-- ============================================================================
WITH combined AS (
    SELECT f.department, f.period, f.forecast_tcc,
           COALESCE(a.actual_tcc, 0) AS actual_tcc
    FROM forecast f
    LEFT JOIN actuals a ON a.department = f.department AND a.period = f.period

    UNION

    SELECT a.department, a.period,
           COALESCE(f.forecast_tcc, 0) AS forecast_tcc,
           a.actual_tcc
    FROM actuals a
    LEFT JOIN forecast f ON f.department = a.department AND f.period = a.period
)
SELECT
    department,
    period,
    forecast_tcc,
    actual_tcc,
    ROUND(actual_tcc - forecast_tcc, 2) AS variance,
    ROUND(
        CASE WHEN forecast_tcc = 0 THEN NULL
             ELSE (actual_tcc - forecast_tcc) * 100.0 / forecast_tcc END, 1
    ) AS variance_pct
FROM combined
GROUP BY department, period
ORDER BY ABS(actual_tcc - forecast_tcc) DESC;
