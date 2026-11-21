/** Overlay del tutorial: informativo, nunca bloquea la partida. */
import { TUTORIAL_STEPS, type TutorialOutcome, type TutorialState } from '../core/tutorial';
import { byId } from './dom';

export function renderTutorial(state: TutorialState | null): void {
  const overlay = byId('tutorial');
  if (state?.status !== 'active') {
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

export function renderTutorialHandoff(outcome: TutorialOutcome, elapsedSeconds: number): void {
  const completed = outcome.status === 'completed';
  byId('tut-handoff-title').textContent = completed ? 'TUTORIAL COMPLETADO' : 'TUTORIAL OMITIDO';
  byId('tut-handoff-recap').hidden = !completed;
  byId('tut-handoff-skip-note').hidden = completed;
  const time = byId<HTMLTimeElement>('tut-handoff-time');
  const minutes = String(Math.floor(elapsedSeconds / 60)).padStart(2, '0');
  const seconds = String(elapsedSeconds % 60).padStart(2, '0');
  time.textContent = completed ? `${minutes}:${seconds}` : '';
  time.dateTime = completed ? `PT${elapsedSeconds}S` : '';
}
