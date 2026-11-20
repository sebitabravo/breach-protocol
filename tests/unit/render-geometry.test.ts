import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildMergedGeometry, FACE, MeshBuilder } from '../../src/render/geometry';

describe('MeshBuilder', () => {
  it('emits 24 vertices and 36 indices for a full box', () => {
    const b = new MeshBuilder();
    b.addBox(0, 0, 0, 1, 1, 1);
    const geo = b.build();
    expect(geo.getAttribute('position').count).toBe(24);
    expect(geo.getIndex()?.count).toBe(36);
  });

  it('emits only the faces in the mask', () => {
    const b = new MeshBuilder();
    b.addBox(0, 0, 0, 1, 1, 1, { faces: FACE.negY });
    const geo = b.build();
    expect(geo.getAttribute('position').count).toBe(4);
    expect(geo.getIndex()?.count).toBe(6);
  });

  it('projects UVs onto the face plane in tiles of metres', () => {
    const b = new MeshBuilder();
    b.addBox(10, 0, 5, 2, 2, 2, { faces: FACE.posY, uvTile: 4 });
    const uv = b.build().getAttribute('uv');
    // primer vértice de la cara +Y: (x, z) = (9, 6) en metros, dividido por el tile de 4 m
    expect(uv.getX(0)).toBeCloseTo(9 / 4, 6);
    expect(uv.getY(0)).toBeCloseTo(6 / 4, 6);
  });

  it('writes the blink phase on every vertex of the box', () => {
    const b = new MeshBuilder();
    b.addBox(0, 0, 0, 1, 1, 1, { blink: 0.3 });
    const blink = b.build().getAttribute('aBlink');
    for (let i = 0; i < blink.count; i += 1) expect(blink.getX(i)).toBeCloseTo(0.3, 6);
  });

  it('adds quads with their own corners, normal and colour', () => {
    const b = new MeshBuilder();
    b.addQuad([0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0], [0, 1, 0], [0, 0, 0, 1, 1, 1, 1, 0], [0.5, 0.25, 0.125]);
    const geo = b.build();
    expect(geo.getAttribute('position').count).toBe(4);
    expect(geo.getAttribute('normal').getY(2)).toBe(1);
    expect(geo.getAttribute('color').getX(3)).toBeCloseTo(0.5, 6);
  });
});

describe('buildMergedGeometry', () => {
  it('merges parts into one geometry with vertex colours', () => {
    const color = new THREE.Color(0x5ce08b);
    const geo = buildMergedGeometry([
      { x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: 0x5ce08b },
      { x: 2, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: 0x101010 },
    ]);
    expect(geo.getAttribute('position').count).toBe(48);
    expect(geo.getAttribute('color').getX(0)).toBeCloseTo(color.r, 6);
  });
});
