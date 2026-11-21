import { expect, test, type Page } from '@playwright/test';
import { openCalibration, playFromLanding } from './support';

async function startRun(page: Page): Promise<void> {
  await page.goto('/');
  await playFromLanding(page);
}

test('losing the WebGL context pauses the match and restoring it recovers', async ({ page }) => {
  await startRun(page);
  const app = page.locator('#app');

  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2');
    (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx = gl!.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx.loseContext();
  });
  await expect(app).toHaveAttribute('data-ctx', 'lost');
  await expect(app).toHaveAttribute('data-screen', 'pause');
  await expect(page.locator('#context-lost')).toBeVisible();

  await page.evaluate(() => (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx.restoreContext());
  await expect(app).toHaveAttribute('data-ctx', 'ok');
  await expect(page.locator('#context-lost')).toBeHidden();
});

test('a pointerlockerror does not pause the match', async ({ page }) => {
  await startRun(page);
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockerror')));
  await page.waitForTimeout(150);
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
});

test('escape from settings opened on the menu returns to the menu', async ({ page }) => {
  await page.goto('/');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-screen', /calibrate|menu/, { timeout: 30_000 });
  if ((await app.getAttribute('data-screen')) === 'calibrate') {
    await page.locator('#screen-calibrate [data-action="play"]').click();
    await expect(app).toHaveAttribute('data-screen', 'playing');
    await page.keyboard.press('Escape');
    await page.locator('#screen-pause [data-action="menu"]').dblclick();
  }
  await expect(app).toHaveAttribute('data-screen', 'menu');
  await page.locator('#screen-menu [data-action="settings"]').click();
  await expect(app).toHaveAttribute('data-screen', 'pause');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-screen', 'menu');
});

test('the calibration sheet can be scrolled to START at 320x640', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const app = page.locator('#app');
  await openCalibration(page);
  const start = page.locator('#screen-calibrate [data-action="play"]');
  const scrollable = await page.evaluate(() => {
    let node = document.querySelector('#screen-calibrate [data-action="play"]')!.parentElement;
    while (node && node !== document.documentElement) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight) return true;
      node = node.parentElement;
    }
    return false;
  });
  expect(scrollable, 'a real user must be able to scroll to START').toBe(true);
  await start.scrollIntoViewIfNeeded();
  await expect(start).toBeInViewport();
});

test('the game reaches the menu when the browser blocks localStorage', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-screen', /calibrate|menu/, { timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('Continuar does nothing while the WebGL context is lost and works after it is restored', async ({ page }) => {
  await startRun(page);
  const app = page.locator('#app');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-screen', 'pause');
  await page.evaluate(() => {
    const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2')!;
    const ext = gl.getExtension('WEBGL_lose_context')!;
    (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx = ext;
    ext.loseContext();
  });
  await expect(app).toHaveAttribute('data-ctx', 'lost');

  const tick = () => page.evaluate(() => (window.__BREACH__ as unknown as { engine: { state: { tick: number } } }).engine.state.tick);
  const before = await tick();
  // El aviso de contexto perdido cubre la pantalla: se invoca el botón directamente.
  await page.locator('#screen-pause [data-action="resume"]').dispatchEvent('click');
  await page.waitForTimeout(400);
  await expect(app).toHaveAttribute('data-screen', 'pause');
  expect(await tick()).toBe(before);

  await page.evaluate(() => (window as unknown as { __loseCtx: WEBGL_lose_context }).__loseCtx.restoreContext());
  await expect(app).toHaveAttribute('data-ctx', 'ok');
  await page.locator('#screen-pause [data-action="resume"]').click();
  await expect(app).toHaveAttribute('data-screen', 'playing');
});

test('restarting on the same map clears the casings and impact marks of the previous match', async ({ page }) => {
  await startRun(page);
  const fx = () => page.evaluate(() => {
    const feedback = (window.__BREACH__ as unknown as {
      renderer: { feedback: { caseCursor: number; impactCursor: number } };
    }).renderer.feedback;
    return feedback.caseCursor + feedback.impactCursor;
  });
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  expect(await fx()).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  const restart = page.locator('#screen-pause [data-action="restart"]');
  await restart.dblclick();
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'playing');
  expect(await fx()).toBe(0);
});
