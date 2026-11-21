/**
 * Robots humanoides articulados con "skinning" rígido: cada vértice pertenece a una pieza (`aPart`) y cada
 * pieza tiene una matriz por instancia. Las piezas son cajas en el espacio local de su articulación, así que
 * una pose es solo una rotación por articulación. Sin huesos ni SkinnedMesh: un draw por tipo de robot.
 *
 * Convenciones: el robot mira a +Z, Y arriba, origen en los pies. Rotar una pierna con X negativo la lleva
 * hacia delante; inclinar el torso con X positivo lo lleva hacia delante.
 */
import * as THREE from 'three';
import { ENEMY_KIND, ENEMY_STATE } from '../wasm/protocol';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { MeshBuilder } from './geometry';

export const PART = {
  pelvis: 0,
  torso: 1,
  head: 2,
  upperArmL: 3,
  foreArmL: 4,
  upperArmR: 5,
  foreArmR: 6,
  thighL: 7,
  shinL: 8,
  thighR: 9,
  shinR: 10,
} as const;
export const PART_COUNT = 11;

/** Proporciones de un tipo. Las alturas coinciden con `core/src/enemy.rs` (scout 1.7, sentinel 1.95, interceptor 1.75). */
export interface RigSpec {
  height: number;
  hipY: number;
  hipX: number;
  thighLen: number;
  shinLen: number;
  torsoLen: number;
  shoulderX: number;
  upperArmLen: number;
  foreArmLen: number;
  /** Velocidad a la que el ciclo de caminata llega a amplitud completa (m/s). */
  fullStride: number;
  /** Metros recorridos por ciclo completo de pasos. */
  strideLength: number;
}

export const RIGS: Record<number, RigSpec> = {
  [ENEMY_KIND.scout]: {
    height: 1.7, hipY: 0.88, hipX: 0.11, thighLen: 0.42, shinLen: 0.42, torsoLen: 0.46,
    shoulderX: 0.25, upperArmLen: 0.3, foreArmLen: 0.3, fullStride: 3.5, strideLength: 1.5,
  },
  [ENEMY_KIND.sentinel]: {
    height: 1.95, hipY: 0.96, hipX: 0.15, thighLen: 0.46, shinLen: 0.46, torsoLen: 0.56,
    shoulderX: 0.36, upperArmLen: 0.34, foreArmLen: 0.32, fullStride: 2.0, strideLength: 1.3,
  },
  [ENEMY_KIND.interceptor]: {
    height: 1.75, hipY: 0.92, hipX: 0.11, thighLen: 0.45, shinLen: 0.45, torsoLen: 0.5,
    shoulderX: 0.24, upperArmLen: 0.34, foreArmLen: 0.36, fullStride: 5.5, strideLength: 1.9,
  },
};

export function rigFor(kind: number): RigSpec {
  return RIGS[kind] ?? RIGS[ENEMY_KIND.scout];
}

/** Padre de cada pieza (-1 = raíz). */
export const PARENT: readonly number[] = [-1, 0, 1, 1, 3, 1, 5, 0, 7, 0, 9];

/** Pivote de cada articulación en el espacio de su padre. */
export function pivotsFor(rig: RigSpec, out = new Float32Array(PART_COUNT * 3)): Float32Array {
  const set = (part: number, x: number, y: number, z: number) => {
    out[part * 3] = x;
    out[part * 3 + 1] = y;
    out[part * 3 + 2] = z;
  };
  set(PART.pelvis, 0, rig.hipY, 0);
  set(PART.torso, 0, 0.08, 0);
  set(PART.head, 0, rig.torsoLen + 0.02, 0.01);
  set(PART.upperArmL, -rig.shoulderX, rig.torsoLen - 0.08, 0);
  set(PART.foreArmL, 0, -rig.upperArmLen, 0);
  set(PART.upperArmR, rig.shoulderX, rig.torsoLen - 0.08, 0);
  set(PART.foreArmR, 0, -rig.upperArmLen, 0);
  set(PART.thighL, -rig.hipX, -0.02, 0);
  set(PART.shinL, 0, -rig.thighLen, 0);
  set(PART.thighR, rig.hipX, -0.02, 0);
  set(PART.shinR, 0, -rig.thighLen, 0);
  return out;
}

// ------------------------------------------------------------------ geometry

/** Paleta: acero pavonado oscuro con placas algo más claras, juntas casi negras y ojos rojos emisivos. */
export const ROBOT_COLORS = {
  armor: 0x34444f,
  plate: 0x52677a,
  joint: 0x141b22,
  steel: 0x8597a3,
  dark: 0x0d1217,
  eye: 0xff3b4a,
} as const;

interface Box {
  part: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
  /** Emisivo (ojos, núcleo): lo consume el material con el atributo `aBlink`. */
  glow?: boolean;
  /** Radio de chaflán (m): las placas grandes reciben un bisel para que el reflejo dibuje los cantos. */
  round?: number;
}

/** Piezas comunes a los tres tipos: piernas con rodillera y pie, brazos con codo y mano. */
function limbs(rig: RigSpec, heavy: number): Box[] {
  const boxes: Box[] = [];
  const t = rig.thighLen;
  const s = rig.shinLen;
  const legW = 0.13 + 0.05 * heavy;
  for (const [thigh, shin] of [[PART.thighL, PART.shinL], [PART.thighR, PART.shinR]] as const) {
    boxes.push(
      { part: thigh, x: 0, y: -t * 0.5, z: 0, sx: legW, sy: t * 0.9, sz: legW + 0.02, color: ROBOT_COLORS.armor, round: 0.025 },
      { part: thigh, x: 0, y: -t * 0.45, z: 0.06, sx: legW * 0.8, sy: t * 0.5, sz: 0.04, color: ROBOT_COLORS.plate, round: 0.025 },
      { part: shin, x: 0, y: 0, z: 0.02, sx: legW * 0.9, sy: 0.1, sz: legW * 0.9, color: ROBOT_COLORS.joint }, // rodilla
      { part: shin, x: 0, y: 0.02, z: legW * 0.5 + 0.02, sx: legW * 0.7, sy: 0.12, sz: 0.04, color: ROBOT_COLORS.steel },
      { part: shin, x: 0, y: -s * 0.5, z: 0, sx: legW * 0.85, sy: s * 0.85, sz: legW, color: ROBOT_COLORS.armor, round: 0.025 },
      { part: shin, x: 0, y: -s + 0.03, z: 0.06, sx: legW + 0.03, sy: 0.07, sz: legW + 0.16, color: ROBOT_COLORS.joint }, // pie
    );
  }
  const u = rig.upperArmLen;
  const f = rig.foreArmLen;
  const armW = 0.09 + 0.04 * heavy;
  for (const [upper, fore] of [[PART.upperArmL, PART.foreArmL], [PART.upperArmR, PART.foreArmR]] as const) {
    boxes.push(
      { part: upper, x: 0, y: -0.02, z: 0, sx: armW + 0.06, sy: 0.1, sz: armW + 0.06, color: ROBOT_COLORS.plate, round: 0.025 }, // hombro
      { part: upper, x: 0, y: -u * 0.5, z: 0, sx: armW, sy: u * 0.85, sz: armW, color: ROBOT_COLORS.armor, round: 0.025 },
      { part: fore, x: 0, y: 0, z: 0, sx: armW * 0.9, sy: 0.07, sz: armW * 0.9, color: ROBOT_COLORS.joint }, // codo
      { part: fore, x: 0, y: -f * 0.5, z: 0, sx: armW * 0.95, sy: f * 0.8, sz: armW * 1.05, color: ROBOT_COLORS.armor, round: 0.025 },
      { part: fore, x: 0, y: -f + 0.02, z: 0.01, sx: armW * 1.1, sy: 0.08, sz: armW * 1.2, color: ROBOT_COLORS.joint }, // mano
    );
  }
  return boxes;
}

function scoutBoxes(rig: RigSpec): Box[] {
  const T = rig.torsoLen;
  return [
    ...limbs(rig, 0),
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.32, sy: 0.14, sz: 0.2, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: 0.12, z: 0, sx: 0.2, sy: 0.2, sz: 0.16, color: ROBOT_COLORS.joint }, // columna
    { part: PART.torso, x: 0, y: T * 0.62, z: 0.01, sx: 0.4, sy: T * 0.5, sz: 0.26, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.66, z: 0.14, sx: 0.3, sy: T * 0.36, sz: 0.04, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.62, z: 0.165, sx: 0.07, sy: 0.07, sz: 0.02, color: ROBOT_COLORS.eye, glow: true }, // núcleo
    { part: PART.torso, x: 0, y: T * 0.6, z: -0.17, sx: 0.26, sy: T * 0.4, sz: 0.1, color: ROBOT_COLORS.joint }, // mochila
    { part: PART.head, x: 0, y: 0.04, z: 0, sx: 0.08, sy: 0.08, sz: 0.08, color: ROBOT_COLORS.joint }, // cuello
    { part: PART.head, x: 0, y: 0.15, z: 0.02, sx: 0.2, sy: 0.17, sz: 0.24, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.head, x: 0, y: 0.16, z: 0.145, sx: 0.17, sy: 0.05, sz: 0.02, color: ROBOT_COLORS.dark },
    { part: PART.head, x: 0, y: 0.16, z: 0.155, sx: 0.14, sy: 0.025, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    { part: PART.head, x: 0.07, y: 0.28, z: -0.04, sx: 0.015, sy: 0.1, sz: 0.015, color: ROBOT_COLORS.steel }, // antena
  ];
}

function sentinelBoxes(rig: RigSpec): Box[] {
  const T = rig.torsoLen;
  const f = rig.foreArmLen;
  return [
    ...limbs(rig, 1),
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.42, sy: 0.18, sz: 0.28, color: ROBOT_COLORS.joint },
    { part: PART.pelvis, x: 0, y: -0.04, z: 0.15, sx: 0.24, sy: 0.16, sz: 0.04, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0, y: 0.12, z: 0, sx: 0.26, sy: 0.2, sz: 0.2, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: T * 0.6, z: 0, sx: 0.58, sy: T * 0.62, sz: 0.36, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.66, z: 0.19, sx: 0.44, sy: T * 0.4, sz: 0.04, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.64, z: 0.215, sx: 0.1, sy: 0.1, sz: 0.02, color: ROBOT_COLORS.eye, glow: true },
    { part: PART.torso, x: -0.36, y: T - 0.04, z: 0, sx: 0.2, sy: 0.14, sz: 0.34, color: ROBOT_COLORS.plate, round: 0.025 }, // hombreras
    { part: PART.torso, x: 0.36, y: T - 0.04, z: 0, sx: 0.2, sy: 0.14, sz: 0.34, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.55, z: -0.24, sx: 0.36, sy: T * 0.5, sz: 0.14, color: ROBOT_COLORS.joint }, // reactor
    { part: PART.torso, x: 0, y: T * 0.55, z: -0.315, sx: 0.12, sy: T * 0.3, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    { part: PART.head, x: 0, y: 0.04, z: 0, sx: 0.1, sy: 0.08, sz: 0.1, color: ROBOT_COLORS.joint },
    { part: PART.head, x: 0, y: 0.15, z: 0.03, sx: 0.24, sy: 0.18, sz: 0.26, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.head, x: 0, y: 0.27, z: 0, sx: 0.06, sy: 0.08, sz: 0.24, color: ROBOT_COLORS.plate, round: 0.025 }, // cresta
    { part: PART.head, x: 0, y: 0.16, z: 0.165, sx: 0.2, sy: 0.06, sz: 0.02, color: ROBOT_COLORS.dark },
    { part: PART.head, x: -0.05, y: 0.16, z: 0.175, sx: 0.05, sy: 0.03, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    { part: PART.head, x: 0.05, y: 0.16, z: 0.175, sx: 0.05, sy: 0.03, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    // Rifle del brazo derecho: a lo largo del antebrazo; con el brazo al frente apunta a +Z.
    { part: PART.foreArmR, x: 0, y: -f * 0.55, z: 0.1, sx: 0.12, sy: f * 0.9, sz: 0.1, color: ROBOT_COLORS.joint },
    { part: PART.foreArmR, x: 0, y: -f - 0.18, z: 0.1, sx: 0.05, sy: 0.36, sz: 0.05, color: ROBOT_COLORS.steel }, // cañón
    { part: PART.foreArmR, x: 0, y: -f * 0.4, z: 0.16, sx: 0.04, sy: 0.12, sz: 0.02, color: ROBOT_COLORS.eye, glow: true },
  ];
}

function interceptorBoxes(rig: RigSpec): Box[] {
  const T = rig.torsoLen;
  const f = rig.foreArmLen;
  return [
    ...limbs(rig, 0),
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.3, sy: 0.12, sz: 0.2, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: 0.12, z: 0, sx: 0.16, sy: 0.22, sz: 0.14, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: T * 0.62, z: 0.03, sx: 0.36, sy: T * 0.52, sz: 0.26, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.7, z: 0.17, sx: 0.26, sy: T * 0.3, sz: 0.04, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.66, z: -0.12, sx: 0.05, sy: T * 0.7, sz: 0.14, color: ROBOT_COLORS.plate, round: 0.025 }, // aleta
    { part: PART.torso, x: 0, y: T * 0.58, z: 0.195, sx: 0.12, sy: 0.04, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    { part: PART.head, x: 0, y: 0.04, z: 0, sx: 0.07, sy: 0.08, sz: 0.07, color: ROBOT_COLORS.joint },
    { part: PART.head, x: 0, y: 0.13, z: 0.05, sx: 0.18, sy: 0.14, sz: 0.28, color: ROBOT_COLORS.armor, round: 0.025 }, // cabeza en cuña
    { part: PART.head, x: 0, y: 0.135, z: 0.195, sx: 0.15, sy: 0.03, sz: 0.01, color: ROBOT_COLORS.eye, glow: true },
    // Cuchillas: largas, salen de la mano hacia abajo; en la embestida el brazo atrás las deja apuntando adelante.
    { part: PART.foreArmL, x: 0, y: -f - 0.3, z: 0.03, sx: 0.025, sy: 0.6, sz: 0.07, color: ROBOT_COLORS.steel },
    { part: PART.foreArmR, x: 0, y: -f - 0.3, z: 0.03, sx: 0.025, sy: 0.6, sz: 0.07, color: ROBOT_COLORS.steel },
  ];
}

function boxesFor(kind: number): Box[] {
  const rig = rigFor(kind);
  if (kind === ENEMY_KIND.sentinel) return sentinelBoxes(rig);
  if (kind === ENEMY_KIND.interceptor) return interceptorBoxes(rig);
  return scoutBoxes(rig);
}

/** Geometría de un tipo: posiciones en el espacio local de cada pieza, con `aPart` y `aBlink` por vértice. */
export function buildRobotGeometry(kind: number): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const parts: number[] = [];
  const color = new THREE.Color();
  for (const box of boxesFor(kind)) {
    const before = builder.vertexCount;
    color.setHex(box.color);
    const rgb: [number, number, number] = [color.r, color.g, color.b];
    const round = Math.min(box.round ?? 0, box.sx * 0.45, box.sy * 0.45, box.sz * 0.45);
    if (round > 0.004 && !box.glow) {
      const rounded = new RoundedBoxGeometry(box.sx, box.sy, box.sz, 1, round);
      rounded.translate(box.x, box.y, box.z);
      builder.addGeometry(rounded, rgb, 0);
      rounded.dispose();
    } else {
      builder.addBox(box.x, box.y, box.z, box.sx, box.sy, box.sz, { rgb, blink: box.glow ? 1 : 0 });
    }
    for (let i = before; i < builder.vertexCount; i += 1) parts.push(box.part);
  }
  const geometry = builder.build();
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(parts, 1));
  return geometry;
}

// ------------------------------------------------------------------ poses

/** Entrada de la pose: estado de la FSM, ciclo de pasos y tiempos de animación. */
export interface PoseInput {
  kind: number;
  state: number;
  /** Fase del ciclo de pasos en radianes. */
  phase: number;
  /** Velocidad horizontal medida (m/s). */
  speed: number;
  /** Tiempo libre (s) para respiración y pulsos. */
  time: number;
  /** Progreso de la caída al morir, 0..1. */
  death: number;
}

/** Rotaciones locales (rad) por pieza y desplazamiento vertical de la pelvis. */
export interface PoseAngles {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  pelvisDrop: number;
}

export function newPoseAngles(): PoseAngles {
  return { x: new Float32Array(PART_COUNT), y: new Float32Array(PART_COUNT), z: new Float32Array(PART_COUNT), pelvisDrop: 0 };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => 1 - (1 - t) * (1 - t);

/** Ángulos de la pose para un estado. Función pura: no reserva memoria. */
export function poseAnglesInto(input: PoseInput, out: PoseAngles): PoseAngles {
  const rig = rigFor(input.kind);
  out.x.fill(0);
  out.y.fill(0);
  out.z.fill(0);
  out.pelvisDrop = 0;
  const walk = clamp01(input.speed / rig.fullStride);
  const s = Math.sin(input.phase);
  const c = Math.cos(input.phase);
  const swing = 0.55 * walk;

  // Base: caminata (o quieto) con brazos en contrafase y una respiración leve.
  out.x[PART.thighL] = -swing * s;
  out.x[PART.thighR] = swing * s;
  out.x[PART.shinL] = 0.9 * walk * Math.max(0, -c) + 0.06;
  out.x[PART.shinR] = 0.9 * walk * Math.max(0, c) + 0.06;
  out.x[PART.upperArmL] = 0.45 * walk * s + 0.05;
  out.x[PART.upperArmR] = -0.45 * walk * s + 0.05;
  out.x[PART.foreArmL] = -0.35;
  out.x[PART.foreArmR] = -0.35;
  out.z[PART.upperArmL] = -0.08;
  out.z[PART.upperArmR] = 0.08;
  out.x[PART.torso] = 0.1 * walk + 0.02 * Math.sin(input.time * 2.1);
  out.y[PART.torso] = 0.08 * walk * s;
  out.pelvisDrop = 0.035 * walk * Math.abs(c);

  const kind = input.kind;
  switch (input.state) {
    case ENEMY_STATE.aim:
      if (kind === ENEMY_KIND.sentinel) {
        // Rifle al frente a la altura del hombro; el brazo izquierdo sostiene.
        out.x[PART.upperArmR] = -Math.PI / 2;
        out.x[PART.foreArmR] = 0;
        out.z[PART.upperArmR] = 0;
        out.x[PART.upperArmL] = -1.1;
        out.x[PART.foreArmL] = -0.6;
        out.y[PART.upperArmL] = -0.5;
        out.x[PART.torso] = 0.04;
      } else {
        // Agazapado antes del golpe.
        out.x[PART.thighL] = -0.5;
        out.x[PART.thighR] = -0.5;
        out.x[PART.shinL] = 0.9;
        out.x[PART.shinR] = 0.9;
        out.pelvisDrop = 0.12;
        out.x[PART.torso] = 0.4;
        out.x[PART.upperArmL] = 0.6;
        out.x[PART.upperArmR] = 0.6;
      }
      break;
    case ENEMY_STATE.strike:
      if (kind === ENEMY_KIND.sentinel) {
        out.x[PART.upperArmR] = -Math.PI / 2 + 0.08 * Math.sin(input.time * 40);
        out.x[PART.foreArmR] = 0;
        out.z[PART.upperArmR] = 0;
        out.x[PART.upperArmL] = -1.1;
        out.x[PART.foreArmL] = -0.6;
        out.x[PART.torso] = -0.04;
      } else {
        // Golpe: brazos al frente y torso volcado.
        out.x[PART.upperArmL] = -1.5;
        out.x[PART.upperArmR] = -1.5;
        out.x[PART.foreArmL] = -0.1;
        out.x[PART.foreArmR] = -0.1;
        out.x[PART.torso] = 0.35;
        out.x[PART.thighL] = -0.6;
        out.x[PART.shinL] = 0.5;
        out.x[PART.thighR] = 0.4;
      }
      break;
    case ENEMY_STATE.flank:
      out.x[PART.torso] += 0.3;
      break;
    case ENEMY_STATE.charge:
      // Embestida: cuerpo muy inclinado, brazos atrás con las cuchillas hacia delante.
      out.x[PART.torso] = 0.65;
      out.x[PART.upperArmL] = 1.0;
      out.x[PART.upperArmR] = 1.0;
      out.x[PART.foreArmL] = -2.2;
      out.x[PART.foreArmR] = -2.2;
      out.pelvisDrop = 0.1;
      break;
    case ENEMY_STATE.recover:
      out.x[PART.torso] = -0.12;
      break;
    default:
      break;
  }

  if (input.death > 0) {
    // Se desploma: rodillas al suelo y torso hacia delante.
    const d = ease(clamp01(input.death));
    out.pelvisDrop = Math.max(out.pelvisDrop, d * (rig.hipY - 0.2));
    out.x[PART.thighL] = -1.3 * d;
    out.x[PART.thighR] = -1.2 * d;
    out.x[PART.shinL] = 2.1 * d;
    out.x[PART.shinR] = 2.0 * d;
    out.x[PART.torso] = 1.3 * d;
    out.x[PART.head] = 0.5 * d;
    out.x[PART.upperArmL] = 0.2 * d;
    out.x[PART.upperArmR] = 0.2 * d;
    out.x[PART.foreArmL] = -0.2;
    out.x[PART.foreArmR] = -0.2;
  }
  return out;
}

/** Calcula las matrices de pieza en el espacio del modelo. Escribe `PART_COUNT * 16` floats en `out` desde `offset`. */
export class RigSolver {
  private readonly pivots: Float32Array;
  private readonly world = Array.from({ length: PART_COUNT }, () => new THREE.Matrix4());
  private readonly local = new THREE.Matrix4();
  private readonly euler = new THREE.Euler();
  private readonly angles = newPoseAngles();

  constructor(readonly kind: number) {
    this.pivots = pivotsFor(rigFor(kind));
  }

  solve(input: PoseInput, out: Float32Array, offset = 0): Float32Array {
    const angles = poseAnglesInto(input, this.angles);
    for (let part = 0; part < PART_COUNT; part += 1) {
      this.euler.set(angles.x[part], angles.y[part], angles.z[part], 'YXZ');
      this.local.makeRotationFromEuler(this.euler);
      const px = this.pivots[part * 3];
      const py = this.pivots[part * 3 + 1] - (part === PART.pelvis ? angles.pelvisDrop : 0);
      const pz = this.pivots[part * 3 + 2];
      this.local.setPosition(px, py, pz);
      const parent = PARENT[part];
      if (parent < 0) this.world[part].copy(this.local);
      else this.world[part].multiplyMatrices(this.world[parent], this.local);
      this.world[part].toArray(out, offset + part * 16);
    }
    return out;
  }

  /** Matriz del modelo de una pieza tras el último `solve`. */
  partMatrix(part: number): THREE.Matrix4 {
    return this.world[part];
  }
}
