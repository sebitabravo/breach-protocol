import { expect, test } from '@playwright/test';
import type { Engine } from '../../src/wasm/bridge';
import { I, INPUT_LEN } from '../../src/wasm/protocol';
import { screenIs, seedStorage, SHOT_DIR } from './support';

test.describe('390×844 progression and objective', () => {
  test.use({ isMobile: true, viewport: { width: 390, height: 844 } });

  test('sector icons, live objective distance and earned reward render on mobile', async ({ page }) => {
    await seedStorage(page, { tutorialSeen: true });
    await page.goto('/');
    await screenIs(page, 'menu');
    await page.locator('#screen-menu [data-action="mission"]').tap();
    await screenIs(page, 'sectors');
    await expect(page.locator('[data-sector-card] .sector__icon')).toHaveCount(3);
    await expect(page.locator('[data-sector-card="0"] .sector__icon')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/review-390x844-sectors.png` });
    await page.locator('[data-sector-card="0"] [data-action="brief"]').tap();
    await page.locator('[data-action="start-mission"]').tap();
    await screenIs(page, 'playing');
    const distance = page.locator('#hud-objective-distance');
    await expect(distance).toHaveText('18 m');
    await page.screenshot({ path: `${SHOT_DIR}/review-390x844-objective.png` });
    await page.keyboard.down('KeyW');
    try {
      await expect(distance).toHaveText('16 m');
    } finally {
      await page.keyboard.up('KeyW');
    }

    // Presentation fixture: inject the win outcome at the shell boundary. The
    // progress transition, stored sector record and results DOM are real.
    const finishWithWin = () => page.evaluate(() => {
      const app = window.__BREACH__!;
      Reflect.get(app, 'finish').call(app, true);
    });
    await finishWithWin();
    await screenIs(page, 'result');
    const reward = page.locator('#result-unlock');
    await expect(reward).toHaveText('Recompensa: SECTOR_02 desbloqueado');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bp.progress.v1')!).sectors[0].wins)).toBe(1);
    await page.screenshot({ path: `${SHOT_DIR}/review-390x844-reward.png` });
    await page.locator('#screen-result [data-action="restart"]').tap();
    await screenIs(page, 'playing');
    await finishWithWin();
    await screenIs(page, 'result');
    await expect(reward).toBeHidden();
  });
});

test.describe('1280×720 arena evidence', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('screenshot of the player stopped by the southeast corner', async ({ page }) => {
    await seedStorage(page, { tutorialSeen: true });
    await page.goto('/');
    await screenIs(page, 'menu');
    await page.locator('#screen-menu [data-action="practice"]').tap();
    await screenIs(page, 'playing');
    const position = await page.evaluate(({ I, INPUT_LEN }) => {
      const { engine } = window.__BREACH__ as unknown as { engine: Engine };
      const input = new Float32Array(INPUT_LEN);
      input[I.run] = 1;
      input[I.moveZ] = -1;
      for (let i = 0; i < 60; i += 1) engine.tick(input);
      input[I.moveZ] = 0;
      input[I.moveX] = 1;
      for (let i = 0; i < 200; i += 1) engine.tick(input);
      input[I.moveZ] = -1;
      for (let i = 0; i < 45; i += 1) engine.tick(input);
      // Look toward both wall faces, without changing the collision pose.
      input.fill(0);
      for (let i = 0; i < 8; i += 1) {
        input[I.lookDx] = 3 * Math.PI / 32;
        engine.tick(input);
      }
      const { px, py, pz } = engine.state;
      return { px, py, pz };
    }, { I, INPUT_LEN });
    expect(position.px).toBeGreaterThan(16);
    expect(position.px).toBeLessThan(17);
    expect(position.pz).toBeGreaterThan(16);
    expect(position.pz).toBeLessThan(17);
    expect(position.py).toBeGreaterThanOrEqual(-0.01);
    await page.screenshot({ path: `${SHOT_DIR}/review-1280x720-corner.png` });
  });
});
