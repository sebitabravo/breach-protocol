#!/usr/bin/env node
/**
 * Encodes the existing 1024x1024 WebP PBR maps to KTX2 (Basis Universal) with
 * `toktx` (KTX-Software) and vendors the Basis transcoder shipped inside the
 * `three` package. NOT part of `bun run build`: a checkout without the encoder
 * keeps building and running exactly as today because the generated `.ktx2`
 * artifacts are committed under public/assets/textures/ktx2/.
 *
 * Run on demand only:  bun scripts/build-textures.mjs
 * Encoder lookup:      $KTX2_TOKTX, or `toktx` on the PATH.
 *
 * Encode classes (deliberate, not uniform):
 * - `*_nor` → UASTC 4x4, no RDO. Normal maps store unit-length gradient
 *   vectors; every block error shows up as lighting wobble. UASTC keeps
 *   block-local gradients faithful and transcodes cleanly to BC7/BC3/ASTC,
 *   while ETC1S endpoint quantization visibly distorts normals.
 * - `*_diff`, `*_arm` → ETC1S clevel 4, qlevel 200. Albedo color and the
 *   AO/roughness/metalness channels tolerate 4x4 lossy quantization and gain a
 *   ~4x smaller payload than UASTC; the high qlevel keeps roughness/metalness
 *   banding out of the specular response.
 */
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const texturesDir = join(root, 'public', 'assets', 'textures');
const ktx2Dir = join(texturesDir, 'ktx2');
const basisDir = join(root, 'public', 'basis');
const threeBasis = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
const NAMES = ['floor', 'wall', 'metal'];
const SUFFIXES = ['diff', 'nor', 'arm'];
const THREE_VERSION = JSON.parse(readFileSync(join(root, 'node_modules', 'three', 'package.json'), 'utf8')).version;
// 1024x1024 mip chain must fit a 4x4-block format budget (1 byte/px worst case for UASTC).
const MIPPED_BLOCK_BUDGET = Math.ceil(1024 * 1024 * 4 / 3);

function fail(message) {
  console.error(`[build:textures] ${message}`);
  process.exit(1);
}

function toktx() {
  const found = process.env.KTX2_TOKTX ?? 'toktx';
  try {
    // toktx imprime --version en stderr, no en stdout.
    const printed = spawnSync(found, ['--version'], { encoding: 'utf8' }).stderr.trim();
    const version = printed.match(/v?[0-9]+\.[0-9]+[0-9.]*/)?.[0] ?? printed;
    if (!version) fail(`${found} no reporta versión utilizable`);
    return { bin: found, version };
  } catch (error) {
    fail(`toktx no está utilizable (${error.message ?? error}). Define KTX2_TOKTX o instala KTX-Software. ` +
      'Este script es solo bajo demanda; los artefactos ktx2 comprometidos mantienen a CI sin encoder.');
  }
}

function encodeFlags(suffix) {
  if (suffix === 'nor') {
    // UASTC se beneficia de zstd encima: lo reduce ~2x sin pérdida.
    return ['--encode', 'uastc', '--uastc_quality', '2', '--zcmp', '--genmipmap'];
  }
  // ETC1S / BasisLZ ya comprime por sí mismo: zstd le está prohibido.
  return ['--encode', 'etc1s', '--clevel', '4', '--qlevel', '200', '--genmipmap'];
}

const { bin, version } = toktx();
for (const name of NAMES) {
  for (const suffix of SUFFIXES) {
    try {
      statSync(join(texturesDir, `${name}_${suffix}.webp`));
    } catch {
      fail(`fuente faltante: public/assets/textures/${name}_${suffix}.webp`);
    }
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'bp-ktx2-'));
try {
  mkdirSync(ktx2Dir, { recursive: true });
  mkdirSync(basisDir, { recursive: true });
  const files = [];
  for (const name of NAMES) {
    for (const suffix of SUFFIXES) {
      const source = join(texturesDir, `${name}_${suffix}.webp`);
      const png = join(scratch, `${name}_${suffix}.png`);
      execFileSync('sips', ['-s', 'format', 'png', source, '--out', png], { stdio: 'pipe' });
      const out = join(ktx2Dir, `${name}_${suffix}.ktx2`);
      const flags = encodeFlags(suffix);
      execFileSync(bin, [...flags, '--assign_oetf', suffix === 'diff' ? 'srgb' : 'linear', out, png], { stdio: 'pipe' });
      const bytes = statSync(out).size;
      if (bytes === 0) fail(`artefacto vacío: ${basename(out)}`);
      if (bytes > MIPPED_BLOCK_BUDGET) fail(`${basename(out)} (${bytes} B) excede el presupuesto de bloques mip`);
      files.push({
        name, suffix,
        encodeClass: suffix === 'nor' ? 'uastc' : 'etc1s',
        bytes,
        sourceBytes: statSync(source).size,
        flags: flags.join(' '),
        oetf: suffix === 'diff' ? 'srgb' : 'linear',
        sha256: createHash('sha256').update(readFileSync(out)).digest('hex'),
      });
    }
  }
  for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm', 'README.md']) {
    copyFileSync(join(threeBasis, file), join(basisDir, file));
    if (file !== 'README.md') chmodSync(join(basisDir, file), 0o644);
  }
  const manifest = {
    tool: 'toktx',
    version,
    generatedAt: new Date().toISOString(),
    // uastc: zstd (zcmp); etc1s: BasisLZ interno, sin supercompresión extra.
    supercompression: { uastc: 'zstd', etc1s: 'basis-lz' },
    transcoder: { source: 'node_modules/three/examples/jsm/libs/basis/', three: THREE_VERSION },
    files,
  };
  writeFileSync(join(ktx2Dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const totalKtx2 = files.reduce((sum, file) => sum + file.bytes, 0);
  const totalWebp = files.reduce((sum, file) => sum + file.sourceBytes, 0);
  console.log(`[build:textures] ${NAMES.length * SUFFIXES.length} artefactos, ` +
    `${fmtMB(totalKtx2)} ktx2 vs ${fmtMB(totalWebp)} webp fuente, transcoder -> public/basis/`);
  for (const file of files) {
    console.log(`  ${file.name}_${file.suffix}: ${fmt(file.sourceBytes)} webp -> ${fmt(file.bytes)} ktx2 (${file.encodeClass})`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function fmt(bytes) { return `${(bytes / 1024).toFixed(1)} KiB`; }
function fmtMB(bytes) { return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`; }
