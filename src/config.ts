// ============================================
// CONFIGURATION
// ============================================

export interface Config {
  PORT: number | string;
  HOST: string;

  // Player limits
  MAX_PLAYERS: number;
  MAX_CONNECTIONS_PER_IP: number;

  // Session management
  RECONNECT_GRACE_PERIOD_MS: number;
  SESSION_CLEANUP_INTERVAL_MS: number;

  // Host authentication
  HOST_PIN: string | null;
  HOST_AUTH_EXPIRY_MS: number;

  // Input validation
  MAX_NAME_LENGTH: number;
  MAX_AD_CONTENT_LENGTH: number;
  MIN_AUCTION_DURATION: number;
  MAX_AUCTION_DURATION: number;
  MIN_COUNTDOWN_DURATION: number;
  MAX_COUNTDOWN_DURATION: number;

  // Rate limiting
  MAX_CLICKS_PER_SECOND: number;

  // Memory cleanup
  CLEANUP_INTERVAL_MS: number;
  STALE_DATA_THRESHOLD_MS: number;

  // Bot detection
  MIN_HUMAN_CV: number;
  MIN_CLICKS_FOR_ANALYSIS: number;

  // Redis
  REDIS_KEY: string;

  // Timing constants
  TICK_INTERVAL_MS: number;
  RATE_LIMIT_WINDOW_MS: number;
  STATIC_CACHE_MAX_AGE: number;

  // Fastest Finger settings
  FASTEST_FINGER_COUNTDOWN_DURATION: number;
  FASTEST_FINGER_TAP_TIMEOUT_MS: number;
  FASTEST_FINGER_MULTIPLIERS: number[];

  // VIOOH-inspired DSP colors
  DSP_COLORS: string[];
}

const config: Config = {
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0', // Listen on all network interfaces

  // Player limits
  MAX_PLAYERS: 200,
  MAX_CONNECTIONS_PER_IP: parseInt(process.env.MAX_CONNECTIONS_PER_IP || '200', 10), // Match MAX_PLAYERS for events

  // Session management
  RECONNECT_GRACE_PERIOD_MS: 30000, // 30 seconds to reconnect
  SESSION_CLEANUP_INTERVAL_MS: 10000,

  // Host authentication
  HOST_PIN: process.env.HOST_PIN || null,
  HOST_AUTH_EXPIRY_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Input validation
  MAX_NAME_LENGTH: 50,
  MAX_AD_CONTENT_LENGTH: 200,
  MIN_AUCTION_DURATION: 1,
  MAX_AUCTION_DURATION: 300, // 5 minutes max
  MIN_COUNTDOWN_DURATION: 1,
  MAX_COUNTDOWN_DURATION: 10,

  // Rate limiting
  MAX_CLICKS_PER_SECOND: 20,

  // Memory cleanup
  CLEANUP_INTERVAL_MS: 60 * 1000, // Run every minute
  STALE_DATA_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes

  // Bot detection
  MIN_HUMAN_CV: 0.15, // Minimum coefficient of variation for human clicks
  MIN_CLICKS_FOR_ANALYSIS: 10,

  // Redis
  REDIS_KEY: 'click-auction:stats',

  // Timing constants
  TICK_INTERVAL_MS: 1000, // 1 second tick for countdown/bidding
  RATE_LIMIT_WINDOW_MS: 1000, // 1 second window for rate limiting
  STATIC_CACHE_MAX_AGE: 3600, // 1 hour cache for static assets

  // Fastest Finger settings
  FASTEST_FINGER_COUNTDOWN_DURATION: 5, // 5 second countdown before "TAP NOW" (gives users time to prepare)
  FASTEST_FINGER_TAP_TIMEOUT_MS: 5000, // 5 seconds to tap before timeout
  FASTEST_FINGER_MULTIPLIERS: [2.0, 1.5, 1.25], // Multipliers for 1st, 2nd, 3rd fastest reaction

  // VIOOH-inspired DSP colors
  DSP_COLORS: [
    '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
    '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
    '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
    '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A',
  ],
};

export default config;

