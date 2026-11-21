import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ArenaBox } from '../world/layout';
import { SOLID_KIND, type MapData } from '../world/map';
import { FACE, MeshBuilder } from './geometry';
import { FINISH_SURFACE } from './finishes';
import { mulberry32 } from './random';
import { SURFACE, TILE } from './surfaces';
import type { WallFace } from './walls';

export type Tint = readonly [number, number, number];
const METAL = SURFACE.metal;
const SHELL = SURFACE.enclosure;
const ORANGE = 0xff8c37;
const HARDWARE = 0x313c43;
const RECESS = 0x202b30;
const RUBBER = 0x182228;
const COPPER = 0x986652;
export const STENCIL_UV = [0.008, 0.51, 0.992, 0.892] as const;
const HAZARD_UV = [0.008, 0.015, 0.992, 0.485] as const;
const WHITE: Tint = [1, 1, 1];

export function tint(hex: number, k = 1): Tint {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

function box(b: MeshBuilder, x: number, y: number, z: number, sx: number, sy: number, sz: number, hex: number, surface: number = METAL, faces?: number): void {
  const base = surface >= FINISH_SURFACE.paint ? METAL : surface % SHELL;
  const uvTile = base === SURFACE.floor ? TILE.floor : base === SURFACE.concrete ? TILE.wall : TILE.metal;
  b.addBox(x, y, z, sx, sy, sz, { rgb: tint(hex), uvTile, surface, faces });
}

function rounded(b: MeshBuilder, x: number, y: number, z: number, sx: number, sy: number, sz: number, radius: number, color: Tint, surface: number): void {
  const mesh = new RoundedBoxGeometry(sx, sy, sz, 1, radius);
  mesh.translate(x, y, z);
  const tile = surface === SURFACE.concrete ? TILE.wall : TILE.metal;
  b.addGeometry(mesh, color, surface, Math.max(sx, sy, sz) / tile);
  mesh.dispose();
}

/** Paint on the existing geometry without new objects for individual signs. */
export function wallDecal(
  b: MeshBuilder, f: WallFace, halfW: number, halfH: number, yc: number,
  uv: readonly [number, number, number, number], rgb: Tint, off = 0.012,
): void {
  const nx = f.axis === 'x' ? f.dir : 0, nz = f.axis === 'z' ? f.dir : 0;
  const x = f.axis === 'x' ? f.at + nx * off : f.centre;
  const z = f.axis === 'z' ? f.at + nz * off : f.centre;
  const ax = nz * halfW, az = -nx * halfW;
  b.addQuad([x - ax, yc - halfH, z - az, x + ax, yc - halfH, z + az,
    x + ax, yc + halfH, z + az, x - ax, yc + halfH, z - az], [nx, 0, nz],
    [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]], rgb);
}

export function floorPaint(
  b: MeshBuilder, x: number, z: number, dx: number, dz: number, y: number, rgb: Tint,
  uv: readonly [number, number, number, number] = [0, 0, 1, 1], mode = 0,
): void {
  b.addQuad([x - dx, y, z - dz, x - dx, y, z + dz, x + dx, y, z + dz, x + dx, y, z - dz],
    [0, 1, 0], [uv[0], uv[1], uv[0], uv[3], uv[2], uv[3], uv[2], uv[1]], rgb, 0, mode);
}

/** Two-piece cargo shell, recessed panels, reinforcing bars and lift sockets. */
export function cargo(lit: MeshBuilder, decals: MeshBuilder, b: ArenaBox, color: Tint): void {
  const { x, y, z, sx, sy, sz } = b;
  const bevel = Math.min(0.14, sy * 0.14, sx * 0.15, sz * 0.15);
  const top = y + sy / 2, bottom = y - sy / 2;
  rounded(lit, x, y, z, sx - 0.015, sy, sz - 0.015, bevel, color, FINISH_SURFACE.paint);
  if (sy < 0.45) return;
  rounded(lit, x, top - bevel * 0.60, z, sx + 0.022, bevel * 1.18, sz + 0.022, bevel * 0.48, tint(0x707d82), FINISH_SURFACE.steel);
  rounded(lit, x, bottom + bevel * 0.60, z, sx + 0.015, bevel * 1.25, sz + 0.015, bevel * 0.5, tint(RECESS), FINISH_SURFACE.rubber);
  for (const dir of [-1, 1] as const) {
    for (const axis of ['x', 'z'] as const) {
      const sideX = axis === 'x';
      const width = sideX ? sz : sx;
      const at = (sideX ? x + dir * sx / 2 : z + dir * sz / 2);
      const centre = sideX ? z : x;
      const face = { axis, dir, at, centre, span: width / 2 };
      const panel = (shift: number, py: number, w: number, h: number, depth: number, hex: number, finish: number = FINISH_SURFACE.paint): void => {
        const p = at + dir * depth / 4;
        box(lit, sideX ? p : centre + shift, py, sideX ? centre + shift : p,
          sideX ? depth : w, h, sideX ? w : depth, hex, finish);
      };
      panel(0, y, width - 0.34, sy * 0.57, 0.026, RECESS);
      panel(0, y - sy * 0.035, width - 0.47, sy * 0.46, 0.054, b.material === 'cover' ? 0x686f70 : 0x58696f);
      for (const shift of [-0.32, 0.32]) {
        panel(width * shift, y, 0.095, sy * 0.60, 0.082, HARDWARE);
        panel(width * shift, top - sy * 0.22, 0.19, 0.11, 0.105, 0x809092, FINISH_SURFACE.steel);
        for (let scuff = 0; scuff < 3; scuff += 1) {
          panel(width * shift + scuff * 0.044, top - sy * 0.22 + scuff * 0.016,
            0.065 - scuff * 0.013, 0.009, 0.109, 0x9da5a3, FINISH_SURFACE.steel);
        }
      }
      panel(0, bottom + sy * 0.12, Math.min(0.5, width / 3), Math.min(0.105, sy * 0.12), 0.064, RUBBER, FINISH_SURFACE.rubber);
      wallDecal(decals, face, Math.min(width * 0.29, 0.95), bevel * 0.40, top - bevel * 0.65, HAZARD_UV, WHITE, 0.032);
    }
  }
}

function wallPoint(f: WallFace, t: number, y: number, inset: number): THREE.Vector3 {
  const c = f.at + f.dir * inset;
  return f.axis === 'x' ? new THREE.Vector3(c, y, f.centre + t) : new THREE.Vector3(f.centre + t, y, c);
}

function wallBox(b: MeshBuilder, f: WallFace, t: number, y: number, inset: number, width: number, height: number, depth: number, hex: number, surface: number = METAL + SHELL): void {
  const p = wallPoint(f, t, y, inset);
  box(b, p.x, p.y, p.z, f.axis === 'x' ? depth : width, height, f.axis === 'x' ? width : depth, hex, surface);
}

function tube(b: MeshBuilder, curve: THREE.Curve<THREE.Vector3>, segments: number, radius: number, hex: number, surface: number = METAL + SHELL): void {
  const g = new THREE.TubeGeometry(curve, segments, radius, 8);
  b.addGeometry(g, tint(hex), surface, 4);
  g.dispose();
}

/** Perimeter service level: panel seams, skirting, duct vents, two pipe diameters and spill. */
export function services(lit: MeshBuilder, emit: MeshBuilder, mist: MeshBuilder, f: WallFace, h: number): void {
  const len = f.span * 2 - 2.3;
  const deckY = 0.54;
  const n = Math.max(1, Math.round(len / 4.4));
  for (let i = 0; i < n; i += 1) {
    const w = len / n, t = (i + 0.5) * w - len / 2;
    wallBox(lit, f, t, 0.98, 0.065, w - 0.055, 1.94, 0.13, i % 3 === 0 ? 0x4b565b : 0x414d54);
    wallBox(lit, f, t, 1.99, 0.075, w - 0.055, 0.12, 0.17, 0x647580);
    wallBox(lit, f, t, 0.17, 0.13, w - 0.08, 0.26, 0.25, RECESS);
    wallBox(lit, f, t, deckY, 0.15, w * 0.67, 0.13, 0.12, RUBBER);
    const p = wallPoint(f, t, deckY, 0.224);
    emit.addBox(p.x, p.y, p.z, f.axis === 'x' ? 0.035 : w * 0.57, 0.045, f.axis === 'x' ? w * 0.57 : 0.035, { rgb: tint(ORANGE, 4.4) });
    const pool = wallPoint(f, t, 0.018, 0.85);
    floorPaint(mist, pool.x, pool.z, f.axis === 'x' ? 1.6 : w * 0.48, f.axis === 'x' ? w * 0.48 : 1.6, pool.y, tint(ORANGE, 0.33));
    floorPaint(mist, pool.x, pool.z, f.axis === 'x' ? 1.5 : w * 0.30, f.axis === 'x' ? w * 0.30 : 1.5, 0.024, tint(ORANGE, 0.63), undefined, 2);
    wallDecal(mist, f, w * 0.48, 0.53, deckY, [0, 0, 1, 1], tint(ORANGE, 0.17), 0.14);
    wallBox(lit, f, t + w * 0.18, 1.22, 0.15, 1.12, 0.53, 0.11, RUBBER);
    for (let s = 0; s < 5; s += 1) wallBox(lit, f, t + w * 0.18, 1.04 + s * 0.085, 0.22, 1, 0.035, 0.055, 0x77878a);
    wallBox(lit, f, t - w * 0.44, h * 0.71, 0.14, 0.19, 1.1, 0.32, HARDWARE);
  }
  for (const [y, depth, radius, hex] of [[h - 1.24, 0.32, 0.115, COPPER], [h - 0.89, 0.28, 0.085, 0x607782]] as const) {
    tube(lit, new THREE.LineCurve3(wallPoint(f, -len / 2, y, depth), wallPoint(f, len / 2, y, depth)), 1, radius, hex);
    for (let t = -len / 2 + 1; t < len / 2; t += 3) {
      tube(lit, new THREE.LineCurve3(wallPoint(f, t - 0.09, y, depth), wallPoint(f, t + 0.09, y, depth)), 1, radius * 1.30, HARDWARE);
    }
  }
  // Paired dark cable loops droop below the rigid run, with raised connection boxes.
  for (let t = -len / 2 + 2; t < len / 2 - 2.6; t += 6) {
    wallBox(lit, f, t, h - 1.6, 0.22, 0.47, 0.49, 0.43, HARDWARE);
    const a = wallPoint(f, t, h - 1.78, 0.47), d = wallPoint(f, t + 2.6, h - 1.24, 0.38);
    for (let c = 0; c < 2; c += 1) {
      const curve = new THREE.CubicBezierCurve3(a, wallPoint(f, t + 0.28, h - 3.05 + c * 0.20, 0.64),
        wallPoint(f, t + 1.05, h - 2.8 + c * 0.18, 0.49), d);
      tube(lit, curve, 10, 0.032, c === 0 ? 0x273139 : 0x63777b);
    }
  }
}

/** Twin engaged pilasters on the core, with a visible service riser between them. */
export function controlCore(map: MapData, lit: MeshBuilder, decals: MeshBuilder, emit: MeshBuilder, mist: MeshBuilder, stencil: Tint): void {
  const core = map.solids.find((s) => s.kind === SOLID_KIND.pillar);
  if (!core) return;
  const z = core.max[2], h = core.max[1], x = (core.min[0] + core.max[0]) / 2;
  const width = (core.max[0] - core.min[0]) * 0.38;
  for (const dx of [-width * 0.75, width * 0.75]) {
    const cx = x + dx;
    rounded(lit, cx, h / 2, z - 0.075, width, h - 0.02, 0.32, 0.085, tint(0x697075), SURFACE.concrete);
    rounded(lit, cx, 0.3, z - 0.06, width + 0.07, 0.61, 0.44, 0.05, tint(HARDWARE), METAL);
    wallDecal(decals, { axis: 'z', at: z + 0.085, dir: 1, centre: cx, span: width / 2 }, width * 0.43, width * 0.135, 2.66, STENCIL_UV, stencil);
    box(lit, cx, 3.62, z + 0.085, width * 0.8, 0.23, 0.28, RECESS);
    emit.addBox(cx, 3.57, z + 0.237, width * 0.69, 0.045, 0.026, { rgb: tint(0x8fecff, 2.8) });
    const lower = { axis: 'z', dir: 1, at: z + 0.16, centre: cx, span: width / 2 } as const;
    box(lit, cx, 0.38, z + 0.174, width * 0.68, 0.12, 0.055, RUBBER);
    emit.addBox(cx, 0.375, z + 0.21, width * 0.58, 0.032, 0.023, { rgb: tint(ORANGE, 3.85) });
    floorPaint(mist, cx, z + 0.62, 0.86, 1.14, 0.019, tint(ORANGE, 0.37));
    floorPaint(mist, cx, z + 0.91, 0.64, 1.11, 0.023, tint(ORANGE, 0.49), undefined, 2);
    wallDecal(mist, lower, width * 0.47, 0.47, 0.47, [0, 0, 1, 1], tint(ORANGE, 0.21), 0.02);
  }
  for (const dx of [-0.19, 0.19]) {
    const a = new THREE.Vector3(x + dx, 0.33, z + 0.13), b = new THREE.Vector3(x + dx, h - 0.18, z + 0.13);
    tube(lit, new THREE.LineCurve3(a, b), 1, 0.083, COPPER, METAL);
    for (const y of [0.68, 1.43, 2.52, 3.64, 4.42]) box(lit, x + dx, y, z + 0.135, 0.28, 0.13, 0.29, HARDWARE);
  }
}

/** Fixture housing plus crossed, depth-tested local haze cards; no light per lamp. */
export function fixture(lit: MeshBuilder, mist: MeshBuilder, b: ArenaBox, color: Tint): void {
  box(lit, b.x, b.y + 0.087, b.z, b.sx + 0.17, 0.21, b.sz + 0.21, 0x4e6068, METAL + SHELL);
  const length = Math.max(b.sx, b.sz), y = b.y - 0.035;
  for (const dir of [0, 1]) {
    const ax = dir === 0 ? length * 0.49 : 0, az = dir === 0 ? 0 : length * 0.49;
    mist.addQuad([b.x - ax * 1.7, y - 2.25, b.z - az * 1.7, b.x + ax * 1.7, y - 2.25, b.z + az * 1.7,
      b.x + ax, y, b.z + az, b.x - ax, y, b.z - az], [0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], color, 0, 1);
  }
  const alongX = b.sx > b.sz;
  floorPaint(mist, b.x, b.z, alongX ? 1.32 : 0.19, alongX ? 0.19 : 1.48, 0.021, color, undefined, 2);
}

/** Fronds are sculpted as folded quads and baked into the PBR batch. The two
 * spawn-side supports are existing small solid crates, not new obstructions. */
export function planters(map: MapData, lit: MeshBuilder): void {
  if (map.id !== 0) return;
  const rng = mulberry32(0x431fa);
  const crates = map.solids.filter((s) => s.kind === SOLID_KIND.crate && s.min[2] > 7);
  for (const s of crates.slice(0, 2)) {
    const cx = (s.min[0] + s.max[0]) / 2;
    const x = cx - Math.sign(cx) * 0.54, z = (s.min[2] + s.max[2]) / 2 - 0.23, y = s.max[1];
    rounded(lit, x, y + 0.14, z, 1.36, 0.28, 1.13, 0.064, tint(0x38545b), METAL);
    box(lit, x, y + 0.29, z, 1.18, 0.035, 0.95, 0x312d26, SURFACE.concrete);
    for (const side of [-1, 1]) {
      box(lit, x, y + 0.30, z + side * 0.53, 1.37, 0.08, 0.1, 0x718488);
      box(lit, x + side * 0.63, y + 0.30, z, 0.10, 0.08, 1.10, 0x718488);
    }
    for (let i = 0; i < 28; i += 1) {
      const a = i * 2.39996 + rng() * 0.26;
      const dx = Math.cos(a), dz = Math.sin(a);
      const sx = x + dx * 0.27 * rng(), sz = z + dz * 0.24 * rng();
      const height = 0.29 + rng() * 0.65, spread = 0.36 + rng() * 0.46;
      const width = 0.05 + rng() * 0.06;
      const tone = [0x8eae5b, 0x94b772, 0x457334, 0x729d4c, 0x567b3f][i % 5];
      const edge = (t: number, sign: number): THREE.Vector3 => {
        const w = Math.sin(t * Math.PI) ** 0.9 * width;
        return new THREE.Vector3(sx + dx * spread * t - dz * w * sign,
          y + 0.3 + height * Math.sin(t * 2.06) - Math.abs(sign) * w * 0.38,
          sz + dz * spread * t + dx * w * sign);
      };
      for (const sign of [-1, 1]) {
        const rgb = tint(tone, sign > 0 ? 0.95 : 0.69);
        for (let j = 0; j < 6; j += 1) {
          const a0 = edge(j / 6, 0), a1 = edge(j / 6, sign);
          const b0 = edge((j + 1) / 6, 0), b1 = edge((j + 1) / 6, sign);
          // At a tapered end one edge is zero-width. Use the wider end, so
          // a degenerate face normal cannot feed NaNs into the HDR bloom pass.
          const side = (j < 3 ? b1.clone().sub(b0) : a1.clone().sub(a0));
          const normal = b0.clone().sub(a0).cross(side).normalize();
          lit.addQuad([...a0, ...b0, ...b1, ...a1], normal.toArray(), [0, 0, 1, 0, 1, 1, 0, 1], rgb, 0, SURFACE.foliage);
        }
      }
    }
  }
}

/** Centerline trim and maintenance chevrons, muted to leave mint to gameplay. */
export function controlRunway(lit: MeshBuilder, decals: MeshBuilder): void {
  for (const x of [-1.72, 1.72]) {
    box(lit, x, 0.006, 8, 0.09, 0.012, 10.8, 0x9babae, SURFACE.floor + SHELL, FACE.posY);
    for (const z of [3.1, 7.3, 11.5]) floorPaint(decals, x, z, 0.27, 0.08, 0.014, WHITE, HAZARD_UV);
  }
}
