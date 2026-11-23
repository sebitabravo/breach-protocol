/**
 * Dueño único de constantes cuyo origen real vive en el núcleo Rust congelado
 * (no se puede importar); el comparador de drift tests/unit/single-source.test.ts
 * lee el archivo Rust y falla si alguno de estos valores se aparta de él.
 */
/** Métricas del jugador, espejo de `core/src/player.rs` (RADIUS/HEIGHT/EYE_HEIGHT).
 * El renderer (src/render/camera.ts, src/render/terminal-model.ts) las deriva de acá. */
export const PLAYER = {
  /** Radio de colisión, metros. */
  radius: 0.36,
  /** Altura de pie (corona), metros. */
  height: 1.8,
  /** Altura de los ojos sobre los pies, metros. */
  eyeHeight: 1.62,
} as const;

/** Duración objetivo de la partida en segundos, espejo de `MATCH_SECONDS`
 * en `core/src/sim.rs`. El copy de sector y el HUD derivan de acá. */
export const MATCH_SECONDS = 180;

/** Reloj m:ss del copy de la interfaz, p. ej. 180 → "3:00". */
export function formatMatchClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}
