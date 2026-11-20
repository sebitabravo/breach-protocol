/**
 * Construcción del arena a partir de `ArenaBox`: un InstancedMesh por material,
 * más el techo como plano único y los halos de las luminarias.
 */
import * as THREE from 'three';
import type { ArenaBox, Material } from '../world/layout';
import { makeGridTexture } from './textures';
import { MATERIAL_COLORS, PALETTE } from './themes';

/** Deterministic PRNG (mulberry32) so per-instance wall variation is stable
 * across frames and sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Arena from ARENA_BOXES, grouped by material: one InstancedMesh per
 * material — except the ceiling, which becomes a single downward-facing
 * plane (invisible from above, so the menu orbit can still look over the
 * walls) in the dark roof colour. Shadow selectivity: only the cover masses
 * cast, only floor + cover receive; enemies cast via their own meshes.
 * Returns the textures it created so the caller can free them with the group.
 */
export function buildArena(boxes: ArenaBox[], group: THREE.Group): THREE.Texture[] {
  const groups = new Map<Material, ArenaBox[]>();
  for (const box of boxes) {
    const list = groups.get(box.material);
    if (list) list.push(box);
    else groups.set(box.material, [box]);
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const matrix = new THREE.Matrix4();
  const gridTexture = makeGridTexture();
  for (const [material, boxes] of groups) {
    if (material === 'ceiling') {
      // first (only) ceiling box defines the extent; plane at its base
      const b = boxes[0];
      const geo = new THREE.PlaneGeometry(b.sx, b.sz);
      geo.rotateX(Math.PI / 2); // normal points DOWN: visible from below only
      const mat = new THREE.MeshBasicMaterial({ color: PALETTE.ceiling });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set(b.x, b.y - b.sy / 2, b.z);
      plane.receiveShadow = false;
      group.add(plane);
      continue;
    }
    const isGlow = material === 'glow' || material === 'beam';
    let mat: THREE.Material;
    if (material === 'beam') {
      // constant value one clear step above the ceiling so the beams read as
      // structure from below (a lit Lambert bottom face would go black)
      mat = new THREE.MeshBasicMaterial({ color: 0x171f27 });
    } else if (isGlow) {
      mat = new THREE.MeshBasicMaterial({ color: MATERIAL_COLORS[material] });
    } else if (material === 'floor') {
      mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLORS[material], map: gridTexture });
    } else if (material === 'wall' || material === 'trim' || material === 'rack' || material === 'deck') {
      // white diffuse; the real per-instance colour arrives via instanceColor
      // (three multiplies diffuse × instanceColor in the shader)
      mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    } else {
      mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLORS[material] });
    }
    const mesh = new THREE.InstancedMesh(unitBox, mat, boxes.length);
    for (let i = 0; i < boxes.length; i += 1) {
      const b = boxes[i];
      matrix.makeScale(b.sx, b.sy, b.sz);
      matrix.setPosition(b.x, b.y, b.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    jitterPanels(mesh, material, boxes.length);
    // contact shadows: cover casts + receives, floor receives; enemies cast
    // through their own meshes (createRobotMesh). Nothing else participates.
    mesh.castShadow = material === 'cover';
    mesh.receiveShadow = material === 'floor' || material === 'cover';
    group.add(mesh);
  }
  buildLampHalos(boxes, group);
  return [gridTexture];
}

/** Per-instance value variation (±6/255 per channel, sRGB, seeded) breaks
 * up the flat wall panels and trims. instanceColor multiplies the (white)
 * diffuse in linear space, so each entry carries the FULL colour here. */
function jitterPanels(mesh: THREE.InstancedMesh, material: Material, count: number): void {
  if (material !== 'wall' && material !== 'trim') return;
  const hex = MATERIAL_COLORS[material];
  const r8 = (hex >> 16) & 0xff;
  const g8 = (hex >> 8) & 0xff;
  const b8 = hex & 0xff;
  const rng = mulberry32(material === 'wall' ? 0x5eed11 : 0x1a2b3c);
  const jit = (): number => Math.round((rng() * 2 - 1) * 6);
  const clamp255 = (v: number): number => Math.min(Math.max(v, 0), 255);
  const tmp = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    tmp.setRGB(
      clamp255(r8 + jit()) / 255,
      clamp255(g8 + jit()) / 255,
      clamp255(b8 + jit()) / 255,
      THREE.SRGBColorSpace,
    );
    mesh.setColorAt(i, tmp);
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** One merged additive halo under every ceiling lamp so the strips read as
 * mounted light fixtures. A single InstancedMesh = one extra draw call. */
function buildLampHalos(boxes: ArenaBox[], group: THREE.Group): void {
  const lamps = boxes.filter((b) => b.material === 'glow' && b.y > 5);
  if (lamps.length === 0) return;
  const geo = new THREE.PlaneGeometry(1.2, 1.2);
  geo.rotateX(Math.PI / 2); // faces down, like the ceiling plane
  const mat = new THREE.MeshBasicMaterial({
    color: 0xbfffd9,
    blending: THREE.AdditiveBlending,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, lamps.length);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < lamps.length; i += 1) {
    const b = lamps[i];
    matrix.makeTranslation(b.x, b.y - 0.07, b.z);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  group.add(mesh);
}

/** Frees every geometry, material and texture under an arena group. */
export function disposeArena(group: THREE.Group, textures: readonly THREE.Texture[]): void {
  const geoms = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geoms.add(mesh.geometry);
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => mats.add(m));
    else if (mat) mats.add(mat);
  });
  geoms.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  group.removeFromParent();
}
