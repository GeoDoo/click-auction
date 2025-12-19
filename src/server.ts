import 'dotenv/config';
import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import config from './config';
import * as persistence from './persistence';
import * as validation from './validation';
import * as botDetection from './botDetection';
import * as session from './session';
import * as auth from './auth';
import Logger from './logger';
import { setIO, gameState, clearAllIntervals } from './game';
import { setupSocketIO } from './socket';
import { getLocalIP } from './routes';

// Create server
const server = http.createServer(app);
const io = new Server(server);

// Initialize game module with io instance
setIO(io);

// Setup socket handlers
setupSocketIO(io);

// Memory cleanup
function cleanupStaleData(): void {
  const activeSocketIds = new Set(Object.keys(gameState.players));
  let cleanedCount = 0;

  const timestamps = validation.getClickTimestamps();
  for (const socketId of Object.keys(timestamps)) {
    if (!activeSocketIds.has(socketId)) {
      validation.cleanupRateLimitData(socketId);
      cleanedCount++;
    }
  }

  cleanedCount += botDetection.cleanupBotDetectionData(activeSocketIds);

  if (cleanedCount > 0) {
    Logger.debug(`Memory cleanup: removed ${cleanedCount} stale entries`);
  }

  session.cleanupExpiredSessions();
  auth.cleanupExpiredHostTokens();
}

const cleanupIntervalId = setInterval(cleanupStaleData, config.CLEANUP_INTERVAL_MS);

// Error handling
process.on('uncaughtException', (err: Error) => {
  Logger.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  Logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

io.engine.on('connection_error', (err: Error) => {
  Logger.error('Socket.io connection error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  Logger.info('Received SIGTERM, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  persistence.saveScores().then(() => process.exit(0));
});

process.on('SIGINT', () => {
  Logger.info('Received SIGINT, cleaning up...');
  clearInterval(cleanupIntervalId);
  clearAllIntervals();
  persistence.saveScores().then(() => process.exit(0));
});

// Start server
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
