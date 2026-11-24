/**
 * Catálogo narrativo del modo Misión. Un sector es un subsistema que el operador
 * recupera reactivando sus terminales. El índice coincide con el `map id` del
 * núcleo (0, 1, 2).
 */
import { formatMatchClock, MATCH_SECONDS } from './constants';

export type SectorId = 0 | 1 | 2;

export const SECTOR_IDS: readonly SectorId[] = [0, 1, 2];

export interface SectorInfo {
  id: SectorId;
  code: string;
  title: string;
  narrative: string;
  objectives: readonly string[];
  rewards: readonly string[];
  unlocks: string;
}

/** Plazo derivado de la única constante de duración (MATCH_SECONDS, espejo de
 * core/src/sim.rs); el copy nunca reescribe el reloj a mano. */
const DEADLINE = `Completá antes de ${formatMatchClock(MATCH_SECONDS)}`;

export const SECTORS: readonly SectorInfo[] = [
  {
    id: 0,
    code: 'SECTOR_01',
    title: 'Control de Acceso',
    narrative: 'ARGOS bloqueó a sus operadores y giró los drones de mantenimiento contra ellos.',
    objectives: ['Reactivá los 3 terminales de control', 'Sobrevivé a scouts y centinelas', DEADLINE],
    rewards: ['+500 puntos por terminal', 'Enseña el ciclo: moverse, apuntar, activar'],
    unlocks: 'SECTOR_02',
  },
  {
    id: 1,
    code: 'SECTOR_02',
    title: 'Refrigeración',
    narrative: 'Un pasillo largo entre torres de enfriamiento. Aquí aparece el interceptor, que carga en línea recta.',
    objectives: ['Reactivá los 3 terminales', 'Derrotá a los interceptores del pasillo', DEADLINE],
    rewards: ['+500 puntos por terminal', 'Primer contacto con el interceptor'],
    unlocks: 'SG-08 · escopeta de corto alcance',
  },
  {
    id: 2,
    code: 'SECTOR_03',
    title: 'Archivo',
    narrative: 'Racks de servidores en pasillos estrechos y una pasarela con el último terminal de la red.',
    objectives: ['Reactivá los 3 terminales', 'Subí a la pasarela por el terminal elevado', DEADLINE],
    rewards: ['+500 puntos por terminal', 'Último sector de la red'],
    unlocks: 'Fin de la red',
  },
];

export function sectorInfo(id: SectorId): SectorInfo {
  return SECTORS[id];
}
