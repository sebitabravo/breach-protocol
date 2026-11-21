import { describe, expect, it } from 'vitest';
import { nextWeapon } from '../../src/input/input';

describe('nextWeapon', () => {
  it('cycles through two weapons while the shotgun is locked', () => {
    expect(nextWeapon(1, [1, 2])).toBe(2);
    expect(nextWeapon(2, [1, 2])).toBe(1);
  });

  it('skips locked weapons when the shotgun is unlocked', () => {
    expect(nextWeapon(2, [1, 2, 3])).toBe(3);
    expect(nextWeapon(3, [1, 2, 3])).toBe(1);
  });

  it('returns the first unlocked weapon when the current one is not in the list', () => {
    expect(nextWeapon(3, [1, 2])).toBe(1);
  });

  it('returns 0 when nothing is unlocked so no switch is requested', () => {
    expect(nextWeapon(1, [])).toBe(0);
  });
});

describe('touch sprint', () => {
  it('sprints only when the stick is pushed near its edge', async () => {
    const { stickSprints } = await import('../../src/input/input');
    expect(stickSprints(0, 0)).toBe(false);
    expect(stickSprints(0.5, 0.5)).toBe(false);
    expect(stickSprints(0, 0.95)).toBe(true);
    expect(stickSprints(-1, 0)).toBe(true);
  });
});
