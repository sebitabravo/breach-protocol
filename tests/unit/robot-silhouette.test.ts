/**
 * Contrato de silueta T6a (S15): cada clase debe leerse como máquina hostil por silueta sola,
 * a distancia de combate y con poca luz. Estas pruebas fijan el contrato estructural en los
 * datos de autoría del rig (`robotBoxesFor`) y en la geometría construida; lo que NO fijan es
 * la estética (colores y materiales viven en `ROBOT_COLORS` y el material de `enemies.ts`).
 *
 * Reglas fijadas aquí:
 * - masa de hombros > masa de caderas (hombreras sobre la banda del hombro del torso),
 * - visor angular con franja de ojo emisiva en la cabeza (proporción franja, no dos puntos
 *   tipo cara humana), y sin "ojos" cuadrados pequeños separados,
 * - núcleo pectoral o dorsal emisivo en el torso,
 * - piernas de máquina: rodilla expuesta ancha, caña con pala frontal y pie diferenciado
 *   hacia adelante,
 * - un rasgo dominante por clase: scout asimétrico con antena, sentinel ancho con cresta,
 *   interceptor estrecho con aletas dorsales y cuchillas.
 * - presupuesto: la suma de los tres tipos no supera el 10 % por encima de la geometría de
 *   robots de la línea base T1 (L5): 6.258 triángulos de autoría para los tres rigs.
 */
import { describe, expect, it } from 'vitest';
import { buildRobotGeometry, PART, ROBOT_COLORS, robotBoxesFor, rigFor } from '../../src/render/robot-rig';
import { ENEMY_KIND } from '../../src/wasm/protocol';

const KINDS = [ENEMY_KIND.scout, ENEMY_KIND.sentinel, ENEMY_KIND.interceptor];
const KIND_NAME = { [ENEMY_KIND.scout]: 'scout', [ENEMY_KIND.sentinel]: 'sentinel', [ENEMY_KIND.interceptor]: 'interceptor' } as const;

interface Box {
  part: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  glow?: boolean;
}

function boxes(kind: number): Box[] {
  return [...robotBoxesFor(kind)] as Box[];
}

function outerHalfSpan(list: Box[]): number {
  return Math.max(0, ...list.map((b) => Math.abs(b.x) + b.sx / 2));
}

/** Masa de hombro: cajas del torso en la banda alta del pecho + hombros de los brazos. */
function shoulderBand(kind: number): Box[] {
  const rig = rigFor(kind);
  return boxes(kind).filter(
    (b) =>
      (b.part === PART.torso && b.y >= rig.torsoLen - 0.3) ||
      b.part === PART.upperArmL ||
      b.part === PART.upperArmR,
  );
}

function hipMass(kind: number): Box[] {
  return boxes(kind).filter((b) => b.part === PART.pelvis);
}

describe('robot silhouette contract (T6a / S15)', () => {
  it('keeps the 11-part pose texture architecture (one InstancedMesh per class)', () => {
    for (const kind of KINDS) {
      expect(Object.keys(PART)).toHaveLength(11);
      const geo = buildRobotGeometry(kind);
      const part = geo.getAttribute('aPart');
      const seen = new Set<number>();
      for (let i = 0; i < part.count; i += 1) seen.add(part.getX(i));
      for (const p of seen) expect(p, KIND_NAME[kind]).toBeLessThan(11);
    }
  });

  it('carries more shoulder mass than hip mass on every class', () => {
    for (const kind of KINDS) {
      const shoulder = outerHalfSpan(shoulderBand(kind));
      const hip = outerHalfSpan(hipMass(kind));
      expect(shoulder, `${KIND_NAME[kind]} shoulder ${shoulder.toFixed(3)} vs hip ${hip.toFixed(3)}`).toBeGreaterThan(hip + 0.04);
    }
  });

  it('wears an angular visor eye strip on the head, with no separated eye dots', () => {
    for (const kind of KINDS) {
      const visors = boxes(kind).filter((b) => b.part === PART.head && b.glow);
      expect(visors.length, KIND_NAME[kind]).toBeGreaterThanOrEqual(1);
      for (const v of visors) {
        // Franja: ancha y baja (angular), no un punto de ojo.
        expect(v.sx, `${KIND_NAME[kind]} visor width`).toBeGreaterThanOrEqual(0.11);
        expect(v.sy, `${KIND_NAME[kind]} visor height`).toBeLessThanOrEqual(0.07);
        expect(v.sx, `${KIND_NAME[kind]} strip proportion`).toBeGreaterThan(v.sy * 2);
      }
      const dots = boxes(kind).filter((b) => b.part === PART.head && b.glow && b.sx < 0.08);
      expect(dots, `${KIND_NAME[kind]} reads as a human face`).toHaveLength(0);
    }
  });

  it('has an emissive chest or back core on every torso', () => {
    for (const kind of KINDS) {
      const cores = boxes(kind).filter((b) => b.part === PART.torso && b.glow);
      expect(cores.length, KIND_NAME[kind]).toBeGreaterThanOrEqual(1);
    }
  });

  it('builds machine legs: exposed knee, shin plate and a distinct forward foot', () => {
    for (const kind of KINDS) {
      const rig = rigFor(kind);
      const legs = boxes(kind).filter((b) => b.part === PART.shinL || b.part === PART.shinR);
      const knee = legs.filter((b) => b.sy <= 0.14 && b.sx >= 0.1 && Math.abs(b.y) <= 0.06);
      expect(knee.length, `${KIND_NAME[kind]} exposed knee`).toBeGreaterThanOrEqual(1);
      const foot = legs.filter((b) => b.sz >= 0.24 && b.z > 0.02 && b.sy <= 0.12);
      expect(foot.length, `${KIND_NAME[kind]} distinct foot`).toBeGreaterThanOrEqual(1);
      void rig;
    }
  });

  it('gives the scout an asymmetric silhouette with an antenna', () => {
    const list = boxes(ENEMY_KIND.scout);
    const antenna = list.filter((b) => b.part === PART.head && b.sy >= 0.12 && b.sx <= 0.03);
    expect(antenna.length).toBeGreaterThanOrEqual(1);
    const pauldrons = shoulderBand(ENEMY_KIND.scout).filter((b) => b.part === PART.torso);
    const left = Math.max(0, ...pauldrons.filter((b) => b.x < 0).map((b) => b.sx));
    const right = Math.max(0, ...pauldrons.filter((b) => b.x > 0).map((b) => b.sx));
    expect(Math.abs(left - right), 'asymmetric shoulder mass').toBeGreaterThan(0.03);
  });

  it('gives the sentinel a broad read: big pauldrons and a head crest', () => {
    const list = boxes(ENEMY_KIND.sentinel);
    const pauldrons = shoulderBand(ENEMY_KIND.sentinel).filter((b) => b.part === PART.torso && Math.abs(b.x) > 0.2 && b.sy >= 0.12);
    expect(pauldrons.length).toBeGreaterThanOrEqual(2);
    for (const p of pauldrons) expect(p.sx, 'pauldron mass').toBeGreaterThanOrEqual(0.17);
    const crest = list.filter((b) => b.part === PART.head && b.sz >= 0.18 && b.sy <= 0.1);
    expect(crest.length, 'head crest fin').toBeGreaterThanOrEqual(1);
  });

  it('gives the interceptor a narrow blade profile with back fins', () => {
    const list = boxes(ENEMY_KIND.interceptor);
    const rig = rigFor(ENEMY_KIND.interceptor);
    const chest = list.filter((b) => b.part === PART.torso && b.y > rig.torsoLen * 0.4 && b.z > -0.1);
    const widest = Math.max(...chest.map((b) => b.sx));
    expect(widest, 'narrow torso profile').toBeLessThanOrEqual(0.38);
    const fins = list.filter((b) => b.part === PART.torso && b.z <= -0.1 && b.sy >= 0.25);
    expect(fins.length, 'dorsal fins').toBeGreaterThanOrEqual(1);
    const blades = list.filter((b) => (b.part === PART.foreArmL || b.part === PART.foreArmR) && b.sy >= 0.45 && b.sx <= 0.06);
    expect(blades.length, 'wrist blades').toBeGreaterThanOrEqual(2);
  });

  it('keeps the authored tri budget: the three rigs stay within the T1 +10% cap', () => {
    let total = 0;
    for (const kind of KINDS) {
      const geo = buildRobotGeometry(kind);
      const tris = (geo.index?.count ?? geo.getAttribute('position').count) / 3;
      total += tris;
      expect(tris, KIND_NAME[kind]).toBeLessThan(2600);
    }
    // Cap derivado de la medición real del harness T1 (L5: 47.964 tris en high, ×1.10 = 52.760;
    // los tres rigs comparten ese presupuesto con holgura para el resto de la escena).
    expect(total, 'sum of authored robot tris').toBeLessThanOrEqual(6258);
    void ROBOT_COLORS;
  });

  it('keeps red emissive vertices on the head part for the at-distance eye read', () => {
    for (const kind of KINDS) {
      const geo = buildRobotGeometry(kind);
      const blink = geo.getAttribute('aBlink');
      const color = geo.getAttribute('color');
      const part = geo.getAttribute('aPart');
      let emissiveHeadVerts = 0;
      for (let i = 0; i < blink.count; i += 1) {
        if (blink.getX(i) > 0 && part.getX(i) === PART.head && color.getX(i) > 0.9 && color.getY(i) < 0.1) emissiveHeadVerts += 1;
      }
      expect(emissiveHeadVerts, KIND_NAME[kind]).toBeGreaterThan(0);
    }
  });
});
