# Especificación de jugabilidad (constantes reales del núcleo)

Esta tabla describe **lo que el código hace hoy**, con el archivo de donde sale cada número. Es la
contraparte medida de `SPEC.md`, que dice qué se quería. Si un valor cambia en el código, este
documento se actualiza en el mismo commit; si discrepa de `SPEC.md`, manda el código y se registra
abajo como decisión abierta.

Versiones al cierre de esta auditoría: `SCORE_VERSION` 4, `OVERFLOW_SCORE_VERSION` 4, `LOG_VERSION` 4,
`SETTINGS_VERSION` 3.

## Simulación

| Concepto | Valor | Fuente |
| --- | --- | --- |
| Paso fijo | 60 Hz (`FIXED_DT = 1/60`) | `core/src/sim.rs` |
| Techo de `dt` por tick | 0.1 s | `Game::tick` |
| Máximo de pasos por frame en el shell | 5, con reinicio al reanudar | `src/core/loop.ts` |
| Techo de una partida verificable | 72 000 ticks (20 min) | `core/src/replay.rs` |
| Determinismo | `libm`, sin `HashMap`, RNG propio; mismo hash nativo y wasm | `core/src/rng.rs`, `tests/unit/determinism.test.ts` |

## Jugador

| Concepto | Valor | Fuente |
| --- | --- | --- |
| Radio / altura / ojos | 0.36 / 1.8 / 1.62 m | `core/src/player.rs` |
| Caminar / correr | 4.7 / 6.9 m/s | idem |
| Aceleración suelo / aire | 62 / 14 m/s² | idem |
| Fricción | 11 | idem |
| Salto | 5.9 m/s; gravedad 21 m/s² | idem |
| Altura de escalón | 0.32 m | idem |
| Límite de pitch | ±1.5 rad | idem |
| Vida | 100; regenera 4/s tras 7 s sin daño | idem |
| ADS | reduce la velocidad hasta 40 %; la recarga, a 85 % | `Player::tick` |

**Mirada.** El giro del mouse mueve la mira exactamente lo girado. Si el giro va contra el retroceso
pendiente, el 45 % del giro se descuenta del retroceso (sin cruzar cero) en vez de sumarse al ángulo
guardado. El pitch efectivo (guardado más retroceso) está acotado a ±1.5 rad. El retroceso decae con
`exp(-6.5·dt)`.

**Sprint.** Teclado: Shift. Táctil: stick con deflexión >0.9. Ambos entran por el mismo bit de input
(`I.run`), así que el replay no distingue de dónde vino.

## Armas

| Arma | Daño | Cadencia | Cargador / reserva | Modo | Dispersión (cadera / ADS) | Retroceso (pitch / yaw) | Recarga | Alcance |
| --- | ---: | ---: | --- | --- | --- | --- | ---: | ---: |
| PB-01 Sidearm | 26 | 320 rpm | 12 / 60 | semiautomática | 0.005 / 0.0015 | 0.016 / 0.004 | 1.05 s | 90 m |
| AR-04 Carbine | 15 | 660 rpm | 30 / 120 | automática | 0.019 / 0.009 | 0.0075 / 0.0045 | 1.55 s | 80 m |
| SG-08 Scatter | 6 × 8 perdigones | 70 rpm | 6 / 24 | semiautomática | 0.085 / 0.06 | 0.03 / 0.008 | 2.0 s | 24 m |

Fuente: `core/src/weapons.rs`. La escopeta tiene caída de daño (pleno hasta 6 m, mínimo 25 % desde 20 m)
y solo existe si la partida empezó con `FLAG_SHOTGUN`.

**Cadencia.** El intervalo es `60 / rpm`. El resto fraccionario se arrastra entre disparos (un tick como
máximo), de modo que a 60 Hz la carabina dispara a ~660 rpm y no a 600. La prueba
`held_trigger_fires_at_the_spec_rate` mide las tres armas durante 10 s.

**Recarga.** `RELOAD_START` al empezar; `RELOAD_END` con `b=1` al completarse (con `b=0` es un cambio
de arma que cancela la recarga). El disparo en seco emite `EMPTY_MAG` y solo recarga si la auto-recarga
está activa.

**Headshot.** El impacto cuenta como cabeza por encima de `0.78 × altura` del enemigo; multiplicador 2.0
(carabina y sidearm) o 1.15 (escopeta).

## Enemigos

| Tipo | Vida | Velocidad | Detecta a | Alcance de ataque | Daño | Telegrafía | Cooldown |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Scout | 35 | 3.5 m/s | 26 m | 2.6 m | 12 | 0.36 s | 1.15 s |
| Sentinel | 55 | 2.0 m/s | 32 m | 20 m (rango preferido 11) | 8 × 3 ráfaga | 0.62 s | 2.3 s |
| Interceptor | 28 | 5.5 m/s | 26 m | 1.4 m (embestida a 12 m/s, órbita a 3.2 m) | 18 | 0.45 s | 1.6 s |

Fuente: `core/src/enemy.rs`. En Overflow la vida sube 4 % por oleada con tope ×2.

**Patrulla.** Cada enemigo recorre un lazo de 4 m de radio alrededor de donde apareció, avanzando de
waypoint (0.6 rad) al llegar a 0.8 m o a los 4 s. A los 20 s de patrulla sin detectar al jugador sale a
buscarlo (scouts y sentinels persiguen; interceptores flanquean). Sin esto, una oleada podía quedar
abierta si un enemigo aparecía fuera de línea de visión (hallazgo A-13).

## Oleadas, terminales y modos

| Concepto | Valor | Fuente |
| --- | --- | --- |
| Terminales por sector | 3 | `MAX_NODES` |
| Radio / canal de un terminal | 1.9 m / 1.2 s | `NODE_RADIUS`, `NODE_CHANNEL` |
| Daño que cancela el canal | 15 | `NODE_CANCEL_DAMAGE` |
| Oleadas de misión | 5; tope de 12 enemigos vivos | `WAVE_TOTAL`, `MISSION_ALIVE_CAP` |
| Duración de misión | 180 s; extracción de 12 s | `MATCH_SECONDS`, `EXTRACTION_SECONDS` |
| Modos | misión 0, Overflow 1, diario 2, práctica 3 | `sim.rs` |
| Overflow | sin temporizador ni extracción; solo la muerte termina | `update_phase` |

Activar un terminal acelera la oleada (`accelerate_wave`). En Overflow cura 25 y suma 500 puntos.

## Puntuación

Misión y diario: `100 × bajas + 500 × terminales + bonus de tiempo + bonus de precisión − penalización
de daño`, versionada. Overflow: 100 por baja, 500 por terminal, 250 por oleada, hasta 500 por precisión,
menos 2 por punto de daño. Fuente: `core/src/sim.rs`.

## Decisiones abiertas

| # | Tema | Estado |
| --- | --- | --- |
| D-1 | Umbral de headshot a `0.78 × h` | `SPEC.md` no define la intención. No se tocó |
| D-2 | 20 s para que la patrulla salga a buscar y lazo de 4 m | Razonado, sin playtest |
| D-3 | Sprint táctil con el stick a >0.9 | El stick limita por eje: la diagonal completa también corre. Falta probar en dispositivo |
| D-4 | `SPEC.md` §3.5 describe estados distintos por enemigo (Detect, Scan, Retreat) | El código usa una máquina común con `ST_*`; la equivalencia es aproximada |
