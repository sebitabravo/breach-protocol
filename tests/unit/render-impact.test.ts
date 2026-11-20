import { describe, expect, it } from 'vitest';
import { impactColour, type SurfaceSolid } from '../../src/render/fx';
import { SOLID_KIND } from '../../src/world/map';

const solids: SurfaceSolid[] = [
  { min: [-18, 0, -18], max: [-17, 6, 18], kind: SOLID_KIND.wall },
  { min: [-4, 0, 4], max: [-2, 1, 6], kind: SOLID_KIND.crate },
  { min: [6, 0, 6], max: [8, 1.2, 8], kind: SOLID_KIND.plinth },
];

describe('impactColour', () => {
  it('colours a hit on a crate face amber', () => {
    expect(impactColour(solids, -3, 0.5, 4)).toBe(0xffb35c);
  });

  it('colours a hit on the perimeter wall pale steel', () => {
    expect(impactColour(solids, -17, 3, 0)).toBe(0x96aaba);
  });

  it('colours a hit on a terminal plinth mint', () => {
    expect(impactColour(solids, 7, 1.2, 7)).toBe(0x5ce08b);
  });

  it('tolerates a point a few millimetres off the face', () => {
    expect(impactColour(solids, -3, 1.02, 5)).toBe(0xffb35c);
  });

  it('falls back to the default for a point in open air', () => {
    expect(impactColour(solids, 0, 3, 0)).toBe(0x96aaba);
  });
});
