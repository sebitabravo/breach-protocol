# Decisiones técnicas

Índice de los ADR y registro de las decisiones tomadas en la auditoría `fix/game-audit-pass`.
Los ADR son la fuente; este documento solo los enlaza y anota lo que cambió desde que se escribieron.

## ADR

| ADR | Decisión | Estado | Anotación de esta auditoría |
| --- | --- | --- | --- |
| [0001](adr/0001-rust-wasm-core.md) | Núcleo de simulación en Rust compilado a WebAssembly | aceptado | El binario mide 85.4 KiB (36.5 KiB gzip); el ADR decía 69.7 KiB. Corregido en el ADR |
| [0002](adr/0002-visual-direction.md) | Dirección visual según los mockups | aceptado | Sin cambios |
| [0003](adr/0003-replay-verified-leaderboard.md) | Tablero verificado por replay | aceptado | Todas las versiones (`SCORE_VERSION`, `OVERFLOW_SCORE_VERSION`, `LOG_VERSION`) son ahora **4**. Los pines de hash del ADR están desactualizados; los vigentes están en `core/src/replay.rs` |
| [0004](adr/0004-bloom-postprocessing.md) | Bloom con postprocesado en medium y high | aceptado | Actualización agregada: niveles de bloom reales por preset, presupuesto de píxeles y cifras medidas con ventana |
| [0005](adr/0005-typography-and-switch.md) | Tipografía de sistema y switch nativo | aceptado | Sin cambios |

## Decisiones de esta auditoría

Cada una está justificada con más detalle en `GAME_AUDIT.md`; acá va el porqué corto y la alternativa descartada.

| # | Decisión | Porqué | Alternativa descartada |
| --- | --- | --- | --- |
| T-1 | `safeStorage()` único para todo acceso a `localStorage` | El getter puede lanzar fuera de cualquier `try` | Envolver cada llamada: se vuelve a olvidar |
| T-2 | Todos los cambios de simulación en un solo commit y una sola subida de versión | Cualquiera de ellos cambia los hashes dorados; separarlos obligaba a repinear cuatro veces | Un commit por cambio de simulación |
| T-3 | El resto de la cadencia se arrastra con tope de un tick | Evita que un toque suelto «guarde» disparos | Acumulación sin tope |
| T-4 | Las patrullas salen a buscar tras 6 s (20 s en la v4) | Es la forma barata de garantizar que una oleada cierre; la sonda lo prueba en los tres mapas | Un temporizador de oleada: castiga al jugador por algo que hizo el enemigo |
| T-5 | `KeyboardState.keyDown` ignora lo que llega fuera de partida, además de reiniciar el input al entrar a `playing` | Un reinicio solo no alcanza: una tecla pulsada después del reinicio y antes de empezar quedaba armada | Solo `input.reset()` |
| T-6 | Cluster táctil por variables de tamaño | La regla de un botón pisaba a la de otro por orden de aparición | Subir la especificidad de cada regla |
| T-7 | Sprint táctil por deflexión del stick, solo en cliente | No cambia la simulación: `I.run` ya existía | Un botón nuevo de sprint (otro objetivo de toque en un cluster ya lleno) |
| T-8 | `reduceFlashes` como ajuste propio, implícito en `reduceMotion` | La fotosensibilidad no es lo mismo que el movimiento, pero quien ya pidió menos movimiento espera menos destellos | Reutilizar solo `reduceMotion` |
| T-9 | Presupuesto de 3.5 MP para `high` | Medido: 60 fps con p95 de 18.2 ms frente a 44.7 fps sin tope; sin diferencia visible | MSAA de 2 muestras: no hizo falta |
| T-10 | `auto` sube también por margen de CPU; tras bajar de un preset no vuelve a él por esa vía en toda la sesión | Un rAF atado a vsync nunca baja de 12 ms; el CPU no ve la GPU, así que sin el techo un equipo limitado por GPU subiría y bajaría con un tirón periódico | Bajar el umbral de 12 ms: confunde un 120 Hz con un 60 Hz; un techo de 120 s: repite el tirón cada dos minutos |
| T-11 | Los proyectos móviles de Playwright emulan sobre Chromium | El runner de WebKit pedido no está instalado en este equipo | Instalar WebKit sin preguntar; Safari real queda pendiente |
| T-12 | Volumen en tres canales: maestro, efectos e interfaz | No existe música; los canales multiplican sobre el maestro y los ajustes viejos migran con 1.0 | Un solo deslizador |
| T-13 | El HUD compacto oculta el objetivo y el feed mientras el tutorial está activo | El tutorial ya dice qué hacer y compite por el mismo espacio | Reubicar todo: no hay espacio en 667×375 |
| T-15 | Robots con skinning rígido instanciado: 11 piezas por tipo, una matriz por pieza e instancia en una textura RGBA32F, un draw por tipo | Animación real (caminar, apuntar, caer) sin romper el presupuesto de 60 draws; determinista y sin licencias | `SkinnedMesh` desde un GLB CC0: no se instancia en three.js (un draw por robot y material) y los packs revisados no publican sus clips |
| T-16 | Dificultad ajustada con un bot de referencia y una prueba de banda | Cada cambio de IA se mide en 10 semillas por sector; la prueba impide que la dificultad se caiga sin que nadie lo note | Ajustar a ojo; el zigzag de los scouts parecía más difícil y medido resultó más fácil |
| T-14 | Documentos nuevos en español | Es el idioma de los ADR y de `performance-budget.md`; los comentarios de código también | Inglés, como `benchmark-results.md` |

## Deuda técnica conocida

Ver «Diferido a propósito» en `GAME_AUDIT.md`.
