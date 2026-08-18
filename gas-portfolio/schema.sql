-- ─────────────────────────────────────────────────────────────────────────────
-- PlanetScale / MySQL schema for the portfolio backend.
-- Run once against your database (PlanetScale console, or MySQL Workbench
-- connected to the same database).
--
-- Note: PlanetScale doesn't use FOREIGN KEY constraints — none are needed here.
-- ─────────────────────────────────────────────────────────────────────────────

-- Donna chat + demo interaction log (replaces the Google Sheet).
CREATE TABLE IF NOT EXISTS chat_events (
  id       BIGINT       NOT NULL AUTO_INCREMENT,
  ts       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  session  VARCHAR(64)  NOT NULL DEFAULT 'anon',
  type     VARCHAR(32)  NOT NULL DEFAULT 'chat',
  role     VARCHAR(16)  NOT NULL DEFAULT 'user',
  message  TEXT,
  model    VARCHAR(64),
  tokens   INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_session (session),
  KEY idx_ts (ts)
);

-- Admin-added custom projects (replaces the CUSTOM_PROJECTS Script Property).
CREATE TABLE IF NOT EXISTS projects (
  id          VARCHAR(64) NOT NULL,
  data        JSON        NOT NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

-- Key/value settings (e.g. chat_logging on/off).
CREATE TABLE IF NOT EXISTS settings (
  k  VARCHAR(64)  NOT NULL,
  v  TEXT,
  PRIMARY KEY (k)
);

-- Per-IP rate-limit hits (sliding window; rows are pruned automatically).
CREATE TABLE IF NOT EXISTS rate_hits (
  id  BIGINT       NOT NULL AUTO_INCREMENT,
  ip  VARCHAR(64)  NOT NULL,
  ts  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ip_ts (ip, ts)
);
