import { Server } from 'socket.io';
import config from './config';
import * as validation from './validation';
import * as session from './session';
import * as auth from './auth';
import * as botDetection from './botDetection';
import * as persistence from './persistence';
import Logger from './logger';
import {
  gameState,
  getLeaderboard,
  broadcastState,
  getNextColor,
  clearAllIntervals,
  resetGame,
  startBidding,
  setCountdownInterval,
  clearCountdownInterval,
} from './game';
import { CustomSocket, Player } from './types';

// Track connections by IP
const connectionsByIP: Record<string, number> = {};

// Track authenticated host sockets
const authenticatedHostSockets = new Set<string>();

function getClientIP(socket: CustomSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return forwardedStr.split(',')[0].trim();
  }
  return socket.handshake.address;
}

export function setupSocketIO(io: Server): void {
  // Connection limiting middleware
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

  // Connection cleanup
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

  // Main connection handler
  io.on('connection', (socket: CustomSocket) => {
    Logger.debug(`Client connected: ${socket.id}`);

    // Host authentication
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

    const isAuthenticatedHost = (): boolean => authenticatedHostSockets.has(socket.id);

    // Send initial state
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

    // Join game
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

    // Rejoin game
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

    // Click
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

    // Start auction
    socket.on('startAuction', (settings?: { duration?: number; countdown?: number }) => {
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

      const interval = setInterval(() => {
        gameState.timeRemaining--;
        broadcastState();

        if (gameState.timeRemaining <= 0) {
          clearCountdownInterval();
          startBidding();
        }
      }, 1000);
      setCountdownInterval(interval);
    });

    // Reset auction
    socket.on('resetAuction', () => {
      if (!isAuthenticatedHost()) {
        Logger.security('Unauthorized resetAuction attempt', socket.id);
        return;
      }

      clearAllIntervals();
      resetGame();
      broadcastState();
    });

    // Reset all-time stats
    socket.on('resetAllTimeStats', async () => {
      if (!isAuthenticatedHost()) {
        Logger.security('Unauthorized resetAllTimeStats attempt', socket.id);
        return;
      }

      await persistence.resetAllStats();
      Logger.info('All-time stats reset by host');
      broadcastState();
    });

    // Disconnect
    socket.on('disconnect', () => {
      validation.cleanupRateLimitData(socket.id);
      botDetection.resetBotDetectionData(socket.id);
      authenticatedHostSockets.delete(socket.id);

      if (gameState.players[socket.id]) {
        const playerName = gameState.players[socket.id].name;
        const isActiveAuction = gameState.status === 'countdown' || gameState.status === 'bidding';

        const token = session.markSessionDisconnected(socket.id);

        if (token) {
          const sessionData = session.getSessionByToken(token);
          if (sessionData) {
            sessionData.playerData = { ...gameState.players[socket.id] };
            sessionData.playerData.disconnectedRound = gameState.round;
          }
          Logger.playerAction('disconnected (grace period)', playerName);
        } else {
          Logger.playerAction('disconnected', playerName);
        }

        if (!isActiveAuction) {
          delete gameState.players[socket.id];
        }
        broadcastState();
      }
    });
  });
}

