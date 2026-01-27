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
  stage1Scores: {},
  stage2StartTime: null,
  stage2CountdownDuration: 3,
};

// Intervals
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let biddingInterval: ReturnType<typeof setInterval> | null = null;
let stage2CountdownInterval: ReturnType<typeof setInterval> | null = null;
let stage2TapTimeout: ReturnType<typeof setTimeout> | null = null;
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
  if (biddingInterval) {
    clearInterval(biddingInterval);
    biddingInterval = null;
  }
  if (stage2CountdownInterval) {
    clearInterval(stage2CountdownInterval);
    stage2CountdownInterval = null;
  }
  if (stage2TapTimeout) {
    clearTimeout(stage2TapTimeout);
    stage2TapTimeout = null;
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
  gameState.stage1Scores = {};
  gameState.stage2StartTime = null;
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
      finalScore: player.clicks, // Default to clicks, updated after Stage 2
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
    stage1Score: gameState.stage1Scores[id] || player.clicks,
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
      ? (config.STAGE2_MULTIPLIERS[index] || 1.0)
      : 1.0; // No multiplier if didn't tap
    
    return {
      ...entry,
      finalScore: Math.round(entry.stage1Score * multiplier),
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
    stage1Scores: gameState.stage1Scores,
    stage2StartTime: gameState.stage2StartTime,
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

export function startBidding(): void {
  gameState.status = 'bidding';
  gameState.timeRemaining = gameState.auctionDuration;

  broadcastState();

  biddingInterval = setInterval(() => {
    gameState.timeRemaining--;
    broadcastState();

    if (gameState.timeRemaining <= 0) {
      if (biddingInterval) {
        clearInterval(biddingInterval);
        biddingInterval = null;
      }
      endStage1();
    }
  }, config.TICK_INTERVAL_MS);
}

export function endStage1(): void {
  // Preserve Stage 1 scores
  gameState.stage1Scores = {};
  Object.entries(gameState.players).forEach(([id, player]) => {
    gameState.stage1Scores[id] = player.clicks;
    // Reset reaction time for Stage 2
    player.reactionTime = null;
  });

  // Start Stage 2 countdown
  gameState.status = 'stage2_countdown';
  gameState.timeRemaining = gameState.stage2CountdownDuration;

  broadcastState();

  stage2CountdownInterval = setInterval(() => {
    gameState.timeRemaining--;
    broadcastState();

    if (gameState.timeRemaining <= 0) {
      if (stage2CountdownInterval) {
        clearInterval(stage2CountdownInterval);
        stage2CountdownInterval = null;
      }
      startStage2Tap();
    }
  }, config.TICK_INTERVAL_MS);
}

export function startStage2Tap(): void {
  gameState.status = 'stage2_tap';
  gameState.stage2StartTime = Date.now();

  broadcastState();

  // Set timeout for Stage 2 (players have limited time to tap)
  stage2TapTimeout = setTimeout(() => {
    endStage2();
  }, config.STAGE2_TAP_TIMEOUT_MS);
}

export function recordReactionTime(socketId: string): boolean {
  // Only record if player hasn't already tapped
  if (gameState.status !== 'stage2_tap') return false;
  if (!gameState.players[socketId]) return false;
  if (gameState.players[socketId].reactionTime !== null && gameState.players[socketId].reactionTime !== undefined) {
    return false; // Already recorded
  }

  const reactionTime = Date.now() - (gameState.stage2StartTime || Date.now());
  gameState.players[socketId].reactionTime = reactionTime;

  // Check if all players have tapped
  const allTapped = Object.values(gameState.players).every(
    (player) => player.reactionTime !== null && player.reactionTime !== undefined
  );

  if (allTapped) {
    if (stage2TapTimeout) {
      clearTimeout(stage2TapTimeout);
      stage2TapTimeout = null;
    }
    endStage2();
  }

  return true;
}

export function endStage2(): void {
  if (stage2TapTimeout) {
    clearTimeout(stage2TapTimeout);
    stage2TapTimeout = null;
  }

  gameState.status = 'finished';

  // Calculate final scores with Stage 2 multipliers
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
    // Use finalScore for stats tracking
    persistence.updatePlayerStats(player.name, player.finalScore, player.name === winnerName);
  });

  persistence.saveScores().catch((err) => {
    Logger.error('Failed to save scores:', err);
  });

  broadcastState();
}

// Legacy alias for backwards compatibility
export function endAuction(): void {
  endStage1();
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

