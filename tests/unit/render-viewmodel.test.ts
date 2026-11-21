import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/wasm/bridge';
import { CAMERA_FOV, fitModel, VIEW_FOV, VIEW_NEAR, Viewmodel } from '../../src/render/viewmodel';
import { TUCK_FULL, TUCK_START, weaponObstruction } from '../../src/render/weapon-clearance';
import { addHardware, profileWeapon } from '../../src/render/weapon-hardware';
import { WEAPON } from '../../src/wasm/protocol';
import type { Solid } from '../../src/world/map';

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
  it.each([
    ['blaster', new THREE.Vector3(0, 0.45, 0.9), 0.08],
    ['blaster-repeater', new THREE.Vector3(0.2, 0.45, 1.18), 0.04],
  ] as const)('puts the %s socket inside one actual barrel, with a clear path through its aperture', async (file, tip, boreRadius) => {
    const bytes = readFileSync(new URL(`../../public/assets/models/${file}.glb`, import.meta.url));
    const loader = new GLTFLoader().register(() => ({ name: 'unit-test-texture', loadTexture: async () => new THREE.Texture() }));
    const data = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(data).set(bytes);
    const { scene: model } = await loader.parseAsync(data, '');
    // fitModel uses asset coordinates: +Z points out of the bore before the fit.
    profileWeapon(model);
    const muzzle = fitModel(model, 0.78, file);
    expect(model.scale.x / model.scale.z).toBeCloseTo(0.8);
    model.updateMatrixWorld(true);
    const inAsset = model.worldToLocal(muzzle.position.clone());
    const bore = new THREE.Box3(tip.clone().addScalar(-boreRadius), tip.clone().add(new THREE.Vector3(boreRadius, boreRadius, 0)));
    expect(bore.containsPoint(inAsset)).toBe(true);
    expect(inAsset.x).toBeCloseTo(tip.x);
    expect(inAsset.y).toBeCloseTo(tip.y);
    const ray = new THREE.Raycaster(muzzle.position, new THREE.Vector3(0, 0, -1), 0, 0.08);
    for (const child of model.children) child.traverse((obj) => {
      if (obj instanceof THREE.Mesh) obj.material.side = THREE.DoubleSide;
    });
    expect(ray.intersectObject(model)).toHaveLength(0);

    const carrier = new THREE.Group();
    addHardware(carrier, model.matrix, inAsset.toArray(), file === 'blaster',
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), new THREE.MeshBasicMaterial());
    carrier.updateMatrixWorld(true);
    expect(ray.intersectObject(carrier)).toHaveLength(0);
  });

  it('ships three authored silhouettes with open bores and a bounded geometry budget', () => {
    const { camera, vm } = rig();
    let total = 0;
    const lengths: number[] = [];
    for (const weapon of [WEAPON.sidearm, WEAPON.carbine, WEAPON.shotgun]) {
      vm.update(fakeState({ weapon }), 1 / 60, 0);
      const root = camera.children.find((child) => child.visible)!;
      expect(root.name).toMatch(/^(PB-01|AR-04|SG-08)$/);
      expect(root.getObjectByName('action')).toBeInstanceOf(THREE.Mesh);
      let draws = 0;
      root.traverse((part) => {
        if (!(part instanceof THREE.Mesh)) return;
        draws++;
        total += (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3;
        expect(part.castShadow).toBe(false);
      });
      expect(draws).toBeLessThanOrEqual(8);
      const muzzle = vm.muzzleSocket(weapon)!;
      lengths.push(-muzzle.position.z);
      const direction = new THREE.Vector3(0, 0, -1).transformDirection(muzzle.matrixWorld);
      const ray = new THREE.Raycaster(muzzle.getWorldPosition(new THREE.Vector3()).addScaledVector(direction, -0.007), direction, 0, 0.075);
      expect(ray.intersectObject(root)).toEqual([]);
    }
    expect(total).toBeLessThanOrEqual(25_000);
    expect(lengths[0] / lengths[1]).toBeCloseTo(0.55, 1);
    expect(lengths[2]).toBeLessThan(lengths[1]);
    vm.dispose();
  });

  it('cycles each action on fire, cools the muzzle and brightens the carbine dot only in ADS', () => {
    const { camera, vm } = rig();
    for (const weapon of [WEAPON.sidearm, WEAPON.shotgun, WEAPON.carbine]) {
      const hip = fakeState({ weapon });
      vm.update(hip, 1 / 60, 0);
      const root = camera.children.find((child) => child.visible)!;
      const action = root.getObjectByName('action')!;
      const heat = root.getObjectByName('heat') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const muzzle = vm.muzzleWorld(weapon, new THREE.Vector3());
      expect(action.position.z).toBe(0);
      expect(heat.material.emissiveIntensity).toBe(0);
      vm.fire(weapon);
      expect(action.position.z).toBeGreaterThan(0);
      expect(heat.material.emissiveIntensity).toBeGreaterThan(0);
      expect(vm.muzzleWorld(weapon, new THREE.Vector3())).toEqual(muzzle);
      vm.update(hip, 1, 0);
      expect(action.position.z).toBe(0);
      expect(heat.material.emissiveIntensity).toBeLessThan(0.01);
    }
    const dot = camera.getObjectByName('dot') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const hipGreen = dot.material.color.g;
    vm.update(fakeState({ weapon: WEAPON.carbine, ads: 1 }), 0.1, 0);
    expect(dot.material.color.g).toBeGreaterThan(hipGreen * 2);
    vm.dispose();
  });

  it('shows only the equipped weapon and switches when the snapshot changes', () => {
    const { camera, vm } = rig();
    vm.update(fakeState({ weapon: WEAPON.sidearm }), 0.016, 0);
    const visible = () => camera.children.filter((c) => c.visible).length;
    expect(visible()).toBe(1);
    vm.update(fakeState({ weapon: WEAPON.shotgun }), 0.016, 0);
    expect(visible()).toBe(1);
    expect(camera.children.find((c) => c.visible)?.name).toBe('SG-08');
  });

  it('keeps each weapon fully inside the foreground vertical frustum at hip pose, with a margin', () => {
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(VIEW_FOV / 2)) * 0.96;
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

  it('blends only the nearest surface actually in the short aim ray', () => {
    const origin = new THREE.Vector3();
    const aim = new THREE.Vector3(0, 0, -1);
    const wall = (d: number, x = -1): Solid => ({ min: [x, -1, -d - 0.2], max: [x + 2, 1, -d], kind: 0 });
    expect(weaponObstruction([wall(TUCK_START), wall(0.3, 0.1), wall(-0.4)], origin, aim)).toBe(0);
    const half = wall((TUCK_START + TUCK_FULL) * 0.5);
    expect(weaponObstruction([half, wall(TUCK_START - 0.01)], origin, aim)).toBeCloseTo(0.5);
    expect(weaponObstruction([half, wall(TUCK_FULL)], origin, aim)).toBe(1);
    expect(weaponObstruction([wall(-0.1)], origin, aim)).toBe(1);
  });

  it('smoothly retracts and lowers, then restores the weapon, including with ADS and recoil', () => {
    const { camera, vm } = rig();
    const state = fakeState({ weapon: WEAPON.carbine, ads: 1, recoilPitch: 0.1, reloading: true, reloadProgress: 0.5 });
    vm.update(state, 1, 0);
    const root = camera.children.find((c) => c.visible)!;
    const rest = root.position.clone();
    vm.update(state, 1 / 60, 0, 1);
    const first = root.position.clone();
    vm.update(state, 1, 0, 1);
    expect(first.z).toBeGreaterThan(rest.z);
    expect(root.position.z).toBeGreaterThan(first.z);
    expect(root.position.y).toBeLessThan(rest.y);
    for (const vertex of bodyVertices(camera)) expect(-vertex.z).toBeGreaterThan(VIEW_NEAR + 0.05);
    vm.update(state, 2, 0, 0);
    expect(root.position.distanceTo(rest)).toBeLessThan(1e-6);
    vm.dispose();
  });

  it('keeps the world tracer origin on the foreground muzzle pixel across both lenses', () => {
    const world = new THREE.PerspectiveCamera(CAMERA_FOV, 16 / 9, 0.05, 120);
    const camera = new THREE.PerspectiveCamera(VIEW_FOV, 16 / 9, VIEW_NEAR, 12);
    world.position.set(8, 1.62, 5);
    world.rotation.set(0.2, 1.8, -0.05);
    world.updateMatrixWorld();
    camera.position.copy(world.position);
    camera.quaternion.copy(world.quaternion);
    camera.updateMatrixWorld();
    const ratio = camera.projectionMatrix.elements[5] / world.projectionMatrix.elements[5];
    const correction = world.matrixWorld.clone().multiply(new THREE.Matrix4().makeScale(ratio, ratio, 1)).multiply(camera.matrixWorldInverse);
    const vm = new Viewmodel(camera);
    vm.update(fakeState({ weapon: WEAPON.carbine, recoilPitch: 0.05 }), 1 / 60, 0.02, 0.7, correction);
    const viewPixel = vm.muzzleSocket(WEAPON.carbine)!.getWorldPosition(new THREE.Vector3()).project(camera);
    const worldPixel = vm.muzzleWorld(WEAPON.carbine, new THREE.Vector3()).project(world);
    expect(worldPixel.x).toBeCloseTo(viewPixel.x, 9);
    expect(worldPixel.y).toBeCloseTo(viewPixel.y, 9);
    vm.dispose();
  });

  it('places the muzzle in world space after the recoil pose is applied', () => {
    const { camera, vm } = rig();
    vm.update(fakeState({ weapon: WEAPON.shotgun, recoilPitch: 0.05 }), 0.016, 0);
    const out = vm.muzzleWorld(WEAPON.shotgun, new THREE.Vector3());
    const cam = camera.children.find((c) => c.visible) as THREE.Group;
    const expected = vm.muzzleSocket(WEAPON.shotgun)!.position.clone().applyMatrix4(cam.matrixWorld);
    expect(out.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
