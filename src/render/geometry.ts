/**
 * Geometría procedural compartida: cajas alineadas a los ejes fundidas en una
 * sola BufferGeometry, con normales por cara y color por vértice. Sin assets
 * externos (S14): robots, viewmodels y decoración salen de esta misma primitiva.
 */
import * as THREE from 'three';

export interface BoxPart {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  color: number;
}

interface FaceDef {
  nx: number;
  ny: number;
  nz: number;
  /** Corner multipliers of the half extents, CCW seen from outside. */
  corners: readonly (readonly [number, number, number])[];
}

const FACES: readonly FaceDef[] = [
  { nx: 1, ny: 0, nz: 0, corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { nx: -1, ny: 0, nz: 0, corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { nx: 0, ny: 1, nz: 0, corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { nx: 0, ny: -1, nz: 0, corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { nx: 0, ny: 0, nz: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { nx: 0, ny: 0, nz: -1, corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];

/** Merges axis-aligned boxes into one geometry with per-face normals and vertex colours. */
export function buildMergedGeometry(parts: BoxPart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();

  for (const p of parts) {
    color.setHex(p.color);
    const hx = p.sx / 2;
    const hy = p.sy / 2;
    const hz = p.sz / 2;
    for (const face of FACES) {
      const base = positions.length / 3;
      for (const corner of face.corners) {
        positions.push(p.x + corner[0] * hx, p.y + corner[1] * hy, p.z + corner[2] * hz);
        normals.push(face.nx, face.ny, face.nz);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}
