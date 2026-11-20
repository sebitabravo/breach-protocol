/**
 * Engineering Mode: real instrumentation, not decoration.
 * Values come from the renderer, the frame loop and the simulation itself.
 */
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

  get visible(): boolean {
    return !this.root.hidden;
  }

  toggle(force?: boolean): boolean {
    this.root.hidden = force === undefined ? !this.root.hidden : !force;
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
    this.draw();
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
