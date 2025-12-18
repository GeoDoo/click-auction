/**
 * Server-side Logger with levels
 * @module Logger
 */

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

// Default to 'info' in production, 'debug' in development
const currentLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

/**
 * Check if a level should be logged
 * @param {string} level
 * @returns {boolean}
 */
function shouldLog(level) {
  return levels[level] >= levels[currentLevel];
}

/**
 * Format log message with timestamp and emoji
 * @param {string} level
 * @param {string} message
 * @returns {string}
 */
function format(level, message) {
  const timestamp = new Date().toISOString();
  const prefixes = {
    debug: '🔍',
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
  };
  return `${prefixes[level] || ''} [${timestamp}] ${message}`;
}

const Logger = {
  /**
   * Debug level log - development only
   * @param {string} message
   * @param {...any} args
   */
  debug(message, ...args) {
    if (shouldLog('debug')) {
      console.log(format('debug', message), ...args);
    }
  },

  /**
   * Info level log
   * @param {string} message
   * @param {...any} args
   */
  info(message, ...args) {
    if (shouldLog('info')) {
      console.info(format('info', message), ...args);
    }
  },

  /**
   * Warning level log
   * @param {string} message
   * @param {...any} args
   */
  warn(message, ...args) {
    if (shouldLog('warn')) {
      console.warn(format('warn', message), ...args);
    }
  },

  /**
   * Error level log
   * @param {string} message
   * @param {...any} args
   */
  error(message, ...args) {
    if (shouldLog('error')) {
      console.error(format('error', message), ...args);
    }
  },

  /**
   * Log player action
   * @param {string} action
   * @param {string} playerName
   * @param {Object} details
   */
  playerAction(action, playerName, details = {}) {
    this.info(`Player [${playerName}] ${action}`, details);
  },

  /**
   * Log game event
   * @param {string} event
   * @param {Object} details
   */
  gameEvent(event, details = {}) {
    this.info(`Game: ${event}`, details);
  },

  /**
   * Log security event
   * @param {string} event
   * @param {string} ip
   * @param {Object} details
   */
  security(event, ip, details = {}) {
    this.warn(`Security [${ip}]: ${event}`, details);
  },
};

module.exports = Logger;

