/**
 * Adaptive quality controller.
 *
 * Decisions come from a robust percentile of real frame times with asymmetric
 * hysteresis: drop fast when the budget is missed, climb slowly when there is
 * headroom, and never change twice inside the cooldown. A manual preset always
 * wins over the automatic one.
 *
 * T5b: en `auto` el controlador además mantiene el registro persistente del
 * nivel verificado (`bp.gfx.tier`, settings.ts). El primer arranque de la
 * página oferta el nivel persistido como punto de partida si la firma de GPU
 * coincide; cada cambio automático (subida o bajada) vuelve a persistir el
 * nivel que realmente se sostuvo. Sin firma (sin `WEBGL_debug_renderer_info`,
 * sin storage o bajo estricto sandbox) se degrada al comportamiento previo.
 */
import { hashGpuSignature, loadGfxTierRecord, saveGfxTierRecord, type StorageLike, type VerifiedTier } from './settings';
import { safeStorage } from './storage';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type ResolvedQuality = 'low' | 'medium' | 'high';

const ORDER: ResolvedQuality[] = ['low', 'medium', 'high'];

export interface QualityChange {
  changed: boolean;
  preset: ResolvedQuality;
  reason: 'none' | 'down' | 'up' | 'manual';
}

/**
 * Lectura del recorte adaptativo de resolución (T5b) pasadala al controlador en cada `sample`.
 * La escala es un factor multiplicativo ENCIMA del presupuesto de píxeles: mientras recorta
 * (`scale < 1`), la holgura de frame pertenece a la recuperación de la escala, no al controlador
 * de preset (precedencia explícita: sin doble castigo).
 */
export interface AdaptiveReadout {
  /** Factor actual de escala ∈ (0, 1]; 1 = presupuesto completo. */
  scale: number;
  /** Verdadero cuando la escala llegó a su piso y ya no puede absorber más carga. */
  atFloor: boolean;
}

export interface QualityOptions {
  windowSize?: number;
  /** p95 above this (ms) counts as missing the budget. */
  downThresholdMs?: number;
  /** p95 below this (ms) counts as having headroom. */
  upThresholdMs?: number;
  windowsToDrop?: number;
  windowsToRaise?: number;
  cooldownMs?: number;
  /** p95 del intervalo de frame bajo el cual se considera que el display está al límite de su vsync. */
  vsyncOkMs?: number;
  /** p95 del tiempo de CPU del render bajo el cual queda margen para subir de preset. */
  cpuHeadroomMs?: number;
  /**
   * Tras bajar de un preset por no sostener el presupuesto, la subida por margen de CPU no vuelve a él durante
   * este tiempo (por defecto, toda la sesión). El CPU no ve la GPU: sin esto, un equipo limitado por GPU subiría
   * y bajaría con un tirón cada pocos minutos.
   */
  ceilingMs?: number;
  /** Storage del registro de nivel verificado; por defecto `safeStorage()`. */
  storage?: StorageLike;
  /**
   * Firma gráfica actual (hash de GPU + discriminador DPR/viewport); `null` cuando el
   * navegador no colabora y entonces no hay caché. Por defecto la sonda local.
   */
  signature?: () => string | null;
  /**
   * Control del punto de partida verificado (T5b): `undefined` = la vía de producción
   * (una oferta por carga de página), `true` = aplicar sin consumir el flag de boot
   * (inyección para tests), `false` = nunca aplicar.
   */
  applyVerified?: boolean;
}

/**
 * El nivel persistido se ofrece una sola vez por carga de página: los recreados
 * del shell (goToMenu) vuelven al arranque clásico, y solo un boot posterior
 * salta la escalada. Inyectable en tests vía `applyVerified`.
 */
let gfxTierOfferedThisBoot = false;

interface GpuProbe {
  backend: string;
  vendor: string;
  renderer: string;
  discriminator: string;
}

/** Ventana agrupada para los buckets del discriminador: que el registro se mantenga entre ventanas. */
function bucketViewport(size: number): number {
  return Math.round(size / 128) * 128;
}

/**
 * Sonda gráfica con best-effort (una vez por página): backend, strings sin enmascarar
 * de `WEBGL_debug_renderer_info` y un discriminador DPR/viewport. Nada lanza: si el
 * navegador no entrega strings identificables (masked, bloqueado, sin WebGL) devuelve
 * `null` y el controlador queda exactamente como antes del cambio.
 */
let cachedGfxSignature: string | null | undefined;

export function probeGfxSignature(): string | null {
  if (cachedGfxSignature !== undefined) return cachedGfxSignature;
  cachedGfxSignature = null;
  try {
    const host = globalThis as Record<string, unknown>;
    const doc = host.document as Document | undefined;
    const win = host.window as (Window & typeof globalThis) | undefined;
    if (!doc || typeof doc.createElement !== 'function' || !win) return null;
    const canvas = doc.createElement('canvas');
    const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return null;
    const probe: GpuProbe = { backend: 'webgl2', vendor: '', renderer: '', discriminator: '' };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info') as
      | ({ UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } & Record<string, unknown>)
      | null;
    if (dbg) {
      probe.vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '');
      probe.renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '');
    } else {
      // Sin la extensión los strings vienen enmascarados; igualmente discriminan builds.
      probe.vendor = String(gl.getParameter(gl.VENDOR) ?? '');
      probe.renderer = String(gl.getParameter(gl.RENDERER) ?? '');
    }
    // Discriminador S9: el DPR y el área de píxeles cambian el presupuesto de DPR, así
    // que cambian la firma; el viewport va agrupado para no invalidar por un resize.
    const dpr = Math.round((win.devicePixelRatio || 1) * 4) / 4;
    probe.discriminator = `${dpr}@${bucketViewport(win.innerWidth)}x${bucketViewport(win.innerHeight)}`;
    if (probe.vendor || probe.renderer) {
      cachedGfxSignature = hashGpuSignature([probe.backend, probe.vendor, probe.renderer, probe.discriminator]);
    }
    // Devuelve el contexto de sonda: el shell ya crea el real para el juego.
    (gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  } catch {
    cachedGfxSignature = null;
  }
  return cachedGfxSignature;
}

export class QualityController {
  private mode: QualitySetting;
  private current: ResolvedQuality;
  private samples: number[] = [];
  private cpuSamples: number[] = [];
  /** La última ventana buena lo fue solo por margen de CPU (frames al límite del vsync). */
  private goodViaCpuOnly = false;
  private readonly blockedUntil: Record<ResolvedQuality, number> = { low: 0, medium: 0, high: 0 };
  private badWindows = 0;
  private goodWindows = 0;
  private lastChangeAt = 0;

  private readonly windowSize: number;
  private readonly downThresholdMs: number;
  private readonly upThresholdMs: number;
  private readonly windowsToDrop: number;
  private readonly windowsToRaise: number;
  private readonly cooldownMs: number;
  private readonly vsyncOkMs: number;
  private readonly cpuHeadroomMs: number;
  private readonly ceilingMs: number;
  private readonly storage: StorageLike | undefined;
  private readonly signature: (() => string | null) | undefined;
  /** Firma capturada de este arranque; la persistencia nunca re-probea a mitad de partida. */
  private signatureValue: string | null = null;

  constructor(initial: QualitySetting = 'auto', options: QualityOptions = {}) {
    this.mode = initial;
    this.current = initial === 'auto' ? 'medium' : initial;
    this.windowSize = options.windowSize ?? 45;
    this.downThresholdMs = options.downThresholdMs ?? 22;
    this.upThresholdMs = options.upThresholdMs ?? 12;
    this.windowsToDrop = options.windowsToDrop ?? 2;
    this.windowsToRaise = options.windowsToRaise ?? 5;
    this.cooldownMs = options.cooldownMs ?? 4000;
    this.vsyncOkMs = options.vsyncOkMs ?? 18.5;
    this.cpuHeadroomMs = options.cpuHeadroomMs ?? 4;
    this.ceilingMs = options.ceilingMs ?? Number.POSITIVE_INFINITY;
    this.storage = options.storage ?? safeStorage();
    this.signature = options.signature ?? probeGfxSignature;
    if (this.mode === 'auto' && this.storage && options.applyVerified !== false) {
      // Solo el primer arranque de la página oferta el nivel persistido (los
      // recreados del shell vuelven a la escalada clásica).
      if (options.applyVerified === true || !gfxTierOfferedThisBoot) {
        if (options.applyVerified !== true) gfxTierOfferedThisBoot = true;
        this.signatureValue = this.captureSignature();
        if (this.signatureValue !== null) {
          const verified = loadGfxTierRecord(this.storage, this.signatureValue);
          if (verified) this.current = verified;
        }
      }
    }
  }

  /** Firma del arranque actual; un navegador hostil devuelve `null` y no hay caché. */
  private captureSignature(): string | null {
    try {
      return this.signature?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Persiste el nivel que el controlador dejó aplicado tras un cambio automático. */
  private persistTier(): void {
    if (!this.storage) return;
    this.signatureValue ??= this.captureSignature();
    if (this.signatureValue === null) return;
    try {
      saveGfxTierRecord(this.current as VerifiedTier, this.signatureValue, this.storage);
    } catch {
      // Quota o modo privado: el registro vuelve a persistir en el próximo cambio.
    }
  }

  get setting(): QualitySetting {
    return this.mode;
  }

  get preset(): ResolvedQuality {
    return this.current;
  }

  setManual(setting: QualitySetting): QualityChange {
    this.mode = setting;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.goodViaCpuOnly = false;
    this.samples.length = 0;
    this.cpuSamples.length = 0;
    if (setting !== 'auto') {
      this.current = setting;
      return { changed: true, preset: this.current, reason: 'manual' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }

  /**
   * Feeds one frame time in milliseconds. `cpuMs` (tiempo de CPU del render) permite subir de preset
   * en pantallas atadas a vsync, donde el intervalo de frame nunca baja de ~16.7 ms aunque sobre margen.
   * `adaptive`, si viene, es la lectura del recorte adaptativo de resolución (T5b): mientras la
   * escala recorta y no llegó a su piso, el controlador HOLD sus bajadas (la misma carga sostenida no
   * produce doble castigo); al llegar al piso y seguir perdiendo el presupuesto, la bajada de preset
   * es el siguiente paso correcto. Las subidas quedan bloqueadas hasta que la escala devuelva su
   * techo: la holgura observada pertenece primero a la recuperación de la escala.
   */
  sample(frameMs: number, now: number, cpuMs?: number, adaptive?: AdaptiveReadout): QualityChange {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
      return { changed: false, preset: this.current, reason: 'none' };
    }
    this.samples.push(frameMs);
    if (cpuMs !== undefined && Number.isFinite(cpuMs)) this.cpuSamples.push(cpuMs);
    if (this.samples.length < this.windowSize) {
      return { changed: false, preset: this.current, reason: 'none' };
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const cpuP95 = this.p95(this.cpuSamples);
    this.samples.length = 0;
    this.cpuSamples.length = 0;

    if (this.mode !== 'auto') {
      return { changed: false, preset: this.current, reason: 'none' };
    }
    if (now - this.lastChangeAt < this.cooldownMs) {
      return { changed: false, preset: this.current, reason: 'none' };
    }

    const index = ORDER.indexOf(this.current);
    // Precedencia T5b: si la escala de resolución está recortando, la carga sostenida es SU problema
    // primero (solo el piso la agota). En producción el reloj favorece a la escala por construcción:
    // su ventana es más corta (20 contra 45) y shedea antes de que el controlador acumule ventanas.
    const shedding = adaptive !== undefined && Number.isFinite(adaptive.scale) && adaptive.scale < 1;
    const holdDown = shedding && !(adaptive !== undefined && adaptive.atFloor);

    if (p95 > this.downThresholdMs) {
      this.badWindows += 1;
      this.goodWindows = 0;
    } else if (p95 < this.upThresholdMs) {
      this.goodWindows += 1;
      this.badWindows = 0;
      this.goodViaCpuOnly = false;
    } else if (p95 <= this.vsyncOkMs && cpuP95 !== null && cpuP95 <= this.cpuHeadroomMs) {
      this.goodViaCpuOnly = true;
      this.goodWindows += 1;
      this.badWindows = 0;
    } else {
      this.badWindows = Math.max(0, this.badWindows - 1);
      this.goodWindows = 0;
    }

    if (this.badWindows >= this.windowsToDrop && index > 0 && !holdDown) {
      this.blockedUntil[this.current] = now + this.ceilingMs;
      this.current = ORDER[index - 1];
      this.badWindows = 0;
      this.lastChangeAt = now;
      this.persistTier();
      return { changed: true, preset: this.current, reason: 'down' };
    }
    if (this.goodWindows >= this.windowsToRaise && index < ORDER.length - 1 && !shedding &&
      !(this.goodViaCpuOnly && now < this.blockedUntil[ORDER[index + 1]])) {
      this.current = ORDER[index + 1];
      this.goodWindows = 0;
      this.lastChangeAt = now;
      this.persistTier();
      return { changed: true, preset: this.current, reason: 'up' };
    }
    return { changed: false, preset: this.current, reason: 'none' };
  }

  private p95(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }
}

// -------------------------------------------------------------------------
// T5b: recorte adaptativo de resolución (paridad con `scale`/`shed` de
// `tld.gfx.v1` en la referencia). Es un factor multiplicativo ENCIMA del
// presupuesto de píxeles del preset (presets.ts `playPixelRatio`): nunca lo
// reemplaza y, por construcción (factor ≤ 1), nunca sube el costo por encima
// del allowance del preset. Lleva el hysteresis completo aquí para que la
// decisión sea auditable: señal EMA, banda muerta, paso rápido de recorte y
// recuperación lenta tras holgura sostenida.
// -------------------------------------------------------------------------

export interface ScaleDecision {
  changed: boolean;
  /** Escala vigente tras la decisión ∈ (0, 1]. */
  scale: number;
  atFloor: boolean;
  reason: 'none' | 'down' | 'up';
}

export interface AdaptiveScaleOptions {
  /** Muestras válidas por decisión. Producción: 20 (~0.33 s a 60 fps). */
  windowSize?: number;
  /** Factor de suavizado del EMA por muestra (0, 1]. Producción: 0.05 — un solo hitch NO mueve la señal. */
  emaAlpha?: number;
  /** EMA (ms) sobre la que la ventana pierde el presupuesto (el p95 del controlador cae a 22 ms). */
  downThresholdMs?: number;
  /** EMA (ms) por debajo o igual a la cual recupera (18.5 = vsync-locked = holgura demostrada). */
  upThresholdMs?: number;
  /** Ventanas consecutivas perdiendo el presupuesto antes del primer recorte (blindaje anti-hitch). */
  windowsToShed?: number;
  /** Ventanas de calentamiento ignoradas al arrancar (stall de boot/transición). Producción: 2. */
  windowsToWarmup?: number;
  /** Paso de recorte multiplicativo por ventana confirmada. 0.85: rápido (0.355 de riesgo absorbido en 4 pasos). */
  downFactor?: number;
  /** Paso de recuperación multiplicativo por ventana con holgura. 1.05: lento (~15 ventanas de piso a techo). */
  upFactor?: number;
  /** Piso del factor. 0.5: a mitad de resolución lineal (¼ de píxeles) la ROM ya es ilegible. */
  floor?: number;
  /** Techo del factor: siempre 1 (el presupuesto del preset es el máximo, nunca se supera). */
  ceiling?: number;
}

/** Cuantiza la escala a 3 decimales: converge a un valor fijo, sin deriva flotante. */
function quantizeScale(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Controlador de escala de resolución. Se alimenta CADA FRAME con el intervalo
 * real de rAF (el renderer, único dueño del timing); decide por ventana usando
 * el EMA como señal suavizada:
 *
 * - EMA > down (22 ms): ventana que pierde el presupuesto. Tras
 *   `windowsToShed` ventanas consecutivas, recorta `scale *= downFactor`
 *   (rápido) hasta el piso.
 * - EMA ≤ up (18.5 ms, incluye el intervalo de un display atado a vsync):
 *   ventana con holgura sostenida; recupera `scale *= upFactor` (lento) hasta
 *   el techo. En vsync los frames nunca bajan de ~16.7 aunque sobre margen, así
 *   que "clavados en el refresco" cuenta como holgura.
 * - EMA en (up, down): banda muerta — nada se mueve. Esto es lo que evita la
 *   oscilación: una escena estable se asienta donde su EMA decae a la banda.
 */
export class AdaptiveScale {
  private readonly windowSize: number;
  private readonly emaAlpha: number;
  private readonly downThresholdMs: number;
  private readonly upThresholdMs: number;
  private readonly windowsToShed: number;
  private readonly downFactor: number;
  private readonly upFactor: number;
  private readonly floor: number;
  private readonly ceiling: number;

  private samplesInWindow = 0;
  private warmupLeft: number;
  private emaValue: number | null = null;
  private badStreak = 0;
  private scaleValue = 1;
  private shedCount = 0;
  /**
   * Decisión "sin cambio" reutilizada: sample corre cada frame desde el draw del
   * renderer y la convención del proyecto es cero reservas por frame. Es un valor
   * transitorio — los consumidores (el renderer) lo leen y no lo retienen.
   */
  private readonly noneDecision: ScaleDecision = { changed: false, scale: 1, atFloor: false, reason: 'none' };

  constructor(options: AdaptiveScaleOptions = {}) {
    this.windowSize = Math.max(1, options.windowSize ?? 20);
    this.emaAlpha = Math.min(1, Math.max(0.01, options.emaAlpha ?? 0.05));
    this.downThresholdMs = options.downThresholdMs ?? 22;
    this.upThresholdMs = options.upThresholdMs ?? 18.5;
    this.windowsToShed = Math.max(1, options.windowsToShed ?? 2);
    this.warmupLeft = Math.max(0, options.windowsToWarmup ?? 2);
    this.downFactor = Math.min(1, Math.max(0.5, options.downFactor ?? 0.85));
    this.upFactor = Math.min(2, Math.max(1, options.upFactor ?? 1.05));
    this.floor = Math.max(0.1, Math.min(1, options.floor ?? 0.5));
    this.ceiling = options.ceiling ?? 1;
  }

  /**
   * Un frame. Ignora muestras hostiles (NaN, ≤0, >250 — pausas, pestaña oculta) exactamente
   * como el controlador de preset; no llenan la ventana ni mueven el EMA.
   */
  sample(frameMs: number): ScaleDecision {
    const none = (): ScaleDecision => {
      this.noneDecision.scale = this.scaleValue;
      this.noneDecision.atFloor = this.atFloor;
      return this.noneDecision;
    };
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return none();
    // Calentamiento: las primeras ventanas (boot, transición de menú a juego, primer
    // spawn) llenan la ventana pero NO alimentan el EMA; el signal arranca con la
    // escena ya en régimen. Sin esto, el decaimiento del propio spike de boot
    // recortaría la resolución de una máquina sana en reposo.
    if (this.warmupLeft > 0) {
      if (++this.samplesInWindow >= this.windowSize) {
        this.samplesInWindow = 0;
        this.warmupLeft -= 1;
        if (this.warmupLeft === 0) this.emaValue = null;
      }
      return none();
    }
    this.emaValue = this.emaValue === null ? frameMs : this.emaValue + this.emaAlpha * (frameMs - this.emaValue);
    if (++this.samplesInWindow < this.windowSize) return none();
    this.samplesInWindow = 0;

    const ema = this.emaValue;
    if (ema > this.downThresholdMs) {
      this.badStreak += 1;
      if (this.badStreak >= this.windowsToShed && this.scaleValue > this.floor) {
        this.scaleValue = quantizeScale(Math.max(this.floor, this.scaleValue * this.downFactor));
        this.shedCount += 1;
        return { changed: true, scale: this.scaleValue, atFloor: this.atFloor, reason: 'down' };
      }
      return none();
    }
    if (ema <= this.upThresholdMs) {
      this.badStreak = 0;
      if (this.scaleValue < this.ceiling) {
        this.scaleValue = quantizeScale(Math.min(this.ceiling, this.scaleValue * this.upFactor));
        return { changed: true, scale: this.scaleValue, atFloor: this.atFloor, reason: 'up' };
      }
      return none();
    }
    // Banda muerta: ni pierde ni sobra. Reinicia la racha mala para no arrastrar
    // islas aisladas en el historial; a la próxima pérdida real se vuelve a contar.
    this.badStreak = 0;
    return none();
  }

  /** Escala actual del render ∈ (0, 1]. 1 = presupuesto completo del preset. */
  get scale(): number {
    return this.scaleValue;
  }

  get atFloor(): boolean {
    return this.scaleValue <= this.floor + 1e-9;
  }

  get atCeiling(): boolean {
    return this.scaleValue >= this.ceiling - 1e-9;
  }

  /** Cuántas veces ha recortado esta sesión (paridad con `shed` de la referencia). */
  get shed(): number {
    return this.shedCount;
  }

  /** Reinicia la señal y vuelve a la escala dada (nuevo preset, cambio manual). */
  reset(scale = this.ceiling): void {
    this.emaValue = null;
    this.samplesInWindow = 0;
    this.badStreak = 0;
    this.scaleValue = quantizeScale(Math.min(this.ceiling, Math.max(this.floor, Number.isFinite(scale) ? scale : this.ceiling)));
  }
}
