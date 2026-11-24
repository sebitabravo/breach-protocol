/** Overlay del tutorial: informativo, nunca bloquea la partida. */
import { TUTORIAL_STEPS, tutorialBody, type TutorialDevice, type TutorialOutcome, type TutorialState } from '../core/tutorial';
import { t, formatClockPadded } from '../i18n/runtime';
import { byId } from './dom';

export function renderTutorial(state: TutorialState | null, device: TutorialDevice = 'keyboard'): void {
  const overlay = byId('tutorial');
  if (state?.status !== 'active') {
    overlay.hidden = true;
    return;
  }
  const step = TUTORIAL_STEPS[state.step];
  overlay.hidden = false;
  byId('tut-index').textContent = String(state.step + 1);
  byId('tut-title').textContent = step.title;
  byId('tut-body').textContent = tutorialBody(state.step, device);
  overlay.querySelectorAll<HTMLElement>('.tutorial__dots i').forEach((dot, index) => {
    dot.classList.toggle('is-done', index < state.step);
    dot.classList.toggle('is-current', index === state.step);
  });
}

export function renderTutorialHandoff(outcome: TutorialOutcome, elapsedSeconds: number): void {
  const completed = outcome.status === 'completed';
  byId('tut-handoff-title').textContent = completed ? t('handoff.titleCompleted') : t('handoff.titleSkipped');
  byId('tut-handoff-recap').hidden = !completed;
  byId('tut-handoff-skip-note').hidden = completed;
  const time = byId<HTMLTimeElement>('tut-handoff-time');
  time.textContent = completed ? formatClockPadded(elapsedSeconds) : '';
  time.dateTime = completed ? `PT${elapsedSeconds}S` : '';
}
