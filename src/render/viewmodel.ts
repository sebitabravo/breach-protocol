/**
 * Viewmodels de primera persona: PB-01 (sidearm), AR-04 (carbine) y SG-08
 * (shotgun). Cada arma son dos meshes: el cuerpo lit (Lambert) y un batch
 * emisivo (mira y franjas mint, MeshBasic). Solo el arma equipada dibuja, así
 * que el costo es 2 draws por frame. El pose (hip, ADS, retroceso, recarga)
 * sale del snapshot; la clase no conoce la simulación.
 */
import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import { WEAPON } from '../wasm/protocol';
import { buildMergedGeometry, MeshBuilder, type BoxPart } from './geometry';

const IDENTITY = new THREE.Matrix4();

/** Weapon viewmodel palette: darker than the arena surfaces so the gun sits
 * BELOW the HUD and never becomes the brightest object in the frame, ONE
 * mint accent stripe so it reads as foreground geometry, not UI. */
const W = {
  dark: 0x1f262e,
  body: 0x3a4753,
  border: 0x4a5865,
  accent: 0x5ce08b,
  sight: 0x5ce08b,
} as const;

/** Franjas y mira emisivas: >1 entra al bloom en medium y high. */
const EMIT_K = 1.6;

/** PB-01 sidearm parts. Origin at the grip / hand. Muzzle ≈ (0, 0.02, -0.2). */
function sidearmBody(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.02, sx: 0.05, sy: 0.06, sz: 0.24, color: W.body }, // slide
    { x: 0, y: -0.02, z: -0.02, sx: 0.045, sy: 0.05, sz: 0.2, color: W.dark }, // frame
    { x: 0, y: -0.09, z: 0.06, sx: 0.045, sy: 0.15, sz: 0.07, color: W.dark }, // grip
    { x: 0, y: -0.05, z: -0.03, sx: 0.04, sy: 0.02, sz: 0.08, color: W.dark }, // guard
    { x: 0, y: 0.02, z: -0.17, sx: 0.024, sy: 0.024, sz: 0.09, color: W.border }, // barrel
    { x: 0, y: 0.02, z: -0.225, sx: 0.032, sy: 0.032, sz: 0.024, color: W.dark }, // muzzle block
    { x: 0, y: 0.06, z: 0.02, sx: 0.03, sy: 0.02, sz: 0.05, color: W.dark }, // rear sight
  ];
}

/** Emisivo del PB-01: franja lateral y punto de mira en el frente del slide. */
function sidearmGlow(): BoxPart[] {
  return [
    { x: 0.027, y: 0.02, z: 0, sx: 0.004, sy: 0.012, sz: 0.1, color: W.accent }, // stripe
    { x: 0, y: 0.06, z: -0.1, sx: 0.012, sy: 0.012, sz: 0.012, color: W.sight }, // sight dot
  ];
}

/** AR-04 carbine parts. Origin at the grip / hand. Muzzle ≈ (0, 0.03, -0.58). */
function carbineBody(): BoxPart[] {
  return [
    { x: 0, y: 0.02, z: -0.1, sx: 0.05, sy: 0.08, sz: 0.5, color: W.body }, // body
    { x: 0, y: 0.03, z: -0.45, sx: 0.03, sy: 0.03, sz: 0.22, color: W.border }, // barrel
    { x: 0, y: 0.03, z: -0.575, sx: 0.038, sy: 0.038, sz: 0.03, color: W.dark }, // muzzle block
    { x: 0, y: -0.01, z: 0.24, sx: 0.045, sy: 0.1, sz: 0.16, color: W.dark }, // stock
    { x: 0, y: -0.08, z: 0.1, sx: 0.04, sy: 0.12, sz: 0.06, color: W.dark }, // grip
    { x: 0, y: -0.1, z: -0.05, sx: 0.04, sy: 0.14, sz: 0.05, color: W.dark }, // magazine
    { x: 0, y: 0.08, z: -0.08, sx: 0.025, sy: 0.05, sz: 0.1, color: W.dark }, // sight housing
  ];
}

/** Emisivo del AR-04: franja lateral y punto rojo de la mira holográfica. */
function carbineGlow(): BoxPart[] {
  return [
    { x: 0.027, y: 0.03, z: -0.15, sx: 0.004, sy: 0.012, sz: 0.12, color: W.accent }, // stripe
    { x: 0, y: 0.115, z: -0.08, sx: 0.014, sy: 0.014, sz: 0.014, color: W.sight }, // red dot
  ];
}

/**
 * SG-08 Scatter: pump shotgun. Long receiver, tube magazine under a wide
 * barrel, a pump forend and a bell muzzle, so it reads as a different class of
 * weapon from the two rifles/pistols at a glance.
 */
function shotgunBody(): BoxPart[] {
  return [
    { x: 0, y: 0.03, z: -0.02, sx: 0.06, sy: 0.09, sz: 0.22, color: W.body }, // receiver
    { x: 0, y: 0.05, z: -0.3, sx: 0.035, sy: 0.035, sz: 0.5, color: W.border }, // barrel
    { x: 0, y: 0.05, z: -0.56, sx: 0.07, sy: 0.07, sz: 0.05, color: W.dark }, // bell muzzle
    { x: 0, y: 0.005, z: -0.3, sx: 0.024, sy: 0.024, sz: 0.42, color: W.border }, // tube magazine
    { x: 0, y: -0.005, z: -0.26, sx: 0.07, sy: 0.05, sz: 0.14, color: W.dark }, // pump forend
    { x: 0, y: -0.01, z: 0.2, sx: 0.05, sy: 0.11, sz: 0.22, color: W.dark }, // stock
    { x: 0, y: -0.09, z: 0.07, sx: 0.045, sy: 0.13, sz: 0.06, color: W.dark }, // grip
  ];
}

/** Emisivo del SG-08: franja lateral y cuenta de mira en la boca del cañón. */
function shotgunGlow(): BoxPart[] {
  return [
    { x: 0.034, y: 0.03, z: -0.02, sx: 0.004, sy: 0.012, sz: 0.16, color: W.accent }, // stripe
    { x: 0, y: 0.1, z: -0.5, sx: 0.01, sy: 0.01, sz: 0.01, color: W.sight }, // front bead
  ];
}

/** Camera-space weapon anchors: hip position, ADS position, muzzle tip, flash size. */
interface WeaponPose {
  hip: readonly [number, number, number];
  ads: readonly [number, number, number];
  muzzle: readonly [number, number, number];
  flash: number;
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
    flash: 0.24,
  },
  [WEAPON.carbine]: {
    // hip más alto que el sidearm: a -0.28 la culata y el cargador salían por el borde inferior
    hip: [0.28, -0.2, -0.7],
    ads: [0, -0.15, -0.5],
    muzzle: [0, 0.03, -0.58],
    flash: 0.3,
  },
  [WEAPON.shotgun]: {
    // el cañón largo pide el hip más alto: a -0.3 el grip y la culata quedaban fuera del marco
    hip: [0.26, -0.22, -0.7],
    ads: [0, -0.17, -0.52],
    muzzle: [0, 0.05, -0.62],
    flash: 0.55,
  },
};

/** Viewmodel scale: slightly under 1:1 so the weapon reads as a weapon while
 * the whole mesh (grip included) stays inside the frame and clear of the ammo
 * readout from 16:9 up through 19.5:9. */
const VIEWMODEL_SCALE = 0.85;
/** Altura máxima de la recarga (metros): el arma baja al cambiar cargador. */
const RELOAD_DROP = 0.09;

interface WeaponView {
  root: THREE.Group;
  pose: WeaponPose;
}

function buildWeapon(weaponId: number): WeaponView {
  const root = new THREE.Group();
  const body = weaponId === WEAPON.carbine ? carbineBody() : weaponId === WEAPON.shotgun ? shotgunBody() : sidearmBody();
  const glow = weaponId === WEAPON.carbine ? carbineGlow() : weaponId === WEAPON.shotgun ? shotgunGlow() : sidearmGlow();
  const lit = new THREE.Mesh(buildMergedGeometry(body), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const emit = new THREE.Mesh(buildEmissiveGeometry(glow), new THREE.MeshBasicMaterial({ vertexColors: true }));
  root.add(lit, emit);
  return { root, pose: POSES[weaponId] ?? POSES[WEAPON.sidearm] };
}

/** Batch emisivo: el color lineal se escala por EMIT_K (>1) para que el bloom lo tome. */
function buildEmissiveGeometry(parts: BoxPart[]): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const c = new THREE.Color();
  for (const p of parts) {
    c.setHex(p.color);
    builder.addBox(p.x, p.y, p.z, p.sx, p.sy, p.sz, { rgb: [c.r * EMIT_K, c.g * EMIT_K, c.b * EMIT_K] });
  }
  return builder.build();
}

export class Viewmodel {
  private readonly views = new Map<number, WeaponView>();
  private active: WeaponView | null = null;
  private adsAmount = 0;

  constructor(parent: THREE.Object3D) {
    for (const id of [WEAPON.sidearm, WEAPON.carbine, WEAPON.shotgun]) {
      const view = buildWeapon(id);
      view.root.visible = false;
      parent.add(view.root);
      this.views.set(id, view);
    }
  }

  hide(): void {
    if (this.active) this.active.root.visible = false;
    this.active = null;
  }

  /** Muzzle flash size for the weapon (world units of the sprite). */
  flashSize(weaponId: number): number {
    return (this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm))?.pose.flash ?? 0.24;
  }

  /** Pose the weapon for the snapshot; `bobY` is the camera bob this frame. */
  update(state: Snapshot, dt: number, bobY: number): void {
    const view = this.views.get(state.weapon) ?? this.views.get(WEAPON.sidearm);
    if (!view) return;
    if (this.active !== view) {
      if (this.active) this.active.root.visible = false;
      this.active = view;
      view.root.visible = true;
    }
    const pose = view.pose;
    const targetAds = state.ads > 0.5 ? 1 : 0;
    this.adsAmount += (targetAds - this.adsAmount) * Math.min(dt * 10, 1);

    const kick = Math.min(Math.max(state.recoilPitch * 0.6, 0), 0.09);
    const reloadT = state.reloading ? Math.sin(state.reloadProgress * Math.PI) : 0;
    const reloadRot = reloadT * 0.8;
    const reloadDrop = reloadT * RELOAD_DROP;
    view.root.position.set(
      pose.hip[0] + (pose.ads[0] - pose.hip[0]) * this.adsAmount,
      pose.hip[1] + (pose.ads[1] - pose.hip[1]) * this.adsAmount + bobY * 0.5 - reloadDrop,
      pose.hip[2] + (pose.ads[2] - pose.hip[2]) * this.adsAmount + kick,
    );
    view.root.rotation.set(kick * 1.5 + reloadRot, 0, 0);
    view.root.scale.set(VIEWMODEL_SCALE, VIEWMODEL_SCALE, VIEWMODEL_SCALE);
    // el muzzle se lee en este mismo frame: la matriz debe estar al día
    view.root.updateMatrixWorld(true);
  }

  /** Muzzle tip in world space for the given weapon id (written into `out`). */
  muzzleWorld(weaponId: number, out: THREE.Vector3): THREE.Vector3 {
    const view = this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm);
    const m = view?.pose.muzzle ?? POSES[WEAPON.sidearm].muzzle;
    return out.set(m[0], m[1], m[2]).applyMatrix4(view?.root.matrixWorld ?? IDENTITY);
  }
}
