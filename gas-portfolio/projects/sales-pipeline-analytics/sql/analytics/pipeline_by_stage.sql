-- ============================================================================
-- pipeline_by_stage — dashboard-feeding analytics query
-- Open pipeline summarised by fiscal period and stage: raw amount, risk-
-- adjusted (weighted) amount, and average deal age. This is the shape a BI
-- tool (Looker / Tableau / Power BI) binds a funnel + trend chart to.
--
-- Window function ranks stages within each fiscal period by weighted value so
-- the dashboard can highlight the top-contributing stage per quarter.
-- ============================================================================
WITH open_deals AS (
    SELECT *
    FROM fct_deals
    WHERE is_open = 1
      AND fiscal_period IS NOT NULL
)
SELECT
    fiscal_period,
    stage,
    COUNT(*)                              AS deal_count,
    ROUND(SUM(amount), 2)                 AS pipeline_amount,
    ROUND(SUM(weighted_amount), 2)        AS weighted_amount,
    ROUND(AVG(days_since_activity), 1)    AS avg_days_idle,
    RANK() OVER (
        PARTITION BY fiscal_period
        ORDER BY SUM(weighted_amount) DESC
    )                                     AS stage_rank_in_period
FROM open_deals
GROUP BY fiscal_period, stage
ORDER BY fiscal_period, weighted_amount DESC;
