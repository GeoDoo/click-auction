// ============================================
// HOST AUTHENTICATION (PIN Protection)
// ============================================

const crypto = require('crypto');
const config = require('./config');

const hostAuthTokens = {}; // { token: { createdAt, expiresAt } }

/**
 * Generate a unique host auth token
 */
function generateHostAuthToken() {
  return 'host_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
}

/**
 * Create a new host auth token
 */
function createHostAuthToken() {
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
function isValidHostAuthToken(token) {
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
function cleanupExpiredHostTokens() {
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
function safeCompare(a, b) {
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
function verifyPinAndCreateToken(pin) {
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
function getAllTokens() {
  return hostAuthTokens;
}

module.exports = {
  generateHostAuthToken,
  createHostAuthToken,
  isValidHostAuthToken,
  cleanupExpiredHostTokens,
  verifyPinAndCreateToken,
  getAllTokens,
};

