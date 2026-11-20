import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRobotMesh, disposeRobotAssets } from '../../src/render/entities';

describe('robot assets', () => {
  it('shares geometry and materials between robots of the same kind', () => {
    const a = createRobotMesh(0);
    const b = createRobotMesh(0);
    expect(a.geometry).toBe(b.geometry);
    expect(a.material).toBe(b.material);
    expect((a.children[0] as THREE.Mesh).geometry).toBe((b.children[0] as THREE.Mesh).geometry);
  });

  it('keeps kinds separate', () => {
    expect(createRobotMesh(0).geometry).not.toBe(createRobotMesh(1).geometry);
  });

  it('disposeRobotAssets releases visor assets too and allows rebuilding', () => {
    const mesh = createRobotMesh(1);
    const visor = mesh.children[0] as THREE.Mesh;
    let disposed = 0;
    mesh.geometry.addEventListener('dispose', () => (disposed += 1));
    visor.geometry.addEventListener('dispose', () => (disposed += 1));
    (visor.material as THREE.Material).addEventListener('dispose', () => (disposed += 1));
    disposeRobotAssets();
    expect(disposed).toBe(3);
    expect(createRobotMesh(1).geometry).not.toBe(mesh.geometry);
  });
});
