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
  startClickAuction,
  setCountdownInterval,
  clearCountdownInterval,
  recordReactionTime,
} from './game';
import { CustomSocket, Player } from './types';

// Track connections by IP
const connectionsByIP: Record<string, number> = {};

// Track authenticated host sockets
const authenticatedHostSockets = new Set<string>();

// Store io instance for broadcasting
let ioInstance: Server | null = null;

// Broadcast event to all authenticated hosts
function broadcastToHosts(type: string, message: string, level: 'info' | 'success' | 'warning' | 'error' | 'player' = 'info'): void {
  if (!ioInstance) return;
  authenticatedHostSockets.forEach((socketId) => {
    ioInstance!.to(socketId).emit('hostEvent', { type, message, level });
  });
}

function getClientIP(socket: CustomSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return forwardedStr.split(',')[0].trim();
  }
  return socket.handshake.address;
}

export function setupSocketIO(io: Server): void {
  ioInstance = io;

  // Connection limiting middleware
  io.use((socket: CustomSocket, next) => {
    const ip = getClientIP(socket);

    if (!connectionsByIP[ip]) {
      connectionsByIP[ip] = 0;
    }

    if (connectionsByIP[ip] >= config.MAX_CONNECTIONS_PER_IP) {
      Logger.security('Connection rejected - limit reached', ip, { limit: config.MAX_CONNECTIONS_PER_IP });
      broadcastToHosts('connection_rejected', `Connection rejected from ${ip} (IP limit: ${config.MAX_CONNECTIONS_PER_IP})`, 'error');
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
        Logger.debug(`Host socket authenticated: ${socket.id.substring(0, 8)}`);
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
      const playerCount = Object.keys(gameState.players).length;
      if (playerCount >= config.MAX_PLAYERS) {
        socket.emit('joinError', { message: 'Game is full! Maximum players reached.' });
        broadcastToHosts('max_players', `Player rejected - MAX_PLAYERS (${config.MAX_PLAYERS}) reached!`, 'error');
        Logger.warn(`❌ Player rejected - game full (${playerCount}/${config.MAX_PLAYERS})`);
        return;
      }

      const safeData = data && typeof data === 'object' ? data : {};
      const name = validation.sanitizeString(safeData.name, config.MAX_NAME_LENGTH);
      const adContent = validation.sanitizeString(safeData.adContent, config.MAX_AD_CONTENT_LENGTH);

      const playerName = name || `DSP-${socket.id.substring(0, 4)}`;

      const playerData: Player = {
        name: playerName,
        clicks: 0,
        color: getNextColor(),
        adContent: adContent || `${playerName} wins! 🎉`,
      };

      gameState.players[socket.id] = playerData;

      const sessionToken = session.createSession(socket.id, playerData);
      socket.emit('sessionCreated', { token: sessionToken });

      const newCount = Object.keys(gameState.players).length;
      Logger.info(`✅ PLAYER JOINED: ${playerName} | Total players: ${newCount}/${config.MAX_PLAYERS}`);
      broadcastToHosts('player_joined', `${playerName} joined (${newCount}/${config.MAX_PLAYERS})`, 'player');
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
      // Click Auction phase - count clicks
      if (gameState.status === 'auction' && gameState.players[socket.id]) {
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

        // Send click confirmation only to the player who clicked (not everyone)
        socket.emit('clickConfirm', {
          clicks: gameState.players[socket.id].clicks,
        });
        
        // Throttled broadcast is handled by the 1-second gameState broadcast
        // No longer broadcasting every click to all clients - too expensive with 200 players
      }
      // Fastest Finger phase - record reaction time
      else if (gameState.status === 'fastestFinger_tap' && gameState.players[socket.id]) {
        const recorded = recordReactionTime(socket.id);
        if (recorded) {
          const playerName = gameState.players[socket.id].name;
          const reactionTime = gameState.players[socket.id].reactionTime;
          Logger.info(`⚡ TAP: ${playerName} - ${reactionTime}ms`);
          io.emit('reactionTimeRecorded', {
            playerId: socket.id,
            playerName: playerName,
            reactionTime: reactionTime,
          });
          broadcastState();
        }
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

      const playerCount = Object.keys(gameState.players).length;
      if (playerCount === 0) {
        broadcastToHosts('start_error', 'Cannot start - no players connected!', 'error');
        return;
      }

      resetGame();
      gameState.round++;
      gameState.status = 'auction_countdown';
      gameState.timeRemaining = gameState.countdownDuration;

      broadcastToHosts('game_started', `Round ${gameState.round} started with ${playerCount} players`, 'success');
      Logger.info(`🚀 ═══════════════════════════════════════════════════════════`);
      Logger.info(`🚀 ROUND ${gameState.round} STARTING!`);
      Logger.info(`🚀 Players: ${playerCount} | Auction: ${gameState.auctionDuration}s | Countdown: ${gameState.countdownDuration}s`);
      Logger.info(`🚀 ═══════════════════════════════════════════════════════════`);
      broadcastState();

      const interval = setInterval(() => {
        gameState.timeRemaining--;
        broadcastState();

        if (gameState.timeRemaining <= 0) {
          clearCountdownInterval();
          startClickAuction();
        }
      }, config.TICK_INTERVAL_MS);
      setCountdownInterval(interval);
    });

    // New Game - opens lobby for new round, keeps cumulative stats
    socket.on('newGame', () => {
      if (!isAuthenticatedHost()) {
        Logger.security('Unauthorized newGame attempt', socket.id);
        return;
      }

      clearAllIntervals();
      
      // Reset player clicks for new round but KEEP player data
      Object.values(gameState.players).forEach((player) => {
        player.clicks = 0;
        player.suspicious = false;
        player.suspicionReason = null;
        player.reactionTime = null;
      });
      
      gameState.status = 'waiting';
      gameState.winner = null;
      gameState.winnerAd = null;
      gameState.timeRemaining = 0;
      gameState.finalLeaderboard = [];
      gameState.auctionScores = {};
      gameState.fastestFingerStartTime = null;
      
      Logger.gameEvent('New game lobby opened', { round: gameState.round + 1 });
      broadcastState();
    });

    // Reset auction (legacy - same as newGame for now)
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
      
      const wasHost = authenticatedHostSockets.has(socket.id);
      authenticatedHostSockets.delete(socket.id);

      if (gameState.players[socket.id]) {
        const playerName = gameState.players[socket.id].name;
        const playerClicks = gameState.players[socket.id].clicks;
        const isActiveAuction = gameState.status === 'auction_countdown' || gameState.status === 'auction';

        const token = session.markSessionDisconnected(socket.id);

        const remainingPlayers = Object.keys(gameState.players).length - 1;
        
        if (token) {
          const sessionData = session.getSessionByToken(token);
          if (sessionData) {
            sessionData.playerData = { ...gameState.players[socket.id] };
            sessionData.playerData.disconnectedRound = gameState.round;
          }
          Logger.warn(`⚠️  PLAYER DISCONNECTED: ${playerName} (clicks: ${playerClicks}) - can reconnect | Remaining: ${remainingPlayers}`);
          broadcastToHosts('player_disconnected', `${playerName} disconnected (can reconnect)`, 'warning');
        } else {
          Logger.warn(`👋 PLAYER LEFT: ${playerName} (clicks: ${playerClicks}) | Remaining: ${remainingPlayers}`);
          broadcastToHosts('player_disconnected', `${playerName} left`, 'warning');
        }

        if (!isActiveAuction) {
          delete gameState.players[socket.id];
        }
        broadcastState();
      } else if (wasHost) {
        Logger.info(`🎛️  Host disconnected`);
      }
    });
  });
}

