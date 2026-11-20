/**
 * Paleta y materiales del look de control (S01) y el look por tema de sector.
 * Cada entrada de PALETTE es el albedo que alimenta la iluminación para que el
 * píxel sRGB final caiga en los tokens de composición. Los temas (`ThemeLook`)
 * solo cambian luces, niebla, color de tiras emisivas y tinte de paredes; el
 * albedo de cada material queda igual en los tres sectores.
 */
import type { Material } from '../world/layout';
import type { ThemeName } from '../world/map';

/** Ladder palette: each entry is the albedo fed to the lighting rig so the
 * FINAL sRGB pixel lands on the composition targets (measured from frames):
 * floor ≈ #10171d (clearly darker than walls), walls ≈ #1e2833, cover ≈
 * #2a3844, ceiling ≈ #0c1216. Value steps between surfaces do the reading. */
export const PALETTE = {
  bg: 0x070d12, // sky / background above the walls
  floor: 0x0e161b, // × grid map (base 0.83) × light → ≈ #10171d
  wall: 0x242d36, // → ≈ #1e2833
  cover: 0x32404b, // → ≈ #2a3844, one step above walls
  crate: 0x2c3944,
  pillar: 0x2d3a44,
  trim: 0x415164, // lighter panel/cap accent
  beam: 0x0b1015, // structural ceiling beams, darker than the ceiling
  ceiling: 0x0c1216, // enclosed dark roof (unlit basic material → exact)
  glow: 0x5ce08b, // mint accent (unlit basic material)
  sun: 0xe6ecf2,
  fill: 0x9fb0bd,
  hemiSky: 0xdfe4e8,
  hemiGround: 0x2a3036,
  impactWall: 0x96aaba,
  impactEnemy: 0xff5b6b,
  death: 0x5ce08b,
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
  fogColor: PALETTE.bg,
  fogDensity: 0.01,
  hemiSky: PALETTE.hemiSky,
  hemiGround: PALETTE.hemiGround,
  hemiIntensity: 3.75,
  sun: PALETTE.sun,
  sunIntensity: 3.2,
  fill: PALETTE.fill,
  strip: PALETTE.glow,
  stripAlt: PALETTE.glow,
  stripIntensity: 2,
  pool: PALETTE.glow,
  poolIntensity: 0.06,
  accent: PALETTE.glow,
  accentIntensity: 1.6,
  stencil: 0x8fa3b3,
  wallTint: 0xffffff,
};

export const THEME_LOOKS: Record<ThemeName, ThemeLook> = {
  control: CONTROL,
  // frío: cian hielo, tiras de vapor blanco alternadas, niebla más densa
  cryo: {
    ...CONTROL,
    background: 0x061018,
    fogColor: 0x0a1a24,
    fogDensity: 0.018,
    hemiSky: 0xcfeaf6,
    hemiGround: 0x1f2b33,
    hemiIntensity: 3.6,
    sun: 0xe8f6ff,
    sunIntensity: 3.0,
    fill: 0x8fc2d6,
    strip: 0x7fe8ff,
    stripAlt: 0xf0fbff,
    stripIntensity: 2.2,
    pool: 0x7fe8ff,
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
    hemiIntensity: 3.5,
    sun: 0xffe2bd,
    sunIntensity: 3.0,
    fill: 0xa3896a,
    strip: 0xffa640,
    stripAlt: 0xffb860,
    stripIntensity: 2.2,
    pool: 0xffa640,
    poolIntensity: 0.08,
    accent: 0x4de3c6,
    accentIntensity: 1.7,
    stencil: 0xd9c7a8,
    wallTint: 0xf2ebe2,
  },
};

export function lookFor(theme: ThemeName): ThemeLook {
  return THEME_LOOKS[theme] ?? CONTROL;
}
