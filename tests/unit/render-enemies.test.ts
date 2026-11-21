import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/wasm/bridge';
import { MAX_ENEMIES } from '../../src/wasm/bridge';
import { buildRobotGeometry } from '../../src/render/robot-rig';
import { EnemyPool, robotLook, SENTINEL_MUZZLE, sentinelMuzzle } from '../../src/render/enemies';
import { E, ENEMY_BASE, ENEMY_KIND, ENEMY_STATE, ENEMY_STRIDE, H, SNAPSHOT_LEN } from '../../src/wasm/protocol';

interface Slot {
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  state: number;
  kind: number;
  anim?: number;
}

/** Snapshot mínimo: los slots no usados quedan `dead`, como los escribe el núcleo (EMPTY_ENEMY). */
function fakeSnapshot(slots: Slot[], player = { px: 0, py: 0, pz: 0 }): Snapshot {
  const f = new Float32Array(SNAPSHOT_LEN);
  for (let i = 0; i < MAX_ENEMIES; i += 1) f[ENEMY_BASE + i * ENEMY_STRIDE + E.state] = ENEMY_STATE.dead;
  for (const s of slots) {
    const base = ENEMY_BASE + s.slot * ENEMY_STRIDE;
    f[base + E.x] = s.x;
    f[base + E.y] = s.y;
    f[base + E.z] = s.z;
    f[base + E.yaw] = s.yaw;
    f[base + E.state] = s.state;
    f[base + E.kind] = s.kind;
    f[base + E.anim] = s.anim ?? 0;
  }
  f[H.px] = player.px;
  f[H.py] = player.py;
  f[H.pz] = player.pz;
  return { float: f, px: player.px, py: player.py, pz: player.pz } as unknown as Snapshot;
}

function meshesIn(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !(c instanceof THREE.InstancedMesh));
}

function haloIn(scene: THREE.Scene): THREE.InstancedMesh {
  const halo = scene.children.find((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  if (!halo) throw new Error('telegraph halo missing');
  return halo;
}

function laserIn(scene: THREE.Scene): THREE.LineSegments {
  const laser = scene.children.find((c): c is THREE.LineSegments => c instanceof THREE.LineSegments);
  if (!laser) throw new Error('telegraph laser missing');
  return laser;
}

describe('robotLook', () => {
  it('winds a scout up with a glow and squashes it, without a laser', () => {
    const look = robotLook(ENEMY_KIND.scout, ENEMY_STATE.aim);
    expect(look.glow).toBeGreaterThan(0);
    expect(look.squash).toBeLessThan(1);
    expect(look.laser).toBe(false);
  });

  it('lunges a scout on strike with a brighter glow than windup', () => {
    const windup = robotLook(ENEMY_KIND.scout, ENEMY_STATE.aim);
    const strike = robotLook(ENEMY_KIND.scout, ENEMY_STATE.strike);
    expect(strike.glow).toBeGreaterThan(windup.glow);
    expect(strike.squash).toBeGreaterThan(1);
  });

  it('draws a laser only for a sentinel that is aiming', () => {
    expect(robotLook(ENEMY_KIND.sentinel, ENEMY_STATE.aim).laser).toBe(true);
    expect(robotLook(ENEMY_KIND.sentinel, ENEMY_STATE.chase).laser).toBe(false);
    expect(robotLook(ENEMY_KIND.scout, ENEMY_STATE.aim).laser).toBe(false);
  });

  it('keeps the interceptor flank subtle and makes the charge a bright telegraph', () => {
    const flank = robotLook(ENEMY_KIND.interceptor, ENEMY_STATE.flank);
    const charge = robotLook(ENEMY_KIND.interceptor, ENEMY_STATE.charge);
    expect(flank.glow).toBeGreaterThan(0);
    expect(flank.glow).toBeLessThan(1);
    expect(charge.glow).toBeGreaterThan(2);
    expect(charge.lean).toBeGreaterThan(robotLook(ENEMY_KIND.interceptor, ENEMY_STATE.chase).lean);
  });

  it('gives no glow and no squash while patrolling or chasing', () => {
    for (const kind of [ENEMY_KIND.scout, ENEMY_KIND.sentinel, ENEMY_KIND.interceptor]) {
      for (const state of [ENEMY_STATE.patrol, ENEMY_STATE.chase]) {
        const look = robotLook(kind, state);
        expect(look.glow).toBe(0);
        expect(look.squash).toBe(1);
        expect(look.laser).toBe(false);
      }
    }
  });
});

describe('sentinelMuzzle', () => {
  it('places the barrel tip ahead of and above the sentinel at yaw 0, at shoulder height', () => {
    const [x, y, z] = sentinelMuzzle(10, 0, 5, 0);
    expect(x).toBeCloseTo(10 + SENTINEL_MUZZLE.x, 6);
    expect(z).toBeGreaterThan(5.7);
    expect(y).toBeGreaterThan(1.3);
    expect(y).toBeLessThan(1.9);
  });

  it('rotates the barrel offset with the sentinel yaw', () => {
    const [x, , z] = sentinelMuzzle(0, 0, 0, Math.PI / 2);
    expect(x).toBeCloseTo(SENTINEL_MUZZLE.z, 6);
    expect(z).toBeCloseTo(-SENTINEL_MUZZLE.x, 6);
  });
});

describe('robot silhouettes', () => {
  it('gives each kind its own geometry with a part index per vertex', () => {
    const geos = [0, 1, 2].map((k) => buildRobotGeometry(k));
    for (const geo of geos) {
      const part = geo.getAttribute('aPart');
      expect(part.count).toBe(geo.getAttribute('position').count);
      for (let i = 0; i < part.count; i += 1) expect(part.getX(i)).toBeGreaterThanOrEqual(0);
    }
    expect(new Set(geos).size).toBe(3);
  });

  it('gives every robot red emissive eyes', () => {
    for (const kind of [ENEMY_KIND.scout, ENEMY_KIND.sentinel, ENEMY_KIND.interceptor]) {
      const geo = buildRobotGeometry(kind);
      const blink = geo.getAttribute('aBlink');
      const color = geo.getAttribute('color');
      let red = 0;
      for (let i = 0; i < blink.count; i += 1) {
        if (blink.getX(i) > 0 && color.getX(i) > 0.9 && color.getY(i) < 0.1) red += 1;
      }
      expect(red).toBeGreaterThan(0);
    }
  });
});

describe('EnemyPool', () => {
  const camera = new THREE.PerspectiveCamera();

  it('hides dead and empty slots so no ghost stands at the origin', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    pool.update(fakeSnapshot([{ slot: 0, x: 4, y: 0, z: 2, yaw: 0, state: ENEMY_STATE.chase, kind: ENEMY_KIND.scout }]), false, camera, 0);
    expect(pool.visibleCount(ENEMY_KIND.scout)).toBe(1);
    expect(pool.visibleCount(ENEMY_KIND.sentinel)).toBe(0);
    expect(pool.visibleCount(ENEMY_KIND.interceptor)).toBe(0);
    expect(meshesIn(scene).filter((m) => m.visible)).toHaveLength(0);
    pool.dispose();
  });

  it('draws one halo per glowing robot and a laser for an aiming sentinel', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    pool.update(
      fakeSnapshot([
        { slot: 0, x: 0, y: 0, z: 0, yaw: 0, state: ENEMY_STATE.aim, kind: ENEMY_KIND.scout },
        { slot: 1, x: 6, y: 0, z: 0, yaw: 0, state: ENEMY_STATE.aim, kind: ENEMY_KIND.sentinel },
      ]),
      false,
      camera,
      0,
    );
    expect(haloIn(scene).count).toBe(2);
    const laser = laserIn(scene);
    expect(laser.visible).toBe(true);
    expect(laser.geometry.drawRange.count).toBe(2);
    pool.dispose();
  });

  it('clears the telegraph the frame the robot dies', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    const aiming = [{ slot: 0, x: 0, y: 0, z: 0, yaw: 0, state: ENEMY_STATE.aim, kind: ENEMY_KIND.sentinel }];
    pool.update(fakeSnapshot(aiming), false, camera, 0);
    pool.update(fakeSnapshot([{ ...aiming[0], state: ENEMY_STATE.dead }]), false, camera, 0);
    expect(haloIn(scene).count).toBe(0);
    expect(laserIn(scene).visible).toBe(false);
    pool.dispose();
  });

  it('caps halos at the snapshot slot count', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    const all: Slot[] = [];
    for (let i = 0; i < MAX_ENEMIES; i += 1) {
      all.push({ slot: i, x: i, y: 0, z: 0, yaw: 0, state: ENEMY_STATE.strike, kind: ENEMY_KIND.scout });
    }
    pool.update(fakeSnapshot(all), false, camera, 0);
    expect(haloIn(scene).count).toBe(MAX_ENEMIES);
    pool.dispose();
  });
});

describe('EnemyPool animation', () => {
  const camera = new THREE.PerspectiveCamera();
  const at = (x: number, state: number = ENEMY_STATE.chase) => fakeSnapshot([{ slot: 0, x, y: 0, z: 0, yaw: 0, state, kind: ENEMY_KIND.scout }]);

  it('keeps a robot that just died on screen for its fall, then removes it', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    pool.update(at(0), false, camera, 0);
    pool.update(at(0, ENEMY_STATE.dead), false, camera, 0.05);
    expect(pool.visibleCount(ENEMY_KIND.scout)).toBe(1);
    for (let t = 0.1; t < 1.5; t += 0.05) pool.update(at(0, ENEMY_STATE.dead), false, camera, t);
    expect(pool.visibleCount(ENEMY_KIND.scout)).toBe(0);
    pool.dispose();
  });

  it('never draws a robot that was already dead when first seen', () => {
    const scene = new THREE.Scene();
    const pool = new EnemyPool(scene);
    pool.update(at(0, ENEMY_STATE.dead), false, camera, 0);
    expect(pool.visibleCount(ENEMY_KIND.scout)).toBe(0);
    pool.dispose();
  });
});
