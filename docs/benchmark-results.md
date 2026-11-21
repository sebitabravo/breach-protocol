# Benchmark results

Measured on one machine. These are not general claims about other hardware.

## Native Overflow through wave 30

```sh
cargo test --release -p bp-server --test overflow_bench -- --ignored --nocapture
```

Una ejecución en **Apple M3 (`aarch64-apple-darwin`), Rust 1.100.0**, perfil `release`.
Medición con el código disponible en ese momento (cola de 32 en la oleada 30);
repetir con el aumento de la cola para comparar.

| Oleada completada | Cola en oleada 30 | Ticks simulados | Máx. enemigos vivos | Promedio por tick (µs) | Tiempo total (ms) |
|---:|---:|---:|---:|---:|---:|
| 30 | 32 | 36 979 | 32 | 3.273 | 122.384 |

Entrada fija sin disparos, semilla 4242, SECTOR_03. `Game::step` ejecuta spawns,
IA, colisiones y snapshot sin grabar un replay. El arnés restablece la salud antes
de cada tick y retira enemigos después de 120 ticks con la cola agotada o los
slots vivos llenos. Si queda cola, retira solo la mitad para permitir más spawns.
El promedio mide `Game::step`; el tiempo total incluye el bucle y sus sondas,
no la compilación ni el arranque. Es una carga sintética, no una partida humana
ni un benchmark de replays, WASM, GPU o móviles.

## Prior measurements (2026-11-20)

| Item | Value |
| --- | --- |
| Machine | Apple M3, macOS 27.2.1 (arm64) |
| Node | v24.22.3 (V8 runs the wasm) |
| Rust | 1.100.0, `opt-level = "s"`, `lto`, `panic = "abort"` |
| Browser for render numbers | Playwright Chromium (headless, SwiftShader software GL, `devicePixelRatio` 1) |

Headless software GL gives no meaningful frame time or fps. Render numbers below
are **draw calls and triangles**, which do not depend on the GPU. Frame time on real
GPUs is **not measured**.

### Simulation (wasm in V8)

Method: `Engine.tick` (bridge + `bp_tick_fixed` + snapshot refresh), 6000 ticks per
sector in practice mode (the operator never dies, so enemies stay alive), scripted
input (walk, turn, fire). `performance.now()` around each call.

| Sector | Enemies alive at end | mean | p50 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| SECTOR_01 | 4 | 1.9 µs | 1.5 µs | 4.7 µs | 305.7 µs |
| SECTOR_02 | 4 | 1.6 µs | 1.6 µs | 2.0 µs | 11.0 µs |
| SECTOR_03 | 3 | 1.4 µs | 1.4 µs | 2.1 µs | 8.3 µs |

The tick budget at 60 Hz is 16 667 µs; the measured mean is about 0.01 % of it. The
305 µs maximum is a one-off (first-touch / JIT warm-up), not steady state. These
WASM runs had at most 4 enemies alive and did not measure high waves in Overflow.

Server-side replay (native, release, `api` crate): a 72 000-tick log re-simulates in
about 31 ms (reported by the API work on the same machine; not re-measured here).

### Render budget (medium quality, 1600×900 and 844×390)

Method: `renderer.info.render.calls` read after all passes (shadow map, bloom
composer, output), `autoReset` off, sampled over 3–8 s per sector.

| Quality | Viewport | Sector | Draw calls |
| --- | --- | --- | ---: |
| medium | 1600×900 | control / cryo / archive | 20 / 20 / 20 (1 robot in scene) |
| medium | 844×390 | control / cryo / archive | 26 / 26 / 24 (4 / 4 / 3 robots) |
| high | 1600×900 | control / cryo / archive | 20–22 |
| low | 1600×900 | control / cryo / archive | 11–15 / 11–13 / 9–11 |

Observed model on medium and high: `calls = 18 + 2 × visible robots`. Telegraph halo
and sentinel aim line add up to 2 more; they did not appear in samples, so the worst
case with 4 robots (28) is derived, not observed. Budget: ≤ 30.

Triangles (medium, 1 robot): 5.0 k control, 7.4 k cryo, 11.2 k archive.

### Payload (gzip -9)

| Artifact | Raw | gzip |
| --- | ---: | ---: |
| `bp_core.wasm` | 78.3 KiB | 33.2 KiB |
| game shell JS | 107.3 KiB | 32.2 KiB |
| `three` chunk | 493.8 KiB | 125.5 KiB |
| CSS | 30.0 KiB | 6.6 KiB |
| `index.html` | 25.4 KiB | 6.2 KiB |
| **Total** | **734.8 KiB** | **203.5 KiB** |

## Not measured

- Frame time / fps on real GPUs, on any mobile device, or at DPR 1.5–2.
- Memory over long Overflow sessions.
- Vercel function cold start and Upstash latency (no deployment yet).
