import { expect, test } from '@playwright/test';
import { screenIs, seedStorage } from './support';

/**
 * Contrato del panel (T5e): las métricas live (fps, calls, tris, …) se llenan
 * SIEMPRE que el panel abre, sin placeholder nunca. Las métricas armadas por
 * overlay (`cámara`, `orientación`, `pases`, clase `eng__metric--data`) muestran
 * `—` mientras su overlay está apagado — así lo escribe `updateDiag` a propósito:
 * armar el overlay es lo que prende la instrumentación (el probe de pases solo
 * se instala con `plan.passes`, `renderer.ts:170`). Esta lista es el allowlist
 * explícito de celdas que admiten placeholder, atado al estado del overlay.
 */
const OVERLAY_CELLS: Record<string, string> = {
  'cámara': 'camera',
  'orientación': 'camera',
  'pases': 'passes',
};

const isValue = (value: string): boolean => value !== '—' && value !== '' && value !== 'NaN';

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
    expect(opened.values[5]).toMatch(/^\d+$/);

    // Métricas live: placeholder prohibido, siempre. Si una pierde su valor, esto falla.
    const live = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('#engineering .eng__metric:not(.eng__metric--data) b'), (el) => el.textContent ?? ''),
    );
    expect(live.length, 'las métricas live del panel deben existir').toBeGreaterThanOrEqual(12);
    expect(live.every(isValue), `live sin placeholder: ${JSON.stringify(live)}`).toBe(true);

    // Celdas armadas por overlay: `—` solo permitido al cell del allowlist y solo
    // con su overlay apagado (aria-pressed=false). 'postfx' nunca lleva placeholder.
    const readDiag = () =>
      page.evaluate(() => ({
        cells: Array.from(document.querySelectorAll<HTMLElement>('#engineering .eng__metric--data'), (cell) => ({
          label: cell.querySelector('span')?.textContent?.trim() ?? '',
          value: cell.querySelector('b')?.textContent ?? '',
        })),
        armed: Object.fromEntries(
          Array.from(document.querySelectorAll<HTMLButtonElement>('#engineering .eng__toggle'), (button) => [
            button.dataset.overlay ?? '',
            button.getAttribute('aria-pressed') === 'true',
          ]),
        ) as Record<string, boolean>,
      }));
    const { cells, armed } = await readDiag();
    expect(cells.map((cell) => cell.label)).toEqual(['cámara', 'orientación', 'postfx', 'pases']);
    for (const cell of cells) {
      if (cell.value === '—') {
        const overlay = OVERLAY_CELLS[cell.label];
        expect(overlay, `placeholder sin allowlist en "${cell.label}"`).toBeDefined();
        expect(armed[overlay], `${cell.label}: aria-pressed`).toBe(false);
      } else {
        expect(isValue(cell.value), `${cell.label} = "${cell.value}": valor inválido`).toBe(true);
      }
    }

    // Armamos los overlays de las celdas del allowlist: los `—` deben desaparecer
    // (refresh del panel es 4 Hz, ~300 ms) y NINGUNA celda puede quedar vacía.
    const armedKeys = [...new Set(Object.values(OVERLAY_CELLS))];
    await page.evaluate((keys) => {
      for (const overlay of keys) {
        (document.querySelector(`#engineering .eng__toggle[data-overlay="${overlay}"]`) as HTMLButtonElement).click();
      }
    }, armedKeys);
    await expect
      .poll(
        async () =>
          (await readDiag()).cells.every((cell) => isValue(cell.value)),
        { timeout: 5_000 },
      )
      .toBe(true);
  });
}
