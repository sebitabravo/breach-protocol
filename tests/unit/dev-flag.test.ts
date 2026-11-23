import { describe, expect, it } from 'vitest';
import { devEngineeringRequested } from '../../src/core/game';

/**
 * Engineering Mode queda fuera del menú de jugador: solo entra por la bandera
 * de desarrollo `?dev=1` (mismo mecanismo de query que `?boot=` y `?viewmodel=`)
 * o por el toggle de teclado F3 en partida. La bandera es la única vía nueva.
 */
describe('engineering mode dev gate', () => {
  it('accepts only the explicit ?dev=1 value', () => {
    expect(devEngineeringRequested('?dev=1')).toBe(true);
  });

  it('rejects every other value, sibling flags and empty searches', () => {
    expect(devEngineeringRequested('?dev=0')).toBe(false);
    expect(devEngineeringRequested('?dev')).toBe(false);
    expect(devEngineeringRequested('?boot=slow')).toBe(false);
    expect(devEngineeringRequested('?viewmodel=kenney')).toBe(false);
    expect(devEngineeringRequested('')).toBe(false);
  });
});
