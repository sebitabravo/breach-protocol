import * as THREE from 'three';

export const FEEDBACK_CAP = { impacts: 40, casings: 16, smoke: 4, pulse: 3 } as const;
const PUFF_LIFE = 0.43, PULSE_LIFE = 0.65, CASE_LIFE = 1.04;
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);
const PUFF_START = FEEDBACK_CAP.impacts, PULSE_START = PUFF_START + FEEDBACK_CAP.smoke;
const FLASH_SLOT = PULSE_START + FEEDBACK_CAP.pulse;
const TRACE_SLOT = FLASH_SLOT + 1, TOTAL = TRACE_SLOT + 1;

/** Two bounded draws for all new feedback. Cards are depth-tested and share one procedural shader. */
export class FeedbackFx {
  private readonly cards: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly parameters = new THREE.InstancedBufferAttribute(new Float32Array(TOTAL * 2), 2).setUsage(THREE.DynamicDrawUsage);
  private readonly cases: THREE.InstancedMesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  private readonly light = new THREE.PointLight(0x5ce08b, 0, 5.2, 2);
  private readonly progress = new Float32Array(TOTAL);
  private readonly positions = Array.from({ length: TOTAL }, () => new THREE.Vector3());
  private readonly caseState = Array.from({ length: FEEDBACK_CAP.casings }, () => ({
    position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, floor: 0, bounced: false, scale: 1,
  }));
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Quaternion();
  private readonly turn = new THREE.Quaternion();
  private readonly angle = new THREE.Euler();
  private readonly traceX = new THREE.Vector3();
  private readonly traceY = new THREE.Vector3();
  private readonly traceZ = new THREE.Vector3();
  private readonly traceBasis = new THREE.Matrix4();
  private flashSource?: THREE.Object3D;
  private flashSize = 0;
  private readonly size = new THREE.Vector3();
  private readonly dirty = new THREE.Vector3();
  private impactCursor = 0;
  private smokeCursor = 0;
  private pulseCursor = 0;
  private caseCursor = 0;
  private heat = 0;
  private smokeCooldown = 0;
  private pulseLight = 0;

  constructor(scene: THREE.Scene) {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.setAttribute('aCue', this.parameters);
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      vertexShader: `
        attribute vec2 aCue;
        flat varying vec2 vCue;
        varying vec2 vUv;
        void main() {
          vCue = aCue; vUv = uv * 2.0 - 1.0;
          gl_Position = aCue.y <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0)
            : projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        flat varying vec2 vCue;
        varying vec2 vUv;
        float noise(vec2 p) { return fract(sin(dot(p, vec2(81.2, 257.7))) * 25712.3); }
        void main() {
          float r = length(vUv), alpha;
          vec3 colour;
          if (vCue.x < 0.5) {
            float grain = noise(floor(vUv * 23.0));
            float edge = r + (grain - 0.5) * 0.17;
            float core = 1.0 - smoothstep(0.18, 0.73, edge);
            float chip = smoothstep(0.27, 0.39, r) * (1.0 - smoothstep(0.46, 0.59, r));
            colour = mix(vec3(0.005, 0.008, 0.010), vec3(0.56, 0.52, 0.42), chip * clamp(0.15 - vUv.y * 1.3, 0.0, 1.0) * (0.55 + grain));
            alpha = max(core, chip * 0.43) * (0.72 + grain * 0.26);
          } else if (vCue.x < 1.5) {
            float wiggle = sin(vUv.y * 32.0 + vCue.y * 17.0 + vUv.x * 4.0);
            float body = max(0.0, 1.0 - length(vec2(vUv.x * 1.06 + wiggle * 0.063, vUv.y)));
            colour = mix(vec3(0.16, 0.185, 0.20), vec3(0.47, 0.50, 0.51), 0.5 + wiggle * 0.22);
            alpha = body * body * vCue.y * (0.64 + 0.18 * wiggle);
          } else if (vCue.x < 2.5) {
            float rim = 1.0 - smoothstep(0.014, 0.11, abs(r - 0.83));
            float echo = 1.0 - smoothstep(0.007, 0.05, abs(r - 0.64));
            colour = vec3(0.21, 1.35, 0.55);
            alpha = (rim + echo * 0.38) * vCue.y;
          } else if (vCue.x < 3.5) {
            vec2 p = abs(vUv);
            float core = max(0.0, 1.0 - r * 2.0);
            float spike = pow(max(0.0, 1.0 - p.x - p.y), 1.8) * exp(-min(p.x, p.y) * 22.0);
            colour = vec3(3.0, 1.76, 0.82);
            alpha = (core * core + spike * 0.77) * vCue.y;
          } else {
            colour = vec3(0.72, 1.25, 0.98);
            alpha = (1.0 - smoothstep(0.12, 1.0, abs(vUv.x))) * (0.65 + vUv.y * 0.23) * vCue.y;
          }
          if (alpha < 0.007) discard;
          gl_FragColor = vec4(colour, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.cards = new THREE.InstancedMesh(plane, material, TOTAL);
    this.cases = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.021, 0.024, 0.088, 6, 1),
      new THREE.MeshStandardMaterial({ color: 0xc68a43, roughness: 0.42, metalness: 0.44, emissive: 0x5c3210, emissiveIntensity: 0.38 }), FEEDBACK_CAP.casings);
    this.cards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cases.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cards.frustumCulled = this.cases.frustumCulled = false;
    this.cards.visible = this.cases.visible = false;
    this.cards.name = 'feedback: decals / smoke / pulse';
    this.cases.name = 'feedback: casings';
    this.cases.count = 0;
    scene.add(this.cards, this.cases, this.light);
  }

  mark(position: THREE.Vector3, normal: THREE.Vector3): void {
    const slot = this.impactCursor++ % FEEDBACK_CAP.impacts;
    this.rotation.setFromUnitVectors(FRONT, normal);
    this.turn.setFromAxisAngle(FRONT, slot * 2.39996);
    this.rotation.multiply(this.turn);
    const size = 0.21 + (slot % 4) * 0.009;
    this.card(slot, position, size, size, 0, 1);
  }

  eject(position: THREE.Vector3, velocity: THREE.Vector3, floor: number, large: boolean): void {
    const casing = this.caseState[this.caseCursor++ % FEEDBACK_CAP.casings];
    casing.position.copy(position);
    casing.velocity.copy(velocity);
    casing.life = CASE_LIFE;
    casing.floor = floor + 0.026;
    casing.scale = large ? 1.45 : 1;
    casing.bounced = false;
    this.writeCases();
  }

  shot(muzzle: THREE.Vector3, camera: THREE.Camera, reduced: boolean): void {
    this.heat = Math.min(1.2, this.heat + 0.38);
    if (reduced || this.heat < 0.78 || this.smokeCooldown > 0) return;
    this.smokeCooldown = 0.21;
    const slot = PUFF_START + this.smokeCursor++ % FEEDBACK_CAP.smoke;
    this.positions[slot].copy(muzzle).addScaledVector(UP, 0.041);
    this.progress[slot] = PUFF_LIFE;
    this.rotation.copy(camera.quaternion);
    this.card(slot, this.positions[slot], 0.18, 0.24, 1, 1);
  }

  pulse(x: number, y: number, z: number, reduced: boolean): void {
    if (reduced) return;
    const slot = PULSE_START + this.pulseCursor++ % FEEDBACK_CAP.pulse;
    this.positions[slot].set(x, y + 0.037, z);
    this.progress[slot] = PULSE_LIFE;
    this.rotation.setFromAxisAngle(AXIS_X, -Math.PI / 2);
    this.card(slot, this.positions[slot], 1.65, 1.65, 2, 1);
    this.light.position.set(x, y + 1.48, z);
    this.light.intensity = 17;
    this.pulseLight = 0.28;
  }

  /** Medium and low use the existing card draw for the shortest-lived shot cues. */
  flash(position: THREE.Vector3, size: number, camera: THREE.Camera, source?: THREE.Object3D): void {
    this.flashSource = source;
    this.flashSize = size;
    this.progress[FLASH_SLOT] = 0.06;
    this.positions[FLASH_SLOT].copy(position);
    this.writeFlash(camera);
  }

  trace(from: THREE.Vector3, to: THREE.Vector3, camera: THREE.Camera): void {
    this.traceY.subVectors(to, from);
    const length = this.traceY.length();
    if (length < 0.01) return;
    this.traceY.multiplyScalar(1 / length);
    const center = this.positions[TRACE_SLOT].copy(from).lerp(to, 0.5);
    this.traceZ.subVectors(camera.position, center);
    this.traceX.crossVectors(this.traceY, this.traceZ).normalize();
    this.traceZ.crossVectors(this.traceX, this.traceY);
    this.rotation.setFromRotationMatrix(this.traceBasis.makeBasis(this.traceX, this.traceY, this.traceZ));
    this.progress[TRACE_SLOT] = 0.055;
    this.card(TRACE_SLOT, center, 0.024, length, 4, 0.86);
  }

  update(dt: number, camera: THREE.Camera, reduced: boolean): void {
    this.heat = Math.max(0, this.heat - dt * 1.11);
    this.smokeCooldown -= dt;
    this.pulseLight = reduced ? 0 : Math.max(0, this.pulseLight - dt);
    this.light.intensity = 17 * (this.pulseLight / 0.28) ** 2;
    let active = this.impactCursor > 0;
    for (let i = PUFF_START; i < TOTAL; i += 1) {
      if (this.progress[i] <= 0) continue;
      const left = this.progress[i] = reduced && i < FLASH_SLOT ? 0 : Math.max(0, this.progress[i] - dt);
      if (!left) {
        this.parameters.setY(i, 0);
        this.parameters.needsUpdate = true;
        continue;
      }
      active = true;
      if (i < PULSE_START) {
        const f = left / PUFF_LIFE;
        this.positions[i].y += dt * 0.33;
        this.rotation.copy(camera.quaternion);
        this.card(i, this.positions[i], 0.48 - 0.30 * f, 0.61 - 0.37 * f, 1, f * f);
      } else if (i < FLASH_SLOT) {
        const f = left / PULSE_LIFE;
        this.rotation.setFromAxisAngle(AXIS_X, -Math.PI / 2);
        const size = 8.4 - 6.75 * f;
        this.card(i, this.positions[i], size, size, 2, f);
      } else if (i === FLASH_SLOT) this.writeFlash(camera);
      else {
        this.parameters.setY(i, left / 0.055);
        this.parameters.needsUpdate = true;
      }
    }
    this.cards.visible = active;
    if (!this.cases.visible) return;
    for (const casing of this.caseState) {
      if (casing.life <= 0) continue;
      casing.life -= dt;
      casing.velocity.y -= dt * 17;
      casing.position.addScaledVector(casing.velocity, dt);
      if (casing.position.y < casing.floor) {
        casing.position.y = casing.floor;
        if (!casing.bounced) {
          casing.bounced = true;
          casing.velocity.multiplyScalar(0.43);
          casing.velocity.y *= -0.66;
        } else casing.velocity.set(0, 0, 0);
      }
    }
    this.writeCases();
  }

  reset(): void {
    this.impactCursor = this.caseCursor = this.smokeCursor = this.pulseCursor = 0;
    this.heat = this.smokeCooldown = this.pulseLight = this.light.intensity = 0;
    this.flashSource = undefined;
    this.progress.fill(0);
    this.parameters.array.fill(0);
    this.parameters.needsUpdate = true;
    for (const casing of this.caseState) casing.life = 0;
    this.cards.visible = this.cases.visible = false;
  }

  dispose(): void {
    this.cards.removeFromParent(); this.cases.removeFromParent(); this.light.removeFromParent();
    this.cards.dispose(); this.cases.dispose();
    this.cards.geometry.dispose(); this.cases.geometry.dispose();
    this.cards.material.dispose(); this.cases.material.dispose();
  }

  private writeFlash(camera: THREE.Camera): void {
    const p = this.positions[FLASH_SLOT];
    if (this.flashSource) p.set(0, 0, -0.039).applyMatrix4(this.flashSource.matrixWorld);
    this.rotation.copy(camera.quaternion);
    this.card(FLASH_SLOT, p, this.flashSize, this.flashSize, 3, this.progress[FLASH_SLOT] / 0.06);
  }

  private card(slot: number, position: THREE.Vector3, x: number, y: number, mode: number, alpha: number): void {
    this.matrix.compose(position, this.rotation, this.size.set(x, y, 1));
    this.cards.setMatrixAt(slot, this.matrix);
    this.cards.instanceMatrix.needsUpdate = true;
    this.parameters.setXY(slot, mode, alpha);
    this.parameters.needsUpdate = true;
    this.cards.visible = true;
  }

  private writeCases(): void {
    let count = 0;
    for (const casing of this.caseState) {
      if (casing.life <= 0) continue;
      this.dirty.copy(casing.position);
      const time = CASE_LIFE - casing.life;
      if (casing.bounced && casing.velocity.lengthSq() === 0) this.angle.set(0, 0.8 + count * 0.7, Math.PI / 2);
      else this.angle.set(time * 19, time * 11, 0.46 + time * 22);
      this.rotation.setFromEuler(this.angle);
      this.size.setScalar(casing.scale * Math.min(1, casing.life * 9));
      this.matrix.compose(this.dirty, this.rotation, this.size);
      this.cases.setMatrixAt(count++, this.matrix);
    }
    this.cases.count = count;
    this.cases.visible = count > 0;
    this.cases.instanceMatrix.needsUpdate = true;
  }
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
