import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { playFromLanding } from './support';

/**
 * Boot smoke: the game must reach a playable state with zero console errors
 * and zero uncaught exceptions, and the fixed-step simulation must advance.
 * Touch is a first-class path (pointer lock does not exist headless).
 */
test('the game boots, plays and reports real numbers', async ({ page }: { page: Page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error: Error): void => {
    pageErrors.push(error.message);
  };
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  await page.goto('/');

  // 1. Boot completes into the calibration (first visit) or menu screen.
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-screen', /calibrate|menu/, { timeout: 30_000 });

  // 2. The HUD is hidden before playing.
  await expect(page.locator('#hud')).not.toBeVisible();

  // 3. Clicking play reveals the HUD (the play button lives on the active
  //    screen; other screens carry hidden copies).
  await playFromLanding(page);
  await expect(page.locator('#hud')).toBeVisible();

  // 4. One second in, the match timer moved off 3:00 and the counters show
  //    numbers: the fixed-step simulation is actually advancing.
  await page.waitForTimeout(1000);
  await expect(page.locator('#hud-time')).not.toHaveText('3:00');
  await expect(page.locator('#hud-time')).toHaveText(/^\d+:\d{2}$/);
  await expect(page.locator('#hud-remaining')).toHaveText(/^\d+$/);

  // 5. Holding KeyW for 400 ms must not throw and must not break the HUD.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#hud-time')).toHaveText(/^\d+:\d{2}$/);

  // 6. F3 opens Engineering Mode and it reports real numbers.
  await page.keyboard.press('F3');
  await expect(page.locator('#engineering')).toBeVisible();
  await expect(page.locator('#eng-fps')).toHaveText(/^\d+$/);
  await expect(page.locator('#eng-ticks')).toHaveText(/^\d+$/, { timeout: 5_000 });
  await expect(page.locator('#eng-calls')).toHaveText(/^\d+$/);
  await expect(page.locator('#eng-tris')).toHaveText(/^[\d.]+$/);

  expect(consoleErrors, `console.error: ${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `pageerror: ${pageErrors.join('\n')}`).toEqual([]);
});
