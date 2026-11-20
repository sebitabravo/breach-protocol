/**
 * Pool de robots: un Mesh por slot (se reconstruye solo si cambia el tipo),
 * visibilidad desde el estado del snapshot y telegrafía por FSM. Lee los floats
 * del snapshot directamente (sin `state.enemy(i)`, que aloca un objeto por slot).
 */
import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import { MAX_ENEMIES } from '../wasm/bridge';
import { E, ENEMY_BASE, ENEMY_KIND, ENEMY_STATE, ENEMY_STRIDE } from '../wasm/protocol';
import { createRobotMesh } from './entities';
import { Telegraph } from './telegraph';

const EYE_HEX = 0xff5b6b;
/** Telegrama de embestida: rojo intenso, no blanco, para no quemar el halo. */
const HOT_HEX = 0xff9aa3;
const PLAYER_CHEST_OFFSET = 1.1;
const SENTINEL_MUZZLE = { x: 0.36, y: 1.05, z: 0.5 } as const;

/** Lo que el pool necesita para dibujar un robot en un estado dado. */
export interface RobotLook {
  /** Inclinación hacia delante (rad), aplicada en el espacio del cuerpo. */
  lean: number;
  /** Escala vertical: aplastado al apuntar, estirado al golpear. */
  squash: number;
  /** Intensidad del halo; 0 = sin telegrafía. */
  glow: number;
  hex: number;
  /** Altura del halo sobre los pies. */
  headY: number;
  haloRadius: number;
  /** Línea de mira (solo sentinel apuntando). */
  laser: boolean;
}

const HEAD_Y: Record<number, number> = { [ENEMY_KIND.scout]: 0.95, [ENEMY_KIND.sentinel]: 1.5, [ENEMY_KIND.interceptor]: 1.5 };
const HALO_R: Record<number, number> = { [ENEMY_KIND.scout]: 0.45, [ENEMY_KIND.sentinel]: 0.55, [ENEMY_KIND.interceptor]: 0.6 };

/**
 * Traduce la FSM del snapshot a un aspecto. Función pura: sin THREE, probable en node.
 * - scout: windup (aim) brilla; strike destella fuerte.
 * - sentinel: aim dibuja la línea de mira; strike destella.
 * - interceptor: flank tenue; charge es el telegrama brillante e inclina el cuerpo.
 */
export function robotLook(kind: number, state: number): RobotLook {
  const interceptor = kind === ENEMY_KIND.interceptor;
  const look: RobotLook = {
    lean: interceptor ? 0.16 : kind === ENEMY_KIND.scout ? 0.08 : 0,
    squash: 1,
    glow: 0,
    hex: EYE_HEX,
    headY: HEAD_Y[kind] ?? HEAD_Y[ENEMY_KIND.scout],
    haloRadius: HALO_R[kind] ?? HALO_R[ENEMY_KIND.scout],
    laser: false,
  };
  switch (state) {
    case ENEMY_STATE.aim:
      look.squash = 0.92;
      look.glow = kind === ENEMY_KIND.sentinel ? 0.9 : 0.6;
      look.laser = kind === ENEMY_KIND.sentinel;
      break;
    case ENEMY_STATE.strike:
      look.squash = 1.06;
      look.glow = 1.8;
      break;
    case ENEMY_STATE.flank:
      if (interceptor) look.glow = 0.3;
      break;
    case ENEMY_STATE.charge:
      if (interceptor) {
        look.lean += 0.3;
        look.glow = 2.2;
        look.hex = HOT_HEX;
      }
      break;
    default:
      break;
  }
  return look;
}

/** Punta del cañón del sentinel en mundo, según su yaw (rotación Y, como en el mesh). */
export function sentinelMuzzle(x: number, y: number, z: number, yaw: number): [number, number, number] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = SENTINEL_MUZZLE;
  return [x + m.x * c + m.z * s, y + m.y, z - m.x * s + m.z * c];
}

export class EnemyPool {
  private readonly meshes: (THREE.Mesh | null)[] = new Array(MAX_ENEMIES).fill(null);
  private readonly kinds: number[] = new Array(MAX_ENEMIES).fill(-1);
  private readonly telegraph: Telegraph;

  constructor(private readonly scene: THREE.Scene) {
    this.telegraph = new Telegraph(scene);
  }

  /** Actualiza todos los slots desde el snapshot. `time` alimenta el pulso de la mira. */
  update(state: Snapshot, reducedMotion: boolean, camera: THREE.Camera, time: number): void {
    const f = state.float;
    this.telegraph.beginFrame();
    for (let i = 0; i < MAX_ENEMIES; i += 1) {
      const base = ENEMY_BASE + i * ENEMY_STRIDE;
      const st = f[base + E.state];
      const kind = f[base + E.kind] | 0;
      const mesh = this.meshFor(i, kind);
      if (st === ENEMY_STATE.dead) {
        mesh.visible = false;
        continue;
      }
      const x = f[base + E.x];
      const y = f[base + E.y];
      const z = f[base + E.z];
      const yaw = f[base + E.yaw];
      const look = robotLook(kind, st);
      const bob = reducedMotion ? 0 : Math.sin(f[base + E.anim] * 7) * 0.03;
      mesh.visible = true;
      mesh.position.set(x, y + bob, z);
      mesh.rotation.set(look.lean, yaw, 0);
      mesh.scale.set(1, look.squash, 1);
      if (look.glow > 0) this.telegraph.addHalo(x, y + look.headY, z, look.haloRadius, look.hex, look.glow);
      if (look.laser) {
        const from = sentinelMuzzle(x, y, z, yaw);
        const pulse = 0.8 + 0.2 * Math.sin(time * 12);
        this.telegraph.addLaser(from, [state.px, state.py + PLAYER_CHEST_OFFSET, state.pz], EYE_HEX, pulse);
      }
    }
    this.telegraph.endFrame(camera);
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh?.removeFromParent();
    this.meshes.fill(null);
    this.kinds.fill(-1);
    this.telegraph.dispose();
  }

  /** Mesh del slot; se reconstruye solo si el tipo cambia. */
  private meshFor(index: number, kind: number): THREE.Mesh {
    let mesh = this.meshes[index];
    if (!mesh || this.kinds[index] !== kind) {
      mesh?.removeFromParent();
      mesh = createRobotMesh(kind);
      mesh.rotation.order = 'YXZ';
      this.kinds[index] = kind;
      this.scene.add(mesh);
      this.meshes[index] = mesh;
    }
    return mesh;
  }
}
