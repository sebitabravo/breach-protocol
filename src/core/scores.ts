/**
 * Local scoreboard. Never trusted for prizes or rankings; it is a personal
 * record kept apart per mode and input device so comparisons stay honest.
 */
import type { StorageLike } from './settings';
import { safeStorage } from './storage';
import type { Mode } from './screens';

export const SCORES_KEY = 'bp.scores.v1';
const MAX_ENTRIES = 10;

export interface RunResult {
  score: number;
  kills: number;
  accuracy: number;
  nodes: number;
  timeLeft: number;
  damage: number;
  durationMs: number;
  mode: Mode;
  input: 'mouse' | 'touch';
  difficulty: 'operator';
  won: boolean;
  at: number;
}

export interface SaveOutcome {
  rank: number;
  isRecord: boolean;
}

function isRun(value: unknown): value is RunResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.score === 'number' &&
    Number.isFinite(v.score) &&
    typeof v.kills === 'number' &&
    typeof v.accuracy === 'number' &&
    typeof v.nodes === 'number' &&
    typeof v.mode === 'string'
  );
}

export function loadScores(storage: StorageLike | undefined = safeStorage()): RunResult[] {
  if (!storage) return [];
  try {
    const blob = storage.getItem(SCORES_KEY);
    if (!blob) return [];
    const parsed: unknown = JSON.parse(blob);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRun).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

function comparator(a: RunResult, b: RunResult): number {
  if (b.score !== a.score) return b.score - a.score;
  return b.kills - a.kills;
}

export function saveScore(
  run: RunResult,
  storage: StorageLike | undefined = safeStorage(),
): SaveOutcome {
  const all = loadScores(storage);
  const bestBefore = all.length > 0 ? all[0].score : -1;
  const ranked = [...all, run].sort(comparator).slice(0, MAX_ENTRIES);
  if (storage) {
    try {
      storage.setItem(SCORES_KEY, JSON.stringify(ranked));
    } catch {
      // Ignore quota failures: the run still counts for this session.
    }
  }
  const rank = ranked.findIndex((r) => r === run || (r.at === run.at && r.score === run.score));
  return { rank: rank < 0 ? MAX_ENTRIES : rank, isRecord: run.score > bestBefore };
}

export function bestScore(
  mode: RunResult['mode'] = 'run',
  storage: StorageLike | undefined = safeStorage(),
): number | null {
  const all = loadScores(storage).filter((r) => r.mode === mode);
  if (all.length === 0) return null;
  return all.reduce((best, r) => Math.max(best, r.score), 0);
}

/** Letter grade shown on the results screen. */
export function grade(run: Pick<RunResult, 'score' | 'won' | 'accuracy' | 'nodes'>): string {
  if (!run.won) return run.score >= 1200 ? 'C' : 'D';
  if (run.score >= 3200 && run.accuracy >= 0.45 && run.nodes >= 3) return 'S';
  if (run.score >= 2400) return 'A';
  if (run.score >= 1600) return 'B';
  return 'C';
}
