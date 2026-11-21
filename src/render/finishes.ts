import * as THREE from 'three';

/** sRGB swatches; PBR values are linear factors. Amber is infrastructure, mint is gameplay. */
export const FINISH = {
  polymer: { color: 0x222932, roughness: 0.83, metalness: 0.06 },
  paint: { color: 0x526977, roughness: 0.79, metalness: 0.24 },
  steel: { color: 0x85969f, roughness: 0.49, metalness: 0.54 },
  rubber: { color: 0x182228, roughness: 0.98, metalness: 0 },
  glass: { color: 0x447782, roughness: 0.21, metalness: 0.08 },
  emissive: { color: 0xffae60 },
} as const;

// These IDs sort into the existing metal draw. Enclosure still uses IDs 3–5.
export const FINISH_SURFACE = { paint: 7, steel: 8, polymer: 9, rubber: 10, glass: 11 } as const;

/** Read finish per face, not per draw: one metal texture set and one material program.
 * Plain dielectric components use their vertex tint without a tread pattern. */
export function applyFinishes(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aSurface;\nflat varying float vFinish;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFinish = aSurface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nflat varying float vFinish;')
      .replace('#include <map_fragment>', `
        float finishMap = vFinish < 7.0 ? 1.0 : vFinish < 8.0 ? 0.48 : vFinish < 9.0 ? 0.19 : 0.0;
        #ifdef USE_MAP
          diffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), finishMap);
        #endif`)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = vFinish < 7.0 ? roughness : vFinish < 8.0 ? ${FINISH.paint.roughness}
          : vFinish < 9.0 ? ${FINISH.steel.roughness} : vFinish < 10.0 ? ${FINISH.polymer.roughness}
          : vFinish < 11.0 ? ${FINISH.rubber.roughness} : ${FINISH.glass.roughness};
        #ifdef USE_ROUGHNESSMAP
          roughnessFactor *= mix(1.0, texture2D(roughnessMap, vRoughnessMapUv).g, finishMap);
        #endif`)
      .replace('#include <metalnessmap_fragment>', `
        float metalnessFactor = vFinish < 7.0 ? metalness : vFinish < 8.0 ? ${FINISH.paint.metalness}
          : vFinish < 9.0 ? ${FINISH.steel.metalness} : vFinish < 10.0 ? ${FINISH.polymer.metalness}
          : vFinish < 11.0 ? 0.0 : ${FINISH.glass.metalness};
        #ifdef USE_METALNESSMAP
          metalnessFactor *= mix(1.0, texture2D(metalnessMap, vMetalnessMapUv).b, finishMap);
        #endif`)
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * finishMap;'));
  };
  material.customProgramCacheKey = () => 'bp-industrial-finishes';
}
