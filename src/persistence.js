// ============================================
// PERSISTENT SCORES (survives server restarts)
// ============================================

const path = require('path');
const fs = require('fs');
const { Redis } = require('@upstash/redis');
const config = require('./config');

const SCORES_FILE = path.join(__dirname, '..', 'scores.json');

// Initialize Redis if credentials are provided
let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
  redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
  console.log('🔴 Redis connected (Upstash)');
} else {
  console.log('📁 Using local file storage (set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for cloud persistence)');
}

// All-time stats structure: { "PlayerName": { wins, totalClicks, roundsPlayed, bestRound, lastPlayed } }
let allTimeStats = {};

/**
 * Load scores from storage
 */
async function loadScores() {
  try {
    if (redis) {
      const data = await redis.get(config.REDIS_KEY);
      if (data) {
        allTimeStats = typeof data === 'string' ? JSON.parse(data) : data;
        console.log(`📊 Loaded ${Object.keys(allTimeStats).length} player records from Redis`);
      }
    } else if (fs.existsSync(SCORES_FILE)) {
      const data = fs.readFileSync(SCORES_FILE, 'utf8');
      try {
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          allTimeStats = parsed;
          console.log(`📊 Loaded ${Object.keys(allTimeStats).length} player records from scores.json`);
        } else {
          throw new Error('Invalid scores format');
        }
      } catch {
        console.error('⚠️ Corrupt scores.json detected, backing up and starting fresh');
        const backupPath = `${SCORES_FILE}.corrupt.${Date.now()}`;
        fs.renameSync(SCORES_FILE, backupPath);
        console.log(`📁 Corrupt file backed up to: ${backupPath}`);
        allTimeStats = {};
      }
    }
  } catch (err) {
    console.error('Error loading scores:', err);
    allTimeStats = {};
  }
}

/**
 * Save scores to storage
 */
async function saveScores() {
  try {
    if (redis) {
      await redis.set(config.REDIS_KEY, JSON.stringify(allTimeStats));
      console.log('💾 Scores saved to Redis');
    } else {
      fs.writeFileSync(SCORES_FILE, JSON.stringify(allTimeStats, null, 2));
      console.log('💾 Scores saved to scores.json');
    }
  } catch (err) {
    console.error('Error saving scores:', err);
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
 * Reset all stats
 */
function resetAllStats() {
  allTimeStats = {};
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

