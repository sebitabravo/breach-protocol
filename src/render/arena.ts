/**
 * Arena del sector: todo lo estático se funde en cuatro batches (lit, unlit,
 * charcos de luz y decals) para mantener el presupuesto de draw calls. Los
 * materiales de piso y paredes comparten una textura de paneles; las tiras
 * emisivas parpadean en shader con un único uniform de tiempo.
 */
import * as THREE from 'three';
import { wallHeight, type ArenaBox, type Material } from '../world/layout';
import { SOLID_KIND, type MapData, type Solid } from '../world/map';
import { FACE, MeshBuilder } from './geometry';
import { mulberry32 } from './random';
import { domCanvas, paintDecalAtlas, paintPanelTile, paintRadialGlow, toCanvasTexture, type SurfaceFactory } from './textures';
import { MATERIAL_COLORS, PALETTE, type ThemeLook } from './themes';

/** Tile de paneles en metros: 2×2 paneles de 2 m por textura de 4 m. */
const PANEL_TILE_M = 4;
const WALL_EPS = 0.001;
const STENCIL_WIDTH_M = 7;
/** Media diagonal de un charco de luz bajo una luminaria (metros). */
const POOL_HALF_M = 1.6;
const HAZARD_LEN_M = 1.4;

type Rgb = readonly [number, number, number];
type Canvas = HTMLCanvasElement;

/** Color lineal de un hex, opcionalmente escalado (HDR > 1 para el bloom). */
export function linear(hex: number, k = 1): Rgb {
  const c = new THREE.Color(hex);
  return [c.r * k, c.g * k, c.b * k];
}

/** Variación por instancia (±6/255 sRGB, sembrada) para que paredes y tapas no sean planas. */
function jitteredLinear(hex: number, rng: () => number): Rgb {
  const jit = (): number => Math.round((rng() * 2 - 1) * 6);
  const clamp255 = (v: number): number => Math.min(Math.max(v, 0), 255);
  const r8 = (hex >> 16) & 0xff;
  const g8 = (hex >> 8) & 0xff;
  const b8 = hex & 0xff;
  const c = new THREE.Color().setRGB(
    clamp255(r8 + jit()) / 255,
    clamp255(g8 + jit()) / 255,
    clamp255(b8 + jit()) / 255,
    THREE.SRGBColorSpace,
  );
  return [c.r, c.g, c.b];
}

/** Lámpara de techo: caja emisiva cerca del cielorraso (la lista de luminarias de layout). */
function isCeilingLamp(b: ArenaBox, h: number): boolean {
  return b.material === 'glow' && b.y > 5 && b.y < h;
}

/** Un rectángulo horizontal sobre el piso, centrado en (cx, cz). */
function floorQuad(
  builder: MeshBuilder,
  cx: number,
  cz: number,
  hw: number,
  hd: number,
  y: number,
  uv: readonly [number, number, number, number],
  rgb: Rgb,
): void {
  builder.addQuad(
    [cx - hw, y, cz - hd, cx - hw, y, cz + hd, cx + hw, y, cz + hd, cx + hw, y, cz - hd],
    [0, 1, 0],
    [uv[0], uv[1], uv[0], uv[3], uv[2], uv[3], uv[2], uv[1]],
    rgb,
  );
}

/** Estarcido vertical sobre una pared interior: centro, medio ancho y alto. */
function wallDecalQuad(
  builder: MeshBuilder,
  face: WallFace,
  halfW: number,
  halfH: number,
  yc: number,
  uv: readonly [number, number, number, number],
  rgb: Rgb,
): void {
  const off = 0.012; // separa el decal de la pared para evitar z-fighting
  const nx = face.axis === 'x' ? face.dir : 0;
  const nz = face.axis === 'z' ? face.dir : 0;
  const cx = face.axis === 'x' ? face.at + nx * off : face.centre;
  const cz = face.axis === 'z' ? face.at + nz * off : face.centre;
  // eje "derecha" de un observador mirando la pared desde el interior: (nz, 0, -nx).
  // Sin esto el texto se lee espejado en los muros este/oeste.
  const ax = nz * halfW;
  const az = -nx * halfW;
  builder.addQuad(
    [cx - ax, yc - halfH, cz - az, cx + ax, yc - halfH, cz + az, cx + ax, yc + halfH, cz + az, cx - ax, yc + halfH, cz - az],
    [nx, 0, nz],
    [uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[3]],
    rgb,
  );
}

/** Cara interior de un muro perimetral: `at` es la coordenada del plano y `dir` apunta al interior. */
export interface WallFace {
  axis: 'x' | 'z';
  at: number;
  dir: 1 | -1;
  /** Centro del muro a lo largo de su eje horizontal. */
  centre: number;
  /** Medio largo del muro a lo largo de su eje horizontal. */
  span: number;
}

/**
 * Caras interiores de los cuatro muros perimetrales. Un muro oeste/este es
 * delgado en x; uno norte/sur, delgado en z. Sin ese chequeo, el muro norte
 * (que también toca x = -halfX) se confunde con el oeste.
 */
export function perimeterFaces(map: MapData): WallFace[] {
  const walls = map.solids.filter((s) => s.kind === SOLID_KIND.wall);
  const xThin = (s: Solid): boolean => s.max[0] - s.min[0] <= 2;
  const zThin = (s: Solid): boolean => s.max[2] - s.min[2] <= 2;
  const west = walls.find((s) => xThin(s) && s.min[0] <= -map.halfX + WALL_EPS);
  const east = walls.find((s) => xThin(s) && s.max[0] >= map.halfX - WALL_EPS);
  const north = walls.find((s) => zThin(s) && s.min[2] <= -map.halfZ + WALL_EPS);
  const south = walls.find((s) => zThin(s) && s.max[2] >= map.halfZ - WALL_EPS);
  const faces: WallFace[] = [];
  if (west) faces.push(faceOf('x', west.max[0], 1, west.min[2], west.max[2]));
  if (east) faces.push(faceOf('x', east.min[0], -1, east.min[2], east.max[2]));
  if (north) faces.push(faceOf('z', north.max[2], 1, north.min[0], north.max[0]));
  if (south) faces.push(faceOf('z', south.min[2], -1, south.min[0], south.max[0]));
  return faces;
}

function faceOf(axis: 'x' | 'z', at: number, dir: 1 | -1, lo: number, hi: number): WallFace {
  return { axis, at, dir, centre: (lo + hi) / 2, span: (hi - lo) / 2 };
}

/**
 * Batches estáticos de un sector. El grupo se agrega a la escena y `dispose`
 * libera todo lo que creó (geometrías, materiales y texturas).
 */
export class ArenaBuild {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly disposables: { dispose(): void }[] = [];
  private readonly factory: SurfaceFactory<Canvas>;

  constructor(map: MapData, boxes: ArenaBox[], look: ThemeLook, factory: SurfaceFactory<Canvas> = domCanvas) {
    this.factory = factory;
    const lit = new MeshBuilder();
    const unlit = new MeshBuilder();
    const pools = new MeshBuilder();
    const decals = new MeshBuilder();
    const h = wallHeight(map);
    const rng = mulberry32(0x5eed11);

    let lampIndex = 0;
    for (const b of boxes) {
      if (b.material === 'ceiling') {
        unlit.addBox(b.x, b.y, b.z, b.sx, b.sy, b.sz, { rgb: linear(PALETTE.ceiling), faces: FACE.negY });
        continue;
      }
      if (b.material === 'beam') {
        unlit.addBox(b.x, b.y, b.z, b.sx, b.sy, b.sz, { rgb: linear(0x171f27) });
        continue;
      }
      if (b.material === 'glow') {
        const lamp = isCeilingLamp(b, h);
        const hex = lamp && lampIndex % 2 === 1 ? look.stripAlt : look.strip;
        if (lamp) lampIndex += 1;
        unlit.addBox(b.x, b.y, b.z, b.sx, b.sy, b.sz, { rgb: linear(hex, look.stripIntensity) });
        if (lamp) floorQuad(pools, b.x, b.z, POOL_HALF_M, POOL_HALF_M, 0.012, [0, 0, 1, 1], linear(look.pool, look.poolIntensity));
        continue;
      }
      lit.addBox(b.x, b.y, b.z, b.sx, b.sy, b.sz, { rgb: litColour(b.material, look, rng), uvTile: PANEL_TILE_M });
    }

    for (const s of map.solids) {
      if (s.kind !== SOLID_KIND.plinth) continue;
      addTerminalAccent(unlit, s, look);
      addHazard(decals, s);
    }

    for (const f of perimeterFaces(map)) {
      const halfW = Math.min(f.span, STENCIL_WIDTH_M / 2);
      wallDecalQuad(decals, f, halfW, halfW / 4, h * 0.5, [0, 0.5, 1, 1], linear(look.stencil));
    }

    this.addLit(lit);
    this.addUnlit(unlit);
    this.addPools(pools);
    this.addDecals(decals, `SECTOR 0${map.id + 1}`);
  }

  /** Avanza el tiempo de las tiras parpadeantes. Un solo uniform, sin JS por LED. */
  setTime(seconds: number): void {
    this.time.value = seconds;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.removeFromParent();
  }

  private texture(paint: Canvas | null, wrap: boolean): THREE.CanvasTexture | null {
    if (!paint) return null;
    const tex = toCanvasTexture(paint, { wrap });
    this.disposables.push(tex);
    return tex;
  }

  private addLit(builder: MeshBuilder): void {
    if (builder.vertexCount === 0) return;
    const tex = this.texture(paintPanelTile(this.factory), true);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    const geo = builder.build();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
  }

  private addUnlit(builder: MeshBuilder): void {
    if (builder.vertexCount === 0) return;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const time = this.time;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float aBlink;\nvarying float vBlink;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvBlink = aBlink;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform float uTime;\nvarying float vBlink;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nif (vBlink > 0.0) diffuseColor.rgb *= step(0.5, fract(uTime * 1.7 + vBlink));',
        );
    };
    mat.customProgramCacheKey = () => 'bp-unlit-blink';
    const geo = builder.build();
    this.group.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
  }

  private addPools(builder: MeshBuilder): void {
    if (builder.vertexCount === 0) return;
    const tex = this.texture(paintRadialGlow(this.factory), false);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const geo = builder.build();
    this.group.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
  }

  private addDecals(builder: MeshBuilder, label: string): void {
    if (builder.vertexCount === 0) return;
    const tex = this.texture(paintDecalAtlas(this.factory, label), false);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const geo = builder.build();
    this.group.add(new THREE.Mesh(geo, mat));
    this.disposables.push(geo, mat);
  }
}

/** Color lineal del batch lit para un material; paredes y tapas reciben jitter y tinte del tema. */
export function litColour(material: Material, look: ThemeLook, rng: () => number): Rgb {
  const hex = MATERIAL_COLORS[material];
  if (material === 'wall' || material === 'trim') {
    const base = jitteredLinear(hex, rng);
    const tint = linear(look.wallTint);
    return [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2]];
  }
  return linear(hex);
}

function addTerminalAccent(builder: MeshBuilder, s: Solid, look: ThemeLook): void {
  const cx = (s.min[0] + s.max[0]) / 2;
  const cz = (s.min[2] + s.max[2]) / 2;
  const hw = (s.max[0] - s.min[0]) / 2 - 0.12;
  const hd = (s.max[2] - s.min[2]) / 2 - 0.12;
  floorQuad(builder, cx, cz, hw, hd, s.max[1] + 0.008, [0, 0, 1, 1], linear(look.accent, look.accentIntensity));
}

/** Franja de peligro en el piso, frente al terminal y hacia el centro del sector. */
function addHazard(builder: MeshBuilder, s: Solid): void {
  const cx = (s.min[0] + s.max[0]) / 2;
  const cz = (s.min[2] + s.max[2]) / 2;
  const onX = Math.abs(cx) > Math.abs(cz);
  const side = onX ? -Math.sign(cx) : -Math.sign(cz);
  const hx = onX ? 0.18 : HAZARD_LEN_M / 2;
  const hz = onX ? HAZARD_LEN_M / 2 : 0.18;
  const ox = onX ? cx + side * (Math.abs(s.max[0] - s.min[0]) / 2 + 0.3) : cx;
  const oz = onX ? cz : cz + side * (Math.abs(s.max[2] - s.min[2]) / 2 + 0.3);
  floorQuad(builder, ox, oz, hx, hz, 0.015, [0, 0, 1, 0.5], [1, 1, 1]);
}
