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
  /** Radio de chaflán (m). Solo en las placas grandes: coste 108 tris, un box plano 12. */
  round?: number;
  /** Segmentos del chaflán (2 sólo si la placa es protagonista). */
  roundSeg?: number;
}

/** Caja del rig visible para tests (`robot-silhouette.test.ts`) y depuración. */
export type RobotBox = Box;

/** Cilindro concreto (articulación expuesta) alineado con un eje: 24 tris a 6 segmentos. */
interface Cylinder {
  part: number;
  x: number;
  y: number;
  z: number;
  /** Radio. */
  r: number;
  /** Longitud del eje. */
  len: number;
  /** Eje del cilindro en el espacio de la pieza. */
  axis: 'x' | 'y' | 'z';
  color: number;
  segments?: number;
}

interface RigParts {
  boxes: Box[];
  cylinders: Cylinder[];
}

// ------------------------------------------------------------------ limbs

/**
 * Piernas y brazos de máquina, comunes a los tres tipos.
 * - rodilla y tobillo como cilindros expuestos (lectura articulada, no muñeca de goma),
 * - pala frontal en muslo y caña con corte visible entre placas,
 * - pie ancho con puntera hacia adelante (pisada pesada, no zapatilla humana),
 * - hombro y codo como cilindros expuestos bajo la hombrera.
 */
function limbs(rig: RigSpec, heavy: number): RigParts {
  const boxes: Box[] = [];
  const cylinders: Cylinder[] = [];
  const t = rig.thighLen;
  const s = rig.shinLen;
  const legW = 0.13 + 0.06 * heavy;
  const axleR = 0.042 + 0.012 * heavy;
  for (const [thigh, shin] of [[PART.thighL, PART.shinL], [PART.thighR, PART.shinR]] as const) {
    // Muslo: bloque blindado con pala frontal y actuador trasero (corte visible).
    boxes.push(
      { part: thigh, x: 0, y: -t * 0.52, z: 0, sx: legW + 0.02, sy: t * 0.88, sz: legW + 0.02, color: ROBOT_COLORS.armor, round: 0.02 },
      { part: thigh, x: 0, y: -t * 0.48, z: legW * 0.5 + 0.01, sx: legW * 0.55, sy: t * 0.52, sz: 0.04, color: ROBOT_COLORS.plate },
      { part: thigh, x: 0, y: -t * 0.55, z: -(legW * 0.5 + 0.02), sx: legW * 0.6, sy: t * 0.4, sz: 0.06, color: ROBOT_COLORS.joint },
    );
    // Eje de cadera expuesto sobre el muslo.
    cylinders.push({ part: thigh, x: 0, y: -0.01, z: 0, r: axleR, len: legW + 0.04, axis: 'x', color: ROBOT_COLORS.steel });
    // Rodilla: bloque + eje expuesto; caña con pala propia (corte entre rodilla y muslo).
    boxes.push(
      { part: shin, x: 0, y: -0.01, z: 0, sx: legW * 1.05, sy: 0.11, sz: legW * 0.95, color: ROBOT_COLORS.joint },
      { part: shin, x: 0, y: -s * 0.48, z: 0, sx: legW * 0.85, sy: s * 0.8, sz: legW, color: ROBOT_COLORS.armor, round: 0.02 },
      { part: shin, x: 0, y: -s * 0.42, z: legW * 0.5 + 0.01, sx: legW * 0.55, sy: s * 0.55, sz: 0.04, color: ROBOT_COLORS.plate },
    );
    cylinders.push({ part: shin, x: 0, y: -0.01, z: 0, r: axleR, len: legW * 1.3, axis: 'x', color: ROBOT_COLORS.steel });
    // Tobillo + pie ancho con puntera hacia adelante.
    cylinders.push({ part: shin, x: 0, y: -s + 0.07, z: 0, r: 0.028 + 0.008 * heavy, len: legW * 0.85, axis: 'x', color: ROBOT_COLORS.joint });
    boxes.push(
      { part: shin, x: 0, y: -s + 0.03, z: legW * 0.4, sx: legW + 0.04, sy: 0.075, sz: legW + 0.16, color: ROBOT_COLORS.joint },
      { part: shin, x: 0, y: -s + 0.04, z: legW * 0.4 + (legW + 0.16) * 0.5 + 0.02, sx: legW * 0.7, sy: 0.05, sz: 0.06, color: ROBOT_COLORS.steel },
    );
  }
  // Brazos: hombro y codo como ejes expuestos; el morro del hombro lo pone cada clase.
  const u = rig.upperArmLen;
  const f = rig.foreArmLen;
  const armW = 0.09 + 0.045 * heavy;
  for (const [upper, fore] of [[PART.upperArmL, PART.foreArmL], [PART.upperArmR, PART.foreArmR]] as const) {
    boxes.push(
      { part: upper, x: 0, y: -u * 0.55, z: 0, sx: armW, sy: u * 0.85, sz: armW, color: ROBOT_COLORS.armor, round: 0.018 },
      { part: fore, x: 0, y: -f * 0.55, z: 0, sx: armW * 0.95, sy: f * 0.85, sz: armW * 1.05, color: ROBOT_COLORS.armor, round: 0.018 },
      { part: fore, x: 0, y: -f * 0.55, z: armW * 0.55, sx: armW * 0.5, sy: f * 0.6, sz: 0.035, color: ROBOT_COLORS.plate },
      { part: fore, x: 0, y: -f + 0.02, z: 0.01, sx: armW * 1.1, sy: 0.09, sz: armW * 1.2, color: ROBOT_COLORS.joint }, // muñeca/soporte
    );
    cylinders.push(
      { part: upper, x: 0, y: -0.03, z: 0, r: 0.05 + 0.018 * heavy, len: armW + 0.05, axis: 'x', color: ROBOT_COLORS.steel },
      { part: fore, x: 0, y: -0.02, z: 0, r: 0.038 + 0.012 * heavy, len: armW * 1.1, axis: 'x', color: ROBOT_COLORS.steel },
    );
  }
  return { boxes, cylinders };
}

/**
 * Cabeza de sensor: casco ciego con visor angular de franja emisiva a todo lo ancho.
 * Sin boca, sin dos ojos separados: nada que se lea como cara humana.
 */
function sensorHead(rig: RigParts, opts: { w: number; h: number; d: number; visorW?: number; y?: number }): void {
  const w = opts.w;
  const h = opts.h;
  const d = opts.d;
  const y = opts.y ?? 0.14;
  const vw = opts.visorW ?? w * 0.78;
  rig.boxes.push(
    { part: PART.head, x: 0, y: y - h * 0.55, z: 0, sx: w * 0.82, sy: h * 0.42, sz: d * 0.86, color: ROBOT_COLORS.joint }, // cuello/mecánica
    { part: PART.head, x: 0, y, z: 0, sx: w, sy: h, sz: d, color: ROBOT_COLORS.armor, round: 0.018 }, // casco
    { part: PART.head, x: 0, y, z: d * 0.5 + 0.008, sx: vw, sy: h * 0.42, sz: 0.02, color: ROBOT_COLORS.dark }, // zócalo del visor
    { part: PART.head, x: 0, y, z: d * 0.5 + 0.02, sx: vw * 0.82, sy: h * 0.2, sz: 0.012, color: ROBOT_COLORS.eye, glow: true }, // franja de ojo
    { part: PART.head, x: 0, y: y - h * 0.52, z: d * 0.5 + 0.006, sx: w * 0.62, sy: h * 0.16, sz: 0.03, color: ROBOT_COLORS.plate }, // mandíbula/sensor ventral
  );
}

function scoutRig(rig: RigSpec): RigParts {
  const T = rig.torsoLen;
  const parts = limbs(rig, 0);
  parts.boxes.push(
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.24, sy: 0.13, sz: 0.18, color: ROBOT_COLORS.joint },
    { part: PART.pelvis, x: 0, y: -0.02, z: 0.11, sx: 0.16, sy: 0.12, sz: 0.05, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: 0.1, z: 0, sx: 0.14, sy: 0.16, sz: 0.12, color: ROBOT_COLORS.joint }, // columna
    { part: PART.torso, x: 0, y: T * 0.48, z: 0, sx: 0.2, sy: T * 0.22, sz: 0.2, color: ROBOT_COLORS.joint }, // cintura articulada (corte)
    // Pecho: casco grande + placa frontal separada (lectura de planchas distintas).
    { part: PART.torso, x: 0, y: T * 0.68, z: 0, sx: 0.34, sy: T * 0.5, sz: 0.24, color: ROBOT_COLORS.armor, round: 0.02 },
    { part: PART.torso, x: 0, y: T * 0.72, z: 0.14, sx: 0.26, sy: T * 0.34, sz: 0.035, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: T * 0.66, z: 0.165, sx: 0.075, sy: 0.06, sz: 0.02, color: ROBOT_COLORS.eye, glow: true }, // núcleo
    // Mochila angular + núcleo dorsal.
    { part: PART.torso, x: 0, y: T * 0.6, z: -0.16, sx: 0.24, sy: T * 0.4, sz: 0.09, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: T * 0.6, z: -0.215, sx: 0.08, sy: 0.05, sz: 0.015, color: ROBOT_COLORS.eye, glow: true },
    // Silueta dominante: hombrera izquierda masiva, derecha mínima (asimetría) + antena.
    { part: PART.torso, x: -0.28, y: T - 0.02, z: 0, sx: 0.2, sy: 0.12, sz: 0.24, color: ROBOT_COLORS.plate, round: 0.02 },
    { part: PART.torso, x: 0.26, y: T - 0.02, z: 0, sx: 0.08, sy: 0.08, sz: 0.1, color: ROBOT_COLORS.joint },
    { part: PART.head, x: 0.075, y: 0.29, z: -0.02, sx: 0.014, sy: 0.14, sz: 0.014, color: ROBOT_COLORS.steel }, // antena
    { part: PART.head, x: 0.075, y: 0.37, z: -0.02, sx: 0.04, sy: 0.02, sz: 0.04, color: ROBOT_COLORS.steel }, // tope de antena
  );
  sensorHead(parts, { w: 0.2, h: 0.16, d: 0.24, y: 0.16 });
  return parts;
}

function sentinelRig(rig: RigSpec): RigParts {
  const T = rig.torsoLen;
  const f = rig.foreArmLen;
  const parts = limbs(rig, 1);
  parts.boxes.push(
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.36, sy: 0.18, sz: 0.26, color: ROBOT_COLORS.joint },
    { part: PART.pelvis, x: -0.14, y: -0.03, z: 0, sx: 0.1, sy: 0.16, sz: 0.2, color: ROBOT_COLORS.plate }, // faldones
    { part: PART.pelvis, x: 0.14, y: -0.03, z: 0, sx: 0.1, sy: 0.16, sz: 0.2, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: 0.12, z: 0, sx: 0.24, sy: 0.2, sz: 0.2, color: ROBOT_COLORS.joint },
    // Torso masivo en dos planchas con corte de cintura.
    { part: PART.torso, x: 0, y: T * 0.66, z: 0, sx: 0.5, sy: T * 0.62, sz: 0.34, color: ROBOT_COLORS.armor, round: 0.025 },
    { part: PART.torso, x: 0, y: T * 0.7, z: 0.19, sx: 0.36, sy: T * 0.4, sz: 0.035, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: T * 0.4, z: 0.1, sx: 0.28, sy: T * 0.2, sz: 0.16, color: ROBOT_COLORS.plate }, // faja ventral
    { part: PART.torso, x: 0, y: T * 0.68, z: 0.215, sx: 0.11, sy: 0.09, sz: 0.02, color: ROBOT_COLORS.eye, glow: true }, // núcleo
    // Hombreras anchas: la masa dominante de la clase.
    { part: PART.torso, x: -0.38, y: T - 0.04, z: 0, sx: 0.22, sy: 0.16, sz: 0.34, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: 0.38, y: T - 0.04, z: 0, sx: 0.22, sy: 0.16, sz: 0.34, color: ROBOT_COLORS.plate, round: 0.025 },
    { part: PART.torso, x: -0.38, y: T - 0.13, z: 0.05, sx: 0.14, sy: 0.05, sz: 0.24, color: ROBOT_COLORS.joint }, // corte inferior
    { part: PART.torso, x: 0.38, y: T - 0.13, z: 0.05, sx: 0.14, sy: 0.05, sz: 0.24, color: ROBOT_COLORS.joint },
    // Reactor dorsal a la vista entre los hombros.
    { part: PART.torso, x: 0, y: T * 0.55, z: -0.22, sx: 0.34, sy: T * 0.5, sz: 0.12, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: T * 0.55, z: -0.29, sx: 0.13, sy: T * 0.28, sz: 0.015, color: ROBOT_COLORS.eye, glow: true },
    // Culata y miras del rifle (el cañón queda igual para SENTINEL_MUZZLE).
    { part: PART.foreArmR, x: 0, y: -f * 0.55, z: 0.1, sx: 0.12, sy: f * 0.9, sz: 0.1, color: ROBOT_COLORS.joint },
    { part: PART.foreArmR, x: 0, y: -f - 0.18, z: 0.1, sx: 0.05, sy: 0.36, sz: 0.05, color: ROBOT_COLORS.steel },
    { part: PART.foreArmR, x: 0, y: -f * 0.4, z: 0.16, sx: 0.04, sy: 0.12, sz: 0.02, color: ROBOT_COLORS.eye, glow: true },
  );
  sensorHead(parts, { w: 0.24, h: 0.18, d: 0.26, visorW: 0.2, y: 0.15 });
  // Cresta dorsal de la cabeza (lectura ancha y pesada).
  parts.boxes.push(
    { part: PART.head, x: 0, y: 0.245, z: -0.02, sx: 0.05, sy: 0.09, sz: 0.24, color: ROBOT_COLORS.plate },
  );
  return parts;
}

function interceptorRig(rig: RigSpec): RigParts {
  const T = rig.torsoLen;
  const f = rig.foreArmLen;
  const parts = limbs(rig, 0);
  parts.boxes.push(
    { part: PART.pelvis, x: 0, y: 0, z: 0, sx: 0.22, sy: 0.12, sz: 0.2, color: ROBOT_COLORS.joint },
    { part: PART.torso, x: 0, y: 0.1, z: 0, sx: 0.12, sy: 0.18, sz: 0.12, color: ROBOT_COLORS.joint },
    // Torso estrecho y profundo (cuna): lectura alta y filosa.
    { part: PART.torso, x: 0, y: T * 0.62, z: 0.02, sx: 0.3, sy: T * 0.52, sz: 0.28, color: ROBOT_COLORS.armor, round: 0.02 },
    { part: PART.torso, x: 0, y: T * 0.68, z: 0.17, sx: 0.2, sy: T * 0.3, sz: 0.04, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: T * 0.6, z: 0.195, sx: 0.09, sy: 0.045, sz: 0.02, color: ROBOT_COLORS.eye, glow: true }, // núcleo
    { part: PART.torso, x: -0.19, y: T - 0.0, z: 0.02, sx: 0.1, sy: 0.09, sz: 0.2, color: ROBOT_COLORS.plate }, // hombreras mínimas
    { part: PART.torso, x: 0.19, y: T - 0.0, z: 0.02, sx: 0.1, sy: 0.09, sz: 0.2, color: ROBOT_COLORS.plate },
    // Aletas dorsales gemelas: el rasgo reconocible a cualquier distancia.
    { part: PART.torso, x: -0.08, y: T * 0.72, z: -0.13, sx: 0.03, sy: T * 0.66, sz: 0.14, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0.08, y: T * 0.72, z: -0.13, sx: 0.03, sy: T * 0.66, sz: 0.14, color: ROBOT_COLORS.plate },
    { part: PART.torso, x: 0, y: T * 0.62, z: -0.11, sx: 0.14, sy: 0.05, sz: 0.02, color: ROBOT_COLORS.eye, glow: true }, // núcleo dorsal
    // Cuchillas largas desde la muñeca.
    { part: PART.foreArmL, x: 0, y: -f - 0.3, z: 0.03, sx: 0.025, sy: 0.6, sz: 0.07, color: ROBOT_COLORS.steel },
    { part: PART.foreArmR, x: 0, y: -f - 0.3, z: 0.03, sx: 0.025, sy: 0.6, sz: 0.07, color: ROBOT_COLORS.steel },
  );
  sensorHead(parts, { w: 0.17, h: 0.14, d: 0.3, visorW: 0.15, y: 0.14 });
  return parts;
}

const RIG_CACHE: Record<number, RigParts> = {};

function rigPartsFor(kind: number): RigParts {
  const rig = rigFor(kind);
  if (!RIG_CACHE[kind]) {
    if (kind === ENEMY_KIND.sentinel) RIG_CACHE[kind] = sentinelRig(rig);
    else if (kind === ENEMY_KIND.interceptor) RIG_CACHE[kind] = interceptorRig(rig);
    else RIG_CACHE[kind] = scoutRig(rig);
  }
  return RIG_CACHE[kind];
}

/** Cajas del rig visibles para tests (`robot-silhouette.test.ts`) y depuración. */
export function robotBoxesFor(kind: number): readonly RobotBox[] {
  return rigPartsFor(kind).boxes;
}

/** Ejes de articulación expuestos (cilindros) del rig. */
export function robotCylindersFor(kind: number): readonly Cylinder[] {
  return rigPartsFor(kind).cylinders;
}

/** Geometría de un tipo: posiciones en el espacio local de cada pieza, con `aPart` y `aBlink` por vértice. */
export function buildRobotGeometry(kind: number): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const parts: number[] = [];
  const color = new THREE.Color();
  const rgbOf = (hex: number): [number, number, number] => {
    color.setHex(hex);
    return [color.r, color.g, color.b];
  };
  // Cajas y ejes de articulación comparten el ambiente del builder: cero allocations por frame (solo boot).
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 6);
  for (const cyl of robotCylindersFor(kind)) {
    const before = builder.vertexCount;
    const g = cylinder.clone();
    g.scale(cyl.r, 1, cyl.r);
    g.scale(1, cyl.len / 2, 1);
    if (cyl.axis === 'x') g.rotateZ(Math.PI / 2);
    else if (cyl.axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(cyl.x, cyl.y, cyl.z);
    builder.addGeometry(g, rgbOf(cyl.color), 0);
    g.dispose();
    for (let i = before; i < builder.vertexCount; i += 1) parts.push(cyl.part);
  }
  for (const box of robotBoxesFor(kind)) {
    const before = builder.vertexCount;
    const rgb = rgbOf(box.color);
    const round = Math.min(box.round ?? 0, box.sx * 0.45, box.sy * 0.45, box.sz * 0.45);
    if (round > 0.004 && !box.glow) {
      const rounded = new RoundedBoxGeometry(box.sx, box.sy, box.sz, box.roundSeg ?? 1, round);
      rounded.translate(box.x, box.y, box.z);
      builder.addGeometry(rounded, rgb, 0);
      rounded.dispose();
    } else {
      builder.addBox(box.x, box.y, box.z, box.sx, box.sy, box.sz, { rgb, blink: box.glow ? 1 : 0 });
    }
    for (let i = before; i < builder.vertexCount; i += 1) parts.push(box.part);
  }
  cylinder.dispose();
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
