/**
 * Composition root: boots the Rust/WASM core, the renderer and the UI, owns the
 * screen state machine, and runs the fixed-step loop.
 *
 * Nothing here re-implements simulation rules — it forwards input, reads the
 * snapshot, and decides which screen is visible.
 */
import { Engine, type Snapshot, type WorldEvent } from '../wasm/bridge';
import { EVT, H, MODE, PHASE, WEAPON } from '../wasm/protocol';
import { Renderer } from '../render/renderer';
import { InputManager, type InputHooks } from '../input/input';
import { AudioManager } from '../audio/audio';
import { Hud } from '../ui/hud';
import { Engineering } from '../ui/engineering';
import { QualityController } from './quality';
import { FixedStepLoop } from './loop';
import {
  loadSettings,
  resetSettings,
  saveSettings,
  type Quality,
  type Settings,
} from './settings';
import { bestScore, grade, saveScore, type RunResult } from './scores';
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

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class GameApp {
  private readonly canvas = el<HTMLCanvasElement>('gl');
  private readonly app = el('app');

  private engine: Engine | null = null;
  private renderer: Renderer | null = null;
  private input: InputManager | null = null;
  private audio = new AudioManager();
  private hud: Hud | null = null;
  private map: MapData | null = null;
  private eng: Engineering | null = null;

  private settings: Settings = loadSettings();
  private quality = new QualityController(loadSettings().quality);
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
    const setCheck = (name: string, state: 'ok' | 'fail'): void => {
      document.querySelector(`[data-check="${name}"]`)?.setAttribute('data-state', state);
    };
    const progress = (percent: number): void => {
      el('boot-progress').style.width = `${percent}%`;
    };

    try {
      const audioOk = 'AudioContext' in window || 'webkitAudioContext' in window;
      setCheck('audio', audioOk ? 'ok' : 'fail');
      progress(12);

      const startedAt = performance.now();
      this.engine = await Engine.load(ENGINE_URL);
      this.wasmKib = this.engine.wasmBytes / 1024;
      setCheck('wasm', 'ok');
      progress(46);

      if (!this.supportsWebGL2()) {
        setCheck('webgl2', 'fail');
        throw new Error('webgl2');
      }
      this.renderer = new Renderer(this.canvas, this.hooks);
      this.renderer.init();
      this.renderer.setQuality(this.quality.preset, this.dprCap());
      this.renderer.resize();
      setCheck('webgl2', 'ok');
      progress(72);

      this.map = this.engine.loadMap(0);
      if (this.map.solids.length === 0) throw new Error('arena vacía');
      this.renderer.setSector(this.map);
      setCheck('arena', 'ok');
      this.loadMs = performance.now() - startedAt;
      progress(92);

      this.input = new InputManager(this.canvas, this.inputHooks(), this.settings);
      this.input.attach();
      this.hud = new Hud();
      this.hud.setMap(this.map);
      this.eng = new Engineering();

      this.applySettings();
      this.bindForms();
      this.syncSettingsUI();
      this.refreshMenuRecord();
      this.wireDisplayEvents();
      progress(100);
      el('boot-meta').textContent = `núcleo listo · ${this.wasmKib.toFixed(1)} KiB · ${this.loadMs.toFixed(0)} ms`;

      this.lastNow = performance.now();
      this.rafId = requestAnimationFrame(this.frame);

      await sleep(320);
      if (!this.settings.tutorialSeen) {
        this.setScreen('calibrate');
      } else {
        this.setScreen('menu');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      el('fallback-detail').textContent =
        detail === 'webgl2'
          ? 'Este navegador no expone WebGL2. Probá Chrome, Edge, Firefox o Safari actualizados.'
          : `No pudimos inicializar el sistema: ${detail}`;
      this.setScreen('fallback');
    }
  }

  private handleContextLost(): void {
    if (this.screen === 'playing') this.pause('game');
    this.app.dataset.ctx = 'lost';
    el('context-lost').hidden = false;
  }

  private handleContextRestored(): void {
    this.app.dataset.ctx = 'ok';
    el('context-lost').hidden = true;
  }

  private supportsWebGL2(): boolean {
    try {
      const probe = document.createElement('canvas');
      return probe.getContext('webgl2') !== null;
    } catch {
      return false;
    }
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

  private async startMatch(mode: Mode, mapId = 0): Promise<void> {
    if (!this.engine || !this.renderer || !this.input) return;
    this.audio.unlock();
    this.audio.resume();
    this.finished = false;
    this.mode = mode;
    this.pauseOrigin = 'game';

    const started = this.engine.start({
      mode: mode === 'practice' ? MODE.practice : MODE.mission,
      map: mapId,
      seed: (Math.random() * 0xffffffff) >>> 0,
      aimAssist: this.settings.aimAssistTouch && this.input.usingTouch,
      autoReload: this.settings.autoReload,
    });
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
    el('pause-sub').textContent = pauseSubtitle(this.mode);
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
    el('pause-sub').textContent = 'Ajustes del protocolo';
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
    const state = this.engine.state;
    const run: RunResult = {
      score: Math.round(state.score),
      kills: state.kills,
      accuracy: state.shots > 0 ? state.hits / state.shots : 0,
      nodes: state.nodesActive,
      timeLeft: state.timeLeft,
      damage: Math.round(state.damageTaken),
      durationMs: Math.max(0, state.timeElapsed * 1000),
      mode: this.mode,
      input: this.input?.usingTouch ? 'touch' : 'mouse',
      difficulty: 'operator',
      won,
      at: Date.now(),
    };
    const outcome = saveScore(run);
    this.showResult(run, outcome.isRecord);
    this.setScreen('result');
    this.audio.play(won ? 'win' : 'lose');
    el('result-timebar').style.width = `${Math.min(100, (state.timeElapsed / 180) * 100)}%`;
  }

  private showResult(run: RunResult, isRecord: boolean): void {
    el('result-eyebrow').textContent = run.won ? 'protocolo completado' : 'protocolo fallido';
    el('result-title').textContent = run.won ? 'PARTIDA COMPLETADA' : 'CONEXIÓN PERDIDA';
    el('result-grade').textContent = grade(run);
    el('result-score').textContent = run.score.toLocaleString('es-CL');
    el('result-kills').textContent = String(run.kills);
    el('result-accuracy').textContent = `${Math.round(run.accuracy * 100)}%`;
    el('result-nodes').textContent = `${run.nodes}/3`;
    el('result-time').textContent = `${Math.floor(run.durationMs / 60000)}:${Math.floor((run.durationMs % 60000) / 1000)
      .toString()
      .padStart(2, '0')}`;
    el('result-damage').textContent = String(run.damage);
    el('result-input').textContent = run.input === 'touch' ? 'táctil' : 'mouse';
    el('result-record').hidden = !isRecord;
  }

  private refreshMenuRecord(): void {
    const best = bestScore('run');
    el('menu-record').textContent = best === null ? 'récord: —' : `récord: ${best.toLocaleString('es-CL')}`;
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
      switch (event.type) {
        case EVT.shot:
          this.audio.play(event.a === WEAPON.carbine ? 'shotCarbine' : 'shotSidearm');
          break;
        case EVT.enemyHit:
          this.audio.play('hit');
          break;
        case EVT.enemyDied:
          this.audio.play('kill');
          this.hud?.pushFeed(event.d === 1 ? 'centinela eliminado' : 'scout eliminado', 'good');
          break;
        case EVT.playerDamaged:
          if (event.a >= 1) this.audio.play('damage');
          break;
        case EVT.enemyShot:
          this.audio.play('enemyShot');
          break;
        case EVT.enemyWindup:
          this.audio.play('windup');
          break;
        case EVT.nodeActivated:
          this.audio.play('node');
          this.hud?.pushFeed('nodo de red activado', 'good');
          break;
        case EVT.waveStart:
          this.audio.play('wave');
          this.hud?.pushFeed(`oleada ${Math.round(event.a)}`);
          break;
        case EVT.extraction:
          this.audio.play('wave');
          this.hud?.pushFeed('extracción iniciada · sobreviví', 'danger');
          break;
        case EVT.reloadStart:
          this.audio.play('reload');
          break;
        case EVT.emptyMag:
          this.audio.play('empty');
          break;
        case EVT.win:
          this.hud?.pushFeed('protocolo completado', 'good');
          break;
        case EVT.lose:
          this.hud?.pushFeed('conexión perdida', 'danger');
          break;
        default:
          break;
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
    const toggle = this.app.querySelector<HTMLInputElement>('#set-telemetry');
    if (toggle) toggle.checked = visible;
    this.lastEngineeringAt = 0;
  }

  private bindGlobalUI(): void {
    this.app.addEventListener('click', (event) => {
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
        return;
      }

      const handed = target.closest<HTMLElement>('[data-handedness]');
      if (handed) {
        const value = handed.dataset.handedness === 'left' ? 'left' : 'right';
        this.settings = { ...this.settings, handedness: value };
        this.applySettings();
        this.syncSettingsUI();
      }
    });

    this.app.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });
    this.app.addEventListener('keydown', () => this.audio.unlock(), { passive: true });
  }

  private async handleAction(action: string): Promise<void> {
    switch (action) {
      case 'play':
        this.settings = { ...this.settings, tutorialSeen: true };
        saveSettings(this.settings);
        await this.startMatch('run');
        break;
      case 'practice':
        this.settings = { ...this.settings, tutorialSeen: true };
        saveSettings(this.settings);
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

  private toast(message: string): void {
    const node = el('toast');
    node.textContent = message;
    node.hidden = false;
    window.setTimeout(() => {
      node.hidden = true;
    }, 2200);
  }

  private wireDisplayEvents(): void {
    const onResize = (): void => {
      this.renderer?.resize();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => {
      this.input?.reset();
      window.setTimeout(onResize, 220);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.screen === 'playing') this.pause('game');
        this.audio.suspend();
      }
    });
    window.addEventListener('blur', () => {
      if (this.screen === 'playing') this.pause('game');
    });
    window.addEventListener('pagehide', () => {
      if (this.screen === 'playing') this.pause('game');
    });
    window.addEventListener('beforeunload', () => {
      cancelAnimationFrame(this.rafId);
    });
    if (window.matchMedia('(pointer: coarse)').matches) {
      this.app.classList.add('is-touch');
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.settings = { ...this.settings, reduceMotion: true };
      this.hooks.reducedMotion = true;
    }
  }

  // ---------------------------------------------------------------- settings

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

  private bindForms(): void {
    const onChange = (
      id: string,
      handler: (element: HTMLInputElement | HTMLSelectElement) => void,
    ): void => {
      const node = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
      if (!node) return;
      const eventName = node instanceof HTMLInputElement && node.type === 'range' ? 'input' : 'change';
      node.addEventListener(eventName, () => handler(node));
    };

    onChange('set-quality', (node) => {
      this.settings = { ...this.settings, quality: node.value as Quality };
      this.quality.setManual(node.value as Quality);
      this.applySettings();
    });
    onChange('set-motion', (node) => {
      this.settings = { ...this.settings, reduceMotion: (node as HTMLInputElement).checked };
      this.applySettings();
    });
    onChange('set-telemetry', (node) => {
      const checked = (node as HTMLInputElement).checked;
      if (this.eng?.visible !== checked) this.toggleEngineering();
    });
    onChange('set-audio', (node) => {
      this.settings = { ...this.settings, audioEnabled: (node as HTMLInputElement).checked };
      this.audio.unlock();
      this.applySettings();
    });
    onChange('set-volume', (node) => {
      const volume = Number(node.value);
      this.settings = { ...this.settings, volume };
      el('set-volume-val').textContent = `${Math.round(volume * 100)}%`;
      this.applySettings();
    });
    onChange('set-sens', (node) => {
      const value = Number(node.value);
      this.settings = { ...this.settings, sensitivityMouse: value, sensitivityTouch: value };
      el('set-sens-val').textContent = `${value.toFixed(2)}×`;
      this.applySettings();
    });
    onChange('set-invert', (node) => {
      this.settings = { ...this.settings, invertY: (node as HTMLInputElement).checked };
      this.applySettings();
    });
    onChange('set-hud', (node) => {
      const value = Number(node.value);
      this.settings = { ...this.settings, hudScale: value };
      el('set-hud-val').textContent = `${Math.round(value * 100)}%`;
      this.applySettings();
    });
    onChange('set-handed', (node) => {
      this.settings = {
        ...this.settings,
        handedness: (node as HTMLInputElement).checked ? 'left' : 'right',
      };
      this.applySettings();
      this.syncSettingsUI();
    });
    onChange('set-autoreload', (node) => {
      this.settings = { ...this.settings, autoReload: (node as HTMLInputElement).checked };
      this.applySettings();
    });
    onChange('set-aimassist', (node) => {
      this.settings = { ...this.settings, aimAssistTouch: (node as HTMLInputElement).checked };
      this.applySettings();
    });

    // Calibration screen mirrors the same settings.
    onChange('calib-sens', (node) => {
      const value = Number(node.value);
      this.settings = this.input?.usingTouch
        ? { ...this.settings, sensitivityTouch: value }
        : { ...this.settings, sensitivityMouse: value };
      el('calib-sens-val').textContent = `${value.toFixed(2)}×`;
      this.applySettings();
    });
    onChange('calib-invert', (node) => {
      this.settings = { ...this.settings, invertY: (node as HTMLInputElement).checked };
      this.applySettings();
    });
    onChange('calib-autoreload', (node) => {
      this.settings = { ...this.settings, autoReload: (node as HTMLInputElement).checked };
      this.applySettings();
    });
    onChange('calib-aimassist', (node) => {
      this.settings = { ...this.settings, aimAssistTouch: (node as HTMLInputElement).checked };
      this.applySettings();
    });

    this.app.querySelector<HTMLButtonElement>('#btn-pause-hud')?.addEventListener('click', () => {
      this.pause('game');
    });
  }

  private syncSettingsUI(): void {
    const set = <T extends HTMLInputElement | HTMLSelectElement>(
      id: string,
      value: string | number | boolean,
    ): void => {
      const node = document.getElementById(id) as T | null;
      if (!node) return;
      if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(value);
      else node.value = String(value);
    };
    set<HTMLSelectElement>('set-quality', this.settings.quality);
    set('set-motion', this.settings.reduceMotion);
    set('set-telemetry', this.eng?.visible ?? this.settings.telemetry);
    set('set-audio', this.settings.audioEnabled);
    set('set-volume', this.settings.volume);
    set('set-sens', this.settings.sensitivityMouse);
    set('set-invert', this.settings.invertY);
    set('set-hud', this.settings.hudScale);
    set('set-handed', this.settings.handedness === 'left');
    set('set-autoreload', this.settings.autoReload);
    set('set-aimassist', this.settings.aimAssistTouch);
    set('calib-invert', this.settings.invertY);
    set('calib-autoreload', this.settings.autoReload);
    set('calib-aimassist', this.settings.aimAssistTouch);
    const calibSens = this.input?.usingTouch
      ? this.settings.sensitivityTouch
      : this.settings.sensitivityMouse;
    set('calib-sens', calibSens);
    el('calib-sens-val').textContent = `${calibSens.toFixed(2)}×`;
    el('set-sens-val').textContent = `${this.settings.sensitivityMouse.toFixed(2)}×`;
    el('set-volume-val').textContent = `${Math.round(this.settings.volume * 100)}%`;
    el('set-hud-val').textContent = `${Math.round(this.settings.hudScale * 100)}%`;
    el('gfx-detail').textContent = `preset ${this.renderer?.preset.name ?? '—'} · dpr ${(this.renderer?.dpr ?? 1).toFixed(2)} · aim assist ${this.settings.aimAssistTouch ? 'on' : 'off'}`;

    this.app.querySelectorAll<HTMLElement>('[data-handedness]').forEach((node) => {
      const active = node.dataset.handedness === this.settings.handedness;
      node.classList.toggle('is-active', active);
      node.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.input?.detach();
    this.renderer?.dispose();
    this.audio.dispose();
  }
}
