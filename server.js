require('dotenv').config();

const express = require('express');
const { Server } = require('socket.io');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

// Import modules
const { config, validation, session, auth, botDetection, persistence } = require('./src');
const Logger = require('./src/logger');
const middleware = require('./src/middleware');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ============================================
// SECURITY MIDDLEWARE
// ============================================

app.set('trust proxy', 1);
app.use(cors());

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https://api.qrserver.com'],
      connectSrc: ["'self'", 'wss:', 'ws:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: false,
}));

app.use(compression());

// Request logging
app.use(middleware.requestLogger());

// Caching headers for static assets
app.use(middleware.cacheControl({ maxAge: 3600 }));

// ============================================
// SOCKET CONNECTION LIMITING (per IP)
// ============================================
const connectionsByIP = {};

function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address;
}

io.use((socket, next) => {
  const ip = getClientIP(socket);

  if (!connectionsByIP[ip]) {
    connectionsByIP[ip] = 0;
  }

  if (connectionsByIP[ip] >= config.MAX_CONNECTIONS_PER_IP) {
    Logger.security('Connection rejected - limit reached', ip, { limit: config.MAX_CONNECTIONS_PER_IP });
    return next(new Error('Too many connections from this IP'));
  }

  connectionsByIP[ip]++;
  socket.clientIP = ip;
  Logger.debug(`Connection from ${ip} (${connectionsByIP[ip]}/${config.MAX_CONNECTIONS_PER_IP})`);
  next();
});

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    if (socket.clientIP && connectionsByIP[socket.clientIP]) {
      connectionsByIP[socket.clientIP]--;
      if (connectionsByIP[socket.clientIP] <= 0) {
        delete connectionsByIP[socket.clientIP];
      }
    }
  });
});

// ============================================
// GAME STATE
// ============================================
const gameState = {
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

let countdownInterval = null;
let biddingInterval = null;
let colorIndex = 0;

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

function getNextColor() {
  const color = config.DSP_COLORS[colorIndex % config.DSP_COLORS.length];
  colorIndex++;
  return color;
}

function resetGame() {
  Object.keys(gameState.players).forEach((id) => {
    gameState.players[id].clicks = 0;
    gameState.players[id].suspicious = false;
    gameState.players[id].suspicionReason = null;
    botDetection.resetBotDetectionData(id);
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
      suspicious: player.suspicious || false,
    }))
    .sort((a, b) => b.clicks - a.clicks);
}

function broadcastState() {
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

// ============================================
// UTILITY FUNCTIONS
// ============================================
function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) {
        return net.address;
      }
    }
  }
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

// ============================================
// ROUTES
// ============================================

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    players: Object.keys(gameState.players).length,
    round: gameState.round,
  });
});

app.get('/api/config', (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const isLocal = host.includes('localhost') || host.match(/^127\./) || host.match(/^\d+\.\d+\.\d+\.\d+:\d+$/);

  let baseUrl;
  if (isLocal) {
    const localIP = getLocalIP();
    const port = host.split(':')[1] || config.PORT;
    baseUrl = localIP ? `http://${localIP}:${port}` : `${protocol}://${host}`;
  } else {
    baseUrl = `${protocol}://${host}`;
  }

  res.json({ baseUrl, mode: isLocal ? 'local' : 'production' });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'display.html'));
});

app.get('/play', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

app.get('/host', (req, res) => {
  if (!config.HOST_PIN) {
    return res.sendFile(path.join(__dirname, 'public', 'host.html'));
  }

  const authToken = req.query.auth || req.headers.cookie?.match(/hostAuth=([^;]+)/)?.[1];

  if (auth.isValidHostAuthToken(authToken)) {
    return res.sendFile(path.join(__dirname, 'public', 'host.html'));
  }

  res.redirect('/host-login');
});

app.get('/host-login', (_req, res) => {
  if (!config.HOST_PIN) {
    return res.redirect('/host');
  }
  res.sendFile(path.join(__dirname, 'public', 'host-login.html'));
});

app.use(express.json());

app.post('/api/host/auth', (req, res) => {
  const { pin } = req.body;
  const result = auth.verifyPinAndCreateToken(pin);

  if (!result.success) {
    Logger.security('Invalid host PIN attempt', req.ip);
    return res.status(401).json(result);
  }

  Logger.info('Host authenticated');
  res.json(result);
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stats', (_req, res) => {
  res.json({
    allTime: persistence.getAllTimeLeaderboard(),
    totalRounds: gameState.round,
    totalPlayers: persistence.getStats() ? Object.keys(persistence.getStats()).length : 0,
  });
});

// ============================================
// SOCKET HANDLERS
// ============================================

io.on('connection', (socket) => {
  Logger.debug(`Client connected: ${socket.id}`);

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
    allTimeLeaderboard: persistence.getAllTimeLeaderboard().slice(0, 20),
  });

  socket.on('joinGame', (data) => {
    if (Object.keys(gameState.players).length >= config.MAX_PLAYERS) {
      socket.emit('joinError', { message: 'Game is full! Maximum players reached.' });
      return;
    }

    const safeData = data && typeof data === 'object' ? data : {};
    const name = validation.sanitizeString(safeData.name, config.MAX_NAME_LENGTH);
    const adContent = validation.sanitizeString(safeData.adContent, config.MAX_AD_CONTENT_LENGTH);

    const playerName = name || `DSP-${socket.id.substr(0, 4)}`;

    const playerData = {
      name: playerName,
      clicks: 0,
      color: getNextColor(),
      adContent: adContent || `${playerName} wins! 🎉`,
    };

    gameState.players[socket.id] = playerData;

    const sessionToken = session.createSession(socket.id, playerData);
    socket.emit('sessionCreated', { token: sessionToken });

    Logger.playerAction('joined', playerName, { session: sessionToken.substr(0, 12) });
    broadcastState();
  });

  socket.on('rejoinGame', (data) => {
    const safeData = data && typeof data === 'object' ? data : {};
    const token = safeData.token;

    if (!token || typeof token !== 'string') {
      socket.emit('rejoinError', { message: 'Invalid session token' });
      return;
    }

    const sessionData = session.getSessionByToken(token);
    if (!sessionData) {
      socket.emit('rejoinError', { message: 'Session expired or not found' });
      return;
    }

    if (sessionData.playerId && sessionData.playerId !== socket.id) {
      socket.emit('rejoinError', { message: 'Session already in use' });
      return;
    }

    const playerData = session.restoreSession(token, socket.id);
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

    Logger.playerAction('reconnected', playerData.name);
    broadcastState();
  });

  socket.on('click', () => {
    if (gameState.status === 'bidding' && gameState.players[socket.id]) {
      if (validation.isRateLimited(socket.id)) {
        return;
      }

      botDetection.recordClickInterval(socket.id);
      gameState.players[socket.id].clicks++;

      const suspicionCheck = botDetection.isSuspiciousClicker(socket.id);
      gameState.players[socket.id].suspicious = suspicionCheck.suspicious;
      if (suspicionCheck.suspicious) {
        gameState.players[socket.id].suspicionReason = suspicionCheck.reason;
      }

      io.emit('clickUpdate', {
        playerId: socket.id,
        playerName: gameState.players[socket.id].name,
        clicks: gameState.players[socket.id].clicks,
        color: gameState.players[socket.id].color,
        suspicious: suspicionCheck.suspicious,
      });
    }
  });

  socket.on('startAuction', (settings) => {
    clearAllIntervals();

    if (settings && typeof settings === 'object') {
      if (settings.duration !== undefined) {
        gameState.auctionDuration = validation.validateAuctionDuration(settings.duration);
      }
      if (settings.countdown !== undefined) {
        gameState.countdownDuration = validation.validateCountdownDuration(settings.countdown);
      }
    }

    gameState.countdownDuration = validation.validateCountdownDuration(gameState.countdownDuration);

    resetGame();
    gameState.round++;
    gameState.status = 'countdown';
    gameState.timeRemaining = gameState.countdownDuration;

    broadcastState();

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

  socket.on('resetAllTimeStats', async () => {
    persistence.resetAllStats();
    await persistence.saveScores();
    Logger.info('All-time stats reset by host');
    broadcastState();
  });

  socket.on('disconnect', () => {
    validation.cleanupRateLimitData(socket.id);
    botDetection.resetBotDetectionData(socket.id);

    if (gameState.players[socket.id]) {
      const playerName = gameState.players[socket.id].name;

      const token = session.markSessionDisconnected(socket.id);

      if (token) {
        const sessionData = session.getSessionByToken(token);
        if (sessionData) {
          sessionData.playerData = { ...gameState.players[socket.id] };
        }
        Logger.playerAction('disconnected (grace period)', playerName);
      } else {
        Logger.playerAction('disconnected', playerName);
      }

      delete gameState.players[socket.id];
      broadcastState();
    }
  });
});

// ============================================
// GAME FLOW
// ============================================

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

  const leaderboard = getLeaderboard();
  gameState.finalLeaderboard = leaderboard;

  let winnerName = null;
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

  // Save scores asynchronously but don't block the broadcast
  persistence.saveScores().catch((err) => Logger.error('Failed to save scores:', err));

  Logger.gameEvent('Auction ended', { participants: leaderboard.length, winner: winnerName || 'None' });

  broadcastState();
}

// ============================================
// MEMORY CLEANUP
// ============================================

function cleanupStaleData() {
  const activeSocketIds = new Set(Object.keys(gameState.players));
  let cleanedCount = 0;

  // Cleanup validation rate limit data
  const timestamps = validation.getClickTimestamps();
  for (const socketId of Object.keys(timestamps)) {
    if (!activeSocketIds.has(socketId)) {
      validation.cleanupRateLimitData(socketId);
      cleanedCount++;
    }
  }

  // Cleanup bot detection data
  cleanedCount += botDetection.cleanupBotDetectionData(activeSocketIds);

  if (cleanedCount > 0) {
    Logger.debug(`Memory cleanup: removed ${cleanedCount} stale entries`);
  }

  session.cleanupExpiredSessions();
  auth.cleanupExpiredHostTokens();
}

const cleanupIntervalId = setInterval(cleanupStaleData, config.CLEANUP_INTERVAL_MS);

// ============================================
// ERROR HANDLING
// ============================================

app.use((err, _req, res, _next) => {
  Logger.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', (err) => {
  Logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

io.engine.on('connection_error', (err) => {
  Logger.error('Socket.io connection error:', err.message);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on('SIGTERM', () => {
  Logger.info('Received SIGTERM, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  persistence.saveScores().then(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  Logger.info('Received SIGINT, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  persistence.saveScores().then(() => {
    process.exit(0);
  });
});

// ============================================
// START SERVER
// ============================================

// Load scores before starting server to prevent race conditions
persistence.loadScores().then(() => {
  server.listen(config.PORT, config.HOST, () => {
  const localIP = getLocalIP() || 'localhost';
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      🎯 CLICK AUCTION 🎯                          ║
╠══════════════════════════════════════════════════════════════════╣
║  Server running on port ${String(config.PORT).padEnd(39)}║
║  Max players: ${String(config.MAX_PLAYERS).padEnd(50)}║
║  Max connections per IP: ${String(config.MAX_CONNECTIONS_PER_IP).padEnd(39)}║
║  Reconnect grace period: ${String(config.RECONNECT_GRACE_PERIOD_MS / 1000 + 's').padEnd(39)}║
║  Host PIN protection: ${config.HOST_PIN ? '✓ Enabled' : '✗ Disabled (set HOST_PIN env var)'}${config.HOST_PIN ? '                            ' : ''}║
╠══════════════════════════════════════════════════════════════════╣
║  Security: Helmet ✓  Compression ✓  Rate Limiting ✓              ║
║  Features: Reconnection ✓  Session Management ✓                  ║
║  QR codes auto-detect the correct URL from browser               ║
╠══════════════════════════════════════════════════════════════════╣
║  Local:    http://localhost:${String(config.PORT).padEnd(45)}║
║  Network:  http://${(localIP + ':' + config.PORT).padEnd(47)}║
╠══════════════════════════════════════════════════════════════════╣
║  Routes:                                                         ║
║    /           - Main display (big screen + QR code)             ║
║    /play       - Player page (DSPs join here)                    ║
║    /host       - Host control panel                              ║
║    /api/config - Get current configuration                       ║
║    /health     - Health check (for monitoring)                   ║
╚══════════════════════════════════════════════════════════════════╝
  `);
  });
});
