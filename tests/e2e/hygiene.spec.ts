import { expect, test, type Page } from '@playwright/test';
import type { Engine } from '../../src/wasm/bridge';
import { screenIs, seedStorage } from './support';

const tick = (page: Page) => page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.tick);
const pz = (page: Page) => page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.pz);

async function gameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window.__BREACH__ as unknown as { engine?: unknown } | undefined)?.engine), undefined, {
    timeout: 30_000,
  });
}

test('an idle preload leaves a first-time visitor on the landing menu', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: false });
  await page.goto('/');
  await gameReady(page);
  await page.waitForTimeout(800);
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu');
});

test('keys pressed on a menu do not move the player on the first tick', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('Space');
  await page.locator('#screen-menu [data-action="practice"]').click();
  await screenIs(page, 'playing');
  const start = await pz(page);
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('Space');
  expect(await tick(page)).toBeGreaterThan(10);
  expect(Math.abs((await pz(page)) - start)).toBeLessThan(0.3);
});

test('pausing stops the simulation and restarting begins from a clean tick', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.locator('#screen-menu [data-action="practice"]').click();
  await screenIs(page, 'playing');
  await expect.poll(() => tick(page)).toBeGreaterThan(60);

  await page.keyboard.press('Escape');
  await screenIs(page, 'pause');
  const frozen = await tick(page);
  await page.waitForTimeout(400);
  expect(await tick(page)).toBe(frozen);

  await page.locator('#screen-pause [data-action="restart"]').click();
  await screenIs(page, 'playing');
  expect(await tick(page)).toBeLessThan(frozen);
});
