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
  /** p95 del intervalo de frame bajo el cual se considera que el display está al límite de su vsync. */
  vsyncOkMs?: number;
  /** p95 del tiempo de CPU del render bajo el cual queda margen para subir de preset. */
  cpuHeadroomMs?: number;
  /**
   * Tras bajar de un preset por no sostener el presupuesto, la subida por margen de CPU no vuelve a él durante
   * este tiempo (por defecto, toda la sesión). El CPU no ve la GPU: sin esto, un equipo limitado por GPU subiría
   * y bajaría con un tirón cada pocos minutos.
   */
  ceilingMs?: number;
}

export class QualityController {
  private mode: QualitySetting;
  private current: ResolvedQuality;
  private samples: number[] = [];
  private cpuSamples: number[] = [];
  /** La última ventana buena lo fue solo por margen de CPU (frames al límite del vsync). */
  private goodViaCpuOnly = false;
  private readonly blockedUntil: Record<ResolvedQuality, number> = { low: 0, medium: 0, high: 0 };
  private badWindows = 0;
  private goodWindows = 0;
  private lastChangeAt = 0;

  private readonly windowSize: number;
  private readonly downThresholdMs: number;
  private readonly upThresholdMs: number;
  private readonly windowsToDrop: number;
  private readonly windowsToRaise: number;
  private readonly cooldownMs: number;
  private readonly vsyncOkMs: number;
  private readonly cpuHeadroomMs: number;
  private readonly ceilingMs: number;

  constructor(initial: QualitySetting = 'auto', options: QualityOptions = {}) {
    this.mode = initial;
    this.current = initial === 'auto' ? 'medium' : initial;
    this.windowSize = options.windowSize ?? 45;
    this.downThresholdMs = options.downThresholdMs ?? 22;
    this.upThresholdMs = options.upThresholdMs ?? 12;
    this.windowsToDrop = options.windowsToDrop ?? 2;
    this.windowsToRaise = options.windowsToRaise ?? 5;
    this.cooldownMs = options.cooldownMs ?? 4000;
    this.vsyncOkMs = options.vsyncOkMs ?? 18.5;
    this.cpuHeadroomMs = options.cpuHeadroomMs ?? 4;
    this.ceilingMs = options.ceilingMs ?? Number.POSITIVE_INFINITY;
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
    this.goodViaCpuOnly = false;
    this.samples.length = 0;
    this.cpuSamples.length = 0;
    if (setting !== 'auto') {
      this.current = setting;
      return { changed: true, preset: this.current, reason: 'manual' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }

  /**
   * Feeds one frame time in milliseconds. `cpuMs` (tiempo de CPU del render) permite subir de preset
   * en pantallas atadas a vsync, donde el intervalo de frame nunca baja de ~16.7 ms aunque sobre margen.
   */
  sample(frameMs: number, now: number, cpuMs?: number): QualityChange {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
      return { changed: false, preset: this.current, reason: 'none' };
    }
    this.samples.push(frameMs);
    if (cpuMs !== undefined && Number.isFinite(cpuMs)) this.cpuSamples.push(cpuMs);
    if (this.samples.length < this.windowSize) {
      return { changed: false, preset: this.current, reason: 'none' };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const cpuP95 = this.p95(this.cpuSamples);
    this.samples.length = 0;
    this.cpuSamples.length = 0;

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
      this.goodViaCpuOnly = false;
    } else if (p95 <= this.vsyncOkMs && cpuP95 !== null && cpuP95 <= this.cpuHeadroomMs) {
      this.goodViaCpuOnly = true;
      this.goodWindows += 1;
      this.badWindows = 0;
    } else {
      this.badWindows = Math.max(0, this.badWindows - 1);
      this.goodWindows = 0;
    }

    if (this.badWindows >= this.windowsToDrop && index > 0) {
      this.blockedUntil[this.current] = now + this.ceilingMs;
      this.current = ORDER[index - 1];
      this.badWindows = 0;
      this.lastChangeAt = now;
      return { changed: true, preset: this.current, reason: 'down' };
    }
    if (this.goodWindows >= this.windowsToRaise && index < ORDER.length - 1 &&
      !(this.goodViaCpuOnly && now < this.blockedUntil[ORDER[index + 1]])) {
      this.current = ORDER[index + 1];
      this.goodWindows = 0;
      this.lastChangeAt = now;
      return { changed: true, preset: this.current, reason: 'up' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }

  private p95(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }
}
