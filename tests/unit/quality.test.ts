import { describe, expect, it } from 'vitest';
import { QualityController } from '../../src/core/quality';

/** Small windows so a "window" is only `size` samples. */
function auto(opts: { size?: number; toDrop?: number; toRaise?: number; cooldownMs?: number } = {}) {
  return new QualityController('auto', {
    windowSize: opts.size ?? 4,
    windowsToDrop: opts.toDrop ?? 2,
    windowsToRaise: opts.toRaise ?? 3,
    cooldownMs: opts.cooldownMs ?? 0,
  });
}

function feedWindow(qc: QualityController, frameMs: number, now: number) {
  let last = qc.sample(frameMs, now);
  for (let i = 1; i < 4; i += 1) last = qc.sample(frameMs, now);
  return last;
}

describe('QualityController', () => {
  it('manual preset wins and is never overridden by samples', () => {
    const qc = auto();
    expect(qc.setManual('high')).toEqual({ changed: true, preset: 'high', reason: 'manual' });
    // Two full bad windows would drop an auto controller.
    expect(feedWindow(qc, 40, 1000).changed).toBe(false);
    expect(feedWindow(qc, 40, 2000).changed).toBe(false);
    expect(qc.preset).toBe('high');
    // Samples still accumulate but decisions are frozen while manual.
    expect(qc.setting).toBe('high');
  });

  it('setManual("auto") returns to automatic without an immediate change', () => {
    const qc = auto();
    qc.setManual('low');
    const result = qc.setManual('auto');
    expect(result.changed).toBe(false);
    expect(qc.setting).toBe('auto');
  });

  it('auto drops after N bad windows', () => {
    const qc = auto({ toDrop: 2 });
    expect(feedWindow(qc, 40, 1000)).toMatchObject({ changed: false, preset: 'medium' });
    expect(feedWindow(qc, 40, 2000)).toMatchObject({ changed: true, preset: 'low', reason: 'down' });
  });

  it('never drops below low', () => {
    const backToAuto = new QualityController('auto', { windowSize: 4, windowsToDrop: 1, cooldownMs: 0 });
    feedWindow(backToAuto, 40, 1000); // medium -> low
    // More bad windows at low must be a no-op.
    for (let w = 0; w < 3; w += 1) {
      const result = feedWindow(backToAuto, 40, 2000 + w * 10);
      expect(result).toMatchObject({ changed: false, preset: 'low' });
    }
  });

  it('never rises above high', () => {
    const qc = auto({ toRaise: 1, cooldownMs: 1 });
    feedWindow(qc, 5, 1000); // medium -> high
    expect(qc.preset).toBe('high');
    for (let w = 0; w < 3; w += 1) {
      expect(feedWindow(qc, 5, 2000 + w * 10).changed).toBe(false);
    }
    expect(qc.preset).toBe('high');
  });

  it('cooldown blocks a second change until it expires', () => {
    const qc = new QualityController('auto', {
      windowSize: 4,
      windowsToDrop: 1,
      windowsToRaise: 1,
      cooldownMs: 4000,
    });
    // The loop clock starts at lastChangeAt = 0 with a 4 s cooldown, so the
    // first automatic decision happens after t = 4000.
    expect(feedWindow(qc, 5, 5000)).toMatchObject({ changed: true, reason: 'up', preset: 'high' });
    // A bad window inside the cooldown is ignored.
    expect(feedWindow(qc, 40, 7000)).toMatchObject({ changed: false, preset: 'high' });
    // After the cooldown the same bad window takes effect.
    expect(feedWindow(qc, 40, 10000)).toMatchObject({ changed: true, reason: 'down', preset: 'medium' });
  });

  it('ignores invalid frame times (NaN, <=0, >250)', () => {
    const qc = auto({ size: 4, toDrop: 1 });
    for (const bad of [Number.NaN, 0, -16, 300, Number.POSITIVE_INFINITY]) {
      expect(qc.sample(bad, 1000).changed).toBe(false);
    }
    // None of the garbage filled the window: one valid bad window now decides.
    expect(feedWindow(qc, 40, 2000)).toMatchObject({ changed: true, preset: 'low' });
  });

  it('hysteresis: one good window after bad does not raise', () => {
    const qc = auto({ toDrop: 1, toRaise: 3 });
    expect(feedWindow(qc, 40, 1000)).toMatchObject({ changed: true, preset: 'low' });
    expect(feedWindow(qc, 5, 2000)).toMatchObject({ changed: false, preset: 'low' });
    expect(feedWindow(qc, 5, 3000)).toMatchObject({ changed: false, preset: 'low' });
    // Only sustained headroom (3 good windows) climbs back up.
    expect(feedWindow(qc, 5, 4000)).toMatchObject({ changed: true, reason: 'up', preset: 'medium' });
  });

  it('a window inside the dead zone neither counts as bad nor good', () => {
    const qc = auto({ toRaise: 1 });
    // p95 between upThresholdMs (12) and downThresholdMs (22) resets the good streak.
    expect(feedWindow(qc, 16, 1000)).toMatchObject({ changed: false });
    expect(feedWindow(qc, 16, 2000)).toMatchObject({ changed: false });
    expect(qc.preset).toBe('medium');
  });
});
