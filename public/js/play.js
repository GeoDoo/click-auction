// ==========================================
// Play Page - Player Bidding Interface
// ==========================================

const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

let myClicks = 0;
let myColor = '#00f5d4';
let myName = '';
let gameStatus = 'waiting';
let lastCountdown = null;
let sessionToken = localStorage.getItem('clickAuctionSession');
let _isReconnecting = false;

// ==========================================
// SESSION MANAGEMENT
// ==========================================
function saveSession(token) {
  sessionToken = token;
  localStorage.setItem('clickAuctionSession', token);
}

function clearSession() {
  sessionToken = null;
  localStorage.removeItem('clickAuctionSession');
}

// Handle session created (new join)
socket.on('sessionCreated', (data) => {
  saveSession(data.token);
  Logger.debug('Session created');
});

// Handle successful rejoin
socket.on('rejoinSuccess', (data) => {
  saveSession(data.token);
  myName = data.playerData.name;
  myClicks = data.playerData.clicks;
  myColor = data.playerData.color;

  document.getElementById('joinScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.add('active');
  document.getElementById('playerNameDisplay').textContent = myName;
  document.getElementById('clickCounter').textContent = myClicks;

  // Clear any error overlays on successful rejoin
  document.getElementById('errorOverlay').classList.remove('active');

  _isReconnecting = false;
  Logger.info('Session restored');

  // Show reconnection success message briefly
  showReconnectMessage('Reconnected!');
});

// Handle rejoin failure
socket.on('rejoinError', (data) => {
  Logger.warn('Rejoin failed:', data.message);
  clearSession();
  _isReconnecting = false;
  // Show join screen for fresh start
  document.getElementById('joinScreen').classList.remove('hidden');
  document.getElementById('gameScreen').classList.remove('active');
});

// Attempt to rejoin on reconnect
socket.on('connect', () => {
  Logger.debug('Connected to server');

  // If we have a session token, try to rejoin (server has the player data)
  if (sessionToken) {
    _isReconnecting = true;
    socket.emit('rejoinGame', { token: sessionToken });
  }
});

// Handle disconnection
socket.on('disconnect', (reason) => {
  Logger.warn('Disconnected:', reason);
  if (myName) {
    showReconnectMessage('Connection lost. Reconnecting...');
  }
});

// Show reconnection status message
function showReconnectMessage(message) {
  // Create or update reconnect banner
  let banner = document.getElementById('reconnectBanner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'reconnectBanner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 0.75rem;
      background: linear-gradient(135deg, var(--viooh-purple), var(--viooh-magenta));
      color: white;
      text-align: center;
      font-family: 'Orbitron', sans-serif;
      font-size: 0.9rem;
      z-index: 9999;
      animation: slideDown 0.3s ease;
    `;
    document.body.prepend(banner);

    // Add animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
  banner.textContent = message;

  // Auto-hide success messages after 3 seconds
  if (message.includes('Reconnected')) {
    setTimeout(() => {
      banner.style.animation = 'slideDown 0.3s ease reverse';
      setTimeout(() => banner.remove(), 300);
    }, 3000);
  }
}

// SoundManager loaded from /js/sound.js

// Toggle sound on/off
function toggleSound() {
  const enabled = SoundManager.toggle();
  const btn = document.getElementById('soundToggle');
  btn.textContent = enabled ? '🔊' : '🔇';
  btn.classList.toggle('muted', !enabled);
  // Play a test beep if turning on
  if (enabled) {
    SoundManager.init();
    SoundManager.beep(600, 0.1, 'sine', 0.2);
  }
}

function joinGame() {
  const name = document.getElementById('playerName').value.trim() || 'Anonymous DSP';
  const adContent = document.getElementById('adContent').value.trim() || `${name} wins! 🎉`;

  // Initialize audio on join (user interaction)
  SoundManager.init();

  myName = name;
  socket.emit('joinGame', { name, adContent });

  document.getElementById('joinScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.add('active');
  document.getElementById('playerNameDisplay').textContent = name;
}

// Allow Enter key to join
document.getElementById('playerName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});
document.getElementById('adContent').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinGame();
});

// Bid button click
const bidButton = document.getElementById('bidButton');

function handleBid(e) {
  if (gameStatus !== 'bidding') return;

  myClicks++;
  socket.emit('click');

  // Sound effect
  SoundManager.tap();

  // Update counter with animation
  const counter = document.getElementById('clickCounter');
  counter.textContent = myClicks;
  counter.classList.add('bump');
  setTimeout(() => counter.classList.remove('bump'), 50);

  // Ripple effect
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = bidButton.getBoundingClientRect();
  const x = (e.clientX || e.touches?.[0]?.clientX || rect.width / 2) - rect.left;
  const y = (e.clientY || e.touches?.[0]?.clientY || rect.height / 2) - rect.top;
  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';
  ripple.style.width = ripple.style.height = Math.max(rect.width, rect.height) + 'px';
  bidButton.appendChild(ripple);
  setTimeout(() => ripple.remove(), 400);
}

bidButton.addEventListener('click', handleBid);
bidButton.addEventListener('touchstart', (e) => {
  e.preventDefault();
  handleBid(e);
});

// Prevent double-tap zoom on mobile
bidButton.addEventListener('touchend', (e) => e.preventDefault());

function updateUI(state) {
  const previousStatus = gameStatus; // Save BEFORE updating
  gameStatus = state.status;

  // Update background
  document.getElementById('bg').className = 'bg' + (state.status === 'bidding' ? ' bidding' : '');

  // Update status badge
  const badge = document.getElementById('gameStatusBadge');
  badge.className = 'game-status-badge status-' + state.status;
  badge.textContent = state.status.charAt(0).toUpperCase() + state.status.slice(1);

  // Play sounds for state changes
  if (state.status === 'countdown') {
    if (lastCountdown !== state.timeRemaining) {
      lastCountdown = state.timeRemaining;
      SoundManager.countdownTick();
    }
  } else if (state.status === 'bidding') {
    // Play GO sound when bidding starts (compare with PREVIOUS status)
    if (previousStatus !== 'bidding') {
      SoundManager.go();
    }
  }

  // Clear error overlay on receiving valid state (connection working)
  document.getElementById('errorOverlay').classList.remove('active');

  // Update bid button
  if (state.status === 'waiting') {
    bidButton.className = 'bid-button waiting';
    bidButton.textContent = 'Waiting...';
    bidButton.disabled = true;
  } else if (state.status === 'countdown') {
    bidButton.className = 'bid-button countdown-state';
    bidButton.innerHTML = `<span style="font-size: 3rem;">${state.timeRemaining}</span><br>GET READY`;
    bidButton.disabled = true;
    myClicks = 0;
    document.getElementById('clickCounter').textContent = '0';
  } else if (state.status === 'bidding') {
    bidButton.className = 'bid-button ready';
    bidButton.innerHTML = state.timeRemaining <= 3
      ? `<span style="font-size: 2rem; color: #ff3366;">${state.timeRemaining}s</span><br>BID!`
      : 'BID!';
    bidButton.disabled = false;
  } else if (state.status === 'finished') {
    bidButton.className = 'bid-button disabled';
    bidButton.textContent = 'Done';
    bidButton.disabled = true;
  }

  // Update my color if found in leaderboard
  const me = state.leaderboard.find((p) => p.name === myName);
  if (me) {
    myColor = me.color;
    document.getElementById('playerColorDot').style.background = myColor;
  }

  // Show results overlay
  const overlay = document.getElementById('winnerOverlay');
  if (state.status === 'finished') {
    if (state.winner) {
      const isWinner = state.winner.name === myName;

      // Find my rank
      const myRankIndex = state.leaderboard.findIndex((p) => p.name === myName);
      const myRank = myRankIndex + 1;
      const totalPlayers = state.leaderboard.length;

      overlay.className = 'winner-overlay active' + (isWinner ? ' you-won' : '');

      // Play sound based on result
      if (isWinner) {
        SoundManager.winner();
      } else {
        SoundManager.end();
      }

      // Different display based on rank
      if (isWinner) {
        document.getElementById('winnerTrophy').textContent = '🏆';
        document.getElementById('winnerTitle').textContent = 'YOU WON!';
        document.getElementById('yourResult').style.display = 'none';
      } else if (myRank === 2) {
        document.getElementById('winnerTrophy').textContent = '🥈';
        document.getElementById('winnerTitle').textContent = '2nd Place!';
        document.getElementById('yourResult').style.display = 'block';
      } else if (myRank === 3) {
        document.getElementById('winnerTrophy').textContent = '🥉';
        document.getElementById('winnerTitle').textContent = '3rd Place!';
        document.getElementById('yourResult').style.display = 'block';
      } else {
        document.getElementById('winnerTrophy').textContent = '📊';
        document.getElementById('winnerTitle').textContent = 'Results';
        document.getElementById('yourResult').style.display = 'block';
      }

      document.getElementById('winnerNameBig').textContent = state.winner.name + ' wins!';
      document.getElementById('winnerClicksBig').textContent = state.winner.clicks + ' clicks';
      document.getElementById('yourResultValue').textContent = myClicks + ' clicks';
      document.getElementById('yourRank').textContent = myRank > 0 ? `You placed #${myRank} of ${totalPlayers}` : '';
      document.getElementById('yourResultLabel').textContent = isWinner ? '' : 'Your Score';
    }
  } else {
    overlay.className = 'winner-overlay';
  }
}

socket.on('gameState', updateUI);

socket.on('joinError', (data) => {
  document.getElementById('errorText').textContent = data.message || 'Could not join the game';
  document.getElementById('errorOverlay').classList.add('active');
});

// Focus name input on load
document.getElementById('playerName').focus();

// Expose functions to window for onclick handlers
window.joinGame = joinGame;
window.toggleSound = toggleSound;

