/**
 * Procedural entity meshes for SECTOR_01. Everything is built from merged
 * axis-aligned boxes with per-face normals and vertex colours, so each enemy
 * or viewmodel is ONE geometry + ONE own material instance (no external
 * assets, per S14). Colours come from the design tokens in tokens.css.
 */
import * as THREE from 'three';
import { ENEMY_KIND, WEAPON } from '../wasm/protocol';

export interface BoxPart {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

/** Enemy palette — albedo-compensated so the FINAL pixel on the enemy's
 * player-facing faces lands on the ladder: body ≈ #45596a, joints ≈ #2e3d4a
 * (those faces receive ~0.7× irradiance, albedo is lifted ÷0.7). */
const C = {
  surface1: 0x3f5465, // joints / limbs
  surface2: 0x5e7a91, // body armour
  surface3: 0x6e89a2, // head / torso highlight
  border: 0x5c7086,
  primary: 0x5ce08b, // mint accent — scout visor
  danger: 0xff5b6b, // danger accent — sentinel visor
} as const;

/** Weapon viewmodel palette: darker than the arena surfaces so the gun sits
 * BELOW the HUD and never becomes the brightest object in the frame, ONE
 * mint accent stripe so it reads as foreground geometry, not UI. */
const W = {
  dark: 0x161b21,
  body: 0x232b33,
  border: 0x313a43,
  accent: 0x5ce08b,
} as const;

interface FaceDef {
  nx: number;
  ny: number;
  nz: number;
  /** Corner multipliers of the half extents, CCW seen from outside. */
  corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly FaceDef[] = [
  { nx: 1, ny: 0, nz: 0, corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { nx: -1, ny: 0, nz: 0, corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { nx: 0, ny: 1, nz: 0, corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { nx: 0, ny: -1, nz: 0, corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { nx: 0, ny: 0, nz: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { nx: 0, ny: 0, nz: -1, corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/** Merges axis-aligned boxes into one geometry with per-face normals and vertex colours. */
export function buildMergedGeometry(parts: BoxPart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();

  for (const p of parts) {
    color.setHex(p.color);
    const hx = p.sx / 2;
    const hy = p.sy / 2;
    const hz = p.sz / 2;
    for (const face of FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(p.x + corner[0] * hx, p.y + corner[1] * hy, p.z + corner[2] * hz);
        normals.push(face.nx, face.ny, face.nz);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Scout: compact hunched robot. Origin at the feet. The visor is built
 * separately as a real emissive (unlit) mesh so it reads at 15 m. */
function scoutParts(): BoxPart[] {
  return [
    { x: 0, y: 0.42, z: 0, sx: 0.34, sy: 0.16, sz: 0.26, color: C.surface2 },
    { x: 0, y: 0.62, z: 0.03, sx: 0.42, sy: 0.3, sz: 0.3, color: C.surface3 }, // hunched torso
    { x: 0, y: 0.84, z: 0.1, sx: 0.26, sy: 0.2, sz: 0.26, color: C.surface2 },
    { x: -0.13, y: 0.16, z: 0, sx: 0.13, sy: 0.32, sz: 0.15, color: C.surface1 },
    { x: 0.13, y: 0.16, z: 0, sx: 0.13, sy: 0.32, sz: 0.15, color: C.surface1 },
    { x: -0.27, y: 0.6, z: 0.06, sx: 0.1, sy: 0.3, sz: 0.12, color: C.surface2 },
    { x: 0.27, y: 0.6, z: 0.06, sx: 0.1, sy: 0.3, sz: 0.12, color: C.surface2 },
    { x: 0, y: 0.62, z: -0.19, sx: 0.24, sy: 0.22, sz: 0.08, color: C.surface1 }, // backpack
  ];
}

function scoutVisorParts(): BoxPart[] {
  return [{ x: 0, y: 0.85, z: 0.24, sx: 0.2, sy: 0.05, sz: 0.02, color: C.primary }];
}

/** Sentinel: taller unit with a rifle arm. Origin at the feet. */
function sentinelParts(): BoxPart[] {
  return [
    { x: 0, y: 0.72, z: 0, sx: 0.4, sy: 0.18, sz: 0.3, color: C.surface2 },
    { x: 0, y: 1.02, z: 0, sx: 0.5, sy: 0.42, sz: 0.34, color: C.surface3 },
    { x: 0, y: 1.36, z: 0.02, sx: 0.26, sy: 0.2, sz: 0.26, color: C.surface2 },
    { x: -0.15, y: 0.36, z: 0, sx: 0.16, sy: 0.54, sz: 0.18, color: C.surface1 },
    { x: 0.15, y: 0.36, z: 0, sx: 0.16, sy: 0.54, sz: 0.18, color: C.surface1 },
    { x: -0.34, y: 1.2, z: 0, sx: 0.14, sy: 0.16, sz: 0.3, color: C.surface2 }, // shoulder pad
    { x: 0.34, y: 1.2, z: 0, sx: 0.14, sy: 0.16, sz: 0.3, color: C.surface2 },
    { x: -0.36, y: 0.98, z: 0.06, sx: 0.1, sy: 0.34, sz: 0.12, color: C.surface2 },
    { x: 0.36, y: 1.05, z: 0.2, sx: 0.11, sy: 0.11, sz: 0.42, color: C.surface1 }, // rifle arm
    { x: 0.36, y: 1.05, z: 0.5, sx: 0.05, sy: 0.05, sz: 0.3, color: C.border }, // barrel
    { x: 0, y: 1.05, z: -0.22, sx: 0.3, sy: 0.3, sz: 0.1, color: C.surface1 }, // backpack
  ];
}

function sentinelVisorParts(): BoxPart[] {
  return [{ x: 0, y: 1.37, z: 0.16, sx: 0.22, sy: 0.05, sz: 0.02, color: C.danger }];
}

interface RobotAssets {
  body: THREE.BufferGeometry;
  bodyMat: THREE.Material;
  visor: THREE.BufferGeometry;
  visorMat: THREE.Material;
}

/** Un set de geometría y material por tipo: los slots del pool los comparten. */
const robotAssets = new Map<number, RobotAssets>();

function assetsFor(kind: number): RobotAssets {
  let assets = robotAssets.get(kind);
  if (!assets) {
    const isSentinel = kind === ENEMY_KIND.sentinel;
    assets = {
      body: buildMergedGeometry(isSentinel ? sentinelParts() : scoutParts()),
      bodyMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      visor: buildMergedGeometry(isSentinel ? sentinelVisorParts() : scoutVisorParts()),
      visorMat: new THREE.MeshBasicMaterial({ color: isSentinel ? C.danger : C.primary }),
    };
    robotAssets.set(kind, assets);
  }
  return assets;
}

/**
 * Enemy robot mesh. `kind`: 0 = scout, 1 = sentinel. The lit body is ONE
 * vertex-coloured Lambert mesh; the visor is a separate unlit MeshBasicMaterial
 * child (real emissive) so it stays readable at 15 m. Assets are shared per
 * kind; free them once with `disposeRobotAssets`.
 */
export function createRobotMesh(kind: number): THREE.Mesh {
  const assets = assetsFor(kind);
  const mesh = new THREE.Mesh(assets.body, assets.bodyMat);
  mesh.castShadow = true;
  const visor = new THREE.Mesh(assets.visor, assets.visorMat);
  visor.castShadow = false;
  mesh.add(visor);
  return mesh;
}

export function disposeRobotAssets(): void {
  for (const assets of robotAssets.values()) {
    assets.body.dispose();
    assets.bodyMat.dispose();
    assets.visor.dispose();
    assets.visorMat.dispose();
  }
  robotAssets.clear();
}

/** PB-01 sidearm viewmodel parts. Origin at the grip / hand. Muzzle ≈ (0, 0.02, -0.2). */
function sidearmParts(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.02, sx: 0.05, sy: 0.06, sz: 0.24, color: W.body }, // slide
    { x: 0, y: -0.02, z: -0.02, sx: 0.045, sy: 0.05, sz: 0.2, color: W.dark }, // frame
    { x: 0, y: -0.09, z: 0.06, sx: 0.045, sy: 0.15, sz: 0.07, color: W.dark }, // grip
    { x: 0, y: -0.05, z: -0.03, sx: 0.04, sy: 0.02, sz: 0.08, color: W.dark }, // guard
    { x: 0, y: 0.02, z: -0.17, sx: 0.024, sy: 0.024, sz: 0.09, color: W.border }, // barrel
    { x: 0, y: 0.02, z: -0.225, sx: 0.032, sy: 0.032, sz: 0.024, color: W.dark }, // muzzle block
    { x: 0.027, y: 0.02, z: 0, sx: 0.004, sy: 0.012, sz: 0.1, color: W.accent }, // stripe
  ];
}

/** AR-04 carbine viewmodel parts. Origin at the grip / hand. Muzzle ≈ (0, 0.03, -0.58). */
function carbineParts(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.1, sx: 0.05, sy: 0.08, sz: 0.5, color: W.body }, // body
    { x: 0, y: 0.03, z: -0.45, sx: 0.03, sy: 0.03, sz: 0.22, color: W.border }, // barrel
    { x: 0, y: 0.03, z: -0.575, sx: 0.038, sy: 0.038, sz: 0.03, color: W.dark }, // muzzle block
    { x: 0, y: -0.01, z: 0.24, sx: 0.045, sy: 0.1, sz: 0.16, color: W.dark }, // stock
    { x: 0, y: -0.08, z: 0.1, sx: 0.04, sy: 0.12, sz: 0.06, color: W.dark }, // grip
    { x: 0, y: -0.1, z: -0.05, sx: 0.04, sy: 0.14, sz: 0.05, color: W.dark }, // magazine
    { x: 0, y: 0.08, z: -0.08, sx: 0.025, sy: 0.05, sz: 0.1, color: W.dark }, // sight
    { x: 0.027, y: 0.03, z: -0.15, sx: 0.004, sy: 0.012, sz: 0.12, color: W.accent }, // stripe
  ];
}

/**
 * First-person weapon viewmodel. `weaponId`: 1 = sidearm, 2 = carbine.
 * Returned as a Group so the renderer can position / rotate it in camera space.
 */
export function createWeaponModel(weaponId: number): THREE.Group {
  const parts = weaponId === WEAPON.carbine ? carbineParts() : sidearmParts();
  const geometry = buildMergedGeometry(parts);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}
