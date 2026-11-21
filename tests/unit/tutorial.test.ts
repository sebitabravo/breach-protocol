import { describe, expect, it } from 'vitest';
import {
  TUTORIAL_STEPS,
  continueTutorial,
  observeTutorial,
  skipTutorial,
  startTutorial,
  type TutorialFacts,
} from '../../src/core/tutorial';

const idle: TutorialFacts = { metersMoved: 0, shot: false, nodeActivated: false };
const moved = { ...idle, metersMoved: 2 };
const shot = { ...idle, shot: true };
const activated = { ...idle, nodeActivated: true };

describe('practice tutorial', () => {
  it('has exactly the three actions of the brief, in order', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual(['move', 'shoot', 'terminal']);
  });

  it('completes the movement step after two meters, not before', () => {
    const start = startTutorial()!;
    expect(observeTutorial(start, { ...idle, metersMoved: 1.9 })).toBe(start);
    expect(observeTutorial(start, moved)).toMatchObject({ step: 1 });
  });

  it('only the current step can complete', () => {
    const start = startTutorial()!;
    expect(observeTutorial(start, shot)).toBe(start);
    const atShoot = observeTutorial(start, moved);
    expect(observeTutorial(atShoot, activated)).toBe(atShoot);
  });

  it('emits a new completed state exactly once, only after terminal activation', () => {
    const atTerminal = observeTutorial(observeTutorial(startTutorial()!, moved), shot);
    expect(atTerminal).toEqual({ status: 'active', step: 2 });
    expect(observeTutorial(atTerminal, idle)).toBe(atTerminal);

    const completed = observeTutorial(atTerminal, activated);
    expect(completed).not.toBe(atTerminal);
    expect(completed).toEqual({ status: 'completed' });
    expect(observeTutorial(completed, activated)).toBe(completed);
    expect(continueTutorial(completed)).toBe(completed);
    expect(skipTutorial(completed)).toBe(completed);
  });

  it('skips from any active step and cannot turn a skip into completion', () => {
    const atMove = startTutorial()!;
    const atShoot = observeTutorial(atMove, moved);
    const atTerminal = observeTutorial(atShoot, shot);
    for (const active of [atMove, atShoot, atTerminal]) {
      const skipped = skipTutorial(active);
      expect(skipped).toEqual({ status: 'skipped' });
      expect(skipTutorial(skipped)).toBe(skipped);
      expect(continueTutorial(skipped)).toBe(skipped);
      expect(observeTutorial(skipped, activated)).toBe(skipped);
    }
  });

  it('does not re-enter after a completion or skip is marked seen, except on explicit replay', () => {
    expect(startTutorial(true)).toBeNull();
    expect(startTutorial(true, true)).toEqual({ status: 'active', step: 0 });
    expect(startTutorial(false)).toEqual({ status: 'active', step: 0 });
  });
});
