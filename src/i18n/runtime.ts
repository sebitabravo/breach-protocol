/**
 * Runtime mínimo de i18n (D4 + decisión del owner sobre locales): aplica el
 * catálogo único a dos mecanismos y nada más.
 *
 *  - `t(key, params)`: texto construido por script (HUD, resultados, toasts).
 *  - Pasada declarativa `applyStatic()`: todo nodo estático del marcado se
 *    traduce por atributos `data-i18n` (textContent), `data-i18n-aria`
 *    (aria-label), `data-i18n-title` (title) y `data-i18n-placeholder`
 *    (placeholder).
 *
 * También es el único lugar que formatea números, fechas, horas y relojes
 * según el locale activo. Sin dependencias ni biblioteca de i18n.
 */
import type { Locale } from '../core/settings';
import { CATALOG, type CatalogKey } from './catalog';

/** Tag de Intl por locale: es-CL conserva el formato numérico existente. */
const INTL_TAG: Record<Locale, string> = { es: 'es-CL', en: 'en-US' };

let active: Locale = 'es';
let numberFormat = new Intl.NumberFormat(INTL_TAG.es);
const listeners = new Set<() => void>();

/** Un locale guardado desconocido cae a español: mismo criterio que `settings`. */
function normalize(locale: unknown): Locale {
  return locale === 'en' ? 'en' : 'es';
}

export function getLocale(): Locale {
  return active;
}

interface I18nScope {
  querySelectorAll(selectors: string): Iterable<HTMLElement>;
}

/** Selector único de la pasada declarativa; aplica los cuatro atributos. */
export const I18N_SELECTOR = '[data-i18n], [data-i18n-aria], [data-i18n-title], [data-i18n-placeholder]';

/** Traduce el marcado estático del scope (por defecto, todo el documento).
 *  Si el nodo tiene hijos elemento (p. ej. `<b id="set-sens-val">`), solo se
 *  reemplazan sus nodos de texto: los valores vivos no se destruyen. */
export function applyStatic(scope?: I18nScope): void {
  const root = scope ?? (typeof document === 'undefined' ? null : document);
  if (!root) return;
  for (const node of Array.from(root.querySelectorAll(I18N_SELECTOR)) as HTMLElement[]) {
    const dataset = node.dataset;
    if (dataset.i18n) setTranslatedText(node, t(dataset.i18n as CatalogKey));
    if (dataset.i18nAria) node.setAttribute('aria-label', t(dataset.i18nAria as CatalogKey));
    if (dataset.i18nTitle) node.setAttribute('title', t(dataset.i18nTitle as CatalogKey));
    if (dataset.i18nPlaceholder) node.setAttribute('placeholder', t(dataset.i18nPlaceholder as CatalogKey));
  }
}

function setTranslatedText(node: HTMLElement, text: string): void {
  const children = node.childNodes;
  if (!children) {
    node.textContent = text;
    return;
  }
  const nodes = Array.from(children);
  if (!nodes.some((child) => child.nodeType === 1)) {
    node.textContent = text;
    return;
  }
  for (const child of nodes) {
    if (child.nodeType === 3) node.removeChild(child);
  }
  node.insertBefore(document.createTextNode(text), node.firstChild);
}

/** Cambia el locale, actualiza `lang` del documento, re-aplica el marcado
 *  estático y avisa a las vistas ya renderizadas. Sin recarga. */
export function setLocale(locale: Locale): void {
  active = normalize(locale);
  numberFormat = new Intl.NumberFormat(INTL_TAG[active]);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = active;
  }
  applyStatic();
  for (const listener of listeners) listener();
}

/** Inicializa el runtime con el locale persistido (ya saneado por `settings`). */
export function initI18n(locale: Locale): void {
  setLocale(locale);
}

/** Registra un re-render de vista viva; devuelve la desuscripción. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const table = (): Record<string, string> => CATALOG[active] as unknown as Record<string, string>;

export type { CatalogKey };

/** Texto del catálogo para la clave; una clave ausente se devuelve a sí misma
 *  (la paridad de claves está garantizada por tests, nunca `undefined`). */
export function t(key: CatalogKey, params?: Record<string, string | number>): string {
  const entry = table()[key as string] ?? (CATALOG.es as unknown as Record<string, string>)[key as string] ?? (key as string);
  if (!params) return entry;
  return entry.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole);
}

// ------------------------------------------------------------ formatters

/** Agrupación de miles según el locale activo (es-CL: `1.234`). */
export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

/** Reloj de juego `m:ss` (HUD, resultados, briefing). */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Reloj acolchado `mm:ss` (ficha del tutorial). */
export function formatClockPadded(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Duración en milisegundos → `m:ss`. */
export function formatDurationMs(ms: number): string {
  return formatClock(Math.floor(ms / 1000));
}

/** Fecha corta del tablero (`05 jun.` / `Jun 05`). */
export function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(INTL_TAG[active], { day: '2-digit', month: 'short' });
}

/** Hora del día (Engineering Mode). */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString(INTL_TAG[active]);
}
