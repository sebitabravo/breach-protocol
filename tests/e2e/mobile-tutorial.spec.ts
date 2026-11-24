import { expect, test } from '@playwright/test';
import { openHowToPlay, screenIs, seedStorage } from './support';

test('the touch tutorial speaks touch, can be continued and skipped without a keyboard', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: false });
  await page.goto('/');
  await openHowToPlay(page);
  await page.locator('#screen-about [data-action="tutorial-replay"]').tap();
  await screenIs(page, 'playing');

  const tutorial = page.locator('#tutorial');
  await expect(tutorial).toBeVisible();
  // innerText omite lo oculto con display:none; textContent no.
  expect(await tutorial.evaluate((node) => (node as HTMLElement).innerText)).not.toMatch(/WASD|mouse|clic|Enter|Retroceso/i);
  await expect(page.locator('.tutorial__keys')).toBeHidden();
  await expect(page.locator('#tut-body')).toContainText('Joystick');

  const next = page.locator('[data-action="tutorial-continue"]');
  await expect(next).toBeVisible();
  const box = (await next.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await next.tap();
  await expect(page.locator('#tut-index')).toHaveText('2');
  await next.tap();
  await expect(page.locator('#tut-index')).toHaveText('3');
  await expect(page.locator('#tut-body')).toContainText('Ⓔ');

  await page.locator('[data-action="tutorial-skip"]').tap();
  await screenIs(page, 'tutorial-handoff');
});
