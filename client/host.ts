// ==========================================
// Host Page - Auction Control Panel
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './lib/logger';

interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'finished';
  playerCount: number;
}

const socket: Socket = io();
let isAuthenticated = false;

// Get auth token from cookie
function getAuthToken(): string | null {
  const match = document.cookie.match(/hostAuth=([^;]+)/);
  return match ? match[1] : null;
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

function resetAuction(): void {
  if (!isAuthenticated) {
    Logger.warn('Cannot reset auction - not authenticated');
    return;
  }
  socket.emit('resetAuction');
}

function updateUI(state: GameState): void {
  const playerCount = document.getElementById('playerCount');
  if (playerCount) {
    playerCount.textContent = `${state.playerCount} Players Connected`;
  }

  const isLocked = state.status === 'countdown' || state.status === 'bidding';
  const startBtn = document.getElementById('startBtn') as HTMLButtonElement | null;
  const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement | null;

  if (startBtn) startBtn.disabled = isLocked;
  if (resetBtn) resetBtn.disabled = isLocked;
}

socket.on('gameState', updateUI);

function resetAllTimeStats(): void {
  if (!isAuthenticated) {
    Logger.warn('Cannot reset stats - not authenticated');
    return;
  }
  if (confirm('⚠️ This will permanently delete ALL player stats. Are you sure?')) {
    socket.emit('resetAllTimeStats');
    alert('All-time stats have been reset!');
  }
}

// Expose functions to window for onclick handlers
declare global {
  interface Window {
    startAuction: typeof startAuction;
    resetAuction: typeof resetAuction;
    resetAllTimeStats: typeof resetAllTimeStats;
  }
}
window.startAuction = startAuction;
window.resetAuction = resetAuction;
window.resetAllTimeStats = resetAllTimeStats;

