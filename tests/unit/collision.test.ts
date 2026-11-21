import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Engine } from '../../src/wasm/bridge';
import { I, INPUT_LEN, MODE } from '../../src/wasm/protocol';
import { SOLID_KIND } from '../../src/world/map';

it('keeps the player inside Sector 01 through all four corners and cover collisions', async () => {
  const engine = await Engine.fromBytes(readFileSync(new URL('../../public/bp_core.wasm', import.meta.url)));
  const map = engine.loadMap(0);
  const input = new Float32Array(INPUT_LEN);
  const state = () => engine.state;
  let route = '';
  function start(name: string): void {
    route = name;
    expect(engine.start({ mode: MODE.practice, map: 0, seed: 42, aimAssist: false, autoReload: true })).toBe(true);
  }
  function drive(x: number, z: number, ticks: number): void {
    input[I.moveX] = x;
    input[I.moveZ] = z;
    input[I.run] = 1;
    for (let t = 0; t < ticks; t += 1) {
      engine.tick(input);
      const { px, py, pz, tick } = state();
      if (!(Math.abs(px) <= map.halfX && Math.abs(pz) <= map.halfZ && py >= -0.01)) {
        throw new Error(`${route}, tick ${tick}: out of bounds at (${px}, ${py}, ${pz})`);
      }
    }
  }
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      start(`corner ${x},${z}`);
      drive(0, -1, 60);
      drive(x, 0, 200);
      if (z < 0) drive(0, 1, 400);
      drive(x, -z, 45);
      // Reaching both inner faces proves the probe didn't stall on interior geometry.
      expect(x * state().px, route).toBeGreaterThan(16);
      expect(z * state().pz, route).toBeGreaterThan(16);
    }
  }
  const cover = map.solids.filter((solid) => solid.kind === SOLID_KIND.cover);
  expect(cover).toHaveLength(4);
  for (const solid of cover) {
    const x = (solid.min[0] + solid.max[0]) / 2;
    const z = (solid.min[2] + solid.max[2]) / 2;
    start(`cover ${x},${z}`);
    const side = Math.sign(x);
    const north = z < 0;
    drive(0, -1, 60);
    if (north) {
      drive(side, 0, 200);
      drive(0, 1, 400);
    }
    const steer = Math.sign(x - state().px);
    for (let t = 0; t < 180 && Math.abs(x - state().px) > 0.15; t += 1) drive(steer, 0, 1);
    drive(0, 0, 20);
    drive(0, north ? -1 : 1, 110);
    const face = north ? solid.min[2] : solid.max[2];
    const gap = (state().pz - face) * (north ? -1 : 1);
    expect(gap, route).toBeGreaterThan(0);
    expect(gap, route).toBeLessThan(0.6);
    expect(state().px, route).toBeGreaterThan(solid.min[0]);
    expect(state().px, route).toBeLessThan(solid.max[0]);
  }
});
