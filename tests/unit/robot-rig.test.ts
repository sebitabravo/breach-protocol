import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ENEMY_KIND, ENEMY_STATE } from '../../src/wasm/protocol';
import { newPoseAngles, PART, PART_COUNT, poseAnglesInto, rigFor, RigSolver, type PoseInput } from '../../src/render/robot-rig';

const KINDS = [ENEMY_KIND.scout, ENEMY_KIND.sentinel, ENEMY_KIND.interceptor];

function solve(input: Partial<PoseInput> & { kind: number }): RigSolver {
  const solver = new RigSolver(input.kind);
  solver.solve({ state: ENEMY_STATE.chase, phase: 0, speed: 0, time: 0, death: 0, ...input }, new Float32Array(PART_COUNT * 16));
  return solver;
}

/** Punto de una pieza en el espacio del modelo. */
function point(solver: RigSolver, part: number, x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z).applyMatrix4(solver.partMatrix(part));
}

describe('robot rig', () => {
  it('stands each kind on the ground with its head near the simulation height', () => {
    for (const kind of KINDS) {
      const rig = rigFor(kind);
      const solver = solve({ kind });
      const foot = point(solver, PART.shinL, 0, -rig.shinLen, 0);
      const head = point(solver, PART.head, 0, 0.24, 0);
      expect(Math.abs(foot.y), `kind ${kind} foot`).toBeLessThan(0.08);
      expect(Math.abs(head.y - rig.height), `kind ${kind} head`).toBeLessThan(0.2);
    }
  });

  it('puts the head above the headshot line the simulation uses (0.78 of the height)', () => {
    for (const kind of KINDS) {
      const rig = rigFor(kind);
      const eyes = point(solve({ kind }), PART.head, 0, 0.15, 0);
      expect(eyes.y, `kind ${kind}`).toBeGreaterThan(0.78 * rig.height);
    }
  });

  it('swings the legs in opposite directions while walking and keeps them still when standing', () => {
    const angles = newPoseAngles();
    poseAnglesInto({ kind: ENEMY_KIND.scout, state: ENEMY_STATE.chase, phase: Math.PI / 2, speed: 3.5, time: 0, death: 0 }, angles);
    expect(angles.x[PART.thighL]).toBeLessThan(-0.3);
    expect(angles.x[PART.thighR]).toBeGreaterThan(0.3);
    poseAnglesInto({ kind: ENEMY_KIND.scout, state: ENEMY_STATE.chase, phase: Math.PI / 2, speed: 0, time: 0, death: 0 }, angles);
    expect(angles.x[PART.thighL]).toBeCloseTo(0, 9);
    expect(angles.x[PART.thighR]).toBeCloseTo(0, 9);
  });

  it('raises the sentinel rifle arm forward while aiming', () => {
    const rig = rigFor(ENEMY_KIND.sentinel);
    const solver = solve({ kind: ENEMY_KIND.sentinel, state: ENEMY_STATE.aim });
    const hand = point(solver, PART.foreArmR, 0, -rig.foreArmLen, 0);
    const shoulder = point(solver, PART.upperArmR, 0, 0, 0);
    expect(hand.z - shoulder.z).toBeGreaterThan(0.55);
    expect(Math.abs(hand.y - shoulder.y)).toBeLessThan(0.15);
  });

  it('collapses to the ground when dead and produces no NaN in any state', () => {
    for (const kind of KINDS) {
      const dead = solve({ kind, state: ENEMY_STATE.dead, death: 1 });
      expect(point(dead, PART.pelvis, 0, 0, 0).y, `kind ${kind}`).toBeLessThan(0.45);
      for (const state of Object.values(ENEMY_STATE)) {
        const out = new Float32Array(PART_COUNT * 16);
        new RigSolver(kind).solve({ kind, state, phase: 1.3, speed: 4, time: 2, death: 0 }, out);
        expect(out.every(Number.isFinite), `kind ${kind} state ${state}`).toBe(true);
      }
    }
  });
});

describe('robot geometry budget', () => {
  it('keeps each kind under 3000 triangles so 12 robots stay inside the frame budget', async () => {
    const { buildRobotGeometry } = await import('../../src/render/robot-rig');
    for (const kind of KINDS) {
      const geo = buildRobotGeometry(kind);
      const tris = (geo.index?.count ?? geo.getAttribute('position').count) / 3;
      expect(tris, `kind ${kind}`).toBeLessThan(3000);
    }
  });
});
