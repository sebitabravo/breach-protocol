# Análisis técnico del juego de referencia (halloween.dev)

Estudio de referencia de ingeniería de la tarea REA (`odd/tasks/rea-halloween-study.md`,
tareas T2 y T7). El propósito es **referencia de ingeniería, no imitación**: este documento
describe lo que la página de referencia hace y cómo se lo observó, sin copiar ni reutilizar
nada suyo. No se encontró página de licencias ni créditos, así que todo el código y los
assets de la referencia se tratan como **fuera de límites** para este proyecto.

Cada afirmación lleva la etiqueta del sistema del documento de la tarea: `CONFIRMADO`
(obervado directamente), `INFERIDO` (deducido de evidencia observada sin confirmar el
detalle) o `NO VERIFICADO` (no pudo observarse). El documento no promueve un item
`INFERIDO` a `CONFIRMADO`.

## Qué es

halloween.dev es una página independiente que hidrata una isla de juego interactiva sobre
una base estática. **CONFIRMADO**:

- Contenida por una página construida con **Astro** que hidrata una isla de juego en **Preact**.
- Carga una versión de **Three.js** dividida en `three.core` + `three.webgpu` (build de
  Three.js con TSL y nodo de WebGPU).
- Expone un camino de renderizado **WebGPU como camino por defecto** (consulta de
  `navigator.gpu`) con **fallback a WebGL2**, y lo expone públicamente con `?gfx=webgpu|webgl`.
- En una captura con la instrumentación del estudio se vieron contexts `webgl2`, `2d` y
  `webgpu` creados en la misma sesión, y el adaptador reportado fue `apple`/`metal-3`
  con 25 features.

## Huellas de stack confirmadas

| Huella | Etiqueta |
| --- | --- |
| Astro + hidratación de una isla Preact | CONFIRMADO |
| Three.js build TSL separado en `three.core` + `three.webgpu` | CONFIRMADO |
| WebGPU por defecto (`navigator.gpu`), WebGL2 como fallback, `?gfx=webgpu|webgl` | CONFIRMADO |
| Meshopt decoder + transcoder KTX2/Basis servidos bajo `/basis/` | CONFIRMADO |
| Modelos por niveles `high|medium|lo` y variantes `/ktx2/` | CONFIRMADO |
| Audio por etapas: `.mp3` primero, `.webm` Opus cuando el navegador lo soporta | CONFIRMADO |
| Feeds tipo CCTV renderizados a 384×216 fijos dentro de un worker | CONFIRMADO |
| Revisión exacta (revision) de Three.js en uso | **NO VERIFICADO** — nunca se confirmó por ningún camino de observación |

## Pipeline de assets entregados

Lo que el servidor entrega al navegador, observado en recon estático y en red. **CONFIRMADO**:

- Modelos en **tres niveles de detalle** (`high`, `medium`, `lo`) y **variantes comprimidas
  `/ktx2/`** de las texturas; la ejecución elige el nivel por señales de hardware.
- El pipeline de texturas comprimidas depende de un **Meshopt decoder** y un
  **transcoder KTX2/Basis** servidos bajo `/basis/`.
- El audio se reparte en dos etapas según el soporte de códecs del navegador
  (`.mp3` como camino base, `.webm` Opus si el navegador lo soporta).
- Los feeds de CCTV se renderizan a una resolución fija de 384×216 dentro de un worker,
  separados del canvas principal.
- **No se halló** página de licencias ni créditos: el origen y la licencia de cada asset es
  desconocido y su uso queda descartado para este proyecto.

## Sistema de calidad

Cómo la referencia decide y expone su calidad. **CONFIRMADO** salvo lo indicado:

- **Selección de nivel por hardware:** la elección de `high|medium|lo` proviene de
  `hardwareConcurrency`, `deviceMemory`, `(pointer: coarse)`, el ancho de pantalla y
  **regexes sobre el string de la GPU**.
- **Overrides públicos:** `?quality=low|medium|high` fuerza el nivel y `?gfx=webgpu|webgl`
  fuerza el backend de renderizado.
- **Persistencia `localStorage tld.gfx.v1`:** guarda la calidad verificada con `sig`
  (firma: string de GPU + contexto + viewport), `tier`, `verified`, `scale`,
  `shed` y `noHigh`. Un visitante recurrente no vuelve a escalar niveles cada sesión.
  Su existencia y claves se observaron en localStorage; el algoritmo aprox de la firma es
  coincidencia de strings observables, no código leído (el resto de la lógica es INFERIDO).
- **Persistencia `localStorage tld.settings.v1`:** expone toggles por efecto para
  `rain`, `shadows`, `lights`, `ao`, `bloom`, `fxaa`, `dof`, `grain` y `fps`. Es decir,
  efectos individuales desactivables por el jugador, encima del nivel de calidad.

## Estados de arranque, carga y no soportado

**CONFIRMADO** en recon estático:

- **Gate de versiones mínimas:** el arranque exige `Safari 16.4`, `Chrome 111`,
  `Firefox 114` (la referencia define explícitamente un piso de compatibilidad).
- **Estados de arranque explícitos:** la UI distingue estados `boot-unsupported`
  (navegador por debajo del piso) y `boot-slow` (el arranque que no termina), además del
  estado de carga normal.
- Los overrides públicos `?quality`, `?gfx` intervienen en la decisión de qué arranca y con
  qué calidad.

## Flags de debug públicos

Observados en recon estático. **CONFIRMADO** que la página responde a estos parámetros de
query: `?scene`, `?keepsrc`, `?bakeExport`, `?nomodels`, `?noktx2`, `?nolate`, además de
`?quality` y `?gfx` listados arriba. Que cada flag desactive exactamente lo que su nombre
sugiere es **INFERIDO** del nombre y del comportamiento observado de los que se probaron
(`?gfx`, `?quality`); el detalle del resto **NO VERIFICADO** flag por flag.

## Experiencia de jugador (Fase 2A): inventario de lo observado

La relación entre lo que este estudio alcanzó a observar en vivo y lo que no:

| Aspecto | Estado en este estudio |
| --- | --- |
| Estado de sobremesa de calidad alta real (WebGPU + nivel `high` del tier) | **No alcanzado**: la referencia detecta automatización y fuerza su nivel bajo; lo observado fue el nivel bajo forzado |
| Renderizado WebGPU por defecto con sus draw calls | **No alcanzado**: los draw calls del camino WebGPU no son observables con la instrumentación usada |
| Camino WebGL2 forzado (`?gfx=webgl`) corriendo el juego | Observado en sesión automatizada; números en `PERFORMANCE_BENCHMARKS.md` |
| Toggles por efecto del jugador (`tld.settings.v1`) | Confirmado por lectura de localStorage; no se recorrieron uno por uno en la UI |
| Pantallas de arranque / no soportado / lento | Identificadas en recon estático; la pantalla no soportado no se provocó en navegadores modernos ni se recorrió visualmente |
| Controles táctiles de la referencia | No observados: no hubo recorrido con dispositivo táctil real |
| Audio en partida | No evaluado (autoplay ni calidad auditiva) |

## Problemas reportados en el repositorio de issues de la referencia

El repositorio público de issues de la referencia (`halloween-issues` — repositorio
comunitario, no código de la referencia) documenta modos de fallo reportados por usuarios.
Se listan como **reportes de terceros**, no como defectos reproducidos por este estudio:

- **Pantallazo de Safari estancado al 6%** de la barra de carga (`Safari stall at 6%`).
- **Canvas en blanco o negro** en algunos entornos.
- Problemas en **WebView embebidas de apps** (in-app browsers).
- Bugs de **transiciones** y de **input**.
- **Rechazo de autoplay de audio**.

Estos reportes motivan el requerimiento T5c (resiliencia de arranque: estados explícitos de
no-soportado y de arranque atascado en este proyecto), no una copia de la implementación
de la referencia, que no se conoce.

## Limitaciones de la observación

- **WebGPU es el camino por defecto de la referencia y sus draw calls no son observables**
  con la instrumentación usada (la instrumentación intercepta la creación de contexts
  WebGL, no el pase de WebGPU). Por eso las cifras de rendimiento de la referencia se
  midieron con `?gfx=webgl` forzado. Ver `PERFORMANCE_BENCHMARKS.md`.
- **La referencia fuerza su nivel bajo cuando detecta `navigator.webdriver` o
  HeadlessChrome.** El nivel que ve un visitante real de escritorio con su nivel elegido
  por hardware **no fue observable** en sesión automatizada.
- **La revisión de Three.js de la referencia nunca se confirmó.**
- La observación se hizo con automatización de navegador; **no hubo recorrido con
  dispositivo móvil real**, y las cifras de la referencia en WebGL no representan lo que
  daría una GPU móvil.
- El valor del overlay in-juego reportado por usuarios de la referencia
  (`draws 146 · tris 153k`) es **un reporte de usuarios**, no una medición propia: la
  propia sesión instrumentada de este estudio midió 138–184 draws en el camino WebGL2
  forzado, en el mismo orden de magnitud.
