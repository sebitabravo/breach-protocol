import { describe, expect, it } from 'vitest';
import { Snapshot, type WorldEvent } from '../../src/wasm/bridge';
import { EVENT_BASE, EVENT_STRIDE, H, MAX_EVENTS, SNAPSHOT_LEN } from '../../src/wasm/protocol';

function snapshotWith(seqs: number[]): Snapshot {
  const memory = new ArrayBuffer(SNAPSHOT_LEN * 4);
  const view = new Float32Array(memory);
  seqs.forEach((seq, i) => {
    const base = EVENT_BASE + (i % MAX_EVENTS) * EVENT_STRIDE;
    view[base] = 1;
    view[base + 5] = seq;
  });
  view[H.eventsHead] = seqs.length % MAX_EVENTS;
  view[H.eventsCount] = Math.min(seqs.length, MAX_EVENTS);
  return new Snapshot(memory, 0, SNAPSHOT_LEN);
}

describe('Snapshot.readEvents', () => {
  it('returns only events newer than lastSeq, in order', () => {
    const snap = snapshotWith([1, 2, 3]);
    const out: WorldEvent[] = [];
    expect(snap.readEvents(1, out)).toBe(2);
    expect(out.map((e) => e.seq)).toEqual([2, 3]);
    expect(snap.lostEvents).toBe(0);
  });

  it('counts events overwritten in the ring before they were read', () => {
    const seqs = Array.from({ length: MAX_EVENTS + 10 }, (_, i) => i + 1);
    const memory = new ArrayBuffer(SNAPSHOT_LEN * 4);
    const view = new Float32Array(memory);
    seqs.forEach((seq) => {
      const base = EVENT_BASE + ((seq - 1) % MAX_EVENTS) * EVENT_STRIDE;
      view[base] = 1;
      view[base + 5] = seq;
    });
    view[H.eventsHead] = seqs.length % MAX_EVENTS;
    view[H.eventsCount] = MAX_EVENTS;
    const snap = new Snapshot(memory, 0, SNAPSHOT_LEN);
    const out: WorldEvent[] = [];
    snap.readEvents(0, out);
    expect(snap.lostEvents).toBe(10);
  });
});
