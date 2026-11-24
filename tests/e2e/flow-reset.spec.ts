import { expect, test } from '@playwright/test';
import { mockApi, screenIs, seedStorage } from './support';

/**
 * P4 — simplificación de flujo (owner decisions en odd/tasks/product-reset.md):
 * menú = identidad + Jugar + Cómo jugar + Ajustes; sin gate de calibración;
 * Daily y Overflow fuera de toda superficie visible; Engineering Mode solo
 * desarrollo; tablero desacoplado y offline como camino normal.
 */

test('the primary menu is identity, Jugar, Cómo jugar and Ajustes only', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await mockApi(page, {});
  await page.goto('/');
  await screenIs(page, 'menu');

  const labels = await page.locator('#screen-menu .menu__list .navitem__label').allTextContents();
  expect(labels).toEqual(['Jugar', 'Cómo jugar', 'Ajustes']);

  // Todo lo demás sale del menú primario: modos ocultos, cadena de campaña,
  // clasificación (vive desacoplada), engineering y atajos de tutorial.
  await expect(page.locator(
    '#screen-menu [data-action="overflow"], #screen-menu [data-action="daily"], #screen-menu [data-action="mission"], '
    + '#screen-menu [data-action="practice"], #screen-menu [data-action="tutorial-replay"], '
    + '#screen-menu [data-action="engineering"], #screen-menu [data-goto="leaderboard"]',
  )).toHaveCount(0);

  // Daily y Overflow dejan de ser superficies visibles también en el panel de estado.
  await expect(page.locator('#menu-streak, #menu-overflow, #menu-daily-meta, #menu-practice-meta')).toHaveCount(0);
});

test('one click from the boot menu puts a first-time player in the arena and shooting', async ({ page }) => {
  // Sin sembrar tutorialSeen: la primera visita es el caso que el gate viejo interceptaba.
  await mockApi(page, {});
  await page.goto('/');
  const app = page.locator('#app');
  await screenIs(page, 'menu');

  const startedAt = Date.now();
  let clicks = 0;
  await page.locator('#screen-menu [data-action="play"]').click();
  clicks += 1;
  // Cualquier pantalla intermedia que exija otro click explícito es un gate.
  for (let guard = 0; guard < 3 && (await app.getAttribute('data-screen')) !== 'playing'; guard += 1) {
    const screen = await app.getAttribute('data-screen');
    await page.locator(`#screen-${screen} [data-action="play"]`).click();
    clicks += 1;
    await page.waitForTimeout(300);
  }
  const seconds = (Date.now() - startedAt) / 1000;
  console.log(`[shortest-path] menu -> arena: clicks=${clicks} seconds=${seconds.toFixed(2)}`);
  await screenIs(page, 'playing');
  await expect(page.locator('#hud-sector-code')).toHaveText('SECTOR 01');
  expect(clicks, 'Jugar debe llegar a la arena en un solo click: sin gate de calibración').toBe(1);

  // Disparar: la carga baja de 12. El disparo es el final real del camino.
  await expect(page.locator('#hud-ammo')).toHaveText('12');
  await page.locator('[data-touch="fire"]').tap();
  await expect.poll(() => page.locator('#hud-ammo').textContent()).not.toBe('12');
});

test('engineering mode is gone from the player UI and reachable through ?dev=1', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await mockApi(page, {});
  await page.goto('/');
  await screenIs(page, 'menu');
  await expect(page.locator('#screen-menu [data-action="engineering"]')).toHaveCount(0);
  await expect(page.locator('#engineering')).toBeHidden();

  // Mecanismo de desarrollo explícito: bandera de query, junto a ?boot= y ?viewmodel=.
  await page.goto('/?dev=1');
  await screenIs(page, 'menu');
  await expect(page.locator('#engineering')).toBeVisible();
});

test('calibration stays reachable from pause settings and returns to the pause', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await mockApi(page, {});
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.locator('#screen-menu [data-action="play"]').click();
  await screenIs(page, 'playing');
  await page.keyboard.press('Escape');
  await screenIs(page, 'pause');
  await page.locator('#screen-pause [data-tab="access"]').click();
  await page.locator('#screen-pause [data-goto="calibrate"]').click();
  await screenIs(page, 'calibrate');

  // Ningún valor de calibración pierde su persistencia.
  await page.locator('#calib-sens').evaluate((node) => {
    const input = node as HTMLInputElement;
    input.value = '1.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#screen-calibrate [data-goto="menu"]').click();
  await screenIs(page, 'pause');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bp.settings') ?? '{}'));
  // El slider de calibración ajusta la sensibilidad del dispositivo activo (mouse o táctil).
  expect([saved.sensitivityMouse, saved.sensitivityTouch]).toContain(1.5);
});

test('offline is a normal path: local record, results, retry and board all work', async ({ page }) => {
  await seedStorage(page, { tutorialSeen: true });
  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  await screenIs(page, 'menu');

  await page.locator('#screen-menu [data-action="play"]').click();
  await screenIs(page, 'playing');
  expect(await page.evaluate(() => window.__BREACH__!.debugRunToEnd())).toBe(true);
  await screenIs(page, 'result');

  // El récord local se escribió y se lee sin ninguna red.
  const scores = await page.evaluate(() => JSON.parse(localStorage.getItem('bp.scores.v1') ?? '[]'));
  expect(scores.length, 'saveScore debe dejar la corrida en el registro local').toBeGreaterThan(0);

  // Un modo elegible llega al tablero; sin red, el envío es un estado normal, no un error.
  await page.evaluate(() => window.__BREACH__!.startMatch('overflow', 0));
  await screenIs(page, 'playing');
  expect(await page.evaluate(() => window.__BREACH__!.debugRunToEnd())).toBe(true);
  await screenIs(page, 'result');
  await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'idle');
  await page.locator('#board-name').fill('SEBITA');
  await page.locator('#board-send').click();
  await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'offline');
  await expect(page.locator('#board-text')).toContainText('queda guardada en este equipo');

  // El reintento del bucle sigue funcionando inmediatamente, sin red.
  await page.locator('#screen-result [data-action="restart"]').click();
  await screenIs(page, 'playing');

  // La clasificación queda desacoplada: entrada explícita desde resultados,
  // con su propio estado offline y sin pestañas de modos ocultos.
  await page.keyboard.press('Escape');
  await screenIs(page, 'pause');
  await page.locator('#screen-pause [data-action="menu"]').dblclick();
  await page.locator('#screen-menu [data-action="play"]').click();
  await screenIs(page, 'playing');
  await page.evaluate(() => window.__BREACH__!.debugRunToEnd());
  await screenIs(page, 'result');
  await expect(page.locator('#screen-result [data-goto="leaderboard"]')).toBeVisible();
  await page.locator('#screen-result [data-goto="leaderboard"]').click();
  await screenIs(page, 'leaderboard');
  await expect(page.locator('[data-board="overflow"], [data-board="daily"]')).toHaveCount(0);
  await expect(page.locator('#board-state')).toContainText('Sin conexión');
});
