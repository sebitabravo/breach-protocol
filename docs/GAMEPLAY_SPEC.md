# Especificación de jugabilidad (constantes reales del núcleo)

Esta tabla describe **lo que el código hace hoy**, con el archivo de donde sale cada número. Es la
contraparte medida de `SPEC.md`, que dice qué se quería. Si un valor cambia en el código, este
documento se actualiza en el mismo commit; si discrepa de `SPEC.md`, manda el código y se registra
abajo como decisión abierta.

Versiones actuales (pase visual y de combate): `SCORE_VERSION` 5, `OVERFLOW_SCORE_VERSION` 5, `LOG_VERSION` 5,
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
| Scout | 35 | 3.9 m/s | 26 m | 2.6 m | 12 | 0.36 s | 1.15 s |
| Sentinel | 55 | 2.0 m/s | 32 m | 20 m (rango preferido 11) | 8 × 3 ráfaga | 0.62 s | 2.3 s |
| Interceptor | 28 | 5.5 m/s | 26 m | 1.4 m (embestida a 12 m/s, órbita a 3.2 m) | 24 | 0.45 s | 1.3 s |

Fuente: `core/src/enemy.rs`. En Overflow la vida sube 4 % por oleada con tope ×2.

**Patrulla.** Cada enemigo recorre un lazo de 4 m de radio alrededor de donde apareció, avanzando de
waypoint (0.6 rad) al llegar a 0.8 m o a los 4 s; un waypoint tapado por una pared se salta. A los 6 s de
patrulla sin detectar al jugador sale a buscarlo (scouts y sentinels persiguen; interceptores flanquean). Sin esto, una oleada podía quedar
abierta si un enemigo aparecía fuera de línea de visión (hallazgo A-13).

**Combate (v5).**
- El centinela dispara con una dispersión de `0.012 + 0.0025 × velocidad del jugador` (rad): quedarse quieto
  es peligroso, moverse lo esquiva.
- La embestida del interceptor apunta 0.22 s por delante del jugador.
- Un interceptor que flanquea sin línea de visión durante 6 s pasa a perseguir.
- Los scouts se acercan en zigzag a más de 4 m.
- La separación entre robots resuelve colisión con el mapa: ninguno queda dentro de una pared.

## Dificultad medida

Bot de referencia (`core/src/scenarios.rs::competent_bot`): reacción de 0.25 s, giro máximo de 6 rad/s,
strafe alterno cada 1.2 s, carabina. No juega el objetivo, así que nunca gana: mide cuánto resiste. 10 semillas
por sector, 180 s. Reproducir: `cargo test --manifest-path core/Cargo.toml --release --lib difficulty_report -- --ignored --nocapture`.

| Sector | Bot muerto antes (v4) | Bot muerto después (v5) | Vida media del bot (v4 → v5) | Jugador quieto muere a (v4 → v5) |
| --- | ---: | ---: | --- | --- |
| 01 | 9/10 | 9/10 | 144 → 131 s | 38.5 → 21.1 s |
| 02 | 0/10 (16 de daño en 3 min) | 10/10 | 180 → 100 s | 37.5 → 28.2 s |
| 03 | 10/10 | 6/10 | 128 → 164 s | 38.7 → 24.0 s |

Lectura: el sector 02 era trivial por un error, no por diseño (robots incrustados en paredes que perseguían para
siempre). El sector 03 bajó para el bot porque ahora el centinela premia moverse y el bot nunca para de moverse;
un jugador que se queda quieto lo pasa peor. `difficulty_stays_in_the_agreed_band` fija la banda: el bot cae en
al menos 3 de 6 semillas por sector y un jugador quieto no pasa de 32 s.

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
| D-2 | 6 s para que la patrulla salga a buscar y lazo de 4 m | Medido con el bot, sin playtest humano |
| D-5 | El bot no juega el objetivo | La dificultad real de ganar una misión no está medida |
| D-3 | Sprint táctil con el stick a >0.9 | El stick limita por eje: la diagonal completa también corre. Falta probar en dispositivo |
| D-4 | `SPEC.md` §3.5 describe estados distintos por enemigo (Detect, Scan, Retreat) | El código usa una máquina común con `ST_*`; la equivalencia es aproximada |
