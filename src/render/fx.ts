/**
 * Frame-rate friendly FX pool: one LineSegments batch for tracers, one Points
 * batch for sparks, one billboarded additive quad for the muzzle flash.
 * All buffers are preallocated; nothing is allocated per spawn call.
 */
import * as THREE from 'three';

const MAX_TRACERS = 64;
const MAX_SPARKS = 1024;
const TRACER_LIFE = 0.09;
const FLASH_LIFE = 0.06;
const SPARK_GRAVITY = -14;

/** tokens.css palette (hex int form for three.js). */
const C = {
  accent: 0x4de3c6,
  tracer: 0xbfffe0,
  flash: 0xd9ffe9,
} as const;

const tmpColor = new THREE.Color();

export class FxPool {
  private readonly tracerLines: THREE.LineSegments;
  private readonly tracerPos: Float32Array;
  private readonly tracerCol: Float32Array;
  private readonly tracerBase: Float32Array;
  private readonly tracerLife = new Float32Array(MAX_TRACERS);
  private tracerCursor = 0;

  private readonly sparks: THREE.Points;
  private readonly sparkPos: Float32Array;
  private readonly sparkCol: Float32Array;
  private readonly sparkVel: Float32Array;
  private readonly sparkBase: Float32Array;
  private readonly sparkLife = new Float32Array(MAX_SPARKS);
  private readonly sparkMaxLife = new Float32Array(MAX_SPARKS);
  private sparkCursor = 0;

  private readonly flash: THREE.Sprite;
  private flashLife = 0;

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

    // --- muzzle flash (billboarded additive quad) -------------------------
    const flashMat = new THREE.SpriteMaterial({
      color: C.flash,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.scale.set(0.3, 0.3, 1);
    this.flash.visible = false;
    scene.add(this.flash);
  }

  /** Flash quad at a world position; also usable for enemy muzzle blazes. */
  muzzle(worldPos: THREE.Vector3): void {
    this.flash.position.copy(worldPos);
    const s = 0.24 + Math.random() * 0.12;
    this.flash.scale.set(s, s, 1);
    this.flashLife = FLASH_LIFE;
    this.flash.visible = true;
  }

  /** One additive beam segment from `from` to `to`. */
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const slot = this.tracerCursor;
    this.tracerCursor = (this.tracerCursor + 1) % MAX_TRACERS;
    const p = slot * 6;
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
      if (this.tracerLife[i] > 0) anyTracer = true;
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

    // muzzle flash decay
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.flash.visible = false;
      } else {
        const mat = this.flash.material;
        mat.opacity = Math.max(this.flashLife / FLASH_LIFE, 0);
      }
    }
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
    this.flash.removeFromParent();
    (this.flash.material as THREE.SpriteMaterial).dispose();
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
