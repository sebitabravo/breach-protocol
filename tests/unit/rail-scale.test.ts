import { describe, expect, it } from 'vitest';
import { RAIL_BAY, RAIL_MID, RAIL_SIZE, RAIL_TOP, catwalkRail } from '../../src/render/dressing';
import { GANTRY_WALK_Y, gantryRailMembers } from '../../src/render/service-bay';
import { lookFor } from '../../src/render/themes';
import { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT } from '../../src/render/terminal-model';
import type { Solid } from '../../src/world/map';

// T6b / S16 — guardrails are sized from the player, never from each other. The
// prior scale audit measured the catwalk top rail at ~0.6 m above the deck and
// the service-bay gantry rails at ~0.385 m (mid) / ~0.75 m (top) — all far
// below a believable barrier. Derivation pinned here:
//   top rail  = 0.6 × PLAYER_HEIGHT  (1.08 m: a person cannot fall over it,
//                                     above the ~1.05 m real-world guardrail)
//   mid rail  = top / 2              (the conventional half-height rail)
//   post bays = 1.2 × PLAYER_HEIGHT  (a rhythm that reads at arena distance)
// Player metrics mirrored from the sim core (core/src/player.rs): HEIGHT 1.8 m,
// EYE_HEIGHT 1.62 m. Dressing and the gantry fence are render-only decoration
// (never part of the collision map), so the raise cannot change traversal.

const DECK: Solid = { min: [-17.8, 2.5, -17.8], max: [17.8, 2.8, -14.8], kind: 7 };
const LOOK = lookFor('archive');
const topEdge = (b: { y: number; sy: number }): number => b.y + b.sy / 2;

/** Long horizontal guard bars only (the posts and support struts are short members). */
function guardBars(deck: Solid): { y: number; sy: number; sx: number }[] {
  return catwalkRail(deck, LOOK).filter((b) => b.role === 'lit' && b.sx > 5);
}

describe('player-derived guardrail derivation', () => {
  it('pins the exported constants to the player metrics', () => {
    console.log(
      `rails: top ${RAIL_TOP.toFixed(3)} m = 0.6 × player ${PLAYER_HEIGHT.toFixed(3)} m; mid ${RAIL_MID.toFixed(3)} m; ` +
      `bay ${RAIL_BAY.toFixed(3)} m; bar ${RAIL_SIZE.toFixed(3)} m (eye ${PLAYER_EYE_HEIGHT.toFixed(3)} m)`);
    expect(RAIL_TOP).toBeCloseTo(PLAYER_HEIGHT * 0.6, 6);
    expect(RAIL_TOP).toBeGreaterThan(1.05); // above any believable real guardrail
    expect(RAIL_TOP).toBeLessThan(PLAYER_EYE_HEIGHT); // still below the standing eye
    expect(RAIL_MID).toBeCloseTo(RAIL_TOP / 2, 6);
    expect(RAIL_BAY).toBeCloseTo(PLAYER_HEIGHT * 1.2, 6);
    expect(RAIL_SIZE).toBeGreaterThan(0);
  });

  it('sizes the catwalk guard from the walk plane: top at RAIL_TOP, mid at the half', () => {
    const bars = guardBars(DECK);
    const walk = DECK.max[1];
    const edges = bars.map((b) => topEdge(b) - walk).sort((a, b) => b - a);
    console.log(
      `catwalk guard bar edges above the deck: ${edges.map((t) => t.toFixed(3)).join(', ')} m — audit found 0.63 m (top edge), no mid rail`);
    expect(bars).toHaveLength(2); // top + mid, both running the full deck
    expect(edges[0]).toBeCloseTo(RAIL_TOP, 2); // top edge reaches the derived height
    expect(edges[1]).toBeCloseTo(RAIL_MID, 2);
    // a person cannot fall over it; the mid rail stays in the guard band
    expect(edges[0]).toBeGreaterThan(PLAYER_HEIGHT * 0.55);
    expect(edges[1]).toBeGreaterThan(RAIL_TOP * 0.45);
  });

  it('keeps the catwalk glow strip riding the top rail without touching it', () => {
    const walk = DECK.max[1];
    const strip = catwalkRail(DECK, LOOK).find((b) => b.role === 'glow');
    expect(strip).toBeDefined();
    const gap = strip!.y - strip!.sy / 2 - (walk + RAIL_TOP);
    expect(gap).toBeGreaterThan(0.005); // no coplanar faces with the bar
  });

  it('spaces catwalk posts at the derived bay, standing on the walk plane', () => {
    const walk = DECK.max[1];
    const boxes = catwalkRail(DECK, LOOK);
    const posts = boxes.filter((b) => b.role === 'lit' && b.sx === RAIL_SIZE && b.sz === RAIL_SIZE);
    const bays = Math.round((DECK.max[0] - DECK.min[0]) / RAIL_BAY);
    expect(posts).toHaveLength(bays + 1); // even subdivision incl. both deck ends
    for (const p of posts) {
      expect(p.sy).toBeCloseTo(RAIL_TOP - 0.03, 6); // the bar crowns the posts by 3 cm
      expect(p.y - p.sy / 2).toBeCloseTo(walk, 6); // standing on the walk plane
    }
    const xs = posts.map((p) => p.x).sort((a, b) => a - b);
    const bay = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    expect(bay).toBeGreaterThan(RAIL_BAY * 0.8); // reads at arena distance
    expect(bay).toBeLessThan(RAIL_BAY * 1.2);
    expect(xs[0]).toBeCloseTo(DECK.min[0], 6);
    expect(xs[xs.length - 1]).toBeCloseTo(DECK.max[0], 6);
  });

  it('derives from any deck, not a hardcoded plane', () => {
    const high: Solid = { min: [0, 4.5, -8], max: [8, 4.8, -6], kind: 7 };
    const bars = guardBars(high);
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      const above = topEdge(bar) - high.max[1];
      expect(above).toBeGreaterThanOrEqual(RAIL_MID - RAIL_SIZE);
      expect(above).toBeLessThanOrEqual(RAIL_TOP);
    }
  });
});

describe('service-bay gantry fence', () => {
  it('derives from the authored walk plane and the player', () => {
    expect(GANTRY_WALK_Y).toBeCloseTo(4.48, 6); // platform plank top (centre 4.38, sy 0.20)
    const members = gantryRailMembers();
    const posts = members.filter((m) => m.sy === RAIL_TOP);
    const bays = Math.round((2.83 - -4.02) / RAIL_BAY);
    expect(posts).toHaveLength(bays + 1);
    for (const p of posts) {
      expect(p.y - p.sy / 2).toBeCloseTo(GANTRY_WALK_Y, 6); // stands on the walk plane
      expect(p.y + p.sy / 2).toBeCloseTo(GANTRY_WALK_Y + RAIL_TOP, 6); // reaches the fall line
      expect(p.z).toBeCloseTo(1.74, 6);
    }
    const xs = posts.map((p) => p.x).sort((a, b) => a - b);
    const bay = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
    expect(bay).toBeGreaterThan(RAIL_BAY * 0.8);
    expect(bay).toBeLessThan(RAIL_BAY * 1.2);
  });

  it('runs top and mid guards at the derived heights, under the post crowns', () => {
    const members = gantryRailMembers();
    const frontRuns = members.filter((m) => m.sy === RAIL_SIZE && m.sx > 5).sort((a, b) => b.y - a.y);
    expect(frontRuns).toHaveLength(2);
    // top run: within half a bar of the derived fall line, strictly under the post crowns
    expect(topEdge(frontRuns[0])).toBeLessThan(GANTRY_WALK_Y + RAIL_TOP);
    expect(topEdge(frontRuns[0])).toBeGreaterThan(GANTRY_WALK_Y + RAIL_TOP - RAIL_SIZE);
    // mid run: top edge at the conventional half height
    expect(topEdge(frontRuns[1])).toBeCloseTo(GANTRY_WALK_Y + RAIL_MID, 2);
    // the return rail on the right edge mirrors the same two heights
    const returns = members.filter((m) => m.sz === 1.15).sort((a, b) => b.y - a.y);
    expect(returns).toHaveLength(2);
    expect(returns[0].y).toBeCloseTo(frontRuns[0].y, 6);
    expect(returns[1].y).toBeCloseTo(frontRuns[1].y, 6);
    expect(returns[0].x).toBeCloseTo(2.83, 6);
  });
});
