import { Server } from 'socket.io';
import config from './config';
import * as botDetection from './botDetection';
import * as persistence from './persistence';
import Logger from './logger';
import { GameState, LeaderboardEntry, Player } from './types';

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

export function broadcastState(): void {
  const leaderboard = gameState.status === 'finished' && gameState.finalLeaderboard.length > 0
    ? gameState.finalLeaderboard
    : getLeaderboard();

  io.emit('gameState', {
    status: gameState.status,
    timeRemaining: gameState.timeRemaining,
    leaderboard: leaderboard,
    winner: gameState.winner,
    winnerAd: gameState.winnerAd,
    round: gameState.round,
    playerCount: Object.keys(gameState.players).length,
    allTimeLeaderboard: persistence.getAllTimeLeaderboard().slice(0, 20),
    auctionScores: gameState.auctionScores,
    fastestFingerStartTime: gameState.fastestFingerStartTime,
  });
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

  broadcastState();

  auctionInterval = setInterval(() => {
    gameState.timeRemaining--;
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

  // Start Fastest Finger countdown
  gameState.status = 'fastestFinger_countdown';
  gameState.timeRemaining = gameState.fastestFingerCountdownDuration;

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
