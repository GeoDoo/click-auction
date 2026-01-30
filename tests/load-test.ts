/**
 * Load Test - Simulates concurrent players against production or local
 * 
 * Usage:
 *   npx ts-node tests/load-test.ts [options]
 * 
 * Options:
 *   --url=<url>       Server URL (default: http://localhost:3000)
 *   --prod            Use production URL (https://click-auction.onrender.com)
 *   --players=<n>     Number of players (default: 200)
 *   --ramp=<ms>       Ramp-up time in ms (default: 5000)
 * 
 * Examples:
 *   npx ts-node tests/load-test.ts --prod --players=50
 *   npx ts-node tests/load-test.ts --url=https://click-auction.onrender.com --players=200
 * 
 * NOTE: All connections from this machine share ONE IP address.
 *       This tests the MAX_CONNECTIONS_PER_IP limit (currently 200).
 *       If you see "Too many connections" errors, the limit is too low.
 */

import { io, Socket } from 'socket.io-client';

// Configuration
const args = process.argv.slice(2);
const getArg = (name: string, defaultVal: string): string => {
  const arg = args.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=')[1] : defaultVal;
};
const hasFlag = (name: string): boolean => args.includes(`--${name}`);

const PROD_URL = 'https://click-auction.onrender.com';
const SERVER_URL = hasFlag('prod') ? PROD_URL : getArg('url', 'http://localhost:3000');
const NUM_PLAYERS = parseInt(getArg('players', '200'), 10);
const RAMP_UP_MS = parseInt(getArg('ramp', '5000'), 10);
const CLICK_INTERVAL_MS = 100; // Click every 100ms during bidding

// Metrics
interface Metrics {
  connectSuccess: number;
  connectFailed: number;
  connectFailedIPLimit: number;  // Specifically track IP limit failures
  connectFailedSessionUnknown: number;  // Track stale session errors
  joinSuccess: number;
  joinFailed: number;
  joinFailedFull: number;  // Track "game full" errors
  totalClicks: number;
  totalTaps: number;
  avgConnectTime: number;
  avgJoinTime: number;
  errors: string[];
  gameStates: Record<string, number>;
}

const metrics: Metrics = {
  connectSuccess: 0,
  connectFailed: 0,
  connectFailedIPLimit: 0,
  connectFailedSessionUnknown: 0,
  joinSuccess: 0,
  joinFailed: 0,
  joinFailedFull: 0,
  totalClicks: 0,
  totalTaps: 0,
  avgConnectTime: 0,
  avgJoinTime: 0,
  errors: [],
  gameStates: {},
};

const connectTimes: number[] = [];
const joinTimes: number[] = [];
const sockets: Socket[] = [];
let currentGameStatus = 'waiting';

// Create a simulated player
function createPlayer(playerId: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const connectStart = Date.now();
    
    const socket = io(SERVER_URL, {
      reconnection: false,
      timeout: 10000,
      transports: ['websocket'], // Use websocket only for load test
    });

    const joinStart = { time: 0 };
    let clickInterval: NodeJS.Timeout | null = null;
    let hasTapped = false;

    socket.on('connect', () => {
      const connectTime = Date.now() - connectStart;
      connectTimes.push(connectTime);
      metrics.connectSuccess++;

      // Join the game
      joinStart.time = Date.now();
      socket.emit('joinGame', {
        name: `LoadTest-${playerId}`,
        adContent: `Player ${playerId} wins!`,
      });
    });

    socket.on('connect_error', (error) => {
      metrics.connectFailed++;
      
      // Categorize the error
      if (error.message.includes('Too many connections')) {
        metrics.connectFailedIPLimit++;
      } else if (error.message === 'Session ID unknown') {
        metrics.connectFailedSessionUnknown++;
      }
      
      metrics.errors.push(`Player ${playerId} connect error: ${error.message}`);
      reject(error);
    });

    socket.on('sessionCreated', () => {
      const joinTime = Date.now() - joinStart.time;
      joinTimes.push(joinTime);
      metrics.joinSuccess++;
      resolve(socket);
    });

    socket.on('joinError', (data: { message: string }) => {
      metrics.joinFailed++;
      
      // Categorize the error
      if (data.message.includes('full') || data.message.includes('Maximum')) {
        metrics.joinFailedFull++;
      }
      
      metrics.errors.push(`Player ${playerId} join error: ${data.message}`);
      reject(new Error(data.message));
    });

    socket.on('gameState', (state: { status: string }) => {
      const prevStatus = currentGameStatus;
      currentGameStatus = state.status;
      
      // Track state changes
      metrics.gameStates[state.status] = (metrics.gameStates[state.status] || 0) + 1;

      // Start clicking during Click Auction phase
      if (state.status === 'auction' && !clickInterval) {
        clickInterval = setInterval(() => {
          socket.emit('click');
          metrics.totalClicks++;
        }, CLICK_INTERVAL_MS + Math.random() * 50); // Add some variance
      }

      // Stop clicking when auction ends
      if (prevStatus === 'auction' && state.status !== 'auction' && clickInterval) {
        clearInterval(clickInterval);
        clickInterval = null;
      }

      // Tap during Fastest Finger
      if (state.status === 'fastestFinger_tap' && !hasTapped) {
        // Random delay to simulate human reaction (50-500ms)
        setTimeout(() => {
          socket.emit('click');
          metrics.totalTaps++;
          hasTapped = true;
        }, 50 + Math.random() * 450);
      }

      // Reset for next round
      if (state.status === 'waiting') {
        hasTapped = false;
      }
    });

    socket.on('disconnect', () => {
      if (clickInterval) {
        clearInterval(clickInterval);
      }
    });

    sockets.push(socket);
  });
}

// Print progress bar
function printProgress(current: number, total: number, label: string): void {
  const width = 40;
  const percent = current / total;
  const filled = Math.round(width * percent);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  process.stdout.write(`\r${label}: [${bar}] ${current}/${total} (${(percent * 100).toFixed(1)}%)`);
}

// Print metrics report
function printReport(): void {
  console.log('\n\n' + '='.repeat(70));
  console.log('LOAD TEST REPORT');
  console.log('='.repeat(70));
  console.log(`Target: ${SERVER_URL}`);
  console.log(`Players attempted: ${NUM_PLAYERS}`);
  console.log('='.repeat(70));
  
  console.log('\n📊 CONNECTION METRICS:');
  console.log(`   ✅ Successful connections: ${metrics.connectSuccess}`);
  console.log(`   ❌ Failed connections: ${metrics.connectFailed}`);
  if (metrics.connectFailedIPLimit > 0) {
    console.log(`      🚫 IP limit exceeded: ${metrics.connectFailedIPLimit} (MAX_CONNECTIONS_PER_IP too low!)`);
  }
  if (metrics.connectFailedSessionUnknown > 0) {
    console.log(`      🔄 Session ID unknown: ${metrics.connectFailedSessionUnknown} (server restarted)`);
  }
  console.log(`   ⏱️  Avg connect time: ${connectTimes.length ? (connectTimes.reduce((a, b) => a + b, 0) / connectTimes.length).toFixed(2) : 0}ms`);
  console.log(`   📈 Max connect time: ${connectTimes.length ? Math.max(...connectTimes) : 0}ms`);
  console.log(`   📉 Min connect time: ${connectTimes.length ? Math.min(...connectTimes) : 0}ms`);
  
  console.log('\n🎮 JOIN METRICS:');
  console.log(`   ✅ Successful joins: ${metrics.joinSuccess}`);
  console.log(`   ❌ Failed joins: ${metrics.joinFailed}`);
  if (metrics.joinFailedFull > 0) {
    console.log(`      🚫 Game full: ${metrics.joinFailedFull} (MAX_PLAYERS limit hit)`);
  }
  console.log(`   ⏱️  Avg join time: ${joinTimes.length ? (joinTimes.reduce((a, b) => a + b, 0) / joinTimes.length).toFixed(2) : 0}ms`);
  
  console.log('\n👆 GAMEPLAY METRICS:');
  console.log(`   🖱️  Total clicks (Click Auction): ${metrics.totalClicks}`);
  console.log(`   ⚡ Total taps (Fastest Finger): ${metrics.totalTaps}`);
  console.log(`   📊 Clicks per player: ${metrics.joinSuccess ? (metrics.totalClicks / metrics.joinSuccess).toFixed(1) : 0}`);
  
  if (metrics.errors.length > 0) {
    console.log('\n⚠️  ERRORS (first 10):');
    metrics.errors.slice(0, 10).forEach(e => console.log(`   - ${e}`));
    if (metrics.errors.length > 10) {
      console.log(`   ... and ${metrics.errors.length - 10} more`);
    }
  }

  // Success rate
  const successRate = (metrics.joinSuccess / NUM_PLAYERS) * 100;
  console.log('\n' + '='.repeat(70));
  console.log(`RESULT: ${successRate.toFixed(1)}% success rate (${metrics.joinSuccess}/${NUM_PLAYERS} players)`);
  
  if (successRate >= 95) {
    console.log('✅ PASSED - Server can handle the load!');
  } else if (successRate >= 80) {
    console.log('⚠️  WARNING - Some players failed to join');
  } else {
    console.log('❌ FAILED - Significant connection failures');
  }
  
  // Specific diagnosis
  if (metrics.connectFailedIPLimit > 0) {
    console.log('\n🔧 FIX NEEDED: Increase MAX_CONNECTIONS_PER_IP in src/config.ts');
  }
  if (metrics.joinFailedFull > 0) {
    console.log('\n🔧 FIX NEEDED: Increase MAX_PLAYERS in src/config.ts (or expected behavior)');
  }
  if (metrics.connectFailedSessionUnknown > 0) {
    console.log('\n💡 NOTE: "Session ID unknown" errors indicate server cold-started during test');
  }
  
  console.log('='.repeat(70) + '\n');
}

// Main
async function runLoadTest(): Promise<void> {
  const isProd = SERVER_URL.includes('onrender.com');
  
  console.log('');
  console.log('='.repeat(70));
  console.log('🚀 LOAD TEST STARTING');
  console.log('='.repeat(70));
  console.log(`   Server: ${SERVER_URL}`);
  console.log(`   Environment: ${isProd ? '🔴 PRODUCTION' : '🟢 Local/Dev'}`);
  console.log(`   Players: ${NUM_PLAYERS}`);
  console.log(`   Ramp-up: ${RAMP_UP_MS}ms`);
  console.log('');
  console.log('   ⚠️  NOTE: All connections share YOUR IP address.');
  console.log('   This tests MAX_CONNECTIONS_PER_IP limit (should be >= players).');
  console.log('='.repeat(70));
  console.log('');

  const delayPerPlayer = RAMP_UP_MS / NUM_PLAYERS;
  const promises: Promise<Socket>[] = [];

  console.log('📡 Connecting players...');
  
  for (let i = 0; i < NUM_PLAYERS; i++) {
    promises.push(
      createPlayer(i + 1).catch(() => {
        // Don't fail the whole test if one player fails
        return null as unknown as Socket;
      })
    );
    
    printProgress(i + 1, NUM_PLAYERS, 'Connecting');
    
    // Ramp up gradually
    if (delayPerPlayer > 0) {
      await new Promise(r => setTimeout(r, delayPerPlayer));
    }
  }

  console.log('\n\n⏳ Waiting for all connections to settle...');
  await Promise.allSettled(promises);
  
  console.log('✅ All players connected/attempted');
  console.log(`\n🎮 Waiting for game... (Start the game from host panel)`);
  console.log('   Press Ctrl+C to stop and see results\n');

  // Wait for game to play out (60 seconds max)
  await new Promise(r => setTimeout(r, 60000));

  // Cleanup
  console.log('\n🧹 Cleaning up connections...');
  sockets.forEach(s => s.disconnect());
  
  printReport();
  process.exit(metrics.joinSuccess >= NUM_PLAYERS * 0.95 ? 0 : 1);
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⏹️  Test interrupted');
  sockets.forEach(s => s.disconnect());
  printReport();
  process.exit(0);
});

runLoadTest().catch(console.error);
