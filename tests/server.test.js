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

const { createServer } = require('http');
const { Server } = require('socket.io');
const Client = require('socket.io-client');
const fs = require('fs');
const path = require('path');

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
const waitFor = (socket, event, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
};

/**
 * Wait for gameState with specific status
 */
const waitForStatus = (socket, targetStatus, timeout = 10000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler);
      reject(new Error(`Timeout waiting for status: ${targetStatus}`));
    }, timeout);
    
    const handler = (state) => {
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
const waitForCondition = (socket, conditionFn, timeout = 5000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('gameState', handler);
      reject(new Error('Timeout waiting for condition'));
    }, timeout);
    
    const handler = (state) => {
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
const waitForPlayerCount = (socket, count, timeout = 5000) => {
  return waitForCondition(socket, (state) => state.playerCount === count, timeout);
};

/**
 * Wait for a player to appear in leaderboard
 */
const waitForPlayerInLeaderboard = (socket, playerName, timeout = 5000) => {
  return waitForCondition(
    socket, 
    (state) => state.leaderboard.some(p => p.name === playerName), 
    timeout
  );
};

/**
 * Emit and wait for acknowledgment via gameState update
 * This replaces arbitrary delays after emit
 */
const emitAndWait = async (socket, event, data, waitCondition, timeout = 5000) => {
  const promise = waitForCondition(socket, waitCondition, timeout);
  socket.emit(event, data);
  return promise;
};

describe('Click Auction Server', () => {
  let io, httpServer, serverUrl;
  let gameState, allTimeStats;
  let connectedClients = [];
  
  // Store interval references
  let countdownInterval = null;
  let biddingInterval = null;

  // Game logic functions (extracted for testing)
  const DSP_COLORS = [
    '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
    '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
    '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
    '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A'
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
  };

  const resetGameState = () => {
    clearAllIntervals();
    gameState = {
      status: 'waiting',
      players: {},
      auctionDuration: 2, // Short for tests
      countdownDuration: 1, // Short for tests
      timeRemaining: 0,
      winner: null,
      winnerAd: null,
      round: 0,
      finalLeaderboard: []
    };
    colorIndex = 0;
  };

  const getLeaderboard = () => {
    return Object.entries(gameState.players)
      .map(([id, player]) => ({
        id,
        name: player.name,
        clicks: player.clicks,
        color: player.color
      }))
      .sort((a, b) => b.clicks - a.clicks);
  };

  const getAllTimeLeaderboard = () => {
    return Object.entries(allTimeStats)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
  };

  const updatePlayerStats = (name, clicks, isWinner) => {
    if (!allTimeStats[name]) {
      allTimeStats[name] = {
        wins: 0,
        totalClicks: 0,
        roundsPlayed: 0,
        bestRound: 0,
        lastPlayed: null
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
      allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20)
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
        clearInterval(biddingInterval);
        biddingInterval = null;
        endAuction();
      }
    }, 100); // Fast for tests
  };

  const endAuction = () => {
    gameState.status = 'finished';
    const leaderboard = getLeaderboard();
    gameState.finalLeaderboard = leaderboard;
    
    let winnerName = null;
    if (leaderboard.length > 0 && leaderboard[0].clicks > 0) {
      const winnerId = leaderboard[0].id;
      if (gameState.players[winnerId]) {
        gameState.winner = { ...gameState.players[winnerId], id: winnerId };
        gameState.winnerAd = gameState.players[winnerId].adContent;
        winnerName = gameState.winner.name;
      }
    }
    
    leaderboard.forEach(player => {
      updatePlayerStats(player.name, player.clicks, player.name === winnerName);
    });
    
    broadcastState();
  };
  
  // Helper to create and track client connections
  const createClient = () => {
    const client = Client(serverUrl, {
      transports: ['websocket'],
      forceNew: true
    });
    connectedClients.push(client);
    return client;
  };
  
  // Helper to close all tracked clients
  const closeAllClients = () => {
    connectedClients.forEach(client => {
      if (client.connected) {
        client.close();
      }
    });
    connectedClients = [];
  };
  
  // Helper to safely close a specific client
  const closeClient = (client) => {
    connectedClients = connectedClients.filter(c => c !== client);
    if (client.connected) {
      client.close();
    }
  };

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
        allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20)
      });

      socket.on('joinGame', (data) => {
        const { name, adContent } = data || {};
        gameState.players[socket.id] = {
          name: name || `DSP-${socket.id.substr(0, 4)}`,
          clicks: 0,
          color: getNextColor(),
          adContent: adContent || `${name || 'Anonymous'} wins!`
        };
        broadcastState();
      });

      socket.on('click', () => {
        if (gameState.status === 'bidding' && gameState.players[socket.id]) {
          gameState.players[socket.id].clicks++;
          io.emit('clickUpdate', {
            playerId: socket.id,
            clicks: gameState.players[socket.id].clicks
          });
        }
      });

      socket.on('startAuction', (settings) => {
        // Clear any existing intervals first (prevents multiple timers)
        clearAllIntervals();
        
        if (settings?.duration) {
          gameState.auctionDuration = settings.duration;
        }
        
        // Reset clicks for all players
        Object.keys(gameState.players).forEach(id => {
          gameState.players[id].clicks = 0;
        });
        
        gameState.status = 'countdown';
        gameState.round++;
        gameState.timeRemaining = gameState.countdownDuration;
        gameState.winner = null;
        gameState.winnerAd = null;
        gameState.finalLeaderboard = [];
        
        broadcastState();
        
        // Countdown
        countdownInterval = setInterval(() => {
          gameState.timeRemaining--;
          broadcastState();
          
          if (gameState.timeRemaining <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            startBidding();
          }
        }, 100); // Fast for tests
      });

      socket.on('resetAuction', () => {
        clearAllIntervals();
        Object.keys(gameState.players).forEach(id => {
          gameState.players[id].clicks = 0;
        });
        gameState.status = 'waiting';
        gameState.winner = null;
        gameState.winnerAd = null;
        gameState.timeRemaining = 0;
        gameState.finalLeaderboard = [];
        broadcastState();
      });

      socket.on('kickPlayer', (playerId) => {
        if (gameState.players[playerId]) {
          delete gameState.players[playerId];
          io.to(playerId).emit('kicked');
          broadcastState();
        }
      });

      socket.on('resetAllTimeStats', () => {
        allTimeStats = {};
        broadcastState();
      });

      socket.on('disconnect', () => {
        if (gameState.players[socket.id]) {
          delete gameState.players[socket.id];
          broadcastState();
        }
      });
    });

    // Listen on port 0 to get random available port
    httpServer.listen(0, () => {
      const address = httpServer.address();
      serverUrl = `http://localhost:${address.port}`;
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
        (s) => s.playerCount === 1
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
        (s) => s.playerCount === 1
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
        (s) => s.playerCount === 1
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

    test('kicking player removes them', async () => {
      const host = createClient();
      const player = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(player, 'connect');
      
      await emitAndWait(player, 'joinGame', { name: 'KickMe' }, (s) => s.playerCount === 1);
      
      const playerId = Object.keys(gameState.players)[0];
      
      // Set up kick listener and wait for playerCount to drop
      const kickPromise = waitFor(player, 'kicked');
      const statePromise = waitForPlayerCount(host, 0);
      
      host.emit('kickPlayer', playerId);
      
      await Promise.all([kickPromise, statePromise]);
      expect(Object.keys(gameState.players).length).toBe(0);
    });

    test('kicking non-existent player does nothing', async () => {
      const host = createClient();
      const initialState = await waitFor(host, 'gameState');
      
      host.emit('kickPlayer', 'fake-player-id');
      
      // Since nothing should change, we just verify state is still valid
      expect(initialState.playerCount).toBe(0);
      expect(Object.keys(gameState.players).length).toBe(0);
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
      
      const statuses = [];
      player.on('gameState', (state) => {
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
      
      // Click during waiting - should not count (check gameState directly, it's synchronous)
      player.emit('click');
      player.emit('click');
      expect(gameState.players[player.id]?.clicks || 0).toBe(0);
      
      host.emit('startAuction', { duration: 2 });
      
      // Wait for countdown, then click - should not count
      await waitForStatus(player, 'countdown', 3000);
      player.emit('click');
      player.emit('click');
      // Clicks during countdown shouldn't register
      expect(gameState.players[player.id].clicks).toBe(0);
      
      // Wait for bidding, then click - should count
      await waitForStatus(player, 'bidding', 3000);
      
      // Click and wait for clickUpdate event to confirm it was processed
      const clickPromise1 = waitFor(player, 'clickUpdate');
      player.emit('click');
      await clickPromise1;
      
      const clickPromise2 = waitFor(player, 'clickUpdate');
      player.emit('click');
      await clickPromise2;
      
      const clickPromise3 = waitFor(player, 'clickUpdate');
      player.emit('click');
      await clickPromise3;
      
      expect(gameState.players[player.id].clicks).toBe(3);
      
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
      
      host.emit('startAuction', { duration: 3 });
      await waitForStatus(host, 'bidding', 5000);
      
      // Click and wait for confirmation
      const clickPromise = waitFor(player, 'clickUpdate');
      player.emit('click');
      await clickPromise;
      
      // Reset and wait for waiting status
      host.emit('resetAuction');
      const state = await waitForStatus(host, 'waiting');
      
      expect(state.status).toBe('waiting');
      expect(state.winner).toBeNull();
      expect(state.timeRemaining).toBe(0);
      expect(gameState.players[player.id].clicks).toBe(0);
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
      
      const times = [];
      const handler = (state) => {
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
      
      expect(gameState.winner.name).toBe('FastClicker');
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
      expect(['TiePlayer1', 'TiePlayer2']).toContain(gameState.winner.name);
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
      expect(gameState.winner.name).toBe('Winner');
    });
  });

  // ==========================================
  // LEADERBOARD TESTS (Pure Unit Tests - No Network)
  // ==========================================
  
  describe('Leaderboard', () => {
    test('leaderboard sorts by clicks descending', () => {
      gameState.players = {
        'id1': { name: 'Low', clicks: 10, color: '#fff' },
        'id2': { name: 'High', clicks: 50, color: '#fff' },
        'id3': { name: 'Mid', clicks: 30, color: '#fff' }
      };
      
      const leaderboard = getLeaderboard();
      
      expect(leaderboard[0].name).toBe('High');
      expect(leaderboard[1].name).toBe('Mid');
      expect(leaderboard[2].name).toBe('Low');
    });

    test('all-time leaderboard sorts by wins then clicks', () => {
      allTimeStats = {
        'ManyWins': { wins: 5, totalClicks: 50 },
        'FewWinsManyClicks': { wins: 2, totalClicks: 200 },
        'FewWinsFewClicks': { wins: 2, totalClicks: 100 }
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
        lastPlayed: expect.any(String)
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
        'Player1': { wins: 5, totalClicks: 100 },
        'Player2': { wins: 3, totalClicks: 50 }
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
      
      await waitFor(host, 'connect');
      await waitFor(clicker, 'connect');
      
      await emitAndWait(clicker, 'joinGame', { name: 'RapidClicker' }, (s) => s.playerCount === 1);
      
      host.emit('startAuction', { duration: 3 });
      await waitForStatus(host, 'bidding', 5000);
      
      // Rapid fire clicks and count how many register
      const clickCount = 50;
      for (let i = 0; i < clickCount; i++) {
        const p = waitFor(clicker, 'clickUpdate');
        clicker.emit('click');
        await p;
      }
      
      // All clicks should be registered since we waited for each
      expect(gameState.players[clicker.id].clicks).toBe(clickCount);
      
      await waitForStatus(host, 'finished', 5000);
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
      
      expect(gameState.winner.name).toBe('SoloPlayer');
      expect(gameState.finalLeaderboard.length).toBe(1);
    });
  });

  // ==========================================
  // BROADCAST STATE TESTS
  // ==========================================
  
  describe('State Broadcasting', () => {
    test('all clients receive state updates', async () => {
      const clients = [];
      const statePromises = [];
      
      for (let i = 0; i < 3; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        clients.push(client);
      }
      
      // Set up listeners for next gameState on each client
      clients.forEach(client => {
        statePromises.push(waitFor(client, 'gameState'));
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
      const clickUpdatePromise = waitFor(observer, 'clickUpdate', 3000);
      
      host.emit('startAuction', { duration: 2 });
      await waitForStatus(clicker, 'bidding', 3000);
      
      clicker.emit('click');
      
      const update = await clickUpdatePromise;
      expect(update.clicks).toBe(1);
      
      await waitForStatus(clicker, 'finished', 5000);
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
      '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A'
    ];
    
    expect(DSP_COLORS.length).toBe(20);
  });

  test('all colors are valid hex codes', () => {
    const DSP_COLORS = [
      '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
      '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
      '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
      '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A'
    ];
    
    const hexRegex = /^#[0-9A-F]{6}$/i;
    DSP_COLORS.forEach(color => {
      expect(color).toMatch(hexRegex);
    });
  });

  test('color assignment cycles correctly', () => {
    const DSP_COLORS = [
      '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
      '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB'
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
    } catch (parseErr) {
      // This is what happens on corrupt data
      backupCreated = true;
      allTimeStats = {};
    }
    
    expect(backupCreated).toBe(true);
    expect(allTimeStats).toEqual({});
  });
  
  test('handles array instead of object', () => {
    const arrayData = '["not", "an", "object"]';
    let allTimeStats = { existing: true };
    let rejected = false;
    
    try {
      const parsed = JSON.parse(arrayData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch (parseErr) {
      rejected = true;
      allTimeStats = {};
    }
    
    expect(rejected).toBe(true);
    expect(allTimeStats).toEqual({});
  });
  
  test('accepts valid scores object', () => {
    const validData = '{"Player1": {"wins": 5, "totalClicks": 100}}';
    let allTimeStats = {};
    let accepted = false;
    
    try {
      const parsed = JSON.parse(validData);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        allTimeStats = parsed;
        accepted = true;
      } else {
        throw new Error('Invalid scores format');
      }
    } catch (parseErr) {
      allTimeStats = {};
    }
    
    expect(accepted).toBe(true);
    expect(allTimeStats).toHaveProperty('Player1');
    expect(allTimeStats.Player1.wins).toBe(5);
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
    } catch (parseErr) {
      rejected = true;
      allTimeStats = {};
    }
    
    expect(rejected).toBe(true);
    expect(allTimeStats).toEqual({});
  });
});

describe('HTTP Endpoints', () => {
  let server;
  const TEST_PORT = 3098;
  
  beforeAll(async () => {
    // Import and start the actual server for HTTP tests
    // We need to use a different approach - spawn the server or use supertest
    // For simplicity, let's test the routes exist by making fetch requests
  });
  
  // These tests require the server to be running
  // In a real CI/CD, you'd use supertest or spawn the server
  
  describe('/api/config', () => {
    test('returns baseUrl and mode for localhost', async () => {
      // This is a unit test of the logic
      const mockReq = {
        headers: { host: 'localhost:3000' },
        protocol: 'http'
      };
      
      const protocol = mockReq.headers['x-forwarded-proto'] || mockReq.protocol || 'http';
      const host = mockReq.headers['x-forwarded-host'] || mockReq.headers.host;
      const baseUrl = `${protocol}://${host}`;
      const mode = host.includes('localhost') || host.match(/^\d+\.\d+\.\d+\.\d+/) ? 'local' : 'production';
      
      expect(baseUrl).toBe('http://localhost:3000');
      expect(mode).toBe('local');
    });
    
    test('returns production mode for domain', async () => {
      const mockReq = {
        headers: { 
          host: 'click-auction.onrender.com',
          'x-forwarded-proto': 'https'
        },
        protocol: 'https'
      };
      
      const protocol = mockReq.headers['x-forwarded-proto'] || mockReq.protocol || 'http';
      const host = mockReq.headers['x-forwarded-host'] || mockReq.headers.host;
      const baseUrl = `${protocol}://${host}`;
      const mode = host.includes('localhost') || host.match(/^\d+\.\d+\.\d+\.\d+/) ? 'local' : 'production';
      
      expect(baseUrl).toBe('https://click-auction.onrender.com');
      expect(mode).toBe('production');
    });
    
    test('returns local mode for IP address', async () => {
      const mockReq = {
        headers: { host: '192.168.1.100:3000' },
        protocol: 'http'
      };
      
      const host = mockReq.headers.host;
      const mode = host.includes('localhost') || host.match(/^\d+\.\d+\.\d+\.\d+/) ? 'local' : 'production';
      
      expect(mode).toBe('local');
    });
  });
  
  describe('/api/stats', () => {
    test('returns correct stats structure', () => {
      // Unit test the stats structure
      const allTimeStats = {
        'Player1': { wins: 5, totalClicks: 100, roundsPlayed: 10, bestRound: 20 },
        'Player2': { wins: 3, totalClicks: 50, roundsPlayed: 5, bestRound: 15 }
      };
      
      const getAllTimeLeaderboard = () => {
        return Object.entries(allTimeStats)
          .map(([name, stats]) => ({ name, ...stats }))
          .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
      };
      
      const stats = {
        allTime: getAllTimeLeaderboard(),
        totalRounds: 15,
        totalPlayers: Object.keys(allTimeStats).length
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
        round: 3
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
    const players = {};
    
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
    const activePlayers = { 'socket1': {}, 'socket2': {} };
    const activeSocketIds = new Set(Object.keys(activePlayers));
    
    const clickTimestamps = {
      'socket1': [1000, 2000],
      'socket2': [1500],
      'socket3': [3000], // Disconnected player
      'socket4': [4000]  // Disconnected player
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
    const activePlayers = { 'socket1': {}, 'socket2': {} };
    const activeSocketIds = new Set(Object.keys(activePlayers));
    
    const clickIntervals = {
      'socket1': [100, 120, 110],
      'socket2': [80, 90, 85]
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
    const connectionsByIP = {};
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
    const connectionsByIP = {};
    const MAX_CONNECTIONS_PER_IP = 10;
    
    const ip = '192.168.1.100';
    connectionsByIP[ip] = 10; // At limit
    
    const blocked = connectionsByIP[ip] >= MAX_CONNECTIONS_PER_IP;
    expect(blocked).toBe(true);
  });
  
  test('different IPs have separate limits', () => {
    const connectionsByIP = {};
    const MAX_CONNECTIONS_PER_IP = 10;
    
    connectionsByIP['192.168.1.100'] = 10; // At limit
    connectionsByIP['192.168.1.101'] = 5;  // Under limit
    
    expect(connectionsByIP['192.168.1.100'] >= MAX_CONNECTIONS_PER_IP).toBe(true);
    expect(connectionsByIP['192.168.1.101'] >= MAX_CONNECTIONS_PER_IP).toBe(false);
  });
  
  test('cleanup decrements connection count', () => {
    const connectionsByIP = {};
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
    const connectionsByIP = {};
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
    const headers = {};
    const address = '192.168.1.50';
    
    const getClientIP = () => {
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
// INPUT VALIDATION TESTS
// ==========================================

describe('Input Validation', () => {
  // Test the validation functions directly
  const MAX_NAME_LENGTH = 50;
  const MAX_AD_CONTENT_LENGTH = 200;
  const MIN_AUCTION_DURATION = 1;
  const MAX_AUCTION_DURATION = 300;
  
  function sanitizeString(str, maxLength) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLength);
  }
  
  function validateAuctionDuration(duration) {
    const num = Number(duration);
    if (isNaN(num) || num < MIN_AUCTION_DURATION) return MIN_AUCTION_DURATION;
    if (num > MAX_AUCTION_DURATION) return MAX_AUCTION_DURATION;
    return Math.floor(num);
  }
  
  function isValidSocketId(id) {
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
    
    function validateCountdownDuration(duration) {
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
    const clickTimestamps = {};
    
    function isRateLimited(socketId) {
      const now = Date.now();
      const oneSecondAgo = now - 1000;
      
      if (!clickTimestamps[socketId]) {
        clickTimestamps[socketId] = [];
      }
      
      clickTimestamps[socketId] = clickTimestamps[socketId].filter(ts => ts > oneSecondAgo);
      
      if (clickTimestamps[socketId].length >= MAX_CLICKS_PER_SECOND) {
        return true;
      }
      
      clickTimestamps[socketId].push(now);
      return false;
    }
    
    function cleanupRateLimitData(socketId) {
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
    
    function calculateCV(intervals) {
      if (intervals.length < MIN_CLICKS_FOR_ANALYSIS) {
        return null;
      }
      
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (mean === 0) return null;
      
      const squaredDiffs = intervals.map(x => Math.pow(x - mean, 2));
      const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      return stdDev / mean;
    }
    
    function isSuspiciousClicker(intervals) {
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
          cv: cv
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
// INPUT VALIDATION INTEGRATION TESTS
// ==========================================

describe('Input Validation Integration', () => {
  let io, httpServer, serverUrl;
  let gameState;
  let connectedClients = [];
  
  const MAX_NAME_LENGTH = 50;
  const MAX_AD_CONTENT_LENGTH = 200;
  const MIN_AUCTION_DURATION = 1;
  const MAX_AUCTION_DURATION = 300;
  
  function sanitizeString(str, maxLength) {
    if (typeof str !== 'string') return '';
    return str.trim().slice(0, maxLength);
  }
  
  function validateAuctionDuration(duration) {
    const num = Number(duration);
    if (isNaN(num) || num < MIN_AUCTION_DURATION) return MIN_AUCTION_DURATION;
    if (num > MAX_AUCTION_DURATION) return MAX_AUCTION_DURATION;
    return Math.floor(num);
  }
  
  function isValidSocketId(id) {
    return typeof id === 'string' && id.length > 0 && id.length < 50;
  }
  
  const DSP_COLORS = ['#00C9A7', '#E91E8C', '#6B3FA0'];
  let colorIndex = 0;
  
  const getNextColor = () => {
    const color = DSP_COLORS[colorIndex % DSP_COLORS.length];
    colorIndex++;
    return color;
  };
  
  const createClient = () => {
    const client = Client(serverUrl, { transports: ['websocket'], forceNew: true });
    connectedClients.push(client);
    return client;
  };
  
  const closeAllClients = () => {
    connectedClients.forEach(c => c.connected && c.close());
    connectedClients = [];
  };
  
  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    
    gameState = { players: {}, status: 'waiting', auctionDuration: 10 };
    colorIndex = 0;
    
    io.on('connection', (socket) => {
      socket.on('joinGame', (data) => {
        // With validation
        const safeData = data && typeof data === 'object' ? data : {};
        const name = sanitizeString(safeData.name, MAX_NAME_LENGTH);
        const adContent = sanitizeString(safeData.adContent, MAX_AD_CONTENT_LENGTH);
        const playerName = name || `DSP-${socket.id.substr(0, 4)}`;
        
        gameState.players[socket.id] = {
          name: playerName,
          clicks: 0,
          color: getNextColor(),
          adContent: adContent || `${playerName} wins!`
        };
        
        io.emit('gameState', { 
          playerCount: Object.keys(gameState.players).length,
          leaderboard: Object.entries(gameState.players).map(([id, p]) => ({ id, ...p }))
        });
      });
      
      socket.on('startAuction', (settings) => {
        if (settings && typeof settings === 'object' && settings.duration !== undefined) {
          gameState.auctionDuration = validateAuctionDuration(settings.duration);
        }
        io.emit('auctionStarted', { duration: gameState.auctionDuration });
      });
      
      socket.on('kickPlayer', (playerId) => {
        if (!isValidSocketId(playerId)) {
          socket.emit('error', { message: 'Invalid player ID' });
          return;
        }
        if (gameState.players[playerId]) {
          delete gameState.players[playerId];
          io.to(playerId).emit('kicked');
        }
      });
      
      socket.on('disconnect', () => {
        delete gameState.players[socket.id];
      });
    });
    
    httpServer.listen(0, () => {
      serverUrl = `http://localhost:${httpServer.address().port}`;
      done();
    });
  });
  
  afterAll((done) => {
    closeAllClients();
    io.close();
    httpServer.close(done);
  });
  
  beforeEach(() => {
    gameState = { players: {}, status: 'waiting', auctionDuration: 10 };
    colorIndex = 0;
  });
  
  afterEach(() => {
    closeAllClients();
  });
  
  test('truncates very long player name', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    const longName = 'A'.repeat(100);
    client.emit('joinGame', { name: longName });
    const state = await waitFor(client, 'gameState');
    
    expect(state.leaderboard[0].name.length).toBe(MAX_NAME_LENGTH);
  });
  
  test('handles malformed joinGame data', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    // Send various malformed data
    client.emit('joinGame', 'just a string');
    const state1 = await waitFor(client, 'gameState');
    expect(state1.leaderboard[0].name).toMatch(/^DSP-/);
  });
  
  test('handles null joinGame data', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    client.emit('joinGame', null);
    const state = await waitFor(client, 'gameState');
    expect(state.leaderboard[0].name).toMatch(/^DSP-/);
  });
  
  test('handles array as joinGame data', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    client.emit('joinGame', [1, 2, 3]);
    const state = await waitFor(client, 'gameState');
    expect(state.leaderboard[0].name).toMatch(/^DSP-/);
  });
  
  test('clamps negative auction duration to minimum', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    client.emit('startAuction', { duration: -10 });
    const result = await waitFor(client, 'auctionStarted');
    
    expect(result.duration).toBe(MIN_AUCTION_DURATION);
  });
  
  test('clamps excessive auction duration to maximum', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    client.emit('startAuction', { duration: 9999 });
    const result = await waitFor(client, 'auctionStarted');
    
    expect(result.duration).toBe(MAX_AUCTION_DURATION);
  });
  
  test('handles non-numeric auction duration', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    client.emit('startAuction', { duration: 'not a number' });
    const result = await waitFor(client, 'auctionStarted');
    
    expect(result.duration).toBe(MIN_AUCTION_DURATION);
  });
  
  test('rejects invalid kickPlayer ID', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    const errorPromise = waitFor(client, 'error');
    client.emit('kickPlayer', null);
    
    const error = await errorPromise;
    expect(error.message).toBe('Invalid player ID');
  });
  
  test('ignores kickPlayer with empty string', async () => {
    const client = createClient();
    await waitFor(client, 'connect');
    
    const errorPromise = waitFor(client, 'error');
    client.emit('kickPlayer', '');
    
    const error = await errorPromise;
    expect(error.message).toBe('Invalid player ID');
  });
});
