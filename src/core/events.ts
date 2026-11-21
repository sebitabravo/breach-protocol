/**
 * Traduce eventos de la simulación a sonidos y líneas de feed. Función pura: no
 * toca audio ni DOM, así el mapeo se testea sin navegador.
 */
import type { SoundName } from '../audio/audio';
import type { WorldEvent } from '../wasm/bridge';
import { ENEMY_KIND, EVT, WAVE_START_REASON, WEAPON } from '../wasm/protocol';

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

const SHOT_SOUND: Partial<Record<number, SoundName>> = {
  [WEAPON.sidearm]: 'shotSidearm',
  [WEAPON.carbine]: 'shotCarbine',
  [WEAPON.shotgun]: 'shotShotgun',
};

function line(text: string, kind: FeedKind = 'plain'): FeedLine {
  return { text, kind };
}

export function effectsOf(event: WorldEvent): EventEffects {
  switch (event.type) {
    case EVT.shot:
      return { sounds: [SHOT_SOUND[event.a] ?? 'shotSidearm'], feed: [] };
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
    case EVT.waveStart: {
      const wave = `oleada ${Math.round(event.a)}`;
      if (event.b === WAVE_START_REASON.accelerated || event.b === WAVE_START_REASON.surge) {
        const suffix = event.b === WAVE_START_REASON.surge ? 'refuerzos' : 'acelerada';
        return { sounds: ['wave', 'windup'], feed: [line(`${wave} · ${suffix}`, 'danger')] };
      }
      return { sounds: ['wave'], feed: [line(wave)] };
    }
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
