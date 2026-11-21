import { describe, expect, it } from 'vitest';
import { KeyboardState, shouldPreventDefault } from '../../src/input/keyboard';

describe('KeyboardState', () => {
  it('tracks a key that first arrives as an auto-repeat (held across pause/blur)', () => {
    const kb = new KeyboardState();
    kb.keyDown('KeyW', true);
    expect(kb.has('KeyW')).toBe(true);
  });

  it('does not re-arm edge actions on auto-repeat', () => {
    const kb = new KeyboardState();
    kb.keyDown('Space', false);
    expect(kb.consumeJump()).toBe(true);
    kb.keyDown('Space', true);
    expect(kb.consumeJump()).toBe(false);
  });

  it('arms reload and weapon switch on first press', () => {
    const kb = new KeyboardState();
    kb.keyDown('KeyR', false);
    kb.keyDown('Digit2', false);
    expect(kb.consumeReload()).toBe(true);
    expect(kb.consumeSwitch()).toBe(2);
    expect(kb.consumeSwitch()).toBe(0);
  });

  it('ignores keys pressed outside a match so a menu Space/Enter cannot arm the first tick', () => {
    const kb = new KeyboardState();
    kb.keyDown('Space', false, false);
    kb.keyDown('KeyR', false, false);
    kb.keyDown('KeyW', false, false);
    expect(kb.has('KeyW')).toBe(false);
    expect(kb.consumeJump()).toBe(false);
    expect(kb.consumeReload()).toBe(false);
  });

  it('clear releases every key', () => {
    const kb = new KeyboardState();
    kb.keyDown('KeyA', false);
    kb.clear();
    expect(kb.has('KeyA')).toBe(false);
  });

  it('keyUp releases a key', () => {
    const kb = new KeyboardState();
    kb.keyDown('KeyD', false);
    kb.keyUp('KeyD');
    expect(kb.has('KeyD')).toBe(false);
  });
});

describe('shouldPreventDefault', () => {
  it('blocks scroll keys only while playing', () => {
    expect(shouldPreventDefault('Space', { playing: true, formTarget: false })).toBe(true);
    expect(shouldPreventDefault('ArrowLeft', { playing: true, formTarget: false })).toBe(true);
    expect(shouldPreventDefault('Space', { playing: false, formTarget: false })).toBe(false);
    expect(shouldPreventDefault('ArrowRight', { playing: false, formTarget: false })).toBe(false);
  });

  it('never blocks keys on focused form controls', () => {
    expect(shouldPreventDefault('ArrowLeft', { playing: true, formTarget: true })).toBe(false);
  });

  it('ignores unrelated keys', () => {
    expect(shouldPreventDefault('KeyW', { playing: true, formTarget: false })).toBe(false);
  });
});
