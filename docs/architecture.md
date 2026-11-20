# Arquitectura

SEBITA: BREACH PROTOCOL separa la simulación (Rust/WASM) del shell (TypeScript:
render Three.js, HUD en DOM, input, audio). El núcleo no conoce el navegador y
el shell no reimplementa reglas de simulación: solo reenvía input y lee un
snapshot. Este documento describe el mapa de módulos, el flujo de datos y los
puntos reales de extensión con sus rutas.

## Mapa de módulos

```
core/src/               Rust — núcleo de simulación (solo std, sin dependencias)
  math.rs               vectores, AABB, raycasts, utilidades deterministas
  arena.rs              geometría de SECTOR_01, colisiones y líneas de visión
  player.rs             controlador del jugador: movimiento, salto, colisión
  weapons.rs            PB-01 y AR-04: hitscan, dispersión, recarga, retroceso
  enemy.rs              FSMs deterministas (Scout, Sentinel), decisión a 12 Hz
  waves.rs              composición y timing de las 5 oleadas
  sim.rs                Game: integra todo, avanza 1 paso fijo y serializa
  protocol.rs           contrato binario (offsets del snapshot y del input)
  rng.rs                RNG con semilla, determinista

src/
  main.ts               composition root: instancia GameApp y arranca el boot
  core/game.ts          máquina de pantallas, loop, wiring de UI y eventos
  core/loop.ts          acumulador de paso fijo (1/60 s, clamping, ticks descartados)
  core/quality.ts       controlador adaptativo de calidad con histéresis
  core/settings.ts      ajustes versionados y tolerantes a basura (localStorage)
  core/scores.ts        récord local por modo e input
  wasm/bridge.ts        carga del módulo, punteros, tick y lectura del snapshot
  wasm/protocol.ts      espejo TS del contrato binario (protocol.rs)
  render/renderer.ts    Three.js: escena, cámara, presets de calidad, draw calls
  render/entities.ts    mallas de enemigos instanciadas, viewmodel
  render/fx.ts          pool de efectos (impactos, fogonazos)
  input/input.ts        pointer lock, teclado, multitouch con pointerId
  audio/audio.ts        SFX sintetizados con Web Audio (sin archivos)
  ui/hud.ts             actualización del HUD desde el snapshot
  ui/engineering.ts     Engineering Mode: métricas reales
  world/layout.ts       SECTOR_01: única fuente de verdad de la geometría
```

## Flujo de datos por frame

1. `requestAnimationFrame` dispara `GameApp.frame` (`src/core/game.ts`).
2. El delta real (puede ser 144 Hz, 60 Hz o un frame de 150 ms) entra al
   acumulador de `FixedStepLoop` (`src/core/loop.ts`).
3. El loop entrega de 0 a 5 pasos de exactamente 1/60 s; el tiempo sobrante se
   descarta y se cuenta (va a `droppedTicks` en el header del snapshot).
4. Por cada paso, `InputManager.writeTo` llena un `Float32Array` de 16 floats y
   `Engine.tick` lo copia a la memoria wasm y ejecuta un paso de `Game`.
5. Rust integra jugador, enemigos, armas, fases y puntaje; escribe el snapshot
   de 620 floats en su memoria lineal y encola eventos con secuencia.
6. TypeScript lee el snapshot con un `Float32Array` sobre la memoria wasm
   **sin copiar** (`src/wasm/bridge.ts`) y los eventos nuevos desde el head.
7. El renderer interpola posiciones con `alpha` (fracción del paso pendiente),
   dibuja la escena y el HUD se actualiza desde el mismo buffer.
8. El frame time real alimenta `QualityController`; si decide cambiar de
   preset, el renderer se reconfigura y redimensiona.

## Por qué no wasm-bindgen

El contrato entre Rust y TypeScript es un único buffer `f32` con offsets
constantes (`core/src/protocol.rs` y `src/wasm/protocol.ts`). No hay
wasm-bindgen porque:

- **Cero copia y cero GC en el camino caliente.** El shell lee posiciones,
  salud, munición y eventos directamente sobre la memoria lineal; ningún
  objeto cruza la frontera, así que no hay allocations por frame.
- **Superficie mínima.** Las exportaciones son `bp_init`, `bp_reset`,
  `bp_tick`, `bp_snapshot_ptr`, `bp_set_arena`, `bp_alloc`, `bp_free` y
  `memory`; el binario queda en ~70 KiB.
- **El contrato es verificable.** `SNAPSHOT_LEN = 620` y los offsets están
  pineados por tests en ambos lados (`snapshot_layout_is_stable` en Rust y
  `tests/unit/protocol.test.ts` en TS); `assertProtocol` corta el boot si el
  binario y el shell no coinciden.

El costo es explícito: agregar un campo requiere editar el protocolo en los
dos lados y versionarlo. Ese roce es intencional — hace imposible el drift
silencioso entre núcleo y shell.

## El protocolo de snapshot

Un buffer de 620 `f32` en tres bloques contiguos:

| Bloque | Rango | Contenido |
| --- | --- | --- |
| Header | `[0, 64)` | versión, tiempo, fase, oleada, puntaje, salud, pose del jugador, arma, nodos, ticks, contadores de eventos |
| Enemigos | `[64, 320)` | 32 × 8: `x y z yaw hp state kind anim` |
| Terminales | `[320, 332)` | 3 × 4: `x z progress active` |
| Eventos | `[332, 620)` | 48 × 6: `type a b c d seq` (cola circular con head/count en el header) |

El input es otro buffer de 16 `f32` (offsets en `protocol.rs::I_*`): movimiento,
look deltas, fire held/pressed, salto, interactuar, recargar, correr, cambiar
arma, ADS. Los eventos son efímeros (audio y feed del HUD); el shell consume
hasta el último `seq` visto por frame.

## El loop de paso fijo

`src/core/loop.ts`: acumulador clásico con tres salvaguardas.

- `MAX_FRAME_DT = 0.1`: un frame de 150 ms se procesa como 100 ms; el resto se
  descarta para evitar la espiral de la muerte.
- `MAX_STEPS = 5`: nunca más de 5 ticks por frame; el excedente se cuenta como
  ticks descartados y Engineering Mode lo reporta.
- `alpha ∈ [0, 1)`: el renderer interpola con la fracción de paso acumulada,
  así el movimiento es suave a cualquier tasa de refresco sin romper la
  determinismo de la simulación.

Pausa, `visibilitychange` y `blur` resetean el acumulador: al reanudar no se
simula tiempo acumulado.

## El controlador de calidad

`src/core/quality.ts` decide sobre percentiles reales de frame time, no sobre
un solo frame:

- Ventana de 45 frames; p95 > 22 ms cuenta como ventana mala, p95 < 12 ms como
  ventana con holgura.
- Dos ventanas malas bajan un peldaño; cinco ventanas buenas suben uno
  (asimetría deliberada: caer rápido, subir despacio).
- Histéresis: una mala seguida de una buena no sube; el contador bueno se
  resetea con cualquier ventana neutra.
- Cooldown de 4 s entre cambios; tiempos de frame inválidos (NaN, ≤ 0, > 250)
  se descartan.
- Un preset manual (`low/medium/high`) gana y congela las decisiones
  automáticas; `auto` arranca en `medium` y nunca baja de `low` ni sube de
  `high`.

El renderer traduce cada preset a DPR máximo y toggles de detalle
(`src/render/renderer.ts`).

## Cómo extender

**Agregar un arma** — editar `core/src/weapons.rs` (tabla de datos del arma:
daño, cadencia, cargador, reserva, dispersión, retroceso), registrarla en el
protocolo si introduce un id nuevo (`core/src/protocol.rs::WEAPON` ya tiene
sidearm=1 y carbine=2, espejo en `src/wasm/protocol.ts::WEAPON`), y darle
malla y sonido al shell: `src/render/entities.ts` (viewmodel) y
`src/audio/audio.ts`. El selector por teclado ya existe en
`src/input/input.ts` (`Digit1` / `Digit2`).

**Agregar un enemigo** — nueva FSM en `core/src/enemy.rs` (decide a 12 Hz,
integra cada paso fijo), su `kind` en el protocolo (`ENEMY_KIND` en ambos
lados) y su entrada en la composición de oleadas (`core/src/waves.rs`). El
shell ya renderiza cualquier enemigo genérico desde el snapshot
(`src/render/entities.ts`); si necesita silueta propia, ahí va el caso.

**Agregar una arena** — todo vive en `src/world/layout.ts`: cajas sólidas y
visuales (`ARENA_BOXES`), terminales (`NODES`), spawns (`SPAWNS`) y arranque
del jugador (`PLAYER_START`). `colliderData()` serializa los sólidos para
`Engine.setArena` y el renderer construye las mallas desde la misma tabla, así
que la geometría de colisión y la visual no pueden divergir. Si la arena nueva
cambia dimensiones máximas, revisar los límites en `core/src/arena.rs`.

**Agregar un ajuste** — campo en `Settings` + default en `DEFAULT_SETTINGS`
(`src/core/settings.ts`), sanitizador en `sanitize()`; si cambia el shape,
subir `SETTINGS_VERSION` y escribir la migración en `migrate()`. El pipeline
de tests ya cubre migración y saneo (`tests/unit/settings.test.ts`).

**Cambiar el protocolo binario** — editar offsets en `core/src/protocol.rs` y
su espejo `src/wasm/protocol.ts`, actualizar `PROTOCOL_VERSION`, actualizar el
test de estabilidad en Rust y `tests/unit/protocol.test.ts`. Un mismatch
rompe el boot a propósito (pantalla de fallback, no página en blanco).
