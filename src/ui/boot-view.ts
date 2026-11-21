/** Pantalla de arranque: checklist, barra de progreso y mensaje de fallback. */
import { byId } from './dom';

export type CheckState = 'ok' | 'fail';

export class BootView {
  setCheck(name: string, state: CheckState): void {
    document.querySelector(`[data-check="${name}"]`)?.setAttribute('data-state', state);
  }

  setProgress(percent: number): void {
    byId('boot-progress').style.width = `${percent}%`;
  }

  setMeta(text: string): void {
    byId('boot-meta').textContent = text;
  }

  setFailure(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    byId('fallback-detail').textContent = fallbackMessage(detail);
  }
}

export function webgl2Supported(): boolean {
  try {
    const probe = document.createElement('canvas');
    return probe.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export function fallbackMessage(detail: string): string {
  return detail === 'webgl2'
    ? 'Este navegador no expone WebGL2. Probá Chrome, Edge, Firefox o Safari actualizados.'
    : `No pudimos inicializar el sistema: ${detail}`;
}
