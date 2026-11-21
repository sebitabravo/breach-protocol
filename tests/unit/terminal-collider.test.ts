import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { WasmExports } from '../../src/wasm/bridge';
import { SOLID_KIND } from '../../src/world/map';

it('preserves the exact WASM collider bytes for all three Sector 01 terminals', async () => {
  const bytes = readFileSync(new URL('../../public/bp_core.wasm', import.meta.url));
  const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes));
  const wasm = instance.exports as unknown as WasmExports;
  wasm.bp_init(42);
  wasm.bp_load_map(0);
  const map = new DataView(wasm.memory.buffer, wasm.bp_map_data_ptr(), wasm.bp_map_data_len() * 4);
  const actual: number[][] = [];
  for (let i = 0; i < map.getFloat32(4, true); i += 1) {
    const offset = (16 + i * 7) * 4;
    if (map.getFloat32(offset + 24, true) === SOLID_KIND.plinth) {
      actual.push(Array.from(new Uint8Array(map.buffer, map.byteOffset + offset, 28)));
    }
  }
  const before = [
    [-12.65, 0, -0.65, -11.35, 1.2, 0.65, 4],
    [11.35, 0, -0.65, 12.65, 1.2, 0.65, 4],
    [-0.65, 0, -12.65, 0.65, 1.2, -11.35, 4],
  ];
  expect(actual).toEqual(before.map((row) => {
    const expected = new DataView(new ArrayBuffer(28));
    row.forEach((value, i) => expected.setFloat32(i * 4, value, true));
    return Array.from(new Uint8Array(expected.buffer));
  }));
});
