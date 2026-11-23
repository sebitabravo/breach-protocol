/**
 * T5a: overrides por efecto (`auto | on | off`) sobre la derivación propia de
 * cada preset. `auto` debe reproducir el comportamiento previo exacto; los
 * overrides nunca tocan presupuesto de píxeles, tope de DPR ni muestras MSAA.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  GFX_KEYS,
  SETTINGS_KEY,
  loadSettings,
  sanitize,
  saveSettings,
  type GfxKey,
  type GfxOverride,
  type StorageLike,
} from '../../src/core/settings';
import {
  PLAY_PIXEL_BUDGET,
  PRESETS,
  playPixelRatio,
  resolveGfxPlan,
  type GfxPlan,
  type QualityName,
} from '../../src/render/presets';
import { postPlan } from '../../src/render/postfx';

/** La derivación previa al cambio: bloom y sombras según el preset, el resto siempre activo. */
const PRE_CHANGE: Record<QualityName, GfxPlan> = {
  low: { bloom: false, shadows: false, environment: true, lights: true, mist: true },
  medium: { bloom: true, shadows: true, environment: true, lights: true, mist: true },
  high: { bloom: true, shadows: true, environment: true, lights: true, mist: true },
};

const EFFECTS: GfxKey[] = [...GFX_KEYS];
const STATES: GfxOverride[] = ['auto', 'on', 'off'];
const NAMES: QualityName[] = ['low', 'medium', 'high'];

function effectOf(plan: GfxPlan, key: GfxKey): boolean {
  const map: Record<GfxKey, boolean> = {
    gfxBloom: plan.bloom, gfxShadows: plan.shadows, gfxEnvironment: plan.environment,
    gfxLights: plan.lights, gfxMist: plan.mist,
  };
  return map[key];
}

/** Override de un solo efecto; el resto queda en auto. */
function planWith(name: QualityName, key: GfxKey, state: GfxOverride): GfxPlan {
  const gfx = Object.fromEntries(EFFECTS.map((k) => [k, 'auto'])) as Record<GfxKey, GfxOverride>;
  gfx[key] = state;
  return resolveGfxPlan(PRESETS[name], gfx);
}

describe('resolveGfxPlan — every auto|on|off × low|medium|high', () => {
  for (const name of NAMES) {
    for (const key of EFFECTS) {
      for (const state of STATES) {
        it(`${key}=${state} at preset ${name}`, () => {
          const expected = state === 'auto' ? effectOf(PRE_CHANGE[name], key) : state === 'on';
          expect(effectOf(planWith(name, key, state), key)).toBe(expected);
        });
      }
    }
  }
});

describe('auto reproduces the pre-change derivation exactly', () => {
  it('all five at auto equals the pre-change plan for every preset', () => {
    for (const name of NAMES) {
      expect(resolveGfxPlan(PRESETS[name], {
        gfxBloom: 'auto', gfxShadows: 'auto', gfxEnvironment: 'auto', gfxLights: 'auto', gfxMist: 'auto',
      })).toEqual(PRE_CHANGE[name]);
    }
  });

  it('postPlan(name) keeps its pre-change shape by default: bloom off at low, on with 4× MSAA above', () => {
    expect(postPlan('low')).toEqual({ bloom: false, msaaSamples: 0 });
    expect(postPlan('medium')).toEqual({ bloom: true, msaaSamples: 4 });
    expect(postPlan('high')).toEqual({ bloom: true, msaaSamples: 4 });
  });
});

describe('overrides never touch preset-owned numbers', () => {
  it('MSAA sample count per preset is identical for auto, on and off', () => {
    for (const name of NAMES) {
      const samples = postPlan(name, 'auto').msaaSamples;
      for (const state of STATES) expect(postPlan(name, state).msaaSamples).toBe(samples);
    }
    expect(postPlan('low', 'auto').msaaSamples).toBe(0);
    expect(postPlan('medium', 'auto').msaaSamples).toBe(4);
    expect(postPlan('high', 'auto').msaaSamples).toBe(4);
  });

  it('pixel budgets keep their pre-change values', () => {
    expect(PLAY_PIXEL_BUDGET).toEqual({ low: 154_000, medium: 540_000, high: 3_500_000 });
  });

  it('playPixelRatio is unaffected by the gfx override inputs (same args, same ratio)', () => {
    for (const name of NAMES) {
      const a = playPixelRatio(PRESETS[name], 1600, 900, 2, 2);
      const b = playPixelRatio(PRESETS[name], 1600, 900, 2, 2);
      expect(a).toBe(b);
    }
  });
});

function fakeStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('stored settings contract for the five gfx overrides', () => {
  it('DEFAULT_SETTINGS carries all five at auto', () => {
    expect(DEFAULT_SETTINGS.gfxBloom).toBe('auto');
    expect(DEFAULT_SETTINGS.gfxShadows).toBe('auto');
    expect(DEFAULT_SETTINGS.gfxEnvironment).toBe('auto');
    expect(DEFAULT_SETTINGS.gfxLights).toBe('auto');
    expect(DEFAULT_SETTINGS.gfxMist).toBe('auto');
  });

  it('a stored payload missing all five keys loads with all five at auto', () => {
    const settings = loadSettings(fakeStorage({
      [SETTINGS_KEY]: JSON.stringify({ version: 3, quality: 'high', volume: 0.5 }),
    }));
    for (const key of EFFECTS) expect(settings[key]).toBe('auto');
    expect(settings.quality).toBe('high');
    expect(settings.volume).toBe(0.5);
  });

  it('a bogus value ("maybe") loads that key as auto without touching the rest', () => {
    const settings = sanitize({
      version: 3,
      gfxBloom: 'maybe',
      gfxShadows: 'on',
      gfxEnvironment: 'maybe',
      quality: 'medium',
    });
    expect(settings.gfxBloom).toBe('auto');
    expect(settings.gfxShadows).toBe('on');
    expect(settings.gfxEnvironment).toBe('auto');
    expect(settings.quality).toBe('medium');
  });

  it('valid on/off values survive a save/load round trip', () => {
    const storage = fakeStorage();
    const settings = sanitize({
      version: 3,
      gfxBloom: 'off', gfxShadows: 'on', gfxEnvironment: 'off', gfxLights: 'on', gfxMist: 'off',
    });
    expect(saveSettings(settings, storage)).toBe(true);
    const loaded = loadSettings(storage);
    expect(loaded.gfxBloom).toBe('off');
    expect(loaded.gfxShadows).toBe('on');
    expect(loaded.gfxEnvironment).toBe('off');
    expect(loaded.gfxLights).toBe('on');
    expect(loaded.gfxMist).toBe('off');
  });

  it('an older versioned payload (v2) gains the five keys at auto', () => {
    const settings = sanitize({ version: 2, quality: 'low' });
    for (const key of EFFECTS) expect(settings[key]).toBe('auto');
  });
});
