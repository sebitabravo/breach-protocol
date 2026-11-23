/**
 * T5b: registro persistente del nivel gráfico verificado (`bp.gfx.tier`),
 * con firma de GPU y byte de versión. Contratos probados:
 * - `hashGpuSignature` es estable para entrada idéntica y sensible a cada parte.
 * - El registro persiste y se recarga; corrupto, parcial, de versión distinta
 *   o exageradamente grande se descarta sin repararlo ni adivinar.
 * - El arranque parte del medium de hoy; solo un arranque posterior con la misma
 *   firma arranca en el nivel persistido (consumido una vez por carga de página).
 * - La bajada en vivo actualiza el registro; manual no lo toca.
 * - Sin datos de WebGL, sin storage o con storage roto: comportamiento de hoy,
 *   nunca un throw.
 */
import { describe, expect, it } from 'vitest';
import { QualityController, type QualityOptions } from '../../src/core/quality';
import {
  DEFAULT_SETTINGS,
  GFX_TIER_KEY,
  GFX_TIER_VERSION,
  SETTINGS_KEY,
  hashGpuSignature,
  loadGfxTierRecord,
  loadSettings,
  saveGfxTierRecord,
  type StorageLike,
} from '../../src/core/settings';

interface TestStorage extends StorageLike {
  data: Map<string, string>;
  failWrite: boolean;
}

function memStorage(initial: Record<string, string> = {}): TestStorage {
  const data = new Map(Object.entries(initial));
  const state = { failWrite: false };
  return {
    data,
    get failWrite(): boolean {
      return state.failWrite;
    },
    set failWrite(value: boolean) {
      state.failWrite = value;
    },
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (state.failWrite) throw new Error('quota exceeded');
      data.set(key, value);
    },
  };
}

/** Una ventana de `windowSize` = 4 muestras; la última decisión devuelta es la del cambio. */
function feed(qc: QualityController, frameMs: number, now: number) {
  let last = qc.sample(frameMs, now);
  for (let i = 1; i < 4; i += 1) last = qc.sample(frameMs, now);
  return last;
}

/** Opciones de test: ventanas de 4, decisiones por ventana, sin cooldown. */
function controllerOptions(extra: Partial<QualityOptions>): QualityOptions {
  return {
    windowSize: 4,
    windowsToDrop: 1,
    windowsToRaise: 3,
    cooldownMs: 0,
    ...extra,
  };
}

/** Firmas deterministas y distinguibles. */
function sigA(): string {
  return hashGpuSignature(['webgl2', 'acme', 'acme-lobo-xt', '2@1536x864']);
}
function sigB(): string {
  return hashGpuSignature(['webgl2', 'acme', 'murciélago-rtx', '2@1536x864']);
}

describe('hashGpuSignature (firma)', () => {
  it('is stable for identical input', () => {
    const first = hashGpuSignature(['webgl2', 'nvidia', 'rtx 4000', '1@1200x900']);
    const again = hashGpuSignature(['webgl2', 'nvidia', 'rtx 4000', '1@1200x900']);
    expect(again).toBe(first);
  });

  it('changes when any component of the signature changes', () => {
    const base = hashGpuSignature(['webgl2', 'nvidia', 'rtx 4000', '1@1200x900']);
    const variants = [
      hashGpuSignature(['webgl2', 'nvidia', 'rtx 5000', '1@1200x900']), // renderer
      hashGpuSignature(['webgl2', 'apple', 'rtx 4000', '1@1200x900']), // vendor
      hashGpuSignature(['webgl', 'nvidia', 'rtx 4000', '1@1200x900']), // backend
      hashGpuSignature(['webgl2', 'nvidia', 'rtx 4000', '2@1200x900']), // DPR
      hashGpuSignature(['webgl2', 'nvidia', 'rtx 4000', '1@1200x901']), // viewport
    ];
    for (const variant of variants) expect(variant).not.toBe(base);
  });

  it('is a short bounded hash, never the raw strings', () => {
    const hash = hashGpuSignature(['webgl2', 'vendor-string-with-identity-clues', 'device-series-9', '2@1536x864']);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('GfxTierRecord (persistencia bp.gfx.tier)', () => {
  it('round-trips: save then load returns the same tier', () => {
    const storage = memStorage();
    expect(saveGfxTierRecord('high', sigA(), storage)).toBe(true);
    expect(loadGfxTierRecord(storage, sigA())).toBe('high');
    expect(loadGfxTierRecord(storage)).toBe('high');
  });

  it('rejects the record when the signature changes', () => {
    const storage = memStorage();
    saveGfxTierRecord('medium', sigA(), storage);
    expect(loadGfxTierRecord(storage, sigB())).toBe(null);
  });

  it('rejects corrupt JSON instead of throwing', () => {
    const storage = memStorage({ [GFX_TIER_KEY]: '{not valid json!!' });
    expect(loadGfxTierRecord(storage, sigA())).toBe(null);
  });

  it('rejects blobs that are not objects', () => {
    for (const blob of ['null', '[]', '"high"', '42']) {
      const storage = memStorage({ [GFX_TIER_KEY]: blob });
      expect(loadGfxTierRecord(storage, sigA())).toBe(null);
    }
  });

  it('rejects partial records without repairing or guessing', () => {
    const partials = [
      { v: GFX_TIER_VERSION, sig: sigA() }, // sin tier
      { v: GFX_TIER_VERSION, tier: 'high' }, // sin sig
      { sig: sigA(), tier: 'high' }, // sin version
      { v: GFX_TIER_VERSION, sig: '', tier: 'high' }, // sig vacía
      { v: GFX_TIER_VERSION, sig: sigA(), tier: 'ultra' }, // tier inventado
      { v: GFX_TIER_VERSION, sig: sigA(), tier: 'auto' }, // auto no es un nivel verificado
      { v: '1', sig: sigA(), tier: 'high' }, // version como string (mano)
    ];
    for (const partial of partials) {
      const storage = memStorage({ [GFX_TIER_KEY]: JSON.stringify(partial) });
      expect(loadGfxTierRecord(storage, sigA()), JSON.stringify(partial)).toBe(null);
    }
  });

  it('rejects wrong-version records (forward) and migrates legacy version 0', () => {
    const future = memStorage({ [GFX_TIER_KEY]: JSON.stringify({ v: GFX_TIER_VERSION + 1, sig: sigA(), tier: 'high', verified: 1 }) });
    expect(loadGfxTierRecord(future, sigA())).toBe(null);
    const legacy = memStorage({
      [GFX_TIER_KEY]: JSON.stringify({ v: 0, sig: sigA(), tier: 'medium', verified: 1 }),
    });
    expect(loadGfxTierRecord(legacy, sigA())).toBe('medium');
  });

  it('rejects oversized stored strings instead of trusting them', () => {
    const oversized = memStorage({ [GFX_TIER_KEY]: JSON.stringify({ v: GFX_TIER_VERSION, sig: 'a'.repeat(300), tier: 'high', verified: 1 }) });
    expect(loadGfxTierRecord(oversized, 'a'.repeat(300))).toBe(null);
    // y no escribe nada por encima del tope tampoco
    const sink = memStorage();
    expect(saveGfxTierRecord('high', 'a'.repeat(300), sink)).toBe(false);
  });

  it('rejects a non-finite or negative verification timestamp', () => {
    const weird = memStorage({ [GFX_TIER_KEY]: JSON.stringify({ v: GFX_TIER_VERSION, sig: sigA(), tier: 'high', verified: -1 }) });
    expect(loadGfxTierRecord(weird, sigA())).toBe(null);
  });

  it('lives under its own namespace and never disturbs bp.settings', () => {
    const storage = memStorage({ [SETTINGS_KEY]: JSON.stringify(DEFAULT_SETTINGS) });
    saveGfxTierRecord('low', sigA(), storage);
    expect(storage.data.get(GFX_TIER_KEY)).toBeDefined();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('caps the persisted blob length', () => {
    const storage = memStorage();
    saveGfxTierRecord('medium', sigA(), storage);
    const blob = storage.data.get(GFX_TIER_KEY) ?? '';
    expect(blob.length).toBeLessThanOrEqual(200);
  });
});

describe('QualityController + nivel verificado persistido', () => {
  it('first run behaves exactly like today: medium start, identical climb, record written', () => {
    const storage = memStorage();
    const persisting = new QualityController('auto', controllerOptions({
      storage, signature: () => sigA(), applyVerified: true,
    }));
    const today = new QualityController('auto', controllerOptions({ applyVerified: false }));
    expect(persisting.preset).toBe('medium');
    expect(today.preset).toBe('medium');
    // Misma secuencia de frames, misma trayectoria sin caché.
    expect(feed(persisting, 8, 1000)).toEqual(feed(today, 8, 1000));
    expect(feed(persisting, 5, 2000)).toEqual(feed(today, 5, 2000));
    expect(feed(persisting, 5, 3000)).toEqual(feed(today, 5, 3000));
    expect(persisting.preset).toBe('high');
    expect(loadGfxTierRecord(storage, sigA())).toBe('high');
  });

  it('a later boot with the same signature starts at the persisted tier', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const qc = new QualityController('auto', controllerOptions({
      storage, signature: () => sigA(), applyVerified: true,
    }));
    expect(qc.preset).toBe('high');
    // El nivel persistido es un punto de partida: sigue midiendo sin romperse.
    expect(feed(qc, 8, 1000).changed).toBe(false);
  });

  it('a changed signature on boot degrades to today (medium, re-climb)', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const qc = new QualityController('auto', controllerOptions({
      storage, signature: () => sigB(), applyVerified: true,
    }));
    expect(qc.preset).toBe('medium');
  });

  it('the no-WebGL-info fallback behaves exactly like today and never persists', () => {
    const storage = memStorage({ [GFX_TIER_KEY]: JSON.stringify({ v: GFX_TIER_VERSION, sig: sigA(), tier: 'high', verified: 1 }) });
    const qc = new QualityController('auto', controllerOptions({
      storage, signature: () => null, applyVerified: true,
    }));
    expect(qc.preset).toBe('medium');
    expect(feed(qc, 40, 1000)).toMatchObject({ changed: true, preset: 'low' });
    expect(storage.data.get(GFX_TIER_KEY)).toBe(JSON.stringify({ v: GFX_TIER_VERSION, sig: sigA(), tier: 'high', verified: 1 }));
  });

  it('a live downgrade updates the persisted record to what actually held', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const qc = new QualityController('auto', controllerOptions({
      storage, signature: () => sigA(), applyVerified: true,
    }));
    expect(qc.preset).toBe('high');
    expect(feed(qc, 40, 1000)).toMatchObject({ changed: true, preset: 'medium', reason: 'down' });
    expect(loadGfxTierRecord(storage, sigA())).toBe('medium');
  });

  it('manual presets never overwrite the persisted record', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const qc = new QualityController('low', controllerOptions({
      storage, signature: () => sigA(), applyVerified: true,
    }));
    expect(qc.preset).toBe('low');
    expect(feed(qc, 40, 1000).changed).toBe(false);
    expect(feed(qc, 5, 2000).changed).toBe(false);
    expect(loadGfxTierRecord(storage, sigA())).toBe('high');
  });

  it('survives a write failure (quota) and keeps deciding', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    storage.failWrite = true;
    const qc = new QualityController('auto', controllerOptions({
      storage, signature: () => sigA(), applyVerified: true,
    }));
    expect(qc.preset).toBe('high');
    expect(feed(qc, 40, 1000)).toMatchObject({ changed: true, preset: 'medium', reason: 'down' });
  });

  it('the persisted tier is consumed by exactly one constructor per page boot', () => {
    const storage = memStorage();
    saveGfxTierRecord('medium', sigA(), storage);
    // Sin `applyVerified` explícito: la vía de producción (flag por carga de página).
    const first = new QualityController('auto', controllerOptions({ storage, signature: () => sigA() }));
    expect(first.preset).toBe('medium');
    const second = new QualityController('auto', controllerOptions({ storage, signature: () => sigA() }));
    expect(second.preset).toBe('medium');
  });
});
