import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  observeTutorial,
  skipTutorial,
  startTutorial,
  tutorialDone,
  type TutorialFacts,
} from '../../src/core/tutorial';

const idle: TutorialFacts = { metersMoved: 0, shot: false, nodeActivated: false };

describe('practice tutorial', () => {
  it('has exactly the three actions of the brief, in order', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual(['move', 'shoot', 'terminal']);
  });

  it('completes the movement step after two meters, not before', () => {
    const start = startTutorial();
    expect(observeTutorial(start, { ...idle, metersMoved: 1.9 }).step).toBe(0);
    expect(observeTutorial(start, { ...idle, metersMoved: 2 }).step).toBe(1);
  });

  it('only the current step can complete', () => {
    const shotFirst = observeTutorial(startTutorial(), { ...idle, shot: true });
    expect(shotFirst.step).toBe(0);
    const atShoot = { step: 1, skipped: false };
    expect(observeTutorial(atShoot, { ...idle, nodeActivated: true }).step).toBe(1);
  });

  it('finishes on the terminal activation', () => {
    const atTerminal = { step: 2, skipped: false };
    const done = observeTutorial(atTerminal, { ...idle, nodeActivated: true });
    expect(tutorialDone(done)).toBe(true);
    expect(done.skipped).toBe(false);
  });

  it('can be skipped at any step and then ignores further facts', () => {
    const skipped = skipTutorial({ step: 1, skipped: false });
    expect(tutorialDone(skipped)).toBe(true);
    expect(skipped.skipped).toBe(true);
    expect(observeTutorial(skipped, { ...idle, shot: true })).toBe(skipped);
  });

  it('skipping a finished tutorial changes nothing', () => {
    const finished = { step: TUTORIAL_STEPS.length, skipped: false };
    expect(skipTutorial(finished)).toBe(finished);
  });
});
