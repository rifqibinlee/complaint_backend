const express    = require('express');
const { body, validationResult } = require('express-validator');
const { Pool }   = require('pg');
const { authenticate } = require('../middleware/auth'); // existing middleware

const router = express.Router();
const db = require('../db');

// ─── POST /api/complaints/network ────────────────────────────────────────────

const networkValidators = [
  body('title').trim().isLength({ min: 3, max: 100 }).escape(),
  body('description').trim().isLength({ min: 5, max: 500 }).escape(),
  body('subcategory').trim().notEmpty().escape(),
  body('timestamp').isISO8601(),
  body('lat').optional({ nullable: true }).isFloat({ min: -90,  max: 90  }),
  body('lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
  body('accuracy').optional({ nullable: true }).isFloat({ min: 0 }),
  body('latency_ms').optional({ nullable: true }).isFloat({ min: 0 }),
  body('jitter_ms').optional({ nullable: true }).isFloat({ min: 0 }),
  body('download_mbps').optional({ nullable: true }).isFloat({ min: 0 }),
  body('upload_mbps').optional({ nullable: true }).isFloat({ min: 0 }),
];

router.post('/network', authenticate, networkValidators, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const {
    title, description, subcategory, timestamp,
    lat, lng, accuracy,
    carrier, connection_type,
    latency_ms, jitter_ms, download_mbps, upload_mbps,
    rsrp, rsrq, sinr, cell_id, pci, tac, lte_band,
    device_model, os_version, platform,
  } = req.body;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Insert base complaint row (status = 'submitted', no location officer workflow)
    const complaintRes = await client.query(
      `INSERT INTO complaints
         (user_id, title, description, category_id, subcategory, status,
          lat, lng, submitted_at, created_at, updated_at)
       VALUES ($1,$2,$3,'network',$4,'submitted',
               $5,$6, NOW(), NOW(), NOW())
       RETURNING *`,
      [req.user.sub, title, description, subcategory,
       lat ?? null, lng ?? null]
    );
    const complaint = complaintRes.rows[0];

    // 2. Insert network diagnostics row
    await client.query(
      `INSERT INTO network_complaints
         (complaint_id, timestamp, lat, lng, accuracy,
          carrier, connection_type,
          latency_ms, jitter_ms, download_mbps, upload_mbps,
          rsrp, rsrq, sinr, cell_id, pci, tac, lte_band,
          device_model, os_version, platform)
       VALUES
         ($1,$2,$3,$4,$5,
          $6,$7,
          $8,$9,$10,$11,
          $12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21)`,
      [
        complaint.id, timestamp, lat ?? null, lng ?? null, accuracy ?? null,
        carrier ?? null, connection_type ?? null,
        latency_ms ?? null, jitter_ms ?? null,
        download_mbps ?? null, upload_mbps ?? null,
        rsrp ?? null, rsrq ?? null, sinr ?? null,
        cell_id ?? null, pci ?? null, tac ?? null, lte_band ?? null,
        device_model ?? null, os_version ?? null, platform ?? null,
      ]
    );

    // 3. Audit log
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, ip_address)
       VALUES ($1,'create','complaint',$2,$3)`,
      [req.user.sub, complaint.id, req.ip]
    );

    await client.query('COMMIT');
    return res.status(201).json(complaint);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[POST /api/complaints/network]', e.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// ─── GET /api/complaints/:id/network-diagnostics ─────────────────────────────

router.get('/:id/network-diagnostics', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid complaint ID' });

  try {
    // Verify the complaint belongs to this user (or user is admin/officer)
    const compRes = await db.query(
      'SELECT user_id, category_id FROM complaints WHERE id = $1', [id]
    );
    if (compRes.rows.length === 0) return res.status(404).json({ error: 'Not found' });

    const comp = compRes.rows[0];
    const isOwner = comp.user_id === req.user.sub;
    const isStaff = ['admin', 'officer'].includes(req.user.role);
    if (!isOwner && !isStaff) return res.status(403).json({ error: 'Forbidden' });

    if (comp.category_id !== 'network') {
      return res.status(404).json({ error: 'Not a network complaint' });
    }

    const diagRes = await db.query(
      'SELECT * FROM network_complaints WHERE complaint_id = $1 ORDER BY id DESC LIMIT 1', [id]
    );
    if (diagRes.rows.length === 0) return res.status(404).json({ error: 'Diagnostics not found' });

    return res.json(diagRes.rows[0]);
  } catch (e) {
    console.error('[GET /api/complaints/:id/network-diagnostics]', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
