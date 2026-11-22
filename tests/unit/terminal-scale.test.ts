import { expect, it } from 'vitest';
import { CONSOLE_TOP, CONSOLE_TOP_LOCAL, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, SCREEN_BOUNDS_RADIUS,
  SCREEN_CENTRE_Y, SCREEN_HEIGHT, SCREEN_SPREAD, TERMINAL_SCALE, TERMINAL_TOP } from '../../src/render/terminal-model';

// T6b / S16 — the terminals must be sized from PLAYER scale, never from each other:
// a counter-height body a person could operate, the screen plane readable below the
// standing eye, and no dimension that reads as taller than the player. Every value
// asserted here is a named export derived from the player metrics, so a future edit
// cannot silently re-inflate the prop.
// Player metrics mirrored from the sim core (core/src/player.rs): HEIGHT 1.8 m,
// EYE_HEIGHT 1.62 m.

it('tops out below the player it is meant to be operated by', () => {
  console.log(`terminal top: ${CONSOLE_TOP.toFixed(3)} m vs player ${PLAYER_HEIGHT.toFixed(3)} m (eye ${PLAYER_EYE_HEIGHT.toFixed(3)} m); scale ${TERMINAL_SCALE.toFixed(4)}; screen ${SCREEN_CENTRE_Y.toFixed(3)} m ±${(SCREEN_HEIGHT / 2).toFixed(3)} m`);
  // Machine is upright furniture, not a knee-high box: it clears the standing eye but
  // never the player's crown.
  expect(CONSOLE_TOP).toBeLessThan(PLAYER_HEIGHT);
  expect(CONSOLE_TOP).toBeGreaterThan(PLAYER_EYE_HEIGHT);
  expect(TERMINAL_TOP).toBeLessThan(PLAYER_HEIGHT);
});

it('derives its scale from the player-height top plane, not magic ratios', () => {
  expect(TERMINAL_SCALE).toBeGreaterThan(0);
  expect(CONSOLE_TOP_LOCAL * TERMINAL_SCALE).toBeCloseTo(TERMINAL_TOP, 6);
  expect(CONSOLE_TOP).toBeCloseTo(TERMINAL_TOP, 6);
});

it('keeps the screen plane at a readable height under the eye', () => {
  // Screen top edge must stay on the machine and below the plane the operator sees;
  // the centre must sit below standing eye level (a glance down at the counter).
  expect(SCREEN_CENTRE_Y + SCREEN_HEIGHT / 2).toBeLessThanOrEqual(TERMINAL_TOP);
  expect(SCREEN_CENTRE_Y).toBeLessThan(PLAYER_EYE_HEIGHT);
  expect(SCREEN_CENTRE_Y).toBeGreaterThan(hasContactLowBound());
});

/** Lower readable bound: above a counter-height work surface (~52% of player height). */
function hasContactLowBound(): number {
  return PLAYER_HEIGHT * 0.52;
}

it('scales the occlusion sampling with the machine', () => {
  expect(SCREEN_SPREAD).toBeCloseTo(0.43 * TERMINAL_SCALE, 6);
  expect(SCREEN_BOUNDS_RADIUS).toBeCloseTo(0.64 * TERMINAL_SCALE, 6);
  expect(SCREEN_BOUNDS_RADIUS).toBeGreaterThan(SCREEN_SPREAD);
});
