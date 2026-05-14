/**
 * db/migrate.js
 *
 * Creates all database tables.
 * Run once with:  node db/migrate.js
 *
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS and ALTER TABLE ... IF NOT EXISTS.
 */

require('dotenv').config();
const db = require('./index');

async function migrate() {
  console.log('Running migrations...\n');

  // ── 1. Users ───────────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      ic            VARCHAR(12)  NOT NULL UNIQUE,
      full_name     VARCHAR(100) NOT NULL,
      phone         VARCHAR(15)  NOT NULL,
      address       TEXT         NOT NULL,
      password_hash TEXT         NOT NULL,
      role          VARCHAR(20)  NOT NULL DEFAULT 'public'
                    CHECK (role IN ('public', 'officer', 'admin')),
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
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
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token
    ON refresh_tokens(token)
  `);
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
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_complaints_user_id    ON complaints(user_id)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_complaints_status     ON complaints(status)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_complaints_category   ON complaints(category_id)`);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints(created_at DESC)`);
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

  console.log('\n✅  All migrations complete\n');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌  Migration failed:', err.message);
  process.exit(1);
});
