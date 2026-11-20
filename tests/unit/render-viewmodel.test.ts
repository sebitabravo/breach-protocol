import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/wasm/bridge';
import { Viewmodel } from '../../src/render/viewmodel';
import { WEAPON } from '../../src/wasm/protocol';

interface Input {
  weapon: number;
  ads?: number;
  recoilPitch?: number;
  reloading?: boolean;
  reloadProgress?: number;
}

function fakeState(input: Input): Snapshot {
  return {
    weapon: input.weapon,
    ads: input.ads ?? 0,
    recoilPitch: input.recoilPitch ?? 0,
    reloading: input.reloading ?? false,
    reloadProgress: input.reloadProgress ?? 0,
  } as unknown as Snapshot;
}

/** Cámara en el origen mirando a -z, como en el renderer; los viewmodels cuelgan de ella. */
function rig() {
  const camera = new THREE.Object3D();
  camera.updateMatrixWorld(true);
  const vm = new Viewmodel(camera);
  return { camera, vm };
}

/** Vértices del cuerpo lit del arma equipada, en espacio de cámara. */
function bodyVertices(camera: THREE.Object3D): THREE.Vector3[] {
  const root = camera.children.find((c) => c.visible) as THREE.Group;
  const out: THREE.Vector3[] = [];
  const mesh = root.children[0] as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    out.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld));
  }
  return out;
}

describe('Viewmodel', () => {
  it('shows only the equipped weapon and switches when the snapshot changes', () => {
    const { camera, vm } = rig();
    vm.update(fakeState({ weapon: WEAPON.sidearm }), 0.016, 0);
    const visible = () => camera.children.filter((c) => c.visible).length;
    expect(visible()).toBe(1);
    vm.update(fakeState({ weapon: WEAPON.shotgun }), 0.016, 0);
    expect(visible()).toBe(1);
    expect(camera.children.find((c) => c.visible)?.children).toHaveLength(2);
  });

  it('keeps each weapon fully inside a 75° vertical frustum at hip pose, with a margin', () => {
    // 0.74 < tan(37.5°) ≈ 0.767: margen para que el borde inferior no toque el marco
    const tanHalf = 0.74;
    for (const weapon of [WEAPON.sidearm, WEAPON.carbine, WEAPON.shotgun]) {
      const { camera, vm } = rig();
      vm.update(fakeState({ weapon }), 0.016, 0);
      for (const v of bodyVertices(camera)) {
        const depth = -v.z;
        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(v.y) / depth).toBeLessThan(tanHalf);
      }
    }
  });

  it('lowers the weapon while reloading and returns it at the end', () => {
    const { camera, vm } = rig();
    vm.update(fakeState({ weapon: WEAPON.carbine }), 0.016, 0);
    const restY = (camera.children.find((c) => c.visible) as THREE.Group).position.y;
    vm.update(fakeState({ weapon: WEAPON.carbine, reloading: true, reloadProgress: 0.5 }), 0.016, 0);
    const midY = (camera.children.find((c) => c.visible) as THREE.Group).position.y;
    expect(midY).toBeLessThan(restY);
    vm.update(fakeState({ weapon: WEAPON.carbine, reloading: false, reloadProgress: 0 }), 0.016, 0);
    const endY = (camera.children.find((c) => c.visible) as THREE.Group).position.y;
    expect(endY).toBeCloseTo(restY, 6);
  });

  it('sizes the muzzle flash per weapon, the shotgun largest', () => {
    const { vm } = rig();
    const side = vm.flashSize(WEAPON.sidearm);
    const carbine = vm.flashSize(WEAPON.carbine);
    const shotgun = vm.flashSize(WEAPON.shotgun);
    expect(carbine).toBeGreaterThan(side);
    expect(shotgun).toBeGreaterThan(carbine * 1.5);
  });

  it('places the muzzle in world space after the recoil pose is applied', () => {
    const { camera, vm } = rig();
    vm.update(fakeState({ weapon: WEAPON.shotgun, recoilPitch: 0.05 }), 0.016, 0);
    const out = vm.muzzleWorld(WEAPON.shotgun, new THREE.Vector3());
    const cam = camera.children.find((c) => c.visible) as THREE.Group;
    const expected = new THREE.Vector3(0, 0.05, -0.62).applyMatrix4(cam.matrixWorld);
    expect(out.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
