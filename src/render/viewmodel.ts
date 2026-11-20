/**
 * First-person weapon viewmodels. Each weapon is ONE merged vertex-coloured
 * mesh in camera space; the class owns the hip/ADS/recoil/reload pose so the
 * facade only forwards the snapshot.
 */
import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import { WEAPON } from '../wasm/protocol';
import { buildMergedGeometry, type BoxPart } from './geometry';

/** Weapon viewmodel palette: darker than the arena surfaces so the gun sits
 * BELOW the HUD and never becomes the brightest object in the frame, ONE
 * mint accent stripe so it reads as foreground geometry, not UI. */
const W = {
  dark: 0x161b21,
  body: 0x232b33,
  border: 0x313a43,
  accent: 0x5ce08b,
} as const;

/** PB-01 sidearm viewmodel parts. Origin at the grip / hand. Muzzle ≈ (0, 0.02, -0.2). */
function sidearmParts(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.02, sx: 0.05, sy: 0.06, sz: 0.24, color: W.body }, // slide
    { x: 0, y: -0.02, z: -0.02, sx: 0.045, sy: 0.05, sz: 0.2, color: W.dark }, // frame
    { x: 0, y: -0.09, z: 0.06, sx: 0.045, sy: 0.15, sz: 0.07, color: W.dark }, // grip
    { x: 0, y: -0.05, z: -0.03, sx: 0.04, sy: 0.02, sz: 0.08, color: W.dark }, // guard
    { x: 0, y: 0.02, z: -0.17, sx: 0.024, sy: 0.024, sz: 0.09, color: W.border }, // barrel
    { x: 0, y: 0.02, z: -0.225, sx: 0.032, sy: 0.032, sz: 0.024, color: W.dark }, // muzzle block
    { x: 0.027, y: 0.02, z: 0, sx: 0.004, sy: 0.012, sz: 0.1, color: W.accent }, // stripe
  ];
}

/** AR-04 carbine viewmodel parts. Origin at the grip / hand. Muzzle ≈ (0, 0.03, -0.58). */
function carbineParts(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.1, sx: 0.05, sy: 0.08, sz: 0.5, color: W.body }, // body
    { x: 0, y: 0.03, z: -0.45, sx: 0.03, sy: 0.03, sz: 0.22, color: W.border }, // barrel
    { x: 0, y: 0.03, z: -0.575, sx: 0.038, sy: 0.038, sz: 0.03, color: W.dark }, // muzzle block
    { x: 0, y: -0.01, z: 0.24, sx: 0.045, sy: 0.1, sz: 0.16, color: W.dark }, // stock
    { x: 0, y: -0.08, z: 0.1, sx: 0.04, sy: 0.12, sz: 0.06, color: W.dark }, // grip
    { x: 0, y: -0.1, z: -0.05, sx: 0.04, sy: 0.14, sz: 0.05, color: W.dark }, // magazine
    { x: 0, y: 0.08, z: -0.08, sx: 0.025, sy: 0.05, sz: 0.1, color: W.dark }, // sight
    { x: 0.027, y: 0.03, z: -0.15, sx: 0.004, sy: 0.012, sz: 0.12, color: W.accent }, // stripe
  ];
}

/** Camera-space weapon anchors: hip position, ADS position, muzzle tip. */
interface WeaponPose {
  hip: readonly [number, number, number];
  ads: readonly [number, number, number];
  muzzle: readonly [number, number, number];
}

const POSES: Record<number, WeaponPose> = {
  [WEAPON.sidearm]: {
    // hip: raised and pulled back so the FULL weapon sits inside the frame
    // (~40 px bottom margin at 1280×720) instead of clipping through the
    // bottom edge, while staying left of the ammo readout (scale 0.85 in
    // update()).
    hip: [0.3, -0.27, -0.7],
    ads: [0, -0.16, -0.45],
    muzzle: [0, 0.02, -0.2],
  },
  [WEAPON.carbine]: {
    hip: [0.28, -0.28, -0.7],
    ads: [0, -0.15, -0.5],
    muzzle: [0, 0.03, -0.58],
  },
};

/** Viewmodel scale: slightly under 1:1 so the weapon reads as a weapon while
 * the whole mesh (grip included) stays inside the frame and clear of the ammo
 * readout from 16:9 up through 19.5:9. */
const VIEWMODEL_SCALE = 0.85;

function buildWeaponModel(weaponId: number): THREE.Group {
  const parts = weaponId === WEAPON.carbine ? carbineParts() : sidearmParts();
  const geometry = buildMergedGeometry(parts);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

export class Viewmodel {
  private readonly sidearm: THREE.Group;
  private readonly carbine: THREE.Group;
  private adsAmount = 0;

  constructor(parent: THREE.Object3D) {
    this.sidearm = buildWeaponModel(WEAPON.sidearm);
    this.carbine = buildWeaponModel(WEAPON.carbine);
    this.sidearm.visible = false;
    this.carbine.visible = false;
    parent.add(this.sidearm, this.carbine);
  }

  hide(): void {
    this.sidearm.visible = false;
    this.carbine.visible = false;
  }

  /** Pose the weapon for the snapshot; `bobY` is the camera bob this frame. */
  update(state: Snapshot, dt: number, bobY: number): void {
    const weapon = state.weapon === WEAPON.carbine ? this.carbine : this.sidearm;
    this.sidearm.visible = weapon === this.sidearm;
    this.carbine.visible = weapon === this.carbine;

    const pose = POSES[state.weapon] ?? POSES[WEAPON.sidearm];
    const targetAds = state.ads > 0.5 ? 1 : 0;
    this.adsAmount += (targetAds - this.adsAmount) * Math.min(dt * 10, 1);

    const kick = Math.min(Math.max(state.recoilPitch * 0.6, 0), 0.09);
    const reloadRot = state.reloading ? Math.sin(state.reloadProgress * Math.PI) * 0.8 : 0;
    weapon.position.set(
      pose.hip[0] + (pose.ads[0] - pose.hip[0]) * this.adsAmount,
      pose.hip[1] + (pose.ads[1] - pose.hip[1]) * this.adsAmount + bobY * 0.5,
      pose.hip[2] + (pose.ads[2] - pose.hip[2]) * this.adsAmount + kick,
    );
    weapon.rotation.set(kick * 1.5 + reloadRot, 0, 0);
    weapon.scale.set(VIEWMODEL_SCALE, VIEWMODEL_SCALE, VIEWMODEL_SCALE);
  }

  /** Muzzle tip in world space for the given weapon id (written into `out`). */
  muzzleWorld(weaponId: number, out: THREE.Vector3): THREE.Vector3 {
    const isCarbine = weaponId === WEAPON.carbine;
    const group = isCarbine ? this.carbine : this.sidearm;
    const muzzle = isCarbine ? POSES[WEAPON.carbine].muzzle : POSES[WEAPON.sidearm].muzzle;
    return out.set(muzzle[0], muzzle[1], muzzle[2]).applyMatrix4(group.matrixWorld);
  }
}
