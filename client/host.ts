// ==========================================
// Host Page - Auction Control Panel
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './logger';

interface GameState {
  status: 'waiting' | 'auction_countdown' | 'auction' | 'fastestFinger_countdown' | 'fastestFinger_tap' | 'finished' | 'lobby';
  playerCount: number;
  round: number;
}

type LogLevel = 'info' | 'success' | 'warning' | 'error' | 'player';

const socket: Socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
});
let isAuthenticated = false;
let currentStatus: GameState['status'] = 'waiting';
let lastPlayerCount = 0;

// ==========================================
// STATUS LOG
// ==========================================
function addLog(message: string, level: LogLevel = 'info'): void {
  const log = document.getElementById('statusLog');
  if (!log) return;

  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<span class="time">[${time}]</span> ${message}`;
  
  log.insertBefore(entry, log.firstChild);
  
  // Keep max 50 entries
  while (log.children.length > 50) {
    log.removeChild(log.lastChild!);
  }
}

function clearLog(): void {
  const log = document.getElementById('statusLog');
  if (log) {
    log.innerHTML = '<div class="log-entry info"><span class="time">[' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ']</span> Log cleared</div>';
  }
}

function setConnectionStatus(connected: boolean, text?: string): void {
  const dot = document.getElementById('connectionDot');
  const textEl = document.getElementById('connectionText');
  
  if (dot) {
    dot.className = `connection-dot ${connected ? 'connected' : 'disconnected'}`;
  }
  if (textEl) {
    textEl.textContent = text || (connected ? 'Connected' : 'Disconnected');
  }
}

// Get auth token from cookie
function getAuthToken(): string | null {
  const match = document.cookie.match(/hostAuth=([^;]+)/);
  return match ? match[1] : null;
}

// New Game - opens lobby for new registrations, keeps existing player data
function newGame(): void {
  if (!isAuthenticated) {
    Logger.warn('Cannot start new game - not authenticated');
    return;
  }
  Logger.debug('Opening lobby for new game');
  socket.emit('newGame');
}

function startAuction(): void {
  if (!isAuthenticated) {
    Logger.warn('Cannot start auction - not authenticated');
    return;
  }
  const durationInput = document.getElementById('duration') as HTMLInputElement | null;
  const duration = parseInt(durationInput?.value || '10', 10) || 10;
  Logger.debug('Starting auction with duration:', duration);
  socket.emit('startAuction', { duration });
}

socket.on('connect', () => {
  Logger.debug('Socket connected:', socket.id);
  setConnectionStatus(true, 'Connected');
  addLog('Socket connected to server', 'success');
  
  const token = getAuthToken();
  if (token) {
    socket.emit('authenticateHost', { token });
  } else {
    Logger.warn('No auth token found - host controls will not work');
    addLog('No auth token! Go to /host-login', 'error');
  }
});

socket.on('disconnect', (reason: string) => {
  setConnectionStatus(false, 'Disconnected');
  addLog(`Disconnected: ${reason}`, 'error');
});

socket.on('reconnecting', () => {
  const dot = document.getElementById('connectionDot');
  if (dot) dot.className = 'connection-dot reconnecting';
  const textEl = document.getElementById('connectionText');
  if (textEl) textEl.textContent = 'Reconnecting...';
  addLog('Attempting to reconnect...', 'warning');
});

socket.on('reconnect', () => {
  setConnectionStatus(true, 'Reconnected');
  addLog('Reconnected successfully', 'success');
  const token = getAuthToken();
  if (token) socket.emit('authenticateHost', { token });
});

socket.on('reconnect_failed', () => {
  setConnectionStatus(false, 'Connection failed');
  addLog('Failed to reconnect after multiple attempts', 'error');
});

socket.on('hostAuthenticated', (data: { success: boolean }) => {
  isAuthenticated = data.success;
  if (isAuthenticated) {
    Logger.debug('Host socket authenticated');
    addLog('Host authenticated - controls enabled', 'success');
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (startBtn) startBtn.disabled = false;
  } else {
    Logger.warn('Host session expired, redirecting to login');
    addLog('Auth failed! Redirecting to login...', 'error');
    setTimeout(() => { window.location.href = '/host-login'; }, 1500);
  }
});

socket.on('connect_error', (err: Error) => {
  Logger.error('Socket connection error:', err.message);
  setConnectionStatus(false, 'Connection error');
  addLog(`Connection error: ${err.message}`, 'error');
  
  // "Session ID unknown" happens when server restarts and client has stale session
  if (err.message === 'Session ID unknown') {
    Logger.info('Server restarted - forcing fresh connection');
    addLog('Server restarted - reconnecting...', 'warning');
    
    // Force a completely fresh connection by disconnecting and reconnecting
    socket.disconnect();
    setTimeout(() => {
      socket.connect();
    }, 500);
  }
});

// Host-specific events
socket.on('hostEvent', (data: { type: string; message: string; level?: LogLevel }) => {
  addLog(data.message, data.level || 'info');
});

// Reset All - clears ALL history and leaderboard
function resetAll(): void {
  if (!isAuthenticated) {
    Logger.warn('Cannot reset - not authenticated');
    return;
  }
  if (confirm('⚠️ This will permanently delete ALL player stats and reset the game. Are you sure?')) {
    socket.emit('resetAuction');
    socket.emit('resetAllTimeStats');
    Logger.info('All data has been reset');
  }
}

function updateUI(state: GameState): void {
  const prevStatus = currentStatus;
  currentStatus = state.status;
  
  const playerCount = document.getElementById('playerCount');
  if (playerCount) {
    playerCount.textContent = `${state.playerCount} Players Connected`;
  }

  // Log player count changes
  if (state.playerCount !== lastPlayerCount) {
    const diff = state.playerCount - lastPlayerCount;
    if (diff > 0) {
      addLog(`Player joined (total: ${state.playerCount})`, 'player');
    } else if (diff < 0) {
      addLog(`Player left (total: ${state.playerCount})`, 'warning');
    }
    lastPlayerCount = state.playerCount;
  }

  // Log status changes
  if (prevStatus !== state.status) {
    const statusNames: Record<string, string> = {
      waiting: 'Waiting',
      lobby: 'Lobby Open',
      auction_countdown: 'Click Auction Countdown',
      auction: 'Click Auction Active',
      fastestFinger_countdown: 'Fastest Finger Countdown',
      fastestFinger_tap: 'Fastest Finger Active',
      finished: 'Round Finished',
    };
    addLog(`Status → ${statusNames[state.status] || state.status}`, 'info');
  }

  const gameStatus = document.getElementById('gameStatus');
  const newGameBtn = document.getElementById('newGameBtn') as HTMLButtonElement | null;
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;

  // Determine if game is in progress
  const isGameInProgress = ['auction_countdown', 'auction', 'fastestFinger_countdown', 'fastestFinger_tap'].includes(state.status);
  const isLobbyOpen = state.status === 'waiting' || state.status === 'lobby';
  const isFinished = state.status === 'finished';

  // Update status message
  if (gameStatus) {
    const statusMessages: Record<string, string> = {
      waiting: 'Click "New Game" to open lobby for players',
      lobby: `🎮 Lobby open! Round ${state.round + 1} • Waiting for players...`,
      auction_countdown: '⏳ Click Auction countdown...',
      auction: '🔥 Click Auction in progress!',
      fastestFinger_countdown: '⏳ Fastest Finger countdown...',
      fastestFinger_tap: '⚡ Fastest Finger in progress!',
      finished: `✅ Round ${state.round} complete! Click "New Game" for next round`,
    };
    gameStatus.textContent = statusMessages[state.status] || state.status;
    gameStatus.style.color = isGameInProgress ? 'var(--success)' : isFinished ? 'var(--primary)' : '#888';
  }

  // Button states
  if (newGameBtn) {
    newGameBtn.disabled = isGameInProgress;
  }
  if (startBtn) {
    startBtn.disabled = isGameInProgress || (!isLobbyOpen && !isFinished);
  }
}

socket.on('gameState', updateUI);

// Expose functions to window for onclick handlers
declare global {
  interface Window {
    newGame: typeof newGame;
    startAuction: typeof startAuction;
    resetAll: typeof resetAll;
    clearLog: typeof clearLog;
  }
}
window.newGame = newGame;
window.startAuction = startAuction;
window.resetAll = resetAll;
window.clearLog = clearLog;

