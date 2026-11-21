/**
 * Hand-written WebAssembly bridge. No wasm-bindgen, no glue dependency: the
 * module exports a handful of C functions and one linear memory, and the
 * snapshot is read in place (zero copies per frame).
 */
import {
  ENEMY_BASE,
  ENEMY_STRIDE,
  EVENT_BASE,
  EVENT_STRIDE,
  H,
  INPUT_LEN,
  MAX_ENEMIES,
  MAX_EVENTS,
  NODE_BASE,
  NODE_STRIDE,
  SNAPSHOT_LEN,
  assertProtocol,
} from './protocol';
import { parseMapData, type MapData } from '../world/map';

export interface WasmExports {
  memory: WebAssembly.Memory;
  bp_init(seed: number): number;
  bp_start(mode: number, map: number, seed: number, flags: number): number;
  bp_tick_fixed(inputPtr: number): number;
  bp_snapshot_ptr(): number;
  bp_snapshot_len(): number;
  bp_input_len(): number;
  bp_map_data_ptr(): number;
  bp_map_data_len(): number;
  bp_load_map(id: number): number;
  bp_log_encode(): number;
  bp_log_ptr(): number;
  bp_log_truncated(): number;
  bp_score_version(): number;
  bp_replay_hash(ptr: number, len: number): bigint;
  bp_golden_hash(ticks: number): bigint;
  bp_note_dropped(n: number): void;
  bp_alloc(len: number): number;
  bp_free(ptr: number, len: number): void;
}

export interface WorldEvent {
  type: number;
  a: number;
  b: number;
  c: number;
  d: number;
  seq: number;
}

/**
 * A live view over the simulation state. Values are read straight out of
 * WebAssembly memory; nothing is copied or allocated per frame.
 */
export interface NodeView {
  x: number;
  z: number;
  progress: number;
  active: boolean;
}

export class Snapshot {
  private view: Float32Array;

  constructor(buffer: ArrayBuffer, ptr: number, len: number) {
    this.view = new Float32Array(buffer, ptr, len);
  }

  get buffer(): ArrayBufferLike {
    return this.view.buffer;
  }

  at(index: number): number {
    return this.view[index] ?? 0;
  }

  get float(): Float32Array {
    return this.view;
  }

  // --- header -----------------------------------------------------------
  get phase(): number {
    return this.view[H.phase];
  }
  get timeLeft(): number {
    return this.view[H.timeLeft];
  }
  get timeElapsed(): number {
    return this.view[H.timeElapsed];
  }
  get wave(): number {
    return this.view[H.wave];
  }
  get waveTotal(): number {
    return this.view[H.waveTotal];
  }
  get enemiesRemaining(): number {
    return this.view[H.enemiesRemaining];
  }
  get enemiesAlive(): number {
    return this.view[H.enemiesAlive];
  }
  get score(): number {
    return this.view[H.score];
  }
  get kills(): number {
    return this.view[H.kills];
  }
  get shots(): number {
    return this.view[H.shots];
  }
  get hits(): number {
    return this.view[H.hits];
  }
  get damageTaken(): number {
    return this.view[H.damageTaken];
  }
  get hp(): number {
    return this.view[H.hp];
  }
  get hpMax(): number {
    return this.view[H.hpMax];
  }
  get px(): number {
    return this.view[H.px];
  }
  get py(): number {
    return this.view[H.py];
  }
  get pz(): number {
    return this.view[H.pz];
  }
  get yaw(): number {
    return this.view[H.yaw];
  }
  get pitch(): number {
    return this.view[H.pitch];
  }
  get recoilPitch(): number {
    return this.view[H.recoilPitch];
  }
  get recoilYaw(): number {
    return this.view[H.recoilYaw];
  }
  get grounded(): boolean {
    return this.view[H.grounded] > 0.5;
  }
  get weapon(): number {
    return this.view[H.weapon];
  }
  get ammo(): number {
    return this.view[H.ammo];
  }
  get mag(): number {
    return this.view[H.mag];
  }
  get reserve(): number {
    return this.view[H.reserve];
  }
  get reloading(): boolean {
    return this.view[H.reloading] > 0.5;
  }
  get reloadProgress(): number {
    return this.view[H.reloadProgress];
  }
  get spread(): number {
    return this.view[H.spread];
  }
  get nodesActive(): number {
    return this.view[H.nodesActive];
  }
  get interacting(): number {
    return this.view[H.interacting];
  }
  get intermission(): number {
    return this.view[H.intermission];
  }
  get tick(): number {
    return this.view[H.tick];
  }
  get extraction(): number {
    return this.view[H.extraction];
  }
  get speed(): number {
    return this.view[H.speed];
  }
  get hitAge(): number {
    return this.view[H.hitAge];
  }
  get damageAge(): number {
    return this.view[H.damageAge];
  }
  get ads(): number {
    return this.view[H.ads];
  }
  get aimAssist(): boolean {
    return this.view[H.aimAssist] > 0.5;
  }

  nodeProgress(index: number): number {
    return this.view[H.node0 + index];
  }

  /** Con `out` reutiliza el objeto en vez de reservar uno nuevo (uso por frame en el render). */
  node(index: number, out?: NodeView): NodeView {
    const base = NODE_BASE + index * NODE_STRIDE;
    const target = out ?? { x: 0, z: 0, progress: 0, active: false };
    target.x = this.view[base];
    target.z = this.view[base + 1];
    target.progress = this.view[base + 2];
    target.active = this.view[base + 3] > 0.5;
    return target;
  }

  enemy(index: number): {
    x: number;
    y: number;
    z: number;
    yaw: number;
    hp: number;
    state: number;
    kind: number;
    anim: number;
  } {
    const base = ENEMY_BASE + index * ENEMY_STRIDE;
    return {
      x: this.view[base],
      y: this.view[base + 1],
      z: this.view[base + 2],
      yaw: this.view[base + 3],
      hp: this.view[base + 4],
      state: this.view[base + 5],
      kind: this.view[base + 6],
      anim: this.view[base + 7],
    };
  }

  /** Eventos sobrescritos en el ring antes de que el shell los leyera. */
  lostEvents = 0;

  /** Copies the event ring entries newer than `lastSeq`. */
  readEvents(lastSeq: number, out: WorldEvent[]): number {
    out.length = 0;
    const head = this.view[H.eventsHead] | 0;
    const count = Math.min(this.view[H.eventsCount] | 0, MAX_EVENTS);
    for (let i = 0; i < count; i += 1) {
      const slot = (head - count + i + MAX_EVENTS) % MAX_EVENTS;
      const base = EVENT_BASE + slot * EVENT_STRIDE;
      const seq = this.view[base + 5];
      if (seq <= lastSeq || seq === 0) continue;
      out.push({
        type: this.view[base],
        a: this.view[base + 1],
        b: this.view[base + 2],
        c: this.view[base + 3],
        d: this.view[base + 4],
        seq,
      });
    }
    out.sort((a, b) => a.seq - b.seq);
    if (out.length > 0 && out[0].seq > lastSeq + 1) this.lostEvents += out[0].seq - lastSeq - 1;
    return out.length;
  }
}

const LOAD_TIMEOUT_MS = 15_000;

export interface StartOptions {
  mode: number;
  map: number;
  seed: number;
  aimAssist: boolean;
  autoReload: boolean;
  /** Habilita el arma 3 (SG-08). */
  shotgun?: boolean;
}

/** FNV-1a de 64 bits sobre los bits del snapshot; igual a `replay::hash_snapshot`. */
export function hashSnapshot(snapshot: Float32Array): bigint {
  const bytes = new Uint8Array(snapshot.buffer, snapshot.byteOffset, snapshot.byteLength);
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

export class Engine {
  private inputView: Float32Array | null = null;
  private inputViewOf: ArrayBufferLike | null = null;

  private constructor(
    private readonly exports: WasmExports,
    private readonly inputPtr: number,
    private snapshot: Snapshot,
    private buffer: ArrayBufferLike,
    public readonly wasmBytes: number,
  ) {}

  static async load(url: string): Promise<Engine> {
    const response = await fetch(url, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`no se pudo descargar el núcleo: ${response.status}`);
    }
    return Engine.fromBytes(await response.arrayBuffer());
  }

  static async fromBytes(bytes: ArrayBuffer | Uint8Array): Promise<Engine> {
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const exports = instance.exports as unknown as WasmExports;
    if (typeof exports.bp_tick_fixed !== 'function' || !(exports.memory instanceof WebAssembly.Memory)) {
      throw new Error('el módulo wasm no expone el ABI esperado');
    }
    const version = exports.bp_init(0x5eb17a);
    assertProtocol(version);

    if (exports.bp_input_len() !== INPUT_LEN) {
      throw new Error('input buffer length mismatch with protocol.ts');
    }
    if (exports.bp_snapshot_len() !== SNAPSHOT_LEN) {
      throw new Error(
        `snapshot length mismatch: wasm ${exports.bp_snapshot_len()} vs ts ${SNAPSHOT_LEN}`,
      );
    }

    const inputPtr = exports.bp_alloc(INPUT_LEN * 4);
    const memory = exports.memory;
    new Float32Array(memory.buffer, inputPtr, INPUT_LEN).fill(0);
    const snapPtr = exports.bp_snapshot_ptr();
    const snapshot = new Snapshot(memory.buffer, snapPtr, SNAPSHOT_LEN);
    return new Engine(exports, inputPtr, snapshot, memory.buffer, bytes.byteLength);
  }

  /** Carga un sector sin iniciar partida y devuelve sus datos (geometría, terminales, spawns). */
  loadMap(id: number): MapData {
    if (this.exports.bp_load_map(id) !== 1) throw new Error(`mapa inexistente: ${id}`);
    this.refresh();
    return this.mapData();
  }

  mapData(): MapData {
    const ptr = this.exports.bp_map_data_ptr();
    const len = this.exports.bp_map_data_len();
    // Copia: la memoria wasm puede crecer y dejar el typed array huérfano.
    return parseMapData(new Float32Array(this.exports.memory.buffer, ptr, len).slice());
  }

  /** Inicia una partida y arma el grabador de entradas. Devuelve falso si modo o mapa no existen. */
  start(options: StartOptions): boolean {
    const flags = (options.aimAssist ? 1 : 0) | (options.autoReload ? 2 : 0) | (options.shotgun ? 4 : 0);
    const ok = this.exports.bp_start(options.mode, options.map, options.seed >>> 0, flags) === 1;
    this.refresh();
    return ok;
  }

  noteDropped(count: number): void {
    if (count > 0) this.exports.bp_note_dropped(count);
  }

  /** Escribe un frame de entrada y avanza un paso fijo (1/60 s) del núcleo. */
  tick(input: Float32Array): number {
    // La vista se recrea solo cuando la memoria wasm crece y cambia de ArrayBuffer.
    const memory = this.exports.memory.buffer;
    if (this.inputViewOf !== memory || !this.inputView) {
      this.inputView = new Float32Array(memory, this.inputPtr, INPUT_LEN);
      this.inputViewOf = memory;
    }
    this.inputView.set(input.subarray(0, INPUT_LEN));
    const tick = this.exports.bp_tick_fixed(this.inputPtr);
    this.refresh();
    return tick;
  }

  /** Registro de entradas de la partida actual, listo para enviar al servidor. */
  encodeLog(): Uint8Array {
    const len = this.exports.bp_log_encode();
    const ptr = this.exports.bp_log_ptr();
    return new Uint8Array(this.exports.memory.buffer, ptr, len).slice();
  }

  get scoreVersion(): number {
    return this.exports.bp_score_version();
  }

  /** Verdadero si la partida superó el techo de ticks verificables. */
  get logTruncated(): boolean {
    return this.exports.bp_log_truncated() === 1;
  }

  /** Re-simula un registro dentro del propio wasm y devuelve el hash del estado final (0n si es inválido). */
  replayHash(log: Uint8Array): bigint {
    const ptr = this.exports.bp_alloc(log.length);
    if (ptr === 0) throw new Error('wasm sin memoria para el registro');
    new Uint8Array(this.exports.memory.buffer, ptr, log.length).set(log);
    const hash = this.exports.bp_replay_hash(ptr, log.length);
    this.exports.bp_free(ptr, log.length);
    this.refresh();
    return BigInt.asUintN(64, hash);
  }

  goldenHash(ticks: number): bigint {
    return BigInt.asUintN(64, this.exports.bp_golden_hash(ticks));
  }

  get state(): Snapshot {
    return this.snapshot;
  }

  /** WebAssembly memory can grow, which detaches existing typed arrays. */
  private refresh(): void {
    const buffer = this.exports.memory.buffer;
    if (buffer !== this.buffer) {
      this.buffer = buffer;
      this.snapshot = new Snapshot(buffer, this.exports.bp_snapshot_ptr(), SNAPSHOT_LEN);
      new Float32Array(buffer, this.inputPtr, INPUT_LEN).fill(0);
    }
  }
}

export { MAX_ENEMIES, MAX_EVENTS };
