// ============================================
// PERSISTENT SCORES (survives server restarts)
// ============================================

const path = require('path');
const fs = require('fs');
const { Redis } = require('@upstash/redis');
const config = require('./config');
const Logger = require('./logger');

const SCORES_FILE = path.join(__dirname, '..', 'scores.json');

// Initialize Redis if credentials are provided
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  Logger.info('🔴 Redis connected (Upstash)');
} else {
  Logger.info('📁 Using local file storage (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for cloud persistence)');
}

// All-time stats structure: { "PlayerName": { wins, totalClicks, roundsPlayed, bestRound, lastPlayed } }
let allTimeStats = {};

/**
 * Load scores from storage
 */
async function loadScores() {
  try {
    if (redis) {
      Logger.info('🔍 Attempting to load scores from Redis...');
      const data = await redis.get(config.REDIS_KEY);
      Logger.info(`🔍 Redis returned: ${data ? 'data found' : 'null/empty'}, type: ${typeof data}`);
      if (data) {
        allTimeStats = typeof data === 'string' ? JSON.parse(data) : data;
        Logger.info(`📊 Loaded ${Object.keys(allTimeStats).length} player records from Redis`);
      } else {
        Logger.warn('⚠️ No data found in Redis (key may not exist yet)');
      }
    } else if (fs.existsSync(SCORES_FILE)) {
      const data = fs.readFileSync(SCORES_FILE, 'utf8');
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          allTimeStats = parsed;
          Logger.info(`📊 Loaded ${Object.keys(allTimeStats).length} player records from scores.json`);
        } else {
          throw new Error('Invalid scores format');
        }
      } catch {
        Logger.warn('⚠️ Corrupt scores.json detected, backing up and starting fresh');
        const backupPath = `${SCORES_FILE}.corrupt.${Date.now()}`;
        fs.renameSync(SCORES_FILE, backupPath);
        Logger.info(`📁 Corrupt file backed up to: ${backupPath}`);
        allTimeStats = {};
      }
    }
  } catch (err) {
    Logger.error('❌ CRITICAL: Error loading scores:', err.message);
    Logger.error('❌ Stack:', err.stack);
    allTimeStats = {};
  }
}

/**
 * Save scores to storage
 */
async function saveScores() {
  try {
    if (redis) {
      const recordCount = Object.keys(allTimeStats).length;
      // Safety check: don't overwrite data with empty object unless explicitly intended
      if (recordCount === 0) {
        Logger.warn('⚠️ Skipping save - allTimeStats is empty (prevents accidental data loss)');
        return;
      }
      const dataToSave = JSON.stringify(allTimeStats);
      Logger.info(`💾 Saving ${recordCount} player records to Redis...`);
      await redis.set(config.REDIS_KEY, dataToSave);
      Logger.info('💾 Scores saved to Redis successfully');
    } else {
      fs.writeFileSync(SCORES_FILE, JSON.stringify(allTimeStats, null, 2));
      Logger.debug('💾 Scores saved to scores.json');
    }
  } catch (err) {
    Logger.error('Error saving scores:', err);
  }
}

/**
 * Update stats for a player after a round
 */
function updatePlayerStats(name, clicks, isWinner) {
  if (!allTimeStats[name]) {
    allTimeStats[name] = {
      wins: 0,
      totalClicks: 0,
      roundsPlayed: 0,
      bestRound: 0,
      lastPlayed: null,
    };
  }

  allTimeStats[name].totalClicks += clicks;
  allTimeStats[name].roundsPlayed += 1;
  allTimeStats[name].bestRound = Math.max(allTimeStats[name].bestRound, clicks);
  allTimeStats[name].lastPlayed = new Date().toISOString();

  if (isWinner) {
    allTimeStats[name].wins += 1;
  }
}

/**
 * Get all-time leaderboard
 */
function getAllTimeLeaderboard() {
  return Object.entries(allTimeStats)
    .map(([name, stats]) => ({
      name,
      ...stats,
    }))
    .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
}

/**
 * Reset all stats (and force save)
 */
async function resetAllStats() {
  Logger.warn('🗑️ Resetting ALL stats (intentional)');
  allTimeStats = {};
  // Force save the empty state
  if (redis) {
    await redis.set(config.REDIS_KEY, JSON.stringify(allTimeStats));
    Logger.info('💾 Stats reset saved to Redis');
  }
}

/**
 * Get stats (for testing)
 */
function getStats() {
  return allTimeStats;
}

module.exports = {
  loadScores,
  saveScores,
  updatePlayerStats,
  getAllTimeLeaderboard,
  resetAllStats,
  getStats,
};

