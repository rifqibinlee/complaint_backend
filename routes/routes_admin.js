/**
 * routes/admin.js — Phase 4
 *
 * Mount in server.js:
 *   app.use('/api/admin', require('./routes/admin'));
 *
 * Endpoints:
 *   GET   /api/admin/officers              — list all officer accounts
 *   PATCH /api/admin/complaints/:id/assign — assign complaint to officer
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { query } = require('../db');
const { sendPushNotification } = require('../services/push');

const router = express.Router();

// ─── GET /api/admin/officers ──────────────────────────────────────────────────

router.get('/officers', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const result = await query(
      `SELECT id, full_name, phone, created_at
       FROM   users
       WHERE  role = 'officer'
       ORDER  BY full_name ASC`
    );
    res.json({ officers: result.rows });
  } catch (e) {
    console.error('[GET /api/admin/officers]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/admin/complaints/:id/assign ───────────────────────────────────

router.patch('/complaints/:id/assign',
  authenticate,
  requireRole('admin'),
  [body('officer_id').isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'officer_id required' });

    const complaintId = parseInt(req.params.id, 10);
    if (isNaN(complaintId)) return res.status(400).json({ error: 'Invalid complaint ID' });

    const { officer_id } = req.body;

    try {
      // Verify officer exists
      const officerRes = await query(
        `SELECT id, full_name, push_token FROM users WHERE id = $1 AND role = 'officer'`,
        [officer_id]
      );
      if (officerRes.rows.length === 0) {
        return res.status(404).json({ error: 'Officer not found' });
      }
      const officer = officerRes.rows[0];

      // Fetch current complaint
      const compRes = await query(
        'SELECT assigned_to, status, title FROM complaints WHERE id = $1',
        [complaintId]
      );
      if (compRes.rows.length === 0) return res.status(404).json({ error: 'Complaint not found' });
      const comp = compRes.rows[0];

      // Assign + set in_progress
      await query(
        `UPDATE complaints
         SET assigned_to = $1, status = 'in_progress', updated_at = NOW()
         WHERE id = $2`,
        [officer_id, complaintId]
      );

      await query(
        `INSERT INTO audit_logs
           (actor_id, action, entity, entity_id, old_value, new_value, ip_address)
         VALUES ($1,'assign','complaint',$2,$3,$4,$5)`,
        [
          req.user.sub, complaintId,
          JSON.stringify({ assigned_to: comp.assigned_to, status: comp.status }),
          JSON.stringify({ assigned_to: officer_id,       status: 'in_progress' }),
          req.ip,
        ]
      );

      // Push notification to officer
      if (officer.push_token) {
        await sendPushNotification(
          officer.push_token,
          'New Task Assigned',
          comp.title,
          { complaint_id: complaintId }
        );
      }

      res.json({ ok: true, complaint_id: complaintId, officer_id, officer_name: officer.full_name });
    } catch (e) {
      console.error('[PATCH /api/admin/complaints/:id/assign]', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
