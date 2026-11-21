import { describe, expect, it } from 'vitest';
import {
  escapeAction,
  pauseSubtitle,
  pointerLockErrorAction,
  pointerLockLostAction,
  startMatch,
  type ScreenState,
} from '../../src/core/screens';

const base: ScreenState = { screen: 'menu', mode: 'run', pauseOrigin: 'game' };

describe('screen state machine', () => {
  it('startMatch stores the requested mode so restart keeps it', () => {
    const next = startMatch(base, 'practice');
    expect(next).toEqual({ screen: 'playing', mode: 'practice', pauseOrigin: 'game' });
    expect(startMatch(next, 'run').mode).toBe('run');
  });

  it('escape while playing pauses', () => {
    expect(escapeAction({ ...base, screen: 'playing' })).toBe('pause');
  });

  it('escape in a game pause resumes the match', () => {
    expect(escapeAction({ ...base, screen: 'pause', pauseOrigin: 'game' })).toBe('resume');
  });

  it('escape in settings opened from the menu returns to the menu, never to a phantom match', () => {
    expect(escapeAction({ ...base, screen: 'pause', pauseOrigin: 'menu' })).toBe('menu');
  });

  it('escape on a sub-screen goes back one level', () => {
    for (const screen of ['sectors', 'leaderboard', 'about', 'calibrate'] as const) {
      expect(escapeAction({ ...base, screen })).toBe('menu');
    }
    expect(escapeAction({ ...base, screen: 'briefing' })).toBe('sectors');
  });

  it('escape on other screens does nothing', () => {
    expect(escapeAction({ ...base, screen: 'result' })).toBe('none');
    expect(escapeAction({ ...base, screen: 'menu' })).toBe('none');
  });

  it('pointer lock loss pauses only on desktop while playing', () => {
    const playing: ScreenState = { ...base, screen: 'playing' };
    expect(pointerLockLostAction(playing, false)).toBe('pause');
    expect(pointerLockLostAction(playing, true)).toBe('none');
    expect(pointerLockLostAction(base, false)).toBe('none');
  });

  it('pointer lock error never pauses; it asks the player to click again', () => {
    expect(pointerLockErrorAction({ ...base, screen: 'playing' })).toBe('hint');
    expect(pointerLockErrorAction(base)).toBe('none');
  });

  it('pause subtitle follows the mode', () => {
    expect(pauseSubtitle('practice')).toContain('práctica');
    expect(pauseSubtitle('run')).toContain('Sector 01');
  });
});
