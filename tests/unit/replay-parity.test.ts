/**
 * Paridad grabación→verificación desde la ruta real del cliente.
 *
 * Ejercita, sin re-implementar nada: el puente WASM que usa el juego
 * (`Engine.start` arma el grabador del núcleo, `Engine.tick` escribe entradas
 * cuantizadas), el codificador base64 real que el cliente publica en
 * `/api/runs` (`encodeLogBase64`, src/net/leaderboard.ts) y el punto de entrada
 * de verificación BPL1 que comparte el servidor (`bp_replay_hash` llama a
 * `replay::run_bytes`, la misma función que `bp_server::submit` usa nativo).
 *
 * La igualdad wasm↔nativo del `bp-core` ya la fijan los hashes dorados
 * (tests/unit/determinism.test.ts contra los pines de core/src/replay.rs); aquí
 * se prueba el resto de la cadena que ningún otro test cruza: grabador + wire
 * + re-simulación, y que una trampa en cualquier eslabón rompe la paridad.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Engine, hashSnapshot } from '../../src/wasm/bridge';
import { I, INPUT_LEN, MODE } from '../../src/wasm/protocol';
import { encodeLogBase64 } from '../../src/net/leaderboard';

const HEADER_LEN = 16; // magic(4) version(1) mode(1) map(1) flags(1) seed(4) ticks(4)
const TICKS_OFFSET = 12;
const MASK_FLAGS = 0b1;
const MASK_MOVE_X = 0b10;
const MASK_MOVE_Z = 0b100;
const MASK_LOOK_X = 0b1000;
const MASK_LOOK_Y = 0b10000;

let engine: Engine;

beforeAll(async () => {
  const bytes = readFileSync(new URL('../../public/bp_core.wasm', import.meta.url));
  engine = await Engine.fromBytes(bytes);
});

/** Apunta al enemigo vivo más cercano y dispara cuando está alineado (como hace el jugador). */
function aimAndFire(t: number, out: Float32Array): void {
  out.fill(0);
  const p = { x: engine.state.px, z: engine.state.pz };
  let nearest: { x: number; z: number } | null = null;
  let best = Infinity;
  for (let i = 0; i < engine.state.enemiesAlive; i += 1) {
    const e = engine.state.enemy(i);
    if (e.hp <= 0) continue;
    const d = Math.abs(e.x - p.x) + Math.abs(e.z - p.z);
    if (d < best) {
      best = d;
      nearest = e;
    }
  }
  if (nearest) {
    const want = Math.atan2(-(nearest.x - p.x), -(nearest.z - p.z));
    let err = want - engine.state.yaw;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    out[I.lookDx] = -Math.min(0.08, Math.max(-0.08, err));
    out[I.fireHeld] = Math.abs(err) < 0.05 ? 1 : 0;
    out[I.firePressed] = out[I.fireHeld];
  }
  out[I.switch] = t === 0 ? 2 : 0;
}

/** Graba una partida de overflow por la ruta exacta del cliente y devuelve el registro. */
function recordOverflow(): { log: Uint8Array; liveHash: bigint } {
  expect(engine.start({ mode: MODE.overflow, map: 0, seed: 21, aimAssist: false, autoReload: true })).toBe(true);
  const input = new Float32Array(INPUT_LEN);
  for (let t = 0; t < 2400; t += 1) {
    aimAndFire(t, input);
    engine.tick(input);
  }
  // El hash vivo se captura antes de re-simular: la re-simulación puede crecer la
  // memoria wasm y descolgar la vista del snapshot.
  const liveHash = hashSnapshot(engine.state.float);
  expect(engine.state.score).toBeGreaterThan(0);
  return { log: engine.encodeLog(), liveHash };
}

/** Decodifica el body base64 exactamente como lo hará el `STANDARD.decode` del servidor. */
function fromWireBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Voltea el bit bajo del primer byte de un valor de mirada del cuerpo RLE (ver server/tests/parity.rs). */
function flipFirstInputValueByte(log: Uint8Array): Uint8Array | null {
  const out = log.slice();
  let at = HEADER_LEN;
  while (at + 2 <= out.length) {
    const count = 1 + out[at];
    const mask = out[at + 1];
    let offset = 2;
    for (const [bit, size] of [
      [MASK_FLAGS, 2],
      [MASK_MOVE_X, 1],
      [MASK_MOVE_Z, 1],
      [MASK_LOOK_X, 2],
      [MASK_LOOK_Y, 2],
    ] as const) {
      if (mask & bit) {
        if (bit === MASK_LOOK_X || bit === MASK_LOOK_Y) {
          out[at + offset] ^= 1;
          return out;
        }
        offset += size;
      }
    }
    at += offset + (count - 1);
  }
  return null;
}

describe('parity: client-recorded log verifies to the live outcome', () => {
  it('the recorded log survives the real wire encoding and re-simulates to the live hash', () => {
    const { log, liveHash } = recordOverflow();
    expect([...log.slice(0, 4)]).toEqual([...new TextEncoder().encode('BPL1')]);

    // Lo único que cruza la frontera del proceso es base64; el mismo b64 que
    // submitRun() publicaría debe decodificar al registro byte a byte.
    const decoded = fromWireBase64(encodeLogBase64(log));
    expect([...decoded]).toEqual([...log]);

    // La verificación BPL1 (la misma replay::run_bytes que corre submit()) debe
    // reproducir el estado final vivo, incluido el puntaje: el hash cubre el
    // snapshot completo, puntaje incluido.
    expect(engine.replayHash(decoded)).toBe(liveHash);
  });

  it('a tampered input frame no longer re-simulates to the honest outcome', () => {
    const { log, liveHash } = recordOverflow();
    const tampered = flipFirstInputValueByte(log);
    if (tampered === null) throw new Error('premise: a fired log carries input values');

    // La trampa es mínima y el registro sigue siendo válido: lo que se pierde es
    // la corrida original — el servidor puntúa lo que re-simula, nunca lo que
    // el cliente declara.
    expect(engine.replayHash(tampered)).not.toBe(liveHash);
  });

  it('structurally tampered, tick-inflated and truncated logs are rejected without simulating', () => {
    const { log, liveHash } = recordOverflow();

    // Mask con un bit desconocido en el primer frame.
    const badMask = log.slice();
    badMask[HEADER_LEN + 1] = 0x20;
    expect(engine.replayHash(badMask)).toBe(0n);

    // Ticks inflados con relleno tras el fin de la partida.
    const inflated = new Uint8Array(log.length + 2);
    inflated.set(log);
    inflated[inflated.length - 2] = 0;
    inflated[inflated.length - 1] = 0;
    new DataView(inflated.buffer).setUint32(TICKS_OFFSET,
      new DataView(log.buffer, log.byteOffset).getUint32(TICKS_OFFSET, true) + 1, true);
    expect(engine.replayHash(inflated)).toBe(0n);

    // Registro truncado un byte.
    expect(engine.replayHash(log.slice(0, log.length - 1))).toBe(0n);

    // Y la paridad honesta sigue en pie sobre el registro intacto.
    expect(engine.replayHash(log)).toBe(liveHash);
  });
});
