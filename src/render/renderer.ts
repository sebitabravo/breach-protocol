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
import { PRESETS, MIN_RENDER_SCALE, playPixelRatio, resolveGfxPlan, type QualityName, type QualityPreset } from './presets';
import { sharedResolutionPolicy, type ResolutionDecision, type ResolutionPolicy } from '../core/resolution-policy';
import { postPlan, PostFx } from './postfx';
import { E, ENEMY_BASE, ENEMY_STATE, ENEMY_STRIDE, MAX_ENEMIES, MAX_NODES } from '../wasm/protocol';
import type { GfxOverrides } from '../core/settings';
import { lookFor, PALETTE, type ThemeLook } from './themes';
import { CAMERA_FOV, VIEW_FOV, VIEW_NEAR, Viewmodel } from './viewmodel';
import { weaponObstruction } from './weapon-clearance';

export type { QualityName, QualityPreset } from './presets';

/** Los cuatro overlays de engineering mode (T5e). Cada uno se enciende por su cuenta. */
export type OverlayKey = 'bounds' | 'collision' | 'camera' | 'passes';

export interface OverlayPlan {
  /** Ejes + rejilla + AABB de enemigos y terminales. */
  bounds: boolean;
  /** Cápsula del jugador y radio de interacción del objetivo. */
  collision: boolean;
  /** Lectura de cámara en el panel (posición, yaw/pitch, fov). */
  camera: boolean;
  /** Lectura de draw calls por pase en el panel. */
  passes: boolean;
}

export interface CameraReadout {
  px: number;
  py: number;
  pz: number;
  yaw: number;
  pitch: number;
  fov: number;
}

export interface PassCounts {
  world: number;
  shadow: number;
  viewmodel: number;
  composer: number;
}

const OVERLAY_KEYS: OverlayKey[] = ['bounds', 'collision', 'camera', 'passes'];

/**
 * Espejos de constantes de la simulación para dibujar el overlay con la Forma
 * VERDADERA de la colisión. `terminal-model.ts` ya usa este patrón: un cambio
 * en el núcleo debe actualizar estos valores o el overlay miente.
 * core/src/player.rs RADIUS/HEIGHT · core/src/enemy.rs KindDef radius/height ·
 * core/src/sim.rs NODE_RADIUS y NODE_VERTICAL_REACH.
 */
const PLAYER_RADIUS = 0.36;
const PLAYER_HEIGHT = 1.8;
const NODE_RADIUS = 1.9;
const NODE_REACH = 1.2;
const ENEMY_BOX: Record<number, { r: number; h: number }> = {
  0: { r: 0.42, h: 1.7 }, // scout
  1: { r: 0.45, h: 1.95 }, // sentinel
  2: { r: 0.4, h: 1.75 }, // interceptor
};

/** Los 12 pares de esquinas de una caja (índices por bit signo: 1=x, 2=y, 4=z). */
const BOX_CORNERS = BOX_CORNERS_BUILD();

function BOX_CORNERS_BUILD(): Uint8Array {
  const edges: Array<[number, number]> = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6],
    [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
  ];
  const table = new Uint8Array(edges.length * 2);
  let at = 0;
  for (const [a, b] of edges) {
    table[at] = a;
    table[at + 1] = b;
    at += 2;
  }
  return table;
}

/** Escribe un AABB centrado en (cx,cy,cz) con semiejes (hx,hy,hz) como 12 aristas a partir de `at`. */
function writeBox(into: Float32Array, at: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): number {
  for (let e = 0; e < 24; e += 1) {
    const c = BOX_CORNERS[e];
    const o = at + e * 3;
    into[o] = cx + (c & 1 ? hx : -hx);
    into[o + 1] = cy + (c & 2 ? hy : -hy);
    into[o + 2] = cz + (c & 4 ? hz : -hz);
  }
  return at + 24 * 3;
}

/**
 * Overlays de debug del renderer (T5e). Todos comparten tres reglas:
 * 1. están detrás de telemetry: `setTelemetry(false)` fuerza el plan entero a apagado;
 * 2. con todo apagado no agregan NI UN objeto a la escena (el grupo se desmonta),
 *    así que draw calls y costo de frame quedan idénticos al baseline;
 * 3. nada se reserva por frame: las posiciones se escriben en buffers
 *    preallocados y las geometrías se crean solo la primera vez que se encienden.
 */
export class DebugOverlays {
  private readonly scene: THREE.Scene;
  private telemetryOn = false;
  /** Plan actual; el panel lo lee y no debe mutarlo. */
  readonly plan: OverlayPlan = { bounds: false, collision: false, camera: false, passes: false };
  /** Grupo raíz; se agrega a la escena solo mientras haya overlay de escena activo. */
  readonly group = new THREE.Group();
  private boundsLayer: THREE.Group | null = null;
  private collisionLayer: THREE.Group | null = null;
  // Escena: creados una vez, escritos por frame sin reservas.
  private readonly grid = new THREE.GridHelper(40, 20, PALETTE.glow, 0x2e4a44);
  private readonly axes = new THREE.AxesHelper(1.6);
  private readonly seen = new Uint8Array(MAX_ENEMIES);
  private readonly enemyPos = new Float32Array(MAX_ENEMIES * 24 * 3);
  private readonly terminalPos = new Float32Array(MAX_NODES * 24 * 3);
  private readonly scratch = new Float32Array(24 * 3);
  private enemyBoxes: THREE.LineSegments | null = null;
  private terminalBoxes: THREE.LineSegments | null = null;
  private capsule: THREE.LineSegments | null = null;
  private nodeRing: THREE.LineLoop | null = null;
  private ringMat: THREE.LineBasicMaterial | null = null;
  private nodeReach: THREE.LineSegments | null = null;
  /** Lectura de cámara para el panel; siempre preallocado, se escribe en update(). */
  readonly camera: CameraReadout = { px: 0, py: 0, pz: 0, yaw: 0, pitch: 0, fov: 0 };
  /** Draw calls del último frame por pase (world / sombra / viewmodel / composer). */
  readonly passes: PassCounts = { world: 0, shadow: 0, viewmodel: 0, composer: 0 };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group.name = 'debug-overlays';
  }

  /** Verdadero con algún overlay encendido y telemetry activo. */
  get active(): boolean {
    if (!this.telemetryOn) return false;
    for (const key of OVERLAY_KEYS) if (this.plan[key]) return true;
    return false;
  }

  /** El probe de pases se instala solo mientras se lee la atribución de draw calls. */
  get probeWanted(): boolean {
    return this.telemetryOn && this.plan.passes;
  }

  setTelemetry(on: boolean): void {
    this.telemetryOn = on;
    if (!on) for (const key of OVERLAY_KEYS) this.plan[key] = false;
    this.sync();
  }

  setOverlay(key: OverlayKey, on: boolean): void {
    // telemetry apagado manda: sin panel abierto no hay overlays encendibles.
    if (!this.telemetryOn) return;
    this.plan[key] = on;
    this.sync();
  }

  /**
   * Uno por frame desde renderGame, SOLO si `active` (cero costo cuando todo está
   * apagado). No reserva memoria: escribe en buffers preallocados.
   */
  update(state: Snapshot, camera: THREE.PerspectiveCamera, nodes: MapData['nodes'], tracked: number): void {
    if (!this.active) return;
    if (this.plan.camera) {
      this.camera.px = camera.position.x;
      this.camera.py = camera.position.y;
      this.camera.pz = camera.position.z;
      this.camera.yaw = camera.rotation.y;
      this.camera.pitch = camera.rotation.x;
      this.camera.fov = camera.fov;
    }
    if (this.plan.bounds && this.enemyBoxes && this.terminalBoxes) this.updateBounds(state, nodes);
    if (this.plan.collision && this.capsule && this.nodeRing) this.updateCollision(state, nodes, tracked);
  }

  // --- construcción perezosa: cada capa nace la primera vez que se enciende ---

  private sync(): void {
    const wanted = this.plan.bounds || this.plan.collision;
    if (wanted) {
      if (this.group.parent !== this.scene) this.scene.add(this.group);
      if (this.plan.bounds) this.ensureBounds();
      if (this.plan.collision) this.ensureCollision();
    } else {
      this.scene.remove(this.group); // baseline restaurado: cero objetos, cero draws
    }
    if (this.boundsLayer) this.boundsLayer.visible = this.plan.bounds;
    if (this.collisionLayer) this.collisionLayer.visible = this.plan.collision;
  }

  private flat(material: THREE.LineBasicMaterial): THREE.LineBasicMaterial {
    material.transparent = true;
    material.depthTest = false; // el overlay se lee a través de la arena
    material.toneMapped = false; // colores del panel, no del lookup de la escena
    return material;
  }

  private ensureBounds(): void {
    if (this.boundsLayer) return;
    const layer = new THREE.Group();
    layer.visible = this.plan.bounds;
    const grey = (hex: number, opacity: number): THREE.LineBasicMaterial =>
      this.flat(new THREE.LineBasicMaterial({ color: hex, opacity, transparent: true }));
    this.grid.material = grey(0x2e4a44, 0.5);
    this.grid.renderOrder = 950;
    this.axes.material = grey(PALETTE.impactWall, 0.9);
    this.axes.renderOrder = 951;
    const enemyGeometry = new THREE.BufferGeometry();
    enemyGeometry.setAttribute('position', new THREE.BufferAttribute(this.enemyPos, 3).setUsage(THREE.DynamicDrawUsage));
    enemyGeometry.setDrawRange(0, 0);
    this.enemyBoxes = new THREE.LineSegments(enemyGeometry, grey(PALETTE.impactEnemy, 0.85));
    this.enemyBoxes.renderOrder = 952;
    this.enemyBoxes.frustumCulled = false;
    const terminalGeometry = new THREE.BufferGeometry();
    terminalGeometry.setAttribute('position', new THREE.BufferAttribute(this.terminalPos, 3).setUsage(THREE.DynamicDrawUsage));
    terminalGeometry.setDrawRange(0, 0);
    this.terminalBoxes = new THREE.LineSegments(terminalGeometry, grey(0xffb35c, 0.85));
    this.terminalBoxes.renderOrder = 953;
    this.terminalBoxes.frustumCulled = false;
    layer.add(this.grid, this.axes, this.enemyBoxes, this.terminalBoxes);
    this.group.add(layer);
    this.boundsLayer = layer;
  }

  private ensureCollision(): void {
    if (this.collisionLayer) return;
    const layer = new THREE.Group();
    layer.visible = this.plan.collision;
    const grey = (hex: number, opacity: number): THREE.LineBasicMaterial =>
      this.flat(new THREE.LineBasicMaterial({ color: hex, opacity, transparent: true }));
    const capsuleShape = new THREE.WireframeGeometry(new THREE.CapsuleGeometry(PLAYER_RADIUS, PLAYER_HEIGHT - 2 * PLAYER_RADIUS, 3, 12));
    this.capsule = new THREE.LineSegments(capsuleShape, grey(PALETTE.glow, 0.6));
    this.capsule.renderOrder = 954;
    this.capsule.frustumCulled = false;
    const circle: number[] = [];
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * Math.PI * 2;
      circle.push(Math.cos(a) * NODE_RADIUS, Math.sin(a) * NODE_RADIUS, 0);
    }
    const ringGeometry = new THREE.BufferGeometry();
    ringGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(circle), 3));
    this.ringMat = grey(PALETTE.glow, 0.95);
    this.nodeRing = new THREE.LineLoop(ringGeometry, this.ringMat);
    this.nodeRing.rotation.x = -Math.PI / 2;
    this.nodeRing.renderOrder = 955;
    const reachGeometry = new THREE.BufferGeometry();
    reachGeometry.setAttribute('position', new THREE.BufferAttribute(this.scratch.subarray(0, 6), 3).setUsage(THREE.DynamicDrawUsage));
    this.nodeReach = new THREE.LineSegments(reachGeometry, grey(0xffb35c, 0.7));
    this.nodeReach.renderOrder = 956;
    layer.add(this.capsule, this.nodeRing, this.nodeReach);
    this.group.add(layer);
    this.collisionLayer = layer;
  }

  private updateBounds(state: Snapshot, nodes: MapData['nodes']): void {
    const f = state.float;
    const into = this.enemyPos;
    let at = 0;
    let count = 0;
    for (let i = 0; i < MAX_ENEMIES; i += 1) {
      const base = ENEMY_BASE + i * ENEMY_STRIDE;
      const st = f[base + E.state];
      if (st === ENEMY_STATE.dead) {
        this.seen[i] = 0;
        continue;
      }
      // Slot sin spawnear: state 0 y posición nula; un scout real marca `seen` en patrulla.
      if (!this.seen[i] && st === ENEMY_STATE.spawn) continue;
      this.seen[i] = 1;
      const box = ENEMY_BOX[f[base + E.kind]] ?? ENEMY_BOX[0];
      at = writeBox(into, at, f[base + E.x], f[base + E.y] + box.h * 0.5, f[base + E.z], box.r, box.h * 0.5, box.r);
      count += 1;
    }
    (this.enemyBoxes!.geometry as THREE.BufferGeometry).setDrawRange(0, count * 24);
    (this.enemyBoxes!.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    at = 0;
    count = Math.min(nodes.length, MAX_NODES);
    for (let i = 0; i < count; i += 1) {
      const node = nodes[i];
      at = writeBox(this.terminalPos, at, node.x, node.y + 0.9, node.z, 0.5, 0.9, 0.5);
    }
    (this.terminalBoxes!.geometry as THREE.BufferGeometry).setDrawRange(0, at / 3);
    (this.terminalBoxes!.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateCollision(state: Snapshot, nodes: MapData['nodes'], tracked: number): void {
    // La cápsula del núcleo es feet-anchored: Aabb::from_feet(pos, RADIUS, HEIGHT).
    this.capsule!.position.set(state.px, state.py + PLAYER_HEIGHT * 0.5, state.pz);
    const node = tracked >= 0 ? nodes[tracked] : undefined;
    if (!node) {
      this.nodeRing!.visible = false;
      this.nodeReach!.visible = false;
      return;
    }
    this.nodeRing!.visible = true;
    this.nodeRing!.position.set(node.x, node.y + 0.02, node.z);
    // El núcleo marca `interacting` cuando el jugador está dentro del radio y del
    // nivel vertical: mismo test que core/src/sim.rs update_nodes.
    this.ringMat!.color.setHex(state.interacting === tracked ? PALETTE.death : PALETTE.impactWall);
    this.nodeReach!.visible = true;
    this.nodeReach!.position.set(node.x, 0, node.z);
    this.scratch[0] = node.x; this.scratch[1] = node.y - NODE_REACH; this.scratch[2] = node.z;
    this.scratch[3] = node.x; this.scratch[4] = node.y + NODE_REACH; this.scratch[5] = node.z;
    (this.nodeReach!.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

export interface Hooks {
  reducedMotion?: boolean;
  /** Set false to use the licensed Kenney viewmodel fallback. */
  authoredViewmodel?: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const ORBIT_INTERVAL = 1 / 8;

/** Firma de renderBufferDirect; el probe de pases la envuelve (solo con el overlay `passes`). */
type RenderBufferDirectFn = THREE.WebGLRenderer['renderBufferDirect'];

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
  /** Overrides por efecto del jugador (T5a); `syncSettingsUI` los emite vía setGfx. */
  private gfx: GfxOverrides = {
    gfxBloom: 'auto', gfxShadows: 'auto', gfxEnvironment: 'auto', gfxLights: 'auto', gfxMist: 'auto',
  };
  /** El HDRI termina de decodificar en async; sincroniza los intents de install/clear. */
  private hdriLoaded = false;
  private sectorId = -1;
  private dprValue = 1;
  private dprCap = Number.POSITIVE_INFINITY;
  private cssWidth = 1;
  private cssHeight = 1;
  /**
   * Dueño único de la decisión de resolución (P3): la política decide preset y
   * escala — y la razón — acá solo se aplica lo decidido. El renderer alimenta
   * su puerto con el intervalo real de rAF de cada frame de juego.
   */
  private readonly policy: ResolutionPolicy;
  /** performance.now() del draw anterior de juego; alimenta el controlador de escala. */
  private lastFrameAt = 0;
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
  /** Overlays de engineering (T5e): se construyen perezosos y no agregan nada hasta que se encienden. */
  readonly debug = new DebugOverlays(this.scene);
  private passProbeDirect: RenderBufferDirectFn | null = null;
  private readonly passProbe: RenderBufferDirectFn = (camera, scene, geometry, material, object, group) => {
    // Clasifica CADA draw call por su pase real: el target del mapa de sombras,
    // la escena del mundo, la escena del viewmodel o los quads del composer
    // (bloom/output). Test de bajo costo: una comparación por pase sobre la
    // información que ya maneja el renderer; solo existe mientras el panel lee
    // `passes` (telemetry + overlay encendido).
    const counts = this.debug.passes;
    const target = this.renderer?.getRenderTarget();
    if (target !== null && target === this.dirLight.shadow.map) counts.shadow += 1;
    else if (scene === this.scene) counts.world += 1;
    else if (scene === this.viewScene) counts.viewmodel += 1;
    else counts.composer += 1;
    this.passProbeDirect?.(camera, scene, geometry, material, object, group);
  };

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
    this.policy = sharedResolutionPolicy();

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
    const size = shadowMapSize(p.name);
    if (this.dirLight.shadow.mapSize.x !== size) {
      this.dirLight.shadow.mapSize.set(size, size);
      this.dirLight.shadow.dispose();
      this.dirLight.shadow.map = null;
      this.dirLight.shadow.mapPass = null;
    }
    // El tamaño del shadow map es del preset; el override solo activa/desactiva el pase.
    this.applyShadows(resolveGfxPlan(p, this.gfx).shadows);
    this.sector?.setQuality(p.name);
    this.dprCap = dprCap ?? Number.POSITIVE_INFINITY;
    this.fx.setBudget(p.particles);
    // Un preset (baja del controlador o cambio manual) ya es un cambio de costo:
    // la escala vuelve a su techo para no acumular doble castigo sobre el nuevo,
    // y el ciclo de recorte arranca limpio en el presupuesto del preset nuevo.
    this.setAdaptiveScale(1);
    this.resize();
  }

  /**
   * Fija el factor adaptativo desde afuera (driver externo, futuro toggle del jugador).
   * La escala se fija en la política: la decisión siguiente parte de ahí.
   */
  setAdaptiveScale(scale: number): void {
    const s = Number.isFinite(scale) ? Math.min(1, Math.max(MIN_RENDER_SCALE, scale)) : 1;
    this.policy.resetScale(s);
    this.applyAdaptiveScale();
  }

  /** Factor adaptativo vigente (1 = presupuesto completo): lo lee el panel de engineering. */
  get renderScale(): number {
    return this.policy.scale;
  }

  /** Última decisión del dueño único de resolución (preset + escala + razón): la lee el panel. */
  get resolution(): ResolutionDecision {
    return this.policy.decision;
  }

  /**
   * Parche de overrides gráficos por efecto (T5a). El formulario lo emite con
   * los cinco estados actuales tras cada ajuste; aplicar es idempotente.
   */
  setGfx(patch: Partial<GfxOverrides>): void {
    const next = { ...this.gfx, ...patch };
    if (next.gfxBloom === this.gfx.gfxBloom && next.gfxShadows === this.gfx.gfxShadows
      && next.gfxEnvironment === this.gfx.gfxEnvironment && next.gfxLights === this.gfx.gfxLights
      && next.gfxMist === this.gfx.gfxMist) return;
    this.gfx = next;
    this.applyGfx();
  }

  /** Re-aplica el plan de efectos resuelto contra el preset vigente. Idempotente. */
  private applyGfx(): void {
    const plan = resolveGfxPlan(this.presetValue, this.gfx);
    this.applyShadows(plan.shadows);
    this.applyEnvironment();
    this.applyPracticals();
    this.applyMist();
    this.postfx?.configure(this.presetValue.name, this.dprValue, this.cssWidth, this.cssHeight, this.gfx.gfxBloom);
    this.orbitDirty = true;
  }

  get preset(): QualityPreset {
    return this.presetValue;
  }

  /** Plan de postprocesado resuelto del frame actual; lo lee el panel de engineering. */
  get postFxPlan(): { bloom: boolean; composer: boolean; msaaSamples: number } {
    return {
      ...postPlan(this.presetValue.name, this.gfx.gfxBloom),
      composer: this.postfx?.usesComposer ?? false,
    };
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
    this.dprValue = this.computeDpr();
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(this.dprValue);
      if (w > 0 && h > 0) r.setSize(w, h, false);
      this.postfx?.configure(this.presetValue.name, this.dprValue, this.cssWidth, this.cssHeight, this.gfx.gfxBloom);
    }
  }

  /** DPR efectivo del preset vigente, incluido el recorte decidido por la política. */
  private computeDpr(): number {
    return playPixelRatio(this.presetValue, this.cssWidth, this.cssHeight, this.dprCap, window.devicePixelRatio || 1, this.policy.scale);
  }

  /** Re-aplica solo el DPR (y el target del composer) tras un cambio de escala, sin resize completo. */
  private applyAdaptiveScale(): void {
    const dpr = this.computeDpr();
    if (dpr === this.dprValue) return;
    this.dprValue = dpr;
    const r = this.renderer;
    if (r) {
      r.setPixelRatio(dpr);
      this.postfx?.configure(this.presetValue.name, dpr, this.cssWidth, this.cssHeight, this.gfx.gfxBloom);
    }
    this.orbitDirty = true;
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

    // 5.5 overlays de engineering: una sola comparación cuando todo está apagado.
    if (this.debug.active) this.debug.update(state, this.camera, this.nodes, trackedTerminal);

    // 6. render + metrics
    this.draw(r);
    this.startAssets(r);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.passProbeDirect && this.renderer) {
      this.renderer.renderBufferDirect = this.passProbeDirect;
      this.passProbeDirect = null;
    }
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
    this.sectorId = map.id;
    this.applyPracticals();
    this.sector = new ArenaBuild(map, arenaBoxes(map), look, undefined, this.surfaces);
    this.sector.setQuality(this.presetValue.name);
    this.scene.add(this.sector.group);
    this.dirLight.shadow.needsUpdate = true;
    this.orbitDirty = true;
    this.solids = map.solids;
    this.nodes = map.nodes;
    this.objective.setMap(map);
    this.applyMist();
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
    r.shadowMap.enabled = resolveGfxPlan(this.presetValue, this.gfx).shadows;
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
      this.hdriLoaded = true;
      this.installEnvironment(r);
      this.orbitDirty = true;
    }).catch((error: unknown) => {
      if (!this.disposed) console.warn('Industrial HDRI unavailable: using direct lights', error);
    });
  }

  private installEnvironment(r: THREE.WebGLRenderer): void {
    // gfxEnvironment=off: sin PMREM en escena, viewmodel ni piso. El install
    // del HDRI tardío y el context restore pasan por el mismo guardia.
    if (!resolveGfxPlan(this.presetValue, this.gfx).environment) return;
    this.environment.install(r, this.scene);
    this.viewScene.environment = this.scene.environment;
    this.surfaces.setFloorEnvironment(this.scene.environment, this.scene.environmentRotation);
  }

  /** Apaga el IBL sin tocar el target del PMREM: el mundo es dueño de su disposal. */
  private clearEnvironment(): void {
    if (this.scene.environment === null && this.viewScene.environment === null) return;
    this.scene.environment = null;
    this.viewScene.environment = null; // Prestado; el mundo conserva su target.
    this.surfaces.setFloorEnvironment(null, this.scene.environmentRotation);
  }

  private applyEnvironment(): void {
    const want = resolveGfxPlan(this.presetValue, this.gfx).environment;
    if (!want) {
      this.clearEnvironment();
      return;
    }
    // Reactivar re-deriva el PMREM desde la fuente decodificada propia del
    // entorno; es no-op si el HDRI todavía no terminó de cargar.
    const r = this.renderer;
    if (r && this.hdriLoaded) this.installEnvironment(r);
  }

  /** Sombras: el pase de profundidad solo corre cuando el plan lo pide. */
  private applyShadows(want: boolean): void {
    this.dirLight.castShadow = want;
    // autoUpdate=false: un needsUpdate=true fuerza exactamente una pasada de
    // shadow map; en off ninguna (y shadowMap.enabled corta el resto).
    this.dirLight.shadow.needsUpdate = want;
    if (this.renderer) this.renderer.shadowMap.enabled = want;
  }

  /** Luces prácticas: solo el sector de control las trae, y el override puede apagarlas. */
  private applyPracticals(): void {
    this.practicals.visible = this.sectorId === 0 && resolveGfxPlan(this.presetValue, this.gfx).lights;
  }

  /** Malla de atmósfera: la identifica su único uniforme uGlossy (lote `mist` de arena.ts). */
  private applyMist(): void {
    const want = resolveGfxPlan(this.presetValue, this.gfx).mist;
    for (const child of this.sector?.group.children ?? []) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.ShaderMaterial | undefined;
      if (mesh.isMesh && mat?.uniforms && 'uGlossy' in mat.uniforms) mesh.visible = want;
    }
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
    // Alimentación del puerto de escala del dueño único (P3): intervalo real de rAF de juego
    // (los frames de órbita del menú no mueven la señal: no hace falta proteger el menú).
    // La decisión de un hitch/pausa (Δ > 250 ms) se ignora dentro de la política.
    const now = performance.now();
    if (!this.drawingOrbit && this.lastFrameAt > 0) {
      const decision = this.policy.sampleRenderSignal(now - this.lastFrameAt);
      if (decision.changed) this.applyAdaptiveScale();
    }
    this.lastFrameAt = now;
    this.sector?.setTime(this.elapsed);
    // Atribución de draw calls (T5e): el probe se instala/desmonta en caliente y
    // solo mientras el panel lo lee; cuando está apagado estos dos guardias son
    // la única huella (dos comparaciones booleanas).
    const probeWanted = this.debug.probeWanted;
    if (probeWanted !== (this.passProbeDirect !== null)) this.syncPassProbe(r, probeWanted);
    if (probeWanted) {
      const counts = this.debug.passes;
      counts.world = 0;
      counts.shadow = 0;
      counts.viewmodel = 0;
      counts.composer = 0;
    }
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

  /** Instala o retira el envoltorio de atribución; nunca reserva memoria por frame. */
  private syncPassProbe(r: THREE.WebGLRenderer, wanted: boolean): void {
    if (wanted && this.passProbeDirect === null) {
      this.passProbeDirect = r.renderBufferDirect.bind(r);
      r.renderBufferDirect = this.passProbe;
    } else if (!wanted && this.passProbeDirect !== null) {
      r.renderBufferDirect = this.passProbeDirect;
      this.passProbeDirect = null;
    }
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
