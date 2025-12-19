import { Server } from 'socket.io';
import config from './config';
import * as botDetection from './botDetection';
import * as persistence from './persistence';
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
};

// Intervals
let countdownInterval: ReturnType<typeof setInterval> | null = null;
let biddingInterval: ReturnType<typeof setInterval> | null = null;
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
      botDetection.resetBotDetectionData(id);
    }
  });
  gameState.status = 'waiting';
  gameState.winner = null;
  gameState.winnerAd = null;
  gameState.timeRemaining = 0;
  gameState.finalLeaderboard = [];
}

export function getLeaderboard(): LeaderboardEntry[] {
  return Object.entries(gameState.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      clicks: player.clicks,
      color: player.color,
      suspicious: player.suspicious || false,
    }))
    .sort((a, b) => b.clicks - a.clicks);
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
      clearInterval(biddingInterval!);
      biddingInterval = null;
      endAuction();
    }
  }, 1000);
}

export function endAuction(): void {
  gameState.status = 'finished';

  const leaderboard = getLeaderboard();
  gameState.finalLeaderboard = leaderboard;

  let winnerName: string | null = null;
  if (leaderboard.length > 0 && leaderboard[0].clicks > 0) {
    const winnerId = leaderboard[0].id;
    gameState.winner = {
      ...gameState.players[winnerId],
      id: winnerId,
    };
    gameState.winnerAd = gameState.players[winnerId].adContent;
    winnerName = gameState.winner.name;
  }

  leaderboard.forEach((player) => {
    persistence.updatePlayerStats(player.name, player.clicks, player.name === winnerName);
  });

  persistence.saveScores().catch((err) => {
    // Import Logger inline to avoid circular dependency
    import('./logger').then((mod) => mod.default.error('Failed to save scores:', err));
  });

  broadcastState();
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

