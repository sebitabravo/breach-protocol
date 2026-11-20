import { describe, expect, it } from 'vitest';
import { fallbackMessage } from '../../src/ui/boot-view';

describe('fallbackMessage', () => {
  it('explains the missing WebGL2 support with browsers to try', () => {
    expect(fallbackMessage('webgl2')).toContain('WebGL2');
  });

  it('shows any other boot failure with its detail instead of a blank page', () => {
    expect(fallbackMessage('arena vacía')).toBe('No pudimos inicializar el sistema: arena vacía');
  });
});
