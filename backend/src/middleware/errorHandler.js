/**
 * Centralized Error Handling Middleware
 * Provides consistent error payloads across all backend APIs.
 */

const env = require('../config/env');

/**
 * 404 Not Found Middleware
 */
function notFoundHandler(req, res, next) {
  const error = new Error(`Resource not found: ${req.method} ${req.originalUrl}`);
  error.status = 404;
  error.code = 'NOT_FOUND';
  next(error);
}

/**
 * Global Error Handler Middleware
 */
function globalErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  const message = err.message || 'An unexpected internal server error occurred.';

  const response = {
    success: false,
    error: {
      message,
      status,
      code,
      details: err.details || null,
      timestamp: new Date().toISOString(),
      path: req.originalUrl
    }
  };

  // Include stack trace only in development
  if (env.NODE_ENV === 'development' && status === 500) {
    response.error.stack = err.stack;
  }

  res.status(status).json(response);
}

module.exports = {
  notFoundHandler,
  globalErrorHandler
};
