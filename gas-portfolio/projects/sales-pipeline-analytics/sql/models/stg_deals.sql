-- ============================================================================
-- stg_deals — staging model
-- Light, non-destructive cleanup over the loaded fact table: canonical column
-- names, explicit casts, and a single computed grain (one row per deal).
-- Downstream models build on this rather than on the raw load.
-- ============================================================================
SELECT
    deal_id,
    deal_name,
    owner_id,
    account_name,
    stage,
    CAST(amount           AS REAL)    AS amount,
    CAST(weighted_amount  AS REAL)    AS weighted_amount,
    CAST(win_rate         AS REAL)    AS win_rate,
    CAST(is_open          AS INTEGER) AS is_open,
    CAST(is_won           AS INTEGER) AS is_won,
    CAST(is_lost          AS INTEGER) AS is_lost,
    DATE(created_at)                  AS created_date,
    DATE(closed_at)                   AS closed_date,
    fiscal_period,
    close_iso_week,
    days_since_activity,
    deal_health
FROM fct_deals;
