/**
 * Geometría visual de cada sector. La colisión viene del núcleo (`MapData`);
 * acá se agregan las cajas solo-visuales (techo, luminarias, vigas, paneles).
 */
import { materialOfKind, SOLID_KIND, type MapData, type Material } from './map';

export type { Material } from './map';

export interface ArenaBox {
  /** Centre of the box, in metres. */
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  material: Material;
  /** Visual-only boxes (light strips, labels) never become colliders. */
  solid?: boolean;
  /** Draw the authored console instead of this box; the AABB stays in MapData. */
  terminal?: boolean;
}


/**
 * Ceiling-mounted lamp segments hanging just under the ceiling plane (y≈6):
 * 1.6 m lamps with a 1.9 m gap, centred on the given coordinate, running
 * parallel to `axis`. Visual-only — they never collide and never block shots.
 */
function ceilingLamps(y: number, at: number, axis: 'x' | 'z'): ArenaBox[] {
  const out: ArenaBox[] = [];
  for (let c = -14; c <= 14; c += 3.5) {
    if (axis === 'z' && Math.abs(c) === 7) continue; // no overlapping fixtures at the crossing
    out.push(
      axis === 'x'
        ? { x: c, y, z: at, sx: 1.82, sy: 0.066, sz: 0.23, material: 'glow', solid: false }
        : { x: at, y, z: c, sx: 0.23, sy: 0.066, sz: 1.82, material: 'glow', solid: false },
    );
  }
  return out;
}

/**
 * Structural ceiling beams: dark boxes crossing the roof every ~6 m so the
 * lamp strips read as mounted on real architecture. The grid runs at ±3 and
 * ±9 — deliberately BETWEEN the lamp rows (±6), which would otherwise occlude
 * the lamps and their halos when seen from below. Visual-only.
 */
function ceilingBeams(y: number): ArenaBox[] {
  const out: ArenaBox[] = [];
  for (const z of [-9, -3, 3, 9]) {
    out.push({ x: 0, y, z, sx: 36, sy: 0.35, sz: 0.6, material: 'beam', solid: false });
  }
  for (const x of [-9, -3, 3, 9]) {
    out.push({ x, y, z: 0, sx: 0.6, sy: 0.35, sz: 36, material: 'beam', solid: false });
  }
  return out;
}

/**
 * Thin lighter cap edge on top of a mass (slightly overhanging, visual-only)
 * so cover masses and the pillar read as built panels, not grey slabs.
 */
function capEdge(x: number, z: number, sx: number, sz: number, topY: number): ArenaBox {
  return { x, y: topY + 0.04, z, sx: sx + 0.08, sy: 0.08, sz: sz + 0.08, material: 'trim', solid: false };
}


function solidBox(s: MapData['solids'][number]): ArenaBox {
  return {
    x: (s.min[0] + s.max[0]) / 2,
    y: (s.min[1] + s.max[1]) / 2,
    z: (s.min[2] + s.max[2]) / 2,
    sx: s.max[0] - s.min[0],
    sy: s.max[1] - s.min[1],
    sz: s.max[2] - s.min[2],
    material: materialOfKind(s.kind),
    solid: true,
    terminal: s.kind === SOLID_KIND.plinth,
  };
}

/** Alto de los muros perimetrales del sector. */
export function wallHeight(map: MapData): number {
  return Math.max(...map.solids.filter((s) => s.kind === 0).map((s) => s.max[1]));
}

/** SECTOR_01: decoración original (techo con vigas, luminarias, guías de piso, paneles). */
function sector01Decor(h: number): ArenaBox[] {
  return [
    { x: 0, y: h, z: 0, sx: 36, sy: 0.2, sz: 36, material: 'ceiling', solid: false },
    capEdge(0, 0, 4, 4, h),
    ...ceilingLamps(5.85, -6, 'x'),
    ...ceilingLamps(5.85, 6, 'x'),
    ...ceilingLamps(5.85, -6, 'z'),
    ...ceilingLamps(5.85, 6, 'z'),
    ...ceilingBeams(5.62),

  ];
}

/** Decoración común a los demás sectores: techo, filas de luminarias y tapas de cobertura. */
function genericDecor(map: MapData, h: number): ArenaBox[] {
  const out: ArenaBox[] = [
    { x: 0, y: h, z: 0, sx: map.halfX * 2, sy: 0.2, sz: map.halfZ * 2, material: 'ceiling', solid: false },
  ];
  const rows = map.halfZ > 20 ? [-12, -4, 4, 12] : [-map.halfZ / 2, map.halfZ / 2];
  for (const z of rows) {
    for (let x = -map.halfX + 3; x <= map.halfX - 3; x += 3.5) {
      out.push({ x, y: h - 0.15, z, sx: 1.6, sy: 0.06, sz: 0.12, material: 'glow', solid: false });
    }
  }
  for (const s of map.solids) {
    if (s.kind === 3 || s.kind === 6) {
      const sol = solidBox(s);
      if (sol.sy < h - 0.1) out.push(capEdge(sol.x, sol.z, sol.sx, sol.sz, s.max[1]));
    }
  }
  return out;
}

/** Todas las cajas que dibuja el renderer para un sector: colisión del núcleo + decoración. */
export function arenaBoxes(map: MapData): ArenaBox[] {
  const h = wallHeight(map);
  const decor = map.id === 0 ? sector01Decor(h) : genericDecor(map, h);
  return [...map.solids.map(solidBox), ...decor];
}
