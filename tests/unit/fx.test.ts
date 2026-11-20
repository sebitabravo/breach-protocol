import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FxPool } from '../../src/render/fx';

function attrs(scene: THREE.Scene, type: 'LineSegments' | 'Points') {
  const obj = scene.children.find((c) => c.type === type) as THREE.LineSegments | THREE.Points;
  return {
    pos: obj.geometry.getAttribute('position') as THREE.BufferAttribute,
    col: obj.geometry.getAttribute('color') as THREE.BufferAttribute,
  };
}

describe('FxPool GPU upload flags', () => {
  it('re-uploads spark buffers on update so sparks animate instead of freezing', () => {
    const scene = new THREE.Scene();
    const fx = new FxPool(scene, 64);
    fx.impact(new THREE.Vector3(0, 1, 0), 0xffffff);
    const { pos, col } = attrs(scene, 'Points');
    const before = [pos.version, col.version];
    fx.update(1 / 60);
    expect(pos.version).toBeGreaterThan(before[0]);
    expect(col.version).toBeGreaterThan(before[1]);
  });

  it('re-uploads tracer colours while they fade', () => {
    const scene = new THREE.Scene();
    const fx = new FxPool(scene, 64);
    fx.tracer(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5));
    const { col } = attrs(scene, 'LineSegments');
    const before = col.version;
    fx.update(0.02);
    expect(col.version).toBeGreaterThan(before);
  });

  it('does not upload when nothing is alive', () => {
    const scene = new THREE.Scene();
    const fx = new FxPool(scene, 64);
    const { pos } = attrs(scene, 'Points');
    const before = pos.version;
    fx.update(1 / 60);
    expect(pos.version).toBe(before);
  });
});
