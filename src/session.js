// ============================================
// SESSION MANAGEMENT (Reconnection Support)
// ============================================

const config = require('./config');
const Logger = require('./logger');

const playerSessions = {}; // { sessionToken: { playerId, playerData, disconnectedAt, timeoutId } }
const socketToSession = {}; // { socketId: sessionToken }

/**
 * Generate a unique session token
 */
function generateSessionToken() {
  return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Create a new session for a player
 */
function createSession(socketId, playerData) {
  const token = generateSessionToken();
  playerSessions[token] = {
    playerId: socketId,
    playerData: { ...playerData },
    disconnectedAt: null,
    timeoutId: null,
  };
  socketToSession[socketId] = token;
  return token;
}

/**
 * Mark a session as disconnected (starts grace period)
 */
function markSessionDisconnected(socketId) {
  const token = socketToSession[socketId];
  if (!token || !playerSessions[token]) return null;

  const session = playerSessions[token];
  session.disconnectedAt = Date.now();
  session.playerId = null;

  // Set timeout to expire session after grace period
  session.timeoutId = setTimeout(() => {
    expireSession(token);
  }, config.RECONNECT_GRACE_PERIOD_MS);

  delete socketToSession[socketId];
  return token;
}

/**
 * Restore a disconnected session
 */
function restoreSession(token, newSocketId) {
  const session = playerSessions[token];
  if (!session) return null;

  // Clear the expiry timeout
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }

  // Update session with new socket ID
  session.playerId = newSocketId;
  session.disconnectedAt = null;
  socketToSession[newSocketId] = token;

  return session.playerData;
}

/**
 * Expire and remove a session
 */
function expireSession(token) {
  const session = playerSessions[token];
  if (session) {
    Logger.debug(`🕐 Session expired: ${session.playerData?.name || 'Unknown'}`);
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    delete playerSessions[token];
  }
}

/**
 * Get session by token
 */
function getSessionByToken(token) {
  return playerSessions[token] || null;
}

/**
 * Cleanup expired sessions
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of Object.entries(playerSessions)) {
    if (session.disconnectedAt && now - session.disconnectedAt > config.RECONNECT_GRACE_PERIOD_MS) {
      expireSession(token);
    }
  }
}

/**
 * Get all sessions (for testing)
 */
function getAllSessions() {
  return { playerSessions, socketToSession };
}

module.exports = {
  generateSessionToken,
  createSession,
  markSessionDisconnected,
  restoreSession,
  expireSession,
  getSessionByToken,
  cleanupExpiredSessions,
  getAllSessions,
};

