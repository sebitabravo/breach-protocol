/** Tres acciones del Simulador, en orden: movimiento, disparo, terminal. */
export const TUTORIAL_STEPS = [
  { id: 'move', title: 'Moverse', body: 'WASD o joystick izquierdo. Caminá dos metros.' },
  { id: 'shoot', title: 'Apuntar y disparar', body: 'Mirá con el mouse o arrastrá. Dispará con clic izquierdo o el botón de fuego.' },
  { id: 'terminal', title: 'Activar terminal', body: 'Seguí el rombo hasta la terminal marcada. Mantené hasta llenar la barra.' },
] as const;

export const TUTORIAL_MOVE_METERS = 2;
export const TUTORIAL_TERMINAL_STEP = 2;
/** Terminal este del Simulador (SECTOR_01), a la derecha de la salida. */
export const TUTORIAL_TERMINAL = 1;

type ActiveTutorial = { status: 'active'; step: 0 | 1 | typeof TUTORIAL_TERMINAL_STEP };
export type TutorialOutcome = { status: 'completed' | 'skipped' };
export type TutorialState = ActiveTutorial | TutorialOutcome;

export interface TutorialFacts {
  metersMoved: number;
  shot: boolean;
  nodeActivated: boolean;
}

export function startTutorial(tutorialSeen = false, replay = false): ActiveTutorial | null {
  return tutorialSeen && !replay ? null : { status: 'active', step: 0 };
}

/** Avanza a lo sumo un paso; una vez emitido el resultado, no vuelve a cambiar. */
export function observeTutorial(state: TutorialState, facts: TutorialFacts): TutorialState {
  if (state.status !== 'active') return state;
  const completed =
    (state.step === 0 && facts.metersMoved >= TUTORIAL_MOVE_METERS) ||
    (state.step === 1 && facts.shot) ||
    (state.step === TUTORIAL_TERMINAL_STEP && facts.nodeActivated);
  return completed ? continueTutorial(state) : state;
}

export function continueTutorial(state: TutorialState): TutorialState {
  if (state.status !== 'active') return state;
  if (state.step === TUTORIAL_TERMINAL_STEP) return { status: 'completed' };
  return { status: 'active', step: state.step === 0 ? 1 : TUTORIAL_TERMINAL_STEP };
}

export function skipTutorial(state: TutorialState): TutorialState {
  return state.status === 'active' ? { status: 'skipped' } : state;
}
