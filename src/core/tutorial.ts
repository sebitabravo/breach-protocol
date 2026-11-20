/**
 * Tutorial de tres acciones del Simulador: moverse, disparar y activar un terminal.
 * Avanza con hechos observados (posición, disparos, nodos) y nunca bloquea el
 * juego: el overlay es informativo y puede omitirse en cualquier paso.
 */
export const TUTORIAL_STEPS = [
  { id: 'move', title: 'Moverse', body: 'WASD o joystick izquierdo. Caminá dos metros.' },
  { id: 'shoot', title: 'Apuntar y disparar', body: 'Mirá con el mouse o arrastrá con el pulgar derecho. Disparo: click izquierdo o botón de fuego.' },
  { id: 'terminal', title: 'Activar terminal', body: 'Acercate a un terminal y mantené E hasta que se active.' },
] as const;

export const TUTORIAL_MOVE_METERS = 2;

export interface TutorialState {
  /** Índice del paso actual; `TUTORIAL_STEPS.length` significa terminado. */
  step: number;
  skipped: boolean;
}

export interface TutorialFacts {
  metersMoved: number;
  shot: boolean;
  nodeActivated: boolean;
}

export function startTutorial(): TutorialState {
  return { step: 0, skipped: false };
}

export function tutorialDone(state: TutorialState): boolean {
  return state.step >= TUTORIAL_STEPS.length;
}

/** Avanza a lo sumo un paso por observación: solo el paso actual puede completarse. */
export function observeTutorial(state: TutorialState, facts: TutorialFacts): TutorialState {
  if (tutorialDone(state)) return state;
  const completed =
    (state.step === 0 && facts.metersMoved >= TUTORIAL_MOVE_METERS) ||
    (state.step === 1 && facts.shot) ||
    (state.step === 2 && facts.nodeActivated);
  return completed ? { ...state, step: state.step + 1 } : state;
}

export function skipTutorial(state: TutorialState): TutorialState {
  return tutorialDone(state) ? state : { step: TUTORIAL_STEPS.length, skipped: true };
}
