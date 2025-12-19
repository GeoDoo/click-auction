// ============================================
// SESSION MANAGEMENT (Reconnection Support)
// ============================================

import config from './config';
import Logger from './logger';

export interface PlayerData {
  name: string;
  color: string;
  clicks: number;
  adContent: string;
  joinedAt?: number;
  disconnectedRound?: number;
}

export interface Session {
  playerId: string | null;
  playerData: PlayerData;
  disconnectedAt: number | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

const playerSessions: Record<string, Session> = {};
const socketToSession: Record<string, string> = {};

/**
 * Generate a unique session token
 */
export function generateSessionToken(): string {
  return 'sess_' + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

/**
 * Create a new session for a player
 */
export function createSession(socketId: string, playerData: PlayerData): string {
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
export function markSessionDisconnected(socketId: string): string | null {
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
export function restoreSession(token: string, newSocketId: string): PlayerData | null {
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
export function expireSession(token: string): void {
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
export function getSessionByToken(token: string): Session | null {
  return playerSessions[token] || null;
}

/**
 * Cleanup expired sessions
 */
export function cleanupExpiredSessions(): void {
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
export function getAllSessions(): { playerSessions: Record<string, Session>; socketToSession: Record<string, string> } {
  return { playerSessions, socketToSession };
}

