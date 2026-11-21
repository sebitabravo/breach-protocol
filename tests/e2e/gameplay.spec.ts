import { expect, test, type Page } from '@playwright/test';
import { FIXED_DT } from '../../src/core/loop';
import { EVT, I, INPUT_LEN } from '../../src/wasm/protocol';
import type { Engine } from '../../src/wasm/bridge';
import type { Renderer } from '../../src/render/renderer';
import { SHOT_DIR, mockApi, openCalibration, screenIs, seedStorage, visibleBox } from './support';

async function startTutorial(page: Page): Promise<void> {
  await seedStorage(page, { tutorialSeen: false });
  await page.goto('/');
  await openCalibration(page);
  await page.locator('#screen-calibrate [data-action="play"]').tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#tutorial')).toBeVisible();
}

async function expectTutorialHandoff(page: Page, outcome: 'completed' | 'skipped') {
  await screenIs(page, 'tutorial-handoff');
  const screen = page.getByRole('region', { name: outcome === 'completed' ? 'TUTORIAL COMPLETADO' : 'TUTORIAL OMITIDO' });
  await expect(screen).toBeVisible();
  await expect(screen.getByText('SIMULADOR', { exact: true })).toBeVisible();
  await expect(page.locator('#tutorial')).toBeHidden();
  await expect(page.locator('#hud')).toBeHidden();
  await expect(page.locator('.tbtn--fire')).toBeHidden();
  await expect(screen.getByRole('button')).toHaveText(['Empezar el protocolo', 'Seguir practicando', 'Volver al menú']);
  await expect(screen.getByRole('button', { name: 'Empezar el protocolo' })).toBeFocused();
  if (outcome === 'completed') {
    await expect(screen.getByRole('listitem')).toHaveText(['✓ Moverte', '✓ Apuntar y disparar', '✓ Activar un terminal']);
    await expect(screen.locator('time')).toHaveText(/^\d{2}:\d{2}$/);
  } else {
    await expect(screen.getByRole('list')).toHaveCount(0);
    await expect(screen.locator('time')).toBeHidden();
  }
  return screen;
}

function trackBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectSheetFits(page: Page, width: number, height: number): Promise<void> {
  for (const selector of ['#screen-tutorial-handoff .sheet', ...['tutorial-start', 'tutorial-practice', 'menu'].map(
    (action) => `#screen-tutorial-handoff [data-action="${action}"]`,
  )]) {
    const box = (await visibleBox(page, selector))!;
    expect(box.x, selector).toBeGreaterThanOrEqual(0);
    expect(box.y, selector).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w, selector).toBeLessThanOrEqual(width);
    expect(box.y + box.h, selector).toBeLessThanOrEqual(height);
  }
}

for (const method of ['Backspace', 'button'] as const) {
  test(`${method} skips to the hand-off with no recap`, async ({ page }) => {
    await startTutorial(page);
    if (method === 'Backspace') {
      await page.keyboard.press('Enter');
      await expect(page.locator('#tut-index')).toHaveText('2');
      await page.keyboard.press('Backspace');
      await expect(page.locator('#toast')).toContainText('Retroceso otra vez');
      await expect(page.locator('#tutorial')).toBeVisible();
      await page.keyboard.press('Backspace');
    } else await page.getByRole('button', { name: 'Omitir tutorial' }).tap();
    const handoff = await expectTutorialHandoff(page, 'skipped');
    if (method === 'Backspace') await page.keyboard.press('Escape');
    else await handoff.getByRole('button', { name: 'Volver al menú' }).tap();
    await screenIs(page, 'menu');
    await page.reload();
    await screenIs(page, 'menu');
    await page.locator('#screen-menu [data-action="practice"]').tap();
    await screenIs(page, 'playing');
    await expect(page.locator('#tutorial')).toBeHidden();
  });
}

test('continue returns focus to the canvas and KeyW moves the simulated player', async ({ page }) => {
  await startTutorial(page);
  await page.keyboard.press('Escape');
  await screenIs(page, 'pause');
  await page.locator('#screen-pause [data-action="resume"]').tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#gl')).toBeFocused();
  const skip = page.locator('[data-action="tutorial-skip"]');
  await skip.focus();
  await expect(skip).toBeFocused();
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockerror')));
  await expect(page.locator('#gl')).toBeFocused();
  const startZ = await page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.pz);
  await page.keyboard.down('KeyW');
  try {
    await expect.poll(() => page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.pz)).toBeLessThan(startZ - 0.5);
  } finally {
    await page.keyboard.up('KeyW');
  }
});

test.describe('portrait review captures', () => {
  test.use({ isMobile: true, viewport: { width: 320, height: 640 } });

  test('320×640 tutorial steps and completion fit; practice resumes only by choice', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    await startTutorial(page);
    for (const step of ['1', '2', '3']) {
      await expect(page.locator('#tut-index')).toHaveText(step);
      const panel = (await visibleBox(page, '#tutorial'))!;
      expect(panel.y).toBeGreaterThanOrEqual(0);
      expect(panel.y + panel.h).toBeLessThanOrEqual(640);
      const overlaps: string[] = [];
      for (const selector of ['.hud__block--sector', '.hud__block--right', '.hud__minimap', '.hud__objective-track', '.hud__feed', '.crosshair', '.ammo', '.vitals', '.touch__stick', ...['pause', 'ads', 'jump', 'fire', 'interact', 'reload', 'switch'].map((name) => `.tbtn--${name}`)]) {
        const box = await visibleBox(page, selector);
        if (box && panel.x < box.x + box.w && box.x < panel.x + panel.w && panel.y < box.y + box.h && box.y < panel.y + panel.h) overlaps.push(selector);
      }
      expect(overlaps, `tutorial step ${step}`).toEqual([]);
      if (step === '2') await page.screenshot({ path: `${SHOT_DIR}/review-320x640-tutorial.png` });
      await page.keyboard.press('Enter');
    }
    await expectTutorialHandoff(page, 'completed');
    await expectSheetFits(page, 320, 640);
    if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/tut-complete-320.png', animations: 'disabled' });
    const tick = () => page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.tick);
    const pausedAt = await tick();
    const practice = page.getByRole('button', { name: 'Seguir practicando' });
    await page.keyboard.press('Tab');
    await expect(practice).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Volver al menú' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(practice).toBeFocused();
    expect(await tick()).toBe(pausedAt);
    await page.keyboard.press('Enter');
    await screenIs(page, 'playing');
    await expect(page.locator('#gl')).toBeFocused();
    await expect(page.locator('#hud-sector-code')).toHaveText('SIMULADOR');
    await expect(page.locator('#tutorial')).toBeHidden();
    await expect.poll(tick).toBeGreaterThan(pausedAt);
    console.log(`320×640 tutorial: ${errors.length} console/page errors`);
    expect(errors).toEqual([]);
  });
});

test.describe('390×844 completion hand-off', () => {
  test.use({ isMobile: true, viewport: { width: 390, height: 844 } });

  test('reduced motion, menu, and explicit replay', async ({ page }) => {
    const errors = trackBrowserErrors(page);
    await startTutorial(page);
    // Set the app setting, not just the OS preference, before completing the tutorial.
    await page.keyboard.press('Escape');
    await page.locator('#screen-pause [data-tab="graphics"]').tap();
    await page.locator('#set-motion').check();
    await page.keyboard.press('Escape');
    await screenIs(page, 'playing');
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Enter');
    const screen = await expectTutorialHandoff(page, 'completed');
    await expectSheetFits(page, 390, 844);
    await expect(screen.locator('.sheet')).toHaveCSS('animation-name', 'none');
    await screen.getByRole('button', { name: 'Volver al menú' }).tap();
    await screenIs(page, 'menu');
    await page.reload();
    await screenIs(page, 'menu');
    await page.locator('#screen-menu').getByRole('button', { name: /Repetir tutorial/ }).tap();
    await screenIs(page, 'playing');
    await expect(page.locator('#tut-index')).toHaveText('1');
    await expect(screen).toBeHidden();
    console.log(`390×844 tutorial: ${errors.length} console/page errors`);
    expect(errors).toEqual([]);
  });
});

test('real terminal completes tutorial into campaign hand-off; a wall hit emits rendered sparks', async ({ page }) => {
  const errors = trackBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await startTutorial(page);
  await page.keyboard.down('KeyS');
  try {
    await expect(page.locator('#tut-index')).toHaveText('2');
  } finally {
    await page.keyboard.up('KeyS');
  }
  // At the south wall, face away from the center pillar. Feed real WASM look input
  // (not a synthetic wall event) before tapping the real touch fire button.
  await page.evaluate(({ I, INPUT_LEN }) => {
    const { engine } = window.__BREACH__ as unknown as { engine: Engine };
    const input = new Float32Array(INPUT_LEN);
    for (let i = 0; i < 8; i += 1) {
      input[I.lookDx] = Math.PI / 8;
      engine.tick(input);
    }
    for (let i = 0; i < 60; i += 1) engine.tick(new Float32Array(INPUT_LEN));
  }, { I, INPUT_LEN });
  await page.locator('[data-touch="fire"]').tap();
  // Verify both a real wall-hit coordinate and the Three.js particle batch the renderer made.
  await page.waitForFunction(({ wallHit }) => {
    const { engine, renderer } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer };
    const events: Parameters<Engine['state']['readEvents']>[1] = [];
    engine.state.readEvents(0, events);
    const wall = events.find((event) => event.type === wallHit && Math.abs(event.c - 17) < 0.01);
    const fx = Reflect.get(renderer, 'fx');
    return !!wall && fx.sparks.visible && fx.sparkLife.some((life: number, index: number) =>
      life > 0 && Math.abs(fx.sparkPos[index * 3 + 2] - wall.c) < 0.6);
  }, { wallHit: EVT.wallHit }, { timeout: 3000 });
  await expect(page.locator('#tut-title')).toHaveText('Activar terminal');
  // Route around the cover: from the south wall use x=11.8, then the east terminal.
  await page.evaluate(({ I, INPUT_LEN }) => {
    const { engine } = window.__BREACH__ as unknown as { engine: Engine };
    const input = new Float32Array(INPUT_LEN);
    input[I.moveX] = -1;
    for (let i = 0; i < 160 && engine.state.px < 11.8; i += 1) engine.tick(input);
    input.fill(0);
    input[I.moveZ] = -1;
    for (let i = 0; i < 250 && engine.state.pz > 1.3; i += 1) engine.tick(input);
  }, { I, INPUT_LEN });
  await expect(page.locator('[data-objective-name]')).toHaveText('Terminal 02');
  await expect(page.locator('[data-objective-hold]')).toBeVisible();
  const interact = (await page.locator('[data-touch="interact"]').boundingBox())!;
  const touch = await page.context().newCDPSession(page);
  const hold = () => touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: interact.x + interact.width / 2, y: interact.y + interact.height / 2 }],
  });
  const release = () => touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await hold();
  try {
    await expect(page.locator('#crosshair')).toHaveClass(/is-channeling/);
  } finally {
    await release();
  }
  await expect(page.locator('#crosshair')).not.toHaveClass(/is-channeling/);
  await expect(page.locator('#tut-index')).toHaveText('3');
  await hold();
  try {
    await expect(page.locator('#hud-nodes .node').nth(1)).toHaveClass(/is-active/);
  } finally {
    await release();
  }
  const handoff = await expectTutorialHandoff(page, 'completed');
  const ticks = await page.evaluate(() => (window.__BREACH__ as unknown as { engine: Engine }).engine.state.tick);
  const elapsed = Math.floor(ticks * FIXED_DT);
  expect(elapsed).toBeGreaterThan(0);
  await expect(handoff.locator('time')).toHaveAttribute('datetime', `PT${elapsed}S`);
  const [minutes, seconds] = (await handoff.locator('time').innerText()).split(':').map(Number);
  expect(minutes * 60 + seconds).toBe(elapsed);
  await expectSheetFits(page, 1280, 720);
  if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/tut-complete.png', animations: 'disabled' });
  await handoff.getByRole('button', { name: 'Empezar el protocolo' }).tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#hud-sector-code')).toHaveText('SECTOR 01');
  await expect(page.locator('#hud-mode')).toHaveText('misión');
  await expect(page.locator('#tutorial')).toBeHidden();
  await expect(page.locator('#hud-nodes .node').nth(1)).not.toHaveClass(/is-active/);
  console.log(`1280×720 tutorial: ${errors.length} console/page errors`);
  expect(errors).toEqual([]);
});

test('real enemy damage shows its bearing for at least 500 ms of simulation', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await startOverflow(page, false, 530239482); // Practice enemies do not deal damage.
  const hit = await page.evaluate(({ inputLen, damage, minTick }) => {
    const app = window.__BREACH__!;
    const { engine } = app as unknown as { engine: Engine };
    // Drive real WASM ticks and GameApp frames independently. This prevents a
    // subsequent hit or an arbitrarily timed RAF from replacing the tested hit.
    cancelAnimationFrame(Reflect.get(app, 'rafId'));
    const neutral = new Float32Array(inputLen);
    const events: Parameters<Engine['state']['readEvents']>[1] = [];
    // Los enemigos patrullan 20 s antes de salir a buscar al jugador (A-13): el primer daño llega más tarde.
    for (let i = 0; i < 4000; i += 1) {
      const previousHp = engine.state.hp;
      engine.tick(neutral);
      const { hp, px, pz, yaw, tick } = engine.state;
      if (hp >= previousHp || tick < minTick) continue;
      engine.state.readEvents(0, events);
      const event = events.findLast((e) => e.type === damage && e.a >= 1);
      if (event) {
        const expected = (Math.atan2(event.b - px, pz - event.d) + yaw) * 180 / Math.PI;
        return { expected, tick, hp };
      }
    }
    return null;
  // Con la IA v5 los golpes llegan de a pares (ticks 966/987, 1059/1080, 1152...): el de 1080 es el primero
  // seguido de más de 54 ticks sin daño, que es lo que esta prueba necesita para medir cuánto dura la flecha.
  }, { inputLen: INPUT_LEN, damage: EVT.playerDamaged, minTick: 1070 });
  expect(hit).not.toBeNull();
  const frame = (ticks: number) => page.evaluate(({ ticks, inputLen }) => {
    const app = window.__BREACH__!;
    const { engine } = app as unknown as { engine: Engine };
    const neutral = new Float32Array(inputLen);
    for (let i = 0; i < ticks; i += 1) engine.tick(neutral);
    // A paint that advances no simulation steps, even after a wall-clock wait.
    Reflect.get(app, 'loop').reset();
    const now = performance.now();
    Reflect.set(app, 'lastNow', now);
    Reflect.get(app, 'frame')(now);
    cancelAnimationFrame(Reflect.get(app, 'rafId'));
    return { tick: engine.state.tick, hp: engine.state.hp };
  }, { ticks, inputLen: INPUT_LEN });
  const arrow = page.locator('#hud-dmgdir span');
  const checkBearing = async () => {
    await expect(arrow).toBeVisible();
    const degrees = await arrow.evaluate((el) => parseFloat((el as HTMLElement).style.transform.replace('rotate(', '')));
    const error = ((degrees - hit!.expected + 540) % 360) - 180;
    expect(error).toBeCloseTo(0, 0); // Same sub-degree tolerance, modulo a full turn.
  };

  expect(await frame(0)).toEqual({ tick: hit!.tick, hp: hit!.hp });
  await checkBearing();
  if (process.env.ART_CAPTURE === '1') await page.screenshot({ path: '/tmp/wpn-damage.png' });
  await page.waitForTimeout(1000); // The old 900 ms wall timer wrongly expired while paused at this tick.
  expect(await frame(0)).toEqual({ tick: hit!.tick, hp: hit!.hp });
  await checkBearing();
  expect(await frame(30)).toEqual({ tick: hit!.tick + 30, hp: hit!.hp });
  await checkBearing();
  expect(await frame(24)).toEqual({ tick: hit!.tick + 54, hp: hit!.hp });
  await expect(arrow).toBeHidden();
});

async function startOverflow(page: Page, shotgun: boolean, seed?: number): Promise<void> {
  await seedStorage(page, {
    tutorialSeen: true,
    progress: shotgun ? { tutorialSeen: true, sectors: [{ wins: 1 }, { wins: 1 }] } : undefined,
  });
  await page.goto('/');
  await screenIs(page, 'menu');
  if (seed !== undefined) {
    await page.evaluate((seed) => {
      const { engine } = window.__BREACH__ as unknown as { engine: Engine };
      const start = engine.start.bind(engine);
      engine.start = (options) => start({ ...options, seed });
    }, seed);
  }
  await page.locator('#screen-menu [data-action="overflow"]').tap();
  await screenIs(page, 'playing');
}

test('SG-08-enabled replays never offer or send a submission, even without equipping it', async ({ page }) => {
  let posts = 0;
  await mockApi(page, { post: async (route) => { posts += 1; await route.fulfill({ status: 500 }); } });
  await startOverflow(page, true);
  await expect(page.locator('#hud-weapon')).toHaveText('PB-01');
  expect(await page.evaluate(() => window.__BREACH__!.debugRunToEnd())).toBe(true);
  await screenIs(page, 'result');
  await expect(page.locator('#board-text')).toHaveText('Las partidas con SG-08 no entran al tablero: el desbloqueo no se puede verificar.');
  await expect(page.locator('#board-send')).toBeHidden();
  await page.locator('#board-send').dispatchEvent('click');
  await expect(page.locator('#result-board')).toHaveAttribute('data-state', 'ineligible');
  expect(posts).toBe(0);
});

test('a truncated Overflow result explains the 20-minute prefix and can still be sent', async ({ page }) => {
  await startOverflow(page, false);
  // Fixture supplies the recorder flag only. Result and board gating still run through GameApp.
  expect(await page.evaluate(() => {
    const { engine } = window.__BREACH__ as unknown as { engine: Engine };
    Object.defineProperty(engine, 'logTruncated', { configurable: true, get: () => true });
    return window.__BREACH__!.debugRunToEnd();
  })).toBe(true);
  await screenIs(page, 'result');
  await expect(page.locator('#result-prefix')).toHaveText('Registro recortado: cuenta el prefijo de 20 min.');
  await expect(page.locator('#board-send')).toBeVisible();
});
