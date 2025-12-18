/**
 * Logger - Centralized logging with levels
 * Only shows logs appropriate for the environment
 * @module Logger
 */

const Logger = {
  /** @type {'debug'|'info'|'warn'|'error'|'none'} */
  level: 'info', // Default level

  /** @type {Object<string, number>} */
  levels: {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
  },

  /**
   * Initialize logger based on environment
   */
  init() {
    // Auto-detect: more verbose in development
    const isDev = window.location.hostname === 'localhost' ||
                  window.location.hostname === '127.0.0.1' ||
                  window.location.hostname.match(/^\d+\.\d+\.\d+\.\d+$/);

    this.level = isDev ? 'debug' : 'warn';
  },

  /**
   * Set log level
   * @param {'debug'|'info'|'warn'|'error'|'none'} level
   */
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.level = level;
    }
  },

  /**
   * Check if a level should be logged
   * @param {string} level
   * @returns {boolean}
   */
  shouldLog(level) {
    return this.levels[level] >= this.levels[this.level];
  },

  /**
   * Format message with timestamp
   * @param {string} level
   * @param {string} message
   * @returns {string}
   */
  format(level, message) {
    const time = new Date().toLocaleTimeString();
    const prefix = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌',
    };
    return `${prefix[level] || ''} [${time}] ${message}`;
  },

  /**
   * Debug level log
   * @param {...any} args
   */
  debug(...args) {
    if (this.shouldLog('debug')) {
      console.log(this.format('debug', args[0]), ...args.slice(1));
    }
  },

  /**
   * Info level log
   * @param {...any} args
   */
  info(...args) {
    if (this.shouldLog('info')) {
      console.info(this.format('info', args[0]), ...args.slice(1));
    }
  },

  /**
   * Warning level log
   * @param {...any} args
   */
  warn(...args) {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', args[0]), ...args.slice(1));
    }
  },

  /**
   * Error level log
   * @param {...any} args
   */
  error(...args) {
    if (this.shouldLog('error')) {
      console.error(this.format('error', args[0]), ...args.slice(1));
    }
  },

  /**
   * Group logs together
   * @param {string} label
   */
  group(label) {
    if (this.shouldLog('debug')) {
      console.group(label);
    }
  },

  /**
   * End log group
   */
  groupEnd() {
    if (this.shouldLog('debug')) {
      console.groupEnd();
    }
  },
};

// Initialize on load
Logger.init();

// Export for use in other modules
window.Logger = Logger;

