/**
 * Adaptive quality controller.
 *
 * Decisions come from a robust percentile of real frame times with asymmetric
 * hysteresis: drop fast when the budget is missed, climb slowly when there is
 * headroom, and never change twice inside the cooldown. A manual preset always
 * wins over the automatic one.
 */
export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type ResolvedQuality = 'low' | 'medium' | 'high';

const ORDER: ResolvedQuality[] = ['low', 'medium', 'high'];

export interface QualityChange {
  changed: boolean;
  preset: ResolvedQuality;
  reason: 'none' | 'down' | 'up' | 'manual';
}

export interface QualityOptions {
  windowSize?: number;
  /** p95 above this (ms) counts as missing the budget. */
  downThresholdMs?: number;
  /** p95 below this (ms) counts as having headroom. */
  upThresholdMs?: number;
  windowsToDrop?: number;
  windowsToRaise?: number;
  cooldownMs?: number;
}

export class QualityController {
  private mode: QualitySetting;
  private current: ResolvedQuality;
  private samples: number[] = [];
  private badWindows = 0;
  private goodWindows = 0;
  private lastChangeAt = 0;

  private readonly windowSize: number;
  private readonly downThresholdMs: number;
  private readonly upThresholdMs: number;
  private readonly windowsToDrop: number;
  private readonly windowsToRaise: number;
  private readonly cooldownMs: number;

  constructor(initial: QualitySetting = 'auto', options: QualityOptions = {}) {
    this.mode = initial;
    this.current = initial === 'auto' ? 'medium' : initial;
    this.windowSize = options.windowSize ?? 45;
    this.downThresholdMs = options.downThresholdMs ?? 22;
    this.upThresholdMs = options.upThresholdMs ?? 12;
    this.windowsToDrop = options.windowsToDrop ?? 2;
    this.windowsToRaise = options.windowsToRaise ?? 5;
    this.cooldownMs = options.cooldownMs ?? 4000;
  }

  get setting(): QualitySetting {
    return this.mode;
  }

  get preset(): ResolvedQuality {
    return this.current;
  }

  setManual(setting: QualitySetting): QualityChange {
    this.mode = setting;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.samples.length = 0;
    if (setting !== 'auto') {
      this.current = setting;
      return { changed: true, preset: this.current, reason: 'manual' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }

  /** Feeds one frame time in milliseconds. */
  sample(frameMs: number, now: number): QualityChange {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
      return { changed: false, preset: this.current, reason: 'none' };
    }
    this.samples.push(frameMs);
    if (this.samples.length < this.windowSize) {
      return { changed: false, preset: this.current, reason: 'none' };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    this.samples.length = 0;

    if (this.mode !== 'auto') {
      return { changed: false, preset: this.current, reason: 'none' };
    }
    if (now - this.lastChangeAt < this.cooldownMs) {
      return { changed: false, preset: this.current, reason: 'none' };
    }

    const index = ORDER.indexOf(this.current);

    if (p95 > this.downThresholdMs) {
      this.badWindows += 1;
      this.goodWindows = 0;
    } else if (p95 < this.upThresholdMs) {
      this.goodWindows += 1;
      this.badWindows = 0;
    } else {
      this.badWindows = Math.max(0, this.badWindows - 1);
      this.goodWindows = 0;
    }

    if (this.badWindows >= this.windowsToDrop && index > 0) {
      this.current = ORDER[index - 1];
      this.badWindows = 0;
      this.lastChangeAt = now;
      return { changed: true, preset: this.current, reason: 'down' };
    }
    if (this.goodWindows >= this.windowsToRaise && index < ORDER.length - 1) {
      this.current = ORDER[index + 1];
      this.goodWindows = 0;
      this.lastChangeAt = now;
      return { changed: true, preset: this.current, reason: 'up' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }
}
