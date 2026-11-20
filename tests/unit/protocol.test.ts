import { describe, expect, it } from 'vitest';
import {
  ENEMY_BASE,
  ENEMY_STRIDE,
  E,
  EV,
  EVENT_BASE,
  EVENT_STRIDE,
  HEADER_LEN,
  H,
  I,
  INPUT_LEN,
  MAX_ENEMIES,
  MAX_EVENTS,
  MAX_NODES,
  N,
  NODE_BASE,
  NODE_STRIDE,
  PROTOCOL_VERSION,
  SNAPSHOT_LEN,
  assertProtocol,
} from '../../src/wasm/protocol';

describe('wasm snapshot protocol', () => {
  it('pins the snapshot size mirrored from core/src/protocol.rs', () => {
    // Rust pins these exact values in snapshot_layout_is_stable; a mismatch is
    // a hard boot error, so both sides must agree bit for bit.
    expect(SNAPSHOT_LEN).toBe(620);
    expect(ENEMY_BASE).toBe(64);
    expect(NODE_BASE).toBe(320);
    expect(EVENT_BASE).toBe(332);
    expect(PROTOCOL_VERSION).toBe(1);
    expect(HEADER_LEN).toBe(64);
  });

  it('header offsets are unique and inside the header', () => {
    const offsets = Object.values(H);
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const offset of offsets) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(HEADER_LEN);
    }
  });

  it('the enemy, node and event blocks do not overlap', () => {
    const enemyBlock = ENEMY_STRIDE * MAX_ENEMIES;
    const nodeBlock = NODE_STRIDE * MAX_NODES;
    const eventBlock = EVENT_STRIDE * MAX_EVENTS;
    expect(ENEMY_BASE + enemyBlock).toBeLessThanOrEqual(NODE_BASE);
    expect(NODE_BASE + nodeBlock).toBeLessThanOrEqual(EVENT_BASE);
    expect(EVENT_BASE + eventBlock).toBeLessThanOrEqual(SNAPSHOT_LEN);
    expect(enemyBlock).toBe(256);
    expect(nodeBlock).toBe(12);
    expect(eventBlock).toBe(288);
  });

  it('block strides match the field counts', () => {
    expect(Object.keys(E)).toHaveLength(ENEMY_STRIDE);
    expect(Object.keys(N)).toHaveLength(NODE_STRIDE);
    expect(Object.keys(EV)).toHaveLength(EVENT_STRIDE);
    expect(Object.values(E).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('the input buffer fits its offsets', () => {
    const offsets = Object.values(I);
    expect(new Set(offsets).size).toBe(offsets.length);
    for (const offset of offsets) expect(offset).toBeLessThan(INPUT_LEN);
    expect(INPUT_LEN).toBe(16);
  });

  it('assertProtocol accepts the current version and throws on mismatch', () => {
    expect(() => assertProtocol(PROTOCOL_VERSION)).not.toThrow();
    expect(() => assertProtocol(2)).toThrow(/protocol mismatch/);
    expect(() => assertProtocol(0)).toThrow(/protocol mismatch/);
  });
});
