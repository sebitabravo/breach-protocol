/**
 * P3 (product reset, D5/S7/S10): fachadas sobre el dueño único de la decisión.
 *
 * La lógica de decisión ya no vive acá: `ResolutionPolicy`
 * (core/resolution-policy.ts) responde la única pregunta de resolución — qué
 * preset y qué escala aplican, y por qué — y codifica la precedencia. Este
 * módulo conserva las dos puertas históricas para sus consumidores:
 *
 * - `QualityController`: la puerta del shell. El loop le pasa el frame time;
 *   sin opciones adopta/renueva la política viva compartida con el renderer.
 * - `AdaptiveScale`: la puerta compat para tests que inyectan una escala
 *   aparte; siempre construye una política privada.
 *
 * Ambas delegan sin decidir nada: cada método es un paso directo a la política.
 */
import { claimResolutionPolicy, probeGfxSignature, ResolutionPolicy, type AdaptiveReadout, type QualityChange, type QualitySetting, type ResolvedQuality, type ResolutionPolicyOptions, type ScaleDecision } from './resolution-policy';

export type { QualitySetting, ResolvedQuality, QualityChange, AdaptiveReadout, ScaleDecision };
export { probeGfxSignature };

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
  storage?: import('./settings').StorageLike;
  /**
   * Firma gráfica actual; `null` cuando el navegador no colabora. Por defecto la sonda local.
   */
  signature?: () => string | null;
  /**
   * Control del punto de partida verificado: `undefined` = la vía de producción
   * (una oferta por carga de página), `true` = aplicar sin consumir el flag de boot
   * (inyección para tests), `false` = nunca aplicar.
   */
  applyVerified?: boolean;
}

export class QualityController {
  private readonly policy: ResolutionPolicy;

  constructor(initial: QualitySetting = 'auto', options?: QualityOptions) {
    // Sin opciones: la vía de producción — la política viva, compartida con el
    // renderer; un recreado del shell (goToMenu) la devuelve a estado fresco.
    // Con opciones (tests): política privada, aislada.
    this.policy = options === undefined ? claimResolutionPolicy(initial) : new ResolutionPolicy(initial, options);
  }

  get setting(): QualitySetting {
    return this.policy.setting;
  }

  get preset(): ResolvedQuality {
    return this.policy.preset;
  }

  setManual(setting: QualitySetting): QualityChange {
    return this.policy.setManual(setting);
  }

  /**
   * Feeds one frame time in milliseconds. `cpuMs` (tiempo de CPU del render) permite subir de preset
   * en pantallas atadas a vsync; `adaptive`, si viene, reemplaza la lectura interna de la escala.
   * La precedencia (retener bajadas mientras la escala recorta sobre el piso, bloquear subidas bajo
   * el techo) vive en la política.
   */
  sample(frameMs: number, now: number, cpuMs?: number, adaptive?: AdaptiveReadout): QualityChange {
    const decision = this.policy.sample(frameMs, now, cpuMs, adaptive);
    return {
      changed: decision.presetReason === 'down' || decision.presetReason === 'up',
      preset: decision.preset,
      reason: decision.presetReason,
    };
  }
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
  /** Paso de recorte multiplicativo por ventana confirmada. 0.85: rápido. */
  downFactor?: number;
  /** Paso de recuperación multiplicativo por ventana con holgura. 1.05: lento. */
  upFactor?: number;
  /** Piso del factor. 0.5: a mitad de resolución lineal (¼ de píxeles) la ROM ya es ilegible. */
  floor?: number;
  /** Techo del factor: siempre 1 (el presupuesto del preset es el máximo, nunca se supera). */
  ceiling?: number;
}

/**
 * Puerta compat de la escala arbitrable: los umbrales exactos de producción son los de la
 * política; acá solo se remapean los nombres de opciones históricos.
 */
function scalePolicyOptions(options: AdaptiveScaleOptions): ResolutionPolicyOptions {
  return {
    scaleWindowSize: options.windowSize,
    scaleEmaAlpha: options.emaAlpha,
    scaleDownThresholdMs: options.downThresholdMs,
    scaleUpThresholdMs: options.upThresholdMs,
    windowsToShed: options.windowsToShed,
    windowsToWarmup: options.windowsToWarmup,
    downFactor: options.downFactor,
    upFactor: options.upFactor,
    floor: options.floor,
    ceiling: options.ceiling,
  };
}

export class AdaptiveScale {
  private readonly policy: ResolutionPolicy;

  constructor(options: AdaptiveScaleOptions = {}) {
    // La puerta compat siempre es una política privada: nunca compite con la
    // decisión viva de producción.
    this.policy = new ResolutionPolicy('auto', scalePolicyOptions(options));
  }

  /**
   * Un frame. Ignora muestras hostiles (NaN, ≤0, >250 — pausas, pestaña oculta) exactamente
   * como el puerto del preset; no llenan la ventana ni mueven el EMA.
   */
  sample(frameMs: number): ScaleDecision {
    return this.policy.sampleRenderSignal(frameMs);
  }

  /** Escala actual del render ∈ (0, 1]. 1 = presupuesto completo del preset. */
  get scale(): number {
    return this.policy.scale;
  }

  get atFloor(): boolean {
    return this.policy.atFloor;
  }

  get atCeiling(): boolean {
    return this.policy.atCeiling;
  }

  /** Cuántas veces ha recortado esta sesión. */
  get shed(): number {
    return this.policy.shed;
  }

  /** Reinicia la señal y vuelve a la escala dada (nuevo preset, cambio manual). */
  reset(scale = 1): void {
    this.policy.resetScale(scale);
  }
}
