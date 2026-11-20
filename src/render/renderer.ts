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
import { EVT } from '../wasm/protocol';
import { ArenaBuild } from './arena';
import { CameraRig } from './camera';
import { disposeRobotAssets } from './entities';
import { EnemyPool } from './enemies';
import { FxPool, impactColour } from './fx';
import { PoseInterpolator } from './interp';
import { PRESETS, type QualityName, type QualityPreset } from './presets';
import { PostFx } from './postfx';
import { lookFor, PALETTE, type ThemeLook } from './themes';
import { Viewmodel } from './viewmodel';

export type { QualityName, QualityPreset } from './presets';

export interface Hooks {
  reducedMotion?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const CAMERA_FOV = 75;

export class Renderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly hooks: Hooks;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly hemiLight: THREE.HemisphereLight;
  private readonly dirLight: THREE.DirectionalLight;
  private readonly fog = new THREE.FogExp2(PALETTE.bg, 0);
  private readonly fx: FxPool;
  private readonly rig = new CameraRig();
  private readonly viewmodel: Viewmodel;
  private sector: ArenaBuild | null = null;
  private solids: MapData['solids'] = [];
  private elapsed = 0;

  private renderer: THREE.WebGLRenderer | null = null;
  private postfx: PostFx | null = null;
  private presetValue: QualityPreset = PRESETS.medium;
  private dprValue = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private lastCalls = 0;
  private lastTriangles = 0;
  private disposed = false;
  private contextLost = false;

  // --- camera interpolation state -----------------------------------------
  private readonly interp = new PoseInterpolator();

  private readonly enemies: EnemyPool;

  // --- preallocated scratch (never allocate per frame) ---------------------
  private readonly tmpVec = new THREE.Vector3();
  private readonly pendingOrigin = new THREE.Vector3();
  private readonly muzzleWorld = new THREE.Vector3();
  private pendingValid = false;

  constructor(canvas: HTMLCanvasElement, hooks?: Hooks) {
    this.canvas = canvas;
    this.hooks = hooks ?? {};

    this.scene.background = new THREE.Color(PALETTE.bg);
    // Fog de densidad por tema (FogExp2): en control es casi nulo para no
    // lavar la escala de valores; en cryo es más denso (vapor).
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // lights: hemisphere base + modelling sun + weak fill; shadows on `high`.
    // Moderate physical intensities — the ladder is carried by albedo + light
    // shape, not giant multipliers (the old intensity-9 rig flattened it).
    this.hemiLight = new THREE.HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 3.75);
    this.scene.add(this.hemiLight);
    this.dirLight = new THREE.DirectionalLight(PALETTE.sun, 3.2);
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
    const fillLight = new THREE.DirectionalLight(PALETTE.fill, 2.2);
    fillLight.position.set(-10, 3.5, -9);
    this.scene.add(fillLight);
    // dedicated viewmodel light, parented to the camera so the gun is always
    // readable regardless of where the arena lights happen to be. Low
    // intensity + dark albedo: the gun must sit BELOW the HUD (~#232b33) and
    // never be the brightest object in the frame.
    const vmLight = new THREE.PointLight(0xdfeaf2, 2.2, 2.2, 2);
    vmLight.position.set(0.3, 0.15, 0.25);
    this.camera.add(vmLight);

    this.fx = new FxPool(this.scene, this.presetValue.particles);
    this.viewmodel = new Viewmodel(this.camera);
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
      this.cssWidth = w;
      this.cssHeight = h;
    }
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(this.dprValue);
      if (w > 0 && h > 0) r.setSize(w, h, false);
      this.postfx?.configure(this.presetValue.name, this.dprValue, this.cssWidth, this.cssHeight);
    }
  }

  /** Menu/loading camera: slow orbit over the arena. */
  renderOrbit(dt: number): void {
    if (this.contextLost) return;
    const r = this.ensureRenderer();
    this.elapsed += dt;
    this.rig.orbit(this.camera, dt);
    this.viewmodel.hide();
    this.draw(r);
  }

  /**
   * Combat frame: interpolate the camera between the previous and current
   * player transform by `alpha`, apply recoil + bob, drive enemies, viewmodel
   * and FX from `events`, then render.
   */
  renderGame(state: Snapshot, alpha: number, dt: number, events: readonly WorldEvent[]): void {
    if (this.contextLost) return;
    const r = this.ensureRenderer();
    this.elapsed += dt;

    // 1. camera interpolation (snap on reset / first frame)
    const pose = this.interp.sample(
      { px: state.px, py: state.py, pz: state.pz, yaw: state.yaw, pitch: state.pitch },
      state.tick,
      alpha,
    );

    // 2. camera: interpolated pose + recoil + grounded bob
    const reducedMotion = this.hooks.reducedMotion === true;
    const bobY = this.rig.firstPerson(this.camera, pose, state, dt, reducedMotion);

    // 3. enemies
    this.enemies.update(state, reducedMotion, this.camera, this.elapsed);

    // 4. viewmodel
    this.viewmodel.update(state, dt, bobY);

    // 5. events -> FX
    this.handleEvents(events, state.weapon);
    this.fx.update(dt);

    // 6. render + metrics
    this.draw(r);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fx.dispose();
    this.enemies.dispose();
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
    disposeRobotAssets();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer?.dispose();
    this.renderer = null;
  }

  /** Reemplaza la geometría y el look del sector (liberando los anteriores). */
  setSector(map: MapData): void {
    this.disposeSector();
    const look = lookFor(map.theme);
    this.applyLook(look);
    this.sector = new ArenaBuild(map, arenaBoxes(map), look);
    this.scene.add(this.sector.group);
    this.solids = map.solids;
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
    r.toneMapping = THREE.NoToneMapping; // the ladder is authored in raw sRGB
    r.shadowMap.enabled = this.presetValue.shadows;
    r.shadowMap.type = THREE.PCFShadowMap;
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

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.hooks.onContextLost?.();
  };

  private onContextRestored = (): void => {
    this.contextLost = false;
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
  }

  private handleEvents(events: readonly WorldEvent[], weapon: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case EVT.shot: {
          this.viewmodel.muzzleWorld(weapon, this.muzzleWorld);
          this.fx.muzzle(this.muzzleWorld, this.viewmodel.flashSize(weapon));
          this.pendingOrigin.copy(this.muzzleWorld);
          this.pendingValid = true;
          break;
        }
        case EVT.wallHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          if (this.pendingValid) this.fx.tracer(this.pendingOrigin, this.tmpVec);
          this.fx.impact(this.tmpVec, impactColour(this.solids, ev.a, ev.b, ev.c));
          this.pendingValid = false;
          break;
        }
        case EVT.enemyHit: {
          this.tmpVec.set(ev.a, ev.b, ev.c);
          if (this.pendingValid) this.fx.tracer(this.pendingOrigin, this.tmpVec);
          this.fx.impact(this.tmpVec, PALETTE.impactEnemy);
          this.pendingValid = false;
          break;
        }
        case EVT.enemyDied: {
          // dos capas: chispas rojas del cuerpo y menta de la energía que se libera
          this.tmpVec.set(ev.a, ev.b, ev.c);
          this.fx.burst(this.tmpVec, 22, PALETTE.impactEnemy);
          this.fx.burst(this.tmpVec, 16, PALETTE.death);
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

/** Shadow map resolution per preset (medium shares the same light, cheaper). */
function shadowMapSize(name: QualityName): number {
  return name === 'high' ? 2048 : 1024;
}
