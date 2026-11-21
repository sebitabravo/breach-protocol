import * as THREE from 'three';
import { wallHeight, type ArenaBox, type Material } from '../world/layout';
import { SOLID_KIND, type MapData } from '../world/map';
import { cargo, controlCore, controlRunway, fixture, floorPaint, planters, services, STENCIL_UV, tint, wallDecal, type Tint } from './architecture';
import { catwalkRail, serverPanels, towerRings, type DressBox } from './dressing';
import { FACE, MeshBuilder } from './geometry';
import type { QualityName } from './presets';
import { mulberry32 } from './random';
import { serviceBay, serviceNotes } from './service-bay';
import { ArenaSurfaces, groupSurfaces, interiorDepth, SURFACE, TILE } from './surfaces';
import { domCanvas, paintDecalAtlas, toCanvasTexture, type SurfaceFactory } from './textures';
import { TerminalConsoles } from './terminals';
import { MATERIAL_COLORS, type ThemeLook } from './themes';
import { perimeterFaces } from './walls';

const TILE_M = 4;

/** Four static batches: PBR, emissives, atmosphere/streaks, printed decals. */
export class ArenaBuild {
  readonly group = new THREE.Group();
  readonly terminals: TerminalConsoles | null;
  private readonly time = { value: 0 };
  private readonly glossy = { value: 0 };
  private readonly disposables: { dispose(): void }[] = [];

  constructor(map: MapData, boxes: ArenaBox[], look: ThemeLook, factory: SurfaceFactory<HTMLCanvasElement> = domCanvas, shared?: ArenaSurfaces) {
    const lit = new MeshBuilder(), emit = new MeshBuilder(), mist = new MeshBuilder(), decals = new MeshBuilder();
    const h = wallHeight(map);
    const rng = mulberry32(0x5eed11);
    let lampIndex = 0;
    for (const b of boxes) {
      if (b.terminal) continue;
      const { x, y, z, sx, sy, sz, material } = b;
      if (material === 'glow') {
        const lamp = y > 5 && y < h;
        const hex = lamp ? (lampIndex++ % 2 === 0 ? look.strip : look.stripAlt) : look.accent;
        emit.addBox(x, y, z, sx, sy, sz, { rgb: tint(hex, lamp ? look.stripIntensity : look.accentIntensity) });
        if (lamp) fixture(lit, mist, b, tint(look.pool, look.poolIntensity));
        continue;
      }
      const rgb = litColour(material, look, rng);
      if (material === 'crate' || material === 'cover') {
        cargo(lit, decals, b, rgb);
        continue;
      }
      const surface = material === 'floor' ? SURFACE.floor
        : material === 'wall' || material === 'pillar' || material === 'ceiling' ? SURFACE.concrete : SURFACE.metal;
      const enclosure = material === 'floor' || material === 'beam' || material === 'ceiling'
        || (material === 'wall' && sy >= h - 0.01);
      lit.addBox(x, y, z, sx, sy, sz, {
        rgb, uvTile: surface === SURFACE.floor ? TILE.floor : surface === SURFACE.concrete ? TILE.wall : TILE.metal,
        surface: surface + (enclosure ? SURFACE.enclosure : 0), faces: material === 'ceiling' ? FACE.negY : material === 'floor' ? FACE.posY : undefined,
      });
    }

    for (const s of map.solids) {
      if (s.kind !== SOLID_KIND.plinth) continue;
      const cx = (s.min[0] + s.max[0]) / 2, cz = (s.min[2] + s.max[2]) / 2;
      const dx = (s.max[0] - s.min[0]) / 2, dz = (s.max[2] - s.min[2]) / 2;
      const onX = Math.abs(cx) > Math.abs(cz);
      floorPaint(decals, onX ? cx - Math.sign(cx) * (dx + 0.3) : cx,
        onX ? cz : cz - Math.sign(cz) * (dz + 0.3), onX ? 0.18 : 0.7, onX ? 0.7 : 0.18,
        0.015, [1, 1, 1], [0.008, 0.015, 0.992, 0.485]);
    }
    if (map.theme === 'cryo') for (const d of towerRings(map, look)) route(d, lit, emit);
    if (map.theme === 'archive') map.solids.forEach((s, i) => {
      if (s.kind === SOLID_KIND.rack) for (const d of serverPanels(s, look, i + 1)) route(d, lit, emit);
      if (s.kind === SOLID_KIND.deck) for (const d of catwalkRail(s, look)) route(d, lit, emit);
    });

    const stencil = tint(look.stencil);
    for (const f of perimeterFaces(map)) {
      services(lit, emit, mist, f, h);
      // Sector 01's core already identifies the room ahead; mark only the entry wall behind spawn.
      if (map.id === 0 && (f.axis !== 'z' || f.dir !== -1)) continue;
      const labelFace = map.id === 0 ? { ...f, centre: f.centre - 5.4 } : f;
      wallDecal(decals, labelFace, 2.45, 0.66, h * 0.54, STENCIL_UV, stencil);
    }
    if (map.id === 0) {
      controlCore(map, lit, decals, emit, mist, stencil);
      controlRunway(lit, decals);
      planters(map, lit);
      serviceBay(lit, emit, decals, mist);
      serviceNotes(lit, emit, mist);
    }

    this.terminals = map.nodes.length ? new TerminalConsoles(map, lit) : null;
    const surfaces = shared ?? new ArenaSurfaces();
    const geo = lit.build();
    groupSurfaces(geo);
    const caster = new THREE.Mesh(geo, surfaces.materials);
    caster.castShadow = caster.receiveShadow = true;
    caster.customDepthMaterial = interiorDepth();
    this.group.add(caster);
    this.disposables.push(geo, caster.customDepthMaterial);
    if (!shared) this.disposables.push(surfaces);
    this.add(emit, this.emissives());
    this.add(mist, this.atmosphere());
    const decalCanvas = paintDecalAtlas(factory, `SECTOR 0${map.id + 1}`);
    const decalMap = decalCanvas ? toCanvasTexture(decalCanvas, { wrap: false }) : null;
    if (decalMap) this.disposables.push(decalMap);
    const ink = new THREE.MeshStandardMaterial({
      vertexColors: true, map: decalMap, roughness: 0.94, alphaTest: 0.45, envMapIntensity: 0.49,
    });
    const printed = this.add(decals, ink);
    printed.visible = decalMap !== null;
    printed.receiveShadow = true;
    if (this.terminals) this.group.add(this.terminals.batch);
  }

  setTime(seconds: number): void { this.time.value = seconds; }
  setQuality(preset: QualityName): void {
    this.glossy.value = preset === 'low' ? 0 : 1;
  }

  dispose(): void {
    this.terminals?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.group.removeFromParent();
  }

  private add(builder: MeshBuilder, mat: THREE.Material): THREE.Mesh {
    const geo = builder.build();
    const mesh = new THREE.Mesh(geo, mat);
    this.group.add(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  private emissives(): THREE.MeshBasicMaterial {
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <color_pars_vertex>', '#include <color_pars_vertex>\nattribute float aBlink;\nvarying float vBlink;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvBlink = aBlink;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform float uTime;\nvarying float vBlink;')
        .replace('#include <color_fragment>', '#include <color_fragment>\nif (vBlink > 0.0) diffuseColor.rgb *= mix(0.18, 1.0, step(0.5, fract(uTime * 1.7 + vBlink)));');
    };
    mat.customProgramCacheKey = () => 'bp-unlit-blink';
    return mat;
  }

  private atmosphere(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { uGlossy: this.glossy },
      vertexColors: true,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
      // Additive lights output alpha zero; premultiplied wear can also darken the floor.
      premultipliedAlpha: true,
      vertexShader: `
        uniform float uGlossy;
        attribute float aSurface;
        varying vec2 vCard;
        varying vec3 vLight;
        varying vec3 vWorld;
        flat varying float vMode;
        void main() {
          vCard = uv;
          vLight = color;
          vMode = aSurface;
          vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = aSurface > 1.5 && aSurface < 2.5 && uGlossy < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0)
            : projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying vec2 vCard;
        varying vec3 vLight;
        varying vec3 vWorld;
        flat varying float vMode;
        void main() {
          vec2 xy = 2.0 * vCard - 1.0;
          float a;
          if (vMode < 0.5) {
            a = pow(max(0.0, 1.0 - dot(xy, xy)), 2.0) * 0.52;
          } else if (vMode < 1.5) {
            a = pow(max(0.0, 1.0 - xy.x * xy.x), 3.0) * smoothstep(0.06, 0.85, vCard.y)
              * (1.0 - smoothstep(0.94, 1.0, vCard.y)) * 0.18;
          } else if (vMode < 2.5) {
            float grazing = 1.0 - abs(normalize(cameraPosition - vWorld).y);
            float ripple = 0.50 + 0.50 * sin(vWorld.z * 34.0 + sin(vWorld.x * 28.0) * 2.5);
            a = pow(max(0.0, 1.0 - abs(xy.x)), 1.5) * pow(max(0.0, 1.0 - abs(xy.y)), 4.0)
              * (0.3 + 0.7 * ripple) * grazing * 0.83;
          } else {
            float grain = fract(sin(dot(floor(vWorld.xz * vec2(153.0, 181.0)), vec2(86.7, 231.9))) * 17251.3);
            float ellipse = dot(xy, xy);
            float edge = pow(max(0.0, 1.0 - ellipse * (0.96 + 0.14 * grain)), 1.8);
            a = edge * (vMode < 3.5 ? 0.77 : 0.29) * (0.54 + 0.46 * grain);
          }
          gl_FragColor = vec4(vLight, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor.rgb *= a;
          if (vMode < 2.5) gl_FragColor.a = 0.0;
        }`,
    });
  }
}

function route(d: DressBox, lit: MeshBuilder, emit: MeshBuilder): void {
  (d.role === 'lit' ? lit : emit).addBox(d.x, d.y, d.z, d.sx, d.sy, d.sz, {
    rgb: tint(d.hex, d.intensity), faces: d.faces, uvTile: TILE_M, surface: SURFACE.metal, blink: d.blink,
  });
}

export function litColour(material: Material, look: ThemeLook, rng: () => number): Tint {
  const hex = MATERIAL_COLORS[material];
  if (material !== 'wall' && material !== 'trim') return tint(hex);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v + (rng() * 2 - 1) * 6)) / 255;
  const base = new THREE.Color().setRGB(clamp(hex >> 16), clamp((hex >> 8) & 255), clamp(hex & 255), THREE.SRGBColorSpace);
  base.multiply(new THREE.Color(look.wallTint));
  return [base.r, base.g, base.b];
}
