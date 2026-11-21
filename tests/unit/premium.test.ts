import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { WasmExports } from '../../src/wasm/bridge';
import { impactFace } from '../../src/render/fx';

it('pins the complete Sector 01 collider table, not just the terminal colliders', async () => {
  const { instance } = await WebAssembly.instantiate(new Uint8Array(readFileSync(new URL('../../public/bp_core.wasm', import.meta.url))));
  const wasm = instance.exports as unknown as WasmExports;
  wasm.bp_init(42);
  wasm.bp_load_map(0);
  const start = wasm.bp_map_data_ptr();
  const count = new DataView(wasm.memory.buffer).getFloat32(start + 4, true);
  const bytes = new Uint8Array(wasm.memory.buffer, start + 64, count * 28).slice();
  expect(bytes.byteLength).toBe(588);
  const hash = async (algorithm: string) => Array.from(new Uint8Array(await crypto.subtle.digest(algorithm, bytes)),
    (byte) => byte.toString(16).padStart(2, '0')).join('');
  expect(await hash('SHA-256')).toBe('07eaa519a0a0608e0bf979afc2c32b043b23f7dba2614792f723dd5780b46489');
  expect(await hash('SHA-512')).toBe('248b261e05a86d886925b5db71c7eda9d469a726b241b600a39af5d11607e11fbbdf79912bd98a38d26012b9b6846da5a2c6ebd27ca8e6c9ee9f3d11c28ec0ef');
});

it('projects wall and crate hits onto the exposed face and rejects floor and seam hits', () => {
  const wall = { kind: 0, min: [-5, 0, -5], max: [5, 6, -4] } as const;
  const crate = { kind: 2, min: [-1, 0, -1], max: [1, 1, 1] } as const;
  const floor = { kind: 1, min: [-5, -1, -5], max: [5, 0, 5] } as const;
  const p = new THREE.Vector3(), n = new THREE.Vector3(), eye = new THREE.Vector3(0, 1.6, 3), hit = new THREE.Vector3();
  expect(impactFace([wall, crate], hit.set(0, 2.5, -4), eye, p, n)).toBe(true);
  expect(n.toArray()).toEqual([0, 0, 1]);
  expect(p.z).toBeGreaterThan(-4);
  expect(impactFace([crate], hit.set(0, 0.5, 1), eye, p, n)).toBe(true);
  expect(p.z).toBeGreaterThan(1.04);
  expect(impactFace([crate], hit.set(0.99, 0.5, 1), eye, p, n)).toBe(false);
  expect(impactFace([floor], hit.set(0, 0, 0), eye, p, n)).toBe(false);
});
