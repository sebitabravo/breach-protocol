/**
 * T5b/adaptativo: resolución dinámica bajo carga (recorte continuo de resolución).
 *
 * Referencia (halloween.dev): además de bajar de preset, el juego re-escala la
 * resolución bajo carga (`scale` en `tld.gfx.v1` con contador `shed`). Aquí eso
 * es un factor multiplicativo ENCIMA del presupuesto de píxeles existente:
 * nunca lo reemplaza y nunca puede subir el costo por encima del allowance del preset.
 *
 * Contratos probados:
 * - Señal suavizada (EMA) con histéresis asimétrica: recorta rápido cuando se
 *   pierde el presupuesto sostenido, recupera lento y solo con holgura sostenida.
 * - Sin oscilación: una escena estable converge a una escala y se queda ahí,
 *   incluso con una serie jittery cuyo p95 crudo perdería el presupuesto.
 * - Piso y techo respetados; la escala nunca sube el costo por encima del
 *   presupuesto del preset (precedencia explícita).
 * - Precedencia frente al controlador de preset: mientras la escala recorta y
 *   no llegó al piso, el controlador NO baja de preset por la misma carga
 *   (sin doble castigo); al llegar al piso y seguir perdiendo, la bajada de
 *   preset es el siguiente paso correcto; la subida espera a que la escala
 *   vuelva a su techo.
 * - Compatibilidad del registro persistido: el formato `bp.gfx.tier` NO gana
 *   campos (settings.ts no es superficie de esta unidad) y los registros v1
 *   previos siguen cargando.
 */
import { describe, expect, it } from 'vitest';
import { AdaptiveScale, QualityController, type QualityChange, type QualityOptions, type ScaleDecision } from '../../src/core/quality';
import { GFX_TIER_VERSION, hashGpuSignature, loadGfxTierRecord, saveGfxTierRecord, type StorageLike } from '../../src/core/settings';
import { PLAY_PIXEL_BUDGET, PRESETS, playPixelRatio } from '../../src/render/presets';

// ---------------------------------------------------------------- AdaptiveScale

interface TestStorage extends StorageLike {
  data: Map<string, string>;
}

function memStorage(initial: Record<string, string> = {}): TestStorage {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

interface ScaleOpts {
  windowSize?: number;
  emaAlpha?: number;
  downThresholdMs?: number;
  upThresholdMs?: number;
  downFactor?: number;
  upFactor?: number;
  windowsToShed?: number;
  windowsToWarmup?: number;
  floor?: number;
}

function scale(opts: ScaleOpts = {}): AdaptiveScale {
  // Ventanas cortas y EMA ágil para que una "ventana de test" sean pocas muestras;
  // los umbrales exactos de producción (22/14 ms) para que las decisiones de
  // test sean las decisiones reales. El warmup de producción se prueba aparte.
  return new AdaptiveScale({ windowSize: opts.windowSize ?? 10, emaAlpha: opts.emaAlpha ?? 0.2, windowsToWarmup: 0, ...opts });
}

/** Bucle cerrado simple: el frame ms de una escena GPU-bound escala ∝ escala² (píxeles ∝ dpr²). */
function driveClosedLoop(as: AdaptiveScale, baseMs: number, blocks: number, windowSize = 10): ScaleDecision[] {
  const out: ScaleDecision[] = [];
  for (let b = 0; b < blocks; b += 1) {
    const ms = baseMs * as.scale * as.scale;
    for (let i = 0; i < windowSize; i += 1) out.push(as.sample(ms));
  }
  return out;
}

function windowOf(as: AdaptiveScale, ms: number, windowSize = 10): ScaleDecision {
  let last: ScaleDecision = as.sample(ms);
  for (let i = 1; i < windowSize; i += 1) last = as.sample(ms);
  return last;
}

describe('AdaptiveScale — recorte bajo carga sostenida', () => {
  it('sheds fast and reaches its floor under sustained over-budget frames', () => {
    const as = scale();
    // La primera ventana confirma la pérdida; la segunda dispara el primer recorte
    // (recorte rápido: no espera cinco ventanas). Con windowsToShed=2 por defecto
    // y windowsToShed=1, el primer recorte ocurre en la primera ventana confirmada.
    windowOf(as, 250);
    const first = windowOf(as, 250);
    expect(first).toMatchObject({ changed: true, reason: 'down' });
    expect(first.scale).toBeLessThan(1);
    // El recorte continúa decisión a decisión hasta el piso exacto.
    for (let i = 0; i < 8; i += 1) windowOf(as, 250);
    expect(as.scale).toBe(0.5);
    expect(as.atFloor).toBe(true);
    expect(as.atCeiling).toBe(false);
    const again = windowOf(as, 250);
    expect(again.changed).toBe(false); // el piso es estable, no hay recursión extra
    expect(as.shed).toBeGreaterThan(0);
  });

  it('recovers slowly, one small multiplicative step per sustained headroom window', () => {
    const as = scale();
    windowOf(as, 250);
    for (let i = 0; i < 8; i += 1) windowOf(as, 250);
    expect(as.scale).toBe(0.5);
    // Holgura sostenida: la subida es un paso pequeño por ventana, nunca un salto.
    // (La primera ventana de holgura solo DRENA el EMA desde 250 ms; la decisión 'up'
    // llega en la segunda — el rezago del suavizado es justo el blindaje anti-hitch.)
    windowOf(as, 5);
    const firstUp = windowOf(as, 5);
    expect(firstUp).toMatchObject({ changed: true, reason: 'up' });
    expect(firstUp.scale).toBeGreaterThan(0.5);
    expect(firstUp.scale).toBeLessThanOrEqual(0.5 * 1.05 + 0.001);
    // Todavía faltan MUCHAS ventanas para volver al techo (recuperación lenta).
    for (let i = 0; i < 4; i += 1) windowOf(as, 5);
    expect(as.scale).toBeLessThan(1);
    for (let i = 0; i < 20; i += 1) windowOf(as, 5);
    expect(as.scale).toBe(1);
    expect(as.atCeiling).toBe(true);
    // En el techo la holgura ya no muda nada.
    expect(windowOf(as, 5).changed).toBe(false);
  });

  it('never sheds on a jittery series whose smoothed signal sits inside the deadband', () => {
    const as = scale();
    // Serie jittery: p95 crudo 24 ms (perdería el presupuesto del controlador) pero
    // EMA ~15-17 ms, dentro de la banda muerta [14, 22]: escala exactamente 1 siempre.
    const frames: number[] = [];
    for (let i = 0; i < 150; i += 1) frames.push(i % 2 === 0 ? 8 : 24);
    for (const ms of frames) as.sample(ms);
    expect(as.scale).toBe(1);
    expect(as.shed).toBe(0);
  });

  it('settles: a heavy closed-loop scene reaches one stable scale and never oscillates', () => {
    const as = scale();
    const decisions = driveClosedLoop(as, 40, 40);
    // Hubo recorte real (la carga era sostenida y sobre presupuesto).
    expect(as.scale).toBeLessThan(1);
    expect(as.scale).toBeGreaterThan(0.5);
    expect(as.shed).toBeGreaterThan(0);
    // Las últimas 10 ventanas: cero movimiento — escena estable, escala fija.
    const tail = decisions.slice(-100);
    for (const d of tail) expect(d.changed).toBe(false);
  });
});

describe('AdaptiveScale — límites', () => {
  it('ceiling: never exceeds 1 even with endless perfect frames', () => {
    const as = scale();
    for (let i = 0; i < 20; i += 1) windowOf(as, 1);
    expect(as.scale).toBe(1);
    expect(as.atCeiling).toBe(true);
  });

  it('ignores hostile samples (NaN, <=0, >250) like the preset controller', () => {
    const as = scale();
    for (const bad of [Number.NaN, 0, -16, 300, Number.POSITIVE_INFINITY]) {
      expect(as.sample(bad).changed).toBe(false);
    }
    // Nada de basura llenó la ventana: una ventana válida sólida decide desde cero.
    windowOf(as, 250);
    expect(windowOf(as, 250)).toMatchObject({ changed: true, reason: 'down' });
  });

  it('warmup: the first two works of boot/transition never shed, even when they lose the budget', () => {
    const as = new AdaptiveScale({ windowSize: 10, emaAlpha: 0.2 }); // producción: windowsToWarmup = 2
    // Spike de transición a "playing": EMA arrancado en 250 ms y decaimiento lento —
    // las dos primeras ventanas pierden el presupuesto PERO son calentamiento.
    expect(windowOf(as, 250).changed).toBe(false);
    expect(windowOf(as, 250).changed).toBe(false);
    // La señal ya descansa: la banda muerta sostiene la escala en su techo.
    for (let i = 0; i < 60; i += 1) as.sample(16.7);
    expect(as.scale).toBe(1);
    expect(as.shed).toBe(0);
    // Una pérdida REAL y sostenida después del calentamiento sí recorta.
    windowOf(as, 250);
    expect(windowOf(as, 250)).toMatchObject({ changed: true, reason: 'down' });
  });
});

// -------------------------------------------------- precedencia del presupuesto

describe('playPixelRatio con factor adaptativo — el presupuesto sigue siendo el techo', () => {
  const pixels = (dpr: number, w: number, h: number) => dpr * dpr * w * h;

  it('without the argument the function is bit-identical to the previous formula (PRESERVE)', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      const p = PRESETS[name];
      const expected = Math.min(p.dpr, 1.75, 2, Math.sqrt(PLAY_PIXEL_BUDGET[name] / (1600 * 900)));
      expect(playPixelRatio(p, 1600, 900, 1.75, 2)).toBe(expected);
    }
  });

  it('scale only reduces cost below the budget; pixels never exceed the preset allowance', () => {
    for (const name of ['low', 'medium', 'high'] as const) {
      const p = PRESETS[name];
      const full = playPixelRatio(p, 1600, 900, Infinity, 2);
      for (const s of [0.25, 0.5, 0.7225, 0.99]) {
        const dpr = playPixelRatio(p, 1600, 900, Infinity, 2, s);
        expect(dpr).toBeLessThanOrEqual(full);
        expect(pixels(dpr, 1600, 900)).toBeLessThanOrEqual(PLAY_PIXEL_BUDGET[name] + 1);
      }
    }
  });

  it('clamps hostile scale values: can never raise above the budget ceiling either', () => {
    expect(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, 3)).toBe(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, 1));
    expect(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, Number.NaN)).toBe(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, 1));
    expect(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, -1)).toBe(playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, 0.25));
  });

  it('multiplies, not replaces: the scale divides the budget DPR', () => {
    const full = playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2);
    const half = playPixelRatio(PRESETS.high, 1600, 900, Infinity, 2, 0.5);
    expect(Math.abs(half - full / 2)).toBeLessThan(0.005);
    expect(pixels(half, 1600, 900)).toBeLessThanOrEqual(PLAY_PIXEL_BUDGET.high);
  });
});

// ---------------------------------------------------- controlador de preset

interface TestOptions extends QualityOptions {
  storage?: TestStorage;
}

function controllerOptions(extra: Partial<TestOptions> = {}): TestOptions {
  // Igual que producción en proporción: la ventana del controlador (20) es el
  // doble de la de la escala (10), como 45 contra 20 en producción.
  return { windowSize: 20, windowsToDrop: 2, windowsToRaise: 3, cooldownMs: 0, ...extra };
}

/** Alimenta controlador y escala todos los frames con una escena de costo base `baseMs`
 *  cuyo frame ms observado = baseMs · scale² (la escala presente AL RENDERIZAR ese frame).
 *  La ventana de la escala es 10; la del controlador, 20 (dos bloques). */
function driveBoth(
  qc: QualityController,
  as: AdaptiveScale,
  baseMs: number,
  blocks: number,
): { controllerChanges: QualityChange[]; last: ScaleDecision } {
  const now = { t: 1000 };
  const controllerChanges: QualityChange[] = [];
  let last: ScaleDecision = { changed: false, scale: as.scale, atFloor: as.atFloor, reason: 'none' };
  for (let b = 0; b < blocks; b += 1) {
    const ms = baseMs * as.scale * as.scale;
    const adaptiveReadout = { scale: as.scale, atFloor: as.atFloor };
    for (let i = 0; i < 10; i += 1) {
      const decision = qc.sample(ms, now.t++, undefined, adaptiveReadout);
      if (decision.changed) controllerChanges.push(decision);
    }
    for (let i = 0; i < 10; i += 1) last = as.sample(ms);
  }
  return { controllerChanges, last };
}

describe('precedencia: AdaptiveScale + QualityController (sin doble castigo)', () => {
  it('controller holds while the scale is shedding and succeeds (no double penalty)', () => {
    const qc = new QualityController('auto', controllerOptions());
    const as = scale();
    // Costo base 30 ms: sobre presupuesto a escala 1, DENTRO al recortar (30·0.72²≈15.7).
    const { controllerChanges } = driveBoth(qc, as, 30, 30);
    // La carga se resuelve enteramente por resolución: recortada y estable.
    expect(as.scale).toBeLessThan(1);
    expect(as.scale).toBeGreaterThan(0.5);
    // El controlador no baja de preset por la misma carga sostenida…
    expect(controllerChanges).toEqual([]);
    // …ni sube mientras la escala todavía no devolvió el presupuesto.
    expect(qc.preset).toBe('medium');
  });

  it('the same sustained load WITHOUT the gate drops the preset (the gate does the work)', () => {
    const qc = new QualityController('auto', controllerOptions());
    let last = qc.sample(30, 1000);
    for (let i = 1; i < 40; i += 1) last = qc.sample(30, 1000);
    expect(last).toMatchObject({ changed: true, preset: 'low', reason: 'down' });
  });

  it('climbs are blocked until the scale returns to its ceiling, then happen as today', () => {
    const qc = new QualityController('auto', { ...controllerOptions(), windowsToRaise: 1 });
    const as = scale();
    // Fase 1: carga pesada — recorta y estabiliza; el controlador no actúa.
    driveBoth(qc, as, 40, 15);
    expect(as.scale).toBeLessThan(1);
    expect(as.scale).toBeGreaterThan(0.5);
    expect(qc.preset).toBe('medium');
    // Fase 2: la escena se vuelve liviana. La escala recupera lento; el controlador
    // ve p95 < 12 pero NO sube mientras scale < 1 (la holgura es de la escala).
    driveBoth(qc, as, 8, 6);
    expect(qc.preset).toBe('medium');
    expect(as.scale).toBeLessThan(1);
    // Fase 3: la escala llega a su techo; la holgura sostenida ahora sí sube de preset.
    driveBoth(qc, as, 8, 30);
    expect(as.scale).toBe(1);
    expect(qc.preset).toBe('high');
  });

  it('if the scale is at its floor and frames still miss, the preset drop is the next step', () => {
    const qc = new QualityController('auto', controllerOptions());
    const as = scale();
    // Costo base 100: incluso en el piso (0.5 → 25 ms) se pierde el presupuesto.
    const { controllerChanges } = driveBoth(qc, as, 100, 30);
    expect(as.atFloor).toBe(true);
    expect(controllerChanges.length).toBeGreaterThan(0);
    expect(qc.preset).toBe('low');
    expect(controllerChanges[0]).toMatchObject({ reason: 'down' });
  });

  it('PRESERVE: the legacy 3-argument sample behaves exactly as before', () => {
    const qc = new QualityController('auto', controllerOptions());
    let last = qc.sample(40, 1000);
    for (let i = 1; i < 20; i += 1) last = qc.sample(40, 1000);
    // Ventana única de 20 no basta con windowsToDrop 2; dos ventanas sí.
    for (let i = 0; i < 20; i += 1) last = qc.sample(40, 1000);
    expect(last).toMatchObject({ changed: true, preset: 'low', reason: 'down' });
    // Ventana en la banda muerta: sin movimiento, como siempre.
    const idle = new QualityController('auto', controllerOptions());
    let quiet = idle.sample(16, 1000);
    for (let i = 1; i < 20; i += 1) quiet = idle.sample(16, 1000);
    expect(quiet.changed).toBe(false);
  });
});

// ------------------------------------------------- registro persistido compatible

describe('persisted-record compatibility (bp.gfx.tier gana CERO campos de esta unidad)', () => {
  const SIG_A = hashGpuSignature(['webgl2', 'acme', 'acme-lobo-xt', '2@1536x864']);

  it('the saved record keeps the exact historical shape: only v, sig, tier, verified', () => {
    const storage = memStorage();
    expect(saveGfxTierRecord('high', SIG_A, storage)).toBe(true);
    const parsed = JSON.parse(storage.data.get('bp.gfx.tier') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['sig', 'tier', 'v', 'verified']);
    expect(parsed.v).toBe(GFX_TIER_VERSION);
  });

  it('a record written by an older build (v1) still loads after this change', () => {
    const legacy = memStorage({
      'bp.gfx.tier': JSON.stringify({ v: 1, sig: SIG_A, tier: 'medium', verified: 1700000000000 }),
    });
    expect(loadGfxTierRecord(legacy, SIG_A)).toBe('medium');
  });

  it('a preset drop taken under the adaptive gate still persists a legible tier record', () => {
    const storage = memStorage();
    const qc = new QualityController('auto', controllerOptions({ storage, signature: () => SIG_A, applyVerified: true }));
    const as = scale();
    // Costo base 100: la escala llega al piso, el controlador baja a low → persiste.
    for (let b = 0; b < 30; b += 1) {
      const ms = 100 * as.scale * as.scale;
      const adaptiveReadout = { scale: as.scale, atFloor: as.atFloor };
      for (let i = 0; i < 10; i += 1) qc.sample(ms, 1000 + b * 10 + i, undefined, adaptiveReadout);
      for (let i = 0; i < 10; i += 1) as.sample(ms);
    }
    expect(qc.preset).toBe('low');
    const blob = storage.data.get('bp.gfx.tier') ?? '';
    const record = JSON.parse(blob) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(['sig', 'tier', 'v', 'verified']);
    expect(loadGfxTierRecord(storage, SIG_A)).toBe('low');
  });
});
