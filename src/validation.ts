/**
 * Input Validation Module
 * Handles sanitization and validation of user inputs
 * @module validation
 */

import config from './config';

/**
 * Sanitize a string by trimming whitespace and limiting length
 */
export function sanitizeString(str: unknown, maxLength: number): string {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength);
}

/**
 * Validate and clamp auction duration to allowed range
 */
export function validateAuctionDuration(duration: unknown): number {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_AUCTION_DURATION) return config.MIN_AUCTION_DURATION;
  if (num > config.MAX_AUCTION_DURATION) return config.MAX_AUCTION_DURATION;
  return Math.floor(num);
}

/**
 * Validate and clamp countdown duration to allowed range
 */
export function validateCountdownDuration(duration: unknown): number {
  const num = Number(duration);
  if (isNaN(num) || num < config.MIN_COUNTDOWN_DURATION) return config.MIN_COUNTDOWN_DURATION;
  if (num > config.MAX_COUNTDOWN_DURATION) return config.MAX_COUNTDOWN_DURATION;
  return Math.floor(num);
}

/**
 * Validate socket ID format
 */
export function isValidSocketId(id: unknown): boolean {
  return typeof id === 'string' && id.length > 0 && id.length < 50;
}

/** Click timestamps by socket ID */
const clickTimestamps: Record<string, number[]> = {};

/**
 * Check if a socket is rate limited (too many clicks per second)
 */
export function isRateLimited(socketId: string): boolean {
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
 */
export function cleanupRateLimitData(socketId: string): void {
  delete clickTimestamps[socketId];
}

/**
 * Get click timestamps storage (for testing/debugging)
 */
export function getClickTimestamps(): Record<string, number[]> {
  return clickTimestamps;
}

