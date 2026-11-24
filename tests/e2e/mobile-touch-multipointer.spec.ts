/**
 * Prueba e2e de dos punteros táctiles simultáneos (móvil landscape).
 *
 * Playwright no puede entregar dos toques independientes con la API pública
 * (`page.touchscreen` es de un solo punto), así que se usa el canal CDP
 * `Input.dispatchTouchEvent`: cada `touchPoint` lleva su `id` y Chromium le
 * asigna un `pointerId` propio, que es exactamente el contrato que
 * `src/input/input.ts` exige (cada control es dueño de su puntero).
 *
 * El escenario es el caso normal de un teléfono: mover (stick) y disparar
 * (botón de fuego) al mismo tiempo. Se cubre:
 * - touchStart con DOS puntos a la vez: fuego dispara mientras el stick está
 *   agarrado.
 * - touchMove del punto del stick con ambos dedos aún abajo: el jugador se
 *   mueve SIN cancelar el disparo.
 * - touchEnd de solo el punto de fuego: el movimiento sigue.
 * - touchEnd del punto del stick: ninguna deriva trabada.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Engine } from '../../src/wasm/bridge';
import { seedStorage, screenIs, visibleBox } from './support';

async function startOverflow(page: Page): Promise<void> {
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.evaluate(() => window.__BREACH__!.startMatch('overflow', 0));
  await screenIs(page, 'playing');
}

test('two simultaneous touch pointers drive move + fire; lifting either pointer leaves no stuck state', async ({ page }) => {
  await startOverflow(page);
  const stick = (await visibleBox(page, '#touch-stick'))!;
  const fire = (await visibleBox(page, '[data-touch="fire"]'))!;
  const stickAt = { x: stick.x + stick.w / 2, y: stick.y + stick.h / 2 };
  const fireAt = { x: fire.x + fire.w / 2, y: fire.y + fire.h / 2 };

  const touch = await page.context().newCDPSession(page);
  const shots = () =>
    page.evaluate(
      () => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.shots,
    );
  const pos = () =>
    page.evaluate(() => {
      const s = (window.__BREACH__ as unknown as { engine: Engine }).engine.state;
      return { px: s.px, pz: s.pz };
    });

  // Ambos dedos bajan en la MISMA touchStart: dos pointerId independientes.
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...stickAt, id: 11 }, { ...fireAt, id: 22 }],
  });
  // El disparo sale con el stick ya agarrado: fuego y movimiento conviven.
  await expect.poll(shots, { timeout: 5000 }).toBeGreaterThan(0);

  const beforeMove = await shots();
  const start = await pos();
  // Arrastrar el punto del stick con el dedo de fuego todavía abajo.
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: stickAt.x + 90, y: stickAt.y, id: 11 }, { ...fireAt, id: 22 }],
  });
  await expect.poll(
    async () => {
      const now = await pos();
      return Math.hypot(now.px - start.px, now.pz - start.pz);
    },
    { timeout: 5000 },
  ).toBeGreaterThan(0.3);
  // El disparo no se canceló durante el movimiento (sigue held; el conteo no baja).
  expect(await shots()).toBeGreaterThanOrEqual(beforeMove);

  // Levantar SOLO el dedo de fuego: el movimiento continúa intacto.
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [{ ...fireAt, id: 22 }],
  });
  const anchor = await pos();
  await expect.poll(
    async () => {
      const now = await pos();
      return Math.hypot(now.px - anchor.px, now.pz - anchor.pz);
    },
    { timeout: 4000 },
  ).toBeGreaterThan(0.15);
  expect(await shots()).toBeGreaterThanOrEqual(beforeMove); // sin respawn de fuego

  // Levantar el dedo del stick: ninguna deriva trabada.
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const settled = await pos();
  await page.waitForTimeout(450);
  const after = await pos();
  expect(Math.hypot(after.px - settled.px, after.pz - settled.pz)).toBeLessThan(0.02);
});
