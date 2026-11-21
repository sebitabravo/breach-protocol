import * as THREE from 'three';
import { FACE, MeshBuilder } from './geometry';
import { SURFACE, TILE } from './surfaces';
import { tint, type Tint } from './architecture';
import { FINISH, FINISH_SURFACE } from './finishes';

const STEEL = tint(0xc4dce8, 1.7), EDGE = tint(0x90adbe, 1.22), NAVY = tint(FINISH.paint.color);
const INSET = tint(0x1b2731), RUBBER = tint(FINISH.rubber.color), WARM = tint(0xe7a757);
const CERAMIC = tint(0xcbc9b4);
const HEAD = new THREE.Vector3(0, 1.91, 0.20);
const DESK = new THREE.Vector3(0, 1.25, 0.40);
const BEACON = new THREE.Vector3(-0.53, 2.59, -0.07);
const FULL_UV = [0, 0, 1, 0, 1, 1, 0, 1];

export const CONSOLE_ROLE = { screen: 1, stencil: 2, bar: 3, rotor: 4 } as const;
export const CONSOLE_TOP = 2.70;
export const SCREEN_SAMPLE = new THREE.Vector3(0, HEAD.y + 0.02, HEAD.z + 0.16);
export const CONSOLE_COLLAR = { width: 1.28, depth: 1.20, z: -0.035 } as const;

export function consoleYaw(x: number, z: number): number {
  // Face the approach lane, not the perimeter. Side nodes angle towards spawn.
  return Math.abs(x) > Math.abs(z) ? -Math.sign(x) * 0.64 : (z > 0 ? Math.PI - 0.28 : 0.28);
}

// A one-segment bevel gives the shoulders real edge normals without rounding
// off the industrial silhouette. Rings of clipped corners also shape the apron.
function bevel(sx: number, sy: number, sz: number, b: number): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const ring = (x: number, y: number, z: number, c: number) => [
    [-x + c, y, z], [x - c, y, z], [x, y, z - c], [x, y, -z + c],
    [x - c, y, -z], [-x + c, y, -z], [-x, y, -z + c], [-x, y, z - c],
  ];
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const rings = [ring(x - b, -y, z - b, b / 3), ring(x, -y + b, z, b),
    ring(x, y - b, z, b), ring(x - b, y, z - b, b / 3)];
  const quad = (...points: number[][]) => {
    const [a, p, q] = points.map((v) => new THREE.Vector3(...v));
    const n = p.sub(a).cross(q.sub(a)).normalize();
    const uv = points.flatMap(([px, py, pz]) => (Math.abs(n.y) > 0.7 ? [px, pz] : Math.abs(n.x) > 0.7 ? [-pz, py] : [px, py]).map((v) => v / TILE.metal));
    mesh.addQuad(points.flat(), [n.x, n.y, n.z], uv, [1, 1, 1]);
  };
  for (let j = 0; j < rings.length - 1; j += 1) {
    const lo = rings[j], hi = rings[j + 1];
    for (let i = 0; i < 8; i += 1) {
      const k = (i + 1) % 8;
      quad(lo[i], lo[k], hi[k], hi[i]);
    }
  }
  const top = rings[3];
  for (let i = 1; i < 7; i += 1) quad(top[0], top[i], top[i + 1], top[i + 1]);
  return mesh.build();
}

export function buildConsoleHousing(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const metal = new MeshBuilder(), concrete = new MeshBuilder();
  const finish = (rgb: Tint): number => rgb === NAVY || rgb === WARM ? FINISH_SURFACE.paint
    : rgb === RUBBER ? FINISH_SURFACE.rubber : rgb === INSET || rgb === CERAMIC ? FINISH_SURFACE.polymer : FINISH_SURFACE.steel;
  const add = (g: THREE.BufferGeometry, rgb: Tint, surface: number = finish(rgb)) => {
    (surface === SURFACE.concrete ? concrete : metal).addGeometry(g, rgb, surface);
    g.dispose();
  };
  const block = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rgb: Tint, faces?: number) =>
    metal.addBox(x, y, z, sx, sy, sz, { rgb, uvTile: TILE.metal, surface: finish(rgb), faces });
  const shaped = (x: number, y: number, z: number, sx: number, sy: number, sz: number, b: number, rgb: Tint,
    pitch = 0, origin?: THREE.Vector3, surface?: number) => {
    const geo = (b < 0.012 ? new THREE.BoxGeometry(sx, sy, sz) : bevel(sx, sy, sz, b)).translate(x, y, z).rotateX(pitch);
    if (origin) geo.translate(origin.x, origin.y, origin.z);
    add(geo, rgb, surface);
  };
  const pin = (x: number, y: number, z: number, r: number, depth: number, rgb: Tint, pitch = 0) =>
    add(new THREE.CylinderGeometry(r, r, depth, 6, 1).rotateX(pitch).translate(x, y, z), rgb);

  // Ballast shoe, sheet-steel pedestal and inset field-service door.
  shaped(0, 0.092, 0, 1.36, 0.184, 1.31, 0.045, EDGE, 0, undefined, SURFACE.concrete);
  shaped(0, 0.59, -0.055, 1.17, 1.07, 1.13, 0.085, NAVY);
  block(0, 0.59, 0.521, 0.87, 0.81, 0.028, INSET);
  block(0, 0.59, 0.543, 0.79, 0.73, 0.025, EDGE);
  for (const x of [-0.49, 0.49]) {
    shaped(x, 0.60, 0.53, 0.168, 0.80, 0.16, 0.036, STEEL);
    pin(x, 0.19, 0.587, 0.048, 0.055, STEEL);
    pin(x * 1.19, 0.122, -0.53, 0.042, 0.052, EDGE);
  }
  for (const x of [-0.32, 0.32]) for (const y of [0.28, 0.90]) pin(x, y, 0.57, 0.023, 0.022, STEEL, Math.PI / 2);
  for (let i = 0; i < 5; i += 1) {
    block(-0.085, 0.39 + i * 0.058, 0.561, 0.43, 0.027, 0.021, INSET, FACE.posZ);
    block(-0.085, 0.40 + i * 0.058, 0.571, 0.43, 0.008, 0.013, STEEL, FACE.posZ);
  }
  block(0.27, 0.61, 0.58, 0.056, 0.17, 0.058, INSET);
  block(0.27, 0.61, 0.619, 0.044, 0.09, 0.027, WARM);
  shaped(0, 1.09, CONSOLE_COLLAR.z, CONSOLE_COLLAR.width, 0.22, CONSOLE_COLLAR.depth, 0.045, EDGE);
  shaped(0, 1.52, -0.24, 1.18, 0.93, 0.65, 0.096, NAVY, -0.11);

  // Separate desk and monitor planes: low keyboard apron, deep CRT-like cowling.
  const desk = (x: number, y: number, z: number, sx: number, sy: number, sz: number, b: number, rgb: Tint) =>
    shaped(x, y, z, sx, sy, sz, b, rgb, 0.27, DESK);
  desk(0, -0.008, 0.03, 1.62, 0.24, 0.83, 0.063, STEEL);
  desk(0, 0.115, 0.07, 1.38, 0.046, 0.63, 0.017, INSET);
  desk(-0.19, 0.141, 0.079, 0.87, 0.042, 0.53, 0.012, EDGE);
  for (let row = 0; row < 3; row += 1) for (let col = 0; col < 6; col += 1) {
    desk(-0.535 + col * 0.137, 0.176, -0.073 + row * 0.145, 0.103, 0.053, 0.094, 0.01,
      col === 5 && row === 2 ? WARM : (row === 0 ? NAVY : CERAMIC));
  }
  desk(0.48, 0.145, 0.092, 0.31, 0.053, 0.44, 0.019, NAVY);
  desk(0.48, 0.174, 0.082, 0.102, 0.032, 0.26, 0.010, INSET);
  desk(0.48, 0.227, 0.114, 0.081, 0.145, 0.088, 0.016, EDGE);
  desk(0.48, 0.309, 0.125, 0.222, 0.105, 0.121, 0.021, WARM);
  for (const x of [0.43, 0.48, 0.53]) desk(x, 0.369, 0.125, 0.014, 0.017, 0.069, 0.004, INSET);

  const head = (x: number, y: number, z: number, sx: number, sy: number, sz: number, b: number, rgb: Tint) =>
    shaped(x, y, z, sx, sy, sz, b, rgb, -0.19, HEAD);
  head(0, 0, -0.159, 1.58, 0.99, 0.45, 0.09, STEEL);
  shaped(0, 0, 0.060, 1.34, 0.81, 0.035, 0.011, tint(FINISH.glass.color, 0.23), -0.19, HEAD, FINISH_SURFACE.glass); // back of glass recess
  head(-0.682, 0, 0.139, 0.171, 0.807, 0.22, 0.052, STEEL);
  head(0.626, 0, 0.139, 0.267, 0.807, 0.22, 0.052, STEEL);
  head(-0.034, 0.402, 0.132, 1.47, 0.171, 0.255, 0.043, STEEL);
  head(-0.037, -0.397, 0.136, 1.46, 0.152, 0.219, 0.039, EDGE);
  head(0.602, -0.008, 0.246, 0.133, 0.630, 0.029, 0.013, INSET);
  head(0.105, 0.411, 0.259, 0.83, 0.109, 0.027, 0.009, NAVY);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i += 1) head(side * 0.797, 0.092 + i * 0.059, -0.119, 0.036, 0.024, 0.28, 0.007, INSET);
    // Localized raw-metal scuffs, not a full-length luminous outline.
    for (let i = 0; i < 5; i += 1) {
      head(side * (0.54 + 0.034 * i), 0.369 - 0.009 * (i % 3), 0.261, 0.038 - 0.004 * i, 0.009, 0.005, 0.001, CERAMIC);
      desk(side * (0.62 + 0.026 * i), 0.096 - 0.013 * (i % 3), 0.441, 0.024, 0.008, 0.011, 0.002, EDGE);
    }
  }
  pin(BEACON.x, 2.407, BEACON.z, 0.143, 0.09, INSET);
  pin(BEACON.x, 2.467, BEACON.z, 0.119, 0.07, STEEL);
  pin(BEACON.x, CONSOLE_TOP - 0.022, BEACON.z, 0.123, 0.044, INSET);
  for (const x of [-0.094, 0.094]) block(BEACON.x + x, 2.585, BEACON.z - 0.064, 0.024, 0.19, 0.022, EDGE);

  shaped(0.772, 0.04, -0.30, 0.46, 0.08, 0.53, 0.024, EDGE);
  for (const z of [-0.48, -0.14]) pin(0.93, 0.084, z, 0.032, 0.026, STEEL);
  for (let i = 0; i < 3; i += 1) {
    const z = -0.16 - i * 0.105;
    pin(0.73 + i * 0.029, 0.10, z, 0.055, 0.072, INSET);
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.59, 1.53 - i * 0.08, z - 0.17), new THREE.Vector3(0.76 + i * 0.055, 1.34, z - 0.07),
      new THREE.Vector3(0.79 + i * 0.053, 0.78, z), new THREE.Vector3(0.76 + i * 0.040, 0.35, z),
      new THREE.Vector3(0.73 + i * 0.029, 0.13, z),
    ]);
    add(new THREE.TubeGeometry(path, 10, 0.037, 6, false), i === 1 ? WARM : RUBBER);
  }
  shaped(0.76, 0.77, -0.283, 0.30, 0.06, 0.41, 0.021, EDGE);
  const housing = metal.build();
  const uv = housing.getAttribute('uv');
  // The arena metal is tread plate. Sample between raised treads for the
  // cast/extruded console finish while retaining the shared diffuse/normal/ARM.
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, 0.060 + uv.getX(i) * 0.012, 0.902 + uv.getY(i) * 0.012);
  return [housing, concrete.build()];
}

export function buildConsoleInstruments(): THREE.BufferGeometry {
  const mesh = new MeshBuilder();
  const headFace = (x: number, y: number, z: number, sx: number, sy: number, role: number, color: Tint = [1, 1, 1], uv = FULL_UV) => {
    const p = new THREE.Vector3();
    const cos = Math.cos(-0.19), sin = Math.sin(-0.19);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([u, v]) => {
      const height = y + v * sy / 2;
      return p.set(x + u * sx / 2, height * cos - z * sin, height * sin + z * cos).add(HEAD).toArray();
    });
    mesh.addQuad(corners, [0, -sin, cos], uv, color, role);
  };
  headFace(-0.056, 0.009, 0.086, 1.055, 0.620, CONSOLE_ROLE.screen);
  headFace(0.105, 0.410, 0.274, 0.76, 0.091, CONSOLE_ROLE.stencil);
  for (let i = 0; i < 9; i += 1) {
    const low = (i + 0.08) / 9, high = (i + 0.92) / 9;
    headFace(0.602, (i - 4) * 0.061 - 0.007, 0.264, 0.078, 0.049, CONSOLE_ROLE.bar, [1, 1, 1], [0, low, 1, low, 1, high, 0, high]);
  }
  mesh.addBox(BEACON.x, BEACON.y, BEACON.z, 0.186, 0.163, 0.112, { rgb: tint(0x9b8b74), blink: CONSOLE_ROLE.rotor });
  for (const sign of [-1, 1]) {
    mesh.addBox(BEACON.x, BEACON.y, BEACON.z + 0.057 * sign, 0.146, 0.116, 0.004,
      { rgb: [1, 1, 1], blink: CONSOLE_ROLE.rotor, faces: sign > 0 ? FACE.posZ : FACE.negZ });
  }
  return mesh.build();
}

export const ROTOR_PIVOT = BEACON;
