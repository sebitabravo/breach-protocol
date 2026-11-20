/**
 * Texturas procedurales (CanvasTexture) del arena. Se generan al construir el
 * sector y se liberan con él; no hay imágenes en el bundle.
 */
import * as THREE from 'three';

/**
 * Procedural panel grid on a 256×256 canvas: pale panel base with 1 px bright
 * lines so the grid reads without exceeding the +20% luminance budget over the
 * floor albedo. One texture, RepeatWrapping, generated per sector.
 * Base sits at 0.83 sRGB so the white panel lines land ≈ +20% over the final
 * floor pixel (sRGB ratio (1/0.657)^(1/2.2) ≈ 1.21).
 */
export function makeGridTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // base at 0.83 sRGB: lines (≈ 1.0) end up ≈ +20% over the floor pixel
    ctx.fillStyle = '#d4d4d4'; // albedo = material.color × map
    ctx.fillRect(0, 0, size, size);
    // one subtly brighter sub-panel per 2×2 panel group
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, 0, size / 2, size / 2);
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
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(9, 9); // 36 m floor / 4 m texture tile (2×2 panels of 2 m)
  tex.anisotropy = 4;
  return tex;
}
