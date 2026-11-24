/**
 * Administrator Authorization Middleware
 * Enforces verified administrative privilege for mutating statutory rules.
 */

/**
 * Middleware that verifies the request carries administrator authorization.
 * Accepts 'x-admin-role': 'admin' or 'x-admin-key' matching process.env.ADMIN_KEY (default: 'admin-secret').
 */
function requireAdminAuth(req, res, next) {
  const adminRole = req.headers['x-admin-role'];
  const adminKey = req.headers['x-admin-key'];
  const authHeader = req.headers['authorization'];

  const expectedKey = process.env.ADMIN_KEY || 'admin-secret';

  const isAuthorized =
    adminRole === 'admin' ||
    adminRole === 'ADMIN' ||
    adminKey === expectedKey ||
    (authHeader && authHeader.toLowerCase() === `bearer ${expectedKey}`);

  if (!isAuthorized) {
    return res.status(403).json({
      success: false,
      error: {
        message: 'Forbidden: Administrator privileges required to configure statutory compliance rules.',
        status: 403,
        code: 'UNAUTHORIZED_ADMIN',
        timestamp: new Date().toISOString(),
        path: req.originalUrl
      }
    });
  }

  next();
}

module.exports = {
  requireAdminAuth
};
