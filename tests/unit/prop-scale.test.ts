import { expect, it } from 'vitest';
import * as THREE from 'three';
import { buildConsoleHousing, consoleYaw, CONSOLE_COLLAR, PLAYER_EYE_HEIGHT,
  TERMINAL_SCALE } from '../../src/render/terminal-model';
import { groundRimFrame, RING_BAR_LOCAL, RING_CROWN_LOCAL, RING_DROP_LOCAL, RING_MARGIN_LOCAL } from '../../src/render/objective-beacon';

// T6b / S16 — world-scale audit of the arena props. The objective terminals were
// derived from player height in the previous unit (TERMINAL_SCALE); this file pins
// the one other player-judgeable sized fixture that still carried authored
// numbers: the mint ground ring around each terminal. It was scaled by the
// collider-exported collar at authored size while the console collar itself was
// rescaled to the player, so the ring plane cut the smaller desk shell. Every
// value asserted here is a named export derived from the terminal's
// player-scale factor, so a future edit cannot silently re-inflate the ring.
// Player metrics mirrored from the sim core (core/src/player.rs): HEIGHT 1.8 m,
// EYE_HEIGHT 1.62 m; authored plinth height 1.2 m (core/src/maps.rs KIND_PLINTH).

const PLINTH_HEIGHT = 1.2;
const NODE_Y = 0;

/** Triangle-vs-box overlap (Akenine-Möller), all in rim-local metres. */
function triTouchesBox(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, box: { min: [number, number, number]; max: [number, number, number] }): boolean {
  const tri = [a, b, c];
  const half = [(box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2];
  const centre = [(box.max[0] + box.min[0]) / 2, (box.max[1] + box.min[1]) / 2, (box.max[2] + box.min[2]) / 2];
  const rel = (v: THREE.Vector3) => [v.x - centre[0], v.y - centre[1], v.z - centre[2]];
  // world-axis slabs
  for (let d = 0; d < 3; d += 1) {
    let tmin = Infinity, tmax = -Infinity;
    for (const v of tri) {
      const p = rel(v)[d];
      tmin = Math.min(tmin, p); tmax = Math.max(tmax, p);
    }
    if (tmax < -half[d] || tmin > half[d]) return false;
  }
  // edge-cross-axis slabs
  const edges = [
    [b.x - a.x, b.y - a.y, b.z - a.z],
    [c.x - b.x, c.y - b.y, c.z - b.z],
    [a.x - c.x, a.y - c.y, a.z - c.z],
  ];
  for (const e of edges) {
    for (let d = 0; d < 3; d += 1) {
      const axis = [0, 0, 0];
      axis[(d + 1) % 3] = e[(d + 2) % 3];
      axis[(d + 2) % 3] = -e[(d + 1) % 3];
      if (axis[0] === 0 && axis[1] === 0 && axis[2] === 0) continue;
      const reach = Math.abs(axis[0]) * half[0] + Math.abs(axis[1]) * half[1] + Math.abs(axis[2]) * half[2];
      let tmin = Infinity, tmax = -Infinity;
      for (const v of tri) {
        const r = rel(v);
        const p = axis[0] * r[0] + axis[1] * r[1] + axis[2] * r[2];
        tmin = Math.min(tmin, p); tmax = Math.max(tmax, p);
      }
      if (tmax < -reach || tmin > reach) return false;
    }
  }
  return true;
}

it('derives the whole ground-ring frame from the terminal player-scale factor', () => {
  const frame = groundRimFrame(NODE_Y);
  console.log(`ground ring: scale ${frame.scale.x.toFixed(4)} x ${frame.scale.y.toFixed(4)} x ${frame.scale.z.toFixed(4)}, plane y ${frame.y.toFixed(4)} (authored margin ${RING_MARGIN_LOCAL} m, drop ${RING_DROP_LOCAL} m, bar ${RING_BAR_LOCAL} m)`);
  // The ring is the collar outline at player scale: bar height and every
  // clearance carry TERMINAL_SCALE, so the loop shrinks with the machine.
  expect(frame.scale.y).toBe(TERMINAL_SCALE);
  expect(frame.scale.x).toBeCloseTo(CONSOLE_COLLAR.width + RING_MARGIN_LOCAL * TERMINAL_SCALE, 6);
  expect(frame.scale.z).toBeCloseTo(CONSOLE_COLLAR.depth + RING_MARGIN_LOCAL * TERMINAL_SCALE, 6);
});

it('sits at the authored collar-band height over the node floor, under the standing eye', () => {
  const frame = groundRimFrame(NODE_Y);
  console.log(`ring plane ${(frame.y - NODE_Y).toFixed(4)} m over the node floor at scale ${TERMINAL_SCALE.toFixed(4)} — authored ${(RING_CROWN_LOCAL - (frame.y - NODE_Y) / TERMINAL_SCALE).toFixed(4)} m below the authored plinth crown ${RING_CROWN_LOCAL} m (player eye ${PLAYER_EYE_HEIGHT.toFixed(2)} m)`);
  expect(frame.y).toBeLessThan(PLINTH_HEIGHT + NODE_Y);
  expect(frame.y).toBeGreaterThan(NODE_Y);
  // S16: a floor-level fixture a player can judge by eye sits under the eye line.
  expect(frame.y).toBeLessThan(NODE_Y + PLAYER_EYE_HEIGHT);
  expect(RING_CROWN_LOCAL - (frame.y - NODE_Y) / TERMINAL_SCALE).toBeCloseTo(RING_DROP_LOCAL, 6);
  // The collar band the ring must outline: the collar's authored height window
  // (console collar flare 0.98..1.20 local metres), scaled with the terminal.
  const flareBandWorld = [0.98 * TERMINAL_SCALE, 1.20 * TERMINAL_SCALE];
  expect(frame.y).toBeGreaterThanOrEqual(flareBandWorld[0]);
  expect(frame.y).toBeLessThanOrEqual(flareBandWorld[1]);
});

it('surrounds the collar outline with authored clearance rather than sitting inside it', () => {
  const frame = groundRimFrame(NODE_Y);
  expect(frame.scale.x).toBeGreaterThan(CONSOLE_COLLAR.width);
  expect(frame.scale.z).toBeGreaterThan(CONSOLE_COLLAR.depth);
  expect(RING_MARGIN_LOCAL * TERMINAL_SCALE).toBeGreaterThan(0.005);
});

it('kept the mint outline confined to the collar inlay band (the reported ring/shell intersection)', () => {
  const frame = groundRimFrame(NODE_Y);
  // Triangle-level probe: the ring bars are thin slabs in the rim-local frame,
  // so shell faces can slice through them without a vertex landing inside.
  // Allowed contact is the collar flare alone (0.90..1.41 in authored metres:
  // the flare wall plus its bevel caps) — the authored flush-inlay relationship,
  // scaled with the terminal. Any pedestal or desk/cowling triangle is a cut.
  const [housing] = buildConsoleHousing();
  const pos = housing.getAttribute('position');
  const idx = housing.getIndex()!;
  const yaw = consoleYaw(-12, 0);
  const rimLocal: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i += 1) {
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i))
      .multiplyScalar(TERMINAL_SCALE)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
    p.z -= CONSOLE_COLLAR.z; // the rim is centred on the console's collar offset
    rimLocal.push(p);
  }
  const boxes: { min: [number, number, number]; max: [number, number, number] }[] = [];
  const halfY = RING_BAR_LOCAL / 2 * frame.scale.y;
  for (const sgn of [-1, 1]) {
    boxes.push({
      min: [-0.5 * frame.scale.x, frame.y - halfY, sgn * 0.49 * frame.scale.z - 0.0125 * frame.scale.z],
      max: [0.5 * frame.scale.x, frame.y + halfY, sgn * 0.49 * frame.scale.z + 0.0125 * frame.scale.z],
    });
    boxes.push({
      min: [sgn * 0.49 * frame.scale.x - 0.0125 * frame.scale.x, frame.y - halfY, -0.5 * frame.scale.z],
      max: [sgn * 0.49 * frame.scale.x + 0.0125 * frame.scale.x, frame.y + halfY, 0.5 * frame.scale.z],
    });
  }
  const zone = (authorY: number): string => authorY < 0.90 ? 'pedestal' : authorY < 1.41 ? 'collar' : 'desk/cowling';
  let touched = 0, offenders = 0, firstOffender = '', zones: Record<string, number> = {};
  for (let t = 0; t < idx.count; t += 3) {
    const tri = [0, 1, 2].map((j) => rimLocal[idx.getX(t + j)]);
    if (!boxes.some((b) => triTouchesBox(tri[0], tri[1], tri[2], b))) continue;
    touched += 1;
    const authorY = (pos.getY(idx.getX(t)) + pos.getY(idx.getX(t + 1)) + pos.getY(idx.getX(t + 2))) / 3;
    zones[zone(authorY)] = (zones[zone(authorY)] ?? 0) + 1;
    if (zone(authorY) !== 'collar' && !firstOffender) {
      firstOffender = `${zone(authorY)} shell at authored y ${authorY.toFixed(2)} vs ring plane y ${frame.y.toFixed(3)} (scale ${TERMINAL_SCALE.toFixed(4)})`;
    }
    if (zone(authorY) !== 'collar') offenders += 1;
  }
  console.log(`ring/shell contact: ${touched} shell triangles touched by the bar volumes (${JSON.stringify(zones)})${offenders ? ` — first offender: ${firstOffender}` : ' — all inside the collar inlay band'}`);
  expect(touched).toBeGreaterThan(0); // the authored flush collar inlay, scaled with the terminal
  expect(offenders).toBe(0);
});
