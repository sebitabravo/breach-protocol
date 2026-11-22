# Backlog de optimización — veredictos contra la realidad medida de este proyecto

Documento T7/S4 de la tarea REA (`odd/tasks/rea-halloween-study.md`, S4/S8/S12 y la lista de
técnicas del brief). Veredicto por técnica sobre la lista del propietario, medido contra lo que
este proyecto **realmente paga** hoy: WebGL2 forward render + simulación WASM de paso fijo,
en el presupuesto medido del T1 (fila medium corregida en
[`PERFORMANCE_BENCHMARKS.md`](PERFORMANCE_BENCHMARKS.md); veredictos citan esa fila corregida).

Etiquetas de evidencia como en el resto de la carpeta: `CONFIRMADO` (observado directo en este
árbol o por el harness del proyecto), `INFERIDO` (deducido de evidencia observada, sin confirmar
el detalle), `NO VERIFICADO` (no pudo observarse aquí). No hay números inventados (S12): cuando
una cifra no existe, el documento dice qué faltaría para producirla.

## Línea de realidad usada para juzgar

Cifras del T1 con la fila medium **ya corregida** (el artefacto de muestreo está documentado en
`PERFORMANCE_BENCHMARKS.md`, «Corrección de la fila medium»):

| Preset | fps | p95 | Draw calls | Triángulos |
| --- | ---: | ---: | ---: | ---: |
| low | 60 | 17.6 ms | 16 | 47 954 |
| medium | 60 | 17.6 ms | 21 | 47 846 |
| high | 59.9 | 17.3 ms | 26 | 47 854 |

Contexto del veredicto (`CONFIRMADO`): el p95 está clavado al vsync de 60 Hz del monitor y el
tiempo de CPU del render es p50 1.2–1.3 ms / p95 1.8–2.0 ms
(`test-results/frames-rails-*.json`); la referencia paga 138–152 draws y ~150k tris en la misma
máquina (L6/L8). La brecha honesta de este proyecto es riqueza por píxel, no costo bruto.

## Tabla de veredictos

| # | Técnica | Veredicto | Razón en una línea |
| --- | --- | --- | --- |
| 1 | Corrección de materiales | INVESTIGATE LATER (3 hallazgos acotados) | Tres hallazgos específicos: clearcoat del piso, canal R de ARM sin usar en wall/metal, emissive del enclosure; nada justifica un edit sin captura A/B |
| 2 | Baked lighting (como medida de performance) | REJECT | No hay costo de frame que ahorrar: la sombra del key ya es un pase estático único y las practicals son dinámicas por diseño |
| 3 | KTX2/Basis | APPLY NOW (en vuelo, unidad paralela) | 48.0 MiB de VRAM medidos por 9 WebP vs ~6 MiB estimados en ETC1S |
| 4 | Meshopt / Draco | REJECT | Payload glTF entregado: 125 840 B (2 GLB, 1 324 tris); el ahorro máximo no es medible en boot |
| 5 | Instancing (cobertura) | COMPLETO — sin remanente | Todo objeto repetido ya vive en un lote; inventario con evidencia |
| 6 | LOD por distancia / culling por instancia | REJECT / INVESTIGATE LATER | LOD: 3× menos tris que la referencia y 60 fps clavados al vsync no dejan ganancia; culling por instancia: bloqueado por la fila móvil ausente |
| 7 | Resolución adaptativa | (unidad paralela) | Registro de la medición esperada del padre T5x; sin duplicar implementación |
| 8 | Tooling 3D / pipeline de modelos | REJECT | La geometría de este proyecto no pasa por un pipeline de modelos: 1 324 tris importados contra ~46k autorados en código |

---

## 1. Materiales y corrección PBR

Auditoría de lo que los materiales hacen hoy (`CONFIRMADO` en código salvo lo etiquetado).

### Qué está bien y no debe tocarse

- **Packing ARM correcto y deliberado.** `SURFACE.load` conecta `*_diff`, `*_nor`, `*_arm`
  (`src/render/surfaces.ts:42,50-51`). El piso usa el canal **R** (oclusión) vía `aoMap` con
  intensidad 0.38 y **renuncia con comentario** a usar el mismo canal como roughness/metalness:
  «ARM multiplies the roughness and would undo the matte base» (`surfaces.ts:45-48`). Wall y
  metal usan el mismo `arm` como `roughnessMap`+`metalnessMap` (canales G/B del packing ORM),
  con `metalness` de base 1 y 0.66 (`surfaces.ts:50-52`). Es el uso correcto del packing: un
  solo `*_arm.webp` alimenta tres canales PBR.
- **Un material por superficie, no por objeto.** La arena es una sola malla con cuatro grupos
  de material (`surfaces.ts:149`, `groupSurfaces`; el comentario «one mesh/four draws» es literal).
  Los finishes (paint/steel/polymer/rubber/glass) viven en un `onBeforeCompile` del material
  metal, leyendo `aSurface` por cara — seis acabados, un draw, un programa (`src/render/finishes.ts:22`,
  patrón `onBeforeCompile`). El material de la terminal
  resuelve idle/canal/activo por instancia en un solo programa (comentario de
  `src/render/terminals.ts:122`). Cero materiales por objeto en toda la escena: no hay nada que
  «corregir» ahí.
- **Enclosure excluido del pase de sombra de propósito.** `interiorDepth` descarta en el shader
  de profundidad las superficies de techo/tejas (`surfaces.ts:104-125`, `vSurface >= 3.0 &&
  vSurface < 7.0`); el key único no paga techo que no proyecta.

### Hallazgos con veredicto

**1a. Piso: `MeshPhysicalMaterial` con clearcoat 0.035 / clearcoatRoughness 0.88**
(`src/render/surfaces.ts:13-14`). El código `CONFIRMADO` es que el peso está puesto en 0.035
sobre un material físico; que un clearcoat > 0 activa el BSDF de clearcoat en el programa del
piso (un material de una sola de las cuatro draws) es `INFERIDO` del comportamiento del
material en three.js, no observado con instrumento aquí.
Aportes: (i) con peso 0.035 y rugosidad de capa 0.88 la contribución del coat está difuminada
por la rugosidad misma — una segunda rampa especular apenas perceptible sobre un piso ya
matte (`INFERIDO`, lectura de constantes); (ii) el brillo húmedo del piso que el clearcoat
tantear reemplazar vive en los mapas de textura y sus canales ARM, no en el coat. La
contribución visual exacta **NO VERIFICADA**: no existe captura A/B del piso con y sin
clearcoat a cámara determinista (el método de captura de T6a en
`RENDERING_COMPARISON.md`). **Veredicto: INVESTIGATE LATER** — una captura A/B con el método
determinista de T6a decide: si la capa es indistinguible, el cambio a
`MeshStandardMaterial` es un simplificación barata (un material, una draw); si se ve, se
conserva; un edit sin esa captura sería S8/S12.

**1b. Wall y metal: el canal R de ARM se descarta (oportunidad inversa).** El mismo `*_arm`
de wall y metal ya contiene oclusión que el proyecto **descarga** — esos materiales no
reciben `aoMap` (`surfaces.ts:49-52`); solo el piso lo consume. El costo de conectarlo es
cero VRAM (el dato ya está en la textura) y un fetch más por fragmento en las dos draws ya
mapeadas, con el pin de canal correspondiente (three r181 usa canal de UV por textura;
fijar el canal al mismo UV en tiling que los otros mapas — detalle a verificar en la unidad
escritora, `INFERIDO` del comportamiento de versión). Beneficio: oclusión de panel/junta
per-pixel gratis en la superficie que más pantalla ocupa. **Veredicto: APPLY NOW** — es
usar un dato pagado hoy en VRAM, de costo de frame de borde bajo y barra de riesgo
mínima; su efecto visual es aditivo y medible en captura determinista.

**1c. Enclosure: `emissive: 0x16200c × 0.5` casi negro** (`src/render/surfaces.ts:17`). La
radiación emisiva del material enclosure multiplica un color sRGB casi negro por 0.5:
`INFERIDO` aporte < ~1 % de radiación — un término que el fragmento evalúa y el ojo no ve.
El doble cara del material (`side: THREE.DoubleSide`, misma línea) **sí es necesario hoy**:
los slabs de piso elevado y beams emiten una sola cara orientada hacia afuera
(`src/render/arena.ts:52`, `faces:` una sola cara por pieza; el subsuelo de un piso elevado
es la cara trasera del quad emitido), así que FrontSide rompería la vista desde abajo.
**Veredicto (1c, conjunto): APPLY NOW** para el emissive casi negro (si el A/B propio de la
unidad lo confirma invisible, downcale a `emissive: 0x000000` o retirarlo — mismo argumento
que 1a); **REJECT** el cambio de DoubleSide: la cara única por pieza lo hace
arquitecturalmente necesario, y emitir caras espejo para poder usar FrontSide pagaría más
geometría de la que el raster ahorra (`INFERIDO` — no hay proyección de fragment workload
que justifique el edit; el baseline no muestra coste atribuible aquí).

---

## 2. Baked lighting

**Estado actual (`CONFIRMADO`).** Luz: hemisférica + key direccional + fill
(`src/render/renderer.ts` constructor) + 2 luces prácticas de servicio y una de riser por
punto (`renderer.ts:477-483`, solo el sector de control, `applyPracticals`). La sombra del
key es **ya un pase estático**: `dirLight.shadow.autoUpdate = false` con
`needsUpdate` puntual al cambiar de sector y en context restore (`renderer.ts:469-470`,
`setSector`, `onContextRestored`) — el shadow map se calcula una vez y se reutiliza; los
robots no proyectan sombra en él (`enemies.ts:183`, `castShadow = false`). El HDRI alimenta
un PMREM generado una vez por install (`src/render/environment.ts:21-29`): el IBL de este
proyecto ya es, en la práctica, un bake del HDRI al target del PMREM.

**Lo que se podría hornear y lo que no.** Perfecto candidato estático: los occluders de la
arena (malla unificada, geometría inmutable por sector) y un AO/lightmap de la superficie
estática en un segundo canal UV. Imposible de hornear: los enemigos (rig por pose-texture,
geometría compartida — no tienen UV propia ni canal de lightmap y se mueven), el jugador
(viewmodel separado), las pantallas vivas de las terminales y todo el FX. Las practicals
**no deben hornearse de ningún modo**: son dinámicas para el jugador por diseño — el override
`gfxLights: off` (`T5a`; `resolveGfxPlan` en `src/render/presets.ts`) las apaga en runtime;
un bake fijo las
congelaría y rompería el override (`CONFIRMADO` de la restricción, `applyPracticals`).

**Costo en pipeline.** (1) UV2: toda la geometría de arena es procedural con UV en metros
para tiling (`src/render/geometry.ts:3-5`, «UV en metros (para texturas repetidas)»); un
lightmap necesita un segundo canal de UV no-tiling *autoreado por pieza* — cada pieza de
`MeshBuilder` pasaría por un unwrap, con herramienta nueva o heurística de atlas. (2) Tool
de bake: **no existe** en este repositorio ninguno (no hay baker offline ni export de escena;
T5d ya está esperando una decisión de toolchain de la misma
naturaleza); un bake real exige una herramienta de render offline y un artefacto commiteado
— la referencia solo tiene la huella `?bakeExport` (L3), sin código reutilizable. (3) Memoria: un lightmap 1024² RGBA8 con mips
cuesta ~5.33 MiB por sector (misma proporción que los mapas PBR medidos en
`PERFORMANCE_BENCHMARKS.md`). (4) Shader: `lightMap` y el pin de canal, más una variante de
programa por material.

**Contra el presupuesto medido.** El beneficio de un bake **como medida de performance** es
ahorrar lo que la iluminación dinámica cuesta por frame. Ese costo hoy: sombra del key ya
estática (una vez por sector, no por frame), 3 luces prácticas + 2 direccionales + hemi por
fragmento en 4 draws, y ninguno de los tres presets cae del vsync (60/60/59.9 fps con CPU de
render en 1.2–1.3 ms p50, `test-results/frames-rails-*.json`). **No hay costo de frame que
hornear pueda ahorrar**: el dinero que un bake devolvería ya está devuelto por la
arquitectura actual. El único ángulo vivo del bake es **look-driven**: un AO estático por
luces del arena como riqueza por-pixel (la brecha honesta de L8). Ese sub-veredicto queda
**INVESTIGATE LATER** estrictamente condicionado a la decisión de toolchain (baker offline) y no
como medida de performance.

**Veredicto: REJECT** como técnica de optimización. Datos del REJECT: p95 vsync-clavado en
los tres presets, CPU de render 1.2–1.3 ms p50, sombra del key ya de un solo pase
(`renderer.ts:469-470`), IBL ya en un PMREM estático (`environment.ts:21-29`) y practicals
dinámicas por diseño (override `gfxLights`). Un bake no alteraría ninguna de esas cifras;
su categoría real (AO estático para look) exige herramientas que este árbol no tiene.

---

## 3. KTX2/Basis — registro, sin duplicar

Implementación en curso por unidad paralela (T5d, pendiente de decisión de toolchain);
este documento **no** propone implementación. Registro justificativo único:

- **Justificación medida (`CONFIRMADO`):** los 9 mapas WebP 1024×1024 del proyecto
  decodifican a 4.00 MiB c/u RGBA8, 5.33 MiB con mips — **48.0 MiB de VRAM en total**
  (`PERFORMANCE_BENCHMARKS.md`, tabla «Texturas, VRAM y payload», línea de 48.0 MiB).
- **Delta VRAM esperado:** ETC1S para las mismas piezas aterriza cerca de **6 MiB** total
  — ahorro esperado ≈ **−42 MiB** (`estimación por formato`, declarada como tal en el
  benchmark; sin artefactos `toktx`/`basisu` en el árbol para medirla más fino).

---

## 4. Meshopt / Draco

**Payload glTF entregado, medido (`CONFIRMADO`, sondeo a los GLB de `public/assets/models`):**

| Archivo | Bytes | Tris | Mallas | Imágenes |
| --- | ---: | ---: | ---: | ---: |
| `blaster.glb` | 59 552 | 624 | 1 | 1 |
| `blaster-repeater.glb` | 66 288 | 700 | 2 | 1 |
| **Total glTF entregado** | **125 840 B (~123 KiB)** | **1 324** | 3 | 2 |

En el payload de `dist/` de 4.9 MB (`PERFORMANCE_BENCHMARKS.md`) los GLB son **~2.5 %**;
el resto lo dominan texturas WebP (1.3 MB), el HDRI (1.65 MB) y el bundle JS/WASM
(`bp_core.wasm` 88 097 B). Toda la geometría de arena, robots, terminales, FX y viewmodel
fallback es procedural en código (`geometry.ts:3-5`, «Sin assets externos (S14): robots,
viewmodels y arena salen de esta primitiva») — no hay terreno importado, no hay stock de
modelos importados que comprimir, y las dos armas ya están al mínimo de vértices.

**Costo/beneficio:** Meshopt o Draco comprimirían los buffers de vértices de las 2 armas
— el ahorro absoluto máximo, gzip incluido, es de magnitud conocida: el chunk `BIN`
(buffers de vértice/índice) medido ocupa el 96.9 % de `blaster.glb` (57 696 de 59 552 B)
y el 95.2 % de `blaster-repeater.glb` (63 108 de 66 288 B), así que el blanco útil de la
cuantización son decenas de KiB **a lo sumo** sobre un payload de 4.9 MB
(`CONFIRMADO`, sondeo del header GLB). Costo real del lado de runtime: decoder adicional
(el decodificador WASM de Meshopt o el soporte de Draco en el payload de three), dos rutas
de carga para el mismo contenido, y un punto más del boot que puede fallar. El efecto que
se mediría en boot: ninguno a esa escala — una entrada de ≲70 KiB sobre 4.9 MB no mueve
ninguna de las cifras de boot registradas (`NO VERIFICADO` por abstención: no existe esa
medición y no hay vía legítima de producirla que la justifique; S12 prohibe inventarla).

**Veredicto: REJECT.** Número del REJECT: 125 840 B de payload glTF entregado (1 324 tris)
sobre 4.9 MB de dist; decoder nuevo por un ahorro no medible. Reabrir solo si el contenido
importado crece (p. ej. el fallback Quaternius de L10 aterriza como GLB real).

---

## 5. Instancing — inventario y cobertura

**Lo que ya vive en lotes (`CONFIRMADO` en código):**

| Lote | Dónde | Capacidad |
| --- | --- | --- |
| Robots por clase (3 lotes) | `src/render/enemies.ts:180` (`InstancedMesh` por `kind`) | `MAX_ENEMIES` = 32 (`src/wasm/protocol.ts:68`) |
| Terminales (1 lote) | `src/render/terminals.ts:42` | `map.nodes.length`, ≤ `MAX_NODES` = 3 (`protocol.ts:73`); housings metal/concrete estampados dentro del lote lit estático (`terminals.ts:51-55`) |
| Halos de amenaza | `src/render/telegraph.ts:40` | `MAX_ENEMIES` = 32 |
| Tracers | `src/render/fx.ts:205` (`LineSegments` unificado) | `MAX_TRACERS` = 64 (`fx.ts:9`) |
| Sparks | `src/render/fx.ts:227` (pool `Points` con `drawRange` = presupuesto por preset) | `MAX_SPARKS` = 1024 (`fx.ts:10`), presupuesto low 128 / medium 512 / high 1024 (`presets.ts:16-20`) |
| Decals (impactos) + casings | `src/render/feedback-fx.ts:13,15,97,98` (dos lotes) | atlas compartido |
| Laser de telegrafía | `src/render/telegraph.ts:16` (un `LineSegments`) | `MAX_ENEMIES` |
| Arena | una `BufferGeometry` con 4 grupos de material (`surfaces.ts`) | «one mesh/four draws» |

**Objeto repetido que aún dibuja individualmente: ninguno.** Los únicos meshes únicos fuera
de los lotes son la arena (una malla), el beacon objetivo y su rim (dos draws para **un**
objeto por frame, `src/render/objective-beacon.ts:38,48`) y el viewmodel (una escena de
primer plano con sus dos GLB y sus propias luces dedicadas, `renderer.ts` constructor) —
todos son objetos singulares, no colecciones: el instancing por lotes está saturado
(`CONFIRMADO`, inventario anterior). No queda trabajo de instancing que proponer.

---

## 6. LOD y culling

**Estado actual (`CONFIRMADO`):** todos los lotes instanciados corren con
`frustumCulled = false` — robots (`enemies.ts:182`), halos y laser (`telegraph.ts:41,58`),
tracers y sparks (`fx.ts:206,228`), decals y casings (`feedback-fx.ts:102`) — más los propios
overlays de debug (`renderer.ts:241,247,262`). La razón es estructural: la bounding sphere de
un lote cubre toda la arena (las instancias van de extremo a extremo y en el snapshot conviven
vivas, muertas y telegrafía), así que el culling frustum estándar del batch haría desaparecer
el lote entero en el frame en que su esfera sale del frustum aunque queden instancias dentro
de la vista.

**LOD por distancia.** Para lotes instanciados, el LOD por distancia exige o una segunda
geometría por clase y un swap en runtime (más programas, más memoria de vértice — doble
del rig de 5 448 tris autorados documentado en `RENDERING_COMPARISON.md`) o degeneración
en shader (costo de evaluación constante, sin ahorro). **No hay problema que resuelva:**
el presupuesto geométrico total es 47,8k tris contra ~150k de la referencia a los mismos
60 fps — 3× menos; el p95 (17.3–17.6 ms) está pegado al vsync del monitor, no a la GPU, y
la CPU de render p50 es 1.2–1.3 ms con p95 1.8–2.0 ms (`test-results/frames-rails-*.json`).
Un LOD bajaría tris ya sobrantes en frames cuyo p95 ya está pegado al vsync. **Veredicto: REJECT**
(números del REJECT: 47,8k tris vs 150k de la referencia a igual vsync; CPU de render
1.2–1.3 ms p50 — no hay ganancia de fps existente medible).

**Culling por instancia — recomendación pedida explícitamente.** El estado actual significa
que un lote de robots dibuja **todas** sus instancias vivas siempre, aunque el frustum las
deje atrás de la cámara. El mecanismo correcto es compactación CPU-side: test `Frustum`
por instancia (≤32 tests, patrón `Frustum` ya existe en `terminals.ts:24`) y escribir
`instanceMatrix` solo de las visibles. Costo: O(MAX_ENEMIES) tests por frame con objetos
reutilizados, cero programas nuevos; riesgo bajo (los contadores de `count` ya se compactan
cada frame en `enemies.ts:235`). **Beneficio medible:** los tris de robots desaparecen del
frame cuando están detrás de la cámara — pero en escritorio **nada de eso se transforma en
fps**: sigue el vsync-clavado del p95. La única vía donde el efecto puede ser real es una
GPU móvil vertex-bound, y **las filas móviles del baseline están vacías** (sin dispositivo,
`PERFORMANCE_BENCHMARKS.md`). **Veredicto: INVESTIGATE LATER** — condicionado a una línea
base móvil con GPU real: métrica objetivo (tris del mundo en frames con enemigos detrás de la
cámara y p95 sin colapsar), comparando tris con el culling encendido y apagado en partida
guionizada. No activarlo hoy «porque es estándar» sería
exactamente el consejo genérico que S12 prohibe.

---

## 7. Resolución adaptativa — registro (unidad paralela)

Ya en vuelo por unidad del padre; aquí solo queda registrado qué debe medirse para que el
cambio sea declarable: la misma corrida del harness (comando exacto del benchmark,
«Presets comparados contra la línea base T1» en `PERFORMANCE_BENCHMARKS.md`) antes y después,
con fps / p50 / p95 / calls / tris / dpr por preset — el JSON ya registra `dpr` y
`composerEstimateMb` por muestra (`scripts/measure-frames.mjs`), así que el contrato es
observar el **dpr efectivo** al que el controlador se ajusta y verificar que ningún preset
pierde fps a un dpr mayor que el presupuesto fijo actual (`presets.ts:24-33`)
y que el controlador (ventanas p95, `src/core/quality.ts:241-262`) no entra en
degradación ni en la partida guionizada ni en el soak. La comparación de presets debe
hacerse con el mismo contenido vivo (nota metodológica del benchmark).

---

## 8. Tooling 3D — qué existe y qué ángulo del modelo-tooling aplica

**Lo que ya se implementó (`CONFIRMADO`, T5e en árbol).** Con F3 detrás de `telemetry`, un
desarrollador puede hoy inspeccionar: fps / p50 / p95, **draw calls**, triángulos, ticks,
frames dropeados, preset y **dpr efectivo**, enemigos vivos, memoria (Three info + heap),
kilobytes del WASM y tiempo de carga (`src/ui/engineering.ts:26-40`), más cuatro overlays:
rejilla/ejes/AABB de enemigos y terminales, cápsula de colisión del jugador con radio y
alcance del objetivo renderizados con la forma VERDADERA del núcleo (constantes espejo
en `renderer.ts:81-92`), lectura de cámara (posición/yaw/pitch/fov) y **atribución de draw
calls por pase** — mundo / sombra / viewmodel / composer — instalando un probe de
`renderBufferDirect` solo mientras se lee el panel (`renderer.ts:414-426`). Con todo apagado
el grupo se desmonta: cero objetos y cero draws sobre el baseline (invariante testada;
sección de chequeos del benchmark: 27 → 33 → 27 draws).

**El ángulo «model tooling» del propietario** (pipeline glTF con quantización, atlas merging,
generación de LOD — lo que motorizó la optimización del juego de referencia, L3) **no es
aplicable a este árbol y aquí queda documentado como REJECT**, por cómo este proyecto
produce geometría:

- **Quantización (meshopt):** cubierta por el REJECT 4 — el payload importado total son
  125 840 B de dos armas; no hay pipeline de modelados para cuantizar.
- **Atlas merging:** ya está hecho en código, no en un tool: el atlas de decals 1024×512
  (`src/render/textures.ts:94`), la terminal con un lote + atlas canvas de pantallas
  (`src/render/terminals.ts`), el packing ARM con un material por superficie y los finishes por cara en
  un solo draw ya son, en resultado, exactamente lo que un tool de atlas produce: pocos
  draw calls (16–26) con muchas superficies.
- **Generación de LOD:** no hay malla importada que decimar (los rigs son cajas y cilindros
  procedurales, 5 448 tris en total; la arena es una malla unificada) y el REJECT 6 cubre
  por qué el LOD no pagaría a este presupuesto.

Reabrir el ángulo solo si el árbol deja de ser proc-authored (p. ej. el fallback Quaternius
de L10 se aterriza como GLBs reales con texturas propias): ahí un tool de cuantización
vuelve a tener cliente.

---

## Qué no se midió (y por qué quedan NO VERIFICADO)

- **El aporte visual del clearcoat del piso (1a) y del emissive casi negro del enclosure
  (1c):** sin captura A/B a cámara determinista la contribución visual no es medible desde
  este árbol; los veredictos exigen esa captura antes del edit (`NO VERIFICADO` por
  abstención, nunca por cifra inventada — S12).
- **El beneficio real del culling por instancia y del LOD en una GPU móvil:** sin
  dispositivo físico, las filas móviles del baseline están vacías; toda evaluación móvil
  aquí es hipotética y está etiquetada como tal (`NO VERIFICADO`).
- **El ahorro ETC1S de KTX2:** estimación por formato hasta que la unidad de T5d genere
  artefactos reales (`estimación` declarada, no medición).
- **Cualquier número de fps del camino WebGPU de la referencia:** sus draws no atraviesan
  la instrumentación WebGL (límite documentado en `HALLOWEEN_ANALYSIS.md`).
