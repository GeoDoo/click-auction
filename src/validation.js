/**
 * Input Validation Module
 * Handles sanitization and validation of user inputs
 * @module validation
 */

const config = require('./config');

/**
 * Sanitize a string by trimming whitespace and limiting length
 * @param {string} str - The string to sanitize
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} The sanitized string
 */
function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/**
 * Validate and clamp auction duration to allowed range
 * @param {number|string} duration - Duration in seconds
 * @returns {number} Valid duration within MIN/MAX bounds
 */
function validateAuctionDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_AUCTION_DURATION) return config.MIN_AUCTION_DURATION;
  if (num > config.MAX_AUCTION_DURATION) return config.MAX_AUCTION_DURATION;
  return Math.floor(num);
}

/**
 * Validate and clamp countdown duration to allowed range
 * @param {number|string} duration - Duration in seconds
 * @returns {number} Valid duration within MIN/MAX bounds
 */
function validateCountdownDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_COUNTDOWN_DURATION) return config.MIN_COUNTDOWN_DURATION;
  if (num > config.MAX_COUNTDOWN_DURATION) return config.MAX_COUNTDOWN_DURATION;
  return Math.floor(num);
}

/**
 * Validate socket ID format
 * @param {string} id - Socket ID to validate
 * @returns {boolean} True if valid format
 */
function isValidSocketId(id) {
  return typeof id === 'string' && id.length > 0 && id.length < 50;
}

/** @type {Object<string, number[]>} Click timestamps by socket ID */
const clickTimestamps = {};

/**
 * Check if a socket is rate limited (too many clicks per second)
 * @param {string} socketId - The socket ID to check
 * @returns {boolean} True if rate limited, false if click allowed
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
 * Cleanup rate limit data for a disconnected socket
 * @param {string} socketId - Socket ID to cleanup
 */
function cleanupRateLimitData(socketId) {
  delete clickTimestamps[socketId];
}

/**
 * Get click timestamps storage (for testing/debugging)
 * @returns {Object<string, number[]>} Click timestamps by socket ID
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
