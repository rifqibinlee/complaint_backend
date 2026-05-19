/**
 * routes/auth.js
 *
 * POST /api/auth/register  — create a new public user account
 * POST /api/auth/login     — returns accessToken + refreshToken
 * POST /api/auth/refresh   — exchange a refresh token for a new pair
 * POST /api/auth/logout    — revoke the refresh token
 *
 * Phase 6: IC and phone are now stored encrypted (PDPA).
 *   - ic_hash (HMAC-SHA256) is used for lookup
 *   - ic_encrypted (AES-256) is stored for display
 *   - Legacy plain `ic` column is checked as fallback during migration window
 */

const router    = require('express').Router();
const bcrypt    = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const db        = require('../db');
const tokens    = require('../services/tokenService');
const enc       = require('../services/encryption');
const { authenticate } = require('../middleware/authenticate');

function validationFailed(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }
  return false;
}

// ─── POST /api/auth/register ───────────────────────────────────────────────

router.post(
  '/register',
  [
    body('ic').trim().isLength({ min: 12, max: 12 }).withMessage('IC must be exactly 12 digits').isNumeric().withMessage('IC must contain only numbers'),
    body('full_name').trim().isLength({ min: 2, max: 100 }).withMessage('Full name must be 2–100 characters').escape(),
    body('phone').trim().isLength({ min: 10, max: 11 }).withMessage('Phone must be 10–11 digits').isNumeric().withMessage('Phone must contain only numbers'),
    body('address').trim().isLength({ min: 10, max: 500 }).withMessage('Address must be 10–500 characters').escape(),
    body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8–128 characters').matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter').matches(/[0-9]/).withMessage('Password must contain at least one number'),
  ],
  async (req, res) => {
    if (validationFailed(req, res)) return;

    const { ic, full_name, phone, address, password } = req.body;

    try {
      const icHash = enc.hmac(ic);

      // Check for duplicate using HMAC (also check legacy plain column)
      const existing = await db.query(
        'SELECT id FROM users WHERE ic_hash = $1 OR ic = $2',
        [icHash, ic]
      );
      if (existing.rows.length) {
        return res.status(409).json({ error: 'An account with this IC already exists.' });
      }

      const hash = await bcrypt.hash(password, 12);

      const result = await db.query(
        `INSERT INTO users (ic_hash, ic_encrypted, full_name, phone_encrypted, address, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, $6, 'public')
         RETURNING id, full_name, role`,
        [icHash, enc.encrypt(ic), full_name, enc.encrypt(phone), address, hash]
      );

      const user         = { ...result.rows[0], ic, phone }; // return plain to app session only
      const accessToken  = tokens.generateAccessToken(user);
      const refreshToken = tokens.generateRefreshToken();
      const deviceId     = req.headers['x-device-id'] ?? 'unknown';

      await tokens.saveRefreshToken(user.id, refreshToken, deviceId);

      res.status(201).json({ user, accessToken, refreshToken });
    } catch (e) {
      console.error('[Auth] Register error:', e.message);
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }
);

// ─── POST /api/auth/login ──────────────────────────────────────────────────

router.post(
  '/login',
  [
    body('ic').trim().notEmpty().withMessage('IC number is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    if (validationFailed(req, res)) return;

    const { ic, password } = req.body;

    try {
      const icHash = enc.hmac(ic.trim());

      // Try encrypted lookup first, fall back to plain ic for legacy accounts
      const result = await db.query(
        `SELECT id, ic, ic_hash, ic_encrypted, full_name, phone, phone_encrypted, role, password_hash
         FROM users
         WHERE ic_hash = $1 OR ic = $2`,
        [icHash, ic.trim()]
      );

      const user  = result.rows[0];
      const valid = user && await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return res.status(401).json({ error: 'Invalid IC number or password.' });
      }

      // Decrypt fields for the session token
      const plainIc    = user.ic_encrypted ? enc.decrypt(user.ic_encrypted) : user.ic;
      const plainPhone = user.phone_encrypted ? enc.decrypt(user.phone_encrypted) : user.phone;

      const accessToken  = tokens.generateAccessToken(user);
      const refreshToken = tokens.generateRefreshToken();
      const deviceId     = req.headers['x-device-id'] ?? 'unknown';

      await tokens.saveRefreshToken(user.id, refreshToken, deviceId);

      const safeUser = { id: user.id, ic: plainIc, full_name: user.full_name, phone: plainPhone, role: user.role };
      res.json({ user: safeUser, accessToken, refreshToken });
    } catch (e) {
      console.error('[Auth] Login error:', e.message);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }
);

// ─── POST /api/auth/refresh ────────────────────────────────────────────────

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token is required' });
  try {
    const newTokens = await tokens.rotateRefreshToken(refreshToken);
    res.json(newTokens);
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
});

// ─── POST /api/auth/logout ─────────────────────────────────────────────────

router.post('/logout', authenticate, async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) await tokens.revokeRefreshToken(refreshToken).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
