/**
 * Procedural robot meshes. Everything is built from merged axis-aligned boxes
 * with per-face normals and vertex colours, so each enemy kind is ONE body
 * geometry + ONE eyes geometry, shared by every robot of that kind (no external
 * assets, per S14). The state glow lives in telegraph.ts, not in these
 * materials, so the shared-material contract holds.
 */
import * as THREE from 'three';
import { ENEMY_KIND } from '../wasm/protocol';
import { buildMergedGeometry, MeshBuilder, type BoxPart } from './geometry';

/** Robot palette: albedo-compensated so the FINAL pixel on the enemy's
 * player-facing faces lands on the ladder: body ≈ #45596a, joints ≈ #2e3d4a
 * (those faces receive ~0.7× irradiance, albedo is lifted ÷0.7). */
const C = {
  surface1: 0x3f5465, // joints / limbs
  surface2: 0x5e7a91, // body armour
  surface3: 0x6e89a2, // head / torso highlight
  blade: 0x8fa6b8, // interceptor blade arms
  border: 0x5c7086,
  eye: 0xff5b6b, // danger red: every robot has red emissive eyes
} as const;

/** Scout: compact hunched robot. Origin at the feet. */
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

function scoutEyeParts(): BoxPart[] {
  return [
    { x: -0.06, y: 0.86, z: 0.24, sx: 0.07, sy: 0.04, sz: 0.02, color: C.eye },
    { x: 0.06, y: 0.86, z: 0.24, sx: 0.07, sy: 0.04, sz: 0.02, color: C.eye },
  ];
}

/** Sentinel: tall, wide-shouldered unit with a rifle arm. Origin at the feet. */
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

function sentinelEyeParts(): BoxPart[] {
  return [{ x: 0, y: 1.37, z: 0.16, sx: 0.22, sy: 0.05, sz: 0.02, color: C.eye }];
}

/**
 * Interceptor: lean, angular, built to be read as a diagonal silhouette. Blade
 * forearms reach forward past the knees; no shoulder pads. Leans forward via
 * `robotLook().lean` on the mesh, so the body itself stays upright here.
 */
function interceptorParts(): BoxPart[] {
  return [
    { x: 0, y: 0.62, z: 0, sx: 0.34, sy: 0.14, sz: 0.22, color: C.surface1 }, // hips
    { x: -0.11, y: 0.3, z: 0.04, sx: 0.12, sy: 0.5, sz: 0.14, color: C.surface1 },
    { x: 0.11, y: 0.3, z: 0.04, sx: 0.12, sy: 0.5, sz: 0.14, color: C.surface1 },
    { x: -0.11, y: 0.07, z: 0.12, sx: 0.14, sy: 0.12, sz: 0.3, color: C.border }, // feet
    { x: 0.11, y: 0.07, z: 0.12, sx: 0.14, sy: 0.12, sz: 0.3, color: C.border },
    { x: 0, y: 0.98, z: 0.08, sx: 0.36, sy: 0.42, sz: 0.26, color: C.surface2 }, // chest
    { x: 0, y: 1.0, z: 0.22, sx: 0.26, sy: 0.28, sz: 0.06, color: C.surface3 }, // chest plate
    { x: 0, y: 1.36, z: 0.18, sx: 0.22, sy: 0.2, sz: 0.24, color: C.surface3 }, // head wedge
    { x: 0, y: 1.2, z: -0.16, sx: 0.08, sy: 0.5, sz: 0.06, color: C.surface1 }, // spine fin
    { x: -0.27, y: 1.0, z: 0.22, sx: 0.1, sy: 0.1, sz: 0.4, color: C.surface1 }, // upper arms
    { x: 0.27, y: 1.0, z: 0.22, sx: 0.1, sy: 0.1, sz: 0.4, color: C.surface1 },
    { x: -0.3, y: 0.82, z: 0.72, sx: 0.04, sy: 0.06, sz: 0.8, color: C.blade }, // blade arms
    { x: 0.3, y: 0.82, z: 0.72, sx: 0.04, sy: 0.06, sz: 0.8, color: C.blade },
  ];
}

function interceptorEyeParts(): BoxPart[] {
  return [
    { x: -0.06, y: 1.37, z: 0.31, sx: 0.07, sy: 0.04, sz: 0.02, color: C.eye },
    { x: 0.06, y: 1.37, z: 0.31, sx: 0.07, sy: 0.04, sz: 0.02, color: C.eye },
  ];
}

interface RobotAssets {
  body: THREE.BufferGeometry;
  bodyMat: THREE.Material;
  visor: THREE.BufferGeometry;
  visorMat: THREE.Material;
}

/** Un set de geometría y material por tipo: los slots del pool los comparten. */
const robotAssets = new Map<number, RobotAssets>();

function partsFor(kind: number): { body: BoxPart[]; eyes: BoxPart[] } {
  if (kind === ENEMY_KIND.sentinel) return { body: sentinelParts(), eyes: sentinelEyeParts() };
  if (kind === ENEMY_KIND.interceptor) return { body: interceptorParts(), eyes: interceptorEyeParts() };
  return { body: scoutParts(), eyes: scoutEyeParts() };
}

function assetsFor(kind: number): RobotAssets {
  let assets = robotAssets.get(kind);
  if (!assets) {
    const parts = partsFor(kind);
    assets = {
      body: buildMergedGeometry(parts.body),
      bodyMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
      visor: buildMergedGeometry(parts.eyes),
      visorMat: new THREE.MeshBasicMaterial({ color: C.eye }),
    };
    robotAssets.set(kind, assets);
  }
  return assets;
}

/**
 * Enemy robot mesh. `kind`: 0 = scout, 1 = sentinel, 2 = interceptor. The lit
 * body is ONE vertex-coloured Lambert mesh; the eyes are a separate unlit
 * MeshBasicMaterial child (real emissive) so they stay readable at 15 m. Robots
 * do not cast shadows (a shadow draw per robot would break the draw budget).
 * Assets are shared per kind; free them once with `disposeRobotAssets`.
 */
export function createRobotMesh(kind: number): THREE.Mesh {
  const assets = assetsFor(kind);
  const mesh = new THREE.Mesh(assets.body, assets.bodyMat);
  mesh.castShadow = false;
  const visor = new THREE.Mesh(assets.visor, assets.visorMat);
  visor.castShadow = false;
  mesh.add(visor);
  return mesh;
}

/** Combat uses one instanced draw per kind, including the emissive visor. */
export function buildRobotBatch(kind: number, capacity: number): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const parts = partsFor(kind);
  const builder = new MeshBuilder();
  const c = new THREE.Color();
  for (const part of parts.body) {
    c.setHex(part.color);
    builder.addBox(part.x, part.y, part.z, part.sx, part.sy, part.sz, { rgb: [c.r, c.g, c.b] });
  }
  c.setHex(C.eye);
  for (const part of parts.eyes) {
    builder.addBox(part.x, part.y, part.z, part.sx, part.sy, part.sz, { rgb: [c.r, c.g, c.b], blink: 1 });
  }
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aBlink;\nflat varying float vVisor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvVisor = aBlink;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nflat varying float vVisor;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vVisor * 2.6;');
  };
  material.customProgramCacheKey = () => 'bp-instanced-robot-visor';
  const mesh = new THREE.InstancedMesh(builder.build(), material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.visible = false;
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
