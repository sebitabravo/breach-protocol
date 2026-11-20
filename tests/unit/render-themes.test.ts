import { describe, expect, it } from 'vitest';
import { lookFor, MATERIAL_COLORS, PALETTE, THEME_LOOKS } from '../../src/render/themes';
import type { ThemeName } from '../../src/world/map';

const THEMES: ThemeName[] = ['control', 'cryo', 'archive'];

/** Luminancia relativa aproximada sobre un hex sRGB (suficiente para ordenar valores). */
function luma(hex: number): number {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function rgbOf(hex: number): [number, number, number] {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

describe('theme looks', () => {
  it('keeps fog, light and emissive values in a readable range for every theme', () => {
    for (const name of THEMES) {
      const look = THEME_LOOKS[name];
      expect(look.fogDensity).toBeGreaterThanOrEqual(0);
      expect(look.fogDensity).toBeLessThanOrEqual(0.05);
      expect(look.hemiIntensity).toBeGreaterThan(0);
      expect(look.sunIntensity).toBeGreaterThan(0);
      expect(look.wallTint).toBeGreaterThan(0);
      expect(Number.isFinite(look.poolIntensity)).toBe(true);
    }
  });

  it('pushes strip emission above 1 so the bloom threshold catches it', () => {
    for (const name of THEMES) {
      expect(THEME_LOOKS[name].stripIntensity).toBeGreaterThan(1);
    }
  });

  it('keeps the control albedo ladder: floor darker than walls, walls darker than cover', () => {
    expect(luma(MATERIAL_COLORS.floor)).toBeLessThan(luma(MATERIAL_COLORS.wall));
    expect(luma(MATERIAL_COLORS.wall)).toBeLessThan(luma(MATERIAL_COLORS.cover));
    expect(luma(PALETTE.ceiling)).toBeLessThan(luma(PALETTE.wall));
    expect(THEME_LOOKS.control.wallTint).toBe(0xffffff);
  });

  it('gives cryo cold strips and archive warm strips', () => {
    const [cr, , cb] = rgbOf(THEME_LOOKS.cryo.strip);
    expect(cb).toBeGreaterThan(cr);
    const [ar, , ab] = rgbOf(THEME_LOOKS.archive.strip);
    expect(ar).toBeGreaterThan(ab);
  });

  it('keeps archive terminals teal, not amber', () => {
    const [r, g, b] = rgbOf(THEME_LOOKS.archive.accent);
    expect(g).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(r);
  });

  it('thickens cryo fog compared with control', () => {
    expect(THEME_LOOKS.cryo.fogDensity).toBeGreaterThan(THEME_LOOKS.control.fogDensity);
  });

  it('falls back to control for an unknown theme', () => {
    expect(lookFor('nope' as ThemeName)).toBe(THEME_LOOKS.control);
  });
});
