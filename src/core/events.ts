/**
 * Traduce eventos de la simulación a sonidos y líneas de feed. Función pura: no
 * toca audio ni DOM, así el mapeo se testea sin navegador.
 */
import type { SoundName } from '../audio/audio';
import type { WorldEvent } from '../wasm/bridge';
import { ENEMY_KIND, EVT, WEAPON } from '../wasm/protocol';

export type FeedKind = 'good' | 'danger' | 'plain';

export interface FeedLine {
  text: string;
  kind: FeedKind;
}

export interface EventEffects {
  sounds: SoundName[];
  feed: FeedLine[];
}

const NO_EFFECTS: EventEffects = { sounds: [], feed: [] };

const ENEMY_LABEL: Record<number, string> = {
  [ENEMY_KIND.scout]: 'scout',
  [ENEMY_KIND.sentinel]: 'centinela',
  [ENEMY_KIND.interceptor]: 'interceptor',
};

function line(text: string, kind: FeedKind = 'plain'): FeedLine {
  return { text, kind };
}

export function effectsOf(event: WorldEvent): EventEffects {
  switch (event.type) {
    case EVT.shot:
      return { sounds: [event.a === WEAPON.carbine ? 'shotCarbine' : 'shotSidearm'], feed: [] };
    case EVT.enemyHit:
      return { sounds: ['hit'], feed: [] };
    case EVT.enemyDied:
      return {
        sounds: ['kill'],
        feed: [line(`${ENEMY_LABEL[event.d] ?? ENEMY_LABEL[ENEMY_KIND.scout]} eliminado`, 'good')],
      };
    case EVT.playerDamaged:
      return { sounds: event.a >= 1 ? ['damage'] : [], feed: [] };
    case EVT.enemyShot:
      return { sounds: ['enemyShot'], feed: [] };
    case EVT.enemyWindup:
      return { sounds: ['windup'], feed: [] };
    case EVT.nodeActivated:
      return { sounds: ['node'], feed: [line('nodo de red activado', 'good')] };
    case EVT.waveStart:
      return { sounds: ['wave'], feed: [line(`oleada ${Math.round(event.a)}`)] };
    case EVT.extraction:
      return { sounds: ['wave'], feed: [line('extracción iniciada · sobreviví', 'danger')] };
    case EVT.reloadStart:
      return { sounds: ['reload'], feed: [] };
    case EVT.emptyMag:
      return { sounds: ['empty'], feed: [] };
    case EVT.win:
      return { sounds: [], feed: [line('protocolo completado', 'good')] };
    case EVT.lose:
      return { sounds: [], feed: [line('conexión perdida', 'danger')] };
    default:
      return NO_EFFECTS;
  }
}
