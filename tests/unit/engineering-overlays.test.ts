/**
 * T5e: maquinaria de estados de los overlays de engineering mode.
 *
 * Cada overlay se enciende y apaga de forma independiente; con todos apagados
 * la escena queda EXACTAMENTE igual que el baseline (ni un objeto de más, y por
 * lo tanto ni un draw call de más). El modo telemetry apagado fuerza todo a
 * apagado. La medida imprime el baseline de objetos de la escena actual.
 */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DebugOverlays, type OverlayKey } from '../../src/render/renderer';

const KEYS: OverlayKey[] = ['bounds', 'collision', 'camera', 'passes'];

/** Bidón tipo Snapshot: `update` solo lee `float` (posiciones) y `interacting`. */
function fakeState(interacting = -1): unknown {
  const float = new Float32Array(4096);
  return { float, interacting, px: 2, py: 0, pz: 8, tick: 10 };
}

function childCount(scene: THREE.Scene): number {
  return scene.children.length;
}

describe('DebugOverlays: toggle state machine', () => {
  it('constructing adds nothing to the scene: the baseline object count is preserved', () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const baseline = childCount(scene);
    const debug = new DebugOverlays(scene);
    const after = childCount(scene);
    // Baseline impreso: objetos antes y después de crear la maquinaria.
    console.log(`[baseline] scene objects before=${baseline} after-construction=${after}`);
    expect(after).toBe(baseline);
    expect(debug.active).toBe(false);
  });

  it('each overlay toggles independently, and each adds its own scene objects or none', () => {
    const scene = new THREE.Scene();
    const baseline = childCount(scene);
    const debug = new DebugOverlays(scene);
    debug.setTelemetry(true);

    for (const key of KEYS) {
      debug.setOverlay(key, true);
      const withKey = childCount(scene);
      console.log(`[baseline] overlay=${key} on -> scene objects ${baseline} -> ${withKey}`);
      if (key === 'bounds') {
        expect(withKey).toBeGreaterThan(baseline); // rejilla + ejes + cajas
        expect(debug.group.visible).toBe(true);
      } else if (key === 'collision') {
        expect(withKey).toBeGreaterThan(baseline); // cápsula + radio
        expect(debug.group.visible).toBe(true);
      } else {
        // cámara y pases son lecturas del panel: cero objetos de escena.
        expect(withKey).toBe(baseline);
      }
      debug.setOverlay(key, false);
      expect(childCount(scene)).toBe(baseline);
    }
    expect(debug.active).toBe(false);
  });

  it('with every overlay off, after being on, the scene is byte-for-byte the baseline: zero added objects, zero added draws', () => {
    const scene = new THREE.Scene();
    const baseline = childCount(scene);
    const debug = new DebugOverlays(scene);
    debug.setTelemetry(true);
    for (const key of KEYS) debug.setOverlay(key, true);
    debug.update(fakeState() as never, new THREE.PerspectiveCamera(), [], -1);
    expect(childCount(scene)).toBeGreaterThan(baseline);

    for (const key of KEYS) debug.setOverlay(key, false);
    expect(debug.active).toBe(false);
    expect(debug.group.parent).toBeNull(); // desmontado: cero objetos, cero draws
    console.log(`[baseline] all-off after on -> scene objects ${baseline} (restored)`);
    expect(childCount(scene)).toBe(baseline);
  });

  it('telemetry off forces every overlay off, even when each one was requested', () => {
    const scene = new THREE.Scene();
    const baseline = childCount(scene);
    const debug = new DebugOverlays(scene);
    debug.setTelemetry(true);
    for (const key of KEYS) debug.setOverlay(key, true);
    expect(debug.active).toBe(true);

    debug.setTelemetry(false);
    for (const key of KEYS) {
      expect(debug.plan[key]).toBe(false);
    }
    expect(debug.active).toBe(false);
    expect(debug.group.parent).toBeNull();
    expect(childCount(scene)).toBe(baseline);

    // Volver a abrir el panel no revive overlays apagados por el telemetry.
    debug.setTelemetry(true);
    for (const key of KEYS) expect(debug.plan[key]).toBe(false);
  });

  it('update is a safe no-op while inactive and allocates nothing per call (no new objects)', () => {
    const scene = new THREE.Scene();
    const debug = new DebugOverlays(scene);
    const camera = new THREE.PerspectiveCamera();
    expect(() => debug.update(fakeState() as never, camera, [{ x: 1, y: 0, z: 1 }], 0)).not.toThrow();
    expect(childCount(scene)).toBe(0);

    debug.setTelemetry(true);
    debug.setOverlay('camera', true);
    debug.update(fakeState() as never, camera, [{ x: 1, y: 0, z: 1 }], 0);
    expect(debug.camera).not.toBeNull();
    const before = debug.camera.px;
    debug.update(fakeState() as never, camera, [{ x: 1, y: 0, z: 1 }], 0);
    expect(debug.camera.px).toBe(before); // mismo objeto preallocado, sin reservas
  });

  it('bounds writes only live enemy slots into the shared dynamic buffer (drawRange), never reserving', () => {
    const scene = new THREE.Scene();
    const debug = new DebugOverlays(scene);
    const camera = new THREE.PerspectiveCamera();
    const state = { float: new Float32Array(4096), interacting: -1, px: 0, py: 0, pz: 0, tick: 1 };
    debug.setTelemetry(true);
    debug.setOverlay('bounds', true);

    // Sin slots usados: rango de dibujo cero para las cajas de enemigos.
    debug.update(state as never, camera, [{ x: 1, y: 0, z: 1 }], -1);
    const enemyLines = lineByRange(scene, 0);
    const terminalLines = lineByRange(scene, 24);
    expect(enemyLines).not.toBeNull();
    expect(terminalLines).not.toBeNull();

    // Slot 0 vivo en (3, 0, -2), clase scout: una caja de 12 aristas (24 verts).
    const base = 64; // ENEMY_BASE
    state.float[base + 0] = 3; // x
    state.float[base + 2] = -2; // z
    state.float[base + 5] = 1; // patrol
    debug.update(state as never, camera, [{ x: 1, y: 0, z: 1 }], -1);
    const attr = (enemyLines as THREE.LineSegments).geometry.getAttribute('position') as THREE.BufferAttribute;
    const range = (enemyLines as unknown as { geometry: { drawRange: { count: number } } }).geometry.drawRange.count;
    expect(range).toBe(24);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < range; i += 1) {
      minX = Math.min(minX, attr.getX(i)); maxX = Math.max(maxX, attr.getX(i));
      minY = Math.min(minY, attr.getY(i)); maxY = Math.max(maxY, attr.getY(i));
    }
    expect(minX).toBeGreaterThan(2.5); expect(maxX).toBeLessThan(3.5);
    expect(minY).toBeGreaterThanOrEqual(0); expect(maxY).toBeLessThan(1.71);
  });
});

/** Devuelve el LineSegments de la capa bounds cuyo drawRange es `count`. */
function lineByRange(scene: THREE.Scene, count: number): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((obj) => {
    const line = obj as THREE.LineSegments;
    if (!line.isLineSegments || !(line.geometry as THREE.BufferGeometry).getAttribute('position')) return;
    if ((line.geometry as unknown as { drawRange: { count: number } }).drawRange.count === count) found = obj;
  });
  return found;
}
