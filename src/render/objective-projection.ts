export interface ObjectiveClip { x: number; y: number; z: number; w: number; occluded: boolean }
export interface ScreenSize { width: number; height: number }
export interface ScreenRect { left: number; top: number; right: number; bottom: number }
type Edge = 'none' | 'left' | 'right' | 'top' | 'bottom';
export interface ObjectiveProjection {
  x: number;
  y: number;
  angle: number;
  mode: 'onscreen' | 'offscreen' | 'behind';
  edge: Edge;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** Pure clip-to-CSS-pixel calculation. The only write is to caller-owned `out`. */
export function projectObjective(
  x: number, y: number, z: number, w: number,
  viewport: ScreenSize, safe: ScreenRect, out: ObjectiveProjection,
): void {
  const cx = viewport.width / 2, cy = viewport.height / 2;
  const dx = x * cx, dy = -y * cy;
  if (w > 0 && Math.abs(x) <= w && Math.abs(y) <= w && Math.abs(z) <= w) {
    out.mode = 'onscreen';
    out.edge = 'none';
    out.x = clamp(cx + dx / w, safe.left, safe.right);
    out.y = clamp(cy + dy / w, safe.top, safe.bottom);
    out.angle = 0;
    return;
  }

  // Keep the signs of clip X/Y when behind the camera (dividing by W would
  // mirror the direction). A target exactly on the view axis points up.
  const sx = dx, sy = Math.abs(dx) + Math.abs(dy) < 1e-7 ? -1 : dy;
  const u = sx === 0 ? Infinity : ((sx > 0 ? safe.right : safe.left) - cx) / sx;
  const v = sy === 0 ? Infinity : ((sy > 0 ? safe.bottom : safe.top) - cy) / sy;
  const t = Math.min(u, v);
  out.mode = w <= 0 ? 'behind' : 'offscreen';
  out.edge = u < v ? (sx > 0 ? 'right' : 'left') : (sy > 0 ? 'bottom' : 'top');
  out.x = out.edge === 'left' ? safe.left : out.edge === 'right' ? safe.right : clamp(cx + t * sx, safe.left, safe.right);
  out.y = out.edge === 'top' ? safe.top : out.edge === 'bottom' ? safe.bottom : clamp(cy + t * sy, safe.top, safe.bottom);
  out.angle = Math.atan2(sy || 0, sx); // SVG convention: 0 = right, positive clockwise.
}

function isClear(x: number, y: number, blocks: readonly ScreenRect[], count: number): boolean {
  for (let i = 0; i < count; i += 1) {
    const b = blocks[i];
    if (x > b.left && x < b.right && y > b.top && y < b.bottom) return false;
  }
  return true;
}

/** Closest legal anchor. Only solve around obstacles when the projection hits one. */
export function fitObjective(out: ObjectiveProjection, safe: ScreenRect, blocks: readonly ScreenRect[], count: number): boolean {
  const { x, y, edge } = out;
  if (isClear(x, y, blocks, count)) return true;
  const limit = 2 + 2 * count;
  // The nearest legal point is on a boundary of one of the forbidden rectangles,
  // on the safe frame, or aligned with the original projection on one axis.
  // Prefer the original chevron edge; only try another if that edge is full.
  for (let pass = 0; pass < (edge === 'none' ? 1 : 2); pass += 1) {
    let best = Infinity;
    for (let i = -1; i < limit; i += 1) {
      const bx = i >= 2 ? blocks[(i - 2) >> 1] : null;
      const a = i < 0 ? x : i < 2 ? (i === 0 ? safe.left : safe.right) : (i % 2 ? bx!.right : bx!.left);
      if (a < safe.left || a > safe.right) continue;
      if (pass === 0 && ((edge === 'left' && a !== safe.left) || (edge === 'right' && a !== safe.right))) continue;
      for (let j = -1; j < limit; j += 1) {
        const by = j >= 2 ? blocks[(j - 2) >> 1] : null;
        const b = j < 0 ? y : j < 2 ? (j === 0 ? safe.top : safe.bottom) : (j % 2 ? by!.bottom : by!.top);
        if (b < safe.top || b > safe.bottom) continue;
        if (pass === 0 && ((edge === 'top' && b !== safe.top) || (edge === 'bottom' && b !== safe.bottom))) continue;
        if (pass === 1 && a !== safe.left && a !== safe.right && b !== safe.top && b !== safe.bottom) continue;
        const d = (x - a) ** 2 + (y - b) ** 2;
        if (d >= best || !isClear(a, b, blocks, count)) continue;
        best = d;
        out.x = a;
        out.y = b;
      }
    }
    if (best !== Infinity) return true;
  }
  return false;
}

export const CLOSE_OBJECTIVE_METRES = 4;
export const roundedObjectiveDistance = (metres: number): number => Math.max(0, Math.round(metres));
export const formatObjectiveDistance = (metres: number): string => `${roundedObjectiveDistance(metres)} m`;
