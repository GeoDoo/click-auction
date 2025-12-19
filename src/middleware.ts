/**
 * Custom Express middleware
 * @module middleware
 */

import { Request, Response, NextFunction } from 'express';
import Logger from './logger';

interface CacheControlOptions {
  maxAge?: number;
  immutable?: boolean;
  noCache?: boolean;
}

interface CustomError extends Error {
  status?: number;
}

/**
 * Add caching headers to static assets
 */
export function cacheControl(options: CacheControlOptions = {}) {
  const {
    maxAge = 86400, // 1 day default
    immutable = false,
    noCache = false,
  } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
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
 */
export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction): void => {
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
 */
export function errorHandler(
  err: CustomError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
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
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
}

/**
 * Security headers for WebSocket upgrade
 */
export function wsSecurityHeaders(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Additional headers for WebSocket connections
  if (req.headers.upgrade === 'websocket') {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
}


