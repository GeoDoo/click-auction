import { Server } from 'socket.io';
import config from './config';
import * as botDetection from './botDetection';
import * as persistence from './persistence';
import Logger from './logger';
import { GameState, LeaderboardEntry, Player } from './types';
import { broadcastToHosts } from './socket';

// Game state
export const gameState: GameState = {
  status: 'waiting',
  players: {},
  auctionDuration: 10,
  countdownDuration: 3,
  timeRemaining: 0,
  winner: null,
  winnerAd: null,
  round: 0,
  finalLeaderboard: [],
  auctionScores: {},
  fastestFingerStartTime: null,
  fastestFingerCountdownDuration: 3,
};

// Intervals
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let auctionInterval: ReturnType<typeof setInterval> | null = null;
let fastestFingerCountdownInterval: ReturnType<typeof setInterval> | null = null;
let fastestFingerTapTimeout: ReturnType<typeof setTimeout> | null = null;
let colorIndex = 0;

// Socket.io instance (set by server.ts)
let io: Server;

export function setIO(ioInstance: Server): void {
  io = ioInstance;
}

export function clearAllIntervals(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (auctionInterval) {
    clearInterval(auctionInterval);
    auctionInterval = null;
  }
  if (fastestFingerCountdownInterval) {
    clearInterval(fastestFingerCountdownInterval);
    fastestFingerCountdownInterval = null;
  }
  if (fastestFingerTapTimeout) {
    clearTimeout(fastestFingerTapTimeout);
    fastestFingerTapTimeout = null;
  }
}

export function getNextColor(): string {
  const color = config.DSP_COLORS[colorIndex % config.DSP_COLORS.length];
  colorIndex++;
  return color;
}

export function resetGame(): void {
  const connectedSockets = new Set([...io.sockets.sockets.keys()]);
  Object.keys(gameState.players).forEach((id) => {
    if (!connectedSockets.has(id)) {
      delete gameState.players[id];
    } else {
      gameState.players[id].clicks = 0;
      gameState.players[id].suspicious = false;
      gameState.players[id].suspicionReason = null;
      gameState.players[id].reactionTime = null;
      botDetection.resetBotDetectionData(id);
    }
  });
  gameState.status = 'waiting';
  gameState.winner = null;
  gameState.winnerAd = null;
  gameState.timeRemaining = 0;
  gameState.finalLeaderboard = [];
  gameState.auctionScores = {};
  gameState.fastestFingerStartTime = null;
}

export function getLeaderboard(): LeaderboardEntry[] {
  return Object.entries(gameState.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      clicks: player.clicks,
      color: player.color,
      suspicious: player.suspicious || false,
      reactionTime: player.reactionTime ?? null,
      finalScore: player.clicks, // Default to clicks, updated after Fastest Finger
    }))
    .sort((a, b) => b.clicks - a.clicks);
}

export function calculateFinalScores(): LeaderboardEntry[] {
  const entries = Object.entries(gameState.players).map(([id, player]) => ({
    id,
    name: player.name,
    clicks: player.clicks,
    color: player.color,
    suspicious: player.suspicious || false,
    reactionTime: player.reactionTime ?? null,
    auctionScore: gameState.auctionScores[id] || player.clicks,
  }));

  // Sort by reaction time (fastest first, null/no-tap last)
  const sortedByReaction = [...entries].sort((a, b) => {
    if (a.reactionTime === null) return 1;
    if (b.reactionTime === null) return -1;
    return a.reactionTime - b.reactionTime;
  });

  // Apply multipliers based on reaction time ranking
  const withMultipliers = sortedByReaction.map((entry, index) => {
    const multiplier = entry.reactionTime !== null
      ? (config.FASTEST_FINGER_MULTIPLIERS[index] || 1.0)
      : 1.0; // No multiplier if didn't tap
    
    return {
      ...entry,
      finalScore: Math.round(entry.auctionScore * multiplier),
    };
  });

  // Sort by final score (highest first) for winner determination
  return withMultipliers.sort((a, b) => b.finalScore - a.finalScore);
}

// Cache all-time leaderboard to avoid recalculating on every broadcast
let cachedAllTimeLeaderboard: persistence.LeaderboardEntry[] = [];
let allTimeLeaderboardLastUpdated = 0;
const ALL_TIME_LEADERBOARD_CACHE_MS = 5000; // Only refresh every 5 seconds

function getCachedAllTimeLeaderboard(): persistence.LeaderboardEntry[] {
  const now = Date.now();
  if (now - allTimeLeaderboardLastUpdated > ALL_TIME_LEADERBOARD_CACHE_MS) {
    cachedAllTimeLeaderboard = persistence.getAllTimeLeaderboard().slice(0, 20);
    allTimeLeaderboardLastUpdated = now;
  }
  return cachedAllTimeLeaderboard;
}

export function broadcastState(): void {
  const fullLeaderboard = gameState.status === 'finished' && gameState.finalLeaderboard.length > 0
    ? gameState.finalLeaderboard
    : getLeaderboard();

  // OPTIMIZATION: Only send top 10 in the leaderboard to reduce payload size
  // Display page shows top 10, players see their own rank via personal state
  const slimLeaderboard = fullLeaderboard.slice(0, 10);
  
  const playerCount = Object.keys(gameState.players).length;

  // Base state (always sent)
  const baseState = {
    status: gameState.status,
    timeRemaining: gameState.timeRemaining,
    leaderboard: slimLeaderboard,
    winner: gameState.winner,
    winnerAd: gameState.winnerAd,
    round: gameState.round,
    playerCount: playerCount,
  };

  // Only include expensive data when needed
  const isActiveGame = ['auction_countdown', 'auction', 'fastestFinger_countdown', 'fastestFinger_tap'].includes(gameState.status);
  
  if (isActiveGame) {
    // During active game, include all data
    io.emit('gameState', {
      ...baseState,
      allTimeLeaderboard: getCachedAllTimeLeaderboard(),
      auctionScores: gameState.auctionScores,
      fastestFingerStartTime: gameState.fastestFingerStartTime,
    });
  } else {
    // When idle (waiting/finished), send minimal payload
    io.emit('gameState', {
      ...baseState,
      allTimeLeaderboard: getCachedAllTimeLeaderboard(),
      auctionScores: {},
      fastestFingerStartTime: null,
    });
  }
}

export function addPlayer(socketId: string, playerData: Player): void {
  gameState.players[socketId] = playerData;
}

export function removePlayer(socketId: string): void {
  delete gameState.players[socketId];
}

export function getPlayer(socketId: string): Player | undefined {
  return gameState.players[socketId];
}

export function startClickAuction(): void {
  gameState.status = 'auction';
  gameState.timeRemaining = gameState.auctionDuration;

  const playerCount = Object.keys(gameState.players).length;
  Logger.info(`🎯 CLICK AUCTION STARTED | Round ${gameState.round} | ${playerCount} players | ${gameState.auctionDuration}s duration`);
  broadcastToHosts('auction_start', `🎯 CLICK AUCTION STARTED | ${playerCount} players | ${gameState.auctionDuration}s`, 'game');

  broadcastState();

  auctionInterval = setInterval(() => {
    gameState.timeRemaining--;
    
    // Log live stats every second
    const totalClicks = Object.values(gameState.players).reduce((sum, p) => sum + p.clicks, 0);
    const topPlayer = Object.values(gameState.players).sort((a, b) => b.clicks - a.clicks)[0];
    Logger.info(`⏱️  ${gameState.timeRemaining}s remaining | Total clicks: ${totalClicks} | Leader: ${topPlayer?.name || 'N/A'} (${topPlayer?.clicks || 0})`);
    
    broadcastState();

    if (gameState.timeRemaining <= 0) {
      if (auctionInterval) {
        clearInterval(auctionInterval);
        auctionInterval = null;
      }
      endClickAuction();
    }
  }, config.TICK_INTERVAL_MS);
}

export function endClickAuction(): void {
  // Preserve Click Auction scores
  gameState.auctionScores = {};
  Object.entries(gameState.players).forEach(([id, player]) => {
    gameState.auctionScores[id] = player.clicks;
    // Reset reaction time for Fastest Finger
    player.reactionTime = null;
  });

  const totalClicks = Object.values(gameState.auctionScores).reduce((sum, c) => sum + c, 0);
  const sortedPlayers = Object.values(gameState.players)
    .map((p) => ({ name: p.name, clicks: p.clicks }))
    .sort((a, b) => b.clicks - a.clicks);
  
  Logger.info(`🏁 CLICK AUCTION ENDED | Total: ${totalClicks} clicks`);
  Logger.info(`📊 TOP 5: ${sortedPlayers.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} (${p.clicks})`).join(' | ')}`);
  broadcastToHosts('auction_end', `🏁 AUCTION ENDED | ${totalClicks} clicks`, 'game');
  broadcastToHosts('auction_top5', `📊 TOP 5: ${sortedPlayers.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} (${p.clicks})`).join(' | ')}`, 'game');

  // Start Fastest Finger countdown
  gameState.status = 'fastestFinger_countdown';
  gameState.timeRemaining = gameState.fastestFingerCountdownDuration;

  Logger.info(`⚡ FASTEST FINGER starting in ${gameState.fastestFingerCountdownDuration}s...`);

  broadcastState();

  fastestFingerCountdownInterval = setInterval(() => {
    gameState.timeRemaining--;
    broadcastState();

    if (gameState.timeRemaining <= 0) {
      if (fastestFingerCountdownInterval) {
        clearInterval(fastestFingerCountdownInterval);
        fastestFingerCountdownInterval = null;
      }
      startFastestFingerTap();
    }
  }, config.TICK_INTERVAL_MS);
}

export function startFastestFingerTap(): void {
  gameState.status = 'fastestFinger_tap';
  gameState.fastestFingerStartTime = Date.now();

  const playerCount = Object.keys(gameState.players).length;
  Logger.info(`⚡ FASTEST FINGER TAP! | ${playerCount} players racing...`);

  broadcastState();

  // Set timeout for Fastest Finger (players have limited time to tap)
  fastestFingerTapTimeout = setTimeout(() => {
    endFastestFinger();
  }, config.FASTEST_FINGER_TAP_TIMEOUT_MS);
}

export function recordReactionTime(socketId: string): boolean {
  // Only record if player hasn't already tapped
  if (gameState.status !== 'fastestFinger_tap') return false;
  if (!gameState.players[socketId]) return false;
  if (gameState.players[socketId].reactionTime !== null && gameState.players[socketId].reactionTime !== undefined) {
    return false; // Already recorded
  }

  const reactionTime = Date.now() - (gameState.fastestFingerStartTime || Date.now());
  gameState.players[socketId].reactionTime = reactionTime;

  // Check if all players have tapped
  const allTapped = Object.values(gameState.players).every(
    (player) => player.reactionTime !== null && player.reactionTime !== undefined
  );

  if (allTapped) {
    if (fastestFingerTapTimeout) {
      clearTimeout(fastestFingerTapTimeout);
      fastestFingerTapTimeout = null;
    }
    endFastestFinger();
  }

  return true;
}

export function endFastestFinger(): void {
  if (fastestFingerTapTimeout) {
    clearTimeout(fastestFingerTapTimeout);
    fastestFingerTapTimeout = null;
  }

  gameState.status = 'finished';

  // Calculate final scores with Fastest Finger multipliers
  const leaderboard = calculateFinalScores();
  gameState.finalLeaderboard = leaderboard;

  // Log fastest finger results
  const tappedPlayers = leaderboard.filter(p => p.reactionTime !== null).sort((a, b) => (a.reactionTime || 0) - (b.reactionTime || 0));
  const didntTap = leaderboard.filter(p => p.reactionTime === null).length;
  
  Logger.info(`⚡ FASTEST FINGER RESULTS:`);
  if (tappedPlayers.length > 0) {
    Logger.info(`   🥇 Fastest: ${tappedPlayers[0].name} (${tappedPlayers[0].reactionTime}ms)`);
    if (tappedPlayers.length > 1) Logger.info(`   🥈 2nd: ${tappedPlayers[1].name} (${tappedPlayers[1].reactionTime}ms)`);
    if (tappedPlayers.length > 2) Logger.info(`   🥉 3rd: ${tappedPlayers[2].name} (${tappedPlayers[2].reactionTime}ms)`);
    
    // Broadcast fastest finger top 3 to host
    let ffResults = `⚡ FASTEST FINGER: 🥇 ${tappedPlayers[0].name} (${tappedPlayers[0].reactionTime}ms)`;
    if (tappedPlayers.length > 1) ffResults += ` | 🥈 ${tappedPlayers[1].name} (${tappedPlayers[1].reactionTime}ms)`;
    if (tappedPlayers.length > 2) ffResults += ` | 🥉 ${tappedPlayers[2].name} (${tappedPlayers[2].reactionTime}ms)`;
    broadcastToHosts('fastest_finger', ffResults, 'game');
  }
  if (didntTap > 0) Logger.info(`   ❌ ${didntTap} player(s) didn't tap`);

  let winnerName: string | null = null;
  if (leaderboard.length > 0 && leaderboard[0].finalScore > 0) {
    const winnerId = leaderboard[0].id;
    gameState.winner = {
      ...gameState.players[winnerId],
      id: winnerId,
    };
    gameState.winnerAd = gameState.players[winnerId].adContent;
    winnerName = gameState.winner.name;
  }

  // Log final results
  Logger.info(`🏆 ═══════════════════════════════════════════════════════════`);
  Logger.info(`🏆 ROUND ${gameState.round} COMPLETE!`);
  Logger.info(`🏆 ═══════════════════════════════════════════════════════════`);
  Logger.info(`🏆 WINNER: ${winnerName || 'No winner'} with ${leaderboard[0]?.finalScore || 0} points`);
  Logger.info(`📊 FINAL LEADERBOARD:`);
  leaderboard.slice(0, 10).forEach((player, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const reactionStr = player.reactionTime !== null ? `${player.reactionTime}ms` : 'no tap';
    Logger.info(`   ${medal} ${player.name}: ${player.finalScore} pts (auction: ${player.auctionScore}, reaction: ${reactionStr})`);
  });
  if (leaderboard.length > 10) {
    Logger.info(`   ... and ${leaderboard.length - 10} more players`);
  }
  Logger.info(`🏆 ═══════════════════════════════════════════════════════════`);

  // Broadcast winner and top 3 to host
  broadcastToHosts('round_complete', `🏆 ROUND ${gameState.round} COMPLETE!`, 'success');
  broadcastToHosts('winner', `🏆 WINNER: ${winnerName || 'No winner'} with ${leaderboard[0]?.finalScore || 0} points`, 'success');
  
  const top3 = leaderboard.slice(0, 3).map((p, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
    return `${medal} ${p.name}: ${p.finalScore} pts`;
  }).join(' | ');
  broadcastToHosts('leaderboard_top3', `📊 ${top3}`, 'game');

  leaderboard.forEach((player) => {
    // Track auction taps, reaction time, and final score
    const auctionTaps = player.auctionScore ?? player.clicks;
    persistence.updatePlayerStats(
      player.name,
      auctionTaps,
      player.reactionTime,
      player.finalScore,
      player.name === winnerName
    );
  });

  persistence.saveScores().catch((err) => {
    Logger.error('Failed to save scores:', err);
  });

  broadcastState();
}

// Legacy aliases for backwards compatibility
export function startBidding(): void {
  startClickAuction();
}

export function endAuction(): void {
  endClickAuction();
}

export function setCountdownInterval(interval: ReturnType<typeof setInterval>): void {
  countdownInterval = interval;
}

export function clearCountdownInterval(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}
