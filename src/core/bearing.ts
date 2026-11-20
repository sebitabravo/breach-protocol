/**
 * Rumbo de una fuente de daño respecto del frente del jugador.
 *
 * Convención de cámara (renderer.ts: rotation order YXZ, rotation.y = yaw): el frente
 * en el plano XZ es (-sin yaw, -cos yaw) y la derecha es (cos yaw, -sin yaw).
 */
export interface PlanarPoint {
  x: number;
  z: number;
}

/**
 * Ángulo en radianes desde el frente: 0 = al frente, +π/2 = a la derecha,
 * ±π = atrás. Devuelve 0 si la fuente coincide con el jugador.
 */
export function damageBearing(yaw: number, player: PlanarPoint, source: PlanarPoint): number {
  const dx = source.x - player.x;
  const dz = source.z - player.z;
  if (dx === 0 && dz === 0) return 0;
  const forward = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return Math.atan2(right, forward);
}
