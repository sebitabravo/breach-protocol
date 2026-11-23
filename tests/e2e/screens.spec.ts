import { expect, test, type Page } from '@playwright/test';
import { VIEWPORTS, mockApi, openHowToPlay, screenIs, seedStorage, shot, visibleBox, type Viewport } from './support';

const PROGRESS_CLEARED = {
  sectors: [
    { attempts: 2, wins: 1, bestScore: 2310, bestTimeMs: 151_000 },
    { attempts: 0, wins: 0, bestScore: 0, bestTimeMs: null },
    { attempts: 0, wins: 0, bestScore: 0, bestTimeMs: null },
  ],
  overflow: { bestWave: 3, bestScore: 4800 },
  daily: { lastPlayed: null, streak: 2 },
  tutorialSeen: true,
  playerName: 'SEBITA',
};

/** Elementos que el HUD muestra en partida: ninguno puede solaparse con otro. */
/** Se miden bloques reales, no el contenedor `.hud__top`, que mide toda la fila. */
const HUD_TOUCH_PAIRS: [string, string][] = [
  ['.hud__block--right', '.tbtn--pause'],
  ['.hud__feed', '.hud__minimap'],
  ['.hud__feed', '.hud__block--right'],
  ['.ammo', '.tbtn--fire'],
  ['.ammo', '.tbtn--reload'],
  ['.ammo', '.tbtn--jump'],
  ['.vitals', '.touch__stick'],
  ['.hud__minimap', '.hud__block--sector'],
  ['.hud__block--sector', '.hud__objective-track'],
  ['.hud__block--right', '.hud__objective-track'],
];

const HUD_DESKTOP_PAIRS: [string, string][] = [
  ['.hud__minimap', '.hud__block--sector'],
  ['.hud__block--sector', '.hud__block--objective'],
  ['.hud__block--objective', '.hud__block--right'],
  ['.hud__feed', '.hud__block--right'],
  ['.hud__objective-track', '.hud__block--right'],
  ['.hud__objective-track', '.hud__block--sector'],
  ['.vitals', '.ammo'],
];

async function overlapping(page: Page, pairs: [string, string][]): Promise<string[]> {
  const found: string[] = [];
  for (const [a, b] of pairs) {
    const boxA = await visibleBox(page, a);
    const boxB = await visibleBox(page, b);
    if (!boxA || !boxB) continue;
    const intersect =
      boxA.x < boxB.x + boxB.w - 1 && boxB.x < boxA.x + boxA.w - 1 && boxA.y < boxB.y + boxB.h - 1 && boxB.y < boxA.y + boxA.h - 1;
    if (intersect) found.push(`${a} ∩ ${b}`);
  }
  return found;
}

/** Comprueba que el HUD tenga todos sus elementos visibles antes de medir solapes. */
async function expectHudVisible(page: Page, selectors: string[]): Promise<void> {
  for (const selector of selectors) {
    const box = await visibleBox(page, selector);
    expect(box, `${selector} debe estar visible para medir solapes`).not.toBeNull();
  }
}

/** P4: Jugar entra directo a la arena del sector recomendado; la cadena de campaña
 *  (sectores → briefing) queda sin entrada de menú y se verifica a nivel de máquina
 *  de estados (tests/unit/flow.test.ts). */
async function startMissionFromMenu(page: Page, viewport: Viewport): Promise<void> {
  await screenIs(page, 'menu');
  await shot(page, viewport, '01-menu');
  await page.locator('#screen-menu [data-action="play"]').click();
  await screenIs(page, 'playing');
  await shot(page, viewport, '02-playing');
  await expect(page.locator('#hud')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.mobile,
      hasTouch: viewport.mobile,
    });

    test('menu, play, pause, results, leaderboard and how-to-play are reachable and captured', async ({ page }) => {
      await seedStorage(page, { tutorialSeen: true, progress: PROGRESS_CLEARED });
      await mockApi(page, {});
      await page.goto('/');
      await startMissionFromMenu(page, viewport);

      await expect(page.locator('#hud-wave-total')).toHaveText('/5');
      await shot(page, viewport, '04-playing');

      // Con pointer lock activo (Linux headless lo concede) el navegador entrega el mouse al
      // canvas: un jugador real pausa con Esc, así que el clic sobre el HUD se despacha directo.
      if (viewport.mobile) await page.locator('.tbtn--pause').click();
      else await page.locator('#btn-pause-hud').dispatchEvent('click');
      await screenIs(page, 'pause');
      await shot(page, viewport, '05-pause');
      await page.locator('#screen-pause [data-action="resume"]').click();
      await screenIs(page, 'playing');

      const ended = await page.evaluate(() => window.__BREACH__?.debugRunToEnd() ?? false);
      expect(ended, 'la partida de misión debe terminar con entrada neutra').toBe(true);
      await screenIs(page, 'result');
      await expect(page.locator('#result-next')).toBeHidden();
      await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'ineligible');
      await shot(page, viewport, '06-result-mission-loss');

      await page.locator('#screen-result [data-action="menu"]').click();
      await screenIs(page, 'menu');
      await page.locator('#screen-menu [data-goto="about"]').click();
      await screenIs(page, 'about');
      await shot(page, viewport, '07-how-to-play');
      await page.locator('#screen-about [data-goto="menu"]').click();
      await screenIs(page, 'menu');

      // La clasificación queda desacoplada del bucle: entrada explícita desde resultados.
      await page.locator('#screen-menu [data-action="play"]').click();
      await screenIs(page, 'playing');
      await page.evaluate(() => window.__BREACH__?.debugRunToEnd());
      await screenIs(page, 'result');
      await page.locator('#screen-result [data-goto="leaderboard"]').click();
      await screenIs(page, 'leaderboard');
      await expect(page.locator('#board-rows .board__row').first()).toBeVisible();
      await shot(page, viewport, '08-leaderboard');
      await page.locator('#screen-leaderboard [data-goto="menu"]').click();
      await screenIs(page, 'menu');
    });

    test('overflow results can be submitted: idle, sending, ranked, offline and retry', async ({ page }) => {
      await seedStorage(page, { tutorialSeen: true, progress: PROGRESS_CLEARED });
      let calls = 0;
      await mockApi(page, {
        post: async (route) => {
          calls += 1;
          if (calls === 1) {
            await route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"store"}' });
            return;
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ ok: true, board: 'overflow', score: 4800, scoreVersion: 1, won: false, rank: 4, total: 31 }),
          });
        },
      });
      await page.goto('/');
      await screenIs(page, 'menu');
      // P4: Overflow queda oculto del menú (código intacto); el e2e lo alcanza por el handle.
      await page.evaluate(() => window.__BREACH__!.startMatch('overflow', 0));
      await screenIs(page, 'playing');
      await page.evaluate(() => window.__BREACH__?.debugRunToEnd());
      await screenIs(page, 'result');
      await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'idle');
      await page.locator('#board-name').fill('SEBITA');
      await page.locator('#board-send').click();
      await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'offline');
      await shot(page, viewport, '09-result-offline');
      await page.locator('#board-send').click();
      await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'ranked');
      await expect(page.locator('#board-rank')).toHaveText('#4');
      await shot(page, viewport, '10-result-ranked');
    });

    test('skipping the tutorial pauses practice until the player chooses to resume', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await seedStorage(page, { tutorialSeen: false });
      await mockApi(page, {});
      await page.goto('/');
      await openHowToPlay(page);
      await shot(page, viewport, '11-how-to-play');
      await page.locator('#screen-about [data-action="tutorial-replay"]').click();
      await screenIs(page, 'playing');
      const hud = page.locator('#hud');
      await expect(hud).toBeVisible();
      await expect(page.locator('#tutorial')).toBeVisible();
      await shot(page, viewport, '12-tutorial');
      if (viewport.mobile) await page.getByRole('button', { name: 'Omitir tutorial' }).tap();
      else {
        // Funciona con el puntero capturado. La primera pulsación pide confirmar; la segunda omite.
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
      }
      await screenIs(page, 'tutorial-handoff');
      const handoff = page.getByRole('region', { name: 'TUTORIAL OMITIDO' });
      await expect(handoff).toBeVisible();
      await expect(handoff.getByRole('button')).toHaveText(['Empezar el protocolo', 'Seguir practicando', 'Volver al menú']);
      await expect(handoff.getByRole('list')).toHaveCount(0);
      await expect(handoff.locator('time')).toBeHidden();
      await expect(page.locator('#tutorial')).toBeHidden();
      await expect(hud).toBeHidden();
      const practice = handoff.getByRole('button', { name: 'Seguir practicando' });
      if (viewport.mobile) await practice.tap();
      else await practice.click();
      await screenIs(page, 'playing');
      await expect(handoff).toBeHidden();
      await expect(hud).toBeVisible();
      await expect(page.locator('#hud-sector-code')).toHaveText('SIMULADOR');
      await expect(page.locator('#tutorial')).toBeHidden();
      expect(errors).toEqual([]);
    });

    test('the HUD keeps its elements apart while playing', async ({ page }) => {
      await seedStorage(page, { tutorialSeen: true, progress: PROGRESS_CLEARED });
      await mockApi(page, {});
      await page.goto('/');
      await startMissionFromMenu(page, viewport);
      await page.waitForTimeout(600);

      const required = viewport.mobile
        ? ['.ammo', '.vitals', '.tbtn--fire', '.tbtn--reload', '.tbtn--jump', '.touch__stick', '.tbtn--pause', '.hud__block--right']
        : ['.ammo', '.vitals', '.hud__block--right', '.hud__minimap'];
      await expectHudVisible(page, required);

      const pairs = viewport.mobile ? [...HUD_TOUCH_PAIRS, ...HUD_DESKTOP_PAIRS] : HUD_DESKTOP_PAIRS;
      expect(await overlapping(page, pairs)).toEqual([]);
    });

    test('the boot fallback screen appears when the core cannot load', async ({ page }) => {
      await seedStorage(page, { tutorialSeen: true });
      await page.route('**/bp_core.wasm', (route) => route.fulfill({ status: 500, body: 'boom' }));
      await page.goto('/');
      await screenIs(page, 'fallback');
      await expect(page.locator('#fallback-detail')).toContainText('no se pudo descargar');
      await shot(page, viewport, '13-fallback');
    });
  });
}
