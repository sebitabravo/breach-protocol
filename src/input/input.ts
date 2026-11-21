/**
 * Keyboard + mouse + multitouch normaliser.
 *
 * The simulation only ever sees a neutral `Float32Array` for one tick, so it
 * cannot depend on the DOM. Every touch control owns its own `pointerId` with
 * pointer capture, which is what makes "move + aim + fire" work with three
 * fingers at once instead of dropping the previous gesture.
 */
import { I, INPUT_LEN } from '../wasm/protocol';
import type { Settings } from '../core/settings';
import { KeyboardState, shouldPreventDefault } from './keyboard';

const MOUSE_RAD_PER_PX = 0.0021;
const TOUCH_RAD_PER_PX = 0.0034;
const STICK_RADIUS = 52;

export interface InputHooks {
  onPause(): void;
  onEngineering(): void;
  onTutorialKey(action: 'continue' | 'skip', repeat: boolean): boolean;
  onPointerLockLost(): void;
  onPointerLockError(): void;
  isPlaying(): boolean;
  onTouchDetected(): void;
  onMouseDetected(): void;
  getWeapon(): number;
  unlockedWeapons(): readonly number[];
}

/** Siguiente arma desbloqueada en orden de ids; si la actual está bloqueada, vuelve a la primera. */
export function nextWeapon(current: number, unlocked: readonly number[]): number {
  if (unlocked.length === 0) return 0;
  const index = unlocked.indexOf(current);
  return unlocked[(index + 1) % unlocked.length];
}

type PointerKind = 'stick' | 'look';

interface TrackedPointer {
  kind: PointerKind;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
}

export class InputManager {
  readonly buffer = new Float32Array(INPUT_LEN);

  private kb = new KeyboardState();
  private lookX = 0;
  private lookY = 0;
  private fireHeld = false;
  private firePressed = false;
  private jumpPressed = false;
  private reloadPressed = false;
  private switchTo = 0;
  private adsHeld = false;
  private touchFire = false;
  private touchInteract = false;
  private stickX = 0;
  private stickY = 0;
  private pointers = new Map<number, TrackedPointer>();

  private frameLookX = 0;
  private frameLookY = 0;
  private frameFirePressed = false;
  private frameJumpPressed = false;
  private frameReloadPressed = false;
  private frameSwitch = 0;
  private frameMoveX = 0;
  private frameMoveZ = 0;

  usingTouch = false;
  pointerLocked = false;

  private settings: Settings;
  private attached = false;

  private readonly stick = document.getElementById('touch-stick');
  private readonly knob = document.getElementById('touch-knob');

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly hooks: InputHooks,
    settings: Settings,
  ) {
    this.settings = settings;
    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
      this.usingTouch = true;
    }
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
  }

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('contextmenu', this.preventDefault);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('pointermove', this.onWindowPointerMove, { passive: true });
    document.getElementById('touch-layer')?.addEventListener('pointerdown', this.onTouchLayerDown);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('pointercancel', this.onWindowPointerUp);
    this.stick?.addEventListener('pointerdown', this.onStickDown);
    this.stick?.addEventListener('pointermove', this.onStickMove);
    this.stick?.addEventListener('pointerup', this.onStickUp);
    this.stick?.addEventListener('pointercancel', this.onStickUp);
    this.stick?.addEventListener('lostpointercapture', this.onStickUp);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('pointerlockerror', this.onPointerLockError);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.removeEventListener('contextmenu', this.preventDefault);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    document.getElementById('touch-layer')?.removeEventListener('pointerdown', this.onTouchLayerDown);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('pointercancel', this.onWindowPointerUp);
    this.stick?.removeEventListener('pointerdown', this.onStickDown);
    this.stick?.removeEventListener('pointermove', this.onStickMove);
    this.stick?.removeEventListener('pointerup', this.onStickUp);
    this.stick?.removeEventListener('pointercancel', this.onStickUp);
    this.stick?.removeEventListener('lostpointercapture', this.onStickUp);
  }

  // --------------------------------------------------------------- frame api

  /** Consumes buffered look deltas and edge-triggered actions for this frame. */
  beginFrame(): void {
    this.frameLookX = this.lookX;
    this.frameLookY = this.lookY;
    this.frameFirePressed = this.firePressed;
    this.frameJumpPressed = this.jumpPressed || this.kb.consumeJump();
    this.frameReloadPressed = this.reloadPressed || this.kb.consumeReload();
    const keyboardSwitch = this.kb.consumeSwitch();
    const requested = this.switchTo || keyboardSwitch;
    this.frameSwitch = this.hooks.unlockedWeapons().includes(requested) ? requested : 0;
    this.lookX = 0;
    this.lookY = 0;
    this.firePressed = false;
    this.jumpPressed = false;
    this.reloadPressed = false;
    this.switchTo = 0;

    const keys = this.kb;
    let mx = 0;
    let mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) mz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) mz -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
    this.frameMoveX = mx + this.stickX;
    this.frameMoveZ = mz + this.stickY;
  }

  /**
   * Writes one tick of input. `first` is true only for the first substep of the
   * frame: look deltas and edge flags must not be multiplied by substepping.
   */
  writeTo(target: Float32Array, first: boolean): void {
    const touchScale = TOUCH_RAD_PER_PX * this.settings.sensitivityTouch;
    const mouseScale = MOUSE_RAD_PER_PX * this.settings.sensitivityMouse;
    const scale = this.usingTouch ? touchScale : mouseScale;
    const invert = this.settings.invertY ? -1 : 1;

    target[I.moveX] = clamp(this.frameMoveX, -1, 1);
    target[I.moveZ] = clamp(this.frameMoveZ, -1, 1);
    target[I.lookDx] = first ? this.frameLookX * scale : 0;
    target[I.lookDy] = first ? this.frameLookY * scale * invert : 0;
    target[I.fireHeld] = this.fireHeld || this.touchFire ? 1 : 0;
    target[I.firePressed] = first && this.frameFirePressed ? 1 : 0;
    target[I.jump] = first && this.frameJumpPressed ? 1 : 0;
    target[I.interact] = this.kb.has('KeyE') || this.touchInteract ? 1 : 0;
    target[I.reload] = first && this.frameReloadPressed ? 1 : 0;
    target[I.run] = this.kb.has('ShiftLeft') || this.kb.has('ShiftRight') ? 1 : 0;
    target[I.switch] = first ? this.frameSwitch : 0;
    target[I.ads] = this.adsHeld ? 1 : 0;
  }

  /** Clears every held state: used on pause, blur and orientation change. */
  reset(): void {
    this.kb.clear();
    this.pointers.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.fireHeld = false;
    this.firePressed = false;
    this.jumpPressed = false;
    this.reloadPressed = false;
    this.switchTo = 0;
    this.adsHeld = false;
    this.touchFire = false;
    this.touchInteract = false;
    this.stickX = 0;
    this.stickY = 0;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
    this.buffer.fill(0);
  }

  // --------------------------------------------------------------- pointer lock

  async requestPointerLock(): Promise<boolean> {
    if (this.usingTouch) return false;
    if (document.pointerLockElement === this.canvas) return true;
    try {
      await this.canvas.requestPointerLock();
      return true;
    } catch {
      return false;
    }
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  // ------------------------------------------------------------------ handlers

  private preventDefault = (event: Event): void => {
    event.preventDefault();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    const code = event.code;
    if (code === 'Escape') {
      if (!event.repeat) this.hooks.onPause();
      return;
    }
    if (code === 'F3') {
      event.preventDefault();
      if (!event.repeat) this.hooks.onEngineering();
      return;
    }
    const target = event.target as HTMLElement | null;
    const formTarget = target?.closest?.('input, select, textarea, button') != null;
    const tutorialKey = code === 'Enter' || code === 'NumpadEnter' ? 'continue' : code === 'Backspace' ? 'skip' : null;
    if (tutorialKey && !formTarget && !event.defaultPrevented && !event.isComposing &&
        !event.ctrlKey && !event.altKey && !event.metaKey && this.hooks.onTutorialKey(tutorialKey, event.repeat)) {
      event.preventDefault();
      return;
    }
    if (shouldPreventDefault(code, { playing: this.hooks.isPlaying(), formTarget })) {
      event.preventDefault();
    }
    this.kb.keyDown(code, event.repeat);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.kb.keyUp(event.code);
  };

  private onBlur = (): void => {
    this.reset();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked || this.usingTouch) return;
    this.lookX += event.movementX;
    this.lookY += event.movementY;
  };

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    const was = this.pointerLocked;
    this.pointerLocked = locked;
    if (locked && this.hooks.isPlaying()) {
      this.canvas.focus({ preventScroll: true });
    } else if (was && !locked) {
      this.fireHeld = false;
      this.hooks.onPointerLockLost();
    }
  };

  private onPointerLockError = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (this.hooks.isPlaying()) this.canvas.focus({ preventScroll: true });
    this.hooks.onPointerLockError();
  };

  /** El modo sigue al último puntero real; los eventos de mouse de compatibilidad ya no disparan. */
  private markTouch(event: PointerEvent): void {
    if (event.pointerType === 'touch' && !this.usingTouch) {
      this.usingTouch = true;
      this.hooks.onTouchDetected();
    } else if (event.pointerType === 'mouse' && this.usingTouch) {
      this.usingTouch = false;
      this.hooks.onMouseDetected();
    }
  }

  private onCanvasPointerDown = (event: PointerEvent): void => {
    this.markTouch(event);
    if (event.pointerType === 'mouse') {
      if (event.button === 0) {
        this.fireHeld = true;
        this.firePressed = true;
      }
      if (!this.pointerLocked) {
        void this.requestPointerLock();
      }
      return;
    }
    // Touch look: a free finger on the game surface drags the camera.
    this.canvas.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      kind: 'look',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    });
  };

  private onStickDown = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.markTouch(event);
    this.stick?.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, {
      kind: 'stick',
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
    });
  };

  private onStickMove = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked || tracked.kind !== 'stick') return;
    event.preventDefault();
    const dx = clamp(event.clientX - tracked.startX, -STICK_RADIUS, STICK_RADIUS);
    const dy = clamp(event.clientY - tracked.startY, -STICK_RADIUS, STICK_RADIUS);
    this.stickX = dx / STICK_RADIUS;
    this.stickY = -dy / STICK_RADIUS;
    if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  private onStickUp = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked || tracked.kind !== 'stick') return;
    this.pointers.delete(event.pointerId);
    this.stickX = 0;
    this.stickY = 0;
    if (this.knob) this.knob.style.transform = 'translate(0px, 0px)';
  };

  private onWindowPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button === 0) this.fireHeld = false;
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked) return;
    if (tracked.kind === 'stick') {
      this.onStickUp(event);
      return;
    }
    this.pointers.delete(event.pointerId);
  };

  private onTouchLayerDown = (event: PointerEvent): void => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Look drags may start anywhere that is not a control, so the player never
    // has to find a "dead zone" to turn the camera.
    if (!target.closest('[data-touch]') && !target.closest('#touch-stick')) {
      this.markTouch(event);
      this.canvas.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, {
        kind: 'look',
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
      });
      return;
    }

    const control = target.closest<HTMLElement>('[data-touch]');
    if (!control) return;
    event.preventDefault();
    this.markTouch(event);
    const kind = control.dataset.touch;
    const release = (): void => {
      control.classList.remove('is-down');
      control.removeEventListener('pointerup', release);
      control.removeEventListener('pointercancel', release);
      control.removeEventListener('lostpointercapture', release);
      if (kind === 'fire') this.touchFire = false;
      if (kind === 'interact') this.touchInteract = false;
      if (kind === 'ads') this.adsHeld = false;
    };
    control.classList.add('is-down');
    control.setPointerCapture(event.pointerId);
    control.addEventListener('pointerup', release);
    control.addEventListener('pointercancel', release);
    control.addEventListener('lostpointercapture', release);

    switch (kind) {
      case 'fire':
        this.touchFire = true;
        this.firePressed = true;
        break;
      case 'jump':
        this.jumpPressed = true;
        break;
      case 'reload':
        this.reloadPressed = true;
        break;
      case 'interact':
        this.touchInteract = true;
        break;
      case 'switch':
        this.switchTo = nextWeapon(this.hooks.getWeapon(), this.hooks.unlockedWeapons());
        break;
      case 'ads':
        this.adsHeld = true;
        break;
      case 'pause':
        this.hooks.onPause();
        break;
      default:
        break;
    }
  };

  /** Called on every window pointermove while a look pointer is active. */
  private onWindowPointerMove = (event: PointerEvent): void => {
    const tracked = this.pointers.get(event.pointerId);
    if (!tracked || tracked.kind !== 'look') return;
    this.lookX += event.clientX - tracked.lastX;
    this.lookY += event.clientY - tracked.lastY;
    tracked.lastX = event.clientX;
    tracked.lastY = event.clientY;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
