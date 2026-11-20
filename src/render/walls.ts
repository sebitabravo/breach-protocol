/**
 * Caras interiores de los muros perimetrales de un sector. Compartido por el
 * arena (estarcido) y la decoración (tuberías, rejillas).
 */
import { SOLID_KIND, type MapData, type Solid } from '../world/map';

const WALL_EPS = 0.001;

/** Cara interior de un muro perimetral: `at` es la coordenada del plano y `dir` apunta al interior. */
export interface WallFace {
  axis: 'x' | 'z';
  at: number;
  dir: 1 | -1;
  /** Centro del muro a lo largo de su eje horizontal. */
  centre: number;
  /** Medio largo del muro a lo largo de su eje horizontal. */
  span: number;
}

/**
 * Caras interiores de los cuatro muros perimetrales. Un muro oeste/este es
 * delgado en x; uno norte/sur, delgado en z. Sin ese chequeo, el muro norte
 * (que también toca x = -halfX) se confunde con el oeste.
 */
export function perimeterFaces(map: MapData): WallFace[] {
  const walls = map.solids.filter((s) => s.kind === SOLID_KIND.wall);
  const xThin = (s: Solid): boolean => s.max[0] - s.min[0] <= 2;
  const zThin = (s: Solid): boolean => s.max[2] - s.min[2] <= 2;
  const west = walls.find((s) => xThin(s) && s.min[0] <= -map.halfX + WALL_EPS);
  const east = walls.find((s) => xThin(s) && s.max[0] >= map.halfX - WALL_EPS);
  const north = walls.find((s) => zThin(s) && s.min[2] <= -map.halfZ + WALL_EPS);
  const south = walls.find((s) => zThin(s) && s.max[2] >= map.halfZ - WALL_EPS);
  const faces: WallFace[] = [];
  if (west) faces.push(faceOf('x', west.max[0], 1, west.min[2], west.max[2]));
  if (east) faces.push(faceOf('x', east.min[0], -1, east.min[2], east.max[2]));
  if (north) faces.push(faceOf('z', north.max[2], 1, north.min[0], north.max[0]));
  if (south) faces.push(faceOf('z', south.min[2], -1, south.min[0], south.max[0]));
  return faces;
}

function faceOf(axis: 'x' | 'z', at: number, dir: 1 | -1, lo: number, hi: number): WallFace {
  return { axis, at, dir, centre: (lo + hi) / 2, span: (hi - lo) / 2 };
}
