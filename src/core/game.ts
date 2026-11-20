/**
 * Composition root: arranca el núcleo WASM, el renderer y la UI, conduce el flujo
 * de pantallas y ejecuta el bucle de paso fijo.
 *
 * No reimplementa reglas de simulación: reenvía input, lee el snapshot y decide
 * qué pantalla está visible.
 */
import { Engine, type Snapshot, type WorldEvent } from '../wasm/bridge';
import { EVT, H, INPUT_LEN, PHASE, WEAPON } from '../wasm/protocol';
import { Renderer } from '../render/renderer';
import { InputManager, type InputHooks } from '../input/input';
import { AudioManager } from '../audio/audio';
import { Hud, type MatchView } from '../ui/hud';
import { Engineering } from '../ui/engineering';
import { BootView, fallbackMessage, webgl2Supported } from '../ui/boot-view';
import { renderResult } from '../ui/results';
import { SettingsForm, type SettingsView } from '../ui/settings-form';
import { byId } from '../ui/dom';
import { recommendedSector, renderBriefing, renderMenu, renderSectorCards } from '../ui/campaign-view';
import { renderBoardLoading, renderBoardPanel, renderBoardRows, boardLabel, type BoardPanel } from '../ui/board-view';
import { renderTutorial } from '../ui/tutorial-view';
import { QualityController } from './quality';
import { FixedStepLoop } from './loop';
import { loadSettings, resetSettings, saveSettings, type Quality, type Settings } from './settings';
import { bestScore, saveScore, type RunResult } from './scores';
import { buildRunResult, buildStartOptions } from './match';
import { effectsOf } from './events';
import { damageBearing } from './bearing';
import { dailySeed, utcDateKey } from './daily';
import {
  ProgressStore,
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
import { observeTutorial, skipTutorial, startTutorial, tutorialDone, type TutorialState } from './tutorial';
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
  type Screen,
} from './screens';

const ENGINE_URL = `${import.meta.env.BASE_URL}bp_core.wasm`;
const LEADERBOARD_LIMIT = 20;
const DEFAULT_BOARD = 'mission:s01';

interface PendingRun {
  board: BoardKey | null;
  reason: string;
  log: Uint8Array;
  submitted: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function clampSector(id: number): SectorId {
  return SECTOR_IDS.find((sector) => sector === id) ?? 0;
}

function ineligibleReason(mode: Mode, won: boolean, truncated: boolean): string {
  if (mode === 'practice') return 'El simulador no cuenta para ningún tablero.';
  if (truncated) return 'La partida supera el límite verificable (20 min) y no entra a los tableros.';
  if (mode === 'run' && !won) return 'Las derrotas de misión no entran al tablero. Reintentá el sector.';
  return 'Esta partida no entra a ningún tablero.';
}

export class GameApp {
  private readonly canvas = byId<HTMLCanvasElement>('gl');
  private readonly app = byId('app');
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
  private audio = new AudioManager();
  private hud: Hud | null = null;
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

  private flow: FlowState = INITIAL_FLOW;
  private matchDate = utcDateKey(new Date());
  private tutorial: TutorialState | null = null;
  private tutorialOrigin = { x: 0, z: 0 };
  private pending: PendingRun | null = null;
  private submitting = false;
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

  // ------------------------------------------------------------------ boot

  async boot(): Promise<void> {
    this.apply();
    this.bindGlobalUI();
    const view = new BootView();

    try {
      const audioOk = 'AudioContext' in window || 'webkitAudioContext' in window;
      view.setCheck('audio', audioOk ? 'ok' : 'fail');
      view.setProgress(12);

      const startedAt = performance.now();
      this.engine = await Engine.load(ENGINE_URL);
      this.wasmKib = this.engine.wasmBytes / 1024;
      view.setCheck('wasm', 'ok');
      view.setProgress(46);

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
      this.eng = new Engineering();

      this.applySettings();
      this.settingsForm.attach(this.abort.signal);
      this.syncSettingsUI();
      this.refreshMenu();
      this.wireDisplayEvents();
      view.setProgress(100);
      view.setMeta(`núcleo listo · ${this.wasmKib.toFixed(1)} KiB · ${this.loadMs.toFixed(0)} ms`);

      this.lastNow = performance.now();
      this.rafId = requestAnimationFrame(this.frame);

      await sleep(320);
      this.dispatch({ type: 'boot-complete', tutorialSeen: this.progress.state.tutorialSeen });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      view.setFallbackDetail(fallbackMessage(detail));
      this.dispatch({ type: 'boot-failed' });
    }
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
    const screen = this.flow.screen;
    this.app.dataset.screen = screen;
    if (screen !== 'playing') {
      this.input?.releasePointerLock();
      this.input?.reset();
    }
    const focusTarget = this.app.querySelector<HTMLElement>(
      `#screen-${screen} [data-action], #screen-${screen} button, #screen-${screen} a`,
    );
    if (screen !== 'playing' && screen !== 'boot') {
      focusTarget?.focus({ preventScroll: true });
    }
  }

  /** Aplica un evento del flujo; devuelve falso si la transición no está permitida. */
  private dispatch(event: FlowEvent): boolean {
    const next = transition(this.flow, event);
    if (next === this.flow) return false;
    this.flow = next;
    this.apply();
    return true;
  }

  get currentScreen(): Screen {
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
    if (!this.engine || !this.renderer || !this.input) return;
    if (transition(this.flow, { type: 'start', mode, mapId }) === this.flow) return;

    this.audio.unlock();
    this.audio.resume();
    this.matchDate = utcDateKey(new Date());
    const seed = mode === 'daily' ? dailySeed(new Date()) : (Math.random() * 0xffffffff) >>> 0;
    const started = this.engine.start(
      buildStartOptions({
        mode,
        mapId,
        seed,
        aimAssist: this.settings.aimAssistTouch && this.input.usingTouch,
        autoReload: this.settings.autoReload,
        shotgun: isShotgunUnlocked(this.progress.state),
      }),
    );
    if (!started) throw new Error(`no se pudo iniciar el sector ${mapId}`);

    this.syncMap();
    this.finished = false;
    this.pending = null;
    this.lastSeq = 0;
    this.events.length = 0;
    this.loop.reset();
    this.hud?.reset();
    this.hud?.setMatch(this.matchView(mode));
    this.lastNow = performance.now();

    const tutorialOn = mode === 'practice' && (options.tutorial ?? !this.progress.state.tutorialSeen);
    this.tutorial = tutorialOn ? startTutorial() : null;
    this.tutorialOrigin = { x: this.engine.state.px, z: this.engine.state.pz };
    renderTutorial(this.tutorial);

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
    if (!this.engine) return;
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
    this.pending = this.capturePending(mode, won);
    renderResult(run, run.score > 0 && run.score > (previousBest ?? 0));
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

  /** Lee el registro y la bandera de truncado antes de que la siguiente partida reinicie el grabador. */
  private capturePending(mode: Mode, won: boolean): PendingRun {
    const engine = this.engine;
    const truncated = engine?.logTruncated ?? false;
    const log = engine?.encodeLog() ?? new Uint8Array();
    const runMode: RunMode = mode === 'run' ? 'mission' : mode;
    const board = boardFor({
      mode: runMode,
      mapId: this.flow.mapId,
      won,
      dateKey: this.matchDate,
      logTruncated: truncated,
    });
    return { board, reason: ineligibleReason(mode, won, truncated), log, submitted: false };
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
    if (runWon && sector === 2) lines.push('red recuperada');
    byId('result-unlock').textContent = lines.join(' · ');
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
    renderMenu(this.progress.state, utcDateKey(new Date()));
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
    if (!this.tutorial || tutorialDone(this.tutorial)) return;
    const before = this.tutorial;
    this.tutorial = observeTutorial(before, {
      metersMoved: Math.hypot(state.px - this.tutorialOrigin.x, state.pz - this.tutorialOrigin.z),
      shot: this.events.some((event) => event.type === EVT.shot),
      nodeActivated: this.events.some((event) => event.type === EVT.nodeActivated),
    });
    if (this.tutorial !== before) renderTutorial(this.tutorial);
    if (tutorialDone(this.tutorial)) this.endTutorial(this.tutorial.skipped);
  }

  private endTutorial(skipped: boolean): void {
    if (!this.tutorial) return;
    this.tutorial = skipTutorial(this.tutorial);
    renderTutorial(this.tutorial);
    this.tutorial = null;
    this.progress.update(markTutorialSeen(this.progress.state));
    this.settings = { ...this.settings, tutorialSeen: true };
    saveSettings(this.settings);
    this.toast(skipped ? 'tutorial omitido' : 'tutorial completo');
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

    if (this.flow.screen === 'playing' && this.engine && this.input) {
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
      this.renderer.renderGame(state, step.alpha, rawDt, this.events);
      this.hud?.update(state, this.input.usingTouch);
      this.consumeEvents(this.events);
      this.observeTutorialFrame(state);
      this.maybeAdaptQuality(frameMs, now);
      this.updateEngineering(now, state);
      if (state.phase === PHASE.win) this.finish(true);
      if (state.phase === PHASE.lose) this.finish(false);
    } else {
      this.renderer.renderOrbit(rawDt);
      this.updateEngineering(now, this.engine?.state ?? null);
    }
  };

  private maybeAdaptQuality(frameMs: number, now: number): void {
    const change = this.quality.sample(frameMs, now);
    if (change.changed && this.renderer) {
      this.renderer.setQuality(change.preset, this.dprCap());
      this.renderer.resize();
    }
  }

  private consumeEvents(events: readonly WorldEvent[]): void {
    for (const event of events) {
      const effects = effectsOf(event);
      for (const sound of effects.sounds) this.audio.play(sound);
      for (const line of effects.feed) this.hud?.pushFeed(line.text, line.kind);

      if (event.type === EVT.enemyHit) this.hud?.flashHit(false);
      if (event.type === EVT.enemyDied) this.hud?.flashHit(true);
      if (event.type === EVT.playerDamaged && event.a >= 1 && this.engine) {
        const state = this.engine.state;
        const bearing = damageBearing(state.yaw, { x: state.px, z: state.pz }, { x: event.b, z: event.d });
        this.hud?.showDamageFrom(bearing);
      }
    }
  }

  private updateEngineering(now: number, state: Snapshot | null): void {
    if (!this.eng?.visible || now - this.lastEngineeringAt < 240) return;
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
        const action = escapeAction(this.flow);
        if (action === 'pause') this.pause('game');
        else if (action === 'resume') this.resume();
        else if (action === 'menu') this.goToMenu();
      },
      onEngineering: () => this.toggleEngineering(),
      onPointerLockLost: () => {
        if (pointerLockLostAction(this.flow, this.input?.usingTouch ?? false) === 'pause') {
          this.pause('game');
        }
      },
      onPointerLockError: () => {
        if (pointerLockErrorAction(this.flow) === 'hint') this.toast('clic para capturar el mouse');
      },
      isPlaying: () => this.flow.screen === 'playing',
      onTouchDetected: () => {
        this.app.classList.add('is-touch');
        this.applySettings();
      },
      onMouseDetected: () => {
        this.app.classList.remove('is-touch');
        this.applySettings();
      },
      getWeapon: () => this.engine?.state.weapon ?? WEAPON.sidearm,
      unlockedWeapons: () => this.unlockedWeapons(),
    };
  }

  private toggleEngineering(): void {
    if (!this.eng) return;
    const visible = this.eng.toggle();
    this.settings = { ...this.settings, telemetry: visible };
    saveSettings(this.settings);
    this.syncSettingsUI();
    this.lastEngineeringAt = 0;
  }

  private bindGlobalUI(): void {
    const signal = this.abort.signal;
    this.app.addEventListener(
      'click',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const actionEl = target.closest<HTMLElement>('[data-action]');
        if (actionEl) {
          this.audio.unlock();
          this.audio.play('ui');
          void this.handleAction(actionEl.dataset.action ?? '', actionEl);
          return;
        }

        const gotoEl = target.closest<HTMLElement>('[data-goto]');
        if (gotoEl) {
          this.audio.unlock();
          this.audio.play('ui');
          this.navigate(gotoEl.dataset.goto ?? '');
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

  private navigate(goto: string): void {
    if (goto === 'menu') this.goToMenu();
    else if (goto === 'sectors') this.openSectors();
    else if (goto === 'leaderboard') this.openLeaderboard();
    else if (goto === 'calibrate' || goto === 'about') this.dispatch({ type: 'open', screen: goto });
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
        if (this.flow.screen === 'menu') await this.startMatch('run', recommendedSector(this.progress.state));
        else await this.startMatch('practice', 0, { tutorial: true });
        break;
      case 'tutorial-replay':
        await this.startMatch('practice', 0, { tutorial: true });
        break;
      case 'tutorial-skip':
        this.endTutorial(true);
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
        await this.startMatch(this.flow.mode, this.flow.mapId);
        break;
      case 'menu':
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

  private toast(message: string): void {
    const node = byId('toast');
    node.textContent = message;
    node.hidden = false;
    window.setTimeout(() => {
      node.hidden = true;
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings = { ...this.settings, reduceMotion: true };
      this.hooks.reducedMotion = true;
    }
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
    this.app.dataset.motion = this.settings.reduceMotion ? 'reduce' : 'full';
    if (this.input?.usingTouch) this.app.classList.add('is-touch');

    this.hooks.reducedMotion = this.settings.reduceMotion;
    this.audio.setEnabled(this.settings.audioEnabled);
    this.audio.setVolume(this.settings.volume);
    this.input?.updateSettings(this.settings);

    if (this.renderer) {
      this.quality.setManual(this.settings.quality as Quality);
      this.renderer.setQuality(this.quality.preset, this.dprCap());
      this.renderer.resize();
    }
    saveSettings(this.settings);
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
    this.renderer?.dispose();
    this.audio.dispose();
  }
}
