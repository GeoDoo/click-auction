// ==========================================
// Host Page - Auction Control Panel
// ==========================================

const socket = io();

function startAuction() {
  const duration = parseInt(document.getElementById('duration').value, 10) || 10;
  Logger.debug('Starting auction with duration:', duration);
  Logger.debug('Socket connected:', socket.connected);
  socket.emit('startAuction', { duration });
}

socket.on('connect', () => {
  Logger.debug('Socket connected:', socket.id);
});

socket.on('connect_error', (err) => {
  Logger.error('Socket connection error:', err.message);
});

function resetAuction() {
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
  if (confirm('⚠️ This will permanently delete ALL player stats. Are you sure?')) {
    socket.emit('resetAllTimeStats');
    alert('All-time stats have been reset!');
  }
}

// Expose functions to window for onclick handlers
window.startAuction = startAuction;
window.resetAuction = resetAuction;
window.resetAllTimeStats = resetAllTimeStats;

