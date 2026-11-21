import * as THREE from 'three';
import { WEAPON } from '../wasm/protocol';
import { FACE, MeshBuilder } from './geometry';
import { FINISH } from './finishes';

type XYZ = readonly [number, number, number];
type Profile = readonly (readonly [z: number, y: number])[];
type Zone = 'steel' | 'polymer' | 'rubber' | 'ink' | 'action' | 'heat' | 'glass' | 'dot';

const P = {
  shell: FINISH.polymer.color, grip: 0x161c22, pad: 0x303940, seam: 0x10151a,
  steel: 0x586975, edge: FINISH.steel.color, oxide: 0x3d505c, bore: 0x2b3439,
  ink: 0x9baeb1, mint: 0x5ce08b, warn: 0xb08a56, amber: 0xd39a61, teal: 0x4de3c6, red: 0xff3b4a,
} as const;

/** Material variants share the same maps, but not per-weapon heat or dot state. */
export function weaponMaterials(steel: THREE.MeshStandardMaterial, ink: THREE.MeshBasicMaterial) {
  return {
    steel, ink, action: steel,
    polymer: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: FINISH.polymer.roughness, metalness: FINISH.polymer.metalness }),
    rubber: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: FINISH.rubber.roughness, metalness: FINISH.rubber.metalness }),
    heat: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.58, roughness: 0.36, emissive: 0xc66134, emissiveIntensity: 0 }),
    // Single tinted optical pane, not transmission (no separate render pass).
    glass: new THREE.MeshBasicMaterial({ color: FINISH.glass.color, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true }),
    dot: new THREE.MeshBasicMaterial({ color: P.red }),
  } satisfies Record<Zone, THREE.Material>;
}

export interface AuthoredWeapon {
  action: THREE.Mesh;
  dot?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glass?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  heat: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  travel: number;
  actionTime: number;
  temperature: number;
  muzzle: THREE.Object3D;
  /** Camera-local contact envelopes; not registered as world/simulation colliders. */
  contact: { grip: THREE.Box3; support: THREE.Box3 };
}

class Parts {
  readonly batches = new Map<Zone, MeshBuilder>();
  private readonly tint = new THREE.Color();

  private batch(zone: Zone): MeshBuilder {
    let out = this.batches.get(zone);
    if (!out) { out = new MeshBuilder(); this.batches.set(zone, out); }
    return out;
  }

  private add(g: THREE.BufferGeometry, zone: Zone, color: number, gain = 1): void {
    if (zone === 'steel' || zone === 'action') {
      // Project the borrowed metal maps at a constant part scale, including on
      // beveled faces. Broad face normals stay flat, chamfers catch the key.
      const n = g.getAttribute('normal'), p = g.getAttribute('position'), uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; ++i) {
        const x = Math.abs(n.getX(i)), y = Math.abs(n.getY(i)), z = Math.abs(n.getZ(i));
        uv.setXY(i, (x > z ? p.getZ(i) : p.getX(i)) * 7.5, (y > x && y > z ? p.getZ(i) : p.getY(i)) * 7.5);
      }
    }
    this.tint.setHex(color).multiplyScalar(gain);
    this.batch(zone).addGeometry(g, [this.tint.r, this.tint.g, this.tint.b], 0);
    g.dispose();
  }

  /** Side-on profiles extruded through X with one flat chamfer, not fillets. */
  profile(zone: Zone, color: number, points: Profile, width: number, bevel: number, x = 0, holes: readonly Profile[] = []): void {
    const outline = new THREE.Shape();
    const trace = (path: THREE.Path, poly: Profile) => {
      path.moveTo(...poly[0]);
      for (let i = 1; i < poly.length; ++i) path.lineTo(...poly[i]);
      path.closePath();
    };
    trace(outline, points);
    for (const h of holes) { const path = new THREE.Path(); trace(path, h); outline.holes.push(path); }
    const g = new THREE.ExtrudeGeometry(outline, {
      depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
      bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate(0, 0, bevel - width / 2).rotateY(-Math.PI / 2).translate(x, 0, 0);
    this.add(g, zone, color);
  }

  chamfer(zone: Zone, color: number, center: XYZ, size: XYZ, bevel = 0.004, pitch = 0): void {
    const cut = Math.min(bevel, ...size.map((v) => v * 0.23));
    const [x, y, z] = size.map((v) => v / 2 - cut);
    const s = new THREE.Shape().moveTo(-x, -y).lineTo(x, -y).lineTo(x, y).lineTo(-x, y).closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: 2 * z, bevelSize: cut, bevelThickness: cut, bevelSegments: 1, steps: 1, curveSegments: 1,
    });
    g.translate(0, 0, -z).rotateX(pitch).translate(...center);
    this.add(g, zone, color);
  }

  /** Open radially-profiled wall. y is the axis in LatheGeometry; map it to -Z. */
  tube(zone: Zone, color: number, rear: XYZ, profile: readonly (readonly [radius: number, advance: number])[], faces = 12): void {
    const points = profile.map(([radius, advance]) => new THREE.Vector2(radius, advance));
    this.add(new THREE.LatheGeometry(points, faces).rotateX(-Math.PI / 2).translate(...rear), zone, color);
  }

  cable(zone: Zone, color: number, points: readonly XYZ[], radius: number, steps = 8): void {
    const route = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
    this.add(new THREE.TubeGeometry(route, steps, radius, 5, points[0] === points.at(-1)), zone, color);
  }

  volume(zone: Zone, color: number, from: XYZ, to: XYZ, x: number, z: number): void {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
    const along = b.clone().sub(a);
    const g = new THREE.SphereGeometry(1, 10, 6);
    g.scale(x, along.length() / 2, z).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, along.normalize()));
    a.lerp(b, 0.5);
    this.add(g.translate(a.x, a.y, a.z), zone, color);
  }

  stamp(x: number, y: number, z: number, height: number, text: string, tone: number): void {
    const u = height / 5;
    let cursor = z;
    for (const letter of text) {
      const rows = FONT[letter];
      if (rows) for (let r = 0; r < rows.length; ++r) {
        for (let i = 0; i < rows[r].length;) {
          if (rows[r][i] !== '1') { ++i; continue; }
          let end = i + 1;
          while (rows[r][end] === '1') ++end;
          this.decal(x, y - r * u, cursor + (i + end - 1) * u / 2, u * 0.95, (end - i) * u - u * 0.06, tone);
          i = end;
        }
      }
      cursor += u * 4.1;
    }
  }

  decal(x: number, y: number, z: number, h: number, w: number, hex: number, gain = 0.66): void {
    this.tint.setHex(hex).multiplyScalar(gain);
    this.batch('ink').addBox(x, y, z, 0.0001, h, w, { faces: FACE.negX, rgb: [this.tint.r, this.tint.g, this.tint.b] });
  }

  hazard(x: number, y: number, z: number, width: number): void {
    this.stamp(x, y, z, width, '△', P.warn);
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const FONT: Record<string, string[]> = Object.fromEntries(Object.entries({
  P: '110 101 110 100 100', B: '110 101 110 101 110', A: '010 101 111 101 101', R: '110 101 110 101 101',
  S: '111 100 111 001 111', G: '111 100 101 101 111', '0': '111 101 101 101 111', '1': '010 110 010 010 111',
  '2': '110 001 111 100 111', '3': '111 001 011 001 111', '4': '101 101 111 001 001', '7': '111 001 010 010 100',
  '8': '111 101 111 101 111', '-': '000 000 111 000 000', '△': '00100 01010 01010 10001 11111',
}).map(([letter, bits]) => [letter, bits.split(' ')]));

function envelope(center: XYZ, size: XYZ): THREE.Box3 {
  return new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(...center), new THREE.Vector3(...size));
}

function muzzle(p: Parts, y: number, tip: number, radius: number, width: number, angular = 12): void {
  const r = radius, b = radius * 0.55, w = width;
  p.tube('heat', P.oxide, [0, y, tip + w], [[b, 0], [r * 0.78, 0], [r, w * 0.24], [r, w * 0.88], [r * 0.84, w], [b, w], [b, 0]], angular);
  p.tube('heat', P.edge, [0, y, tip + w * 0.24], [[r * 0.993, 0], [r * 1.012, w * 0.03], [r * 1.012, w * 0.085], [r * 0.993, w * 0.10]], angular);
}

function barrel(p: Parts, x: number, y: number, z: number, length: number, r: number): void {
  p.tube('steel', P.edge, [x, y, z], [[r * 0.66, 0], [r * 0.87, 0], [r, 0.009], [r, length - 0.004], [r * 0.87, length], [r * 0.66, length], [r * 0.66, 0]]);
}

function guard(p: Parts, z: number, y: number, span: number): void {
  p.profile('polymer', P.shell, [[z, y], [z + 0.012, y + 0.011], [z + span, y], [z + span - 0.014, y - 0.053], [z + 0.013, y - 0.050]], 0.031, 0.003,
    0, [[[z + 0.010, y - 0.004], [z + span - 0.011, y - 0.007], [z + span - 0.023, y - 0.042], [z + 0.021, y - 0.039]]]);
  p.profile('steel', P.oxide, [[z + span * 0.64, y + 0.004], [z + span * 0.80, y + 0.004], [z + span * 0.78, y - 0.023], [z + span * 0.55, y - 0.033]], 0.010, 0.002);
}

function fastener(p: Parts, x: number, y: number, z: number, r = 0.006): void {
  const g = new THREE.CylinderGeometry(r * 0.8, r, 0.004, 6, 1);
  g.rotateZ(Math.PI / 2).translate(x, y, z);
  p.batches.get('steel')!.addGeometry(g, [0.32, 0.38, 0.40], 0);
  g.dispose();
  p.decal(x - 0.0025, y, z, r * 0.26, r, P.seam, 0.75);
}

function gripCuts(p: Parts, x: number, y: number, z: number, step: number, tilt: number): void {
  for (let j = 0; j < 4; ++j) p.chamfer('rubber', P.pad, [x, y - step * j, z + step * j * tilt], [0.004, 0.004, 0.048], 0.001);
}

function sidearm(p: Parts) {
  const y = 0.059, tip = -0.355;
  p.profile('polymer', P.shell, [[-0.279, 0.035], [0.133, 0.034], [0.139, 0.006], [0.084, -0.020], [-0.167, -0.025], [-0.249, -0.011]], 0.071, 0.005);
  p.profile('action', P.steel, [[-0.302, 0.037], [-0.280, 0.089], [-0.177, 0.099], [0.106, 0.099], [0.142, 0.076], [0.140, 0.036]], 0.080, 0.0075);
  p.chamfer('action', P.oxide, [0, 0.103, 0.026], [0.063, 0.008, 0.179], 0.003);
  for (let i = 0; i < 5; ++i) p.chamfer('action', P.oxide, [-0.040, 0.067, 0.074 + i * 0.012], [0.006, 0.043, 0.005], 0.001, -0.24);
  p.chamfer('action', P.bore, [0, 0.105, -0.178], [0.041, 0.005, 0.075]);
  barrel(p, 0, y, -0.261, 0.078, 0.020);
  muzzle(p, y, tip, 0.024, 0.023);
  p.chamfer('steel', P.oxide, [0, 0.108, -0.270], [0.016, 0.029, 0.023]);
  for (const x of [-0.023, 0.023]) p.chamfer('action', P.edge, [x, 0.116, 0.111], [0.013, 0.031, 0.030]);
  p.profile('polymer', P.shell, [[-0.032, 0.013], [0.094, 0.014], [0.142, -0.129], [0.107, -0.169], [0.028, -0.158], [-0.016, -0.076]], 0.066, 0.007);
  p.chamfer('rubber', P.grip, [0, -0.085, 0.058], [0.076, 0.107, 0.075], 0.008, 0.29);
  gripCuts(p, -0.037, -0.056, 0.045, 0.013, 0.29);
  p.chamfer('action', P.oxide, [-0.037, 0.073, -0.193], [0.009, 0.026, 0.132], 0.0035);
  p.chamfer('steel', P.oxide, [0, -0.165, 0.084], [0.064, 0.034, 0.092], 0.006, 0.15);
  p.chamfer('polymer', P.pad, [0, -0.180, 0.085], [0.076, 0.015, 0.105], 0.004, 0.17);
  guard(p, -0.156, -0.011, 0.151);
  p.chamfer('steel', P.oxide, [-0.039, 0.025, 0.058], [0.010, 0.011, 0.045]);
  p.decal(-0.0365, 0.017, -0.105, 0.0045, 0.071, P.mint, 1.25);
  p.stamp(-0.0365, 0.007, -0.188, 0.015, 'PB-01', P.ink);
  p.stamp(-0.0365, 0.021, -0.018, 0.008, '017', P.ink);
  p.hazard(-0.0365, 0.009, -0.225, 0.013);
  const grip = envelope([0, -0.098, 0.064], [0.061, 0.078, 0.097]);
  const support = envelope([0.006, -0.107, 0.033], [0.080, 0.045, 0.073]);
  return { muzzle: [0, y, tip - 0.002] as XYZ, travel: 0.039, name: 'PB-01', grip, support };
}

function rail(p: Parts, from: number, to: number, y: number): void {
  p.chamfer('steel', P.oxide, [0, y, (from + to) / 2], [0.057, 0.016, to - from], 0.004);
  for (let z = from + 0.014; z < to - 0.006; z += 0.026) p.chamfer('steel', P.edge, [0, y + 0.011, z], [0.069, 0.009, 0.014], 0.0025);
}

function sight(p: Parts, z: number, y: number, rear: boolean): void {
  p.chamfer('polymer', P.grip, [0, y, z], [0.057, 0.014, 0.037]);
  for (const x of [-0.018, 0.018]) p.chamfer('steel', P.oxide, [x, y + 0.018, z + 0.004], [0.010, 0.029, 0.014], 0.003, -0.22);
  p.chamfer('steel', P.edge, [0, y + (rear ? 0.023 : 0.028), z], [rear ? 0.024 : 0.006, rear ? 0.006 : 0.017, 0.009], 0.002);
}

function carbine(p: Parts) {
  const y = 0.050, tip = -0.650;
  // Uninterrupted spine above a layered, faceted receiver with a recessed port.
  p.profile('steel', P.steel, [[-0.232, 0.013], [-0.236, 0.073], [-0.208, 0.091], [0.146, 0.091], [0.166, 0.069], [0.147, 0.028], [0.112, 0.013]], 0.079, 0.007);
  p.profile('polymer', P.shell, [[-0.222, 0.015], [0.138, 0.015], [0.122, -0.017], [0.027, -0.026], [-0.018, -0.023], [-0.061, -0.047], [-0.205, -0.039]], 0.078, 0.006);
  for (const s of [-1, 1]) {
    p.chamfer('steel', P.oxide, [s * 0.040, 0.027, -0.041], [0.012, 0.014, 0.335], 0.003);
    p.chamfer('polymer', P.seam, [s * 0.040, 0.059, -0.042], [0.010, 0.037, 0.146], 0.005);
    p.chamfer('steel', P.bore, [s * 0.045, 0.075, -0.041], [0.007, 0.010, 0.141], 0.002);
    p.chamfer('action', P.edge, [s * 0.045, 0.058, -0.073], [0.008, 0.020, 0.070], 0.003);
    p.chamfer('action', P.oxide, [s * 0.055, 0.065, 0.130], [0.036, 0.018, 0.034], 0.004);
  }
  rail(p, -0.495, 0.144, 0.102);
  sight(p, -0.461, 0.116, false);
  sight(p, 0.113, 0.116, true);

  // Vent windows are the exposed space between the ribs and a smaller tube.
  barrel(p, 0, y, -0.179, 0.443, 0.022);
  p.chamfer('steel', P.oxide, [0, 0.005, -0.352], [0.082, 0.027, 0.280], 0.007);
  for (const s of [-1, 1]) {
    for (const v of [0.033, 0.078]) p.chamfer('steel', P.steel, [s * 0.043, v, -0.356], [0.019, 0.016, 0.284], 0.0035);
    for (let i = 0; i <= 6; ++i) p.chamfer('steel', i % 3 === 0 ? P.edge : P.oxide, [s * 0.043, 0.055, -0.489 + i * 0.0445], [0.023, 0.051, i === 0 || i === 6 ? 0.024 : 0.011], 0.0035, -0.32);
    p.chamfer('polymer', P.pad, [s * 0.039, -0.011, -0.410], [0.024, 0.017, 0.110]);
  }
  muzzle(p, y, tip, 0.031, 0.069, 8);
  for (const s of [-1, 1]) for (let i = 0; i < 2; ++i) p.chamfer('heat', P.bore, [s * 0.028, y + 0.006, -0.622 + i * 0.024], [0.006, 0.014, 0.014], 0.002);

  // Stock frame: negative space between the tube track and angled brace.
  p.chamfer('steel', P.oxide, [0, 0.045, 0.220], [0.049, 0.048, 0.160], 0.007);
  for (let i = 0; i < 3; ++i) p.chamfer('polymer', P.seam, [-0.025, 0.044, 0.173 + i * 0.025], [0.004, 0.012, 0.010], 0.001);
  p.profile('polymer', P.shell, [[0.191, 0.071], [0.323, 0.065], [0.344, 0.037], [0.333, -0.092], [0.301, -0.088], [0.177, 0.015]], 0.070, 0.006, 0,
    [[[0.223, 0.014], [0.305, 0.019], [0.304, -0.052], [0.267, -0.022]]]);
  p.chamfer('rubber', P.pad, [0, -0.026, 0.343], [0.085, 0.142, 0.023], 0.007, -0.12);
  for (let i = 0; i < 3; ++i) p.chamfer('rubber', P.grip, [0, -0.065 + i * 0.035, 0.356 + i * 0.004], [0.071, 0.008, 0.008], 0.002);
  p.chamfer('steel', P.oxide, [0, -0.015, 0.227], [0.036, 0.020, 0.035], 0.003, -0.7);

  p.profile('polymer', P.shell, [[-0.010, 0], [0.088, 0.013], [0.123, -0.120], [0.088, -0.163], [0.025, -0.140], [0.004, -0.061]], 0.055, 0.007);
  p.chamfer('rubber', P.grip, [0, -0.091, 0.066], [0.061, 0.090, 0.073], 0.008, 0.29);
  gripCuts(p, -0.030, -0.062, 0.058, 0.012, 0.29);
  guard(p, -0.077, -0.015, 0.093);
  p.profile('steel', P.oxide, [[-0.211, -0.025], [-0.069, -0.023], [-0.062, -0.050], [-0.078, -0.070], [-0.207, -0.075]], 0.086, 0.004);
  p.profile('polymer', P.shell, [[-0.202, -0.062], [-0.085, -0.064], [-0.090, -0.129], [-0.123, -0.205], [-0.229, -0.204], [-0.207, -0.151]], 0.065, 0.006);
  p.chamfer('rubber', P.pad, [0, -0.205, -0.175], [0.074, 0.023, 0.113], 0.005, -0.08);
  const witness: Profile = [[-0.159, -0.082], [-0.140, -0.081], [-0.167, -0.181], [-0.186, -0.182]];
  const holes: Profile[] = [];
  for (let i = 0; i < 4; ++i) {
    const y = -0.095 - i * 0.022, z = -0.153 - i * 0.006;
    holes.push([[z - 0.0045, y - 0.0028], [z + 0.0045, y - 0.0028], [z + 0.005, y + 0.0028], [z - 0.004, y + 0.0028]]);
  }
  p.profile('polymer', P.seam, witness, 0.003, 0, -0.0345);
  p.profile('steel', P.oxide, witness, 0.004, 0.0007, -0.038, holes);

  // Visor holográfico de caja, como en la maqueta: cuerpo cerrado, capucha y
  // ventana tintada; el punto rojo queda detrás del vidrio.
  p.chamfer('polymer', P.shell, [0, 0.122, -0.113], [0.076, 0.017, 0.100], 0.004);
  for (const s of [-1, 1]) p.chamfer('steel', P.oxide, [s * 0.034, 0.152, -0.132], [0.012, 0.064, 0.064], 0.004, 0.12);
  p.chamfer('steel', P.steel, [0, 0.186, -0.134], [0.080, 0.012, 0.072], 0.004, 0.11);
  p.chamfer('polymer', P.grip, [0, 0.131, -0.096], [0.070, 0.020, 0.026], 0.004);
  p.chamfer('steel', P.edge, [0.043, 0.156, -0.118], [0.008, 0.020, 0.020], 0.002);
  p.chamfer('glass', 0xffffff, [0, 0.153, -0.142], [0.056, 0.054, 0.002], 0.0003, 0.13);
  p.volume('dot', P.red, [0, 0.148, -0.137], [0, 0.153, -0.137], 0.0025, 0.002);
  // Franjas teal del receptor (lectura de la maqueta); sin luz propia, el bloom las marca.
  for (const s of [-1, 1]) {
    p.chamfer('ink', P.teal, [s * 0.0405, 0.083, -0.04], [0.002, 0.004, 0.2], 0.0005);
    p.chamfer('ink', P.teal, [s * 0.044, 0.006, -0.40], [0.002, 0.003, 0.11], 0.0005);
  }
  const loop: XYZ[] = [[-0.040, 0.013, 0.199], [-0.057, -0.002, 0.211], [-0.057, -0.022, 0.193], [-0.047, -0.016, 0.176], [-0.039, 0.005, 0.178]];
  p.cable('steel', P.edge, loop, 0.004, 10);
  p.cable('rubber', P.grip, [[-0.042, 0.043, -0.200], [-0.058, 0.025, -0.226], [-0.057, 0.019, -0.261], [-0.048, 0.033, -0.283]], 0.0034);
  p.cable('rubber', P.grip, [[-0.032, 0.106, -0.142], [-0.043, 0.099, -0.177], [-0.037, 0.085, -0.207]], 0.0026, 6);
  p.chamfer('steel', P.edge, [-0.051, 0.028, -0.252], [0.014, 0.021, 0.007], 0.002);
  p.chamfer('steel', P.edge, [-0.046, 0.029, -0.231], [0.012, 0.017, 0.007], 0.002);
  p.stamp(-0.0395, 0.004, -0.194, 0.019, 'AR-04', P.ink);
  p.stamp(-0.0395, 0.003, 0.040, 0.012, '2407', P.ink);
  p.hazard(-0.043, 0.075, -0.199, 0.019);
  fastener(p, -0.044, 0.062, 0.087);
  fastener(p, -0.043, 0.053, -0.148);
  return { muzzle: [0, y, tip - 0.002] as XYZ, travel: 0.057, name: 'AR-04', grip: envelope([0, -0.095, 0.068], [0.057, 0.076, 0.082]),
    support: envelope([0, 0.001, -0.399], [0.096, 0.045, 0.101]) };
}

function scatter(p: Parts) {
  const y = 0.054, tip = -0.562;
  p.profile('steel', P.steel, [[-0.250, 0.025], [-0.226, 0.086], [-0.018, 0.093], [0.089, 0.080], [0.120, 0.056], [0.106, 0.015], [0.067, -0.011], [-0.205, -0.032]], 0.105, 0.010);
  p.chamfer('steel', P.oxide, [0, 0.089, -0.058], [0.070, 0.016, 0.273], 0.004);
  p.chamfer('polymer', P.seam, [-0.052, 0.060, -0.052], [0.013, 0.037, 0.142], 0.006);
  p.chamfer('action', P.edge, [-0.057, 0.060, -0.082], [0.010, 0.020, 0.072], 0.003);
  p.chamfer('action', P.oxide, [-0.065, 0.057, -0.066], [0.020, 0.016, 0.033], 0.003);
  p.chamfer('polymer', P.shell, [0, -0.018, -0.072], [0.097, 0.027, 0.231], 0.006);
  barrel(p, 0, y, -0.182, 0.356, 0.030);
  barrel(p, 0, y - 0.060, -0.194, 0.321, 0.025);
  p.tube('steel', P.oxide, [0, y - 0.060, -0.494], [[0.018, 0], [0.031, 0], [0.033, 0.008], [0.033, 0.024], [0.027, 0.031], [0.006, 0.031], [0.006, 0]]);
  muzzle(p, y, tip, 0.042, 0.059, 10);
  p.tube('steel', P.edge, [0, y, -0.527], [[0.041, 0], [0.044, 0.003], [0.044, 0.010], [0.041, 0.013]], 10);
  p.chamfer('steel', P.oxide, [0, 0.091, -0.481], [0.018, 0.016, 0.036]);
  p.chamfer('steel', P.edge, [0, 0.104, -0.487], [0.010, 0.014, 0.014], 0.003);
  p.chamfer('steel', P.oxide, [0, 0.104, 0.058], [0.061, 0.018, 0.045]);
  for (const x of [-0.016, 0.016]) p.chamfer('steel', P.edge, [x, 0.118, 0.060], [0.010, 0.018, 0.014]);

  p.profile('polymer', P.shell, [[-0.436, 0.029], [-0.402, 0.039], [-0.252, 0.037], [-0.223, 0.017], [-0.234, -0.047], [-0.273, -0.057], [-0.404, -0.054], [-0.431, -0.040]], 0.125, 0.007);
  for (let i = 0; i < 7; ++i) p.chamfer('rubber', i % 2 ? P.grip : P.pad, [0, -0.011, -0.411 + i * 0.026], [0.137, 0.081, 0.014], 0.006, -0.18);
  for (const x of [-0.063, 0.063]) p.chamfer('steel', P.amber, [x, 0.021, -0.426], [0.009, 0.023, 0.020], 0.002, -0.18);

  // A continuous sporting stock rather than the carbine's open truss.
  p.profile('polymer', P.shell, [[0.057, 0.054], [0.127, 0.045], [0.226, 0.019], [0.255, 0.014], [0.262, -0.123], [0.220, -0.130], [0.139, -0.104], [0.105, -0.108], [0.072, -0.125], [0.017, -0.103], [0.026, -0.045]], 0.079, 0.008);
  p.chamfer('rubber', P.pad, [0, -0.058, 0.257], [0.086, 0.141, 0.029], 0.007, -0.08);
  p.chamfer('rubber', P.grip, [0, -0.075, 0.067], [0.086, 0.089, 0.081], 0.010, 0.67);
  gripCuts(p, -0.041, -0.057, 0.050, 0.010, 0.62);
  guard(p, -0.052, -0.028, 0.107);
  for (let j = 0; j < 3; ++j) p.chamfer('polymer', P.amber, [-0.043, -0.024, 0.137 + 0.016 * j], [0.006, 0.021, 0.007], 0.001, -0.34);
  p.decal(-0.054, 0.058, -0.173, 0.004, 0.055, P.mint, 1.25);
  p.stamp(-0.054, 0.026, -0.160, 0.019, 'SG-08', P.ink);
  p.stamp(-0.054, 0.032, 0.001, 0.011, '238', P.ink);
  p.hazard(-0.054, 0.060, 0.048, 0.017);
  fastener(p, -0.055, 0.033, -0.192);
  return { muzzle: [0, y, tip - 0.002] as XYZ, travel: 0.049, name: 'SG-08', grip: envelope([0, -0.077, 0.067], [0.071, 0.064, 0.084]),
    support: envelope([0, -0.012, -0.353], [0.129, 0.092, 0.101]) };
}

export function authorWeapon(root: THREE.Group, id: number, materials: ReturnType<typeof weaponMaterials>): AuthoredWeapon {
  const p = new Parts();
  const spec = id === WEAPON.carbine ? carbine(p) : id === WEAPON.shotgun ? scatter(p) : sidearm(p);
  root.name = spec.name;
  for (const [zone, batch] of p.batches) {
    const geometry = batch.build();
    geometry.deleteAttribute('aBlink');
    geometry.deleteAttribute('aSurface');
    // Need independent heat/dot per weapon, so switching doesn't inherit it.
    const material = zone === 'heat' || zone === 'dot' || zone === 'glass' ? materials[zone].clone() : materials[zone];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = zone;
    root.add(mesh);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(...spec.muzzle);
  root.add(muzzle);
  return {
    action: root.getObjectByName('action') as AuthoredWeapon['action'],
    dot: root.getObjectByName('dot') as AuthoredWeapon['dot'], glass: root.getObjectByName('glass') as AuthoredWeapon['glass'],
    heat: root.getObjectByName('heat') as AuthoredWeapon['heat'],
    travel: spec.travel, actionTime: 0, temperature: 0,
    muzzle, contact: { grip: spec.grip, support: spec.support },
  };
}
