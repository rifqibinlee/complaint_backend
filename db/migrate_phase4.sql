-- Phase 4 migration: officer_locations, task_reports, push_token on users
-- Run once:
--   docker exec -i complaint_db psql -U complaint_user -d complaint_db < migrate_phase4.sql

-- Push token column on users (for Expo push notifications)
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token VARCHAR(200);

-- Officer live locations (rolling 24h window, cleaned on each insert)
CREATE TABLE IF NOT EXISTS officer_locations (
  id          SERIAL PRIMARY KEY,
  officer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat         NUMERIC(10,7) NOT NULL,
  lng         NUMERIC(10,7) NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_officer_locations_officer_id
  ON officer_locations(officer_id);

CREATE INDEX IF NOT EXISTS idx_officer_locations_recorded_at
  ON officer_locations(recorded_at);

-- Task reports: one row per officer action (arrive / resolve / cannot_resolve)
CREATE TABLE IF NOT EXISTS task_reports (
  id               SERIAL PRIMARY KEY,
  complaint_id     INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  officer_id       INTEGER NOT NULL REFERENCES users(id),
  action           VARCHAR(20) NOT NULL
                   CHECK (action IN ('arrive','resolve','cannot_resolve')),
  report_text      TEXT,
  selfie_url       TEXT,
  result_photo_url TEXT,
  elapsed_seconds  INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_reports_complaint_id
  ON task_reports(complaint_id);

CREATE INDEX IF NOT EXISTS idx_task_reports_officer_id
  ON task_reports(officer_id);
