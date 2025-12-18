// ============================================
// CONFIGURATION
// ============================================

module.exports = {
  PORT: process.env.PORT || 3000,
  HOST: '0.0.0.0', // Listen on all network interfaces

  // Player limits
  MAX_PLAYERS: 100,
  MAX_CONNECTIONS_PER_IP: 10,

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

  // VIOOH-inspired DSP colors
  DSP_COLORS: [
    '#00C9A7', '#E91E8C', '#6B3FA0', '#00D4D4', '#FFB800',
    '#00E896', '#FF6B9D', '#4ECDC4', '#9B59B6', '#3498DB',
    '#F39C12', '#1ABC9C', '#E74C8C', '#00BCD4', '#8E44AD',
    '#2ECC71', '#E91E63', '#00ACC1', '#AB47BC', '#26A69A',
  ],
};

