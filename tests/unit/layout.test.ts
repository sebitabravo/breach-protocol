import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine } from '../../src/wasm/bridge';
import { arenaBoxes, wallHeight } from '../../src/world/layout';
import type { MapData } from '../../src/world/map';

const maps: MapData[] = [];

beforeAll(async () => {
  const engine = await Engine.fromBytes(readFileSync(new URL('../../public/bp_core.wasm', import.meta.url)));
  for (const id of [0, 1, 2]) maps.push(engine.loadMap(id));
});

describe('arenaBoxes (visual layer over the core colliders)', () => {
  it('keeps every collider the core reported, flagged solid', () => {
    for (const map of maps) {
      const solid = arenaBoxes(map).filter((b) => b.solid);
      expect(solid).toHaveLength(map.solids.length);
    }
  });

  it('adds visual-only decoration that never collides', () => {
    for (const map of maps) {
      const decor = arenaBoxes(map).filter((b) => !b.solid);
      expect(decor.length).toBeGreaterThan(0);
      expect(decor.every((b) => b.solid === false)).toBe(true);
    }
  });

  it('every sector has exactly one ceiling plane at wall height', () => {
    for (const map of maps) {
      const ceilings = arenaBoxes(map).filter((b) => b.material === 'ceiling');
      expect(ceilings).toHaveLength(1);
      expect(ceilings[0].y).toBeCloseTo(wallHeight(map), 5);
    }
  });

  it('ceiling lamps hang below the ceiling and above head height', () => {
    for (const map of maps) {
      const h = wallHeight(map);
      const lamps = arenaBoxes(map).filter((b) => b.material === 'glow' && b.y > 5);
      expect(lamps.length).toBeGreaterThan(0);
      for (const lamp of lamps) {
        expect(lamp.y).toBeLessThan(h);
        expect(lamp.y).toBeGreaterThan(2.9);
      }
    }
  });

  it('maps rack and deck colliders to their own render materials', () => {
    const archive = arenaBoxes(maps[2]);
    expect(archive.some((b) => b.material === 'rack')).toBe(true);
    expect(archive.some((b) => b.material === 'deck')).toBe(true);
    expect(arenaBoxes(maps[0]).some((b) => b.material === 'rack')).toBe(false);
  });
});
