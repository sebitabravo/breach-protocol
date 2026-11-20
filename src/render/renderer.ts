/**
 * Three.js renderer for SECTOR_01: instanced arena, pooled enemy meshes, a
 * first-person viewmodel, an FX pool and camera smoothing. The simulation
 * (S8) owns all game truth; this module only visualises snapshots and events.
 *
 * Note on MSAA: WebGL only lets a canvas hold one context, so antialias is
 * fixed when the first frame is created. The renderer is therefore created
 * lazily on the first render call, using the AA requirement of the last
 * `setQuality` — antialias on for `high` only.
 */
import { PoseInterpolator } from './interp';
import * as THREE from 'three';
import { ARENA_BOXES, type ArenaBox, type Material } from '../world/layout';
import { MAX_ENEMIES, type Snapshot, type WorldEvent } from '../wasm/bridge';
import { ENEMY_STATE, EVT, WEAPON } from '../wasm/protocol';
import { createRobotMesh, createWeaponModel } from './entities';
import { FxPool } from './fx';

export type QualityName = 'low' | 'medium' | 'high';

export interface QualityPreset {
  name: QualityName;
  dpr: number;
  shadows: boolean;
  particles: number;
  lights: number;
}

export interface Hooks {
  reducedMotion?: boolean;
}

/** Ladder palette: each entry is the albedo fed to the lighting rig so the
 * FINAL sRGB pixel lands on the composition targets (measured from frames):
 * floor ≈ #10171d (clearly darker than walls), walls ≈ #1e2833, cover ≈
 * #2a3844, ceiling ≈ #0c1216. Value steps between surfaces do the reading. */
const C = {
  bg: 0x070d12, // sky / background above the walls
  floor: 0x0e161b, // × grid map (base 0.83) × light → ≈ #10171d
  wall: 0x242d36, // → ≈ #1e2833
  cover: 0x32404b, // → ≈ #2a3844, one step above walls
  crate: 0x2c3944,
  pillar: 0x2d3a44,
  trim: 0x415164, // lighter panel/cap accent
  beam: 0x0b1015, // structural ceiling beams, darker than the ceiling
  ceiling: 0x0c1216, // enclosed dark roof (unlit basic material → exact)
  glow: 0x5ce08b, // mint accent (unlit basic material)
  sun: 0xe6ecf2,
  fill: 0x9fb0bd,
  hemiSky: 0xdfe4e8,
  hemiGround: 0x2a3036,
  impactWall: 0x96aaba,
  impactEnemy: 0xff5b6b,
  death: 0x5ce08b,
} as const;

const MATERIAL_COLORS: Record<Material, number> = {
  floor: C.floor,
  wall: C.wall,
  cover: C.cover,
  crate: C.crate,
  pillar: C.pillar,
  trim: C.trim,
  beam: C.beam,
  ceiling: C.ceiling,
  glow: C.glow,
};

const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', dpr: 1, shadows: false, particles: 128, lights: 2 },
  medium: { name: 'medium', dpr: 1.5, shadows: true, particles: 512, lights: 2 },
  high: { name: 'high', dpr: 2, shadows: true, particles: 1024, lights: 2 },
};

/** Shadow map resolution per preset (medium shares the same light, cheaper). */
function shadowMapSize(name: QualityName): number {
  return name === 'high' ? 2048 : 1024;
}

/** Deterministic PRNG (mulberry32) so per-instance wall variation is stable
 * across frames and sessions. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ORBIT_RADIUS = 17;
const ORBIT_HEIGHT = 8.5;
const ORBIT_SPEED = 0.12;
const CAMERA_FOV = 75;
/** The snapshot carries the player's FEET y (core/src/sim.rs writes
 * `player.pos.y`); the first-person camera needs the eye, so the renderer
 * lifts it by the sim's EYE_HEIGHT (core/src/player.rs). */
const EYE_HEIGHT = 1.62;
const BOB_AMPLITUDE = 0.035;

/**
 * Procedural panel grid on a 256×256 canvas: pale panel base with 1 px bright
 * lines so the grid reads without exceeding the +20% luminance budget over the
 * floor albedo. One texture, RepeatWrapping, generated at module load.
 * Base sits at 0.83 sRGB so the white panel lines land ≈ +20% over the final
 * floor pixel (sRGB ratio (1/0.657)^(1/2.2) ≈ 1.21).
 */
function makeGridTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // base at 0.83 sRGB: lines (≈ 1.0) end up ≈ +20% over the floor pixel
    ctx.fillStyle = '#d4d4d4'; // albedo = material.color × map
    ctx.fillRect(0, 0, size, size);
    // one subtly brighter sub-panel per 2×2 panel group
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, size / 2, size / 2);
    // 1 px bright panel lines on a 2×2 panel grid (128 px panels)
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, size);
    ctx.moveTo(size / 2 + 0.5, 0);
    ctx.lineTo(size / 2 + 0.5, size);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(size, 0.5);
    ctx.moveTo(0, size / 2 + 0.5);
    ctx.lineTo(size, size / 2 + 0.5);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(9, 9); // 36 m floor / 4 m texture tile (2×2 panels of 2 m)
  tex.anisotropy = 4;
  return tex;
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
    // updateViewmodel).
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

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: Hooks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fx: FxPool;
  private readonly sidearm: THREE.Group;
  private readonly carbine: THREE.Group;

  private renderer: THREE.WebGLRenderer | null = null;
  private wantAntialias = false; // antialias on for `high` only
  private presetValue: QualityPreset = PRESETS.medium;
  private dprValue = 1;
  private lastCalls = 0;
  private lastTriangles = 0;
  private disposed = false;

  // --- camera interpolation state -----------------------------------------
  private readonly interp = new PoseInterpolator();
  private bobPhase = 0;
  private bobAmp = 0;
  private adsAmount = 0;

  // --- enemy pool ----------------------------------------------------------
  private readonly enemyMeshes: (THREE.Mesh | null)[] = new Array(MAX_ENEMIES).fill(null);
  private readonly enemyKinds: number[] = new Array(MAX_ENEMIES).fill(-1);

  // --- preallocated scratch (never allocate per frame) ---------------------
  private readonly tmpVec = new THREE.Vector3();
  private readonly pendingOrigin = new THREE.Vector3();
  private readonly muzzleWorld = new THREE.Vector3();
  private pendingValid = false;

  constructor(canvas: HTMLCanvasElement, hooks?: Hooks) {
    this.canvas = canvas;
    this.hooks = hooks ?? {};

    this.scene.background = new THREE.Color(C.bg);
    // No fog: the previous blue fog washed the whole arena into one value
    // band. Contrast now comes from albedo + lighting, verified by probes.

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // lights: hemisphere base + modelling sun + weak fill; shadows on `high`.
    // Moderate physical intensities — the ladder is carried by albedo + light
    // shape, not giant multipliers (the old intensity-9 rig flattened it).
    this.hemiLight = new THREE.HemisphereLight(C.hemiSky, C.hemiGround, 3.75);
    this.scene.add(this.hemiLight);
    this.dirLight = new THREE.DirectionalLight(C.sun, 3.2);
    this.dirLight.position.set(8, 14, 6);
    this.dirLight.shadow.camera.left = -24;
    this.dirLight.shadow.camera.right = 24;
    this.dirLight.shadow.camera.top = 24;
    this.dirLight.shadow.camera.bottom = -24;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.03;
    this.scene.add(this.dirLight);
    // cheap fill from the opposite side kills the pitch-dark faces
    const fillLight = new THREE.DirectionalLight(C.fill, 2.2);
    fillLight.position.set(-10, 3.5, -9);
    this.scene.add(fillLight);
    // dedicated viewmodel light, parented to the camera so the gun is always
    // readable regardless of where the arena lights happen to be. Low
    // intensity + dark albedo: the gun must sit BELOW the HUD (~#232b33) and
    // never be the brightest object in the frame.
    const vmLight = new THREE.PointLight(0xdfeaf2, 2.2, 2.2, 2);
    vmLight.position.set(0.3, 0.15, 0.25);
    this.camera.add(vmLight);

    this.buildArena();

    this.fx = new FxPool(this.scene, this.presetValue.particles);
    this.sidearm = createWeaponModel(WEAPON.sidearm);
    this.carbine = createWeaponModel(WEAPON.carbine);
    this.sidearm.visible = false;
    this.carbine.visible = false;
    this.camera.add(this.sidearm, this.carbine);

    this.resize();
  }

  /** Switch quality preset; `dprCap` clamps the device pixel ratio. */
  setQuality(preset: QualityName, dprCap?: number): void {
    const p = PRESETS[preset] ?? PRESETS.medium;
    this.presetValue = p;
    this.wantAntialias = p.name === 'high';
    this.dirLight.castShadow = p.shadows;
    const size = shadowMapSize(p.name);
    if (this.dirLight.shadow.mapSize.x !== size) {
      this.dirLight.shadow.mapSize.set(size, size);
      if (this.dirLight.shadow.map) {
        this.dirLight.shadow.map.dispose();
        (this.dirLight.shadow as unknown as { map: null }).map = null;
      }
    }
    if (this.renderer) {
      // shadow map toggle live; MSAA would need a new context (impossible)
      this.renderer.shadowMap.enabled = p.shadows;
    }
    const cap = dprCap ?? Number.POSITIVE_INFINITY;
    this.dprValue = Math.min(p.dpr, cap, window.devicePixelRatio || 1);
    this.fx.setBudget(p.particles);
    this.resize();
  }

  get preset(): QualityPreset {
    return this.presetValue;
  }

  get dpr(): number {
    return this.dprValue;
  }

  /** renderer.info.render.calls of the last frame. */
  get calls(): number {
    return this.lastCalls;
  }

  /** renderer.info.render.triangles of the last frame. */
  get triangles(): number {
    return this.lastTriangles;
  }

  /** Honour devicePixelRatio + current CSS size; call on resize/orientation. */
  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(this.dprValue);
      if (w > 0 && h > 0) r.setSize(w, h, false);
    }
  }

  /** Menu/loading camera: slow orbit over the arena. */
  renderOrbit(dt: number): void {
    const r = this.ensureRenderer();
    this.orbitAngle += dt * ORBIT_SPEED;
    this.camera.position.set(
      Math.cos(this.orbitAngle) * ORBIT_RADIUS,
      ORBIT_HEIGHT,
      Math.sin(this.orbitAngle) * ORBIT_RADIUS,
    );
    this.camera.lookAt(0, 1.2, 0);
    this.camera.updateMatrixWorld();
    this.hideViewmodel();
    r.render(this.scene, this.camera);
    this.captureMetrics(r);
  }

  /**
   * Combat frame: interpolate the camera between the previous and current
   * player transform by `alpha`, apply recoil + bob, drive enemies, viewmodel
   * and FX from `events`, then render.
   */
  renderGame(state: Snapshot, alpha: number, dt: number, events: readonly WorldEvent[]): void {
    const r = this.ensureRenderer();

    // 1. camera interpolation (snap on reset / first frame)
    const pose = this.interp.sample(
      { px: state.px, py: state.py, pz: state.pz, yaw: state.yaw, pitch: state.pitch },
      state.tick,
      alpha,
    );
    const { px, py, pz, yaw, pitch } = pose;

    // 2. recoil on top of the interpolated view + grounded speed bob
    const reducedMotion = this.hooks.reducedMotion === true;
    let bobY = 0;
    let roll = 0;
    if (!reducedMotion && state.grounded) {
      const target = Math.min(Math.max(state.speed / 6, 0), 1);
      this.bobAmp += (target - this.bobAmp) * Math.min(dt * 8, 1);
      this.bobPhase += dt * (4 + state.speed * 1.6);
      bobY = Math.sin(this.bobPhase) * BOB_AMPLITUDE * this.bobAmp;
      roll = Math.sin(this.bobPhase * 0.5) * 0.008 * this.bobAmp;
    } else {
      this.bobAmp += (0 - this.bobAmp) * Math.min(dt * 8, 1);
    }
    this.camera.position.set(px, py + EYE_HEIGHT + bobY, pz);
    this.camera.rotation.set(pitch + state.recoilPitch, yaw + state.recoilYaw, roll);
    this.camera.updateMatrixWorld();

    // 3. enemies
    this.updateEnemies(state, reducedMotion);

    // 4. viewmodel
    this.updateViewmodel(state, dt, bobY);

    // 5. events -> FX
    this.handleEvents(events, state.weapon);
    this.fx.update(dt);

    // 6. render + metrics
    r.render(this.scene, this.camera);
    this.captureMetrics(r);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fx.dispose();
    const geoms = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) geoms.add(mesh.geometry);
      const mat = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => mats.add(m));
      else if (mat) mats.add(mat);
    });
    geoms.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.renderer?.dispose();
    this.renderer = null;
  }

  // --- internals -----------------------------------------------------------

  private orbitAngle = 0;

  private ensureRenderer(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.wantAntialias, // on for `high` only
      powerPreference: 'high-performance',
      alpha: false,
    });
    r.toneMapping = THREE.NoToneMapping; // the ladder is authored in raw sRGB
    r.shadowMap.enabled = this.presetValue.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = r;
    this.resize();
    // debugging/metrics hook: window.__BREACH__.renderer.{calls,triangles}.
    // Merge, never replace: main.ts exposes the GameApp shell here first and
    // the e2e/diagnostics handle must keep working once the renderer boots.
    const w = window as unknown as { __BREACH__?: Record<string, unknown> };
    w.__BREACH__ = Object.assign(w.__BREACH__ ?? {}, { renderer: this });
    return r;
  }

  private captureMetrics(r: THREE.WebGLRenderer): void {
    this.lastCalls = r.info.render.calls;
    this.lastTriangles = r.info.render.triangles;
  }

  /**
   * Arena from ARENA_BOXES, grouped by material: one InstancedMesh per
   * material — except the ceiling, which becomes a single downward-facing
   * plane (invisible from above, so the menu orbit can still look over the
   * walls) in the dark roof colour. Shadow selectivity: only the cover masses
   * cast, only floor + cover receive; enemies cast via their own meshes.
   */
  private buildArena(): void {
    const groups = new Map<Material, ArenaBox[]>();
    for (const box of ARENA_BOXES) {
      const list = groups.get(box.material);
      if (list) list.push(box);
      else groups.set(box.material, [box]);
    }
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const matrix = new THREE.Matrix4();
    const gridTexture = makeGridTexture();
    for (const [material, boxes] of groups) {
      if (material === 'ceiling') {
        // first (only) ceiling box defines the extent; plane at its base
        const b = boxes[0];
        const geo = new THREE.PlaneGeometry(b.sx, b.sz);
        geo.rotateX(Math.PI / 2); // normal points DOWN: visible from below only
        const mat = new THREE.MeshBasicMaterial({ color: C.ceiling });
        const plane = new THREE.Mesh(geo, mat);
        plane.position.set(b.x, b.y - b.sy / 2, b.z);
        plane.receiveShadow = false;
        this.scene.add(plane);
        continue;
      }
      const isGlow = material === 'glow' || material === 'beam';
      let mat: THREE.Material;
      if (material === 'beam') {
        // constant value one clear step above the ceiling so the beams read as
        // structure from below (a lit Lambert bottom face would go black)
        mat = new THREE.MeshBasicMaterial({ color: 0x171f27 });
      } else if (isGlow) {
        mat = new THREE.MeshBasicMaterial({ color: MATERIAL_COLORS[material] });
      } else if (material === 'floor') {
        mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLORS[material], map: gridTexture });
      } else if (material === 'wall' || material === 'trim') {
        // white diffuse; the real per-instance colour arrives via instanceColor
        // (three multiplies diffuse × instanceColor in the shader)
        mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
      } else {
        mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLORS[material] });
      }
      const mesh = new THREE.InstancedMesh(unitBox, mat, boxes.length);
      for (let i = 0; i < boxes.length; i += 1) {
        const b = boxes[i];
        matrix.makeScale(b.sx, b.sy, b.sz);
        matrix.setPosition(b.x, b.y, b.z);
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.jitterPanels(mesh, material, boxes.length);
      // contact shadows: cover casts + receives, floor receives; enemies cast
      // through their own meshes (createRobotMesh). Nothing else participates.
      mesh.castShadow = material === 'cover';
      mesh.receiveShadow = material === 'floor' || material === 'cover';
      this.scene.add(mesh);
    }
    this.buildLampHalos();
  }

  /** Per-instance value variation (±6/255 per channel, sRGB, seeded) breaks
   * up the flat wall panels and trims. instanceColor multiplies the (white)
   * diffuse in linear space, so each entry carries the FULL colour here. */
  private jitterPanels(mesh: THREE.InstancedMesh, material: Material, count: number): void {
    if (material !== 'wall' && material !== 'trim') return;
    const hex = MATERIAL_COLORS[material];
    const r8 = (hex >> 16) & 0xff;
    const g8 = (hex >> 8) & 0xff;
    const b8 = hex & 0xff;
    const rng = mulberry32(material === 'wall' ? 0x5eed11 : 0x1a2b3c);
    const jit = (): number => Math.round((rng() * 2 - 1) * 6);
    const clamp255 = (v: number): number => Math.min(Math.max(v, 0), 255);
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i += 1) {
      tmp.setRGB(
        clamp255(r8 + jit()) / 255,
        clamp255(g8 + jit()) / 255,
        clamp255(b8 + jit()) / 255,
        THREE.SRGBColorSpace,
      );
      mesh.setColorAt(i, tmp);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** One merged additive halo under every ceiling lamp so the strips read as
   * mounted light fixtures. A single InstancedMesh = one extra draw call. */
  private buildLampHalos(): void {
    const lamps = ARENA_BOXES.filter((b) => b.material === 'glow' && b.y > 5);
    if (lamps.length === 0) return;
    const geo = new THREE.PlaneGeometry(1.2, 1.2);
    geo.rotateX(Math.PI / 2); // faces down, like the ceiling plane
    const mat = new THREE.MeshBasicMaterial({
      color: 0xbfffd9,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, lamps.length);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < lamps.length; i += 1) {
      const b = lamps[i];
      matrix.makeTranslation(b.x, b.y - 0.07, b.z);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
  }

  /** Lazily build the robot mesh for a slot/kind pair. */
  private enemyMesh(index: number, kind: number): THREE.Mesh {
    let mesh = this.enemyMeshes[index];
    if (!mesh || this.enemyKinds[index] !== kind) {
      if (mesh) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      mesh = createRobotMesh(kind);
      this.enemyKinds[index] = kind;
      this.scene.add(mesh);
      this.enemyMeshes[index] = mesh;
    }
    return mesh;
  }

  private updateEnemies(state: Snapshot, reducedMotion: boolean): void {
    for (let i = 0; i < MAX_ENEMIES; i += 1) {
      const e = state.enemy(i);
      const mesh = this.enemyMesh(i, e.kind);
      if (e.state === ENEMY_STATE.dead) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      // walk bob from the FSM anim phase (skipped under reduced motion)
      const bob = reducedMotion ? 0 : Math.sin(e.anim * 7) * 0.03;
      mesh.position.set(e.x, e.y + bob, e.z);
      mesh.rotation.set(0, e.yaw, 0);
      // squash / lunge on windup & strike for readability
      if (e.state === ENEMY_STATE.aim) mesh.scale.set(1, 0.92, 1);
      else if (e.state === ENEMY_STATE.strike) mesh.scale.set(1, 1.06, 1);
      else mesh.scale.set(1, 1, 1);
    }
  }

  private hideViewmodel(): void {
    this.sidearm.visible = false;
    this.carbine.visible = false;
  }

  private updateViewmodel(state: Snapshot, dt: number, bobY: number): void {
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

  /** Gun tip in world space for the current weapon. */
  private computeGunTip(weapon: THREE.Group): void {
    const isCarbine = weapon === this.carbine;
    const muzzle = isCarbine ? POSES[WEAPON.carbine].muzzle : POSES[WEAPON.sidearm].muzzle;
    this.muzzleWorld.set(muzzle[0], muzzle[1], muzzle[2]).applyMatrix4(weapon.matrixWorld);
  }

  private handleEvents(events: readonly WorldEvent[], weapon: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case EVT.shot: {
          const group = weapon === WEAPON.carbine ? this.carbine : this.sidearm;
          this.computeGunTip(group);
          this.fx.muzzle(this.muzzleWorld);
          this.pendingOrigin.copy(this.muzzleWorld);
          this.pendingValid = true;
          break;
        }
        case EVT.wallHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          if (this.pendingValid) this.fx.tracer(this.pendingOrigin, this.tmpVec);
          this.fx.impact(this.tmpVec, C.impactWall);
          this.pendingValid = false;
          break;
        }
        case EVT.enemyHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          if (this.pendingValid) this.fx.tracer(this.pendingOrigin, this.tmpVec);
          this.fx.impact(this.tmpVec, C.impactEnemy);
          this.pendingValid = false;
          break;
        }
        case EVT.enemyDied: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          this.fx.burst(this.tmpVec, 26, C.death);
          break;
        }
        case EVT.enemyShot: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          this.fx.muzzle(this.tmpVec);
          this.fx.tracer(this.tmpVec, this.camera.position);
          break;
        }
        default:
          break; // unknown event types are ignored, never thrown
      }
    }
  }
}
