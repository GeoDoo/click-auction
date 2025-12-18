// ============================================
// INPUT VALIDATION
// ============================================

const config = require('./config');

/**
 * Sanitize a string - trim and limit length
 */
function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/**
 * Validate auction duration
 */
function validateAuctionDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_AUCTION_DURATION) return config.MIN_AUCTION_DURATION;
  if (num > config.MAX_AUCTION_DURATION) return config.MAX_AUCTION_DURATION;
  return Math.floor(num);
}

/**
 * Validate countdown duration
 */
function validateCountdownDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_COUNTDOWN_DURATION) return config.MIN_COUNTDOWN_DURATION;
  if (num > config.MAX_COUNTDOWN_DURATION) return config.MAX_COUNTDOWN_DURATION;
  return Math.floor(num);
}

/**
 * Validate socket ID format
 */
function isValidSocketId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 50;
}

// Rate limiting storage
const clickTimestamps = {}; // { socketId: [timestamp1, timestamp2, ...] }

/**
 * Check if a socket is rate limited
 */
function isRateLimited(socketId) {
  const now = Date.now();
  const oneSecondAgo = now - 1000;

  if (!clickTimestamps[socketId]) {
    clickTimestamps[socketId] = [];
  }

  // Remove timestamps older than 1 second
  clickTimestamps[socketId] = clickTimestamps[socketId].filter((ts) => ts > oneSecondAgo);

  // Check if rate limited
  if (clickTimestamps[socketId].length >= config.MAX_CLICKS_PER_SECOND) {
    return true;
  }

  // Record this click
  clickTimestamps[socketId].push(now);
  return false;
}

/**
 * Cleanup rate limit data for a socket
 */
function cleanupRateLimitData(socketId) {
  delete clickTimestamps[socketId];
}

/**
 * Get click timestamps (for testing)
 */
function getClickTimestamps() {
  return clickTimestamps;
}

module.exports = {
  sanitizeString,
  validateAuctionDuration,
  validateCountdownDuration,
  isValidSocketId,
  isRateLimited,
  cleanupRateLimitData,
  getClickTimestamps,
};

