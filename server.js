const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Redis } = require('@upstash/redis');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 100; // Prevent server overload

// Health check endpoint (for monitoring / Render)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    players: Object.keys(gameState?.players || {}).length,
    round: gameState?.round || 0
  });
});

// API endpoint for clients to get the base URL
// Uses the request's host header - works automatically in both local and production
app.get('/api/config', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  
  res.json({
    baseUrl: baseUrl,
    mode: host.includes('localhost') || host.match(/^\d+\.\d+\.\d+\.\d+/) ? 'local' : 'production'
  });
});

// Page routes (defined before static to ensure they always work)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/display', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

// Serve static files (JS, CSS, images)
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// PERSISTENT SCORES (survives server restarts)
// ============================================
const SCORES_FILE = path.join(__dirname, 'scores.json');
const REDIS_KEY = 'click-auction:stats';

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

async function loadScores() {
  try {
    if (redis) {
      // Load from Redis
      const data = await redis.get(REDIS_KEY);
      if (data) {
        allTimeStats = typeof data === 'string' ? JSON.parse(data) : data;
        console.log(`📊 Loaded ${Object.keys(allTimeStats).length} player records from Redis`);
      }
    } else if (fs.existsSync(SCORES_FILE)) {
      // Fallback to local file
      const data = fs.readFileSync(SCORES_FILE, 'utf8');
      try {
        const parsed = JSON.parse(data);
        // Validate structure - should be an object
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          allTimeStats = parsed;
          console.log(`📊 Loaded ${Object.keys(allTimeStats).length} player records from scores.json`);
        } else {
          throw new Error('Invalid scores format');
        }
      } catch (parseErr) {
        console.error('⚠️ Corrupt scores.json detected, backing up and starting fresh');
        // Backup corrupt file
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

async function saveScores() {
  try {
    if (redis) {
      // Save to Redis
      await redis.set(REDIS_KEY, JSON.stringify(allTimeStats));
      console.log('💾 Scores saved to Redis');
    } else {
      // Fallback to local file
      fs.writeFileSync(SCORES_FILE, JSON.stringify(allTimeStats, null, 2));
      console.log('💾 Scores saved to scores.json');
    }
  } catch (err) {
    console.error('Error saving scores:', err);
  }
}

function updatePlayerStats(name, clicks, isWinner) {
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
}

function getAllTimeLeaderboard() {
  return Object.entries(allTimeStats)
    .map(([name, stats]) => ({
      name,
      ...stats
    }))
    .sort((a, b) => b.wins - a.wins || b.totalClicks - a.totalClicks);
}

// Load scores on startup
loadScores();

// ============================================
// GAME STATE (per session)
// ============================================
let gameState = {
  status: 'waiting', // waiting, countdown, bidding, finished
  players: {}, // { socketId: { name, clicks, color } }
  auctionDuration: 10, // seconds
  countdownDuration: 3, // seconds before auction starts
  timeRemaining: 0,
  winner: null,
  winnerAd: null,
  round: 0,
  finalLeaderboard: [] // Saved when auction ends so disconnects don't affect results
};

// Store interval references to prevent multiple timers running
let countdownInterval = null;
let biddingInterval = null;

function clearAllIntervals() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (biddingInterval) {
    clearInterval(biddingInterval);
    biddingInterval = null;
  }
}

// VIOOH-inspired DSP colors
const DSP_COLORS = [
  '#00C9A7', // VIOOH Teal
  '#E91E8C', // VIOOH Magenta
  '#6B3FA0', // VIOOH Purple
  '#00D4D4', // VIOOH Cyan
  '#FFB800', // Gold
  '#00E896', // Bright Green
  '#FF6B9D', // Pink
  '#4ECDC4', // Aqua
  '#9B59B6', // Violet
  '#3498DB', // Blue
  '#F39C12', // Orange
  '#1ABC9C', // Turquoise
  '#E74C8C', // Rose
  '#00BCD4', // Light Cyan
  '#8E44AD', // Deep Purple
  '#2ECC71', // Emerald
  '#E91E63', // Fuchsia
  '#00ACC1', // Teal Light
  '#AB47BC', // Orchid
  '#26A69A'  // Sea Green
];

let colorIndex = 0;

function getNextColor() {
  const color = DSP_COLORS[colorIndex % DSP_COLORS.length];
  colorIndex++;
  return color;
}

// ============================================
// INPUT VALIDATION
// ============================================
const MAX_NAME_LENGTH = 50;
const MAX_AD_CONTENT_LENGTH = 200;
const MIN_AUCTION_DURATION = 1;
const MAX_AUCTION_DURATION = 300; // 5 minutes max
const MIN_COUNTDOWN_DURATION = 1;
const MAX_COUNTDOWN_DURATION = 10;

// Rate limiting: max clicks per second per player
const MAX_CLICKS_PER_SECOND = 20;
const clickTimestamps = {}; // { socketId: [timestamp1, timestamp2, ...] }

function sanitizeString(str, maxLength) {
  if (typeof str !== 'string') return '';
  // Trim and limit length
  return str.trim().slice(0, maxLength);
}

function validateAuctionDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < MIN_AUCTION_DURATION) return MIN_AUCTION_DURATION;
  if (num > MAX_AUCTION_DURATION) return MAX_AUCTION_DURATION;
  return Math.floor(num); // Ensure integer
}

function validateCountdownDuration(duration) {
  const num = Number(duration);
  if (isNaN(num) || num < MIN_COUNTDOWN_DURATION) return MIN_COUNTDOWN_DURATION;
  if (num > MAX_COUNTDOWN_DURATION) return MAX_COUNTDOWN_DURATION;
  return Math.floor(num); // Ensure integer
}

function isValidSocketId(id) {
  // Socket.io IDs are typically alphanumeric strings
  return typeof id === 'string' && id.length > 0 && id.length < 50;
}

function isRateLimited(socketId) {
  const now = Date.now();
  const oneSecondAgo = now - 1000;
  
  // Initialize or clean up old timestamps
  if (!clickTimestamps[socketId]) {
    clickTimestamps[socketId] = [];
  }
  
  // Remove timestamps older than 1 second
  clickTimestamps[socketId] = clickTimestamps[socketId].filter(ts => ts > oneSecondAgo);
  
  // Check if rate limited
  if (clickTimestamps[socketId].length >= MAX_CLICKS_PER_SECOND) {
    return true;
  }
  
  // Record this click
  clickTimestamps[socketId].push(now);
  return false;
}

function cleanupRateLimitData(socketId) {
  delete clickTimestamps[socketId];
  delete clickIntervals[socketId];
}

// ============================================
// MEMORY CLEANUP (Periodic stale data removal)
// ============================================
const CLEANUP_INTERVAL_MS = 60 * 1000; // Run every minute
const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000; // Data older than 5 minutes

function cleanupStaleData() {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Get active socket IDs
  const activeSocketIds = new Set(Object.keys(gameState.players));
  
  // Clean up clickTimestamps for disconnected players
  for (const socketId of Object.keys(clickTimestamps)) {
    if (!activeSocketIds.has(socketId)) {
      delete clickTimestamps[socketId];
      cleanedCount++;
    }
  }
  
  // Clean up clickIntervals for disconnected players
  for (const socketId of Object.keys(clickIntervals)) {
    if (!activeSocketIds.has(socketId)) {
      delete clickIntervals[socketId];
      cleanedCount++;
    }
  }
  
  // Clean up lastClickTime for disconnected players
  for (const socketId of Object.keys(lastClickTime)) {
    if (!activeSocketIds.has(socketId)) {
      delete lastClickTime[socketId];
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`🧹 Memory cleanup: removed ${cleanedCount} stale entries`);
  }
}

// Start periodic cleanup
const cleanupIntervalId = setInterval(cleanupStaleData, CLEANUP_INTERVAL_MS);

// Clean up on process exit
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  saveScores().then(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  saveScores().then(() => {
    process.exit(0);
  });
});

// ============================================
// BOT DETECTION (Statistical Outlier Flagging)
// ============================================
// Bots click at very consistent intervals (low variance)
// Humans have natural variance in their click timing

const clickIntervals = {}; // { socketId: [interval1, interval2, ...] }
const lastClickTime = {}; // { socketId: timestamp }

// Minimum coefficient of variation (CV) expected for human clicks
// CV = stdDev / mean. Humans typically have CV > 0.3 (30% variance)
// Bots often have CV < 0.1 (very consistent timing)
const MIN_HUMAN_CV = 0.15; // Flag if CV is below 15%
const MIN_CLICKS_FOR_ANALYSIS = 10; // Need at least 10 clicks to analyze

function recordClickInterval(socketId) {
  const now = Date.now();
  
  if (lastClickTime[socketId]) {
    const interval = now - lastClickTime[socketId];
    
    if (!clickIntervals[socketId]) {
      clickIntervals[socketId] = [];
    }
    
    // Keep last 50 intervals for analysis
    clickIntervals[socketId].push(interval);
    if (clickIntervals[socketId].length > 50) {
      clickIntervals[socketId].shift();
    }
  }
  
  lastClickTime[socketId] = now;
}

function calculateCV(intervals) {
  if (intervals.length < MIN_CLICKS_FOR_ANALYSIS) {
    return null; // Not enough data
  }
  
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  if (mean === 0) return null;
  
  const squaredDiffs = intervals.map(x => Math.pow(x - mean, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / intervals.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev / mean; // Coefficient of variation
}

function isSuspiciousClicker(socketId) {
  const intervals = clickIntervals[socketId];
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

function resetBotDetectionData(socketId) {
  delete clickIntervals[socketId];
  delete lastClickTime[socketId];
}

function resetGame() {
  Object.keys(gameState.players).forEach(id => {
    gameState.players[id].clicks = 0;
    gameState.players[id].suspicious = false;
    gameState.players[id].suspicionReason = null;
    // Reset bot detection data for this player
    resetBotDetectionData(id);
  });
  gameState.status = 'waiting';
  gameState.winner = null;
  gameState.winnerAd = null;
  gameState.timeRemaining = 0;
  gameState.finalLeaderboard = [];
}

function getLeaderboard() {
  return Object.entries(gameState.players)
    .map(([id, player]) => ({
      id,
      name: player.name,
      clicks: player.clicks,
      color: player.color,
      suspicious: player.suspicious || false
    }))
    .sort((a, b) => b.clicks - a.clicks);
}

function broadcastState() {
  // Use finalLeaderboard when auction is finished (so disconnects don't affect results)
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
    allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20) // Top 20 all-time
  });
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Send current state to new connection (including all-time stats!)
  socket.emit('gameState', {
    status: gameState.status,
    timeRemaining: gameState.timeRemaining,
    leaderboard: gameState.status === 'finished' && gameState.finalLeaderboard.length > 0
      ? gameState.finalLeaderboard
      : getLeaderboard(),
    winner: gameState.winner,
    winnerAd: gameState.winnerAd,
    round: gameState.round,
    playerCount: Object.keys(gameState.players).length,
    allTimeLeaderboard: getAllTimeLeaderboard().slice(0, 20)
  });

  // Player joins the game
  socket.on('joinGame', (data) => {
    // Check max players limit
    if (Object.keys(gameState.players).length >= MAX_PLAYERS) {
      socket.emit('joinError', { message: 'Game is full! Maximum players reached.' });
      return;
    }
    
    // Input validation
    const safeData = data && typeof data === 'object' ? data : {};
    const name = sanitizeString(safeData.name, MAX_NAME_LENGTH);
    const adContent = sanitizeString(safeData.adContent, MAX_AD_CONTENT_LENGTH);
    
    const playerName = name || `DSP-${socket.id.substr(0, 4)}`;
    
    gameState.players[socket.id] = {
      name: playerName,
      clicks: 0,
      color: getNextColor(),
      adContent: adContent || `${playerName} wins! 🎉`
    };
    console.log(`Player joined: ${gameState.players[socket.id].name}`);
    broadcastState();
  });

  // Player clicks (with rate limiting and bot detection)
  socket.on('click', () => {
    if (gameState.status === 'bidding' && gameState.players[socket.id]) {
      // Check rate limit (max 20 clicks/second)
      if (isRateLimited(socket.id)) {
        return; // Silently ignore excessive clicks
      }
      
      // Record click timing for bot detection
      recordClickInterval(socket.id);
      
      gameState.players[socket.id].clicks++;
      
      // Check for suspicious behavior
      const suspicionCheck = isSuspiciousClicker(socket.id);
      gameState.players[socket.id].suspicious = suspicionCheck.suspicious;
      if (suspicionCheck.suspicious) {
        gameState.players[socket.id].suspicionReason = suspicionCheck.reason;
      }
      
      // Emit to all clients for real-time leaderboard updates
      io.emit('clickUpdate', {
        playerId: socket.id,
        playerName: gameState.players[socket.id].name,
        clicks: gameState.players[socket.id].clicks,
        color: gameState.players[socket.id].color,
        suspicious: suspicionCheck.suspicious
      });
    }
  });

  // Host controls
  socket.on('startAuction', (settings) => {
    // Clear any existing intervals first (prevents multiple timers)
    clearAllIntervals();
    
    // Validate and sanitize settings
    if (settings && typeof settings === 'object') {
      if (settings.duration !== undefined) {
        gameState.auctionDuration = validateAuctionDuration(settings.duration);
      }
      if (settings.countdown !== undefined) {
        gameState.countdownDuration = validateCountdownDuration(settings.countdown);
      }
    }
    
    // Ensure countdownDuration is always valid (in case it was never set properly)
    gameState.countdownDuration = validateCountdownDuration(gameState.countdownDuration);
    
    resetGame();
    gameState.round++;
    gameState.status = 'countdown';
    gameState.timeRemaining = gameState.countdownDuration;
    
    broadcastState();
    
    // Countdown timer
    countdownInterval = setInterval(() => {
      gameState.timeRemaining--;
      broadcastState();
      
      if (gameState.timeRemaining <= 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        startBidding();
      }
    }, 1000);
  });

  socket.on('resetAuction', () => {
    clearAllIntervals();
    resetGame();
    broadcastState();
  });

  socket.on('kickPlayer', (playerId) => {
    // Validate playerId
    if (!isValidSocketId(playerId)) return;
    
    if (gameState.players[playerId]) {
      delete gameState.players[playerId];
      io.to(playerId).emit('kicked');
      broadcastState();
    }
  });

  socket.on('resetAllTimeStats', () => {
    allTimeStats = {};
    saveScores();
    console.log('🗑️ All-time stats reset by host');
    broadcastState();
  });

  socket.on('getStats', () => {
    socket.emit('statsUpdate', {
      allTime: getAllTimeLeaderboard(),
      totalRounds: gameState.round
    });
  });

  socket.on('disconnect', () => {
    // Clean up rate limit and bot detection data for this socket
    cleanupRateLimitData(socket.id);
    resetBotDetectionData(socket.id);
    
    if (gameState.players[socket.id]) {
      console.log(`Player disconnected: ${gameState.players[socket.id].name}`);
      delete gameState.players[socket.id];
      broadcastState();
    }
  });
});

function startBidding() {
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
  }, 1000);
}

function endAuction() {
  gameState.status = 'finished';
  
  // Save the final leaderboard NOW before any disconnects
  const leaderboard = getLeaderboard();
  gameState.finalLeaderboard = leaderboard;
  
  // Determine winner
  let winnerName = null;
  if (leaderboard.length > 0 && leaderboard[0].clicks > 0) {
    const winnerId = leaderboard[0].id;
    gameState.winner = {
      ...gameState.players[winnerId],
      id: winnerId
    };
    gameState.winnerAd = gameState.players[winnerId].adContent;
    winnerName = gameState.winner.name;
  }
  
  // Update all-time stats for all participants
  leaderboard.forEach(player => {
    updatePlayerStats(player.name, player.clicks, player.name === winnerName);
  });
  
  // Save to disk
  saveScores();
  
  console.log(`Auction ended! ${leaderboard.length} participants. Winner: ${winnerName || 'None'}`);
  
  broadcastState();
}

// API endpoints for stats
app.get('/api/stats', (req, res) => {
  res.json({
    allTime: getAllTimeLeaderboard(),
    totalRounds: gameState.round,
    totalPlayers: Object.keys(allTimeStats).length
  });
});

app.post('/api/stats/reset', async (req, res) => {
  allTimeStats = {};
  await saveScores();
  console.log('🗑️ All-time stats reset');
  broadcastState();
  res.json({ success: true, message: 'Stats reset' });
});

const HOST = '0.0.0.0'; // Listen on all network interfaces

server.listen(PORT, HOST, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      🎯 CLICK AUCTION 🎯                          ║
╠══════════════════════════════════════════════════════════════════╣
║  Server running on port ${String(PORT).padEnd(39)}║
║  Max players: ${String(MAX_PLAYERS).padEnd(50)}║
║  QR codes auto-detect the correct URL from browser               ║
╠══════════════════════════════════════════════════════════════════╣
║  Routes:                                                         ║
║    /           - Landing page with QR code                       ║
║    /play       - Player page (DSPs join here)                    ║
║    /host       - Host control panel                              ║
║    /display    - Big screen display                              ║
║    /api/config - Get current configuration                       ║
║    /health     - Health check (for monitoring)                   ║
╚══════════════════════════════════════════════════════════════════╝
  `);
});

