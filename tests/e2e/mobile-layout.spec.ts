import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR, screenIs, seedStorage } from './support';

const LANDSCAPE = [
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];
const PORTRAIT = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];

interface Box {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function startPlaying(page: Page): Promise<void> {
  await seedStorage(page, { tutorialSeen: true });
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.locator('#screen-menu [data-action="practice"]').tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#app')).toHaveClass(/is-touch/);
}

/** Cajas de los controles táctiles visibles más el stick, en píxeles CSS. */
async function touchBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Box[] = [];
    const nodes = document.querySelectorAll<HTMLElement>('#touch-layer [data-touch], #touch-stick');
    nodes.forEach((node) => {
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (r.width === 0 || r.height === 0 || style.display === 'none' || style.visibility === 'hidden') return;
      out.push({ name: node.dataset.touch ?? 'stick', x: r.x, y: r.y, w: r.width, h: r.height });
    });
    return out;
  });
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const viewports = (project: string) => (project === 'mobile-landscape' ? LANDSCAPE : PORTRAIT);

test.describe('touch layout', () => {
  test('controls never overlap, fit the screen and keep a 44px target', async ({ page }, info) => {
    await startPlaying(page);
    for (const size of viewports(info.project.name)) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const boxes = await touchBoxes(page);
      const label = `${size.width}x${size.height}`;
      const names = boxes.map((b) => b.name);
      for (const required of ['stick', 'fire', 'jump', 'reload', 'switch', 'ads', 'pause']) {
        expect(names, `${label}: ${required} must be visible`).toContain(required);
      }
      for (const box of boxes) {
        expect(box.w, `${label} ${box.name} width`).toBeGreaterThanOrEqual(44);
        expect(box.h, `${label} ${box.name} height`).toBeGreaterThanOrEqual(44);
        expect(box.x, `${label} ${box.name} left`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${label} ${box.name} top`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w, `${label} ${box.name} right`).toBeLessThanOrEqual(size.width);
        expect(box.y + box.h, `${label} ${box.name} bottom`).toBeLessThanOrEqual(size.height);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(overlaps(boxes[i], boxes[j]), `${label}: ${boxes[i].name} overlaps ${boxes[j].name}`).toBe(false);
        }
      }
      await page.screenshot({ path: `${SHOT_DIR}/mobile-${label}-play.png` });
    }
  });

  test('score and objective stay visible on a phone', async ({ page }, info) => {
    await startPlaying(page);
    for (const size of viewports(info.project.name)) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      for (const id of ['#hud-score', '#hud-objective-line']) {
        const box = await page.locator(id).boundingBox();
        expect(box, `${size.width}x${size.height} ${id}`).not.toBeNull();
        expect(box!.width).toBeGreaterThan(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      }
    }
  });
});

test('portrait phones get a non-blocking rotate hint', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile-portrait', 'portrait only');
  await startPlaying(page);
  const hint = page.locator('#rotate-hint');
  await expect(hint).toBeVisible();
  expect(await hint.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(hint).toBeHidden();
});

test('touch targets in the pause menu are at least 44px', async ({ page }) => {
  await startPlaying(page);
  await page.locator('[data-touch="pause"]').tap();
  await screenIs(page, 'pause');
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const selector = '#screen-pause .btn, #screen-pause .seg, #screen-pause .tab, #screen-pause .iconbtn, #screen-pause button';
    document.querySelectorAll<HTMLElement>(selector).forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.height < 44 || r.width < 44) out.push(`${node.className || node.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  expect(small).toEqual([]);
});
