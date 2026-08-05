-- ============================================================================
-- dim_owner — owner dimension
-- One row per deal owner with their book-of-business rollup. Joins back to the
-- fact on owner_id. In a warehouse this would be materialised as a table;
-- here it is a view over the loaded facts.
-- ============================================================================
SELECT
    owner_id,
    COUNT(*)                                        AS total_deals,
    SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END)    AS open_deals,
    SUM(CASE WHEN is_won  = 1 THEN 1 ELSE 0 END)    AS won_deals,
    SUM(CASE WHEN is_open = 1 THEN amount ELSE 0 END)          AS open_pipeline,
    SUM(CASE WHEN is_open = 1 THEN weighted_amount ELSE 0 END) AS weighted_pipeline,
    SUM(CASE WHEN is_won  = 1 THEN amount ELSE 0 END)          AS won_amount
FROM fct_deals
GROUP BY owner_id
ORDER BY weighted_pipeline DESC;
