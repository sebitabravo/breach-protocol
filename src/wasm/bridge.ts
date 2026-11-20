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

export interface WasmExports {
  memory: WebAssembly.Memory;
  bp_init(seed: number): number;
  bp_reset(seed: number): void;
  bp_tick(dt: number, inputPtr: number): number;
  bp_snapshot_ptr(): number;
  bp_snapshot_len(): number;
  bp_input_len(): number;
  bp_set_arena(ptr: number, count: number): number;
  bp_set_nodes(ptr: number, count: number): void;
  bp_set_spawns(ptr: number, count: number): void;
  bp_set_player_start(x: number, z: number, yaw: number): void;
  bp_set_aim_assist(flag: number): void;
  bp_set_practice(flag: number): void;
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

  node(index: number): { x: number; z: number; progress: number; active: boolean } {
    const base = NODE_BASE + index * NODE_STRIDE;
    return {
      x: this.view[base],
      z: this.view[base + 1],
      progress: this.view[base + 2],
      active: this.view[base + 3] > 0.5,
    };
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
    return out.length;
  }
}

export class Engine {
  private constructor(
    private readonly exports: WasmExports,
    private readonly inputPtr: number,
    private snapshot: Snapshot,
    private buffer: ArrayBufferLike,
    public readonly wasmBytes: number,
  ) {}

  static async load(url: string): Promise<Engine> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`no se pudo descargar el núcleo: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    const exports = instance.exports as unknown as WasmExports;
    if (typeof exports.bp_tick !== 'function' || !(exports.memory instanceof WebAssembly.Memory)) {
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

  /** Uploads the static collision set. Call once after `layout` is known. */
  setArena(boxes: Float32Array): number {
    const bytes = boxes.byteLength;
    const ptr = this.exports.bp_alloc(bytes);
    if (ptr === 0) throw new Error('wasm out of memory while uploading the arena');
    new Float32Array(this.exports.memory.buffer, ptr, boxes.length).set(boxes);
    const loaded = this.exports.bp_set_arena(ptr, boxes.length);
    this.exports.bp_free(ptr, bytes);
    this.refresh();
    return loaded;
  }

  setNodes(nodes: Float32Array): void {
    this.upload(nodes, (ptr, count) => this.exports.bp_set_nodes(ptr, count));
  }

  setSpawns(spawns: Float32Array): void {
    this.upload(spawns, (ptr, count) => this.exports.bp_set_spawns(ptr, count));
  }

  private upload(data: Float32Array, call: (ptr: number, count: number) => void): void {
    const bytes = data.byteLength;
    const ptr = this.exports.bp_alloc(bytes);
    if (ptr === 0) throw new Error('wasm out of memory');
    new Float32Array(this.exports.memory.buffer, ptr, data.length).set(data);
    call(ptr, data.length);
    this.exports.bp_free(ptr, bytes);
    this.refresh();
  }

  setPlayerStart(x: number, z: number, yaw: number): void {
    this.exports.bp_set_player_start(x, z, yaw);
    this.refresh();
  }

  setAimAssist(enabled: boolean): void {
    this.exports.bp_set_aim_assist(enabled ? 1 : 0);
    this.refresh();
  }

  setPractice(enabled: boolean): void {
    this.exports.bp_set_practice(enabled ? 1 : 0);
    this.refresh();
  }

  reset(seed: number): void {
    this.exports.bp_reset(seed >>> 0);
    this.refresh();
  }

  noteDropped(count: number): void {
    if (count > 0) this.exports.bp_note_dropped(count);
  }

  /** Writes one input frame and advances the simulation by `dt` seconds. */
  tick(dt: number, input: Float32Array): number {
    const buffer = new Float32Array(this.exports.memory.buffer, this.inputPtr, INPUT_LEN);
    buffer.set(input.subarray(0, INPUT_LEN));
    const tick = this.exports.bp_tick(dt, this.inputPtr);
    this.refresh();
    return tick;
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
