/**
 * routes/admin.js — Phase 5
 *
 * Mount in server.js:
 *   app.use('/api/admin', require('./routes/admin'));
 */

const express = require('express');
const { body, query: qv, validationResult } = require('express-validator');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { query } = require('../db');
const { sendPushNotification } = require('../services/push');

const router = express.Router();
const guard = [authenticate, requireRole('admin')];

// ─── GET /api/admin/analytics/summary ────────────────────────────────────────

router.get('/analytics/summary', ...guard, async (req, res) => {
  try {
    const r = await query(`
      SELECT
        COUNT(*)                                                            AS total,
        COUNT(*) FILTER (WHERE status = 'open')                            AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress')                     AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved')                        AS resolved,
        COUNT(*) FILTER (WHERE status = 'closed')                          AS closed,
        COALESCE(SUM(cost_to_resolve)
          FILTER (WHERE status IN ('resolved','closed')), 0)               AS total_cost,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
        ) FILTER (WHERE status IN ('resolved','closed'))::NUMERIC, 1)      AS avg_resolution_hours,
        COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)                 AS complaints_today
      FROM complaints
    `);
    res.json(r.rows[0]);
  } catch (e) {
    console.error('[GET /analytics/summary]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/analytics/by-date ────────────────────────────────────────
// Query params: from, to, group_by (day|week|month)

router.get('/analytics/by-date', ...guard, async (req, res) => {
  const { from, to, group_by = 'day' } = req.query;
  const trunc = ['day','week','month'].includes(group_by) ? group_by : 'day';
  try {
    const r = await query(`
      SELECT
        DATE_TRUNC($1, created_at)                                          AS date,
        COUNT(*)                                                            AS count,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed'))             AS resolved_count
      FROM complaints
      WHERE ($2::TIMESTAMPTZ IS NULL OR created_at >= $2::TIMESTAMPTZ)
        AND ($3::TIMESTAMPTZ IS NULL OR created_at <= $3::TIMESTAMPTZ)
      GROUP BY 1
      ORDER BY 1
    `, [trunc, from || null, to || null]);
    res.json(r.rows);
  } catch (e) {
    console.error('[GET /analytics/by-date]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/analytics/by-category ────────────────────────────────────

router.get('/analytics/by-category', ...guard, async (req, res) => {
  try {
    const r = await query(`
      SELECT
        category_id,
        COUNT(*)                                                            AS count,
        COALESCE(SUM(cost_to_resolve), 0)                                  AS total_cost,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
        ) FILTER (WHERE status IN ('resolved','closed'))::NUMERIC, 1)      AS avg_resolution_hours
      FROM complaints
      GROUP BY category_id
      ORDER BY count DESC
    `);
    res.json(r.rows);
  } catch (e) {
    console.error('[GET /analytics/by-category]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/analytics/comparison ─────────────────────────────────────
// Query params: period_a_from, period_a_to, period_b_from, period_b_to

router.get('/analytics/comparison', ...guard, async (req, res) => {
  const { period_a_from, period_a_to, period_b_from, period_b_to } = req.query;
  try {
    const periodQuery = `
      SELECT
        COUNT(*)                                                            AS total,
        COUNT(*) FILTER (WHERE status IN ('resolved','closed'))             AS resolved,
        COALESCE(SUM(cost_to_resolve)
          FILTER (WHERE status IN ('resolved','closed')), 0)               AS total_cost,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (updated_at - created_at)) / 3600
        ) FILTER (WHERE status IN ('resolved','closed'))::NUMERIC, 1)      AS avg_resolution_hours
      FROM complaints
      WHERE created_at BETWEEN $1 AND $2
    `;
    const [a, b] = await Promise.all([
      query(periodQuery, [period_a_from, period_a_to]),
      query(periodQuery, [period_b_from, period_b_to]),
    ]);
    res.json({ period_a: a.rows[0], period_b: b.rows[0] });
  } catch (e) {
    console.error('[GET /analytics/comparison]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/complaints ────────────────────────────────────────────────
// Query params: status, category_id, assigned (true|false), from, to, limit, offset

router.get('/complaints', ...guard, async (req, res) => {
  const { status, category_id, assigned, from, to, limit = 50, offset = 0 } = req.query;
  try {
    const r = await query(`
      SELECT
        c.*,
        u.full_name  AS reporter_name,
        o.full_name  AS officer_name
      FROM   complaints c
      LEFT   JOIN users u ON c.user_id     = u.id
      LEFT   JOIN users o ON c.assigned_to = o.id
      WHERE  ($1::TEXT    IS NULL OR c.status      = $1)
        AND  ($2::TEXT    IS NULL OR c.category_id = $2)
        AND  ($3::BOOLEAN IS NULL OR (c.assigned_to IS NOT NULL) = $3)
        AND  ($4::TIMESTAMPTZ IS NULL OR c.created_at >= $4::TIMESTAMPTZ)
        AND  ($5::TIMESTAMPTZ IS NULL OR c.created_at <= $5::TIMESTAMPTZ)
      ORDER  BY c.created_at DESC
      LIMIT  $6 OFFSET $7
    `, [
      status || null,
      category_id || null,
      assigned === undefined ? null : assigned === 'true',
      from || null,
      to   || null,
      parseInt(limit,  10),
      parseInt(offset, 10),
    ]);
    const countR = await query(`
      SELECT COUNT(*) AS total FROM complaints c
      WHERE ($1::TEXT IS NULL OR c.status = $1)
        AND ($2::TEXT IS NULL OR c.category_id = $2)
        AND ($3::BOOLEAN IS NULL OR (c.assigned_to IS NOT NULL) = $3)
        AND ($4::TIMESTAMPTZ IS NULL OR c.created_at >= $4::TIMESTAMPTZ)
        AND ($5::TIMESTAMPTZ IS NULL OR c.created_at <= $5::TIMESTAMPTZ)
    `, [status||null, category_id||null, assigned===undefined?null:assigned==='true', from||null, to||null]);
    res.json({ complaints: r.rows, total: parseInt(countR.rows[0].total, 10) });
  } catch (e) {
    console.error('[GET /api/admin/complaints]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/officers ──────────────────────────────────────────────────

router.get('/officers', ...guard, async (req, res) => {
  try {
    const r = await query(`
      SELECT id, full_name, phone, created_at,
        (SELECT COUNT(*) FROM complaints WHERE assigned_to = users.id AND status = 'in_progress') AS active_tasks
      FROM   users
      WHERE  role = 'officer'
      ORDER  BY full_name ASC
    `);
    res.json({ officers: r.rows });
  } catch (e) {
    console.error('[GET /api/admin/officers]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET /api/admin/officers/locations ───────────────────────────────────────

router.get('/officers/locations', ...guard, async (req, res) => {
  try {
    const r = await query(`
      SELECT DISTINCT ON (ol.officer_id)
        ol.officer_id,
        ol.lat,
        ol.lng,
        ol.recorded_at,
        u.full_name,
        (
          SELECT title FROM complaints
          WHERE  assigned_to = ol.officer_id AND status = 'in_progress'
          LIMIT  1
        ) AS active_task
      FROM   officer_locations ol
      JOIN   users u ON ol.officer_id = u.id
      WHERE  ol.recorded_at > NOW() - INTERVAL '1 hour'
      ORDER  BY ol.officer_id, ol.recorded_at DESC
    `);
    res.json({ locations: r.rows });
  } catch (e) {
    console.error('[GET /api/admin/officers/locations]', e.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PATCH /api/admin/complaints/:id/assign ───────────────────────────────────

router.patch('/complaints/:id/assign',
  ...guard,
  [body('officer_id').isInt({ min: 1 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'officer_id required' });

    const complaintId = parseInt(req.params.id, 10);
    if (isNaN(complaintId)) return res.status(400).json({ error: 'Invalid complaint ID' });
    const { officer_id } = req.body;

    try {
      const officerRes = await query(
        `SELECT id, full_name, push_token FROM users WHERE id = $1 AND role = 'officer'`,
        [officer_id]
      );
      if (!officerRes.rows.length) return res.status(404).json({ error: 'Officer not found' });
      const officer = officerRes.rows[0];

      const compRes = await query('SELECT assigned_to, status, title FROM complaints WHERE id = $1', [complaintId]);
      if (!compRes.rows.length) return res.status(404).json({ error: 'Complaint not found' });
      const comp = compRes.rows[0];

      await query(
        `UPDATE complaints SET assigned_to = $1, status = 'in_progress', updated_at = NOW() WHERE id = $2`,
        [officer_id, complaintId]
      );
      await query(
        `INSERT INTO audit_logs (actor_id,action,entity,entity_id,old_value,new_value,ip_address)
         VALUES ($1,'assign','complaint',$2,$3,$4,$5)`,
        [req.user.sub, complaintId,
          JSON.stringify({ assigned_to: comp.assigned_to, status: comp.status }),
          JSON.stringify({ assigned_to: officer_id,       status: 'in_progress' }),
          req.ip]
      );

      if (officer.push_token) {
        await sendPushNotification(officer.push_token, 'New Task Assigned', comp.title, { complaint_id: complaintId });
      }

      res.json({ ok: true, complaint_id: complaintId, officer_id, officer_name: officer.full_name });
    } catch (e) {
      console.error('[PATCH /api/admin/complaints/:id/assign]', e.message);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

module.exports = router;
