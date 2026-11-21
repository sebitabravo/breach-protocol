// Usage: bun scripts/measure-boot.mjs [dist] [cold runs]
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist');
const runs = Number(process.argv[3] ?? 7);
const types = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json', '.webp': 'image/webp',
  '.png': 'image/png', '.hdr': 'application/octet-stream', '.glb': 'model/gltf-binary',
};
const files = new Map();
for (const name of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!name.isFile()) continue;
  const path = join(name.parentPath, name.name);
  const raw = await readFile(path);
  const url = `/${relative(root, path)}`;
  const ext = extname(path);
  const gzip = /^\.(html|css|js|wasm)$/.test(ext) ? gzipSync(raw, { level: 9 }) : undefined;
  files.set(url, { raw, gzip, type: types[ext] ?? 'application/octet-stream' });
}
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const file = files.get(pathname === '/' ? '/index.html' : pathname);
  if (!file) return res.writeHead(404).end();
  const gzip = file.gzip && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
  const body = gzip ? file.gzip : file.raw;
  res.writeHead(200, {
    'Content-Type': file.type, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=3600',
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
  }).end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
const samples = [];
try {
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.addInitScript(() => {
      localStorage.setItem('bp.settings', JSON.stringify({ version: 2, tutorialSeen: true }));
      window.bootSample = {};
      const sample = window.bootSample;
      const frame = () => {
        const app = document.getElementById('app');
        const play = document.querySelector('#screen-menu [data-action="play"]');
        if (sample.menu === undefined && play?.checkVisibility() &&
            (app?.dataset.shellReady === 'true' || window.__BREACH__?.currentScreen === 'menu')) {
          sample.menu = performance.now();
        }
        if (app?.dataset.screen === 'playing' && window.__BREACH__?.engine?.state.tick > 0 &&
            window.__BREACH__?.renderer?.calls > 0 && document.getElementById('hud').checkVisibility()) {
          sample.playable = performance.now();
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'commit' });
    await page.waitForFunction(() => window.bootSample.menu !== undefined, { timeout: 30_000 });
    // Trusted touch input, without locator stability waits adding extra frames.
    const point = await page.$eval('#screen-menu [data-action="play"]', (button) => {
      const box = button.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    });
    await page.touchscreen.tap(point.x, point.y);
    await page.waitForFunction(() => window.bootSample.playable !== undefined, { timeout: 30_000 });
    const sample = await page.evaluate(() => {
      const firstPaint = performance.getEntriesByName('first-paint')[0].startTime;
      const { menu, playable } = window.bootSample;
      const nav = performance.getEntriesByType('navigation')[0];
      const resources = performance.getEntriesByType('resource').map((e) => ({
        path: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd, bytes: e.transferSize,
      }));
      const before = (t, js = false) => resources.filter((e) => e.end <= t && (!js || e.path.endsWith('.js')))
        .reduce((sum, e) => sum + e.bytes, js || nav.responseEnd > t ? 0 : nav.transferSize);
      return { firstPaint, menu, playable, beforePaint: before(firstPaint), jsBeforePaint: before(firstPaint, true),
        beforePlayable: before(playable), requests: 1 + resources.filter((e) => e.start <= playable && e.bytes > 0).length,
        assetsStarted: Math.min(...resources.filter((e) => /\.(hdr|webp|glb)$/.test(e.path)).map((e) => e.start)), resources };
    });
    samples.push(sample);
    console.log(JSON.stringify({ run: i + 1, ...sample, consoleErrors, pageErrors }));
    await context.close();
  }
  const median = (key) => samples.map((sample) => sample[key]).sort((a, b) => a - b)[Math.floor(runs / 2)];
  console.log('MEDIANS', Object.fromEntries(['firstPaint', 'menu', 'playable', 'beforePaint', 'jsBeforePaint', 'beforePlayable',
    'requests', 'assetsStarted'].map((key) => [key, median(key)])));
  console.log('BUILD', [...files].reduce((sum, [, f]) => sum + f.raw.length, 0), 'bytes total',
    [...files].filter(([path]) => path.endsWith('.map')).reduce((sum, [, f]) => sum + f.raw.length, 0), 'map bytes');
  for (const [path, file] of files) if (file.gzip) console.log(path, file.raw.length, file.gzip.length);
} finally {
  await browser.close();
  server.close();
}
