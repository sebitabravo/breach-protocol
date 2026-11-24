/**
 * Contrato multi-puntero del InputManager, probado con eventos sintéticos.
 *
 * `src/input/input.ts` documenta que cada control táctil es dueño de su propio
 * `pointerId` con pointer capture, y que eso habilita "mover + apuntar +
 * disparar" con varios dedos a la vez. Estos tests fijan ese contrato:
 *
 * - pointerdown en #touch-stick registra un puntero 'stick' (propietario del
 *   vector de movimiento, `stickX`/`stickY`).
 * - pointerdown en un botón `[data-touch]` (fuego) no entra al mapa de
 *   punteros: el botón se captura a sí mismo y mantiene `touchFire`.
 * - pointerdown táctil sobre el canvas registra un puntero 'look'
 *   (propietario del aim); el delta llega por `pointermove` de window.
 * - Dos punteros activos a la vez no se serializan: el mismo tick del buffer
 *   lleva movimiento y disparo.
 * - Levantar el puntero de fuego no toca el movimiento; levantar el puntero de
 *   movimiento deja `stickX`/`stickY` en cero (sin vector trabado).
 * - Un tercer puntero (o uno desconocido) no roba roles ni deja estado atrás.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { InputManager, type InputHooks } from '../../src/input/input';
import { I, INPUT_LEN } from '../../src/wasm/protocol';

/** Deflexión de prueba: supera el radio interno (52 px) y queda recortada a stickX = 1. */
const STICK_DEFLECT = 100;

interface FakePointerEvent {
  type: string;
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  button: number;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

interface FakeNode {
  dataset: Record<string, string>;
  style: { transform: string };
  classList: { add(name: string): void; remove(name: string): void };
  captured: number[];
  addEventListener(type: string, listener: (event: FakePointerEvent) => void): void;
  removeEventListener(type: string, listener: (event: FakePointerEvent) => void): void;
  /** Dispara los listeners registrados para `type` con un evento sintético. */
  dispatch(type: string, patch?: Partial<FakePointerEvent>): void;
  closest(selector: string): FakeNode | null;
  setPointerCapture(pointerId: number): void;
  focus(): void;
}

const NO_EVENT: FakePointerEvent = {
  type: '',
  pointerId: -1,
  pointerType: 'touch',
  clientX: 0,
  clientY: 0,
  button: 0,
  target: null,
  preventDefault: () => undefined,
  stopPropagation: () => undefined,
};

function makeFakeNode(dataset: Record<string, string> = {}, closest: FakeNode['closest'] = () => null): FakeNode {
  const listeners = new Map<string, Array<(event: FakePointerEvent) => void>>();
  const node: FakeNode = {
    dataset,
    style: { transform: '' },
    captured: [],
    classList: { add: () => undefined, remove: () => undefined },
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    },
    dispatch(type, patch = {}) {
      const event: FakePointerEvent = { ...NO_EVENT, type, target: patch.target ?? node, ...patch };
      event.preventDefault = () => undefined;
      event.stopPropagation = () => undefined;
      for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
    },
    closest,
    setPointerCapture(pointerId) {
      node.captured.push(pointerId);
    },
    focus: () => undefined,
  };
  return node;
}

const winListeners = new Map<string, Array<(event: FakePointerEvent) => void>>();

function windowDispatch(type: string, patch: Partial<FakePointerEvent> = {}): void {
  const event: FakePointerEvent = { ...NO_EVENT, type, ...patch };
  for (const listener of [...(winListeners.get(type) ?? [])]) listener(event);
}

const dom: { current: { stick: FakeNode; knob: FakeNode; layer: FakeNode } | null } = { current: null };

const fakeDocument = {
  getElementById(id: string): FakeNode | null {
    if (!dom.current) return null;
    if (id === 'touch-stick') return dom.current.stick;
    if (id === 'touch-knob') return dom.current.knob;
    if (id === 'touch-layer') return dom.current.layer;
    return null;
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  pointerLockElement: null,
};

const fakeWindow = {
  addEventListener(type: string, listener: (event: FakePointerEvent) => void, _options?: unknown): void {
    const list = winListeners.get(type) ?? [];
    list.push(listener);
    winListeners.set(type, list);
  },
  removeEventListener(type: string, listener: (event: FakePointerEvent) => void): void {
    winListeners.set(type, (winListeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  },
  matchMedia: undefined,
};

let originalDocument: unknown;
let originalDocumentDescriptor: PropertyDescriptor | undefined;
let originalWindow: unknown;
let originalWindowDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    get: () => fakeDocument as unknown as Document,
  });
  originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    get: () => fakeWindow as unknown as Window & typeof globalThis,
  });
});

afterAll(() => {
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor);
  else if (originalDocument === undefined) delete (globalThis as Record<string, unknown>).document;
  else (globalThis as { document: unknown }).document = originalDocument;
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
  else if (originalWindow === undefined) delete (globalThis as Record<string, unknown>).window;
  else (globalThis as { window: unknown }).window = originalWindow;
});

interface Rig {
  input: InputManager;
  canvas: FakeNode;
  stick: FakeNode;
  fire: FakeNode;
  layer: FakeNode;
  touchesSeen(): number;
}

/** Montaje limpio por test: stick, touch-layer con botón de fuego y canvas. */
function rig(): Rig {
  const stick = makeFakeNode();
  const knob = makeFakeNode();
  const layer = makeFakeNode();
  const canvas = makeFakeNode();
  const fire = makeFakeNode({ touch: 'fire' }, (selector) => (selector === '[data-touch]' ? fire : null));
  dom.current = { stick, knob, layer };
  winListeners.clear();
  let touchSeen = 0;
  const hooks: InputHooks = {
    onPause: () => undefined,
    onEngineering: () => undefined,
    onTutorialKey: () => false,
    onPointerLockLost: () => undefined,
    onPointerLockError: () => undefined,
    isPlaying: () => true,
    onTouchDetected: () => {
      touchSeen += 1;
    },
    onMouseDetected: () => undefined,
    getWeapon: () => 1,
    unlockedWeapons: () => [1, 2],
  };
  const input = new InputManager(canvas as unknown as HTMLCanvasElement, hooks, { ...DEFAULT_SETTINGS });
  input.attach();
  return { input, canvas, stick, fire, layer, touchesSeen: () => touchSeen };
}

/** beginFrame + writeTo en un tick, como lo consume la simulación. */
function tickOf(input: InputManager, first = true): Float32Array {
  input.beginFrame();
  const buffer = new Float32Array(INPUT_LEN);
  input.writeTo(buffer, first);
  return buffer;
}

function touchDown(node: FakeNode, pointerId: number, x: number, y: number, target?: FakeNode): void {
  node.dispatch('pointerdown', { pointerId, pointerType: 'touch', clientX: x, clientY: y, target });
}

/** path:input.ts onStickMove — la deflexión se recorta al radio del stick. */
function stickMoveDom(pointerId: number, x: number, y: number): void {
  dom.current!.stick.dispatch('pointermove', { pointerId, pointerType: 'touch', clientX: x, clientY: y });
}

describe('InputManager multi-pointer touch contract', () => {
  beforeEach(() => {
    dom.current = null;
    winListeners.clear();
  });

  it('two simultaneous pointers register their own role: stick drives movement, a held fire tap arcs the shot, look drag aims', () => {
    const { input, canvas, stick, fire, layer } = rig();
    // Puntero 1: stick (mueve). Puntero 2: botón de fuego (dispara). Puntero 3: look (apunta).
    touchDown(stick, 1, 200, 200);
    touchDown(layer, 2, 700, 500, fire);
    touchDown(canvas, 3, 400, 300);
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    windowDispatch('pointermove', { pointerId: 3, clientX: 415, clientY: 300 });

    const stuck = tickOf(input);
    expect(stick.captured).toEqual([1]);
    expect(canvas.captured).toEqual([3]);
    expect(stuck[I.moveX]).toBe(1); // stick: propietario del movimiento
    expect(stuck[I.fireHeld]).toBe(1); // fuego: propietario del disparo
    expect(stuck[I.firePressed]).toBe(1); // prensado del mismo tap
    expect(stuck[I.lookDx]).toBeGreaterThan(0); // look: propietario del aim
    // El aim del puntero 3 no se cuela en el stick: sigue con la deflexión del puntero 1.
    expect(stuck[I.moveZ]).toBe(0);
  });

  it('holding the move pointer while tapping fire yields a movement vector and a fire action in the same tick', () => {
    const { input, stick, fire, layer } = rig();
    touchDown(stick, 1, 200, 200);
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    const before = tickOf(input);
    expect(before[I.moveX]).toBe(1);
    expect(before[I.fireHeld]).toBe(0);

    // Tap de fuego con el stick todavía agarrado: mismo tick, ambos bits.
    touchDown(layer, 2, 700, 500, fire);
    const both = tickOf(input);
    expect(both[I.moveX]).toBe(1);
    expect(both[I.fireHeld]).toBe(1);
    expect(both[I.firePressed]).toBe(1);
    // Edge-triggered: el siguiente tick mantiene held pero no repite pressed.
    const after = tickOf(input);
    expect(after[I.moveX]).toBe(1);
    expect(after[I.fireHeld]).toBe(1);
    expect(after[I.firePressed]).toBe(0);
  });

  it('lifting the fire pointer leaves the held movement intact', () => {
    const { input, stick, fire, layer } = rig();
    touchDown(stick, 1, 200, 200);
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    touchDown(layer, 2, 700, 500, fire);
    tickOf(input);

    fire.dispatch('pointerup', { pointerId: 2 });
    windowDispatch('pointerup', { pointerId: 2 });
    const after = tickOf(input);
    expect(after[I.fireHeld]).toBe(0);
    expect(after[I.firePressed]).toBe(0);
    expect(after[I.moveX]).toBe(1); // el movimiento sobrevive al levantar el fuego
  });

  it('lifting the move pointer leaves no stuck movement and no stuck sprint', () => {
    const { input, stick, fire, layer } = rig();
    touchDown(stick, 1, 200, 200);
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    touchDown(layer, 2, 700, 500, fire);
    tickOf(input);

    stick.dispatch('pointerup', { pointerId: 1 });
    stick.dispatch('lostpointercapture', { pointerId: 1 });
    windowDispatch('pointerup', { pointerId: 1 });
    const after = tickOf(input);
    expect(after[I.moveX]).toBe(0);
    expect(after[I.moveZ]).toBe(0);
    expect(after[I.run]).toBe(0); // sin sprint trabado
    expect(after[I.fireHeld]).toBe(1); // el fuego sigue agarrado
    // Un pointermove tardío del id ya liberado no resurrecta el vector.
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    const late = tickOf(input);
    expect(late[I.moveX]).toBe(0);
  });

  it('a third pointer does not steal a role and leaves no state behind; unknown ids are ignored', () => {
    const { input, canvas, stick, fire, layer } = rig();
    touchDown(stick, 1, 200, 200);
    stickMoveDom(1, 200 + STICK_DEFLECT, 200);
    touchDown(layer, 2, 700, 500, fire);
    tickOf(input);

    // Tercer dedo en el canvas: se vuelve 'look', no toca stick ni fuego.
    touchDown(canvas, 3, 500, 500);
    windowDispatch('pointermove', { pointerId: 3, clientX: 530, clientY: 500 });
    const during = tickOf(input);
    expect(during[I.moveX]).toBe(1);
    expect(during[I.fireHeld]).toBe(1);
    const firstLook = during[I.lookDx];

    // Otro move del mismo puntero: los deltas se acumulan dentro del frame.
    windowDispatch('pointermove', { pointerId: 3, clientX: 590, clientY: 500 });
    const accumulated = tickOf(input);
    expect(accumulated[I.lookDx]).toBeGreaterThan(firstLook);

    // Id desconocido: ni crash ni contaminación del aim.
    windowDispatch('pointermove', { pointerId: 77, clientX: 0, clientY: 0 });
    const ignored = tickOf(input);
    expect(ignored[I.lookDx]).toBe(0);

    // Levantar el tercer puntero: el movimiento y el fuego siguen intactos y
    // el aim no vuelve a repetirse (sin estado trabado del look).
    windowDispatch('pointerup', { pointerId: 3 });
    const lifted = tickOf(input);
    expect(lifted[I.moveX]).toBe(1);
    expect(lifted[I.fireHeld]).toBe(1);
    expect(lifted[I.lookDx]).toBe(0);
  });

  it('the same sequence in reverse order (fire first, then move) behaves symmetrically', () => {
    const { input, stick, fire, layer } = rig();
    // Fuego primero; el prensado se consume en su propio tick.
    touchDown(layer, 1, 700, 500, fire);
    const fireFirst = tickOf(input);
    expect(fireFirst[I.fireHeld]).toBe(1);
    expect(fireFirst[I.firePressed]).toBe(1);
    expect(fireFirst[I.moveX]).toBe(0);

    // Stick después: ambos bits conviven en el mismo tick (espejo del caso directo).
    touchDown(stick, 2, 200, 200);
    stickMoveDom(2, 200 + STICK_DEFLECT, 200);
    const both = tickOf(input);
    expect(both[I.moveX]).toBe(1);
    expect(both[I.fireHeld]).toBe(1);

    // Levantar el stick no mata el fuego; levantar el fuego no deja vector.
    stick.dispatch('pointerup', { pointerId: 2 });
    windowDispatch('pointerup', { pointerId: 2 });
    const stickUp = tickOf(input);
    expect(stickUp[I.moveX]).toBe(0);
    expect(stickUp[I.fireHeld]).toBe(1);

    fire.dispatch('pointerup', { pointerId: 1 });
    windowDispatch('pointerup', { pointerId: 1 });
    const fireUp = tickOf(input);
    expect(fireUp[I.fireHeld]).toBe(0);
    expect(fireUp[I.moveX]).toBe(0);
  });
});
