/** Overlay del tutorial: informativo, nunca bloquea la partida. */
import { TUTORIAL_STEPS, tutorialDone, type TutorialState } from '../core/tutorial';
import { byId } from './dom';

export function renderTutorial(state: TutorialState | null): void {
  const overlay = byId('tutorial');
  if (state === null || tutorialDone(state)) {
    overlay.hidden = true;
    return;
  }
  const step = TUTORIAL_STEPS[state.step];
  overlay.hidden = false;
  byId('tut-index').textContent = String(state.step + 1);
  byId('tut-title').textContent = step.title;
  byId('tut-body').textContent = step.body;
  overlay.querySelectorAll<HTMLElement>('.tutorial__dots i').forEach((dot, index) => {
    dot.classList.toggle('is-done', index < state.step);
    dot.classList.toggle('is-current', index === state.step);
  });
}
