import { expect, test, type Page } from '@playwright/test';
import type * as THREE from 'three';
import type { Renderer } from '../../src/render/renderer';
import type { Engine, WorldEvent } from '../../src/wasm/bridge';
import { EVT, I, INPUT_LEN, WEAPON } from '../../src/wasm/protocol';
import { screenIs } from './support';

const captures = process.env.ART_CAPTURE === '1';

async function setup(page: Page, quality: 'high' | 'medium', fallback = false): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    // Headless Chromium emits this driver diagnostic during screenshots/GL readbacks.
    if (['error', 'warning'].includes(message.type()) && !message.text().includes('GPU stall due to ReadPixels')) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((preset) => {
    localStorage.setItem('bp.settings', JSON.stringify({ version: 2, quality: preset, tutorialSeen: true, reduceMotion: true }));
  }, quality);
  const modelRequests: string[] = [];
  page.on('request', (request) => { if (request.url().endsWith('.glb')) modelRequests.push(request.url()); });
  await page.goto(fallback ? '/?viewmodel=kenney' : '/');
  await screenIs(page, 'menu');
  await page.waitForFunction(({ ids, fallback }) => {
    const r = Reflect.get(window.__BREACH__!, 'renderer') as Renderer;
    return Reflect.get(r, 'scene').environment && Reflect.get(r, 'surfaces').materials.slice(0, 3).every((m: { map: unknown }) => m.map)
      && ids.every((id) => {
        const view = Reflect.get(Reflect.get(r, 'viewmodel'), 'views').get(id);
        return view?.modelPose && (fallback ? view.root.children[0]?.name.startsWith('blaster') : !!view.authored);
      });
  }, { ids: Object.values(WEAPON), fallback });
  expect(modelRequests).toHaveLength(fallback ? 2 : 0);
  // Let the orbit redraw with all the textures before capture.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return errors;
}

async function practice(page: Page): Promise<void> {
  await page.locator('#screen-menu [data-action="practice"]').tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#hud-sector-code')).toHaveText('SIMULADOR');
  await expect(page.locator('#hud-mode')).toBeHidden();
}

async function frameBounds(page: Page, width: number, height: number): Promise<void> {
  const frames = await page.evaluate(({ width, height, ids }) => {
    const { engine, renderer, rafId } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer; rafId: number };
    cancelAnimationFrame(rafId);
    const camera = Reflect.get(renderer, 'viewCamera') as THREE.PerspectiveCamera;
    const viewmodel = Reflect.get(renderer, 'viewmodel');
    const views = Reflect.get(viewmodel, 'views') as Map<number, { root: THREE.Group; points: THREE.Vector3[]; muzzle: THREE.Object3D }>;
    // A real canvas can be resized without reloading the streamed assets.
    renderer.resize();
    renderer.renderGame(engine.state, 1, 1 / 12, []);
    const result = ids.map((weapon) => {
      const view = views.get(weapon)!;
      viewmodel.update({ weapon, ads: 0, recoilPitch: 0.06, reloading: false }, 0.1, 0);
      const point = view.root.position.clone();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const vertex of view.points) {
        point.copy(vertex).applyMatrix4(view.root.matrixWorld).project(camera);
        const x = (point.x * 0.5 + 0.5) * width, y = (0.5 - point.y * 0.5) * height;
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
      }
      const start = point.set(0, 0, 0).applyMatrix4(view.muzzle.matrixWorld).project(camera).clone();
      const end = point.set(0, 0, -0.5).applyMatrix4(view.muzzle.matrixWorld).project(camera);
      return { l, t, r, b, span: (r - l) / width, boreInward: end.x < start.x && end.y > start.y };
    });
    renderer.renderGame(engine.state, 1, 0, []);
    return result;
  }, { width, height, ids: Object.values(WEAPON) });
  if (captures) console.log(`ART framing ${width}×${height}:`, JSON.stringify(frames));
  for (const frame of frames) {
    expect(frame.l).toBeGreaterThan(width * 0.50);
    expect(frame.t).toBeGreaterThan(height * 0.50);
    expect(frame.r).toBeLessThan(width * 0.95);
    expect(frame.b).toBeLessThan(height * 0.95);
    expect(frame.span).toBeGreaterThanOrEqual(0.20);
    expect(frame.span).toBeLessThanOrEqual(0.25);
    expect(frame.boreInward).toBe(true);
  }
}

async function wallPose(page: Page, ads: boolean) {
  return page.evaluate(({ I, INPUT_LEN, WEAPON, ads }) => {
    const app = window.__BREACH__!;
    const { engine, renderer, rafId } = app as unknown as { engine: Engine; renderer: Renderer; rafId: number };
    cancelAnimationFrame(rafId);
    const input = new Float32Array(INPUT_LEN);
    input[I.switch] = WEAPON.carbine;
    input[I.moveZ] = 1; // Straight from spawn into the near face of the central pillar (z = 2).
    input[I.ads] = Number(ads);
    const walk = (ticks: number) => {
      for (let i = 0; i < ticks; i++) {
        engine.tick(input);
        input[I.switch] = 0;
      }
    };
    if (!ads) walk(165);
    const before = engine.state.pz;
    if (!ads) walk(15);
    for (let i = 0; i < 12; i++) {
      if (ads) walk(5);
      renderer.renderGame(engine.state, 1, 1 / 12, []);
    }
    Reflect.get(app, 'hud').update(engine.state, true);
    return { gap: engine.state.pz - 2, travel: engine.state.pz - before, ads: engine.state.ads, weapon: engine.state.weapon };
  }, { I, INPUT_LEN, WEAPON, ads });
}

async function probeWeapon(page: Page) {
  return page.evaluate(() => {
    // Resolve Three from the live scene rather than importing a second library into dist/.
    const { engine, renderer } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer };
    const r = Reflect.get(renderer, 'renderer') as THREE.WebGLRenderer;
    const scene = Reflect.get(renderer, 'viewScene') as THREE.Scene;
    const camera = Reflect.get(renderer, 'viewCamera') as THREE.PerspectiveCamera;
    const view = Reflect.get(Reflect.get(renderer, 'viewmodel'), 'views').get(engine.state.weapon) as {
      root: THREE.Group; points: THREE.Vector3[];
    };
    const tag = ((view.root.getObjectByName('dot') as THREE.Mesh).material as THREE.MeshBasicMaterial).clone();
    tag.color.setHex(0xff00ff);
    tag.fog = false;
    tag.toneMapped = false;
    const restore: [THREE.Mesh, THREE.Material | THREE.Material[]][] = [];
    view.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      restore.push([mesh, mesh.material]);
      mesh.material = tag;
    });
    const read = () => {
      const gl = r.getContext();
      const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const draw = () => Reflect.get(renderer, 'draw').call(renderer, r);
    const previousQuality = renderer.preset.name;
    const counts = [];
    try {
      for (const quality of ['low', 'high'] as const) {
        renderer.setQuality(quality);
        draw();
        const composed = read();
        let occluded: Uint8Array | null = null;
        if (quality === 'low') {
          // Negative control: same pose, lens and world; only omit the depth reset.
          const clearDepth = r.clearDepth;
          r.clearDepth = () => {};
          try { draw(); occluded = read(); } finally { r.clearDepth = clearDepth; }
        }
        const siblings = scene.children.filter((object) => object !== camera && object.visible);
        for (const sibling of siblings) sibling.visible = false;
        r.setRenderTarget(null);
        r.clear();
        r.render(scene, camera);
        const isolated = read();
        for (const sibling of siblings) sibling.visible = true;
        // Test the whole rasterized reference silhouette (holes stay holes), not a bounding box.
        const tagged = (pixels: Uint8Array, i: number) => pixels[i] > 150 && pixels[i + 2] > 150 && pixels[i + 1] < 130;
        let silhouette = 0, missing = 0, withoutDepthClear = 0;
        for (let i = 0; i < isolated.length; i += 4) {
          if (!tagged(isolated, i)) continue;
          silhouette++;
          if (!tagged(composed, i)) missing++;
          if (occluded && !tagged(occluded, i)) withoutDepthClear++;
        }
        counts.push({ quality, silhouette, missing, withoutDepthClear });
      }
    } finally {
      for (const [mesh, material] of restore) mesh.material = material;
      tag.dispose();
      renderer.setQuality(previousQuality);
      draw();
    }
    const p = view.root.position.clone();
    let nearest = Infinity, largestNdc = 0;
    for (const point of view.points) {
      p.copy(point).applyMatrix4(view.root.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      nearest = Math.min(nearest, -p.z);
      p.applyMatrix4(camera.projectionMatrix);
      largestNdc = Math.max(largestNdc, Math.abs(p.x), Math.abs(p.y));
    }
    return { counts, near: camera.near, nearest, largestNdc };
  });
}

async function captureCloseups(page: Page): Promise<void> {
  const overlay = await page.addStyleTag({ content: '#app > :not(canvas) { opacity: 0 !important; }' });
  for (const [name, id] of Object.entries({ sidearm: WEAPON.sidearm, rifle: WEAPON.carbine, scatter: WEAPON.shotgun })) {
    const setMonochrome = (enabled: boolean) => page.locator('#gl').evaluate((element, enabled) => {
      element.style.filter = enabled ? 'grayscale(1)' : '';
      // The frozen WebGL scene does not present another frame on its own.
      return new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, enabled);
    await page.evaluate((id) => {
      const { engine, renderer } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer };
      renderer.renderGame(engine.state, 1, 0, []);
      const camera = Reflect.get(renderer, 'viewCamera') as THREE.PerspectiveCamera;
      const vm = Reflect.get(renderer, 'viewmodel');
      vm.update({ weapon: id, ads: 0, recoilPitch: 0, reloading: false }, 0, 0);
      const view = Reflect.get(vm, 'views').get(id) as { root: THREE.Group; points: THREE.Vector3[] };
      // Inspection angle, not an in-game pose. Project the same geometry and
      // use a film crop centered on the authored silhouette.
      view.root.position.set(0.09, -0.18, -1.09);
      view.root.rotation.set(0.26, 1.03, -0.12);
      view.root.scale.setScalar(1);
      view.root.updateMatrixWorld(true);
      const point = view.root.position.clone();
      let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (const vertex of view.points) {
        point.copy(vertex).applyMatrix4(view.root.matrixWorld).project(camera);
        const x = (point.x * 0.5 + 0.5) * innerWidth, y = (0.5 - point.y * 0.5) * innerHeight;
        l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x); b = Math.max(b, y);
      }
      const fraction = Math.max((r - l) / (innerWidth * 0.51), (b - t) / (innerHeight * 0.68));
      const w = innerWidth * fraction, h = innerHeight * fraction;
      camera.setViewOffset(innerWidth, innerHeight, (l + r - w) / 2, (t + b - h) / 2, w, h);
      Reflect.get(renderer, 'draw').call(renderer, Reflect.get(renderer, 'renderer'));
    }, id);
    await page.screenshot({ path: `/tmp/hero-${name}.png` });
    await setMonochrome(true);
    await page.screenshot({ path: `/tmp/hero-gray-${name}.png` });
    await setMonochrome(false);
    await page.evaluate(() => {
      const renderer = Reflect.get(window.__BREACH__!, 'renderer') as Renderer;
      (Reflect.get(renderer, 'viewCamera') as THREE.PerspectiveCamera).clearViewOffset();
    });
  }
  await overlay.evaluate((element) => { element.remove(); });
}

test.describe('streamed arena art on desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  test('renders the authored weapons and stays within each draw budget', async ({ page }) => {
    const errors = await setup(page, 'high');
    await practice(page);
    await expect(page.locator('.hud__score')).toBeVisible();
    await frameBounds(page, 1280, 720);
    if (captures) await captureCloseups(page);
    const geometryMetrics = await page.evaluate((ids) => {
      const { engine, renderer } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer };
      const vm = Reflect.get(renderer, 'viewmodel');
      const views = Reflect.get(vm, 'views') as Map<number, { root: THREE.Group }>;
      const draw = () => Reflect.get(renderer, 'draw').call(renderer, Reflect.get(renderer, 'renderer'));
      return (['low', 'medium', 'high'] as const).flatMap((preset) => {
        renderer.setQuality(preset);
        renderer.renderGame(engine.state, 1, 0, []);
        return ids.map((weapon) => {
          vm.update({ weapon, ads: 0, recoilPitch: 0, reloading: false }, 0, 0);
          const { root } = views.get(weapon)!;
          root.visible = false;
          draw();
          const callsWithout = renderer.calls, trianglesWithout = renderer.triangles;
          const worldCalls = renderer.worldCalls, worldTriangles = renderer.worldTriangles;
          root.visible = true;
          draw();
          return { preset, weapon, calls: renderer.viewCalls, triangles: renderer.viewTriangles,
            stable: renderer.calls - callsWithout === renderer.viewCalls && renderer.triangles - trianglesWithout === renderer.viewTriangles
              && renderer.worldCalls === worldCalls && renderer.worldTriangles === worldTriangles };
        });
      });
    }, Object.values(WEAPON));
    for (const { calls, triangles, stable } of geometryMetrics) {
      expect(stable).toBe(true);
      expect(calls).toBeGreaterThan(0);
      expect(calls).toBeLessThanOrEqual(8);
      expect(triangles).toBeGreaterThan(0);
    }
    if (captures) console.log('HERO viewmodel-only (draw delta):', JSON.stringify(geometryMetrics));
    const metrics = await page.evaluate(({ I, INPUT_LEN, EVT, WEAPON }) => {
      const app = window.__BREACH__!;
      const { engine, renderer, rafId } = app as unknown as { engine: Engine; renderer: Renderer; rafId: number };
      // Freeze the capture at a real core event instead of racing the short flash.
      cancelAnimationFrame(rafId);
      const input = new Float32Array(INPUT_LEN);
      if (engine.state.weapon !== WEAPON.carbine) {
        input[I.switch] = WEAPON.carbine;
        engine.tick(input);
        input[I.switch] = 0;
        // Switching weapons has a 200 ms fire lockout in the core.
        for (let i = 0; i < 13; ++i) engine.tick(input);
      }
      if (engine.state.weapon !== WEAPON.carbine) throw new Error('Expected carbine to be active');
      input[I.firePressed] = 1;
      input[I.fireHeld] = 1;
      engine.tick(input);
      const events: WorldEvent[] = [];
      engine.state.readEvents(0, events);
      if (!events.some((event) => event.type === EVT.shot)) throw new Error('No shot to capture');
      Reflect.get(app, 'hud').update(engine.state, true);
      const out = [];
      for (const preset of ['low', 'medium', 'high'] as const) {
        renderer.setQuality(preset);
        // Keep the one-off shadow-map rebuild distinct from a combat frame.
        renderer.renderGame(engine.state, 1, 0, []);
        const afterPresetChange = { calls: renderer.calls, triangles: renderer.triangles };
        renderer.renderGame(engine.state, 1, 1 / 60, events);
        const first = { calls: renderer.calls, triangles: renderer.triangles,
          worldCalls: renderer.worldCalls, worldTriangles: renderer.worldTriangles,
          viewCalls: renderer.viewCalls, viewTriangles: renderer.viewTriangles };
        renderer.renderGame(engine.state, 1, 0, []);
        out.push({ preset, ...first, steadyCalls: renderer.calls, steadyTriangles: renderer.triangles, afterPresetChange });
      }
      return out;
    }, { I, INPUT_LEN, EVT, WEAPON });
    if (captures) {
      console.log('ART counters, live shot and one-off preset change:', JSON.stringify(metrics));
      await page.screenshot({ path: '/tmp/hero-play.png' });
      await page.screenshot({ path: '/tmp/vm-play.png' });
      await page.evaluate(({ INPUT_LEN, I }) => {
        const { engine, renderer } = window.__BREACH__ as unknown as { engine: Engine; renderer: Renderer };
        const input = new Float32Array(INPUT_LEN);
        input[I.ads] = 1;
        for (let i = 0; i < 35; i++) {
          engine.tick(input);
          renderer.renderGame(engine.state, 1, 1 / 60, []);
        }
        Reflect.get(window.__BREACH__!, 'hud').update(engine.state, true);
      }, { INPUT_LEN, I });
      await page.screenshot({ path: '/tmp/hero-ads.png' });
    }
    const caps = { low: 12, medium: 22, high: 52 }; // Preserve the world budget, excluding the old 8-draw carbine.
    for (const { preset, calls, triangles, worldCalls, viewCalls, afterPresetChange } of metrics) {
      expect(calls).toBeGreaterThan(0);
      expect(worldCalls).toBeLessThanOrEqual(caps[preset]);
      expect(viewCalls).toBe(9); // 8 for the model, 1 transient foreground flash.
      expect(afterPresetChange.calls).toBeLessThanOrEqual(caps[preset] + 8 + (preset === 'low' ? 1 : 5));
      expect(triangles).toBeGreaterThan(0);
    }
    await page.setViewportSize({ width: 1280, height: 590 });
    await frameBounds(page, 1280, 590);
    if (captures) console.log(`ART desktop browser errors: ${errors.length}`);
    expect(errors).toEqual([]);
  });

  test('keeps the entire weapon silhouette visible when walking flush into the pillar, at hip and in ADS', async ({ page }) => {
    const errors = await setup(page, 'high');
    await practice(page);
    const hip = await wallPose(page, false);
    if (captures) await page.screenshot({ path: '/tmp/vm-wall.png' });
    const hipProbe = await probeWeapon(page);
    const ads = await wallPose(page, true);
    if (captures) await page.screenshot({ path: '/tmp/vm-ads-wall.png' });
    const adsProbe = await probeWeapon(page);
    if (captures) console.log('ART wall:', JSON.stringify({ hip, hipProbe, ads, adsProbe, errors }));
    expect(hip.weapon).toBe(WEAPON.carbine);
    expect(hip.gap).toBeCloseTo(0.35, 1);
    expect(hip.travel).toBeCloseTo(0, 4);
    expect(ads.gap).toBeCloseTo(hip.gap, 4);
    expect(ads.travel).toBeCloseTo(0, 4);
    expect(ads.ads).toBeGreaterThan(0.99);
    for (const probe of [hipProbe, adsProbe]) {
      for (const { quality, silhouette, missing, withoutDepthClear } of probe.counts) {
        expect(silhouette, `${quality} reference weapon pixels`).toBeGreaterThan(500);
        expect(missing, `${quality} pixels occluded by the wall`).toBe(0);
        if (quality === 'low') expect(withoutDepthClear, 'negative control').toBeGreaterThan(silhouette * 0.9);
      }
      expect(probe.nearest).toBeGreaterThan(probe.near + 0.05);
      expect(probe.largestNdc).toBeLessThan(1);
    }
    expect(errors).toEqual([]);
  });

  test('loads both Kenney models only when the authored flag is disabled', async ({ page }) => {
    const errors = await setup(page, 'medium', true);
    await practice(page);
    await frameBounds(page, 1280, 720);
    expect(errors).toEqual([]);
  });
});

test.describe('streamed arena art on mobile', () => {
  test.use({ isMobile: true, viewport: { width: 390, height: 844 } });
  test('keeps the weapon and HUD on the portrait viewport', async ({ page }) => {
    const errors = await setup(page, 'medium');
    await practice(page);
    await expect(page.locator('#hud')).toBeVisible();
    await frameBounds(page, 390, 844);
    if (captures) {
      await page.screenshot({ path: '/tmp/hero-mobile.png' });
      await page.screenshot({ path: '/tmp/vm-mobile.png' });
      console.log(`ART mobile browser errors: ${errors.length}`);
    }
    expect(errors).toEqual([]);
  });
});
