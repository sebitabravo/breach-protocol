import { expect, test, type Page } from '@playwright/test';
import { SHOT_DIR, screenIs, seedStorage } from './support';
import { CATALOG } from '../../src/i18n/catalog';
import { H, PHASE } from '../../src/wasm/protocol';

const LANDSCAPE = [
  { width: 915, height: 412 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];
/** Por debajo de esta altura en vertical el HUD no entra sin pisarse (límite conocido, ver docs/GAME_AUDIT.md). */
const HUD_MIN_PORTRAIT_HEIGHT = 640;
const TABLET = { width: 1024, height: 768 };
const PORTRAIT = [
  { width: 390, height: 844 },
  { width: 360, height: 640 },
  { width: 320, height: 568 },
];

/** Los dos flujos donde la línea de objetivo tiene el canal más angosto: paisaje
 * de teléfono angosto (banda centrada entre sector y estadísticas) y vertical
 * pequeño (panel de extracción encima). Ambos con la fase de extracción activa. */
const EXTRACTION_SIZES = [
  { width: 667, height: 375 },
  { width: 320, height: 640 },
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
  await page.locator('#screen-menu [data-goto="about"]').tap();
  await screenIs(page, 'about');
  await page.locator('#screen-about [data-action="practice"]').tap();
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

/** Bloques del HUD que nunca deben pisarse entre sí. */
const HUD_BLOCKS: Record<string, string> = {
  minimap: '.hud__minimap',
  sector: '.hud__block--sector',
  stats: '.hud__block--right',
  objective: '#hud-objective-line',
  score: '.hud__score',
  track: '.hud__objective-track',
  feed: '.hud__feed',
  ammo: '.ammo',
  vitals: '.vitals',
  tutorial: '.tutorial',
};

async function hudBoxes(page: Page): Promise<Box[]> {
  return page.evaluate((blocks) => {
    const out: { name: string; x: number; y: number; w: number; h: number }[] = [];
    for (const [name, selector] of Object.entries(blocks)) {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (r.width < 2 || r.height < 2 || style.display === 'none' || style.visibility === 'hidden') continue;
      // Un elemento con texto corto no debe contar todo su ancho de bloque: se mide el rango del texto.
      if (['objective', 'score'].includes(name)) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const t = range.getBoundingClientRect();
        out.push({ name, x: t.x, y: t.y, w: t.width, h: t.height });
      } else {
        out.push({ name, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return out;
  }, HUD_BLOCKS);
}

async function expectNoHudOverlap(page: Page, label: string, requireScore = true): Promise<void> {
  const boxes = await hudBoxes(page);
  const names = boxes.map((b) => b.name);
  if (requireScore) {
    expect(names, `${label}: score and objective must be present`).toEqual(expect.arrayContaining(['objective', 'score']));
  }
  const clashes: string[] = [];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      // 2 px de tolerancia: sombras y bordes no son contenido. Una caja contenida
      // dentro de otra (una estadística dentro de su bloque) es detalles del
      // mismo grupo, no dos elementos pisándose.
      const a = { ...boxes[i], x: boxes[i].x + 2, y: boxes[i].y + 2, w: boxes[i].w - 4, h: boxes[i].h - 4 };
      const b = { ...boxes[j], x: boxes[j].x + 2, y: boxes[j].y + 2, w: boxes[j].w - 4, h: boxes[j].h - 4 };
      const contained = (inner: Box, outer: Box): boolean =>
        inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
      if (contained(a, b) || contained(b, a)) continue;
      if (overlaps(a, b)) clashes.push(`${boxes[i].name} overlaps ${boxes[j].name}`);
    }
  }
  if (clashes.length) report.push(`${label}: ${clashes.join(', ')}`);
}
const report: string[] = [];

/** Los cinco tamaños del encargo S8 («no sobrecargues el HUD»): dos verticales
 *  pequeñas, dos apaisadas y dos de escritorio. El escrito del owner pide
 *  comprobar los cinco en cada project móvil táctil. */
const RESET_SIZES = [
  { width: 320, height: 640 },
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
  { width: 1600, height: 900 },
];

test('one fact per box: the HUD states terminal progress once, the score lives outside the objective card and nothing overlaps', async ({ page }, info) => {
  report.length = 0;
  for (const locale of ['es', 'en'] as const) {
    await page.addInitScript((next) => {
      localStorage.setItem(
        'bp.settings',
        JSON.stringify({ version: 2, quality: 'low', tutorialSeen: true, reduceMotion: false, locale: next }),
      );
    }, locale);
    await page.goto('/');
    await screenIs(page, 'menu');
    await page.locator('#screen-menu [data-goto="about"]').tap();
    await screenIs(page, 'about');
    await page.locator('#screen-about [data-action="practice"]').tap();
    await screenIs(page, 'playing');
    for (const size of RESET_SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      const label = `${info.project.name} ${locale} ${size.width}x${size.height}`;

      // Fase regular: el progreso de terminales debe aparecer una sola vez (la
      // fila de barras) y la puntuación debe vivir fuera de la tarjeta de objetivo.
      const facts = await page.evaluate(() => {
        const game = window.__BREACH__ as unknown as {
          hud: { update(state: unknown, touch: boolean): void };
          engine: { state: { float: Float32Array } };
        };
        // El tamaño anterior congeló el HUD parcheando update: se recupera el
        // método del prototipo para volver a narrar el estado real.
        delete (game.hud as { update?: unknown }).update;
        game.hud.update(game.engine.state, true);
        const line = document.getElementById('hud-objective-line')!;
        const style = (node: Element): CSSStyleDeclaration => getComputedStyle(node);
        const visible = (node: Element): boolean =>
          style(node).display !== 'none' && node.getBoundingClientRect().width > 0;
        return {
          line: line.textContent ?? '',
          counterInLine: /\(\d+\s*\/\s*\d+\)/.test(line.textContent ?? ''),
          meters: Array.from(document.querySelectorAll('#hud-nodes')).filter(visible).length,
          scoreInObjectiveCard: document.querySelector('.hud__block--objective #hud-score') !== null,
          scoreVisible: visible(document.getElementById('hud-score')!),
        };
      });
      expect(facts.counterInLine, `${label}: el contador textual duplica la fila de terminales`).toBe(false);
      expect(facts.meters, `${label}: la barra de terminales debe existir una vez`).toBe(1);
      expect(facts.scoreInObjectiveCard, `${label}: la puntuación vive dentro de la tarjeta de objetivo`).toBe(false);
      expect(facts.scoreVisible, `${label}: la puntuación sigue visible`).toBe(true);
      expect(facts.line, `${label}: el objetivo sigue narrado`).toContain('ermin');

      // Objetivo más largo del catálogo activo: el bucle sigue escribiendo el HUD
      // cada frame, así que se narra la fase de extracción una vez y se congela
      // el update para poder medir y capturar sin carrera.
      const extraction = await page.evaluate(() => {
        const game = window.__BREACH__ as unknown as {
          hud: { update(state: unknown, touch: boolean): void };
          engine: { state: { float: Float32Array } };
        };
        const state = game.engine.state;
        state.float[3] = 2; // PHASE.extraction
        state.float[31] = 3; // MAX_NODES
        state.float[36] = 12;
        game.hud.update(state, true);
        game.hud.update = () => {}; // congela el HUD en el frame inyectado
        const line = document.getElementById('hud-objective-line')!;
        const s = getComputedStyle(line);
        const lines = (() => {
          const rects: { x: number; y: number; w: number; h: number }[] = [];
          for (const child of Array.from(line.childNodes)) {
            if (child.nodeType !== Node.TEXT_NODE) continue;
            const range = document.createRange();
            range.selectNodeContents(child);
            for (const r of range.getClientRects()) rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
          }
          return rects;
        })();
        return {
          text: line.textContent ?? '',
          fontPx: parseFloat(s.fontSize),
          ellipsized: s.textOverflow === 'ellipsis',
          clipped: Math.max(0, line.scrollWidth - line.clientWidth),
          lines,
        };
      });
      expect(extraction.text, `${label}: el HUD narra el objetivo de extracción`).toBe(CATALOG[locale]['hud.objectiveExtract']);
      expect(extraction.fontPx, `${label}: tipo >= 11 px`).toBeGreaterThanOrEqual(11);
      expect(extraction.ellipsized, `${label}: sin elipsis`).toBe(false);
      expect(extraction.clipped, `${label}: sin recorte horizontal`).toBeLessThanOrEqual(1);
      for (const rect of extraction.lines) {
        expect(rect.x, `${label}: línea dentro del viewport`).toBeGreaterThanOrEqual(0);
        expect(rect.y, `${label}: línea dentro del viewport`).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.w, `${label}: línea dentro del viewport`).toBeLessThanOrEqual(size.width);
        expect(rect.y + rect.h, `${label}: línea dentro del viewport`).toBeLessThanOrEqual(size.height);
      }
      await expectNoHudOverlap(page, label);
      if (size.width === 320 || size.width === 667) {
        await page.screenshot({ path: `${SHOT_DIR}/objective-card-${locale}-${size.width}x${size.height}.png` });
      }
    }
  }
  expect(report, 'los bloques del HUD no se pisan en ningún tamaño').toEqual([]);
});

test('the extraction objective of the HUD fits between the sector and stats blocks', async ({ page }) => {
  /** Flujos en dos locales sobre la misma página: el locale vive en bp.settings y
   * el juego lo lee en el arranque, así que el segundo locale necesita recargar. */
  const switchLocale = async (locale: 'es' | 'en'): Promise<void> => {
    await page.goto('/');
    await screenIs(page, 'menu');
    if (locale !== 'es') {
      await page.evaluate((next) => {
        const raw = localStorage.getItem('bp.settings') ?? '{}';
        localStorage.setItem('bp.settings', JSON.stringify({ ...JSON.parse(raw), version: 2, quality: 'low', reduceMotion: false, tutorialSeen: true, locale: next }));
      }, locale);
      await page.reload();
      await screenIs(page, 'menu');
    }
  };

  /** Activa la línea de objetivo de extracción sin jugar la partida completa:
   * la única vía de e2e es empujar la fase del núcleo aunque la simulación siga
   * en práctica (la geomtría del HUD es lo que se prueba acá) y pedirle al HUD
   * que narre el snapshot real, como hace el bucle cada frame. */
  const actExtraction = async (): Promise<unknown> =>
    page.evaluate(() => {
      const game = window.__BREACH__ as unknown as {
        engine: { state: { float: Float32Array } };
        hud: { update(state: unknown, touch: boolean): void };
      };
      const state = game.engine.state;
      // Índices del buffer espejo en src/wasm/protocol.ts: H.phase=3, H.nodesActive=31, H.extraction=36.
      state.float[3] = 2; // PHASE.extraction
      state.float[31] = 3; // MAX_NODES
      state.float[36] = 12; // cuenta atrás visible
      game.hud.update(state, true);
      const line = document.getElementById('hud-objective-line')!;
      const rect = (node: Element): [number, number, number, number] => {
        const r = node.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      };
      const neighbour = (selector: string): [number, number, number, number] | null => {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node || getComputedStyle(node).display === 'none') return null;
        return rect(node);
      };
      return {
        text: line.textContent,
        // Rectas por línea de renderizado: los del nodo de texto, no el del bloque
        // (el bloque siempre devolvería una única caja). Con ellas se cuentan las
        // líneas reales y se comprueba que ninguna pise a un vecino.
        lines: (() => {
          const rects: number[][] = [];
          for (const child of Array.from(line.childNodes)) {
            if (child.nodeType !== Node.TEXT_NODE) continue;
            const range = document.createRange();
            range.selectNodeContents(child);
            for (const r of range.getClientRects()) rects.push([r.x, r.y, r.width, r.height]);
          }
          return rects;
        })(),
        fontPx: getComputedStyle(line).fontSize,
        ellipsized: getComputedStyle(line).textOverflow === 'ellipsis',
        clipped: Math.max(0, line.scrollWidth - line.clientWidth),
        neighbours: {
          sector: neighbour('.hud__block--sector'),
          stats: neighbour('.hud__block--right'),
          track: neighbour('.hud__objective-track'),
          feed: neighbour('.hud__feed'),
          extraction: neighbour('.hud__extraction'),
        },
      };
    });

  const expectations: string[] = [];
  const overlaps = (
    label: string,
    lines: { x: number; y: number; w: number; h: number }[],
    id: string,
    box: [number, number, number, number] | null,
  ): void => {
    if (!box) return;
    const [bx, by, bw, bh] = box;
    for (const line of lines) {
      // 2 px de tolerancia: bordes y sombras no son contenido.
      if (line.x < bx + bw - 2 && bx + 2 < line.x + line.w && line.y < by + bh - 2 && by + 2 < line.y + line.h) {
        expectations.push(`${label}: el texto del objetivo pisa ${id} (${Math.round(line.x)},${Math.round(line.y)} ${Math.round(line.w)}x${Math.round(line.h)} vs ${Math.round(bx)},${Math.round(by)} ${Math.round(bw)}x${Math.round(bh)})`);
      }
    }
  };

  await seedStorage(page, { tutorialSeen: true });
  // Índices del buffer espejo en src/wasm/protocol.ts: si el protocolo se mueve, fallar acá y no con una geometría mentirosa.
  expect([H.phase, H.nodesActive, H.extraction]).toEqual([3, 31, 36]);
  expect(PHASE.extraction).toBe(2);
  for (const locale of ['es', 'en'] as const) {
    await switchLocale(locale);
    await page.locator('#screen-menu [data-goto="about"]').tap();
    await screenIs(page, 'about');
    await page.locator('#screen-about [data-action="practice"]').tap();
    await screenIs(page, 'playing');
    for (const size of EXTRACTION_SIZES) {
      await page.setViewportSize(size);
      await page.waitForTimeout(300);
      const label = `${locale} ${size.width}x${size.height}`;
      const data = (await actExtraction()) as {
        text: string | null;
        lines: [number, number, number, number][];
        fontPx: string;
        ellipsized: boolean;
        clipped: number;
        neighbours: Record<string, [number, number, number, number] | null>;
      };
      // La cadena que debe caber es la más larga del catálogo (S8: queda visible entera).
      const longest = ['hud.objectiveNodes', 'hud.objectiveOverflow', 'hud.objectiveExtract']
        .map((key) => CATALOG[locale][key as keyof typeof CATALOG.es].replace('{active}', '3').replace('{total}', '3'))
        .reduce((a, b) => (b.length > a.length ? b : a));
      expect(data.text, `${label}: el HUD narra el objetivo de extracción`).toBe(CATALOG[locale]['hud.objectiveExtract']);
      expect(longest, `${label}: la extracción es la cadena de objetivo más larga del catálogo`).toBe(data.text);
      // Legible: piso de 11 px (docs/GAME_DESIGN_STANDARDS.md), sin recorte ni elipse.
      expect(parseFloat(data.fontPx), `${label}: tipo >= 11 px`).toBeGreaterThanOrEqual(11);
      expect(data.ellipsized, `${label}: sin elipsis`).toBe(false);
      expect(data.clipped, `${label}: sin recorte horizontal`).toBeLessThanOrEqual(1);
      // Regla documentada: el objetivo parte en 1–2 líneas; nunca más ni cero.
      expect(data.lines.length, `${label}: 1 o 2 líneas, hay ${data.lines.length}`).toBeGreaterThanOrEqual(1);
      expect(data.lines.length, `${label}: 1 o 2 líneas`).toBeLessThanOrEqual(2);
      // Sin solapes con los vecinos del HUD (la fila superior es la que más aprieta).
      const rects = data.lines.map(([x, y, w, h]) => ({ x, y, w, h }));
      for (const [id, box] of Object.entries(data.neighbours)) {
        if (id === 'feed' && !box) continue;
        overlaps(label, rects, id, box);
      }
      // Todo el texto dentro del viewport.
      for (const line of rects) {
        expect(line.x, `${label}: dentro del viewport`).toBeGreaterThanOrEqual(0);
        expect(line.y, `${label}: dentro del viewport`).toBeGreaterThanOrEqual(0);
        expect(line.x + line.w, `${label}: dentro del viewport`).toBeLessThanOrEqual(size.width);
        expect(line.y + line.h, `${label}: dentro del viewport`).toBeLessThanOrEqual(size.height);
      }
    }
  }
  expect(expectations, 'la línea de objetivo no pisa ningún bloque vecino').toEqual([]);
});


test('HUD blocks do not overlap each other at any phone size or on a tablet', async ({ page }, info) => {
  report.length = 0;
  await startPlaying(page);
  await page.evaluate(() => {
    const game = window.__BREACH__ as unknown as { hud: { pushFeed(text: string, kind?: string): void } };
    game.hud.pushFeed('oleada 1');
    game.hud.pushFeed('scout eliminado', 'good');
  });
  const sizes = info.project.name === 'mobile-landscape' ? [...LANDSCAPE, TABLET] : PORTRAIT.filter((size) => size.height >= HUD_MIN_PORTRAIT_HEIGHT);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-hud-${size.width}x${size.height}.png` });
    await expectNoHudOverlap(page, `${size.width}x${size.height}`);
  }
  expect(report).toEqual([]);
});

test('with the tutorial visible the HUD blocks still do not overlap', async ({ page }, info) => {
  report.length = 0;
  await seedStorage(page, { tutorialSeen: false });
  await page.goto('/');
  await screenIs(page, 'menu');
  // P4: sin gate de calibración; el tutorial vive en "Cómo jugar".
  await page.locator('#screen-menu [data-goto="about"]').tap();
  await screenIs(page, 'about');
  await page.locator('#screen-about [data-action="tutorial-replay"]').tap();
  await screenIs(page, 'playing');
  await expect(page.locator('#tutorial')).toBeVisible();
  const sizes = info.project.name === 'mobile-landscape' ? [...LANDSCAPE, TABLET] : PORTRAIT.filter((size) => size.height >= HUD_MIN_PORTRAIT_HEIGHT);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/mobile-tutorial-${size.width}x${size.height}.png` });
    await expectNoHudOverlap(page, `tutorial ${size.width}x${size.height}`, false);
  }
  expect(report).toEqual([]);
});