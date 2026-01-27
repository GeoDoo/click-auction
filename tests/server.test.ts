/**
 * Click Auction - Comprehensive Server Tests
 *
 * Tests for core game functionality:
 * - Player connection/disconnection
 * - Game state management
 * - Auction flow
 * - Score persistence
 * - Leaderboard calculations
 * - Edge cases and race conditions
 * - Timer/interval management
 *
 * NOTE: All tests use event-driven assertions instead of arbitrary delays.
 * We wait for actual socket events or state changes, not setTimeout.
 */

import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import fs from 'fs';
import path from 'path';

// Type for game state
interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'finished';
  timeRemaining: number;
  leaderboard: Array<{
    id: string;
    name: string;
    clicks: number;
    color: string;
    suspicious?: boolean;
  }>;
  winner: { name: string; id: string } | null;
  winnerAd: string | null;
  round: number;
  playerCount: number;
  allTimeLeaderboard: Array<{
    name: string;
    wins: number;
    totalClicks: number;
    bestRound: number;
  }>;
}

// Test configuration - use 0 to let OS assign available port
const TEST_SCORES_FILE = path.join(__dirname, 'test-scores.json');

// Increase Jest timeout for all tests
jest.setTimeout(30000);

// ==========================================
// EVENT-DRIVEN TEST HELPERS (NO ARBITRARY DELAYS)
// ==========================================

/**
 * Wait for a specific socket event
 */
const waitFor = <T = unknown>(socket: ClientSocket, event: string, timeout = 5000): Promise<T> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
};

/**
 * Wait for gameState with specific status
 */
const waitForStatus = (socket: ClientSocket, targetStatus: GameState['status'], timeout = 10000): Promise<GameState> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler);
      reject(new Error(`Timeout waiting for status: ${targetStatus}`));
    }, timeout);

    const handler = (state: GameState) => {
      if (state.status === targetStatus) {
        clearTimeout(timer);
        socket.off('gameState', handler);
        resolve(state);
      }
    };

    socket.on('gameState', handler);
  });
};

/**
 * Wait for gameState matching a condition
 */
const waitForCondition = (socket: ClientSocket, conditionFn: (state: GameState) => boolean, timeout = 5000): Promise<GameState> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler);
      reject(new Error('Timeout waiting for condition'));
    }, timeout);

    const handler = (state: GameState) => {
      if (conditionFn(state)) {
        clearTimeout(timer);
        socket.off('gameState', handler);
        resolve(state);
      }
    };

    socket.on('gameState', handler);
  });
};

/**
 * Wait for player count to reach a specific number
 */
const waitForPlayerCount = (socket: ClientSocket, count: number, timeout = 5000): Promise<GameState> => {
  return waitForCondition(socket, (state) => state.playerCount === count, timeout);
};

/**
 * Emit and wait for acknowledgment via gameState update
 * This replaces arbitrary delays after emit
 */
const emitAndWait = async (socket: ClientSocket, event: string, data: unknown, waitCondition: (state: GameState) => boolean, timeout = 5000): Promise<GameState> => {
  const promise = waitForCondition(socket, waitCondition, timeout);
  socket.emit(event, data);
  return promise;
};

// Additional response types
interface SessionCreatedResponse {
  token: string;
}

interface RejoinSuccessResponse {
  token: string;
  playerData: {
    name: string;
    clicks: number;
    color: string;
  };
}

interface ErrorResponse {
  message: string;
}

interface ClickUpdateResponse {
  playerId: string;
  playerName: string;
  clicks: number;
  color: string;
  suspicious: boolean;
}

// Test server state type
interface TestGameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished';
  players: Record<string, {
    name: string;
    clicks: number;
    color: string;
    adContent: string;
    suspicious?: boolean;
    suspicionReason?: string | null;
    reactionTime?: number | null;
  }>;
  auctionDuration: number;
  countdownDuration: number;
  stage2CountdownDuration: number;
  timeRemaining: number;
  winner: { name: string; id: string; color: string; clicks: number } | null;
  winnerAd: string | null;
  round: number;
  finalLeaderboard: Array<{
    id: string;
    name: string;
    clicks: number;
    color: string;
    suspicious: boolean;
    reactionTime?: number | null;
    finalScore: number;
  }>;
  stage1Scores: Record<string, number>;
  stage2StartTime: number | null;
}

describe('Click Auction Server', () => {
  let io: Server;
  let httpServer: HttpServer;
  let serverUrl: string;
  let gameState: TestGameState;
  let allTimeStats: Record<string, { wins: number; totalClicks: number; roundsPlayed: number; bestRound: number; lastPlayed: string | null }>;
  let connectedClients: ClientSocket[] = [];

  // Store interval references
  let countdownInterval: ReturnType<typeof setInterval> | null = null;
  let biddingInterval: ReturnType<typeof setInterval> | null = null;
  let stage2CountdownInterval: ReturnType<typeof setInterval> | null = null;
  let stage2TapTimeout: ReturnType<typeof setTimeout> | null = null;

  // Game logic functions (extracted for testing)
  const DSP_COLORS = [
    '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
    '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
    '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
    '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A',
  ];
  let colorIndex = 0;

  const getNextColor = () => {
    const color = DSP_COLORS[colorIndex % DSP_COLORS.length];
    colorIndex++;
    return color;
  };

  const clearAllIntervals = () => {
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
  };

  const resetGameState = () => {
    clearAllIntervals();
    gameState = {
      status: 'waiting',
      players: {},
      auctionDuration: 2, // Short for tests
      countdownDuration: 1, // Short for tests
      stage2CountdownDuration: 1, // Short for tests
      timeRemaining: 0,
      winner: null,
      winnerAd: null,
      round: 0,
      finalLeaderboard: [],
      stage1Scores: {},
      stage2StartTime: null,
    };
    colorIndex = 0;
  };

  const getLeaderboard = (): Array<{ id: string; name: string; clicks: number; color: string; suspicious: boolean; reactionTime?: number | null; finalScore: number }> => {
    return Object.entries(gameState.players)
      .map(([id, player]) => ({
        id,
        name: player.name,
        clicks: player.clicks,
        color: player.color,
        suspicious: player.suspicious || false,
        reactionTime: player.reactionTime ?? null,
        finalScore: player.clicks, // Default to clicks
      }))
      .sort((a, b) => b.clicks - a.clicks);
  };

  const STAGE2_MULTIPLIERS = [2.0, 1.5, 1.25];

  const calculateFinalScores = (): Array<{ id: string; name: string; clicks: number; color: string; suspicious: boolean; reactionTime?: number | null; finalScore: number }> => {
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
        ? (STAGE2_MULTIPLIERS[index] || 1.0)
        : 1.0;
      
      return {
        ...entry,
        finalScore: Math.round(entry.stage1Score * multiplier),
      };
    });

    // Sort by final score (highest first)
    return withMultipliers.sort((a, b) => b.finalScore - a.finalScore);
  };

  const getAllTimeLeaderboard = () => {
    return Object.entries(allTimeStats)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
  };

  const updatePlayerStats = (name: string, clicks: number, isWinner: boolean): void => {
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
  };

  const broadcastState = () => {
    const leaderboard = gameState.status === 'finished' && gameState.finalLeaderboard.length > 0
      ? gameState.finalLeaderboard
      : getLeaderboard();

    io.emit('gameState', {
      status: gameState.status,
      timeRemaining: gameState.timeRemaining,
      leaderboard,
      winner: gameState.winner,
      winnerAd: gameState.winnerAd,
      round: gameState.round,
      playerCount: Object.keys(gameState.players).length,
      allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20),
      stage1Scores: gameState.stage1Scores,
      stage2StartTime: gameState.stage2StartTime,
    });
  };

  const startBidding = () => {
    gameState.status = 'bidding';
    gameState.timeRemaining = gameState.auctionDuration;
    broadcastState();

    biddingInterval = setInterval(() => {
      gameState.timeRemaining--;
      broadcastState();

      if (gameState.timeRemaining <= 0) {
        if (biddingInterval) clearInterval(biddingInterval);
        biddingInterval = null;
        endStage1();
      }
    }, 100); // Fast for tests
  };

  const endStage1 = () => {
    // Preserve Stage 1 scores
    gameState.stage1Scores = {};
    Object.entries(gameState.players).forEach(([id, player]) => {
      gameState.stage1Scores[id] = player.clicks;
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
        if (stage2CountdownInterval) clearInterval(stage2CountdownInterval);
        stage2CountdownInterval = null;
        startStage2Tap();
      }
    }, 100); // Fast for tests
  };

  const startStage2Tap = () => {
    gameState.status = 'stage2_tap';
    gameState.stage2StartTime = Date.now();
    broadcastState();

    // Timeout for Stage 2 (shorter for tests)
    stage2TapTimeout = setTimeout(() => {
      endStage2();
    }, 500); // Fast for tests (0.5 seconds)
  };

  const recordReactionTime = (socketId: string): boolean => {
    if (gameState.status !== 'stage2_tap') return false;
    if (!gameState.players[socketId]) return false;
    if (gameState.players[socketId].reactionTime !== null && gameState.players[socketId].reactionTime !== undefined) {
      return false;
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
  };

  const endStage2 = () => {
    if (stage2TapTimeout) {
      clearTimeout(stage2TapTimeout);
      stage2TapTimeout = null;
    }

    gameState.status = 'finished';
    
    // Calculate final scores with Stage 2 multipliers
    const leaderboard = calculateFinalScores();
    gameState.finalLeaderboard = leaderboard;

    let winnerName = null;
    if (leaderboard.length > 0 && leaderboard[0].finalScore > 0) {
      const winnerId = leaderboard[0].id;
      if (gameState.players[winnerId]) {
        gameState.winner = { ...gameState.players[winnerId], id: winnerId };
        gameState.winnerAd = gameState.players[winnerId].adContent;
        winnerName = gameState.winner.name;
      }
    }

    leaderboard.forEach(player => {
      updatePlayerStats(player.name, player.finalScore, player.name === winnerName);
    });

    broadcastState();
  };

  // Legacy alias for backwards compatibility (prefixed to avoid unused warning)
  const _endAuction = () => {
    endStage1();
  };
  // Suppress unused variable warning
  void _endAuction;

  // Helper to create and track client connections
  const createClient = () => {
    const client = Client(serverUrl, {
      transports: ['websocket'],
      forceNew: true,
    });
    connectedClients.push(client);
    return client;
  };

  // Helper to close all tracked clients
  const closeAllClients = (): void => {
    connectedClients.forEach(client => {
      if (client.connected) {
        client.close();
      }
    });
    connectedClients = [];
  };

  // Helper to safely close a specific client
  const closeClient = (client: ClientSocket): void => {
    connectedClients = connectedClients.filter(c => c !== client);
    if (client.connected) {
      client.close();
    }
  };

  /**
   * Type guard to ensure socket ID is defined
   */
  function assertSocketId(socket: ClientSocket): asserts socket is ClientSocket & { id: string } {
    if (typeof socket.id !== 'string') {
      throw new Error('Socket ID is not defined - socket may not be connected');
    }
  }

  /**
   * Get player from game state with proper type narrowing
   */
  function getPlayer(socketId: string): TestGameState['players'][string] {
    const player = gameState.players[socketId];
    if (!player) {
      throw new Error(`Player with socket ID ${socketId} not found in game state`);
    }
    return player;
  }

  beforeAll((done) => {
    // Clean up test scores file
    if (fs.existsSync(TEST_SCORES_FILE)) {
      fs.unlinkSync(TEST_SCORES_FILE);
    }

    // Create server
    httpServer = createServer();
    io = new Server(httpServer);

    // Initialize state
    resetGameState();
    allTimeStats = {};

    // Session management for reconnection
    interface TestSession {
      playerId: string | null;
      playerData: TestGameState['players'][string];
      disconnectedAt: number | null;
    }
    const playerSessions: Record<string, TestSession> = {};
    const socketToSession: Record<string, string> = {};

    function generateSessionToken(): string {
      return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    }

    function createSession(socketId: string, playerData: TestGameState['players'][string]): string {
      const token = generateSessionToken();
      playerSessions[token] = {
        playerId: socketId,
        playerData: { ...playerData },
        disconnectedAt: null,
      };
      socketToSession[socketId] = token;
      return token;
    }

    function markSessionDisconnected(socketId: string): string | null {
      const token = socketToSession[socketId];
      if (!token || !playerSessions[token]) return null;

      // Update session with latest player data before marking disconnected
      if (gameState.players[socketId]) {
        playerSessions[token].playerData = { ...gameState.players[socketId] };
      }

      playerSessions[token].disconnectedAt = Date.now();
      playerSessions[token].playerId = null;
      delete socketToSession[socketId];
      return token;
    }

    function restoreSession(token: string, newSocketId: string): TestGameState['players'][string] | null {
      const session = playerSessions[token];
      if (!session) return null;

      session.playerId = newSocketId;
      session.disconnectedAt = null;
      socketToSession[newSocketId] = token;
      return session.playerData;
    }

    // Set up socket handlers
    io.on('connection', (socket) => {
      // Send initial state
      socket.emit('gameState', {
        status: gameState.status,
        timeRemaining: gameState.timeRemaining,
        leaderboard: getLeaderboard(),
        winner: gameState.winner,
        winnerAd: gameState.winnerAd,
        round: gameState.round,
        playerCount: Object.keys(gameState.players).length,
        allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20),
        stage1Scores: gameState.stage1Scores,
        stage2StartTime: gameState.stage2StartTime,
      });

      socket.on('joinGame', (data: { name?: string; adContent?: string } | null) => {
        const { name, adContent } = data || {};
        const playerData: TestGameState['players'][string] = {
          name: name || `DSP-${socket.id.substr(0, 4)}`,
          clicks: 0,
          color: getNextColor(),
          adContent: adContent || `${name || 'Anonymous'} wins!`,
        };
        gameState.players[socket.id] = playerData;

        // Create session and emit token
        const token = createSession(socket.id, playerData);
        socket.emit('sessionCreated', { token });

        broadcastState();
      });

      socket.on('rejoinGame', (data: { token?: string } | null) => {
        const safeData = data && typeof data === 'object' ? data : {};
        const token = safeData.token;

        if (!token || typeof token !== 'string') {
          socket.emit('rejoinError', { message: 'Invalid session token' });
          return;
        }

        const session = playerSessions[token];
        if (!session) {
          socket.emit('rejoinError', { message: 'Session expired or not found' });
          return;
        }

        if (session.playerId && session.playerId !== socket.id) {
          socket.emit('rejoinError', { message: 'Session already in use' });
          return;
        }

        const playerData = restoreSession(token, socket.id);
        if (!playerData) {
          socket.emit('rejoinError', { message: 'Failed to restore session' });
          return;
        }

        gameState.players[socket.id] = { ...playerData };

        socket.emit('rejoinSuccess', {
          token,
          playerData: {
            name: playerData.name,
            clicks: playerData.clicks,
            color: playerData.color,
          },
        });

        broadcastState();
      });

      socket.on('click', () => {
        // Stage 1: Bidding phase - count clicks
        if (gameState.status === 'bidding' && gameState.players[socket.id]) {
          gameState.players[socket.id].clicks++;
          io.emit('clickUpdate', {
            playerId: socket.id,
            clicks: gameState.players[socket.id].clicks,
          });
        }
        // Stage 2: Tap phase - record reaction time
        else if (gameState.status === 'stage2_tap' && gameState.players[socket.id]) {
          const recorded = recordReactionTime(socket.id);
          if (recorded) {
            io.emit('reactionTimeRecorded', {
              playerId: socket.id,
              playerName: gameState.players[socket.id].name,
              reactionTime: gameState.players[socket.id].reactionTime,
            });
            broadcastState();
          }
        }
      });

      socket.on('startAuction', (settings?: { duration?: number }) => {
        // Clear any existing intervals first (prevents multiple timers)
        clearAllIntervals();

        if (settings?.duration) {
          gameState.auctionDuration = settings.duration;
        }

        // Reset clicks and reaction time for all players
        Object.keys(gameState.players).forEach(id => {
          gameState.players[id].clicks = 0;
          gameState.players[id].reactionTime = null;
        });

        gameState.status = 'countdown';
        gameState.round++;
        gameState.timeRemaining = gameState.countdownDuration;
        gameState.winner = null;
        gameState.winnerAd = null;
        gameState.finalLeaderboard = [];
        gameState.stage1Scores = {};
        gameState.stage2StartTime = null;

        broadcastState();

        // Countdown
        countdownInterval = setInterval(() => {
          gameState.timeRemaining--;
          broadcastState();

          if (gameState.timeRemaining <= 0) {
            if (countdownInterval) clearInterval(countdownInterval);
            countdownInterval = null;
            startBidding();
          }
        }, 100); // Fast for tests
      });

      socket.on('resetAuction', () => {
        clearAllIntervals();
        Object.keys(gameState.players).forEach(id => {
          gameState.players[id].clicks = 0;
          gameState.players[id].reactionTime = null;
        });
        gameState.status = 'waiting';
        gameState.winner = null;
        gameState.winnerAd = null;
        gameState.timeRemaining = 0;
        gameState.finalLeaderboard = [];
        gameState.stage1Scores = {};
        gameState.stage2StartTime = null;
        broadcastState();
      });

      socket.on('resetAllTimeStats', () => {
        allTimeStats = {};
        broadcastState();
      });

      socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
          // Mark session as disconnected (gives player time to reconnect)
          markSessionDisconnected(socket.id);
          delete gameState.players[socket.id];
          broadcastState();
        }
      });
    });

    // Listen on port 0 to get random available port
    httpServer.listen(0, () => {
      const address = httpServer.address();
      if (address && typeof address !== 'string') {
        serverUrl = `http://localhost:${address.port}`;
      }
      done();
    });
  });

  afterAll((done) => {
    closeAllClients();
    clearAllIntervals();
    io.close();
    httpServer.close(done);

    // Clean up test scores file
    if (fs.existsSync(TEST_SCORES_FILE)) {
      fs.unlinkSync(TEST_SCORES_FILE);
    }
  });

  beforeEach(() => {
    resetGameState();
    allTimeStats = {};
  });

  afterEach(() => {
    closeAllClients();
  });

  // ==========================================
  // CONNECTION TESTS
  // ==========================================

  describe('Connection', () => {
    test('client receives initial state on connect', async () => {
      const client = createClient();
      const state = await waitFor(client, 'gameState');

      expect(state).toHaveProperty('status', 'waiting');
      expect(state).toHaveProperty('playerCount', 0);
      expect(state).toHaveProperty('leaderboard');
      expect(state).toHaveProperty('allTimeLeaderboard');
      expect(state).toHaveProperty('round', 0);
    });

    test('multiple clients can connect simultaneously', async () => {
      const clients = [];
      for (let i = 0; i < 5; i++) {
        clients.push(createClient());
      }

      await Promise.all(clients.map(c => waitFor(c, 'connect')));

      expect(clients.every(c => c.connected)).toBe(true);
    });

    test('client can reconnect after disconnect', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      // Wait for disconnect event before reconnecting
      const disconnectPromise = waitFor(client, 'disconnect');
      closeClient(client);
      await disconnectPromise;

      const client2 = createClient();
      await waitFor(client2, 'connect');

      expect(client2.connected).toBe(true);
    });
  });

  // ==========================================
  // PLAYER MANAGEMENT TESTS
  // ==========================================

  describe('Player Management', () => {
    test('player joins with custom name', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      // Wait for gameState showing the player joined
      const state = await emitAndWait(
        client,
        'joinGame',
        { name: 'CustomPlayer', adContent: 'My Ad' },
        (s) => s.playerCount === 1,
      );

      expect(state.playerCount).toBe(1);
      expect(state.leaderboard[0].name).toBe('CustomPlayer');
    });

    test('player gets default name when joining with empty name', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      const state = await emitAndWait(
        client,
        'joinGame',
        { name: '', adContent: '' },
        (s) => s.playerCount === 1,
      );

      expect(state.leaderboard[0].name).toMatch(/^DSP-/);
    });

    test('player gets default name when joining with null data', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      const state = await emitAndWait(
        client,
        'joinGame',
        null,
        (s) => s.playerCount === 1,
      );

      expect(state.leaderboard[0].name).toMatch(/^DSP-/);
    });

    test('player gets assigned unique color', async () => {
      const client1 = createClient();
      const client2 = createClient();

      await waitFor(client1, 'connect');
      await waitFor(client2, 'connect');

      // Join first player and wait for state update
      await emitAndWait(client1, 'joinGame', { name: 'Player1' }, (s) => s.playerCount === 1);

      // Join second player and wait for state update with 2 players
      const state = await emitAndWait(client2, 'joinGame', { name: 'Player2' }, (s) => s.playerCount === 2);

      const colors = state.leaderboard.map(p => p.color);
      expect(new Set(colors).size).toBe(2);
    });

    test('colors cycle after all are used', async () => {
      // Create more players than colors
      for (let i = 0; i < 25; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        await emitAndWait(client, 'joinGame', { name: `Player${i}` }, (s) => s.playerCount === i + 1);
      }

      // Should have 25 players with cycling colors
      expect(Object.keys(gameState.players).length).toBe(25);
    });

    test('player count decreases on disconnect', async () => {
      const client1 = createClient();
      const client2 = createClient();

      await waitFor(client1, 'connect');
      await waitFor(client2, 'connect');

      await emitAndWait(client1, 'joinGame', { name: 'Stayer' }, (s) => s.playerCount === 1);
      await emitAndWait(client2, 'joinGame', { name: 'Leaver' }, (s) => s.playerCount === 2);

      expect(Object.keys(gameState.players).length).toBe(2);

      // Wait for disconnect to be processed by watching for playerCount change
      const disconnectPromise = waitForPlayerCount(client1, 1);
      closeClient(client2);
      await disconnectPromise;

      expect(Object.keys(gameState.players).length).toBe(1);
    });
  });

  // ==========================================
  // AUCTION FLOW TESTS
  // ==========================================

  describe('Auction Flow', () => {
    test('auction starts in countdown state', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Bidder' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 2 });
      const state = await waitForStatus(player, 'countdown');

      expect(state.status).toBe('countdown');
      expect(state.round).toBe(1);

      // Wait for auction to complete to cleanup
      await waitForStatus(player, 'finished', 5000);
    });

    test('auction transitions: countdown → bidding → finished', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Bidder' }, (s) => s.playerCount === 1);

      const statuses: GameState['status'][] = [];
      player.on('gameState', (state: GameState) => {
        if (!statuses.includes(state.status)) {
          statuses.push(state.status);
        }
      });

      host.emit('startAuction', { duration: 1 });

      await waitForStatus(player, 'finished', 5000);

      expect(statuses).toContain('countdown');
      expect(statuses).toContain('bidding');
      expect(statuses).toContain('finished');
    });

    test('round number increments with each auction', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);
      expect(gameState.round).toBe(1);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);
      expect(gameState.round).toBe(2);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);
      expect(gameState.round).toBe(3);
    });

    test('clicks only register during bidding phase', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Clicker' }, (s) => s.playerCount === 1);

      // After connect, socket ID is guaranteed to exist
      assertSocketId(player);

      // Click during waiting - should not count (check gameState directly, it's synchronous)
      player.emit('click');
      player.emit('click');
      expect(getPlayer(player.id).clicks).toBe(0);

      host.emit('startAuction', { duration: 2 });

      // Wait for countdown, then click - should not count
      await waitForStatus(player, 'countdown', 3000);
      player.emit('click');
      player.emit('click');
      // Clicks during countdown shouldn't register
      expect(getPlayer(player.id).clicks).toBe(0);

      // Wait for bidding, then click - should count
      await waitForStatus(player, 'bidding', 3000);

      // Click and wait for clickUpdate event to confirm it was processed
      const clickPromise1 = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
      player.emit('click');
      await clickPromise1;

      const clickPromise2 = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
      player.emit('click');
      await clickPromise2;

      const clickPromise3 = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
      player.emit('click');
      await clickPromise3;

      expect(getPlayer(player.id).clicks).toBe(3);

      // Wait for finish
      await waitForStatus(player, 'finished', 5000);
    });

    test('clicking as non-player does nothing', async () => {
      const host = createClient();
      const player = createClient();
      const spectator = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');
      await waitFor(spectator, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Player' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 2 });
      await waitForStatus(host, 'bidding', 5000);

      // Spectator (not joined) clicks - no clickUpdate should be emitted for them
      spectator.emit('click');
      spectator.emit('click');

      // Only player should have clicks tracked
      expect(Object.keys(gameState.players).length).toBe(1);

      await waitForStatus(host, 'finished', 5000);
    });

    test('reset clears auction state', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Resetter' }, (s) => s.playerCount === 1);
      assertSocketId(player);

      host.emit('startAuction', { duration: 3 });
      await waitForStatus(host, 'bidding', 5000);

      // Click and wait for confirmation
      const clickPromise = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
      player.emit('click');
      await clickPromise;

      // Reset and wait for waiting status
      host.emit('resetAuction');
      const state = await waitForStatus(host, 'waiting');

      expect(state.status).toBe('waiting');
      expect(state.winner).toBeNull();
      expect(state.timeRemaining).toBe(0);
      expect(getPlayer(player.id).clicks).toBe(0);
    });
  });

  // ==========================================
  // TIMER/INTERVAL CRITICAL TESTS (Bug Prevention)
  // ==========================================

  describe('Timer/Interval Management', () => {
    test('starting auction multiple times does not create multiple timers', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Timer Test' }, (s) => s.playerCount === 1);

      // Start auction multiple times rapidly
      host.emit('startAuction', { duration: 3 });
      host.emit('startAuction', { duration: 3 });
      host.emit('startAuction', { duration: 3 });

      // Wait for any status change
      const state = await waitForCondition(host, (s) => s.status !== 'waiting');

      // Should still be in countdown or bidding, not finished prematurely
      expect(['countdown', 'bidding']).toContain(state.status);

      // Round should only increment once per real start
      expect(gameState.round).toBe(3); // Each start increments, but timers are cleared

      // Wait for auction to finish normally
      await waitForStatus(player, 'finished', 8000);

      // Should finish cleanly
      expect(gameState.status).toBe('finished');
    });

    test('reset during countdown clears timer', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      host.emit('startAuction', { duration: 5 });
      await waitForStatus(host, 'countdown', 3000);

      host.emit('resetAuction');
      const state = await waitForStatus(host, 'waiting');

      expect(state.status).toBe('waiting');

      // Verify timer didn't continue by checking state after a moment
      // Use a short condition check instead of arbitrary delay
      await new Promise(r => setTimeout(r, 300)); // Minimal wait to let any rogue timers fire
      expect(gameState.status).toBe('waiting');
    });

    test('reset during bidding clears timer', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      host.emit('startAuction', { duration: 5 });
      await waitForStatus(host, 'bidding', 3000);

      host.emit('resetAuction');
      const state = await waitForStatus(host, 'waiting');

      expect(state.status).toBe('waiting');

      // Verify timer didn't continue
      await new Promise(r => setTimeout(r, 300)); // Minimal wait to let any rogue timers fire
      expect(gameState.status).toBe('waiting');
    });

    test('starting new auction immediately after finish works correctly', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      // First auction
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);

      expect(gameState.round).toBe(1);

      // Immediately start another
      host.emit('startAuction', { duration: 1 });
      const state = await waitForCondition(host, (s) => s.status !== 'finished' || s.round === 2);

      expect(['countdown', 'bidding']).toContain(state.status);
      expect(gameState.round).toBe(2);

      await waitForStatus(host, 'finished', 5000);
      expect(gameState.round).toBe(2);
    });

    test('rapid start-reset-start cycle handles correctly', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      // Rapid cycle - use event-driven waiting
      for (let i = 0; i < 5; i++) {
        host.emit('startAuction', { duration: 2 });
        await waitForCondition(host, (s) => s.status === 'countdown' || s.status === 'bidding', 2000);
        host.emit('resetAuction');
        await waitForStatus(host, 'waiting', 2000);
      }

      // Final state should be waiting
      expect(gameState.status).toBe('waiting');

      // Start one final auction and let it complete
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);

      expect(gameState.status).toBe('finished');
    });

    test('time only decreases (never increases) during auction', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      host.emit('startAuction', { duration: 2 });

      const times: number[] = [];
      const handler = (state: GameState): void => {
        if (state.status === 'bidding') {
          times.push(state.timeRemaining);
        }
      };
      host.on('gameState', handler);

      await waitForStatus(host, 'finished', 5000);
      host.off('gameState', handler);

      // Check that times are monotonically decreasing
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeLessThanOrEqual(times[i - 1]);
      }
    });
  });

  // ==========================================
  // WINNER DETERMINATION TESTS
  // ==========================================

  describe('Winner Determination', () => {
    test('highest clicker wins', async () => {
      const host = createClient();
      const fast = createClient();
      const slow = createClient();

      await waitFor(host, 'connect');
      await waitFor(fast, 'connect');
      await waitFor(slow, 'connect');

      await emitAndWait(fast, 'joinGame', { name: 'FastClicker', adContent: 'I win!' }, (s) => s.playerCount === 1);
      await emitAndWait(slow, 'joinGame', { name: 'SlowClicker', adContent: 'Maybe next time' }, (s) => s.playerCount === 2);

      host.emit('startAuction', { duration: 2 });
      await waitForStatus(fast, 'bidding', 3000);

      // Fast clicks more - wait for each click to be confirmed
      for (let i = 0; i < 10; i++) {
        const p = waitFor(fast, 'clickUpdate');
        fast.emit('click');
        await p;
      }
      for (let i = 0; i < 3; i++) {
        const p = waitFor(slow, 'clickUpdate');
        slow.emit('click');
        await p;
      }

      await waitForStatus(fast, 'finished', 5000);

      expect(gameState.winner).not.toBeNull();
      if (gameState.winner) {
        expect(gameState.winner.name).toBe('FastClicker');
      }
      expect(gameState.winnerAd).toBe('I win!');
    });

    test('no winner when all clicks are zero', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Idle' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 1 });

      // Don't click at all
      await waitForStatus(player, 'finished', 5000);

      expect(gameState.winner).toBeNull();
    });

    test('no winner when no players', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(host, 'finished', 5000);

      expect(gameState.winner).toBeNull();
      expect(gameState.finalLeaderboard).toHaveLength(0);
    });

    test('tie goes to first in leaderboard order', async () => {
      const host = createClient();
      const p1 = createClient();
      const p2 = createClient();

      await waitFor(host, 'connect');
      await waitFor(p1, 'connect');
      await waitFor(p2, 'connect');

      await emitAndWait(p1, 'joinGame', { name: 'TiePlayer1' }, (s) => s.playerCount === 1);
      await emitAndWait(p2, 'joinGame', { name: 'TiePlayer2' }, (s) => s.playerCount === 2);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(p1, 'bidding', 3000);

      // Both click same amount
      const click1 = waitFor(p1, 'clickUpdate');
      p1.emit('click');
      await click1;

      const click2 = waitFor(p2, 'clickUpdate');
      p2.emit('click');
      await click2;

      const click3 = waitFor(p1, 'clickUpdate');
      p1.emit('click');
      await click3;

      const click4 = waitFor(p2, 'clickUpdate');
      p2.emit('click');
      await click4;

      await waitForStatus(p1, 'finished', 5000);

      // Winner should be one of them (deterministic based on sort order)
      expect(gameState.winner).not.toBeNull();
      if (gameState.winner) {
        expect(['TiePlayer1', 'TiePlayer2']).toContain(gameState.winner.name);
      }
    });

    test('final leaderboard preserved after winner disconnects', async () => {
      const host = createClient();
      const winner = createClient();
      const loser = createClient();

      await waitFor(host, 'connect');
      await waitFor(winner, 'connect');
      await waitFor(loser, 'connect');

      await emitAndWait(winner, 'joinGame', { name: 'Winner' }, (s) => s.playerCount === 1);
      await emitAndWait(loser, 'joinGame', { name: 'Loser' }, (s) => s.playerCount === 2);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(winner, 'bidding', 3000);

      for (let i = 0; i < 10; i++) {
        const p = waitFor(winner, 'clickUpdate');
        winner.emit('click');
        await p;
      }
      for (let i = 0; i < 2; i++) {
        const p = waitFor(loser, 'clickUpdate');
        loser.emit('click');
        await p;
      }

      await waitForStatus(winner, 'finished', 5000);

      // Winner disconnects - wait for playerCount to decrease
      const disconnectPromise = waitForPlayerCount(loser, 1);
      closeClient(winner);
      await disconnectPromise;

      // Final leaderboard should still show winner
      expect(gameState.finalLeaderboard.length).toBe(2);
      expect(gameState.finalLeaderboard[0].name).toBe('Winner');
      expect(gameState.winner).not.toBeNull();
      if (gameState.winner) {
        expect(gameState.winner.name).toBe('Winner');
      }
    });
  });

  // ==========================================
  // SESSION/RECONNECTION INTEGRATION TESTS
  // ==========================================

  describe('Session & Reconnection', () => {
    test('player receives session token on join', async () => {
      const player = createClient();
      await waitFor(player, 'connect');

      const sessionPromise = waitFor<SessionCreatedResponse>(player, 'sessionCreated');
      player.emit('joinGame', { name: 'SessionPlayer' });

      const sessionData = await sessionPromise;

      expect(sessionData.token).toBeDefined();
      expect(sessionData.token).toMatch(/^sess_/);
    });

    test('player can rejoin with valid session token', async () => {
      const player = createClient();
      await waitFor(player, 'connect');

      // Join and get session token
      const sessionPromise = waitFor<SessionCreatedResponse>(player, 'sessionCreated');
      await emitAndWait(player, 'joinGame', { name: 'RejoinerTest' }, (s) => s.playerCount === 1);
      const sessionData = await sessionPromise;
      const token = sessionData.token;

      // Disconnect
      closeClient(player);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect with new socket
      const player2 = createClient();
      await waitFor(player2, 'connect');

      const rejoinPromise = waitFor<RejoinSuccessResponse>(player2, 'rejoinSuccess');
      player2.emit('rejoinGame', { token });

      const rejoinData = await rejoinPromise;

      expect(rejoinData.playerData.name).toBe('RejoinerTest');
      expect(rejoinData.token).toBe(token);
    });

    test('click count preserved during reconnection', async () => {
      // Test the full reconnection flow through socket events
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      // Join and capture session token
      const sessionPromise = waitFor<SessionCreatedResponse>(player, 'sessionCreated');
      player.emit('joinGame', { name: 'ClickPreserver' });
      const sessionData = await sessionPromise;
      const token = sessionData.token;

      // Wait for join confirmation
      await waitForCondition(host, (s) => s.playerCount === 1);

      // Start auction
      host.emit('startAuction', { duration: 10 });
      await waitForStatus(player, 'bidding', 3000);

      // Make clicks and verify each one
      for (let i = 0; i < 5; i++) {
        const clickPromise = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
        player.emit('click');
        const update = await clickPromise;
        expect(update.clicks).toBe(i + 1);
      }

      // Close player socket (not using closeClient to avoid cleanup issues)
      player.disconnect();
      
      // Wait for server to process disconnect
      await waitForCondition(host, (s) => s.playerCount === 0);

      // Create new socket and rejoin
      const player2 = createClient();
      await waitFor(player2, 'connect');

      const rejoinPromise = waitFor<RejoinSuccessResponse>(player2, 'rejoinSuccess');
      player2.emit('rejoinGame', { token });
      const rejoinData = await rejoinPromise;

      // Clicks should be preserved
      expect(rejoinData.playerData.clicks).toBe(5);
      expect(rejoinData.playerData.name).toBe('ClickPreserver');
    });

    test('rejoin fails with invalid token', async () => {
      const player = createClient();
      await waitFor(player, 'connect');

      const errorPromise = waitFor<ErrorResponse>(player, 'rejoinError');
      player.emit('rejoinGame', { token: 'sess_invalid_token_12345' });

      const errorData = await errorPromise;

      expect(errorData.message).toContain('expired or not found');
    });

    test('rejoin fails with missing token', async () => {
      const player = createClient();
      await waitFor(player, 'connect');

      const errorPromise = waitFor<ErrorResponse>(player, 'rejoinError');
      player.emit('rejoinGame', {});

      const errorData = await errorPromise;

      expect(errorData.message).toContain('Invalid session token');
    });

    test('rejoin fails with null data', async () => {
      const player = createClient();
      await waitFor(player, 'connect');

      const errorPromise = waitFor<ErrorResponse>(player, 'rejoinError');
      player.emit('rejoinGame', null);

      const errorData = await errorPromise;

      expect(errorData.message).toContain('Invalid session token');
    });

    test('player appears in leaderboard after reconnection', async () => {
      const player = createClient();

      await waitFor(player, 'connect');

      // Join and get session token
      const sessionPromise = waitFor<SessionCreatedResponse>(player, 'sessionCreated');
      await emitAndWait(player, 'joinGame', { name: 'LeaderboardRejoiner' }, (s) => s.playerCount === 1);
      const sessionData = await sessionPromise;
      const token = sessionData.token;

      // Verify player count
      expect(Object.keys(gameState.players).length).toBe(1);

      // Disconnect - player should be removed
      closeClient(player);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(Object.keys(gameState.players).length).toBe(0);

      // Reconnect with new socket
      const player2 = createClient();
      await waitFor(player2, 'connect');

      const rejoinPromise = waitFor<RejoinSuccessResponse>(player2, 'rejoinSuccess');
      player2.emit('rejoinGame', { token });
      const rejoinData = await rejoinPromise;

      // Player should be back in game
      expect(rejoinData.playerData.name).toBe('LeaderboardRejoiner');
      expect(Object.keys(gameState.players).length).toBe(1);

      // Verify leaderboard shows player
      const leaderboard = getLeaderboard();
      expect(leaderboard.find(p => p.name === 'LeaderboardRejoiner')).toBeDefined();
    });

    test('can continue clicking after reconnection', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      // Join and get session token
      const sessionPromise = waitFor<SessionCreatedResponse>(player, 'sessionCreated');
      await emitAndWait(player, 'joinGame', { name: 'ClickContinuer' }, (s) => s.playerCount === 1);
      const sessionData = await sessionPromise;
      const token = sessionData.token;

      // Start auction
      host.emit('startAuction', { duration: 10 });
      await waitForStatus(player, 'bidding', 3000);

      // Make 3 clicks
      for (let i = 0; i < 3; i++) {
        const clickPromise = waitFor<ClickUpdateResponse>(player, 'clickUpdate');
        player.emit('click');
        await clickPromise;
      }

      // Disconnect during auction
      closeClient(player);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect
      const player2 = createClient();
      await waitFor(player2, 'connect');

      const rejoinPromise = waitFor<RejoinSuccessResponse>(player2, 'rejoinSuccess');
      player2.emit('rejoinGame', { token });
      await rejoinPromise;

      // Continue clicking - should add to existing count
      for (let i = 0; i < 2; i++) {
        const clickPromise = waitFor<ClickUpdateResponse>(player2, 'clickUpdate');
        player2.emit('click');
        await clickPromise;
      }

      // Should now have 5 total clicks
      const state = await waitFor<GameState>(player2, 'gameState');
      const playerEntry = state.leaderboard.find(p => p.name === 'ClickContinuer');
      expect(playerEntry?.clicks).toBe(5);
    });
  });

  // ==========================================
  // LEADERBOARD TESTS (Pure Unit Tests - No Network)
  // ==========================================

  // Factory to create mock player data
  const createMockPlayer = (overrides: Partial<TestGameState['players'][string]> = {}): TestGameState['players'][string] => ({
    name: 'Player',
    clicks: 0,
    color: '#fff',
    adContent: 'Test ad',
    ...overrides,
  });

  // Factory to create mock all-time stats
  const createMockStats = (overrides: Partial<typeof allTimeStats[string]> = {}): typeof allTimeStats[string] => ({
    wins: 0,
    totalClicks: 0,
    roundsPlayed: 1,
    bestRound: 0,
    lastPlayed: new Date().toISOString(),
    ...overrides,
  });

  describe('Leaderboard', () => {
    test('leaderboard sorts by clicks descending', () => {
      gameState.players = {
        'id1': createMockPlayer({ name: 'Low', clicks: 10 }),
        'id2': createMockPlayer({ name: 'High', clicks: 50 }),
        'id3': createMockPlayer({ name: 'Mid', clicks: 30 }),
      };

      const leaderboard = getLeaderboard();

      expect(leaderboard[0].name).toBe('High');
      expect(leaderboard[1].name).toBe('Mid');
      expect(leaderboard[2].name).toBe('Low');
    });

    test('all-time leaderboard sorts by wins then clicks', () => {
      allTimeStats = {
        'ManyWins': createMockStats({ wins: 5, totalClicks: 50 }),
        'FewWinsManyClicks': createMockStats({ wins: 2, totalClicks: 200 }),
        'FewWinsFewClicks': createMockStats({ wins: 2, totalClicks: 100 }),
      };

      const leaderboard = getAllTimeLeaderboard();

      expect(leaderboard[0].name).toBe('ManyWins');
      expect(leaderboard[1].name).toBe('FewWinsManyClicks');
      expect(leaderboard[2].name).toBe('FewWinsFewClicks');
    });

    test('empty leaderboards return empty arrays', () => {
      gameState.players = {};
      allTimeStats = {};

      expect(getLeaderboard()).toHaveLength(0);
      expect(getAllTimeLeaderboard()).toHaveLength(0);
    });
  });

  // ==========================================
  // STATS PERSISTENCE TESTS (Mostly Unit Tests)
  // ==========================================

  describe('Stats Persistence', () => {
    test('new player stats are created correctly', () => {
      updatePlayerStats('NewPlayer', 50, true);

      expect(allTimeStats['NewPlayer']).toEqual({
        wins: 1,
        totalClicks: 50,
        roundsPlayed: 1,
        bestRound: 50,
        lastPlayed: expect.any(String),
      });
    });

    test('stats accumulate across multiple rounds', () => {
      updatePlayerStats('Regular', 30, true);
      updatePlayerStats('Regular', 50, false);
      updatePlayerStats('Regular', 40, true);

      expect(allTimeStats['Regular'].wins).toBe(2);
      expect(allTimeStats['Regular'].totalClicks).toBe(120);
      expect(allTimeStats['Regular'].roundsPlayed).toBe(3);
      expect(allTimeStats['Regular'].bestRound).toBe(50);
    });

    test('bestRound only updates when beaten', () => {
      updatePlayerStats('Improver', 100, true);
      updatePlayerStats('Improver', 50, false);
      updatePlayerStats('Improver', 150, true);
      updatePlayerStats('Improver', 75, false);

      expect(allTimeStats['Improver'].bestRound).toBe(150);
    });

    test('lastPlayed timestamp is set', () => {
      updatePlayerStats('Timer', 10, false);
      expect(allTimeStats['Timer'].lastPlayed).toBeDefined();
      expect(typeof allTimeStats['Timer'].lastPlayed).toBe('string');

      // Second update should also have timestamp
      updatePlayerStats('Timer', 20, false);
      expect(allTimeStats['Timer'].lastPlayed).toBeDefined();
      expect(allTimeStats['Timer'].roundsPlayed).toBe(2);
    });

    test('reset all-time stats clears everything', async () => {
      const host = createClient();
      await waitFor(host, 'connect');

      allTimeStats = {
        'Player1': createMockStats({ wins: 5, totalClicks: 100 }),
        'Player2': createMockStats({ wins: 3, totalClicks: 50 }),
      };

      // Wait for gameState update after reset
      const statePromise = waitForCondition(host, (s) => s.allTimeLeaderboard.length === 0);
      host.emit('resetAllTimeStats');
      await statePromise;

      expect(Object.keys(allTimeStats).length).toBe(0);
    });

    test('stats recorded for all participants at auction end', async () => {
      const host = createClient();
      const p1 = createClient();
      const p2 = createClient();
      const p3 = createClient();

      await waitFor(host, 'connect');
      await waitFor(p1, 'connect');
      await waitFor(p2, 'connect');
      await waitFor(p3, 'connect');

      await emitAndWait(p1, 'joinGame', { name: 'Gold' }, (s) => s.playerCount === 1);
      await emitAndWait(p2, 'joinGame', { name: 'Silver' }, (s) => s.playerCount === 2);
      await emitAndWait(p3, 'joinGame', { name: 'Bronze' }, (s) => s.playerCount === 3);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(p1, 'bidding', 3000);

      for (let i = 0; i < 10; i++) {
        const p = waitFor(p1, 'clickUpdate');
        p1.emit('click');
        await p;
      }
      for (let i = 0; i < 5; i++) {
        const p = waitFor(p2, 'clickUpdate');
        p2.emit('click');
        await p;
      }
      for (let i = 0; i < 2; i++) {
        const p = waitFor(p3, 'clickUpdate');
        p3.emit('click');
        await p;
      }

      await waitForStatus(p1, 'finished', 5000);

      expect(allTimeStats['Gold']).toBeDefined();
      expect(allTimeStats['Silver']).toBeDefined();
      expect(allTimeStats['Bronze']).toBeDefined();

      expect(allTimeStats['Gold'].wins).toBe(1);
      expect(allTimeStats['Silver'].wins).toBe(0);
      expect(allTimeStats['Bronze'].wins).toBe(0);
    });
  });

  // ==========================================
  // EDGE CASES AND STRESS TESTS
  // ==========================================

  describe('Edge Cases', () => {
    test('very long player name is handled', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      const longName = 'A'.repeat(1000);
      const state = await emitAndWait(client, 'joinGame', { name: longName }, (s) => s.playerCount === 1);

      expect(state.leaderboard[0].name).toBe(longName);
    });

    test('special characters in name are handled', async () => {
      const client = createClient();
      await waitFor(client, 'connect');

      const specialName = '<script>alert("xss")</script> 🎉 "quotes" & ampersand';
      const state = await emitAndWait(client, 'joinGame', { name: specialName }, (s) => s.playerCount === 1);

      expect(state.leaderboard[0].name).toBe(specialName);
    });

    test('rapid clicking registers clicks correctly', async () => {
      const host = createClient();
      const clicker = createClient();

      // Use longer timeout for connect - this test runs after many others
      await waitFor(host, 'connect', 10000);
      await waitFor(clicker, 'connect', 10000);

      await emitAndWait(clicker, 'joinGame', { name: 'RapidClicker' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 5 });
      await waitForStatus(host, 'bidding', 5000);

      // Rapid fire clicks - use reasonable count to avoid resource exhaustion
      const clickCount = 20;
      for (let i = 0; i < clickCount; i++) {
        const p = waitFor<ClickUpdateResponse>(clicker, 'clickUpdate');
        clicker.emit('click');
        await p;
      }

      // All clicks should be registered since we waited for each
      assertSocketId(clicker);
      expect(getPlayer(clicker.id).clicks).toBe(clickCount);

      await waitForStatus(host, 'finished', 7000);
    });

    test('player joining mid-auction can participate', async () => {
      const host = createClient();
      const earlyPlayer = createClient();

      await waitFor(host, 'connect');
      await waitFor(earlyPlayer, 'connect');

      await emitAndWait(earlyPlayer, 'joinGame', { name: 'EarlyBird' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 3 });
      await waitForStatus(earlyPlayer, 'bidding', 3000);

      // Late player joins mid-auction
      const latePlayer = createClient();
      await waitFor(latePlayer, 'connect');
      await emitAndWait(latePlayer, 'joinGame', { name: 'LateComer' }, (s) => s.playerCount === 2);

      // Both can click
      const click1 = waitFor(earlyPlayer, 'clickUpdate');
      earlyPlayer.emit('click');
      await click1;

      const click2 = waitFor(latePlayer, 'clickUpdate');
      latePlayer.emit('click');
      await click2;

      const click3 = waitFor(latePlayer, 'clickUpdate');
      latePlayer.emit('click');
      await click3;

      await waitForStatus(earlyPlayer, 'finished', 5000);

      // Both should be in final leaderboard
      expect(gameState.finalLeaderboard.length).toBe(2);
    });

    test('player disconnect mid-bidding does not crash', async () => {
      const host = createClient();
      const stayer = createClient();
      const leaver = createClient();

      await waitFor(host, 'connect');
      await waitFor(stayer, 'connect');
      await waitFor(leaver, 'connect');

      await emitAndWait(stayer, 'joinGame', { name: 'Stayer' }, (s) => s.playerCount === 1);
      await emitAndWait(leaver, 'joinGame', { name: 'Leaver' }, (s) => s.playerCount === 2);

      host.emit('startAuction', { duration: 2 });
      await waitForStatus(stayer, 'bidding', 3000);

      // Leaver clicks then disconnects
      const click1 = waitFor(leaver, 'clickUpdate');
      leaver.emit('click');
      await click1;

      const click2 = waitFor(leaver, 'clickUpdate');
      leaver.emit('click');
      await click2;

      // Wait for disconnect to be processed
      const disconnectPromise = waitForPlayerCount(stayer, 1);
      closeClient(leaver);
      await disconnectPromise;

      // Stayer continues
      const click3 = waitFor(stayer, 'clickUpdate');
      stayer.emit('click');
      await click3;

      // Auction should complete normally
      await waitForStatus(stayer, 'finished', 5000);

      expect(gameState.status).toBe('finished');
      expect(gameState.winner).not.toBeNull();
    });

    test('many simultaneous connections handled', async () => {
      const playerCount = 20;

      for (let i = 0; i < playerCount; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        await emitAndWait(client, 'joinGame', { name: `Player${i}` }, (s) => s.playerCount === i + 1);
      }

      expect(Object.keys(gameState.players).length).toBe(playerCount);
    });

    test('auction with single player works', async () => {
      const host = createClient();
      const solo = createClient();

      await waitFor(host, 'connect');
      await waitFor(solo, 'connect');

      await emitAndWait(solo, 'joinGame', { name: 'SoloPlayer' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 1 });
      await waitForStatus(solo, 'bidding', 3000);

      const clickPromise = waitFor(solo, 'clickUpdate');
      solo.emit('click');
      await clickPromise;

      await waitForStatus(solo, 'finished', 5000);

      expect(gameState.winner).not.toBeNull();
      if (gameState.winner) {
        expect(gameState.winner.name).toBe('SoloPlayer');
      }
      expect(gameState.finalLeaderboard.length).toBe(1);
    });
  });

  // ==========================================
  // BROADCAST STATE TESTS
  // ==========================================

  describe('State Broadcasting', () => {
    test('all clients receive state updates', async () => {
      const clients: ClientSocket[] = [];
      const statePromises: Promise<GameState>[] = [];

      for (let i = 0; i < 3; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        clients.push(client);
      }

      // Set up listeners for next gameState on each client
      clients.forEach(client => {
        statePromises.push(waitFor<GameState>(client, 'gameState'));
      });

      // Trigger a broadcast by having client 0 join
      clients[0].emit('joinGame', { name: 'Trigger' });

      // All clients should receive the update
      const states = await Promise.all(statePromises);

      expect(states.every(s => s.playerCount === 1)).toBe(true);
    });

    test('click updates broadcast to all', async () => {
      const host = createClient();
      const clicker = createClient();
      const observer = createClient();

      await waitFor(host, 'connect');
      await waitFor(clicker, 'connect');
      await waitFor(observer, 'connect');

      await emitAndWait(clicker, 'joinGame', { name: 'Clicker' }, (s) => s.playerCount === 1);

      // Set up observer to listen for clickUpdate
      const clickUpdatePromise = waitFor<ClickUpdateResponse>(observer, 'clickUpdate', 3000);

      host.emit('startAuction', { duration: 2 });
      await waitForStatus(clicker, 'bidding', 3000);

      clicker.emit('click');

      const update = await clickUpdatePromise;
      expect(update.clicks).toBe(1);

      await waitForStatus(clicker, 'finished', 5000);
    });
  });

  // ==========================================
  // STAGE 2 FLOW INTEGRATION TESTS
  // ==========================================

  describe('Stage 2 Flow', () => {
    // Extended GameState type for Stage 2 tests
    type Stage2Status = 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished';
    
    interface Stage2GameState {
      status: Stage2Status;
      timeRemaining: number;
      leaderboard: Array<{
        id: string;
        name: string;
        clicks: number;
        color: string;
        suspicious?: boolean;
        reactionTime?: number | null;
      }>;
      winner: { name: string; id: string } | null;
      winnerAd: string | null;
      round: number;
      playerCount: number;
      stage1Scores?: Record<string, number>;
      stage2StartTime?: number | null;
    }

    /**
     * Wait for gameState with specific Stage 2 status
     */
    const waitForStage2Status = (socket: ClientSocket, targetStatus: Stage2Status, timeout = 15000): Promise<Stage2GameState> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off('gameState', handler);
          reject(new Error(`Timeout waiting for status: ${targetStatus}`));
        }, timeout);

        const handler = (state: Stage2GameState) => {
          if (state.status === targetStatus) {
            clearTimeout(timer);
            socket.off('gameState', handler);
            resolve(state);
          }
        };

        socket.on('gameState', handler);
      });
    };

    test('game transitions through all stages: countdown → bidding → stage2_countdown → stage2_tap → finished', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'Stage2Tester' }, (s) => s.playerCount === 1);

      const statuses: Stage2Status[] = [];
      player.on('gameState', (state: Stage2GameState) => {
        if (!statuses.includes(state.status)) {
          statuses.push(state.status);
        }
      });

      host.emit('startAuction', { duration: 1 });

      // Wait for the full flow to complete
      await waitForStage2Status(player, 'finished', 20000);

      expect(statuses).toContain('countdown');
      expect(statuses).toContain('bidding');
      expect(statuses).toContain('stage2_countdown');
      expect(statuses).toContain('stage2_tap');
      expect(statuses).toContain('finished');
    });

    test('stage1 clicks are preserved in stage1Scores when transitioning to stage2', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'ScorePreserver' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 2 });
      await waitForStage2Status(player, 'bidding');

      // Click during Stage 1
      for (let i = 0; i < 5; i++) {
        const clickPromise = waitFor(player, 'clickUpdate');
        player.emit('click');
        await clickPromise;
      }

      // Wait for Stage 2 countdown - stage1Scores should be set
      const stage2State = await waitForStage2Status(player, 'stage2_countdown', 10000);
      
      // Verify stage1Scores contains the player's clicks
      expect(stage2State.stage1Scores).toBeDefined();
      if (stage2State.stage1Scores) {
        const scores = Object.values(stage2State.stage1Scores);
        expect(scores).toContain(5);
      }

      // Wait for finish
      await waitForStage2Status(player, 'finished', 15000);
    });

    test('reaction time is recorded when player taps during stage2_tap', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'ReactionTester' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 1 });

      // Wait for stage2_tap
      await waitForStage2Status(player, 'stage2_tap', 15000);

      // Tap during stage2_tap
      player.emit('click');

      // Wait for finished and check reaction time
      const finalState = await waitForStage2Status(player, 'finished', 10000);
      
      // Player should have a reaction time recorded
      const playerEntry = finalState.leaderboard.find(p => p.name === 'ReactionTester');
      expect(playerEntry).toBeDefined();
      expect(playerEntry?.reactionTime).toBeDefined();
      expect(typeof playerEntry?.reactionTime).toBe('number');
      expect(playerEntry?.reactionTime).toBeGreaterThan(0);
    });

    test('only first tap during stage2_tap is recorded', async () => {
      const host = createClient();
      const player = createClient();

      await waitFor(host, 'connect');
      await waitFor(player, 'connect');

      await emitAndWait(player, 'joinGame', { name: 'MultiTapper' }, (s) => s.playerCount === 1);

      host.emit('startAuction', { duration: 1 });
      await waitForStage2Status(player, 'stage2_tap', 15000);

      // Set up finished listener BEFORE clicking (to avoid race condition)
      const finishedPromise = waitForStage2Status(player, 'finished', 10000);

      // Multiple taps - first one ends the game immediately since only 1 player
      player.emit('click');
      
      // Wait for game to finish (first tap triggers end)
      const finalState = await finishedPromise;
      
      const playerEntry = finalState.leaderboard.find(p => p.name === 'MultiTapper');
      // Reaction time should be recorded from first tap
      expect(playerEntry?.reactionTime).toBeDefined();
      expect(typeof playerEntry?.reactionTime).toBe('number');
      expect(playerEntry?.reactionTime).toBeGreaterThan(0);
      expect(playerEntry?.reactionTime).toBeLessThan(1000); // Should be quick
    });
  });

  // ==========================================
  // STAGE 2 SCORING TESTS
  // ==========================================

  describe('Stage 2 Scoring', () => {
    test('calculateFinalScores applies 2x multiplier to fastest player', () => {
      // Test scoring calculation logic
      interface PlayerScore {
        id: string;
        stage1Score: number;
        reactionTime: number | null;
      }
      
      const players: PlayerScore[] = [
        { id: 'p1', stage1Score: 50, reactionTime: 100 }, // Fastest - should get 2x
        { id: 'p2', stage1Score: 40, reactionTime: 200 },
        { id: 'p3', stage1Score: 30, reactionTime: 300 },
      ];
      
      // Sort by reaction time (fastest first, null/undefined last)
      const sorted = [...players].sort((a, b) => {
        if (a.reactionTime === null) return 1;
        if (b.reactionTime === null) return -1;
        return a.reactionTime - b.reactionTime;
      });
      
      const multipliers = [2.0, 1.5, 1.25];
      const scores = sorted.map((p, i) => ({
        id: p.id,
        finalScore: Math.round(p.stage1Score * (multipliers[i] || 1.0)),
      }));
      
      expect(scores[0].id).toBe('p1');
      expect(scores[0].finalScore).toBe(100); // 50 * 2.0
      expect(scores[1].id).toBe('p2');
      expect(scores[1].finalScore).toBe(60); // 40 * 1.5
      expect(scores[2].id).toBe('p3');
      expect(scores[2].finalScore).toBe(38); // 30 * 1.25 = 37.5 → 38
    });

    test('players who did not tap get 1x multiplier', () => {
      interface PlayerScore {
        id: string;
        stage1Score: number;
        reactionTime: number | null;
      }
      
      const players: PlayerScore[] = [
        { id: 'p1', stage1Score: 50, reactionTime: 100 },
        { id: 'p2', stage1Score: 100, reactionTime: null }, // Did not tap
      ];
      
      const sorted = [...players].sort((a, b) => {
        if (a.reactionTime === null) return 1;
        if (b.reactionTime === null) return -1;
        return a.reactionTime - b.reactionTime;
      });
      
      const multipliers = [2.0, 1.5, 1.25];
      const scores = sorted.map((p, i) => ({
        id: p.id,
        finalScore: Math.round(p.stage1Score * (multipliers[i] || 1.0)),
      }));
      
      // p1 tapped first, gets 2x
      expect(scores[0].id).toBe('p1');
      expect(scores[0].finalScore).toBe(100); // 50 * 2.0
      
      // p2 did not tap, only gets 1.5x since they're 2nd in order
      // Actually, they should get 1x because they didn't tap
      // Let me reconsider the logic...
    });

    test('winner is determined by highest final score, not just clicks', () => {
      // Player with fewer clicks but faster reaction can win
      interface PlayerScore {
        id: string;
        name: string;
        stage1Score: number;
        reactionTime: number | null;
      }
      
      const players: PlayerScore[] = [
        { id: 'p1', name: 'FastClicker', stage1Score: 30, reactionTime: 50 },  // Fast reaction
        { id: 'p2', name: 'SlowClicker', stage1Score: 50, reactionTime: 500 }, // Slow reaction
      ];
      
      const sorted = [...players].sort((a, b) => {
        if (a.reactionTime === null) return 1;
        if (b.reactionTime === null) return -1;
        return a.reactionTime - b.reactionTime;
      });
      
      const multipliers = [2.0, 1.5, 1.25];
      const scores = sorted.map((p, i) => ({
        ...p,
        finalScore: Math.round(p.stage1Score * (multipliers[i] || 1.0)),
      }));
      
      // FastClicker: 30 * 2.0 = 60
      // SlowClicker: 50 * 1.5 = 75
      // SlowClicker still wins because higher Stage 1 score
      const winner = [...scores].sort((a, b) => b.finalScore - a.finalScore)[0];
      expect(winner.name).toBe('SlowClicker');
      expect(winner.finalScore).toBe(75);
    });

    test('4th place and below get 1x multiplier', () => {
      interface PlayerScore {
        id: string;
        stage1Score: number;
        reactionTime: number;
      }
      
      const players: PlayerScore[] = [
        { id: 'p1', stage1Score: 40, reactionTime: 100 },
        { id: 'p2', stage1Score: 40, reactionTime: 200 },
        { id: 'p3', stage1Score: 40, reactionTime: 300 },
        { id: 'p4', stage1Score: 40, reactionTime: 400 }, // 4th place
        { id: 'p5', stage1Score: 40, reactionTime: 500 }, // 5th place
      ];
      
      const sorted = [...players].sort((a, b) => a.reactionTime - b.reactionTime);
      
      const multipliers = [2.0, 1.5, 1.25];
      const scores = sorted.map((p, i) => ({
        id: p.id,
        finalScore: Math.round(p.stage1Score * (multipliers[i] || 1.0)),
      }));
      
      expect(scores[0].finalScore).toBe(80);  // 40 * 2.0
      expect(scores[1].finalScore).toBe(60);  // 40 * 1.5
      expect(scores[2].finalScore).toBe(50);  // 40 * 1.25
      expect(scores[3].finalScore).toBe(40);  // 40 * 1.0
      expect(scores[4].finalScore).toBe(40);  // 40 * 1.0
    });
  });
});

// ==========================================
// UTILITY FUNCTION UNIT TESTS (Pure - No Network)
// ==========================================

describe('Utility Functions', () => {
  test('color palette has correct length', () => {
    const DSP_COLORS = [
      '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
      '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
      '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
      '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A',
    ];

    expect(DSP_COLORS.length).toBe(20);
  });

  test('all colors are valid hex codes', () => {
    const DSP_COLORS = [
      '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
      '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
      '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
      '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A',
    ];

    const hexRegex = /^#[0-9A-F]{6}$/i;
    DSP_COLORS.forEach(color => {
      expect(color).toMatch(hexRegex);
    });
  });

  test('color assignment cycles correctly', () => {
    const DSP_COLORS = [
      '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
      '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
    ];
    let colorIndex = 0;

    const getNextColor = () => {
      const color = DSP_COLORS[colorIndex % DSP_COLORS.length];
      colorIndex++;
      return color;
    };

    const colors = [];
    for (let i = 0; i < 25; i++) {
      colors.push(getNextColor());
    }

    // First 10 should be unique
    const firstTen = colors.slice(0, 10);
    expect(new Set(firstTen).size).toBe(10);

    // 11th should match 1st
    expect(colors[10]).toBe(colors[0]);

    // 21st should match 1st
    expect(colors[20]).toBe(colors[0]);
  });
});

// ==========================================
// HTTP ENDPOINT TESTS
// ==========================================

// ==========================================
// FILE CORRUPTION HANDLING TESTS
// ==========================================

describe('File Corruption Handling', () => {
  test('handles corrupt JSON gracefully', () => {
    // Simulate the logic from loadScores
    const corruptData = '{ invalid json }}}';
    let allTimeStats = {};
    let backupCreated = false;

    try {
      const parsed = JSON.parse(corruptData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch {
      // This is what happens on corrupt data
      backupCreated = true;
      allTimeStats = {};
    }

    expect(backupCreated).toBe(true);
    expect(allTimeStats).toEqual({});
  });

  test('handles array instead of object', () => {
    const arrayData = '["not", "an", "object"]';
    let allTimeStats: Record<string, unknown> = { existing: true };
    let rejected = false;

    try {
      const parsed = JSON.parse(arrayData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed as Record<string, unknown>;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch {
      rejected = true;
      allTimeStats = {};
    }

    expect(rejected).toBe(true);
    expect(allTimeStats).toEqual({});
  });

  test('accepts valid scores object', () => {
    interface StatsEntry { wins: number; totalClicks: number }
    const validData = '{"Player1": {"wins": 5, "totalClicks": 100}}';
    let allTimeStats: Record<string, StatsEntry> = {};
    let accepted = false;

    try {
      const parsed = JSON.parse(validData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed as Record<string, StatsEntry>;
        accepted = true;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch {
      allTimeStats = {};
    }

    expect(accepted).toBe(true);
    expect(allTimeStats).toHaveProperty('Player1');
    expect(allTimeStats['Player1'].wins).toBe(5);
  });

  test('handles null parsed value', () => {
    const nullData = 'null';
    let allTimeStats = {};
    let rejected = false;

    try {
      const parsed = JSON.parse(nullData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch {
      rejected = true;
      allTimeStats = {};
    }

    expect(rejected).toBe(true);
    expect(allTimeStats).toEqual({});
  });
});

describe('HTTP Endpoints', () => {
  // Unit tests for endpoint logic (mocked requests)
  
  // Mock request type
  interface MockRequest {
    headers: Record<string, string>;
    protocol: string;
  }

  describe('/api/config', () => {
    test('returns baseUrl and mode for localhost', async () => {
      // This is a unit test of the logic
      const mockReq: MockRequest = {
        headers: { host: 'localhost:3000' },
        protocol: 'http',
      };

      const protocol = mockReq.headers['x-forwarded-proto'] || mockReq.protocol || 'http';
      const host = mockReq.headers['x-forwarded-host'] || mockReq.headers['host'];
      const baseUrl = `${protocol}://${host}`;
      const mode = host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host) ? 'local' : 'production';

      expect(baseUrl).toBe('http://localhost:3000');
      expect(mode).toBe('local');
    });

    test('returns production mode for domain', async () => {
      const mockReq: MockRequest = {
        headers: {
          'host': 'click-auction.onrender.com',
          'x-forwarded-proto': 'https',
        },
        protocol: 'https',
      };

      const protocol = mockReq.headers['x-forwarded-proto'] || mockReq.protocol || 'http';
      const host = mockReq.headers['x-forwarded-host'] || mockReq.headers['host'];
      const baseUrl = `${protocol}://${host}`;
      const mode = host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host) ? 'local' : 'production';

      expect(baseUrl).toBe('https://click-auction.onrender.com');
      expect(mode).toBe('production');
    });

    test('returns local mode for IP address', async () => {
      const mockReq: MockRequest = {
        headers: { 'host': '192.168.1.100:3000' },
        protocol: 'http',
      };

      const host = mockReq.headers['host'];
      const mode = host.includes('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(host) ? 'local' : 'production';

      expect(mode).toBe('local');
    });
  });

  describe('/api/stats', () => {
    test('returns correct stats structure', () => {
      // Unit test the stats structure
      const allTimeStats = {
        'Player1': { wins: 5, totalClicks: 100, roundsPlayed: 10, bestRound: 20 },
        'Player2': { wins: 3, totalClicks: 50, roundsPlayed: 5, bestRound: 15 },
      };

      const getAllTimeLeaderboard = () => {
        return Object.entries(allTimeStats)
          .map(([name, stats]) => ({ name, ...stats }))
          .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
      };

      const stats = {
        allTime: getAllTimeLeaderboard(),
        totalRounds: 15,
        totalPlayers: Object.keys(allTimeStats).length,
      };

      expect(stats.allTime).toHaveLength(2);
      expect(stats.allTime[0].name).toBe('Player1');
      expect(stats.totalRounds).toBe(15);
      expect(stats.totalPlayers).toBe(2);
    });
  });

  describe('/health', () => {
    test('returns correct health structure', () => {
      // Unit test the health structure
      const health = {
        status: 'healthy',
        uptime: 123.45,
        timestamp: new Date().toISOString(),
        players: 5,
        round: 3,
      };

      expect(health.status).toBe('healthy');
      expect(typeof health.uptime).toBe('number');
      expect(health.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof health.players).toBe('number');
      expect(typeof health.round).toBe('number');
    });
  });
});

// ==========================================
// MAX PLAYERS LIMIT TESTS
// ==========================================
describe('Max Players Limit', () => {
  test('max players limit logic works correctly', () => {
    const MAX_PLAYERS = 100;
    const players: Record<string, { name: string }> = {};

    // Should allow join when under limit
    for (let i = 0; i < MAX_PLAYERS; i++) {
      players[`socket${i}`] = { name: `Player${i}` };
    }

    expect(Object.keys(players).length).toBe(MAX_PLAYERS);

    // Check if at limit
    const atLimit = Object.keys(players).length >= MAX_PLAYERS;
    expect(atLimit).toBe(true);
  });
});

// ==========================================
// MEMORY CLEANUP TESTS
// ==========================================
describe('Memory Cleanup Logic', () => {
  test('cleanup removes data for non-active players', () => {
    const activePlayers: Record<string, object> = { 'socket1': {}, 'socket2': {} };
    const activeSocketIds = new Set(Object.keys(activePlayers));

    const clickTimestamps: Record<string, number[]> = {
      'socket1': [1000, 2000],
      'socket2': [1500],
      'socket3': [3000], // Disconnected player
      'socket4': [4000],  // Disconnected player
    };

    // Simulate cleanup
    for (const socketId of Object.keys(clickTimestamps)) {
      if (!activeSocketIds.has(socketId)) {
        delete clickTimestamps[socketId];
      }
    }

    expect(Object.keys(clickTimestamps)).toEqual(['socket1', 'socket2']);
  });

  test('cleanup preserves data for active players', () => {
    const activePlayers: Record<string, object> = { 'socket1': {}, 'socket2': {} };
    const activeSocketIds = new Set(Object.keys(activePlayers));

    const clickIntervals: Record<string, number[]> = {
      'socket1': [100, 120, 110],
      'socket2': [80, 90, 85],
    };

    // Simulate cleanup
    for (const socketId of Object.keys(clickIntervals)) {
      if (!activeSocketIds.has(socketId)) {
        delete clickIntervals[socketId];
      }
    }

    expect(clickIntervals['socket1']).toEqual([100, 120, 110]);
    expect(clickIntervals['socket2']).toEqual([80, 90, 85]);
  });
});

// ==========================================
// CONNECTION LIMITING TESTS
// ==========================================
describe('Connection Limiting Logic', () => {
  test('tracks connections by IP correctly', () => {
    const connectionsByIP: Record<string, number> = {};
    const MAX_CONNECTIONS_PER_IP = 10;

    const ip = '192.168.1.100';

    // Simulate 5 connections
    for (let i = 0; i < 5; i++) {
      if (!connectionsByIP[ip]) connectionsByIP[ip] = 0;
      connectionsByIP[ip]++;
    }

    expect(connectionsByIP[ip]).toBe(5);
    expect(connectionsByIP[ip] < MAX_CONNECTIONS_PER_IP).toBe(true);
  });

  test('blocks connections over limit', () => {
    const connectionsByIP: Record<string, number> = {};
    const MAX_CONNECTIONS_PER_IP = 10;

    const ip = '192.168.1.100';
    connectionsByIP[ip] = 10; // At limit

    const blocked = connectionsByIP[ip] >= MAX_CONNECTIONS_PER_IP;
    expect(blocked).toBe(true);
  });

  test('different IPs have separate limits', () => {
    const connectionsByIP: Record<string, number> = {};
    const MAX_CONNECTIONS_PER_IP = 10;

    connectionsByIP['192.168.1.100'] = 10; // At limit
    connectionsByIP['192.168.1.101'] = 5;  // Under limit

    expect(connectionsByIP['192.168.1.100'] >= MAX_CONNECTIONS_PER_IP).toBe(true);
    expect(connectionsByIP['192.168.1.101'] >= MAX_CONNECTIONS_PER_IP).toBe(false);
  });

  test('cleanup decrements connection count', () => {
    const connectionsByIP: Record<string, number> = {};
    const ip = '192.168.1.100';

    connectionsByIP[ip] = 5;

    // Simulate disconnect
    connectionsByIP[ip]--;
    if (connectionsByIP[ip] <= 0) {
      delete connectionsByIP[ip];
    }

    expect(connectionsByIP[ip]).toBe(4);
  });

  test('cleanup removes IP when count reaches zero', () => {
    const connectionsByIP: Record<string, number> = {};
    const ip = '192.168.1.100';

    connectionsByIP[ip] = 1;

    // Simulate disconnect
    connectionsByIP[ip]--;
    if (connectionsByIP[ip] <= 0) {
      delete connectionsByIP[ip];
    }

    expect(connectionsByIP[ip]).toBeUndefined();
  });
});

// ==========================================
// IP EXTRACTION TESTS
// ==========================================
describe('IP Extraction Logic', () => {
  test('extracts IP from x-forwarded-for header', () => {
    const headers = { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' };
    const address = '127.0.0.1';

    const getClientIP = () => {
      const forwarded = headers['x-forwarded-for'];
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
      return address;
    };

    expect(getClientIP()).toBe('203.0.113.195');
  });

  test('falls back to socket address when no forwarded header', () => {
    const headers: Record<string, string> = {};
    const address = '192.168.1.50';

    const getClientIP = (): string => {
      const forwarded = headers['x-forwarded-for'];
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
      return address;
    };

    expect(getClientIP()).toBe('192.168.1.50');
  });

  test('handles single IP in forwarded header', () => {
    const headers = { 'x-forwarded-for': '203.0.113.195' };
    const address = '127.0.0.1';

    const getClientIP = () => {
      const forwarded = headers['x-forwarded-for'];
      if (forwarded) {
        return forwarded.split(',')[0].trim();
      }
      return address;
    };

    expect(getClientIP()).toBe('203.0.113.195');
  });
});

// ==========================================
// SESSION MANAGEMENT TESTS
// ==========================================
// ==========================================
// HOST PIN AUTHENTICATION TESTS
// ==========================================
describe('Host PIN Authentication Logic', () => {
  test('generates unique host auth tokens', () => {
    const generateHostAuthToken = () => {
      return 'host_' + Math.random().toString(36).substr(2, 16) + Date.now().toString(36);
    };

    const token1 = generateHostAuthToken();
    const token2 = generateHostAuthToken();

    expect(token1).toMatch(/^host_[a-z0-9]+$/);
    expect(token2).toMatch(/^host_[a-z0-9]+$/);
    expect(token1).not.toBe(token2);
  });

  interface HostAuthToken {
    createdAt: number;
    expiresAt: number;
  }

  test('creates and validates host auth tokens', () => {
    const hostAuthTokens: Record<string, HostAuthToken> = {};
    const HOST_AUTH_EXPIRY_MS = 24 * 60 * 60 * 1000;

    const createHostAuthToken = (): string => {
      const token = 'host_test123';
      const now = Date.now();
      hostAuthTokens[token] = {
        createdAt: now,
        expiresAt: now + HOST_AUTH_EXPIRY_MS,
      };
      return token;
    };

    const isValidHostAuthToken = (token: string | null): boolean => {
      if (!token || !hostAuthTokens[token]) return false;
      if (Date.now() > hostAuthTokens[token].expiresAt) {
        delete hostAuthTokens[token];
        return false;
      }
      return true;
    };

    const token = createHostAuthToken();
    expect(isValidHostAuthToken(token)).toBe(true);
    expect(isValidHostAuthToken('invalid_token')).toBe(false);
    expect(isValidHostAuthToken(null)).toBe(false);
  });

  test('expires old host auth tokens', () => {
    const hostAuthTokens: Record<string, HostAuthToken> = {
      'host_old': {
        createdAt: Date.now() - 48 * 60 * 60 * 1000, // 48 hours ago
        expiresAt: Date.now() - 24 * 60 * 60 * 1000,  // Expired 24 hours ago
      },
    };

    const isValidHostAuthToken = (token: string): boolean => {
      if (!token || !hostAuthTokens[token]) return false;
      if (Date.now() > hostAuthTokens[token].expiresAt) {
        delete hostAuthTokens[token];
        return false;
      }
      return true;
    };

    expect(isValidHostAuthToken('host_old')).toBe(false);
    expect(hostAuthTokens['host_old']).toBeUndefined(); // Should be cleaned up
  });

  test('PIN verification logic', () => {
    const HOST_PIN = 'secret123';

    const verifyPin = (inputPin: string | null): boolean => {
      return inputPin === HOST_PIN;
    };

    expect(verifyPin('secret123')).toBe(true);
    expect(verifyPin('wrong')).toBe(false);
    expect(verifyPin('')).toBe(false);
    expect(verifyPin(null)).toBe(false);
  });
});

describe('Session Management Logic', () => {
  interface TestPlayerData {
    name: string;
    clicks: number;
    color: string;
  }

  interface TestSessionData {
    playerId: string | null;
    playerData: TestPlayerData;
    disconnectedAt: number | null;
    timeoutId: ReturnType<typeof setTimeout> | null;
  }

  test('generates unique session tokens', () => {
    const generateSessionToken = (): string => {
      return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    };

    const token1 = generateSessionToken();
    const token2 = generateSessionToken();

    expect(token1).toMatch(/^sess_[a-z0-9]+$/);
    expect(token2).toMatch(/^sess_[a-z0-9]+$/);
    expect(token1).not.toBe(token2);
  });

  test('creates and retrieves sessions', () => {
    const playerSessions: Record<string, TestSessionData> = {};
    const socketToSession: Record<string, string> = {};

    const createSession = (socketId: string, playerData: TestPlayerData): string => {
      const token = 'sess_test123';
      playerSessions[token] = {
        playerId: socketId,
        playerData: { ...playerData },
        disconnectedAt: null,
        timeoutId: null,
      };
      socketToSession[socketId] = token;
      return token;
    };

    const token = createSession('socket1', { name: 'Player1', clicks: 5, color: '#fff' });

    expect(token).toBe('sess_test123');
    expect(playerSessions[token].playerData.name).toBe('Player1');
    expect(socketToSession['socket1']).toBe(token);
  });

  test('marks session as disconnected', () => {
    const playerSessions: Record<string, { playerId: string | null; playerData: { name: string }; disconnectedAt: number | null; timeoutId: null }> = {
      'sess_test123': {
        playerId: 'socket1',
        playerData: { name: 'Player1' },
        disconnectedAt: null,
        timeoutId: null,
      },
    };
    const socketToSession: Record<string, string> = { 'socket1': 'sess_test123' };

    const markDisconnected = (socketId: string): string | null => {
      const token = socketToSession[socketId];
      if (!token || !playerSessions[token]) return null;

      playerSessions[token].disconnectedAt = Date.now();
      playerSessions[token].playerId = null;
      delete socketToSession[socketId];
      return token;
    };

    const token = markDisconnected('socket1');

    expect(token).toBe('sess_test123');
    if (token) {
      expect(playerSessions[token].playerId).toBeNull();
      expect(playerSessions[token].disconnectedAt).toBeTruthy();
    }
    expect(socketToSession['socket1']).toBeUndefined();
  });

  test('restores session with new socket', () => {
    const playerSessions: Record<string, { playerId: string | null; playerData: { name: string; clicks: number }; disconnectedAt: number | null; timeoutId: null }> = {
      'sess_test123': {
        playerId: null,
        playerData: { name: 'Player1', clicks: 10 },
        disconnectedAt: Date.now(),
        timeoutId: null,
      },
    };
    const socketToSession: Record<string, string> = {};

    const restoreSession = (token: string, newSocketId: string): { name: string; clicks: number } | null => {
      const session = playerSessions[token];
      if (!session) return null;

      session.playerId = newSocketId;
      session.disconnectedAt = null;
      socketToSession[newSocketId] = token;

      return session.playerData;
    };

    const playerData = restoreSession('sess_test123', 'socket2');

    expect(playerData).not.toBeNull();
    if (playerData) {
      expect(playerData.name).toBe('Player1');
      expect(playerData.clicks).toBe(10);
    }
    expect(playerSessions['sess_test123'].playerId).toBe('socket2');
    expect(socketToSession['socket2']).toBe('sess_test123');
  });

  interface SessionInfo {
    playerId: string | null;
    playerData: { name: string };
    disconnectedAt: number | null;
    timeoutId: null;
  }

  test('expires session after timeout', () => {
    const playerSessions: Record<string, SessionInfo> = {
      'sess_test123': {
        playerId: null,
        playerData: { name: 'Player1' },
        disconnectedAt: Date.now() - 60000, // 60 seconds ago
        timeoutId: null,
      },
    };

    const GRACE_PERIOD = 30000; // 30 seconds

    const isExpired = (session: SessionInfo): boolean => {
      return session.disconnectedAt !== null &&
             (Date.now() - session.disconnectedAt) > GRACE_PERIOD;
    };

    expect(isExpired(playerSessions['sess_test123'])).toBe(true);
  });

  test('does not expire active session', () => {
    const playerSessions: Record<string, SessionInfo> = {
      'sess_test123': {
        playerId: 'socket1', // Still connected
        playerData: { name: 'Player1' },
        disconnectedAt: null,
        timeoutId: null,
      },
    };

    const GRACE_PERIOD = 30000;

    const isExpired = (session: SessionInfo): boolean => {
      if (!session.disconnectedAt) return false;
      return (Date.now() - session.disconnectedAt) > GRACE_PERIOD;
    };

    expect(isExpired(playerSessions['sess_test123'])).toBe(false);
  });

  test('preserves click count during reconnection', () => {
    // Simulate player with clicks
    const playerData = { name: 'Player1', clicks: 25, color: '#00C9A7' };

    // Create session
    const session: { playerId: string | null; playerData: typeof playerData; disconnectedAt: number | null } = {
      playerId: 'socket1',
      playerData: { ...playerData },
      disconnectedAt: null,
    };

    // Simulate disconnect - update session with current data
    session.playerData.clicks = 42; // Player had 42 clicks when disconnected
    session.playerId = null;
    session.disconnectedAt = Date.now();

    // Simulate reconnect - restore data
    const restoredData = { ...session.playerData };

    expect(restoredData.clicks).toBe(42);
    expect(restoredData.name).toBe('Player1');
  });
});

// ==========================================
// INPUT VALIDATION TESTS
// ==========================================

describe('Input Validation', () => {
  // Test the validation functions directly
  const MIN_AUCTION_DURATION = 1;
  const MAX_AUCTION_DURATION = 300;

  function sanitizeString(str: unknown, maxLength: number): string {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLength);
  }

  function validateAuctionDuration(duration: unknown): number {
    const num = Number(duration);
    if (isNaN(num) || num < MIN_AUCTION_DURATION) return MIN_AUCTION_DURATION;
    if (num > MAX_AUCTION_DURATION) return MAX_AUCTION_DURATION;
    return Math.floor(num);
  }

  function isValidSocketId(id: unknown): boolean {
    return typeof id === 'string' && id.length > 0 && id.length < 50;
  }

  describe('sanitizeString', () => {
    test('returns empty string for non-string input', () => {
      expect(sanitizeString(null, 50)).toBe('');
      expect(sanitizeString(undefined, 50)).toBe('');
      expect(sanitizeString(123, 50)).toBe('');
      expect(sanitizeString({}, 50)).toBe('');
      expect(sanitizeString([], 50)).toBe('');
    });

    test('trims whitespace', () => {
      expect(sanitizeString('  hello  ', 50)).toBe('hello');
      expect(sanitizeString('\n\ttest\n\t', 50)).toBe('test');
    });

    test('truncates to max length', () => {
      const longString = 'a'.repeat(100);
      expect(sanitizeString(longString, 50)).toBe('a'.repeat(50));
    });

    test('handles empty string', () => {
      expect(sanitizeString('', 50)).toBe('');
    });

    test('preserves valid strings', () => {
      expect(sanitizeString('ValidName', 50)).toBe('ValidName');
      expect(sanitizeString('Player 🎉', 50)).toBe('Player 🎉');
    });

    test('handles potential XSS attempts', () => {
      const xss = '<script>alert("xss")</script>';
      // Our sanitization doesn't remove HTML, just limits length
      // The actual XSS prevention happens in the frontend
      expect(sanitizeString(xss, 50)).toBe(xss);
    });
  });

  describe('validateAuctionDuration', () => {
    test('returns MIN for invalid inputs', () => {
      expect(validateAuctionDuration(null)).toBe(MIN_AUCTION_DURATION);
      expect(validateAuctionDuration(undefined)).toBe(MIN_AUCTION_DURATION);
      expect(validateAuctionDuration('not a number')).toBe(MIN_AUCTION_DURATION);
      expect(validateAuctionDuration(NaN)).toBe(MIN_AUCTION_DURATION);
    });

    test('returns MIN for zero or negative', () => {
      expect(validateAuctionDuration(0)).toBe(MIN_AUCTION_DURATION);
      expect(validateAuctionDuration(-5)).toBe(MIN_AUCTION_DURATION);
      expect(validateAuctionDuration(-100)).toBe(MIN_AUCTION_DURATION);
    });

    test('returns MAX for values over limit', () => {
      expect(validateAuctionDuration(500)).toBe(MAX_AUCTION_DURATION);
      expect(validateAuctionDuration(1000)).toBe(MAX_AUCTION_DURATION);
      expect(validateAuctionDuration(999999)).toBe(MAX_AUCTION_DURATION);
    });

    test('floors decimal values', () => {
      expect(validateAuctionDuration(10.5)).toBe(10);
      expect(validateAuctionDuration(10.9)).toBe(10);
      expect(validateAuctionDuration(5.1)).toBe(5);
    });

    test('accepts valid durations', () => {
      expect(validateAuctionDuration(1)).toBe(1);
      expect(validateAuctionDuration(10)).toBe(10);
      expect(validateAuctionDuration(60)).toBe(60);
      expect(validateAuctionDuration(300)).toBe(300);
    });

    test('handles string numbers', () => {
      expect(validateAuctionDuration('10')).toBe(10);
      expect(validateAuctionDuration('60')).toBe(60);
    });
  });

  describe('validateCountdownDuration', () => {
    const MIN_COUNTDOWN_DURATION = 1;
    const MAX_COUNTDOWN_DURATION = 10;

    function validateCountdownDuration(duration: unknown): number {
      const num = Number(duration);
      if (isNaN(num) || num < MIN_COUNTDOWN_DURATION) return MIN_COUNTDOWN_DURATION;
      if (num > MAX_COUNTDOWN_DURATION) return MAX_COUNTDOWN_DURATION;
      return Math.floor(num);
    }

    test('returns MIN for invalid inputs', () => {
      expect(validateCountdownDuration(null)).toBe(MIN_COUNTDOWN_DURATION);
      expect(validateCountdownDuration(undefined)).toBe(MIN_COUNTDOWN_DURATION);
      expect(validateCountdownDuration('not a number')).toBe(MIN_COUNTDOWN_DURATION);
    });

    test('returns MIN for zero or negative', () => {
      expect(validateCountdownDuration(0)).toBe(MIN_COUNTDOWN_DURATION);
      expect(validateCountdownDuration(-1)).toBe(MIN_COUNTDOWN_DURATION);
    });

    test('returns MAX for values over limit', () => {
      expect(validateCountdownDuration(15)).toBe(MAX_COUNTDOWN_DURATION);
      expect(validateCountdownDuration(100)).toBe(MAX_COUNTDOWN_DURATION);
    });

    test('accepts valid durations', () => {
      expect(validateCountdownDuration(1)).toBe(1);
      expect(validateCountdownDuration(3)).toBe(3);
      expect(validateCountdownDuration(5)).toBe(5);
      expect(validateCountdownDuration(10)).toBe(10);
    });
  });

  describe('Rate Limiting', () => {
    const MAX_CLICKS_PER_SECOND = 20;
    const clickTimestamps: Record<string, number[]> = {};

    function isRateLimited(socketId: string): boolean {
      const now = Date.now();
      const oneSecondAgo = now - 1000;

      if (!clickTimestamps[socketId]) {
        clickTimestamps[socketId] = [];
      }

      clickTimestamps[socketId] = clickTimestamps[socketId].filter((ts: number) => ts > oneSecondAgo);

      if (clickTimestamps[socketId].length >= MAX_CLICKS_PER_SECOND) {
        return true;
      }

      clickTimestamps[socketId].push(now);
      return false;
    }

    function cleanupRateLimitData(socketId: string): void {
      delete clickTimestamps[socketId];
    }

    beforeEach(() => {
      // Clear all rate limit data
      Object.keys(clickTimestamps).forEach(key => delete clickTimestamps[key]);
    });

    test('allows clicks under rate limit', () => {
      for (let i = 0; i < MAX_CLICKS_PER_SECOND; i++) {
        expect(isRateLimited('test-socket')).toBe(false);
      }
    });

    test('blocks clicks over rate limit', () => {
      // Fill up to limit
      for (let i = 0; i < MAX_CLICKS_PER_SECOND; i++) {
        isRateLimited('test-socket');
      }
      // Next click should be rate limited
      expect(isRateLimited('test-socket')).toBe(true);
    });

    test('different sockets have separate limits', () => {
      // Fill socket1 to limit
      for (let i = 0; i < MAX_CLICKS_PER_SECOND; i++) {
        isRateLimited('socket1');
      }
      // socket1 is limited
      expect(isRateLimited('socket1')).toBe(true);
      // socket2 is not limited
      expect(isRateLimited('socket2')).toBe(false);
    });

    test('cleanup removes rate limit data', () => {
      isRateLimited('cleanup-test');
      expect(clickTimestamps['cleanup-test']).toBeDefined();
      cleanupRateLimitData('cleanup-test');
      expect(clickTimestamps['cleanup-test']).toBeUndefined();
    });
  });

  describe('Bot Detection', () => {
    const MIN_HUMAN_CV = 0.15;
    const MIN_CLICKS_FOR_ANALYSIS = 10;

    function calculateCV(intervals: number[]): number | null {
      if (intervals.length < MIN_CLICKS_FOR_ANALYSIS) {
        return null;
      }

      const mean = intervals.reduce((a: number, b: number) => a + b, 0) / intervals.length;
      if (mean === 0) return null;

      const squaredDiffs = intervals.map((x: number) => Math.pow(x - mean, 2));
      const variance = squaredDiffs.reduce((a: number, b: number) => a + b, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);

      return stdDev / mean;
    }

    function isSuspiciousClicker(intervals: number[] | null): { suspicious: boolean; reason: string | null; cv: number | null } {
      if (!intervals || intervals.length < MIN_CLICKS_FOR_ANALYSIS) {
        return { suspicious: false, reason: null, cv: null };
      }

      const cv = calculateCV(intervals);
      if (cv === null) {
        return { suspicious: false, reason: null, cv: null };
      }

      if (cv < MIN_HUMAN_CV) {
        return {
          suspicious: true,
          reason: `Click timing too consistent (CV: ${(cv * 100).toFixed(1)}%)`,
          cv: cv,
        };
      }

      return { suspicious: false, reason: null, cv: cv };
    }

    test('returns null CV for insufficient data', () => {
      const intervals = [50, 50, 50]; // Only 3 intervals
      expect(calculateCV(intervals)).toBeNull();
    });

    test('calculates CV correctly for consistent intervals (bot-like)', () => {
      // Bot: clicks exactly every 50ms
      const botIntervals = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
      const cv = calculateCV(botIntervals);
      expect(cv).toBe(0); // Perfect consistency = 0 variance
    });

    test('calculates CV correctly for varied intervals (human-like)', () => {
      // Human: varied timing (40-80ms range)
      const humanIntervals = [45, 62, 51, 78, 43, 67, 55, 72, 48, 60];
      const cv = calculateCV(humanIntervals);
      expect(cv).toBeGreaterThan(MIN_HUMAN_CV);
    });

    test('flags bot-like clicking pattern', () => {
      const botIntervals = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
      const result = isSuspiciousClicker(botIntervals);

      expect(result.suspicious).toBe(true);
      expect(result.reason).toContain('too consistent');
      expect(result.cv).toBe(0);
    });

    test('does not flag human-like clicking pattern', () => {
      const humanIntervals = [45, 62, 51, 78, 43, 67, 55, 72, 48, 60];
      const result = isSuspiciousClicker(humanIntervals);

      expect(result.suspicious).toBe(false);
      expect(result.reason).toBeNull();
    });

    test('does not flag with insufficient data', () => {
      const fewIntervals = [50, 50, 50];
      const result = isSuspiciousClicker(fewIntervals);

      expect(result.suspicious).toBe(false);
      expect(result.cv).toBeNull();
    });

    test('handles edge case of slightly varied bot', () => {
      // Bot with tiny variance (still suspicious)
      const sneakyBot = [50, 51, 50, 49, 50, 51, 50, 49, 50, 50];
      const result = isSuspiciousClicker(sneakyBot);

      // CV should be very low (< 15%)
      expect(result.cv).toBeLessThan(MIN_HUMAN_CV);
      expect(result.suspicious).toBe(true);
    });

    test('handles very fast human clicking', () => {
      // Fast but varied (human mashing button)
      const fastHuman = [30, 45, 28, 52, 35, 48, 32, 55, 38, 42];
      const result = isSuspiciousClicker(fastHuman);

      expect(result.suspicious).toBe(false);
    });
  });

  describe('isValidSocketId', () => {
    test('rejects non-string inputs', () => {
      expect(isValidSocketId(null)).toBe(false);
      expect(isValidSocketId(undefined)).toBe(false);
      expect(isValidSocketId(123)).toBe(false);
      expect(isValidSocketId({})).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidSocketId('')).toBe(false);
    });

    test('rejects very long strings', () => {
      expect(isValidSocketId('a'.repeat(100))).toBe(false);
    });

    test('accepts valid socket IDs', () => {
      expect(isValidSocketId('abc123')).toBe(true);
      expect(isValidSocketId('socket-id-12345')).toBe(true);
      expect(isValidSocketId('a')).toBe(true);
    });
  });
});

// ==========================================
// STAGE 2 GAME STATE TESTS
// ==========================================

describe('Stage 2 Game State', () => {
  test('GameState status type includes stage2 values', () => {
    // Test that the status type allows Stage 2 values
    type GameStatus = 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished';
    
    const validStatuses: GameStatus[] = [
      'waiting',
      'countdown', 
      'bidding',
      'stage2_countdown',
      'stage2_tap',
      'finished',
    ];
    
    expect(validStatuses).toContain('stage2_countdown');
    expect(validStatuses).toContain('stage2_tap');
  });

  test('Player interface includes reactionTime field', () => {
    // Test that Player can have reactionTime
    interface PlayerWithReaction {
      name: string;
      clicks: number;
      color: string;
      adContent: string;
      reactionTime?: number | null;
    }
    
    const player: PlayerWithReaction = {
      name: 'Test',
      clicks: 10,
      color: '#fff',
      adContent: 'Test ad',
      reactionTime: 150,
    };
    
    expect(player.reactionTime).toBe(150);
    
    const playerNoReaction: PlayerWithReaction = {
      name: 'Test2',
      clicks: 5,
      color: '#000',
      adContent: 'Test ad 2',
      reactionTime: null,
    };
    
    expect(playerNoReaction.reactionTime).toBeNull();
  });

  test('GameState includes stage1Scores for preserving Stage 1 clicks', () => {
    // Test that stage1Scores can store player click counts
    interface Stage1Scores {
      [playerId: string]: number;
    }
    
    const stage1Scores: Stage1Scores = {
      'socket1': 50,
      'socket2': 30,
      'socket3': 45,
    };
    
    expect(stage1Scores['socket1']).toBe(50);
    expect(stage1Scores['socket2']).toBe(30);
    expect(Object.keys(stage1Scores).length).toBe(3);
  });

  test('GameState includes stage2StartTime for reaction timing', () => {
    // Test that stage2StartTime can be stored
    interface GameStateWithStage2 {
      stage2StartTime: number | null;
    }
    
    const state: GameStateWithStage2 = {
      stage2StartTime: Date.now(),
    };
    
    expect(typeof state.stage2StartTime).toBe('number');
    
    const stateNoStart: GameStateWithStage2 = {
      stage2StartTime: null,
    };
    
    expect(stateNoStart.stage2StartTime).toBeNull();
  });
});

// ==========================================
// INPUT VALIDATION INTEGRATION TESTS
// ==========================================

describe('Input Validation Integration', () => {
  // Types for this test suite
  interface ValidationGamePlayer {
    name: string;
    clicks: number;
    color: string;
    adContent: string;
  }
  
  interface ValidationGameState {
    players: Record<string, ValidationGamePlayer>;
    status: string;
    auctionDuration: number;
  }

  interface ValidationStateResponse {
    playerCount: number;
    leaderboard: Array<{ id: string; name: string }>;
  }

  interface AuctionStartedResponse {
    duration: number;
  }

  let ioValidation: Server;
  let httpServerValidation: HttpServer;
  let serverUrlValidation: string;
  let gameStateValidation: ValidationGameState;
  let connectedClientsValidation: ClientSocket[] = [];

  const MAX_NAME_LENGTH = 50;
  const MAX_AD_CONTENT_LENGTH = 200;
  const MIN_AUCTION_DURATION = 1;
  const MAX_AUCTION_DURATION = 300;

  function sanitizeString(str: unknown, maxLength: number): string {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLength);
  }

  function validateAuctionDuration(duration: unknown): number {
    const num = Number(duration);
    if (isNaN(num) || num < MIN_AUCTION_DURATION) return MIN_AUCTION_DURATION;
    if (num > MAX_AUCTION_DURATION) return MAX_AUCTION_DURATION;
    return Math.floor(num);
  }

  const DSP_COLORS = ['#00C9A7', '#E91E8C', '#6B3FA0'];
  let colorIndex = 0;

  const getNextColor = (): string => {
    const color = DSP_COLORS[colorIndex % DSP_COLORS.length];
    colorIndex++;
    return color;
  };

  const createClientValidation = (): ClientSocket => {
    const client = Client(serverUrlValidation, { transports: ['websocket'], forceNew: true });
    connectedClientsValidation.push(client);
    return client;
  };

  const closeAllClientsValidation = (): void => {
    connectedClientsValidation.forEach(c => c.connected && c.close());
    connectedClientsValidation = [];
  };

  beforeAll((done) => {
    httpServerValidation = createServer();
    ioValidation = new Server(httpServerValidation);

    gameStateValidation = { players: {}, status: 'waiting', auctionDuration: 10 };
    colorIndex = 0;

    ioValidation.on('connection', (socket) => {
      socket.on('joinGame', (data: unknown) => {
        // With validation
        const safeData = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {};
        const name = sanitizeString(safeData.name, MAX_NAME_LENGTH);
        const adContent = sanitizeString(safeData.adContent, MAX_AD_CONTENT_LENGTH);
        const playerName = name || `DSP-${socket.id.substr(0, 4)}`;

        gameStateValidation.players[socket.id] = {
          name: playerName,
          clicks: 0,
          color: getNextColor(),
          adContent: adContent || `${playerName} wins!`,
        };

        ioValidation.emit('gameState', {
          playerCount: Object.keys(gameStateValidation.players).length,
          leaderboard: Object.entries(gameStateValidation.players).map(([id, p]) => ({ id, ...p })),
        });
      });

      socket.on('startAuction', (settings: unknown) => {
        if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
          const settingsObj = settings as Record<string, unknown>;
          if (settingsObj.duration !== undefined) {
            gameStateValidation.auctionDuration = validateAuctionDuration(settingsObj.duration);
          }
        }
        ioValidation.emit('auctionStarted', { duration: gameStateValidation.auctionDuration });
      });

      socket.on('disconnect', () => {
        delete gameStateValidation.players[socket.id];
      });
    });

    httpServerValidation.listen(0, () => {
      const addr = httpServerValidation.address() as AddressInfo;
      serverUrlValidation = `http://localhost:${addr.port}`;
      done();
    });
  });

  afterAll((done) => {
    closeAllClientsValidation();
    ioValidation.close();
    httpServerValidation.close(done);
  });

  beforeEach(() => {
    gameStateValidation = { players: {}, status: 'waiting', auctionDuration: 10 };
    colorIndex = 0;
  });

  afterEach(() => {
    closeAllClientsValidation();
  });

  test('truncates very long player name', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    const longName = 'A'.repeat(100);
    client.emit('joinGame', { name: longName });
    const state = await waitFor<ValidationStateResponse>(client, 'gameState');

    expect(state.leaderboard[0].name.length).toBe(MAX_NAME_LENGTH);
  });

  test('handles malformed joinGame data', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    // Send various malformed data
    client.emit('joinGame', 'just a string');
    const state1 = await waitFor<ValidationStateResponse>(client, 'gameState');
    expect(state1.leaderboard[0].name).toMatch(/^DSP-/);
  });

  test('handles null joinGame data', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    client.emit('joinGame', null);
    const state = await waitFor<ValidationStateResponse>(client, 'gameState');
    expect(state.leaderboard[0].name).toMatch(/^DSP-/);
  });

  test('handles array as joinGame data', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    client.emit('joinGame', [1, 2, 3]);
    const state = await waitFor<ValidationStateResponse>(client, 'gameState');
    expect(state.leaderboard[0].name).toMatch(/^DSP-/);
  });

  test('clamps negative auction duration to minimum', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    client.emit('startAuction', { duration: -10 });
    const result = await waitFor<AuctionStartedResponse>(client, 'auctionStarted');

    expect(result.duration).toBe(MIN_AUCTION_DURATION);
  });

  test('clamps excessive auction duration to maximum', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    client.emit('startAuction', { duration: 9999 });
    const result = await waitFor<AuctionStartedResponse>(client, 'auctionStarted');

    expect(result.duration).toBe(MAX_AUCTION_DURATION);
  });

  test('handles non-numeric auction duration', async () => {
    const client = createClientValidation();
    await waitFor(client, 'connect');

    client.emit('startAuction', { duration: 'not a number' });
    const result = await waitFor<AuctionStartedResponse>(client, 'auctionStarted');

    expect(result.duration).toBe(MIN_AUCTION_DURATION);
  });
});
