import { describe, expect, it } from 'vitest';
import { damageFlashAlpha } from '../../src/ui/hud';

describe('damageFlashAlpha', () => {
  it('peaks at 0.9 right after a hit and fades out by 0.6 s with full effects', () => {
    expect(damageFlashAlpha(0, false)).toBeCloseTo(0.9, 5);
    expect(damageFlashAlpha(0.6, false)).toBe(0);
  });

  it('caps the peak when flashes are reduced and still fades within the same window', () => {
    expect(damageFlashAlpha(0, true)).toBeLessThanOrEqual(0.3);
    expect(damageFlashAlpha(0.3, true)).toBeGreaterThan(0);
    expect(damageFlashAlpha(0.6, true)).toBe(0);
  });

  it('never exceeds the full-effects value', () => {
    for (let age = 0; age <= 0.8; age += 0.1) {
      expect(damageFlashAlpha(age, true)).toBeLessThanOrEqual(damageFlashAlpha(age, false) + 1e-9);
    }
  });
});

describe('traceEnemyMarker', () => {
  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      ctx: {
        arc: () => calls.push('arc'),
        rect: () => calls.push('rect'),
        moveTo: () => calls.push('moveTo'),
        lineTo: () => calls.push('lineTo'),
        closePath: () => calls.push('closePath'),
      },
    };
  }

  it('draws a different shape for each enemy kind so color is not the only cue', async () => {
    const { traceEnemyMarker } = await import('../../src/ui/hud');
    const shapes = [0, 1, 2].map((kind) => {
      const r = recorder();
      traceEnemyMarker(r.ctx, kind, 10, 10);
      return r.calls.join(',');
    });
    expect(new Set(shapes).size).toBe(3);
  });
});
