/**
 * Máquina de pantallas pura: decide transiciones sin tocar el DOM, para poder
 * testear Esc, pérdida de pointer lock y reinicio sin navegador.
 */
export type Screen = 'boot' | 'menu' | 'calibrate' | 'about' | 'playing' | 'pause' | 'result' | 'fallback';
export type Mode = 'run' | 'practice';
export type PauseOrigin = 'game' | 'menu';

export interface ScreenState {
  screen: Screen;
  mode: Mode;
  pauseOrigin: PauseOrigin;
}

export type EscapeAction = 'pause' | 'resume' | 'menu' | 'none';

export function startMatch(state: ScreenState, mode: Mode): ScreenState {
  return { ...state, screen: 'playing', mode, pauseOrigin: 'game' };
}

/** Esc desde Ajustes abiertos en el menú vuelve al menú: no hay partida que reanudar. */
export function escapeAction(state: ScreenState): EscapeAction {
  if (state.screen === 'playing') return 'pause';
  if (state.screen === 'pause') return state.pauseOrigin === 'menu' ? 'menu' : 'resume';
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

export function pauseSubtitle(mode: Mode): string {
  return mode === 'practice' ? 'Campo de práctica · sin límite' : 'Sector 01 · protocolo en curso';
}
