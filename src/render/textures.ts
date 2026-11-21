/**
 * Texturas procedurales del arena (CanvasTexture), sin imágenes en el bundle.
 *
 * Los generadores reciben una fábrica de canvas inyectable: en el navegador es
 * `document.createElement('canvas')`; en vitest (entorno node) se pasa un stub
 * que registra las llamadas de dibujo. Así la lógica de pintura se prueba sin DOM.
 */
import * as THREE from 'three';
import { mulberry32 } from './random';

/** Subconjunto de CanvasRenderingContext2D que usan los generadores. */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'fillText'
  | 'createRadialGradient'
>;

export interface CanvasSurface {
  width: number;
  height: number;
  getContext(kind: '2d'): Canvas2D | null;
}

export type SurfaceFactory<T extends CanvasSurface> = (width: number, height: number) => T | null;

/** Fábrica de producción: un canvas del DOM del tamaño pedido. */
export const domCanvas: SurfaceFactory<HTMLCanvasElement> = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/** Panel grid + grime (speckles y rayaduras sembradas) en un tile periódico. */
export function paintPanelTile<T extends CanvasSurface>(factory: SurfaceFactory<T>, size = 256): T | null {
  const surface = factory(size, size);
  const ctx = surface?.getContext('2d');
  if (!surface || !ctx) return null;
  // base at 0.83 sRGB: lines (≈ 1.0) end up ≈ +20% over the floor pixel
  ctx.fillStyle = '#d4d4d4'; // albedo = material.color × map
  ctx.fillRect(0, 0, size, size);
  // one subtly brighter sub-panel per 2×2 panel group
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(0, 0, size / 2, size / 2);
  paintGrime(ctx, size);
  // 1 px bright panel lines on a 2×2 panel grid (128 px panels)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0.5, 0);
  ctx.lineTo(0.5, size);
  ctx.moveTo(size / 2 + 0.5, 0);
  ctx.lineTo(size / 2 + 0.5, size);
  ctx.moveTo(0, 0.5);
  ctx.lineTo(size, 0.5);
  ctx.moveTo(0, size / 2 + 0.5);
  ctx.lineTo(size, size / 2 + 0.5);
  ctx.stroke();
  return surface;
}

/** Speckles oscuros/claros y rayaduras finas con PRNG sembrado (estable entre sesiones). */
function paintGrime(ctx: Canvas2D, size: number): void {
  const rng = mulberry32(0x9a1f3);
  for (let i = 0; i < 90; i += 1) {
    const dark = rng() < 0.7;
    ctx.fillStyle = dark ? `rgba(40,48,56,${(0.05 + rng() * 0.12).toFixed(3)})` : `rgba(255,255,255,${(0.04 + rng() * 0.06).toFixed(3)})`;
    ctx.fillRect(Math.floor(rng() * size), Math.floor(rng() * size), 1 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 2));
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 18 + rng() * 26, y + 4 + rng() * 10);
  }
  ctx.stroke();
}

/** Halo radial blanco con alfa decreciente: textura de charcos de luz en el piso. */
export function paintRadialGlow<T extends CanvasSurface>(factory: SurfaceFactory<T>, size = 256): T | null {
  const surface = factory(size, size);
  const ctx = surface?.getContext('2d');
  if (!surface || !ctx) return null;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return surface;
}

/**
 * Atlas 1024×512 de decals: la mitad superior es la etiqueta de sector
 * (estarcido) y la inferior, franjas de peligro. Un solo material para ambas
 * cosas en vez de una textura por decal.
 */
export function paintDecalAtlas<T extends CanvasSurface>(factory: SurfaceFactory<T>, label: string): T | null {
  const surface = factory(1024, 512);
  const ctx = surface?.getContext('2d');
  if (!surface || !ctx) return null;
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.font = 'bold 170px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 512, 128);
  paintHazard(ctx, 0, 256, 1024, 256);
  if (label === 'SECTOR 01') {
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.font = 'bold 45px monospace';
    ctx.fillText('07 // PRESSURE LOCK', 512, 24);
  }
  // The node test factory only implements the shared drawing subset.
  const erase = (ctx as Partial<CanvasRenderingContext2D>).clearRect?.bind(ctx);
  if (erase) {
    const rng = mulberry32(0x5ca1e);
    for (let i = 0; i < 1900; i += 1) {
      erase(rng() * 1024, 45 + rng() * 170, 0.7 + rng() * 7, 0.7 + rng() * 3);
    }
    for (const x of [79, 281, 480, 680, 889]) {
      erase(x, 64, 7, 48);
      erase(x + 4, 147, 7, 45);
    }
  }
  return surface;
}

/** Franjas de 45° ámbar y negro: marcado de peligro en el piso. */
function paintHazard(ctx: Canvas2D, x0: number, y0: number, w: number, h: number): void {
  const band = 64;
  const slant = h;
  ctx.fillStyle = 'rgba(12,10,6,0.9)';
  ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = 'rgba(255,177,59,0.95)';
  for (let x = x0 - slant; x < x0 + w; x += band * 2) {
    ctx.beginPath();
    ctx.moveTo(x, y0 + h);
    ctx.lineTo(x + band, y0 + h);
    ctx.lineTo(x + band + slant, y0);
    ctx.lineTo(x + slant, y0);
    ctx.closePath();
    ctx.fill();
  }
}

/** Convierte un canvas del DOM en una textura de three (solo el borde del módulo lo usa). */
export function toCanvasTexture(canvas: HTMLCanvasElement, opts: { wrap: boolean }): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (opts.wrap) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
