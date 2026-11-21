import { describe, expect, it } from 'vitest';
import { INITIAL_FLOW, pauseSubtitle, routesToCalibration, transition, type FlowState } from '../../src/core/screens';

function at(screen: FlowState['screen'], extra: Partial<FlowState> = {}): FlowState {
  return { ...INITIAL_FLOW, screen, ...extra };
}

describe('boot routing', () => {
  it('sends a first visit to calibration and a returning player to the menu', () => {
    expect(transition(INITIAL_FLOW, { type: 'boot-complete', tutorialSeen: false }).screen).toBe('calibrate');
    expect(transition(INITIAL_FLOW, { type: 'boot-complete', tutorialSeen: true }).screen).toBe('menu');
  });

  it('only an explicit Jugar from a first-time visitor enters through calibration', () => {
    expect(routesToCalibration(false, 'play', true)).toBe(true);
    expect(routesToCalibration(true, 'play', true)).toBe(false);
    expect(routesToCalibration(false, 'overflow', true)).toBe(false);
  });

  it('an idle preload with no intent never swaps the landing menu for calibration', () => {
    expect(routesToCalibration(false, undefined, false)).toBe(false);
  });

  it('falls back to the error screen when boot fails, and only from boot', () => {
    expect(transition(INITIAL_FLOW, { type: 'boot-failed' }).screen).toBe('fallback');
    expect(transition(at('menu'), { type: 'boot-failed' }).screen).toBe('menu');
  });
});

describe('mission flow', () => {
  it('goes menu -> sectors -> briefing -> playing with the chosen sector', () => {
    let state = at('menu');
    state = transition(state, { type: 'open', screen: 'sectors' });
    expect(state.screen).toBe('sectors');
    state = transition(state, { type: 'brief', mapId: 1 });
    expect(state).toMatchObject({ screen: 'briefing', mapId: 1 });
    state = transition(state, { type: 'start', mode: 'run', mapId: 1 });
    expect(state).toMatchObject({ screen: 'playing', mode: 'run', mapId: 1, pauseOrigin: 'game' });
  });

  it('cannot brief a sector from anywhere but the sector list', () => {
    expect(transition(at('menu'), { type: 'brief', mapId: 2 }).screen).toBe('menu');
  });

  it('finishes into results and restarts the same mode from there', () => {
    const playing = at('playing', { mode: 'run', mapId: 2 });
    const result = transition(playing, { type: 'finish' });
    expect(result.screen).toBe('result');
    expect(transition(result, { type: 'start', mode: 'run', mapId: 2 })).toMatchObject({
      screen: 'playing',
      mapId: 2,
    });
  });
});

describe('pause flow', () => {
  it('pauses only while playing and resumes a game pause', () => {
    const paused = transition(at('playing'), { type: 'pause', origin: 'game' });
    expect(paused).toMatchObject({ screen: 'pause', pauseOrigin: 'game' });
    expect(transition(paused, { type: 'resume' }).screen).toBe('playing');
  });

  it('ignores pause requests outside a match', () => {
    expect(transition(at('menu'), { type: 'pause', origin: 'game' }).screen).toBe('menu');
  });

  it('opens settings from the menu as a menu-origin pause that resume cannot enter', () => {
    const settings = transition(at('menu'), { type: 'settings' });
    expect(settings).toMatchObject({ screen: 'pause', pauseOrigin: 'menu' });
    expect(transition(settings, { type: 'resume' })).toBe(settings);
  });

  it('leaves a pause for the menu', () => {
    expect(transition(at('pause'), { type: 'open', screen: 'menu' }).screen).toBe('menu');
  });

  it('does not open a page from the middle of a match', () => {
    expect(transition(at('playing'), { type: 'open', screen: 'leaderboard' }).screen).toBe('playing');
  });
});

describe('page navigation', () => {
  it('opens leaderboard, about and calibration from the menu and back', () => {
    for (const screen of ['leaderboard', 'about', 'calibrate'] as const) {
      expect(transition(at('menu'), { type: 'open', screen }).screen).toBe(screen);
    }
    expect(transition(at('leaderboard'), { type: 'open', screen: 'menu' }).screen).toBe('menu');
  });
});

describe('start rules', () => {
  it('starts overflow and daily runs straight from the menu', () => {
    expect(transition(at('menu'), { type: 'start', mode: 'overflow', mapId: 0 }).mode).toBe('overflow');
    expect(transition(at('menu'), { type: 'start', mode: 'daily', mapId: 0 }).mode).toBe('daily');
  });

  it('never starts during boot, on the error screen or on top of a live match', () => {
    expect(transition(at('boot'), { type: 'start', mode: 'run', mapId: 0 }).screen).toBe('boot');
    expect(transition(at('fallback'), { type: 'start', mode: 'run', mapId: 0 }).screen).toBe('fallback');
    const playing = at('playing', { mapId: 1 });
    expect(transition(playing, { type: 'start', mode: 'practice', mapId: 0 })).toBe(playing);
  });
});

describe('pauseSubtitle', () => {
  it('names the sector of a mission', () => {
    expect(pauseSubtitle('run', 2)).toContain('Sector 03');
    expect(pauseSubtitle('run')).toContain('Sector 01');
  });

  it('describes the non-mission modes in plain Spanish', () => {
    expect(pauseSubtitle('overflow')).toContain('ARGOS inunda');
    expect(pauseSubtitle('daily')).toContain('incidente del día');
    expect(pauseSubtitle('practice')).toContain('práctica');
  });
});
