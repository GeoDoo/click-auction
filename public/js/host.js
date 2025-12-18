// ==========================================
// Host Page - Auction Control Panel
// ==========================================

const socket = io();
let isAuthenticated = false;

// Get auth token from cookie
function getAuthToken() {
  const match = document.cookie.match(/host_auth=([^;]+)/);
  return match ? match[1] : null;
}

function startAuction() {
  if (!isAuthenticated) {
    Logger.warn('Cannot start auction - not authenticated');
    return;
  }
  const duration = parseInt(document.getElementById('duration').value, 10) || 10;
  Logger.debug('Starting auction with duration:', duration);
  socket.emit('startAuction', { duration });
}

socket.on('connect', () => {
  Logger.debug('Socket connected:', socket.id);
  // Authenticate socket with server
  const token = getAuthToken();
  if (token) {
    socket.emit('authenticateHost', { token });
  } else {
    Logger.warn('No auth token found - host controls will not work');
  }
});

socket.on('hostAuthenticated', (data) => {
  isAuthenticated = data.success;
  if (isAuthenticated) {
    Logger.debug('Host socket authenticated');
    document.getElementById('startBtn').disabled = false;
  } else {
    Logger.error('Host socket authentication failed');
    alert('Authentication failed. Please refresh and log in again.');
  }
});

socket.on('connect_error', (err) => {
  Logger.error('Socket connection error:', err.message);
});

function resetAuction() {
  if (!isAuthenticated) {
    Logger.warn('Cannot reset auction - not authenticated');
    return;
  }
  socket.emit('resetAuction');
}

function updateUI(state) {
  // Update player count in header
  document.getElementById('playerCount').textContent = `${state.playerCount} Players Connected`;

  // Enable/disable buttons based on auction state
  const isLocked = state.status === 'countdown' || state.status === 'bidding';
  document.getElementById('startBtn').disabled = isLocked;
  document.getElementById('resetBtn').disabled = isLocked;
}

socket.on('gameState', updateUI);

function resetAllTimeStats() {
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
window.startAuction = startAuction;
window.resetAuction = resetAuction;
window.resetAllTimeStats = resetAllTimeStats;

