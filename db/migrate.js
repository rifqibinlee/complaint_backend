/**
 * db/migrate.js
 *
 * Creates all database tables.
 * Run once with:  node db/migrate.js
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS.
 */

require('dotenv').config();
const db = require('./index');

async function migrate() {
  console.log('Running migrations...\n');

  // ── 1. Users ───────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      ic               VARCHAR(12)  UNIQUE,
      ic_hash          VARCHAR(64)  UNIQUE,
      ic_encrypted     TEXT,
      full_name        VARCHAR(100) NOT NULL,
      phone            VARCHAR(15),
      phone_encrypted  TEXT,
      address          TEXT         NOT NULL,
      password_hash    TEXT         NOT NULL,
      role             VARCHAR(20)  NOT NULL DEFAULT 'public'
                       CHECK (role IN ('public', 'officer', 'admin')),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅  users table ready');

  // ── 2. Refresh tokens ──────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token      TEXT         NOT NULL UNIQUE,
      device_id  VARCHAR(200) NOT NULL DEFAULT 'unknown',
      expires_at TIMESTAMPTZ  NOT NULL,
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  // UNIQUE constraint on device_id (from HANDOVER.md — must be added explicitly)
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'refresh_tokens_device_id_key'
      ) THEN
        ALTER TABLE refresh_tokens ADD CONSTRAINT refresh_tokens_device_id_key UNIQUE (device_id);
      END IF;
    END $$
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token)`);
  console.log('✅  refresh_tokens table ready');

  // ── 3. Complaints ──────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER      NOT NULL REFERENCES users(id),
      title            VARCHAR(100) NOT NULL,
      description      TEXT         NOT NULL,
      category_id      VARCHAR(50)  NOT NULL,
      subcategory      VARCHAR(100) NOT NULL,
      status           VARCHAR(30)  NOT NULL DEFAULT 'open',
      lat              NUMERIC(10, 7),
      lng              NUMERIC(10, 7),
      image_url        TEXT,
      cost_to_resolve  NUMERIC(10, 2),
      assigned_to      INTEGER REFERENCES users(id),
      submitted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_complaints_user_id    ON complaints(user_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_complaints_status     ON complaints(status)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_complaints_category   ON complaints(category_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC)`);
  console.log('✅  complaints table ready');

  // ── 4. Audit log ───────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         SERIAL PRIMARY KEY,
      actor_id   INTEGER REFERENCES users(id),
      action     VARCHAR(100) NOT NULL,
      entity     VARCHAR(50)  NOT NULL,
      entity_id  TEXT         NOT NULL,
      old_value  JSONB,
      new_value  JSONB,
      ip_address VARCHAR(45),
      created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅  audit_logs table ready');

  // ── 5. Network complaints (Phase 3) ────────────────────────────────────────
  await db.query(`
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
      lte_band        VARCHAR(30),
      device_model    VARCHAR(100),
      os_version      VARCHAR(50),
      platform        VARCHAR(20),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  console.log('✅  network_complaints table ready');

  // ── 6. Officer locations (Phase 4) ─────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS officer_locations (
      id          SERIAL PRIMARY KEY,
      officer_id  INTEGER NOT NULL REFERENCES users(id),
      lat         NUMERIC(10,7) NOT NULL,
      lng         NUMERIC(10,7) NOT NULL,
      recorded_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_officer_locations_officer ON officer_locations(officer_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_officer_locations_time    ON officer_locations(recorded_at DESC)`);
  console.log('✅  officer_locations table ready');

  // ── 7. Task reports (Phase 4) ──────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS task_reports (
      id               SERIAL PRIMARY KEY,
      complaint_id     INTEGER NOT NULL REFERENCES complaints(id),
      officer_id       INTEGER NOT NULL REFERENCES users(id),
      action           VARCHAR(20) NOT NULL
                       CHECK (action IN ('arrive','resolve','cannot_resolve')),
      report_text      TEXT,
      selfie_url       TEXT,
      result_photo_url TEXT,
      elapsed_seconds  INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_task_reports_complaint ON task_reports(complaint_id)`);
  console.log('✅  task_reports table ready');

  console.log('\n✅  All migrations complete\n');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
