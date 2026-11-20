import { describe, expect, it } from 'vitest';
import { materialOfKind, parseMapData, SOLID_KIND } from '../../src/world/map';

function table(): Float32Array {
  const header = new Array(16).fill(0);
  header[0] = 1; // cryo
  header[1] = 1; // un sólido
  header[2] = 1; // una terminal
  header[3] = 1; // un spawn
  header.splice(4, 6, 2, 3, 0.5, 30, 16, 1);
  return new Float32Array([...header, -1, 0, -1, 1, 2, 1, 5, 4, 0.5, -3, 7, 8]);
}

describe('parseMapData', () => {
  it('reads header, solids, nodes and spawns', () => {
    const map = parseMapData(table());
    expect(map.id).toBe(1);
    expect(map.theme).toBe('cryo');
    expect(map.start).toEqual({ x: 2, z: 3, yaw: 0.5 });
    expect(map.halfX).toBe(30);
    expect(map.solids[0]).toEqual({ min: [-1, 0, -1], max: [1, 2, 1], kind: 5 });
    expect(map.nodes[0]).toEqual({ x: 4, y: 0.5, z: -3 });
    expect(map.spawns[0]).toEqual({ x: 7, z: 8 });
  });

  it('rejects truncated tables and unknown themes', () => {
    expect(() => parseMapData(new Float32Array(4))).toThrow();
    expect(() => parseMapData(table().subarray(0, 20))).toThrow(/inconsistente/);
    const bad = table();
    bad[0] = 9;
    expect(() => parseMapData(bad)).toThrow(/tema/);
  });
});

describe('materialOfKind', () => {
  it('maps collider kinds to render materials', () => {
    expect(materialOfKind(SOLID_KIND.rack)).toBe('rack');
    expect(materialOfKind(SOLID_KIND.plinth)).toBe('trim');
    expect(materialOfKind(SOLID_KIND.floor)).toBe('floor');
    expect(materialOfKind(99)).toBe('wall');
  });
});
