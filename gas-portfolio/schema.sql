-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase / PostgreSQL schema for the portfolio backend.
-- Run once against your Supabase database (Supabase SQL Editor, or psql CLI).
-- ─────────────────────────────────────────────────────────────────────────────

-- Donna chat + demo interaction log (replaces the Google Sheet).
CREATE TABLE IF NOT EXISTS chat_events (
  id       BIGSERIAL    PRIMARY KEY,
  ts       TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  session  VARCHAR(64)  NOT NULL DEFAULT 'anon',
  type     VARCHAR(32)  NOT NULL DEFAULT 'chat',
  role     VARCHAR(16)  NOT NULL DEFAULT 'user',
  message  TEXT,
  model    VARCHAR(64),
  tokens   INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_events(session);
CREATE INDEX IF NOT EXISTS idx_chat_ts ON chat_events(ts);

-- Admin-added custom projects (replaces the CUSTOM_PROJECTS Script Property).
CREATE TABLE IF NOT EXISTS projects (
  id         VARCHAR(64) PRIMARY KEY,
  data       JSONB       NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Key/value settings (e.g. chat_logging on/off).
CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(64) PRIMARY KEY,
  v TEXT
);

-- Per-IP rate-limit hits (sliding window; rows are pruned automatically).
CREATE TABLE IF NOT EXISTS rate_hits (
  id BIGSERIAL   PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_ip_ts ON rate_hits(ip, ts);
