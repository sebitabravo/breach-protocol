import { describe, expect, it } from 'vitest';
import {
  ARENA_BOXES,
  ARENA_HALF,
  NODES,
  PLAYER_START,
  SPAWNS,
  colliderData,
  nodeData,
  spawnData,
} from '../../src/world/layout';

interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  material: string;
}

function solidBoxes(): Box[] {
  return ARENA_BOXES.filter((b) => b.solid !== false).map((b) => ({
    minX: b.x - b.sx / 2,
    minY: b.y - b.sy / 2,
    minZ: b.z - b.sz / 2,
    maxX: b.x + b.sx / 2,
    maxY: b.y + b.sy / 2,
    maxZ: b.z + b.sz / 2,
    material: b.material,
  }));
}

describe('SECTOR_01 layout', () => {
  it('colliderData packs 7 floats per solid box', () => {
    const data = colliderData();
    const solidCount = ARENA_BOXES.filter((b) => b.solid !== false).length;
    expect(data.length % 7).toBe(0);
    expect(data.length).toBe(solidCount * 7);
    expect(solidCount).toBeGreaterThan(0);
  });

  it('contains only solid boxes (visual-only geometry never collides)', () => {
    const solid = ARENA_BOXES.filter((b) => b.solid !== false);
    const visual = ARENA_BOXES.filter((b) => b.solid === false);
    expect(visual.length).toBeGreaterThan(0); // lamps/trim must exist and stay visual
    for (const box of solid) {
      expect(box.material).not.toBe('glow');
      expect(box.material).not.toBe('ceiling');
    }
    expect(solid.some((b) => b.material === 'floor')).toBe(true);
    expect(solid.filter((b) => b.material === 'wall').length).toBeGreaterThanOrEqual(4);
  });

  it('min < max on every axis for every collider', () => {
    const data = colliderData();
    for (let o = 0; o < data.length; o += 7) {
      expect(data[o]).toBeLessThan(data[o + 3]); // x
      expect(data[o + 1]).toBeLessThan(data[o + 4]); // y
      expect(data[o + 2]).toBeLessThan(data[o + 5]); // z
    }
  });

  it('no two solid boxes overlap (touching faces allowed)', () => {
    // The four perimeter walls deliberately interlock at the corners to seal
    // the arena, so pairs of perimeter walls are excluded; everything else
    // must be disjoint (AABB, strict inequalities treat touching as free).
    const boxes = solidBoxes();
    const isPerimeter = (b: Box): boolean => b.material === 'wall' && (b.maxX - b.minX > 20 || b.maxZ - b.minZ > 20);
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (isPerimeter(a) && isPerimeter(b)) continue;
        const overlaps =
          a.minX < b.maxX &&
          b.minX < a.maxX &&
          a.minY < b.maxY &&
          b.minY < a.maxY &&
          a.minZ < b.maxZ &&
          b.minZ < a.maxZ;
        if (overlaps) {
          throw new Error(
            `solid boxes ${i} (${a.material}) and ${j} (${b.material}) overlap`,
          );
        }
      }
    }
  });

  it('the floor spans the whole arena', () => {
    const data = colliderData();
    const floor = Array.from({ length: data.length / 7 }, (_, i) => i * 7).filter(
      (o) => data[o + 6] === 1,
    );
    expect(floor).toHaveLength(1);
    const o = floor[0];
    expect(data[o]).toBeLessThanOrEqual(-ARENA_HALF);
    expect(data[o + 3]).toBeGreaterThanOrEqual(ARENA_HALF);
  });

  it('nodeData has one (x, z) pair per terminal', () => {
    const data = nodeData();
    expect(data.length).toBe(NODES.length * 2);
    NODES.forEach((node, i) => {
      expect(data[i * 2]).toBeCloseTo(node.x, 5);
      expect(data[i * 2 + 1]).toBeCloseTo(node.z, 5);
    });
  });

  it('spawnData has one (x, z) pair per spawn point', () => {
    const data = spawnData();
    expect(data.length).toBe(SPAWNS.length * 2);
    SPAWNS.forEach((spawn, i) => {
      expect(data[i * 2]).toBeCloseTo(spawn[0], 5);
      expect(data[i * 2 + 1]).toBeCloseTo(spawn[1], 5);
    });
  });

  it('terminal positions sit inside the arena bounds and outside blocking geometry', () => {
    expect(NODES).toHaveLength(3);
    for (const node of NODES) {
      expect(Math.abs(node.x)).toBeLessThan(ARENA_HALF);
      expect(Math.abs(node.z)).toBeLessThan(ARENA_HALF);
      // A terminal may rest on its own 'trim' plinth and always stands on the
      // floor, but never inside a wall, cover mass, pillar or crate.
      for (const box of solidBoxes()) {
        if (box.material === 'trim' || box.material === 'floor') continue;
        const inside =
          node.x > box.minX &&
          node.x < box.maxX &&
          node.z > box.minZ &&
          node.z < box.maxZ &&
          box.minY < 1.2; // interaction height above the feet
        expect(inside).toBe(false);
      }
    }
  });

  it('every spawn point is unique and inside the arena bounds', () => {
    const keys = SPAWNS.map(([x, z]) => `${x},${z}`);
    expect(new Set(keys).size).toBe(SPAWNS.length);
    for (const [x, z] of SPAWNS) {
      expect(Math.abs(x)).toBeLessThan(ARENA_HALF);
      expect(Math.abs(z)).toBeLessThan(ARENA_HALF);
    }
  });

  // BUG (fixed in src/world/layout.ts): SPAWNS[0] was (0, 14.5), only 1.5 m
  // from PLAYER_START = (0, 13); the fairness rule requires ≥ 9 m.
  it('every spawn point is at least 9 m from PLAYER_START', () => {
    for (const [x, z] of SPAWNS) {
      const dx = x - PLAYER_START.x;
      const dz = z - PLAYER_START.z;
      const distance = Math.hypot(dx, dz);
      expect(distance).toBeGreaterThanOrEqual(9);
    }
  });
});
