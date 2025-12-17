const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============================================
// CONFIGURATION
// ============================================
// Set BASE_URL environment variable for production, or leave empty for local network mode
// Examples:
//   LOCAL: unset or empty (uses auto-detected local IP)
//   PRODUCTION: BASE_URL=https://click-auction.onrender.com
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || null; // null = auto-detect local IP

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function getBaseUrl() {
  if (BASE_URL) {
    return BASE_URL;
  }
  const localIP = getLocalIP();
  return `http://${localIP}:${PORT}`;
}

// API endpoint for clients to get the base URL
app.get('/api/config', (req, res) => {
  res.json({
    baseUrl: getBaseUrl(),
    mode: BASE_URL ? 'production' : 'local'
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// PERSISTENT SCORES (survives server restarts)
// ============================================
const SCORES_FILE = path.join(__dirname, 'scores.json');

// All-time stats structure: { "PlayerName": { wins, totalClicks, roundsPlayed, bestRound, lastPlayed } }
let allTimeStats = {};

function loadScores() {
  try {
    if (fs.existsSync(SCORES_FILE)) {
      const data = fs.readFileSync(SCORES_FILE, 'utf8');
      allTimeStats = JSON.parse(data);
      console.log(`📊 Loaded ${Object.keys(allTimeStats).length} player records from scores.json`);
    }
  } catch (err) {
    console.error('Error loading scores:', err);
    allTimeStats = {};
  }
}

function saveScores() {
  try {
    fs.writeFileSync(SCORES_FILE, JSON.stringify(allTimeStats, null, 2));
    console.log('💾 Scores saved to scores.json');
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

function resetGame() {
  Object.keys(gameState.players).forEach(id => {
    gameState.players[id].clicks = 0;
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
      color: player.color
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
    const { name, adContent } = data;
    gameState.players[socket.id] = {
      name: name || `DSP-${socket.id.substr(0, 4)}`,
      clicks: 0,
      color: getNextColor(),
      adContent: adContent || `${name || 'Anonymous'} wins! 🎉`
    };
    console.log(`Player joined: ${gameState.players[socket.id].name}`);
    broadcastState();
  });

  // Player clicks
  socket.on('click', () => {
    if (gameState.status === 'bidding' && gameState.players[socket.id]) {
      gameState.players[socket.id].clicks++;
      // Emit to all clients for real-time leaderboard updates
      io.emit('clickUpdate', {
        playerId: socket.id,
        playerName: gameState.players[socket.id].name,
        clicks: gameState.players[socket.id].clicks,
        color: gameState.players[socket.id].color
      });
    }
  });

  // Host controls
  socket.on('startAuction', (settings) => {
    if (settings) {
      gameState.auctionDuration = settings.duration || 10;
    }
    
    resetGame();
    gameState.round++;
    gameState.status = 'countdown';
    gameState.timeRemaining = gameState.countdownDuration;
    
    broadcastState();
    
    // Countdown timer
    const countdownInterval = setInterval(() => {
      gameState.timeRemaining--;
      broadcastState();
      
      if (gameState.timeRemaining <= 0) {
        clearInterval(countdownInterval);
        startBidding();
      }
    }, 1000);
  });

  socket.on('resetAuction', () => {
    resetGame();
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
  
  const biddingInterval = setInterval(() => {
    gameState.timeRemaining--;
    broadcastState();
    
    if (gameState.timeRemaining <= 0) {
      clearInterval(biddingInterval);
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

// Routes
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

// API endpoints for stats
app.get('/api/stats', (req, res) => {
  res.json({
    allTime: getAllTimeLeaderboard(),
    totalRounds: gameState.round,
    totalPlayers: Object.keys(allTimeStats).length
  });
});

app.post('/api/stats/reset', (req, res) => {
  allTimeStats = {};
  saveScores();
  console.log('🗑️ All-time stats reset');
  broadcastState();
  res.json({ success: true, message: 'Stats reset' });
});

const HOST = '0.0.0.0'; // Listen on all network interfaces

server.listen(PORT, HOST, () => {
  const baseUrl = getBaseUrl();
  const mode = BASE_URL ? 'PRODUCTION' : 'LOCAL NETWORK';
  
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      🎯 CLICK AUCTION 🎯                          ║
╠══════════════════════════════════════════════════════════════════╣
║  Mode: ${mode.padEnd(56)}║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  🌐 Base URL: ${baseUrl.padEnd(49)}║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  SHARE THIS WITH PLAYERS:                                        ║
║                                                                  ║
║     ${(baseUrl + '/play').padEnd(59)}║
║                                                                  ║
╠══════════════════════════════════════════════════════════════════╣
║  Routes:                                                         ║
║    /           - Landing page with QR code                       ║
║    /play       - Player page (DSPs join here)                    ║
║    /host       - Host control panel                              ║
║    /display    - Big screen display                              ║
║    /api/config - Get current configuration                       ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
  `);
});

