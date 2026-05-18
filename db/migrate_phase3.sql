-- Phase 3 migration: network_complaints table
-- Run this once on the live database:
--   docker exec -i complaint_db psql -U complaint_user -d complaint_db < migrate_phase3.sql

CREATE TABLE IF NOT EXISTS network_complaints (
  id              SERIAL PRIMARY KEY,
  complaint_id    INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  timestamp       TIMESTAMPTZ NOT NULL,
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  accuracy        NUMERIC(10,2),
  carrier         VARCHAR(100),
  connection_type VARCHAR(50),
  latency_ms      NUMERIC(10,2),
  jitter_ms       NUMERIC(10,2),
  download_mbps   NUMERIC(10,4),
  upload_mbps     NUMERIC(10,4),
  rsrp            NUMERIC(10,2),
  rsrq            NUMERIC(10,2),
  sinr            NUMERIC(10,2),
  cell_id         VARCHAR(50),
  pci             VARCHAR(20),
  tac             VARCHAR(20),
  lte_band        VARCHAR(20),
  device_model    VARCHAR(100),
  os_version      VARCHAR(50),
  platform        VARCHAR(20),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast complaint_id lookups
CREATE INDEX IF NOT EXISTS idx_network_complaints_complaint_id
  ON network_complaints(complaint_id);
