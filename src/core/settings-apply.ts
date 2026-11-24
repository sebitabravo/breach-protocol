/**
 * Aplicación de ajustes al runtime (extraída de game.ts en P5): un solo lugar
 * que traduce un objeto `Settings` a sus efectos — DOM, audio, input, calidad,
 * overrides de gráficos y persistencia. game.ts decide cuándo aplicar; este
 * módulo aplica. Idempotente: puede correr ante cada cambio y ante cada
 * detección de dispositivo.
 */
import type { AudioManager } from '../audio/audio';
import type { InputManager } from '../input/input';
import type { Renderer } from '../render/renderer';
import type { Hud } from '../ui/hud';
import type { ObjectiveMarker } from '../ui/objective-marker';
import { gfxOverridesOf, saveSettings, type Quality, type Settings } from './settings';
import type { QualityController } from './quality';

/** Superficies sobre las que un `Settings` tiene efecto; game.ts las provee. */
export interface SettingsApplyContext {
  app: HTMLElement;
  motionPreference: MediaQueryList;
  hooks: { reducedMotion: boolean };
  audio: AudioManager;
  input: InputManager | null;
  quality: QualityController;
  renderer: Renderer | null;
  hud: Hud | null;
  objectiveMarker: ObjectiveMarker | null;
  /** Tope de DPR vigente, ya calculado por el dueño del input (`dprCap`). */
  dprCap: number;
}

export function applySettings(ctx: SettingsApplyContext, settings: Settings): void {
  document.documentElement.style.setProperty('--hud-scale', String(settings.hudScale));
  document.documentElement.dataset.theme = 'dark';
  ctx.app.dataset.hand = settings.handedness;
  if (ctx.input?.usingTouch) ctx.app.classList.add('is-touch');
  ctx.objectiveMarker?.invalidate();
  applyMotionPreference(ctx, settings);
  ctx.audio.setEnabled(settings.audioEnabled);
  ctx.audio.setVolume(settings.volume);
  ctx.audio.setChannelVolumes(settings.sfxVolume, settings.uiVolume);
  ctx.input?.updateSettings(settings);

  if (ctx.renderer) {
    ctx.quality.setManual(settings.quality as Quality);
    ctx.renderer.setGfx(gfxOverridesOf(settings));
    ctx.renderer.setQuality(ctx.quality.preset, ctx.dprCap);
    ctx.renderer.resize();
  }
  saveSettings(settings);
}

export function applyMotionPreference(ctx: SettingsApplyContext, settings: Settings): void {
  ctx.hooks.reducedMotion = settings.reduceMotion || ctx.motionPreference.matches;
  ctx.app.dataset.motion = ctx.hooks.reducedMotion ? 'reduce' : 'full';
  ctx.hud?.setReduceFlashes(settings.reduceFlashes || ctx.hooks.reducedMotion);
}
