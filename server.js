/**
 * server.js
 *
 * Entry point. This file wires together:
 *   1. Environment variables (.env)
 *   2. Security middleware (helmet, cors, rate limiting)
 *   3. Request parsing
 *   4. Routes
 *   5. Error handling
 *   6. Server start
 */

// ── Must be the very first line ─────────────────────────────────────────────
require('dotenv').config();

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const networkRoutes = require('./routes/network');

// ── Validate required environment variables before anything else ─────────────
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌  Missing required environment variable: ${key}`);
    console.error('    Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }
}

const app = express();

// ═══════════════════════════════════════════════════════════════════════════
//  1. SECURITY MIDDLEWARE
//  Applied before everything else so no request can bypass it.
// ═══════════════════════════════════════════════════════════════════════════

// helmet sets a suite of security-related HTTP headers automatically
app.use(helmet());

// CORS — which origins are allowed to call this API
// In production: list only your actual domains
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [
      'https://your-admin-dashboard.com',   // ← replace with your real domain
    ]
  : [
      'http://localhost:3000',
      'http://localhost:8081',
      'http://localhost:19006',
    ];

app.use(cors({
  origin:      allowedOrigins,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// Global rate limit — 100 requests per 15 minutes per IP
const globalLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many requests. Please try again later.' },
});
app.use('/api/', globalLimiter);

// Stricter limit on auth endpoints — 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             10,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Please wait before trying again.' },
});
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

// ═══════════════════════════════════════════════════════════════════════════
//  2. REQUEST PARSING
// ═══════════════════════════════════════════════════════════════════════════

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve uploaded images (in production, replace with S3 signed URLs)
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
app.use('/uploads', express.static(path.resolve(UPLOAD_DIR)));

// ═══════════════════════════════════════════════════════════════════════════
//  3. REQUEST LOGGING (development only)
// ═══════════════════════════════════════════════════════════════════════════

if (process.env.NODE_ENV !== 'production') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()}  ${req.method}  ${req.path}`);
    next();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.use('/api/auth',       require('./routes/auth'));
app.use('/api/complaints', require('./routes/network'));
app.use('/api/complaints', require('./routes/complaints'));

// Health check — unauthenticated, for uptime monitors
app.get('/health', (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. GLOBAL ERROR HANDLER
//  Catches any error thrown by route handlers via next(err).
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);

  // Multer file upload errors (e.g. file too large, wrong type)
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: `File too large. Maximum size is ${process.env.MAX_FILE_SIZE_MB ?? 5}MB.` });
  }
  if (err.message?.includes('Only JPG')) {
    return res.status(400).json({ error: err.message });
  }

  // Don't leak internal error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Something went wrong. Please try again.'
    : err.message;

  res.status(err.status ?? 500).json({ error: message });
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. START
// ═══════════════════════════════════════════════════════════════════════════

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`\n🚀  Server running on port ${PORT}`);
  console.log(`    Environment: ${process.env.NODE_ENV ?? 'development'}`);
  console.log(`    Health:      http://localhost:${PORT}/health\n`);
});

