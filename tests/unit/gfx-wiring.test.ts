/**
 * T5a follow-up: el camino de ajustes de producción debe llegar a
 * `renderer.setGfx` sin depender de globales de diagnóstico. Se aserta sobre
 * un renderer stub inyectado en la instancia, nunca sobre `window.__BREACH__`.
 */
import { describe, expect, it, vi } from 'vitest';
import { GameApp } from '../../src/core/game';
import { DEFAULT_SETTINGS, gfxOverridesOf, sanitize, type Settings } from '../../src/core/settings';

/** Stub mínimo de DOM para `applySettings`: node no tiene document. */
function stubDom(): void {
  (globalThis as Record<string, unknown>).document = {
    documentElement: { style: { setProperty: () => {} }, dataset: {} },
  };
  (globalThis as Record<string, unknown>).window = { devicePixelRatio: 2, location: { search: '' } };
}

type Harness = {
  renderer: { setQuality: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; setGfx: ReturnType<typeof vi.fn>; preset: { name: string }; dpr: number };
  audio: { setEnabled: ReturnType<typeof vi.fn>; setVolume: ReturnType<typeof vi.fn>; setChannelVolumes: ReturnType<typeof vi.fn>; unlock: ReturnType<typeof vi.fn> };
  settingsForm: { sync: ReturnType<typeof vi.fn> };
};

/** GameApp sin constructor (side effects de DOM) pero con el path de ajustes vivo. */
function gameWith(settings: Settings): { game: unknown; harness: Harness } {
  stubDom();
  const game = Object.create(GameApp.prototype) as unknown as Record<string, any>;
  const harness: Harness = {
    renderer: { setQuality: vi.fn(), resize: vi.fn(), setGfx: vi.fn(), preset: { name: 'high' }, dpr: 1.56 },
    audio: { setEnabled: vi.fn(), setVolume: vi.fn(), setChannelVolumes: vi.fn(), unlock: vi.fn() },
    settingsForm: { sync: vi.fn() },
  };
  game.settings = settings;
  game.app = { dataset: {}, classList: { add: () => {} } };
  game.audio = harness.audio;
  game.quality = { setManual: () => {}, preset: 'high' };
  game.renderer = harness.renderer;
  game.motionPreference = { matches: false };
  game.hooks = { reducedMotion: false };
  game.settingsForm = harness.settingsForm;
  return { game, harness };
}

describe('settings patch path reaches renderer.setGfx', () => {
  it('a settings patch applies the five overrides from the form pipeline', () => {
    const { game, harness } = gameWith({ ...DEFAULT_SETTINGS });
    (game as Record<string, (patch: Partial<Settings>) => void>)['updateSettings']({
      gfxBloom: 'off', gfxShadows: 'off',
    });
    expect(harness.renderer.setGfx).toHaveBeenCalledWith({
      gfxBloom: 'off', gfxShadows: 'off', gfxEnvironment: 'auto', gfxLights: 'auto', gfxMist: 'auto',
    });
  });

  it('settings loaded from storage flow to setGfx on the boot apply path', () => {
    const stored = sanitize({ gfxEnvironment: 'off', gfxMist: 'on' });
    const { game, harness } = gameWith(stored);
    (game as Record<string, () => void>)['applySettings']();
    expect(harness.renderer.setGfx).toHaveBeenCalledWith(gfxOverridesOf(stored));
  });

  it('the pure mapping mirrors the Settings fields one to one', () => {
    const s = sanitize({ gfxBloom: 'on', gfxShadows: 'off', gfxEnvironment: 'off', gfxLights: 'on', gfxMist: 'off' });
    expect(gfxOverridesOf(s)).toEqual({ gfxBloom: 'on', gfxShadows: 'off', gfxEnvironment: 'off', gfxLights: 'on', gfxMist: 'off' });
  });
});
