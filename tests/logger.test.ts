/**
 * Tests for Logger module
 */

describe('Logger', () => {
  let Logger: typeof import('../src/logger').default;
  let consoleLogSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    // Reset module cache to get fresh Logger with current NODE_ENV
    jest.resetModules();
    
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    consoleLogSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('in development mode', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      Logger = (await import('../src/logger')).default;
    });

    it('logs debug messages', () => {
      Logger.debug('Debug message');
      expect(consoleLogSpy).toHaveBeenCalled();
      expect(consoleLogSpy.mock.calls[0][0]).toContain('Debug message');
    });

    it('logs info messages', () => {
      Logger.info('Info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('Info message');
    });

    it('logs warn messages', () => {
      Logger.warn('Warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Warn message');
    });

    it('logs error messages', () => {
      Logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('Error message');
    });

    it('includes timestamp in log output', () => {
      Logger.info('Test');
      const logOutput = consoleInfoSpy.mock.calls[0][0];
      // Check for ISO timestamp pattern
      expect(logOutput).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('includes emoji prefix in log output', () => {
      Logger.debug('Test');
      Logger.info('Test');
      Logger.warn('Test');
      Logger.error('Test');

      expect(consoleLogSpy.mock.calls[0][0]).toContain('🔍');
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('ℹ️');
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('⚠️');
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('❌');
    });
  });

  describe('in production mode', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'production';
      jest.resetModules();
      Logger = (await import('../src/logger')).default;
    });

    it('does not log debug messages', () => {
      Logger.debug('Debug message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('logs info messages', () => {
      Logger.info('Info message');
      expect(consoleInfoSpy).toHaveBeenCalled();
    });

    it('logs warn messages', () => {
      Logger.warn('Warn message');
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('logs error messages', () => {
      Logger.error('Error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('specialized logging methods', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      Logger = (await import('../src/logger')).default;
    });

    it('playerAction logs player name and action', () => {
      Logger.playerAction('joined', 'TestPlayer');
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('TestPlayer');
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('joined');
    });

    it('playerAction includes additional details', () => {
      Logger.playerAction('clicked', 'TestPlayer', { clicks: 5 });
      expect(consoleInfoSpy.mock.calls[0][1]).toEqual({ clicks: 5 });
    });

    it('gameEvent logs event name', () => {
      Logger.gameEvent('Auction started');
      expect(consoleInfoSpy).toHaveBeenCalled();
      expect(consoleInfoSpy.mock.calls[0][0]).toContain('Auction started');
    });

    it('gameEvent includes additional details', () => {
      Logger.gameEvent('Auction ended', { winner: 'Player1' });
      expect(consoleInfoSpy.mock.calls[0][1]).toEqual({ winner: 'Player1' });
    });

    it('security logs IP and event', () => {
      Logger.security('Rate limited', '192.168.1.1');
      expect(consoleWarnSpy).toHaveBeenCalled();
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('192.168.1.1');
      expect(consoleWarnSpy.mock.calls[0][0]).toContain('Rate limited');
    });

    it('security includes additional details', () => {
      Logger.security('Connection rejected', '10.0.0.1', { reason: 'limit' });
      expect(consoleWarnSpy.mock.calls[0][1]).toEqual({ reason: 'limit' });
    });
  });

  describe('with additional arguments', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      Logger = (await import('../src/logger')).default;
    });

    it('passes extra arguments to console', () => {
      const obj = { key: 'value' };
      Logger.info('Message', obj, 123, 'extra');
      
      expect(consoleInfoSpy.mock.calls[0][1]).toBe(obj);
      expect(consoleInfoSpy.mock.calls[0][2]).toBe(123);
      expect(consoleInfoSpy.mock.calls[0][3]).toBe('extra');
    });
  });
});


