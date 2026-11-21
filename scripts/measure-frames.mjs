// Uso: bun scripts/measure-frames.mjs [--label before] [--presets low,medium,high] [--seconds 20]
//        [--viewport 1600x900] [--dsf 2] [--soak 0] [--headless]
//
// Mide el costo real de un frame por preset con una partida guionada de práctica (semilla fija,
// movimiento y disparo por eventos de teclado y mouse). Pensado para Chromium CON ventana en un equipo
// con GPU: en headless/SwiftShader el tiempo de frame no dice nada de una GPU real.
//
// Requiere `dist/` (bun run build). Escribe test-results/frames-<label>.json y una tabla markdown.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const next = process.argv[index + 1];
  return next === undefined || next.startsWith('--') ? true : next;
}

const label = String(arg('label', 'run'));
const presets = String(arg('presets', 'low,medium,high')).split(',');
const seconds = Number(arg('seconds', 20));
const soakSeconds = Number(arg('soak', 0));
const [width, height] = String(arg('viewport', '1600x900')).split('x').map(Number);
const deviceScaleFactor = Number(arg('dsf', 2));
const headless = arg('headless', false) === true;
const root = resolve('dist');

const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
};
const files = new Map();
for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const path = join(entry.parentPath, entry.name);
  files.set(`/${relative(root, path)}`, { body: await readFile(path), type: types[extname(path)] ?? 'application/octet-stream' });
}
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = files.get(pathname === '/' ? '/index.html' : pathname);
  if (!file) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.body.length }).end(file.body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
const round = (value, digits = 2) => (value === null ? null : Number(value.toFixed(digits)));

/** Memoria estimada del composer de bloom (HalfFloat RGBA = 8 B/px por muestra + profundidad 4 B/px). */
function composerMegabytes(canvasWidth, canvasHeight, samples) {
  if (samples === 0) return 0;
  return round((canvasWidth * canvasHeight * (8 + 4) * samples) / 1024 / 1024, 0);
}

async function runPreset(browser, preset) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor, hasTouch: false,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript((quality) => {
    localStorage.setItem('bp.settings', JSON.stringify({ version: 3, tutorialSeen: true, quality }));
    // Semilla fija: startMatch toma la semilla de Math.random para las partidas que no son el diario.
    let state = 0x9e3779b9;
    Math.random = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, preset);
  await page.goto(url);
  await page.waitForFunction(() => window.__BREACH__?.currentScreen === 'menu', null, { timeout: 60_000 });
  await page.locator('#screen-menu [data-action="practice"]').click();
  await page.waitForFunction(() => window.__BREACH__?.currentScreen === 'playing', null, { timeout: 30_000 });

  // Envuelve renderGame para medir el tiempo de CPU que tarda en enviar el frame a la GPU.
  await page.evaluate(() => {
    const game = window.__BREACH__;
    const renderer = game.renderer;
    const original = renderer.renderGame.bind(renderer);
    window.__bench = { cpu: [], deltas: [], last: 0, running: false };
    renderer.renderGame = (...args) => {
      const start = performance.now();
      original(...args);
      if (window.__bench.running) window.__bench.cpu.push(performance.now() - start);
    };
    const tick = (now) => {
      if (window.__bench.running && window.__bench.last) window.__bench.deltas.push(now - window.__bench.last);
      window.__bench.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  // Guion: zigzag con W + A/D alternados y fuego sostenido con el botón izquierdo.
  await page.mouse.move(width / 2, height / 2);
  await page.mouse.down();
  await page.keyboard.down('KeyW');
  const scenario = (async () => {
    for (let t = 0; t < 1e9; t += 1) {
      const key = t % 2 === 0 ? 'KeyA' : 'KeyD';
      await page.keyboard.down(key);
      await page.waitForTimeout(700);
      await page.keyboard.up(key);
    }
  })().catch(() => {});

  await page.waitForTimeout(3000); // calentamiento: shaders, texturas, primer spawn
  await page.evaluate(() => { window.__bench.running = true; window.__bench.cpu.length = 0; window.__bench.deltas.length = 0; });
  await page.waitForTimeout(seconds * 1000);
  const sample = await page.evaluate(() => {
    window.__bench.running = false;
    const game = window.__BREACH__;
    const gl = game.renderer.renderer;
    const canvas = document.getElementById('gl');
    return {
      cpu: window.__bench.cpu.slice(), deltas: window.__bench.deltas.slice(),
      calls: game.renderer.calls, triangles: game.renderer.triangles,
      memory: { ...gl.info.memory }, programs: gl.info.programs?.length ?? 0,
      canvas: { width: canvas.width, height: canvas.height },
      dpr: game.renderer.dpr, quality: game.renderer.preset.name,
      composer: game.renderer.postfx?.usesComposer ?? null,
    };
  });

  const soak = [];
  if (soakSeconds > 0) {
    const started = Date.now();
    while ((Date.now() - started) / 1000 < soakSeconds) {
      await page.waitForTimeout(30_000);
      soak.push(await page.evaluate(() => {
        const info = window.__BREACH__.renderer.renderer.info;
        return {
          geometries: info.memory.geometries, textures: info.memory.textures,
          programs: info.programs?.length ?? 0, heapMb: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        };
      }));
    }
  }
  await page.mouse.up();
  await page.keyboard.up('KeyW');
  void scenario;
  await context.close();

  const deltas = sample.deltas.sort((a, b) => a - b);
  const cpu = sample.cpu.sort((a, b) => a - b);
  const samples = sample.deltas.length;
  return {
    preset, requested: preset, applied: sample.quality, frames: samples, errors,
    frameMs: { p50: round(percentile(deltas, 50)), p95: round(percentile(deltas, 95)), p99: round(percentile(deltas, 99)),
      fps: round(samples / (deltas.reduce((sum, d) => sum + d, 0) / 1000), 1) },
    cpuRenderMs: { p50: round(percentile(cpu, 50)), p95: round(percentile(cpu, 95)), p99: round(percentile(cpu, 99)) },
    calls: sample.calls, triangles: sample.triangles, memory: sample.memory, programs: sample.programs,
    canvas: sample.canvas, dpr: sample.dpr,
    composerEstimateMb: composerMegabytes(sample.canvas.width, sample.canvas.height, preset === 'low' ? 0 : 4),
    soak,
  };
}

const browser = await chromium.launch({ headless });
const results = [];
try {
  for (const preset of presets) {
    const result = await runPreset(browser, preset);
    results.push(result);
    console.log(JSON.stringify(result));
  }
} finally {
  await browser.close();
  server.close();
}

await mkdir('test-results', { recursive: true });
const report = { label, at: new Date().toISOString(), viewport: { width, height, deviceScaleFactor }, headless, seconds, results };
await writeFile(`test-results/frames-${label}.json`, JSON.stringify(report, null, 2));

console.log(`\n| preset | canvas | dpr | fps | p50 ms | p95 ms | p99 ms | cpu render p50/p95 ms | calls | tris | composer est. MB |`);
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |');
for (const r of results) {
  console.log(`| ${r.preset} | ${r.canvas.width}x${r.canvas.height} | ${round(r.dpr)} | ${r.frameMs.fps} | ${r.frameMs.p50} | ${r.frameMs.p95} | ` +
    `${r.frameMs.p99} | ${r.cpuRenderMs.p50} / ${r.cpuRenderMs.p95} | ${r.calls} | ${r.triangles} | ${r.composerEstimateMb} |`);
}
