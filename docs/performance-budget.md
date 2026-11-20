# Presupuesto de performance

Este documento separa lo que se **quiere** (objetivo) de lo que se **midió**
(medido). Ninguna cifra de esta tabla es aspiracional disfrazada: cada número
"medido" viene del build actual (`dist/`) o de una observación en vivo del
Engineering Mode. Si cambia el código, se vuelve a medir.

## Payload

Medido sobre el build de producción actual (`npm run build`), sin comprimir y
con `gzip -9`, leído directamente de `dist/`:

| Artefacto | Raw | Gzip -9 |
| --- | ---: | ---: |
| `bp_core.wasm` (núcleo de simulación) | 69.7 KiB | 29.1 KiB |
| `index-*.js` (shell + juego, minificado) | 68.9 KiB | 21.0 KiB |
| `three-*.js` (chunk de Three.js) | 492.7 KiB | 125.1 KiB |
| `index-*.css` (estilos) | 28.9 KiB | 6.3 KiB |
| `index.html` | 25.2 KiB | 6.1 KiB |
| **Total transferible** | **685.5 KiB** | **187.6 KiB** |

Notas honestas sobre el payload:

- Three.js domina el peso (~72% del total). Es una dependencia de runtime
  elegida, no un accidente; el código propio del juego está en los 68.9 KiB
  del shell.
- El núcleo wasm pesa menos que el HTML: Rust puro sin dependencias, sin
  wasm-bindgen.
- No hay assets: cero texturas, cero modelos, cero archivos de audio. Toda la
  geometría y el sonido son procedurales.

## Render

| Métrica | Objetivo | Medido |
| --- | --- | --- |
| Draw calls | ~12 vía instancing | 19 en juego (medium) |
| Triángulos en escena | del orden de miles | 1,550 en juego (medium) |
| Sombras | off en low | low: off · medium: on (mapa 1024²) · high: on (mapa 2048²) |
| Frame rate | 60 fps estable | 48 fps headless (p50 16.7 ms, p95 33.4 ms) |
| Ticks descartados | 0 en hardware normal | 1 en 418 ticks (headless) |
| Boot (carga wasm) | < 1 s | 23 ms (carga completa de página con wasm en caché) |

Condiciones de la medición (declaro el entorno, no lo oculto): Chromium
headless 1280×800, DPR 1, `hasTouch: true`, preset `medium` (sombras activas,
un solo directional proyecta), sin GPU dedicada — el renderizado es por
software y el frame rate de ese entorno subestima hardware real. Los draw
calls, triángulos, los tamaños de payload y el del wasm sí son cifras exactas
de este build; el FPS y los ticks descartados son indicativos, no benchmarks
de hardware. El Engineering Mode (`F3`) reporta estos números en vivo con
datos reales del frame loop y de la simulación; no hay métricas falsas.

## Simulación

| Métrica | Presupuesto | Cómo se garantiza |
| --- | --- | --- |
| Paso fijo | 1/60 s exactos | acumulador en `src/core/loop.ts`, testeado |
| Clamping de frames largos | máx. 100 ms por frame | `MAX_FRAME_DT`, evita la espiral de la muerte |
| Ticks por frame | máx. 5 | `MAX_STEPS`; el excedente se cuenta y se reporta |
| Determinismo | misma semilla + input = mismo mundo | RNG con semilla en `core/src/rng.rs`, sin tiempo de pared en la simulación |

## Qué vigilar cuando el código crezca

- Draw calls: el presupuesto se sostiene por instancing (`src/render/`);
  agregar geometría como mallas individuales rompe el objetivo primero.
- El chunk de Three.js: si crece, revisar imports de `three/examples` antes de
  culpar al núcleo.
- El wasm: cualquier dependencia de crate (hoy cero) aparece acá primero.
