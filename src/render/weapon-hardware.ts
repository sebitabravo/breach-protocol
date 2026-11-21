import * as THREE from 'three';
import { MeshBuilder } from './geometry';

const INK = 0x485560;
const STEEL = 0x75828b;
const MINT = 0x5ce08b;
const AMBER = 0xf3a660;
export const COLLAR_FRONT = 0.104; // Asset-local offset beyond the marked bore.

/** Runtime-only silhouette pass. Pin the receiver seam and bore while narrowing
 * the rear housing and bedding the original molded sights into the new rail. */
export function profileWeapon(model: THREE.Object3D): void {
  const offset = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return;
    const geometry = part.geometry as THREE.BufferGeometry;
    offset.setFromMatrixPosition(part.matrixWorld);
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    for (let i = 0; i < positions.count; ++i) {
      const y = positions.getY(i) + offset.y;
      const z = positions.getZ(i) + offset.z;
      if (z < -0.2 && y < 0.60) {
        const t = THREE.MathUtils.clamp((-z - 0.2) / 0.5, 0, 1);
        const sx = 1 - 0.56 * t;
        const sy = 1 - 0.46 * t;
        const x = positions.getX(i) + offset.x;
        positions.setXY(i, x * sx - offset.x, 0.30 + (y - 0.30) * sy - offset.y);
        // Inverse transpose of the taper Jacobian, retaining GLB smoothing.
        const nx = normals.getX(i) / sx;
        const ny = normals.getY(i) / sy;
        const nz = normals.getZ(i) - nx * x * 1.12 - ny * (y - 0.30) * 0.92;
        const inv = 1 / Math.hypot(nx, ny, nz);
        normals.setXYZ(i, nx * inv, ny * inv, nz * inv);
      } else {
        const x = positions.getX(i) + offset.x;
        if (Math.abs(x) > 0.35) {
          positions.setX(i, Math.sign(x) * (0.35 + (Math.abs(x) - 0.35) * 0.44) - offset.x);
        }
        const height = 0.77 + (y - 0.77) * 0.20;
        if (y > 0.77) positions.setY(i, height - offset.y);
        // Keep the straight shroud visible over the bowed receiver cheeks.
        if (z > -0.17 && z < 0.57 && y > 0.641) {
          const limit = 0.337 - (Math.min(y, height) - 0.632) * 0.98;
          positions.setX(i, THREE.MathUtils.clamp(x, -limit, limit) - offset.x);
        }
      }
    }
    // The atlas does not use the GLB tangents, which no longer match this profile.
    geometry.deleteAttribute('tangent');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}

/** Two static batches in Kenney coordinates (+Z forward), then baked into the
 * fitted rig. The open collar is all walls/rims, never a cap across the bore. */
export function addHardware(
  carrier: THREE.Group, matrix: THREE.Matrix4, bore: readonly [number, number, number],
  small: boolean, metal: THREE.MeshStandardMaterial, emit: THREE.MeshBasicMaterial,
): void {
  const body = new MeshBuilder();
  const glow = new MeshBuilder();
  const color = new THREE.Color();
  const rgb = (hex: number, gain = 1): [number, number, number] => {
    color.setHex(hex).multiplyScalar(gain);
    return [color.r, color.g, color.b];
  };
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, hex = STEEL, tilt = 0) => {
    if (!tilt) {
      body.addBox(x, y, z, sx, sy, sz, { rgb: rgb(hex), uvTile: 0.23 });
      return;
    }
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.rotateX(tilt).translate(x, y, z);
    body.addGeometry(g, rgb(hex), 0, 2.0);
    g.dispose();
  };
  const led = (x: number, y: number, z: number, sx: number, sy: number, sz: number, hex = MINT, gain = 1.95) => {
    glow.addBox(x, y, z, sx, sy, sz, { rgb: rgb(hex, gain) });
  };

  // Low stepped spine, with visible gaps between lugs. The optic has a
  // recessed dark face and a single dot on the rear-facing plane.
  const railEnd = small ? 0.67 : 0.34;
  box(0, 0.788, (railEnd - 0.27) / 2, 0.29, 0.064, railEnd + 0.27, INK);
  for (let z = -0.24; z < railEnd; z += 0.094) box(0, 0.828, z, 0.33, 0.032, 0.047);
  box(0, 0.862, -0.10, 0.29, 0.054, 0.24);
  box(0, 0.962, -0.116, 0.217, 0.133, 0.023, 0x26323a);
  for (const x of [-0.116, 0.116]) box(x, 0.955, -0.070, 0.048, 0.141, 0.144, INK);
  box(0, 1.033, -0.070, 0.272, 0.038, 0.143);
  led(0, 0.965, -0.130, 0.021, 0.021, 0.009);

  const mag = small ? -0.036 : 0.055;
  box(0, 0.119, mag, 0.285, 0.083, 0.25);
  box(0, -0.051, mag - 0.036, 0.216, 0.31, 0.176, INK, 0.25);
  box(0, -0.202, mag - 0.077, 0.24, 0.047, 0.197, STEEL, 0.25);
  const fore = small ? 0.59 : 0.42;
  box(0, 0.158, fore, 0.32, 0.13, 0.23);
  box(0, 0.062, fore, 0.18, 0.19, 0.133, INK, -0.28);

  // Break the rounded receiver into a flat deck and sloped shoulders. The
  // stamped cheeks terminate at the seam rather than floating on the rear.
  const length = small ? 0.74 : 0.39;
  const center = length / 2 - 0.17;
  const frontZ = center + length / 2;
  const rearZ = center - length / 2;
  const shoulderUV = [0, 0, length * 4, 0, length * 4, 0.85, 0, 0.85];
  box(0, 0.77, center, 0.36, 0.063, length, INK);
  for (const side of [-1, 1]) {
    const a = [side * 0.352, 0.632, rearZ], b = [side * 0.352, 0.632, frontZ];
    const c = [side * 0.18, 0.801, frontZ], d = [side * 0.18, 0.801, rearZ];
    body.addQuad(side > 0 ? [...b, ...a, ...d, ...c] : [...a, ...b, ...c, ...d],
      [side * Math.SQRT1_2, Math.SQRT1_2, 0], shoulderUV, rgb(INK));
    box(side * 0.339, 0.584, center, 0.049, 0.101, length);
  }
  box(0, 0.377, -0.625, 0.237, 0.036, 0.14, INK);
  box(0, 0.298, -0.682, 0.235, 0.192, 0.043, INK);
  const panel = small ? 0.31 : -0.02;
  led(0.366, 0.611, panel + 0.063, 0.009, 0.011, 0.119);
  led(0.366, 0.586, panel + 0.079, 0.009, 0.009, 0.086, MINT, 1.15);
  // A small warm service tag and dark embossed strokes on the cheek of the optic mount.
  led(0.366, 0.558, panel - 0.095, 0.009, 0.026, 0.081, AMBER, 0.64);
  for (let i = 0; i < 3; ++i) led(0.372, 0.558, panel - 0.115 + i * 0.021, 0.006, 0.012, 0.006, INK, 1);

  const [bx, by, bz] = bore;
  const r = small ? 0.148 : 0.128;
  const wall = r * 0.68;
  const back = bz - 0.018;
  const front = bz + COLLAR_FRONT;
  const uv = [0, 0, 0.32, 0, 0.32, 0.32, 0, 0.32];
  for (const x of small ? [bx] : [bx, -bx]) {
    const point = (radius: number, angle: number, z: number): number[] =>
      [x + radius * Math.cos(angle), by + radius * Math.sin(angle), z];
    for (let i = 0; i < 12; ++i) {
      const a = i * Math.PI / 6, b = (i + 1) * Math.PI / 6;
      const nx = Math.cos((a + b) / 2), ny = Math.sin((a + b) / 2);
      body.addQuad([...point(r, a, back), ...point(r, b, back), ...point(r, b, front), ...point(r, a, front)], [nx, ny, 0], uv, rgb(STEEL));
      body.addQuad([...point(wall, b, back), ...point(wall, a, back), ...point(wall, a, front), ...point(wall, b, front)], [-nx, -ny, 0], uv, rgb(INK));
      body.addQuad([...point(wall, a, front), ...point(r, a, front), ...point(r, b, front), ...point(wall, b, front)], [0, 0, 1], uv, rgb(INK));
      body.addQuad([...point(r, a, back), ...point(wall, a, back), ...point(wall, b, back), ...point(r, b, back)], [0, 0, -1], uv, rgb(INK));
    }
  }
  const lit = new THREE.Mesh(body.build().applyMatrix4(matrix), metal);
  lit.name = 'tactical-hardware';
  const marks = new THREE.Mesh(glow.build().applyMatrix4(matrix), emit);
  marks.name = 'hardware-markings';
  carrier.add(lit, marks);
}
