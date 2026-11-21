import { expect, test, type Page } from '@playwright/test';
import type { Renderer } from '../../src/render/renderer';
import type { Engine, WorldEvent } from '../../src/wasm/bridge';
import { EVT, I, INPUT_LEN } from '../../src/wasm/protocol';
import { mockApi, screenIs } from './support';

const capture = process.env.PREM_CAPTURE === '1';
const nitCapture = process.env.NIT_CAPTURE === '1';
const shot = async (page: Page, name: string) => {
  if (capture) await page.screenshot({ path: `/tmp/prem-${name}.png` });
  if (nitCapture && ['spawn', 'mobile', '320'].includes(name)) {
    await page.screenshot({ path: `/tmp/nit-${name}.png` });
  }
};

async function scoreBackground(page: Page) {
  const label = await page.locator('.hud__score .hud__kicker').boundingBox();
  if (!label) throw new Error('Score label is not visible');
  // Hide just the glyphs, leaving the exact same frame, layout and scrims.
  const png = await page.screenshot({ scale: 'css', style: '.hud__score > * { visibility: hidden }' });
  return page.evaluate(async ({ url, label }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(label.x + label.width) - Math.ceil(label.x);
    canvas.height = Math.floor(label.y + label.height) - Math.ceil(label.y);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, -Math.ceil(label.x), -Math.ceil(label.y));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const linear = (value: number) => value <= 10 ? value / 3294.6 : ((value / 255 + 0.055) / 1.055) ** 2.4;
    let sum = 0, peak = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const y = 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]);
      sum += y;
      peak = Math.max(peak, y);
    }
    return { mean: sum / (pixels.length / 4), peak };
  }, { url: `data:image/png;base64,${png.toString('base64')}`, label });
}

async function checkBuffClearance(page: Page) {
  await expect(page.locator('#buff-assist')).toBeVisible();
  const collisions = await page.evaluate(() => {
    const root = document.documentElement;
    const props = ['--hud-scale', '--safe-l', '--safe-r', '--safe-t', '--safe-b'];
    const original = props.map((key) => root.style.getPropertyValue(key));
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    try {
      return [[1, 0, 0, 0, 0], [0.8, 20, 0, 12, 34], [1.4, 0, 20, 12, 34]].flatMap(([scale, left, right, top, bottom]) => {
        [String(scale), `${left}px`, `${right}px`, `${top}px`, `${bottom}px`].forEach((value, i) => root.style.setProperty(props[i], value));
        const row = rect('.vitals__buffs');
        const issues = [];
        if (overlaps(row, rect('.touch__stick'))) issues.push('joystick');
        if (overlaps(row, rect('.vitals__row'))) issues.push('vitals label');
        if (row.left < left || row.right > innerWidth - right || row.top < top || row.bottom > innerHeight - bottom) issues.push('safe area');
        return issues.map((issue) => `${scale}: ${issue}`);
      });
    } finally {
      original.forEach((value, i) => value ? root.style.setProperty(props[i], value) : root.style.removeProperty(props[i]));
    }
  });
  expect(collisions).toEqual([]);
}

async function setup(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => localStorage.setItem('bp.settings', JSON.stringify({
    version: 2, quality: 'high', tutorialSeen: true, audioEnabled: false,
  })));
  await mockApi(page, {});
  await page.goto('/');
  await screenIs(page, 'menu');
  await page.waitForFunction(() => {
    const { renderer } = window.__BREACH__ as unknown as { renderer: Renderer };
    return Reflect.get(renderer, 'scene').environment && Reflect.get(renderer, 'surfaces').materials.slice(0, 3).every((m: { map: unknown }) => m.map);
  });
  return errors;
}

async function withinViewport(page: Page, screen: string, selectors: string) {
  expect(await page.evaluate(({ screen, selectors }) => {
    const root = document.querySelector<HTMLElement>(screen)!;
    const width = innerWidth;
    return [...root.querySelectorAll<HTMLElement>(selectors)].filter((el) => el.checkVisibility()).flatMap((el) => {
      const rect = el.getBoundingClientRect();
      // Vertically scrollable screens may overflow; their controls must remain reachable via the scroller.
      const scroller = root !== document.querySelector('#app') && ['scroll', 'auto'].includes(getComputedStyle(root).overflowY);
      const bottom = scroller ? root.getBoundingClientRect().top + root.scrollHeight - root.scrollTop : innerHeight;
      return rect.left < -1 || rect.right > width + 1 || rect.bottom > bottom + 1 || (!scroller && rect.top < -1)
        || (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === 'visible') ? [el.id || el.className] : [];
    });
  }, { screen, selectors })).toEqual([]);
}

test('Sector 01 uses real collider hits and bounded renderer counters', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await setup(page);
  await page.locator('#screen-menu [data-action="practice"]').tap();
  await screenIs(page, 'playing');
  const render = (mode: 'spawn' | 'landmark' | 'impact' | 'metrics') => page.evaluate(({ mode, I, INPUT_LEN, EVT }) => {
    const { engine, renderer, rafId } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer; rafId: number };
    cancelAnimationFrame(rafId);
    const { state } = engine;
    const pose = mode === 'landmark' ? [10.54, -9.8, -0.27, 0.155] : null;
    const view = new Proxy(state, {
      get(target, field) {
        if (pose && field === 'px') return pose[0];
        if (pose && field === 'pz') return pose[1];
        if (pose && field === 'yaw') return pose[2];
        if (pose && field === 'pitch') return pose[3];
        const value = Reflect.get(target, field);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const draw = (dt: number, events: WorldEvent[] = []) => {
      Reflect.get(renderer, 'interp').reset();
      renderer.renderGame(view, 1, dt, events, mode === 'spawn' || mode === 'metrics' ? 1 : -1);
      return [renderer.calls, renderer.triangles];
    };
    if (mode === 'spawn' || mode === 'landmark') {
      if (mode === 'landmark') Reflect.get(window.__BREACH__!, 'objectiveMarker').hide();
      draw(0.016);
      return { marks: 0, metrics: [] };
    }
    if (mode === 'impact') {
      const input = new Float32Array(INPUT_LEN), events: WorldEvent[] = [];
      input[I.moveX] = 1;
      for (let i = 0; i < 58 && state.px < 4; i += 1) engine.tick(input);
      input.fill(0);
      for (let i = 0; i < 10; i += 1) engine.tick(input);
      state.readEvents(0, events);
      let seq = events.at(-1)?.seq ?? 0;
      let marks = 0;
      for (const [x, y] of [[3.54, 0.29], [3.94, 0.45], [4.42, 0.34]]) {
        const dx = x - state.px, dz = state.pz - 11.3;
        const yaw = -Math.atan2(dx, dz), pitch = Math.atan2(y - state.py - 1.62, Math.hypot(dx, dz));
        for (let i = 0; i < 22; i += 1) {
          input[I.lookDx] = state.yaw - yaw;
          input[I.lookDy] = state.pitch - pitch;
          engine.tick(input);
        }
        input.fill(0);
        input[I.firePressed] = input[I.fireHeld] = 1;
        engine.tick(input);
        input.fill(0);
        state.readEvents(seq, events);
        seq = events.at(-1)?.seq ?? seq;
        marks += events.filter((ev) => ev.type === EVT.wallHit).length;
        draw(0.083, events);
      }
      draw(0.083);
      draw(0.038);
      if (Reflect.get(Reflect.get(renderer, 'feedback'), 'impactCursor') < 2) throw new Error('fewer than two marks rendered');
      Reflect.get(window.__BREACH__!, 'hud').update(state, true);
      return { marks, metrics: [] };
    }
    const metrics = (['high', 'medium', 'low'] as const).map((preset) => {
      renderer.setQuality(preset, 1);
      const cold = draw(0);
      const live = draw(0);
      return { preset, cold, live };
    });
    return { marks: 0, metrics };
  }, { mode, I, INPUT_LEN, EVT });
  await render('spawn');
  await shot(page, 'spawn');
  const background = await scoreBackground(page);
  if (nitCapture) console.log(`Score background (linear sRGB relative luminance): ${JSON.stringify(background)}`);
  expect(background.peak).toBeLessThan(0.008);
  await render('landmark');
  await shot(page, 'landmark');
  expect((await render('impact')).marks).toBe(3);
  await shot(page, 'impact');
  const { metrics } = await render('metrics');
  if (capture || nitCapture) console.log(`Premium counters: ${JSON.stringify(metrics)}; console/page errors: ${errors.length}`);
  for (const { preset, cold, live } of metrics) {
    const budget = { high: 60, medium: 30, low: 20 }[preset];
    expect(cold[0], `${preset} first frame`).toBeLessThanOrEqual(budget);
    expect(live[0], `${preset} live frame`).toBeLessThanOrEqual(budget);
    if (preset === 'high') expect(cold[1]).toBeLessThanOrEqual(120_000);
  }
  expect(errors).toEqual([]);
});

for (const [width, height] of [[1280, 720], [1024, 768], [390, 844], [320, 640]]) {
  test(`${width}×${height}: mission screens and HUD fit`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = await setup(page);
    if (width === 1280) await shot(page, 'menu');
    await withinViewport(page, '#screen-menu', 'button, .menu__wordmark');
    await page.locator('#screen-menu [data-action="mission"]').tap();
    await screenIs(page, 'sectors');
    await page.locator('[data-sector-card="0"] [data-action="brief"]').tap();
    await screenIs(page, 'briefing');
    await withinViewport(page, '#screen-briefing', 'h2, button, .panel');
    await page.locator('[data-action="start-mission"]').tap();
    await screenIs(page, 'playing');
    await withinViewport(page, '#app', '#hud-hp, #hud-ammo, #hud-time, #hud-score, .hud__minimap, #touch-layer button');
    if (width === 390) await shot(page, 'mobile');
    if (width === 320) await shot(page, '320');
    await checkBuffClearance(page);
    await page.locator('#touch-layer [data-touch="pause"]').tap();
    await screenIs(page, 'pause');
    for (const pane of ['game', 'controls', 'graphics', 'audio', 'access']) {
      await page.locator(`[data-tab="${pane}"]`).tap();
      await expect(page.locator(`[data-pane="${pane}"] h3`)).toBeVisible();
      await withinViewport(page, '#screen-pause', '.tab, h3, .pane button, .field');
    }
    await page.locator('[data-tab="game"]').tap();
    await page.locator('#screen-pause [data-action="resume"]').tap();
    await screenIs(page, 'playing');
    await page.evaluate(() => Reflect.get(window.__BREACH__!, 'finish').call(window.__BREACH__, true));
    await screenIs(page, 'result');
    await expect(page.getByRole('heading', { name: 'Registro de partida' })).toBeVisible();
    await withinViewport(page, '#screen-result', 'h2, h3, dd, button');
    if (width === 1280 && capture) {
      await page.waitForTimeout(250);
      await shot(page, 'results');
    }
    if (capture || nitCapture) console.log(`${width}×${height} console/page errors: ${errors.length}`);
    expect(errors).toEqual([]);
  });
}
