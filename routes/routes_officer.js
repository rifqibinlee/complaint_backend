/**
 * routes/officer.js — Phase 4
 *
 * Mount in server.js:
 *   app.use('/api/officer', require('./routes/officer'));
 *
 * Endpoints:
 *   GET   /api/officer/tasks               — list assigned complaints
 *   POST  /api/officer/location            — upsert current GPS location
 *   PATCH /api/officer/tasks/:id/update    — arrive / resolve / cannot_resolve
 *   POST  /api/officer/push-token          — register Expo push token
 */

const express   = require('express');
const multer    = require('multer');
const path      = require('path');
const { body, validationResult } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { query } = require('../db');

const router = express.Router();

// ─── Multer (officer photos: selfie + result_photo) ───────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR ?? './uploads'),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `officer_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB ?? '5')) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, and WEBP images are allowed'));
    }
  },
});

// ─── GET /api/officer/tasks ───────────────────────────────────────────────────

router.get('/tasks', authenticate, requireRole('officer'), async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*,
              tr_arrive.created_at  AS arrived_at,
              tr_resolve.action     AS resolved_action
       FROM   complaints c
       LEFT JOIN task_reports tr_arrive
              ON tr_arrive.complaint_id = c.id
             AND tr_arrive.action = 'arrive'
             AND tr_arrive.officer_id = $1
       LEFT JOIN task_reports tr_resolve
              ON tr_resolve.complaint_id = c.id
             AND tr_resolve.action IN ('resolve','cannot_resolve')
             AND tr_resolve.officer_id = $1
       WHERE  c.assigned_to = $1
       ORDER  BY c.created_at DESC`,
      [req.user.sub]
    );
    res.json({ tasks: result.rows });
  } catch (e) {
    console.error('[GET /api/officer/tasks]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── POST /api/officer/location ───────────────────────────────────────────────

router.post('/location',
  authenticate,
  requireRole('officer'),
  [
    body('lat').isFloat({ min: -90,  max: 90  }),
    body('lng').isFloat({ min: -180, max: 180 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid coordinates' });

    const { lat, lng } = req.body;
    try {
      await query(
        `INSERT INTO officer_locations (officer_id, lat, lng) VALUES ($1,$2,$3)`,
        [req.user.sub, lat, lng]
      );
      // Rolling 24h cleanup
      await query(
        `DELETE FROM officer_locations
         WHERE  officer_id = $1
           AND  recorded_at < NOW() - INTERVAL '24 hours'`,
        [req.user.sub]
      );
      res.status(201).json({ ok: true });
    } catch (e) {
      console.error('[POST /api/officer/location]', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─── PATCH /api/officer/tasks/:id/update ─────────────────────────────────────

router.patch('/tasks/:id/update',
  authenticate,
  requireRole('officer'),
  upload.fields([
    { name: 'selfie',       maxCount: 1 },
    { name: 'result_photo', maxCount: 1 },
  ]),
  [
    body('action').isIn(['arrive', 'resolve', 'cannot_resolve']),
    body('report_text').optional().trim().isLength({ max: 2000 }).escape(),
    body('elapsed_seconds').optional().isInt({ min: 0 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    const complaintId = parseInt(req.params.id, 10);
    if (isNaN(complaintId)) return res.status(400).json({ error: 'Invalid complaint ID' });

    const { action, report_text, elapsed_seconds } = req.body;
    const selfieUrl      = req.files?.selfie?.[0]       ? `/uploads/${req.files.selfie[0].filename}`       : null;
    const resultPhotoUrl = req.files?.result_photo?.[0] ? `/uploads/${req.files.result_photo[0].filename}` : null;

    try {
      // Verify complaint is assigned to this officer
      const compRes = await query(
        'SELECT assigned_to, status FROM complaints WHERE id = $1', [complaintId]
      );
      if (compRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });
      if (compRes.rows[0].assigned_to !== req.user.sub) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const oldStatus = compRes.rows[0].status;

      // Insert task report
      await query(
        `INSERT INTO task_reports
           (complaint_id, officer_id, action, report_text,
            selfie_url, result_photo_url, elapsed_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [complaintId, req.user.sub, action,
         report_text ?? null, selfieUrl, resultPhotoUrl,
         elapsed_seconds ? parseInt(elapsed_seconds) : null]
      );

      // Update complaint status
      let newStatus = oldStatus;
      if (action === 'resolve') newStatus = 'resolved';
      // cannot_resolve stays in_progress — flagged for re-assignment by admin

      if (newStatus !== oldStatus) {
        await query(
          `UPDATE complaints SET status = $1, updated_at = NOW() WHERE id = $2`,
          [newStatus, complaintId]
        );
        await query(
          `INSERT INTO audit_logs
             (actor_id, action, entity, entity_id, old_value, new_value, ip_address)
           VALUES ($1,'status_update','complaint',$2,$3,$4,$5)`,
          [req.user.sub, complaintId,
           JSON.stringify({ status: oldStatus }),
           JSON.stringify({ status: newStatus }),
           req.ip]
        );
      }

      res.json({ ok: true, action, new_status: newStatus });
    } catch (e) {
      console.error('[PATCH /api/officer/tasks/:id/update]', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─── POST /api/officer/push-token ────────────────────────────────────────────

router.post('/push-token',
  authenticate,
  requireRole('officer'),
  [body('token').trim().notEmpty()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Token required' });

    try {
      await query('UPDATE users SET push_token = $1 WHERE id = $2', [req.body.token, req.user.sub]);
      res.json({ ok: true });
    } catch (e) {
      console.error('[POST /api/officer/push-token]', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
