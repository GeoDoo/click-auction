// ==========================================
// Host Page - Auction Control Panel
// ==========================================

const socket = io();

function startAuction() {
  const duration = parseInt(document.getElementById('duration').value) || 10;
  console.log('Starting auction with duration:', duration);
  console.log('Socket connected:', socket.connected);
  socket.emit('startAuction', { duration });
}

// Debug: Log socket connection status
socket.on('connect', () => {
  console.log('✅ Socket connected:', socket.id);
});

socket.on('connect_error', (err) => {
  console.error('❌ Socket connection error:', err.message);
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

