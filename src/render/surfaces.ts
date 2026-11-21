import * as THREE from 'three';
import { applyFinishes, FINISH_SURFACE } from './finishes';

export const SURFACE = { floor: 0, concrete: 1, metal: 2, enclosure: 3, foliage: 6 } as const;
export const TILE = { floor: 4, wall: 3, metal: 1.5 } as const;
const NAMES = ['floor', 'wall', 'metal'] as const;
const SUFFIXES = ['diff', 'nor', 'arm'] as const;

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

  load(renderer: THREE.WebGLRenderer, changed: () => void): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    NAMES.forEach((name, i) => {
      const ready = SUFFIXES.map((suffix) => new Promise<THREE.Texture>((resolve, reject) => {
        const texture = loader.load(`${import.meta.env.BASE_URL}assets/textures/${name}_${suffix}.webp`, resolve, undefined, reject);
        texture.colorSpace = suffix === 'diff' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = anisotropy;
        this.maps.add(texture);
      }));
      void Promise.all(ready).then(([diff, normal, arm]) => {
        if (this.disposed) return;
        const mat = this.materials[i];
        mat.map = diff;
        mat.normalMap = normal;
        mat.normalScale.setScalar([0.42, 0.74, 0.47][i]);
        if (i === SURFACE.floor) {
          // ARM multiplies the roughness and would undo the matte base. Leave
          // damp highlights to the local streaks instead of coating the slab.
          mat.aoMap = arm;
          mat.aoMapIntensity = 0.38;
        } else {
          mat.roughnessMap = mat.metalnessMap = arm;
          mat.metalness = i === SURFACE.metal ? 0.66 : 1;
        }
        mat.needsUpdate = true;
        changed();
      }).catch((error: unknown) => {
        if (!this.disposed) console.warn(`PBR ${name}: using untextured material`, error);
      });
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
