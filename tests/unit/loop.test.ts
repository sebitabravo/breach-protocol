import { describe, expect, it } from 'vitest';
import { FIXED_DT, FixedStepLoop, MAX_FRAME_DT, MAX_STEPS } from '../../src/core/loop';

describe('FixedStepLoop', () => {
  it('uses the 60 Hz defaults', () => {
    expect(FIXED_DT).toBeCloseTo(1 / 60, 12);
    expect(MAX_FRAME_DT).toBe(0.1);
    expect(MAX_STEPS).toBe(5);
  });

  it('a 1/60 s frame produces exactly one step and alpha 0', () => {
    const loop = new FixedStepLoop();
    const result = loop.advance(1 / 60);
    expect(result.steps).toBe(1);
    expect(result.alpha).toBe(0);
    expect(result.dropped).toBe(0);
    expect(loop.pending).toBeCloseTo(0, 12);
  });

  it('sixty 1/60 s frames produce exactly sixty steps (no drift)', () => {
    const loop = new FixedStepLoop();
    let steps = 0;
    for (let i = 0; i < 60; i += 1) steps += loop.advance(1 / 60).steps;
    expect(steps).toBe(60);
    expect(loop.pending).toBeLessThan(1e-9);
  });

  it('a 150 ms frame is clamped to MAX_FRAME_DT and drops surplus ticks', () => {
    const loop = new FixedStepLoop();
    const result = loop.advance(0.15); // 0.15 s clamped to 0.1 s = 6 ticks, capped at 5
    expect(result.steps).toBe(MAX_STEPS);
    expect(result.dropped).toBe(1);
    expect(result.alpha).toBe(0);
    expect(loop.pending).toBe(0);
  });

  it('maxSteps caps the step count and reports dropped ticks', () => {
    const loop = new FixedStepLoop(1 / 60, 2, 0.1);
    const result = loop.advance(0.1); // 6 ticks wanted, only 2 allowed
    expect(result.steps).toBe(2);
    expect(result.dropped).toBe(4);
  });

  it('alpha stays in [0, 1) and the accumulator never goes negative', () => {
    const loop = new FixedStepLoop();
    for (const frame of [1 / 240, 1 / 90, 1 / 60, 1 / 45, 1 / 30]) {
      const result = loop.advance(frame);
      expect(result.alpha).toBeGreaterThanOrEqual(0);
      expect(result.alpha).toBeLessThan(1);
      expect(loop.pending).toBeGreaterThanOrEqual(0);
    }
  });

  it('fractional accumulation interpolates: leftover time surfaces as alpha', () => {
    const loop = new FixedStepLoop();
    // Two 120 Hz frames: half a tick each; the second completes one step.
    const first = loop.advance(1 / 120);
    expect(first.steps).toBe(0);
    expect(first.alpha).toBeCloseTo(0.5, 10);
    const second = loop.advance(1 / 120);
    expect(second.steps).toBe(1);
    expect(second.alpha).toBeCloseTo(0, 10);
  });

  it('negative frame times are treated as zero', () => {
    const loop = new FixedStepLoop();
    const result = loop.advance(-1);
    expect(result).toEqual({ steps: 0, alpha: 0, dropped: 0 });
  });

  it('reset clears pending time', () => {
    const loop = new FixedStepLoop();
    loop.advance(1 / 120);
    expect(loop.pending).toBeGreaterThan(0);
    loop.reset();
    expect(loop.pending).toBe(0);
    expect(loop.advance(0.001).steps).toBe(0);
  });
});
