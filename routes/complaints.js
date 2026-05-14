/**
 * routes/complaints.js
 *
 * GET    /api/complaints          — list (paginated, filtered)
 * GET    /api/complaints/:id      — single complaint detail
 * POST   /api/complaints          — submit a new complaint
 * PATCH  /api/complaints/:id/status — update status (admin/officer)
 */

const router   = require('express').Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const { body, validationResult } = require('express-validator');
const db       = require('../db');
const { authenticate, requireRole } = require('../middleware/authenticate');
const { audit } = require('../services/auditService');

// ─── File upload setup (local disk for now) ────────────────────────────────

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `complaint_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_FILE_SIZE_MB ?? '5', 10)) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext     = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG and WEBP images are allowed'));
    }
  },
});

// Default resolution costs (MYR) — matches the app's constants.js
const DEFAULT_COSTS = {
  'Pothole / Damaged Road':              1200,
  'Broken Streetlight':                   350,
  'Flooding / Poor Drainage':            2500,
  'Damaged Sidewalk / Blocked Walkway':   800,
  'Missed Garbage Collection':            150,
  'Illegal Dumping':                      500,
  'Overflowing Bins':                     100,
  'Dirty Streets / Litter':               200,
  'Water Supply Interruption':            600,
  'Dirty / Unsafe Water':                 900,
  'Sewer Backup':                        1500,
  'Flash Flood Warning':                 3000,
  'Illegal Construction':                 750,
  'Construction Noise':                   200,
  'Unsafe Building Practices':           1000,
  'Poor Urban Planning':                  400,
  'Broken Playground Equipment':          600,
  'Poor Park Maintenance':                300,
  'Public Toilet Conditions':             250,
  'Damaged Street Furniture':             400,
  'Noise Complaint':                      100,
  'Neighbour Dispute':                    150,
  'Anti-Social Behaviour':                200,
  'Illegal Parking / Blocked Driveway':   100,
  'Pest Infestation (Rats / Mosquitoes)': 700,
  'Unsanitary Conditions':                500,
  'Food Hygiene Complaint':               350,
};

// Non-location categories get simplified status flow
const NON_LOCATION_CATEGORIES = ['council', 'financial'];

function getInitialStatus(categoryId) {
  return NON_LOCATION_CATEGORIES.includes(categoryId) ? 'submitted' : 'open';
}

// ─── GET /api/complaints ───────────────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const limit    = Math.min(parseInt(req.query.limit ?? '20', 10), 500);
    const cursor   = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
    const isMapReq = req.query.map === '1';

    const params  = [];
    const clauses = [];
    let   i       = 1;

    // Pagination cursor
    if (cursor) {
      clauses.push(`c.id < $${i++}`);
      params.push(cursor);
    }

    // Filters
    if (req.query.category_id) {
      clauses.push(`c.category_id = $${i++}`);
      params.push(req.query.category_id);
    }
    if (req.query.status) {
      clauses.push(`c.status = $${i++}`);
      params.push(req.query.status);
    }
    if (req.query.date_from) {
      clauses.push(`c.created_at >= $${i++}`);
      params.push(new Date(req.query.date_from));
    }
    if (req.query.date_to) {
      clauses.push(`c.created_at <= $${i++}`);
      params.push(new Date(req.query.date_to));
    }

    // Public users: on the map they see all complaints, in list view they see only their own
    if (req.user.role === 'public' && !isMapReq) {
      clauses.push(`c.user_id = $${i++}`);
      params.push(req.user.sub);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    // Fetch one extra to know if there's a next page
    const result = await db.query(
      `SELECT
         c.id, c.title, c.category_id, c.subcategory, c.status,
         c.lat, c.lng, c.image_url, c.cost_to_resolve,
         c.submitted_at, c.created_at,
         u.full_name AS submitted_by
       FROM complaints c
       JOIN users u ON u.id = c.user_id
       ${where}
       ORDER BY c.id DESC
       LIMIT $${i}`,
      [...params, limit + 1]
    );

    const hasMore    = result.rows.length > limit;
    const complaints = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore
      ? String(complaints[complaints.length - 1].id)
      : null;

    res.json({ complaints, nextCursor, total: complaints.length });
  } catch (e) {
    console.error('[Complaints] GET / error:', e.message);
    res.status(500).json({ error: 'Failed to fetch complaints' });
  }
});

// ─── GET /api/complaints/:id ───────────────────────────────────────────────

router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, u.full_name AS submitted_by
       FROM complaints c
       JOIN users u ON u.id = c.user_id
       WHERE c.id = $1`,
      [req.params.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Complaint not found' });
    }

    const complaint = result.rows[0];

    // Public users can only see their own complaints in detail view
    if (req.user.role === 'public' && complaint.user_id !== req.user.sub) {
      return res.status(403).json({ error: 'Not authorised' });
    }

    res.json(complaint);
  } catch (e) {
    console.error('[Complaints] GET /:id error:', e.message);
    res.status(500).json({ error: 'Failed to fetch complaint' });
  }
});

// ─── POST /api/complaints ──────────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  upload.single('image'),
  [
    body('title')
      .trim()
      .isLength({ min: 5, max: 100 }).withMessage('Title must be 5–100 characters')
      .escape(),
    body('description')
      .trim()
      .isLength({ min: 10, max: 500 }).withMessage('Description must be 10–500 characters')
      .escape(),
    body('category_id')
      .trim()
      .notEmpty().withMessage('Category is required'),
    body('subcategory')
      .trim()
      .notEmpty().withMessage('Subcategory is required'),
    body('lat')
      .optional()
      .isFloat({ min: -90,  max: 90  }).withMessage('Invalid latitude'),
    body('lng')
      .optional()
      .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { title, description, category_id, subcategory, lat, lng } = req.body;
    const imageUrl   = req.file ? `/uploads/${req.file.filename}` : null;
    const status     = getInitialStatus(category_id);
    const cost       = DEFAULT_COSTS[subcategory] ?? null;

    try {
      const result = await db.query(
        `INSERT INTO complaints
           (user_id, title, description, category_id, subcategory, status, lat, lng, image_url, cost_to_resolve, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         RETURNING *`,
        [
          req.user.sub,
          title, description, category_id, subcategory,
          status,
          lat  ?? null,
          lng  ?? null,
          imageUrl,
          cost,
        ]
      );

      res.status(201).json(result.rows[0]);
    } catch (e) {
      console.error('[Complaints] POST error:', e.message);
      res.status(500).json({ error: 'Failed to submit complaint' });
    }
  }
);

// ─── PATCH /api/complaints/:id/status ─────────────────────────────────────

router.patch(
  '/:id/status',
  authenticate,
  requireRole('admin', 'officer'),
  [
    body('status').trim().notEmpty().withMessage('Status is required'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { status } = req.body;
    const id         = parseInt(req.params.id, 10);

    try {
      const existing = await db.query(
        'SELECT id, status, category_id FROM complaints WHERE id = $1',
        [id]
      );
      if (!existing.rows.length) {
        return res.status(404).json({ error: 'Complaint not found' });
      }

      const complaint = existing.rows[0];

      // Validate the status transition based on category type
      const isNonLocation = NON_LOCATION_CATEGORIES.includes(complaint.category_id);
      const validStatuses = isNonLocation
        ? ['submitted', 'received']
        : ['open', 'in_progress', 'resolved', 'closed'];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status "${status}" for this complaint type`,
        });
      }

      const result = await db.query(
        `UPDATE complaints
         SET status = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [status, id]
      );

      await audit(req, 'complaint.status_changed', 'complaints', id, {
        old_value: { status: complaint.status },
        new_value: { status },
      });

      res.json(result.rows[0]);
    } catch (e) {
      console.error('[Complaints] PATCH /:id/status error:', e.message);
      res.status(500).json({ error: 'Failed to update status' });
    }
  }
);

module.exports = router;
