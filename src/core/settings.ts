/**
 * Versioned settings with conservative defaults.
 *
 * Any stored value is treated as hostile input: an unreadable blob, a partial
 * object, or a number outside its range must never break the boot.
 */
import { safeStorage } from './storage';

export const SETTINGS_KEY = 'bp.settings';
export const SETTINGS_VERSION = 3;

export type Quality = 'auto' | 'low' | 'medium' | 'high';
export type Handedness = 'right' | 'left';
export type Locale = 'es' | 'en';

export interface Settings {
  version: number;
  locale: Locale;
  quality: Quality;
  sensitivityMouse: number;
  sensitivityTouch: number;
  invertY: boolean;
  handedness: Handedness;
  autoReload: boolean;
  aimAssistTouch: boolean;
  reduceMotion: boolean;
  /** Atenúa los destellos de daño (fotosensibilidad). Independiente de reduceMotion, que también lo activa. */
  reduceFlashes: boolean;
  audioEnabled: boolean;
  /** Volumen maestro. Los canales de efectos e interfaz multiplican sobre él. */
  volume: number;
  sfxVolume: number;
  uiVolume: number;
  hudScale: number;
  telemetry: boolean;
  tutorialSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  locale: 'es',
  quality: 'auto',
  sensitivityMouse: 1,
  sensitivityTouch: 1,
  invertY: false,
  handedness: 'right',
  autoReload: true,
  aimAssistTouch: true,
  reduceMotion: false,
  reduceFlashes: false,
  audioEnabled: true,
  volume: 0.7,
  sfxVolume: 1,
  uiVolume: 1,
  hudScale: 1,
  telemetry: false,
  tutorialSeen: false,
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Coerces anything into a valid `Settings` object. */
export function sanitize(raw: unknown): Settings {
  const src = (raw ?? {}) as Record<string, unknown>;
  return {
    version: SETTINGS_VERSION,
    locale: oneOf<Locale>(src.locale, ['es', 'en'], DEFAULT_SETTINGS.locale),
    quality: oneOf<Quality>(src.quality, ['auto', 'low', 'medium', 'high'], DEFAULT_SETTINGS.quality),
    sensitivityMouse: num(src.sensitivityMouse, DEFAULT_SETTINGS.sensitivityMouse, 0.2, 3),
    sensitivityTouch: num(src.sensitivityTouch, DEFAULT_SETTINGS.sensitivityTouch, 0.2, 3),
    invertY: bool(src.invertY, DEFAULT_SETTINGS.invertY),
    handedness: oneOf<Handedness>(src.handedness, ['right', 'left'], DEFAULT_SETTINGS.handedness),
    autoReload: bool(src.autoReload, DEFAULT_SETTINGS.autoReload),
    aimAssistTouch: bool(src.aimAssistTouch, DEFAULT_SETTINGS.aimAssistTouch),
    reduceMotion: bool(src.reduceMotion, DEFAULT_SETTINGS.reduceMotion),
    reduceFlashes: bool(src.reduceFlashes, DEFAULT_SETTINGS.reduceFlashes),
    audioEnabled: bool(src.audioEnabled, DEFAULT_SETTINGS.audioEnabled),
    volume: num(src.volume, DEFAULT_SETTINGS.volume, 0, 1),
    sfxVolume: num(src.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
    uiVolume: num(src.uiVolume, DEFAULT_SETTINGS.uiVolume, 0, 1),
    hudScale: num(src.hudScale, DEFAULT_SETTINGS.hudScale, 0.8, 1.4),
    telemetry: bool(src.telemetry, DEFAULT_SETTINGS.telemetry),
    tutorialSeen: bool(src.tutorialSeen, DEFAULT_SETTINGS.tutorialSeen),
  };
}

/**
 * Migrates a stored payload. Version 1 lacked touch sensitivity, handedness and
 * telemetry; those inherit defaults while every known value is preserved.
 */
export function migrate(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const src = raw as Record<string, unknown>;
  const version = typeof src.version === 'number' ? src.version : 1;
  if (version > SETTINGS_VERSION) {
    // A newer shell wrote this; keep what we understand instead of wiping it.
    return sanitize(src);
  }
  return sanitize(src);
}

export function loadSettings(storage: StorageLike | undefined = safeStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    const blob = storage.getItem(SETTINGS_KEY);
    if (!blob) return { ...DEFAULT_SETTINGS };
    return migrate(JSON.parse(blob));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(
  settings: Settings,
  storage: StorageLike | undefined = safeStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ ...settings, version: SETTINGS_VERSION }));
    return true;
  } catch {
    // Quota or private mode: preferences stay in memory for this session.
    return false;
  }
}

export function resetSettings(): Settings {
  return { ...DEFAULT_SETTINGS };
}
