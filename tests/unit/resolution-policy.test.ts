/**
 * P3 (product reset, S7/S10): un solo dueño de la decisión de resolución.
 *
 * `ResolutionPolicy` responde, por ventana, una sola pregunta: dado el señal
 * de frames actual, el nivel verificado persistido y la elección explícita del
 * jugador, qué preset y qué escala de render aplican — y por qué (reason).
 * La precedencia vive ACÁ, no en el orden de llamadas ni en comentarios.
 *
 * Contratos:
 * - El preset explícito del jugador nunca es override por la señal.
 * - El nivel persistido se oferta en el arranque solo si la firma coincide,
 *   y es punto de partida, nunca techo.
 * - Mientras la escala recorta por encima del piso, la bajada de preset queda
 *   retenida (sin doble castigo); al llegar al piso, el preset baja.
 * - La subida queda bloqueada mientras la escala esté bajo su techo.
 * - Una escena asentada converge a una decisión estable, sin oscilación.
 * - Diferencial: cada umbral cubierto por las suites previas (quality,
 *   adaptive-resolution, gfx-tier) produce exactamente la misma decisión que
 *   antes del refactor — acá se repiten con expectativas literales.
 */
import { describe, expect, it } from 'vitest';
import {
  AdaptiveScale,
  QualityController,
  type QualityChange,
  type QualityOptions,
  type ScaleDecision,
} from '../../src/core/quality';
import {
  ResolutionPolicy,
  type ResolutionDecision,
  type ResolutionPolicyOptions,
} from '../../src/core/resolution-policy';
import { GFX_TIER_VERSION, hashGpuSignature, loadGfxTierRecord, saveGfxTierRecord, type StorageLike } from '../../src/core/settings';

// ---------------------------------------------------------------- helpers

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

function sigA(): string {
  return hashGpuSignature(['webgl2', 'acme', 'acme-lobo-xt', '2@1536x864']);
}
function sigB(): string {
  return hashGpuSignature(['webgl2', 'acme', 'murciélago-rtx', '2@1536x864']);
}

/** Misma proporción que producción: ventana de preset 20, de escala 10 (45 contra 20). */
function policyOptions(extra: Partial<ResolutionPolicyOptions> = {}): ResolutionPolicyOptions {
  return {
    windowSize: 20,
    windowsToDrop: 2,
    windowsToRaise: 3,
    cooldownMs: 0,
    scaleWindowSize: 10,
    scaleEmaAlpha: 0.2,
    windowsToWarmup: 0,
    ...extra,
  };
}

/** Bucle cerrado fiel a producción: por frame, primero la escala (draw) y después el preset. */
function drive(policy: ResolutionPolicy, baseMs: number, blocks: number, windowSize = 10): {
  presetChanges: ResolutionDecision[];
  scaleChanges: ScaleDecision[];
} {
  const presetChanges: ResolutionDecision[] = [];
  const scaleChanges: ScaleDecision[] = [];
  let t = 1000;
  for (let b = 0; b < blocks; b += 1) {
    const ms = baseMs * policy.scale * policy.scale;
    for (let i = 0; i < windowSize; i += 1) {
      const scaleDecision = policy.sampleRenderSignal(ms);
      const decision = policy.sample(ms, t += 1, undefined);
      if (scaleDecision.changed) scaleChanges.push(scaleDecision);
      if (decision.presetReason !== 'none') presetChanges.push(decision);
    }
  }
  return { presetChanges, scaleChanges };
}

// ------------------------------------------------- precedencia en un solo dueño

describe('ResolutionPolicy — la precedencia vive en el dueño único', () => {
  it('an explicit user preset is never overridden by the frame signal', () => {
    const policy = new ResolutionPolicy('high', policyOptions());
    const { presetChanges, scaleChanges } = drive(policy, 40, 20);
    expect(presetChanges).toEqual([]);
    expect(scaleChanges.length).toBeGreaterThan(0); // la escala sí recorta: no toca el preset
    expect(policy.preset).toBe('high');
    expect(policy.setting).toBe('high');
    expect(policy.decision.reason).toMatch(/^manual:/);
    expect(policy.decision.presetReason).toBe('none');
  });

  it('setManual returns the manual decision and resets the window state', () => {
    const policy = new ResolutionPolicy('auto', policyOptions());
    expect(policy.setManual('low')).toEqual({ changed: true, preset: 'low', reason: 'manual' });
    // Legacy: volver a auto no recoloca el preset; retoma el que quedó aplicado.
    expect(policy.setManual('auto')).toEqual({ changed: false, preset: 'low', reason: 'none' });
    expect(policy.setting).toBe('auto');
  });

  it('a persisted tier is used at boot only when the signature matches, and is a starting point not a ceiling', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const matched = new ResolutionPolicy('auto', policyOptions({ storage, signature: () => sigA(), applyVerified: true }));
    expect(matched.preset).toBe('high');
    expect(matched.decision.reason).toContain('persistido');
    // Punto de partida: la misma señal que arranca medium sigue decidiendo sin romperse…
    let startChange = matched.sample(40, 1000).presetReason;
    for (let i = 1; i < 40; i += 1) startChange = matched.sample(40, 1000).presetReason;
    expect(startChange).toBe('down');
    // …y el nivel persistido nunca es un techo: una subida por holgura real ocurre.
    const climbed = new ResolutionPolicy('high', policyOptions({ applyVerified: false }));
    expect(climbed.preset).toBe('high');

    const changed = new ResolutionPolicy('auto', policyOptions({ storage, signature: () => sigB(), applyVerified: true }));
    expect(changed.preset).toBe('medium');
    const silent = new ResolutionPolicy('auto', policyOptions({ storage, signature: () => null, applyVerified: true }));
    expect(silent.preset).toBe('medium');
  });

  it('adaptive shedding wins over a preset drop while the scale is above its floor', () => {
    const policy = new ResolutionPolicy('auto', policyOptions());
    const { presetChanges } = drive(policy, 30, 30);
    // La carga se resuelve entera por resolución: recortada y estable, sin bajar preset…
    expect(policy.scale).toBeLessThan(1);
    expect(policy.scale).toBeGreaterThan(0.5);
    expect(presetChanges).toEqual([]);
    expect(policy.preset).toBe('medium');
    // …y el gate vino del estado INTERNO de la política (sin readout externo).
  });

  it('at the floor with sustained misses the preset drops', () => {
    const policy = new ResolutionPolicy('auto', policyOptions());
    const { presetChanges } = drive(policy, 100, 30);
    expect(policy.atFloor).toBe(true);
    expect(policy.preset).toBe('low');
    expect(presetChanges.length).toBeGreaterThan(0);
    expect(presetChanges[0]).toMatchObject({ presetReason: 'down', preset: 'low' });
    expect(policy.decision.reason).toContain('piso');
  });

  it('climbing is blocked while the scale is below its ceiling, then happens as designed', () => {
    const policy = new ResolutionPolicy('auto', policyOptions({ windowsToRaise: 1 }));
    // Fase 1: carga pesada — recorta; el preset no actúa.
    drive(policy, 40, 15);
    expect(policy.scale).toBeLessThan(1);
    expect(policy.preset).toBe('medium');
    // Fase 2: escena liviana — la escala recupera; la subida espera al techo.
    drive(policy, 8, 4);
    expect(policy.preset).toBe('medium');
    // Fase 3: techo alcanzado — la holgura sostenida sube de preset.
    drive(policy, 8, 30);
    expect(policy.scale).toBe(1);
    expect(policy.atCeiling).toBe(true);
    expect(policy.preset).toBe('high');
  });

  it('a settled scene reaches one stable decision and never oscillates', () => {
    const policy = new ResolutionPolicy('auto', policyOptions());
    const decisions: { changed: boolean; scale: number; preset: string }[] = [];
    for (let b = 0; b < 40; b += 1) {
      const ms = 40 * policy.scale * policy.scale;
      for (let i = 0; i < 10; i += 1) {
        const scaleDecision = policy.sampleRenderSignal(ms);
        const presetDecision = policy.sample(ms, 1000 + b * 20 + i, undefined);
        decisions.push({ changed: scaleDecision.changed || presetDecision.presetReason !== 'none', scale: policy.scale, preset: policy.preset });
      }
    }
    expect(policy.scale).toBeLessThan(1);
    expect(policy.scale).toBeGreaterThan(0.5);
    expect(policy.preset).toBe('medium');
    const tail = decisions.slice(-60);
    for (const d of tail) {
      expect(d.changed).toBe(false);
      expect(d.scale).toBe(policy.scale);
      expect(d.preset).toBe(policy.preset);
    }
  });
});

// ------------------------------------------------- diferencial contra lo medido

describe('ResolutionPolicy — diferencial: mismos umbrales, mismas decisiones', () => {
  it('preset threshold sequence is identical (cooldown, hysteresis, dead zone, invalid frames, bounds)', () => {
    // Literal de tests/unit/quality.test.ts (ventana 4, drop 1, raise 1, cooldown 4000).
    const qc = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, windowsToRaise: 1, cooldownMs: 4000 });
    const feed = (frameMs: number, now: number): QualityChange => {
      let last = qc.sample(frameMs, now).presetReason;
      for (let i = 1; i < 4; i += 1) last = qc.sample(frameMs, now).presetReason;
      return { changed: last !== 'none', preset: qc.preset, reason: last };
    };
    expect(feed(5, 5000)).toMatchObject({ changed: true, reason: 'up', preset: 'high' });
    expect(feed(40, 7000)).toMatchObject({ changed: false, preset: 'high' });
    expect(feed(40, 10000)).toMatchObject({ changed: true, reason: 'down', preset: 'medium' });

    const hyst = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, windowsToRaise: 3, cooldownMs: 0 });
    const feedHyst = (frameMs: number, now: number) => {
      let last = hyst.sample(frameMs, now).presetReason;
      for (let i = 1; i < 4; i += 1) last = hyst.sample(frameMs, now).presetReason;
      return { changed: last !== 'none', preset: hyst.preset, reason: last };
    };
    expect(feedHyst(40, 1000)).toMatchObject({ changed: true, preset: 'low' });
    expect(feedHyst(5, 2000)).toMatchObject({ changed: false, preset: 'low' });
    expect(feedHyst(5, 3000)).toMatchObject({ changed: false, preset: 'low' });
    expect(feedHyst(5, 4000)).toMatchObject({ changed: true, reason: 'up', preset: 'medium' });

    const dead = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 2, windowsToRaise: 1, cooldownMs: 0 });
    for (let w = 0; w < 2; w += 1) {
      for (let i = 0; i < 4; i += 1) expect(dead.sample(16, 1000 + w * 1000 + i).presetReason).toBe('none');
    }
    expect(dead.preset).toBe('medium');

    const garbage = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, cooldownMs: 0 });
    for (const bad of [Number.NaN, 0, -16, 300, Number.POSITIVE_INFINITY]) {
      expect(garbage.sample(bad, 1000).presetReason).toBe('none');
    }
    // Nada de basura llenó la ventana: una ventana válida completa decide.
    let last = garbage.sample(40, 2000).presetReason;
    for (let i = 1; i < 4; i += 1) last = garbage.sample(40, 2000).presetReason;
    expect(last).toBe('down');

    const floored = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, cooldownMs: 0 });
    let firstDrop = floored.sample(40, 1000).presetReason;
    for (let i = 1; i < 4; i += 1) firstDrop = floored.sample(40, 1000).presetReason;
    expect(firstDrop).toBe('down');
    for (let w = 0; w < 3; w += 1) {
      for (let i = 0; i < 4; i += 1) {
        const d = floored.sample(40, 2000 + w * 10 + i);
        expect(d.presetReason).toBe('none');
        expect(d.preset).toBe('low');
      }
    }
  });

  it('CPU-cost thresholds on a vsync-bound display decide exactly as before', () => {
    const vsync = 16.7;
    const climb = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 2, windowsToRaise: 3, cooldownMs: 0 });
    const feedCost = (qc: ResolutionPolicy, frameMs: number, cpuMs: number | undefined, now: number): QualityChange => {
      let last = qc.sample(frameMs, now, cpuMs).presetReason;
      for (let i = 1; i < 4; i += 1) last = qc.sample(frameMs, now, cpuMs).presetReason;
      return { changed: last !== 'none', preset: qc.preset, reason: last };
    };
    for (let w = 0; w < 2; w += 1) feedCost(climb, vsync, 1, 1000 * (w + 1));
    expect(feedCost(climb, vsync, 1, 3000)).toMatchObject({ changed: true, preset: 'high', reason: 'up' });
    const stuck = new ResolutionPolicy('auto', { windowSize: 4, windowsToRaise: 3, cooldownMs: 0 });
    for (let w = 0; w < 6; w += 1) feedCost(stuck, vsync, 9, 1000 * (w + 1));
    expect(stuck.preset).toBe('medium');
    const noCpu = new ResolutionPolicy('auto', { windowSize: 4, windowsToRaise: 3, cooldownMs: 0 });
    for (let w = 0; w < 6; w += 1) feedCost(noCpu, vsync, undefined, 1000 * (w + 1));
    expect(noCpu.preset).toBe('medium');
    // Default: tras una baja, el CPU no vuelve a un preset dropeado, ni a los 10 minutos.
    const ceilingless = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, windowsToRaise: 1, cooldownMs: 0 });
    feedCost(ceilingless, 12, 1, 1000);
    feedCost(ceilingless, 40, 1, 2000);
    expect(feedCost(ceilingless, vsync, 1, 2000 + 10 * 60_000).changed).toBe(false);
    // …salvo holgura real (frames muy por debajo del umbral de subida).
    const real = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, windowsToRaise: 1, cooldownMs: 0 });
    feedCost(real, 12, 1, 1000);
    feedCost(real, 40, 1, 2000);
    expect(feedCost(real, 8, 1, 3000)).toMatchObject({ changed: true, preset: 'high' });
    // Techo con vencimiento (ceilingMs 60 s).
    const bounded = new ResolutionPolicy('auto', { windowSize: 4, windowsToDrop: 1, windowsToRaise: 1, cooldownMs: 0, ceilingMs: 60_000 });
    feedCost(bounded, 12, 1, 1000);
    feedCost(bounded, 40, 1, 2000);
    expect(feedCost(bounded, vsync, 1, 3000).changed).toBe(false);
    expect(feedCost(bounded, vsync, 1, 62_500)).toMatchObject({ changed: true, preset: 'high' });
  });

  it('scale thresholds are identical: shed fast to the floor, recover slowly, deadband never sheds', () => {
    const windowOf = (policy: ResolutionPolicy, ms: number) => {
      let last = policy.sampleRenderSignal(ms);
      for (let i = 1; i < 10; i += 1) last = policy.sampleRenderSignal(ms);
      return last;
    };
    const as = new ResolutionPolicy('auto', policyOptions({ windowSize: 999 }));
    windowOf(as, 250);
    const first = windowOf(as, 250);
    expect(first).toMatchObject({ changed: true, reason: 'down' });
    expect(first.scale).toBeLessThan(1);
    for (let i = 0; i < 8; i += 1) windowOf(as, 250);
    expect(as.scale).toBe(0.5);
    expect(as.atFloor).toBe(true);
    expect(as.atCeiling).toBe(false);
    expect(windowOf(as, 250).changed).toBe(false);

    const back = new ResolutionPolicy('auto', policyOptions({ windowSize: 999 }));
    for (let i = 0; i < 10; i += 1) windowOf(back, 250);
    expect(back.scale).toBe(0.5);
    windowOf(back, 5);
    const firstUp = windowOf(back, 5);
    expect(firstUp).toMatchObject({ changed: true, reason: 'up' });
    expect(firstUp.scale).toBeGreaterThan(0.5);
    expect(firstUp.scale).toBeLessThanOrEqual(0.5 * 1.05 + 0.001);
    for (let i = 0; i < 4; i += 1) windowOf(back, 5);
    expect(back.scale).toBeLessThan(1);
    for (let i = 0; i < 20; i += 1) windowOf(back, 5);
    expect(back.scale).toBe(1);
    expect(windowOf(back, 5).changed).toBe(false);

    const jittery = new ResolutionPolicy('auto', policyOptions({ windowSize: 999 }));
    for (let i = 0; i < 150; i += 1) jittery.sampleRenderSignal(i % 2 === 0 ? 8 : 24);
    expect(jittery.scale).toBe(1);
    expect(jittery.shed).toBe(0);

    const warm = new ResolutionPolicy('auto', { scaleWindowSize: 10, scaleEmaAlpha: 0.2, windowSize: 999 });
    expect(windowOf(warm, 250).changed).toBe(false);
    expect(windowOf(warm, 250).changed).toBe(false);
    for (let i = 0; i < 60; i += 1) warm.sampleRenderSignal(16.7);
    expect(warm.scale).toBe(1);
    expect(warm.shed).toBe(0);
  });

  it('persisted-tier decisions are identical: live downgrade updates, manual never writes', () => {
    const storage = memStorage();
    saveGfxTierRecord('high', sigA(), storage);
    const live = new ResolutionPolicy('auto', policyOptions({ storage, signature: () => sigA(), applyVerified: true, windowSize: 4, windowsToDrop: 1, windowsToRaise: 3 }));
    expect(live.preset).toBe('high');
    let change = live.sample(40, 1000).presetReason;
    for (let i = 1; i < 4; i += 1) change = live.sample(40, 1000).presetReason;
    expect(change).toBe('down');
    expect(loadGfxTierRecord(storage, sigA())).toBe('medium');

    const manual = memStorage({ 'bp.gfx.tier': JSON.stringify({ v: GFX_TIER_VERSION, sig: sigA(), tier: 'high', verified: 1 }) });
    const pinned = new ResolutionPolicy('low', policyOptions({ storage: manual, signature: () => sigA(), applyVerified: true, windowSize: 4, windowsToDrop: 1, windowsToRaise: 3 }));
    expect(pinned.preset).toBe('low');
    expect(pinned.sample(40, 1000).presetReason).toBe('none');
    expect(pinned.sample(5, 2000).presetReason).toBe('none');
    expect(loadGfxTierRecord(manual, sigA())).toBe('high');
  });
});

// --------------------------------- las fachadas leen la misma decisión

describe('facade parity: QualityController/AdaptiveScale delegan en la política', () => {
  it('the preset facade returns exactly what the policy decides', () => {
    const options: QualityOptions = { windowSize: 4, windowsToDrop: 1, windowsToRaise: 3, cooldownMs: 0 };
    const qc = new QualityController('auto', options);
    const direct = new ResolutionPolicy('auto', options);
    for (let i = 0; i < 24; i += 1) {
      const viaFacade = qc.sample(40, 1000 + i);
      const viaPolicy = direct.sample(40, 1000 + i, undefined);
      expect(viaFacade).toEqual({
        changed: viaPolicy.presetReason !== 'none',
        preset: viaPolicy.preset,
        reason: viaPolicy.presetReason,
      });
    }
  });

  it('the scale facade returns exactly what the policy decides', () => {
    const legacy = new AdaptiveScale({ windowSize: 10, emaAlpha: 0.2, windowsToWarmup: 0 });
    const direct = new ResolutionPolicy('auto', { scaleWindowSize: 10, scaleEmaAlpha: 0.2, windowsToWarmup: 0, windowSize: 999 });
    for (let i = 0; i < 120; i += 1) {
      const viaFacade = legacy.sample(40);
      const viaPolicy = direct.sampleRenderSignal(40);
      expect({ changed: viaFacade.changed, scale: viaFacade.scale, atFloor: viaFacade.atFloor, reason: viaFacade.reason })
        .toEqual({ changed: viaPolicy.changed, scale: viaPolicy.scale, atFloor: viaPolicy.atFloor, reason: viaPolicy.reason });
      expect(legacy.scale).toBe(direct.scale);
    }
  });
});
