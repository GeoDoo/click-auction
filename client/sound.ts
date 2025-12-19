/**
 * SoundManager - Web Audio API sound effects
 * Works on all devices including mobile
 */

import { Logger } from './logger';

// Extend Window for webkit prefix
declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

let ctx: AudioContext | null = null;
let enabled = true;
let initialized = false;
let unlocked = false;

/**
 * Initialize and unlock audio context
 * Must be called on user interaction (click/touch)
 */
async function init(): Promise<void> {
  if (initialized && unlocked) return;

  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      initialized = true;
    }

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    if (!unlocked) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.01);
      unlocked = true;
      Logger.debug('Audio unlocked');
    }
  } catch (e) {
    Logger.warn('Sound initialization failed:', (e as Error).message);
  }
}

/**
 * Play a beep sound
 */
function beep(
  freq = 440,
  duration = 0.1,
  type: OscillatorType = 'sine',
  volume = 0.5
): void {
  if (!ctx || !enabled || !unlocked) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (e) {
    Logger.warn('Beep failed:', (e as Error).message);
  }
}

/** Short tap/click sound */
function tap(): void {
  beep(880, 0.04, 'square', 0.4);
}

/** Countdown tick sound */
function countdownTick(): void {
  beep(520, 0.15, 'sine', 0.6);
}

/** GO! sound - rising tone */
function go(): void {
  if (!ctx || !enabled || !unlocked) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    Logger.warn('Go sound failed:', (e as Error).message);
  }
}

/** Winner fanfare - ascending arpeggio */
function winner(): void {
  if (!ctx || !enabled || !unlocked) return;

  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((freq, i) => {
    setTimeout(() => beep(freq, 0.45, 'sine', 0.6), i * 120);
  });
}

/** End/loser sound - low tone */
function end(): void {
  beep(330, 0.3, 'sine', 0.4);
}

/** Toggle sound on/off */
function toggle(): boolean {
  enabled = !enabled;
  Logger.info(`Sound ${enabled ? 'enabled' : 'disabled'}`);
  return enabled;
}

// Auto-initialize on user interaction
document.addEventListener('click', () => init());
document.addEventListener('touchstart', () => init());

export const SoundManager = {
  init,
  beep,
  tap,
  countdownTick,
  go,
  winner,
  end,
  toggle,
};

