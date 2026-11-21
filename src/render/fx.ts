/**
 * Frame-rate friendly FX pool: one LineSegments batch for tracers, one Points
 * batch for sparks, one billboarded additive quad for the muzzle flash.
 * All buffers are preallocated; nothing is allocated per spawn call.
 */
import * as THREE from 'three';
import { SOLID_KIND } from '../world/map';

const MAX_TRACERS = 64;
const MAX_SPARKS = 1024;
const TRACER_LIFE = 0.09;
const FLASH_LIFE = 0.06;
// Local offset just beyond the rim so a depth-tested flare isn't buried in the mesh.
const FLASH_LEAD = 0.033;
const SPARK_GRAVITY = -14;

/** tokens.css palette (hex int form for three.js). */
const C = {
  accent: 0x4de3c6,
  tracer: 0xbfffe0,
  flash: 0xffc984,
} as const;

/** Color de chispa por tipo de superficie (SOLID_KIND en world/map.ts). */
const SURFACE_SPARK: Record<number, number> = {
  0: 0x96aaba, // wall: acero pálido
  1: 0x8a9aa6, // floor: polvo
  2: 0xffb35c, // crate: ámbar
  3: 0xbfe9ff, // pillar: cian frío
  4: 0x5ce08b, // plinth: terminal, menta
  5: 0xffb35c, // cover: ámbar
  6: 0x4de3c6, // rack: teal
  7: 0xffd28a, // deck: cálido
};
const SURFACE_DEFAULT = 0x96aaba;
/** Margen para que un punto sobre la cara de un sólido cuente como dentro. */
const SURFACE_EPS = 0.05;

/**
 * Color de chispa según el sólido golpeado. El evento WALL_HIT solo trae el
 * punto (sin tipo de superficie), así que se busca el sólido que lo contiene.
 */
export function impactColour(solids: readonly SurfaceSolid[], x: number, y: number, z: number): number {
  for (const s of solids) {
    if (
      x >= s.min[0] - SURFACE_EPS && x <= s.max[0] + SURFACE_EPS &&
      y >= s.min[1] - SURFACE_EPS && y <= s.max[1] + SURFACE_EPS &&
      z >= s.min[2] - SURFACE_EPS && z <= s.max[2] + SURFACE_EPS
    ) {
      return SURFACE_SPARK[s.kind] ?? SURFACE_DEFAULT;
    }
  }
  return SURFACE_DEFAULT;
}

export interface SurfaceSolid {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  kind: number;
}

/** Recover a front-facing plane from the hit point + shot origin, not an arbitrary camera offset.
 * Skip corners so the entire mark fits the face. Crates have shallow raised panel trim. */
export function impactFace(solids: readonly SurfaceSolid[], hit: THREE.Vector3, origin: THREE.Vector3,
  point: THREE.Vector3, normal: THREE.Vector3): boolean {
  let facing = 0, offset = 0, axis = -1, direction = 0, plane = 0;
  for (const solid of solids) {
    const cargo = solid.kind === SOLID_KIND.crate || solid.kind === SOLID_KIND.cover;
    if (!cargo && solid.kind !== SOLID_KIND.wall && solid.kind !== SOLID_KIND.pillar) continue;
    for (let a = 0; a < 3; a += 1) {
      const v = hit.getComponent(a), eye = origin.getComponent(a);
      const sign = eye > v ? 1 : -1;
      const candidate = (sign > 0 ? solid.max : solid.min)[a];
      if (Math.abs(v - candidate) > SURFACE_EPS) continue;
      const u = (a + 1) % 3, w = (a + 2) % 3;
      const hu = hit.getComponent(u), hw = hit.getComponent(w);
      if (hu < solid.min[u] + 0.16 || hu > solid.max[u] - 0.16 || hw < solid.min[w] + 0.16 || hw > solid.max[w] - 0.16) continue;
      if (Math.abs(eye - v) <= facing) continue;
      facing = Math.abs(eye - v); axis = a; direction = sign; plane = candidate;
      offset = cargo && a !== 1 ? 0.084 : 0.013;
    }
  }
  if (axis === -1) return false;
  normal.set(0, 0, 0).setComponent(axis, direction);
  point.copy(hit).setComponent(axis, plane + direction * offset);
  return true;
}

const tmpColor = new THREE.Color();

/** Soft four-point flare; transparent corners keep the billboard invisible. */
function flareMap(softHalo: boolean): THREE.DataTexture {
  const side = 48;
  const pixels = new Uint8Array(side * side * 4);
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
    const u = Math.abs((x + 0.5) / side * 2 - 1), v = Math.abs((y + 0.5) / side * 2 - 1);
    const radius = Math.hypot(u, v);
    const core = Math.max(0, 1 - radius * 2.2) ** 2;
    const halo = softHalo ? 0.26 * Math.max(0, 1 - radius * 1.18) ** 2 : 0;
    const ray = Math.max(0, 1 - u - v) ** 1.8 * Math.exp(-Math.min(u, v) * 25);
    const p = (y * side + x) * 4;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = 255;
    pixels[p + 3] = 255 * Math.min(1, core + ray * 0.8 + halo);
  }
  const map = new THREE.DataTexture(pixels, side, side);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

/** One reusable, depth-tested billboard; player and NPCs use separate scenes. */
export class MuzzleFlash {
  private readonly sprite: THREE.Sprite;
  private life = 0;
  private source?: THREE.Object3D;

  constructor(scene: THREE.Scene, softHalo = false) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      color: new THREE.Color(C.flash).multiplyScalar(3.4),
      map: flareMap(softHalo),
      rotation: Math.PI / 8,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }));
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  show(position: THREE.Vector3, size: number, source?: THREE.Object3D): void {
    this.source = source;
    this.sprite.position.copy(position);
    this.track();
    this.sprite.material.opacity = 1;
    this.sprite.scale.set(size, size, 1);
    this.life = FLASH_LIFE;
    this.sprite.visible = true;
  }

  update(dt: number): void {
    if (!this.life) return;
    this.life = Math.max(0, this.life - dt);
    if (!this.life || this.source?.parent?.visible === false) { this.hide(); return; }
    this.track();
    this.sprite.material.opacity = this.life / FLASH_LIFE;
  }

  hide(): void {
    this.life = 0;
    this.source = undefined;
    this.sprite.visible = false;
  }

  dispose(): void {
    this.hide();
    this.sprite.removeFromParent();
    this.sprite.material.map?.dispose();
    this.sprite.material.dispose();
  }

  private track(): void {
    if (this.source) this.sprite.position.set(0, 0, -FLASH_LEAD).applyMatrix4(this.source.matrixWorld);
  }
}

export class FxPool {
  private readonly tracerLines: THREE.LineSegments;
  private readonly tracerPos: Float32Array;
  private readonly tracerCol: Float32Array;
  private readonly tracerBase: Float32Array;
  private readonly tracerLife = new Float32Array(MAX_TRACERS);
  private tracerCursor = 0;
  private readonly tracerSources: (THREE.Object3D | undefined)[] = Array(MAX_TRACERS);

  private readonly sparks: THREE.Points;
  private readonly sparkPos: Float32Array;
  private readonly sparkCol: Float32Array;
  private readonly sparkVel: Float32Array;
  private readonly sparkBase: Float32Array;
  private readonly sparkLife = new Float32Array(MAX_SPARKS);
  private readonly sparkMaxLife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;

  private readonly flash: MuzzleFlash;
  private readonly socketPosition = new THREE.Vector3();

  private budget: number;

  constructor(scene: THREE.Scene, budget: number) {
    this.budget = Math.max(1, Math.min(budget, MAX_SPARKS));

    // --- tracers ----------------------------------------------------------
    this.tracerPos = new Float32Array(MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(MAX_TRACERS * 6);
    this.tracerBase = new Float32Array(MAX_TRACERS * 3);
    const tracerGeom = new THREE.BufferGeometry();
    tracerGeom.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    tracerGeom.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3));
    const tracerMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.tracerLines = new THREE.LineSegments(tracerGeom, tracerMat);
    this.tracerLines.frustumCulled = false;
    this.tracerLines.visible = false;
    scene.add(this.tracerLines);

    // --- sparks -----------------------------------------------------------
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    this.sparkVel = new Float32Array(MAX_SPARKS * 3);
    this.sparkBase = new Float32Array(MAX_SPARKS * 3);
    const sparkGeom = new THREE.BufferGeometry();
    sparkGeom.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sparkGeom.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    sparkGeom.setDrawRange(0, this.budget);
    const sparkMat = new THREE.PointsMaterial({
      size: 0.055,
      sizeAttenuation: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.sparks = new THREE.Points(sparkGeom, sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.visible = false;
    scene.add(this.sparks);

    this.flash = new MuzzleFlash(scene);
  }

  /** Flash quad at a world position; `size` (metres) is per weapon, the shotgun's is the largest. */
  muzzle(worldPos: THREE.Vector3, size = 0.24, source?: THREE.Object3D): void {
    this.flash.show(worldPos, size, source);
  }

  /** One additive beam segment from `from` to `to`. */
  tracer(from: THREE.Vector3, to: THREE.Vector3, source?: THREE.Object3D): void {
    const slot = this.tracerCursor;
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const p = slot * 6;
    this.tracerSources[slot] = source;
    this.tracerPos[p] = from.x;
    this.tracerPos[p + 1] = from.y;
    this.tracerPos[p + 2] = from.z;
    this.tracerPos[p + 3] = to.x;
    this.tracerPos[p + 4] = to.y;
    this.tracerPos[p + 5] = to.z;
    tmpColor.setHex(C.tracer);
    const c = slot * 3;
    this.tracerBase[c] = tmpColor.r;
    this.tracerBase[c + 1] = tmpColor.g;
    this.tracerBase[c + 2] = tmpColor.b;
    this.tracerCol[c] = tmpColor.r;
    this.tracerCol[c + 1] = tmpColor.g;
    this.tracerCol[c + 2] = tmpColor.b;
    this.tracerLife[slot] = TRACER_LIFE;
    this.tracerLines.visible = true;
    this.markTracersDirty();
  }

  /** Small impact spark puff at a world position. */
  impact(pos: THREE.Vector3, colour: number): void {
    this.spawnSparks(pos, 8, colour, 2.2);
  }

  /** Death explosion: `count` radial sparks around a world position. */
  burst(pos: THREE.Vector3, count: number, colour: number): void {
    this.spawnSparks(pos, count, colour, 5.5);
  }

  /** Advances all effects. `dt` in seconds. */
  update(dt: number): void {
    // tracers fade out
    let anyTracer = false;
    let tracersTouched = false;
    for (let i = 0; i < MAX_TRACERS; i += 1) {
      if (this.tracerLife[i] <= 0) continue;
      tracersTouched = true;
      this.tracerLife[i] -= dt;
      const f = Math.max(this.tracerLife[i], 0) / TRACER_LIFE;
      const c = i * 3;
      this.tracerCol[c] = this.tracerBase[c] * f;
      this.tracerCol[c + 1] = this.tracerBase[c + 1] * f;
      this.tracerCol[c + 2] = this.tracerBase[c + 2] * f;
      if (this.tracerLife[i] > 0) {
        anyTracer = true;
        const source = this.tracerSources[i];
        if (source) {
          this.socketPosition.setFromMatrixPosition(source.matrixWorld);
          this.socketPosition.toArray(this.tracerPos, i * 6);
        }
      } else this.tracerSources[i] = undefined;
    }
    this.tracerLines.visible = anyTracer;
    if (tracersTouched) this.markTracersDirty();

    // sparks integrate + fade
    let anySpark = false;
    let sparksTouched = false;
    for (let i = 0; i < this.budget; i += 1) {
      if (this.sparkLife[i] <= 0) continue;
      sparksTouched = true;
      this.sparkLife[i] -= dt;
      const p = i * 3;
      if (this.sparkLife[i] <= 0) {
        this.sparkCol[p] = 0;
        this.sparkCol[p + 1] = 0;
        this.sparkCol[p + 2] = 0;
        continue;
      }
      this.sparkVel[p + 1] += SPARK_GRAVITY * dt;
      this.sparkPos[p] += this.sparkVel[p] * dt;
      this.sparkPos[p + 1] += this.sparkVel[p + 1] * dt;
      this.sparkPos[p + 2] += this.sparkVel[p + 2] * dt;
      const f = this.sparkLife[i] / this.sparkMaxLife[i];
      this.sparkCol[p] = this.sparkBase[p] * f;
      this.sparkCol[p + 1] = this.sparkBase[p + 1] * f;
      this.sparkCol[p + 2] = this.sparkBase[p + 2] * f;
      anySpark = true;
    }
    this.sparks.visible = anySpark;
    if (sparksTouched) this.markSparksDirty();

    this.flash.update(dt);
  }

  /** Concurrent spark budget (quality presets may lower it at runtime). */
  setBudget(budget: number): void {
    this.budget = Math.max(1, Math.min(Math.floor(budget), MAX_SPARKS));
    this.sparks.geometry.setDrawRange(0, this.budget);
  }

  dispose(): void {
    this.tracerLines.removeFromParent();
    this.tracerLines.geometry.dispose();
    (this.tracerLines.material as THREE.Material).dispose();
    this.sparks.removeFromParent();
    this.sparks.geometry.dispose();
    (this.sparks.material as THREE.Material).dispose();
    this.flash.dispose();
  }

  private markTracersDirty(): void {
    (this.tracerLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerLines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private markSparksDirty(): void {
    (this.sparks.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  private spawnSparks(pos: THREE.Vector3, count: number, colour: number, speed: number): void {
    tmpColor.setHex(colour);
    const n = Math.min(Math.max(count, 1), this.budget);
    for (let k = 0; k < n; k += 1) {
      const i = this.sparkCursor;
      this.sparkCursor = (this.sparkCursor + 1) % this.budget;
      const p = i * 3;
      this.sparkPos[p] = pos.x;
      this.sparkPos[p + 1] = pos.y;
      this.sparkPos[p + 2] = pos.z;
      // random radial direction with an upward bias
      const theta = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.1;
      const v = speed * (0.4 + Math.random() * 0.6);
      const horiz = Math.sqrt(Math.max(1 - up * up, 0.01));
      this.sparkVel[p] = Math.cos(theta) * horiz * v;
      this.sparkVel[p + 1] = up * v;
      this.sparkVel[p + 2] = Math.sin(theta) * horiz * v;
      const life = 0.25 + Math.random() * 0.3;
      this.sparkLife[i] = life;
      this.sparkMaxLife[i] = life;
      this.sparkBase[p] = tmpColor.r;
      this.sparkBase[p + 1] = tmpColor.g;
      this.sparkBase[p + 2] = tmpColor.b;
      this.sparkCol[p] = tmpColor.r;
      this.sparkCol[p + 1] = tmpColor.g;
      this.sparkCol[p + 2] = tmpColor.b;
    }
    this.markSparksDirty();
    this.sparks.visible = true;
  }
}
