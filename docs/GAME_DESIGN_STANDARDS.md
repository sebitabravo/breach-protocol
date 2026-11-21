# Estándares de diseño y de ingeniería del juego

Reglas que el proyecto ya cumple o que esta auditoría dejó fijadas, con la prueba que las sostiene.
Una regla sin prueba se marca como **convención**. Lo que `SPEC.md` pide y todavía no existe no está
acá: está en `GAME_AUDIT.md`.

## Simulación

| Estándar | Prueba |
| --- | --- |
| Toda regla de juego vive en el núcleo Rust; el shell reenvía input y lee el snapshot | Convención (`docs/architecture.md`) |
| Paso fijo de 60 Hz; el shell acumula tiempo, el núcleo no lee relojes | `tests/unit/loop.test.ts` |
| Determinismo: mismo seed y mismos inputs dan el mismo hash en nativo y en wasm | `golden_hash_is_pinned`, `scenario_hashes_are_pinned`, `tests/unit/determinism.test.ts` |
| El replay reproduce la partida viva bit a bit en todas las modalidades | `daily_replay_reproduces_the_live_run_for_every_mutator` y compañía en `core/src/replay.rs` |
| Balance en tablas de datos, no en la lógica de disparo | `core/src/weapons.rs`, `core/src/enemy.rs` |
| Un cambio de comportamiento de la simulación sube `SCORE_VERSION` y `LOG_VERSION` y cambia los pines **en el mismo commit**, con el motivo | `docs/GAME_AUDIT.md` («Cambio de versión de la simulación») |
| La cadencia se mide en disparos por segundo, no en ticks | `held_trigger_fires_at_the_spec_rate` |
| Un jugador pasivo no puede dejar una oleada abierta | `every_spawn_point_reaches_a_passive_player_on_every_map` |

## Entrada y estado del shell

| Estándar | Prueba |
| --- | --- |
| La mira sigue al puntero 1:1; el retroceso es aparte y no secuestra el mapeo | `look_without_recoil_is_one_to_one` |
| Lo que se pulsa fuera de partida no entra a la partida | `tests/unit/keyboard.test.ts`, e2e `keys pressed on a menu…` |
| El almacenamiento del navegador puede fallar en cualquier momento y el juego arranca igual | `tests/unit/storage.test.ts`, e2e `blocks localStorage` |
| Con el contexto WebGL perdido la simulación no corre | e2e `losing the WebGL context pauses…` |
| Una pantalla no cambia sin una acción del usuario | `tests/unit/flow.test.ts`, e2e `an idle preload…` |
| Los listeners viven en un solo `AbortController` | Convención |
| Los controles de ayuda por dispositivo escriben solo el ajuste de ese dispositivo | `tests/unit/settings.test.ts` |

## Interfaz y táctil

| Estándar | Prueba |
| --- | --- |
| Los botones de juego táctiles no se superponen entre sí ni con el stick y caben en pantalla | `tests/e2e/mobile-layout.spec.ts` (915×412, 844×390, 667×375, 390×844, 360×640, 320×568) |
| Tamaño de un botón = una variable; un breakpoint cambia variables, no reglas por botón | Convención en `src/styles/touch.css` |
| Puntaje y objetivo siempre visibles; en pantallas chicas, en variante compacta | Mismo spec |
| Objetivos de toque ≥44 px | Mismo spec (juego y pausa) |
| Piso de 11 px para el texto del HUD | Convención en `src/styles/hud.css` |
| Las instrucciones nombran los controles del dispositivo en uso | `tests/unit/tutorial.test.ts` |
| Las acciones que descartan progreso piden confirmación | e2e `pausing stops…`, `Backspace skips…` |
| Jerarquía del HUD: supervivencia, luego objetivo, luego feedback | Convención |
| Identidad visual: tokens de `src/styles/tokens.css`, tipografía del sistema (ADR 0005) | Convención |

## Accesibilidad

El detalle y el estado de cada pauta están en `ACCESSIBILITY_CHECKLIST.md`. Los mínimos que ya
sostiene una prueba:

- Texto a 4.5:1 sobre las superficies de uso (`tests/unit/contrast.test.ts`).
- El destello de daño tiene un modo reducido, y `reduceMotion` y la preferencia del sistema lo activan.
- Ningún estado de juego depende solo del color (parcial; ver el checklist).

## Performance

| Estándar | Prueba |
| --- | --- |
| Cada preset tiene un presupuesto de píxeles del drawing buffer | `tests/unit/render-pixel-budget.test.ts` |
| Toda afirmación de performance trae el comando y el equipo | `docs/PERFORMANCE_REPORT.md` |
| Las cifras de móvil quedan vacías hasta medirlas en un dispositivo | `docs/PERFORMANCE_REPORT.md` |
| La calidad automática decide con el intervalo de frame y el costo de CPU, con histéresis | `tests/unit/quality.test.ts` |

## Pruebas

Las reglas completas están en `~/.claude/rules/common/testing.md`. Las que esta auditoría aplicó:

1. Todo defecto corregido tiene una prueba que falla sin el arreglo (se verificó en A-01 y A-06 quitando
   el arreglo y viendo la prueba fallar).
2. Un pin solo cambia cuando el comportamiento cambió a propósito, y el motivo queda escrito.
3. Un resultado en verde no se declara sin el comando que lo produjo (`QA_TEST_PLAN.md`).
