/**
 * Anillo de canal del crosshair (extraído de game.ts en P5): espeja el progreso
 * de activación del nodo con el que se interactúa sobre la retícula. Guarda el
 * último valor emitido para no escribir el DOM cada frame.
 */
import type { Snapshot } from '../wasm/bridge';

export class ChannelRing {
  private percent = 0;

  constructor(private readonly crosshair: HTMLElement) {}

  /** Uno por frame en partida. */
  update(state: Snapshot): void {
    const node = state.interacting >= 0 ? state.node(state.interacting) : null;
    const percent = node && !node.active ? Math.round(node.progress * 100) : 0;
    if (percent === this.percent) return;
    this.percent = percent;
    this.crosshair.classList.toggle('is-channeling', percent > 0);
    this.crosshair.style.setProperty('--channel', `${percent}%`);
  }
}
