import { expect, test } from '@playwright/test';
import { screenIs, seedStorage, startPractice } from './support';

test.beforeEach(async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
});

test('the pause screen is a modal dialog and focus lands on Continuar', async ({ page }) => {
  await startPractice(page);
  await page.keyboard.press('Escape');
  await screenIs(page, 'pause');
  const dialog = page.getByRole('dialog', { name: 'Pausa' });
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#screen-pause [data-action="resume"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await screenIs(page, 'playing');
});

test('Esc goes back one level on Cómo jugar and on settings opened from the menu', async ({ page }) => {
  // P4: la cadena de campaña (sectors -> briefing) no tiene entrada de menú; su
  // contrato de Esc vive en tests/unit/flow.test.ts y tests/unit/screens.test.ts.
  await page.locator('#screen-menu [data-goto="about"]').click();
  await screenIs(page, 'about');
  await page.keyboard.press('Escape');
  await screenIs(page, 'menu');
  await page.locator('#screen-menu [data-action="settings"]').click();
  await screenIs(page, 'pause');
  await page.keyboard.press('Escape');
  await screenIs(page, 'menu');
});

test('the toast is announced politely to assistive technology', async ({ page }) => {
  const toast = page.locator('#toast');
  await expect(toast).toHaveAttribute('role', 'status');
  await expect(toast).toHaveAttribute('aria-live', 'polite');
});

test('reduce-flashes is exposed in settings and persisted', async ({ page }) => {
  await page.locator('#screen-menu [data-action="settings"]').click();
  await screenIs(page, 'pause');
  await page.locator('#screen-pause [data-tab="access"]').click();
  const flashes = page.locator('#set-flashes');
  await flashes.check();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bp.settings') ?? '{}'));
  expect(saved.reduceFlashes).toBe(true);
  expect(saved.version).toBe(3);
});
