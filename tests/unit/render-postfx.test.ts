import { describe, expect, it } from 'vitest';
import { postPlan } from '../../src/render/postfx';

describe('postPlan', () => {
  it('renders low straight to the canvas: no composer, no bloom, no MSAA target', () => {
    expect(postPlan('low')).toEqual({ bloom: false, msaaSamples: 0 });
  });

  it('turns bloom on for medium and high, with 4× MSAA on the composer target', () => {
    expect(postPlan('medium')).toEqual({ bloom: true, msaaSamples: 4 });
    expect(postPlan('high')).toEqual({ bloom: true, msaaSamples: 4 });
  });
});
