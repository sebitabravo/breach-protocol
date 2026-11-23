/**
 * Monitoreo de engineering mode (extraído de game.ts en P5): ventana de
 * muestreo de tiempos de frame, throttle del refresco y armado del readout
 * del panel. El panel en sí es DOM (ui/engineering); este módulo es su
 * cadencia y su contenido. Se construye en boot, en el mismo punto donde
 * antes se construía el panel.
 */
import { Engineering } from '../ui/engineering';
import type { Snapshot } from '../wasm/bridge';
import { H } from '../wasm/protocol';
import { t, formatTime } from '../i18n/runtime';
import type { Renderer } from '../render/renderer';

/** Fuentes de solo lectura del readout: métricas del renderer y del boot. */
export interface EngineeringSources {
  renderer: Renderer | null;
  wasmKib: number;
  loadMs: number;
  bootAt: number;
}

export class EngineeringMonitor {
  private readonly panel = new Engineering();
  private readonly frameSamples: number[] = [];
  private lastAt = 0;

  get visible(): boolean {
    return this.panel.visible;
  }

  toggle(force?: boolean): boolean {
    return this.panel.toggle(force);
  }

  relocalize(): void {
    this.panel.relocalize();
  }

  pushFrame(frameMs: number): void {
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > 120) this.frameSamples.shift();
  }

  update(now: number, state: Snapshot | null, sources: EngineeringSources, immediate = false): void {
    if (!this.panel.visible || (!immediate && now - this.lastAt < 240)) return;
    this.lastAt = now;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const pick = (q: number): number =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    const memory =
      'memory' in performance
        ? `${(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(0)} MB`
        : t('eng.memoryUnavailable');
    this.panel.update({
      fps: mean > 0 ? 1000 / mean : 0,
      p50: pick(0.5),
      p95: pick(0.95),
      calls: sources.renderer?.calls ?? 0,
      triangles: sources.renderer?.triangles ?? 0,
      ticks: state?.tick ?? 0,
      dropped: Math.round(state?.at(H.droppedTicks) ?? 0),
      quality: sources.renderer?.preset.name ?? '—',
      dpr: sources.renderer?.dpr ?? 1,
      enemies: state?.enemiesAlive ?? 0,
      memory,
      wasmKib: sources.wasmKib,
      loadMs: sources.loadMs,
      note: t('eng.noteFmt', { time: formatTime(new Date(sources.bootAt)), lost: state?.lostEvents ?? 0 }),
    });
  }
}
