import { describe, expect, it } from 'vitest';
import {
  paintDecalAtlas,
  paintPanelTile,
  paintRadialGlow,
  type Canvas2D,
  type CanvasSurface,
} from '../../src/render/textures';

interface Call {
  op: string;
  args: unknown[];
}

/** Contexto 2D que solo registra llamadas: basta para verificar qué se pinta. */
function recordingContext(log: Call[]): Canvas2D {
  const rec =
    (op: string) =>
    (...args: unknown[]): void => {
      log.push({ op, args });
    };
  return {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    fillRect: rec('fillRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    closePath: rec('closePath'),
    stroke: rec('stroke'),
    fill: rec('fill'),
    fillText: rec('fillText'),
    createRadialGradient: (...args: unknown[]) => {
      log.push({ op: 'createRadialGradient', args });
      return { addColorStop: (...stop: unknown[]) => log.push({ op: 'addColorStop', args: stop }) } as unknown as CanvasGradient;
    },
  } as Canvas2D;
}

function stubFactory(log: Call[], sizes: [number, number][] = []) {
  return (width: number, height: number): CanvasSurface => {
    sizes.push([width, height]);
    const ctx = recordingContext(log);
    return { width, height, getContext: () => ctx };
  };
}

describe('paintPanelTile', () => {
  it('paints a square tile with panel lines and grime', () => {
    const log: Call[] = [];
    const sizes: [number, number][] = [];
    const tile = paintPanelTile(stubFactory(log, sizes), 256);
    expect(tile).not.toBeNull();
    expect(sizes).toEqual([[256, 256]]);
    expect(log.filter((c) => c.op === 'stroke')).toHaveLength(2);
    expect(log.filter((c) => c.op === 'fillRect').length).toBeGreaterThan(90);
  });

  it('is deterministic: the same seed paints the same calls every time', () => {
    const a: Call[] = [];
    const b: Call[] = [];
    paintPanelTile(stubFactory(a));
    paintPanelTile(stubFactory(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('returns null without a 2D context and never throws', () => {
    const noContext = (): CanvasSurface => ({ width: 1, height: 1, getContext: () => null });
    expect(paintPanelTile(noContext)).toBeNull();
    expect(paintPanelTile(() => null)).toBeNull();
  });
});

describe('paintRadialGlow', () => {
  it('fades from opaque centre to transparent edge', () => {
    const log: Call[] = [];
    paintRadialGlow(stubFactory(log), 256);
    const stops = log.filter((c) => c.op === 'addColorStop').map((c) => c.args[0]);
    expect(stops).toEqual([0, 0.45, 1]);
    const edge = log.find((c) => c.op === 'addColorStop' && c.args[0] === 1);
    expect(edge?.args[1]).toBe('rgba(255,255,255,0)');
  });
});

describe('paintDecalAtlas', () => {
  it('is 1024×512 and labels the sector in the top half', () => {
    const log: Call[] = [];
    const sizes: [number, number][] = [];
    paintDecalAtlas(stubFactory(log, sizes), 'SECTOR 02');
    expect(sizes).toEqual([[1024, 512]]);
    const label = log.find((c) => c.op === 'fillText');
    expect(label?.args).toEqual(['SECTOR 02', 512, 128]);
  });

  it('paints hazard stripes in the bottom half', () => {
    const log: Call[] = [];
    paintDecalAtlas(stubFactory(log), 'SECTOR 01');
    const hazardFills = log.filter((c) => c.op === 'fill');
    expect(hazardFills.length).toBeGreaterThan(4);
    const hazardBackdrop = log.find((c) => c.op === 'fillRect' && c.args[1] === 256);
    expect(hazardBackdrop?.args).toEqual([0, 256, 1024, 256]);
  });
});
