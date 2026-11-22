import { describe, expect, it } from 'vitest';
import {
  BOOT_REQUIRED_RUNTIME_APIS,
  BOOT_STALLED_MS,
  BOOT_SLOW_MS,
  bootCopy,
  bootSlowState,
  forcedBootState,
  missingCapabilities,
  type BootCapability,
  type BootCopy,
  type BootProbes,
} from '../../src/core/game';

const allOk: BootProbes = { wasm: true, webgl2: true, runtime: true };

describe('missingCapabilities (unsupported gate)', () => {
  it('reports nothing when every capability is present', () => {
    expect(missingCapabilities(allOk)).toEqual([]);
  });

  it('names exactly the capability that is missing', () => {
    expect(missingCapabilities({ ...allOk, webgl2: false })).toEqual(['webgl2']);
    expect(missingCapabilities({ ...allOk, wasm: false })).toEqual(['wasm']);
    expect(missingCapabilities({ ...allOk, runtime: false })).toEqual(['runtime']);
  });

  it('lists every missing capability in probe order', () => {
    expect(missingCapabilities({ wasm: false, webgl2: false, runtime: false })).toEqual([
      'wasm',
      'webgl2',
      'runtime',
    ]);
  });
});

describe('runtime capability list matches what the built bundle calls', () => {
  it('covers each modern API the boot path actually invokes', () => {
    for (const api of ['AbortController', 'AbortSignal.timeout', 'ResizeObserver', 'replaceChildren']) {
      expect(BOOT_REQUIRED_RUNTIME_APIS).toContain(api);
    }
  });
});

describe('bootSlowState (stall gate)', () => {
  it('stays in-time before the first threshold', () => {
    expect(bootSlowState(0)).toBe('in-time');
    expect(bootSlowState(BOOT_SLOW_MS - 1)).toBe('in-time');
  });

  it('surfaces the slow state at the first threshold and before the second', () => {
    expect(bootSlowState(BOOT_SLOW_MS)).toBe('slow');
    expect(bootSlowState(BOOT_SLOW_MS + 1000)).toBe('slow');
    expect(bootSlowState(BOOT_STALLED_MS - 1)).toBe('slow');
  });

  it('offers the recovery action only at the second threshold', () => {
    expect(bootSlowState(BOOT_STALLED_MS)).toBe('stalled');
    expect(bootSlowState(BOOT_STALLED_MS + 60_000)).toBe('stalled');
    expect(BOOT_STALLED_MS).toBeGreaterThan(BOOT_SLOW_MS);
    expect(bootCopy('es').retry.length).toBeGreaterThan(0);
  });

  it('accepts explicit thresholds so callers can override the defaults', () => {
    expect(bootSlowState(2_000, 1_000, 5_000)).toBe('slow');
    expect(bootSlowState(5_000, 1_000, 5_000)).toBe('stalled');
  });
});

describe('a normal boot never trips either gate', () => {
  it('keeps every measured boot milestone in-time', () => {
    // Medianas medidas en docs/performance-budget.md (primer paint → primer juego
    // jugable: 3 399 ms en localhost; un instrumento lento pero funcional sigue bajo 24 s).
    const normalBootMilestones = [0, 36, 575, 327, 3_399, 8_000, 20_000];
    for (const elapsedMs of normalBootMilestones) {
      expect(bootSlowState(elapsedMs)).toBe('in-time');
    }
  });
});

describe('forcedBootState (query-param diagnostics)', () => {
  it('forces each state by name and stays auto otherwise', () => {
    expect(forcedBootState('?boot=slow')).toBe('slow');
    expect(forcedBootState('?boot=unsupported')).toBe('unsupported');
    expect(forcedBootState('')).toBe('auto');
    expect(forcedBootState('?gfx=webgl')).toBe('auto');
    expect(forcedBootState('?boot=SLOW')).toBe('auto');
    expect(forcedBootState('?boot=nope')).toBe('auto');
    expect(forcedBootState('?boot=unsupported&gfx=webgl')).toBe('unsupported');
  });
});

describe('bootCopy keeps to the single locale mechanism (settings.locale)', () => {
  it('provides the same strings for both supported locales', () => {
    const es = bootCopy('es');
    const en = bootCopy('en');
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
    expect(Object.keys(en.items).sort()).toEqual(Object.keys(es.items).sort());
    for (const key of Object.keys(es) as (keyof BootCopy)[]) {
      if (key === 'items') continue;
      expect(typeof en[key]).toBe('string');
      expect(typeof es[key]).toBe('string');
    }
    for (const key of Object.keys(es.items) as BootCapability[]) {
      expect(typeof en.items[key]).toBe('string');
    }
  });
});
