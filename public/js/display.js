// ==========================================
// Display Page - Main Screen with Leaderboard
// ==========================================

const socket = io();
let maxClicks = 1;
let lastCountdown = null;
let lastStatus = 'waiting';

// Sound Manager
const SoundManager = {
  ctx: null,
  enabled: true,
  initialized: false,
  unlocked: false,

  async init() {
    if (this.initialized && this.unlocked) return;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.initialized = true;
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      if (!this.unlocked) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.01);
        this.unlocked = true;
      }
    } catch (_e) {
      // Audio initialization failed silently
    }
  },

  beep(freq = 440, duration = 0.1, type = 'sine', volume = 0.5) {
    if (!this.ctx || !this.enabled || !this.unlocked) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + duration);
    } catch (_e) {
      // Beep failed silently
    }
  },

  countdownTick() {
    this.beep(520, 0.2, 'sine', 0.7);
  },

  go() {
    if (!this.ctx || !this.enabled || !this.unlocked) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.6, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + 0.4);
    } catch (_e) {
      // Go sound failed silently
    }
  },

  winner() {
    if (!this.ctx || !this.enabled || !this.unlocked) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((freq, i) => {
      setTimeout(() => this.beep(freq, 0.45, 'sine', 0.6), i * 120);
    });
  },
};

document.addEventListener('click', () => SoundManager.init());
document.addEventListener('touchstart', () => SoundManager.init());

// Fetch config for QR code
fetch('/api/config')
  .then((res) => res.json())
  .then((config) => {
    const playUrl = config.baseUrl + '/play';
    document.getElementById('joinUrl').textContent = playUrl;
    document.getElementById('joinQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playUrl)}&bgcolor=ffffff&color=0a0b1e&margin=5`;
  })
  .catch(() => {
    const playUrl = window.location.origin + '/play';
    document.getElementById('joinUrl').textContent = playUrl;
    document.getElementById('joinQr').src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playUrl)}&bgcolor=ffffff&color=0a0b1e&margin=5`;
  });

// Fetch and display all-time stats
function loadAllTimeStats() {
  fetch('/api/stats')
    .then((res) => res.json())
    .then((data) => {
      const list = document.getElementById('allTimeList');
      if (!data.allTime || data.allTime.length === 0) {
        list.innerHTML = '<div class="empty-leaderboard"><div class="icon">🏆</div><div>No champions yet...</div></div>';
        return;
      }

      list.innerHTML = data.allTime
        .slice(0, 8)
        .map(
          (player, index) => `
            <div class="leaderboard-item">
              <div class="rank">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</div>
              <div class="player-name">${escapeHtml(player.name)}</div>
              <div class="player-stats">
                <span class="wins">${player.wins} 🏆</span>
                <span class="best">Best: ${player.bestRound}</span>
              </div>
            </div>
          `,
        )
        .join('');
    })
    .catch((err) => console.log('Could not load all-time stats:', err));
}

// Load stats initially and refresh after each auction
loadAllTimeStats();
setInterval(loadAllTimeStats, 10000); // Refresh every 10 seconds

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updateUI(state) {
  document.getElementById('bg').className = 'bg' + (state.status === 'bidding' ? ' bidding' : '');
  document.getElementById('roundBadge').textContent = `Round ${state.round}`;

  const badge = document.getElementById('statusBadge');
  badge.className = 'status-badge status-' + state.status;
  const statusTexts = { waiting: 'Waiting', countdown: 'Starting...', bidding: 'LIVE!', finished: 'Complete' };
  badge.textContent = statusTexts[state.status] || state.status;

  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');

  if (state.status === 'waiting') {
    countdownOverlay.className = 'countdown-overlay';
  } else if (state.status === 'countdown') {
    countdownOverlay.className = 'countdown-overlay active';
    countdownNumber.textContent = state.timeRemaining;
    if (lastCountdown !== state.timeRemaining) {
      lastCountdown = state.timeRemaining;
      SoundManager.countdownTick();
      countdownNumber.style.animation = 'none';
      countdownNumber.offsetHeight; // Trigger reflow
      countdownNumber.style.animation = 'countdown-pop 1s ease-out';
    }
  } else if (state.status === 'bidding') {
    countdownOverlay.className = 'countdown-overlay';
    if (lastStatus !== 'bidding') SoundManager.go();
  } else if (state.status === 'finished') {
    countdownOverlay.className = 'countdown-overlay';
  }

  document.getElementById('playerCount').textContent = state.playerCount;

  if (state.leaderboard.length > 0) {
    maxClicks = Math.max(maxClicks, state.leaderboard[0].clicks);
  }

  const list = document.getElementById('leaderboardList');
  if (state.leaderboard.length === 0) {
    list.innerHTML = '<div class="empty-leaderboard"><div class="icon">👥</div><div>Waiting for DSPs to join...</div></div>';
  } else {
    list.innerHTML = state.leaderboard
      .slice(0, 10)
      .map(
        (player, index) => `
          <div class="leaderboard-item">
            <div class="rank">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</div>
            <div class="player-color" style="background: ${player.color}"></div>
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="player-clicks">${player.clicks}</div>
            <div class="click-bar" style="width: ${maxClicks > 0 ? (player.clicks / maxClicks) * 100 : 0}%; background: ${player.color}"></div>
          </div>
        `,
      )
      .join('');
  }

  // Winner screen
  const winnerScreen = document.getElementById('winnerScreen');
  if (state.status === 'finished' && state.leaderboard.length > 0) {
    showWinnerScreen(state);
    winnerScreen.className = 'winner-screen active';
    createConfetti();
    if (lastStatus !== 'finished') {
      SoundManager.winner();
      // Refresh all-time stats after auction ends
      setTimeout(loadAllTimeStats, 1000);
    }
  } else {
    winnerScreen.className = 'winner-screen';
  }

  lastStatus = state.status;
}

function showWinnerScreen(state) {
  const lb = state.leaderboard;
  const winner = lb[0];

  document.getElementById('winnerName').textContent = winner ? winner.name : '-';
  document.getElementById('winnerScoreText').textContent = winner ? `${winner.clicks} clicks • Round ${state.round} Champion` : '';
  document.getElementById('adContent').textContent = state.winnerAd ? `"${state.winnerAd}"` : '"We Won! 🎉"';
  document.getElementById('adAuthor').textContent = winner ? `— ${winner.name}` : '';
  document.getElementById('podiumRound').textContent = state.round;

  // Podium
  for (let i = 1; i <= 3; i++) {
    const player = lb[i - 1];
    document.getElementById(`podiumName${i}`).textContent = player ? player.name : '-';
    document.getElementById(`podiumScore${i}`).textContent = player ? `${player.clicks} clicks` : '0';
  }
}

function createConfetti() {
  const colors = ['#00C9A7', '#E91E8C', '#6B3FA0', '#FFD700', '#00E896', '#FF3366'];
  const container = document.getElementById('winnerScreen');
  container.querySelectorAll('.confetti').forEach((c) => c.remove());

  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement('div');
    confetti.className = 'confetti';
    const drift = (Math.random() - 0.5) * 200;
    confetti.style.cssText = `
      position: fixed;
      width: ${Math.random() * 10 + 5}px;
      height: ${Math.random() * 10 + 5}px;
      background: ${colors[Math.floor(Math.random() * colors.length)]};
      left: ${Math.random() * 100}%;
      top: -20px;
      opacity: 1;
      transform: rotate(${Math.random() * 360}deg);
      --drift: ${drift}px;
      animation: confetti-fall ${Math.random() * 2 + 2}s linear forwards;
      animation-delay: ${Math.random() * 1.5}s;
      z-index: 1000;
      pointer-events: none;
    `;
    container.appendChild(confetti);
    setTimeout(() => confetti.remove(), 5000);
  }
}

socket.on('gameState', updateUI);
socket.on('clickUpdate', (data) => {
  maxClicks = Math.max(maxClicks, data.clicks);
});

