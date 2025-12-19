/**
 * Logger - Centralized logging with levels
 * Only shows logs appropriate for the environment
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

interface LogLevels {
  debug: number;
  info: number;
  warn: number;
  error: number;
  none: number;
}

const levels: LogLevels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

let currentLevel: LogLevel = 'info';

const prefixes: Record<string, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

function init(): void {
  const isDev =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname);

  currentLevel = isDev ? 'debug' : 'warn';
}

function setLevel(level: LogLevel): void {
  if (levels[level] !== undefined) {
    currentLevel = level;
  }
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

function format(level: LogLevel, message: string): string {
  const time = new Date().toLocaleTimeString();
  return `${prefixes[level] || ''} [${time}] ${message}`;
}

function debug(...args: unknown[]): void {
  if (shouldLog('debug')) {
    console.log(format('debug', String(args[0])), ...args.slice(1));
  }
}

function info(...args: unknown[]): void {
  if (shouldLog('info')) {
    console.info(format('info', String(args[0])), ...args.slice(1));
  }
}

function warn(...args: unknown[]): void {
  if (shouldLog('warn')) {
    console.warn(format('warn', String(args[0])), ...args.slice(1));
  }
}

function error(...args: unknown[]): void {
  if (shouldLog('error')) {
    console.error(format('error', String(args[0])), ...args.slice(1));
  }
}

function group(label: string): void {
  if (shouldLog('debug')) {
    console.group(label);
  }
}

function groupEnd(): void {
  if (shouldLog('debug')) {
    console.groupEnd();
  }
}

// Initialize on load
init();

export const Logger = {
  init,
  setLevel,
  shouldLog,
  debug,
  info,
  warn,
  error,
  group,
  groupEnd,
};

