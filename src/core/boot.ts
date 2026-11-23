/**
 * Gate y resiliencia de arranque (T5c, estudio REA), extraído de game.ts en P5.
 * game.ts orquesta la secuencia de boot; este módulo es dueño de las decisiones
 * puras: capacidades requeridas, umbrales de lentitud/estancamiento, estados
 * forzados por query y proyección del copy de boot.
 */
import { CATALOG, type CatalogKey } from '../i18n/catalog';
import type { Locale } from './settings';

/**
 * Resiliencia de arranque (T5c, estudio REA): gate de capacidades y recuperación
 * de un boot que no termina. Sin user-agent: cada requisito se verifica por
 * capability; la lista sale de lo que el bundle construido llama de verdad en
 * el camino de arranque (ver el comentario de cada API).
 */
export type BootCapability = 'wasm' | 'webgl2' | 'runtime';
export type BootProbes = Record<BootCapability, boolean>;

/** Primer umbral, generoso: un dispositivo lento pero funcional termina debajo
 *  (payload hasta boot ≈ 267 KiB gzip; el arranque medido entero es de segundos:
 *  docs/performance-budget.md). Solo superficie un aviso, nunca corta nada. */
export const BOOT_SLOW_MS = 24_000;
/** Segundo umbral: recién aquí se ofrece Reintentar. Nunca para una carga que
 *  sigue avanzando: triplica el margen del peor network que funcione. */
export const BOOT_STALLED_MS = 60_000;

/** APIs modernas que los chunks construidos invocan en el arranque:
 *  - AbortController: GameApp (controlador del shell) y three (carga de recursos).
 *  - AbortSignal.timeout: wasm/bridge.ts (fetch del núcleo con corte temporal).
 *  - ResizeObserver: ui/objective-marker.ts, instanciado dentro de boot().
 *  - replaceChildren: ui/campaign-view.ts y ui/board-view.ts, via refreshMenu() en boot().
 *  La sintaxis es2022 (vite.config.ts build.target; campos privados #x en el
 *  output) no es detectable en runtime: la cubre el piso declarado abajo. */
export const BOOT_REQUIRED_RUNTIME_APIS = [
  'AbortController',
  'AbortSignal.timeout',
  'ResizeObserver',
  'replaceChildren',
] as const;

/** Piso de compatibilidad declarado: el API más exigente del arranque es
 *  AbortSignal.timeout (Chrome 103, Firefox 100, Safari 16); todo lo demás
 *  (ResizeObserver, replaceChildren, sintaxis es2022 con campos privados) es
 *  más viejo. Solo es texto declarado: la decisión real es la capability. */
export const BOOT_MINIMUM_BROWSERS = [
  { name: 'Chrome', version: 103 },
  { name: 'Firefox', version: 100 },
  { name: 'Safari', version: 16 },
] as const;

/** Verifica por presencia, no por UA. Cada check es detectable sin navegador
 *  completo: `typeof` y un prototype. */
export function probeBootRuntime(): boolean {
  try {
    return (
      typeof AbortController === 'function' &&
      typeof AbortSignal === 'function' &&
      typeof AbortSignal.timeout === 'function' &&
      typeof ResizeObserver === 'function' &&
      typeof Element.prototype.replaceChildren === 'function'
    );
  } catch {
    return false;
  }
}

export function missingCapabilities(probes: BootProbes): BootCapability[] {
  const missing: BootCapability[] = [];
  for (const capability of ['wasm', 'webgl2', 'runtime'] as const) {
    if (!probes[capability]) missing.push(capability);
  }
  return missing;
}

export type BootSlowState = 'in-time' | 'slow' | 'stalled';

/** Estado puro del gate de estancamiento: `slow` superficie el aviso;
 *  recién `stalled` (segundo umbral) ofrece la acción de recuperación. */
export function bootSlowState(
  elapsedMs: number,
  slowMs = BOOT_SLOW_MS,
  stalledMs = BOOT_STALLED_MS,
): BootSlowState {
  if (elapsedMs >= stalledMs) return 'stalled';
  if (elapsedMs >= slowMs) return 'slow';
  return 'in-time';
}

/** Forzar los estados a demanda para verificación, espejo del `?viewmodel` del
 *  renderer: `?boot=slow` y `?boot=unsupported`. Cualquier otro valor es `auto`. */
export function forcedBootState(search: string): 'auto' | 'slow' | 'unsupported' {
  const value = new URLSearchParams(search).get('boot');
  return value === 'slow' || value === 'unsupported' ? value : 'auto';
}

/** Engineering Mode es de desarrollo: entra por bandera de query (`?dev=1`, mismo
 *  mecanismo que `?boot=` y `?viewmodel=`) o por el toggle F3 en partida. Nunca
 *  por el menú de jugador. */
export function devEngineeringRequested(search: string): boolean {
  return new URLSearchParams(search).get('dev') === '1';
}

/** Rótulos de la resiliencia de arranque. La página base va en español (lang="es")
 *  y el único mecanismo de idioma del proyecto es `settings.locale` (es/en).
 *  El copy vive en el catálogo único de i18n; esta ficha es una proyección del
 *  catálogo para el camino de boot (sin segundo origen de verdad). */
export interface BootCopy {
  slow: string;
  unsupportedTitle: string;
  unsupportedBody: string;
  floor: string;
  retry: string;
  items: Record<BootCapability, string>;
}

export function bootCopy(locale: Locale): BootCopy {
  const pick = (key: CatalogKey): string => CATALOG[locale][key];
  return {
    slow: pick('boot.slow'),
    unsupportedTitle: pick('boot.unsupportedTitle'),
    unsupportedBody: pick('boot.unsupportedBody'),
    floor: pick('boot.floor'),
    retry: pick('boot.retry'),
    items: {
      wasm: pick('boot.itemsWasm'),
      webgl2: pick('boot.itemsWebgl2'),
      runtime: pick('boot.itemsRuntimeFmt').replace('{apis}', BOOT_REQUIRED_RUNTIME_APIS.join(', ')),
    },
  };
}
