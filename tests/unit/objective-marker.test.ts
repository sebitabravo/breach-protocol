import { describe, expect, it } from 'vitest';
import { formatObjectiveDistance, fitObjective, projectObjective, type ObjectiveProjection } from '../../src/render/objective-projection';

const viewport = { width: 1280, height: 720 };
const safe = { left: 80, top: 130, right: 1200, bottom: 590 };
const out: ObjectiveProjection = { x: 0, y: 0, angle: 0, mode: 'onscreen', edge: 'none' };

// Inputs are homogeneous clip coordinates after the camera transform.
describe('objective projection', () => {
  it('maps targets ahead to the correct side of the screen', () => {
    projectObjective(-2, 1, 4, 5, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'onscreen', x: 384, y: 288 });
    projectObjective(2, 1, 4, 5, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'onscreen', x: 896, y: 288 });
  });

  it('reports behind without mirroring the side; dead astern chooses a stable edge', () => {
    projectObjective(1, 0, -5, -5, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'behind', edge: 'right', x: 1200, y: 360, angle: 0 });
    projectObjective(0, 0, -5, -5, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'behind', edge: 'top', x: 640, y: 130, angle: -Math.PI / 2 });
  });

  it('pins a diagonal off-frustum target to the correct edge without changing its bearing', () => {
    projectObjective(4, 4, 2, 3, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'offscreen', edge: 'top', y: 130 });
    expect(out.x).toBeCloseTo(1048.89, 2);
    expect(out.angle).toBeCloseTo(Math.atan2(-360, 640), 8);
  });

  it('keeps near-edge onscreen results and offscreen results inside the safe area', () => {
    for (const x of [-10, -4.99, 0, 4.99, 10]) {
      for (const y of [-10, -4.99, 0, 4.99, 10]) {
        projectObjective(x, y, 4, 5, viewport, safe, out);
        expect(out.x).toBeGreaterThanOrEqual(safe.left);
        expect(out.x).toBeLessThanOrEqual(safe.right);
        expect(out.y).toBeGreaterThanOrEqual(safe.top);
        expect(out.y).toBeLessThanOrEqual(safe.bottom);
      }
    }
    projectObjective(-4.99, 4.99, 4, 5, viewport, safe, out);
    expect(out).toMatchObject({ mode: 'onscreen', x: 80, y: 130 });
  });

  it('keeps the objective clear of reserved HUD areas and offscreen cues on their edge', () => {
    const blocks = [{ left: 540, right: 740, top: 300, bottom: 410 }, { left: 1140, right: 1280, top: 300, bottom: 420 }];
    projectObjective(0, 0, 4, 5, viewport, safe, out);
    expect(fitObjective(out, safe, blocks, blocks.length)).toBe(true);
    expect(out).toMatchObject({ x: 640, y: 410 });
    projectObjective(10, 0, 4, 5, viewport, safe, out);
    expect(fitObjective(out, safe, blocks, blocks.length)).toBe(true);
    expect(out).toMatchObject({ edge: 'right', x: 1200, y: 300 });
  });

  it('rounds distance to whole metres and never displays negative metres', () => {
    expect(formatObjectiveDistance(17.68)).toBe('18 m');
    expect(formatObjectiveDistance(4.49)).toBe('4 m');
    expect(formatObjectiveDistance(-1)).toBe('0 m');
  });
});
