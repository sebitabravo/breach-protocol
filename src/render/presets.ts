/**
 * Presets de calidad del renderer. El controlador de calidad (core/quality.ts)
 * decide cuál aplicar; acá solo se traducen a DPR, sombras y presupuesto de FX.
 */
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

/** DPR efectivo: el menor entre el del preset, el tope del dispositivo, el real y el que cabe en el presupuesto. */
export function playPixelRatio(
  preset: QualityPreset,
  cssWidth: number,
  cssHeight: number,
  dprCap: number,
  deviceDpr: number,
): number {
  const area = Math.max(1, cssWidth * cssHeight);
  return Math.min(preset.dpr, dprCap, deviceDpr, Math.sqrt(PLAY_PIXEL_BUDGET[preset.name] / area));
}
