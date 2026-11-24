/**
 * Dueño único de los colores de estado compartidos entre el canvas de la
 * interfaz (src/ui/hud.ts, src/ui/engineering.ts) y los albedos/acento del
 * mundo 3D (src/render/themes.ts). `src/styles/tokens.css` mantiene su copia
 * para el DOM; tests/unit/single-source.test.ts lee los dos lados y falla si
 * un token CSS y su espejo TypeScript dejan de coincidir (D4).
 */

/** `'#rrggbb'` → componentes decimales, para componer `rgba()` en canvas. */
export function rgbOf(hex: string): readonly [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/** Vocabulario de estado del juego en hex minúscula, idéntico al de tokens.css
 * (--state-ok / --danger / --warning del tema oscuro). */
export const STATE_COLORS = {
  ok: '#5ce08b',
  danger: '#ff5b6b',
  warning: '#ffce6b',
} as const;
