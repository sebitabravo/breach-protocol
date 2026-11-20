#!/usr/bin/env node
/**
 * Builds the Rust simulation core for wasm32-unknown-unknown and copies the
 * artifact into public/ so Vite serves it next to the app.
 *
 * The build fails loudly when the toolchain keeps the artifact from being
 * usable, because a silent fallback would ship a broken game.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const crate = join(root, 'core');
const target = 'wasm32-unknown-unknown';
const artifact = join(crate, 'target', target, 'release', 'bp_core.wasm');
const outDir = join(root, 'public');
const outFile = join(outDir, 'bp_core.wasm');

function fail(message) {
  console.error(`[build:wasm] ${message}`);
  process.exit(1);
}

try {
  execFileSync('cargo', ['build', '--manifest-path', join(crate, 'Cargo.toml'), '--release', '--target', target], {
    stdio: 'inherit',
    env: { ...process.env, RUSTFLAGS: process.env.RUSTFLAGS ?? '' },
  });
} catch {
  fail('cargo build failed; install the target with `rustup target add wasm32-unknown-unknown`');
}

mkdirSync(outDir, { recursive: true });
copyFileSync(artifact, outFile);

const bytes = statSync(outFile).size;
const binary = readFileSync(outFile);
// wasm magic number, then check the module exports the linear memory we read snapshots from.
const magic = binary.subarray(0, 4).toString('hex');
if (magic !== '0061736d') fail('artifact is not a WebAssembly module');

const text = binary.toString('latin1');
const required = ['bp_init', 'bp_reset', 'bp_tick', 'bp_snapshot_ptr', 'bp_set_arena', 'bp_alloc', 'bp_free', 'memory'];
const missing = required.filter((name) => !text.includes(name));
if (missing.length > 0) fail(`artifact is missing exports: ${missing.join(', ')}`);

writeFileSync(join(outDir, 'bp_core.build.json'), `${JSON.stringify({ bytes, target, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`[build:wasm] ok — ${(bytes / 1024).toFixed(1)} KiB -> public/bp_core.wasm`);
