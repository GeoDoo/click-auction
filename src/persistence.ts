// ============================================
// PERSISTENT SCORES (survives server restarts)
// ============================================

import path from 'path';
import fs from 'fs';
import { Redis } from '@upstash/redis';
import config from './config';
import Logger from './logger';

const SCORES_FILE = path.join(__dirname, '..', 'scores.json');

export interface PlayerStats {
  wins: number;
  totalClicks: number;
  roundsPlayed: number;
  bestRound: number;
  lastPlayed: string | null;
  // New cumulative fields for tournament mode
  totalAuctionTaps: number;
  bestReactionTime: number | null; // Best (fastest) reaction time ever
  totalFinalScore: number; // Cumulative final score after multipliers
}

export interface LeaderboardEntry extends PlayerStats {
  name: string;
}

// Initialize Redis if credentials are provided
let redis: Redis | null = null;
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
let allTimeStats: Record<string, PlayerStats> = {};

// Cached leaderboard (only recalculated when stats change)
let cachedLeaderboard: LeaderboardEntry[] = [];
let leaderboardDirty = true;

/**
 * Load scores from storage
 */
export async function loadScores(): Promise<void> {
  try {
    if (redis) {
      Logger.info('🔍 Attempting to load scores from Redis...');
      const data = await redis.get<string | Record<string, PlayerStats>>(config.REDIS_KEY);
      Logger.info(`🔍 Redis returned: ${data ? 'data found' : 'null/empty'}, type: ${typeof data}`);
      if (data) {
        allTimeStats = typeof data === 'string' ? JSON.parse(data) : data;
        leaderboardDirty = true;
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
          leaderboardDirty = true;
          Logger.info(`📊 Loaded ${Object.keys(allTimeStats).length} player records from scores.json`);
        } else {
          throw new Error('Invalid scores format');
        }
      } catch (parseErr) {
        Logger.warn('⚠️ Corrupt scores.json detected, backing up and starting fresh:', (parseErr as Error).message);
        const backupPath = `${SCORES_FILE}.corrupt.${Date.now()}`;
        fs.renameSync(SCORES_FILE, backupPath);
        Logger.info(`📁 Corrupt file backed up to: ${backupPath}`);
        allTimeStats = {};
      }
    }
  } catch (err) {
    const error = err as Error;
    Logger.error('❌ CRITICAL: Error loading scores:', error.message);
    Logger.error('❌ Stack:', error.stack || '');
    allTimeStats = {};
  }
}

/**
 * Save scores to storage
 */
export async function saveScores(): Promise<void> {
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
export function updatePlayerStats(
  name: string,
  auctionTaps: number,
  reactionTime: number | null,
  finalScore: number,
  isWinner: boolean
): void {
  if (!allTimeStats[name]) {
    allTimeStats[name] = {
      wins: 0,
      totalClicks: 0,
      roundsPlayed: 0,
      bestRound: 0,
      lastPlayed: null,
      totalAuctionTaps: 0,
      bestReactionTime: null,
      totalFinalScore: 0,
    };
  }

  // Legacy fields (keep for backwards compatibility)
  allTimeStats[name].totalClicks += finalScore;
  allTimeStats[name].roundsPlayed += 1;
  allTimeStats[name].bestRound = Math.max(allTimeStats[name].bestRound, finalScore);
  allTimeStats[name].lastPlayed = new Date().toISOString();

  // New cumulative fields
  allTimeStats[name].totalAuctionTaps += auctionTaps;
  allTimeStats[name].totalFinalScore += finalScore;
  
  // Best reaction time (lower is better, so we want the minimum)
  if (reactionTime !== null) {
    if (allTimeStats[name].bestReactionTime === null) {
      allTimeStats[name].bestReactionTime = reactionTime;
    } else {
      allTimeStats[name].bestReactionTime = Math.min(
        allTimeStats[name].bestReactionTime,
        reactionTime
      );
    }
  }

  if (isWinner) {
    allTimeStats[name].wins += 1;
  }
  
  // Mark leaderboard cache as dirty
  leaderboardDirty = true;
}

/**
 * Get all-time leaderboard (cached for performance)
 */
export function getAllTimeLeaderboard(): LeaderboardEntry[] {
  if (leaderboardDirty || cachedLeaderboard.length === 0) {
    cachedLeaderboard = Object.entries(allTimeStats)
      .map(([name, stats]) => ({
        name,
        ...stats,
      }))
      .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
    leaderboardDirty = false;
  }
  return cachedLeaderboard;
}

/**
 * Reset all stats (and force save)
 */
export async function resetAllStats(): Promise<void> {
  Logger.warn('🗑️ Resetting ALL stats (intentional)');
  allTimeStats = {};
  cachedLeaderboard = [];
  leaderboardDirty = true;
  // Force save the empty state
  if (redis) {
    await redis.set(config.REDIS_KEY, JSON.stringify(allTimeStats));
    Logger.info('💾 Stats reset saved to Redis');
  }
}

/**
 * Get stats (for testing)
 */
export function getStats(): Record<string, PlayerStats> {
  return allTimeStats;
}

