// ==========================================
// Display Page - Main Screen with Leaderboard
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './logger';
import { SoundManager } from './sound';
import { escapeHtml } from './utils';

interface Player {
  name: string;
  clicks: number;
  color: string;
  reactionTime?: number | null;
  finalScore?: number;
}

interface AllTimePlayer {
  name: string;
  wins: number;
  bestRound: number;
}

interface GameState {
  status: 'waiting' | 'countdown' | 'bidding' | 'stage2_countdown' | 'stage2_tap' | 'finished';
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
  const isBiddingPhase = state.status === 'bidding' || state.status === 'stage2_tap';
  if (bg) bg.className = 'bg' + (isBiddingPhase ? ' bidding' : '');

  const roundBadge = document.getElementById('roundBadge');
  if (roundBadge) roundBadge.textContent = `Round ${state.round}`;

  const badge = document.getElementById('statusBadge');
  if (badge) {
    badge.className = 'status-badge status-' + state.status;
    const statusTexts: Record<string, string> = {
      waiting: 'Waiting',
      countdown: 'Click Auction...',
      bidding: 'CLICK AUCTION!',
      stage2_countdown: 'Fastest Finger...',
      stage2_tap: 'FASTEST FINGER!',
      finished: 'Complete',
    };
    badge.textContent = statusTexts[state.status] || state.status;
  }

  const countdownOverlay = document.getElementById('countdownOverlay');
  const countdownNumber = document.getElementById('countdownNumber');
  const countdownLabel = document.getElementById('countdownLabel');
  const countdownSublabel = document.getElementById('countdownSublabel');
  const stageTransitionOverlay = document.getElementById('stageTransitionOverlay');
  const stageTransitionTitle = document.getElementById('stageTransitionTitle');
  const stageTransitionSubtitle = document.getElementById('stageTransitionSubtitle');

  // Handle Click Auction Complete transition
  if (lastStatus === 'bidding' && state.status === 'stage2_countdown') {
    // Show Click Auction Complete briefly - then show the countdown
    if (stageTransitionOverlay && stageTransitionTitle && stageTransitionSubtitle) {
      stageTransitionTitle.textContent = 'CLICK AUCTION COMPLETE!';
      stageTransitionSubtitle.textContent = 'FASTEST FINGER in...';
      stageTransitionOverlay.classList.add('active');
      
      // Hide quickly so countdown is visible
      setTimeout(() => {
        stageTransitionOverlay.classList.remove('active');
      }, 1000);
    }
  }
  
  // Always hide transition overlay when stage2_tap starts
  if (state.status === 'stage2_tap' && stageTransitionOverlay) {
    stageTransitionOverlay.classList.remove('active');
  }

  if (state.status === 'waiting') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay';
    if (stageTransitionOverlay) stageTransitionOverlay.classList.remove('active');
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
    if (countdownLabel) countdownLabel.textContent = 'CLICK AUCTION';
    if (countdownSublabel) countdownSublabel.textContent = 'Tap as fast as you can!';
  } else if (state.status === 'bidding') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay';
    if (lastStatus !== 'bidding') SoundManager.go();
  } else if (state.status === 'stage2_countdown') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay active stage2';
    if (countdownNumber) {
      countdownNumber.textContent = String(state.timeRemaining);
      if (lastCountdown !== state.timeRemaining) {
        lastCountdown = state.timeRemaining;
        SoundManager.countdownTick();
        countdownNumber.style.animation = 'none';
        void countdownNumber.offsetHeight;
        countdownNumber.style.animation = 'countdown-pop 1s ease-out';
      }
    }
    if (countdownLabel) countdownLabel.textContent = 'FASTEST FINGER';
    if (countdownSublabel) countdownSublabel.textContent = 'One tap only - be the quickest!';
  } else if (state.status === 'stage2_tap') {
    if (countdownOverlay) countdownOverlay.className = 'countdown-overlay active stage2-tap';
    if (countdownNumber) countdownNumber.textContent = '⚡ TAP! ⚡';
    if (countdownLabel) countdownLabel.textContent = '';
    if (countdownSublabel) countdownSublabel.textContent = '';
    if (lastStatus !== 'stage2_tap') SoundManager.go();
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
      // Use finalScore if available (after Stage 2), otherwise clicks
      const maxScore = state.leaderboard.length > 0 
        ? Math.max(...state.leaderboard.map(p => p.finalScore ?? p.clicks))
        : 1;
      
      // Get multiplier for display
      const getMultiplierBadge = (index: number, reactionTime: number | null | undefined): string => {
        if (reactionTime == null) return '';
        if (index === 0) return '<span class="multiplier-badge gold">2x</span>';
        if (index === 1) return '<span class="multiplier-badge silver">1.5x</span>';
        if (index === 2) return '<span class="multiplier-badge bronze">1.25x</span>';
        return '';
      };
      
      list.innerHTML = state.leaderboard
        .slice(0, 10)
        .map(
          (player, index) => {
            const score = player.finalScore ?? player.clicks;
            const reactionDisplay = player.reactionTime != null 
              ? `<span class="reaction-time">${player.reactionTime}ms</span>` 
              : '';
            const multiplierBadge = state.status === 'finished' ? getMultiplierBadge(index, player.reactionTime) : '';
            return `
            <div class="leaderboard-item">
              <div class="rank">${index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1}</div>
              <div class="player-color" style="background: ${player.color}"></div>
              <div class="player-name">${escapeHtml(player.name)}</div>
              <div class="player-clicks">${score}${reactionDisplay}${multiplierBadge}</div>
              <div class="click-bar" style="width: ${maxScore > 0 ? (score / maxScore) * 100 : 0}%; background: ${player.color}"></div>
            </div>
          `;
          }
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

  const winnerScore = winner?.finalScore ?? winner?.clicks ?? 0;
  const winnerReactionTime = winner?.reactionTime;

  if (winnerName) winnerName.textContent = winner ? winner.name : '-';
  if (winnerScoreText) {
    const reactionText = winnerReactionTime != null ? ` • ${winnerReactionTime}ms reaction` : '';
    winnerScoreText.textContent = winner ? `${winnerScore} points${reactionText} • Round ${state.round}` : '';
  }
  if (adContent) adContent.textContent = state.winnerAd ? `"${state.winnerAd}"` : '"We Won! 🎉"';
  if (adAuthor) adAuthor.textContent = winner ? `— ${winner.name}` : '';
  if (podiumRound) podiumRound.textContent = String(state.round);

  // Multiplier labels
  const multiplierLabels = ['2x', '1.5x', '1.25x'];

  // Podium
  for (let i = 1; i <= 3; i++) {
    const player = lb[i - 1];
    const podiumName = document.getElementById(`podiumName${i}`);
    const podiumScore = document.getElementById(`podiumScore${i}`);
    const score = player?.finalScore ?? player?.clicks ?? 0;
    const reactionTime = player?.reactionTime;

    if (podiumName) podiumName.textContent = player ? player.name : '-';
    if (podiumScore) {
      const reactionInfo = reactionTime != null ? `${reactionTime}ms • ${multiplierLabels[i-1]}` : '';
      podiumScore.innerHTML = player 
        ? `${score} pts${reactionInfo ? `<br><span style="font-size: 0.5rem; opacity: 0.8;">${reactionInfo}</span>` : ''}` 
        : '0';
    }
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

