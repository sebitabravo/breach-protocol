import { expect, test } from '@playwright/test';
import { seedStorage } from './support';

test('the cold shell paints and Jugar queues a match while game JS is still blocked', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const artRequests: string[] = [];
  page.on('request', (request) => {
    if (/\.(hdr|webp|glb)$/.test(request.url())) artRequests.push(request.url());
  });
  await page.route(/\/assets\/(?:game|three)-[^/]+\.js$/, async (route) => {
    await hold;
    await route.continue();
  });

  try {
    await page.goto('/', { waitUntil: 'commit' });
    const app = page.locator('#app');
    const play = page.getByRole('button', { name: /^Jugar/ });
    await expect(play).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => page.evaluate(() => performance.getEntriesByName('first-paint').length)).toBe(1);
    await expect(page.locator('link[rel="preload"][as="fetch"][crossorigin][href="/bp_core.wasm"]')).toHaveCount(1);
    await expect(page.locator('link[rel="modulepreload"][href*="/game-"]')).toHaveCount(1);
    expect(artRequests).toEqual([]);

    await play.tap();
    await expect(app).toHaveAttribute('data-screen', 'boot');
    await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'cargando módulos' })).toBeVisible();
    await expect(page.locator('#hud')).toBeHidden();
    expect(artRequests).toEqual([]);

    release();
    await expect(app).toHaveAttribute('data-screen', 'playing', { timeout: 30_000 });
    await expect(page.locator('#hud-time')).toHaveText(/^(?!3:00$)\d+:\d{2}$/, { timeout: 30_000 });
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('an idle visit adds the orbit without hiding the menu for a boot screen', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await page.addInitScript(() => {
    const screens = new Set<string>();
    Reflect.set(window, 'bootScreens', screens);
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.attributeName === 'data-screen' && (record.target as HTMLElement).id === 'app') {
          if (record.oldValue) screens.add(record.oldValue);
          screens.add((record.target as HTMLElement).dataset.screen ?? '');
        }
      }
    }).observe(document, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['data-screen'] });
  });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('#app')).toHaveAttribute('data-screen', 'menu', { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => {
    const app = window.__BREACH__;
    return app && Reflect.get(app, 'renderer')?.calls;
  }), { timeout: 30_000 }).toBeGreaterThan(0);
  expect(await page.evaluate(() => [...Reflect.get(window, 'bootScreens')])).toEqual(['shell', 'menu']);
});
