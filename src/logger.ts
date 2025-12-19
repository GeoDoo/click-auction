/**
 * Server-side Logger with levels
 * @module Logger
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

// Default to 'info' in production, 'debug' in development
const currentLevel: LogLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

/**
 * Check if a level should be logged
 */
function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

/**
 * Format log message with timestamp and emoji
 */
function format(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  const prefixes: Record<string, string> = {
    debug: '🔍',
    info: 'ℹ️ ',
    warn: '⚠️ ',
    error: '❌',
  };
  return `${prefixes[level] || ''} [${timestamp}] ${message}`;
}

interface ILogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  playerAction(action: string, playerName: string, details?: Record<string, unknown>): void;
  gameEvent(event: string, details?: Record<string, unknown>): void;
  security(event: string, ip: string, details?: Record<string, unknown>): void;
}

const Logger: ILogger = {
  /**
   * Debug level log - development only
   */
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(format('debug', message), ...args);
    }
  },

  /**
   * Info level log
   */
  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.info(format('info', message), ...args);
    }
  },

  /**
   * Warning level log
   */
  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(format('warn', message), ...args);
    }
  },

  /**
   * Error level log
   */
  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(format('error', message), ...args);
    }
  },

  /**
   * Log player action
   */
  playerAction(action: string, playerName: string, details: Record<string, unknown> = {}): void {
    this.info(`Player [${playerName}] ${action}`, details);
  },

  /**
   * Log game event
   */
  gameEvent(event: string, details: Record<string, unknown> = {}): void {
    this.info(`Game: ${event}`, details);
  },

  /**
   * Log security event
   */
  security(event: string, ip: string, details: Record<string, unknown> = {}): void {
    this.warn(`Security [${ip}]: ${event}`, details);
  },
};

export default Logger;


