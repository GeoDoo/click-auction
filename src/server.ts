import 'dotenv/config';

import express, { Request, Response, NextFunction } from 'express';
import { Server, Socket } from 'socket.io';
import http from 'http';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import os from 'os';

// Import modules
import config from './config';
import * as validation from './validation';
import * as session from './session';
import * as auth from './auth';
import * as botDetection from './botDetection';
import * as persistence from './persistence';
import Logger from './logger';
import * as middleware from './middleware';

// Extend Socket type to include custom properties
interface CustomSocket extends Socket {
  clientIP?: string;
}

// Player type
interface Player {
  name: string;
  clicks: number;
  color: string;
  adContent: string;
  suspicious?: boolean;
  suspicionReason?: string | null;
}

// Leaderboard entry type
interface LeaderboardEntry {
  id: string;
  name: string;
  clicks: number;
  color: string;
  suspicious: boolean;
}

// Winner type
interface Winner extends Player {
  id: string;
}

// Game state type
interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'finished';
  players: Record<string, Player>;
  auctionDuration: number;
  countdownDuration: number;
  timeRemaining: number;
  winner: Winner | null;
  winnerAd: string | null;
  round: number;
  finalLeaderboard: LeaderboardEntry[];
}

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
const connectionsByIP: Record<string, number> = {};

function getClientIP(socket: CustomSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return forwardedStr.split(',')[0].trim();
  }
  return socket.handshake.address;
}

io.use((socket: CustomSocket, next) => {
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

io.on('connection', (socket: CustomSocket) => {
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
const gameState: GameState = {
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

let countdownInterval: ReturnType<typeof setInterval> | null = null;
let biddingInterval: ReturnType<typeof setInterval> | null = null;
let colorIndex = 0;

function clearAllIntervals(): void {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (biddingInterval) {
    clearInterval(biddingInterval);
    biddingInterval = null;
  }
}

function getNextColor(): string {
  const color = config.DSP_COLORS[colorIndex % config.DSP_COLORS.length];
  colorIndex++;
  return color;
}

function resetGame(): void {
  // Remove disconnected players (they stayed during active auction for leaderboard)
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

function getLeaderboard(): LeaderboardEntry[] {
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

function broadcastState(): void {
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
function getLocalIP(): string | null {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
      if (net.family === 'IPv4' && !net.internal && net.address.startsWith('192.168.')) {
        return net.address;
      }
    }
  }
  for (const name of Object.keys(nets)) {
    const netList = nets[name];
    if (!netList) continue;
    for (const net of netList) {
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

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    players: Object.keys(gameState.players).length,
    round: gameState.round,
  });
});

app.get('/api/config', (req: Request, res: Response) => {
  const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
  const isLocal = host.includes('localhost') || /^127\./.test(host) || /^\d+\.\d+\.\d+\.\d+:\d+$/.test(host);

  let baseUrl: string;
  if (isLocal) {
    const localIP = getLocalIP();
    const port = host.split(':')[1] || config.PORT;
    baseUrl = localIP ? `http://${localIP}:${port}` : `${protocol}://${host}`;
  } else {
    baseUrl = `${protocol}://${host}`;
  }

  res.json({ baseUrl, mode: isLocal ? 'local' : 'production' });
});

// Works for both ts-node (source) and compiled (dist/) mode
const publicDir = path.join(process.cwd(), 'public');

app.get('/', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'display.html'));
});

app.get('/play', (_req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, 'play.html'));
});

app.get('/host', (req: Request, res: Response): void => {
  if (!config.HOST_PIN) {
    res.sendFile(path.join(publicDir, 'host.html'));
    return;
  }

  const cookieHeader = req.headers.cookie || '';
  const authToken = (req.query.auth as string) || cookieHeader.match(/hostAuth=([^;]+)/)?.[1];

  Logger.debug(`Host access attempt - cookie: "${cookieHeader.substring(0, 50)}...", token: ${authToken ? 'found' : 'missing'}`);

  if (auth.isValidHostAuthToken(authToken)) {
    Logger.debug('Host token valid, serving host.html');
    res.sendFile(path.join(publicDir, 'host.html'));
    return;
  }

  Logger.debug('Host token invalid or missing, redirecting to login');
  res.redirect('/host-login');
});

app.get('/host-login', (_req: Request, res: Response): void => {
  if (!config.HOST_PIN) {
    res.redirect('/host');
    return;
  }
  res.sendFile(path.join(publicDir, 'host-login.html'));
});

// JSON body parser MUST be before routes that use req.body
app.use(express.json());

app.post('/api/host/auth', (req: Request, res: Response): void => {
  const { pin } = req.body;
  const result = auth.verifyPinAndCreateToken(pin);

  if (!result.success) {
    Logger.security('Invalid host PIN attempt', req.ip || 'unknown');
    res.status(401).json(result);
    return;
  }

  Logger.info('Host authenticated');
  res.json(result);
});

app.use(express.static(publicDir));

app.get('/api/stats', (_req: Request, res: Response) => {
  res.json({
    allTime: persistence.getAllTimeLeaderboard(),
    totalRounds: gameState.round,
    totalPlayers: persistence.getStats() ? Object.keys(persistence.getStats()).length : 0,
  });
});

// ============================================
// SOCKET HANDLERS
// ============================================

// Track authenticated host sockets
const authenticatedHostSockets = new Set<string>();

io.on('connection', (socket: CustomSocket) => {
  Logger.debug(`Client connected: ${socket.id}`);

  // Host authentication via socket
  socket.on('authenticateHost', (data: { token?: string }) => {
    const token = data && data.token;
    if (token && auth.isValidHostAuthToken(token)) {
      authenticatedHostSockets.add(socket.id);
      socket.emit('hostAuthenticated', { success: true });
      Logger.debug(`Host socket authenticated: ${socket.id.substr(0, 8)}`);
    } else {
      socket.emit('hostAuthenticated', { success: false });
    }
  });

  // Helper to check if socket is authenticated host
  const isAuthenticatedHost = (): boolean => authenticatedHostSockets.has(socket.id);

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

  socket.on('joinGame', (data: { name?: string; adContent?: string }) => {
    if (Object.keys(gameState.players).length >= config.MAX_PLAYERS) {
      socket.emit('joinError', { message: 'Game is full! Maximum players reached.' });
      return;
    }

    const safeData = data && typeof data === 'object' ? data : {};
    const name = validation.sanitizeString(safeData.name, config.MAX_NAME_LENGTH);
    const adContent = validation.sanitizeString(safeData.adContent, config.MAX_AD_CONTENT_LENGTH);

    const playerName = name || `DSP-${socket.id.substr(0, 4)}`;

    const playerData: Player = {
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

  socket.on('rejoinGame', (data: { token?: string }) => {
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

    // Reset clicks if rejoining in a different round (prevent carrying over old clicks)
    if (sessionData.playerData.disconnectedRound !== undefined && sessionData.playerData.disconnectedRound !== gameState.round) {
      playerData.clicks = 0;
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

  socket.on('startAuction', (settings?: { duration?: number; countdown?: number }) => {
    // Security: Only authenticated hosts can start auctions
    if (!isAuthenticatedHost()) {
      Logger.security('Unauthorized startAuction attempt', socket.id);
      return;
    }

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
        clearInterval(countdownInterval!);
        countdownInterval = null;
        startBidding();
      }
    }, 1000);
  });

  socket.on('resetAuction', () => {
    // Security: Only authenticated hosts can reset auctions
    if (!isAuthenticatedHost()) {
      Logger.security('Unauthorized resetAuction attempt', socket.id);
      return;
    }

    clearAllIntervals();
    resetGame();
    broadcastState();
  });

  socket.on('resetAllTimeStats', async () => {
    // Security: Only authenticated hosts can reset stats
    if (!isAuthenticatedHost()) {
      Logger.security('Unauthorized resetAllTimeStats attempt', socket.id);
      return;
    }

    await persistence.resetAllStats();
    Logger.info('All-time stats reset by host');
    broadcastState();
  });

  socket.on('disconnect', () => {
    validation.cleanupRateLimitData(socket.id);
    botDetection.resetBotDetectionData(socket.id);
    authenticatedHostSockets.delete(socket.id); // Clean up host auth

    if (gameState.players[socket.id]) {
      const playerName = gameState.players[socket.id].name;
      const isActiveAuction = gameState.status === 'countdown' || gameState.status === 'bidding';

      const token = session.markSessionDisconnected(socket.id);

      if (token) {
        const sessionData = session.getSessionByToken(token);
        if (sessionData) {
          sessionData.playerData = { ...gameState.players[socket.id] };
          sessionData.playerData.disconnectedRound = gameState.round; // Track which round they disconnected in
        }
        Logger.playerAction('disconnected (grace period)', playerName);
      } else {
        Logger.playerAction('disconnected', playerName);
      }

      // During active auction, keep player in leaderboard (their clicks count!)
      // Only remove from gameState.players when game is idle
      if (!isActiveAuction) {
        delete gameState.players[socket.id];
      }
      broadcastState();
    }
  });
});

// ============================================
// GAME FLOW
// ============================================

function startBidding(): void {
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

function endAuction(): void {
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

  // Save scores asynchronously but don't block the broadcast
  persistence.saveScores().catch((err) => Logger.error('Failed to save scores:', err));

  Logger.gameEvent('Auction ended', { participants: leaderboard.length, winner: winnerName || 'None' });

  broadcastState();
}

// ============================================
// MEMORY CLEANUP
// ============================================

function cleanupStaleData(): void {
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  Logger.error('Express error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('uncaughtException', (err: Error) => {
  Logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

io.engine.on('connection_error', (err: Error) => {
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
  server.listen(Number(config.PORT), config.HOST, () => {
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

// Export for testing
export { app, server, io, gameState };

