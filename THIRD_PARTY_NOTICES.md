# Avisos de terceros

Inventario de dependencias directas, transitivas y variantes de plataforma de
los locks. Que un paquete figure aquí no significa que se incluya en el build
web ni que se compile en todas las plataformas.

## Rust

Inventario generado de los campos `name` y `version` de las entradas con
`source` en `Cargo.lock` (149 familias). `core/Cargo.lock` no añade familias:
el único crate de terceros del núcleo es `libm 0.2.16`. `bp-api`, `bp-server`
y `bp-core` son código propio.

| Componente | Uso | Licencia declarada |
|---|---|---|
| `libm` | Matemática determinista en el núcleo | MIT |
| `ureq` | HTTPS para Upstash Redis REST | MIT OR Apache-2.0 |
| `vercel_runtime` | Runtime HTTP de las funciones Rust | Apache-2.0 |
| `tokio` | Ejecutor asíncrono de las funciones | MIT |

Para cada versión, los avisos y textos de licencia son los publicados por el
crate correspondiente (`Cargo.toml`, archivos `LICENSE*`, `COPYING*` o `NOTICE*`
en su distribución de crates.io).

`atomic-waker 1.1.2`, `base64 0.22.1/0.23.1`, `bitflags 2.13.2`, `block-buffer 0.12.1`,
`bytes 1.12.2`, `cc 1.11.3`, `cfg-if 1.0.5`, `cmov 0.5.4`,
`const-oid 0.10.3`, `cookie 0.18.2`, `cookie_store 0.22.1`, `core-foundation 0.9.4`,
`core-foundation-sys 0.8.7`, `cpufeatures 0.3.1`, `crypto-common 0.2.2`, `ctutils 0.4.8`,
`deranged 0.5.9`, `digest 0.11.3`, `displaydoc 0.2.7`, `document-features 0.2.12`,
`equivalent 1.0.3`, `errno 0.3.15`, `find-msvc-tools 0.1.15`, `fnv 1.0.7`,
`form_urlencoded 1.2.2`, `futures-channel 0.3.34`, `futures-core 0.3.34`, `futures-macro 0.3.34`,
`futures-sink 0.3.34`, `futures-task 0.3.34`, `futures-util 0.3.34`, `getrandom 0.2.17`,
`h2 0.4.20`, `hashbrown 0.17.1`, `hmac 0.13.0`, `http 1.5.0`,
`http-body 1.1.0`, `http-body-util 0.1.5`, `httparse 1.10.1`, `httpdate 1.0.3`,
`hybrid-array 0.4.15`, `hyper 1.12.0`, `hyper-util 0.1.21`, `icu_collections 2.4.0`,
`icu_locale_core 2.4.0`, `icu_normalizer 2.4.0`, `icu_normalizer_data 2.4.0`, `icu_properties 2.4.0`,
`icu_properties_data 2.4.0`, `icu_provider 2.4.0`, `idna 1.1.0`, `idna_adapter 1.2.2`,
`indexmap 2.14.2`, `ipnet 2.12.2`, `itoa 1.0.19`, `lazy_static 1.5.1`,
`libc 0.2.191`, `libm 0.2.16`, `litemap 0.8.3`, `litrs 1.0.1`,
`lock_api 0.4.14`, `log 0.4.35`, `memchr 2.8.3`, `mio 1.2.5`,
`num-conv 0.2.2`, `once_cell 1.21.4`, `parking_lot 0.12.5`, `parking_lot_core 0.9.12`,
`percent-encoding 2.3.2`, `pin-project-lite 0.2.18`, `potential_utf 0.1.6`, `powerfmt 0.2.1`,
`proc-macro2 1.0.107`, `quote 1.0.47`, `redox_syscall 0.5.18`, `ring 0.17.14`,
`rustls 0.23.46`, `rustls-pki-types 1.16.0`, `rustls-webpki 0.103.17`, `scopeguard 1.2.0`,
`serde 1.0.229`, `serde_core 1.0.229`, `serde_derive 1.0.229`, `serde_json 1.0.154`,
`sha2 0.11.1`, `shlex 2.0.1`, `signal-hook-registry 1.4.8`, `slab 0.4.12`,
`smallvec 1.16.6`, `socket2 0.6.5`, `stable_deref_trait 1.2.1`, `subtle 2.6.1`,
`syn 3.0.10`, `sync_wrapper 1.0.2`, `synstructure 0.14.0`, `system-configuration 0.7.0`,
`system-configuration-sys 0.6.0`, `time 0.3.55`, `time-core 0.1.9`, `time-macros 0.2.32`,
`tinystr 0.8.5`, `tokio 1.54.1`, `tokio-macros 2.7.2`, `tokio-stream 0.1.19`,
`tokio-util 0.7.20`, `tower 0.5.3`, `tower-layer 0.3.3`, `tower-service 0.3.3`,
`tracing 0.1.44`, `tracing-core 0.1.36`, `try-lock 0.2.5`, `typenum 1.20.1`,
`unicode-ident 1.0.27`, `untrusted 0.9.0`, `ureq 3.5.2`, `ureq-proto 0.7.1`,
`url 2.5.8`, `utf8-zero 0.8.1`, `utf8_iter 1.1.0`, `utf_types 1.0.0`,
`vercel_runtime 2.4.1`, `version_check 0.9.5`, `want 0.3.2`, `wasi 0.11.1+wasi-snapshot-preview1`,
`webpki-roots 1.0.12`, `windows-link 0.2.1`, `windows-registry 0.6.1`, `windows-result 0.4.1`,
`windows-strings 0.5.1`, `windows-sys 0.52.0/0.61.2`, `windows-targets 0.52.6`, `windows_aarch64_gnullvm 0.52.6`,
`windows_aarch64_msvc 0.52.6`, `windows_i686_gnu 0.52.6`, `windows_i686_gnullvm 0.52.6`, `windows_i686_msvc 0.52.6`,
`windows_x86_64_gnu 0.52.6`, `windows_x86_64_gnullvm 0.52.6`, `windows_x86_64_msvc 0.52.6`, `writeable 0.6.4`,
`yoke 0.8.4`, `yoke-derive 0.8.4`, `zerofrom 0.1.8`, `zerofrom-derive 0.1.8`,
`zeroize 1.9.2`, `zerotrie 0.2.5`, `zerovec 0.11.9`, `zerovec-derive 0.11.7`,
`zmij 1.0.23`.

## Paquetes de Bun

`three` (MIT) es la dependencia directa de render en runtime. Dependencias
básicas de desarrollo: `vite`, `vitest` y `@types/three` (MIT), `typescript`
y `@playwright/test` (Apache-2.0). Las licencias y avisos de cada paquete son
los de su distribución, junto a `package.json` en `node_modules` tras instalar.
Inventario de `bun.lock`: 114 familias de paquetes con sus versiones resueltas.

| Versiones | Paquetes |
|---|---|
| 0.12.0 | `@dimforge/rapier3d-compat` |
| 0.25.12 | `@esbuild/aix-ppc64`, `@esbuild/android-arm`, `@esbuild/android-arm64`, `@esbuild/android-x64`, `@esbuild/darwin-arm64`, `@esbuild/darwin-x64`, `@esbuild/freebsd-arm64`, `@esbuild/freebsd-x64`, `@esbuild/linux-arm`, `@esbuild/linux-arm64`, `@esbuild/linux-ia32`, `@esbuild/linux-loong64`, `@esbuild/linux-mips64el`, `@esbuild/linux-ppc64`, `@esbuild/linux-riscv64`, `@esbuild/linux-s390x`, `@esbuild/linux-x64`, `@esbuild/netbsd-arm64`, `@esbuild/netbsd-x64`, `@esbuild/openbsd-arm64`, `@esbuild/openbsd-x64`, `@esbuild/openharmony-arm64`, `@esbuild/sunos-x64`, `@esbuild/win32-arm64`, `@esbuild/win32-ia32`, `@esbuild/win32-x64`, `esbuild` |
| 1.6.0 | `@jridgewell/sourcemap-codec` |
| 1.56.1 | `@playwright/test`, `playwright`, `playwright-core` |
| 4.68.7 | `@rollup/rollup-android-arm-eabi`, `@rollup/rollup-android-arm64`, `@rollup/rollup-android-x64`, `@rollup/rollup-darwin-arm64`, `@rollup/rollup-darwin-x64`, `@rollup/rollup-freebsd-arm64`, `@rollup/rollup-freebsd-x64`, `@rollup/rollup-linux-arm-gnueabihf`, `@rollup/rollup-linux-arm-musleabihf`, `@rollup/rollup-linux-arm64-gnu`, `@rollup/rollup-linux-arm64-musl`, `@rollup/rollup-linux-loong64-gnu`, `@rollup/rollup-linux-loong64-musl`, `@rollup/rollup-linux-ppc64-gnu`, `@rollup/rollup-linux-ppc64-musl`, `@rollup/rollup-linux-riscv64-gnu`, `@rollup/rollup-linux-riscv64-musl`, `@rollup/rollup-linux-s390x-gnu`, `@rollup/rollup-linux-x64-gnu`, `@rollup/rollup-linux-x64-musl`, `@rollup/rollup-openbsd-x64`, `@rollup/rollup-openharmony-arm64`, `@rollup/rollup-win32-arm64-msvc`, `@rollup/rollup-win32-ia32-msvc`, `@rollup/rollup-win32-x64-gnu`, `@rollup/rollup-win32-x64-msvc`, `rollup` |
| 23.1.3 | `@tweenjs/tween.js` |
| 5.2.3 | `@types/chai` |
| 4.0.2 | `@types/deep-eql` |
| 1.0.10 | `@types/estree` |
| 0.17.4 | `@types/stats.js` |
| 0.181.0 | `@types/three`, `three` |
| 0.5.24 | `@types/webxr` |
| 3.2.4 | `@vitest/expect`, `@vitest/mocker`, `@vitest/runner`, `@vitest/snapshot`, `@vitest/spy`, `@vitest/utils`, `vite-node`, `vitest` |
| 3.2.4, 3.2.7 | `@vitest/pretty-format` |
| 0.1.74 | `@webgpu/types` |
| 2.0.1 | `assertion-error`, `pathval` |
| 6.7.14 | `cac` |
| 5.3.3 | `chai` |
| 2.1.3 | `check-error`, `ms` |
| 4.4.3 | `debug` |
| 5.0.2 | `deep-eql` |
| 1.7.0 | `es-module-lexer` |
| 3.0.3 | `estree-walker` |
| 1.4.0 | `expect-type` |
| 6.5.0 | `fdir` |
| 0.8.3 | `fflate` |
| 2.3.2, 2.3.3 | `fsevents` |
| 9.0.1 | `js-tokens` |
| 3.2.1 | `loupe` |
| 0.30.21 | `magic-string` |
| 0.22.0 | `meshoptimizer` |
| 3.3.20 | `nanoid` |
| 2.0.3 | `pathe` |
| 1.1.1 | `picocolors`, `tinypool` |
| 4.0.7 | `picomatch` |
| 8.5.33 | `postcss` |
| 2.0.0 | `siginfo`, `tinyrainbow` |
| 1.2.4 | `source-map-js` |
| 0.0.2 | `stackback` |
| 3.10.0 | `std-env` |
| 3.1.0 | `strip-literal` |
| 2.9.0 | `tinybench` |
| 0.3.2 | `tinyexec` |
| 0.2.17 | `tinyglobby` |
| 4.0.6 | `tinyspy` |
| 5.9.3 | `typescript` |
| 7.1.12 | `vite` |
| 2.3.0 | `why-is-node-running` |

## Assets del juego

| Origen | Archivos | Licencia |
|---|---|---|
| Poly Haven: [Industrial Pipe & Valve 02](https://polyhaven.com/a/industrial_pipe_and_valve_02) | `industrial_pipe_and_valve_02_1k.hdr` | CC0 1.0 |
| Poly Haven: [Concrete Floor](https://polyhaven.com/a/concrete_floor), [Concrete Block Wall](https://polyhaven.com/a/concrete_block_wall), [Metal Plate](https://polyhaven.com/a/metal_plate) | Las nueve texturas `floor`, `wall` y `metal`: color, normal y ARM | CC0 1.0 |
| Kenney: [Starter Kit FPS](https://github.com/KenneyNL/Starter-Kit-FPS) | `blaster.glb`, `blaster-repeater.glb`, `models/Textures/colormap.png` (atlas modificado), `models/Textures/colormap-original.png` (original intacto) | MIT |

Las licencias copiadas están en `public/assets/licenses/`; los archivos,
referencias y hashes individuales están en `public/assets/manifest.json`.
El proyecto remapeó la paleta del atlas `colormap.png` a gris metal, menta y
un acento cálido. Los dos GLB siguen referenciando ese atlas y no se modificaron.
Los decals, la geometría de la arena y los enemigos son propios. Se usan fuentes
del sistema y audio sintetizado; no se distribuyen fuentes embebidas.

## Tokens de diseño

La paleta azul-negra y sus acentos menta y de peligro provienen de los mockups
del dueño del proyecto, no de sebita.dev ni de otro sitio. Ver
[`docs/adr/0002-visual-direction.md`](docs/adr/0002-visual-direction.md).
