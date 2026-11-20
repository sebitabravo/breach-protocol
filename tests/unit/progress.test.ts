import { describe, expect, it } from 'vitest';
import type { StorageLike } from '../../src/core/settings';
import {
  PROGRESS_KEY,
  ProgressStore,
  defaultProgress,
  isSectorCleared,
  isSectorUnlocked,
  isShotgunUnlocked,
  markTutorialSeen,
  parseProgress,
  recordDailyPlay,
  recordMission,
  recordOverflow,
  setPlayerName,
} from '../../src/core/progress';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
}

const brokenStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

const won = { sector: 0 as const, won: true, score: 2310, timeMs: 150_000 };

describe('default progress', () => {
  it('starts with every sector locked except the first one', () => {
    const state = defaultProgress();
    expect(isSectorUnlocked(state, 0)).toBe(true);
    expect(isSectorUnlocked(state, 1)).toBe(false);
    expect(isSectorUnlocked(state, 2)).toBe(false);
    expect(isShotgunUnlocked(state)).toBe(false);
  });

  it('inherits the legacy tutorial flag only when asked to', () => {
    expect(defaultProgress({ legacyTutorialSeen: true }).tutorialSeen).toBe(true);
    expect(defaultProgress().tutorialSeen).toBe(false);
  });
});

describe('unlocks', () => {
  it('opens SECTOR_02 after a mission win on SECTOR_01, not after a loss', () => {
    const lost = recordMission(defaultProgress(), { ...won, won: false });
    expect(isSectorUnlocked(lost, 1)).toBe(false);
    const cleared = recordMission(defaultProgress(), won);
    expect(isSectorUnlocked(cleared, 1)).toBe(true);
    expect(isSectorUnlocked(cleared, 2)).toBe(false);
  });

  it('opens SECTOR_03 only after clearing SECTOR_02', () => {
    const afterOne = recordMission(defaultProgress(), won);
    const afterTwo = recordMission(afterOne, { ...won, sector: 1 });
    expect(isSectorUnlocked(afterTwo, 2)).toBe(true);
  });

  it('unlocks SG-08 when SECTOR_02 is cleared', () => {
    const afterOne = recordMission(defaultProgress(), won);
    expect(isShotgunUnlocked(afterOne)).toBe(false);
    expect(isShotgunUnlocked(recordMission(afterOne, { ...won, sector: 1 }))).toBe(true);
  });
});

describe('mission records', () => {
  it('keeps the best score and the fastest win per sector', () => {
    let state = recordMission(defaultProgress(), won);
    state = recordMission(state, { sector: 0, won: true, score: 1800, timeMs: 90_000 });
    state = recordMission(state, { sector: 0, won: false, score: 4000, timeMs: 30_000 });
    expect(state.sectors[0]).toEqual({ attempts: 3, wins: 2, bestScore: 4000, bestTimeMs: 90_000 });
  });

  it('never records a loss as the best time', () => {
    const state = recordMission(defaultProgress(), { sector: 1, won: false, score: 500, timeMs: 12_000 });
    expect(state.sectors[1].bestTimeMs).toBeNull();
    expect(isSectorCleared(state, 1)).toBe(false);
  });

  it('does not mutate the state it was given', () => {
    const before = defaultProgress();
    recordMission(before, won);
    expect(before.sectors[0].attempts).toBe(0);
  });
});

describe('overflow and tutorial', () => {
  it('keeps the best wave and score across runs', () => {
    let state = recordOverflow(defaultProgress(), { wave: 4, score: 5100 });
    state = recordOverflow(state, { wave: 2, score: 9000 });
    expect(state.overflow).toEqual({ bestWave: 4, bestScore: 9000 });
  });

  it('marks the tutorial as seen and stays idempotent', () => {
    const once = markTutorialSeen(defaultProgress());
    expect(once.tutorialSeen).toBe(true);
    expect(markTutorialSeen(once)).toBe(once);
  });
});

describe('daily streak (UTC)', () => {
  it('starts a streak of one on the first play', () => {
    expect(recordDailyPlay(defaultProgress(), '2026-11-20').daily).toEqual({
      lastPlayed: '2026-11-20',
      streak: 1,
    });
  });

  it('does not count a second play on the same day', () => {
    const first = recordDailyPlay(defaultProgress(), '2026-11-20');
    expect(recordDailyPlay(first, '2026-11-20')).toBe(first);
  });

  it('extends the streak when the previous day was played', () => {
    const state = recordDailyPlay(recordDailyPlay(defaultProgress(), '2026-11-19'), '2026-11-20');
    expect(state.daily.streak).toBe(2);
  });

  it('extends across the month and year boundaries', () => {
    const month = recordDailyPlay(recordDailyPlay(defaultProgress(), '2026-01-31'), '2026-02-01');
    expect(month.daily.streak).toBe(2);
    const year = recordDailyPlay(recordDailyPlay(defaultProgress(), '2026-12-31'), '2027-01-01');
    expect(year.daily.streak).toBe(2);
  });

  it('counts the leap day as the day between February 28 and March 1', () => {
    const leap = recordDailyPlay(recordDailyPlay(defaultProgress(), '2028-02-28'), '2028-02-29');
    expect(recordDailyPlay(leap, '2028-03-01').daily.streak).toBe(3);
    const common = recordDailyPlay(recordDailyPlay(defaultProgress(), '2027-02-28'), '2027-03-01');
    expect(common.daily.streak).toBe(2);
  });

  it('resets the streak after a missed day', () => {
    const state = recordDailyPlay(recordDailyPlay(defaultProgress(), '2026-11-18'), '2026-11-20');
    expect(state.daily.streak).toBe(1);
  });

  it('ignores malformed dates and dates older than the last play', () => {
    const state = recordDailyPlay(defaultProgress(), '2026-11-20');
    expect(recordDailyPlay(state, '20-11-2026')).toBe(state);
    expect(recordDailyPlay(state, '2026-11-01')).toBe(state);
  });
});

describe('parseProgress', () => {
  it('falls back to defaults for anything that is not an object', () => {
    for (const raw of [null, 'x', 42, [1, 2], undefined]) {
      expect(parseProgress(raw).state).toEqual(defaultProgress());
    }
  });

  it('keeps known values and replaces wrong types with defaults', () => {
    const { state } = parseProgress({
      version: 1,
      sectors: [{ attempts: 'x', wins: 2, bestScore: -5, bestTimeMs: 'fast' }],
      overflow: { bestWave: 3.9, bestScore: 'many' },
      daily: { lastPlayed: 'yesterday', streak: 4 },
      tutorialSeen: 'yes',
      playerName: 'ABCDEFGHIJKLMNOPQRS',
    });
    expect(state.sectors[0]).toEqual({ attempts: 0, wins: 2, bestScore: 0, bestTimeMs: null });
    expect(state.overflow).toEqual({ bestWave: 3, bestScore: 0 });
    expect(state.daily).toEqual({ lastPlayed: null, streak: 4 });
    expect(state.tutorialSeen).toBe(false);
    expect(state.playerName).toBe('ABCDEFGHIJKLMNOP');
  });

  it('fills missing keys from the defaults instead of failing', () => {
    const { state, writable } = parseProgress({ version: 1, sectors: [{ wins: 1 }] });
    expect(writable).toBe(true);
    expect(state.sectors).toHaveLength(3);
    expect(state.sectors[0].wins).toBe(1);
    expect(state.sectors[2]).toEqual(defaultProgress().sectors[2]);
    expect(state.overflow).toEqual(defaultProgress().overflow);
  });

  it('treats a blob without a usable version as corrupt', () => {
    expect(parseProgress({ wins: 9 }).state).toEqual(defaultProgress());
    expect(parseProgress({ version: 'one' }).state).toEqual(defaultProgress());
    expect(parseProgress({ version: 0 }).state).toEqual(defaultProgress());
  });

  it('reads a future version but marks it read-only so it is never downgraded', () => {
    const { state, writable } = parseProgress({
      version: 2,
      sectors: [{ attempts: 5, wins: 3, bestScore: 900, bestTimeMs: 60_000 }],
    });
    expect(writable).toBe(false);
    expect(state.sectors[0].wins).toBe(3);
  });
});

describe('ProgressStore', () => {
  it('starts from defaults when nothing is stored', () => {
    const store = ProgressStore.open({ storage: memoryStorage() });
    expect(store.state).toEqual(defaultProgress());
    expect(store.canWrite).toBe(true);
  });

  it('persists updates under the versioned key and reloads them', () => {
    const storage = memoryStorage();
    ProgressStore.open({ storage }).update(recordMission(defaultProgress(), won));
    expect(JSON.parse(storage.data.get(PROGRESS_KEY) ?? '{}').version).toBe(1);

    const reloaded = ProgressStore.open({ storage });
    expect(reloaded.state.sectors[0].wins).toBe(1);
    expect(isSectorUnlocked(reloaded.state, 1)).toBe(true);
  });

  it('recovers from corrupted JSON instead of throwing', () => {
    const store = ProgressStore.open({ storage: memoryStorage({ [PROGRESS_KEY]: '{not json' }) });
    expect(store.state).toEqual(defaultProgress());
  });

  it('survives a storage that throws on read and on write', () => {
    const store = ProgressStore.open({ storage: brokenStorage });
    expect(store.state).toEqual(defaultProgress());
    expect(() => store.update(recordOverflow(store.state, { wave: 1, score: 10 }))).not.toThrow();
    expect(store.state.overflow.bestScore).toBe(10);
  });

  it('never writes back a blob from a newer version', () => {
    const future = JSON.stringify({ version: 2, sectors: [{ wins: 7 }] });
    const storage = memoryStorage({ [PROGRESS_KEY]: future });
    const store = ProgressStore.open({ storage });
    expect(store.canWrite).toBe(false);
    store.update(recordMission(store.state, won));
    expect(storage.data.get(PROGRESS_KEY)).toBe(future);
  });

  it('seeds the tutorial flag from the legacy setting only on first load', () => {
    const fresh = ProgressStore.open({ storage: memoryStorage(), legacyTutorialSeen: true });
    expect(fresh.state.tutorialSeen).toBe(true);

    const stored = memoryStorage({ [PROGRESS_KEY]: JSON.stringify({ ...defaultProgress(), version: 1 }) });
    expect(ProgressStore.open({ storage: stored, legacyTutorialSeen: true }).state.tutorialSeen).toBe(false);
  });
});

describe('player name', () => {
  it('stores at most sixteen characters', () => {
    expect(setPlayerName(defaultProgress(), 'x'.repeat(40)).playerName).toHaveLength(16);
  });
});
