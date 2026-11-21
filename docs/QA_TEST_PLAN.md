# Plan de pruebas y resultados

Cada fila trae el comando exacto y el resultado de la **última corrida completa de esta rama**
(`fix/game-audit-pass`, Apple M3, Bun 1.4.4, Rust del proyecto). Lo que no se corrió dice `no corrido`.
Un verde de CI o de esta tabla es evidencia, no garantía.

## Compuertas automáticas

| Compuerta | Comando | Resultado |
| --- | --- | --- |
| Tipos | `bun run typecheck` | sin errores |
| Núcleo Rust | `bun run test:rust` | 155 pasan (librería) y 7 (`public_api`) |
| Unitarias del shell y del wasm | `bun run test:unit` | 43 archivos, 348 tests pasan |
| E2E, los tres proyectos | `bun run test:e2e` | 73 pasan, 1 se omite a propósito (el aviso de rotación solo existe en vertical), 0 fallan; 13.8 min con un worker |
| Build | `bun run build` | compila |
| Workspace de Rust | `cargo test --workspace --locked` | sin fallos |
| Clippy | `cargo clippy --workspace --all-targets -- -D warnings` | sin avisos |
| Formato | `cargo fmt --check` | limpio |

El e2e corrió completo dos veces durante la auditoría. La primera dejó 6 fallos, todos consecuencia de cambios
intencionales o de un test nuevo mal planteado, y se resolvieron así:

| Fallo | Causa | Resolución |
| --- | --- | --- |
| `objective-marker` (2) | Esperaba el texto viejo del paso 3 | El texto ahora nombra el botón Ⓔ; se actualizó la expectativa |
| `screens` · omitir tutorial | Retroceso ahora pide dos pulsaciones | Se actualizó el test |
| `gameplay` · rumbo del daño | La primera herida llegaba antes de los 30 s; ahora los enemigos patrullan 20 s antes de salir a buscar | La ventana de búsqueda subió de 1800 a 4000 ticks. La intención del test (verificar el rumbo del primer daño real) no cambió |
| `premium` · 320×640 | Los enlaces del pie del menú se partían en dos líneas con el mínimo de 44 px (regresión real de la auditoría) | Corregido en `touch.css` |
| `resilience` · Continuar con contexto perdido | El aviso de contexto perdido cubre el botón; el click de Playwright esperaba para siempre | El test invoca el botón con `dispatchEvent` |

## Qué cubre cada capa

| Capa | Qué verifica | Dónde |
| --- | --- | --- |
| Rust | Reglas, determinismo, replays, pines de hash, sonda de oleadas | `core/src/**`, `core/tests` |
| Servidor y API | Replays, fixtures, orden de puntajes, API HTTP | `server/tests`, `api/tests` |
| Vitest | Contratos puros: flujo, ajustes, tutorial, calidad, contraste, presupuesto de píxeles, eventos, entrada | `tests/unit` |
| Playwright `chromium` | Arranque, jugabilidad con estado inyectado, higiene de entrada, accesibilidad, resiliencia, pantallas | `tests/e2e/*.spec.ts` |
| Playwright `mobile-landscape` | Pixel 7 apaisado: cluster táctil, HUD sin solapes, tutorial táctil | `tests/e2e/mobile-*.spec.ts` |
| Playwright `mobile-portrait` | iPhone 13 **emulado sobre Chromium**: lo mismo en vertical | idem |
| `bun run bench:frames` | Costo de frame por preset en GPU real, soak de 10 min | `scripts/measure-frames.mjs`, `PERFORMANCE_REPORT.md` |

Limitación: el e2e de jugabilidad inyecta estado y avanza ticks del wasm directamente; no hay un e2e que juegue
una partida completa con entrada humana simulada, porque Playwright headless no captura el puntero.

## Matriz de dispositivos y navegadores

| Entorno | Estado |
| --- | --- |
| Chromium de Playwright, escritorio 1280×800 | corrido (proyecto `chromium`) |
| Chromium emulando Pixel 7 apaisado, 915×412 y menores | corrido (proyecto `mobile-landscape`) |
| Chromium emulando iPhone 13 vertical, 390×844 y menores | corrido (proyecto `mobile-portrait`). **No es Safari** |
| Chrome con ventana en el M3 (frame bench) | corrido |
| Safari / WebKit real o de Playwright | no corrido (falta el runner `webkit-2215`) |
| Firefox escritorio | no corrido |
| Safari escritorio | no corrido |
| Android Chrome físico | no corrido |
| iOS Safari físico | no corrido |
| Red lenta | no corrido |
| Pointer lock real de escritorio | no corrido (headless no puede capturar el puntero) |

## Casos manuales pendientes

Todos `no corrido` y necesitan a una persona.

| Caso | Qué mirar |
| --- | --- |
| Primera visita en un teléfono real | Que el tutorial se entienda sin teclado; dónde se traba la persona; si Continuar y Omitir se alcanzan con el pulgar |
| Sprint táctil | Si empujar el stick a fondo corre sin querer al caminar (hallazgo D-3 en `GAMEPLAY_SPEC.md`) |
| Giro de 1:1 con el mouse real y pointer lock | Que se sienta natural al disparar en ráfaga con la carabina |
| Calidad automática en un portátil con gráficos integrados | Que `auto` no suba y baje con un tirón (la vía de subida por CPU no está validada en GPU limitada) |
| Lector de pantalla (VoiceOver, NVDA) | Que el toast y el panel del tablero se anuncien |
| Rotar el teléfono durante una partida | Que la partida siga y el aviso desaparezca |
| Tableta 1024×768 real | Que el HUD compacto quede legible |
| 320×568 vertical | Límite conocido: el HUD se solapa (ver `GAME_AUDIT.md`) |

## Regresiones que cada prueba nueva atrapa

Verificado quitando el arreglo y viendo la prueba fallar: A-01 (almacenamiento bloqueado) y A-06 (teclas del menú
que llegan armadas). Para el resto de los defectos de la simulación, las pruebas de Rust se escribieron antes del
arreglo y fallaron primero (`look_*`, `held_trigger_fires_at_the_spec_rate`, `patrol_walks_*`,
`completing_a_reload_emits_reload_end`, `dry_fire_reloads_only_with_auto_reload`, la sonda de oleadas). Las demás
pruebas nuevas (HUD, tutorial, accesibilidad, calidad) se escribieron junto al cambio y **no** se verificó
una a una que fallen sin él.
