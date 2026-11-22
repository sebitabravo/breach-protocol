import * as THREE from 'three';
import { cargo, floorPaint, tint, wallDecal } from './architecture';
import { RAIL_BAY, RAIL_MID, RAIL_SIZE, RAIL_TOP } from './dressing';
import { FINISH, FINISH_SURFACE as S } from './finishes';
import { FACE, MeshBuilder } from './geometry';
import { mulberry32 } from './random';
import { TILE } from './surfaces';

export const BAY_X = 12.35;
const BAY_Z = -17;
const WARNING = FINISH.emissive.color;
const AMBER = 0xbe6739;
const STEEL = FINISH.steel.color;
const RUBBER = FINISH.rubber.color;
const PAINT = FINISH.paint.color;
const HAZARD = [0.008, 0.015, 0.992, 0.485] as const;
const BAY_INK = [0.008, 0.898, 0.992, 0.998] as const;

/** S16 — the gantry fence derives from the player, never from the platform next
 * to it (same derivation as the catwalk in dressing.ts). GANTRY_WALK_Y is the
 * authored work-platform top (deck plank centre 4.38, sy 0.20): the rails rise
 * RAIL_TOP (0.6 × PLAYER_HEIGHT — a person cannot fall over them) with a mid
 * rail at the conventional half and posts standing on the walk plane at the
 * derived bay. Render-only batches: the fence never enters the collision map,
 * so the raise cannot change traversal. */
export const GANTRY_WALK_Y = 4.48;

/** Pure local-space fence (the b(x, y, z, …) frame of serviceBay) so the unit
 * test can pin the derivation and serviceBay renders it 1:1 into the lit batch. */
export interface RailMember { x: number; y: number; z: number; sx: number; sy: number; sz: number }
export function gantryRailMembers(): RailMember[] {
  const postX0 = -4.02, postX1 = 2.83, front = 1.74;
  const span = postX1 - postX0;
  const bays = Math.max(1, Math.round(span / RAIL_BAY));
  const bay = span / bays;
  const members: RailMember[] = [];
  for (let i = 0; i <= bays; i += 1) {
    members.push({ x: postX0 + i * bay, y: GANTRY_WALK_Y + RAIL_TOP / 2, z: front, sx: RAIL_SIZE, sy: RAIL_TOP, sz: RAIL_SIZE });
  }
  // Guard runs sit the authored 22 mm hair under the post crowns so no faces go
  // coplanar; the return rail keeps its authored position on the right edge.
  const run = (y: number): void => {
    members.push({ x: -0.60, y, z: front, sx: 6.92, sy: RAIL_SIZE, sz: RAIL_SIZE });
    members.push({ x: 2.83, y, z: 1.18, sx: 0.063, sy: RAIL_SIZE, sz: 1.15 });
  };
  run(GANTRY_WALK_Y + RAIL_TOP - RAIL_SIZE / 2 - 0.022);
  run(GANTRY_WALK_Y + RAIL_MID - RAIL_SIZE / 2);
  return members;
}

/** One sealed pressure lock, surveyed against the north wall. Static render batches only. */
export function serviceBay(lit: MeshBuilder, emit: MeshBuilder, decals: MeshBuilder, wear: MeshBuilder): void {
  const rng = mulberry32(0x071a1);
  const b = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, finish: number = S.paint, faces?: number) =>
    lit.addBox(BAY_X + x, y, BAY_Z + z, w, h, d, { rgb: tint(color), surface: finish, uvTile: TILE.metal, faces });
  const g = (geo: THREE.BufferGeometry, x: number, y: number, z: number, color: number, finish: number = S.steel) => {
    geo.translate(BAY_X + x, y, BAY_Z + z);
    lit.addGeometry(geo, tint(color), finish);
    geo.dispose();
  };
  const cyl = (x: number, y: number, z: number, r: number, h: number, color: number, axis: 'y' | 'z' = 'y', finish = S.steel as number) => {
    const geo = new THREE.CylinderGeometry(r, r, h, 10, 1);
    if (axis === 'z') geo.rotateX(Math.PI / 2);
    g(geo, x, y, z, color, finish);
  };
  const line = (points: number[][], radius: number, color: number, finish: number = S.steel) => {
    const path = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    g(new THREE.TubeGeometry(path, points.length * 3, radius, 6), 0, 0, 0, color, finish);
  };
  const lamp = (x: number, y: number, z: number, w: number, h: number, color: number, gain: number) =>
    emit.addBox(BAY_X + x, y, BAY_Z + z, w, h, 0.045, { rgb: tint(color, gain) });
  const sign = (x: number, y: number, z: number, w: number, h: number, uv: typeof HAZARD | typeof BAY_INK, color = 0xffffff) =>
    wallDecal(decals, { axis: 'z', at: BAY_Z + z, centre: BAY_X + x, dir: 1, span: w }, w / 2, h / 2, y, uv, tint(color), 0.006);

  // Wall cassette, perimeter ribs and the four overlapping split door courses.
  b(0, 2.39, 0.22, 6.95, 4.78, 0.46, 0x253440);
  b(0, 2.42, 0.49, 6.18, 4.7, 0.22, RUBBER, S.rubber);
  for (const side of [-1, 1]) {
    const x = side * 3.05;
    b(x, 2.26, 0.80, 0.40, 4.52, 0.65, PAINT);
    b(x, 0.24, 0.92, 0.58, 0.48, 0.95, RUBBER, S.polymer);
    b(x, 2.48, 1.14, 0.11, 2.78, 0.04, AMBER);
    cyl(side * 2.68, 1.36, 1.04, 0.16, 2.0, 0x673f34, 'y', S.paint);
    cyl(side * 2.68, 2.86, 1.04, 0.078, 1.34, STEEL);
    for (const y of [0.4, 2.34, 3.5]) cyl(side * 2.68, y, 1.04, 0.202, 0.12, 0x38454c);
    for (let i = 0; i < 4; i += 1) {
      const y = 0.65 + i * 0.91, cx = side * 1.22;
      b(cx, y, 0.70 + i * 0.04, 2.34, 0.84, 0.38, i % 2 ? 0x526977 : 0x617480);
      b(cx, y - 0.31, 0.897 + i * 0.04, 2.24, 0.09, 0.08, STEEL, S.steel);
      b(cx + side * 0.83, y, 0.93 + i * 0.04, 0.47, 0.41, 0.10, 0x344452);
      for (const dx of [-1.07, 1.07]) cyl(cx + dx, y + 0.28, 0.905 + i * 0.04, 0.03, 0.038, STEEL, 'z');
    }
    b(side * 1.55, 2.22, 1.035, 1.31, 0.17, 0.035, 0x263138, S.rubber);
    sign(side * 1.55, 2.22, 1.056, 1.26, 0.14, HAZARD);
    b(side * 2.60, 4.57, 1.33, 0.44, 0.31, 0.31, 0x333b3e, S.polymer);
    lamp(side * 2.60, 4.58, 1.56, 0.26, 0.115, WARNING, 4.1);
  }
  b(0, 4.00, 0.92, 5.85, 0.49, 0.78, AMBER);
  b(0, 4.195, 1.312, 5.65, 0.11, 0.06, 0xd98244);
  lamp(-3.78, 3.32, 0.69, 0.42, 0.044, WARNING, 2.25);
  b(0, 4.01, 1.335, 3.52, 0.33, 0.075, 0x28343b, S.polymer);
  sign(0, 4.00, 1.374, 3.28, 0.285, BAY_INK, 0xdde5e6);
  lamp(0, 3.76, 1.322, 4.33, 0.04, 0xd2efff, 2.65);

  // Cantilevered work platform. The ladder and return rail break the silhouette to the left.
  b(-0.60, 4.38, 1.15, 6.95, 0.20, 1.28, 0x3b4e57);
  b(-0.60, 4.40, 1.83, 6.95, 0.15, 0.09, AMBER);
  for (let i = 0; i < 19; i += 1) b(-3.87 + i * 0.36, 4.49, 1.25, 0.043, 0.03, 1.06, STEEL, S.steel);
  for (const m of gantryRailMembers()) b(m.x, m.y, m.z, m.sx, m.sy, m.sz, AMBER);
  for (let i = 0; i < 23; i += 1) {
    b(-3.95 + rng() * 6.65, 5.264, 1.741, 0.035 + rng() * 0.16, 0.005, 0.034, STEEL, S.steel, FACE.posY);
  }
  for (const x of [-4.04, -3.48]) b(x, 2.67, 1.28, 0.074, 5.21, 0.095, AMBER);
  for (let i = 0; i < 14; i += 1) b(-3.76, 0.28 + i * 0.32, 1.28, 0.56, 0.051, 0.065, STEEL, S.steel);
  for (const y of [0.37, 1.38, 2.42, 3.42]) for (const x of [-4.04, -3.48]) b(x, y, 0.88, 0.08, 0.093, 0.81, PAINT);

  // Gauge manifold and wrapped pressure lines. White dial faces and dark needles are geometry.
  b(3.68, 1.85, 0.53, 0.99, 1.43, 0.52, PAINT);
  for (let i = 0; i < 3; i += 1) {
    const x = 3.43 + (i % 2) * 0.43, y = 2.15 - Math.floor(i / 2) * 0.47;
    cyl(x, y, 0.84, 0.19, 0.15, STEEL, 'z');
    cyl(x, y, 0.918, 0.148, 0.028, 0xb1bdb9, 'z', S.glass);
    const needle = new THREE.BoxGeometry(0.019, 0.125, 0.016).translate(0, 0.040, 0).rotateZ(-0.64 - i * 0.39);
    g(needle, x, y, 0.940, 0x452f25, S.polymer);
    for (let j = -2; j < 3; j += 1) {
      const a = j * 0.54;
      b(x + Math.sin(a) * 0.116, y + Math.cos(a) * 0.116, 0.934, 0.016, 0.018, 0.01, RUBBER, S.polymer);
    }
    line([[x, 1.35, 0.80], [x, 0.58 + i * 0.12, 0.79], [3.50 - i * 0.13, 0.39 + i * 0.08, 0.86], [2.75, 0.42 + i * 0.09, 1.04]], 0.035, i === 0 ? AMBER : RUBBER, i === 0 ? S.paint : S.rubber);
  }
  for (let i = 0; i < 3; i += 1) line([[-4.70, 4.94 + i * 0.10, 0.64], [-3.74, 4.84 + i * 0.10, 0.61],
    [-2.86, 5.58 + i * 0.075, 0.60], [1.65, 5.55 + i * 0.08, 0.48], [3.65, 5.00 + i * 0.13, 0.45]], 0.038, i === 1 ? AMBER : RUBBER, i === 1 ? S.paint : S.rubber);

  // Grounded foreground rails/stops over old tire marks and oily contact patches.
  for (const x of [-3.28, 3.28]) {
    cyl(x, 0.047, 2.15, 0.17, 0.094, STEEL);
    cyl(x, 0.46, 2.15, 0.103, 0.86, AMBER, 'y', S.paint);
    cyl(x, 0.70, 2.15, 0.110, 0.105, RUBBER, 'y', S.rubber);
    floorPaint(wear, BAY_X + x, BAY_Z + 2.15, 0.39, 0.34, 0.006, tint(0x080c0f), undefined, 3);
  }
  cargo(lit, decals, { x: BAY_X - 4.73, y: 0.39, z: BAY_Z + 1.96, sx: 0.93, sy: 0.78, sz: 0.88, solid: false, material: 'crate' }, tint(0x6a6558));
  for (const side of [-1, 1]) {
    floorPaint(wear, BAY_X + side * 2.75, BAY_Z + 1.19, 0.76, 1.01, 0.008, tint(0x0b1116), undefined, 3);
    floorPaint(decals, BAY_X + side * 1.37, BAY_Z + 2.22, 1.16, 0.19, 0.013, [0.55, 0.55, 0.55], HAZARD);
  }
  for (const z of [-12.9, -6.8, 5.3, 8.5, 11.9]) for (let i = 0; i < 6; i += 1) {
    const x = z < 0 ? BAY_X - 3 : 0;
    floorPaint(wear, x - 1.8 + rng() * 3.6, z + rng() * 1.4, 0.045 + rng() * 0.17, 0.48 + rng() * 1.5,
      0.008 + i * 0.0005, tint(i % 2 ? 0x52606a : 0x101820), undefined, 4);
  }
}

/** Three off-axis service notes carry the same finishes to the rest of Control. */
export function serviceNotes(lit: MeshBuilder, emit: MeshBuilder, wear: MeshBuilder): void {
  const b = (x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number, surface: number = S.paint, faces?: number) =>
    lit.addBox(x, y, z, sx, sy, sz, { rgb: tint(color), surface, uvTile: TILE.metal, faces });
  // Drain in the spawn approach lane, worn across the flow of foot traffic.
  floorPaint(wear, 2.65, 5.07, 1.45, 0.52, 0.009, tint(0x0b1116), undefined, 3);
  b(2.65, 0.014, 5.07, 1.91, 0.028, 0.33, STEEL, S.steel, FACE.posY);
  b(2.65, 0.018, 5.07, 1.80, 0.022, 0.24, RUBBER, S.rubber, FACE.posY);
  for (let i = 0; i < 17; i += 1) b(1.82 + i * 0.105, 0.029, 5.07, 0.042, 0.02, 0.255, i % 3 ? 0x43545f : STEEL, S.steel);
  // Chain hoist parked above the west-side cover; paired links alternate axes.
  b(-9, 5.42, 2.7, 0.66, 0.38, 0.56, AMBER);
  for (const x of [-9.14, -8.86]) for (let i = 0; i < 13; i += 1) {
    const link = new THREE.TorusGeometry(0.078, 0.018, 4, 8).scale(0.69, 1.18, 1).rotateY(i % 2 ? 1.44 : 0)
      .translate(x + Math.sin(i * 0.26) * 0.08, 5.24 - i * 0.118, 2.7);
    lit.addGeometry(link, tint(STEEL), S.steel);
    link.dispose();
  }
  // Raised west wall junctions, conduit tails and non-objective amber indicators.
  for (const z of [1.85, 3.13]) {
    b(-16.70, 2.24, z, 0.34, 0.64, 0.73, PAINT);
    b(-16.51, 2.24, z, 0.045, 0.53, 0.63, RUBBER, S.polymer);
    b(-16.48, 2.41, z + 0.10, 0.072, 0.088, 0.26, STEEL, S.steel);
    b(-16.69, 1.35, z - 0.23, 0.064, 1.34, 0.067, STEEL, S.steel);
    emit.addBox(-16.472, 2.15, z - 0.17, 0.025, 0.038, 0.14, { rgb: tint(WARNING, 2.55) });
  }
}
