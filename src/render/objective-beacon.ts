import * as THREE from 'three';
import { SOLID_KIND, type MapData, type Solid } from '../world/map';
import { MeshBuilder } from './geometry';
import { CONSOLE_COLLAR, CONSOLE_TOP, consoleYaw } from './terminal-model';

const MINT = 0x75ffae;

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
      this.rim.rotation.y = yaw;
      this.rim.position.set(node.x + CONSOLE_COLLAR.z * Math.sin(yaw), top - 0.09, node.z + CONSOLE_COLLAR.z * Math.cos(yaw));
      this.rim.scale.set(CONSOLE_COLLAR.width + 0.018, 1, CONSOLE_COLLAR.depth + 0.018);
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
