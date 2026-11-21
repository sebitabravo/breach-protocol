import { expect, test, type Page } from '@playwright/test';
import type { Engine } from '../../src/wasm/bridge';
import { I, INPUT_LEN } from '../../src/wasm/protocol';
import type { Renderer } from '../../src/render/renderer';
import { openCalibration, screenIs } from './support';

const marker = '#objective-marker';

async function start(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('bp.settings', JSON.stringify({ version: 2, quality: 'high', audioEnabled: false })));
  await page.goto('/');
  await openCalibration(page);
  await page.locator('#screen-calibrate [data-action="play"]').tap();
  await screenIs(page, 'playing');
  return errors;
}

/** Feed real fixed ticks, in bounded chunks independent of GPU speed. */
async function drive(page: Page, yaw: number, x?: number, z?: number) {
  return page.evaluate(({ yaw, x, z, I, INPUT_LEN }) => {
    const { engine } = window.__BREACH__ as unknown as { engine: Engine };
    const { state } = engine;
    const input = new Float32Array(INPUT_LEN);
    for (let i = 0; i < 20; i += 1) {
      const delta = Math.atan2(Math.sin(yaw - state.yaw), Math.cos(yaw - state.yaw));
      if (Math.abs(delta) <= 0.001) break;
      input[I.lookDx] = Math.max(-0.3, Math.min(0.3, -delta));
      engine.tick(input);
    }
    input.fill(0);
    if (x !== undefined && z !== undefined) {
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      for (let i = 0; i < 450; i += 1) {
        const dx = x - state.px, dz = z - state.pz;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.12) break;
        input[I.moveX] = (cos * dx - sin * dz) / distance;
        input[I.moveZ] = (-sin * dx - cos * dz) / distance;
        engine.tick(input);
      }
    }
    return { x: state.px, z: state.pz };
  }, { yaw, x, z, I, INPUT_LEN });
}

async function enterTerminalStep(page: Page) {
  await page.keyboard.press('Enter');
  await expect(page.locator('#tut-index')).toHaveText('2');
  await page.keyboard.press('Enter');
  await expect(page.locator('#tut-body')).toHaveText('Seguí el rombo hasta la terminal marcada. Mantené hasta llenar la barra.');
  await expect(page.locator(`${marker} [data-objective-name]`)).toHaveText('Terminal 02');
}

async function checkClear(page: Page) {
  const overlaps = await page.locator(`${marker} .objective-card`).evaluate((el) => {
    const markerRect = el.getBoundingClientRect();
    const blocked = document.querySelectorAll('.hud__minimap, .hud__block, .hud__objective-track, .crosshair, .ammo, .tutorial, .tbtn, .touch__stick');
    return Array.from(blocked).filter((item) => {
      const b = item.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.left < markerRect.right && b.right > markerRect.left
        && b.top < markerRect.bottom && b.bottom > markerRect.top;
    }).map((item) => item.className);
  });
  expect(overlaps).toEqual([]);
}

test.describe('objective guidance', () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 720 } });

  test('a specific terminal tracks the camera and switches from distance to touch hold', async ({ page }) => {
    test.setTimeout(120_000); // High preset uses software WebGL in headless Chromium.
    const errors = await start(page);
    await expect(page.locator(marker)).toHaveAttribute('data-mode', 'hidden');
    await drive(page, -0.42);
    await enterTerminalStep(page);
    const cue = page.locator(marker);
    const distance = page.locator('#hud-objective-distance');
    await expect(cue).toHaveAttribute('data-mode', 'onscreen');
    await expect(distance).toHaveText('18 m');
    await checkClear(page);
    await expect(cue).toHaveAttribute('data-occluded', '');
    const calls = await page.evaluate(() => {
      const { renderer } = window.__BREACH__ as unknown as { renderer: Renderer };
      return { calls: renderer.calls, preset: renderer.preset.name };
    });
    expect(calls.preset).toBe('high');
    expect(calls.calls).toBeGreaterThan(0);
    console.log(`objective high: ${calls.calls} draw calls`);

    await drive(page, 1.9);
    await expect(cue).toHaveAttribute('data-mode', 'behind');
    await expect(cue.locator('.objective-chevron')).toBeVisible();
    await checkClear(page);
    if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/obj-offscreen.png' });

    await drive(page, -0.42, 5.2, 11.8);
    await expect.poll(async () => parseInt((await distance.textContent())!, 10)).toBeLessThan(16);
    await drive(page, -0.42, 11.8, 11.8);
    await drive(page, 0.24, 11.8, 7.5);
    await expect(cue).toHaveAttribute('data-mode', 'onscreen');
    await expect(cue).not.toHaveAttribute('data-occluded', '');
    await checkClear(page);
    if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/obj-tutorial.png' });
    await drive(page, -0.05, 11.8, 3.2);
    await expect(cue).toHaveAttribute('data-mode', 'onscreen');
    await expect(cue.locator('[data-objective-hold]')).toHaveText('mantené Ⓔ');
    await expect(cue.locator('[data-objective-hold]')).toBeVisible();
    await expect(distance).toBeHidden();
    await checkClear(page);
    if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/obj-close.png' });
    await page.setViewportSize({ width: 1024, height: 768 });
    await checkClear(page);
    expect(errors).toEqual([]);
    console.log(`objective desktop: ${errors.length} console/page errors`);
  });
});

test.describe('portrait objective', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('mobile marker stays clear of the touch HUD and world motion is static', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await start(page);
    await expect(page.locator('#app')).toHaveAttribute('data-motion', 'reduce');
    await enterTerminalStep(page);
    await expect(page.locator(marker)).toHaveAttribute('data-mode', 'offscreen');
    await checkClear(page);
    await drive(page, -0.60, 11.8, 13);
    await drive(page, 0.17, 11.8, 7.5);
    await expect(page.locator(marker)).toHaveAttribute('data-mode', 'onscreen');
    await expect(page.locator(marker)).not.toHaveAttribute('data-occluded', '');
    await checkClear(page);
    const worldY = () => page.evaluate(() => {
      const { renderer } = window.__BREACH__ as unknown as { renderer: Renderer };
      return renderer.objective.position.y;
    });
    const y = await worldY();
    const initialCalls = await page.evaluate(() => (window.__BREACH__ as unknown as { renderer: Renderer }).renderer.calls);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await worldY()).toBe(y);
    if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/obj-mobile.png' });
    expect(errors).toEqual([]);
    console.log(`objective mobile high: ${initialCalls} draw calls; ${errors.length} console/page errors`);
  });
});
