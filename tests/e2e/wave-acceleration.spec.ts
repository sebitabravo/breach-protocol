import { expect, test } from '@playwright/test';
import type { InputManager } from '../../src/input/input';
import type { Renderer } from '../../src/render/renderer';
import type { Engine } from '../../src/wasm/bridge';
import { I, INPUT_LEN } from '../../src/wasm/protocol';
import { mockApi, screenIs, seedStorage } from './support';

test('a mission terminal advances the wave and announces it on touch Chromium', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await mockApi(page, {});
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.evaluate(() => {
    const { engine } = window.__BREACH__ as unknown as { engine: Engine };
    const start = engine.start.bind(engine);
    engine.start = (options) => start({ ...options, seed: 0x5eed0005 });
  });
  await page.locator('#screen-menu [data-action="mission"]').tap();
  await page.locator('[data-sector-card="0"] [data-action="brief"]').tap();
  await page.locator('[data-action="start-mission"]').tap();
  await screenIs(page, 'playing');
  const frame = (channel: boolean) => page.evaluate(({ channel, I, INPUT_LEN }) => {
    const app = window.__BREACH__!;
    const { engine, renderer, input } = app as unknown as { engine: Engine; renderer: Renderer; input: InputManager };
    cancelAnimationFrame(Reflect.get(app, 'rafId'));
    if (!channel) {
      const move = new Float32Array(INPUT_LEN);
      move[I.moveX] = 1;
      for (let i = 0; i < 230 && engine.state.px < 11.1; i += 1) engine.tick(move);
      move.fill(0);
      move[I.moveZ] = 1;
      for (let i = 0; i < 230 && engine.state.pz > 1.64; i += 1) engine.tick(move);
      move.fill(0);
      for (let i = 0; i < 20; i += 1) engine.tick(move);
      // Look towards the console so the capture shows what was activated.
      move[I.lookDx] = engine.state.yaw + Math.atan2(12 - engine.state.px, engine.state.pz);
      engine.tick(move);
    } else {
      // Sample the actual held touch button, at a fixed number of sim ticks.
      input.beginFrame();
      input.writeTo(input.buffer, true);
      for (let i = 0; i < 72; i += 1) engine.tick(input.buffer);
    }
    // The regular frame reads the real event ring and updates the DOM and WebGL.
    Reflect.get(renderer, 'interp').reset();
    Reflect.get(app, 'loop').reset();
    const now = performance.now();
    Reflect.set(app, 'lastNow', now);
    Reflect.get(app, 'frame')(now);
    cancelAnimationFrame(Reflect.get(app, 'rafId'));
    return { calls: renderer.calls, wave: engine.state.wave, kills: engine.state.kills, active: engine.state.node(1).active };
  }, { channel, I, INPUT_LEN });
  const before = await frame(false);
  expect(before).toMatchObject({ wave: 1, kills: 0, active: false });
  await expect(page.locator('#hud-wave')).toHaveText('1');
  const interact = page.locator('[data-touch="interact"]');
  await expect(interact).toHaveClass(/is-available/);
  const button = (await interact.boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }],
  });
  try {
    await expect(interact).toHaveClass(/is-down/);
    const after = await frame(true);
    expect(after).toMatchObject({ wave: 2, kills: 0, active: true });
    expect(after.calls).toBeGreaterThan(0);
    await expect(page.locator('#hud-wave')).toHaveText('2');
    await expect(page.locator('#hud-nodes .node').nth(1)).toHaveClass(/is-active/);
    await expect(page.locator('#hud-feed .feedline--danger')).toHaveText('oleada 2 · acelerada');
    await expect(page.getByText('oleada 2 · acelerada')).toBeVisible();
    await page.screenshot({ path: '/tmp/wave-accelerated.png', animations: 'disabled' });
    expect(errors).toEqual([]);
    console.log(`wave accelerated: ${after.calls} draw calls, ${errors.length} console/page errors`);
  } finally {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
});
