/**
 * Presentación de eventos de la simulación (extraída de game.ts en P5):
 * traduce cada WorldEvent a sus sonidos y a las líneas/destellos del HUD.
 * Traducción pura: no decide flujo ni muta estado del juego.
 */
import type { WorldEvent } from '../wasm/bridge';
import { EVT } from '../wasm/protocol';
import type { AudioManager } from '../audio/audio';
import type { Hud } from '../ui/hud';
import { effectsOf } from './events';

export function presentEvents(events: readonly WorldEvent[], tick: number, audio: AudioManager, hud: Hud | null): void {
  for (const event of events) {
    const effects = effectsOf(event);
    for (const sound of effects.sounds) audio.play(sound);
    for (const line of effects.feed) hud?.pushFeed(line.text, line.kind);

    if (event.type === EVT.enemyHit) hud?.flashHit(false);
    if (event.type === EVT.enemyDied) hud?.flashHit(true);
    if (event.type === EVT.playerDamaged && event.a > 0) hud?.showDamageFrom(event.b, event.d, tick);
  }
}
