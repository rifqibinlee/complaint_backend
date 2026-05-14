/**
 * services/tokenService.js
 *
 * Handles JWT access tokens (short-lived, 15 min) and
 * opaque refresh tokens (long-lived, 30 days, stored in DB).
 */

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../db');

const ACCESS_TTL  = '15m';
const REFRESH_DAYS = 30;

// ─── Access token ──────────────────────────────────────────────────────────

function generateAccessToken(user) {
  return jwt.sign(
    {
      sub:  user.id,
      role: user.role,
      ic:   user.ic,
    },
    process.env.JWT_ACCESS_SECRET,
    {
      expiresIn: ACCESS_TTL,
      algorithm: 'HS256',
    }
  );
}

// ─── Refresh token ─────────────────────────────────────────────────────────

function generateRefreshToken() {
  // Random opaque string — not a JWT. Stored in the DB.
  return crypto.randomBytes(40).toString('hex');
}

async function saveRefreshToken(userId, token, deviceId = 'unknown') {
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  // One token per device — replace if the device already has one
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, device_id, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (device_id)
     DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at`,
    [userId, token, deviceId, expiresAt]
  );
}

/**
 * Validates the old refresh token, issues a new pair, and invalidates the old one.
 * Returns { accessToken, refreshToken } or throws.
 */
async function rotateRefreshToken(oldToken) {
  const result = await db.query(
    `SELECT rt.*, u.id as user_id, u.ic, u.role, u.full_name
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token = $1 AND rt.expires_at > NOW()`,
    [oldToken]
  );

  if (!result.rows.length) {
    throw new Error('Invalid or expired refresh token');
  }

  const row  = result.rows[0];
  const user = { id: row.user_id, ic: row.ic, role: row.role };

  const newAccessToken  = generateAccessToken(user);
  const newRefreshToken = generateRefreshToken();
  const newExpiry       = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

  // Rotate: replace old token with new one
  await db.query(
    `UPDATE refresh_tokens
     SET token = $1, expires_at = $2
     WHERE token = $3`,
    [newRefreshToken, newExpiry, oldToken]
  );

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

async function revokeRefreshToken(token) {
  await db.query('DELETE FROM refresh_tokens WHERE token = $1', [token]);
}

async function revokeAllUserTokens(userId) {
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [userId]);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
};
