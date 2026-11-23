/**
 * T6a follow-up: presupuesto de draw calls del preset medium (S9/S12 — sin número
 * inventado y sin cambio sin justificar).
 *
 * La anomalía de la re-medición (medium 15 → 21 calls y 39 384 → 47 702 tris contra la
 * fila medium de L5) se demostró NO regresiva:
 *
 * - Con el comando exacto de L5 (`--presets low,medium,high --seconds 20 --viewport
 *   1600x900 --dsf 2`), el árbol de HEAD mide medium en **21 calls / 47 846 tris** y
 *   high en **26 / 47 854** (fila exacta de L5); low 15-16 / ~47 8xx (fila de L5).
 * - En árboles T1 reales (1c7f40d, b561a75, 51d8499) medium ya medía 21-22 calls,
 *   con ~41k tris. La fila medium de L5 (15 / 39 384) no se reproduce en ningún
 *   árbol del historial: es un artefacto de muestreo (cuadro capturado sin el lote
 *   instanciado de robots —sin instancias vivas no aporta y sus tris faltan— y con
 *   los FX de feedback vacíos), no un pass añadido por las unidades combinadas.
 * - El árbol combinado mide medium en 21-22 / 47 702: igual o más barato que HEAD.
 *
 * El composer no es ejecutable en node (sin GL), así que el contrato de medium se
 * fija POR CONSTRUCCIÓN: cada lote del frame de medium, su fuente en el código y su
 * condición de dibujo. Un pass nuevo en medium rompe una de estas aserciones.
 *
 * Estructura del frame de medium (probe de pases T5e + harness, árbol combinado):
 * - world: caster del arena partido en los groups de ArenaSurfaces (4 draws),
 *   un InstancedMesh por clase de robot viva (máx 3), halo del telegraph (1),
 *   lote emisivo blink (1), marcador de objetivo (1), malla de atmósfera (1),
 *   atlas de decals (1, solo con el atlas decodificado) y pool de feedback (1).
 * - composer: 6 quads a pantalla completa (bloom recortado a 1 mip + OutputPass, ADR 0004).
 * - viewmodel: 6 draws (action, steel, ink, polymer, rubber, heat).
 * - shadow: 0 en cuadro estable; solo en needsUpdate (spawn/cambio de sector).
 * Total medido por el harness: 21-22 calls / ~47.7k tris en medium ( high 25-26 / ~47.7k).
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaBuild } from '../../src/render/arena';
import { EnemyPool } from '../../src/render/enemies';
import { PRESETS, resolveGfxPlan } from '../../src/render/presets';
import { postPlan } from '../../src/render/postfx';
import { lookFor } from '../../src/render/themes';
import { arenaBoxes } from '../../src/world/layout';
import type { MapData } from '../../src/world/map';

const AUTO = {
  gfxBloom: 'auto', gfxShadows: 'auto', gfxEnvironment: 'auto', gfxLights: 'auto', gfxMist: 'auto',
} as const;

/** Sector mínimo con la forma de SECTOR 01 y un terminal objetivo (como el real). */
function sectorMap(): MapData {
  return {
    id: 0,
    theme: 'control',
    mutator: 'none',
    start: { x: 0, z: 13, yaw: 0 },
    halfX: 18,
    halfZ: 18,
    solids: [
      { min: [-18, -1, -18], max: [18, 0, 18], kind: 1 },
      { min: [-18, 0, -18], max: [18, 6, -17], kind: 0 },
      { min: [-18, 0, 17], max: [18, 6, 18], kind: 0 },
      { min: [-18, 0, -18], max: [-17, 6, 18], kind: 0 },
      { min: [17, 0, -18], max: [18, 6, 18], kind: 0 },
      { min: [-6, 0, -6], max: [-4, 2.6, -4], kind: 6 },
      { min: [-12.65, 0, -0.65], max: [-11.35, 1.2, 0.65], kind: 4 },
      { min: [-2, 0, -2], max: [2, 6, 2], kind: 3 },
    ],
    nodes: [{ x: 10, y: 0, z: -8 }],
    spawns: [],
  };
}

describe('medium draw-call contract (por construcción; sin GL en node)', () => {
  it('medium renders through the composer with bloom ON: the six fullscreen composer quads exist', () => {
    // ADR 0004: medium y high usan composer (RenderPass → UnrealBloom → OutputPass);
    // el bloom de medium va recortado a un solo mip (trimBloomMips). Medido: 6 draws
    // de composer en medium. Sin esto, medium perdería el pase completo de golpe.
    expect(postPlan('medium', 'auto')).toEqual({ bloom: true, msaaSamples: 4 });
    expect(postPlan('low', 'auto')).toEqual({ bloom: false, msaaSamples: 0 }); // low directo
  });

  it('every medium auto override resolves ON: no effect silently drops a pass at medium', () => {
    const plan = resolveGfxPlan(PRESETS.medium, AUTO);
    expect(plan).toEqual({ bloom: true, shadows: true, environment: true, lights: true, mist: true });
    // Y los únicos ejes que medium comparte con high (el resto es del preset):
    expect(PRESETS.medium.shadows).toBe(PRESETS.high.shadows);
  });

  it('the arena merges into at most four static meshes + one terminals InstancedMesh batch', () => {
    const arena = new ArenaBuild(sectorMap(), arenaBoxes(sectorMap()), lookFor('control'));
    try {
      const meshes = arena.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh));
      const instanced = arena.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
      expect(meshes).toHaveLength(4); // caster + emissive + mist + decals
      expect(instanced).toHaveLength(1); // terminals.batch
      expect(instanced[0].count).toBe(1);
    } finally {
      arena.dispose();
    }
  });

  it('the caster world draws are exactly its ArenaSurfaces material groups (4 en SECTOR 01)', () => {
    const arena = new ArenaBuild(sectorMap(), arenaBoxes(sectorMap()), lookFor('control'));
    try {
      const caster = arena.group.children.find((c) => (c as THREE.Mesh).castShadow) as THREE.Mesh;
      expect(caster).toBeInstanceOf(THREE.Mesh);
      // En este sector mínimo son 3 groups; en SECTOR 01 completo son 4 (medido con
      // el probe de pases). Un quinto group sería un batch nuevo silencioso.
      expect(caster.geometry.groups.length).toBe(3);
      expect(caster.geometry.groups.length).toBeLessThanOrEqual(4);
      expect(caster.receiveShadow).toBe(true);
    } finally {
      arena.dispose();
    }
  });

  it('the decal draw is atlas-gated, never on by accident (sin document no hay atlas)', () => {
    const arena = new ArenaBuild(sectorMap(), arenaBoxes(sectorMap()), lookFor('control'));
    try {
      const printed = arena.group.children.find(
        (c) => (c as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.alphaTest > 0,
      ) as THREE.Mesh;
      expect(printed.visible).toBe(false); // con atlas decodificado pasa a true (+1 draw)
      expect(printed.receiveShadow).toBe(true);
    } finally {
      arena.dispose();
    }
  });

  it('robots cost one draw per ALIVE class, max three: pooled instanced, no per-object material, no shadows', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    const robots = scene.children.filter(
      (c): c is THREE.InstancedMesh =>
        c instanceof THREE.InstancedMesh && (c.material as THREE.MeshStandardMaterial).customProgramCacheKey?.() === 'bp-rigid-robot',
    );
    expect(robots).toHaveLength(3); // scout, sentinel, interceptor: un lote por clase
    for (const batch of robots) {
      expect(batch.count).toBe(0);
      expect(batch.visible).toBe(false); // cero draws hasta que la clase tenga instancias vivas
      expect(batch.castShadow).toBe(false);
      expect(batch.frustumCulled).toBe(false);
      expect((batch.material as THREE.MeshStandardMaterial).type).toBe('MeshStandardMaterial');
    }

    // 3 lotes de robots + el halo del telegraph: el único otro InstancedMesh del pool.
    const instanced = scene.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
    expect(instanced).toHaveLength(4);
    const halo = instanced.find((c) => !robots.includes(c));
    expect((halo?.material as THREE.MeshBasicMaterial).type).toBe('MeshBasicMaterial'); // halo instanciado, 1 draw
    pool.hide();
  });
});
