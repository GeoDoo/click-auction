// ============================================
// HOST AUTHENTICATION (PIN Protection)
// ============================================

import crypto from 'crypto';
import config from './config';

interface TokenData {
  createdAt: number;
  expiresAt: number;
}

interface VerifyResult {
  success: boolean;
  token: string | null;
  message: string;
}

const hostAuthTokens: Record<string, TokenData> = {};

/**
 * Generate a unique host auth token
 */
export function generateHostAuthToken(): string {
  return 'host_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
}

/**
 * Create a new host auth token
 */
export function createHostAuthToken(): string {
  const token = generateHostAuthToken();
  const now = Date.now();
  hostAuthTokens[token] = {
    createdAt: now,
    expiresAt: now + config.HOST_AUTH_EXPIRY_MS,
  };
  return token;
}

/**
 * Check if a host auth token is valid
 */
export function isValidHostAuthToken(token: string | null | undefined): boolean {
  if (!token || !hostAuthTokens[token]) return false;
  if (Date.now() > hostAuthTokens[token].expiresAt) {
    delete hostAuthTokens[token];
    return false;
  }
  return true;
}

/**
 * Cleanup expired host tokens
 */
export function cleanupExpiredHostTokens(): void {
  const now = Date.now();
  for (const [token, data] of Object.entries(hostAuthTokens)) {
    if (now > data.expiresAt) {
      delete hostAuthTokens[token];
    }
  }
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time even for length mismatch
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Verify PIN and create token if valid
 */
export function verifyPinAndCreateToken(pin: string | null | undefined): VerifyResult {
  if (!config.HOST_PIN) {
    return { success: true, token: null, message: 'No PIN required' };
  }

  if (!pin || !safeCompare(pin, config.HOST_PIN)) {
    return { success: false, token: null, message: 'Invalid PIN' };
  }

  const token = createHostAuthToken();
  return { success: true, token, message: 'Authenticated' };
}

/**
 * Get all tokens (for testing)
 */
export function getAllTokens(): Record<string, TokenData> {
  return hostAuthTokens;
}


