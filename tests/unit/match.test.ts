import { describe, expect, it } from 'vitest';
import { buildRunResult, buildStartOptions } from '../../src/core/match';
import { MODE } from '../../src/wasm/protocol';

const facts = {
  score: 1234.4,
  kills: 7,
  shots: 20,
  hits: 9,
  nodesActive: 2,
  timeLeft: 61.5,
  timeElapsed: 118.5,
  damageTaken: 33.6,
};

describe('buildStartOptions', () => {
  it('maps every shell mode to its engine mode id', () => {
    const base = { mapId: 1, seed: 9, aimAssist: true, autoReload: false };
    expect(buildStartOptions({ ...base, mode: 'run' }).mode).toBe(MODE.mission);
    expect(buildStartOptions({ ...base, mode: 'overflow' }).mode).toBe(MODE.overflow);
    expect(buildStartOptions({ ...base, mode: 'daily' }).mode).toBe(MODE.daily);
    expect(buildStartOptions({ ...base, mode: 'practice' }).mode).toBe(MODE.practice);
    expect(buildStartOptions({ ...base, mode: 'run' })).toEqual({
      mode: MODE.mission,
      map: 1,
      seed: 9,
      aimAssist: true,
      autoReload: false,
    });
  });
});

describe('buildRunResult', () => {
  const context = { mode: 'run' as const, input: 'mouse' as const, won: true, at: 42 };

  it('rounds score and damage and derives accuracy from shots', () => {
    const run = buildRunResult(facts, context);
    expect(run.score).toBe(1234);
    expect(run.damage).toBe(34);
    expect(run.accuracy).toBeCloseTo(0.45);
    expect(run.kills).toBe(7);
    expect(run.nodes).toBe(2);
  });

  it('reports zero accuracy when the player never fired', () => {
    expect(buildRunResult({ ...facts, shots: 0, hits: 0 }, context).accuracy).toBe(0);
  });

  it('converts sim seconds to milliseconds and never goes negative', () => {
    expect(buildRunResult(facts, context).durationMs).toBeCloseTo(118_500);
    expect(buildRunResult({ ...facts, timeElapsed: -1 }, context).durationMs).toBe(0);
  });

  it('keeps the context fields that the scoreboard filters on', () => {
    const run = buildRunResult(facts, { ...context, mode: 'practice', input: 'touch', won: false });
    expect(run).toMatchObject({ mode: 'practice', input: 'touch', won: false, at: 42, difficulty: 'operator' });
  });
});
