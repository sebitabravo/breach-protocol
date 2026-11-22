import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as THREE from 'three';
import { ArenaSurfaces, compressedFormatSupport, MAP_NAMES, MAP_SUFFIXES, textureUrl,
  TEXTURE_VARIANTS } from '../../src/render/surfaces';

interface ManifestFile { name: string; suffix: string; encodeClass: string; bytes: number }
interface TextureManifest { tool: string; version: string; files: ManifestFile[] }

// T5d / S10 — GPU-compressed (KTX2/Basis) textures behind the existing WebP
// fallback. The contract pinned here: a device that reports no supported
// compressed format must take the exact WebP path of today; a device with at
// least one supported format takes KTX2; any failed KTX2 fetch/transcode falls
// back to WebP for that material instead of leaving a black or missing map; and
// every map slot must have both variants on disk (or the manifest must say why
// not). All fixtures are fakes defined here: no real renderer or network.

type FakeExtensions = { has: (name: string) => boolean };

function fakeRenderer(extensions: string[]): { extensions: FakeExtensions } {
  const known = new Set(extensions);
  return { extensions: { has: (name) => known.has(name) } };
}

interface Reaction {
  ktx2Urls: string[];
  webpUrls: string[];
  failKtx2: boolean;
  failWebp: boolean;
}

function stubDeps(reactions: Reaction[]): {
  deps: Parameters<ArenaSurfaces['load']>[2];
  applied: { material: number; diff: THREE.Texture }[];
  reactions: Reaction[];
} {
  let nextMaterial = 0;
  let calls = 0;
  const applied: { material: number; diff: THREE.Texture }[] = [];
  const shifted = reactions;
  const deps = {
    loadKtx2: (_suffix: string, url: string) => {
      nextMaterial = Math.floor(calls / 3);
      const reaction = shifted[Math.min(nextMaterial, shifted.length - 1)];
      calls += 1;
      reaction.ktx2Urls.push(url);
      if (reaction.failKtx2) return Promise.reject(new Error(`ktx2 broke: ${url}`));
      return Promise.resolve(new THREE.Texture());
    },
    loadTexture: (_suffix: string, url: string) => {
      nextMaterial = Math.floor(calls / 3);
      const reaction = shifted[Math.min(nextMaterial, shifted.length - 1)];
      calls += 1;
      reaction.webpUrls.push(url);
      if (reaction.failWebp) return Promise.reject(new Error(`webp broke: ${url}`));
      const texture = new THREE.Texture();
      applied.push({ material: nextMaterial, diff: texture });
      return Promise.resolve(texture);
    },
  };
  return { deps: deps as Parameters<ArenaSurfaces['load']>[2], applied, reactions: shifted };
}

/** Drive one material's notification through the real load() flow. */
async function runOneLoad(reaction: Reaction): Promise<void> {
  const surfaces = new ArenaSurfaces();
  const { deps } = stubDeps([reaction]);
  await new Promise<void>((resolve, reject) => {
    try {
      surfaces.load(fakeRenderer(['WEBGL_compressed_texture_s3tc']) as never, () => resolve(), deps);
    } catch (error) {
      reject(error as Error);
    }
  });
}

/** Promise prompts need one microtask flush deep. */
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

const SL3TC = 'WEBGL_compressed_texture_s3tc';

it('a device with no compressed format selects WebP', async () => {
  const renderer = fakeRenderer([]);
  expect(compressedFormatSupport(renderer.extensions)).toEqual([]);
  expect(compressedFormatSupport(renderer.extensions).length > 0 ? 'ktx2' : 'webp').toBe('webp');

  const reaction: Reaction = { ktx2Urls: [], webpUrls: [], failKtx2: false, failWebp: false };
  const fixture = stubDeps([reaction]);
  const surfaces = new ArenaSurfaces();
  void surfaces.load(renderer as never, () => {}, fixture.deps);
  await flush();
  expect(fixture.reactions[0].ktx2Urls).toEqual([]);
  expect(fixture.reactions[0].webpUrls.map((url) => url.split('/').pop()))
    .toEqual(['floor_diff.webp', 'floor_nor.webp', 'floor_arm.webp',
      'wall_diff.webp', 'wall_nor.webp', 'wall_arm.webp',
      'metal_diff.webp', 'metal_nor.webp', 'metal_arm.webp']);
});

it('a device with at least one supported compressed format selects KTX2', () => {
  expect(compressedFormatSupport(fakeRenderer([SL3TC]).extensions)).toEqual([SL3TC]);
  expect(compressedFormatSupport(fakeRenderer(['EXT_texture_compression_bptc']).extensions).length).toBe(1);
  expect(compressedFormatSupport(fakeRenderer([SL3TC]).extensions).length > 0 ? 'ktx2' : 'webp').toBe('ktx2');
});

it('KTX2 selection requests the committed ktx2 artifacts, not WebP', async () => {
  const reaction: Reaction = { ktx2Urls: [], webpUrls: [], failKtx2: false, failWebp: false };
  await runOneLoad(reaction);
  await flush();
  expect(reaction.ktx2Urls.map((url) => url.split('/').pop()))
    .toEqual(['floor_diff.ktx2', 'floor_nor.ktx2', 'floor_arm.ktx2',
      'wall_diff.ktx2', 'wall_nor.ktx2', 'wall_arm.ktx2',
      'metal_diff.ktx2', 'metal_nor.ktx2', 'metal_arm.ktx2']);
  expect(reaction.webpUrls).toEqual([]);
});

it('a failed KTX2 load falls back to WebP for that material', async () => {
  const reaction: Reaction = { ktx2Urls: [], webpUrls: [], failKtx2: true, failWebp: false };
  const fixture = stubDeps([reaction]);
  const surfaces = new ArenaSurfaces();
  void surfaces.load(fakeRenderer([SL3TC]) as never, () => {}, fixture.deps);
  await flush();
  expect(reaction.ktx2Urls.length).toBe(9);
  expect(reaction.webpUrls.map((url) => url.split('/').pop()))
    .toEqual(['floor_diff.webp', 'floor_nor.webp', 'floor_arm.webp',
      'wall_diff.webp', 'wall_nor.webp', 'wall_arm.webp',
      'metal_diff.webp', 'metal_nor.webp', 'metal_arm.webp']);
  // The fallback finishes the job: every material actually gets its set
  // (three maps per material were loaded through the WebP seam).
  expect(fixture.applied.length).toBe(9);
  expect(surfaces.materials[0].map).toBe(fixture.applied[0].diff);
});

it('a material whose WebP fallback also fails leaves the untextured material, never a half-set', async () => {
  const surfaces = new ArenaSurfaces();
  const before = surfaces.materials.map((m) => m.map);
  let notified = false;
  void surfaces.load(fakeRenderer([SL3TC]) as never, () => { notified = true; }, {
    loadKtx2: () => Promise.reject(new Error('no ktx2')),
    loadTexture: () => Promise.reject(new Error('no webp')),
  } as never);
  await flush();
  expect(surfaces.materials.map((m) => m.map)).toEqual(before);
  expect(notified).toBe(false);
});

it('every material map slot has both variants on disk', () => {
  expect(TEXTURE_VARIANTS).toContain('ktx2');
  expect(TEXTURE_VARIANTS).toContain('webp');
  for (const name of MAP_NAMES) {
    for (const suffix of MAP_SUFFIXES) {
      const webp = readFileSync(new URL(`../../public/assets/textures/${name}_${suffix}.webp`, import.meta.url));
      const ktx2 = readFileSync(new URL(`../../public/assets/textures/ktx2/${name}_${suffix}.ktx2`, import.meta.url));
      expect(webp.length, `${name}_${suffix}.webp`).toBeGreaterThan(0);
      expect(ktx2.length, `${name}_${suffix}.ktx2`).toBeGreaterThan(0);
      expect(textureUrl('webp', name, suffix)).toContain(`assets/textures/${name}_${suffix}.webp`);
      expect(textureUrl('ktx2', name, suffix)).toContain(`assets/textures/ktx2/${name}_${suffix}.ktx2`);
    }
  }
});

it('the ktx2 manifest records the encoder, version and per-file encode class', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/assets/textures/ktx2/manifest.json', import.meta.url), 'utf8')) as TextureManifest;
  expect(manifest.tool).toBe('toktx');
  expect(manifest.version).toMatch(/^v?\d+\.\d+/);
  for (const name of MAP_NAMES) {
    for (const suffix of MAP_SUFFIXES) {
      const entry = manifest.files.find((file) => file.name === name && file.suffix === suffix);
      expect(entry, `${name}_${suffix} in manifest`).toBeDefined();
      expect(['etc1s', 'uastc'], `${name}_${suffix} clase declarada`).toContain(entry!.encodeClass);
    }
  }
});

it('the Basis transcoder is vendored from the three package', () => {
  const js = readFileSync(new URL('../../public/basis/basis_transcoder.js', import.meta.url));
  const wasm = readFileSync(new URL('../../public/basis/basis_transcoder.wasm', import.meta.url));
  const bundled = readFileSync(new URL('../../node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm', import.meta.url));
  const served = readFileSync(new URL('../../public/basis/basis_transcoder.wasm', import.meta.url));
  const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((byte, i) => byte === b[i]);
  expect(js.length).toBeGreaterThan(0);
  expect(wasm.length).toBe(bundled.length);
  expect(same(served, bundled)).toBe(true);
});
