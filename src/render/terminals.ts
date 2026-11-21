import * as THREE from 'three';
import type { Snapshot } from '../wasm/bridge';
import type { MapData } from '../world/map';
import type { MeshBuilder } from './geometry';
import { objectiveOccluded } from './objective-beacon';
import { SURFACE } from './surfaces';
import { buildConsoleHousing, buildConsoleInstruments, CONSOLE_ROLE, consoleYaw, ROTOR_PIVOT, SCREEN_SAMPLE } from './terminal-model';
import { DISPLAY_HEIGHT, DISPLAY_ROW, DISPLAY_WIDTH, paintStencil, paintTerminalScreen, STENCIL_HEIGHT, TERMINAL_MODE } from './terminal-screen';

const INTERVAL = 0.1;
const FLASH_TIME = 0.26;
const SPIN_TIME = 0.74;

export class TerminalConsoles {
  readonly batch: THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly atlas: THREE.CanvasTexture | null;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly live: THREE.InstancedBufferAttribute;
  private readonly displays: { sample: THREE.Vector3; normal: THREE.Vector3; left: THREE.Vector3; right: THREE.Vector3;
    bounds: THREE.Sphere; painted: number; active: boolean; activation: number; angle: number }[];
  private readonly frustum = new THREE.Frustum();
  private readonly projection = new THREE.Matrix4();
  private readonly eyeRay = new THREE.Vector3();
  private nextPaint = 0;

  constructor(private readonly map: MapData, lit: MeshBuilder) {
    const canvas = typeof document === 'undefined' ? null : document.createElement('canvas');
    if (canvas) { canvas.width = DISPLAY_WIDTH; canvas.height = DISPLAY_ROW * Math.max(1, map.nodes.length); }
    this.context = canvas?.getContext('2d') ?? null;
    this.atlas = canvas ? new THREE.CanvasTexture(canvas) : null;
    if (this.atlas) {
      this.atlas.colorSpace = THREE.SRGBColorSpace;
      this.atlas.generateMipmaps = false;
      this.atlas.minFilter = THREE.LinearFilter;
    }
    this.live = new THREE.InstancedBufferAttribute(new Float32Array(map.nodes.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const geometry = buildConsoleInstruments();
    geometry.setAttribute('aLive', this.live);
    this.batch = new THREE.InstancedMesh(geometry, instrumentMaterial(this.atlas, map.nodes.length), map.nodes.length);
    const matrix = new THREE.Matrix4();
    const [metal, concrete] = buildConsoleHousing();
    this.displays = map.nodes.map(({ x, y, z }, index) => {
      matrix.makeRotationY(consoleYaw(x, z)).setPosition(x, y, z);
      this.batch.setMatrixAt(index, matrix);
      // Stamp the same PBR template into the existing metal/concrete draws and static shadow pass.
      for (const [source, surface] of [[metal, SURFACE.metal], [concrete, SURFACE.concrete]] as const) {
        const placed = source.clone().applyMatrix4(matrix);
        lit.addGeometry(placed, [1, 1, 1], surface, undefined, true, true);
        placed.dispose();
      }
      if (this.context) paintStencil(this.context, index);
      const sample = SCREEN_SAMPLE.clone().applyMatrix4(matrix);
      const side = new THREE.Vector3(1, 0, 0).transformDirection(matrix).multiplyScalar(0.43);
      return { sample, normal: new THREE.Vector3(0, 0.19, 0.982).transformDirection(matrix),
        left: sample.clone().sub(side), right: sample.clone().add(side), bounds: new THREE.Sphere(sample, 0.64),
        painted: -1, active: false, activation: -Infinity, angle: index * 0.97 };
    });
    metal.dispose();
    concrete.dispose();
  }

  update(camera: THREE.PerspectiveCamera, seconds: number, dt: number, reducedMotion: boolean,
    state?: Pick<Snapshot, 'node'>, tracked = -1): void {
    const wantsPaint = !!this.context && seconds >= this.nextPaint;
    if (wantsPaint) this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let painted = false, changed = false;
    this.batch.material.uniforms.uPulse.value = reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(seconds * 8);
    for (let i = 0; i < this.displays.length; i += 1) {
      const display = this.displays[i];
      const node = state?.node(i);
      const active = node?.active ?? display.active;
      const progress = active ? 1 : node?.progress ?? this.live.getY(i);
      const mode = active ? TERMINAL_MODE.active : progress > 0 ? TERMINAL_MODE.channeling : TERMINAL_MODE.idle;
      if (active && !display.active) display.activation = seconds;
      display.active = active;
      const age = seconds - display.activation;
      const flash = reducedMotion || !active ? 0 : Math.max(0, 1 - age / FLASH_TIME) ** 2;
      if (!reducedMotion) {
        const spin = active ? (age < SPIN_TIME ? 2.2 + 17 * Math.sin(Math.PI * age / SPIN_TIME) + 5 * (1 - age / SPIN_TIME) : 0)
          : mode === TERMINAL_MODE.channeling ? 2.2 + progress * 5 : 1.35;
        display.angle = (display.angle + spin * Math.min(dt, 0.06)) % (Math.PI * 2);
      }
      if (mode !== this.live.getX(i) || progress !== this.live.getY(i)
        || Math.fround(flash) !== this.live.getZ(i) || Math.fround(display.angle) !== this.live.getW(i)) {
        this.live.setXYZW(i, mode, progress, flash, display.angle);
        changed = true;
      }
      const screenKey = mode === TERMINAL_MODE.channeling ? 3 + Math.ceil(progress * 100) : mode;
      if (wantsPaint && screenKey !== display.painted && (tracked === i || this.screenVisible(display, camera))) {
        paintTerminalScreen(this.context!, i, mode, progress, reducedMotion);
        display.painted = screenKey;
        painted = true;
      }
    }
    if (changed) this.live.needsUpdate = true;
    if (painted) {
      this.nextPaint = seconds + INTERVAL;
      this.atlas!.needsUpdate = true;
    }
  }

  dispose(): void {
    this.batch.removeFromParent();
    this.batch.dispose();
    this.batch.geometry.dispose();
    this.batch.material.dispose();
    this.atlas?.dispose();
  }

  private screenVisible(display: TerminalConsoles['displays'][number], camera: THREE.PerspectiveCamera): boolean {
    return this.frustum.intersectsSphere(display.bounds)
      && this.eyeRay.subVectors(camera.position, display.sample).dot(display.normal) > 0
      && (!objectiveOccluded(this.map.solids, camera.position, display.sample)
        || !objectiveOccluded(this.map.solids, camera.position, display.left)
        || !objectiveOccluded(this.map.solids, camera.position, display.right));
  }
}

/** One program for the shared idle/channel/active palette. A state change is a
 * vec4 instance edit (mode, fill, flash, rotor angle), not a material swap. */
function instrumentMaterial(atlas: THREE.Texture | null, count: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    fog: true,
    vertexColors: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uAtlas: { value: atlas }, uCount: { value: Math.max(1, count) }, uPulse: { value: 1 },
      uRotor: { value: ROTOR_PIVOT }, uIdle: { value: new THREE.Color(0xeab066) },
      uMint: { value: new THREE.Color(0x75ffae) },
    },
    vertexShader: `
      #include <fog_pars_vertex>
      uniform vec3 uRotor;
      attribute vec4 aLive;
      attribute float aBlink;
      varying vec2 vUV;
      varying vec3 vTint;
      flat varying vec4 vLive;
      flat varying float vRole;
      flat varying float vInstance;
      void main() {
        vUV = uv;
        vTint = color;
        vRole = aBlink;
        vLive = aLive;
        vInstance = float(gl_InstanceID);
        vec3 p = position;
        if (aBlink == ${CONSOLE_ROLE.rotor}.0) {
          float c = cos(aLive.w), s = sin(aLive.w);
          p.xz = uRotor.xz + mat2(c, -s, s, c) * (p.xz - uRotor.xz);
        }
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform sampler2D uAtlas;
      uniform float uCount;
      uniform float uPulse;
      uniform vec3 uIdle;
      uniform vec3 uMint;
      varying vec2 vUV;
      varying vec3 vTint;
      flat varying vec4 vLive;
      flat varying float vRole;
      flat varying float vInstance;
      void main() {
        float mode = vLive.x, fill = vLive.y, flash = vLive.z;
        float pulse = mode == 1.0 ? uPulse : 1.0;
        vec3 color = mode == 0.0 ? uIdle : uMint;
        if (vRole < 2.5) {
          bool stencil = vRole > 1.5;
          float start = vInstance * ${DISPLAY_ROW}.0 + (stencil ? ${DISPLAY_HEIGHT}.0 : 0.0);
          float height = stencil ? ${STENCIL_HEIGHT}.0 : ${DISPLAY_HEIGHT}.0;
          float row = start + mix(height - 0.5, 0.5, vUV.y);
          vec4 ink = texture2D(uAtlas, vec2(vUV.x, 1.0 - row / (${DISPLAY_ROW}.0 * uCount)));
          if (stencil && ink.a < 0.34) discard;
          float sweep = 1.0 - smoothstep(0.0, 0.20, abs(vUV.y - sqrt(flash)));
          color = ink.rgb * (stencil ? 0.88 : 0.83 * pulse + flash * 0.6)
            + (stencil ? 0.0 : (0.13 + 0.3 * sweep) * flash);
        } else if (vRole < 3.5) {
          // Gaps are physical segments; the moving edge fills the current segment.
          float lit = mode == 0.0 ? (vUV.y < 0.11 ? 0.28 : 0.0) : step(vUV.y, fill) * pulse;
          color = mix(vec3(0.024, 0.033, 0.036), color * 0.94, lit);
        } else {
          color = vTint * color * (mode == 0.0 ? 0.53 : 0.88 * pulse + flash * 0.9);
        }
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
