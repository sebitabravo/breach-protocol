import { expect, type Page, type Route } from '@playwright/test';

/** Directorio de capturas: `SHOT_DIR` lo redirige fuera del repo; por defecto, test-results/. */
export const SHOT_DIR = process.env.SHOT_DIR ?? 'test-results/screens';

export const VIEWPORTS = [
  { name: 'desktop-1600', width: 1600, height: 900, mobile: false },
  { name: 'landscape-844', width: 844, height: 390, mobile: true },
  { name: 'portrait-320', width: 320, height: 640, mobile: true },
] as const;

export type Viewport = (typeof VIEWPORTS)[number];

/** Progreso y ajustes sembrados antes de cargar; solo si la clave aún no existe. */
export async function seedStorage(
  page: Page,
  options: { tutorialSeen: boolean; progress?: Record<string, unknown> },
): Promise<void> {
  await page.addInitScript(
    ({ tutorialSeen, progress }) => {
      if (!localStorage.getItem('bp.settings')) {
        localStorage.setItem(
          'bp.settings',
          JSON.stringify({ version: 2, quality: 'low', tutorialSeen, reduceMotion: false }),
        );
      }
      if (progress && !localStorage.getItem('bp.progress.v1')) {
        localStorage.setItem('bp.progress.v1', JSON.stringify({ version: 1, ...progress }));
      }
    },
    { tutorialSeen: options.tutorialSeen, progress: options.progress },
  );
}

export async function mockApi(page: Page, handlers: { post?: (route: Route) => Promise<void> }): Promise<void> {
  await page.route('**/api/leaderboard**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        board: 'overflow',
        total: 3,
        entries: [
          { rank: 1, name: 'SEBITA', score: 9100, at: 1766000000 },
          { rank: 2, name: 'ARGOS_TEST', score: 6400, at: 1765900000 },
          { rank: 3, name: 'OPERADOR', score: 2310, at: 1765800000 },
        ],
      }),
    }),
  );
  await page.route('**/api/runs', (route) =>
    handlers.post ? handlers.post(route) : route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"store"}' }),
  );
}

export async function shot(page: Page, viewport: Viewport, name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOT_DIR}/${viewport.name}-${name}.png` });
}

export async function screenIs(page: Page, screen: string): Promise<void> {
  await expect(page.locator('#app')).toHaveAttribute('data-screen', screen, { timeout: 30_000 });
}

/** Primera visita: la precarga en reposo deja el menú; Jugar lleva a calibración. */
export async function openCalibration(page: Page): Promise<void> {
  await screenIs(page, 'menu');
  await page.locator('#screen-menu [data-action="play"]').click();
  await screenIs(page, 'calibrate');
}

/** Del arranque a partida, pase o no por la hoja de calibración de primera visita. */
export async function playFromLanding(page: Page): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-screen', /calibrate|menu/, { timeout: 30_000 });
  for (let step = 0; step < 2 && (await app.getAttribute('data-screen')) !== 'playing'; step += 1) {
    const screen = await app.getAttribute('data-screen');
    await page.locator(`#screen-${screen} [data-action="play"]`).click();
    await expect(app).toHaveAttribute('data-screen', /calibrate|playing/);
  }
  await expect(app).toHaveAttribute('data-screen', 'playing');
}

/** Tamaño visible de un elemento; cero si no se ve (oculto, sin layout o fuera de pantalla). */
export async function visibleBox(page: Page, selector: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  return page.evaluate((sel) => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(sel));
    const node = nodes.find((el) => el.checkVisibility() && el.getBoundingClientRect().width > 0);
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }, selector);
}
