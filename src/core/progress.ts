/**
 * Progreso del jugador: unlocks, records por sector y racha diaria.
 *
 * El estado vive en localStorage (`bp.progress.v1`). Cualquier valor guardado es
 * entrada hostil: JSON roto, campos faltantes o tipos equivocados caen a los
 * valores por defecto sin romper el arranque. Un blob de una versión futura se
 * lee, pero nunca se reescribe para no degradar lo que escribió un cliente nuevo.
 */
import type { StorageLike } from './settings';
import { utcDateKey } from './daily';
import { SECTOR_IDS, type SectorId } from './sectors';

export const PROGRESS_KEY = 'bp.progress.v1';
export const PROGRESS_VERSION = 1;
const MAX_NAME_LENGTH = 16;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export interface SectorRecord {
  attempts: number;
  wins: number;
  bestScore: number;
  /** Tiempo de la victoria más rápida en ms; `null` mientras no haya victorias. */
  bestTimeMs: number | null;
}

export interface OverflowRecord {
  bestWave: number;
  bestScore: number;
}

export interface DailyRecord {
  /** Última fecha UTC jugada (`YYYY-MM-DD`) o `null`. */
  lastPlayed: string | null;
  streak: number;
}

export interface ProgressState {
  sectors: SectorRecord[];
  overflow: OverflowRecord;
  daily: DailyRecord;
  tutorialSeen: boolean;
  playerName: string;
}

export interface ProgressLoad {
  state: ProgressState;
  /** `false` cuando el blob lo escribió una versión más nueva: se lee, no se escribe. */
  writable: boolean;
}

export interface MissionOutcome {
  sector: SectorId;
  won: boolean;
  score: number;
  timeMs: number;
}

function emptySector(): SectorRecord {
  return { attempts: 0, wins: 0, bestScore: 0, bestTimeMs: null };
}

export function defaultProgress(options: { legacyTutorialSeen?: boolean } = {}): ProgressState {
  return {
    sectors: SECTOR_IDS.map(emptySector),
    overflow: { bestWave: 0, bestScore: 0 },
    daily: { lastPlayed: null, streak: 0 },
    tutorialSeen: options.legacyTutorialSeen === true,
    playerName: '',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function amount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sanitizeSector(raw: unknown, fallback: SectorRecord): SectorRecord {
  if (!isRecord(raw)) return fallback;
  const time = raw.bestTimeMs;
  const bestTimeMs = typeof time === 'number' && Number.isFinite(time) && time > 0 ? time : fallback.bestTimeMs;
  return {
    attempts: count(raw.attempts, fallback.attempts),
    wins: count(raw.wins, fallback.wins),
    bestScore: amount(raw.bestScore, fallback.bestScore),
    bestTimeMs,
  };
}

function sanitize(raw: Record<string, unknown>, fallback: ProgressState): ProgressState {
  const sectorsRaw = Array.isArray(raw.sectors) ? raw.sectors : [];
  const overflowRaw = isRecord(raw.overflow) ? raw.overflow : {};
  const dailyRaw = isRecord(raw.daily) ? raw.daily : {};
  const lastPlayed = dailyRaw.lastPlayed;
  const name = typeof raw.playerName === 'string' ? raw.playerName.slice(0, MAX_NAME_LENGTH) : fallback.playerName;

  return {
    sectors: SECTOR_IDS.map((id) => sanitizeSector(sectorsRaw[id], fallback.sectors[id])),
    overflow: {
      bestWave: count(overflowRaw.bestWave, fallback.overflow.bestWave),
      bestScore: amount(overflowRaw.bestScore, fallback.overflow.bestScore),
    },
    daily: {
      lastPlayed: typeof lastPlayed === 'string' && DATE_KEY.test(lastPlayed) ? lastPlayed : fallback.daily.lastPlayed,
      streak: count(dailyRaw.streak, fallback.daily.streak),
    },
    tutorialSeen: typeof raw.tutorialSeen === 'boolean' ? raw.tutorialSeen : fallback.tutorialSeen,
    playerName: name,
  };
}

/** Interpreta un valor ya parseado. Nunca lanza: lo irreconocible produce `fallback`. */
export function parseProgress(raw: unknown, fallback: ProgressState = defaultProgress()): ProgressLoad {
  if (!isRecord(raw)) return { state: fallback, writable: true };
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { state: fallback, writable: true };
  }
  return { state: sanitize(raw, fallback), writable: version <= PROGRESS_VERSION };
}

export function isSectorUnlocked(state: ProgressState, sector: SectorId): boolean {
  if (sector === 0) return true;
  return state.sectors[sector - 1].wins > 0;
}

export function isSectorCleared(state: ProgressState, sector: SectorId): boolean {
  return state.sectors[sector].wins > 0;
}

/** SG-08 se libera al limpiar SECTOR_02. */
export function isShotgunUnlocked(state: ProgressState): boolean {
  return isSectorCleared(state, 1);
}

export function recordMission(state: ProgressState, outcome: MissionOutcome): ProgressState {
  const current = state.sectors[outcome.sector];
  const bestTimeMs = outcome.won
    ? current.bestTimeMs === null
      ? outcome.timeMs
      : Math.min(current.bestTimeMs, outcome.timeMs)
    : current.bestTimeMs;
  const next: SectorRecord = {
    attempts: current.attempts + 1,
    wins: current.wins + (outcome.won ? 1 : 0),
    bestScore: Math.max(current.bestScore, outcome.score),
    bestTimeMs,
  };
  const sectors = state.sectors.map((record, index) => (index === outcome.sector ? next : record));
  return { ...state, sectors };
}

export function recordOverflow(state: ProgressState, run: { wave: number; score: number }): ProgressState {
  return {
    ...state,
    overflow: {
      bestWave: Math.max(state.overflow.bestWave, Math.floor(run.wave)),
      bestScore: Math.max(state.overflow.bestScore, run.score),
    },
  };
}

function previousDay(dateKey: string): string {
  return utcDateKey(new Date(Date.parse(`${dateKey}T00:00:00Z`) - DAY_MS));
}

/**
 * Racha diaria en UTC: jugar el día siguiente al último suma uno; cualquier hueco
 * la reinicia. Jugar dos veces el mismo día no cambia nada.
 */
export function recordDailyPlay(state: ProgressState, dateKey: string): ProgressState {
  if (!DATE_KEY.test(dateKey)) return state;
  const last = state.daily.lastPlayed;
  if (last !== null && last >= dateKey) return state;
  const streak = last !== null && last === previousDay(dateKey) ? state.daily.streak + 1 : 1;
  return { ...state, daily: { lastPlayed: dateKey, streak } };
}

export function markTutorialSeen(state: ProgressState): ProgressState {
  return state.tutorialSeen ? state : { ...state, tutorialSeen: true };
}

export function setPlayerName(state: ProgressState, name: string): ProgressState {
  return { ...state, playerName: name.slice(0, MAX_NAME_LENGTH) };
}

function safeStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Store con acceso a localStorage blindado: lectura y escritura pueden fallar en
 * modo privado, con datos bloqueados o con cuota agotada, y el juego sigue igual.
 */
export class ProgressStore {
  private constructor(
    private current: ProgressState,
    private readonly writable: boolean,
    private readonly storage: StorageLike | undefined,
  ) {}

  static open(
    options: { storage?: StorageLike; legacyTutorialSeen?: boolean } = {},
  ): ProgressStore {
    const storage = options.storage ?? safeStorage();
    const fallback = defaultProgress({ legacyTutorialSeen: options.legacyTutorialSeen });
    let raw: unknown;
    try {
      const blob = storage?.getItem(PROGRESS_KEY);
      raw = blob ? JSON.parse(blob) : undefined;
    } catch {
      raw = undefined;
    }
    const loaded = parseProgress(raw, fallback);
    return new ProgressStore(loaded.state, loaded.writable, storage);
  }

  get state(): ProgressState {
    return this.current;
  }

  get canWrite(): boolean {
    return this.writable;
  }

  /** Reemplaza el estado y lo persiste si esta versión puede escribir el blob. */
  update(next: ProgressState): ProgressState {
    this.current = next;
    if (this.writable && this.storage) {
      try {
        this.storage.setItem(PROGRESS_KEY, JSON.stringify({ ...next, version: PROGRESS_VERSION }));
      } catch {
        // Sin cuota o en modo privado el progreso sigue vigente solo en esta sesión.
      }
    }
    return next;
  }
}
