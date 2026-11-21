/**
 * Máquina de pantallas pura: decide transiciones sin tocar el DOM, para poder
 * testear Esc, pérdida de pointer lock y reinicio sin navegador.
 */
export type Screen =
  | 'boot'
  | 'menu'
  | 'calibrate'
  | 'about'
  | 'sectors'
  | 'briefing'
  | 'leaderboard'
  | 'playing'
  | 'pause'
  | 'result'
  | 'fallback';
/** `run` es el Protocol Run de SPEC.md: el modo Misión. */
export type Mode = 'run' | 'overflow' | 'daily' | 'practice';
export type PauseOrigin = 'game' | 'menu';

export interface ScreenState {
  screen: Screen;
  mode: Mode;
  pauseOrigin: PauseOrigin;
}

export type EscapeAction = 'pause' | 'resume' | 'menu' | 'sectors' | 'none';

export function startMatch(state: ScreenState, mode: Mode): ScreenState {
  return { ...state, screen: 'playing', mode, pauseOrigin: 'game' };
}

/** Esc desde Ajustes abiertos en el menú vuelve al menú: no hay partida que reanudar. */
export function escapeAction(state: ScreenState): EscapeAction {
  if (state.screen === 'playing') return 'pause';
  if (state.screen === 'pause') return state.pauseOrigin === 'menu' ? 'menu' : 'resume';
  if (state.screen === 'briefing') return 'sectors';
  if (['sectors', 'leaderboard', 'about', 'calibrate'].includes(state.screen)) return 'menu';
  return 'none';
}

/** Solo el paso lock -> unlock (Esc del navegador) pausa; en táctil no hay lock. */
export function pointerLockLostAction(state: ScreenState, usingTouch: boolean): 'pause' | 'none' {
  return state.screen === 'playing' && !usingTouch ? 'pause' : 'none';
}

/** Un `pointerlockerror` no es un Esc: la partida sigue y se pide otro clic. */
export function pointerLockErrorAction(state: ScreenState): 'hint' | 'none' {
  return state.screen === 'playing' ? 'hint' : 'none';
}

const PAUSE_SUBTITLE: Record<Mode, string> = {
  run: 'protocolo en curso',
  overflow: 'ARGOS inunda el sector · sin límite de oleadas',
  daily: 'incidente del día · reglas fijas',
  practice: 'campo de práctica · sin límite',
};

export function pauseSubtitle(mode: Mode, mapId = 0): string {
  if (mode === 'run') return `Sector ${String(mapId + 1).padStart(2, '0')} · ${PAUSE_SUBTITLE.run}`;
  return PAUSE_SUBTITLE[mode];
}

/** Estado completo del flujo: `ScreenState` más el sector elegido. */
export interface FlowState extends ScreenState {
  mapId: number;
}

export type FlowEvent =
  | { type: 'boot-complete'; tutorialSeen: boolean }
  | { type: 'boot-failed' }
  | { type: 'open'; screen: 'menu' | 'calibrate' | 'about' | 'sectors' | 'leaderboard' }
  | { type: 'brief'; mapId: number }
  | { type: 'start'; mode: Mode; mapId: number }
  | { type: 'pause'; origin: PauseOrigin }
  | { type: 'settings' }
  | { type: 'resume' }
  | { type: 'finish' };

/**
 * Solo un "Jugar" explícito de un jugador nuevo entra por calibración. Sin intención (la
 * precarga en reposo terminó sola) la pantalla visible no cambia: el menú sigue siendo el menú.
 */
export function routesToCalibration(tutorialSeen: boolean, intentAction: string | undefined, hasIntent: boolean): boolean {
  return !tutorialSeen && hasIntent && intentAction === 'play';
}

export const INITIAL_FLOW: FlowState = { screen: 'boot', mode: 'run', pauseOrigin: 'game', mapId: 0 };

const PAGE_SCREENS: readonly Screen[] = ['menu', 'calibrate', 'about', 'sectors', 'briefing', 'leaderboard', 'result'];

/**
 * Transiciones del flujo. Un evento inválido para la pantalla actual devuelve el
 * mismo estado: nunca se llega a una pantalla por un atajo (p. ej. Esc a mitad de
 * un briefing o un `start` durante el arranque).
 */
export function transition(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'boot-complete':
      return state.screen === 'boot'
        ? { ...state, screen: event.tutorialSeen ? 'menu' : 'calibrate' }
        : state;
    case 'boot-failed':
      return state.screen === 'boot' ? { ...state, screen: 'fallback' } : state;
    case 'open':
      if (state.screen === 'pause' && event.screen === 'menu') return { ...state, screen: 'menu' };
      return PAGE_SCREENS.includes(state.screen) ? { ...state, screen: event.screen } : state;
    case 'brief':
      return state.screen === 'sectors' ? { ...state, screen: 'briefing', mapId: event.mapId } : state;
    case 'start':
      return state.screen === 'boot' || state.screen === 'fallback' || state.screen === 'playing'
        ? state
        : { ...state, screen: 'playing', mode: event.mode, mapId: event.mapId, pauseOrigin: 'game' };
    case 'pause':
      return state.screen === 'playing' ? { ...state, screen: 'pause', pauseOrigin: event.origin } : state;
    case 'settings':
      return state.screen === 'menu' ? { ...state, screen: 'pause', pauseOrigin: 'menu' } : state;
    case 'resume':
      return state.screen === 'pause' && state.pauseOrigin === 'game' ? { ...state, screen: 'playing' } : state;
    case 'finish':
      return state.screen === 'playing' ? { ...state, screen: 'result' } : state;
  }
}
