/**
 * Composition root: arranca el núcleo WASM, el renderer y la UI, conduce el flujo
 * de pantallas y ejecuta el bucle de paso fijo.
 *
 * No reimplementa reglas de simulación: reenvía input, lee el snapshot y decide
 * qué pantalla está visible.
 */
import { Engine, type Snapshot, type WorldEvent } from '../wasm/bridge';
import { EVT, H, INPUT_LEN, N, NODE_BASE, NODE_STRIDE, PHASE, WEAPON } from '../wasm/protocol';
import type { Renderer } from '../render/renderer';
import { InputManager, type InputHooks } from '../input/input';
import type { AudioManager } from '../audio/audio';
import { Hud, type MatchView } from '../ui/hud';
import { ObjectiveMarker } from '../ui/objective-marker';
import { Engineering } from '../ui/engineering';
import { BootView, webgl2Supported } from '../ui/boot-view';
import { renderResult } from '../ui/results';
import { SettingsForm, type SettingsView } from '../ui/settings-form';
import { byId } from '../ui/dom';
import { recommendedSector, renderBriefing, renderMenu, renderSectorCards } from '../ui/campaign-view';
import { renderBoardLoading, renderBoardPanel, renderBoardRows, boardLabel, type BoardPanel } from '../ui/board-view';
import { renderTutorial, renderTutorialHandoff } from '../ui/tutorial-view';
import { QualityController } from './quality';
import { FIXED_DT, FixedStepLoop } from './loop';
import { loadSettings, resetSettings, saveSettings, gfxOverridesOf, type Locale, type Quality, type Settings } from './settings';
import { bestScore, saveScore, type RunResult } from './scores';
import { buildRunResult, buildStartOptions } from './match';
import { effectsOf } from './events';
import { dailySeed, utcDateKey } from './daily';
import {
  ProgressStore,
  isSectorCleared,
  isSectorUnlocked,
  isShotgunUnlocked,
  markTutorialSeen,
  recordDailyPlay,
  recordMission,
  recordOverflow,
  setPlayerName,
  type ProgressState,
} from './progress';
import { SECTOR_IDS, SECTORS, sectorInfo, type SectorId } from './sectors';
import {
  continueTutorial,
  observeTutorial,
  skipTutorial,
  SkipConfirm,
  startTutorial,
  TUTORIAL_TERMINAL,
  TUTORIAL_TERMINAL_STEP,
  type TutorialOutcome,
  type TutorialState,
} from './tutorial';
import { boardFor, fetchBoard, sanitizeName, submitRun, type BoardKey, type RunMode } from '../net/leaderboard';
import { MUTATORS, type MapData, type Mutator } from '../world/map';
import {
  INITIAL_FLOW,
  escapeAction,
  pauseSubtitle,
  pointerLockErrorAction,
  pointerLockLostAction,
  transition,
  type FlowEvent,
  type FlowState,
  type Mode,
  type PauseOrigin,
} from './screens';

const ENGINE_URL = `${import.meta.env.BASE_URL}bp_core.wasm`;
const LEADERBOARD_LIMIT = 20;
const DEFAULT_BOARD = 'mission:s01';

type TutorialExit = { type: 'tutorial-handoff'; outcome: TutorialOutcome; elapsedSeconds: number };
type GameEvent = FlowEvent | TutorialExit;
type GameFlow = FlowState | (Omit<FlowState, 'screen'> & {
  screen: 'tutorial-handoff';
  outcome: TutorialOutcome;
  elapsedSeconds: number;
});

function transitionGame(flow: GameFlow, event: GameEvent): GameFlow {
  if (event.type === 'tutorial-handoff') {
    if (flow.screen !== 'playing' || flow.mode !== 'practice') return flow;
    return { ...flow, screen: 'tutorial-handoff', outcome: event.outcome, elapsedSeconds: event.elapsedSeconds };
  }
  if (flow.screen !== 'tutorial-handoff') return transition(flow, event);
  // Esta pausa solo se puede resolver con una de las tres decisiones de la ficha.
  if (event.type === 'resume' || (event.type === 'start' && event.mode === 'run') ||
      (event.type === 'open' && event.screen === 'menu')) {
    return transition({ screen: 'pause', mode: flow.mode, mapId: flow.mapId, pauseOrigin: 'game' }, event);
  }
  return flow;
}

interface PendingRun {
  board: BoardKey | null;
  reason: string;
  log: Uint8Array;
  submitted: boolean;
}

function clampSector(id: number): SectorId {
  return SECTOR_IDS.find((sector) => sector === id) ?? 0;
}

function ineligibleReason(mode: Mode, won: boolean, shotgunEnabled: boolean): string {
  if (mode === 'practice') return 'El simulador no cuenta para ningún tablero.';
  if (shotgunEnabled) return 'Las partidas con SG-08 no entran al tablero: el desbloqueo no se puede verificar.';
  if (mode === 'run' && !won) return 'Las derrotas de misión no entran al tablero. Reintentá el sector.';
  return 'Esta partida no entra a ningún tablero.';
}

/**
 * Resiliencia de arranque (T5c, estudio REA): gate de capacidades y recuperación
 * de un boot que no termina. Sin user-agent: cada requisito se verifica por
 * capability; la lista sale de lo que el bundle construido llama de verdad en
 * el camino de arranque (ver el comentario de cada API).
 */
export type BootCapability = 'wasm' | 'webgl2' | 'runtime';
export type BootProbes = Record<BootCapability, boolean>;

/** Primer umbral, generoso: un dispositivo lento pero funcional termina debajo
 *  (payload hasta boot ≈ 267 KiB gzip; el arranque medido entero es de segundos:
 *  docs/performance-budget.md). Solo superficie un aviso, nunca corta nada. */
export const BOOT_SLOW_MS = 24_000;
/** Segundo umbral: recién aquí se ofrece Reintentar. Nunca para una carga que
 *  sigue avanzando: triplica el margen del peor network que funcione. */
export const BOOT_STALLED_MS = 60_000;

/** APIs modernas que los chunks construidos invocan en el arranque:
 *  - AbortController: GameApp (controlador del shell) y three (carga de recursos).
 *  - AbortSignal.timeout: wasm/bridge.ts (fetch del núcleo con corte temporal).
 *  - ResizeObserver: ui/objective-marker.ts, instanciado dentro de boot().
 *  - replaceChildren: ui/campaign-view.ts y ui/board-view.ts, via refreshMenu() en boot().
 *  La sintaxis es2022 (vite.config.ts build.target; campos privados #x en el
 *  output) no es detectable en runtime: la cubre el piso declarado abajo. */
export const BOOT_REQUIRED_RUNTIME_APIS = [
  'AbortController',
  'AbortSignal.timeout',
  'ResizeObserver',
  'replaceChildren',
] as const;

/** Piso de compatibilidad declarado: el API más exigente del arranque es
 *  AbortSignal.timeout (Chrome 103, Firefox 100, Safari 16); todo lo demás
 *  (ResizeObserver, replaceChildren, sintaxis es2022 con campos privados) es
 *  más viejo. Solo es texto declarado: la decisión real es la capability. */
export const BOOT_MINIMUM_BROWSERS = [
  { name: 'Chrome', version: 103 },
  { name: 'Firefox', version: 100 },
  { name: 'Safari', version: 16 },
] as const;

/** Verifica por presencia, no por UA. Cada check es detectable sin navegador
 *  completo: `typeof` y un prototype. */
export function probeBootRuntime(): boolean {
  try {
    return (
      typeof AbortController === 'function' &&
      typeof AbortSignal === 'function' &&
      typeof AbortSignal.timeout === 'function' &&
      typeof ResizeObserver === 'function' &&
      typeof Element.prototype.replaceChildren === 'function'
    );
  } catch {
    return false;
  }
}

export function missingCapabilities(probes: BootProbes): BootCapability[] {
  const missing: BootCapability[] = [];
  for (const capability of ['wasm', 'webgl2', 'runtime'] as const) {
    if (!probes[capability]) missing.push(capability);
  }
  return missing;
}

export type BootSlowState = 'in-time' | 'slow' | 'stalled';

/** Estado puro del gate de estancamiento: `slow` superficie el aviso;
 *  recién `stalled` (segundo umbral) ofrece la acción de recuperación. */
export function bootSlowState(
  elapsedMs: number,
  slowMs = BOOT_SLOW_MS,
  stalledMs = BOOT_STALLED_MS,
): BootSlowState {
  if (elapsedMs >= stalledMs) return 'stalled';
  if (elapsedMs >= slowMs) return 'slow';
  return 'in-time';
}

/** Forzar los estados a demanda para verificación, espejo del `?viewmodel` del
 *  renderer: `?boot=slow` y `?boot=unsupported`. Cualquier otro valor es `auto`. */
export function forcedBootState(search: string): 'auto' | 'slow' | 'unsupported' {
  const value = new URLSearchParams(search).get('boot');
  return value === 'slow' || value === 'unsupported' ? value : 'auto';
}

/** Engineering Mode es de desarrollo: entra por bandera de query (`?dev=1`, mismo
 *  mecanismo que `?boot=` y `?viewmodel=`) o por el toggle F3 en partida. Nunca
 *  por el menú de jugador. */
export function devEngineeringRequested(search: string): boolean {
  return new URLSearchParams(search).get('dev') === '1';
}

/** Rótulos de la resiliencia de arranque. La página base va en español (lang="es")
 *  y el único mecanismo de idioma del proyecto es `settings.locale` (es/en),
 *  igual que los rótulos gráficos de SettingsForm: se resuelven desde el idioma
 *  cargado, sin una segunda vía de traducción en el marcado. */
export interface BootCopy {
  slow: string;
  unsupportedTitle: string;
  unsupportedBody: string;
  floor: string;
  retry: string;
  items: Record<BootCapability, string>;
}

const BOOT_COPY: Record<Locale, BootCopy> = {
  es: {
    slow: 'el arranque está tardando más de lo usual…',
    unsupportedTitle: 'Este navegador no puede iniciar el protocolo',
    unsupportedBody: 'Faltan capacidades obligatorias para ejecutar el juego. Probá una versión actualizada de:',
    floor: 'versiones mínimas',
    retry: 'Reintentar',
    items: {
      wasm: 'WebAssembly (núcleo de simulación)',
      webgl2: 'WebGL2 (render del juego)',
      runtime: `APIs del arranque: ${BOOT_REQUIRED_RUNTIME_APIS.join(', ')}`,
    },
  },
  en: {
    slow: 'Boot is taking longer than usual…',
    unsupportedTitle: 'This browser cannot start the protocol',
    unsupportedBody: 'Required capabilities to run the game are missing. Try an updated version of:',
    floor: 'minimum versions',
    retry: 'Retry',
    items: {
      wasm: 'WebAssembly (simulation core)',
      webgl2: 'WebGL2 (game renderer)',
      runtime: `Boot APIs: ${BOOT_REQUIRED_RUNTIME_APIS.join(', ')}`,
    },
  },
};

export function bootCopy(locale: Locale): BootCopy {
  return BOOT_COPY[locale];
}

export class GameApp {
  private readonly canvas = byId<HTMLCanvasElement>('gl');
  private readonly app = byId('app');
  private readonly crosshair = byId('crosshair');
  private channelPercent = 0;
  /** Un solo controlador: `dispose()` corta todos los listeners del shell de una vez. */
  private readonly abort = new AbortController();
  private readonly settingsForm = new SettingsForm(this.app, {
    onPatch: (patch) => this.updateSettings(patch),
    onTelemetry: (visible) => {
      if (this.eng?.visible !== visible) this.toggleEngineering();
    },
    usingTouch: () => this.input?.usingTouch ?? false,
  });

  private engine: Engine | null = null;
  private renderer: Renderer | null = null;
  private input: InputManager | null = null;
  private hud: Hud | null = null;
  private objectiveMarker: ObjectiveMarker | null = null;
  private readonly motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private map: MapData | null = null;
  private mutator: Mutator = 'none';
  private eng: Engineering | null = null;

  private settings: Settings = loadSettings();
  private progress = ProgressStore.open({ legacyTutorialSeen: this.settings.tutorialSeen });
  private quality = new QualityController(this.settings.quality);
  private loop = new FixedStepLoop();
  private hooks = {
    reducedMotion: false,
    onContextLost: (): void => this.handleContextLost(),
    onContextRestored: (): void => this.handleContextRestored(),
  };

  private flow: GameFlow = INITIAL_FLOW;
  private matchDate = utcDateKey(new Date());
  /** El registro reclama el desbloqueo desde el arranque, incluso si nunca se equipa. */
  private matchShotgunEnabled = false;
  private tutorial: TutorialState | null = null;
  private tutorialTerminal = -1;
  private tutorialOrigin = { x: 0, z: 0 };
  private pending: PendingRun | null = null;
  private submitting = false;
  private readonly skipConfirm = new SkipConfirm();
  private readonly destructiveConfirm = new Map<string, SkipConfirm>();
  private boardToken = 0;
  private lastSeq = 0;
  private events: WorldEvent[] = [];
  private frameSamples: number[] = [];
  private lastNow = 0;
  private rafId = 0;
  private finished = false;
  private wasmKib = 0;
  private loadMs = 0;
  private lastEngineeringAt = 0;
  private bootAt = performance.now();

  constructor(private readonly audio: AudioManager) {}

  // ------------------------------------------------------------------ boot

  async boot(takeIntent: () => HTMLElement | undefined): Promise<void> {
    const view = new BootView();
    const forced = forcedBootState(window.location.search);
    const copy = bootCopy(this.settings.locale);
    // La acción de recuperación vive en la pantalla de boot y recarga la página:
    // se ata acá porque bindGlobalUI solo corre si el arranque completa.
    byId('boot-retry').addEventListener('click', () => window.location.reload(), { signal: this.abort.signal });

    // Aviso y recuperación de un boot que no termina (T5c): un intervalo lee el
    // gate puro; superficie el aviso en el primer umbral y Reintentar en el segundo.
    const bootStartedAt = performance.now();
    const surfaceBootSlow = (kind: 'slow' | 'stalled'): void => {
      const note = byId('boot-slow');
      note.textContent = copy.slow;
      note.hidden = false;
      if (kind === 'stalled') byId('boot-retry').hidden = false;
    };
    if (forced === 'slow') surfaceBootSlow('slow');
    const watchId = window.setInterval(() => {
      const kind = bootSlowState(performance.now() - bootStartedAt);
      if (kind !== 'in-time') surfaceBootSlow(kind);
    }, 500);
    const stopBootWatch = (): void => {
      window.clearInterval(watchId);
      byId('boot-slow').hidden = true;
      byId('boot-retry').hidden = true;
    };

    try {
      const audioOk = 'AudioContext' in window || 'webkitAudioContext' in window;
      view.setCheck('audio', audioOk ? 'ok' : 'fail');
      view.setProgress(12);

      // Gate de capacidades antes de descargar nada pesado: una máquina que no
      // puede correr el juego no paga el núcleo ni Three.js.
      // `?boot=unsupported` fuerza el set completo para verificar la pantalla.
      const probes: BootProbes = {
        wasm:
          typeof WebAssembly === 'object' &&
          typeof WebAssembly.instantiate === 'function' &&
          typeof WebAssembly.Memory === 'function',
        webgl2: webgl2Supported(),
        runtime: probeBootRuntime(),
      };
      const missing = forced === 'unsupported'
        ? missingCapabilities({ wasm: false, webgl2: false, runtime: false })
        : missingCapabilities(probes);
      if (missing.length > 0) {
        for (const capability of missing) {
          if (capability !== 'runtime') view.setCheck(capability, 'fail');
        }
        stopBootWatch();
        this.renderBootUnsupported(missing, copy);
        this.dispatch({ type: 'boot-failed' });
        return;
      }

      const startedAt = performance.now();
      const [engine, { Renderer }] = await Promise.all([
        Engine.load(ENGINE_URL).then((loaded) => {
          this.wasmKib = loaded.wasmBytes / 1024;
          view.setCheck('wasm', 'ok');
          view.setProgress(46);
          return loaded;
        }),
        import('../render/renderer'),
      ]);
      this.engine = engine;

      if (!webgl2Supported()) {
        view.setCheck('webgl2', 'fail');
        throw new Error('webgl2');
      }
      this.renderer = new Renderer(this.canvas, this.hooks);
      this.renderer.init();
      this.renderer.setQuality(this.quality.preset, this.dprCap());
      this.renderer.resize();
      view.setCheck('webgl2', 'ok');
      view.setProgress(72);

      this.map = this.engine.loadMap(0);
      if (this.map.solids.length === 0) throw new Error('arena vacía');
      this.renderer.setSector(this.map);
      view.setCheck('arena', 'ok');
      this.loadMs = performance.now() - startedAt;
      view.setProgress(92);

      this.input = new InputManager(this.canvas, this.inputHooks(), this.settings);
      this.input.attach();
      this.hud = new Hud();
      this.hud.setMap(this.map);
      this.objectiveMarker = new ObjectiveMarker();
      this.eng = new Engineering();

      this.applySettings();
      this.settingsForm.attach(this.abort.signal);
      this.syncSettingsUI();
      this.refreshMenu();
      this.wireDisplayEvents();
      // Un boot completo nunca debe dejar el aviso o el Reintento del gate visibles,
      // ni dejar su intervalo vivo.
      stopBootWatch();
      view.setProgress(100);
      view.setMeta(`núcleo listo · ${this.wasmKib.toFixed(1)} KiB · ${this.loadMs.toFixed(0)} ms`);

      this.bindGlobalUI();
      const intent = takeIntent();
      // P4: ningún boot completo pasa por calibración; el menú es la pantalla de aterrizaje.
      this.dispatch({ type: 'boot-complete' });
      if (intent) this.activateControl(intent);

      // Engineering Mode solo desarrollo: bandera de query o F3 en partida.
      if (devEngineeringRequested(window.location.search) && this.eng.toggle(true)) {
        this.updateEngineering(performance.now(), this.engine.state, true);
        this.syncSettingsUI();
      }

      this.lastNow = performance.now();
      this.rafId = requestAnimationFrame(this.frame);
    } catch (error) {
      stopBootWatch();
      this.resetFallbackToError();
      view.setFailure(error);
      this.dispatch({ type: 'boot-failed' });
    }
  }

  /** Pantalla dedicada de navegador sin soporte: nombra lo que falta, el piso de
   *  versiones y la única acción útil (ir a un navegador actualizado; Reintentar
   *  no puede crear una capability). */
  private renderBootUnsupported(missing: readonly BootCapability[], copy: BootCopy): void {
    const section = byId('screen-fallback');
    section.dataset.boot = 'unsupported';
    byId('fallback-title').textContent = copy.unsupportedTitle;
    byId('fallback-detail').textContent = copy.unsupportedBody;
    const list = byId('fallback-missing');
    list.replaceChildren(...missing.map((id) => {
      const item = document.createElement('li');
      item.className = 'check';
      item.setAttribute('data-state', 'fail');
      const dot = document.createElement('span');
      dot.className = 'check__dot';
      item.append(dot, copy.items[id]);
      return item;
    }));
    list.hidden = false;
    byId('fallback-floor').textContent =
      `${copy.floor}: ${BOOT_MINIMUM_BROWSERS.map((browser) => `${browser.name} ${browser.version}+`).join(' · ')}`;
    byId('fallback-floor').hidden = false;
    byId('fallback-retry').hidden = true;
  }

  /** El camino de error genérico conserva su forma original: la variante sin
   *  soporte y sus elementos extra solo existen mientras la pantalla lo dice. */
  private resetFallbackToError(): void {
    const section = byId('screen-fallback');
    section.dataset.boot = 'error';
    byId('fallback-missing').hidden = true;
    byId('fallback-floor').hidden = true;
    byId('fallback-retry').hidden = false;
  }

  private handleContextLost(): void {
    if (this.flow.screen === 'playing') this.pause('game');
    this.app.dataset.ctx = 'lost';
    byId('context-lost').hidden = false;
  }

  private handleContextRestored(): void {
    this.app.dataset.ctx = 'ok';
    byId('context-lost').hidden = true;
  }

  private dprCap(): number {
    const base = window.devicePixelRatio || 1;
    return Math.min(base, this.input?.usingTouch ? 1.75 : 2);
  }

  // --------------------------------------------------------------- screens

  /** Aplica el estado del flujo al DOM: pantalla visible, foco y puntero. */
  private apply(): void {
    const flow = this.flow;
    const screen = flow.screen;
    if (screen === 'tutorial-handoff') renderTutorialHandoff(flow.outcome, flow.elapsedSeconds);
    this.app.dataset.screen = screen;
    this.objectiveMarker?.invalidate();
    if (screen === 'playing') {
      this.input?.reset();
      this.canvas.focus({ preventScroll: true });
      return;
    }
    this.objectiveMarker?.hide();
    this.input?.releasePointerLock();
    this.input?.reset();
    if (screen !== 'boot') {
      const section = this.app.querySelector(`#screen-${screen}`);
      if (!section?.contains(document.activeElement)) {
        const target = section?.querySelector<HTMLElement>('[data-autofocus]') ??
          section?.querySelector<HTMLElement>('[data-action], button, a');
        target?.focus({ preventScroll: true });
      }
    }
  }

  /** Aplica un evento del flujo; devuelve falso si la transición no está permitida. */
  private dispatch(event: GameEvent): boolean {
    const next = transitionGame(this.flow, event);
    if (next === this.flow) return false;
    this.flow = next;
    this.apply();
    return true;
  }

  get currentScreen(): GameFlow['screen'] {
    return this.flow.screen;
  }

  /**
   * Gancho de automatización: avanza una partida en curso con entrada neutra hasta
   * que termina (muerte o tiempo). Se niega en práctica, que no tiene fin.
   */
  debugRunToEnd(maxTicks = 12_000): boolean {
    if (this.flow.screen !== 'playing' || this.flow.mode === 'practice' || !this.engine) return false;
    const neutral = new Float32Array(INPUT_LEN);
    for (let tick = 0; tick < maxTicks && this.engine.state.phase === PHASE.playing; tick += 1) {
      this.engine.tick(neutral);
    }
    return this.engine.state.phase === PHASE.win || this.engine.state.phase === PHASE.lose;
  }

  // ------------------------------------------------------------- match flow

  async startMatch(mode: Mode, mapId = 0, options: { tutorial?: boolean } = {}): Promise<void> {
    if (!this.engine || !this.renderer || !this.input || this.renderer.isContextLost) return;
    if (transitionGame(this.flow, { type: 'start', mode, mapId }) === this.flow) return;

    this.audio.unlock();
    this.audio.resume();
    this.matchDate = utcDateKey(new Date());
    const seed = mode === 'daily' ? dailySeed(new Date()) : (Math.random() * 0xffffffff) >>> 0;
    const shotgunEnabled = isShotgunUnlocked(this.progress.state);
    const started = this.engine.start(
      buildStartOptions({
        mode,
        mapId,
        seed,
        aimAssist: this.settings.aimAssistTouch && this.input.usingTouch,
        autoReload: this.settings.autoReload,
        shotgun: shotgunEnabled,
      }),
    );
    if (!started) throw new Error(`no se pudo iniciar el sector ${mapId}`);
    this.matchShotgunEnabled = shotgunEnabled;

    this.syncMap();
    this.finished = false;
    this.pending = null;
    this.submitting = false;
    this.renderer.resetFeedback();
    this.lastSeq = 0;
    this.events.length = 0;
    this.loop.reset();
    this.hud?.reset();
    this.hud?.setMatch(this.matchView(mode));
    this.lastNow = performance.now();

    this.tutorial = mode === 'practice' && options.tutorial !== false
      ? startTutorial(this.progress.state.tutorialSeen, options.tutorial === true) : null;
    this.tutorialTerminal = -1;
    this.objectiveMarker?.hide();
    this.tutorialOrigin = { x: this.engine.state.px, z: this.engine.state.pz };
    this.renderTutorialNow();

    this.dispatch({ type: 'start', mode, mapId });
    this.renderer.setQuality(this.quality.preset, this.dprCap());
    this.audio.play('wave');
    void this.input.requestPointerLock();
  }

  /** Toma el mapa que la simulación cargó: en Protocolo Diario lo decide la semilla, no el menú. */
  private syncMap(): void {
    if (!this.engine || !this.renderer) return;
    const data = this.engine.mapData();
    // El núcleo publica el mutador en el snapshot (H.mutator), no en la tabla del mapa.
    this.mutator = MUTATORS[this.engine.state.at(H.mutator)] ?? 'none';
    if (this.map?.id === data.id) return;
    this.map = data;
    this.renderer.setSector(data);
    this.hud?.setMap(data);
  }

  private matchView(mode: Mode): MatchView {
    const unlocked = this.unlockedWeapons();
    const sector = sectorInfo(clampSector(this.map?.id ?? 0));
    const labels: Record<Mode, { code: string; name: string }> = {
      run: { code: sector.code.replace('_', ' '), name: sector.title },
      overflow: { code: 'OVERFLOW', name: sector.title },
      daily: { code: 'DIARIO', name: sector.title },
      practice: { code: 'SIMULADOR', name: 'Campo de práctica' },
    };
    return {
      mode,
      sectorCode: labels[mode].code,
      sectorName: labels[mode].name,
      dateKey: this.matchDate,
      mutator: this.mutator,
      unlockedWeapons: unlocked,
    };
  }

  private unlockedWeapons(): number[] {
    return isShotgunUnlocked(this.progress.state)
      ? [WEAPON.sidearm, WEAPON.carbine, WEAPON.shotgun]
      : [WEAPON.sidearm, WEAPON.carbine];
  }

  private pause(origin: PauseOrigin = this.flow.pauseOrigin): void {
    if (!this.dispatch({ type: 'pause', origin })) return;
    byId('pause-sub').textContent = pauseSubtitle(this.flow.mode, this.flow.mapId);
    this.syncPauseLabels();
    this.audio.suspend();
  }

  private syncPauseLabels(): void {
    const resume = this.app.querySelector<HTMLElement>('#screen-pause [data-action="resume"]');
    if (resume) resume.textContent = this.flow.pauseOrigin === 'menu' ? 'Volver ▸' : 'Continuar ▸';
  }

  private resume(): void {
    if (!this.engine || this.renderer?.isContextLost) return;
    if (!this.dispatch({ type: 'resume' })) return;
    this.loop.reset();
    this.lastNow = performance.now();
    this.audio.resume();
    void this.input?.requestPointerLock();
  }

  private openSettingsFromMenu(): void {
    if (!this.dispatch({ type: 'settings' })) return;
    byId('pause-sub').textContent = 'Ajustes del protocolo';
    this.syncPauseLabels();
  }

  private goToMenu(): void {
    // Volver desde la calibración de una pausa en curso regresa a la pausa: no hay
    // partida que abandonar. El menú es el destino solo sin partida viva detrás.
    if (this.flow.screen === 'calibrate' && this.flow.pauseOrigin === 'game') {
      if (this.dispatch({ type: 'open', screen: 'pause' })) {
        byId('pause-sub').textContent = pauseSubtitle(this.flow.mode, this.flow.mapId);
        this.syncPauseLabels();
      }
      return;
    }
    if (!this.dispatch({ type: 'open', screen: 'menu' })) return;
    this.audio.suspend();
    this.refreshMenu();
    this.quality = new QualityController(this.settings.quality);
    this.renderer?.setQuality(this.quality.preset, this.dprCap());
  }

  private openSectors(): void {
    if (!this.dispatch({ type: 'open', screen: 'sectors' })) return;
    renderSectorCards(this.progress.state);
  }

  private brief(mapId: number): void {
    if (!isSectorUnlocked(this.progress.state, clampSector(mapId))) return;
    if (!this.dispatch({ type: 'brief', mapId })) return;
    renderBriefing(clampSector(mapId));
  }

  private finish(won: boolean): void {
    if (this.finished || !this.engine) return;
    this.finished = true;
    const mode = this.flow.mode;
    const run = buildRunResult(this.engine.state, {
      mode,
      input: this.input?.usingTouch ? 'touch' : 'mouse',
      won,
      at: Date.now(),
    });
    const previousBest = bestScore(run.mode);
    saveScore(run);
    const before = this.progress.state;
    const after = this.recordOutcome(run);
    const truncated = this.engine.logTruncated;
    this.pending = this.capturePending(mode, won, truncated);
    renderResult(run, run.score > 0 && run.score > (previousBest ?? 0), truncated);
    this.renderUnlocks(before, after, won);
    byId<HTMLInputElement>('board-name').value = this.progress.state.playerName;
    renderBoardPanel(this.boardPanel());
    this.dispatch({ type: 'finish' });
    this.audio.play(won ? 'win' : 'lose');
  }

  /** Actualiza el progreso con el resultado; el progreso es la fuente de unlocks y records. */
  private recordOutcome(run: RunResult): ProgressState {
    const state = this.progress.state;
    let next = state;
    if (this.flow.mode === 'run') {
      next = recordMission(state, {
        sector: clampSector(this.flow.mapId),
        won: run.won,
        score: run.score,
        timeMs: run.durationMs,
      });
    } else if (this.flow.mode === 'overflow') {
      next = recordOverflow(state, { wave: this.engine?.state.wave ?? 0, score: run.score });
    } else if (this.flow.mode === 'daily') {
      next = recordDailyPlay(state, this.matchDate);
    }
    return this.progress.update(next);
  }

  /** Conserva el registro elegible antes de que la siguiente partida reinicie el grabador. */
  private capturePending(mode: Mode, won: boolean, truncated: boolean): PendingRun {
    const runMode: RunMode = mode === 'run' ? 'mission' : mode;
    const board = boardFor({
      mode: runMode,
      mapId: this.flow.mapId,
      won,
      dateKey: this.matchDate,
      logTruncated: truncated,
      shotgunEnabled: this.matchShotgunEnabled,
    });
    const log = board === null ? new Uint8Array() : this.engine?.encodeLog() ?? new Uint8Array();
    return { board, reason: ineligibleReason(mode, won, this.matchShotgunEnabled), log, submitted: false };
  }

  private boardPanel(): BoardPanel {
    const pending = this.pending;
    if (!pending) return { kind: 'ineligible', reason: 'Sin partida para enviar.' };
    if (pending.board === null) return { kind: 'ineligible', reason: pending.reason };
    return { kind: 'idle', where: boardLabel(pending.board) };
  }

  private renderUnlocks(before: ProgressState, after: ProgressState, won: boolean): void {
    const sector = clampSector(this.flow.mapId);
    const nextSector: SectorId | null = sector < 2 ? ((sector + 1) as SectorId) : null;
    const runWon = this.flow.mode === 'run' && won;
    const lines: string[] = [];
    if (runWon && nextSector !== null && isSectorUnlocked(after, nextSector) && !isSectorUnlocked(before, nextSector)) {
      lines.push(`${SECTORS[nextSector].code} desbloqueado`);
    }
    if (runWon && sector === 1 && isShotgunUnlocked(after) && !isShotgunUnlocked(before)) {
      lines.push('SG-08 desbloqueada');
    }
    if (runWon && sector === 2 && isSectorCleared(after, sector) && !isSectorCleared(before, sector)) {
      lines.push('Red recuperada');
    }
    byId('result-unlock').textContent = lines.length ? `Recompensa: ${lines.join(' · ')}` : '';
    byId('result-unlock').hidden = lines.length === 0;
    byId('result-next').hidden = !(runWon && nextSector !== null);
  }

  private async submitBoard(): Promise<void> {
    const pending = this.pending;
    if (!pending || pending.board === null || pending.submitted || this.submitting) return;
    this.submitting = true;
    const input = byId<HTMLInputElement>('board-name');
    const name = sanitizeName(input.value);
    if (name !== null) this.progress.update(setPlayerName(this.progress.state, name));
    renderBoardPanel({ kind: 'sending' });

    const result = await submitRun({ name: input.value, log: pending.log });
    this.submitting = false;
    // La partida terminó o empezó otra mientras tanto: el panel ya pertenece a otra corrida.
    if (this.pending !== pending) return;
    if (result.status === 'ranked') {
      pending.submitted = true;
      renderBoardPanel({ kind: 'ranked', rank: result.rank, total: result.total, where: boardLabel(result.board) });
    } else if (result.status === 'rate-limited') {
      renderBoardPanel({ kind: 'rate-limited' });
    } else if (result.status === 'rejected') {
      renderBoardPanel({ kind: 'rejected', code: result.code });
    } else {
      renderBoardPanel({ kind: 'offline' });
    }
  }

  private refreshMenu(): void {
    const best = bestScore('run');
    byId('menu-record').textContent = best === null ? 'récord: —' : `récord: ${best.toLocaleString('es-CL')}`;
    renderMenu(this.progress.state);
  }

  // ----------------------------------------------------------- leaderboard

  private openLeaderboard(): void {
    if (!this.dispatch({ type: 'open', screen: 'leaderboard' })) return;
    void this.loadBoard(DEFAULT_BOARD);
  }

  private async loadBoard(tab: string): Promise<void> {
    const key = tab === 'daily' ? (`daily:${utcDateKey(new Date())}` as BoardKey) : (tab as BoardKey);
    const token = ++this.boardToken;
    this.app.querySelectorAll<HTMLElement>('[data-board]').forEach((node) => {
      const active = node.dataset.board === tab;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderBoardLoading();
    const result = await fetchBoard(key, LEADERBOARD_LIMIT);
    if (token === this.boardToken) renderBoardRows(result);
  }

  // ------------------------------------------------------------------ tutorial

  private observeTutorialFrame(state: Snapshot): void {
    if (this.tutorial?.status !== 'active') return;
    const before = this.tutorial;
    this.setTutorialStep(observeTutorial(before, {
      metersMoved: Math.hypot(state.px - this.tutorialOrigin.x, state.pz - this.tutorialOrigin.z),
      shot: this.events.some((event) => event.type === EVT.shot),
      nodeActivated: before.step === TUTORIAL_TERMINAL_STEP &&
        (this.tutorialTerminal < 0 || this.terminalActive(state, this.tutorialTerminal)),
    }));
  }

  private setTutorialStep(next: TutorialState): void {
    if (next === this.tutorial) return;
    if (next.status !== 'active') {
      this.endTutorial(next);
      return;
    }
    const state = this.engine?.state;
    if (next.step === TUTORIAL_TERMINAL_STEP && state) {
      this.tutorialTerminal = this.map?.nodes[TUTORIAL_TERMINAL] && !this.terminalActive(state, TUTORIAL_TERMINAL)
        ? TUTORIAL_TERMINAL : this.nearestInactiveTerminal(state);
    }
    const advanced = this.tutorial?.status === 'active' && next.step > this.tutorial.step;
    this.tutorial = next;
    this.renderTutorialNow();
    if (advanced) this.celebrateTutorialStep();
    this.objectiveMarker?.invalidate();
  }

  private renderTutorialNow(): void {
    renderTutorial(this.tutorial, this.input?.usingTouch ? 'touch' : 'keyboard');
  }

  /** Avance no bloqueante: cue de audio y un destello breve del panel (apagado con reduceMotion). */
  private celebrateTutorialStep(): void {
    this.audio.play('step');
    if (this.settings.reduceMotion) return;
    const panel = byId('tutorial');
    panel.classList.remove('is-step-done');
    void panel.offsetWidth;
    panel.classList.add('is-step-done');
  }

  private endTutorial(outcome: TutorialOutcome): void {
    if (this.tutorial?.status !== 'active' || !this.engine) return;
    const elapsedSeconds = Math.floor(this.engine.state.tick * FIXED_DT);
    if (!this.dispatch({ type: 'tutorial-handoff', outcome, elapsedSeconds })) return;
    this.tutorial = null;
    renderTutorial(null);
    this.progress.update(markTutorialSeen(this.progress.state));
    this.settings = { ...this.settings, tutorialSeen: true };
    saveSettings(this.settings);
    this.audio.suspend();
  }

  private terminalActive(state: Snapshot, index: number): boolean {
    return state.at(NODE_BASE + index * NODE_STRIDE + N.active) > 0.5;
  }

  private nearestInactiveTerminal(state: Snapshot): number {
    const nodes = this.map?.nodes;
    if (!nodes) return -1;
    let target = -1, best = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      if (this.terminalActive(state, i)) continue;
      const { x, y, z } = nodes[i];
      const distanceSquared = (x - state.px) ** 2 + (y - state.py) ** 2 + (z - state.pz) ** 2;
      if (distanceSquared < best) { best = distanceSquared; target = i; }
    }
    return target;
  }

  private trackedTerminal(state: Snapshot): number {
    if (state.phase !== PHASE.playing) return -1;
    if (this.tutorial?.status !== 'active') return this.nearestInactiveTerminal(state);
    return this.tutorial.step === TUTORIAL_TERMINAL_STEP ? this.tutorialTerminal : -1;
  }

  /** Mirror the existing node bar at the reticle while the switch is in reach. */
  private updateChannelRing(state: Snapshot): void {
    const node = state.interacting >= 0 ? state.node(state.interacting) : null;
    const percent = node && !node.active ? Math.round(node.progress * 100) : 0;
    if (percent === this.channelPercent) return;
    this.channelPercent = percent;
    this.crosshair.classList.toggle('is-channeling', percent > 0);
    this.crosshair.style.setProperty('--channel', `${percent}%`);
  }

  // ------------------------------------------------------------------ loop

  private frame = (now: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const rawDt = this.lastNow === 0 ? 1 / 60 : (now - this.lastNow) / 1000;
    this.lastNow = now;
    const frameMs = rawDt * 1000;
    this.frameSamples.push(frameMs);
    if (this.frameSamples.length > 120) this.frameSamples.shift();
    this.eng?.pushFrame(frameMs);

    if (!this.renderer) return;

    if (this.flow.screen === 'playing' && this.renderer.isContextLost) {
      this.pause('game');
    } else if (this.flow.screen === 'playing' && this.engine && this.input) {
      const step = this.loop.advance(rawDt);
      if (step.dropped > 0) this.engine.noteDropped(step.dropped);
      if (step.steps > 0) {
        this.input.beginFrame();
        for (let i = 0; i < step.steps; i += 1) {
          this.input.writeTo(this.input.buffer, i === 0);
          this.engine.tick(this.input.buffer);
        }
      }

      const state = this.engine.state;
      this.events.length = 0;
      state.readEvents(this.lastSeq, this.events);
      if (this.events.length > 0) {
        this.lastSeq = this.events[this.events.length - 1].seq;
      }
      const tracked = this.trackedTerminal(state);
      const renderStart = performance.now();
      this.renderer.renderGame(state, step.alpha, rawDt, this.events, tracked);
      const renderCpuMs = performance.now() - renderStart;
      this.consumeEvents(this.events, state.tick);
      this.hud?.update(state, this.input.usingTouch);
      this.updateChannelRing(state);
      const node = this.map?.nodes[tracked];
      if (node) {
        const metres = Math.hypot(node.x - state.px, node.y - state.py, node.z - state.pz);
        this.objectiveMarker?.update(this.renderer.objectiveClip, tracked, metres, this.input.usingTouch,
          state.interacting === tracked, this.settings.hudScale);
      } else this.objectiveMarker?.hide();
      this.maybeAdaptQuality(frameMs, now, renderCpuMs);
      this.updateEngineering(now, state);
      this.observeTutorialFrame(state);
      if (state.phase === PHASE.win) this.finish(true);
      if (state.phase === PHASE.lose) this.finish(false);
    } else {
      this.renderer.renderOrbit(rawDt);
      this.updateEngineering(now, this.engine?.state ?? null);
    }
  };

  private maybeAdaptQuality(frameMs: number, now: number, renderCpuMs: number): void {
    const change = this.quality.sample(frameMs, now, renderCpuMs);
    if (change.changed && this.renderer) {
      this.renderer.setQuality(change.preset, this.dprCap());
      this.renderer.resize();
    }
  }

  private consumeEvents(events: readonly WorldEvent[], tick: number): void {
    for (const event of events) {
      const effects = effectsOf(event);
      for (const sound of effects.sounds) this.audio.play(sound);
      for (const line of effects.feed) this.hud?.pushFeed(line.text, line.kind);

      if (event.type === EVT.enemyHit) this.hud?.flashHit(false);
      if (event.type === EVT.enemyDied) this.hud?.flashHit(true);
      if (event.type === EVT.playerDamaged && event.a > 0) this.hud?.showDamageFrom(event.b, event.d, tick);
    }
  }

  private updateEngineering(now: number, state: Snapshot | null, immediate = false): void {
    if (!this.eng?.visible || (!immediate && now - this.lastEngineeringAt < 240)) return;
    this.lastEngineeringAt = now;
    const sorted = [...this.frameSamples].sort((a, b) => a - b);
    const pick = (q: number): number =>
      sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const mean = sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length);
    const memory =
      'memory' in performance
        ? `${(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576).toFixed(0)} MB`
        : 'no disponible';
    this.eng.update({
      fps: mean > 0 ? 1000 / mean : 0,
      p50: pick(0.5),
      p95: pick(0.95),
      calls: this.renderer?.calls ?? 0,
      triangles: this.renderer?.triangles ?? 0,
      ticks: state?.tick ?? 0,
      dropped: Math.round(state?.at(H.droppedTicks) ?? 0),
      quality: this.renderer?.preset.name ?? '—',
      dpr: this.renderer?.dpr ?? 1,
      enemies: state?.enemiesAlive ?? 0,
      memory,
      wasmKib: this.wasmKib,
      loadMs: this.loadMs,
      note: `arranque: ${new Date(this.bootAt).toLocaleTimeString('es-CL')} · eventos perdidos: ${state?.lostEvents ?? 0}`,
    });
  }

  // ------------------------------------------------------------- UI wiring

  private inputHooks(): InputHooks {
    return {
      onPause: () => {
        const action = this.flow.screen === 'tutorial-handoff' ? 'menu' : escapeAction(this.flow);
        if (action === 'pause') this.pause('game');
        else if (action === 'resume') this.resume();
        else if (action === 'menu') this.goToMenu();
        else if (action === 'sectors') this.openSectors();
      },
      onEngineering: () => this.toggleEngineering(),
      onTutorialKey: (action, repeat) => {
        if (this.flow.screen !== 'playing' || !this.tutorial) return false;
        if (repeat) return true;
        if (action === 'continue') this.setTutorialStep(continueTutorial(this.tutorial));
        else if (this.skipConfirm.press(performance.now()) === 'skip') this.setTutorialStep(skipTutorial(this.tutorial));
        else this.toast('Retroceso otra vez para omitir el tutorial');
        return true;
      },
      onPointerLockLost: () => {
        if (this.flow.screen !== 'tutorial-handoff' && pointerLockLostAction(this.flow, this.input?.usingTouch ?? false) === 'pause') {
          this.pause('game');
        }
      },
      onPointerLockError: () => {
        if (this.flow.screen !== 'tutorial-handoff' && pointerLockErrorAction(this.flow) === 'hint') this.toast('clic para capturar el mouse');
      },
      isPlaying: () => this.flow.screen === 'playing',
      onTouchDetected: () => {
        this.app.classList.add('is-touch');
        this.applySettings();
        this.renderTutorialNow();
      },
      onMouseDetected: () => {
        this.app.classList.remove('is-touch');
        this.applySettings();
        this.renderTutorialNow();
      },
      getWeapon: () => this.engine?.state.weapon ?? WEAPON.sidearm,
      unlockedWeapons: () => this.unlockedWeapons(),
    };
  }

  private toggleEngineering(): void {
    if (!this.eng) return;
    const visible = this.eng.toggle();
    // Opening the panel must not depend on the next render or simulation tick.
    if (visible) this.updateEngineering(performance.now(), this.engine?.state ?? null, true);
    this.settings = { ...this.settings, telemetry: visible };
    saveSettings(this.settings);
    this.syncSettingsUI();
  }

  private bindGlobalUI(): void {
    const signal = this.abort.signal;
    this.app.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const control = target.closest<HTMLElement>('[data-action], [data-goto]');
        if (control) {
          this.activateControl(control);
          return;
        }

        const boardEl = target.closest<HTMLElement>('[data-board]');
        if (boardEl) {
          this.audio.play('ui');
          void this.loadBoard(boardEl.dataset.board ?? DEFAULT_BOARD);
          return;
        }

        const tab = target.closest<HTMLElement>('[data-tab]');
        if (tab) {
          this.audio.play('ui');
          const name = tab.dataset.tab;
          this.app.querySelectorAll('[data-tab]').forEach((node) => {
            const active = node === tab;
            node.classList.toggle('is-active', active);
            node.setAttribute('aria-selected', active ? 'true' : 'false');
          });
          this.app.querySelectorAll('[data-pane]').forEach((node) => {
            node.classList.toggle('is-active', (node as HTMLElement).dataset.pane === name);
          });
        }
      },
      { signal },
    );

    byId('board-name').addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void this.submitBoard();
      },
      { signal },
    );

    this.app.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true, signal });
    this.app.addEventListener('keydown', () => this.audio.unlock(), { passive: true, signal });
  }

  private activateControl(control: HTMLElement): void {
    this.audio.unlock();
    this.audio.play('ui');
    if (control.dataset.action !== undefined) void this.handleAction(control.dataset.action, control);
    else if (control.dataset.goto !== undefined) this.navigate(control.dataset.goto);
  }

  private navigate(goto: string): void {
    if (goto === 'menu') this.goToMenu();
    else if (goto === 'sectors') this.openSectors();
    else if (goto === 'leaderboard') this.openLeaderboard();
    else if (goto === 'calibrate' || goto === 'about') this.dispatch({ type: 'open', screen: goto });
  }

  /**
   * Reiniciar y Salir al menú desde la pausa de una partida en curso descartan el progreso: la
   * primera pulsación pide confirmar en el propio botón. Fuera de ese caso ejecutan de inmediato.
   */
  private confirmInPause(action: string, element: HTMLElement, label: string): boolean {
    if (this.flow.screen !== 'pause' || this.flow.pauseOrigin !== 'game') return true;
    let gate = this.destructiveConfirm.get(action);
    if (!gate) {
      gate = new SkipConfirm(3000);
      this.destructiveConfirm.set(action, gate);
    }
    if (gate.press(performance.now()) === 'skip') {
      element.textContent = label;
      return true;
    }
    element.textContent = '¿Seguro? Tocá de nuevo';
    window.setTimeout(() => { element.textContent = label; }, 3000);
    return false;
  }

  private async handleAction(action: string, element: HTMLElement): Promise<void> {
    switch (action) {
      case 'mission':
        this.openSectors();
        break;
      case 'overflow':
        await this.startMatch('overflow', 0);
        break;
      case 'daily':
        await this.startMatch('daily', 0);
        break;
      case 'practice':
        await this.startMatch('practice', 0);
        break;
      case 'play':
        // P4: Jugar entra directo a la arena del sector recomendado; el sector es
        // una línea no bloqueante del menú y la cadena de campaña queda para resultados.
        await this.startMatch('run', recommendedSector(this.progress.state));
        break;
      case 'tutorial-replay':
        await this.startMatch('practice', 0, { tutorial: true });
        break;
      case 'tutorial-continue':
        if (this.flow.screen === 'playing' && this.tutorial) this.setTutorialStep(continueTutorial(this.tutorial));
        break;
      case 'tutorial-skip':
        if (this.flow.screen === 'playing' && this.tutorial) this.setTutorialStep(skipTutorial(this.tutorial));
        break;
      case 'tutorial-start':
        if (this.flow.screen === 'tutorial-handoff') await this.startMatch('run', recommendedSector(this.progress.state));
        break;
      case 'tutorial-practice':
        if (this.flow.screen === 'tutorial-handoff') this.resume();
        break;
      case 'brief':
        this.brief(Number(element.dataset.sector));
        break;
      case 'start-mission':
        await this.startMatch('run', clampSector(this.flow.mapId));
        break;
      case 'next-sector':
        if (clampSector(this.flow.mapId) < 2) await this.startMatch('run', clampSector(this.flow.mapId) + 1);
        break;
      case 'submit-board':
        await this.submitBoard();
        break;
      case 'settings':
        this.openSettingsFromMenu();
        break;
      case 'resume':
        if (this.flow.pauseOrigin === 'menu') this.goToMenu();
        else this.resume();
        break;
      case 'restart':
        if (!this.confirmInPause(action, element, 'Reiniciar')) break;
        await this.startMatch(this.flow.mode, this.flow.mapId);
        break;
      case 'menu':
        if (!this.confirmInPause(action, element, 'Salir al menú')) break;
        this.goToMenu();
        break;
      case 'engineering':
        this.toggleEngineering();
        break;
      case 'reset-settings':
        this.settings = resetSettings();
        this.applySettings();
        this.syncSettingsUI();
        this.toast('ajustes restablecidos');
        break;
      case 'retry':
        window.location.reload();
        break;
      default:
        break;
    }
  }

  private toastTimer = 0;

  private toast(message: string): void {
    const node = byId('toast');
    node.textContent = message;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      node.textContent = '';
    }, 2200);
  }

  private wireDisplayEvents(): void {
    const signal = this.abort.signal;
    const onResize = (): void => {
      this.renderer?.resize();
    };
    window.addEventListener('resize', onResize, { signal });
    window.addEventListener(
      'orientationchange',
      () => {
        this.input?.reset();
        window.setTimeout(onResize, 220);
      },
      { signal },
    );
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) {
          if (this.flow.screen === 'playing') this.pause('game');
          this.audio.suspend();
        }
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.flow.screen === 'playing') this.pause('game');
      },
      { signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        if (this.flow.screen === 'playing') this.pause('game');
      },
      { signal },
    );
    window.addEventListener('beforeunload', () => cancelAnimationFrame(this.rafId), { signal });
    byId('btn-pause-hud').addEventListener('click', () => this.pause('game'), { signal });

    if (window.matchMedia('(pointer: coarse)').matches) {
      this.app.classList.add('is-touch');
    }
    this.motionPreference.addEventListener('change', () => this.applyMotionPreference(), { signal });
  }

  // ---------------------------------------------------------------- settings

  /** Aplica un parche de ajustes, lo persiste y resincroniza todos los controles. */
  private updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.audioEnabled !== undefined) this.audio.unlock();
    this.applySettings();
    this.syncSettingsUI();
  }

  private applySettings(): void {
    this.settings = { ...this.settings };
    document.documentElement.style.setProperty('--hud-scale', String(this.settings.hudScale));
    document.documentElement.dataset.theme = 'dark';
    this.app.dataset.hand = this.settings.handedness;
    if (this.input?.usingTouch) this.app.classList.add('is-touch');
    this.objectiveMarker?.invalidate();
    this.applyMotionPreference();
    this.audio.setEnabled(this.settings.audioEnabled);
    this.audio.setVolume(this.settings.volume);
    this.audio.setChannelVolumes(this.settings.sfxVolume, this.settings.uiVolume);
    this.input?.updateSettings(this.settings);

    if (this.renderer) {
      this.quality.setManual(this.settings.quality as Quality);
      this.renderer.setGfx(gfxOverridesOf(this.settings));
      this.renderer.setQuality(this.quality.preset, this.dprCap());
      this.renderer.resize();
    }
    saveSettings(this.settings);
  }

  private applyMotionPreference(): void {
    this.hooks.reducedMotion = this.settings.reduceMotion || this.motionPreference.matches;
    this.app.dataset.motion = this.hooks.reducedMotion ? 'reduce' : 'full';
    this.hud?.setReduceFlashes(this.settings.reduceFlashes || this.hooks.reducedMotion);
  }

  private syncSettingsUI(): void {
    const view: SettingsView = {
      settings: this.settings,
      telemetry: this.eng?.visible ?? this.settings.telemetry,
      usingTouch: this.input?.usingTouch ?? false,
      gfxDetail: `preset ${this.renderer?.preset.name ?? '—'} · dpr ${(this.renderer?.dpr ?? 1).toFixed(2)} · aim assist ${this.settings.aimAssistTouch ? 'on' : 'off'}`,
    };
    this.settingsForm.sync(view);
  }

  dispose(): void {
    this.abort.abort();
    cancelAnimationFrame(this.rafId);
    this.input?.detach();
    this.objectiveMarker?.dispose();
    this.renderer?.dispose();
    this.audio.dispose();
  }
}
