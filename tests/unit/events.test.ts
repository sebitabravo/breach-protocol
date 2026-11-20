import { describe, expect, it } from 'vitest';
import { effectsOf } from '../../src/core/events';
import type { WorldEvent } from '../../src/wasm/bridge';
import { ENEMY_KIND, EVT, WEAPON } from '../../src/wasm/protocol';

function event(type: number, values: Partial<Omit<WorldEvent, 'type'>> = {}): WorldEvent {
  return { type, a: 0, b: 0, c: 0, d: 0, seq: 1, ...values };
}

describe('effectsOf', () => {
  it('picks the shot sound from the weapon id', () => {
    expect(effectsOf(event(EVT.shot, { a: WEAPON.carbine })).sounds).toEqual(['shotCarbine']);
    expect(effectsOf(event(EVT.shot, { a: WEAPON.sidearm })).sounds).toEqual(['shotSidearm']);
  });

  it('names the dead enemy by its kind, including the interceptor', () => {
    const feed = (kind: number) => effectsOf(event(EVT.enemyDied, { d: kind })).feed[0];
    expect(feed(ENEMY_KIND.scout)).toEqual({ text: 'scout eliminado', kind: 'good' });
    expect(feed(ENEMY_KIND.sentinel)).toEqual({ text: 'centinela eliminado', kind: 'good' });
    expect(feed(ENEMY_KIND.interceptor)).toEqual({ text: 'interceptor eliminado', kind: 'good' });
  });

  it('plays the damage sound only for hits of at least one point', () => {
    expect(effectsOf(event(EVT.playerDamaged, { a: 0.4 })).sounds).toEqual([]);
    expect(effectsOf(event(EVT.playerDamaged, { a: 12 })).sounds).toEqual(['damage']);
  });

  it('rounds the wave number in the feed line', () => {
    expect(effectsOf(event(EVT.waveStart, { a: 2.6 })).feed[0].text).toBe('oleada 3');
  });

  it('marks win and lose with the matching feed tone', () => {
    expect(effectsOf(event(EVT.win)).feed[0].kind).toBe('good');
    expect(effectsOf(event(EVT.lose)).feed[0].kind).toBe('danger');
  });

  it('produces nothing for events the shell does not show', () => {
    expect(effectsOf(event(EVT.spawn))).toEqual({ sounds: [], feed: [] });
    expect(effectsOf(event(999))).toEqual({ sounds: [], feed: [] });
  });
});
