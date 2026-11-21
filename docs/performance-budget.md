# Presupuesto de performance

Este documento separa lo que se **quiere** (objetivo) de lo que se **midió**
(medido). Ninguna cifra de esta tabla es aspiracional disfrazada: cada número
"medido" indica el entorno y build que se observaron, no una garantía para
el código posterior. Si cambia el código, se vuelve a medir.

## Payload

`bun run build`, tamaños de archivo en KiB (1 KiB = 1024 B), raw y gzip nivel 9.
El antes se midió en el árbol de trabajo existente, sin `git stash`.

| Artefacto | Antes raw | Antes gzip | Después raw | Después gzip |
| --- | ---: | ---: | ---: | ---: |
| `index.html` | 37.5 | 8.3 | 38.6 | 8.6 |
| `index-*.css` | 48.4 | 9.7 | 48.4 | 9.7 |
| `index-*.js` (antes app completa; ahora solo shell) | 256.2 | 83.4 | 8.3 | 3.3 |
| `game-*.js` (entrada dinámica) | — | — | 78.0 | 25.4 |
| `renderer-*.js` (renderer y addons usados) | — | — | 172.7 | 56.7 |
| `three-*.js` (núcleo de Three.js) | 573.4 | 149.3 | 573.3 | 149.3 |
| `bp_core.wasm` (núcleo de simulación) | 85.1 | 36.3 | 85.1 | 36.3 |

`dist/` pasó de **8 095 137 a 4 233 349 bytes** de archivos (−47.7%; `du -sh`:
**8.5M → 4.8M** de espacio asignado). Los `.map` bajaron de 3 865 689 bytes a
cero. Los sourcemaps son **solo para profiling local**: `BP_SOURCEMAPS=1 bun run build`.
Volvé a ejecutar `bun run build` sin esa variable antes de publicar.

Los addons se importan por archivo (postprocesado, HDRLoader, GLTFLoader y
RoundedBoxGeometry), no desde un barril general. Se probó `optimizeDeps.include`
y `manualChunks` con `onlyExplicitManualChunks`, aislando el build de Three.js:
ambas configuraciones de producción dieron 587 102 B raw / 152 844 B gzip para
`three`. Se descartó el ajuste (0 B de ahorro, `optimizeDeps` solo afecta dev).
El WASM sigue usando `libm` y no usa wasm-bindgen. El total de `dist/` incluye los
assets de arte y los modelos de respaldo Kenney, que no son preloads.

## Waterfall de arranque

Reproducir con `bun run build` y `bun scripts/measure-boot.mjs dist 7`. Medianas
independientes de siete navegaciones en contextos nuevos de Chromium headless
(macOS arm64, 1280×800 táctil, localhost sin throttling, SwiftShader), con el
flag de tutorial visto para comparar la ruta directa a Jugar. El servidor de
medición aplica gzip nivel 9 a HTML, CSS, JS y WASM; sirve el arte sin comprimir.

| Métrica (desde inicio de navegación) | Antes | Después |
| --- | ---: | ---: |
| Primer paint (`first-paint`) | 52 ms | 36 ms |
| Transferencia hasta primer paint | 251.9 KiB | 84.9 KiB |
| Solo JS hasta primer paint | 233.3 KiB | 29.3 KiB |
| Menú interactivo (Jugar visible y listener listo) | 575 ms | 19 ms |
| Primera partida jugable (HUD visible, tick > 0 y draw calls > 0) | 15 802 ms | 3 399 ms |
| Transferencia hasta primera partida jugable | 3 273.6 KiB | 3 276.5 KiB |
| Solicitudes con transferencia hasta primera partida jugable (incl. HTML) | 15 | 17 |
| Primera solicitud de arte | 775 ms | 327 ms |

`transferSize` incluye cabeceras de respuesta; se suma por recurso completado
antes de cada hito (no intenta estimar bytes en vuelo). La herramienta toca
Jugar en cuanto el menú acepta el input. El hito de menú puede preceder al
`first-paint` registrado por Chromium. En 3/7 corridas nuevas ese toque temprano
hizo que renderer y Three.js terminaran de descargarse antes del timestamp de
paint: el menor peso antes de paint es una mediana, no un límite. El paint no
depende de esos módulos: `boot.spec.ts` bloquea sus respuestas, comprueba el
paint y toca Jugar para verificar que hay progreso visible y que la partida
arranca al liberar la carga. La ruta idle verifica que la órbita aparece sin
reemplazar el menú por la pantalla de arranque.

Se anticipa solo el WASM y el módulo de entrada del juego, sin precargar su
renderer ni Three.js. HDRI y texturas se piden después de habilitar el menú,
al dibujar la primera escena. El total jugable no baja: el arte aún llega
pronto y la división añade dos solicitudes. El tiempo jugable es indicativo
(SwiftShader y compilación de shaders), no un benchmark de hardware ni una
medición aislada de WASM.

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
| Boot (carga wasm) | < 1 s | En el waterfall se mide descarga y partida jugable, no la compilación WASM aislada. |

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

## Estado de verificación

| Prueba | Estado | Cómo se midió o mediría |
|---|---|---|
| Draw calls, triángulos y payload del pase de arte | `medido` | Chromium con SwiftShader a DPR 1 y tamaños de `dist/`, como se detalla arriba. |
| Overflow nativo hasta oleada 30 | `medido` | Carga sintética en release; ver [resultados](benchmark-results.md). |
| FPS con GPU real | `no medido` | Registrar FPS y p95 de frame time con aceleración habilitada durante combates por sector. |
| Móvil físico | `no medido` | Probar sesiones táctiles en iOS y Android y registrar modelo, navegador, frame time y ticks descartados. |
| DPR 1.5–2 | `no medido` | Verificar el DPR efectivo del canvas y medir frame time en medium a 1.5 y high a 2. |
| Playtest humano de los tres sectores | `no medido` | Observar a jugadores completar cada sector y anotar derrotas, tiempos y problemas de lectura. |
| Playtest humano del Interceptor | `no medido` | Observar si se reconoce la telegrafía, se esquiva la embestida y se entiende la respuesta. |
| Playtest humano de Overflow | `no medido` | Observar sesiones prolongadas y registrar oleada alcanzada, dificultad y motivo del fin. |

## Qué vigilar cuando el código crezca

- Draw calls: el presupuesto se sostiene por batches fundidos
  (`src/render/arena.ts`, `src/render/geometry.ts`) y por dos draws por robot.
  Agregar geometría como mallas individuales, o un pase de postprocesado más,
  rompe el objetivo primero (ver `docs/adr/0004-bloom-postprocessing.md`).
- El chunk de Three.js: si crece, revisar imports de `three/examples` antes de
  culpar al núcleo.
- El wasm: medir el efecto de cualquier crate añadido al núcleo (hoy usa `libm`).
