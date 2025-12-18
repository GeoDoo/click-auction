/**
 * Custom Express middleware
 * @module middleware
 */

// config can be used for future middleware options

/**
 * Add caching headers to static assets
 * @param {Object} options
 * @returns {Function} Express middleware
 */
function cacheControl(options = {}) {
  const {
    maxAge = 86400, // 1 day default
    immutable = false,
    noCache = false,
  } = options;

  return (req, res, next) => {
    // Skip for HTML files (should not be cached aggressively)
    if (req.path.endsWith('.html') || req.path === '/') {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      return next();
    }

    // Skip for API endpoints
    if (req.path.startsWith('/api/') || req.path === '/health') {
      res.setHeader('Cache-Control', 'no-store');
      return next();
    }

    if (noCache) {
      res.setHeader('Cache-Control', 'no-store');
    } else {
      const cacheHeader = immutable
        ? `public, max-age=${maxAge}, immutable`
        : `public, max-age=${maxAge}`;
      res.setHeader('Cache-Control', cacheHeader);
    }

    // Add ETag support
    res.setHeader('ETag', `"${Date.now()}"`);

    next();
  };
}

/**
 * Request logging middleware
 * @returns {Function} Express middleware
 */
function requestLogger() {
  const Logger = require('./logger');

  return (req, res, next) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - start;
      const message = `${req.method} ${req.path} ${res.statusCode} ${duration}ms`;

      if (res.statusCode >= 500) {
        Logger.error(message);
      } else if (res.statusCode >= 400) {
        Logger.warn(message);
      } else {
        Logger.debug(message);
      }
    });

    next();
  };
}

/**
 * Error handling middleware
 * @param {Error} err
 * @param {Object} req
 * @param {Object} res
 * @param {Function} _next
 */
function errorHandler(err, req, res, _next) {
  const Logger = require('./logger');

  Logger.error(`Express error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
}

/**
 * 404 handler
 * @param {Object} req
 * @param {Object} res
 */
function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
}

/**
 * Security headers for WebSocket upgrade
 * @param {Object} req
 * @param {Object} res
 * @param {Function} next
 */
function wsSecurityHeaders(req, res, next) {
  // Additional headers for WebSocket connections
  if (req.headers.upgrade === 'websocket') {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
}

module.exports = {
  cacheControl,
  requestLogger,
  errorHandler,
  notFoundHandler,
  wsSecurityHeaders,
};

