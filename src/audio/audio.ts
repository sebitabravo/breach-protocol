/**
 * Every sound in the game is synthesised with Web Audio: no audio files, no
 * downloads, no licensing questions, and the whole SFX set fits in this file.
 * The context is only created after a user gesture, as browsers require.
 */
export type SoundName =
  | 'shotSidearm'
  | 'shotCarbine'
  | 'hit'
  | 'kill'
  | 'damage'
  | 'enemyShot'
  | 'windup'
  | 'node'
  | 'wave'
  | 'reload'
  | 'empty'
  | 'ui'
  | 'win'
  | 'lose';

const MIN_GAP_MS: Partial<Record<SoundName, number>> = {
  shotSidearm: 40,
  shotCarbine: 28,
  hit: 25,
  enemyShot: 45,
  ui: 60,
};

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<SoundName, number>();
  private enabled = true;
  private volume = 0.7;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(enabled ? this.volume : 0, this.ctx.currentTime, 0.02);
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx && this.enabled) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    }
  }

  /** Must be called from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend();
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended' && this.enabled) {
      void this.ctx.resume();
    }
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.6), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private throttled(name: SoundName): boolean {
    const gap = MIN_GAP_MS[name];
    if (!gap) return false;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (now - last < gap) return true;
    this.lastPlayed.set(name, now);
    return false;
  }

  play(name: SoundName): void {
    if (!this.enabled) return;
    if (!this.ctx || !this.master || this.ctx.state !== 'running') return;
    if (this.throttled(name)) return;
    switch (name) {
      case 'shotSidearm':
        this.noiseBurst({ duration: 0.13, type: 'bandpass', from: 1600, to: 320, gain: 0.5, q: 0.9 });
        this.tone({ from: 160, to: 70, duration: 0.09, gain: 0.3, wave: 'square' });
        break;
      case 'shotCarbine':
        this.noiseBurst({ duration: 0.08, type: 'highpass', from: 1400, to: 600, gain: 0.34, q: 0.7 });
        this.tone({ from: 220, to: 90, duration: 0.05, gain: 0.18, wave: 'square' });
        break;
      case 'hit':
        this.tone({ from: 1500, to: 900, duration: 0.05, gain: 0.16, wave: 'triangle' });
        break;
      case 'kill':
        this.tone({ from: 700, to: 320, duration: 0.16, gain: 0.22, wave: 'square' });
        this.noiseBurst({ duration: 0.14, type: 'lowpass', from: 900, to: 200, gain: 0.2, q: 0.6 });
        break;
      case 'damage':
        this.noiseBurst({ duration: 0.22, type: 'lowpass', from: 520, to: 120, gain: 0.4, q: 0.5 });
        this.tone({ from: 90, to: 55, duration: 0.24, gain: 0.28, wave: 'sine' });
        break;
      case 'enemyShot':
        this.tone({ from: 760, to: 220, duration: 0.13, gain: 0.16, wave: 'sawtooth' });
        break;
      case 'windup':
        this.tone({ from: 320, to: 880, duration: 0.3, gain: 0.1, wave: 'sine' });
        break;
      case 'node':
        this.tone({ from: 660, to: 660, duration: 0.09, gain: 0.2, wave: 'sine' });
        this.tone({ from: 990, to: 990, duration: 0.16, gain: 0.18, wave: 'sine', delay: 0.1 });
        break;
      case 'wave':
        this.tone({ from: 330, to: 330, duration: 0.14, gain: 0.16, wave: 'square' });
        this.tone({ from: 440, to: 440, duration: 0.14, gain: 0.16, wave: 'square', delay: 0.14 });
        this.tone({ from: 550, to: 550, duration: 0.22, gain: 0.16, wave: 'square', delay: 0.28 });
        break;
      case 'reload':
        this.noiseBurst({ duration: 0.05, type: 'highpass', from: 2200, to: 1500, gain: 0.16, q: 1 });
        this.noiseBurst({ duration: 0.06, type: 'bandpass', from: 900, to: 700, gain: 0.16, q: 1.4, delay: 0.16 });
        break;
      case 'empty':
        this.tone({ from: 240, to: 180, duration: 0.05, gain: 0.14, wave: 'square' });
        break;
      case 'ui':
        this.tone({ from: 1200, to: 1200, duration: 0.03, gain: 0.08, wave: 'square' });
        break;
      case 'win':
        [523, 659, 784, 1046].forEach((f, i) =>
          this.tone({ from: f, to: f, duration: 0.26, gain: 0.14, wave: 'triangle', delay: i * 0.13 }),
        );
        break;
      case 'lose':
        [392, 311, 233].forEach((f, i) =>
          this.tone({ from: f, to: f * 0.98, duration: 0.34, gain: 0.14, wave: 'sine', delay: i * 0.18 }),
        );
        break;
      default:
        break;
    }
  }

  private tone(opts: {
    from: number;
    to: number;
    duration: number;
    gain: number;
    wave: OscillatorType;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.wave;
    osc.frequency.setValueAtTime(Math.max(20, opts.from), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), start + opts.duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, opts.gain), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + opts.duration + 0.02);
  }

  private noiseBurst(opts: {
    duration: number;
    type: BiquadFilterType;
    from: number;
    to: number;
    gain: number;
    q: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const ctx = this.ctx;
    const start = ctx.currentTime + (opts.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.playbackRate.value = 1;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.type;
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(opts.from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), start + opts.duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0002, opts.gain), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + opts.duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start);
    source.stop(start + opts.duration + 0.02);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}
