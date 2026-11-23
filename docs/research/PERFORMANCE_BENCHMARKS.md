# Benchmarks de performance (estudio halloween.dev)

Números de la medición comparativa de la tarea REA (`odd/tasks/rea-halloween-study.md`).
Compila: la medición del juego de referencia, la línea base de Breach Protocol, la medición
de texturas/VRAM y el veredicto comparativo. Sin opiniones: si un número no se midió, aquí
dice **no medido**. El detalle cualitativo del juego de referencia está en
[`HALLOWEEN_ANALYSIS.md`](HALLOWEEN_ANALYSIS.md).

**Advertencia de lectura:** la comparación de bytes (última sección) **no es un ranking de
velocidad ni de calidad**. La referencia reparte su presupuesto de otra forma: gasta más
payload y más costo por frame para lograr por-pixel más rico. No se saca de ahí ninguna
conclusión de «mejor» ni «peor».

## Cómo se midió

| Dato | Valor |
| --- | --- |
| Equipo | Apple M3, macOS |
| Navegador | Chromium 157.0.8103.79 (Chromium de Playwright y del sistema) |
| Ventana | 1600×900 px CSS con `deviceScaleFactor` 2 |
| Referencia | Sesión automatizada Playwright con init-script que instrumenta la creación de contexts WebGL para contar draws y triángulos por frame; `?gfx=webgl` forzado |
| Breach Protocol | `bun run build` y `bun scripts/measure-frames.mjs` con seed fija, match guionizado |

### Reproducibilidad

**Referencia** (medición del padre, con el juego de referencia abierto en sesión
automatizada): Playwright con un init-script que intercepta `getContext('webgl2')`, marca
cada draw call y conteo de triángulos y los reporta por frame. Con `?gfx` sin fijar
arranca WebGPU, así que se forzó `?gfx=webgl` y se inició el juego para que las cifras
provengan de la vía instrumentable.

**Breach Protocol**:

```bash
bun run build
bun scripts/measure-frames.mjs --label baseline-t1 --presets low,medium,high --seconds 20 \
  --viewport 1600x900 --dsf 2
```

El resultado queda en `test-results/frames-baseline-t1.json`.

## Números del juego de referencia

Sesión automatizada con `?gfx=webgl` forzado, juego iniciado. La referencia renderiza a
resolución reducida: canvas backing 900×706 sobre 1200×942 CSS a DPR 2 por defecto; con
`?gfx=webgl` el canvas fue 1500×1177 en la misma ventana.

| Métrica | Medido |
| --- | ---: |
| Draw calls, p50 / p95 / máx | 138 / 152 / 184 |
| Triángulos, p50 / p95 | 149 495 / 152 903 |
| Frame, p50 / p95 / p99 | 16.7 / 17.7 / 49.5 ms |
| fps medio de la muestra | 41.1 (incluye atascos de transición) |

La muestra reporta 41.1 fps de media incluyendo los atascos de las transiciones; el p50 de
16.7 ms indica que el juego sostiene el vsync de 60 Hz salvo esos atascos. No se separa el
tramo de transición del tramo estable: es un límite de ese pase, no un número promediado
por diseño.

## Línea base de Breach Protocol

Misma máquina, misma ventana, seed fija, match guionizado con el harness del proyecto.
("| Draw calls | Triángulos |" medidos con reset por frame igual que las columnas de este
build; canvases de la medición en `PERFORMANCE_REPORT.md`.)

| Preset | Canvas | DPR efectivo | fps | Intervalo p50 / p95 (ms) | Draw calls | Triángulos |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| low | 523×294 | 0.33 | 60 | 16.7 / 17.6 | 16 | 47 954 |
| medium | 979×551 | 0.61 | 60 | 16.7 / 17.6 | 21 | 47 846 |
| high | 2494×1403 | 1.56 | 59.9 | 16.7 / 17.3 | 26 | 47 854 |

**Corrección de la fila medium (CONFIRMADO).** La fila original de esta tabla (medium
15 draws / 39 384 tris) fue **corregida**: se demostró que era un artefacto de muestreo
y no un costo real del preset. El mismo comando sobre la rama (`bun scripts/measure-frames.mjs
--label baseline-t1 …`) reproduce **21 draws / 47 846 tris**; las cifras de fps/p50/p95 de la
fila no cambiaron. Causa observada en código: el harness muestrea los contadores de **un solo
frame** — `scripts/measure-frames.mjs:128` lee `renderer.calls`/`renderer.triangles`, que son
los contadores del último frame renderizado (`src/render/renderer.ts:923`) — y en un frame de
espera (hueco de oleada, sin enemigos ni FX vivos) los lotes instanciados de robots y efectos
no aparecen, así que ese frame omite esos draws mientras el resto de la escena se mantiene.

**Nota metodológica (CONFIRMADO, mecanismo en código).** El harness no promedia contadores
sobre la ventana de 20 s: cada fila de draws/triángulos es una fotografía del último frame.
Toda comparación entre presets debe hacerse con el **mismo contenido vivo**: match guionizado
equivalente, con enemigos vivos y FX activos en el frame muestreado, o los números no son
comparables. Las comparaciones históricas previas a esta corrección (p. ej. la tabla T8 de la
sección «Validación integrada», cuyo lado «L5» cita la fila medium ya invalidada) conservan
los números tal como fueron registrados en su momento y deben leerse con esta aclaración.

Las filas móviles de la línea base siguen **no medidas** (sin dispositivo físico), igual
que en `PERFORMANCE_REPORT.md`.

## Texturas, VRAM y payload

Mediciones de este proyecto. Los bytes de la referencia y los de este proyecto **no se
comparan como calidad ni como rapidez**, se listan como presupuesto distinto:

| Métrica | Valor | Fuente |
| --- | ---: | --- |
| 9 mapas WebP 1024×1024 decodificados (RGBA8, sin mips) | 4.00 MiB c/u | medido |
| Ídem con mips | 5.33 MiB c/u | medido |
| **VRAM total de las 9 texturas con mips** | **48.0 MiB** | medido |
| Payload de `dist/` (build de esta rama) | 4.9 MB | medido |
| `bp_core.wasm` | 88 097 bytes | medido |
| Transferencia de los primeros 20 s de la referencia | 10.77 MB | medido |
| Requests de la referencia en esos 20 s | 368 | medido |
| — scripts: 524 KB en 77 archivos; fetch: 9.22 MB; media: 809 KB; fuentes: 131 KB | | medido |

El detalle 9× 4.00 → 5.33 MiB con mips es el que motiva el análisis KTX2/Basis de la tarea
T5d: una textura ETC1S de la misma pieza aterrizaría cerca de 6 MiB total, frente a los
48.0 MiB de hoy. Ese ahorro está estimado por formato, no medido con artefactos reales
(pendiente de decisión de toolchain), y aquí se declara como estimación, no como medición.

## Comparación y veredicto

Misma máquina, mismo objetivo de 60 fps:

| Métrica | Breach Protocol | Referencia (`?gfx=webgl` forzado) |
| --- | ---: | ---: |
| Draw calls (rango p50) | 15–26 | 138–152 |
| Triángulos | 39–48k | ~150k |

Veredicto, solo en evidencia: **no somos más lentos** — sostenemos el vsync igual que la
referencia y renderizamos en torno a **3× menos geometría con 5× menos draw calls**. La
brecha honesta no está en el costo bruto sino en:

- **riqueza por pixel** (la referencia gasta esos draws y ~150k triángulos para lograrla);
- **validación móvil** (nuestra línea base tiene las filas móviles vacías);
- **control expuesto al jugador** (la referencia expone toggles por efecto que este
  proyecto no ofrecía; ver T5a).

Nada de lo anterior justifica cambiar la arquitectura del renderer de este proyecto.

## Qué no se midió

- **El camino WebGPU por defecto de la referencia.** Sin cifras: sus draw calls no
  atraviesan la instrumentación WebGL usada.
- **El nivel de calidad real de un visitante de escritorio** (la referencia fuerza su nivel
  bajo bajo webdriver/HeadlessChrome; solo se midió esa vía forzada).
- **FPS en móvil**, en ninguna de las dos direcciones: la automatización de Playwright no
  es una GPU móvil real, así que no se afirma fps móvil alguno.
- **El objetivo de 30 fps en un teléfono modesto:** no hubo dispositivo físico.
- La revisión de Three.js de la referencia: **no verificada**.

## Limitaciones de la medición

- Los draw calls de la referencia se midieron con `?gfx=webgl` **forzado**, no como
  llega el juego por defecto (WebGPU). Los pares de la tabla comparativa no miden la
  misma vía de renderizado más que en el sentido WebGL2/WebGL2.
- El canvas de la referencia en el pase medido fue 1500×1177; el de WebGPU por defecto es
  de resolución reducida (900×706 backing). Las cifras, entonces, describen la vía
  forzada, no la experiencia por defecto del juego de referencia.
- El 41.1 fps de media de la referencia mezcla transiciones con juego estable: no es
  comparable directo con el p50 16.7 ms de las muestras de este proyecto, que no
  incluyeron transiciones de escena.
- Las mediciones de este proyecto son de SwiftShader o de ventana real según el pase; la
  línea base de esta tarea corrió con la ventana de Playwright (GPU real del M3),
  atada a un monitor de 60 Hz: un p95 por debajo de 16.7 ms no es alcanzable ahí.

## Validación integrada de la fase 5 (T8, árbol combinado)

Primera validación que corre **todo junto** en el árbol combinado: seis unidades de mejora
aterrizaron en paralelo en esta rama y cada una solo corrió sus chequeos enfocados. Esta sección
registra el pase integrado de T8 (S9, S10): build, los tres proyectos Playwright, el soak de
memoria y los chequeos funcionales. Sin ninguna afirmación de fps móvil real: los tres
proyectos Playwright corren sobre Chromium de escritorio en este equipo (el proyecto
`mobile-portrait` emula el iPhone 13 en Chromium, como declara `playwright.config.ts`), y
no hubo dispositivo físico.

### Entorno y comandos

| Dato | Valor |
| --- | --- |
| Equipo | Apple M3, macOS (idéntico a la línea base T1, L5) |
| Navegador | Chromium de Playwright 1.56.1 (suite e2e headless; frame/soak con ventana real, como la línea base) |
| Tree | árbol combinado de la rama, `bun run build` verde (incluye `tsc --noEmit`) |
| Puerto | el puerto 4173 estaba ocupado por un proceso ajeno; la suite corrió con `PW_PORT=4183` |

```bash
bun run build
PW_PORT=4183 bunx playwright test          # los 3 proyectos: chromium, mobile-landscape, mobile-portrait
bun scripts/measure-frames.mjs --label validation-t8 --presets low,medium,high --seconds 20 --viewport 1600x900 --dsf 2
bun scripts/measure-frames.mjs --label validation-t8-soak --presets high --seconds 20 --soak 300 --viewport 1600x900 --dsf 2
```

Los JSON de las mediciones quedan en `test-results/frames-validation-t8.json` y
`test-results/frames-validation-t8-soak.json`. Los chequeos funcionales se corrieron con
un script desechable fuera del árbol contra `dist/` servido localmente (Chromium headless,
SwiftShader, mismo binario de Playwright); los estados del renderer se leyeron por la
instancia viva de la página, igual que hace el harness.

### Suite Playwright por proyecto (números reales)

| Proyecto | Ejecutados | Pasan | Fallan | Omitidos |
| --- | ---: | ---: | ---: | ---: |
| chromium | 60 | 58 | 2 | 0 |
| mobile-landscape | 6 | 6 | 0 | 1 (test solo-retrato, omitido en paisaje) |
| mobile-portrait | 7 | 7 | 0 | 0 |
| **Total** | **73** | **71** | **2** | **1** |

### El único fallo no es preexistente: es una regresión del árbol combinado

Los dos fallos son la misma spec: `tests/e2e/engineering.spec.ts:4` (F3 sincrónico, jugando y
en pausa, proyecto chromium). Verificado contra un ejemplar prístino de `HEAD`
(`git archive HEAD` extraído a un directorio de scratch fuera del árbol, `node_modules`
por symlink, misma spec y mismo proyecto): en HEAD **pasa 2/2 en 16.2s**; en el árbol
combinado **falla 2/2**. No es un fallo heredado: lo introdujo el conjunto de cambios
aterrizados en la rama (la diferencia observable son las métricas nuevas de T5e).

Diagnóstico observado en el panel vivo del árbol combinado: las tres métricas nuevas de
T5e (`cámara`, `orientación`, `pases`) muestran el placeholder `—` mientras su overlay o su
lectura correspondiente está apagada, y el test preexistente exige que **ningún** valor del
panel sea `—`. El contrato nuevo del panel y el test viejo chocan; la resolución (qué
métricas se completan por defecto, o cómo debe medir el test) exige una unidad propia: acá
queda registrado, sin parchar código de producto ni saltar el test.

### Soak de memoria (preset high, 5 minutos)

`--soak 300` toma 10 muestras a intervalos de 30 s durante la partida guionizada. Heap,
geometrías, texturas y programas **planos**:

| Métrica | Muestras (10, cada 30 s) |
| --- | --- |
| Heap JS | 20.5 – 21.6 MB (sin tendencia creciente, vuelve a bajar entre muestras) |
| Geometrías | 21 constantes |
| Texturas | 27 constantes |
| Programas | 33 constantes |

La partida guionizada del soak corre alrededor de 5 minutos seguidos con movimiento y
disparo sostenido: la firma típica de un leak (heap, geometrías o texturas que suben sin
techo) no aparece. Comparación de frame del mismo pase: fps 60, p50 16.7 ms, p95 18.5 ms,
25 draw calls, 47 706 triángulos.

### Presets comparados contra la línea base T1 (L5)

Misma máquina, misma ventana (1600×900, `deviceScaleFactor` 2), seed fija, match guionizado:

| Preset | L5: fps / p95 / calls / tris | T8: fps / p95 / calls / tris | Deltas |
| --- | --- | --- | --- |
| low | 60 / 17.6 / 16 / 47 954 | 60 / 18.6 / 16 / 47 810 | calls ±0, tris −144, p95 +1.0 ms |
| medium | 60 / 17.6 / 15 / 39 384 | 60 / 18.6 / 21 / 47 702 | calls +6, tris +8 318, p95 +1.0 ms |
| high | 59.9 / 17.3 / 26 / 47 854 | 60 / 18.6 / 25 / 47 706 | calls −1, tris −148, p95 +1.3 ms |

Lectura honesta, sin adornos:

- **El presupuesto de triángulos de T6a se sostiene en high:** 47 706 contra 47 854 (−148),
  muy dentro del tope de +10% a igual spawn.
- **medium sube 15 → 21 draw calls y 39 384 → 47 702 triángulos.** Son las mejoras de
  contenido/siluetas aterrizando en ese preset; sigue a 60 fps en ventana. La fila medium
  ya no es la más barata de 39k triángulos: quien lea la tabla comparativa con la
  referencia debe usar los rangos nuevos (39–48k → 47–48k).
- **El p95 sube +1.0/+1.0/+1.3 ms** (17.3–17.6 → 18.6) en las tres filas; queda pegado
  al vsync de 60 Hz del monitor, y en ninguna fila se observó degradación de preset en
  la partida medida. Se registra el delta, no se teoriza sobre su causa única.
- **fps se sostiene en 60** en las tres filas (59.9 → 60 en high).

### Chequeos funcionales del árbol combinado

| Chequeo (T8 item 4) | Resultado | Evidencia observada |
| --- | --- | --- |
| Los cinco overrides gráficos cambian estado real del renderer | **Pasó** | En el árbol combinado, preset high, caminos de producción (`updateSettings` → `setGfx`): `gfxBloom:off` baja `postFxPlan.bloom` `true→false`; `gfxShadows:off` baja `shadowMap.enabled` y `dirLight.castShadow` `true→false`; `gfxEnvironment:off` desinstala PMREM (`scene.environment null`); `gfxLights:off` baja `practicals.visible`; `gfxMist:off` oculta la malla `uGlossy`. Cada re-encendido `on` restaura el estado original. Con los cinco guardados en `bp.settings`, un arranque **nuevo en otra página** arranca con los cinco apagados aplicados (boot apply path, no solo runtime) |
| Segunda sesión arranca en el nivel persistido | **Pasó** | Primer boot en `auto` arranca en `medium` (comportamiento de hoy); sobre SwiftShader el controlador decide bajar a `low` y persiste `bp.gfx.tier` = `{v:1, sig:c3f9d476ff5093a0, tier:low, verified:…}`; un segundo boot (misma página de storage) arranca **directo en `low`**; un control con storage limpio sigue arrancando en `medium` |
| Boot unsupported y slow alcanzables; no disparan en boot normal | **Pasó, con límite** | Boot normal: nota slow oculta y pantalla de fallback sin la variante unsupported. `?boot=unsupported`: pantalla dedicada con `data-boot="unsupported"`, las tres capacidades y el piso de versiones (Chrome 103+ · Firefox 100+ · Safari 16+). `?boot=slow` con boot efectivamente demorado (fetch de `bp_core.wasm` al 4 s): la nota «el arranque está tardando más de lo usual…» aparece durante el boot y se oculta al terminar. **Límite registrado:** la vía natural del temporizador de 24 s no se pudo observar en vivo — con un fetch demorado 25 s el loader del núcleo aborta a ≈15 s por su propio `AbortSignal.timeout` (`src/wasm/bridge.ts:304`) y cae al fallback genérico antes de que la nota de 24 s pueda encender. La matemática del gate (`bootSlowState`, umbral `stalled` con Reintentar) sigue cubierta por tests unitarios (`tests/unit/boot-states.test.ts`); la observación en vivo de la vía natural es un hueco declarado, no un número inventado |
| Las terminales objetivo completan la interacción a la nueva escala | **Pasó** | En la suite Playwright de este pase, proyecto chromium: `gameplay.spec.ts` «real terminal completes tutorial into campaign hand-off», `objective-marker.spec.ts` «a specific terminal tracks the camera and switches from distance to touch hold», `terminal-console.spec.ts` (idle/cancel/channel/lock) y `wave-acceleration.spec.ts` «a mission terminal advances the wave». La escala nueva de terminales no rompió ningún camino de interacción medido |
| Los overlays de engineering pasan sin cambiar draw calls cuando están apagados | **Pasó** | Panel vía F3: 27 draw calls de base; con el panel abierto y los cuatro overlays apagados, 27 (cero añadidos, grupo desmontado); con los cuatro encendidos, 33 (+6, rejillas y cajas de límites/cápsulas de colisión); apagados de nuevo, 27 otra vez; panel cerrado, 27. La misma invariante tiene su test unitario (`tests/unit/engineering-overlays.test.ts`) y ningún agregado e2e fue necesario: los cinco chequeos ya tenían cobertura unitaria (y los de terminales, cobertura e2e) |

### Lo que quedó sin medir en este pase

- **FPS en un móvil real, otra vez explícitamente:** no hubo dispositivo físico, y los tres
  proyectos Playwright corren sobre el Chromium de escritorio de este M3. No se afirma fps
  móvil alguno en este documento ni en otros: la brecha de validación móvil de la
  comparación sigue abierta.
- **La vía natural de los umbrales del boot lento** (nota a 24 s y `stalled` a 60 s con
  botón Reintentar): no observadas en vivo (ver límite del temporizador arriba);
  la matemática del gate queda cubierta por unitarios y la pantalla sí se verificó vía forzada.
- **VRAM durante el soak:** el harness lee `info.memory` de Three y heap JS; la memoria de
  GPU real no se consulta en este pase. Sin leak visible en esas métricas, se declara el
  límite del instrumento.
- **El costo de frame de los overlays encendidos** con GPU real en ventana: los +6 draws se midieron headless; solo se afirma que, apagados, devuelven el contador al baseline.
- **Ninguna GPU móvil participó en los chequeos nuevos de esta sección.** Todo lo de esta
  sección proviene de Chromium de escritorio (headless o ventana según el instrumento).
