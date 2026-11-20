/**
 * Decoración procedural por sector. Solo visual: nunca colisiona ni bloquea
 * disparos. Devuelve cajas planas con su batch de destino para que el arena las
 * funda en sus dos batches existentes (lit y unlit), sin draw calls nuevas.
 *
 * - todos: tuberías y bandeja de cables pegadas a los muros, rejillas de ventilación.
 * - cryo: anillos de torre de enfriamiento en los pilares de altura completa.
 * - archive: paneles de servidor con LEDs parpadeantes en las caras de los racks,
 *   y barandilla con soportes en el borde del pasillo elevado.
 */
import { SOLID_KIND, type MapData, type Solid } from '../world/map';
import { FACE } from './geometry';
import type { ThemeLook } from './themes';
import { perimeterFaces, type WallFace } from './walls';

export type DressRole = 'lit' | 'glow' | 'led';

export interface DressBox {
  role: DressRole;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  hex: number;
  /** Multiplicador HDR para role glow/led (> 1 entra al bloom). */
  intensity: number;
  /** Máscara de caras (FACE_*); omitida = todas. */
  faces?: number;
  /** Fase de parpadeo para LEDs (0 = fijo). */
  blink?: number;
}

const PIPE = 0x34404c;
const TRAY = 0x2a333d;
const VENT = 0x1a222b;
const SLAT = 0x2c3842;
const BAND = 0x3b4d5b;
const PANEL = 0x161e26;
const RAIL = 0x3b4a56;

const PIPE_INSET = 0.22;
const VENT_SPACING_M = 4.5;
const RACK_LED_ROW = 0.32;
const RACK_LED_COL = 0.42;
const RING_T = 0.14;

/** Caja de un muro: `inset` separa del plano, `depth` es el grosor, `t` el corrimiento a lo largo. */
function onWall(f: WallFace, t: number, y: number, inset: number, depth: number, width: number, height: number, hex: number): DressBox {
  const c = f.at + f.dir * (inset + depth / 2);
  if (f.axis === 'x') return box('lit', c, y, f.centre + t, depth, height, width, hex, 1);
  return box('lit', f.centre + t, y, c, width, height, depth, hex, 1);
}

function box(
  role: DressRole,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  hex: number,
  intensity: number,
  extra: Partial<DressBox> = {},
): DressBox {
  return { role, x, y, z, sx, sy, sz, hex, intensity, ...extra };
}

/** Tuberías a la altura del techo y una bandeja de cable más abajo, a lo largo de cada muro. */
export function pipesAlong(f: WallFace, h: number): DressBox[] {
  const len = 2 * f.span - 0.6;
  return [
    onWall(f, 0, h - 0.35, PIPE_INSET, 0.16, len, 0.16, PIPE),
    onWall(f, 0, h - 0.75, PIPE_INSET, 0.12, len, 0.12, PIPE),
    onWall(f, 0, 2.6, PIPE_INSET, 0.3, len, 0.04, TRAY),
  ];
}

/** Rejillas de ventilación a la altura de la cintura, repartidas cada ~4.5 m. */
export function ventsAlong(f: WallFace): DressBox[] {
  const out: DressBox[] = [];
  const n = Math.max(1, Math.floor((2 * f.span) / VENT_SPACING_M));
  const step = (2 * f.span) / n;
  for (let i = 0; i < n; i += 1) {
    const t = -f.span + (i + 0.5) * step;
    out.push(onWall(f, t, 1.0, 0.0, 0.08, 0.9, 0.6, VENT));
    for (const dy of [-0.2, 0, 0.2]) {
      out.push(onWall(f, t, 1.0 + dy, 0.0, 0.03, 0.7, 0.05, SLAT));
    }
  }
  return out;
}

/** Cuatro tiras que forman un anillo alrededor de un pilar, a la altura `y`. */
function ring(s: Solid, y: number, height: number, hex: number, intensity: number, role: DressRole): DressBox[] {
  const cx = (s.min[0] + s.max[0]) / 2;
  const cz = (s.min[2] + s.max[2]) / 2;
  const hx = (s.max[0] - s.min[0]) / 2 + RING_T;
  const hz = (s.max[2] - s.min[2]) / 2 + RING_T;
  return [
    box(role, cx, y, cz + hz - RING_T / 2, 2 * hx, height, RING_T, hex, intensity),
    box(role, cx, y, cz - hz + RING_T / 2, 2 * hx, height, RING_T, hex, intensity),
    box(role, cx + hx - RING_T / 2, y, cz, RING_T, height, 2 * hz - 2 * RING_T, hex, intensity),
    box(role, cx - hx + RING_T / 2, y, cz, RING_T, height, 2 * hz - 2 * RING_T, hex, intensity),
  ];
}

/** Anillos de torre de enfriamiento: dos bandas oscuras y uno emisivo arriba. */
export function towerRings(map: MapData, look: ThemeLook): DressBox[] {
  const out: DressBox[] = [];
  for (const s of map.solids) {
    if (s.kind !== SOLID_KIND.pillar) continue;
    out.push(...ring(s, 0.25, 0.3, BAND, 1, 'lit'));
    out.push(...ring(s, 3.4, 0.3, BAND, 1, 'lit'));
    out.push(...ring(s, s.max[1] - 0.5, 0.12, look.strip, look.stripIntensity, 'glow'));
  }
  return out;
}

/** Hash determinista [0,1) para desfasar los parpadeos sin Math.random. */
function hash01(a: number, b: number): number {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Panel de servidor en las dos caras largas de un rack, con LEDs parpadeantes.
 * Las caras largas dan al pasillo; el color alterna acento y tira del tema.
 */
export function serverPanels(rack: Solid, look: ThemeLook, seed: number): DressBox[] {
  const out: DressBox[] = [];
  const sx = rack.max[0] - rack.min[0];
  const sz = rack.max[2] - rack.min[2];
  const alongZ = sz > sx;
  const length = alongZ ? sz : sx;
  const cu = alongZ ? (rack.min[2] + rack.max[2]) / 2 : (rack.min[0] + rack.max[0]) / 2;
  const faceEdges: [number, number][] = alongZ
    ? [[rack.min[0], -1], [rack.max[0], 1]]
    : [[rack.min[2], -1], [rack.max[2], 1]];
  const cols = Math.max(1, Math.floor((length - 0.6) / RACK_LED_COL));
  const rows = 6;
  for (const [edge, dir] of faceEdges) {
    const faceMask = alongZ ? (dir > 0 ? FACE.posX : FACE.negX) : dir > 0 ? FACE.posZ : FACE.negZ;
    const pos = edge + dir * 0.02;
    const panelY = 1.5;
    const panelH = 2.0;
    const panel = alongZ
      ? box('lit', pos, panelY, cu, 0.05, panelH, length - 0.6, PANEL, 1)
      : box('lit', cu, panelY, pos, length - 0.6, panelH, 0.05, PANEL, 1);
    out.push(panel);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const along = -(length - 0.6) / 2 + (c + 0.5) * ((length - 0.6) / cols);
        const y = panelY - panelH / 2 + 0.25 + r * RACK_LED_ROW;
        const hex = (r + c) % 2 === 0 ? look.accent : look.strip;
        const blink = 0.01 + hash01(seed + r * 13, c * 7 + (dir > 0 ? 1 : 0)) * 0.98;
        const led = alongZ
          ? box('led', pos + dir * 0.03, y, cu + along, 0.02, 0.05, 0.05, hex, look.accentIntensity, { faces: faceMask, blink })
          : box('led', cu + along, y, pos + dir * 0.03, 0.05, 0.05, 0.02, hex, look.accentIntensity, { faces: faceMask, blink });
        out.push(led);
      }
    }
  }
  return out;
}

/** Barandilla y soportes en el borde del pasillo elevado (la cubierta más alta del sector). */
export function catwalkRail(deck: Solid, look: ThemeLook): DressBox[] {
  const out: DressBox[] = [];
  // borde frontal: el más cercano al centro del sector (z = 0)
  const edge = deck.max[2] <= 0 ? deck.max[2] : deck.min[2];
  const inward = edge < 0 ? 1 : -1;
  const z = edge + inward * 0.05;
  const x0 = deck.min[0];
  const x1 = deck.max[0];
  const len = x1 - x0;
  const top = deck.max[1];
  out.push(box('lit', (x0 + x1) / 2, top + 0.6, z, len, 0.06, 0.06, RAIL, 1));
  out.push(box('glow', (x0 + x1) / 2, top + 0.66, z, len, 0.02, 0.04, look.accent, look.accentIntensity));
  for (let x = x0; x <= x1 + 1e-6; x += 1.5) {
    out.push(box('lit', x, top + 0.3, z, 0.06, 0.6, 0.06, RAIL, 1));
  }
  for (let x = x0 + 1.5; x < x1; x += 3) {
    out.push(box('lit', x, deck.min[1] / 2, z - inward * 0.1, 0.1, deck.min[1], 0.1, PIPE, 1));
  }
  return out;
}

/** Toda la decoración de un sector, según su tema y su geometría. */
export function dressingFor(map: MapData, look: ThemeLook, h: number): DressBox[] {
  const out: DressBox[] = [];
  for (const f of perimeterFaces(map)) {
    out.push(...pipesAlong(f, h), ...ventsAlong(f));
  }
  if (map.theme === 'cryo') out.push(...towerRings(map, look));
  if (map.theme === 'archive') {
    map.solids.forEach((s, i) => {
      if (s.kind === SOLID_KIND.rack) out.push(...serverPanels(s, look, i + 1));
      if (s.kind === SOLID_KIND.deck) out.push(...catwalkRail(s, look));
    });
  }
  return out;
}
