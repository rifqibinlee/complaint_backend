/**
 * services/auditService.js
 *
 * Records sensitive actions to the audit_logs table.
 * Call this whenever a complaint status changes, a user is assigned, etc.
 *
 * Usage:
 *   await audit(req, 'complaint.status_changed', 'complaints', complaintId, {
 *     old_value: { status: 'open' },
 *     new_value: { status: 'in_progress' },
 *   });
 */

const db = require('../db');

async function audit(req, action, entity, entityId, { old_value, new_value } = {}) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, entity, entity_id, old_value, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.user?.sub ?? null,
        action,
        entity,
        String(entityId),
        old_value ? JSON.stringify(old_value) : null,
        new_value ? JSON.stringify(new_value) : null,
        req.ip ?? null,
      ]
    );
  } catch (e) {
    // Audit failures should never crash the main request
    console.error('[Audit] Failed to write log:', e.message);
  }
}

module.exports = { audit };
