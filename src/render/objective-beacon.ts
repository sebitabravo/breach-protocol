import * as THREE from 'three';
import { SOLID_KIND, type MapData, type Solid } from '../world/map';
import { MeshBuilder } from './geometry';
import { CONSOLE_COLLAR, CONSOLE_TOP, consoleYaw, TERMINAL_SCALE } from './terminal-model';

const MINT = 0x75ffae;

/** T6b/S16 — the mint ground ring is the console's collar outline, not an
 * independent prop: every dimension rides the terminal's player-scale factor
 * (TERMINAL_SCALE), exactly as the console housing does. The ring used to be
 * laid out at authored size from the collider-exported plinth top while the
 * collar itself was rescaled to the player, so its plane floated above the
 * smaller collar and cut the desk shell (measured: 20 desk/cowling faces
 * sliced). The authored relationship — the outlined collar band, at
 * RING_CROWN_LOCAL − RING_DROP_LOCAL metres over the node floor — is restored
 * here, scaled with the machine. */
export const RING_BAR_LOCAL = 0.065;
export const RING_MARGIN_LOCAL = 0.018;
export const RING_CROWN_LOCAL = 1.2;
export const RING_DROP_LOCAL = 0.09;
/** Rim-local scale and world-plane height of the ground ring for a terminal
 * standing on a node floor at `nodeY` (the collider plinth peak is nodeY +
 * RING_CROWN_LOCAL on every surveyed map). */
export function groundRimFrame(nodeY: number): { scale: { x: number; y: number; z: number }; y: number } {
  return {
    scale: {
      x: CONSOLE_COLLAR.width + RING_MARGIN_LOCAL * TERMINAL_SCALE,
      y: TERMINAL_SCALE,
      z: CONSOLE_COLLAR.depth + RING_MARGIN_LOCAL * TERMINAL_SCALE,
    },
    y: nodeY + (RING_CROWN_LOCAL - RING_DROP_LOCAL) * TERMINAL_SCALE,
  };
}

export class ObjectiveBeacon {
  readonly position = new THREE.Vector3();
  readonly occlusionPoint = new THREE.Vector3();
  private readonly beacon = new THREE.Mesh(new THREE.OctahedronGeometry(1), new THREE.MeshBasicMaterial({ color: MINT, fog: false }));
  private readonly rim: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private plinths: (Solid | undefined)[] = [];

  constructor(scene: THREE.Scene) {
    const rim = new MeshBuilder();
    for (const sign of [-1, 1]) {
      rim.addBox(0, 0, sign * 0.49, 1, 0.065, 0.025);
      rim.addBox(sign * 0.49, 0, 0, 0.025, 0.065, 1);
    }
    this.rim = new THREE.Mesh(rim.build(), new THREE.MeshBasicMaterial({ color: MINT }));
    this.hide();
    scene.add(this.beacon, this.rim);
  }

  setMap(map: MapData): void {
    this.hide();
    this.plinths = map.nodes.map(({ x, y, z }) => map.solids.find((s) =>
      s.kind === SOLID_KIND.plinth && s.max[1] > y && x >= s.min[0] && x <= s.max[0] && z >= s.min[2] && z <= s.max[2]));
  }

  update(index: number, node: MapData['nodes'][number], camera: THREE.Camera, seconds: number, still: boolean): void {
    const base = this.plinths[index];
    const top = base?.max[1] ?? node.y + 1.2;
    const wave = still ? 0 : Math.sin(seconds * 3.2);
    this.position.set(node.x, node.y + CONSOLE_TOP + 0.35 + 0.085 * wave, node.z);
    // Test sight to the operator panel, not to the raised floating marker.
    this.occlusionPoint.set(node.x, top + 0.85, node.z);
    this.beacon.position.copy(this.position);
    const size = THREE.MathUtils.clamp(camera.position.distanceTo(this.position) * 0.014, 0.06, 0.44);
    this.beacon.scale.set(size * 0.78, size, size * 0.78);
    this.beacon.material.color.setHex(MINT).multiplyScalar(1.25 + 0.26 * wave);
    this.beacon.visible = true;
    this.rim.visible = base !== undefined;
    if (base) {
      const yaw = consoleYaw(node.x, node.z);
      const frame = groundRimFrame(node.y);
      this.rim.rotation.y = yaw;
      this.rim.position.set(node.x + CONSOLE_COLLAR.z * Math.sin(yaw), frame.y, node.z + CONSOLE_COLLAR.z * Math.cos(yaw));
      this.rim.scale.set(frame.scale.x, frame.scale.y, frame.scale.z);
      this.rim.material.color.setHex(MINT).multiplyScalar(1.85);
    }
  }

  hideIcon(): void { this.beacon.visible = false; }
  hide(): void { this.beacon.visible = this.rim.visible = false; }

  dispose(): void {
    this.beacon.removeFromParent();
    this.rim.removeFromParent();
    this.beacon.geometry.dispose();
    this.beacon.material.dispose();
    this.rim.geometry.dispose();
    this.rim.material.dispose();
  }
}

/** Single segment query against the exported arena AABBs, no Three hit arrays. */
export function objectiveOccluded(solids: readonly Solid[], from: THREE.Vector3, to: THREE.Vector3): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  for (const solid of solids) {
    let enter = 0, exit = 1;
    for (let axis = 0; axis < 3; axis += 1) {
      const origin = axis === 0 ? from.x : axis === 1 ? from.y : from.z;
      const delta = axis === 0 ? dx : axis === 1 ? dy : dz;
      const min = solid.min[axis], max = solid.max[axis];
      if (Math.abs(delta) < 1e-8) {
        if (origin < min || origin > max) { enter = 2; break; }
        continue;
      }
      const a = (min - origin) / delta, b = (max - origin) / delta;
      enter = Math.max(enter, Math.min(a, b));
      exit = Math.min(exit, Math.max(a, b));
      if (enter > exit) break;
    }
    if (enter <= exit && enter < 0.999 && exit > 0.001) return true;
  }
  return false;
}
