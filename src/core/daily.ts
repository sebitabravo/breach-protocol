/**
 * Fechas del Protocolo Diario. Todo se calcula en UTC para que el tablero diario
 * sea el mismo en cualquier zona horaria: el servidor valida la semilla contra la
 * fecha UTC, no contra la del navegador.
 */

/** Fecha UTC como `YYYY-MM-DD`: clave del tablero `daily:<fecha>` y del progreso. */
export function utcDateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Semilla del día como entero `YYYYMMDD` (UTC). Es la misma que valida el servidor. */
export function dailySeed(date: Date): number {
  return Number(utcDateKey(date).replaceAll('-', ''));
}
