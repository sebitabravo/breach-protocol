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
