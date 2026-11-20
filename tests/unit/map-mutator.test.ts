import { describe, expect, it } from 'vitest';
import { MUTATOR_LABEL, parseMapData } from '../../src/world/map';

/** Tabla mínima válida: un sólido, una terminal y un spawn, con el slot 10 configurable. */
function tableWithMutator(slot10: number): Float32Array {
  const header = new Array(16).fill(0);
  header[1] = 1;
  header[2] = 1;
  header[3] = 1;
  header[10] = slot10;
  return new Float32Array([...header, -1, 0, -1, 1, 2, 1, 5, 4, 0.5, -3, 7, 8]);
}

describe('parseMapData mutator slot', () => {
  it('defaults to none when the core writes zero', () => {
    expect(parseMapData(tableWithMutator(0)).mutator).toBe('none');
  });

  it('maps the daily mutator ids from the core header', () => {
    expect(parseMapData(tableWithMutator(1)).mutator).toBe('swarm');
    expect(parseMapData(tableWithMutator(2)).mutator).toBe('glass');
    expect(parseMapData(tableWithMutator(3)).mutator).toBe('ironhide');
  });

  it('falls back to none for ids the shell does not know', () => {
    expect(parseMapData(tableWithMutator(9)).mutator).toBe('none');
    expect(parseMapData(tableWithMutator(-1)).mutator).toBe('none');
    expect(parseMapData(tableWithMutator(Number.NaN)).mutator).toBe('none');
  });

  it('labels every mutator in Spanish for the HUD', () => {
    expect(MUTATOR_LABEL.glass).toBe('cristal');
    expect(Object.values(MUTATOR_LABEL).every((label) => label.length > 0)).toBe(true);
  });
});
