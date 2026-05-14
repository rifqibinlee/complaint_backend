/**
 * db/index.js
 *
 * PostgreSQL connection pool.
 * All database queries go through this module.
 *
 * Usage anywhere in the codebase:
 *   const db = require('../db');
 *   const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
 *   const rows = result.rows;
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // In production, enable SSL:
  // ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max:             10,   // Maximum number of connections in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Test the connection on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌  Database connection failed:', err.message);
    console.error('    Check your DATABASE_URL in .env');
    process.exit(1);
  }
  release();
  console.log('✅  Database connected');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
