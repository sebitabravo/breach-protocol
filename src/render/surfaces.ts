import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { applyFinishes, FINISH_SURFACE } from './finishes';

export const SURFACE = { floor: 0, concrete: 1, metal: 2, enclosure: 3, foliage: 6 } as const;
export const TILE = { floor: 4, wall: 3, metal: 1.5 } as const;
export const MAP_NAMES = ['floor', 'wall', 'metal'] as const;
export const MAP_SUFFIXES = ['diff', 'nor', 'arm'] as const;
export type TextureVariant = 'ktx2' | 'webp';
export const TEXTURE_VARIANTS: readonly TextureVariant[] = ['ktx2', 'webp'];

/** Mirror of the extension list KTX2Loader transcodes against. If a device
 * reports none of these, fetching the ktx2 artifacts would be dead payload and
 * every transcode would fail, so the WebP path of record stays. */
const COMPRESSED_FORMAT_EXTENSIONS = [
  'WEBGL_compressed_texture_astc',
  'WEBGL_compressed_texture_etc1',
  'WEBGL_compressed_texture_etc',
  'WEBGL_compressed_texture_s3tc',
  'EXT_texture_compression_bptc',
  'WEBGL_compressed_texture_pvrtc',
  'WEBKIT_WEBGL_compressed_texture_pvrtc',
] as const;

export function compressedFormatSupport(extensions: { has(name: string): boolean }): string[] {
  return COMPRESSED_FORMAT_EXTENSIONS.filter((name) => extensions.has(name));
}

export function textureUrl(variant: TextureVariant, name: typeof MAP_NAMES[number], suffix: typeof MAP_SUFFIXES[number]): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  return variant === 'ktx2'
    ? `${base}assets/textures/ktx2/${name}_${suffix}.ktx2`
    : `${base}assets/textures/${name}_${suffix}.webp`;
}

export type MapSlot = (typeof MAP_NAMES)[number];
export type MapSuffix = (typeof MAP_SUFFIXES)[number];

/** Injection seam for tests; the production defaults live in
 * `defaultSurfaceDeps` and touch the real loaders. */
export interface SurfaceTextureDeps {
  loadTexture(suffix: MapSuffix, url: string): Promise<THREE.Texture>;
  loadKtx2?(suffix: MapSuffix, url: string): Promise<THREE.Texture>;
}

function defaultSurfaceDeps(renderer: THREE.WebGLRenderer): SurfaceTextureDeps {
  const loader = new THREE.TextureLoader();
  const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const configure = (texture: THREE.Texture, suffix: MapSuffix): void => {
    texture.colorSpace = suffix === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = anisotropy;
  };
  const ktx2 = compressedFormatSupport(renderer.extensions).length
    ? new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`).detectSupport(renderer)
    : null;
  return {
    loadTexture: (suffix, url) => loader.loadAsync(url).then((texture) => {
      configure(texture, suffix);
      return texture;
    }),
    loadKtx2: ktx2 ? (suffix, url) => ktx2.loadAsync(url).then((texture) => {
      configure(texture, suffix);
      return texture;
    }) : undefined,
  };
}

/** Shared by all sectors for the lifetime of one renderer. Start without maps,
 * then commit each material's complete set in one operation. */
export class ArenaSurfaces {
  readonly materials = [
    new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.04,
      clearcoat: 0.035, clearcoatRoughness: 0.88, envMapIntensity: 0.24, specularIntensity: 0.52 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, envMapIntensity: 0.82 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.90, metalness: 0.62, envMapIntensity: 0.95 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.89, side: THREE.DoubleSide, emissive: 0x16200c, emissiveIntensity: 0.5 }),
  ];
  private readonly maps = new Set<THREE.Texture>();
  private started = false;
  private disposed = false;

  constructor() { applyFinishes(this.materials[SURFACE.metal]); }

  load(renderer: THREE.WebGLRenderer, changed: () => void,
    deps: SurfaceTextureDeps = defaultSurfaceDeps(renderer)): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const canKtx2 = compressedFormatSupport(renderer.extensions).length > 0 && deps.loadKtx2 !== undefined;
    MAP_NAMES.forEach((name, i) => this.loadMap(name, i, deps, canKtx2, changed));
  }

  /** One material's complete set commits in one operation, always from a single
   * variant: KTX2 when supported and every fetch/transcode of the set succeeds,
   * otherwise the whole set re-requests WebP. A half-set from two variants
   * would look broken, so it is impossible by construction here. */
  private loadMap(name: MapSlot, index: number, deps: SurfaceTextureDeps, canKtx2: boolean, changed: () => void): void {
    const commit = (maps: THREE.Texture[]): void => {
      if (this.disposed) return;
      maps.forEach((texture) => this.maps.add(texture));
      const [diff, normal, arm] = maps;
      const mat = this.materials[index];
      mat.map = diff;
      mat.normalMap = normal;
      mat.normalScale.setScalar([0.42, 0.74, 0.47][index]);
      if (index === SURFACE.floor) {
        // ARM multiplies the roughness and would undo the matte base. Leave
        // damp highlights to the local streaks instead of coating the slab.
        mat.aoMap = arm;
        mat.aoMapIntensity = 0.38;
      } else {
        mat.roughnessMap = mat.metalnessMap = arm;
        mat.metalness = index === SURFACE.metal ? 0.66 : 1;
      }
      mat.needsUpdate = true;
      changed();
    };
    const webp = (): Promise<THREE.Texture[]> =>
      Promise.all(MAP_SUFFIXES.map((suffix) => deps.loadTexture(suffix, textureUrl('webp', name, suffix))));
    const request = canKtx2
      ? () => Promise.all(MAP_SUFFIXES.map((suffix) => deps.loadKtx2!(suffix, textureUrl('ktx2', name, suffix))))
        .catch((error: unknown) => {
          console.warn(`PBR ${name}: KTX2 failed, retrying with WebP`, error);
          return webp();
        })
      : webp;
    request().then(commit).catch((error: unknown) => {
      if (!this.disposed) console.warn(`PBR ${name}: usando un material sin textura`, error);
    });
  }

  /** Three takes scene.environmentIntensity for inherited IBL. Bind the same
   * PMREM explicitly so only the floor honours its lower intensity cap. */
  setFloorEnvironment(map: THREE.Texture | null, rotation: THREE.Euler): void {
    const floor = this.materials[SURFACE.floor];
    floor.envMap = map;
    floor.envMapRotation.copy(rotation);
    floor.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    for (const map of this.maps) map.dispose();
    this.maps.clear();
    for (const material of this.materials) material.dispose();
  }
}

/** Sort index ranges, not vertices, to keep the lit arena one mesh/four draws. */
export function groupSurfaces(geometry: THREE.BufferGeometry): void {
  const surface = geometry.getAttribute('aSurface');
  const index = geometry.getIndex()!;
  const groups: number[][] = [[], [], [], []];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const id = surface.getX(a);
    groups[id >= FINISH_SURFACE.paint ? SURFACE.metal : id === SURFACE.foliage ? 3 : id % SURFACE.enclosure].push(a, index.getX(i + 1), index.getX(i + 2));
  }
  let offset = 0;
  groups.forEach((indices, material) => {
    if (indices.length) geometry.addGroup(offset, indices.length, material);
    offset += indices.length;
  });
  geometry.setIndex(groups.flat());
}

/** Keep the roof/walls out of the single static interior key shadow pass. */
export function interiorDepth(): THREE.MeshDepthMaterial {
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSurface;\nflat varying float vSurface;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = aSurface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nflat varying float vSurface;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vSurface >= 3.0 && vSurface < 7.0) discard;');
  };
  depth.customProgramCacheKey = () => 'bp-interior-depth';
  return depth;
}
