/**
 * P2 del product reset (D4): cada hecho duplicado tiene exactamente un dueño.
 *
 * Dos clases de guardia por hecho:
 *  1. Gate de reintroducción: lee el texto de los módulos consumidores y falla
 *     si vuelven a declarar el literal (imprime el sitio y el valor).
 *  2. Guardia de drift: compara el valor del dueño con su origen real —
 *     `core/src/*.rs` (frozen) o `src/styles/tokens.css` — e imprime ambos.
 *
 * Los dueños se importan con `await import` para que el archivo corra igual
 * antes del refactor (RED: los gates ya fallan, los dueños todavía no existen)
 * y después del refactor (GREEN).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const PLAYER_RS = read('../../core/src/player.rs');
const SIM_RS = read('../../core/src/sim.rs');
/** Canvas y mundo 3D usan los valores del tema oscuro (primer bloque :root);
 * el bloque `[data-theme="light"]` define variantes de contraste sobre blanco. */
const DARK_CSS = (() => {
  const css = read('../../src/styles/tokens.css');
  return css.slice(0, css.indexOf(':root[data-theme'));
})();

function rustF32(source: string, name: string, file: string): number {
  const match = new RegExp(`pub const ${name}: f32 = ([0-9.]+);`).exec(source);
  if (!match) throw new Error(`pub const ${name}: f32 not found in ${file}`);
  return Number(match[1]);
}

function cssToken(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(DARK_CSS);
  if (!match) throw new Error(`--${name} not found in tokens.css`);
  return match[1].toLowerCase();
}

/** Declaraciones `const NAME = <literal>` en el texto de un módulo. */
function declarations(source: string, literals: RegExp): string[] {
  return [...source.matchAll(new RegExp(`(?:const|let)\\s+(\\w+)\\s*=\\s*(${literals.source})\\b`, 'g'))]
    .map((match) => `${match[1]} = ${match[2]}`);
}

describe('D4 · player dimensions — owner: src/core/constants.ts', () => {
  const METRIC = /1\.62|1\.8|0\.36/;

  it('src/render/camera.ts y src/render/terminal-model.ts ya no las declaran (gate)', () => {
    const reintroduced = [
      ...declarations(read('../../src/render/camera.ts'), METRIC),
      ...declarations(read('../../src/render/terminal-model.ts'), METRIC),
    ];
    expect(reintroduced).toEqual([]);
  });

  it('el dueño replica EYE_HEIGHT/HEIGHT/RADIUS de core/src/player.rs', async () => {
    const { PLAYER } = (await import('../../src/core/constants')) as { PLAYER: Record<string, number> };
    expect(PLAYER.eyeHeight).toBe(rustF32(PLAYER_RS, 'EYE_HEIGHT', 'core/src/player.rs'));
    expect(PLAYER.height).toBe(rustF32(PLAYER_RS, 'HEIGHT', 'core/src/player.rs'));
    expect(PLAYER.radius).toBe(rustF32(PLAYER_RS, 'RADIUS', 'core/src/player.rs'));
  });

  it('camera.ts y terminal-model.ts derivan del dueño', async () => {
    const [{ PLAYER }, { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT }, { EYE_HEIGHT }] = await Promise.all([
      import('../../src/core/constants'),
      import('../../src/render/terminal-model'),
      import('../../src/render/camera'),
    ]);
    const metrics = PLAYER as unknown as Record<string, number>;
    expect(EYE_HEIGHT).toBe(metrics.eyeHeight);
    expect(PLAYER_EYE_HEIGHT).toBe(metrics.eyeHeight);
    expect(PLAYER_HEIGHT).toBe(metrics.height);
  });

  it('debug-overlays.ts mantiene su copia privada sincronizada con el dueño', async () => {
    const { PLAYER } = (await import('../../src/core/constants')) as { PLAYER: Record<string, number> };
    // P5: la dupla se movió con el overlay a debug-overlays.ts (mismo patrón que
    // terminal-model.ts). La guardia sigue fallando si el overlay de debug
    // empieza a mentir sobre el jugador.
    const source = read('../../src/render/debug-overlays.ts');
    const local = (name: string): number => {
      const match = new RegExp(`const ${name} = ([0-9.]+);`).exec(source);
      if (!match) throw new Error(`const ${name} not found in src/render/debug-overlays.ts`);
      return Number(match[1]);
    };
    expect(local('PLAYER_RADIUS')).toBe(PLAYER.radius);
    expect(local('PLAYER_HEIGHT')).toBe(PLAYER.height);
  });
});

describe('D4 · palette — owner: src/render/palette.ts', () => {
  it.each(['src/ui/hud.ts', 'src/ui/engineering.ts'])(
    '%s ya no repite los colores de estado (gate)',
    (file) => {
      const sites = read(`../../${file}`).match(/#5ce08b|#ff5b6b|#ffce6b|rgba\((92,224,139|255,91,107)/gi) ?? [];
      expect(sites).toEqual([]);
    },
  );

  it('los tokens CSS espejan STATE_COLORS', async () => {
    const { STATE_COLORS } = (await import('../../src/render/palette')) as { STATE_COLORS: Record<string, string> };
    expect(STATE_COLORS.ok).toBe(cssToken('state-ok'));
    expect(STATE_COLORS.danger).toBe(cssToken('danger'));
    expect(STATE_COLORS.warning).toBe(cssToken('warning'));
  });

  it('PALETTE deriva numéricamente de STATE_COLORS en themes.ts', async () => {
    const [{ STATE_COLORS }, { PALETTE }] = await Promise.all([
      import('../../src/render/palette'),
      import('../../src/render/themes'),
    ]);
    const hexToNum = (hex: string): number => parseInt(hex.slice(1), 16);
    expect(PALETTE.glow).toBe(hexToNum((STATE_COLORS as Record<string, string>).ok));
    expect(PALETTE.death).toBe(hexToNum((STATE_COLORS as Record<string, string>).ok));
    expect(PALETTE.impactEnemy).toBe(hexToNum((STATE_COLORS as Record<string, string>).danger));
  });
});

describe('D4 · graphics-effect list — owner: src/core/settings.ts', () => {
  it('src/render/presets.ts ya no inlinea la unión de claves (gate)', () => {
    const inlined = /'gfx\w+'\s*\|\s*'gfx\w+'/.exec(read('../../src/render/presets.ts'))?.[0] ?? null;
    expect(inlined).toBe(null);
  });

  it('src/ui/settings-form.ts ya no declara GFX_EFFECTS localmente (gate)', () => {
    const local = /const GFX_EFFECTS = \[/.exec(read('../../src/ui/settings-form.ts'))?.[0] ?? null;
    expect(local).toBe(null);
  });

  it('GFX_EFFECTS es la forma corta derivada de GFX_KEYS', async () => {
    const settings = (await import('../../src/core/settings')) as {
      GFX_KEYS: readonly string[];
      GFX_EFFECTS: readonly string[];
    };
    expect(settings.GFX_EFFECTS).toEqual(settings.GFX_KEYS.map((key) => key.slice(3).toLowerCase()));
  });

  it('resolveGfxPlan deriva su forma de GFX_KEYS', async () => {
    const [{ GFX_KEYS }, { PRESETS, resolveGfxPlan }] = await Promise.all([
      import('../../src/core/settings'),
      import('../../src/render/presets'),
    ]);
    const off = Object.fromEntries(GFX_KEYS.map((key) => [key, 'off']));
    const plan = resolveGfxPlan(PRESETS.high, off as never) as Record<string, boolean>;
    const names = GFX_KEYS.map((key) => key.slice(3).toLowerCase());
    expect(Object.keys(plan)).toEqual(names);
    expect(Object.values(plan)).toEqual(names.map(() => false));
  });
});

describe('D4 · match length — owner: src/core/constants.ts', () => {
  it('src/core/sectors.ts ya no escribe 3:00 a mano (gate)', () => {
    const restated = /3:00/.exec(read('../../src/core/sectors.ts'))?.[0] ?? null;
    expect(restated).toBe(null);
  });

  it('src/ui/results.ts ya no declara los 180 s (gate)', () => {
    const restated = /MATCH_LIMIT_SECONDS|\b180\b/.exec(read('../../src/ui/results.ts'))?.[0] ?? null;
    expect(restated).toBe(null);
  });

  it('MATCH_SECONDS replica core/src/sim.rs', async () => {
    const { MATCH_SECONDS } = (await import('../../src/core/constants')) as { MATCH_SECONDS: number };
    expect(MATCH_SECONDS).toBe(rustF32(SIM_RS, 'MATCH_SECONDS', 'core/src/sim.rs'));
  });

  it('formatMatchClock produce el reloj del copy', async () => {
    const { MATCH_SECONDS, formatMatchClock } = (await import('../../src/core/constants')) as {
      MATCH_SECONDS: number;
      formatMatchClock: (seconds: number) => string;
    };
    expect(formatMatchClock(MATCH_SECONDS)).toBe('3:00');
    expect(formatMatchClock(60)).toBe('1:00');
    expect(formatMatchClock(185)).toBe('3:05');
  });

  it('los deadlines de sector derivan de MATCH_SECONDS', async () => {
    const [{ SECTORS }, { MATCH_SECONDS, formatMatchClock }] = await Promise.all([
      import('../../src/core/sectors'),
      import('../../src/core/constants'),
    ]);
    const expected = `Completá antes de ${formatMatchClock(MATCH_SECONDS)}`;
    for (const sector of SECTORS as readonly { objectives: readonly string[] }[]) {
      expect(sector.objectives[sector.objectives.length - 1]).toBe(expected);
    }
  });
});
