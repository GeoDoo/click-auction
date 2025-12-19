// ==========================================
// Display Page - Main Screen with Leaderboard
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './lib/logger';
import { SoundManager } from './lib/sound';
import { escapeHtml } from './lib/utils';

interface Player {
  name: string;
  clicks: number;
  color: string;
}

interface AllTimePlayer {
  name: string;
  wins: number;
  bestRound: number;
}

interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'finished';
  round: number;
  timeRemaining: number;
  playerCount: number;
  leaderboard: Player[];
  winnerAd: string | null;
}

interface StatsResponse {
  allTime: AllTimePlayer[];
}

interface ConfigResponse {
  baseUrl: string;
}

const socket: Socket = io();
let maxClicks = 1;
let lastCountdown: number | null = null;
let lastStatus: GameState['status'] = 'waiting';

// Fetch config for QR code
fetch('/api/config')
  .then((res) => res.json())
  .then((config: ConfigResponse) => {
    const playUrl = config.baseUrl + '/play';
    const joinUrl = document.getElementById('joinUrl');
    const joinQr = document.getElementById('joinQr') as HTMLImageElement | null;

    if (joinUrl) joinUrl.textContent = playUrl;
    if (joinQr) {
      joinQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playUrl)}&bgcolor=ffffff&color=0a0b1e&margin=5`;
    }
  })
  .catch(() => {
    const playUrl = window.location.origin + '/play';
    const joinUrl = document.getElementById('joinUrl');
    const joinQr = document.getElementById('joinQr') as HTMLImageElement | null;

    if (joinUrl) joinUrl.textContent = playUrl;
    if (joinQr) {
      joinQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playUrl)}&bgcolor=ffffff&color=0a0b1e&margin=5`;
    }
  });

// Fetch and display all-time stats
function loadAllTimeStats(): void {
  fetch('/api/stats')
    .then((res) => res.json())
    .then((data: StatsResponse) => {
      const list = document.getElementById('allTimeList');
      if (!list) return;

      if (!data.allTime || data.allTime.length === 0) {
        list.innerHTML =
          '<div class="empty-leaderboard"><div class="icon">🏆</div><div>No champions yet...</div></div>';
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
          `
        )
        .join('');
    })
    .catch((err) => Logger.warn('Could not load all-time stats:', err));
}

// Load stats initially and refresh after each auction
loadAllTimeStats();
setInterval(loadAllTimeStats, 10000);

function updateUI(state: GameState): void {
  const bg = document.getElementById('bg');
  if (bg) bg.className = 'bg' + (state.status === 'bidding' ? ' bidding' : '');

  const roundBadge = document.getElementById('roundBadge');
  if (roundBadge) roundBadge.textContent = `Round ${state.round}`;

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge status-' + state.status;
    const statusTexts: Record<string, string> = {
      waiting: 'Waiting',
      countdown: 'Starting...',
      bidding: 'LIVE!',
      finished: 'Complete',
    };
    badge.textContent = statusTexts[state.status] || state.status;
  }

  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');

  if (state.status === 'waiting') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay';
  } else if (state.status === 'countdown') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay active';
    if (countdownNumber) {
      countdownNumber.textContent = String(state.timeRemaining);
      if (lastCountdown !== state.timeRemaining) {
        lastCountdown = state.timeRemaining;
        SoundManager.countdownTick();
        countdownNumber.style.animation = 'none';
        void countdownNumber.offsetHeight; // Trigger reflow
        countdownNumber.style.animation = 'countdown-pop 1s ease-out';
      }
    }
  } else if (state.status === 'bidding') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay';
    if (lastStatus !== 'bidding') SoundManager.go();
  } else if (state.status === 'finished') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay';
  }

  const playerCount = document.getElementById('playerCount');
  if (playerCount) playerCount.textContent = String(state.playerCount);

  if (state.leaderboard.length > 0) {
    maxClicks = Math.max(maxClicks, state.leaderboard[0].clicks);
  }

  const list = document.getElementById('leaderboardList');
  if (list) {
    if (state.leaderboard.length === 0) {
      list.innerHTML =
        '<div class="empty-leaderboard"><div class="icon">👥</div><div>Waiting for DSPs to join...</div></div>';
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
          `
        )
        .join('');
    }
  }

  // Winner screen
  const winnerScreen = document.getElementById('winnerScreen');
  if (state.status === 'finished' && state.leaderboard.length > 0) {
    showWinnerScreen(state);
    if (winnerScreen) winnerScreen.className = 'winner-screen active';
    createConfetti();
    if (lastStatus !== 'finished') {
      SoundManager.winner();
      setTimeout(loadAllTimeStats, 1000);
    }
  } else {
    if (winnerScreen) winnerScreen.className = 'winner-screen';
  }

  lastStatus = state.status;
}

function showWinnerScreen(state: GameState): void {
  const lb = state.leaderboard;
  const winner = lb[0];

  const winnerName = document.getElementById('winnerName');
  const winnerScoreText = document.getElementById('winnerScoreText');
  const adContent = document.getElementById('adContent');
  const adAuthor = document.getElementById('adAuthor');
  const podiumRound = document.getElementById('podiumRound');

  if (winnerName) winnerName.textContent = winner ? winner.name : '-';
  if (winnerScoreText) {
    winnerScoreText.textContent = winner ? `${winner.clicks} clicks • Round ${state.round} Champion` : '';
  }
  if (adContent) adContent.textContent = state.winnerAd ? `"${state.winnerAd}"` : '"We Won! 🎉"';
  if (adAuthor) adAuthor.textContent = winner ? `— ${winner.name}` : '';
  if (podiumRound) podiumRound.textContent = String(state.round);

  // Podium
  for (let i = 1; i <= 3; i++) {
    const player = lb[i - 1];
    const podiumName = document.getElementById(`podiumName${i}`);
    const podiumScore = document.getElementById(`podiumScore${i}`);

    if (podiumName) podiumName.textContent = player ? player.name : '-';
    if (podiumScore) podiumScore.textContent = player ? `${player.clicks} clicks` : '0';
  }
}

function createConfetti(): void {
  const colors = ['#00C9A7', '#E91E8C', '#6B3FA0', '#FFD700', '#00E896', '#FF3366'];
  const container = document.getElementById('winnerScreen');
  if (!container) return;

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
socket.on('clickUpdate', (data: { clicks: number }) => {
  maxClicks = Math.max(maxClicks, data.clicks);
});

