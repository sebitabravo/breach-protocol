/**
 * Procedural robot meshes for SECTOR_01. Everything is built from merged
 * axis-aligned boxes with per-face normals and vertex colours, so each enemy
 * is ONE geometry + ONE own material instance (no external assets, per S14).
 * Colours come from the design tokens in tokens.css.
 */
import * as THREE from 'three';
import { ENEMY_KIND } from '../wasm/protocol';
import { buildMergedGeometry, type BoxPart } from './geometry';

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
