/**
 * Tests for middleware module
 */

import { Request, Response, NextFunction } from 'express';
import * as middleware from '../src/middleware';

// Mock Logger
jest.mock('../src/logger', () => ({
  __esModule: true,
  default: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Helper to create mock request
function createMockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    path: '/test',
    method: 'GET',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

describe('Middleware', () => {
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let setHeaderMock: jest.Mock;

  beforeEach(() => {
    setHeaderMock = jest.fn();
    mockRes = {
      setHeader: setHeaderMock,
      statusCode: 200,
      on: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('cacheControl', () => {
    it('sets no-cache for HTML files', () => {
      const req = createMockReq({ path: '/index.html' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-cache, must-revalidate');
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets no-cache for root path', () => {
      const req = createMockReq({ path: '/' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-cache, must-revalidate');
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets no-store for API endpoints', () => {
      const req = createMockReq({ path: '/api/config' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets no-store for health endpoint', () => {
      const req = createMockReq({ path: '/health' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(mockNext).toHaveBeenCalled();
    });

    it('sets public cache for static assets with default maxAge', () => {
      const req = createMockReq({ path: '/js/app.js' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'public, max-age=86400');
      expect(mockNext).toHaveBeenCalled();
    });

    it('respects custom maxAge option', () => {
      const req = createMockReq({ path: '/js/app.js' });
      const handler = middleware.cacheControl({ maxAge: 3600 });
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600');
    });

    it('adds immutable flag when specified', () => {
      const req = createMockReq({ path: '/js/app.js' });
      const handler = middleware.cacheControl({ maxAge: 3600, immutable: true });
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'public, max-age=3600, immutable');
    });

    it('sets no-store when noCache option is true', () => {
      const req = createMockReq({ path: '/js/app.js' });
      const handler = middleware.cacheControl({ noCache: true });
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('Cache-Control', 'no-store');
    });

    it('sets ETag header for cacheable assets', () => {
      const req = createMockReq({ path: '/js/app.js' });
      const handler = middleware.cacheControl();
      handler(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('ETag', expect.stringMatching(/^"\d+"$/));
    });
  });

  describe('requestLogger', () => {
    it('calls next immediately', () => {
      const req = createMockReq();
      const handler = middleware.requestLogger();
      handler(req, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('registers finish event listener', () => {
      const req = createMockReq();
      const handler = middleware.requestLogger();
      handler(req, mockRes as Response, mockNext);

      expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
    });
  });

  describe('errorHandler', () => {
    it('returns 500 for errors without status', () => {
      const req = createMockReq();
      const error = new Error('Test error');
      middleware.errorHandler(error, req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalled();
    });

    it('returns custom status when provided', () => {
      const req = createMockReq();
      const error = new Error('Not found') as Error & { status?: number };
      error.status = 404;
      middleware.errorHandler(error, req, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
    });

    it('hides error message in production', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const req = createMockReq();
      const error = new Error('Sensitive error');
      middleware.errorHandler(error, req, mockRes as Response, mockNext);

      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Internal server error' });

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('notFoundHandler', () => {
    it('returns 404 with path', () => {
      const req = createMockReq({ path: '/unknown' });
      middleware.notFoundHandler(req, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not found',
        path: '/unknown',
      });
    });
  });

  describe('wsSecurityHeaders', () => {
    it('sets security headers for websocket upgrade', () => {
      const req = createMockReq({ headers: { upgrade: 'websocket' } });
      middleware.wsSecurityHeaders(req, mockRes as Response, mockNext);

      expect(setHeaderMock).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
      expect(mockNext).toHaveBeenCalled();
    });

    it('does not set headers for non-websocket requests', () => {
      const req = createMockReq({ headers: {} });
      middleware.wsSecurityHeaders(req, mockRes as Response, mockNext);

      expect(setHeaderMock).not.toHaveBeenCalled();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});

