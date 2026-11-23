/**
 * Presets de calidad del renderer. El controlador de calidad (core/quality.ts)
 * decide cuál aplicar; acá solo se traducen a DPR, sombras y presupuesto de FX.
 */
import { GFX_EFFECTS, GFX_KEYS, type GfxKey, type GfxOverride } from '../core/settings';
export type QualityName = 'low' | 'medium' | 'high';

export interface QualityPreset {
  name: QualityName;
  dpr: number;
  shadows: boolean;
  particles: number;
  lights: number;
}

export const PRESETS: Record<QualityName, QualityPreset> = {
  low: { name: 'low', dpr: 1, shadows: false, particles: 128, lights: 2 },
  medium: { name: 'medium', dpr: 1.5, shadows: true, particles: 512, lights: 2 },
  high: { name: 'high', dpr: 2, shadows: true, particles: 1024, lights: 2 },
};

/**
 * Presupuesto de píxeles del drawing buffer por preset. `high` también tiene tope: sin él, un
 * 1600×900 a DPR 2 (5.76 MP con composer HalfFloat 4× MSAA, ~264 MB estimados) caía a ~45 fps
 * en un M3 (docs/PERFORMANCE_REPORT.md); con 3.5 MP sostiene 60 fps sin diferencia visible.
 */
export const PLAY_PIXEL_BUDGET: Record<QualityName, number> = { low: 154_000, medium: 540_000, high: 3_500_000 };

/**
 * Tope duro de seguridad del factor adaptativo (T5b). El controlador de escala
 * (core/quality.ts) trabaja entre su propio piso (0.5) y 1; este límite existe
 * para que NINGÚN valor hostil inyectado por fuera pueda subir el costo por
 * encima del presupuesto del preset ni recortar por debajo de un 25%
 * (recorte de emergencia, ilegible de todos modos).
 */
export const MIN_RENDER_SCALE = 0.25;

/**
 * DPR efectivo: el menor entre el del preset, el tope del dispositivo, el real y el que cabe en el
 * presupuesto — multiplicado por el factor adaptativo de resolución (`scale`, recorte continuo bajo
 * carga, T5b). El factor es SIEMPRE ≤ 1 y se multiplica al final: el presupuesto y el preset siguen
 * siendo el techo duro, la escala solo puede reducir el costo por debajo de ellos, nunca subirlo.
 */
export function playPixelRatio(
  preset: QualityPreset,
  cssWidth: number,
  cssHeight: number,
  dprCap: number,
  deviceDpr: number,
  scale = 1,
): number {
  const area = Math.max(1, cssWidth * cssHeight);
  const s = Number.isFinite(scale) ? Math.min(1, Math.max(MIN_RENDER_SCALE, scale)) : 1;
  return Math.min(preset.dpr, dprCap, deviceDpr, Math.sqrt(PLAY_PIXEL_BUDGET[preset.name] / area)) * s;
}

/** Plan de efectos visibles, ya resuelto contra el preset. La forma deriva de
 * GFX_KEYS en core/settings.ts (`gfxBloom` → `bloom`); los nombres nunca se
 * repiten acá como unión de literales. */
type StripGfx<Key extends string> = Key extends `gfx${infer Effect}` ? Uncapitalize<Effect> : Key;
export type GfxPlan = { [Key in GfxKey as StripGfx<Key>]: boolean };

/** Regla `auto` de cada efecto (T5a), en el mismo orden que GFX_KEYS: la única
 * lista de claves vive en core/settings.ts. */
const AUTO_BY_KEY: Record<GfxKey, (preset: QualityPreset) => boolean> = {
  gfxBloom: (preset) => preset.name !== 'low',
  gfxShadows: (preset) => preset.shadows,
  gfxEnvironment: () => true,
  gfxLights: () => true,
  gfxMist: () => true,
};

/**
 * Resuelve los cinco overrides `auto|on|off` del jugador contra la derivación
 * propia de cada preset (T5a). `auto` = comportamiento previo al cambio.
 *
 * Lo único que cada preset decide hoy: bloom (medio y alto, ADR 0004) y
 * sombras. El entorno PMREM, las luces prácticas y la malla de atmósfera
 * están activos en todos los presets, así que su `auto` es simplemente activo.
 * El presupuesto de píxeles, el tope de DPR, el MSAA y el tamaño del shadow map
 * siguen siendo del preset y NO pasan por acá.
 */
export function resolveGfxPlan(
  preset: QualityPreset,
  gfx: Record<GfxKey, GfxOverride>,
): GfxPlan {
  const pick = (state: GfxOverride, auto: boolean): boolean => (state === 'auto' ? auto : state === 'on');
  const plan = {} as Record<string, boolean>;
  GFX_KEYS.forEach((key, i) => {
    plan[GFX_EFFECTS[i]] = pick(gfx[key], AUTO_BY_KEY[key](preset));
  });
  return plan as GfxPlan;
}
