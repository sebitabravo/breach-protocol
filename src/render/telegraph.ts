/**
 * Telegrafía de estado de los robots: un halo instanciado por slot (una sola
 * draw call para todos los robots) y una línea de mira fija (LineSegments) para
 * el sentinel que apunta. Todo se reescribe por frame sobre buffers preasignados:
 * no se crean objetos ni geometrías durante la partida.
 */
import * as THREE from 'three';
import { MAX_ENEMIES } from '../wasm/bridge';
import { domCanvas, paintRadialGlow, toCanvasTexture } from './textures';

const HALO_FLOATS = 5; // x, y, z, radius, intensity
const HALO_SIZE = 1.6; // lado del quad en metros, antes del radio

export class Telegraph {
  readonly halo: THREE.InstancedMesh;
  readonly laser: THREE.LineSegments;
  private readonly haloData = new Float32Array(MAX_ENEMIES * HALO_FLOATS);
  private readonly haloColor = new Float32Array(MAX_ENEMIES * 3);
  private readonly laserPos = new Float32Array(MAX_ENEMIES * 6);
  private readonly laserCol = new Float32Array(MAX_ENEMIES * 6);
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpColor = new THREE.Color();
  private haloCount = 0;
  private laserCount = 0;
  private readonly textures: THREE.Texture[] = [];

  constructor(scene: THREE.Scene) {
    const tex = paintRadialGlow(domCanvas);
    const map = tex ? toCanvasTexture(tex, { wrap: false }) : null;
    if (map) this.textures.push(map);
    const haloGeo = new THREE.PlaneGeometry(HALO_SIZE, HALO_SIZE);
    const haloMat = new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new THREE.InstancedMesh(haloGeo, haloMat, MAX_ENEMIES);
    this.halo.frustumCulled = false;
    this.halo.count = 0;
    this.halo.visible = false;
    this.halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.halo.setColorAt(0, this.tmpColor.setRGB(0, 0, 0));
    scene.add(this.halo);

    const laserGeo = new THREE.BufferGeometry();
    laserGeo.setAttribute('position', new THREE.BufferAttribute(this.laserPos, 3).setUsage(THREE.DynamicDrawUsage));
    laserGeo.setAttribute('color', new THREE.BufferAttribute(this.laserCol, 3).setUsage(THREE.DynamicDrawUsage));
    const laserMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.laser = new THREE.LineSegments(laserGeo, laserMat);
    this.laser.frustumCulled = false;
    this.laser.visible = false;
    scene.add(this.laser);
  }

  beginFrame(): void {
    this.haloCount = 0;
    this.laserCount = 0;
  }

  /** Halo en (x, y, z); `hex` × `intensity` > 1 entra al bloom. */
  addHalo(x: number, y: number, z: number, radius: number, hex: number, intensity: number): void {
    if (this.haloCount >= MAX_ENEMIES) return;
    const i = this.haloCount;
    this.haloCount += 1;
    const d = i * HALO_FLOATS;
    this.haloData[d] = x;
    this.haloData[d + 1] = y;
    this.haloData[d + 2] = z;
    this.haloData[d + 3] = radius;
    this.haloData[d + 4] = intensity;
    this.tmpColor.setHex(hex);
    this.haloColor[i * 3] = this.tmpColor.r;
    this.haloColor[i * 3 + 1] = this.tmpColor.g;
    this.haloColor[i * 3 + 2] = this.tmpColor.b;
  }

  /** Línea de mira desde `from` hasta `to`; `intensity` escala el color. */
  addLaser(from: readonly [number, number, number], to: readonly [number, number, number], hex: number, intensity: number): void {
    if (this.laserCount >= MAX_ENEMIES) return;
    const p = this.laserCount * 6;
    this.laserPos[p] = from[0];
    this.laserPos[p + 1] = from[1];
    this.laserPos[p + 2] = from[2];
    this.laserPos[p + 3] = to[0];
    this.laserPos[p + 4] = to[1];
    this.laserPos[p + 5] = to[2];
    this.tmpColor.setHex(hex);
    for (let v = 0; v < 2; v += 1) {
      this.laserCol[p + v * 3] = this.tmpColor.r * intensity;
      this.laserCol[p + v * 3 + 1] = this.tmpColor.g * intensity;
      this.laserCol[p + v * 3 + 2] = this.tmpColor.b * intensity;
    }
    this.laserCount += 1;
  }

  /** Sube los buffers y orienta los halos hacia la cámara. Sin allocations. */
  endFrame(camera: THREE.Camera): void {
    this.halo.visible = this.haloCount > 0;
    this.halo.count = this.haloCount;
    for (let i = 0; i < this.haloCount; i += 1) {
      const d = i * HALO_FLOATS;
      this.tmpPos.set(this.haloData[d], this.haloData[d + 1], this.haloData[d + 2]);
      const r = this.haloData[d + 3] * HALO_SIZE;
      this.tmpScale.set(r, r, r);
      this.tmpMatrix.compose(this.tmpPos, camera.quaternion, this.tmpScale);
      this.halo.setMatrixAt(i, this.tmpMatrix);
      const k = this.haloData[d + 4];
      this.tmpColor.setRGB(this.haloColor[i * 3] * k, this.haloColor[i * 3 + 1] * k, this.haloColor[i * 3 + 2] * k);
      this.halo.setColorAt(i, this.tmpColor);
    }
    this.halo.instanceMatrix.needsUpdate = true;
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;

    this.laser.visible = this.laserCount > 0;
    if (this.laserCount > 0) {
      const attrPos = this.laser.geometry.getAttribute('position') as THREE.BufferAttribute;
      const attrCol = this.laser.geometry.getAttribute('color') as THREE.BufferAttribute;
      attrPos.needsUpdate = true;
      attrCol.needsUpdate = true;
      this.laser.geometry.setDrawRange(0, this.laserCount * 2);
    }
  }

  dispose(): void {
    this.halo.removeFromParent();
    this.halo.geometry.dispose();
    (this.halo.material as THREE.Material).dispose();
    this.laser.removeFromParent();
    this.laser.geometry.dispose();
    (this.laser.material as THREE.Material).dispose();
    for (const t of this.textures) t.dispose();
    this.textures.length = 0;
  }
}
