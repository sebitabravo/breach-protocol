/**
 * Geometría procedural compartida: cajas alineadas a los ejes y quads sueltos,
 * fundidos en una sola BufferGeometry con normales, color por vértice, UV en
 * metros (para texturas repetidas) y un atributo `aBlink` opcional para LEDs.
 * Sin assets externos (S14): robots, viewmodels y arena salen de esta primitiva.
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

/** Índice de cara = bit en la máscara de `BoxOptions.faces`. */
export const FACE = { posX: 1, negX: 2, posY: 4, negY: 8, posZ: 16, negZ: 32 } as const;
export const FACE_ALL = 63;

const FACES: readonly FaceDef[] = [
  { nx: 1, ny: 0, nz: 0, corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
  { nx: -1, ny: 0, nz: 0, corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  { nx: 0, ny: 1, nz: 0, corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { nx: 0, ny: -1, nz: 0, corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { nx: 0, ny: 0, nz: 1, corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { nx: 0, ny: 0, nz: -1, corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
const FACE_BITS = [FACE.posX, FACE.negX, FACE.posY, FACE.negY, FACE.posZ, FACE.negZ] as const;

export interface BoxOptions {
  /** Color lineal RGB por vértice. */
  rgb?: readonly [number, number, number];
  /** Máscara de caras a emitir (FACE_ALL por defecto). */
  faces?: number;
  /** Tamaño de tile en metros para las UV; 0 deja las UV en cero. */
  uvTile?: number;
  /** Fase de parpadeo (0 = sin parpadeo); lo consume el material unlit. */
  blink?: number;
  /** Arena surface tile; +3 marks enclosure faces that do not cast shadows. */
  surface?: number;
}

/** Acumulador de geometría: cajas y quads a una sola BufferGeometry. */
export class MeshBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];
  private readonly blinks: number[] = [];
  private readonly surfaces: number[] = [];
  private readonly indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  addBox(x: number, y: number, z: number, sx: number, sy: number, sz: number, opts: BoxOptions = {}): void {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const rgb = opts.rgb ?? [1, 1, 1];
    const mask = opts.faces ?? FACE_ALL;
    const tile = opts.uvTile ?? 0;
    const blink = opts.blink ?? 0;
    for (let f = 0; f < FACES.length; f += 1) {
      if ((mask & FACE_BITS[f]) === 0) continue;
      const face = FACES[f];
      const base = this.vertexCount;
      for (const corner of face.corners) {
        const px = x + corner[0] * hx;
        const py = y + corner[1] * hy;
        const pz = z + corner[2] * hz;
        this.positions.push(px, py, pz);
        this.normals.push(face.nx, face.ny, face.nz);
        this.colors.push(rgb[0], rgb[1], rgb[2]);
        // UV proyectadas al plano de la cara, en metros, escaladas al tile
        const [u, v] = face.ny !== 0 ? [px, pz] : face.nx !== 0 ? [pz, py] : [px, py];
        this.uvs.push(tile > 0 ? u / tile : 0, tile > 0 ? v / tile : 0);
        this.blinks.push(blink);
        this.surfaces.push(opts.surface ?? 0);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Quad de cuatro esquinas (CCW vista desde el frente) con UV explícitas. */
  addQuad(corners: readonly number[], normal: readonly [number, number, number], uv: readonly number[], rgb: readonly [number, number, number], blink = 0, surface = 0): void {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i += 1) {
      this.positions.push(corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]);
      this.normals.push(normal[0], normal[1], normal[2]);
      this.colors.push(rgb[0], rgb[1], rgb[2]);
      this.uvs.push(uv[i * 2], uv[i * 2 + 1]);
      this.blinks.push(blink);
      this.surfaces.push(surface);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Copy a geometry into this static batch. Caller owns the source. */
  addGeometry(geometry: THREE.BufferGeometry, rgb: readonly [number, number, number], surface: number, tile?: number, preserveColors = false, preserveSurfaces = false): void {
    const base = this.vertexCount;
    const pos = geometry.getAttribute('position');
    const norm = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const color = preserveColors ? geometry.getAttribute('color') : undefined;
    const surfaces = preserveSurfaces ? geometry.getAttribute('aSurface') : undefined;
    for (let i = 0; i < pos.count; i += 1) {
      this.positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
      if (color) this.colors.push(color.getX(i), color.getY(i), color.getZ(i));
      else this.colors.push(rgb[0], rgb[1], rgb[2]);
      this.uvs.push(uv.getX(i) * (tile ?? 1), uv.getY(i) * (tile ?? 1));
      this.blinks.push(0);
      this.surfaces.push(surfaces?.getX(i) ?? surface);
    }
    const index = geometry.getIndex();
    for (let i = 0; i < (index?.count ?? pos.count); i += 1) this.indices.push(base + (index ? index.getX(i) : i));
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.setAttribute('aBlink', new THREE.Float32BufferAttribute(this.blinks, 1));
    geometry.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surfaces, 1));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

/** Merges axis-aligned boxes into one geometry with per-face normals and vertex colours. */
export function buildMergedGeometry(parts: BoxPart[]): THREE.BufferGeometry {
  const builder = new MeshBuilder();
  const color = new THREE.Color();
  for (const p of parts) {
    color.setHex(p.color);
    builder.addBox(p.x, p.y, p.z, p.sx, p.sy, p.sz, { rgb: [color.r, color.g, color.b] });
  }
  return builder.build();
}
