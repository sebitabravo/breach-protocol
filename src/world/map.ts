/**
 * Lectura de la tabla de mapa que exporta el núcleo (`Game::build_map_data`).
 * La geometría de colisión vive en Rust; el renderer solo la consume.
 */
export type Material =
  | 'floor'
  | 'wall'
  | 'cover'
  | 'crate'
  | 'pillar'
  | 'trim'
  | 'beam'
  | 'ceiling'
  | 'glow'
  | 'rack'
  | 'deck';

export type ThemeName = 'control' | 'cryo' | 'archive';

export const THEMES: readonly ThemeName[] = ['control', 'cryo', 'archive'];

/** Mutadores del Protocolo Diario. El índice viene de la cabecera (slot 10) y debe coincidir con el núcleo. */
export type Mutator = 'none' | 'swarm' | 'glass' | 'ironhide';

export const MUTATORS: readonly Mutator[] = ['none', 'swarm', 'glass', 'ironhide'];

export const MUTATOR_LABEL: Record<Mutator, string> = {
  none: 'sin mutador',
  swarm: 'enjambre',
  glass: 'cristal',
  ironhide: 'piel de hierro',
};

/** Debe coincidir con `core/src/maps.rs`. */
export const SOLID_KIND = {
  wall: 0,
  floor: 1,
  crate: 2,
  pillar: 3,
  plinth: 4,
  cover: 5,
  rack: 6,
  deck: 7,
} as const;

export interface Solid {
  min: [number, number, number];
  max: [number, number, number];
  kind: number;
}

export interface MapData {
  id: number;
  theme: ThemeName;
  start: { x: number; z: number; yaw: number };
  halfX: number;
  halfZ: number;
  solids: Solid[];
  /** `y` es la altura del suelo donde se para el jugador al usar la terminal. */
  nodes: { x: number; y: number; z: number }[];
  spawns: { x: number; z: number }[];
  /** Solo el Protocolo Diario lo activa; un id desconocido cae en `none` para no romper el arranque. */
  mutator: Mutator;
}

const HEADER = 16;
const SOLID_STRIDE = 7;

export function parseMapData(table: Float32Array): MapData {
  if (table.length < HEADER) throw new Error('tabla de mapa demasiado corta');
  const solidCount = table[1];
  const nodeCount = table[2];
  const spawnCount = table[3];
  const expected = HEADER + solidCount * SOLID_STRIDE + nodeCount * 3 + spawnCount * 2;
  if (!Number.isInteger(solidCount + nodeCount + spawnCount) || table.length !== expected) {
    throw new Error(`tabla de mapa inconsistente: ${table.length} floats, se esperaban ${expected}`);
  }
  const theme = THEMES[table[0]];
  if (!theme) throw new Error(`tema desconocido: ${table[0]}`);

  let at = HEADER;
  const solids: Solid[] = [];
  for (let i = 0; i < solidCount; i += 1, at += SOLID_STRIDE) {
    solids.push({
      min: [table[at], table[at + 1], table[at + 2]],
      max: [table[at + 3], table[at + 4], table[at + 5]],
      kind: table[at + 6],
    });
  }
  const nodes: MapData['nodes'] = [];
  for (let i = 0; i < nodeCount; i += 1, at += 3) {
    nodes.push({ x: table[at], y: table[at + 1], z: table[at + 2] });
  }
  const spawns: MapData['spawns'] = [];
  for (let i = 0; i < spawnCount; i += 1, at += 2) {
    spawns.push({ x: table[at], z: table[at + 1] });
  }
  return {
    id: table[9],
    theme,
    start: { x: table[4], z: table[5], yaw: table[6] },
    halfX: table[7],
    halfZ: table[8],
    solids,
    nodes,
    spawns,
    mutator: MUTATORS[table[10]] ?? 'none',
  };
}

export function materialOfKind(kind: number): Material {
  switch (kind) {
    case SOLID_KIND.floor:
      return 'floor';
    case SOLID_KIND.crate:
      return 'crate';
    case SOLID_KIND.pillar:
      return 'pillar';
    case SOLID_KIND.plinth:
      return 'trim';
    case SOLID_KIND.cover:
      return 'cover';
    case SOLID_KIND.rack:
      return 'rack';
    case SOLID_KIND.deck:
      return 'deck';
    default:
      return 'wall';
  }
}
