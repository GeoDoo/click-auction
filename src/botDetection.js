// ============================================
// BOT DETECTION (Statistical Outlier Flagging)
// ============================================
// Bots click at very consistent intervals (low variance)
// Humans have natural variance in their click timing

const config = require('./config');

const clickIntervals = {}; // { socketId: [interval1, interval2, ...] }
const lastClickTime = {}; // { socketId: timestamp }

/**
 * Record a click interval for analysis
 */
function recordClickInterval(socketId) {
  const now = Date.now();

  if (lastClickTime[socketId]) {
    const interval = now - lastClickTime[socketId];

    if (!clickIntervals[socketId]) {
      clickIntervals[socketId] = [];
    }

    // Keep last 50 intervals for analysis
    clickIntervals[socketId].push(interval);
    if (clickIntervals[socketId].length > 50) {
      clickIntervals[socketId].shift();
    }
  }

  lastClickTime[socketId] = now;
}

/**
 * Calculate coefficient of variation
 */
function calculateCV(intervals) {
  if (intervals.length < config.MIN_CLICKS_FOR_ANALYSIS) {
    return null;
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return null;

  const squaredDiffs = intervals.map((x) => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);

  return stdDev / mean;
}

/**
 * Check if a player's click pattern is suspicious
 */
function isSuspiciousClicker(socketId) {
  const intervals = clickIntervals[socketId];
  if (!intervals || intervals.length < config.MIN_CLICKS_FOR_ANALYSIS) {
    return { suspicious: false, reason: null, cv: null };
  }

  const cv = calculateCV(intervals);
  if (cv === null) {
    return { suspicious: false, reason: null, cv: null };
  }

  if (cv < config.MIN_HUMAN_CV) {
    return {
      suspicious: true,
      reason: `Click timing too consistent (CV: ${(cv * 100).toFixed(1)}%)`,
      cv: cv,
    };
  }

  return { suspicious: false, reason: null, cv: cv };
}

/**
 * Reset bot detection data for a socket
 */
function resetBotDetectionData(socketId) {
  delete clickIntervals[socketId];
  delete lastClickTime[socketId];
}

/**
 * Cleanup bot detection data for inactive sockets
 */
function cleanupBotDetectionData(activeSocketIds) {
  let cleaned = 0;

  for (const socketId of Object.keys(clickIntervals)) {
    if (!activeSocketIds.has(socketId)) {
      delete clickIntervals[socketId];
      cleaned++;
    }
  }

  for (const socketId of Object.keys(lastClickTime)) {
    if (!activeSocketIds.has(socketId)) {
      delete lastClickTime[socketId];
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Get all data (for testing)
 */
function getAllData() {
  return { clickIntervals, lastClickTime };
}

module.exports = {
  recordClickInterval,
  calculateCV,
  isSuspiciousClicker,
  resetBotDetectionData,
  cleanupBotDetectionData,
  getAllData,
};

