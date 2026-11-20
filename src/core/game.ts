/**
 * Composition root: arranca el núcleo WASM, el renderer y la UI, conduce la
 * máquina de pantallas y ejecuta el bucle de paso fijo.
 *
 * No reimplementa reglas de simulación: reenvía input, lee el snapshot y decide
 * qué pantalla está visible.
 */
import { Engine, type Snapshot, type WorldEvent } from '../wasm/bridge';
import { H, PHASE } from '../wasm/protocol';
import { Renderer } from '../render/renderer';
import { InputManager, type InputHooks } from '../input/input';
import { AudioManager } from '../audio/audio';
import { Hud } from '../ui/hud';
import { Engineering } from '../ui/engineering';
import { BootView, fallbackMessage, webgl2Supported } from '../ui/boot-view';
import { renderResult } from '../ui/results';
import { SettingsForm, type SettingsView } from '../ui/settings-form';
import { byId } from '../ui/dom';
import { QualityController } from './quality';
import { FixedStepLoop } from './loop';
import { loadSettings, resetSettings, saveSettings, type Quality, type Settings } from './settings';
import { bestScore, saveScore } from './scores';
import { buildRunResult, buildStartOptions } from './match';
import { effectsOf } from './events';
import type { MapData } from '../world/map';
import {
  escapeAction,
  pauseSubtitle,
  pointerLockErrorAction,
  pointerLockLostAction,
  type Mode,
  type PauseOrigin,
  type Screen,
  type ScreenState,
} from './screens';

const ENGINE_URL = `${import.meta.env.BASE_URL}bp_core.wasm`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  private eng: Engineering | null = null;

  private settings: Settings = loadSettings();
  private quality = new QualityController(this.settings.quality);
  private loop = new FixedStepLoop();
  private hooks = {
    reducedMotion: false,
    onContextLost: (): void => this.handleContextLost(),
    onContextRestored: (): void => this.handleContextRestored(),
  };

  private screen: Screen = 'boot';
  private mode: Mode = 'run';
  private pauseOrigin: PauseOrigin = 'game';
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
    this.setScreen('boot');
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
      this.refreshMenuRecord();
      this.wireDisplayEvents();
      view.setProgress(100);
      view.setMeta(`núcleo listo · ${this.wasmKib.toFixed(1)} KiB · ${this.loadMs.toFixed(0)} ms`);

      this.lastNow = performance.now();
      this.rafId = requestAnimationFrame(this.frame);

      await sleep(320);
      this.setScreen(this.settings.tutorialSeen ? 'menu' : 'calibrate');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      view.setFallbackDetail(fallbackMessage(detail));
      this.setScreen('fallback');
    }
  }

  private handleContextLost(): void {
    if (this.screen === 'playing') this.pause('game');
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

  private setScreen(screen: Screen): void {
    this.screen = screen;
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

  get currentScreen(): Screen {
    return this.screen;
  }

  // ------------------------------------------------------------- match flow

  async startMatch(mode: Mode, mapId = 0): Promise<void> {
    if (!this.engine || !this.renderer || !this.input) return;
    this.audio.unlock();
    this.audio.resume();
    this.finished = false;
    this.mode = mode;
    this.pauseOrigin = 'game';

    const started = this.engine.start(
      buildStartOptions({
        mode,
        mapId,
        seed: (Math.random() * 0xffffffff) >>> 0,
        aimAssist: this.settings.aimAssistTouch && this.input.usingTouch,
        autoReload: this.settings.autoReload,
      }),
    );
    if (!started) throw new Error(`no se pudo iniciar el sector ${mapId}`);
    if (this.map?.id !== mapId) {
      this.map = this.engine.mapData();
      this.renderer.setSector(this.map);
      this.hud?.setMap(this.map);
    }

    this.lastSeq = 0;
    this.events.length = 0;
    this.loop.reset();
    this.hud?.reset();
    this.lastNow = performance.now();
    this.setScreen('playing');
    this.renderer.setQuality(this.quality.preset, this.dprCap());
    this.audio.play('wave');
    void this.input.requestPointerLock();
  }

  private pause(origin: PauseOrigin = this.pauseOrigin): void {
    if (this.screen !== 'playing') return;
    this.pauseOrigin = origin;
    this.input?.reset();
    this.input?.releasePointerLock();
    this.setScreen('pause');
    byId('pause-sub').textContent = pauseSubtitle(this.mode);
    const resume = this.app.querySelector<HTMLElement>('[data-action="resume"]');
    if (resume) resume.textContent = 'Continuar ▸';
    this.audio.suspend();
  }

  private resume(): void {
    if (!this.engine) return;
    this.loop.reset();
    this.lastNow = performance.now();
    this.audio.resume();
    this.setScreen('playing');
    void this.input?.requestPointerLock();
  }

  private openSettingsFromMenu(): void {
    this.pauseOrigin = 'menu';
    this.setScreen('pause');
    byId('pause-sub').textContent = 'Ajustes del protocolo';
    const resume = this.app.querySelector<HTMLElement>('[data-action="resume"]');
    if (resume) resume.textContent = 'Jugar ▸';
  }

  private goToMenu(): void {
    this.audio.suspend();
    this.refreshMenuRecord();
    this.setScreen('menu');
    this.quality = new QualityController(this.settings.quality);
    this.renderer?.setQuality(this.quality.preset, this.dprCap());
  }

  private finish(won: boolean): void {
    if (this.finished || !this.engine) return;
    this.finished = true;
    const run = buildRunResult(this.engine.state, {
      mode: this.mode,
      input: this.input?.usingTouch ? 'touch' : 'mouse',
      won,
      at: Date.now(),
    });
    const outcome = saveScore(run);
    renderResult(run, outcome.isRecord);
    this.setScreen('result');
    this.audio.play(won ? 'win' : 'lose');
  }

  private refreshMenuRecord(): void {
    const best = bestScore('run');
    byId('menu-record').textContent = best === null ? 'récord: —' : `récord: ${best.toLocaleString('es-CL')}`;
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

    if (this.screen === 'playing' && this.engine && this.input) {
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
      this.hud?.update(state, rawDt, this.input.usingTouch);
      this.consumeEvents(this.events);
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

  private screenState(): ScreenState {
    return { screen: this.screen, mode: this.mode, pauseOrigin: this.pauseOrigin };
  }

  private inputHooks(): InputHooks {
    return {
      onPause: () => {
        const action = escapeAction(this.screenState());
        if (action === 'pause') this.pause('game');
        else if (action === 'resume') this.resume();
        else if (action === 'menu') this.goToMenu();
      },
      onEngineering: () => this.toggleEngineering(),
      onPointerLockLost: () => {
        if (pointerLockLostAction(this.screenState(), this.input?.usingTouch ?? false) === 'pause') {
          this.pause('game');
        }
      },
      onPointerLockError: () => {
        if (pointerLockErrorAction(this.screenState()) === 'hint') this.toast('clic para capturar el mouse');
      },
      isPlaying: () => this.screen === 'playing',
      onTouchDetected: () => {
        this.app.classList.add('is-touch');
        this.applySettings();
      },
      onMouseDetected: () => {
        this.app.classList.remove('is-touch');
        this.applySettings();
      },
      getWeapon: () => this.engine?.state.weapon ?? 1,
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
          const action = actionEl.dataset.action;
          void this.handleAction(action ?? '');
          return;
        }

        const gotoEl = target.closest<HTMLElement>('[data-goto]');
        if (gotoEl) {
          this.audio.unlock();
          this.audio.play('ui');
          const goto = gotoEl.dataset.goto;
          if (goto === 'menu') this.goToMenu();
          else if (goto === 'calibrate' || goto === 'about') this.setScreen(goto);
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

    this.app.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true, signal });
    this.app.addEventListener('keydown', () => this.audio.unlock(), { passive: true, signal });
  }

  private async handleAction(action: string): Promise<void> {
    switch (action) {
      case 'play':
        this.markTutorialSeen();
        await this.startMatch('run');
        break;
      case 'practice':
        this.markTutorialSeen();
        await this.startMatch('practice');
        break;
      case 'settings':
        this.openSettingsFromMenu();
        break;
      case 'resume':
        if (this.pauseOrigin === 'menu') await this.startMatch('run');
        else this.resume();
        break;
      case 'restart':
        await this.startMatch(this.mode);
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

  private markTutorialSeen(): void {
    this.settings = { ...this.settings, tutorialSeen: true };
    saveSettings(this.settings);
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
          if (this.screen === 'playing') this.pause('game');
          this.audio.suspend();
        }
      },
      { signal },
    );
    window.addEventListener(
      'blur',
      () => {
        if (this.screen === 'playing') this.pause('game');
      },
      { signal },
    );
    window.addEventListener(
      'pagehide',
      () => {
        if (this.screen === 'playing') this.pause('game');
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
