import { describe, expect, it } from 'vitest';
import { PoseInterpolator, type Pose } from '../../src/render/interp';

const pose = (x: number, yaw = 0): Pose => ({ px: x, py: 0, pz: 0, yaw, pitch: 0 });

describe('PoseInterpolator', () => {
  it('snaps on the first sample', () => {
    const it0 = new PoseInterpolator();
    expect(it0.sample(pose(5), 1, 0.5).px).toBe(5);
  });

  it('interpolates between the previous tick and the current tick', () => {
    const i = new PoseInterpolator();
    i.sample(pose(0), 1, 0);
    expect(i.sample(pose(10), 2, 0.5).px).toBe(5);
  });

  it('keeps advancing across frames without a new tick instead of re-anchoring', () => {
    const i = new PoseInterpolator();
    i.sample(pose(0), 1, 0);
    i.sample(pose(10), 2, 0.25);
    expect(i.sample(pose(10), 2, 0.75).px).toBe(7.5);
  });

  it('snaps when the tick counter goes backwards (reset)', () => {
    const i = new PoseInterpolator();
    i.sample(pose(0), 50, 0);
    i.sample(pose(10), 51, 0.5);
    expect(i.sample(pose(1), 0, 0.5).px).toBe(1);
  });

  it('takes the shortest arc for yaw across the pi boundary', () => {
    const i = new PoseInterpolator();
    i.sample(pose(0, Math.PI - 0.1), 1, 0);
    const yaw = i.sample(pose(0, -Math.PI + 0.1), 2, 0.5).yaw;
    expect(Math.abs(Math.abs(yaw) - Math.PI)).toBeLessThan(1e-9);
  });

  it('clamps alpha to [0, 1]', () => {
    const i = new PoseInterpolator();
    i.sample(pose(0), 1, 0);
    expect(i.sample(pose(10), 2, 3).px).toBe(10);
  });
});
