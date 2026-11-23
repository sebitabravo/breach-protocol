/**
 * Overlays de debug del renderer (T5e, extraído de renderer.ts en P5). Todos
 * comparten tres reglas:
 * 1. están detrás de telemetry: `setTelemetry(false)` fuerza el plan entero a apagado;
 * 2. con todo apagado no agregan NI UN objeto a la escena (el grupo se desmonta),
 *    así que draw calls y costo de frame quedan idénticos al baseline;
 * 3. nada se reserva por frame: las posiciones se escriben en buffers
 *    preallocados y las geometrías se crean solo la primera vez que se encienden.
 *
 * El renderer es dueño del frame y de la escena; este módulo es dueño de los
 * overlays y de su máquina de estados. Se cuelga de la escena que recibe.
 */
import * as THREE from 'three';
import type { MapData } from '../world/map';
import type { Snapshot } from '../wasm/bridge';
import { E, ENEMY_BASE, ENEMY_STATE, ENEMY_STRIDE, MAX_ENEMIES, MAX_NODES } from '../wasm/protocol';
import { PALETTE } from './themes';

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
