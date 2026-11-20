import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArenaBuild, litColour, perimeterFaces } from '../../src/render/arena';
import { mulberry32 } from '../../src/render/random';
import { lookFor, MATERIAL_COLORS } from '../../src/render/themes';
import { arenaBoxes } from '../../src/world/layout';
import type { MapData } from '../../src/world/map';

/** Sector mínimo con la forma de SECTOR 01: piso, cuatro muros, un pilar, un rack y un terminal. */
function sectorMap(): MapData {
  return {
    id: 0,
    theme: 'control',
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
    nodes: [],
    spawns: [],
  };
}

describe('perimeterFaces', () => {
  it('returns the four inner faces with their inward direction', () => {
    const faces = perimeterFaces(sectorMap());
    expect(faces).toHaveLength(4);
    expect(faces.find((f) => f.axis === 'x' && f.dir === 1)?.at).toBe(-17);
    expect(faces.find((f) => f.axis === 'x' && f.dir === -1)?.at).toBe(17);
    expect(faces.find((f) => f.axis === 'z' && f.dir === 1)?.at).toBe(-17);
    expect(faces.find((f) => f.axis === 'z' && f.dir === -1)?.at).toBe(17);
  });

  it('does not mistake the north wall for the west wall (both touch x = -halfX)', () => {
    const west = perimeterFaces(sectorMap()).find((f) => f.axis === 'x' && f.dir === 1);
    expect(west?.span).toBe(18);
    expect(west?.centre).toBe(0);
  });
});

describe('ArenaBuild batching', () => {
  it('merges the sector into at most four meshes, none instanced', () => {
    const map = sectorMap();
    const arena = new ArenaBuild(map, arenaBoxes(map), lookFor('control'));
    const meshes = arena.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    expect(meshes).toHaveLength(4);
    expect(arena.group.children.some((c) => c instanceof THREE.InstancedMesh)).toBe(false);
  });

  it('casts shadows only from the lit batch', () => {
    const map = sectorMap();
    const arena = new ArenaBuild(map, arenaBoxes(map), lookFor('control'));
    const casters = arena.group.children.filter((c) => (c as THREE.Mesh).castShadow);
    expect(casters).toHaveLength(1);
    expect(casters[0]).toBeInstanceOf(THREE.Mesh);
  });

  it('frees every geometry and material on dispose', () => {
    const map = sectorMap();
    const arena = new ArenaBuild(map, arenaBoxes(map), lookFor('control'));
    const geometries = arena.group.children.map((c) => (c as THREE.Mesh).geometry);
    let disposed = 0;
    for (const g of geometries) g.addEventListener('dispose', () => (disposed += 1));
    arena.dispose();
    expect(disposed).toBe(geometries.length);
    expect(arena.group.parent).toBeNull();
  });
});

describe('litColour', () => {
  it('colours racks and decks with their material albedo, not white (regression)', () => {
    const rng = mulberry32(1);
    const look = lookFor('archive');
    for (const material of ['rack', 'deck'] as const) {
      const [r, g, b] = litColour(material, look, rng);
      const expected = new THREE.Color(MATERIAL_COLORS[material]);
      expect(r).toBeCloseTo(expected.r, 6);
      expect(g).toBeCloseTo(expected.g, 6);
      expect(b).toBeCloseTo(expected.b, 6);
      expect(r).toBeLessThan(0.5);
    }
  });

  it('jitters wall colour deterministically for the same seed', () => {
    const look = lookFor('control');
    const a = litColour('wall', look, mulberry32(7));
    const b = litColour('wall', look, mulberry32(7));
    expect(a).toEqual(b);
  });
});
