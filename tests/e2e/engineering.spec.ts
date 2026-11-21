import { expect, test } from '@playwright/test';
import { screenIs, seedStorage } from './support';

for (const screen of ['playing', 'pause'] as const) {
  test(`F3 populates Engineering synchronously while ${screen}`, async ({ page }) => {
    await seedStorage(page, { tutorialSeen: true });
    await page.goto('/');
    await screenIs(page, 'menu');
    await page.locator('#screen-menu [data-action="practice"]').tap();
    await screenIs(page, 'playing');
    if (screen === 'pause') {
      await page.keyboard.press('Escape');
      await screenIs(page, 'pause');
    }
    const read = () => page.evaluate(() => Array.from(document.querySelectorAll('#engineering .eng__metric b'), (el) => el.textContent));
    const before = await read();
    const opened = await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', bubbles: true }));
      const panel = document.querySelector<HTMLElement>('#engineering')!;
      return { hidden: panel.hidden, values: Array.from(panel.querySelectorAll('.eng__metric b'), (el) => el.textContent) };
    });
    expect(opened.hidden).toBe(false);
    expect(opened.values).toHaveLength(before.length);
    expect(opened.values.every((value) => value !== '—' && value !== '' && value !== 'NaN')).toBe(true);
    expect(opened.values[5]).toMatch(/^\d+$/);
  });
}
