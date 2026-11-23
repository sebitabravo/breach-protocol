import { expect, test, type Page } from '@playwright/test';
import type { Engine, WorldEvent } from '../../src/wasm/bridge';
import type { Renderer } from '../../src/render/renderer';
import { EVT, I, INPUT_LEN } from '../../src/wasm/protocol';
import { screenIs } from './support';

const capture = process.env.TERM_CAPTURE === '1';

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()) && !message.text().includes('GPU stall due to ReadPixels')) errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem('bp.settings', JSON.stringify({
    version: 2, quality: 'high', tutorialSeen: true, audioEnabled: false,
  })));
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.waitForFunction(() => {
    const { renderer } = window.__BREACH__ as unknown as { renderer: Renderer };
    return Reflect.get(renderer, 'scene').environment && Reflect.get(renderer, 'surfaces').materials.slice(0, 3).every((m: { map: unknown }) => m.map);
  });
  // P4: la práctica vive en "Cómo jugar" desde el menú.
  await page.locator('#screen-menu [data-goto="about"]').tap();
  await screenIs(page, 'about');
  await page.locator('#screen-about [data-action="practice"]').tap();
  await screenIs(page, 'playing');
  return errors;
}

// The far evidence uses surveyed cameras (no HUD locator, just the prop).
// The close sequence routes and channels with real fixed WASM input, not a fake snapshot.
async function frame(page: Page, shot: '20m' | '8m' | 'close' | 'channel' | 'active' | 'mobile' | 'flash' | 'release') {
  const metrics = await page.evaluate(({ shot, I, INPUT_LEN, EVT }) => {
    const app = window.__BREACH__!;
    const { engine, renderer, rafId } = app as unknown as { engine: Engine; renderer: Renderer; rafId: number };
    cancelAnimationFrame(rafId);
    renderer.setQuality('high', 1);
    const { state } = engine;
    const input = new Float32Array(INPUT_LEN);
    const far = shot === '20m' || shot === '8m';
    let events: WorldEvent[] = [];
    if (shot === 'close' || shot === 'mobile') {
      input[I.moveX] = 1;
      for (let i = 0; i < 230 && state.px < 11.10; i += 1) engine.tick(input);
      input.fill(0);
      input[I.moveZ] = 1;
      for (let i = 0; i < 230 && state.pz > (shot === 'mobile' ? 3.85 : 1.64); i += 1) engine.tick(input);
      input.fill(0);
      for (let i = 0; i < 24; i += 1) engine.tick(input);
      const yaw = -Math.atan2(12 - state.px, state.pz);
      for (let i = 0; i < 5; i += 1) {
        input[I.lookDx] = state.yaw - yaw;
        // A slight lift keeps the beacon in the close view.
        input[I.lookDy] = state.pitch - (shot === 'mobile' ? 0.04 : 0.12);
        engine.tick(input);
      }
    }
    if (shot === 'channel' || shot === 'flash') {
      input[I.interact] = 1;
      const ticks = shot === 'channel' ? 36 : 75;
      for (let i = 0; i < ticks && !state.node(1).active; i += 1) engine.tick(input);
      if (shot === 'flash') {
        state.readEvents(0, events);
        events = events.filter((event) => event.type === EVT.nodeActivated);
        Reflect.get(app, 'consumeEvents').call(app, events, state.tick);
      }
    }
    if (shot === 'release') for (let i = 0; i < 24; i += 1) engine.tick(input);
    const pose = far ? (shot === '20m' ? [-5.5, Math.sqrt(93.75)] : [9.2, Math.sqrt(56.16)]) : null;
    const view = pose ? new Proxy(state, {
      get(target, field) {
        if (field === 'px') return pose[0];
        if (field === 'pz') return pose[1];
        if (field === 'yaw') return -Math.atan2(12 - pose[0], pose[1]);
        if (field === 'pitch') return 0;
        const value = Reflect.get(target, field);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) : state;
    // The flash is sampled at onset; steady frames have no shadow refresh or FX.
    const track = !far && !state.node(1).active ? 1 : -1;
    Reflect.get(renderer, 'interp').reset();
    renderer.renderGame(view, 1, shot === 'active' ? 1 : 0.12, events, track);
    renderer.renderGame(view, 1, 0, [], track);
    const { calls, triangles } = renderer;
    Reflect.get(app, 'hud').update(state, true);
    Reflect.get(app, 'updateChannelRing')?.call(app, state);
    Reflect.get(app, 'objectiveMarker')?.hide();
    const hardware = Reflect.get(Reflect.get(renderer, 'sector'), 'terminals');
    const live = hardware?.batch.geometry.getAttribute('aLive');
    const mode = live?.getX(1), fill = live?.getY(1), flash = live?.getZ(1);
    if (hardware) {
      hardware.batch.visible = false;
      renderer.renderGame(view, 1, 0, [], track);
      const batchedCalls = calls - renderer.calls;
      hardware.batch.visible = true;
      renderer.renderGame(view, 1, 0, [], track);
      return { calls, triangles, batchedCalls, mode, fill, flash, node: state.node(1), events: events.length };
    }
    return { calls, triangles, batchedCalls: 0, mode, fill, flash, node: state.node(1), events: events.length };
  }, { shot, I, INPUT_LEN, EVT });
  if (capture && shot !== 'release') {
    console.log(`terminal ${shot} high: ${JSON.stringify(metrics)}`);
    await page.screenshot({ path: `/tmp/term-${shot}.png` });
    if (shot === 'close' || shot === 'channel' || shot === 'active') {
      const style = await page.addStyleTag({ content: '#app { filter: grayscale(1) }' });
      await page.screenshot({ path: `/tmp/term-${shot}-gray.png` });
      await style.evaluate((el) => el.remove());
    }
  }
  return metrics;
}

test.describe('network console on touch Chromium', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 720 } });
  test('shows idle, cancel, channel and lock from real terminal snapshots in one shared draw', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = await setup(page);
    if (capture) {
      await frame(page, '20m');
      await frame(page, '8m');
    }
    const idle = await frame(page, 'close');
    const mid = await frame(page, 'channel');
    await expect(page.locator('#hud-nodes .node').nth(1)).toHaveClass(/is-charging/);
    await expect(page.locator('#crosshair')).toHaveClass(/is-channeling/);
    const released = await frame(page, 'release');
    await expect(page.locator('#crosshair')).not.toHaveClass(/is-channeling/);
    const resumed = await frame(page, 'channel');
    const activated = await frame(page, 'flash');
    await expect(page.locator('#hud-nodes .node').nth(1)).toHaveClass(/is-active/);
    await expect(page.getByText('nodo de red activado')).toBeVisible();
    const settled = await frame(page, 'active');
    expect(idle.mode).toBe(0);
    expect(mid.mode).toBe(1);
    expect(mid.fill).toBeCloseTo(0.5, 1);
    expect(released.mode).toBe(0);
    expect(resumed.fill).toBeCloseTo(mid.fill!, 3);
    expect(activated.events).toBe(1);
    expect(activated.flash).toBeGreaterThan(0);
    expect(settled).toMatchObject({ mode: 2, fill: 1, flash: 0, batchedCalls: 1 });
    expect(errors).toEqual([]);
    if (capture) console.log(`terminal desktop console/page errors: ${errors.length}`);
  });
});

test.describe('network console portrait', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  test('renders the idle console beside live touch controls', async ({ page }) => {
    const errors = await setup(page);
    const idle = await frame(page, 'mobile');
    await expect(page.locator('[data-touch="interact"]')).toBeVisible();
    expect(idle).toMatchObject({ mode: 0, batchedCalls: 1 });
    expect(errors).toEqual([]);
    if (capture) console.log(`terminal mobile console/page errors: ${errors.length}`);
  });
});
