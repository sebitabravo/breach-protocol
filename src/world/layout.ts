/**
 * SECTOR_01 — the layout is the single source of truth for both consumers:
 * the collision boxes uploaded to Rust and the meshes built by the renderer.
 */
export type Material =
  | 'floor'
  | 'wall'
  | 'cover'
  | 'crate'
  | 'pillar'
  | 'trim'
  | 'beam'
  | 'ceiling'
  | 'glow';

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
}

export interface NodeDef {
  x: number;
  z: number;
  label: string;
}

const W = 17; // inner face of the perimeter walls
const H = 6; // wall height

/**
 * Ceiling-mounted lamp segments hanging just under the ceiling plane (y≈6):
 * 1.6 m lamps with a 1.9 m gap, centred on the given coordinate, running
 * parallel to `axis`. Visual-only — they never collide and never block shots.
 */
function ceilingLamps(y: number, at: number, axis: 'x' | 'z'): ArenaBox[] {
  const out: ArenaBox[] = [];
  for (let c = -14; c <= 14; c += 3.5) {
    out.push(
      axis === 'x'
        ? { x: c, y, z: at, sx: 1.6, sy: 0.06, sz: 0.12, material: 'glow', solid: false }
        : { x: at, y, z: c, sx: 0.12, sy: 0.06, sz: 1.6, material: 'glow', solid: false },
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

export const ARENA_BOXES: ArenaBox[] = [
  // --- ground -------------------------------------------------------------
  { x: 0, y: -0.5, z: 0, sx: 36, sy: 1, sz: 36, material: 'floor', solid: true },

  // --- perimeter ----------------------------------------------------------
  { x: 0, y: H / 2, z: -(W + 0.5), sx: 36, sy: H, sz: 1, material: 'wall', solid: true },
  { x: 0, y: H / 2, z: W + 0.5, sx: 36, sy: H, sz: 1, material: 'wall', solid: true },
  { x: -(W + 0.5), y: H / 2, z: 0, sx: 1, sy: H, sz: 36, material: 'wall', solid: true },
  { x: W + 0.5, y: H / 2, z: 0, sx: 1, sy: H, sz: 36, material: 'wall', solid: true },

  // --- ceiling: dark enclosed roof at y≈6, rendered by the renderer as a
  // downward-facing grid plane (single-sided, so the menu orbit can still
  // look over the walls from above). Visual-only: never a collider.
  { x: 0, y: H, z: 0, sx: 36, sy: 0.2, sz: 36, material: 'ceiling', solid: false },

  // --- core ---------------------------------------------------------------
  { x: 0, y: H / 2, z: 0, sx: 4, sy: H, sz: 4, material: 'pillar', solid: true },
  capEdge(0, 0, 4, 4, H),

  // --- four cover masses --------------------------------------------------
  { x: -7, y: 1, z: -7, sx: 4, sy: 2, sz: 2.4, material: 'cover', solid: true },
  { x: 7, y: 1, z: -7, sx: 2.4, sy: 2, sz: 4, material: 'cover', solid: true },
  { x: -7, y: 1, z: 7, sx: 2.4, sy: 2, sz: 4, material: 'cover', solid: true },
  { x: 7, y: 1, z: 7, sx: 4, sy: 2, sz: 2.4, material: 'cover', solid: true },
  // lighter cap edges so each mass reads as a built panel
  capEdge(-7, -7, 4, 2.4, 2),
  capEdge(7, -7, 2.4, 4, 2),
  capEdge(-7, 7, 2.4, 4, 2),
  capEdge(7, 7, 4, 2.4, 2),

  // --- jumpable crates (0.7 m < 0.83 m jump apex) -------------------------
  { x: -4, y: 0.35, z: 10.5, sx: 1.6, sy: 0.7, sz: 1.6, material: 'crate', solid: true },
  { x: 4, y: 0.35, z: 10.5, sx: 1.6, sy: 0.7, sz: 1.6, material: 'crate', solid: true },
  { x: -4, y: 0.35, z: -10.5, sx: 1.6, sy: 0.7, sz: 1.6, material: 'crate', solid: true },
  { x: 4, y: 0.35, z: -10.5, sx: 1.6, sy: 0.7, sz: 1.6, material: 'crate', solid: true },

  // --- side corridors with a wide doorway at z = 0 ------------------------
  { x: -13, y: 1.6, z: -9, sx: 0.8, sy: 3.2, sz: 6, material: 'wall', solid: true },
  { x: -13, y: 1.6, z: 9, sx: 0.8, sy: 3.2, sz: 6, material: 'wall', solid: true },
  { x: 13, y: 1.6, z: -9, sx: 0.8, sy: 3.2, sz: 6, material: 'wall', solid: true },
  { x: 13, y: 1.6, z: 9, sx: 0.8, sy: 3.2, sz: 6, material: 'wall', solid: true },

  // --- terminal plinths ---------------------------------------------------
  { x: -12, y: 0.6, z: 0, sx: 1.3, sy: 1.2, sz: 1.3, material: 'trim', solid: true },
  { x: 12, y: 0.6, z: 0, sx: 1.3, sy: 1.2, sz: 1.3, material: 'trim', solid: true },
  { x: 0, y: 0.6, z: -12, sx: 1.3, sy: 1.2, sz: 1.3, material: 'trim', solid: true },

  // --- visual detail: ceiling-mounted light strips, pillar trim -------------
  // Industrial lamp strips hang under the ceiling plane (y≈5.85) so the arena
  // reads as an enclosed interior: four rows, two along x, two along z.
  ...ceilingLamps(5.85, -6, 'x'),
  ...ceilingLamps(5.85, 6, 'x'),
  ...ceilingLamps(5.85, -6, 'z'),
  ...ceilingLamps(5.85, 6, 'z'),
  // structural beams so the lamps read as mounted on a roof, not pasted in
  ...ceilingBeams(5.62),
  { x: -1.95, y: 2.4, z: 0, sx: 0.06, sy: 3.2, sz: 0.3, material: 'glow', solid: false },
  { x: 1.95, y: 2.4, z: 0, sx: 0.06, sy: 3.2, sz: 0.3, material: 'glow', solid: false },

  // four mint edge guide strips on the floor running to the terminals: one
  // each toward the west/east nodes, two parallel rails toward the north node
  { x: -7.7, y: 0.01, z: 0, sx: 6.8, sy: 0.02, sz: 0.14, material: 'glow', solid: false },
  { x: 7.7, y: 0.01, z: 0, sx: 6.8, sy: 0.02, sz: 0.14, material: 'glow', solid: false },
  { x: -0.35, y: 0.01, z: -7.7, sx: 0.14, sy: 0.02, sz: 6.8, material: 'glow', solid: false },
  { x: 0.35, y: 0.01, z: -7.7, sx: 0.14, sy: 0.02, sz: 6.8, material: 'glow', solid: false },

  // inset wall panelling for silhouette variety
  { x: -8, y: 1.5, z: -16.7, sx: 5, sy: 3, sz: 0.25, material: 'trim', solid: false },
  { x: 8, y: 1.5, z: 16.7, sx: 5, sy: 3, sz: 0.25, material: 'trim', solid: false },
  { x: -16.7, y: 1.5, z: 8, sx: 0.25, sy: 3, sz: 5, material: 'trim', solid: false },
  { x: 16.7, y: 1.5, z: -8, sx: 0.25, sy: 3, sz: 5, material: 'trim', solid: false },
];

export const NODES: NodeDef[] = [
  { x: -12, z: 0, label: 'nodo oeste' },
  { x: 12, z: 0, label: 'nodo este' },
  { x: 0, z: -12, label: 'nodo norte' },
];

/** Eight perimeter spawn points; every point is ≥ 9 m from PLAYER_START
 * (0, 13) — the closest is (9, 14.5) at ≈ 9.12 m — and clear of solid boxes. */
export const SPAWNS: ReadonlyArray<readonly [number, number]> = [
  [9, 14.5],
  [14.2, 2],
  [-14.2, 2],
  [0, -14.5],
  [10, 10],
  [-10, 10],
  [10, -10],
  [-10, -10],
];

export const PLAYER_START = { x: 0, z: 13, yaw: 0 };

export const ARENA_HALF = W;

/** `[minX, minY, minZ, maxX, maxY, maxZ, kind]` per solid box. */
export function colliderData(): Float32Array {
  const solid = ARENA_BOXES.filter((b) => b.solid !== false);
  const out = new Float32Array(solid.length * 7);
  solid.forEach((b, i) => {
    const o = i * 7;
    out[o] = b.x - b.sx / 2;
    out[o + 1] = b.y - b.sy / 2;
    out[o + 2] = b.z - b.sz / 2;
    out[o + 3] = b.x + b.sx / 2;
    out[o + 4] = b.y + b.sy / 2;
    out[o + 5] = b.z + b.sz / 2;
    out[o + 6] = materialKind(b.material);
  });
  return out;
}

function materialKind(m: Material): number {
  switch (m) {
    case 'floor':
      return 1;
    case 'wall':
      return 0;
    case 'crate':
      return 2;
    case 'pillar':
      return 3;
    case 'trim':
      return 4;
    default:
      return 0;
  }
}

export function nodeData(): Float32Array {
  const out = new Float32Array(NODES.length * 2);
  NODES.forEach((n, i) => {
    out[i * 2] = n.x;
    out[i * 2 + 1] = n.z;
  });
  return out;
}

export function spawnData(): Float32Array {
  const out = new Float32Array(SPAWNS.length * 2);
  SPAWNS.forEach((s, i) => {
    out[i * 2] = s[0];
    out[i * 2 + 1] = s[1];
  });
  return out;
}
