import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SETTINGS_VERSION,
  loadSettings,
  migrate,
  resetSettings,
  saveSettings,
  sanitize,
  type StorageLike,
} from '../../src/core/settings';

/** In-memory StorageLike; `failOnWrite` simulates quota/private-mode failures. */
function fakeStorage(initial: Record<string, string> = {}, failOnWrite = false): StorageLike & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      if (failOnWrite) throw new Error('quota exceeded');
      data.set(key, value);
    },
  };
}

describe('settings', () => {
  it('returns defaults when storage is empty', () => {
    expect(loadSettings(fakeStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults when storage is undefined', () => {
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for corrupt JSON instead of throwing', () => {
    const storage = fakeStorage({ [SETTINGS_KEY]: '{not valid json!!' });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores unknown fields', () => {
    const clean = sanitize({
      locale: 'en',
      volume: 0.5,
      somethingEvil: 'rm -rf /',
      anotherUnknown: 42,
    });
    expect(clean.locale).toBe('en');
    expect(clean.volume).toBe(0.5);
    expect(Object.keys(clean).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });

  it('clamps out-of-range numbers', () => {
    const clamped = sanitize({
      sensitivityMouse: 99,
      sensitivityTouch: -1,
      volume: 5,
      hudScale: 0.1,
    });
    expect(clamped.sensitivityMouse).toBe(3);
    expect(clamped.sensitivityTouch).toBe(0.2);
    expect(clamped.volume).toBe(1);
    expect(clamped.hudScale).toBe(0.8);
  });

  it('coerces non-boolean booleans to the field default', () => {
    const weird = sanitize({ invertY: 'yes', audioEnabled: 0, autoReload: null });
    expect(weird.invertY).toBe(false);
    expect(weird.audioEnabled).toBe(true);
    expect(weird.autoReload).toBe(true);
  });

  it('rejects unknown enum values with the default', () => {
    const weird = sanitize({ locale: 'fr', quality: 'ultra', handedness: 'center' });
    expect(weird.locale).toBe(DEFAULT_SETTINGS.locale);
    expect(weird.quality).toBe(DEFAULT_SETTINGS.quality);
    expect(weird.handedness).toBe(DEFAULT_SETTINGS.handedness);
  });

  it('accepts valid stored values', () => {
    const clean = sanitize({ locale: 'en', quality: 'high', invertY: true });
    expect(clean.locale).toBe('en');
    expect(clean.quality).toBe('high');
    expect(clean.invertY).toBe(true);
  });

  it('migrates a v1 payload keeping known values and defaulting the new ones', () => {
    const migrated = migrate({
      version: 1,
      locale: 'en',
      sensitivityMouse: 1.5,
      invertY: true,
      audioEnabled: false,
    });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.locale).toBe('en');
    expect(migrated.sensitivityMouse).toBe(1.5);
    expect(migrated.invertY).toBe(true);
    expect(migrated.audioEnabled).toBe(false);
    // Fields that did not exist in v1 inherit defaults.
    expect(migrated.sensitivityTouch).toBe(DEFAULT_SETTINGS.sensitivityTouch);
    expect(migrated.handedness).toBe(DEFAULT_SETTINGS.handedness);
    expect(migrated.telemetry).toBe(DEFAULT_SETTINGS.telemetry);
  });

  it('migrates a payload with no version as v1', () => {
    const migrated = migrate({ sensitivityMouse: 2 });
    expect(migrated.version).toBe(SETTINGS_VERSION);
    expect(migrated.sensitivityMouse).toBe(2);
  });

  it('saveSettings returns true and round-trips through storage', () => {
    const storage = fakeStorage();
    const custom = { ...DEFAULT_SETTINGS, locale: 'en' as const, volume: 0.3 };
    expect(saveSettings(custom, storage)).toBe(true);
    expect(loadSettings(storage)).toEqual(custom);
  });

  it('saveSettings survives a throwing storage', () => {
    const storage = fakeStorage({}, true);
    expect(() => saveSettings(DEFAULT_SETTINGS, storage)).not.toThrow();
    expect(saveSettings(DEFAULT_SETTINGS, storage)).toBe(false);
  });

  it('saveSettings/loadSettings tolerate missing storage', () => {
    expect(saveSettings(DEFAULT_SETTINGS, undefined)).toBe(false);
    expect(() => loadSettings(undefined)).not.toThrow();
  });

  it('resetSettings returns fresh defaults', () => {
    expect(resetSettings()).toEqual(DEFAULT_SETTINGS);
    expect(resetSettings()).not.toBe(DEFAULT_SETTINGS);
  });
});
