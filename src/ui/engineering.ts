/**
 * Engineering Mode: real instrumentation, not decoration.
 * Values come from the renderer, the frame loop and the simulation itself.
 */
import type { DebugOverlays, OverlayKey } from '../render/renderer';

/** Los overlays de debug viven en el renderer; este host lo expone el mismo gancho que usan las pruebas/e2e. */
interface DebugHost {
  readonly debug: DebugOverlays;
  readonly postFxPlan: { bloom: boolean; composer: boolean; msaaSamples: number };
}

const OVERLAY_LABELS: Record<OverlayKey, string> = {
  bounds: 'escena',
  collision: 'colisiones',
  camera: 'cámara',
  passes: 'pases',
};

export interface EngineeringData {
  fps: number;
  p50: number;
  p95: number;
  calls: number;
  triangles: number;
  ticks: number;
  dropped: number;
  quality: string;
  dpr: number;
  enemies: number;
  memory: string;
  wasmKib: number;
  loadMs: number;
  note: string;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing engineering element #${id}`);
  return node;
}

export class Engineering {
  private root = el('engineering');
  private graph = el('eng-graph') as HTMLCanvasElement;
  private ctx = this.graph.getContext('2d');
  private samples: number[] = [];
  private readonly toggles = new Map<OverlayKey, HTMLButtonElement>();
  private readonly diag: Partial<Record<'pos' | 'look' | 'pfx' | 'passes', HTMLElement>> = {};
  private fields = {
    fps: el('eng-fps'),
    p50: el('eng-p50'),
    p95: el('eng-p95'),
    calls: el('eng-calls'),
    tris: el('eng-tris'),
    ticks: el('eng-ticks'),
    dropped: el('eng-dropped'),
    quality: el('eng-quality'),
    dpr: el('eng-dpr'),
    enemies: el('eng-enemies'),
    mem: el('eng-mem'),
    wasm: el('eng-wasm'),
    load: el('eng-load'),
    note: el('eng-note'),
  };

  constructor() {
    this.buildOverlays();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(force?: boolean): boolean {
    this.root.hidden = force === undefined ? !this.root.hidden : !force;
    // El estado del panel ES el gate de telemetry: abrirlo habilita los overlays
    // bajo su control, cerrarlo ES apagar el telemetry (ningún overlay sobrevive
    // detrás de un panel cerrado). Cada camino de apertura/cierre pasa por acá.
    this.host()?.debug.setTelemetry(!this.root.hidden);
    return !this.root.hidden;
  }

  pushFrame(frameMs: number): void {
    this.samples.push(frameMs);
    if (this.samples.length > 120) this.samples.shift();
  }

  update(data: EngineeringData): void {
    if (this.root.hidden) return;
    this.fields.fps.textContent = data.fps.toFixed(0);
    this.fields.p50.textContent = data.p50.toFixed(1);
    this.fields.p95.textContent = data.p95.toFixed(1);
    this.fields.calls.textContent = String(data.calls);
    this.fields.tris.textContent = data.triangles.toLocaleString('es-CL');
    this.fields.ticks.textContent = String(data.ticks);
    this.fields.dropped.textContent = String(data.dropped);
    this.fields.quality.textContent = data.quality;
    this.fields.dpr.textContent = `dpr ${data.dpr.toFixed(2)}`;
    this.fields.enemies.textContent = String(data.enemies);
    this.fields.mem.textContent = data.memory;
    this.fields.wasm.textContent = data.wasmKib.toFixed(1);
    this.fields.load.textContent = data.loadMs.toFixed(0);
    this.fields.note.textContent = data.note;
    this.updateDiag();
    this.draw();
  }

  private host(): DebugHost | null {
    return (window as unknown as { __BREACH__?: { renderer?: DebugHost } }).__BREACH__?.renderer ?? null;
  }

  /**
 * Extiende el panel sin tocar index.html ni restylear: los toggles viven en una
   * fila propia y las cuatro métricas nuevas se agregan a la grilla existente
   * con la misma estructura .eng__metric (12 celdas + 4 = 4 filas de 4).
   */
  private buildOverlays(): void {
    const grid = this.root.querySelector<HTMLElement>('.eng__grid');
    const toggles = document.createElement('div');
    toggles.className = 'eng__overlays-row';
    for (const key of Object.keys(OVERLAY_LABELS) as OverlayKey[]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'eng__toggle';
      button.dataset.overlay = key;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = OVERLAY_LABELS[key];
      toggles.append(button);
      this.toggles.set(key, button);
    }
    toggles.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-overlay]');
      if (!target) return;
      const key = target.dataset.overlay as OverlayKey | undefined;
      if (!key) return;
      const next = target.getAttribute('aria-pressed') !== 'true';
      this.host()?.debug.setOverlay(key, next);
      target.setAttribute('aria-pressed', String(next));
    });
    if (grid) {
      grid.after(toggles);
      this.diag.pos = this.metric(grid, 'cámara', 'x · z · y');
      this.diag.look = this.metric(grid, 'orientación', 'yaw · pitch · fov');
      this.diag.pfx = this.metric(grid, 'postfx', 'plan resuelto');
      this.diag.passes = this.metric(grid, 'pases', 'mundo · sombra · vm · comp');
    }
  }

  private metric(grid: HTMLElement, label: string, meta: string): HTMLElement {
    const cell = document.createElement('div');
    cell.className = 'eng__metric eng__metric--data';
    const span = document.createElement('span');
    span.textContent = label;
    const value = document.createElement('b');
    const metaNode = document.createElement('i');
    metaNode.textContent = meta;
    cell.append(span, value, metaNode);
    grid.append(cell);
    return value;
  }

  /** Se ejecuta solo con el panel abierto (4 Hz); los datos vienen del renderer. */
  private updateDiag(): void {
    const host = this.host();
    if (!host) return;
    // Se reassert en cada refresco: si el panel se abre por otro camino, el
    // gate de telemetry queda alineado con la visibilidad real.
    host.debug.setTelemetry(true);
    const { debug, postFxPlan } = host;
    for (const [key, node] of this.toggles) {
      const on = String(debug.plan[key]);
      if (node.getAttribute('aria-pressed') !== on) node.setAttribute('aria-pressed', on);
    }
    if (this.diag.pos && this.diag.look) {
      if (debug.plan.camera) {
        const cam = debug.camera;
        const deg = (radians: number): string => ((radians * 180) / Math.PI).toFixed(0);
        this.diag.pos.textContent = `${cam.px.toFixed(1)} · ${cam.pz.toFixed(1)} · ${cam.py.toFixed(1)}`;
        this.diag.look.textContent = `${deg(cam.yaw)}° · ${deg(cam.pitch)}° · ${cam.fov.toFixed(0)}`;
      } else {
        this.diag.pos.textContent = '—';
        this.diag.look.textContent = '—';
      }
    }
    if (this.diag.pfx) {
      this.diag.pfx.textContent = `${postFxPlan.composer ? `composer ${postFxPlan.msaaSamples}x` : 'directo'} · bloom ${postFxPlan.bloom ? 'on' : 'off'}`;
    }
    if (this.diag.passes) {
      this.diag.passes.textContent = debug.plan.passes
        ? `${debug.passes.world} · ${debug.passes.shadow} · ${debug.passes.viewmodel} · ${debug.passes.composer}`
        : '—';
    }
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width, height } = this.graph;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(8,15,20,0.9)';
    ctx.fillRect(0, 0, width, height);
    // 16.7 ms budget line
    const budgetY = height - (16.7 / 40) * height;
    ctx.strokeStyle = 'rgba(92,224,139,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, budgetY);
    ctx.lineTo(width, budgetY);
    ctx.stroke();

    const n = this.samples.length;
    ctx.fillStyle = '#5ce08b';
    for (let i = 0; i < n; i += 1) {
      const v = Math.min(40, this.samples[i]);
      const h = (v / 40) * height;
      const x = (i / 120) * width;
      ctx.fillStyle = v > 16.7 ? 'rgba(255,91,107,0.85)' : 'rgba(92,224,139,0.75)';
      ctx.fillRect(x, height - h, Math.max(1, width / 120 - 1), h);
    }
  }
}
