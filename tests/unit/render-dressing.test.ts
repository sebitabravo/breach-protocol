import { describe, expect, it } from 'vitest';
import { FACE } from '../../src/render/geometry';
import { RAIL_TOP, dressingFor, catwalkRail, serverPanels, towerRings, ventsAlong, pipesAlong } from '../../src/render/dressing';
import { lookFor } from '../../src/render/themes';
import { perimeterFaces } from '../../src/render/walls';
import type { MapData, ThemeName } from '../../src/world/map';

function room(theme: ThemeName, extra: MapData['solids'], halfX = 18, halfZ = 18): MapData {
  return {
    id: theme === 'control' ? 0 : theme === 'cryo' ? 1 : 2,
    theme,
    mutator: 'none',
    start: { x: 0, z: 13, yaw: 0 },
    halfX,
    halfZ,
    solids: [
      { min: [-halfX, -1, -halfZ], max: [halfX, 0, halfZ], kind: 1 },
      { min: [-halfX, 0, -halfZ], max: [halfX, 6, -halfZ + 1], kind: 0 },
      { min: [-halfX, 0, halfZ - 1], max: [halfX, 6, halfZ], kind: 0 },
      { min: [-halfX, 0, -halfZ], max: [-halfX + 1, 6, halfZ], kind: 0 },
      { min: [halfX - 1, 0, -halfZ], max: [halfX, 6, halfZ], kind: 0 },
      ...extra,
    ],
    nodes: [],
    spawns: [],
  };
}

describe('pipes and vents', () => {
  const face = perimeterFaces(room('control', []))[0];

  it('places three runs of pipe and tray inside the room, close to the wall', () => {
    const boxes = pipesAlong(face, 6);
    expect(boxes).toHaveLength(3);
    for (const b of boxes) {
      const normal = face.axis === 'x' ? b.x : b.z;
      const distance = (normal - face.at) * face.dir;
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(1);
    }
  });

  it('repeats vents about every 4.5 m along the wall, four boxes each', () => {
    const boxes = ventsAlong(face);
    expect(boxes).toHaveLength(8 * 4);
    expect(boxes.every((b) => b.role === 'lit')).toBe(true);
  });
});

describe('cryo tower rings', () => {
  it('wraps every full-height pillar in two dark bands and one glowing ring', () => {
    const pillars = [0, 1, 2].map((i) => ({ min: [i * 5, 0, 0] as [number, number, number], max: [i * 5 + 2, 7, 2] as [number, number, number], kind: 3 }));
    const map = room('cryo', pillars);
    const rings = towerRings(map, lookFor('cryo'));
    expect(rings.filter((r) => r.role === 'lit')).toHaveLength(3 * 8);
    expect(rings.filter((r) => r.role === 'glow')).toHaveLength(3 * 4);
  });

  it('only appears on the cryo sector', () => {
    const pillar = { min: [0, 0, 0] as [number, number, number], max: [2, 7, 2] as [number, number, number], kind: 3 };
    expect(dressingFor(room('cryo', [pillar]), lookFor('cryo'), 7).some((d) => d.role === 'glow')).toBe(true);
    expect(dressingFor(room('control', [pillar]), lookFor('control'), 6).some((d) => d.role === 'glow')).toBe(false);
  });
});

describe('archive server racks and catwalk', () => {
  const rack = { min: [-14.8, 0, -12] as [number, number, number], max: [-12.2, 2.6, -2.5] as [number, number, number], kind: 6 };
  const deck = { min: [-17.8, 2.5, -17.8] as [number, number, number], max: [17.8, 2.8, -14.8] as [number, number, number], kind: 7 };

  it('puts a panel and LED grid on each long face of a rack, one face per LED', () => {
    const boxes = serverPanels(rack, lookFor('archive'), 1);
    const panels = boxes.filter((b) => b.role === 'lit');
    const leds = boxes.filter((b) => b.role === 'led');
    expect(panels).toHaveLength(2);
    expect(leds.length).toBeGreaterThan(200);
    expect(leds.every((l) => l.faces === FACE.posX || l.faces === FACE.negX)).toBe(true);
  });

  it('gives every LED a blink phase in (0, 1) and varies them', () => {
    const leds = serverPanels(rack, lookFor('archive'), 1).filter((b) => b.role === 'led');
    const phases = leds.map((l) => l.blink ?? 0);
    expect(phases.every((p) => p > 0 && p < 1)).toBe(true);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBeGreaterThan(leds.length / 2);
  });

  it('builds the catwalk rail on the edge facing the sector centre', () => {
    const boxes = catwalkRail(deck, lookFor('archive'));
    const rail = boxes[0];
    // The rail's top edge reaches the player-derived guard height (was: the
    // authored deck.max[1] + 0.6 constant; the semantic is now the derived one).
    expect(rail.y + rail.sy / 2).toBeCloseTo(deck.max[1] + RAIL_TOP, 2);
    expect(rail.z).toBeGreaterThan(deck.max[2]);
    expect(rail.z).toBeLessThan(0);
    expect(boxes.some((b) => b.role === 'glow')).toBe(true);
  });

  it('only shows racks and the rail on the archive sector', () => {
    const map = room('archive', [rack, deck]);
    const boxes = dressingFor(map, lookFor('archive'), 6);
    expect(boxes.some((b) => b.role === 'led')).toBe(true);
    const control = dressingFor(room('control', [rack, deck]), lookFor('control'), 6);
    expect(control.some((b) => b.role === 'led')).toBe(false);
  });
});

describe('dressingFor determinism', () => {
  it('returns the same boxes for the same map (no Math.random)', () => {
    const map = room('archive', [{ min: [-14.8, 0, -12], max: [-12.2, 2.6, -2.5], kind: 6 }]);
    const a = JSON.stringify(dressingFor(map, lookFor('archive'), 6));
    const b = JSON.stringify(dressingFor(map, lookFor('archive'), 6));
    expect(a).toBe(b);
  });

  it('includes the catwalk rail in the archive dressing', () => {
    const deck = { min: [-17.8, 2.5, -17.8] as [number, number, number], max: [17.8, 2.8, -14.8] as [number, number, number], kind: 7 };
    // The guard bar exists at the derived height through the composed dressing
    // (was: an exact authored box at deck.max[1] + 0.6; now the derived contract).
    const walk = deck.max[1];
    expect(dressingFor(room('archive', [deck]), lookFor('archive'), 6)
      .some((b) => Math.abs(b.y + b.sy / 2 - (walk + RAIL_TOP)) < 1e-6)).toBe(true);
  });
});
