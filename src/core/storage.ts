import type { StorageLike } from './settings';

/**
 * Acceso a localStorage que nunca lanza: con datos de sitio bloqueados el
 * propio getter `globalThis.localStorage` lanza SecurityError, así que el
 * acceso tiene que ocurrir dentro del try y no en un parámetro por defecto.
 */
export function safeStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}
