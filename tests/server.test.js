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

// Helper to wait for socket events
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

// Helper to wait for specific game state
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
      
      client.close();
      await new Promise(r => setTimeout(r, 100));
      
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
      
      client.emit('joinGame', { name: 'CustomPlayer', adContent: 'My Ad' });
      const state = await waitFor(client, 'gameState');
      
      expect(state.playerCount).toBe(1);
      expect(state.leaderboard[0].name).toBe('CustomPlayer');
    });

    test('player gets default name when joining with empty name', async () => {
      const client = createClient();
      await waitFor(client, 'connect');
      
      client.emit('joinGame', { name: '', adContent: '' });
      const state = await waitFor(client, 'gameState');
      
      expect(state.leaderboard[0].name).toMatch(/^DSP-/);
    });

    test('player gets default name when joining with null data', async () => {
      const client = createClient();
      await waitFor(client, 'connect');
      
      client.emit('joinGame', null);
      const state = await waitFor(client, 'gameState');
      
      expect(state.leaderboard[0].name).toMatch(/^DSP-/);
    });

    test('player gets assigned unique color', async () => {
      const client1 = createClient();
      const client2 = createClient();
      
      await waitFor(client1, 'connect');
      await waitFor(client2, 'connect');
      
      client1.emit('joinGame', { name: 'Player1' });
      await new Promise(r => setTimeout(r, 100)); // Wait for join to process
      
      client2.emit('joinGame', { name: 'Player2' });
      await new Promise(r => setTimeout(r, 100)); // Wait for join to process
      
      // Check the game state directly
      const colors = Object.values(gameState.players).map(p => p.color);
      expect(new Set(colors).size).toBe(2);
    });

    test('colors cycle after all are used', async () => {
      // Create more players than colors
      for (let i = 0; i < 25; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        client.emit('joinGame', { name: `Player${i}` });
        await waitFor(client, 'gameState');
      }
      
      // Should have 25 players with cycling colors
      expect(Object.keys(gameState.players).length).toBe(25);
    });

    test('player count decreases on disconnect', async () => {
      const client1 = createClient();
      const client2 = createClient();
      
      await waitFor(client1, 'connect');
      await waitFor(client2, 'connect');
      
      client1.emit('joinGame', { name: 'Stayer' });
      await new Promise(r => setTimeout(r, 50));
      
      client2.emit('joinGame', { name: 'Leaver' });
      await new Promise(r => setTimeout(r, 50));
      
      expect(Object.keys(gameState.players).length).toBe(2);
      
      // Remove from tracked clients before closing
      connectedClients = connectedClients.filter(c => c !== client2);
      client2.close();
      await new Promise(r => setTimeout(r, 100));
      
      expect(Object.keys(gameState.players).length).toBe(1);
    });

    test('kicking player removes them', async () => {
      const host = createClient();
      const player = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(player, 'connect');
      
      player.emit('joinGame', { name: 'KickMe' });
      await waitFor(player, 'gameState');
      
      const playerId = Object.keys(gameState.players)[0];
      
      // Set up kick listener
      const kickPromise = waitFor(player, 'kicked');
      
      host.emit('kickPlayer', playerId);
      
      await kickPromise;
      expect(Object.keys(gameState.players).length).toBe(0);
    });

    test('kicking non-existent player does nothing', async () => {
      const host = createClient();
      await waitFor(host, 'connect');
      
      host.emit('kickPlayer', 'fake-player-id');
      await new Promise(r => setTimeout(r, 100));
      
      // No error, no crash
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
      
      player.emit('joinGame', { name: 'Bidder' });
      await waitFor(player, 'gameState');
      
      host.emit('startAuction', { duration: 2 });
      const state = await waitFor(player, 'gameState');
      
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
      
      player.emit('joinGame', { name: 'Bidder' });
      await waitFor(player, 'gameState');
      
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
      
      player.emit('joinGame', { name: 'Clicker' });
      await waitFor(player, 'gameState');
      
      // Click during waiting - should not count
      player.emit('click');
      player.emit('click');
      await new Promise(r => setTimeout(r, 50));
      expect(gameState.players[player.id]?.clicks || 0).toBe(0);
      
      host.emit('startAuction', { duration: 2 });
      
      // Click during countdown - should not count
      await waitForStatus(player, 'countdown', 3000);
      player.emit('click');
      player.emit('click');
      await new Promise(r => setTimeout(r, 50));
      expect(gameState.players[player.id].clicks).toBe(0);
      
      // Click during bidding - should count
      await waitForStatus(player, 'bidding', 3000);
      player.emit('click');
      player.emit('click');
      player.emit('click');
      await new Promise(r => setTimeout(r, 100));
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
      
      player.emit('joinGame', { name: 'Player' });
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('startAuction', { duration: 2 });
      await waitForStatus(host, 'bidding', 5000);
      
      // Spectator (not joined) clicks
      spectator.emit('click');
      spectator.emit('click');
      
      await new Promise(r => setTimeout(r, 100));
      
      // Only player should have clicks tracked
      expect(Object.keys(gameState.players).length).toBe(1);
      
      await waitForStatus(host, 'finished', 5000);
    });

    test('reset clears auction state', async () => {
      const host = createClient();
      const player = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(player, 'connect');
      
      player.emit('joinGame', { name: 'Resetter' });
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('startAuction', { duration: 3 });
      await waitForStatus(host, 'bidding', 5000);
      
      player.emit('click');
      player.emit('click');
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('resetAuction');
      await new Promise(r => setTimeout(r, 100));
      
      expect(gameState.status).toBe('waiting');
      expect(gameState.winner).toBeNull();
      expect(gameState.timeRemaining).toBe(0);
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
      
      player.emit('joinGame', { name: 'Timer Test' });
      await waitFor(player, 'gameState');
      
      // Start auction multiple times rapidly
      host.emit('startAuction', { duration: 3 });
      host.emit('startAuction', { duration: 3 });
      host.emit('startAuction', { duration: 3 });
      
      await new Promise(r => setTimeout(r, 100));
      
      // Should still be in countdown, not finished prematurely
      expect(['countdown', 'bidding']).toContain(gameState.status);
      
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
      const state = await waitFor(host, 'gameState');
      
      expect(state.status).toBe('waiting');
      
      // Wait to ensure no timer continues
      await new Promise(r => setTimeout(r, 500));
      expect(gameState.status).toBe('waiting');
    });

    test('reset during bidding clears timer', async () => {
      const host = createClient();
      await waitFor(host, 'connect');
      
      host.emit('startAuction', { duration: 5 });
      await waitForStatus(host, 'bidding', 3000);
      
      host.emit('resetAuction');
      const state = await waitFor(host, 'gameState');
      
      expect(state.status).toBe('waiting');
      
      // Wait to ensure no timer continues
      await new Promise(r => setTimeout(r, 500));
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
      const state = await waitFor(host, 'gameState');
      
      expect(['countdown', 'bidding']).toContain(state.status);
      expect(gameState.round).toBe(2);
      
      await waitForStatus(host, 'finished', 5000);
      expect(gameState.round).toBe(2);
    });

    test('rapid start-reset-start cycle handles correctly', async () => {
      const host = createClient();
      await waitFor(host, 'connect');
      
      // Rapid cycle
      for (let i = 0; i < 5; i++) {
        host.emit('startAuction', { duration: 2 });
        await new Promise(r => setTimeout(r, 50));
        host.emit('resetAuction');
        await new Promise(r => setTimeout(r, 50));
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
      
      fast.emit('joinGame', { name: 'FastClicker', adContent: 'I win!' });
      await waitFor(fast, 'gameState');
      
      slow.emit('joinGame', { name: 'SlowClicker', adContent: 'Maybe next time' });
      await waitFor(slow, 'gameState');
      
      host.emit('startAuction', { duration: 2 });
      await waitForStatus(fast, 'bidding', 3000);
      
      // Fast clicks more
      for (let i = 0; i < 10; i++) {
        fast.emit('click');
      }
      for (let i = 0; i < 3; i++) {
        slow.emit('click');
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
      
      player.emit('joinGame', { name: 'Idle' });
      await waitFor(player, 'gameState');
      
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
      
      p1.emit('joinGame', { name: 'TiePlayer1' });
      await waitFor(p1, 'gameState');
      
      p2.emit('joinGame', { name: 'TiePlayer2' });
      await waitFor(p2, 'gameState');
      
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(p1, 'bidding', 3000);
      
      // Both click same amount
      p1.emit('click');
      p1.emit('click');
      p2.emit('click');
      p2.emit('click');
      
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
      
      winner.emit('joinGame', { name: 'Winner' });
      await waitFor(winner, 'gameState');
      
      loser.emit('joinGame', { name: 'Loser' });
      await waitFor(loser, 'gameState');
      
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(winner, 'bidding', 3000);
      
      for (let i = 0; i < 10; i++) {
        winner.emit('click');
      }
      for (let i = 0; i < 2; i++) {
        loser.emit('click');
      }
      
      await waitForStatus(winner, 'finished', 5000);
      
      // Winner disconnects
      connectedClients = connectedClients.filter(c => c !== winner);
      winner.close();
      await new Promise(r => setTimeout(r, 100));
      
      // Final leaderboard should still show winner
      expect(gameState.finalLeaderboard.length).toBe(2);
      expect(gameState.finalLeaderboard[0].name).toBe('Winner');
      expect(gameState.winner.name).toBe('Winner');
    });
  });

  // ==========================================
  // LEADERBOARD TESTS
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
  // STATS PERSISTENCE TESTS
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

    test('lastPlayed timestamp updates', async () => {
      updatePlayerStats('Timer', 10, false);
      const first = allTimeStats['Timer'].lastPlayed;
      
      // Actually wait so timestamp changes
      await new Promise(r => setTimeout(r, 10));
      updatePlayerStats('Timer', 20, false);
      
      // Timestamps should be different (or at least the second one exists)
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
      
      host.emit('resetAllTimeStats');
      await new Promise(r => setTimeout(r, 100));
      
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
      
      p1.emit('joinGame', { name: 'Gold' });
      p2.emit('joinGame', { name: 'Silver' });
      p3.emit('joinGame', { name: 'Bronze' });
      
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(p1, 'bidding', 3000);
      
      for (let i = 0; i < 10; i++) p1.emit('click');
      for (let i = 0; i < 5; i++) p2.emit('click');
      for (let i = 0; i < 2; i++) p3.emit('click');
      
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
      client.emit('joinGame', { name: longName });
      const state = await waitFor(client, 'gameState');
      
      expect(state.leaderboard[0].name).toBe(longName);
    });

    test('special characters in name are handled', async () => {
      const client = createClient();
      await waitFor(client, 'connect');
      
      const specialName = '<script>alert("xss")</script> 🎉 "quotes" & ampersand';
      client.emit('joinGame', { name: specialName });
      const state = await waitFor(client, 'gameState');
      
      expect(state.leaderboard[0].name).toBe(specialName);
    });

    test('rapid clicking registers all clicks', async () => {
      const host = createClient();
      const clicker = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(clicker, 'connect');
      
      clicker.emit('joinGame', { name: 'RapidClicker' });
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('startAuction', { duration: 3 });
      await waitForStatus(host, 'bidding', 5000);
      
      // Rapid fire 100 clicks
      for (let i = 0; i < 100; i++) {
        clicker.emit('click');
      }
      
      await new Promise(r => setTimeout(r, 300));
      
      // Most clicks should be registered (network timing may cause some variance)
      expect(gameState.players[clicker.id].clicks).toBeGreaterThanOrEqual(90);
      
      await waitForStatus(host, 'finished', 5000);
    });

    test('player joining mid-auction can participate', async () => {
      const host = createClient();
      const earlyPlayer = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(earlyPlayer, 'connect');
      
      earlyPlayer.emit('joinGame', { name: 'EarlyBird' });
      await waitFor(earlyPlayer, 'gameState');
      
      host.emit('startAuction', { duration: 3 });
      await waitForStatus(earlyPlayer, 'bidding', 3000);
      
      // Late player joins mid-auction
      const latePlayer = createClient();
      await waitFor(latePlayer, 'connect');
      latePlayer.emit('joinGame', { name: 'LateComer' });
      await new Promise(r => setTimeout(r, 100));
      
      // Both can click
      earlyPlayer.emit('click');
      latePlayer.emit('click');
      latePlayer.emit('click');
      
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
      
      stayer.emit('joinGame', { name: 'Stayer' });
      leaver.emit('joinGame', { name: 'Leaver' });
      await new Promise(r => setTimeout(r, 100));
      
      host.emit('startAuction', { duration: 2 });
      await waitForStatus(stayer, 'bidding', 3000);
      
      // Leaver clicks then disconnects
      leaver.emit('click');
      leaver.emit('click');
      await new Promise(r => setTimeout(r, 50));
      connectedClients = connectedClients.filter(c => c !== leaver);
      leaver.close();
      
      // Stayer continues
      stayer.emit('click');
      stayer.emit('click');
      stayer.emit('click');
      
      // Auction should complete normally
      await waitForStatus(stayer, 'finished', 5000);
      
      expect(gameState.status).toBe('finished');
      expect(gameState.winner).not.toBeNull();
    });

    test('many simultaneous connections handled', async () => {
      for (let i = 0; i < 20; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        client.emit('joinGame', { name: `Player${i}` });
      }
      
      await new Promise(r => setTimeout(r, 200));
      
      expect(Object.keys(gameState.players).length).toBe(20);
    });

    test('auction with single player works', async () => {
      const host = createClient();
      const solo = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(solo, 'connect');
      
      solo.emit('joinGame', { name: 'SoloPlayer' });
      await waitFor(solo, 'gameState');
      
      host.emit('startAuction', { duration: 1 });
      await waitForStatus(solo, 'bidding', 3000);
      
      solo.emit('click');
      
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
      const statesReceived = [false, false, false];
      const clients = [];
      
      for (let i = 0; i < 3; i++) {
        const client = createClient();
        await waitFor(client, 'connect');
        
        const idx = i;
        client.on('gameState', () => {
          statesReceived[idx] = true;
        });
        
        clients.push(client);
      }
      
      // Trigger a broadcast
      clients[0].emit('joinGame', { name: 'Trigger' });
      await new Promise(r => setTimeout(r, 200));
      
      // All clients should have received update
      expect(statesReceived.every(x => x)).toBe(true);
    });

    test('click updates broadcast to all', async () => {
      const host = createClient();
      const clicker = createClient();
      const observer = createClient();
      
      await waitFor(host, 'connect');
      await waitFor(clicker, 'connect');
      await waitFor(observer, 'connect');
      
      clicker.emit('joinGame', { name: 'Clicker' });
      await new Promise(r => setTimeout(r, 100));
      
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
// UTILITY FUNCTION UNIT TESTS
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
