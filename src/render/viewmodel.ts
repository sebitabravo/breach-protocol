/**
 * Camera-local weapon rig. Authored weapons are the default; the Kenney GLB
 * route remains available for asset comparison and fallback.
 */
import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import { WEAPON } from '../wasm/protocol';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { authorWeapon, weaponMaterials, type AuthoredWeapon } from './authored-weapon';
import { FINISH } from './finishes';
import { addHardware, COLLAR_FRONT, profileWeapon } from './weapon-hardware';

const IDENTITY = new THREE.Matrix4();
export const CAMERA_FOV = 75;
export const VIEW_FOV = 70;
export const VIEW_NEAR = 0.025;
const TAN_HALF = Math.tan(THREE.MathUtils.degToRad(VIEW_FOV / 2));
const TUCK_DISTANCE = 0.24;
const TUCK_DROP = 0.060;
const TUCK_PITCH = 0.10;

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
  modelPose?: WeaponPose;
  points?: THREE.Vector3[];
  aim?: readonly [number, number];
  scale?: number;
  muzzle: THREE.Object3D;
  worldMuzzle: THREE.Object3D;
  authored?: AuthoredWeapon;
}

// Socket coordinates on the GLBs, where +Z is forward. The repeater has two
// apertures: the center of their combined bounds is not inside either bore.
const SOCKETS = {
  blaster: [0, 0.45, 0.89],
  'blaster-repeater': [0.2, 0.45, 1.17],
} as const;
type ModelFile = keyof typeof SOCKETS;

/** Point the asset along -Z and center the marked bore on the rig's axis. */
export function fitModel(model: THREE.Object3D, length: number, file: ModelFile): THREE.Object3D {
  model.position.set(0, 0, 0);
  model.rotation.set(0, Math.PI, 0);
  model.scale.setScalar(1);
  const bounds = new THREE.Box3().setFromObject(model, true);
  const scale = length / (bounds.max.z - bounds.min.z);
  const [x, y, z] = SOCKETS[file];
  model.scale.set(scale * 0.8, scale, scale);
  const fittedBounds = bounds.setFromObject(model, true);
  model.position.set(x * model.scale.x, -y * scale, 0.18 - fittedBounds.max.z);
  model.updateMatrix();
  const anchor = new THREE.Object3D();
  anchor.name = 'muzzle';
  anchor.position.set(x, y, z).applyMatrix4(model.matrix);
  return anchor;
}

function meshPoints(root: THREE.Object3D): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  root.updateMatrixWorld(true);
  root.traverse((part) => {
    const positions = (part as THREE.Mesh).geometry?.getAttribute('position');
    if (!positions) return;
    for (let i = 0; i < positions.count; ++i) {
      points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(part.matrixWorld));
    }
  });
  return points;
}

const HIP_ROLL = -0.12;
const ACTION_DURATION = 0.115;

/** Fit the projected mesh at load/resize, not per frame. A fixed vertical
 * FOV needs different camera-local offsets and scales in portrait. */
function frameModel(view: WeaponView, aspect: number): void {
  if (!view.points) return;
  const fx = TAN_HALF * aspect;
  const fy = TAN_HALF;
  const x = aspect < 1 ? 0.44 : 0.42;
  // Wide views preserve extra bottom clearance because the silhouette gets taller.
  const y = aspect < 1 ? -0.40 : -0.45 + THREE.MathUtils.clamp((aspect - 16 / 9) * 0.09, 0, 0.045);
  // Ancho en NDC: 26 % del viewport en apaisado (la maqueta lo muestra grande, abajo a la derecha); 22 % en vertical.
  const width = aspect < 1 ? 0.44 : 0.52;
  const position = new THREE.Vector3(x * fx, y * fy, -1);
  const euler = new THREE.Euler(0, 0, HIP_ROLL, 'YXZ');
  const rotation = new THREE.Quaternion();
  const p = new THREE.Vector3();
  let scale = Math.min(0.95, aspect * 0.85);
  for (let pass = 0; pass < 8; ++pass) {
    // The barrel axis intersects the center camera ray; roll is along that axis.
    const reach = Math.max(0.68, position.x * 1.9);
    euler.y = Math.atan2(position.x, reach);
    euler.x = Math.atan2(-position.y, Math.hypot(reach, position.x));
    rotation.setFromEuler(euler);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of view.points) {
      p.copy(point).multiplyScalar(scale).applyQuaternion(rotation).add(position);
      const nx = p.x / (-p.z * fx), ny = p.y / (-p.z * fy);
      minX = Math.min(minX, nx); maxX = Math.max(maxX, nx);
      minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
    }
    if (pass === 7) break;
    position.x += (x - (minX + maxX) / 2) * fx * 0.78;
    position.y += (y - (minY + maxY) / 2) * fy * 0.78;
    // The compact slide needs additional scale on wide displays to retain
    // the same horizontal footprint as the long guns.
    const sidearm = view.authored && view.root.name === 'PB-01';
    // Más grande solo entre 4:3 y 16:9; en ultra ancho el alto disponible bajo la mira no alcanza.
    const big = aspect >= 1 && aspect <= 16 / 9 + 0.01 ? (sidearm ? 1.04 : 1.12) : 1;
    const maxScale = (sidearm ? (aspect > 16 / 9 ? 1.28 : 1.18) : 1.24) * big;
    scale = Math.min(scale * THREE.MathUtils.clamp(width / (maxX - minX), 0.75, 1.25), maxScale);
  }
  view.modelPose = { ...view.pose, hip: [position.x, position.y, position.z], ads: [0, -0.13, -0.79] };
  view.aim = [euler.x, euler.y];
  view.scale = scale;
}

function disposeMeshes(root: THREE.Object3D, shared: readonly THREE.Material[] = []): void {
  const resources = new Set<{ dispose(): void }>();
  root.traverse((part) => {
    const mesh = part as THREE.Mesh;
    if (!mesh.geometry) return;
    resources.add(mesh.geometry);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (shared.includes(mat)) continue;
      resources.add(mat);
      const map = (mat as THREE.MeshStandardMaterial).map;
      if (map) resources.add(map);
    }
  });
  for (const resource of resources) resource.dispose();
}

/** The Kenney UVs point at the right half of each swatch; the remap is on
 * the left half. Retarget the runtime UVs without changing the source GLBs. */
function finishAtlas(model: THREE.Object3D): void {
  const materials = new Set<THREE.MeshStandardMaterial>();
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const material = part.material;
    if (material instanceof THREE.MeshStandardMaterial) materials.add(material);
    const uv = part.geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; ++i) {
      const u = uv.getX(i), v = uv.getY(i);
      // The yellow swatch covers the entire rear housing and a side rail;
      // direct those large parts to graphite. Keep mint off the broad faces.
      if (u < 0.125 && v < 0.75) uv.setXY(i, 16 / 512, v + 0.25);
      else if (u >= 0.375) uv.setX(i, 272 / 512);
      else uv.setX(i, u - 32 / 512);
    }
  });
  for (const mat of materials) {
    mat.side = THREE.FrontSide;
    mat.roughness = 0.63;
    mat.metalness = 0.36;
  }
}

export class Viewmodel {
  private readonly metal = new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: FINISH.steel.metalness, roughness: FINISH.steel.roughness, normalScale: new THREE.Vector2(0.022, 0.022),
  });
  private readonly markings = new THREE.MeshBasicMaterial({ vertexColors: true });
  private readonly materials = weaponMaterials(this.metal, this.markings);
  private readonly shared = [...new Set(Object.values(this.materials))];
  private readonly views = new Map<number, WeaponView>();
  private active: WeaponView | null = null;
  private adsAmount = 0;
  private tuckAmount = 0;
  private readonly viewToWorld = new THREE.Matrix4();
  private aspect = 16 / 9;
  private hipScale = 1;
  private screenScale = 1;
  private started = false;
  private disposed = false;

  constructor(parent: THREE.Object3D, private readonly useAuthored = true) {
    // The shared tiles depict heavy tread plate at arena scale. Keep the same
    // PBR channels but suppress their macro pattern on machined parts.
    this.metal.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `#ifdef USE_MAP
          diffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), 0.10);
        #endif`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= mix(1.0, texture2D(roughnessMap, vRoughnessMapUv).g, 0.25);
        #endif`);
    };
    this.metal.customProgramCacheKey = () => 'bp-viewmodel-machined';
    for (const id of [WEAPON.sidearm, WEAPON.carbine, WEAPON.shotgun]) {
      const root = new THREE.Group();
      root.rotation.order = 'YXZ';
      const authored = authorWeapon(root, id, this.materials);
      const view: WeaponView = { root, pose: POSES[id], points: meshPoints(root), muzzle: authored.muzzle, worldMuzzle: new THREE.Object3D(), authored };
      frameModel(view, this.aspect);
      root.visible = false;
      parent.add(root);
      this.views.set(id, view);
    }
  }

  /** Borrow the arena's metal textures. ArenaSurfaces owns their disposal. */
  setMetalMaps(metal: THREE.MeshStandardMaterial): void {
    if (!metal.map || this.metal.map === metal.map || this.disposed) return;
    this.metal.map = metal.map;
    this.metal.normalMap = metal.normalMap;
    this.metal.roughnessMap = metal.roughnessMap;
    this.metal.metalnessMap = metal.metalnessMap;
    this.metal.needsUpdate = true;
  }

  load(): void {
    if (this.useAuthored || this.started || this.disposed) return;
    this.started = true;
    const loader = new GLTFLoader();
    const load = (file: ModelFile, ids: readonly number[]): void => {
      void loader.loadAsync(`${import.meta.env.BASE_URL}assets/models/${file}.glb`).then(({ scene }) => {
        if (this.disposed) {
          disposeMeshes(scene);
          return;
        }
        finishAtlas(scene);
        profileWeapon(scene);
        ids.forEach((id, i) => {
          const view = this.views.get(id)!;
          const model = i === 0 ? scene : scene.clone();
          const small = id === WEAPON.sidearm;
          const carrier = new THREE.Group();
          carrier.name = file;
          const anchor = fitModel(model, small ? 0.64 : id === WEAPON.carbine ? 0.74 : 0.82, file);
          carrier.add(model, anchor);
          addHardware(carrier, model.matrix, SOCKETS[file], small, this.metal, this.markings);
          // Advance the FX socket along the same bore to clear the collar lip.
          anchor.position.z -= (COLLAR_FRONT + 0.004) * model.scale.z;
          view.points = meshPoints(carrier);
          frameModel(view, this.aspect);
          disposeMeshes(view.root, this.shared);
          view.authored = undefined;
          view.root.clear().add(carrier);
          view.root.rotation.order = 'YXZ';
          view.muzzle = anchor;
        });
      }).catch((error: unknown) => {
        if (!this.disposed) console.warn(`Viewmodel ${file}.glb unavailable: using authored fallback`, error);
      });
    };
    load('blaster', [WEAPON.sidearm]);
    load('blaster-repeater', [WEAPON.carbine, WEAPON.shotgun]);
  }

  dispose(): void {
    this.disposed = true;
    const detached = new THREE.Group();
    for (const { root } of this.views.values()) detached.add(root);
    disposeMeshes(detached, this.shared);
    for (const material of this.shared) material.dispose();
    this.views.clear();
    this.active = null;
  }

  setAspect(aspect: number): void {
    if (aspect === this.aspect) return;
    this.aspect = aspect;
    for (const view of this.views.values()) frameModel(view, aspect);
    this.hipScale = Math.min(1, aspect / 1.16);
    this.screenScale = THREE.MathUtils.clamp(0.40 + aspect * 0.61, 0.62, 1);
  }

  hide(): void {
    if (this.active) this.active.root.visible = false;
    this.active = null;
    this.tuckAmount = 0;
  }

  /** Muzzle flash size for the weapon (world units of the sprite). */
  flashSize(weaponId: number): number {
    const view = this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm);
    const framing = view?.authored ? this.screenScale : Math.min(1, view?.scale ?? 1);
    return (view?.pose.flash ?? 0.24) * framing * 0.65;
  }

  /** Pose the weapon for the snapshot; `bobY` is the camera bob this frame. */
  update(state: Snapshot, dt: number, bobY: number, obstruction = 0, viewToWorld = IDENTITY): void {
    const view = this.views.get(state.weapon) ?? this.views.get(WEAPON.sidearm);
    if (!view) return;
    if (this.active !== view) {
      if (this.active) this.active.root.visible = false;
      this.active = view;
      view.root.visible = true;
    }
    const pose = view.modelPose ?? view.pose;
    const targetAds = state.ads > 0.5 ? 1 : 0;
    this.adsAmount += (targetAds - this.adsAmount) * Math.min(dt * 10, 1);
    // Faster in than out. Scaling around the eye brings the gun back without
    // inflating it on screen; the drop and dip are the visible tuck.
    this.tuckAmount = THREE.MathUtils.damp(this.tuckAmount, obstruction, obstruction > this.tuckAmount ? 16 : 10, dt);
    const tuck = this.tuckAmount;
    const reach = 1 - tuck * TUCK_DISTANCE;

    const kick = THREE.MathUtils.clamp(state.recoilPitch * 0.58, 0, 0.048);
    const reload = state.reloading ? Math.sin(state.reloadProgress * Math.PI) : 0;
    const ads = this.adsAmount;
    const model = view.modelPose !== undefined;
    const hip = model ? 1 - ads : 0;
    view.root.position.set(
      THREE.MathUtils.lerp(pose.hip[0] * (model ? 1 : this.hipScale), pose.ads[0], ads),
      THREE.MathUtils.lerp(pose.hip[1], pose.ads[1], ads) * (model ? 1 : this.screenScale)
        + bobY * 0.35 - reload * (model ? 0.055 : RELOAD_DROP),
      THREE.MathUtils.lerp(pose.hip[2], pose.ads[2], ads) + kick,
    ).multiplyScalar(reach);
    view.root.position.y -= tuck * TUCK_DROP;
    view.root.rotation.set((view.aim?.[0] ?? 0) * hip + 0.08 * ads + kick * 0.75 + reload * 0.36 - tuck * TUCK_PITCH,
      (view.aim?.[1] ?? 0) * hip, HIP_ROLL * hip + bobY * 0.4 + reload * 0.16);
    view.root.scale.setScalar((view.scale ?? VIEWMODEL_SCALE * this.screenScale) * reach);
    if (view.authored) {
      const { action, dot, heat } = view.authored;
      view.authored.actionTime = Math.max(0, view.authored.actionTime - dt);
      action.position.z = view.authored.travel * (view.authored.actionTime / ACTION_DURATION) ** 2;
      view.authored.temperature *= Math.exp(-dt * 3.4);
      heat.material.emissiveIntensity = view.authored.temperature * 0.55;
      // Punto rojo del visor, como en la maqueta: tenue en cadera, nítido al apuntar.
      dot?.material.color.setHex(0xff3b4a).multiplyScalar(0.55 + ads * 1.45);
    }
    // FX read the posed sockets in the same frame.
    view.root.updateMatrixWorld(true);
    this.viewToWorld.copy(viewToWorld);
    view.worldMuzzle.matrixWorld.multiplyMatrices(this.viewToWorld, view.muzzle.matrixWorld);
  }

  /** Visual-only shot cues; never drive these from the player's input. */
  fire(weaponId: number): void {
    const authored = this.views.get(weaponId)?.authored;
    if (!authored) return;
    authored.actionTime = ACTION_DURATION;
    authored.action.position.z = authored.travel;
    authored.temperature = Math.min(1, authored.temperature + 0.34);
    authored.heat.material.emissiveIntensity = authored.temperature * 0.55;
  }

  /** Muzzle tip in world space for the given weapon id (written into `out`). */
  muzzleWorld(weaponId: number, out: THREE.Vector3): THREE.Vector3 {
    return out.setFromMatrixPosition(this.worldMuzzleSocket(weaponId)?.matrixWorld ?? IDENTITY);
  }

  /** Receiver-side port in the same posed rig as the muzzle. */
  ejectFrame(weaponId: number, position: THREE.Vector3, velocity: THREE.Vector3): void {
    const view = this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm)!;
    const authored = view.authored;
    if (authored) {
      position.set(weaponId === WEAPON.shotgun ? -0.07 : -0.052, 0.064,
        weaponId === WEAPON.sidearm ? -0.12 : -0.075).applyMatrix4(view.root.matrixWorld);
    } else {
      position.set(-0.055, 0.043, -0.12).applyMatrix4(view.root.matrixWorld);
    }
    // Camera-facing receiver side: the arc stays readable without blocking the sight.
    position.applyMatrix4(this.viewToWorld);
    velocity.set(-0.92, 2.7, -1.85).transformDirection(view.root.matrixWorld)
      .transformDirection(this.viewToWorld).multiplyScalar(3.35);
  }

  /** Detached, projection-corrected anchor for the world-space tracer pool. */
  worldMuzzleSocket(weaponId: number): THREE.Object3D | undefined {
    return (this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm))?.worldMuzzle;
  }

  muzzleSocket(weaponId: number): THREE.Object3D | undefined {
    return (this.views.get(weaponId) ?? this.views.get(WEAPON.sidearm))?.muzzle;
  }

}
