import { describe, expect, it } from 'vitest';
import { PoseInterpolator, type Pose } from '../../src/render/interp';

const pose = (x: number): Pose => ({ px: x, py: 0, pz: 0, yaw: 0, pitch: 0 });

describe('PoseInterpolator.sampleInto', () => {
  it('writes into the caller object and returns it, without a new pose', () => {
    const i = new PoseInterpolator();
    const out = pose(0);
    i.sampleInto(pose(0), 1, 0, out);
    const returned = i.sampleInto(pose(10), 2, 0.5, out);
    expect(returned).toBe(out);
    expect(out.px).toBe(5);
  });

  it('agrees with sample() across ticks and frames', () => {
    const a = new PoseInterpolator();
    const b = new PoseInterpolator();
    const out = pose(0);
    const script: [number, number, number][] = [
      [0, 1, 0],
      [10, 2, 0.25],
      [10, 2, 0.75],
      [20, 3, 0.5],
    ];
    for (const [x, tick, alpha] of script) {
      const expected = a.sample(pose(x), tick, alpha);
      const got = b.sampleInto(pose(x), tick, alpha, out);
      expect(got.px).toBeCloseTo(expected.px, 12);
    }
  });

  it('snaps again after reset()', () => {
    const i = new PoseInterpolator();
    const out = pose(0);
    i.sampleInto(pose(0), 5, 0, out);
    i.reset();
    expect(i.sampleInto(pose(7), 1, 0.5, out).px).toBe(7);
  });
});
