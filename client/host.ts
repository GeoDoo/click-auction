// ==========================================
// Host Page - Auction Control Panel
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './logger';

interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished' | 'lobby';
  playerCount: number;
  round: number;
}

const socket: Socket = io();
let isAuthenticated = false;
let currentStatus: GameState['status'] = 'waiting';

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
  const token = getAuthToken();
  if (token) {
    socket.emit('authenticateHost', { token });
  } else {
    Logger.warn('No auth token found - host controls will not work');
  }
});

socket.on('hostAuthenticated', (data: { success: boolean }) => {
  isAuthenticated = data.success;
  if (isAuthenticated) {
    Logger.debug('Host socket authenticated');
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
    if (startBtn) startBtn.disabled = false;
  } else {
    Logger.warn('Host session expired, redirecting to login');
    window.location.href = '/host-login';
  }
});

socket.on('connect_error', (err: Error) => {
  Logger.error('Socket connection error:', err.message);
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
  currentStatus = state.status;
  
  const playerCount = document.getElementById('playerCount');
  if (playerCount) {
    playerCount.textContent = `${state.playerCount} Players Connected`;
  }

  const gameStatus = document.getElementById('gameStatus');
  const newGameBtn = document.getElementById('newGameBtn') as HTMLButtonElement | null;
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;

  // Determine if game is in progress
  const isGameInProgress = ['countdown', 'bidding', 'stage2_countdown', 'stage2_tap'].includes(state.status);
  const isLobbyOpen = state.status === 'waiting' || state.status === 'lobby';
  const isFinished = state.status === 'finished';

  // Update status message
  if (gameStatus) {
    const statusMessages: Record<string, string> = {
      waiting: 'Click "New Game" to open lobby for players',
      lobby: `🎮 Lobby open! Round ${state.round + 1} • Waiting for players...`,
      countdown: '⏳ Countdown in progress...',
      bidding: '🔥 Click Auction in progress!',
      stage2_countdown: '⏳ Fastest Finger countdown...',
      stage2_tap: '⚡ Fastest Finger in progress!',
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
  }
}
window.newGame = newGame;
window.startAuction = startAuction;
window.resetAll = resetAll;

