import { describe, expect, it } from 'vitest';
import { damageBearing } from '../../src/core/bearing';

const origin = { x: 0, z: 0 };
const close = (actual: number, expected: number): void => {
  expect(actual).toBeCloseTo(expected, 9);
};

describe('damageBearing', () => {
  it('is zero when the source is straight ahead of a player facing -Z', () => {
    close(damageBearing(0, origin, { x: 0, z: -10 }), 0);
  });

  it('is pi when the source is directly behind', () => {
    close(Math.abs(damageBearing(0, origin, { x: 0, z: 10 })), Math.PI);
  });

  it('is positive to the right and negative to the left at yaw zero', () => {
    close(damageBearing(0, origin, { x: 5, z: 0 }), Math.PI / 2);
    close(damageBearing(0, origin, { x: -5, z: 0 }), -Math.PI / 2);
  });

  it('turns with the player: a source that was behind becomes ahead after a half turn', () => {
    close(damageBearing(Math.PI, origin, { x: 0, z: 10 }), 0);
  });

  it('follows the camera right vector after a quarter turn', () => {
    // Con yaw = π/2 el frente es (-1, 0): la fuente en (0, -4) queda a la derecha.
    close(damageBearing(Math.PI / 2, origin, { x: 0, z: -4 }), Math.PI / 2);
  });

  it('measures from the player position, not from the world origin', () => {
    close(damageBearing(0, { x: 20, z: 3 }, { x: 20, z: -7 }), 0);
  });

  it('returns zero for a source exactly on the player instead of a NaN', () => {
    expect(damageBearing(1.2, origin, origin)).toBe(0);
  });
});
