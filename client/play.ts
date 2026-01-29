// ==========================================
// Play Page - Player Bidding Interface
// ==========================================

import { io, Socket } from 'socket.io-client';
import { Logger } from './logger';
import { SoundManager } from './sound';

interface Player {
  name: string;
  clicks: number;
  color: string;
  reactionTime?: number | null;
  finalScore?: number;
}

interface GameState {
  status: 'waiting' | 'auction_countdown' | 'auction' | 'fastestFinger_countdown' | 'fastestFinger_tap' | 'finished';
  timeRemaining: number;
  leaderboard: Player[];
  winner: Player | null;
  auctionScores?: Record<string, number>;
}

interface SessionData {
  token: string;
  playerData: Player;
}

const socket: Socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
});

let myClicks = 0;
let myColor = '#00f5d4';
let myName = '';
let gameStatus: GameState['status'] = 'waiting';
let lastCountdown: number | null = null;
let sessionToken: string | null = localStorage.getItem('clickAuctionSession');
let myAuctionTaps = 0; // Store Click Auction score for display

// ==========================================
// SESSION MANAGEMENT
// ==========================================
function saveSession(token: string): void {
  sessionToken = token;
  localStorage.setItem('clickAuctionSession', token);
}

function clearSession(): void {
  sessionToken = null;
  localStorage.removeItem('clickAuctionSession');
}

// Handle session created (new join)
socket.on('sessionCreated', (data: { token: string }) => {
  saveSession(data.token);
  Logger.debug('Session created');

  const joinScreen = document.getElementById('joinScreen');
  const gameScreen = document.getElementById('gameScreen');
  const playerNameDisplay = document.getElementById('playerNameDisplay');

  if (joinScreen) joinScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.add('active');
  if (playerNameDisplay) playerNameDisplay.textContent = myName;
});

// Handle successful rejoin
socket.on('rejoinSuccess', (data: SessionData) => {
  saveSession(data.token);
  myName = data.playerData.name;
  myClicks = data.playerData.clicks;
  myColor = data.playerData.color;

  const joinScreen = document.getElementById('joinScreen');
  const gameScreen = document.getElementById('gameScreen');
  const playerNameDisplay = document.getElementById('playerNameDisplay');
  const clickCounter = document.getElementById('clickCounter');
  const errorOverlay = document.getElementById('errorOverlay');

  if (joinScreen) joinScreen.classList.add('hidden');
  if (gameScreen) gameScreen.classList.add('active');
  if (playerNameDisplay) playerNameDisplay.textContent = myName;
  if (clickCounter) clickCounter.textContent = String(myClicks);
  if (errorOverlay) errorOverlay.classList.remove('active');

  Logger.info('Session restored');

  showReconnectMessage('Reconnected!');
});

// Handle rejoin failure
socket.on('rejoinError', (data: { message: string }) => {
  Logger.warn('Rejoin failed:', data.message);
  clearSession();

  const banner = document.getElementById('reconnectBanner');
  if (banner) banner.remove();

  const joinScreen = document.getElementById('joinScreen');
  const gameScreen = document.getElementById('gameScreen');
  if (joinScreen) joinScreen.classList.remove('hidden');
  if (gameScreen) gameScreen.classList.remove('active');
});

// Attempt to rejoin on reconnect
socket.on('connect', () => {
  Logger.debug('Connected to server');

  if (sessionToken) {
    socket.emit('rejoinGame', { token: sessionToken });
  }
});

// Handle disconnection
socket.on('disconnect', (reason: string) => {
  Logger.warn('Disconnected:', reason);
  if (myName) {
    showReconnectMessage('Connection lost. Reconnecting...');
  }
});

// Handle reconnection failure (all attempts exhausted)
socket.on('reconnect_failed', () => {
  Logger.error('Reconnection failed after all attempts');
  showReconnectMessage('Connection failed. Click to refresh.');

  const banner = document.getElementById('reconnectBanner');
  if (banner) {
    banner.style.cursor = 'pointer';
    banner.onclick = () => window.location.reload();
  }
});

// Handle successful reconnection
socket.on('reconnect', (attemptNumber: number) => {
  Logger.info(`Reconnected after ${attemptNumber} attempts`);
});

// Show reconnection status message
function showReconnectMessage(message: string): void {
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

  if (message.includes('Reconnected')) {
    setTimeout(() => {
      if (banner) {
        banner.style.animation = 'slideDown 0.3s ease reverse';
        setTimeout(() => banner?.remove(), 300);
      }
    }, 3000);
  }
}

// Toggle sound on/off
function toggleSound(): void {
  const enabled = SoundManager.toggle();
  const btn = document.getElementById('soundToggle');
  if (btn) {
    btn.textContent = enabled ? '🔊' : '🔇';
    btn.classList.toggle('muted', !enabled);
    if (enabled) {
      SoundManager.init();
      SoundManager.beep(600, 0.1, 'sine', 0.2);
    }
  }
}

function joinGame(): void {
  const nameInput = document.getElementById('playerName') as HTMLInputElement | null;
  const adInput = document.getElementById('adContent') as HTMLInputElement | null;
  const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement | null;

  // Validate inputs
  const name = nameInput?.value.trim();
  if (!name) {
    nameInput?.focus();
    return;
  }

  const adContent = adInput?.value.trim() || `${name} wins! 🎉`;

  // Disable button to prevent double-submit
  if (joinBtn) {
    joinBtn.disabled = true;
    joinBtn.textContent = 'Joining...';
  }

  SoundManager.init();
  myName = name;

  Logger.debug('Joining game as:', name);
  socket.emit('joinGame', { name, adContent });
}

// Allow Enter key to join
const playerNameInput = document.getElementById('playerName');
const adContentInput = document.getElementById('adContent');

playerNameInput?.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') joinGame();
});
adContentInput?.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') joinGame();
});

// Bid button click
const bidButton = document.getElementById('bidButton') as HTMLButtonElement | null;

let hasRecordedReaction = false;

// Randomize button position AND shrink for Fastest Finger
function randomizeButtonPosition(): void {
  if (!bidButton) return;
  
  const smallButtonSize = 50; // Tiny target for Fastest Finger
  const padding = 40; // Safe padding from edges
  
  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // Calculate safe area for button center (using small size)
  const minX = padding + smallButtonSize / 2;
  const maxX = viewportWidth - padding - smallButtonSize / 2;
  const minY = padding + smallButtonSize / 2 + 60; // Extra top padding for header
  const maxY = viewportHeight - padding - smallButtonSize / 2;
  
  // Random position within safe area
  const randomX = Math.floor(Math.random() * (maxX - minX)) + minX;
  const randomY = Math.floor(Math.random() * (maxY - minY)) + minY;
  
  // Apply position AND size (both at once!)
  bidButton.style.left = `${randomX - smallButtonSize / 2}px`;
  bidButton.style.top = `${randomY - smallButtonSize / 2}px`;
  bidButton.style.width = `${smallButtonSize}px`;
  bidButton.style.height = `${smallButtonSize}px`;
  bidButton.style.fontSize = '0.6rem'; // Tiny text for tiny button
}

// Reset button to normal flow position AND size
function resetButtonPosition(): void {
  if (!bidButton) return;
  bidButton.style.left = '';
  bidButton.style.top = '';
  bidButton.style.position = '';
  bidButton.style.width = '';
  bidButton.style.height = '';
  bidButton.style.fontSize = '';
}

function handleBid(e: MouseEvent | TouchEvent): void {
  if (!bidButton) return;
  
  // Double-check: button must be enabled AND in correct game state
  if (bidButton.disabled) return;

  // Click Auction phase - count clicks
  if (gameStatus === 'auction') {
    myClicks++;
    socket.emit('click');

    SoundManager.tap();

    const counter = document.getElementById('clickCounter');
    if (counter) {
      counter.textContent = String(myClicks);
      counter.classList.add('bump');
      setTimeout(() => counter.classList.remove('bump'), 50);
    }
  }
  // Fastest Finger phase - record reaction time (only first tap counts)
  else if (gameStatus === 'fastestFinger_tap' && !hasRecordedReaction) {
    hasRecordedReaction = true;
    socket.emit('click');

    SoundManager.tap();

    // Update button to show tap recorded
    bidButton.className = 'bid-button fastest-finger-tapped';
    bidButton.innerHTML = '✓ TAPPED!';
    bidButton.disabled = true;
  } else {
    return; // Not in a clickable state
  }

  // Ripple effect
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const rect = bidButton.getBoundingClientRect();

  let x: number, y: number;
  if ('clientX' in e) {
    x = e.clientX - rect.left;
    y = e.clientY - rect.top;
  } else if (e.touches?.[0]) {
    x = e.touches[0].clientX - rect.left;
    y = e.touches[0].clientY - rect.top;
  } else {
    x = rect.width / 2;
    y = rect.height / 2;
  }

  ripple.style.left = x + 'px';
  ripple.style.top = y + 'px';
  ripple.style.width = ripple.style.height = Math.max(rect.width, rect.height) + 'px';
  bidButton.appendChild(ripple);
  setTimeout(() => ripple.remove(), 400);
}

bidButton?.addEventListener('click', handleBid);
bidButton?.addEventListener('touchstart', (e: TouchEvent) => {
  e.preventDefault();
  handleBid(e);
});
bidButton?.addEventListener('touchend', (e: TouchEvent) => e.preventDefault());

function updateUI(state: GameState): void {
  const previousStatus = gameStatus;
  gameStatus = state.status;

  const bg = document.getElementById('bg');
  if (bg) {
    const isBiddingPhase = state.status === 'auction' || state.status === 'fastestFinger_tap';
    bg.className = 'bg' + (isBiddingPhase ? ' bidding' : '');
  }

  const badge = document.getElementById('gameStatusBadge');
  if (badge) {
    badge.className = 'game-status-badge status-' + state.status;
    const statusLabels: Record<string, string> = {
      waiting: 'Waiting',
      auction_countdown: 'Get Ready',
      auction: 'CLICK AUCTION',
      fastestFinger_countdown: 'FASTEST FINGER',
      fastestFinger_tap: 'TAP NOW!',
      finished: 'Finished',
    };
    badge.textContent = statusLabels[state.status] || state.status;
  }

  // Handle Click Auction Complete transition overlay
  const stageOverlay = document.getElementById('stageOverlay');
  const stageScore = document.getElementById('stageScore');
  const stageNext = document.getElementById('stageNext');
  
  // Always store Click Auction score when entering fastestFinger_countdown
  if (state.status === 'fastestFinger_countdown' && previousStatus === 'auction') {
    myAuctionTaps = myClicks;
  }
  
  // Show transition overlay ONLY briefly - don't block the countdown
  if (previousStatus === 'auction' && state.status === 'fastestFinger_countdown') {
    if (stageOverlay && stageScore && stageNext) {
      const stageTitle = document.getElementById('stageTitle');
      if (stageTitle) stageTitle.textContent = 'CLICK AUCTION COMPLETE!';
      stageScore.textContent = `Your taps: ${myAuctionTaps}`;
      stageNext.textContent = 'FASTEST FINGER next!';
      stageOverlay.classList.add('active');
      
      // Hide after just 1 second so users can see the countdown
      setTimeout(() => {
        stageOverlay.classList.remove('active');
      }, 1000);
    }
    
    SoundManager.countdownTick();
  }
  
  // Always hide overlay when fastestFinger_tap starts (in case it's still showing)
  if (state.status === 'fastestFinger_tap' && stageOverlay) {
    stageOverlay.classList.remove('active');
  }

  // Play sounds for state changes
  if (state.status === 'auction_countdown') {
    if (lastCountdown !== state.timeRemaining) {
      lastCountdown = state.timeRemaining;
      SoundManager.countdownTick();
    }
  } else if (state.status === 'fastestFinger_countdown') {
    if (lastCountdown !== state.timeRemaining) {
      lastCountdown = state.timeRemaining;
      SoundManager.countdownTick();
    }
  } else if (state.status === 'auction') {
    if (previousStatus !== 'auction') {
      SoundManager.go();
    }
  } else if (state.status === 'fastestFinger_tap') {
    if (previousStatus !== 'fastestFinger_tap') {
      SoundManager.go();
      hasRecordedReaction = false; // Reset for new Fastest Finger round
      // Hide stage overlay if still visible
      if (stageOverlay) stageOverlay.classList.remove('active');
      // Randomize button position for surprise!
      randomizeButtonPosition();
    }
  }

  const errorOverlay = document.getElementById('errorOverlay');
  if (errorOverlay) errorOverlay.classList.remove('active');

  // Update click label based on stage
  const clickLabel = document.getElementById('clickLabel');
  if (clickLabel) {
    if (state.status === 'fastestFinger_countdown' || state.status === 'fastestFinger_tap') {
      clickLabel.textContent = 'Auction Taps';
    } else {
      clickLabel.textContent = 'Your Bids';
    }
  }

  // Update bid button
  if (bidButton) {
    if (state.status === 'waiting') {
      bidButton.className = 'bid-button waiting';
      bidButton.textContent = 'Waiting...';
      bidButton.disabled = true;
      hasRecordedReaction = false;
      resetButtonPosition(); // Reset for new game
    } else if (state.status === 'auction_countdown') {
      resetButtonPosition(); // Ensure normal position for countdown
      bidButton.className = 'bid-button auction-countdown';
      bidButton.innerHTML = `<span style="font-size: 3rem;">${state.timeRemaining}</span><br>CLICK AUCTION`;
      bidButton.disabled = true;
      myClicks = 0;
      myAuctionTaps = 0;
      hasRecordedReaction = false;
      const counter = document.getElementById('clickCounter');
      if (counter) counter.textContent = '0';
    } else if (state.status === 'auction') {
      bidButton.className = 'bid-button ready';
      bidButton.innerHTML =
        state.timeRemaining <= 3
          ? `<span style="font-size: 2rem; color: #ff3366;">${state.timeRemaining}s</span><br>TAP!`
          : 'TAP!';
      bidButton.disabled = false;
    } else if (state.status === 'fastestFinger_countdown') {
      bidButton.className = 'bid-button fastest-finger-countdown';
      bidButton.innerHTML = `<span style="font-size: 3rem;">${state.timeRemaining}</span><br>FASTEST<br>FINGER`;
      bidButton.disabled = true;
    } else if (state.status === 'fastestFinger_tap') {
      if (!hasRecordedReaction) {
        bidButton.className = 'bid-button fastest-finger-tap';
        bidButton.innerHTML = '⚡'; // Just the lightning bolt for tiny button
        bidButton.disabled = false;
      }
    } else if (state.status === 'finished') {
      bidButton.className = 'bid-button disabled';
      bidButton.textContent = 'Done';
      bidButton.disabled = true;
      // Reset button position back to normal
      resetButtonPosition();
    }
  }

  // Update my color if found in leaderboard
  const me = state.leaderboard.find((p) => p.name === myName);
  if (me) {
    myColor = me.color;
    const colorDot = document.getElementById('playerColorDot');
    if (colorDot) colorDot.style.background = myColor;
  }

  // Show results overlay
  const overlay = document.getElementById('winnerOverlay');
  if (state.status === 'finished' && overlay) {
    if (state.winner) {
      const isWinner = state.winner.name === myName;
      const myRankIndex = state.leaderboard.findIndex((p) => p.name === myName);
      const myRank = myRankIndex + 1;
      const totalPlayers = state.leaderboard.length;

      overlay.className = 'winner-overlay active' + (isWinner ? ' you-won' : '');

      if (isWinner) {
        SoundManager.winner();
      } else {
        SoundManager.end();
      }

      const trophy = document.getElementById('winnerTrophy');
      const title = document.getElementById('winnerTitle');
      const yourResult = document.getElementById('yourResult');

      if (isWinner) {
        if (trophy) trophy.textContent = '🏆';
        if (title) title.textContent = 'YOU WON!';
        if (yourResult) yourResult.style.display = 'none';
      } else if (myRank === 2) {
        if (trophy) trophy.textContent = '🥈';
        if (title) title.textContent = '2nd Place!';
        if (yourResult) yourResult.style.display = 'block';
      } else if (myRank === 3) {
        if (trophy) trophy.textContent = '🥉';
        if (title) title.textContent = '3rd Place!';
        if (yourResult) yourResult.style.display = 'block';
      } else {
        if (trophy) trophy.textContent = '📊';
        if (title) title.textContent = 'Results';
        if (yourResult) yourResult.style.display = 'block';
      }

      const winnerNameBig = document.getElementById('winnerNameBig');
      const winnerClicksBig = document.getElementById('winnerClicksBig');
      const yourResultValue = document.getElementById('yourResultValue');
      const yourRank = document.getElementById('yourRank');
      const yourResultLabel = document.getElementById('yourResultLabel');
      const scoreBreakdown = document.getElementById('scoreBreakdown');

      // Find my entry in leaderboard for final score and reaction time
      const myEntry = state.leaderboard.find((p) => p.name === myName);
      const myFinalScore = myEntry?.finalScore ?? myClicks;
      const myReactionTime = myEntry?.reactionTime;
      const winnerFinalScore = state.winner.finalScore ?? state.winner.clicks;
      const winnerReactionTime = state.winner.reactionTime;

      // Calculate multiplier based on rank
      const getMultiplier = (rank: number, reactionTime: number | null | undefined): number => {
        if (reactionTime == null) return 1.0;
        if (rank === 1) return 2.0;
        if (rank === 2) return 1.5;
        if (rank === 3) return 1.25;
        return 1.0;
      };

      const myMultiplier = getMultiplier(myRank, myReactionTime);

      if (winnerNameBig) winnerNameBig.textContent = state.winner.name + ' wins!';
      
      // Show winner score with reaction time
      if (winnerClicksBig) {
        const winnerReactionText = winnerReactionTime != null ? ` • ${winnerReactionTime}ms` : '';
        winnerClicksBig.textContent = `${winnerFinalScore} points${winnerReactionText}`;
      }
      
      // Show score breakdown for current player
      if (scoreBreakdown && !isWinner) {
        const auctionTaps = myAuctionTaps > 0 ? myAuctionTaps : myClicks;
        if (myReactionTime != null) {
          scoreBreakdown.innerHTML = `
            <div><span class="reaction">${myReactionTime}ms</span> reaction</div>
            <div>${auctionTaps} taps × <span class="multiplier">${myMultiplier}x</span></div>
          `;
        } else {
          scoreBreakdown.innerHTML = `
            <div>No tap recorded</div>
            <div>${auctionTaps} taps × <span class="multiplier">1x</span></div>
          `;
        }
      } else if (scoreBreakdown) {
        // Winner's breakdown
        if (myReactionTime != null) {
          scoreBreakdown.innerHTML = `
            <div><span class="reaction">${myReactionTime}ms</span> • <span class="multiplier">${myMultiplier}x multiplier</span></div>
          `;
        }
        scoreBreakdown.style.display = 'block';
      }
      
      if (yourResultValue) yourResultValue.textContent = myFinalScore + ' points';
      if (yourRank) yourRank.textContent = myRank > 0 ? `You placed #${myRank} of ${totalPlayers}` : '';
      if (yourResultLabel) yourResultLabel.textContent = isWinner ? '' : 'Your Score';
    }
  } else if (overlay) {
    overlay.className = 'winner-overlay';
  }
}

socket.on('gameState', updateUI);

// Sync click count with server (in case of missed clicks or race conditions)
socket.on('clickUpdate', (data: { playerId: string; clicks: number }) => {
  // Check if this update is for me by comparing socket ID
  if (socket.id === data.playerId) {
    // Server's count is authoritative - sync if different
    if (myClicks !== data.clicks) {
      myClicks = data.clicks;
      const counter = document.getElementById('clickCounter');
      if (counter) counter.textContent = String(myClicks);
    }
  }
});

socket.on('joinError', (data: { message: string }) => {
  const joinBtn = document.getElementById('joinBtn') as HTMLButtonElement | null;
  if (joinBtn) {
    joinBtn.disabled = false;
    joinBtn.textContent = 'Enter the Arena';
  }

  const errorText = document.getElementById('errorText');
  const errorOverlay = document.getElementById('errorOverlay');

  if (errorText) errorText.textContent = data.message || 'Could not join the game';
  if (errorOverlay) errorOverlay.classList.add('active');
  Logger.warn('Join failed:', data.message);
});

// Focus name input on load
document.getElementById('playerName')?.focus();

// Expose functions to window for onclick handlers
declare global {
  interface Window {
    joinGame: typeof joinGame;
    toggleSound: typeof toggleSound;
  }
}
window.joinGame = joinGame;
window.toggleSound = toggleSound;
