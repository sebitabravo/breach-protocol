/**
 * Lab de render (solo desarrollo). Instancia robots y viewmodels directamente en
 * una escena para verlos sin una partida. No se importa desde index.html ni
 * desde src/: el build de producción no lo incluye.
 *
 *   ?view=robots          tres tipos de robot con sus telegrafías
 *   ?view=weapon&id=1|2|3 un viewmodel a la vez (PB-01, AR-04, SG-08)
 */
import * as THREE from 'three';
import type { Snapshot } from '../../src/wasm/bridge';
import { MAX_ENEMIES } from '../../src/wasm/bridge';
import { EnemyPool } from '../../src/render/enemies';
import { PostFx } from '../../src/render/postfx';
import { Viewmodel } from '../../src/render/viewmodel';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { E, ENEMY_BASE, ENEMY_KIND, ENEMY_STATE, ENEMY_STRIDE, H, SNAPSHOT_LEN } from '../../src/wasm/protocol';

const LAB_MARKER = 'bp-lab-7f3a';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('lab') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070d12);
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(new THREE.HemisphereLight(0xdfe4e8, 0x2a3036, 3.75));
const sun = new THREE.DirectionalLight(0xe6ecf2, 3.2);
sun.position.set(8, 14, 6);
scene.add(sun);

const post = new PostFx(renderer, scene, camera);
post.configure('medium', 1, window.innerWidth, window.innerHeight);

function fakeState(input: Record<string, number | boolean>, slots: Record<string, number>[] = [], player = { px: 0, py: 0, pz: 0 }): Snapshot {
  const f = new Float32Array(SNAPSHOT_LEN);
  for (let i = 0; i < MAX_ENEMIES; i += 1) f[ENEMY_BASE + i * ENEMY_STRIDE + E.state] = ENEMY_STATE.dead;
  for (const s of slots) {
    const base = ENEMY_BASE + (s.slot as number) * ENEMY_STRIDE;
    f[base + E.x] = s.x;
    f[base + E.y] = s.y;
    f[base + E.z] = s.z;
    f[base + E.yaw] = s.yaw ?? 0;
    f[base + E.state] = s.state;
    f[base + E.kind] = s.kind;
    f[base + E.anim] = 0;
  }
  f[H.px] = player.px;
  f[H.py] = player.py;
  f[H.pz] = player.pz;
  return { float: f, px: player.px, py: player.py, pz: player.pz, ...input } as unknown as Snapshot;
}

function floor(z: number): void {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x10171d }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(0, 0, z);
  scene.add(plane);
}

function robotsView(): void {
  floor(-6);
  camera.position.set(0, 1.6, 4);
  camera.lookAt(0, 1.1, -6);
  const pool = new EnemyPool(scene);
  const player = { px: 0, py: 0, pz: 4 };
  const slots = [
    { slot: 0, x: -6, y: 0, z: -6, yaw: 0, state: ENEMY_STATE.chase, kind: ENEMY_KIND.scout },
    { slot: 1, x: -3, y: 0, z: -6, yaw: 0, state: ENEMY_STATE.aim, kind: ENEMY_KIND.scout },
    { slot: 2, x: 0, y: 0, z: -6, yaw: 0, state: ENEMY_STATE.aim, kind: ENEMY_KIND.sentinel },
    { slot: 3, x: 3, y: 0, z: -6, yaw: 0, state: ENEMY_STATE.charge, kind: ENEMY_KIND.interceptor },
    { slot: 4, x: 6.5, y: 0, z: -6, yaw: 0, state: ENEMY_STATE.flank, kind: ENEMY_KIND.interceptor },
  ];
  pool.update(fakeState({}, slots, player), false, camera, 0);
  post.render();
}

function weaponView(id: number): void {
  const vm = new Viewmodel(camera);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -1);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshLambertMaterial({ color: 0x1e2833 }));
  wall.position.set(0, 0, -6);
  scene.add(wall);
  const vmLight = new THREE.PointLight(0xdfeaf2, 2.2, 2.2, 2);
  vmLight.position.set(0.3, 0.15, 0.25);
  camera.add(vmLight);
  vm.update(fakeState({ weapon: id, ads: 0, recoilPitch: 0, reloading: false, reloadProgress: 0 }), 1 / 60, 0);
  camera.updateMatrixWorld(true);
  post.render();
}

/** Robots con luz de partida (ACES + entorno PMREM) y poses distintas: caminata, apuntar, embestida y caída. */
function rigView(): void {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  scene.background = new THREE.Color(0x0a1218);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;
  const cyan = new THREE.PointLight(0x4de3c6, 6, 12, 2);
  cyan.position.set(-2, 3.2, -3);
  scene.add(cyan);
  floor(-6);
  const near = Number(params.get('near') ?? 0);
  camera.position.set(0, 1.35, near ? -1.2 : 4);
  camera.lookAt(0, 1.0, -6);
  const pool = new EnemyPool(scene);
  const player = { px: 0, py: 0, pz: 4 };
  const yaw = Math.PI * Number(params.get('yaw') ?? 0);
  const base = [
    { slot: 0, x: -5.5, y: 0, z: -6, yaw, state: ENEMY_STATE.chase, kind: ENEMY_KIND.scout },
    { slot: 1, x: -2.8, y: 0, z: -6, yaw, state: ENEMY_STATE.aim, kind: ENEMY_KIND.scout },
    { slot: 2, x: 0, y: 0, z: -6, yaw, state: ENEMY_STATE.aim, kind: ENEMY_KIND.sentinel },
    { slot: 3, x: 2.8, y: 0, z: -6, yaw, state: ENEMY_STATE.chase, kind: ENEMY_KIND.interceptor },
    { slot: 4, x: 5.6, y: 0, z: -6, yaw, state: ENEMY_STATE.charge, kind: ENEMY_KIND.interceptor },
  ];
  // Dos frames con desplazamiento: el pool mide la velocidad y arranca el ciclo de pasos.
  const step = (t: number) => base.map((s) => (s.state === ENEMY_STATE.chase ? { ...s, z: s.z + t * 3 } : s));
  for (let i = 0; i <= 12; i += 1) pool.update(fakeState({}, step(i / 60), player), false, camera, i / 60);
  post.render();
}

const view = params.get('view') ?? 'robots';
if (view === 'weapon') weaponView(Number(params.get('id') ?? 1));
else if (view === 'rig') rigView();
else robotsView();

console.info(LAB_MARKER, 'calls', renderer.info.render.calls);
(window as unknown as { __LAB_READY?: boolean }).__LAB_READY = true;
