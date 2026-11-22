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

/** Estados por efecto: `auto` deriva del preset; on/off lo fuerzan. */
export type GfxOverride = 'auto' | 'on' | 'off';

export const GFX_KEYS = ['gfxBloom', 'gfxShadows', 'gfxEnvironment', 'gfxLights', 'gfxMist'] as const;
export type GfxKey = (typeof GFX_KEYS)[number];
export type GfxOverrides = Record<GfxKey, GfxOverride>;

/** Los cinco overrides de un Settings, listos para `renderer.setGfx`. */
export function gfxOverridesOf(settings: Settings): GfxOverrides {
  return {
    gfxBloom: settings.gfxBloom,
    gfxShadows: settings.gfxShadows,
    gfxEnvironment: settings.gfxEnvironment,
    gfxLights: settings.gfxLights,
    gfxMist: settings.gfxMist,
  };
}

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
  /** Overrides gráficos por efecto (T5a). Cada uno: auto sigue al preset, on/off lo fuerza. */
  gfxBloom: GfxOverride;
  gfxShadows: GfxOverride;
  gfxEnvironment: GfxOverride;
  gfxLights: GfxOverride;
  gfxMist: GfxOverride;
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
  gfxBloom: 'auto',
  gfxShadows: 'auto',
  gfxEnvironment: 'auto',
  gfxLights: 'auto',
  gfxMist: 'auto',
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
    // Overrides aditivos (T5a): un blob viejo sin estas claves carga todo en auto,
    // y un valor inválido cae a auto en vez de romper el arranque.
    gfxBloom: oneOf<GfxOverride>(src.gfxBloom, ['auto', 'on', 'off'], DEFAULT_SETTINGS.gfxBloom),
    gfxShadows: oneOf<GfxOverride>(src.gfxShadows, ['auto', 'on', 'off'], DEFAULT_SETTINGS.gfxShadows),
    gfxEnvironment: oneOf<GfxOverride>(src.gfxEnvironment, ['auto', 'on', 'off'], DEFAULT_SETTINGS.gfxEnvironment),
    gfxLights: oneOf<GfxOverride>(src.gfxLights, ['auto', 'on', 'off'], DEFAULT_SETTINGS.gfxLights),
    gfxMist: oneOf<GfxOverride>(src.gfxMist, ['auto', 'on', 'off'], DEFAULT_SETTINGS.gfxMist),
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

// -----------------------------------------------------------------------
// T5b: nivel gráfico verificado, persistido por firma de GPU (`bp.gfx.tier`).
//
// Es un registro separado de `bp.settings` con su propio byte de versión: el
// nivel que el controlador de calidad verificó para una GPU/dispersión dada.
// Un blob corrupto, parcial, de otra versión o exageradamente grande se
// descarta; nunca se repara adivinando. Solo viaja un hash de los strings de
// GPU (nada que identifique al usuario o la máquina) y con tope de longitud.
// -----------------------------------------------------------------------

/** Clave de localStorage del registro de nivel verificado. Namespaced: nunca toca `bp.settings`. */
export const GFX_TIER_KEY = 'bp.gfx.tier';

/** Byte de versión del formato del registro. */
export const GFX_TIER_VERSION = 1;

/** Niveles verificables por el controlador de calidad (nunca `auto`). */
export type VerifiedTier = 'low' | 'medium' | 'high';

const VERIFIED_TIERS: readonly VerifiedTier[] = ['low', 'medium', 'high'];

export interface GfxTierRecord {
  /** Byte de versión del formato. */
  v: number;
  /** Hash de backend + strings de GPU + discriminador DPR/viewport. */
  sig: string;
  tier: VerifiedTier;
  /** Marca temporal (ms) de la última verificación; nunca se interpreta como edad. */
  verified: number;
}

/** Tope del string hash almacenado (el formato propio produce 16 hex). */
const MAX_SIG_CHARS = 64;

function isVerifiedTier(value: unknown): value is VerifiedTier {
  return typeof value === 'string' && (VERIFIED_TIERS as readonly string[]).includes(value);
}

function isGfxSignature(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_SIG_CHARS
    && /^[0-9a-f]+$/.test(value);
}

/**
 * Migrationes de versión conocidas del registro. Solo formatos anteriores cuyo
 * esquema completo se puede revalidar campo a campo; cualquier otra versión se
 * descarta (no se adivina). v0 compartía el esquema de v1: solo cambia el byte.
 */
const GFX_TIER_MIGRATIONS: Record<number, (record: Record<string, unknown>) => Record<string, unknown>> = {
  // Formato vigente: se revalida campo a campo problemas de corrupción o mano.
  1: (record) => record,
  // v0 compartía el esquema de v1: solo cambia el byte.
  0: (record) => ({ ...record, v: GFX_TIER_VERSION }),
};

/** Hash determinista de las partes de la firma (FNV-1a doble, 16 hex). Sin digerir los strings crudos. */
export function hashGpuSignature(parts: readonly string[]): string {
  const text = parts.join('\u001f');
  let h1 = 0x811c9dc5;
  let h2 = 0x1b873593;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Lee el nivel verificado de storage. `expectedSig`, si viene, invalida el registro:
 * una firma distinta devuelve `null` aunque el blob sea válido. Cualquier blob
 * hostil (corrupto, parcial, versión desconocida, exagerado) también devuelve
 * `null` y se deja de lado: el siguiente arranque válido lo sobreescribe.
 */
export function loadGfxTierRecord(
  storage: StorageLike | undefined,
  expectedSig?: string,
): VerifiedTier | null {
  if (!storage) return null;
  try {
    const blob = storage.getItem(GFX_TIER_KEY);
    if (!blob || blob.length > 200) return null;
    const raw: unknown = JSON.parse(blob);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const src = raw as Record<string, unknown>;
    const migrate = typeof src.v === 'number' ? GFX_TIER_MIGRATIONS[src.v] : undefined;
    if (!migrate) return null; // versión string (mano) o desconocida: descartar
    const migrated = migrate(src);
    if (migrated.v !== GFX_TIER_VERSION) return null;
    if (!isGfxSignature(migrated.sig)) return null;
    if (!isVerifiedTier(migrated.tier)) return null;
    if (typeof migrated.verified !== 'number' || !Number.isFinite(migrated.verified) || migrated.verified < 0) return null;
    if (expectedSig !== undefined && migrated.sig !== expectedSig) return null;
    return migrated.tier;
  } catch {
    return null;
  }
}

/** Persiste el nivel verificado bajo la firma actual. Silencioso ante quota/modo privado. */
export function saveGfxTierRecord(
  tier: VerifiedTier,
  sig: string,
  storage: StorageLike | undefined = safeStorage(),
): boolean {
  if (!storage || !isVerifiedTier(tier) || !isGfxSignature(sig)) return false;
  try {
    const record: GfxTierRecord = { v: GFX_TIER_VERSION, sig, tier, verified: Date.now() };
    storage.setItem(GFX_TIER_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
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
