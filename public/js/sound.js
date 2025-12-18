/**
 * SoundManager - Web Audio API sound effects
 * Works on all devices including mobile
 * @module SoundManager
 */

const SoundManager = {
  /** @type {AudioContext|null} */
  ctx: null,
  /** @type {boolean} */
  enabled: true,
  /** @type {boolean} */
  initialized: false,
  /** @type {boolean} */
  unlocked: false,

  /**
   * Initialize and unlock audio context
   * Must be called on user interaction (click/touch)
   * @returns {Promise<void>}
   */
  async init() {
    if (this.initialized && this.unlocked) return;

    try {
      // Create context if not exists
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.initialized = true;
      }

      // Resume if suspended (required for Chrome/Android)
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // Play a silent sound to fully unlock audio (Android fix)
      if (!this.unlocked) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        gain.gain.value = 0.001; // Nearly silent
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.01);
        this.unlocked = true;
        Logger.debug('Audio unlocked');
      }
    } catch (e) {
      Logger.warn('Sound initialization failed:', e.message);
    }
  },

  /**
   * Play a beep sound
   * @param {number} freq - Frequency in Hz
   * @param {number} duration - Duration in seconds
   * @param {OscillatorType} type - Oscillator type
   * @param {number} volume - Volume 0-1
   */
  beep(freq = 440, duration = 0.1, type = 'sine', volume = 0.5) {
    if (!this.ctx || !this.enabled || !this.unlocked) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(volume, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + duration);
    } catch (e) {
      Logger.warn('Beep failed:', e.message);
    }
  },

  /**
   * Short tap/click sound
   */
  tap() {
    this.beep(880, 0.04, 'square', 0.4);
  },

  /**
   * Countdown tick sound
   */
  countdownTick() {
    this.beep(520, 0.15, 'sine', 0.6);
  },

  /**
   * GO! sound - rising tone
   */
  go() {
    if (!this.ctx || !this.enabled || !this.unlocked) return;

    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(400, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + 0.35);
    } catch (e) {
      Logger.warn('Go sound failed:', e.message);
    }
  },

  /**
   * Winner fanfare - ascending arpeggio
   */
  winner() {
    if (!this.ctx || !this.enabled || !this.unlocked) return;

    const notes = [523, 659, 784, 1047, 1319]; // C5, E5, G5, C6, E6
    notes.forEach((freq, i) => {
      setTimeout(() => this.beep(freq, 0.45, 'sine', 0.6), i * 120);
    });
  },

  /**
   * End/loser sound - low tone
   */
  end() {
    this.beep(330, 0.3, 'sine', 0.4);
  },

  /**
   * Toggle sound on/off
   * @returns {boolean} New enabled state
   */
  toggle() {
    this.enabled = !this.enabled;
    Logger.info(`Sound ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  },
};

// Auto-initialize on user interaction
document.addEventListener('click', () => SoundManager.init(), { once: false });
document.addEventListener('touchstart', () => SoundManager.init(), { once: false });

// Export for use in other modules
window.SoundManager = SoundManager;

