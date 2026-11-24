/**
 * Paleta y materiales del look de control (S01) y el look por tema de sector.
 * Cada entrada de PALETTE es el albedo que alimenta la iluminación para que el
 * píxel sRGB final caiga en los tokens de composición. Los temas (`ThemeLook`)
 * solo cambian luces, niebla, color de tiras emisivas y tinte de paredes; el
 * albedo de cada material queda igual en los tres sectores.
 */
import { rgbOf, STATE_COLORS } from './palette';
import type { Material } from '../world/layout';
import type { ThemeName } from '../world/map';

/** Hex del dueño (src/render/palette.ts, espejo de tokens.css) → valor numérico
 * para THREE. Misma conversión que hacía el literal; sin cambio de color. */
const asRgb = (hex: string): number => {
  const [r, g, b] = rgbOf(hex);
  return (r << 16) | (g << 8) | b;
};

/** Material albedos; evaluate the rendered ladder after ACES (art-direction.md).
 * Los colores compartidos con la interfaz/canvas derivan de STATE_COLORS. */
export const PALETTE = {
  bg: 0x070d12, // sky / background above the walls
  floor: 0x28363e,
  wall: 0x768994,
  cover: 0x9a9e9d,
  crate: 0x8599a0,
  pillar: 0x85949a,
  trim: 0x657682,
  beam: 0x27333b,
  ceiling: 0x394249,
  glow: asRgb(STATE_COLORS.ok), // mint accent (unlit basic material)
  sun: 0xe6ecf2,
  fill: 0x9fb0bd,
  hemiSky: 0xdfe4e8,
  hemiGround: 0x2a3036,
  impactWall: 0x96aaba,
  impactEnemy: asRgb(STATE_COLORS.danger),
  death: asRgb(STATE_COLORS.ok),
} as const;

export const MATERIAL_COLORS: Record<Material, number> = {
  floor: PALETTE.floor,
  wall: PALETTE.wall,
  cover: PALETTE.cover,
  crate: PALETTE.crate,
  pillar: PALETTE.pillar,
  trim: PALETTE.trim,
  beam: PALETTE.beam,
  ceiling: PALETTE.ceiling,
  glow: PALETTE.glow,
  rack: 0x1d2630,
  deck: 0x3b4a56,
};

/** Parámetros de iluminación, niebla y emisivos de un tema de sector. */
export interface ThemeLook {
  background: number;
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sun: number;
  sunIntensity: number;
  fill: number;
  /** Tira de techo principal y su alterna (cryo: vapor blanco). HDR > 1 entra al bloom. */
  strip: number;
  stripAlt: number;
  stripIntensity: number;
  /** Charcos de luz en el piso bajo cada luminaria. */
  pool: number;
  poolIntensity: number;
  /** Terminales, LEDs y tapas de nodos. */
  accent: number;
  accentIntensity: number;
  /** Color del estarcido SECTOR 0X. */
  stencil: number;
  /** Multiplicador de albedo de paredes y tapas (1 = tal cual). */
  wallTint: number;
}

const CONTROL: ThemeLook = {
  background: PALETTE.bg,
  fogColor: 0x19313c,
  fogDensity: 0.019,
  hemiSky: 0xc6e2f1,
  hemiGround: 0x8c7464,
  hemiIntensity: 0.98,
  sun: 0xc3e9fb,
  sunIntensity: 2.32,
  fill: 0xcdb19b,
  strip: 0x89e9ff,
  stripAlt: 0xb3f6ff,
  stripIntensity: 3.15,
  pool: 0x8adfff,
  poolIntensity: 0.23,
  accent: PALETTE.glow,
  accentIntensity: 2.05,
  stencil: 0xd1cdc0,
  wallTint: 0xffffff,
};

export const THEME_LOOKS: Record<ThemeName, ThemeLook> = {
  control: CONTROL,
  // frío: cian hielo, tiras de vapor blanco alternadas, niebla más densa
  cryo: {
    ...CONTROL,
    background: 0x061018,
    fogColor: 0x0a1a24,
    fogDensity: 0.024,
    hemiSky: 0xcfeaf6,
    hemiGround: 0x1f2b33,
    hemiIntensity: 1.07,
    sun: 0xe8f6ff,
    sunIntensity: 3.0,
    fill: 0x8fc2d6,
    strip: 0x7fe8ff,
    stripAlt: 0xf0fbff,
    stripIntensity: 2.9,
    pool: 0x7fe8ff,
    poolIntensity: 0.22,
    accent: 0x7fe8ff,
    accentIntensity: 1.5,
    stencil: 0xa9d8e8,
    wallTint: 0xe6f0f6,
  },
  // cálido: lámparas ámbar, terminales teal, paredes con tinte cálido leve
  archive: {
    ...CONTROL,
    background: 0x0b0806,
    fogColor: 0x140e09,
    fogDensity: 0.014,
    hemiSky: 0xf0dcc4,
    hemiGround: 0x2c2620,
    hemiIntensity: 1.08,
    sun: 0xffe2bd,
    sunIntensity: 3.0,
    fill: 0xa3896a,
    strip: 0xffa640,
    stripAlt: 0xffb860,
    stripIntensity: 3.4,
    pool: 0xffa640,
    poolIntensity: 0.24,
    accent: 0x4de3c6,
    accentIntensity: 1.7,
    stencil: 0xd9c7a8,
    wallTint: 0xf2ebe2,
  },
};

export function lookFor(theme: ThemeName): ThemeLook {
  return THEME_LOOKS[theme] ?? CONTROL;
}
