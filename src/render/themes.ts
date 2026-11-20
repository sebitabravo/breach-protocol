/**
 * Paleta y materiales del look de control (S01). Cada entrada es el albedo que
 * alimenta la iluminación para que el píxel sRGB final caiga en los tokens de
 * composición. Los temas por sector se agregan encima de esta base.
 */
import type { Material } from '../world/layout';

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
