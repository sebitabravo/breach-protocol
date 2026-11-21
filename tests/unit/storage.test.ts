import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../src/core/settings';
import { bestScore, loadScores, saveScore, type RunResult } from '../../src/core/scores';
import { safeStorage } from '../../src/core/storage';

const run: RunResult = {
  score: 100,
  kills: 1,
  accuracy: 0.5,
  nodes: 1,
  timeLeft: 10,
  damage: 0,
  durationMs: 1000,
  mode: 'run',
  input: 'mouse',
  difficulty: 'operator',
  won: true,
  at: 1,
};

/** Simula el SecurityError que lanza el getter con datos de sitio bloqueados. */
function blockStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('storage blocked by the browser', () => {
  it('safeStorage returns undefined instead of throwing', () => {
    blockStorage();
    expect(safeStorage()).toBeUndefined();
  });

  it('loadSettings and saveSettings fall back to defaults', () => {
    blockStorage();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('loadScores, saveScore and bestScore keep working in memory', () => {
    blockStorage();
    expect(loadScores()).toEqual([]);
    expect(saveScore(run).rank).toBe(0);
    expect(bestScore()).toBeNull();
  });
});
