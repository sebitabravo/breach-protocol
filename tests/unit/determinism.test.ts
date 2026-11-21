import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, hashSnapshot } from '../../src/wasm/bridge';
import { I, INPUT_LEN, MODE } from '../../src/wasm/protocol';

/** Mismo valor que `GOLDEN_HASH` en core/src/replay.rs: lo fija el test nativo. */
const GOLDEN_TICKS = 4000;
const GOLDEN_HASH = 5711138649934550938n;
/** Escenarios 0..5 de `replay::scenario_hash` (core/src/replay.rs), con los mismos valores. */
const SCENARIO_HASHES = [
  GOLDEN_HASH,
  12760246713383565853n,
  770316419739378658n,
  4310614164317112927n,
  15493279338039416630n,
  825227913700778631n,
];

let engine: Engine;

beforeAll(async () => {
  const bytes = readFileSync(new URL('../../public/bp_core.wasm', import.meta.url));
  engine = await Engine.fromBytes(bytes);
});

/** Entrada pseudoaleatoria pero reproducible: función pura del tick. */
function scriptedInput(t: number, out: Float32Array): void {
  out.fill(0);
  out[I.moveZ] = t % 150 < 100 ? -1 : 0;
  out[I.moveX] = t % 220 < 60 ? 1 : t % 220 > 160 ? -1 : 0;
  out[I.lookDx] = (((t * 7) % 13) - 6) * 0.004;
  out[I.lookDy] = (((t * 5) % 7) - 3) * 0.002;
  out[I.fireHeld] = t % 90 < 40 ? 1 : 0;
  out[I.firePressed] = t % 90 === 0 ? 1 : 0;
  out[I.jump] = t % 150 === 149 ? 1 : 0;
  out[I.interact] = t % 300 > 250 ? 1 : 0;
  out[I.switch] = t % 420 === 140 ? 2 : t % 420 === 280 ? 1 : 0;
}

describe('cross-target determinism (native cargo vs wasm in this runtime)', () => {
  it('the golden scenario hashes to the same value the native test pins', () => {
    expect(engine.goldenHash(GOLDEN_TICKS)).toBe(GOLDEN_HASH);
  });

  it('replaying a recorded run reproduces the live final state bit for bit', () => {
    for (const map of [0, 1, 2]) {
      expect(engine.start({ mode: MODE.mission, map, seed: 4242 + map, aimAssist: false, autoReload: true })).toBe(true);
      const input = new Float32Array(INPUT_LEN);
      for (let t = 0; t < 1800; t += 1) {
        scriptedInput(t, input);
        engine.tick(input);
      }
      const live = hashSnapshot(engine.state.float);
      const log = engine.encodeLog();
      expect(log.length).toBeGreaterThan(16);
      expect(engine.replayHash(log)).toBe(live);
    }
  });

  it('overflow and daily runs replay to the live hash', () => {
    const cases = [
      { mode: MODE.overflow, map: 2, seed: 77, aimAssist: false, autoReload: true },
      { mode: MODE.daily, map: 0, seed: 20261120, aimAssist: false, autoReload: true },
    ];
    for (const options of cases) {
      expect(engine.start(options)).toBe(true);
      const input = new Float32Array(INPUT_LEN);
      for (let t = 0; t < 1800; t += 1) {
        scriptedInput(t, input);
        engine.tick(input);
      }
      expect(engine.replayHash(engine.encodeLog())).toBe(hashSnapshot(engine.state.float));
    }
  });

  it('reports score v3 through the WASM ABI and records v3 replays', () => {
    for (const mode of [MODE.mission, MODE.overflow]) {
      expect(engine.start({ mode, map: 0, seed: 5, aimAssist: false, autoReload: true })).toBe(true);
      expect(engine.scoreVersion).toBe(3);
      expect(engine.encodeLog()[4]).toBe(3);
    }
  });

  it('scenario hashes match the native pins, including objective acceleration', async () => {
    const bytes = readFileSync(new URL('../../public/bp_core.wasm', import.meta.url));
    const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {});
    const scenarioHash = instance.exports.bp_scenario_hash as (id: number, ticks: number) => bigint;
    SCENARIO_HASHES.forEach((pinned, id) => {
      expect(BigInt.asUintN(64, scenarioHash(id, GOLDEN_TICKS))).toBe(pinned);
    });
  });

  it('a corrupted log is rejected instead of simulated', () => {
    engine.start({ mode: MODE.mission, map: 0, seed: 1, aimAssist: false, autoReload: true });
    engine.tick(new Float32Array(INPUT_LEN));
    const log = engine.encodeLog();
    log[0] = 0x58;
    expect(engine.replayHash(log)).toBe(0n);
  });

  it('rejects unknown modes and maps', () => {
    expect(engine.start({ mode: 9, map: 0, seed: 1, aimAssist: false, autoReload: false })).toBe(false);
    expect(engine.start({ mode: 0, map: 9, seed: 1, aimAssist: false, autoReload: false })).toBe(false);
  });
});

describe('map data exported by the core', () => {
  it('every sector parses and exposes three terminals and eight spawns', () => {
    for (const id of [0, 1, 2]) {
      const map = engine.loadMap(id);
      expect(map.id).toBe(id);
      expect(map.nodes).toHaveLength(3);
      expect(map.spawns).toHaveLength(8);
      expect(map.solids.length).toBeGreaterThan(10);
    }
  });

  it('sector 3 has a terminal on the raised catwalk', () => {
    const map = engine.loadMap(2);
    expect(map.nodes.some((n) => n.y > 2)).toBe(true);
    expect(map.theme).toBe('archive');
  });
});
