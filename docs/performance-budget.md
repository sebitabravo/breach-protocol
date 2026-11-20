# Presupuesto de performance

Este documento separa lo que se **quiere** (objetivo) de lo que se **midió**
(medido). Ninguna cifra de esta tabla es aspiracional disfrazada: cada número
"medido" viene del build actual (`dist/`) o de una observación en vivo del
Engineering Mode. Si cambia el código, se vuelve a medir.

## Payload

Medido sobre el build de producción del pase de arte (`npx vite build`), sin
comprimir y con `gzip -9`, leído directamente de `dist/`:

| Artefacto | Raw | Gzip -9 |
| --- | ---: | ---: |
| `bp_core.wasm` (núcleo de simulación) | 78.3 KiB | 33.2 KiB |
| `index-*.js` (shell + juego + postprocesado de three) | 107.3 KiB | 32.2 KiB |
| `three-*.js` (chunk de Three.js) | 493.8 KiB | 125.5 KiB |
| `index-*.css` (estilos) | 30.0 KiB | 6.6 KiB |
| `index.html` | 25.4 KiB | 6.2 KiB |
| **Total transferible** | **734.8 KiB** | **203.5 KiB** |

Notas honestas sobre el payload:

- Three.js domina el peso (~62% del total transferible). Es una dependencia de
  runtime elegida, no un accidente.
- Desde el pase de arte el total subió ~16 KiB gzip. Parte viene del wasm y del
  shell, que cambiaron en otros cambios del mismo branch; no se separó la
  contribución. Lo propio del render (módulos `src/render/**` y los addons de
  postprocesado `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `OutputPass`)
  cae dentro de `index-*.js`, que pasó de 68.9 a 107.3 KiB raw.
- El núcleo wasm pesa menos que el HTML: Rust puro sin dependencias, sin
  wasm-bindgen.
- No hay assets: cero imágenes, cero modelos, cero archivos de audio. Texturas
  (`CanvasTexture`), geometría y sonido son procedurales.

## Render

| Métrica | Objetivo | Medido |
| --- | --- | --- |
| Draw calls, medium | ≤ 30 con hasta 4 robots, halo y mira | 18 + 2 × robots visibles: 20 / 22 / 24 con 1 / 2 / 3 robots, 26 con 4 (844×390). El halo (+1) y la mira (+1) mientras haya telegrafía son derivados del código; no aparecieron en las muestras |
| Draw calls, high | igual que medium | 20 / 22 con 1 / 2 robots |
| Draw calls, low | sin bloom | 11–15 con 2–4 robots vivos |
| Triángulos en escena, medium | del orden de miles | 5.0k control · 7.4k cryo · 11.2k archive (1 robot) |
| Sombras | off en low | low: off · medium: on (mapa 1024², solo proyecta el lote lit) · high: on (mapa 2048²) |
| Frame rate | 60 fps estable | no medido en este pase: SwiftShader no da fps representativos. Última medición del build anterior: 48 fps headless |
| Ticks descartados | 0 en hardware normal | no re-medido en este pase |
| Boot (carga wasm) | < 1 s | no re-medido en este pase |

**Método de conteo (cambió en el pase de arte).** `renderer.info.render.calls` se
resetea una vez por frame y se lee después de todos los pases, así que cuenta la
sombra, el RenderPass, el bloom y el output. El build anterior reseteaba en cada
`render()` y excluía la pasada de sombras: su cifra de 19 no es comparable. Con el
mismo método, ese build marcaba 15–24 en medium (máximo 24 en el mapa 0, con 4
enemigos vivos).

**Medición.** Playwright sobre `vite preview`, con el preset forzado en
`bp.settings` (modo manual, sin el controlador automático), muestreando
`renderer.calls` durante 3–8 s por sector y guardando pares `(calls, robots)` por
muestra. Los robots son meshes de la escena con visor y flag `visible`, sin
filtrar por frustum: es una cota superior de los robots en pantalla.

Condiciones de la medición (declaro el entorno, no lo oculto): Chromium
headless con SwiftShader (sin GPU), viewports 1600×900 y 844×390, `hasTouch:
true`. La headless reporta `devicePixelRatio` 1, así que el DPR de `medium` (1.5)
y `high` (2) se topa en 1 en estas capturas. Los draw calls, triángulos y los
tamaños de payload son cifras exactas de este build; el FPS y los ticks
descartados son indicativos, no benchmarks de hardware. El Engineering Mode
(`F3`) reporta estos números en vivo con datos reales del frame loop y de la
simulación; no hay métricas falsas.

## Simulación

| Métrica | Presupuesto | Cómo se garantiza |
| --- | --- | --- |
| Paso fijo | 1/60 s exactos | acumulador en `src/core/loop.ts`, testeado |
| Clamping de frames largos | máx. 100 ms por frame | `MAX_FRAME_DT`, evita la espiral de la muerte |
| Ticks por frame | máx. 5 | `MAX_STEPS`; el excedente se cuenta y se reporta |
| Determinismo | misma semilla + input = mismo mundo | RNG con semilla en `core/src/rng.rs`, sin tiempo de pared en la simulación |

## Qué vigilar cuando el código crezca

- Draw calls: el presupuesto se sostiene por batches fundidos
  (`src/render/arena.ts`, `src/render/geometry.ts`) y por dos draws por robot.
  Agregar geometría como mallas individuales, o un pase de postprocesado más,
  rompe el objetivo primero (ver `docs/adr/0004-bloom-postprocessing.md`).
- El chunk de Three.js: si crece, revisar imports de `three/examples` antes de
  culpar al núcleo.
- El wasm: cualquier dependencia de crate (hoy cero) aparece acá primero.
