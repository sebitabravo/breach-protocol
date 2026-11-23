/**
 * P3 (product reset, D5/S7/S10): dueño ÚNICO de la decisión de resolución.
 *
 * Antes de este módulo había tres mecanismos que cambiaban la resolución de
 * render — el controlador de preset (`QualityController.sample`), el recorte
 * adaptativo (`AdaptiveScale.sample`) y el nivel verificado persistido
 * (`bp.gfx.tier`) — y la precedencia entre ellos vivía en el orden de
 * llamadas y en comentarios repartidos en dos archivos. Acá esa precedencia
 * es código: esta clase responde, por ventana, una sola pregunta — dado el
 * señal de frames, el nivel persistido y la elección explícita del jugador,
 * qué preset y qué escala aplican, y por qué (`reason`).
 *
 * Los dos puertos existen porque las dos ventanas miden en puntos distintos:
 * - `sample(frameMs, now, cpuMs?, adaptive?)`: la ventana del preset (45 en
 *   producción), alimentada por el reloj del loop.
 * - `sampleRenderSignal(frameMs)`: la ventana de escala (20 en producción),
 *   alimentada por el intervalo real de rAF en `Renderer.draw`.
 *
 * Precedencia codificada (en `sample`):
 * 1. Elección manual del jugador: gana sobre todo; la señal no la toca.
 * 2. Nivel persistido: se oferta una sola vez por carga de página si la
 *    firma de GPU coincide, y es punto de partida, nunca techo.
 * 3. Mientras la escala recorta y no llegó a su piso, la bajada de preset
 *    queda retenida (la misma carga sostenida no produce doble castigo).
 * 4. La subida de preset queda bloqueada mientras la escala esté bajo su
 *    techo: la holgura observada pertenece primero a la recuperación.
 *
 * El comportamiento de ambas máquinas se movió sin alterarlo: tamaños de
 * ventana, umbrales, histéresis, cooldown, techo de sesión, piso, calentamiento
 * y persistencia son exactamente los medidos en las suites previas.
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

export interface ScaleDecision {
  changed: boolean;
  /** Escala vigente tras la decisión ∈ (0, 1]. */
  scale: number;
  atFloor: boolean;
  reason: 'none' | 'down' | 'up';
}

export interface ResolutionDecision {
  /** Verdadero si esta muestra cambió el preset o la escala. */
  changed: boolean;
  preset: ResolvedQuality;
  scale: number;
  atFloor: boolean;
  atCeiling: boolean;
  presetReason: 'none' | 'down' | 'up' | 'manual';
  scaleReason: 'none' | 'down' | 'up';
  /** Por qué la combinación vigente es la vigente; lo lee el panel. */
  reason: string;
}

/**
 * Lectura del recorte adaptativo pasada al puerto del preset. En producción
 * el gate lee el estado interno de esta misma política; el argumento queda
 * para un driver externo (y las suites que inyectan una escala aparte).
 * La escala es un factor multiplicativo ENCIMA del presupuesto de píxeles:
 * mientras recorta, la holgura pertenece a la recuperación de la escala.
 */
export interface AdaptiveReadout {
  /** Factor actual de escala ∈ (0, 1]; 1 = presupuesto completo. */
  scale: number;
  /** Verdadero cuando la escala llegó a su piso y ya no puede absorber más carga. */
  atFloor: boolean;
}

export interface ResolutionPolicyOptions {
  // --- máquina de preset (ventana del loop) ---
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
   * Control del punto de partida verificado: `undefined` = la vía de producción
   * (una oferta por carga de página), `true` = aplicar sin consumir el flag de boot
   * (inyección para tests), `false` = nunca aplicar.
   */
  applyVerified?: boolean;
  // --- máquina de escala (ventana del rAF) ---
  /** Muestras válidas por decisión. Producción: 20. */
  scaleWindowSize?: number;
  /** Factor de suavizado del EMA por muestra (0, 1]. Producción: 0.05. */
  scaleEmaAlpha?: number;
  /** EMA (ms) sobre la cual la ventana pierde el presupuesto. */
  scaleDownThresholdMs?: number;
  /** EMA (ms) por debajo o igual a la cual recupera. */
  scaleUpThresholdMs?: number;
  /** Ventanas consecutivas perdiendo el presupuesto antes del primer recorte. */
  windowsToShed?: number;
  /** Ventanas de calentamiento ignoradas al arrancar (stall de boot/transición). Producción: 2. */
  windowsToWarmup?: number;
  /** Paso de recorte multiplicativo por ventana confirmada. Producción: 0.85. */
  downFactor?: number;
  /** Paso de recuperación multiplicativo por ventana con holgura. Producción: 1.05. */
  upFactor?: number;
  /** Piso del factor. 0.5: a mitad de resolución lineal la ROM ya es ilegible. */
  floor?: number;
  /** Techo del factor: siempre 1 (el presupuesto del preset es el máximo). */
  ceiling?: number;
}

/** Cuantiza la escala a 3 decimales: converge a un valor fijo, sin deriva flotante. */
function quantizeScale(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * El nivel persistido se oferta una sola vez por carga de página: los recreados
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
 * `null` y la política queda exactamente como sin caché.
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
    // Discriminador: el DPR y el área de píxeles cambian el presupuesto, así que cambian
    // la firma; el viewport va agrupado para no invalidar por un resize.
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

export class ResolutionPolicy {
  // --- decisión vigente ----------------------------------------------------
  private mode: QualitySetting = 'auto';
  private presetValue: ResolvedQuality = 'medium';
  private scaleValue = 1;

  // --- máquina de preset ---------------------------------------------------
  private readonly presetWindowSize: number;
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
  private samples: number[] = [];
  private cpuSamples: number[] = [];
  /** La última ventana buena lo fue solo por margen de CPU (frames al límite del vsync). */
  private goodViaCpuOnly = false;
  private readonly blockedUntil: Record<ResolvedQuality, number> = { low: 0, medium: 0, high: 0 };
  private badWindows = 0;
  private goodWindows = 0;
  private lastChangeAt = 0;
  /** El arranque partió del nivel verificado persistido (para la razón del panel). */
  private bootFromPersisted = false;

  // --- máquina de escala ---------------------------------------------------
  private readonly scaleWindow: number;
  private readonly emaAlpha: number;
  private readonly scaleDown: number;
  private readonly scaleUp: number;
  private readonly windowsToShed: number;
  private readonly downFactor: number;
  private readonly upFactor: number;
  private readonly scaleFloor: number;
  private readonly scaleCeiling: number;
  private samplesInWindow = 0;
  private warmupLeft: number;
  private emaValue: number | null = null;
  private badStreak = 0;
  private shedCount = 0;

  /**
   * Decisión "sin cambio" reutilizada: ambos puertos corren por frame y la
   * convención del proyecto es cero reservas por frame. Es un valor
   * transitorio — los consumidores lo leen y no lo retienen.
   */
  private readonly decisionValue: ResolutionDecision = {
    changed: false, preset: 'medium', scale: 1, atFloor: false, atCeiling: true,
    presetReason: 'none', scaleReason: 'none', reason: '',
  };
  private readonly noneScaleDecision: ScaleDecision = { changed: false, scale: 1, atFloor: false, reason: 'none' };

  constructor(initial: QualitySetting = 'auto', options: ResolutionPolicyOptions = {}) {
    this.freshDecisionState(initial);
    this.presetWindowSize = options.windowSize ?? 45;
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
    this.scaleWindow = Math.max(1, options.scaleWindowSize ?? 20);
    this.emaAlpha = Math.min(1, Math.max(0.01, options.scaleEmaAlpha ?? 0.05));
    this.scaleDown = options.scaleDownThresholdMs ?? 22;
    this.scaleUp = options.scaleUpThresholdMs ?? 18.5;
    this.windowsToShed = Math.max(1, options.windowsToShed ?? 2);
    this.warmupLeft = Math.max(0, options.windowsToWarmup ?? 2);
    this.downFactor = Math.min(1, Math.max(0.5, options.downFactor ?? 0.85));
    this.upFactor = Math.min(2, Math.max(1, options.upFactor ?? 1.05));
    this.scaleFloor = Math.max(0.1, Math.min(1, options.floor ?? 0.5));
    this.scaleCeiling = options.ceiling ?? 1;
    this.scaleValue = quantizeScale(Math.min(this.scaleCeiling, Math.max(this.scaleFloor, 1)));
    if (this.mode === 'auto' && this.storage && options.applyVerified !== false) {
      // Solo el primer arranque de la página oferta el nivel persistido (los
      // recreados del shell vuelven a la escalada clásica).
      if (options.applyVerified === true || !gfxTierOfferedThisBoot) {
        if (options.applyVerified !== true) gfxTierOfferedThisBoot = true;
        this.signatureValue = this.captureSignature();
        if (this.signatureValue !== null) {
          const verified = loadGfxTierRecord(this.storage, this.signatureValue);
          if (verified) {
            this.presetValue = verified;
            this.bootFromPersisted = true;
          }
        }
      }
    }
    this.refreshReason();
  }

  /**
   * Estado de decisión nuevo: exactamente lo que un `QualityController` recién
   * construido tendría. El shell recrea su controlador al volver al menú
   * (goToMenu) y ambas vías — primer arranque o recreado — pasan por acá.
   */
  private freshDecisionState(initial: QualitySetting): void {
    this.mode = initial;
    this.presetValue = initial === 'auto' ? 'medium' : initial;
    this.samples.length = 0;
    this.cpuSamples.length = 0;
    this.goodViaCpuOnly = false;
    this.blockedUntil.low = 0;
    this.blockedUntil.medium = 0;
    this.blockedUntil.high = 0;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.lastChangeAt = 0;
    this.signatureValue = null;
    this.bootFromPersisted = false;
  }

  /** Firma del arranque actual; un navegador hostil devuelve `null` y no hay caché. */
  private captureSignature(): string | null {
    try {
      return this.signature?.() ?? null;
    } catch {
      return null;
    }
  }

  /** Persiste el nivel que la política dejó aplicado tras un cambio automático. */
  private persistTier(): void {
    if (!this.storage) return;
    this.signatureValue ??= this.captureSignature();
    if (this.signatureValue === null) return;
    try {
      saveGfxTierRecord(this.presetValue as VerifiedTier, this.signatureValue, this.storage);
    } catch {
      // Quota o modo privado: el registro vuelve a persistir en el próximo cambio.
    }
  }

  /** Por qué la combinación vigente es la vigente: estado, no transición. */
  private describe(): string {
    if (this.mode !== 'auto') return `manual: ${this.presetValue} fijado por el jugador`;
    const bootNote = this.bootFromPersisted ? ' (arranque en nivel verificado persistido)' : '';
    if (this.scaleValue >= this.scaleCeiling - 1e-9) {
      return `auto: ${this.presetValue} a escala completa${bootNote}`;
    }
    if (this.scaleValue <= this.scaleFloor + 1e-9) {
      return `auto: escala al piso (${this.scaleValue}) — el preset baja si persiste la carga${bootNote}`;
    }
    return `auto: recorte a ${this.scaleValue} sobre ${this.presetValue} — la carga la absorbe la escala${bootNote}`;
  }

  private refreshReason(): void {
    this.decisionValue.reason = this.describe();
  }

  /** Publica la decisión vigente en el objeto reutilizado (cero reservas). */
  private emit(presetReason: ResolutionDecision['presetReason'], scaleReason: ResolutionDecision['scaleReason']): ResolutionDecision {
    const changed = presetReason !== 'none' || scaleReason !== 'none';
    const d = this.decisionValue;
    d.changed = changed;
    d.preset = this.presetValue;
    d.scale = this.scaleValue;
    d.atFloor = this.atFloor;
    d.atCeiling = this.atCeiling;
    d.presetReason = presetReason;
    d.scaleReason = scaleReason;
    d.reason = this.describe();
    return changed ? { ...d } : d;
  }

  /**
   * Puerto del preset: un frame del loop. `cpuMs` (tiempo de CPU del render) permite subir de preset en
   * pantallas atadas a vsync, donde el intervalo de frame nunca baja de ~16.7 ms aunque sobre margen.
   * `adaptive`, si viene, reemplaza la lectura interna de la escala (driver externo/tests): mientras la
   * escala recorta y no llegó a su piso, la política HOLD sus bajadas (sin doble castigo); al llegar al
   * piso y seguir perdiendo el presupuesto, la bajada de preset es el siguiente paso correcto. Las
   * subidas quedan bloqueadas hasta que la escala devuelva su techo.
   */
  sample(frameMs: number, now: number, cpuMs?: number, adaptive?: AdaptiveReadout): ResolutionDecision {
    const none = (): ResolutionDecision => this.emit('none', 'none');
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) {
      return none();
    }
    this.samples.push(frameMs);
    if (cpuMs !== undefined && Number.isFinite(cpuMs)) this.cpuSamples.push(cpuMs);
    if (this.samples.length < this.presetWindowSize) {
      return none();
    }

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const cpuP95 = this.p95(this.cpuSamples);
    this.samples.length = 0;
    this.cpuSamples.length = 0;

    if (this.mode !== 'auto') {
      return none();
    }
    if (now - this.lastChangeAt < this.cooldownMs) {
      return none();
    }

    const index = ORDER.indexOf(this.presetValue);
    // Precedencia: si la escala de resolución está recortando, la carga sostenida es SU problema
    // primero (solo el piso la agota). La ventana de la escala es más corta (20 contra 45) y
    // shedea antes de que el controlador acumule ventanas. Sin readout externo el gate lee el
    // estado interno de esta misma política.
    const readout = adaptive ?? { scale: this.scaleValue, atFloor: this.atFloor };
    const shedding = Number.isFinite(readout.scale) && readout.scale < 1;
    const holdDown = shedding && !readout.atFloor;

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
      this.blockedUntil[this.presetValue] = now + this.ceilingMs;
      this.presetValue = ORDER[index - 1];
      this.badWindows = 0;
      this.lastChangeAt = now;
      this.persistTier();
      return this.emit('down', 'none');
    }
    if (this.goodWindows >= this.windowsToRaise && index < ORDER.length - 1 && !shedding &&
      !(this.goodViaCpuOnly && now < this.blockedUntil[ORDER[index + 1]])) {
      this.presetValue = ORDER[index + 1];
      this.goodWindows = 0;
      this.lastChangeAt = now;
      this.persistTier();
      return this.emit('up', 'none');
    }
    return none();
  }

  private p95(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  /**
   * Puerto de la escala: un frame real de rAF desde el draw del renderer.
   * EMA > down (22 ms): ventana que pierde el presupuesto. Tras `windowsToShed`
   * ventanas consecutivas, recorta `scale *= downFactor` (rápido) hasta el piso.
   * EMA ≤ up (18.5 ms, incluye el intervalo de un display atado a vsync): holgura
   * sostenida; recupera `scale *= upFactor` (lento) hasta el techo. En la banda
   * muerta nada se mueve: una escena estable se asienta donde su EMA decae a la banda.
   */
  sampleRenderSignal(frameMs: number): ScaleDecision {
    const none = (): ScaleDecision => {
      this.noneScaleDecision.scale = this.scaleValue;
      this.noneScaleDecision.atFloor = this.atFloor;
      return this.noneScaleDecision;
    };
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return none();
    // Calentamiento: las primeras ventanas (boot, transición de menú a juego, primer
    // spawn) llenan la ventana pero NO alimentan el EMA; el signal arranca con la
    // escena ya en régimen. Sin esto, el decaimiento del propio spike de boot
    // recortaría la resolución de una máquina sana en reposo.
    if (this.warmupLeft > 0) {
      if (++this.samplesInWindow >= this.scaleWindow) {
        this.samplesInWindow = 0;
        this.warmupLeft -= 1;
        if (this.warmupLeft === 0) this.emaValue = null;
      }
      return none();
    }
    this.emaValue = this.emaValue === null ? frameMs : this.emaValue + this.emaAlpha * (frameMs - this.emaValue);
    if (++this.samplesInWindow < this.scaleWindow) return none();
    this.samplesInWindow = 0;

    const ema = this.emaValue;
    if (ema > this.scaleDown) {
      this.badStreak += 1;
      if (this.badStreak >= this.windowsToShed && this.scaleValue > this.scaleFloor) {
        this.scaleValue = quantizeScale(Math.max(this.scaleFloor, this.scaleValue * this.downFactor));
        this.shedCount += 1;
        this.refreshReason();
        return { changed: true, scale: this.scaleValue, atFloor: this.atFloor, reason: 'down' };
      }
      return none();
    }
    if (ema <= this.scaleUp) {
      this.badStreak = 0;
      if (this.scaleValue < this.scaleCeiling) {
        this.scaleValue = quantizeScale(Math.min(this.scaleCeiling, this.scaleValue * this.upFactor));
        this.refreshReason();
        return { changed: true, scale: this.scaleValue, atFloor: this.atFloor, reason: 'up' };
      }
      return none();
    }
    // Banda muerta: ni pierde ni sobra. Reinicia la racha mala para no arrastrar
    // islas aisladas en el historial; a la próxima pérdida real se vuelve a contar.
    this.badStreak = 0;
    return none();
  }

  setManual(setting: QualitySetting): QualityChange {
    this.mode = setting;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.goodViaCpuOnly = false;
    this.samples.length = 0;
    this.cpuSamples.length = 0;
    if (setting !== 'auto') {
      this.presetValue = setting;
      this.refreshReason();
      return { changed: true, preset: this.presetValue, reason: 'manual' };
    }
    this.refreshReason();
    return { changed: false, preset: this.presetValue, reason: 'none' };
  }

  /** Reinicia la señal de escala y vuelve a la escala dada (nuevo preset, cambio manual). */
  resetScale(scale = this.scaleCeiling): void {
    this.emaValue = null;
    this.samplesInWindow = 0;
    this.badStreak = 0;
    this.scaleValue = quantizeScale(Math.min(this.scaleCeiling, Math.max(this.scaleFloor, Number.isFinite(scale) ? scale : this.scaleCeiling)));
    this.refreshReason();
  }

  /**
   * Recreado del shell (goToMenu): estado de decisión fresco, exactamente como un controlador
   * recién construido. La oferta del nivel persistido sigue gobernada por el flag de boot,
   * así que un recreado vuelve a la escalada clásica, igual que antes del refactor.
   */
  freshShell(initial: QualitySetting): void {
    this.freshDecisionState(initial);
    this.refreshReason();
  }

  get setting(): QualitySetting {
    return this.mode;
  }

  get preset(): ResolvedQuality {
    return this.presetValue;
  }

  /** Escala actual del render ∈ (0, 1]. 1 = presupuesto completo del preset. */
  get scale(): number {
    return this.scaleValue;
  }

  get atFloor(): boolean {
    return this.scaleValue <= this.scaleFloor + 1e-9;
  }

  get atCeiling(): boolean {
    return this.scaleValue >= this.scaleCeiling - 1e-9;
  }

  /** Cuántas veces ha recortado esta sesión. */
  get shed(): number {
    return this.shedCount;
  }

  /** La decisión vigente, con su razón: lo que leen el renderer y el panel. */
  get decision(): ResolutionDecision {
    return this.decisionValue;
  }
}

// ---------------------------------------------------------------- un solo dueño vivo

/**
 * La decisión es UNA por página: el shell crea la política primero (el QualityController del
 * GameApp) y el renderer adopta la misma instancia. Los tests que inyectan opciones construyen
 * políticas privadas y no tocan esta instancia.
 */
let sharedPolicy: ResolutionPolicy | null = null;

/** Puerto del shell: crea la política viva o devuelve el control a un estado fresco (goToMenu). */
export function claimResolutionPolicy(initial: QualitySetting = 'auto'): ResolutionPolicy {
  if (!sharedPolicy) {
    sharedPolicy = new ResolutionPolicy(initial);
    return sharedPolicy;
  }
  sharedPolicy.freshShell(initial);
  return sharedPolicy;
}

/** Puerto del renderer: adopta la política viva sin tocar su estado. */
export function sharedResolutionPolicy(): ResolutionPolicy {
  sharedPolicy ??= new ResolutionPolicy();
  return sharedPolicy;
}
