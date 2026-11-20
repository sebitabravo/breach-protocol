import { describe, expect, it } from 'vitest';
import {
  SCORES_KEY,
  bestScore,
  grade,
  loadScores,
  saveScore,
  type RunResult,
} from '../../src/core/scores';
import type { StorageLike } from '../../src/core/settings';

function fakeStorage(initial: Record<string, string> = {}, failOnWrite = false): StorageLike {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      if (failOnWrite) throw new Error('quota exceeded');
      data.set(key, value);
    },
  };
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    score: 1000,
    kills: 3,
    accuracy: 0.5,
    nodes: 1,
    timeLeft: 60,
    damage: 10,
    durationMs: 90_000,
    mode: 'run',
    input: 'mouse',
    difficulty: 'operator',
    won: true,
    at: 1,
    ...overrides,
  };
}

describe('scores', () => {
  it('loadScores returns [] for missing, corrupt or non-array payloads', () => {
    expect(loadScores(fakeStorage())).toEqual([]);
    expect(loadScores(fakeStorage({ [SCORES_KEY]: 'garbage{' }))).toEqual([]);
    expect(loadScores(fakeStorage({ [SCORES_KEY]: '{"score": 1}' }))).toEqual([]);
    expect(loadScores(fakeStorage({ [SCORES_KEY]: '42' }))).toEqual([]);
  });

  it('loadScores drops entries that are not valid runs', () => {
    const junk = JSON.stringify([
      { score: 'no', kills: 1 },
      null,
      { score: 500, kills: 1, accuracy: 0.5, nodes: 1, mode: 'run' },
    ]);
    const loaded = loadScores(fakeStorage({ [SCORES_KEY]: junk }));
    expect(loaded).toHaveLength(1);
    expect(loaded[0].score).toBe(500);
  });

  it('sorts by score descending, then by kills descending', () => {
    const storage = fakeStorage();
    saveScore(run({ score: 500, kills: 9, at: 1 }), storage);
    saveScore(run({ score: 500, kills: 2, at: 2 }), storage);
    saveScore(run({ score: 900, kills: 0, at: 3 }), storage);
    saveScore(run({ score: 100, kills: 9, at: 4 }), storage);
    const order = loadScores(storage).map((r) => [r.score, r.kills]);
    expect(order).toEqual([
      [900, 0],
      [500, 9],
      [500, 2],
      [100, 9],
    ]);
  });

  it('keeps at most MAX_ENTRIES (10) entries', () => {
    const storage = fakeStorage();
    for (let i = 0; i < 14; i += 1) {
      saveScore(run({ score: 100 + i, at: i }), storage);
    }
    const loaded = loadScores(storage);
    expect(loaded).toHaveLength(10);
    // The weakest runs are the ones dropped (kept: 104..113).
    expect(loaded[loaded.length - 1].score).toBe(104);
    expect(loaded.some((r) => r.score === 100)).toBe(false);
  });

  it('isRecord is true only when beating the previous best', () => {
    const storage = fakeStorage();
    expect(saveScore(run({ score: 500, at: 1 }), storage).isRecord).toBe(true); // first run
    expect(saveScore(run({ score: 500, at: 2 }), storage).isRecord).toBe(false); // ties don't count
    expect(saveScore(run({ score: 400, at: 3 }), storage).isRecord).toBe(false);
    expect(saveScore(run({ score: 501, at: 4 }), storage).isRecord).toBe(true);
  });

  it('saveScore survives a throwing storage and still ranks the run', () => {
    const storage = fakeStorage({}, true);
    const outcome = saveScore(run({ score: 700, at: 1 }), storage);
    expect(outcome.isRecord).toBe(true);
    expect(outcome.rank).toBe(0);
  });

  it('saveScore ignores missing storage gracefully', () => {
    expect(() => saveScore(run(), undefined)).not.toThrow();
  });

  it('bestScore filters by mode', () => {
    const storage = fakeStorage();
    saveScore(run({ score: 800, mode: 'run', at: 1 }), storage);
    saveScore(run({ score: 1500, mode: 'practice', at: 2 }), storage);
    expect(bestScore('run', storage)).toBe(800);
    expect(bestScore('practice', storage)).toBe(1500);
    expect(bestScore('run', fakeStorage())).toBeNull();
  });

  describe('grade boundaries', () => {
    it('requires score, accuracy and all nodes for S', () => {
      expect(grade({ score: 3200, won: true, accuracy: 0.45, nodes: 3 })).toBe('S');
      expect(grade({ score: 3200, won: true, accuracy: 0.4499, nodes: 3 })).toBe('A');
      expect(grade({ score: 3199, won: true, accuracy: 0.9, nodes: 3 })).toBe('A');
      expect(grade({ score: 3200, won: true, accuracy: 0.9, nodes: 2 })).toBe('A');
    });

    it('assigns A/B/C by score when won', () => {
      expect(grade({ score: 2400, won: true, accuracy: 0, nodes: 0 })).toBe('A');
      expect(grade({ score: 2399, won: true, accuracy: 0, nodes: 0 })).toBe('B');
      expect(grade({ score: 1600, won: true, accuracy: 0, nodes: 0 })).toBe('B');
      expect(grade({ score: 1599, won: true, accuracy: 0, nodes: 0 })).toBe('C');
      expect(grade({ score: 0, won: true, accuracy: 0, nodes: 0 })).toBe('C');
    });

    it('caps a lost run at C and gives D otherwise', () => {
      expect(grade({ score: 1200, won: false, accuracy: 0.9, nodes: 3 })).toBe('C');
      expect(grade({ score: 1199, won: false, accuracy: 0.9, nodes: 3 })).toBe('D');
      expect(grade({ score: 0, won: false, accuracy: 0, nodes: 0 })).toBe('D');
    });
  });
});
