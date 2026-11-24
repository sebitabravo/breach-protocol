/**
 * D4 del product reset + decisión del owner sobre locales (S7/S8): un solo
 * catálogo de copy en dos locales, un runtime mínimo y cero frases dispersas.
 *
 * Cuatro guardias:
 *  1. Paridad de claves entre locales: mismo set de claves, sin valores vacíos
 *     y sin duplicados sin traducir (es === en por accidente).
 *  2. Gate de reintroducción: escanea src/ui/, src/core/game.ts e index.html y
 *     falla si encuentra una frase visible codificada a mano, formato de número
 *     o reloj por fuera del runtime de i18n, o un mapa de rótulos por módulo.
 *  3. Persistencia: un locale guardado desconocido cae a español.
 *  4. Cambio en vivo: setLocale re-renderiza el marcado estático declarativo y
 *     actualiza document.documentElement.lang sin recargar.
 *
 * El entorno de unit es `node` (sin DOM): la prueba de cambio en vivo usa un
 * document mínimo, igual que gfx-wiring.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

// El catálogo y el runtime se importan arriba: en RED el módulo todavía no existe
// y el archivo entero debe fallar.
const { ES, EN } = await import('../../src/i18n/catalog');
const { t, initI18n, setLocale, getLocale, onLocaleChange, applyStatic, formatNumber, formatClock, formatClockPadded }
  = await import('../../src/i18n/runtime');

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

// ------------------------------------------------------------------ helpers

/** Texto de literales de cadena (simples, dobles y plantillas), sin comentarios. */
function stringLiterals(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const literals: string[] = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  for (const match of code.matchAll(re)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    // Las plantillas se parten por interpolación: se juzga cada trozo estático.
    for (const chunk of raw.split(/\$\{[^}]*\}/)) literals.push(chunk);
  }
  return literals;
}

/** Palabra minúscula de dos o más letras (español o inglés). */
const WORD = /[a-záéíóúñü]{2,}/u;
/** Dos palabras minúsculas separadas por algo que no es letra. */
const TWO_WORDS = /[a-záéíóúñü]{2,}[^\p{L}\p{N}]+[a-záéíóúñü]{2,}/u;
/** Una sola palabra con tilde/ñ ya delata copy español. */
const ACCENT = /[áéíóúñü]/u;

function looksLikeSentence(text: string): boolean {
  return TWO_WORDS.test(text) || (ACCENT.test(text) && WORD.test(text));
}

/** Tokens técnicos sin espacios: ids de DOM, claves de catálogo, códigos de arma.
 *  También trozos de expresión: cadenas con llaves de interpolación residuales,
 *  valores `var(--…)`, media queries y paréntesis de expresión. */
function isTechnicalToken(text: string): boolean {
  return /^[a-zA-Z0-9_.:#∞—·|%\s-]+$/.test(text) && /[0-9_.:#-]/.test(text) && !/\s{2}/.test(text);
}

function isExpression(text: string): boolean {
  return /^[\s]*\)/.test(text) || text.startsWith('(') || text.startsWith('var(') || /[{}]/.test(text);
}

function isSelector(text: string): boolean {
  return text.includes('data-') || text.includes('aria-') || /^[#.[]/.test(text) || text.includes('::');
}

function isPath(text: string): boolean {
  return text.includes('../') || text.includes('./') || text.includes('://') || /^[\w-]+\.(ts|css|html|md|rs)$/.test(text);
}

/**
 * Literales de módulos .ts que sobreviven como técnicas, una por una con causa.
 * Cualquier frase nueva en español o inglés debe fallar el escaneo, no colarse aquí.
 */
const TECHNICAL_LITERALS = new Set<string>([
  'SECTOR_', // prefijo compuesto con id en renderSectorCards
  'sector 0', // boardLabel deriva el código del tablero ('mission:s01' → 'sector 01')
  ' ∞', // sufijo de munición infinita, no es copy de idioma
  'diario:', // prefijo del tablero diario (id de red, no copy)
  'arena vacía', // detalle de error interno; lo clava boot-view.test vía fallbackMessage
  'no se pudo iniciar el sector', // error interno lanzado, no pasa por la UI
  'yaw · pitch · fov', // notación de ejes de cámara, idéntica en ambos idiomas
]);

function hardcodedInModules(): string[] {
  const files = [
    'src/ui/hud.ts', 'src/ui/campaign-view.ts', 'src/ui/board-view.ts', 'src/ui/results.ts',
    'src/ui/tutorial-view.ts', 'src/ui/boot-view.ts', 'src/ui/settings-form.ts',
    'src/ui/engineering.ts', 'src/ui/objective-marker.ts', 'src/core/game.ts',
  ];
  const offenders: string[] = [];
  for (const file of files) {
    for (const literal of stringLiterals(read(`../../${file}`))) {
      const text = literal.trim();
      if (!looksLikeSentence(text)) continue;
      if (isTechnicalToken(text) || isSelector(text) || isPath(text) || isExpression(text) || TECHNICAL_LITERALS.has(text)) continue;
      offenders.push(`${file}: "${text}"`);
    }
  }
  return offenders;
}

/** Nodos de texto de index.html: excluye el contenido marcado con data-i18n*,
 *  el wordmark (marca) y los bloques style/script. */
function hardcodedInMarkup(): string[] {
  const html = read('../../index.html')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    // El contenido de un nodo traducido declarativamente NO es copy disperso
    // (data-i18n con la comilla, para no confundirlo con data-i18n-aria).
    .replace(/<[^>]*\sdata-i18n="[^>]*>([^<]*)</g, '<')
    .replace(/<[^>]*>/g, '\n');
  const offenders: string[] = [];
  for (const raw of html.split('\n')) {
    const text = raw.trim();
    if (!looksLikeSentence(text)) continue;
    offenders.push(`index.html: "${text}"`);
  }
  return offenders;
}

const TECHNICAL_MARKUP = new Set<string>([
  'rust → wasm', // valor técnico del menú, idéntico en ambos locales
  'three.js', // nombre de la biblioteca
  '60 hz', // especificación del paso fijo
  'draw calls', // término de instrumentación
  'frametime p50', 'frametime p95', // términos de instrumentación
  'ticks sim', // término de instrumentación
  'sector 01 · core room', // valor por defecto que renderMenu sobreescribe
  'sebita.dev ↗', // marca
  'bp_snapshot_ptr() + protocol.ts', // símbolo técnico
  'docs/api-contract.md', // ruta de documentación
]);

describe('1 · paridad de claves entre locales — owner: src/i18n/catalog.ts', () => {
  it('declara exactamente el mismo set de claves (sin faltantes ni huérfanas)', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(ES).sort());
  });

  it('no declara valores vacíos', () => {
    for (const [locale, catalog] of [['es', ES], ['en', EN]] as const) {
      const empty = Object.entries(catalog).filter(([, value]) => value.trim().length === 0);
      expect(empty).toEqual([]);
      expect(empty.map(([key]) => `${locale}.${key}`)).toEqual([]);
    }
  });

  it('no traduce por accidente: en === es solo en la lista blanca documentada', () => {
    // Tokens deliberadamente neutros (nombres propios, códigos, términos técnicos).
    const deliberatelyIdentical = new Set([
      'boot.checkArena', // 'sector 01'
      'hud.overflowCode', // 'OVERFLOW'
      'menu.kvRender', // 'render'
      'objective.terminalFmt', // 'Terminal {n}'
      'pause.tabAudio', // 'Audio'
      'pause.audio', // 'Audio'
      'pause.gfxBloom', // 'Bloom'
      'pause.optionAuto', // 'Auto'
      'pause.keysMouse', // 'mouse'
      'pause.keysEngineering', // 'engineering mode'
      'results.control', // 'control'
      'results.inputMouse', // 'mouse'
      'board.overflowLabel', // 'overflow'
      'eng.metricPostfx', // 'postfx'
      'fallback.aria', // 'Error' — misma palabra en ambos idiomas
    ]);
    const accidental = Object.entries(EN as Record<string, string>)
      .filter(([key, value]) => value === (ES as Record<string, string>)[key] && !deliberatelyIdentical.has(key))
      .map(([key]) => key);
    expect(accidental).toEqual([]);
  });
});

describe('2 · gate de reintroducción de copy disperso', () => {
  it('ningún módulo de UI declara una frase visible a mano', () => {
    expect(hardcodedInModules()).toEqual([]);
  });

  it('el marcado estático no contiene frases por fuera del catálogo', () => {
    const offenders = hardcodedInMarkup().filter((line) => {
      const text = line.slice('index.html: "'.length, -1);
      return !TECHNICAL_MARKUP.has(text);
    });
    expect(offenders).toEqual([]);
  });

  it('el formato de número, fecha, hora y reloj vive solo en el runtime de i18n', () => {
    const files = ['src/ui/hud.ts', 'src/ui/campaign-view.ts', 'src/ui/board-view.ts',
      'src/ui/results.ts', 'src/ui/engineering.ts', 'src/core/game.ts'];
    const sites = files.flatMap((file) => {
      const source = read(`../../${file}`);
      return [...source.matchAll(/toLocale(Locale)?(String|DateString|TimeString)|'es-CL'/g)]
        .map((match) => `${file}: ${match[0]}`);
    });
    expect(sites).toEqual([]);
  });

  it('no quedan mapas de rótulos por módulo (GFX_LABELS, BOOT_COPY)', () => {
    expect(/const GFX_LABELS\s*=/.test(read('../../src/ui/settings-form.ts'))).toBe(false);
    expect(/const BOOT_COPY\s*=/.test(read('../../src/core/game.ts'))).toBe(false);
  });
});

describe('3 · persistencia y fallback del locale', () => {
  it('un locale guardado desconocido cae a español (sanitize)', async () => {
    const { sanitize } = await import('../../src/core/settings');
    expect(sanitize({ locale: 'fr' }).locale).toBe('es');
    expect(sanitize({ locale: 'EN' }).locale).toBe('es');
    expect(sanitize({}).locale).toBe('es');
    expect(sanitize({ locale: 'en' }).locale).toBe('en');
  });

  it('el runtime normaliza un locale desconocido a español', () => {
    initI18n('fr' as never);
    expect(getLocale()).toBe('es');
    initI18n('en');
    expect(getLocale()).toBe('en');
    initI18n('es');
  });

  it('una clave ausente devuelve su propia clave, nunca undefined', () => {
    expect(t('clave.inexistente' as never)).toBe('clave.inexistente');
  });

  it('t() sustituye parámetros {name}', () => {
    expect(t('menu.recordFmt', { score: '1.234' })).toMatch(/^récord: 1\.234$/);
  });
});

describe('4 · cambio de locale en vivo (sin recarga)', () => {
  interface FakeNode {
    dataset: Record<string, string>;
    textContent: string;
    attrs: Record<string, string>;
    setAttribute(name: string, value: string): void;
  }

  const nodes: FakeNode[] = [];
  const makeNode = (key: string, attrType?: 'Aria' | 'Title' | 'Placeholder'): FakeNode => {
    const node: FakeNode = {
      dataset: { i18n: key },
      textContent: '',
      attrs: {},
      setAttribute(name: string, value: string) { this.attrs[name] = value; },
    };
    if (attrType) node.dataset[`i18n${attrType}`] = key;
    nodes.push(node);
    return node;
  };

  const fakeDocument = {
    documentElement: { lang: '' },
    querySelectorAll(selector: string): FakeNode[] {
      if (selector === '[data-i18n], [data-i18n-aria], [data-i18n-title], [data-i18n-placeholder]') return nodes;
      return [];
    },
  };

  let originalDocument: unknown;
  let originalDescriptor: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalDocument = globalThis.document;
    originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      get: () => fakeDocument,
    });
  });

  afterAll(() => {
    if (originalDescriptor) Object.defineProperty(globalThis, 'document', originalDescriptor);
    else if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document;
    else (globalThis as { document: unknown }).document = originalDocument;
  });

  it('applyStatic pinta texto, aria-label y placeholder desde el catálogo', () => {
    makeNode('menu.play');
    makeNode('touch.fire', 'Aria');
    makeNode('board.operator', 'Placeholder');
    applyStatic();
    expect(nodes[0].textContent).toBe('Jugar');
    expect(nodes[1].attrs['aria-label']).toBe('Disparar');
    expect(nodes[2].attrs.placeholder).toBe('Operador');
  });

  it('setLocale re-renderiza el mismo nodo al otro idioma y avisa a los oyentes', () => {
    const seen: string[] = [];
    const off = onLocaleChange(() => seen.push(nodes[0].textContent));
    setLocale('en');
    expect(nodes[0].textContent).toBe('Play');
    expect(nodes[1].attrs['aria-label']).toBe('Fire');
    expect(seen).toEqual(['Play']);
    setLocale('es');
    expect(nodes[0].textContent).toBe('Jugar');
    expect(seen).toEqual(['Play', 'Jugar']);
    off();
  });

  it('document.documentElement.lang sigue al locale activo', () => {
    setLocale('en');
    expect(fakeDocument.documentElement.lang).toBe('en');
    setLocale('es');
    expect(fakeDocument.documentElement.lang).toBe('es');
  });
});

describe('5 · un solo lugar para número y reloj', () => {
  it('formatNumber agrupa según el locale activo', () => {
    initI18n('es');
    expect(formatNumber(12_345)).toBe('12.345');
    initI18n('en');
    expect(formatNumber(12_345)).toBe('12,345');
    initI18n('es');
  });

  it('formatClock y formatClockPadded producen los relojes existentes', () => {
    expect(formatClock(180)).toBe('3:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClockPadded(330)).toBe('05:30');
  });
});
