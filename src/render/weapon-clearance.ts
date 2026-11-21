import type { Vector3 } from 'three';
import type { Solid } from '../world/map';

export const TUCK_START = 1.35;
export const TUCK_FULL = 0.42;

/** First hit of a short, normalized aim ray against the simulation's solid AABBs. */
export function weaponObstruction(solids: readonly Solid[], origin: Vector3, aim: Vector3): number {
  let nearest = TUCK_START;
  for (const solid of solids) {
    let enter = 0, exit = nearest;
    for (let axis = 0; axis < 3; axis++) {
      const o = origin.getComponent(axis), d = aim.getComponent(axis);
      const lo = solid.min[axis], hi = solid.max[axis];
      if (Math.abs(d) < 1e-8) {
        if (o < lo || o > hi) { enter = Infinity; break; }
        continue;
      }
      const a = (lo - o) / d, b = (hi - o) / d;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) break;
    }
    if (enter <= exit) nearest = enter;
  }
  const t = Math.min(1, (TUCK_START - nearest) / (TUCK_START - TUCK_FULL));
  return t * t * (3 - 2 * t);
}
