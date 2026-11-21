/**
 * Robots enemigos: un InstancedMesh por tipo con "skinning" rígido (ver robot-rig.ts). Cada instancia lee
 * de una textura de poses una matriz por pieza, así que caminan, apuntan, golpean y caen con un solo draw
 * por tipo. El snapshot solo trae posición, yaw, estado y vida: la velocidad y el ciclo de pasos se miden
 * acá, en el render, sin tocar la simulación.
 */
import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import { MAX_ENEMIES } from '../wasm/bridge';
import { E, ENEMY_BASE, ENEMY_KIND, ENEMY_STATE, ENEMY_STRIDE } from '../wasm/protocol';
import { buildRobotGeometry, PART, PART_COUNT, rigFor, RigSolver, type PoseInput } from './robot-rig';
import { Telegraph } from './telegraph';

const EYE_HEX = 0xff5b6b;
/** Telegrama de embestida: rojo intenso, no blanco, para no quemar el halo. */
const HOT_HEX = 0xff9aa3;
const PLAYER_CHEST_OFFSET = 1.1;
/** Segundos que un robot muerto sigue visible: 0.55 s de caída y el resto en el suelo. */
const DEATH_TIME = 1.1;
const DEATH_FALL = 0.55;
/** Un salto mayor entre dos frames es un slot reutilizado, no un paso. */
const TELEPORT = 2;
const FLOATS_PER_ROBOT = PART_COUNT * 16;

/** Lo que el pool necesita para dibujar el telegrama de un robot en un estado dado. */
export interface RobotLook {
  /** Inclinación hacia delante (rad). La pose articulada ya la incluye; se conserva para la lectura de estados. */
  lean: number;
  /** Escala vertical: aplastado al apuntar, estirado al golpear. Solo describe el estado. */
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

const HEAD_Y: Record<number, number> = { [ENEMY_KIND.scout]: 1.6, [ENEMY_KIND.sentinel]: 1.82, [ENEMY_KIND.interceptor]: 1.62 };
const HALO_R: Record<number, number> = { [ENEMY_KIND.scout]: 0.45, [ENEMY_KIND.sentinel]: 0.55, [ENEMY_KIND.interceptor]: 0.6 };

/**
 * Traduce la FSM del snapshot a un aspecto, escribiendo en `look` (sin allocations).
 * - scout: windup (aim) brilla; strike destella fuerte.
 * - sentinel: aim dibuja la línea de mira; strike destella.
 * - interceptor: flank tenue; charge es el telegrama brillante.
 */
export function robotLookInto(kind: number, state: number, look: RobotLook): RobotLook {
  const interceptor = kind === ENEMY_KIND.interceptor;
  look.lean = interceptor ? 0.16 : kind === ENEMY_KIND.scout ? 0.08 : 0;
  look.squash = 1;
  look.glow = 0;
  look.hex = EYE_HEX;
  look.headY = HEAD_Y[kind] ?? HEAD_Y[ENEMY_KIND.scout];
  look.haloRadius = HALO_R[kind] ?? HALO_R[ENEMY_KIND.scout];
  look.laser = false;
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

/** Versión cómoda para tests y lectura; el pool usa `robotLookInto` con un scratch. */
export function robotLook(kind: number, state: number): RobotLook {
  return robotLookInto(kind, state, newLook());
}

function newLook(): RobotLook {
  return { lean: 0, squash: 1, glow: 0, hex: EYE_HEX, headY: 0, haloRadius: 0, laser: false };
}

/** Punta del cañón del sentinel en la pose de apuntar, medida sobre el propio rig (no un número a mano). */
function sentinelMuzzleOffset(): THREE.Vector3 {
  const solver = new RigSolver(ENEMY_KIND.sentinel);
  const scratch = new Float32Array(FLOATS_PER_ROBOT);
  solver.solve({ kind: ENEMY_KIND.sentinel, state: ENEMY_STATE.aim, phase: 0, speed: 0, time: 0, death: 0 }, scratch);
  const fore = rigFor(ENEMY_KIND.sentinel).foreArmLen;
  return new THREE.Vector3(0, -fore - 0.36, 0.1).applyMatrix4(solver.partMatrix(PART.foreArmR));
}

export const SENTINEL_MUZZLE = sentinelMuzzleOffset();

/** Punta del cañón del sentinel en mundo, según su yaw (rotación Y, como en el mesh). Escribe en `out`. */
export function sentinelMuzzle(x: number, y: number, z: number, yaw: number, out = new Float64Array(3)): Float64Array {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = SENTINEL_MUZZLE;
  out[0] = x + m.x * c + m.z * s;
  out[1] = y + m.y;
  out[2] = z - m.x * s + m.z * c;
  return out;
}

const VERTEX_PRELUDE = /* glsl */ `
uniform sampler2D uPose;
attribute float aPart;
attribute float aBlink;
attribute float aFlash;
flat varying float vVisor;
varying float vFlash;
`;

const VERTEX_PART = /* glsl */ `
int bpCol = int(aPart + 0.5) * 4;
int bpRow = gl_InstanceID;
mat4 bpPart = mat4(
  texelFetch(uPose, ivec2(bpCol, bpRow), 0),
  texelFetch(uPose, ivec2(bpCol + 1, bpRow), 0),
  texelFetch(uPose, ivec2(bpCol + 2, bpRow), 0),
  texelFetch(uPose, ivec2(bpCol + 3, bpRow), 0)
);
objectNormal = mat3(bpPart) * objectNormal;
`;

/** Material PBR con la pose por pieza en el vértice, ojos emisivos (`aBlink`) y destello de impacto (`aFlash`). */
function robotMaterial(pose: THREE.DataTexture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.62 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPose = { value: pose };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PRELUDE}`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${VERTEX_PART}`)
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed = (bpPart * vec4(transformed, 1.0)).xyz;\nvVisor = aBlink;\nvFlash = aFlash;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nflat varying float vVisor;\nvarying float vFlash;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vVisor * 4.5 + vec3(1.0, 0.82, 0.7) * vFlash * 0.85;',
      );
  };
  material.customProgramCacheKey = () => 'bp-rigid-robot';
  return material;
}

interface Batch {
  kind: number;
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  pose: Float32Array;
  texture: THREE.DataTexture;
  flash: THREE.InstancedBufferAttribute;
  solver: RigSolver;
}

function buildBatch(kind: number): Batch {
  const pose = new Float32Array(MAX_ENEMIES * FLOATS_PER_ROBOT);
  const texture = new THREE.DataTexture(pose, PART_COUNT * 4, MAX_ENEMIES, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const geometry = buildRobotGeometry(kind);
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ENEMIES), 1);
  flash.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aFlash', flash);
  const mesh = new THREE.InstancedMesh(geometry, robotMaterial(texture), MAX_ENEMIES);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.count = 0;
  mesh.visible = false;
  return { kind, mesh, pose, texture, flash, solver: new RigSolver(kind) };
}

export class EnemyPool {
  private readonly batches = [ENEMY_KIND.scout, ENEMY_KIND.sentinel, ENEMY_KIND.interceptor].map(buildBatch);
  private readonly telegraph: Telegraph;
  private readonly instance = new THREE.Object3D();
  private readonly look = newLook();
  private readonly muzzle = new Float64Array(3);
  private readonly target = new Float64Array(3);
  private readonly input: PoseInput = { kind: 0, state: 0, phase: 0, speed: 0, time: 0, death: 0 };
  private readonly robotPose = new Float32Array(FLOATS_PER_ROBOT);
  // Estado de render por slot: lo que el snapshot no trae.
  private readonly seen = new Uint8Array(MAX_ENEMIES);
  private readonly lastX = new Float32Array(MAX_ENEMIES);
  private readonly lastZ = new Float32Array(MAX_ENEMIES);
  private readonly lastHp = new Float32Array(MAX_ENEMIES);
  private readonly speed = new Float32Array(MAX_ENEMIES);
  private readonly phase = new Float32Array(MAX_ENEMIES);
  private readonly flash = new Float32Array(MAX_ENEMIES);
  private readonly deathT = new Float32Array(MAX_ENEMIES);
  private readonly kindOf = new Uint8Array(MAX_ENEMIES);
  private readonly lastY = new Float32Array(MAX_ENEMIES);
  private readonly lastYaw = new Float32Array(MAX_ENEMIES);
  private lastTime = -1;

  constructor(scene: THREE.Scene) {
    this.telegraph = new Telegraph(scene);
    for (const batch of this.batches) scene.add(batch.mesh);
  }

  /** Robots visibles de un tipo en el último frame (para pruebas y telemetría). */
  visibleCount(kind: number): number {
    const batch = this.batches[kind];
    return batch && batch.mesh.visible ? batch.mesh.count : 0;
  }

  hide(): void {
    for (const batch of this.batches) batch.mesh.visible = false;
    this.telegraph.halo.visible = false;
    this.telegraph.laser.visible = false;
  }

  /** Actualiza todos los slots desde el snapshot. `time` (s) alimenta pasos, caídas y el pulso de la mira. */
  update(state: Snapshot, reducedMotion: boolean, camera: THREE.Camera, time: number): void {
    const f = state.float;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.telegraph.beginFrame();
    for (const batch of this.batches) batch.mesh.count = 0;

    for (let i = 0; i < MAX_ENEMIES; i += 1) {
      const base = ENEMY_BASE + i * ENEMY_STRIDE;
      const st = f[base + E.state];
      this.flash[i] = Math.max(0, this.flash[i] - dt * 6);

      if (st === ENEMY_STATE.dead) {
        if (!this.seen[i]) continue;
        this.deathT[i] += dt;
        if (this.deathT[i] >= DEATH_TIME) {
          this.seen[i] = 0;
          continue;
        }
        this.draw(i, this.kindOf[i], ENEMY_STATE.dead, this.lastX[i], this.lastY[i], this.lastZ[i], this.lastYaw[i],
          time, Math.min(1, this.deathT[i] / DEATH_FALL));
        continue;
      }

      const kind = f[base + E.kind] | 0;
      const x = f[base + E.x];
      const y = f[base + E.y];
      const z = f[base + E.z];
      const yaw = f[base + E.yaw];
      const hp = f[base + E.hp];
      const moved = Math.hypot(x - this.lastX[i], z - this.lastZ[i]);
      if (!this.seen[i] || moved > TELEPORT || this.kindOf[i] !== kind) {
        this.speed[i] = 0;
        this.phase[i] = 0;
        this.lastHp[i] = hp;
        this.flash[i] = 0;
      } else if (dt > 0) {
        // Velocidad suavizada: el snapshot llega a 60 Hz pero el frame puede no coincidir.
        const blend = 1 - Math.exp(-dt * 10);
        this.speed[i] += (moved / dt - this.speed[i]) * blend;
        this.phase[i] = (this.phase[i] + (dt * this.speed[i] * Math.PI * 2) / rigFor(kind).strideLength) % (Math.PI * 2);
      }
      if (hp < this.lastHp[i] - 0.01) this.flash[i] = reducedMotion ? 0.5 : 1;
      this.lastHp[i] = hp;
      this.seen[i] = 1;
      this.deathT[i] = 0;
      this.kindOf[i] = kind;
      this.lastX[i] = x;
      this.lastY[i] = y;
      this.lastZ[i] = z;
      this.lastYaw[i] = yaw;

      this.draw(i, kind, st, x, y, z, yaw, time, 0);

      const look = robotLookInto(kind, st, this.look);
      if (look.glow > 0) this.telegraph.addHalo(x, y + look.headY, z, look.haloRadius, look.hex, look.glow);
      if (look.laser) {
        sentinelMuzzle(x, y, z, yaw, this.muzzle);
        this.target[0] = state.px;
        this.target[1] = state.py + PLAYER_CHEST_OFFSET;
        this.target[2] = state.pz;
        const pulse = 0.8 + 0.2 * Math.sin(time * 12);
        this.telegraph.addLaser(this.muzzle, this.target, EYE_HEX, pulse);
      }
    }

    for (const batch of this.batches) {
      batch.mesh.visible = batch.mesh.count > 0;
      if (!batch.mesh.visible) continue;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.flash.needsUpdate = true;
      batch.texture.needsUpdate = true;
    }
    this.telegraph.endFrame(camera);
  }

  private draw(slot: number, kind: number, st: number, x: number, y: number, z: number, yaw: number, time: number, death: number): void {
    const batch = this.batches[kind] ?? this.batches[0];
    const index = batch.mesh.count++;
    this.instance.position.set(x, y, z);
    this.instance.rotation.set(0, yaw, 0);
    this.instance.updateMatrix();
    batch.mesh.setMatrixAt(index, this.instance.matrix);
    const input = this.input;
    input.kind = batch.kind;
    input.state = st;
    input.phase = this.phase[slot];
    input.speed = death > 0 ? 0 : this.speed[slot];
    // Cada robot respira desfasado para que un grupo no se mueva en bloque.
    input.time = time + slot * 0.37;
    input.death = death;
    batch.solver.solve(input, this.robotPose);
    batch.pose.set(this.robotPose, index * FLOATS_PER_ROBOT);
    (batch.flash.array as Float32Array)[index] = this.flash[slot];
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
      batch.mesh.geometry.dispose();
      batch.mesh.material.dispose();
      batch.texture.dispose();
    }
    this.telegraph.dispose();
  }
}
