# Auditoría del juego (rama `fix/game-audit-pass`)

Auditoría de ingeniería de SEBITA: BREACH PROTOCOL sobre `main@6da652a`, seguida de las
correcciones por prioridad: jugabilidad, estabilidad, compatibilidad, accesibilidad,
performance y mantenibilidad. No hubo reescritura ni arquitectura nueva.

Este documento separa **lo corregido**, **lo probado** y **lo pendiente**. Una fila marcada
`corregido` significa que el cambio está en la rama y que el comando de validación de la
fila se corrió y pasó. Nada de lo que no se corrió aparece como probado.

## Línea base

Corrida antes de tocar código, sobre `main@6da652a`, en un Apple M3 con Bun 1.4.4:

| Comando | Resultado |
| --- | --- |
| `bun run typecheck` | sin errores |
| `bun run test:rust` | 144 pasan en la librería, 7 en `public_api` |
| `bun run test:unit` | 39 archivos, 299 tests pasan |
| `bun run test:e2e` | 49 pasan (9.6 min, un worker) |
| `cargo test --workspace --locked` | todo verde |
| `cargo clippy --workspace -- -D warnings` | sin avisos |
| `cargo fmt --check` | limpio |

## Cómo leer las severidades

| Nivel | Criterio |
| --- | --- |
| P0 | El juego no arranca o pierde datos |
| P1 | Rompe una promesa de jugabilidad, o deja una plataforma sin poder jugar bien |
| P2 | Degrada la experiencia, la accesibilidad o la confianza en las pruebas |
| P3 | Higiene y deuda con costo bajo |

## Hallazgos

### P0

| # | Hallazgo | Archivo | Reproducción | Impacto | Corrección | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-01 | El juego no arrancaba con el almacenamiento bloqueado: el parámetro por defecto `= globalThis.localStorage` se evalúa fuera de `try` y el getter lanza `SecurityError` | `src/core/settings.ts`, `src/core/scores.ts` | `addInitScript` que hace lanzar a `localStorage`; sin el arreglo el menú nunca aparece (30 s de timeout) | Pantalla en blanco con datos de sitio bloqueados, modo privado estricto o políticas corporativas | `safeStorage()` en `src/core/storage.ts`, usado por ajustes, puntajes y progreso | `tests/unit/storage.test.ts`; e2e `the game reaches the menu when the browser blocks localStorage`, que falla sin el arreglo y pasa con él | corregido |

### P1

| # | Hallazgo | Archivo | Reproducción | Impacto | Corrección | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A-02 | La mira no seguía al mouse 1:1: `look()` sumaba el 45 % de cada giro al retroceso (sobrepaso de 1.45× y rebote de ~0.2 s) y el pitch efectivo no tenía tope | `core/src/player.rs` | Con retroceso cero, un giro más un tick daba `aim_dir` distinto del yaw/pitch guardado | Apuntar impreciso y con "resorte" en cada flick | El giro mueve la mira exactamente lo girado; solo se descuenta retroceso cuando va en contra y sin cruzar cero; pitch efectivo acotado | `look_without_recoil_is_one_to_one`, `look_against_recoil_moves_the_aim_exactly_the_flick`, `look_never_pushes_recoil_past_zero`, `effective_pitch_is_clamped` | corregido |
| A-03 | Táctil: `.tbtn{58px}` pisaba a `.tbtn--fire{76px}`; con ≤430 px de alto desaparecían cambio de arma y ADS; en pantallas angostas los botones se superponían con el stick | `src/styles/touch.css` | Spec `mobile-layout` en 915×412, 844×390, 667×375, 390×844, 360×640 y 320×568 | Mitad de los controles inutilizables en teléfonos | Cluster por variables de tamaño (`--f`, `--s`, `--g`, `--r0`, `--b0`); ningún breakpoint puede pisar a otro | `tests/e2e/mobile-layout.spec.ts` (proyectos `mobile-landscape` y `mobile-portrait`) y capturas inspeccionadas a ojo | corregido |
| A-04 | Puntuación y objetivo se ocultaban con ≤1100 px, es decir en todo teléfono y tablet | `src/styles/hud.css` | Mismo spec, aserción `score and objective stay visible` | El jugador móvil nunca veía su puntaje ni qué hacer | Variante compacta bajo la fila de terminales; sin pisar minimapa, sector, reloj, terminales, feed, munición ni vida | `HUD blocks do not overlap…` en 915×412, 844×390, 667×375, 1024×768, 390×844 y 360×640; con el tutorial visible, igual (el objetivo compacto y el feed se ocultan mientras el tutorial está activo) | corregido |
| A-05 | Tutorial sin adaptar al dispositivo ("WASD o joystick", Enter/Retroceso en táctil); el paso 3 no nombraba E/Ⓔ; Retroceso omitía todo sin confirmar; en táctil no había cómo continuar | `src/core/tutorial.ts`, `index.html` | Abrir el tutorial en el emulador táctil | Instrucciones incorrectas y un atajo destructivo de un solo toque | Copy por dispositivo, botón Continuar, confirmación de Retroceso en 2 s, cue y destello al completar un paso | `tests/unit/tutorial.test.ts`, `tests/e2e/mobile-tutorial.spec.ts`, e2e `Backspace skips…` | corregido |
| A-06 | Las teclas pulsadas en menús llegaban armadas al primer tick (por ejemplo Espacio al activar un botón) | `src/input/input.ts`, `src/input/keyboard.ts` | Mantener `W` en el menú y entrar a práctica: el jugador avanzó 3.84 m sin tocar nada | Saltos y disparos fantasma al empezar o reanudar | `KeyboardState.keyDown` ignora lo que llega fuera de partida; `input.reset()` al entrar a `playing` | `tests/unit/keyboard.test.ts`; e2e `keys pressed on a menu…`, que falla sin el arreglo | corregido |
| A-07 | Reanudar o iniciar con el contexto WebGL perdido corría la simulación detrás de un canvas congelado | `src/core/game.ts` | Pausar, perder el contexto y pulsar Continuar | Partida avanzando sin que el jugador la vea | `resume`, `startMatch` y `frame` respetan `renderer.isContextLost` y dejan la pausa con el aviso | e2e `Continuar does nothing while the WebGL context is lost…` (tick congelado en pausa; tras restaurar, Continuar reanuda) | corregido |
| A-08 | La precarga en reposo cambiaba el menú de aterrizaje por la hoja de calibración sin ninguna entrada del usuario | `src/core/game.ts`, `src/core/screens.ts` | Primera visita, esperar a que cargue | La pantalla cambia bajo el cursor | `routesToCalibration`: solo un Jugar explícito entra por calibración; Jugar desde el menú ofrece calibración una vez | `tests/unit/flow.test.ts`; e2e `an idle preload leaves…` | corregido |
| A-09 | El preset `high` no tenía tope de píxeles: 1600×900 a DPR 2 renderiza 3200×1800 con un composer HalfFloat 4× MSAA | `src/render/renderer.ts`, `src/render/presets.ts` | `bun run bench:frames` | 44.7 fps con p95 de 34.5 ms en un M3 | Presupuesto de 3.5 MP en `high` | `bench:frames`: 60 fps, p95 18.2 ms; `tests/unit/render-pixel-budget.test.ts`; comparación de capturas | corregido |

### P2

| # | Hallazgo | Archivo | Impacto | Corrección | Validación | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| A-10 | Patrulla con temblor: el waypoint avanzaba a 12 Hz y orbitaba el origen del mundo | `core/src/enemy.rs` | Enemigos que no patrullaban, solo vibraban y convergían al centro | Lazo de 4 m alrededor del punto de aparición; avanza al llegar o a los 4 s | `patrol_walks_a_loop_around_its_spawn_without_jitter` | corregido |
| A-11 | La cadencia se redondeaba hacia arriba por tick: la carabina daba 600 rpm en vez de 660 | `core/src/player.rs` | Armas más lentas de lo que dice la tabla | `fire_cd` arrastra el resto (un tick como máximo) | `held_trigger_fires_at_the_spec_rate` para las tres armas; `idle_time_does_not_bank_shots` | corregido |
| A-12 | `RELOAD_END` no se emitía al terminar una recarga; el disparo en seco recargaba aunque la auto-recarga estuviera apagada | `core/src/sim.rs`, `src/core/events.ts`, `src/audio/audio.ts` | Sin cue de fin de recarga; ajuste ignorado | Evento con `b=1` al completar (`b=0` sigue siendo el cambio de arma); el seco respeta `FLAG_AUTO_RELOAD` | `completing_a_reload_emits_reload_end`, `dry_fire_reloads_only_with_auto_reload`, `tests/unit/events.test.ts` | corregido |
| A-13 | Una oleada podía quedar abierta para siempre | `core/src/sim.rs`, `core/src/enemy.rs` | La sonda `every_spawn_point_reaches_a_passive_player_on_every_map` **reprodujo** el problema: 37 combinaciones de mapa, tipo y punto de aparición no llegaban nunca a un jugador pasivo (quedaban patrullando sin línea de visión) | Tras 20 s de patrulla sin detectar al jugador, el enemigo sale a buscarlo | La misma sonda pasa en los tres mapas y los tres tipos | corregido |
| A-14 | Accesibilidad: destello de daño sin control, estados solo por color, objetivos de toque <44 px, `--subtle` con 3.93:1 sobre `surface-2`, pausa que no era diálogo, foco perdido, toast sin región viva | varios | Ver `ACCESSIBILITY_CHECKLIST.md` | Ver el checklist; `reduceFlashes`, marcadores de texto/forma, `role="dialog"`, 44 px, `--subtle` a 4.86:1 | `tests/unit/contrast.test.ts`, `tests/unit/hud-flash.test.ts`, `tests/e2e/a11y.spec.ts` | corregido (parcial, ver pendientes) |
| A-15 | El escritorio no tenía ADS (clic derecho), el táctil no tenía sprint y el deslizador de accesibilidad pisaba la sensibilidad táctil | `src/input/input.ts`, `src/ui/settings-form.ts` | Controles asimétricos entre dispositivos | Clic derecho mantenido = ADS; el stick cerca del borde corre; el deslizador escribe solo el dispositivo activo | `tests/unit/input-weapons.test.ts`, `tests/unit/settings.test.ts`, e2e `holding the right mouse button…` | corregido |
| A-16 | `auto` quedaba atascado en `medium`: un rAF atado a vsync nunca baja de 12 ms, el umbral para subir | `src/core/quality.ts` | `high` no se alcanzaba en ningún equipo de 60 Hz | Sube también si los frames sostienen el vsync y el costo de CPU del render deja margen; tras bajar de un preset no vuelve a él por esa vía durante la sesión | `tests/unit/quality.test.ts`; `bench:frames --presets auto`: antes `medium`, después `high` a 59.8 fps | corregido |
| A-17 | Pruebas: el e2e de jugabilidad inyecta estado y no había proyecto móvil. Documentos con números viejos (ADR 0001 tamaño del wasm, ADR 0004 bloom y DPR) | `playwright.config.ts`, `docs/adr/*` | Confianza inflada | Proyectos `mobile-landscape` y `mobile-portrait`; cifras de ADR corregidas | Ver `QA_TEST_PLAN.md` | corregido (con la salvedad de WebKit, ver pendientes) |

### P3

| # | Hallazgo | Estado | Nota |
| --- | --- | --- | --- |
| A-18 | Reiniciar en el mismo mapa conservaba decals y casquillos | corregido | `Renderer.resetFeedback()` en `startMatch`; e2e `restarting on the same map clears…` |
| A-19 | Un envío al tablero en vuelo pintaba el panel de la partida siguiente | corregido, sin prueba de regresión | `submitBoard` descarta el resultado si `pending` cambió. Falta una prueba que retenga la respuesta de `/api/runs` y empiece otra partida |
| A-20 | Vista nueva del buffer de entrada del wasm en cada tick | corregido | `Engine.tick` reutiliza la vista hasta que la memoria cambia de `ArrayBuffer` |
| A-21 | `node()` reserva un objeto por terminal por frame en `terminals.ts` | corregido | `Snapshot.node(index, out)` reutiliza un objeto; sin medición separada (ver `PERFORMANCE_REPORT.md`) |
| A-22 | `locale` y el tema claro son código muerto | diferido | Sin impacto; fuera de alcance |

## Cambios de comportamiento que el jugador nota

- Los giros del mouse son 1:1; el retroceso ya no "rebota".
- Las tres armas disparan a su cadencia de tabla (la carabina pasa de 600 a ~660 rpm).
- Las patrullas recorren un lazo alrededor de donde aparecen. A los 20 s sin detectarte salen a buscarte.
- `Retroceso` en el tutorial pide una segunda pulsación en 2 s.
- `Reiniciar` y `Salir al menú` desde la pausa piden confirmar con una segunda pulsación en 3 s.
- Jugar desde el menú por primera vez ofrece la calibración una vez.

## Cambio de versión de la simulación

`SCORE_VERSION` y `OVERFLOW_SCORE_VERSION` pasan de 3 a 4 y `LOG_VERSION` de 3 a 4, porque la
simulación cambió a propósito (A-02, A-10, A-11, A-12, A-13). El cliente y la API tienen que
desplegarse juntos: la API lee `LOG_VERSION` de `bp_core`. No hay datos de producción que invalidar
porque la API nunca se desplegó (`docs/deploy.md`).

Pines que cambiaron a propósito (la regla de pruebas, paso 4, quedó autorizada al aprobar el plan):

| Pin | Dónde | Qué sigue cubierto |
| --- | --- | --- |
| `GOLDEN_HASH` y `SCENARIO_PINS` | `core/src/replay.rs`, espejados en `tests/unit/determinism.test.ts` | Igualdad nativo/wasm y replay == vivo para las tres modalidades |
| Fixtures de `server/tests/common/mod.rs` | el guion de disparo ahora barre la mira | El orden de puntajes `fire > idle` del test de la API |
| Versión 4 en `core/tests/public_api.rs` y `tests/unit/determinism.test.ts` | contrato de versión | La ABI reporta la versión activa y los logs llevan `LOG_VERSION` |

## Pruebas que cambiaron de intención

| Prueba | Cambio | Motivo |
| --- | --- | --- |
| `gameplay`, `objective-marker`, `screens`: `screenIs('calibrate')` tras `goto` | Ahora `openCalibration()`: menú → Jugar → calibración | A-08: la precarga en reposo ya no salta a calibración |
| `resilience`, `smoke`: `startRun` | `playFromLanding()` | Mismo motivo |
| `Backspace skips…` | Dos pulsaciones y comprobación del aviso | A-05 |
| pausa → menú | `dblclick()` | Confirmación de Salir al menú |
| `objective-marker`: texto del paso 3 | Ahora nombra el botón Ⓔ | A-05 |
| `screens`: omitir el tutorial con Retroceso | Dos pulsaciones | A-05 |
| `gameplay`: rumbo del daño real, ventana de 1800 a 4000 ticks | La primera herida llega más tarde porque las patrullas esperan 20 s | A-13; la intención del test no cambió |

## Decisiones abiertas

- **Headshot a `0.78·h`** (`core/src/sim.rs`, `fire_ray`). `SPEC.md` no define la intención de diseño. No se tocó.
  Está registrado en `GAMEPLAY_SPEC.md` como decisión abierta.
- **Umbral de 20 s para que las patrullas salgan a buscar** y **radio de 4 m del lazo**: valores razonados, sin
  playtest. Ajustar con jugadores reales.
- **Sprint táctil con el stick a >0.9**: el stick limita cada eje por separado, así que empujar fuerte hacia una
  diagonal también lo activa. Validar en un dispositivo real.

## Diferido a propósito

| Qué | Por qué |
| --- | --- |
| Reasignar teclas | Función nueva, no un defecto |
| Separación de enemigos contra paredes y ajuste de costuras (`sim.rs:742`, `arena.rs:183`) | Física riesgosa: necesita sus propias pruebas antes de tocarse |
| Pestañas con roving tabindex completo (ARIA tabs) | Cambia el modelo de teclado del menú; el foco y los roles actuales cubren el uso básico |
| Ajuste de tamaño de texto | Función nueva |
| Modos de daltonismo más allá de las señales no cromáticas | Función nueva |
| Subtítulos | No hay voz: no aplica |
| Ajuste de balance del headshot | Decisión de diseño, ver arriba |
| Cerrar `__BREACH__` y `debugRunToEnd` en el build de producción | Los e2e dependen de ellos en ese build |
| `Renderer.dispose` y compresión de HDR | Fuera de alcance |
| `locale` y tema claro | Código muerto sin impacto |

## Pendiente: necesita a una persona

Marcado `pending (human)`. No hay cifras inventadas.

- Pruebas en Android Chrome e iOS Safari físicos.
- FPS en móvil real (todas las filas móviles de `PERFORMANCE_REPORT.md` están vacías).
- Prueba de tutorial con una persona nueva, mirando dónde se traba.
- Firefox y Safari de escritorio, a mano.
- Red lenta.
- Pointer lock real de escritorio: Playwright headless no puede capturar el puntero.
- WebKit de Playwright: el runner pedido (`webkit-2215`) no está instalado en este equipo (hay `webkit-2388`, de otra
  versión), así que el proyecto `mobile-portrait` emula un iPhone 13 sobre Chromium. No es Safari.
- A 360×640 y 320×568 en vertical el botón Ⓔ queda sobre la lectura de munición (no sobre otro control). Cosmético;
  la solución real es reubicar el bloque de munición en vertical y necesita revisión de diseño.

## Desviaciones del plan aprobado

Cosas que el plan decía de una forma y se hicieron de otra, o no se hicieron:

| Plan | Qué pasó | Motivo |
| --- | --- | --- |
| Proyecto `mobile-portrait` en WebKit | Emulación de iPhone 13 sobre Chromium | Falta el runner `webkit-2215`; instalarlo es una descarga que no se pidió |
| Rotación: «usar `screen.orientation` cuando exista» | Solo `@media (orientation: portrait)` | `screen.orientation.lock` exige pantalla completa en casi todos los navegadores; el aviso es informativo |
| Pista contextual de recarga en el paso 2 del tutorial | No se agregó | El HUD ya muestra «R para recargar» o «tocá ⟳» con el cargador vacío |
| E2E táctil: «el tutorial se puede completar y omitir» | Solo se prueba continuar paso a paso y omitir | Completar exige llegar a un terminal y activarlo con toque; no se automatizó |
| Pruebas de HUD en 320×568 vertical | Excluidas (`HUD_MIN_PORTRAIT_HEIGHT = 640`) | A esa altura el bloque de munición, la vida y el objetivo no caben sin solaparse; es un límite conocido, no un arreglo |
| `--subtle` «≥4.5:1 sobre surface-2 (medido)» | 4.86:1 sobre `surface-2`; 4.05:1 sobre `surface-3` | Se midió sobre `bg`, `surface-1` y `surface-2`, que son las superficies donde hay texto |
| Auto-calidad «solo si el baseline muestra que se atasca» | Se cambió | El baseline lo mostró: `auto` quedó en `medium` para siempre |
| Título de los commits | Varios pasan de 50 caracteres | Ver el informe final; no se reescribió la historia sin permiso |
