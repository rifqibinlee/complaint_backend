/**
 * middleware/authenticate.js
 *
 * authenticate  — verifies the Bearer token on every protected route
 * requireRole   — gates a route to specific roles (call AFTER authenticate)
 *
 * Usage:
 *   const { authenticate, requireRole } = require('../middleware/authenticate');
 *
 *   // Any logged-in user:
 *   router.get('/complaints', authenticate, handler);
 *
 *   // Admins only:
 *   router.post('/assign', authenticate, requireRole('admin'), handler);
 *
 *   // Multiple roles:
 *   router.patch('/status', authenticate, requireRole('admin', 'officer'), handler);
 */

const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);

  try {
    req.user = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    });
    next();
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
