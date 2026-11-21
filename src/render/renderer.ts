/**
 * Three.js renderer for SECTOR_01: instanced arena, pooled enemy meshes, a
 * first-person viewmodel, an FX pool and camera smoothing. The simulation
 * (S8) owns all game truth; this module only visualises snapshots and events.
 * It is a thin facade: arena, viewmodel, camera rig, textures and themes live
 * in their own modules.
 *
 * Note on MSAA: the canvas context is created with `antialias: false`. The
 * browser fixes that flag at context creation, and `init()` runs before the
 * first `setQuality`, so a per-preset canvas AA could never take effect. On
 * medium and high the composer target carries the MSAA samples instead
 * (docs/adr/0004-bloom-postprocessing.md). `low` renders without AA.
 *
 * Draw calls: `info.autoReset` is off and the facade resets it once per frame,
 * so `calls` covers every pass (shadow map, scene, bloom, output).
 */
import * as THREE from 'three';
import { arenaBoxes } from '../world/layout';
import type { MapData } from '../world/map';
import type { Snapshot, WorldEvent } from '../wasm/bridge';
import { EVT, WEAPON } from '../wasm/protocol';
import { ArenaBuild } from './arena';
import { CameraRig } from './camera';
import { IndustrialEnvironment } from './environment';
import { ArenaSurfaces, SURFACE } from './surfaces';
import { EnemyPool } from './enemies';
import { FxPool, impactColour, impactFace, MuzzleFlash } from './fx';
import { FeedbackFx } from './feedback-fx';
import { PoseInterpolator, type Pose } from './interp';
import { ObjectiveBeacon, objectiveOccluded } from './objective-beacon';
import type { ObjectiveClip } from './objective-projection';
import { PRESETS, type QualityName, type QualityPreset } from './presets';
import { PostFx } from './postfx';
import { lookFor, PALETTE, type ThemeLook } from './themes';
import { CAMERA_FOV, VIEW_FOV, VIEW_NEAR, Viewmodel } from './viewmodel';
import { weaponObstruction } from './weapon-clearance';

export type { QualityName, QualityPreset } from './presets';

export interface Hooks {
  reducedMotion?: boolean;
  /** Set false to use the licensed Kenney viewmodel fallback. */
  authoredViewmodel?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const PLAY_PIXEL_BUDGET = { low: 154_000, medium: 540_000, high: Infinity } as const;
const ORBIT_INTERVAL = 1 / 8;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly screenRoot: HTMLElement | null;
  private readonly hooks: Hooks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly viewScene = new THREE.Scene();
  private readonly viewCamera = new THREE.PerspectiveCamera(VIEW_FOV, 1, VIEW_NEAR, 12);
  private readonly viewFlash = new MuzzleFlash(this.viewScene, true);
  private readonly viewHemi = new THREE.HemisphereLight();
  private readonly viewKey = new THREE.DirectionalLight();
  private readonly viewFill = new THREE.DirectionalLight();
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly practicals = new THREE.Group();
  private readonly fog = new THREE.FogExp2(PALETTE.bg, 0);
  private readonly fx: FxPool;
  private readonly feedback = new FeedbackFx(this.scene);
  private readonly rig = new CameraRig();
  private readonly viewmodel: Viewmodel;
  private sector: ArenaBuild | null = null;
  private solids: MapData['solids'] = [];
  private elapsed = 0;
  private orbitDirty = true;
  private orbitTime = 0;
  private drawingOrbit = false;

  private renderer: THREE.WebGLRenderer | null = null;
  private postfx: PostFx | null = null;
  private readonly environment = new IndustrialEnvironment();
  private readonly surfaces = new ArenaSurfaces();
  private assetsStarted = false;
  private presetValue: QualityPreset = PRESETS.medium;
  private dprValue = 1;
  private dprCap = Number.POSITIVE_INFINITY;
  private cssWidth = 1;
  private cssHeight = 1;
  private lastCalls = 0;
  private lastTriangles = 0;
  private lastWorldCalls = 0;
  private lastWorldTriangles = 0;
  private disposed = false;
  private contextLost = false;

  // --- camera interpolation state -----------------------------------------
  private readonly interp = new PoseInterpolator();
  private readonly poseIn: Pose = { px: 0, py: 0, pz: 0, yaw: 0, pitch: 0 };
  private readonly poseOut: Pose = { px: 0, py: 0, pz: 0, yaw: 0, pitch: 0 };

  private readonly enemies: EnemyPool;
  readonly objective = new ObjectiveBeacon(this.scene);
  readonly objectiveClip: ObjectiveClip = { x: 0, y: 0, z: 0, w: 0, occluded: false };
  private readonly markerClip = new THREE.Vector4();
  private nodes: MapData['nodes'] = [];

  // --- preallocated scratch (never allocate per frame) ---------------------
  private readonly tmpVec = new THREE.Vector3();
  private readonly impactPoint = new THREE.Vector3();
  private readonly impactNormal = new THREE.Vector3();
  private readonly shotOrigin = new THREE.Vector3();
  private readonly ejectPosition = new THREE.Vector3();
  private readonly ejectVelocity = new THREE.Vector3();
  private readonly muzzleWorld = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly viewToWorld = new THREE.Matrix4();
  private readonly lensCorrection = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement, hooks?: Hooks) {
    this.canvas = canvas;
    this.screenRoot = canvas.closest<HTMLElement>('#app');
    this.hooks = hooks ?? {};

    this.scene.background = new THREE.Color(PALETTE.bg);
    // Fog de densidad por tema (FogExp2): en control es casi nulo para no
    // lavar la escala de valores; en cryo es más denso (vapor).
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Cool ceiling key plus a soft bounce; practical reflection shapes come from IBL.
    this.hemiLight = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.05);
    this.scene.add(this.hemiLight);
    this.dirLight = new THREE.DirectionalLight(PALETTE.sun, 2.3);
    this.dirLight.position.set(-7, 12, 8);
    this.dirLight.shadow.camera.left = -24;
    this.dirLight.shadow.camera.right = 24;
    this.dirLight.shadow.camera.top = 24;
    this.dirLight.shadow.camera.bottom = -24;
    this.dirLight.shadow.camera.near = 1;
    this.dirLight.shadow.camera.far = 60;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.035;
    this.dirLight.shadow.autoUpdate = false;
    this.dirLight.shadow.needsUpdate = true;
    this.scene.add(this.dirLight);
    this.fillLight = new THREE.DirectionalLight(PALETTE.fill, 0.61);
    this.fillLight.position.set(10, 3.5, -9);
    this.scene.add(this.fillLight);
    // Low service accents and a soft key on the concrete riser (Control only).
    for (const x of [-5.7, 5.7]) {
      const practical = new THREE.PointLight(0xff994e, 19, 8.5, 2);
      practical.position.set(x, 1.04, 5.1);
      this.practicals.add(practical);
    }
    const riser = new THREE.PointLight(0xa9e3ff, 31, 9, 2);
    riser.position.set(0.2, 3.4, 5.0);
    this.practicals.add(riser);
    this.scene.add(this.practicals);
    // dedicated viewmodel light, parented to the camera so the gun is always
    // readable regardless of where the arena lights happen to be. Low
    // intensity + dark albedo: the gun must sit BELOW the HUD (~#232b33) and
    // never be the brightest object in the frame.
    const vmLight = new THREE.PointLight(0xb9dfff, 1.25, 2.2, 2);
    vmLight.position.set(-0.24, 0.25, -0.71);
    this.viewCamera.add(vmLight);
    this.viewKey.position.copy(this.dirLight.position);
    this.viewFill.position.copy(this.fillLight.position);
    this.viewFill.intensity = this.fillLight.intensity;
    this.viewScene.add(this.viewCamera, this.viewHemi, this.viewKey, this.viewFill);
    this.applyViewLights(lookFor('control'));

    this.fx = new FxPool(this.scene, this.presetValue.particles);
    const useAuthored = this.hooks.authoredViewmodel ?? new URLSearchParams(window.location.search).get('viewmodel') !== 'kenney';
    this.viewmodel = new Viewmodel(this.viewCamera, useAuthored);
    this.enemies = new EnemyPool(this.scene);

    this.resize();
  }

  /** Creates the WebGL context eagerly; throws if the browser refuses. */
  init(): void {
    this.ensureRenderer();
  }

  get isContextLost(): boolean {
    return this.contextLost;
  }

  /** Switch quality preset; `dprCap` clamps the device pixel ratio. */
  setQuality(preset: QualityName, dprCap?: number): void {
    const p = PRESETS[preset] ?? PRESETS.medium;
    this.presetValue = p;
    this.dirLight.castShadow = p.shadows;
    const size = shadowMapSize(p.name);
    if (this.dirLight.shadow.mapSize.x !== size) {
      this.dirLight.shadow.mapSize.set(size, size);
      this.dirLight.shadow.dispose();
      this.dirLight.shadow.map = null;
      this.dirLight.shadow.mapPass = null;
    }
    this.dirLight.shadow.needsUpdate = p.shadows;
    this.sector?.setQuality(p.name);
    if (this.renderer) {
      // shadow map toggle live; MSAA would need a new context (impossible)
      this.renderer.shadowMap.enabled = p.shadows;
    }
    this.dprCap = dprCap ?? Number.POSITIVE_INFINITY;
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

  /** World plus its shadow/composer draws; foreground is reported separately. */
  get worldCalls(): number { return this.lastWorldCalls; }
  get worldTriangles(): number { return this.lastWorldTriangles; }
  get viewCalls(): number { return this.lastCalls - this.lastWorldCalls; }
  get viewTriangles(): number { return this.lastTriangles - this.lastWorldTriangles; }

  /** Honour devicePixelRatio + current CSS size; call on resize/orientation. */
  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.viewCamera.aspect = this.camera.aspect;
      this.viewCamera.updateProjectionMatrix();
      // At an equal eye depth the world lens needs a wider XY offset to hit
      // the exact pixel of the narrower foreground lens (tracers/casings).
      const ratio = this.viewCamera.projectionMatrix.elements[5] / this.camera.projectionMatrix.elements[5];
      this.lensCorrection.makeScale(ratio, ratio, 1);
      this.viewmodel.setAspect(this.viewCamera.aspect);
      this.cssWidth = w;
      this.cssHeight = h;
    }
    this.orbitDirty = true;
    // Cap the canvas itself too: the output pass still writes every canvas pixel.
    const pixelCap = Math.sqrt(PLAY_PIXEL_BUDGET[this.presetValue.name] / (this.cssWidth * this.cssHeight));
    this.dprValue = Math.min(this.presetValue.dpr, this.dprCap, window.devicePixelRatio || 1, pixelCap);
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(this.dprValue);
      if (w > 0 && h > 0) r.setSize(w, h, false);
      this.postfx?.configure(this.presetValue.name, this.dprValue, this.cssWidth, this.cssHeight);
    }
  }

  /** Menu/loading camera: slow orbit over the arena. */
  renderOrbit(dt: number): void {
    const screen = this.screenRoot?.dataset.screen;
    if (this.contextLost || screen === 'boot') return;
    const r = this.ensureRenderer();
    const animated = !this.hooks.reducedMotion && (screen === 'menu' || screen === 'calibrate' || !screen);
    this.orbitTime += dt;
    if (this.drawingOrbit && !this.orbitDirty && (!animated || this.orbitTime < ORBIT_INTERVAL)) return;
    this.drawingOrbit = true;
    this.orbitDirty = false;
    this.elapsed += this.orbitTime;
    this.rig.orbit(this.camera, animated ? Math.min(this.orbitTime, 0.125) : 0);
    this.orbitTime = 0;
    this.viewmodel.hide();
    this.viewFlash.hide();
    this.enemies.hide();
    this.objective.hide();
    this.sector?.terminals?.update(this.camera, this.elapsed, dt, !!this.hooks.reducedMotion);
    this.fx.update(dt);
    this.feedback.update(dt, this.camera, !!this.hooks.reducedMotion);
    this.draw(r);
    this.startAssets(r);
  }

  /**
   * Combat frame: interpolate the camera between the previous and current
   * player transform by `alpha`, apply recoil + bob, drive enemies, viewmodel
   * and FX from `events`, then render.
   */
  renderGame(state: Snapshot, alpha: number, dt: number, events: readonly WorldEvent[], trackedTerminal = -1): void {
    if (this.contextLost) return;
    const r = this.ensureRenderer();
    this.drawingOrbit = false;
    this.elapsed += dt;

    // 1. camera interpolation (snap on reset / first frame)
    const input = this.poseIn;
    input.px = state.px;
    input.py = state.py;
    input.pz = state.pz;
    input.yaw = state.yaw;
    input.pitch = state.pitch;
    const pose = this.interp.sampleInto(input, state.tick, alpha, this.poseOut);

    // 2. camera: interpolated pose + recoil + grounded bob
    const reducedMotion = this.hooks.reducedMotion === true;
    const bobY = this.rig.firstPerson(this.camera, pose, state, dt, reducedMotion);
    this.updateObjective(trackedTerminal, reducedMotion);
    this.sector?.terminals?.update(this.camera, this.elapsed, dt, reducedMotion, state, trackedTerminal);

    // 3. enemies
    this.enemies.update(state, reducedMotion, this.camera, this.elapsed);

    // 4. Same eye transform and bob/recoil, independent lens and depth.
    this.viewCamera.position.copy(this.camera.position);
    this.viewCamera.quaternion.copy(this.camera.quaternion);
    this.viewCamera.updateMatrixWorld();
    this.viewToWorld.multiplyMatrices(this.camera.matrixWorld, this.lensCorrection).multiply(this.viewCamera.matrixWorldInverse);
    this.camera.getWorldDirection(this.aim);
    this.viewmodel.update(state, dt, bobY, weaponObstruction(this.solids, this.camera.position, this.aim), this.viewToWorld);

    // Age only effects from earlier frames. A shot delivered after a long
    // frame must still render at least one frame at full strength.
    this.fx.update(Math.min(dt, 1 / 12));
    this.viewFlash.update(Math.min(dt, 1 / 12));
    this.feedback.update(Math.min(dt, 1 / 12), this.camera, reducedMotion);
    this.handleEvents(events, state, reducedMotion);

    // 6. render + metrics
    this.draw(r);
    this.startAssets(r);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fx.dispose();
    this.feedback.dispose();
    this.enemies.dispose();
    this.objective.dispose();
    this.disposeSector();
    this.dirLight.shadow.dispose();
    this.viewScene.environment = null; // Borrowed PMREM; the world owns its disposal.
    this.environment.dispose(this.scene);
    this.viewFlash.dispose();
    this.viewmodel.dispose();
    this.viewScene.clear();
    this.surfaces.dispose();
    this.postfx?.dispose();
    this.postfx = null;
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
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** Limpia decals, casquillos y humo: una partida nueva en el mismo mapa no hereda los de la anterior. */
  resetFeedback(): void {
    this.feedback.reset();
  }

  /** Reemplaza la geometría y el look del sector (liberando los anteriores). */
  setSector(map: MapData): void {
    this.disposeSector();
    this.feedback.reset();
    const look = lookFor(map.theme);
    this.applyLook(look);
    this.practicals.visible = map.id === 0;
    this.sector = new ArenaBuild(map, arenaBoxes(map), look, undefined, this.surfaces);
    this.sector.setQuality(this.presetValue.name);
    this.scene.add(this.sector.group);
    this.dirLight.shadow.needsUpdate = true;
    this.orbitDirty = true;
    this.solids = map.solids;
    this.nodes = map.nodes;
    this.objective.setMap(map);
  }

  private updateObjective(index: number, reducedMotion: boolean): void {
    const node = this.nodes[index];
    if (!node) { this.objective.hide(); return; }
    this.objective.update(index, node, this.camera, this.elapsed, reducedMotion);
    const { x, y, z } = this.objective.position;
    const clip = this.markerClip.set(x, y, z, 1).applyMatrix4(this.camera.matrixWorldInverse).applyMatrix4(this.camera.projectionMatrix);
    this.objectiveClip.x = clip.x;
    this.objectiveClip.y = clip.y;
    this.objectiveClip.z = clip.z;
    this.objectiveClip.w = clip.w;
    this.objectiveClip.occluded = objectiveOccluded(this.solids, this.camera.position, this.objective.occlusionPoint);
    // The HUD can move clear of the reticle; suppress the world glyph if it would sit inside it.
    if (clip.w > 0 && Math.abs(clip.x / clip.w) * this.cssWidth < 130 && Math.abs(clip.y / clip.w) * this.cssHeight < 130) {
      this.objective.hideIcon();
    }
  }

  // --- internals -----------------------------------------------------------

  private ensureRenderer(): THREE.WebGLRenderer {
    if (this.renderer) return this.renderer;
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false, // MSAA lives on the composer target, see header note
      powerPreference: 'high-performance',
      alpha: false,
    });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.environmentIntensity = 0.41;
    this.scene.environmentRotation.y = 2.28;
    this.viewScene.environmentIntensity = this.scene.environmentIntensity;
    this.viewScene.environmentRotation.copy(this.scene.environmentRotation);
    r.shadowMap.enabled = this.presetValue.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.autoClear = false; // The world clears normally; the foreground clears depth only.
    r.info.autoReset = false; // draw() resets once per frame, not per pass
    this.renderer = r;
    this.postfx = new PostFx(r, this.scene, this.camera);
    // three.js ya hace preventDefault en 'webglcontextlost' y reinicia estado en
    // 'webglcontextrestored'; el shell solo necesita enterarse para pausar.
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resize();
    // debugging/metrics hook: window.__BREACH__.renderer.{calls,triangles}.
    // Merge, never replace: main.ts exposes the GameApp shell here first and
    // the e2e/diagnostics handle must keep working once the renderer boots.
    const w = window as unknown as { __BREACH__?: Record<string, unknown> };
    w.__BREACH__ = Object.assign(w.__BREACH__ ?? {}, { renderer: this });
    return r;
  }

  /** Start streamed art only after rendering the first non-boot screen. */
  private startAssets(r: THREE.WebGLRenderer): void {
    if (this.assetsStarted || this.screenRoot?.dataset.screen === 'boot') return;
    this.assetsStarted = true;
    this.surfaces.load(r, () => {
      this.viewmodel.setMetalMaps(this.surfaces.materials[SURFACE.metal]);
      this.orbitDirty = true;
    });
    this.viewmodel.load();
    void this.environment.load().then(() => {
      if (this.disposed || this.contextLost) return;
      this.installEnvironment(r);
      this.orbitDirty = true;
    }).catch((error: unknown) => {
      if (!this.disposed) console.warn('Industrial HDRI unavailable: using direct lights', error);
    });
  }

  private installEnvironment(r: THREE.WebGLRenderer): void {
    this.environment.install(r, this.scene);
    this.viewScene.environment = this.scene.environment;
    this.surfaces.setFloorEnvironment(this.scene.environment, this.scene.environmentRotation);
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.hooks.onContextLost?.();
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
    if (this.renderer) this.installEnvironment(this.renderer);
    this.dirLight.shadow.needsUpdate = true;
    this.postfx?.rebuild();
    this.resize();
    this.hooks.onContextRestored?.();
  };

  /** One frame: reset the counters once, render through the composer or directly, record metrics. */
  private draw(r: THREE.WebGLRenderer): void {
    this.sector?.setTime(this.elapsed);
    r.info.reset();
    if (this.postfx) this.postfx.render();
    else r.render(this.scene, this.camera);
    this.lastWorldCalls = r.info.render.calls;
    this.lastWorldTriangles = r.info.render.triangles;
    if (!this.drawingOrbit) {
      // After OutputPass, retain the canvas color and give the gun fresh depth.
      // Direct-to-canvas Three materials still apply ACES/sRGB, but not bloom/MSAA.
      r.setRenderTarget(null);
      r.clearDepth();
      r.render(this.viewScene, this.viewCamera);
    }
    this.lastCalls = r.info.render.calls;
    this.lastTriangles = r.info.render.triangles;
  }

  private disposeSector(): void {
    this.sector?.dispose();
    this.sector = null;
  }

  /** Luces, niebla y fondo del tema. Los objetos se reusan: sin allocations por cambio. */
  private applyLook(look: ThemeLook): void {
    this.scene.background = new THREE.Color(look.background);
    this.fog.color.setHex(look.fogColor);
    this.fog.density = look.fogDensity;
    this.hemiLight.color.setHex(look.hemiSky);
    this.hemiLight.groundColor.setHex(look.hemiGround);
    this.hemiLight.intensity = look.hemiIntensity;
    this.dirLight.color.setHex(look.sun);
    this.dirLight.intensity = look.sunIntensity;
    this.fillLight.color.setHex(look.fill);
    this.applyViewLights(look);
  }

  private applyViewLights(look: ThemeLook): void {
    this.viewHemi.color.setHex(look.hemiSky);
    this.viewHemi.groundColor.setHex(look.hemiGround);
    this.viewHemi.intensity = look.hemiIntensity;
    this.viewKey.color.setHex(look.sun);
    this.viewKey.intensity = look.sunIntensity;
    this.viewFill.color.setHex(look.fill);
  }

  private casingFloor(): number {
    let floor = 0;
    const { x, y, z } = this.ejectPosition;
    for (const solid of this.solids) {
      if (x >= solid.min[0] && x <= solid.max[0] && z >= solid.min[2] && z <= solid.max[2]
        && solid.max[1] < y) floor = Math.max(floor, solid.max[1]);
    }
    return floor;
  }

  private handleEvents(events: readonly WorldEvent[], state: Snapshot, reduced: boolean): void {
    let first = 0;
    for (let i = 0; i < events.length; i += 1) {
      const ev = events[i];
      switch (ev.type) {
        case EVT.shot: {
          // WASM emits pellet impacts before SHOT. Pair in the same event slice.
          const weapon = ev.a || state.weapon;
          this.viewmodel.fire(weapon);
          this.viewmodel.muzzleWorld(weapon, this.muzzleWorld);
          const socket = this.viewmodel.muzzleSocket(weapon);
          this.viewFlash.show(this.muzzleWorld, this.viewmodel.flashSize(weapon) * 1.18, socket);
          this.shotOrigin.set(ev.b, ev.c, ev.d);
          this.viewmodel.ejectFrame(weapon, this.ejectPosition, this.ejectVelocity);
          this.feedback.eject(this.ejectPosition, this.ejectVelocity, this.casingFloor(), weapon === WEAPON.shotgun);
          this.feedback.shot(this.muzzleWorld, this.camera, reduced);
          let traced = false;
          for (let j = first; j < i; j += 1) {
            const hit = events[j];
            if (hit.type !== EVT.wallHit && hit.type !== EVT.enemyHit) continue;
            this.tmpVec.set(hit.a, hit.b, hit.c);
            if (!traced) {
              if (this.presetValue.name === 'high') this.fx.tracer(this.muzzleWorld, this.tmpVec, this.viewmodel.worldMuzzleSocket(weapon));
              else this.feedback.trace(this.muzzleWorld, this.tmpVec, this.camera);
              traced = true;
            }
            if (hit.type === EVT.wallHit && impactFace(this.solids, this.tmpVec, this.shotOrigin, this.impactPoint, this.impactNormal)) {
              this.feedback.mark(this.impactPoint, this.impactNormal);
            }
          }
          first = i + 1;
          break;
        }
        case EVT.wallHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          // Housings and paint can sit just ahead of the collision plane.
          this.tmpVec.lerp(this.camera.position, Math.min(1, 0.22 / Math.max(this.tmpVec.distanceTo(this.camera.position), 0.001)));
          this.fx.impact(this.tmpVec, impactColour(this.solids, ev.a, ev.b, ev.c));
          break;
        }
        case EVT.enemyHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          this.fx.impact(this.tmpVec, PALETTE.impactEnemy);
          break;
        }
        case EVT.enemyDied: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          this.fx.burst(this.tmpVec, 22, PALETTE.impactEnemy);
          this.fx.burst(this.tmpVec, 16, PALETTE.death);
          this.tmpVec.y += 0.42;
          this.fx.burst(this.tmpVec, 10, 0xffd29c);
          break;
        }
        case EVT.nodeActivated:
          this.feedback.pulse(ev.b, this.nodes[ev.a]?.y ?? 0, ev.c, reduced);
          break;
        case EVT.enemyShot: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          if (this.presetValue.name === 'high') {
            this.fx.muzzle(this.tmpVec);
            this.fx.tracer(this.tmpVec, this.camera.position);
          } else {
            this.feedback.flash(this.tmpVec, 0.24, this.camera);
            this.feedback.trace(this.tmpVec, this.ejectVelocity.copy(this.camera.position).lerp(this.tmpVec, 0.06), this.camera);
          }
          break;
        }
        default:
          break; // unknown event types are ignored, never thrown
      }
    }
  }
}

/** Shadow map resolution per preset (medium shares the same light, cheaper). */
function shadowMapSize(name: QualityName): number {
  return name === 'high' ? 2048 : 1024;
}
