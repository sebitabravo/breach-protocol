import { describe, expect, it } from 'vitest';
import { PLAY_PIXEL_BUDGET, PRESETS, playPixelRatio } from '../../src/render/presets';

const pixels = (dpr: number, w: number, h: number) => dpr * dpr * w * h;

describe('playPixelRatio', () => {
  it('caps high at its pixel budget on a 1600x900 retina display (was DPR 2 = 5.76 MP)', () => {
    const dpr = playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2);
    expect(pixels(dpr, 1600, 900)).toBeLessThanOrEqual(PLAY_PIXEL_BUDGET.high + 1);
    expect(dpr).toBeLessThan(2);
    expect(dpr).toBeGreaterThan(1.5);
  });

  it('does not touch a small screen that already fits the budget', () => {
    expect(playPixelRatio(PRESETS.high, 844, 390, Infinity, 2)).toBe(2);
  });

  it('keeps low and medium inside their own, tighter budgets', () => {
    for (const name of ['low', 'medium'] as const) {
      const dpr = playPixelRatio(PRESETS[name], 1600, 900, Infinity, 2);
      expect(pixels(dpr, 1600, 900)).toBeLessThanOrEqual(PLAY_PIXEL_BUDGET[name] + 1);
    }
  });

  it('respects the device cap and the real device pixel ratio', () => {
    expect(playPixelRatio(PRESETS.high, 400, 300, 1.75, 3)).toBe(1.75);
    expect(playPixelRatio(PRESETS.high, 400, 300, Infinity, 1)).toBe(1);
  });
});
